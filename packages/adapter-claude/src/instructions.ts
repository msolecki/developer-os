import { posix } from "node:path";
import {
  assertInstructionRelativePath,
  EXIT_CODES,
  hashBytes,
  parseInstructionId,
} from "@developer-os/core";
import type {
  InstructionBlockMemberV1,
  InstructionCategoryV1,
  InstructionIdV1,
} from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type {
  RenderedArtifact,
  WorkflowContractV1,
} from "@developer-os/workflow-schema";
import { renderClaudePlugin } from "./compose.js";

type SourceCategory = Exclude<InstructionCategoryV1, "command" | "vendor-file">;

/**
 * The CLI's `InstructionSourceV1` / `InstructionSourceSetV1`
 * (`apps/cli/src/instructions/sources.ts`), re-declared structurally: an
 * adapter never imports the CLI.
 */
export interface InstructionSourceV1Like {
  readonly category: SourceCategory;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly files: readonly { readonly relativePath: string; readonly bytes: Uint8Array }[];
  readonly thinCommand: boolean;
  readonly vendors: readonly ("claude" | "codex")[];
}

export interface InstructionSourceSetV1Like {
  readonly vendor: "claude" | "codex";
  readonly artifacts: readonly InstructionSourceV1Like[];
  readonly unsupported: readonly { readonly category: string; readonly id: string; readonly path: string }[];
}

export interface ClaudeInstructionRenderV1 {
  /** Relative to `H/.claude/skills/developer-os/`: `skills/<id>/…`, `agents/<id>.md`, `commands/<id>.md`. */
  readonly pluginFiles: readonly RenderedArtifact[];
  /** `developer-os-<id>.md`, relative to `H/.claude/<target>/`. */
  readonly homeFiles: readonly (RenderedArtifact & {
    readonly target: "rules" | "output-styles";
    readonly category: "scoped-rule" | "output-style";
    readonly id: string;
  })[];
  /** `<id>.md`, relative to `P/claude/instructions/`. */
  readonly importFiles: readonly (RenderedArtifact & { readonly id: string })[];
  readonly block: { readonly body: string; readonly members: readonly InstructionBlockMemberV1[] };
}

export class InstructionPathNotImportableError extends Error {
  readonly code = EXIT_CODES.invalidInput;
  readonly reason = "instruction_path_not_importable" as const;
  readonly path: string;

  constructor(path: string) {
    super(`instruction_path_not_importable: ${path}`);
    this.name = "InstructionPathNotImportableError";
    this.path = path;
  }
}

const IMPORTABLE_SEGMENT = /^[A-Za-z0-9._-]+$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * `foundation.md` §12.1: Claude's `@` import takes the path up to the first whitespace, so
 * a product home that needs quoting cannot be imported at all.
 */
function assertImportable(productHome: string): void {
  const segments = productHome.split("/").slice(1);
  if (
    !posix.isAbsolute(productHome) ||
    posix.normalize(productHome) !== productHome ||
    !segments.every((segment) => IMPORTABLE_SEGMENT.test(segment) && segment !== "." && segment !== "..")
  ) {
    throw new InstructionPathNotImportableError(productHome);
  }
}

function key(artifact: InstructionSourceV1Like): string {
  return `${artifact.category}/${artifact.id}`;
}

function merge(
  defaults: InstructionSourceSetV1Like,
  overrides: InstructionSourceSetV1Like,
): readonly InstructionSourceV1Like[] {
  if (defaults.vendor !== "claude" || overrides.vendor !== "claude") {
    throw new Error("the Claude adapter renders only the claude instruction source set");
  }
  const merged = new Map<string, InstructionSourceV1Like>();
  // An override replaces the default whole: a skill's default-only extra file disappears.
  for (const artifact of [...defaults.artifacts, ...overrides.artifacts]) {
    if (artifact.vendors.includes("claude")) merged.set(key(artifact), artifact);
  }
  return [...merged.values()].sort((left, right) => compareCodePoints(key(left), key(right)));
}

function single(artifact: InstructionSourceV1Like): string {
  const [file] = artifact.files;
  if (file === undefined || artifact.files.length !== 1) {
    throw new Error(`instruction ${key(artifact)} must be exactly one file`);
  }
  return decoder.decode(file.bytes);
}

function thinCommand(id: string): string {
  return [
    "---",
    `description: ${JSON.stringify(`Invoke the developer-os:${id} skill`)}`,
    "---",
    "",
    `Invoke the \`developer-os:${id}\` skill with these arguments: $ARGUMENTS`,
    "",
  ].join("\n");
}

export function renderInstructionTree(
  defaults: InstructionSourceSetV1Like,
  overrides: InstructionSourceSetV1Like,
  productHome: string,
): ClaudeInstructionRenderV1 {
  assertImportable(productHome);
  const pluginFiles: RenderedArtifact[] = [];
  const homeFiles: ClaudeInstructionRenderV1["homeFiles"][number][] = [];
  const importFiles: ClaudeInstructionRenderV1["importFiles"][number][] = [];
  const lines: string[] = [];
  const members: InstructionBlockMemberV1[] = [];

  for (const artifact of merge(defaults, overrides)) {
    // The id reaches every path below; checked here, not trusted from the loader.
    const id = parseInstructionId(artifact.id);
    switch (artifact.category) {
      case "rule": {
        const line = `@${productHome}/claude/instructions/${id}.md`;
        importFiles.push({ path: `${id}.md`, contents: single(artifact), id });
        lines.push(line);
        members.push({
          category: "rule",
          id,
          source: artifact.source,
          sha256: hashBytes(encoder.encode(`${line}\n`)) as InstructionBlockMemberV1["sha256"],
        });
        break;
      }
      case "scoped-rule":
        homeFiles.push({ path: `developer-os-${id}.md`, contents: single(artifact), target: "rules", category: "scoped-rule", id });
        break;
      case "output-style":
        homeFiles.push({ path: `developer-os-${id}.md`, contents: single(artifact), target: "output-styles", category: "output-style", id });
        break;
      case "agent":
        pluginFiles.push({ path: `agents/${id}.md`, contents: single(artifact) });
        break;
      case "skill":
        if (!artifact.files.some((file) => file.relativePath === "SKILL.md")) {
          throw new Error(`instruction ${key(artifact)} has no SKILL.md`);
        }
        for (const file of artifact.files) {
          assertInstructionRelativePath(file.relativePath);
          pluginFiles.push({ path: `skills/${id}/${file.relativePath}`, contents: decoder.decode(file.bytes) });
        }
        if (artifact.thinCommand) pluginFiles.push({ path: `commands/${id}.md`, contents: thinCommand(id) });
        break;
    }
  }

  const byPath = (left: RenderedArtifact, right: RenderedArtifact): number => compareCodePoints(left.path, right.path);
  return {
    pluginFiles: pluginFiles.sort(byPath),
    homeFiles: homeFiles.sort((left, right) => compareCodePoints(`${left.target}/${left.path}`, `${right.target}/${right.path}`)),
    importFiles: importFiles.sort(byPath),
    block: { body: lines.map((line) => `${line}\n`).join(""), members },
  };
}

export function renderClaudeVendorTree(
  workflows: readonly WorkflowContractV1[],
  render: ClaudeInstructionRenderV1,
): readonly RenderedArtifact[] {
  const tree = [...renderClaudePlugin(workflows), ...render.pluginFiles].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  );
  if (new Set(tree.map((artifact) => artifact.path)).size !== tree.length) {
    throw new Error("refusing a Claude plugin tree in which an instruction and a workflow claim one path");
  }
  return tree;
}
