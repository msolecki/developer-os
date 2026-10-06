/**
 * Spec 1 §4.2's guarded in-process SHA-1 pack reader. It admits one private
 * pack/index pair from the receive quarantine under the exact destination
 * `GitPackReaderBudgetV1`, resolves every entry (delta chains included) to
 * its OID, and proves the pack is exactly the transitive object closure of
 * the target commit. It executes no Git process and publishes no object
 * content. Any refusal closes descriptors and destroys the still-private
 * quarantine before a coordinator or effect journal exists.
 */
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { crc32, createInflate } from "node:zlib";

import {
  parseLowerHexSha1,
  parseLowerHexSha256,
  validateGitPackReaderBudget,
  type CanonicalAbsolutePathV1,
  type GitPackReaderBudgetV1,
  type LowerHexSha1,
  type LowerHexSha256,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import { GIT_PACK_OBJECT_COUNT_MAX } from "./process-table.js";
import type { GitProcessPhaseV1 } from "./supervisor.js";

type GitPackBudgetFixedKeyV1 = Exclude<
  keyof GitPackReaderBudgetV1,
  "packHeaderObjectCount" | "closedEffectObjectCount" | "admittedObjectCount"
>;

/** Typed against `GitPackReaderBudgetV1`'s literal fields, so a drift from Core fails `tsc`. */
const BUDGET_FIXED: Pick<GitPackReaderBudgetV1, GitPackBudgetFixedKeyV1> = Object.freeze({
  compressedPackMaxBytes: 2147483648,
  perObjectInflatedMaxBytes: 536870912,
  aggregateInflatedMaxBytes: 8589934592,
  deltaDepthMax: 50,
  deltaInstructionMax: 10000000,
  deltaWorkMaxBytes: 8589934592,
  residentMemoryMaxBytes: 268435456,
  additionalTempMaxBytes: 10737418240,
  inheritedPushDeadlineMs: 600000,
});

/** The numeric ceilings the ledger enforces; production always uses `GIT_PACK_READER_LIMITS`. */
export interface GitPackReaderLimitsV1 {
  readonly objectCountMax: number;
  readonly compressedPackMaxBytes: number;
  readonly perObjectInflatedMaxBytes: number;
  readonly aggregateInflatedMaxBytes: number;
  readonly deltaDepthMax: number;
  readonly deltaInstructionMax: number;
  readonly deltaWorkMaxBytes: number;
  readonly residentMemoryMaxBytes: number;
  readonly additionalTempMaxBytes: number;
}

export const GIT_PACK_READER_LIMITS: GitPackReaderLimitsV1 = Object.freeze({
  objectCountMax: GIT_PACK_OBJECT_COUNT_MAX,
  compressedPackMaxBytes: BUDGET_FIXED.compressedPackMaxBytes,
  perObjectInflatedMaxBytes: BUDGET_FIXED.perObjectInflatedMaxBytes,
  aggregateInflatedMaxBytes: BUDGET_FIXED.aggregateInflatedMaxBytes,
  deltaDepthMax: BUDGET_FIXED.deltaDepthMax,
  deltaInstructionMax: BUDGET_FIXED.deltaInstructionMax,
  deltaWorkMaxBytes: BUDGET_FIXED.deltaWorkMaxBytes,
  residentMemoryMaxBytes: BUDGET_FIXED.residentMemoryMaxBytes,
  additionalTempMaxBytes: BUDGET_FIXED.additionalTempMaxBytes,
});

/**
 * The exact destination budget for a pack whose header declares `count`
 * objects. A successful read requires all three counts equal, so the
 * expectation is the header count; 200002 refuses here, before any child
 * permit or inflation.
 */
export function gitPackReaderBudget(count: number): GitPackReaderBudgetV1 {
  if (!Number.isSafeInteger(count) || count < 0 || count > GIT_PACK_OBJECT_COUNT_MAX) refuse("git_pack_object_count_over_limit");
  return validateGitPackReaderBudget({
    ...BUDGET_FIXED,
    packHeaderObjectCount: count,
    closedEffectObjectCount: count,
    admittedObjectCount: count,
  });
}

export interface GitPackReadRequestV1 {
  /** The staged pack; must sit inside `quarantineRoot`. */
  readonly packPath: CanonicalAbsolutePathV1;
  /** The staged version-2 index for the same pack. */
  readonly indexPath: CanonicalAbsolutePathV1;
  /** The private owner-only quarantine destroyed on every refusal. */
  readonly quarantineRoot: CanonicalAbsolutePathV1;
  /** The planned destination ref's resulting commit. */
  readonly targetOid: LowerHexSha1;
  /**
   * Objects the planned destination snapshot already owns. A closure walk
   * stops at them, and `--fix-thin` bases appended from them are closure
   * members because the planned ref reaches them through its prior commit.
   */
  readonly boundary: ReadonlySet<LowerHexSha1>;
  /** The invocation's one inherited push phase; the reader never begins or resets one. */
  readonly phase: Pick<GitProcessPhaseV1, "remainingMilliseconds">;
  readonly effectiveUid: number;
}

export interface GitPackClosureEvidenceV1 {
  readonly targetOid: LowerHexSha1;
  /** The pack trailer SHA-1, which also names `pack-<checksum>.{pack,idx}`. */
  readonly packChecksum: LowerHexSha1;
  readonly packSha256: LowerHexSha256;
  readonly packSize: number;
  readonly indexSha256: LowerHexSha256;
  readonly indexSize: number;
  readonly budget: GitPackReaderBudgetV1;
  /** SHA-256 over the sorted closure OIDs, one lowercase hex OID plus LF each. */
  readonly closureHash: LowerHexSha256;
  readonly inflatedBytes: number;
  readonly deltaInstructions: number;
  readonly deltaWorkBytes: number;
  readonly maximumDeltaDepth: number;
  readonly peakResidentBytes: number;
  readonly peakTempBytes: number;
}

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
}

const PACK_HEADER_BYTES = 12;
const SHA1_BYTES = 20;
const INPUT_CHUNK_BYTES = 16 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const ENTRY_HEADER_MAX_BYTES = 32;
/**
 * zlib's worst-case expansion (1032:1) bounds one 16-KiB input chunk's
 * output; the ledger reserves that transient buffer for the whole read.
 */
export const GIT_PACK_READER_TRANSIENT_BYTES = INPUT_CHUNK_BYTES * 1032 + READ_CHUNK_BYTES;
const IDX_MAGIC = 0xff744f63;
const DEADLINE_CHECK_INTERVAL = 4096;

/**
 * Every counted resource. Each charge refuses on the first byte, count or
 * level over its ceiling; nothing here resets across objects, passes or
 * retries. Exported so gigabyte-scale ceilings are provable without
 * materializing gigabytes.
 */
export class GitPackReaderLedger {
  readonly #limits: GitPackReaderLimitsV1;
  readonly #phase: Pick<GitProcessPhaseV1, "remainingMilliseconds">;
  compressedBytes = 0;
  inflatedBytes = 0;
  deltaInstructions = 0;
  deltaWorkBytes = 0;
  maximumDeltaDepth = 0;
  residentBytes = 0;
  peakResidentBytes = 0;
  tempBytes = 0;
  peakTempBytes = 0;

  constructor(limits: GitPackReaderLimitsV1, phase: Pick<GitProcessPhaseV1, "remainingMilliseconds">) {
    this.#limits = limits;
    this.#phase = phase;
  }

  deadline(): void {
    if (this.#phase.remainingMilliseconds() <= 0) refuse("git_pack_deadline");
  }

  objectCount(count: number): void {
    if (count > this.#limits.objectCountMax) refuse("git_pack_object_count_over_limit");
  }

  packSize(size: number): void {
    if (size > this.#limits.compressedPackMaxBytes) refuse("git_pack_compressed_over_limit");
  }

  compressed(bytes: number): void {
    this.compressedBytes += bytes;
    if (this.compressedBytes > this.#limits.compressedPackMaxBytes) refuse("git_pack_compressed_over_limit");
  }

  /** Before any allocation or inflation for one declared object or delta result. */
  declare(size: number): void {
    if (size > this.#limits.perObjectInflatedMaxBytes) refuse("git_pack_object_over_limit");
  }

  inflated(bytes: number): void {
    this.inflatedBytes += bytes;
    if (this.inflatedBytes > this.#limits.aggregateInflatedMaxBytes) refuse("git_pack_inflation_over_limit");
  }

  depth(level: number): void {
    if (level > this.#limits.deltaDepthMax) refuse("git_pack_delta_depth_over_limit");
    this.maximumDeltaDepth = Math.max(this.maximumDeltaDepth, level);
  }

  instruction(): void {
    this.deltaInstructions += 1;
    if (this.deltaInstructions > this.#limits.deltaInstructionMax) refuse("git_pack_delta_instructions_over_limit");
  }

  deltaWork(bytes: number): void {
    this.deltaWorkBytes += bytes;
    if (this.deltaWorkBytes > this.#limits.deltaWorkMaxBytes) refuse("git_pack_delta_work_over_limit");
  }

  /** A buffer that must be resident (a parsed commit/tree, the index): refuses rather than spilling. */
  requireResident(bytes: number): void {
    if (!this.tryResident(bytes)) refuse("git_pack_resident_memory_over_limit");
  }

  tryResident(bytes: number): boolean {
    if (this.residentBytes + bytes > this.#limits.residentMemoryMaxBytes) return false;
    this.residentBytes += bytes;
    this.peakResidentBytes = Math.max(this.peakResidentBytes, this.residentBytes);
    return true;
  }

  releaseResident(bytes: number): void {
    this.residentBytes -= bytes;
  }

  acquireTemp(bytes: number): void {
    if (this.tempBytes + bytes > this.#limits.additionalTempMaxBytes) refuse("git_pack_temp_over_limit");
    this.tempBytes += bytes;
    this.peakTempBytes = Math.max(this.peakTempBytes, this.tempBytes);
  }

  releaseTemp(bytes: number): void {
    this.tempBytes -= bytes;
  }
}

/**
 * Removes the private quarantine only when it is still the owner-only
 * directory the request named; an absent root is already destroyed.
 */
export async function destroyGitQuarantine(root: CanonicalAbsolutePathV1, effectiveUid: number): Promise<void> {
  let stats: BigIntStats;
  try {
    stats = await nodeFs.lstat(root, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (!stats.isDirectory() || Number(stats.uid) !== effectiveUid) refuse("git_quarantine_changed");
  await nodeFs.rm(root, { recursive: true, force: false });
}

/**
 * W2-SEC-GIT-2: destroys the quarantine after `refusal` and rethrows it; a destroy failure is
 * thrown instead, with `refusal` as its `cause`, so the original reason is never lost.
 */
export async function destroyGitQuarantineAfter(refusal: unknown, root: CanonicalAbsolutePathV1, effectiveUid: number): Promise<never> {
  try {
    await destroyGitQuarantine(root, effectiveUid);
  } catch (destroyFailure) {
    const reason = destroyFailure instanceof SecurityRefusalError ? destroyFailure.message : "git_quarantine_destroy_failed";
    throw new SecurityRefusalError(reason, { cause: refusal });
  }
  throw refusal;
}

type PackObjectTypeV1 = "commit" | "tree" | "blob";
const TYPE_CODES: Readonly<Record<number, PackObjectTypeV1>> = { 1: "commit", 2: "tree", 3: "blob" };

interface ObjectBody {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

interface BodySink {
  write(chunk: Uint8Array): Promise<void>;
  finish(): ObjectBody;
  dispose(): Promise<void>;
}

/**
 * Object bodies live in memory while the resident ledger admits them and
 * otherwise spill to owner-only files under the quarantine, counted as
 * temp. ponytail: no cache, every base is re-materialized (and re-charged)
 * per delta; add an LRU when delta work, not correctness, is the limit.
 */
class BodyStore {
  readonly #ledger: GitPackReaderLedger;
  readonly #directory: string;
  readonly #effectiveUid: number;
  #next = 0;

  constructor(ledger: GitPackReaderLedger, directory: string, effectiveUid: number) {
    this.#ledger = ledger;
    this.#directory = directory;
    this.#effectiveUid = effectiveUid;
  }

  async allocate(size: number, resident: boolean): Promise<BodySink> {
    const ledger = this.#ledger;
    if (resident) ledger.requireResident(size);
    if (resident || ledger.tryResident(size)) {
      const bytes = new Uint8Array(size);
      let written = 0;
      let released = false;
      const release = (): Promise<void> => {
        if (!released) ledger.releaseResident(size);
        released = true;
        return Promise.resolve();
      };
      return {
        write(chunk) {
          if (written + chunk.byteLength > size) refuse("git_pack_malformed");
          bytes.set(chunk, written);
          written += chunk.byteLength;
          return Promise.resolve();
        },
        finish() {
          if (written !== size) refuse("git_pack_malformed");
          return {
            size,
            read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
            dispose: release,
          };
        },
        dispose: release,
      };
    }
    ledger.acquireTemp(size);
    const path = `${this.#directory}/${(this.#next += 1).toString(10)}`;
    let handle: nodeFs.FileHandle;
    try {
      handle = await nodeFs.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      ledger.releaseTemp(size);
      throw error;
    }
    const stats = await handle.stat({ bigint: true });
    let disposed = false;
    const dispose = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      await handle.close();
      await nodeFs.unlink(path);
      ledger.releaseTemp(size);
    };
    if (!stats.isFile() || Number(stats.uid) !== this.#effectiveUid || stats.nlink !== 1n) {
      await dispose();
      refuse("git_pack_spill_changed");
    }
    let written = 0;
    return {
      async write(chunk) {
        if (written + chunk.byteLength > size) refuse("git_pack_malformed");
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, written + offset);
          offset += bytesWritten;
        }
        written += chunk.byteLength;
      },
      finish() {
        if (written !== size) refuse("git_pack_malformed");
        return {
          size,
          async read(offset, length) {
            const buffer = new Uint8Array(length);
            let filled = 0;
            while (filled < length) {
              const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
              if (bytesRead === 0) refuse("git_pack_spill_changed");
              filled += bytesRead;
            }
            return buffer;
          },
          dispose,
        };
      },
      dispose,
    };
  }
}

/** Sequential bounded reads over a body, never holding more than one chunk. */
class BodyCursor {
  readonly #body: ObjectBody;
  #chunk: Uint8Array = new Uint8Array(0);
  #chunkStart = 0;
  position = 0;

  constructor(body: ObjectBody) {
    this.#body = body;
  }

  get remaining(): number {
    return this.#body.size - this.position;
  }

  async #fill(): Promise<void> {
    if (this.position < this.#chunkStart + this.#chunk.byteLength) return;
    const length = Math.min(READ_CHUNK_BYTES, this.remaining);
    if (length === 0) refuse("git_pack_malformed");
    this.#chunk = await this.#body.read(this.position, length);
    this.#chunkStart = this.position;
  }

  async byte(): Promise<number> {
    await this.#fill();
    const value = this.#chunk[this.position - this.#chunkStart] as number;
    this.position += 1;
    return value;
  }

  async take(length: number): Promise<Uint8Array> {
    if (length > this.remaining) refuse("git_pack_malformed");
    await this.#fill();
    const available = this.#chunk.byteLength - (this.position - this.#chunkStart);
    const start = this.position - this.#chunkStart;
    const slice = this.#chunk.subarray(start, start + Math.min(length, available));
    this.position += slice.byteLength;
    return slice;
  }
}

interface PackEntry {
  readonly offset: number;
  readonly dataStart: number;
  readonly declaredSize: number;
  readonly kind: "base" | "ofs_delta" | "ref_delta";
  readonly type: PackObjectTypeV1 | null;
  readonly baseOffset: number | null;
  readonly baseOid: LowerHexSha1 | null;
  compressedEnd: number;
  crc: number;
  oid: LowerHexSha1 | null;
}

interface ResolvedObject {
  readonly type: PackObjectTypeV1;
  readonly links: readonly (readonly [LowerHexSha1, PackObjectTypeV1])[];
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

function parseCommitLinks(content: Uint8Array): ResolvedObject["links"] {
  const text = latin1(content);
  const lines = text.split("\n");
  const tree = /^tree ([0-9a-f]{40})$/u.exec(lines[0] ?? "");
  if (tree === null) refuse("git_pack_malformed");
  const links: [LowerHexSha1, PackObjectTypeV1][] = [[parseLowerHexSha1(tree[1]), "tree"]];
  for (let index = 1; index < lines.length; index += 1) {
    const parent = /^parent ([0-9a-f]{40})$/u.exec(lines[index] as string);
    if (parent === null) break;
    links.push([parseLowerHexSha1(parent[1]), "commit"]);
  }
  return links;
}

function parseTreeLinks(content: Uint8Array): ResolvedObject["links"] {
  const links: [LowerHexSha1, PackObjectTypeV1][] = [];
  let offset = 0;
  while (offset < content.byteLength) {
    const space = content.indexOf(0x20, offset);
    if (space < 0) refuse("git_pack_malformed");
    const mode = latin1(content.subarray(offset, space));
    const nul = content.indexOf(0, space + 1);
    if (nul < 0 || nul === space + 1 || nul + 1 + SHA1_BYTES > content.byteLength) refuse("git_pack_malformed");
    const name = content.subarray(space + 1, nul);
    if (name.includes(0x2f)) refuse("git_pack_malformed");
    const oid = parseLowerHexSha1(hex(content.subarray(nul + 1, nul + 1 + SHA1_BYTES)));
    if (mode === "40000") links.push([oid, "tree"]);
    else if (mode === "100644" || mode === "100755" || mode === "120000") links.push([oid, "blob"]);
    else if (mode === "160000") refuse("git_pack_unsupported_tree_entry");
    else refuse("git_pack_malformed");
    offset = nul + 1 + SHA1_BYTES;
  }
  return links;
}

/** One validation over one open pack descriptor. */
class PackValidation {
  readonly #request: GitPackReadRequestV1;
  readonly #budget: GitPackReaderBudgetV1;
  readonly #ledger: GitPackReaderLedger;
  readonly #handle: nodeFs.FileHandle;
  readonly #size: number;
  readonly #dataEnd: number;
  readonly #store: BodyStore;
  readonly #entries = new Map<number, PackEntry>();
  readonly #byOid = new Map<string, PackEntry>();
  readonly #objects = new Map<string, ResolvedObject>();
  #steps = 0;

  constructor(
    request: GitPackReadRequestV1,
    budget: GitPackReaderBudgetV1,
    ledger: GitPackReaderLedger,
    handle: nodeFs.FileHandle,
    size: number,
    store: BodyStore,
  ) {
    this.#request = request;
    this.#budget = budget;
    this.#ledger = ledger;
    this.#handle = handle;
    this.#size = size;
    this.#dataEnd = size - SHA1_BYTES;
    this.#store = store;
  }

  #tick(): void {
    this.#steps += 1;
    if (this.#steps % DEADLINE_CHECK_INTERVAL === 0) this.#ledger.deadline();
  }

  async #read(position: number, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await this.#handle.read(buffer, filled, length - filled, position + filled);
      if (bytesRead === 0) refuse("git_pack_truncated");
      filled += bytesRead;
    }
    return buffer;
  }

  /** Streams the whole file once: compressed bytes are charged before any parse, and the trailer is proven. */
  async checksums(): Promise<{ readonly checksum: LowerHexSha1; readonly sha256: LowerHexSha256; readonly count: number }> {
    const sha1 = createHash("sha1");
    const sha256 = createHash("sha256");
    let header: Uint8Array | null = null;
    for (let position = 0; position < this.#size; position += READ_CHUNK_BYTES) {
      this.#ledger.deadline();
      const chunk = await this.#read(position, Math.min(READ_CHUNK_BYTES, this.#size - position));
      this.#ledger.compressed(chunk.byteLength);
      sha256.update(chunk);
      if (position < this.#dataEnd) sha1.update(chunk.subarray(0, Math.min(chunk.byteLength, this.#dataEnd - position)));
      header ??= chunk.slice(0, PACK_HEADER_BYTES);
    }
    const trailer = await this.#read(this.#dataEnd, SHA1_BYTES);
    const checksum = sha1.digest();
    if (hex(checksum) !== hex(trailer)) refuse("git_pack_checksum_mismatch");
    if (header === null || latin1(header.subarray(0, 4)) !== "PACK" || readUInt32(header, 4) !== 2) refuse("git_pack_malformed");
    return {
      checksum: parseLowerHexSha1(hex(checksum)),
      sha256: parseLowerHexSha256(sha256.digest("hex")),
      count: readUInt32(header, 8),
    };
  }

  /**
   * Inflates exactly one zlib stream starting at `start`. zlib reports the
   * consumed input through `bytesWritten` once the stream ends, which is
   * where the next entry begins; input past the stream end is ignored.
   */
  async #inflate(start: number, declared: number, onChunk: ((chunk: Uint8Array) => Promise<void>) | null): Promise<number> {
    const ledger = this.#ledger;
    ledger.declare(declared);
    const inflater = createInflate();
    const pending: Buffer[] = [];
    const stream = { ended: false, failed: false };
    inflater.on("data", (chunk: Buffer) => {
      pending.push(chunk);
    });
    inflater.on("end", () => {
      stream.ended = true;
    });
    inflater.on("error", () => {
      stream.failed = true;
    });
    let produced = 0;
    const drain = async (): Promise<void> => {
      for (let chunk = pending.shift(); chunk !== undefined; chunk = pending.shift()) {
        produced += chunk.byteLength;
        if (produced > declared) refuse("git_pack_malformed");
        ledger.inflated(chunk.byteLength);
        if (onChunk !== null) await onChunk(chunk);
      }
    };
    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
    try {
      let position = start;
      while (!stream.ended && !stream.failed) {
        ledger.deadline();
        if (position >= this.#dataEnd) {
          await new Promise<void>((resolve) => {
            inflater.once("end", resolve);
            inflater.once("error", () => {
              resolve();
            });
            inflater.end();
          });
          await drain();
          break;
        }
        const chunk = await this.#read(position, Math.min(INPUT_CHUNK_BYTES, this.#dataEnd - position));
        position += chunk.byteLength;
        await new Promise<void>((resolve) => {
          inflater.write(chunk, () => {
            resolve();
          });
        });
        await settle();
        await drain();
      }
      if (stream.failed) refuse("git_pack_malformed");
      if (!stream.ended) refuse("git_pack_truncated");
      await drain();
      if (produced !== declared) refuse("git_pack_malformed");
      return inflater.bytesWritten;
    } finally {
      inflater.destroy();
    }
  }

  async #entryHeader(offset: number): Promise<PackEntry> {
    const window = await this.#read(offset, Math.min(ENTRY_HEADER_MAX_BYTES, this.#dataEnd - offset));
    let cursor = 0;
    const next = (): number => {
      if (cursor >= window.byteLength) refuse("git_pack_truncated");
      return window[cursor++] as number;
    };
    let byte = next();
    const code = (byte >> 4) & 0x7;
    let size = byte & 0x0f;
    let scale = 16;
    while ((byte & 0x80) !== 0) {
      byte = next();
      size += (byte & 0x7f) * scale;
      scale *= 128;
      if (scale > 2 ** 42) refuse("git_pack_malformed");
    }
    this.#ledger.declare(size);
    if (code === 1 || code === 2 || code === 3) {
      return this.#entry(offset, offset + cursor, size, "base", TYPE_CODES[code] as PackObjectTypeV1, null, null);
    }
    if (code === 6) {
      byte = next();
      let distance = byte & 0x7f;
      while ((byte & 0x80) !== 0) {
        byte = next();
        distance = (distance + 1) * 128 + (byte & 0x7f);
        if (distance > this.#size) refuse("git_pack_malformed");
      }
      const baseOffset = offset - distance;
      if (distance === 0 || !this.#entries.has(baseOffset)) refuse("git_pack_malformed");
      return this.#entry(offset, offset + cursor, size, "ofs_delta", null, baseOffset, null);
    }
    if (code === 7) {
      if (cursor + SHA1_BYTES > window.byteLength) refuse("git_pack_truncated");
      const baseOid = parseLowerHexSha1(hex(window.subarray(cursor, cursor + SHA1_BYTES)));
      return this.#entry(offset, offset + cursor + SHA1_BYTES, size, "ref_delta", null, null, baseOid);
    }
    if (code === 4) refuse("git_pack_unsupported_object_type");
    return refuse("git_pack_malformed");
  }

  #entry(
    offset: number,
    dataStart: number,
    declaredSize: number,
    kind: PackEntry["kind"],
    type: PackObjectTypeV1 | null,
    baseOffset: number | null,
    baseOid: LowerHexSha1 | null,
  ): PackEntry {
    return { offset, dataStart, declaredSize, kind, type, baseOffset, baseOid, compressedEnd: 0, crc: 0, oid: null };
  }

  async #crc(entry: PackEntry): Promise<number> {
    let value = 0;
    for (let position = entry.offset; position < entry.compressedEnd; position += READ_CHUNK_BYTES) {
      value = crc32(await this.#read(position, Math.min(READ_CHUNK_BYTES, entry.compressedEnd - position)), value);
    }
    return value;
  }

  #admit(entry: PackEntry, oid: LowerHexSha1, object: ResolvedObject): void {
    if (this.#byOid.has(oid)) refuse("git_pack_duplicate_object");
    entry.oid = oid;
    this.#byOid.set(oid, entry);
    this.#objects.set(oid, object);
  }

  /** Pass 1: frame every entry, admit every non-delta object, and prove the stream ends at the trailer. */
  async frame(count: number): Promise<void> {
    let offset = PACK_HEADER_BYTES;
    for (let index = 0; index < count; index += 1) {
      this.#ledger.deadline();
      if (offset >= this.#dataEnd) refuse("git_pack_truncated");
      const entry = await this.#entryHeader(offset);
      this.#entries.set(offset, entry);
      if (entry.kind === "base") {
        const type = entry.type as PackObjectTypeV1;
        const hash = createHash("sha1").update(`${type} ${entry.declaredSize.toString(10)}\0`, "latin1");
        let content: Uint8Array | null = null;
        let filled = 0;
        if (type !== "blob") {
          this.#ledger.requireResident(entry.declaredSize);
          content = new Uint8Array(entry.declaredSize);
        }
        try {
          const consumed = await this.#inflate(entry.dataStart, entry.declaredSize, (chunk) => {
            hash.update(chunk);
            content?.set(chunk, filled);
            filled += chunk.byteLength;
            return Promise.resolve();
          });
          entry.compressedEnd = entry.dataStart + consumed;
          const oid = parseLowerHexSha1(hash.digest("hex"));
          const links = content === null ? [] : type === "commit" ? parseCommitLinks(content) : parseTreeLinks(content);
          this.#admit(entry, oid, { type, links });
        } finally {
          if (content !== null) this.#ledger.releaseResident(entry.declaredSize);
        }
      } else {
        entry.compressedEnd = entry.dataStart + (await this.#inflate(entry.dataStart, entry.declaredSize, null));
      }
      entry.crc = await this.#crc(entry);
      offset = entry.compressedEnd;
    }
    if (offset !== this.#dataEnd) refuse("git_pack_malformed");
  }

  #baseOf(entry: PackEntry): PackEntry | undefined {
    if (entry.kind === "ofs_delta") return this.#entries.get(entry.baseOffset as number);
    return this.#byOid.get(entry.baseOid as string);
  }

  /**
   * The non-delta entry at the end of a chain, once every REF base on it
   * already has an admitted OID; an over-deep chain is returned as its own
   * root so materializing it refuses on depth.
   */
  #chainRoot(entry: PackEntry): PackEntry | undefined {
    let current: PackEntry | undefined = entry;
    for (let level = 0; current !== undefined && current.kind !== "base"; level += 1) {
      if (level > this.#budget.deltaDepthMax) return entry;
      current = this.#baseOf(current);
    }
    return current;
  }

  /** Materializes one entry's full content; each delta level re-reads and re-charges its base. */
  async #materialize(entry: PackEntry, level: number, resident: boolean): Promise<{ readonly type: PackObjectTypeV1; readonly body: ObjectBody }> {
    this.#ledger.deadline();
    if (entry.kind === "base") {
      const sink = await this.#store.allocate(entry.declaredSize, resident);
      try {
        await this.#inflate(entry.dataStart, entry.declaredSize, (chunk) => sink.write(chunk));
        return { type: entry.type as PackObjectTypeV1, body: sink.finish() };
      } catch (error) {
        await sink.dispose();
        throw error;
      }
    }
    this.#ledger.depth(level + 1);
    const baseEntry = this.#baseOf(entry);
    if (baseEntry === undefined) refuse("git_pack_missing_base");
    const base = await this.#materialize(baseEntry, level + 1, false);
    let deltaSink: BodySink | null = null;
    let delta: ObjectBody | null = null;
    try {
      deltaSink = await this.#store.allocate(entry.declaredSize, false);
      const sinkForDelta = deltaSink;
      await this.#inflate(entry.dataStart, entry.declaredSize, (chunk) => sinkForDelta.write(chunk));
      delta = deltaSink.finish();
      return { type: base.type, body: await this.#apply(base.body, delta, resident) };
    } finally {
      if (delta !== null) await delta.dispose();
      else if (deltaSink !== null) await deltaSink.dispose();
      await base.body.dispose();
    }
  }

  async #apply(base: ObjectBody, delta: ObjectBody, resident: boolean): Promise<ObjectBody> {
    const ledger = this.#ledger;
    const cursor = new BodyCursor(delta);
    const varint = async (): Promise<number> => {
      let value = 0;
      let scale = 1;
      for (;;) {
        const byte = await cursor.byte();
        value += (byte & 0x7f) * scale;
        scale *= 128;
        if ((byte & 0x80) === 0) return value;
        if (scale > 2 ** 42) refuse("git_pack_malformed");
      }
    };
    if ((await varint()) !== base.size) refuse("git_pack_malformed");
    const resultSize = await varint();
    ledger.declare(resultSize);
    const sink = await this.#store.allocate(resultSize, resident);
    try {
      let written = 0;
      while (cursor.remaining > 0) {
        this.#tick();
        ledger.instruction();
        const opcode = await cursor.byte();
        if ((opcode & 0x80) !== 0) {
          let copyOffset = 0;
          let copySize = 0;
          for (let bit = 0; bit < 4; bit += 1) {
            if ((opcode & (1 << bit)) !== 0) copyOffset += (await cursor.byte()) * 2 ** (8 * bit);
          }
          for (let bit = 0; bit < 3; bit += 1) {
            if ((opcode & (0x10 << bit)) !== 0) copySize += (await cursor.byte()) * 2 ** (8 * bit);
          }
          if (copySize === 0) copySize = 0x10000;
          if (copyOffset + copySize > base.size || written + copySize > resultSize) refuse("git_pack_malformed");
          ledger.deltaWork(copySize * 2);
          for (let done = 0; done < copySize; ) {
            const piece = await base.read(copyOffset + done, Math.min(READ_CHUNK_BYTES, copySize - done));
            await sink.write(piece);
            done += piece.byteLength;
          }
          written += copySize;
        } else {
          if (opcode === 0) refuse("git_pack_malformed");
          if (written + opcode > resultSize) refuse("git_pack_malformed");
          ledger.deltaWork(opcode * 2);
          for (let done = 0; done < opcode; ) {
            const piece = await cursor.take(opcode - done);
            await sink.write(piece);
            done += piece.byteLength;
          }
          written += opcode;
        }
      }
      if (written !== resultSize) refuse("git_pack_malformed");
      return sink.finish();
    } catch (error) {
      await sink.dispose();
      throw error;
    }
  }

  async #resolveDelta(entry: PackEntry, root: PackEntry): Promise<void> {
    const { type, body } = await this.#materialize(entry, 0, root.type !== "blob");
    try {
      const hash = createHash("sha1").update(`${type} ${body.size.toString(10)}\0`, "latin1");
      const cursor = new BodyCursor(body);
      let content: Uint8Array | null = null;
      if (type !== "blob") content = await body.read(0, body.size);
      else while (cursor.remaining > 0) hash.update(await cursor.take(cursor.remaining));
      if (content !== null) hash.update(content);
      const oid = parseLowerHexSha1(hash.digest("hex"));
      const links = content === null ? [] : type === "commit" ? parseCommitLinks(content) : parseTreeLinks(content);
      this.#admit(entry, oid, { type, links });
    } finally {
      await body.dispose();
    }
  }

  /** Pass 2: resolve delta entries in rounds, so a REF base that is itself a delta resolves once admitted. */
  async resolveDeltas(): Promise<void> {
    let pending = [...this.#entries.values()].filter((entry) => entry.kind !== "base");
    while (pending.length > 0) {
      const deferred: PackEntry[] = [];
      for (const entry of pending) {
        const root = this.#chainRoot(entry);
        if (root === undefined) deferred.push(entry);
        else await this.#resolveDelta(entry, root);
      }
      if (deferred.length === pending.length) refuse("git_pack_missing_base");
      pending = deferred;
    }
  }

  get admittedCount(): number {
    return this.#objects.size;
  }

  /** The version-2 index must list exactly the admitted objects at their offsets, CRCs and pack checksum. */
  verifyIndex(index: Uint8Array, packChecksum: LowerHexSha1): void {
    const count = this.#entries.size;
    if (index.byteLength !== 8 + 1024 + count * 28 + 2 * SHA1_BYTES) refuse("git_pack_index_malformed");
    if (readUInt32(index, 0) !== IDX_MAGIC || readUInt32(index, 4) !== 2) refuse("git_pack_index_malformed");
    let previous = 0;
    for (let bucket = 0; bucket < 256; bucket += 1) {
      const value = readUInt32(index, 8 + bucket * 4);
      if (value < previous) refuse("git_pack_index_malformed");
      previous = value;
    }
    if (previous !== count) refuse("git_pack_index_malformed");
    const names = 8 + 1024;
    const crcs = names + count * SHA1_BYTES;
    const offsets = crcs + count * 4;
    let last = "";
    for (let position = 0; position < count; position += 1) {
      this.#tick();
      const name = hex(index.subarray(names + position * SHA1_BYTES, names + (position + 1) * SHA1_BYTES));
      if (name <= last) refuse("git_pack_index_malformed");
      last = name;
      const bucket = parseInt(name.slice(0, 2), 16);
      const below = bucket === 0 ? 0 : readUInt32(index, 8 + (bucket - 1) * 4);
      if (position < below || position >= readUInt32(index, 8 + bucket * 4)) refuse("git_pack_index_malformed");
      const offset = readUInt32(index, offsets + position * 4);
      const entry = this.#byOid.get(name);
      if (entry === undefined || (offset & 0x80000000) !== 0 || entry.offset !== offset || entry.crc !== readUInt32(index, crcs + position * 4)) {
        refuse("git_pack_index_mismatch");
      }
    }
    const trailer = offsets + count * 4;
    if (hex(index.subarray(trailer, trailer + SHA1_BYTES)) !== packChecksum) refuse("git_pack_index_mismatch");
    const digest = createHash("sha1").update(index.subarray(0, trailer + SHA1_BYTES)).digest("hex");
    if (digest !== hex(index.subarray(trailer + SHA1_BYTES))) refuse("git_pack_index_malformed");
  }

  /**
   * The closure walk from the target: a pack object is counted once and
   * followed; a boundary object ends the walk; anything else is missing.
   * Every pack object must end inside the closure.
   */
  closure(): ReadonlySet<string> {
    const { targetOid, boundary } = this.#request;
    if (!this.#objects.has(targetOid) && !boundary.has(targetOid)) refuse("git_pack_target_missing");
    const closure = new Set<string>();
    const stack: (readonly [LowerHexSha1, PackObjectTypeV1])[] = [[targetOid, "commit"]];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      this.#tick();
      const [oid, expected] = item;
      if (closure.has(oid)) continue;
      const object = this.#objects.get(oid);
      if (object === undefined) {
        if (boundary.has(oid)) continue;
        refuse("git_pack_missing_object");
      }
      if (object.type !== expected) refuse(oid === targetOid ? "git_pack_wrong_target" : "git_pack_wrong_object_type");
      closure.add(oid);
      for (const link of object.links) stack.push(link);
    }
    for (const oid of this.#objects.keys()) {
      if (closure.has(oid)) continue;
      // `index-pack --fix-thin` appends delta bases the destination already owns.
      if (boundary.has(oid as LowerHexSha1)) closure.add(oid);
      else refuse("git_pack_extra_object");
    }
    return closure;
  }
}

async function openGuarded(path: string, effectiveUid: number): Promise<{ readonly handle: nodeFs.FileHandle; readonly size: number }> {
  let handle: nodeFs.FileHandle;
  try {
    handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ELOOP") refuse("git_pack_missing");
    throw error;
  }
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile() || Number(stats.uid) !== effectiveUid || stats.nlink !== 1n) {
    await handle.close();
    refuse("git_pack_file_changed");
  }
  return { handle, size: Number(stats.size) };
}

function within(path: string, root: string): boolean {
  return path.startsWith(`${root}/`);
}

export class GuardedSha1PackReader {
  readonly #limits: GitPackReaderLimitsV1;

  constructor(options: { readonly limits?: GitPackReaderLimitsV1 } = {}) {
    this.#limits = options.limits ?? GIT_PACK_READER_LIMITS;
  }

  async validate(request: GitPackReadRequestV1, budget: GitPackReaderBudgetV1): Promise<GitPackClosureEvidenceV1> {
    try {
      return await this.#validate(request, budget);
    } catch (error) {
      return destroyGitQuarantineAfter(error, request.quarantineRoot, request.effectiveUid);
    }
  }

  async #validate(request: GitPackReadRequestV1, rawBudget: GitPackReaderBudgetV1): Promise<GitPackClosureEvidenceV1> {
    let budget: GitPackReaderBudgetV1;
    try {
      budget = validateGitPackReaderBudget(rawBudget);
    } catch {
      return refuse("git_pack_budget_invalid");
    }
    const { quarantineRoot, effectiveUid } = request;
    if (!within(request.packPath, quarantineRoot) || !within(request.indexPath, quarantineRoot)) refuse("git_pack_outside_quarantine");
    const ledger = new GitPackReaderLedger(this.#limits, request.phase);
    ledger.deadline();
    ledger.objectCount(budget.packHeaderObjectCount);
    ledger.requireResident(GIT_PACK_READER_TRANSIENT_BYTES);

    const spill = `${quarantineRoot}/pack-reader-spill`;
    await nodeFs.mkdir(spill, { mode: 0o700 });
    const pack = await openGuarded(request.packPath, effectiveUid);
    try {
      ledger.packSize(pack.size);
      if (pack.size < PACK_HEADER_BYTES + SHA1_BYTES) refuse("git_pack_truncated");
      const validation = new PackValidation(request, budget, ledger, pack.handle, pack.size, new BodyStore(ledger, spill, effectiveUid));
      const { checksum, sha256, count } = await validation.checksums();
      ledger.objectCount(count);
      if (count !== budget.packHeaderObjectCount) refuse("git_pack_count_mismatch");
      await validation.frame(count);
      await validation.resolveDeltas();
      if (validation.admittedCount !== budget.admittedObjectCount) refuse("git_pack_count_mismatch");

      const index = await openGuarded(request.indexPath, effectiveUid);
      let indexBytes: Uint8Array;
      try {
        const expected = 8 + 1024 + count * 28 + 2 * SHA1_BYTES;
        if (index.size !== expected) refuse("git_pack_index_malformed");
        ledger.requireResident(expected);
        indexBytes = new Uint8Array(expected);
        let filled = 0;
        while (filled < expected) {
          const { bytesRead } = await index.handle.read(indexBytes, filled, expected - filled, filled);
          if (bytesRead === 0) refuse("git_pack_index_malformed");
          filled += bytesRead;
        }
      } finally {
        await index.handle.close();
      }
      validation.verifyIndex(indexBytes, checksum);

      ledger.deadline();
      const closure = validation.closure();
      if (closure.size !== budget.closedEffectObjectCount) refuse("git_pack_count_mismatch");
      ledger.deadline();
      return {
        targetOid: request.targetOid,
        packChecksum: checksum,
        packSha256: sha256,
        packSize: pack.size,
        indexSha256: parseLowerHexSha256(createHash("sha256").update(indexBytes).digest("hex")),
        indexSize: indexBytes.byteLength,
        budget,
        closureHash: parseLowerHexSha256(
          createHash("sha256")
            .update([...closure].sort().map((oid) => `${oid}\n`).join(""), "latin1")
            .digest("hex"),
        ),
        inflatedBytes: ledger.inflatedBytes,
        deltaInstructions: ledger.deltaInstructions,
        deltaWorkBytes: ledger.deltaWorkBytes,
        maximumDeltaDepth: ledger.maximumDeltaDepth,
        peakResidentBytes: ledger.peakResidentBytes,
        peakTempBytes: ledger.peakTempBytes,
      };
    } finally {
      await pack.handle.close();
      await nodeFs.rm(spill, { recursive: true, force: true });
    }
  }
}
