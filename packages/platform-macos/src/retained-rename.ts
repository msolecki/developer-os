import { type ChildProcess, spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  EXIT_CODES,
  type CanonicalAbsolutePathV1,
  type BootstrapRetentionPostimageV1,
  type SameParentRenameNoReplaceV1,
  type UInt64DecimalV1,
} from "@developer-os/core";

const OSASCRIPT = "/usr/bin/osascript";
/**
 * `RENAME_EXCL | RENAME_NOFOLLOW_ANY`, and nothing else.
 *
 * **This was `0x34` until 2026-09-07, and `0x34` is `0x14` plus an undefined
 * bit.** `sys/stdio.h` defines `RENAME_SECLUDE` 0x01, `RENAME_SWAP` 0x02,
 * `RENAME_EXCL` 0x04, `RENAME_RESERVED1` 0x08 and `RENAME_NOFOLLOW_ANY` 0x10.
 * There is no 0x20. The literal carried no comment and no explanation anywhere
 * in this repository, so the likeliest history is a typo for `0x14` that was
 * never caught — because on the machine it was written on, it works.
 *
 * **It does not work on macOS 15, which this product supports**, and the
 * failure is total rather than subtle: `renameatx_np` returns -1 and every
 * retained rename refuses. `MacOsRetainedRename` is constructed on the real CLI
 * path (`apps/cli/src/context.ts`'s `BOOTSTRAP_RETAINED_RENAME`), so this was
 * not a test-only defect.
 *
 * Measured 2026-09-07, same three flag words on both kernels:
 *
 * | flags | Darwin 25.6.0 (dev laptop) | Darwin 24.6.0 (`macos-15` runner) |
 * |---|---|---|
 * | `0x34` | succeeds | **fails, `rc=-1`** |
 * | `0x14` | succeeds | succeeds |
 * | `0x04` | succeeds | succeeds |
 *
 * So a newer kernel silently ignores the stray bit and an older one rejects the
 * whole call. Nothing local could have caught it, which is the point: this was
 * found by the first CI run that ever executed these cases (`BACKLOG.md`
 * NEW-77, run 34157357126). Do not add a bit here without a header definition
 * for it, and note that the guard against a regression is CI on `macos-15` —
 * a developer machine running a newer Darwin will not reproduce it.
 */
const RENAME_FLAGS = 0x14;
const SOURCE_PARENT_FD = 3;
const DESTINATION_PARENT_FD = 4;
const MAX_ORDINAL = 999_999;
const UINT64 = /^(?:0|[1-9][0-9]*)$/u;
const BOOTSTRAP_ID = /^(?:fi|mm)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const RENAME_PROGRAM = String.raw`
ObjC.bindFunction("renameatx_np", [
  "int", ["int", "char*", "int", "char*", "unsigned int"]
]);
const argv = $.NSProcessInfo.processInfo.arguments;
const source = argv.objectAtIndex(5).UTF8String;
const destination = argv.objectAtIndex(6).UTF8String;
const result = $.renameatx_np(${SOURCE_PARENT_FD}, source, ${DESTINATION_PARENT_FD}, destination, 0x${RENAME_FLAGS.toString(16)});
if (result !== 0) throw new Error("renameatx_np refused");
`;

export type RenameSameParentNoReplace = (
  request: SameParentRenameNoReplaceV1,
) => Promise<void>;

export interface ExactRenameParentIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: number;
  readonly mode: 0o700;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ExactNoReplaceRenameRequestV1 {
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly destinationPath: CanonicalAbsolutePathV1;
  readonly sourceParent: ExactRenameParentIdentityV1;
  readonly destinationParent: ExactRenameParentIdentityV1;
  readonly postimage: BootstrapRetentionPostimageV1;
}

export type RenameNoReplace = (
  request: ExactNoReplaceRenameRequestV1,
) => Promise<void>;

export interface RenameAtxRunRequestV1 {
  readonly sourceParentDescriptor?: number;
  readonly destinationParentDescriptor?: number;
  /** Compatibility aliases retained for the row-bound Task 4 adapter tests. */
  readonly parentDescriptor: number;
  readonly sourceName: string;
  readonly destinationName?: string;
  readonly tombstoneName: string;
}

export interface RenameAtxRunResultV1 {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface RenameAtxRunner {
  run(request: RenameAtxRunRequestV1): Promise<RenameAtxRunResultV1>;
}

export interface MacOsRetainedRenameDependencies {
  readonly runner: RenameAtxRunner;
  readonly getUid: () => number;
  readonly openParent: (path: string) => Promise<FileHandle>;
  readonly lstat: typeof lstat;
}

export class MacOsRetainedRenameUnavailableError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;

  constructor() {
    super("retained rename capability is unavailable");
    this.name = "MacOsRetainedRenameUnavailableError";
  }
}

export class MacOsRetainedRenameRefusalError extends Error {
  readonly code = EXIT_CODES.securityRefusal;

  constructor() {
    super("retained rename refused");
    this.name = "MacOsRetainedRenameRefusalError";
  }
}

export class MacOsRetainedRenameThirdStateError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor() {
    super("retained rename state requires recovery");
    this.name = "MacOsRetainedRenameThirdStateError";
  }
}

function waitForRename(child: ChildProcess): Promise<RenameAtxRunResultV1> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function isAsciiBasename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/")) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function hasExactParentMode(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).mode === 0o700;
}

function assertRunnerRequest(request: RenameAtxRunRequestV1): void {
  const sourceParentDescriptor = request.sourceParentDescriptor ?? request.parentDescriptor;
  const destinationParentDescriptor = request.destinationParentDescriptor ?? request.parentDescriptor;
  const destinationName = request.destinationName ?? request.tombstoneName;
  if (
    !Number.isSafeInteger(sourceParentDescriptor) ||
    sourceParentDescriptor < 0 ||
    !Number.isSafeInteger(destinationParentDescriptor) ||
    destinationParentDescriptor < 0 ||
    !isAsciiBasename(request.sourceName) ||
    !isAsciiBasename(destinationName) ||
    request.sourceName === destinationName
  ) {
    throw new MacOsRetainedRenameRefusalError();
  }
}

export class SpawnRenameAtxRunner implements RenameAtxRunner {
  run(request: RenameAtxRunRequestV1): Promise<RenameAtxRunResultV1> {
    assertRunnerRequest(request);
    const sourceParentDescriptor = request.sourceParentDescriptor ?? request.parentDescriptor;
    const destinationParentDescriptor = request.destinationParentDescriptor ?? request.parentDescriptor;
    const destinationName = request.destinationName ?? request.tombstoneName;
    const child = spawn(
      OSASCRIPT,
      ["-l", "JavaScript", "-e", RENAME_PROGRAM, request.sourceName, destinationName],
      {
        shell: false,
        env: {},
        stdio: ["ignore", "ignore", "ignore", sourceParentDescriptor, destinationParentDescriptor],
      },
    );
    return waitForRename(child);
  }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

type Projection = "pre" | "post" | "third";

type RenameAtxSettlement =
  | { readonly status: "fulfilled"; readonly result: RenameAtxRunResultV1 }
  | { readonly status: "rejected" };

const DEFAULT_DEPENDENCIES: Omit<MacOsRetainedRenameDependencies, "runner" | "getUid"> = {
  lstat,
  openParent: (path) => open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ),
};

function toUInt64(value: unknown): bigint | null {
  if (typeof value !== "string" || !UINT64.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed <= 18_446_744_073_709_551_615n ? parsed : null;
  } catch {
    return null;
  }
}

function sameIdentity(stats: Pick<BigIntStats, "dev" | "ino">, identity: FileIdentity): boolean {
  return stats.dev === identity.dev && stats.ino === identity.ino;
}

function trustedExecutable(stats: BigIntStats): boolean {
  return (
    !stats.isSymbolicLink() &&
    stats.isFile() &&
    stats.uid === 0n &&
    (stats.mode & 0o111n) !== 0n &&
    (stats.mode & 0o022n) === 0n
  );
}

function matchesPostimage(stats: BigIntStats, postimage: BootstrapRetentionPostimageV1): boolean {
  const expectedDev = toUInt64(postimage.dev);
  const expectedIno = toUInt64(postimage.ino);
  if (
    expectedDev === null ||
    expectedIno === null ||
    stats.isSymbolicLink() ||
    stats.dev !== expectedDev ||
    stats.ino !== expectedIno ||
    stats.uid !== BigInt(postimage.ownerUid) ||
    (stats.mode & 0o777n) !== BigInt(postimage.mode) ||
    stats.nlink !== BigInt(postimage.nlink)
  ) {
    return false;
  }
  if (postimage.kind === "regular_file") {
    const expectedBytes = toUInt64(postimage.bytes);
    return stats.isFile() && expectedBytes !== null && stats.size === expectedBytes;
  }
  return stats.isDirectory();
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isDomainError(error: unknown): error is
  | MacOsRetainedRenameUnavailableError
  | MacOsRetainedRenameRefusalError
  | MacOsRetainedRenameThirdStateError {
  return (
    error instanceof MacOsRetainedRenameUnavailableError ||
    error instanceof MacOsRetainedRenameRefusalError ||
    error instanceof MacOsRetainedRenameThirdStateError
  );
}

export class MacOsRetainedRename {
  private readonly dependencies: MacOsRetainedRenameDependencies;

  constructor(dependencies: Partial<MacOsRetainedRenameDependencies> = {}) {
    this.dependencies = {
      runner: dependencies.runner ?? new SpawnRenameAtxRunner(),
      getUid: dependencies.getUid ?? (() => {
        if (process.getuid === undefined) throw new MacOsRetainedRenameUnavailableError();
        return process.getuid();
      }),
      openParent: dependencies.openParent ?? DEFAULT_DEPENDENCIES.openParent,
      lstat: dependencies.lstat ?? DEFAULT_DEPENDENCIES.lstat,
    };
  }

  async rename(request: SameParentRenameNoReplaceV1): Promise<void> {
    const names = this.validateRequest(request);
    const uid = this.readUid();
    const parent = {
      path: request.entry.parent.path,
      ownerUid: uid,
      mode: 0o700 as const,
      dev: request.entry.parent.dev,
      ino: request.entry.parent.ino,
    };
    await this.renameValidated({
      sourcePath: request.entry.sourcePath,
      destinationPath: request.entry.tombstonePath,
      sourceParent: parent,
      destinationParent: parent,
      postimage: request.entry.postimage,
    }, { source: names.source, destination: names.tombstone }, uid);
  }

  async renameNoReplace(request: ExactNoReplaceRenameRequestV1): Promise<void> {
    const names = this.validateExactRequest(request);
    const uid = this.readUid();
    if (
      request.sourceParent.ownerUid !== uid ||
      request.destinationParent.ownerUid !== uid
    ) throw new MacOsRetainedRenameRefusalError();
    await this.renameValidated(request, names, uid);
  }

  private async renameValidated(
    request: ExactNoReplaceRenameRequestV1,
    names: { readonly source: string; readonly destination: string },
    uid: number,
  ): Promise<void> {
    const executableIdentity = await this.assertTrustedExecutable();
    const sourceParentIdentity = this.parentIdentity(request.sourceParent);
    const destinationParentIdentity = this.parentIdentity(request.destinationParent);
    let sourceParentHandle: FileHandle | undefined;
    let destinationParentHandle: FileHandle | undefined;

    try {
      await Promise.all([
        this.assertParentPath(request.sourceParent.path, sourceParentIdentity, uid),
        this.assertParentPath(request.destinationParent.path, destinationParentIdentity, uid),
      ]);
      try {
        sourceParentHandle = await this.dependencies.openParent(request.sourceParent.path);
        destinationParentHandle = await this.dependencies.openParent(request.destinationParent.path);
      } catch {
        throw new MacOsRetainedRenameThirdStateError();
      }
      await Promise.all([
        this.assertParentDescriptor(sourceParentHandle, sourceParentIdentity, uid),
        this.assertParentDescriptor(destinationParentHandle, destinationParentIdentity, uid),
      ]);

      const initial = await this.project(request);
      if (initial === "post") {
        await this.assertDestinationDescriptor(request);
        return;
      }
      if (initial !== "pre") throw new MacOsRetainedRenameThirdStateError();

      await Promise.all([
        this.assertParentPath(request.sourceParent.path, sourceParentIdentity, uid),
        this.assertParentPath(request.destinationParent.path, destinationParentIdentity, uid),
        this.assertParentDescriptor(sourceParentHandle, sourceParentIdentity, uid),
        this.assertParentDescriptor(destinationParentHandle, destinationParentIdentity, uid),
      ]);
      if (await this.project(request) !== "pre") {
        throw new MacOsRetainedRenameThirdStateError();
      }

      let childSettlement: Promise<RenameAtxSettlement>;
      try {
        childSettlement = this.dependencies.runner.run({
          sourceParentDescriptor: sourceParentHandle.fd,
          destinationParentDescriptor: destinationParentHandle.fd,
          parentDescriptor: sourceParentHandle.fd,
          sourceName: names.source,
          destinationName: names.destination,
          tombstoneName: names.destination,
        }).then(
          (result): RenameAtxSettlement => ({ status: "fulfilled", result }),
          (): RenameAtxSettlement => ({ status: "rejected" }),
        );
      } catch {
        throw new MacOsRetainedRenameUnavailableError();
      }

      let executableRefusal: MacOsRetainedRenameRefusalError | undefined;
      try {
        await this.assertTrustedExecutable(executableIdentity);
      } catch {
        executableRefusal = new MacOsRetainedRenameRefusalError();
      }

      const settlement = await childSettlement;
      await Promise.all([
        this.assertParentPath(request.sourceParent.path, sourceParentIdentity, uid),
        this.assertParentPath(request.destinationParent.path, destinationParentIdentity, uid),
        this.assertParentDescriptor(sourceParentHandle, sourceParentIdentity, uid),
        this.assertParentDescriptor(destinationParentHandle, destinationParentIdentity, uid),
      ]);
      const projection = await this.project(request);
      if (projection === "third") throw new MacOsRetainedRenameThirdStateError();
      if (executableRefusal !== undefined) throw executableRefusal;
      if (settlement.status === "rejected") {
        if (projection === "post") {
          await this.assertDestinationDescriptor(request);
          return;
        }
        throw new MacOsRetainedRenameUnavailableError();
      }

      const { result } = settlement;
      if (result.signal !== null || result.exitCode === null) {
        if (projection === "post") {
          await this.assertDestinationDescriptor(request);
          return;
        }
        throw new MacOsRetainedRenameUnavailableError();
      }
      if (result.exitCode !== 0) {
        if (projection === "pre") throw new MacOsRetainedRenameRefusalError();
        throw new MacOsRetainedRenameThirdStateError();
      }
      if (projection !== "post") throw new MacOsRetainedRenameThirdStateError();
      await this.assertDestinationDescriptor(request);
    } catch (error) {
      if (isDomainError(error)) throw error;
      throw new MacOsRetainedRenameUnavailableError();
    } finally {
      for (const handle of [destinationParentHandle, sourceParentHandle]) {
        if (handle === undefined) continue;
        try {
          await handle.close();
        } catch {
          // The child has settled. A close failure cannot authorize another mutation.
        }
      }
    }
  }

  private validateRequest(request: SameParentRenameNoReplaceV1): {
    readonly source: string;
    readonly tombstone: string;
  } {
    const entry = request.entry;
    const ordinal = entry.ordinal;
    const parentPath = entry.parent.path;
    if (
      (entry as { readonly schemaVersion: unknown }).schemaVersion !== 1 ||
      !BOOTSTRAP_ID.test(entry.bootstrapId) ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal > MAX_ORDINAL ||
      !isAbsolute(parentPath) ||
      parentPath.includes("\0") ||
      dirname(entry.sourcePath) !== parentPath ||
      dirname(entry.tombstonePath) !== parentPath
    ) {
      throw new MacOsRetainedRenameRefusalError();
    }

    const source = basename(entry.sourcePath);
    const tombstone = basename(entry.tombstonePath);
    const expectedTombstone = `.developer-os-retained.${entry.bootstrapId}.${String(ordinal).padStart(10, "0")}.tombstone`;
    if (
      !isAsciiBasename(source) ||
      !isAsciiBasename(tombstone) ||
      tombstone !== expectedTombstone ||
      join(parentPath, source) !== entry.sourcePath ||
      join(parentPath, tombstone) !== entry.tombstonePath ||
      source === tombstone ||
      toUInt64(entry.parent.dev) === null ||
      toUInt64(entry.parent.ino) === null ||
      toUInt64(entry.postimage.dev) === null ||
      toUInt64(entry.postimage.ino) === null ||
      !Number.isSafeInteger(entry.postimage.ownerUid) ||
      entry.postimage.ownerUid < 0
    ) {
      throw new MacOsRetainedRenameRefusalError();
    }
    return { source, tombstone };
  }

  private validateExactRequest(request: ExactNoReplaceRenameRequestV1): {
    readonly source: string;
    readonly destination: string;
  } {
    const source = basename(request.sourcePath);
    const destination = basename(request.destinationPath);
    if (
      !isAbsolute(request.sourcePath) ||
      !isAbsolute(request.destinationPath) ||
      request.sourcePath.includes("\0") ||
      request.destinationPath.includes("\0") ||
      dirname(request.sourcePath) !== request.sourceParent.path ||
      dirname(request.destinationPath) !== request.destinationParent.path ||
      join(request.sourceParent.path, source) !== request.sourcePath ||
      join(request.destinationParent.path, destination) !== request.destinationPath ||
      !isAsciiBasename(source) ||
      !isAsciiBasename(destination) ||
      (request.sourceParent.path === request.destinationParent.path && source === destination) ||
      !hasExactParentMode(request.sourceParent) ||
      !hasExactParentMode(request.destinationParent) ||
      !Number.isSafeInteger(request.sourceParent.ownerUid) ||
      request.sourceParent.ownerUid < 0 ||
      !Number.isSafeInteger(request.destinationParent.ownerUid) ||
      request.destinationParent.ownerUid < 0 ||
      toUInt64(request.sourceParent.dev) === null ||
      toUInt64(request.sourceParent.ino) === null ||
      toUInt64(request.destinationParent.dev) === null ||
      toUInt64(request.destinationParent.ino) === null ||
      toUInt64(request.postimage.dev) === null ||
      toUInt64(request.postimage.ino) === null ||
      !Number.isSafeInteger(request.postimage.ownerUid) ||
      request.postimage.ownerUid < 0
    ) throw new MacOsRetainedRenameRefusalError();
    return { source, destination };
  }

  private readUid(): number {
    try {
      const uid = this.dependencies.getUid();
      if (!Number.isSafeInteger(uid) || uid < 0) throw new MacOsRetainedRenameUnavailableError();
      return uid;
    } catch (error) {
      if (error instanceof MacOsRetainedRenameUnavailableError) throw error;
      throw new MacOsRetainedRenameUnavailableError();
    }
  }

  private parentIdentity(parent: ExactRenameParentIdentityV1): FileIdentity {
    const dev = toUInt64(parent.dev);
    const ino = toUInt64(parent.ino);
    if (dev === null || ino === null) throw new MacOsRetainedRenameRefusalError();
    return { dev, ino };
  }

  private async assertTrustedExecutable(expected?: FileIdentity): Promise<FileIdentity> {
    let stats: BigIntStats;
    try {
      stats = await this.dependencies.lstat(OSASCRIPT, { bigint: true });
    } catch {
      throw new MacOsRetainedRenameUnavailableError();
    }
    if (!trustedExecutable(stats) || (expected !== undefined && !sameIdentity(stats, expected))) {
      throw new MacOsRetainedRenameRefusalError();
    }
    return { dev: stats.dev, ino: stats.ino };
  }

  private async assertParentPath(path: string, identity: FileIdentity, uid: number): Promise<void> {
    let stats: BigIntStats;
    try {
      stats = await this.dependencies.lstat(path, { bigint: true });
    } catch {
      throw new MacOsRetainedRenameThirdStateError();
    }
    if (!this.matchesParent(stats, identity, uid)) throw new MacOsRetainedRenameThirdStateError();
  }

  private async assertParentDescriptor(handle: FileHandle, identity: FileIdentity, uid: number): Promise<void> {
    let stats: BigIntStats;
    try {
      stats = await handle.stat({ bigint: true });
    } catch {
      throw new MacOsRetainedRenameUnavailableError();
    }
    if (!this.matchesParent(stats, identity, uid)) throw new MacOsRetainedRenameThirdStateError();
  }

  private matchesParent(stats: BigIntStats, identity: FileIdentity, uid: number): boolean {
    return (
      !stats.isSymbolicLink() &&
      stats.isDirectory() &&
      sameIdentity(stats, identity) &&
      stats.uid === BigInt(uid) &&
      (stats.mode & 0o777n) === 0o700n
    );
  }

  private async observe(path: string): Promise<BigIntStats | null> {
    try {
      return await this.dependencies.lstat(path, { bigint: true });
    } catch (error) {
      if (isMissing(error)) return null;
      throw new MacOsRetainedRenameUnavailableError();
    }
  }

  private async project(request: ExactNoReplaceRenameRequestV1): Promise<Projection> {
    const [source, destination] = await Promise.all([
      this.observe(request.sourcePath),
      this.observe(request.destinationPath),
    ]);
    const sourceMatches = source !== null && matchesPostimage(source, request.postimage);
    const destinationMatches = destination !== null && matchesPostimage(destination, request.postimage);
    if (sourceMatches && destination === null) return "pre";
    if (source === null && destinationMatches) return "post";
    return "third";
  }

  private async assertDestinationDescriptor(request: ExactNoReplaceRenameRequestV1): Promise<void> {
    let handle: FileHandle | undefined;
    let failure:
      | MacOsRetainedRenameUnavailableError
      | MacOsRetainedRenameRefusalError
      | MacOsRetainedRenameThirdStateError
      | undefined;
    try {
      const flags = constants.O_RDONLY |
        constants.O_NONBLOCK |
        constants.O_NOFOLLOW |
        (request.postimage.kind === "directory_tree" ? constants.O_DIRECTORY : 0);
      try {
        handle = await open(request.destinationPath, flags);
      } catch {
        if (await this.project(request) !== "post") {
          throw new MacOsRetainedRenameThirdStateError();
        }
        throw new MacOsRetainedRenameUnavailableError();
      }

      let stats: BigIntStats;
      try {
        stats = await handle.stat({ bigint: true });
      } catch {
        throw new MacOsRetainedRenameUnavailableError();
      }
      if (!matchesPostimage(stats, request.postimage)) {
        throw new MacOsRetainedRenameThirdStateError();
      }
    } catch (error) {
      failure = isDomainError(error)
        ? error
        : new MacOsRetainedRenameUnavailableError();
    }
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        failure ??= new MacOsRetainedRenameUnavailableError();
      }
    }
    if (failure !== undefined) throw failure;
  }
}
