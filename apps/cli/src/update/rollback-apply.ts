import { EXIT_CODES, UpdateLifecycleCoordinator } from "@developer-os/core";
import type { ReleaseIdentityV1, SafeReasonCodeV1, UpdateLifecycleOutcomeV1, UpdateRollbackPreviewV1 } from "@developer-os/core";

import { beforeConstruction, construct, refuse, requireCapacity, updateApplyPorts } from "./apply.js";
import type { UpdateApplyPortsV1 } from "./apply.js";
import { updateRollbackPrefixes } from "./compose.js";
import type { CliUpdateContext } from "./context.js";
import { planRollback, sameJson } from "./planning.js";
import type { UpdateCommandResultV1, UpdateHomeV1 } from "./planning.js";

/** A failure before the previous verifier's durable success: the rejected current release stays active. */
export interface UpdateRollbackCompensatedV1 {
  readonly schemaVersion: 1;
  readonly outcome: "rollback_compensated";
  readonly active: ReleaseIdentityV1;
  readonly cause: SafeReasonCodeV1;
}

export type UpdateRollbackApplyResultV1 = Extract<UpdateCommandResultV1, { readonly outcome: "rolled_back" }> | UpdateRollbackCompensatedV1;

const RERUN = "run `developer-os update rollback --apply` again";

type UpdateRollbackApplyPortsV1 = UpdateApplyPortsV1 & Required<Pick<UpdateApplyPortsV1, "composeRollback">>;

export function updateRollbackPorts(update: CliUpdateContext): UpdateRollbackApplyPortsV1 {
  const ports = updateApplyPorts(update);
  if (ports.composeRollback === undefined) return refuse("update_apply_unavailable", EXIT_CODES.capabilityUnavailable);
  return ports as UpdateRollbackApplyPortsV1;
}

/**
 * Spec 2 §10.2 under the held lock: a clear ledger, then the plan-only path rerun over one pinned
 * home read. `planRollback` rechecks the record, trust admission, every retained postimage (a
 * post-update edit is exit 3 here), and inverse capacity against a fresh observation; its preview
 * must hash exactly as the one shown. Nothing is reserved or written before this returns.
 */
async function revalidate(update: CliUpdateContext, ports: UpdateApplyPortsV1, preview: UpdateRollbackPreviewV1): Promise<UpdateHomeV1> {
  if ((await ports.closure()).kind !== "clear") refuse("update_ledger_not_clear", EXIT_CODES.recoveryRequired, "developer-os doctor");
  const home = await update.readHome();
  const again = await planRollback({ ...update, readHome: () => Promise.resolve(home) });
  // The preview binds current (the active record) and target (the record's previous release).
  if (!sameJson(again, preview)) refuse("update_plan_changed", EXIT_CODES.operationalFailure, RERUN);
  return home;
}

function resultOf(outcome: UpdateLifecycleOutcomeV1, preview: UpdateRollbackPreviewV1): UpdateRollbackApplyResultV1 {
  if (outcome.kind === "finalized") return { schemaVersion: 1, outcome: "rolled_back", active: preview.target, rollbackAvailable: false };
  return { schemaVersion: 1, outcome: "rollback_compensated", active: preview.current, cause: outcome.cause };
}

/**
 * `update rollback --apply` (Spec 2 §10.2): local evidence only — no transport, FD 3, scratch, or
 * planner. Under the global lock the preview is revalidated, fresh coordinator IDs are reserved, the
 * construction envelope (no source envelope, no output frames) hands off to the V2 coordinator, and
 * the coordinator runs the rollback steps. The record, payload, and rejected bundle are consumed
 * only by terminal retirement, after the previous verifier and fallback routing; trust is never a
 * step, so its high watermarks stay where the update left them.
 */
export async function applyRollback(update: CliUpdateContext, preview: UpdateRollbackPreviewV1): Promise<UpdateRollbackApplyResultV1> {
  const ports = updateRollbackPorts(update);
  return ports.withGlobalLock(async () => {
    const home = await revalidate(update, ports, preview);
    const coordinatorId = await ports.allocate(updateRollbackPrefixes(preview));
    const composition = await beforeConstruction(ports, async () => {
      const composed = await ports.composeRollback({ coordinatorId, home, preview });
      const plan = composed.construction;
      if (plan.coordinatorId !== coordinatorId || plan.operation !== "update_rollback" || plan.rollbackSource !== null || plan.outputFrames.length !== 0) {
        refuse("update_composition_identity", EXIT_CODES.recoveryRequired);
      }
      // The composer derives the exact components; availability is this lock's fresh observation.
      requireCapacity({ ...composed.capacity, ...(await update.capacity()) });
      return composed;
    });
    await construct(ports, composition, [], () => Promise.resolve());
    return resultOf(await new UpdateLifecycleCoordinator(ports.coordinator(coordinatorId)).execute(coordinatorId), preview);
  });
}
