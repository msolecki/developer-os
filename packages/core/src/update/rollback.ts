import { compareUtf8, decodeCanonicalJson, hashCanonicalJsonNoLf, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { ArtifactOwner } from "../manifest/types.js";
import {
  advanceEntry,
  cachedPlanHash,
  canonical,
  checkDirectoryIdentities,
  checkEntryState,
  checkPlanBounds,
  checkStructureState,
  checkTimestamps,
  coordinatorOf,
  decodeIdentity,
  durableEntryEvidenceBytes,
  entryTop,
  withdrawEntryIntent,
  exact,
  fail,
  identity,
  integer,
  list,
  MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES,
  MAXIMUM_SOURCE_READY_EVIDENCE_BYTES,
  nextEntryCompensation,
  nullableInteger,
  oneOf,
  record,
  sha256Hex,
  structureTop,
  updateSourceStructuresHash,
  type DurablePublicationEntryEvidenceV1,
  type DurableSourceEntryEvidenceV1,
  type Identity,
  type UpdateDirectoryIdentityV1,
  type UpdateDirectoryRoleV1,
  type UpdateEntryStepV1,
  type UpdateEntryWriteStateV1,
  type UpdatePublicationMetadataWriteStateV1,
  type UpdatePublishedMetadataIdentityV1,
  type UpdateSourceReadyIdentityV1,
  type UpdateSourceReadyWriteStateV1,
  type UpdateStructureWriteStateV1,
} from "./bundle-participant.js";
import { MAXIMUM_LEAF_PLAN_BYTES, updateLeafPlanPath, type ImmutableUpdatePlanRefV1 } from "./construction.js";
import { MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES, SCHEMA_MIGRATION_DOMAIN_ORDER, type RetainedInverseBlobRefV1, type RetainedSchemaMigrationInversePlanV1 } from "./migrations.js";
import { OWNER_UPDATE_ORDER } from "./owner.js";
import { ownerExternalEffectProcessPolicyHash, ownerInverseOperationHash, type OwnerExternalEffectProcessPolicyV1 } from "./participants.js";
import {
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type RollbackPayloadRelativePathV1,
} from "./paths.js";
import { parseRollbackPayloadId, type PreparedUpdateCandidateV1, type RollbackPayloadEntryV1, type RollbackPayloadIdV1 } from "./preview.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import {
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type SafeReasonCodeV1,
  type SchemaMigrationIdV1,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "./scalars.js";

// ---------------------------------------------------------------------------------------------
// Spec 2 §10.1 retained record, payload identity, and inventory
// ---------------------------------------------------------------------------------------------

export interface RollbackRecordV1 {
  readonly schemaVersion: 1;
  readonly installed: ReleaseIdentityV1;
  readonly previous: ReleaseIdentityV1;
  readonly executionBindingHash: LowerHexSha256;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly payloadInventoryHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly createdAt: UtcTimestampV1;
}

export interface RollbackPayloadIdentityV1 {
  readonly payloadId: RollbackPayloadIdV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entryCount: number;
  readonly aggregateBytes: number;
}

export interface RollbackPayloadInventoryV1 {
  readonly schemaVersion: 1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly entries: readonly RollbackPayloadEntryV1[];
  readonly aggregateBytes: number;
}

// ---------------------------------------------------------------------------------------------
// Retained inverse plans (Spec 2 §9.2)
// ---------------------------------------------------------------------------------------------

export interface RetainedInverseContentRefV1 {
  readonly chunks: readonly RetainedInverseBlobRefV1[];
  readonly aggregateBytes: number;
  readonly sha256: LowerHexSha256;
}

export type RetainedInversePathStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "directory"; readonly mode: 448 }
  | { readonly state: "file"; readonly mode: 384 | 448; readonly bytes: number; readonly sha256: LowerHexSha256; readonly payload: RetainedInverseContentRefV1 | null };

export interface RetainedOwnerInverseOperationV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly expectedCurrent: RetainedInversePathStateV1;
  readonly restore: RetainedInversePathStateV1;
}

export interface RetainedExternalEffectInversePlanV1 {
  readonly kind: "codex_registration_refresh";
  readonly providerProtocol: PositiveUInt32V1;
  readonly expectedCurrentStateHash: LowerHexSha256;
  readonly restoreStateHash: LowerHexSha256;
  readonly restorePayloads: readonly RetainedInverseBlobRefV1[];
  readonly processPolicy: OwnerExternalEffectProcessPolicyV1;
  readonly processPolicyHash: LowerHexSha256;
}

export interface RetainedOwnerInversePlanV1 {
  readonly schemaVersion: 1;
  readonly kind: "owner_inverse";
  readonly id: SafeReasonCodeV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly owner: ArtifactOwner;
  readonly sourceOwnerPlanHash: LowerHexSha256;
  readonly operations: readonly RetainedOwnerInverseOperationV1[];
  readonly externalEffects: readonly RetainedExternalEffectInversePlanV1[];
  readonly maximumPlanBytes: number;
}

/**
 * The retained leaf file itself. Construction binds every `inverse_plan_leaf` inventory row
 * byte-for-byte to the allocation-free prepared projection, so the file cannot carry the
 * allocation-bound fields; `RetainedInversePlanRefV1` binds them and `retainedHash` covers both.
 */
export type RetainedOwnerInverseProjectionV1 = Omit<RetainedOwnerInversePlanV1, "rollbackBindingHash" | "sourceOwnerPlanHash">;
export type RetainedSchemaMigrationInverseProjectionV1 = Omit<RetainedSchemaMigrationInversePlanV1, "rollbackBindingHash" | "sourceMigrationPlanHash">;

export type RetainedInverseKindV1 = "owner_inverse" | "schema_migration_inverse";

export interface RetainedInversePlanRefV1<TKind extends RetainedInverseKindV1 = RetainedInverseKindV1> {
  readonly kind: TKind;
  readonly id: TKind extends "schema_migration_inverse" ? SchemaMigrationIdV1 : SafeReasonCodeV1;
  readonly path: RollbackPayloadRelativePathV1;
  readonly sourcePlanHash: LowerHexSha256;
  readonly retainedHash: LowerHexSha256;
  readonly bytes: number;
}

export interface BoundedUpdateInversePlanV1 {
  readonly schemaVersion: 1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly installedReleaseIdentityHash: LowerHexSha256;
  readonly previousReleaseIdentityHash: LowerHexSha256;
  readonly ownerPlans: readonly RetainedInversePlanRefV1<"owner_inverse">[];
  readonly migrationPlans: readonly RetainedInversePlanRefV1<"schema_migration_inverse">[];
  readonly exactStepListHash: LowerHexSha256;
  readonly maximumBytes: number;
}

export interface RetainedInverseLeafFileV1 {
  readonly ref: RetainedInversePlanRefV1;
  /** The exact retained file bytes: the prepared projection, canonical JSON plus LF. */
  readonly bytes: Uint8Array;
}

export interface RollbackAllocationV1 {
  readonly payloadId: RollbackPayloadIdV1;
  readonly executionBindingHash: LowerHexSha256;
  /** The release the update installs; the record's `installed`. */
  readonly installed: ReleaseIdentityV1;
  /** The release a later rollback returns to; the record's `previous`. */
  readonly previous: ReleaseIdentityV1;
  readonly productHome: CanonicalAbsolutePathV1;
  /** The immutable forward leaf hash each prepared inverse projection inverts, in projection order. */
  readonly sourcePlanHashes: readonly LowerHexSha256[];
  readonly exactStepListHash: LowerHexSha256;
  readonly createdAt: UtcTimestampV1;
}

export interface PreparedRollbackPayloadV1 {
  readonly identity: RollbackPayloadIdentityV1;
  readonly record: RollbackRecordV1;
  readonly recordBytes: Uint8Array;
  readonly inversePlan: BoundedUpdateInversePlanV1;
  readonly inversePlanBytes: Uint8Array;
  readonly inventory: RollbackPayloadInventoryV1;
  readonly inventoryBytes: Uint8Array;
  readonly leaves: readonly RetainedInverseLeafFileV1[];
}

export const MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES = 1_000_000;
export const MAXIMUM_ROLLBACK_PAYLOAD_AGGREGATE_BYTES = 2_147_483_648;
/** The record, inverse plan, and inventory are each canonical and at most 64 MiB. */
export const MAXIMUM_ROLLBACK_DOCUMENT_BYTES = 67_108_864;
export const MAXIMUM_ROLLBACK_BLOB_BYTES = 16_777_216;
export const ROLLBACK_INVERSE_PLAN_NAME = "inverse-plan.json";
export const ROLLBACK_INVENTORY_NAME = "inventory.json";

const MAX_OWNER_PLANS = 16;
const MAX_MIGRATION_PLANS = 10_000;
const MAX_OWNER_OPERATIONS = 1_000_000;
const MAX_MIGRATION_MUTATIONS = 100_000;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LowerHexSha256;
const BLOB_PATH = /^blobs\/[0-9]{10}\.bin$/u;
const LEAF_PATH = /^plans\/(owner_inverse|schema_migration_inverse)\/([^/]+)\.plan\.json$/u;
const ENTRY_ROLES: readonly RollbackPayloadEntryV1["role"][] = ["owner_preimage", "migration_preimage", "external_effect_preimage", "inverse_plan_leaf"];
const RECORD_KEYS = ["schemaVersion", "installed", "previous", "executionBindingHash", "rollbackBindingHash", "payloadId", "payloadInventoryHash", "inversePlanHash", "createdAt"];
const IDENTITY_KEYS = ["payloadId", "root", "rollbackBindingHash", "inversePlanHash", "inventoryHash", "entryCount", "aggregateBytes"];
const INVENTORY_KEYS = ["schemaVersion", "payloadId", "rollbackBindingHash", "inversePlanHash", "entries", "aggregateBytes"];
const INVERSE_PLAN_KEYS = ["schemaVersion", "rollbackBindingHash", "payloadId", "installedReleaseIdentityHash", "previousReleaseIdentityHash", "ownerPlans", "migrationPlans", "exactStepListHash", "maximumBytes"];
const OWNER_PROJECTION_KEYS = ["schemaVersion", "kind", "id", "owner", "operations", "externalEffects", "maximumPlanBytes"];
const MIGRATION_PROJECTION_KEYS = ["schemaVersion", "kind", "id", "domain", "fromVersion", "toVersion", "mutations", "maximumPlanBytes"];
const encoder = new TextEncoder();

function bytesOf(value: unknown): Uint8Array {
  return encoder.encode(canonical(value));
}

function hash(value: unknown, label: string): LowerHexSha256 {
  try {
    return parseLowerHexSha256(value);
  } catch (error) {
    throw new Error(`invalid ${label}`, { cause: error });
  }
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/** `<product-home>/rollback/<payload-id>`. */
export function rollbackPayloadRoot(productHome: CanonicalAbsolutePathV1, payloadId: RollbackPayloadIdV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${productHome}/rollback/${parseRollbackPayloadId(payloadId)}`);
}

/** `plans/<kind>/<id>.plan.json` beneath the payload root. */
export function retainedInversePlanPath(kind: RetainedInverseKindV1, id: string): RollbackPayloadRelativePathV1 {
  const parsed = kind === "schema_migration_inverse" ? parseSchemaMigrationId(id) : parseSafeReasonCode(id);
  return `plans/${kind}/${parsed}.plan.json` as RollbackPayloadRelativePathV1;
}

export function rollbackPayloadBlobPath(ordinal: number): RollbackPayloadRelativePathV1 {
  return `blobs/${encodeTenDigitOrdinal(ordinal)}.bin` as RollbackPayloadRelativePathV1;
}

/**
 * Spec 2 §9.2: `developer-os/update-rollback-binding/v1\0` plus the canonical execution binding,
 * payload ID, and the installed and previous release-identity hashes. It hashes no containing plan.
 */
export function rollbackBindingHash(input: {
  readonly executionBindingHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly installedReleaseIdentityHash: LowerHexSha256;
  readonly previousReleaseIdentityHash: LowerHexSha256;
}): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/update-rollback-binding/v1", {
    executionBindingHash: hash(input.executionBindingHash, "rollbackBindingHash.executionBindingHash"),
    payloadId: parseRollbackPayloadId(input.payloadId),
    installedReleaseIdentityHash: hash(input.installedReleaseIdentityHash, "rollbackBindingHash.installed"),
    previousReleaseIdentityHash: hash(input.previousReleaseIdentityHash, "rollbackBindingHash.previous"),
  });
}

/** `developer-os/update-rollback-step-list/v1\0` plus the exact §10.2 step template. */
export function rollbackStepListHash(steps: readonly unknown[]): LowerHexSha256 {
  if (steps.length < 1) fail("rollback step list: empty");
  return hashCanonicalJsonNoLf("developer-os/update-rollback-step-list/v1", steps);
}

/** `developer-os/retained-inverse/<kind>/v1\0` over the complete bound retained schema. */
export function retainedInversePlanHash(plan: RetainedOwnerInversePlanV1 | RetainedSchemaMigrationInversePlanV1): LowerHexSha256 {
  return hashCanonicalJsonNoLf(`developer-os/retained-inverse/${plan.kind}/v1`, plan);
}

/** The owner plan's `inverseOperationHash`, recomputed from the retained operations and effects. */
export function retainedOwnerInverseOperationHash(plan: RetainedOwnerInverseProjectionV1): LowerHexSha256 {
  return ownerInverseOperationHash({ owner: plan.owner, operations: plan.operations as unknown as readonly CanonicalJsonValue[], externalEffects: plan.externalEffects as unknown as readonly CanonicalJsonValue[] });
}

/** The raw SHA-256 of the exact persisted document bytes: what the record and inventory bind. */
export function rollbackDocumentHash(bytes: Uint8Array): LowerHexSha256 {
  return sha256Hex(bytes);
}

export function rollbackDocumentBytes(value: RollbackRecordV1 | BoundedUpdateInversePlanV1 | RollbackPayloadInventoryV1): Uint8Array {
  const bytes = bytesOf(value);
  if (bytes.byteLength > MAXIMUM_ROLLBACK_DOCUMENT_BYTES) fail("rollback document: exceeds 64 MiB");
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------------------------

export function validateRollbackRecord(value: unknown, evidence: CanonicalPathEvidenceV1): RollbackRecordV1 {
  const label = "RollbackRecordV1";
  const input = exact(value, RECORD_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const installed = validateReleaseIdentity(input.installed, evidence);
  const previous = validateReleaseIdentity(input.previous, evidence);
  if (installed.architecture !== previous.architecture || installed.releaseIdentityHash === previous.releaseIdentityHash) fail(`${label}: releases`);
  const executionBindingHash = parseLowerHexSha256(input.executionBindingHash);
  const payloadId = parseRollbackPayloadId(input.payloadId);
  const binding = rollbackBindingHash({ executionBindingHash, payloadId, installedReleaseIdentityHash: installed.releaseIdentityHash, previousReleaseIdentityHash: previous.releaseIdentityHash });
  if (parseLowerHexSha256(input.rollbackBindingHash) !== binding) fail(`${label}.rollbackBindingHash: not the binding its fields derive`);
  return {
    schemaVersion: 1,
    installed,
    previous,
    executionBindingHash,
    rollbackBindingHash: binding,
    payloadId,
    payloadInventoryHash: parseLowerHexSha256(input.payloadInventoryHash),
    inversePlanHash: parseLowerHexSha256(input.inversePlanHash),
    createdAt: parseUtcTimestamp(input.createdAt),
  };
}

export function validateRollbackPayloadIdentity(value: unknown, label = "RollbackPayloadIdentityV1"): RollbackPayloadIdentityV1 {
  const input = exact(value, IDENTITY_KEYS, label);
  const payloadId = parseRollbackPayloadId(input.payloadId);
  const root = parseCanonicalAbsolutePathText(input.root);
  if (!root.endsWith(`/rollback/${payloadId}`)) fail(`${label}.root: not the payload-derived root`);
  for (const key of ["rollbackBindingHash", "inversePlanHash", "inventoryHash"]) parseLowerHexSha256(input[key]);
  integer(input.entryCount, 0, MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES, `${label}.entryCount`);
  integer(input.aggregateBytes, 0, MAXIMUM_ROLLBACK_PAYLOAD_AGGREGATE_BYTES, `${label}.aggregateBytes`);
  return input as unknown as RollbackPayloadIdentityV1;
}

function validateBlobRef(value: unknown, label: string): RetainedInverseBlobRefV1 {
  const input = exact(value, ["path", "bytes", "sha256"], label);
  if (typeof input.path !== "string" || !BLOB_PATH.test(input.path)) fail(`${label}.path`);
  integer(input.bytes, 0, MAXIMUM_ROLLBACK_BLOB_BYTES, `${label}.bytes`);
  parseLowerHexSha256(input.sha256);
  return input as unknown as RetainedInverseBlobRefV1;
}

/** One chunk of at most 16 MiB carries the whole file; a zero-byte restore has zero chunks. */
function validateContentRef(value: unknown, bytes: number, sha256: LowerHexSha256, label: string): RetainedInverseContentRefV1 {
  const input = exact(value, ["chunks", "aggregateBytes", "sha256"], label);
  const chunks = list(input.chunks, 0, 1, `${label}.chunks`).map((chunk, index) => validateBlobRef(chunk, `${label}.chunks[${index.toString(10)}]`));
  if (input.aggregateBytes !== bytes || input.sha256 !== sha256) fail(`${label}: not the restored file's bytes and hash`);
  const chunk = chunks[0];
  if (bytes === 0) {
    if (chunk !== undefined || sha256 !== EMPTY_SHA256) fail(`${label}: a zero-byte restore has no chunk and the empty hash`);
  } else if (chunk?.bytes !== bytes || chunk.sha256 !== sha256) {
    fail(`${label}.chunks: do not concatenate to the restored file`);
  }
  return input as unknown as RetainedInverseContentRefV1;
}

function validatePathState(value: unknown, direction: "expectedCurrent" | "restore", label: string): RetainedInversePathStateV1 {
  const input = record(value, label);
  if (input.state === "absent") {
    exact(input, ["state"], label);
  } else if (input.state === "directory") {
    exact(input, ["state", "mode"], label);
    if (input.mode !== 448) fail(`${label}.mode`);
  } else {
    exact(input, ["state", "mode", "bytes", "sha256", "payload"], label);
    if (input.state !== "file") fail(`${label}.state`);
    oneOf(input.mode, [384, 448], `${label}.mode`);
    const bytes = integer(input.bytes, 0, MAXIMUM_ROLLBACK_BLOB_BYTES, `${label}.bytes`);
    const sha256 = parseLowerHexSha256(input.sha256);
    if (direction === "expectedCurrent") {
      if (input.payload !== null) fail(`${label}.payload: an expected-current file carries no payload`);
    } else {
      validateContentRef(input.payload, bytes, sha256, `${label}.payload`);
    }
  }
  return input as unknown as RetainedInversePathStateV1;
}

function validateEffectInverse(value: unknown, label: string): RetainedExternalEffectInversePlanV1 {
  const input = exact(value, ["kind", "providerProtocol", "expectedCurrentStateHash", "restoreStateHash", "restorePayloads", "processPolicy", "processPolicyHash"], label);
  if (input.kind !== "codex_registration_refresh") fail(`${label}.kind`);
  parsePositiveUInt32(input.providerProtocol);
  parseLowerHexSha256(input.expectedCurrentStateHash);
  parseLowerHexSha256(input.restoreStateHash);
  // The current Codex-effect protocol restores registration state, never retained bytes.
  list(input.restorePayloads, 0, 0, `${label}.restorePayloads`);
  const policy = input.processPolicy as OwnerExternalEffectProcessPolicyV1;
  if (input.processPolicyHash !== ownerExternalEffectProcessPolicyHash(policy)) fail(`${label}.processPolicyHash`);
  if (policy.providerProtocol !== input.providerProtocol) fail(`${label}.providerProtocol: not the policy's`);
  return input as unknown as RetainedExternalEffectInversePlanV1;
}

function checkRetainedBounds(input: Readonly<Record<string, unknown>>, label: string): void {
  const maximum = integer(input.maximumPlanBytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  if (bytesOf(input).byteLength > maximum) fail(`${label}: exceeds its plan bytes`);
}

function validateOwnerInverse(value: unknown, bound: boolean, label: string): Readonly<Record<string, unknown>> {
  const input = exact(value, bound ? [...OWNER_PROJECTION_KEYS, "rollbackBindingHash", "sourceOwnerPlanHash"] : OWNER_PROJECTION_KEYS, label);
  if (input.schemaVersion !== 1 || input.kind !== "owner_inverse") fail(label);
  parseSafeReasonCode(input.id);
  const owner = oneOf(input.owner, OWNER_UPDATE_ORDER, `${label}.owner`);
  let prior: string | null = null;
  list(input.operations, 0, MAX_OWNER_OPERATIONS, `${label}.operations`).forEach((row, index) => {
    const rowLabel = `${label}.operations[${index.toString(10)}]`;
    const operation = exact(row, ["path", "expectedCurrent", "restore"], rowLabel);
    const path = parseCanonicalAbsolutePathText(operation.path);
    if (prior !== null && compareUtf8(prior, path) >= 0) fail(`${rowLabel}: not unique unsigned-UTF-8 path order`);
    prior = path;
    const expectedCurrent = validatePathState(operation.expectedCurrent, "expectedCurrent", `${rowLabel}.expectedCurrent`);
    const restore = validatePathState(operation.restore, "restore", `${rowLabel}.restore`);
    if (expectedCurrent.state === restore.state && (restore.state !== "file" || (expectedCurrent as { readonly sha256: string }).sha256 === restore.sha256)) fail(`${rowLabel}: restores the state it expects`);
  });
  const effects = list(input.externalEffects, 0, 1, `${label}.externalEffects`);
  if (effects.length > 0 && owner !== "codex") fail(`${label}.externalEffects: only the Codex owner refreshes a registration`);
  effects.forEach((effect, index) => validateEffectInverse(effect, `${label}.externalEffects[${index.toString(10)}]`));
  if (bound) {
    parseLowerHexSha256(input.rollbackBindingHash);
    parseLowerHexSha256(input.sourceOwnerPlanHash);
  }
  checkRetainedBounds(input, label);
  return input;
}

function validateMigrationInverse(value: unknown, bound: boolean, label: string): Readonly<Record<string, unknown>> {
  const input = exact(value, bound ? [...MIGRATION_PROJECTION_KEYS, "rollbackBindingHash", "sourceMigrationPlanHash"] : MIGRATION_PROJECTION_KEYS, label);
  if (input.schemaVersion !== 1 || input.kind !== "schema_migration_inverse") fail(label);
  parseSchemaMigrationId(input.id);
  const domain = oneOf(input.domain, ["brain", "product_state"] as const, `${label}.domain`);
  if (parsePositiveUInt32(input.fromVersion) >= parsePositiveUInt32(input.toVersion)) fail(`${label}: version order`);
  const seen = new Set<string>();
  list(input.mutations, 1, MAX_MIGRATION_MUTATIONS, `${label}.mutations`).forEach((row, index) => {
    const rowLabel = `${label}.mutations[${index.toString(10)}]`;
    const mutation = exact(row, ["path", "expectedCurrentHash", "restoreHash", "restoreBlob"], rowLabel);
    // Brain paths are vault-relative and product-state paths absolute, so one never passes as the other.
    const path = domain === "brain" ? parseVaultRelativePathText(mutation.path) : parseCanonicalAbsolutePathText(mutation.path);
    if (seen.has(path)) fail(`${rowLabel}: duplicate path`);
    seen.add(path);
    parseLowerHexSha256(mutation.expectedCurrentHash);
    const restoreHash = parseLowerHexSha256(mutation.restoreHash);
    if (validateBlobRef(mutation.restoreBlob, `${rowLabel}.restoreBlob`).sha256 !== restoreHash) fail(`${rowLabel}: the blob does not restore its hash`);
  });
  if (input.maximumPlanBytes !== MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES) fail(`${label}.maximumPlanBytes`);
  if (bound) {
    parseLowerHexSha256(input.rollbackBindingHash);
    parseLowerHexSha256(input.sourceMigrationPlanHash);
  }
  checkRetainedBounds(input, label);
  return input;
}

export function validateRetainedOwnerInverseProjection(value: unknown): RetainedOwnerInverseProjectionV1 {
  return validateOwnerInverse(value, false, "RetainedOwnerInverseProjectionV1") as unknown as RetainedOwnerInverseProjectionV1;
}

export function validateRetainedOwnerInversePlan(value: unknown): RetainedOwnerInversePlanV1 {
  return validateOwnerInverse(value, true, "RetainedOwnerInversePlanV1") as unknown as RetainedOwnerInversePlanV1;
}

export function validateRetainedSchemaMigrationInverseProjection(value: unknown): RetainedSchemaMigrationInverseProjectionV1 {
  return validateMigrationInverse(value, false, "RetainedSchemaMigrationInverseProjectionV1") as unknown as RetainedSchemaMigrationInverseProjectionV1;
}

export function validateRetainedSchemaMigrationInversePlan(value: unknown): RetainedSchemaMigrationInversePlanV1 {
  return validateMigrationInverse(value, true, "RetainedSchemaMigrationInversePlanV1") as unknown as RetainedSchemaMigrationInversePlanV1;
}

/** Adds the two allocation-bound fields a projection omits. */
export function bindRetainedInversePlan(
  projection: RetainedOwnerInverseProjectionV1 | RetainedSchemaMigrationInverseProjectionV1,
  binding: LowerHexSha256,
  sourcePlanHash: LowerHexSha256,
): RetainedOwnerInversePlanV1 | RetainedSchemaMigrationInversePlanV1 {
  return projection.kind === "owner_inverse"
    ? validateRetainedOwnerInversePlan({ ...projection, rollbackBindingHash: binding, sourceOwnerPlanHash: sourcePlanHash })
    : validateRetainedSchemaMigrationInversePlan({ ...projection, rollbackBindingHash: binding, sourceMigrationPlanHash: sourcePlanHash });
}

/** Decodes one retained leaf file as the exact canonical projection of its kind. */
export function decodeRetainedInverseLeaf(kind: RetainedInverseKindV1, bytes: Uint8Array): RetainedOwnerInverseProjectionV1 | RetainedSchemaMigrationInverseProjectionV1 {
  const value = decodeCanonicalJson(bytes, MAXIMUM_LEAF_PLAN_BYTES);
  if (Buffer.compare(bytesOf(value), bytes) !== 0) fail("retained inverse leaf: not canonical");
  return kind === "owner_inverse" ? validateRetainedOwnerInverseProjection(value) : validateRetainedSchemaMigrationInverseProjection(value);
}

function validateInverseRef<TKind extends RetainedInverseKindV1>(value: unknown, kind: TKind, label: string): RetainedInversePlanRefV1<TKind> {
  const input = exact(value, ["kind", "id", "path", "sourcePlanHash", "retainedHash", "bytes"], label);
  if (input.kind !== kind) fail(`${label}.kind`);
  if (typeof input.id !== "string" || input.path !== retainedInversePlanPath(kind, input.id)) fail(`${label}.path: not the id-derived path`);
  parseLowerHexSha256(input.sourcePlanHash);
  parseLowerHexSha256(input.retainedHash);
  integer(input.bytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.bytes`);
  return input as unknown as RetainedInversePlanRefV1<TKind>;
}

export function validateBoundedUpdateInversePlan(value: unknown): BoundedUpdateInversePlanV1 {
  const label = "BoundedUpdateInversePlanV1";
  const input = exact(value, INVERSE_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseRollbackPayloadId(input.payloadId);
  for (const key of ["rollbackBindingHash", "installedReleaseIdentityHash", "previousReleaseIdentityHash", "exactStepListHash"]) parseLowerHexSha256(input[key]);
  if (input.installedReleaseIdentityHash === input.previousReleaseIdentityHash) fail(`${label}: installed and previous are one release`);
  const owners = list(input.ownerPlans, 1, MAX_OWNER_PLANS, `${label}.ownerPlans`).map((ref, index) => validateInverseRef(ref, "owner_inverse", `${label}.ownerPlans[${index.toString(10)}]`));
  const migrations = list(input.migrationPlans, 0, MAX_MIGRATION_PLANS, `${label}.migrationPlans`).map((ref, index) => validateInverseRef(ref, "schema_migration_inverse", `${label}.migrationPlans[${index.toString(10)}]`));
  const ids = new Set([...owners, ...migrations].map((ref) => ref.path));
  if (ids.size !== owners.length + migrations.length) fail(`${label}: duplicate retained ref`);
  const maximum = integer(input.maximumBytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.maximumBytes`);
  if (bytesOf(input).byteLength > maximum) fail(`${label}: exceeds its bytes`);
  return input as unknown as BoundedUpdateInversePlanV1;
}

/**
 * Contiguous ordinals; a blob path derived from its ordinal and an inverse-plan-leaf path from its
 * ref; each entry at most 16 MiB; a checked aggregate at most 2 GiB; the canonical file at most 64 MiB.
 */
export function validateRollbackPayloadInventory(value: unknown): RollbackPayloadInventoryV1 {
  const label = "RollbackPayloadInventoryV1";
  const input = exact(value, INVENTORY_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseRollbackPayloadId(input.payloadId);
  parseLowerHexSha256(input.rollbackBindingHash);
  parseLowerHexSha256(input.inversePlanHash);
  const leaves = new Set<string>();
  let total = 0;
  list(input.entries, 0, MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES, `${label}.entries`).forEach((row, index) => {
    const rowLabel = `${label}.entries[${index.toString(10)}]`;
    const entry = exact(row, ["ordinal", "path", "role", "bytes", "sha256"], rowLabel);
    if (entry.ordinal !== index) fail(`${rowLabel}.ordinal: not contiguous`);
    const role = oneOf(entry.role, ENTRY_ROLES, `${rowLabel}.role`);
    if (role === "inverse_plan_leaf") {
      const match = typeof entry.path === "string" ? LEAF_PATH.exec(entry.path) : null;
      if (match === null || entry.path !== retainedInversePlanPath(match[1] as RetainedInverseKindV1, match[2] as string) || leaves.has(entry.path as string)) fail(`${rowLabel}.path`);
      leaves.add(entry.path as string);
    } else if (entry.path !== rollbackPayloadBlobPath(index)) {
      fail(`${rowLabel}.path: not its ordinal's blob path`);
    }
    total += integer(entry.bytes, role === "inverse_plan_leaf" ? 1 : 0, MAXIMUM_ROLLBACK_BLOB_BYTES, `${rowLabel}.bytes`);
    if (total > MAXIMUM_ROLLBACK_PAYLOAD_AGGREGATE_BYTES) fail(`${label}: aggregate bytes`);
    parseLowerHexSha256(entry.sha256);
  });
  if (input.aggregateBytes !== total) fail(`${label}.aggregateBytes`);
  if (bytesOf(input).byteLength > MAXIMUM_ROLLBACK_DOCUMENT_BYTES) fail(`${label}: exceeds 64 MiB`);
  return input as unknown as RollbackPayloadInventoryV1;
}

// ---------------------------------------------------------------------------------------------
// Building and the acyclic binding graph
// ---------------------------------------------------------------------------------------------

function leafRoles(plan: RetainedOwnerInverseProjectionV1 | RetainedSchemaMigrationInverseProjectionV1): readonly { readonly ref: RetainedInverseBlobRefV1; readonly role: RollbackPayloadEntryV1["role"] }[] {
  if (plan.kind === "schema_migration_inverse") return plan.mutations.map((mutation) => ({ ref: mutation.restoreBlob, role: "migration_preimage" }));
  const refs: { readonly ref: RetainedInverseBlobRefV1; readonly role: RollbackPayloadEntryV1["role"] }[] = [];
  for (const operation of plan.operations) {
    if (operation.restore.state === "file") for (const chunk of operation.restore.payload?.chunks ?? []) refs.push({ ref: chunk, role: "owner_preimage" });
  }
  for (const effect of plan.externalEffects) for (const ref of effect.restorePayloads) refs.push({ ref, role: "external_effect_preimage" });
  return refs;
}

/**
 * Builds inverse plan → inventory → record in that order. The retained leaves are the candidate's
 * prepared projections byte-for-byte, and the inventory rows are the candidate's; only the
 * allocation envelope (payload ID, binding, source-plan and retained hashes) is added here.
 */
export function buildRollbackPayload(candidate: PreparedUpdateCandidateV1, allocation: RollbackAllocationV1): PreparedRollbackPayloadV1 {
  const label = "buildRollbackPayload";
  const materialization = candidate.materialization;
  const payloadId = parseRollbackPayloadId(allocation.payloadId);
  if (allocation.installed.releaseIdentityHash !== candidate.preview.target.releaseIdentityHash || allocation.previous.releaseIdentityHash !== candidate.preview.current.releaseIdentityHash) {
    fail(`${label}: releases are not the candidate's target and current`);
  }
  const projections = materialization.inversePlanProjections;
  if (allocation.sourcePlanHashes.length !== projections.length) fail(`${label}: not one source plan hash per inverse projection`);
  const binding = rollbackBindingHash({
    executionBindingHash: allocation.executionBindingHash,
    payloadId,
    installedReleaseIdentityHash: allocation.installed.releaseIdentityHash,
    previousReleaseIdentityHash: allocation.previous.releaseIdentityHash,
  });
  const leaves = projections.map((prepared, index): RetainedInverseLeafFileV1 => {
    const bytes = encoder.encode(prepared.projection);
    if (bytes.byteLength !== prepared.bytes) fail(`${label}: projection ${index.toString(10)} bytes`);
    const projection = decodeRetainedInverseLeaf(prepared.kind, bytes);
    if (projection.id !== prepared.id) fail(`${label}: projection ${index.toString(10)} id`);
    const sourcePlanHash = parseLowerHexSha256(allocation.sourcePlanHashes[index]);
    const ref = {
      kind: prepared.kind,
      id: prepared.id,
      path: retainedInversePlanPath(prepared.kind, prepared.id),
      sourcePlanHash,
      retainedHash: retainedInversePlanHash(bindRetainedInversePlan(projection, binding, sourcePlanHash)),
      bytes: bytes.byteLength,
    } as RetainedInversePlanRefV1;
    return { ref, bytes };
  });
  const inversePlan = validateBoundedUpdateInversePlan({
    schemaVersion: 1,
    rollbackBindingHash: binding,
    payloadId,
    installedReleaseIdentityHash: allocation.installed.releaseIdentityHash,
    previousReleaseIdentityHash: allocation.previous.releaseIdentityHash,
    ownerPlans: leaves.filter((leaf) => leaf.ref.kind === "owner_inverse").map((leaf) => leaf.ref),
    migrationPlans: leaves.filter((leaf) => leaf.ref.kind === "schema_migration_inverse").map((leaf) => leaf.ref),
    exactStepListHash: parseLowerHexSha256(allocation.exactStepListHash),
    maximumBytes: MAXIMUM_LEAF_PLAN_BYTES,
  });
  const inversePlanBytes = rollbackDocumentBytes(inversePlan);
  const inversePlanHash = rollbackDocumentHash(inversePlanBytes);
  const inventory = validateRollbackPayloadInventory({
    schemaVersion: 1,
    payloadId,
    rollbackBindingHash: binding,
    inversePlanHash,
    entries: materialization.rollbackInventoryEntries,
    aggregateBytes: materialization.aggregateBytes,
  });
  const inventoryBytes = rollbackDocumentBytes(inventory);
  const inventoryHash = rollbackDocumentHash(inventoryBytes);
  const record: RollbackRecordV1 = {
    schemaVersion: 1,
    installed: allocation.installed,
    previous: allocation.previous,
    executionBindingHash: parseLowerHexSha256(allocation.executionBindingHash),
    rollbackBindingHash: binding,
    payloadId,
    payloadInventoryHash: inventoryHash,
    inversePlanHash,
    createdAt: parseUtcTimestamp(allocation.createdAt),
  };
  const payload: PreparedRollbackPayloadV1 = {
    identity: {
      payloadId,
      root: rollbackPayloadRoot(allocation.productHome, payloadId),
      rollbackBindingHash: binding,
      inversePlanHash,
      inventoryHash,
      entryCount: inventory.entries.length,
      aggregateBytes: inventory.aggregateBytes,
    },
    record,
    recordBytes: rollbackDocumentBytes(record),
    inversePlan,
    inversePlanBytes,
    inventory,
    inventoryBytes,
    // Owner leaves precede migration leaves in the inverse plan; the files follow that ref order.
    leaves: [...leaves.filter((leaf) => leaf.ref.kind === "owner_inverse"), ...leaves.filter((leaf) => leaf.ref.kind === "schema_migration_inverse")],
  };
  validateRollbackBindingGraph(payload);
  return payload;
}

/**
 * Proves the one binding and every cross-object bijection: the same binding and payload ID in inverse
 * plan, inventory, record, and identity; each document's hash in the next; each ref's leaf entry,
 * bytes, and retained hash; and every blob entry referenced exactly once under its role. The inverse
 * plan hashes nothing that contains it. Returns `true` or throws.
 */
export function validateRollbackBindingGraph(payload: PreparedRollbackPayloadV1): true {
  const label = "PreparedRollbackPayloadV1";
  const { record: rollback, inversePlan, inventory, identity: payloadIdentity } = payload;
  for (const [bytes, value] of [[payload.inversePlanBytes, inversePlan], [payload.inventoryBytes, inventory], [payload.recordBytes, rollback]] as const) {
    if (Buffer.compare(bytes, bytesOf(value)) !== 0) fail(`${label}: a document is not its canonical bytes`);
  }
  validateBoundedUpdateInversePlan(inversePlan);
  validateRollbackPayloadInventory(inventory);
  validateRollbackPayloadIdentity(payloadIdentity);
  const binding = rollbackBindingHash({
    executionBindingHash: rollback.executionBindingHash,
    payloadId: rollback.payloadId,
    installedReleaseIdentityHash: rollback.installed.releaseIdentityHash,
    previousReleaseIdentityHash: rollback.previous.releaseIdentityHash,
  });
  const inversePlanHash = rollbackDocumentHash(payload.inversePlanBytes);
  const inventoryHash = rollbackDocumentHash(payload.inventoryBytes);
  if (rollback.rollbackBindingHash !== binding || inversePlan.rollbackBindingHash !== binding || inventory.rollbackBindingHash !== binding || payloadIdentity.rollbackBindingHash !== binding) fail(`${label}: rollback binding`);
  if (inversePlan.payloadId !== rollback.payloadId || inventory.payloadId !== rollback.payloadId || payloadIdentity.payloadId !== rollback.payloadId) fail(`${label}: payload ID`);
  if (inversePlan.installedReleaseIdentityHash !== rollback.installed.releaseIdentityHash || inversePlan.previousReleaseIdentityHash !== rollback.previous.releaseIdentityHash) fail(`${label}: release identities`);
  if (inventory.inversePlanHash !== inversePlanHash || rollback.inversePlanHash !== inversePlanHash || payloadIdentity.inversePlanHash !== inversePlanHash) fail(`${label}: inverse plan hash`);
  if (rollback.payloadInventoryHash !== inventoryHash || payloadIdentity.inventoryHash !== inventoryHash) fail(`${label}: inventory hash`);
  if (payloadIdentity.entryCount !== inventory.entries.length || payloadIdentity.aggregateBytes !== inventory.aggregateBytes) fail(`${label}: identity counts`);

  const refs: readonly RetainedInversePlanRefV1[] = [...inversePlan.ownerPlans, ...inversePlan.migrationPlans];
  if (payload.leaves.length !== refs.length) fail(`${label}.leaves: not one file per retained ref`);
  const byPath = new Map(inventory.entries.map((entry) => [entry.path as string, entry]));
  const referencedBlobs = new Set<string>();
  let ownerRank = -1;
  let migrationRank: readonly [number, number] = [-1, 0];
  refs.forEach((ref, index) => {
    const leaf = payload.leaves[index] as RetainedInverseLeafFileV1;
    const entry = byPath.get(ref.path);
    if (!sameCanonical(leaf.ref, ref) || entry?.role !== "inverse_plan_leaf") fail(`${label}.leaves[${index.toString(10)}]: not its ref's leaf entry`);
    if (leaf.bytes.byteLength !== ref.bytes || entry.bytes !== ref.bytes || entry.sha256 !== sha256Hex(leaf.bytes)) fail(`${label}.leaves[${index.toString(10)}]: bytes`);
    const projection = decodeRetainedInverseLeaf(ref.kind, leaf.bytes);
    if (projection.id !== ref.id) fail(`${label}.leaves[${index.toString(10)}].id`);
    if (projection.kind === "owner_inverse") {
      const rank = OWNER_UPDATE_ORDER.indexOf(projection.owner);
      if (rank <= ownerRank) fail(`${label}.ownerPlans: not canonical owner order`);
      ownerRank = rank;
    } else {
      // Chain order (orderMigrationChain): compose pairs these leaves with the inventory rows by position.
      const rank = [SCHEMA_MIGRATION_DOMAIN_ORDER.indexOf(projection.domain), projection.fromVersion] as const;
      if (rank[0] < migrationRank[0] || (rank[0] === migrationRank[0] && rank[1] <= migrationRank[1])) fail(`${label}.migrationPlans: not chain order`);
      migrationRank = rank;
    }
    if (ref.retainedHash !== retainedInversePlanHash(bindRetainedInversePlan(projection, binding, ref.sourcePlanHash))) fail(`${label}.leaves[${index.toString(10)}].retainedHash`);
    for (const { ref: blob, role } of leafRoles(projection)) {
      const blobEntry = byPath.get(blob.path);
      if (blobEntry?.role !== role || blobEntry.bytes !== blob.bytes || blobEntry.sha256 !== blob.sha256 || referencedBlobs.has(blob.path)) fail(`${label}: blob ${blob.path} is not one exact ${role} entry`);
      referencedBlobs.add(blob.path);
    }
  });
  const leafEntries = inventory.entries.filter((entry) => entry.role === "inverse_plan_leaf").length;
  if (leafEntries !== refs.length || referencedBlobs.size + leafEntries !== inventory.entries.length) fail(`${label}: an inventory entry no retained plan references`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Payload layout, manifest partition, and exact retirement inventory
// ---------------------------------------------------------------------------------------------

export interface RollbackPayloadStructureV1 {
  readonly role: UpdateDirectoryRoleV1;
  readonly path: CanonicalAbsolutePathV1;
}

const PAYLOAD_STRUCTURES: readonly (readonly [UpdateDirectoryRoleV1, string])[] = [
  ["rollback_payload_root", ""],
  ["plans_root", "/plans"],
  ["owner_inverse_plans_root", "/plans/owner_inverse"],
  ["schema_migration_inverse_plans_root", "/plans/schema_migration_inverse"],
  ["blobs_root", "/blobs"],
];

/** The five fixed publication structures in their creation order. */
export function rollbackPayloadStructures(root: CanonicalAbsolutePathV1): readonly RollbackPayloadStructureV1[] {
  return PAYLOAD_STRUCTURES.map(([role, suffix]) => ({ role, path: parseCanonicalAbsolutePathText(`${root}${suffix}`) }));
}

/** Ordinals 0 and 1 are `inverse-plan.json` and `inventory.json`, in publication order. */
export function rollbackPayloadMetadataPath(root: CanonicalAbsolutePathV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${root}/${[ROLLBACK_INVERSE_PLAN_NAME, ROLLBACK_INVENTORY_NAME][integer(ordinal, 0, 1, "metadata ordinal")] as string}`);
}

/** The structure ordinal that is an entry's parent: `plans/<kind>` or `blobs`. */
export function rollbackEntryParentStructure(entry: RollbackPayloadEntryV1): 2 | 3 | 4 {
  if (entry.role !== "inverse_plan_leaf") return 4;
  return entry.path.startsWith("plans/owner_inverse/") ? 2 : 3;
}

export interface RollbackPayloadLeafV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly kind: "file" | "directory";
  /** Exact bytes for an entry; `null` for a directory or a document bounded by 64 MiB. */
  readonly bytes: number | null;
  readonly sha256: LowerHexSha256 | null;
}

export interface RetirementInventoryRefV1 {
  readonly kind: "bundle" | "metadata" | "rollback_payload" | "rollback_record";
  readonly root: CanonicalAbsolutePathV1;
  readonly inventoryHash: LowerHexSha256;
  readonly leafCount: number;
}

function checkInventoryForIdentity(payloadIdentity: RollbackPayloadIdentityV1, inventory: RollbackPayloadInventoryV1): void {
  validateRollbackPayloadIdentity(payloadIdentity);
  validateRollbackPayloadInventory(inventory);
  if (inventory.payloadId !== payloadIdentity.payloadId || inventory.rollbackBindingHash !== payloadIdentity.rollbackBindingHash || inventory.inversePlanHash !== payloadIdentity.inversePlanHash) fail("RollbackPayloadInventoryV1: not this identity's inventory");
  if (inventory.entries.length !== payloadIdentity.entryCount || inventory.aggregateBytes !== payloadIdentity.aggregateBytes) fail("RollbackPayloadInventoryV1: counts");
  if (rollbackDocumentHash(rollbackDocumentBytes(inventory)) !== payloadIdentity.inventoryHash) fail("RollbackPayloadInventoryV1: hash");
}

/**
 * The payload's exact removable leaves in removal order: entries in reverse ordinal order, then
 * `inverse-plan.json`, then `inventory.json` (last of the files, so it stays the authority while
 * any entry remains), then the five directories deepest-first. The same set is the payload's V2
 * manifest partition: `entryCount + 7` leaves.
 */
export function rollbackPayloadRetirementLeaves(payloadIdentity: RollbackPayloadIdentityV1, inventory: RollbackPayloadInventoryV1): readonly RollbackPayloadLeafV1[] {
  checkInventoryForIdentity(payloadIdentity, inventory);
  const root = payloadIdentity.root;
  const leaves: RollbackPayloadLeafV1[] = [];
  for (let ordinal = inventory.entries.length - 1; ordinal >= 0; ordinal -= 1) {
    const entry = inventory.entries[ordinal] as RollbackPayloadEntryV1;
    leaves.push({ path: parseCanonicalAbsolutePathText(`${root}/${entry.path}`), kind: "file", bytes: entry.bytes, sha256: entry.sha256 });
  }
  leaves.push({ path: rollbackPayloadMetadataPath(root, 0), kind: "file", bytes: null, sha256: payloadIdentity.inversePlanHash });
  leaves.push({ path: rollbackPayloadMetadataPath(root, 1), kind: "file", bytes: null, sha256: payloadIdentity.inventoryHash });
  const structures = rollbackPayloadStructures(root);
  for (const ordinal of [4, 3, 2, 1, 0]) leaves.push({ path: (structures[ordinal] as RollbackPayloadStructureV1).path, kind: "directory", bytes: null, sha256: null });
  return leaves;
}

// ---------------------------------------------------------------------------------------------
// Rollback-payload source staging (Spec 2 §9.2)
// ---------------------------------------------------------------------------------------------

export interface RollbackPayloadSourceMetadataPlanV1 {
  readonly role: "inverse_plan" | "inventory";
  readonly path: CanonicalAbsolutePathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
}

export interface RollbackPayloadSourceMetadataIdentityV1 extends RollbackPayloadSourceMetadataPlanV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface RollbackPayloadSourceStagingPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootBefore: { readonly state: "absent" };
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entriesProjectionHash: LowerHexSha256;
  readonly metadata: readonly [RollbackPayloadSourceMetadataPlanV1, RollbackPayloadSourceMetadataPlanV1];
  readonly entryCount: number;
  readonly aggregateBytes: number;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export type RollbackPayloadSourcePhaseV1 = "planned" | "structure_staging" | "metadata_publishing" | "payload_staging" | "source_ready" | "compensating" | "rolled_back" | "compacting";

export type UpdateSourceMetadataWriteStateV1 =
  | { readonly ordinal: number; readonly state: "create_intent" }
  | { readonly ordinal: number; readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface RollbackPayloadSourceStagingJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: RollbackPayloadSourcePhaseV1;
  readonly nextStructure: number;
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[];
  readonly structureWriteState: UpdateStructureWriteStateV1 | null;
  readonly nextMetadata: number;
  readonly metadataIdentities: readonly RollbackPayloadSourceMetadataIdentityV1[];
  readonly metadataWriteState: UpdateSourceMetadataWriteStateV1 | null;
  readonly nextEntry: number;
  readonly entryWriteState: UpdateEntryWriteStateV1 | null;
  readonly readyWriteState: UpdateSourceReadyWriteStateV1 | null;
  readonly readyIdentity: UpdateSourceReadyIdentityV1 | null;
  readonly compensationMetadataNext: number | null;
  readonly compensationNext: number | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface RollbackPayloadSourceReadyEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly stagingPlanHash: LowerHexSha256;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootDev: UInt64DecimalV1;
  readonly sourceRootIno: UInt64DecimalV1;
  readonly structureIdentitiesHash: LowerHexSha256;
  readonly inversePlanHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly evidenceSetHash: LowerHexSha256;
  readonly metadata: readonly [RollbackPayloadSourceMetadataIdentityV1, RollbackPayloadSourceMetadataIdentityV1];
  readonly entryCount: number;
  readonly aggregateBytes: number;
}

export type RollbackPayloadSourceStepV1 =
  | { readonly kind: "structure_intent" }
  | ({ readonly kind: "structure_created" } & Identity)
  | { readonly kind: "structure_complete" }
  | { readonly kind: "metadata_intent" }
  | ({ readonly kind: "metadata_created" } & Identity)
  | { readonly kind: "metadata_complete" }
  | UpdateEntryStepV1
  | { readonly kind: "ready_intent" }
  | ({ readonly kind: "ready_created" } & Identity)
  | { readonly kind: "ready_complete" }
  | { readonly kind: "compensate" }
  | { readonly kind: "ready_removed" }
  | { readonly kind: "compensation_step" }
  | { readonly kind: "compaction_step" };

export type RollbackPayloadSourceCompactionTargetV1 =
  | { readonly kind: "ready" }
  | { readonly kind: "entry" | "evidence" | "metadata" | "structure"; readonly ordinal: number };

export interface RollbackPayloadSourcePathsV1 {
  /** `update/source/rollback`: a construction directory; its identity comes only from the construction journal. */
  readonly parent: CanonicalAbsolutePathV1;
  readonly envelope: CanonicalAbsolutePathV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  readonly ready: CanonicalAbsolutePathV1;
}

const SOURCE_STRUCTURE_COUNT = 7;
const SOURCE_METADATA_ROLES = ["inverse_plan", "inventory"] as const;
const SOURCE_PHASES: readonly RollbackPayloadSourcePhaseV1[] = ["planned", "structure_staging", "metadata_publishing", "payload_staging", "source_ready", "compensating", "rolled_back", "compacting"];
const SOURCE_FORWARD: readonly RollbackPayloadSourcePhaseV1[] = ["planned", "structure_staging", "metadata_publishing", "payload_staging"];
const SOURCE_PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "payloadId", "rollbackBindingHash", "sourceRoot", "evidenceRoot", "sourceRootBefore", "inversePlanHash", "inventoryHash", "entriesProjectionHash", "metadata", "entryCount", "aggregateBytes", "maximumPlanBytes", "maximumJournalBytes"];
const SOURCE_JOURNAL_KEYS = ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextStructure", "structureIdentities", "structureWriteState", "nextMetadata", "metadataIdentities", "metadataWriteState", "nextEntry", "entryWriteState", "readyWriteState", "readyIdentity", "compensationMetadataNext", "compensationNext", "compensationPart", "compensationStructureNext", "compactionNext", "createdAt", "updatedAt"];
const SOURCE_READY_KEYS = ["schemaVersion", "coordinatorId", "stagingPlanHash", "payloadId", "rollbackBindingHash", "sourceRoot", "sourceRootDev", "sourceRootIno", "structureIdentitiesHash", "inversePlanHash", "inventoryHash", "evidenceSetHash", "metadata", "entryCount", "aggregateBytes"];
const METADATA_IDENTITY_KEYS = ["role", "path", "bytes", "sha256", "dev", "ino"];

export function rollbackPayloadSourcePaths(stagingRoot: CanonicalAbsolutePathV1, payloadId: RollbackPayloadIdV1): RollbackPayloadSourcePathsV1 {
  const parent = `${stagingRoot}/update/source/rollback`;
  const envelope = `${parent}/${parseRollbackPayloadId(payloadId)}`;
  return {
    parent: parseCanonicalAbsolutePathText(parent),
    envelope: parseCanonicalAbsolutePathText(envelope),
    sourceRoot: parseCanonicalAbsolutePathText(`${envelope}/payload`),
    evidenceRoot: parseCanonicalAbsolutePathText(`${envelope}/evidence`),
    ready: parseCanonicalAbsolutePathText(`${envelope}.ready.json`),
  };
}

/** Envelope, payload root, evidence root, then the payload's `plans`, two plan kinds, and `blobs`. */
export function rollbackPayloadSourceStructures(plan: RollbackPayloadSourceStagingPlanV1): readonly RollbackPayloadStructureV1[] {
  const envelope = parseCanonicalAbsolutePathText(plan.sourceRoot.slice(0, plan.sourceRoot.lastIndexOf("/")));
  return [
    { role: "source_envelope", path: envelope },
    { role: "source_payload_root", path: plan.sourceRoot },
    { role: "source_evidence_root", path: plan.evidenceRoot },
    ...rollbackPayloadStructures(plan.sourceRoot).slice(1),
  ];
}

export function rollbackSourceEntryPath(plan: RollbackPayloadSourceStagingPlanV1, entry: RollbackPayloadEntryV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.sourceRoot}/${entry.path}`);
}

export function rollbackSourceEvidencePath(plan: RollbackPayloadSourceStagingPlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.evidenceRoot}/${encodeTenDigitOrdinal(integer(ordinal, 0, plan.entryCount - 1, "source entry ordinal"))}.json`);
}

function validateSourceMetadataPlan(value: unknown, ordinal: number, sourceRoot: CanonicalAbsolutePathV1, label: string): RollbackPayloadSourceMetadataPlanV1 {
  const input = exact(value, ["role", "path", "bytes", "sha256"], label);
  if (input.role !== SOURCE_METADATA_ROLES[ordinal] || input.path !== rollbackPayloadMetadataPath(sourceRoot, ordinal)) fail(`${label}: not the fixed role/path`);
  integer(input.bytes, 1, MAXIMUM_ROLLBACK_DOCUMENT_BYTES, `${label}.bytes`);
  parseLowerHexSha256(input.sha256);
  return input as unknown as RollbackPayloadSourceMetadataPlanV1;
}

export function validateRollbackPayloadSourceStagingPlan(value: unknown, stagingRoot: CanonicalAbsolutePathV1): RollbackPayloadSourceStagingPlanV1 {
  const label = "RollbackPayloadSourceStagingPlanV1";
  const input = exact(value, SOURCE_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(input.id);
  coordinatorOf(stagingRoot, input.coordinatorId, label);
  const paths = rollbackPayloadSourcePaths(stagingRoot, parseRollbackPayloadId(input.payloadId));
  if (input.sourceRoot !== paths.sourceRoot || input.evidenceRoot !== paths.evidenceRoot) fail(`${label}: not the derived source paths`);
  if (exact(input.sourceRootBefore, ["state"], `${label}.sourceRootBefore`).state !== "absent") fail(`${label}.sourceRootBefore`);
  for (const key of ["rollbackBindingHash", "inversePlanHash", "inventoryHash", "entriesProjectionHash"]) parseLowerHexSha256(input[key]);
  const metadata = list(input.metadata, 2, 2, `${label}.metadata`).map((row, ordinal) => validateSourceMetadataPlan(row, ordinal, paths.sourceRoot, `${label}.metadata[${ordinal.toString(10)}]`));
  if (metadata[0]?.sha256 !== input.inversePlanHash || metadata[1]?.sha256 !== input.inventoryHash) fail(`${label}.metadata: not the bound inverse plan and inventory`);
  integer(input.entryCount, 1, MAXIMUM_ROLLBACK_PAYLOAD_ENTRIES, `${label}.entryCount`);
  integer(input.aggregateBytes, 0, MAXIMUM_ROLLBACK_PAYLOAD_AGGREGATE_BYTES, `${label}.aggregateBytes`);
  checkPlanBounds(input, label);
  return input as unknown as RollbackPayloadSourceStagingPlanV1;
}

/** The source plan for one prepared payload; `entriesProjectionHash` is the construction object's. */
export function buildRollbackPayloadSourceStagingPlan(input: {
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
  readonly payload: PreparedRollbackPayloadV1;
  readonly entriesProjectionHash: LowerHexSha256;
}): RollbackPayloadSourceStagingPlanV1 {
  const payloadIdentity = input.payload.identity;
  const paths = rollbackPayloadSourcePaths(input.stagingRoot, payloadIdentity.payloadId);
  return validateRollbackPayloadSourceStagingPlan({
    schemaVersion: 1,
    id: input.id,
    coordinatorId: input.coordinatorId,
    payloadId: payloadIdentity.payloadId,
    rollbackBindingHash: payloadIdentity.rollbackBindingHash,
    sourceRoot: paths.sourceRoot,
    evidenceRoot: paths.evidenceRoot,
    sourceRootBefore: { state: "absent" },
    inversePlanHash: payloadIdentity.inversePlanHash,
    inventoryHash: payloadIdentity.inventoryHash,
    entriesProjectionHash: input.entriesProjectionHash,
    metadata: [
      { role: "inverse_plan", path: rollbackPayloadMetadataPath(paths.sourceRoot, 0), bytes: input.payload.inversePlanBytes.byteLength, sha256: payloadIdentity.inversePlanHash },
      { role: "inventory", path: rollbackPayloadMetadataPath(paths.sourceRoot, 1), bytes: input.payload.inventoryBytes.byteLength, sha256: payloadIdentity.inventoryHash },
    ],
    entryCount: payloadIdentity.entryCount,
    aggregateBytes: payloadIdentity.aggregateBytes,
    maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
    maximumJournalBytes: 1_048_576,
  }, input.stagingRoot);
}

export function rollbackPayloadSourceStagingPlanBytes(plan: RollbackPayloadSourceStagingPlanV1): Uint8Array {
  return bytesOf(plan);
}

export function rollbackPayloadSourceStagingPlanHash(plan: RollbackPayloadSourceStagingPlanV1): LowerHexSha256 {
  return cachedPlanHash(plan, "rollback_payload_source");
}

export function rollbackPayloadSourceStagingPlanRef(plan: RollbackPayloadSourceStagingPlanV1, stagingRoot: CanonicalAbsolutePathV1): ImmutableUpdatePlanRefV1<"rollback_payload_source"> {
  return { kind: "rollback_payload_source", id: plan.id, path: updateLeafPlanPath(stagingRoot, "rollback_payload_source", plan.id), hash: rollbackPayloadSourceStagingPlanHash(plan), bytes: rollbackPayloadSourceStagingPlanBytes(plan).byteLength };
}

export function initialRollbackPayloadSourceJournal(plan: RollbackPayloadSourceStagingPlanV1, createdAt: UtcTimestampV1): RollbackPayloadSourceStagingJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    planHash: rollbackPayloadSourceStagingPlanHash(plan),
    phase: "planned",
    nextStructure: 0,
    structureIdentities: [],
    structureWriteState: null,
    nextMetadata: 0,
    metadataIdentities: [],
    metadataWriteState: null,
    nextEntry: 0,
    entryWriteState: null,
    readyWriteState: null,
    readyIdentity: null,
    compensationMetadataNext: null,
    compensationNext: null,
    compensationPart: null,
    compensationStructureNext: null,
    compactionNext: null,
    createdAt: parseUtcTimestamp(createdAt),
    updatedAt: createdAt,
  };
}

export function rollbackPayloadSourceJournalBytes(journal: RollbackPayloadSourceStagingJournalV1): Uint8Array {
  return bytesOf(journal);
}

function createdTop(state: { readonly state: string } | null, next: number, created: string): number {
  return state?.state === created ? next : next - 1;
}

function checkSourceMetadataState(value: unknown, next: number, label: string): UpdateSourceMetadataWriteStateV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  const state = oneOf(input.state, ["create_intent", "created"] as const, `${label}.state`);
  identity(input, state === "create_intent" ? ["ordinal", "state"] : ["ordinal", "state", "dev", "ino"], label);
  if (input.ordinal !== next || next >= 2) fail(`${label}.ordinal`);
  return input as unknown as UpdateSourceMetadataWriteStateV1;
}

/** The linear phase/cursor table; every field a phase does not own is zero/null. */
export function validateRollbackPayloadSourceJournal(value: unknown, plan: RollbackPayloadSourceStagingPlanV1): RollbackPayloadSourceStagingJournalV1 {
  const label = "RollbackPayloadSourceStagingJournalV1";
  const input = exact(value, SOURCE_JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== rollbackPayloadSourceStagingPlanHash(plan)) fail(`${label}.planHash`);
  const phase = oneOf(input.phase, SOURCE_PHASES, `${label}.phase`);
  const N = plan.entryCount;
  const nextStructure = integer(input.nextStructure, 0, SOURCE_STRUCTURE_COUNT, `${label}.nextStructure`);
  const identities = checkDirectoryIdentities(input.structureIdentities, rollbackPayloadSourceStructures(plan), `${label}.structureIdentities`);
  if (identities.length !== nextStructure) fail(`${label}.structureIdentities: not the reached prefix`);
  const structureState = checkStructureState(input.structureWriteState, nextStructure, SOURCE_STRUCTURE_COUNT, `${label}.structureWriteState`);
  const nextMetadata = integer(input.nextMetadata, 0, 2, `${label}.nextMetadata`);
  const metadataRows = list(input.metadataIdentities, 0, 2, `${label}.metadataIdentities`);
  metadataRows.forEach((row, index) => {
    const found = identity(row, METADATA_IDENTITY_KEYS, `${label}.metadataIdentities`);
    const planned = plan.metadata[index] as RollbackPayloadSourceMetadataPlanV1;
    if (found.role !== planned.role || found.path !== planned.path || found.bytes !== planned.bytes || found.sha256 !== planned.sha256) fail(`${label}.metadataIdentities: not the exact contiguous prefix`);
  });
  if (metadataRows.length !== nextMetadata) fail(`${label}.metadataIdentities: not the reached prefix`);
  const metadataState = checkSourceMetadataState(input.metadataWriteState, nextMetadata, `${label}.metadataWriteState`);
  const nextEntry = integer(input.nextEntry, 0, N, `${label}.nextEntry`);
  const entryState = checkEntryState(input.entryWriteState, nextEntry, N, `${label}.entryWriteState`);
  let ready: "absent" | "intent" | "created" = "absent";
  if (input.readyWriteState !== null) {
    const state = record(input.readyWriteState, `${label}.readyWriteState`);
    ready = state.state === "create_intent" ? "intent" : state.state === "created" ? "created" : fail(`${label}.readyWriteState.state`);
    identity(state, ready === "intent" ? ["state"] : ["state", "dev", "ino"], `${label}.readyWriteState`);
  }
  if (input.readyIdentity !== null) identity(input.readyIdentity, ["dev", "ino"], `${label}.readyIdentity`);
  const readyComplete = input.readyIdentity !== null;
  if (readyComplete && ready !== "absent") fail(`${label}: ready identity with a write state`);
  const compMetadata = nullableInteger(input.compensationMetadataNext, -1, 1, `${label}.compensationMetadataNext`);
  const compensation = nullableInteger(input.compensationNext, -1, N - 1, `${label}.compensationNext`);
  const part = input.compensationPart === null ? null : oneOf(input.compensationPart, ["entry", "evidence"] as const, `${label}.compensationPart`);
  const compStructure = nullableInteger(input.compensationStructureNext, -1, SOURCE_STRUCTURE_COUNT - 1, `${label}.compensationStructureNext`);
  const compaction = nullableInteger(input.compactionNext, 0, rollbackPayloadSourceCompactionEnd(plan), `${label}.compactionNext`);
  const { createdAt, updatedAt } = checkTimestamps(input, label);

  const noCompensation = compMetadata === null && compensation === null && part === null && compStructure === null;
  const clean = noCompensation && compaction === null;
  const noReady = ready === "absent" && !readyComplete;
  const structuresDone = nextStructure === SOURCE_STRUCTURE_COUNT && structureState === null;
  const metadataDone = structuresDone && nextMetadata === 2 && metadataState === null;
  const entriesDone = metadataDone && nextEntry === N && entryState === null;
  const noEntries = nextEntry === 0 && entryState === null;
  let legal: boolean;
  switch (phase) {
    case "planned":
      legal = clean && nextStructure === 0 && structureState === null && nextMetadata === 0 && metadataState === null && noEntries && noReady && updatedAt === createdAt;
      break;
    case "structure_staging":
      legal = clean && nextStructure < SOURCE_STRUCTURE_COUNT && nextMetadata === 0 && metadataState === null && noEntries && noReady;
      break;
    case "metadata_publishing":
      legal = clean && structuresDone && nextMetadata < 2 && noEntries && noReady;
      break;
    case "payload_staging":
      legal = clean && metadataDone && !readyComplete && (ready === "absent" || entriesDone);
      break;
    case "source_ready":
      legal = clean && entriesDone && readyComplete;
      break;
    case "compensating": {
      const walkingEntries = compensation !== null && compensation >= 0;
      const walkingMetadata = !walkingEntries && compMetadata !== null && compMetadata >= 0;
      legal = compaction === null && compensation !== null && compensation <= entryTop(entryState, nextEntry) && walkingEntries === (part !== null)
        && (walkingEntries
          ? compMetadata === null && compStructure === null
          : compMetadata !== null && compMetadata <= createdTop(metadataState, nextMetadata, "created")
            && (walkingMetadata ? compStructure === null : compStructure !== null && compStructure <= structureTop(structureState, nextStructure)))
        && (noReady || (compensation === N - 1 && part === "entry"));
      break;
    }
    case "rolled_back":
      // W2-ROLLBACK-5: a rolled-back source has cleared every write state.
      legal = compaction === null && compMetadata === -1 && compensation === -1 && part === null && compStructure === -1 && noReady && structureState === null && entryState === null && metadataState === null;
      break;
    case "compacting":
      legal = noCompensation && entriesDone && readyComplete && compaction !== null;
      break;
  }
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return input as unknown as RollbackPayloadSourceStagingJournalV1;
}

export function isRollbackPayloadSourceForward(phase: RollbackPayloadSourcePhaseV1): boolean {
  return SOURCE_FORWARD.includes(phase);
}

const ENTRY_STEP_KINDS: readonly string[] = ["entry_intent", "entry_created", "evidence_intent", "evidence_created", "entry_complete"];

function isEntryStep(step: { readonly kind: string }): step is UpdateEntryStepV1 {
  return ENTRY_STEP_KINDS.includes(step.kind);
}

/** After the entry walk: metadata in reverse, then structures, each from its reached top. */
function afterEntryCompensation(journal: RollbackPayloadSourceStagingJournalV1): Pick<RollbackPayloadSourceStagingJournalV1, "compensationMetadataNext" | "compensationStructureNext"> {
  const metadata = createdTop(journal.metadataWriteState, journal.nextMetadata, "created");
  return { compensationMetadataNext: metadata, compensationStructureNext: metadata >= 0 ? null : structureTop(journal.structureWriteState, journal.nextStructure) };
}

/** The single legal successor of a source journal; throws on any phase/cursor leap. */
export function advanceRollbackPayloadSourceJournal(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, step: RollbackPayloadSourceStepV1, updatedAt: UtcTimestampV1): RollbackPayloadSourceStagingJournalV1 {
  const label = `RollbackPayloadSourceStepV1(${step.kind})`;
  const current = validateRollbackPayloadSourceJournal(journal, plan);
  if (parseUtcTimestamp(updatedAt) < current.updatedAt) fail(`${label}: time moved backwards`);
  const N = plan.entryCount;
  const base = { ...current, updatedAt };
  const need = (condition: boolean): void => {
    if (!condition) fail(label);
  };
  if (isEntryStep(step)) {
    const entry = advanceEntry(current.entryWriteState, current.nextEntry, step, need) as { readonly state: UpdateEntryWriteStateV1 | null; readonly complete: boolean };
    need(current.phase === "payload_staging" && current.nextEntry < N && current.readyWriteState === null);
    return validateRollbackPayloadSourceJournal({ ...base, entryWriteState: entry.state, nextEntry: current.nextEntry + (entry.complete ? 1 : 0) }, plan);
  }
  let next: RollbackPayloadSourceStagingJournalV1;
  switch (step.kind) {
    case "structure_intent":
      need((current.phase === "planned" || current.phase === "structure_staging") && current.structureWriteState === null);
      next = { ...base, phase: "structure_staging", structureWriteState: { ordinal: current.nextStructure, state: "create_intent" } };
      break;
    case "structure_created":
      need(current.phase === "structure_staging" && current.structureWriteState?.state === "create_intent");
      next = { ...base, structureWriteState: { ordinal: current.nextStructure, state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "structure_complete": {
      const state = current.structureWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateStructureWriteStateV1, { readonly state: "created" }>;
      const planned = rollbackPayloadSourceStructures(plan)[current.nextStructure] as RollbackPayloadStructureV1;
      const nextStructure = current.nextStructure + 1;
      next = { ...base, phase: nextStructure === SOURCE_STRUCTURE_COUNT ? "metadata_publishing" : "structure_staging", structureWriteState: null, nextStructure, structureIdentities: [...current.structureIdentities, { role: planned.role, path: planned.path, mode: 448, dev: created.dev, ino: created.ino }] };
      break;
    }
    case "metadata_intent":
      need(current.phase === "metadata_publishing" && current.metadataWriteState === null);
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "create_intent" } };
      break;
    case "metadata_created":
      need(current.phase === "metadata_publishing" && current.metadataWriteState?.state === "create_intent");
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "metadata_complete": {
      const state = current.metadataWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateSourceMetadataWriteStateV1, { readonly state: "created" }>;
      const nextMetadata = current.nextMetadata + 1;
      next = { ...base, phase: nextMetadata === 2 ? "payload_staging" : "metadata_publishing", metadataWriteState: null, nextMetadata, metadataIdentities: [...current.metadataIdentities, { ...(plan.metadata[current.nextMetadata] as RollbackPayloadSourceMetadataPlanV1), dev: created.dev, ino: created.ino }] };
      break;
    }
    case "ready_intent":
      need(current.phase === "payload_staging" && current.nextEntry === N && current.entryWriteState === null && current.readyWriteState === null);
      next = { ...base, readyWriteState: { state: "create_intent" } };
      break;
    case "ready_created":
      need(current.phase === "payload_staging" && current.readyWriteState?.state === "create_intent");
      next = { ...base, readyWriteState: { state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "ready_complete": {
      const state = current.readyWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateSourceReadyWriteStateV1, { readonly state: "created" }>;
      next = { ...base, phase: "source_ready", readyWriteState: null, readyIdentity: { dev: created.dev, ino: created.ino } };
      break;
    }
    case "compensate": {
      need(isRollbackPayloadSourceForward(current.phase) || current.phase === "source_ready");
      const top = entryTop(current.entryWriteState, current.nextEntry);
      next = top >= 0
        ? { ...base, phase: "compensating", compensationNext: top, compensationPart: "entry", compensationMetadataNext: null, compensationStructureNext: null }
        : { ...base, phase: "compensating", compensationNext: -1, compensationPart: null, ...afterEntryCompensation(current) };
      break;
    }
    case "ready_removed":
      need(current.phase === "compensating" && (current.readyWriteState !== null || current.readyIdentity !== null));
      next = { ...base, readyWriteState: null, readyIdentity: null };
      break;
    case "compensation_step": {
      need(current.phase === "compensating" && current.readyWriteState === null && current.readyIdentity === null);
      const at = current.compensationNext as number;
      const metadata = current.compensationMetadataNext;
      if (at >= 0) {
        const walked = nextEntryCompensation(at, current.compensationPart);
        next = { ...base, compensationNext: walked.at, compensationPart: walked.part, ...(walked.at === -1 ? afterEntryCompensation(current) : {}) };
      } else if (metadata !== null && metadata >= 0) {
        next = { ...base, compensationMetadataNext: metadata - 1, compensationStructureNext: metadata === 0 ? structureTop(current.structureWriteState, current.nextStructure) : null };
      } else {
        const structure = current.compensationStructureNext as number;
        next = structure >= 0 ? { ...base, compensationStructureNext: structure - 1 } : { ...base, phase: "rolled_back", entryWriteState: null, structureWriteState: null, metadataWriteState: null };
      }
      break;
    }
    case "compaction_step":
      if (current.phase === "source_ready") {
        next = { ...base, phase: "compacting", compactionNext: 0 };
        break;
      }
      need(current.phase === "compacting" && (current.compactionNext as number) < rollbackPayloadSourceCompactionEnd(plan));
      next = { ...base, compactionNext: (current.compactionNext as number) + 1 };
      break;
    default:
      return fail(label);
  }
  return validateRollbackPayloadSourceJournal(next, plan);
}

/** Flattened source compaction: ready; reverse entries target-then-evidence; metadata in reverse; structures in reverse. */
export function rollbackPayloadSourceCompactionTarget(plan: RollbackPayloadSourceStagingPlanV1, cursor: number): RollbackPayloadSourceCompactionTargetV1 {
  const N = plan.entryCount;
  const k = integer(cursor, 0, rollbackPayloadSourceCompactionEnd(plan) - 1, "compactionNext");
  if (k === 0) return { kind: "ready" };
  if (k <= 2 * N) return { kind: (k - 1) % 2 === 0 ? "entry" : "evidence", ordinal: N - 1 - Math.floor((k - 1) / 2) };
  if (k <= 2 * N + 2) return { kind: "metadata", ordinal: 1 - (k - 2 * N - 1) };
  return { kind: "structure", ordinal: SOURCE_STRUCTURE_COUNT - 1 - (k - 2 * N - 3) };
}

/** The compaction cursor's end: one past the last target of `rollbackPayloadSourceCompactionTarget`. */
export function rollbackPayloadSourceCompactionEnd(plan: RollbackPayloadSourceStagingPlanV1): number {
  return 2 * plan.entryCount + 10;
}

export function durableRollbackSourceEntryEvidence(plan: RollbackPayloadSourceStagingPlanV1, entry: RollbackPayloadEntryV1, dev: UInt64DecimalV1, ino: UInt64DecimalV1): DurableSourceEntryEvidenceV1 {
  integer(entry.ordinal, 0, plan.entryCount - 1, "source entry ordinal");
  return { schemaVersion: 1, coordinatorId: plan.coordinatorId, sourceKind: "rollback_payload", stagingPlanHash: rollbackPayloadSourceStagingPlanHash(plan), ordinal: entry.ordinal, pathHash: sha256Hex(encoder.encode(entry.path)), kind: "file", bytes: entry.bytes, sha256: entry.sha256, dev: parseUInt64Decimal(dev), ino: parseUInt64Decimal(ino) };
}

/** Complete evidence must be the one canonical object for its row; returns the entry identity it binds. */
export function validateDurableRollbackSourceEntryEvidence(bytes: Uint8Array, plan: RollbackPayloadSourceStagingPlanV1, entry: RollbackPayloadEntryV1): DurableSourceEntryEvidenceV1 {
  const found = decodeIdentity(bytes, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, "DurableSourceEntryEvidenceV1");
  const expected = durableRollbackSourceEntryEvidence(plan, entry, found.dev, found.ino);
  if (Buffer.compare(durableEntryEvidenceBytes(expected), bytes) !== 0) fail("DurableSourceEntryEvidenceV1: not the canonical evidence for its row");
  return expected;
}

/** Derived only from a journal whose every structure, metadata, and entry cursor is complete. */
export function rollbackPayloadSourceReadyEvidence(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, evidenceSetHash: LowerHexSha256): RollbackPayloadSourceReadyEvidenceV1 {
  const current = validateRollbackPayloadSourceJournal(journal, plan);
  if (current.nextStructure !== SOURCE_STRUCTURE_COUNT || current.nextMetadata !== 2 || current.nextEntry !== plan.entryCount || current.entryWriteState !== null) fail("RollbackPayloadSourceReadyEvidenceV1: source cursors are incomplete");
  const payloadRoot = current.structureIdentities[1] as UpdateDirectoryIdentityV1;
  return {
    schemaVersion: 1,
    coordinatorId: plan.coordinatorId,
    stagingPlanHash: rollbackPayloadSourceStagingPlanHash(plan),
    payloadId: plan.payloadId,
    rollbackBindingHash: plan.rollbackBindingHash,
    sourceRoot: plan.sourceRoot,
    sourceRootDev: payloadRoot.dev,
    sourceRootIno: payloadRoot.ino,
    structureIdentitiesHash: updateSourceStructuresHash(current.structureIdentities),
    inversePlanHash: plan.inversePlanHash,
    inventoryHash: plan.inventoryHash,
    evidenceSetHash: parseLowerHexSha256(evidenceSetHash),
    metadata: current.metadataIdentities as RollbackPayloadSourceReadyEvidenceV1["metadata"],
    entryCount: plan.entryCount,
    aggregateBytes: plan.aggregateBytes,
  };
}

export function rollbackPayloadSourceReadyEvidenceBytes(evidence: RollbackPayloadSourceReadyEvidenceV1): Uint8Array {
  const bytes = bytesOf(evidence);
  if (bytes.byteLength > MAXIMUM_SOURCE_READY_EVIDENCE_BYTES) fail("RollbackPayloadSourceReadyEvidenceV1: exceeds its bound");
  return bytes;
}

/** Exact bytes against the journal-derived object; `evidenceSetHash` is the caller's recomputation. */
export function validateRollbackPayloadSourceReadyEvidence(bytes: Uint8Array, plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, evidenceSetHash: LowerHexSha256): RollbackPayloadSourceReadyEvidenceV1 {
  exact(decodeCanonicalJson(bytes, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES), SOURCE_READY_KEYS, "RollbackPayloadSourceReadyEvidenceV1");
  const expected = rollbackPayloadSourceReadyEvidence(plan, journal, evidenceSetHash);
  if (Buffer.compare(rollbackPayloadSourceReadyEvidenceBytes(expected), bytes) !== 0) fail("RollbackPayloadSourceReadyEvidenceV1: not the derived ready evidence");
  return expected;
}

// ---------------------------------------------------------------------------------------------
// Rollback-payload state participant (publication, retained verification, retirement)
// ---------------------------------------------------------------------------------------------

export interface RollbackPayloadPublicationSourceV1 {
  readonly stagingPlan: ImmutableUpdatePlanRefV1<"rollback_payload_source">;
  readonly readyEvidencePath: CanonicalAbsolutePathV1;
}

export interface RollbackPayloadStatePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly retainedBefore: RollbackPayloadIdentityV1 | null;
  readonly publish: RollbackPayloadIdentityV1 | null;
  readonly source: RollbackPayloadPublicationSourceV1 | null;
  readonly retainAfter: RollbackPayloadIdentityV1 | null;
  readonly retireAtTerminal: readonly RollbackPayloadIdentityV1[];
  readonly publicationInventoryHash: LowerHexSha256 | null;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export type RollbackPayloadPublicationPhaseV1 =
  | "planned" | "structure_publishing" | "entries_publishing" | "metadata_publishing" | "verified"
  | "compensating_metadata" | "compensating_entries" | "compensating_structure"
  | "finalized" | "rolled_back" | "compacting";

export interface RollbackPayloadPublicationJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: RollbackPayloadPublicationPhaseV1;
  readonly nextStructure: number;
  readonly structureWriteState: UpdateStructureWriteStateV1 | null;
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[];
  readonly nextEntry: number;
  readonly entryWriteState: UpdateEntryWriteStateV1 | null;
  readonly nextMetadata: number;
  readonly metadataWriteState: UpdatePublicationMetadataWriteStateV1 | null;
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[];
  readonly compensationMetadataNext: number | null;
  readonly compensationNext: number | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export type RollbackPayloadPublicationStepV1 =
  | { readonly kind: "structure_intent" }
  /** A fresh exclusive create found its path present: the current create intent is withdrawn, so no recovery binds that path. */
  | { readonly kind: "create_refused" }
  | ({ readonly kind: "structure_created" } & Identity)
  | { readonly kind: "structure_complete" }
  | UpdateEntryStepV1
  | { readonly kind: "metadata_intent" }
  | ({ readonly kind: "metadata_published" } & Identity)
  | { readonly kind: "metadata_complete" }
  | { readonly kind: "retained_verified" }
  | { readonly kind: "compensate" }
  | { readonly kind: "compensation_step" }
  | { readonly kind: "finalize" }
  | { readonly kind: "compaction_step" };

const PUBLICATION_STRUCTURE_COUNT = 5;
const PUBLICATION_PHASES: readonly RollbackPayloadPublicationPhaseV1[] = ["planned", "structure_publishing", "entries_publishing", "metadata_publishing", "verified", "compensating_metadata", "compensating_entries", "compensating_structure", "finalized", "rolled_back", "compacting"];
const PUBLICATION_FORWARD: readonly RollbackPayloadPublicationPhaseV1[] = ["planned", "structure_publishing", "entries_publishing", "metadata_publishing", "verified"];
const STATE_PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "retainedBefore", "publish", "source", "retainAfter", "retireAtTerminal", "publicationInventoryHash", "maximumPlanBytes", "maximumJournalBytes"];
const PUBLICATION_JOURNAL_KEYS = ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextStructure", "structureWriteState", "structureIdentities", "nextEntry", "entryWriteState", "nextMetadata", "metadataWriteState", "metadataIdentities", "compensationMetadataNext", "compensationNext", "compensationPart", "compensationStructureNext", "compactionNext", "createdAt", "updatedAt"];

/** `staging/lifecycle/<coordinator-id>` gives the product home whose `rollback` holds every payload. */
export function productHomeOfStagingRoot(stagingRoot: CanonicalAbsolutePathV1, coordinatorId: LifecycleCoordinatorIdV1): CanonicalAbsolutePathV1 {
  const suffix = `/staging/lifecycle/${coordinatorId}`;
  if (!stagingRoot.endsWith(suffix)) fail("staging root: not this coordinator's");
  return parseCanonicalAbsolutePathText(stagingRoot.slice(0, -suffix.length));
}

function validateHomeIdentity(value: unknown, productHome: CanonicalAbsolutePathV1, label: string): RollbackPayloadIdentityV1 {
  const found = validateRollbackPayloadIdentity(value, label);
  if (found.root !== rollbackPayloadRoot(productHome, found.payloadId)) fail(`${label}.root: not under this product home`);
  return found;
}

/**
 * `update_apply` publishes a new payload from its ready source and retires the prior one at terminal
 * rotation; manual rollback publishes nothing, verifies the retained payload, and consumes it.
 */
export function validateRollbackPayloadStatePlan(value: unknown, stagingRoot: CanonicalAbsolutePathV1): RollbackPayloadStatePlanV1 {
  const label = "RollbackPayloadStatePlanV1";
  const input = exact(value, STATE_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(input.id);
  const coordinatorId = coordinatorOf(stagingRoot, input.coordinatorId, label);
  const home = productHomeOfStagingRoot(stagingRoot, coordinatorId);
  const identityOrNull = (field: string): RollbackPayloadIdentityV1 | null => (input[field] === null ? null : validateHomeIdentity(input[field], home, `${label}.${field}`));
  const retainedBefore = identityOrNull("retainedBefore");
  const publish = identityOrNull("publish");
  const retainAfter = identityOrNull("retainAfter");
  const retire = list(input.retireAtTerminal, 0, 1, `${label}.retireAtTerminal`).map((row) => validateHomeIdentity(row, home, `${label}.retireAtTerminal`));
  if (!sameCanonical(retire, retainedBefore === null ? [] : [retainedBefore])) fail(`${label}.retireAtTerminal: not exactly the retained-before payload`);
  if (publish === null) {
    if (input.source !== null || retainAfter !== null || input.publicationInventoryHash !== null || retainedBefore === null) fail(`${label}: a verify-only plan publishes and retains nothing new`);
  } else {
    const source = exact(input.source, ["stagingPlan", "readyEvidencePath"], `${label}.source`);
    const ref = exact(source.stagingPlan, ["kind", "id", "path", "hash", "bytes"], `${label}.source.stagingPlan`);
    const id = parseSafeReasonCode(ref.id);
    if (ref.kind !== "rollback_payload_source" || ref.path !== updateLeafPlanPath(stagingRoot, "rollback_payload_source", id)) fail(`${label}.source.stagingPlan`);
    parseLowerHexSha256(ref.hash);
    integer(ref.bytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.source.stagingPlan.bytes`);
    if (source.readyEvidencePath !== rollbackPayloadSourcePaths(stagingRoot, publish.payloadId).ready) fail(`${label}.source.readyEvidencePath`);
    if (publish.entryCount < 1 || !sameCanonical(retainAfter, publish) || input.publicationInventoryHash !== publish.inventoryHash) fail(`${label}: the published payload is the retained-after payload`);
    if (retainedBefore?.payloadId === publish.payloadId) fail(`${label}: publishes over the retained payload`);
  }
  checkPlanBounds(input, label);
  return input as unknown as RollbackPayloadStatePlanV1;
}

export function rollbackPayloadStatePlanBytes(plan: RollbackPayloadStatePlanV1): Uint8Array {
  return bytesOf(plan);
}

export function rollbackPayloadStatePlanHash(plan: RollbackPayloadStatePlanV1): LowerHexSha256 {
  return cachedPlanHash(plan, "rollback_payload_state");
}

export function rollbackPayloadStatePlanRef(plan: RollbackPayloadStatePlanV1, stagingRoot: CanonicalAbsolutePathV1): ImmutableUpdatePlanRefV1<"rollback_payload_state"> {
  return { kind: "rollback_payload_state", id: plan.id, path: updateLeafPlanPath(stagingRoot, "rollback_payload_state", plan.id), hash: rollbackPayloadStatePlanHash(plan), bytes: rollbackPayloadStatePlanBytes(plan).byteLength };
}

/** The publication's entry count: the published inventory's, or zero for a verify-only plan. */
export function rollbackPublicationEntryCount(plan: RollbackPayloadStatePlanV1): number {
  return plan.publish?.entryCount ?? 0;
}

export function initialRollbackPayloadPublicationJournal(plan: RollbackPayloadStatePlanV1, createdAt: UtcTimestampV1): RollbackPayloadPublicationJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    planHash: rollbackPayloadStatePlanHash(plan),
    phase: "planned",
    nextStructure: 0,
    structureWriteState: null,
    structureIdentities: [],
    nextEntry: 0,
    entryWriteState: null,
    nextMetadata: 0,
    metadataWriteState: null,
    metadataIdentities: [],
    compensationMetadataNext: null,
    compensationNext: null,
    compensationPart: null,
    compensationStructureNext: null,
    compactionNext: null,
    createdAt: parseUtcTimestamp(createdAt),
    updatedAt: createdAt,
  };
}

export function rollbackPayloadPublicationJournalBytes(journal: RollbackPayloadPublicationJournalV1): Uint8Array {
  return bytesOf(journal);
}

export function isRollbackPayloadPublicationForward(phase: RollbackPayloadPublicationPhaseV1): boolean {
  return PUBLICATION_FORWARD.includes(phase);
}

export function validateRollbackPayloadPublicationJournal(value: unknown, plan: RollbackPayloadStatePlanV1): RollbackPayloadPublicationJournalV1 {
  const label = "RollbackPayloadPublicationJournalV1";
  const input = exact(value, PUBLICATION_JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== rollbackPayloadStatePlanHash(plan)) fail(`${label}.planHash`);
  const phase = oneOf(input.phase, PUBLICATION_PHASES, `${label}.phase`);
  const publish = plan.publish;
  const N = rollbackPublicationEntryCount(plan);
  const nextStructure = integer(input.nextStructure, 0, PUBLICATION_STRUCTURE_COUNT, `${label}.nextStructure`);
  const structureState = checkStructureState(input.structureWriteState, nextStructure, PUBLICATION_STRUCTURE_COUNT, `${label}.structureWriteState`);
  const identities = checkDirectoryIdentities(input.structureIdentities, publish === null ? [] : rollbackPayloadStructures(publish.root), `${label}.structureIdentities`);
  if (identities.length !== nextStructure) fail(`${label}.structureIdentities: not the reached prefix`);
  const nextEntry = integer(input.nextEntry, 0, N, `${label}.nextEntry`);
  const entryState = checkEntryState(input.entryWriteState, nextEntry, N, `${label}.entryWriteState`);
  const nextMetadata = integer(input.nextMetadata, 0, 2, `${label}.nextMetadata`);
  let metadataState: UpdatePublicationMetadataWriteStateV1 | null = null;
  if (input.metadataWriteState !== null) {
    const state = record(input.metadataWriteState, `${label}.metadataWriteState`);
    const kind = oneOf(state.state, ["publish_intent", "published"] as const, `${label}.metadataWriteState.state`);
    identity(state, kind === "publish_intent" ? ["ordinal", "state"] : ["ordinal", "state", "dev", "ino"], `${label}.metadataWriteState`);
    if (state.ordinal !== nextMetadata || nextMetadata >= 2) fail(`${label}.metadataWriteState.ordinal`);
    metadataState = state as unknown as UpdatePublicationMetadataWriteStateV1;
  }
  const metadataRows = list(input.metadataIdentities, 0, 2, `${label}.metadataIdentities`);
  metadataRows.forEach((row, index) => {
    if (identity(row, ["ordinal", "dev", "ino"], `${label}.metadataIdentities`).ordinal !== index) fail(`${label}.metadataIdentities: not contiguous`);
  });
  if (metadataRows.length !== nextMetadata) fail(`${label}.metadataIdentities: not the reached prefix`);
  const compMetadata = nullableInteger(input.compensationMetadataNext, -1, 1, `${label}.compensationMetadataNext`);
  const compensation = nullableInteger(input.compensationNext, -1, Math.max(N - 1, -1), `${label}.compensationNext`);
  const part = input.compensationPart === null ? null : oneOf(input.compensationPart, ["entry", "evidence"] as const, `${label}.compensationPart`);
  const compStructure = nullableInteger(input.compensationStructureNext, -1, PUBLICATION_STRUCTURE_COUNT - 1, `${label}.compensationStructureNext`);
  const compaction = nullableInteger(input.compactionNext, 0, N, `${label}.compactionNext`);
  const { createdAt, updatedAt } = checkTimestamps(input, label);

  const writing = structureState !== null || entryState !== null || metadataState !== null;
  // A verify-only plan never writes, so it has no forward cursor, write state, or compensation cursor.
  if (publish === null && (nextStructure !== 0 || nextEntry !== 0 || nextMetadata !== 0 || writing || compMetadata !== null || compensation !== null || compStructure !== null)) fail(`${label}: verify-only with a mutation cursor`);
  const noCompensation = compMetadata === null && compensation === null && part === null && compStructure === null;
  const clean = noCompensation && compaction === null;
  const structuresDone = nextStructure === PUBLICATION_STRUCTURE_COUNT && structureState === null;
  const entriesDone = structuresDone && nextEntry === N && entryState === null;
  const complete = publish === null || (entriesDone && nextMetadata === 2 && metadataState === null);
  const structureReached = createdTop(structureState, nextStructure, "created");
  let legal: boolean;
  switch (phase) {
    case "planned":
      legal = clean && nextStructure === 0 && !writing && nextEntry === 0 && nextMetadata === 0 && updatedAt === createdAt;
      break;
    case "structure_publishing":
      legal = clean && publish !== null && nextStructure < PUBLICATION_STRUCTURE_COUNT && nextEntry === 0 && entryState === null && nextMetadata === 0 && metadataState === null;
      break;
    case "entries_publishing":
      legal = clean && publish !== null && structuresDone && nextEntry < N && nextMetadata === 0 && metadataState === null;
      break;
    case "metadata_publishing":
      legal = clean && publish !== null && entriesDone && nextMetadata < 2;
      break;
    case "verified":
    case "finalized":
      legal = clean && complete;
      break;
    case "compensating_metadata":
      legal = publish !== null && compaction === null && compMetadata !== null && compMetadata <= createdTop(metadataState, nextMetadata, "published") && compensation === null && part === null && compStructure === null;
      break;
    case "compensating_entries":
      legal = publish !== null && compaction === null && compMetadata === -1 && compensation !== null && compensation <= entryTop(entryState, nextEntry) && (compensation >= 0) === (part !== null) && compStructure === null;
      break;
    case "compensating_structure":
      legal = publish !== null && compaction === null && compMetadata === -1 && compensation === -1 && part === null && compStructure !== null && compStructure <= structureReached;
      break;
    case "rolled_back":
      // W2-ROLLBACK-5: as in the source journal, rolled back clears every write state.
      legal = compaction === null && !writing && (publish !== null ? compMetadata === -1 && compensation === -1 && part === null && compStructure === -1 : noCompensation);
      break;
    case "compacting":
      legal = noCompensation && complete && compaction !== null;
      break;
  }
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return input as unknown as RollbackPayloadPublicationJournalV1;
}

/** The single legal successor of a publication journal; throws on any phase/cursor leap. */
export function advanceRollbackPayloadPublicationJournal(plan: RollbackPayloadStatePlanV1, journal: RollbackPayloadPublicationJournalV1, step: RollbackPayloadPublicationStepV1, updatedAt: UtcTimestampV1): RollbackPayloadPublicationJournalV1 {
  const label = `RollbackPayloadPublicationStepV1(${step.kind})`;
  const current = validateRollbackPayloadPublicationJournal(journal, plan);
  if (parseUtcTimestamp(updatedAt) < current.updatedAt) fail(`${label}: time moved backwards`);
  const N = rollbackPublicationEntryCount(plan);
  const publish = plan.publish;
  const base = { ...current, updatedAt };
  const need = (condition: boolean): void => {
    if (!condition) fail(label);
  };
  if (isEntryStep(step)) {
    const entry = advanceEntry(current.entryWriteState, current.nextEntry, step, need) as { readonly state: UpdateEntryWriteStateV1 | null; readonly complete: boolean };
    need(publish !== null && current.phase === "entries_publishing");
    const nextEntry = current.nextEntry + (entry.complete ? 1 : 0);
    return validateRollbackPayloadPublicationJournal({ ...base, phase: nextEntry === N ? "metadata_publishing" : "entries_publishing", entryWriteState: entry.state, nextEntry }, plan);
  }
  let next: RollbackPayloadPublicationJournalV1;
  switch (step.kind) {
    case "structure_intent":
      need(publish !== null && (current.phase === "planned" || current.phase === "structure_publishing") && current.structureWriteState === null);
      next = { ...base, phase: "structure_publishing", structureWriteState: { ordinal: current.nextStructure, state: "create_intent" } };
      break;
    case "create_refused": {
      // The one current create intent returns to its predecessor; a later pass creates again and refuses again.
      const entry = withdrawEntryIntent(current.entryWriteState);
      // Only a forward publishing phase owns a create intent it may withdraw; compensation consumes its own.
      if (current.structureWriteState?.state === "create_intent") {
        need(publish !== null && current.phase === "structure_publishing");
        next = { ...base, structureWriteState: null };
      } else if (entry !== null) {
        need(publish !== null && current.phase === "entries_publishing");
        next = { ...base, entryWriteState: entry.state };
      } else {
        need(publish !== null && current.phase === "metadata_publishing" && current.metadataWriteState?.state === "publish_intent");
        next = { ...base, metadataWriteState: null };
      }
      break;
    }
    case "structure_created":
      need(current.phase === "structure_publishing" && current.structureWriteState?.state === "create_intent");
      next = { ...base, structureWriteState: { ordinal: current.nextStructure, state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "structure_complete": {
      const state = current.structureWriteState;
      need(publish !== null && state?.state === "created");
      const created = state as Extract<UpdateStructureWriteStateV1, { readonly state: "created" }>;
      const planned = rollbackPayloadStructures((publish as RollbackPayloadIdentityV1).root)[current.nextStructure] as RollbackPayloadStructureV1;
      const nextStructure = current.nextStructure + 1;
      next = { ...base, phase: nextStructure === PUBLICATION_STRUCTURE_COUNT ? "entries_publishing" : "structure_publishing", structureWriteState: null, nextStructure, structureIdentities: [...current.structureIdentities, { role: planned.role, path: planned.path, mode: 448, dev: created.dev, ino: created.ino }] };
      break;
    }
    case "metadata_intent":
      need(current.phase === "metadata_publishing" && current.metadataWriteState === null);
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "publish_intent" } };
      break;
    case "metadata_published":
      need(current.phase === "metadata_publishing" && current.metadataWriteState?.state === "publish_intent");
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "published", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "metadata_complete": {
      const state = current.metadataWriteState;
      need(state?.state === "published");
      const published = state as Extract<UpdatePublicationMetadataWriteStateV1, { readonly state: "published" }>;
      const nextMetadata = current.nextMetadata + 1;
      next = { ...base, phase: nextMetadata === 2 ? "verified" : "metadata_publishing", metadataWriteState: null, nextMetadata, metadataIdentities: [...current.metadataIdentities, { ordinal: current.nextMetadata, dev: published.dev, ino: published.ino }] };
      break;
    }
    case "retained_verified":
      need(publish === null && current.phase === "planned");
      next = { ...base, phase: "verified" };
      break;
    case "compensate":
      need(isRollbackPayloadPublicationForward(current.phase));
      next = publish !== null
        ? { ...base, phase: "compensating_metadata", compensationMetadataNext: createdTop(current.metadataWriteState, current.nextMetadata, "published") }
        : { ...base, phase: "rolled_back" };
      break;
    case "compensation_step": {
      if (current.phase === "compensating_metadata") {
        const at = current.compensationMetadataNext as number;
        if (at >= 0) next = { ...base, compensationMetadataNext: at - 1 };
        else {
          const top = entryTop(current.entryWriteState, current.nextEntry);
          next = { ...base, phase: "compensating_entries", compensationNext: top, compensationPart: top >= 0 ? "entry" : null };
        }
      } else if (current.phase === "compensating_entries") {
        const at = current.compensationNext as number;
        if (at >= 0) {
          const walked = nextEntryCompensation(at, current.compensationPart);
          next = { ...base, compensationNext: walked.at, compensationPart: walked.part };
        } else next = { ...base, phase: "compensating_structure", compensationStructureNext: createdTop(current.structureWriteState, current.nextStructure, "created") };
      } else {
        need(current.phase === "compensating_structure");
        const at = current.compensationStructureNext as number;
        next = at >= 0 ? { ...base, compensationStructureNext: at - 1 } : { ...base, phase: "rolled_back", entryWriteState: null, structureWriteState: null, metadataWriteState: null };
      }
      break;
    }
    case "finalize":
      need(current.phase === "verified");
      next = { ...base, phase: "finalized" };
      break;
    case "compaction_step":
      if (current.phase === "finalized") {
        next = { ...base, phase: "compacting", compactionNext: 0 };
        break;
      }
      need(current.phase === "compacting" && (current.compactionNext as number) < N);
      next = { ...base, compactionNext: (current.compactionNext as number) + 1 };
      break;
    default:
      return fail(label);
  }
  return validateRollbackPayloadPublicationJournal(next, plan);
}

export function rollbackPublicationEvidenceDirectory(stagingRoot: CanonicalAbsolutePathV1, id: SafeReasonCodeV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/evidence/publication/rollback_payload_state/${parseSafeReasonCode(id)}`);
}

export function rollbackPublicationEvidencePath(stagingRoot: CanonicalAbsolutePathV1, plan: RollbackPayloadStatePlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${rollbackPublicationEvidenceDirectory(stagingRoot, plan.id)}/${encodeTenDigitOrdinal(integer(ordinal, 0, rollbackPublicationEntryCount(plan) - 1, "publication entry ordinal"))}.json`);
}

/** Compaction cursor `k` removes publication evidence ordinal `entryCount - 1 - k`. */
export function rollbackPublicationCompactionOrdinal(plan: RollbackPayloadStatePlanV1, cursor: number): number {
  const N = rollbackPublicationEntryCount(plan);
  return N - 1 - integer(cursor, 0, N - 1, "compactionNext");
}

export function durableRollbackPublicationEntryEvidence(plan: RollbackPayloadStatePlanV1, entry: RollbackPayloadEntryV1, dev: UInt64DecimalV1, ino: UInt64DecimalV1): DurablePublicationEntryEvidenceV1 {
  integer(entry.ordinal, 0, rollbackPublicationEntryCount(plan) - 1, "publication entry ordinal");
  return { schemaVersion: 1, coordinatorId: plan.coordinatorId, participantKind: "rollback_payload_state", participantPlanHash: rollbackPayloadStatePlanHash(plan), ordinal: entry.ordinal, pathHash: sha256Hex(encoder.encode(entry.path)), kind: "file", bytes: entry.bytes, sha256: entry.sha256, dev: parseUInt64Decimal(dev), ino: parseUInt64Decimal(ino) };
}

export function validateDurableRollbackPublicationEntryEvidence(bytes: Uint8Array, plan: RollbackPayloadStatePlanV1, entry: RollbackPayloadEntryV1): DurablePublicationEntryEvidenceV1 {
  const found = decodeIdentity(bytes, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, "DurablePublicationEntryEvidenceV1");
  const expected = durableRollbackPublicationEntryEvidence(plan, entry, found.dev, found.ino);
  if (Buffer.compare(durableEntryEvidenceBytes(expected), bytes) !== 0) fail("DurablePublicationEntryEvidenceV1: not the canonical evidence for its row");
  return expected;
}

/** The inventory a retained or published identity binds, from its exact `inventory.json` bytes. */
export function decodeRollbackPayloadInventory(bytes: Uint8Array, payloadIdentity: RollbackPayloadIdentityV1): RollbackPayloadInventoryV1 {
  if (rollbackDocumentHash(bytes) !== payloadIdentity.inventoryHash) fail("RollbackPayloadInventoryV1: not the identity's bytes");
  const value = decodeCanonicalJson(bytes, MAXIMUM_ROLLBACK_DOCUMENT_BYTES);
  if (Buffer.compare(bytesOf(value), bytes) !== 0) fail("RollbackPayloadInventoryV1: not canonical");
  const inventory = validateRollbackPayloadInventory(value);
  checkInventoryForIdentity(payloadIdentity, inventory);
  return inventory;
}
