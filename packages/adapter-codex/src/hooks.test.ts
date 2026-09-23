import { describe, expect, it } from "vitest";
import { HookExecutablePathError, renderHookCommand } from "@developer-os/core";
import { CODEX_HOOK_ROWS, CODEX_HOOKS_PATH, renderCodexHooks } from "./hooks.js";

const EXE = { node: "/usr/local/bin/node", entrypoint: "/Users/synthetic/.developer-os/bin/developer-os" };
const cmd = (tail: string): string => `${EXE.node} ${EXE.entrypoint} ${tail}`;

/** `docs/architecture/hooks.md` §1 questions 4 and 7: PascalCase events, the Claude-shaped document. */
const EXPECTED = `${JSON.stringify(
  {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: cmd("brain status --inject --vendor codex"), timeout: 2 }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("guard prompt --vendor codex"), timeout: 2 }] }],
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: cmd("guard command --vendor codex"), timeout: 2 }] },
        { matcher: "Bash", hooks: [{ type: "command", command: cmd("guard commit --vendor codex"), timeout: 2 }] },
        { matcher: "apply_patch", hooks: [{ type: "command", command: cmd("guard path --vendor codex"), timeout: 2 }] },
      ],
      PostToolUse: [
        { matcher: "apply_patch", hooks: [{ type: "command", command: cmd("guard format --vendor codex"), timeout: 35 }] },
        { matcher: "apply_patch", hooks: [{ type: "command", command: cmd("guard edit --vendor codex"), timeout: 2 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: cmd("guard stop --vendor codex"), timeout: 125 }] }],
    },
  },
  null,
  2,
)}\n`;

describe("renderCodexHooks", () => {
  it("renders the observed document byte for byte", () => {
    const artifact = renderCodexHooks(EXE);
    expect(artifact.path).toBe(CODEX_HOOKS_PATH);
    expect(artifact.contents).toBe(EXPECTED);
  });

  it("renders one command per Codex row, in row order", () => {
    expect(CODEX_HOOK_ROWS.length).toBe(8);
    const doc = JSON.parse(renderCodexHooks(EXE).contents) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const commands = Object.values(doc.hooks).flat().flatMap((group) => group.hooks.map((h) => h.command));
    expect(commands).toStrictEqual(CODEX_HOOK_ROWS.map((row) => renderHookCommand(EXE, row.verb, "codex")));
  });

  it("renders identical bytes twice", () => {
    expect(renderCodexHooks(EXE).contents).toBe(renderCodexHooks(EXE).contents);
  });

  it("refuses an unsafe executable path", () => {
    expect(() => renderCodexHooks({ ...EXE, entrypoint: "/a b/x" })).toThrow(HookExecutablePathError);
    expect(() => renderCodexHooks({ ...EXE, node: "node" })).toThrow(HookExecutablePathError);
  });
});
