import { screenAndCap } from "@developer-os/security";
import { z } from "zod";

import type { WorkflowContractV1 } from "./contract.js";
import { WORKFLOW_TRIGGERS } from "./contract.js";

/**
 * An overlay's step *keys* are `z.string()` with no slug constraint — unlike
 * `WorkflowStep.id`, which is regex-bound — so a key is arbitrary
 * author-controlled text that was being interpolated into a refusal reason raw,
 * uncapped and unscreened, while every other message path in this package goes
 * through the screen. Found by review after three sibling modules had already
 * been corrected for the same class.
 */
const MAX_FRAGMENT = 64;

function fragment(text: string): string {
  return screenAndCap(text, MAX_FRAGMENT);
}

const EXTENDS = /^([a-z][a-z0-9-]*)@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/**
 * Exactly four fields. **No `scopes`, no `refusals`, no `capabilities`, no
 * `do`** — the guarantee that an overlay can never weaken a canonical refusal
 * or widen a write scope is the absence of a field, not a merge check that must
 * be correct. An overlay setting `scopes` fails here as an unknown field.
 *
 * The price, accepted: an overlay may only replace the prose of a step that
 * already exists and is already prose. A genuine per-vendor structural
 * difference costs a schema version bump, which is a visible cost rather than a
 * subset check that fails open.
 */
export const workflowOverlaySchema = z
  .object({
    extends: z.string().regex(EXTENDS),
    steps: z
      .record(
        z.string(),
        z.object({ prose: z.string().min(1) }).strict(),
      )
      .optional(),
    lifecycle: z
      .object({ bind: z.enum(WORKFLOW_TRIGGERS) })
      .strict()
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

export type WorkflowOverlayV1 = z.infer<typeof workflowOverlaySchema>;

export type OverlayOutcome =
  | {
      readonly ok: true;
      readonly contract: WorkflowContractV1;
      readonly lifecycle: string | null;
    }
  | { readonly ok: false; readonly reason: string };

export function applyOverlay(
  contract: WorkflowContractV1,
  overlay: WorkflowOverlayV1,
): OverlayOutcome {
  const pinned = `${contract.id}@${contract.version}`;
  if (overlay.extends !== pinned) {
    return {
      ok: false,
      reason: `overlay extends ${overlay.extends} but the contract is ${pinned}`,
    };
  }

  /**
   * A `Map`, because indexing the record directly inherits. `constructor` is
   * all lowercase and therefore a legal step id, so a contract may genuinely
   * contain a step called that — and `patches["constructor"]` resolved through
   * `Object.prototype` to a `Function`, which is not `undefined`. An overlay
   * patching nothing would have rewritten that step's prose to `undefined`.
   * Third instance of the class two earlier reviews found in this package.
   */
  const patches = new Map(Object.entries(overlay.steps ?? {}));
  const byId = new Map(contract.steps.map((step) => [step.id, step]));

  for (const stepId of patches.keys()) {
    const step = byId.get(stepId);
    if (step === undefined) {
      return {
        ok: false,
        reason: `overlay patches step \`${fragment(stepId)}\`, which does not exist`,
      };
    }
    if (step.prose === undefined) {
      return {
        ok: false,
        reason: `overlay patches step \`${fragment(stepId)}\`, which is an effect step; an overlay is presentation only`,
      };
    }
  }

  return {
    ok: true,
    contract: {
      ...contract,
      steps: contract.steps.map((step) => {
        const patch = patches.get(step.id);
        return patch === undefined ? step : { ...step, prose: patch.prose };
      }),
    },
    lifecycle: overlay.lifecycle?.bind ?? null,
  };
}
