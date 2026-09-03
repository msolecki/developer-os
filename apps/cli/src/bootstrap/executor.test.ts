import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveBootstrapRetentionLocations, EXIT_CODES } from "@developer-os/core";
import { MacOsTransactionLockProvider } from "@developer-os/platform-macos";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventory,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import {
  BootstrapExecutor,
  freshInitDeathPoints,
  freshInitFineGrainedDeathPoints,
} from "./executor.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const REAL_FILESYSTEM_TIMEOUT_MS = 300_000;
const REAL_FILESYSTEM_DEATH_MATRIX_TIMEOUT_MS = 600_000;
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
    expect(String(stats.dev)).toBe(slot.dev);
    expect(String(stats.ino)).toBe(slot.ino);
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

async function findIdentity(
  root: string,
  expectedDev: string,
  expectedIno: string,
): Promise<string | null> {
  for (const relativePath of await inventory(root)) {
    const path = join(root, relativePath);
    const stats = await nodeFs.lstat(path, { bigint: true });
    if (String(stats.dev) === expectedDev && String(stats.ino) === expectedIno) return path;
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
    expect(fixture.releaseRequests).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);

    const trace = fixture.bootstrapTrace;
    const index = (prefix: string): number => trace.findIndex((row) => row.startsWith(prefix));
    expect(index("lock:bootstrap")).toBeLessThan(index("inventory:second"));
    expect(index("inventory:second")).toBeLessThan(index("intent:plan"));
    expect(index("intent:journal")).toBeLessThan(index("payload:evidence:"));
    expect(index("payload:evidence:")).toBeLessThan(index("create:global_lock"));
    expect(index("foundation:compensation:")).toBeLessThan(index("foundation:forward:"));
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
    const rootIdentity = await nodeFs.lstat(stagingRoot);
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
    const retainedRoot = await nodeFs.lstat(stagingRoot);
    expect([String(retainedRoot.dev), String(retainedRoot.ino)]).toStrictEqual([
      String(rootIdentity.dev),
      String(rootIdentity.ino),
    ]);
    expect((await nodeFs.lstat(movedParent)).isDirectory()).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(freshInitFineGrainedDeathPoints)(
    "fresh-process recovers exact terminal evidence at fine-grained death $name",
    async ({ name }) => {
      const fixture = await createCommandFixture(`bootstrap-fine-${name}`, {
        bootstrapAvailable: true,
        bootstrapInterruptAfter: name,
        ...(name === "after_rolled_back"
          ? { bootstrapFailureAfter: "during_payload_write" as const }
          : {}),
      });
      const interrupted = await runInit(fixture.context, ACCEPTED);

      expect(interrupted.ok).toBe(false);
      expect(fixture.releaseRequests).toStrictEqual([]);
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
          retainedIdentities.push({ dev: String(stats.dev), ino: String(stats.ino) });
        }
      }

      fixture.disableBootstrapInterrupt();
      fixture.disableBootstrapFailure();
      await closeBootstrapProcess(fixture);
      const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);
      const persisted = await persistedPlan(fixture);
      const terminal = await currentJournal(persisted.value);

      if (name === "after_rolled_back") {
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
        retainedIdentityKeys.add(`${String(stats.dev)}:${String(stats.ino)}`);
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
    expect(String(retainedLock.dev)).toBe(bootstrapIdentity.dev);
    expect(String(retainedLock.ino)).toBe(bootstrapIdentity.ino);

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
    expect(String(replacement.ino)).not.toBe(staged.ino);

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
    const retainedPath = await findIdentity(fixture.root, String(writing.dev), String(writing.ino));
    expect(retainedPath).not.toBeNull();
    expect(retainedPath).toContain(`.developer-os-retained.${String(plan.id)}.`);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

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
    await Promise.all(targetPaths.map((path) => expect(nodeFs.lstat(path)).resolves.toBeDefined()));

    const locations = deriveBootstrapRetentionLocations(persisted.value as never, rolledBack);
    const exactIdentities = await Promise.all(locations.map(async (location) => {
      const stats = await nodeFs.lstat(location.sourcePath, { bigint: true });
      return { location, dev: String(stats.dev), ino: String(stats.ino) };
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
      expect([String(stats.dev), String(stats.ino)]).toStrictEqual([
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
});
