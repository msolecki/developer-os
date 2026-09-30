import {
  LifecycleRecoveryRequiredError,
  decodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  readLifecycleExecutionPlanV2,
  updateCoordinatorEnvelopePaths,
  updateCoordinatorJournalBytes,
  updateCoordinatorPlanHash,
  validateUpdateCoordinatorJournal,
  MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES,
  type CanonicalAbsolutePathV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type UpdateCompactionEntryV1,
  type UpdateCoordinatorParticipantsV1,
  type UpdateLifecycleCoordinatorJournalV2,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateLifecycleCoordinatorStepV1,
  type UpdateLifecycleCoordinatorStoreV1,
  type UpdateParticipantObservationV1,
} from "@developer-os/core";

/** Where a test may kill the process; each point follows one durable effect. */
export type UpdateCoordinatorStoreDeathPointV1 =
  | "rewrite_temp_written"
  | "rewrite_renamed"
  | "envelope_journal_removed"
  | "envelope_lock_removed"
  | "envelope_plan_removed";

export const UPDATE_COORDINATOR_STORE_DEATH_POINTS: readonly UpdateCoordinatorStoreDeathPointV1[] = Object.freeze([
  "rewrite_temp_written",
  "rewrite_renamed",
  "envelope_journal_removed",
  "envelope_lock_removed",
  "envelope_plan_removed",
]);

export interface UpdateCoordinatorJournalStoreDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
  readonly uuid: () => string;
  readonly interrupt?: (point: UpdateCoordinatorStoreDeathPointV1) => void;
}

const LOWERCASE_V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const decoder = new TextDecoder();

function refuse(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function lifecycleParentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

function refuseSchemaV1(): never {
  return refuse("update_coordinator_schema_v1");
}

/**
 * The V2 coordinator envelope at Spec 1's exact `state/lifecycle-journals/<id>.plan.json` and
 * `<id>.json`. The construction envelope publishes both at handoff; this store only reads them,
 * rewrites the journal by temp plus rename-over, and removes the envelope journal → lock → plan.
 * Spec 1's `LifecycleCoordinatorStore` is typed to the closed V1 journal, so it is not reused.
 */
export class UpdateCoordinatorJournalStore implements UpdateLifecycleCoordinatorStoreV1 {
  readonly #dependencies: UpdateCoordinatorJournalStoreDependenciesV1;

  constructor(dependencies: UpdateCoordinatorJournalStoreDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async read(id: LifecycleCoordinatorIdV1): Promise<{ readonly plan: UpdateLifecycleCoordinatorPlanV2; readonly journal: UpdateLifecycleCoordinatorJournalV2 }> {
    const { fs, productHome } = this.#dependencies;
    const paths = updateCoordinatorEnvelopePaths(productHome, id);
    const planEntry = await this.#guardedLeaf(paths.plan, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES, "update_coordinator_plan_shape");
    let plan: UpdateLifecycleCoordinatorPlanV2;
    try {
      const dispatched = readLifecycleExecutionPlanV2(await fs.readRegular(planEntry, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES), { v1: refuseSchemaV1, productHome });
      if (dispatched.schemaVersion !== 2) return refuse("update_coordinator_schema_v1", paths.plan);
      plan = dispatched.plan;
    } catch (error) {
      if (error instanceof LifecycleRecoveryRequiredError) throw error;
      return refuse("update_coordinator_plan_bytes", paths.plan);
    }
    if (plan.id !== id) refuse("update_coordinator_plan_identity", paths.plan);
    const journalEntry = await this.#guardedLeaf(paths.journal, plan.maximumJournalBytes, "update_coordinator_journal_shape");
    const bytes = await fs.readRegular(journalEntry, plan.maximumJournalBytes);
    let journal: UpdateLifecycleCoordinatorJournalV2;
    try {
      journal = validateUpdateCoordinatorJournal(decodeCanonicalJson(bytes, plan.maximumJournalBytes), plan, updateCoordinatorPlanHash(plan));
    } catch {
      return refuse("update_coordinator_journal_bytes", paths.journal);
    }
    if (decoder.decode(updateCoordinatorJournalBytes(plan, journal)) !== decoder.decode(bytes)) refuse("update_coordinator_journal_bytes", paths.journal);
    return { plan, journal };
  }

  async rewrite(plan: UpdateLifecycleCoordinatorPlanV2, current: UpdateLifecycleCoordinatorJournalV2, next: UpdateLifecycleCoordinatorJournalV2): Promise<void> {
    const { fs, productHome } = this.#dependencies;
    const paths = updateCoordinatorEnvelopePaths(productHome, plan.id);
    const nextBytes = updateCoordinatorJournalBytes(plan, next);
    const journalEntry = await this.#guardedLeaf(paths.journal, plan.maximumJournalBytes, "update_coordinator_journal_shape");
    const onDisk = await fs.readRegular(journalEntry, plan.maximumJournalBytes);
    if (decoder.decode(onDisk) !== decoder.decode(updateCoordinatorJournalBytes(plan, current))) refuse("update_coordinator_journal_stale", paths.journal);
    const root = await this.#root(paths.journal);
    const temp = await fs.writeExclusive(this.#tempPath(root.path, plan.id), nextBytes);
    this.#dependencies.interrupt?.("rewrite_temp_written");
    await fs.renameOver(temp, journalEntry);
    this.#dependencies.interrupt?.("rewrite_renamed");
    await fs.syncDirectory(root);
  }

  /** Each leaf is removed only while it still is the exact guarded leaf; a resumed removal skips absence. */
  async removeEnvelope(plan: UpdateLifecycleCoordinatorPlanV2, journal: UpdateLifecycleCoordinatorJournalV2): Promise<void> {
    const { fs, productHome } = this.#dependencies;
    const paths = updateCoordinatorEnvelopePaths(productHome, plan.id);
    if (journal.phase !== "compacting" || journal.compactionNext !== plan.compaction.entries.length - 1) refuse("update_coordinator_envelope_early", paths.journal);
    const root = await this.#root(paths.journal);
    const journalEntry = await fs.lstat(paths.journal);
    if (journalEntry !== null) {
      await this.#guardedLeaf(paths.journal, plan.maximumJournalBytes, "update_coordinator_journal_shape");
      await fs.unlinkExact(journalEntry);
      await fs.syncDirectory(root);
    }
    this.#dependencies.interrupt?.("envelope_journal_removed");
    const lock = await fs.lstat(parseCanonicalAbsolutePathText(`${root.path}/.${plan.id}.lock`));
    if (lock !== null) {
      if (lock.kind !== "regular_file" || lock.ownerUid !== this.#dependencies.effectiveUid) refuse("update_coordinator_lock_shape", lock.path);
      await fs.unlinkExact(lock);
      await fs.syncDirectory(root);
    }
    this.#dependencies.interrupt?.("envelope_lock_removed");
    const planEntry = await this.#guardedLeaf(paths.plan, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES, "update_coordinator_plan_shape");
    await fs.unlinkExact(planEntry);
    await fs.syncDirectory(root);
    this.#dependencies.interrupt?.("envelope_plan_removed");
  }

  /** Collected before any unlink; each temp must still be the owner-only single-link leaf it was. */
  async removeRewriteTemps(plan: UpdateLifecycleCoordinatorPlanV2): Promise<void> {
    const { fs, productHome } = this.#dependencies;
    const root = await this.#root(updateCoordinatorEnvelopePaths(productHome, plan.id).journal);
    const prefix = `.${plan.id}.`;
    const temps: CanonicalAbsolutePathV1[] = [];
    for await (const name of fs.names(root)) {
      if (name.startsWith(prefix) && name.endsWith(".json.tmp") && LOWERCASE_V4_UUID.test(name.slice(prefix.length, -".json.tmp".length))) {
        temps.push(parseCanonicalAbsolutePathText(`${root.path}/${name}`));
      }
    }
    for (const temp of temps) await fs.unlinkExact(await this.#guardedLeaf(temp, plan.maximumJournalBytes, "update_coordinator_temp_shape"));
    if (temps.length > 0) await fs.syncDirectory(root);
  }

  /** The Spec 1 plan-only envelope suffix: the journal is already gone, so only lock and plan remain. */
  async isEnvelopeSuffix(id: LifecycleCoordinatorIdV1): Promise<boolean> {
    const paths = updateCoordinatorEnvelopePaths(this.#dependencies.productHome, id);
    return (await this.#dependencies.fs.lstat(paths.journal)) === null && (await this.#dependencies.fs.lstat(paths.plan)) !== null;
  }

  async completeEnvelopeSuffix(id: LifecycleCoordinatorIdV1): Promise<void> {
    const { fs, productHome } = this.#dependencies;
    const paths = updateCoordinatorEnvelopePaths(productHome, id);
    if (!(await this.isEnvelopeSuffix(id))) refuse("update_coordinator_not_envelope_suffix", paths.plan);
    const root = await this.#root(paths.plan);
    const lock = await fs.lstat(parseCanonicalAbsolutePathText(`${root.path}/.${id}.lock`));
    if (lock !== null) {
      if (lock.kind !== "regular_file" || lock.ownerUid !== this.#dependencies.effectiveUid) refuse("update_coordinator_lock_shape", lock.path);
      await fs.unlinkExact(lock);
      await fs.syncDirectory(root);
    }
    this.#dependencies.interrupt?.("envelope_lock_removed");
    await fs.unlinkExact(await this.#guardedLeaf(paths.plan, MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES, "update_coordinator_plan_shape"));
    await fs.syncDirectory(root);
    this.#dependencies.interrupt?.("envelope_plan_removed");
  }

  async #root(leaf: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    const path = lifecycleParentPath(leaf);
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry?.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o700) refuse("lifecycle_ledger_root_shape", path);
    return entry;
  }

  async #guardedLeaf(path: CanonicalAbsolutePathV1, maximumBytes: number, reason: string): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry?.kind !== "regular_file" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(maximumBytes)) refuse(reason, path);
    return entry;
  }

  #tempPath(root: CanonicalAbsolutePathV1, id: LifecycleCoordinatorIdV1): CanonicalAbsolutePathV1 {
    const uuid = this.#dependencies.uuid();
    if (!LOWERCASE_V4_UUID.test(uuid)) throw new Error("invalid update coordinator temporary uuid");
    return parseCanonicalAbsolutePathText(`${root}/.${id}.${uuid}.json.tmp`);
  }
}

type StepOf<TKind extends UpdateLifecycleCoordinatorStepV1["kind"]> = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: TKind }>;
type ParticipantStepKindV1 = Exclude<UpdateLifecycleCoordinatorStepV1["kind"], "recovery_executor" | "terminal_retire">;
type CompactionKindV1 = Exclude<UpdateCompactionEntryV1["kind"], "coordinator_envelope">;

/** One participant as the coordinator drives it; each method resumes from its own journal. */
export interface UpdateStepHandlerV1<TStep> {
  apply(step: TStep): Promise<UpdateParticipantObservationV1>;
  observe(step: TStep): Promise<UpdateParticipantObservationV1>;
  compensate(step: TStep): Promise<UpdateParticipantObservationV1>;
}

/** Task 24 binds each arm to its Task 19–21 participant and the reopened leaf plan. */
export type UpdateStepHandlersV1 = { readonly [TKind in ParticipantStepKindV1]: UpdateStepHandlerV1<StepOf<TKind>> };

export type UpdateCompactionHandlersV1 = {
  readonly [TKind in CompactionKindV1]: (entry: Extract<UpdateCompactionEntryV1, { readonly kind: TKind }>) => Promise<void>;
};

export interface UpdateRetirementHandlerV1 {
  leaves(step: StepOf<"terminal_retire">): Promise<number>;
  retire(step: StepOf<"terminal_retire">, ordinal: number): Promise<void>;
}

/**
 * The step → participant dispatcher the core engine drives. The executor switch and the envelope
 * are the engine's own ports, so they have no participant arm and reaching one here is exit 6.
 */
export class UpdateStepDispatcher implements UpdateCoordinatorParticipantsV1 {
  readonly #steps: UpdateStepHandlersV1;
  readonly #compaction: UpdateCompactionHandlersV1;
  readonly #retirement: UpdateRetirementHandlerV1;

  constructor(steps: UpdateStepHandlersV1, compaction: UpdateCompactionHandlersV1, retirement: UpdateRetirementHandlerV1) {
    this.#steps = steps;
    this.#compaction = compaction;
    this.#retirement = retirement;
  }

  async apply(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1> {
    return this.#handler(step).apply(step);
  }

  async observe(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1> {
    return this.#handler(step).observe(step);
  }

  async compensate(step: UpdateLifecycleCoordinatorStepV1): Promise<UpdateParticipantObservationV1> {
    return this.#handler(step).compensate(step);
  }

  async compact(entry: UpdateCompactionEntryV1): Promise<void> {
    if (entry.kind === "coordinator_envelope") return refuse("update_dispatch_envelope");
    const handler = this.#compaction[entry.kind] as (value: UpdateCompactionEntryV1) => Promise<void>;
    return handler(entry);
  }

  retirementLeaves(step: StepOf<"terminal_retire">): Promise<number> {
    return this.#retirement.leaves(step);
  }

  retireLeaf(step: StepOf<"terminal_retire">, ordinal: number): Promise<void> {
    return this.#retirement.retire(step, ordinal);
  }

  #handler(step: UpdateLifecycleCoordinatorStepV1): UpdateStepHandlerV1<UpdateLifecycleCoordinatorStepV1> {
    if (step.kind === "recovery_executor" || step.kind === "terminal_retire") return refuse("update_dispatch_engine_step");
    return this.#steps[step.kind];
  }
}
