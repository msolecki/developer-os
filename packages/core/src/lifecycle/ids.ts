import type { LifecycleInstallNonceV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1, ManifestParticipantIdV1 } from "../manifest/manifest-state.js";
import { parseLowerHexSha256 } from "../update/scalars.js";

export type LifecycleIdPrefixV1 = "tx" | "lc" | "ge" | "le" | "mf";

/**
 * Spec 1 §2.4: the literal prefix, the allocator's 64-byte lowercase-hex `installNonce`,
 * and a `UInt64DecimalV1` counter reserved from that allocator. The prefix is carried in
 * the brand so one prefix's ID is not assignable to another's.
 */
export type AllocatedLifecycleIdV1<P extends LifecycleIdPrefixV1> = `${P}_${string}_${string}` & {
  readonly __allocatedLifecycleIdV1: P;
};

export type LegacyFoundationTransactionIdV1 = `tx_${string}` & {
  readonly __legacyFoundationTransactionIdV1: true;
};
export type FoundationTransactionIdV1 = AllocatedLifecycleIdV1<"tx"> | LegacyFoundationTransactionIdV1;
export type GitEffectIdV1 = AllocatedLifecycleIdV1<"ge">;
export type LaunchdEffectIdV1 = AllocatedLifecycleIdV1<"le">;
export type EffectiveUidV1 = number & { readonly __effectiveUidV1: true };
export type LegacyFoundationMutationIndexV1 = number & {
  readonly __legacyFoundationMutationIndexV1: true;
};

export interface LifecycleLedgerBoundsV1 {
  readonly journalLeavesPerRoot: 10000;
  readonly foundationStagingAggregateLeaves: 100000;
  readonly foundationBackupAggregateLeaves: 100000;
  readonly lifecycleStagingAggregateLeaves: 1000000;
  readonly lifecycleStagingPerCoordinatorLeaves: 1000000;
  readonly foundationOverflowAggregateLeaves: 1000000;
}

export const LIFECYCLE_LEDGER_BOUNDS: LifecycleLedgerBoundsV1 = {
  journalLeavesPerRoot: 10_000,
  foundationStagingAggregateLeaves: 100_000,
  foundationBackupAggregateLeaves: 100_000,
  lifecycleStagingAggregateLeaves: 1_000_000,
  lifecycleStagingPerCoordinatorLeaves: 1_000_000,
  foundationOverflowAggregateLeaves: 1_000_000,
};

export const UINT64_MAX = 18_446_744_073_709_551_615n;

const MAX_ALLOCATED_MUTATION_INDEX = 255;
const MAX_LEGACY_MUTATION_INDEX = 4_294_967_294;
const MAX_EFFECTIVE_UID = 4_294_967_295;

const PREFIXES: readonly LifecycleIdPrefixV1[] = ["tx", "lc", "ge", "le", "mf"];
const CANONICAL_DECIMAL = "(?:0|[1-9][0-9]*)";
const ALLOCATED = new RegExp(`^(${PREFIXES.join("|")})_([0-9a-f]{64})_(${CANONICAL_DECIMAL})$`, "u");
const CANONICAL_DECIMAL_ONLY = new RegExp(`^${CANONICAL_DECIMAL}$`, "u");
const LEGACY_TRANSACTION = /^tx_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function requirePrefix(prefix: LifecycleIdPrefixV1): void {
  if (!PREFIXES.includes(prefix)) fail("LifecycleIdPrefixV1");
}

function splitAllocated(value: unknown): {
  readonly prefix: LifecycleIdPrefixV1;
  readonly nonce: string;
  readonly counter: bigint;
} {
  if (typeof value !== "string") fail("AllocatedLifecycleIdV1");
  const match = ALLOCATED.exec(value);
  if (match === null) fail("AllocatedLifecycleIdV1");
  const counter = BigInt(match[3] as string);
  if (counter > UINT64_MAX) fail("AllocatedLifecycleIdV1: counter");
  return { prefix: match[1] as LifecycleIdPrefixV1, nonce: match[2] as string, counter };
}

export function formatAllocatedLifecycleId<P extends LifecycleIdPrefixV1>(
  prefix: P,
  nonce: LifecycleInstallNonceV1,
  counter: bigint,
): AllocatedLifecycleIdV1<P> {
  requirePrefix(prefix);
  parseLowerHexSha256(nonce);
  if (counter < 0n || counter > UINT64_MAX) fail("AllocatedLifecycleIdV1: counter");
  return `${prefix}_${nonce}_${counter.toString(10)}` as AllocatedLifecycleIdV1<P>;
}

export function parseAllocatedLifecycleId<P extends LifecycleIdPrefixV1>(
  prefix: P,
  value: unknown,
  nonce: LifecycleInstallNonceV1 | null,
): AllocatedLifecycleIdV1<P> {
  requirePrefix(prefix);
  const parsed = splitAllocated(value);
  if (parsed.prefix !== prefix) fail("AllocatedLifecycleIdV1: prefix");
  if (nonce !== null && parsed.nonce !== nonce) fail("AllocatedLifecycleIdV1: installation nonce");
  return value as AllocatedLifecycleIdV1<P>;
}

/**
 * Accepts a plain `string` so Spec 2's nominal `LifecycleCoordinatorIdV1` and
 * `ManifestParticipantIdV1` brands, which A5 forbids redefining as
 * `AllocatedLifecycleIdV1<P>`, need no cast. The grammar is re-validated either way.
 */
export function allocatedCounterOf(id: string): bigint {
  return splitAllocated(id).counter;
}

export function parseFoundationTransactionId(
  value: unknown,
  nonce: LifecycleInstallNonceV1 | null,
): FoundationTransactionIdV1 {
  if (typeof value === "string" && LEGACY_TRANSACTION.test(value)) {
    return value as LegacyFoundationTransactionIdV1;
  }
  return parseAllocatedLifecycleId("tx", value, nonce);
}

export function parseLifecycleCoordinatorId(
  value: unknown,
  nonce: LifecycleInstallNonceV1 | null,
): LifecycleCoordinatorIdV1 {
  parseAllocatedLifecycleId("lc", value, nonce);
  return value as LifecycleCoordinatorIdV1;
}

/**
 * D28/A16: the lifecycle manifest participant is the allocated `mf` ID reserved last in a
 * composite's block. Spec 2's shipped `mf_fi_…`/`mf_mm_…` bootstrap participants are a
 * different grammar and are refused here.
 */
export function parseManifestParticipantId(
  value: unknown,
  nonce: LifecycleInstallNonceV1 | null,
): ManifestParticipantIdV1 {
  parseAllocatedLifecycleId("mf", value, nonce);
  return value as ManifestParticipantIdV1;
}

export function parseEffectiveUid(value: unknown, expected: number): EffectiveUidV1 {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_EFFECTIVE_UID ||
    value !== expected
  ) {
    fail("EffectiveUidV1");
  }
  return value as EffectiveUidV1;
}

function parseCanonicalIndex(text: string, maximum: number, label: string): number {
  if (!CANONICAL_DECIMAL_ONLY.test(text)) fail(label);
  const index = Number(text);
  if (index > maximum) fail(label);
  return index;
}

export function parseAllocatedFoundationMutationIndex(text: string): number {
  return parseCanonicalIndex(text, MAX_ALLOCATED_MUTATION_INDEX, "allocated FoundationMutationIndex");
}

export function parseLegacyFoundationMutationIndex(text: string): LegacyFoundationMutationIndexV1 {
  return parseCanonicalIndex(
    text,
    MAX_LEGACY_MUTATION_INDEX,
    "LegacyFoundationMutationIndexV1",
  ) as LegacyFoundationMutationIndexV1;
}
