import {
  forwardFoundationRefs,
  pairedCompensationRef,
  rejectUpdateStep,
  TransactionPreconditionError,
  updateParticipantDocumentHash,
  UpdateStepRejectedError,
  validateOwnerUpdateJournal,
  type CanonicalAbsolutePathV1,
  type ImmutableUpdatePlanRefV1,
  type LowerHexSha256,
  type OwnerUpdateJournalV1,
  type OwnerUpdatePlanV1,
  type UpdateFoundationParticipantRefV2,
  type UpdateInitialJournalRefV1,
  type UpdateParticipantObservationV1,
} from "@developer-os/core";

import type { OwnerExternalEffectParticipant, OwnerExternalEffectStepV1 } from "./external-effect.js";
import { participantTimestamp, refuseParticipant, type UpdateParticipantJournalStore } from "./state-participant.js";

/**
 * Spec 1's Foundation participant over a V2 update ref. It publishes the ref's evidence-bound staged
 * initial journal, runs the transaction with its caller-supplied preconditions, and resumes from
 * that journal; composition binds it to the shipped executor. A transaction that refuses its
 * precondition either throws `TransactionPreconditionError` or returns and observes `rolled_back`.
 */
export interface UpdateFoundationPortV1 {
  apply(ref: UpdateFoundationParticipantRefV2): Promise<void>;
  observe(ref: UpdateFoundationParticipantRefV2): Promise<"future" | "partial" | "committed" | "rolled_back">;
  /** Rolls back an interrupted forward transaction through its own journal. */
  rollback(ref: UpdateFoundationParticipantRefV2): Promise<void>;
  compact(ref: UpdateFoundationParticipantRefV2): Promise<void>;
}

/** Guarded current content hash of one target, or null when absent. */
export type UpdateTargetHashPortV1 = (path: CanonicalAbsolutePathV1) => Promise<LowerHexSha256 | null>;

/**
 * Runs one forward ref. A transaction that refused its precondition or rolled itself back left its
 * targets untouched, so it is a §9.4 rejection the coordinator compensates, not a third state.
 */
export async function applyForwardRef(foundation: UpdateFoundationPortV1, ref: UpdateFoundationParticipantRefV2): Promise<void> {
  try {
    await foundation.apply(ref);
  } catch (error) {
    if (error instanceof TransactionPreconditionError) throw new UpdateStepRejectedError("update_foundation_rolled_back", [ref.initialJournal.finalPath], { cause: error });
    throw error;
  }
  if ((await foundation.observe(ref)) === "rolled_back") rejectUpdateStep("update_foundation_rolled_back", ref.initialJournal.finalPath);
}

/**
 * The targets compensation must find restored: those of forward refs that committed and were
 * inverted. A ref never begun or rolled back by its own executor left its targets as it found
 * them, which after a rejected drift is the concurrent edit this update must not overwrite.
 */
export async function committedForwardTargets(foundation: UpdateFoundationPortV1, refs: readonly UpdateFoundationParticipantRefV2[]): Promise<ReadonlySet<string>> {
  const targets = new Set<string>();
  // ponytail: a partial ref this update rolled back also reads `rolled_back`, so its restore is trusted to the executor; re-verify it if refs gain a refusal-versus-rollback observation.
  for (const ref of forwardFoundationRefs(refs)) {
    if ((await foundation.observe(ref)) === "committed") for (const mutation of ref.mutations) targets.add(mutation.targetPath);
  }
  return targets;
}

/** Reverses one forward ref by its reached state: committed pairs its compensation, partial rolls back. */
export async function compensateForwardRef(foundation: UpdateFoundationPortV1, refs: readonly UpdateFoundationParticipantRefV2[], forward: UpdateFoundationParticipantRefV2): Promise<void> {
  const state = await foundation.observe(forward);
  if (state === "committed") await foundation.apply(pairedCompensationRef(refs, forward));
  else if (state === "partial") await foundation.rollback(forward);
}

export interface OwnerUpdateParticipantDependenciesV1 {
  readonly journals: UpdateParticipantJournalStore;
  readonly foundation: UpdateFoundationPortV1;
  readonly effects: Pick<OwnerExternalEffectParticipant, "apply" | "compensate" | "finalize">;
  readonly hashTarget: UpdateTargetHashPortV1;
  readonly now: () => Date;
}

export interface OwnerUpdateStepV1 {
  readonly plan: OwnerUpdatePlanV1;
  readonly planRef: ImmutableUpdatePlanRefV1<"owner_update">;
  readonly journal: UpdateInitialJournalRefV1;
  readonly effect: OwnerExternalEffectStepV1 | null;
}

/**
 * Spec 2 §9.2/§9.3's owner participant: forward-role Foundation refs in ID order, then the one
 * external effect. Compensation restores files before the effect, because a Codex refresh re-reads
 * the marketplace root and can only reach its expected projection over the restored files.
 */
export class OwnerUpdateParticipant {
  readonly #dependencies: OwnerUpdateParticipantDependenciesV1;

  constructor(dependencies: OwnerUpdateParticipantDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async apply(step: OwnerUpdateStepV1): Promise<UpdateParticipantObservationV1> {
    await this.applyFiles(step);
    return this.applyEffects(step);
  }

  /** The `owner_files/forward` step. */
  async applyFiles(step: OwnerUpdateStepV1): Promise<UpdateParticipantObservationV1> {
    let journal = await this.openJournal(step);
    if (journal.phase === "effects_applying" || journal.phase === "verified" || journal.phase === "finalized") return { state: "applied" };
    if (journal.phase === "planned") {
      await this.requirePreconditions(step.plan, null, rejectUpdateStep);
      journal = await this.persist(step, { ...journal, phase: "files_applying" });
    }
    if (journal.phase !== "files_applying") return refuseParticipant("update_owner_journal_direction", step.journal.finalPath);
    const forward = forwardFoundationRefs(step.plan.foundation);
    while (journal.nextForwardFoundation < forward.length) {
      await applyForwardRef(this.#dependencies.foundation, forward[journal.nextForwardFoundation] as UpdateFoundationParticipantRefV2);
      journal = await this.persist(step, { ...journal, nextForwardFoundation: journal.nextForwardFoundation + 1 });
    }
    await this.requirePostimages(step.plan);
    await this.persist(step, { ...journal, phase: step.plan.externalEffects.length === 0 ? "verified" : "effects_applying" });
    return { state: "applied" };
  }

  /** The `owner_external_effect/forward` step; a no-op for an owner without an effect. */
  async applyEffects(step: OwnerUpdateStepV1): Promise<UpdateParticipantObservationV1> {
    const journal = await this.openJournal(step);
    if (journal.phase === "verified" || journal.phase === "finalized") return { state: "verified" };
    if (journal.phase !== "effects_applying" || step.effect === null) return refuseParticipant("update_owner_journal_direction", step.journal.finalPath);
    await this.#dependencies.effects.apply(step.effect);
    await this.persist(step, { ...journal, phase: "verified", nextExternalEffect: 1 });
    return { state: "verified" };
  }

  async observe(step: OwnerUpdateStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    const journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    return { state: journal.phase === "verified" || journal.phase === "finalized" ? "verified" : "applied" };
  }

  /** Either owner step's inverse: files back to their preimage, then the effect, then `rolled_back`. */
  async compensate(step: OwnerUpdateStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    let journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    if (journal.phase === "finalized" || journal.phase === "compacting") return refuseParticipant("update_owner_compensation_after_terminal", step.journal.finalPath);
    const refs = step.plan.foundation;
    const forward = forwardFoundationRefs(refs);
    if (journal.phase !== "compensating") {
      const reached = journal.nextForwardFoundation;
      // The ref at `reached` may be partially applied before the journal counted it.
      if (reached < forward.length) await compensateForwardRef(this.#dependencies.foundation, refs, forward[reached] as UpdateFoundationParticipantRefV2);
      journal = await this.persist(step, { ...journal, phase: "compensating", compensationNext: reached - 1 });
    }
    while (journal.compensationNext !== null && journal.compensationNext >= 0) {
      await compensateForwardRef(this.#dependencies.foundation, refs, forward[journal.compensationNext] as UpdateFoundationParticipantRefV2);
      journal = await this.persist(step, { ...journal, compensationNext: journal.compensationNext - 1 });
    }
    await this.requirePreconditions(step.plan, await committedForwardTargets(this.#dependencies.foundation, refs), refuseParticipant);
    if (step.effect !== null) await this.#dependencies.effects.compensate(step.effect);
    await this.persist(step, { ...journal, phase: "rolled_back", compensationNext: -1 });
    return { state: "compensated" };
  }

  /** Terminal, after the point of no return. */
  async finalize(step: OwnerUpdateStepV1): Promise<void> {
    const journal = await this.openJournal(step);
    if (journal.phase === "finalized") return;
    if (journal.phase !== "verified") refuseParticipant("update_owner_finalize_before_verified", step.journal.finalPath);
    if (step.effect !== null) await this.#dependencies.effects.finalize(step.effect);
    await this.persist(step, { ...journal, phase: "finalized" });
  }

  /** The `owner_update` compaction entry: every paired Foundation ref in ID order, the journal, then the plan. */
  async compact(step: OwnerUpdateStepV1): Promise<void> {
    const { journals, foundation } = this.#dependencies;
    if (!(await journals.unreached(step.journal))) {
      let journal = await this.openJournal(step);
      if (journal.phase === "finalized" || journal.phase === "rolled_back") journal = await this.persist(step, { ...journal, phase: "compacting", compactionNext: 0 });
      if (journal.phase !== "compacting" || journal.compactionNext === null) return refuseParticipant("update_owner_compaction_not_terminal", step.journal.finalPath);
      while (journal.compactionNext !== null && journal.compactionNext < step.plan.foundation.length) {
        await foundation.compact(step.plan.foundation[journal.compactionNext] as UpdateFoundationParticipantRefV2);
        journal = await this.persist(step, { ...journal, compactionNext: journal.compactionNext + 1 });
      }
      await journals.remove(step.journal.finalPath);
    }
    await journals.remove(step.planRef.path, step.planRef.hash);
  }

  private async openJournal(step: OwnerUpdateStepV1): Promise<OwnerUpdateJournalV1> {
    const { plan, planRef, journal, effect } = step;
    if (planRef.hash !== updateParticipantDocumentHash(plan) || planRef.id !== plan.id || journal.kind !== "owner_update" || journal.id !== plan.id || journal.planHash !== planRef.hash) refuseParticipant("update_owner_binding", journal.finalPath);
    if ((effect === null) !== (plan.externalEffects.length === 0) || (effect !== null && effect.planRef.hash !== plan.externalEffects[0]?.hash)) refuseParticipant("update_owner_effect_binding", journal.finalPath);
    return validateOwnerUpdateJournal(await this.#dependencies.journals.open(journal), plan);
  }

  private async persist(step: OwnerUpdateStepV1, journal: OwnerUpdateJournalV1): Promise<OwnerUpdateJournalV1> {
    const next = { ...journal, updatedAt: participantTimestamp(this.#dependencies.now, journal.updatedAt) };
    await this.#dependencies.journals.rewrite(step.journal.finalPath, next);
    return next;
  }

  /**
   * Concurrent-edit guard: every changed target in `scope` (all when null) still holds its
   * plan-bound preimage. Before the first row a mismatch is a rejection; after compensation it is
   * a third state.
   */
  private async requirePreconditions(plan: OwnerUpdatePlanV1, scope: ReadonlySet<string> | null, refuse: (reason: string, ...paths: readonly string[]) => never): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.operation === "keep" || (scope !== null && !scope.has(operation.targetPath))) continue;
      const expected = operation.expectedBefore.state === "file" ? operation.expectedBefore.hash : null;
      if ((await this.#dependencies.hashTarget(operation.targetPath)) !== expected) refuse("update_owner_precondition", operation.targetPath);
    }
  }

  private async requirePostimages(plan: OwnerUpdatePlanV1): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.operation === "keep") continue;
      const expected = operation.content?.sha256 ?? null;
      if ((await this.#dependencies.hashTarget(operation.targetPath)) !== expected) refuseParticipant("update_owner_postimage", operation.targetPath);
    }
  }
}
