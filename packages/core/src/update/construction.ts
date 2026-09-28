import { createHash } from "node:crypto";

import { decodeCanonicalJson, encodeCanonicalJson, type CanonicalJsonV1, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { parseAllocatedLifecycleId, parseManifestParticipantId, type AllocatedLifecycleIdV1, type EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1, ManifestParticipantIdV1 } from "../manifest/manifest-state.js";
import { encodeFoundationJournalJsonV1, validateJournal } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import type { UpdateFoundationParticipantRefV2 } from "./migrations.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type ExactProductStatePathV1 } from "./paths.js";
import type { PreparedUpdateCandidateV1, RollbackPayloadEntryV1, RollbackPayloadIdV1 } from "./preview.js";
import { parseRollbackPayloadId } from "./preview.js";
import { compareUtf8, parseBundleRelativePath, type BundleRelativePathV1, type ReleaseIdentityV1 } from "./release.js";
import {
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type SchemaMigrationIdV1,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "./scalars.js";

/** Spec 2 §5.2's owner-effect ID, reserved from the lifecycle allocator. */
export type OwnerExternalEffectIdV1 = AllocatedLifecycleIdV1<"oe">;

export type UpdateLeafPlanKindV1 =
  | "update_execution" | "bundle_source_staging" | "bundle_publication"
  | "owner_update" | "owner_external_effect" | "schema_migration" | "manifest_state"
  | "release_trust_state" | "active_release_state" | "rollback_record_state"
  | "rollback_payload_source" | "rollback_payload_state"
  | "target_verification" | "terminal_retirement";

export type UpdateLeafPlanIdV1<TKind extends UpdateLeafPlanKindV1> =
  TKind extends "owner_external_effect" ? OwnerExternalEffectIdV1 :
  TKind extends "schema_migration" ? SchemaMigrationIdV1 :
  TKind extends "manifest_state" ? ManifestParticipantIdV1 :
  SafeReasonCodeV1;

export interface ImmutableUpdatePlanRefV1<TKind extends UpdateLeafPlanKindV1 = UpdateLeafPlanKindV1> {
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
}

export type UpdateTargetJournalKindV1 =
  | "bundle_publication" | "owner_update" | "owner_external_effect"
  | "schema_migration" | "manifest_state" | "release_trust_state"
  | "active_release_state" | "rollback_record_state" | "rollback_payload_state";

export interface UpdateInitialJournalRefForV1<TKind extends UpdateTargetJournalKindV1> {
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly planHash: LowerHexSha256;
  readonly finalPath: CanonicalAbsolutePathV1;
  readonly stagedPath: CanonicalAbsolutePathV1;
  readonly stagedExpected: {
    readonly constructionOrdinal: number;
    readonly hash: LowerHexSha256;
    readonly bytes: number;
    readonly mode: 384;
  };
}

export type UpdateInitialJournalRefV1 = {
  readonly [K in UpdateTargetJournalKindV1]: UpdateInitialJournalRefForV1<K>
}[UpdateTargetJournalKindV1];

export type UpdateConstructionJournalKindV1 = UpdateTargetJournalKindV1 | "bundle_source_staging" | "rollback_payload_source";

type LeafId = SafeReasonCodeV1 | OwnerExternalEffectIdV1 | SchemaMigrationIdV1 | ManifestParticipantIdV1;

export type UpdateConstructionParentV1 =
  | { readonly kind: "staging_root"; readonly path: CanonicalAbsolutePathV1; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "created_directory"; readonly ordinal: number };

export interface UpdateConstructionDirectoryPlanV1 {
  readonly ordinal: number;
  readonly path: CanonicalAbsolutePathV1;
  readonly expectedBefore: "absent";
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 448;
  readonly parent: UpdateConstructionParentV1;
}

export type UpdateConstructionOutputConsumerV1 =
  | { readonly kind: "construction_file"; readonly ordinal: number }
  | { readonly kind: "rollback_source_entry"; readonly ordinal: number };

export interface UpdateConstructionOutputFrameV1 {
  readonly ordinal: number;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly consumers: readonly UpdateConstructionOutputConsumerV1[];
}

export type UpdateConstructionPreimageAuthorityV1 =
  | { readonly kind: "owner_operation_before"; readonly ownerPlan: ImmutableUpdatePlanRefV1<"owner_update">; readonly operationOrdinal: number }
  | { readonly kind: "schema_migration_before"; readonly migrationPlan: ImmutableUpdatePlanRefV1<"schema_migration">; readonly mutationOrdinal: number }
  | { readonly kind: "foundation_expected_before"; readonly participant: UpdateFoundationParticipantRefV2; readonly mutationOrdinal: number };

interface GuardedPreimageSourceV1 {
  readonly kind: "guarded_preimage";
  readonly authority: UpdateConstructionPreimageAuthorityV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 384 | 448;
  readonly nlink: 1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type UpdateConstructionRollbackEntrySourceV1 =
  | { readonly kind: "planner_output"; readonly ordinal: number }
  | GuardedPreimageSourceV1
  | { readonly kind: "plan_derived"; readonly role: "owner_inverse_plan"; readonly plan: ImmutableUpdatePlanRefV1<"owner_update">; readonly value: CanonicalJsonV1; readonly valueBytes: number }
  | { readonly kind: "plan_derived"; readonly role: "schema_migration_inverse_plan"; readonly plan: ImmutableUpdatePlanRefV1<"schema_migration">; readonly value: CanonicalJsonV1; readonly valueBytes: number };

export interface UpdateConstructionRollbackSourceEntryV1 {
  readonly ordinal: number;
  readonly entry: RollbackPayloadEntryV1;
  readonly source: UpdateConstructionRollbackEntrySourceV1;
  readonly sourceProjectionHash: LowerHexSha256;
}

export interface UpdateConstructionRollbackSourceV1 {
  readonly sourcePlanId: SafeReasonCodeV1;
  readonly payloadId: RollbackPayloadIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly inventoryHash: LowerHexSha256;
  readonly entriesProjectionHash: LowerHexSha256;
  readonly entries: readonly UpdateConstructionRollbackSourceEntryV1[];
}

export type UpdateConstructionPlanDerivedSourceV1 =
  /** `value` is Spec 1's exact `FoundationJournalJsonV1` text (with its LF), which the executor rereads byte for byte. */
  | { readonly kind: "plan_derived"; readonly role: "foundation_initial_journal"; readonly participant: UpdateFoundationParticipantRefV2; readonly foundationPlanHash: LowerHexSha256; readonly plannedBytesHash: LowerHexSha256; readonly value: string; readonly valueBytes: number }
  /** Spec 2 §5.3 (D60): the `.bin.sha256` sidecar, exactly `contentHash` plus LF. */
  | { readonly kind: "plan_derived"; readonly role: "foundation_staged_digest"; readonly contentHash: LowerHexSha256; readonly value: string; readonly valueBytes: 64 }
  | { readonly kind: "plan_derived"; readonly role: "manifest_after"; readonly plan: ImmutableUpdatePlanRefV1<"manifest_state">; readonly value: CanonicalJsonV1; readonly valueBytes: number }
  | { readonly kind: "plan_derived"; readonly role: "release_trust_after"; readonly plan: ImmutableUpdatePlanRefV1<"release_trust_state">; readonly value: CanonicalJsonV1; readonly valueBytes: number }
  | { readonly kind: "plan_derived"; readonly role: "active_release_after"; readonly plan: ImmutableUpdatePlanRefV1<"active_release_state">; readonly value: CanonicalJsonV1; readonly valueBytes: number }
  | { readonly kind: "plan_derived"; readonly role: "rollback_record_after"; readonly plan: ImmutableUpdatePlanRefV1<"rollback_record_state">; readonly value: CanonicalJsonV1; readonly valueBytes: number }
  /** P4 (D72): the signed delegation (0), release index (1) or bundle manifest (2) of the bundle plan's metadata. */
  | { readonly kind: "plan_derived"; readonly role: "release_metadata_after"; readonly metadata: 0 | 1 | 2; readonly value: CanonicalJsonV1; readonly valueBytes: number };

export type UpdateConstructionPayloadSourceV1 =
  | { readonly kind: "planner_output"; readonly ordinal: number }
  | {
      readonly kind: "signed_bundle_entry";
      readonly release: ReleaseIdentityV1;
      readonly root: CanonicalAbsolutePathV1;
      readonly rootDev: UInt64DecimalV1;
      readonly rootIno: UInt64DecimalV1;
      readonly inventoryHash: LowerHexSha256;
      readonly relativePath: BundleRelativePathV1;
      readonly sourceBytes: number;
      readonly sourceHash: LowerHexSha256;
      readonly sourceMode: 384 | 448;
      readonly sourceDev: UInt64DecimalV1;
      readonly sourceIno: UInt64DecimalV1;
    }
  | GuardedPreimageSourceV1
  | UpdateConstructionPlanDerivedSourceV1;

export type UpdateConstructionPayloadKindV1 = "foundation_initial" | "foundation_content" | "foundation_digest" | "owner_content" | "migration_content" | "state_after";

export type UpdateConstructionFileRoleV1 =
  | { readonly kind: "immutable_plan"; readonly planKind: UpdateLeafPlanKindV1; readonly id: LeafId }
  | { readonly kind: "payload"; readonly payloadKind: UpdateConstructionPayloadKindV1; readonly source: UpdateConstructionPayloadSourceV1; readonly sourceProjectionHash: LowerHexSha256 }
  | { readonly kind: "initial_journal"; readonly journalKind: UpdateConstructionJournalKindV1; readonly id: LeafId; readonly finalPath: CanonicalAbsolutePathV1 }
  | { readonly kind: "recovery_executor"; readonly state: "executing" | "terminal_cleanup" };

export interface UpdateConstructionFilePlanV1 {
  readonly ordinal: number;
  readonly role: UpdateConstructionFileRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly parent: UpdateConstructionParentV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
}

export interface UpdateConstructionStagingRootV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface UpdateConstructionPlanV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: "update_apply" | "update_rollback";
  readonly executionBindingHash: LowerHexSha256;
  readonly stagingRoot: UpdateConstructionStagingRootV1;
  readonly directories: readonly UpdateConstructionDirectoryPlanV1[];
  readonly files: readonly UpdateConstructionFilePlanV1[];
  readonly outputFrames: readonly UpdateConstructionOutputFrameV1[];
  readonly rollbackSource: UpdateConstructionRollbackSourceV1 | null;
  readonly constructionJournalCreatedAt: UtcTimestampV1;
  readonly outerJournalCreatedAt: UtcTimestampV1;
  readonly outerPlanPath: ExactProductStatePathV1;
  readonly outerJournalPath: ExactProductStatePathV1;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
  readonly maximumEvidenceBytes: 1024;
}

export type UpdateConstructionDirectoryWriteStateV1 =
  | { readonly ordinal: number; readonly state: "create_intent" }
  | { readonly ordinal: number; readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface UpdateConstructionDirectoryIdentityV1 {
  readonly ordinal: number;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type UpdateConstructionWriteStateV1 =
  | { readonly ordinal: number; readonly state: "create_intent" }
  | { readonly ordinal: number; readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: number; readonly state: "evidence_intent"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: number; readonly state: "evidence_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; readonly evidenceDev: UInt64DecimalV1; readonly evidenceIno: UInt64DecimalV1 };

export interface UpdateConstructionOuterFileV1 {
  readonly path: ExactProductStatePathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384;
}

export type UpdateConstructionOuterWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface UpdateConstructionOuterIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type UpdateConstructionPhaseV1 =
  | "planned" | "directories_staging" | "files_staging" | "sources_staging" | "files_ready"
  | "outer_plan_publishing" | "outer_journal_publishing" | "handed_off"
  | "compensating" | "rolled_back" | "compacting";

export interface UpdateConstructionJournalV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly constructionPlanHash: LowerHexSha256;
  readonly phase: UpdateConstructionPhaseV1;
  readonly nextDirectory: number;
  readonly directoryWriteState: UpdateConstructionDirectoryWriteStateV1 | null;
  readonly directoryIdentities: readonly UpdateConstructionDirectoryIdentityV1[];
  readonly nextFile: number;
  readonly fileWriteState: UpdateConstructionWriteStateV1 | null;
  readonly nextOutputFrame: number;
  readonly nextOutputConsumer: number;
  readonly outerPlan: UpdateConstructionOuterFileV1 | null;
  readonly outerPlanWriteState: UpdateConstructionOuterWriteStateV1 | null;
  readonly outerPlanIdentity: UpdateConstructionOuterIdentityV1 | null;
  readonly outerJournal: UpdateConstructionOuterFileV1 | null;
  readonly outerJournalWriteState: UpdateConstructionOuterWriteStateV1 | null;
  readonly outerJournalIdentity: UpdateConstructionOuterIdentityV1 | null;
  readonly compensationNext: number | null;
  readonly compensationPart: "file" | "evidence" | null;
  readonly compensationDirectoryNext: number | null;
  readonly compactionNext: number | null;
  readonly compactionDirectoryNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface UpdateConstructionFileEvidenceV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly constructionPlanHash: LowerHexSha256;
  readonly ordinal: number;
  readonly pathHash: LowerHexSha256;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ImmutableUpdateConstructionRefV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
}

/**
 * Spec 2 §9.2's `update_construction_cleanup` closure arm: the frontier recovery found with no
 * outer coordinator plan. Every arm compensates; none resumes planner or target work.
 */
export interface UpdateConstructionClosureV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly construction:
    | { readonly frontier: "plan_pending" }
    | { readonly frontier: "journal_bootstrap"; readonly journal: "absent" | "pending"; readonly operation: UpdateConstructionPlanV1["operation"]; readonly constructionPlanHash: LowerHexSha256 }
    | { readonly frontier: "journal" | "plan_only_suffix"; readonly operation: UpdateConstructionPlanV1["operation"]; readonly constructionPlanHash: LowerHexSha256 };
}

/** The exact construction-envelope names beside the coordinator staging root. */
export interface UpdateConstructionEnvelopePathsV1 {
  readonly plan: CanonicalAbsolutePathV1;
  readonly planPending: CanonicalAbsolutePathV1;
  readonly journal: CanonicalAbsolutePathV1;
  readonly journalPending: CanonicalAbsolutePathV1;
  readonly journalRewritePending: CanonicalAbsolutePathV1;
}

/** One file row before ordinals, parents, and projection hashes are derived. */
export type UpdateConstructionFileInputRoleV1 =
  | Extract<UpdateConstructionFileRoleV1, { readonly kind: "immutable_plan" | "initial_journal" | "recovery_executor" }>
  | { readonly kind: "payload"; readonly payloadKind: UpdateConstructionPayloadKindV1; readonly source: UpdateConstructionPayloadSourceV1 };

export interface UpdateConstructionFileInputV1 {
  readonly role: UpdateConstructionFileInputRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
}

export interface UpdateConstructionPlanInputV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: UpdateConstructionPlanV1["operation"];
  readonly executionBindingHash: LowerHexSha256;
  readonly stagingRoot: UpdateConstructionStagingRootV1;
  /** Every row in the exact §9.2 concatenation order; row `n` becomes construction ordinal `n`. */
  readonly files: readonly UpdateConstructionFileInputV1[];
  readonly rollbackSource: {
    readonly sourcePlanId: SafeReasonCodeV1;
    readonly payloadId: RollbackPayloadIdV1;
    readonly rollbackBindingHash: LowerHexSha256;
    readonly inventoryHash: LowerHexSha256;
    readonly sources: readonly UpdateConstructionRollbackEntrySourceV1[];
  } | null;
  /** The in-memory private candidate; `null` only for a manual rollback, which runs no planner. */
  readonly candidate: PreparedUpdateCandidateV1 | null;
  readonly constructionJournalCreatedAt: UtcTimestampV1;
  readonly outerJournalCreatedAt: UtcTimestampV1;
  readonly outerPlanPath: ExactProductStatePathV1;
  readonly outerJournalPath: ExactProductStatePathV1;
}

/** One legal construction-journal transition; the next journal is derived, never supplied. */
export type UpdateConstructionStepV1 =
  | { readonly kind: "directory_intent" }
  | { readonly kind: "directory_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "directory_complete" }
  | { readonly kind: "file_intent" }
  | { readonly kind: "file_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "evidence_intent" }
  | { readonly kind: "evidence_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "file_complete" }
  | { readonly kind: "source_consumer_complete" }
  | { readonly kind: "sources_staging" }
  | { readonly kind: "files_ready" }
  | { readonly kind: "outer_intent"; readonly file: UpdateConstructionOuterFileV1 }
  | { readonly kind: "outer_created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly kind: "outer_complete" }
  | { readonly kind: "compensate" }
  | { readonly kind: "compensation_step" }
  | { readonly kind: "compaction_step" };

export const MAXIMUM_CONSTRUCTION_PLAN_BYTES = 536_870_912;
export const MAXIMUM_CONSTRUCTION_JOURNAL_BYTES = 67_108_864;
export const MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES = 1024;
export const MAXIMUM_LEAF_PLAN_BYTES = 16_777_216;
export const MAXIMUM_PARTICIPANT_JOURNAL_BYTES = 1_048_576;
export const MAXIMUM_RECOVERY_EXECUTOR_BYTES = 16_384;

const MAX_DIRECTORIES = 200_000;
const MAX_FILES = 1_100_000;
const MAX_FRAMES = 1_000_000;
const MAX_FRAME_BYTES = 16_777_216;
const MAX_ROLLBACK_ENTRIES = 1_000_000;
const MAX_LEAF_ID_BYTES = 106;
const PAYLOAD_SOURCE_ORDER: readonly UpdateConstructionPayloadSourceV1["kind"][] = ["planner_output", "signed_bundle_entry", "guarded_preimage", "plan_derived"];
const SOURCE_JOURNAL_KINDS: readonly UpdateConstructionJournalKindV1[] = ["bundle_source_staging", "rollback_payload_source"];
/** P1 (D72): each planned source's fixed parent is a construction directory under `update/source`. */
const SOURCE_PARENTS = [["bundle_source_staging", "update/source/bundle"], ["rollback_payload_source", "update/source/rollback"]] as const;
const TARGET_JOURNAL_KINDS: readonly UpdateTargetJournalKindV1[] = ["bundle_publication", "owner_update", "owner_external_effect", "schema_migration", "manifest_state", "release_trust_state", "active_release_state", "rollback_record_state", "rollback_payload_state"];
const LEAF_KINDS: readonly UpdateLeafPlanKindV1[] = ["update_execution", "bundle_source_staging", "bundle_publication", "owner_update", "owner_external_effect", "schema_migration", "manifest_state", "release_trust_state", "active_release_state", "rollback_record_state", "rollback_payload_source", "rollback_payload_state", "target_verification", "terminal_retirement"];
const PHASES: readonly UpdateConstructionPhaseV1[] = ["planned", "directories_staging", "files_staging", "sources_staging", "files_ready", "outer_plan_publishing", "outer_journal_publishing", "handed_off", "compensating", "rolled_back", "compacting"];
const PRE_HANDOFF: readonly UpdateConstructionPhaseV1[] = ["planned", "directories_staging", "files_staging", "sources_staging", "files_ready", "outer_plan_publishing", "outer_journal_publishing"];
const encoder = new TextEncoder();
/** A plan is immutable once built, and re-encoding up to 512 MiB per journal transition would be quadratic. */
const PLAN_HASHES = new WeakMap<UpdateConstructionPlanV1, LowerHexSha256>();
const FILE_CONSUMER_PREFIXES = new WeakMap<UpdateConstructionPlanV1, readonly number[]>();

const PLAN_KEYS = ["schemaVersion", "coordinatorId", "operation", "executionBindingHash", "stagingRoot", "directories", "files", "outputFrames", "rollbackSource", "constructionJournalCreatedAt", "outerJournalCreatedAt", "outerPlanPath", "outerJournalPath", "maximumPlanBytes", "maximumJournalBytes", "maximumEvidenceBytes"];
const JOURNAL_KEYS = ["schemaVersion", "coordinatorId", "constructionPlanHash", "phase", "nextDirectory", "directoryWriteState", "directoryIdentities", "nextFile", "fileWriteState", "nextOutputFrame", "nextOutputConsumer", "outerPlan", "outerPlanWriteState", "outerPlanIdentity", "outerJournal", "outerJournalWriteState", "outerJournalIdentity", "compensationNext", "compensationPart", "compensationDirectoryNext", "compactionNext", "compactionDirectoryNext", "createdAt", "updatedAt"];
const EVIDENCE_KEYS = ["schemaVersion", "coordinatorId", "constructionPlanHash", "ordinal", "pathHash", "bytes", "sha256", "mode", "dev", "ino"];
const GUARDED_PREIMAGE_KEYS = ["kind", "authority", "path", "ownerUid", "mode", "nlink", "bytes", "sha256", "dev", "ino"];
const PLAN_REF_KEYS = ["kind", "id", "path", "hash", "bytes"];

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return value as Readonly<Record<string, unknown>>;
}

/** Exact key set: no unknown, missing, or duplicate key survives canonical decoding either. */
function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = record(value, label);
  const present = Object.keys(input);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) fail(`${label}: keys`);
  return input;
}

function list(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(label);
  return value as readonly unknown[];
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function nullableInteger(value: unknown, minimum: number, maximum: number, label: string): number | null {
  return value === null ? null : integer(value, minimum, maximum, label);
}

function oneOf<T>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) fail(label);
  return value as T;
}

function sha256Hex(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function canonical(value: unknown): CanonicalJsonV1 {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

/** SHA-256 over an ASCII domain, NUL, and the canonical bytes without their LF. */
function noLfHash(domain: string, value: unknown): LowerHexSha256 {
  return createHash("sha256").update(`${domain}\0`, "ascii").update(canonical(value).slice(0, -1), "utf8").digest("hex") as LowerHexSha256;
}

function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function below(path: string, root: string): boolean {
  return path.startsWith(`${root}/`);
}

export function updateConstructionEnvelopePaths(stagingRoot: CanonicalAbsolutePathV1): UpdateConstructionEnvelopePathsV1 {
  const at = (name: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(`${stagingRoot}/${name}`);
  return {
    plan: at("update-construction.plan.json"),
    planPending: at("update-construction.plan.pending"),
    journal: at("update-construction.journal.json"),
    journalPending: at("update-construction.journal.pending"),
    journalRewritePending: at("update-construction.journal.rewrite.pending"),
  };
}

/** `staging/lifecycle/<coordinator-id>/update/plans/<kind>/<id>.plan.json`, after the ID arm is enforced. */
export function updateLeafPlanPath(stagingRoot: CanonicalAbsolutePathV1, kind: UpdateLeafPlanKindV1, id: unknown): CanonicalAbsolutePathV1 {
  const leaf = parseLeafPlanId(kind, id);
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/plans/${kind}/${leaf}.plan.json`);
}

/** §9.2 names two staged records, `initial.json` then `terminal.json`, under `update/recovery-executor/`. */
export function updateRecoveryExecutorStagedPath(stagingRoot: CanonicalAbsolutePathV1, state: "executing" | "terminal_cleanup"): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/recovery-executor/${state === "executing" ? "initial" : "terminal"}.json`);
}

export function updateConstructionEvidencePath(stagingRoot: CanonicalAbsolutePathV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/construction/evidence/${encodeTenDigitOrdinal(integer(ordinal, 0, MAX_FILES - 1, "construction file ordinal"))}.json`);
}

/** `UpdateLeafPlanIdV1` is enforced before any path is built; a wider safe-code parse never narrows it. */
export function parseLeafPlanId(kind: UpdateLeafPlanKindV1, value: unknown): LeafId {
  if (typeof value !== "string" || utf8Bytes(value) > MAX_LEAF_ID_BYTES || value.includes("/") || value.startsWith(".")) fail("UpdateLeafPlanIdV1");
  if (kind === "schema_migration") return parseSchemaMigrationId(value);
  if (kind === "manifest_state") return parseManifestParticipantId(value, null);
  if (kind === "owner_external_effect") return parseAllocatedLifecycleId("oe", value, null);
  return parseSafeReasonCode(value);
}

export function payloadSourceProjectionHash(source: UpdateConstructionPayloadSourceV1): LowerHexSha256 {
  return noLfHash(`developer-os/update-construction-payload-source/${source.kind}/v1`, source);
}

export function rollbackEntrySourceProjectionHash(source: UpdateConstructionRollbackEntrySourceV1): LowerHexSha256 {
  return noLfHash(`developer-os/update-rollback-entry-source/${source.kind}/v1`, source);
}

export function rollbackSourceEntriesProjectionHash(source: Pick<UpdateConstructionRollbackSourceV1, "payloadId" | "rollbackBindingHash" | "inventoryHash" | "entries">): LowerHexSha256 {
  return noLfHash("developer-os/update-rollback-source-entries/v1", {
    payloadId: source.payloadId,
    rollbackBindingHash: source.rollbackBindingHash,
    inventoryHash: source.inventoryHash,
    entries: source.entries,
  });
}

/** The persisted bytes: canonical JSON plus one LF. */
export function constructionPlanBytes(plan: UpdateConstructionPlanV1): Uint8Array {
  return encoder.encode(canonical(plan));
}

/** §9.2's sole size/domain exception: `developer-os/update-construction/v1\0` over JSON plus LF. */
export function constructionPlanHash(plan: UpdateConstructionPlanV1): LowerHexSha256 {
  let hash = PLAN_HASHES.get(plan);
  if (hash === undefined) {
    hash = createHash("sha256").update("developer-os/update-construction/v1\0", "ascii").update(constructionPlanBytes(plan)).digest("hex") as LowerHexSha256;
    PLAN_HASHES.set(plan, hash);
  }
  return hash;
}

export function constructionPlanRef(plan: UpdateConstructionPlanV1): ImmutableUpdateConstructionRefV1 {
  return { path: updateConstructionEnvelopePaths(plan.stagingRoot.path).plan, hash: constructionPlanHash(plan), bytes: constructionPlanBytes(plan).byteLength };
}

/** Lower rank files first: plans, source journals, payloads by source kind, target journals, recovery records. */
function fileRank(role: UpdateConstructionFileInputRoleV1): number {
  switch (role.kind) {
    case "immutable_plan":
      return 0;
    case "initial_journal": {
      const source = SOURCE_JOURNAL_KINDS.indexOf(role.journalKind);
      return source === -1 ? 3 + PAYLOAD_SOURCE_ORDER.length : 1 + source;
    }
    case "payload":
      return 3 + PAYLOAD_SOURCE_ORDER.indexOf(role.source.kind);
    case "recovery_executor":
      return role.state === "executing" ? 9 : 10;
  }
}

const PLANNER_RANK = 3;

function checkPlanRef(value: unknown, kind: UpdateLeafPlanKindV1, stagingRoot: CanonicalAbsolutePathV1, label: string): ImmutableUpdatePlanRefV1 {
  const ref = exact(value, PLAN_REF_KEYS, label);
  if (ref.kind !== kind) fail(`${label}.kind`);
  if (ref.path !== updateLeafPlanPath(stagingRoot, kind, ref.id)) fail(`${label}.path`);
  parseLowerHexSha256(ref.hash);
  integer(ref.bytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.bytes`);
  return ref as unknown as ImmutableUpdatePlanRefV1;
}

/** `value` is the complete canonical JSON (with its LF); `valueBytes` is its no-LF length. */
function checkDerivedValue(value: unknown, valueBytes: unknown, maximum: number, label: string): { readonly bytes: number; readonly sha256: LowerHexSha256 } {
  if (typeof value !== "string" || !value.endsWith("\n")) fail(`${label}.value`);
  const bytes = encoder.encode(value);
  if (bytes.byteLength > maximum + 1) fail(`${label}.value: exceeds its bound`);
  const decoded = decodeCanonicalJson(bytes, maximum + 1);
  if (canonical(decoded) !== value) fail(`${label}.value: not canonical`);
  if (integer(valueBytes, 1, maximum, `${label}.valueBytes`) !== bytes.byteLength - 1) fail(`${label}.valueBytes`);
  return { bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
}

/**
 * A lifecycle Foundation initial journal is Spec 1's planned `FoundationJournalJsonV1`, not canonical
 * JSON: the unchanged executor rereads and re-encodes it byte for byte (spec:957 as amended by D60).
 */
function checkFoundationJournalValue(value: unknown, valueBytes: unknown, id: unknown, label: string): { readonly bytes: number; readonly sha256: LowerHexSha256 } {
  if (typeof value !== "string" || !value.endsWith("\n")) fail(`${label}.value`);
  const bytes = encoder.encode(value);
  if (bytes.byteLength > MAXIMUM_PARTICIPANT_JOURNAL_BYTES) fail(`${label}.value: exceeds its bound`);
  let journal: TransactionJournalV1;
  try {
    journal = validateJournal(JSON.parse(value) as unknown);
  } catch {
    return fail(`${label}.value: not a Foundation journal`);
  }
  if (encodeFoundationJournalJsonV1(journal) !== value || journal.id !== id || journal.phase !== "planned" || journal.createdAt !== journal.updatedAt) fail(`${label}.value: not the planned journal`);
  if (integer(valueBytes, 1, MAXIMUM_PARTICIPANT_JOURNAL_BYTES - 1, `${label}.valueBytes`) !== bytes.byteLength - 1) fail(`${label}.valueBytes`);
  return { bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
}

function checkGuardedPreimage(source: Readonly<Record<string, unknown>>, stagingRoot: CanonicalAbsolutePathV1, label: string): string {
  exact(source, GUARDED_PREIMAGE_KEYS, label);
  const authority = record(source.authority, `${label}.authority`);
  switch (authority.kind) {
    case "owner_operation_before":
      exact(authority, ["kind", "ownerPlan", "operationOrdinal"], `${label}.authority`);
      checkPlanRef(authority.ownerPlan, "owner_update", stagingRoot, `${label}.authority.ownerPlan`);
      integer(authority.operationOrdinal, 0, 999_999, `${label}.authority.operationOrdinal`);
      break;
    case "schema_migration_before":
      exact(authority, ["kind", "migrationPlan", "mutationOrdinal"], `${label}.authority`);
      checkPlanRef(authority.migrationPlan, "schema_migration", stagingRoot, `${label}.authority.migrationPlan`);
      integer(authority.mutationOrdinal, 0, 99_999, `${label}.authority.mutationOrdinal`);
      break;
    case "foundation_expected_before":
      exact(authority, ["kind", "participant", "mutationOrdinal"], `${label}.authority`);
      record(authority.participant, `${label}.authority.participant`);
      integer(authority.mutationOrdinal, 0, 255, `${label}.authority.mutationOrdinal`);
      break;
    default:
      fail(`${label}.authority.kind`);
  }
  parseCanonicalAbsolutePathText(source.path);
  integer(source.ownerUid, 0, 4_294_967_295, `${label}.ownerUid`);
  oneOf(source.mode, [384, 448], `${label}.mode`);
  if (source.nlink !== 1) fail(`${label}.nlink`);
  integer(source.bytes, 0, MAX_FRAME_BYTES, `${label}.bytes`);
  parseLowerHexSha256(source.sha256);
  parseUInt64Decimal(source.dev);
  parseUInt64Decimal(source.ino);
  return canonical(authority);
}

/** The payload arm's legality for its row, returning the authority key a guarded preimage selects. */
function checkPayloadSource(row: UpdateConstructionFilePlanV1, payloadKind: UpdateConstructionPayloadKindV1, source: Readonly<Record<string, unknown>>, stagingRoot: CanonicalAbsolutePathV1, label: string): string | null {
  const matches = (bytes: unknown, sha256: unknown, mode: unknown): boolean => bytes === row.bytes && sha256 === row.sha256 && mode === row.mode;
  switch (source.kind) {
    case "planner_output":
      exact(source, ["kind", "ordinal"], label);
      integer(source.ordinal, 0, MAX_FRAMES - 1, `${label}.ordinal`);
      oneOf(payloadKind, ["owner_content", "migration_content"], `${label}: planner output for ${payloadKind}`);
      return null;
    case "signed_bundle_entry":
      exact(source, ["kind", "release", "root", "rootDev", "rootIno", "inventoryHash", "relativePath", "sourceBytes", "sourceHash", "sourceMode", "sourceDev", "sourceIno"], label);
      oneOf(payloadKind, ["foundation_content", "owner_content"], `${label}: bundle entry for ${payloadKind}`);
      record(source.release, `${label}.release`);
      parseCanonicalAbsolutePathText(source.root);
      parseBundleRelativePath(source.relativePath);
      for (const key of ["rootDev", "rootIno", "sourceDev", "sourceIno"]) parseUInt64Decimal(source[key]);
      parseLowerHexSha256(source.inventoryHash);
      integer(source.sourceBytes, 0, MAXIMUM_CONSTRUCTION_PLAN_BYTES, `${label}.sourceBytes`);
      if (!matches(source.sourceBytes, source.sourceHash, source.sourceMode)) fail(`${label}: differs from its row`);
      return null;
    case "guarded_preimage": {
      oneOf(payloadKind, ["foundation_content", "owner_content", "migration_content"], `${label}: preimage for ${payloadKind}`);
      const key = checkGuardedPreimage(source, stagingRoot, label);
      const expectedAuthority = { foundation_content: "foundation_expected_before", owner_content: "owner_operation_before", migration_content: "schema_migration_before" }[payloadKind as "foundation_content"];
      if (record(source.authority, label).kind !== expectedAuthority) fail(`${label}: authority does not match ${payloadKind}`);
      if (!matches(source.bytes, source.sha256, source.mode)) fail(`${label}: differs from its row`);
      return key;
    }
    case "plan_derived": {
      if (source.role === "foundation_staged_digest") {
        exact(source, ["kind", "role", "contentHash", "value", "valueBytes"], label);
        if (payloadKind !== "foundation_digest") fail(`${label}: Foundation digest for ${payloadKind}`);
        const expected = `${parseLowerHexSha256(source.contentHash)}\n`;
        if (source.value !== expected || source.valueBytes !== 64) fail(`${label}.value: not the content hash sidecar`);
        if (row.bytes !== 65 || row.sha256 !== sha256Hex(expected) || row.mode !== 384) fail(`${label}: differs from its row`);
        return null;
      }
      const foundation = source.role === "foundation_initial_journal";
      if (foundation) {
        exact(source, ["kind", "role", "participant", "foundationPlanHash", "plannedBytesHash", "value", "valueBytes"], label);
        const participant = record(source.participant, `${label}.participant`);
        parseLowerHexSha256(source.foundationPlanHash);
        parseLowerHexSha256(source.plannedBytesHash);
        if (payloadKind !== "foundation_initial") fail(`${label}: Foundation journal for ${payloadKind}`);
        if (participant.planHash !== source.foundationPlanHash || record(participant.initialJournal, `${label}.participant.initialJournal`).plannedBytesHash !== source.plannedBytesHash) fail(`${label}: differs from its participant`);
        const derived = checkFoundationJournalValue(source.value, source.valueBytes, participant.id, label);
        if (derived.sha256 !== source.plannedBytesHash) fail(`${label}.plannedBytesHash`);
        if (derived.bytes !== row.bytes || derived.sha256 !== row.sha256 || row.mode !== 384) fail(`${label}: differs from its row`);
        return null;
      }
      let authority: string | null = null;
      if (source.role === "release_metadata_after") {
        exact(source, ["kind", "role", "metadata", "value", "valueBytes"], label);
        if (payloadKind !== "state_after") fail(`${label}: release metadata for ${payloadKind}`);
        // One row per signed document. The plan holds no release identity, so the ordinal's signed hash binds where the row is composed.
        authority = `release_metadata/${oneOf(source.metadata, [0, 1, 2], `${label}.metadata`).toString(10)}`;
      } else {
        exact(source, ["kind", "role", "plan", "value", "valueBytes"], label);
        const kinds = { manifest_after: "manifest_state", release_trust_after: "release_trust_state", active_release_after: "active_release_state", rollback_record_after: "rollback_record_state" } as const;
        const role = oneOf(source.role, Object.keys(kinds) as (keyof typeof kinds)[], `${label}.role`);
        checkPlanRef(source.plan, kinds[role], stagingRoot, `${label}.plan`);
        if (payloadKind !== "state_after") fail(`${label}: plan-derived state for ${payloadKind}`);
      }
      const derived = checkDerivedValue(source.value, source.valueBytes, MAXIMUM_CONSTRUCTION_JOURNAL_BYTES - 1, label);
      if (derived.bytes !== row.bytes || derived.sha256 !== row.sha256 || row.mode !== 384) fail(`${label}: differs from its row`);
      return authority;
    }
    default:
      return fail(`${label}.kind`);
  }
}

function checkRollbackEntrySource(entry: UpdateConstructionRollbackSourceEntryV1, stagingRoot: CanonicalAbsolutePathV1, label: string): string | null {
  const source = record(entry.source, `${label}.source`);
  const role = entry.entry.role;
  switch (source.kind) {
    case "planner_output":
      exact(source, ["kind", "ordinal"], `${label}.source`);
      integer(source.ordinal, 0, MAX_FRAMES - 1, `${label}.source.ordinal`);
      if (role !== "migration_preimage") fail(`${label}: planner output for ${role}`);
      return null;
    case "guarded_preimage": {
      const key = checkGuardedPreimage(source, stagingRoot, `${label}.source`);
      const expected = role === "owner_preimage" ? "owner_operation_before" : role === "migration_preimage" ? "schema_migration_before" : null;
      if (expected === null || record(source.authority, label).kind !== expected) fail(`${label}: preimage authority for ${role}`);
      if (source.bytes !== entry.entry.bytes || source.sha256 !== entry.entry.sha256) fail(`${label}: differs from its inventory row`);
      return key;
    }
    case "plan_derived": {
      exact(source, ["kind", "role", "plan", "value", "valueBytes"], `${label}.source`);
      if (role !== "inverse_plan_leaf") fail(`${label}: plan-derived source for ${role}`);
      const kind = source.role === "owner_inverse_plan" ? "owner_update" : source.role === "schema_migration_inverse_plan" ? "schema_migration" : fail(`${label}.source.role`);
      checkPlanRef(source.plan, kind, stagingRoot, `${label}.source.plan`);
      const derived = checkDerivedValue(source.value, source.valueBytes, MAXIMUM_LEAF_PLAN_BYTES - 1, `${label}.source`);
      if (derived.bytes !== entry.entry.bytes || derived.sha256 !== entry.entry.sha256) fail(`${label}: differs from its inventory row`);
      return null;
    }
    default:
      return fail(`${label}.source.kind: ${role} has no admitted source`);
  }
}

/** §5.3/§9.2 payload paths; a release-metadata row's path derives from its bundle plan, which this plan does not hold. */
function derivedPayloadPath(root: string, ordinal: number, payloadKind: UpdateConstructionPayloadKindV1, role: Extract<UpdateConstructionFileRoleV1, { readonly kind: "payload" }>): string | null {
  const source = role.source;
  if (payloadKind === "foundation_content" || payloadKind === "foundation_digest" || payloadKind === "owner_content" || payloadKind === "migration_content") return `${root}/update/payloads/${encodeTenDigitOrdinal(ordinal)}.payload`;
  if (source.kind !== "plan_derived") return null;
  switch (source.role) {
    case "foundation_initial_journal":
      return `${root}/participants/foundation/${source.participant.id}/initial-journal.json`;
    case "foundation_staged_digest":
    case "release_metadata_after":
      return null;
    case "manifest_after":
      return `${root}/participants/manifest/${source.plan.id}/after.json`;
    case "release_trust_after":
      return `${root}/update/payloads/state/release_trust/${source.plan.id}.json`;
    case "active_release_after":
      return `${root}/update/payloads/state/active_release/${source.plan.id}.json`;
    case "rollback_record_after":
      return `${root}/update/payloads/state/rollback_record/${source.plan.id}.json`;
  }
}

function checkParent(parent: UpdateConstructionParentV1, path: string, plan: UpdateConstructionPlanV1, directoryCount: number, label: string): void {
  const input = record(parent, `${label}.parent`);
  let parentPath: string;
  if (input.kind === "staging_root") {
    exact(input, ["kind", "path", "dev", "ino"], `${label}.parent`);
    if (input.path !== plan.stagingRoot.path || input.dev !== plan.stagingRoot.dev || input.ino !== plan.stagingRoot.ino) fail(`${label}.parent: not the guarded staging root`);
    parentPath = plan.stagingRoot.path;
  } else {
    exact(input, ["kind", "ordinal"], `${label}.parent`);
    if (input.kind !== "created_directory") fail(`${label}.parent.kind`);
    parentPath = (plan.directories[integer(input.ordinal, 0, directoryCount - 1, `${label}.parent.ordinal`)] as UpdateConstructionDirectoryPlanV1).path;
  }
  if (parentOf(path) !== parentPath) fail(`${label}.parent: not the path's parent`);
}

/**
 * Spec 2 §9.2: proves every directory/file/frame/rollback-source bijection before the first byte.
 * Directories are contiguous parent-before-child with `update` first; files are the exact ordered
 * concatenation; every output-backed row and rollback-source entry is consumed exactly once; every
 * projection hash recomputes; no guarded authority selects two rows. Returns `true` or throws.
 */
export function validateConstructionBijections(plan: UpdateConstructionPlanV1): true {
  const label = "UpdateConstructionPlanV1";
  const input = exact(plan, PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const operation = oneOf(input.operation, ["update_apply", "update_rollback"] as const, `${label}.operation`);
  parseLowerHexSha256(input.executionBindingHash);
  const root = exact(input.stagingRoot, ["path", "ownerUid", "mode", "dev", "ino"], `${label}.stagingRoot`);
  const rootPath = parseCanonicalAbsolutePathText(root.path);
  if (typeof input.coordinatorId !== "string" || !rootPath.endsWith(`/staging/lifecycle/${input.coordinatorId}`)) fail(`${label}.stagingRoot.path: not this coordinator's staging root`);
  if (root.mode !== 448) fail(`${label}.stagingRoot.mode`);
  const ownerUid = integer(root.ownerUid, 0, 4_294_967_295, `${label}.stagingRoot.ownerUid`);
  parseUInt64Decimal(root.dev);
  parseUInt64Decimal(root.ino);
  parseUtcTimestamp(input.constructionJournalCreatedAt);
  parseUtcTimestamp(input.outerJournalCreatedAt);
  const outerPlanPath = parseCanonicalAbsolutePathText(input.outerPlanPath);
  const outerJournalPath = parseCanonicalAbsolutePathText(input.outerJournalPath);
  if (outerPlanPath === outerJournalPath || below(outerPlanPath, rootPath) || below(outerJournalPath, rootPath)) fail(`${label}: outer paths`);
  integer(input.maximumPlanBytes, 1, MAXIMUM_CONSTRUCTION_PLAN_BYTES, `${label}.maximumPlanBytes`);
  integer(input.maximumJournalBytes, 1, MAXIMUM_CONSTRUCTION_JOURNAL_BYTES, `${label}.maximumJournalBytes`);
  if (input.maximumEvidenceBytes !== MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES) fail(`${label}.maximumEvidenceBytes`);

  const envelope = new Set(Object.values(updateConstructionEnvelopePaths(rootPath)) as string[]);
  const paths = new Set<string>(envelope);
  const claim = (path: string, rowLabel: string): void => {
    if (paths.has(path) || path === outerPlanPath || path === outerJournalPath) fail(`${rowLabel}.path: duplicate`);
    paths.add(path);
  };

  const directories = list(input.directories, 1, MAX_DIRECTORIES, `${label}.directories`) as readonly UpdateConstructionDirectoryPlanV1[];
  const directoryParents = new Set<string>();
  directories.forEach((directory, index) => {
    const rowLabel = `${label}.directories[${index.toString(10)}]`;
    const fields = exact(directory, ["ordinal", "path", "expectedBefore", "ownerUid", "mode", "parent"], rowLabel);
    if (fields.ordinal !== index || fields.expectedBefore !== "absent" || fields.mode !== 448 || fields.ownerUid !== ownerUid) fail(rowLabel);
    const path = parseCanonicalAbsolutePathText(directory.path);
    if (!below(path, rootPath)) fail(`${rowLabel}.path: outside the staging root`);
    if (index === 0 && path !== `${rootPath}/update`) fail(`${rowLabel}: not the update child`);
    checkParent(directory.parent, path, plan, index, rowLabel);
    claim(path, rowLabel);
    directoryParents.add(parentOf(path));
  });
  const evidenceDirectory = `${rootPath}/update/construction/evidence`;
  if (!directories.some((directory) => directory.path === evidenceDirectory)) fail(`${label}.directories: no evidence directory`);

  const files = list(input.files, 1, MAX_FILES, `${label}.files`) as readonly UpdateConstructionFilePlanV1[];
  const leafPlans = new Set<string>();
  const finalPaths = new Set<string>();
  const authorities = new Set<string>();
  const entryAuthorities = new Set<string>();
  const plannerRows: number[] = [];
  let rank = 0;
  let executionPlans = 0;
  const recoveryStates: string[] = [];
  // "No authority may select two construction rows": files and rollback-source entries are separate sets.
  const takeAuthority = (taken: Set<string>, key: string | null, rowLabel: string): void => {
    if (key === null) return;
    if (taken.has(key)) fail(`${rowLabel}: an authority selects two rows`);
    taken.add(key);
  };
  files.forEach((row, index) => {
    const rowLabel = `${label}.files[${index.toString(10)}]`;
    exact(row, ["ordinal", "role", "path", "parent", "bytes", "sha256", "mode"], rowLabel);
    if (row.ordinal !== index) fail(`${rowLabel}.ordinal`);
    const path = parseCanonicalAbsolutePathText(row.path);
    if (!below(path, rootPath)) fail(`${rowLabel}.path: outside the staging root`);
    checkParent(row.parent, path, plan, directories.length, rowLabel);
    claim(path, rowLabel);
    directoryParents.add(parentOf(path));
    integer(row.bytes, 0, MAXIMUM_CONSTRUCTION_PLAN_BYTES, `${rowLabel}.bytes`);
    parseLowerHexSha256(row.sha256);
    oneOf(row.mode, [384, 448], `${rowLabel}.mode`);
    const role = record(row.role, `${rowLabel}.role`);
    switch (role.kind) {
      case "immutable_plan": {
        exact(role, ["kind", "planKind", "id"], `${rowLabel}.role`);
        const kind = oneOf(role.planKind, LEAF_KINDS, `${rowLabel}.role.planKind`);
        if (path !== updateLeafPlanPath(rootPath, kind, role.id)) fail(`${rowLabel}.path: not the derived leaf path`);
        if (row.bytes < 1 || row.bytes > MAXIMUM_LEAF_PLAN_BYTES || row.mode !== 384) fail(`${rowLabel}: leaf plan bounds`);
        leafPlans.add(`${kind}/${String(role.id)}`);
        if (kind === "update_execution") executionPlans += 1;
        break;
      }
      case "initial_journal": {
        exact(role, ["kind", "journalKind", "id", "finalPath"], `${rowLabel}.role`);
        const kind = oneOf(role.journalKind, [...TARGET_JOURNAL_KINDS, ...SOURCE_JOURNAL_KINDS], `${rowLabel}.role.journalKind`);
        parseLeafPlanId(kind, role.id);
        if (!leafPlans.has(`${kind}/${String(role.id)}`)) fail(`${rowLabel}: a journal without its immutable plan`);
        const finalPath = parseCanonicalAbsolutePathText(role.finalPath);
        const source = SOURCE_JOURNAL_KINDS.includes(kind);
        // A source journal is rewritten in place before handoff; a target journal moves at its outer step.
        if (source !== (finalPath === path)) fail(`${rowLabel}.role.finalPath`);
        if (finalPaths.has(finalPath) || (!source && paths.has(finalPath))) fail(`${rowLabel}.role.finalPath: duplicate`);
        finalPaths.add(finalPath);
        if (row.bytes < 1 || row.bytes > MAXIMUM_PARTICIPANT_JOURNAL_BYTES || row.mode !== 384) fail(`${rowLabel}: journal bounds`);
        break;
      }
      case "payload": {
        exact(role, ["kind", "payloadKind", "source", "sourceProjectionHash"], `${rowLabel}.role`);
        const payloadKind = oneOf(role.payloadKind, ["foundation_initial", "foundation_content", "foundation_digest", "owner_content", "migration_content", "state_after"] as const, `${rowLabel}.role.payloadKind`);
        const source = record(role.source, `${rowLabel}.role.source`);
        takeAuthority(authorities, checkPayloadSource(row, payloadKind, source, rootPath, `${rowLabel}.role.source`), rowLabel);
        const derived = derivedPayloadPath(rootPath, index, payloadKind, row.role as Extract<UpdateConstructionFileRoleV1, { readonly kind: "payload" }>);
        if (derived !== null && derived !== path) fail(`${rowLabel}.path: not the derived payload path`);
        if (role.sourceProjectionHash !== payloadSourceProjectionHash(source as unknown as UpdateConstructionPayloadSourceV1)) fail(`${rowLabel}.role.sourceProjectionHash`);
        if (source.kind === "planner_output") plannerRows.push(index);
        break;
      }
      case "recovery_executor": {
        exact(role, ["kind", "state"], `${rowLabel}.role`);
        const state = oneOf(role.state, ["executing", "terminal_cleanup"] as const, `${rowLabel}.role.state`);
        recoveryStates.push(state);
        if (path !== updateRecoveryExecutorStagedPath(rootPath, state)) fail(`${rowLabel}.path: not the derived recovery-record path`);
        if (row.bytes < 1 || row.bytes > MAXIMUM_RECOVERY_EXECUTOR_BYTES || row.mode !== 384) fail(`${rowLabel}: recovery record bounds`);
        break;
      }
      default:
        fail(`${rowLabel}.role.kind`);
    }
    const next = fileRank(row.role);
    if (next < rank) fail(`${rowLabel}: out of the exact file order`);
    rank = next;
  });
  if (executionPlans !== 1) fail(`${label}.files: not exactly one update_execution plan`);
  if (recoveryStates.join(",") !== "executing,terminal_cleanup" || files.length < 2) fail(`${label}.files: the two recovery records`);
  const sourceParents = new Set<string>();
  for (const [kind, relative] of SOURCE_PARENTS) {
    const parent = `${rootPath}/${relative}`;
    const planned = [...leafPlans].some((key) => key.startsWith(`${kind}/`));
    if (planned !== directories.some((directory) => directory.path === parent)) fail(`${label}.directories: ${relative} without exactly its source plan row`);
    if (planned) sourceParents.add(parent);
  }
  if (directories.some((directory) => directory.path !== evidenceDirectory && !sourceParents.has(directory.path) && !directoryParents.has(directory.path))) fail(`${label}.directories: an unused directory`);

  // Rollback source: present exactly for apply, its entries contiguous and hashed both ways.
  const rollback = input.rollbackSource as UpdateConstructionRollbackSourceV1 | null;
  const plannerEntries: number[] = [];
  if ((rollback === null) !== (operation === "update_rollback")) fail(`${label}.rollbackSource: presence`);
  if (rollback !== null) {
    exact(rollback, ["sourcePlanId", "payloadId", "rollbackBindingHash", "inventoryHash", "entriesProjectionHash", "entries"], `${label}.rollbackSource`);
    if (!leafPlans.has(`rollback_payload_source/${parseSafeReasonCode(rollback.sourcePlanId)}`)) fail(`${label}.rollbackSource.sourcePlanId: no source plan row`);
    parseRollbackPayloadId(rollback.payloadId);
    parseLowerHexSha256(rollback.rollbackBindingHash);
    parseLowerHexSha256(rollback.inventoryHash);
    const entries = list(rollback.entries, 1, MAX_ROLLBACK_ENTRIES, `${label}.rollbackSource.entries`) as readonly UpdateConstructionRollbackSourceEntryV1[];
    entries.forEach((entry, index) => {
      const entryLabel = `${label}.rollbackSource.entries[${index.toString(10)}]`;
      exact(entry, ["ordinal", "entry", "source", "sourceProjectionHash"], entryLabel);
      exact(entry.entry, ["ordinal", "path", "role", "bytes", "sha256"], `${entryLabel}.entry`);
      if (entry.ordinal !== index || entry.entry.ordinal !== index) fail(`${entryLabel}.ordinal`);
      takeAuthority(entryAuthorities, checkRollbackEntrySource(entry, rootPath, entryLabel), entryLabel);
      if (entry.sourceProjectionHash !== rollbackEntrySourceProjectionHash(entry.source)) fail(`${entryLabel}.sourceProjectionHash`);
      if (entry.source.kind === "planner_output") plannerEntries.push(index);
    });
    if (rollback.entriesProjectionHash !== rollbackSourceEntriesProjectionHash(rollback)) fail(`${label}.rollbackSource.entriesProjectionHash`);
  }

  // Output frames: contiguous, each consumer an output-backed row of the same ordinal, each consumed once.
  const frames = list(input.outputFrames, 0, MAX_FRAMES, `${label}.outputFrames`) as readonly UpdateConstructionOutputFrameV1[];
  const consumedFiles: number[] = [];
  const consumedEntries = new Set<number>();
  let consumerTotal = 0;
  frames.forEach((frame, index) => {
    const frameLabel = `${label}.outputFrames[${index.toString(10)}]`;
    exact(frame, ["ordinal", "bytes", "sha256", "consumers"], frameLabel);
    if (frame.ordinal !== index) fail(`${frameLabel}.ordinal`);
    integer(frame.bytes, 0, MAX_FRAME_BYTES, `${frameLabel}.bytes`);
    parseLowerHexSha256(frame.sha256);
    const consumers = list(frame.consumers, 1, MAX_FRAMES, `${frameLabel}.consumers`) as readonly UpdateConstructionOutputConsumerV1[];
    consumerTotal += consumers.length;
    if (consumerTotal > MAX_FILES + MAX_ROLLBACK_ENTRIES) fail(`${frameLabel}.consumers: more than the plan bound`);
    for (const consumer of consumers) {
      exact(consumer, ["kind", "ordinal"], `${frameLabel}.consumer`);
      if (consumer.kind === "construction_file") {
        const row = files[integer(consumer.ordinal, 0, files.length - 1, `${frameLabel}.consumer.ordinal`)] as UpdateConstructionFilePlanV1;
        const source = row.role.kind === "payload" ? row.role.source : null;
        if (source?.kind !== "planner_output" || source.ordinal !== index || row.bytes !== frame.bytes || row.sha256 !== frame.sha256) fail(`${frameLabel}: consumer is not this frame's planner row`);
        consumedFiles.push(consumer.ordinal);
      } else {
        if (record(consumer, frameLabel).kind !== "rollback_source_entry") fail(`${frameLabel}.consumer.kind`);
        const entry = rollback?.entries[integer(consumer.ordinal, 0, MAX_ROLLBACK_ENTRIES - 1, `${frameLabel}.consumer.ordinal`)];
        if (entry?.source.kind !== "planner_output" || entry.source.ordinal !== index || entry.entry.bytes !== frame.bytes || entry.entry.sha256 !== frame.sha256) fail(`${frameLabel}: consumer is not this frame's rollback entry`);
        if (consumedEntries.has(consumer.ordinal)) fail(`${frameLabel}: a rollback entry consumed twice`);
        consumedEntries.add(consumer.ordinal);
      }
    }
  });
  // Planner rows are contiguous and in consumer order, so the file cursor and frame cursor move together.
  if (consumedFiles.join(",") !== plannerRows.join(",")) fail(`${label}.outputFrames: planner rows are not consumed exactly once in consumer order`);
  if (plannerEntries.length !== consumedEntries.size) fail(`${label}.outputFrames: an unconsumed rollback entry`);
  if (constructionPlanBytes(plan).byteLength > plan.maximumPlanBytes) fail(`${label}: exceeds its plan bytes`);
  return true;
}

function rootParent(root: UpdateConstructionStagingRootV1): UpdateConstructionParentV1 {
  return { kind: "staging_root", path: root.path, dev: root.dev, ino: root.ino };
}

/**
 * Spec 2 §9.2: derives the one construction plan from allocated rows and the private candidate.
 * Orders files into the exact concatenation, derives every expected-absent directory with
 * `update` first and parents before children, assigns ordinals/parents/projection hashes, and
 * binds output frames byte-for-byte to `materialization.outputBlobs`. Pure; validates before return.
 */
export function buildConstructionPlan(input: UpdateConstructionPlanInputV1): UpdateConstructionPlanV1 {
  const label = "UpdateConstructionPlanInputV1";
  const root = input.stagingRoot.path;
  // Leaf plans embed payload/journal ordinals before this runs, so rows arrive in final order; validation refuses any other.
  const ordered = input.files;

  const needed = new Set<string>([`${root}/update`, `${root}/update/construction/evidence`]);
  const sourceParents = SOURCE_PARENTS.filter(([kind]) => ordered.some((file) => file.role.kind === "immutable_plan" && file.role.planKind === kind)).map(([, relative]) => `${root}/${relative}/x`);
  for (const path of [...ordered.map((file) => file.path), `${root}/update/construction/evidence/x`, ...sourceParents]) {
    for (let parent = parentOf(path); below(parent, root); parent = parentOf(parent)) needed.add(parent);
  }
  const update = `${root}/update`;
  const directoryPaths = [...needed].sort((left, right) => {
    const leftUpdate = left === update || below(left, update);
    const rightUpdate = right === update || below(right, update);
    return leftUpdate === rightUpdate ? compareUtf8(left, right) : leftUpdate ? -1 : 1;
  });
  const directoryOrdinal = new Map(directoryPaths.map((path, ordinal) => [path, ordinal]));
  const parentFor = (path: string): UpdateConstructionParentV1 => {
    const parent = parentOf(path);
    if (parent === root) return rootParent(input.stagingRoot);
    const ordinal = directoryOrdinal.get(parent);
    return ordinal === undefined ? fail(`${label}: an underived parent`) : { kind: "created_directory", ordinal };
  };
  const directories = directoryPaths.map((path, ordinal): UpdateConstructionDirectoryPlanV1 => ({
    ordinal,
    path: parseCanonicalAbsolutePathText(path),
    expectedBefore: "absent",
    ownerUid: input.stagingRoot.ownerUid,
    mode: 448,
    parent: parentFor(path),
  }));

  const files = ordered.map((file, ordinal): UpdateConstructionFilePlanV1 => ({
    ordinal,
    role: file.role.kind === "payload" ? { ...file.role, sourceProjectionHash: payloadSourceProjectionHash(file.role.source) } : file.role,
    path: file.path,
    parent: parentFor(file.path),
    bytes: file.bytes,
    sha256: file.sha256,
    mode: file.mode,
  }));

  let rollbackSource: UpdateConstructionRollbackSourceV1 | null = null;
  const inventory = input.candidate?.materialization.rollbackInventoryEntries ?? [];
  if (input.rollbackSource !== null) {
    const sources = input.rollbackSource.sources;
    if (sources.length !== inventory.length) fail(`${label}.rollbackSource: not one source per prepared inventory row`);
    // `inventoryHash` covers the allocated payload ID, so only the entry rows compare to the candidate.
    if (input.candidate === null) fail(`${label}.rollbackSource: no prepared inventory`);
    const entries = inventory.map((entry, ordinal): UpdateConstructionRollbackSourceEntryV1 => {
      const source = sources[ordinal] as UpdateConstructionRollbackEntrySourceV1;
      return { ordinal, entry, source, sourceProjectionHash: rollbackEntrySourceProjectionHash(source) };
    });
    const partial = { payloadId: input.rollbackSource.payloadId, rollbackBindingHash: input.rollbackSource.rollbackBindingHash, inventoryHash: input.rollbackSource.inventoryHash, entries };
    rollbackSource = { sourcePlanId: input.rollbackSource.sourcePlanId, ...partial, entriesProjectionHash: rollbackSourceEntriesProjectionHash(partial) };
  }

  const blobs = input.candidate?.materialization.outputBlobs ?? [];
  const outputFrames = blobs.map((blob, ordinal): UpdateConstructionOutputFrameV1 => {
    if (blob.ordinal !== ordinal) fail(`${label}.candidate: output blobs are not contiguous`);
    const consumers: UpdateConstructionOutputConsumerV1[] = [];
    for (const file of files) {
      if (file.role.kind === "payload" && file.role.source.kind === "planner_output" && file.role.source.ordinal === ordinal) consumers.push({ kind: "construction_file", ordinal: file.ordinal });
    }
    for (const entry of rollbackSource?.entries ?? []) {
      if (entry.source.kind === "planner_output" && entry.source.ordinal === ordinal) consumers.push({ kind: "rollback_source_entry", ordinal: entry.ordinal });
    }
    if (consumers.length === 0) fail(`${label}.candidate: an output blob with no consumer`);
    return { ordinal, bytes: blob.bytes, sha256: blob.sha256, consumers };
  });

  const plan: UpdateConstructionPlanV1 = {
    schemaVersion: 1,
    coordinatorId: input.coordinatorId,
    operation: input.operation,
    executionBindingHash: input.executionBindingHash,
    stagingRoot: input.stagingRoot,
    directories,
    files,
    outputFrames,
    rollbackSource,
    constructionJournalCreatedAt: input.constructionJournalCreatedAt,
    outerJournalCreatedAt: input.outerJournalCreatedAt,
    outerPlanPath: input.outerPlanPath,
    outerJournalPath: input.outerJournalPath,
    maximumPlanBytes: MAXIMUM_CONSTRUCTION_PLAN_BYTES,
    maximumJournalBytes: MAXIMUM_CONSTRUCTION_JOURNAL_BYTES,
    maximumEvidenceBytes: MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES,
  };
  validateConstructionBijections(plan);
  return plan;
}

/** Both timestamps are the plan's, so the initial bytes never consult a dead process clock. */
export function initialConstructionJournal(plan: UpdateConstructionPlanV1): UpdateConstructionJournalV1 {
  return {
    schemaVersion: 1,
    coordinatorId: plan.coordinatorId,
    constructionPlanHash: constructionPlanHash(plan),
    phase: "planned",
    nextDirectory: 0,
    directoryWriteState: null,
    directoryIdentities: [],
    nextFile: 0,
    fileWriteState: null,
    nextOutputFrame: 0,
    nextOutputConsumer: 0,
    outerPlan: null,
    outerPlanWriteState: null,
    outerPlanIdentity: null,
    outerJournal: null,
    outerJournalWriteState: null,
    outerJournalIdentity: null,
    compensationNext: null,
    compensationPart: null,
    compensationDirectoryNext: null,
    compactionNext: null,
    compactionDirectoryNext: null,
    createdAt: plan.constructionJournalCreatedAt,
    updatedAt: plan.constructionJournalCreatedAt,
  };
}

export function constructionJournalBytes(journal: UpdateConstructionJournalV1): Uint8Array {
  return encoder.encode(canonical(journal));
}

function identityOf(value: unknown, keys: readonly string[], label: string): void {
  const input = exact(value, keys, label);
  for (const key of keys) if (key === "dev" || key === "ino" || key === "evidenceDev" || key === "evidenceIno") parseUInt64Decimal(input[key]);
}

function checkWriteState(value: unknown, label: string): UpdateConstructionWriteStateV1 | null {
  if (value === null) return null;
  const input = record(value, label);
  const keys = {
    create_intent: ["ordinal", "state"],
    created: ["ordinal", "state", "dev", "ino"],
    evidence_intent: ["ordinal", "state", "dev", "ino"],
    evidence_created: ["ordinal", "state", "dev", "ino", "evidenceDev", "evidenceIno"],
  }[oneOf(input.state, ["create_intent", "created", "evidence_intent", "evidence_created"] as const, `${label}.state`)];
  identityOf(input, keys, label);
  return input as unknown as UpdateConstructionWriteStateV1;
}

function checkOuter(file: unknown, state: unknown, identity: unknown, expectedPath: string, label: string): "absent" | "intent" | "created" | "complete" {
  if (file === null) {
    if (state !== null || identity !== null) fail(`${label}: state without a file`);
    return "absent";
  }
  const ref = exact(file, ["path", "bytes", "sha256", "mode"], label);
  if (ref.path !== expectedPath || ref.mode !== 384) fail(`${label}.path`);
  integer(ref.bytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.bytes`);
  parseLowerHexSha256(ref.sha256);
  if (identity !== null) {
    identityOf(identity, ["dev", "ino"], `${label}Identity`);
    if (state !== null) fail(`${label}: complete with a write state`);
    return "complete";
  }
  const write = record(state, `${label}WriteState`);
  if (write.state === "create_intent") {
    exact(write, ["state"], `${label}WriteState`);
    return "intent";
  }
  if (write.state !== "created") fail(`${label}WriteState.state`);
  identityOf(write, ["state", "dev", "ino"], `${label}WriteState`);
  return "created";
}

/** Output consumers of construction files strictly before the (frame, consumer) position. */
function fileConsumersBefore(plan: UpdateConstructionPlanV1, frame: number, consumer: number): number {
  let prefixes = FILE_CONSUMER_PREFIXES.get(plan);
  if (prefixes === undefined) {
    const sums = [0];
    for (const row of plan.outputFrames) sums.push((sums[sums.length - 1] as number) + row.consumers.filter((entry) => entry.kind === "construction_file").length);
    prefixes = sums;
    FILE_CONSUMER_PREFIXES.set(plan, prefixes);
  }
  const current = plan.outputFrames[frame]?.consumers.slice(0, consumer).filter((entry) => entry.kind === "construction_file").length ?? 0;
  return (prefixes[frame] as number) + current;
}

function plannerSpan(plan: UpdateConstructionPlanV1): { readonly first: number; readonly count: number } {
  const first = plan.files.findIndex((row) => fileRank(row.role) >= PLANNER_RANK);
  const count = plan.files.filter((row) => row.role.kind === "payload" && row.role.source.kind === "planner_output").length;
  return { first: first === -1 ? plan.files.length : first, count };
}

/** Spec 2 §9.2's frame/file pairing: file cursor and frame cursor describe the same consumer prefix. */
function checkOutputCursor(plan: UpdateConstructionPlanV1, nextFile: number, frame: number, consumer: number, fileInFlight: boolean, label: string): void {
  const frames = plan.outputFrames;
  if (frame < frames.length) {
    if (consumer >= (frames[frame] as UpdateConstructionOutputFrameV1).consumers.length) fail(`${label}.nextOutputConsumer`);
  } else if (consumer !== 0) fail(`${label}.nextOutputConsumer`);
  const { first, count } = plannerSpan(plan);
  const started = frame > 0 || consumer > 0;
  if (nextFile < first) {
    if (started) fail(`${label}: output frames before the planner rows`);
    return;
  }
  const written = Math.min(nextFile - first, count);
  if (fileConsumersBefore(plan, frame, consumer) !== written) fail(`${label}: frame cursor does not match the file cursor`);
  if (nextFile > first + count && frame !== frames.length) fail(`${label}: a later row before every frame`);
  if (fileInFlight && nextFile < first + count) {
    const current = frames[frame]?.consumers[consumer];
    if (current?.kind !== "construction_file" || current.ordinal !== nextFile) fail(`${label}: the in-flight row is not the current consumer`);
  }
}

/**
 * Validates a construction journal against its plan: exact keys, plan binding, and the linear
 * phase/cursor table. Every field a phase does not own is at its zero/null value.
 */
export function validateConstructionJournal(value: unknown, plan: UpdateConstructionPlanV1): UpdateConstructionJournalV1 {
  const label = "UpdateConstructionJournalV1";
  const input = exact(value, JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1 || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.constructionPlanHash !== constructionPlanHash(plan)) fail(`${label}.constructionPlanHash`);
  const phase = oneOf(input.phase, PHASES, `${label}.phase`);
  const D = plan.directories.length;
  const F = plan.files.length;
  const O = plan.outputFrames.length;
  const nextDirectory = integer(input.nextDirectory, 0, D, `${label}.nextDirectory`);
  const nextFile = integer(input.nextFile, 0, F, `${label}.nextFile`);
  const frame = integer(input.nextOutputFrame, 0, O, `${label}.nextOutputFrame`);
  const consumer = integer(input.nextOutputConsumer, 0, MAX_FRAMES, `${label}.nextOutputConsumer`);
  const identities = list(input.directoryIdentities, 0, D, `${label}.directoryIdentities`);
  identities.forEach((identity, index) => {
    identityOf(identity, ["ordinal", "dev", "ino"], `${label}.directoryIdentities`);
    if ((identity as UpdateConstructionDirectoryIdentityV1).ordinal !== index) fail(`${label}.directoryIdentities: not contiguous`);
  });
  if (identities.length !== nextDirectory) fail(`${label}.directoryIdentities: not the exact reached prefix`);
  let directoryState: UpdateConstructionDirectoryWriteStateV1 | null = null;
  if (input.directoryWriteState !== null) {
    const state = record(input.directoryWriteState, `${label}.directoryWriteState`);
    identityOf(state, state.state === "create_intent" ? ["ordinal", "state"] : ["ordinal", "state", "dev", "ino"], `${label}.directoryWriteState`);
    oneOf(state.state, ["create_intent", "created"], `${label}.directoryWriteState.state`);
    if (state.ordinal !== nextDirectory || nextDirectory >= D) fail(`${label}.directoryWriteState.ordinal`);
    directoryState = state as unknown as UpdateConstructionDirectoryWriteStateV1;
  }
  const fileState = checkWriteState(input.fileWriteState, `${label}.fileWriteState`);
  if (fileState !== null && (fileState.ordinal !== nextFile || nextFile >= F)) fail(`${label}.fileWriteState.ordinal`);
  const outerPlan = checkOuter(input.outerPlan, input.outerPlanWriteState, input.outerPlanIdentity, plan.outerPlanPath, `${label}.outerPlan`);
  const outerJournal = checkOuter(input.outerJournal, input.outerJournalWriteState, input.outerJournalIdentity, plan.outerJournalPath, `${label}.outerJournal`);
  const compensation = nullableInteger(input.compensationNext, -1, F - 1, `${label}.compensationNext`);
  const part = input.compensationPart === null ? null : oneOf(input.compensationPart, ["file", "evidence"] as const, `${label}.compensationPart`);
  const compensationDirectory = nullableInteger(input.compensationDirectoryNext, -1, D - 1, `${label}.compensationDirectoryNext`);
  const compaction = nullableInteger(input.compactionNext, 0, 2 * F, `${label}.compactionNext`);
  const compactionDirectory = nullableInteger(input.compactionDirectoryNext, 0, D, `${label}.compactionDirectoryNext`);
  const createdAt = parseUtcTimestamp(input.createdAt);
  const updatedAt = parseUtcTimestamp(input.updatedAt);
  if (createdAt !== plan.constructionJournalCreatedAt || updatedAt < createdAt) fail(`${label}: timestamps`);

  const noCompensation = compensation === null && part === null && compensationDirectory === null;
  const noCompaction = compaction === null && compactionDirectory === null;
  const clean = noCompensation && noCompaction;
  const filesDone = nextDirectory === D && directoryState === null && nextFile === F && fileState === null && frame === O && consumer === 0;
  const outerAbsent = outerPlan === "absent" && outerJournal === "absent";
  const handedOff = filesDone && outerPlan === "complete" && outerJournal === "complete";
  let legal: boolean;
  switch (phase) {
    case "planned":
      legal = clean && outerAbsent && nextDirectory === 0 && directoryState === null && nextFile === 0 && fileState === null && frame === 0 && consumer === 0 && updatedAt === createdAt;
      break;
    case "directories_staging":
      legal = clean && outerAbsent && nextDirectory < D && nextFile === 0 && fileState === null && frame === 0 && consumer === 0;
      break;
    case "files_staging":
      legal = clean && outerAbsent && nextDirectory === D && directoryState === null;
      if (legal) checkOutputCursor(plan, nextFile, frame, consumer, fileState !== null, label);
      break;
    case "sources_staging":
    case "files_ready":
      legal = clean && outerAbsent && filesDone;
      break;
    case "outer_plan_publishing":
      legal = clean && filesDone && outerPlan !== "absent" && outerJournal === "absent";
      break;
    case "outer_journal_publishing":
      legal = clean && filesDone && outerPlan === "complete" && outerJournal !== "absent";
      break;
    case "handed_off":
      legal = clean && handedOff;
      break;
    case "compensating":
      legal = noCompaction && compensation !== null && compensation <= nextFile && (compensation >= 0) === (part !== null) && (compensation >= 0 ? compensationDirectory === null : compensationDirectory !== null && compensationDirectory <= nextDirectory);
      break;
    case "rolled_back":
      legal = noCompaction && compensation === -1 && part === null && compensationDirectory === -1;
      break;
    case "compacting":
      legal = noCompensation && handedOff && compaction !== null && compactionDirectory !== null && (compactionDirectory === 0 || compaction === 2 * F);
      break;
  }
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return input as unknown as UpdateConstructionJournalV1;
}

export function isPreHandoffConstructionPhase(phase: UpdateConstructionPhaseV1): boolean {
  return PRE_HANDOFF.includes(phase);
}

function outerSlot(journal: UpdateConstructionJournalV1): "plan" | "journal" {
  return journal.phase === "outer_journal_publishing" ? "journal" : "plan";
}

/**
 * The single legal successor of `journal` under `step`. Throws on any phase/cursor leap, so a
 * journal the store persists is always the unique next state the plan admits.
 */
export function advanceConstructionJournal(plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1, step: UpdateConstructionStepV1, updatedAt: UtcTimestampV1): UpdateConstructionJournalV1 {
  const label = `UpdateConstructionStepV1(${step.kind})`;
  const current = validateConstructionJournal(journal, plan);
  if (parseUtcTimestamp(updatedAt) < current.updatedAt) fail(`${label}: time moved backwards`);
  const D = plan.directories.length;
  const F = plan.files.length;
  const base = { ...current, updatedAt };
  const need = (condition: boolean): void => {
    if (!condition) fail(label);
  };
  let next: UpdateConstructionJournalV1;
  switch (step.kind) {
    case "directory_intent":
      need((current.phase === "planned" || current.phase === "directories_staging") && current.directoryWriteState === null);
      next = { ...base, phase: "directories_staging", directoryWriteState: { ordinal: current.nextDirectory, state: "create_intent" } };
      break;
    case "directory_created":
      need(current.directoryWriteState?.state === "create_intent");
      next = { ...base, directoryWriteState: { ordinal: current.nextDirectory, state: "created", dev: step.dev, ino: step.ino } };
      break;
    case "directory_complete": {
      const state = current.directoryWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateConstructionDirectoryWriteStateV1, { readonly state: "created" }>;
      const nextDirectory = current.nextDirectory + 1;
      next = { ...base, phase: nextDirectory === D ? "files_staging" : "directories_staging", directoryWriteState: null, nextDirectory, directoryIdentities: [...current.directoryIdentities, { ordinal: created.ordinal, dev: created.dev, ino: created.ino }] };
      break;
    }
    case "file_intent":
      need(current.phase === "files_staging" && current.fileWriteState === null && current.nextFile < F);
      next = { ...base, fileWriteState: { ordinal: current.nextFile, state: "create_intent" } };
      break;
    case "file_created":
      need(current.fileWriteState?.state === "create_intent");
      next = { ...base, fileWriteState: { ordinal: current.nextFile, state: "created", dev: step.dev, ino: step.ino } };
      break;
    case "evidence_intent": {
      const state = current.fileWriteState;
      need(state?.state === "created");
      const created = state as Extract<UpdateConstructionWriteStateV1, { readonly state: "created" }>;
      next = { ...base, fileWriteState: { ordinal: created.ordinal, state: "evidence_intent", dev: created.dev, ino: created.ino } };
      break;
    }
    case "evidence_created": {
      const state = current.fileWriteState;
      need(state?.state === "evidence_intent");
      const intent = state as Extract<UpdateConstructionWriteStateV1, { readonly state: "evidence_intent" }>;
      next = { ...base, fileWriteState: { ordinal: intent.ordinal, state: "evidence_created", dev: intent.dev, ino: intent.ino, evidenceDev: step.dev, evidenceIno: step.ino } };
      break;
    }
    case "file_complete": {
      need(current.fileWriteState?.state === "evidence_created");
      const row = plan.files[current.nextFile] as UpdateConstructionFilePlanV1;
      next = { ...base, fileWriteState: null, nextFile: current.nextFile + 1 };
      if (row.role.kind === "payload" && row.role.source.kind === "planner_output") next = advanceConsumer(plan, next);
      break;
    }
    case "source_consumer_complete": {
      const consumer = plan.outputFrames[current.nextOutputFrame]?.consumers[current.nextOutputConsumer];
      need(current.phase === "files_staging" && current.fileWriteState === null && consumer?.kind === "rollback_source_entry");
      next = advanceConsumer(plan, base);
      break;
    }
    case "sources_staging":
      need(current.phase === "files_staging");
      next = { ...base, phase: "sources_staging" };
      break;
    case "files_ready":
      need(current.phase === "sources_staging");
      next = { ...base, phase: "files_ready" };
      break;
    case "outer_intent": {
      const slot = current.phase === "files_ready" ? "plan" : current.phase === "outer_plan_publishing" && current.outerPlanIdentity !== null ? "journal" : null;
      need(slot !== null);
      next = slot === "plan"
        ? { ...base, phase: "outer_plan_publishing", outerPlan: step.file, outerPlanWriteState: { state: "create_intent" } }
        : { ...base, phase: "outer_journal_publishing", outerJournal: step.file, outerJournalWriteState: { state: "create_intent" } };
      break;
    }
    case "outer_created": {
      const slot = outerSlot(current);
      const state = slot === "plan" ? current.outerPlanWriteState : current.outerJournalWriteState;
      need((current.phase === "outer_plan_publishing" || current.phase === "outer_journal_publishing") && state?.state === "create_intent");
      const created = { state: "created" as const, dev: step.dev, ino: step.ino };
      next = slot === "plan" ? { ...base, outerPlanWriteState: created } : { ...base, outerJournalWriteState: created };
      break;
    }
    case "outer_complete": {
      const slot = outerSlot(current);
      const state = slot === "plan" ? current.outerPlanWriteState : current.outerJournalWriteState;
      need((current.phase === "outer_plan_publishing" || current.phase === "outer_journal_publishing") && state?.state === "created");
      const created = state as Extract<UpdateConstructionOuterWriteStateV1, { readonly state: "created" }>;
      const identity = { dev: created.dev, ino: created.ino };
      next = slot === "plan"
        ? { ...base, outerPlanWriteState: null, outerPlanIdentity: identity }
        : { ...base, phase: "handed_off", outerJournalWriteState: null, outerJournalIdentity: identity };
      break;
    }
    case "compensate": {
      need(isPreHandoffConstructionPhase(current.phase));
      // An unbound create intent has nothing on disk; a created in-flight row is the top of the walk.
      const fileTop = current.fileWriteState !== null && current.fileWriteState.state !== "create_intent" ? current.nextFile : current.nextFile - 1;
      const directoryTop = current.directoryWriteState?.state === "created" ? current.nextDirectory : current.nextDirectory - 1;
      next = { ...base, phase: "compensating", compensationNext: fileTop, compensationPart: fileTop >= 0 ? "file" : null, compensationDirectoryNext: fileTop >= 0 ? null : directoryTop };
      break;
    }
    case "compensation_step": {
      need(current.phase === "compensating");
      const at = current.compensationNext as number;
      if (at >= 0 && current.compensationPart === "file") {
        next = { ...base, compensationPart: "evidence" };
      } else if (at >= 0) {
        const directoryTop = current.directoryWriteState?.state === "created" ? current.nextDirectory : current.nextDirectory - 1;
        next = at === 0
          ? { ...base, compensationNext: -1, compensationPart: null, compensationDirectoryNext: directoryTop }
          : { ...base, compensationNext: at - 1, compensationPart: "file" };
      } else {
        const directory = current.compensationDirectoryNext as number;
        next = directory >= 0 ? { ...base, compensationDirectoryNext: directory - 1 } : { ...base, phase: "rolled_back" };
      }
      break;
    }
    case "compaction_step": {
      if (current.phase === "handed_off") {
        next = { ...base, phase: "compacting", compactionNext: 0, compactionDirectoryNext: 0 };
        break;
      }
      need(current.phase === "compacting");
      const files = current.compactionNext as number;
      const directories = current.compactionDirectoryNext as number;
      need(files < 2 * F || directories < D);
      next = files < 2 * F ? { ...base, compactionNext: files + 1 } : { ...base, compactionDirectoryNext: directories + 1 };
      break;
    }
  }
  return validateConstructionJournal(next, plan);
}

function advanceConsumer(plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1): UpdateConstructionJournalV1 {
  const frame = plan.outputFrames[journal.nextOutputFrame] as UpdateConstructionOutputFrameV1;
  return journal.nextOutputConsumer + 1 === frame.consumers.length
    ? { ...journal, nextOutputFrame: journal.nextOutputFrame + 1, nextOutputConsumer: 0 }
    : { ...journal, nextOutputConsumer: journal.nextOutputConsumer + 1 };
}

/** The one canonical evidence object for construction file `ordinal` at its recorded inode. */
export function constructionFileEvidence(plan: UpdateConstructionPlanV1, ordinal: number, dev: UInt64DecimalV1, ino: UInt64DecimalV1): UpdateConstructionFileEvidenceV1 {
  const row = plan.files[integer(ordinal, 0, plan.files.length - 1, "construction file ordinal")] as UpdateConstructionFilePlanV1;
  return {
    schemaVersion: 1,
    coordinatorId: plan.coordinatorId,
    constructionPlanHash: constructionPlanHash(plan),
    ordinal,
    pathHash: sha256Hex(row.path),
    bytes: row.bytes,
    sha256: row.sha256,
    mode: row.mode,
    dev: parseUInt64Decimal(dev),
    ino: parseUInt64Decimal(ino),
  };
}

export function constructionEvidenceBytes(evidence: UpdateConstructionFileEvidenceV1): Uint8Array {
  const bytes = encoder.encode(canonical(evidence));
  if (bytes.byteLength > MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES) fail("UpdateConstructionFileEvidenceV1: exceeds its bound");
  return bytes;
}

/** Decodes complete evidence and proves it is the canonical object for that row; returns its target identity. */
export function validateConstructionFileEvidence(bytes: Uint8Array, plan: UpdateConstructionPlanV1, ordinal: number): UpdateConstructionFileEvidenceV1 {
  const label = "UpdateConstructionFileEvidenceV1";
  const input = exact(decodeCanonicalJson(bytes, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES), EVIDENCE_KEYS, label);
  const expected = constructionFileEvidence(plan, ordinal, parseUInt64Decimal(input.dev), parseUInt64Decimal(input.ino));
  if (Buffer.compare(constructionEvidenceBytes(expected), bytes) !== 0) fail(`${label}: not the canonical evidence for its row`);
  return expected;
}

/**
 * The nested participant/source journal owns deletion of source plans/journals, target-journal
 * leaves, their initial journals, payloads, and recovery records; construction removes only the
 * read-only `update_execution`, `target_verification`, and `terminal_retirement` leaves itself.
 */
export function constructionDeletionAuthority(row: UpdateConstructionFilePlanV1): "construction" | "nested" {
  return row.role.kind === "immutable_plan" && ["update_execution", "target_verification", "terminal_retirement"].includes(row.role.planKind) ? "construction" : "nested";
}

/** Compaction cursor `k`: file ordinal `F - 1 - floor(k / 2)`, even removes the file, odd its evidence. */
export function constructionCompactionTarget(plan: UpdateConstructionPlanV1, cursor: number): { readonly ordinal: number; readonly part: "file" | "evidence" } {
  const k = integer(cursor, 0, 2 * plan.files.length - 1, "compactionNext");
  return { ordinal: plan.files.length - 1 - Math.floor(k / 2), part: k % 2 === 0 ? "file" : "evidence" };
}
