import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LifecycleRecoveryRequiredError,
  SCHEDULED_JOB_IDS,
  type AutomationConfigV1,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type FoundationTransactionIdV1,
  type LaunchdEffectIdV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleEffectRefV1,
  type LowerHexSha256,
  type ScheduledJobIdV1,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessEvidenceV1, SupervisedSpawnRequestV1 } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { LaunchdDistributionUnsupportedError, type LaunchdHostObserverV1 } from "./distribution.js";
import { LAUNCHCTL_IDENTITY, hostWith } from "./distribution.test-fixtures.js";
import {
  encodeLaunchdEffectJournal,
  launchdEffectPlanHash,
  validateLaunchdEffectJournal,
  validateLaunchdEffectJournalForPlan,
  type LaunchdEffectJournalPortV1,
  type LaunchdEffectJournalV1,
  type LaunchdEffectPlanV1,
  type LaunchdEffectPositionV1,
} from "./effect-journal.js";
import {
  LaunchdBootoutRunner,
  LaunchdEffectExecutor,
  NodeLaunchdPlistReader,
  loadLaunchdProcessTable,
  type LaunchdBootoutPortV1,
  type LaunchdEffectDependenciesV1,
  type LaunchdPlistPortV1,
} from "./effects.js";
import { LaunchdObserver, type LaunchdObservationDependenciesV1 } from "./observe.js";
import {
  launchdEffectPlan,
  launchdPlistBytesHash,
  planLaunchdTransitions,
  type LaunchdBootstrapPlistsV1,
  type LaunchdCoordinatorOperationV1,
  type LaunchdPlanV1,
  type LifecycleFileBindingV1,
} from "./plan.js";
import { buildLaunchdPlanPreview } from "./plist.js";
import {
  expandLaunchdProcessTable,
  launchdProcessTableHash,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableV1,
} from "./process-table.js";
import { generatedLabel, launchdGuiDomain, launchdJob, parseScheduledProductHome } from "./registry.js";
import type { LaunchdBootstrapPlistIdentityV1, LaunchdBootstrapSnapshotAttemptV1, LaunchdMutationEvidenceV1, LaunchdSnapshotRequestV1 } from "./snapshot.js";
import { LaunchdInputError, type LaunchdPlanPreviewEntryV1, type LaunchdPlistDictionaryV1, type LaunchdPriorJobStateV1 } from "./types.js";

const uid = (process.getuid?.() ?? 501) as EffectiveUidV1;
const domain = launchdGuiDomain(uid);
const userHome = "/Users/synthetic" as CanonicalAbsolutePathV1;
const productHome = parseScheduledProductHome("/Users/synthetic/.developer-os");
const executablePath = "/Users/synthetic/.developer-os/bin/developer-os" as CanonicalAbsolutePathV1;
const NONCE = "a".repeat(64);
const COORDINATOR = `lc_${NONCE}_1` as LifecycleCoordinatorIdV1;
const TX = `tx_${NONCE}_2` as FoundationTransactionIdV1;
const BEFORE_EFFECT = `le_${NONCE}_8` as LaunchdEffectIdV1;
const AFTER_EFFECT = `le_${NONCE}_9` as LaunchdEffectIdV1;
const OLD_FILE_HASH = "5".repeat(64) as LowerHexSha256;
const OLD_GENERATION = "6".repeat(64) as LowerHexSha256;
const TIMESTAMP = "2026-09-23T10:00:00.000Z" as UtcTimestampV1;
const daily = { cadence: "daily", hour: 2, minute: 0 } as const;
const encoder = new TextEncoder();

function stagingIdentity(path: string, ino: string): LaunchdProcessDirectoryIdentityV1 {
  return { path: path as CanonicalAbsolutePathV1, ownerUid: uid, mode: 448, dev: "16777220" as UInt64DecimalV1, ino: ino as UInt64DecimalV1 };
}

function processTable(): SupportedLaunchdProcessTableV1 {
  const root = `${productHome}/staging/lifecycle/${COORDINATOR}/launchd-process`;
  return expandLaunchdProcessTable(
    { root: stagingIdentity(root, "10"), home: stagingIdentity(`${root}/home`, "11"), tmp: stagingIdentity(`${root}/tmp`, "12") },
    LAUNCHCTL_IDENTITY,
  );
}

class Crash extends Error {}

const absent: LaunchdPriorJobStateV1 = { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };

function retainedOld(job: ScheduledJobIdV1, live: "loaded" | "unloaded"): LaunchdPriorJobStateV1 {
  return {
    beforeFileHash: OLD_FILE_HASH,
    beforeGeneration: OLD_GENERATION,
    beforeLiveState: live === "loaded" ? { state: "loaded", label: generatedLabel(job, OLD_GENERATION), generation: OLD_GENERATION } : { state: "unloaded" },
  };
}

function automation(jobs: readonly ScheduledJobIdV1[]): AutomationConfigV1 {
  return { schemaVersion: 1, schedules: SCHEDULED_JOB_IDS.filter((job) => jobs.includes(job)).map((job) => ({ job, schedule: daily })) };
}

function preview(target: readonly ScheduledJobIdV1[] | null, retained: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>>) {
  return buildLaunchdPlanPreview({
    observationProcessTableHash: "1".repeat(64) as LowerHexSha256,
    mutationProcessTableTemplateHash: "2".repeat(64) as LowerHexSha256,
    domain,
    userHome,
    productHome,
    executablePath,
    automation: target === null ? null : automation(target),
    prior: Object.fromEntries(SCHEDULED_JOB_IDS.map((job) => [job, retained[job] ?? absent])) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>,
  });
}

function installedUnloaded(job: ScheduledJobIdV1): LaunchdPriorJobStateV1 {
  const [entry] = preview([job], {}).entries;
  return { beforeFileHash: launchdPlistBytesHash(entry?.plistBytes as string), beforeGeneration: entry?.generation ?? null, beforeLiveState: { state: "unloaded" } };
}

function identity(entry: LaunchdPlanPreviewEntryV1, arm: "before" | "after"): LaunchdBootstrapPlistIdentityV1 {
  const after = arm === "after" && entry.plistBytes !== null;
  return {
    path: entry.plistPath,
    ownerUid: uid,
    mode: 384,
    nlink: 1,
    size: after ? encoder.encode(entry.plistBytes).byteLength : 1024,
    hash: after ? launchdPlistBytesHash(entry.plistBytes) : (entry.beforeFileHash as LowerHexSha256),
    dev: "16777220" as UInt64DecimalV1,
    ino: (after ? "900001" : "900002") as UInt64DecimalV1,
  };
}

function bootstrapArms(entry: LaunchdPlanPreviewEntryV1): LaunchdBootstrapPlistsV1 {
  if (entry.operation === "keep") return { before: identity(entry, "after"), after: identity(entry, "after") };
  return {
    before: entry.beforeLiveState.state === "loaded" ? identity(entry, "before") : null,
    after: entry.operation === "remove" ? null : identity(entry, "after"),
  };
}

function plan(operation: LaunchdCoordinatorOperationV1, target: readonly ScheduledJobIdV1[] | null, retained: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>>, table = processTable()): LaunchdPlanV1 {
  const planPreview = preview(target, retained);
  const liveOnly = operation === "automation_reconcile" && planPreview.entries.every((entry) => entry.operation === "keep");
  const bind = (participantId: FoundationTransactionIdV1 | null, path: string, before: string | null, after: string | null): LifecycleFileBindingV1 => ({
    participantId,
    targetPath: path as CanonicalAbsolutePathV1,
    expectedBeforeHash: before as LowerHexSha256 | null,
    afterHash: after as LowerHexSha256 | null,
  });
  return planLaunchdTransitions({
    coordinatorId: COORDINATOR,
    coordinatorOperation: operation,
    previewHash: operation === "uninstall" ? null : ("4".repeat(64) as LowerHexSha256),
    processTableHash: launchdProcessTableHash(table),
    preview: planPreview,
    config: bind(liveOnly ? null : TX, `${productHome}/config.toml`, "7".repeat(64), (liveOnly ? "7" : "8").repeat(64)),
    activation: bind(liveOnly ? null : TX, `${productHome}/state/activation.json`, "9".repeat(64), (liveOnly ? "9" : "a").repeat(64)),
    plistFiles: planPreview.entries
      .filter((entry) => entry.operation !== "keep")
      .map((entry) => bind(liveOnly ? null : TX, entry.plistPath, entry.beforeFileHash, entry.plistBytes === null ? null : launchdPlistBytesHash(entry.plistBytes)))
      .sort((left, right) => (left.targetPath < right.targetPath ? -1 : 1)),
    manifest: {
      path: `${productHome}/manifest.json` as CanonicalAbsolutePathV1,
      statePlanHash: liveOnly ? null : ("b".repeat(64) as LowerHexSha256),
      before: { state: "present", hash: "c".repeat(64) as LowerHexSha256 },
      after: { state: "present", hash: (liveOnly ? "c" : "d").repeat(64) as LowerHexSha256 },
    },
    beforeFilesEffectId: operation === "automation_enable" || liveOnly ? null : BEFORE_EFFECT,
    afterFilesEffectId: operation === "automation_disable" || operation === "uninstall" ? null : AFTER_EFFECT,
    bootstrapPlists: Object.fromEntries(planPreview.entries.map((entry) => [entry.job, bootstrapArms(entry)])),
  });
}

/** The injected live launchd domain, plist files and every boundary a crash can follow. */
class World {
  readonly loaded = new Set<string>();
  readonly plists = new Map<string, string>();
  readonly events: string[] = [];
  readonly foundationCalls: string[] = [];
  readonly probes: string[] = [];
  crashAt: number | null = null;
  boundaries = 0;
  domainExit = 0;
  remaining = 30_000;
  phases = 0;

  boundary(): void {
    this.boundaries += 1;
    if (this.crashAt === this.boundaries) throw new Crash(`crash at boundary ${String(this.boundaries)}`);
  }
}

class MemoryJournals implements LaunchdEffectJournalPortV1 {
  readonly plans = new Map<string, LaunchdEffectPlanV1>();
  readonly journals = new Map<string, string>();
  readonly compacted: string[] = [];
  locks = 0;

  constructor(private readonly world: World) {}

  readPlan(ref: LifecycleEffectRefV1<string>): Promise<LaunchdEffectPlanV1> {
    const found = this.plans.get(ref.id);
    if (found === undefined || launchdEffectPlanHash(found) !== ref.planHash) throw new LifecycleRecoveryRequiredError("lifecycle_effect_plan_hash", [ref.id]);
    return Promise.resolve(found);
  }

  readJournal(effect: LaunchdEffectPlanV1): Promise<LaunchdEffectJournalV1 | null> {
    const text = this.journals.get(effect.id);
    if (text === undefined) return Promise.resolve(null);
    const journal = validateLaunchdEffectJournal(JSON.parse(text) as unknown);
    validateLaunchdEffectJournalForPlan(effect, journal);
    return Promise.resolve(journal);
  }

  writeJournal(effect: LaunchdEffectPlanV1, current: LaunchdEffectJournalV1 | null, next: LaunchdEffectJournalV1): Promise<void> {
    validateLaunchdEffectJournalForPlan(effect, next);
    const text = encodeLaunchdEffectJournal(next);
    if (encoder.encode(text).byteLength > effect.maximumJournalBytes) throw new Error("journal over its plan-bound maximum");
    const stored = this.journals.get(effect.id);
    if ((current === null) !== (stored === undefined) || (current !== null && stored !== encodeLaunchdEffectJournal(current))) {
      throw new LifecycleRecoveryRequiredError("lifecycle_effect_journal_stale", [effect.id]);
    }
    this.journals.set(effect.id, text);
    this.world.boundary();
    return Promise.resolve();
  }

  lock(): Promise<{ release(): Promise<void> }> {
    this.locks += 1;
    return Promise.resolve({ release: () => Promise.resolve() });
  }

  compact(effect: LaunchdEffectPlanV1): Promise<void> {
    this.journals.delete(effect.id);
    this.plans.delete(effect.id);
    this.compacted.push(effect.id);
    return Promise.resolve();
  }
}

function runnerFor(world: World): LaunchdObservationDependenciesV1["runner"] {
  return {
    beginPhase: (id, wallMs) => ({ id, deadlineAtMs: wallMs, remainingMilliseconds: () => 30_000 }),
    run: (request: SupervisedSpawnRequestV1): Promise<SupervisedProcessEvidenceV1> => {
      const target = request.argv[1] ?? "";
      world.probes.push(target);
      const exitCode = target === domain ? world.domainExit : world.loaded.has(target.slice(domain.length + 1)) ? 0 : 113;
      return Promise.resolve({
        exitCode,
        signal: null,
        stdoutBytes: 64,
        stderrBytes: 0,
        stdoutSha256: "f".repeat(64) as LowerHexSha256,
        stderrSha256: "f".repeat(64) as LowerHexSha256,
        termination: "exited",
        groupReaped: true,
      });
    },
  };
}

interface Fixture {
  readonly world: World;
  readonly journals: MemoryJournals;
  readonly plan: LaunchdPlanV1;
  readonly table: SupportedLaunchdProcessTableV1;
  readonly snapshotRequests: LaunchdSnapshotRequestV1[];
  readonly bootouts: { readonly target: string; readonly phase: SupervisedPhaseV1 }[];
  executor(overrides?: Partial<LaunchdEffectDependenciesV1>): LaunchdEffectExecutor;
  ref(position: LaunchdEffectPositionV1): LifecycleEffectRefV1<string>;
}

function kind(fixturePlan: LaunchdPlanV1, label: string): "new" | "old" {
  return fixturePlan.entries.some((entry) => entry.generatedLabel === label) ? "new" : "old";
}

function fixture(fixturePlan: LaunchdPlanV1, table = processTable(), world = new World()): Fixture {
  const journals = new MemoryJournals(world);
  for (const position of ["before_files", "after_files"] as const) {
    const effect = launchdEffectPlan(fixturePlan, position);
    if (effect !== null) journals.plans.set(effect.id, effect);
  }
  for (const entry of fixturePlan.entries) {
    if (entry.beforeFileHash !== null) world.plists.set(entry.plistPath, entry.beforeFileHash);
    if (entry.beforeLiveState.state === "loaded") world.loaded.add(entry.beforeLiveState.label);
  }
  const labels = new Map<string, string>();
  for (const entry of fixturePlan.entries) {
    const { before, after } = entry.bootstrapPlists;
    if (after !== null && entry.generatedLabel !== null) labels.set(`${after.path}|${after.hash}`, entry.generatedLabel);
    if (before !== null && entry.beforeLiveState.state === "loaded") labels.set(`${before.path}|${before.hash}`, entry.beforeLiveState.label);
    if (before !== null && entry.operation === "keep" && entry.generatedLabel !== null) labels.set(`${before.path}|${before.hash}`, entry.generatedLabel);
  }
  const plists: LaunchdPlistPortV1 = {
    read: (bound) => {
      const label = labels.get(`${bound.path}|${bound.hash}`);
      if (label === undefined || world.plists.get(bound.path) !== bound.hash) throw new LifecycleRecoveryRequiredError("launchd_bootstrap_plist_changed", [bound.path]);
      world.events.push(`verify-${kind(fixturePlan, label)}-plist`);
      return Promise.resolve({ Label: label } as unknown as LaunchdPlistDictionaryV1);
    },
    verifyHash: (path, hash) => {
      if (world.plists.get(path) !== hash) throw new LifecycleRecoveryRequiredError("launchd_plist_changed", [path]);
      return Promise.resolve();
    },
  };
  const bootouts: Fixture["bootouts"] = [];
  const launchctl: LaunchdBootoutPortV1 = {
    bootout: (_table, target, phase) => {
      bootouts.push({ target, phase });
      const label = target.slice(domain.length + 1);
      world.events.push(`bootout-${kind(fixturePlan, label)}`);
      world.loaded.delete(label);
      world.boundary();
      return Promise.resolve({ exitCode: 0, signal: null, termination: "exited", stdoutBytes: 0, stderrBytes: 0, groupReaped: true });
    },
  };
  const snapshotRequests: LaunchdSnapshotRequestV1[] = [];
  const attempts = new WeakMap<object, LaunchdSnapshotRequestV1>();
  const bootstrapper: LaunchdEffectDependenciesV1["bootstrapper"] = {
    inspect: (request) => {
      snapshotRequests.push(request);
      return Promise.resolve(null);
    },
    recover: (creation, request) => {
      expect(creation).toBeNull();
      const attempt = { role: request.role, source: request.source, inheritedFd: 3 } as unknown as LaunchdBootstrapSnapshotAttemptV1;
      attempts.set(attempt, request);
      return Promise.resolve(attempt);
    },
    bootstrap: (attempt) => {
      const request = attempts.get(attempt);
      if (request === undefined) throw new Error("unknown attempt");
      world.events.push(`snapshot-bootstrap-${kind(fixturePlan, request.plist.Label)}`);
      world.loaded.add(request.plist.Label);
      world.boundary();
      return Promise.resolve({
        argvId: "bootstrap",
        attempt,
        process: { exitCode: 0, signal: null, termination: "exited", stdoutBytes: 0, stderrBytes: 0, groupReaped: true },
      } as LaunchdMutationEvidenceV1);
    },
    recheckSource: () => Promise.resolve(),
  };
  const host: LaunchdObservationDependenciesV1 = {
    runner: runnerFor(world),
    effectiveUid: () => uid,
    consoleUserUid: () => Promise.resolve(uid),
    host: hostWith(),
    inspectEmptyDirectory: () => Promise.resolve({ kind: "directory", ownerUid: 0, mode: 493, dev: "1", ino: "2", entryCount: 0 }),
  };
  return {
    world,
    journals,
    plan: fixturePlan,
    table,
    snapshotRequests,
    bootouts,
    executor: (overrides = {}) =>
      new LaunchdEffectExecutor({
        plan: fixturePlan,
        journals,
        observer: new LaunchdObserver(host),
        bootstrapper,
        launchctl,
        plists,
        processTable: () => Promise.resolve(table),
        beginTransition: () => {
          world.phases += 1;
          return { id: "launchd-transition", deadlineAtMs: 30_000, remainingMilliseconds: () => world.remaining };
        },
        clock: () => TIMESTAMP,
        pause: () => {
          world.remaining -= 10_000;
          return Promise.resolve();
        },
        ...overrides,
      }),
    ref: (position) => {
      const binding = position === "before_files" ? fixturePlan.beforeFilesEffect : fixturePlan.afterFilesEffect;
      if (binding === null) throw new Error(`no ${position} effect`);
      return binding;
    },
  };
}

interface Row {
  readonly operation: LaunchdCoordinatorOperationV1;
  readonly target: readonly ScheduledJobIdV1[] | null;
  readonly retained: Partial<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>>;
  readonly position: LaunchdEffectPositionV1;
}

const launchdTransitionRows: readonly { readonly name: string; readonly row: Row }[] = [
  { name: "install from unloaded (Q)", row: { operation: "automation_enable", target: ["doctor"], retained: {}, position: "after_files" } },
  { name: "replace from loaded old: unload (P)", row: { operation: "automation_reconcile", target: ["doctor"], retained: { doctor: retainedOld("doctor", "loaded") }, position: "before_files" } },
  { name: "replace from unloaded (Q)", row: { operation: "automation_reconcile", target: ["doctor"], retained: { doctor: retainedOld("doctor", "unloaded") }, position: "after_files" } },
  { name: "keep but currently unloaded (Q)", row: { operation: "automation_reconcile", target: ["doctor"], retained: { doctor: installedUnloaded("doctor") }, position: "after_files" } },
  { name: "remove from loaded old (P)", row: { operation: "automation_disable", target: null, retained: { doctor: retainedOld("doctor", "loaded") }, position: "before_files" } },
  {
    name: "two jobs in one participant (P)",
    row: { operation: "uninstall", target: null, retained: { "brain-reindex": retainedOld("brain-reindex", "loaded"), doctor: retainedOld("doctor", "loaded") }, position: "before_files" },
  },
  { name: "two installs in one participant (Q)", row: { operation: "automation_enable", target: ["brain-lint", "doctor"], retained: {}, position: "after_files" } },
];

/** A replace's `Q` runs after `F(plist_files)` has published the new bytes. */
function prepareFiles(fx: Fixture, row: Row): void {
  if (row.position === "after_files") publishPlists(fx);
}

function publishPlists(fx: Fixture): void {
  for (const entry of fx.plan.entries) {
    if (entry.plistBytes !== null) fx.world.plists.set(entry.plistPath, launchdPlistBytesHash(entry.plistBytes));
  }
}

function liveSet(fx: Fixture): string[] {
  return [...fx.world.loaded].sort();
}

async function phaseOf(fx: Fixture, position: LaunchdEffectPositionV1): Promise<string | null> {
  const effect = launchdEffectPlan(fx.plan, position);
  return effect === null ? null : ((await fx.journals.readJournal(effect))?.phase ?? null);
}

async function recoverLaunchd(fx: Fixture, row: Row, direction: "apply" | "compensate"): Promise<{ phase: string | null; live: string[] }> {
  fx.world.crashAt = null;
  const executor = fx.executor();
  if (direction === "apply") await executor.apply(fx.ref(row.position));
  else await executor.compensate(fx.ref(row.position));
  return { phase: await phaseOf(fx, row.position), live: liveSet(fx) };
}

/** Counts every boundary of an uninterrupted run, then crashes once after each of them. */
async function interruptEachCursor(row: Row, direction: "apply" | "compensate") {
  const clean = fixture(plan(row.operation, row.target, row.retained));
  prepareFiles(clean, row);
  const preimage = liveSet(clean);
  await clean.executor().apply(clean.ref(row.position));
  const postimage = liveSet(clean);
  const forwardBoundaries = clean.world.boundaries;
  if (direction === "compensate") await clean.executor().compensate(clean.ref(row.position));
  const total = clean.world.boundaries - (direction === "compensate" ? forwardBoundaries : 0);
  const interrupted: { fixture: Fixture; expected: { phase: string; live: string[] } }[] = [];
  for (let crashAt = 1; crashAt <= total; crashAt += 1) {
    const fx = fixture(plan(row.operation, row.target, row.retained));
    prepareFiles(fx, row);
    if (direction === "compensate") await fx.executor().apply(fx.ref(row.position));
    fx.world.crashAt = fx.world.boundaries + crashAt;
    const run = direction === "apply" ? fx.executor().apply(fx.ref(row.position)) : fx.executor().compensate(fx.ref(row.position));
    await expect(run).rejects.toThrow(Crash);
    interrupted.push({
      fixture: fx,
      expected: direction === "apply" ? { phase: "verified", live: postimage } : { phase: "rolled_back", live: preimage },
    });
  }
  return interrupted;
}

describe("LaunchdEffectExecutor", () => {
  it.each(launchdTransitionRows)("recovers $name at every cursor", async ({ row }) => {
    const interrupted = await interruptEachCursor(row, "apply");
    expect(interrupted.length).toBeGreaterThan(0);
    for (const state of interrupted) expect(await recoverLaunchd(state.fixture, row, "apply")).toEqual(state.expected);
  });

  it.each(launchdTransitionRows)("compensates $name after a crash at every reverse cursor", async ({ row }) => {
    const interrupted = await interruptEachCursor(row, "compensate");
    expect(interrupted.length).toBeGreaterThan(0);
    for (const state of interrupted) expect(await recoverLaunchd(state.fixture, row, "compensate")).toEqual(state.expected);
  });

  it.each(launchdTransitionRows)("rolls back $name after a forward crash at every cursor", async ({ row }) => {
    const interrupted = await interruptEachCursor(row, "apply");
    expect(interrupted.length).toBeGreaterThan(0);
    const clean = fixture(plan(row.operation, row.target, row.retained));
    const preimage = liveSet(clean);
    for (const state of interrupted) expect(await recoverLaunchd(state.fixture, row, "compensate")).toEqual({ phase: "rolled_back", live: preimage });
  });

  it("unloads the old generation before the plist mutation and loads the new one after verification", async () => {
    const fx = fixture(plan("automation_reconcile", ["doctor"], { doctor: retainedOld("doctor", "loaded") }));
    const runComposite = async (): Promise<void> => {
      await fx.executor().apply(fx.ref("before_files"));
      fx.world.events.push("foundation-plist");
      prepareFiles(fx, { operation: "automation_reconcile", target: ["doctor"], retained: {}, position: "after_files" });
      await fx.executor().apply(fx.ref("after_files"));
    };

    await runComposite();

    expect(fx.world.events).toEqual(["bootout-old", "foundation-plist", "verify-new-plist", "snapshot-bootstrap-new"]);
    expect(liveSet(fx)).toStrictEqual([fx.plan.entries[0]?.generatedLabel]);
  });

  it("compensates a replace in reverse: bootout new, restore old bytes, then bootstrap old", async () => {
    const fx = fixture(plan("automation_reconcile", ["doctor"], { doctor: retainedOld("doctor", "loaded") }));
    await fx.executor().apply(fx.ref("before_files"));
    const oldPlist = fx.world.plists.get(fx.plan.entries[0]?.plistPath ?? "");
    prepareFiles(fx, { operation: "automation_reconcile", target: ["doctor"], retained: {}, position: "after_files" });
    await fx.executor().apply(fx.ref("after_files"));
    fx.world.events.length = 0;

    await fx.executor().compensate(fx.ref("after_files"));
    fx.world.events.push("foundation-plist-inverse");
    fx.world.plists.set(fx.plan.entries[0]?.plistPath ?? "", oldPlist ?? "");
    await fx.executor().compensate(fx.ref("before_files"));

    expect(fx.world.events).toEqual(["bootout-new", "foundation-plist-inverse", "verify-old-plist", "snapshot-bootstrap-old"]);
    expect(liveSet(fx)).toStrictEqual([generatedLabel("doctor", OLD_GENERATION)]);
    expect(await phaseOf(fx, "before_files")).toBe("rolled_back");
    expect(await phaseOf(fx, "after_files")).toBe("rolled_back");
  });

  it("live-only reconcile performs only Q transitions with no Foundation or manifest arm", async () => {
    const liveOnlyPlan = plan("automation_reconcile", ["doctor"], { doctor: installedUnloaded("doctor") });
    const fx = fixture(liveOnlyPlan);

    expect(liveOnlyPlan.beforeFilesEffect).toBeNull();
    await fx.executor().apply(fx.ref("after_files"));

    expect(fx.world.foundationCalls).toEqual([]);
    expect(fx.world.events).toEqual(["verify-new-plist", "snapshot-bootstrap-new"]);
    expect(await phaseOf(fx, "after_files")).toBe("verified");
  });

  it("verifies a zero-transition participant without a launchctl command or a process table", async () => {
    const fx = fixture(plan("automation_disable", null, { doctor: retainedOld("doctor", "unloaded") }));
    let tables = 0;
    const executor = fx.executor({
      processTable: () => {
        tables += 1;
        return Promise.resolve(fx.table);
      },
    });

    await executor.apply(fx.ref("before_files"));
    await executor.finalize(fx.ref("before_files"));

    expect(await executor.observe(fx.ref("before_files"))).toBe("finalized");
    expect([fx.world.events, fx.world.probes, tables]).toStrictEqual([[], [], 0]);
  });

  it("maps journal phases onto the coordinator's effect states", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    publishPlists(fx);
    const executor = fx.executor();
    const ref = fx.ref("after_files");
    expect(await executor.observe(ref)).toBe("future");
    await executor.apply(ref);
    expect(await executor.observe(ref)).toBe("verified");
    await executor.finalize(ref);
    await executor.finalize(ref);
    expect(await executor.observe(ref)).toBe("finalized");
    await expect(executor.compensate(ref)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await executor.compact(ref, "finalized");
    expect(fx.journals.compacted).toStrictEqual([AFTER_EFFECT]);
  });

  it("refuses to compact a journal whose terminal outcome differs", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    publishPlists(fx);
    await fx.executor().apply(fx.ref("after_files"));
    await expect(fx.executor().compact(fx.ref("after_files"), "finalized")).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(fx.journals.compacted).toStrictEqual([]);
  });

  it("binds each bootstrap to the sole current frontier: effect, plan hash, direction, index and role", async () => {
    const fx = fixture(plan("automation_enable", ["brain-lint", "doctor"], {}));
    publishPlists(fx);
    await fx.executor().apply(fx.ref("after_files"));
    await fx.executor().compensate(fx.ref("after_files"));
    const effect = launchdEffectPlan(fx.plan, "after_files");

    expect(fx.snapshotRequests.map((request) => [request.effectId, request.planHash, request.direction, request.transitionIndex, request.role])).toStrictEqual([
      [AFTER_EFFECT, effect === null ? null : launchdEffectPlanHash(effect), "forward", 0, "after"],
      [AFTER_EFFECT, effect === null ? null : launchdEffectPlanHash(effect), "forward", 1, "after"],
    ]);
    expect(fx.bootouts.map((bootout) => bootout.target)).toStrictEqual(
      [...fx.plan.entries].reverse().map((entry) => `${domain}/${entry.generatedLabel ?? ""}`),
    );
  });

  it("shares one transition budget between the command and its probes", async () => {
    const fx = fixture(plan("automation_disable", null, { doctor: retainedOld("doctor", "loaded") }));
    const phases: SupervisedPhaseV1[] = [];
    await fx
      .executor({
        beginTransition: () => {
          const phase = { id: `launchd-transition-${String(phases.length)}`, deadlineAtMs: 30_000, remainingMilliseconds: () => 30_000 };
          phases.push(phase);
          return phase;
        },
      })
      .apply(fx.ref("before_files"));

    expect(phases).toHaveLength(3);
    expect(fx.bootouts).toHaveLength(1);
    expect(fx.bootouts[0]?.phase).toBe(phases[2]);
  });

  it("refuses when the 30-second transition deadline expires before the postimage appears", async () => {
    const fx = fixture(plan("automation_disable", null, { doctor: retainedOld("doctor", "loaded") }));
    const inert: LaunchdBootoutPortV1 = {
      bootout: () => Promise.resolve({ exitCode: 0, signal: null, termination: "exited", stdoutBytes: 0, stderrBytes: 0, groupReaped: true }),
    };

    await expect(fx.executor({ launchctl: inert }).apply(fx.ref("before_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await phaseOf(fx, "before_files")).toBe("applied");
    expect(fx.world.remaining).toBeLessThanOrEqual(0);
  });

  it("never infers success from a failed command and retains the cursor", async () => {
    const fx = fixture(plan("automation_disable", null, { doctor: retainedOld("doctor", "loaded") }));
    const refused: LaunchdBootoutPortV1 = {
      bootout: () => Promise.resolve({ exitCode: 5, signal: null, termination: "exited", stdoutBytes: 0, stderrBytes: 0, groupReaped: true }),
    };
    await expect(fx.executor({ launchctl: refused }).apply(fx.ref("before_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await phaseOf(fx, "before_files")).toBe("applied");
    expect(liveSet(fx)).toStrictEqual([generatedLabel("doctor", OLD_GENERATION)]);
  });

  it.each([
    ["a dual generation", (fx: Fixture) => fx.world.loaded.add(fx.plan.entries[0]?.generatedLabel ?? "")],
    ["an unsuffixed base-label collision", (fx: Fixture) => fx.world.loaded.add(launchdJob("doctor").baseLabel)],
    ["an unobservable domain", (fx: Fixture) => { fx.world.domainExit = 3; }],
    ["an unloaded preimage", (fx: Fixture) => { fx.world.loaded.clear(); }],
  ])("preserves %s as recovery-required before any command", async (_name, disturb) => {
    const fx = fixture(plan("automation_reconcile", ["doctor"], { doctor: retainedOld("doctor", "loaded") }));
    disturb(fx);

    await expect(fx.executor().apply(fx.ref("before_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(fx.bootouts).toStrictEqual([]);
  });

  it("refuses a bootout when the plan-bound plist bytes drifted", async () => {
    const fx = fixture(plan("automation_disable", null, { doctor: retainedOld("doctor", "loaded") }));
    fx.world.plists.set(fx.plan.entries[0]?.plistPath ?? "", "f".repeat(64));
    await expect(fx.executor().apply(fx.ref("before_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(fx.bootouts).toStrictEqual([]);
  });

  it("refuses a process table other than the plan-bound one", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    const other = expandLaunchdProcessTable(
      {
        root: stagingIdentity(fx.table.staging.root.path, "10"),
        home: stagingIdentity(fx.table.staging.home.path, "11"),
        tmp: stagingIdentity(fx.table.staging.tmp.path, "99"),
      },
      LAUNCHCTL_IDENTITY,
    );
    await expect(fx.executor({ processTable: () => Promise.resolve(other) }).apply(fx.ref("after_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await phaseOf(fx, "after_files")).toBeNull();
  });

  it("refuses a process table bound to another launchctl identity than the plan's", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    const updated = expandLaunchdProcessTable(fx.table.staging, { ...LAUNCHCTL_IDENTITY, productVersion: "26.7" });
    await expect(fx.executor({ processTable: () => Promise.resolve(updated) }).apply(fx.ref("after_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(await phaseOf(fx, "after_files")).toBeNull();
  });

  it("refuses a table carrying a retired pinned table ID, before writing a journal", async () => {
    const retired = { ...processTable(), id: "launchctl-macos-26.6.2-25G83-fd3-v1" as unknown as SupportedLaunchdProcessTableV1["id"] };
    const fx = fixture(plan("automation_enable", ["doctor"], {}, retired), retired);

    await expect(fx.executor().apply(fx.ref("after_files"))).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect([await phaseOf(fx, "after_files"), fx.world.probes, fx.world.events]).toStrictEqual([null, [], []]);
  });

  function bootstrapperLoading(fx: Fixture, label: (planned: string) => string | null): LaunchdEffectDependenciesV1["bootstrapper"] {
    return {
      inspect: () => Promise.resolve(null),
      recover: (_creation, request) => Promise.resolve({ role: request.role, source: request.source, inheritedFd: 3, label: request.plist.Label } as unknown as LaunchdBootstrapSnapshotAttemptV1),
      bootstrap: (attempt) => {
        const loaded = label((attempt as unknown as { readonly label: string }).label);
        if (loaded !== null) fx.world.loaded.add(loaded);
        return Promise.resolve({
          argvId: "bootstrap",
          attempt,
          process: { exitCode: 0, signal: null, termination: "exited", stdoutBytes: 0, stderrBytes: 0, groupReaped: true },
        } as LaunchdMutationEvidenceV1);
      },
      recheckSource: () => Promise.resolve(),
    };
  }

  it("compensates and refuses unsupported_launchd_distribution when a bootstrap's post-observation is not the planned generated label", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    publishPlists(fx);

    await expect(fx.executor({ bootstrapper: bootstrapperLoading(fx, () => null) }).apply(fx.ref("after_files"))).rejects.toThrow(
      "unsupported_launchd_distribution",
    );
    expect(await phaseOf(fx, "after_files")).toBe("applied");

    fx.world.remaining = 30_000;
    await fx.executor().compensate(fx.ref("after_files"));
    expect([await phaseOf(fx, "after_files"), liveSet(fx)]).toStrictEqual(["rolled_back", []]);
  });

  it("refuses unsupported_launchd_distribution when a bootstrap loads a label other than the planned one", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    publishPlists(fx);

    const foreign = bootstrapperLoading(fx, () => launchdJob("doctor").baseLabel);
    await expect(fx.executor({ bootstrapper: foreign }).apply(fx.ref("after_files"))).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(await phaseOf(fx, "after_files")).toBe("applied");
  });

  it("refuses a ref that is not one of the plan's bound effects or whose published plan differs", async () => {
    const fx = fixture(plan("automation_enable", ["doctor"], {}));
    await expect(fx.executor().apply({ id: BEFORE_EFFECT, planHash: fx.ref("after_files").planHash })).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(fx.executor().apply({ id: AFTER_EFFECT, planHash: "0".repeat(64) as LowerHexSha256 })).rejects.toThrow(LifecycleRecoveryRequiredError);
    const effect = launchdEffectPlan(fx.plan, "after_files");
    if (effect !== null) fx.journals.plans.set(effect.id, { ...effect, processTableHash: "0".repeat(64) as LowerHexSha256 });
    await expect(fx.executor().apply(fx.ref("after_files"))).rejects.toThrow(LifecycleRecoveryRequiredError);
  });
});

describe("LaunchdBootoutRunner", () => {
  const bases: string[] = [];

  afterEach(async () => {
    for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
  });

  async function staging(host: LaunchdHostObserverV1 = hostWith()) {
    const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-bootout-")));
    bases.push(base);
    const root = `${base}/staging/lifecycle/${COORDINATOR}/launchd-process`;
    for (const directory of [root, `${root}/home`, `${root}/tmp`]) {
      await mkdir(directory, { recursive: true });
      await chmod(directory, 0o700);
    }
    const withDevice = async (path: string): Promise<LaunchdProcessDirectoryIdentityV1> => {
      const stats = await lstat(path, { bigint: true });
      return { ...stagingIdentity(path, stats.ino.toString(10)), dev: stats.dev.toString(10) as UInt64DecimalV1 };
    };
    const table = expandLaunchdProcessTable(
      { root: await withDevice(root), home: await withDevice(`${root}/home`), tmp: await withDevice(`${root}/tmp`) },
      LAUNCHCTL_IDENTITY,
    );
    const requests: SupervisedSpawnRequestV1[] = [];
    const runner = new LaunchdBootoutRunner({
      runner: {
        run: (request) => {
          requests.push(request);
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutBytes: 0,
            stderrBytes: 0,
            stdoutSha256: "f".repeat(64) as LowerHexSha256,
            stderrSha256: "f".repeat(64) as LowerHexSha256,
            termination: "exited",
            groupReaped: true,
          });
        },
      },
      effectiveUid: () => uid,
      host,
    });
    return { base, root, table, runner, requests };
  }

  const phase: SupervisedPhaseV1 = { id: "launchd-transition", deadlineAtMs: 30_000, remainingMilliseconds: () => 30_000 };
  const target = `${domain}/${generatedLabel("doctor", OLD_GENERATION)}` as const;

  it("runs the literal bootout argv with the sanitized environment and no inherited descriptor", async () => {
    const { table, runner, requests } = await staging();
    await runner.bootout(table, target, phase);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.executable).toBe("/bin/launchctl");
    expect(requests[0]?.argv).toStrictEqual(["bootout", target]);
    expect(requests[0]?.env).toStrictEqual({ ...table.environment });
    expect(requests[0]?.cwd).toBe(table.staging.home.path);
    expect(requests[0]?.inheritedFds).toStrictEqual([]);
    expect(requests[0]?.phase).toBe(phase);
  });

  it.each([
    ["a child in home", "home/child"],
    ["a leftover snapshot in tmp", "tmp/bootstrap-plist"],
    ["an extra root entry", "other"],
  ])("preserves %s and spawns nothing", async (_name, leaf) => {
    const { root, table, runner, requests } = await staging();
    await writeFile(`${root}/${leaf}`, "x", { mode: 0o600 });

    await expect(runner.bootout(table, target, phase)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(requests).toStrictEqual([]);
    expect((await lstat(`${root}/${leaf}`)).isFile()).toBe(true);
  });

  it("refuses a replaced staging directory by identity", async () => {
    const { root, table, runner, requests } = await staging();
    await rename(`${root}/tmp`, `${root}/tmp-old`);
    await mkdir(`${root}/tmp`, { mode: 0o700 });
    await rm(`${root}/tmp-old`, { recursive: true });

    await expect(runner.bootout(table, target, phase)).rejects.toThrow(LifecycleRecoveryRequiredError);
    expect(requests).toStrictEqual([]);
  });

  it("refuses another uid's domain and a base label", async () => {
    const { table, runner, requests } = await staging();
    await expect(runner.bootout(table, `gui/${String(uid + 1)}/${generatedLabel("doctor", OLD_GENERATION)}` as typeof target, phase)).rejects.toThrow(LaunchdInputError);
    await expect(runner.bootout(table, `${domain}/com.developer-os.doctor` as unknown as typeof target, phase)).rejects.toThrow(LaunchdInputError);
    expect(requests).toStrictEqual([]);
  });

  it("refuses a sha256 change between loadLaunchdProcessTable and the bootout spawn before the runner runs", async () => {
    const { base, runner, requests } = await staging(hostWith({ paths: { "/bin/launchctl": { sha256: "c".repeat(64) } } }));
    const loaded = await loadLaunchdProcessTable(base as CanonicalAbsolutePathV1, COORDINATOR, { host: hostWith() });

    await expect(runner.bootout(loaded, target, phase)).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(requests).toStrictEqual([]);
  });

  it("refuses a macOS update between loadLaunchdProcessTable and the bootout spawn", async () => {
    const { base, runner, requests } = await staging(hostWith({ productVersion: "26.7", buildVersion: "25H1" }));
    const loaded = await loadLaunchdProcessTable(base as CanonicalAbsolutePathV1, COORDINATOR, { host: hostWith() });

    await expect(runner.bootout(loaded, target, phase)).rejects.toThrow("unsupported_launchd_distribution");
    expect(requests).toStrictEqual([]);
  });

  it("re-derives the bound table from the guarded staging directories and a fresh admission", async () => {
    const { base, table } = await staging();
    const loaded = await loadLaunchdProcessTable(base as CanonicalAbsolutePathV1, COORDINATOR, { host: hostWith() });
    expect(launchdProcessTableHash(loaded)).toBe(launchdProcessTableHash(table));
  });

  it("refuses to load a table on a host below the macOS floor", async () => {
    const { base } = await staging();
    await expect(loadLaunchdProcessTable(base as CanonicalAbsolutePathV1, COORDINATOR, { host: hostWith({ productVersion: "26.5" }) })).rejects.toThrow(
      LaunchdDistributionUnsupportedError,
    );
  });
});

describe("NodeLaunchdPlistReader", () => {
  const bases: string[] = [];

  afterEach(async () => {
    for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
  });

  async function plistFile() {
    const base = await realpath(await mkdtemp(join(tmpdir(), "dos-launchd-plist-")));
    bases.push(base);
    const [entry] = preview(["doctor"], {}).entries;
    const bytes = entry?.plistBytes as string;
    const path = `${base}/com.developer-os.doctor.plist` as CanonicalAbsolutePathV1;
    await writeFile(path, bytes, { mode: 0o600 });
    const stats = await lstat(path, { bigint: true });
    const bound: LaunchdBootstrapPlistIdentityV1 = {
      path,
      ownerUid: uid,
      mode: 384,
      nlink: 1,
      size: encoder.encode(bytes).byteLength,
      hash: launchdPlistBytesHash(bytes),
      dev: stats.dev.toString(10) as UInt64DecimalV1,
      ino: stats.ino.toString(10) as UInt64DecimalV1,
    };
    return { base, path, bytes, bound, label: entry?.generatedLabel };
  }

  it("reads the exact bound inode and returns its canonical dictionary", async () => {
    const { bound, label } = await plistFile();
    const dictionary = await new NodeLaunchdPlistReader().read(bound);
    expect(dictionary.Label).toBe(label);
  });

  it("refuses a byte-identical replacement inode and drifted bytes", async () => {
    const { path, bytes, bound } = await plistFile();
    await rm(path);
    await writeFile(path, bytes, { mode: 0o600 });
    await expect(new NodeLaunchdPlistReader().read(bound)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(new NodeLaunchdPlistReader().verifyHash(path, "f".repeat(64) as LowerHexSha256)).rejects.toThrow(LifecycleRecoveryRequiredError);
    await expect(new NodeLaunchdPlistReader().verifyHash(path, bound.hash)).resolves.toBeUndefined();
  });
});
