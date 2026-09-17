import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, deriveBootstrapRetentionLocations, lifecycleBookkeepingPaths } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { runUninstall } from "../commands/uninstall.js";
import {
  createCommandFixture,
  exists,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import {
  assertOrdinaryCommandAdmitted,
  BOOTSTRAP_MANUAL_ARCHIVE,
  inspectBootstrapEvidenceAdmission,
} from "./report.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

afterEach(removeCommandFixtures);

interface PersistedFreshPlan {
  readonly id: string;
  readonly journalSlots: readonly { readonly slot: 0 | 1; readonly path: string }[];
  readonly createdPaths: readonly { readonly kind: string; readonly path: string }[];
}

function requestFor(fixture: CommandFixture) {
  return createBootstrapEvidenceInspectionRequest({
    productHome: fixture.paths.home,
    stateDirectory: fixture.paths.stateDir,
    initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
  });
}

async function onlyPersistedPlan(fixture: CommandFixture): Promise<PersistedFreshPlan> {
  const names = (await nodeFs.readdir(fixture.paths.stateDir)).filter((name) => name.endsWith(".plan.json"));
  if (names.length !== 1) throw new Error(`fixture holds ${String(names.length)} durable bootstrap plans`);
  return JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, names[0] as string), "utf8"),
  ) as PersistedFreshPlan;
}

/** The slot holding the highest sequence is current; the other is the one an advance writes. */
async function currentSlot(plan: PersistedFreshPlan): Promise<{ readonly current: number; readonly inactive: number }> {
  const sequences = await Promise.all(plan.journalSlots.map(async (slot) => {
    const value = JSON.parse(await nodeFs.readFile(slot.path, "utf8")) as { readonly sequence: string };
    return BigInt(value.sequence);
  }));
  const current = (sequences[0] as bigint) > (sequences[1] as bigint) ? 0 : 1;
  return { current, inactive: current === 0 ? 1 : 0 };
}

async function currentJournal(plan: PersistedFreshPlan): Promise<Record<string, unknown>> {
  const { current } = await currentSlot(plan);
  const slot = plan.journalSlots[current];
  if (slot === undefined) throw new Error("persisted plan has no two-slot journal");
  return JSON.parse(await nodeFs.readFile(slot.path, "utf8")) as Record<string, unknown>;
}

async function retainedBootstrapLockTombstone(fixture: CommandFixture): Promise<string> {
  const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
  const envelope = admission.retainedEnvelopes[0];
  if (envelope === undefined) throw new Error("fixture retained no verified envelope");
  const lock = deriveBootstrapRetentionLocations(envelope.plan, envelope.terminalJournal)
    .find((location) => location.role === "bootstrap_lock");
  if (lock === undefined) throw new Error("retained table has no bootstrap-lock row");
  return lock.tombstonePath;
}

describe("bootstrap evidence identity on a real V2 home", () => {
  it("projects an unattributed bootstrap leaf and blocks on one whose identity a retained envelope persisted", async () => {
    const fixture = await createCommandFixture("bootstrap-leaf-identity", { bootstrapAvailable: true });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const leaf = join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock");
    await nodeFs.writeFile(leaf, "", { mode: 0o600 });

    const unattributed = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    expect(unattributed.bootstrapLeaf).toMatchObject({ path: leaf, attributedTo: null });
    expect(unattributed.blocksNewIntent).toBe(false);

    await nodeFs.rm(leaf);
    const retainedLock = await retainedBootstrapLockTombstone(fixture);
    await nodeFs.rename(retainedLock, leaf);
    const attributed = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    expect(attributed.bootstrapLeaf?.attributedTo).toMatch(/^fi_/u);
    expect(attributed.blocksNewIntent).toBe(true);
    await nodeFs.rename(leaf, retainedLock);

    const unadmittedShapes = [
      { label: "non-zero-byte leaf", bytes: "synthetic residue\n", mode: 0o600 },
      { label: "group-readable leaf", bytes: "", mode: 0o644 },
    ];
    expect(unadmittedShapes.length).toBeGreaterThan(0);
    for (const shape of unadmittedShapes) {
      await nodeFs.writeFile(leaf, shape.bytes, { mode: shape.mode });
      await nodeFs.chmod(leaf, shape.mode);

      const residue = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

      expect(residue.bootstrapLeaf, shape.label).toBeNull();
      expect(residue.retainedPaths, shape.label).toContain(leaf);
      expect(residue.blocksNewIntent, shape.label).toBe(true);
      await nodeFs.rm(leaf);
    }
    const restored = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    expect(restored.bootstrapLeaf).toBeNull();
    expect(restored.blocksNewIntent).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("routes a retaining rolled-back envelope to init before handoff", async () => {
    const fixture = await createCommandFixture("bootstrap-retaining-rolled-back", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_foundation",
      /**
       * `during_retention` fires once, before the first row moves, so it leaves
       * a pre-retention terminal cursor rather than a `retaining` one. Only the
       * retainer's own boundary reaches this state.
       */
      bootstrapInterruptAfter: "after_journal_advance",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const journal = await currentJournal(await onlyPersistedPlan(fixture));
    expect(journal).toMatchObject({ phase: "retaining", terminalOutcome: "rolled_back" });
    expect(journal.retentionNext).toBeGreaterThan(0);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);

    const admission = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(admission.report.ids[0]).toMatchObject({ status: "incomplete", terminalOutcome: "rolled_back" });
    await expect(assertOrdinaryCommandAdmitted(requestFor(fixture))).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      recovery: "developer-os init",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("classifies an envelope whose journal slots were truncated after the V2 downcast uninstall", async () => {
    const fixture = await createCommandFixture("bootstrap-truncated-slots", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const plan = await onlyPersistedPlan(fixture);
    const { current, inactive } = await currentSlot(plan);
    const slotBytes = await Promise.all(plan.journalSlots.map((slot) => nodeFs.readFile(slot.path)));
    const restoreSlots = async (): Promise<void> => {
      for (const [ordinal, slot] of plan.journalSlots.entries()) {
        await nodeFs.writeFile(slot.path, slotBytes[ordinal] as Buffer);
      }
    };
    const bookkeeping = lifecycleBookkeepingPaths(fixture.paths.home);
    const attributableFiles = plan.createdPaths.filter((row) =>
      row.kind !== "directory" && !bookkeeping.has(row.path) &&
      row.path !== fixture.paths.brain && !row.path.startsWith(`${fixture.paths.brain}/`));
    expect(attributableFiles.length).toBeGreaterThan(0);
    expect((await runUninstall(fixture.context, ACCEPTED)).ok).toBe(true);
    const plantable: string[] = [];
    for (const row of attributableFiles) {
      if (!await exists(row.path) && await exists(dirname(row.path))) plantable.push(row.path);
    }
    expect(plantable.length).toBeGreaterThan(0);

    const uninstalled = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    expect(uninstalled.report.ids[0]).toMatchObject({ status: "verified", terminalOutcome: "finalized" });
    expect(uninstalled.blocksNewIntent).toBe(false);

    const inactiveSlot = plan.journalSlots[inactive];
    if (inactiveSlot === undefined) throw new Error("persisted plan has no inactive journal slot");
    await nodeFs.truncate(inactiveSlot.path, 0);

    const partial = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(partial.report.ids[0]).toMatchObject({ status: "verified", terminalOutcome: "finalized" });
    expect(partial.blocksNewIntent).toBe(false);
    await expect(assertOrdinaryCommandAdmitted(requestFor(fixture))).resolves.toBeUndefined();

    for (const slot of plan.journalSlots) await nodeFs.truncate(slot.path, 0);

    const slotless = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(slotless.report.ids[0]).toMatchObject({ status: "unverified", terminalOutcome: null });
    expect(slotless.active).toBeNull();
    expect(slotless.blocksNewIntent).toBe(false);
    await expect(assertOrdinaryCommandAdmitted(requestFor(fixture))).resolves.toBeUndefined();

    const planted = plantable[0] as string;
    await nodeFs.writeFile(planted, "synthetic live residue\n", { mode: 0o600 });

    const withLiveTarget = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(withLiveTarget.active).toBeNull();
    expect(withLiveTarget.blocksNewIntent).toBe(true);
    const refusal: unknown = await assertOrdinaryCommandAdmitted(requestFor(fixture))
      .then(() => null, (error: unknown) => error);
    expect(refusal).toMatchObject({ code: EXIT_CODES.recoveryRequired, message: BOOTSTRAP_MANUAL_ARCHIVE });
    expect(refusal).not.toMatchObject({ recovery: "developer-os init" });

    await nodeFs.rm(planted);
    await restoreSlots();
    const currentSlotPath = (plan.journalSlots[current] as { readonly path: string }).path;
    const journalText = await nodeFs.readFile(currentSlotPath, "utf8");
    const cursor = /"retentionNext":(\d+)/u.exec(journalText);
    if (cursor?.[1] === undefined) throw new Error("retained journal carries no retention cursor");
    const beyondTable = journalText.replace(
      `"retentionNext":${cursor[1]}`,
      `"retentionNext":${String(Number(cursor[1]) + 1)}`,
    );
    expect(beyondTable).not.toBe(journalText);
    await nodeFs.truncate(inactiveSlot.path, 0);
    await nodeFs.writeFile(currentSlotPath, beyondTable);

    const outOfTableCursor = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(outOfTableCursor.report.ids[0]?.status).not.toBe("verified");
    expect(outOfTableCursor.retainedEnvelopes).toStrictEqual([]);
    expect(outOfTableCursor.retainedParentAuthorities).toStrictEqual([]);

    await restoreSlots();
    await nodeFs.writeFile(inactiveSlot.path, slotBytes[current] as Buffer);
    await nodeFs.truncate(currentSlotPath, 0);

    const misplacedSlot = await inspectBootstrapEvidenceAdmission(requestFor(fixture));

    expect(misplacedSlot.report.ids[0]?.status).not.toBe("verified");
    expect(misplacedSlot.retainedEnvelopes).toStrictEqual([]);
    expect(misplacedSlot.retainedParentAuthorities).toStrictEqual([]);

    await restoreSlots();
    const restored = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
    expect(restored.report.ids[0]).toMatchObject({ status: "verified", terminalOutcome: "finalized" });
    expect(restored.retainedEnvelopes).toHaveLength(1);
    expect(restored.retainedParentAuthorities.length).toBeGreaterThan(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
