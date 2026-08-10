import { describe, expect, it } from "vitest";

import type { WorkflowContractV1 } from "./contract.js";
import { applyOverlay, workflowOverlaySchema } from "./overlay.js";

const base: WorkflowContractV1 = {
  schemaVersion: 1,
  id: "brain-search",
  version: "1.2.0",
  description: "Search.",
  triggers: ["manual"],
  inputs: {},
  output: {},
  capabilities: [],
  scopes: { read: ["content/_indexes/**"], write: [] },
  refusals: [],
  steps: [
    { id: "load", do: "brain.readIndex" },
    { id: "explain", prose: "Summarise why each match was returned." },
  ],
  validators: [],
  recovery: { leaves: "nothing", resume: "developer-os brain search" },
};

describe("workflowOverlaySchema", () => {
  it("has no field capable of setting a scope", () => {
    /**
     * Spec §8. The gate is not a merge rule that must be correct; it is a
     * schema that cannot express the violation. This must fail as an
     * unknown-field parse error, and the assertion names which kind.
     */
    const result = workflowOverlaySchema.safeParse({
      extends: "brain-search@1.2.0",
      scopes: { read: ["/"], write: ["/"] },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("scopes");
  });

  it("refuses refusals, capabilities and do, for the same reason", () => {
    for (const field of ["refusals", "capabilities", "do"]) {
      expect(
        workflowOverlaySchema.safeParse({
          extends: "brain-search@1.2.0",
          [field]: "anything",
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("accepts the four fields it does have", () => {
    expect(
      workflowOverlaySchema.safeParse({
        extends: "brain-search@1.2.0",
        steps: { explain: { prose: "Return matches as a markdown table." } },
        lifecycle: { bind: "session_start" },
        notes: "Claude renders tables well.",
      }).success,
    ).toBe(true);
  });
});

describe("applyOverlay", () => {
  it("replaces the prose of an existing prose step", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      steps: { explain: { prose: "Return matches as a markdown table." } },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contract.steps[1]).toStrictEqual({
      id: "explain",
      prose: "Return matches as a markdown table.",
    });
  });

  it("refuses an overlay whose extends pins a different version", () => {
    const outcome = applyOverlay(base, { extends: "brain-search@1.1.0" });
    expect(outcome).toStrictEqual({
      ok: false,
      reason:
        "overlay extends brain-search@1.1.0 but the contract is brain-search@1.2.0",
    });
  });

  it("refuses to patch a step that does not exist", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      steps: { ghost: { prose: "x" } },
    });
    expect(outcome.ok).toBe(false);
  });

  it("refuses to turn an effect step into a prose step", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      steps: { load: { prose: "just do it" } },
    });
    expect(outcome.ok).toBe(false);
  });

  it("cannot change the number or order of steps", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      steps: { explain: { prose: "new" } },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contract.steps.map((step) => step.id)).toStrictEqual([
      "load",
      "explain",
    ]);
  });

  it("does not treat an inherited property name as a patch", () => {
    /**
     * `constructor` matches the step-id slug pattern — it is all lowercase —
     * so a contract may legitimately contain a step called that. Indexing the
     * patch record with it resolved through `Object.prototype` to a `Function`,
     * which is not `undefined`, so an overlay that patches **nothing** would
     * have rewritten that step's prose to `undefined`. The same class of defect
     * both of this package's earlier reviews found, in a third place.
     */
    const withHostileId: WorkflowContractV1 = {
      ...base,
      steps: [{ id: "constructor", prose: "original" }],
    };
    const outcome = applyOverlay(withHostileId, { extends: "brain-search@1.2.0" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contract.steps).toStrictEqual([
      { id: "constructor", prose: "original" },
    ]);
  });

  it("screens and bounds a step key it names in a refusal", () => {
    /**
     * An overlay's step keys are unconstrained `z.string()`, unlike a contract's
     * step ids — so the key is author-controlled text, and it was reaching the
     * reason raw while every other message path in this package is screened.
     */
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      steps: { [`ghost\u202E${"L".repeat(300)}`]: { prose: "x" } },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).not.toContain("\u202E");
    expect(outcome.reason.length).toBeLessThan(160);
  });

  it("returns the contract unchanged when the overlay patches nothing", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      notes: "nothing to say",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contract).toStrictEqual(base);
    expect(outcome.lifecycle).toBeNull();
  });

  it("reports the lifecycle binding the overlay asked for", () => {
    const outcome = applyOverlay(base, {
      extends: "brain-search@1.2.0",
      lifecycle: { bind: "session_start" },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lifecycle).toBe("session_start");
  });
});
