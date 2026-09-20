/**
 * Spec 1 §2.4's coordinator execution engine. It drives only the persisted plan and
 * journal: the phase and cursor are written before each participant call and the
 * participant's durable state before every advance, direction is decided from
 * `LIFECYCLE_POINT_OF_NO_RETURN` plus the participant phases, and every external
 * effect reaches the process through an injected adapter. Core imports no Git,
 * launchd, Security or CLI type.
 */
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { TransactionPhase } from "../transactions/types.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseSafeReasonCode,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type UtcTimestampV1,
} from "../update/scalars.js";
import type { FoundationParticipantExecutor } from "./foundation-participant.js";
import {
  LIFECYCLE_POINT_OF_NO_RETURN,
  derivedCoordinatorPhase,
  pointOfNoReturnStepIndex,
  validateCoordinatorJournalForPlan,
  validateLifecyclePlanGrammar,
  type LifecycleOperationVariantV1,
  type LifecycleVariantFactsV1,
} from "./grammar.js";
import {
  refuseLifecycleRecovery,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import type { LifecycleCoordinatorStore } from "./store.js";
import type {
  FoundationParticipantRefV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorPhaseV1,
  LifecycleCoordinatorPlanCoreV1,
  LifecycleCoordinatorStepV1,
  LifecycleEffectRefV1,
} from "./types.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

export type LifecycleEffectStateV1 =
  | "future"
  | "planned"
  | "applied"
  | "verified"
  | "finalized"
  | "compensating"
  | "rolled_back";

export interface LifecycleEffectAdapterV1 {
  apply(ref: LifecycleEffectRefV1<string>): Promise<void>;
  finalize(ref: LifecycleEffectRefV1<string>): Promise<void>;
  compensate(ref: LifecycleEffectRefV1<string>): Promise<void>;
  observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1>;
  compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void>;
}

export interface LifecycleParticipantAdaptersV1<TPlan> {
  readonly foundation: FoundationParticipantExecutor;
  readonly manifest: null | {
    preserveBefore(plan: TPlan): Promise<void>;
    publishAfter(plan: TPlan): Promise<void>;
    commitAbsence(plan: TPlan): Promise<void>;
    finalizeTombstones(plan: TPlan): Promise<void>;
    compensate(plan: TPlan): Promise<void>;
    observe(plan: TPlan): Promise<"before" | "preimage_preserved" | "applied" | "compaction_pending">;
  };
  readonly redactionKey: null | {
    stage(plan: TPlan): Promise<void>;
    delete(plan: TPlan): Promise<void>;
    restore(plan: TPlan): Promise<void>;
    observe(plan: TPlan): Promise<"before" | "staged" | "deleted">;
  };
  readonly sourceGitEffect: LifecycleEffectAdapterV1 | null;
  readonly destinationGitEffect: LifecycleEffectAdapterV1 | null;
  readonly launchdBeforeFiles: LifecycleEffectAdapterV1 | null;
  readonly launchdAfterFiles: LifecycleEffectAdapterV1 | null;
  readonly networkPush: null | {
    push(plan: TPlan, pushPlanHash: LowerHexSha256): Promise<"succeeded" | "failed">;
  };
  /** Releases `global`, drains, reacquires; returns the reacquired handle. */
  readonly drainRunners: null | {
    drain(plan: TPlan, global: HeldLifecycleStableLockV1): Promise<HeldLifecycleStableLockV1>;
  };
  readonly controlFiles: {
    removeAllocator(plan: TPlan): Promise<void>;
    removeNonce(plan: TPlan): Promise<void>;
  };
  /**
   * Called before every forward application of `step`, on first execution and on recovery alike,
   * and after every return from it. `before` may release and reacquire `global` (it returns the
   * handle to use) and may refuse; `after` runs only once the step's participant has returned.
   */
  readonly stepHooks?: {
    before(
      plan: TPlan,
      index: number,
      step: LifecycleCoordinatorStepV1,
      global: HeldLifecycleStableLockV1,
    ): Promise<HeldLifecycleStableLockV1>;
    after(plan: TPlan, index: number, step: LifecycleCoordinatorStepV1): Promise<void>;
  };
}

export type LifecycleCoordinatorBoundaryV1 =
  | {
      readonly kind: "journal_rewritten";
      readonly phase: LifecycleCoordinatorPhaseV1;
      readonly nextStep: number;
    }
  | {
      readonly kind: "participant_returned";
      readonly step: number;
      readonly direction: "forward" | "compensation";
    }
  | { readonly kind: "compaction_entry_removed"; readonly index: number }
  | { readonly kind: "control_file_removed"; readonly file: "allocator" | "nonce" }
  | { readonly kind: "envelope_leaf_removed"; readonly leaf: "journal" | "lock" | "plan" };

export type LifecycleCoordinatorOutcomeV1 =
  | { readonly kind: "finalized"; readonly id: LifecycleCoordinatorIdV1 }
  | {
      readonly kind: "rolled_back";
      readonly id: LifecycleCoordinatorIdV1;
      readonly cause: SafeReasonCodeV1;
    }
  | {
      readonly kind: "push_pending";
      readonly id: LifecycleCoordinatorIdV1;
      readonly pushPlanHash: LowerHexSha256;
    };

export interface LifecycleCoordinatorDependenciesV1<TPlan> {
  readonly store: LifecycleCoordinatorStore<TPlan & CoordinatorPlan>;
  readonly adapters: LifecycleParticipantAdaptersV1<TPlan>;
  readonly variantFacts: (plan: TPlan) => LifecycleVariantFactsV1;
  readonly pushPlanHash: (plan: TPlan) => LowerHexSha256 | null;
  readonly clock: () => UtcTimestampV1;
  /**
   * `discardUnstarted` proves no lock and `observe` cannot tell an initial staged journal from a
   * published one whose phase is `staged`; both obligations are the caller's, and both are
   * answered by a guarded `lstat`, so the engine holds the port rather than the two protocols
   * that consume it (Task 15 review, 2026-09-20).
   */
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly afterBoundary?: (boundary: LifecycleCoordinatorBoundaryV1) => void | Promise<void>;
}

/** The cause recorded when recovery finishes a compensation whose originating failure is gone. */
const RESUMED_CAUSE = parseSafeReasonCode("lifecycle_coordinator_compensated");

interface SessionV1<TPlan extends CoordinatorPlan> {
  readonly plan: TPlan;
  readonly variant: LifecycleOperationVariantV1;
  readonly boundary: number;
  journal: LifecycleCoordinatorJournalV1;
  global: HeldLifecycleStableLockV1;
  cause: SafeReasonCodeV1;
  /**
   * A journal that has left `planned` and is being opened again is a resumed coordinator, not a
   * first run, and §2.4 lets it compensate only while its point of no return has not durably
   * crossed — so the direction is chosen once, here, before any participant is called again.
   */
  resumed: boolean;
}

type JournalPatchV1 = Partial<
  Pick<
    LifecycleCoordinatorJournalV1,
    "phase" | "nextStep" | "compensationNext" | "compactionNext" | "terminalOutcome"
  >
>;

export function causeOf(error: unknown): SafeReasonCodeV1 {
  if (error !== null && typeof error === "object" && "reason" in error) {
    try {
      return parseSafeReasonCode(error.reason);
    } catch {
      return RESUMED_CAUSE;
    }
  }
  return RESUMED_CAUSE;
}

/**
 * The global mutation lock's path alone is not the hold: §2.4 binds it to a device and inode, and
 * `discardUnstarted` deletes staged bytes without re-proving either.
 */
export async function requireHeldGlobalLock(
  fs: LifecycleGuardedFileSystemV1,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const observed = await fs.lstat(global.path);
  if (
    observed === null ||
    observed.kind !== "regular_file" ||
    observed.dev !== global.dev ||
    observed.ino !== global.ino
  ) {
    refuseLifecycleRecovery("lifecycle_global_lock_identity", global.path);
  }
}

export function foundationRefById(
  plan: CoordinatorPlan,
  id: string,
): FoundationParticipantRefV1 {
  const ref = plan.participants.foundation.find((candidate) => candidate.id === id);
  if (ref === undefined) {
    refuseLifecycleRecovery("lifecycle_coordinator_participant_absent", plan.authority.productHome);
  }
  return ref;
}

export function effectRefOf(
  plan: CoordinatorPlan,
  step: LifecycleCoordinatorStepV1,
): LifecycleEffectRefV1<string> {
  const arm =
    step.kind === "source_git_effect"
      ? plan.participants.sourceGitEffect
      : step.kind === "destination_git_effect"
        ? plan.participants.destinationGitEffect
        : step.kind === "launchd_before_files"
          ? plan.participants.launchdBeforeFiles
          : step.kind === "launchd_after_files"
            ? plan.participants.launchdAfterFiles
            : null;
  if (arm === null) {
    refuseLifecycleRecovery("lifecycle_coordinator_effect_absent", plan.authority.productHome);
  }
  return arm;
}

function effectAdapterOf<TPlan>(
  adapters: LifecycleParticipantAdaptersV1<TPlan>,
  step: LifecycleCoordinatorStepV1,
  home: CanonicalAbsolutePathV1,
): LifecycleEffectAdapterV1 {
  const adapter =
    step.kind === "source_git_effect"
      ? adapters.sourceGitEffect
      : step.kind === "destination_git_effect"
        ? adapters.destinationGitEffect
        : step.kind === "launchd_before_files"
          ? adapters.launchdBeforeFiles
          : step.kind === "launchd_after_files"
            ? adapters.launchdAfterFiles
            : null;
  if (adapter === null) refuseLifecycleRecovery("lifecycle_coordinator_effect_absent", home);
  return adapter;
}

function isEffectStep(step: LifecycleCoordinatorStepV1): boolean {
  return (
    step.kind === "source_git_effect" ||
    step.kind === "destination_git_effect" ||
    step.kind === "launchd_before_files" ||
    step.kind === "launchd_after_files"
  );
}

export class LifecycleCoordinator<TPlan extends CoordinatorPlan> {
  private readonly dependencies: LifecycleCoordinatorDependenciesV1<TPlan>;

  constructor(dependencies: LifecycleCoordinatorDependenciesV1<TPlan>) {
    this.dependencies = dependencies;
  }

  async execute(
    id: LifecycleCoordinatorIdV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<{
    readonly outcome: LifecycleCoordinatorOutcomeV1;
    readonly global: HeldLifecycleStableLockV1;
  }> {
    const session = await this.open(id, global);
    for (;;) {
      switch (session.journal.phase) {
        case "finalized":
          return { outcome: { kind: "finalized", id }, global: session.global };
        case "rolled_back":
          return {
            outcome: { kind: "rolled_back", id, cause: session.cause },
            global: session.global,
          };
        case "compacting":
          refuseLifecycleRecovery(
            "lifecycle_coordinator_compacting",
            session.plan.authority.productHome,
          );
          break;
        case "compensating":
          await this.compensateOnce(session);
          break;
        default: {
          const outcome = await this.forwardOnce(session);
          if (outcome !== null) return { outcome, global: session.global };
        }
      }
    }
  }

  private async open(
    id: LifecycleCoordinatorIdV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<SessionV1<TPlan>> {
    await requireHeldGlobalLock(this.dependencies.fs, global);
    const { plan, journal } = await this.dependencies.store.read(id);
    if (journal === null) {
      refuseLifecycleRecovery("lifecycle_coordinator_journal_absent", plan.authority.productHome);
    }
    const variant = validateLifecyclePlanGrammar(plan, this.dependencies.variantFacts(plan));
    validateCoordinatorJournalForPlan(
      plan,
      journal,
      variant,
      this.dependencies.pushPlanHash(plan),
    );
    const session: SessionV1<TPlan> = {
      plan,
      variant,
      boundary: pointOfNoReturnStepIndex(variant, plan.steps),
      journal,
      global,
      cause: RESUMED_CAUSE,
      resumed: journal.phase !== "planned" && journal.phase !== "push_pending",
    };
    await this.assertParticipantPositions(session);
    return session;
  }

  /**
   * §2.4's third states: a consumed participant that is not `finalized`, a future participant
   * with a final journal, and an unpaired compensation journal are all invalid ledgers, and the
   * engine refuses them before it touches anything.
   */
  private async assertParticipantPositions(session: SessionV1<TPlan>): Promise<void> {
    const { plan, journal } = session;
    const forwardCursor = journal.nextStep;
    const reverseCursor = journal.compensationNext;
    for (const [index, step] of plan.steps.entries()) {
      if (step.kind !== "foundation") continue;
      const forward = foundationRefById(plan, step.participantId);
      await this.assertPosition(
        forward,
        index < forwardCursor ? "consumed" : index === forwardCursor ? "current" : "future",
      );
      const compensationId =
        forward.role.kind === "forward" ? forward.role.compensationId : null;
      if (compensationId === null) continue;
      const position =
        reverseCursor === null || index >= forwardCursor
          ? "future"
          : index > reverseCursor
            ? "consumed"
            : index === reverseCursor
              ? "current"
              : "future";
      await this.assertPosition(foundationRefById(plan, compensationId), position);
    }
  }

  private async assertPosition(
    ref: FoundationParticipantRefV1,
    position: "consumed" | "current" | "future",
  ): Promise<void> {
    if (position === "current") return;
    const phase = await this.foundationJournalPhase(ref);
    const legal = position === "consumed" ? phase === "finalized" : phase === null;
    if (!legal) {
      refuseLifecycleRecovery(
        "lifecycle_coordinator_participant_state",
        ref.initialJournal.finalPath,
      );
    }
  }

  /**
   * `FoundationParticipantStateV1` folds "the initial journal is still staged" and the published
   * phase `staged` into one value, so the final journal's presence — never `observe` alone —
   * decides which arm this is (Task 15 review, 2026-09-20).
   */
  private async foundationJournalPhase(
    ref: FoundationParticipantRefV1,
  ): Promise<TransactionPhase | null> {
    const final = await this.dependencies.fs.lstat(ref.initialJournal.finalPath);
    if (final === null) return null;
    const observed = await this.dependencies.adapters.foundation.observe(ref);
    if (observed === "future") {
      refuseLifecycleRecovery(
        "lifecycle_coordinator_participant_state",
        ref.initialJournal.finalPath,
      );
    }
    return observed;
  }

  private async forwardOnce(
    session: SessionV1<TPlan>,
  ): Promise<LifecycleCoordinatorOutcomeV1 | null> {
    const { plan } = session;
    const cursor = session.journal.nextStep;
    const step = plan.steps[cursor];
    if (step === undefined) {
      refuseLifecycleRecovery("lifecycle_coordinator_cursor", plan.authority.productHome);
    }
    if (session.resumed) {
      session.resumed = false;
      if (!(await this.boundaryCrossed(session, cursor))) {
        await this.enterCompensation(session, cursor);
        return null;
      }
    }
    if (session.journal.phase === "planned") {
      await this.rewrite(session, { phase: derivedCoordinatorPhase(step) });
    }

    const hooks = this.dependencies.adapters.stepHooks;
    if (hooks !== undefined) {
      session.global = await hooks.before(plan, cursor, step, session.global);
      await requireHeldGlobalLock(this.dependencies.fs, session.global);
    }

    try {
      const pushed = await this.applyStep(session, cursor, step);
      if (pushed === "failed") {
        const pushPlanHash = this.dependencies.pushPlanHash(plan);
        if (pushPlanHash === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_push_arm", plan.authority.productHome);
        }
        await this.rewrite(session, { phase: "push_pending" });
        return { kind: "push_pending", id: plan.id, pushPlanHash };
      }
    } catch (error) {
      if (await this.boundaryCrossed(session, cursor)) throw error;
      session.cause = causeOf(error);
      await this.enterCompensation(session, cursor);
      return null;
    }

    await this.boundary({ kind: "participant_returned", step: cursor, direction: "forward" });
    await hooks?.after(plan, cursor, step);
    if (cursor === session.boundary) await this.finalizeEarlierEffects(session, cursor);

    const next = cursor + 1;
    const following = plan.steps[next];
    await this.rewrite(session, {
      nextStep: next,
      phase: following === undefined ? "finalized" : derivedCoordinatorPhase(following),
    });
    return null;
  }

  private async applyStep(
    session: SessionV1<TPlan>,
    cursor: number,
    step: LifecycleCoordinatorStepV1,
  ): Promise<"failed" | null> {
    const { plan } = session;
    const { adapters } = this.dependencies;
    switch (step.kind) {
      case "foundation": {
        const ref = foundationRefById(plan, step.participantId);
        if ((await this.foundationJournalPhase(ref)) === "finalized") return null;
        await requireHeldGlobalLock(this.dependencies.fs, session.global);
        await adapters.foundation.apply(ref);
        if ((await this.foundationJournalPhase(ref)) !== "finalized") {
          refuseLifecycleRecovery(
            "lifecycle_foundation_participant_not_finalized",
            ref.initialJournal.finalPath,
          );
        }
        return null;
      }
      case "manifest": {
        const manifest = adapters.manifest;
        if (manifest === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_manifest_arm", plan.authority.productHome);
        }
        const state = await manifest.observe(plan);
        switch (step.transition) {
          case "preserve_before":
            if (state === "before") await manifest.preserveBefore(plan);
            return null;
          case "publish_after":
            if (state !== "applied" && state !== "compaction_pending") {
              await manifest.publishAfter(plan);
            }
            return null;
          case "commit_absence":
            if (state !== "applied" && state !== "compaction_pending") {
              await manifest.commitAbsence(plan);
            }
            return null;
          case "finalize_tombstones":
            if (state !== "compaction_pending") await manifest.finalizeTombstones(plan);
            return null;
        }
        return null;
      }
      case "redaction_key": {
        const key = adapters.redactionKey;
        if (key === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_key_arm", plan.authority.productHome);
        }
        const state = await key.observe(plan);
        if (step.transition === "stage") {
          if (state === "before") await key.stage(plan);
          return null;
        }
        if (state !== "deleted") await key.delete(plan);
        return null;
      }
      case "network_push": {
        const push = adapters.networkPush;
        if (push === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_push_arm", plan.authority.productHome);
        }
        return (await push.push(plan, step.pushPlanHash)) === "succeeded" ? null : "failed";
      }
      case "drain_runners": {
        const drain = adapters.drainRunners;
        if (drain === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_drain_arm", plan.authority.productHome);
        }
        session.global = await drain.drain(plan, session.global);
        await requireHeldGlobalLock(this.dependencies.fs, session.global);
        return null;
      }
      default: {
        const adapter = effectAdapterOf(adapters, step, plan.authority.productHome);
        const ref = effectRefOf(plan, step);
        let state = await adapter.observe(ref);
        if (state === "compensating" || state === "rolled_back") {
          refuseLifecycleRecovery("lifecycle_effect_state", plan.authority.productHome);
        }
        if (state !== "verified" && state !== "finalized") {
          const unjournaled = state === "future";
          try {
            await adapter.apply(ref);
          } catch (error) {
            /** §2.4: a `D(h)` that has not created a non-terminal effect journal may set
             * `push_pending`; once its journal exists it is ordinary effect recovery. */
            if (step.kind !== "destination_git_effect" || !unjournaled) throw error;
            return "failed";
          }
          state = await adapter.observe(ref);
        }
        if (state !== "verified" && state !== "finalized") {
          refuseLifecycleRecovery("lifecycle_effect_state", plan.authority.productHome);
        }
        if (cursor >= session.boundary && state !== "finalized") await adapter.finalize(ref);
        return null;
      }
    }
  }

  /**
   * Every variant whose point of no return is an effect places that effect at step zero, so the
   * boundary effect's own finalization in `applyStep` can never precede an earlier one here.
   */
  private async finalizeEarlierEffects(
    session: SessionV1<TPlan>,
    cursor: number,
  ): Promise<void> {
    for (const [index, step] of session.plan.steps.entries()) {
      if (index >= cursor || !isEffectStep(step)) continue;
      const adapter = effectAdapterOf(
        this.dependencies.adapters,
        step,
        session.plan.authority.productHome,
      );
      const ref = effectRefOf(session.plan, step);
      if ((await adapter.observe(ref)) === "verified") await adapter.finalize(ref);
    }
  }

  private async boundaryCrossed(session: SessionV1<TPlan>, cursor: number): Promise<boolean> {
    if (cursor > session.boundary) return true;
    if (cursor < session.boundary) return false;
    const step = session.plan.steps[cursor];
    if (step === undefined) return false;
    const point = LIFECYCLE_POINT_OF_NO_RETURN[session.variant];
    switch (point.kind) {
      case "terminal_foundation": {
        if (step.kind !== "foundation") return false;
        return (
          (await this.foundationJournalPhase(foundationRefById(session.plan, step.participantId))) ===
          "finalized"
        );
      }
      case "effect_verified": {
        const adapter = effectAdapterOf(
          this.dependencies.adapters,
          step,
          session.plan.authority.productHome,
        );
        const state = await adapter.observe(effectRefOf(session.plan, step));
        return state === "verified" || state === "finalized";
      }
      case "push_succeeded":
        return false;
      case "manifest_commit_absence": {
        const manifest = this.dependencies.adapters.manifest;
        if (manifest === null) return false;
        const state = await manifest.observe(session.plan);
        return state === "applied" || state === "compaction_pending";
      }
    }
  }

  /**
   * §2.4: `compensating` starts at `nextStep - 1`, "but first resolves any journal at the current
   * unadvanced step". The journal still points at that step while this runs, which is the durable
   * intent the step's own partial work was done under.
   */
  private async resolveCurrentStep(
    session: SessionV1<TPlan>,
    step: LifecycleCoordinatorStepV1,
  ): Promise<"advance" | "hold"> {
    const { plan } = session;
    const { adapters } = this.dependencies;
    switch (step.kind) {
      case "foundation": {
        const ref = foundationRefById(plan, step.participantId);
        const phase = await this.foundationJournalPhase(ref);
        if (phase === "finalized") return "advance";
        if (phase === null) {
          await requireHeldGlobalLock(this.dependencies.fs, session.global);
          await adapters.foundation.discardUnstarted(ref);
          return "hold";
        }
        if (phase !== "rolled_back") {
          refuseLifecycleRecovery(
            "lifecycle_foundation_participant_not_terminal",
            ref.initialJournal.finalPath,
          );
        }
        return "hold";
      }
      case "manifest": {
        const manifest = adapters.manifest;
        if (manifest === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_manifest_arm", plan.authority.productHome);
        }
        if ((await manifest.observe(plan)) !== "before") await manifest.compensate(plan);
        return "hold";
      }
      case "redaction_key": {
        const key = adapters.redactionKey;
        if (key === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_key_arm", plan.authority.productHome);
        }
        if (step.transition === "stage" && (await key.observe(plan)) === "staged") {
          await key.restore(plan);
        }
        return "hold";
      }
      case "network_push":
      case "drain_runners":
        return "hold";
      default: {
        const adapter = effectAdapterOf(adapters, step, plan.authority.productHome);
        const ref = effectRefOf(plan, step);
        const state = await adapter.observe(ref);
        if (state !== "future" && state !== "rolled_back") await adapter.compensate(ref);
        return "hold";
      }
    }
  }

  private async enterCompensation(session: SessionV1<TPlan>, cursor: number): Promise<void> {
    const step = session.plan.steps[cursor];
    const resolution = step === undefined ? "hold" : await this.resolveCurrentStep(session, step);
    const nextStep = resolution === "advance" ? cursor + 1 : cursor;
    const frontier = nextStep - 1;
    await this.rewrite(
      session,
      frontier < 0
        ? { phase: "rolled_back", nextStep, compensationNext: -1 }
        : { phase: "compensating", nextStep, compensationNext: frontier },
    );
  }

  private async compensateOnce(session: SessionV1<TPlan>): Promise<void> {
    const cursor = session.journal.compensationNext;
    if (cursor === null || cursor < 0) {
      await this.rewrite(session, { phase: "rolled_back", compensationNext: -1 });
      return;
    }
    const step = session.plan.steps[cursor];
    if (step === undefined) {
      refuseLifecycleRecovery("lifecycle_coordinator_cursor", session.plan.authority.productHome);
    }
    await this.compensateStep(session, step);
    await this.boundary({ kind: "participant_returned", step: cursor, direction: "compensation" });
    const next = cursor - 1;
    await this.rewrite(
      session,
      next < 0
        ? { phase: "rolled_back", compensationNext: -1 }
        : { compensationNext: next },
    );
  }

  private async compensateStep(
    session: SessionV1<TPlan>,
    step: LifecycleCoordinatorStepV1,
  ): Promise<void> {
    const { plan } = session;
    const { adapters } = this.dependencies;
    switch (step.kind) {
      case "drain_runners":
        return;
      case "foundation": {
        const forward = foundationRefById(plan, step.participantId);
        const compensationId =
          forward.role.kind === "forward" ? forward.role.compensationId : null;
        if (compensationId === null) {
          refuseLifecycleRecovery(
            "lifecycle_coordinator_compensation_absent",
            forward.initialJournal.finalPath,
          );
        }
        const inverse = foundationRefById(plan, compensationId);
        if ((await this.foundationJournalPhase(inverse)) === "finalized") return;
        await requireHeldGlobalLock(this.dependencies.fs, session.global);
        await adapters.foundation.apply(inverse);
        if ((await this.foundationJournalPhase(inverse)) !== "finalized") {
          refuseLifecycleRecovery(
            "lifecycle_foundation_participant_not_finalized",
            inverse.initialJournal.finalPath,
          );
        }
        return;
      }
      case "manifest": {
        const manifest = adapters.manifest;
        if (manifest === null) {
          refuseLifecycleRecovery("lifecycle_coordinator_manifest_arm", plan.authority.productHome);
        }
        await manifest.compensate(plan);
        return;
      }
      case "redaction_key": {
        const key = adapters.redactionKey;
        if (key === null || step.transition !== "stage") {
          refuseLifecycleRecovery("lifecycle_coordinator_key_arm", plan.authority.productHome);
        }
        await key.restore(plan);
        return;
      }
      case "network_push":
        refuseLifecycleRecovery(
          "lifecycle_coordinator_push_compensation",
          plan.authority.productHome,
        );
        return;
      default: {
        const adapter = effectAdapterOf(adapters, step, plan.authority.productHome);
        const ref = effectRefOf(plan, step);
        const state = await adapter.observe(ref);
        if (state === "rolled_back" || state === "future") return;
        await adapter.compensate(ref);
        return;
      }
    }
  }

  private async rewrite(session: SessionV1<TPlan>, patch: JournalPatchV1): Promise<void> {
    const next: LifecycleCoordinatorJournalV1 = {
      ...session.journal,
      ...patch,
      updatedAt: this.dependencies.clock(),
    };
    validateCoordinatorJournalForPlan(
      session.plan,
      next,
      session.variant,
      this.dependencies.pushPlanHash(session.plan),
    );
    await this.dependencies.store.rewriteJournal(
      session.plan,
      session.journal,
      next,
      session.global,
    );
    session.journal = next;
    await this.boundary({
      kind: "journal_rewritten",
      phase: next.phase,
      nextStep: next.nextStep,
    });
  }

  private async boundary(reached: LifecycleCoordinatorBoundaryV1): Promise<void> {
    await this.dependencies.afterBoundary?.(reached);
  }
}
