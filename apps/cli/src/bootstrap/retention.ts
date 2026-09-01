import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BOOTSTRAP_RETAINED_MAX_ENTRIES,
  BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES,
  BootstrapStateError,
  encodeCanonicalJson,
  parseLowerHexSha256,
  parseUInt64Decimal,
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

const encoder = new TextEncoder();
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

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const common = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (leftBytes[index] as number) - (rightBytes[index] as number);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
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
): Promise<Extract<BootstrapRetentionDirectoryEntryV1, { kind: "regular_file" }>> {
  if (!exactRegular(before)) return refuse();
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
    return {
      relativePath,
      kind: "regular_file",
      ownerUid: Number(opened.uid),
      mode: fileMode(opened) === 0o600 ? 0o600 : 0o700,
      nlink: 1,
      bytes: uint64(opened.size),
      sha256: parseLowerHexSha256(digest.digest("hex")),
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

async function walkDirectory(
  root: string,
  relativeDirectory: string,
  entries: BootstrapRetentionDirectoryEntryV1[],
  identities: Set<string>,
  expectedDirectory: BigIntStats,
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
    const namesBefore = await nodeFs.readdir(absoluteDirectory);
    namesBefore.sort(compareUtf8);
    for (const name of namesBefore) {
      if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\")) return refuse();
      const relativePath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      const absolutePath = join(root, relativePath);
      const stats = await nodeFs.lstat(absolutePath, { bigint: true });
      const identity = `${stats.dev.toString()}:${stats.ino.toString()}`;
      if (identities.has(identity) || entries.length >= BOOTSTRAP_RETAINED_MAX_ENTRIES) return refuse();
      identities.add(identity);
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
        await walkDirectory(root, relativePath, entries, identities, stats);
      } else if (stats.isFile() && !stats.isSymbolicLink()) {
        entries.push(await projectRegularEntry(absolutePath, relativePath, stats));
      } else {
        return refuse();
      }
    }
    const linkedAfter = await nodeFs.lstat(absoluteDirectory, { bigint: true });
    const descriptorAfter = await handle.stat({ bigint: true });
    const namesAfter = await nodeFs.readdir(absoluteDirectory);
    namesAfter.sort(compareUtf8);
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

async function projectRetainedDirectoryTreeOnce(
  root: CanonicalAbsolutePathV1,
): Promise<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> {
  const rootBefore = await nodeFs.lstat(root, { bigint: true }).catch(() => refuse());
  if (!exactDirectory(rootBefore)) return refuse();
  const entries: BootstrapRetentionDirectoryEntryV1[] = [];
  const identities = new Set<string>([`${rootBefore.dev.toString()}:${rootBefore.ino.toString()}`]);
  await walkDirectory(root, "", entries, identities, rootBefore);
  entries.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
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
  const rootNamesAfter = await nodeFs.readdir(root).catch(() => refuse());
  rootNamesAfter.sort(compareUtf8);
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

export async function projectRetainedDirectoryTree(
  root: CanonicalAbsolutePathV1,
  expectedRoot: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>,
): Promise<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> {
  if (expectedRoot.entries === undefined) return refuse();
  const first = await projectRetainedDirectoryTreeOnce(root);
  const second = await projectRetainedDirectoryTreeOnce(root);
  if (!sameValue(first, second) || !sameValue(second, expectedRoot)) return refuse();
  return structuredClone(second);
}

export class BootstrapRetainer {
  readonly #dependencies: BootstrapRetainerDependenciesV1;

  constructor(dependencies: BootstrapRetainerDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async observe(entry: BootstrapRetentionEntryV1): Promise<BootstrapRetentionObservationV1> {
    this.#validateEntry(entry);
    const parentBefore = await this.#dependencies.projectPostimage(entry.parent.path);
    const [source, tombstone] = await Promise.all([
      this.#dependencies.projectPostimage(entry.sourcePath),
      this.#dependencies.projectPostimage(entry.tombstonePath),
    ]);
    const parentAfter = await this.#dependencies.projectPostimage(entry.parent.path);
    if (
      parentBefore?.kind !== "directory_tree" ||
      parentAfter?.kind !== "directory_tree" ||
      parentBefore.dev !== entry.parent.dev ||
      parentBefore.ino !== entry.parent.ino ||
      !sameValue(parentBefore, parentAfter)
    ) return refuse();
    if (source !== null && tombstone === null && sameValue(source, entry.postimage)) {
      return { state: "before", source: structuredClone(source) };
    }
    if (source === null && tombstone !== null && sameValue(tombstone, entry.postimage)) {
      return { state: "after", tombstone: structuredClone(tombstone) };
    }
    return refuse();
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
  if (locks.bootstrap === null || locks.global === null) return refuse();
  let current = store.current();
  if (current.id !== table[0]?.bootstrapId) return refuse();
  if (current.phase === "finalized" || current.phase === "rolled_back") {
    current = await advance(store, current, { phase: "retaining", retentionNext: 0 });
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

  for (let ordinal = 0; ordinal < current.retentionNext; ordinal += 1) {
    const retained = await retainer.observe(table[ordinal] as BootstrapRetentionEntryV1);
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
  for (const entry of table) {
    const retained = await retainer.observe(entry);
    if (retained.state !== "after") return refuse();
  }
  if (!bootstrapReleased) await retainer.releaseHeldLock(locks.bootstrap);
  await locks.global.release();
  return store.current();
}
