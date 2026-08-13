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
export { compareCodePoints, compareScopes, deriveScopes } from "./derive.js";
export type { DerivedScopes, ScopeMismatch } from "./derive.js";
export { detectWorkflowDrift, firstDifferingLine, sourceMarker } from "./drift.js";
export type {
  RenderedArtifact,
  WorkflowDriftFinding,
  WorkflowRenderer,
} from "./drift.js";
export { loadWorkflow } from "./load.js";
export type { WorkflowSource } from "./load.js";
export { applyOverlay, workflowOverlaySchema } from "./overlay.js";
export type { OverlayOutcome, WorkflowOverlayV1 } from "./overlay.js";
export { parseWorkflowYaml, WORKFLOW_PARSE_OPTIONS } from "./parse.js";
export type { ParseOutcome, ParseRefusal } from "./parse.js";
/**
 * The half of a skill that is not vendor behaviour. `SKILL_FIELD_CAP` is on the
 * door with it: the `description` an adapter puts in its own frontmatter is
 * screened by that adapter, and two adapters inventing their own bound is two
 * trees that differ on a long description with no test comparing them.
 */
export {
  assertRenderableContract,
  assertUsablePreamble,
  renderSkillBody,
  SHARED_WORKFLOW_ID,
  SKILL_FIELD_CAP,
} from "./skill.js";
export type { SkillBodyOptions } from "./skill.js";
export { validateWorkflow } from "./validate.js";
export type {
  WorkflowFinding,
  WorkflowSeverity,
  WorkflowValidationResult,
} from "./validate.js";
export {
  EFFECT_VOCABULARY,
  isKnownVerb,
  lookupVerb,
  resolveScopeGlob,
} from "./vocabulary.js";
export type { EffectFootprint } from "./vocabulary.js";
