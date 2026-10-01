/**
 * Spec 1 §5's `automation enable|disable|status` over the plan-1a lifecycle kernel, composed the
 * way `git enable|disable` is: previews are bounded read-only observation, and every apply runs
 * under a global lock the caller already holds, recomputes its preview there, proves feasibility,
 * reserves IDs, stages every participant, persists the plan and hands it to the coordinator by ID.
 */
import { dirname, join } from "node:path";

import {
  EXIT_CODES,
  LifecycleCoordinator,
  LifecycleRecoveryRequiredError,
  SCHEDULED_JOB_IDS,
  assertLifecycleExecutionFeasible,
  deriveManifestPayloadPath,
  encodeCanonicalJson,
  encodeLifecycleActivationRecord,
  hashBytes,
  hashCanonicalJson,
  lifecycleConfigHash,
  maximumCoordinatorJournalBytes,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseUInt64Decimal,
  serializeConfig,
} from "@developer-os/core";
import type {
  AllocatedLifecycleIdV1,
  AutomationConfigV1,
  BrainGardenConfigV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  ExitCode,
  FoundationParticipantExecutor,
  FoundationParticipantRefV1,
  FoundationTransactionIdV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LaunchdEffectIdV1,
  LifecycleActivationRecordV1,
  LifecycleCoordinatorIdV1,
  LifecycleCoordinatorStepV1,
  LifecycleExecutionBuilderV1,
  LifecycleLeafReservationV1,
  LifecyclePreviewFileChangeV1,
  LowerHexSha256,
  ManagedArtifactV2,
  ManifestStatePlanV1,
  NormalizedScheduleV1,
  ScheduledJobIdV1,
  UtcTimestampV1,
  VaultFreeRelativePathV1,
} from "@developer-os/core";
import {
  LAUNCHD_PREVIEW_OBSERVATION_TABLE,
  LaunchdDistributionUnsupportedError,
  LaunchdEffectJournalStore,
  LaunchdInputError,
  MAX_LAUNCHD_PLIST_BYTES,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  admitLaunchdHost,
  buildLaunchdPlanPreview,
  gitSyncEligible,
  launchdEffectPlan,
  launchdGuiDomain,
  launchdJob,
  launchdObservationProcessTableHash,
  launchdPlistPath,
  launchdProcessTableTemplateHash,
  parseCanonicalLaunchdPlist,
  parseGeneratedLabel,
  parseScheduledProductHome,
  planLaunchdTransitions,
  reconcileAutomationSchedules,
} from "@developer-os/platform-macos";
import type {
  GeneratedLaunchdLabelV1,
  LaunchdBootstrapPlistIdentityV1,
  LaunchdBootstrapPlistsV1,
  LaunchdGenerationV1,
  LaunchdLiveObservationV1,
  LaunchdLiveStateV1,
  LaunchdPlanPreviewEntryV1,
  LaunchdPlanPreviewV1,
  LaunchdPriorJobStateV1,
  LifecycleFileBindingV1,
  SupportedLaunchdProcessTableTemplateV1,
} from "@developer-os/platform-macos";

import type { CliContext } from "../../context.js";
import { selectVendor } from "../ingest.js";
import { compareManifestRows } from "../../instructions/attach.js";
import type { LifecycleExecutionPlanV1, LifecyclePlanPreviewV1 } from "../../lifecycle/codecs.js";
import { lifecyclePushPlanHash, lifecycleVariantFacts } from "../../lifecycle/codecs.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "../../lifecycle/context.js";
import { automationStatusPath, MAX_AUTOMATION_STATUS_BYTES, parseAutomationStatusRecord } from "../../lifecycle/runtime-records.js";
import type { AutomationStatusRecordV1 } from "../../lifecycle/runtime-records.js";
import { MANIFEST_STATE_PLAN_DOMAIN, refuseUnsupportedLaunchd, stageLaunchdProcessTable } from "../../lifecycle/uninstall.js";
import { entrypointPath } from "../../update/local-release.js";
import {
  NO_PUSH,
  admitManifestAfter,
  abandonUnpublishedIntent,
  fileChange,
  foundationBindingsHash,
  gitAdapters,
  observeHome,
  prefixesOf,
  prepareUnderLock,
  reanchorManifest,
  requireClear,
  reserveIds,
  residueOf,
  settle,
  stageManifestPayload,
  withPreviewHash,
} from "../git/service.js";
import type { GitHomeV1 } from "../git/service.js";

export type AutomationCommandRequestV1 =
  | {
      readonly subcommand: "enable";
      readonly schedules: readonly string[];
      /** `--garden-agent`; absent or null means the pinned agent, else the first installed one. */
      readonly gardenAgent?: GardenAgentV1 | null;
      readonly apply: boolean;
    }
  | { readonly subcommand: "disable"; readonly apply: boolean }
  | { readonly subcommand: "status" };

export type GardenAgentV1 = BrainGardenConfigV1["agent"];

export type AutomationOperationV1 = "automation_enable" | "automation_reconcile" | "automation_disable";

export interface AutomationJobStatusV1 {
  readonly job: ScheduledJobIdV1;
  readonly schedule: NormalizedScheduleV1 | null;
  readonly eligible: boolean;
  /** `stale` is an owned plist whose generation is not the current eligible configuration's. */
  readonly installed: "absent" | "current" | "stale" | "drifted" | "unowned";
  readonly live: "loaded" | "unloaded" | "third_state" | null;
  readonly lastRun: AutomationStatusRecordV1 | "invalid" | null;
}

export type AutomationCommandDataV1 =
  | {
      readonly kind: "preview";
      readonly command: "automation_enable" | "automation_disable";
      readonly preview: LifecyclePlanPreviewV1;
    }
  | {
      readonly kind: "applied";
      readonly operation: AutomationOperationV1;
      readonly transactionId: string;
      readonly previewHash: LowerHexSha256;
    }
  | {
      readonly kind: "status";
      readonly enabled: boolean;
      readonly activation: "absent" | "inactive" | "active" | "mismatched";
      readonly distribution: "supported" | "unsupported_launchd_distribution";
      readonly closure: string;
      readonly jobs: readonly AutomationJobStatusV1[];
    };

export interface AutomationCommandResultV1 {
  readonly exitCode: ExitCode;
  readonly data: AutomationCommandDataV1;
}

export interface AutomationService {
  previewEnable(schedules: readonly string[], gardenAgent?: GardenAgentV1 | null): Promise<LifecyclePlanPreviewV1>;
  applyEnable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1, gardenAgent?: GardenAgentV1 | null): Promise<AutomationCommandResultV1>;
  previewDisable(): Promise<LifecyclePlanPreviewV1>;
  applyDisable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<AutomationCommandResultV1>;
  status(): Promise<AutomationCommandResultV1>;
}

/** `failureFrom` publishes `kindOf(name)`, so the name spells the reason, as `GitCommandRefusal` does. */
export class AutomationCommandRefusal extends Error {
  readonly code: ExitCode;
  readonly reason: string;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(reason: string, code: ExitCode, paths: readonly string[] = [], recovery?: string) {
    super(`automation refused: ${reason}`);
    this.reason = reason;
    this.code = code;
    this.paths = [...paths];
    this.recovery = recovery;
    this.name = `${reason
      .split("_")
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join("")}Error`;
  }
}

const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_ENTRYPOINT_BYTES = 1_048_576n;
const WIDEST_UINT64 = parseUInt64Decimal("18446744073709551615");
const WIDEST_HASH = "f".repeat(64) as LowerHexSha256;
const PLIST_MODE = 0o600;
const encoder = new TextEncoder();

function canonical(path: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path);
}

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return hashBytes(typeof bytes === "string" ? encoder.encode(bytes) : bytes) as LowerHexSha256;
}

function refuse(reason: string, code: ExitCode, paths: readonly string[] = [], recovery?: string): never {
  throw new AutomationCommandRefusal(reason, code, paths, recovery);
}

function recoveryRequired(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

// ---------------------------------------------------------------------------------------------
// Observation

interface RetainedPlistV1 {
  readonly job: ScheduledJobIdV1;
  readonly bytes: Uint8Array;
  readonly label: GeneratedLaunchdLabelV1;
  readonly generation: LaunchdGenerationV1;
  readonly executablePath: CanonicalAbsolutePathV1;
  readonly identity: LaunchdBootstrapPlistIdentityV1;
}

type PlistStateV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "unowned" | "drifted"; readonly path: CanonicalAbsolutePathV1 }
  | { readonly kind: "retained"; readonly plist: RetainedPlistV1 };

/**
 * §6's closed external-plist authorization, read back: an exact `macos` content row that existed
 * only because of this installation, a private regular file holding the installed bytes, and a
 * generated label and product home that are this installation's.
 */
async function inspectPlist(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  home: GitHomeV1,
  job: ScheduledJobIdV1,
): Promise<PlistStateV1> {
  const path = launchdPlistPath(canonical(context.userHome), job);
  const row = home.manifest.artifacts.find((artifact) => artifact.path === path);
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const entry = await lifecycle.fs.lstat(path);
  if (row === undefined) return entry === null ? { kind: "absent" } : { kind: "unowned", path };
  const installedHash =
    row.owner === "macos" && row.kind === "file" && row.verification.mode === "content" && !row.existedBefore
      ? row.verification.installedHash
      : null;
  if (installedHash === null || entry?.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid || entry.mode !== PLIST_MODE || entry.nlink !== 1) {
    return { kind: "drifted", path };
  }
  const bytes = await lifecycle.fs.readRegular(entry, MAX_LAUNCHD_PLIST_BYTES);
  if (sha256(bytes) !== installedHash) return { kind: "drifted", path };
  try {
    const plist = parseCanonicalLaunchdPlist(bytes);
    const parsed = parseGeneratedLabel(plist.Label);
    const argv: readonly string[] = plist.ProgramArguments;
    if (parsed.job !== job || argv[6] !== home.key.productHome) return { kind: "drifted", path };
    return {
      kind: "retained",
      plist: {
        job,
        bytes,
        label: plist.Label,
        generation: parsed.generation,
        executablePath: canonical(String(argv[0])),
        identity: {
          path,
          ownerUid: parseEffectiveUid(entry.ownerUid, lifecycle.effectiveUid),
          mode: 384,
          nlink: 1,
          size: bytes.byteLength,
          hash: installedHash,
          dev: entry.dev,
          ino: entry.ino,
        },
      },
    };
  } catch (error) {
    if (!(error instanceof LaunchdInputError)) throw error;
    return { kind: "drifted", path };
  }
}

/** Planning needs every installed generation reconstructed; drift or foreign bytes refuse (§5.3). */
async function retainedPlists(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  home: GitHomeV1,
): Promise<ReadonlyMap<ScheduledJobIdV1, RetainedPlistV1>> {
  const retained = new Map<ScheduledJobIdV1, RetainedPlistV1>();
  for (const job of SCHEDULED_JOB_IDS) {
    const state = await inspectPlist(context, lifecycle, home, job);
    if (state.kind === "unowned") {
      refuse("automation_plist_unowned", EXIT_CODES.decisionRequired, [state.path], "move the unmanaged plist aside, then plan again");
    }
    if (state.kind === "drifted") recoveryRequired("automation_plist_drifted", state.path);
    if (state.kind === "retained") retained.set(job, state.plist);
  }
  return retained;
}

/**
 * The executable every generated plist names is the installed entrypoint, proven by its `core`
 * content row and on-disk hash — never an argv or ambient value.
 */
export async function verifiedAutomationExecutable(
  lifecycle: CliLifecycleContext,
  productHome: CanonicalAbsolutePathV1,
  manifest: InstallationManifestV2,
): Promise<CanonicalAbsolutePathV1> {
  const path = canonical(entrypointPath(productHome));
  const row = manifest.artifacts.find((artifact) => artifact.path === path);
  const installedHash =
    row?.owner === "core" && row.kind === "file" && row.verification.mode === "content" ? row.verification.installedHash : null;
  if (installedHash === null) {
    refuse("automation_executable_unavailable", EXIT_CODES.capabilityUnavailable, [path], "developer-os init --local-release <dir>");
  }
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const entry = await lifecycle.fs.lstat(path);
  if (entry?.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid) {
    refuse("automation_executable_drifted", EXIT_CODES.recoveryRequired, [path], "developer-os doctor");
  }
  if ((await lifecycle.fs.hashRegular(entry, MAX_ENTRYPOINT_BYTES)) !== installedHash) {
    refuse("automation_executable_drifted", EXIT_CODES.recoveryRequired, [path], "developer-os doctor");
  }
  return path;
}

function launchdTemplate(lifecycle: CliLifecycleContext): SupportedLaunchdProcessTableTemplateV1 {
  return lifecycle.effectPorts().launchd.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
}

/** Spec §5.3 rules 1–2 (D71) alone: `status` reports the admission, it never refuses on it. */
async function launchdDistribution(lifecycle: CliLifecycleContext): Promise<"supported" | "unsupported_launchd_distribution"> {
  try {
    await admitLaunchdHost(lifecycle.effectPorts().launchd.host);
    return "supported";
  } catch (error) {
    if (error instanceof LaunchdDistributionUnsupportedError) return "unsupported_launchd_distribution";
    throw error;
  }
}

function domainOf(lifecycle: CliLifecycleContext): ReturnType<typeof launchdGuiDomain> {
  return launchdGuiDomain(parseEffectiveUid(lifecycle.effectiveUid, lifecycle.effectiveUid));
}

interface ObservedJobV1 {
  readonly job: ScheduledJobIdV1;
  readonly retained: GeneratedLaunchdLabelV1 | null;
  readonly planned: GeneratedLaunchdLabelV1 | null;
}

/**
 * One bounded read-only pass through the preview row. A drifted host refuses naming the manual
 * `bootout` for every retained label (D59 residual 10); a live state the table cannot explain is a
 * third state, never unloaded.
 */
async function observeLive(
  lifecycle: CliLifecycleContext,
  jobs: readonly ObservedJobV1[],
  productHome: CanonicalAbsolutePathV1,
): Promise<ReadonlyMap<ScheduledJobIdV1, LaunchdLiveStateV1>> {
  const live = new Map<ScheduledJobIdV1, LaunchdLiveStateV1>();
  for (const [job, state] of await observeLiveStates(lifecycle, jobs, productHome)) {
    if (state === "third_state") recoveryRequired("launchd_live_state_third_state", productHome);
    live.set(job, state);
  }
  return live;
}

/** `status` reports a third state or a foreign loaded generation; every mutation refuses on it. */
async function observeLiveStates(
  lifecycle: CliLifecycleContext,
  jobs: readonly ObservedJobV1[],
  productHome: CanonicalAbsolutePathV1,
): Promise<ReadonlyMap<ScheduledJobIdV1, LaunchdLiveStateV1 | "third_state">> {
  const live = new Map<ScheduledJobIdV1, LaunchdLiveStateV1 | "third_state">();
  if (jobs.length === 0) return live;
  const retainedLabels = jobs.flatMap((job) => (job.retained === null ? [] : [job.retained]));
  let observed: LaunchdLiveObservationV1;
  try {
    observed = await lifecycle.effectPorts().launchd.observer.observe({ domain: domainOf(lifecycle), jobs });
  } catch (error) {
    if (error instanceof LaunchdDistributionUnsupportedError) refuseUnsupportedLaunchd(lifecycle.effectiveUid, retainedLabels, error);
    throw error;
  }
  if (observed.kind === "unobservable") recoveryRequired("launchd_unobservable", productHome);
  jobs.forEach((job, index) => {
    const state = observed.jobs[index]?.job === job.job ? observed.jobs[index].state : null;
    if (state?.kind === "unloaded") {
      live.set(job.job, { state: "unloaded" });
    } else if ((state?.kind === "exact_old" || state?.kind === "exact_new") && state.label === job.retained) {
      live.set(job.job, { state: "loaded", label: state.label, generation: state.generation });
    } else {
      live.set(job.job, "third_state");
    }
  });
  return live;
}

// ---------------------------------------------------------------------------------------------
// Planning

interface AutomationFilesV1 {
  readonly activation: Uint8Array;
  readonly config: Uint8Array;
  readonly manifest: Uint8Array;
}

interface PlannedAutomationV1 {
  readonly home: GitHomeV1;
  readonly preview: LifecyclePlanPreviewV1;
  readonly operation: AutomationOperationV1;
  readonly liveOnly: boolean;
  readonly files: AutomationFilesV1;
  readonly retained: ReadonlyMap<ScheduledJobIdV1, RetainedPlistV1>;
  readonly template: SupportedLaunchdProcessTableTemplateV1;
}

const UNLOADED: LaunchdPriorJobStateV1 = { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };

function plistSource(job: ScheduledJobIdV1): VaultFreeRelativePathV1 {
  return `generated/launchd/${launchdJob(job).plistFileName}` as VaultFreeRelativePathV1;
}

/** The activation row and one `macos` content row per plist the preview leaves installed. */
function manifestAfter(home: GitHomeV1, activation: Uint8Array, launchd: LaunchdPlanPreviewV1): Uint8Array {
  const activationPath = home.authority.activationPath;
  const replaced = new Set<string>([activationPath, ...launchd.entries.map((entry) => entry.plistPath)]);
  const previousOf = (path: string): ManagedArtifactV2 | undefined => home.manifest.artifacts.find((artifact) => artifact.path === path);
  const row = (path: CanonicalAbsolutePathV1, owner: "core" | "macos", source: VaultFreeRelativePathV1, hash: LowerHexSha256): ManagedArtifactV2 => ({
    owner,
    path,
    productVersion: home.manifest.productVersion,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source,
    mergeStrategy: "dedicated",
    verifiedAt: previousOf(path)?.verifiedAt ?? home.manifest.installedAt,
    kind: "file",
    verification: { mode: "content", installedHash: hash },
  });
  const rows = [
    row(activationPath, "core", "generated/state/lifecycle-activation.json" as VaultFreeRelativePathV1, sha256(activation)),
    ...launchd.entries.flatMap((entry) =>
      entry.plistBytes === null ? [] : [row(entry.plistPath, "macos", plistSource(entry.job), sha256(entry.plistBytes))],
    ),
  ];
  const manifest: InstallationManifestV2 = {
    ...home.manifest,
    artifacts: [...home.manifest.artifacts.filter((artifact) => !replaced.has(artifact.path)), ...rows].sort(compareManifestRows),
  };
  return encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));
}

function automationFiles(
  home: GitHomeV1,
  launchd: LaunchdPlanPreviewV1,
  enabled: boolean,
  lifecycleConfig: AutomationConfigV1 | undefined,
  brainGarden: BrainGardenConfigV1 | undefined,
): AutomationFilesV1 {
  const record: LifecycleActivationRecordV1 = {
    schemaVersion: 1,
    git: home.activation?.git ?? { state: "inactive" },
    automation:
      enabled && lifecycleConfig !== undefined
        ? { state: "active", configHash: lifecycleConfigHash("automation", lifecycleConfig) }
        : { state: "inactive" },
  };
  const activation = encoder.encode(encodeLifecycleActivationRecord(record));
  const automation = {
    enabled,
    ...(lifecycleConfig === undefined ? {} : { lifecycle: lifecycleConfig }),
    ...(brainGarden === undefined ? {} : { brainGarden }),
  };
  return {
    activation,
    config: encoder.encode(serializeConfig({ ...home.config, automation })),
    manifest: manifestAfter(home, activation, launchd),
  };
}

function sameBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  return left !== null && Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function plistChange(entry: LaunchdPlanPreviewEntryV1, retained: RetainedPlistV1 | undefined): LifecyclePreviewFileChangeV1 {
  const state = (bytes: Uint8Array | null): LifecyclePreviewFileChangeV1["before"] =>
    bytes === null ? { state: "absent" } : { state: "present", hash: sha256(bytes), size: bytes.byteLength };
  const operation = entry.operation === "install" ? "create" : entry.operation;
  return {
    role: "plist",
    targetPath: entry.plistPath,
    operation,
    before: state(retained?.bytes ?? null),
    after: state(entry.plistBytes === null ? null : encoder.encode(entry.plistBytes)),
  };
}

function previewFiles(home: GitHomeV1, files: AutomationFilesV1, planned: { readonly launchd: LaunchdPlanPreviewV1; readonly retained: ReadonlyMap<ScheduledJobIdV1, RetainedPlistV1> }): readonly LifecyclePreviewFileChangeV1[] {
  return [
    fileChange("activation", home.authority.activationPath, home.activationFile.bytes, files.activation),
    fileChange("config", home.authority.configPath, home.configFile.bytes, files.config),
    fileChange("manifest", home.authority.manifestPath, home.manifestFile.bytes, files.manifest),
    ...planned.launchd.entries.map((entry) => plistChange(entry, planned.retained.get(entry.job))),
  ].sort((left, right) => Buffer.compare(Buffer.from(left.targetPath), Buffer.from(right.targetPath)));
}

/** §5.1: `git-sync` is eligible only while Git carries matching active provenance. */
function gitEligible(home: GitHomeV1): boolean {
  return home.activation !== null && gitSyncEligible(home.config.git, home.activation);
}

/**
 * §5.2 over the recorded configuration: the complete eligible set, or a refusal naming what is
 * missing. No default time exists, so a first enable without every eligible flag refuses here,
 * before any observation or allocation.
 */
function targetSchedules(home: GitHomeV1, flags: readonly string[]): AutomationConfigV1 {
  try {
    return reconcileAutomationSchedules({ prior: home.config.automation.lifecycle ?? null, flags, gitEligible: gitEligible(home) });
  } catch (error) {
    if (!(error instanceof LaunchdInputError)) throw error;
    return refuse("automation_schedule_invalid", EXIT_CODES.invalidInput, [home.authority.configPath], "developer-os automation enable --schedule <job>=<schedule> for every eligible job");
  }
}

/**
 * NEW-134 §3.1: while `brain-garden` is scheduled, the vendor it may spawn is pinned by
 * absolute path — resolved here through discovery and the trust check `ingest` uses, never by
 * the scheduled run. Ruling 34: resolved only when `--garden-agent` names an agent, the job is
 * newly scheduled, or no pin exists (the named agent, else the pinned one, else the first
 * installed); otherwise the pin is kept as it is, so an uninstalled agent never blocks an
 * unrelated schedule change. Removing the job drops the pin. Preview and apply decide alike
 * from the same recorded configuration, so they agree or the apply is stale.
 */
async function gardenPin(
  context: CliContext,
  home: GitHomeV1,
  target: AutomationConfigV1,
  gardenAgent: GardenAgentV1 | null,
): Promise<BrainGardenConfigV1 | undefined> {
  if (!target.schedules.some((entry) => entry.job === "brain-garden")) {
    if (gardenAgent !== null) {
      refuse("automation_garden_agent_without_job", EXIT_CODES.invalidInput, [home.authority.configPath], "developer-os automation enable --schedule brain-garden=<schedule> --garden-agent <agent>");
    }
    return undefined;
  }
  const pinned = home.config.automation.brainGarden;
  const scheduled = (home.config.automation.lifecycle?.schedules ?? []).some((entry) => entry.job === "brain-garden");
  if (gardenAgent === null && scheduled && pinned !== undefined) return pinned;
  try {
    const vendor = await selectVendor(context, gardenAgent ?? pinned?.agent ?? null);
    return { agent: vendor.name, executable: vendor.executable };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === EXIT_CODES.capabilityUnavailable) {
      return refuse("capability_unavailable", EXIT_CODES.capabilityUnavailable, [], "install claude or codex, then developer-os doctor to confirm it is found");
    }
    return refuse("garden_executable_untrusted", EXIT_CODES.securityRefusal, [], "developer-os doctor");
  }
}

function operationOf(entries: readonly LaunchdPlanPreviewEntryV1[], enabling: boolean): { readonly operation: AutomationOperationV1; readonly liveOnly: boolean } {
  if (!enabling) return { operation: "automation_disable", liveOnly: false };
  if (entries.every((entry) => entry.operation === "install")) return { operation: "automation_enable", liveOnly: false };
  return { operation: "automation_reconcile", liveOnly: entries.every((entry) => entry.operation === "keep") };
}

async function planAutomation(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  home: GitHomeV1,
  target: AutomationConfigV1 | null,
  brainGarden: BrainGardenConfigV1 | undefined,
): Promise<PlannedAutomationV1> {
  const retained = await retainedPlists(context, lifecycle, home);
  const productHome = parseScheduledProductHome(home.key.productHome);
  const userHome = canonical(context.userHome);
  const executablePath =
    target === null
      ? ([...retained.values()][0]?.executablePath ?? canonical(entrypointPath(home.key.productHome)))
      : await verifiedAutomationExecutable(lifecycle, home.key.productHome, home.manifest);
  if (target !== null) {
    const launchAgents = canonical(dirname(launchdPlistPath(userHome, "doctor")));
    // identity-free stat: presence and kind only; Foundation never creates a target's parent.
    if ((await lifecycle.fs.lstat(launchAgents))?.kind !== "directory") {
      refuse("launch_agents_directory_absent", EXIT_CODES.capabilityUnavailable, [launchAgents]);
    }
  }
  const template = launchdTemplate(lifecycle);
  const request = {
    observationProcessTableHash: launchdObservationProcessTableHash(LAUNCHD_PREVIEW_OBSERVATION_TABLE),
    mutationProcessTableTemplateHash: launchdProcessTableTemplateHash(template),
    domain: domainOf(lifecycle),
    userHome,
    productHome,
    executablePath,
    automation: target,
  };
  const draft = buildLaunchdPlanPreview({
    ...request,
    prior: Object.fromEntries(SCHEDULED_JOB_IDS.map((job) => [job, UNLOADED])) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>,
  });
  const jobs = SCHEDULED_JOB_IDS.flatMap((job) => {
    const planned = draft.entries.find((entry) => entry.job === job)?.generatedLabel ?? null;
    const kept = retained.get(job)?.label ?? null;
    return planned === null && kept === null ? [] : [{ job, retained: kept, planned }];
  });
  const live = await observeLive(lifecycle, jobs, home.key.productHome);
  const prior = Object.fromEntries(
    SCHEDULED_JOB_IDS.map((job) => {
      const plist = retained.get(job);
      const state: LaunchdPriorJobStateV1 =
        plist === undefined
          ? UNLOADED
          : { beforeFileHash: plist.identity.hash, beforeGeneration: plist.generation, beforeLiveState: live.get(job) ?? { state: "unloaded" } };
      return [job, state];
    }),
  ) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>;
  if (SCHEDULED_JOB_IDS.some((job) => !retained.has(job) && live.get(job)?.state === "loaded")) {
    recoveryRequired("launchd_live_state_third_state", home.key.productHome);
  }
  let launchd: LaunchdPlanPreviewV1;
  try {
    launchd = buildLaunchdPlanPreview({ ...request, prior });
  } catch (error) {
    if (!(error instanceof LaunchdInputError)) throw error;
    return recoveryRequired("automation_plist_drifted", home.key.productHome);
  }
  const { operation, liveOnly } = operationOf(launchd.entries, target !== null);
  if (!liveOnly && mutatedEntries(launchd).length === 0) recoveryRequired("automation_plists_missing", home.authority.configPath);
  const enabledAfter = target !== null;
  const lifecycleConfig = target ?? home.config.automation.lifecycle;
  const files = automationFiles(home, launchd, enabledAfter, lifecycleConfig, brainGarden);
  if (liveOnly && !(sameBytes(home.activationFile.bytes, files.activation) && sameBytes(home.configFile.bytes, files.config) && sameBytes(home.manifestFile.bytes, files.manifest))) {
    recoveryRequired("automation_reconcile_without_plist_change", home.authority.configPath);
  }
  admitManifestAfter(context, files.manifest);
  const preview = withPreviewHash({
    schemaVersion: 1,
    command: enabledAfter ? "automation_enable" : "automation_disable",
    executionOperation: operation,
    normalizedProjection: { subsystem: "automation", enabledAfter, lifecycle: lifecycleConfig ?? null },
    authority: home.authority,
    processTableTemplateHashes: {
      git: null,
      launchd: { observation: launchd.observationProcessTableHash, mutationTemplate: launchd.mutationProcessTableTemplateHash },
    },
    files: previewFiles(home, files, { launchd, retained }),
    git: null,
    launchd,
  });
  const codec = lifecycle.codecs(home.key).preview;
  return {
    home,
    preview: codec.validate(JSON.parse(codec.encode(preview))),
    operation,
    liveOnly,
    files,
    retained,
    template,
  };
}

function requireEnabledSomewhere(home: GitHomeV1, retained: boolean): void {
  if (!home.config.automation.enabled && home.activation?.automation.state !== "active" && !retained) {
    refuse("automation_already_disabled", EXIT_CODES.invalidInput, [home.authority.configPath]);
  }
}

// ---------------------------------------------------------------------------------------------
// Execution

interface StagedAutomationV1 {
  readonly foundation: readonly FoundationParticipantRefV1[];
  readonly payload: { readonly dev: string; readonly ino: string };
  readonly processTableHash: LowerHexSha256;
  readonly bootstrap: Readonly<Partial<Record<ScheduledJobIdV1, LaunchdBootstrapPlistsV1>>>;
}

interface AutomationApplyInputsV1 {
  readonly planned: PlannedAutomationV1;
  readonly createdAt: UtcTimestampV1;
  staged: StagedAutomationV1 | null;
}

function mutatedEntries(launchd: LaunchdPlanPreviewV1): readonly LaunchdPlanPreviewEntryV1[] {
  return launchd.entries.filter((entry) => entry.operation !== "keep");
}

function hasEffect(inputs: AutomationApplyInputsV1, position: "before" | "after"): boolean {
  const { operation, liveOnly } = inputs.planned;
  if (liveOnly) return position === "after";
  return position === "before" ? operation !== "automation_enable" : operation !== "automation_disable";
}

function placeholderRef(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
  id: string,
  slot: FoundationParticipantRefV1["slot"],
  role: FoundationParticipantRefV1["role"],
  targets: readonly { readonly path: CanonicalAbsolutePathV1; readonly size: number }[],
): FoundationParticipantRefV1 {
  return {
    id: id as FoundationParticipantRefV1["id"],
    slot,
    role,
    mutations: targets.map((target, index) => ({
      targetPath: target.path,
      operation: "replace",
      expectedBeforeHash: WIDEST_HASH,
      contentHash: WIDEST_HASH,
      contentSize: target.size,
      stagedPath: canonical(`${productHome}/staging/transactions/${id}/${String(index)}.bin`),
    })),
    maximumJournalBytes: MAX_JOURNAL_BYTES,
    planHash: WIDEST_HASH,
    initialJournal: {
      finalPath: canonical(`${productHome}/state/transactions/${id}.json`),
      plannedBytesHash: WIDEST_HASH,
      stagedPath: canonical(`${productHome}/staging/lifecycle/${coordinatorId}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: WIDEST_HASH, size: MAX_JOURNAL_BYTES, mode: 384, dev: WIDEST_UINT64, ino: WIDEST_UINT64 },
    },
  };
}

function placeholderFoundation(inputs: AutomationApplyInputsV1, coordinatorId: string, ids: readonly string[]): readonly FoundationParticipantRefV1[] {
  const { home, files, preview } = inputs.planned;
  const [plist, plistInverse, activation, activationInverse, config] = ids as [string, string, string, string, string];
  const productHome = home.key.productHome;
  const plists = mutatedEntries(preview.launchd as LaunchdPlanPreviewV1).map((entry) => ({
    path: entry.plistPath,
    size: Math.max(entry.plistBytes === null ? 0 : encoder.encode(entry.plistBytes).byteLength, inputs.planned.retained.get(entry.job)?.bytes.byteLength ?? 0),
  }));
  const activationTarget = [{ path: home.authority.activationPath, size: files.activation.byteLength }];
  return [
    placeholderRef(productHome, coordinatorId, plist, "plist_files", { kind: "forward", compensationId: plistInverse as AllocatedLifecycleIdV1<"tx"> }, plists),
    placeholderRef(productHome, coordinatorId, plistInverse, "plist_files", { kind: "compensation", forwardId: plist as AllocatedLifecycleIdV1<"tx"> }, plists),
    placeholderRef(productHome, coordinatorId, activation, "activation", { kind: "forward", compensationId: activationInverse as AllocatedLifecycleIdV1<"tx"> }, activationTarget),
    placeholderRef(productHome, coordinatorId, activationInverse, "activation", { kind: "compensation", forwardId: activation as AllocatedLifecycleIdV1<"tx"> }, activationTarget),
    placeholderRef(productHome, coordinatorId, config, "config", { kind: "forward", compensationId: null }, [{ path: home.authority.configPath, size: files.config.byteLength }]),
  ];
}

function manifestLeaf(inputs: AutomationApplyInputsV1, coordinatorId: string, participantId: string, forwardIds: readonly string[]): ManifestStatePlanV1 {
  const { home, files } = inputs.planned;
  const before = home.manifestFile.entry;
  const payload = inputs.staged?.payload ?? { dev: WIDEST_UINT64, ino: WIDEST_UINT64 };
  const afterHash = sha256(files.manifest);
  return {
    schemaVersion: 1,
    participantId: participantId as ManifestStatePlanV1["participantId"],
    envelope: { kind: "lifecycle", id: coordinatorId as LifecycleCoordinatorIdV1 },
    bindings: {
      foundationTransactions: { count: forwardIds.length, orderedIdsHash: foundationBindingsHash(forwardIds) },
      externalEffects: [],
    },
    manifestPath: home.authority.manifestPath,
    tombstonePath: canonical(join(dirname(home.authority.manifestPath), `.installation-manifest.${participantId}.json.tombstone`)),
    before: { state: "present", hash: home.manifestFile.hash, bytes: null, ownerUid: before.ownerUid, mode: 0o600, nlink: 1, size: before.size, dev: before.dev, ino: before.ino },
    after: {
      state: "present",
      hash: afterHash,
      bytes: {
        kind: "update_expected",
        coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
        ordinal: 0,
        path: deriveManifestPayloadPath(home.key.productHome, coordinatorId as never, participantId as never),
        hash: afterHash,
        bytes: files.manifest.byteLength,
        mode: 0o600,
      },
      ownerUid: before.ownerUid,
      mode: 0o600,
      nlink: 1,
      size: parseUInt64Decimal(String(files.manifest.byteLength)),
      dev: parseUInt64Decimal(payload.dev),
      ino: parseUInt64Decimal(payload.ino),
    },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: MAX_JOURNAL_BYTES,
  };
}

/** The conservative pass hands `build` `tx_` placeholders, which a `le_` binding must keep the width of. */
function effectId(id: string | null): string | null {
  return id === null || id.startsWith("le_") ? id : `le${id.slice(2)}`;
}

function widestIdentity(entry: LaunchdPlanPreviewEntryV1, hash: LowerHexSha256, size: number, uid: number): LaunchdBootstrapPlistIdentityV1 {
  return { path: entry.plistPath, ownerUid: parseEffectiveUid(uid, uid), mode: 384, nlink: 1, size, hash, dev: WIDEST_UINT64, ino: WIDEST_UINT64 };
}

/** Before staging, every unknown inode is the widest decimal; `keep` binds its one retained inode in both arms. */
function placeholderBootstrap(inputs: AutomationApplyInputsV1): Readonly<Partial<Record<ScheduledJobIdV1, LaunchdBootstrapPlistsV1>>> {
  const launchd = inputs.planned.preview.launchd as LaunchdPlanPreviewV1;
  return Object.fromEntries(
    launchd.entries.map((entry) => {
      const kept = inputs.planned.retained.get(entry.job);
      if (entry.operation === "keep" && kept !== undefined) return [entry.job, { before: kept.identity, after: kept.identity }];
      const uid = Number(entry.domain.slice("gui/".length));
      const loaded = entry.beforeLiveState.state === "loaded";
      const before = loaded && kept !== undefined ? widestIdentity(entry, kept.identity.hash, kept.identity.size, uid) : null;
      const after = entry.plistBytes === null ? null : widestIdentity(entry, sha256(entry.plistBytes), encoder.encode(entry.plistBytes).byteLength, uid);
      return [entry.job, { before, after }];
    }),
  );
}

const MUTATION_STEPS: Readonly<Record<AutomationOperationV1, readonly ("P" | "M0" | "Fp" | "Fa" | "M1" | "Q" | "Fc" | "M2")[]>> = {
  automation_enable: ["M0", "Fp", "Fa", "M1", "Q", "Fc", "M2"],
  automation_reconcile: ["P", "M0", "Fp", "Fa", "M1", "Q", "Fc", "M2"],
  automation_disable: ["P", "M0", "Fp", "Fa", "M1", "Fc", "M2"],
};

function reservationOf(inputs: AutomationApplyInputsV1): LifecycleLeafReservationV1 {
  const effects = (hasEffect(inputs, "before") ? 1 : 0) + (hasEffect(inputs, "after") ? 1 : 0);
  const refs = inputs.planned.liveOnly ? 0 : 5;
  // Each plist appears in both `plist_files` refs; activation twice and config once.
  const mutations = inputs.planned.liveOnly ? 0 : 3 + 2 * mutatedEntries(inputs.planned.preview.launchd as LaunchdPlanPreviewV1).length;
  return {
    foundationJournals: 3 * refs,
    coordinatorJournals: 3,
    gitEffectJournals: 0,
    launchdEffectJournals: 4 * effects,
    foundationStaging: refs + 3 * mutations,
    foundationBackups: refs + 5 * mutations,
    lifecycleStaging: 2 + 2 * refs + (inputs.planned.liveOnly ? 0 : 4) + 4,
  };
}

function automationBuilder(inputs: AutomationApplyInputsV1): LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> {
  const before = hasEffect(inputs, "before");
  const after = hasEffect(inputs, "after");
  const { liveOnly } = inputs.planned;
  return {
    slotCount: liveOnly ? 2 : 6 + (before ? 1 : 0) + (after ? 1 : 0) + 1,
    build(ids) {
      const all = ids.map(String);
      const coordinatorId = all[0] as string;
      const foundationIds = liveOnly ? [] : all.slice(1, 6);
      const effects = all.slice(liveOnly ? 1 : 6, all.length - (liveOnly ? 0 : 1));
      const beforeId = before ? (effects[0] ?? null) : null;
      const afterId = after ? (effects.at(-1) ?? null) : null;
      const participantId = String(all.at(-1));
      const { home, files, preview, operation } = inputs.planned;
      const launchdPreview = preview.launchd as LaunchdPlanPreviewV1;
      const foundation = liveOnly ? [] : (inputs.staged?.foundation ?? placeholderFoundation(inputs, coordinatorId, foundationIds));
      const [plistId, , activationId, , configId] = foundationIds;
      const manifest = liveOnly ? null : manifestLeaf(inputs, coordinatorId, participantId, [String(plistId), String(activationId), String(configId)]);
      const preserved = (path: CanonicalAbsolutePathV1, bytes: Uint8Array | null): LifecycleFileBindingV1 => {
        const hash = bytes === null ? recoveryRequired("automation_live_only_file_absent", path) : sha256(bytes);
        return { participantId: null, targetPath: path, expectedBeforeHash: hash, afterHash: hash };
      };
      const bound = (participant: string | undefined, path: CanonicalAbsolutePathV1, beforeBytes: Uint8Array | null, afterBytes: Uint8Array): LifecycleFileBindingV1 => ({
        participantId: participant as LifecycleFileBindingV1["participantId"],
        targetPath: path,
        expectedBeforeHash: beforeBytes === null ? null : sha256(beforeBytes),
        afterHash: sha256(afterBytes),
      });
      const launchd = planLaunchdTransitions({
        coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
        coordinatorOperation: operation,
        previewHash: preview.previewHash,
        processTableHash: inputs.staged?.processTableHash ?? WIDEST_HASH,
        preview: launchdPreview,
        config: liveOnly ? preserved(home.authority.configPath, home.configFile.bytes) : bound(configId, home.authority.configPath, home.configFile.bytes, files.config),
        activation: liveOnly ? preserved(home.authority.activationPath, home.activationFile.bytes) : bound(activationId, home.authority.activationPath, home.activationFile.bytes, files.activation),
        plistFiles: liveOnly
          ? []
          : mutatedEntries(launchdPreview)
              .map((entry) => ({
                participantId: plistId as LifecycleFileBindingV1["participantId"],
                targetPath: entry.plistPath,
                expectedBeforeHash: entry.beforeFileHash,
                afterHash: entry.plistBytes === null ? null : sha256(entry.plistBytes),
              }))
              .sort((left, right) => Buffer.compare(Buffer.from(left.targetPath), Buffer.from(right.targetPath))),
        manifest: {
          path: home.authority.manifestPath,
          statePlanHash: manifest === null ? null : hashCanonicalJson(MANIFEST_STATE_PLAN_DOMAIN, manifest as unknown as CanonicalJsonValue),
          before: { state: "present", hash: home.manifestFile.hash },
          after: { state: "present", hash: liveOnly ? home.manifestFile.hash : sha256(files.manifest) },
        },
        beforeFilesEffectId: effectId(beforeId) as LaunchdEffectIdV1 | null,
        afterFilesEffectId: effectId(afterId) as LaunchdEffectIdV1 | null,
        bootstrapPlists: inputs.staged?.bootstrap ?? placeholderBootstrap(inputs),
      });
      const beforeRef = launchd.beforeFilesEffect;
      const afterRef = launchd.afterFilesEffect;
      const stepOf = (template: (typeof MUTATION_STEPS)[AutomationOperationV1][number]): LifecycleCoordinatorStepV1 => {
        switch (template) {
          case "P":
            return { kind: "launchd_before_files", participantId: (beforeRef ?? recoveryRequired("launchd_effect_unbound", coordinatorId)).id };
          case "Q":
            return { kind: "launchd_after_files", participantId: (afterRef ?? recoveryRequired("launchd_effect_unbound", coordinatorId)).id };
          case "M0":
            return { kind: "manifest", transition: "preserve_before" };
          case "M1":
            return { kind: "manifest", transition: "publish_after" };
          case "M2":
            return { kind: "manifest", transition: "finalize_tombstones" };
          case "Fp":
            return { kind: "foundation", slot: "plist_files", participantId: plistId as AllocatedLifecycleIdV1<"tx"> };
          case "Fa":
            return { kind: "foundation", slot: "activation", participantId: activationId as AllocatedLifecycleIdV1<"tx"> };
          case "Fc":
            return { kind: "foundation", slot: "config", participantId: configId as AllocatedLifecycleIdV1<"tx"> };
        }
      };
      const base: LifecycleExecutionPlanV1 = {
        schemaVersion: 1,
        id: coordinatorId as LifecycleCoordinatorIdV1,
        previewHash: preview.previewHash,
        operation,
        maximumJournalBytes: 1,
        authority: { ...home.authority, repositoryRoot: null, plistPaths: launchd.plistFiles.map((binding) => binding.targetPath) },
        participants: {
          foundation: [...foundation].sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))),
          manifest,
          sourceGitEffect: null,
          destinationGitEffect: null,
          launchdBeforeFiles: beforeRef,
          launchdAfterFiles: afterRef,
          launchd,
          redactionKey: null,
        },
        push: null,
        steps: liveOnly ? [stepOf("Q")] : MUTATION_STEPS[operation].map(stepOf),
      };
      return { plan: { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) }, reservation: reservationOf(inputs) };
    },
  };
}

type FoundationMutationsV1 = Parameters<FoundationParticipantExecutor["stage"]>[0]["mutations"];

/** Each plist's forward mutation and its inverse, so a rollback restores exactly the observed bytes. */
function plistMutations(inputs: AutomationApplyInputsV1): { readonly forward: FoundationMutationsV1; readonly inverse: FoundationMutationsV1 } {
  const pairs = mutatedEntries(inputs.planned.preview.launchd as LaunchdPlanPreviewV1).map((entry) => {
    const before = inputs.planned.retained.get(entry.job)?.bytes ?? null;
    const after = entry.plistBytes === null ? null : encoder.encode(entry.plistBytes);
    const operationOf = (from: Uint8Array | null, to: Uint8Array | null): "create" | "replace" | "remove" =>
      from === null ? "create" : to === null ? "remove" : "replace";
    return {
      forward: { targetPath: entry.plistPath, operation: operationOf(before, after), expectedBeforeHash: before === null ? null : sha256(before), content: after },
      inverse: { targetPath: entry.plistPath, operation: operationOf(after, before), expectedBeforeHash: after === null ? null : sha256(after), content: before },
    };
  });
  return { forward: pairs.map((pair) => pair.forward), inverse: pairs.map((pair) => pair.inverse).reverse() };
}

async function stageFoundation(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  inputs: AutomationApplyInputsV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  [plist, plistInverse, activation, activationInverse, config]: readonly string[],
): Promise<readonly FoundationParticipantRefV1[]> {
  const foundation = gitAdapters(context, lifecycle, NO_PUSH).foundation;
  const { home, files } = inputs.planned;
  const stage = (id: string | undefined, slot: FoundationParticipantRefV1["slot"], role: FoundationParticipantRefV1["role"], mutations: FoundationMutationsV1): Promise<FoundationParticipantRefV1> =>
    foundation.stage({ coordinatorId, id: id as FoundationTransactionIdV1, slot, role, createdAt: inputs.createdAt, mutations });
  const plists = plistMutations(inputs);
  const activationBefore = home.activationFile.bytes;
  return [
    await stage(plist, "plist_files", { kind: "forward", compensationId: plistInverse as AllocatedLifecycleIdV1<"tx"> }, plists.forward),
    await stage(plistInverse, "plist_files", { kind: "compensation", forwardId: plist as AllocatedLifecycleIdV1<"tx"> }, plists.inverse),
    await stage(activation, "activation", { kind: "forward", compensationId: activationInverse as AllocatedLifecycleIdV1<"tx"> }, [
      { targetPath: home.authority.activationPath, operation: activationBefore === null ? "create" : "replace", expectedBeforeHash: home.activationFile.hash, content: files.activation },
    ]),
    await stage(activationInverse, "activation", { kind: "compensation", forwardId: activation as AllocatedLifecycleIdV1<"tx"> }, [
      { targetPath: home.authority.activationPath, operation: activationBefore === null ? "remove" : "replace", expectedBeforeHash: sha256(files.activation), content: activationBefore },
    ]),
    await stage(config, "config", { kind: "forward", compensationId: null }, [
      { targetPath: home.authority.configPath, operation: "replace", expectedBeforeHash: home.configFile.hash, content: files.config },
    ]),
  ];
}

/**
 * §5.3 `bootstrapPlists`: `after` is the staged postimage Foundation publishes, `before` the staged
 * preimage its paired inverse restores, and `keep` the one retained inode in both arms.
 */
async function stagedBootstrap(
  lifecycle: CliLifecycleContext,
  inputs: AutomationApplyInputsV1,
  foundation: readonly FoundationParticipantRefV1[],
): Promise<Readonly<Partial<Record<ScheduledJobIdV1, LaunchdBootstrapPlistsV1>>>> {
  const placeholders = placeholderBootstrap(inputs);
  const [forward, inverse] = foundation;
  const stagedIdentity = async (ref: FoundationParticipantRefV1 | undefined, placeholder: LaunchdBootstrapPlistIdentityV1 | null): Promise<LaunchdBootstrapPlistIdentityV1 | null> => {
    if (placeholder === null || placeholder.dev !== WIDEST_UINT64) return placeholder;
    const stagedPath = ref?.mutations.find((mutation) => mutation.targetPath === placeholder.path)?.stagedPath ?? null;
    // identity-free stat: the guarded port already returns an exact decimal identity.
    const entry = stagedPath === null ? null : await lifecycle.fs.lstat(stagedPath);
    if (entry?.kind !== "regular_file") return recoveryRequired("automation_bootstrap_plist_unstaged", placeholder.path);
    return { ...placeholder, dev: entry.dev, ino: entry.ino };
  };
  const bound: Partial<Record<ScheduledJobIdV1, LaunchdBootstrapPlistsV1>> = {};
  for (const job of SCHEDULED_JOB_IDS) {
    const arms = placeholders[job];
    if (arms === undefined) continue;
    bound[job] = { before: await stagedIdentity(inverse, arms.before), after: await stagedIdentity(forward, arms.after) };
  }
  return bound;
}

async function executeCoordinator(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  key: LifecycleHomeKeyV1,
  id: LifecycleCoordinatorIdV1,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const coordinator = new LifecycleCoordinator<LifecycleExecutionPlanV1>({
    store: lifecycle.store(key),
    adapters: gitAdapters(context, lifecycle, NO_PUSH),
    variantFacts: lifecycleVariantFacts,
    pushPlanHash: lifecyclePushPlanHash,
    clock: lifecycle.clock,
    fs: lifecycle.fs,
  });
  const result = await coordinator.execute(id, global);
  if (result.outcome.kind !== "finalized") {
    refuse("automation_lifecycle_rolled_back", EXIT_CODES.recoveryRequired, [key.productHome], "developer-os automation status");
  }
}

// ---------------------------------------------------------------------------------------------
// Status

function activationArm(home: GitHomeV1): "absent" | "inactive" | "active" | "mismatched" {
  const arm = home.activation?.automation;
  if (arm === undefined) return "absent";
  if (arm.state === "inactive") return "inactive";
  const lifecycleConfig = home.config.automation.lifecycle;
  return lifecycleConfig !== undefined && arm.configHash === lifecycleConfigHash("automation", lifecycleConfig) ? "active" : "mismatched";
}

async function lastRunOf(lifecycle: CliLifecycleContext, productHome: CanonicalAbsolutePathV1, job: ScheduledJobIdV1): Promise<AutomationJobStatusV1["lastRun"]> {
  // identity-free stat: the guarded port already returns an exact decimal identity.
  const entry = await lifecycle.fs.lstat(automationStatusPath(productHome, job));
  if (entry === null || (entry.kind === "regular_file" && entry.size === "0")) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== lifecycle.effectiveUid) return "invalid";
  try {
    return parseAutomationStatusRecord(await lifecycle.fs.readRegular(entry, MAX_AUTOMATION_STATUS_BYTES));
  } catch {
    return "invalid";
  }
}

/** What the current eligible configuration would install; null when no executable is verified. */
async function currentLabels(lifecycle: CliLifecycleContext, context: CliContext, home: GitHomeV1): Promise<ReadonlyMap<ScheduledJobIdV1, GeneratedLaunchdLabelV1> | null> {
  const lifecycleConfig = home.config.automation.lifecycle;
  if (!home.config.automation.enabled || lifecycleConfig === undefined) return new Map();
  let executablePath: CanonicalAbsolutePathV1;
  try {
    executablePath = await verifiedAutomationExecutable(lifecycle, home.key.productHome, home.manifest);
  } catch (error) {
    if (error instanceof AutomationCommandRefusal) return null;
    throw error;
  }
  const eligible = { ...lifecycleConfig, schedules: lifecycleConfig.schedules.filter((entry) => entry.job !== "git-sync" || gitEligible(home)) };
  const draft = buildLaunchdPlanPreview({
    observationProcessTableHash: launchdObservationProcessTableHash(LAUNCHD_PREVIEW_OBSERVATION_TABLE),
    mutationProcessTableTemplateHash: launchdProcessTableTemplateHash(launchdTemplate(lifecycle)),
    domain: domainOf(lifecycle),
    userHome: canonical(context.userHome),
    productHome: parseScheduledProductHome(home.key.productHome),
    executablePath,
    automation: eligible,
    prior: Object.fromEntries(SCHEDULED_JOB_IDS.map((job) => [job, UNLOADED])) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>,
  });
  return new Map(draft.entries.flatMap((entry) => (entry.generatedLabel === null ? [] : [[entry.job, entry.generatedLabel] as const])));
}

// ---------------------------------------------------------------------------------------------
// Service

export function createAutomationService(context: CliContext, lifecycle: CliLifecycleContext): AutomationService {
  const planTarget = async (home: GitHomeV1, target: AutomationConfigV1, gardenAgent: GardenAgentV1 | null): Promise<PlannedAutomationV1> =>
    planAutomation(context, lifecycle, home, target, await gardenPin(context, home, target, gardenAgent));

  const planEnable = (home: GitHomeV1, flags: readonly string[], gardenAgent: GardenAgentV1 | null): Promise<PlannedAutomationV1> =>
    planTarget(home, targetSchedules(home, flags), gardenAgent);

  const planDisable = async (home: GitHomeV1): Promise<PlannedAutomationV1> => {
    requireEnabledSomewhere(home, (await retainedPlists(context, lifecycle, home)).size > 0);
    return planAutomation(context, lifecycle, home, null, home.config.automation.brainGarden);
  };

  const applyPreview = async (
    preview: LifecyclePlanPreviewV1,
    global: HeldLifecycleStableLockV1,
    gardenAgent: GardenAgentV1 | null,
  ): Promise<AutomationCommandResultV1> => {
    const projection = preview.normalizedProjection;
    if (projection.subsystem !== "automation" || preview.launchd === null) refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
    const prepared = await prepareUnderLock(context, lifecycle, global);
    requireClear(prepared, context.paths);
    const stale = (): never =>
      refuse("lifecycle_preview_stale", EXIT_CODES.decisionRequired, [context.paths.home], "plan again with the same command without --apply");
    let planned: PlannedAutomationV1;
    if (preview.command === "automation_enable") {
      const { home } = prepared;
      let target: AutomationConfigV1;
      try {
        target = reconcileAutomationSchedules({ prior: projection.lifecycle, flags: [], gitEligible: gitEligible(home) });
      } catch (error) {
        if (!(error instanceof LaunchdInputError)) throw error;
        return stale();
      }
      planned = await planTarget(home, target, gardenAgent);
    } else {
      planned = await planDisable(prepared.home);
    }
    if (planned.preview.previewHash !== preview.previewHash) stale();

    const inputs: AutomationApplyInputsV1 = { planned, createdAt: lifecycle.clock(), staged: null };
    const builder = automationBuilder(inputs);
    const { home } = planned;
    assertLifecycleExecutionFeasible(builder, prepared.snapshot, lifecycle.codecs(home.key).executionPlan);
    const ids = await reserveIds(context, lifecycle, global, prepared.snapshot, prefixesOf(builder));
    const coordinatorId = parseLifecycleCoordinatorId(ids[0], home.key.nonce);
    const store = lifecycle.store(home.key);
    await store.ensureStagingDirectory(coordinatorId, global);
    const effectPlans: CanonicalAbsolutePathV1[] = [];
    try {
      const foundation = planned.liveOnly ? [] : await stageFoundation(context, lifecycle, inputs, coordinatorId, ids.slice(1, 6));
      const payload = planned.liveOnly
        ? { dev: WIDEST_UINT64, ino: WIDEST_UINT64 }
        : await stageManifestPayload(home.key.productHome, coordinatorId, String(ids.at(-1)), planned.files.manifest);
      const processTableHash = await stageLaunchdProcessTable(lifecycle, home.key.productHome, coordinatorId, planned.template);
      inputs.staged = { foundation, payload, processTableHash, bootstrap: await stagedBootstrap(lifecycle, inputs, foundation) };
      const { plan } = builder.build(ids);
      const journals = new LaunchdEffectJournalStore({ fs: lifecycle.fs, roots: lifecycle.roots, locks: lifecycle.transactionLocks, uuid: lifecycle.uuid });
      const launchd = plan.participants.launchd;
      if (launchd === null) recoveryRequired("launchd_effect_unbound", coordinatorId);
      for (const position of ["before_files", "after_files"] as const) {
        const effect = launchdEffectPlan(launchd, position);
        if (effect === null) continue;
        effectPlans.push(canonical(join(lifecycle.roots.launchdEffectJournals, `${effect.id}.plan.json`)));
        await journals.publishPlan(effect);
      }
      await store.publish(plan, global);
    } catch (error) {
      await abandonUnpublishedIntent(lifecycle, context.paths.home, coordinatorId, effectPlans);
      throw error;
    }
    await executeCoordinator(context, lifecycle, home.key, coordinatorId, global);
    await settle(context, lifecycle, home.key, prepared.residue, global);
    if (!planned.liveOnly) await reanchorManifest(context, lifecycle, home.manifestFile.hash, planned.files.manifest);
    return {
      exitCode: EXIT_CODES.success,
      data: { kind: "applied", operation: planned.operation, transactionId: coordinatorId, previewHash: planned.preview.previewHash },
    };
  };

  const status = async (): Promise<AutomationCommandResultV1> => {
    const home = await observeHome(context, lifecycle);
    const states = new Map<ScheduledJobIdV1, PlistStateV1>();
    for (const job of SCHEDULED_JOB_IDS) states.set(job, await inspectPlist(context, lifecycle, home, job));
    const expected = await currentLabels(lifecycle, context, home);
    const retained = [...states.values()].flatMap((state) => (state.kind === "retained" ? [state.plist] : []));
    let distribution = await launchdDistribution(lifecycle);
    let live: ReadonlyMap<ScheduledJobIdV1, LaunchdLiveStateV1 | "third_state"> | null = null;
    try {
      live = await observeLiveStates(lifecycle, retained.map((plist) => ({ job: plist.job, retained: plist.label, planned: null })), home.key.productHome);
    } catch (error) {
      if (!(error instanceof LaunchdDistributionUnsupportedError || error instanceof LifecycleRecoveryRequiredError)) throw error;
      if (error instanceof LaunchdDistributionUnsupportedError) distribution = "unsupported_launchd_distribution";
    }
    const schedules = home.config.automation.lifecycle?.schedules ?? [];
    const jobs: AutomationJobStatusV1[] = [];
    for (const job of SCHEDULED_JOB_IDS) {
      const state = states.get(job) ?? { kind: "absent" };
      const eligible = home.config.automation.enabled && activationArm(home) === "active" && (job !== "git-sync" || gitEligible(home));
      const current = expected?.get(job);
      const installed =
        state.kind !== "retained" ? state.kind : eligible && current !== undefined && current === state.plist.label ? "current" : "stale";
      const liveState = live?.get(job);
      jobs.push({
        job,
        schedule: schedules.find((entry) => entry.job === job)?.schedule ?? null,
        eligible,
        installed,
        live: liveState === undefined ? null : liveState === "third_state" ? liveState : liveState.state,
        lastRun: await lastRunOf(lifecycle, home.key.productHome, job),
      });
    }
    const snapshot = await lifecycle.inspectLedger(home.key, await residueOf(context));
    return {
      exitCode: EXIT_CODES.success,
      data: {
        kind: "status",
        enabled: home.config.automation.enabled,
        activation: activationArm(home),
        distribution,
        closure: snapshot.closure.kind,
        jobs,
      },
    };
  };

  return {
    previewEnable: async (schedules, gardenAgent = null) =>
      (await planEnable(await observeHome(context, lifecycle), schedules, gardenAgent)).preview,
    applyEnable: (preview, global, gardenAgent = null) => {
      if (preview.command !== "automation_enable") refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
      return applyPreview(preview, global, gardenAgent);
    },
    previewDisable: async () => (await planDisable(await observeHome(context, lifecycle))).preview,
    applyDisable: (preview, global) => {
      if (preview.command !== "automation_disable") refuse("lifecycle_preview_invalid", EXIT_CODES.invalidInput);
      return applyPreview(preview, global, null);
    },
    status,
  };
}
