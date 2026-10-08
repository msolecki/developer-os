/**
 * Spec 2 §9.2's target participants: the persisted owner, owner-effect, canonical-state, and
 * target-verifier plans plus the journal phase/cursor tables the CLI executors drive. Pure: every
 * function validates or hashes; nothing here opens a file, spawns a process, or reads a clock.
 */

import { compareUtf8, encodeCanonicalJson, hashCanonicalJsonNoLf, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { AllocatedLifecycleIdV1, EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { ArtifactOwner, ManagedArtifactV2 } from "../manifest/types.js";
import { parseLeafPlanId, type ImmutableUpdatePlanRefV1, type OwnerExternalEffectIdV1, type UpdateLeafPlanIdV1 } from "./construction.js";
import { checkUpdateFoundationMutations, type SchemaMigrationPlanV1, type UpdateFoundationParticipantRefV2, type UpdatePayloadRefV1 } from "./migrations.js";
import { OWNER_UPDATE_ORDER, MAX_OWNER_CHANGED_FILE_BYTES } from "./owner.js";
import { migrationPostimagesHash, ownerPostimagesHash, updateParticipantDocumentBytes, updateParticipantDocumentHash } from "./postimages.js";
import type { OwnerPostimageRowInputV1 } from "./postimages.js";

export { migrationPostimagesHash, ownerPostimagesHash, updateParticipantDocumentBytes, updateParticipantDocumentHash };
export type { OwnerPostimageRowInputV1 };
import {
  deriveCanonicalStatePayloadPath,
  deriveUpdatePayloadPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalStatePayloadPathV1,
} from "./paths.js";
import { parseBundleRelativePath, type BundleRelativePathV1, type ReleaseIdentityV1 } from "./release.js";
import {
  exact,
  fail,
  integer,
  nullableInteger,
  record,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
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
// Coordinator steps and compaction entries (spec §9.2). Task 22's coordinator consumes these.
// ---------------------------------------------------------------------------------------------

export type UpdateLifecycleCoordinatorStepV1 =
  | { readonly kind: "bundle"; readonly action: "publish_target" | "verify_previous" }
  | { readonly kind: "owner_files"; readonly owner: ArtifactOwner; readonly direction: "forward" | "inverse" }
  | { readonly kind: "owner_external_effect"; readonly owner: ArtifactOwner; readonly direction: "forward" | "inverse" }
  | { readonly kind: "schema_migration"; readonly id: SchemaMigrationIdV1; readonly direction: "forward" | "inverse" }
  | { readonly kind: "manifest"; readonly transition: "preserve_before" | "publish_transitional" | "publish_terminal" | "finalize_tombstones" }
  | { readonly kind: "trust"; readonly transition: "publish_monotonic" }
  | { readonly kind: "rollback_payload"; readonly transition: "publish_proposed" | "verify_retained" }
  | { readonly kind: "rollback_record"; readonly transition: "publish_proposed" | "verify_retained" }
  | { readonly kind: "active"; readonly transition: "publish_target" | "publish_previous" }
  | { readonly kind: "target_verifier"; readonly release: "target" | "previous" }
  | { readonly kind: "terminal_retire"; readonly set: "prior_rollback" | "consumed_rollback_and_rejected_release" }
  | { readonly kind: "recovery_executor"; readonly transition: "switch_to_fallback" };

export type UpdateStateCompactionEntryV1 =
  | { readonly kind: "state_participant"; readonly participant: "bundle"; readonly plan: ImmutableUpdatePlanRefV1<"bundle_publication"> }
  | { readonly kind: "state_participant"; readonly participant: "manifest"; readonly plan: ImmutableUpdatePlanRefV1<"manifest_state"> }
  | { readonly kind: "state_participant"; readonly participant: "trust"; readonly plan: ImmutableUpdatePlanRefV1<"release_trust_state"> }
  | { readonly kind: "state_participant"; readonly participant: "rollback_payload"; readonly plan: ImmutableUpdatePlanRefV1<"rollback_payload_state"> }
  | { readonly kind: "state_participant"; readonly participant: "rollback_record"; readonly plan: ImmutableUpdatePlanRefV1<"rollback_record_state"> }
  | { readonly kind: "state_participant"; readonly participant: "active"; readonly plan: ImmutableUpdatePlanRefV1<"active_release_state"> };

export type UpdateCompactionEntryV1 =
  | { readonly kind: "owner_update"; readonly owner: ArtifactOwner }
  | { readonly kind: "schema_migration"; readonly id: SchemaMigrationIdV1 }
  | { readonly kind: "owner_external_effect"; readonly id: OwnerExternalEffectIdV1 }
  | UpdateStateCompactionEntryV1
  | { readonly kind: "coordinator_staging" }
  | { readonly kind: "coordinator_envelope" };

/**
 * §9.4's semantic failure: a step refused or rolled itself back without leaving a third state.
 * Before the point of no return the coordinator compensates on it and reports `reason` as the
 * cause; it deliberately is not a `LifecycleRecoveryRequiredError`, which means exit 6.
 */
export class UpdateStepRejectedError extends Error {
  readonly reason: SafeReasonCodeV1;
  readonly paths: readonly string[];

  constructor(reason: string, paths: readonly string[], options?: { readonly cause?: unknown }) {
    super(`update step rejected: ${reason}`, options);
    this.name = "UpdateStepRejectedError";
    this.reason = parseSafeReasonCode(reason);
    this.paths = [...paths];
  }
}

export function rejectUpdateStep(reason: string, ...paths: readonly string[]): never {
  throw new UpdateStepRejectedError(reason, paths);
}

/** What a participant durably reached at one step; the coordinator advances only on this. */
export interface UpdateParticipantObservationV1 {
  readonly state: "before" | "applied" | "verified" | "compensated" | "not_reversed";
}

/** The one adapter surface the coordinator drives; every method resumes from the persisted journal. */
export interface UpdateParticipantAdapterV1 {
  apply(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  observe(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  compensate(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1>;
  compact(entry: UpdateCompactionEntryV1): Promise<void>;
}

/** §9.3/§9.4: trust is observed but never reversed; every other reached step is. */
export function isReversibleUpdateStep(step: UpdateLifecycleCoordinatorStepV1): boolean {
  return step.kind !== "trust" && step.kind !== "terminal_retire" && step.kind !== "recovery_executor";
}

// ---------------------------------------------------------------------------------------------
// Owner update plans (spec §9.2 `OwnerUpdatePlanV1`).
// ---------------------------------------------------------------------------------------------

export type PersistedManagedPathStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "ephemeral_present"; readonly mode: 384; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly state: "file"; readonly mode: 384 | 448; readonly hash: LowerHexSha256; readonly bytes: number; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly state: "directory"; readonly mode: 448; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly state: "symlink"; readonly targetBytes: number; readonly targetHash: LowerHexSha256; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export interface PersistedOwnerChangeOperationV1 {
  readonly operation: "keep" | "create" | "replace" | "remove";
  readonly owner: ArtifactOwner;
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly expectedBefore: PersistedManagedPathStateV1;
  readonly afterArtifact: ManagedArtifactV2 | null;
  readonly content: UpdatePayloadRefV1 | null;
}

export interface OwnerUpdatePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly owner: ArtifactOwner;
  readonly currentPartitionHash: LowerHexSha256;
  readonly operations: readonly PersistedOwnerChangeOperationV1[];
  readonly foundation: readonly UpdateFoundationParticipantRefV2[];
  readonly externalEffects: readonly ImmutableUpdatePlanRefV1<"owner_external_effect">[];
  readonly inverseOperationHash: LowerHexSha256;
  readonly maximumPlanBytes: number;
}

export interface OwnerUpdatePlanContextV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  /** The owner's complete current manifest partition, in manifest order, from the guarded preimage. */
  readonly currentPartition: readonly ManagedArtifactV2[];
  /** P9 (D72): selects the slot admission; absent means `update_apply`. */
  readonly operation?: "update_apply" | "update_rollback";
}

export interface OwnerUpdateJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "files_applying" | "effects_applying" | "verified" | "compensating" | "finalized" | "rolled_back" | "compacting";
  readonly nextForwardFoundation: number;
  readonly nextExternalEffect: number;
  readonly compensationNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export const MAXIMUM_UPDATE_LEAF_PLAN_BYTES = 16_777_216;
export const MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES = 1_048_576;
export const MAXIMUM_OWNER_EXTERNAL_EFFECT_EVIDENCE_BYTES = 1_048_576;

const MAX_OWNER_OPERATIONS = 1_000_000;
const MAX_OWNER_FOUNDATION_REFS = 7_814;
const MAX_OWNER_FORWARD_REFS = 3_907;
/** Spec 2 §5.3 as amended by P9 (D72): a rollback owner plan takes only `owner_inverse_files` refs. */
const OWNER_SLOTS = {
  update_apply: { forward: "owner_forward_files", compensation: "owner_inverse_files" },
  update_rollback: { forward: "owner_inverse_files", compensation: "owner_inverse_files" },
} as const;
const OWNER_JOURNAL_PHASES: readonly OwnerUpdateJournalV1["phase"][] = ["planned", "files_applying", "effects_applying", "verified", "compensating", "finalized", "rolled_back", "compacting"];

function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}


function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** Spec 2 §9.2: `developer-os/owner-current-partition/v1\0` over the owner's complete manifest rows. */
export function ownerCurrentPartitionHash(owner: ArtifactOwner, rows: readonly ManagedArtifactV2[]): LowerHexSha256 {
  if (rows.length < 1) fail("OwnerUpdatePlanV1.currentPartitionHash: an empty partition");
  if (rows.some((row) => row.owner !== owner)) fail("OwnerUpdatePlanV1.currentPartitionHash: a row of another owner");
  return hashCanonicalJsonNoLf("developer-os/owner-current-partition/v1", rows);
}

/**
 * Spec 2 §9.2: `developer-os/owner-inverse-operations/v1\0` over `{ owner, operations,
 * externalEffects }` of the matching retained inverse plan. The caller passes exactly those three
 * fields, so no binding, source-plan, byte-limit, or containing hash can enter the projection.
 */
export function ownerInverseOperationHash(projection: { readonly owner: ArtifactOwner; readonly operations: readonly CanonicalJsonValue[]; readonly externalEffects: readonly CanonicalJsonValue[] }): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/owner-inverse-operations/v1", { owner: projection.owner, operations: projection.operations, externalEffects: projection.externalEffects });
}

function pathState(value: unknown, label: string): PersistedManagedPathStateV1 {
  const state = record(value, label).state;
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state === "ephemeral_present") {
    const input = exact(value, ["state", "mode", "dev", "ino"], label);
    if (input.mode !== 384) fail(`${label}.mode`);
    return { state: "ephemeral_present", mode: 384, dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
  }
  if (state === "file") {
    const input = exact(value, ["state", "mode", "hash", "bytes", "dev", "ino"], label);
    if (input.mode !== 384 && input.mode !== 448) fail(`${label}.mode`);
    return { state: "file", mode: input.mode, hash: parseLowerHexSha256(input.hash), bytes: integer(input.bytes, 0, 536_870_912, `${label}.bytes`), dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
  }
  if (state === "directory") {
    const input = exact(value, ["state", "mode", "dev", "ino"], label);
    if (input.mode !== 448) fail(`${label}.mode`);
    return { state: "directory", mode: 448, dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
  }
  if (state === "symlink") {
    const input = exact(value, ["state", "targetBytes", "targetHash", "dev", "ino"], label);
    return { state: "symlink", targetBytes: integer(input.targetBytes, 0, 4_096, `${label}.targetBytes`), targetHash: parseLowerHexSha256(input.targetHash), dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
  }
  return fail(`${label}.state`);
}

function payloadRef(value: unknown, plan: Pick<OwnerUpdatePlanV1, "coordinatorId">, context: OwnerUpdatePlanContextV1, label: string): UpdatePayloadRefV1 {
  const input = exact(value, ["kind", "coordinatorId", "ordinal", "path", "bytes", "sha256", "mode"], label);
  if (input.kind !== "update_expected" || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this coordinator's payload`);
  const ordinal = integer(input.ordinal, 0, 1_099_999, `${label}.ordinal`);
  if (input.path !== deriveUpdatePayloadPath(context.productHome, plan.coordinatorId as string as SafeReasonCodeV1, ordinal)) fail(`${label}.path`);
  if (input.mode !== 384 && input.mode !== 448) fail(`${label}.mode`);
  return value as UpdatePayloadRefV1;
}

/** The after artifact's recorded content hash, when it has one. */
function installedHash(artifact: ManagedArtifactV2): LowerHexSha256 | null {
  const verification = artifact.verification as { readonly installedHash?: LowerHexSha256 };
  return verification.installedHash ?? null;
}

function isEphemeral(artifact: ManagedArtifactV2 | null): boolean {
  return artifact?.kind === "file" && artifact.verification.mode === "ephemeral";
}

/**
 * D72 P5: an ephemeral reservation only keeps, over an observed `absent` or `ephemeral_present`
 * before, and its bytes are never read; `ephemeral_present` is legal nowhere else.
 */
function checkEphemeralOperation(operation: PersistedOwnerChangeOperationV1, before: PersistedManagedPathStateV1, label: string): boolean {
  if (!isEphemeral(operation.afterArtifact) && before.state !== "ephemeral_present") return false;
  if (operation.operation !== "keep" || !isEphemeral(operation.afterArtifact) || operation.content !== null) fail(`${label}: an ephemeral reservation only keeps`);
  if (before.state !== "absent" && before.state !== "ephemeral_present") fail(`${label}: an ephemeral keep over a hashed before`);
  return true;
}

/**
 * Spec 2 §9.2's `PersistedOwnerChangeOperationV1` table: create needs absent-before plus an after
 * artifact and payload; replace/remove need a present regular-file before; keep is byte-identical;
 * directories and symlinks only keep; a changed file is at most 16 MiB; and every created file's
 * parent chain is kept directory rows of the same owner.
 */
function checkOperation(operation: PersistedOwnerChangeOperationV1, plan: OwnerUpdatePlanV1, context: OwnerUpdatePlanContextV1, label: string): void {
  exact(operation, ["operation", "owner", "targetPath", "expectedBefore", "afterArtifact", "content"], label);
  if (operation.owner !== plan.owner) fail(`${label}.owner`);
  parseCanonicalAbsolutePathText(operation.targetPath);
  const before = pathState(operation.expectedBefore, `${label}.expectedBefore`);
  const after = operation.afterArtifact;
  if (after !== null && (after.owner !== plan.owner || after.path !== operation.targetPath)) fail(`${label}.afterArtifact: another owner or path`);
  const content = operation.content === null ? null : payloadRef(operation.content, plan, context, `${label}.content`);
  if (checkEphemeralOperation(operation, before, label)) return;
  switch (operation.operation) {
    case "keep":
      if (before.state === "absent" || after === null || content !== null) fail(`${label}: keep is not byte-identical`);
      // A schema row is verified by its schema, never its hash: every gated transaction rewrites the allocator.
      if (before.state === "file" && !(after.kind === "file" && after.verification.mode === "schema") && installedHash(after) !== null && installedHash(after) !== before.hash) fail(`${label}: keep changes the recorded hash`);
      return;
    case "create":
      if (before.state !== "absent" || after?.kind !== "file" || content === null) fail(`${label}: create needs absent before, a file after, and content`);
      break;
    case "replace":
      if (before.state !== "file" || after?.kind !== "file" || content === null) fail(`${label}: replace needs a present file before, a file after, and content`);
      if (before.bytes > MAX_OWNER_CHANGED_FILE_BYTES) fail(`${label}: changes a file over 16 MiB`);
      break;
    case "remove":
      if (before.state !== "file" || after !== null || content !== null) fail(`${label}: remove needs a present file before and no after`);
      if (before.bytes > MAX_OWNER_CHANGED_FILE_BYTES) fail(`${label}: removes a file over 16 MiB`);
      return;
    default:
      fail(`${label}.operation`);
  }
  if (content.bytes > MAX_OWNER_CHANGED_FILE_BYTES) fail(`${label}.content: over 16 MiB`);
  const hash = installedHash(after);
  if (hash !== null && hash !== content.sha256) fail(`${label}.content: differs from the after artifact`);
}

/** Every created file's complete parent chain inside the owner partition is kept directory rows. */
function checkCreateParents(plan: OwnerUpdatePlanV1, label: string): void {
  const keptDirectories = new Set(plan.operations.filter((row) => row.operation === "keep" && row.expectedBefore.state === "directory").map((row) => row.targetPath as string));
  const ownerDirectories = new Set(plan.operations.filter((row) => row.expectedBefore.state === "directory").map((row) => row.targetPath as string));
  for (const row of plan.operations) {
    if (row.operation !== "create") continue;
    const parent = parentOf(row.targetPath);
    if (!keptDirectories.has(parent)) fail(`${label}: create below a missing or non-kept parent`);
    for (let ancestor = parentOf(parent); ownerDirectories.has(ancestor); ancestor = parentOf(ancestor)) {
      if (!keptDirectories.has(ancestor)) fail(`${label}: create below a non-kept ancestor`);
    }
  }
}

/** Forward/compensation refs paired and ordered by ID; forward mutations equal the changed operations. */
function checkOwnerFoundation(plan: OwnerUpdatePlanV1, context: OwnerUpdatePlanContextV1, label: string): void {
  const refs = plan.foundation;
  if (refs.length > MAX_OWNER_FOUNDATION_REFS || refs.length % 2 !== 0) fail(`${label}.foundation: count`);
  for (let index = 1; index < refs.length; index += 1) {
    if (compareUtf8((refs[index - 1] as UpdateFoundationParticipantRefV2).id, (refs[index] as UpdateFoundationParticipantRefV2).id) >= 0) fail(`${label}.foundation: not unique and ordered by ID`);
  }
  const byId = new Map(refs.map((ref) => [ref.id as string, ref]));
  const forward = refs.filter((ref) => ref.role.kind === "forward");
  if (forward.length * 2 !== refs.length || forward.length > MAX_OWNER_FORWARD_REFS) fail(`${label}.foundation: unpaired refs`);
  const slots = OWNER_SLOTS[context.operation ?? "update_apply"];
  for (const ref of refs) {
    if (ref.slot !== (ref.role.kind === "forward" ? slots.forward : slots.compensation)) fail(`${label}.foundation: not an owner slot`);
    if (ref.role.kind !== "forward") continue;
    const compensation = ref.role.compensationId === null ? undefined : byId.get(ref.role.compensationId);
    if (compensation?.role.kind !== "compensation" || compensation.role.forwardId !== ref.id) fail(`${label}.foundation: an unpaired forward ref`);
  }
  const changed = plan.operations.filter((row) => row.operation !== "keep").map((row) => row.targetPath as string).sort(compareUtf8);
  const mutated = forward.flatMap((ref) => ref.mutations.map((mutation) => mutation.targetPath as string));
  if (!same(mutated, changed)) fail(`${label}.foundation: forward mutations are not the changed operation set`);
  // Spec 2 §5.3 (D60): each forward mutation stages exactly its operation's content payload.
  for (const ref of refs) checkUpdateFoundationMutations(ref, plan.coordinatorId, context.productHome);
  const contentByTarget = new Map(plan.operations.map((row) => [row.targetPath as string, row.content]));
  for (const mutation of forward.flatMap((ref) => ref.mutations)) {
    if (!same(mutation.content, contentByTarget.get(mutation.targetPath) ?? null)) fail(`${label}.foundation: a forward mutation stages other content than its operation`);
  }
}

/**
 * Validates one persisted owner plan against the guarded current partition: exact keys, the
 * partition hash recomputed, one operation per current artifact plus creates, the operation table,
 * create parents, paired Foundation refs, at most one Codex-only effect ref, and the byte bound.
 */
export function validateOwnerUpdatePlan(value: unknown, context: OwnerUpdatePlanContextV1): OwnerUpdatePlanV1 {
  const label = "OwnerUpdatePlanV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "owner", "currentPartitionHash", "operations", "foundation", "externalEffects", "inverseOperationHash", "maximumPlanBytes"], label);
  const plan = value as OwnerUpdatePlanV1;
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(plan.id);
  if (!OWNER_UPDATE_ORDER.includes(plan.owner)) fail(`${label}.owner`);
  if (plan.currentPartitionHash !== ownerCurrentPartitionHash(plan.owner, context.currentPartition)) fail(`${label}.currentPartitionHash`);
  parseLowerHexSha256(plan.inverseOperationHash);
  if (!Array.isArray(input.operations) || input.operations.length > MAX_OWNER_OPERATIONS) fail(`${label}.operations: count`);
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const [index, operation] of plan.operations.entries()) {
    checkOperation(operation, plan, context, `${label}.operations[${String(index)}]`);
    const folded = operation.targetPath.toLowerCase();
    if (seen.has(folded)) fail(`${label}.operations: a duplicate or aliased target`);
    seen.add(folded);
    if (previous !== null && compareUtf8(previous, operation.targetPath) >= 0) fail(`${label}.operations: not in path order`);
    previous = operation.targetPath;
  }
  const current = new Set(context.currentPartition.map((row) => row.path as string));
  const installed = plan.operations.filter((row) => row.operation !== "create").map((row) => row.targetPath as string);
  if (installed.length !== current.size || installed.some((path) => !current.has(path))) fail(`${label}.operations: not the complete current partition`);
  if (plan.operations.some((row) => row.operation === "create" && current.has(row.targetPath))) fail(`${label}.operations: create targets an installed path`);
  checkCreateParents(plan, label);
  checkOwnerFoundation(plan, context, label);
  if (plan.externalEffects.length > 1) fail(`${label}.externalEffects: a second effect`);
  if (plan.externalEffects.length === 1 && plan.owner !== "codex") fail(`${label}.externalEffects: a non-Codex effect`);
  for (const ref of plan.externalEffects) {
    if ((ref.kind as string) !== "owner_external_effect") fail(`${label}.externalEffects: kind`);
    parseLeafPlanId("owner_external_effect", ref.id);
  }
  if (plan.operations.every((row) => row.operation === "keep") && plan.externalEffects.length !== 0) fail(`${label}: an effect without a file change`);
  const maximum = integer(plan.maximumPlanBytes, 1, MAXIMUM_UPDATE_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  if (updateParticipantDocumentBytes(plan).byteLength > maximum) fail(`${label}: exceeds its plan bytes`);
  return plan;
}

/** Forward Foundation refs in ID order: the owner journal's `nextForwardFoundation` indexes these. */
export function forwardFoundationRefs(refs: readonly UpdateFoundationParticipantRefV2[]): readonly UpdateFoundationParticipantRefV2[] {
  return refs.filter((ref) => ref.role.kind === "forward");
}

/** The compensation ref paired with a forward ref. */
export function pairedCompensationRef(refs: readonly UpdateFoundationParticipantRefV2[], forward: UpdateFoundationParticipantRefV2): UpdateFoundationParticipantRefV2 {
  const id = forward.role.kind === "forward" ? forward.role.compensationId : null;
  const paired = refs.find((ref) => ref.id === id);
  if (paired?.role.kind !== "compensation") fail("UpdateFoundationParticipantRefV2: an unpaired forward ref");
  return paired;
}

function journalHeader(input: Record<string, unknown>, plan: { readonly id: string; readonly coordinatorId: LifecycleCoordinatorIdV1 }, planHash: LowerHexSha256, label: string): { readonly createdAt: UtcTimestampV1; readonly updatedAt: UtcTimestampV1 } {
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== planHash) fail(`${label}.planHash`);
  const createdAt = parseUtcTimestamp(input.createdAt);
  const updatedAt = parseUtcTimestamp(input.updatedAt);
  if (updatedAt < createdAt) fail(`${label}.updatedAt: before createdAt`);
  return { createdAt, updatedAt };
}

/**
 * Spec 2 §9.2: the owner journal advances forward-role Foundation refs, then its ordered external
 * effects; compensation walks the reached forward prefix down to -1; compaction walks every ref.
 * Every cursor a phase does not use is zero or null.
 */
export function validateOwnerUpdateJournal(value: unknown, plan: OwnerUpdatePlanV1): OwnerUpdateJournalV1 {
  const label = "OwnerUpdateJournalV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextForwardFoundation", "nextExternalEffect", "compensationNext", "compactionNext", "createdAt", "updatedAt"], label);
  const { createdAt, updatedAt } = journalHeader(input, plan, updateParticipantDocumentHash("owner_update", plan), label);
  if (!OWNER_JOURNAL_PHASES.includes(input.phase as OwnerUpdateJournalV1["phase"])) fail(`${label}.phase`);
  const phase = input.phase as OwnerUpdateJournalV1["phase"];
  const forwardCount = plan.foundation.length / 2;
  const effectCount = plan.externalEffects.length;
  const next = integer(input.nextForwardFoundation, 0, forwardCount, `${label}.nextForwardFoundation`);
  const effect = integer(input.nextExternalEffect, 0, effectCount, `${label}.nextExternalEffect`);
  const compensation = nullableInteger(input.compensationNext, -1, Math.max(forwardCount - 1, -1), `${label}.compensationNext`);
  const compaction = nullableInteger(input.compactionNext, 0, plan.foundation.length, `${label}.compactionNext`);
  const filesDone = next === forwardCount;
  const legal =
    (phase === "planned" && next === 0 && effect === 0 && compensation === null && compaction === null) ||
    (phase === "files_applying" && effect === 0 && compensation === null && compaction === null) ||
    (phase === "effects_applying" && filesDone && effectCount === 1 && effect === 0 && compensation === null && compaction === null) ||
    ((phase === "verified" || phase === "finalized") && filesDone && effect === effectCount && compensation === null && compaction === null) ||
    (phase === "compensating" && compensation !== null && compensation < next && compaction === null) ||
    (phase === "rolled_back" && compensation === -1 && compaction === null) ||
    (phase === "compacting" && compaction !== null);
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return { schemaVersion: 1, id: plan.id, coordinatorId: plan.coordinatorId, planHash: input.planHash as LowerHexSha256, phase, nextForwardFoundation: next, nextExternalEffect: effect, compensationNext: compensation, compactionNext: compaction, createdAt, updatedAt };
}

// ---------------------------------------------------------------------------------------------
// Owner external effects (spec §8.3/§9.2): the one closed Codex registration refresh.
// ---------------------------------------------------------------------------------------------

export type OwnerExternalEffectLiteralV1 = string & { readonly __ownerExternalEffectLiteralV1: true };

export type OwnerExternalEffectArgV1 =
  | { readonly kind: "literal"; readonly value: OwnerExternalEffectLiteralV1 }
  | { readonly kind: "token"; readonly value: "managed_plugin_root" | "plugin_id" | "private_effect_tmp" };

export interface OwnerExternalEffectProcessPolicyV1 {
  readonly kind: "codex_registration_refresh";
  readonly providerProtocol: PositiveUInt32V1;
  readonly executable: "pinned_codex_cli";
  /**
   * D72 Q2-A: the canonical real path's identity, rechecked before spawn. A package-manager `codex`
   * is a link into a shared tree, so neither its owner nor its link count is pinned here; the CLI
   * resolver checks ownership and the ancestors' write bits on the filesystem.
   */
  readonly executableIdentity: {
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
    readonly mode: number;
    readonly sha256: LowerHexSha256;
  };
  readonly argv: readonly OwnerExternalEffectArgV1[];
  readonly cwd: "managed_plugin_root";
  readonly environment: readonly [
    { readonly name: "CODEX_HOME"; readonly value: "managed_vendor_home" },
    { readonly name: "TMPDIR"; readonly value: "private_effect_tmp" },
  ];
  readonly stdin: "closed";
  readonly network: false;
  readonly model: false;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly wallMilliseconds: number;
  readonly idleMilliseconds: number;
  readonly processCount: 1;
}

export interface OwnerExternalEffectPlanV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly kind: "codex_registration_refresh";
  readonly owner: "codex";
  readonly providerProtocol: PositiveUInt32V1;
  readonly fileParticipantIds: readonly AllocatedLifecycleIdV1<"tx">[];
  readonly expectedStateHash: LowerHexSha256;
  readonly proposedStateHash: LowerHexSha256;
  readonly processPolicy: OwnerExternalEffectProcessPolicyV1;
  readonly processPolicyHash: LowerHexSha256;
  readonly forwardPayloads: readonly [];
  readonly compensationPayloads: readonly [];
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
  readonly maximumEvidenceBytes: number;
}

export interface OwnerExternalEffectJournalV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "forward_intent" | "forward_observed" | "compensation_intent" | "compensation_observed" | "finalized" | "rolled_back";
  readonly direction: "forward" | "compensating";
  readonly nextTransition: number;
  readonly evidenceHash: LowerHexSha256 | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface OwnerExternalEffectEvidenceV1 {
  readonly schemaVersion: 1;
  readonly id: OwnerExternalEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly direction: "forward" | "compensating";
  readonly observedStateHash: LowerHexSha256;
  readonly processPolicyHash: LowerHexSha256;
  readonly exitCode: 0;
  readonly redactedStdoutHash: LowerHexSha256;
  readonly redactedStderrHash: LowerHexSha256;
  readonly completedAt: UtcTimestampV1;
}

/**
 * The closed tokenized registration projection. `source` is derived by exact guarded equality with
 * the admitted managed plugin root; the raw path, config values, and output never appear here.
 */
export interface CodexRegistrationProjectionV1 {
  readonly pluginId: SafeReasonCodeV1;
  readonly enabled: boolean;
  readonly protocol: PositiveUInt32V1;
  readonly version: SafeReasonCodeV1 | null;
  readonly source: "managed_plugin_root" | "other" | "absent";
}

const EFFECT_JOURNAL_PHASES: readonly OwnerExternalEffectJournalV1["phase"][] = ["planned", "forward_intent", "forward_observed", "compensation_intent", "compensation_observed", "finalized", "rolled_back"];
const ARGV_LITERAL = /^[\x21-\x7e]{1,128}$/u;
const ARG_TOKENS: readonly string[] = ["managed_plugin_root", "plugin_id", "private_effect_tmp"];

export function parseOwnerExternalEffectLiteral(value: unknown): OwnerExternalEffectLiteralV1 {
  if (typeof value !== "string" || !ARGV_LITERAL.test(value)) fail("OwnerExternalEffectLiteralV1");
  return value as OwnerExternalEffectLiteralV1;
}

/** Spec 2 §9.2: `developer-os/codex-registration-projection/v1\0` plus the no-LF projection. */
export function codexRegistrationProjectionHash(projection: CodexRegistrationProjectionV1): LowerHexSha256 {
  const input = exact(projection, ["pluginId", "enabled", "protocol", "version", "source"], "CodexRegistrationProjectionV1");
  parseSafeReasonCode(input.pluginId);
  if (typeof input.enabled !== "boolean") fail("CodexRegistrationProjectionV1.enabled");
  parsePositiveUInt32(input.protocol);
  if (input.version !== null) parseSafeReasonCode(input.version);
  if (!["managed_plugin_root", "other", "absent"].includes(input.source as string)) fail("CodexRegistrationProjectionV1.source");
  return hashCanonicalJsonNoLf("developer-os/codex-registration-projection/v1", { pluginId: projection.pluginId, enabled: projection.enabled, protocol: projection.protocol, version: projection.version, source: projection.source });
}

function validateProcessPolicy(value: unknown): OwnerExternalEffectProcessPolicyV1 {
  const label = "OwnerExternalEffectProcessPolicyV1";
  const input = exact(value, ["kind", "providerProtocol", "executable", "executableIdentity", "argv", "cwd", "environment", "stdin", "network", "model", "stdoutBytes", "stderrBytes", "wallMilliseconds", "idleMilliseconds", "processCount"], label);
  if (input.kind !== "codex_registration_refresh" || input.executable !== "pinned_codex_cli" || input.cwd !== "managed_plugin_root") fail(`${label}: not the closed Codex refresh`);
  parsePositiveUInt32(input.providerProtocol);
  const identity = exact(input.executableIdentity, ["dev", "ino", "mode", "sha256"], `${label}.executableIdentity`);
  const mode = integer(identity.mode, 0, 0o777, `${label}.executableIdentity.mode`);
  if ((mode & 0o022) !== 0 || (mode & 0o100) === 0) fail(`${label}.executableIdentity.mode: writable by others or not executable`);
  parseLowerHexSha256(identity.sha256);
  parseUInt64Decimal(identity.dev);
  parseUInt64Decimal(identity.ino);
  if (!Array.isArray(input.argv) || input.argv.length < 1 || input.argv.length > 64) fail(`${label}.argv: count`);
  for (const [index, arg] of (input.argv as unknown[]).entries()) {
    const row = exact(arg, ["kind", "value"], `${label}.argv[${String(index)}]`);
    if (row.kind === "literal") parseOwnerExternalEffectLiteral(row.value);
    else if (row.kind !== "token" || !ARG_TOKENS.includes(row.value as string)) fail(`${label}.argv[${String(index)}]`);
  }
  if (!same(input.environment, [{ name: "CODEX_HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }])) fail(`${label}.environment`);
  if (input.stdin !== "closed" || input.network !== false || input.model !== false || input.processCount !== 1) fail(`${label}: authority beyond the closed table`);
  integer(input.stdoutBytes, 1, 1_048_576, `${label}.stdoutBytes`);
  integer(input.stderrBytes, 1, 1_048_576, `${label}.stderrBytes`);
  integer(input.wallMilliseconds, 1, 120_000, `${label}.wallMilliseconds`);
  integer(input.idleMilliseconds, 1, 30_000, `${label}.idleMilliseconds`);
  return value as OwnerExternalEffectProcessPolicyV1;
}

/** Spec 2 §9.2: `developer-os/owner-external-effect-process-policy/v1\0` plus the complete no-LF policy. */
export function ownerExternalEffectProcessPolicyHash(policy: OwnerExternalEffectProcessPolicyV1): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/owner-external-effect-process-policy/v1", validateProcessPolicy(policy));
}

/**
 * Validates one persisted effect plan: exact keys, the closed kind/owner, file participant IDs equal
 * to the owner plan's forward-role Foundation IDs, the policy object and its recomputed digest, and
 * the exact empty payload tuples of the closed protocol.
 */
export function validateOwnerExternalEffectPlan(value: unknown, owner: OwnerUpdatePlanV1): OwnerExternalEffectPlanV1 {
  const label = "OwnerExternalEffectPlanV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "kind", "owner", "providerProtocol", "fileParticipantIds", "expectedStateHash", "proposedStateHash", "processPolicy", "processPolicyHash", "forwardPayloads", "compensationPayloads", "maximumPlanBytes", "maximumJournalBytes", "maximumEvidenceBytes"], label);
  const plan = value as OwnerExternalEffectPlanV1;
  if (input.schemaVersion !== 1 || input.kind !== "codex_registration_refresh" || input.owner !== "codex" || owner.owner !== "codex") fail(`${label}: not the closed Codex refresh`);
  parseLeafPlanId("owner_external_effect", plan.id);
  if (plan.coordinatorId !== owner.coordinatorId) fail(`${label}.coordinatorId`);
  const ref = owner.externalEffects[0];
  if (ref?.id !== plan.id) fail(`${label}: not the owner plan's effect`);
  const policy = validateProcessPolicy(plan.processPolicy);
  if (parsePositiveUInt32(plan.providerProtocol) !== policy.providerProtocol) fail(`${label}.providerProtocol`);
  if (plan.processPolicyHash !== ownerExternalEffectProcessPolicyHash(policy)) fail(`${label}.processPolicyHash`);
  if (!same(plan.fileParticipantIds, forwardFoundationRefs(owner.foundation).map((row) => row.id)) || plan.fileParticipantIds.length < 1) fail(`${label}.fileParticipantIds`);
  parseLowerHexSha256(plan.expectedStateHash);
  parseLowerHexSha256(plan.proposedStateHash);
  if (!same(plan.forwardPayloads, []) || !same(plan.compensationPayloads, [])) fail(`${label}: a payload in the closed protocol`);
  const maximum = integer(plan.maximumPlanBytes, 1, MAXIMUM_UPDATE_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  integer(plan.maximumJournalBytes, 1, MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES, `${label}.maximumJournalBytes`);
  integer(plan.maximumEvidenceBytes, 1, MAXIMUM_OWNER_EXTERNAL_EFFECT_EVIDENCE_BYTES, `${label}.maximumEvidenceBytes`);
  if (updateParticipantDocumentBytes(plan).byteLength > maximum) fail(`${label}: exceeds its plan bytes`);
  if (ref.hash !== updateParticipantDocumentHash("owner_external_effect", plan)) fail(`${label}: differs from the owner plan's ref`);
  return plan;
}

/**
 * The effect journal: `nextTransition` counts completed process transitions (forward 1, then a
 * compensation 2). Evidence is present exactly at an observed or terminal-after-observation phase.
 */
export function validateOwnerExternalEffectJournal(value: unknown, plan: OwnerExternalEffectPlanV1): OwnerExternalEffectJournalV1 {
  const label = "OwnerExternalEffectJournalV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "direction", "nextTransition", "evidenceHash", "createdAt", "updatedAt"], label);
  const { createdAt, updatedAt } = journalHeader(input, plan, updateParticipantDocumentHash("owner_external_effect", plan), label);
  if (!EFFECT_JOURNAL_PHASES.includes(input.phase as OwnerExternalEffectJournalV1["phase"])) fail(`${label}.phase`);
  const phase = input.phase as OwnerExternalEffectJournalV1["phase"];
  const direction = input.direction;
  if (direction !== "forward" && direction !== "compensating") fail(`${label}.direction`);
  const next = integer(input.nextTransition, 0, 2, `${label}.nextTransition`);
  const evidence = input.evidenceHash === null ? null : parseLowerHexSha256(input.evidenceHash);
  const forward = direction === "forward";
  const legal =
    ((phase === "planned" || phase === "forward_intent") && forward && next === 0 && evidence === null) ||
    ((phase === "forward_observed" || phase === "finalized") && forward && next === 1 && evidence !== null) ||
    (phase === "compensation_intent" && !forward && (next === 0 || next === 1)) ||
    (phase === "compensation_observed" && !forward && next === 2 && evidence !== null) ||
    (phase === "rolled_back" && !forward && ((next === 0 && evidence === null) || (next === 2 && evidence !== null)));
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return { schemaVersion: 1, id: plan.id, coordinatorId: plan.coordinatorId, planHash: input.planHash as LowerHexSha256, phase, direction, nextTransition: next, evidenceHash: evidence, createdAt, updatedAt };
}

/** Spec 2 §9.2: `developer-os/owner-external-effect-evidence/v1\0` over the redacted evidence. */
export function ownerExternalEffectEvidenceHash(evidence: OwnerExternalEffectEvidenceV1): LowerHexSha256 {
  return hashCanonicalJsonNoLf("developer-os/owner-external-effect-evidence/v1", evidence);
}

export function validateOwnerExternalEffectEvidence(value: unknown, plan: OwnerExternalEffectPlanV1, direction: "forward" | "compensating", observedStateHash: LowerHexSha256): OwnerExternalEffectEvidenceV1 {
  const label = "OwnerExternalEffectEvidenceV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "planHash", "direction", "observedStateHash", "processPolicyHash", "exitCode", "redactedStdoutHash", "redactedStderrHash", "completedAt"], label);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId || input.planHash !== updateParticipantDocumentHash("owner_external_effect", plan)) fail(`${label}: not this plan's evidence`);
  if (input.direction !== direction || input.observedStateHash !== observedStateHash || input.processPolicyHash !== plan.processPolicyHash || input.exitCode !== 0) fail(`${label}: not the expected observation`);
  parseLowerHexSha256(input.redactedStdoutHash);
  parseLowerHexSha256(input.redactedStderrHash);
  parseUtcTimestamp(input.completedAt);
  return value as OwnerExternalEffectEvidenceV1;
}

// ---------------------------------------------------------------------------------------------
// Canonical state files (spec §9.2 `CanonicalStateFilePlanV1`).
// ---------------------------------------------------------------------------------------------

export interface StatePayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: number;
  readonly path: CanonicalStatePayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 384;
}

/**
 * Amended 2026-09-23 (D60): a preimage is a guarded present file with its observed device/inode
 * and no payload; a postimage carries no device/inode, because leaf plans are written before their
 * payloads, and takes its identity only from the reopened construction evidence of `payload`.
 */
export type CanonicalStatePreimageV1 =
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

export type CanonicalStatePostimageV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly payload: StatePayloadRefV1;
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly size: number;
    };

/** Either side of a state plan. */
export type CanonicalStateFileStateV1 = CanonicalStatePreimageV1 | CanonicalStatePostimageV1;

export type CanonicalStateRoleV1 = "release_metadata" | "release_trust" | "active_release" | "rollback_record";

export interface CanonicalStateFilePlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly role: CanonicalStateRoleV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: CanonicalStatePreimageV1;
  readonly after: CanonicalStatePostimageV1;
  readonly reversal: "reversible" | "monotonic_no_reverse";
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export type ReleaseTrustStatePlanV1 = CanonicalStateFilePlanV1 & { readonly role: "release_trust"; readonly reversal: "monotonic_no_reverse" };
export type ActiveReleaseStatePlanV1 = CanonicalStateFilePlanV1 & { readonly role: "active_release"; readonly reversal: "reversible" };
export type RollbackRecordStatePlanV1 = CanonicalStateFilePlanV1 & { readonly role: "rollback_record"; readonly reversal: "reversible" };

export type UpdateStateLeafKindV1 = "manifest_state" | "release_trust_state" | "active_release_state" | "rollback_record_state";

export interface UpdateStateParticipantJournalV1<TKind extends UpdateStateLeafKindV1 = UpdateStateLeafKindV1> {
  readonly schemaVersion: 1;
  readonly kind: TKind;
  readonly id: UpdateLeafPlanIdV1<TKind>;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "preimage_preserved" | "published" | "verified" | "compensating" | "finalized" | "rolled_back";
  readonly nextTransition: number;
  readonly compensationNext: number | null;
  /**
   * D84 K5 (NEW-118 (2)): the exact empty ephemeral reservation the rollback record's publication
   * released, recorded before its unlink. Compensation recreates the empty `0600` reservation. Null
   * for every other role and for a record that released nothing.
   */
  readonly reservationReleased: { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 } | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

/**
 * The fixed four-transition table every state journal walks: preserve the preimage at the
 * tombstone, publish the payload no-replace, verify the reopened postimage, and — only at terminal
 * finalization — remove the tombstone. A transition whose side is absent is a recorded no-op.
 */
export const CANONICAL_STATE_TRANSITIONS = ["preserve_before", "publish_after", "verify", "finalize_tombstone"] as const;

const STATE_JOURNAL_PHASES: readonly UpdateStateParticipantJournalV1["phase"][] = ["planned", "preimage_preserved", "published", "verified", "compensating", "finalized", "rolled_back"];
const STATE_PHASE_AFTER: readonly UpdateStateParticipantJournalV1["phase"][] = ["planned", "preimage_preserved", "published", "verified", "finalized"];
const MAX_STATE_BYTES = 67_108_864;

export function stateLeafKindForRole(role: Exclude<CanonicalStateRoleV1, "release_metadata">): Exclude<UpdateStateLeafKindV1, "manifest_state"> {
  if (role === "release_trust") return "release_trust_state";
  if (role === "active_release") return "active_release_state";
  return "rollback_record_state";
}

/** The phase a journal holds once `nextTransition` transitions completed forward. */
export function canonicalStatePhaseAfter(nextTransition: number): UpdateStateParticipantJournalV1["phase"] {
  return STATE_PHASE_AFTER[integer(nextTransition, 0, 4, "nextTransition")] as UpdateStateParticipantJournalV1["phase"];
}

function stateFileState(value: unknown, plan: Pick<CanonicalStateFilePlanV1, "coordinatorId" | "role" | "id">, productHome: CanonicalAbsolutePathV1, side: "before" | "after", label: string): CanonicalStateFileStateV1 {
  if (record(value, label).state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  const input = exact(value, side === "before" ? ["state", "hash", "payload", "ownerUid", "mode", "nlink", "size", "dev", "ino"] : ["state", "hash", "payload", "ownerUid", "mode", "nlink", "size"], label);
  if (input.state !== "present" || input.mode !== 384 || input.nlink !== 1) fail(label);
  const hash = parseLowerHexSha256(input.hash);
  const size = integer(input.size, 1, MAX_STATE_BYTES, `${label}.size`);
  integer(input.ownerUid, 0, 4_294_967_295, `${label}.ownerUid`);
  if (side === "before") {
    parseUInt64Decimal(input.dev);
    parseUInt64Decimal(input.ino);
    if (input.payload !== null) fail(`${label}.payload: a preimage carries no payload`);
  } else {
    const payload = exact(input.payload, ["kind", "coordinatorId", "ordinal", "path", "hash", "bytes", "mode"], `${label}.payload`);
    if (payload.kind !== "update_expected" || payload.coordinatorId !== plan.coordinatorId || payload.mode !== 384) fail(`${label}.payload`);
    integer(payload.ordinal, 0, 1_099_999, `${label}.payload.ordinal`);
    if (payload.path !== deriveCanonicalStatePayloadPath(productHome, plan.coordinatorId as string as SafeReasonCodeV1, plan.role, plan.id)) fail(`${label}.payload.path`);
    if (payload.hash !== hash || payload.bytes !== size) fail(`${label}.payload: differs from the postimage`);
  }
  return value as CanonicalStateFileStateV1;
}

/**
 * Spec 2 §9.2: a present postimage requires its exact pre-intent payload under the role/ID state
 * payload path; a preimage never carries one; trust alone is monotonic and never absent after.
 * Only the preimage carries a device/inode (D60), so plan bytes are fixed before any payload exists.
 */
export function validateCanonicalStateFilePlan(value: unknown, productHome: CanonicalAbsolutePathV1): CanonicalStateFilePlanV1 {
  const label = "CanonicalStateFilePlanV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "role", "path", "tombstonePath", "before", "after", "reversal", "maximumPlanBytes", "maximumJournalBytes"], label);
  const plan = value as CanonicalStateFilePlanV1;
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(plan.id);
  if (!["release_metadata", "release_trust", "active_release", "rollback_record"].includes(plan.role)) fail(`${label}.role`);
  if ((plan.reversal === "monotonic_no_reverse") !== (plan.role === "release_trust") || !["reversible", "monotonic_no_reverse"].includes(plan.reversal)) fail(`${label}.reversal`);
  const path = parseCanonicalAbsolutePathText(plan.path);
  const tombstone = parseCanonicalAbsolutePathText(plan.tombstonePath);
  if (path === tombstone || parentOf(path) !== parentOf(tombstone)) fail(`${label}.tombstonePath: not a sibling`);
  const before = stateFileState(plan.before, plan, productHome, "before", `${label}.before`);
  const after = stateFileState(plan.after, plan, productHome, "after", `${label}.after`);
  if (before.state === "absent" && after.state === "absent") fail(`${label}: absent to absent`);
  if (plan.role === "release_trust" && after.state !== "present") fail(`${label}: trust never becomes absent`);
  const maximum = integer(plan.maximumPlanBytes, 1, MAXIMUM_UPDATE_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  integer(plan.maximumJournalBytes, 1, MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES, `${label}.maximumJournalBytes`);
  if (updateParticipantDocumentBytes(plan).byteLength > maximum) fail(`${label}: exceeds its plan bytes`);
  return plan;
}

/**
 * The manual-rollback retained-record arm: guarded present before, absent after. It never
 * publishes; `verify_retained` reaches `verified` at transition zero and reverse traversal marks it
 * `rolled_back` with the record still present.
 */
export function isRetainedRecordVerification(plan: CanonicalStateFilePlanV1): boolean {
  return plan.role === "rollback_record" && plan.before.state === "present" && plan.after.state === "absent";
}

/**
 * Spec 2 §9.2's state journal: its `kind`/`id` pair equals the state leaf under
 * `UpdateLeafPlanIdV1`; phase and cursor accept only the linear prefix of the transition table;
 * compensation walks the reached reverse prefix down to -1.
 */
export function validateStateParticipantJournal<TKind extends UpdateStateLeafKindV1>(value: unknown, kind: TKind, plan: { readonly id: string; readonly coordinatorId: LifecycleCoordinatorIdV1; readonly retainedVerification?: boolean }, planHash: LowerHexSha256): UpdateStateParticipantJournalV1<TKind> {
  const label = "UpdateStateParticipantJournalV1";
  const input = exact(value, ["schemaVersion", "kind", "id", "coordinatorId", "planHash", "phase", "nextTransition", "compensationNext", "reservationReleased", "createdAt", "updatedAt"], label);
  if (input.kind !== kind) fail(`${label}.kind`);
  let reservationReleased: UpdateStateParticipantJournalV1["reservationReleased"] = null;
  if (input.reservationReleased !== null) {
    if (kind !== "rollback_record_state" || plan.retainedVerification === true) fail(`${label}.reservationReleased: only a publishing rollback record releases the reservation`);
    const released = exact(input.reservationReleased, ["dev", "ino"], `${label}.reservationReleased`);
    reservationReleased = { dev: parseUInt64Decimal(released.dev), ino: parseUInt64Decimal(released.ino) };
  }
  const id = parseLeafPlanId(kind, input.id);
  const { createdAt, updatedAt } = journalHeader(input, plan, planHash, label);
  if (!STATE_JOURNAL_PHASES.includes(input.phase as UpdateStateParticipantJournalV1["phase"])) fail(`${label}.phase`);
  const phase = input.phase as UpdateStateParticipantJournalV1["phase"];
  const next = integer(input.nextTransition, 0, 4, `${label}.nextTransition`);
  const compensation = nullableInteger(input.compensationNext, -1, 3, `${label}.compensationNext`);
  const retained = plan.retainedVerification === true;
  const legal = retained
    ? (phase === "planned" && next === 0 && compensation === null) ||
      (phase === "verified" && next === 0 && compensation === null) ||
      (phase === "rolled_back" && next === 0 && compensation === -1) ||
      (phase === "finalized" && next === 4 && compensation === null)
    : (STATE_PHASE_AFTER[next] === phase && compensation === null) ||
      (phase === "compensating" && next >= 1 && next <= 3 && compensation !== null && compensation < next) ||
      (phase === "rolled_back" && next <= 3 && compensation === -1);
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return { schemaVersion: 1, kind, id: id as UpdateLeafPlanIdV1<TKind>, coordinatorId: plan.coordinatorId, planHash: input.planHash as LowerHexSha256, phase, nextTransition: next, compensationNext: compensation, reservationReleased, createdAt, updatedAt };
}

// ---------------------------------------------------------------------------------------------
// Target verification (spec §9.2 `TargetVerificationPlanV1`).
// ---------------------------------------------------------------------------------------------

export interface TargetVerificationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly release: ReleaseIdentityV1;
  readonly verifierEntrypoint: BundleRelativePathV1;
  readonly manifestHash: LowerHexSha256;
  readonly ownerPostimagesHash: LowerHexSha256;
  readonly migrationPostimagesHash: LowerHexSha256;
  readonly inputBytes: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly idleMilliseconds: number;
  readonly wallMilliseconds: number;
  readonly processCount: 1;
  readonly readOnly: true;
}

export interface TargetVerificationContextV1 {
  readonly release: ReleaseIdentityV1;
  readonly manifestHash: LowerHexSha256;
  readonly owners: readonly OwnerPostimageRowInputV1[];
  readonly migrations: readonly { readonly ref: ImmutableUpdatePlanRefV1<"schema_migration">; readonly plan: SchemaMigrationPlanV1 }[];
}

/** Admits only the signed bundle verifier, the recomputed postimage digests, and the fixed caps. */
export function validateTargetVerificationPlan(value: unknown, context: TargetVerificationContextV1): TargetVerificationPlanV1 {
  const label = "TargetVerificationPlanV1";
  const input = exact(value, ["schemaVersion", "id", "coordinatorId", "release", "verifierEntrypoint", "manifestHash", "ownerPostimagesHash", "migrationPostimagesHash", "inputBytes", "stdoutBytes", "stderrBytes", "idleMilliseconds", "wallMilliseconds", "processCount", "readOnly"], label);
  const plan = value as TargetVerificationPlanV1;
  if (input.schemaVersion !== 1 || input.processCount !== 1 || input.readOnly !== true) fail(`${label}: not the read-only verifier`);
  parseSafeReasonCode(plan.id);
  if (!same(plan.release, context.release)) fail(`${label}.release`);
  parseBundleRelativePath(plan.verifierEntrypoint);
  if (plan.manifestHash !== context.manifestHash) fail(`${label}.manifestHash`);
  if (plan.ownerPostimagesHash !== ownerPostimagesHash(context.owners)) fail(`${label}.ownerPostimagesHash`);
  if (plan.migrationPostimagesHash !== migrationPostimagesHash(context.migrations)) fail(`${label}.migrationPostimagesHash`);
  integer(plan.inputBytes, 1, 268_435_456, `${label}.inputBytes`);
  integer(plan.stdoutBytes, 1, 1_048_576, `${label}.stdoutBytes`);
  integer(plan.stderrBytes, 0, 1_048_576, `${label}.stderrBytes`);
  integer(plan.idleMilliseconds, 1, 30_000, `${label}.idleMilliseconds`);
  integer(plan.wallMilliseconds, 1, 300_000, `${label}.wallMilliseconds`);
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Participant paths (spec §9.2).
// ---------------------------------------------------------------------------------------------

/** `staging/lifecycle/<coordinator-id>/update/journals/<kind>/<id>.json`. */
export function updateParticipantJournalPath(stagingRoot: CanonicalAbsolutePathV1, kind: Parameters<typeof parseLeafPlanId>[0], id: unknown): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/journals/${kind}/${parseLeafPlanId(kind, id)}.json`);
}

/** `update/evidence/owner_external_effect/<id>/<direction>.json`, the sole observation file. */
export function ownerExternalEffectEvidencePath(stagingRoot: CanonicalAbsolutePathV1, id: OwnerExternalEffectIdV1, direction: "forward" | "compensating"): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stagingRoot}/update/evidence/owner_external_effect/${parseLeafPlanId("owner_external_effect", id)}/${direction}.json`);
}
