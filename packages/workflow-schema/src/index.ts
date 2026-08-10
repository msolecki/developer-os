/**
 * `workflowContractSchema` is deliberately **not** exported, and spec §14's
 * required export list does not name it.
 *
 * `zod@4.4.3` strips a `__proto__` key before its own strictness check, so the
 * raw schema accepts a workflow carrying one and silently drops it. The refusal
 * lives in `validateWorkflow`, which makes that function the only door into this
 * package — structurally, rather than by convention. It is the same argument
 * spec §8 makes for overlays: a guarantee is better as a shape nothing can get
 * around than as a rule everyone has to remember.
 */
export {
  REFUSAL_CONDITIONS,
  WORKFLOW_CAPABILITIES,
  WORKFLOW_TRIGGERS,
} from "./contract.js";
export type {
  RefusalCondition,
  WorkflowCapability,
  WorkflowContractV1,
  WorkflowInputSchema,
  WorkflowOutputSchema,
  WorkflowRefusal,
  WorkflowStep,
  WorkflowTrigger,
} from "./contract.js";
export { parseWorkflowYaml, WORKFLOW_PARSE_OPTIONS } from "./parse.js";
export type { ParseOutcome, ParseRefusal } from "./parse.js";
export { EFFECT_VOCABULARY, isKnownVerb, lookupVerb } from "./vocabulary.js";
export type { EffectFootprint } from "./vocabulary.js";
