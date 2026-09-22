import { renderHookCommand } from "@developer-os/core";
import type { HookCommandExecutable, HookVerb } from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

export type ClaudeHookEvent = "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop" | "UserPromptSubmit";

export interface ClaudeHookRow {
  readonly verb: HookVerb;
  readonly event: ClaudeHookEvent;
  readonly matcher: string | null;
  readonly timeoutSeconds: number | null;
}

export const CLAUDE_HOOKS_PATH = "hooks/hooks.json";
const EVENT_ORDER: readonly ClaudeHookEvent[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];
const FILE_TOOLS = "Edit|Write|MultiEdit";

export const CLAUDE_HOOK_ROWS: readonly ClaudeHookRow[] = Object.freeze([
  { verb: "inject", event: "SessionStart", matcher: null, timeoutSeconds: 2 },
  { verb: "prompt", event: "UserPromptSubmit", matcher: null, timeoutSeconds: 2 },
  { verb: "command", event: "PreToolUse", matcher: "Bash", timeoutSeconds: 2 },
  { verb: "commit", event: "PreToolUse", matcher: "Bash", timeoutSeconds: 2 },
  { verb: "path", event: "PreToolUse", matcher: FILE_TOOLS, timeoutSeconds: 2 },
  { verb: "format", event: "PostToolUse", matcher: FILE_TOOLS, timeoutSeconds: 35 },
  { verb: "edit", event: "PostToolUse", matcher: FILE_TOOLS, timeoutSeconds: 2 },
  { verb: "stop", event: "Stop", matcher: null, timeoutSeconds: 125 },
]);

export function renderClaudeHooks(executable: HookCommandExecutable): RenderedArtifact {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENT_ORDER) {
    const groups = CLAUDE_HOOK_ROWS.filter((row) => row.event === event).map((row) => ({
      ...(row.matcher === null ? {} : { matcher: row.matcher }),
      hooks: [{
        type: "command",
        command: renderHookCommand(executable, row.verb, "claude"),
        ...(row.timeoutSeconds === null ? {} : { timeout: row.timeoutSeconds }),
      }],
    }));
    if (groups.length > 0) hooks[event] = groups;
  }
  return { path: CLAUDE_HOOKS_PATH, contents: `${JSON.stringify({ hooks }, null, 2)}\n` };
}

export function withClaudeHooks(tree: readonly RenderedArtifact[], executable: HookCommandExecutable): readonly RenderedArtifact[] {
  if (tree.some((artifact) => artifact.path === CLAUDE_HOOKS_PATH)) {
    throw new Error("refusing to add hooks to a tree that already carries them");
  }
  return [...tree, renderClaudeHooks(executable)].sort((a, b) => compareCodePoints(a.path, b.path));
}
