/**
 * Spec 1 §2.4's effect participants, composed for the CLI: the Git and launchd executors behind
 * the coordinator's `LifecycleEffectAdapterV1`, the manifest participant of every non-uninstall
 * lifecycle operation, and the macOS host probes the launchd rows are admitted against.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import {
  GitEffectExecutor,
  LifecycleRecoveryRequiredError,
  ManifestStateParticipant,
  ManifestStateParticipantError,
  parseCanonicalAbsolutePathText,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  GitEffectDependenciesV1,
  LifecycleEffectAdapterV1,
  LifecycleEffectRefV1,
  LifecycleGuardedEntryV1,
  LifecycleParticipantAdaptersV1,
  LowerHexSha256,
  ManifestAdmissionContextV1,
  ManifestStatePlanV1,
} from "@developer-os/core";
import {
  LaunchdBootoutRunner,
  LaunchdEffectExecutor,
  LaunchdEffectJournalStore,
  LaunchdObserver,
  LaunchdSnapshotBootstrapper,
  NodeLaunchdPlistReader,
  loadLaunchdProcessTable,
} from "@developer-os/platform-macos";
import type {
  LaunchdEffectDependenciesV1,
  LaunchdEmptyDirectoryObservationV1,
  ObservedLaunchdDistributionV1,
} from "@developer-os/platform-macos";
import { SupervisedProcessRunner, nodeSupervisedProcessDependencies } from "@developer-os/security";

import {
  LifecycleUnsupportedLeafError,
  lifecycleHomeKeyFromCoordinatorId,
  lifecycleManifestPlanAdmission,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import type { CliLifecycleContext } from "./context.js";

type LifecycleAdaptersV1 = LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>;
type ManifestAdapterV1 = NonNullable<LifecycleAdaptersV1["manifest"]>;
type ManifestFileIdentityV1 = Parameters<ManifestStateParticipant["dependencies"]["guardedUnlinkExact"]>[1];

export interface LifecycleEffectPortsV1 {
  readonly git: GitEffectDependenciesV1;
  /** The per-coordinator plan, journal store and process table are bound per effect reference. */
  readonly launchd: Omit<LaunchdEffectDependenciesV1, "plan" | "journals" | "processTable">;
  readonly push: {
    push(plan: LifecycleExecutionPlanV1, pushPlanHash: LowerHexSha256): Promise<"succeeded" | "failed">;
  };
}

/** Everything the launchd rows admit on the host, and the one process runner they spawn through. */
export interface LaunchdHostV1 {
  readonly runner: Pick<SupervisedProcessRunner, "beginPhase" | "run">;
  consoleUserUid(): Promise<number>;
  operatingSystem(): Promise<ObservedLaunchdDistributionV1["operatingSystem"]>;
  inspectExecutable(path: "/bin/launchctl"): Promise<ObservedLaunchdDistributionV1["executable"]>;
  inspectEmptyDirectory(path: "/private/var/empty"): Promise<LaunchdEmptyDirectoryObservationV1>;
}

const LAUNCHD_TRANSITION_MS = 30_000;
const SYSTEM_VERSION_PLIST = "/System/Library/CoreServices/SystemVersion.plist";
const MAX_SYSTEM_VERSION_BYTES = 65_536;
const MAX_EXECUTABLE_BYTES = 67_108_864;

function recovery(reason: string, path: string): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

export function createLifecycleEffectAdapters(
  context: CliLifecycleContext,
  ports: LifecycleEffectPortsV1,
): Pick<
  LifecycleAdaptersV1,
  "sourceGitEffect" | "destinationGitEffect" | "launchdBeforeFiles" | "launchdAfterFiles" | "networkPush"
> {
  const git = new GitEffectExecutor(ports.git);
  const journals = new LaunchdEffectJournalStore({
    fs: context.fs,
    roots: context.roots,
    locks: context.transactionLocks,
    uuid: context.uuid,
  });

  /**
   * One recovery pass drives every active coordinator through these adapters, while a launchd
   * executor is bound to one coordinator's plan — so the plan is resolved from the published
   * effect plan's own coordinator ID, and the executor re-derives and hash-binds the rest.
   */
  const launchdFor = async (ref: LifecycleEffectRefV1<string>): Promise<LaunchdEffectExecutor> => {
    const effect = await journals.readPlan(ref);
    const key = lifecycleHomeKeyFromCoordinatorId(context.roots.productHome, effect.coordinatorId);
    const { plan } = await context.store(key).read(effect.coordinatorId);
    if (plan.participants.launchd === null) recovery("launchd_effect_unbound", ref.id);
    return new LaunchdEffectExecutor({
      ...ports.launchd,
      plan: plan.participants.launchd,
      journals,
      processTable: () => loadLaunchdProcessTable(key.productHome, effect.coordinatorId),
    });
  };
  const launchd: LifecycleEffectAdapterV1 = {
    apply: async (ref) => (await launchdFor(ref)).apply(ref),
    finalize: async (ref) => (await launchdFor(ref)).finalize(ref),
    compensate: async (ref) => (await launchdFor(ref)).compensate(ref),
    observe: async (ref) => (await launchdFor(ref)).observe(ref),
    compact: async (ref, outcome) => (await launchdFor(ref)).compact(ref, outcome),
  };

  return {
    sourceGitEffect: git,
    destinationGitEffect: git,
    launchdBeforeFiles: launchd,
    launchdAfterFiles: launchd,
    networkPush: ports.push,
  };
}

/**
 * The manifest arm of every Git and automation operation: `preserve_before`, `publish_after` and
 * `finalize_tombstones` over one `ManifestStatePlanV1` whose `after` is present. Uninstall's arm,
 * where `after` is absent, stays in `uninstall.ts`.
 */
export function createLifecycleManifestAdapter(
  context: CliLifecycleContext,
  manifestAdmission: ManifestAdmissionContextV1,
): ManifestAdapterV1 {
  const { fs } = context;
  const productHome = context.roots.productHome;

  const guarded = async (path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null> =>
    // identity-free stat: the guarded port returns an exact decimal identity and takes only a path.
    fs.lstat(path);

  const identityOf = async (
    path: CanonicalAbsolutePathV1,
    expected: ManifestFileIdentityV1,
  ): Promise<LifecycleGuardedEntryV1> => {
    const entry = await guarded(path);
    if (
      entry?.kind !== "regular_file" ||
      entry.dev !== expected.dev ||
      entry.ino !== expected.ino ||
      entry.size !== expected.size ||
      entry.mode !== expected.mode ||
      entry.nlink !== expected.nlink ||
      entry.ownerUid !== expected.ownerUid
    ) {
      recovery("manifest_bytes_identity", path);
    }
    if ((await fs.hashRegular(entry, BigInt(expected.size))) !== expected.hash) {
      recovery("manifest_bytes_hash", path);
    }
    return entry;
  };

  const syncParent = async (path: CanonicalAbsolutePathV1): Promise<void> => {
    const parent = await guarded(parseCanonicalAbsolutePathText(dirname(path)));
    if (parent === null) recovery("lifecycle_guarded_parent", path);
    await fs.syncDirectory(parent);
  };

  const participant = (plan: LifecycleExecutionPlanV1, leaf: ManifestStatePlanV1): ManifestStateParticipant =>
    new ManifestStateParticipant({
      fs: { lstat, open },
      guardedMoveNoReplace: async (source, destination, expected) => {
        await fs.renameNoReplace(await identityOf(source, expected), destination);
      },
      guardedUnlinkExact: async (path, expected) => {
        await fs.unlinkExact(await identityOf(path, expected));
      },
      admission: lifecycleManifestPlanAdmission(
        plan,
        leaf,
        lifecycleHomeKeyFromCoordinatorId(productHome, plan.id),
      ),
      uid: context.effectiveUid,
      manifestAdmission,
    });

  const leafOf = (plan: LifecycleExecutionPlanV1): ManifestStatePlanV1 => {
    const leaf = plan.participants.manifest;
    if (leaf === null || plan.operation === "uninstall") {
      recovery("lifecycle_coordinator_manifest_arm", productHome);
    }
    return leaf;
  };

  /**
   * `ManifestStateParticipant.observe` refuses the post-`compact` inventory the coordinator must
   * see, so it is recognised here under the participant's own identity rule: the live manifest is
   * the exact `after` inode, and anything else stays the participant's refusal.
   */
  const compactionPending = async (leaf: ManifestStatePlanV1): Promise<boolean> => {
    const { before, after } = leaf;
    if (before.state !== "present" || after.state !== "present") return false;
    const { dev, ino } = after;
    if (dev === null || ino === null) return false;
    if ((await guarded(leaf.tombstonePath)) !== null) return false;
    if (after.bytes !== null && (await guarded(after.bytes.path)) !== null) return false;
    await identityOf(leaf.manifestPath, { ...after, dev, ino });
    return true;
  };

  return {
    /**
     * The participant moves the preimage and publishes the postimage in one `apply`; §2.4 orders
     * the activation Foundation step between the two, so the preimage move is taken here alone.
     */
    preserveBefore: async (plan) => {
      const leaf = leafOf(plan);
      const before = leaf.before;
      if (before.state !== "present") return;
      const { dev, ino } = before;
      if (dev === null || ino === null) recovery("manifest_bytes_identity", leaf.manifestPath);
      await fs.renameNoReplace(await identityOf(leaf.manifestPath, { ...before, dev, ino }), leaf.tombstonePath);
      await syncParent(leaf.manifestPath);
      if ((await participant(plan, leaf).observe(leaf)).state !== "preimage_preserved") {
        recovery("manifest_state_preimage", leaf.tombstonePath);
      }
    },
    publishAfter: async (plan) => {
      const leaf = leafOf(plan);
      await participant(plan, leaf).apply(leaf);
    },
    commitAbsence: (plan) =>
      Promise.reject(
        new LifecycleRecoveryRequiredError("lifecycle_coordinator_manifest_arm", [plan.authority.manifestPath]),
      ),
    finalizeTombstones: async (plan) => {
      const leaf = leafOf(plan);
      await participant(plan, leaf).compact(leaf);
    },
    compensate: async (plan) => {
      const leaf = leafOf(plan);
      await participant(plan, leaf).compensate(leaf);
    },
    observe: async (plan) => {
      const leaf = leafOf(plan);
      let observed: Awaited<ReturnType<ManifestStateParticipant["observe"]>>;
      try {
        observed = await participant(plan, leaf).observe(leaf);
      } catch (error) {
        if (!(error instanceof ManifestStateParticipantError)) throw error;
        if (await compactionPending(leaf)) return "compaction_pending";
        throw error;
      }
      if (observed.state === "compensated") recovery("manifest_state_compensated", leaf.manifestPath);
      return observed.state;
    },
  };
}

/**
 * `renameGitNoReplace` crosses from the 0700 quarantine into a 0755 repository, which neither the
 * guarded port nor the retained rename admits; Task 15 supplies it with the Git commands.
 */
function gitPort(context: CliLifecycleContext): GitEffectDependenciesV1 {
  return {
    fs: {
      ...context.fs,
      renameGitNoReplace: () => Promise.reject(new LifecycleUnsupportedLeafError("Git no-replace rename")),
    },
    journalRoot: context.roots.gitEffectJournals,
    effectiveUid: context.effectiveUid,
    locks: context.transactionLocks,
    clock: context.clock,
    uuid: context.uuid,
  };
}

/** `git sync` alone may consume a persisted push plan (§2.2 `retry_only`); Task 15 supplies it. */
const UNSUPPORTED_PUSH: LifecycleEffectPortsV1["push"] = {
  push: () => Promise.reject(new LifecycleUnsupportedLeafError("network push")),
};

function launchdPort(context: CliLifecycleContext, host: LaunchdHostV1): LifecycleEffectPortsV1["launchd"] {
  const effectiveUid = (): number => context.effectiveUid;
  const admission = {
    runner: host.runner,
    effectiveUid,
    operatingSystem: () => host.operatingSystem(),
    inspectExecutable: (path: "/bin/launchctl") => host.inspectExecutable(path),
  };
  return {
    observer: new LaunchdObserver({
      ...admission,
      consoleUserUid: () => host.consoleUserUid(),
      inspectEmptyDirectory: (path) => host.inspectEmptyDirectory(path),
    }),
    bootstrapper: new LaunchdSnapshotBootstrapper(admission),
    launchctl: new LaunchdBootoutRunner(admission),
    plists: new NodeLaunchdPlistReader(),
    beginTransition: () => host.runner.beginPhase("launchd-transition", LAUNCHD_TRANSITION_MS),
    clock: context.clock,
  };
}

export function createLifecycleEffectPorts(
  context: CliLifecycleContext,
  host: LaunchdHostV1,
): LifecycleEffectPortsV1 {
  return { git: gitPort(context), launchd: launchdPort(context, host), push: UNSUPPORTED_PUSH };
}

function rejectHost(): never {
  throw new Error("a lifecycle fixture reached the launchd host without injecting it");
}

/** The composition default: a fixture that reaches launchd without injecting a host fails loudly. */
export const REJECTING_LAUNCHD_HOST: LaunchdHostV1 = {
  runner: {
    beginPhase: rejectHost,
    run: () => Promise.reject(new Error("a lifecycle fixture spawned launchctl without injecting a runner")),
  },
  consoleUserUid: () => Promise.reject(new Error("unexpected console user probe")),
  operatingSystem: () => Promise.reject(new Error("unexpected operating system probe")),
  inspectExecutable: () => Promise.reject(new Error("unexpected executable probe")),
  inspectEmptyDirectory: () => Promise.reject(new Error("unexpected empty directory probe")),
};

function plistString(text: string, key: string): string {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(text);
  return match?.[1] ?? "";
}

/** `sw_vers` reads this record; a missing key yields "", which the pinned row then refuses. */
async function macOsVersion(): Promise<ObservedLaunchdDistributionV1["operatingSystem"]> {
  const bytes = await readFile(SYSTEM_VERSION_PLIST);
  const text = bytes.byteLength > MAX_SYSTEM_VERSION_BYTES ? "" : new TextDecoder().decode(bytes);
  return {
    productName: plistString(text, "ProductName"),
    productVersion: plistString(text, "ProductVersion"),
    buildVersion: plistString(text, "ProductBuildVersion"),
  };
}

function kindOf(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): "file" | "directory" | "symlink" | "other" {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  return stats.isFile() ? "file" : "other";
}

/** Hashed through the descriptor whose identity matched the no-follow `lstat`. */
async function inspectExecutable(path: "/bin/launchctl"): Promise<ObservedLaunchdDistributionV1["executable"]> {
  const observed = await lstat(path, { bigint: true });
  const common = {
    path,
    kind: kindOf(observed),
    ownerUid: Number(observed.uid),
    mode: Number(observed.mode & 0o7777n),
    size: Number(observed.size),
  };
  if (!observed.isFile() || observed.size > BigInt(MAX_EXECUTABLE_BYTES)) return { ...common, sha256: "" };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== observed.dev || opened.ino !== observed.ino || opened.size !== observed.size) {
      return { ...common, sha256: "" };
    }
    const bytes = await handle.readFile();
    return { ...common, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    await handle.close();
  }
}

async function inspectEmptyDirectory(path: "/private/var/empty"): Promise<LaunchdEmptyDirectoryObservationV1> {
  const observed = await lstat(path, { bigint: true });
  return {
    kind: kindOf(observed),
    ownerUid: Number(observed.uid),
    mode: Number(observed.mode & 0o7777n),
    dev: observed.dev.toString(10),
    ino: observed.ino.toString(10),
    entryCount: observed.isDirectory() ? (await readdir(path)).length : 0,
  };
}

/** The console device's owner is the logged-in GUI user, the platform record `HOME`/`USER` are not. */
async function consoleUserUid(): Promise<number> {
  return Number((await stat("/dev/console", { bigint: true })).uid);
}

export function createProductionLaunchdHost(): LaunchdHostV1 {
  return {
    runner: new SupervisedProcessRunner(nodeSupervisedProcessDependencies),
    consoleUserUid,
    operatingSystem: macOsVersion,
    inspectExecutable,
    inspectEmptyDirectory,
  };
}
