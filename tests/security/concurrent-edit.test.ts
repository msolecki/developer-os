import { writeFile } from "node:fs/promises";

import { EXIT_CODES } from "@developer-os/core";
import type { TransactionJournalV1, TransactionPhase } from "@developer-os/core";
import { runReview } from "@developer-os/cli/dist/commands/review.js";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveSecondContext,
  installSecurityFixture,
  nothingProposed,
  removeSecurityFixtures,
} from "./helpers.js";

/**
 * **Two writers, one capture file.** Design spec §17.5, and the half of program
 * plan Task 6's eighth box that nothing else covers: `expectedBeforeHash` and
 * the macOS transaction lock have never been exercised by a race.
 *
 * **The competing write lands from `afterPhase`, after the executor took its
 * snapshot and before it applies.** That placement is the whole case.
 * `TransactionExecutor.execute` snapshots each target when it plans and re-checks the hash at
 * apply, so a write landing *earlier* used to be adopted as the expected state and silently
 * overwritten — the lost-update residual this suite declined to assert in either direction,
 * because asserting the overwrite would have encoded the bug as the contract and asserting
 * the refusal would have failed against real behaviour.
 *
 * **That is no longer true as of 2026-08-20.** `PlannedFileMutation.expectedBeforeHash` lets a
 * caller hand over the digest of the bytes *it* read, and the plan phase refuses on a
 * mismatch — so the earlier write is now refused when the caller supplies a precondition, and
 * `review.test.ts` and `ingest.test.ts` each assert it. This suite still does not drive that
 * window, because its subject is the lock and the phase hooks; the case it declined to write
 * exists now, one layer up.
 *
 * **The lock is keyed per transaction id, and this suite says so rather than
 * pretending otherwise.** `TransactionStore.withTransactionLock` takes an id and
 * locks `.<id>.lock`; production ids are `tx_<uuid>`. So two concurrent
 * `developer-os` runs never contend for the lock at all — they contend for the
 * *file*, and `expectedBeforeHash` is what refuses. What the lock does guard is
 * a second operation on the **same** transaction, which is exactly what
 * `developer-os repair --resume` performs against a journal a still-running
 * process is inside. That is the second case below, held at `staged`.
 */

/** A line a person types in Obsidian while a review is mid-transaction. */
const HAND_EDIT = "\nA line a person typed while the review was running.\n";

afterEach(removeSecurityFixtures);

describe("a capture that changed under the command writing it", () => {
  it("refuses a review edit whose capture changed under it, rather than overwriting", async () => {
    let competing: (() => Promise<void>) | null = null;
    const fixture = await installSecurityFixture("conflict-review", {
      afterPhase: async (
        phase: TransactionPhase,
        journal: TransactionJournalV1,
      ): Promise<void> => {
        if (phase !== "staged" || journal.kind !== "review") return;
        const write = competing;
        competing = null;
        if (write !== null) await write();
      },
    });

    const seeded = await fixture.capture("an observation someone is about to edit");
    const before = await fixture.captureText(seeded.id);
    competing = async (): Promise<void> => {
      await writeFile(seeded.path, `${before}${HAND_EDIT}`, { mode: 0o600 });
    };

    const result = await runReview(fixture.context, {
      id: seeded.id,
      decision: "edit",
    });

    /**
     * Three, not six. `TransactionConflictError` declares
     * `EXIT_CODES.decisionRequired` (`executor.ts:39-46`) and `review`
     * propagates the class's own code rather than choosing one — a command
     * inventing a code for a shared error class is how a stable exit table stops
     * being one. Six is what `doctor` returns for an incomplete transaction,
     * which is the interruption suite's subject rather than this one's.
     */
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.ok).toBe(false);

    /** The person's edit survived; the review did not write over it. */
    const after = await fixture.captureText(seeded.id);
    expect(after).toContain(HAND_EDIT.trim());
    expect(after).toBe(`${before}${HAND_EDIT}`);
    /** And the hook really did fire, so the refusal is the executor's check. */
    expect(competing).toBeNull();

    if (result.ok) return;
    expect(result.error.message).toContain("changed on disk");
  });

  /**
   * **The macOS transaction lock, doing what it was built for.**
   *
   * Held at `staged`: the first execution is inside `withTransactionLock` for
   * its own journal, and the second operation on that journal — `resume`, which
   * is what `repair --resume` calls — is refused rather than allowed to drive
   * the same journal forward from two places at once. Both providers here are
   * real `MacOsTransactionLockProvider`s over `/usr/bin/lockf`, so the refusal
   * is `flock(2)` and not a fixture's bookkeeping.
   *
   * "Two ingests, one lock" is deliberately **not** what this drives: `ingest`
   * runs four transactions per capture with four ids, so two concurrent runs
   * interleave and neither refuses. A case written that way would pass for the
   * wrong reason on a fast machine and fail on a slow one.
   */
  it("refuses a second transaction while one holds the lock", async () => {
    let announce: (id: string) => void = () => undefined;
    const held = new Promise<string>((resolve) => {
      announce = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;

    const fixture = await installSecurityFixture("conflict-lock", {
      lock: "macos",
      afterPhase: async (
        phase: TransactionPhase,
        journal: TransactionJournalV1,
      ): Promise<void> => {
        if (phase !== "staged" || journal.kind !== "ingest-stage") return;
        if (holding) return;
        holding = true;
        announce(journal.id);
        await gate;
      },
    });

    const seeded = await fixture.seedAccepted("an observation two writers want");
    fixture.runner.reply(() => nothingProposed());

    const running = fixture.ingest();
    const id = await held;
    const second = deriveSecondContext(fixture, { lock: "macos" });

    await expect(second.executor.resume(id)).rejects.toThrow(/lock/u);

    release();
    const result = await running;
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);

    /**
     * The control that makes the refusal above mean "the lock", not "this id".
     * With the holder gone, the same call on the same id succeeds.
     */
    const resumed = await second.executor.resume(id);
    expect(resumed.phase).toBe("finalized");
    expect(await fixture.statusOf(seeded.id)).toBe("ingested");
  });
});
