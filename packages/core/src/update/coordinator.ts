/**
 * Spec 2 §9.2–§9.4 and §10.2: the additive schema-version-2 lifecycle coordinator for
 * `update --apply` and `update rollback --apply`. Everything here is pure except the
 * `UpdateLifecycleCoordinator` engine, which touches the world only through injected ports.
 * The Spec 1 schema-V1 unions are never widened; a V2 plan shares only their paths and caps.
 */
import { createHash } from "node:crypto";

import { decodeCanonicalJson, encodeCanonicalJson, hashCanonicalJson, hashCanonicalJsonNoLf, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { LifecycleRecoveryRequiredError, refuseLifecycleRecovery } from "../lifecycle/guarded-fs.js";
import { parseLifecycleCoordinatorId } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { ArtifactOwner } from "../manifest/types.js";
import {
  parseLeafPlanId,
  updateConstructionEnvelopePaths,
  updateLeafPlanPath,
  updateRecoveryExecutorStagedPath,
  type ImmutableUpdateConstructionRefV1,
  type ImmutableUpdatePlanRefV1,
  type OwnerExternalEffectIdV1,
  type UpdateInitialJournalRefV1,
  type UpdateLeafPlanKindV1,
  type UpdateTargetJournalKindV1,
} from "./construction.js";
import { OWNER_UPDATE_ORDER } from "./owner.js";
import {
  isReversibleUpdateStep,
  rejectUpdateStep,
  type UpdateCompactionEntryV1,
  type UpdateLifecycleCoordinatorStepV1,
  type UpdateParticipantAdapterV1,
} from "./participants.js";
import {
  deriveExactProductStatePath,
  deriveUpdateExecutorRecordPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type ExactProductStatePathV1,
  type UpdateRecoveryExecutorStagedPathV1,
} from "./paths.js";
import { parseRollbackPayloadId, validatePlannerWireBounds, type PlannerTranscriptIdentityV1, type PlannerWireBoundsV1, type RollbackPayloadIdV1 } from "./preview.js";
import {
  compareUtf8,
  validateReleaseIdentity,
  validateReleaseMetadataIdentity,
  type ReleaseIdentityV1,
  type ReleaseMetadataIdentityV1,
} from "./release.js";
import {
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseUtcTimestamp,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type SafeReasonCodeV1,
  type UtcTimestampV1,
} from "./scalars.js";

export type UpdateOperationV1 = "update_apply" | "update_rollback";

// ---------------------------------------------------------------------------------------------
// Recovery-executor records (§9.2).
// ---------------------------------------------------------------------------------------------

export type UpdateRecoveryExecutorV1 =
  | { readonly kind: "release_bundle"; readonly release: ReleaseIdentityV1 }
  | {
      readonly kind: "package_fallback";
      readonly bundleManifestHash: LowerHexSha256;
      readonly launcherProtocol: PositiveUInt32V1;
      readonly updateProtocol: PositiveUInt32V1;
    };

export interface UpdateRecoveryExecutorRecordV1 {
  readonly schemaVersion: 1;
  readonly state: "executing" | "terminal_cleanup";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: UpdateOperationV1;
  readonly executor: UpdateRecoveryExecutorV1;
  readonly executionBindingHash: LowerHexSha256;
  readonly createdAt: UtcTimestampV1;
}

export interface UpdateRecoveryExecutorStagedFileV1 {
  readonly constructionOrdinal: number;
  readonly path: UpdateRecoveryExecutorStagedPathV1;
  readonly bytes: number;
  readonly hash: LowerHexSha256;
  readonly mode: 384;
}

export interface UpdateRecoveryExecutorDescriptorV1 {
  readonly finalPath: ExactProductStatePathV1;
  readonly initial: UpdateRecoveryExecutorRecordV1;
  readonly initialStaged: UpdateRecoveryExecutorStagedFileV1;
  readonly terminal: UpdateRecoveryExecutorRecordV1;
  readonly terminalStaged: UpdateRecoveryExecutorStagedFileV1;
  readonly maximumRecordBytes: number;
}

/** The launcher's handoff: the package-owned fallback the terminal record must name exactly. */
export interface UpdateFallbackHandoffV1 {
  readonly bundleManifestHash: LowerHexSha256;
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
}

// ---------------------------------------------------------------------------------------------
// The `update_execution` leaf (§9.2).
// ---------------------------------------------------------------------------------------------

export interface UpdateManifestStatePlansV1 {
  readonly transitional: ImmutableUpdatePlanRefV1<"manifest_state">;
  readonly terminal: ImmutableUpdatePlanRefV1<"manifest_state">;
}

export interface UpdateExecutionPlanV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: UpdateOperationV1;
  readonly previewHash: LowerHexSha256;
  readonly executionBindingHash: LowerHexSha256;
  readonly maximumPlanBytes: number;
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly planner: PlannerTranscriptIdentityV1 | null;
  readonly bundle: ImmutableUpdatePlanRefV1<"bundle_publication">;
  readonly owners: readonly ImmutableUpdatePlanRefV1<"owner_update">[];
  readonly migrations: readonly ImmutableUpdatePlanRefV1<"schema_migration">[];
  readonly manifest: UpdateManifestStatePlansV1;
  readonly trust: ImmutableUpdatePlanRefV1<"release_trust_state"> | null;
  readonly active: ImmutableUpdatePlanRefV1<"active_release_state">;
  readonly rollback: ImmutableUpdatePlanRefV1<"rollback_record_state">;
  readonly rollbackPayload: ImmutableUpdatePlanRefV1<"rollback_payload_state">;
  readonly initialParticipantJournals: readonly UpdateInitialJournalRefV1[];
  readonly recoveryExecutor: UpdateRecoveryExecutorDescriptorV1;
  readonly verification: ImmutableUpdatePlanRefV1<"target_verification">;
  readonly retirement: ImmutableUpdatePlanRefV1<"terminal_retirement">;
}

/** What step derivation needs from each reopened owner plan; order and bijection are rechecked. */
export interface UpdateStepOwnerV1 {
  readonly id: SafeReasonCodeV1;
  readonly owner: ArtifactOwner;
  readonly externalEffects: readonly Pick<ImmutableUpdatePlanRefV1<"owner_external_effect">, "id">[];
}

export interface UpdateExecutionValidationContextV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly evidence: CanonicalPathEvidenceV1;
  readonly fallback: UpdateFallbackHandoffV1;
}

// ---------------------------------------------------------------------------------------------
// Coordinator plan, journal, and closure (§9.2).
// ---------------------------------------------------------------------------------------------

export interface UpdateLifecycleTerminalCompactionV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly terminalOutcome: "finalized" | "rolled_back";
  readonly retainPayloadId: RollbackPayloadIdV1 | null;
  readonly entries: readonly UpdateCompactionEntryV1[];
}

export interface UpdateLifecycleCoordinatorPlanV2 {
  readonly schemaVersion: 2;
  readonly id: LifecycleCoordinatorIdV1;
  readonly operation: UpdateOperationV1;
  readonly previewHash: LowerHexSha256;
  readonly executionBindingHash: LowerHexSha256;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
  readonly recoveryExecutorInitialHash: LowerHexSha256;
  readonly recoveryExecutorTerminalHash: LowerHexSha256;
  readonly construction: ImmutableUpdateConstructionRefV1;
  readonly update: ImmutableUpdatePlanRefV1<"update_execution">;
  readonly steps: readonly UpdateLifecycleCoordinatorStepV1[];
  readonly compaction: UpdateLifecycleTerminalCompactionV1;
}

export type UpdateLifecycleCoordinatorPhaseV2 =
  | "planned"
  | "participants_applying"
  | "active_publishing"
  | "verifying"
  | "compensating"
  | "terminal_finalizing"
  | "finalized"
  | "rolled_back"
  | "compacting";

export interface UpdateLifecycleCoordinatorJournalV2 {
  readonly schemaVersion: 2;
  readonly id: LifecycleCoordinatorIdV1;
  readonly operation: UpdateOperationV1;
  readonly phase: UpdateLifecycleCoordinatorPhaseV2;
  readonly direction: "forward" | "compensating";
  readonly planHash: LowerHexSha256;
  readonly nextStep: number;
  readonly compensationNext: number | null;
  readonly pointOfNoReturnReached: boolean;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  /** §9.4's original cause, written with `compensation_started`; non-null exactly while compensating. */
  readonly compensationCause: SafeReasonCodeV1 | null;
  readonly retirementNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

/** One schema-V1 plan under its own closed codec, or one update plan; fields never mix. */
export type LifecycleExecutionPlanDispatchV2<TPlanV1> =
  | { readonly schemaVersion: 1; readonly plan: TPlanV1 }
  | { readonly schemaVersion: 2; readonly plan: UpdateLifecycleCoordinatorPlanV2 };

export const MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES = 16_777_216;
export const MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES = 1_048_576;
export const MAXIMUM_UPDATE_COORDINATOR_STEPS = 10_031;
export const MAXIMUM_UPDATE_COMPACTION_ENTRIES = 20_100;
export const MAXIMUM_UPDATE_RETIREMENT_LEAVES = 1_200_012;
/**
 * The spec names no V2 plan domain; this is Spec 1's `developer-os:lifecycle-coordinator-plan:v1`
 * pattern at version 2, so a V1 hash can never be replayed as a V2 one.
 */
export const UPDATE_COORDINATOR_PLAN_HASH_DOMAIN = "developer-os:lifecycle-coordinator-plan:v2";

const MAX_LEAF_BYTES = 16_777_216;
const MAX_CONSTRUCTION_BYTES = 536_870_912;
const MAX_RECORD_BYTES = 16_384;
const MAX_OWNERS = 16;
const MAX_MIGRATIONS = 10_000;
const MAX_INITIAL_JOURNALS = 20_100;
const MAX_JOURNAL_BYTES = 1_048_576;
const OPERATIONS: readonly UpdateOperationV1[] = ["update_apply", "update_rollback"];
const PHASES: readonly UpdateLifecycleCoordinatorPhaseV2[] = ["planned", "participants_applying", "active_publishing", "verifying", "compensating", "terminal_finalizing", "finalized", "rolled_back", "compacting"];
const TARGET_JOURNAL_KINDS: readonly UpdateTargetJournalKindV1[] = ["bundle_publication", "owner_update", "owner_external_effect", "schema_migration", "manifest_state", "release_trust_state", "active_release_state", "rollback_record_state", "rollback_payload_state"];
const REF_KEYS = ["kind", "id", "path", "hash", "bytes"];
const RECORD_KEYS = ["schemaVersion", "state", "coordinatorId", "operation", "executor", "executionBindingHash", "createdAt"];
const STAGED_KEYS = ["constructionOrdinal", "path", "bytes", "hash", "mode"];
const EXECUTION_KEYS = ["schemaVersion", "coordinatorId", "operation", "previewHash", "executionBindingHash", "maximumPlanBytes", "current", "target", "metadata", "planner", "bundle", "owners", "migrations", "manifest", "trust", "active", "rollback", "rollbackPayload", "initialParticipantJournals", "recoveryExecutor", "verification", "retirement"];
const PLAN_KEYS = ["schemaVersion", "id", "operation", "previewHash", "executionBindingHash", "maximumPlanBytes", "maximumJournalBytes", "recoveryExecutorInitialHash", "recoveryExecutorTerminalHash", "construction", "update", "steps", "compaction"];
const JOURNAL_KEYS = ["schemaVersion", "id", "operation", "phase", "direction", "planHash", "nextStep", "compensationNext", "pointOfNoReturnReached", "terminalOutcome", "compensationCause", "retirementNext", "compactionNext", "createdAt", "updatedAt"];
const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return value as Readonly<Record<string, unknown>>;
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = record(value, label);
  const present = Object.keys(input);
  if (present.length !== keys.length || present.some((key) => !keys.includes(key))) fail(`${label}: keys`);
  return input;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function nullableInteger(value: unknown, minimum: number, maximum: number, label: string): number | null {
  return value === null ? null : integer(value, minimum, maximum, label);
}

function array(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(label);
  return value as readonly unknown[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(label);
  return value as T;
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function same(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

/** `<home>/staging/lifecycle/<coordinator-id>`, the coordinator-owned root every leaf path hangs from. */
export function updateCoordinatorStagingRoot(productHome: CanonicalAbsolutePathV1, id: LifecycleCoordinatorIdV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${productHome}/staging/lifecycle/${id}`);
}

/**
 * §9.2: SHA-256 over `developer-os/update-execution-binding/v1\0` plus the canonical coordinator
 * ID, operation, preview hash, and both release-identity hashes. It hashes no containing plan.
 */
export function updateExecutionBindingHash(input: {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly operation: UpdateOperationV1;
  readonly previewHash: LowerHexSha256;
  readonly current: Pick<ReleaseIdentityV1, "releaseIdentityHash">;
  readonly target: Pick<ReleaseIdentityV1, "releaseIdentityHash">;
}): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/update-execution-binding/v1", {
    coordinatorId: input.coordinatorId,
    operation: oneOf(input.operation, OPERATIONS, "UpdateOperationV1"),
    previewHash: parseLowerHexSha256(input.previewHash),
    currentReleaseIdentityHash: parseLowerHexSha256(input.current.releaseIdentityHash),
    targetReleaseIdentityHash: parseLowerHexSha256(input.target.releaseIdentityHash),
  });
}

// ---------------------------------------------------------------------------------------------
// Recovery-executor record codec.
// ---------------------------------------------------------------------------------------------

function parseExecutor(value: unknown, evidence: CanonicalPathEvidenceV1): UpdateRecoveryExecutorV1 {
  const input = record(value, "UpdateRecoveryExecutorRecordV1.executor");
  if (input.kind === "release_bundle") {
    const arm = exact(value, ["kind", "release"], "UpdateRecoveryExecutorRecordV1.executor");
    return { kind: "release_bundle", release: validateReleaseIdentity(arm.release, evidence) };
  }
  if (input.kind === "package_fallback") {
    const arm = exact(value, ["kind", "bundleManifestHash", "launcherProtocol", "updateProtocol"], "UpdateRecoveryExecutorRecordV1.executor");
    return { kind: "package_fallback", bundleManifestHash: parseLowerHexSha256(arm.bundleManifestHash), launcherProtocol: parsePositiveUInt32(arm.launcherProtocol), updateProtocol: parsePositiveUInt32(arm.updateProtocol) };
  }
  return fail("UpdateRecoveryExecutorRecordV1.executor.kind");
}

/** Exact keys, and the executor arm the state admits: executing names a bundle, cleanup the fallback. */
export function validateUpdateRecoveryExecutorRecord(value: unknown, evidence: CanonicalPathEvidenceV1): UpdateRecoveryExecutorRecordV1 {
  const input = exact(value, RECORD_KEYS, "UpdateRecoveryExecutorRecordV1");
  if (input.schemaVersion !== 1) fail("UpdateRecoveryExecutorRecordV1.schemaVersion");
  const state = oneOf(input.state, ["executing", "terminal_cleanup"] as const, "UpdateRecoveryExecutorRecordV1.state");
  const executor = parseExecutor(input.executor, evidence);
  if ((state === "executing") !== (executor.kind === "release_bundle")) fail("UpdateRecoveryExecutorRecordV1: state/executor");
  return {
    schemaVersion: 1,
    state,
    coordinatorId: parseLifecycleCoordinatorId(input.coordinatorId, null),
    operation: oneOf(input.operation, OPERATIONS, "UpdateRecoveryExecutorRecordV1.operation"),
    executor,
    executionBindingHash: parseLowerHexSha256(input.executionBindingHash),
    createdAt: parseUtcTimestamp(input.createdAt),
  };
}

export function updateRecoveryExecutorRecordBytes(value: UpdateRecoveryExecutorRecordV1): Uint8Array {
  const bytes = canonicalBytes(value);
  if (bytes.byteLength > MAX_RECORD_BYTES) fail("UpdateRecoveryExecutorRecordV1: over 16 KiB");
  return bytes;
}

/** Plain SHA-256 of the canonical record bytes, as the construction row and outer plan bind them. */
export function updateRecoveryExecutorRecordHash(value: UpdateRecoveryExecutorRecordV1): LowerHexSha256 {
  return sha256Hex(updateRecoveryExecutorRecordBytes(value));
}

/**
 * `state/update-executor.json` as every reader sees it. Fresh `init` reserves the path as an empty
 * file (§6.4), which holds no record: `"reservation"`, never a decode failure. Any other bytes are
 * the record or throw.
 */
export function decodeUpdateExecutorRecordSlot(
  bytes: Uint8Array,
  evidence: CanonicalPathEvidenceV1,
): UpdateRecoveryExecutorRecordV1 | "reservation" {
  return bytes.byteLength === 0 ? "reservation" : decodeUpdateRecoveryExecutorRecord(bytes, evidence);
}

/** Reads a guarded record's exact bytes: canonical, at most 16 KiB, and its own re-encoding. */
export function decodeUpdateRecoveryExecutorRecord(bytes: Uint8Array, evidence: CanonicalPathEvidenceV1): UpdateRecoveryExecutorRecordV1 {
  if (bytes.byteLength > MAX_RECORD_BYTES) fail("UpdateRecoveryExecutorRecordV1: over 16 KiB");
  const parsed = validateUpdateRecoveryExecutorRecord(decodeCanonicalJson(bytes, MAX_RECORD_BYTES), evidence);
  if (Buffer.compare(Buffer.from(updateRecoveryExecutorRecordBytes(parsed)), Buffer.from(bytes)) !== 0) fail("UpdateRecoveryExecutorRecordV1: not canonical");
  return parsed;
}

function parseStaged(value: unknown, expectedPath: CanonicalAbsolutePathV1, record: UpdateRecoveryExecutorRecordV1, label: string): UpdateRecoveryExecutorStagedFileV1 {
  const input = exact(value, STAGED_KEYS, label);
  const bytes = updateRecoveryExecutorRecordBytes(record);
  const staged: UpdateRecoveryExecutorStagedFileV1 = {
    constructionOrdinal: integer(input.constructionOrdinal, 0, 1_099_999, `${label}.constructionOrdinal`),
    path: parseCanonicalAbsolutePathText(input.path) as UpdateRecoveryExecutorStagedPathV1,
    bytes: integer(input.bytes, 1, MAX_RECORD_BYTES, `${label}.bytes`),
    hash: parseLowerHexSha256(input.hash),
    mode: input.mode === 384 ? 384 : fail(`${label}.mode`),
  };
  if (staged.path !== expectedPath || staged.bytes !== bytes.byteLength || staged.hash !== sha256Hex(bytes)) fail(`${label}: not its record`);
  return staged;
}

/**
 * §9.2's pairing: initial executes the current release bundle, terminal names the package
 * fallback of the launcher's handoff, both share coordinator/operation/binding/timestamp, and the
 * initial release's protocols equal the fallback's. Every other combination refuses.
 */
function validateRecoveryExecutor(value: unknown, execution: Pick<UpdateExecutionPlanV1, "coordinatorId" | "operation" | "executionBindingHash" | "current">, context: UpdateExecutionValidationContextV1): UpdateRecoveryExecutorDescriptorV1 {
  const label = "UpdateExecutionPlanV1.recoveryExecutor";
  const input = exact(value, ["finalPath", "initial", "initialStaged", "terminal", "terminalStaged", "maximumRecordBytes"], label);
  const finalPath = deriveUpdateExecutorRecordPath(context.productHome);
  if (input.finalPath !== finalPath) fail(`${label}.finalPath`);
  const initial = validateUpdateRecoveryExecutorRecord(input.initial, context.evidence);
  const terminal = validateUpdateRecoveryExecutorRecord(input.terminal, context.evidence);
  if (initial.state !== "executing" || initial.executor.kind !== "release_bundle" || !same(initial.executor.release, execution.current)) fail(`${label}.initial`);
  if (terminal.state !== "terminal_cleanup" || terminal.executor.kind !== "package_fallback" || !same(terminal.executor, { kind: "package_fallback", ...context.fallback })) fail(`${label}.terminal`);
  for (const row of [initial, terminal]) {
    if (row.coordinatorId !== execution.coordinatorId || row.operation !== execution.operation || row.executionBindingHash !== execution.executionBindingHash || row.createdAt !== initial.createdAt) fail(`${label}: record binding`);
  }
  if (initial.executor.release.launcherProtocol !== terminal.executor.launcherProtocol || initial.executor.release.updateProtocol !== terminal.executor.updateProtocol) fail(`${label}: fallback protocol`);
  const stagingRoot = updateCoordinatorStagingRoot(context.productHome, execution.coordinatorId);
  const initialStaged = parseStaged(input.initialStaged, updateRecoveryExecutorStagedPath(stagingRoot, "executing"), initial, `${label}.initialStaged`);
  const terminalStaged = parseStaged(input.terminalStaged, updateRecoveryExecutorStagedPath(stagingRoot, "terminal_cleanup"), terminal, `${label}.terminalStaged`);
  if (terminalStaged.constructionOrdinal !== initialStaged.constructionOrdinal + 1) fail(`${label}: executing-then-terminal order`);
  if (input.maximumRecordBytes !== MAX_RECORD_BYTES) fail(`${label}.maximumRecordBytes`);
  return { finalPath, initial, initialStaged, terminal, terminalStaged, maximumRecordBytes: MAX_RECORD_BYTES };
}

// ---------------------------------------------------------------------------------------------
// Execution-leaf codec.
// ---------------------------------------------------------------------------------------------

function parseRef<TKind extends UpdateLeafPlanKindV1>(value: unknown, kind: TKind, stagingRoot: CanonicalAbsolutePathV1, label: string): ImmutableUpdatePlanRefV1<TKind> {
  const input = exact(value, REF_KEYS, label);
  if (input.kind !== kind) fail(`${label}.kind`);
  const id = parseLeafPlanId(kind, input.id);
  if (input.path !== updateLeafPlanPath(stagingRoot, kind, id)) fail(`${label}.path`);
  return { kind, id, path: input.path, hash: parseLowerHexSha256(input.hash), bytes: integer(input.bytes, 1, MAX_LEAF_BYTES, `${label}.bytes`) } as ImmutableUpdatePlanRefV1<TKind>;
}

function parseInitialJournal(value: unknown, label: string): UpdateInitialJournalRefV1 {
  const input = exact(value, ["kind", "id", "planHash", "finalPath", "stagedPath", "stagedExpected"], label);
  const kind = oneOf(input.kind, TARGET_JOURNAL_KINDS, `${label}.kind`);
  const staged = exact(input.stagedExpected, ["constructionOrdinal", "hash", "bytes", "mode"], `${label}.stagedExpected`);
  return {
    kind,
    id: parseLeafPlanId(kind, input.id),
    planHash: parseLowerHexSha256(input.planHash),
    finalPath: parseCanonicalAbsolutePathText(input.finalPath),
    stagedPath: parseCanonicalAbsolutePathText(input.stagedPath),
    stagedExpected: {
      constructionOrdinal: integer(staged.constructionOrdinal, 0, 1_099_999, `${label}.constructionOrdinal`),
      hash: parseLowerHexSha256(staged.hash),
      bytes: integer(staged.bytes, 1, MAX_JOURNAL_BYTES, `${label}.bytes`),
      mode: staged.mode === 384 ? 384 : fail(`${label}.mode`),
    },
  } as UpdateInitialJournalRefV1;
}

const PLANNER_BOUND_KEYS = ["requestJsonBytes", "resultJsonBytes", "inputBlobCount", "outputBlobCount", "inputBlobBytes", "outputBlobBytes", "stdinWireBytes", "stdoutWireBytes", "stderrBytes", "residentBytes", "idleMilliseconds", "wallMilliseconds", "processCount"];

function parsePlannerTranscript(value: unknown, label: string): PlannerTranscriptIdentityV1 {
  const input = exact(value, ["protocol", "bounds", "requestHash", "inputBlobsHash", "resultHash", "outputBlobsHash"], label);
  return {
    protocol: parsePositiveUInt32(input.protocol),
    bounds: validatePlannerWireBounds(exact(input.bounds, PLANNER_BOUND_KEYS, `${label}.bounds`) as unknown as PlannerWireBoundsV1),
    requestHash: parseLowerHexSha256(input.requestHash),
    inputBlobsHash: parseLowerHexSha256(input.inputBlobsHash),
    resultHash: parseLowerHexSha256(input.resultHash),
    outputBlobsHash: parseLowerHexSha256(input.outputBlobsHash),
  };
}

function executionRefs(plan: UpdateExecutionPlanV1): readonly ImmutableUpdatePlanRefV1[] {
  return [
    plan.bundle,
    ...plan.owners,
    ...plan.migrations,
    plan.manifest.transitional,
    plan.manifest.terminal,
    ...(plan.trust === null ? [] : [plan.trust]),
    plan.active,
    plan.rollback,
    plan.rollbackPayload,
    plan.verification,
    plan.retirement,
  ];
}

/**
 * Strict `UpdateExecutionPlanV1`: exact keys, every ref's kind/ID/path agreeing under the
 * coordinator staging root, a non-duplicate leaf set, operation-selected trust/planner arms, the
 * independently recomputed execution binding, and both plan-bound recovery-executor records.
 */
export function validateUpdateExecutionPlan(value: unknown, context: UpdateExecutionValidationContextV1): UpdateExecutionPlanV1 {
  const label = "UpdateExecutionPlanV1";
  const input = exact(value, EXECUTION_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const coordinatorId = parseLifecycleCoordinatorId(input.coordinatorId, null);
  const operation = oneOf(input.operation, OPERATIONS, `${label}.operation`);
  const stagingRoot = updateCoordinatorStagingRoot(context.productHome, coordinatorId);
  const current = validateReleaseIdentity(input.current, context.evidence);
  const target = validateReleaseIdentity(input.target, context.evidence);
  if (current.releaseIdentityHash === target.releaseIdentityHash) fail(`${label}: current equals target`);
  const previewHash = parseLowerHexSha256(input.previewHash);
  const executionBindingHash = parseLowerHexSha256(input.executionBindingHash);
  if (executionBindingHash !== updateExecutionBindingHash({ coordinatorId, operation, previewHash, current, target })) fail(`${label}.executionBindingHash`);
  const planner = input.planner === null ? null : parsePlannerTranscript(input.planner, `${label}.planner`);
  if ((operation === "update_apply") !== (planner !== null)) fail(`${label}.planner`);
  const manifest = exact(input.manifest, ["transitional", "terminal"], `${label}.manifest`);
  const trust = input.trust === null ? null : parseRef(input.trust, "release_trust_state", stagingRoot, `${label}.trust`);
  if ((operation === "update_apply") !== (trust !== null)) fail(`${label}.trust`);
  const plan: UpdateExecutionPlanV1 = {
    schemaVersion: 1,
    coordinatorId,
    operation,
    previewHash,
    executionBindingHash,
    maximumPlanBytes: integer(input.maximumPlanBytes, 1, MAX_LEAF_BYTES, `${label}.maximumPlanBytes`),
    current,
    target,
    metadata: validateReleaseMetadataIdentity(input.metadata),
    planner,
    bundle: parseRef(input.bundle, "bundle_publication", stagingRoot, `${label}.bundle`),
    owners: array(input.owners, 1, MAX_OWNERS, `${label}.owners`).map((row, index) => parseRef(row, "owner_update", stagingRoot, `${label}.owners[${index.toString(10)}]`)),
    migrations: array(input.migrations, 0, MAX_MIGRATIONS, `${label}.migrations`).map((row, index) => parseRef(row, "schema_migration", stagingRoot, `${label}.migrations[${index.toString(10)}]`)),
    manifest: {
      transitional: parseRef(manifest.transitional, "manifest_state", stagingRoot, `${label}.manifest.transitional`),
      terminal: parseRef(manifest.terminal, "manifest_state", stagingRoot, `${label}.manifest.terminal`),
    },
    trust,
    active: parseRef(input.active, "active_release_state", stagingRoot, `${label}.active`),
    rollback: parseRef(input.rollback, "rollback_record_state", stagingRoot, `${label}.rollback`),
    rollbackPayload: parseRef(input.rollbackPayload, "rollback_payload_state", stagingRoot, `${label}.rollbackPayload`),
    initialParticipantJournals: array(input.initialParticipantJournals, 1, MAX_INITIAL_JOURNALS, `${label}.initialParticipantJournals`).map((row, index) => parseInitialJournal(row, `${label}.initialParticipantJournals[${index.toString(10)}]`)),
    recoveryExecutor: validateRecoveryExecutor(input.recoveryExecutor, { coordinatorId, operation, executionBindingHash, current }, context),
    verification: parseRef(input.verification, "target_verification", stagingRoot, `${label}.verification`),
    retirement: parseRef(input.retirement, "terminal_retirement", stagingRoot, `${label}.retirement`),
  };
  const paths = new Set(executionRefs(plan).map((ref) => ref.path));
  if (paths.size !== executionRefs(plan).length) fail(`${label}: duplicate leaf ref`);
  const journals = new Set(plan.initialParticipantJournals.map((ref) => `${ref.kind}/${ref.id}`));
  if (journals.size !== plan.initialParticipantJournals.length) fail(`${label}: duplicate initial journal`);
  if (canonicalBytes(plan).byteLength > plan.maximumPlanBytes) fail(`${label}: over its maximum`);
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Step and compaction derivation (§9.2, §9.3, §10.2).
// ---------------------------------------------------------------------------------------------

function ownerRank(owner: ArtifactOwner): number {
  return OWNER_UPDATE_ORDER.indexOf(owner);
}

/** The reopened owner plans in canonical owner order, in bijection with the execution's owner refs. */
function orderedOwners(execution: UpdateExecutionPlanV1, owners: readonly UpdateStepOwnerV1[]): readonly UpdateStepOwnerV1[] {
  if (owners.length !== execution.owners.length) fail("UpdateStepOwnerV1: owner set");
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  const ordered = execution.owners.map((ref) => byId.get(ref.id) ?? fail("UpdateStepOwnerV1: owner ref"));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1] as UpdateStepOwnerV1;
    const next = ordered[index] as UpdateStepOwnerV1;
    if (ownerRank(previous.owner) >= ownerRank(next.owner)) fail("UpdateStepOwnerV1: canonical owner order");
  }
  return ordered;
}

/**
 * The exact step array, byte-for-byte. Apply follows §9.3; rollback follows §10.2 with the
 * execution's migration refs already in forward chain order, so their inverse runs reversed.
 */
export function deriveUpdateSteps(execution: UpdateExecutionPlanV1, owners: readonly UpdateStepOwnerV1[]): readonly UpdateLifecycleCoordinatorStepV1[] {
  const ordered = orderedOwners(execution, owners);
  const withEffects = ordered.filter((owner) => owner.externalEffects.length > 0);
  const migrations = execution.migrations.map((ref) => ref.id);
  if (execution.operation === "update_apply") {
    return [
      { kind: "bundle", action: "publish_target" },
      ...ordered.map((owner) => ({ kind: "owner_files", owner: owner.owner, direction: "forward" }) as const),
      ...withEffects.map((owner) => ({ kind: "owner_external_effect", owner: owner.owner, direction: "forward" }) as const),
      ...migrations.map((id) => ({ kind: "schema_migration", id, direction: "forward" }) as const),
      { kind: "rollback_payload", transition: "publish_proposed" },
      { kind: "manifest", transition: "preserve_before" },
      { kind: "manifest", transition: "publish_transitional" },
      { kind: "trust", transition: "publish_monotonic" },
      { kind: "rollback_record", transition: "publish_proposed" },
      { kind: "active", transition: "publish_target" },
      { kind: "target_verifier", release: "target" },
      { kind: "recovery_executor", transition: "switch_to_fallback" },
      { kind: "terminal_retire", set: "prior_rollback" },
      { kind: "manifest", transition: "publish_terminal" },
      { kind: "manifest", transition: "finalize_tombstones" },
    ];
  }
  return [
    { kind: "bundle", action: "verify_previous" },
    { kind: "rollback_payload", transition: "verify_retained" },
    { kind: "rollback_record", transition: "verify_retained" },
    ...[...migrations].reverse().map((id) => ({ kind: "schema_migration", id, direction: "inverse" }) as const),
    ...[...withEffects].reverse().map((owner) => ({ kind: "owner_external_effect", owner: owner.owner, direction: "inverse" }) as const),
    ...[...ordered].reverse().map((owner) => ({ kind: "owner_files", owner: owner.owner, direction: "inverse" }) as const),
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "publish_transitional" },
    { kind: "active", transition: "publish_previous" },
    { kind: "target_verifier", release: "previous" },
    { kind: "recovery_executor", transition: "switch_to_fallback" },
    { kind: "terminal_retire", set: "consumed_rollback_and_rejected_release" },
    { kind: "manifest", transition: "publish_terminal" },
    { kind: "manifest", transition: "finalize_tombstones" },
  ];
}

/**
 * §9.2's terminal order: owner leaves by owner, migrations in chain order, effects by allocated
 * ID, the ref-bearing state participants in execution order, then staging and the envelope.
 */
export function deriveUpdateCompactionEntries(execution: UpdateExecutionPlanV1, owners: readonly UpdateStepOwnerV1[]): readonly UpdateCompactionEntryV1[] {
  const ordered = orderedOwners(execution, owners);
  const effects = ordered.flatMap((owner) => owner.externalEffects.map((effect) => effect.id)).sort(compareUtf8);
  if (new Set(effects).size !== effects.length) fail("UpdateCompactionEntryV1: duplicate effect");
  return [
    ...ordered.map((owner) => ({ kind: "owner_update", owner: owner.owner }) as const),
    ...execution.migrations.map((ref) => ({ kind: "schema_migration", id: ref.id }) as const),
    ...effects.map((id) => ({ kind: "owner_external_effect", id }) as const),
    { kind: "state_participant", participant: "bundle", plan: execution.bundle },
    { kind: "state_participant", participant: "rollback_payload", plan: execution.rollbackPayload },
    { kind: "state_participant", participant: "manifest", plan: execution.manifest.transitional },
    ...(execution.trust === null ? [] : [{ kind: "state_participant", participant: "trust", plan: execution.trust } as const]),
    { kind: "state_participant", participant: "rollback_record", plan: execution.rollback },
    { kind: "state_participant", participant: "active", plan: execution.active },
    { kind: "state_participant", participant: "manifest", plan: execution.manifest.terminal },
    { kind: "coordinator_staging" },
    { kind: "coordinator_envelope" },
  ];
}

/** Phase is derived from the current step; only the verifier admits `verifying`. */
export function updateStepPhase(step: UpdateLifecycleCoordinatorStepV1): UpdateLifecycleCoordinatorPhaseV2 {
  switch (step.kind) {
    case "active":
      return "active_publishing";
    case "target_verifier":
      return "verifying";
    case "recovery_executor":
    case "terminal_retire":
      return "terminal_finalizing";
    case "manifest":
      return step.transition === "publish_terminal" || step.transition === "finalize_tombstones" ? "terminal_finalizing" : "participants_applying";
    default:
      return "participants_applying";
  }
}

function verifierIndex(plan: Pick<UpdateLifecycleCoordinatorPlanV2, "steps">): number {
  const index = plan.steps.findIndex((step) => step.kind === "target_verifier");
  if (index < 0) fail("UpdateLifecycleCoordinatorPlanV2: no verifier step");
  return index;
}

/** The greatest reached reversible step at or below `cursor`, or -1 when nothing is left to reverse. */
export function updateCompensationCursor(steps: readonly UpdateLifecycleCoordinatorStepV1[], cursor: number): number {
  for (let index = Math.min(cursor, steps.length - 1); index >= 0; index -= 1) {
    if (isReversibleUpdateStep(steps[index] as UpdateLifecycleCoordinatorStepV1)) return index;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Coordinator plan codec.
// ---------------------------------------------------------------------------------------------

function parseStep(value: unknown, label: string): UpdateLifecycleCoordinatorStepV1 {
  const input = record(value, label);
  switch (input.kind) {
    case "bundle": {
      const arm = exact(value, ["kind", "action"], label);
      return { kind: "bundle", action: oneOf(arm.action, ["publish_target", "verify_previous"] as const, `${label}.action`) };
    }
    case "owner_files":
    case "owner_external_effect": {
      const arm = exact(value, ["kind", "owner", "direction"], label);
      return { kind: input.kind, owner: oneOf(arm.owner, OWNER_UPDATE_ORDER, `${label}.owner`), direction: oneOf(arm.direction, ["forward", "inverse"] as const, `${label}.direction`) };
    }
    case "schema_migration": {
      const arm = exact(value, ["kind", "id", "direction"], label);
      return { kind: "schema_migration", id: parseSchemaMigrationId(arm.id), direction: oneOf(arm.direction, ["forward", "inverse"] as const, `${label}.direction`) };
    }
    case "manifest": {
      const arm = exact(value, ["kind", "transition"], label);
      return { kind: "manifest", transition: oneOf(arm.transition, ["preserve_before", "publish_transitional", "publish_terminal", "finalize_tombstones"] as const, `${label}.transition`) };
    }
    case "trust": {
      const arm = exact(value, ["kind", "transition"], label);
      return { kind: "trust", transition: oneOf(arm.transition, ["publish_monotonic"] as const, `${label}.transition`) };
    }
    case "rollback_payload":
    case "rollback_record": {
      const arm = exact(value, ["kind", "transition"], label);
      return { kind: input.kind, transition: oneOf(arm.transition, ["publish_proposed", "verify_retained"] as const, `${label}.transition`) };
    }
    case "active": {
      const arm = exact(value, ["kind", "transition"], label);
      return { kind: "active", transition: oneOf(arm.transition, ["publish_target", "publish_previous"] as const, `${label}.transition`) };
    }
    case "target_verifier": {
      const arm = exact(value, ["kind", "release"], label);
      return { kind: "target_verifier", release: oneOf(arm.release, ["target", "previous"] as const, `${label}.release`) };
    }
    case "terminal_retire": {
      const arm = exact(value, ["kind", "set"], label);
      return { kind: "terminal_retire", set: oneOf(arm.set, ["prior_rollback", "consumed_rollback_and_rejected_release"] as const, `${label}.set`) };
    }
    case "recovery_executor": {
      const arm = exact(value, ["kind", "transition"], label);
      return { kind: "recovery_executor", transition: oneOf(arm.transition, ["switch_to_fallback"] as const, `${label}.transition`) };
    }
    default:
      return fail(`${label}.kind`);
  }
}

const STATE_PARTICIPANT_KINDS = {
  bundle: "bundle_publication",
  manifest: "manifest_state",
  trust: "release_trust_state",
  rollback_payload: "rollback_payload_state",
  rollback_record: "rollback_record_state",
  active: "active_release_state",
} as const;

function parseCompactionEntry(value: unknown, stagingRoot: CanonicalAbsolutePathV1, label: string): UpdateCompactionEntryV1 {
  const input = record(value, label);
  switch (input.kind) {
    case "owner_update": {
      const arm = exact(value, ["kind", "owner"], label);
      return { kind: "owner_update", owner: oneOf(arm.owner, OWNER_UPDATE_ORDER, `${label}.owner`) };
    }
    case "schema_migration": {
      const arm = exact(value, ["kind", "id"], label);
      return { kind: "schema_migration", id: parseSchemaMigrationId(arm.id) };
    }
    case "owner_external_effect": {
      const arm = exact(value, ["kind", "id"], label);
      return { kind: "owner_external_effect", id: parseLeafPlanId("owner_external_effect", arm.id) as OwnerExternalEffectIdV1 };
    }
    case "state_participant": {
      const arm = exact(value, ["kind", "participant", "plan"], label);
      const participant = oneOf(arm.participant, Object.keys(STATE_PARTICIPANT_KINDS) as (keyof typeof STATE_PARTICIPANT_KINDS)[], `${label}.participant`);
      return { kind: "state_participant", participant, plan: parseRef(arm.plan, STATE_PARTICIPANT_KINDS[participant], stagingRoot, `${label}.plan`) } as UpdateCompactionEntryV1;
    }
    case "coordinator_staging":
    case "coordinator_envelope":
      exact(value, ["kind"], label);
      return { kind: input.kind };
    default:
      return fail(`${label}.kind`);
  }
}

export function updateCoordinatorPlanBytes(plan: UpdateLifecycleCoordinatorPlanV2): Uint8Array {
  return canonicalBytes(plan);
}

export function updateCoordinatorPlanHash(plan: UpdateLifecycleCoordinatorPlanV2): LowerHexSha256 {
  return hashCanonicalJson(UPDATE_COORDINATOR_PLAN_HASH_DOMAIN, plan as unknown as CanonicalJsonValue);
}

/**
 * The widest journal the closed grammar admits for this plan: every cursor at its largest value,
 * the longest phase/operation/direction/outcome, so no legal rewrite can outgrow the reservation.
 */
export function maximumUpdateCoordinatorJournalBytes(plan: Pick<UpdateLifecycleCoordinatorPlanV2, "id" | "steps" | "compaction">): number {
  const widest = {
    schemaVersion: 2,
    id: plan.id,
    operation: "update_rollback",
    phase: "participants_applying",
    direction: "compensating",
    planHash: "f".repeat(64),
    nextStep: plan.steps.length,
    compensationNext: Math.max(plan.steps.length - 1, 1),
    pointOfNoReturnReached: false,
    terminalOutcome: "rolled_back",
    compensationCause: "a".repeat(64),
    retirementNext: MAXIMUM_UPDATE_RETIREMENT_LEAVES,
    compactionNext: plan.compaction.entries.length,
    createdAt: "0000-00-00T00:00:00.000Z",
    updatedAt: "0000-00-00T00:00:00.000Z",
  };
  return canonicalBytes(widest).byteLength;
}

/** The plan's own encoded length, iterated to the fixed point its self-reference requires. */
function exactPlanBytes(plan: UpdateLifecycleCoordinatorPlanV2): number {
  let candidate = plan;
  for (;;) {
    const bytes = canonicalBytes(candidate).byteLength;
    if (bytes === candidate.maximumPlanBytes) return bytes;
    candidate = { ...candidate, maximumPlanBytes: bytes };
  }
}

export interface UpdateCoordinatorPlanInputV1 {
  readonly execution: UpdateExecutionPlanV1;
  readonly executionRef: ImmutableUpdatePlanRefV1<"update_execution">;
  readonly construction: ImmutableUpdateConstructionRefV1;
  readonly owners: readonly UpdateStepOwnerV1[];
  /** The retained payload a finalized update keeps: the proposed set for apply, none for rollback. */
  readonly retainPayloadId: RollbackPayloadIdV1 | null;
}

/** Derives the one legal outer plan for an execution leaf; nothing in it is caller-selected. */
export function buildUpdateCoordinatorPlan(input: UpdateCoordinatorPlanInputV1): UpdateLifecycleCoordinatorPlanV2 {
  const { execution } = input;
  if ((execution.operation === "update_apply") !== (input.retainPayloadId !== null)) fail("UpdateLifecycleTerminalCompactionV1.retainPayloadId");
  const steps = deriveUpdateSteps(execution, input.owners);
  const compaction: UpdateLifecycleTerminalCompactionV1 = {
    coordinatorId: execution.coordinatorId,
    terminalOutcome: "finalized",
    retainPayloadId: input.retainPayloadId,
    entries: deriveUpdateCompactionEntries(execution, input.owners),
  };
  const draft: UpdateLifecycleCoordinatorPlanV2 = {
    schemaVersion: 2,
    id: execution.coordinatorId,
    operation: execution.operation,
    previewHash: execution.previewHash,
    executionBindingHash: execution.executionBindingHash,
    maximumPlanBytes: 1,
    maximumJournalBytes: 1,
    recoveryExecutorInitialHash: execution.recoveryExecutor.initialStaged.hash,
    recoveryExecutorTerminalHash: execution.recoveryExecutor.terminalStaged.hash,
    construction: input.construction,
    update: input.executionRef,
    steps,
    compaction,
  };
  const withJournal = { ...draft, maximumJournalBytes: maximumUpdateCoordinatorJournalBytes(draft) };
  const plan = { ...withJournal, maximumPlanBytes: exactPlanBytes(withJournal) };
  if (plan.maximumPlanBytes > MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES || plan.maximumJournalBytes > MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES) fail("UpdateLifecycleCoordinatorPlanV2: over its cap");
  return plan;
}

/** Strict structural codec; `assertUpdateCoordinatorDerivation` then binds it to its execution leaf. */
export function validateUpdateCoordinatorPlan(value: unknown, productHome: CanonicalAbsolutePathV1): UpdateLifecycleCoordinatorPlanV2 {
  const label = "UpdateLifecycleCoordinatorPlanV2";
  const input = exact(value, PLAN_KEYS, label);
  if (input.schemaVersion !== 2) fail(`${label}.schemaVersion`);
  const id = parseLifecycleCoordinatorId(input.id, null);
  const stagingRoot = updateCoordinatorStagingRoot(productHome, id);
  const construction = exact(input.construction, ["path", "hash", "bytes"], `${label}.construction`);
  if (construction.path !== updateConstructionEnvelopePaths(stagingRoot).plan) fail(`${label}.construction.path`);
  const compaction = exact(input.compaction, ["coordinatorId", "terminalOutcome", "retainPayloadId", "entries"], `${label}.compaction`);
  if (compaction.coordinatorId !== id || compaction.terminalOutcome !== "finalized") fail(`${label}.compaction`);
  const operation = oneOf(input.operation, OPERATIONS, `${label}.operation`);
  const retainPayloadId = compaction.retainPayloadId === null ? null : parseRollbackPayloadId(compaction.retainPayloadId);
  const plan: UpdateLifecycleCoordinatorPlanV2 = {
    schemaVersion: 2,
    id,
    operation,
    previewHash: parseLowerHexSha256(input.previewHash),
    executionBindingHash: parseLowerHexSha256(input.executionBindingHash),
    maximumPlanBytes: integer(input.maximumPlanBytes, 1, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES, `${label}.maximumPlanBytes`),
    maximumJournalBytes: integer(input.maximumJournalBytes, 1, MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES, `${label}.maximumJournalBytes`),
    recoveryExecutorInitialHash: parseLowerHexSha256(input.recoveryExecutorInitialHash),
    recoveryExecutorTerminalHash: parseLowerHexSha256(input.recoveryExecutorTerminalHash),
    construction: { path: updateConstructionEnvelopePaths(stagingRoot).plan, hash: parseLowerHexSha256(construction.hash), bytes: integer(construction.bytes, 1, MAX_CONSTRUCTION_BYTES, `${label}.construction.bytes`) },
    update: parseRef(input.update, "update_execution", stagingRoot, `${label}.update`),
    steps: array(input.steps, 1, MAXIMUM_UPDATE_COORDINATOR_STEPS, `${label}.steps`).map((step, index) => parseStep(step, `${label}.steps[${index.toString(10)}]`)),
    compaction: {
      coordinatorId: id,
      terminalOutcome: "finalized",
      retainPayloadId,
      entries: array(compaction.entries, 3, MAXIMUM_UPDATE_COMPACTION_ENTRIES, `${label}.compaction.entries`).map((entry, index) => parseCompactionEntry(entry, stagingRoot, `${label}.compaction.entries[${index.toString(10)}]`)),
    },
  };
  if ((operation === "update_apply") !== (retainPayloadId !== null)) fail(`${label}.compaction.retainPayloadId`);
  if (plan.maximumJournalBytes !== maximumUpdateCoordinatorJournalBytes(plan)) fail(`${label}.maximumJournalBytes`);
  if (plan.maximumPlanBytes !== canonicalBytes(plan).byteLength) fail(`${label}.maximumPlanBytes`);
  verifierIndex(plan);
  return plan;
}

/**
 * Recomputes steps, compaction, binding, and both record hashes from the reopened execution leaf
 * and owner plans; the outer plan's copy must equal the derivation byte-for-byte.
 */
export function assertUpdateCoordinatorDerivation(plan: UpdateLifecycleCoordinatorPlanV2, execution: UpdateExecutionPlanV1, owners: readonly UpdateStepOwnerV1[]): void {
  const derived = buildUpdateCoordinatorPlan({ execution, executionRef: plan.update, construction: plan.construction, owners, retainPayloadId: plan.compaction.retainPayloadId });
  if (!same(derived, plan)) fail("UpdateLifecycleCoordinatorPlanV2: not its derivation");
}

/**
 * The shared 16-MiB pre-parse reader: exact canonical bytes first, then dispatch on the exact
 * `schemaVersion` alone. No untrusted prefix selects a larger allocation or a mixed field set.
 */
export function readLifecycleExecutionPlanV2<TPlanV1>(
  bytes: Uint8Array,
  codecs: { readonly v1: (value: unknown) => TPlanV1; readonly productHome: CanonicalAbsolutePathV1 },
): LifecycleExecutionPlanDispatchV2<TPlanV1> {
  if (bytes.byteLength > MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES) fail("lifecycle execution plan: over 16 MiB");
  const value = decodeCanonicalJson(bytes, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES);
  if (encodeCanonicalJson(value) !== new TextDecoder().decode(bytes)) fail("lifecycle execution plan: not canonical");
  const version = record(value, "lifecycle execution plan").schemaVersion;
  if (version === 1) return { schemaVersion: 1, plan: codecs.v1(value) };
  if (version === 2) return { schemaVersion: 2, plan: validateUpdateCoordinatorPlan(value, codecs.productHome) };
  return fail("lifecycle execution plan: unknown schemaVersion");
}

// ---------------------------------------------------------------------------------------------
// Coordinator journal codec and transitions.
// ---------------------------------------------------------------------------------------------

export function initialUpdateCoordinatorJournal(plan: UpdateLifecycleCoordinatorPlanV2, createdAt: UtcTimestampV1): UpdateLifecycleCoordinatorJournalV2 {
  return {
    schemaVersion: 2,
    id: plan.id,
    operation: plan.operation,
    phase: "planned",
    direction: "forward",
    planHash: updateCoordinatorPlanHash(plan),
    nextStep: 0,
    compensationNext: null,
    pointOfNoReturnReached: false,
    terminalOutcome: null,
    compensationCause: null,
    retirementNext: null,
    compactionNext: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateCoordinatorJournalBytes(plan: UpdateLifecycleCoordinatorPlanV2, journal: UpdateLifecycleCoordinatorJournalV2): Uint8Array {
  const bytes = canonicalBytes(journal);
  if (bytes.byteLength > plan.maximumJournalBytes) fail("UpdateLifecycleCoordinatorJournalV2: over its maximum");
  return bytes;
}

/** Both outer byte strings the construction envelope publishes at handoff (Task 18's `publishOuter`). */
export function updateCoordinatorOuterBytes(plan: UpdateLifecycleCoordinatorPlanV2, outerJournalCreatedAt: UtcTimestampV1): { readonly plan: Uint8Array; readonly journal: Uint8Array } {
  return { plan: updateCoordinatorPlanBytes(plan), journal: updateCoordinatorJournalBytes(plan, initialUpdateCoordinatorJournal(plan, outerJournalCreatedAt)) };
}

/**
 * The closed phase/cursor table. Forward phases equal the current step's derived phase; the point
 * of no return is at or after the verifier and forbids compensation; `retirementNext` lives only
 * at `terminal_retire`, `compactionNext` only in `compacting`; every unused cursor is null.
 */
export function validateUpdateCoordinatorJournal(value: unknown, plan: UpdateLifecycleCoordinatorPlanV2, planHash: LowerHexSha256): UpdateLifecycleCoordinatorJournalV2 {
  const label = "UpdateLifecycleCoordinatorJournalV2";
  const input = exact(value, JOURNAL_KEYS, label);
  if (input.schemaVersion !== 2 || input.id !== plan.id || input.operation !== plan.operation || input.planHash !== planHash) fail(`${label}: identity`);
  if (typeof input.pointOfNoReturnReached !== "boolean") fail(`${label}.pointOfNoReturnReached`);
  const steps = plan.steps.length;
  const journal: UpdateLifecycleCoordinatorJournalV2 = {
    schemaVersion: 2,
    id: plan.id,
    operation: plan.operation,
    phase: oneOf(input.phase, PHASES, `${label}.phase`),
    direction: oneOf(input.direction, ["forward", "compensating"] as const, `${label}.direction`),
    planHash,
    nextStep: integer(input.nextStep, 0, steps, `${label}.nextStep`),
    compensationNext: nullableInteger(input.compensationNext, -1, steps - 1, `${label}.compensationNext`),
    pointOfNoReturnReached: input.pointOfNoReturnReached,
    terminalOutcome: input.terminalOutcome === null ? null : oneOf(input.terminalOutcome, ["finalized", "rolled_back"] as const, `${label}.terminalOutcome`),
    compensationCause: input.compensationCause === null ? null : parseSafeReasonCode(input.compensationCause),
    retirementNext: nullableInteger(input.retirementNext, 0, MAXIMUM_UPDATE_RETIREMENT_LEAVES, `${label}.retirementNext`),
    compactionNext: nullableInteger(input.compactionNext, 0, plan.compaction.entries.length, `${label}.compactionNext`),
    createdAt: parseUtcTimestamp(input.createdAt),
    updatedAt: parseUtcTimestamp(input.updatedAt),
  };
  if (journal.updatedAt < journal.createdAt) fail(`${label}: time runs backward`);
  const verifier = verifierIndex(plan);
  const current = plan.steps[journal.nextStep];
  const legal = ((): boolean => {
    if (journal.pointOfNoReturnReached && journal.nextStep < verifier) return false;
    if (!journal.pointOfNoReturnReached && journal.nextStep > verifier) return false;
    if (journal.compactionNext !== null && journal.phase !== "compacting") return false;
    if (journal.retirementNext !== null && (journal.phase !== "terminal_finalizing" || current?.kind !== "terminal_retire")) return false;
    const terminalPhase = journal.phase === "finalized" || journal.phase === "rolled_back" || journal.phase === "compacting";
    if ((journal.terminalOutcome !== null) !== terminalPhase) return false;
    if ((journal.compensationCause !== null) !== (journal.direction === "compensating")) return false;
    if (journal.direction === "forward") {
      if (journal.compensationNext !== null) return false;
      switch (journal.phase) {
        case "planned":
          return journal.nextStep === 0 && !journal.pointOfNoReturnReached;
        case "finalized":
          return journal.nextStep === steps && journal.pointOfNoReturnReached && journal.terminalOutcome === "finalized";
        case "compacting":
          return journal.nextStep === steps && journal.pointOfNoReturnReached && journal.terminalOutcome === "finalized" && journal.compactionNext !== null;
        case "compensating":
        case "rolled_back":
          return false;
        default:
          return current !== undefined && updateStepPhase(current) === journal.phase && (journal.phase !== "terminal_finalizing" || journal.pointOfNoReturnReached);
      }
    }
    if (journal.pointOfNoReturnReached || journal.compensationNext === null || journal.nextStep >= steps) return false;
    if (journal.compensationNext > journal.nextStep || (journal.compensationNext >= 0 && updateCompensationCursor(plan.steps, journal.compensationNext) !== journal.compensationNext)) return false;
    switch (journal.phase) {
      case "compensating":
        return journal.terminalOutcome === null;
      case "rolled_back":
        return journal.compensationNext === -1 && journal.terminalOutcome === "rolled_back";
      case "compacting":
        return journal.compensationNext === -1 && journal.terminalOutcome === "rolled_back" && journal.compactionNext !== null;
      default:
        return false;
    }
  })();
  if (!legal) fail(`${label}: phase/cursor`);
  return journal;
}

export type UpdateCoordinatorJournalEventV1 =
  | { readonly kind: "start" }
  | { readonly kind: "step_completed" }
  | { readonly kind: "point_of_no_return" }
  | { readonly kind: "retirement_started" }
  | { readonly kind: "retirement_leaf"; readonly maximumLeaves: number }
  | { readonly kind: "compensation_started"; readonly cause: SafeReasonCodeV1 }
  | { readonly kind: "compensation_step_completed" }
  | { readonly kind: "rolled_back" }
  | { readonly kind: "compaction_started" }
  | { readonly kind: "compaction_entry_completed" };

/**
 * The only legal journal transitions. Each result is revalidated against the closed table, so an
 * event out of order refuses here rather than being persisted.
 */
export function advanceUpdateCoordinatorJournal(plan: UpdateLifecycleCoordinatorPlanV2, journal: UpdateLifecycleCoordinatorJournalV2, event: UpdateCoordinatorJournalEventV1, updatedAt: UtcTimestampV1): UpdateLifecycleCoordinatorJournalV2 {
  const stamp = updatedAt > journal.updatedAt ? updatedAt : journal.updatedAt;
  const phaseAt = (index: number): UpdateLifecycleCoordinatorPhaseV2 => {
    const step = plan.steps[index];
    return step === undefined ? "finalized" : updateStepPhase(step);
  };
  let next: UpdateLifecycleCoordinatorJournalV2;
  switch (event.kind) {
    case "start":
      if (journal.phase !== "planned") fail("coordinator event start");
      next = { ...journal, phase: phaseAt(0) };
      break;
    case "step_completed": {
      if (journal.direction !== "forward" || journal.phase === "planned" || journal.nextStep >= plan.steps.length) fail("coordinator event step_completed");
      const step = plan.steps[journal.nextStep] as UpdateLifecycleCoordinatorStepV1;
      if (step.kind === "target_verifier" && !journal.pointOfNoReturnReached) fail("coordinator event step_completed: verifier without point of no return");
      const following = journal.nextStep + 1;
      next = { ...journal, nextStep: following, phase: phaseAt(following), retirementNext: null, terminalOutcome: following === plan.steps.length ? "finalized" : null };
      break;
    }
    case "point_of_no_return":
      if (plan.steps[journal.nextStep]?.kind !== "target_verifier" || journal.direction !== "forward" || journal.pointOfNoReturnReached) fail("coordinator event point_of_no_return");
      next = { ...journal, pointOfNoReturnReached: true };
      break;
    case "retirement_started":
      if (plan.steps[journal.nextStep]?.kind !== "terminal_retire" || journal.retirementNext !== null) fail("coordinator event retirement_started");
      next = { ...journal, retirementNext: 0 };
      break;
    case "retirement_leaf": {
      const maximum = integer(event.maximumLeaves, 0, MAXIMUM_UPDATE_RETIREMENT_LEAVES, "terminal retirement maximumLeaves");
      if (journal.retirementNext === null || journal.retirementNext >= maximum) fail("coordinator event retirement_leaf");
      next = { ...journal, retirementNext: journal.retirementNext + 1 };
      break;
    }
    case "compensation_started":
      if (journal.direction !== "forward" || journal.pointOfNoReturnReached || journal.nextStep >= plan.steps.length) fail("coordinator event compensation_started");
      next = { ...journal, direction: "compensating", phase: "compensating", compensationNext: updateCompensationCursor(plan.steps, journal.nextStep), compensationCause: event.cause, retirementNext: null };
      break;
    case "compensation_step_completed":
      if (journal.phase !== "compensating" || journal.compensationNext === null || journal.compensationNext < 0) fail("coordinator event compensation_step_completed");
      next = { ...journal, compensationNext: updateCompensationCursor(plan.steps, journal.compensationNext - 1) };
      break;
    case "rolled_back":
      if (journal.phase !== "compensating" || journal.compensationNext !== -1) fail("coordinator event rolled_back");
      next = { ...journal, phase: "rolled_back", terminalOutcome: "rolled_back" };
      break;
    case "compaction_started":
      if (journal.phase !== "finalized" && journal.phase !== "rolled_back") fail("coordinator event compaction_started");
      next = { ...journal, phase: "compacting", compactionNext: 0 };
      break;
    case "compaction_entry_completed":
      if (journal.phase !== "compacting" || journal.compactionNext === null || journal.compactionNext >= plan.compaction.entries.length - 1) fail("coordinator event compaction_entry_completed");
      next = { ...journal, compactionNext: journal.compactionNext + 1 };
      break;
  }
  return validateUpdateCoordinatorJournal({ ...next, updatedAt: stamp }, plan, journal.planHash);
}

// ---------------------------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------------------------

export interface UpdateLifecycleCoordinatorStoreV1 {
  /** Reopens the guarded plan and journal; both must be present, canonical, and this plan's. */
  read(id: LifecycleCoordinatorIdV1): Promise<{ readonly plan: UpdateLifecycleCoordinatorPlanV2; readonly journal: UpdateLifecycleCoordinatorJournalV2 }>;
  rewrite(plan: UpdateLifecycleCoordinatorPlanV2, current: UpdateLifecycleCoordinatorJournalV2, next: UpdateLifecycleCoordinatorJournalV2): Promise<void>;
  /** Spec 1's envelope order: journal, held stable lock, then the immutable plan last. */
  removeEnvelope(plan: UpdateLifecycleCoordinatorPlanV2, journal: UpdateLifecycleCoordinatorJournalV2): Promise<void>;
  /** Spec 1 §2.4's `rewrite_temp`: a dead writer's temp the admitted final journal never took. */
  removeRewriteTemps(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void>;
}

export interface UpdateCoordinatorParticipantsV1 extends UpdateParticipantAdapterV1 {
  /** The referenced retirement plan's recomputed `maximumLeaves`. */
  retirementLeaves(step: Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: "terminal_retire" }>): Promise<number>;
  retireLeaf(step: Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: "terminal_retire" }>, ordinal: number): Promise<void>;
}

export interface UpdateRecoveryExecutorPortV1 {
  /** Final absent plus complete initial stage → no-replace rename; exact final `executing` → nothing. */
  publishInitial(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void>;
  /** Exact initial final plus complete terminal stage → replacement; exact terminal final → nothing. */
  switchToFallback(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void>;
  /** Runs only after the envelope is gone: guarded unlink of the exact terminal record. */
  removeRecord(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void>;
}

export type UpdateCoordinatorBoundaryV1 =
  | { readonly kind: "journal_rewritten"; readonly journal: UpdateLifecycleCoordinatorJournalV2 }
  | { readonly kind: "step_returned"; readonly step: number; readonly direction: "forward" | "compensating" }
  | { readonly kind: "executor_published" | "executor_switched" | "envelope_removed" | "executor_removed" };

export interface UpdateLifecycleCoordinatorDependenciesV1 {
  readonly store: UpdateLifecycleCoordinatorStoreV1;
  readonly participants: UpdateCoordinatorParticipantsV1;
  readonly executor: UpdateRecoveryExecutorPortV1;
  /** Reopens the execution leaf and owner plans and runs `assertUpdateCoordinatorDerivation`. */
  readonly verifyPlan: (plan: UpdateLifecycleCoordinatorPlanV2, journal: UpdateLifecycleCoordinatorJournalV2) => Promise<void>;
  /** Proves the held global lock before every mutation; refuses otherwise. */
  readonly requireLock: () => Promise<void>;
  readonly clock: () => UtcTimestampV1;
  readonly afterBoundary?: (boundary: UpdateCoordinatorBoundaryV1) => void | Promise<void>;
}

export type UpdateLifecycleOutcomeV1 =
  | { readonly kind: "finalized"; readonly id: LifecycleCoordinatorIdV1 }
  | { readonly kind: "rolled_back"; readonly id: LifecycleCoordinatorIdV1; readonly cause: SafeReasonCodeV1 };

interface UpdateSessionV1 {
  readonly plan: UpdateLifecycleCoordinatorPlanV2;
  journal: UpdateLifecycleCoordinatorJournalV2;
}

const UNNAMED_CAUSE = parseSafeReasonCode("update_coordinator_compensated");

function causeOf(error: unknown): SafeReasonCodeV1 {
  if (error !== null && typeof error === "object" && "reason" in error) {
    try {
      return parseSafeReasonCode((error as { readonly reason: unknown }).reason);
    } catch {
      return UNNAMED_CAUSE;
    }
  }
  return parseSafeReasonCode("update_step_failed");
}

/**
 * §9.3/§9.4's engine. It drives only derived steps: forward until the verifier's durable success
 * crosses the point of no return, then force-forward through retirement, the terminal manifest,
 * and compaction. Before that point a semantic failure (`UpdateStepRejectedError`, or any error
 * that is not recovery-required) compensates the exact reached reverse list;
 * a third state (`LifecycleRecoveryRequiredError`) preserves evidence as exit 6. Process death
 * never chooses a direction: `recover` resumes whatever the journal recorded.
 */
export class UpdateLifecycleCoordinator {
  readonly #dependencies: UpdateLifecycleCoordinatorDependenciesV1;

  constructor(dependencies: UpdateLifecycleCoordinatorDependenciesV1) {
    this.#dependencies = dependencies;
  }

  /** A fresh coordinator the construction envelope just handed off: its journal is still `planned`. */
  async execute(id: LifecycleCoordinatorIdV1): Promise<UpdateLifecycleOutcomeV1> {
    const session = await this.#open(id);
    if (session.journal.phase !== "planned") refuseLifecycleRecovery("update_coordinator_not_fresh", id);
    return this.#run(session);
  }

  /** Resumes in the persisted direction under the global lock, with no network or planner authority. */
  async recover(id: LifecycleCoordinatorIdV1): Promise<UpdateLifecycleOutcomeV1> {
    const session = await this.#open(id);
    await this.#dependencies.store.removeRewriteTemps(session.plan);
    return this.#run(session);
  }

  async #open(id: LifecycleCoordinatorIdV1): Promise<UpdateSessionV1> {
    await this.#dependencies.requireLock();
    const { plan, journal } = await this.#dependencies.store.read(id);
    if (plan.id !== id || journal.id !== id) refuseLifecycleRecovery("update_coordinator_identity", id);
    await this.#dependencies.verifyPlan(plan, journal);
    return { plan, journal };
  }

  async #boundary(boundary: UpdateCoordinatorBoundaryV1): Promise<void> {
    await this.#dependencies.afterBoundary?.(boundary);
  }

  async #advance(session: UpdateSessionV1, event: UpdateCoordinatorJournalEventV1): Promise<void> {
    await this.#dependencies.requireLock();
    const next = advanceUpdateCoordinatorJournal(session.plan, session.journal, event, this.#dependencies.clock());
    await this.#dependencies.store.rewrite(session.plan, session.journal, next);
    session.journal = next;
    await this.#boundary({ kind: "journal_rewritten", journal: next });
  }

  async #run(session: UpdateSessionV1): Promise<UpdateLifecycleOutcomeV1> {
    for (;;) {
      const { journal } = session;
      switch (journal.phase) {
        case "planned":
          await this.#dependencies.executor.publishInitial(session.plan);
          await this.#boundary({ kind: "executor_published" });
          await this.#advance(session, { kind: "start" });
          break;
        case "compensating":
          await this.#compensateOnce(session);
          break;
        case "finalized":
          await this.#advance(session, { kind: "compaction_started" });
          break;
        case "rolled_back":
          /** §9.2: the old release is restored and verified, so routing may now leave it. */
          await this.#dependencies.executor.switchToFallback(session.plan);
          await this.#boundary({ kind: "executor_switched" });
          await this.#advance(session, { kind: "compaction_started" });
          break;
        case "compacting": {
          const done = await this.#compactOnce(session);
          if (done) {
            if (journal.compensationCause === null) return { kind: "finalized", id: session.plan.id };
            return { kind: "rolled_back", id: session.plan.id, cause: journal.compensationCause };
          }
          break;
        }
        default:
          await this.#forwardOnce(session);
      }
    }
  }

  async #forwardOnce(session: UpdateSessionV1): Promise<void> {
    const index = session.journal.nextStep;
    const step = session.plan.steps[index];
    if (step === undefined) return refuseLifecycleRecovery("update_coordinator_cursor", session.plan.id);
    try {
      await this.#applyStep(session, step);
    } catch (error) {
      if (session.journal.pointOfNoReturnReached || error instanceof LifecycleRecoveryRequiredError) throw error;
      await this.#advance(session, { kind: "compensation_started", cause: causeOf(error) });
      return;
    }
    await this.#boundary({ kind: "step_returned", step: index, direction: "forward" });
    await this.#advance(session, { kind: "step_completed" });
  }

  async #applyStep(session: UpdateSessionV1, step: UpdateLifecycleCoordinatorStepV1): Promise<void> {
    const { participants, executor, requireLock } = this.#dependencies;
    await requireLock();
    switch (step.kind) {
      case "recovery_executor":
        await executor.switchToFallback(session.plan);
        await this.#boundary({ kind: "executor_switched" });
        return;
      case "terminal_retire": {
        if (session.journal.retirementNext === null) await this.#advance(session, { kind: "retirement_started" });
        const maximumLeaves = await participants.retirementLeaves(step);
        for (let cursor = session.journal.retirementNext ?? 0; cursor < maximumLeaves; cursor += 1) {
          await participants.retireLeaf(step, cursor);
          await this.#advance(session, { kind: "retirement_leaf", maximumLeaves });
        }
        if (session.journal.retirementNext !== maximumLeaves) refuseLifecycleRecovery("update_retirement_cursor", session.plan.id);
        return;
      }
      case "target_verifier": {
        if (!session.journal.pointOfNoReturnReached) {
          const observed = await participants.apply(step);
          if (observed.state !== "verified") rejectUpdateStep("update_verifier_not_verified", session.plan.id);
          await this.#advance(session, { kind: "point_of_no_return" });
        }
        return;
      }
      default: {
        const observed = await participants.apply(step);
        if (observed.state === "applied" || observed.state === "verified") return;
        // A step left at or returned to its preimage is a semantic refusal; after the point of no return nothing may compensate.
        if (!session.journal.pointOfNoReturnReached && (observed.state === "before" || observed.state === "compensated")) rejectUpdateStep("update_step_not_applied", session.plan.id);
        refuseLifecycleRecovery("update_step_not_applied", session.plan.id);
      }
    }
  }

  /** One reversible step in the plan-derived reverse list; trust is never on it. */
  async #compensateOnce(session: UpdateSessionV1): Promise<void> {
    const cursor = session.journal.compensationNext;
    if (cursor === null) return refuseLifecycleRecovery("update_compensation_cursor", session.plan.id);
    if (cursor === -1) {
      await this.#advance(session, { kind: "rolled_back" });
      return;
    }
    const step = session.plan.steps[cursor] as UpdateLifecycleCoordinatorStepV1;
    await this.#dependencies.requireLock();
    const observed = await this.#dependencies.participants.compensate(step);
    if (observed.state !== "compensated" && observed.state !== "before") refuseLifecycleRecovery("update_step_not_compensated", session.plan.id);
    await this.#boundary({ kind: "step_returned", step: cursor, direction: "compensating" });
    await this.#advance(session, { kind: "compensation_step_completed" });
  }

  /** One top-level entry; the envelope is last and its journal never records its own deletion. */
  async #compactOnce(session: UpdateSessionV1): Promise<boolean> {
    const cursor = session.journal.compactionNext;
    const entry = cursor === null ? undefined : session.plan.compaction.entries[cursor];
    if (entry === undefined) return refuseLifecycleRecovery("update_compaction_cursor", session.plan.id);
    await this.#dependencies.requireLock();
    if (entry.kind === "coordinator_envelope") {
      await this.#dependencies.store.removeEnvelope(session.plan, session.journal);
      await this.#boundary({ kind: "envelope_removed" });
      await this.#dependencies.executor.removeRecord(session.plan);
      await this.#boundary({ kind: "executor_removed" });
      return true;
    }
    await this.#dependencies.participants.compact(entry);
    await this.#advance(session, { kind: "compaction_entry_completed" });
    return false;
  }
}

/** The exact product-state plan/journal pair a V2 coordinator shares with Spec 1. */
export function updateCoordinatorEnvelopePaths(productHome: CanonicalAbsolutePathV1, id: LifecycleCoordinatorIdV1): { readonly plan: ExactProductStatePathV1; readonly journal: ExactProductStatePathV1 } {
  return { plan: deriveExactProductStatePath(productHome, "lifecycle_plan", id as unknown as SafeReasonCodeV1), journal: deriveExactProductStatePath(productHome, "lifecycle_journal", id as unknown as SafeReasonCodeV1) };
}
