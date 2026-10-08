import { createHash } from "node:crypto";
import { dirname } from "node:path";

import {
  admitReleaseAgainstTrust,
  admitReleaseIdentity,
  advanceReleaseTrust,
  buildRollbackPreview,
  codexRegistrationProjectionHash,
  decodeCanonicalJson,
  encodeCanonicalJson,
  encodeTenDigitOrdinal,
  EXIT_CODES,
  isPackageChannelTrust,
  isUnsignedLocalTrust,
  materializePlannerDraft,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  ownerExternalEffectProcessPolicyHash,
  MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  PLANNER_PROTOCOL_V1,
  PLANNER_WIRE_BOUNDS_V1,
  ReleaseUnsignedLocalError,
  selectRelease,
  UpdateCapacityInsufficientError,
  validateBundleManifest,
  validatePackageChannelDelegation,
  validateReleaseIndex,
} from "@developer-os/core";
import type {
  ActiveReleaseRecordV1,
  ArtifactOwner,
  CanonicalAbsolutePathV1,
  CanonicalJsonV1,
  CanonicalJsonValue,
  ExitCode,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  OwnerUpdatePreviewInputV1,
  PlannerContentRefV1,
  PlannerPathTokenV1,
  PreparedInverseLeafInputV1,
  PreparedUpdateCandidateV1,
  ReleaseBundleManifestV1,
  ReleaseBundleReferenceV1,
  ReleaseIdentityV1,
  ReleaseMetadataIdentityV1,
  ReleaseTrustStateV1,
  RetainedExternalEffectInversePlanV1,
  RetainedInversePathStateV1,
  RetainedOwnerInverseOperationV1,
  RetainedOwnerInverseProjectionV1,
  RetainedSchemaMigrationInverseProjectionV1,
  RollbackRecordV1,
  RetainedInverseBlobRefV1,
  RollbackPayloadEntryV1,
  RollbackPayloadPreviewV1,
  RollbackPayloadRelativePathV1,
  SafeReasonCodeV1,
  SchemaMigrationPreviewV1,
  SecretScreenedBlobV1,
  StableSemverV1,
  TargetUpdateDraftV1,
  UInt64DecimalV1,
  UpdateCapacityComponentV1,
  UpdateCapacityInputV1,
  UpdatePackageSourcePreviewV1,
  UpdatePlannerRequestV1,
  UpdatePlanPreviewV1,
  UpdateRollbackPreviewV1,
  UtcTimestampV1,
  CanonicalProductStatePathV1,
} from "@developer-os/core";
import type { TargetPlannerRunResultV1, VerifiedScratchBundleV1 } from "@developer-os/security";

import { compareManifestRows } from "../instructions/attach.js";
import { codexVersionToken } from "./codex-effect-ports.js";
import { requireCodexRegistered } from "./codex-refresh.js";
import { codexRegistrationFile } from "../instructions/vendor-homes.js";
import type { CliUpdateContext } from "./context.js";

/**
 * Spec 2 §7.3. `applied` and `rolled_back` belong to `--apply` (Task 24/25); the plan-only
 * commands here return the other three arms.
 */
export type UpdateCommandResultV1 =
  | { readonly schemaVersion: 1; readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 }
  | { readonly schemaVersion: 1; readonly outcome: "preview"; readonly plan: UpdatePlanPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "applied"; readonly active: ReleaseIdentityV1; readonly rollbackAvailable: true }
  | { readonly schemaVersion: 1; readonly outcome: "rollback_preview"; readonly plan: UpdateRollbackPreviewV1 }
  | { readonly schemaVersion: 1; readonly outcome: "rolled_back"; readonly active: ReleaseIdentityV1; readonly rollbackAvailable: false };

/** Spec 2 §10.1's record codec lives in Core; the CLI re-exports it for its existing readers. */
export { validateRollbackRecord } from "@developer-os/core";
export type { RollbackRecordV1 } from "@developer-os/core";

/** The read-only admitted V2 home both plan-only commands start from. */
export interface UpdateHomeV1 {
  readonly manifest: InstallationManifestV2;
  readonly active: ActiveReleaseRecordV1;
  readonly trust: ReleaseTrustStateV1;
  readonly rollback: RollbackRecordV1 | null;
}

/** Tokenized planner input plus the in-memory authority that never crosses the wire. */
export interface UpdatePlannerSnapshotV1 {
  readonly request: UpdatePlannerRequestV1;
  readonly inputBlobs: readonly Uint8Array[];
  readonly tokenPaths: ReadonlyMap<PlannerPathTokenV1, CanonicalAbsolutePathV1>;
  readonly ownerRoots: Readonly<Partial<Record<ArtifactOwner, CanonicalAbsolutePathV1>>>;
}

export interface UpdateCapacityObservationV1 {
  readonly availableBytes: UInt64DecimalV1;
  readonly availableEntries: UInt64DecimalV1;
  readonly reservationGranularityBytes: UInt64DecimalV1;
}

/** What rollback preview reads from the retained payload, already hash- and postimage-checked. */
export interface RetainedRollbackEvidenceV1 {
  readonly payload: RollbackPayloadPreviewV1;
  readonly owners: readonly RetainedOwnerInverseProjectionV1[];
  readonly migrations: readonly RetainedSchemaMigrationInverseProjectionV1[];
}

export interface PlannedUpdateV1 {
  readonly result: Extract<UpdateCommandResultV1, { readonly outcome: "up_to_date" | "preview" }>;
  /** The private in-memory candidate an `--apply` in this same invocation consumes; never rendered. */
  readonly candidate: PreparedUpdateCandidateV1 | null;
}

/**
 * Everything the planner request and preview hash over, fixed before the first run so the
 * under-lock rerun is comparable. `observation` is null only before the first capacity read.
 */
export interface UpdateTargetInputsV1 {
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly signedMetadata: SignedReleaseMetadataV1;
  readonly bundle: ReleaseBundleReferenceV1;
  readonly bundleManifest: ReleaseBundleManifestV1;
  /** The admitted keg's `bundle` directory, the planner's and the bundle source's read-only root. */
  readonly verified: VerifiedScratchBundleV1;
  readonly packageSource: UpdatePackageSourcePreviewV1;
  readonly plannedAt: UtcTimestampV1;
  readonly retained: RetainedRollbackEvidenceV1 | null;
  readonly observation: UpdateCapacityObservationV1 | null;
}

/** P4 (D72): the keg's retained delegation, release index and bundle manifest, bundle-plan metadata ordinals 0–2. */
export type SignedReleaseMetadataV1 = readonly [CanonicalJsonV1, CanonicalJsonV1, CanonicalJsonV1];

export interface MaterializedUpdateV1 {
  readonly snapshot: UpdatePlannerSnapshotV1;
  /** The bytes behind `metadata`'s and the target's signed hashes, for the `release_metadata_after` rows. */
  readonly signedMetadata: SignedReleaseMetadataV1;
  readonly run: TargetPlannerRunResultV1;
  readonly manifest: InstallationManifestV2;
  readonly observation: UpdateCapacityObservationV1;
  /** The aggregate feasibility input; the lock rechecks it against a fresh observation. */
  readonly capacity: UpdateCapacityInputV1;
  readonly candidate: PreparedUpdateCandidateV1;
}

/** One previewed update carried in memory to the lock. */
export interface PreparedUpdateApplyV1 {
  readonly home: UpdateHomeV1;
  readonly inputs: UpdateTargetInputsV1 & { readonly observation: UpdateCapacityObservationV1 };
  readonly materialized: MaterializedUpdateV1;
}

/** A content-free refusal: the reason code is the whole message (Spec 2 §11). */
export class UpdatePlanningRefusal extends Error {
  constructor(
    readonly reason: SafeReasonCodeV1 | string,
    readonly code: Exclude<ExitCode, 0>,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(reason);
    this.name = "UpdatePlanningRefusal";
  }
}

function refuse(reason: string, code: Exclude<ExitCode, 0>, paths: readonly string[] = [], recovery?: string): never {
  throw new UpdatePlanningRefusal(reason, code, paths, recovery);
}

/**
 * Runs `work` and turns an unclassified validator throw into a fixed reason. An error that already
 * carries an exit code keeps it; a JavaScript defect is never reclassified as a policy refusal.
 */
async function classified<T>(reason: string, code: Exclude<ExitCode, 0>, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") throw error;
    return refuse(reason, code);
  }
}

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

const encoder = new TextEncoder();
const MiB = 1_048_576;
const MAXIMUM_DELEGATION_BYTES = 64 * 1024;
const MAXIMUM_INDEX_BYTES = 4 * MiB;
const MAXIMUM_BUNDLE_MANIFEST_BYTES = 16 * MiB;
const MAXIMUM_LEAF_BYTES = 16 * MiB;
const PARTICIPANT_JOURNAL_BYTES = 1 * MiB;
const COORDINATOR_JOURNAL_BYTES = 64 * MiB;

/** The active record's release identity: the record minus its own two fields. */
export function releaseIdentityOf(active: ActiveReleaseRecordV1): ReleaseIdentityV1 {
  return {
    version: active.version,
    releaseSequence: active.releaseSequence,
    releaseIdentityHash: active.releaseIdentityHash,
    delegationSequence: active.delegationSequence,
    delegationHash: active.delegationHash,
    releaseIndexSequence: active.releaseIndexSequence,
    releaseIndexHash: active.releaseIndexHash,
    bundleManifestHash: active.bundleManifestHash,
    bundleRoot: active.bundleRoot,
    platform: active.platform,
    architecture: active.architecture,
    launcherProtocol: active.launcherProtocol,
    updateProtocol: active.updateProtocol,
  };
}

export function sameJson(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

/** A body `decodeCanonicalJson` admitted is byte-for-byte canonical, so its UTF-8 text is the `CanonicalJsonV1`. */
function canonicalText(body: Uint8Array): CanonicalJsonV1 {
  return new TextDecoder().decode(body) as CanonicalJsonV1;
}

function selectTarget(
  index: Parameters<typeof selectRelease>[0],
  request: { readonly version: StableSemverV1 | null; readonly active: ReleaseIdentityV1 },
): ReturnType<typeof selectRelease> {
  try {
    return selectRelease(index, request);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
    const message = error instanceof Error ? error.message : "";
    // A nonexistent stable version and an arbitrary downgrade are invalid input (Spec 2 §11).
    if (message.includes("requested release")) return refuse("update_release_not_found", EXIT_CODES.invalidInput);
    if (message.includes("downgrade")) return refuse("update_downgrade_refused", EXIT_CODES.invalidInput);
    return refuse("update_release_identity_rebound", EXIT_CODES.securityRefusal);
  }
}

function contentHash(content: PlannerContentRefV1, outputs: readonly SecretScreenedBlobV1[]): LowerHexSha256 {
  if (content.kind === "target_bundle") return content.sha256;
  const blob = outputs[content.blob.ordinal];
  if (blob === undefined) refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
  return blob.sha256;
}

function contentBytes(content: PlannerContentRefV1): number {
  return content.kind === "target_bundle" ? content.bytes : content.blob.bytes;
}

function tokenPath(snapshot: UpdatePlannerSnapshotV1, token: PlannerPathTokenV1): CanonicalAbsolutePathV1 {
  return snapshot.tokenPaths.get(token) ?? refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
}

function ownerRoot(snapshot: UpdatePlannerSnapshotV1, owner: ArtifactOwner): CanonicalAbsolutePathV1 {
  return snapshot.ownerRoots[owner] ?? refuse("update_owner_root_unavailable", EXIT_CODES.capabilityUnavailable);
}

function installedHashOf(row: ManagedArtifactV2): LowerHexSha256 | null {
  const verification: ManagedArtifactV2["verification"] = row.verification;
  if ("installedHash" in verification) return verification.installedHash;
  return "blockHash" in verification ? verification.blockHash : null;
}

/**
 * Spec 2 §8.2's rehydration: every token and owner-relative path becomes the current process's
 * absolute path, every installed hash is computed here, and installation history is copied from
 * the current manifest rather than accepted from target code. The result is admitted by the
 * same V2 validator every other manifest passes.
 */
function concreteManifest(
  update: CliUpdateContext,
  home: UpdateHomeV1,
  snapshot: UpdatePlannerSnapshotV1,
  draft: TargetUpdateDraftV1,
  outputs: readonly SecretScreenedBlobV1[],
  target: ReleaseIdentityV1,
): InstallationManifestV2 {
  const plannedAt = snapshot.request.plannedAt;
  const current = new Map(home.manifest.artifacts.map((row) => [row.path as string, row]));
  const rows = draft.expectedManifest.artifacts.map((row): ManagedArtifactV2 => {
    const path = row.path.kind === "installed"
      ? tokenPath(snapshot, row.path.token)
      : parseCanonicalAbsolutePathText(`${row.path.kind === "target_bundle" ? target.bundleRoot : ownerRoot(snapshot, row.path.owner)}/${row.path.path}`);
    const prior = row.path.kind === "installed" ? current.get(path) : undefined;
    const installed = (content: { readonly kind: "installed"; readonly token: PlannerPathTokenV1 } | PlannerContentRefV1): LowerHexSha256 => {
      if (content.kind !== "installed") return contentHash(content, outputs);
      const source = current.get(tokenPath(snapshot, content.token));
      return (source === undefined ? null : installedHashOf(source)) ?? refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
    };
    const draftVerification = row.verification;
    let verification: ManagedArtifactV2["verification"];
    if (draftVerification.mode === "schema") {
      verification = { mode: "schema", schemaId: draftVerification.schemaId, installedHash: installed(draftVerification.installed) };
    } else if ("installed" in draftVerification) {
      verification = { mode: "content", installedHash: installed(draftVerification.installed) };
    } else {
      verification = draftVerification.mode === "ephemeral" ? { mode: "ephemeral" } : { mode: "content" };
    }
    const common = {
      owner: row.owner,
      path,
      productVersion: row.productVersion,
      source: row.source,
      mergeStrategy: row.mergeStrategy,
      existedBefore: prior?.existedBefore ?? false,
      beforeHash: prior?.beforeHash ?? null,
      backupRelativePath: prior?.backupRelativePath ?? null,
    };
    const built = { ...common, kind: row.kind, verification, verifiedAt: plannedAt } as ManagedArtifactV2;
    // A byte-identical keep preserves its verification time; anything changed is verified at plannedAt.
    const unchanged = prior !== undefined && sameJson({ ...prior, verifiedAt: plannedAt }, built);
    return unchanged ? prior : built;
  });
  return update.admitManifest({
    schemaVersion: 2,
    productVersion: draft.expectedManifest.productVersion,
    installedAt: home.manifest.installedAt,
    // Instruction rows never reach the planner (NEW-171) and are carried unchanged, stamp included
    // (C1, reversing K7 (f)): the K8 refresh restamps what it renders, so doctor sees a missed refresh.
    artifacts: [...rows, ...home.manifest.artifacts.filter((row) => row.kind === "instruction")].sort(compareManifestRows),
  });
}

interface PreparedInverseV1 {
  readonly leaves: readonly PreparedInverseLeafInputV1[];
  readonly inversePlan: CanonicalJsonValue;
  readonly entries: readonly RollbackPayloadEntryV1[];
  readonly preimageBytes: number;
  readonly preimageEntries: number;
  readonly stagedBytes: number;
  readonly stagedEntries: number;
}

function leafPath(kind: string, id: string): RollbackPayloadRelativePathV1 {
  return `plans/${kind}/${id}.plan.json` as RollbackPayloadRelativePathV1;
}

/**
 * The allocation-free inverse: one owner leaf per owner plan (so the set is never empty), one
 * migration leaf per migration, every preimage as a derived-path blob, then the leaves themselves.
 * Hashes come only from the current process's own observation and screened output frames.
 */
function prepareInverse(
  snapshot: UpdatePlannerSnapshotV1,
  draft: TargetUpdateDraftV1,
  outputs: readonly SecretScreenedBlobV1[],
  bundleModes: ReadonlyMap<string, 384 | 448>,
  codexEffect: RetainedExternalEffectInversePlanV1 | null,
): PreparedInverseV1 {
  const entries: RollbackPayloadEntryV1[] = [];
  let stagedBytes = 0;
  let stagedEntries = 0;
  const addBlob = (role: RollbackPayloadEntryV1["role"], bytes: number, hash: LowerHexSha256): RetainedInverseBlobRefV1 => {
    const ordinal = entries.length;
    const path = `blobs/${encodeTenDigitOrdinal(ordinal)}.bin` as RollbackPayloadRelativePathV1;
    entries.push({ ordinal, path, role, bytes, sha256: hash });
    return { path, bytes, sha256: hash };
  };
  const inputs = new Map(snapshot.request.artifactInputs.map((input) => [input.token as string, input]));
  /** The observed preimage as a restore state; a zero-byte file restores from zero chunks. */
  const preimage = (token: PlannerPathTokenV1, expected: LowerHexSha256 | null): Extract<RetainedInversePathStateV1, { readonly state: "file" }> => {
    const observed = inputs.get(token)?.observed;
    if (observed?.state !== "content" || observed.blob === null || observed.sha256 !== expected) {
      return refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
    }
    const chunks = observed.bytes === 0 ? [] : [addBlob("owner_preimage", observed.bytes, observed.sha256)];
    return { state: "file", mode: observed.mode, bytes: observed.bytes, sha256: observed.sha256, payload: { chunks, aggregateBytes: observed.bytes, sha256: observed.sha256 } };
  };
  const stagedSize = (content: PlannerContentRefV1): void => {
    stagedBytes += contentBytes(content);
    stagedEntries += 1;
  };
  /** The written file an inverse expects; a bundle file keeps its signed mode, a planner output its fallback. */
  const written = (content: PlannerContentRefV1, fallbackMode: 384 | 448): RetainedInversePathStateV1 => ({
    state: "file",
    mode: content.kind === "target_bundle" ? bundleModes.get(content.path) ?? refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal) : fallbackMode,
    bytes: contentBytes(content),
    sha256: contentHash(content, outputs),
    payload: null,
  });

  const owners = draft.ownerPlans.map((plan): RetainedOwnerInverseProjectionV1 => {
    const operations: RetainedOwnerInverseOperationV1[] = [];
    for (const operation of plan.proposedOperations) {
      if (operation.operation === "keep") continue;
      if (operation.operation === "create") {
        stagedSize(operation.content);
        operations.push({
          path: parseCanonicalAbsolutePathText(`${ownerRoot(snapshot, plan.owner)}/${operation.target.path}`),
          expectedCurrent: written(operation.content, 384),
          restore: { state: "absent" },
        });
        continue;
      }
      const restore = preimage(operation.target.token, operation.expectedHash);
      if (operation.operation === "replace") stagedSize(operation.content);
      operations.push({
        path: tokenPath(snapshot, operation.target.token),
        expectedCurrent: operation.operation === "replace" ? written(operation.content, restore.mode) : { state: "absent" },
        restore,
      });
    }
    return {
      schemaVersion: 1,
      kind: "owner_inverse",
      id: `owner_${plan.owner}` as SafeReasonCodeV1,
      owner: plan.owner,
      operations: operations.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
      // P6: the drafted Codex refresh, replayed over the restored tree by a later rollback.
      externalEffects: plan.owner === "codex" && plan.externalEffects.length > 0 && codexEffect !== null ? [codexEffect] : [],
      maximumPlanBytes: MAXIMUM_LEAF_BYTES,
    };
  });

  const migrations = draft.migrations.map((migration): RetainedSchemaMigrationInverseProjectionV1 => ({
    schemaVersion: 1,
    kind: "schema_migration_inverse",
    id: migration.id,
    domain: migration.domain,
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    mutations: migration.mutations.map((mutation) => {
      const after = outputs[mutation.afterBlob.ordinal];
      const inverse = outputs[mutation.inverseBlob.ordinal];
      // The inverse must restore the exact before bytes, or rollback could not return to them.
      if (after === undefined || inverse === undefined || inverse.sha256 !== mutation.beforeHash) {
        return refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
      }
      stagedBytes += after.bytes;
      stagedEntries += 1;
      return {
        path: mutation.path.domain === "brain" ? mutation.path.path : tokenPath(snapshot, mutation.path.token) as CanonicalProductStatePathV1,
        expectedCurrentHash: after.sha256,
        restoreHash: mutation.beforeHash,
        restoreBlob: addBlob("migration_preimage", inverse.bytes, inverse.sha256),
      };
    }),
    maximumPlanBytes: MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES,
  }));

  const preimageEntries = entries.length;
  const preimageBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const leaves: PreparedInverseLeafInputV1[] = [...owners, ...migrations].map((leaf) => ({
    kind: leaf.kind,
    id: leaf.id,
    projection: leaf as unknown as CanonicalJsonValue,
  }));
  const leafRows = leaves.map((leaf) => {
    const bytes = encoder.encode(encodeCanonicalJson(leaf.projection));
    const row = { kind: leaf.kind, id: leaf.id, path: leafPath(leaf.kind, leaf.id), bytes: bytes.byteLength, sha256: sha256(bytes) };
    entries.push({ ordinal: entries.length, path: row.path, role: "inverse_plan_leaf", bytes: row.bytes, sha256: row.sha256 });
    return row;
  });
  return {
    leaves,
    inversePlan: {
      schemaVersion: 1,
      operation: "update_inverse",
      current: snapshot.request.currentRelease.releaseIdentityHash,
      target: snapshot.request.targetRelease.releaseIdentityHash,
      leaves: leafRows,
    },
    entries,
    preimageBytes,
    preimageEntries,
    stagedBytes,
    stagedEntries,
  };
}

function component(kind: UpdateCapacityComponentV1["kind"], bytes: bigint | number, entries: bigint | number): UpdateCapacityComponentV1 {
  return { kind, bytes: parseUInt64Decimal(BigInt(bytes).toString(10)), entries: parseUInt64Decimal(BigInt(entries).toString(10)) };
}

/** Rollback's capacity components (§10.2): the retained restore set twice, one journal per leaf plus four, and compaction headroom. */
export function rollbackCapacityComponents(restoreBytes: number, restoreEntries: number, leaves: number): readonly UpdateCapacityComponentV1[] {
  return [
    component("transaction_staging", restoreBytes, restoreEntries),
    component("backups", restoreBytes, restoreEntries),
    component("journals", COORDINATOR_JOURNAL_BYTES + (leaves + 4) * PARTICIPANT_JOURNAL_BYTES, leaves + 5),
    component("terminal_compaction_headroom", COORDINATOR_JOURNAL_BYTES, 1),
  ];
}

function manifestTotals(manifest: ReleaseBundleManifestV1): { readonly bytes: bigint; readonly entries: number } {
  let bytes = 0n;
  for (const entry of manifest.entries) if (entry.kind === "file") bytes += BigInt(entry.bytes);
  return { bytes, entries: manifest.entries.length };
}

/**
 * Per-scope ceilings for Spec 2 §9.1's aggregate check. The persisted execution plan (Task 24)
 * re-derives exact journal and compaction bytes under the lock; these bound them from above.
 * ponytail: journal and headroom use fixed per-participant ceilings, not the exact reachable bytes.
 */
function updateCapacity(
  observation: UpdateCapacityObservationV1,
  manifest: ReleaseBundleManifestV1,
  prepared: PreparedInverseV1,
  inventoryBytes: number,
  participants: number,
): UpdateCapacityInputV1 {
  const bundle = manifestTotals(manifest);
  return {
    operation: "update",
    components: [
      // The keg is read in place (D84 K2): no scratch; the durable source copies the bundle once.
      component("verified_scratch", 0, 0),
      component("durable_bundle_source", bundle.bytes, bundle.entries),
      component("target_bundle", bundle.bytes, bundle.entries),
      component("transaction_staging", prepared.stagedBytes, prepared.stagedEntries),
      component("backups", prepared.preimageBytes, prepared.preimageEntries),
      // The payload root, `plans`, `blobs`, the two canonical files, then every inventory entry.
      component("inverse_payload", inventoryBytes, prepared.entries.length + 5),
      component("journals", COORDINATOR_JOURNAL_BYTES + participants * PARTICIPANT_JOURNAL_BYTES, participants + 1),
      component("terminal_compaction_headroom", COORDINATOR_JOURNAL_BYTES, 1),
    ],
    reservationGranularityBytes: observation.reservationGranularityBytes,
    availableBytes: observation.availableBytes,
    availableEntries: observation.availableEntries,
  };
}

function capacityRefusal(error: unknown): never {
  if (error instanceof UpdateCapacityInsufficientError) refuse(`update_capacity_insufficient_${error.dimension}`, EXIT_CODES.operationalFailure);
  throw error;
}

/**
 * Plan-only `update` (Spec 2 §7.2, D84 K2): the read-only home gates first, then the keg the
 * package channel installed is admitted once and is the whole update source. No FD 3, no network
 * and no scratch; nothing durable is written and the candidate stays in memory.
 */
export function planUpdate(update: CliUpdateContext, request: { readonly version: StableSemverV1 | null }): Promise<PlannedUpdateV1> {
  return planUpdateAttempt(update, request, { prepare: false });
}

/** The same plan, carried in memory for `applyUpdate` in this invocation. An up-to-date home has nothing to apply. */
export async function prepareUpdate(update: CliUpdateContext, request: { readonly version: StableSemverV1 | null }): Promise<PlannedUpdateV1 & { readonly apply: PreparedUpdateApplyV1 | null }> {
  return planUpdateAttempt(update, request, { prepare: true });
}

async function planUpdateAttempt(
  update: CliUpdateContext,
  request: { readonly version: StableSemverV1 | null },
  options: { readonly prepare: boolean },
): Promise<PlannedUpdateV1 & { readonly apply: PreparedUpdateApplyV1 | null }> {
  const home = await update.readHome();
  // An unsigned-local home can never update (D47); it refuses before the keg is read (NEW-147).
  if (isUnsignedLocalTrust(home.trust)) throw new ReleaseUnsignedLocalError();
  if (!isPackageChannelTrust(home.trust)) refuse("update_trust_channel", EXIT_CODES.recoveryRequired, [], "developer-os doctor");
  const current = releaseIdentityOf(home.active);

  const source = await update.readPackageSource();
  const delegationBytes = await source.readFile(source.retainedMetadata.delegation);
  const indexBytes = await source.readFile(source.retainedMetadata.releaseIndex);
  const manifestBytes = await source.readFile(source.retainedMetadata.bundleManifest);
  const { index, bundleManifest } = await classified("update_package_source_invalid", EXIT_CODES.recoveryRequired, () => {
    validatePackageChannelDelegation(decodeCanonicalJson(delegationBytes, MAXIMUM_DELEGATION_BYTES));
    return {
      index: validateReleaseIndex(decodeCanonicalJson(indexBytes, MAXIMUM_INDEX_BYTES)),
      bundleManifest: validateBundleManifest(decodeCanonicalJson(manifestBytes, MAXIMUM_BUNDLE_MANIFEST_BYTES)),
    };
  });
  const bundleManifestHash = sha256(manifestBytes);
  const metadata: ReleaseMetadataIdentityV1 = {
    delegationSequence: parseUInt64Decimal("0"),
    delegationHash: sha256(delegationBytes),
    delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
    releaseIndexSequence: index.sequence,
    releaseIndexHash: sha256(indexBytes),
  };

  const selection = selectTarget(index, { version: request.version, active: current });
  if (selection.outcome === "up_to_date") {
    // Equal version is not enough: the keg's bundle must be the one this home runs.
    const bundle = index.releases.find((entry) => entry.version === current.version)?.bundles[current.architecture === "arm64" ? 0 : 1];
    if (bundle?.manifestSha256 !== current.bundleManifestHash) refuse("update_release_identity_rebound", EXIT_CODES.securityRefusal);
    // Only metadata freshness: a rollback keeps the release high watermark above the active
    // release, so the release half is checked as guarded-active, never advanced (W2-PLANNING-2).
    await classified("update_trust_replay", EXIT_CODES.securityRefusal, () => {
      admitReleaseAgainstTrust(home.trust, current, "guarded_active");
      advanceReleaseTrust(home.trust, { ...metadata, releaseSequence: home.trust.highestAcceptedReleaseSequence, releaseIdentityHash: home.trust.releaseIdentityHash });
    });
    return { result: { schemaVersion: 1, outcome: "up_to_date", active: current }, candidate: null, apply: null };
  }

  const { selected } = selection;
  // The keg ships its own launcher, so the target's minimum is checked against the keg's protocol.
  if (selected.entry.minimumLauncherProtocol > bundleManifest.launcherProtocol) {
    refuse("update_launcher_too_old", EXIT_CODES.capabilityUnavailable, [], "upgrade the Developer OS launcher, then run developer-os update again");
  }
  if (selected.entry.updateProtocol > PLANNER_PROTOCOL_V1) {
    refuse("update_protocol_too_new", EXIT_CODES.capabilityUnavailable, [], "upgrade the Developer OS launcher, then run developer-os update again");
  }
  await classified("update_trust_replay", EXIT_CODES.securityRefusal, () => {
    admitReleaseAgainstTrust(home.trust, { releaseSequence: selected.entry.releaseSequence, releaseIdentityHash: selected.releaseIdentityHash }, "online_target");
  });
  await classified("update_trust_replay", EXIT_CODES.securityRefusal, () =>
    advanceReleaseTrust(home.trust, { ...metadata, releaseSequence: selected.entry.releaseSequence, releaseIdentityHash: selected.releaseIdentityHash }));

  const target = await classified("update_release_identity_invalid", EXIT_CODES.securityRefusal, () =>
    admitReleaseIdentity(
      {
        version: selected.entry.version,
        releaseSequence: selected.entry.releaseSequence,
        releaseIdentityHash: selected.releaseIdentityHash,
        delegationSequence: metadata.delegationSequence,
        delegationHash: metadata.delegationHash,
        releaseIndexSequence: metadata.releaseIndexSequence,
        releaseIndexHash: metadata.releaseIndexHash,
        bundleManifestHash,
        bundleRoot: `${update.productHome}/releases/${selected.entry.version}/darwin-${selected.bundle.architecture}`,
        platform: "darwin",
        architecture: selected.bundle.architecture,
        launcherProtocol: bundleManifest.launcherProtocol,
        updateProtocol: selected.entry.updateProtocol,
      },
      update.pathEvidence,
      { productHome: update.productHome, selected, metadata, bundleManifest, bundleManifestHash },
    ));

  const retained = home.rollback === null ? null : await update.readRollbackEvidence(home, home.rollback);
  // The admitted keg is the read-only source: no scratch attempt exists to create or remove.
  const verified: VerifiedScratchBundleV1 = {
    id: "rp_package_source",
    planHash: parseLowerHexSha256(source.packageInventoryHash),
    manifestHash: bundleManifestHash,
    root: parseCanonicalAbsolutePathText(`${source.packageRoot}/${source.bundleRoot}`),
    entries: bundleManifest.entries.length,
  };
  // `packageRoot` is `<keg>/libexec/fallback` by the source table, so the keg is two levels up.
  const packageSource: UpdatePackageSourcePreviewV1 = { kegPath: parseCanonicalAbsolutePathText(dirname(dirname(source.packageRoot))), bundleManifestHash };
  const plannedAt = update.clock();
  const signedMetadata: SignedReleaseMetadataV1 = [canonicalText(delegationBytes), canonicalText(indexBytes), canonicalText(manifestBytes)];
  const inputs: UpdateTargetInputsV1 = { current, target, metadata, signedMetadata, bundle: selected.bundle, bundleManifest, verified, packageSource, plannedAt, retained, observation: null };
  const materialized = await materializeUpdate(update, home, inputs);
  const result = { schemaVersion: 1, outcome: "preview", plan: materialized.candidate.preview } as const;
  if (!options.prepare) return { result, candidate: materialized.candidate, apply: null };
  return { result, candidate: materialized.candidate, apply: { home, inputs: { ...inputs, observation: materialized.observation }, materialized } };
}

/**
 * Snapshot → target planner → concrete manifest → allocation-free inverse → candidate. Every input
 * the planner request or preview hashes over is fixed in `inputs`, so the under-lock rerun of an
 * unchanged home reproduces the pre-lock candidate byte for byte (Spec 2 §9.1).
 */
export async function materializeUpdate(update: CliUpdateContext, home: UpdateHomeV1, inputs: UpdateTargetInputsV1): Promise<MaterializedUpdateV1> {
  const { current, target, metadata, bundleManifest, verified, packageSource, plannedAt, retained } = inputs;
  const snapshot = await update.snapshot(home, { current, target, plannedAt });
  const run = await update.planner.run({
    runtime: `${verified.root}/${bundleManifest.runtimeEntrypoint}`,
    planner: `${verified.root}/${bundleManifest.plannerEntrypoint}`,
    // ponytail: the keg's bundle root, read-only to the planner; a dedicated empty directory needs a scratch-grammar change.
    cwd: verified.root,
    request: snapshot.request,
    inputBlobs: snapshot.inputBlobs,
    remainingMilliseconds: PLANNER_WIRE_BOUNDS_V1.wallMilliseconds,
  });

  const manifest = concreteManifest(update, home, snapshot, run.draft, run.outputBlobs, target);
  const bundleModes = new Map(bundleManifest.entries.flatMap((entry) => (entry.kind === "file" ? [[entry.path as string, entry.mode] as const] : [])));
  const prepared = prepareInverse(snapshot, run.draft, run.outputBlobs, bundleModes, await codexEffectOf(update, run.draft, target));
  const inventoryBytes = prepared.entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const participants = run.draft.ownerPlans.length + run.draft.migrations.length + 4;
  const observation = inputs.observation ?? await update.capacity();
  const capacity = updateCapacity(observation, bundleManifest, prepared, inventoryBytes, participants);
  const candidate = await classified("update_planner_output_invalid", EXIT_CODES.securityRefusal, () => {
    try {
      return materializePlannerDraft(snapshot.request, run.draft, run.outputBlobs, {
        tokenPaths: snapshot.tokenPaths,
        ownerRoots: snapshot.ownerRoots,
        transcript: run.transcript,
        metadata,
        packageSource,
        retainedRollback: home.rollback === null || retained === null ? null : { release: home.rollback.previous, payload: retained.payload },
        capacity,
        concreteManifest: manifest as unknown as CanonicalJsonValue,
        inverseLeaves: prepared.leaves,
        inversePlan: prepared.inversePlan,
        rollbackInventoryEntries: prepared.entries,
      });
    } catch (error) {
      return capacityRefusal(error);
    }
  });
  return { snapshot, signedMetadata: inputs.signedMetadata, run, manifest, observation, capacity, candidate };
}

/**
 * P6(c)/(e): a Codex tree change requires the owner `registered` before allocation (exit 3), and
 * its drafted refresh carries the pinned policy and the current projection, which the refresh
 * restores unchanged. The expected post-update state is the current projection at the target's
 * plugin version (F8, NEW-118 (3)); the restore state is the current projection.
 */
async function codexEffectOf(update: CliUpdateContext, draft: TargetUpdateDraftV1, target: ReleaseIdentityV1): Promise<RetainedExternalEffectInversePlanV1 | null> {
  const plan = draft.ownerPlans.find((candidate) => candidate.owner === "codex");
  const changed = plan?.proposedOperations.some((operation) => operation.operation !== "keep") ?? false;
  if (plan === undefined || (!changed && plan.externalEffects.length === 0)) return null;
  const codex = (await update.codex?.()) ?? refuse("update_codex_unavailable", EXIT_CODES.capabilityUnavailable, [], "install the codex CLI, then run developer-os update again");
  requireCodexRegistered(codex.registration);
  if (plan.externalEffects.length === 0) return null;
  const restoreHash = codexRegistrationProjectionHash(codex.projection);
  return {
    kind: "codex_registration_refresh",
    providerProtocol: codex.policy.providerProtocol,
    expectedCurrentStateHash: codexRegistrationProjectionHash({ ...codex.projection, version: codexVersionToken(target.version) }),
    restoreStateHash: restoreHash,
    restorePayloads: [],
    processPolicy: codex.policy,
    processPolicyHash: ownerExternalEffectProcessPolicyHash(codex.policy),
  };
}

/**
 * Rollback's own direction: an update-created path is removed, an update-removed one created. A
 * Codex leaf that restores any file also replaces the registration record (P6(d), NEW-168).
 */
function ownerRollbackPreview(leaf: RetainedOwnerInverseProjectionV1, manifest: InstallationManifestV2, productHome: string): OwnerUpdatePreviewInputV1 {
  const paths = { create: [] as CanonicalAbsolutePathV1[], replace: [] as CanonicalAbsolutePathV1[], remove: [] as CanonicalAbsolutePathV1[], unchanged: [] as CanonicalAbsolutePathV1[] };
  const touched = new Set<string>();
  for (const operation of leaf.operations) {
    touched.add(operation.path);
    if (operation.restore.state === "absent") paths.remove.push(operation.path);
    else if (operation.expectedCurrent.state === "absent") paths.create.push(operation.path);
    else paths.replace.push(operation.path);
  }
  const registration = codexRegistrationFile(productHome);
  if (leaf.owner === "codex" && leaf.operations.length > 0 && !touched.has(registration) && manifest.artifacts.some((row) => row.owner === "codex" && row.path === registration)) {
    touched.add(registration);
    paths.replace.push(registration as CanonicalAbsolutePathV1);
  }
  for (const row of manifest.artifacts) if (row.owner === leaf.owner && !touched.has(row.path)) paths.unchanged.push(row.path);
  return {
    owner: leaf.owner,
    paths,
    externalEffects: leaf.externalEffects.length === 0 ? 0 : 1,
  };
}

/**
 * Plan-only `update rollback` (Spec 2 §10.2): retained local evidence only, so the keg is never
 * read. A post-update edit is refused inside `readRollbackEvidence`.
 */
export async function planRollback(update: CliUpdateContext): Promise<UpdateRollbackPreviewV1> {
  const home = await update.readHome();
  const record = home.rollback ?? refuse("update_rollback_unavailable", EXIT_CODES.capabilityUnavailable);
  const current = releaseIdentityOf(home.active);
  if (!sameJson(record.installed, current)) refuse("update_rollback_record_mismatch", EXIT_CODES.recoveryRequired, [], "developer-os doctor");
  await classified("update_rollback_trust_invalid", EXIT_CODES.securityRefusal, () => {
    admitReleaseAgainstTrust(home.trust, record.previous, "guarded_retained_rollback");
  });
  const evidence = await update.readRollbackEvidence(home, record);
  const observation = await update.capacity();
  try {
    return buildRollbackPreview({
      current,
      target: record.previous,
      owners: evidence.owners.map((leaf) => ownerRollbackPreview(leaf, home.manifest, update.productHome)),
      migrations: evidence.migrations.map((leaf): SchemaMigrationPreviewV1 => ({
        id: leaf.id,
        domain: leaf.domain,
        fromVersion: leaf.fromVersion,
        toVersion: leaf.toVersion,
        affectedPaths: leaf.mutations.map((mutation) => mutation.path),
      })),
      payload: evidence.payload,
      capacity: {
        operation: "rollback",
        components: rollbackCapacityComponents(evidence.payload.aggregateBytes, evidence.payload.entryCount, evidence.owners.length + evidence.migrations.length),
        reservationGranularityBytes: observation.reservationGranularityBytes,
        availableBytes: observation.availableBytes,
        availableEntries: observation.availableEntries,
      },
    });
  } catch (error) {
    return capacityRefusal(error);
  }
}

/** Spec 2 §10.1: the record, inverse plan, and inventory are each at most 64 MiB. */
export const MAXIMUM_ROLLBACK_RECORD_BYTES = MAXIMUM_ROLLBACK_DOCUMENT_BYTES;
