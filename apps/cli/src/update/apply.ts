import {
  encodeCanonicalJson,
  EXIT_CODES,
  LifecycleRecoveryRequiredError,
  projectUpdateCapacity,
  UpdateCapacityInsufficientError,
  UpdateLifecycleCoordinator,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  ExitCode,
  LifecycleCoordinatorIdV1,
  LifecycleJournalClosureV2,
  ReleaseIdentityV1,
  SafeReasonCodeV1,
  SecretScreenedBlobV1,
  UpdateCapacityInputV1,
  UpdateConstructionPlanV1,
  UpdateLifecycleCoordinatorDependenciesV1,
  UpdateLifecycleOutcomeV1,
} from "@developer-os/core";

import type { UpdateConstructionOuterBytesV1, UpdateConstructionStore } from "./construction.js";
import type { CliUpdateContext } from "./context.js";
import { materializeUpdate, UpdatePlanningRefusal } from "./planning.js";
import type { MaterializedUpdateV1, PreparedUpdateApplyV1, UpdateCommandResultV1, UpdateHomeV1, UpdateTargetInputsV1 } from "./planning.js";
import { routeUpdateRecovery } from "./recovery.js";
import type { UpdateRecoveryRouteOutcomeV1, UpdateRecoveryRoutesV1 } from "./recovery.js";

/** The allocation-dependent derivation's whole input: the admitted home and the under-lock rerun. */
export interface UpdateApplyComposeInputV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly home: UpdateHomeV1;
  readonly inputs: UpdateTargetInputsV1;
  readonly materialized: MaterializedUpdateV1;
}

/** Every byte the construction envelope and outer handoff write, derived before the first output frame. */
export interface UpdateApplyCompositionV1 {
  readonly construction: UpdateConstructionPlanV1;
  readonly outer: UpdateConstructionOuterBytesV1;
  /** The exact post-allocation projection; an overflow here consumes only the allocator gap. */
  readonly capacity: UpdateCapacityInputV1;
}

export type UpdateApplyConstructionPortV1 = Pick<UpdateConstructionStore, "publish" | "stageDirectories" | "stageFiles" | "publishOuter" | "recover">;

/**
 * The mutation authority `--apply` needs beyond the plan-only ports. Every port runs under the
 * one global lifecycle lock `withGlobalLock` holds; `coordinator` reopens a coordinator from disk,
 * so a fresh apply and a later recovery drive the same engine over the same persisted plan.
 */
export interface UpdateApplyPortsV1 {
  readonly withGlobalLock: <T>(work: () => Promise<T>) => Promise<T>;
  /** Spec 2 §9.2's V2 closure over the ledger, construction envelopes, and executor record. */
  readonly closure: () => Promise<LifecycleJournalClosureV2>;
  /** Durably reserves the coordinator's allocator block; nothing else is written. */
  readonly allocate: () => Promise<LifecycleCoordinatorIdV1>;
  readonly compose: (input: UpdateApplyComposeInputV1) => Promise<UpdateApplyCompositionV1>;
  readonly construction: (coordinatorId: LifecycleCoordinatorIdV1) => UpdateApplyConstructionPortV1;
  readonly coordinator: (coordinatorId: LifecycleCoordinatorIdV1) => UpdateLifecycleCoordinatorDependenciesV1;
  readonly envelope: UpdateRecoveryRoutesV1["envelope"];
  readonly executorCleanup: UpdateRecoveryRoutesV1["executorCleanup"];
}

/** A verifier or step failure before the point of no return: the old release was restored. */
export interface UpdateAutomaticRollbackV1 {
  readonly schemaVersion: 1;
  readonly outcome: "rolled_back_automatically";
  readonly active: ReleaseIdentityV1;
  readonly cause: SafeReasonCodeV1;
}

export type UpdateApplyResultV1 = Extract<UpdateCommandResultV1, { readonly outcome: "applied" }> | UpdateAutomaticRollbackV1;

function refuse(reason: string, code: Exclude<ExitCode, 0>, recovery?: string): never {
  throw new UpdatePlanningRefusal(reason, code, [], recovery);
}

const RERUN = "run `developer-os update --apply` again";

function sameJson(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

export function updateApplyPorts(update: CliUpdateContext): UpdateApplyPortsV1 {
  return update.apply ?? refuse("update_apply_unavailable", EXIT_CODES.capabilityUnavailable);
}

function requireCapacity(input: UpdateCapacityInputV1): void {
  try {
    projectUpdateCapacity(input);
  } catch (error) {
    if (error instanceof UpdateCapacityInsufficientError) refuse(`update_capacity_insufficient_${error.dimension}`, EXIT_CODES.operationalFailure);
    throw error;
  }
}

async function* frames(outputs: readonly SecretScreenedBlobV1[]): AsyncGenerator<SecretScreenedBlobV1> {
  for (const frame of outputs) yield await Promise.resolve(frame);
}

/** Dispatches the one V2 closure arm under the held lock; recovery has no network or planner port. */
async function recoverLocked(ports: UpdateApplyPortsV1, closure: LifecycleJournalClosureV2): Promise<UpdateRecoveryRouteOutcomeV1> {
  return routeUpdateRecovery(closure, {
    coordinator: { recover: (id) => new UpdateLifecycleCoordinator(ports.coordinator(id)).recover(id) },
    envelope: ports.envelope,
    construction: { compensate: (cleanup) => ports.construction(cleanup.coordinatorId).recover({ coordinatorId: cleanup.coordinatorId, construction: cleanup.construction }) },
    executorCleanup: ports.executorCleanup,
  });
}

/**
 * Resumes or compensates whatever update residue the closure names, in its persisted direction.
 * `update --apply` runs it first, so a killed apply heals on the next attempt.
 */
export function recoverUpdate(update: CliUpdateContext): Promise<UpdateRecoveryRouteOutcomeV1> {
  const ports = updateApplyPorts(update);
  return ports.withGlobalLock(async () => recoverLocked(ports, await ports.closure()));
}

/**
 * Spec 2 §9.1: the guarded home, the retained rollback evidence, and a fresh planner run over the
 * same verified scratch must reproduce the pre-lock candidate exactly; then aggregate feasibility
 * is rechecked against a fresh capacity observation. Nothing is reserved or written before this.
 */
async function revalidate(update: CliUpdateContext, prepared: PreparedUpdateApplyV1): Promise<{ readonly home: UpdateHomeV1; readonly materialized: MaterializedUpdateV1 }> {
  const home = await update.readHome();
  if (!sameJson(home, prepared.home)) refuse("update_state_changed", EXIT_CODES.operationalFailure, RERUN);
  const retained = home.rollback === null ? null : await update.readRollbackEvidence(home, home.rollback);
  if (!sameJson(retained, prepared.inputs.retained)) refuse("update_state_changed", EXIT_CODES.operationalFailure, RERUN);
  const materialized = await materializeUpdate(update, home, { ...prepared.inputs, retained });
  if (!sameJson(materialized.run.transcript, prepared.materialized.run.transcript) || !sameJson(materialized.candidate, prepared.materialized.candidate)) {
    refuse("update_plan_changed", EXIT_CODES.operationalFailure, RERUN);
  }
  requireCapacity({ ...materialized.capacity, ...(await update.capacity()) });
  return { home, materialized };
}

/**
 * Pre-handoff: construction plan → directories → files and both source envelopes (every output
 * frame screened and re-hashed into its exact consumers) → scratch cleanup → outer V2 plan and
 * journal. A failure before handoff is compensated through the construction-cleanup arm recovery
 * would take; once the outer journal exists only the coordinator may choose a direction, so the
 * residue is left for the next recovery. A third state met while compensating outranks the failure.
 */
async function construct(ports: UpdateApplyPortsV1, composition: UpdateApplyCompositionV1, materialized: MaterializedUpdateV1, cleanupScratch: () => Promise<void>): Promise<void> {
  const plan = composition.construction;
  const store = ports.construction(plan.coordinatorId);
  try {
    await store.publish(plan);
    await store.stageDirectories(plan);
    await store.stageFiles(plan, frames(materialized.run.outputBlobs));
    await cleanupScratch();
    await store.publishOuter(plan, composition.outer);
  } catch (error) {
    try {
      const closure = await ports.closure();
      if (closure.kind === "update_construction_cleanup") await recoverLocked(ports, closure);
    } catch (compensation) {
      if (compensation instanceof LifecycleRecoveryRequiredError) throw compensation;
      // Any other compensation failure leaves the envelope to the next closure-driven recovery.
    }
    throw error;
  }
}

function resultOf(outcome: UpdateLifecycleOutcomeV1, inputs: UpdateTargetInputsV1): UpdateApplyResultV1 {
  if (outcome.kind === "finalized") return { schemaVersion: 1, outcome: "applied", active: inputs.target, rollbackAvailable: true };
  return { schemaVersion: 1, outcome: "rolled_back_automatically", active: inputs.current, cause: outcome.cause };
}

/**
 * `update --apply` (Spec 2 §9): the previewed candidate is revalidated under the global lock, the
 * coordinator block is reserved, every allocation-dependent byte is derived and checked against
 * exact capacity, the construction envelope hands off to the V2 coordinator, and the coordinator
 * runs the §9.3 steps. A failure before the verifier's durable success compensates to the old
 * release (trust stays advanced); the scratch attempt is removed on every path.
 */
export async function applyUpdate(update: CliUpdateContext, prepared: PreparedUpdateApplyV1): Promise<UpdateApplyResultV1> {
  let scratchOpen = true;
  const cleanupScratch = async (): Promise<void> => {
    if (!scratchOpen) return;
    scratchOpen = false;
    await prepared.scratch.cleanup();
  };
  try {
    const ports = updateApplyPorts(update);
    return await ports.withGlobalLock(async () => {
      const { home, materialized } = await revalidate(update, prepared);
      const coordinatorId = await ports.allocate();
      const composition = await ports.compose({ coordinatorId, home, inputs: prepared.inputs, materialized });
      const plan = composition.construction;
      if (plan.coordinatorId !== coordinatorId || plan.operation !== "update_apply") refuse("update_composition_identity", EXIT_CODES.recoveryRequired);
      requireCapacity(composition.capacity);
      await construct(ports, composition, materialized, cleanupScratch);
      return resultOf(await new UpdateLifecycleCoordinator(ports.coordinator(coordinatorId)).execute(coordinatorId), prepared.inputs);
    });
  } finally {
    await cleanupScratch();
  }
}
