import { linkSync, lstatSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveBootstrapRetentionAuthorities, deriveBootstrapRetentionLocations, deriveBootstrapTerminalJournal, encodeCanonicalJson, EXIT_CODES } from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";
import { MacOsTransactionLockProvider } from "@developer-os/platform-macos";

import { runDoctorReport } from "../commands/doctor.js";
import { runInit } from "../commands/init.js";
import { runUninstall } from "../commands/uninstall.js";
import { redactionKeyPath } from "../context.js";
import { admitInstalledV2Home } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../lifecycle/context.js";
import { gateManifestAdmission } from "../lifecycle/mutation-gate.js";
import { createCommandFixture, exists, inventory, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import {
  BootstrapExecutor,
  freshInitDeathPoints,
  freshInitFineGrainedDeathPoints,
  preexistingParentShapeAdmits,
} from "./executor.js";
import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import { inspectBootstrapEvidenceAdmission } from "./report.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const REAL_FILESYSTEM_DEATH_MATRIX_TIMEOUT_MS = 600_000;
/** Reached only by compensation, so the sweep injects a forward failure first and expects a rollback. */
const COMPENSATION_DEATH_POINTS = new Set([
  "after_publish_intent_resolved",
  "after_compensation_staged_file",
  "after_compensation_evidence",
  "after_rolled_back",
]);
/** Reached only after a forward failure, and before compensation writes anything, so forward resumes. */
const FAILED_FORWARD_DEATH_POINTS = new Set(["before_compensation", ...COMPENSATION_DEATH_POINTS]);
const PRE_PLAN_DEATH_POINTS = new Set([
  "after_slot_0_create",
  "after_slot_0_sync",
  "after_slot_1_create",
  "after_slot_1_sync",
  "during_plan_write",
]);

type JsonRecord = Record<string, unknown>;

async function persistedPlan(fixture: CommandFixture): Promise<{
  readonly path: string;
  readonly value: JsonRecord;
}> {
  const candidates: Array<{ readonly path: string; readonly value: JsonRecord }> = [];
  for (const name of await nodeFs.readdir(fixture.paths.stateDir)) {
    if (!name.endsWith(".plan.json")) continue;
    const path = join(fixture.paths.stateDir, name);
    try {
      const value = JSON.parse(await nodeFs.readFile(path, "utf8")) as JsonRecord;
      if (value.operation === "fresh_v2_init" && typeof value.id === "string") {
        candidates.push({ path, value });
      }
    } catch {
      // An immutable-plan boundary death leaves an inert, noncanonical prefix.
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`fixture has ${String(candidates.length)} durable bootstrap plans`);
  }
  return candidates[0] as { readonly path: string; readonly value: JsonRecord };
}

async function slotJournals(plan: JsonRecord): Promise<readonly JsonRecord[]> {
  if (!Array.isArray(plan.journalSlots) || plan.journalSlots.length !== 2) {
    throw new Error("persisted plan has no exact two-slot journal");
  }
  return Promise.all(plan.journalSlots.map(async (candidate, expectedSlot) => {
    const slot = candidate as JsonRecord;
    expect(slot.slot).toBe(expectedSlot);
    const path = String(slot.path);
    const stats = await nodeFs.lstat(path, { bigint: true });
    expect(stats.dev.toString(10)).toBe(slot.dev);
    expect(stats.ino.toString(10)).toBe(slot.ino);
    return JSON.parse(await nodeFs.readFile(path, "utf8")) as JsonRecord;
  }));
}

async function currentJournal(plan: JsonRecord): Promise<JsonRecord> {
  const journals = (await slotJournals(plan)).filter((candidate) =>
    typeof candidate.sequence === "string",
  );
  const current = journals.toSorted((left, right) =>
    BigInt(String(left.sequence)) < BigInt(String(right.sequence)) ? 1 : -1,
  )[0];
  if (current === undefined) throw new Error("journal slots contain no current record");
  return current;
}

/** A persisted identity is `UInt64DecimalV1` text; coercing whatever is there would hide a schema break. */
function decimalText(value: unknown): string {
  if (typeof value !== "string") throw new Error("persisted identity is not decimal text");
  return value;
}

async function findIdentity(
  root: string,
  expectedDev: string,
  expectedIno: string,
): Promise<string | null> {
  for (const relativePath of await inventory(root)) {
    const path = join(root, relativePath);
    const stats = await nodeFs.lstat(path, { bigint: true });
    if (stats.dev.toString(10) === expectedDev && stats.ino.toString(10) === expectedIno) return path;
  }
  return null;
}

function participant(plan: JsonRecord, role: "forward" | "compensation"): JsonRecord {
  if (!Array.isArray(plan.foundationParticipants)) {
    throw new Error("persisted plan has no Foundation participants");
  }
  const found = (plan.foundationParticipants as JsonRecord[]).find((candidate) =>
    (candidate.role as JsonRecord | undefined)?.kind === role,
  );
  if (found === undefined) throw new Error(`persisted plan has no ${role} Foundation participant`);
  return found;
}

async function closeBootstrapProcess(fixture: CommandFixture): Promise<void> {
  await closeBootstrapContext(fixture.context);
}

async function closeBootstrapContext(context: CommandFixture["context"]): Promise<void> {
  const bootstrap = context.bootstrap;
  if (bootstrap?.state === "available") await bootstrap.executor.close();
}

describe("BootstrapExecutor retained fresh V2 initialization", () => {
  it("creates every A12 bookkeeping root so a fresh home's lifecycle ledger is clear", async () => {
    const fixture = await createCommandFixture("bootstrap-fresh-ledger-clear", { bootstrapAvailable: true });
    const result = await runInit(fixture.context, ACCEPTED);
    if (!result.ok) throw new Error(JSON.stringify(result));
    await closeBootstrapProcess(fixture);

    const lifecycleStaging = await nodeFs.lstat(join(fixture.paths.stagingDir, "lifecycle"));
    expect(lifecycleStaging.isDirectory()).toBe(true);
    expect(lifecycleStaging.mode & 0o7777).toBe(0o700);
    expect(lifecycleStaging.uid).toBe(process.getuid?.());

    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("fixture supplied no lifecycle ports");
    const { paths } = fixture.context;
    const admitted = await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths,
      manifestAdmission: gateManifestAdmission(fixture.context),
      effectiveUid: lifecycle.effectiveUid,
    });
    const residue = residueFrom(await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: paths.home,
      stateDirectory: paths.stateDir,
      initialRoots: [paths.home, paths.stateDir, fixture.context.userHome],
    })));
    const ledger = await lifecycle.inspectLedger(lifecycleHomeKeyFromAdmission(admitted, paths), residue);
    expect(ledger.closure.kind).toBe("clear");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("publishes a complete V2 handoff and permanently retains its exact plan and two slots", async () => {
    const fixture = await createCommandFixture("bootstrap-retained-complete", {
      bootstrapAvailable: true,
    });
    const bootstrap = fixture.context.bootstrap;
    expect(bootstrap?.state).toBe("available");
    if (bootstrap?.state !== "available") return;
    expect(bootstrap.executor).toBeInstanceOf(BootstrapExecutor);

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(result.data.schemaVersion).toBe(2);
    const persisted = await persistedPlan(fixture);
    expect(await slotJournals(persisted.value)).toHaveLength(2);
    expect(await currentJournal(persisted.value)).toMatchObject({
      phase: "retained",
      terminalOutcome: "finalized",
    });
    expect(await exists(persisted.path)).toBe(true);

    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      schemaVersion: number;
      artifacts: Array<{ path: string }>;
    };
    const paths = manifest.artifacts.map((artifact) => artifact.path);
    expect(manifest.schemaVersion).toBe(2);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(expect.arrayContaining([
      fixture.paths.configFile,
      join(fixture.paths.stateDir, "active-release.json"),
      join(fixture.paths.stateDir, "release-trust.json"),
    ]));
    expect(await exists(fixture.paths.stagingDir)).toBe(true);
    expect(fixture.vendorProcesses).toStrictEqual([]);

    const trace = fixture.bootstrapTrace;
    const index = (prefix: string): number => trace.findIndex((row) => row.startsWith(prefix));
    expect(index("lock:bootstrap")).toBeLessThan(index("inventory:second"));
    expect(index("inventory:second")).toBeLessThan(index("intent:plan"));
    expect(index("intent:journal")).toBeLessThan(index("payload:evidence:"));
    expect(index("payload:evidence:")).toBeLessThan(index("create:global_lock"));
    expect(index("payload:evidence:")).toBeLessThan(index("foundation:forward:"));
    // NEW-179 B-6: a finalized init never runs, traces or publishes the compensation participant.
    expect(trace.some((row) => row.startsWith("foundation:compensation:"))).toBe(false);
    const compensationJournal = participant(persisted.value, "compensation").initialJournal as JsonRecord;
    expect(await exists(String(compensationJournal.finalPath))).toBe(false);
    expect(index("launchability:trust")).toBeLessThan(index("launchability:active"));
    expect(index("launchability:active")).toBeLessThan(index("manifest:publish"));
    expect(index("manifest:publish")).toBeLessThan(index("verify:v2"));
    expect(fixture.lifecycleLockEvents.slice(-2).map((event) =>
      event.replace(fixture.paths.stateDir, "<state>"),
    )).toStrictEqual([
      "release:<state>/.lifecycle-bootstrap.lock",
      "release:<state>/.lifecycle.lock",
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("inspects bootstrap evidence exactly three times for a fresh, uninterrupted init", async () => {
    const fixture = await createCommandFixture("bootstrap-evidence-inspection-count", {
      bootstrapAvailable: true,
    });

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    /**
     * One inspection at `init.ts`'s entry (the source of truth threaded down
     * through `previewFreshInit`, `initializeFresh` and `planFreshInit`), one
     * at `evidenceAfterLock` (observes drift since the bootstrap lock was
     * acquired), and one from `admittedFoundation` (observes drift right
     * before Foundation files are mutated). Anything above 3 means a site
     * that should be reusing the threaded value is re-walking the filesystem.
     */
    expect(fixture.bootstrapEvidenceInspections).toBe(3);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps a fresh dry-run byte inert while returning the complete V2 preview", async () => {
    const fixture = await createCommandFixture("bootstrap-dry-run", {
      bootstrapAvailable: true,
    });
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, { dryRun: true, assumeYes: true });

    expect(result.ok && result.data.schemaVersion).toBe(2);
    expect(result.ok && result.data.created).toContain(
      join(fixture.paths.stateDir, "active-release.json"),
    );
    expect(await inventory(fixture.root)).toStrictEqual(before);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a second-inventory child race before publishing any retained intent", async () => {
    let inserted = false;
    const fixture = await createCommandFixture("bootstrap-second-inventory-race", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
      bootstrapBeforeLockAcquire: async (path) => {
        if (inserted || !path.endsWith("/.lifecycle-bootstrap.lock")) return;
        inserted = true;
        await nodeFs.writeFile(join(dirname(path), "concurrent-child"), "third state\n", {
          mode: 0o600,
        });
      },
    });

    const refused = await runInit(fixture.context, ACCEPTED);

    expect(inserted).toBe(true);
    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(join(fixture.paths.stateDir, "concurrent-child"), "utf8"))
      .toBe("third state\n");
    expect((await nodeFs.readdir(fixture.paths.stateDir)).some((name) =>
      name.endsWith(".plan.json") || name.includes(".journal."),
    )).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a concurrently held bootstrap lock before publishing intent", async () => {
    const fixture = await createCommandFixture("bootstrap-real-lock-contention", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
    });
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    const lockPath = join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock");
    const concurrent = await new MacOsTransactionLockProvider().acquire(lockPath);
    try {
      expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
      expect((await nodeFs.readdir(fixture.paths.stateDir)).some((name) =>
        name.endsWith(".plan.json") || name.includes(".journal."),
      )).toBe(false);
    } finally {
      await concurrent.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(freshInitDeathPoints)("recovers retained bootstrap death at $name", async ({ name }) => {
    const fixture = await createCommandFixture(`bootstrap-death-${name}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: name,
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(!interrupted.ok && interrupted.code).toBe(EXIT_CODES.recoveryRequired);

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ name, resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
    expect(await currentJournal((await persistedPlan(fixture)).value)).toMatchObject({ phase: "retained" });
  }, REAL_FILESYSTEM_DEATH_MATRIX_TIMEOUT_MS);

  it("refuses a post-plan inventory child without initializing either journal slot", async () => {
    const fixture = await createCommandFixture("bootstrap-post-plan-child", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const slotPaths = (plan.journalSlots as JsonRecord[]).map((slot) => String(slot.path));
    const marker = join(fixture.paths.stateDir, "post-plan-third-state");
    await nodeFs.writeFile(marker, "unadmitted\n", { mode: 0o600 });

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.message).toContain("post-plan inventory");
    expect(await Promise.all(slotPaths.map((path) => nodeFs.readFile(path))))
      .toEqual([Buffer.alloc(0), Buffer.alloc(0)]);
    expect(await nodeFs.readFile(marker, "utf8")).toBe("unadmitted\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a post-plan global lock whose identity is not the one the plan admitted", async () => {
    const fixture = await createCommandFixture("bootstrap-post-plan-global-lock-swap", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_global_lock",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    await closeBootstrapProcess(fixture);
    const planNames = async (): Promise<string[]> =>
      (await nodeFs.readdir(fixture.paths.stateDir)).filter((name) => name.endsWith(".plan.json"));
    const rolledBackPlans = await planNames();
    fixture.disableBootstrapFailure();
    fixture.setBootstrapInterrupt("after_plan");
    const planning = fixture.rebuildContext();
    expect((await runInit(planning, ACCEPTED)).ok).toBe(false);
    await closeBootstrapContext(planning);
    const published = (await planNames()).filter((name) => !rolledBackPlans.includes(name));
    expect(published).toHaveLength(1);
    const plan = JSON.parse(
      await nodeFs.readFile(join(fixture.paths.stateDir, published[0] as string), "utf8"),
    ) as JsonRecord;
    const slotPaths = (plan.journalSlots as JsonRecord[]).map((slot) => String(slot.path));
    const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
    const admitted = (plan.admittedPreexistingPaths as JsonRecord[]).find((entry) => entry.path === lock);
    if (admitted === undefined) throw new Error("second plan did not admit the rolled-back global lock");
    const replacement = `${lock}.replacement`;
    await nodeFs.writeFile(replacement, new Uint8Array(), { mode: 0o600 });
    await nodeFs.rename(replacement, lock);
    expect((await nodeFs.lstat(lock, { bigint: true })).ino.toString(10)).not.toBe(decimalText(admitted.ino));

    fixture.disableBootstrapInterrupt();
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.message).toContain("post-plan inventory");
    expect(await Promise.all(slotPaths.map((path) => nodeFs.readFile(path))))
      .toEqual([Buffer.alloc(0), Buffer.alloc(0)]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an equal-empty replacement slot after plan publication without writing it", async () => {
    const fixture = await createCommandFixture("bootstrap-post-plan-slot-replacement", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const slot = String((plan.journalSlots as JsonRecord[])[0]?.path);
    const original = `${slot}.original`;
    await nodeFs.rename(slot, original);
    await nodeFs.writeFile(slot, new Uint8Array(), { mode: 0o600, flag: "wx" });

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(slot)).toHaveLength(0);
    expect(await nodeFs.readFile(original)).toHaveLength(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an unmatched post-terminal staging child before any retained rename", async () => {
    const fixture = await createCommandFixture("bootstrap-retention-unmatched-child", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_verify",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const stagingRoot = String(plan.stagingRoot);
    const marker = join(stagingRoot, "unmatched-third-state");
    await nodeFs.writeFile(marker, "unadmitted post-terminal child\n", { mode: 0o600 });
    const renameCount = fixture.bootstrapRenameRequests.length;

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(fixture.bootstrapRenameRequests).toHaveLength(renameCount);
    expect(await nodeFs.readFile(marker, "utf8")).toBe("unadmitted post-terminal child\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a substituted plan-bound staging parent before any retained rename", async () => {
    const fixture = await createCommandFixture("bootstrap-retention-parent-substitution", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_verify",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const stagingRoot = String(plan.stagingRoot);
    const stagingParent = dirname(stagingRoot);
    const movedParent = `${stagingParent}.original`;
    const rootIdentity = await nodeFs.lstat(stagingRoot, { bigint: true });
    await nodeFs.rename(stagingParent, movedParent);
    await nodeFs.mkdir(stagingParent, { mode: 0o700 });
    await nodeFs.rename(join(movedParent, basename(stagingRoot)), stagingRoot);
    const renameCount = fixture.bootstrapRenameRequests.length;

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(fixture.bootstrapRenameRequests).toHaveLength(renameCount);
    const retainedRoot = await nodeFs.lstat(stagingRoot, { bigint: true });
    expect([retainedRoot.dev.toString(10), retainedRoot.ino.toString(10)]).toStrictEqual([
      rootIdentity.dev.toString(10),
      rootIdentity.ino.toString(10),
    ]);
    expect((await nodeFs.lstat(movedParent, { bigint: true })).isDirectory()).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(freshInitFineGrainedDeathPoints)(
    "fresh-process recovers exact terminal evidence at fine-grained death $name",
    async ({ name }) => {
      const fixture = await createCommandFixture(`bootstrap-fine-${name}`, {
        bootstrapAvailable: true,
        bootstrapInterruptAfter: name,
        // NEW-189: only a step that fails again while compensation finishes it leaves an intent to resolve.
        ...(name === "after_publish_intent_resolved"
          ? { interruptAfter: "applied", interruptKind: "fresh_init_artifacts" }
          : FAILED_FORWARD_DEATH_POINTS.has(name)
            ? { bootstrapFailureAfter: "during_payload_write" as const }
            : {}),
      });
      const interrupted = await runInit(fixture.context, ACCEPTED);

      expect(interrupted.ok).toBe(false);
      expect(fixture.vendorProcesses).toStrictEqual([]);
      expect((await inventory(fixture.root)).length).toBeGreaterThan(0);

      const unverifiedBefore = PRE_PLAN_DEATH_POINTS.has(name)
        ? await Promise.all((await nodeFs.readdir(fixture.paths.stateDir))
            .filter((candidate) => candidate.startsWith("fresh-v2-init."))
            .map(async (candidate) => {
              const path = join(fixture.paths.stateDir, candidate);
              const stats = await nodeFs.lstat(path, { bigint: true });
              return {
                path,
                bytes: await nodeFs.readFile(path),
                dev: stats.dev,
                ino: stats.ino,
              };
            }))
        : [];
      const unverifiedIds = new Set(unverifiedBefore.map(({ path }) =>
        /^fresh-v2-init\.(fi_[^.]+)\./u.exec(basename(path))?.[1],
      ));

      let authorityPlan: { readonly path: string; readonly value: JsonRecord } | null = null;
      try {
        authorityPlan = await persistedPlan(fixture);
      } catch {
        // Pre-plan death points are required to recover from the exact partial envelope.
      }
      const retainedIdentities: Array<{ readonly dev: string; readonly ino: string }> = [];
      if (authorityPlan !== null) {
        const bootstrapIdentity = authorityPlan.value.bootstrapIdentity as JsonRecord | undefined;
        const bootstrapPath = typeof bootstrapIdentity?.path === "string" ? bootstrapIdentity.path : "";
        const authorityPaths = [
          authorityPlan.path,
          ...((authorityPlan.value.journalSlots as JsonRecord[] | undefined) ?? [])
            .map((slot) => String(slot.path)),
          bootstrapPath,
        ].filter((path) => path.length > 0);
        for (const path of authorityPaths) {
          if (!await exists(path)) continue;
          const stats = await nodeFs.lstat(path, { bigint: true });
          retainedIdentities.push({ dev: stats.dev.toString(10), ino: stats.ino.toString(10) });
        }
      }

      if (authorityPlan !== null && COMPENSATION_DEATH_POINTS.has(name)) {
        // The death fired inside the rollback, so it is not yet retained.
        expect(await currentJournal(authorityPlan.value)).not.toMatchObject({ phase: "retained" });
      }
      fixture.disableBootstrapInterrupt();
      fixture.disableBootstrapFailure();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      const persisted = await persistedPlan(fixture);
      const terminal = await currentJournal(persisted.value);

      if (COMPENSATION_DEATH_POINTS.has(name)) {
        expect(resumed.ok).toBe(false);
        expect(resumed.ok ? 0 : resumed.code).toBe(EXIT_CODES.recoveryRequired);
        expect(terminal).toMatchObject({ phase: "retained", terminalOutcome: "rolled_back" });
      } else {
        if (!resumed.ok) throw new Error(JSON.stringify({ name, resumed, trace: fixture.bootstrapTrace.slice(-30) }));
        expect(terminal).toMatchObject({ phase: "retained", terminalOutcome: "finalized" });
      }
      expect(fixture.transactionUnlinkRequests).toStrictEqual([]);
      await expect(slotJournals(persisted.value)).resolves.toHaveLength(2);
      if (PRE_PLAN_DEATH_POINTS.has(name)) {
        expect(unverifiedIds.has(String(persisted.value.id))).toBe(false);
        for (const before of unverifiedBefore) {
          const after = await nodeFs.lstat(before.path, { bigint: true });
          expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
          expect(await nodeFs.readFile(before.path)).toEqual(before.bytes);
        }
      }
      const retainedIdentityKeys = new Set<string>();
      for (const relativePath of await inventory(fixture.root)) {
        const stats = await nodeFs.lstat(join(fixture.root, relativePath), { bigint: true });
        retainedIdentityKeys.add(`${stats.dev.toString(10)}:${stats.ino.toString(10)}`);
      }
      for (const identity of retainedIdentities) {
        expect(retainedIdentityKeys.has(`${identity.dev}:${identity.ino}`)).toBe(true);
      }
    },
    REAL_FILESYSTEM_DEATH_MATRIX_TIMEOUT_MS,
  );

  it("recovers a fresh process after a retained row was renamed but before its cursor advanced", async () => {
    const fixture = await createCommandFixture("bootstrap-retention-post-rename", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_rename",
    });
    const failed = await runInit(fixture.context, ACCEPTED);
    expect(failed.ok).toBe(false);

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(await currentJournal((await persistedPlan(fixture)).value)).toMatchObject({
      phase: "retained",
      terminalOutcome: "finalized",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reopens the exact retained bootstrap-lock inode after its rename and before its cursor", async () => {
    const fixture = await createCommandFixture("bootstrap-lock-retention-reopen", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "during_retention",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const persisted = await persistedPlan(fixture);
    const terminal = await currentJournal(persisted.value);
    const locations = deriveBootstrapRetentionLocations(persisted.value as never, terminal);
    const lockLocation = locations.find((location) => location.role === "bootstrap_lock");
    if (lockLocation === undefined) throw new Error("retained table has no bootstrap-lock row");
    const bootstrapIdentity = persisted.value.bootstrapIdentity as JsonRecord;

    fixture.setBootstrapInterrupt("after_rename", locations.length);
    await closeBootstrapProcess(fixture);
    const retainingContext = fixture.rebuildContext();
    expect((await runInit(retainingContext, ACCEPTED)).ok).toBe(false);
    expect(await exists(String(bootstrapIdentity.path))).toBe(false);
    const retainedLock = await nodeFs.lstat(lockLocation.tombstonePath, { bigint: true });
    expect(retainedLock.dev.toString(10)).toBe(bootstrapIdentity.dev);
    expect(retainedLock.ino.toString(10)).toBe(bootstrapIdentity.ino);

    fixture.disableBootstrapInterrupt();
    await closeBootstrapContext(retainingContext);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(await currentJournal(persisted.value)).toMatchObject({ phase: "retained" });
  }, 600_000);

  it("does not admit an equal-byte Foundation source replacement without persisted identity", async () => {
    const fixture = await createCommandFixture("bootstrap-foundation-third-state", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_created_paths",
    });
    const failed = await runInit(fixture.context, ACCEPTED);
    expect(failed.ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const initial = participant(plan, "forward").initialJournal as JsonRecord;
    const staged = initial.staged as JsonRecord;
    const path = String(staged.path);
    const bytes = await nodeFs.readFile(path);
    const original = join(fixture.root, "admitted-foundation-original");
    await nodeFs.rename(path, original);
    await nodeFs.writeFile(path, bytes, { mode: 0o600 });
    const replacement = await nodeFs.lstat(path, { bigint: true });
    expect(replacement.ino.toString(10)).not.toBe(staged.ino);

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const refused = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(refused.ok).toBe(false);
    expect(await nodeFs.readFile(path)).toStrictEqual(bytes);
    expect((await nodeFs.lstat(path, { bigint: true })).ino).toBe(replacement.ino);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("force-forwards from durable payload evidence after the package disappears", async () => {
    const fixture = await createCommandFixture("bootstrap-source-independent", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_payloads",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    await nodeFs.rename(
      join(fixture.root, "packaged-release"),
      join(fixture.root, "packaged-release.offline"),
    );

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("retains rollback evidence and preserves an interrupted writing inode identity", async () => {
    const fixture = await createCommandFixture("bootstrap-writing-rollback", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "during_payload_write",
    });

    const failed = await runInit(fixture.context, ACCEPTED);
    expect(failed.ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    const journal = await currentJournal(plan);
    expect(journal, JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({ phase: "retained", terminalOutcome: "rolled_back" });
    const writing = journal.payloadWriteState as JsonRecord;
    expect(writing.state).toBe("writing");
    const retainedPath = await findIdentity(fixture.root, decimalText(writing.dev), decimalText(writing.ino));
    expect(retainedPath).not.toBeNull();
    expect(retainedPath).toContain(`.developer-os-retained.${String(plan.id)}.`);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-166: a failure after the payload create intent, before the writing
   * intent, compensates through the grammar's `create_intent` branch: an
   * absent inode goes idle, an empty created inode becomes `writing` and is
   * retained by its identity, also after a death inside that compensation.
   */
  it.each([
    { failure: "after_payload_create_intent", death: null, retainsInode: false },
    { failure: "after_payload_empty_create", death: null, retainsInode: true },
    { failure: "after_payload_empty_create", death: "after_compensation_staged_file", retainsInode: true },
  ] as const)("rolls back a payload create intent failing $failure (death $death)", async ({ failure, death, retainsInode }) => {
    const fixture = await createCommandFixture(`bootstrap-create-intent-${failure}-${String(death)}`, {
      bootstrapAvailable: true,
      bootstrapFailureAfter: failure,
      ...(death === null ? {} : { bootstrapInterruptAfter: death }),
    });

    const failed = await runInit(fixture.context, ACCEPTED);
    expect(failed.ok).toBe(false);
    if (death !== null) {
      fixture.disableBootstrapFailure();
      fixture.disableBootstrapInterrupt();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      expect(resumed.ok ? 0 : resumed.code).toBe(EXIT_CODES.recoveryRequired);
    } else if (!failed.ok) {
      expect(failed.error.message).toContain(`synthetic bootstrap failure at ${failure}`);
    }
    const plan = (await persistedPlan(fixture)).value;
    const journal = await currentJournal(plan);
    expect(journal, JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({ phase: "retained", terminalOutcome: "rolled_back", compensationNext: -1 });
    const writing = journal.payloadWriteState as JsonRecord;
    expect(writing.state).toBe(retainsInode ? "writing" : "idle");
    if (retainsInode) {
      const retainedPath = await findIdentity(fixture.root, decimalText(writing.dev), decimalText(writing.ino));
      expect(retainedPath).toContain(`.developer-os-retained.${String(plan.id)}.`);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-167: a failure after a created file's publication rename but before its
   * cursor advance. Compensation first finishes that step, so the payload is
   * retained where it really is; a death during that finish resumes forward.
   */
  it.each([false, true])("rolls back a failure after a forward rename (death during settle: %s)", async (die) => {
    let renamed: { readonly dev: string; readonly ino: string } | null = null;
    const fixture: CommandFixture = await createCommandFixture(`bootstrap-after-forward-rename-${String(die)}`, {
      bootstrapAvailable: true,
      bootstrapFailureHook: (point) => {
        if (point !== "after_forward_rename" || renamed !== null) return;
        const planName = readdirSync(fixture.paths.stateDir).find((name) => name.endsWith(".plan.json"));
        const plan = JSON.parse(readFileSync(join(fixture.paths.stateDir, String(planName)), "utf8")) as {
          readonly createdPaths: readonly { readonly kind: string; readonly path: string }[];
        };
        const published = plan.createdPaths.find((row) => row.kind === "file");
        const stats = lstatSync(String(published?.path), { bigint: true });
        renamed = { dev: stats.dev.toString(10), ino: stats.ino.toString(10) };
        if (die) fixture.setBootstrapInterrupt("after_creation_evidence");
        throw new Error("synthetic bootstrap failure at after_forward_rename");
      },
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through an injected failure");
    const persisted = await persistedPlan(fixture);
    if (die) {
      fixture.disableBootstrapFailure();
      fixture.disableBootstrapInterrupt();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
      expect(await currentJournal(persisted.value)).toMatchObject({ phase: "retained", terminalOutcome: "finalized" });
      return;
    }
    expect(failed.error.message).toContain("synthetic bootstrap failure at after_forward_rename");
    expect(await currentJournal(persisted.value), JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({ phase: "retained", terminalOutcome: "rolled_back", compensationNext: -1 });
    const identity = renamed as { readonly dev: string; readonly ino: string } | null;
    if (identity === null) throw new Error("no forward rename was observed");
    expect(await findIdentity(fixture.root, identity.dev, identity.ino))
      .toContain(`.developer-os-retained.${String(persisted.value.id)}.`);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-167 (Foundation half) and NEW-174: a failure inside the forward
   * Foundation participant after its journal was published. Compensation
   * finishes that participant and then runs its compensation participant; a
   * death before compensation leaves a non-terminal `tx_fi_` journal that
   * `init`, not `repair`, resumes on its original inode.
   */
  it.each([false, true])("recovers a failure inside the forward Foundation participant (death before compensation: %s)", async (die) => {
    const fixture = await createCommandFixture(`bootstrap-foundation-forward-failure-${String(die)}`, {
      bootstrapAvailable: true,
      interruptAfter: "applied",
      interruptKind: "fresh_init_artifacts",
      interruptOnce: true,
      ...(die ? { bootstrapInterruptAfter: "before_compensation" as const } : {}),
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    expect(failed.ok).toBe(false);
    const persisted = await persistedPlan(fixture);
    const forward = participant(persisted.value, "forward");
    const forwardJournal = String((forward.initialJournal as JsonRecord).finalPath);
    if (die) {
      const before = await nodeFs.lstat(forwardJournal, { bigint: true });
      expect(JSON.parse(await nodeFs.readFile(forwardJournal, "utf8"))).toMatchObject({ phase: "applied" });
      fixture.disableBootstrapInterrupt();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
      expect(await currentJournal(persisted.value)).toMatchObject({ phase: "retained", terminalOutcome: "finalized" });
      const after = await findIdentity(fixture.root, before.dev.toString(10), before.ino.toString(10));
      expect(after).not.toBeNull();
      return;
    }
    expect(await currentJournal(persisted.value), JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({
        phase: "retained",
        terminalOutcome: "rolled_back",
        nextFoundationParticipant: 1,
        compensationNext: -1,
      });
    expect(fixture.bootstrapTrace).toContain(`foundation:compensation:apply:${String(participant(persisted.value, "compensation").id)}`);
    expect(fixture.transactionUnlinkRequests).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-189 (D87): the forward Foundation participant fails again while
   * compensation tries to finish it. Its publish intent resolves to
   * `published` by identity, so the install still reaches a retained
   * rollback instead of staying in `compensating` (NEW-167's old limitation).
   */
  it("rolls back and retains when the forward Foundation participant fails again", async () => {
    const fixture = await createCommandFixture("bootstrap-foundation-forward-failure-recurs", {
      bootstrapAvailable: true,
      interruptAfter: "applied",
      interruptKind: "fresh_init_artifacts",
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through a recurring Foundation failure");
    expect(failed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(failed.error.message).toContain("synthetic interruption after applied; finishing the interrupted step also failed");
    const persisted = await persistedPlan(fixture);
    const forward = participant(persisted.value, "forward");
    const mutations = forward.mutations as JsonRecord[];
    const terminal = await currentJournal(persisted.value);
    expect(terminal, JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) })).toMatchObject({
      phase: "retained",
      terminalOutcome: "rolled_back",
      nextFoundationParticipant: 0,
      compensationNext: -1,
      publishIntent: { scope: "foundation", ordinal: 0, published: mutations.length },
    });
    const finalPath = String((forward.initialJournal as JsonRecord).finalPath);
    expect(await exists(finalPath)).toBe(false);
    for (const mutation of mutations) expect(await exists(String(mutation.stagedPath))).toBe(false);
    expect(fixture.bootstrapTrace.some((row) => row.startsWith("foundation:compensation:apply:"))).toBe(false);
    expect(fixture.transactionUnlinkRequests).toStrictEqual([]);
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.report.ids.map((summary) => summary.status)).toStrictEqual(["verified"]);
    await closeBootstrapProcess(fixture);

    const retried = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(retried.ok ? 0 : retried.code).toBe(EXIT_CODES.recoveryRequired);
    expect(await currentJournal(persisted.value)).toStrictEqual(terminal);
    await closeBootstrapProcess(fixture);
    const report = await runDoctorReport(fixture.rebuildContext());
    // The non-terminal forward journal was retained with its directory, so no transaction is left for repair or init.
    expect(report.checks.find((check) => check.id === "transactions")).toMatchObject({ status: "pass" });

    // Nothing wedges: uninstall and a fresh init beside the retained ID each finish or refuse cleanly.
    await closeBootstrapProcess(fixture);
    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    await closeBootstrapProcess(fixture);
    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);
    // Both refuse with the manual-archive route a post-Foundation rollback already takes, and change no journal.
    if (removed.ok || reinstalled.ok) throw new Error(JSON.stringify({ removed, reinstalled }));
    expect(removed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(removed.error.recovery).toBe("archive the product home manually, then developer-os init");
    expect(reinstalled.code).toBe(EXIT_CODES.recoveryRequired);
    expect(reinstalled.error.message).toContain("retained bootstrap evidence requires manual archive before a new bootstrap intent");
    // The recovery names the real paths to move: the product home and its retained siblings, dated, then init.
    const home = fixture.paths.home;
    const date = fixture.context.now().toISOString().slice(0, 10);
    const siblings = readdirSync(dirname(home))
      .filter((name) => name.startsWith(`.developer-os-retained.${String(persisted.value.id)}.`))
      .map((name) => join(dirname(home), name))
      .toSorted();
    expect(siblings.length).toBeGreaterThan(0);
    const archive = [...[home, ...siblings].map((path) => `mv ${path} ${path}.archived-${date}`), "developer-os init"].join(", then ");
    // Published through the CLI's diagnostic redaction, which masks this fixture's random temp segment (NEW-39).
    expect(reinstalled.error.recovery).toBe(fixture.context.guards.redactDiagnostic(archive));
    await closeBootstrapProcess(fixture);
    const archivedReport = await runDoctorReport(fixture.rebuildContext());
    expect(archivedReport.checks.find((check) => check.id === `bootstrap-evidence:${String(persisted.value.id)}`))
      .toMatchObject({ status: "warn" });
    expect([archive, fixture.context.guards.redactDiagnostic(archive)]).toContain(
      archivedReport.checks.find((check) => check.id === `bootstrap-evidence:${String(persisted.value.id)}`)?.recovery,
    );
    expect(await currentJournal(persisted.value)).toStrictEqual(terminal);
    expect(readdirSync(fixture.paths.stateDir).filter((name) => name.endsWith(".plan.json"))).toHaveLength(1);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-189 (D87): a created file renamed to its planned path whose step fails
   * again while compensation tries to finish it. The resolved intent retains
   * the payload where it is, also after a death right after the resolution.
   */
  it.each([false, true])("rolls back a created file whose publication fails again (death after resolution: %s)", async (die) => {
    let renamed: { readonly dev: string; readonly ino: string } | null = null;
    const fixture: CommandFixture = await createCommandFixture(`bootstrap-created-file-recurs-${String(die)}`, {
      bootstrapAvailable: true,
      ...(die ? { bootstrapInterruptAfter: "after_publish_intent_resolved" as const } : {}),
      bootstrapFailureHook: (point) => {
        if (point === "after_forward_rename" && renamed === null) {
          const planName = readdirSync(fixture.paths.stateDir).find((name) => name.endsWith(".plan.json"));
          const plan = JSON.parse(readFileSync(join(fixture.paths.stateDir, String(planName)), "utf8")) as {
            readonly createdPaths: readonly { readonly kind: string; readonly path: string }[];
          };
          const stats = lstatSync(String(plan.createdPaths.find((row) => row.kind === "file")?.path), { bigint: true });
          renamed = { dev: stats.dev.toString(10), ino: stats.ino.toString(10) };
          throw new Error("synthetic bootstrap failure at after_forward_rename");
        }
        if (point === "after_creation_evidence" && renamed !== null) throw new Error("synthetic recurring publication failure");
      },
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through a recurring publication failure");
    const persisted = await persistedPlan(fixture);
    if (die) {
      expect(await currentJournal(persisted.value)).toMatchObject({ phase: "compensating" });
      fixture.disableBootstrapFailure();
      fixture.disableBootstrapInterrupt();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      expect(resumed.ok ? 0 : resumed.code).toBe(EXIT_CODES.recoveryRequired);
    } else {
      expect(failed.error.message).toContain("synthetic bootstrap failure at after_forward_rename; finishing the interrupted step also failed");
    }
    expect(await currentJournal(persisted.value), JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({
        phase: "retained",
        terminalOutcome: "rolled_back",
        compensationNext: -1,
        publishIntent: { scope: "ordinary", published: 2 },
      });
    const identity = renamed as { readonly dev: string; readonly ino: string } | null;
    if (identity === null) throw new Error("no forward rename was observed");
    expect(await findIdentity(fixture.root, identity.dev, identity.ino))
      .toContain(`.developer-os-retained.${String(persisted.value.id)}.`);
    // Its durable creation evidence is retained too, so the envelope verifies and a new init may start beside it.
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.report.ids.map((summary) => summary.status)).toStrictEqual(["verified"]);
    expect(admission.blocksNewIntent).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-189 review: a recurring failure before the creation evidence is
   * written resolves to `published: 1` with no creation-evidence row; a file
   * swapped or hardlinked before the resolution is a security refusal (exit 5).
   */
  it.each(["published_one", "swap", "hardlink"] as const)("resolves a created file failing again before its evidence (%s)", async (mode) => {
    let renamed: string | null = null;
    const fixture: CommandFixture = await createCommandFixture(`bootstrap-created-file-before-evidence-${mode}`, {
      bootstrapAvailable: true,
      bootstrapFailureHook: (point) => {
        if (point === "after_forward_rename" && renamed === null) {
          const planName = readdirSync(fixture.paths.stateDir).find((name) => name.endsWith(".plan.json"));
          const plan = JSON.parse(readFileSync(join(fixture.paths.stateDir, String(planName)), "utf8")) as {
            readonly createdPaths: readonly { readonly kind: string; readonly path: string }[];
          };
          renamed = String(plan.createdPaths.find((row) => row.kind === "file")?.path);
          throw new Error("synthetic bootstrap failure at after_forward_rename");
        }
        if (point === "before_creation_evidence" && renamed !== null) {
          if (mode === "swap") {
            const bytes = readFileSync(renamed);
            renameSync(renamed, `${renamed}.swapped`);
            writeFileSync(renamed, bytes, { mode: lstatSync(`${renamed}.swapped`).mode & 0o777 });
          } else if (mode === "hardlink") {
            linkSync(renamed, `${renamed}.hardlink`);
          }
          throw new Error("synthetic recurring failure before creation evidence");
        }
      },
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through a recurring publication failure");
    const persisted = await persistedPlan(fixture);
    const journal = await currentJournal(persisted.value);
    if (mode !== "published_one") {
      expect(failed.code).toBe(EXIT_CODES.securityRefusal);
      expect(failed.error.message).toContain("a publish intent found its payload in neither place");
      expect(journal).toMatchObject({ phase: "compensating", publishIntent: { scope: "ordinary", published: null } });
      return;
    }
    expect(journal, JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) })).toMatchObject({
      phase: "retained",
      terminalOutcome: "rolled_back",
      publishIntent: { scope: "ordinary", published: 1 },
    });
    const intent = journal.publishIntent as JsonRecord;
    expect(deriveBootstrapRetentionAuthorities(
      persisted.value as never,
      deriveBootstrapTerminalJournal(journal as never),
    ).some((row) => row.role === "creation_evidence" &&
      row.sourcePath.endsWith(`.ordinary.${String(intent.ordinal).padStart(10, "0")}.creation.json`))).toBe(false);
    expect(readdirSync(fixture.paths.stateDir).some((name) => name.endsWith(".creation.json") &&
      name.includes(`.ordinary.${String(intent.ordinal).padStart(10, "0")}.`))).toBe(false);
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.report.ids.map((summary) => summary.status)).toStrictEqual(["verified"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** NEW-189 review: a forward Foundation journal published before any mutation moved resolves to `published: 0`. */
  it("rolls back a forward Foundation participant failing again before its mutations move", async () => {
    const fixture = await createCommandFixture("bootstrap-foundation-published-zero", {
      bootstrapAvailable: true,
      interruptAfter: "staged",
      interruptKind: "fresh_init_artifacts",
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through a recurring Foundation failure");
    const persisted = await persistedPlan(fixture);
    expect(await currentJournal(persisted.value), JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-30) })).toMatchObject({
      phase: "retained",
      terminalOutcome: "rolled_back",
      nextFoundationParticipant: 0,
      publishIntent: { scope: "foundation", ordinal: 0, published: 0 },
    });
    for (const mutation of participant(persisted.value, "forward").mutations as JsonRecord[]) {
      expect(await exists(String(mutation.targetPath))).toBe(false);
    }
    expect(fixture.transactionUnlinkRequests).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-148 follow-up: a failure after the global lock was created and
   * acquired but before its cursor advanced. Compensation finishes that row
   * first, so the held lock and the journal agree at retention.
   */
  it.each(["after_global_lock_create", "after_global_lock_parent_sync", "after_creation_evidence"] as const)(
    "retains a rollback that failed at %s before the global-lock cursor advanced",
    async (point) => {
      let fired = false;
      const fixture = await createCommandFixture(`bootstrap-global-lock-window-${point}`, {
        bootstrapAvailable: true,
        // One-shot: finishing the row passes `after_creation_evidence` again.
        bootstrapFailureHook: (candidate) => {
          if (candidate !== point || fired) return;
          fired = true;
          throw new Error(`synthetic bootstrap failure at ${point}`);
        },
      });

      const failed = await runInit(fixture.context, ACCEPTED);

      if (failed.ok) throw new Error("init succeeded through an injected failure");
      expect(failed.error.message).toContain(`synthetic bootstrap failure at ${point}`);
      expect(await currentJournal((await persistedPlan(fixture)).value), JSON.stringify({ failed, trace: fixture.bootstrapTrace.slice(-20) }))
        .toMatchObject({ phase: "retained", terminalOutcome: "rolled_back", nextCreatedPath: 1 });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it("retains post-Foundation rollback targets and artifacts without invoking deletion authority", async () => {
    const fixture = await createCommandFixture("bootstrap-foundation-retained-rollback", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_foundation",
      bootstrapInterruptAfter: "after_rolled_back",
    });

    const failed = await runInit(fixture.context, ACCEPTED);
    expect(failed.ok).toBe(false);
    const persisted = await persistedPlan(fixture);
    const rolledBack = await currentJournal(persisted.value);
    expect(rolledBack, JSON.stringify({
      failed,
      trace: fixture.bootstrapTrace.slice(-30),
      unlinks: fixture.transactionUnlinkRequests,
    })).toMatchObject({
      phase: "rolled_back",
      terminalOutcome: "rolled_back",
      nextFoundationParticipant: 1,
      compensationNext: -1,
    });
    expect(fixture.transactionUnlinkRequests).toStrictEqual([]);

    const forward = participant(persisted.value, "forward");
    const mutations = forward.mutations as JsonRecord[];
    const targetPaths = mutations.map((mutation) => String(mutation.targetPath));
    expect(targetPaths.length).toBeGreaterThan(0);
    await Promise.all(targetPaths.map((path) => expect(nodeFs.lstat(path, { bigint: true })).resolves.toBeDefined()));

    const locations = deriveBootstrapRetentionLocations(persisted.value as never, rolledBack);
    const exactIdentities = await Promise.all(locations.map(async (location) => {
      const stats = await nodeFs.lstat(location.sourcePath, { bigint: true });
      return { location, dev: stats.dev.toString(10), ino: stats.ino.toString(10) };
    }));

    fixture.disableBootstrapFailure();
    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok).toBe(false);
    expect(resumed.ok ? 0 : resumed.code, JSON.stringify({
      resumed,
      trace: fixture.bootstrapTrace.slice(-40),
      journal: await currentJournal(persisted.value),
    })).toBe(EXIT_CODES.recoveryRequired);
    expect(await currentJournal(persisted.value), JSON.stringify({
      resumed,
      trace: fixture.bootstrapTrace.slice(-40),
    })).toMatchObject({
      phase: "retained",
      terminalOutcome: "rolled_back",
      compensationNext: -1,
    });
    expect(fixture.transactionUnlinkRequests).toStrictEqual([]);
    for (const retained of exactIdentities) {
      const stats = await nodeFs.lstat(retained.location.tombstonePath, { bigint: true });
      expect([stats.dev.toString(10), stats.ino.toString(10)]).toStrictEqual([
        retained.dev,
        retained.ino,
      ]);
    }
  }, 600_000);

  it("force-forwards after the manifest point of no return", async () => {
    const fixture = await createCommandFixture("bootstrap-manifest-forward", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_manifest_publish",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    expect((await currentJournal((await persistedPlan(fixture)).value)).manifestCursor).toBe(2);

    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("retains the fresh V1 compatibility arm when the bootstrap projection is absent", async () => {
    const fixture = await createCommandFixture("bootstrap-projection-missing");
    const result = await runInit({ ...fixture.context, bootstrap: undefined }, ACCEPTED);
    expect(result.ok && result.data.schemaVersion).toBe(1);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it("preserves a pre-existing Brain byte-for-byte", async () => {
    const fixture = await createCommandFixture("bootstrap-existing-brain", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true });
    const note = join(fixture.paths.brain, "mine.md");
    await nodeFs.writeFile(note, "mine\n");

    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect(await nodeFs.readFile(note, "utf8")).toBe("mine\n");
    expect(await nodeFs.readdir(fixture.paths.brain)).toStrictEqual(["mine.md"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    "after_global_lock_create",
    "before_global_lock_parent_sync",
    "after_global_lock_parent_sync",
  ] as const)("resumes after a death at %s by admitting the evidence-less global lock", async (deathPoint) => {
    const fixture = await createCommandFixture(`executor-lock-${deathPoint}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: deathPoint,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    await bootstrap.executor.close();
    fixture.disableBootstrapInterrupt();

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(resumed.error.message);
    const evidence = await fixture.bootstrapEvidenceIdentities();
    expect(new Set(evidence.map((entry) => entry.id)).size).toBe(1);
  }, 600_000);

  it("refuses a non-empty file at the global-lock path when its creation evidence is absent", async () => {
    const fixture = await createCommandFixture("executor-lock-nonempty", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_global_lock_create",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    await bootstrap.executor.close();
    fixture.disableBootstrapInterrupt();
    await nodeFs.writeFile(join(fixture.paths.stateDir, ".lifecycle.lock"), "x", { mode: 0o600 });

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(EXIT_CODES.securityRefusal);
  }, 600_000);

  it("resumes when the global lock's creation evidence outlived the journal advance", async () => {
    const fixture = await createCommandFixture("executor-lock-after-evidence", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_creation_evidence",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    expect(await currentJournal((await persistedPlan(fixture)).value)).toMatchObject({
      phase: "creating",
      nextCreatedPath: 0,
    });
    await closeBootstrapProcess(fixture);
    fixture.disableBootstrapInterrupt();

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(resumed.data.schemaVersion).toBe(2);
  }, 600_000);

  it("refuses a replaced global lock inode when its creation evidence survived", async () => {
    const fixture = await createCommandFixture("executor-lock-evidence-mismatch", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_creation_evidence",
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    await closeBootstrapProcess(fixture);
    fixture.disableBootstrapInterrupt();
    const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
    await nodeFs.rename(lock, join(fixture.root, "displaced-lifecycle-lock"));
    await nodeFs.writeFile(lock, new Uint8Array(), { mode: 0o600, flag: "wx" });

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(resumed.error.message).toBe("existing global lock escaped admitted rolled-back evidence");
  }, 600_000);
});

describe("admitted bookkeeping paths carry their identity (Spec 2 P8, NEW-86)", () => {
  /** Same path, same children, fresh inode; the displaced directory stays alive so its inode is not reused. */
  async function swapDirectoryInode(fixture: CommandFixture, path: string): Promise<void> {
    const fresh = join(fixture.root, `fresh-${basename(path)}`);
    await nodeFs.mkdir(fresh, { mode: 0o700 });
    await nodeFs.chmod(fresh, 0o700);
    for (const name of await nodeFs.readdir(path)) await nodeFs.rename(join(path, name), join(fresh, name));
    await nodeFs.rename(path, join(fixture.root, `displaced-${basename(path)}`));
    await nodeFs.rename(fresh, path);
  }

  async function plantTransactions(fixture: CommandFixture): Promise<string> {
    const transactions = join(fixture.paths.stateDir, "transactions");
    await nodeFs.mkdir(transactions, { recursive: true, mode: 0o700 });
    for (const path of [fixture.paths.home, fixture.paths.stateDir, transactions]) await nodeFs.chmod(path, 0o700);
    return transactions;
  }

  it("records the observed identity and refuses a swapped admitted parent in a fresh process", async () => {
    const fixture = await createCommandFixture("bootstrap-p8-swapped-admitted-parent", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    const transactions = await plantTransactions(fixture);
    const observed = await nodeFs.lstat(transactions, { bigint: true });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const plan = (await persistedPlan(fixture)).value;
    expect(plan.admittedPreexistingPaths).toContainEqual({
      path: transactions,
      dev: observed.dev.toString(10),
      ino: observed.ino.toString(10),
    });
    await closeBootstrapProcess(fixture);
    fixture.disableBootstrapInterrupt();
    await swapDirectoryInode(fixture, transactions);

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an interrupted plan persisted in the pre-P8 bare-path grammar", async () => {
    const fixture = await createCommandFixture("bootstrap-p8-old-grammar-plan", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_plan",
    });
    await plantTransactions(fixture);
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const persisted = await persistedPlan(fixture);
    const admitted = persisted.value.admittedPreexistingPaths as readonly JsonRecord[];
    expect(admitted.length).toBeGreaterThan(0);
    const oldGrammar = encodeCanonicalJson({
      ...persisted.value,
      admittedPreexistingPaths: admitted.map((entry) => entry.path),
    } as unknown as CanonicalJsonValue);
    await nodeFs.writeFile(persisted.path, oldGrammar, { mode: 0o600 });
    await closeBootstrapProcess(fixture);
    fixture.disableBootstrapInterrupt();

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(await nodeFs.readFile(persisted.path, "utf8")).toBe(oldGrammar);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** Restores the refusal test plan 1a Task 2 deleted as unwritable (D30). */
  it("refuses a reinstall after the uninstall once state/transactions was swapped for a fresh inode", async () => {
    const fixture = await createCommandFixture("bootstrap-p8-reinstall-swapped-transactions", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const initialized = await runInit(fixture.context, ACCEPTED);
    if (!initialized.ok) throw new Error(JSON.stringify({ initialized, trace: fixture.bootstrapTrace.slice(-30) }));
    const removed = await runUninstall(fixture.context, ACCEPTED);
    if (!removed.ok) throw new Error(removed.error.message);
    for (const relative of [join("state", "transactions"), join("staging", "transactions"), join("backups", "transactions")]) {
      const root = join(fixture.paths.home, relative);
      const names = await nodeFs.readdir(root).catch(() => [] as string[]);
      for (const name of names.filter((candidate) => /^\.?tx_fixture_[0-9]+(\.json|\.lock)?$/u.test(candidate))) {
        await nodeFs.rm(join(root, name), { recursive: true, force: true });
      }
    }
    const transactions = join(fixture.paths.stateDir, "transactions");
    const before = await nodeFs.lstat(transactions, { bigint: true });
    await swapDirectoryInode(fixture, transactions);
    const swapped = await nodeFs.lstat(transactions, { bigint: true });
    expect(swapped.ino).not.toBe(before.ino);

    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(reinstalled.ok).toBe(false);
    if (reinstalled.ok) return;
    expect(reinstalled.code).toBe(EXIT_CODES.recoveryRequired);
    expect((await nodeFs.lstat(transactions, { bigint: true })).ino).toBe(swapped.ino);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

/** NEW-114: the process died with its host session after the handoff, before the key, entrypoint and instructions. */
describe("a fresh init killed after the bootstrap publication and before the instruction step", () => {
  async function killedAfterBootstrapPublication(name: string): Promise<CommandFixture> {
    const fixture = await createCommandFixture(name, { bootstrapAvailable: true });
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("fixture supplied no bootstrap capability");
    const initializeFresh = bootstrap.executor.initializeFresh.bind(bootstrap.executor);
    vi.spyOn(bootstrap.executor, "initializeFresh").mockImplementationOnce(async (request, evidence) => {
      await initializeFresh(request, evidence);
      throw new Error("killed before the instruction step");
    });

    const interrupted = await runInit(fixture.context, ACCEPTED);

    expect(interrupted.ok).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    await closeBootstrapProcess(fixture);
    return fixture;
  }

  async function admissionOf(fixture: CommandFixture): Promise<Awaited<ReturnType<typeof inspectBootstrapEvidenceAdmission>>> {
    const { paths } = fixture.context;
    return inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: paths.home,
      stateDirectory: paths.stateDir,
      initialRoots: [paths.home, paths.stateDir, fixture.context.userHome],
    }));
  }

  /** A new inode at the slot path unbinds it from the identity the plan persisted, which reads as `unverified`. */
  async function unbindJournalSlot(plan: JsonRecord): Promise<void> {
    const slot = (plan.journalSlots as JsonRecord[])[0];
    if (slot === undefined) throw new Error("persisted plan has no journal slot");
    const path = String(slot.path);
    const replacement = `${path}.new114`;
    await nodeFs.writeFile(replacement, await nodeFs.readFile(path), { mode: 0o600 });
    await nodeFs.rename(replacement, path);
  }

  it("resumes through a second init that finishes the redaction key", async () => {
    const fixture = await killedAfterBootstrapPublication("bootstrap-killed-before-instructions-resume");

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!resumed.ok) throw new Error(JSON.stringify(resumed));
    expect(resumed.data.schemaVersion).toBe(2);
    expect(await exists(redactionKeyPath(fixture.paths.stateDir))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("uninstalls in place while its bootstrap evidence is verified", async () => {
    const fixture = await killedAfterBootstrapPublication("bootstrap-killed-before-instructions-verified");
    expect((await admissionOf(fixture)).report.ids.map((summary) => summary.status)).toStrictEqual(["verified"]);

    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    if (!removed.ok) throw new Error(JSON.stringify(removed));
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("uninstalls in place while its bootstrap evidence is unverified, admitting the Foundation _f staging", async () => {
    const fixture = await killedAfterBootstrapPublication("bootstrap-killed-before-instructions-unverified");
    const plan = (await persistedPlan(fixture)).value;
    const forwardId = String(participant(plan, "forward").id);
    const forwardStaging = join(fixture.paths.stagingDir, "transactions", forwardId);
    const staged = await nodeFs.readdir(forwardStaging);
    expect(staged.length).toBeGreaterThan(0);
    expect(staged.every((name) => name.startsWith(".developer-os-retained."))).toBe(true);
    await unbindJournalSlot(plan);
    const admission = await admissionOf(fixture);
    expect(admission.report.ids.map((summary) => summary.status)).toStrictEqual(["unverified"]);
    expect(admission.bootstrapParticipantIds).toContain(forwardId);
    expect(admission.retainedPaths).toEqual(expect.arrayContaining(staged.map((name) => join(forwardStaging, name))));
    expect(admission.unverifiedResidue.bootstrapParticipantIds).toContain(forwardId);
    expect(admission.unverifiedResidue.retainedPaths).toEqual(expect.arrayContaining(staged.map((name) => join(forwardStaging, name))));

    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    if (!removed.ok) throw new Error(JSON.stringify(removed));
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect((await nodeFs.readdir(forwardStaging)).toSorted()).toStrictEqual(staged.toSorted());
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("installs a new ID beside the unverified envelope after its uninstall, retaining both (NEW-123)", async () => {
    const fixture = await killedAfterBootstrapPublication("bootstrap-killed-before-instructions-reinstall");
    const plan = await persistedPlan(fixture);
    await unbindJournalSlot(plan.value);
    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    if (!removed.ok) throw new Error(JSON.stringify(removed));
    expect((await admissionOf(fixture)).blocksNewIntent).toBe(false);

    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!reinstalled.ok) throw new Error(JSON.stringify(reinstalled));
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect(await exists(plan.path)).toBe(true);
    const ids = (await admissionOf(fixture)).report.ids;
    expect(ids).toHaveLength(2);
    expect(ids).toContainEqual(expect.objectContaining({ id: plan.value.id, status: "unverified" }));
    expect(ids).toContainEqual(expect.objectContaining({ status: "verified" }));
    expect(ids.find((summary) => summary.status === "verified")?.id).not.toBe(plan.value.id);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** NEW-123: with no admitted plan bytes the participant IDs derive from the envelope's ID. */
  it.each([
    {
      envelope: "plan_unverified",
      damage: async (planPath: string) => {
        await nodeFs.writeFile(`${planPath}.new123`, "{}\n", { mode: 0o600 });
        await nodeFs.rename(`${planPath}.new123`, planPath);
      },
    },
    { envelope: "id-only", damage: (planPath: string) => nodeFs.rm(planPath) },
  ])("uninstalls in place while its envelope is $envelope, admitting the Foundation _f staging", async ({ envelope, damage }) => {
    const fixture = await killedAfterBootstrapPublication(`bootstrap-killed-before-instructions-${envelope}`);
    const plan = await persistedPlan(fixture);
    const forwardId = String(participant(plan.value, "forward").id);
    const forwardStaging = join(fixture.paths.stagingDir, "transactions", forwardId);
    const staged = await nodeFs.readdir(forwardStaging);
    expect(staged.length).toBeGreaterThan(0);
    await damage(plan.path);
    const admission = await admissionOf(fixture);
    expect(admission.report.ids.map((summary) => [summary.id, summary.status])).toStrictEqual([[plan.value.id, "unverified"]]);
    expect(admission.bootstrapParticipantIds).toContain(forwardId);
    expect(admission.retainedPaths).toEqual(expect.arrayContaining(staged.map((name) => join(forwardStaging, name))));

    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    if (!removed.ok) throw new Error(JSON.stringify(removed));
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect((await nodeFs.readdir(forwardStaging)).toSorted()).toStrictEqual(staged.toSorted());
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

/**
 * NEW-88 residual: the lock and nonce exist before any Foundation transaction creates backups/transactions
 * lazily. The envelope is still active (pre-handoff), so the absent-manifest arm refuses it as such — not as
 * `lifecycle_ledger_root_shape`; only a post-handoff death uninstalls in place (NEW-114).
 */
describe("a fresh init killed after its created paths and before the Foundation transaction", () => {
  it("refuses uninstall on the active init, not on a missing backups/transactions", async () => {
    const fixture = await createCommandFixture("bootstrap-killed-after-created-paths-uninstall", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_created_paths",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    expect(await exists(join(fixture.paths.stateDir, ".lifecycle.lock"))).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce"))).toBe(true);
    expect(await exists(join(fixture.paths.backupsDir, "transactions"))).toBe(true);
    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);

    const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

    if (removed.ok) throw new Error("uninstall admitted an active fresh init");
    expect(removed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(removed.error.message).toContain("absent_manifest_active_residue");
    expect(removed.error.paths).toStrictEqual([fixture.paths.home]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("D49 preexisting planned parent shape", () => {
  const owner = 501;
  const shape = (mode: number, overrides: { directory?: boolean; symlink?: boolean; uid?: number } = {}) => ({
    isDirectory: () => overrides.directory ?? true,
    isSymbolicLink: () => overrides.symlink ?? false,
    uid: BigInt(overrides.uid ?? owner),
    mode: BigInt(0o040000 | mode),
  });

  it.each([0o700, 0o750, 0o755, 0o711])("admits an owned directory at %o", (mode) => {
    expect(preexistingParentShapeAdmits(shape(mode), owner)).toBe(true);
  });

  it.each([0o770, 0o757, 0o777, 0o720, 0o702])("refuses group or other write at %o", (mode) => {
    expect(preexistingParentShapeAdmits(shape(mode), owner)).toBe(false);
  });

  it("refuses a symlink, a non-directory and a foreign owner", () => {
    expect(preexistingParentShapeAdmits(shape(0o750, { symlink: true, directory: false }), owner)).toBe(false);
    expect(preexistingParentShapeAdmits(shape(0o750, { directory: false }), owner)).toBe(false);
    expect(preexistingParentShapeAdmits(shape(0o750, { uid: owner + 1 }), owner)).toBe(false);
  });

  it.each([0o750, 0o755])("completes a fresh init under a user home at %o", async (mode) => {
    const fixture = await createCommandFixture(`bootstrap-d49-home-${mode.toString(8)}`, { bootstrapAvailable: true });
    await nodeFs.chmod(fixture.userHome, mode);

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    const productHome = await nodeFs.lstat(fixture.paths.home);
    expect(productHome.mode & 0o777).toBe(0o700);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a fresh init under a group-writable user home", async () => {
    const fixture = await createCommandFixture("bootstrap-d49-home-770", { bootstrapAvailable: true });
    await nodeFs.chmod(fixture.userHome, 0o770);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("state/hooks reserved runtime path (A13 Q3-A)", () => {
  async function preexistingHooks(fixture: CommandFixture, name: string): Promise<string> {
    const hooks = join(fixture.paths.stateDir, "hooks");
    await nodeFs.mkdir(hooks, { recursive: true, mode: 0o700 });
    for (const path of [fixture.paths.home, fixture.paths.stateDir, hooks]) await nodeFs.chmod(path, 0o700);
    const child = join(hooks, name);
    await nodeFs.writeFile(child, "{}", { mode: 0o600 });
    return child;
  }

  it("creates state/hooks at 0700 on a fresh init and never names it in the manifest", async () => {
    const fixture = await createCommandFixture("bootstrap-state-hooks-created", { bootstrapAvailable: true });

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    const hooks = join(fixture.paths.stateDir, "hooks");
    const stats = await nodeFs.lstat(hooks);
    expect(stats.isDirectory()).toBe(true);
    expect(stats.mode & 0o777).toBe(0o700);
    expect(stats.uid).toBe(process.getuid?.());
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      artifacts: Array<{ path: string }>;
    };
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    expect(manifest.artifacts.some((artifact) => artifact.path === hooks || artifact.path.startsWith(`${hooks}/`)))
      .toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits a pre-existing state/hooks holding a leftover record temp", async () => {
    const fixture = await createCommandFixture("bootstrap-state-hooks-admitted", { bootstrapAvailable: true });
    const temp = await preexistingHooks(fixture, "claude.Stop.json.tmp-0123456789abcdef");

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    expect(await nodeFs.readFile(temp, "utf8")).toBe("{}");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a pre-existing state/hooks holding a foreign child", async () => {
    const fixture = await createCommandFixture("bootstrap-state-hooks-foreign", { bootstrapAvailable: true });
    const foreign = await preexistingHooks(fixture, "notes.txt");

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.message).toContain("hook_records_shape");
    expect(await nodeFs.readFile(foreign, "utf8")).toBe("{}");
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("bootstrap executor failure reporting and lock release (NEW-179)", () => {
  /** NEW-179 A-3: a refusal after the global lock is acquired releases it, so the same process can retry. */
  it("releases the global lock when its creation evidence refuses during recovery", async () => {
    const fixture = await createCommandFixture("bootstrap-global-evidence-release", {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: "after_global_lock",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const evidence = (await nodeFs.readdir(fixture.paths.stateDir))
      .find((name) => name.endsWith(".ordinary.0000000000.creation.json"));
    if (evidence === undefined) throw new Error("global-lock creation evidence is absent");
    await nodeFs.chmod(join(fixture.paths.stateDir, evidence), 0o644);
    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);
    const context = fixture.rebuildContext();

    const first = await runInit(context, ACCEPTED);
    const second = await runInit(context, ACCEPTED);

    if (first.ok || second.ok) throw new Error("recovery admitted a changed creation evidence");
    expect(first.code).toBe(EXIT_CODES.securityRefusal);
    expect(second.code).toBe(first.code);
    expect(second.error.message).toBe(first.error.message);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** NEW-179 A-7: only lock contention reads as "unavailable"; another provider failure says what failed. */
  it("does not report a failing lock provider as a held lock", async () => {
    const fixture = await createCommandFixture("bootstrap-lock-provider-failure", {
      bootstrapAvailable: true,
      bootstrapBeforeLockAcquire: (path) => path.endsWith("/.lifecycle-bootstrap.lock")
        ? Promise.reject(Object.assign(new Error("synthetic EACCES"), { code: "EACCES" }))
        : Promise.resolve(),
    });

    const refused = await runInit(fixture.context, ACCEPTED);

    if (refused.ok) throw new Error("init acquired a failing lock");
    expect(refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(refused.error.message).toContain("could not be acquired");
    expect(refused.error.message).not.toContain("unavailable");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** NEW-179 A-4: a rollback that fails too names the forward failure instead of replacing it. */
  it("names the forward failure when its rollback fails as well", async () => {
    const fixture = await createCommandFixture("bootstrap-rollback-failure-chain", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "during_payload_write",
      bootstrapFailureHook: (point) => {
        if (point === "after_compensation_staged_file") throw new Error("synthetic rollback failure");
      },
    });

    const failed = await runInit(fixture.context, ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through an injected failure");
    expect(failed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(failed.error.message).toContain("synthetic bootstrap failure at during_payload_write");
    expect(failed.error.message).toContain("rolling it back also failed: synthetic rollback failure");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** NEW-179 B-4: compensation never reads package bytes, so a missing package does not block a resumed rollback. */
  it("resumes a rollback after the packaged release disappeared", async () => {
    const fixture = await createCommandFixture("bootstrap-rollback-without-package", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "during_payload_write",
      bootstrapInterruptAfter: "after_compensation_staged_file",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const persisted = await persistedPlan(fixture);
    expect(await currentJournal(persisted.value)).toMatchObject({ phase: "compensating" });
    await nodeFs.rename(join(fixture.root, "packaged-release"), join(fixture.root, "packaged-release.offline"));
    fixture.disableBootstrapFailure();
    fixture.disableBootstrapInterrupt();
    await closeBootstrapProcess(fixture);

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    expect(resumed.ok ? 0 : resumed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(await currentJournal(persisted.value), JSON.stringify({ resumed, trace: fixture.bootstrapTrace.slice(-30) }))
      .toMatchObject({ phase: "retained", terminalOutcome: "rolled_back" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
