import { EXIT_CODES } from "../result.js";

export type InstructionCategoryV1 =
  | "rule"
  | "scoped-rule"
  | "output-style"
  | "agent"
  | "skill"
  | "command"
  | "vendor-file";

declare const instructionId: unique symbol;
export type InstructionIdV1 = string & { readonly [instructionId]: true };

/**
 * Task 2 (`docs/architecture/codex-adapter.md`, `AGENTS.md` size limit) observed no Codex load
 * limit up to 4 MiB, so the spec's 64 KiB block bound stands unlowered.
 */
export const INSTRUCTION_BOUNDS_V1 = {
  fileBytes: 262_144,
  artifactFiles: 64,
  artifactBytes: 1_048_576,
  vendorArtifacts: 128,
  vendorBytes: 8_388_608,
  segmentDepth: 4,
  scopedGlobs: 32,
  globBytes: 256,
  codexBlockBytes: 65_536 as number,
} as const;

export class InstructionSourceInvalidError extends Error {
  readonly code = EXIT_CODES.invalidInput;
  readonly reason = "instruction_source_invalid" as const;
  readonly path: string;
  readonly line: number | null;

  constructor(path: string, line: number | null = null) {
    super(`instruction_source_invalid: ${path}${line === null ? "" : `:${String(line)}`}`);
    this.name = "InstructionSourceInvalidError";
    this.path = path;
    this.line = line;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function parseInstructionId(value: string): InstructionIdV1 {
  if (!ID_PATTERN.test(value) || value.startsWith("developer-os-")) {
    throw new Error("invalid InstructionIdV1");
  }
  return value as InstructionIdV1;
}

export function assertNotWorkflowId(id: InstructionIdV1, workflowIds: ReadonlySet<string>): void {
  if (workflowIds.has(id)) throw new Error("InstructionIdV1 names a workflow");
}

function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (bytes[index] === 0x0a) line += 1;
  return line;
}

export function assertInstructionText(path: string, bytes: Uint8Array): void {
  if (bytes.byteLength > INSTRUCTION_BOUNDS_V1.fileBytes) throw new InstructionSourceInvalidError(path);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new InstructionSourceInvalidError(path, 1);
  const bad = bytes.findIndex((byte) => byte === 0x00 || byte === 0x0d);
  if (bad !== -1) throw new InstructionSourceInvalidError(path, lineAt(bytes, bad));
  try {
    strictUtf8.decode(bytes);
  } catch {
    throw new InstructionSourceInvalidError(path);
  }
}

export function assertInstructionRelativePath(path: string): void {
  const segments = path.split("/");
  if (segments.length > INSTRUCTION_BOUNDS_V1.segmentDepth || !segments.every((segment) => SEGMENT_PATTERN.test(segment))) {
    throw new InstructionSourceInvalidError(path);
  }
}

/** One artifact (a skill directory): `fileByteLengths` holds one entry per file. */
export function assertInstructionArtifactBounds(path: string, fileByteLengths: readonly number[]): void {
  if (
    fileByteLengths.length > INSTRUCTION_BOUNDS_V1.artifactFiles ||
    fileByteLengths.reduce((sum, bytes) => sum + bytes, 0) > INSTRUCTION_BOUNDS_V1.artifactBytes
  ) {
    throw new InstructionSourceInvalidError(path);
  }
}

/** One vendor after override merge: `artifactByteLengths` holds one entry per artifact. */
export function assertInstructionVendorBounds(path: string, artifactByteLengths: readonly number[]): void {
  if (
    artifactByteLengths.length > INSTRUCTION_BOUNDS_V1.vendorArtifacts ||
    artifactByteLengths.reduce((sum, bytes) => sum + bytes, 0) > INSTRUCTION_BOUNDS_V1.vendorBytes
  ) {
    throw new InstructionSourceInvalidError(path);
  }
}

// A bare YAML scalar starting with one of these is an alias, anchor, tag, flow or block
// indicator (`- **/*.ts` is an alias to YAML), so it must be quoted to mean a glob.
const YAML_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const FLOW_BARE = /^[A-Za-z0-9_./-][A-Za-z0-9_./*?-]*$/;

function unquote(item: string): string | null {
  if (item.length >= 2 && item.startsWith('"') && item.endsWith('"')) {
    const inner = item.slice(1, -1);
    return inner.includes('"') || inner.includes("\\") ? null : inner;
  }
  if (item.length >= 2 && item.startsWith("'") && item.endsWith("'")) {
    const inner = item.slice(1, -1);
    return inner.replaceAll("''", "").includes("'") ? null : inner.replaceAll("''", "'");
  }
  return null;
}

function blockScalar(item: string): string | null {
  const quoted = unquote(item);
  if (quoted !== null) return quoted;
  if (item.length === 0 || YAML_INDICATOR.test(item) || item.includes(" #") || item.includes(": ")) return null;
  return item;
}

function flowItems(inner: string): string[] | null {
  const items: string[] = [];
  let rest = inner.trim();
  while (rest.length > 0) {
    let item: string;
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let end = 1;
      for (;;) {
        end = rest.indexOf(quote, end);
        if (end === -1) return null;
        if (quote === "'" && rest[end + 1] === "'") {
          end += 2;
          continue;
        }
        break;
      }
      item = rest.slice(0, end + 1);
      rest = rest.slice(end + 1).trimStart();
    } else {
      const comma = rest.indexOf(",");
      item = (comma === -1 ? rest : rest.slice(0, comma)).trim();
      rest = comma === -1 ? "" : rest.slice(comma);
      if (!FLOW_BARE.test(item)) return null;
    }
    const value = unquote(item) ?? (FLOW_BARE.test(item) ? item : null);
    if (value === null) return null;
    items.push(value);
    if (rest.length === 0) break;
    if (!rest.startsWith(",")) return null;
    rest = rest.slice(1).trimStart();
    if (rest.length === 0) return null;
  }
  return items;
}

/**
 * The `paths:` key of a scoped rule's frontmatter: a flow list (`paths: ["a", "b"]`, the form
 * `docs/architecture/claude-adapter.md` observed loading), a block list, or one scalar.
 */
export function parseScopedRulePaths(path: string, text: string): readonly string[] {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new InstructionSourceInvalidError(path, 1);
  const close = lines.indexOf("---", 1);
  if (close === -1) throw new InstructionSourceInvalidError(path, 1);

  let globs: string[] | null = null;
  for (let index = 1; index < close; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("paths:")) continue;
    const lineNumber = index + 1;
    if (globs !== null) throw new InstructionSourceInvalidError(path, lineNumber);
    const value = line.slice("paths:".length).trim();
    if (value.length === 0) {
      globs = [];
      while (index + 1 < close) {
        const match = /^\s+-\s+(.*?)\s*$/.exec(lines[index + 1] ?? "");
        if (match === null) break;
        index += 1;
        const glob = blockScalar(match[1] ?? "");
        if (glob === null) throw new InstructionSourceInvalidError(path, index + 1);
        globs.push(glob);
      }
    } else if (value.startsWith("[")) {
      globs = value.endsWith("]") ? flowItems(value.slice(1, -1)) : null;
    } else {
      const glob = blockScalar(value);
      globs = glob === null ? null : [glob];
    }
    if (globs === null) throw new InstructionSourceInvalidError(path, lineNumber);
    if (
      globs.length < 1 ||
      globs.length > INSTRUCTION_BOUNDS_V1.scopedGlobs ||
      globs.some((glob) => glob.length === 0 || encoder.encode(glob).byteLength > INSTRUCTION_BOUNDS_V1.globBytes)
    ) {
      throw new InstructionSourceInvalidError(path, lineNumber);
    }
  }
  if (globs === null) throw new InstructionSourceInvalidError(path, 1);
  return globs;
}
