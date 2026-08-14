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
 * **Interruption after each of the seven forward phases, for both the capture
 * write and the ingest apply — fourteen cases.**
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
 * nothing to report. Branching on it is what keeps the other thirteen cases
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

/** The two mutations this subsystem makes, by the transaction kind each uses. */
const TARGETS = {
  "the capture write": "capture",
  "the ingest apply": "ingest-apply",
} as const;

type Target = keyof typeof TARGETS;

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
 * from — `PHASES.length === 7`, `CASES.length === 14` — which could not fail,
 * inside the one directory whose subject is gates that pass by scanning
 * nothing. `EXPECTED_COVERAGE` is derived independently of `CASES`, from the
 * `TransactionPhase` union written out by hand, so the two can disagree.
 */
const drove = new Set<string>();

const EXPECTED_COVERAGE: readonly string[] = [
  "the capture write",
  "the ingest apply",
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
         * Retryable, in the only sense the product offers: the capture is back
         * at `accepted`, never at `ingested`. At `finalized` the notes are on
         * disk while the capture says `accepted`, which is the residual the
         * four-transaction ladder documents and no arrangement of these
         * transactions removes.
         */
        expect(await fixture.statusOf(seeded.id)).toBe("accepted");
      }

      /**
       * The sweep is deliberately not asserted non-empty here, because on the
       * capture half it is legitimately empty at the early phases — the file
       * does not exist yet, which is the correct outcome. The non-empty
       * assertion for this case lives above, on the seeded capture's own status,
       * and below, on the journal `doctor` must find.
       */
      const statuses = await statusesInQuarantine(fixture);
      expect(statuses).not.toContain("ingested");

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
 * **A filtered or sharded run reddens this case.** `npx vitest run
 * security/interruption.test.ts -t "planned"` drives two of the fourteen and
 * this one complains about the other twelve. That is the accepted cost of
 * measuring coverage rather than declaring it, not a regression: run the file
 * whole, or expect this one to complain.
 */
describe("what this suite drove", () => {
  it("interrupted both writes at each of the seven forward phases, and nothing else", () => {
    expect(drove.size, "a suite that drove nothing is not a suite").toBeGreaterThan(0);
    expect([...drove].sort()).toStrictEqual([...EXPECTED_COVERAGE].sort());
    expect([...drove].some((entry) => entry.endsWith("|rolled_back"))).toBe(false);
  });
});
