import { describe, expect, it } from "vitest";

import { validateWorkflow } from "./validate.js";

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "sample",
    version: "1.0.0",
    description: "A sample.",
    triggers: ["manual"],
    inputs: {},
    output: {},
    capabilities: [],
    scopes: { read: ["content/_indexes/**"], write: [] },
    refusals: [],
    steps: [{ id: "a", do: "brain.search" }],
    validators: [],
    recovery: { leaves: "nothing", resume: "developer-os doctor" },
    ...overrides,
  };
}

describe("validateWorkflow", () => {
  it("accepts a workflow whose declared scopes equal its derived ones", () => {
    const result = validateWorkflow("workflows/sample/workflow.yaml", raw());
    expect(result.findings.filter((f) => f.severity === "error")).toStrictEqual([]);
    expect(result.contract).not.toBeNull();
  });

  it("reports every finding, not the first", () => {
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({
        scopes: { read: [], write: ["content/**"] },
        steps: [
          { id: "a", do: "brain.search" },
          { id: "b", do: "brain.nope" },
        ],
      }),
    );
    /**
     * The exact set, not a floor. `length > 2` against an input producing
     * exactly three findings would not notice a regression that dropped one of
     * them, which is the failure this rule exists to prevent.
     */
    expect([...result.findings.map((f) => f.rule)].sort()).toStrictEqual([
      "scope-over-declared",
      "scope-under-declared",
      "unknown-verb",
    ]);
  });

  /**
   * `agent.prompt`, because it is the only verb left without a handler: DOS-P6
   * Task 13 shipped `developer-os ingest` and flipped the last three
   * `ingest.*` verbs to implemented, which is what this case used to be written
   * against. A case pinned to a verb that ships is a case whose subject moves,
   * and the rule under test is about the *table's* `implemented` flag rather
   * than about any particular row.
   */
  it("raises an info finding per unimplemented verb, naming its owner", () => {
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({
        scopes: { read: [], write: [] },
        steps: [{ id: "a", do: "agent.prompt" }],
      }),
    );
    const info = result.findings.filter((f) => f.severity === "info");
    expect(info).toHaveLength(1);
    expect(info[0]?.message).toContain("adapters");
    expect(result.errorCount).toBe(0);
  });

  it("requires a refusal for every capability the workflow declares", () => {
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({ capabilities: ["structured_result"] }),
    );
    expect(result.findings.map((f) => f.rule)).toContain("capability-refusal-missing");
  });

  it("names a missing capability even when the verb is already implemented", () => {
    /**
     * Ruled by the founder on 2026-08-10, before Task 1. As drafted, this check
     * sat inside the unimplemented-verb branch and could therefore never fire
     * for a verb that has a handler — `cli.run` is implemented and needs
     * `non_interactive_run`, so Task 10's `missing-capability` fixture would
     * have asserted a rule that was unreachable. Whether a verb needs a
     * capability has nothing to do with whether its handler exists yet.
     */
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({
        refusals: [
          { when: "capability-missing", exit: 4, message: "needs a non-interactive run" },
        ],
        scopes: { read: [], write: [] },
        steps: [{ id: "a", do: "cli.run" }],
      }),
    );
    expect(result.findings.map((f) => f.rule)).toContain("capability-undeclared");
    expect(result.findings.filter((f) => f.severity === "info")).toStrictEqual([]);
  });

  it("keeps an authored message whole while capping the value inside it", () => {
    /**
     * Also ruled on 2026-08-10. Capping the whole message at 64 graphemes cut
     * the `scheduled` refusal off at "the scheduler is la", removing the
     * `DOS-P7` that Task 10 asserts on and that tells the author where the
     * feature actually lives. The bound belongs on the interpolated fragment,
     * which is the author-controlled part.
     */
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({ triggers: ["scheduled"] }),
    );
    expect(JSON.stringify(result.findings)).toContain("DOS-P7");

    const long = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({ steps: [{ id: "a", do: `brain.${"n".repeat(500)}` }] }),
    );
    const unknown = long.findings.find((f) => f.rule === "unknown-verb");
    expect(unknown?.message).toContain("is not in the effect vocabulary");
    expect(unknown?.message.length).toBeLessThan(200);
  });

  it("never echoes file content into a message", () => {
    /**
     * On paths that are genuinely interpolated. The first version put the
     * sentinel in `description` — a field no rule ever interpolates — of a
     * workflow that was otherwise **valid**, so it produced zero findings and
     * `JSON.stringify([])` contained no sentinel for any implementation, one
     * with no redaction included. A gate that passes by scanning nothing.
     */
    const cases = [
      raw({ steps: [{ id: "a", do: `brain.${"x".repeat(500)}SECRET-SENTINEL` }] }),
      raw({ scopes: { read: [`content/${"y".repeat(500)}SECRET-SENTINEL`], write: [] } }),
    ];
    for (const input of cases) {
      const result = validateWorkflow("workflows/sample/workflow.yaml", input);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(JSON.stringify(result.findings)).not.toContain("SECRET-SENTINEL");
    }
  });

  it("screens and bounds the file path, which is author-controlled too", () => {
    /**
     * `file` was the one field `add` passed through raw. `workflows/` is meant
     * to become user-extensible, and at that point a directory name is written
     * by an author: a U+202E in it reorders every line a renderer prints after
     * it, which is the Trojan Source case the screen exists for.
     */
    const hostile = `evil\u202E\u0007${"L".repeat(400)}.yaml`;
    const result = validateWorkflow(hostile, raw({ triggers: ["scheduled"] }));
    const finding = result.findings[0];
    expect(finding).toBeDefined();
    expect(finding?.file).not.toContain("\u202E");
    expect(finding?.file).not.toContain("\u0007");
    expect(finding?.file.length).toBeLessThan(300);
  });

  it("names the step of every unknown verb, including a repeated one", () => {
    /**
     * Workflow architecture former §11: a finding carries the step id. This rule read a *set* of verb
     * strings, so the step id was gone before it could be attached and two
     * steps sharing one bad verb collapsed into a single finding — the author
     * fixed one occurrence and met the same error again.
     */
    const result = validateWorkflow(
      "f.yaml",
      raw({
        scopes: { read: [], write: [] },
        steps: [
          { id: "first", do: "brain.nope" },
          { id: "second", do: "brain.nope" },
        ],
      }),
    );
    const unknown = result.findings.filter((f) => f.rule === "unknown-verb");
    expect(unknown.map((f) => f.stepId)).toStrictEqual(["first", "second"]);
  });

  it("returns a result for input no file could produce, rather than throwing", () => {
    /**
     * `validateWorkflow` takes `unknown` and is documented as supporting a
     * hand-built value, so its totality cannot rest on `parseWorkflowYaml`
     * having refused the hostile shapes first. The reserved-key walk was a
     * plain recursion: a cycle and about four thousand levels of nesting each
     * overflowed the stack, and a throwing getter propagated straight out.
     */
    const circular: Record<string, unknown> = raw();
    circular["self"] = circular;
    expect(() => validateWorkflow("f.yaml", circular)).not.toThrow();

    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 20_000; index += 1) deep = { n: deep };
    expect(() => validateWorkflow("f.yaml", deep)).not.toThrow();

    const trap: Record<string, unknown> = raw();
    Object.defineProperty(trap, "boom", {
      enumerable: true,
      get() {
        throw new Error("a getter must never be invoked by a guard");
      },
    });
    expect(() => validateWorkflow("f.yaml", trap)).not.toThrow();
  });

  it("says so when the input is too large to check, rather than passing it", () => {
    /**
     * A budget that returns "no reserved key" on exhaustion would be a guard
     * that answers cleanly precisely when it stopped looking.
     */
    const wide = raw({ validators: Array.from({ length: 200_000 }, () => ({})) });
    const result = validateWorkflow("f.yaml", wide);
    expect(result.findings.map((f) => f.rule)).toContain("input-too-large");
    expect(result.contract).toBeNull();
  });

  it("returns findings rather than throwing on any hostile name", () => {
    /**
     * Both of this task's reviews found the same class independently: a plain
     * object literal used as a lookup table inherits `Object.prototype`, so
     * `table[key] !== undefined` is true for `toString`, and the value is a
     * `Function`. A step verb crashed at `footprint.read is not iterable`; a
     * trigger crashed at `value.replace is not a function`, inside the redaction
     * seam. A four-character file aborted a run meant to report on six.
     */
    for (const hostile of ["toString", "constructor", "valueOf", "__proto__"]) {
      const verb = () => validateWorkflow("f.yaml", raw({ steps: [{ id: "a", do: hostile }] }));
      expect(verb, hostile).not.toThrow();
      expect(verb().findings.map((f) => f.rule), hostile).toContain("unknown-verb");

      const trigger = () => validateWorkflow("f.yaml", raw({ triggers: [hostile] }));
      expect(trigger, hostile).not.toThrow();
      expect(trigger().errorCount, hostile).toBeGreaterThan(0);
    }
  });

  it("refuses an own __proto__ key instead of letting zod drop it", () => {
    /**
     * The one hole in `.strict()`: zod 4.4.3 skips a `__proto__` key in both its
     * object and record parsers *before* the unknown-key check runs, so the one
     * field name that must never be ignored was the only one that was. Not
     * prototype pollution — zod's skip is what prevents that — but a silent
     * drop, which contradicts "unknown fields are refused, never ignored". The
     * schema structurally cannot see the key, so the refusal lives here, which
     * is the choke point every path goes through.
     */
    for (const hostile of [
      raw({ steps: [JSON.parse('{"id":"a","do":"brain.search","__proto__":{"x":1}}') as unknown] }),
      JSON.parse('{"__proto__":{"x":1}}') as unknown,
    ]) {
      const result = validateWorkflow("f.yaml", hostile);
      expect(result.findings.map((f) => f.rule)).toContain("reserved-key");
      expect(result.contract).toBeNull();
    }
  });

  it("screens a control character out of any value it does interpolate", () => {
    const result = validateWorkflow(
      "workflows/sample/workflow.yaml",
      raw({ steps: [{ id: "a", do: "brain.nope\u202Ebad" }] }),
    );
    expect(JSON.stringify(result.findings)).not.toContain("\u202E");
  });
});
