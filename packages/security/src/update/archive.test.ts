import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { constants as zlibConstants, zstdCompressSync } from "node:zlib";

import { validateBundleManifest } from "@developer-os/core";
import type { LowerHexSha256, ReleaseBundleEntryV1, ReleaseBundleManifestV1, ReleaseBundleReferenceV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import { expectedUstarBytes, ZstdUstarAdmission, type ArchiveEntrySinkV1 } from "./archive.js";

const encoder = new TextEncoder();
const BLOCK = 512;

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

interface FixtureFileV1 {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly mode: 384 | 448;
  readonly content: Uint8Array;
}

const FILES: readonly FixtureFileV1[] = [
  { path: "bin", kind: "directory", mode: 448, content: new Uint8Array(0) },
  { path: "bin/developer-os", kind: "file", mode: 448, content: encoder.encode("#!/bin/sh\necho synthetic\n") },
  { path: "bin/planner", kind: "file", mode: 448, content: encoder.encode("synthetic planner\n") },
  { path: "bin/runtime", kind: "file", mode: 448, content: new Uint8Array(1_300).fill(0x61) },
  { path: "bin/verifier", kind: "file", mode: 448, content: new Uint8Array(0) },
  { path: "share", kind: "directory", mode: 448, content: new Uint8Array(0) },
  { path: "share/notice.txt", kind: "file", mode: 384, content: encoder.encode("synthetic notice\n") },
];

function manifestFor(files: readonly FixtureFileV1[]): ReleaseBundleManifestV1 {
  return validateBundleManifest({
    schemaVersion: 1,
    version: "1.2.3",
    releaseSequence: "7",
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
    entrypoint: "bin/developer-os",
    runtimeEntrypoint: "bin/runtime",
    plannerEntrypoint: "bin/planner",
    verifierEntrypoint: "bin/verifier",
    entries: files.map((file): unknown =>
      file.kind === "directory"
        ? { path: file.path, kind: "directory", mode: 448 }
        : { path: file.path, kind: "file", mode: file.mode, bytes: String(file.content.byteLength), sha256: sha256(file.content) },
    ),
  });
}

interface HeaderOverridesV1 {
  readonly name?: string;
  readonly prefix?: string;
  readonly mode?: string;
  readonly uid?: string;
  readonly gid?: string;
  readonly size?: string;
  readonly mtime?: string;
  readonly type?: string;
  readonly magic?: string;
  readonly version?: string;
  readonly uname?: string;
  readonly linkname?: string;
  readonly checksum?: "valid" | "wrong";
  readonly baseTwoFiftySixSize?: boolean;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function ustarHeader(file: FixtureFileV1, overrides: HeaderOverridesV1 = {}): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const put = (offset: number, text: string): void => {
    header.set(encoder.encode(text), offset);
  };
  const boundary = file.path.lastIndexOf("/");
  put(0, overrides.name ?? (boundary < 0 ? file.path : file.path.slice(boundary + 1)));
  put(100, overrides.mode ?? octal(file.kind === "directory" ? 0o700 : file.mode, 8));
  put(108, overrides.uid ?? octal(0, 8));
  put(116, overrides.gid ?? octal(0, 8));
  put(124, overrides.size ?? octal(file.content.byteLength, 12));
  if (overrides.baseTwoFiftySixSize === true) {
    header.fill(0, 124, 136);
    header[124] = 0x80;
    header[135] = file.content.byteLength & 0xff;
    header[134] = file.content.byteLength >> 8;
  }
  put(136, overrides.mtime ?? octal(0o14_000_000_000, 12));
  put(156, overrides.type ?? (file.kind === "directory" ? "5" : "0"));
  if (overrides.linkname !== undefined) put(157, overrides.linkname);
  put(257, overrides.magic ?? "ustar\0");
  put(263, overrides.version ?? "00");
  if (overrides.uname !== undefined) put(265, overrides.uname);
  put(345, overrides.prefix ?? (boundary < 0 ? "" : file.path.slice(0, boundary)));
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
  if (overrides.checksum === "wrong") sum += 1;
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

interface TarOptionsV1 {
  readonly headers?: ReadonlyMap<number, HeaderOverridesV1>;
  readonly padding?: number;
  readonly endBlocks?: number;
  readonly trailing?: Uint8Array;
  readonly order?: readonly number[];
  readonly extra?: Uint8Array;
}

function ustar(files: readonly FixtureFileV1[], options: TarOptionsV1 = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const index of options.order ?? files.map((_, position) => position)) {
    const file = files[index] as FixtureFileV1;
    parts.push(ustarHeader(file, options.headers?.get(index)), file.content);
    const padding = (BLOCK - (file.content.byteLength % BLOCK)) % BLOCK;
    const pad = new Uint8Array(padding);
    if (padding > 0 && options.padding === index) pad[0] = 1;
    parts.push(pad);
  }
  if (options.extra !== undefined) parts.push(options.extra);
  parts.push(new Uint8Array(BLOCK * (options.endBlocks ?? 2)));
  if (options.trailing !== undefined) parts.push(options.trailing);
  return Buffer.concat(parts);
}

function zstd(tar: Uint8Array, options: { readonly checksum?: 0 | 1; readonly contentSize?: 0 | 1 } = {}): Uint8Array {
  return zstdCompressSync(tar, {
    params: {
      [zlibConstants.ZSTD_c_checksumFlag]: options.checksum ?? 1,
      [zlibConstants.ZSTD_c_contentSizeFlag]: options.contentSize ?? 1,
    },
  });
}

function bundleFor(archive: Uint8Array, overrides: Partial<ReleaseBundleReferenceV1> = {}): ReleaseBundleReferenceV1 {
  return {
    platform: "darwin",
    architecture: "arm64",
    archiveFormat: "zstd-ustar-v1",
    archivePath: "v1.2.3/developer-os-darwin-arm64.tar.zst",
    archiveBytes: String(archive.byteLength),
    archiveSha256: sha256(archive),
    manifestPath: "v1.2.3/developer-os-darwin-arm64.manifest.json",
    manifestBytes: "1",
    manifestSha256: "0".repeat(64),
    ...overrides,
  } as ReleaseBundleReferenceV1;
}

function chunked(bytes: Uint8Array, size = 97): AsyncIterable<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) parts.push(bytes.subarray(offset, offset + size));
  return Readable.from(parts) as AsyncIterable<Uint8Array>;
}

class RecordingSink implements ArchiveEntrySinkV1 {
  readonly begun: number[] = [];
  readonly ended: number[] = [];
  readonly contents = new Map<number, Uint8Array[]>();
  #current = -1;

  begin(ordinal: number): Promise<void> {
    this.begun.push(ordinal);
    this.#current = ordinal;
    this.contents.set(ordinal, []);
    return Promise.resolve();
  }

  write(chunk: Uint8Array): Promise<void> {
    this.contents.get(this.#current)?.push(Uint8Array.from(chunk));
    return Promise.resolve();
  }

  end(ordinal: number): Promise<void> {
    this.ended.push(ordinal);
    return Promise.resolve();
  }
}

interface ArchiveFixtureV1 {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly manifest: ReleaseBundleManifestV1;
  readonly bundle?: ReleaseBundleReferenceV1;
  readonly productWrites: string[];
}

const MANIFEST = manifestFor(FILES);

async function admitArchive(bytes: Uint8Array, manifest: ReleaseBundleManifestV1, bundle = bundleFor(bytes)): Promise<RecordingSink> {
  const sink = new RecordingSink();
  await new ZstdUstarAdmission().extract({ bundle, manifest, source: chunked(bytes), sink });
  return sink;
}

function fixture(name: string, bytes: Uint8Array, extra: Partial<ArchiveFixtureV1> = {}): ArchiveFixtureV1 {
  return { name, bytes, manifest: MANIFEST, productWrites: [], ...extra };
}

function withHeader(ordinal: number, overrides: HeaderOverridesV1): Uint8Array {
  return zstd(ustar(FILES, { headers: new Map([[ordinal, overrides]]) }));
}

function frameHeader(descriptor: number, rest: readonly number[]): Uint8Array {
  return Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, descriptor, ...rest, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
}

const VALID_TAR = ustar(FILES);
const VALID = zstd(VALID_TAR);
const skippable = Uint8Array.from([0x50, 0x2a, 0x4d, 0x18, 4, 0, 0, 0, 1, 2, 3, 4]);
const flipped = (bytes: Uint8Array, index: number, mask: number): Uint8Array => {
  const copy = Uint8Array.from(bytes);
  copy[index] = (copy[index] as number) ^ mask;
  return copy;
};
const tarSize = Number(expectedUstarBytes(MANIFEST));

const rejectedArchiveCorpus: readonly ArchiveFixtureV1[] = [
  // Zstandard frame
  fixture("a skippable frame before the standard frame", Buffer.concat([skippable, VALID])),
  fixture("a skippable frame after the standard frame", Buffer.concat([VALID, skippable])),
  fixture("two concatenated frames", Buffer.concat([VALID, VALID])),
  fixture("one trailing byte", Buffer.concat([VALID, Uint8Array.of(0)])),
  fixture("a frame without a content checksum", zstd(VALID_TAR, { checksum: 0 })),
  fixture("a frame without a content size", zstd(VALID_TAR, { contentSize: 0 })),
  fixture("a frame naming a dictionary", flipped(VALID, 4, 0x01)),
  fixture("a frame setting the reserved bit", flipped(VALID, 4, 0x08)),
  fixture("a corrupted content checksum", flipped(VALID, VALID.byteLength - 1, 0x01)),
  fixture("a truncated frame", VALID.subarray(0, VALID.byteLength - 3)),
  fixture("a non-Zstandard magic", flipped(VALID, 0, 0xff)),
  fixture("a window over 128 MiB", frameHeader(0x84, [(18 << 3) | 0, ...[tarSize & 0xff, (tarSize >> 8) & 0xff, 0, 0]])),
  fixture("a content size differing from the manifest", frameHeader(0xa4, [0, 0, 0, 0x10])),
  fixture("a reserved block type", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x64, (tarSize - 256) & 0xff, (tarSize - 256) >> 8, 0x07, 0x00, 0x00])),
  fixture("an oversized raw block", Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0x84, 17 << 3, tarSize & 0xff, tarSize >> 8, 0, 0, 0x09, 0x00, 0x20])),
  // ustar headers
  fixture("a wrong header checksum", withHeader(1, { checksum: "wrong" })),
  fixture("GNU magic", withHeader(1, { magic: "ustar ", version: " \0" })),
  fixture("a wrong ustar version", withHeader(1, { version: "01" })),
  fixture("a nonzero uid", withHeader(1, { uid: octal(501, 8) })),
  fixture("a nonzero gid", withHeader(1, { gid: octal(20, 8) })),
  fixture("an owner name", withHeader(1, { uname: "someone" })),
  fixture("a space-padded octal mode", withHeader(1, { mode: "   700 \0" })),
  fixture("a mode differing from the manifest", withHeader(6, { mode: octal(0o644, 8) })),
  fixture("a non-octal mtime", withHeader(1, { mtime: "9999999999 \0" })),
  fixture("a base-256 size", withHeader(1, { baseTwoFiftySixSize: true })),
  fixture("a PAX extended header", withHeader(1, { type: "x" })),
  fixture("a PAX global header", withHeader(1, { type: "g" })),
  fixture("a GNU long name", withHeader(1, { type: "L" })),
  fixture("a GNU long link", withHeader(1, { type: "K" })),
  fixture("a GNU sparse file", withHeader(1, { type: "S" })),
  fixture("a hard link", withHeader(1, { type: "1", linkname: "bin/planner" })),
  fixture("a symbolic link", withHeader(1, { type: "2", linkname: "/etc/passwd" })),
  fixture("a character device", withHeader(1, { type: "3" })),
  fixture("a block device", withHeader(1, { type: "4" })),
  fixture("a FIFO", withHeader(1, { type: "6" })),
  fixture("a directory typed as a file", withHeader(0, { type: "0" })),
  fixture("a link target on a regular file", withHeader(1, { linkname: "elsewhere" })),
  // names and inventory
  fixture("a traversing name", withHeader(1, { name: "../developer-os", prefix: "" })),
  fixture("an absolute prefix", withHeader(1, { prefix: "/bin" })),
  fixture("the whole path in the name field", withHeader(1, { name: "bin/developer-os", prefix: "" })),
  fixture("a case-folded alias name", withHeader(1, { name: "Developer-OS" })),
  fixture("a trailing-slash directory name", withHeader(0, { name: "bin/" })),
  fixture("entries out of manifest order", zstd(ustar(FILES, { order: [0, 2, 1, 3, 4, 5, 6] }))),
  fixture("a missing manifest entry", zstd(ustar(FILES.slice(0, 6))), { manifest: MANIFEST }),
  fixture("an entry outside the manifest", zstd(ustar(FILES, { extra: ustarHeader({ path: "extra", kind: "directory", mode: 448, content: new Uint8Array(0) }) }))),
  fixture("a file size differing from the manifest", withHeader(1, { size: octal((FILES[1]?.content.byteLength ?? 0) + 1, 12) })),
  fixture("file content differing from its manifest hash", zstd(ustar(FILES.map((file, index) => (index === 2 ? { ...file, content: encoder.encode("synthetic plannex\n") } : file))))),
  fixture("nonzero padding", zstd(ustar(FILES, { padding: 1 }))),
  fixture("one end-of-archive block", zstd(ustar(FILES, { endBlocks: 1 }))),
  fixture("three end-of-archive blocks", zstd(ustar(FILES, { endBlocks: 3 }))),
  fixture("decompressed bytes after the end-of-archive blocks", zstd(ustar(FILES, { trailing: Uint8Array.of(1) }))),
  // signed reference
  fixture("an archive differing from its signed hash", VALID, { bundle: bundleFor(VALID, { archiveSha256: "0".repeat(64) as LowerHexSha256 }) }),
  fixture("an archive longer than its signed size", VALID, { bundle: bundleFor(VALID, { archiveBytes: String(VALID.byteLength - 1) } as Partial<ReleaseBundleReferenceV1>) }),
  fixture("an archive shorter than its signed size", VALID, { bundle: bundleFor(VALID, { archiveBytes: String(VALID.byteLength + 1) } as Partial<ReleaseBundleReferenceV1>) }),
  fixture("an archive over 2 GiB", VALID, { bundle: bundleFor(VALID, { archiveBytes: "2147483649" } as Partial<ReleaseBundleReferenceV1>) }),
  fixture("a suffix other than .tar.zst", VALID, { bundle: bundleFor(VALID, { archivePath: "v1.2.3/developer-os-darwin-arm64.tar" } as Partial<ReleaseBundleReferenceV1>) }),
  fixture("another architecture", VALID, { bundle: bundleFor(VALID, { architecture: "x64" }) }),
];

describe("ZstdUstarAdmission", () => {
  it("admits exactly the manifest entries in order with their bytes", async () => {
    const sink = await admitArchive(VALID, MANIFEST);

    expect(sink.begun).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sink.ended).toEqual([0, 1, 2, 3, 4, 5, 6]);
    FILES.forEach((file, ordinal) => {
      expect(Buffer.concat(sink.contents.get(ordinal) ?? [])).toEqual(Buffer.from(file.content));
    });
  });

  it("returns the exact tar and expanded byte counts", async () => {
    const admitted = await new ZstdUstarAdmission().extract({ bundle: bundleFor(VALID), manifest: MANIFEST, source: chunked(VALID, 1), sink: new RecordingSink() });

    expect(admitted).toEqual({
      entries: FILES.length,
      tarBytes: String(VALID_TAR.byteLength),
      expandedBytes: String(FILES.reduce((total, file) => total + file.content.byteLength, 0)),
    });
  });

  it("derives the exact ustar length from the manifest", () => {
    expect(expectedUstarBytes(MANIFEST)).toBe(BigInt(VALID_TAR.byteLength));
  });

  it("admits a file whose content ends exactly on a block boundary", async () => {
    const files: readonly FixtureFileV1[] = FILES.map((file, index) => (index === 3 ? { ...file, content: new Uint8Array(1_024).fill(0x62) } : file));
    const archive = zstd(ustar(files));

    await expect(admitArchive(archive, manifestFor(files))).resolves.toBeInstanceOf(RecordingSink);
  });

  it.each(rejectedArchiveCorpus)("refuses $name without product mutation", async (fixture) => {
    const sink = new RecordingSink();
    const refusal = new ZstdUstarAdmission().extract({
      bundle: fixture.bundle ?? bundleFor(fixture.bytes),
      manifest: fixture.manifest,
      source: chunked(fixture.bytes),
      sink,
    });

    await expect(refusal).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(fixture.productWrites).toEqual([]);
  });

  it("refuses a malformed frame header before the first sink call", async () => {
    const sink = new RecordingSink();

    await expect(
      new ZstdUstarAdmission().extract({ bundle: bundleFor(flipped(VALID, 4, 0x01)), manifest: MANIFEST, source: chunked(flipped(VALID, 4, 0x01)), sink }),
    ).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(sink.begun).toEqual([]);
  });

  it("passes a sink failure through unchanged", async () => {
    const failure = new Error("synthetic sink failure");
    const sink: ArchiveEntrySinkV1 = {
      begin: () => Promise.reject(failure),
      write: () => Promise.resolve(),
      end: () => Promise.resolve(),
    };

    await expect(new ZstdUstarAdmission().extract({ bundle: bundleFor(VALID), manifest: MANIFEST, source: chunked(VALID), sink })).rejects.toBe(failure);
  });

  it("names no archive path or byte in a refusal", async () => {
    const error: unknown = await new ZstdUstarAdmission()
      .extract({ bundle: bundleFor(withHeader(1, { name: "../secret-name" })), manifest: MANIFEST, source: chunked(withHeader(1, { name: "../secret-name" })), sink: new RecordingSink() })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecurityRefusalError);
    expect((error as Error).message).not.toContain("secret-name");
    expect((error as Error).message).not.toContain("bin/");
  });

  it("keeps the manifest entry type exhaustive", () => {
    const kinds = new Set(MANIFEST.entries.map((entry: ReleaseBundleEntryV1) => entry.kind));
    expect([...kinds].sort()).toEqual(["directory", "file"]);
  });
});
