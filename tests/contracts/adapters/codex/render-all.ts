import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PLUGIN_TREE_PREFIX,
  renderCodexPlugin,
  renderInstructionTree,
} from "@developer-os/adapter-codex";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import {
  loadDefaultInstructionSources,
  loadRepositoryWorkflows,
} from "../claude/render-all.js";
import type { RenderOptions } from "../claude/render-all.js";

export type { RenderOptions } from "../claude/render-all.js";

export const REPOSITORY_ROOT = process.cwd();
export const WORKFLOWS_ROOT = join(REPOSITORY_ROOT, "workflows");
export const GENERATED_ROOT = join(REPOSITORY_ROOT, "plugins", "codex");

/**
 * The plugin root only: `renderCodexPlugin` plus the instruction skills, re-rooted
 * from the marketplace root. Agent TOML and the `AGENTS.md` block live under the
 * Codex home, not in the plugin, so neither is checked in.
 */
export async function renderAllForCodex(
  options: RenderOptions = {},
): Promise<readonly RenderedArtifact[]> {
  const workflows = await loadRepositoryWorkflows(options);
  const { defaults, none } = await loadDefaultInstructionSources("codex", workflows, options);
  const prefix = `${PLUGIN_TREE_PREFIX}/`;
  const instructionFiles = renderInstructionTree(defaults, none).pluginFiles.map((artifact) => {
    if (!artifact.path.startsWith(prefix)) {
      throw new Error(`${artifact.path} is outside the plugin root ${PLUGIN_TREE_PREFIX}`);
    }
    return { path: artifact.path.slice(prefix.length), contents: artifact.contents };
  });
  const tree = [...renderCodexPlugin(workflows), ...instructionFiles].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
  if (new Set(tree.map((artifact) => artifact.path)).size !== tree.length) {
    throw new Error("refusing a Codex plugin tree in which two artifacts claim one path");
  }
  return tree;
}

export async function readGeneratedTree(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(GENERATED_ROOT, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const relative = absolute.slice(GENERATED_ROOT.length + 1);
    files.set(relative, await readFile(absolute, "utf8"));
  }
  return files;
}
