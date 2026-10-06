/**
 * Spec 1 §2.4's effect participants, composed for the CLI: the Git and launchd executors behind
 * the coordinator's `LifecycleEffectAdapterV1`, the manifest participant of every non-uninstall
 * lifecycle operation, and the macOS host probes the launchd rows are admitted against.
 */
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

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
  LaunchdDistributionUnsupportedError,
  LaunchdEffectExecutor,
  LaunchdEffectJournalStore,
  LaunchdObserver,
  LaunchdPathBootstrapper,
  NodeLaunchdPlistReader,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  SpawnRenameAtxRunner,
  inspectSystemPath,
  loadLaunchdProcessTable,
} from "@developer-os/platform-macos";
import type {
  GeneratedLaunchdLabelV1,
  LaunchdPlanV1,
  LaunchdEffectDependenciesV1,
  LaunchdEmptyDirectoryObservationV1,
  LaunchdHostObserverV1,
} from "@developer-os/platform-macos";
import { SecurityRefusalError, SupervisedProcessRunner, nodeSupervisedProcessDependencies } from "@developer-os/security";

import { createProductionGitRuntime } from "../commands/git/runtime.js";
import type { GitRuntimeV1 } from "../commands/git/runtime.js";
import {
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
  /** The pinned Git boundary `git sync` plans and pushes through; fixtures script it. */
  readonly gitRuntime: GitRuntimeV1;
  /**
   * The per-coordinator plan, journal store and process table are bound per effect reference;
   * `host` is what every process table load admits.
   */
  readonly launchd: Omit<LaunchdEffectDependenciesV1, "plan" | "journals" | "processTable"> & { readonly host: LaunchdHostObserverV1 };
  readonly push: {
    push(plan: LifecycleExecutionPlanV1, pushPlanHash: LowerHexSha256): Promise<"succeeded" | "failed">;
  };
}

/** Everything the launchd rows admit on the host, and the one process runner they spawn through. */
export interface LaunchdHostV1 {
  readonly runner: Pick<SupervisedProcessRunner, "beginPhase" | "run">;
  consoleUserUid(): Promise<number>;
  readonly host: LaunchdHostObserverV1;
  inspectEmptyDirectory(path: "/private/var/empty"): Promise<LaunchdEmptyDirectoryObservationV1>;
}

const LAUNCHD_TRANSITION_MS = 30_000;
const SYSTEM_VERSION_PLIST = "/System/Library/CoreServices/SystemVersion.plist";
const MAX_SYSTEM_VERSION_BYTES = 65_536;

function recovery(reason: string, path: string): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

/**
 * Residual 10 (D59): a launchctl row this host no longer matches cannot `bootout`, so uninstall
 * preserves every file and names the manual unload for each installed generated label.
 * `failureFrom` publishes `kindOf(name)`, so the name is spelled to make it the `reason`.
 */
export function refuseUnsupportedLaunchd(
  uid: number,
  labels: readonly GeneratedLaunchdLabelV1[],
  cause: LaunchdDistributionUnsupportedError,
): never {
  const detail = cause.message.replace(/^unsupported_launchd_distribution: /u, "");
  const manual = labels.length === 0
    ? "no generated label is installed"
    : `unload by hand: ${labels.map((label) => `launchctl bootout gui/${String(uid)}/${label}`).join("; ")}`;
  const error = new LaunchdDistributionUnsupportedError(`${detail}; every file is preserved; ${manual}`, { cause });
  error.name = "Unsupported_launchd_distributionError";
  throw error;
}

/** Every generated label a coordinator's launchd plan may have loaded: each job's prior and its postimage. */
function plannedLabels(plan: LaunchdPlanV1): readonly GeneratedLaunchdLabelV1[] {
  const labels = plan.entries.flatMap((entry) => [
    ...(entry.beforeLiveState.state === "loaded" ? [entry.beforeLiveState.label] : []),
    ...(entry.generatedLabel === null ? [] : [entry.generatedLabel]),
  ]);
  return [...new Set(labels)];
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
  const launchdFor = async (
    ref: LifecycleEffectRefV1<string>,
  ): Promise<{ readonly executor: LaunchdEffectExecutor; readonly labels: readonly GeneratedLaunchdLabelV1[] }> => {
    const effect = await journals.readPlan(ref);
    const key = lifecycleHomeKeyFromCoordinatorId(context.roots.productHome, effect.coordinatorId);
    const { plan } = await context.store(key).read(effect.coordinatorId);
    if (plan.participants.launchd === null) recovery("launchd_effect_unbound", ref.id);
    const executor = new LaunchdEffectExecutor({
      ...ports.launchd,
      plan: plan.participants.launchd,
      journals,
      /** The same template the executor checks against, or every table de-slots to a foreign one. */
      processTable: () =>
        loadLaunchdProcessTable(key.productHome, effect.coordinatorId, {
          template: ports.launchd.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
          host: ports.launchd.host,
        }),
    });
    return { executor, labels: plannedLabels(plan.participants.launchd) };
  };
  /** A resumed journal whose launchctl moved (a macOS update) names the manual unload, residual 10. */
  const unloadByHandOnHostChange = async (ref: LifecycleEffectRefV1<string>, method: "apply" | "compensate"): Promise<void> => {
    const { executor, labels } = await launchdFor(ref);
    try {
      await executor[method](ref);
    } catch (error) {
      if (error instanceof LaunchdDistributionUnsupportedError) refuseUnsupportedLaunchd(context.effectiveUid, labels, error);
      throw error;
    }
  };
  const launchd: LifecycleEffectAdapterV1 = {
    apply: (ref) => unloadByHandOnHostChange(ref, "apply"),
    finalize: async (ref) => (await launchdFor(ref)).executor.finalize(ref),
    compensate: (ref) => unloadByHandOnHostChange(ref, "compensate"),
    observe: async (ref) => (await launchdFor(ref)).executor.observe(ref),
    compact: async (ref, outcome) => (await launchdFor(ref)).executor.compact(ref, outcome),
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
 * guarded port nor the retained rename admits, so it takes `renameatx_np(RENAME_EXCL)` directly
 * between the two reopened parent descriptors.
 */
async function renameGitNoReplace(
  fs: CliLifecycleContext["fs"],
  source: LifecycleGuardedEntryV1,
  destinationPath: CanonicalAbsolutePathV1,
): Promise<"renamed" | "exists"> {
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const reopened = await fs.lstat(source.path);
  if (reopened === null || reopened.dev !== source.dev || reopened.ino !== source.ino || reopened.kind !== source.kind) {
    recovery("git_effect_third_state", source.path);
  }
  if ((await fs.lstat(destinationPath)) !== null) return "exists";
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const sourceParent = await open(dirname(source.path), flags);
  try {
    const destinationParent = await open(dirname(destinationPath), flags);
    try {
      const result = await new SpawnRenameAtxRunner().run({
        sourceParentDescriptor: sourceParent.fd,
        destinationParentDescriptor: destinationParent.fd,
        sourceName: basename(source.path),
        destinationName: basename(destinationPath),
      });
      if (result.exitCode === 0) return "renamed";
    } finally {
      await destinationParent.close();
    }
  } finally {
    await sourceParent.close();
  }
  // identity-free stat: presence alone decides whether the refused rename met an existing name.
  if ((await fs.lstat(destinationPath)) !== null) return "exists";
  return recovery("git_effect_rename_refused", source.path);
}

function gitPort(context: CliLifecycleContext): GitEffectDependenciesV1 {
  return {
    fs: {
      ...context.fs,
      renameGitNoReplace: (source, destinationPath) => renameGitNoReplace(context.fs, source, destinationPath),
    },
    journalRoot: context.roots.gitEffectJournals,
    effectiveUid: context.effectiveUid,
    locks: context.transactionLocks,
    clock: context.clock,
    uuid: context.uuid,
  };
}

/** D59 (Q4-A): HTTPS and SSH have no recorded process trace, so a network push is an unsupported distribution. */
const UNSUPPORTED_NETWORK_PUSH: LifecycleEffectPortsV1["push"] = {
  push: () => Promise.reject(new SecurityRefusalError("unsupported_git_distribution")),
};

function launchdPort(context: CliLifecycleContext, host: LaunchdHostV1): LifecycleEffectPortsV1["launchd"] {
  const effectiveUid = (): number => context.effectiveUid;
  const admission = { runner: host.runner, effectiveUid, host: host.host };
  return {
    host: host.host,
    observer: new LaunchdObserver({
      ...admission,
      consoleUserUid: () => host.consoleUserUid(),
      inspectEmptyDirectory: (path) => host.inspectEmptyDirectory(path),
    }),
    bootstrapper: new LaunchdPathBootstrapper(admission),
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
  return {
    git: gitPort(context),
    gitRuntime: createProductionGitRuntime(),
    launchd: launchdPort(context, host),
    push: UNSUPPORTED_NETWORK_PUSH,
  };
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
  host: {
    operatingSystem: () => Promise.reject(new Error("unexpected operating system probe")),
    inspect: () => Promise.reject(new Error("unexpected system path probe")),
  },
  inspectEmptyDirectory: () => Promise.reject(new Error("unexpected empty directory probe")),
};

function plistString(text: string, key: string): string {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(text);
  return match?.[1] ?? "";
}

/** `sw_vers` reads this record; a missing key yields "", which the macOS floor then refuses. */
async function macOsVersion(): Promise<Awaited<ReturnType<LaunchdHostObserverV1["operatingSystem"]>>> {
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

/** The launchd rows' one supervised spawn authority: `/bin/launchctl` and nothing else. */
function launchctlRunner(): LaunchdHostV1["runner"] {
  const runner = new SupervisedProcessRunner(nodeSupervisedProcessDependencies);
  return {
    beginPhase: (id, wallMs) => runner.beginPhase(id, wallMs),
    run: (request, sink) =>
      request.executable === "/bin/launchctl"
        ? runner.run(request, sink)
        : Promise.reject(new Error(`the launchd runner spawns only /bin/launchctl, not ${request.executable}`)),
  };
}

export function createProductionLaunchdHost(): LaunchdHostV1 {
  return {
    runner: launchctlRunner(),
    consoleUserUid,
    host: { operatingSystem: macOsVersion, inspect: inspectSystemPath },
    inspectEmptyDirectory,
  };
}
