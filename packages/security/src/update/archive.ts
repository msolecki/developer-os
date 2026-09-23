import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as zlibConstants, createZstdDecompress } from "node:zlib";

import { parseLowerHexSha256, parseUInt64Decimal, validateBundleManifest } from "@developer-os/core";
import type {
  LowerHexSha256,
  ReleaseBundleEntryV1,
  ReleaseBundleManifestV1,
  ReleaseBundleReferenceV1,
  UInt64DecimalV1,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";

/** Spec 2 §4.4 primary bounds that the manifest validator does not already carry. */
const MAXIMUM_ARCHIVE_BYTES = 2_147_483_648n;
/**
 * The largest Zstandard window admitted: 128 MiB keeps the decoder inside the
 * 256 MiB attributable streaming budget. A single-segment frame's window is its
 * whole content size, so a large single-segment frame refuses here too.
 */
export const MAXIMUM_ZSTD_WINDOW_LOG = 27;
const MAXIMUM_ZSTD_WINDOW_BYTES = 2 ** MAXIMUM_ZSTD_WINDOW_LOG;
const MAXIMUM_ZSTD_BLOCK_BYTES = 131_072;
const ZSTD_MAGIC = 0xfd2fb528;
const BLOCK = 512;
const encoder = new TextEncoder();

/**
 * Where admitted entries go. The scratch store implements it with journaled
 * exclusive creates; `begin` precedes the first content byte, `end` follows
 * the last byte and the verified hash. Nothing else learns an archive name.
 */
export interface ArchiveEntrySinkV1 {
  begin(ordinal: number, entry: ReleaseBundleEntryV1): Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
  end(ordinal: number): Promise<void>;
}

export interface ArchiveAdmissionRequestV1 {
  readonly bundle: ReleaseBundleReferenceV1;
  readonly manifest: ReleaseBundleManifestV1;
  /** The exact downloaded archive bytes, already identity-bound by the caller. */
  readonly source: AsyncIterable<Uint8Array>;
  readonly sink: ArchiveEntrySinkV1;
}

export interface AdmittedArchiveV1 {
  readonly entries: number;
  readonly tarBytes: UInt64DecimalV1;
  readonly expandedBytes: UInt64DecimalV1;
}

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

/** The exact tar length the manifest implies: one header per entry, padded content, two zero blocks. */
export function expectedUstarBytes(manifest: ReleaseBundleManifestV1): bigint {
  let total = 2n * BigInt(BLOCK);
  for (const entry of manifest.entries) {
    total += BigInt(BLOCK);
    if (entry.kind === "file") total += ((BigInt(entry.bytes) + 511n) / 512n) * 512n;
  }
  return total;
}

type FrameState = "magic" | "descriptor" | "header" | "block_header" | "block_body" | "checksum" | "done";

/**
 * Walks the compressed side of exactly one Zstandard standard frame before any
 * byte reaches the decoder. libzstd streams straight across a concatenated or
 * skippable frame, so the frame end is found here from the block headers, and
 * any byte after the 4-byte checksum refuses.
 */
class ZstdFrameWalker {
  #state: FrameState = "magic";
  #need = 4;
  #field: number[] = [];
  #singleSegment = false;
  #contentSizeBytes = 0;
  #windowBytes = 0;
  #remaining = 0;
  #last = false;

  constructor(readonly expectedContentSize: bigint) {}

  push(chunk: Uint8Array): void {
    let index = 0;
    while (index < chunk.byteLength) {
      if (this.#state === "done") refuse("Release archive has bytes after its Zstandard frame");
      if (this.#state === "block_body") {
        const take = Math.min(this.#remaining, chunk.byteLength - index);
        index += take;
        this.#remaining -= take;
        if (this.#remaining === 0) this.#endBlock();
        continue;
      }
      this.#field.push(chunk[index] as number);
      index += 1;
      if (this.#field.length === this.#need) {
        const field = this.#field;
        this.#field = [];
        this.#accept(field);
      }
    }
  }

  finish(): void {
    if (this.#state !== "done") refuse("Release archive Zstandard frame is truncated");
  }

  #expect(state: FrameState, need: number): void {
    this.#state = state;
    this.#need = need;
  }

  #accept(field: readonly number[]): void {
    const littleEndian = (bytes: readonly number[]): bigint =>
      bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);
    switch (this.#state) {
      case "magic": {
        const magic = Number(littleEndian(field));
        if ((magic & 0xfffffff0) === 0x184d2a50) refuse("Release archive begins with a skippable Zstandard frame");
        if (magic !== ZSTD_MAGIC) refuse("Release archive is not a Zstandard frame");
        this.#expect("descriptor", 1);
        return;
      }
      case "descriptor": {
        const descriptor = field[0] as number;
        const contentSizeFlag = descriptor >> 6;
        this.#singleSegment = ((descriptor >> 5) & 1) === 1;
        if (((descriptor >> 3) & 1) !== 0) refuse("Release archive Zstandard frame sets a reserved bit");
        if (((descriptor >> 2) & 1) !== 1) refuse("Release archive Zstandard frame has no content checksum");
        if ((descriptor & 3) !== 0) refuse("Release archive Zstandard frame names a dictionary");
        this.#contentSizeBytes = [this.#singleSegment ? 1 : 0, 2, 4, 8][contentSizeFlag] as number;
        if (this.#contentSizeBytes === 0) refuse("Release archive Zstandard frame has no content size");
        this.#expect("header", (this.#singleSegment ? 0 : 1) + this.#contentSizeBytes);
        return;
      }
      case "header": {
        const sizeField = field.slice(this.#singleSegment ? 0 : 1);
        const contentSize = littleEndian(sizeField) + (this.#contentSizeBytes === 2 ? 256n : 0n);
        if (contentSize !== this.expectedContentSize) refuse("Release archive content size differs from its manifest");
        let window: bigint;
        if (this.#singleSegment) {
          window = contentSize;
        } else {
          const descriptor = field[0] as number;
          const base = 1n << BigInt(10 + (descriptor >> 3));
          window = base + (base / 8n) * BigInt(descriptor & 7);
        }
        if (window > BigInt(MAXIMUM_ZSTD_WINDOW_BYTES)) refuse("Release archive Zstandard window exceeds its bound");
        this.#windowBytes = Number(window);
        this.#expect("block_header", 3);
        return;
      }
      case "block_header": {
        const header = Number(littleEndian(field));
        this.#last = (header & 1) === 1;
        const type = (header >> 1) & 3;
        const size = header >>> 3;
        if (type === 3) refuse("Release archive Zstandard block type is reserved");
        if (size > Math.min(this.#windowBytes, MAXIMUM_ZSTD_BLOCK_BYTES)) refuse("Release archive Zstandard block exceeds its bound");
        this.#remaining = type === 1 ? 1 : size;
        this.#state = "block_body";
        if (this.#remaining === 0) this.#endBlock();
        return;
      }
      case "checksum":
        this.#expect("done", 0);
        return;
      default:
        refuse("Release archive Zstandard frame is malformed");
    }
  }

  #endBlock(): void {
    if (this.#last) this.#expect("checksum", 4);
    else this.#expect("block_header", 3);
  }
}

function octalField(value: number, width: number): Uint8Array {
  return encoder.encode(`${value.toString(8).padStart(width - 1, "0")}\0`);
}

function equalBytes(header: Uint8Array, offset: number, expected: Uint8Array, width: number): boolean {
  for (let index = 0; index < width; index += 1) {
    if (header[offset + index] !== (index < expected.byteLength ? expected[index] : 0)) return false;
  }
  return true;
}

/**
 * One POSIX.1-1988 ustar header, checked against the manifest row it must be.
 * Every field has exactly one admitted spelling: the name is the final
 * component and the prefix its whole parent (the split `BundleRelativePathV1`
 * guarantees fits), numbers are zero-padded octal with one NUL, owner fields
 * are zero and empty, and every unused byte is zero.
 */
function checkUstarHeader(header: Uint8Array, entry: ReleaseBundleEntryV1): number {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
  if (!equalBytes(header, 148, encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 8)) refuse("Release archive header checksum is invalid");

  if (!equalBytes(header, 257, encoder.encode("ustar\0"), 6) || !equalBytes(header, 263, encoder.encode("00"), 2)) {
    refuse("Release archive entry is not POSIX ustar");
  }
  const type = header[156] as number;
  if ([100, 108, 116, 124, 136].some((offset) => ((header[offset] as number) & 0x80) !== 0)) refuse("Release archive uses a base-256 number");
  const expectedType = entry.kind === "directory" ? [0x35] : [0x30, 0];
  if (!expectedType.includes(type)) refuse("Release archive entry type is not admitted");

  const boundary = entry.path.lastIndexOf("/");
  const name = encoder.encode(boundary < 0 ? entry.path : entry.path.slice(boundary + 1));
  const prefix = encoder.encode(boundary < 0 ? "" : entry.path.slice(0, boundary));
  if (!equalBytes(header, 0, name, 100) || !equalBytes(header, 345, prefix, 155)) refuse("Release archive entry name differs from its manifest row");

  const size = entry.kind === "file" ? Number(entry.bytes) : 0;
  const mode = entry.kind === "file" ? entry.mode : 448;
  const zero = new Uint8Array(0);
  const fields: readonly [number, Uint8Array, number][] = [
    [100, octalField(mode, 8), 8],
    [108, octalField(0, 8), 8],
    [116, octalField(0, 8), 8],
    [124, octalField(size, 12), 12],
    [157, zero, 100],
    [265, zero, 32],
    [297, zero, 32],
    [329, zero, 8],
    [337, zero, 8],
    [500, zero, 12],
  ];
  for (const [offset, expected, width] of fields) {
    if (!equalBytes(header, offset, expected, width)) refuse("Release archive header field is not canonical");
  }
  const mtime = header.subarray(136, 148);
  if (!/^[0-7]{11}\0$/.test(Buffer.from(mtime).toString("latin1"))) refuse("Release archive header field is not canonical");
  return size;
}

type UstarState = "header" | "body" | "padding" | "end";

/** Streams the decompressed tar against the manifest, one row per entry in order, then exactly two zero blocks. */
class UstarReader {
  #state: UstarState = "header";
  readonly #header = new Uint8Array(BLOCK);
  #filled = 0;
  #ordinal = 0;
  #remaining = 0;
  #padding = 0;
  #zeroBlocks = 0;
  #hash = createHash("sha256");
  #observed = 0n;

  constructor(
    readonly manifest: ReleaseBundleManifestV1,
    readonly sink: ArchiveEntrySinkV1,
    readonly tarBytes: bigint,
  ) {}

  async push(chunk: Uint8Array): Promise<void> {
    this.#observed += BigInt(chunk.byteLength);
    if (this.#observed > this.tarBytes) refuse("Release archive expands beyond its declared content size");
    let index = 0;
    while (index < chunk.byteLength) {
      switch (this.#state) {
        case "end":
          refuse("Release archive has bytes after its end-of-archive blocks");
          break;
        case "header": {
          const take = Math.min(BLOCK - this.#filled, chunk.byteLength - index);
          this.#header.set(chunk.subarray(index, index + take), this.#filled);
          this.#filled += take;
          index += take;
          if (this.#filled === BLOCK) {
            this.#filled = 0;
            await this.#acceptHeader();
          }
          break;
        }
        case "body": {
          const take = Math.min(this.#remaining, chunk.byteLength - index);
          const part = chunk.subarray(index, index + take);
          this.#hash.update(part);
          await this.sink.write(part);
          index += take;
          this.#remaining -= take;
          if (this.#remaining === 0) {
            if (this.#padding > 0) this.#state = "padding";
            else await this.#endEntry();
          }
          break;
        }
        case "padding": {
          if (chunk[index] !== 0) refuse("Release archive entry padding is not zero");
          index += 1;
          this.#padding -= 1;
          if (this.#padding === 0) await this.#endEntry();
          break;
        }
      }
    }
  }

  finish(): number {
    if (this.#state !== "end" || this.#observed !== this.tarBytes) refuse("Release archive is truncated");
    return this.#ordinal;
  }

  async #acceptHeader(): Promise<void> {
    const entry = this.manifest.entries[this.#ordinal];
    if (entry === undefined) {
      if (this.#header.some((byte) => byte !== 0)) refuse("Release archive has an entry outside its manifest");
      this.#zeroBlocks += 1;
      if (this.#zeroBlocks === 2) this.#state = "end";
      return;
    }
    if (this.#header.every((byte) => byte === 0)) refuse("Release archive ends before its manifest");
    const size = checkUstarHeader(this.#header, entry);
    await this.sink.begin(this.#ordinal, entry);
    this.#hash = createHash("sha256");
    this.#remaining = size;
    this.#padding = (BLOCK - (size % BLOCK)) % BLOCK;
    if (size === 0) await this.#endEntry();
    else this.#state = "body";
  }

  async #endEntry(): Promise<void> {
    const entry = this.manifest.entries[this.#ordinal] as ReleaseBundleEntryV1;
    if (entry.kind === "file" && this.#hash.digest("hex") !== entry.sha256) refuse("Release archive entry hash differs from its manifest row");
    await this.sink.end(this.#ordinal);
    this.#ordinal += 1;
    this.#state = "header";
  }
}

/**
 * Spec 2 §4.4's only archive parser: exactly one checksummed, sized,
 * dictionary-free Zstandard frame containing exactly one ustar stream whose
 * entries equal the signed manifest rows in order. Any other shape refuses
 * with a content-free `SecurityRefusalError` before its first sink call where
 * the shape is visible that early; a failure raised by the sink itself passes
 * through unchanged.
 */
export class ZstdUstarAdmission {
  async extract(request: ArchiveAdmissionRequestV1): Promise<AdmittedArchiveV1> {
    const manifest = validateBundleManifest(request.manifest);
    const { bundle } = request;
    const format: string = bundle.archiveFormat;
    if (format !== "zstd-ustar-v1" || !bundle.archivePath.endsWith(".tar.zst")) refuse("Release archive format is not zstd-ustar-v1");
    if (bundle.architecture !== manifest.architecture) refuse("Release archive architecture differs from its manifest");
    const archiveBytes = BigInt(parseUInt64Decimal(bundle.archiveBytes));
    const archiveSha256 = parseLowerHexSha256(bundle.archiveSha256);
    if (archiveBytes < 1n || archiveBytes > MAXIMUM_ARCHIVE_BYTES) refuse("Release archive size is outside its bound");

    const tarBytes = expectedUstarBytes(manifest);
    const walker = new ZstdFrameWalker(tarBytes);
    const reader = new UstarReader(manifest, request.sink, tarBytes);
    const hash = createHash("sha256");
    let observed = 0n;
    let passthrough: unknown = null;

    async function* compressed(): AsyncGenerator<Uint8Array> {
      try {
        for await (const chunk of request.source) {
          observed += BigInt(chunk.byteLength);
          if (observed > archiveBytes) refuse("Release archive exceeds its signed size");
          hash.update(chunk);
          walker.push(chunk);
          yield chunk;
        }
      } catch (error) {
        if (!(error instanceof SecurityRefusalError)) passthrough ??= error;
        throw error;
      }
      walker.finish();
      if (observed !== archiveBytes || (hash.digest("hex") as LowerHexSha256) !== archiveSha256) refuse("Release archive differs from its signed reference");
    }

    const decoder = createZstdDecompress({ params: { [zlibConstants.ZSTD_d_windowLogMax]: MAXIMUM_ZSTD_WINDOW_LOG } });
    try {
      await pipeline(Readable.from(compressed()), decoder, async (output: AsyncIterable<Uint8Array>) => {
        for await (const chunk of output) {
          try {
            await reader.push(chunk);
          } catch (error) {
            if (!(error instanceof SecurityRefusalError)) passthrough ??= error;
            throw error;
          }
        }
      });
    } catch (error) {
      if (passthrough !== null) throw passthrough as Error;
      if (error instanceof SecurityRefusalError) throw error;
      refuse("Release archive is not a valid Zstandard frame");
    }
    const entries = reader.finish();
    let expanded = 0n;
    for (const entry of manifest.entries) if (entry.kind === "file") expanded += BigInt(entry.bytes);
    return {
      entries,
      tarBytes: parseUInt64Decimal(tarBytes.toString(10)),
      expandedBytes: parseUInt64Decimal(expanded.toString(10)),
    };
  }
}
