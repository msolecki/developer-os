/**
 * Spec 1 §2.4's guarded filesystem port. Every method takes or returns a
 * reopened `LifecycleGuardedEntryV1` rather than a path, because the protocols
 * above it — the allocator's atomic rewrite, the closure ledger, terminal
 * compaction — are specified in terms of a device/inode identity that must hold
 * across the whole sequence, and a path is not that identity. A mutation whose
 * recorded identity no longer matches what is on disk is a third state: this
 * port refuses it and preserves what it found.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import { EXIT_CODES } from "../result.js";
import type { PublishBootstrapInitialJournalNoReplace } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type UInt64DecimalV1,
} from "../update/scalars.js";

export type LifecycleGuardedKindV1 = "regular_file" | "directory" | "symlink" | "other";

export interface LifecycleGuardedEntryV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly kind: LifecycleGuardedKindV1;
  readonly ownerUid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: UInt64DecimalV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

/**
 * §2.4: a changed final/directory identity, a wrong type/owner/mode/link/size
 * and every identity third state are recovery-required and preserved — never a
 * security verdict, because a caller branching on 5 versus 6 must be able to
 * resume the same operation after a transient interruption (`locks.ts`
 * `LifecycleLockUnavailableError` sets the same precedent).
 */
export class LifecycleRecoveryRequiredError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  readonly reason: SafeReasonCodeV1;
  readonly paths: readonly string[];

  constructor(reason: string, paths: readonly string[]) {
    super(`lifecycle recovery required: ${reason}`);
    this.name = "LifecycleRecoveryRequiredError";
    this.reason = parseSafeReasonCode(reason);
    this.paths = [...paths];
  }
}

export function refuseLifecycleRecovery(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

/**
 * Directory link counts and sizes are filesystem bookkeeping, not identity: on
 * APFS a directory's `nlink` rises with each subdirectory and its `size` with
 * each entry, so comparing them would refuse the allocator's own temp create.
 */
export function sameLifecycleGuardedIdentity(
  observed: LifecycleGuardedEntryV1 | null,
  expected: LifecycleGuardedEntryV1,
): boolean {
  if (observed === null) return false;
  if (
    observed.path !== expected.path ||
    observed.kind !== expected.kind ||
    observed.ownerUid !== expected.ownerUid ||
    observed.mode !== expected.mode ||
    observed.dev !== expected.dev ||
    observed.ino !== expected.ino
  ) {
    return false;
  }
  return expected.kind === "directory" || (observed.nlink === expected.nlink && observed.size === expected.size);
}

export function lifecycleParentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  const boundary = path.lastIndexOf("/");
  if (boundary < 1) refuseLifecycleRecovery("lifecycle_guarded_parent", path);
  return parseCanonicalAbsolutePathText(path.slice(0, boundary));
}

export interface LifecycleGuardedFileSystemV1 {
  lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null>;
  readRegular(entry: LifecycleGuardedEntryV1, maximumBytes: number): Promise<Uint8Array>;
  hashRegular(entry: LifecycleGuardedEntryV1, maximumBytes: bigint): Promise<LowerHexSha256>;
  names(directory: LifecycleGuardedEntryV1): AsyncIterable<string>;
  writeExclusive(path: CanonicalAbsolutePathV1, bytes: Uint8Array): Promise<LifecycleGuardedEntryV1>;
  mkdirExclusive(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1>;
  renameOver(source: LifecycleGuardedEntryV1, destination: LifecycleGuardedEntryV1): Promise<void>;
  renameNoReplace(
    source: LifecycleGuardedEntryV1,
    destinationPath: CanonicalAbsolutePathV1,
  ): Promise<void>;
  unlinkExact(entry: LifecycleGuardedEntryV1): Promise<void>;
  rmdirExactEmpty(entry: LifecycleGuardedEntryV1): Promise<void>;
  syncDirectory(entry: LifecycleGuardedEntryV1): Promise<void>;
}

export const LIFECYCLE_HASH_CHUNK_BYTES = 1_048_576;

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW;

function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function kindOf(stats: BigIntStats): LifecycleGuardedKindV1 {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "regular_file";
  return "other";
}

function entryOf(path: CanonicalAbsolutePathV1, stats: BigIntStats): LifecycleGuardedEntryV1 {
  return {
    path,
    kind: kindOf(stats),
    ownerUid: Number(stats.uid),
    mode: Number(stats.mode & 0o777n),
    nlink: Number(stats.nlink),
    size: parseUInt64Decimal(stats.size.toString(10)),
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
  };
}

export function createNodeLifecycleGuardedFileSystem(dependencies: {
  readonly renameNoReplace: PublishBootstrapInitialJournalNoReplace;
  readonly effectiveUid: number;
}): LifecycleGuardedFileSystemV1 {
  /**
   * `bigint: true` is not a preference. An APFS inode number exceeds 2^53 —
   * `/tmp` reported 1152921500312571551 on 2026-09-18 — so `Stats.ino` as a
   * JavaScript number silently rounds (…571500 there) and two distinct inodes
   * can compare equal. Every identity this port records is exact.
   */
  async function lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null> {
    try {
      return entryOf(path, await nodeFs.lstat(path, { bigint: true }));
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
      throw error;
    }
  }

  async function reopen(entry: LifecycleGuardedEntryV1): Promise<LifecycleGuardedEntryV1> {
    const observed = await lstat(entry.path);
    if (!sameLifecycleGuardedIdentity(observed, entry)) {
      refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
    }
    return entry;
  }

  async function openGuarded(
    entry: LifecycleGuardedEntryV1,
    flags: number,
  ): Promise<FileHandle> {
    let handle: FileHandle;
    try {
      handle = await nodeFs.open(entry.path, flags);
    } catch {
      return refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
    }
    try {
      const opened = entryOf(entry.path, await handle.stat({ bigint: true }));
      if (!sameLifecycleGuardedIdentity(opened, entry)) {
        refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
    return handle;
  }

  function requireOwnedRegular(entry: LifecycleGuardedEntryV1): void {
    if (entry.kind !== "regular_file") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
    if (entry.ownerUid !== dependencies.effectiveUid) {
      refuseLifecycleRecovery("lifecycle_guarded_owner", entry.path);
    }
  }

  async function readRegular(
    entry: LifecycleGuardedEntryV1,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    requireOwnedRegular(entry);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new Error("maximumBytes must be a non-negative safe integer");
    }
    if (BigInt(entry.size) > BigInt(maximumBytes)) {
      refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
    }
    const handle = await openGuarded(entry, READ_FLAGS);
    try {
      const bytes = new Uint8Array(await handle.readFile());
      if (bytes.byteLength.toString(10) !== entry.size) {
        refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
      }
      const after = entryOf(entry.path, await handle.stat({ bigint: true }));
      if (!sameLifecycleGuardedIdentity(after, entry)) {
        refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async function hashRegular(
    entry: LifecycleGuardedEntryV1,
    maximumBytes: bigint,
  ): Promise<LowerHexSha256> {
    requireOwnedRegular(entry);
    if (BigInt(entry.size) > maximumBytes) {
      refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
    }
    const handle = await openGuarded(entry, READ_FLAGS);
    try {
      const digest = createHash("sha256");
      const chunk = Buffer.allocUnsafe(LIFECYCLE_HASH_CHUNK_BYTES);
      let total = 0n;
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, LIFECYCLE_HASH_CHUNK_BYTES, null);
        if (bytesRead === 0) break;
        total += BigInt(bytesRead);
        if (total > maximumBytes) refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
        digest.update(chunk.subarray(0, bytesRead));
      }
      if (total.toString(10) !== entry.size) {
        refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
      }
      const after = entryOf(entry.path, await handle.stat({ bigint: true }));
      if (!sameLifecycleGuardedIdentity(after, entry)) {
        refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
      }
      return parseLowerHexSha256(digest.digest("hex"));
    } finally {
      await handle.close();
    }
  }

  async function* streamNames(directory: LifecycleGuardedEntryV1): AsyncGenerator<string> {
    if (directory.kind !== "directory") {
      refuseLifecycleRecovery("lifecycle_guarded_kind", directory.path);
    }
    await reopen(directory);
    const opened = await nodeFs.opendir(directory.path);
    try {
      for await (const child of opened) yield child.name;
    } finally {
      await opened.close().catch(() => undefined);
    }
    await reopen(directory);
  }

  async function writeExclusive(
    path: CanonicalAbsolutePathV1,
    bytes: Uint8Array,
  ): Promise<LifecycleGuardedEntryV1> {
    let handle: FileHandle;
    try {
      handle = await nodeFs.open(path, CREATE_FLAGS, 0o600);
    } catch (error) {
      if (errorCode(error) === "EEXIST" || errorCode(error) === "ELOOP") {
        refuseLifecycleRecovery("lifecycle_guarded_path_exists", path);
      }
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      const created = entryOf(path, await handle.stat({ bigint: true }));
      if (
        created.kind !== "regular_file" ||
        created.ownerUid !== dependencies.effectiveUid ||
        created.mode !== 0o600 ||
        created.nlink !== 1 ||
        created.size !== bytes.byteLength.toString(10)
      ) {
        refuseLifecycleRecovery("lifecycle_guarded_postimage", path);
      }
      return created;
    } finally {
      await handle.close();
    }
  }

  async function mkdirExclusive(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    try {
      await nodeFs.mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        refuseLifecycleRecovery("lifecycle_guarded_path_exists", path);
      }
      throw error;
    }
    const created = await lstat(path);
    if (
      created === null ||
      created.kind !== "directory" ||
      created.ownerUid !== dependencies.effectiveUid ||
      created.mode !== 0o700
    ) {
      refuseLifecycleRecovery("lifecycle_guarded_postimage", path);
    }
    return created;
  }

  async function ownedParent(path: CanonicalAbsolutePathV1): Promise<{
    readonly path: CanonicalAbsolutePathV1;
    readonly ownerUid: number;
    readonly mode: 0o700;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  }> {
    const parentPath = lifecycleParentPath(path);
    const parent = await lstat(parentPath);
    if (
      parent === null ||
      parent.kind !== "directory" ||
      parent.ownerUid !== dependencies.effectiveUid ||
      parent.mode !== 0o700
    ) {
      refuseLifecycleRecovery("lifecycle_guarded_parent", parentPath);
    }
    return { path: parentPath, ownerUid: parent.ownerUid, mode: 0o700, dev: parent.dev, ino: parent.ino };
  }

  async function renameOver(
    source: LifecycleGuardedEntryV1,
    destination: LifecycleGuardedEntryV1,
  ): Promise<void> {
    if (lifecycleParentPath(source.path) !== lifecycleParentPath(destination.path)) {
      refuseLifecycleRecovery("lifecycle_guarded_parent", source.path, destination.path);
    }
    await reopen(source);
    await reopen(destination);
    await nodeFs.rename(source.path, destination.path);
  }

  async function renameNoReplace(
    source: LifecycleGuardedEntryV1,
    destinationPath: CanonicalAbsolutePathV1,
  ): Promise<void> {
    requireOwnedRegular(source);
    if (source.nlink !== 1 || (source.mode !== 0o600 && source.mode !== 0o700)) {
      refuseLifecycleRecovery("lifecycle_guarded_postimage", source.path);
    }
    await reopen(source);
    if ((await lstat(destinationPath)) !== null) {
      refuseLifecycleRecovery("lifecycle_guarded_path_exists", destinationPath);
    }
    const sha256 = await hashRegular(source, BigInt(source.size));
    await dependencies.renameNoReplace({
      sourcePath: source.path,
      destinationPath,
      sourceParent: await ownedParent(source.path),
      destinationParent: await ownedParent(destinationPath),
      postimage: {
        kind: "regular_file",
        ownerUid: source.ownerUid,
        mode: source.mode === 0o700 ? 0o700 : 0o600,
        nlink: 1,
        bytes: source.size,
        sha256,
        dev: source.dev,
        ino: source.ino,
      },
    });
  }

  /**
   * There is no `funlinkat` in Node, so an inode cannot be removed through the
   * descriptor that proved its identity. Reopening immediately before the
   * `unlink` is the strongest guard available; the window it leaves needs the
   * same uid inside a 0700 home to exploit.
   */
  async function unlinkExact(entry: LifecycleGuardedEntryV1): Promise<void> {
    if (entry.kind === "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
    await reopen(entry);
    await nodeFs.unlink(entry.path);
  }

  async function rmdirExactEmpty(entry: LifecycleGuardedEntryV1): Promise<void> {
    if (entry.kind !== "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
    await reopen(entry);
    for await (const name of streamNames(entry)) {
      refuseLifecycleRecovery("lifecycle_guarded_not_empty", `${entry.path}/${name}`);
    }
    await nodeFs.rmdir(entry.path);
  }

  async function syncDirectory(entry: LifecycleGuardedEntryV1): Promise<void> {
    if (entry.kind !== "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
    await reopen(entry);
    const handle = await openGuarded(entry, DIRECTORY_FLAGS);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await reopen(entry);
  }

  return {
    lstat,
    readRegular,
    hashRegular,
    names: (directory) => streamNames(directory),
    writeExclusive,
    mkdirExclusive,
    renameOver,
    renameNoReplace,
    unlinkExact,
    rmdirExactEmpty,
    syncDirectory,
  };
}
