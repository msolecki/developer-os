import { posix } from "node:path";
import {
  EXIT_CODES,
  hashBytes,
  INSTRUCTION_BOUNDS_V1,
  InstructionSourceInvalidError,
  parseScopedRulePaths,
} from "@developer-os/core";
import type { InstructionBlockMemberV1, InstructionCategoryV1, InstructionIdV1 } from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact, WorkflowContractV1 } from "@developer-os/workflow-schema";
import { renderAgentToml } from "./agent-toml.js";
import { renderCodexInstallTree } from "./compose.js";
import type { MarketplaceContext } from "./marketplace.js";
import { PLUGIN_TREE_PREFIX } from "./plugin.js";
import type { MarketplaceRootArtifact } from "./plugin.js";

/**
 * The CLI's `InstructionSourceSetV1` (`apps/cli/src/instructions/sources.ts`), re-declared
 * structurally: an adapter never imports the CLI.
 */
export interface InstructionSourceV1Like {
  readonly category: Exclude<InstructionCategoryV1, "command" | "vendor-file">;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly files: readonly { readonly relativePath: string; readonly bytes: Uint8Array }[];
  readonly thinCommand: boolean;
}

export interface InstructionSourceSetV1Like {
  readonly artifacts: readonly InstructionSourceV1Like[];
  readonly unsupported?: readonly { readonly category: string; readonly id: string }[];
}

export interface CodexInstructionRenderV1 {
  /** Relative to the marketplace root: `plugins/developer-os/skills/<id>/…`. */
  readonly pluginFiles: readonly MarketplaceRootArtifact[];
  /** Relative to the Codex home `C`: `agents/developer-os-<id>.toml`. */
  readonly agentFiles: readonly (RenderedArtifact & { readonly id: string })[];
  readonly block: { readonly body: string; readonly members: readonly InstructionBlockMemberV1[] };
  /** `scoped-rule` ids: carried as prose sections, the path restriction is not enforced. */
  readonly emulated: readonly string[];
  /** `output-style` ids: Codex has no such surface, nothing is written. */
  readonly unsupported: readonly string[];
}

export class InstructionBlockTooLargeError extends Error {
  readonly code = EXIT_CODES.invalidInput;
  readonly reason = "instruction_block_too_large" as const;
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit: number) {
    super(`instruction_block_too_large: ${String(bytes)} bytes exceeds ${String(limit)}`);
    this.name = "InstructionBlockTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function sourcePath(artifact: InstructionSourceV1Like): string {
  return `${artifact.category}/${artifact.id}`;
}

function singleFileText(artifact: InstructionSourceV1Like): string {
  const [file, ...rest] = artifact.files;
  if (file === undefined || rest.length > 0) throw new InstructionSourceInvalidError(sourcePath(artifact));
  return strictUtf8.decode(file.bytes);
}

function withFinalLf(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function afterFrontmatter(text: string): string {
  const lines = text.split("\n");
  const close = lines.indexOf("---", 1);
  return lines.slice(close + 1).join("\n").replace(/^\n+/u, "");
}

function byCategoryThenId(left: InstructionSourceV1Like, right: InstructionSourceV1Like): number {
  return compareCodePoints(left.category, right.category) || compareCodePoints(left.id, right.id);
}

/** An override replaces the default with its `(category, id)`; a skill as a whole directory. */
function merge(defaults: InstructionSourceSetV1Like, overrides: InstructionSourceSetV1Like): InstructionSourceV1Like[] {
  const merged = new Map<string, InstructionSourceV1Like>();
  for (const artifact of [...defaults.artifacts, ...overrides.artifacts]) merged.set(sourcePath(artifact), artifact);
  return [...merged.values()].sort(byCategoryThenId);
}

function section(artifact: InstructionSourceV1Like): string {
  const text = singleFileText(artifact);
  if (artifact.category === "rule") return `## ${artifact.id}\n\n${withFinalLf(text)}`;
  const globs = parseScopedRulePaths(sourcePath(artifact), text);
  return `## ${artifact.id} — applies only to paths matching: ${globs.join(", ")}\n\n${withFinalLf(afterFrontmatter(text))}`;
}

/**
 * Pure and byte-deterministic under any input order. Commands collapse to their skill (`codex-adapter.md` §16):
 * a `thinCommand` skill renders exactly as any other skill. `AGENTS.override.md` is never a target.
 */
export function renderInstructionTree(
  defaults: InstructionSourceSetV1Like,
  overrides: InstructionSourceSetV1Like,
): CodexInstructionRenderV1 {
  const artifacts = merge(defaults, overrides);

  const sections = [
    ...artifacts.filter((artifact) => artifact.category === "rule"),
    ...artifacts.filter((artifact) => artifact.category === "scoped-rule"),
  ].map((artifact) => ({ artifact, text: section(artifact) }));
  const body = sections.map(({ text }) => text).join("\n");
  const bodyBytes = encoder.encode(body).byteLength;
  if (bodyBytes > INSTRUCTION_BOUNDS_V1.codexBlockBytes) {
    throw new InstructionBlockTooLargeError(bodyBytes, INSTRUCTION_BOUNDS_V1.codexBlockBytes);
  }
  const members = sections.map(({ artifact, text }): InstructionBlockMemberV1 => ({
    category: artifact.category,
    id: artifact.id,
    source: artifact.source,
    sha256: hashBytes(encoder.encode(text)) as InstructionBlockMemberV1["sha256"],
  }));

  const pluginFiles = artifacts
    .filter((artifact) => artifact.category === "skill")
    .flatMap((artifact) =>
      artifact.files.map((file) => {
        const rendered: RenderedArtifact = {
          path: posix.join(PLUGIN_TREE_PREFIX, "skills", artifact.id, file.relativePath),
          contents: strictUtf8.decode(file.bytes),
        };
        return rendered as MarketplaceRootArtifact;
      }),
    )
    .sort((left, right) => compareCodePoints(left.path, right.path));

  const agentFiles = artifacts
    .filter((artifact) => artifact.category === "agent")
    .map((artifact) => ({
      id: artifact.id,
      path: `agents/developer-os-${artifact.id}.toml`,
      contents: renderAgentToml(singleFileText(artifact), artifact.id),
    }));

  const unsupported = new Set([
    ...artifacts.filter((artifact) => artifact.category === "output-style").map((artifact) => artifact.id),
    ...[...(defaults.unsupported ?? []), ...(overrides.unsupported ?? [])].map((entry) => entry.id),
  ]);

  return {
    pluginFiles,
    agentFiles,
    block: { body, members },
    emulated: artifacts.filter((artifact) => artifact.category === "scoped-rule").map((artifact) => artifact.id),
    unsupported: [...unsupported].sort(compareCodePoints),
  };
}

/**
 * The whole marketplace root: `renderCodexInstallTree` (marketplace, plugin manifest, the six
 * workflow skills) plus the instruction skills. `context` is `renderMarketplace`'s, which refuses a
 * relative home. A path claimed twice refuses: an instruction skill may not shadow a workflow skill.
 */
export function renderCodexVendorTree(
  workflows: readonly WorkflowContractV1[],
  render: CodexInstructionRenderV1,
  context: MarketplaceContext,
): readonly MarketplaceRootArtifact[] {
  const tree = [...renderCodexInstallTree(workflows, context), ...render.pluginFiles].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
  if (new Set(tree.map((artifact) => artifact.path)).size !== tree.length) {
    throw new Error("refusing a Codex vendor tree in which two artifacts claim one path");
  }
  return tree;
}
