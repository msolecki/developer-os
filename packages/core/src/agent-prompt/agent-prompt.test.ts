import { describe, expect, it } from "vitest";
import { parseAgentPromptArgs } from "./index.js";

describe("parseAgentPromptArgs", () => {
  it("accepts a well-formed argument object", () => {
    const parsed = parseAgentPromptArgs({ prompt: "summarise", maxTurns: 3 });
    expect(parsed).toEqual({ ok: true, args: { prompt: "summarise", maxTurns: 3 } });
  });

  it("defaults maxTurns rather than leaving the loop unbounded", () => {
    const parsed = parseAgentPromptArgs({ prompt: "summarise" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.args.maxTurns).toBeGreaterThan(0);
  });

  it("refuses an unknown key rather than ignoring it", () => {
    expect(parseAgentPromptArgs({ prompt: "x", executable: "/bin/sh" }).ok).toBe(
      false,
    );
  });

  it("refuses a missing prompt", () => {
    expect(parseAgentPromptArgs({ maxTurns: 1 }).ok).toBe(false);
  });

  it("refuses an empty prompt", () => {
    expect(parseAgentPromptArgs({ prompt: "" }).ok).toBe(false);
  });

  it("refuses a non-string prompt", () => {
    expect(parseAgentPromptArgs({ prompt: 42 }).ok).toBe(false);
  });

  /**
   * `zod@4.4.3` strips a `__proto__` key **before** its own strictness check,
   * so a hostile object carrying one passes `.strict()` and the key silently
   * vanishes. `packages/workflow-schema/src/index.ts` records the same defect
   * and is the reason `validateWorkflow` is that package's only door. The
   * screen must happen before parsing; never delete it on the grounds that
   * `.strict()` already covers it, because it does not.
   */
  it("refuses a __proto__ key that .strict() alone would not catch", () => {
    const hostile = JSON.parse(
      '{"prompt":"x","__proto__":{"polluted":true}}',
    ) as unknown;
    expect(parseAgentPromptArgs(hostile).ok).toBe(false);
  });

  it("refuses maxTurns outside its bounds", () => {
    expect(parseAgentPromptArgs({ prompt: "x", maxTurns: 0 }).ok).toBe(false);
    expect(parseAgentPromptArgs({ prompt: "x", maxTurns: 1000 }).ok).toBe(false);
    expect(parseAgentPromptArgs({ prompt: "x", maxTurns: 1.5 }).ok).toBe(false);
  });

  it("is total for any unknown input", () => {
    const inputs: readonly unknown[] = [
      null,
      undefined,
      7,
      "s",
      [],
      () => undefined,
      new Map(),
      Object.create(null),
    ];
    for (const input of inputs) {
      expect(() => parseAgentPromptArgs(input)).not.toThrow();
      expect(parseAgentPromptArgs(input).ok).toBe(false);
    }
  });

  it("never echoes the rejected value in its message", () => {
    const parsed = parseAgentPromptArgs({
      prompt: "x",
      secret: "sentinel-do-not-echo",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).not.toContain("sentinel-do-not-echo");
  });
});
