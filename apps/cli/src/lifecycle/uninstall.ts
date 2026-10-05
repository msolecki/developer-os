/**
 * Spec 1 §6 steps 1–4 as amended by A14–A16 and D24–D28: `uninstall` on an admitted V2 home is
 * one coordinator — marker, lease drain, artifact removal, key tombstone, manifest tombstone —
 * that leaves exactly the A12 bookkeeping set plus retained bootstrap evidence. Planning happens
 * under the global mutation lock and allocates nothing, so every refusal below fires before
 * `reserveLifecycleIdBlock` moves the counter.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";

import { CODEX_HOOK_TRUST_RESIDUE } from "@developer-os/adapter-codex";

import {
  EXIT_CODES,
  FoundationParticipantExecutor,
  LifecycleCoordinator,
  LifecycleRecoveryRequiredError,
  LIFECYCLE_LEASE_DRAIN_MS,
  LIFECYCLE_UNINSTALL_ARTIFACT_STEPS,
  ManifestStateParticipant,
  SCHEDULED_JOB_IDS,
  TransactionExecutor,
  allocatedCounterOf,
  assertLifecycleExecutionFeasible,
  cleanLifecycleAllocatorTemp,
  decodeCanonicalJson,
  deriveUninstallLaunchdEvidence,
  encodeUninstallingMarker,
  formatAllocatedLifecycleId,
  foundationParticipantPlanHash,
  hashBytes,
  hashCanonicalJson,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  loadConfig,
  CODEX_INGEST_HOME_RELATIVE_PATH,
  HOOK_FIRING_RECORDS_RELATIVE_PATH,
  inspectCodexIngestHomeShape,
  inspectHookFiringRecordsShape,
  inspectLifecycleAllocator,
  lifecycleBookkeepingPaths,
  MAX_HOOK_FIRING_RECORD_CHILDREN,
  maximumCoordinatorJournalBytes,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseManifestParticipantId,
  reserveLifecycleIdBlock,
  validateManifestV2,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  FoundationParticipantRefV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LaunchdEffectIdV1,
  LifecycleCoordinatorBoundaryV1,
  LifecycleCoordinatorIdV1,
  LifecycleBookkeepingObservationV1,
  LifecycleExecutionBuilderV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleLeafReservationV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  LowerHexSha256,
  ManagedArtifactV1,
  ManagedArtifactV2,
  ManifestAdmissionContextV1,
  ManifestStatePlanV1,
  RuntimePaths,
  ScheduledJobIdV1,
  UtcTimestampV1,
  FoundationTransactionIdV1,
  AllocatedLifecycleIdV1,
} from "@developer-os/core";
import {
  LAUNCHD_PREVIEW_OBSERVATION_TABLE,
  LaunchdDistributionUnsupportedError,
  LaunchdEffectJournalStore,
  MAX_LAUNCHD_PLIST_BYTES,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  admitLaunchdHost,
  assertLaunchdPlanBindings,
  buildLaunchdPlanPreview,
  launchdEffectPlan,
  launchdGuiDomain,
  launchdObservationProcessTableHash,
  launchdPlistPath,
  launchdProcessTableHash,
  launchdProcessTableTemplateHash,
  loadLaunchdProcessTable,
  parseCanonicalLaunchdPlist,
  parseGeneratedLabel,
  parseScheduledProductHome,
  planLaunchdTransitions,
  scheduledArgvParts,
} from "@developer-os/platform-macos";
import type {
  GeneratedLaunchdLabelV1,
  LaunchdBootstrapPlistIdentityV1,
  LaunchdGenerationV1,
  LaunchdLiveStateV1,
  LaunchdObserver,
  LaunchdPlanPreviewV1,
  LaunchdPlanV1,
  LaunchdPriorJobStateV1,
  LifecycleFileBindingV1,
  SupportedLaunchdProcessTableTemplateV1,
} from "@developer-os/platform-macos";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
import { preservedRetentionRoots } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import { readConfigFile } from "../commands/doctor.js";
import {
  downcastArtifactV2,
  planUninstall,
  removeDirectories,
  UninstallRefusal,
} from "../commands/uninstall.js";
import type {
  RevertRequest,
  UninstallOptions,
  UninstallResultV1,
} from "../commands/uninstall.js";
import { runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";
import { unregisterCodexPlugin } from "../instructions/codex-registration.js";
import { planInstructionDetach } from "../instructions/detach.js";
import type { InstructionDetachInputV1, InstructionDetachPlanV1, InstructionFileSystemV1 } from "../instructions/detach.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { createLifecycleEffectAdapters, refuseUnsupportedLaunchd } from "./adapters.js";
import { observeLifecycleActivationRecord, observeManifestSchema, V2HomeAdmissionError } from "./admission.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import {
  lifecyclePushPlanHash,
  lifecycleVariantFacts,
  uninstallLeasePaths,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { uninstallResidueFrom } from "./context.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import { isCodeDefect, MANIFEST_ANCHOR_WARNING, removeManifestAnchor } from "./manifest-anchor.js";
import { withLifecycleMutation } from "./mutation-gate.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "./context.js";
import {
  assertNoRedactionKeyTombstone,
  deleteRedactionKey,
  observeRedactionKeyState,
  observeSecretOpaqueKey,
  redactionKeySourcePath,
  redactionKeyTombstonePath,
  restoreRedactionKey,
  stageRedactionKey,
} from "./redaction-key.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

const GLOBAL_LOCK_LEAF = ".lifecycle.lock";
const MARKER_LEAF = "uninstalling.json";
const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
const NONCE_LEAF = "lifecycle-install-nonce";
const ACTIVATION_LEAF = "lifecycle-activation.json";
/** §2.4's `FoundationParticipantRefV1.mutations[1..256]`, per `F(uninstall_artifacts)` step. */
const MAX_ARTIFACTS_PER_STEP = 256;
/** D45: 31 steps of 256, the 7,936-mutation ceiling. */
export const MAX_UNINSTALL_ARTIFACTS = MAX_ARTIFACTS_PER_STEP * LIFECYCLE_UNINSTALL_ARTIFACT_STEPS.maximum;
const MAX_MUTATION_BYTES = 16_777_216;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_PLAN_BYTES = 16_777_216;
const MAX_JOURNAL_BYTES = 1_048_576;
const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";
const WIDEST_UINT64 = "18446744073709551615";
const WIDEST_HASH = "f".repeat(64);
/** No core codec hashes a `ManifestStatePlanV1` yet, and `assertLaunchdPlanBindings` does not recompute this one. */
export const MANIFEST_STATE_PLAN_DOMAIN = "developer-os:manifest-state-plan:v1";

const encoder = new TextEncoder();

export interface LifecycleUninstallRequestV1 {
  readonly context: CliContext;
  readonly lifecycle: CliLifecycleContext;
  readonly key: LifecycleHomeKeyV1;
  /** Present for a fresh uninstall; null when recovery resumes one whose manifest is already moved. */
  readonly admitted: AdmittedV2HomeV1 | null;
  readonly evidence: BootstrapEvidenceAdmissionV1;
  readonly options: UninstallOptions;
}

export interface LifecycleUninstallPreviewV1 {
  readonly variant: "uninstall/present_manifest" | "uninstall/present_manifest_without_launchd";
  readonly removable: readonly string[];
  readonly preserved: readonly string[];
  readonly builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1>;
}

export type UninstallBoundaryV1 =
  | LifecycleCoordinatorBoundaryV1
  | { readonly kind: "lease_path_removed"; readonly job: ScheduledJobIdV1 }
  | { readonly kind: "empty_directory_removed"; readonly path: CanonicalAbsolutePathV1 };

export type UninstallBoundaryHook = (boundary: UninstallBoundaryV1) => void | Promise<void>;

/**
 * Every hold the adapters take, so an aborted run releases the *current* global lock rather
 * than the handle the caller started with: `drainRunners` and `stepHooks.before` both release
 * and reacquire it, and a death between the two leaves the caller's handle stale and the live
 * one owned by nobody.
 */
export interface UninstallHoldsV1 {
  global: HeldLifecycleStableLockV1 | null;
  leases: readonly HeldLifecycleStableLockV1[];
}

export async function releaseUninstallHolds(holds: UninstallHoldsV1): Promise<void> {
  for (const lease of [...holds.leases].reverse()) await lease.release();
  holds.leases = [];
  await holds.global?.release();
}

/**
 * D26 is a capacity verdict and not a recovery state — D45 moves its threshold to 7,936 — so
 * nothing is durable when it fires. It joins §2.4's pre-reservation class rather than refusing
 * a home the user can still uninstall by removing artifacts by hand.
 */
export class UninstallCapacityError extends Error {
  readonly code: typeof EXIT_CODES.capabilityUnavailable = EXIT_CODES.capabilityUnavailable;
  readonly reason = "uninstall_artifact_capacity_exceeded" as const;
  readonly paths: readonly string[];

  constructor(count: number, productHome: string) {
    super(
      `the installation records ${String(count)} removable artifacts, more than the ${String(MAX_UNINSTALL_ARTIFACTS)} one uninstall can carry`,
    );
    this.name = "UninstallArtifactCapacityExceededError";
    this.paths = [productHome];
  }
}

export { refuseUnsupportedLaunchd };

/** identity-free stat: the guarded port takes a path and nothing else, and returns an already-exact decimal identity. */
function guardedEntry(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  return fs.lstat(path);
}

function canonical(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function stateLeaf(productHome: CanonicalAbsolutePathV1, leaf: string): CanonicalAbsolutePathV1 {
  return canonical(`${productHome}/state/${leaf}`);
}

function digestOf(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function refuse(reason: string, ...paths: readonly CanonicalAbsolutePathV1[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

async function syncDirectoryAt(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const entry = await guardedEntry(fs, path);
  if (entry === null) refuse("lifecycle_guarded_parent", path);
  await fs.syncDirectory(entry);
}

/** §6's closed external-plist rows: one per scheduled job, under the user's LaunchAgents. */
function externalPlistPaths(userHome: string): ReadonlySet<string> {
  return new Set(
    SCHEDULED_JOB_IDS.map((job) => join(userHome, "Library", "LaunchAgents", `com.developer-os.${job}.plist`)),
  );
}

/**
 * The unconfined owner-path authority §6 gives the manifest arm: the bytes this participant
 * moves are pinned to `ManifestStatePlanV1.before.hash`, and a recovering process has already
 * lost `config.toml` — so a confined admission would refuse every home whose Brain was not the
 * default one (I2).
 */
function unconfinedManifestAdmission(
  productHome: CanonicalAbsolutePathV1,
): ManifestAdmissionContextV1 {
  return {
    evidence: createCanonicalPathEvidence(),
    sourceRoot: productHome,
    backupRoot: canonical(`${productHome}/backups`),
    admitOwnerPath: createOwnerPathAdmission({
      kind: "unconfined",
      reason: "uninstall manifest bytes are hash-pinned to ManifestStatePlanV1.before.hash",
    }),
  };
}

function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return createHash("sha256")
    .update(FOUNDATION_BINDINGS_DOMAIN)
    .update(JSON.stringify(ids))
    .digest("hex") as LowerHexSha256;
}

interface ArtifactMutationV1 {
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly content: Uint8Array;
}

/**
 * D45: the lease-first removal order split into consecutive `F(uninstall_artifacts)` steps of at
 * most 256 mutations. The registry's runner leases lead that order, so they always land in the first
 * step, which is the one `admitsUninstallDraining` and the lease step hooks read. An empty
 * list keeps its single step, exactly as before chunking.
 */
export function chunkUninstallArtifacts<T>(
  artifacts: readonly T[],
  productHome: string,
): readonly (readonly T[])[] {
  if (artifacts.length > MAX_UNINSTALL_ARTIFACTS) {
    throw new UninstallCapacityError(artifacts.length, productHome);
  }
  const chunks: T[][] = [];
  for (let start = 0; start < artifacts.length; start += MAX_ARTIFACTS_PER_STEP) {
    chunks.push(artifacts.slice(start, start + MAX_ARTIFACTS_PER_STEP));
  }
  return chunks.length === 0 ? [[]] : chunks;
}

/** What `P` binds: the all-`remove` preview, the retained plist inodes, and the pinned mutation template. */
interface UninstallLaunchdInputsV1 {
  readonly preview: LaunchdPlanPreviewV1;
  readonly identities: ReadonlyMap<ScheduledJobIdV1, LaunchdBootstrapPlistIdentityV1>;
  readonly template: SupportedLaunchdProcessTableTemplateV1;
  /** Bound once the coordinator's `launchd-process` staging exists; null on the conservative pass. */
  processTableHash: LowerHexSha256 | null;
}

interface UninstallPlanInputsV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly configPath: CanonicalAbsolutePathV1;
  readonly activationPath: CanonicalAbsolutePathV1;
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly manifestBefore: LifecycleGuardedEntryV1;
  readonly manifestHash: LowerHexSha256;
  readonly keyBefore: RedactionKeyStatePlanV1["before"];
  readonly markerPreimage: ArtifactMutationV1;
  readonly chunks: readonly (readonly ArtifactMutationV1[])[];
  readonly createdAt: string;
  readonly launchd: UninstallLaunchdInputsV1 | null;
  refs: readonly FoundationParticipantRefV1[] | null;
}

/** D28's block: `lc`, the marker pair, one pair per artifact step, the `P` effect's `le`, then `mf` last. */
function slotCountOf(inputs: UninstallPlanInputsV1): number {
  return 4 + 2 * inputs.chunks.length + (inputs.launchd === null ? 0 : 1);
}

/**
 * The conservative feasibility pass hands `build` placeholder IDs of the widest legal width and
 * expects them bound by position, so nothing here may parse one. The real refs are bound after
 * staging; before that the mutation list — which dominates the measured size — is already exact
 * and only the staged identities are widened.
 */
function placeholderRefs(
  inputs: UninstallPlanInputsV1,
  coordinatorId: string,
  ids: readonly string[],
): readonly FoundationParticipantRefV1[] {
  /** An empty chunk keeps the one widened placeholder mutation this pass has always measured. */
  const targetsOf = (chunk: readonly ArtifactMutationV1[]): readonly CanonicalAbsolutePathV1[] =>
    chunk.length === 0
      ? [canonical(`${inputs.productHome}/state/0.placeholder`)]
      : chunk.map((mutation) => mutation.targetPath);
  const pairs = [
    { slot: "uninstall_marker" as const, forward: ids[0], compensation: ids[1], targets: [inputs.markerPreimage.targetPath] },
    ...inputs.chunks.map((chunk, index) => ({
      slot: "uninstall_artifacts" as const,
      forward: ids[2 + 2 * index],
      compensation: ids[3 + 2 * index],
      targets: targetsOf(chunk),
    })),
  ];
  const refs: FoundationParticipantRefV1[] = [];
  for (const pair of pairs) {
    for (const [index, id] of [pair.forward, pair.compensation].entries()) {
      const role = index === 0
        ? ({ kind: "forward", compensationId: pair.compensation } as FoundationParticipantRefV1["role"])
        : ({ kind: "compensation", forwardId: pair.forward } as FoundationParticipantRefV1["role"]);
      const core = {
        slot: pair.slot,
        role,
        /** The inverse recreates its chunk in reverse, exactly as the staged pair will. */
        mutations: (index === 0 ? pair.targets : [...pair.targets].reverse()).map((targetPath) => ({
          targetPath,
          operation: "remove" as const,
          expectedBeforeHash: WIDEST_HASH as LowerHexSha256,
          contentHash: null,
          contentSize: null,
          stagedPath: null,
        })),
        maximumJournalBytes: MAX_JOURNAL_BYTES,
        initialJournal: {
          finalPath: canonical(`${inputs.productHome}/state/transactions/${String(id)}.json`),
          plannedBytesHash: WIDEST_HASH as LowerHexSha256,
          stagedPath: canonical(
            `${inputs.productHome}/staging/lifecycle/${coordinatorId}/foundation/${String(id)}/journal.json`,
          ),
          stagedIdentity: {
            hash: WIDEST_HASH as LowerHexSha256,
            size: MAX_JOURNAL_BYTES,
            mode: 384 as const,
            dev: WIDEST_UINT64 as FoundationParticipantRefV1["initialJournal"]["stagedIdentity"]["dev"],
            ino: WIDEST_UINT64 as FoundationParticipantRefV1["initialJournal"]["stagedIdentity"]["ino"],
          },
        },
      };
      refs.push({
        id: String(id) as FoundationParticipantRefV1["id"],
        ...core,
        planHash: foundationParticipantPlanHash(core),
      });
    }
  }
  return refs;
}

function reservationFor(inputs: UninstallPlanInputsV1): LifecycleLeafReservationV1 {
  const artifacts = inputs.chunks.reduce((total, chunk) => total + Math.max(1, chunk.length), 0);
  const refs = 2 + 2 * inputs.chunks.length;
  return {
    /** Every participant a journal, its lock and one rewrite temp. */
    foundationJournals: 3 * refs,
    coordinatorJournals: 3,
    gitEffectJournals: 0,
    /** The `P` effect's plan, journal, lock and one rewrite temp. */
    launchdEffectJournals: inputs.launchd === null ? 0 : 4,
    /** Marker forward and its inverse stage one blob each; the artifact inverse stages one per row. */
    foundationStaging: refs + 3 * (1 + 1 + artifacts),
    foundationBackups: refs + 5 * (1 + 1 + artifacts),
    /**
     * The coordinator directory, its `foundation` child, one directory and one journal per ref,
     * and for `P` the `launchd-process` root, `home`, `tmp` and one bootstrap snapshot.
     */
    lifecycleStaging: 2 + 2 * refs + (inputs.launchd === null ? 0 : 4),
  };
}

function manifestLeafOf(
  inputs: UninstallPlanInputsV1,
  coordinatorId: string,
  participantId: string,
  forwardIds: readonly string[],
): ManifestStatePlanV1 {
  return {
    schemaVersion: 1,
    participantId: participantId as ManifestStatePlanV1["participantId"],
    envelope: { kind: "lifecycle", id: coordinatorId as LifecycleCoordinatorIdV1 },
    bindings: {
      foundationTransactions: {
        count: forwardIds.length,
        orderedIdsHash: foundationBindingsHash(forwardIds),
      },
      externalEffects: [],
    },
    manifestPath: inputs.manifestPath,
    tombstonePath: canonical(
      join(dirname(inputs.manifestPath), `.installation-manifest.${participantId}.json.tombstone`),
    ),
    before: {
      state: "present",
      hash: inputs.manifestHash,
      bytes: null,
      ownerUid: inputs.manifestBefore.ownerUid,
      mode: 0o600,
      nlink: 1,
      size: inputs.manifestBefore.size,
      dev: inputs.manifestBefore.dev,
      ino: inputs.manifestBefore.ino,
    },
    after: { state: "absent" },
    maximumPlanBytes: MAX_PLAN_BYTES,
    maximumJournalBytes: MAX_JOURNAL_BYTES,
  };
}

function byUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/**
 * Spec §5.3's uninstall `LaunchdPlanV1`: every entry a `remove`, `config`, the activation record
 * when it is an artifact and every plist bound to the exact removal in its artifact step, and a
 * reverse bootstrap bound to the retained inode of each loaded label.
 */
function uninstallLaunchdPlan(
  inputs: UninstallPlanInputsV1,
  launchd: UninstallLaunchdInputsV1,
  coordinatorId: string,
  effectId: string,
  artifactForwards: readonly FoundationParticipantRefV1[],
  manifest: ManifestStatePlanV1,
): LaunchdPlanV1 {
  const removals = new Map<string, LifecycleFileBindingV1>();
  inputs.chunks.forEach((chunk, index) => {
    const participantId = (artifactForwards[index]?.id ?? null) as LifecycleFileBindingV1["participantId"];
    for (const mutation of chunk) {
      removals.set(mutation.targetPath, {
        participantId,
        targetPath: mutation.targetPath,
        expectedBeforeHash: mutation.hash,
        afterHash: null,
      });
    }
  });
  const removal = (path: CanonicalAbsolutePathV1): LifecycleFileBindingV1 =>
    removals.get(path) ?? refuse("uninstall_launchd_file_unbound", path);
  return planLaunchdTransitions({
    coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
    coordinatorOperation: "uninstall",
    previewHash: null,
    processTableHash: launchd.processTableHash ?? (WIDEST_HASH as LowerHexSha256),
    preview: launchd.preview,
    config: removal(inputs.configPath),
    activation: removals.get(inputs.activationPath) ?? null,
    plistFiles: launchd.preview.entries
      .map((entry) => removal(entry.plistPath))
      .sort((left, right) => byUtf8(left.targetPath, right.targetPath)),
    manifest: {
      path: inputs.manifestPath,
      statePlanHash: hashCanonicalJson(MANIFEST_STATE_PLAN_DOMAIN, manifest as unknown as CanonicalJsonValue),
      before: { state: "present", hash: inputs.manifestHash },
      after: { state: "absent" },
    },
    beforeFilesEffectId: effectId as LaunchdEffectIdV1,
    afterFilesEffectId: null,
    bootstrapPlists: Object.fromEntries(
      launchd.preview.entries.map((entry) => [
        entry.job,
        {
          // NEW-138: a compensating reload reads the file Foundation's inverse re-creates through a
          // fresh inode, so the arm binds content only and the reader binds the inode it opens.
          before: entry.beforeLiveState.state === "loaded" ? contentBound(launchd.identities.get(entry.job)) : null,
          after: null,
        },
      ]),
    ),
  });
}

function contentBound(identity: LaunchdBootstrapPlistIdentityV1 | undefined): LaunchdBootstrapPlistIdentityV1 | null {
  return identity === undefined ? null : { ...identity, dev: null, ino: null };
}

/** The builder closes over its inputs so `execute` can bind the staged refs before it rebuilds. */
const BUILDER_INPUTS = new WeakMap<object, UninstallPlanInputsV1>();

function uninstallBuilder(
  inputs: UninstallPlanInputsV1,
): LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> {
  const builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> = {
    slotCount: slotCountOf(inputs),
    build(ids: readonly string[]) {
      const coordinatorId = String(ids[0]);
      const launchdInputs = inputs.launchd;
      const participantIds = ids.slice(1, launchdInputs === null ? -1 : -2);
      const effectId = String(ids.at(-2));
      const manifestId = String(ids.at(-1));
      const refs = inputs.refs ?? placeholderRefs(inputs, coordinatorId, participantIds);
      /**
       * Positional, never by ID: the conservative pass's placeholder IDs descend, so any order
       * read off the IDs would reverse the artifact steps between that pass and the real one.
       */
      const forwards = refs.filter((ref) => ref.role.kind === "forward");
      const [markerForward, ...artifactForwards] = forwards;
      if (
        markerForward?.slot !== "uninstall_marker" ||
        artifactForwards.length !== inputs.chunks.length ||
        artifactForwards.some((ref) => ref.slot !== "uninstall_artifacts")
      ) {
        throw new Error("the uninstall builder needs the marker pair and one pair per artifact step");
      }
      /** §8.1's plan codec requires `participants.foundation` in unsigned UTF-8 order by id. */
      const sorted = [...refs].sort((left, right) => byUtf8(left.id, right.id));
      const manifest = manifestLeafOf(
        inputs,
        coordinatorId,
        manifestId,
        forwards.map((ref) => ref.id),
      );
      /** The conservative pass's placeholders are all `tx_` IDs of the widest width, which `le_` keeps. */
      const launchd = launchdInputs === null
        ? null
        : uninstallLaunchdPlan(
            inputs,
            launchdInputs,
            coordinatorId,
            inputs.refs === null ? `le${effectId.slice(2)}` : effectId,
            artifactForwards,
            manifest,
          );
      const base: LifecycleExecutionPlanV1 = {
        schemaVersion: 1,
        id: coordinatorId as LifecycleCoordinatorIdV1,
        previewHash: null,
        operation: "uninstall",
        maximumJournalBytes: 1,
        authority: {
          productHome: inputs.productHome,
          configPath: inputs.configPath,
          activationPath: inputs.activationPath,
          manifestPath: inputs.manifestPath,
          repositoryRoot: null,
          plistPaths: launchd === null ? [] : launchd.plistFiles.map((binding) => binding.targetPath),
        },
        participants: {
          foundation: sorted,
          manifest,
          sourceGitEffect: null,
          destinationGitEffect: null,
          launchdBeforeFiles: launchd?.beforeFilesEffect ?? null,
          launchdAfterFiles: null,
          launchd,
          redactionKey: {
            schemaVersion: 1,
            coordinatorId: coordinatorId as LifecycleCoordinatorIdV1,
            sourcePath: redactionKeySourcePath(canonical(`${inputs.productHome}/state`)),
            tombstonePath: redactionKeyTombstonePath(
              canonical(`${inputs.productHome}/state`),
              coordinatorId as LifecycleCoordinatorIdV1,
            ),
            before: inputs.keyBefore,
          },
        },
        push: null,
        steps: [
          { kind: "foundation", slot: "uninstall_marker", participantId: markerForward.id },
          ...(launchd === null || launchd.beforeFilesEffect === null
            ? []
            : [{ kind: "launchd_before_files" as const, participantId: launchd.beforeFilesEffect.id }]),
          { kind: "drain_runners" },
          ...artifactForwards.map((ref) => ({
            kind: "foundation" as const,
            slot: "uninstall_artifacts" as const,
            participantId: ref.id,
          })),
          { kind: "redaction_key", transition: "stage" },
          { kind: "manifest", transition: "preserve_before" },
          { kind: "manifest", transition: "commit_absence" },
          { kind: "redaction_key", transition: "delete" },
          { kind: "manifest", transition: "finalize_tombstones" },
        ],
      };
      const plan = { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) };
      /** Refused before intent rather than at `P`'s apply: the staged refs are real only on this pass. */
      if (launchd !== null && inputs.refs !== null) assertLaunchdPlanBindings(launchd, plan);
      return { plan, reservation: reservationFor(inputs) };
    },
  };
  BUILDER_INPUTS.set(builder, inputs);
  return builder;
}

interface UninstallParticipantsV1 {
  readonly foundation: FoundationParticipantExecutor;
  readonly manifest: (plan: LifecycleExecutionPlanV1) => ManifestStateParticipant;
}

/**
 * `ManifestStatePlanAdmissionContextV1.foundationTransactionIds` binds the plan's own forward
 * participant IDs, which recovery only learns when it reads the persisted plan — so the manifest
 * arm is a per-plan factory rather than one participant built beside the executor.
 */
export function createUninstallParticipants(
  request: LifecycleUninstallRequestV1,
): UninstallParticipantsV1 {
  const { context, lifecycle } = request;
  const fs = lifecycle.fs;
  const productHome = request.key.productHome;
  const manifestAdmission = unconfinedManifestAdmission(productHome);

  const identityOf = async (
    path: CanonicalAbsolutePathV1,
    expected: { readonly hash: LowerHexSha256; readonly dev: string; readonly ino: string; readonly size: string; readonly mode: number; readonly nlink: number; readonly ownerUid: number },
  ): Promise<LifecycleGuardedEntryV1> => {
    const entry = await guardedEntry(fs, path);
    if (
      entry === null ||
      entry.kind !== "regular_file" ||
      entry.dev !== expected.dev ||
      entry.ino !== expected.ino ||
      entry.size !== expected.size ||
      entry.mode !== expected.mode ||
      entry.nlink !== expected.nlink ||
      entry.ownerUid !== expected.ownerUid
    ) {
      refuse("manifest_bytes_identity", path);
    }
    if ((await fs.hashRegular(entry, BigInt(MAX_MANIFEST_BYTES))) !== expected.hash) {
      refuse("manifest_bytes_hash", path);
    }
    return entry;
  };

  return {
    foundation: new FoundationParticipantExecutor({
      fs,
      roots: lifecycle.roots,
      executor: new TransactionExecutor({
        stateDir: context.paths.stateDir,
        stagingDir: context.paths.stagingDir,
        backupsDir: context.paths.backupsDir,
        fs: context.fs,
        clock: () => context.now().toISOString(),
        generateId: () => {
          throw new Error("the uninstall coordinator allocates every Foundation transaction ID");
        },
        guards: context.guards.transaction,
        lockProvider: lifecycle.transactionLocks,
        publishBootstrapInitialJournalNoReplace: lifecycle.renameNoReplace,
      }),
      effectiveUid: lifecycle.effectiveUid,
    }),
    manifest: (plan) =>
      new ManifestStateParticipant({
        fs: { lstat, open },
        guardedMoveNoReplace: async (source, destination, expected) => {
          const entry = await identityOf(source, expected);
          await fs.renameNoReplace(entry, destination);
        },
        guardedUnlinkExact: async (path, expected) => {
          await fs.unlinkExact(await identityOf(path, expected));
        },
        admission: {
          evidence: createCanonicalPathEvidence(),
          productHome,
          manifestPath: plan.authority.manifestPath,
          foundationTransactionIds: plan.steps
            .filter((step) => step.kind === "foundation")
            .map((step) => step.participantId as string),
          externalEffects: [],
          admitParticipant: (envelope, participantId) => {
            const refused = "mf_refused" as ReturnType<
              ManifestStateParticipant["dependencies"]["admission"]["admitParticipant"]
            >;
            if (envelope.kind !== "lifecycle" || envelope.id !== plan.id) return refused;
            try {
              return parseManifestParticipantId(participantId, request.key.nonce);
            } catch {
              return refused;
            }
          },
          admitExternalEffect: () => "refused",
        },
        uid: lifecycle.effectiveUid,
        manifestAdmission,
      }),
  };
}

function jobOfLeasePath(path: string): ScheduledJobIdV1 {
  for (const job of SCHEDULED_JOB_IDS) {
    if (path.endsWith(`/.automation-${job}.lock`)) return job;
  }
  throw new Error("the uninstall drain named a path that is not a runner lease");
}

/**
 * The preimage manifest's own directory rows, structurally: every `kind: "directory"` row at or
 * below the product home, minus the bookkeeping set and minus retained bootstrap evidence. A2
 * and D21 bar removing a retained leaf, and Step 3's shorthand ("minus the bookkeeping set")
 * covers only the Brain's absence from the removable partition, so the retained roots are
 * subtracted here too.
 */
function directoryRowsOf(
  manifest: InstallationManifestV2,
  productHome: CanonicalAbsolutePathV1,
  evidence: BootstrapEvidenceAdmissionV1,
): readonly string[] {
  const bookkeeping = lifecycleBookkeepingPaths(productHome);
  const retained = evidence.retainedRoots;
  return manifest.artifacts
    .filter((artifact) => artifact.kind === "directory")
    .map((artifact) => artifact.path as string)
    .filter((path) => path.startsWith(`${productHome}/`))
    .filter((path) => !bookkeeping.has(path))
    .filter((path) => !retained.some((root) => path === root || path.startsWith(`${root}/`)))
    .sort((left, right) => right.length - left.length);
}

function observationOf(
  entry: LifecycleGuardedEntryV1 | null | undefined,
  childNames: readonly string[],
): LifecycleBookkeepingObservationV1 {
  if (entry?.kind === "directory") {
    return { kind: "directory", ownerUid: entry.ownerUid, mode: entry.mode, childNames };
  }
  if (entry?.kind === "regular_file") {
    return { kind: "regular_file", ownerUid: entry.ownerUid, mode: entry.mode, nlink: entry.nlink, size: BigInt(entry.size) };
  }
  return { kind: "other" };
}

export function hookFiringRecordsPath(productHome: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return canonical(`${productHome}/${HOOK_FIRING_RECORDS_RELATIVE_PATH}`);
}

interface AdmittedHookFiringRecordsV1 {
  readonly directory: LifecycleGuardedEntryV1;
  readonly children: ReadonlyMap<string, LifecycleGuardedEntryV1 | null>;
}

/** Spec 1 §2.1 (amended 2026-09-22, A13 Q3-A): `null` when absent, otherwise admitted by shape or refused. */
async function admitHookFiringRecords(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<AdmittedHookFiringRecordsV1 | null> {
  const path = hookFiringRecordsPath(productHome);
  const directory = await guardedEntry(fs, path);
  if (directory === null) return null;
  const names: string[] = [];
  if (directory.kind === "directory") {
    for await (const name of fs.names(directory)) {
      names.push(name);
      if (names.length > MAX_HOOK_FIRING_RECORD_CHILDREN) refuse("hook_records_shape", path);
    }
  }
  const children = new Map<string, LifecycleGuardedEntryV1 | null>();
  for (const name of names) {
    let child: CanonicalAbsolutePathV1;
    try {
      child = canonical(`${path}/${name}`);
    } catch {
      return refuse("hook_records_shape", path);
    }
    children.set(name, await guardedEntry(fs, child));
  }
  const shape = inspectHookFiringRecordsShape(
    observationOf(directory, names),
    (name) => observationOf(children.get(name), []),
    effectiveUid,
  );
  if (!shape.admitted) {
    refuse("hook_records_shape", shape.offendingName === null ? path : canonical(`${path}/${shape.offendingName}`));
  }
  return { directory, children };
}

/**
 * Spec 1 §6 (amended 2026-09-22, A13 Q3-A): `state/hooks` goes after every plugin-tree and
 * artifact removal, re-admitted by shape at removal time and deleted by exact identity, the
 * directory last. Absent is done, so a resumed uninstall may call this again.
 */
export async function removeHookFiringRecords(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<boolean> {
  const admitted = await admitHookFiringRecords(fs, productHome, effectiveUid);
  if (admitted === null) return false;
  const { directory, children } = admitted;
  for (const child of children.values()) {
    if (child !== null) await fs.unlinkExact(child);
  }
  await fs.syncDirectory(directory);
  await fs.rmdirExactEmpty(directory);
  await syncDirectoryAt(fs, canonical(`${productHome}/state`));
  return true;
}

export function codexIngestHomePath(productHome: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return canonical(`${productHome}/${CODEX_INGEST_HOME_RELATIVE_PATH}`);
}

/** D52: `null` when absent, otherwise admitted by shape (a `0700` directory, at most an `auth.json` symlink) or refused. */
async function admitCodexIngestHome(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<{ readonly directory: LifecycleGuardedEntryV1; readonly link: LifecycleGuardedEntryV1 | null } | null> {
  const path = codexIngestHomePath(productHome);
  const directory = await guardedEntry(fs, path);
  if (directory === null) return null;
  const names: string[] = [];
  if (directory.kind === "directory") {
    for await (const name of fs.names(directory)) {
      names.push(name);
      if (names.length > 1) break;
    }
  }
  const link = names.includes("auth.json") ? await guardedEntry(fs, canonical(`${path}/auth.json`)) : null;
  const shape = inspectCodexIngestHomeShape(directory, names, () => link, effectiveUid);
  if (!shape.admitted) {
    let offending = path;
    try {
      if (shape.offendingName !== null) offending = canonical(`${path}/${shape.offendingName}`);
    } catch {
      // An uncanonical name is refused on the directory itself.
    }
    refuse("codex_ingest_home_shape", offending);
  }
  return { directory, link };
}

/**
 * D52: removed beside `state/hooks`, re-admitted by shape at removal time. The link is unlinked,
 * never followed, so the user's own Codex credential is untouched. Absent is done.
 */
export async function removeCodexIngestHome(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<boolean> {
  const admitted = await admitCodexIngestHome(fs, productHome, effectiveUid);
  if (admitted === null) return false;
  if (admitted.link !== null) await fs.unlinkExact(admitted.link);
  await fs.syncDirectory(admitted.directory);
  await fs.rmdirExactEmpty(admitted.directory);
  await syncDirectoryAt(fs, canonical(`${productHome}/state`));
  return true;
}

async function removeStateLeaf(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  leaf: string,
): Promise<void> {
  const entry = await guardedEntry(fs, stateLeaf(productHome, leaf));
  if (entry === null) return;
  await fs.unlinkExact(entry);
  await syncDirectoryAt(fs, canonical(`${productHome}/state`));
}

export function createUninstallAdapters(input: {
  readonly request: LifecycleUninstallRequestV1;
  readonly foundation: FoundationParticipantExecutor;
  readonly manifest: (plan: LifecycleExecutionPlanV1) => ManifestStateParticipant;
  readonly afterBoundary?: UninstallBoundaryHook | undefined;
  readonly holds?: UninstallHoldsV1 | undefined;
  /** D25: directory rows `finalize_tombstones` found non-empty, so the run can report them. */
  readonly preserved?: string[] | undefined;
}): LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1> {
  const { request, foundation, manifest } = input;
  const fs = request.lifecycle.fs;
  const locks = request.lifecycle.locks;
  const productHome = request.key.productHome;
  const globalLockPath = stateLeaf(productHome, GLOBAL_LOCK_LEAF);
  const holds: UninstallHoldsV1 = input.holds ?? { global: null, leases: [] };
  let leases: readonly HeldLifecycleStableLockV1[] = [];
  const record = (next: HeldLifecycleStableLockV1 | null): void => {
    if (next !== null) holds.global = next;
    holds.leases = leases;
  };

  const boundary = async (reached: UninstallBoundaryV1): Promise<void> => {
    await input.afterBoundary?.(reached);
  };

  const releaseLeases = async (): Promise<void> => {
    for (const lease of [...leases].reverse()) await lease.release();
    leases = [];
    record(null);
  };

  /**
   * §5.4: uninstall acquires leases only while holding no global lock, and the drain has one
   * absolute ten-minute deadline. Interactive contention on the reacquisition refuses exit 6
   * rather than waiting, so a second holder of the global lock cannot be starved by this run.
   */
  const drain = async (global: HeldLifecycleStableLockV1): Promise<HeldLifecycleStableLockV1> => {
    await global.release();
    const nowMs = request.lifecycle.nowMs;
    const sleepMs = request.lifecycle.sleepMs;
    leases = await locks.acquireExistingWithin(uninstallLeasePaths(productHome), {
      nowMs,
      sleepMs,
      deadlineMs: nowMs() + LIFECYCLE_LEASE_DRAIN_MS,
    });
    record(null);
    try {
      const reacquired = await locks.acquireExisting(globalLockPath);
      record(reacquired);
      return reacquired;
    } catch (error) {
      await releaseLeases();
      throw error;
    }
  };

  /**
   * Every `F(uninstall_artifacts)` step passes through both hooks, but the leases lead the
   * removal order and so all fall in the first one: from the second on, `before` finds none
   * present and `after` holds none to check.
   */
  const isArtifactStep = (step: LifecycleExecutionPlanV1["steps"][number]): boolean =>
    step.kind === "foundation" && step.slot === "uninstall_artifacts";

  const keyPlanOf = (plan: LifecycleExecutionPlanV1): RedactionKeyStatePlanV1 => {
    const key = plan.participants.redactionKey;
    if (key === null) refuse("lifecycle_coordinator_key_arm", productHome);
    return key;
  };

  const manifestPlanOf = (plan: LifecycleExecutionPlanV1): ManifestStatePlanV1 => {
    const leaf = plan.participants.manifest;
    if (leaf === null) refuse("lifecycle_coordinator_manifest_arm", productHome);
    return leaf;
  };

  return {
    foundation,
    manifest: {
      preserveBefore: async (plan) => {
        await manifest(plan).apply(manifestPlanOf(plan));
      },
      publishAfter: () => {
        refuse("lifecycle_coordinator_manifest_arm", productHome);
      },
      commitAbsence: async (plan) => {
        await manifest(plan).apply(manifestPlanOf(plan));
      },
      finalizeTombstones: async (plan) => {
        await finalizeUninstallTombstones(
          request,
          plan,
          manifestPlanOf(plan),
          boundary,
          input.preserved,
        );
        await manifest(plan).compact(manifestPlanOf(plan));
      },
      compensate: async (plan) => {
        await manifest(plan).compensate(manifestPlanOf(plan));
      },
      /**
       * `ManifestStateParticipant.observe` refuses the compaction-pending inventory, and step
       * seven needs exactly that value on a resumed run. For this plan shape (`after` absent)
       * the manifest and the tombstone both being gone is the only way to reach it, so the
       * discriminator is read here and every other state delegates.
       */
      observe: async (plan) => {
        const leaf = manifestPlanOf(plan);
        const live = await guardedEntry(fs, leaf.manifestPath);
        const tombstone = await guardedEntry(fs, leaf.tombstonePath);
        if (live === null && tombstone === null) return "compaction_pending";
        const observed = await manifest(plan).observe(leaf);
        if (observed.state === "compensated") refuse("manifest_state_compensated", leaf.manifestPath);
        return observed.state;
      },
    },
    redactionKey: {
      stage: (plan) => stageRedactionKey(fs, keyPlanOf(plan)),
      delete: (plan) => deleteRedactionKey(fs, keyPlanOf(plan)),
      restore: (plan) => restoreRedactionKey(fs, keyPlanOf(plan)),
      observe: (plan) => observeRedactionKeyState(fs, keyPlanOf(plan)),
    },
    sourceGitEffect: null,
    destinationGitEffect: null,
    launchdBeforeFiles: createLifecycleEffectAdapters(request.lifecycle, request.lifecycle.effectPorts())
      .launchdBeforeFiles,
    launchdAfterFiles: null,
    networkPush: null,
    drainRunners: { drain: (_plan, global) => drain(global) },
    /**
     * §2.4's `coordinator_envelope` compaction entry is the last one, after every Foundation
     * reference has been collected, so it is the one point where `state/uninstalling.json` can
     * be removed without invalidating a reference's recorded preimage — the marker forward's
     * inverse still describes the world it is proved against while the earlier entries run.
     *
     * `removeEnvelopeLeaves` reaches these hooks for *every* terminal uninstall, rolled back
     * included. Taking the nonce and the allocator from a home whose uninstall compensated would
     * leave an installation that §2.1 can no longer admit, so a `rolled_back` outcome collects
     * nothing here (NEW-97).
     */
    controlFiles: {
      removeAllocator: async (_plan, outcome) => {
        if (outcome === "rolled_back") return;
        await removeStateLeaf(fs, productHome, MARKER_LEAF);
        await removeStateLeaf(fs, productHome, ALLOCATOR_LEAF);
      },
      removeNonce: async (_plan, outcome) => {
        if (outcome === "rolled_back") return;
        /** Before the nonce: the nonce is what makes a death here resume through this hook again. */
        await removeHookFiringRecords(fs, productHome, request.lifecycle.effectiveUid);
        await removeCodexIngestHome(fs, productHome, request.lifecycle.effectiveUid);
        await removeStateLeaf(fs, productHome, NONCE_LEAF);
      },
    },
    stepHooks: {
      before: async (_plan, _index, step, global) => {
        if (!isArtifactStep(step)) return global;
        const present: CanonicalAbsolutePathV1[] = [];
        for (const path of uninstallLeasePaths(productHome)) {
          if ((await guardedEntry(fs, path)) !== null) present.push(path);
        }
        if (present.length === 0) {
          await releaseLeases();
          return global;
        }
        let held = global;
        if (leases.length !== uninstallLeasePaths(productHome).length) {
          await releaseLeases();
          held = await drain(global);
        }
        for (const lease of leases) {
          const entry = await guardedEntry(fs, lease.path);
          if (entry === null) continue;
          if (entry.dev !== lease.dev || entry.ino !== lease.ino) {
            await releaseLeases();
            refuse("lifecycle_lease_identity", lease.path);
          }
        }
        return held;
      },
      after: async (_plan, _index, step) => {
        if (!isArtifactStep(step)) return;
        for (const lease of leases) {
          if ((await guardedEntry(fs, lease.path)) !== null) {
            refuse("lifecycle_lease_retained", lease.path);
          }
        }
        for (const lease of [...leases].reverse()) {
          await lease.release();
          await boundary({ kind: "lease_path_removed", job: jobOfLeasePath(lease.path) });
        }
        leases = [];
        record(null);
      },
    },
  };
}

/**
 * D25: the tombstone is the preimage manifest, authenticated by hash alone, and it is the only
 * index of the directory rows left to collect. Every removal is an `rmdir` of an empty
 * directory through the shared guard, so a directory the user filled is preserved and reported
 * rather than emptied.
 */
async function finalizeUninstallTombstones(
  request: LifecycleUninstallRequestV1,
  plan: LifecycleExecutionPlanV1,
  leaf: ManifestStatePlanV1,
  boundary: (reached: UninstallBoundaryV1) => Promise<void>,
  preserved: string[] | undefined,
): Promise<void> {
  const { context, lifecycle } = request;
  const tombstone = await guardedEntry(lifecycle.fs, leaf.tombstonePath);
  if (tombstone === null || leaf.before.state !== "present") return;
  if ((await lifecycle.fs.hashRegular(tombstone, BigInt(MAX_MANIFEST_BYTES))) !== leaf.before.hash) {
    refuse("manifest_tombstone_hash", leaf.tombstonePath);
  }
  const bytes = await lifecycle.fs.readRegular(tombstone, MAX_MANIFEST_BYTES);
  const preimage = validateManifestV2(
    decodeCanonicalJson(bytes, MAX_MANIFEST_BYTES),
    unconfinedManifestAdmission(plan.authority.productHome),
  );
  for (const path of directoryRowsOf(preimage, plan.authority.productHome, request.evidence)) {
    let canonicalPath: string;
    try {
      canonicalPath = await context.guards.canonicalize(path);
    } catch {
      continue;
    }
    const artifact = { path, kind: "directory" } as unknown as ManagedArtifactV1;
    const outcome = await removeDirectories(context, [{ artifact, canonicalPath }]);
    if (outcome.removed.length === 1) {
      await boundary({ kind: "empty_directory_removed", path: canonical(path) });
    }
    preserved?.push(...outcome.preserved);
  }
}

async function planningPaths(context: CliContext): Promise<RuntimePaths> {
  let config = null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch {
    config = null;
  }
  return runtimePathsFor(context, config ?? undefined);
}

interface UninstallLaunchdRowV1 {
  readonly job: ScheduledJobIdV1;
  readonly label: GeneratedLaunchdLabelV1;
  readonly generation: LaunchdGenerationV1;
  readonly executablePath: CanonicalAbsolutePathV1;
  /** Null for a pre-NEW-144 nine-argument plist. */
  readonly node: CanonicalAbsolutePathV1 | null;
  readonly identity: LaunchdBootstrapPlistIdentityV1;
  readonly mutation: ArtifactMutationV1;
}

/**
 * §6's closed external-file authorization for one installed plist: an exact `macos` content row
 * that existed only because of this installation, no symlink on its path, a private regular file
 * holding the installed bytes, and a label and product home that are this installation's.
 */
async function admitPlistRow(
  request: LifecycleUninstallRequestV1,
  job: ScheduledJobIdV1,
  artifact: ManagedArtifactV2,
): Promise<UninstallLaunchdRowV1> {
  const { context, lifecycle } = request;
  const path = canonical(artifact.path);
  const installedHash = artifact.kind === "file" && artifact.verification.mode === "content"
    ? artifact.verification.installedHash
    : null;
  if (
    artifact.owner !== "macos" ||
    artifact.existedBefore ||
    installedHash === null ||
    (await context.guards.canonicalize(path)) !== path
  ) {
    refuse("uninstall_plist_row", path);
  }
  const entry = await guardedEntry(lifecycle.fs, path);
  if (
    entry?.kind !== "regular_file" ||
    entry.ownerUid !== lifecycle.effectiveUid ||
    entry.mode !== 0o600 ||
    entry.nlink !== 1
  ) {
    return refuse("uninstall_plist_shape", path);
  }
  const content = await lifecycle.fs.readRegular(entry, MAX_LAUNCHD_PLIST_BYTES);
  const hash = digestOf(content);
  if (hash !== installedHash) {
    throw new UninstallRefusal(
      EXIT_CODES.decisionRequired,
      "an installed automation plist was modified after installation; resolve it before removing",
      [path],
    );
  }
  let label: GeneratedLaunchdLabelV1;
  let argv: ReturnType<typeof scheduledArgvParts>;
  let parsed: ReturnType<typeof parseGeneratedLabel>;
  try {
    const plist = parseCanonicalLaunchdPlist(content);
    label = plist.Label;
    argv = scheduledArgvParts(plist.ProgramArguments);
    parsed = parseGeneratedLabel(label);
  } catch {
    return refuse("uninstall_plist_bytes", path);
  }
  if (parsed.job !== job || argv.productHome !== request.key.productHome) refuse("uninstall_plist_foreign", path);
  return {
    job,
    label,
    generation: parsed.generation,
    executablePath: argv.executable,
    node: argv.node,
    identity: {
      path,
      ownerUid: parseEffectiveUid(entry.ownerUid, lifecycle.effectiveUid),
      mode: 384,
      nlink: 1,
      size: content.byteLength,
      hash,
      dev: entry.dev,
      ino: entry.ino,
    },
    mutation: { targetPath: path, hash, content },
  };
}

/** One bounded read-only pass through the preview row: each label's closed candidate set. */
async function observeLabels(
  observer: Pick<LaunchdObserver, "observe">,
  uid: number,
  rows: readonly UninstallLaunchdRowV1[],
  productHome: CanonicalAbsolutePathV1,
): Promise<ReadonlyMap<ScheduledJobIdV1, LaunchdLiveStateV1>> {
  const live = new Map<ScheduledJobIdV1, LaunchdLiveStateV1>();
  if (rows.length === 0) return live;
  const observed = await observer.observe({
    domain: launchdGuiDomain(parseEffectiveUid(uid, uid)),
    jobs: rows.map((row) => ({ job: row.job, retained: row.label, planned: null })),
  });
  if (observed.kind === "unobservable") refuse("launchd_unobservable", productHome);
  rows.forEach((row, index) => {
    const state = observed.jobs[index]?.job === row.job ? observed.jobs[index].state : null;
    if (state?.kind === "unloaded") {
      live.set(row.job, { state: "unloaded" });
    } else if ((state?.kind === "exact_old" || state?.kind === "exact_new") && state.label === row.label) {
      live.set(row.job, { state: "loaded", label: state.label, generation: state.generation });
    } else {
      refuse("launchd_live_state_third_state", row.identity.path);
    }
  });
  return live;
}

/**
 * The `P` variant's launchd inputs, observed before any ID is reserved: every manifest-owned
 * plist admitted and read, every label's live state, and — when a label is loaded — an admitted
 * launchctl host, so an unsupported host refuses here instead of rolling back after the marker.
 */
async function planUninstallLaunchd(
  request: LifecycleUninstallRequestV1,
  manifest: InstallationManifestV2,
): Promise<{ readonly launchd: UninstallLaunchdInputsV1; readonly plists: readonly ArtifactMutationV1[] }> {
  const { context, lifecycle } = request;
  const productHome = request.key.productHome;
  const userHome = canonical(context.userHome);
  const ports = lifecycle.effectPorts().launchd;
  const template = ports.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
  const rows: UninstallLaunchdRowV1[] = [];
  for (const job of SCHEDULED_JOB_IDS) {
    const path = launchdPlistPath(userHome, job);
    const artifact = manifest.artifacts.find((candidate) => candidate.path === path);
    if (artifact !== undefined) rows.push(await admitPlistRow(request, job, artifact));
  }
  const executablePath = rows[0]?.executablePath ?? productHome;
  const foreign = rows.find((row) => row.executablePath !== executablePath);
  if (foreign !== undefined) refuse("uninstall_plist_foreign", foreign.identity.path);

  let live: ReadonlyMap<ScheduledJobIdV1, LaunchdLiveStateV1>;
  try {
    live = await observeLabels(ports.observer, lifecycle.effectiveUid, rows, productHome);
    if ([...live.values()].some((state) => state.state === "loaded")) await admitLaunchdHost(ports.host);
  } catch (error) {
    if (error instanceof LaunchdDistributionUnsupportedError) {
      refuseUnsupportedLaunchd(lifecycle.effectiveUid, rows.map((row) => row.label), error);
    }
    throw error;
  }

  const unloaded: LaunchdPriorJobStateV1 = { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };
  const prior = Object.fromEntries(
    SCHEDULED_JOB_IDS.map((job) => {
      const row = rows.find((candidate) => candidate.job === job);
      const state: LaunchdPriorJobStateV1 = row === undefined
        ? unloaded
        : {
            beforeFileHash: row.identity.hash,
            beforeGeneration: row.generation,
            beforeLiveState: live.get(job) ?? { state: "unloaded" },
          };
      return [job, state];
    }),
  ) as Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>;
  const preview = buildLaunchdPlanPreview({
    observationProcessTableHash: launchdObservationProcessTableHash(LAUNCHD_PREVIEW_OBSERVATION_TABLE),
    mutationProcessTableTemplateHash: launchdProcessTableTemplateHash(template),
    domain: launchdGuiDomain(parseEffectiveUid(lifecycle.effectiveUid, lifecycle.effectiveUid)),
    userHome,
    productHome: parseScheduledProductHome(productHome),
    executablePath,
    // Remove-only: no plist is written, so the Node is informational.
    nodePath: rows.find((row) => row.node !== null)?.node ?? executablePath,
    automation: null,
    prior,
  });
  return {
    launchd: {
      preview,
      identities: new Map(rows.map((row) => [row.job, row.identity])),
      template,
      processTableHash: null,
    },
    plists: rows.map((row) => row.mutation),
  };
}

/**
 * The effect's process staging, created under the global lock once the coordinator ID exists:
 * the mutation table's `HOME`/`TMPDIR` are these directories, so its hash is only knowable now.
 */
export async function stageLaunchdProcessTable(
  lifecycle: CliLifecycleContext,
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  template: SupportedLaunchdProcessTableTemplateV1,
): Promise<LowerHexSha256> {
  const coordinatorStaging = canonical(`${lifecycle.roots.lifecycleStaging}/${coordinatorId}`);
  const root = await lifecycle.fs.mkdirExclusive(canonical(`${coordinatorStaging}/launchd-process`));
  for (const name of LAUNCHD_PROCESS_STAGING_CHILDREN) {
    await lifecycle.fs.syncDirectory(await lifecycle.fs.mkdirExclusive(canonical(`${root.path}/${name}`)));
  }
  await lifecycle.fs.syncDirectory(root);
  await syncDirectoryAt(lifecycle.fs, coordinatorStaging);
  return launchdProcessTableHash(
    await loadLaunchdProcessTable(productHome, coordinatorId, { template, host: lifecycle.effectPorts().launchd.host }),
  );
}

/**
 * A14's three evidence conditions, exactly. The disjunction is Task 8's, never hand-computed
 * here, because the plan hash binds only the resulting shape: a boolean that contradicts its own
 * evidence is caught by nothing but `validateLifecyclePlanGrammar`'s row check.
 */
async function deriveVariant(
  request: LifecycleUninstallRequestV1,
  paths: RuntimePaths,
  manifest: InstallationManifestV2,
): Promise<LifecycleUninstallPreviewV1["variant"]> {
  const activation = await observeLifecycleActivationRecord(request.lifecycle.fs, paths);
  let config = null;
  try {
    config = await readConfigFile(request.context, paths.configFile);
  } catch {
    config = null;
  }
  const plists = externalPlistPaths(request.context.userHome);
  const evidence = deriveUninstallLaunchdEvidence({
    manifestOwnsPlist: manifest.artifacts.some((artifact) => plists.has(artifact.path)),
    configHasAutomationLifecycle: config?.automation.lifecycle !== undefined,
    activationAutomation: activation.state === "present" ? activation.record.automation : null,
  });
  return evidence ? "uninstall/present_manifest" : "uninstall/present_manifest_without_launchd";
}

export class LifecycleUninstaller {
  private readonly afterBoundary: UninstallBoundaryHook | undefined;

  constructor(dependencies: { readonly afterBoundary?: UninstallBoundaryHook } = {}) {
    this.afterBoundary = dependencies.afterBoundary;
  }

  async preview(
    request: LifecycleUninstallRequestV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<LifecycleUninstallPreviewV1> {
    const admitted = request.admitted;
    if (admitted === null) refuse("uninstall_manifest_absent", request.key.productHome);
    const productHome = request.key.productHome;
    if (global.path !== stateLeaf(productHome, GLOBAL_LOCK_LEAF)) {
      refuse("lifecycle_global_lock_identity", global.path);
    }

    const { context, lifecycle, evidence } = request;
    const paths = await planningPaths(context);
    const variant = await deriveVariant(request, paths, admitted.manifest);
    const launchd = variant === "uninstall/present_manifest"
      ? await planUninstallLaunchd(request, admitted.manifest)
      : null;
    const plistPaths = new Set<string>(launchd?.plists.map((mutation) => mutation.targetPath) ?? []);
    await assertNoRedactionKeyTombstone(lifecycle.fs, canonical(`${productHome}/state`));

    const markerPath = stateLeaf(productHome, MARKER_LEAF);
    /**
     * Held out of the partition, not merely out of the mutation list. The nonce, the allocator
     * and `state/uninstalling.json` are collected by terminal compaction and the manifest is the
     * `M` arm's own, so none of them is an artifact this step removes — and the allocator is a
     * `schema` row whose counter legitimately advances, so leaving it in would make
     * `planUninstall` read every reservation this installation has ever made as an edit and
     * refuse exit 3. A row the artifact step removed *and* an earlier Foundation reference wrote
     * would also leave that reference's forward and its inverse proved against a world the other
     * one overwrote (§2.4 terminal compaction).
     */
    const reserved = new Set<string>([
      markerPath,
      stateLeaf(productHome, ALLOCATOR_LEAF),
      stateLeaf(productHome, NONCE_LEAF),
      paths.manifestFile,
    ]);
    const revertRequest: RevertRequest = {
      kind: "uninstall",
      artifacts: await Promise.all(
        admitted.manifest.artifacts
          .filter((artifact) => !reserved.has(artifact.path as string) && !plistPaths.has(artifact.path))
          .map((artifact) => downcastArtifactV2(context, artifact)),
      ),
      ownedRoots: [paths.home],
      excludedRoots: [
        paths.brain,
        ...evidence.retainedRoots,
        ...lifecycleBookkeepingPaths(productHome),
      ],
    };
    const partitioned = await planUninstall(context, revertRequest);
    const leases = uninstallLeasePaths(productHome);
    const leaseOrder = new Map(leases.map((path, index) => [path as string, index]));

    const files = partitioned.removable.filter(
      (entry) =>
        entry.artifact.kind !== "directory" &&
        partitioned.drift.get(entry.artifact.path)?.kind !== "missing",
    );
    /** §6: the registry's runner leases first, in reconciliation order, then unsigned UTF-8 order. */
    const removalOrder = (left: string, right: string): number => {
      const leftLease = leaseOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightLease = leaseOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftLease !== rightLease) return leftLease - rightLease;
      return byUtf8(left, right);
    };
    const ordered = [...files].sort((left, right) => removalOrder(left.artifact.path, right.artifact.path));

    const artifacts: ArtifactMutationV1[] = [];
    for (const entry of ordered) {
      const path = canonical(entry.canonicalPath);
      const observed = await guardedEntry(lifecycle.fs, path);
      if (observed === null || observed.kind !== "regular_file") continue;
      if (BigInt(observed.size) > BigInt(MAX_MUTATION_BYTES)) {
        refuse("uninstall_artifact_too_large", path);
      }
      const content = await lifecycle.fs.readRegular(observed, MAX_MUTATION_BYTES);
      artifacts.push({
        targetPath: canonical(entry.artifact.path),
        hash: digestOf(content),
        content,
      });
    }
    artifacts.push(...(launchd?.plists ?? []));
    artifacts.sort((left, right) => removalOrder(left.targetPath, right.targetPath));
    const chunks = chunkUninstallArtifacts(artifacts, productHome);
    const markerEntry = await guardedEntry(lifecycle.fs, markerPath);
    if (markerEntry === null || markerEntry.kind !== "regular_file") {
      refuse("uninstall_marker_absent", markerPath);
    }
    const markerContent = await lifecycle.fs.readRegular(markerEntry, MAX_MUTATION_BYTES);
    const markerPreimage: ArtifactMutationV1 = {
      targetPath: markerPath,
      hash: digestOf(markerContent),
      content: markerContent,
    };

    const manifestBefore = await guardedEntry(lifecycle.fs, paths.manifestFile as CanonicalAbsolutePathV1);
    if (manifestBefore === null || manifestBefore.kind !== "regular_file") {
      refuse("uninstall_manifest_absent", paths.manifestFile as CanonicalAbsolutePathV1);
    }
    const inputs: UninstallPlanInputsV1 = {
      productHome,
      configPath: canonical(paths.configFile),
      activationPath: stateLeaf(productHome, ACTIVATION_LEAF),
      manifestPath: canonical(paths.manifestFile),
      manifestBefore,
      manifestHash: await lifecycle.fs.hashRegular(manifestBefore, BigInt(MAX_MANIFEST_BYTES)),
      keyBefore: await observeSecretOpaqueKey(
        redactionKeySourcePath(canonical(`${productHome}/state`)),
        lifecycle.effectiveUid,
      ),
      markerPreimage,
      chunks,
      createdAt: context.now().toISOString(),
      launchd: launchd?.launchd ?? null,
      refs: null,
    };

    /** Refused here, before any ID is reserved, rather than only at compaction after the commit. */
    const hooks = await admitHookFiringRecords(lifecycle.fs, productHome, lifecycle.effectiveUid);
    const codexIngestHome = await admitCodexIngestHome(lifecycle.fs, productHome, lifecycle.effectiveUid);
    return {
      variant,
      removable: [
        ...partitioned.removable.map((entry) => entry.artifact.path),
        ...plistPaths,
        ...reserved,
        ...(hooks === null ? [] : [hooks.directory.path]),
        ...(codexIngestHome === null ? [] : [codexIngestHome.directory.path]),
      ].sort(),
      preserved: [...new Set([...partitioned.preserved, ...preservedRetentionRoots(evidence)])],
      builder: uninstallBuilder(inputs),
    };
  }

  async execute(request: LifecycleUninstallRequestV1): Promise<UninstallResultV1> {
    const { context, lifecycle, evidence } = request;
    const productHome = request.key.productHome;
    const holds: UninstallHoldsV1 = {
      global: await lifecycle.locks.acquireExisting(stateLeaf(productHome, GLOBAL_LOCK_LEAF)),
      leases: [],
    };
    const current = (): HeldLifecycleStableLockV1 => {
      const global = holds.global;
      if (global === null) throw new Error("the uninstall coordinator released its global lock");
      return global;
    };
    try {
      await requireLifecycleStagingRoot(lifecycle, context.paths);
      await cleanAllocatorTemp(request, current());
      const participants = createUninstallParticipants(request);
      const preservedDirectories: string[] = [];
      const adapters = createUninstallAdapters({
        request,
        ...participants,
        afterBoundary: this.afterBoundary,
        holds,
        preserved: preservedDirectories,
      });
      const residue = uninstallResidueFrom(evidence);
      const recovered = await lifecycle
        .recovery(request.key, adapters, residue)
        .recover(current(), { resumeUninstall: true });
      holds.global = recovered.global;
      if (recovered.snapshot.closure.kind !== "clear") {
        throw new UninstallRefusal(
          EXIT_CODES.recoveryRequired,
          "the lifecycle ledger is not clear; resolve it before uninstalling",
          [productHome],
          "developer-os doctor",
        );
      }

      const preview = await this.preview(request, current());
      const inputs = builderInputs(preview.builder);
      const codec = lifecycle.codecs(request.key).executionPlan;
      assertLifecycleExecutionFeasible(preview.builder, recovered.snapshot, codec);

      const slotCount = preview.builder.slotCount;
      const block = await reserveLifecycleIdBlock(
        {
          fs: lifecycle.fs,
          stateDirectory: canonical(context.paths.stateDir),
          effectiveUid: lifecycle.effectiveUid,
          uuid: lifecycle.uuid,
          held: current(),
          allocatedIds: allocatedIdsFrom(recovered.snapshot),
        },
        slotCount,
      );
      /** `lifecycleReservationOrder`: `lc`, the Foundation pairs, `P`'s `le`, then `mf`. */
      const effectSlot = inputs.launchd === null ? -1 : slotCount - 2;
      const prefixAt = (index: number): "lc" | "tx" | "le" | "mf" => {
        if (index === 0) return "lc";
        if (index === slotCount - 1) return "mf";
        return index === effectSlot ? "le" : "tx";
      };
      const ids = Array.from({ length: slotCount }, (_unused, index) =>
        formatAllocatedLifecycleId(prefixAt(index), block.nonce, block.firstCounter + BigInt(index)),
      );
      const coordinatorId = parseLifecycleCoordinatorId(ids[0], request.key.nonce);

      const store = lifecycle.store(request.key);
      await store.ensureStagingDirectory(coordinatorId, current());
      inputs.refs = await stageUninstallParticipants(
        participants.foundation,
        inputs,
        coordinatorId,
        ids.slice(1, inputs.launchd === null ? -1 : -2),
      );
      /** No loaded label means no transition, so the executor never loads the table and the host is never admitted. */
      if (inputs.launchd?.preview.entries.some((entry) => entry.beforeLiveState.state === "loaded") === true) {
        inputs.launchd.processTableHash = await stageLaunchdProcessTable(
          lifecycle,
          productHome,
          coordinatorId,
          inputs.launchd.template,
        );
      }
      const { plan } = preview.builder.build(ids);
      /** Spec §2.4: the effect plan is published once, before coordinator intent. */
      const effect = plan.participants.launchd === null ? null : launchdEffectPlan(plan.participants.launchd, "before_files");
      if (effect !== null) {
        await new LaunchdEffectJournalStore({
          fs: lifecycle.fs,
          roots: lifecycle.roots,
          locks: lifecycle.transactionLocks,
          uuid: lifecycle.uuid,
        }).publishPlan(effect);
      }
      await store.publish(plan, current());

      const coordinator = new LifecycleCoordinator<LifecycleExecutionPlanV1>({
        store,
        adapters,
        variantFacts: lifecycleVariantFacts,
        pushPlanHash: lifecyclePushPlanHash,
        clock: lifecycle.clock,
        fs: lifecycle.fs,
        ...(this.afterBoundary === undefined ? {} : { afterBoundary: this.afterBoundary }),
      });
      const outcome = await coordinator.execute(coordinatorId, current());
      holds.global = outcome.global;
      if (outcome.outcome.kind !== "finalized") {
        const cause = outcome.outcome.kind === "rolled_back" ? outcome.outcome.cause : outcome.outcome.kind;
        throw new UninstallRefusal(
          EXIT_CODES.recoveryRequired,
          `the uninstall coordinator rolled back (${cause}); the installation is intact`,
          [productHome],
          "developer-os doctor",
        );
      }

      const settled = await lifecycle
        .recovery(request.key, adapters, residue)
        .recover(current(), { resumeUninstall: true });
      holds.global = settled.global;
      /**
       * D54 review, finding 1: the manifest is gone, so the anchor describes no installation.
       * Still under the global lock; a failure is reported, never a failed uninstall.
       */
      try {
        await removeManifestAnchor(lifecycle.fs, productHome, lifecycle.effectiveUid);
      } catch (error) {
        if (isCodeDefect(error)) throw error;
        context.io.stderr(MANIFEST_ANCHOR_WARNING);
      }

      return {
        schemaVersion: 1,
        removed: preview.removable,
        restored: [],
        preserved: [...new Set([...preview.preserved, ...preservedDirectories])],
        retainedBootstrapEvidence: evidence.report.ids,
        transactionId: coordinatorId,
      };
    } finally {
      await releaseUninstallHolds(holds);
    }
  }
}

function builderInputs(
  builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1>,
): UninstallPlanInputsV1 {
  const inputs = BUILDER_INPUTS.get(builder);
  if (inputs === undefined) throw new Error("the uninstall builder carries no plan inputs");
  return inputs;
}

async function stageUninstallParticipants(
  foundation: FoundationParticipantExecutor,
  inputs: UninstallPlanInputsV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  ids: readonly string[],
): Promise<readonly FoundationParticipantRefV1[]> {
  const marker = encoder.encode(
    encodeUninstallingMarker({
      schemaVersion: 1,
      coordinatorId,
      createdAt: inputs.createdAt as UtcTimestampV1,
    }),
  );
  const forwardMarker = [
    {
      targetPath: inputs.markerPreimage.targetPath,
      operation: "replace" as const,
      expectedBeforeHash: inputs.markerPreimage.hash,
      content: marker,
    },
  ];
  const inverseMarker = [
    {
      targetPath: inputs.markerPreimage.targetPath,
      operation: "replace" as const,
      expectedBeforeHash: digestOf(marker),
      content: inputs.markerPreimage.content,
    },
  ];

  /** Each step's inverse recreates only its own chunk, in reverse, so compensation runs backwards across steps and within each. */
  const pairs = [
    { slot: "uninstall_marker" as const, forward: ids[0], compensation: ids[1], forwardMutations: forwardMarker, inverse: inverseMarker },
    ...inputs.chunks.map((chunk, index) => ({
      slot: "uninstall_artifacts" as const,
      forward: ids[2 + 2 * index],
      compensation: ids[3 + 2 * index],
      forwardMutations: chunk.map((mutation) => ({
        targetPath: mutation.targetPath,
        operation: "remove" as const,
        expectedBeforeHash: mutation.hash,
        content: null,
      })),
      inverse: [...chunk].reverse().map((mutation) => ({
        targetPath: mutation.targetPath,
        operation: "create" as const,
        expectedBeforeHash: null,
        content: mutation.content,
      })),
    })),
  ];
  const refs: FoundationParticipantRefV1[] = [];
  for (const pair of pairs) {
    const forwardId = pair.forward;
    const compensationId = pair.compensation;
    if (forwardId === undefined || compensationId === undefined) {
      throw new Error("the uninstall reservation block is incomplete");
    }
    refs.push(
      await foundation.stage({
        coordinatorId,
        id: forwardId as FoundationTransactionIdV1,
        slot: pair.slot,
        role: { kind: "forward", compensationId: compensationId as AllocatedLifecycleIdV1<"tx"> },
        createdAt: inputs.createdAt as UtcTimestampV1,
        mutations: pair.forwardMutations,
      }),
    );
    refs.push(
      await foundation.stage({
        coordinatorId,
        id: compensationId as FoundationTransactionIdV1,
        slot: pair.slot,
        role: { kind: "compensation", forwardId: forwardId as AllocatedLifecycleIdV1<"tx"> },
        createdAt: inputs.createdAt as UtcTimestampV1,
        mutations: pair.inverse,
      }),
    );
  }
  return refs;
}

function allocatedIdsFrom(
  snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>,
): readonly string[] {
  const candidates = [
    ...snapshot.coordinators.map((record) => record.id as string),
    ...[...snapshot.foundation.journals.keys()].map((id) => id as string),
  ];
  return candidates.filter((id) => {
    try {
      allocatedCounterOf(id);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * D37: a fresh V2 `init` does not create `staging/lifecycle`, and `inspectLifecycleLedger`
 * refuses its absence, so every V2 mutator materialises it under the held global lock. The same
 * interim as `lifecycle/mutation-gate.ts`; the durable fix belongs in the fresh layout.
 */
async function requireLifecycleStagingRoot(
  lifecycle: CliLifecycleContext,
  paths: RuntimePaths,
): Promise<void> {
  const root = lifecycle.roots.lifecycleStaging;
  if ((await guardedEntry(lifecycle.fs, root)) !== null) return;
  try {
    await lifecycle.fs.mkdirExclusive(root);
  } catch (error) {
    if ((await guardedEntry(lifecycle.fs, root))?.kind !== "directory") throw error;
  }
  await syncDirectoryAt(lifecycle.fs, canonical(paths.stagingDir));
}

/**
 * §2.4 admits exactly one pre-rename allocator temp and the ledger reports it as a finding,
 * which `assertRecoverable` would refuse — so a mutator cleans it before the recovery pass.
 */
async function cleanAllocatorTemp(
  request: LifecycleUninstallRequestV1,
  held: HeldLifecycleStableLockV1,
): Promise<void> {
  const { context, lifecycle } = request;
  const stateDirectory = canonical(context.paths.stateDir);
  const observed = await inspectLifecycleAllocator(
    lifecycle.fs,
    stateDirectory,
    lifecycle.effectiveUid,
    [],
  );
  if (observed.temp === null) return;
  const allocatedIds = allocatedIdsFrom(
    await lifecycle.inspectLedger(request.key, uninstallResidueFrom(request.evidence)),
  );
  const rechecked = await inspectLifecycleAllocator(
    lifecycle.fs,
    stateDirectory,
    lifecycle.effectiveUid,
    allocatedIds,
  );
  await cleanLifecycleAllocatorTemp(lifecycle.fs, rechecked, held, allocatedIds);
}

function isMissingEntry(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The detach planner's no-follow reads over the real filesystem. */
const nodeInstructionFs: InstructionFileSystemV1 = {
  async lstat(path) {
    try {
      return await lstat(path, { bigint: true });
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
  },
  async readFile(path) {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  },
  async readdir(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
  },
};

export interface UninstallDetachPlanV1 {
  readonly input: InstructionDetachInputV1;
  readonly plan: InstructionDetachPlanV1;
}

export interface UninstallDetachOutcomeV1 {
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * `foundation.md` §12.4's detach, planned from one read of the manifest and one of the configuration: the
 * transaction's `expectedBeforeHash` guards are the hashes of the very bytes planned from.
 * `null` when no row is vendor-owned, so a home that never attached a vendor does not enter the
 * mutation gate at all.
 */
export async function planUninstallDetach(context: CliContext, lifecycle: CliLifecycleContext): Promise<UninstallDetachPlanV1 | null> {
  const paths = await planningPaths(context);
  const observed = await observeManifestSchema(lifecycle.fs, paths);
  if (observed.kind !== "v2") throw new V2HomeAdmissionError("manifest_absent", [paths.manifestFile]);
  const homes = resolveVendorHomes(context.env, context.userHome, paths.home);
  const manifest = validateManifestV2(decodeCanonicalJson(observed.bytes, MAX_MANIFEST_BYTES), manifestAdmissionFor(paths, [], homes));
  if (!manifest.artifacts.some((artifact) => artifact.owner === "claude" || artifact.owner === "codex")) return null;

  let configHash = "";
  const text = await context.guards.readText(context.paths.configFile, async (handle) => {
    const bytes = await handle.readFile();
    configHash = hashBytes(bytes);
    return bytes.toString("utf8");
  });
  const input: InstructionDetachInputV1 = {
    vendors: ["claude", "codex"],
    homes,
    manifest,
    manifestHash: hashBytes(observed.bytes) as LowerHexSha256,
    config: loadConfig(text),
    configHash: configHash as LowerHexSha256,
    fs: nodeInstructionFs,
  };
  return { input, plan: await planInstructionDetach(input) };
}

async function codexExecutable(context: CliContext): Promise<string | null> {
  const discovery = await context.platform.discoverExecutable("codex");
  if (!discovery.installed || discovery.executablePath === null) return null;
  await context.platform.assertTrustedExecutable(discovery.executablePath);
  return discovery.executablePath;
}

/**
 * `foundation.md` §12.4's detach under the mutation gate, re-planned under its lock: a refusal fires before
 * Codex is unregistered, and unregistration runs before any file changes. The executor writes
 * files only, so the directories the plan empties are removed after the commit, through the same
 * re-resolving `rmdir` the V1 revert uses.
 */
export async function detachVendorInstructions(context: CliContext, lifecycle: CliLifecycleContext): Promise<UninstallDetachOutcomeV1> {
  return withLifecycleMutation(context, lifecycle, async () => {
    const planned = await planUninstallDetach(context, lifecycle);
    if (planned === null) return { removed: [], preserved: [], warnings: [] };
    const { input, plan } = planned;
    const warnings: string[] = [];
    if (input.manifest.artifacts.some((artifact) => artifact.owner === "codex")) {
      const { warning } = await unregisterCodexPlugin({
        runner: context.runner,
        codexExecutable: await codexExecutable(context),
        codexHome: input.homes.codexHome,
      });
      if (warning !== null) warnings.push(warning);
      warnings.push(CODEX_HOOK_TRUST_RESIDUE);
    }
    if (plan.kind === "noop") return { removed: [], preserved: [], warnings };

    await context.executor.execute({ kind: "instructions", mutations: plan.mutations });
    const emptied = new Set(plan.directories);
    const directories = await Promise.all(
      input.manifest.artifacts
        .filter((artifact) => emptied.has(artifact.path))
        .map(async (artifact) => ({
          artifact: await downcastArtifactV2(context, artifact),
          canonicalPath: await context.guards.canonicalize(artifact.path),
        })),
    );
    const outcome = await removeDirectories(context, directories);
    const kept = new Set(outcome.preserved);
    return {
      removed: plan.removed.filter((path) => !kept.has(path)),
      preserved: [...plan.preserved, ...outcome.preserved],
      warnings,
    };
  }, undefined, undefined, uninstallResidueFrom);
}
