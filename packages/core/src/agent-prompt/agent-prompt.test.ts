import { describe, expect, it } from "vitest";
import { parseAgentPromptArgs } from "./index.js";

describe("parseAgentPromptArgs", () => {
  it("accepts a well-formed argument object", () => {
    const parsed = parseAgentPromptArgs({ prompt: "summarise" });
    expect(parsed).toEqual({ ok: true, args: { prompt: "summarise" } });
  });

  it("refuses an unknown key rather than ignoring it", () => {
    expect(parseAgentPromptArgs({ prompt: "x", executable: "/bin/sh" }).ok).toBe(
      false,
    );
  });

  it("refuses a missing prompt", () => {
    expect(parseAgentPromptArgs({}).ok).toBe(false);
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

  /**
   * Before this task, only an out-of-bounds `maxTurns` was refused; a
   * within-bounds one (`1`) was honoured. The refusal below is unconditional
   * on the value — `1` is refused for carrying the key at all, not for what
   * it is set to, which is what distinguishes this from the old bounds check
   * it replaces.
   */
  it("refuses maxTurns regardless of its value, not only ones outside the old bounds", () => {
    for (const maxTurns of [0, 1, 1.5, 1000]) {
      expect(parseAgentPromptArgs({ prompt: "x", maxTurns }).ok).toBe(false);
    }
  });

  /**
   * `docs/architecture/codex-adapter.md` §11: `maxTurns` is bounded and
   * enforced under Claude, and silently dropped under Codex — a value that
   * validates while the property it names is false, which is the shape this
   * codebase refuses everywhere else (the `scheduled` trigger carries the
   * same DOS-P7-owned refusal). This is that refusal for `agent.prompt`.
   */
  it("refuses maxTurns rather than honouring it on one vendor and dropping it on the other", () => {
    const outcome = parseAgentPromptArgs({ prompt: "hello", maxTurns: 3 });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toContain("DOS-P7");
  });

  /**
   * A regression pin, not a failing test: `maxTurns` carried `.default(5)`
   * before this change, so a `prompt`-only object was already accepted.
   * Recorded in the report as a finding, per the TDD requirement that a test
   * passing on its first run is itself something to note.
   */
  it("still accepts a prompt on its own", () => {
    expect(parseAgentPromptArgs({ prompt: "hello" }).ok).toBe(true);
  });

  it("is total for any unknown input, including hostile objects", () => {
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, "prompt", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });

    const hostileProxy = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
        ownKeys() {
          throw new Error("boom");
        },
      },
    );

    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    const inputs: readonly unknown[] = [
      null,
      undefined,
      7,
      "s",
      [],
      () => undefined,
      new Map(),
      Object.create(null),
      throwingGetter,
      hostileProxy,
      revocable.proxy,
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
