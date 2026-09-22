import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decideInstructionBlockMerge,
  extractInstructionBlock,
  insertInstructionBlock,
  INSTRUCTION_BLOCK_BEGIN,
  INSTRUCTION_BLOCK_END,
  renderInstructionBlock,
  replaceInstructionBlock,
  stripInstructionBlock,
} from "./instruction-block.js";
import type { LowerHexSha256 } from "../update/scalars.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]): Uint8Array => bytes(parts.map((part) => new TextDecoder().decode(part)).join(""));
const hash = (value: Uint8Array): LowerHexSha256 => createHash("sha256").update(value).digest("hex") as LowerHexSha256;

const BLOCK = renderInstructionBlock({ productHome: "/Users/me/.developer-os", vendor: "claude", body: "@/Users/me/.developer-os/claude/instructions/a.md\n" });
const OTHER_BLOCK = renderInstructionBlock({ productHome: "/Users/me/.developer-os", vendor: "claude", body: "@/Users/me/.developer-os/claude/instructions/b.md\n" });

describe("renderInstructionBlock", () => {
  it("names the override directory with P substituted on the second line", () => {
    const lines = new TextDecoder().decode(renderInstructionBlock({ productHome: "/home/u/.developer-os", vendor: "codex", body: "## a\ntext" })).split("\n");
    expect(lines).toStrictEqual([
      INSTRUCTION_BLOCK_BEGIN,
      "<!-- Managed by developer-os. Edits inside this block are refused; change /home/u/.developer-os/instructions/codex/ instead. -->",
      "## a",
      "text",
      INSTRUCTION_BLOCK_END,
      "",
    ]);
  });

  it("refuses a body that carries a marker line", () => {
    expect(() => renderInstructionBlock({ productHome: "/p", vendor: "claude", body: `${INSTRUCTION_BLOCK_END}\n` })).toThrow();
  });
});

describe("insert, replace and strip", () => {
  it.each([
    ["with a final LF", "user\n"], ["without a final LF", "user"], ["with CRLF user bytes", "a\r\nb\r\n"], ["empty", ""],
  ])("inserts and strips byte-exactly %s", (_label, text) => {
    const before = bytes(text);
    const round = stripInstructionBlock(insertInstructionBlock(before, BLOCK));
    expect(round).toStrictEqual(text.length > 0 && !text.endsWith("\n") ? bytes(`${text}\n`) : before);
  });

  it("appends directly after the final LF with no separator line", () => {
    expect(insertInstructionBlock(bytes("user\n"), BLOCK)).toStrictEqual(concat(bytes("user\n"), BLOCK));
  });

  it("creates a missing file holding exactly the block", () => {
    expect(insertInstructionBlock(null, BLOCK)).toStrictEqual(BLOCK);
  });

  it("refuses to insert into a file that already has markers", () => {
    expect(() => insertInstructionBlock(BLOCK, OTHER_BLOCK)).toThrow();
  });

  it("keeps bytes outside a mid-file block identical on replace", () => {
    const file = concat(bytes("top\n"), BLOCK, bytes("bottom\n"));
    const next = replaceInstructionBlock(file, OTHER_BLOCK);
    expect(next).toStrictEqual(concat(bytes("top\n"), OTHER_BLOCK, bytes("bottom\n")));
  });

  it("strips a mid-file block and keeps the rest byte-exactly", () => {
    expect(stripInstructionBlock(concat(bytes("top\r\n"), BLOCK, bytes("bottom")))).toStrictEqual(bytes("top\r\nbottom"));
  });

  it("returns plain Uint8Arrays for Buffer input", () => {
    const file = Buffer.from(concat(bytes("top\n"), BLOCK));
    const extraction = extractInstructionBlock(file);
    expect(extraction.kind === "present" ? extraction.block : null).toStrictEqual(BLOCK);
    expect(stripInstructionBlock(file)).toStrictEqual(bytes("top\n"));
  });

  it("refuses replace and strip without a well-formed block", () => {
    expect(() => replaceInstructionBlock(bytes("user\n"), BLOCK)).toThrow();
    expect(() => stripInstructionBlock(concat(BLOCK, BLOCK))).toThrow();
  });
});

describe("extractInstructionBlock", () => {
  it("reports absent when neither marker occurs", () => {
    expect(extractInstructionBlock(bytes("user\n"))).toStrictEqual({ kind: "absent" });
    expect(extractInstructionBlock(new Uint8Array(0))).toStrictEqual({ kind: "absent" });
  });

  it("locates a present block from the begin line through the end line's LF", () => {
    const file = concat(bytes("top\n"), BLOCK, bytes("bottom\n"));
    expect(extractInstructionBlock(file)).toStrictEqual({ kind: "present", start: 4, end: 4 + BLOCK.byteLength, block: BLOCK });
  });

  const begin = `${INSTRUCTION_BLOCK_BEGIN}\n`;
  const end = `${INSTRUCTION_BLOCK_END}\n`;
  it.each([
    ["no begin marker", `x\n${end}`],
    ["two begin markers", `${begin}${begin}${end}`],
    ["two end markers", `${begin}${end}${end}`],
    ["two whole blocks", `${begin}${end}${begin}${end}`],
    ["end before begin", `${end}${begin}`],
    ["a begin marker not on its own line", `x ${begin}${end}`],
    ["an end marker with trailing text", `${begin}${INSTRUCTION_BLOCK_END} x\n`],
    ["an end marker line without LF", `${begin}${INSTRUCTION_BLOCK_END}`],
    ["a begin marker line without LF", `${end}${INSTRUCTION_BLOCK_BEGIN}`],
    ["a CRLF-terminated marker line", `${INSTRUCTION_BLOCK_BEGIN}\r\n${end}`],
  ])("reports malformed for %s", (_label, text) => {
    expect(extractInstructionBlock(bytes(text))).toStrictEqual({ kind: "malformed" });
  });
});

describe("decideInstructionBlockMerge", () => {
  const present = (block: Uint8Array) => extractInstructionBlock(block);

  it("writes proposed when current equals base", () => {
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: present(BLOCK), proposed: OTHER_BLOCK })).toStrictEqual({ action: "write", reported: "updated" });
  });

  it("does not write when current equals base and proposed equals base", () => {
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: present(BLOCK), proposed: BLOCK })).toStrictEqual({ action: "none" });
  });

  it("does not write when current already equals proposed", () => {
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: present(OTHER_BLOCK), proposed: OTHER_BLOCK })).toStrictEqual({ action: "none" });
    expect(decideInstructionBlockMerge({ baseHash: null, current: present(OTHER_BLOCK), proposed: OTHER_BLOCK })).toStrictEqual({ action: "none" });
  });

  it("re-inserts an absent block as restored", () => {
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: { kind: "absent" }, proposed: BLOCK })).toStrictEqual({ action: "write", reported: "restored" });
  });

  it("reports a first insertion (no row yet) as updated, not restored", () => {
    expect(decideInstructionBlockMerge({ baseHash: null, current: { kind: "absent" }, proposed: BLOCK })).toStrictEqual({ action: "write", reported: "updated" });
  });

  it("refuses malformed markers", () => {
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: { kind: "malformed" }, proposed: BLOCK })).toStrictEqual({ action: "refuse", reason: "instruction_block_malformed" });
  });

  it("refuses any other current block as a conflict", () => {
    const edited = renderInstructionBlock({ productHome: "/Users/me/.developer-os", vendor: "claude", body: "edited\n" });
    expect(decideInstructionBlockMerge({ baseHash: hash(BLOCK), current: present(edited), proposed: OTHER_BLOCK })).toStrictEqual({ action: "refuse", reason: "instruction_block_conflict" });
    expect(decideInstructionBlockMerge({ baseHash: null, current: present(edited), proposed: OTHER_BLOCK })).toStrictEqual({ action: "refuse", reason: "instruction_block_conflict" });
  });
});
