import type { LowerHexSha256 } from "../update/scalars.js";
import { hashBytes } from "./store.js";

export const INSTRUCTION_BLOCK_BEGIN = "<!-- developer-os:begin v1 -->";
export const INSTRUCTION_BLOCK_END = "<!-- developer-os:end v1 -->";

export type InstructionBlockExtractionV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed" }
  | { readonly kind: "present"; readonly start: number; readonly end: number; readonly block: Uint8Array };

export type InstructionBlockMergeV1 =
  | { readonly action: "write"; readonly reported: "updated" | "restored" }
  | { readonly action: "none" }
  | { readonly action: "refuse"; readonly reason: "instruction_block_malformed" | "instruction_block_conflict" };

const LF = 0x0a;
const encoder = new TextEncoder();
const BEGIN = encoder.encode(INSTRUCTION_BLOCK_BEGIN);
const END = encoder.encode(INSTRUCTION_BLOCK_END);

// Outputs are always fresh plain Uint8Arrays: callers pass fs Buffers, and a
// Buffer slice is not toStrictEqual to a Uint8Array with the same bytes.
function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function occurrences(file: Uint8Array, marker: Uint8Array): number[] {
  const view = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  const found: number[] = [];
  for (let at = view.indexOf(marker); at !== -1; at = view.indexOf(marker, at + 1)) found.push(at);
  return found;
}

function ownLine(file: Uint8Array, at: number, length: number): boolean {
  return (at === 0 || file[at - 1] === LF) && file[at + length] === LF;
}

export function extractInstructionBlock(file: Uint8Array): InstructionBlockExtractionV1 {
  const begins = occurrences(file, BEGIN);
  const ends = occurrences(file, END);
  if (begins.length === 0 && ends.length === 0) return { kind: "absent" };
  const [begin] = begins;
  const [end] = ends;
  if (begins.length !== 1 || ends.length !== 1 || begin === undefined || end === undefined) return { kind: "malformed" };
  if (begin >= end || !ownLine(file, begin, BEGIN.byteLength) || !ownLine(file, end, END.byteLength)) return { kind: "malformed" };
  const stop = end + END.byteLength + 1;
  return { kind: "present", start: begin, end: stop, block: concat(file.subarray(begin, stop)) };
}

function present(file: Uint8Array, operation: string): Extract<InstructionBlockExtractionV1, { kind: "present" }> {
  const extraction = extractInstructionBlock(file);
  if (extraction.kind !== "present") throw new Error(`${operation} requires a well-formed instruction block; found ${extraction.kind}`);
  return extraction;
}

function assertWholeBlock(block: Uint8Array): void {
  const extraction = present(block, "an instruction block");
  if (extraction.start !== 0 || extraction.end !== block.byteLength) throw new Error("an instruction block must hold only the block bytes");
}

export function renderInstructionBlock(input: { readonly productHome: string; readonly vendor: "claude" | "codex"; readonly body: string }): Uint8Array {
  const body = input.body.length > 0 && !input.body.endsWith("\n") ? `${input.body}\n` : input.body;
  const header = `<!-- Managed by developer-os. Edits inside this block are refused; change ${input.productHome}/instructions/${input.vendor}/ instead. -->`;
  const block = encoder.encode(`${INSTRUCTION_BLOCK_BEGIN}\n${header}\n${body}${INSTRUCTION_BLOCK_END}\n`);
  assertWholeBlock(block);
  return block;
}

export function insertInstructionBlock(file: Uint8Array | null, block: Uint8Array): Uint8Array {
  assertWholeBlock(block);
  if (file === null) return concat(block);
  if (extractInstructionBlock(file).kind !== "absent") throw new Error("insertInstructionBlock requires a file without instruction block markers");
  const separator = file.byteLength > 0 && file[file.byteLength - 1] !== LF ? Uint8Array.of(LF) : new Uint8Array(0);
  return concat(file, separator, block);
}

export function replaceInstructionBlock(file: Uint8Array, block: Uint8Array): Uint8Array {
  assertWholeBlock(block);
  const current = present(file, "replaceInstructionBlock");
  return concat(file.subarray(0, current.start), block, file.subarray(current.end));
}

export function stripInstructionBlock(file: Uint8Array): Uint8Array {
  const current = present(file, "stripInstructionBlock");
  return concat(file.subarray(0, current.start), file.subarray(current.end));
}

export function decideInstructionBlockMerge(input: {
  readonly baseHash: LowerHexSha256 | null;
  readonly current: InstructionBlockExtractionV1;
  readonly proposed: Uint8Array;
}): InstructionBlockMergeV1 {
  const { current } = input;
  if (current.kind === "malformed") return { action: "refuse", reason: "instruction_block_malformed" };
  if (current.kind === "absent") return { action: "write", reported: input.baseHash === null ? "updated" : "restored" };
  const currentHash = hashBytes(current.block);
  if (currentHash === hashBytes(input.proposed)) return { action: "none" };
  if (currentHash === input.baseHash) return { action: "write", reported: "updated" };
  return { action: "refuse", reason: "instruction_block_conflict" };
}
