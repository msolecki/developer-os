import { createHash } from "node:crypto";

import { decodeCanonicalJson, encodeCanonicalJson, hashCanonicalJsonNoLf, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { MAXIMUM_LEAF_PLAN_BYTES, MAXIMUM_PARTICIPANT_JOURNAL_BYTES, updateLeafPlanPath, type ImmutableUpdatePlanRefV1, type UpdateLeafPlanKindV1 } from "./construction.js";
import { deriveCanonicalStatePayloadPath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type CanonicalStatePayloadPathV1 } from "./paths.js";
import { compareUtf8, parseBundleRelativePath, type BundleRelativePathV1, type ReleaseBundleEntryV1, type ReleaseIdentityV1 } from "./release.js";
import {
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseStableSemver,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "./scalars.js";

export type UpdateDirectoryRoleV1 =
  | "source_envelope" | "source_payload_root" | "source_evidence_root"
  | "rollback_payload_root" | "target_bundle_root" | "plans_root"
  | "owner_inverse_plans_root" | "schema_migration_inverse_plans_root" | "blobs_root";

export interface UpdateDirectoryIdentityV1 {
  readonly role: UpdateDirectoryRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly mode: 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface DurableSourceEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly sourceKind: "bundle" | "rollback_payload";
  readonly stagingPlanHash: LowerHexSha256;
  readonly ordinal: number;
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly bytes: number;
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface DurablePublicationEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly participantKind: "bundle_publication" | "rollback_payload_state";
  readonly participantPlanHash: LowerHexSha256;
  readonly ordinal: number;
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly bytes: number;
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

/** Structure/root create microstates; the ordinal range is the owning journal's structure count. */
export type UpdateStructureWriteStateV1 =
  | { readonly ordinal: number; readonly state: "create_intent" }
  | { readonly ordinal: number; readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
export type UpdateSourceStructureWriteStateV1 = UpdateStructureWriteStateV1;
export type UpdatePublicationStructureWriteStateV1 = UpdateStructureWriteStateV1;

/** Source and publication entries share one four-state microprotocol. */
export type UpdateEntryWriteStateV1 =
  | { readonly ordinal: number; readonly state: "entry_intent" }
  | { readonly ordinal: number; readonly state: "entry_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: number; readonly state: "evidence_intent"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: number; readonly state: "evidence_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };
export type UpdateSourceEntryWriteStateV1 = UpdateEntryWriteStateV1;
export type UpdatePublicationEntryWriteStateV1 = UpdateEntryWriteStateV1;

export type UpdateSourceReadyWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface UpdateSourceReadyIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type UpdatePublicationMetadataWriteStateV1 =
  | { readonly ordinal: number; readonly state: "publish_intent" }
  | { readonly ordinal: number; readonly state: "published"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface UpdatePublishedMetadataIdentityV1 {
  readonly ordinal: number;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BundleSourceStagingPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootBefore: { readonly state: "absent" };
  readonly entries: readonly ReleaseBundleEntryV1[];
  readonly inventoryHash: LowerHexSha256;
  readonly aggregateBytes: number;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export type BundleSourceStagingPhaseV1 = "planned" | "structure_staging" | "entries_staging" | "source_ready" | "compensating" | "rolled_back" | "compacting";

export interface BundleSourceStagingJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: BundleSourceStagingPhaseV1;
  readonly nextStructure: number;
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[];
  readonly structureWriteState: UpdateSourceStructureWriteStateV1 | null;
  readonly nextEntry: number;
  readonly entryWriteState: UpdateSourceEntryWriteStateV1 | null;
  readonly readyWriteState: UpdateSourceReadyWriteStateV1 | null;
  readonly readyIdentity: UpdateSourceReadyIdentityV1 | null;
  readonly compensationNext: number | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationStructureNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface BundleSourceReadyEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly stagingPlanHash: LowerHexSha256;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly sourceRootDev: UInt64DecimalV1;
  readonly sourceRootIno: UInt64DecimalV1;
  readonly structureIdentitiesHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly evidenceSetHash: LowerHexSha256;
  readonly entryCount: number;
  readonly aggregateBytes: number;
}

export type BundlePublicationSourceV1 =
  | {
      readonly kind: "staged_source";
      readonly stagingPlan: ImmutableUpdatePlanRefV1<"bundle_source_staging">;
      readonly readyEvidencePath: CanonicalAbsolutePathV1;
    }
  | {
      readonly kind: "retained_bundle";
      readonly root: CanonicalAbsolutePathV1;
      readonly rootDev: UInt64DecimalV1;
      readonly rootIno: UInt64DecimalV1;
      readonly inventoryHash: LowerHexSha256;
      readonly entryCount: number;
      readonly aggregateBytes: number;
    };

/**
 * Spec 2 §9.2's `StatePayloadRefV1`, `CanonicalStateFileStateV1` and `CanonicalStateFilePlanV1`,
 * narrowed to the `release_metadata` role. Named for this participant so a parallel state-participant
 * task can own the generic names; the shapes are byte-identical.
 */
export interface BundleStatePayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: number;
  readonly path: CanonicalStatePayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 384;
}

/** Amended 2026-09-23 (D60): only the guarded preimage carries a device/inode. */
export type BundleMetadataPreimageV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly payload: null;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly size: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

/**
 * A published postimage takes its device/inode only from the reopened construction evidence of
 * `payload`; the null payload is the byte-identical present→present row, whose identity is the
 * preimage's.
 */
export type BundleMetadataPostimageV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly payload: BundleStatePayloadRefV1 | null;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly size: number;
    };

export type BundleMetadataFileStateV1 = BundleMetadataPreimageV1 | BundleMetadataPostimageV1;

export type PresentBundleMetadataFileStateV1 = Extract<BundleMetadataFileStateV1, { readonly state: "present" }>;
export type PresentBundleMetadataPreimageV1 = Extract<BundleMetadataPreimageV1, { readonly state: "present" }>;
export type PresentBundleMetadataPostimageV1 = Extract<BundleMetadataPostimageV1, { readonly state: "present" }>;

export interface BundleMetadataStatePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly role: "release_metadata";
  readonly path: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: BundleMetadataPreimageV1;
  readonly after: BundleMetadataPostimageV1;
  readonly reversal: "reversible";
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export interface BundlePublicationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly action: "publish_target" | "verify_previous";
  readonly target: ReleaseIdentityV1;
  readonly source: BundlePublicationSourceV1;
  readonly targetRootBefore:
    | { readonly state: "absent" }
    | { readonly state: "present"; readonly inventoryHash: LowerHexSha256; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
  readonly metadata: readonly [BundleMetadataStatePlanV1, BundleMetadataStatePlanV1, BundleMetadataStatePlanV1];
  readonly entries: readonly ReleaseBundleEntryV1[];
  readonly inventoryHash: LowerHexSha256;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export type BundlePublicationPhaseV1 =
  | "planned" | "root_publishing" | "entries_publishing" | "metadata_publishing" | "verified"
  | "compensating_metadata" | "compensating_entries" | "compensating_root"
  | "finalized" | "rolled_back" | "compacting";

export interface BundlePublicationJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: BundlePublicationPhaseV1;
  readonly nextRootTransition: number;
  readonly rootWriteState: UpdatePublicationStructureWriteStateV1 | null;
  readonly targetRootIdentity: UpdateDirectoryIdentityV1 | null;
  readonly nextEntry: number;
  readonly entryWriteState: UpdatePublicationEntryWriteStateV1 | null;
  readonly nextMetadata: number;
  readonly metadataWriteState: UpdatePublicationMetadataWriteStateV1 | null;
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[];
  readonly compensationMetadataNext: number | null;
  readonly compensationNext: number | null;
  readonly compensationPart: "entry" | "evidence" | null;
  readonly compensationRootNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export type Identity = { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

/** Entry microsteps shared by both journals; the next journal is derived, never supplied. */
export type UpdateEntryStepV1 =
  | { readonly kind: "entry_intent" }
  | ({ readonly kind: "entry_created" } & Identity)
  | { readonly kind: "evidence_intent" }
  | ({ readonly kind: "evidence_created" } & Identity)
  | { readonly kind: "entry_complete" };

export type BundleSourceStepV1 =
  | { readonly kind: "structure_intent" }
  | ({ readonly kind: "structure_created" } & Identity)
  | { readonly kind: "structure_complete" }
  | UpdateEntryStepV1
  | { readonly kind: "ready_intent" }
  | ({ readonly kind: "ready_created" } & Identity)
  | { readonly kind: "ready_complete" }
  | { readonly kind: "compensate" }
  | { readonly kind: "ready_removed" }
  | { readonly kind: "compensation_step" }
  | { readonly kind: "compaction_step" };

export type BundlePublicationStepV1 =
  | { readonly kind: "root_intent" }
  | ({ readonly kind: "root_created" } & Identity)
  | { readonly kind: "root_complete" }
  | { readonly kind: "root_verified" }
  | UpdateEntryStepV1
  | { readonly kind: "entry_verified" }
  | { readonly kind: "metadata_intent" }
  | ({ readonly kind: "metadata_published" } & Identity)
  | { readonly kind: "metadata_complete" }
  | { readonly kind: "metadata_verified" }
  | { readonly kind: "compensate" }
  | { readonly kind: "compensation_step" }
  | { readonly kind: "finalize" }
  | { readonly kind: "compaction_step" };

export type BundleSourceCompactionTargetV1 =
  | { readonly kind: "ready" }
  | { readonly kind: "entry" | "evidence"; readonly ordinal: number }
  | { readonly kind: "structure"; readonly ordinal: number };

export const MAXIMUM_BUNDLE_ENTRIES = 200_000;
export const MAXIMUM_SOURCE_READY_EVIDENCE_BYTES = 16_384;
export const MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES = 1024;
export const MAXIMUM_BUNDLE_FILE_BYTES = 536_870_912;
const MAXIMUM_AGGREGATE_BYTES = 8_589_934_592;
const MAXIMUM_METADATA_BYTES = 67_108_864;
const SOURCE_STRUCTURES: readonly UpdateDirectoryRoleV1[] = ["source_envelope", "source_payload_root", "source_evidence_root"];
const METADATA_STORES = ["delegations", "indexes", "bundles"] as const;
const SOURCE_PHASES: readonly BundleSourceStagingPhaseV1[] = ["planned", "structure_staging", "entries_staging", "source_ready", "compensating", "rolled_back", "compacting"];
const PUBLICATION_PHASES: readonly BundlePublicationPhaseV1[] = ["planned", "root_publishing", "entries_publishing", "metadata_publishing", "verified", "compensating_metadata", "compensating_entries", "compensating_root", "finalized", "rolled_back", "compacting"];
const PUBLICATION_FORWARD: readonly BundlePublicationPhaseV1[] = ["planned", "root_publishing", "entries_publishing", "metadata_publishing", "verified"];
const SOURCE_PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "sourceRoot", "evidenceRoot", "sourceRootBefore", "entries", "inventoryHash", "aggregateBytes", "maximumPlanBytes", "maximumJournalBytes"];
const SOURCE_JOURNAL_KEYS = ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextStructure", "structureIdentities", "structureWriteState", "nextEntry", "entryWriteState", "readyWriteState", "readyIdentity", "compensationNext", "compensationPart", "compensationStructureNext", "compactionNext", "createdAt", "updatedAt"];
const PUBLICATION_PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "action", "target", "source", "targetRootBefore", "metadata", "entries", "inventoryHash", "maximumPlanBytes", "maximumJournalBytes"];
const PUBLICATION_JOURNAL_KEYS = ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextRootTransition", "rootWriteState", "targetRootIdentity", "nextEntry", "entryWriteState", "nextMetadata", "metadataWriteState", "metadataIdentities", "compensationMetadataNext", "compensationNext", "compensationPart", "compensationRootNext", "compactionNext", "createdAt", "updatedAt"];
const METADATA_PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "role", "path", "tombstonePath", "before", "after", "reversal", "maximumPlanBytes", "maximumJournalBytes"];
const IDENTITY_KEYS = ["version", "releaseSequence", "releaseIdentityHash", "delegationSequence", "delegationHash", "releaseIndexSequence", "releaseIndexHash", "bundleManifestHash", "bundleRoot", "platform", "architecture", "launcherProtocol", "updateProtocol"];
const READY_KEYS = ["schemaVersion", "coordinatorId", "stagingPlanHash", "sourceRoot", "sourceRootDev", "sourceRootIno", "structureIdentitiesHash", "inventoryHash", "evidenceSetHash", "entryCount", "aggregateBytes"];
const encoder = new TextEncoder();
/** Plans are immutable once validated; re-encoding up to 16 MiB per journal transition would be quadratic. */
const PLAN_HASHES = new WeakMap<object, LowerHexSha256>();

// The codec helpers and journal microstate checks below are shared with rollback.ts, whose source
// and publication journals reuse the same structure/entry protocol. index.ts does not re-export them.
export function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

export function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return value as Readonly<Record<string, unknown>>;
}

export function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = record(value, label);
  const present = Object.keys(input);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) fail(`${label}: keys`);
  return input;
}

export function list(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(label);
  return value as readonly unknown[];
}

export function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

export function nullableInteger(value: unknown, minimum: number, maximum: number, label: string): number | null {
  return value === null ? null : integer(value, minimum, maximum, label);
}

export function oneOf<T>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) fail(label);
  return value as T;
}

export function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

export function sha256Hex(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}


export function identity(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = exact(value, keys, label);
  for (const key of keys) if (key === "dev" || key === "ino" || key === "evidenceDev" || key === "evidenceIno") parseUInt64Decimal(input[key]);
  return input;
}

export function coordinatorOf(stagingRoot: CanonicalAbsolutePathV1, coordinatorId: unknown, label: string): LifecycleCoordinatorIdV1 {
  if (typeof coordinatorId !== "string" || !stagingRoot.endsWith(`/staging/lifecycle/${coordinatorId}`)) fail(`${label}.coordinatorId: not this staging root's coordinator`);
  return coordinatorId as LifecycleCoordinatorIdV1;
}

/** Spec 2 §9.2: `developer-os/update-leaf/<kind>/v1\0` plus the canonical JSON-plus-LF bytes. */
export function updateLeafPlanHash(kind: UpdateLeafPlanKindV1, bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(`developer-os/update-leaf/${kind}/v1\0`, "ascii").update(bytes).digest("hex") as LowerHexSha256;
}

export interface BundleSourcePathsV1 {
  /** `update/source/bundle`: a construction directory; its identity comes only from the construction journal. */
  readonly parent: CanonicalAbsolutePathV1;
  readonly envelope: CanonicalAbsolutePathV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly evidenceRoot: CanonicalAbsolutePathV1;
  /** The envelope's sibling `<id>.ready.json`. */
  readonly ready: CanonicalAbsolutePathV1;
}

export function bundleSourcePaths(stagingRoot: CanonicalAbsolutePathV1, id: SafeReasonCodeV1): BundleSourcePathsV1 {
  const parent = `${stagingRoot}/update/source/bundle`;
  const envelope = `${parent}/${parseSafeReasonCode(id)}`;
  return {
    parent: parseCanonicalAbsolutePathText(parent),
    envelope: parseCanonicalAbsolutePathText(envelope),
    sourceRoot: parseCanonicalAbsolutePathText(`${envelope}/payload`),
    evidenceRoot: parseCanonicalAbsolutePathText(`${envelope}/evidence`),
    ready: parseCanonicalAbsolutePathText(`${envelope}.ready.json`),
  };
}

/** The three structure paths in their fixed `source_envelope`, payload, evidence order. */
export function bundleSourceStructures(plan: BundleSourceStagingPlanV1): readonly { readonly role: UpdateDirectoryRoleV1; readonly path: CanonicalAbsolutePathV1 }[] {
  const envelope = parseCanonicalAbsolutePathText(plan.sourceRoot.slice(0, plan.sourceRoot.lastIndexOf("/")));
  return [envelope, plan.sourceRoot, plan.evidenceRoot].map((path, ordinal) => ({ role: SOURCE_STRUCTURES[ordinal] as UpdateDirectoryRoleV1, path }));
}

export function bundleSourceEvidencePath(plan: BundleSourceStagingPlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.evidenceRoot}/${encodeTenDigitOrdinal(integer(ordinal, 0, plan.entries.length - 1, "source entry ordinal"))}.json`);
}

export function bundlePublicationEvidenceDirectory(stagingRoot: CanonicalAbsolutePathV1, id: SafeReasonCodeV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/evidence/publication/bundle_publication/${parseSafeReasonCode(id)}`);
}

export function bundlePublicationEvidencePath(stagingRoot: CanonicalAbsolutePathV1, plan: BundlePublicationPlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${bundlePublicationEvidenceDirectory(stagingRoot, plan.id)}/${encodeTenDigitOrdinal(integer(ordinal, 0, plan.entries.length - 1, "publication entry ordinal"))}.json`);
}

/** No spec formula exists for the bundle inventory hash; this is the one domain every side recomputes. */
export function bundleInventoryHash(entries: readonly ReleaseBundleEntryV1[]): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/update-bundle-inventory/v1", entries);
}

export function bundleAggregateBytes(entries: readonly ReleaseBundleEntryV1[]): number {
  let total = 0;
  for (const entry of entries) if (entry.kind === "file") total += Number(entry.bytes);
  return total;
}

/** `developer-os/update-source-structures/v1\0` plus the canonical complete identity array. */
export function updateSourceStructuresHash(identities: readonly UpdateDirectoryIdentityV1[]): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/update-source-structures/v1", identities);
}

/** `developer-os/update-source-evidence-set/v1\0` plus the ordered SHA-256s of the exact evidence-file bytes. */
export function updateSourceEvidenceSetHash(evidenceFileHashes: readonly LowerHexSha256[]): LowerHexSha256 {
  if (evidenceFileHashes.length < 1) fail("evidence set: empty");
  return hashCanonicalJsonNoLf("developer-os/update-source-evidence-set/v1", evidenceFileHashes);
}

/** Sorted, unique (exact and folded), parent-before-child, bounded per file and in aggregate. */
function validateBundleEntries(value: unknown, label: string): readonly ReleaseBundleEntryV1[] {
  const rows = list(value, 1, MAXIMUM_BUNDLE_ENTRIES, label);
  const seen = new Set<string>();
  const directories = new Set<string>();
  let total = 0;
  let prior: string | null = null;
  return rows.map((row, index) => {
    const rowLabel = `${label}[${index.toString(10)}]`;
    const input = record(row, rowLabel);
    const path: BundleRelativePathV1 = parseBundleRelativePath(input.path);
    let entry: ReleaseBundleEntryV1;
    if (input.kind === "directory") {
      exact(input, ["path", "kind", "mode"], rowLabel);
      if (input.mode !== 448) fail(`${rowLabel}.mode`);
      entry = { path, kind: "directory", mode: 448 };
      directories.add(path);
    } else {
      exact(input, ["path", "kind", "mode", "bytes", "sha256"], rowLabel);
      if (input.kind !== "file") fail(`${rowLabel}.kind`);
      const mode = oneOf(input.mode, [384, 448] as const, `${rowLabel}.mode`);
      const bytes = parseUInt64Decimal(input.bytes);
      if (BigInt(bytes) > BigInt(MAXIMUM_BUNDLE_FILE_BYTES)) fail(`${rowLabel}.bytes`);
      total += Number(bytes);
      if (total > MAXIMUM_AGGREGATE_BYTES) fail(`${label}: aggregate bytes`);
      entry = { path, kind: "file", mode, bytes, sha256: parseLowerHexSha256(input.sha256) };
    }
    const folded = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(path) || seen.has(folded) || (prior !== null && compareUtf8(prior, path) >= 0)) fail(`${rowLabel}: order`);
    seen.add(path);
    seen.add(folded);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    if (parent !== null && !(directories.has(parent) && parent !== path)) fail(`${rowLabel}: parent`);
    prior = path;
    return entry;
  });
}

/** The inventory ordinal of an entry's parent directory, or `null` for a root child. */
export function bundleEntryParentOrdinal(entries: readonly ReleaseBundleEntryV1[], ordinal: number): number | null {
  const path = (entries[ordinal] as ReleaseBundleEntryV1).path;
  if (!path.includes("/")) return null;
  const parent = path.slice(0, path.lastIndexOf("/"));
  for (let index = ordinal - 1; index >= 0; index -= 1) if ((entries[index] as ReleaseBundleEntryV1).path === parent) return index;
  return fail("bundle entry parent");
}

export function checkPlanBounds(input: Readonly<Record<string, unknown>>, label: string): void {
  integer(input.maximumPlanBytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  integer(input.maximumJournalBytes, 1, MAXIMUM_PARTICIPANT_JOURNAL_BYTES, `${label}.maximumJournalBytes`);
  if (encoder.encode(canonical(input)).byteLength > (input.maximumPlanBytes as number)) fail(`${label}: exceeds its plan bytes`);
}

// ---------------------------------------------------------------------------------------------
// Bundle source staging
// ---------------------------------------------------------------------------------------------

export function validateBundleSourceStagingPlan(value: unknown, stagingRoot: CanonicalAbsolutePathV1): BundleSourceStagingPlanV1 {
  const label = "BundleSourceStagingPlanV1";
  const input = exact(value, SOURCE_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const id = parseSafeReasonCode(input.id);
  coordinatorOf(stagingRoot, input.coordinatorId, label);
  const paths = bundleSourcePaths(stagingRoot, id);
  if (input.sourceRoot !== paths.sourceRoot || input.evidenceRoot !== paths.evidenceRoot) fail(`${label}: not the derived source paths`);
  if (exact(input.sourceRootBefore, ["state"], `${label}.sourceRootBefore`).state !== "absent") fail(`${label}.sourceRootBefore`);
  const entries = validateBundleEntries(input.entries, `${label}.entries`);
  if (input.inventoryHash !== bundleInventoryHash(entries)) fail(`${label}.inventoryHash`);
  if (integer(input.aggregateBytes, 1, MAXIMUM_AGGREGATE_BYTES, `${label}.aggregateBytes`) !== bundleAggregateBytes(entries)) fail(`${label}.aggregateBytes`);
  checkPlanBounds(input, label);
  return input as unknown as BundleSourceStagingPlanV1;
}

export function bundleSourceStagingPlanBytes(plan: BundleSourceStagingPlanV1): Uint8Array {
  return encoder.encode(canonical(plan));
}

export function cachedPlanHash(plan: object, kind: UpdateLeafPlanKindV1): LowerHexSha256 {
  let hash = PLAN_HASHES.get(plan);
  if (hash === undefined) {
    hash = updateLeafPlanHash(kind, encoder.encode(canonical(plan)));
    PLAN_HASHES.set(plan, hash);
  }
  return hash;
}

export function bundleSourceStagingPlanHash(plan: BundleSourceStagingPlanV1): LowerHexSha256 {
  return cachedPlanHash(plan, "bundle_source_staging");
}

export function bundleSourceStagingPlanRef(plan: BundleSourceStagingPlanV1, stagingRoot: CanonicalAbsolutePathV1): ImmutableUpdatePlanRefV1<"bundle_source_staging"> {
  return { kind: "bundle_source_staging", id: plan.id, path: updateLeafPlanPath(stagingRoot, "bundle_source_staging", plan.id), hash: bundleSourceStagingPlanHash(plan), bytes: bundleSourceStagingPlanBytes(plan).byteLength };
}

export function initialBundleSourceJournal(plan: BundleSourceStagingPlanV1, createdAt: UtcTimestampV1): BundleSourceStagingJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    planHash: bundleSourceStagingPlanHash(plan),
    phase: "planned",
    nextStructure: 0,
    structureIdentities: [],
    structureWriteState: null,
    nextEntry: 0,
    entryWriteState: null,
    readyWriteState: null,
    readyIdentity: null,
    compensationNext: null,
    compensationPart: null,
    compensationStructureNext: null,
    compactionNext: null,
    createdAt: parseUtcTimestamp(createdAt),
    updatedAt: createdAt,
  };
}

export function bundleSourceJournalBytes(journal: BundleSourceStagingJournalV1): Uint8Array {
  return encoder.encode(canonical(journal));
}

export function checkStructureState(value: unknown, next: number, count: number, label: string): UpdateStructureWriteStateV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  const state = oneOf(input.state, ["create_intent", "created"] as const, `${label}.state`);
  identity(input, state === "create_intent" ? ["ordinal", "state"] : ["ordinal", "state", "dev", "ino"], label);
  if (input.ordinal !== next || next >= count) fail(`${label}.ordinal`);
  return input as unknown as UpdateStructureWriteStateV1;
}

export function checkEntryState(value: unknown, next: number, count: number, label: string): UpdateEntryWriteStateV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  const keys = {
    entry_intent: ["ordinal", "state"],
    entry_created: ["ordinal", "state", "dev", "ino"],
    evidence_intent: ["ordinal", "state", "dev", "ino"],
    evidence_created: ["ordinal", "state", "dev", "ino", "evidenceDev", "evidenceIno"],
  }[oneOf(input.state, ["entry_intent", "entry_created", "evidence_intent", "evidence_created"] as const, `${label}.state`)];
  identity(input, keys, label);
  if (input.ordinal !== next || next >= count) fail(`${label}.ordinal`);
  return input as unknown as UpdateEntryWriteStateV1;
}

export function checkDirectoryIdentities(value: unknown, expected: readonly { readonly role: UpdateDirectoryRoleV1; readonly path: string }[], label: string): readonly UpdateDirectoryIdentityV1[] {
  const rows = list(value, 0, expected.length, label);
  rows.forEach((row, index) => {
    const input = identity(row, ["role", "path", "mode", "dev", "ino"], label);
    const planned = expected[index] as { readonly role: UpdateDirectoryRoleV1; readonly path: string };
    if (input.role !== planned.role || input.path !== planned.path || input.mode !== 448) fail(`${label}: not the exact contiguous role/path prefix`);
  });
  return rows as readonly UpdateDirectoryIdentityV1[];
}

export function checkTimestamps(input: Readonly<Record<string, unknown>>, label: string): { readonly createdAt: UtcTimestampV1; readonly updatedAt: UtcTimestampV1 } {
  const createdAt = parseUtcTimestamp(input.createdAt);
  const updatedAt = parseUtcTimestamp(input.updatedAt);
  if (updatedAt < createdAt) fail(`${label}: timestamps`);
  return { createdAt, updatedAt };
}

export function entryTop(state: UpdateEntryWriteStateV1 | null, next: number): number {
  return state !== null && state.state !== "entry_intent" ? next : next - 1;
}

export function structureTop(state: UpdateStructureWriteStateV1 | null, next: number): number {
  return state?.state === "created" ? next : next - 1;
}

/** The linear phase/cursor table of Spec 2 §9.2; every field a phase does not own is zero/null. */
export function validateBundleSourceJournal(value: unknown, plan: BundleSourceStagingPlanV1): BundleSourceStagingJournalV1 {
  const label = "BundleSourceStagingJournalV1";
  const input = exact(value, SOURCE_JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== bundleSourceStagingPlanHash(plan)) fail(`${label}.planHash`);
  const phase = oneOf(input.phase, SOURCE_PHASES, `${label}.phase`);
  const N = plan.entries.length;
  const nextStructure = integer(input.nextStructure, 0, 3, `${label}.nextStructure`);
  const identities = checkDirectoryIdentities(input.structureIdentities, bundleSourceStructures(plan), `${label}.structureIdentities`);
  if (identities.length !== nextStructure) fail(`${label}.structureIdentities: not the reached prefix`);
  const structureState = checkStructureState(input.structureWriteState, nextStructure, 3, `${label}.structureWriteState`);
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
  const compensation = nullableInteger(input.compensationNext, -1, N - 1, `${label}.compensationNext`);
  const part = input.compensationPart === null ? null : oneOf(input.compensationPart, ["entry", "evidence"] as const, `${label}.compensationPart`);
  const compensationStructure = nullableInteger(input.compensationStructureNext, -1, 2, `${label}.compensationStructureNext`);
  const compaction = nullableInteger(input.compactionNext, 0, bundleSourceCompactionEnd(plan), `${label}.compactionNext`);
  const { createdAt, updatedAt } = checkTimestamps(input, label);

  const noCompensation = compensation === null && part === null && compensationStructure === null;
  const clean = noCompensation && compaction === null;
  const structuresDone = nextStructure === 3 && structureState === null;
  const entriesDone = structuresDone && nextEntry === N && entryState === null;
  let legal: boolean;
  switch (phase) {
    case "planned":
      legal = clean && nextStructure === 0 && structureState === null && nextEntry === 0 && entryState === null && ready === "absent" && !readyComplete && updatedAt === createdAt;
      break;
    case "structure_staging":
      legal = clean && nextStructure < 3 && nextEntry === 0 && entryState === null && ready === "absent" && !readyComplete;
      break;
    case "entries_staging":
      legal = clean && structuresDone && !readyComplete && (ready === "absent" || entriesDone);
      break;
    case "source_ready":
      legal = clean && entriesDone && readyComplete;
      break;
    case "compensating": {
      const readyPresent = ready !== "absent" || readyComplete;
      const walkingEntries = compensation !== null && compensation >= 0;
      legal = compaction === null && compensation !== null && compensation <= entryTop(entryState, nextEntry) && walkingEntries === (part !== null)
        && (walkingEntries ? compensationStructure === null : compensationStructure !== null && compensationStructure <= structureTop(structureState, nextStructure))
        && (!readyPresent || (compensation === N - 1 && part === "entry"));
      break;
    }
    case "rolled_back":
      legal = compaction === null && compensation === -1 && part === null && compensationStructure === -1 && ready === "absent" && !readyComplete;
      break;
    case "compacting":
      legal = noCompensation && entriesDone && readyComplete && compaction !== null;
      break;
  }
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return input as unknown as BundleSourceStagingJournalV1;
}

/** Shared entry microsteps; `null` when `step` is not an entry step. */
export function advanceEntry(state: UpdateEntryWriteStateV1 | null, next: number, step: BundleSourceStepV1 | BundlePublicationStepV1, need: (condition: boolean) => void): { readonly state: UpdateEntryWriteStateV1 | null; readonly complete: boolean } | null {
  switch (step.kind) {
    case "entry_intent":
      need(state === null);
      return { state: { ordinal: next, state: "entry_intent" }, complete: false };
    case "entry_created":
      need(state?.state === "entry_intent");
      return { state: { ordinal: next, state: "entry_created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) }, complete: false };
    case "evidence_intent": {
      need(state?.state === "entry_created");
      const created = state as Extract<UpdateEntryWriteStateV1, { readonly state: "entry_created" }>;
      return { state: { ordinal: next, state: "evidence_intent", dev: created.dev, ino: created.ino }, complete: false };
    }
    case "evidence_created": {
      need(state?.state === "evidence_intent");
      const intent = state as Extract<UpdateEntryWriteStateV1, { readonly state: "evidence_intent" }>;
      return { state: { ordinal: next, state: "evidence_created", dev: intent.dev, ino: intent.ino, evidenceDev: parseUInt64Decimal(step.dev), evidenceIno: parseUInt64Decimal(step.ino) }, complete: false };
    }
    case "entry_complete":
      need(state?.state === "evidence_created");
      return { state: null, complete: true };
    default:
      return null;
  }
}

/** Entry compensation walk: each reached entry, then its evidence, in reverse ordinal order. */
export function nextEntryCompensation(at: number, part: "entry" | "evidence" | null): { readonly at: number; readonly part: "entry" | "evidence" | null } {
  if (part === "entry") return { at, part: "evidence" };
  return at === 0 ? { at: -1, part: null } : { at: at - 1, part: "entry" };
}

/** The single legal successor of a source journal; throws on any phase/cursor leap. */
export function advanceBundleSourceJournal(plan: BundleSourceStagingPlanV1, journal: BundleSourceStagingJournalV1, step: BundleSourceStepV1, updatedAt: UtcTimestampV1): BundleSourceStagingJournalV1 {
  const label = `BundleSourceStepV1(${step.kind})`;
  const current = validateBundleSourceJournal(journal, plan);
  if (parseUtcTimestamp(updatedAt) < current.updatedAt) fail(`${label}: time moved backwards`);
  const N = plan.entries.length;
  const base = { ...current, updatedAt };
  const need = (condition: boolean): void => {
    if (!condition) fail(label);
  };
  const forward = current.phase === "planned" || current.phase === "structure_staging" || current.phase === "entries_staging";
  const entry = advanceEntry(current.entryWriteState, current.nextEntry, step, need);
  let next: BundleSourceStagingJournalV1;
  if (entry !== null) {
    need(current.phase === "entries_staging" && current.nextEntry < N && current.readyWriteState === null);
    next = { ...base, entryWriteState: entry.state, nextEntry: current.nextEntry + (entry.complete ? 1 : 0) };
    return validateBundleSourceJournal(next, plan);
  }
  switch (step.kind) {
    case "structure_intent":
      need((current.phase === "planned" || current.phase === "structure_staging") && current.structureWriteState === null);
      next = { ...base, phase: "structure_staging", structureWriteState: { ordinal: current.nextStructure, state: "create_intent" } };
      break;
    case "structure_created":
      need(current.structureWriteState?.state === "create_intent");
      next = { ...base, structureWriteState: { ordinal: current.nextStructure, state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "structure_complete": {
      const state = current.structureWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateStructureWriteStateV1, { readonly state: "created" }>;
      const planned = bundleSourceStructures(plan)[current.nextStructure] as { readonly role: UpdateDirectoryRoleV1; readonly path: CanonicalAbsolutePathV1 };
      const nextStructure = current.nextStructure + 1;
      next = { ...base, phase: nextStructure === 3 ? "entries_staging" : "structure_staging", structureWriteState: null, nextStructure, structureIdentities: [...current.structureIdentities, { role: planned.role, path: planned.path, mode: 448, dev: created.dev, ino: created.ino }] };
      break;
    }
    case "ready_intent":
      need(current.phase === "entries_staging" && current.nextEntry === N && current.entryWriteState === null && current.readyWriteState === null);
      next = { ...base, readyWriteState: { state: "create_intent" } };
      break;
    case "ready_created":
      need(current.readyWriteState?.state === "create_intent");
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
      need(forward || current.phase === "source_ready");
      const top = entryTop(current.entryWriteState, current.nextEntry);
      next = { ...base, phase: "compensating", compensationNext: top, compensationPart: top >= 0 ? "entry" : null, compensationStructureNext: top >= 0 ? null : structureTop(current.structureWriteState, current.nextStructure) };
      break;
    }
    case "ready_removed":
      need(current.phase === "compensating" && (current.readyWriteState !== null || current.readyIdentity !== null));
      next = { ...base, readyWriteState: null, readyIdentity: null };
      break;
    case "compensation_step": {
      need(current.phase === "compensating" && current.readyWriteState === null && current.readyIdentity === null);
      const at = current.compensationNext as number;
      if (at >= 0) {
        const walked = nextEntryCompensation(at, current.compensationPart);
        next = { ...base, compensationNext: walked.at, compensationPart: walked.part, compensationStructureNext: walked.at === -1 ? structureTop(current.structureWriteState, current.nextStructure) : null };
      } else {
        const structure = current.compensationStructureNext as number;
        next = structure >= 0 ? { ...base, compensationStructureNext: structure - 1 } : { ...base, phase: "rolled_back", entryWriteState: null, structureWriteState: null };
      }
      break;
    }
    case "compaction_step":
      if (current.phase === "source_ready") {
        next = { ...base, phase: "compacting", compactionNext: 0 };
        break;
      }
      need(current.phase === "compacting" && (current.compactionNext as number) < bundleSourceCompactionEnd(plan));
      next = { ...base, compactionNext: (current.compactionNext as number) + 1 };
      break;
    default:
      return fail(label);
  }
  return validateBundleSourceJournal(next, plan);
}

/** Flattened source compaction: ready evidence; reverse entries target-then-evidence; reverse structures. */
export function bundleSourceCompactionTarget(plan: BundleSourceStagingPlanV1, cursor: number): BundleSourceCompactionTargetV1 {
  const N = plan.entries.length;
  const k = integer(cursor, 0, bundleSourceCompactionEnd(plan) - 1, "compactionNext");
  if (k === 0) return { kind: "ready" };
  if (k <= 2 * N) return { kind: (k - 1) % 2 === 0 ? "entry" : "evidence", ordinal: N - 1 - Math.floor((k - 1) / 2) };
  return { kind: "structure", ordinal: 2 - (k - 2 * N - 1) };
}

/** The compaction cursor's end: one past the last target of `bundleSourceCompactionTarget`. */
export function bundleSourceCompactionEnd(plan: BundleSourceStagingPlanV1): number {
  return 2 * plan.entries.length + 4;
}

function entryEvidenceFields(entry: ReleaseBundleEntryV1): Pick<DurableSourceEntryEvidenceV1, "pathHash" | "kind" | "bytes" | "sha256"> {
  return entry.kind === "file"
    ? { pathHash: sha256Hex(entry.path), kind: "file", bytes: Number(entry.bytes), sha256: entry.sha256 }
    : { pathHash: sha256Hex(entry.path), kind: "directory", bytes: 0, sha256: null };
}

export function durableSourceEntryEvidence(plan: BundleSourceStagingPlanV1, ordinal: number, dev: UInt64DecimalV1, ino: UInt64DecimalV1): DurableSourceEntryEvidenceV1 {
  const entry = plan.entries[integer(ordinal, 0, plan.entries.length - 1, "source entry ordinal")] as ReleaseBundleEntryV1;
  return { schemaVersion: 1, coordinatorId: plan.coordinatorId, sourceKind: "bundle", stagingPlanHash: bundleSourceStagingPlanHash(plan), ordinal, ...entryEvidenceFields(entry), dev: parseUInt64Decimal(dev), ino: parseUInt64Decimal(ino) };
}

export function durableEntryEvidenceBytes(evidence: DurableSourceEntryEvidenceV1 | DurablePublicationEntryEvidenceV1): Uint8Array {
  const bytes = encoder.encode(canonical(evidence));
  if (bytes.byteLength > MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES) fail("durable entry evidence: exceeds its bound");
  return bytes;
}

export function decodeIdentity(bytes: Uint8Array, maximum: number, label: string): Identity {
  const input = record(decodeCanonicalJson(bytes, maximum), label);
  return { dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
}

/** Complete evidence must be the one canonical object for that row; returns the entry identity it binds. */
export function validateDurableSourceEntryEvidence(bytes: Uint8Array, plan: BundleSourceStagingPlanV1, ordinal: number): DurableSourceEntryEvidenceV1 {
  const found = decodeIdentity(bytes, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, "DurableSourceEntryEvidenceV1");
  const expected = durableSourceEntryEvidence(plan, ordinal, found.dev, found.ino);
  if (Buffer.compare(durableEntryEvidenceBytes(expected), bytes) !== 0) fail("DurableSourceEntryEvidenceV1: not the canonical evidence for its row");
  return expected;
}

/** Derived only from a journal whose every structure and entry cursor is complete. */
export function bundleSourceReadyEvidence(plan: BundleSourceStagingPlanV1, journal: BundleSourceStagingJournalV1, evidenceSetHash: LowerHexSha256): BundleSourceReadyEvidenceV1 {
  const current = validateBundleSourceJournal(journal, plan);
  if (current.nextStructure !== 3 || current.nextEntry !== plan.entries.length || current.entryWriteState !== null) fail("BundleSourceReadyEvidenceV1: source cursors are incomplete");
  const payloadRoot = current.structureIdentities[1] as UpdateDirectoryIdentityV1;
  return {
    schemaVersion: 1,
    coordinatorId: plan.coordinatorId,
    stagingPlanHash: bundleSourceStagingPlanHash(plan),
    sourceRoot: plan.sourceRoot,
    sourceRootDev: payloadRoot.dev,
    sourceRootIno: payloadRoot.ino,
    structureIdentitiesHash: updateSourceStructuresHash(current.structureIdentities),
    inventoryHash: plan.inventoryHash,
    evidenceSetHash: parseLowerHexSha256(evidenceSetHash),
    entryCount: plan.entries.length,
    aggregateBytes: plan.aggregateBytes,
  };
}

export function bundleSourceReadyEvidenceBytes(evidence: BundleSourceReadyEvidenceV1): Uint8Array {
  const bytes = encoder.encode(canonical(evidence));
  if (bytes.byteLength > MAXIMUM_SOURCE_READY_EVIDENCE_BYTES) fail("BundleSourceReadyEvidenceV1: exceeds its bound");
  return bytes;
}

/** Exact bytes against the journal-derived object; `evidenceSetHash` is the caller's recomputation. */
export function validateBundleSourceReadyEvidence(bytes: Uint8Array, plan: BundleSourceStagingPlanV1, journal: BundleSourceStagingJournalV1, evidenceSetHash: LowerHexSha256): BundleSourceReadyEvidenceV1 {
  exact(decodeCanonicalJson(bytes, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES), READY_KEYS, "BundleSourceReadyEvidenceV1");
  const expected = bundleSourceReadyEvidence(plan, journal, evidenceSetHash);
  if (Buffer.compare(bundleSourceReadyEvidenceBytes(expected), bytes) !== 0) fail("BundleSourceReadyEvidenceV1: not the derived ready evidence");
  return expected;
}

// ---------------------------------------------------------------------------------------------
// Bundle publication
// ---------------------------------------------------------------------------------------------

/** `<home>/releases/<semver>/darwin-<arch>` gives the product home and the retained-metadata paths. */
function productHomeOf(target: ReleaseIdentityV1, label: string): CanonicalAbsolutePathV1 {
  const suffix = `/releases/${parseStableSemver(target.version)}/darwin-${target.architecture}`;
  if (!target.bundleRoot.endsWith(suffix)) fail(`${label}.target.bundleRoot`);
  return parseCanonicalAbsolutePathText(target.bundleRoot.slice(0, -suffix.length));
}

/** Metadata ordinals 0, 1, 2 are the delegation, release index, and bundle manifest. */
export function bundleMetadataPath(target: ReleaseIdentityV1, ordinal: number): CanonicalAbsolutePathV1 {
  const hash = [target.delegationHash, target.releaseIndexHash, target.bundleManifestHash][integer(ordinal, 0, 2, "metadata ordinal")] as LowerHexSha256;
  return parseCanonicalAbsolutePathText(`${productHomeOf(target, "BundlePublicationPlanV1")}/state/release-metadata/${METADATA_STORES[ordinal] as string}/${hash}.json`);
}

function validateTarget(value: unknown, label: string): ReleaseIdentityV1 {
  const input = exact(value, IDENTITY_KEYS, label);
  parseStableSemver(input.version);
  for (const key of ["releaseSequence", "delegationSequence", "releaseIndexSequence"]) parseUInt64Decimal(input[key]);
  for (const key of ["releaseIdentityHash", "delegationHash", "releaseIndexHash", "bundleManifestHash"]) parseLowerHexSha256(input[key]);
  parseCanonicalAbsolutePathText(input.bundleRoot);
  if (input.platform !== "darwin") fail(`${label}.platform`);
  oneOf(input.architecture, ["arm64", "x64"], `${label}.architecture`);
  integer(input.launcherProtocol, 1, 4_294_967_295, `${label}.launcherProtocol`);
  integer(input.updateProtocol, 1, 4_294_967_295, `${label}.updateProtocol`);
  productHomeOf(input as unknown as ReleaseIdentityV1, label);
  return input as unknown as ReleaseIdentityV1;
}

function validateMetadataState(value: unknown, side: "before" | "after", label: string): BundleMetadataFileStateV1 {
  const input = record(value, label);
  if (input.state === "absent") {
    exact(input, ["state"], label);
    return input as unknown as BundleMetadataFileStateV1;
  }
  if (side === "before") identity(input, ["state", "hash", "payload", "ownerUid", "mode", "nlink", "size", "dev", "ino"], label);
  else exact(input, ["state", "hash", "payload", "ownerUid", "mode", "nlink", "size"], label);
  if (input.state !== "present" || input.mode !== 384 || input.nlink !== 1) fail(label);
  parseLowerHexSha256(input.hash);
  integer(input.ownerUid, 0, 4_294_967_295, `${label}.ownerUid`);
  integer(input.size, 1, MAXIMUM_METADATA_BYTES, `${label}.size`);
  if (input.payload !== null) {
    if (side === "before") fail(`${label}.payload: a preimage carries no payload`);
    const payload = exact(input.payload, ["kind", "coordinatorId", "ordinal", "path", "hash", "bytes", "mode"], `${label}.payload`);
    if (payload.kind !== "update_expected" || payload.mode !== 384 || payload.hash !== input.hash || payload.bytes !== input.size) fail(`${label}.payload`);
    integer(payload.ordinal, 0, 1_099_999, `${label}.payload.ordinal`);
    parseCanonicalAbsolutePathText(payload.path);
  }
  return input as unknown as BundleMetadataFileStateV1;
}

/** The preimage as the postimage it must equal for a byte-identical present→present row. */
function postimageOf(before: BundleMetadataPreimageV1): Readonly<Record<string, unknown>> {
  if (before.state === "absent") return before;
  const { state, hash, payload, ownerUid, mode, nlink, size } = before;
  return { state, hash, payload, ownerUid, mode, nlink, size };
}

/** Absent → present no-replace from its derived state payload, or present → the identical present. */
function validateMetadataPlan(value: unknown, plan: Readonly<Record<string, unknown>>, ordinal: number, stagingRoot: CanonicalAbsolutePathV1, label: string): BundleMetadataStatePlanV1 {
  const input = exact(value, METADATA_PLAN_KEYS, label);
  if (input.schemaVersion !== 1 || input.coordinatorId !== plan.coordinatorId || input.role !== "release_metadata" || input.reversal !== "reversible") fail(label);
  const id = parseSafeReasonCode(input.id);
  const target = plan.target as ReleaseIdentityV1;
  if (input.path !== bundleMetadataPath(target, ordinal)) fail(`${label}.path: not the hash-derived path`);
  const tombstone = parseCanonicalAbsolutePathText(input.tombstonePath);
  if (tombstone === input.path || !tombstone.startsWith(`${stagingRoot}/`)) fail(`${label}.tombstonePath`);
  const before = validateMetadataState(input.before, "before", `${label}.before`) as BundleMetadataPreimageV1;
  const after = validateMetadataState(input.after, "after", `${label}.after`);
  if (after.state !== "present") fail(`${label}.after: metadata is never removed`);
  if (before.state === "absent") {
    const expectedPayload = deriveCanonicalStatePayloadPath(productHomeOf(target, label), plan.coordinatorId as SafeReasonCodeV1, "release_metadata", id);
    if (after.payload?.path !== expectedPayload || after.payload.coordinatorId !== plan.coordinatorId) fail(`${label}.after.payload`);
  } else if (after.payload !== null || canonical(postimageOf(before)) !== canonical(after)) {
    fail(`${label}: replacement is illegal`);
  }
  checkPlanBounds(input, label);
  return input as unknown as BundleMetadataStatePlanV1;
}

export function validateBundlePublicationPlan(value: unknown, stagingRoot: CanonicalAbsolutePathV1): BundlePublicationPlanV1 {
  const label = "BundlePublicationPlanV1";
  const input = exact(value, PUBLICATION_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(input.id);
  coordinatorOf(stagingRoot, input.coordinatorId, label);
  const action = oneOf(input.action, ["publish_target", "verify_previous"] as const, `${label}.action`);
  const target = validateTarget(input.target, `${label}.target`);
  const entries = validateBundleEntries(input.entries, `${label}.entries`);
  if (input.inventoryHash !== bundleInventoryHash(entries)) fail(`${label}.inventoryHash`);
  const source = record(input.source, `${label}.source`);
  const before = record(input.targetRootBefore, `${label}.targetRootBefore`);
  if (action === "publish_target") {
    exact(source, ["kind", "stagingPlan", "readyEvidencePath"], `${label}.source`);
    if (source.kind !== "staged_source") fail(`${label}.source.kind`);
    const ref = exact(source.stagingPlan, ["kind", "id", "path", "hash", "bytes"], `${label}.source.stagingPlan`);
    const id = parseSafeReasonCode(ref.id);
    if (ref.kind !== "bundle_source_staging" || ref.path !== updateLeafPlanPath(stagingRoot, "bundle_source_staging", id)) fail(`${label}.source.stagingPlan`);
    parseLowerHexSha256(ref.hash);
    integer(ref.bytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.source.stagingPlan.bytes`);
    if (source.readyEvidencePath !== bundleSourcePaths(stagingRoot, id).ready) fail(`${label}.source.readyEvidencePath`);
    if (exact(before, ["state"], `${label}.targetRootBefore`).state !== "absent") fail(`${label}.targetRootBefore`);
  } else {
    identity(source, ["kind", "root", "rootDev", "rootIno", "inventoryHash", "entryCount", "aggregateBytes"], `${label}.source`);
    identity(before, ["state", "inventoryHash", "dev", "ino"], `${label}.targetRootBefore`);
    if (source.kind !== "retained_bundle" || source.root !== target.bundleRoot || source.inventoryHash !== input.inventoryHash || source.entryCount !== entries.length || source.aggregateBytes !== bundleAggregateBytes(entries)) fail(`${label}.source`);
    if (before.state !== "present" || before.inventoryHash !== input.inventoryHash || before.dev !== source.rootDev || before.ino !== source.rootIno) fail(`${label}.targetRootBefore`);
  }
  const metadata = list(input.metadata, 3, 3, `${label}.metadata`).map((row, ordinal) => validateMetadataPlan(row, input, ordinal, stagingRoot, `${label}.metadata[${ordinal.toString(10)}]`));
  if (action === "verify_previous" && metadata.some((row) => row.before.state !== "present")) fail(`${label}.metadata: verify_previous publishes nothing`);
  if (new Set(metadata.map((row) => row.id)).size !== 3) fail(`${label}.metadata: duplicate id`);
  checkPlanBounds(input, label);
  return input as unknown as BundlePublicationPlanV1;
}

export function bundlePublicationPlanBytes(plan: BundlePublicationPlanV1): Uint8Array {
  return encoder.encode(canonical(plan));
}

export function bundlePublicationPlanHash(plan: BundlePublicationPlanV1): LowerHexSha256 {
  return cachedPlanHash(plan, "bundle_publication");
}

export function bundlePublicationPlanRef(plan: BundlePublicationPlanV1, stagingRoot: CanonicalAbsolutePathV1): ImmutableUpdatePlanRefV1<"bundle_publication"> {
  return { kind: "bundle_publication", id: plan.id, path: updateLeafPlanPath(stagingRoot, "bundle_publication", plan.id), hash: bundlePublicationPlanHash(plan), bytes: bundlePublicationPlanBytes(plan).byteLength };
}

/** A metadata row gains deletion authority only when it was absent before this plan. */
export function bundleMetadataCreates(plan: BundlePublicationPlanV1, ordinal: number): boolean {
  return (plan.metadata[ordinal] as BundleMetadataStatePlanV1).before.state === "absent";
}

export function initialBundlePublicationJournal(plan: BundlePublicationPlanV1, createdAt: UtcTimestampV1): BundlePublicationJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    planHash: bundlePublicationPlanHash(plan),
    phase: "planned",
    nextRootTransition: 0,
    rootWriteState: null,
    targetRootIdentity: null,
    nextEntry: 0,
    entryWriteState: null,
    nextMetadata: 0,
    metadataWriteState: null,
    metadataIdentities: [],
    compensationMetadataNext: null,
    compensationNext: null,
    compensationPart: null,
    compensationRootNext: null,
    compactionNext: null,
    createdAt: parseUtcTimestamp(createdAt),
    updatedAt: createdAt,
  };
}

export function bundlePublicationJournalBytes(journal: BundlePublicationJournalV1): Uint8Array {
  return encoder.encode(canonical(journal));
}

function metadataTop(state: UpdatePublicationMetadataWriteStateV1 | null, next: number): number {
  return state?.state === "published" ? next : next - 1;
}

function rootTop(journal: BundlePublicationJournalV1): number {
  return journal.rootWriteState?.state === "created" || journal.targetRootIdentity !== null ? 0 : -1;
}

export function validateBundlePublicationJournal(value: unknown, plan: BundlePublicationPlanV1): BundlePublicationJournalV1 {
  const label = "BundlePublicationJournalV1";
  const input = exact(value, PUBLICATION_JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== bundlePublicationPlanHash(plan)) fail(`${label}.planHash`);
  const phase = oneOf(input.phase, PUBLICATION_PHASES, `${label}.phase`);
  const publish = plan.action === "publish_target";
  const N = plan.entries.length;
  const nextRoot = integer(input.nextRootTransition, 0, 1, `${label}.nextRootTransition`);
  const rootState = checkStructureState(input.rootWriteState, nextRoot, 1, `${label}.rootWriteState`);
  const rootIdentity = checkDirectoryIdentities(input.targetRootIdentity === null ? [] : [input.targetRootIdentity], [{ role: "target_bundle_root", path: plan.target.bundleRoot }], `${label}.targetRootIdentity`)[0] ?? null;
  if ((rootIdentity !== null) !== (nextRoot === 1)) fail(`${label}.targetRootIdentity: not the root transition`);
  if (rootIdentity !== null && plan.targetRootBefore.state === "present" && (rootIdentity.dev !== plan.targetRootBefore.dev || rootIdentity.ino !== plan.targetRootBefore.ino)) fail(`${label}.targetRootIdentity: not the planned preimage`);
  const nextEntry = integer(input.nextEntry, 0, N, `${label}.nextEntry`);
  const entryState = checkEntryState(input.entryWriteState, nextEntry, N, `${label}.entryWriteState`);
  const nextMetadata = integer(input.nextMetadata, 0, 3, `${label}.nextMetadata`);
  let metadataState: UpdatePublicationMetadataWriteStateV1 | null = null;
  if (input.metadataWriteState !== null) {
    const state = record(input.metadataWriteState, `${label}.metadataWriteState`);
    const kind = oneOf(state.state, ["publish_intent", "published"] as const, `${label}.metadataWriteState.state`);
    identity(state, kind === "publish_intent" ? ["ordinal", "state"] : ["ordinal", "state", "dev", "ino"], `${label}.metadataWriteState`);
    if (state.ordinal !== nextMetadata || nextMetadata >= 3 || !bundleMetadataCreates(plan, nextMetadata)) fail(`${label}.metadataWriteState.ordinal`);
    metadataState = state as unknown as UpdatePublicationMetadataWriteStateV1;
  }
  const identities = list(input.metadataIdentities, 0, 3, `${label}.metadataIdentities`);
  identities.forEach((row, index) => {
    const found = identity(row, ["ordinal", "dev", "ino"], `${label}.metadataIdentities`);
    const planned = plan.metadata[index] as BundleMetadataStatePlanV1;
    if (found.ordinal !== index || (planned.before.state === "present" && (found.dev !== planned.before.dev || found.ino !== planned.before.ino))) fail(`${label}.metadataIdentities: not the exact contiguous prefix`);
  });
  if (identities.length !== nextMetadata) fail(`${label}.metadataIdentities: not the reached prefix`);
  const compMetadata = nullableInteger(input.compensationMetadataNext, -1, 2, `${label}.compensationMetadataNext`);
  const compensation = nullableInteger(input.compensationNext, -1, N - 1, `${label}.compensationNext`);
  const part = input.compensationPart === null ? null : oneOf(input.compensationPart, ["entry", "evidence"] as const, `${label}.compensationPart`);
  const compRoot = nullableInteger(input.compensationRootNext, -1, 0, `${label}.compensationRootNext`);
  const compaction = nullableInteger(input.compactionNext, 0, N, `${label}.compactionNext`);
  const { createdAt, updatedAt } = checkTimestamps(input, label);

  // Verify-only publication never writes, so it has no write state and no compensation cursor.
  if (!publish && (rootState !== null || entryState !== null || metadataState !== null || compMetadata !== null || compensation !== null || compRoot !== null)) fail(`${label}: verify_previous with a mutation cursor`);
  const noCompensation = compMetadata === null && compensation === null && part === null && compRoot === null;
  const clean = noCompensation && compaction === null;
  const rootDone = nextRoot === 1 && rootState === null;
  const entriesDone = rootDone && nextEntry === N && entryState === null;
  const complete = entriesDone && nextMetadata === 3 && metadataState === null;
  const journal = input as unknown as BundlePublicationJournalV1;
  let legal: boolean;
  switch (phase) {
    case "planned":
      legal = clean && nextRoot === 0 && rootState === null && nextEntry === 0 && entryState === null && nextMetadata === 0 && updatedAt === createdAt;
      break;
    case "root_publishing":
      legal = clean && publish && nextRoot === 0 && nextEntry === 0 && entryState === null && nextMetadata === 0;
      break;
    case "entries_publishing":
      legal = clean && rootDone && nextEntry < N && nextMetadata === 0;
      break;
    case "metadata_publishing":
      legal = clean && entriesDone && nextMetadata < 3;
      break;
    case "verified":
    case "finalized":
      legal = clean && complete;
      break;
    case "compensating_metadata":
      legal = publish && compaction === null && compMetadata !== null && compMetadata <= metadataTop(metadataState, nextMetadata) && compensation === null && part === null && compRoot === null;
      break;
    case "compensating_entries":
      legal = publish && compaction === null && compMetadata === -1 && compensation !== null && compensation <= entryTop(entryState, nextEntry) && (compensation >= 0) === (part !== null) && compRoot === null;
      break;
    case "compensating_root":
      legal = publish && compaction === null && compMetadata === -1 && compensation === -1 && part === null && compRoot !== null && compRoot <= rootTop(journal);
      break;
    case "rolled_back":
      legal = compaction === null && (publish ? compMetadata === -1 && compensation === -1 && part === null && compRoot === -1 : noCompensation);
      break;
    case "compacting":
      legal = noCompensation && complete && compaction !== null;
      break;
  }
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return journal;
}

export function isBundlePublicationForward(phase: BundlePublicationPhaseV1): boolean {
  return PUBLICATION_FORWARD.includes(phase);
}

/** The single legal successor of a publication journal; throws on any phase/cursor leap. */
export function advanceBundlePublicationJournal(plan: BundlePublicationPlanV1, journal: BundlePublicationJournalV1, step: BundlePublicationStepV1, updatedAt: UtcTimestampV1): BundlePublicationJournalV1 {
  const label = `BundlePublicationStepV1(${step.kind})`;
  const current = validateBundlePublicationJournal(journal, plan);
  if (parseUtcTimestamp(updatedAt) < current.updatedAt) fail(`${label}: time moved backwards`);
  const N = plan.entries.length;
  const publish = plan.action === "publish_target";
  const base = { ...current, updatedAt };
  const need = (condition: boolean): void => {
    if (!condition) fail(label);
  };
  const afterEntry = (nextEntry: number): BundlePublicationPhaseV1 => (nextEntry === N ? "metadata_publishing" : "entries_publishing");
  const afterMetadata = (nextMetadata: number): BundlePublicationPhaseV1 => (nextMetadata === 3 ? "verified" : "metadata_publishing");
  const entry = advanceEntry(current.entryWriteState, current.nextEntry, step, need);
  let next: BundlePublicationJournalV1;
  if (entry !== null) {
    need(publish && current.phase === "entries_publishing");
    const nextEntry = current.nextEntry + (entry.complete ? 1 : 0);
    next = { ...base, phase: afterEntry(nextEntry), entryWriteState: entry.state, nextEntry };
    return validateBundlePublicationJournal(next, plan);
  }
  const rootPath = plan.target.bundleRoot;
  switch (step.kind) {
    case "root_intent":
      need(publish && current.phase === "planned");
      next = { ...base, phase: "root_publishing", rootWriteState: { ordinal: 0, state: "create_intent" } };
      break;
    case "root_created":
      need(current.rootWriteState?.state === "create_intent");
      next = { ...base, rootWriteState: { ordinal: 0, state: "created", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "root_complete": {
      const state = current.rootWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateStructureWriteStateV1, { readonly state: "created" }>;
      next = { ...base, phase: "entries_publishing", rootWriteState: null, nextRootTransition: 1, targetRootIdentity: { role: "target_bundle_root", path: rootPath, mode: 448, dev: created.dev, ino: created.ino } };
      break;
    }
    case "root_verified": {
      need(!publish && current.phase === "planned" && plan.targetRootBefore.state === "present");
      const before = plan.targetRootBefore as Extract<BundlePublicationPlanV1["targetRootBefore"], { readonly state: "present" }>;
      next = { ...base, phase: "entries_publishing", nextRootTransition: 1, targetRootIdentity: { role: "target_bundle_root", path: rootPath, mode: 448, dev: before.dev, ino: before.ino } };
      break;
    }
    case "entry_verified":
      need(!publish && current.phase === "entries_publishing");
      next = { ...base, phase: afterEntry(current.nextEntry + 1), nextEntry: current.nextEntry + 1 };
      break;
    case "metadata_intent":
      need(current.phase === "metadata_publishing" && current.metadataWriteState === null && bundleMetadataCreates(plan, current.nextMetadata));
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "publish_intent" } };
      break;
    case "metadata_published":
      need(current.metadataWriteState?.state === "publish_intent");
      next = { ...base, metadataWriteState: { ordinal: current.nextMetadata, state: "published", dev: parseUInt64Decimal(step.dev), ino: parseUInt64Decimal(step.ino) } };
      break;
    case "metadata_complete": {
      const state = current.metadataWriteState;
      need(state?.state === "published");
      const published = state as Extract<UpdatePublicationMetadataWriteStateV1, { readonly state: "published" }>;
      next = { ...base, phase: afterMetadata(current.nextMetadata + 1), metadataWriteState: null, nextMetadata: current.nextMetadata + 1, metadataIdentities: [...current.metadataIdentities, { ordinal: current.nextMetadata, dev: published.dev, ino: published.ino }] };
      break;
    }
    case "metadata_verified": {
      need(current.phase === "metadata_publishing" && current.metadataWriteState === null && !bundleMetadataCreates(plan, current.nextMetadata));
      const before = (plan.metadata[current.nextMetadata] as BundleMetadataStatePlanV1).before as PresentBundleMetadataPreimageV1;
      next = { ...base, phase: afterMetadata(current.nextMetadata + 1), nextMetadata: current.nextMetadata + 1, metadataIdentities: [...current.metadataIdentities, { ordinal: current.nextMetadata, dev: before.dev, ino: before.ino }] };
      break;
    }
    case "compensate":
      need(isBundlePublicationForward(current.phase));
      next = publish
        ? { ...base, phase: "compensating_metadata", compensationMetadataNext: metadataTop(current.metadataWriteState, current.nextMetadata) }
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
        } else next = { ...base, phase: "compensating_root", compensationRootNext: rootTop(current) };
      } else {
        need(current.phase === "compensating_root");
        next = current.compensationRootNext === 0 ? { ...base, compensationRootNext: -1 } : { ...base, phase: "rolled_back" };
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
  return validateBundlePublicationJournal(next, plan);
}

/** Compaction cursor `k` removes publication evidence ordinal `entryCount - 1 - k`. */
export function bundlePublicationCompactionOrdinal(plan: BundlePublicationPlanV1, cursor: number): number {
  return plan.entries.length - 1 - integer(cursor, 0, plan.entries.length - 1, "compactionNext");
}

export function durablePublicationEntryEvidence(plan: BundlePublicationPlanV1, ordinal: number, dev: UInt64DecimalV1, ino: UInt64DecimalV1): DurablePublicationEntryEvidenceV1 {
  const entry = plan.entries[integer(ordinal, 0, plan.entries.length - 1, "publication entry ordinal")] as ReleaseBundleEntryV1;
  return { schemaVersion: 1, coordinatorId: plan.coordinatorId, participantKind: "bundle_publication", participantPlanHash: bundlePublicationPlanHash(plan), ordinal, ...entryEvidenceFields(entry), dev: parseUInt64Decimal(dev), ino: parseUInt64Decimal(ino) };
}

export function validateDurablePublicationEntryEvidence(bytes: Uint8Array, plan: BundlePublicationPlanV1, ordinal: number): DurablePublicationEntryEvidenceV1 {
  const found = decodeIdentity(bytes, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, "DurablePublicationEntryEvidenceV1");
  const expected = durablePublicationEntryEvidence(plan, ordinal, found.dev, found.ino);
  if (Buffer.compare(durableEntryEvidenceBytes(expected), bytes) !== 0) fail("DurablePublicationEntryEvidenceV1: not the canonical evidence for its row");
  return expected;
}
