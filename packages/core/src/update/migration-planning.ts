/**
 * Spec 2 §8.4's pure migration planning, split from `migrations.ts` so a target planner bundle
 * imports it without the Foundation journal store (Spec 2 §2's capability-absence gate).
 */
import { createHash } from "node:crypto";

import { compareUtf8, encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type {
  PlannedSchemaMigrationsV1,
  SchemaMigrationChainAnchorsV1,
  SchemaMigrationChainRowV1,
  SchemaMigrationDomainV1,
  SchemaMigrationPlanningRequestV1,
  SchemaMigrationProviderV1,
  SchemaMigrationRegistryV1,
  SchemaMigrationSubjectPathV1,
  SchemaMigrationSubjectV1,
  SchemaMigrationVersionRangeV1,
} from "./migrations.js";
import type { PlannerOutputBlobRefV1, SchemaMigrationDraftV1, SchemaMigrationMutationDraftV1 } from "./planner.js";
import { fail, parsePositiveUInt32, parseSchemaMigrationId, type LowerHexSha256 } from "./scalars.js";

export const SCHEMA_MIGRATION_DOMAIN_ORDER: readonly SchemaMigrationDomainV1[] = Object.freeze(["product_state", "brain"]);

const MAX_MIGRATIONS = 10_000;
export const MAX_MUTATIONS = 100_000;
const MAX_BLOB_BYTES = 16_777_216;
export const MAX_RETAINED_BLOB_ORDINAL = 999_999;

export function sha256Hex(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

export function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

export function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

export function subjectKey(path: SchemaMigrationSubjectPathV1): string {
  return path.domain === "brain" ? `brain:${path.path}` : `product_state:${path.token}`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export function checkRow(row: SchemaMigrationChainRowV1): void {
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
