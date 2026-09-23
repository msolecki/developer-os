import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";

import { gitCommitObject, gitObject, parseLowerHexSha1, type GitObjectV1, type LowerHexSha1 } from "@developer-os/core";

const encoder = new TextEncoder();
const TYPE_CODES = { commit: 1, tree: 2, blob: 3 } as const;

export type PackFixtureEntryV1 =
  | { readonly kind: "object"; readonly object: GitObjectV1 }
  | { readonly kind: "tag"; readonly content: Uint8Array }
  | { readonly kind: "ofs_delta"; readonly base: number; readonly delta: Uint8Array; readonly result: GitObjectV1 }
  | { readonly kind: "ref_delta"; readonly baseOid: LowerHexSha1; readonly delta: Uint8Array; readonly result: GitObjectV1 };

export interface PackFixtureV1 {
  readonly pack: Uint8Array;
  readonly index: Uint8Array;
  readonly checksum: string;
}

export type DeltaOpV1 = { readonly copy: readonly [offset: number, size: number] } | { readonly insert: Uint8Array };

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

export function contentOf(object: GitObjectV1): Uint8Array {
  return object.raw.subarray(object.raw.indexOf(0) + 1);
}

export function blob(text: string): GitObjectV1 {
  return gitObject("blob", encoder.encode(text));
}

export function tree(entries: readonly (readonly [mode: string, name: string, oid: LowerHexSha1])[]): GitObjectV1 {
  return gitObject(
    "tree",
    concat(entries.map(([mode, name, oid]) => concat([encoder.encode(`${mode} ${name}\0`), Buffer.from(oid, "hex")]))),
  );
}

export function commit(treeOid: LowerHexSha1, parent: LowerHexSha1 | null): GitObjectV1 {
  return gitCommitObject(treeOid, parent, { name: "Synthetic", email: "synthetic@example.invalid", unixSeconds: 1767225600, utcOffset: "+0000" });
}

export function oidOfTag(content: Uint8Array): LowerHexSha1 {
  return parseLowerHexSha1(
    createHash("sha1").update(concat([encoder.encode(`tag ${content.byteLength.toString(10)}\0`), content])).digest("hex"),
  );
}

function deltaVarint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest > 0);
  return bytes;
}

/** Git's delta encoding over `base`; returns the instruction stream and the resulting object bytes. */
export function delta(base: Uint8Array, ops: readonly DeltaOpV1[]): { readonly delta: Uint8Array; readonly result: Uint8Array } {
  const result: Uint8Array[] = [];
  const stream: number[] = [];
  for (const op of ops) {
    if ("insert" in op) {
      stream.push(op.insert.byteLength, ...op.insert);
      result.push(op.insert);
      continue;
    }
    const [offset, size] = op.copy;
    let opcode = 0x80;
    const operands: number[] = [];
    for (let bit = 0; bit < 4; bit += 1) {
      const byte = Math.floor(offset / 2 ** (8 * bit)) & 0xff;
      if (byte !== 0) {
        opcode |= 1 << bit;
        operands.push(byte);
      }
    }
    for (let bit = 0; bit < 3; bit += 1) {
      const byte = Math.floor(size / 2 ** (8 * bit)) & 0xff;
      if (byte !== 0) {
        opcode |= 0x10 << bit;
        operands.push(byte);
      }
    }
    stream.push(opcode, ...operands);
    result.push(base.subarray(offset, offset + size));
  }
  const bytes = concat(result);
  return { delta: Uint8Array.from([...deltaVarint(base.byteLength), ...deltaVarint(bytes.byteLength), ...stream]), result: bytes };
}

function objectHeader(code: number, size: number): number[] {
  const bytes: number[] = [];
  let byte = (code << 4) | (size & 0x0f);
  let rest = Math.floor(size / 16);
  while (rest > 0) {
    bytes.push(byte | 0x80);
    byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
  }
  bytes.push(byte);
  return bytes;
}

function ofsDistance(distance: number): number[] {
  const bytes = [distance & 0x7f];
  let rest = Math.floor(distance / 128);
  while (rest > 0) {
    rest -= 1;
    bytes.unshift(0x80 | (rest & 0x7f));
    rest = Math.floor(rest / 128);
  }
  return bytes;
}

function buildIndex(rows: readonly { readonly oid: string; readonly crc: number; readonly offset: number }[], checksum: Uint8Array): Uint8Array {
  const sorted = [...rows].sort((left, right) => (left.oid < right.oid ? -1 : left.oid > right.oid ? 1 : 0));
  const fanout: Uint8Array[] = [];
  for (let bucket = 0; bucket < 256; bucket += 1) {
    fanout.push(uint32(sorted.filter((row) => parseInt(row.oid.slice(0, 2), 16) <= bucket).length));
  }
  const body = concat([
    uint32(0xff744f63),
    uint32(2),
    ...fanout,
    ...sorted.map((row) => Uint8Array.from(Buffer.from(row.oid, "hex"))),
    ...sorted.map((row) => uint32(row.crc >>> 0)),
    ...sorted.map((row) => uint32(row.offset)),
    checksum,
  ]);
  return concat([body, Uint8Array.from(createHash("sha1").update(body).digest())]);
}

/** A version-2 pack and its version-2 index; `headerCount` may lie about the entry count. */
export function buildPack(entries: readonly PackFixtureEntryV1[], options: { readonly headerCount?: number } = {}): PackFixtureV1 {
  const parts: Uint8Array[] = [encoder.encode("PACK"), uint32(2), uint32(options.headerCount ?? entries.length)];
  const rows: { oid: string; crc: number; offset: number }[] = [];
  let offset = 12;
  for (const entry of entries) {
    let head: number[];
    let data: Uint8Array;
    let oid: string;
    if (entry.kind === "object") {
      data = contentOf(entry.object);
      head = objectHeader(TYPE_CODES[entry.object.type], data.byteLength);
      oid = entry.object.oid;
    } else if (entry.kind === "tag") {
      data = entry.content;
      head = objectHeader(4, data.byteLength);
      oid = oidOfTag(data);
    } else if (entry.kind === "ofs_delta") {
      data = entry.delta;
      head = [...objectHeader(6, data.byteLength), ...ofsDistance(offset - (rows[entry.base] as { offset: number }).offset)];
      oid = entry.result.oid;
    } else {
      data = entry.delta;
      head = [...objectHeader(7, data.byteLength), ...Buffer.from(entry.baseOid, "hex")];
      oid = entry.result.oid;
    }
    const raw = concat([Uint8Array.from(head), Uint8Array.from(deflateSync(data))]);
    rows.push({ oid, crc: crc32(raw), offset });
    parts.push(raw);
    offset += raw.byteLength;
  }
  const body = concat(parts);
  const checksum = Uint8Array.from(createHash("sha1").update(body).digest());
  return { pack: concat([body, checksum]), index: buildIndex(rows, checksum), checksum: Buffer.from(checksum).toString("hex") };
}

export async function writeOwnerOnly(path: string, bytes: Uint8Array): Promise<void> {
  await nodeFs.writeFile(path, bytes, { mode: 0o600, flag: "wx" });
}

/** The smallest valid closure: one commit, its tree and two blobs. */
export function smallClosure(): {
  readonly alpha: GitObjectV1;
  readonly beta: GitObjectV1;
  readonly root: GitObjectV1;
  readonly head: GitObjectV1;
  readonly entries: readonly PackFixtureEntryV1[];
} {
  const alpha = blob("alpha\n");
  const beta = blob("beta\n");
  const root = tree([
    ["100644", "a.md", alpha.oid],
    ["100644", "b.md", beta.oid],
  ]);
  const head = commit(root.oid, null);
  return {
    alpha,
    beta,
    root,
    head,
    entries: [
      { kind: "object", object: head },
      { kind: "object", object: root },
      { kind: "object", object: alpha },
      { kind: "object", object: beta },
    ],
  };
}
