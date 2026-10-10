import {
  flattenUpdateRetirementLeaves,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_BUNDLE_FILE_BYTES,
  updateLeafPlanHash,
  validateUpdateTerminalRetirementPlan,
  type CanonicalAbsolutePathV1,
  type ImmutableUpdatePlanRefV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type RetirementInventoryRefV1,
  type RetirementLeafV1,
  type UpdateLifecycleCoordinatorStepV1,
  type UpdateTerminalRetirementPlanV1,
} from "@developer-os/core";

import { BundleGuardedIo, parentPath, refuseBundle } from "./bundle-source.js";
import type { UpdateRetirementHandlerV1 } from "./coordinator.js";

type RetireStepV1 = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: "terminal_retire" }>;

export type UpdateRetirementDeathPointV1 = "leaf_removed";

export interface UpdateRetirementParticipantDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  /**
   * One inventory's removable leaves in removal order, derived from authority that survives the
   * removal itself (the transitional manifest), so a resume at any `retirementNext` sees the same list.
   */
  readonly resolve: (entry: RetirementInventoryRefV1, plan: UpdateTerminalRetirementPlanV1) => Promise<readonly RetirementLeafV1[]>;
  readonly interrupt?: (point: UpdateRetirementDeathPointV1) => void;
}

/**
 * Spec 2 §9.2 terminal retirement: reopens the hash-bound plan, flattens its inventories, and
 * guarded-removes exactly the leaf at the coordinator's `retirementNext`. An absent leaf is the
 * crash frontier of that one ordinal, legal only while its parent is still present; any other
 * observed state is preserved and refused (exit 6).
 */
export class UpdateRetirementParticipant implements UpdateRetirementHandlerV1 {
  readonly #dependencies: UpdateRetirementParticipantDependenciesV1;
  readonly #io: BundleGuardedIo;
  readonly #root: CanonicalAbsolutePathV1;
  readonly #ref: ImmutableUpdatePlanRefV1<"terminal_retirement">;
  #planValue: Promise<UpdateTerminalRetirementPlanV1> | null = null;
  #leaves: Promise<readonly RetirementLeafV1[]> | null = null;

  constructor(dependencies: UpdateRetirementParticipantDependenciesV1, stagingRoot: CanonicalAbsolutePathV1, ref: ImmutableUpdatePlanRefV1<"terminal_retirement">) {
    this.#dependencies = dependencies;
    this.#io = new BundleGuardedIo(dependencies.fs, dependencies.effectiveUid);
    this.#root = stagingRoot;
    this.#ref = ref;
  }

  async leaves(step: RetireStepV1): Promise<number> {
    return (await this.#flattened(step)).length;
  }

  async retire(step: RetireStepV1, ordinal: number): Promise<void> {
    const leaf = (await this.#flattened(step))[ordinal];
    if (!Number.isSafeInteger(ordinal) || leaf === undefined) return refuseBundle("update_retirement_cursor", this.#ref.path);
    const { fs } = this.#dependencies;
    const entry = await fs.lstat(leaf.path);
    const parent = await fs.lstat(parentPath(leaf.path));
    if (parent?.kind !== "directory" || parent.ownerUid !== this.#dependencies.effectiveUid) return refuseBundle("update_retirement_parent", leaf.path);
    if (entry === null) return;
    if (leaf.kind === "file") {
      await this.#requireFile(entry, leaf);
      await fs.unlinkExact(entry);
    } else {
      if (entry.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid || !(await this.#io.emptyDirectory(entry))) return refuseBundle("update_retirement_leaf", leaf.path);
      await fs.rmdirExactEmpty(entry);
    }
    await fs.syncDirectory(parent);
    this.#dependencies.interrupt?.("leaf_removed");
    if ((await fs.lstat(leaf.path)) !== null) refuseBundle("update_retirement_leaf", leaf.path);
  }

  async #requireFile(entry: LifecycleGuardedEntryV1, leaf: RetirementLeafV1): Promise<void> {
    if (leaf.bytes === null && leaf.sha256 === null) return refuseBundle("update_retirement_leaf", leaf.path);
    const maximumBytes = leaf.bytes ?? MAXIMUM_BUNDLE_FILE_BYTES;
    const bound = entry.kind === "regular_file" && entry.ownerUid === this.#dependencies.effectiveUid && entry.nlink === 1 && BigInt(entry.size) <= BigInt(maximumBytes) && (leaf.bytes === null || entry.size === leaf.bytes.toString(10));
    if (!bound || (leaf.sha256 !== null && (await this.#dependencies.fs.hashRegular(entry, BigInt(maximumBytes))) !== leaf.sha256)) refuseBundle("update_retirement_leaf", leaf.path);
  }

  async #flattened(step: RetireStepV1): Promise<readonly RetirementLeafV1[]> {
    const plan = await this.#plan();
    if (plan.set !== step.set) return refuseBundle("update_retirement_set", this.#ref.path);
    this.#leaves ??= this.#load(plan);
    return this.#leaves;
  }

  #plan(): Promise<UpdateTerminalRetirementPlanV1> {
    this.#planValue ??= this.#readPlan();
    return this.#planValue;
  }

  async #readPlan(): Promise<UpdateTerminalRetirementPlanV1> {
    const ref = this.#ref;
    const file = await this.#io.readBounded(ref.path, 0o600, MAXIMUM_LEAF_PLAN_BYTES);
    if (file === null || file.bytes.byteLength !== ref.bytes || updateLeafPlanHash("terminal_retirement", file.bytes) !== ref.hash) return refuseBundle("update_retirement_plan", ref.path);
    const plan = validateUpdateTerminalRetirementPlan(this.#io.decodeExact(file.bytes, MAXIMUM_LEAF_PLAN_BYTES, ref.path), this.#root);
    if (plan.id !== ref.id) refuseBundle("update_retirement_plan", ref.path);
    return plan;
  }

  async #load(plan: UpdateTerminalRetirementPlanV1): Promise<readonly RetirementLeafV1[]> {
    const inventories: (readonly RetirementLeafV1[])[] = [];
    for (const entry of plan.entries) inventories.push(await this.#dependencies.resolve(entry, plan));
    return flattenUpdateRetirementLeaves(plan, inventories);
  }
}
