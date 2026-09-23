import {
  forwardFoundationRefs,
  parseCanonicalAbsolutePathText,
  updateParticipantDocumentHash,
  validateSchemaMigrationExecutionJournal,
  type CanonicalAbsolutePathV1,
  type ImmutableUpdatePlanRefV1,
  type SchemaMigrationExecutionJournalV1,
  type SchemaMigrationPlanV1,
  type UpdateFoundationParticipantRefV2,
  type UpdateInitialJournalRefV1,
  type UpdateParticipantObservationV1,
} from "@developer-os/core";

import { compensateForwardRef, type UpdateFoundationPortV1, type UpdateTargetHashPortV1 } from "./owner-participant.js";
import { participantTimestamp, refuseParticipant, type UpdateParticipantJournalStore } from "./state-participant.js";

export interface SchemaMigrationParticipantDependenciesV1 {
  readonly journals: UpdateParticipantJournalStore;
  readonly foundation: UpdateFoundationPortV1;
  readonly hashTarget: UpdateTargetHashPortV1;
  /** The admitted Brain root that vault-relative mutation paths resolve under. */
  readonly brainRoot: CanonicalAbsolutePathV1;
  readonly now: () => Date;
}

export interface SchemaMigrationStepV1 {
  readonly plan: SchemaMigrationPlanV1;
  readonly planRef: ImmutableUpdatePlanRefV1<"schema_migration">;
  readonly journal: UpdateInitialJournalRefV1;
}

/**
 * Spec 2 §8.4/§9.2's schema migration: the concurrent precondition is every before hash, then the
 * forward-role Foundation refs in ID order, then the complete after-hash set. Compensation walks the
 * reached refs in reverse through their paired inverse transactions.
 */
export class SchemaMigrationParticipant {
  readonly #dependencies: SchemaMigrationParticipantDependenciesV1;

  constructor(dependencies: SchemaMigrationParticipantDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async apply(step: SchemaMigrationStepV1): Promise<UpdateParticipantObservationV1> {
    let journal = await this.openJournal(step);
    if (journal.phase === "verified" || journal.phase === "finalized") return { state: "verified" };
    if (journal.phase === "planned") {
      await this.requireHashes(step.plan, "before");
      journal = await this.persist(step, { ...journal, phase: "applying" });
    }
    if (journal.phase !== "applying") return refuseParticipant("update_migration_journal_direction", step.journal.finalPath);
    const forward = forwardFoundationRefs(step.plan.foundation);
    while (journal.nextForwardFoundation < forward.length) {
      await this.#dependencies.foundation.apply(forward[journal.nextForwardFoundation] as UpdateFoundationParticipantRefV2);
      journal = await this.persist(step, { ...journal, nextForwardFoundation: journal.nextForwardFoundation + 1 });
    }
    await this.requireHashes(step.plan, "after");
    await this.persist(step, { ...journal, phase: "verified" });
    return { state: "verified" };
  }

  async observe(step: SchemaMigrationStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    const journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    return { state: journal.phase === "verified" || journal.phase === "finalized" ? "verified" : "applied" };
  }

  async compensate(step: SchemaMigrationStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    let journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    if (journal.phase === "finalized" || journal.phase === "compacting") return refuseParticipant("update_migration_compensation_after_terminal", step.journal.finalPath);
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
    await this.requireHashes(step.plan, "before");
    await this.persist(step, { ...journal, phase: "rolled_back", compensationNext: -1 });
    return { state: "compensated" };
  }

  async finalize(step: SchemaMigrationStepV1): Promise<void> {
    const journal = await this.openJournal(step);
    if (journal.phase === "finalized") return;
    if (journal.phase !== "verified") refuseParticipant("update_migration_finalize_before_verified", step.journal.finalPath);
    await this.persist(step, { ...journal, phase: "finalized" });
  }

  /** The `schema_migration` compaction entry: paired refs in ID order, the journal, then the plan. */
  async compact(step: SchemaMigrationStepV1): Promise<void> {
    const { journals, foundation } = this.#dependencies;
    if (!(await journals.unreached(step.journal))) {
      let journal = await this.openJournal(step);
      if (journal.phase === "finalized" || journal.phase === "rolled_back") journal = await this.persist(step, { ...journal, phase: "compacting", compactionNext: 0 });
      if (journal.phase !== "compacting" || journal.compactionNext === null) return refuseParticipant("update_migration_compaction_not_terminal", step.journal.finalPath);
      while (journal.compactionNext !== null && journal.compactionNext < step.plan.foundation.length) {
        await foundation.compact(step.plan.foundation[journal.compactionNext] as UpdateFoundationParticipantRefV2);
        journal = await this.persist(step, { ...journal, compactionNext: journal.compactionNext + 1 });
      }
      await journals.remove(step.journal.finalPath);
    }
    await journals.remove(step.planRef.path, step.planRef.hash);
  }

  private async openJournal(step: SchemaMigrationStepV1): Promise<SchemaMigrationExecutionJournalV1> {
    const { plan, planRef, journal } = step;
    if (planRef.hash !== updateParticipantDocumentHash(plan) || planRef.id !== plan.id || journal.kind !== "schema_migration" || journal.id !== plan.id || journal.planHash !== planRef.hash) refuseParticipant("update_migration_binding", journal.finalPath);
    return validateSchemaMigrationExecutionJournal(await this.#dependencies.journals.open(journal), plan);
  }

  private async persist(step: SchemaMigrationStepV1, journal: SchemaMigrationExecutionJournalV1): Promise<SchemaMigrationExecutionJournalV1> {
    const next = { ...journal, updatedAt: participantTimestamp(this.#dependencies.now, journal.updatedAt) };
    await this.#dependencies.journals.rewrite(step.journal.finalPath, next);
    return next;
  }

  private async requireHashes(plan: SchemaMigrationPlanV1, side: "before" | "after"): Promise<void> {
    for (const mutation of plan.mutations) {
      const target = plan.domain === "brain" ? parseCanonicalAbsolutePathText(`${this.#dependencies.brainRoot}/${mutation.path}`) : parseCanonicalAbsolutePathText(mutation.path);
      if ((await this.#dependencies.hashTarget(target)) !== (side === "before" ? mutation.beforeHash : mutation.afterHash)) refuseParticipant(`update_migration_${side}_hash`, target);
    }
  }
}
