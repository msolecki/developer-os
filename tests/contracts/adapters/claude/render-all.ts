import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  renderClaudeVendorTree,
  renderInstructionTree,
} from "@developer-os/adapter-claude";
import {
  loadInstructionDefaults,
  mergeInstructionSources,
} from "@developer-os/cli/dist/instructions/sources.js";
import type {
  InstructionDefaultsV1,
  InstructionSourceSetV1,
} from "@developer-os/cli/dist/instructions/sources.js";
import type { AdmittedPackagedReleaseV1 } from "@developer-os/cli/dist/update/packaged-release.js";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { RenderedArtifact, WorkflowContractV1 } from "@developer-os/workflow-schema";
import { collectTree } from "../../../tools/pack-local-release.js";

export const REPOSITORY_ROOT = process.cwd();
export const WORKFLOWS_ROOT = join(REPOSITORY_ROOT, "workflows");
export const GENERATED_ROOT = join(REPOSITORY_ROOT, "plugins", "claude");

/**
 * The import lines and the `CLAUDE.md` block are the only outputs that embed the
 * product home, and neither lives in the plugin root, so no path reaches `plugins/claude/`.
 */
const PLACEHOLDER_PRODUCT_HOME = "/developer-os";

export interface RenderOptions {
  /**
   * Reverse the directory listing before loading. Claude architecture former §7.3 owes DOS-P3 proof
   * that the artifacts are byte-identical under a reversed reader, and the only
   * way to prove it is to actually reverse one.
   */
  readonly reverseDirectoryOrder?: boolean;
}

export async function loadRepositoryWorkflows(
  options: RenderOptions = {},
): Promise<readonly WorkflowContractV1[]> {
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
  return contracts;
}

/**
 * The repository's `instructions/` through the runtime loader, so the checked-in tree
 * passes the same catalog, unclaimed-file and bounds checks as an install. Only the
 * three members `loadInstructionDefaults` reads exist; the file set is the one
 * `pack:local-release` bundles.
 */
export async function loadRepositoryInstructionDefaults(
  workflows: readonly WorkflowContractV1[],
  options: RenderOptions = {},
): Promise<InstructionDefaultsV1> {
  const tree = await collectTree(REPOSITORY_ROOT, "instructions");
  const bytes = new Map(tree.map((file) => [`bundle/${file.relativePath}`, file.bytes]));
  const files = [...bytes.keys()].map((relativePath) => ({ relativePath }));
  const release = {
    bundleRoot: "bundle",
    files: options.reverseDirectoryOrder === true ? files.reverse() : files,
    readFile: (relativePath: string): Promise<Uint8Array> => {
      const found = bytes.get(relativePath);
      if (found === undefined) return Promise.reject(new Error(`${relativePath} is not in instructions/`));
      return Promise.resolve(found);
    },
  } as unknown as AdmittedPackagedReleaseV1;
  return loadInstructionDefaults(release, new Set(workflows.map((workflow) => workflow.id)));
}

/** Defaults alone, never overrides (`foundation.md` §12.1). */
export async function loadDefaultInstructionSources(
  vendor: "claude" | "codex",
  workflows: readonly WorkflowContractV1[],
  options: RenderOptions = {},
): Promise<{ readonly defaults: InstructionSourceSetV1; readonly none: InstructionSourceSetV1 }> {
  const defaults = await loadRepositoryInstructionDefaults(workflows, options);
  return {
    defaults: mergeInstructionSources(vendor, defaults, []),
    none: { vendor, artifacts: [], unsupported: [] },
  };
}

export async function renderAllForClaude(
  options: RenderOptions = {},
): Promise<readonly RenderedArtifact[]> {
  const workflows = await loadRepositoryWorkflows(options);
  const { defaults, none } = await loadDefaultInstructionSources("claude", workflows, options);
  return renderClaudeVendorTree(
    workflows,
    renderInstructionTree(defaults, none, PLACEHOLDER_PRODUCT_HOME),
  );
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
