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
  type BootstrapRetentionPostimageV1,
  type SameParentRenameNoReplaceV1,
} from "@developer-os/core";

const OSASCRIPT = "/usr/bin/osascript";
const RENAME_FLAGS = 0x34;
const PARENT_FD = 3;
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
const result = $.renameatx_np(${PARENT_FD}, source, ${PARENT_FD}, destination, 0x${RENAME_FLAGS.toString(16)});
if (result !== 0) throw new Error("renameatx_np refused");
`;

export type RenameSameParentNoReplace = (
  request: SameParentRenameNoReplaceV1,
) => Promise<void>;

export interface RenameAtxRunRequestV1 {
  readonly parentDescriptor: number;
  readonly sourceName: string;
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

function isRetainedBasename(value: string): boolean {
  return /^\.developer-os-retained\.(?:fi|mm)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9]{10}\.tombstone$/u.test(value);
}

function assertRunnerRequest(request: RenameAtxRunRequestV1): void {
  if (
    !Number.isSafeInteger(request.parentDescriptor) ||
    request.parentDescriptor < 0 ||
    !isAsciiBasename(request.sourceName) ||
    !isAsciiBasename(request.tombstoneName) ||
    !isRetainedBasename(request.tombstoneName) ||
    request.sourceName === request.tombstoneName
  ) {
    throw new MacOsRetainedRenameRefusalError();
  }
}

export class SpawnRenameAtxRunner implements RenameAtxRunner {
  run(request: RenameAtxRunRequestV1): Promise<RenameAtxRunResultV1> {
    assertRunnerRequest(request);
    const child = spawn(
      OSASCRIPT,
      ["-l", "JavaScript", "-e", RENAME_PROGRAM, request.sourceName, request.tombstoneName],
      {
        shell: false,
        env: {},
        stdio: ["ignore", "ignore", "ignore", request.parentDescriptor],
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
    const executableIdentity = await this.assertTrustedExecutable();
    const uid = this.readUid();
    const parentIdentity = this.parentIdentity(request);
    let parentHandle: FileHandle | undefined;

    try {
      await this.assertParentPath(request.entry.parent.path, parentIdentity, uid);
      try {
        parentHandle = await this.dependencies.openParent(request.entry.parent.path);
      } catch {
        throw new MacOsRetainedRenameThirdStateError();
      }
      await this.assertParentDescriptor(parentHandle, parentIdentity, uid);

      const initial = await this.project(request);
      if (initial === "post") {
        await this.assertDestinationDescriptor(request);
        return;
      }
      if (initial !== "pre") throw new MacOsRetainedRenameThirdStateError();

      await this.assertParentDescriptor(parentHandle, parentIdentity, uid);
      if (await this.project(request) !== "pre") {
        throw new MacOsRetainedRenameThirdStateError();
      }

      let childSettlement: Promise<RenameAtxSettlement>;
      try {
        childSettlement = this.dependencies.runner.run({
          parentDescriptor: parentHandle.fd,
          sourceName: names.source,
          tombstoneName: names.tombstone,
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
      if (parentHandle !== undefined) {
        try {
          await parentHandle.close();
        } catch {
          // The child has exited before this close. A close failure cannot authorize another mutation.
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

  private parentIdentity(request: SameParentRenameNoReplaceV1): FileIdentity {
    const dev = toUInt64(request.entry.parent.dev);
    const ino = toUInt64(request.entry.parent.ino);
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

  private async project(request: SameParentRenameNoReplaceV1): Promise<Projection> {
    const [source, destination] = await Promise.all([
      this.observe(request.entry.sourcePath),
      this.observe(request.entry.tombstonePath),
    ]);
    const sourceMatches = source !== null && matchesPostimage(source, request.entry.postimage);
    const destinationMatches = destination !== null && matchesPostimage(destination, request.entry.postimage);
    if (sourceMatches && destination === null) return "pre";
    if (source === null && destinationMatches) return "post";
    return "third";
  }

  private async assertDestinationDescriptor(request: SameParentRenameNoReplaceV1): Promise<void> {
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
        (request.entry.postimage.kind === "directory_tree" ? constants.O_DIRECTORY : 0);
      try {
        handle = await open(request.entry.tombstonePath, flags);
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
      if (!matchesPostimage(stats, request.entry.postimage)) {
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
