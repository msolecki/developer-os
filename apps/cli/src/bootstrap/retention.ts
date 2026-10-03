import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BOOTSTRAP_RETAINED_MAX_ENTRIES,
  BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES,
  BootstrapStateError,
  CODEX_INGEST_AUTH_LINK,
  CODEX_INGEST_HOME_RELATIVE_PATH,
  MANIFEST_ANCHOR_RELATIVE_PATH,
  encodeCanonicalJson,
  isRedactionKeyPath,
  parseLowerHexSha256,
  parseUInt64Decimal,
  sortUtf8,
  type BootstrapJournalRecordV1,
  type BootstrapRetentionDirectoryEntryV1,
  type BootstrapRetentionEntryV1,
  type BootstrapRetentionPostimageV1,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LowerHexSha256,
  type TransactionLockHandle,
} from "@developer-os/core";
import type { RenameSameParentNoReplace } from "@developer-os/platform-macos";

import type { BootstrapJournalStore } from "./journal-store.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;

export type BootstrapRetentionObservationV1 =
  | { readonly state: "before"; readonly source: BootstrapRetentionPostimageV1 }
  | { readonly state: "after"; readonly tombstone: BootstrapRetentionPostimageV1 };

export type BootstrapRetentionDeathPointV1 =
  | "before_rename"
  | "after_rename"
  | "after_projection"
  | "before_parent_sync"
  | "after_parent_sync"
  | "before_journal_advance"
  | "after_journal_advance"
  | "before_lock_release"
  | "after_lock_release";

export interface BootstrapRetainerDependenciesV1 {
  readonly renameSameParentNoReplace: RenameSameParentNoReplace;
  readonly syncDirectory: (path: CanonicalAbsolutePathV1) => Promise<void>;
  readonly projectPostimage: (
    path: CanonicalAbsolutePathV1,
  ) => Promise<BootstrapRetentionPostimageV1 | null>;
  readonly interrupt?: (point: BootstrapRetentionDeathPointV1) => void;
}

export interface HeldBootstrapLocksV1 {
  readonly bootstrap: TransactionLockHandle | null;
  readonly global: TransactionLockHandle | null;
}

function refuse(): never {
  throw new BootstrapStateError("retained bootstrap state is malformed or unbound");
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) ===
      encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

/**
 * Fresh-walk equality for two projections the same code just produced. A directory tree's
 * `treeHash` is sha256 over exactly `encodeCanonicalJson(entries)` (see
 * `projectRetainedDirectoryTreeOnce`), so equal hashes, counts and root fields mean equal
 * entries without re-encoding them (NEW-133). A postimage read back from a table or journal
 * carries a `treeHash` nobody recomputed here, so it is compared with `sameValue` instead.
 */
function sameFreshProjection(left: BootstrapRetentionPostimageV1, right: BootstrapRetentionPostimageV1): boolean {
  if (left.kind !== "directory_tree" || right.kind !== "directory_tree") return sameValue(left, right);
  return left.ownerUid === right.ownerUid &&
    left.nlink === right.nlink &&
    left.treeHash === right.treeHash &&
    left.entryCount === right.entryCount &&
    left.regularFileBytes === right.regularFileBytes &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.entries !== undefined &&
    right.entries !== undefined;
}

/**
 * NEW-133 content cache: one per retainer, in memory only — never persisted, never shared
 * across processes. It maps a regular file's bigint lstat key to the sha256 an earlier walk
 * read, so an unchanged file is not reopened on every walk of the same tree.
 *
 * Why a hit cannot hide a change: the key holds ctime_ns, and a same-uid process cannot set
 * ctime — `utimes` sets atime and mtime only, and itself moves ctime — while every write(2),
 * truncate, chmod, chown or link-count change moves it. Replacement by rename brings a
 * different inode. So a changed file has a different key, misses, and is hashed again as before.
 *
 * ctime has the filesystem's granularity, not a nanosecond's: APFS stores nanoseconds, HFS+ one
 * second, exFAT two. A same-size rewrite inside one granule keeps the whole key, so a file is
 * cached only when its ctime is more than `RACY_CTIME_MARGIN_NS` (two seconds, the coarsest of
 * these) older than the wall clock sampled before its read — the "racy git" rule with a margin
 * — and only when every stat taken around the read agrees on the key. A younger file is hashed
 * on every walk, exactly as without the cache.
 *
 * Residual: a writer that changes a file through a shared mmap without msync(2) may not move
 * ctime until the pages are written back. No writer of `state/` uses mmap.
 */
export type BootstrapRetentionContentCacheV1 = Map<string, LowerHexSha256>;

const RACY_CTIME_MARGIN_NS = 2_000_000_000n;

function contentKey(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mode, stats.uid, stats.nlink, stats.mtimeNs, stats.ctimeNs]
    .map((value) => value.toString(10))
    .join(":");
}

function uint64(value: bigint): ReturnType<typeof parseUInt64Decimal> {
  if (value < 0n || value > UINT64_MAX) return refuse();
  return parseUInt64Decimal(value.toString());
}

function fileMode(stats: BigIntStats): number {
  return Number(stats.mode & 0o777n);
}

function identityMatches(
  stats: Pick<BigIntStats, "dev" | "ino">,
  expected: Pick<BigIntStats, "dev" | "ino">,
): boolean {
  return stats.dev === expected.dev && stats.ino === expected.ino;
}

function exactDirectory(
  stats: BigIntStats,
  expected?: Pick<BigIntStats, "dev" | "ino">,
): boolean {
  return stats.isDirectory() &&
    !stats.isSymbolicLink() &&
    fileMode(stats) === 0o700 &&
    (expected === undefined || identityMatches(stats, expected));
}

function exactDirectorySnapshot(stats: BigIntStats, expected: BigIntStats): boolean {
  return exactDirectory(stats, expected) &&
    stats.uid === expected.uid &&
    stats.mode === expected.mode &&
    stats.nlink === expected.nlink;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function exactRegular(stats: BigIntStats, expected?: Pick<BigIntStats, "dev" | "ino">): boolean {
  return stats.isFile() &&
    !stats.isSymbolicLink() &&
    (fileMode(stats) === 0o600 || fileMode(stats) === 0o700) &&
    stats.nlink === 1n &&
    stats.size >= 0n &&
    stats.size <= BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES &&
    (expected === undefined || identityMatches(stats, expected));
}

async function projectRegularEntry(
  absolutePath: string,
  relativePath: string,
  before: BigIntStats,
  cache?: BootstrapRetentionContentCacheV1,
): Promise<Extract<BootstrapRetentionDirectoryEntryV1, { kind: "regular_file" }> & { readonly sha256: LowerHexSha256 }> {
  if (!exactRegular(before)) return refuse();
  const key = contentKey(before);
  const cached = cache?.get(key);
  if (cached !== undefined) {
    return {
      relativePath,
      kind: "regular_file",
      ownerUid: Number(before.uid),
      mode: fileMode(before) === 0o600 ? 0o600 : 0o700,
      nlink: 1,
      bytes: uint64(before.size),
      sha256: cached,
      dev: uint64(before.dev),
      ino: uint64(before.ino),
    };
  }
  const readStartedNs = BigInt(Date.now()) * 1_000_000n;
  let handle: nodeFs.FileHandle | undefined;
  try {
    handle = await nodeFs.open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = await handle.stat({ bigint: true });
    if (!exactRegular(opened, before) || opened.size !== before.size) return refuse();
    const digest = createHash("sha256");
    const buffer = new Uint8Array(64 * 1024);
    let offset = 0n;
    while (offset < opened.size) {
      const remaining = opened.size - offset;
      const length = Number(remaining < BigInt(buffer.byteLength) ? remaining : BigInt(buffer.byteLength));
      const result = await handle.read(buffer, 0, length, Number(offset));
      if (result.bytesRead < 1 || result.bytesRead > length) return refuse();
      digest.update(buffer.subarray(0, result.bytesRead));
      offset += BigInt(result.bytesRead);
    }
    const descriptorAfter = await handle.stat({ bigint: true });
    const linkedAfter = await nodeFs.lstat(absolutePath, { bigint: true });
    if (
      !exactRegular(descriptorAfter, before) ||
      !exactRegular(linkedAfter, before) ||
      descriptorAfter.size !== opened.size ||
      linkedAfter.size !== opened.size ||
      descriptorAfter.uid !== opened.uid ||
      linkedAfter.uid !== opened.uid ||
      descriptorAfter.mode !== opened.mode ||
      linkedAfter.mode !== opened.mode
    ) return refuse();
    const sha256 = parseLowerHexSha256(digest.digest("hex"));
    if (
      cache !== undefined &&
      before.ctimeNs + RACY_CTIME_MARGIN_NS < readStartedNs &&
      [opened, descriptorAfter, linkedAfter].every((stats) => contentKey(stats) === key)
    ) cache.set(key, sha256);
    return {
      relativePath,
      kind: "regular_file",
      ownerUid: Number(opened.uid),
      mode: fileMode(opened) === 0o600 ? 0o600 : 0o700,
      nlink: 1,
      bytes: uint64(opened.size),
      sha256,
      dev: uint64(opened.dev),
      ino: uint64(opened.ino),
    };
  } catch (error) {
    if (error instanceof BootstrapStateError) throw error;
    return refuse();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function lstatOnlyRegularEntry(
  relativePath: string,
  stats: BigIntStats,
): Extract<BootstrapRetentionDirectoryEntryV1, { kind: "regular_file" }> {
  if (!exactRegular(stats)) return refuse();
  return {
    relativePath,
    kind: "regular_file",
    ownerUid: Number(stats.uid),
    mode: fileMode(stats) === 0o600 ? 0o600 : 0o700,
    nlink: 1,
    bytes: uint64(stats.size),
    sha256: null,
    dev: uint64(stats.dev),
    ino: uint64(stats.ino),
  };
}

/**
 * Runtime state beside retained rows whose shape another rule judges, so a parent walk over
 * `state` neither projects nor refuses it: D52's one symlink (cf. 53794c5, owned by the effective
 * uid as in the absent-manifest walk), and D54's anchor, which the gate admits by shape and which
 * must not wedge the gate when malformed (D54 review, finding 3). Both are exact product-home
 * paths. Only a regular file may stand at the anchor's path; a link of another owner, or either
 * shape nested elsewhere, is projected or refused like any other entry.
 */
function judgedElsewhere(productHome: string, absolutePath: string, stats: BigIntStats): boolean {
  if (absolutePath === `${productHome}/${MANIFEST_ANCHOR_RELATIVE_PATH}`) {
    return stats.isFile() && !stats.isSymbolicLink() ? true : refuse();
  }
  return absolutePath === `${productHome}/${CODEX_INGEST_HOME_RELATIVE_PATH}/${CODEX_INGEST_AUTH_LINK}` &&
    stats.isSymbolicLink() &&
    stats.uid === BigInt(process.geteuid?.() ?? -1);
}

/** At most eight `lstat`s in flight; results keep the order of `paths`. The first failure stops every worker. */
async function lstatBounded(paths: readonly string[]): Promise<BigIntStats[]> {
  const results: BigIntStats[] = [];
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < paths.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await nodeFs.lstat(paths[index] as string, { bigint: true });
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, worker));
  return results;
}

async function walkDirectory(
  productHome: string,
  root: string,
  relativeDirectory: string,
  entries: BootstrapRetentionDirectoryEntryV1[],
  identities: Set<string>,
  expectedDirectory: BigIntStats,
  skipped: Set<string>,
  cache: BootstrapRetentionContentCacheV1 | undefined,
): Promise<void> {
  const absoluteDirectory = relativeDirectory.length === 0 ? root : join(root, relativeDirectory);
  let handle: nodeFs.FileHandle | undefined;
  let closeFailure: unknown;
  try {
    handle = await nodeFs.open(
      absoluteDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const opened = await handle.stat({ bigint: true });
    const linkedBefore = await nodeFs.lstat(absoluteDirectory, { bigint: true });
    if (
      !exactDirectorySnapshot(opened, expectedDirectory) ||
      !exactDirectorySnapshot(linkedBefore, expectedDirectory)
    ) return refuse();
    const namesBefore = sortUtf8(await nodeFs.readdir(absoluteDirectory), (name) => name);
    for (const name of namesBefore) {
      if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\")) return refuse();
    }
    const relativePaths = namesBefore.map((name) => relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`);
    const allStats = await lstatBounded(relativePaths.map((relativePath) => join(root, relativePath)));
    for (const [index, relativePath] of relativePaths.entries()) {
      const absolutePath = join(root, relativePath);
      const stats = allStats[index] as BigIntStats;
      const identity = `${stats.dev.toString()}:${stats.ino.toString()}`;
      if (identities.has(identity) || entries.length >= BOOTSTRAP_RETAINED_MAX_ENTRIES) return refuse();
      identities.add(identity);
      if (judgedElsewhere(productHome, absolutePath, stats)) {
        skipped.add(relativePath);
        continue;
      }
      if (stats.isDirectory() && !stats.isSymbolicLink()) {
        if (!exactDirectory(stats)) return refuse();
        entries.push({
          relativePath,
          kind: "directory",
          ownerUid: Number(stats.uid),
          mode: 0o700,
          nlink: Number(stats.nlink),
          bytes: parseUInt64Decimal("0"),
          sha256: null,
          dev: uint64(stats.dev),
          ino: uint64(stats.ino),
        });
        await walkDirectory(productHome, root, relativePath, entries, identities, stats, skipped, cache);
      } else if (stats.isFile() && !stats.isSymbolicLink()) {
        entries.push(isRedactionKeyPath(absolutePath)
          ? lstatOnlyRegularEntry(relativePath, stats)
          : await projectRegularEntry(absolutePath, relativePath, stats, cache));
      } else {
        return refuse();
      }
    }
    const linkedAfter = await nodeFs.lstat(absoluteDirectory, { bigint: true });
    const descriptorAfter = await handle.stat({ bigint: true });
    const namesAfter = sortUtf8(await nodeFs.readdir(absoluteDirectory), (name) => name);
    if (
      !exactDirectorySnapshot(linkedAfter, expectedDirectory) ||
      !exactDirectorySnapshot(descriptorAfter, expectedDirectory) ||
      !sameNames(namesBefore, namesAfter)
    ) return refuse();
  } catch (error) {
    if (error instanceof BootstrapStateError) throw error;
    return refuse();
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      closeFailure = error;
    }
  }
  if (closeFailure !== undefined) return refuse();
}

/** Exported so tests can inject a counting wrapper via `projectBootstrapRetentionPostimage`'s parameter; production callers rely on the default. */
export async function projectRetainedDirectoryTreeOnce(
  root: CanonicalAbsolutePathV1,
  productHome: CanonicalAbsolutePathV1,
  cache?: BootstrapRetentionContentCacheV1,
): Promise<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> {
  const rootBefore = await nodeFs.lstat(root, { bigint: true }).catch(() => refuse());
  if (!exactDirectory(rootBefore)) return refuse();
  const walked: BootstrapRetentionDirectoryEntryV1[] = [];
  const identities = new Set<string>([`${rootBefore.dev.toString()}:${rootBefore.ino.toString()}`]);
  const skipped = new Set<string>();
  await walkDirectory(productHome, root, "", walked, identities, rootBefore, skipped, cache);
  const entries = sortUtf8(walked, (entry) => entry.relativePath);
  let regularFileBytes = 0n;
  for (const entry of entries) {
    if (entry.kind === "regular_file") {
      regularFileBytes += BigInt(entry.bytes);
      if (regularFileBytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) return refuse();
    }
  }
  const rootAfter = await nodeFs.lstat(root, { bigint: true }).catch(() => refuse());
  if (
    !exactDirectorySnapshot(rootAfter, rootBefore)
  ) return refuse();
  const rootNamesAfter = sortUtf8(
    (await nodeFs.readdir(root).catch(() => refuse())).filter((name) => !skipped.has(name)),
    (name) => name,
  );
  const projectedRootNames = entries
    .filter((entry) => !entry.relativePath.includes("/"))
    .map((entry) => entry.relativePath);
  if (!sameNames(projectedRootNames, rootNamesAfter)) return refuse();
  const projection: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }> = {
    kind: "directory_tree",
    ownerUid: Number(rootAfter.uid),
    mode: 0o700,
    nlink: Number(rootAfter.nlink),
    treeHash: parseLowerHexSha256(createHash("sha256")
      .update("developer-os/bootstrap-retained-tree/v1\0")
      .update(encodeCanonicalJson(entries).slice(0, -1))
      .digest("hex")),
    entryCount: entries.length,
    regularFileBytes: uint64(regularFileBytes),
    dev: uint64(rootAfter.dev),
    ino: uint64(rootAfter.ino),
    entries,
  };
  return projection;
}

/** Exact, no-follow projection shared by evidence construction and retained-row recovery. */
export async function projectBootstrapRetentionPostimage(
  path: CanonicalAbsolutePathV1,
  productHome: CanonicalAbsolutePathV1,
  walkDirectoryTreeOnce: typeof projectRetainedDirectoryTreeOnce = projectRetainedDirectoryTreeOnce,
  cache?: BootstrapRetentionContentCacheV1,
): Promise<BootstrapRetentionPostimageV1 | null> {
  let firstStats: BigIntStats;
  try {
    firstStats = await nodeFs.lstat(path, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return refuse();
  }
  if (firstStats.isDirectory() && !firstStats.isSymbolicLink()) {
    const first = await walkDirectoryTreeOnce(path, productHome, cache);
    const second = await walkDirectoryTreeOnce(path, productHome, cache);
    if (!sameFreshProjection(first, second)) return refuse();
    return second;
  }
  if (!firstStats.isFile() || firstStats.isSymbolicLink() || isRedactionKeyPath(path)) return refuse();
  const firstEntry = await projectRegularEntry(path, "file", firstStats, cache);
  const secondStats = await nodeFs.lstat(path, { bigint: true }).catch(() => refuse());
  const secondEntry = await projectRegularEntry(path, "file", secondStats, cache);
  if (
    firstEntry.relativePath !== "file" ||
    secondEntry.relativePath !== "file" ||
    !sameValue(firstEntry, secondEntry)
  ) return refuse();
  return {
    kind: "regular_file",
    ownerUid: secondEntry.ownerUid,
    mode: secondEntry.mode,
    nlink: secondEntry.nlink,
    bytes: secondEntry.bytes,
    sha256: secondEntry.sha256,
    dev: secondEntry.dev,
    ino: secondEntry.ino,
  };
}

export async function projectRetainedDirectoryTree(
  root: CanonicalAbsolutePathV1,
  expectedRoot: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>,
  productHome: CanonicalAbsolutePathV1,
): Promise<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> {
  if (expectedRoot.entries === undefined) return refuse();
  const first = await projectRetainedDirectoryTreeOnce(root, productHome);
  const second = await projectRetainedDirectoryTreeOnce(root, productHome);
  if (!sameFreshProjection(first, second) || !sameValue(second, expectedRoot)) return refuse();
  return second;
}

export class BootstrapRetainer {
  readonly #dependencies: BootstrapRetainerDependenciesV1;

  constructor(dependencies: BootstrapRetainerDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async observe(entry: BootstrapRetentionEntryV1): Promise<BootstrapRetentionObservationV1> {
    return (await this.observeAll([entry]))[0] as BootstrapRetentionObservationV1;
  }

  /**
   * One observation round: every distinct parent is projected once before and once after all
   * rows' source and tombstone projections, and must not change in between (NEW-133). Only a
   * round with no mutation inside it may hold several rows; the retain loop observes one row at
   * a time, because its renames and journal advances change the parent between rows.
   */
  async observeAll(entries: readonly BootstrapRetentionEntryV1[]): Promise<BootstrapRetentionObservationV1[]> {
    for (const entry of entries) this.#validateEntry(entry);
    const parents = [...new Set(entries.map((entry) => entry.parent.path))];
    const parentsBefore = new Map<string, BootstrapRetentionPostimageV1 | null>();
    for (const parent of parents) parentsBefore.set(parent, await this.#dependencies.projectPostimage(parent));
    const projected: [BootstrapRetentionPostimageV1 | null, BootstrapRetentionPostimageV1 | null][] = [];
    for (const entry of entries) {
      projected.push(await Promise.all([
        this.#dependencies.projectPostimage(entry.sourcePath),
        this.#dependencies.projectPostimage(entry.tombstonePath),
      ]));
    }
    for (const parent of parents) {
      const parentBefore = parentsBefore.get(parent);
      const parentAfter = await this.#dependencies.projectPostimage(parent);
      if (
        parentBefore?.kind !== "directory_tree" ||
        parentAfter?.kind !== "directory_tree" ||
        !sameFreshProjection(parentBefore, parentAfter)
      ) return refuse();
    }
    return entries.map((entry, index) => {
      const parentBefore = parentsBefore.get(entry.parent.path);
      if (parentBefore?.dev !== entry.parent.dev || parentBefore.ino !== entry.parent.ino) return refuse();
      const [source, tombstone] = projected[index] as [BootstrapRetentionPostimageV1 | null, BootstrapRetentionPostimageV1 | null];
      if (source !== null && tombstone === null && sameValue(source, entry.postimage)) {
        return { state: "before", source: structuredClone(source) };
      }
      if (source === null && tombstone !== null && sameValue(tombstone, entry.postimage)) {
        return { state: "after", tombstone: structuredClone(tombstone) };
      }
      return refuse();
    });
  }

  async retain(entry: BootstrapRetentionEntryV1): Promise<void> {
    this.interrupt("before_rename");
    const observation = await this.observe(entry);
    if (observation.state === "before") {
      await this.#dependencies.renameSameParentNoReplace({ entry });
    }
    this.interrupt("after_rename");
    const after = await this.observe(entry);
    if (after.state !== "after") return refuse();
    this.interrupt("after_projection");
    this.interrupt("before_parent_sync");
    await this.#dependencies.syncDirectory(entry.parent.path);
    this.interrupt("after_parent_sync");
  }

  async retainHeldLock(entry: BootstrapRetentionEntryV1, handle: TransactionLockHandle): Promise<void> {
    if (typeof handle.release !== "function") return refuse();
    await this.retain(entry);
  }

  async releaseHeldLock(handle: TransactionLockHandle): Promise<void> {
    if (typeof handle.release !== "function") return refuse();
    this.interrupt("before_lock_release");
    await handle.release();
    this.interrupt("after_lock_release");
  }

  interrupt(point: BootstrapRetentionDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  #validateEntry(entry: BootstrapRetentionEntryV1): void {
    const expectedTombstone = `${dirname(entry.sourcePath)}/.developer-os-retained.${entry.bootstrapId}.${String(entry.ordinal).padStart(10, "0")}.tombstone`;
    if (
      !Number.isSafeInteger(entry.ordinal) ||
      entry.ordinal < 0 ||
      entry.ordinal > 999_999 ||
      dirname(entry.sourcePath) !== entry.parent.path ||
      dirname(entry.tombstonePath) !== entry.parent.path ||
      entry.tombstonePath !== expectedTombstone ||
      entry.sourcePath === entry.tombstonePath ||
      (entry.postimage.kind === "directory_tree" && entry.postimage.entries === undefined)
    ) return refuse();
  }
}

function journalHash(value: BootstrapJournalRecordV1): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256")
    .update(encodeCanonicalJson(value as unknown as CanonicalJsonValue))
    .digest("hex"));
}

function journalSuccessor(
  current: BootstrapJournalRecordV1,
  changes: Partial<BootstrapJournalRecordV1>,
): BootstrapJournalRecordV1 {
  const sequence = BigInt(current.sequence);
  if (sequence >= UINT64_MAX) return refuse();
  const nextSequence = sequence + 1n;
  return {
    ...current,
    ...changes,
    slot: current.slot === 0 ? 1 : 0,
    sequence: parseUInt64Decimal(nextSequence.toString()),
    previousJournalHash: journalHash(current),
  };
}

function validateTable(table: readonly BootstrapRetentionEntryV1[]): void {
  if (table.length < 1 || table.length > BOOTSTRAP_RETAINED_MAX_ENTRIES) return refuse();
  const bootstrapId = table[0]?.bootstrapId;
  const sources = new Set<string>();
  const tombstones = new Set<string>();
  let bootstrapLocks = 0;
  let descendantCount = 0;
  for (const [ordinal, entry] of table.entries()) {
    const expectedTombstone = `${dirname(entry.sourcePath)}/.developer-os-retained.${entry.bootstrapId}.${String(ordinal).padStart(10, "0")}.tombstone`;
    if (
      entry.bootstrapId !== bootstrapId ||
      entry.ordinal !== ordinal ||
      entry.tombstonePath !== expectedTombstone ||
      entry.parent.path !== dirname(entry.sourcePath) ||
      entry.parent.path !== dirname(entry.tombstonePath) ||
      entry.sourcePath.endsWith("/.lifecycle.lock") ||
      sources.has(entry.sourcePath) ||
      tombstones.has(entry.tombstonePath)
    ) return refuse();
    sources.add(entry.sourcePath);
    tombstones.add(entry.tombstonePath);
    if (entry.role === "bootstrap_lock") {
      bootstrapLocks += 1;
      if (ordinal !== table.length - 1) return refuse();
    }
    if (entry.postimage.kind === "directory_tree") {
      if (
        entry.postimage.entries === undefined ||
        entry.postimage.entries.length !== entry.postimage.entryCount
      ) return refuse();
      descendantCount += entry.postimage.entries.length;
      if (descendantCount > BOOTSTRAP_RETAINED_MAX_ENTRIES) return refuse();
    }
  }
  if (
    bootstrapLocks !== 1 ||
    [...sources].some((source) => tombstones.has(source))
  ) return refuse();
}

async function advance(
  store: BootstrapJournalStore,
  current: BootstrapJournalRecordV1,
  changes: Partial<BootstrapJournalRecordV1>,
): Promise<BootstrapJournalRecordV1> {
  const successor = journalSuccessor(current, changes);
  await store.advance(successor);
  const persisted = store.current();
  if (!sameValue(persisted, successor)) return refuse();
  return persisted;
}

export async function retainBootstrapEnvelope(
  table: readonly BootstrapRetentionEntryV1[],
  store: BootstrapJournalStore,
  retainer: BootstrapRetainer,
  locks: HeldBootstrapLocksV1,
): Promise<BootstrapJournalRecordV1> {
  validateTable(table);
  let current = store.current();
  if (locks.bootstrap === null) return refuse();
  /**
   * Spec 1 §2.1 (A12): a plan that admitted a pre-existing lock has no
   * ordinal-zero lock row, and the executor has held that lock since before
   * publication, so "held once the cursor passed ordinal zero" is an invariant
   * only of a plan that creates it.
   */
  const globalLockPath = join(dirname(store.plan.bootstrapIdentity.path), ".lifecycle.lock");
  const admitsGlobalLock = store.plan.admittedPreexistingPaths.some((entry) => entry.path === globalLockPath);
  const globalReached = admitsGlobalLock || current.nextCreatedPath > 0;
  if ((globalReached && locks.global === null) || (!globalReached && locks.global !== null)) {
    return refuse();
  }
  if (current.id !== table[0]?.bootstrapId) return refuse();
  if (current.phase === "finalized" || current.phase === "rolled_back") {
    current = await advance(store, current, {
      phase: "retaining",
      retentionNext: 0,
      retentionTerminalPreimage: {
        previousJournalHash: current.previousJournalHash,
        updatedAt: current.updatedAt,
      },
    });
  }
  if (current.phase !== "retaining" && current.phase !== "retained") return refuse();
  if (
    current.retentionNext === null ||
    !Number.isSafeInteger(current.retentionNext) ||
    current.retentionNext < 0 ||
    current.retentionNext > table.length ||
    (current.phase === "retained" && current.retentionNext !== table.length) ||
    (current.phase === "retaining" && current.retentionNext >= table.length)
  ) return refuse();

  for (const retained of await retainer.observeAll(table.slice(0, current.retentionNext))) {
    if (retained.state !== "after") return refuse();
  }

  let bootstrapReleased = false;
  while (current.phase === "retaining") {
    const ordinal = current.retentionNext as number;
    const entry = table[ordinal];
    if (entry === undefined) return refuse();
    if (entry.role === "bootstrap_lock") {
      await retainer.retainHeldLock(entry, locks.bootstrap);
    } else {
      await retainer.retain(entry);
    }
    retainer.interrupt("before_journal_advance");
    const last = ordinal === table.length - 1;
    current = await advance(store, current, last
      ? { phase: "retained", retentionNext: table.length }
      : { retentionNext: ordinal + 1 });
    retainer.interrupt("after_journal_advance");
    if (entry.role === "bootstrap_lock") {
      await retainer.releaseHeldLock(locks.bootstrap);
      bootstrapReleased = true;
    }
  }

  if (current.phase !== "retained") return refuse();
  for (const retained of await retainer.observeAll(table)) {
    if (retained.state !== "after") return refuse();
  }
  if (!bootstrapReleased) await retainer.releaseHeldLock(locks.bootstrap);
  await locks.global?.release();
  return store.current();
}
