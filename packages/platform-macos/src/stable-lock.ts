import { constants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  LIFECYCLE_LOCK_RETRY_MS,
  LifecycleLockBusyError,
  LifecycleLockMissingError,
  LifecycleLockShapeError,
  LifecycleLockUnavailableError,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type HeldLifecycleStableLockV1,
  type LifecycleLockDeadlineV1,
  type LifecycleStableLockProviderV1,
} from "@developer-os/core";

import {
  EX_TEMPFAIL,
  SpawnLockfRunner,
  type LockfRunner,
} from "./transaction-lock.js";

/** `O_NOFOLLOW` guards the final component only; an ancestor swap is out of scope because it needs the same uid inside a `0700` home, so this provider deliberately has no parent guard. */
const OPEN_FLAGS = constants.O_RDWR | constants.O_NOFOLLOW;
const LOCK_MODE = 0o600;

export interface MacOsStableLockFileSystem {
  lstat(path: string): Promise<Stats>;
  open(path: string, flags: number): Promise<FileHandle>;
}

export interface MacOsStableLockDependencies {
  readonly fs: MacOsStableLockFileSystem;
  readonly runner: LockfRunner;
  readonly getUid: () => number;
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

const NODE_FILE_SYSTEM: MacOsStableLockFileSystem = { lstat, open };

function effectiveUid(): number {
  if (process.getuid === undefined) throw new Error("effective uid is unavailable");
  return process.getuid();
}

function isAbsent(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function refuse(path: string, error: unknown): never {
  if (
    error instanceof LifecycleLockBusyError ||
    error instanceof LifecycleLockMissingError ||
    error instanceof LifecycleLockShapeError ||
    error instanceof LifecycleLockUnavailableError
  ) {
    throw error;
  }
  if (isAbsent(error)) throw new LifecycleLockMissingError(path);
  throw new LifecycleLockShapeError(path);
}

async function releaseHeld(
  locks: readonly HeldLifecycleStableLockV1[],
): Promise<void> {
  for (const lock of [...locks].reverse()) {
    await lock.release().catch(() => undefined);
  }
}

export class MacOsStableLockProvider implements LifecycleStableLockProviderV1 {
  private readonly dependencies: MacOsStableLockDependencies;

  constructor(dependencies: Partial<MacOsStableLockDependencies> = {}) {
    this.dependencies = {
      fs: dependencies.fs ?? NODE_FILE_SYSTEM,
      runner: dependencies.runner ?? new SpawnLockfRunner(),
      getUid: dependencies.getUid ?? effectiveUid,
    };
  }

  async acquireExisting(
    path: CanonicalAbsolutePathV1,
  ): Promise<HeldLifecycleStableLockV1> {
    let handle: FileHandle | undefined;
    try {
      if (!isAbsolute(path) || path.includes("\0")) {
        throw new LifecycleLockShapeError(path);
      }
      const uid = this.dependencies.getUid();
      const identity = requireStableLockShape(
        await this.dependencies.fs.lstat(path),
        path,
        uid,
      );
      handle = await this.dependencies.fs.open(path, OPEN_FLAGS);
      requireStableLockShape(await handle.stat(), path, uid, identity);

      const result = await this.dependencies.runner.acquire(handle.fd);
      if (result.exitCode === EX_TEMPFAIL && result.signal === null) {
        throw new LifecycleLockBusyError(path);
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new LifecycleLockUnavailableError(path);
      }

      requireStableLockShape(await handle.stat(), path, uid, identity);
      requireStableLockShape(
        await this.dependencies.fs.lstat(path),
        path,
        uid,
        identity,
      );

      const acquired = handle;
      handle = undefined;
      let released = false;
      return {
        path,
        dev: parseUInt64Decimal(String(identity.dev)),
        ino: parseUInt64Decimal(String(identity.ino)),
        release: async (): Promise<void> => {
          if (released) return;
          released = true;
          await acquired.close();
        },
      };
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined);
      refuse(path, error);
    }
  }

  async acquireExistingWithin(
    paths: readonly CanonicalAbsolutePathV1[],
    deadline: LifecycleLockDeadlineV1,
  ): Promise<readonly HeldLifecycleStableLockV1[]> {
    const held: HeldLifecycleStableLockV1[] = [];
    for (const path of paths) {
      try {
        held.push(await this.acquireBeforeDeadline(path, deadline));
      } catch (error) {
        await releaseHeld(held);
        throw error;
      }
    }
    return held;
  }

  private async acquireBeforeDeadline(
    path: CanonicalAbsolutePathV1,
    deadline: LifecycleLockDeadlineV1,
  ): Promise<HeldLifecycleStableLockV1> {
    for (;;) {
      try {
        return await this.acquireExisting(path);
      } catch (error) {
        if (
          !(error instanceof LifecycleLockBusyError) ||
          deadline.nowMs() >= deadline.deadlineMs
        ) {
          throw error;
        }
        await deadline.sleepMs(LIFECYCLE_LOCK_RETRY_MS);
      }
    }
  }
}

function requireStableLockShape(
  stats: Stats,
  path: string,
  uid: number,
  expected?: FileIdentity,
): FileIdentity {
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.uid !== uid ||
    (stats.mode & 0o777) !== LOCK_MODE ||
    stats.nlink !== 1 ||
    stats.size !== 0
  ) {
    throw new LifecycleLockShapeError(path);
  }
  if (
    expected !== undefined &&
    (stats.dev !== expected.dev || stats.ino !== expected.ino)
  ) {
    throw new LifecycleLockShapeError(path);
  }
  return { dev: stats.dev, ino: stats.ino };
}
