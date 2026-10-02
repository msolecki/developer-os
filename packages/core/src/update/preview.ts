import { createHash } from "node:crypto";

import { encodeCanonicalJson, hashCanonicalJson, type CanonicalJsonV1, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { parseAllocatedLifecycleId, type AllocatedLifecycleIdV1 } from "../lifecycle/ids.js";
import type { ArtifactOwner } from "../manifest/types.js";
import { projectUpdateCapacity, type UpdateCapacityInputV1, type UpdateCapacityProjectionV1 } from "./capacity.js";
import { SCHEMA_MIGRATION_DOMAIN_ORDER } from "./migration-planning.js";
import type { SchemaMigrationDomainV1 } from "./migrations.js";
import {
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalProductStatePathV1,
  type RollbackPayloadRelativePathV1,
  type VaultRelativePathV1,
} from "./paths.js";
import { compareUtf8, type ReleaseIdentityV1, type ReleaseMetadataIdentityV1 } from "./release.js";
import {
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseUInt64Decimal,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type SafeReasonCodeV1,
  type SchemaMigrationIdV1,
  type UInt64DecimalV1,
} from "./scalars.js";

declare const safeRenderedPathV1: unique symbol;

/**
 * The lossy `renderPath` projection the CLI applies at the human output boundary only. Core
 * never produces one: it is never persisted, hashed, returned in JSON, or accepted back as
 * mutation authority (Spec 2 §7.2), so nothing here takes it as input.
 */
export type SafeRenderedPathV1 = string & { readonly [safeRenderedPathV1]: true };

/**
 * Spec 2 §10.1's payload ID, reserved from the lifecycle allocator. rollback.ts, which owns every
 * payload schema, imports it from here so construction and preview need no cycle.
 */
export type RollbackPayloadIdV1 = AllocatedLifecycleIdV1<"rb">;

export interface OwnerUpdatePreviewV1 {
  readonly owner: ArtifactOwner;
  readonly counts: {
    readonly create: number;
    readonly replace: number;
    readonly remove: number;
    readonly unchanged: number;
    readonly externalEffects: 0 | 1;
  };
  readonly paths: OwnerPreviewPathsV1;
}

export interface OwnerPreviewPathsV1 {
  readonly create: readonly CanonicalAbsolutePathV1[];
  readonly replace: readonly CanonicalAbsolutePathV1[];
  readonly remove: readonly CanonicalAbsolutePathV1[];
  readonly unchanged: readonly CanonicalAbsolutePathV1[];
}

export interface SchemaMigrationPreviewV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly affectedPaths: readonly (VaultRelativePathV1 | CanonicalProductStatePathV1)[];
}

/**
 * Spec 2 §8.2's protocol ceilings. Core defines the shape because the preview and the prepared
 * candidate carry it and Core imports nothing from Security; Security's supervision enforces it.
 */
export interface PlannerWireBoundsV1 {
  readonly requestJsonBytes: number;
  readonly resultJsonBytes: number;
  readonly inputBlobCount: number;
  readonly outputBlobCount: number;
  readonly inputBlobBytes: number;
  readonly outputBlobBytes: number;
  readonly stdinWireBytes: number;
  readonly stdoutWireBytes: number;
  readonly stderrBytes: number;
  readonly residentBytes: number;
  readonly idleMilliseconds: number;
  readonly wallMilliseconds: number;
  readonly processCount: 1;
}

export interface PlannerTranscriptIdentityV1 {
  readonly protocol: PositiveUInt32V1;
  readonly bounds: PlannerWireBoundsV1;
  readonly requestHash: LowerHexSha256;
  readonly inputBlobsHash: LowerHexSha256;
  readonly resultHash: LowerHexSha256;
  readonly outputBlobsHash: LowerHexSha256;
}

/** The transcript identity with every request/result/blob hash removed. */
export interface PlannerPublicSummaryV1 {
  readonly protocol: PositiveUInt32V1;
  readonly bounds: PlannerWireBoundsV1;
}

/** A rollback payload as a preview may show it: no inventory, inverse, or binding hash. */
export interface RollbackPayloadPreviewV1 {
  readonly payloadId: RollbackPayloadIdV1;
  readonly entryCount: number;
  readonly aggregateBytes: number;
}

export interface RollbackPayloadEntryV1 {
  readonly ordinal: number;
  readonly path: RollbackPayloadRelativePathV1;
  readonly role: "owner_preimage" | "migration_preimage" | "external_effect_preimage" | "inverse_plan_leaf";
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
}

export interface UpdateDownloadPreviewV1 {
  readonly archiveBytes: UInt64DecimalV1;
  readonly archiveSha256: LowerHexSha256;
  readonly expandedBytes: UInt64DecimalV1;
  readonly entryCount: number;
}

export interface UpdatePlanPreviewV1 {
  readonly schemaVersion: 1;
  readonly previewHash: LowerHexSha256;
  readonly operation: "update";
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly download: UpdateDownloadPreviewV1;
  readonly owners: readonly OwnerUpdatePreviewV1[];
  readonly migrations: readonly SchemaMigrationPreviewV1[];
  readonly planner: PlannerPublicSummaryV1;
  readonly retainedRollback: {
    readonly release: ReleaseIdentityV1;
    readonly payload: RollbackPayloadPreviewV1;
  } | null;
  readonly capacity: UpdateCapacityProjectionV1;
}

export interface UpdateRollbackPreviewV1 {
  readonly schemaVersion: 1;
  readonly previewHash: LowerHexSha256;
  readonly operation: "rollback";
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly owners: readonly OwnerUpdatePreviewV1[];
  readonly migrations: readonly SchemaMigrationPreviewV1[];
  readonly payload: RollbackPayloadPreviewV1;
  readonly consumesRollbackRecord: true;
}

export interface PreparedOutputBlobIdentityV1 {
  readonly ordinal: number;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
}

export interface PreparedInverseProjectionV1 {
  readonly kind: "owner_inverse" | "schema_migration_inverse";
  readonly id: SafeReasonCodeV1 | SchemaMigrationIdV1;
  readonly projection: CanonicalJsonV1;
  readonly projectionHash: LowerHexSha256;
  readonly bytes: number;
}

export interface PreparedUpdateMaterializationV1 {
  readonly targetDraftHash: LowerHexSha256;
  readonly concreteManifestHash: LowerHexSha256;
  readonly outputBlobs: readonly PreparedOutputBlobIdentityV1[];
  readonly inversePlanProjections: readonly PreparedInverseProjectionV1[];
  readonly rollbackInventoryEntries: readonly RollbackPayloadEntryV1[];
  readonly inversePlanProjection: CanonicalJsonV1;
  readonly inversePlanProjectionHash: LowerHexSha256;
  readonly inventoryEntriesHash: LowerHexSha256;
  readonly aggregateBytes: number;
  readonly maximumCanonicalBytes: number;
}

/** In-memory only for one apply invocation; public output serializes `preview` alone. */
export interface PreparedUpdateCandidateV1 {
  readonly schemaVersion: 1;
  readonly preview: UpdatePlanPreviewV1;
  readonly transcriptIdentity: PlannerTranscriptIdentityV1;
  readonly materialization: PreparedUpdateMaterializationV1;
}

/** One owner's provider output. Counts are derived from the paths, never accepted. */
export interface OwnerUpdatePreviewInputV1 {
  readonly owner: ArtifactOwner;
  /** The owner's complete current-plus-created path set; the four path arrays must partition it. */
  readonly partition: readonly CanonicalAbsolutePathV1[];
  readonly paths: OwnerPreviewPathsV1;
  readonly externalEffects: 0 | 1;
}

export interface UpdatePreviewInputV1 {
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly download: UpdateDownloadPreviewV1;
  readonly owners: readonly OwnerUpdatePreviewInputV1[];
  readonly migrations: readonly SchemaMigrationPreviewV1[];
  readonly planner: PlannerTranscriptIdentityV1;
  readonly retainedRollback: UpdatePlanPreviewV1["retainedRollback"];
  readonly capacity: UpdateCapacityInputV1;
}

export interface RollbackPreviewInputV1 {
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly owners: readonly OwnerUpdatePreviewInputV1[];
  readonly migrations: readonly SchemaMigrationPreviewV1[];
  readonly payload: RollbackPayloadPreviewV1;
  /** Checked so an insufficient inverse capacity refuses; the rollback preview carries no projection. */
  readonly capacity: UpdateCapacityInputV1;
}

export interface PreparedInverseLeafInputV1 {
  readonly kind: PreparedInverseProjectionV1["kind"];
  readonly id: PreparedInverseProjectionV1["id"];
  /** The retained plan with `coordinatorId`, allocated IDs, `rollbackBindingHash`, and source/containing plan hashes already omitted. */
  readonly projection: CanonicalJsonValue;
}

export interface PreparedUpdateMaterializationInputV1 {
  readonly targetDraft: CanonicalJsonValue;
  readonly concreteManifest: CanonicalJsonValue;
  readonly outputBlobs: readonly PreparedOutputBlobIdentityV1[];
  readonly inverseLeaves: readonly PreparedInverseLeafInputV1[];
  readonly inversePlan: CanonicalJsonValue;
  readonly rollbackInventoryEntries: readonly RollbackPayloadEntryV1[];
}

const OWNER_ORDER: readonly ArtifactOwner[] = ["core", "claude", "codex", "macos"];
const MIGRATION_DOMAIN_ORDER: readonly SchemaMigrationPreviewV1["domain"][] = ["brain", "product_state"];
const INVERSE_KIND_ORDER: readonly PreparedInverseProjectionV1["kind"][] = ["owner_inverse", "schema_migration_inverse"];
const PATH_CLASSES = ["create", "replace", "remove", "unchanged"] as const;
const ROLLBACK_ENTRY_ROLES: readonly RollbackPayloadEntryV1["role"][] = ["owner_preimage", "migration_preimage", "external_effect_preimage", "inverse_plan_leaf"];

const MAX_BLOB_BYTES = 16_777_216;
const MAX_BLOB_COUNT = 1_000_000;
const MAX_BLOB_AGGREGATE_BYTES = 1_073_741_824;
const MAX_ROLLBACK_AGGREGATE_BYTES = 2_147_483_648;
const MAX_CANONICAL_BYTES = 536_870_912;
const MAX_ARCHIVE_BYTES = 2n * 1024n ** 3n;
const MAX_EXPANDED_BYTES = 8n * 1024n ** 3n;

const PREVIEW_DOMAIN = "developer-os/update-preview/v1";
const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function canonicalBytes(value: CanonicalJsonValue): number {
  return encoder.encode(encodeCanonicalJson(value)).byteLength;
}

/** Spec 2 §7.2's prepared-* and planner hashes: the domain, NUL, then the no-LF canonical bytes. */
function hashNoLineFeed(domain: string, value: CanonicalJsonValue): LowerHexSha256 {
  return createHash("sha256")
    .update(`${domain}\0`, "ascii")
    .update(encodeCanonicalJson(value).slice(0, -1), "utf8")
    .digest("hex") as LowerHexSha256;
}

function sortedUnique<T extends string>(values: readonly T[], label: string): T[] {
  const sorted = [...values].sort(compareUtf8);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) fail(`${label}: duplicate`);
  }
  return sorted;
}

function buildOwnerPreview(input: OwnerUpdatePreviewInputV1): OwnerUpdatePreviewV1 {
  if (!OWNER_ORDER.includes(input.owner)) fail("OwnerUpdatePreviewV1.owner");
  if (!([0, 1] as const).includes(input.externalEffects)) fail("OwnerUpdatePreviewV1.externalEffects");
  const partition = new Set(sortedUnique(input.partition.map(parseCanonicalAbsolutePathText), "OwnerUpdatePreviewV1.partition"));
  const seen = new Set<string>();
  const paths = {} as Record<(typeof PATH_CLASSES)[number], CanonicalAbsolutePathV1[]>;
  for (const pathClass of PATH_CLASSES) {
    const sorted = sortedUnique(input.paths[pathClass].map(parseCanonicalAbsolutePathText), `OwnerUpdatePreviewV1.paths.${pathClass}`);
    if (sorted.length > 1_000_000) fail(`OwnerUpdatePreviewV1.paths.${pathClass}: count`);
    for (const path of sorted) {
      if (seen.has(path)) fail("OwnerUpdatePreviewV1.paths: not disjoint");
      if (!partition.has(path)) fail("OwnerUpdatePreviewV1.paths: outside the owner partition");
      seen.add(path);
    }
    paths[pathClass] = sorted;
  }
  if (seen.size !== partition.size) fail("OwnerUpdatePreviewV1.paths: partition not covered");
  return {
    owner: input.owner,
    counts: {
      create: paths.create.length,
      replace: paths.replace.length,
      remove: paths.remove.length,
      unchanged: paths.unchanged.length,
      externalEffects: input.externalEffects,
    },
    paths,
  };
}

function buildOwnerPreviews(owners: readonly OwnerUpdatePreviewInputV1[]): OwnerUpdatePreviewV1[] {
  if (owners.length < 1 || owners.length > 16) fail("OwnerUpdatePreviewV1[]: count");
  const built = owners.map(buildOwnerPreview).sort((left, right) => OWNER_ORDER.indexOf(left.owner) - OWNER_ORDER.indexOf(right.owner));
  for (let index = 1; index < built.length; index += 1) {
    if (built[index - 1]?.owner === built[index]?.owner) fail("OwnerUpdatePreviewV1[]: duplicate owner");
  }
  return built;
}

function buildMigrationPreview(input: SchemaMigrationPreviewV1): SchemaMigrationPreviewV1 {
  if (!MIGRATION_DOMAIN_ORDER.includes(input.domain)) fail("SchemaMigrationPreviewV1.domain");
  const fromVersion = parsePositiveUInt32(input.fromVersion);
  const toVersion = parsePositiveUInt32(input.toVersion);
  if (fromVersion >= toVersion) fail("SchemaMigrationPreviewV1: version order");
  if (input.affectedPaths.length < 1 || input.affectedPaths.length > 100_000) fail("SchemaMigrationPreviewV1.affectedPaths: count");
  // Brain paths are vault-relative and product-state paths absolute, so one can never pass as the other.
  const parse = input.domain === "brain" ? parseVaultRelativePathText : parseCanonicalAbsolutePathText;
  const affectedPaths = sortedUnique(
    input.affectedPaths.map((path) => parse(path) as VaultRelativePathV1 | CanonicalProductStatePathV1),
    "SchemaMigrationPreviewV1.affectedPaths",
  );
  return { id: parseSchemaMigrationId(input.id), domain: input.domain, fromVersion, toVersion, affectedPaths };
}

/**
 * Canonical order is domain, then ascending chain position, for update and rollback alike; the
 * reverse order rollback executes in belongs to its execution plan, not its preview.
 */
function buildMigrationPreviews(migrations: readonly SchemaMigrationPreviewV1[]): SchemaMigrationPreviewV1[] {
  if (migrations.length > 10_000) fail("SchemaMigrationPreviewV1[]: count");
  const built = migrations.map(buildMigrationPreview).sort((left, right) =>
    MIGRATION_DOMAIN_ORDER.indexOf(left.domain) - MIGRATION_DOMAIN_ORDER.indexOf(right.domain) || left.fromVersion - right.fromVersion);
  const ids = new Set<string>();
  for (let index = 0; index < built.length; index += 1) {
    const current = built[index] as SchemaMigrationPreviewV1;
    const prior = built[index - 1];
    if (ids.has(current.id)) fail("SchemaMigrationPreviewV1[]: duplicate id");
    ids.add(current.id);
    if (prior !== undefined && prior.domain === current.domain && prior.toVersion !== current.fromVersion) {
      fail("SchemaMigrationPreviewV1[]: chain is not contiguous");
    }
  }
  return built;
}

export function validatePlannerWireBounds(bounds: PlannerWireBoundsV1): PlannerWireBoundsV1 {
  const wireMaximum = 1_351_177_306;
  return {
    requestJsonBytes: integer(bounds.requestJsonBytes, 1, 268_435_456, "PlannerWireBoundsV1.requestJsonBytes"),
    resultJsonBytes: integer(bounds.resultJsonBytes, 1, 268_435_456, "PlannerWireBoundsV1.resultJsonBytes"),
    inputBlobCount: integer(bounds.inputBlobCount, 0, MAX_BLOB_COUNT, "PlannerWireBoundsV1.inputBlobCount"),
    outputBlobCount: integer(bounds.outputBlobCount, 0, MAX_BLOB_COUNT, "PlannerWireBoundsV1.outputBlobCount"),
    inputBlobBytes: integer(bounds.inputBlobBytes, 0, MAX_BLOB_AGGREGATE_BYTES, "PlannerWireBoundsV1.inputBlobBytes"),
    outputBlobBytes: integer(bounds.outputBlobBytes, 0, MAX_BLOB_AGGREGATE_BYTES, "PlannerWireBoundsV1.outputBlobBytes"),
    stdinWireBytes: integer(bounds.stdinWireBytes, 27, wireMaximum, "PlannerWireBoundsV1.stdinWireBytes"),
    stdoutWireBytes: integer(bounds.stdoutWireBytes, 27, wireMaximum, "PlannerWireBoundsV1.stdoutWireBytes"),
    stderrBytes: integer(bounds.stderrBytes, 0, 1_048_576, "PlannerWireBoundsV1.stderrBytes"),
    residentBytes: integer(bounds.residentBytes, 1, 536_870_912, "PlannerWireBoundsV1.residentBytes"),
    idleMilliseconds: integer(bounds.idleMilliseconds, 1, 30_000, "PlannerWireBoundsV1.idleMilliseconds"),
    wallMilliseconds: integer(bounds.wallMilliseconds, 1, 600_000, "PlannerWireBoundsV1.wallMilliseconds"),
    processCount: integer(bounds.processCount, 1, 1, "PlannerWireBoundsV1.processCount") as 1,
  };
}

export function parseRollbackPayloadId(value: unknown): RollbackPayloadIdV1 {
  return parseAllocatedLifecycleId("rb", value, null);
}

function validateRollbackPayloadPreview(payload: RollbackPayloadPreviewV1): RollbackPayloadPreviewV1 {
  return {
    payloadId: parseRollbackPayloadId(payload.payloadId),
    entryCount: integer(payload.entryCount, 0, 1_000_000, "RollbackPayloadPreviewV1.entryCount"),
    aggregateBytes: integer(payload.aggregateBytes, 0, MAX_ROLLBACK_AGGREGATE_BYTES, "RollbackPayloadPreviewV1.aggregateBytes"),
  };
}

function requireDistinctReleases(current: ReleaseIdentityV1, target: ReleaseIdentityV1): void {
  if (current.releaseIdentityHash === target.releaseIdentityHash) fail("preview: current and target are the same release");
  if (current.architecture !== target.architecture) fail("preview: architecture changes");
}

/**
 * SHA-256 over `developer-os/update-preview/v1\0` and the canonical preview with its own
 * `previewHash` member omitted, so the digest never covers itself.
 */
export function previewHash(
  preview: Omit<UpdatePlanPreviewV1, "previewHash"> | Omit<UpdateRollbackPreviewV1, "previewHash"> | UpdatePlanPreviewV1 | UpdateRollbackPreviewV1,
): LowerHexSha256 {
  const unhashed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(preview)) if (key !== "previewHash") unhashed[key] = value;
  return hashCanonicalJson(PREVIEW_DOMAIN, unhashed as CanonicalJsonValue);
}

export function buildUpdatePreview(input: UpdatePreviewInputV1): UpdatePlanPreviewV1 {
  requireDistinctReleases(input.current, input.target);
  if (input.capacity.operation !== "update") fail("UpdatePlanPreviewV1.capacity: operation");
  const archiveBytes = parseUInt64Decimal(input.download.archiveBytes);
  const expandedBytes = parseUInt64Decimal(input.download.expandedBytes);
  if (BigInt(archiveBytes) > MAX_ARCHIVE_BYTES || BigInt(expandedBytes) > MAX_EXPANDED_BYTES) fail("UpdatePlanPreviewV1.download: bytes");
  const unhashed: Omit<UpdatePlanPreviewV1, "previewHash"> = {
    schemaVersion: 1,
    operation: "update",
    current: input.current,
    target: input.target,
    metadata: input.metadata,
    download: {
      archiveBytes,
      archiveSha256: parseLowerHexSha256(input.download.archiveSha256),
      expandedBytes,
      entryCount: integer(input.download.entryCount, 1, 200_000, "UpdatePlanPreviewV1.download.entryCount"),
    },
    owners: buildOwnerPreviews(input.owners),
    migrations: buildMigrationPreviews(input.migrations),
    planner: { protocol: parsePositiveUInt32(input.planner.protocol), bounds: validatePlannerWireBounds(input.planner.bounds) },
    retainedRollback: input.retainedRollback === null
      ? null
      : { release: input.retainedRollback.release, payload: validateRollbackPayloadPreview(input.retainedRollback.payload) },
    // Last, so an insufficient byte or entry total refuses before any preview exists.
    capacity: projectUpdateCapacity(input.capacity),
  };
  return { ...unhashed, previewHash: previewHash(unhashed) };
}

export function buildRollbackPreview(input: RollbackPreviewInputV1): UpdateRollbackPreviewV1 {
  requireDistinctReleases(input.current, input.target);
  if (input.capacity.operation !== "rollback") fail("UpdateRollbackPreviewV1.capacity: operation");
  const unhashed: Omit<UpdateRollbackPreviewV1, "previewHash"> = {
    schemaVersion: 1,
    operation: "rollback",
    current: input.current,
    target: input.target,
    owners: buildOwnerPreviews(input.owners),
    migrations: buildMigrationPreviews(input.migrations),
    payload: validateRollbackPayloadPreview(input.payload),
    consumesRollbackRecord: true,
  };
  projectUpdateCapacity(input.capacity);
  return { ...unhashed, previewHash: previewHash(unhashed) };
}

function assertNoRetainedOnlyKeys(value: CanonicalJsonValue, label: string): void {
  if (Array.isArray(value)) {
    for (const item of value as readonly CanonicalJsonValue[]) assertNoRetainedOnlyKeys(item, label);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "coordinatorId" || key === "rollbackBindingHash") fail(`${label}: carries an allocation-bound field`);
      assertNoRetainedOnlyKeys(item, label);
    }
  }
}

function inverseLeafPath(kind: PreparedInverseProjectionV1["kind"], id: string): string {
  return `plans/${kind}/${id}.plan.json`;
}

/**
 * Recomputes every count, bound, and hash of the private prepared materialization. It is
 * never persisted, so the first over-bound value refuses rather than truncating.
 */
export function buildPreparedUpdateMaterialization(input: PreparedUpdateMaterializationInputV1): PreparedUpdateMaterializationV1 {
  if (input.outputBlobs.length > MAX_BLOB_COUNT) fail("PreparedUpdateMaterializationV1.outputBlobs: count");
  let outputBytes = 0;
  const outputBlobs = input.outputBlobs.map((blob, index) => {
    if (blob.ordinal !== index) fail("PreparedOutputBlobIdentityV1.ordinal: not contiguous");
    const bytes = integer(blob.bytes, 0, MAX_BLOB_BYTES, "PreparedOutputBlobIdentityV1.bytes");
    outputBytes += bytes;
    if (outputBytes > MAX_BLOB_AGGREGATE_BYTES) fail("PreparedUpdateMaterializationV1.outputBlobs: aggregate bytes");
    return { ordinal: index, bytes, sha256: parseLowerHexSha256(blob.sha256) };
  });

  if (input.inverseLeaves.length < 1 || input.inverseLeaves.length > 10_016) fail("PreparedUpdateMaterializationV1.inversePlanProjections: count");
  let maximumCanonicalBytes = Math.max(canonicalBytes(input.targetDraft), canonicalBytes(input.concreteManifest), canonicalBytes(input.inversePlan));
  /**
   * A leaf's position within its kind: an owner's in OWNER_ORDER (OWNER_UPDATE_ORDER), a migration's
   * chain position (domain in SCHEMA_MIGRATION_DOMAIN_ORDER, then fromVersion), read once from its projection.
   */
  const ranks = new Map<string, readonly [number, number]>();
  const inversePlanProjections = input.inverseLeaves
    .map((leaf): PreparedInverseProjectionV1 => {
      if (!INVERSE_KIND_ORDER.includes(leaf.kind)) fail("PreparedInverseProjectionV1.kind");
      const id = leaf.kind === "owner_inverse" ? parseSafeReasonCode(leaf.id) : parseSchemaMigrationId(leaf.id);
      assertNoRetainedOnlyKeys(leaf.projection, "PreparedInverseProjectionV1.projection");
      const projection = encodeCanonicalJson(leaf.projection);
      const bytes = integer(encoder.encode(projection).byteLength, 1, MAX_BLOB_BYTES, "PreparedInverseProjectionV1.bytes");
      maximumCanonicalBytes = Math.max(maximumCanonicalBytes, bytes);
      const fields = leaf.projection as { readonly owner?: unknown; readonly domain?: unknown; readonly fromVersion?: unknown } | null;
      // The order key is part of the projection; a leaf without one is refused, never ranked by a default.
      const rank = leaf.kind === "owner_inverse" ? OWNER_ORDER.indexOf(fields?.owner as ArtifactOwner) : SCHEMA_MIGRATION_DOMAIN_ORDER.indexOf(fields?.domain as SchemaMigrationDomainV1);
      const step = leaf.kind === "owner_inverse" ? 0 : fields?.fromVersion;
      if (rank < 0 || typeof step !== "number") fail("PreparedInverseProjectionV1.projection: no order key");
      ranks.set(`${leaf.kind}/${id}`, [rank, step]);
      return { kind: leaf.kind, id, projection, projectionHash: hashNoLineFeed("developer-os/prepared-inverse-leaf/v1", leaf.projection), bytes };
    })
    /**
     * Owner leaves in canonical owner order and migrations in chain order — the order the planner
     * emits them, their inventory rows follow, `buildRollbackPayload` requires for owners, and
     * compose's `#rollbackSourceEntries` pairs by position. Sorting by ID put `owner_claude`/`owner_codex`
     * before `owner_core` and refused every multi-owner update; for migrations it refused any chain
     * whose IDs sort against it at construction validation (NEW-135).
     */
    .sort((left, right) => {
      const [leftRank, leftStep] = ranks.get(`${left.kind}/${left.id}`) as readonly [number, number];
      const [rightRank, rightStep] = ranks.get(`${right.kind}/${right.id}`) as readonly [number, number];
      return INVERSE_KIND_ORDER.indexOf(left.kind) - INVERSE_KIND_ORDER.indexOf(right.kind) || leftRank - rightRank || leftStep - rightStep || compareUtf8(left.id, right.id);
    });
  for (let index = 1; index < inversePlanProjections.length; index += 1) {
    const prior = inversePlanProjections[index - 1] as PreparedInverseProjectionV1;
    const current = inversePlanProjections[index] as PreparedInverseProjectionV1;
    if (prior.kind === current.kind && prior.id === current.id) fail("PreparedInverseProjectionV1: duplicate id");
  }
  assertNoRetainedOnlyKeys(input.inversePlan, "PreparedUpdateMaterializationV1.inversePlanProjection");

  const entries = input.rollbackInventoryEntries;
  if (entries.length < 1 || entries.length > 1_000_000) fail("PreparedUpdateMaterializationV1.rollbackInventoryEntries: count");
  const leafPaths = new Set(inversePlanProjections.map((leaf) => inverseLeafPath(leaf.kind, leaf.id)));
  const retainedLeafPaths = new Set<string>();
  let aggregateBytes = 0;
  const rollbackInventoryEntries = entries.map((entry, index): RollbackPayloadEntryV1 => {
    if (entry.ordinal !== index) fail("RollbackPayloadEntryV1.ordinal: not contiguous");
    if (!ROLLBACK_ENTRY_ROLES.includes(entry.role)) fail("RollbackPayloadEntryV1.role");
    if (entry.role === "inverse_plan_leaf") {
      if (!leafPaths.has(entry.path) || retainedLeafPaths.has(entry.path)) fail("RollbackPayloadEntryV1.path: not a prepared inverse leaf");
      retainedLeafPaths.add(entry.path);
    } else if (entry.path !== `blobs/${encodeTenDigitOrdinal(index)}.bin`) {
      fail("RollbackPayloadEntryV1.path: not derived from its ordinal");
    }
    const bytes = integer(entry.bytes, 0, MAX_BLOB_BYTES, "RollbackPayloadEntryV1.bytes");
    aggregateBytes += bytes;
    if (aggregateBytes > MAX_ROLLBACK_AGGREGATE_BYTES) fail("PreparedUpdateMaterializationV1.aggregateBytes");
    return { ordinal: index, path: entry.path, role: entry.role, bytes, sha256: parseLowerHexSha256(entry.sha256) };
  });
  if (retainedLeafPaths.size !== leafPaths.size) fail("PreparedUpdateMaterializationV1: inverse leaves and inventory are not bijective");

  const inversePlanProjection = encodeCanonicalJson(input.inversePlan);
  integer(maximumCanonicalBytes, 1, MAX_CANONICAL_BYTES, "PreparedUpdateMaterializationV1.maximumCanonicalBytes");
  return {
    targetDraftHash: hashNoLineFeed("developer-os/prepared-target-draft/v1", input.targetDraft),
    concreteManifestHash: hashNoLineFeed("developer-os/prepared-concrete-manifest/v1", input.concreteManifest),
    outputBlobs,
    inversePlanProjections,
    rollbackInventoryEntries,
    inversePlanProjection,
    inversePlanProjectionHash: hashNoLineFeed("developer-os/prepared-update-inverse/v1", input.inversePlan),
    inventoryEntriesHash: hashNoLineFeed(
      "developer-os/prepared-rollback-inventory-entries/v1",
      rollbackInventoryEntries as unknown as CanonicalJsonValue,
    ),
    aggregateBytes,
    maximumCanonicalBytes,
  };
}

/**
 * Binds the public preview to the private transcript and materialization of the same planner
 * run. The preview must be self-consistent and name exactly the transcript's protocol and bounds.
 */
export function buildPreparedUpdateCandidate(input: {
  readonly preview: UpdatePlanPreviewV1;
  readonly transcriptIdentity: PlannerTranscriptIdentityV1;
  readonly materialization: PreparedUpdateMaterializationV1;
}): PreparedUpdateCandidateV1 {
  const { preview, transcriptIdentity, materialization } = input;
  if (previewHash(preview) !== preview.previewHash) fail("PreparedUpdateCandidateV1.preview");
  const transcript: PlannerTranscriptIdentityV1 = {
    protocol: parsePositiveUInt32(transcriptIdentity.protocol),
    bounds: validatePlannerWireBounds(transcriptIdentity.bounds),
    requestHash: parseLowerHexSha256(transcriptIdentity.requestHash),
    inputBlobsHash: parseLowerHexSha256(transcriptIdentity.inputBlobsHash),
    resultHash: parseLowerHexSha256(transcriptIdentity.resultHash),
    outputBlobsHash: parseLowerHexSha256(transcriptIdentity.outputBlobsHash),
  };
  const summary: PlannerPublicSummaryV1 = { protocol: transcript.protocol, bounds: transcript.bounds };
  if (encodeCanonicalJson(summary as unknown as CanonicalJsonValue) !== encodeCanonicalJson(preview.planner as unknown as CanonicalJsonValue)) {
    fail("PreparedUpdateCandidateV1: preview planner summary differs from the transcript");
  }
  if (materialization.outputBlobs.length > transcript.bounds.outputBlobCount) fail("PreparedUpdateCandidateV1: output blob count exceeds bounds");
  return { schemaVersion: 1, preview, transcriptIdentity: transcript, materialization };
}
