import { describe, expect, it } from "vitest";
import * as door from "./index.js";

/**
 * Not an inventory — a door test. `index.ts`'s own docblock records why
 * `workflowContractSchema` is not exported: `validateWorkflow` is the only
 * door into this package, structurally rather than by convention, because
 * `zod` strips a `__proto__` key before its own strictness check and the raw
 * schema would silently accept a workflow carrying one. A package with a
 * guarantee must not export the raw schema behind it alongside the guard, and
 * the only way that stays true over time is a test that fails the moment the
 * surface widens, rather than one a reviewer has to remember to compare by
 * hand.
 *
 * Modelled on `packages/adapter-codex/src/index.test.ts`, which both adapters
 * already carry; `core`, `security` and `workflow-schema` — the three
 * packages both adapters now enter through — had no equivalent.
 */
describe("the package's public door", () => {
  it("exports exactly this list, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "REFUSAL_CONDITIONS",
        "WORKFLOW_CAPABILITIES",
        "WORKFLOW_TRIGGERS",
        "compareCodePoints",
        "compareScopes",
        "deriveScopes",
        "detectWorkflowDrift",
        "firstDifferingLine",
        "sourceMarker",
        "loadWorkflow",
        "applyOverlay",
        "workflowOverlaySchema",
        "parseWorkflowYaml",
        "WORKFLOW_PARSE_OPTIONS",
        "assertRenderableContract",
        "assertUsablePreamble",
        "renderSkillBody",
        "SHARED_WORKFLOW_ID",
        "SKILL_FIELD_CAP",
        "validateWorkflow",
        "EFFECT_VOCABULARY",
        "isKnownVerb",
        "lookupVerb",
        "resolveScopeGlob",
        "structuredResultVerbs",
      ].sort(),
    );
  });
});
