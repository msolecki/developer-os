/**
 * The zstd-ustar-v1 archive writer (Spec 2 §3): one ustar member per manifest entry in manifest
 * order, owner 0:0, a fixed mtime, padded content, two end blocks, and one zstd frame carrying a
 * checksum and its content size. Its only inputs are the entries and their bytes, so the same
 * bundle always archives to the same bytes. In-process, so no `tar` (and no `COPYFILE_DISABLE`).
 */
import { constants as zlibConstants, zstdCompressSync } from "node:zlib";

import type { ReleaseBundleEntryV1 } from "@developer-os/core";

const encoder = new TextEncoder();
const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function ustarHeader(entry: ReleaseBundleEntryV1, size: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const put = (offset: number, text: string): void => {
    header.set(encoder.encode(text), offset);
  };
  const boundary = entry.path.lastIndexOf("/");
  put(0, boundary < 0 ? entry.path : entry.path.slice(boundary + 1));
  put(100, octal(entry.mode, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(size, 12));
  put(136, octal(0o14_000_000_000, 12));
  put(156, entry.kind === "directory" ? "5" : "0");
  put(257, "ustar\0");
  put(263, "00");
  put(345, boundary < 0 ? "" : entry.path.slice(0, boundary));
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/** The bundle's exact zstd-ustar archive: manifest order, padded content, two end blocks, one checksummed frame. */
export function archiveOf(entries: readonly ReleaseBundleEntryV1[], files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const content = entry.kind === "file" ? (files.get(entry.path) ?? new Uint8Array()) : new Uint8Array();
    parts.push(ustarHeader(entry, content.byteLength), content, new Uint8Array((BLOCK - (content.byteLength % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  return zstdCompressSync(Buffer.concat(parts), { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1, [zlibConstants.ZSTD_c_contentSizeFlag]: 1 } });
}
