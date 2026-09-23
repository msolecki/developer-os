import { createHash } from "node:crypto";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { AllocatedLifecycleIdV1 } from "../lifecycle/ids.js";
import { maximumFoundationJournalBytes } from "../lifecycle/store.js";
import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1, UpdateExpectedPayloadRefV1 } from "../manifest/manifest-state.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import {
  deriveFoundationInitialJournalPayloadPath,
  deriveUpdatePayloadPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalProductStatePathV1,
  type FoundationInitialJournalPayloadPathV1,
  type RollbackPayloadRelativePathV1,
  type UpdatePayloadPathV1,
  type VaultRelativePathV1,
} from "./paths.js";
import type {
  OwnerUpdateDraftV1,
  PlannerOutputBlobRefV1,
  PlannerPathTokenV1,
  SchemaMigrationDraftV1,
  SchemaMigrationMutationDraftV1,
  SecretScreenedBlobV1,
  UpdatePlannerRequestV1,
} from "./planner.js";
import { compareUtf8 } from "./release.js";
import {
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSchemaMigrationId,
  parseUtcTimestamp,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type SafeReasonCodeV1,
  type SchemaMigrationIdV1,
  type UtcTimestampV1,
} from "./scalars.js";

export type SchemaMigrationDomainV1 = SchemaMigrationDraftV1["domain"];
export type SchemaMigrationSubjectPathV1 = SchemaMigrationMutationDraftV1["path"];

/** Spec 2 §9.2: a pre-intent payload under the coordinator's exact transaction-payload root. */
export interface UpdatePayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: number;
  readonly path: UpdatePayloadPathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 384 | 448;
}

/**
 * Spec 2 §5.3 (amended D60): a lifecycle mutation follows §6.3's publication rule. `stagedPath` is
 * the executor's standard `<staging>/transactions/<tx>/<ordinal>.bin`, and `content`/`digest` are
 * the two `update_expected` construction rows published there no-replace at the Foundation cursor.
 */
export type UpdateFoundationMutationRefV1 = Omit<FoundationMutationRefV1, "content" | "digest"> & {
  readonly content: UpdatePayloadRefV1 | null;
  readonly digest: UpdatePayloadRefV1 | null;
};

/**
 * Spec 2 §5.3's post-handoff lifecycle arm of `FoundationParticipantRefV2`. The shipped
 * `FoundationParticipantRefV2` admits only the bootstrap arms, so the update arm lives here.
 */
export interface UpdateFoundationParticipantRefV2 {
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: "schema_forward" | "schema_inverse" | "owner_forward_files" | "owner_inverse_files";
  readonly role:
    | { readonly kind: "forward"; readonly compensationId: AllocatedLifecycleIdV1<"tx"> | null }
    | { readonly kind: "compensation"; readonly forwardId: AllocatedLifecycleIdV1<"tx"> };
  readonly mutations: readonly UpdateFoundationMutationRefV1[];
  readonly maximumJournalBytes: number;
  readonly planHash: LowerHexSha256;
  readonly initialJournal: {
    readonly finalPath: CanonicalAbsolutePathV1;
    readonly plannedBytesHash: LowerHexSha256;
    readonly staged: UpdateExpectedPayloadRefV1 & { readonly path: FoundationInitialJournalPayloadPathV1 };
  };
}

export interface SchemaMigrationMutationV1 {
  readonly path: VaultRelativePathV1 | CanonicalProductStatePathV1;
  readonly beforeHash: LowerHexSha256;
  readonly afterHash: LowerHexSha256;
  readonly afterBlob: UpdatePayloadRefV1;
  readonly inverseBlob: UpdatePayloadRefV1;
}

export interface SchemaMigrationPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SchemaMigrationIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly domain: SchemaMigrationDomainV1;
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly SchemaMigrationMutationV1[];
  readonly foundation: readonly UpdateFoundationParticipantRefV2[];
  readonly maximumPlanBytes: number;
}

export interface SchemaMigrationExecutionJournalV1 {
  readonly schemaVersion: 1;
  readonly id: SchemaMigrationIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: "planned" | "applying" | "verified" | "compensating" | "finalized" | "rolled_back" | "compacting";
  readonly nextForwardFoundation: number;
  readonly compensationNext: number | null;
  readonly compactionNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface RetainedInverseBlobRefV1 {
  readonly path: RollbackPayloadRelativePathV1;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
}

export interface RetainedSchemaMigrationInverseMutationV1 {
  readonly path: VaultRelativePathV1 | CanonicalProductStatePathV1;
  readonly expectedCurrentHash: LowerHexSha256;
  readonly restoreHash: LowerHexSha256;
  readonly restoreBlob: RetainedInverseBlobRefV1;
}

export interface RetainedSchemaMigrationInversePlanV1 {
  readonly schemaVersion: 1;
  readonly kind: "schema_migration_inverse";
  readonly id: SchemaMigrationIdV1;
  readonly rollbackBindingHash: LowerHexSha256;
  readonly sourceMigrationPlanHash: LowerHexSha256;
  readonly domain: SchemaMigrationDomainV1;
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly RetainedSchemaMigrationInverseMutationV1[];
  readonly maximumPlanBytes: number;
}

/** One migratable file as a pure provider sees it: a token or Brain-relative path and its bytes. */
export interface SchemaMigrationSubjectV1 {
  readonly path: SchemaMigrationSubjectPathV1;
  readonly content: Uint8Array;
}

/**
 * A pure, root-free schema step. `plan` returns only the subjects it changes, each with its
 * complete after bytes; the inverse is always the exact before bytes, so no provider writes one.
 */
export interface SchemaMigrationProviderV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: SchemaMigrationDomainV1;
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly plan: (subjects: readonly SchemaMigrationSubjectV1[]) => readonly SchemaMigrationSubjectV1[];
}

export interface SchemaMigrationRegistryV1 {
  readonly productState: readonly SchemaMigrationProviderV1[];
  readonly brain: readonly SchemaMigrationProviderV1[];
}

export interface SchemaMigrationChainRowV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: SchemaMigrationDomainV1;
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
}

/** The version each domain's chain must start from, when the caller knows it. */
export type SchemaMigrationChainAnchorsV1 = Readonly<Partial<Record<SchemaMigrationDomainV1, PositiveUInt32V1>>>;

export interface SchemaMigrationVersionRangeV1 {
  readonly from: PositiveUInt32V1;
  readonly to: PositiveUInt32V1;
}

export interface SchemaMigrationPlanningRequestV1 {
  readonly registry: SchemaMigrationRegistryV1;
  readonly versions: Readonly<Record<SchemaMigrationDomainV1, SchemaMigrationVersionRangeV1>>;
  readonly subjects: Readonly<Record<SchemaMigrationDomainV1, readonly SchemaMigrationSubjectV1[]>>;
  /** Output ordinals are one space shared with owner plans; migrations continue from here. */
  readonly firstOutputOrdinal: number;
}

export interface PlannedSchemaMigrationsV1 {
  readonly drafts: readonly SchemaMigrationDraftV1[];
  /** Output blobs in ordinal order starting at `firstOutputOrdinal`. */
  readonly outputBlobs: readonly Uint8Array[];
}

/** Keys are domain-prefixed so a product token and a Brain path can never alias. */
export type SchemaMigrationStateV1 = ReadonlyMap<string, LowerHexSha256>;

export interface MigrationMaterializationContextV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly brainRoot: CanonicalAbsolutePathV1;
  /** The current executor's in-memory token map; it never crosses the wire. */
  readonly tokenPaths: ReadonlyMap<PlannerPathTokenV1, CanonicalProductStatePathV1>;
  /** Current hash of every migratable subject; `schemaMigrationInitialState` builds the first one. */
  readonly state: SchemaMigrationStateV1;
  readonly outputBlobs: readonly SecretScreenedBlobV1[];
  /** The pre-intent payload each output ordinal was staged to. */
  readonly payloads: ReadonlyMap<number, UpdatePayloadRefV1>;
  readonly foundation: readonly UpdateFoundationParticipantRefV2[];
}

export interface MaterializedSchemaMigrationV1 {
  readonly plan: SchemaMigrationPlanV1;
  /** Every inverse blob hashed to its mutation's before hash; materialization refuses otherwise. */
  readonly inverseVerified: true;
  readonly state: SchemaMigrationStateV1;
}

export interface MigrationChainMaterializationContextV1 extends Omit<MigrationMaterializationContextV1, "foundation"> {
  readonly foundation: ReadonlyMap<SchemaMigrationIdV1, readonly UpdateFoundationParticipantRefV2[]>;
}

export const SCHEMA_MIGRATION_DOMAIN_ORDER: readonly SchemaMigrationDomainV1[] = Object.freeze(["product_state", "brain"]);
export const MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES = 16_777_216;

const MAX_MIGRATIONS = 10_000;
const MAX_MUTATIONS = 100_000;
const MAX_BLOB_BYTES = 16_777_216;
const MAX_FOUNDATION_REFS = 782;
const MAX_FOUNDATION_FORWARD_REFS = 391;
const MAX_FOUNDATION_MUTATIONS = 256;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_UPDATE_PAYLOAD_ORDINAL = 1_099_999;
const MAX_RETAINED_BLOB_ORDINAL = 999_999;
const JOURNAL_PHASES: readonly SchemaMigrationExecutionJournalV1["phase"][] = ["planned", "applying", "verified", "compensating", "finalized", "rolled_back", "compacting"];

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function sha256Hex(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function subjectKey(path: SchemaMigrationSubjectPathV1): string {
  return path.domain === "brain" ? `brain:${path.path}` : `product_state:${path.token}`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function checkRow(row: SchemaMigrationChainRowV1): void {
  parseSchemaMigrationId(row.id);
  if (!SCHEMA_MIGRATION_DOMAIN_ORDER.includes(row.domain)) fail("SchemaMigrationChainRowV1.domain");
  if (parsePositiveUInt32(row.fromVersion) >= parsePositiveUInt32(row.toVersion)) fail("SchemaMigrationChainRowV1: fromVersion is not below toVersion");
}

/**
 * Spec 2 §8.4: returns the rows in execution order — every product-state step, then every Brain
 * step, each domain by version — after proving unique IDs and one contiguous chain per domain.
 */
export function orderMigrationChain<T extends SchemaMigrationChainRowV1>(rows: readonly T[], anchors: SchemaMigrationChainAnchorsV1 = {}): readonly T[] {
  if (rows.length > MAX_MIGRATIONS) fail("SchemaMigrationChainRowV1: count");
  const ids = new Set<string>();
  for (const row of rows) {
    checkRow(row);
    if (ids.has(row.id)) fail("SchemaMigrationChainRowV1.id: duplicate");
    ids.add(row.id);
  }
  const ordered = [...rows].sort((left, right) =>
    SCHEMA_MIGRATION_DOMAIN_ORDER.indexOf(left.domain) - SCHEMA_MIGRATION_DOMAIN_ORDER.indexOf(right.domain) || left.fromVersion - right.fromVersion);
  let prior: T | undefined;
  for (const row of ordered) {
    if (prior?.domain === row.domain) {
      if (prior.toVersion !== row.fromVersion) fail("SchemaMigrationChainRowV1: chain is not contiguous");
    } else {
      const anchor = anchors[row.domain];
      if (anchor !== undefined && anchor !== row.fromVersion) fail("SchemaMigrationChainRowV1: chain does not start at the current version");
    }
    prior = row;
  }
  return ordered;
}

/** Each list holds exactly its own domain, already in chain order, and the union has unique IDs. */
export function validateSchemaMigrationRegistry(registry: SchemaMigrationRegistryV1): SchemaMigrationRegistryV1 {
  const lists: readonly [SchemaMigrationDomainV1, readonly SchemaMigrationProviderV1[]][] = [["product_state", registry.productState], ["brain", registry.brain]];
  for (const [domain, providers] of lists) {
    if (providers.some((provider) => provider.domain !== domain || typeof provider.plan !== "function")) fail("SchemaMigrationRegistryV1: a provider is filed under another domain");
    if (!same(orderMigrationChain(providers).map((row) => row.id), providers.map((row) => row.id))) fail("SchemaMigrationRegistryV1: providers are not in chain order");
  }
  orderMigrationChain([...registry.productState, ...registry.brain]);
  return registry;
}

/** The contiguous provider steps from `range.from` to `range.to`; an absent step makes the target incompatible. */
export function selectMigrationChain(providers: readonly SchemaMigrationProviderV1[], range: SchemaMigrationVersionRangeV1): readonly SchemaMigrationProviderV1[] {
  const from = parsePositiveUInt32(range.from);
  const to = parsePositiveUInt32(range.to);
  if (from > to) fail("SchemaMigrationVersionRangeV1: a schema downgrade");
  const selected: SchemaMigrationProviderV1[] = [];
  let version = from;
  while (version < to) {
    const step = providers.find((provider) => provider.fromVersion === version);
    if (step === undefined || step.toVersion > to) fail("SchemaMigrationRegistryV1: incompatible target, a migration step is absent");
    selected.push(step);
    version = step.toVersion;
  }
  return selected;
}

function runProvider(provider: SchemaMigrationProviderV1, current: Map<string, SchemaMigrationSubjectV1>, nextOrdinal: () => PlannerOutputBlobRefV1["ordinal"], blobs: Uint8Array[]): SchemaMigrationDraftV1 {
  const label = `SchemaMigrationProviderV1(${provider.id})`;
  const changed = provider.plan([...current.values()]);
  if (changed.length < 1 || changed.length > MAX_MUTATIONS) fail(`${label}: mutation count`);
  const seen = new Set<string>();
  const rows = changed.map((subject) => {
    const key = subjectKey(subject.path);
    const before = current.get(key);
    // Only an existing snapshot subject is a target: a new target artifact is never migrated in v1.
    if (before === undefined || subject.path.domain !== provider.domain) fail(`${label}: not a current ${provider.domain} subject`);
    if (seen.has(key)) fail(`${label}: repeated subject`);
    seen.add(key);
    if (subject.content.byteLength > MAX_BLOB_BYTES) fail(`${label}: after bytes`);
    if (equalBytes(subject.content, before.content)) fail(`${label}: a mutation that changes nothing`);
    return { key, path: before.path, before: before.content, after: subject.content.slice() };
  }).sort((left, right) => compareUtf8(left.key, right.key));
  const mutations = rows.map((row): SchemaMigrationMutationDraftV1 => {
    const afterBlob: PlannerOutputBlobRefV1 = { stream: "output", ordinal: nextOrdinal(), bytes: row.after.byteLength };
    blobs.push(row.after);
    const inverseBlob: PlannerOutputBlobRefV1 = { stream: "output", ordinal: nextOrdinal(), bytes: row.before.byteLength };
    blobs.push(row.before);
    current.set(row.key, { path: row.path, content: row.after });
    return { path: row.path, beforeHash: sha256Hex(row.before), afterBlob, inverseBlob };
  });
  return { id: provider.id, domain: provider.domain, fromVersion: provider.fromVersion, toVersion: provider.toVersion, mutations };
}

/**
 * Runs the registry's contiguous chains, product state before Brain, over token-only subjects.
 * Pure: it returns drafts and blobs and touches nothing. Each later step sees its predecessor's
 * after bytes, and every inverse blob is the exact before bytes of its step.
 */
export function planSchemaMigrations(request: SchemaMigrationPlanningRequestV1): PlannedSchemaMigrationsV1 {
  const registry = validateSchemaMigrationRegistry(request.registry);
  const providersByDomain: Readonly<Record<SchemaMigrationDomainV1, readonly SchemaMigrationProviderV1[]>> = { product_state: registry.productState, brain: registry.brain };
  const blobs: Uint8Array[] = [];
  let ordinal = request.firstOutputOrdinal;
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) fail("SchemaMigrationPlanningRequestV1.firstOutputOrdinal");
  const nextOrdinal = (): number => {
    if (ordinal > MAX_RETAINED_BLOB_ORDINAL) fail("SchemaMigrationPlanningRequestV1: output blob ordinal");
    return ordinal++;
  };
  const drafts: SchemaMigrationDraftV1[] = [];
  for (const domain of SCHEMA_MIGRATION_DOMAIN_ORDER) {
    const current = new Map<string, SchemaMigrationSubjectV1>();
    for (const subject of request.subjects[domain]) {
      const key = subjectKey(subject.path);
      if (subject.path.domain !== domain || current.has(key)) fail("SchemaMigrationSubjectV1: wrong domain or repeated");
      current.set(key, subject);
    }
    for (const provider of selectMigrationChain(providersByDomain[domain], request.versions[domain])) drafts.push(runProvider(provider, current, nextOrdinal, blobs));
  }
  if (drafts.length > MAX_MIGRATIONS) fail("SchemaMigrationDraftV1: count");
  return { drafts: orderMigrationChain(drafts), outputBlobs: blobs };
}

/** The product tokens whose owner operation is a byte-identical keep or which no operation touches. */
function keptTokens(ownerPlans: readonly OwnerUpdateDraftV1[]): ReadonlySet<string> {
  const kept = new Set<string>();
  for (const plan of ownerPlans) {
    const touched = new Map<string, string>();
    for (const operation of plan.proposedOperations) if (operation.operation !== "create") touched.set(operation.target.token, operation.operation);
    for (const token of plan.currentArtifacts) if ((touched.get(token) ?? "keep") === "keep") kept.add(token);
  }
  return kept;
}

/**
 * The first chain state: every admitted Brain snapshot entry, and every manifest-owned schema file
 * that carried its bytes and whose owner keeps it byte-identical. Nothing else is migratable.
 */
export function schemaMigrationInitialState(request: UpdatePlannerRequestV1, ownerPlans: readonly OwnerUpdateDraftV1[]): SchemaMigrationStateV1 {
  const kept = keptTokens(ownerPlans);
  const state = new Map<string, LowerHexSha256>();
  for (const artifact of request.artifactInputs) {
    const schemaFile = artifact.kind === "file" && artifact.verification.mode === "schema";
    if (schemaFile && artifact.observed.state === "content" && artifact.observed.blob !== null && kept.has(artifact.token)) {
      state.set(subjectKey({ domain: "product_state", token: artifact.token }), artifact.observed.sha256);
    }
  }
  for (const entry of request.brain.entries) state.set(subjectKey({ domain: "brain", path: entry.path }), entry.sha256);
  return state;
}

function screenedBlob(ref: PlannerOutputBlobRefV1, blobs: readonly SecretScreenedBlobV1[]): SecretScreenedBlobV1 {
  const blob = blobs[ref.ordinal];
  if (blob === undefined || blob.ordinal !== ref.ordinal || blob.bytes !== ref.bytes || blob.content.byteLength !== ref.bytes || sha256Hex(blob.content) !== blob.sha256) {
    fail("SchemaMigrationMutationDraftV1: output blob differs from its screened frame");
  }
  return blob;
}

function payloadRef(blob: SecretScreenedBlobV1, context: MigrationMaterializationContextV1): UpdatePayloadRefV1 {
  const label = "UpdatePayloadRefV1";
  const ref = context.payloads.get(blob.ordinal);
  if (ref?.kind !== "update_expected" || ref.coordinatorId !== context.coordinatorId) fail(`${label}: not this coordinator's staged payload`);
  if (!Number.isSafeInteger(ref.ordinal) || ref.ordinal < 0 || ref.ordinal > MAX_UPDATE_PAYLOAD_ORDINAL) fail(`${label}.ordinal`);
  if (ref.path !== deriveUpdatePayloadPath(context.productHome, context.coordinatorId as string as SafeReasonCodeV1, ref.ordinal)) fail(`${label}.path: not the derived payload path`);
  if (ref.bytes !== blob.bytes || ref.sha256 !== blob.sha256 || ref.mode !== 384) fail(`${label}: differs from the screened blob`);
  return ref;
}

function concretePath(path: SchemaMigrationSubjectPathV1, context: MigrationMaterializationContextV1): { readonly path: VaultRelativePathV1 | CanonicalProductStatePathV1; readonly absolute: CanonicalAbsolutePathV1 } {
  if (path.domain === "brain") return { path: path.path, absolute: parseCanonicalAbsolutePathText(`${context.brainRoot}/${path.path}`) };
  const absolute = context.tokenPaths.get(path.token);
  if (absolute === undefined) fail("SchemaMigrationMutationDraftV1.path: token has no current path");
  return { path: absolute, absolute };
}

/** The part of a mutation a plan derives; `stagedPath` and `digest` are bound per ref by `checkUpdateFoundationMutations`. */
type ForwardMutationCoreV1 = Pick<UpdateFoundationMutationRefV1, "targetPath" | "operation" | "expectedBeforeHash" | "contentHash" | "contentSize" | "content">;

function mutationCore(mutation: ForwardMutationCoreV1): ForwardMutationCoreV1 {
  return { targetPath: mutation.targetPath, operation: mutation.operation, expectedBeforeHash: mutation.expectedBeforeHash, contentHash: mutation.contentHash, contentSize: mutation.contentSize, content: mutation.content };
}

function compensationOf(mutation: ForwardMutationCoreV1, inverse: UpdatePayloadRefV1): ForwardMutationCoreV1 {
  return { targetPath: mutation.targetPath, operation: "replace", expectedBeforeHash: mutation.contentHash, contentHash: mutation.expectedBeforeHash, contentSize: inverse.bytes, content: inverse };
}

/** Spec 2 §5.3 (D60): the executor's standard staged blob path for mutation `index` of transaction `id`. */
export function updateFoundationStagedPath(productHome: CanonicalAbsolutePathV1, id: AllocatedLifecycleIdV1<"tx">, index: number): CanonicalAbsolutePathV1 {
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_FOUNDATION_MUTATIONS) fail("UpdateFoundationMutationRefV1: mutation ordinal");
  return parseCanonicalAbsolutePathText(`${productHome}/staging/transactions/${id}/${String(index)}.bin`);
}

/** The exact `.bin.sha256` sidecar bytes the executor's staged-blob check requires: lowercase hex plus LF. */
export function updateFoundationStagedDigestBytes(contentHash: LowerHexSha256): Uint8Array {
  return new TextEncoder().encode(`${parseLowerHexSha256(contentHash)}\n`);
}

function checkMutationPayload(value: UpdatePayloadRefV1, coordinatorId: LifecycleCoordinatorIdV1, productHome: CanonicalAbsolutePathV1, label: string): void {
  if ((value.kind as string) !== "update_expected" || value.coordinatorId !== coordinatorId) fail(`${label}: not this coordinator's staged payload`);
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0 || value.ordinal > MAX_UPDATE_PAYLOAD_ORDINAL) fail(`${label}.ordinal`);
  if (value.path !== deriveUpdatePayloadPath(productHome, coordinatorId as string as SafeReasonCodeV1, value.ordinal)) fail(`${label}.path: not the derived payload path`);
  if ((value.mode as number) !== 384 && (value.mode as number) !== 448) fail(`${label}.mode`);
}

/**
 * Spec 2 §5.3 (D60): every non-remove mutation stages at the standard `<tx>/<i>.bin` path from two
 * distinct construction payloads, content equal to the mutation's hash and size, and a `0600`
 * sidecar of exactly the content hash plus LF. A remove carries none of the three.
 */
export function checkUpdateFoundationMutations(ref: Pick<UpdateFoundationParticipantRefV2, "id" | "mutations">, coordinatorId: LifecycleCoordinatorIdV1, productHome: CanonicalAbsolutePathV1): void {
  const label = "UpdateFoundationMutationRefV1";
  ref.mutations.forEach((mutation, index) => {
    const row = `${label}[${String(index)}]`;
    if (mutation.operation === "remove") {
      if (mutation.stagedPath !== null || mutation.content !== null || mutation.digest !== null) fail(`${row}: a remove with staged bytes`);
      return;
    }
    const { content, digest, contentHash } = mutation;
    if (content === null || digest === null || contentHash === null) fail(`${row}: no staged content`);
    if (mutation.stagedPath !== updateFoundationStagedPath(productHome, ref.id, index)) fail(`${row}.stagedPath: not the standard staged path`);
    checkMutationPayload(content, coordinatorId, productHome, `${row}.content`);
    checkMutationPayload(digest, coordinatorId, productHome, `${row}.digest`);
    if (content.sha256 !== contentHash || content.bytes !== mutation.contentSize) fail(`${row}.content: differs from the mutation`);
    const sidecar = updateFoundationStagedDigestBytes(contentHash);
    if (digest.bytes !== sidecar.byteLength || digest.sha256 !== sha256Hex(sidecar) || digest.mode !== 384) fail(`${row}.digest: not the content hash sidecar`);
    if (digest.ordinal === content.ordinal) fail(`${row}: content and digest share one payload`);
  });
}

export interface UpdateFoundationMutationInputV1 {
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly operation: FoundationMutationRefV1["operation"];
  readonly expectedBeforeHash: LowerHexSha256 | null;
  readonly content: UpdatePayloadRefV1 | null;
  readonly digest: UpdatePayloadRefV1 | null;
}

export interface UpdateFoundationParticipantRefInputV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly slot: UpdateFoundationParticipantRefV2["slot"];
  readonly role: UpdateFoundationParticipantRefV2["role"];
  readonly mutations: readonly UpdateFoundationMutationInputV1[];
  /** The construction ordinal of the ref's initial-journal payload row. */
  readonly journalOrdinal: number;
  readonly createdAt: UtcTimestampV1;
}

/**
 * Builds one lifecycle ref and its exact planned initial-journal bytes. The journal is Spec 1's
 * `FoundationJournalJsonV1` whose `kind` is the slot; its bytes are hashed, never embedding
 * `planHash` (spec:957 as amended by D60). Pure: composition stages the returned bytes.
 */
export function buildUpdateFoundationParticipantRef(input: UpdateFoundationParticipantRefInputV1): { readonly ref: UpdateFoundationParticipantRefV2; readonly initialJournalBytes: Uint8Array } {
  const label = "UpdateFoundationParticipantRefInputV1";
  if (input.mutations.length < 1 || input.mutations.length > MAX_FOUNDATION_MUTATIONS) fail(`${label}.mutations: count`);
  const createdAt = parseUtcTimestamp(input.createdAt);
  const mutations = input.mutations.map((mutation, index): UpdateFoundationMutationRefV1 => {
    const staged = mutation.operation !== "remove";
    return {
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      contentHash: staged ? (mutation.content?.sha256 ?? null) : null,
      contentSize: staged ? (mutation.content?.bytes ?? null) : null,
      stagedPath: staged ? updateFoundationStagedPath(input.productHome, input.id, index) : null,
      content: mutation.content,
      digest: mutation.digest,
    };
  });
  const fileMutations = mutations.map((mutation, index) => ({
    targetPath: mutation.targetPath,
    operation: mutation.operation,
    expectedBeforeHash: mutation.expectedBeforeHash,
    stagedRelativePath: mutation.operation === "remove" ? null : `${String(index)}.bin`,
  }));
  const initialJournalBytes = new TextEncoder().encode(encodeFoundationJournalJsonV1({ schemaVersion: 1, id: input.id, kind: input.slot, phase: "planned", createdAt, updatedAt: createdAt, mutations: fileMutations }));
  const hash = sha256Hex(initialJournalBytes);
  const unsigned: Omit<UpdateFoundationParticipantRefV2, "planHash"> = {
    id: input.id,
    slot: input.slot,
    role: input.role,
    mutations,
    maximumJournalBytes: maximumFoundationJournalBytes({ id: input.id, kind: input.slot, mutations: fileMutations }),
    initialJournal: {
      finalPath: parseCanonicalAbsolutePathText(`${input.productHome}/state/transactions/${input.id}.json`),
      plannedBytesHash: hash,
      staged: {
        kind: "update_expected",
        coordinatorId: input.coordinatorId,
        ordinal: input.journalOrdinal,
        path: deriveFoundationInitialJournalPayloadPath(input.productHome, input.coordinatorId as string as SafeReasonCodeV1, input.id as string as SafeReasonCodeV1),
        hash,
        bytes: initialJournalBytes.byteLength,
        mode: 0o600,
      },
    },
  };
  const ref = { ...unsigned, planHash: updateFoundationParticipantPlanHash(unsigned) };
  checkUpdateFoundationMutations(ref, input.coordinatorId, input.productHome);
  return { ref, initialJournalBytes };
}

/** Spec 2 §5.3: the domain-separated no-LF hash over the ref without its own digests or staged hash. */
export function updateFoundationParticipantPlanHash(ref: Omit<UpdateFoundationParticipantRefV2, "planHash">): LowerHexSha256 {
  const staged = ref.initialJournal.staged;
  const projection = {
    schemaVersion: 2,
    id: ref.id,
    slot: ref.slot,
    role: ref.role,
    mutations: ref.mutations,
    maximumJournalBytes: ref.maximumJournalBytes,
    initialJournal: {
      finalPath: ref.initialJournal.finalPath,
      staged: { kind: staged.kind, coordinatorId: staged.coordinatorId, ordinal: staged.ordinal, path: staged.path, bytes: staged.bytes, mode: staged.mode },
    },
  };
  return createHash("sha256").update("developer-os/foundation-participant-plan/v2\0", "ascii").update(canonical(projection).slice(0, -1), "utf8").digest("hex") as LowerHexSha256;
}

function checkFoundationRef(ref: UpdateFoundationParticipantRefV2, slot: UpdateFoundationParticipantRefV2["slot"], context: MigrationMaterializationContextV1): void {
  const label = "UpdateFoundationParticipantRefV2";
  if (ref.slot !== slot) fail(`${label}.slot: not the direction-matching schema slot`);
  if (ref.mutations.length < 1 || ref.mutations.length > MAX_FOUNDATION_MUTATIONS) fail(`${label}.mutations: count`);
  if (!Number.isSafeInteger(ref.maximumJournalBytes) || ref.maximumJournalBytes < 1 || ref.maximumJournalBytes > MAX_JOURNAL_BYTES) fail(`${label}.maximumJournalBytes`);
  const { finalPath, plannedBytesHash, staged } = ref.initialJournal;
  if (finalPath !== `${context.productHome}/state/transactions/${ref.id}.json`) fail(`${label}.initialJournal.finalPath`);
  if ((staged.kind as string) !== "update_expected" || staged.coordinatorId !== context.coordinatorId || (staged.mode as number) !== 0o600) fail(`${label}.initialJournal.staged`);
  const coordinator = context.coordinatorId as string as SafeReasonCodeV1;
  if (staged.path !== deriveFoundationInitialJournalPayloadPath(context.productHome, coordinator, ref.id as string as SafeReasonCodeV1)) fail(`${label}.initialJournal.staged.path`);
  if (staged.bytes < 1 || staged.bytes > ref.maximumJournalBytes) fail(`${label}.initialJournal.staged.bytes`);
  if (plannedBytesHash !== staged.hash) fail(`${label}.initialJournal.plannedBytesHash`);
  if (ref.planHash !== updateFoundationParticipantPlanHash(ref)) fail(`${label}.planHash`);
  checkUpdateFoundationMutations(ref, context.coordinatorId, context.productHome);
}

/**
 * The complete ordered Foundation binding: refs sorted by ID, every forward paired with a distinct
 * compensation whose mutations reverse it, and the concatenated forward mutations equal to the
 * plan's replace set in canonical target-path order.
 */
function checkFoundationBinding(refs: readonly UpdateFoundationParticipantRefV2[], forward: readonly ForwardMutationCoreV1[], inverses: ReadonlyMap<string, UpdatePayloadRefV1>, context: MigrationMaterializationContextV1): void {
  const label = "SchemaMigrationPlanV1.foundation";
  if (refs.length < 2 || refs.length > MAX_FOUNDATION_REFS || refs.length % 2 !== 0) fail(`${label}: count`);
  for (let index = 1; index < refs.length; index += 1) {
    if (compareUtf8((refs[index - 1] as UpdateFoundationParticipantRefV2).id, (refs[index] as UpdateFoundationParticipantRefV2).id) >= 0) fail(`${label}: not unique and ordered by ID`);
  }
  for (const ref of refs) checkFoundationRef(ref, "schema_forward", context);
  const byId = new Map(refs.map((ref) => [ref.id as string, ref]));
  const forwardRefs = refs.filter((ref) => ref.role.kind === "forward");
  if (forwardRefs.length * 2 !== refs.length || forwardRefs.length > MAX_FOUNDATION_FORWARD_REFS) fail(`${label}: forward and compensation refs are not paired`);
  for (const ref of forwardRefs) {
    const compensationId = ref.role.kind === "forward" ? ref.role.compensationId : null;
    const compensation = compensationId === null ? undefined : byId.get(compensationId);
    if (compensation?.role.kind !== "compensation" || compensation.role.forwardId !== ref.id) fail(`${label}: an unpaired forward ref`);
    const expected = [...ref.mutations].reverse().map((mutation) => compensationOf(mutation, inverses.get(mutation.targetPath) ?? fail(`${label}: a mutation outside the plan`)));
    if (!same(compensation.mutations.map(mutationCore), expected)) fail(`${label}: compensation does not reverse its forward ref`);
  }
  if (!same(forwardRefs.flatMap((ref) => ref.mutations.map(mutationCore)), forward)) fail(`${label}: forward mutations are not the plan's complete ordered set`);
}

/**
 * Spec 2 §8.4: rehydrates one admitted draft through the current executor's token map and Brain
 * snapshot, binds each screened after/inverse blob to its pre-intent payload, proves the inverse
 * restores the exact before bytes, and binds the complete Foundation refs. Pure: it never mutates.
 */
export function materializeSchemaMigration(draft: SchemaMigrationDraftV1, context: MigrationMaterializationContextV1): MaterializedSchemaMigrationV1 {
  const label = "SchemaMigrationDraftV1";
  checkRow(draft);
  if (draft.mutations.length < 1 || draft.mutations.length > MAX_MUTATIONS) fail(`${label}.mutations: count`);
  const state = new Map(context.state);
  const seen = new Set<string>();
  const inverses = new Map<string, UpdatePayloadRefV1>();
  const forward: ForwardMutationCoreV1[] = [];
  const mutations = draft.mutations.map((mutation): SchemaMigrationMutationV1 => {
    if (mutation.path.domain !== draft.domain) fail(`${label}: a mutation in another domain`);
    const key = subjectKey(mutation.path);
    if (seen.has(key)) fail(`${label}: repeated path`);
    seen.add(key);
    const current = state.get(key);
    if (current === undefined) fail(`${label}: not a migratable snapshot subject`);
    const beforeHash = parseLowerHexSha256(mutation.beforeHash);
    if (beforeHash !== current) fail(`${label}.beforeHash: differs from the current state`);
    const after = screenedBlob(mutation.afterBlob, context.outputBlobs);
    const inverse = screenedBlob(mutation.inverseBlob, context.outputBlobs);
    if (inverse.sha256 !== beforeHash) fail(`${label}: the inverse does not restore the exact before bytes`);
    if (after.sha256 === beforeHash) fail(`${label}: a mutation that changes nothing`);
    const afterBlob = payloadRef(after, context);
    const inverseBlob = payloadRef(inverse, context);
    const { path, absolute } = concretePath(mutation.path, context);
    if (inverses.has(absolute)) fail(`${label}: two mutations rehydrate to one path`);
    inverses.set(absolute, inverseBlob);
    forward.push({ targetPath: absolute, operation: "replace", expectedBeforeHash: beforeHash, contentHash: after.sha256, contentSize: after.bytes, content: afterBlob });
    state.set(key, after.sha256);
    return { path, beforeHash, afterHash: after.sha256, afterBlob, inverseBlob };
  });
  forward.sort((left, right) => compareUtf8(left.targetPath, right.targetPath));
  checkFoundationBinding(context.foundation, forward, inverses, context);
  const plan: SchemaMigrationPlanV1 = {
    schemaVersion: 1,
    id: draft.id,
    coordinatorId: context.coordinatorId,
    domain: draft.domain,
    fromVersion: draft.fromVersion,
    toVersion: draft.toVersion,
    mutations,
    foundation: context.foundation,
    maximumPlanBytes: MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES,
  };
  if (schemaMigrationPlanBytes(plan).byteLength > plan.maximumPlanBytes) fail("SchemaMigrationPlanV1: exceeds its plan bytes");
  return { plan, inverseVerified: true, state };
}

/** Materializes the whole ordered chain, each step starting from its predecessor's after state. */
export function materializeSchemaMigrations(drafts: readonly SchemaMigrationDraftV1[], context: MigrationChainMaterializationContextV1): readonly MaterializedSchemaMigrationV1[] {
  const ordered = orderMigrationChain(drafts);
  if (!same(ordered.map((draft) => draft.id), drafts.map((draft) => draft.id))) fail("SchemaMigrationDraftV1: not in execution order");
  const domainByPath = new Map<string, SchemaMigrationDomainV1>();
  let state = context.state;
  return ordered.map((draft) => {
    const foundation = context.foundation.get(draft.id);
    if (foundation === undefined) fail("MigrationChainMaterializationContextV1.foundation: a migration without refs");
    const materialized = materializeSchemaMigration(draft, { ...context, state, foundation });
    for (const mutation of materialized.plan.mutations) {
      const absolute = draft.domain === "brain" ? `${context.brainRoot}/${mutation.path}` : mutation.path;
      if ((domainByPath.get(absolute) ?? draft.domain) !== draft.domain) fail("SchemaMigrationDraftV1: cross-domain reuse of one path");
      domainByPath.set(absolute, draft.domain);
    }
    state = materialized.state;
    return materialized;
  });
}

/** The persisted bytes: canonical JSON plus one LF. */
export function schemaMigrationPlanBytes(plan: SchemaMigrationPlanV1): Uint8Array {
  return new TextEncoder().encode(canonical(plan));
}

/** The immutable plan ref hash: raw SHA-256 of the exact persisted bytes. */
export function schemaMigrationPlanHash(plan: SchemaMigrationPlanV1): LowerHexSha256 {
  return sha256Hex(schemaMigrationPlanBytes(plan));
}

export interface RetainedSchemaMigrationInverseContextV1 {
  readonly rollbackBindingHash: LowerHexSha256;
  /** The rollback payload's next free `blobs/<ordinal>.bin`; one blob per mutation follows it. */
  readonly firstBlobOrdinal: number;
}

/**
 * The retained inverse a later rollback replays: each mutation expects the after hash and restores
 * the exact before bytes from its inverse blob, copied into the rollback payload's blob set.
 */
export function projectRetainedSchemaMigrationInverse(plan: SchemaMigrationPlanV1, context: RetainedSchemaMigrationInverseContextV1): RetainedSchemaMigrationInversePlanV1 {
  const first = context.firstBlobOrdinal;
  if (!Number.isSafeInteger(first) || first < 0 || first + plan.mutations.length - 1 > MAX_RETAINED_BLOB_ORDINAL) fail("RetainedSchemaMigrationInverseContextV1.firstBlobOrdinal");
  const mutations = plan.mutations.map((mutation, index): RetainedSchemaMigrationInverseMutationV1 => {
    if (mutation.inverseBlob.sha256 !== mutation.beforeHash) fail("SchemaMigrationPlanV1: the inverse does not restore the exact before bytes");
    return {
      path: mutation.path,
      expectedCurrentHash: mutation.afterHash,
      restoreHash: mutation.beforeHash,
      restoreBlob: { path: `blobs/${encodeTenDigitOrdinal(first + index)}.bin` as RollbackPayloadRelativePathV1, bytes: mutation.inverseBlob.bytes, sha256: mutation.inverseBlob.sha256 },
    };
  });
  return {
    schemaVersion: 1,
    kind: "schema_migration_inverse",
    id: plan.id,
    rollbackBindingHash: parseLowerHexSha256(context.rollbackBindingHash),
    sourceMigrationPlanHash: schemaMigrationPlanHash(plan),
    domain: plan.domain,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    mutations,
    maximumPlanBytes: MAXIMUM_SCHEMA_MIGRATION_PLAN_BYTES,
  };
}

function cursor(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function nullableCursor(value: unknown, minimum: number, maximum: number, label: string): number | null {
  return value === null ? null : cursor(value, minimum, maximum, label);
}

/**
 * Validates a journal against its plan: exact keys, plan binding, cursor bounds from the plan's
 * forward/paired ref counts, and every cursor unused by the phase held at zero or null.
 */
export function validateSchemaMigrationExecutionJournal(value: unknown, plan: SchemaMigrationPlanV1): SchemaMigrationExecutionJournalV1 {
  const label = "SchemaMigrationExecutionJournalV1";
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Record<string, unknown>;
  const keys = ["schemaVersion", "id", "coordinatorId", "planHash", "phase", "nextForwardFoundation", "compensationNext", "compactionNext", "createdAt", "updatedAt"];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) fail(`${label}: keys`);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.coordinatorId !== plan.coordinatorId) fail(`${label}: not this plan's journal`);
  if (input.planHash !== schemaMigrationPlanHash(plan)) fail(`${label}.planHash`);
  if (!JOURNAL_PHASES.includes(input.phase as SchemaMigrationExecutionJournalV1["phase"])) fail(`${label}.phase`);
  const phase = input.phase as SchemaMigrationExecutionJournalV1["phase"];
  const forwardCount = plan.foundation.length / 2;
  const next = cursor(input.nextForwardFoundation, 0, forwardCount, `${label}.nextForwardFoundation`);
  const compensation = nullableCursor(input.compensationNext, -1, forwardCount - 1, `${label}.compensationNext`);
  const compaction = nullableCursor(input.compactionNext, 0, plan.foundation.length, `${label}.compactionNext`);
  const createdAt = parseUtcTimestamp(input.createdAt);
  const updatedAt = parseUtcTimestamp(input.updatedAt);
  if (updatedAt < createdAt) fail(`${label}.updatedAt: before createdAt`);
  const complete = next === forwardCount;
  const legal =
    (phase === "planned" && next === 0 && compensation === null && compaction === null) ||
    (phase === "applying" && compensation === null && compaction === null) ||
    ((phase === "verified" || phase === "finalized") && complete && compensation === null && compaction === null) ||
    (phase === "compensating" && compensation !== null && compensation < next && compaction === null) ||
    (phase === "rolled_back" && compensation === -1 && compaction === null) ||
    (phase === "compacting" && compaction !== null);
  if (!legal) fail(`${label}: cursors do not match the phase`);
  return { schemaVersion: 1, id: plan.id, coordinatorId: plan.coordinatorId, planHash: input.planHash as LowerHexSha256, phase, nextForwardFoundation: next, compensationNext: compensation, compactionNext: compaction, createdAt, updatedAt };
}
