import {
  EXIT_CODES,
  LifecycleRecoveryRequiredError,
  projectUpdateCapacity,
  UpdateCapacityInsufficientError,
  UpdateLifecycleCoordinator,
} from "@developer-os/core";
import type {
  ExitCode,
  LifecycleCoordinatorIdV1,
  LifecycleIdPrefixV1,
  LifecycleJournalClosureV2,
  ReleaseIdentityV1,
  SafeReasonCodeV1,
  SecretScreenedBlobV1,
  UpdateCapacityInputV1,
  UpdateConstructionPlanV1,
  UpdateLifecycleCoordinatorDependenciesV1,
  UpdateLifecycleOutcomeV1,
  UpdateOperationV1,
  UpdateRollbackPreviewV1,
} from "@developer-os/core";

import { updateApplyPrefixes } from "./compose.js";
import type { UpdateConstructionOuterBytesV1, UpdateConstructionStore } from "./construction.js";
import type { CliUpdateContext } from "./context.js";
import { materializeUpdate, sameJson, UpdatePlanningRefusal } from "./planning.js";
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

/** Rollback's derivation input: the admitted home and the under-lock preview; no planner run exists. */
export interface UpdateRollbackComposeInputV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly home: UpdateHomeV1;
  readonly preview: UpdateRollbackPreviewV1;
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
  /**
   * Durably reserves one allocator block for every prefix, in order (D72 P7(e)); the first is the
   * coordinator's `lc` and every later ID follows its counter. Nothing else is written.
   */
  readonly allocate: (prefixes: readonly LifecycleIdPrefixV1[]) => Promise<LifecycleCoordinatorIdV1>;
  readonly compose: (input: UpdateApplyComposeInputV1) => Promise<UpdateApplyCompositionV1>;
  /** `update rollback --apply`'s derivation; absent, the rollback arm refuses before any port. */
  readonly composeRollback?: (input: UpdateRollbackComposeInputV1) => Promise<UpdateApplyCompositionV1>;
  readonly construction: (coordinatorId: LifecycleCoordinatorIdV1) => UpdateApplyConstructionPortV1;
  readonly coordinator: (coordinatorId: LifecycleCoordinatorIdV1) => UpdateLifecycleCoordinatorDependenciesV1;
  readonly envelope: UpdateRecoveryRoutesV1["envelope"];
  readonly executorCleanup: UpdateRecoveryRoutesV1["executorCleanup"];
  /**
   * Under the lock: removes each empty `staging/lifecycle/<lc>` no coordinator plan or journal
   * claims — what an allocation left before its construction envelope, or a cleaned envelope left.
   */
  readonly removeEmptyStagingRoots?: () => Promise<void>;
  /** Under the lock, before the closure is read: removes the one pre-rename allocator temp a death after its write left. */
  readonly cleanAllocatorTemp?: () => Promise<void>;
}

/** A verifier or step failure before the point of no return: the old release was restored. */
export interface UpdateAutomaticRollbackV1 {
  readonly schemaVersion: 1;
  readonly outcome: "rolled_back_automatically";
  readonly active: ReleaseIdentityV1;
  readonly cause: SafeReasonCodeV1;
}

export type UpdateApplyResultV1 = Extract<UpdateCommandResultV1, { readonly outcome: "applied" }> | UpdateAutomaticRollbackV1;

export function refuse(reason: string, code: Exclude<ExitCode, 0>, recovery?: string): never {
  throw new UpdatePlanningRefusal(reason, code, [], recovery);
}

const RERUN = "run `developer-os update --apply` again";

export function updateApplyPorts(update: CliUpdateContext): UpdateApplyPortsV1 {
  return update.apply ?? refuse("update_apply_unavailable", EXIT_CODES.capabilityUnavailable);
}

export function requireCapacity(input: UpdateCapacityInputV1): void {
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

/** The operation an update closure arm records; null when none is known (a lone pending construction plan, an executor record). */
function recordedOperation(closure: LifecycleJournalClosureV2): UpdateOperationV1 | null {
  if (closure.kind === "update_recovery") return closure.operation;
  if (closure.kind === "update_construction_cleanup" && closure.construction.frontier !== "plan_pending") return closure.construction.operation;
  return null;
}

/**
 * Resumes or compensates whatever update residue the closure names, in its persisted direction.
 * `update --apply` runs it first, so a killed apply heals on the next attempt. With `operation`,
 * residue another operation recorded refuses with that operation's command (Spec 2 §9.2, NEW-162).
 */
export function recoverUpdate(update: CliUpdateContext, operation?: UpdateOperationV1): Promise<UpdateRecoveryRouteOutcomeV1> {
  const ports = updateApplyPorts(update);
  return ports.withGlobalLock(async () => {
    await ports.cleanAllocatorTemp?.();
    await ports.removeEmptyStagingRoots?.();
    const closure = await ports.closure();
    const recorded = recordedOperation(closure);
    if (operation !== undefined && recorded !== null && recorded !== operation) {
      refuse("update_recovery_other_operation", EXIT_CODES.recoveryRequired, recorded === "update_rollback" ? "developer-os update rollback --apply" : "developer-os update --apply");
    }
    const recovered = await recoverLocked(ports, closure);
    await ports.removeEmptyStagingRoots?.();
    return recovered;
  });
}

/**
 * Spec 2 §9.1: a clear V2 closure, the guarded home, the retained rollback evidence, and a fresh planner run over the
 * same verified scratch must reproduce the pre-lock candidate exactly; then aggregate feasibility
 * is rechecked against a fresh capacity observation. Nothing is reserved or written before this.
 */
async function revalidate(update: CliUpdateContext, ports: UpdateApplyPortsV1, prepared: PreparedUpdateApplyV1): Promise<{ readonly home: UpdateHomeV1; readonly materialized: MaterializedUpdateV1 }> {
  if ((await ports.closure()).kind !== "clear") refuse("update_ledger_not_clear", EXIT_CODES.recoveryRequired, "developer-os doctor");
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
export async function construct(ports: UpdateApplyPortsV1, composition: UpdateApplyCompositionV1, outputs: readonly SecretScreenedBlobV1[], cleanupScratch: () => Promise<void>): Promise<void> {
  const plan = composition.construction;
  const store = ports.construction(plan.coordinatorId);
  try {
    await store.publish(plan);
    await store.stageDirectories(plan);
    await store.stageFiles(plan, frames(outputs));
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
      const { home, materialized } = await revalidate(update, ports, prepared);
      const coordinatorId = await ports.allocate(updateApplyPrefixes(materialized));
      const composition = await ports.compose({ coordinatorId, home, inputs: prepared.inputs, materialized });
      const plan = composition.construction;
      if (plan.coordinatorId !== coordinatorId || plan.operation !== "update_apply") refuse("update_composition_identity", EXIT_CODES.recoveryRequired);
      requireCapacity(composition.capacity);
      await construct(ports, composition, materialized.run.outputBlobs, cleanupScratch);
      return resultOf(await new UpdateLifecycleCoordinator(ports.coordinator(coordinatorId)).execute(coordinatorId), prepared.inputs);
    });
  } finally {
    await cleanupScratch();
  }
}
