import * as nodeFs from "node:fs/promises";

import {
  LifecycleRecoveryRequiredError,
  decodeUpdateExecutorRecordSlot,
  deriveUpdateExecutorRecordPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleJournalClosureV2,
  type LowerHexSha256,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateLifecycleOutcomeV1,
  type UpdateRecoveryExecutorDescriptorV1,
  type UpdateRecoveryExecutorPortV1,
  type UpdateRecoveryExecutorRecordV1,
  type UpdateRecoveryExecutorStagedFileV1,
} from "@developer-os/core";

/** Every durable boundary of the executor-record protocol a death test may stop at. */
export type UpdateRecoveryExecutorDeathPointV1 =
  | "initial_renamed"
  | "initial_synced"
  | "terminal_replaced"
  | "terminal_synced"
  | "record_unlinked";

export const UPDATE_RECOVERY_EXECUTOR_DEATH_POINTS: readonly UpdateRecoveryExecutorDeathPointV1[] = Object.freeze([
  "initial_renamed",
  "initial_synced",
  "terminal_replaced",
  "terminal_synced",
  "record_unlinked",
]);

export interface UpdateRecoveryExecutorFilesDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly descriptor: UpdateRecoveryExecutorDescriptorV1;
  /** Defaults to `replaceExecutorRecordAcross`; the guarded port's `renameOver` is same-parent only. */
  readonly replaceAcross?: UpdateExecutorReplaceV1;
  readonly interrupt?: (point: UpdateRecoveryExecutorDeathPointV1) => void;
}

const RECORD_MODE = 0o600;

export type UpdateExecutorReplaceV1 = (source: LifecycleGuardedEntryV1, destination: LifecycleGuardedEntryV1) => Promise<void>;

function refuse(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function parentOf(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

/**
 * §9.2 replaces the `executing` record with the staged terminal one across directories on the
 * product-state device; both inodes are re-proven immediately before the atomic rename.
 */
export async function replaceExecutorRecordAcross(source: LifecycleGuardedEntryV1, destination: LifecycleGuardedEntryV1): Promise<void> {
  for (const entry of [source, destination]) {
    const stats = await nodeFs.lstat(entry.path, { bigint: true });
    if (!stats.isFile() || stats.dev.toString(10) !== entry.dev || stats.ino.toString(10) !== entry.ino || stats.nlink !== 1n) refuse("update_executor_record_identity", entry.path);
  }
  if (source.dev !== destination.dev) refuse("update_executor_record_device", source.path, destination.path);
  await nodeFs.rename(source.path, destination.path);
}

/**
 * §9.2's recovery-executor protocol over the guarded filesystem. The admitted states are exactly:
 * final absent plus the complete initial stage; final `executing` with the terminal stage still
 * bound; final `terminal_cleanup` with both stages gone. Anything else preserves evidence as exit 6.
 */
export class UpdateRecoveryExecutorFiles implements UpdateRecoveryExecutorPortV1 {
  readonly #dependencies: UpdateRecoveryExecutorFilesDependenciesV1;

  constructor(dependencies: UpdateRecoveryExecutorFilesDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async publishInitial(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void> {
    const { fs, descriptor } = this.#dependencies;
    this.#requirePlan(plan);
    const final = await this.#record(descriptor.finalPath);
    if (final !== null) {
      const which = await this.#which(final);
      if (which === null) return refuse("update_executor_record_unbound", descriptor.finalPath);
      await this.#requireStaged(descriptor.initialStaged, "absent");
      if (which === "initial") await this.#requireStaged(descriptor.terminalStaged, "present");
      else await this.#requireStaged(descriptor.terminalStaged, "absent");
      return;
    }
    const staged = await this.#requireStaged(descriptor.initialStaged, "present");
    await this.#requireStaged(descriptor.terminalStaged, "present");
    await fs.renameNoReplace(staged, descriptor.finalPath);
    this.#dependencies.interrupt?.("initial_renamed");
    await this.#syncParents(descriptor.finalPath, descriptor.initialStaged.path);
    this.#dependencies.interrupt?.("initial_synced");
    const reopened = await this.#record(descriptor.finalPath);
    if (reopened?.ino !== staged.ino || reopened.dev !== staged.dev || (await this.#which(reopened)) !== "initial") refuse("update_executor_record_reopen", descriptor.finalPath);
  }

  async switchToFallback(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void> {
    const { descriptor } = this.#dependencies;
    this.#requirePlan(plan);
    const final = await this.#record(descriptor.finalPath);
    if (final === null) return refuse("update_executor_record_missing", descriptor.finalPath);
    const which = await this.#which(final);
    if (which === "terminal") {
      await this.#requireStaged(descriptor.terminalStaged, "absent");
      return;
    }
    if (which !== "initial") return refuse("update_executor_record_unbound", descriptor.finalPath);
    const staged = await this.#requireStaged(descriptor.terminalStaged, "present");
    await (this.#dependencies.replaceAcross ?? replaceExecutorRecordAcross)(staged, final);
    this.#dependencies.interrupt?.("terminal_replaced");
    await this.#syncParents(descriptor.finalPath, descriptor.terminalStaged.path);
    this.#dependencies.interrupt?.("terminal_synced");
    const reopened = await this.#record(descriptor.finalPath);
    if (reopened?.ino !== staged.ino || reopened.dev !== staged.dev || (await this.#which(reopened)) !== "terminal") refuse("update_executor_record_reopen", descriptor.finalPath);
  }

  async removeRecord(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void> {
    const { fs, descriptor } = this.#dependencies;
    this.#requirePlan(plan);
    const final = await this.#record(descriptor.finalPath);
    if (final === null) return;
    if ((await this.#which(final)) !== "terminal") return refuse("update_executor_record_not_terminal", descriptor.finalPath);
    await fs.unlinkExact(final);
    this.#dependencies.interrupt?.("record_unlinked");
    await this.#syncParents(descriptor.finalPath);
  }

  #requirePlan(plan: UpdateLifecycleCoordinatorPlanV2): void {
    const { descriptor } = this.#dependencies;
    if (plan.id !== descriptor.initial.coordinatorId || plan.recoveryExecutorInitialHash !== descriptor.initialStaged.hash || plan.recoveryExecutorTerminalHash !== descriptor.terminalStaged.hash) {
      refuse("update_executor_plan_binding", descriptor.finalPath);
    }
  }

  async #record(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return null;
    if (entry.kind !== "regular_file" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== RECORD_MODE || entry.nlink !== 1 || BigInt(entry.size) > BigInt(this.#dependencies.descriptor.maximumRecordBytes)) {
      refuse("update_executor_record_shape", path);
    }
    return entry;
  }

  /** Which plan-bound record these exact bytes are, by length and content hash; null is neither. */
  async #which(entry: LifecycleGuardedEntryV1): Promise<"initial" | "terminal" | null> {
    const { descriptor, fs } = this.#dependencies;
    const hash = await fs.hashRegular(entry, BigInt(descriptor.maximumRecordBytes));
    if (this.#is(entry, hash, descriptor.initialStaged)) return "initial";
    if (this.#is(entry, hash, descriptor.terminalStaged)) return "terminal";
    return null;
  }

  #is(entry: LifecycleGuardedEntryV1, hash: string, staged: UpdateRecoveryExecutorStagedFileV1): boolean {
    return BigInt(entry.size) === BigInt(staged.bytes) && hash === staged.hash;
  }

  /** A stage is either the complete planned bytes or absent; a partial or foreign inode is exit 6. */
  async #requireStaged(staged: UpdateRecoveryExecutorStagedFileV1, expected: "present"): Promise<LifecycleGuardedEntryV1>;
  async #requireStaged(staged: UpdateRecoveryExecutorStagedFileV1, expected: "absent"): Promise<null>;
  async #requireStaged(staged: UpdateRecoveryExecutorStagedFileV1, expected: "present" | "absent"): Promise<LifecycleGuardedEntryV1 | null> {
    const entry = await this.#record(staged.path);
    if (expected === "absent") {
      if (entry !== null) refuse("update_executor_stage_present", staged.path);
      return null;
    }
    if (entry === null) return refuse("update_executor_stage_incomplete", staged.path);
    if (!this.#is(entry, await this.#dependencies.fs.hashRegular(entry, BigInt(staged.bytes)), staged)) refuse("update_executor_stage_content", staged.path);
    return entry;
  }

  async #syncParents(...paths: readonly CanonicalAbsolutePathV1[]): Promise<void> {
    for (const path of new Set(paths.map(parentOf))) {
      const parent = await this.#dependencies.fs.lstat(path);
      if (parent?.kind !== "directory") refuse("update_executor_parent", path);
      await this.#dependencies.fs.syncDirectory(parent);
    }
  }
}

/**
 * Reads the optional `state/update-executor.json`; fresh `init`'s empty reservation is no record,
 * and malformed or foreign bytes are exit 6, never absence.
 */
export async function readUpdateExecutorRecord(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
  evidence: CanonicalPathEvidenceV1,
): Promise<{ readonly entry: LifecycleGuardedEntryV1; readonly record: UpdateRecoveryExecutorRecordV1 } | null> {
  const path = deriveUpdateExecutorRecordPath(productHome);
  const entry = await fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== effectiveUid || entry.mode !== RECORD_MODE || entry.nlink !== 1 || BigInt(entry.size) > 16_384n) refuse("update_executor_record_shape", path);
  let record: ReturnType<typeof decodeUpdateExecutorRecordSlot>;
  try {
    record = decodeUpdateExecutorRecordSlot(await fs.readRegular(entry, 16_384), evidence);
  } catch {
    return refuse("update_executor_record_malformed", path);
  }
  return record === "reservation" ? null : { entry, record };
}

/**
 * The `update_executor_cleanup` suffix: an otherwise clear ledger, no coordinator envelope, and one
 * `terminal_cleanup` record for exactly this coordinator. Only that record is unlinked.
 */
export async function removeOrphanTerminalExecutorRecord(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
  evidence: CanonicalPathEvidenceV1,
  coordinatorId: LifecycleCoordinatorIdV1,
): Promise<void> {
  const held = await readUpdateExecutorRecord(fs, productHome, effectiveUid, evidence);
  if (held === null) return;
  if (held.record.state !== "terminal_cleanup" || held.record.coordinatorId !== coordinatorId) refuse("update_executor_record_not_terminal", held.entry.path);
  await fs.unlinkExact(held.entry);
  const parent = await fs.lstat(parentOf(held.entry.path));
  if (parent?.kind !== "directory") refuse("update_executor_parent", held.entry.path);
  await fs.syncDirectory(parent);
}

/**
 * Recovery routing needs only local authority: there is deliberately no transport, planner, or
 * scratch port here, so no recovery arm can reach the network or rerun the target planner.
 */
export interface UpdateRecoveryRoutesV1 {
  readonly coordinator: { recover(id: LifecycleCoordinatorIdV1): Promise<UpdateLifecycleOutcomeV1> };
  readonly envelope: {
    isEnvelopeSuffix(id: LifecycleCoordinatorIdV1): Promise<boolean>;
    /** Returns the removed plan's `executionBindingHash`. */
    completeEnvelopeSuffix(id: LifecycleCoordinatorIdV1): Promise<LowerHexSha256>;
  };
  readonly construction: { compensate(closure: Extract<LifecycleJournalClosureV2, { readonly kind: "update_construction_cleanup" }>): Promise<void> };
  readonly executorCleanup: (id: LifecycleCoordinatorIdV1) => Promise<void>;
}

export type UpdateRecoveryRouteOutcomeV1 =
  | { readonly kind: "not_update" }
  | { readonly kind: "coordinator"; readonly outcome: UpdateLifecycleOutcomeV1 }
  | { readonly kind: "envelope_suffix"; readonly coordinatorId: LifecycleCoordinatorIdV1; readonly executionBindingHash: LowerHexSha256 }
  | { readonly kind: "construction_cleaned"; readonly coordinatorId: LifecycleCoordinatorIdV1 }
  | { readonly kind: "executor_cleaned"; readonly coordinatorId: LifecycleCoordinatorIdV1 };

/** Dispatches one V2 closure arm; every V1 arm is left to Spec 1's recovery service. */
export async function routeUpdateRecovery(closure: LifecycleJournalClosureV2, routes: UpdateRecoveryRoutesV1): Promise<UpdateRecoveryRouteOutcomeV1> {
  switch (closure.kind) {
    case "update_recovery": {
      if (await routes.envelope.isEnvelopeSuffix(closure.coordinatorId)) {
        const executionBindingHash = await routes.envelope.completeEnvelopeSuffix(closure.coordinatorId);
        await routes.executorCleanup(closure.coordinatorId);
        return { kind: "envelope_suffix", coordinatorId: closure.coordinatorId, executionBindingHash };
      }
      return { kind: "coordinator", outcome: await routes.coordinator.recover(closure.coordinatorId) };
    }
    case "update_construction_cleanup":
      await routes.construction.compensate(closure);
      return { kind: "construction_cleaned", coordinatorId: closure.coordinatorId };
    case "update_executor_cleanup":
      await routes.executorCleanup(closure.coordinatorId);
      return { kind: "executor_cleaned", coordinatorId: closure.coordinatorId };
    default:
      return { kind: "not_update" };
  }
}
