import { posix } from "node:path";

import { renderHookCommand } from "@developer-os/core";
import type { HookCommandExecutable, HookVerb } from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

import { CODEX_MANIFEST_PATH, PLUGIN_TREE_PREFIX, renderCodexManifest } from "./plugin.js";
import type { MarketplaceRootArtifact } from "./plugin.js";

/** Codex 0.155.1 reads PascalCase event keys and ignores snake_case ones (`hooks.md` §1 question 4). */
export type CodexHookEvent = "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop" | "UserPromptSubmit";

export interface CodexHookRow {
  readonly verb: HookVerb;
  readonly event: CodexHookEvent;
  readonly matcher: string | null;
  readonly timeoutSeconds: number | null;
}

/**
 * Spec §7.2's fixed manual step. Trust is granted in Codex and stored under `hooks.state` in its
 * `config.toml` (`hooks.md` §1, observed on 0.155.1); the product never writes that file (D7).
 */
export const CODEX_HOOK_TRUST_STEP =
  "approve each developer-os hook in Codex; Codex keeps the approval under hooks.state in its config.toml, which Developer OS never writes";

/** Spec §7.2's fixed uninstall line: approvals outlive the hooks they name. */
export const CODEX_HOOK_TRUST_RESIDUE =
  "Codex hook approvals for developer-os remain under hooks.state in your Codex config.toml; remove them yourself if you want them gone";

/** Relative to the plugin root; the manifest's `"hooks"` key references it. */
export const CODEX_HOOKS_PATH = "hooks/hooks.json";
const EVENT_ORDER: readonly CodexHookEvent[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];

/**
 * Codex's hook key is `<plugin>:hooks/hooks.json:<event>:<group index>:<handler index>`, and trust
 * is stored per key, so this order is part of the trust contract: moving a row moves every later
 * group in its event to a new, untrusted key. The shell arrives as `Bash` and a file edit as
 * `apply_patch` (`hooks.md` §1 question 4). Timeouts match the Claude rows: same entrypoint, same
 * child caps, and Codex's own default is 600 s.
 */
export const CODEX_HOOK_ROWS: readonly CodexHookRow[] = Object.freeze([
  { verb: "inject", event: "SessionStart", matcher: null, timeoutSeconds: 2 },
  { verb: "prompt", event: "UserPromptSubmit", matcher: null, timeoutSeconds: 2 },
  { verb: "command", event: "PreToolUse", matcher: "Bash", timeoutSeconds: 2 },
  { verb: "commit", event: "PreToolUse", matcher: "Bash", timeoutSeconds: 2 },
  { verb: "path", event: "PreToolUse", matcher: "apply_patch", timeoutSeconds: 2 },
  { verb: "format", event: "PostToolUse", matcher: "apply_patch", timeoutSeconds: 35 },
  { verb: "edit", event: "PostToolUse", matcher: "apply_patch", timeoutSeconds: 2 },
  { verb: "stop", event: "Stop", matcher: null, timeoutSeconds: 125 },
]);

export function renderCodexHooks(executable: HookCommandExecutable): RenderedArtifact {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENT_ORDER) {
    const groups = CODEX_HOOK_ROWS.filter((row) => row.event === event).map((row) => ({
      ...(row.matcher === null ? {} : { matcher: row.matcher }),
      hooks: [{
        type: "command",
        command: renderHookCommand(executable, row.verb, "codex"),
        ...(row.timeoutSeconds === null ? {} : { timeout: row.timeoutSeconds }),
      }],
    }));
    if (groups.length > 0) hooks[event] = groups;
  }
  return { path: CODEX_HOOKS_PATH, contents: `${JSON.stringify({ hooks }, null, 2)}\n` };
}

/**
 * The install tree with `hooks/hooks.json` added and the manifest's `"hooks"` key pointing at it
 * (the file-reference form, observed loading in `hooks.md` §1 question 7).
 */
export function withCodexHooks(
  tree: readonly MarketplaceRootArtifact[],
  executable: HookCommandExecutable,
): readonly MarketplaceRootArtifact[] {
  const hooksPath = posix.join(PLUGIN_TREE_PREFIX, CODEX_HOOKS_PATH);
  const manifestPath = posix.join(PLUGIN_TREE_PREFIX, CODEX_MANIFEST_PATH);
  if (tree.some((artifact) => artifact.path === hooksPath)) {
    throw new Error("refusing to add hooks to a tree that already carries them");
  }
  if (!tree.some((artifact) => artifact.path === manifestPath)) {
    throw new Error("refusing to add hooks to a tree without a plugin manifest");
  }
  const rerooted = (artifact: RenderedArtifact): MarketplaceRootArtifact =>
    ({ path: posix.join(PLUGIN_TREE_PREFIX, artifact.path), contents: artifact.contents }) as MarketplaceRootArtifact;
  const manifest = rerooted(renderCodexManifest(CODEX_HOOKS_PATH));
  return [
    ...tree.map((artifact) => (artifact.path === manifestPath ? manifest : artifact)),
    rerooted(renderCodexHooks(executable)),
  ].sort((a, b) => compareCodePoints(a.path, b.path));
}
