import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

import {
  foundationBindingsHash,
  advanceReleaseTrust,
  allocatedCounterOf,
  buildConstructionPlan,
  buildRollbackPayload,
  buildRollbackPayloadSourceStagingPlan,
  buildUpdateCoordinatorPlan,
  buildUpdateFoundationParticipantRef,
  bundleAggregateBytes,
  bundleInventoryHash,
  bundleMetadataPath,
  bundlePublicationJournalBytes,
  bundlePublicationPlanRef,
  bundleSourceJournalBytes,
  bundleSourcePaths,
  bundleSourceStagingPlanRef,
  constructionPlanBytes,
  constructionPlanRef,
  decodeCanonicalJson,
  deriveCanonicalStatePayloadPath,
  deriveManifestPayloadPath,
  deriveUpdateExecutorRecordPath,
  deriveUpdatePayloadPath,
  deriveUpdateSteps,
  encodeCanonicalJson,
  EXIT_CODES,
  formatAllocatedLifecycleId,
  initialBundlePublicationJournal,
  initialBundleSourceJournal,
  initialRollbackPayloadPublicationJournal,
  initialRollbackPayloadSourceJournal,
  materializeRollbackSchemaMigration,
  materializeSchemaMigrations,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
  migrationPostimagesHash,
  OWNER_UPDATE_ORDER,
  ownerCurrentPartitionHash,
  ownerPostimagesHash,
  parseCanonicalAbsolutePathText,
  parseManifestParticipantId,
  parseSafeReasonCode,
  parseUInt64Decimal,
  retainedMigrationTarget,
  retainedOwnerInverseOperationHash,
  rollbackEntrySourceProjectionHash,
  rollbackPayloadMetadataPath,
  rollbackPayloadPublicationJournalBytes,
  rollbackPayloadRoot,
  rollbackPayloadSourceJournalBytes,
  rollbackPayloadSourcePaths,
  rollbackPayloadSourceStagingPlanRef,
  rollbackPayloadStatePlanRef,
  rollbackPayloadStructures,
  rollbackSourceEntriesProjectionHash,
  rollbackStepListHash,
  schemaMigrationInitialState,
  updateCoordinatorEnvelopePaths,
  updateCoordinatorOuterBytes,
  updateCoordinatorPlanBytes,
  updateCoordinatorStagingRoot,
  updateExecutionBindingHash,
  updateFoundationStagedDigestBytes,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  updateRecoveryExecutorStagedPath,
  updateTerminalRetirementPlanRef,
  validateActiveReleaseRecord,
  validateBundlePublicationPlan,
  validateBundleSourceStagingPlan,
  validateCanonicalStateFilePlan,
  validateManifestStatePlan,
  validateOwnerExternalEffectPlan,
  validateOwnerUpdatePlan,
  validateRollbackPayloadStatePlan,
  validateTargetVerificationPlan,
  validateUpdateExecutionPlan,
  validateUpdateTerminalRetirementPlan,
  ownerExternalEffectProcessPolicyHash,
  type AllocatedLifecycleIdV1,
  type BundleMetadataStatePlanV1,
  type BundlePublicationPlanV1,
  type BundleSourceStagingPlanV1,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonV1,
  type CanonicalJsonValue,
  type CanonicalPathEvidenceV1,
  type CanonicalProductStatePathV1,
  type CanonicalStateFilePlanV1,
  type CanonicalStatePayloadPathV1,
  type EffectiveUidV1,
  type ExitCode,
  type ImmutableUpdatePlanRefV1,
  type InstallationManifestV2,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedEntryV1,
  type LifecycleIdPrefixV1,
  type LifecycleInstallNonceV1,
  type ManagedArtifactCommonV2,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type ManifestExternalEffectRefV1,
  type ManifestParticipantIdV1,
  type ManifestStatePlanAdmissionContextV1,
  type ManifestStatePlanV1,
  type OwnerExternalEffectPlanV1,
  type OwnerUpdateDraftV1,
  type OwnerUpdatePlanV1,
  type PersistedManagedPathStateV1,
  type PersistedOwnerChangeOperationV1,
  type PlannerChangePlanOperationV1,
  type PlannerContentRefV1,
  type PlannerPathTokenV1,
  type PreparedRollbackPayloadV1,
  type ReleaseBundleEntryV1,
  type ReleaseBundleManifestV1,
  type ReleaseIdentityV1,
  type ReleaseMetadataIdentityV1,
  type RetainedExternalEffectInversePlanV1,
  type RetainedInversePathStateV1,
  type RetainedOwnerInverseOperationV1,
  type RetainedOwnerInverseProjectionV1,
  type RetainedSchemaMigrationInverseProjectionV1,
  type RetirementInventoryRefV1,
  type RollbackPayloadIdentityV1,
  type RollbackPayloadIdV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadStatePlanV1,
  type SafeReasonCodeV1,
  type SchemaMigrationIdV1,
  type SchemaMigrationPlanV1,
  type TargetVerificationPlanV1,
  type UpdateCapacityInputV1,
  type UpdateConstructionFileInputV1,
  type UpdateConstructionPayloadKindV1,
  type UpdateConstructionPayloadSourceV1,
  type UpdateConstructionRetainedRollbackBlobSourceV1,
  type UpdateConstructionRollbackEntrySourceV1,
  type UpdateConstructionRollbackSourceEntryV1,
  type UpdateExecutionPlanV1,
  type UpdateFallbackHandoffV1,
  type UpdateFoundationMutationInputV1,
  type UpdateFoundationParticipantRefV2,
  type UpdateInitialJournalRefV1,
  type UpdateLeafPlanKindV1,
  type UpdatePayloadRefV1,
  type UpdateRecoveryExecutorRecordV1,
  type UpdateRollbackPreviewV1,
  type UpdateStepOwnerV1,
  type UpdateTargetJournalKindV1,
  type UpdateTerminalRetirementPlanV1,
  type UtcTimestampV1,
  MAXIMUM_RECOVERY_EXECUTOR_BYTES,
} from "@developer-os/core";
import { compareUtf8 } from "@developer-os/core/planner-protocol";

import { compareManifestRows } from "../instructions/attach.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";
import type { UpdateApplyComposeInputV1, UpdateApplyCompositionV1, UpdateRollbackComposeInputV1 } from "./apply.js";
import { codexRegistrationRow } from "./codex-refresh.js";
import { deriveTerminalManifest } from "./manifest-handler.js";
import { rollbackCapacityComponents, UpdatePlanningRefusal } from "./planning.js";
import type { MaterializedUpdateV1 } from "./planning.js";

/** A no-follow observation of one path; `sha256` is present exactly for a regular file. */
export interface ObservedPathV1 {
  readonly entry: LifecycleGuardedEntryV1;
  readonly sha256: LowerHexSha256 | null;
}

/** The allocation-dependent derivation's ports: every byte it hashes comes from these or from the candidate. */
export interface ComposeDepsV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
  readonly evidence: CanonicalPathEvidenceV1;
  readonly fallback: UpdateFallbackHandoffV1;
  readonly brainRoot: CanonicalAbsolutePathV1;
  /** Guarded no-follow observation under the held lock; null when absent. */
  readonly observe: (path: CanonicalAbsolutePathV1) => Promise<ObservedPathV1 | null>;
  readonly admitManifest: (value: unknown) => InstallationManifestV2;
  /** The Codex vendor homes; null when the home has no Codex owner. */
  readonly codexHomes: VendorHomesV1 | null;
}

/** The retained rollback set, reopened under the held lock and checked against the record. */
export interface RetainedRollbackSetV1 {
  readonly owners: readonly RetainedOwnerInverseProjectionV1[];
  readonly migrations: readonly RetainedSchemaMigrationInverseProjectionV1[];
  readonly entryCount: number;
  readonly aggregateBytes: number;
  /** The retained inverse plan's hash of the §10.2 step list `update --apply` derived; rollback's own steps must equal it. */
  readonly exactStepListHash: LowerHexSha256;
}

/** `update rollback --apply`'s reads beyond `ComposeDepsV1`; nothing here comes from a network or planner. */
export interface RollbackComposeDepsV1 extends ComposeDepsV1 {
  readonly plannedAt: UtcTimestampV1;
  readonly retained: RetainedRollbackSetV1;
  /** The previous release's retained signed bundle manifest (`state/release-metadata/bundles/<hash>.json`). */
  readonly previousBundle: ReleaseBundleManifestV1;
}

/** What the construction source port needs besides the plan: in memory only; rollback stages no source. */
export interface UpdateComposedSourcesV1 {
  readonly bundleSource: BundleSourceStagingPlanV1 | null;
  readonly rollbackSource: RollbackPayloadSourceStagingPlanV1 | null;
  readonly documents: { readonly inversePlan: Uint8Array; readonly inventory: Uint8Array } | null;
  /** The exact bytes of every immutable plan, initial journal, and recovery-record row, by construction ordinal. */
  readonly rowBytes: ReadonlyMap<number, Uint8Array>;
}

export interface UpdateComposedV1 extends UpdateApplyCompositionV1 {
  readonly sources: UpdateComposedSourcesV1;
}

const encoder = new TextEncoder();
const MAX_FOUNDATION_MUTATIONS = 256;
const MANIFEST_BYTES_MAXIMUM = 16_777_216;
const RETIREMENT_KINDS: readonly RetirementInventoryRefV1["kind"][] = ["bundle", "metadata", "rollback_payload", "rollback_record"];

function refuse(reason: string, code: Exclude<ExitCode, 0>, ...paths: readonly string[]): never {
  throw new UpdatePlanningRefusal(reason, code, paths);
}

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function canonical(value: unknown): CanonicalJsonV1 {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

function path(value: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(value);
}

function under(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Classifies a validator throw as the recovery-required composition refusal; a JS defect propagates. */
function composed<T>(reason: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof UpdatePlanningRefusal) throw error;
    throw Object.assign(new UpdatePlanningRefusal(reason, EXIT_CODES.recoveryRequired), { cause: error });
  }
}

// ---------------------------------------------------------------------------------------------
// Allocation (D72 P7(e)): one block for every prefix, derived from the materialized update.
// ---------------------------------------------------------------------------------------------

function changedCount(plan: OwnerUpdateDraftV1): number {
  const changed = plan.proposedOperations.filter((operation) => operation.operation !== "keep").length;
  // P6(d): a Codex tree change also replaces the registration record.
  return plan.owner === "codex" && changed > 0 ? changed + 1 : changed;
}

function refCount(changed: number): number {
  return 2 * Math.ceil(changed / MAX_FOUNDATION_MUTATIONS);
}

function hasCodexEffect(materialized: MaterializedUpdateV1): boolean {
  return materialized.run.draft.ownerPlans.some((plan) => plan.owner === "codex" && plan.externalEffects.length > 0);
}

/**
 * The exact prefix list `allocate` reserves in one block: the coordinator first, then the payload,
 * the transitional and terminal manifest participants, the Codex effect, and every Foundation ref.
 */
export function updateApplyPrefixes(materialized: MaterializedUpdateV1): readonly LifecycleIdPrefixV1[] {
  const { draft } = materialized.run;
  const tx = draft.ownerPlans.reduce((sum, plan) => sum + refCount(changedCount(plan)), 0)
    + draft.migrations.reduce((sum, migration) => sum + refCount(migration.mutations.length), 0);
  return ["lc", "rb", "mf", "mf", ...(hasCodexEffect(materialized) ? ["oe" as const] : []), ...Array.from({ length: tx }, () => "tx" as const)];
}

/**
 * `update rollback --apply`'s exact block from its preview, in the order `composeRollback` takes
 * it: the coordinator, both manifest participants, the Codex refresh when the retained owner has
 * one, and a paired ref for every 256 restored owner paths or migration mutations. No `rb`: a
 * rollback publishes no payload.
 */
export function updateRollbackPrefixes(preview: UpdateRollbackPreviewV1): readonly LifecycleIdPrefixV1[] {
  const tx = preview.owners.reduce((sum, owner) => sum + refCount(owner.paths.create.length + owner.paths.replace.length + owner.paths.remove.length), 0)
    + preview.migrations.reduce((sum, migration) => sum + refCount(migration.affectedPaths.length), 0);
  const effect = preview.owners.some((owner) => owner.counts.externalEffects > 0);
  return ["lc", "mf", "mf", ...(effect ? ["oe" as const] : []), ...Array.from({ length: tx }, () => "tx" as const)];
}

/** The block's IDs in prefix order: the coordinator's counter and nonce name every later one. */
function allocatedIds(coordinatorId: LifecycleCoordinatorIdV1, prefixes: readonly LifecycleIdPrefixV1[]): readonly string[] {
  const nonce = coordinatorId.split("_")[1] as string;
  const first = allocatedCounterOf(coordinatorId);
  return prefixes.map((prefix, index) => formatAllocatedLifecycleId(prefix, nonce as LifecycleInstallNonceV1, first + BigInt(index)));
}

class IdPool {
  readonly #ids: readonly string[];
  readonly #prefixes: readonly LifecycleIdPrefixV1[];
  #next = 0;

  constructor(coordinatorId: LifecycleCoordinatorIdV1, prefixes: readonly LifecycleIdPrefixV1[]) {
    this.#prefixes = prefixes;
    this.#ids = allocatedIds(coordinatorId, prefixes);
    if (this.#ids[0] !== coordinatorId) refuse("update_composition_allocation", EXIT_CODES.recoveryRequired);
    this.#next = 1;
  }

  take<P extends LifecycleIdPrefixV1>(prefix: P): AllocatedLifecycleIdV1<P> {
    if (this.#prefixes[this.#next] !== prefix) return refuse("update_composition_allocation", EXIT_CODES.recoveryRequired);
    return this.#ids[this.#next++] as AllocatedLifecycleIdV1<P>;
  }

  done(): void {
    if (this.#next !== this.#ids.length) refuse("update_composition_allocation", EXIT_CODES.recoveryRequired);
  }
}

// ---------------------------------------------------------------------------------------------
// Construction rows: ordinals are fixed before any plan embeds one (§9.2's concatenation order).
// ---------------------------------------------------------------------------------------------

type ContentSpecV1 =
  | { readonly kind: "planner_output"; readonly ordinal: number; readonly bytes: number; readonly sha256: LowerHexSha256; readonly mode: 384 | 448 }
  | { readonly kind: "bundle"; readonly entry: Extract<ReleaseBundleEntryV1, { readonly kind: "file" }> }
  | { readonly kind: "registration"; readonly value: CanonicalJsonV1 }
  | { readonly kind: "retained"; readonly source: UpdateConstructionRetainedRollbackBlobSourceV1 };

interface PayloadRowV1 {
  readonly ordinal: number;
  readonly payloadKind: UpdateConstructionPayloadKindV1;
  readonly path: CanonicalAbsolutePathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
  /** A plan-derived row's exact canonical value, when its source waits for a plan ref. */
  readonly value?: CanonicalJsonV1;
  /** Resolved once every plan it names is built. */
  source: UpdateConstructionPayloadSourceV1 | null;
}

class RowLedger {
  readonly payloads: PayloadRowV1[] = [];
  #next: number;

  constructor(first: number) {
    this.#next = first;
  }

  ordinal(): number {
    return this.#next++;
  }

  add(row: Omit<PayloadRowV1, "ordinal" | "source"> & { readonly source?: UpdateConstructionPayloadSourceV1 }, ordinal = this.ordinal()): PayloadRowV1 {
    const added: PayloadRowV1 = { ...row, ordinal, source: row.source ?? null };
    this.payloads.push(added);
    return added;
  }

  get next(): number {
    return this.#next;
  }
}

// ---------------------------------------------------------------------------------------------
// The composer.
// ---------------------------------------------------------------------------------------------

interface OwnerOpV1 {
  readonly operation: "keep" | "create" | "replace" | "remove";
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly current: ManagedArtifactV2 | null;
  readonly after: ManagedArtifactV2 | null;
  readonly before: PersistedManagedPathStateV1;
  readonly observed: ObservedPathV1 | null;
  readonly content: ContentSpecV1 | null;
}

interface OwnerBuildV1 {
  readonly draft: OwnerUpdateDraftV1;
  readonly id: SafeReasonCodeV1;
  readonly ops: readonly OwnerOpV1[];
  contentRows: Map<string, PayloadRowV1>;
  preimageRows: Map<string, PayloadRowV1>;
  foundation: readonly UpdateFoundationParticipantRefV2[];
  plan: OwnerUpdatePlanV1 | null;
  ref: ImmutableUpdatePlanRefV1<"owner_update"> | null;
  effect: { readonly plan: OwnerExternalEffectPlanV1; readonly ref: ImmutableUpdatePlanRefV1<"owner_external_effect"> } | null;
}

function leafRef<TKind extends UpdateLeafPlanKindV1>(root: CanonicalAbsolutePathV1, kind: TKind, id: string, plan: unknown): ImmutableUpdatePlanRefV1<TKind> {
  return { kind, id, path: updateLeafPlanPath(root, kind, id), hash: updateParticipantDocumentHash(kind, plan), bytes: updateParticipantDocumentBytes(plan).byteLength } as ImmutableUpdatePlanRefV1<TKind>;
}

function installedHash(row: ManagedArtifactV2 | null): LowerHexSha256 | null {
  const verification = row?.verification as { readonly installedHash?: LowerHexSha256 } | undefined;
  return verification?.installedHash ?? null;
}

function isEphemeral(row: ManagedArtifactV2 | null): boolean {
  return row?.kind === "file" && row.verification.mode === "ephemeral";
}

function modeOf(observed: ObservedPathV1): 384 | 448 {
  return observed.entry.mode === 0o700 ? 448 : 384;
}

/** Spec 2 §9.2's persisted before-state, from the guarded observation and the planner snapshot. */
function beforeState(row: ManagedArtifactV2, observed: ObservedPathV1 | null): PersistedManagedPathStateV1 {
  const changed = (): never => refuse("update_state_changed", EXIT_CODES.operationalFailure, row.path);
  if (isEphemeral(row)) {
    if (observed === null) return { state: "absent" };
    if (observed.entry.kind !== "regular_file") return changed();
    return { state: "ephemeral_present", mode: 384, dev: observed.entry.dev, ino: observed.entry.ino };
  }
  if (observed === null) return changed();
  const { entry } = observed;
  if (row.kind === "directory") return entry.kind === "directory" ? { state: "directory", mode: 448, dev: entry.dev, ino: entry.ino } : changed();
  if (row.kind === "symlink") {
    if (entry.kind !== "other" || observed.sha256 === null) return changed();
    return { state: "symlink", targetBytes: Number(entry.size), targetHash: observed.sha256, dev: entry.dev, ino: entry.ino };
  }
  if (entry.kind !== "regular_file" || observed.sha256 === null) return changed();
  // A schema row is verified by its schema, never its hash: every gated transaction rewrites the allocator.
  const expected = row.verification.mode === "schema" ? null : installedHash(row);
  if (expected !== null && expected !== observed.sha256) return changed();
  return { state: "file", mode: modeOf(observed), hash: observed.sha256, bytes: Number(entry.size), dev: entry.dev, ino: entry.ino };
}

type ComposerSourceV1 =
  | { readonly operation: "update_apply"; readonly input: UpdateApplyComposeInputV1 }
  | { readonly operation: "update_rollback"; readonly input: UpdateRollbackComposeInputV1; readonly deps: RollbackComposeDepsV1 };

type InitialJournalV1 = { readonly ref: UpdateInitialJournalRefV1; readonly file: UpdateConstructionFileInputV1; readonly bytes: Uint8Array };
type RecoveryRowsV1 = { readonly descriptor: UpdateExecutionPlanV1["recoveryExecutor"]; readonly files: readonly UpdateConstructionFileInputV1[]; readonly bytes: readonly [Uint8Array, Uint8Array] };
type StateJournalSpecV1 = { readonly kind: "release_trust_state" | "active_release_state" | "rollback_record_state"; readonly plan: CanonicalStateFilePlanV1; readonly ref: ImmutableUpdatePlanRefV1 };
type FoundationSlotsV1 = { readonly forward: UpdateFoundationParticipantRefV2["slot"]; readonly compensation: UpdateFoundationParticipantRefV2["slot"] };

/** The operation-independent tail: every leaf and row is built, so the execution leaf, construction, and outer plan follow. */
interface AssemblyV1 {
  readonly operation: "update_apply" | "update_rollback";
  readonly previewHash: LowerHexSha256;
  readonly executionBindingHash: LowerHexSha256;
  readonly current: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly planner: UpdateExecutionPlanV1["planner"];
  readonly refs: Pick<UpdateExecutionPlanV1, "bundle" | "trust" | "active" | "rollback" | "rollbackPayload" | "verification" | "retirement"> & { readonly manifest: readonly [ImmutableUpdatePlanRefV1<"manifest_state">, ImmutableUpdatePlanRefV1<"manifest_state">] };
  readonly owners: readonly OwnerBuildV1[];
  readonly migrationRefs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[];
  readonly journals: readonly InitialJournalV1[];
  readonly recovery: RecoveryRowsV1;
  readonly plans: number;
  /** Every leaf plan but the execution leaf, which the assembly derives and appends. */
  readonly leaves: readonly (readonly [UpdateLeafPlanKindV1, string, unknown])[];
  readonly sourceJournals: readonly { readonly row: UpdateConstructionFileInputV1; readonly bytes: Uint8Array }[];
  readonly rows: RowLedger;
  readonly stagingRoot: Parameters<typeof buildConstructionPlan>[0]["stagingRoot"];
  readonly rollbackSource: Parameters<typeof buildConstructionPlan>[0]["rollbackSource"];
  readonly candidate: Parameters<typeof buildConstructionPlan>[0]["candidate"];
  readonly stepOwners: readonly UpdateStepOwnerV1[];
  readonly retainPayloadId: RollbackPayloadIdV1 | null;
  readonly capacityBase: UpdateCapacityInputV1;
  /** Rollback only: the retained `exactStepListHash` the outer steps must reproduce byte-for-byte (NEW-172). */
  readonly exactStepListHash: LowerHexSha256 | null;
}

const OWNER_APPLY_SLOTS: FoundationSlotsV1 = { forward: "owner_forward_files", compensation: "owner_inverse_files" };
/** P9 (D72): every rollback ref takes the inverse slot. */
const OWNER_ROLLBACK_SLOTS: FoundationSlotsV1 = { forward: "owner_inverse_files", compensation: "owner_inverse_files" };
const SCHEMA_ROLLBACK_SLOTS: FoundationSlotsV1 = { forward: "schema_inverse", compensation: "schema_inverse" };
const RETAINED_BLOB_PATH = /^blobs\/([0-9]{10})\.bin$/u;

class UpdateComposer {
  readonly #source: ComposerSourceV1;
  readonly #deps: ComposeDepsV1;
  readonly #root: CanonicalAbsolutePathV1;
  readonly #coordinatorId: LifecycleCoordinatorIdV1;
  readonly #ids: IdPool;
  readonly #plannedAt: UtcTimestampV1;

  constructor(source: ComposerSourceV1, deps: ComposeDepsV1) {
    this.#source = source;
    this.#deps = deps;
    this.#coordinatorId = source.input.coordinatorId;
    this.#root = updateCoordinatorStagingRoot(deps.productHome, source.input.coordinatorId);
    this.#ids = new IdPool(source.input.coordinatorId, source.operation === "update_apply" ? updateApplyPrefixes(source.input.materialized) : updateRollbackPrefixes(source.input.preview));
    this.#plannedAt = source.operation === "update_apply" ? source.input.inputs.plannedAt : source.deps.plannedAt;
  }

  get #input(): UpdateApplyComposeInputV1 {
    return this.#source.operation === "update_apply" ? this.#source.input : refuse("update_composition_operation", EXIT_CODES.recoveryRequired);
  }

  get #rollback(): Extract<ComposerSourceV1, { readonly operation: "update_rollback" }> {
    return this.#source.operation === "update_rollback" ? this.#source : refuse("update_composition_operation", EXIT_CODES.recoveryRequired);
  }

  #payloadRef(row: PayloadRowV1): UpdatePayloadRefV1 {
    return { kind: "update_expected", coordinatorId: this.#coordinatorId, ordinal: row.ordinal, path: deriveUpdatePayloadPath(this.#deps.productHome, this.#coordinatorId as string as SafeReasonCodeV1, row.ordinal), bytes: row.bytes, sha256: row.sha256, mode: row.mode };
  }

  #payloadPath(ordinal: number): CanonicalAbsolutePathV1 {
    return deriveUpdatePayloadPath(this.#deps.productHome, this.#coordinatorId as string as SafeReasonCodeV1, ordinal);
  }

  #statePayloadPath(role: "release_metadata" | "release_trust" | "active_release" | "rollback_record", id: SafeReasonCodeV1): CanonicalStatePayloadPathV1 {
    return deriveCanonicalStatePayloadPath(this.#deps.productHome, this.#coordinatorId as string as SafeReasonCodeV1, role, id);
  }

  async compose(): Promise<UpdateComposedV1> {
    const { home, inputs, materialized } = this.#input;
    const { draft } = materialized.run;
    const current = inputs.current;
    const target = inputs.target;
    const stagingRoot = await this.#stagingRoot();

    // IDs, in the exact prefix order `updateApplyPrefixes` reserved.
    const payloadId = this.#ids.take("rb") as unknown as RollbackPayloadIdV1;
    const manifestIds = [this.#ids.take("mf"), this.#ids.take("mf")].map((id) => parseManifestParticipantId(id, null)) as [ManifestParticipantIdV1, ManifestParticipantIdV1];
    const effectId = hasCodexEffect(materialized) ? this.#ids.take("oe") : null;

    // Plans come first: their count fixes every later ordinal.
    const owners = await this.#ownerOps(draft.ownerPlans);
    await this.#observePackageSource(owners);
    const plans = 12 + owners.length + (effectId === null ? 0 : 1) + draft.migrations.length;
    const rows = new RowLedger(plans + 2);
    this.#contentRows(owners, rows);
    const migrationRows = this.#migrationPlannerRows(rows);
    this.#sortPlannerRows(rows);
    this.#bundleContentRows(owners, rows);
    this.#preimageRows(owners, rows);
    this.#registrationRows(owners, rows);

    const foundationByOwner = owners.map((owner) => this.#ownerFoundation(owner, rows, OWNER_APPLY_SLOTS));
    const migrations = this.#migrationPlans(migrationRows, rows);

    // The rollback payload binds every owner/migration plan hash, so owners are complete first.
    const inverse = this.#inverseProjections();
    const executionBindingHash = updateExecutionBindingHash({ coordinatorId: this.#coordinatorId, operation: "update_apply", previewHash: materialized.candidate.preview.previewHash, current, target });
    owners.forEach((owner, index) => {
      owner.foundation = foundationByOwner[index] as readonly UpdateFoundationParticipantRefV2[];
      this.#ownerPlan(owner, inverse, effectId);
    });
    const stepOwners = owners.map((owner): UpdateStepOwnerV1 => ({ id: owner.id, owner: owner.draft.owner, externalEffects: owner.effect === null ? [] : [{ id: owner.effect.ref.id }] }));
    const migrationRefs = migrations.map((plan) => leafRef(this.#root, "schema_migration", plan.id, plan));
    const payload = this.#rollbackPayload(owners, migrations, migrationRefs, stepOwners, payloadId, executionBindingHash);

    // Transitional and terminal manifests, then every state plan they bind.
    const activeValue = validateActiveReleaseRecord({ schemaVersion: 1, ...target, activatedAt: this.#plannedAt }, this.#deps.evidence);
    const trustValue = advanceReleaseTrust(home.trust, { ...inputs.metadata, releaseSequence: target.releaseSequence, releaseIdentityHash: target.releaseIdentityHash });
    const metadataPresent = await this.#metadataPresence(target);
    const transitional = this.#transitionalManifest(owners, payload, canonical(activeValue), canonical(trustValue), metadataPresent);
    const retirement = this.#retirementEntries(transitional);
    const terminal = deriveTerminalManifest(transitional, transitional.artifacts.filter((row) => retirement.some((entry) => under(row.path, entry.root))));

    const manifestRows = [this.#manifestAfterRow(manifestIds[0], transitional, rows), this.#manifestAfterRow(manifestIds[1], terminal, rows)] as const;
    const trustRow = this.#stateRow("release_trust", parseSafeReasonCode("trust"), canonical(trustValue), rows);
    const activeRow = this.#stateRow("active_release", parseSafeReasonCode("active"), canonical(activeValue), rows);
    const recordRow = this.#stateRow("rollback_record", parseSafeReasonCode("rollback_record"), canonical(payload.record), rows);
    const metadataRows = this.#metadataRows(metadataPresent, rows);

    // Leaf plans.
    const bundleSource = this.#bundleSourcePlan();
    const bundleSourceRef = bundleSourceStagingPlanRef(bundleSource, this.#root);
    const bundle = this.#bundlePublicationPlan(bundleSourceRef, metadataPresent, metadataRows);
    const rollbackEntries = this.#rollbackSourceEntries(owners, migrations, migrationRefs, payload);
    const entriesProjectionHash = rollbackSourceEntriesProjectionHash({ payloadId, rollbackBindingHash: payload.identity.rollbackBindingHash, inventoryHash: payload.identity.inventoryHash, entries: rollbackEntries });
    const rollbackSource = composed("update_composition_rollback_source", () => buildRollbackPayloadSourceStagingPlan({ id: parseSafeReasonCode("rollback_source"), coordinatorId: this.#coordinatorId, stagingRoot: this.#root, payload, entriesProjectionHash }));
    const rollbackSourceRef = rollbackPayloadSourceStagingPlanRef(rollbackSource, this.#root);
    const rollbackState = this.#rollbackStatePlan(payload.identity, rollbackSourceRef);
    const manifests = this.#manifestPlans(manifestIds, manifestRows, owners, await this.#manifestBefore());
    const trustPlan = await this.#statePlan("release_trust", parseSafeReasonCode("trust"), "release-trust.json", trustRow, "monotonic_no_reverse");
    const activePlan = await this.#statePlan("active_release", parseSafeReasonCode("active"), "active-release.json", activeRow, "reversible");
    const recordPlan = await this.#statePlan("rollback_record", parseSafeReasonCode("rollback_record"), "update-rollback.json", recordRow, "reversible");
    const verification = this.#verificationPlan(owners, migrations, migrationRefs, transitional);
    const retirementPlan = this.#retirementPlan(retirement, transitional);

    // Every plan-derived source, now that the plans they name have refs.
    const refs = {
      bundle: bundlePublicationPlanRef(bundle, this.#root),
      manifest: manifests.map((plan) => leafRef(this.#root, "manifest_state", plan.participantId, plan)) as [ImmutableUpdatePlanRefV1<"manifest_state">, ImmutableUpdatePlanRefV1<"manifest_state">],
      trust: leafRef(this.#root, "release_trust_state", trustPlan.id, trustPlan),
      active: leafRef(this.#root, "active_release_state", activePlan.id, activePlan),
      rollback: leafRef(this.#root, "rollback_record_state", recordPlan.id, recordPlan),
      rollbackPayload: rollbackPayloadStatePlanRef(rollbackState, this.#root),
      verification: leafRef(this.#root, "target_verification", verification.id, verification),
      retirement: updateTerminalRetirementPlanRef(retirementPlan, this.#root),
    };
    manifestRows.forEach((row, index) => {
      row.source = { kind: "plan_derived", role: "manifest_after", plan: refs.manifest[index] as ImmutableUpdatePlanRefV1<"manifest_state">, value: this.#rowValue(row), valueBytes: row.bytes - 1 };
    });
    trustRow.source = { kind: "plan_derived", role: "release_trust_after", plan: refs.trust, value: this.#rowValue(trustRow), valueBytes: trustRow.bytes - 1 };
    activeRow.source = { kind: "plan_derived", role: "active_release_after", plan: refs.active, value: this.#rowValue(activeRow), valueBytes: activeRow.bytes - 1 };
    recordRow.source = { kind: "plan_derived", role: "rollback_record_after", plan: refs.rollback, value: this.#rowValue(recordRow), valueBytes: recordRow.bytes - 1 };
    for (const owner of owners) this.#resolveOwnerSources(owner);

    // Target participant journals, then the two recovery records, close the file list.
    const journals = this.#initialJournals(bundle, refs, owners, migrations, migrationRefs, [
      { kind: "release_trust_state", plan: trustPlan, ref: refs.trust },
      { kind: "active_release_state", plan: activePlan, ref: refs.active },
      { kind: "rollback_record_state", plan: recordPlan, ref: refs.rollback },
    ], rollbackState, rows);
    const recovery = this.#recoveryExecutor("update_apply", current, executionBindingHash, rows);
    this.#ids.done();

    const sourceJournalBytes = [bundleSourceJournalBytes(initialBundleSourceJournal(bundleSource, this.#plannedAt)), rollbackPayloadSourceJournalBytes(initialRollbackPayloadSourceJournal(rollbackSource, this.#plannedAt))] as const;
    const assembled = this.#assemble({
      operation: "update_apply",
      previewHash: materialized.candidate.preview.previewHash,
      executionBindingHash,
      current,
      target,
      metadata: inputs.metadata,
      planner: materialized.candidate.transcriptIdentity,
      refs,
      owners,
      migrationRefs,
      journals,
      recovery,
      plans,
      leaves: [
        ["bundle_source_staging", bundleSource.id, bundleSource],
        ["rollback_payload_source", rollbackSource.id, rollbackSource],
        ["bundle_publication", bundle.id, bundle],
        ...owners.map((owner) => ["owner_update", owner.id, owner.plan] as const),
        ...owners.flatMap((owner) => (owner.effect === null ? [] : [["owner_external_effect", owner.effect.plan.id, owner.effect.plan] as const])),
        ...migrations.map((plan) => ["schema_migration", plan.id, plan] as const),
        ...manifests.map((plan) => ["manifest_state", plan.participantId, plan] as const),
        ["release_trust_state", trustPlan.id, trustPlan],
        ["active_release_state", activePlan.id, activePlan],
        ["rollback_record_state", recordPlan.id, recordPlan],
        ["rollback_payload_state", rollbackState.id, rollbackState],
        ["target_verification", verification.id, verification],
        ["terminal_retirement", retirementPlan.id, retirementPlan],
      ],
      sourceJournals: [
        { row: this.#sourceJournalRow("bundle_source_staging", bundleSource.id, sourceJournalBytes[0]), bytes: sourceJournalBytes[0] },
        { row: this.#sourceJournalRow("rollback_payload_source", rollbackSource.id, sourceJournalBytes[1]), bytes: sourceJournalBytes[1] },
      ],
      rows,
      stagingRoot,
      rollbackSource: { sourcePlanId: rollbackSource.id, payloadId, rollbackBindingHash: payload.identity.rollbackBindingHash, inventoryHash: payload.identity.inventoryHash, sources: rollbackEntries.map((entry) => entry.source) },
      candidate: materialized.candidate,
      stepOwners,
      retainPayloadId: payloadId,
      capacityBase: materialized.capacity,
      exactStepListHash: null,
    });
    return { ...assembled, sources: { bundleSource, rollbackSource, documents: { inversePlan: payload.inversePlanBytes, inventory: payload.inventoryBytes }, rowBytes: assembled.rowBytes } };
  }

  #assemble(a: AssemblyV1): UpdateApplyCompositionV1 & { readonly rowBytes: ReadonlyMap<number, Uint8Array> } {
    const execution = composed("update_composition_execution", () => validateUpdateExecutionPlan({
      schemaVersion: 1,
      coordinatorId: this.#coordinatorId,
      operation: a.operation,
      previewHash: a.previewHash,
      executionBindingHash: a.executionBindingHash,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      current: a.current,
      target: a.target,
      metadata: a.metadata,
      planner: a.planner,
      bundle: a.refs.bundle,
      owners: a.owners.map((owner) => owner.ref as ImmutableUpdatePlanRefV1<"owner_update">),
      migrations: a.migrationRefs,
      manifest: { transitional: a.refs.manifest[0], terminal: a.refs.manifest[1] },
      trust: a.refs.trust,
      active: a.refs.active,
      rollback: a.refs.rollback,
      rollbackPayload: a.refs.rollbackPayload,
      initialParticipantJournals: a.journals.map((journal) => journal.ref),
      recoveryExecutor: a.recovery.descriptor,
      verification: a.refs.verification,
      retirement: a.refs.retirement,
    }, { productHome: this.#deps.productHome, evidence: this.#deps.evidence, fallback: this.#deps.fallback }));
    const executionRef = leafRef(this.#root, "update_execution", "execution", execution);

    const planValues = [...a.leaves, ["update_execution", "execution", execution] as const];
    if (planValues.length !== a.plans) refuse("update_composition_plan_count", EXIT_CODES.recoveryRequired);
    const rowBytes = new Map<number, Uint8Array>();
    const planRows = planValues.map(([kind, id, value], ordinal): UpdateConstructionFileInputV1 => {
      const bytes = updateParticipantDocumentBytes(value);
      rowBytes.set(ordinal, bytes);
      return { role: { kind: "immutable_plan", planKind: kind, id: id as SafeReasonCodeV1 }, path: updateLeafPlanPath(this.#root, kind, id), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384 };
    });
    a.sourceJournals.forEach((journal, index) => rowBytes.set(a.plans + index, journal.bytes));
    for (const journal of a.journals) rowBytes.set(journal.ref.stagedExpected.constructionOrdinal, journal.bytes);
    rowBytes.set(a.recovery.descriptor.initialStaged.constructionOrdinal, a.recovery.bytes[0]);
    rowBytes.set(a.recovery.descriptor.terminalStaged.constructionOrdinal, a.recovery.bytes[1]);
    const files = [
      ...planRows,
      ...a.sourceJournals.map((journal) => journal.row),
      ...[...a.rows.payloads].sort((left, right) => left.ordinal - right.ordinal).map((row) => this.#payloadFile(row)),
      ...a.journals.map((journal) => journal.file),
      ...a.recovery.files,
    ];

    const outerPaths = updateCoordinatorEnvelopePaths(this.#deps.productHome, this.#coordinatorId);
    const construction = composed("update_composition_construction", () => buildConstructionPlan({
      coordinatorId: this.#coordinatorId,
      operation: a.operation,
      executionBindingHash: a.executionBindingHash,
      stagingRoot: a.stagingRoot,
      files,
      rollbackSource: a.rollbackSource,
      candidate: a.candidate,
      constructionJournalCreatedAt: this.#plannedAt,
      outerJournalCreatedAt: this.#plannedAt,
      outerPlanPath: outerPaths.plan,
      outerJournalPath: outerPaths.journal,
    }));
    const outerPlan = composed("update_composition_outer", () => buildUpdateCoordinatorPlan({ execution, executionRef, construction: constructionPlanRef(construction), owners: a.stepOwners, retainPayloadId: a.retainPayloadId }));
    // Spec 2 §10.2: a rollback runs only the step list the applying release retained for it.
    if (a.exactStepListHash !== null && rollbackStepListHash(outerPlan.steps) !== a.exactStepListHash) refuse("update_rollback_evidence_invalid", EXIT_CODES.recoveryRequired);
    const outer = updateCoordinatorOuterBytes(outerPlan, this.#plannedAt);
    return {
      construction,
      outer,
      capacity: this.#capacity(a.capacityBase, constructionPlanBytes(construction).byteLength + updateCoordinatorPlanBytes(outerPlan).byteLength + outerPlan.maximumJournalBytes, a.journals.length),
      rowBytes,
    };
  }

  // -------------------------------------------------------------------------------------------
  // `update rollback --apply` (Spec 2 §10.2, P9): every leaf from the retained inverse and local
  // evidence, over the same row ledger and assembly; no planner, network, or source envelope.

  async composeRollback(): Promise<UpdateComposedV1> {
    const { input, deps } = this.#rollback;
    const { home, preview } = input;
    const record = home.rollback ?? refuse("update_rollback_unavailable", EXIT_CODES.capabilityUnavailable);
    const { current, target } = preview;
    if (canonical(record.previous) !== canonical(target) || canonical(record.installed) !== canonical(current)) refuse("update_plan_changed", EXIT_CODES.operationalFailure);
    const stagingRoot = await this.#stagingRoot();

    const manifestIds = [this.#ids.take("mf"), this.#ids.take("mf")].map((id) => parseManifestParticipantId(id, null)) as [ManifestParticipantIdV1, ManifestParticipantIdV1];
    const effectId = deps.retained.owners.some((owner) => owner.externalEffects.length > 0) ? this.#ids.take("oe") : null;

    // Plans first, then rows by source rank: retained blobs, guarded current bytes, plan-derived.
    const owners = await this.#restoreOwners(record.payloadId, target);
    const retainedMigrations = deps.retained.migrations;
    const plans = 9 + owners.length + (effectId === null ? 0 : 1) + retainedMigrations.length;
    const rows = new RowLedger(plans);
    this.#retainedOwnerRows(owners, rows);
    const restoreRows = this.#retainedMigrationRows(record.payloadId, rows);
    this.#preimageRows(owners, rows);
    const currentRows = await this.#migrationCurrentRows(rows);
    this.#registrationRows(owners, rows);

    const foundationByOwner = owners.map((owner) => this.#ownerFoundation(owner, rows, OWNER_ROLLBACK_SLOTS));
    const migrations = retainedMigrations.map((migration) => this.#rollbackMigrationPlan(migration, restoreRows, currentRows, rows));
    const inverse = new Map(deps.retained.owners.map((projection) => [projection.id as string, projection]));
    owners.forEach((owner, index) => {
      owner.foundation = foundationByOwner[index] as readonly UpdateFoundationParticipantRefV2[];
      this.#ownerPlan(owner, inverse, effectId, "update_rollback");
    });
    const stepOwners = owners.map((owner): UpdateStepOwnerV1 => ({ id: owner.id, owner: owner.draft.owner, externalEffects: owner.effect === null ? [] : [{ id: owner.effect.ref.id }] }));
    const migrationRefs = migrations.map((plan) => leafRef(this.#root, "schema_migration", plan.id, plan));
    const executionBindingHash = updateExecutionBindingHash({ coordinatorId: this.#coordinatorId, operation: "update_rollback", previewHash: preview.previewHash, current, target });

    // The transitional manifest restores the previous managed state and keeps the consumed set; the terminal one drops it.
    const activeValue = validateActiveReleaseRecord({ schemaVersion: 1, ...target, activatedAt: this.#plannedAt }, this.#deps.evidence);
    const transitional = this.#rollbackTransitional(owners, canonical(activeValue), target);
    const retirement = this.#consumedEntries(transitional, record.payloadId, record.payloadInventoryHash, current, target);
    const terminal = deriveTerminalManifest(transitional, transitional.artifacts.filter((row) => retirement.some((entry) => under(row.path, entry.root))));
    const manifestRows = [this.#manifestAfterRow(manifestIds[0], transitional, rows), this.#manifestAfterRow(manifestIds[1], terminal, rows)] as const;
    const activeRow = this.#stateRow("active_release", parseSafeReasonCode("active"), canonical(activeValue), rows);

    const bundle = await this.#verifyPreviousPlan(target, deps.previousBundle);
    const payloadState = this.#verifyRetainedPayloadPlan(record.payloadId, record.rollbackBindingHash, record.inversePlanHash, record.payloadInventoryHash);
    const manifests = this.#manifestPlans(manifestIds, manifestRows, owners, await this.#manifestBefore());
    const activePlan = await this.#statePlan("active_release", parseSafeReasonCode("active"), "active-release.json", activeRow, "reversible");
    const recordPlan = await this.#retainedRecordPlan(canonical(record));
    const verification = this.#verificationPlan(owners, migrations, migrationRefs, transitional, { target, bundleManifest: deps.previousBundle });
    const retirementPlan = this.#retirementPlan(retirement, transitional, "consumed_rollback_and_rejected_release");

    const refs = {
      bundle: bundlePublicationPlanRef(bundle, this.#root),
      manifest: manifests.map((plan) => leafRef(this.#root, "manifest_state", plan.participantId, plan)) as [ImmutableUpdatePlanRefV1<"manifest_state">, ImmutableUpdatePlanRefV1<"manifest_state">],
      trust: null,
      active: leafRef(this.#root, "active_release_state", activePlan.id, activePlan),
      rollback: leafRef(this.#root, "rollback_record_state", recordPlan.id, recordPlan),
      rollbackPayload: rollbackPayloadStatePlanRef(payloadState, this.#root),
      verification: leafRef(this.#root, "target_verification", verification.id, verification),
      retirement: updateTerminalRetirementPlanRef(retirementPlan, this.#root),
    };
    manifestRows.forEach((row, index) => {
      row.source = { kind: "plan_derived", role: "manifest_after", plan: refs.manifest[index] as ImmutableUpdatePlanRefV1<"manifest_state">, value: this.#rowValue(row), valueBytes: row.bytes - 1 };
    });
    activeRow.source = { kind: "plan_derived", role: "active_release_after", plan: refs.active, value: this.#rowValue(activeRow), valueBytes: activeRow.bytes - 1 };
    for (const owner of owners) this.#resolveOwnerSources(owner);
    this.#resolveMigrationCurrentSources(migrations, migrationRefs, currentRows);

    const journals = this.#initialJournals(bundle, refs, owners, migrations, migrationRefs, [
      { kind: "active_release_state", plan: activePlan, ref: refs.active },
      { kind: "rollback_record_state", plan: recordPlan, ref: refs.rollback },
    ], payloadState, rows);
    const recovery = this.#recoveryExecutor("update_rollback", current, executionBindingHash, rows);
    this.#ids.done();

    const { trust } = home;
    const assembled = this.#assemble({
      operation: "update_rollback",
      previewHash: preview.previewHash,
      executionBindingHash,
      current,
      target,
      // Trust is never a rollback step: the execution names the unchanged accepted metadata.
      metadata: { delegationSequence: trust.highestDelegationSequence, delegationHash: trust.delegationHash, delegatedReleaseKeyId: trust.delegatedReleaseKeyId, releaseIndexSequence: trust.highestReleaseIndexSequence, releaseIndexHash: trust.releaseIndexHash },
      planner: null,
      refs,
      owners,
      migrationRefs,
      journals,
      recovery,
      plans,
      leaves: [
        ["bundle_publication", bundle.id, bundle],
        ...owners.map((owner) => ["owner_update", owner.id, owner.plan] as const),
        ...owners.flatMap((owner) => (owner.effect === null ? [] : [["owner_external_effect", owner.effect.plan.id, owner.effect.plan] as const])),
        ...migrations.map((plan) => ["schema_migration", plan.id, plan] as const),
        ...manifests.map((plan) => ["manifest_state", plan.participantId, plan] as const),
        ["active_release_state", activePlan.id, activePlan],
        ["rollback_record_state", recordPlan.id, recordPlan],
        ["rollback_payload_state", payloadState.id, payloadState],
        ["target_verification", verification.id, verification],
        ["terminal_retirement", retirementPlan.id, retirementPlan],
      ],
      sourceJournals: [],
      rows,
      stagingRoot,
      rollbackSource: null,
      candidate: null,
      stepOwners,
      retainPayloadId: null,
      capacityBase: this.#rollbackCapacity(),
      exactStepListHash: deps.retained.exactStepListHash,
    });
    return { ...assembled, sources: { bundleSource: null, rollbackSource: null, documents: null, rowBytes: assembled.rowBytes } };
  }

  /** One owner plan per retained inverse leaf: restored rows from the retained operations, every other row kept. */
  async #restoreOwners(payloadId: RollbackPayloadIdV1, target: ReleaseIdentityV1): Promise<OwnerBuildV1[]> {
    const { home } = this.#rollback.input;
    const ordered = [...this.#rollback.deps.retained.owners].sort((left, right) => OWNER_UPDATE_ORDER.indexOf(left.owner) - OWNER_UPDATE_ORDER.indexOf(right.owner));
    const built: OwnerBuildV1[] = [];
    for (const projection of ordered) {
      const retained = new Map(projection.operations.map((operation) => [operation.path as string, operation]));
      const ops: OwnerOpV1[] = [];
      for (const row of home.manifest.artifacts.filter((artifact) => artifact.owner === projection.owner)) {
        const observed = await this.#deps.observe(row.path);
        const restore = retained.get(row.path);
        retained.delete(row.path);
        ops.push(restore === undefined
          ? { operation: "keep", targetPath: row.path, current: row, after: row, before: beforeState(row, observed), observed, content: null }
          : this.#restoreOp(projection.owner, row, restore, observed, payloadId, target));
      }
      for (const restore of retained.values()) ops.push(this.#restoreOp(projection.owner, null, restore, await this.#deps.observe(restore.path), payloadId, target));
      const draft: OwnerUpdateDraftV1 = { owner: projection.owner, currentArtifacts: [], proposedOperations: [], externalEffects: [] };
      // NEW-168: the retained inverse never carries the registration record the update rewrote.
      built.push({ draft, id: projection.id, ops: this.#withRegistration(draft, ops, target.version), contentRows: new Map(), preimageRows: new Map(), foundation: [], plan: null, ref: null, effect: null });
    }
    return built;
  }

  /** A retained operation over its guarded current state: the current bytes must still be the update's postimage. */
  #restoreOp(owner: ManagedArtifactV2["owner"], row: ManagedArtifactV2 | null, restore: RetainedOwnerInverseOperationV1, observed: ObservedPathV1 | null, payloadId: RollbackPayloadIdV1, target: ReleaseIdentityV1): OwnerOpV1 {
    const expected = restore.expectedCurrent;
    const inverse = (): never => refuse("update_composition_inverse", EXIT_CODES.recoveryRequired, restore.path);
    const changed = (): never => refuse("update_state_changed", EXIT_CODES.operationalFailure, restore.path);
    let before: PersistedManagedPathStateV1 = { state: "absent" };
    if (expected.state === "file") {
      if (observed?.entry.kind !== "regular_file" || observed.sha256 !== expected.sha256) return changed();
      before = { state: "file", mode: modeOf(observed), hash: observed.sha256, bytes: Number(observed.entry.size), dev: observed.entry.dev, ino: observed.entry.ino };
    } else if (expected.state !== "absent") {
      return inverse();
    } else if (observed !== null) {
      return changed();
    }
    if ((row === null) !== (before.state === "absent")) return inverse();
    const base = { targetPath: restore.path, current: row, before, observed } as const;
    if (restore.restore.state === "absent") return before.state === "file" ? { ...base, operation: "remove", after: null, content: null } : inverse();
    if (restore.restore.state !== "file") return inverse();
    const content = { kind: "retained", source: this.#retainedBlob(payloadId, restore.restore, restore.path) } as const;
    return { ...base, operation: before.state === "file" ? "replace" : "create", after: this.#restoredRow(owner, restore.path, row, restore.restore.sha256, target), content };
  }

  /** P9(c): the restored file's row from the retained inverse; the installed row supplies only its provenance fields. */
  #restoredRow(owner: ManagedArtifactV2["owner"], target: CanonicalAbsolutePathV1, row: ManagedArtifactV2 | null, hash: LowerHexSha256, release: ReleaseIdentityV1): ManagedArtifactV2 {
    const provenance = row === null
      ? { existedBefore: false, beforeHash: null, backupRelativePath: null, source: "generated/rollback_restore" as ManagedArtifactV2["source"], mergeStrategy: "dedicated" as const }
      : { existedBefore: row.existedBefore, beforeHash: row.beforeHash, backupRelativePath: row.backupRelativePath, source: row.source, mergeStrategy: row.mergeStrategy };
    return { owner, path: target, productVersion: release.version, ...provenance, verifiedAt: this.#plannedAt, kind: "file", verification: { mode: "content", installedHash: hash } };
  }

  /** P9(a): one retained preimage blob, by the inventory ordinal its path derives from. */
  #retainedBlob(payloadId: RollbackPayloadIdV1, restore: Extract<RetainedInversePathStateV1, { readonly state: "file" }>, subject: string): UpdateConstructionRetainedRollbackBlobSourceV1 {
    const chunk = restore.payload?.chunks.length === 1 ? restore.payload.chunks[0] : undefined;
    const ordinal = chunk === undefined ? undefined : RETAINED_BLOB_PATH.exec(chunk.path)?.[1];
    // ponytail: an empty preimage retains no blob, so it has no source arm yet; add a zero-byte arm to P9 if empty managed files appear.
    if (chunk === undefined || ordinal === undefined || chunk.bytes !== restore.bytes || chunk.sha256 !== restore.sha256) return refuse("update_rollback_restore_unavailable", EXIT_CODES.capabilityUnavailable, subject);
    return { kind: "retained_rollback_blob", payloadId, ordinal: Number(ordinal), bytes: restore.bytes, sha256: restore.sha256, mode: restore.mode };
  }

  #retainedOwnerRows(owners: readonly OwnerBuildV1[], rows: RowLedger): void {
    for (const owner of owners) {
      for (const op of owner.ops) {
        if (op.content?.kind !== "retained") continue;
        const { source } = op.content;
        const ordinal = rows.ordinal();
        owner.contentRows.set(op.targetPath, rows.add({ payloadKind: "owner_content", path: this.#payloadPath(ordinal), bytes: source.bytes, sha256: source.sha256, mode: source.mode, source }, ordinal));
      }
    }
  }

  /** Each retained migration mutation's restore blob, keyed by migration and absolute target. */
  #retainedMigrationRows(payloadId: RollbackPayloadIdV1, rows: RowLedger): Map<string, PayloadRowV1> {
    const found = new Map<string, PayloadRowV1>();
    for (const migration of this.#rollback.deps.retained.migrations) {
      for (const mutation of migration.mutations) {
        const target = retainedMigrationTarget(migration.domain, mutation.path, this.#deps.brainRoot);
        const blob = { state: "file", mode: 384, bytes: mutation.restoreBlob.bytes, sha256: mutation.restoreHash, payload: { chunks: [mutation.restoreBlob], aggregateBytes: mutation.restoreBlob.bytes, sha256: mutation.restoreHash } } as const;
        const source = this.#retainedBlob(payloadId, blob, target);
        const ordinal = rows.ordinal();
        found.set(`${migration.id}\0${target}`, rows.add({ payloadKind: "migration_content", path: this.#payloadPath(ordinal), bytes: source.bytes, sha256: source.sha256, mode: source.mode, source }, ordinal));
      }
    }
    return found;
  }

  /** The guarded current bytes each migration compensation puts back; their source waits for the plan ref. */
  async #migrationCurrentRows(rows: RowLedger): Promise<Map<string, { readonly row: PayloadRowV1; readonly observed: ObservedPathV1 }>> {
    const found = new Map<string, { readonly row: PayloadRowV1; readonly observed: ObservedPathV1 }>();
    for (const migration of this.#rollback.deps.retained.migrations) {
      for (const mutation of migration.mutations) {
        const target = retainedMigrationTarget(migration.domain, mutation.path, this.#deps.brainRoot);
        const observed = await this.#deps.observe(target);
        if (observed?.entry.kind !== "regular_file" || observed.sha256 !== mutation.expectedCurrentHash) return refuse("update_state_changed", EXIT_CODES.operationalFailure, target);
        const ordinal = rows.ordinal();
        found.set(`${migration.id}\0${target}`, { row: rows.add({ payloadKind: "migration_content", path: this.#payloadPath(ordinal), bytes: Number(observed.entry.size), sha256: observed.sha256, mode: modeOf(observed) }, ordinal), observed });
      }
    }
    return found;
  }

  #rollbackMigrationPlan(migration: RetainedSchemaMigrationInverseProjectionV1, restoreRows: ReadonlyMap<string, PayloadRowV1>, currentRows: ReadonlyMap<string, { readonly row: PayloadRowV1 }>, rows: RowLedger): SchemaMigrationPlanV1 {
    const key = (target: string): string => `${migration.id}\0${target}`;
    const rowOf = (map: ReadonlyMap<string, PayloadRowV1 | { readonly row: PayloadRowV1 }>, target: string): PayloadRowV1 => {
      const found = map.get(key(target)) ?? refuse("update_composition_inverse", EXIT_CODES.recoveryRequired, target);
      return "row" in found ? found.row : found;
    };
    const targets = migration.mutations.map((mutation) => ({ mutation, target: retainedMigrationTarget(migration.domain, mutation.path, this.#deps.brainRoot) }));
    const forward = targets.map(({ mutation, target }): UpdateFoundationMutationInputV1 => ({ targetPath: target, operation: "replace", expectedBeforeHash: mutation.expectedCurrentHash, ...this.#staged(rowOf(restoreRows, target), rows) }))
      .sort((left, right) => compareUtf8(left.targetPath, right.targetPath));
    const foundation = this.#foundationRefs(SCHEMA_ROLLBACK_SLOTS, forward, (mutation) => ({
      targetPath: mutation.targetPath,
      operation: "replace",
      expectedBeforeHash: mutation.content?.sha256 ?? null,
      ...this.#staged(rowOf(currentRows, mutation.targetPath), rows),
    }), rows);
    return composed("update_composition_migration", () => materializeRollbackSchemaMigration(migration, {
      coordinatorId: this.#coordinatorId,
      productHome: this.#deps.productHome,
      brainRoot: this.#deps.brainRoot,
      restore: new Map(targets.map(({ target }) => [target as string, this.#payloadRef(rowOf(restoreRows, target))])),
      current: new Map(targets.map(({ target }) => [target as string, this.#payloadRef(rowOf(currentRows, target))])),
      foundation,
    }));
  }

  #resolveMigrationCurrentSources(migrations: readonly SchemaMigrationPlanV1[], refs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[], currentRows: ReadonlyMap<string, { readonly row: PayloadRowV1; readonly observed: ObservedPathV1 }>): void {
    migrations.forEach((plan, index) => {
      plan.mutations.forEach((mutation, mutationOrdinal) => {
        const target = retainedMigrationTarget(plan.domain, mutation.path, this.#deps.brainRoot);
        const found = currentRows.get(`${plan.id}\0${target}`) ?? refuse("update_composition_inverse", EXIT_CODES.recoveryRequired, target);
        const { entry } = found.observed;
        found.row.source = { kind: "guarded_preimage", authority: { kind: "schema_migration_before", migrationPlan: refs[index] as ImmutableUpdatePlanRefV1<"schema_migration">, mutationOrdinal }, path: target, ownerUid: entry.ownerUid as EffectiveUidV1, mode: found.row.mode, nlink: 1, bytes: found.row.bytes, sha256: found.row.sha256, dev: entry.dev, ino: entry.ino };
      });
    });
  }

  /**
   * §10.2's transitional manifest: the owner rows restored or removed, migrated schema rows back at
   * their restore hash, the active row naming the previous record; the rejected bundle, its
   * metadata, and the consumed payload stay until terminal retirement.
   */
  #rollbackTransitional(owners: readonly OwnerBuildV1[], active: CanonicalJsonV1, target: ReleaseIdentityV1): InstallationManifestV2 {
    const { home } = this.#rollback.input;
    const rows = new Map(home.manifest.artifacts.map((row) => [row.path as string, row]));
    for (const owner of owners) {
      for (const op of owner.ops) {
        if (op.operation === "remove") rows.delete(op.targetPath);
        else if (op.operation !== "keep" && op.after !== null) rows.set(op.targetPath, op.after);
      }
    }
    // Instruction rows never reach a planner or an inverse (NEW-171): restamped at the restored
    // release's version, as the update's concrete manifest stamps them at the target's.
    for (const row of [...rows.values()]) if (row.kind === "instruction") rows.set(row.path, { ...row, productVersion: target.version });
    const rehash = (at: string, hash: LowerHexSha256): void => {
      const row = rows.get(at);
      if (row?.kind !== "file" || installedHash(row) === null) return;
      rows.set(at, { ...row, productVersion: target.version, verifiedAt: this.#plannedAt, verification: { ...row.verification, installedHash: hash } } as ManagedArtifactV2);
    };
    for (const migration of this.#rollback.deps.retained.migrations) {
      if (migration.domain !== "product_state") continue;
      for (const mutation of migration.mutations) rehash(mutation.path, mutation.restoreHash);
    }
    rehash(`${this.#deps.productHome}/state/active-release.json`, sha256(active));
    return composed("update_composition_manifest", () => this.#deps.admitManifest({
      schemaVersion: 2,
      productVersion: target.version,
      installedAt: home.manifest.installedAt,
      artifacts: [...rows.values()].sort(compareManifestRows),
    }));
  }

  /**
   * §10.2's consumed set in kind/root order: the rejected bundle, its metadata no previous-release
   * document shares, and the retained payload. The record is the ephemeral reservation's content,
   * removed by its own verify-retained participant at terminal finalization, so its row stays.
   */
  #consumedEntries(transitional: InstallationManifestV2, payloadId: RollbackPayloadIdV1, inventoryHash: LowerHexSha256, current: ReleaseIdentityV1, target: ReleaseIdentityV1): readonly RetirementInventoryRefV1[] {
    if (current.bundleRoot === target.bundleRoot) refuse("update_rollback_target_retained", EXIT_CODES.recoveryRequired, current.bundleRoot);
    const leafCount = (root: string): number => transitional.artifacts.filter((row) => under(row.path, root)).length;
    const documents = (release: ReleaseIdentityV1): readonly LowerHexSha256[] => [release.delegationHash, release.releaseIndexHash, release.bundleManifestHash];
    const payloadRoot = rollbackPayloadRoot(this.#deps.productHome, payloadId);
    const entries: RetirementInventoryRefV1[] = [
      { kind: "bundle", root: current.bundleRoot, inventoryHash: current.bundleManifestHash, leafCount: leafCount(current.bundleRoot) },
      ...documents(current).flatMap((hash, ordinal): RetirementInventoryRefV1[] => (documents(target)[ordinal] === hash ? [] : [{ kind: "metadata", root: bundleMetadataPath(current, ordinal), inventoryHash: hash, leafCount: 1 }])),
      { kind: "rollback_payload", root: payloadRoot, inventoryHash, leafCount: leafCount(payloadRoot) },
    ];
    return entries.sort((left, right) => RETIREMENT_KINDS.indexOf(left.kind) - RETIREMENT_KINDS.indexOf(right.kind) || compareUtf8(left.root, right.root));
  }

  /** `bundle/verify_previous`: the retained root and its three present-to-present metadata files, observed now. */
  async #verifyPreviousPlan(target: ReleaseIdentityV1, bundleManifest: ReleaseBundleManifestV1): Promise<BundlePublicationPlanV1> {
    const root = await this.#deps.observe(target.bundleRoot);
    if (root?.entry.kind !== "directory") return refuse("update_rollback_evidence_invalid", EXIT_CODES.recoveryRequired, target.bundleRoot);
    const { entries } = bundleManifest;
    const inventoryHash = bundleInventoryHash(entries);
    const signed = [target.delegationHash, target.releaseIndexHash, target.bundleManifestHash];
    const metadata: BundleMetadataStatePlanV1[] = [];
    for (const [ordinal, hash] of signed.entries()) {
      const at = bundleMetadataPath(target, ordinal);
      const observed = await this.#deps.observe(at);
      if (observed?.entry.kind !== "regular_file" || observed.sha256 !== hash) return refuse("update_rollback_evidence_invalid", EXIT_CODES.recoveryRequired, at);
      const id = parseSafeReasonCode(`release_metadata_${String(ordinal)}`);
      const state = { state: "present", hash, payload: null, ownerUid: observed.entry.ownerUid as EffectiveUidV1, mode: 384, nlink: 1, size: Number(observed.entry.size) } as const;
      metadata.push({ schemaVersion: 1, id, coordinatorId: this.#coordinatorId, role: "release_metadata", path: at, tombstonePath: path(`${this.#root}/update/evidence/tombstones/${id}.json`), before: { ...state, dev: observed.entry.dev, ino: observed.entry.ino }, after: state, reversal: "reversible", maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES, maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES });
    }
    return composed("update_composition_bundle", () => validateBundlePublicationPlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("bundle"),
      coordinatorId: this.#coordinatorId,
      action: "verify_previous",
      target,
      source: { kind: "retained_bundle", root: target.bundleRoot, rootDev: root.entry.dev, rootIno: root.entry.ino, inventoryHash, entryCount: entries.length, aggregateBytes: bundleAggregateBytes(entries) },
      targetRootBefore: { state: "present", inventoryHash, dev: root.entry.dev, ino: root.entry.ino },
      metadata,
      entries,
      inventoryHash,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#root));
  }

  /** `rollback_payload/verify_retained`: publishes nothing and retires the retained payload at terminal. */
  #verifyRetainedPayloadPlan(payloadId: RollbackPayloadIdV1, rollbackBindingHash: LowerHexSha256, inversePlanHash: LowerHexSha256, inventoryHash: LowerHexSha256): RollbackPayloadStatePlanV1 {
    const { entryCount, aggregateBytes } = this.#rollback.deps.retained;
    const retained: RollbackPayloadIdentityV1 = { payloadId, root: rollbackPayloadRoot(this.#deps.productHome, payloadId), rollbackBindingHash, inversePlanHash, inventoryHash, entryCount, aggregateBytes };
    return composed("update_composition_rollback_state", () => validateRollbackPayloadStatePlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("rollback_payload"),
      coordinatorId: this.#coordinatorId,
      retainedBefore: retained,
      publish: null,
      source: null,
      retainAfter: null,
      retireAtTerminal: [retained],
      publicationInventoryHash: null,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#root));
  }

  /** `rollback_record/verify_retained`: the guarded present record, absent after; it never publishes. */
  async #retainedRecordPlan(record: CanonicalJsonV1): Promise<CanonicalStateFilePlanV1> {
    const target = path(`${this.#deps.productHome}/state/update-rollback.json`);
    const observed = await this.#deps.observe(target);
    if (observed?.entry.kind !== "regular_file" || observed.sha256 !== sha256(record)) return refuse("update_state_changed", EXIT_CODES.operationalFailure, target);
    return composed("update_composition_state", () => validateCanonicalStateFilePlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("rollback_record"),
      coordinatorId: this.#coordinatorId,
      role: "rollback_record",
      path: target,
      tombstonePath: path(`${dirname(target)}/.${basename(target)}.${this.#coordinatorId}.tombstone`),
      before: { state: "present", hash: observed.sha256, payload: null, ownerUid: observed.entry.ownerUid as EffectiveUidV1, mode: 384, nlink: 1, size: Number(observed.entry.size), dev: observed.entry.dev, ino: observed.entry.ino },
      after: { state: "absent" },
      reversal: "reversible",
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#deps.productHome));
  }

  /**
   * Rollback's aggregate projection, as `planRollback` previews it. Availability is zero here: the
   * caller overlays its own under-lock observation, so a projection used without one refuses.
   */
  #rollbackCapacity(): UpdateCapacityInputV1 {
    const { retained } = this.#rollback.deps;
    return {
      operation: "rollback",
      components: rollbackCapacityComponents(retained.aggregateBytes, retained.entryCount, retained.owners.length + retained.migrations.length),
      reservationGranularityBytes: parseUInt64Decimal("1"),
      availableBytes: parseUInt64Decimal("0"),
      availableEntries: parseUInt64Decimal("0"),
    };
  }

  async #stagingRoot(): Promise<Parameters<typeof buildConstructionPlan>[0]["stagingRoot"]> {
    const found = await this.#deps.observe(this.#root);
    if (found?.entry.kind !== "directory" || found.entry.ownerUid !== this.#deps.effectiveUid || found.entry.mode !== 0o700) refuse("update_construction_staging_root", EXIT_CODES.recoveryRequired, this.#root);
    return { path: this.#root, ownerUid: this.#deps.effectiveUid as EffectiveUidV1, mode: 448, dev: found.entry.dev, ino: found.entry.ino };
  }

  // -------------------------------------------------------------------------------------------
  // Owners.

  async #ownerOps(drafts: readonly OwnerUpdateDraftV1[]): Promise<OwnerBuildV1[]> {
    const { home, materialized } = this.#input;
    const { snapshot } = materialized;
    const tokenOf = new Map<string, PlannerPathTokenV1>([...snapshot.tokenPaths].map(([token, target]) => [target as string, token]));
    const after = new Map(materialized.manifest.artifacts.map((row) => [row.path as string, row]));
    const ordered = [...drafts].sort((left, right) => OWNER_UPDATE_ORDER.indexOf(left.owner) - OWNER_UPDATE_ORDER.indexOf(right.owner));
    const built: OwnerBuildV1[] = [];
    for (const draft of ordered) {
      const byToken = new Map<string, PlannerChangePlanOperationV1>();
      for (const operation of draft.proposedOperations) if (operation.operation !== "create") byToken.set(operation.target.token, operation);
      const ops: OwnerOpV1[] = [];
      for (const row of home.manifest.artifacts.filter((artifact) => artifact.owner === draft.owner)) {
        const token = tokenOf.get(row.path);
        const operation = token === undefined ? undefined : byToken.get(token);
        const observed = await this.#deps.observe(row.path);
        const before = beforeState(row, observed);
        const kind = operation?.operation ?? "keep";
        const content = operation?.operation === "replace" ? this.#contentSpec(operation.content, before.state === "file" ? before.mode : 384) : null;
        ops.push({ operation: kind, targetPath: row.path, current: row, after: kind === "remove" ? null : (after.get(row.path) ?? null), before, observed, content });
      }
      for (const operation of draft.proposedOperations) {
        if (operation.operation !== "create") continue;
        const root = snapshot.ownerRoots[draft.owner] ?? refuse("update_owner_root_unavailable", EXIT_CODES.capabilityUnavailable);
        const targetPath = path(`${root}/${operation.target.path}`);
        if ((await this.#deps.observe(targetPath)) !== null) refuse("update_state_changed", EXIT_CODES.operationalFailure, targetPath);
        ops.push({ operation: "create", targetPath, current: null, after: after.get(targetPath) ?? null, before: { state: "absent" }, observed: null, content: this.#contentSpec(operation.content, 384) });
      }
      built.push({ draft, id: parseSafeReasonCode(`owner_${draft.owner}`), ops: this.#withRegistration(draft, ops, this.#input.inputs.target.version), contentRows: new Map(), preimageRows: new Map(), foundation: [], plan: null, ref: null, effect: null });
    }
    return built;
  }

  #contentSpec(content: PlannerContentRefV1, fallbackMode: 384 | 448): ContentSpecV1 {
    const { run, candidate } = this.#input.materialized;
    if (content.kind === "output_blob") {
      const blob = run.outputBlobs[content.blob.ordinal] ?? candidate.materialization.outputBlobs[content.blob.ordinal];
      if (blob === undefined) return refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
      return { kind: "planner_output", ordinal: blob.ordinal, bytes: blob.bytes, sha256: blob.sha256, mode: fallbackMode };
    }
    const entry = this.#input.inputs.bundleManifest.entries.find((candidateEntry) => candidateEntry.path === content.path);
    if (entry?.kind !== "file" || entry.sha256 !== content.sha256) return refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
    return { kind: "bundle", entry };
  }

  /** P6(d): a changed Codex tree also rewrites `codex/registration.json` from the owner postimage. */
  #withRegistration(draft: OwnerUpdateDraftV1, ops: OwnerOpV1[], productVersion: ReleaseIdentityV1["version"]): OwnerOpV1[] {
    const changed = ops.some((op) => op.operation !== "keep");
    if (draft.owner !== "codex" || !changed) return ops.sort((left, right) => compareUtf8(left.targetPath, right.targetPath));
    const homes = this.#deps.codexHomes ?? refuse("update_codex_unavailable", EXIT_CODES.capabilityUnavailable);
    const postimage = ops.flatMap((op) => (op.after === null ? [] : [op.after]));
    const { artifact, bytes } = codexRegistrationRow({ homes, productVersion, plannedAt: this.#plannedAt, ownerPostimage: postimage });
    const existing = ops.find((op) => op.targetPath === artifact.path);
    if (existing !== undefined && existing.operation !== "keep") refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal, artifact.path);
    const registration: OwnerOpV1 = existing === undefined
      ? { operation: "create", targetPath: artifact.path, current: null, after: artifact, before: { state: "absent" }, observed: null, content: { kind: "registration", value: bytes } }
      : { ...existing, operation: existing.before.state === "file" ? "replace" : "create", after: artifact, content: { kind: "registration", value: bytes } };
    return [...ops.filter((op) => op !== existing), registration].sort((left, right) => compareUtf8(left.targetPath, right.targetPath));
  }

  #contentRows(owners: readonly OwnerBuildV1[], rows: RowLedger): void {
    for (const owner of owners) {
      for (const op of owner.ops) {
        if (op.content?.kind !== "planner_output") continue;
        owner.contentRows.set(op.targetPath, rows.add({ payloadKind: "owner_content", path: this.#payloadPath(0), bytes: op.content.bytes, sha256: op.content.sha256, mode: op.content.mode, source: { kind: "planner_output", ordinal: op.content.ordinal } }, -1));
      }
    }
  }

  #migrationPlannerRows(rows: RowLedger): Map<number, PayloadRowV1> {
    const byBlob = new Map<number, PayloadRowV1>();
    for (const migration of this.#input.materialized.run.draft.migrations) {
      for (const mutation of migration.mutations) {
        for (const ref of [mutation.afterBlob, mutation.inverseBlob]) {
          if (byBlob.has(ref.ordinal)) continue;
          const blob = this.#input.materialized.run.outputBlobs[ref.ordinal] ?? refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal);
          byBlob.set(ref.ordinal, rows.add({ payloadKind: "migration_content", path: this.#payloadPath(0), bytes: blob.bytes, sha256: blob.sha256, mode: 384, source: { kind: "planner_output", ordinal: blob.ordinal } }, -1));
        }
      }
    }
    return byBlob;
  }

  /** Planner rows are contiguous and in frame order, so the frame cursor and the file cursor move together. */
  #sortPlannerRows(rows: RowLedger): void {
    const planner = rows.payloads.filter((row) => row.ordinal === -1);
    const ordered = [...planner].sort((left, right) => (left.source as { readonly ordinal: number }).ordinal - (right.source as { readonly ordinal: number }).ordinal);
    for (const row of ordered) {
      const ordinal = rows.ordinal();
      Object.assign(row, { ordinal, path: this.#payloadPath(ordinal) });
    }
  }

  #bundleContentRows(owners: readonly OwnerBuildV1[], rows: RowLedger): void {
    for (const owner of owners) {
      for (const op of owner.ops) {
        if (op.content?.kind !== "bundle") continue;
        const ordinal = rows.ordinal();
        owner.contentRows.set(op.targetPath, rows.add({ payloadKind: "owner_content", path: this.#payloadPath(ordinal), bytes: Number(op.content.entry.bytes), sha256: op.content.entry.sha256, mode: op.content.entry.mode }, ordinal));
      }
    }
  }

  /** Each replaced or removed file's preimage, restored by its paired compensation ref. */
  #preimageRows(owners: readonly OwnerBuildV1[], rows: RowLedger): void {
    for (const owner of owners) {
      for (const op of owner.ops) {
        if ((op.operation !== "replace" && op.operation !== "remove") || op.before.state !== "file") continue;
        const ordinal = rows.ordinal();
        owner.preimageRows.set(op.targetPath, rows.add({ payloadKind: "foundation_content", path: this.#payloadPath(ordinal), bytes: op.before.bytes, sha256: op.before.hash, mode: op.before.mode }, ordinal));
      }
    }
  }

  #registrationRows(owners: readonly OwnerBuildV1[], rows: RowLedger): void {
    for (const owner of owners) {
      for (const op of owner.ops) {
        if (op.content?.kind !== "registration") continue;
        const bytes = encoder.encode(op.content.value);
        const ordinal = rows.ordinal();
        owner.contentRows.set(op.targetPath, rows.add({ payloadKind: "owner_content", path: this.#payloadPath(ordinal), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384 }, ordinal));
      }
    }
  }

  #digestRow(content: PayloadRowV1, rows: RowLedger): PayloadRowV1 {
    const bytes = updateFoundationStagedDigestBytes(content.sha256);
    const ordinal = rows.ordinal();
    return rows.add({ payloadKind: "foundation_digest", path: this.#payloadPath(ordinal), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384, source: { kind: "plan_derived", role: "foundation_staged_digest", contentHash: content.sha256, value: `${content.sha256}\n`, valueBytes: 64 } }, ordinal);
  }

  /**
   * Paired forward/compensation refs over `changed` in path order, at most 256 mutations each.
   * Refs are ordered by ID, so the chunks go to the forward IDs in that order.
   */
  #foundationRefs(slot: FoundationSlotsV1, forwardMutations: readonly UpdateFoundationMutationInputV1[], compensationOf: (mutation: UpdateFoundationMutationInputV1) => UpdateFoundationMutationInputV1, rows: RowLedger): readonly UpdateFoundationParticipantRefV2[] {
    const chunks: UpdateFoundationMutationInputV1[][] = [];
    for (let index = 0; index < forwardMutations.length; index += MAX_FOUNDATION_MUTATIONS) chunks.push(forwardMutations.slice(index, index + MAX_FOUNDATION_MUTATIONS));
    const pairs = chunks.map(() => ({ forward: this.#ids.take("tx"), compensation: this.#ids.take("tx") }));
    pairs.sort((left, right) => compareUtf8(left.forward, right.forward));
    const refs: UpdateFoundationParticipantRefV2[] = [];
    chunks.forEach((chunk, index) => {
      const pair = pairs[index] as { readonly forward: AllocatedLifecycleIdV1<"tx">; readonly compensation: AllocatedLifecycleIdV1<"tx"> };
      for (const [id, role, mutations, kind] of [
        [pair.forward, { kind: "forward", compensationId: pair.compensation }, chunk, slot.forward],
        [pair.compensation, { kind: "compensation", forwardId: pair.forward }, [...chunk].reverse().map(compensationOf), slot.compensation],
      ] as const) {
        refs.push(this.#foundationRef(id, kind, role, mutations, rows));
      }
    });
    return refs.sort((left, right) => compareUtf8(left.id, right.id));
  }

  #foundationRef(id: AllocatedLifecycleIdV1<"tx">, slot: UpdateFoundationParticipantRefV2["slot"], role: UpdateFoundationParticipantRefV2["role"], mutations: readonly UpdateFoundationMutationInputV1[], rows: RowLedger): UpdateFoundationParticipantRefV2 {
    const journalOrdinal = rows.ordinal();
    const { ref, initialJournalBytes } = composed("update_composition_foundation", () => buildUpdateFoundationParticipantRef({ productHome: this.#deps.productHome, coordinatorId: this.#coordinatorId, id, slot, role, mutations, journalOrdinal, createdAt: this.#plannedAt }));
    const value = new TextDecoder().decode(initialJournalBytes);
    rows.add({
      payloadKind: "foundation_initial",
      path: ref.initialJournal.staged.path,
      bytes: initialJournalBytes.byteLength,
      sha256: sha256(initialJournalBytes),
      mode: 384,
      source: { kind: "plan_derived", role: "foundation_initial_journal", participant: ref, foundationPlanHash: ref.planHash, plannedBytesHash: ref.initialJournal.plannedBytesHash, value, valueBytes: initialJournalBytes.byteLength - 1 },
    }, journalOrdinal);
    return ref;
  }

  #staged(content: PayloadRowV1, rows: RowLedger): { readonly content: UpdatePayloadRefV1; readonly digest: UpdatePayloadRefV1 } {
    return { content: this.#payloadRef(content), digest: this.#payloadRef(this.#digestRow(content, rows)) };
  }

  #ownerFoundation(owner: OwnerBuildV1, rows: RowLedger, slots: FoundationSlotsV1): readonly UpdateFoundationParticipantRefV2[] {
    const changed = owner.ops.filter((op) => op.operation !== "keep");
    const byTarget = new Map(changed.map((op) => [op.targetPath as string, op]));
    const forward = changed.map((op): UpdateFoundationMutationInputV1 => {
      const before = op.before.state === "file" ? op.before.hash : null;
      if (op.operation === "remove") return { targetPath: op.targetPath, operation: "remove", expectedBeforeHash: before, content: null, digest: null };
      const content = owner.contentRows.get(op.targetPath) ?? refuse("update_composition_content", EXIT_CODES.recoveryRequired, op.targetPath);
      return { targetPath: op.targetPath, operation: op.operation === "create" ? "create" : "replace", expectedBeforeHash: before, ...this.#staged(content, rows) };
    });
    const compensation = (mutation: UpdateFoundationMutationInputV1): UpdateFoundationMutationInputV1 => {
      const op = byTarget.get(mutation.targetPath) as OwnerOpV1;
      const written = mutation.content?.sha256 ?? null;
      if (op.operation === "create") return { targetPath: mutation.targetPath, operation: "remove", expectedBeforeHash: written, content: null, digest: null };
      const preimage = owner.preimageRows.get(mutation.targetPath) ?? refuse("update_composition_preimage", EXIT_CODES.recoveryRequired, mutation.targetPath);
      return { targetPath: mutation.targetPath, operation: op.operation === "remove" ? "create" : "replace", expectedBeforeHash: written, ...this.#staged(preimage, rows) };
    };
    return this.#foundationRefs(slots, forward, compensation, rows);
  }

  #inverseProjections(): Map<string, RetainedOwnerInverseProjectionV1> {
    const found = new Map<string, RetainedOwnerInverseProjectionV1>();
    for (const leaf of this.#input.materialized.candidate.materialization.inversePlanProjections) {
      if (leaf.kind === "owner_inverse") found.set(leaf.id, decodeCanonicalJson(encoder.encode(leaf.projection), MAXIMUM_LEAF_PLAN_BYTES) as unknown as RetainedOwnerInverseProjectionV1);
    }
    return found;
  }

  #ownerPlan(owner: OwnerBuildV1, inverse: ReadonlyMap<string, RetainedOwnerInverseProjectionV1>, effectId: AllocatedLifecycleIdV1<"oe"> | null, operation: "update_apply" | "update_rollback" = "update_apply"): void {
    const projection = inverse.get(owner.id) ?? refuse("update_composition_inverse", EXIT_CODES.recoveryRequired);
    const currentPartition = this.#source.input.home.manifest.artifacts.filter((row) => row.owner === owner.draft.owner);
    const drafted = operation === "update_rollback" ? projection.externalEffects.length : owner.draft.externalEffects.length;
    const effect = drafted > 0 && effectId !== null ? this.#effectPlan(owner, effectId, projection.externalEffects[0], operation) : null;
    owner.effect = effect;
    const plan: OwnerUpdatePlanV1 = {
      schemaVersion: 1,
      id: owner.id,
      coordinatorId: this.#coordinatorId,
      owner: owner.draft.owner,
      currentPartitionHash: ownerCurrentPartitionHash(owner.draft.owner, currentPartition),
      operations: owner.ops.map((op): PersistedOwnerChangeOperationV1 => ({
        operation: op.operation,
        owner: owner.draft.owner,
        targetPath: op.targetPath,
        expectedBefore: op.before,
        afterArtifact: op.after,
        content: op.operation === "create" || op.operation === "replace" ? this.#payloadRef(owner.contentRows.get(op.targetPath) as PayloadRowV1) : null,
      })),
      foundation: owner.foundation,
      externalEffects: effect === null ? [] : [effect.ref],
      inverseOperationHash: retainedOwnerInverseOperationHash(projection),
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
    };
    owner.plan = composed("update_composition_owner", () => validateOwnerUpdatePlan(plan, { productHome: this.#deps.productHome, currentPartition, operation }));
    owner.ref = leafRef(this.#root, "owner_update", owner.id, owner.plan);
    if (effect !== null) composed("update_composition_effect", () => validateOwnerExternalEffectPlan(effect.plan, owner.plan as OwnerUpdatePlanV1));
  }

  /**
   * The Codex refresh: policy and projection hashes are the retained inverse's, so rollback replays
   * the same child with the two states swapped, over the restored (previous) tree.
   */
  #effectPlan(owner: OwnerBuildV1, id: AllocatedLifecycleIdV1<"oe">, retained: RetainedExternalEffectInversePlanV1 | undefined, operation: "update_apply" | "update_rollback"): NonNullable<OwnerBuildV1["effect"]> {
    if (retained === undefined) return refuse("update_codex_unavailable", EXIT_CODES.capabilityUnavailable);
    const rollback = operation === "update_rollback";
    const plan: OwnerExternalEffectPlanV1 = {
      schemaVersion: 1,
      id,
      coordinatorId: this.#coordinatorId,
      kind: "codex_registration_refresh",
      owner: "codex",
      providerProtocol: retained.providerProtocol,
      fileParticipantIds: owner.foundation.filter((ref) => ref.role.kind === "forward").map((ref) => ref.id),
      expectedStateHash: rollback ? retained.expectedCurrentStateHash : retained.restoreStateHash,
      proposedStateHash: rollback ? retained.restoreStateHash : retained.expectedCurrentStateHash,
      processPolicy: retained.processPolicy,
      processPolicyHash: ownerExternalEffectProcessPolicyHash(retained.processPolicy),
      forwardPayloads: [],
      compensationPayloads: [],
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
      maximumEvidenceBytes: 1_048_576,
    };
    return { plan, ref: leafRef(this.#root, "owner_external_effect", id, plan) };
  }

  // -------------------------------------------------------------------------------------------
  // Migrations.

  #migrationPlans(byBlob: ReadonlyMap<number, PayloadRowV1>, rows: RowLedger): readonly SchemaMigrationPlanV1[] {
    const { materialized } = this.#input;
    const { draft } = materialized.run;
    const tokenPaths = materialized.snapshot.tokenPaths as ReadonlyMap<PlannerPathTokenV1, CanonicalProductStatePathV1>;
    const payloads = new Map([...byBlob].map(([ordinal, row]) => [ordinal, this.#payloadRef(row)]));
    const foundation = new Map<SchemaMigrationIdV1, readonly UpdateFoundationParticipantRefV2[]>();
    for (const migration of draft.migrations) {
      const forward = migration.mutations.map((mutation): UpdateFoundationMutationInputV1 => {
        const targetPath = mutation.path.domain === "brain" ? path(`${this.#deps.brainRoot}/${mutation.path.path}`) : (tokenPaths.get(mutation.path.token) ?? refuse("update_planner_output_invalid", EXIT_CODES.securityRefusal));
        return { targetPath, operation: "replace", expectedBeforeHash: mutation.beforeHash, ...this.#staged(byBlob.get(mutation.afterBlob.ordinal) as PayloadRowV1, rows) };
      }).sort((left, right) => compareUtf8(left.targetPath, right.targetPath));
      const inverseOf = new Map(migration.mutations.map((mutation) => {
        const targetPath = mutation.path.domain === "brain" ? `${this.#deps.brainRoot}/${mutation.path.path}` : (tokenPaths.get(mutation.path.token) as string);
        return [targetPath, byBlob.get(mutation.inverseBlob.ordinal) as PayloadRowV1] as const;
      }));
      foundation.set(migration.id, this.#foundationRefs({ forward: "schema_forward", compensation: "schema_forward" }, forward, (mutation) => ({
        targetPath: mutation.targetPath,
        operation: "replace",
        expectedBeforeHash: mutation.content?.sha256 ?? null,
        ...this.#staged(inverseOf.get(mutation.targetPath) as PayloadRowV1, rows),
      }), rows));
    }
    return composed("update_composition_migration", () => materializeSchemaMigrations(draft.migrations, {
      coordinatorId: this.#coordinatorId,
      productHome: this.#deps.productHome,
      brainRoot: this.#deps.brainRoot,
      tokenPaths,
      state: schemaMigrationInitialState(materialized.snapshot.request, draft.ownerPlans),
      outputBlobs: materialized.run.outputBlobs,
      payloads,
      foundation,
    }).map((row) => row.plan));
  }

  // -------------------------------------------------------------------------------------------
  // Rollback payload (§9.2, §10.1).

  #rollbackPayload(owners: readonly OwnerBuildV1[], migrations: readonly SchemaMigrationPlanV1[], migrationRefs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[], stepOwners: readonly UpdateStepOwnerV1[], payloadId: RollbackPayloadIdV1, executionBindingHash: LowerHexSha256): PreparedRollbackPayloadV1 {
    const { candidate } = this.#input.materialized;
    const { current, target } = this.#input.inputs;
    const sourcePlanHashes = candidate.materialization.inversePlanProjections.map((leaf) => {
      if (leaf.kind === "owner_inverse") return (owners.find((owner) => owner.id === leaf.id)?.ref ?? refuse("update_composition_inverse", EXIT_CODES.recoveryRequired)).hash;
      const index = migrations.findIndex((plan) => plan.id === leaf.id);
      return (migrationRefs[index] ?? refuse("update_composition_inverse", EXIT_CODES.recoveryRequired)).hash;
    });
    // §10.2's rollback step template over the same owners and migrations; only its hash is retained.
    const rollbackSteps = deriveUpdateSteps({ operation: "update_rollback", owners: owners.map((owner) => owner.ref), migrations: migrationRefs } as unknown as UpdateExecutionPlanV1, stepOwners);
    return composed("update_composition_rollback_payload", () => buildRollbackPayload(candidate, {
      payloadId,
      executionBindingHash,
      installed: target,
      previous: current,
      productHome: this.#deps.productHome,
      sourcePlanHashes,
      exactStepListHash: rollbackStepListHash(rollbackSteps),
      createdAt: this.#plannedAt,
    }));
  }

  /**
   * One authority per inventory row, walked in `prepareInverse`'s order: owner preimages, migration
   * preimages as their inverse frames, then the retained leaves themselves.
   */
  #rollbackSourceEntries(owners: readonly OwnerBuildV1[], migrations: readonly SchemaMigrationPlanV1[], migrationRefs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[], payload: PreparedRollbackPayloadV1): readonly UpdateConstructionRollbackSourceEntryV1[] {
    const { materialized } = this.#input;
    const sources: UpdateConstructionRollbackEntrySourceV1[] = [];
    const tokenPath = (token: PlannerPathTokenV1): string => materialized.snapshot.tokenPaths.get(token) as string;
    for (const draft of materialized.run.draft.ownerPlans) {
      const owner = owners.find((candidate) => candidate.draft === draft) as OwnerBuildV1;
      for (const operation of draft.proposedOperations) {
        if (operation.operation === "keep" || operation.operation === "create") continue;
        const operationOrdinal = owner.ops.findIndex((op) => op.targetPath === tokenPath(operation.target.token));
        const op = owner.ops[operationOrdinal];
        if (op?.observed === null || op === undefined || op.before.state !== "file") return refuse("update_composition_inverse", EXIT_CODES.recoveryRequired);
        if (op.before.bytes === 0) continue;
        sources.push({ kind: "guarded_preimage", authority: { kind: "owner_operation_before", ownerPlan: owner.ref as ImmutableUpdatePlanRefV1<"owner_update">, operationOrdinal }, path: op.targetPath, ownerUid: op.observed.entry.ownerUid as EffectiveUidV1, mode: op.before.mode, nlink: 1, bytes: op.before.bytes, sha256: op.before.hash, dev: op.before.dev, ino: op.before.ino });
      }
    }
    for (const migration of materialized.run.draft.migrations) {
      for (const mutation of migration.mutations) sources.push({ kind: "planner_output", ordinal: mutation.inverseBlob.ordinal });
    }
    for (const leaf of payload.leaves) {
      const value = new TextDecoder().decode(leaf.bytes) as CanonicalJsonV1;
      if (leaf.ref.kind === "owner_inverse") {
        const owner = owners.find((candidate) => candidate.id === leaf.ref.id) as OwnerBuildV1;
        sources.push({ kind: "plan_derived", role: "owner_inverse_plan", plan: owner.ref as ImmutableUpdatePlanRefV1<"owner_update">, value, valueBytes: leaf.bytes.byteLength - 1 });
      } else {
        const ref = migrationRefs[migrations.findIndex((plan) => plan.id === leaf.ref.id)] as ImmutableUpdatePlanRefV1<"schema_migration">;
        sources.push({ kind: "plan_derived", role: "schema_migration_inverse_plan", plan: ref, value, valueBytes: leaf.bytes.byteLength - 1 });
      }
    }
    const inventory = payload.inventory.entries;
    if (sources.length !== inventory.length) refuse("update_composition_inverse", EXIT_CODES.recoveryRequired);
    return inventory.map((entry, ordinal) => {
      const source = sources[ordinal] as UpdateConstructionRollbackEntrySourceV1;
      return { ordinal, entry, source, sourceProjectionHash: rollbackEntrySourceProjectionHash(source) };
    });
  }

  #rollbackStatePlan(published: RollbackPayloadIdentityV1, sourceRef: ImmutableUpdatePlanRefV1<"rollback_payload_source">): RollbackPayloadStatePlanV1 {
    const retained = this.#retainedIdentity();
    return composed("update_composition_rollback_state", () => validateRollbackPayloadStatePlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("rollback_payload"),
      coordinatorId: this.#coordinatorId,
      retainedBefore: retained,
      publish: published,
      source: { stagingPlan: sourceRef, readyEvidencePath: rollbackPayloadSourcePaths(this.#root, published.payloadId).ready },
      retainAfter: published,
      retireAtTerminal: retained === null ? [] : [retained],
      publicationInventoryHash: published.inventoryHash,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#root));
  }

  #retainedIdentity(): RollbackPayloadIdentityV1 | null {
    const record = this.#input.home.rollback;
    const retained = this.#input.inputs.retained;
    if (record === null) return null;
    if (retained === null) return refuse("update_rollback_evidence_invalid", EXIT_CODES.recoveryRequired);
    return {
      payloadId: record.payloadId,
      root: rollbackPayloadRoot(this.#deps.productHome, record.payloadId),
      rollbackBindingHash: record.rollbackBindingHash,
      inversePlanHash: record.inversePlanHash,
      inventoryHash: record.payloadInventoryHash,
      entryCount: retained.payload.entryCount,
      aggregateBytes: retained.payload.aggregateBytes,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Manifests (§9.3 step 7, P3).

  async #metadataPresence(target: ReleaseIdentityV1): Promise<readonly (ObservedPathV1 | null)[]> {
    const signed = [target.delegationHash, target.releaseIndexHash, target.bundleManifestHash];
    const found: (ObservedPathV1 | null)[] = [];
    for (const [ordinal, hash] of signed.entries()) {
      const observed = await this.#deps.observe(bundleMetadataPath(target, ordinal));
      if (observed !== null && observed.sha256 !== hash) refuse("update_release_metadata_conflict", EXIT_CODES.recoveryRequired, bundleMetadataPath(target, ordinal));
      found.push(observed);
    }
    return found;
  }

  #baseRow(target: CanonicalAbsolutePathV1, source: string): ManagedArtifactCommonV2 {
    return { owner: "core", path: target, productVersion: this.#input.inputs.target.version, existedBefore: false, beforeHash: null, backupRelativePath: null, source: source as ManagedArtifactV2["source"], mergeStrategy: "dedicated", verifiedAt: this.#plannedAt };
  }

  #directoryRow(target: string): ManagedArtifactV2 {
    return { ...this.#baseRow(path(target), "generated/directory"), kind: "directory", verification: { mode: "content" } };
  }

  #fileRow(target: string, hash: LowerHexSha256, source: string): ManagedArtifactV2 {
    return { ...this.#baseRow(path(target), source), kind: "file", verification: { mode: "content", installedHash: hash } };
  }

  /**
   * The concrete owner postimage plus the target bundle, its retained metadata, and the proposed
   * rollback payload partition; the active and trust rows name their new bytes. Any still-retained
   * older set is already in the concrete manifest, which copied every installed row.
   */
  #transitionalManifest(owners: readonly OwnerBuildV1[], payload: PreparedRollbackPayloadV1, active: CanonicalJsonV1, trust: CanonicalJsonV1, metadataPresent: readonly (ObservedPathV1 | null)[]): InstallationManifestV2 {
    const { materialized, inputs } = this.#input;
    const { target } = inputs;
    const rows = new Map(materialized.manifest.artifacts.map((row) => [row.path as string, row]));
    for (const owner of owners) for (const op of owner.ops) if (op.content?.kind === "registration" && op.after !== null) rows.set(op.targetPath, op.after);
    const stateDir = `${this.#deps.productHome}/state`;
    for (const [file, bytes] of [["active-release.json", active], ["release-trust.json", trust]] as const) {
      const row = rows.get(`${stateDir}/${file}`);
      // A home whose manifest never tracked the record keeps it untracked.
      if (row === undefined) continue;
      if (row.kind !== "file" || row.verification.mode !== "schema") return refuse("update_manifest_state_row", EXIT_CODES.recoveryRequired, `${stateDir}/${file}`);
      rows.set(row.path, { ...row, productVersion: target.version, verifiedAt: this.#plannedAt, verification: { ...row.verification, installedHash: sha256(bytes) } });
    }
    const add = (row: ManagedArtifactV2): void => {
      if (!rows.has(row.path)) rows.set(row.path, row);
    };
    add(this.#directoryRow(dirname(target.bundleRoot)));
    add(this.#directoryRow(target.bundleRoot));
    for (const entry of inputs.bundleManifest.entries) {
      const at = `${target.bundleRoot}/${entry.path}`;
      add(entry.kind === "directory" ? this.#directoryRow(at) : this.#fileRow(at, entry.sha256, `generated/release/${entry.path}`));
    }
    metadataPresent.forEach((observed, ordinal) => {
      if (observed === null) add(this.#fileRow(bundleMetadataPath(target, ordinal), [target.delegationHash, target.releaseIndexHash, target.bundleManifestHash][ordinal] as LowerHexSha256, "generated/release_metadata"));
    });
    const root = payload.identity.root;
    for (const structure of rollbackPayloadStructures(root)) add(this.#directoryRow(structure.path));
    add(this.#fileRow(rollbackPayloadMetadataPath(root, 0), payload.identity.inversePlanHash, "generated/rollback"));
    add(this.#fileRow(rollbackPayloadMetadataPath(root, 1), payload.identity.inventoryHash, "generated/rollback"));
    for (const entry of payload.inventory.entries) add(this.#fileRow(`${root}/${entry.path}`, entry.sha256, "generated/rollback"));
    return composed("update_composition_manifest", () => this.#deps.admitManifest({
      schemaVersion: 2,
      productVersion: target.version,
      installedAt: this.#input.home.manifest.installedAt,
      artifacts: [...rows.values()].sort(compareManifestRows),
    }));
  }

  /** §9.3 step 13: the older rollback bundle, its unshared metadata, and its payload, in kind/root order. */
  #retirementEntries(transitional: InstallationManifestV2): readonly RetirementInventoryRefV1[] {
    const record = this.#input.home.rollback;
    if (record === null) return [];
    const { current, target } = this.#input.inputs;
    const previous = record.previous;
    if (previous.bundleRoot === target.bundleRoot || previous.bundleRoot === current.bundleRoot) refuse("update_rollback_target_retained", EXIT_CODES.recoveryRequired, previous.bundleRoot);
    const leafCount = (root: string): number => transitional.artifacts.filter((row) => under(row.path, root)).length;
    const kept = (ordinal: number): readonly LowerHexSha256[] => [current, target].map((release) => [release.delegationHash, release.releaseIndexHash, release.bundleManifestHash][ordinal] as LowerHexSha256);
    const payloadRoot = rollbackPayloadRoot(this.#deps.productHome, record.payloadId);
    const entries: RetirementInventoryRefV1[] = [
      { kind: "bundle", root: previous.bundleRoot, inventoryHash: previous.bundleManifestHash, leafCount: leafCount(previous.bundleRoot) },
      ...[previous.delegationHash, previous.releaseIndexHash, previous.bundleManifestHash].flatMap((hash, ordinal): RetirementInventoryRefV1[] => {
        if (kept(ordinal).includes(hash)) return [];
        const root = bundleMetadataPath(previous, ordinal);
        return [{ kind: "metadata", root, inventoryHash: hash, leafCount: 1 }];
      }),
      { kind: "rollback_payload", root: payloadRoot, inventoryHash: record.payloadInventoryHash, leafCount: leafCount(payloadRoot) },
    ];
    return entries.sort((left, right) => RETIREMENT_KINDS.indexOf(left.kind) - RETIREMENT_KINDS.indexOf(right.kind) || compareUtf8(left.root, right.root));
  }

  #retirementPlan(entries: readonly RetirementInventoryRefV1[], transitional: InstallationManifestV2, set: UpdateTerminalRetirementPlanV1["set"] = "prior_rollback"): UpdateTerminalRetirementPlanV1 {
    return composed("update_composition_retirement", () => validateUpdateTerminalRetirementPlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("retirement"),
      coordinatorId: this.#coordinatorId,
      set,
      transitionalManifestHash: sha256(encoder.encode(canonical(transitional))),
      entries,
      maximumLeaves: entries.reduce((sum, entry) => sum + entry.leafCount, 0),
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
    }, this.#root));
  }

  async #manifestBefore(): Promise<ObservedPathV1> {
    const manifestPath = path(`${this.#deps.productHome}/installation-manifest.json`);
    const observed = await this.#deps.observe(manifestPath);
    if (observed?.entry.kind !== "regular_file" || observed.sha256 === null) return refuse("update_state_changed", EXIT_CODES.operationalFailure, manifestPath);
    return observed;
  }

  #manifestAfterRow(id: ManifestParticipantIdV1, manifest: InstallationManifestV2, rows: RowLedger): PayloadRowV1 {
    const bytes = encoder.encode(canonical(manifest));
    if (bytes.byteLength > MANIFEST_BYTES_MAXIMUM * 4) refuse("update_manifest_oversized", EXIT_CODES.capabilityUnavailable);
    return rows.add({ payloadKind: "state_after", path: deriveManifestPayloadPath(this.#deps.productHome, this.#coordinatorId as string as SafeReasonCodeV1, id as string as SafeReasonCodeV1), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384, value: canonical(manifest) });
  }

  #rowValue(row: PayloadRowV1): CanonicalJsonV1 {
    return row.value ?? refuse("update_composition_source", EXIT_CODES.recoveryRequired, row.path);
  }

  #stateRow(role: "release_trust" | "active_release" | "rollback_record", id: SafeReasonCodeV1, value: CanonicalJsonV1, rows: RowLedger): PayloadRowV1 {
    const bytes = encoder.encode(value);
    return rows.add({ payloadKind: "state_after", path: this.#statePayloadPath(role, id), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384, value });
  }

  #metadataRows(present: readonly (ObservedPathV1 | null)[], rows: RowLedger): readonly (PayloadRowV1 | null)[] {
    return present.map((observed, ordinal) => {
      if (observed !== null) return null;
      const value = this.#input.materialized.signedMetadata[ordinal] as CanonicalJsonV1;
      const bytes = encoder.encode(value);
      return rows.add({ payloadKind: "state_after", path: this.#statePayloadPath("release_metadata", parseSafeReasonCode(`release_metadata_${String(ordinal)}`)), bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384, source: { kind: "plan_derived", role: "release_metadata_after", metadata: ordinal as 0 | 1 | 2, value, valueBytes: bytes.byteLength - 1 } });
    });
  }

  #manifestAdmission(plan: { readonly participantId: ManifestParticipantIdV1; readonly bindings: ManifestStatePlanV1["bindings"] }, foundationIds: readonly string[]): ManifestStatePlanAdmissionContextV1 {
    return updateManifestAdmission({ productHome: this.#deps.productHome, evidence: this.#deps.evidence, coordinatorId: this.#coordinatorId, foundationTransactionIds: foundationIds, externalEffects: plan.bindings.externalEffects, updatePayloadIdentity: () => ({ dev: parseUInt64Decimal("0"), ino: parseUInt64Decimal("0") }) });
  }

  #manifestPlans(ids: readonly [ManifestParticipantIdV1, ManifestParticipantIdV1], rows: readonly [PayloadRowV1, PayloadRowV1], owners: readonly OwnerBuildV1[], before: ObservedPathV1): readonly [ManifestStatePlanV1, ManifestStatePlanV1] {
    const manifestPath = path(`${this.#deps.productHome}/installation-manifest.json`);
    const foundationIds = updateManifestFoundationIds(owners.map((owner) => owner.plan as OwnerUpdatePlanV1));
    const effects: ManifestExternalEffectRefV1[] = owners.flatMap((owner) => (owner.effect === null ? [] : [{ kind: "codex_registration", id: owner.effect.plan.id, planHash: owner.effect.ref.hash }]));
    const payloadRef = (row: PayloadRowV1, id: ManifestParticipantIdV1) => ({ kind: "update_expected", coordinatorId: this.#coordinatorId, ordinal: row.ordinal, path: deriveManifestPayloadPath(this.#deps.productHome, this.#coordinatorId as string as SafeReasonCodeV1, id as string as SafeReasonCodeV1), hash: row.sha256, bytes: row.bytes, mode: 0o600 }) as const;
    const present = (row: PayloadRowV1, id: ManifestParticipantIdV1) => ({ state: "present", hash: row.sha256, bytes: payloadRef(row, id), ownerUid: this.#deps.effectiveUid, mode: 0o600, nlink: 1, size: parseUInt64Decimal(String(row.bytes)), dev: null, ino: null }) as const;
    const plan = (index: 0 | 1, manifestBefore: ManifestStatePlanV1["before"], ids2: readonly string[], refs: readonly ManifestExternalEffectRefV1[]): ManifestStatePlanV1 => {
      const participantId = ids[index];
      const value = {
        schemaVersion: 1,
        participantId,
        envelope: { kind: "lifecycle", id: this.#coordinatorId },
        bindings: { foundationTransactions: { count: ids2.length, orderedIdsHash: foundationBindingsHash(ids2) }, externalEffects: refs },
        manifestPath,
        tombstonePath: path(`${dirname(manifestPath)}/.installation-manifest.${participantId}.json.tombstone`),
        before: manifestBefore,
        after: present(rows[index], participantId),
        maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
        maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
      } as unknown as ManifestStatePlanV1;
      return composed("update_composition_manifest_plan", () => validateManifestStatePlan(value, this.#manifestAdmission(value, ids2)));
    };
    const observedBefore = { state: "present", hash: before.sha256 as LowerHexSha256, bytes: null, ownerUid: before.entry.ownerUid, mode: 0o600, nlink: 1, size: before.entry.size, dev: before.entry.dev, ino: before.entry.ino } as const;
    const transitional = plan(0, observedBefore, foundationIds, effects);
    // P2(b): the terminal plan's `before` names the transitional `after` bytes and carries no inode.
    const terminal = plan(1, present(rows[0], ids[0]), [], []);
    return [transitional, terminal];
  }

  // -------------------------------------------------------------------------------------------
  // Bundle and canonical state plans.

  #bundleSourcePlan(): BundleSourceStagingPlanV1 {
    const { entries } = this.#input.inputs.bundleManifest;
    const id = parseSafeReasonCode("bundle_source");
    const paths = bundleSourcePaths(this.#root, id);
    return composed("update_composition_bundle_source", () => validateBundleSourceStagingPlan({
      schemaVersion: 1,
      id,
      coordinatorId: this.#coordinatorId,
      sourceRoot: paths.sourceRoot,
      evidenceRoot: paths.evidenceRoot,
      sourceRootBefore: { state: "absent" },
      entries,
      inventoryHash: bundleInventoryHash(entries),
      aggregateBytes: bundleAggregateBytes(entries),
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#root));
  }

  #bundlePublicationPlan(sourceRef: ImmutableUpdatePlanRefV1<"bundle_source_staging">, present: readonly (ObservedPathV1 | null)[], rows: readonly (PayloadRowV1 | null)[]): BundlePublicationPlanV1 {
    const { target, bundleManifest } = this.#input.inputs;
    const metadata = present.map((observed, ordinal): BundleMetadataStatePlanV1 => {
      const id = parseSafeReasonCode(`release_metadata_${String(ordinal)}`);
      const common = { schemaVersion: 1, id, coordinatorId: this.#coordinatorId, role: "release_metadata", path: bundleMetadataPath(target, ordinal), tombstonePath: path(`${this.#root}/update/evidence/tombstones/${id}.json`), reversal: "reversible", maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES, maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES } as const;
      if (observed !== null) {
        const state = { state: "present", hash: observed.sha256 as LowerHexSha256, ownerUid: observed.entry.ownerUid as EffectiveUidV1, mode: 384, nlink: 1, size: Number(observed.entry.size) } as const;
        return { ...common, before: { ...state, payload: null, dev: observed.entry.dev, ino: observed.entry.ino }, after: { ...state, payload: null } };
      }
      const row = rows[ordinal] as PayloadRowV1;
      const payload = { kind: "update_expected", coordinatorId: this.#coordinatorId, ordinal: row.ordinal, path: this.#statePayloadPath("release_metadata", id), hash: row.sha256, bytes: row.bytes, mode: 384 } as const;
      return { ...common, before: { state: "absent" }, after: { state: "present", hash: row.sha256, payload, ownerUid: this.#deps.effectiveUid as EffectiveUidV1, mode: 384, nlink: 1, size: row.bytes } };
    });
    return composed("update_composition_bundle", () => validateBundlePublicationPlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("bundle"),
      coordinatorId: this.#coordinatorId,
      action: "publish_target",
      target,
      source: { kind: "staged_source", stagingPlan: sourceRef, readyEvidencePath: bundleSourcePaths(this.#root, sourceRef.id).ready },
      targetRootBefore: { state: "absent" },
      metadata,
      entries: bundleManifest.entries,
      inventoryHash: bundleInventoryHash(bundleManifest.entries),
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#root));
  }

  /**
   * One canonical state file. An empty reservation is no record (§6.4), so it plans as absent and
   * the dispatcher releases it before the first transition.
   */
  async #statePlan(role: "release_trust" | "active_release" | "rollback_record", id: SafeReasonCodeV1, file: string, row: PayloadRowV1, reversal: CanonicalStateFilePlanV1["reversal"]): Promise<CanonicalStateFilePlanV1> {
    const target = path(`${this.#deps.productHome}/state/${file}`);
    const observed = await this.#deps.observe(target);
    let before: CanonicalStateFilePlanV1["before"] = { state: "absent" };
    if (observed !== null && observed.entry.size !== "0") {
      if (observed.entry.kind !== "regular_file" || observed.sha256 === null) return refuse("update_state_changed", EXIT_CODES.operationalFailure, target);
      before = { state: "present", hash: observed.sha256, payload: null, ownerUid: observed.entry.ownerUid as EffectiveUidV1, mode: 384, nlink: 1, size: Number(observed.entry.size), dev: observed.entry.dev, ino: observed.entry.ino };
    }
    const payload = { kind: "update_expected", coordinatorId: this.#coordinatorId, ordinal: row.ordinal, path: this.#statePayloadPath(role, id), hash: row.sha256, bytes: row.bytes, mode: 384 } as const;
    return composed("update_composition_state", () => validateCanonicalStateFilePlan({
      schemaVersion: 1,
      id,
      coordinatorId: this.#coordinatorId,
      role,
      path: target,
      tombstonePath: path(`${dirname(target)}/.${basename(target)}.${this.#coordinatorId}.tombstone`),
      before,
      after: { state: "present", hash: row.sha256, payload, ownerUid: this.#deps.effectiveUid as EffectiveUidV1, mode: 384, nlink: 1, size: row.bytes },
      reversal,
      maximumPlanBytes: MAXIMUM_LEAF_PLAN_BYTES,
      maximumJournalBytes: MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
    }, this.#deps.productHome));
  }

  #verificationPlan(owners: readonly OwnerBuildV1[], migrations: readonly SchemaMigrationPlanV1[], migrationRefs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[], transitional: InstallationManifestV2, release?: { readonly target: ReleaseIdentityV1; readonly bundleManifest: ReleaseBundleManifestV1 }): TargetVerificationPlanV1 {
    const { target, bundleManifest } = release ?? this.#input.inputs;
    const context = {
      release: target,
      manifestHash: sha256(encoder.encode(canonical(transitional))),
      owners: owners.map((owner) => ({ ref: owner.ref as ImmutableUpdatePlanRefV1<"owner_update">, plan: owner.plan as OwnerUpdatePlanV1, effects: owner.effect === null ? [] : [owner.effect] })),
      migrations: migrations.map((plan, index) => ({ ref: migrationRefs[index] as ImmutableUpdatePlanRefV1<"schema_migration">, plan })),
    };
    return composed("update_composition_verification", () => validateTargetVerificationPlan({
      schemaVersion: 1,
      id: parseSafeReasonCode("verification"),
      coordinatorId: this.#coordinatorId,
      release: target,
      verifierEntrypoint: bundleManifest.verifierEntrypoint,
      manifestHash: context.manifestHash,
      ownerPostimagesHash: ownerPostimagesHash(context.owners),
      migrationPostimagesHash: migrationPostimagesHash(context.migrations),
      inputBytes: 268_435_456,
      stdoutBytes: 65_536,
      stderrBytes: 65_536,
      idleMilliseconds: 30_000,
      wallMilliseconds: 300_000,
      processCount: 1,
      readOnly: true,
    }, context));
  }

  // -------------------------------------------------------------------------------------------
  // Sources, journals, recovery records.

  #resolveOwnerSources(owner: OwnerBuildV1): void {
    for (const op of owner.ops) {
      const row = owner.contentRows.get(op.targetPath);
      if (row !== undefined && op.content?.kind === "bundle") {
        row.source = this.#bundleSource(op.content.entry);
      } else if (row !== undefined && op.content?.kind === "registration") {
        row.source = { kind: "plan_derived", role: "codex_registration_after", plan: owner.ref as ImmutableUpdatePlanRefV1<"owner_update">, value: op.content.value, valueBytes: row.bytes - 1 };
      }
      const preimage = owner.preimageRows.get(op.targetPath);
      if (preimage === undefined || op.before.state !== "file" || op.observed === null) continue;
      const forward = owner.foundation.find((ref) => ref.role.kind === "forward" && ref.mutations.some((mutation) => mutation.targetPath === op.targetPath)) as UpdateFoundationParticipantRefV2;
      preimage.source = {
        kind: "guarded_preimage",
        authority: { kind: "foundation_expected_before", participant: forward, mutationOrdinal: forward.mutations.findIndex((mutation) => mutation.targetPath === op.targetPath) },
        path: op.targetPath,
        ownerUid: op.observed.entry.ownerUid as EffectiveUidV1,
        mode: op.before.mode,
        nlink: 1,
        bytes: op.before.bytes,
        sha256: op.before.hash,
        dev: op.before.dev,
        ino: op.before.ino,
      };
    }
  }

  /**
   * A target-bundle file staged from the admitted keg's bundle (D84 K2), observed now under the lock.
   * `sourceMode` is the entry's own mode, which the row must equal (construction's `matches`); the
   * keg file's `0644`/`0755` is checked by class where the bytes are copied (`copyVerified`).
   */
  #bundleSource(entry: Extract<ReleaseBundleEntryV1, { readonly kind: "file" }>): UpdateConstructionPayloadSourceV1 {
    const source = this.#packageSourceIdentity;
    const file = source.files.get(entry.path);
    if (file === undefined || source.root === null) return refuse("update_bundle_source_changed", EXIT_CODES.securityRefusal, entry.path);
    return {
      kind: "signed_bundle_entry",
      release: this.#input.inputs.target,
      root: this.#input.inputs.verified.root,
      rootDev: source.root.dev,
      rootIno: source.root.ino,
      inventoryHash: bundleInventoryHash(this.#input.inputs.bundleManifest.entries),
      relativePath: entry.path,
      sourceBytes: Number(entry.bytes),
      sourceHash: entry.sha256,
      sourceMode: entry.mode,
      sourceDev: file.dev,
      sourceIno: file.ino,
    };
  }

  #packageSourceIdentity: { readonly root: LifecycleGuardedEntryV1 | null; readonly files: ReadonlyMap<string, LifecycleGuardedEntryV1> } = { root: null, files: new Map() };

  /** Observes the keg's bundle root and each bundle file an owner row sources, before any row is built. */
  async #observePackageSource(owners: readonly OwnerBuildV1[]): Promise<void> {
    const wanted = owners.flatMap((owner) => owner.ops.flatMap((op) => (op.content?.kind === "bundle" ? [op.content.entry] : [])));
    if (wanted.length === 0) return;
    const root = this.#input.inputs.verified.root;
    const observedRoot = await this.#deps.observe(root);
    if (observedRoot?.entry.kind !== "directory") return refuse("update_bundle_source_changed", EXIT_CODES.securityRefusal, root);
    const files = new Map<string, LifecycleGuardedEntryV1>();
    for (const entry of wanted) {
      const observed = await this.#deps.observe(path(`${root}/${entry.path}`));
      if (observed?.entry.kind !== "regular_file" || observed.sha256 !== entry.sha256) return refuse("update_bundle_source_changed", EXIT_CODES.securityRefusal, entry.path);
      files.set(entry.path, observed.entry);
    }
    this.#packageSourceIdentity = { root: observedRoot.entry, files };
  }

  #payloadFile(row: PayloadRowV1): UpdateConstructionFileInputV1 {
    if (row.source === null) return refuse("update_composition_source", EXIT_CODES.recoveryRequired, row.path);
    return { role: { kind: "payload", payloadKind: row.payloadKind, source: row.source }, path: row.path, bytes: row.bytes, sha256: row.sha256, mode: row.mode };
  }

  #sourceJournalRow(kind: "bundle_source_staging" | "rollback_payload_source", id: SafeReasonCodeV1, bytes: Uint8Array): UpdateConstructionFileInputV1 {
    const at = updateParticipantJournalPath(this.#root, kind, id);
    return { role: { kind: "initial_journal", journalKind: kind, id, finalPath: at }, path: at, bytes: bytes.byteLength, sha256: sha256(bytes), mode: 384 };
  }

  #initialJournals(
    bundle: BundlePublicationPlanV1,
    refs: { readonly bundle: ImmutableUpdatePlanRefV1<"bundle_publication">; readonly rollbackPayload: ImmutableUpdatePlanRefV1<"rollback_payload_state"> },
    owners: readonly OwnerBuildV1[],
    migrations: readonly SchemaMigrationPlanV1[],
    migrationRefs: readonly ImmutableUpdatePlanRefV1<"schema_migration">[],
    states: readonly StateJournalSpecV1[],
    rollbackState: RollbackPayloadStatePlanV1,
    rows: RowLedger,
  ): readonly InitialJournalV1[] {
    const at = this.#plannedAt;
    const header = (id: string, planHash: LowerHexSha256) => ({ schemaVersion: 1, id, coordinatorId: this.#coordinatorId, planHash });
    const values: readonly (readonly [UpdateTargetJournalKindV1, string, LowerHexSha256, unknown])[] = [
      ["bundle_publication", bundle.id, refs.bundle.hash, initialBundlePublicationJournal(bundle, at)],
      ...owners.map((owner) => ["owner_update", owner.id, (owner.ref as ImmutableUpdatePlanRefV1).hash, { ...header(owner.id, (owner.ref as ImmutableUpdatePlanRefV1).hash), phase: "planned", nextForwardFoundation: 0, nextExternalEffect: 0, compensationNext: null, compactionNext: null, createdAt: at, updatedAt: at }] as const),
      ...owners.flatMap((owner) => (owner.effect === null ? [] : [["owner_external_effect", owner.effect.plan.id, owner.effect.ref.hash, { ...header(owner.effect.plan.id, owner.effect.ref.hash), phase: "planned", direction: "forward", nextTransition: 0, evidenceHash: null, createdAt: at, updatedAt: at }] as const])),
      ...migrations.map((plan, index) => ["schema_migration", plan.id, (migrationRefs[index] as ImmutableUpdatePlanRefV1).hash, { ...header(plan.id, (migrationRefs[index] as ImmutableUpdatePlanRefV1).hash), phase: "planned", nextForwardFoundation: 0, compensationNext: null, compactionNext: null, createdAt: at, updatedAt: at }] as const),
      ...states.map(({ kind, plan, ref }) => [kind, plan.id, ref.hash, { ...header(plan.id, ref.hash), kind, phase: "planned", nextTransition: 0, compensationNext: null, createdAt: at, updatedAt: at }] as const),
      ["rollback_payload_state", rollbackState.id, refs.rollbackPayload.hash, initialRollbackPayloadPublicationJournal(rollbackState, at)],
    ];
    return values.map(([kind, id, planHash, value]) => {
      const bytes = kind === "bundle_publication" ? bundlePublicationJournalBytes(value as never) : kind === "rollback_payload_state" ? rollbackPayloadPublicationJournalBytes(value as never) : updateParticipantDocumentBytes(value);
      const stagedPath = path(`${this.#root}/update/initial-journals/${kind}/${id}.json`);
      const finalPath = updateParticipantJournalPath(this.#root, kind, id);
      const ordinal = rows.ordinal();
      const hash = sha256(bytes);
      return {
        ref: { kind, id, planHash, finalPath, stagedPath, stagedExpected: { constructionOrdinal: ordinal, hash, bytes: bytes.byteLength, mode: 384 } } as UpdateInitialJournalRefV1,
        file: { role: { kind: "initial_journal", journalKind: kind, id: id as SafeReasonCodeV1, finalPath }, path: stagedPath, bytes: bytes.byteLength, sha256: hash, mode: 384 },
        bytes,
      };
    });
  }

  #recoveryExecutor(operation: "update_apply" | "update_rollback", current: ReleaseIdentityV1, executionBindingHash: LowerHexSha256, rows: RowLedger): RecoveryRowsV1 {
    const fallback = this.#deps.fallback;
    if (current.launcherProtocol !== fallback.launcherProtocol || current.updateProtocol !== fallback.updateProtocol) refuse("update_fallback_protocol", EXIT_CODES.capabilityUnavailable);
    const common = { schemaVersion: 1, coordinatorId: this.#coordinatorId, operation, executionBindingHash, createdAt: this.#plannedAt } as const;
    const records: readonly UpdateRecoveryExecutorRecordV1[] = [
      { ...common, state: "executing", executor: { kind: "release_bundle", release: current } },
      { ...common, state: "terminal_cleanup", executor: { kind: "package_fallback", ...fallback } },
    ];
    const recordBytes = records.map((record) => encoder.encode(canonical(record))) as [Uint8Array, Uint8Array];
    const staged = records.map((record, index) => {
      const bytes = recordBytes[index] as Uint8Array;
      return { constructionOrdinal: rows.ordinal(), path: updateRecoveryExecutorStagedPath(this.#root, record.state) as UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]["path"], bytes: bytes.byteLength, hash: sha256(bytes), mode: 384 as const };
    });
    const [initial, terminal] = records as [UpdateRecoveryExecutorRecordV1, UpdateRecoveryExecutorRecordV1];
    const [initialStaged, terminalStaged] = staged as [UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"], UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]];
    return {
      descriptor: { finalPath: deriveUpdateExecutorRecordPath(this.#deps.productHome), initial, initialStaged, terminal, terminalStaged, maximumRecordBytes: MAXIMUM_RECOVERY_EXECUTOR_BYTES },
      files: records.map((record, index) => ({ role: { kind: "recovery_executor", state: record.state }, path: (staged[index] as { readonly path: CanonicalAbsolutePathV1 }).path, bytes: (staged[index] as { readonly bytes: number }).bytes, sha256: (staged[index] as { readonly hash: LowerHexSha256 }).hash, mode: 384 })),
      bytes: recordBytes,
    };
  }

  /** The aggregate projection plus the exact construction and outer bytes derived after allocation. */
  #capacity(base: UpdateCapacityInputV1, derivedBytes: number, journals: number): UpdateCapacityInputV1 {
    return {
      ...base,
      components: base.components.map((component) => (component.kind === "journals"
        ? { ...component, bytes: parseUInt64Decimal((BigInt(component.bytes) + BigInt(derivedBytes)).toString(10)), entries: parseUInt64Decimal((BigInt(component.entries) + BigInt(journals + 2)).toString(10)) }
        : component)),
    };
  }
}

/** §5.3: the ordered manifest-affecting Foundation IDs, every owner's forward refs in owner order. */
export function updateManifestFoundationIds(owners: readonly OwnerUpdatePlanV1[]): readonly string[] {
  return owners.flatMap((plan) => plan.foundation.filter((ref) => ref.role.kind === "forward").map((ref) => ref.id as string));
}

/** The manifest admission for an update plan (D72 P2: `construction_evidence`); the dispatcher uses the same. */
export function updateManifestAdmission(input: {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly evidence: CanonicalPathEvidenceV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly foundationTransactionIds: readonly string[];
  readonly externalEffects: readonly ManifestExternalEffectRefV1[];
  readonly updatePayloadIdentity: NonNullable<ManifestStatePlanAdmissionContextV1["updatePayloadIdentity"]>;
}): ManifestStatePlanAdmissionContextV1 {
  return {
    evidence: input.evidence,
    productHome: input.productHome,
    manifestPath: path(`${input.productHome}/installation-manifest.json`),
    foundationTransactionIds: input.foundationTransactionIds,
    externalEffects: input.externalEffects,
    admitParticipant: (envelope, participantId) => {
      if (envelope.kind !== "lifecycle" || envelope.id !== input.coordinatorId) return "mf_refused" as ManifestParticipantIdV1;
      try {
        return parseManifestParticipantId(participantId, null);
      } catch {
        return "mf_refused" as ManifestParticipantIdV1;
      }
    },
    admitExternalEffect: (ref) => (ref.kind === "codex_registration" && input.externalEffects.some((effect) => effect.id === ref.id && effect.planHash === ref.planHash) ? ref.id : "refused"),
    lifecycleIdentity: "construction_evidence",
    updatePayloadIdentity: input.updatePayloadIdentity,
  };
}

/**
 * `update --apply`'s allocation-dependent derivation (Spec 2 §9.2): every leaf plan, the rollback
 * payload, both manifests, every construction row in its exact order, the execution leaf, the
 * construction plan, and the outer V2 coordinator plan and journal bytes. It reads the home only
 * through `deps.observe` under the held lock and writes nothing.
 */
export async function composeUpdate(input: UpdateApplyComposeInputV1, deps: ComposeDepsV1): Promise<UpdateComposedV1> {
  const composer = new UpdateComposer({ operation: "update_apply", input }, deps);
  return composer.compose();
}

/**
 * `update rollback --apply`'s allocation-dependent derivation (Spec 2 §10.2, D72 P9) over the same
 * composer: the verify-previous bundle, owner and migration inverse leaves whose restore bytes are
 * retained blobs, the verify-retained payload and record, the previous active record and verifier,
 * and the consumed-set retirement. It reads only local evidence under the held lock and writes nothing.
 */
export async function composeRollback(input: UpdateRollbackComposeInputV1, deps: RollbackComposeDepsV1): Promise<UpdateComposedV1> {
  const composer = new UpdateComposer({ operation: "update_rollback", input, deps }, deps);
  return composer.composeRollback();
}
