import type { ExitCode } from "@developer-os/core";
import { EXIT_CODES } from "@developer-os/core";
import { z } from "zod";

export const WORKFLOW_TRIGGERS = ["manual", "session_start", "session_end"] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

/**
 * The keys from product spec §11, spelled the way §11 spells them. Design §4
 * says capabilities *are* those keys, and the first draft invented
 * `session_start_hook` and `session_end_hook` for what §11 calls
 * `session_start_injection` and `session_end_capture`. Renamed while nothing
 * consumes either value; once an adapter keys on one, the rename stops being
 * free.
 *
 * `file_write` is not in §11 and no verb footprint requires it, so no canonical
 * workflow can legitimately declare it and `capability-undeclared` can never
 * name it. Kept as a declared vocabulary entry rather than deleted, because the
 * adapters decide in DOS-P4/P5 whether a vendor distinguishes file writing as a
 * capability at all; recorded in `docs/architecture/workflow-schema.md` so it is
 * not mistaken for something in use.
 */
export const WORKFLOW_CAPABILITIES = [
  "structured_result",
  "non_interactive_run",
  "session_start_injection",
  "session_end_capture",
  "file_write",
] as const;
export type WorkflowCapability = (typeof WORKFLOW_CAPABILITIES)[number];

export const REFUSAL_CONDITIONS = [
  "capability-missing",
  "index-missing",
  "vault-missing",
  "input-invalid",
  "scope-violation",
] as const;
export type RefusalCondition = (typeof REFUSAL_CONDITIONS)[number];

const SLUG = /^[a-z][a-z0-9-]*$/u;

/**
 * `MAJOR.MINOR.PATCH`, each without a leading zero. The first version was
 * `^\d+\.\d+\.\d+$`, which accepted `01.2.3` — not a semantic version — because
 * nothing probed anything but `1.0` and `1.2.3`.
 *
 * Pre-release and build metadata are deliberately **not** supported: a shipped
 * workflow version is a release, and an adapter pinning `id@version` should
 * never have to compare `1.2.3-rc.1` against `1.2.3`. That is a narrowing of
 * "semantic version" and it is stated here rather than left to be discovered.
 */
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/**
 * Named rather than inferred, because the message is the whole decision. A
 * workflow author who writes `scheduled` is not making a typo — they are asking
 * for a scheduler — and being told the value is invalid teaches them nothing.
 * Spec §15.8.
 */
const RETIRED_TRIGGERS: ReadonlyMap<string, string> = new Map([
  [
    "scheduled",
    "`scheduled` is not a v1 trigger: the scheduler is launchd and belongs to DOS-P7, which adds this value in the same change that makes it fire",
  ],
]);

/**
 * A `Map`, not an object literal. As a literal this was not a lookup — it
 * inherited: `RETIRED_TRIGGERS["toString"]` returned a `Function`, which is not
 * `undefined`, so a trigger named after any `Object.prototype` member took the
 * retired branch and put a **function** where a message belongs. The redaction
 * seam then threw `value.replace is not a function` and the whole validation
 * aborted — four characters in a file crashed the validator. Found by this
 * task's review.
 *
 * The refinement is piped into a closed enum so the parsed field's type is
 * `WorkflowTrigger`, not `string`. Inference alone gave `string[]`, which left
 * the exported `WorkflowTrigger` describing a field it was never the type of,
 * and a renderer no exhaustiveness checking over a set the spec calls closed.
 */
const triggerSchema = z
  .string()
  .superRefine((value, context) => {
    const retired = RETIRED_TRIGGERS.get(value);
    if (retired !== undefined) {
      context.addIssue({ code: "custom", message: retired });
      return;
    }
    if (!(WORKFLOW_TRIGGERS as readonly string[]).includes(value)) {
      context.addIssue({
        code: "custom",
        message: `unknown trigger; expected one of ${WORKFLOW_TRIGGERS.join(", ")}`,
      });
    }
  })
  .pipe(z.enum(WORKFLOW_TRIGGERS));

const inputTypeSchema = z.enum(["string", "integer", "boolean", "path"]);

const fieldSchema = z
  .object({
    type: inputTypeSchema,
    required: z.boolean(),
    description: z.string().min(1),
  })
  .strict();

export type WorkflowInputSchema = Readonly<Record<string, z.infer<typeof fieldSchema>>>;
export type WorkflowOutputSchema = WorkflowInputSchema;

/**
 * The **failure** codes, never `success`. `packages/core` already draws this
 * line — `FailureExitCode` excludes `0` and `failure()` accepts only that — so a
 * refusal validated with `exit: 0` could not be handed to core's own failure
 * constructor, and would report failure as success to whoever read the exit
 * status.
 *
 * Written as a literal union rather than derived through a type assertion. The
 * assertion form (`Object.values(...).map(...) as [ZodLiteral<number>, ...]`)
 * widened the inferred type to `number`, so `WorkflowRefusal["exit"]` accepted
 * `12345`, and an adapter could not pass it to `failure()` without a cast. It
 * was also unchecked in the other direction: had `EXIT_CODES` ever shrunk to one
 * entry, the tuple claim would have been false with no compile error. The
 * exhaustiveness check below is what keeps this list honest instead.
 */
const FAILURE_EXIT_CODES = [
  EXIT_CODES.operationalFailure,
  EXIT_CODES.invalidInput,
  EXIT_CODES.decisionRequired,
  EXIT_CODES.capabilityUnavailable,
  EXIT_CODES.securityRefusal,
  EXIT_CODES.recoveryRequired,
] as const;

/**
 * Fails to compile the day `EXIT_CODES` gains a code that is not listed above,
 * which is the only thing standing between this list and silent staleness.
 */
const _EVERY_FAILURE_CODE_LISTED: Exclude<
  ExitCode,
  typeof EXIT_CODES.success
> extends (typeof FAILURE_EXIT_CODES)[number]
  ? true
  : never = true;
void _EVERY_FAILURE_CODE_LISTED;

/**
 * The list itself, never six hand-written indexes. Indexing `[0]`…`[5]` meant a
 * seventh failure code could be added *and listed above* while the schema still
 * unioned six and rejected it at runtime with no compile error anywhere — the
 * exact "a list and its consumer drift apart" shape the constant above is meant
 * to prevent.
 */
const exitCodeSchema = z.literal(FAILURE_EXIT_CODES);

const refusalSchema = z
  .object({
    when: z.enum(REFUSAL_CONDITIONS),
    exit: exitCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export type WorkflowRefusal = z.infer<typeof refusalSchema>;

/**
 * Two shapes, never both and never neither. If it touches the filesystem, the
 * network, a process, or the vault, it is a verb; otherwise it is prose. That
 * line is what makes a declared scope checkable at all — free prose everywhere
 * would leave nothing to derive a footprint from.
 */
const stepSchema = z
  .object({
    id: z.string().regex(SLUG),
    do: z.string().min(1).optional(),
    with: z.record(z.string(), z.unknown()).optional(),
    prose: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((step, context) => {
    const hasDo = step.do !== undefined;
    const hasProse = step.prose !== undefined;
    if (hasDo === hasProse) {
      context.addIssue({
        code: "custom",
        message: "a step has `do` or `prose`, never both and never neither",
      });
    }
    if (!hasDo && step.with !== undefined) {
      context.addIssue({ code: "custom", message: "`with` belongs to an effect step" });
    }
  });

export type WorkflowStep = z.infer<typeof stepSchema>;

const scopesSchema = z
  .object({
    read: z.array(z.string().min(1)),
    write: z.array(z.string().min(1)),
  })
  .strict();

export const workflowContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(SLUG),
    version: z.string().regex(SEMVER),
    description: z.string().min(1),
    triggers: z.array(triggerSchema).min(1),
    inputs: z.record(z.string().regex(SLUG), fieldSchema),
    output: z.record(z.string().regex(SLUG), fieldSchema),
    capabilities: z.array(z.enum(WORKFLOW_CAPABILITIES)),
    scopes: scopesSchema,
    refusals: z.array(refusalSchema),
    steps: z.array(stepSchema).min(1),
    validators: z.array(z.string().min(1)),
    recovery: z
      .object({ leaves: z.string().min(1), resume: z.string().min(1) })
      .strict(),
  })
  .strict()
  .superRefine((workflow, context) => {
    const seen = new Set<string>();
    for (const step of workflow.steps) {
      if (seen.has(step.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate step id \`${step.id}\`; an overlay keys on it, so ids are unique within a workflow`,
        });
      }
      seen.add(step.id);
    }
  });

export type WorkflowContractV1 = z.infer<typeof workflowContractSchema>;
