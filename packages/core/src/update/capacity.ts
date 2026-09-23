import { parseUInt64Decimal, type UInt64DecimalV1 } from "./scalars.js";

export type UpdateCapacityComponentKindV1 =
  | "active"
  | "retained_rollback"
  | "verified_scratch"
  | "durable_bundle_source"
  | "target_bundle"
  | "transaction_staging"
  | "backups"
  | "inverse_payload"
  | "journals"
  | "terminal_compaction_headroom";

export interface UpdateCapacityComponentV1 {
  readonly kind: UpdateCapacityComponentKindV1;
  readonly bytes: UInt64DecimalV1;
  readonly entries: UInt64DecimalV1;
}

export interface UpdateCapacityProjectionV1 {
  readonly components: readonly UpdateCapacityComponentV1[];
  readonly requiredBytes: UInt64DecimalV1;
  readonly requiredEntries: UInt64DecimalV1;
  readonly availableBytes: UInt64DecimalV1;
  readonly availableEntries: UInt64DecimalV1;
  readonly fits: true;
}

export interface UpdateCapacityInputV1 {
  readonly operation: "update" | "rollback";
  /** Every scope the operation reaches, in any order. A scope with zero bytes and zero entries is omitted from the projection. */
  readonly components: readonly UpdateCapacityComponentV1[];
  /** The filesystem's reservation granularity, added once to the byte total (Spec 2 §7.2). */
  readonly reservationGranularityBytes: UInt64DecimalV1;
  /** A filesystem report without both dimensions is insufficient (Spec 2 §9.1), so both are required. */
  readonly availableBytes: UInt64DecimalV1;
  readonly availableEntries: UInt64DecimalV1;
}

/** Spec 2 §7.2's shown order, which is also the projection's canonical order. */
export const UPDATE_CAPACITY_COMPONENT_ORDER: readonly UpdateCapacityComponentKindV1[] = [
  "active",
  "retained_rollback",
  "verified_scratch",
  "durable_bundle_source",
  "target_bundle",
  "transaction_staging",
  "backups",
  "inverse_payload",
  "journals",
  "terminal_compaction_headroom",
];

/**
 * Rollback never downloads, extracts, or publishes a new bundle and retains no new inverse
 * payload (Spec 2 §10.2), so those scopes are unreachable for it and a nonzero one refuses.
 */
const REACHABLE: Readonly<Record<UpdateCapacityInputV1["operation"], ReadonlySet<UpdateCapacityComponentKindV1>>> = {
  update: new Set(UPDATE_CAPACITY_COMPONENT_ORDER),
  rollback: new Set<UpdateCapacityComponentKindV1>([
    "active",
    "retained_rollback",
    "transaction_staging",
    "backups",
    "journals",
    "terminal_compaction_headroom",
  ]),
};

const maximumUInt64 = 18_446_744_073_709_551_615n;

/** Content-free: it names only the first insufficient dimension, never a path or a size. */
export class UpdateCapacityInsufficientError extends Error {
  constructor(readonly dimension: "bytes" | "entries") {
    super(`insufficient update capacity: ${dimension}`);
    this.name = "UpdateCapacityInsufficientError";
  }
}

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function checkedAdd(left: bigint, right: bigint, label: string): bigint {
  const sum = left + right;
  if (sum > maximumUInt64) fail(`${label}: uint64 overflow`);
  return sum;
}

function decimal(value: bigint): UInt64DecimalV1 {
  return parseUInt64Decimal(value.toString(10));
}

/**
 * Projects the exact scopes an update or rollback can consume and publishes the projection only
 * when both dimensions fit. `fits: true` is the only arm there is: an insufficient byte or entry
 * total throws, so no caller can hold a preview claiming apply feasibility it does not have.
 */
export function projectUpdateCapacity(input: UpdateCapacityInputV1): UpdateCapacityProjectionV1 {
  const reachable = REACHABLE[input.operation] as ReadonlySet<UpdateCapacityComponentKindV1> | undefined;
  if (reachable === undefined) fail("UpdateCapacityInputV1.operation");
  const byKind = new Map<UpdateCapacityComponentKindV1, { readonly bytes: bigint; readonly entries: bigint }>();
  for (const component of input.components) {
    if (!UPDATE_CAPACITY_COMPONENT_ORDER.includes(component.kind)) fail("UpdateCapacityComponentV1.kind");
    if (byKind.has(component.kind)) fail("UpdateCapacityComponentV1: duplicate kind");
    const bytes = BigInt(parseUInt64Decimal(component.bytes));
    const entries = BigInt(parseUInt64Decimal(component.entries));
    if ((bytes !== 0n || entries !== 0n) && !reachable.has(component.kind)) fail("UpdateCapacityComponentV1: unreachable scope");
    byKind.set(component.kind, { bytes, entries });
  }

  const components: UpdateCapacityComponentV1[] = [];
  let requiredBytes = 0n;
  let requiredEntries = 0n;
  for (const kind of UPDATE_CAPACITY_COMPONENT_ORDER) {
    const component = byKind.get(kind);
    // A zero-byte scope that can still consume an inode stays in the projection.
    if (component === undefined || (component.bytes === 0n && component.entries === 0n)) continue;
    requiredBytes = checkedAdd(requiredBytes, component.bytes, "UpdateCapacityProjectionV1.requiredBytes");
    requiredEntries = checkedAdd(requiredEntries, component.entries, "UpdateCapacityProjectionV1.requiredEntries");
    components.push({ kind, bytes: decimal(component.bytes), entries: decimal(component.entries) });
  }
  if (components.length < 1 || components.length > 12) fail("UpdateCapacityProjectionV1.components");
  requiredBytes = checkedAdd(
    requiredBytes,
    BigInt(parseUInt64Decimal(input.reservationGranularityBytes)),
    "UpdateCapacityProjectionV1.requiredBytes",
  );

  const availableBytes = BigInt(parseUInt64Decimal(input.availableBytes));
  const availableEntries = BigInt(parseUInt64Decimal(input.availableEntries));
  if (requiredBytes > availableBytes) throw new UpdateCapacityInsufficientError("bytes");
  if (requiredEntries > availableEntries) throw new UpdateCapacityInsufficientError("entries");
  return {
    components,
    requiredBytes: decimal(requiredBytes),
    requiredEntries: decimal(requiredEntries),
    availableBytes: decimal(availableBytes),
    availableEntries: decimal(availableEntries),
    fits: true,
  };
}
