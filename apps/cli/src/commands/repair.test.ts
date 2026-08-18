import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runInit } from "./init.js";
import { runRepair } from "./repair.js";
import {
  createCommandFixture,
  exists,
  removeCommandFixtures,
} from "./testing.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const INTERRUPTED_ID = "tx_fixture_001";

afterEach(removeCommandFixtures);

describe("runRepair", () => {
  it("refuses when neither action is named", async () => {
    const fixture = await createCommandFixture("repair-neither");

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses when both actions are named", async () => {
    const fixture = await createCommandFixture("repair-both");

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses an identifier that is not a journal identifier", async () => {
    const fixture = await createCommandFixture("repair-shape");

    const result = await runRepair(fixture.context, {
      resume: "../../etc/passwd",
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses an identifier no journal uses", async () => {
    const fixture = await createCommandFixture("repair-unknown");

    const result = await runRepair(fixture.context, {
      resume: "tx_fixture_404",
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });

  /**
   * **Inverted on 2026-08-17, and the inversion is what makes a fix reachable.** This
   * refused `--resume` on a finalized transaction as invalid input — which also made the
   * executor's backup-prune sweep unreachable from the product. The prune runs *after* the
   * `finalized` transition, so a crash between them leaves a journal reading `finalized`
   * with the backup payload still on disk, possibly a secret the user asked to remove, and
   * `resume` was the only path that could clear it (BACKLOG, Foundation request 2).
   *
   * `resume` on a finalized journal is a no-op apart from that prune, so letting it through
   * costs nothing.
   */
  it("resumes a finalized transaction, because that is what sweeps the prune window", async () => {
    const fixture = await createCommandFixture("repair-finalized");
    await runInit(fixture.context, ACCEPTED);

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe("resumed");
    expect(result.data.phase).toBe("finalized");
  });

  /**
   * **And the half that is still refused.** There is nothing to undo in a finalized
   * transaction and the executor throws on it, so `--rollback` remains invalid input —
   * the inversion above is scoped to the action that became idempotent, not to the phase.
   */
  it("still refuses to roll back a transaction that already finalized", async () => {
    const fixture = await createCommandFixture("repair-finalized-rollback");
    await runInit(fixture.context, ACCEPTED);

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.message).toContain("finalized");
  });

  it("resumes an interrupted transaction to completion", async () => {
    const fixture = await createCommandFixture("repair-resume", {
      interruptAfter: "staged",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(await exists(fixture.paths.configFile)).toBe(false);

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe("resumed");
    expect(result.data.phase).toBe("finalized");
    expect(await exists(fixture.paths.configFile)).toBe(true);
  });

  it("rolls an interrupted transaction back to its original state", async () => {
    const fixture = await createCommandFixture("repair-rollback", {
      interruptAfter: "applied",
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(await exists(fixture.paths.configFile)).toBe(true);

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe("rolled_back");
    expect(result.data.phase).toBe("rolled_back");
    expect(await exists(fixture.paths.configFile)).toBe(false);
  });

  /**
   * **The mirror of the finalized case, and it was refused for a full review round after
   * that one was opened.** The executor's `rolled_back` early return prunes the backup
   * payloads exactly as the `finalized` one does, to sweep a crash between the transition
   * and the prune — and this command refused a rolled-back journal for *both* actions, so
   * nothing the product ships could ever call it. The unit test that covered it called
   * `executor.rollback()` directly, which is precisely how the finalized half hid too.
   *
   * The planted payload is what makes this a reachability test rather than a
   * does-not-refuse test: a green `ok` with the bytes still on disk would be the defect.
   */
  it("rolls back an already rolled-back transaction, sweeping the prune window", async () => {
    const fixture = await createCommandFixture("repair-rolled-back-again", {
      interruptAfter: "applied",
    });
    await runInit(fixture.context, ACCEPTED);
    const first = await runRepair(fixture.context, {
      resume: null,
      rollback: INTERRUPTED_ID,
    });
    expect(first.ok).toBe(true);

    const payload = join(
      fixture.paths.backupsDir,
      "transactions",
      INTERRUPTED_ID,
      "0.bin",
    );
    await mkdir(dirname(payload), { recursive: true });
    await writeFile(payload, "a pre-edit copy of the user's file", "utf8");

    const result = await runRepair(fixture.context, {
      resume: null,
      rollback: INTERRUPTED_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.phase).toBe("rolled_back");
    expect(await exists(payload)).toBe(false);
  });

  /**
   * **The whole retention arm of this command was untested, including the recovery string
   * two review rounds were spent getting right.** `"make the backup directory writable"`
   * occurred exactly once in the repository — in `repair.ts` — and
   * `TransactionBackupRetentionError` appeared in no test outside `packages/core`.
   * Reverting the string to the impossible "just re-run it" version, or dropping the
   * `recovery` argument entirely, stayed green (found by fresh-context review, 2026-08-17).
   *
   * **`paths` is asserted because the message cannot be.** `redactDiagnostic` rewrites the
   * payload path — production ids are `tx_${randomUUID()}` and its high-entropy rule
   * catches them — so the directory the recovery tells the user to chmod has to travel in
   * a field that is not rewritten. It used to publish the journal path under `state/`,
   * which is a different tree entirely.
   */
  it("names the backup directory and its precondition when a payload cannot be removed", async () => {
    const fixture = await createCommandFixture("repair-retention");
    await runInit(fixture.context, ACCEPTED);
    const directory = join(
      fixture.paths.backupsDir,
      "transactions",
      INTERRUPTED_ID,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "0.bin"), "a pre-edit copy", "utf8");
    /** Read and execute, so the payload is visible and `unlink` is refused. */
    await chmod(directory, 0o500);

    try {
      const result = await runRepair(fixture.context, {
        resume: INTERRUPTED_ID,
        rollback: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(EXIT_CODES.recoveryRequired);
      expect(result.error.recovery).toBe(
        `make the backup directory writable, then: developer-os repair --resume ${INTERRUPTED_ID}`,
      );
      expect(result.error.paths).toStrictEqual([directory]);
      /** The errno, so a cause the recovery does not cover is at least visible. */
      expect(result.error.message).toContain("EACCES");
      expect(result.error.message).toContain("the change was applied");
      /**
       * **And the payload really did survive.** Without this, a prune that deleted the file
       * and *then* reported retention would satisfy every assertion above — the command
       * would be telling the user to go clean up something already gone.
       */
      expect(await exists(join(directory, "0.bin"))).toBe(true);
    } finally {
      await chmod(directory, 0o700);
    }
  });

  /**
   * **The other half of the cross pairing.** `resumeLocked` throws on a rolled-back
   * journal before reaching any prune, so admitting `--resume` here would change the error
   * and nothing else. The rule is per action, not per phase.
   */
  it("refuses to resume a transaction that already rolled back", async () => {
    const fixture = await createCommandFixture("repair-rolled-back-resume", {
      interruptAfter: "applied",
    });
    await runInit(fixture.context, ACCEPTED);
    await runRepair(fixture.context, { resume: null, rollback: INTERRUPTED_ID });

    const result = await runRepair(fixture.context, {
      resume: INTERRUPTED_ID,
      rollback: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.message).toContain("rolled_back");
  });
});
