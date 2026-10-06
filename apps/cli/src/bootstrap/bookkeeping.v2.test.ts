import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CODEX_INGEST_HOME_REPAIR, EXIT_CODES, lifecycleBookkeepingPaths } from "@developer-os/core";
import { MacOsTransactionLockProvider } from "@developer-os/platform-macos";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { FreshInitDeathPointV1 } from "./executor.js";
import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import { inspectBootstrapEvidenceAdmission } from "./report.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

interface PersistedFreshPlan {
  readonly id: string;
  readonly admittedPreexistingPaths: readonly { readonly path: string; readonly dev: string; readonly ino: string }[];
  readonly createdPaths: readonly { readonly kind: string; readonly path: string }[];
}

function admittedPaths(plan: PersistedFreshPlan): readonly string[] {
  return plan.admittedPreexistingPaths.map((entry) => entry.path);
}

async function planNames(fixture: CommandFixture): Promise<readonly string[]> {
  return (await nodeFs.readdir(fixture.paths.stateDir)).filter((name) => name.endsWith(".plan.json"));
}

async function readPlan(fixture: CommandFixture, name: string): Promise<PersistedFreshPlan> {
  return JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, name), "utf8"),
  ) as PersistedFreshPlan;
}

async function newestPlanOf(
  fixture: CommandFixture,
  names: readonly string[],
  rolledBackId: string,
): Promise<PersistedFreshPlan> {
  const plans: PersistedFreshPlan[] = [];
  for (const name of names) {
    const plan = await readPlan(fixture, name);
    if (plan.id !== rolledBackId) plans.push(plan);
  }
  if (plans.length !== 1) throw new Error(`expected one plan beside ${rolledBackId}, found ${String(plans.length)}`);
  return plans[0] as PersistedFreshPlan;
}

async function plantProductHome(fixture: CommandFixture): Promise<void> {
  await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(fixture.paths.home, 0o700);
  await nodeFs.chmod(fixture.paths.stateDir, 0o700);
}

async function refusedInit(fixture: CommandFixture): Promise<{ readonly code: number; readonly message: string }> {
  const result = await runInit(fixture.context, ACCEPTED);
  if (result.ok) throw new Error("init admitted a home it must refuse");
  return { code: result.code, message: result.error.message };
}

describe("the lifecycle bookkeeping set on a real V2 home", () => {
  it("keeps the bookkeeping set out of the V2 manifest", async () => {
    const fixture = await createCommandFixture("bootstrap-bookkeeping-not-manifest", { bootstrapAvailable: true });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as { artifacts: { path: string }[] };
    const bookkeeping = lifecycleBookkeepingPaths(fixture.paths.home);
    expect(bookkeeping.size).toBeGreaterThan(0);
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    expect(manifest.artifacts.filter((artifact) => bookkeeping.has(artifact.path))).toStrictEqual([]);
    const created = [
      join(fixture.paths.stateDir, ".lifecycle.lock"),
      join(fixture.paths.stateDir, "transactions"),
      join(fixture.paths.stateDir, "lifecycle-journals"),
      join(fixture.paths.stateDir, "git-effect-journals"),
      join(fixture.paths.stateDir, "launchd-effect-journals"),
      fixture.paths.stagingDir,
      fixture.paths.backupsDir,
    ];
    for (const path of created) {
      expect(bookkeeping.has(path), path).toBe(true);
      expect(await exists(path), path).toBe(true);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * `after_global_lock`, not a later point: a rollback that created ordinary
   * paths retains each of them, and an envelope whose retained sources still
   * exist is not inert, so no second intent is admitted at all. The lock is
   * the one created path compensation may never retain, which is what makes
   * this the state a second `init` has to admit by shape.
   */
  it("reinstalls over a rolled-back first init's global lock and bookkeeping directories, admitting them by shape", async () => {
    const fixture = await createCommandFixture("bootstrap-rolled-back-bookkeeping", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_global_lock",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
    const lockBefore = await nodeFs.lstat(lock, { bigint: true });
    const rolledBack = await readPlan(fixture, (await planNames(fixture))[0] as string);
    for (const path of [
      fixture.paths.backupsDir,
      join(fixture.paths.backupsDir, "transactions"),
      fixture.paths.stagingDir,
      join(fixture.paths.stagingDir, "lifecycle"),
      join(fixture.paths.stagingDir, "transactions"),
      join(fixture.paths.stateDir, "transactions"),
      join(fixture.paths.stateDir, "lifecycle-journals"),
      join(fixture.paths.stateDir, "git-effect-journals"),
      join(fixture.paths.stateDir, "launchd-effect-journals"),
    ]) {
      await nodeFs.mkdir(path, { recursive: true, mode: 0o700 });
      await nodeFs.chmod(path, 0o700);
    }
    const survivors: string[] = [];
    for (const path of lifecycleBookkeepingPaths(fixture.paths.home)) {
      if (await exists(path)) survivors.push(path);
    }
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.retainedEnvelopes).toHaveLength(1);
    expect(admission.retainedEnvelopes[0]?.terminalJournal.terminalOutcome).toBe("rolled_back");
    expect(admission.blocksNewIntent).toBe(false);
    fixture.disableBootstrapFailure();

    const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!reinstalled.ok) throw new Error(reinstalled.error.message);
    const second = await newestPlanOf(fixture, await planNames(fixture), rolledBack.id);
    expect(second.admittedPreexistingPaths).toContainEqual({
      path: lock,
      dev: lockBefore.dev.toString(10),
      ino: lockBefore.ino.toString(10),
    });
    expect(second.createdPaths.some((row) => row.kind === "global_lock")).toBe(false);
    expect((await nodeFs.lstat(lock, { bigint: true })).ino).toBe(lockBefore.ino);
    expect(survivors.length).toBeGreaterThan(0);
    for (const path of survivors) {
      expect(admittedPaths(second), path).toContain(path);
      expect(second.createdPaths.map((row) => row.path), path).not.toContain(path);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-148: a plan that admitted the global lock holds it from before
   * publication, so a rollback before its first created path must still
   * retain with that lock held instead of refusing on every later `init`.
   */
  it("retains a rollback before the first created path of a plan that admitted the global lock", async () => {
    let failAt: FreshInitDeathPointV1 | null = "after_global_lock";
    const fixture = await createCommandFixture("bootstrap-admitted-lock-early-rollback", {
      bootstrapAvailable: true,
      bootstrapFailureHook: (point) => {
        if (point === failAt) throw new Error(`synthetic bootstrap failure at ${point}`);
      },
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const first = await readPlan(fixture, (await planNames(fixture))[0] as string);

    failAt = "after_first_payload";
    const failed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (failed.ok) throw new Error("init succeeded through an injected failure");
    expect(failed.error.message).toContain("synthetic bootstrap failure at after_first_payload");
    const second = await newestPlanOf(fixture, await planNames(fixture), first.id);
    expect(second.createdPaths.some((row) => row.kind === "global_lock")).toBe(false);
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.retainedEnvelopes.map((envelope) => envelope.terminalJournal.terminalOutcome))
      .toStrictEqual(["rolled_back", "rolled_back"]);

    failAt = null;
    const third = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (!third.ok) throw new Error(third.error.message);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("resumes a death after that rollback into a retained envelope with the admitted lock held", async () => {
    let failAt: FreshInitDeathPointV1 | null = "after_global_lock";
    const fixture = await createCommandFixture("bootstrap-admitted-lock-early-rollback-death", {
      bootstrapAvailable: true,
      bootstrapFailureHook: (point) => {
        if (point === failAt) throw new Error(`synthetic bootstrap failure at ${point}`);
      },
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    const first = await readPlan(fixture, (await planNames(fixture))[0] as string);
    failAt = "after_first_payload";
    fixture.setBootstrapInterrupt("after_rolled_back");
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(false);
    const second = await newestPlanOf(fixture, await planNames(fixture), first.id);
    failAt = null;
    fixture.disableBootstrapInterrupt();

    const resumed = await runInit(fixture.rebuildContext(), ACCEPTED);

    if (resumed.ok) throw new Error("a rolled-back envelope resumed as finalized");
    expect(resumed.code).toBe(EXIT_CODES.recoveryRequired);
    expect(resumed.error.message).toContain("the retained bootstrap rolled back");
    const admission = await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }));
    expect(admission.retainedEnvelopes.map((envelope) => envelope.plan.id).toSorted())
      .toStrictEqual([first.id, second.id].toSorted());
    expect(admission.retainedEnvelopes.every((envelope) => envelope.terminalJournal.terminalOutcome === "rolled_back"))
      .toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("admits an empty planted backups directory by shape instead of creating or claiming it", async () => {
    const fixture = await createCommandFixture("bootstrap-planted-backups", { bootstrapAvailable: true });
    await plantProductHome(fixture);
    await nodeFs.mkdir(fixture.paths.backupsDir, { mode: 0o700 });

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(result.error.message);
    const plan = await readPlan(fixture, (await planNames(fixture))[0] as string);
    expect(admittedPaths(plan)).toContain(fixture.paths.backupsDir);
    expect(plan.createdPaths.map((row) => row.path)).not.toContain(fixture.paths.backupsDir);
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as { artifacts: { path: string }[] };
    expect(manifest.artifacts.map((artifact) => artifact.path)).not.toContain(fixture.paths.backupsDir);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-69: `backups` used to be exempt from the rule that a reusable
   * pre-existing directory holds admitted retained evidence, so an unrelated
   * file inside it widened both shape whitelists unchecked.
   */
  it("refuses an unrelated child of a bookkeeping directory, naming it", async () => {
    const fixture = await createCommandFixture("bootstrap-unbound-backups-child", { bootstrapAvailable: true });
    await plantProductHome(fixture);
    await nodeFs.mkdir(fixture.paths.backupsDir, { mode: 0o700 });
    const unrelated = join(fixture.paths.backupsDir, "unrelated.txt");
    await nodeFs.writeFile(unrelated, "residue", { mode: 0o600 });

    const refused = await refusedInit(fixture);

    expect(refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(refused.message).toContain("bookkeeping residue of an unadmitted shape");
    expect(refused.message).toContain(join("backups", "unrelated.txt"));
    expect(unrelated.endsWith(join("backups", "unrelated.txt"))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a run directory an interrupted ingest left, naming it and the repair", async () => {
    const fixture = await createCommandFixture("bootstrap-codex-ingest-abandoned-run", { bootstrapAvailable: true });
    await plantProductHome(fixture);
    const codexIngestHome = join(fixture.paths.stateDir, "codex-ingest-home");
    const abandoned = join(codexIngestHome, "run-a1b2c3");
    await nodeFs.mkdir(abandoned, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(codexIngestHome, 0o700);

    const result = await runInit(fixture.context, ACCEPTED);

    if (result.ok) throw new Error("init admitted a home it must refuse");
    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(result.error.message).toContain("codex_ingest_home_shape");
    expect(result.error.paths).toStrictEqual([abandoned]);
    expect(result.error.message).toContain(CODEX_INGEST_HOME_REPAIR);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a planted logs directory, which is not bookkeeping and holds no retained evidence", async () => {
    const fixture = await createCommandFixture("bootstrap-planted-logs", { bootstrapAvailable: true });
    await plantProductHome(fixture);
    await nodeFs.mkdir(fixture.paths.logsDir, { mode: 0o700 });

    const refused = await refusedInit(fixture);

    expect(refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(refused.message).toContain("unbound reusable directory");
    expect(refused.message).toContain(join(".developer-os", "logs"));
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a global lock whose mode is not owner-only 0600", async () => {
    const fixture = await createCommandFixture("bootstrap-wrong-mode-lock", { bootstrapAvailable: true });
    await plantProductHome(fixture);
    const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
    await nodeFs.writeFile(lock, new Uint8Array(), { mode: 0o644 });
    await nodeFs.chmod(lock, 0o644);

    const refused = await refusedInit(fixture);

    expect(refused.code).toBe(EXIT_CODES.recoveryRequired);
    expect(refused.message).toContain("bookkeeping residue of an unadmitted shape");
    expect(refused.message).toContain(join("state", ".lifecycle.lock"));
    expect(lock.endsWith(join("state", ".lifecycle.lock"))).toBe(true);
    expect(await planNames(fixture)).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an exactly shaped global lock another holder keeps live", async () => {
    const fixture = await createCommandFixture("bootstrap-live-lock-residue", {
      bootstrapAvailable: true,
      bootstrapProductionLocks: true,
    });
    await plantProductHome(fixture);
    const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
    await nodeFs.writeFile(lock, new Uint8Array(), { mode: 0o600 });
    const held = await new MacOsTransactionLockProvider().acquire(lock);

    try {
      const refused = await refusedInit(fixture);

      expect(refused.code).toBe(EXIT_CODES.recoveryRequired);
      expect(refused.message).toContain("a lifecycle bootstrap lock is unavailable");
      expect(refused.message).not.toContain("unadmitted shape");
      expect(await planNames(fixture)).toStrictEqual([]);
    } finally {
      await held.release();
    }
    expect((await nodeFs.lstat(lock)).size).toBe(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
