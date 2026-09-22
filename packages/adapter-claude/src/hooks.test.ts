import { describe, expect, it } from "vitest";
import { HookExecutablePathError, renderHookCommand } from "@developer-os/core";
import { CLAUDE_HOOK_ROWS, renderClaudeHooks } from "./hooks.js";

const EXE = "/Users/synthetic/.developer-os/bin/developer-os";

interface RenderedHooks {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>>;
}

describe("renderClaudeHooks", () => {
  it("renders one entry per Claude row with byte-exact commands", () => {
    const doc = JSON.parse(renderClaudeHooks(EXE).contents) as RenderedHooks;
    const commands = Object.values(doc.hooks).flat().flatMap((group) => group.hooks.map((h) => h.command));
    expect(CLAUDE_HOOK_ROWS.length).toBe(8);
    expect(commands).toStrictEqual(CLAUDE_HOOK_ROWS.map((row) => renderHookCommand(EXE, row.verb, "claude")));
    expect(doc.hooks.PreToolUse?.map((g) => g.matcher)).toStrictEqual(["Bash", "Bash", "Edit|Write|MultiEdit"]);
    expect(doc.hooks.Stop?.[0]).not.toHaveProperty("matcher");
  });

  it("renders identical bytes twice", () => {
    expect(renderClaudeHooks(EXE).contents).toBe(renderClaudeHooks(EXE).contents);
  });

  it("emits each row's timeout on its rendered entry", () => {
    const doc = JSON.parse(renderClaudeHooks(EXE).contents) as RenderedHooks;
    const timeouts = Object.values(doc.hooks).flat().flatMap((group) => group.hooks.map((h) => h.timeout));
    expect(timeouts.length).toBeGreaterThan(0);
    expect(timeouts).toStrictEqual(CLAUDE_HOOK_ROWS.map((row) => row.timeoutSeconds));
    expect(doc.hooks.Stop?.[0]?.hooks[0]?.timeout).toBe(125);
    expect(doc.hooks.PostToolUse?.[0]?.hooks[0]?.timeout).toBe(35);
  });

  it("declares a timeout on every row, stop and format above their child caps by 5 s", () => {
    expect(CLAUDE_HOOK_ROWS.length).toBeGreaterThan(0);
    for (const row of CLAUDE_HOOK_ROWS) expect(row.timeoutSeconds).not.toBeNull();
    expect(CLAUDE_HOOK_ROWS.find((r) => r.verb === "stop")?.timeoutSeconds).toBe(125);
    expect(CLAUDE_HOOK_ROWS.find((r) => r.verb === "format")?.timeoutSeconds).toBe(35);
  });

  it("refuses an unsafe executable path", () => {
    expect(() => renderClaudeHooks("/a b/x")).toThrow(HookExecutablePathError);
  });
});
