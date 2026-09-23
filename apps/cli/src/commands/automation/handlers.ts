/**
 * Spec 1 §5.1's production handlers: the three local jobs Task 16 wired, plus `git-sync`, which is
 * §4's own sync under the runner's held global lock and never a second acquisition.
 */
import { parseSafeReasonCode } from "@developer-os/core";
import type { SafeReasonCodeV1 } from "@developer-os/core";

import type { CliContext } from "../../context.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import type { ScheduledHandlerResultV1 } from "../../lifecycle/runtime-records.js";
import { createGitService } from "../git/service.js";
import { createScheduledJobHandlers } from "./runner.js";
import type { ScheduledJobHandlersV1 } from "./runner.js";

const RESERVED_REASON_CODES: ReadonlySet<string> = new Set(["ok", "git_disabled", "automation_disabled", "skipped_lock_timeout"]);

function reasonOf(value: unknown): SafeReasonCodeV1 | null {
  try {
    const code = parseSafeReasonCode(value);
    return RESERVED_REASON_CODES.has(code) ? parseSafeReasonCode("handler_refused") : code;
  } catch {
    return null;
  }
}

/** A refusal names its own safe reason (`GitCommandRefusal`, recovery, distribution); anything else is a failure. */
function refusedWith(error: unknown): ScheduledHandlerResultV1 | null {
  if (!(error instanceof Error)) return null;
  const reason = reasonOf("reason" in error ? error.reason : error.message);
  return reason === null ? null : { outcome: "handler_refused", reasonCode: reason, data: { message: error.message } };
}

export function createProductionScheduledHandlers(context: CliContext, lifecycle: CliLifecycleContext): ScheduledJobHandlersV1 {
  return createScheduledJobHandlers(context, {
    run: async (_job, global) => {
      try {
        const result = await createGitService(context, lifecycle).sync("scheduled", global);
        return result.data.kind === "sync" && result.data.outcome !== "push_pending"
          ? { outcome: "success", reasonCode: parseSafeReasonCode("ok"), data: result.data }
          : { outcome: "handler_failed", reasonCode: parseSafeReasonCode("push_pending"), data: result.data };
      } catch (error) {
        const refused = refusedWith(error);
        if (refused === null) throw error;
        return refused;
      }
    },
  });
}
