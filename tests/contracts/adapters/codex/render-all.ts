import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderCodexPlugin } from "@developer-os/adapter-codex";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";

export const REPOSITORY_ROOT = process.cwd();
export const WORKFLOWS_ROOT = join(REPOSITORY_ROOT, "workflows");
export const GENERATED_ROOT = join(REPOSITORY_ROOT, "plugins", "codex");

export interface RenderOptions {
  /**
   * Reverse the directory listing before loading. Spec §7.3 owes DOS-P3 proof
   * that the artifacts are byte-identical under a reversed reader, and the only
   * way to prove it is to actually reverse one.
   */
  readonly reverseDirectoryOrder?: boolean;
}

export async function renderAllForCodex(
  options: RenderOptions = {},
): Promise<readonly RenderedArtifact[]> {
  const entries = await readdir(WORKFLOWS_ROOT, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const ordered =
    options.reverseDirectoryOrder === true
      ? [...directories].reverse()
      : directories;

  const contracts = [];
  for (const name of ordered) {
    const file = join("workflows", name, "workflow.yaml");
    const text = await readFile(join(WORKFLOWS_ROOT, name, "workflow.yaml"), "utf8");
    const result = loadWorkflow({ file, text });
    if (result.contract === null) {
      throw new Error(
        `${file} did not validate: ${result.findings.map((f) => f.message).join("; ")}`,
      );
    }
    contracts.push(result.contract);
  }
  return renderCodexPlugin(contracts);
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
