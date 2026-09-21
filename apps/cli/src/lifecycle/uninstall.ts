/**
 * Spec 1 §6 steps 1–4 as amended by A14–A16 and D24–D28: `uninstall` on an admitted V2 home is
 * one coordinator — marker, lease drain, artifact removal, key tombstone, manifest tombstone —
 * that leaves exactly the A12 bookkeeping set plus retained bootstrap evidence. Planning happens
 * under the global mutation lock and allocates nothing, so every refusal below fires before
 * `reserveLifecycleIdBlock` moves the counter.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { lstat, open } from "node:fs/promises";

import {
  EXIT_CODES,
  FoundationParticipantExecutor,
  LifecycleCoordinator,
  LifecycleRecoveryRequiredError,
  LIFECYCLE_LEASE_DRAIN_MS,
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
  inspectLifecycleAllocator,
  lifecycleBookkeepingPaths,
  maximumCoordinatorJournalBytes,
  parseCanonicalAbsolutePathText,
  parseLifecycleCoordinatorId,
  parseManifestParticipantId,
  reserveLifecycleIdBlock,
  validateManifestV2,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  FoundationParticipantRefV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleCoordinatorBoundaryV1,
  LifecycleCoordinatorIdV1,
  LifecycleExecutionBuilderV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleLeafReservationV1,
  LifecycleLedgerSnapshotV1,
  LifecycleParticipantAdaptersV1,
  LowerHexSha256,
  ManagedArtifactV1,
  ManifestAdmissionContextV1,
  ManifestStatePlanV1,
  RuntimePaths,
  ScheduledJobIdV1,
} from "@developer-os/core";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
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
import { observeLifecycleActivationRecord } from "./admission.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import {
  lifecyclePushPlanHash,
  lifecycleVariantFacts,
  LifecycleUnsupportedLeafError,
  uninstallLeasePaths,
} from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { residueFrom } from "./context.js";
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
const MAX_ARTIFACT_MUTATIONS = 256;
const MAX_MUTATION_BYTES = 16_777_216;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_PLAN_BYTES = 16_777_216;
const MAX_JOURNAL_BYTES = 1_048_576;
const RESERVATION_SLOTS = 6;
const FOUNDATION_BINDINGS_DOMAIN = "developer-os/manifest-foundation-bindings/v1\0";
const WIDEST_UINT64 = "18446744073709551615";
const WIDEST_HASH = "f".repeat(64);

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
 * D26 is a capacity verdict and not a recovery state: nothing is durable when it fires, so it
 * joins §2.4's pre-reservation class rather than refusing a home the user can still uninstall
 * by removing artifacts by hand.
 */
export class UninstallCapacityError extends Error {
  readonly code: typeof EXIT_CODES.capabilityUnavailable = EXIT_CODES.capabilityUnavailable;
  readonly reason = "uninstall_artifact_capacity_exceeded" as const;
  readonly paths: readonly string[];

  constructor(count: number, productHome: string) {
    super(`the installation records ${String(count)} removable artifacts, more than one Foundation transaction can carry`);
    this.name = "UninstallArtifactCapacityExceededError";
    this.paths = [productHome];
  }
}

/**
 * `failureFrom` publishes `kindOf(name)`, and the published contract for every 1b-deferred arm
 * is its `reason`, so the name is spelled to make the two equal — the same rule
 * `LifecycleMutationRefusal` and `V2HomeAdmissionError` follow, with a digit in the reason.
 */
function refuseUnsupportedUntilPlan1b(arm: string): never {
  const error = new LifecycleUnsupportedLeafError(arm);
  error.name = "Unsupported_until_plan_1bError";
  throw error;
}

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

interface UninstallPlanInputsV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly configPath: CanonicalAbsolutePathV1;
  readonly activationPath: CanonicalAbsolutePathV1;
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly manifestBefore: LifecycleGuardedEntryV1;
  readonly manifestHash: LowerHexSha256;
  readonly keyBefore: RedactionKeyStatePlanV1["before"];
  readonly markerPreimage: ArtifactMutationV1;
  readonly artifacts: readonly ArtifactMutationV1[];
  readonly createdAt: string;
  refs: readonly FoundationParticipantRefV1[] | null;
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
  const marker = [inputs.markerPreimage];
  const pairs = [
    { slot: "uninstall_marker" as const, forward: ids[0], compensation: ids[1], count: marker.length },
    { slot: "uninstall_artifacts" as const, forward: ids[2], compensation: ids[3], count: Math.max(1, inputs.artifacts.length) },
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
        mutations: Array.from({ length: pair.count }, (_unused, ordinal) => ({
          targetPath: canonical(`${inputs.productHome}/state/${String(ordinal)}.placeholder`),
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
  const artifacts = Math.max(1, inputs.artifacts.length);
  return {
    /** Four participants, each a journal, its lock and one rewrite temp. */
    foundationJournals: 12,
    coordinatorJournals: 3,
    gitEffectJournals: 0,
    launchdEffectJournals: 0,
    /** Marker forward and its inverse stage one blob each; the artifact inverse stages one per row. */
    foundationStaging: 4 + 3 * (1 + 1 + artifacts),
    foundationBackups: 4 + 5 * (1 + 1 + artifacts),
    /** The coordinator directory, its `foundation` child, one directory and one journal per ref. */
    lifecycleStaging: 2 + 2 * 4,
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

/** The builder closes over its inputs so `execute` can bind the staged refs before it rebuilds. */
const BUILDER_INPUTS = new WeakMap<object, UninstallPlanInputsV1>();

function uninstallBuilder(
  inputs: UninstallPlanInputsV1,
): LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> {
  const builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1> = {
    slotCount: RESERVATION_SLOTS,
    build(ids: readonly string[]) {
      const coordinatorId = String(ids[0]);
      const participantIds = ids.slice(1, 5);
      const manifestId = String(ids[5]);
      const refs = inputs.refs ?? placeholderRefs(inputs, coordinatorId, participantIds);
      const forwardOf = (slot: "uninstall_marker" | "uninstall_artifacts"): FoundationParticipantRefV1 => {
        const ref = refs.find((candidate) => candidate.slot === slot && candidate.role.kind === "forward");
        if (ref === undefined) throw new Error("the uninstall builder needs four Foundation references");
        return ref;
      };
      const markerForward = forwardOf("uninstall_marker");
      const artifactsForward = forwardOf("uninstall_artifacts");
      /** §8.1's plan codec requires `participants.foundation` in unsigned UTF-8 order by id. */
      const sorted = [...refs].sort((left, right) =>
        Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
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
          plistPaths: [],
        },
        participants: {
          foundation: sorted,
          manifest: manifestLeafOf(inputs, coordinatorId, manifestId, [
            markerForward.id,
            artifactsForward.id,
          ]),
          sourceGitEffect: null,
          destinationGitEffect: null,
          launchdBeforeFiles: null,
          launchdAfterFiles: null,
          launchd: null,
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
          { kind: "drain_runners" },
          { kind: "foundation", slot: "uninstall_artifacts", participantId: artifactsForward.id },
          { kind: "redaction_key", transition: "stage" },
          { kind: "manifest", transition: "preserve_before" },
          { kind: "manifest", transition: "commit_absence" },
          { kind: "redaction_key", transition: "delete" },
          { kind: "manifest", transition: "finalize_tombstones" },
        ],
      };
      return {
        plan: { ...base, maximumJournalBytes: maximumCoordinatorJournalBytes(base) },
        reservation: reservationFor(inputs),
      };
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
  const retained = [...evidence.retainedRoots, ...evidence.retainedPaths];
  return manifest.artifacts
    .filter((artifact) => artifact.kind === "directory")
    .map((artifact) => artifact.path as string)
    .filter((path) => path.startsWith(`${productHome}/`))
    .filter((path) => !bookkeeping.has(path))
    .filter((path) => !retained.some((root) => path === root || path.startsWith(`${root}/`)))
    .sort((left, right) => right.length - left.length);
}

async function uninstallCommitted(
  fs: LifecycleGuardedFileSystemV1,
  plan: LifecycleExecutionPlanV1,
): Promise<boolean> {
  return (await guardedEntry(fs, plan.authority.manifestPath)) === null;
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
    launchdBeforeFiles: null,
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
     * included, and it carries no terminal outcome to tell them apart. Taking the nonce and the
     * allocator from a home whose uninstall compensated would leave an installation that
     * §2.1 can no longer admit, so the restored manifest is the discriminator: it is present
     * exactly when this coordinator rolled back, and then nothing here is collected.
     */
    controlFiles: {
      removeAllocator: async (plan) => {
        if (!(await uninstallCommitted(fs, plan))) return;
        await removeStateLeaf(fs, productHome, MARKER_LEAF);
        await removeStateLeaf(fs, productHome, ALLOCATOR_LEAF);
      },
      removeNonce: async (plan) => {
        if (!(await uninstallCommitted(fs, plan))) return;
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
    if (variant === "uninstall/present_manifest") refuseUnsupportedUntilPlan1b(variant);
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
          .filter((artifact) => !reserved.has(artifact.path as string))
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
    /** §6: the four runner leases first, in reconciliation order, then unsigned UTF-8 order. */
    const ordered = [...files].sort((left, right) => {
      const leftLease = leaseOrder.get(left.artifact.path) ?? Number.MAX_SAFE_INTEGER;
      const rightLease = leaseOrder.get(right.artifact.path) ?? Number.MAX_SAFE_INTEGER;
      if (leftLease !== rightLease) return leftLease - rightLease;
      return Buffer.compare(Buffer.from(left.artifact.path), Buffer.from(right.artifact.path));
    });

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
    if (artifacts.length > MAX_ARTIFACT_MUTATIONS) {
      throw new UninstallCapacityError(artifacts.length, productHome);
    }
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
      artifacts,
      createdAt: context.now().toISOString(),
      refs: null,
    };

    return {
      variant,
      removable: [
        ...partitioned.removable.map((entry) => entry.artifact.path),
        ...reserved,
      ].sort(),
      preserved: [...new Set([...partitioned.preserved, ...evidence.retainedPaths])],
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
      const residue = residueFrom(evidence);
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

      const block = await reserveLifecycleIdBlock(
        {
          fs: lifecycle.fs,
          stateDirectory: canonical(context.paths.stateDir),
          effectiveUid: lifecycle.effectiveUid,
          uuid: lifecycle.uuid,
          held: current(),
          allocatedIds: allocatedIdsFrom(recovered.snapshot),
        },
        RESERVATION_SLOTS,
      );
      const ids = Array.from({ length: RESERVATION_SLOTS }, (_unused, index) =>
        index === 0
          ? formatAllocatedLifecycleId("lc", block.nonce, block.firstCounter)
          : index === RESERVATION_SLOTS - 1
            ? formatAllocatedLifecycleId("mf", block.nonce, block.firstCounter + BigInt(index))
            : formatAllocatedLifecycleId("tx", block.nonce, block.firstCounter + BigInt(index)),
      );
      const coordinatorId = parseLifecycleCoordinatorId(ids[0], request.key.nonce);

      const store = lifecycle.store(request.key);
      await store.ensureStagingDirectory(coordinatorId, current());
      inputs.refs = await stageUninstallParticipants(
        participants.foundation,
        inputs,
        coordinatorId,
        ids.slice(1, 5),
      );
      const { plan } = preview.builder.build(ids);
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
      createdAt: inputs.createdAt as never,
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
  const forwardArtifacts = inputs.artifacts.map((mutation) => ({
    targetPath: mutation.targetPath,
    operation: "remove" as const,
    expectedBeforeHash: mutation.hash,
    content: null,
  }));
  const inverseMarker = [
    {
      targetPath: inputs.markerPreimage.targetPath,
      operation: "replace" as const,
      expectedBeforeHash: digestOf(marker),
      content: inputs.markerPreimage.content,
    },
  ];
  const inverseArtifacts = [...inputs.artifacts].reverse().map((mutation) => ({
    targetPath: mutation.targetPath,
    operation: "create" as const,
    expectedBeforeHash: null,
    content: mutation.content,
  }));

  const pairs = [
    { slot: "uninstall_marker" as const, forward: ids[0], compensation: ids[1], forwardMutations: forwardMarker, inverse: inverseMarker },
    { slot: "uninstall_artifacts" as const, forward: ids[2], compensation: ids[3], forwardMutations: forwardArtifacts, inverse: inverseArtifacts },
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
        id: forwardId as never,
        slot: pair.slot,
        role: { kind: "forward", compensationId: compensationId as never },
        createdAt: inputs.createdAt as never,
        mutations: pair.forwardMutations,
      }),
    );
    refs.push(
      await foundation.stage({
        coordinatorId,
        id: compensationId as never,
        slot: pair.slot,
        role: { kind: "compensation", forwardId: forwardId as never },
        createdAt: inputs.createdAt as never,
        mutations: pair.inverse,
      }),
    );
  }
  return [refs[0], refs[1], refs[2], refs[3]] as readonly FoundationParticipantRefV1[];
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
    await lifecycle.inspectLedger(request.key, residueFrom(request.evidence)),
  );
  const rechecked = await inspectLifecycleAllocator(
    lifecycle.fs,
    stateDirectory,
    lifecycle.effectiveUid,
    allocatedIds,
  );
  await cleanLifecycleAllocatorTemp(lifecycle.fs, rechecked, held, allocatedIds);
}
