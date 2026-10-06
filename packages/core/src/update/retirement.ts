/**
 * Spec 2 §9.2 `UpdateTerminalRetirementPlanV1`: the immutable plan of one `terminal_retire` step and
 * the pure flattener that turns its referenced inventories into the ordered leaf list
 * `retirementNext` walks. Nothing here opens a file; the CLI resolves each inventory's leaves.
 */
import { compareUtf8 } from "../lifecycle/canonical-json.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { cachedPlanHash, canonical, coordinatorOf, exact, fail, integer, list, oneOf } from "./bundle-participant.js";
import { MAXIMUM_LEAF_PLAN_BYTES, updateLeafPlanPath, type ImmutableUpdatePlanRefV1 } from "./construction.js";
import { MAXIMUM_UPDATE_RETIREMENT_LEAVES } from "./coordinator.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "./paths.js";
import type { RetirementInventoryRefV1, RollbackPayloadLeafV1 } from "./rollback.js";
import { parseLowerHexSha256, parseSafeReasonCode, type LowerHexSha256, type SafeReasonCodeV1 } from "./scalars.js";

export type UpdateRetirementSetV1 = "prior_rollback" | "consumed_rollback_and_rejected_release";

export interface UpdateTerminalRetirementPlanV1 {
  readonly schemaVersion: 1;
  readonly id: SafeReasonCodeV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly set: UpdateRetirementSetV1;
  readonly transitionalManifestHash: LowerHexSha256;
  readonly entries: readonly RetirementInventoryRefV1[];
  readonly maximumLeaves: number;
  readonly maximumPlanBytes: number;
}

/** One removable leaf; the rollback-payload leaf shape is the generic one. */
export type RetirementLeafV1 = RollbackPayloadLeafV1;

export const MAXIMUM_RETIREMENT_INVENTORIES = 16;
/** A maximum payload: 1,000,000 entries plus its root, five fixed children and two metadata files. */
export const MAXIMUM_RETIREMENT_INVENTORY_LEAVES = 1_000_007;

const PLAN_KEYS = ["schemaVersion", "id", "coordinatorId", "set", "transitionalManifestHash", "entries", "maximumLeaves", "maximumPlanBytes"];
const REF_KEYS = ["kind", "root", "inventoryHash", "leafCount"];
const SETS: readonly UpdateRetirementSetV1[] = ["prior_rollback", "consumed_rollback_and_rejected_release"];
const KINDS: readonly RetirementInventoryRefV1["kind"][] = ["bundle", "metadata", "rollback_payload", "rollback_record"];
const encoder = new TextEncoder();

/** Kind in declared order, then root in unsigned UTF-8 order. */
function compareRefs(left: RetirementInventoryRefV1, right: RetirementInventoryRefV1): number {
  return KINDS.indexOf(left.kind) - KINDS.indexOf(right.kind) || compareUtf8(left.root, right.root);
}

function validateRef(value: unknown, label: string): RetirementInventoryRefV1 {
  const input = exact(value, REF_KEYS, label);
  oneOf(input.kind, KINDS, `${label}.kind`);
  parseCanonicalAbsolutePathText(input.root);
  parseLowerHexSha256(input.inventoryHash);
  integer(input.leafCount, 0, MAXIMUM_RETIREMENT_INVENTORY_LEAVES, `${label}.leafCount`);
  return input as unknown as RetirementInventoryRefV1;
}

/**
 * Exact keys; entries strictly ordered by kind then root; `maximumLeaves` recomputed as the sum of
 * every inventory's leaves and within the cardinality cap; the plan's own bytes within both its
 * declared `maximumPlanBytes` and the 16-MiB leaf-plan cap (amended 2026-09-08).
 */
export function validateUpdateTerminalRetirementPlan(value: unknown, stagingRoot: CanonicalAbsolutePathV1): UpdateTerminalRetirementPlanV1 {
  const label = "UpdateTerminalRetirementPlanV1";
  const input = exact(value, PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  parseSafeReasonCode(input.id);
  coordinatorOf(stagingRoot, input.coordinatorId, label);
  oneOf(input.set, SETS, `${label}.set`);
  parseLowerHexSha256(input.transitionalManifestHash);
  const entries = list(input.entries, 0, MAXIMUM_RETIREMENT_INVENTORIES, `${label}.entries`).map((row, index) => validateRef(row, `${label}.entries[${String(index)}]`));
  for (let index = 1; index < entries.length; index += 1) {
    if (compareRefs(entries[index - 1] as RetirementInventoryRefV1, entries[index] as RetirementInventoryRefV1) >= 0) fail(`${label}.entries: not strictly in kind/root order`);
  }
  const maximumLeaves = integer(input.maximumLeaves, 0, MAXIMUM_UPDATE_RETIREMENT_LEAVES, `${label}.maximumLeaves`);
  if (maximumLeaves !== entries.reduce((sum, entry) => sum + entry.leafCount, 0)) fail(`${label}.maximumLeaves: not the recomputed leaf count`);
  const maximumPlanBytes = integer(input.maximumPlanBytes, 1, MAXIMUM_LEAF_PLAN_BYTES, `${label}.maximumPlanBytes`);
  if (encoder.encode(canonical(input)).byteLength > maximumPlanBytes) fail(`${label}: exceeds its plan bytes`);
  return input as unknown as UpdateTerminalRetirementPlanV1;
}

export function updateTerminalRetirementPlanBytes(plan: UpdateTerminalRetirementPlanV1): Uint8Array {
  return encoder.encode(canonical(plan));
}

/** `developer-os/update-leaf/terminal_retirement/v1\0` over the canonical JSON-plus-LF bytes. */
export function updateTerminalRetirementPlanHash(plan: UpdateTerminalRetirementPlanV1): LowerHexSha256 {
  return cachedPlanHash(plan, "terminal_retirement");
}

export function updateTerminalRetirementPlanRef(plan: UpdateTerminalRetirementPlanV1, stagingRoot: CanonicalAbsolutePathV1): ImmutableUpdatePlanRefV1<"terminal_retirement"> {
  return {
    kind: "terminal_retirement",
    id: plan.id,
    path: updateLeafPlanPath(stagingRoot, "terminal_retirement", plan.id),
    hash: updateTerminalRetirementPlanHash(plan),
    bytes: updateTerminalRetirementPlanBytes(plan).byteLength,
  };
}

/**
 * The inventory's shape by kind: a bundle or payload tree ends at its root directory, a rollback
 * record is exactly its one file, and a metadata inventory holds files only (the shared retained
 * metadata directories are not leaves).
 */
function checkInventoryShape(entry: RetirementInventoryRefV1, inventory: readonly RetirementLeafV1[], label: string): void {
  const last = inventory.at(-1);
  if (entry.kind === "rollback_record" && (inventory.length !== 1 || last?.path !== entry.root || last.kind !== "file")) fail(`${label}: not exactly the record file`);
  if (entry.kind === "metadata" && inventory.some((leaf) => leaf.kind !== "file")) fail(`${label}: a metadata directory`);
  if ((entry.kind === "bundle" || entry.kind === "rollback_payload") && last !== undefined && (last.path !== entry.root || last.kind !== "directory")) fail(`${label}: not ending at its root directory`);
}

/**
 * The step's leaves in cursor order: the plan's entries in their kind/root order, each inventory's
 * leaves in the removal order its resolver derived, children before their directory.
 * `inventories[i]` are the leaves of `plan.entries[i]`. Every leaf lies at or under its entry's
 * root and is counted once across the whole set.
 */
export function flattenUpdateRetirementLeaves(plan: UpdateTerminalRetirementPlanV1, inventories: readonly (readonly RetirementLeafV1[])[]): readonly RetirementLeafV1[] {
  const label = "UpdateTerminalRetirementPlanV1";
  if (inventories.length !== plan.entries.length) fail(`${label}: not one inventory per entry`);
  const leaves: RetirementLeafV1[] = [];
  const seen = new Set<string>();
  const removedDirectories = new Set<string>();
  plan.entries.forEach((entry, index) => {
    const inventory = inventories[index] as readonly RetirementLeafV1[];
    const entryLabel = `${label}.entries[${String(index)}]`;
    if (inventory.length !== entry.leafCount) fail(`${entryLabel}: leaf count`);
    checkInventoryShape(entry, inventory, entryLabel);
    for (const leaf of inventory) {
      if (leaf.path !== entry.root && !leaf.path.startsWith(`${entry.root}/`)) fail(`${entryLabel}: a leaf outside its root`);
      if (leaf.kind === "directory" && (leaf.bytes !== null || leaf.sha256 !== null)) fail(`${entryLabel}: a directory with content`);
      if (removedDirectories.has(leaf.path.slice(0, leaf.path.lastIndexOf("/")))) fail(`${entryLabel}: a leaf after its directory`);
      if (seen.has(leaf.path)) fail(`${label}: a leaf counted twice`);
      seen.add(leaf.path);
      if (leaf.kind === "directory") removedDirectories.add(leaf.path);
      leaves.push(leaf);
    }
  });
  if (leaves.length !== plan.maximumLeaves) fail(`${label}.maximumLeaves`);
  return leaves;
}
