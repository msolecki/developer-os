import { readFile } from "node:fs/promises";

import { EXIT_CODES } from "@developer-os/core";
import type { TransactionPhase } from "@developer-os/core";
import { runCapture } from "@developer-os/cli/dist/commands/capture.js";
import {
  listIncompleteTransactions,
  runDoctor,
} from "@developer-os/cli/dist/commands/doctor.js";

import { afterEach, describe, expect, it } from "vitest";

import {
  filesUnder,
  installSecurityFixture,
  oneNote,
  removeSecurityFixtures,
  statusOfText,
} from "./helpers.js";
import type { InstalledFixture } from "./helpers.js";

/**
 * **Interruption after each of the seven forward phases, for every forward
 * transaction this subsystem writes — thirty-five cases.**
 *
 * **It is an in-process `afterPhase` throw, not a real signal.** `afterPhase`
 * raises at a phase boundary, which simulates the process dying there without
 * one. The distinction is worth keeping: a thrown error unwinds and a `SIGKILL`
 * does not, so a suite driven this way proves the *journal* is recoverable and
 * never that no `finally` block ran. A real-signal case belongs in the
 * end-to-end suite against the compiled binary, which is where the process
 * boundary actually exists.
 *
 * **The phase names are `TransactionPhase`'s, which are past tense.**
 * `rolled_back` is not a forward phase and is not interrupted.
 *
 * **`finalized` is the one phase that leaves nothing to recover**, and that is a
 * property rather than an exception: the throw lands after the transition to
 * `finalized` has been written, so the journal is complete and `doctor` has
 * nothing to report. Branching on it is what keeps the other thirty cases
 * honest — a suite that asserted exit 6 everywhere would have to be made green
 * by weakening the assertion.
 */

const PHASES: readonly TransactionPhase[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
];

/**
 * **Every forward transaction kind this subsystem writes**, by the label its
 * cases carry.
 *
 * The suite reached two of five until DOS-P6 Task 19's review: `capture` and
 * `ingest-apply`. The criterion it is evidence for is "every interruption point
 * returns either the pre-transaction state or a deterministic recoverable
 * state", and three of the five points had no case at all — including the two
 * that leave a capture at `staging`, which is the state the recovery text is
 * most easily wrong about.
 *
 * `ingest-rollback` is deliberately absent: it is the compensating transaction,
 * not a forward one, and interrupting it is what `expectedStatus`'s `staging`
 * expectations already describe from the other side.
 */
const TARGETS = {
  "the capture write": "capture",
  "the ingest stage": "ingest-stage",
  "the ingest apply": "ingest-apply",
  "the ingest reindex": "ingest-reindex",
  "the ingest ingested write": "ingest-ingested",
} as const;

type Target = keyof typeof TARGETS;

/**
 * **What the capture's own file must say afterwards**, per target and phase, and
 * it is a real expectation rather than one value repeated: the whole point of
 * the criterion is that some of these are the pre-transaction state and some are
 * a recoverable one, and a suite that expected `accepted` everywhere would have
 * to be made green by weakening it.
 *
 * - **`ingest-stage`**: the status write is rolled back at every phase, so the
 *   capture is `accepted` and the next run tries it again.
 * - **`ingest-apply`**: `accepted` while nothing has been written — `planned`
 *   through `validated` — and `staging` from `applied` on, because the notes
 *   exist from that phase and a capture claiming `accepted` beside its own notes
 *   sends the next run at a path `create` refuses.
 * - **`ingest-reindex`**: the notes landed before this transaction began, so
 *   every phase leaves `staging`.
 * - **`ingest-ingested`**: the same, until this transaction's own write lands —
 *   from `applied` on the capture says `ingested`, which is the truth: the work
 *   finished and only the exit code says otherwise.
 */
const WRITTEN_FROM: TransactionPhase[] = ["applied", "verified", "finalized"];

function expectedStatus(target: Target, phase: TransactionPhase): string {
  const written = WRITTEN_FROM.includes(phase);
  switch (target) {
    case "the ingest stage":
      return "accepted";
    case "the ingest apply":
      return written ? "staging" : "accepted";
    case "the ingest reindex":
      return "staging";
    case "the ingest ingested write":
      return written ? "ingested" : "staging";
    default:
      return "accepted";
  }
}

const CASES: readonly (readonly [Target, TransactionPhase])[] = (
  Object.keys(TARGETS) as readonly Target[]
).flatMap((target) => PHASES.map((phase) => [target, phase] as const));

function interruptAfter(
  phase: TransactionPhase,
  kind: string,
): (seen: TransactionPhase, journal: { readonly kind: string }) => void {
  return (seen, journal): void => {
    if (seen !== phase || journal.kind !== kind) return;
    throw new Error(`synthetic interruption after ${seen}`);
  };
}

/** Every status line in quarantine, so "none reached ingested" is a real sweep. */
async function statusesInQuarantine(
  fixture: InstalledFixture,
): Promise<readonly string[]> {
  const files = await filesUnder(fixture.quarantine);
  return Promise.all(
    files.map(async (path) => statusOfText(await readFile(path, "utf8"))),
  );
}

/**
 * What `doctor` owes after an interruption, and it differs by exactly one
 * phase. Both branches assert something; neither can be satisfied by an empty
 * set.
 */
async function assertDoctorReports(
  fixture: InstalledFixture,
  phase: TransactionPhase,
): Promise<void> {
  const incomplete = await listIncompleteTransactions(fixture.context);
  const report = await runDoctor(fixture.context);

  if (phase === "finalized") {
    expect(incomplete).toStrictEqual([]);
    expect(report.code).not.toBe(EXIT_CODES.recoveryRequired);
    return;
  }

  expect(incomplete.length, "an interrupted run must leave a journal").toBeGreaterThan(
    0,
  );
  expect(report.code).toBe(EXIT_CODES.recoveryRequired);
  const published = JSON.stringify(report);
  expect(published).toContain("repair --resume");
  expect(published).toContain("repair --rollback");
  expect(published).toContain(incomplete[0]?.id ?? "");
}

afterEach(removeSecurityFixtures);

/**
 * **What the cases below actually drove**, recorded as each one runs.
 *
 * It replaces two assertions over the constants the case list was generated
 * from — `PHASES.length === 7`, `CASES.length === 14` at the time — which could not
 * fail,
 * inside the one directory whose subject is gates that pass by scanning
 * nothing. `EXPECTED_COVERAGE` is derived independently of `CASES`, from the
 * `TransactionPhase` union written out by hand, so the two can disagree.
 */
const drove = new Set<string>();

const EXPECTED_COVERAGE: readonly string[] = [
  "the capture write",
  "the ingest stage",
  "the ingest apply",
  "the ingest reindex",
  "the ingest ingested write",
].flatMap((target) =>
  [
    "planned",
    "backed_up",
    "staged",
    "validated",
    "applied",
    "verified",
    "finalized",
  ].map((phase) => `${target}|${phase}`),
);

describe("an interruption at every forward phase", () => {
  it.each(CASES)(
    "leaves %s retryable when it is killed at %s",
    async (target, phase) => {
      const kind = TARGETS[target];
      const fixture = await installSecurityFixture(
        `interrupt-${kind}-${phase}`,
        { afterPhase: interruptAfter(phase, kind) },
      );

      if (target === "the capture write") {
        const result = await runCapture(
          fixture.context,
          { text: `an observation interrupted at ${phase}` },
          { cwd: () => fixture.project, detect: () => "unknown" },
        );
        expect(result.ok, "the interruption must reach the caller").toBe(false);
      } else {
        const seeded = await fixture.seedAccepted(
          `an observation interrupted at ${phase}`,
        );
        fixture.runner.reply(() => oneNote(seeded.id, "DEV/interrupted.md"));
        const result = await fixture.ingest();
        expect(result.ok, "the interruption must reach the caller").toBe(false);
        /**
         * Either the pre-transaction state or a deterministic recoverable one,
         * decided per target and phase rather than assumed uniform — see
         * `expectedStatus`. What is never true of any of them is a capture at
         * `accepted` while its own notes are in the vault: that is the state
         * whose retry can only refuse.
         */
        expect(await fixture.statusOf(seeded.id)).toBe(
          expectedStatus(target, phase),
        );
      }

      /**
       * The sweep is deliberately not asserted non-empty here, because on the
       * capture half it is legitimately empty at the early phases — the file
       * does not exist yet, which is the correct outcome. The non-empty
       * assertion for this case lives above, on the seeded capture's own status,
       * and below, on the journal `doctor` must find.
       */
      const statuses = await statusesInQuarantine(fixture);
      /**
       * `ingest-ingested` is the one target whose own write *is* the transition
       * to `ingested`, so from `applied` on the status on disk is the one the
       * run was trying to reach. Every other target must not have reached it.
       */
      if (expectedStatus(target, phase) !== "ingested") {
        expect(statuses).not.toContain("ingested");
      }

      await assertDoctorReports(fixture, phase);
      drove.add(`${target}|${phase}`);
    },
  );
});

/**
 * Last in the file, and measured rather than declared. `rolled_back` cannot
 * appear because no case adds it; if a case is deleted or silently skipped the
 * set shrinks and this goes red, which is the whole reason it is here rather
 * than being a `toHaveLength` over the array the cases were generated from.
 *
 * **A filtered run does not redden this case — it hides it, which is worse.**
 * Vitest 4.1.8 *skips* non-matching cases rather than failing them, and a `-t`
 * pattern chosen to select the cases below will not normally select this one:
 * `npx vitest run security/interruption.test.ts -t "planned"` reports
 * `5 passed | 31 skipped`, **green**, having driven five of thirty-five
 * interruptions. This case cannot warn about that, because it was filtered out
 * along with the coverage it measures. Measured, not assumed — an earlier
 * version of this paragraph claimed the opposite.
 *
 * The one filtered form that *does* redden is a pattern matching this case's own
 * name too: `-t "killed at planned|nothing else"` gives `1 failed | 5 passed |
 * 30 skipped`, naming the thirty labels that went unrecorded. `--shard` never
 * triggers it at all — vitest shards at file granularity, so a selected file
 * runs whole.
 *
 * **Re-measured 2026-08-15**, both commands, after the suite grew from fourteen
 * interruptions to thirty-five. The previous numbers were the pre-extension
 * ones and had gone stale where nothing cited them.
 */
describe("what this suite drove", () => {
  it("interrupted every forward transaction at each of the seven phases, and nothing else", () => {
    expect(drove.size, "a suite that drove nothing is not a suite").toBeGreaterThan(0);
    expect([...drove].sort()).toStrictEqual([...EXPECTED_COVERAGE].sort());
    expect([...drove].some((entry) => entry.endsWith("|rolled_back"))).toBe(false);
  });
});
