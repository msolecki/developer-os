import { type ChildProcess, spawn } from "node:child_process";
import { constants, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import type {
  TransactionLockHandle,
  TransactionLockProvider,
} from "@developer-os/core";

const LOCKF_PATH = "/usr/bin/lockf";
const CHILD_LOCK_FD = 3;
const EX_TEMPFAIL = 75;

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

export interface MacOsTransactionLockFileSystem {
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<unknown>;
  chmod(path: string, mode: number): Promise<void>;
  lstat(path: string): Promise<Stats>;
  open(path: string, flags: number, mode: number): Promise<FileHandle>;
}

export interface LockfResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface LockfRunner {
  acquire(descriptor: number): Promise<LockfResult>;
}

export interface MacOsTransactionLockDependencies {
  readonly fs: MacOsTransactionLockFileSystem;
  readonly runner: LockfRunner;
  readonly getUid: () => number;
}

const NODE_FILE_SYSTEM: MacOsTransactionLockFileSystem = {
  mkdir,
  chmod,
  lstat,
  open,
};

export class MacOsTransactionLockUnavailableError extends Error {
  constructor() {
    super("transaction lock is unavailable");
    this.name = "MacOsTransactionLockUnavailableError";
  }
}

export class MacOsTransactionLockOperationalError extends Error {
  constructor() {
    super("transaction lock operation failed");
    this.name = "MacOsTransactionLockOperationalError";
  }
}

function waitForLockf(child: ChildProcess): Promise<LockfResult> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

export class SpawnLockfRunner implements LockfRunner {
  async acquire(descriptor: number): Promise<LockfResult> {
    const child = spawn(
      LOCKF_PATH,
      ["-s", "-t", "0", String(CHILD_LOCK_FD)],
      {
        shell: false,
        stdio: ["ignore", "ignore", "ignore", descriptor],
      },
    );
    return waitForLockf(child);
  }
}

export class MacOsTransactionLockProvider
  implements TransactionLockProvider
{
  private readonly dependencies: MacOsTransactionLockDependencies;

  constructor(
    dependencies: Partial<MacOsTransactionLockDependencies> = {},
  ) {
    this.dependencies = {
      fs: dependencies.fs ?? NODE_FILE_SYSTEM,
      runner: dependencies.runner ?? new SpawnLockfRunner(),
      getUid:
        dependencies.getUid ??
        (() => {
          if (process.getuid === undefined) {
            throw new MacOsTransactionLockOperationalError();
          }
          return process.getuid();
        }),
    };
  }

  async acquire(path: string): Promise<TransactionLockHandle> {
    if (!isAbsolute(path) || path.includes("\0")) {
      throw new MacOsTransactionLockOperationalError();
    }

    let handle: FileHandle | undefined;
    try {
      const uid = this.dependencies.getUid();
      const parentPath = dirname(path);
      const parentIdentity = await this.ensureOwnerOnlyParent(parentPath, uid);
      handle = await this.dependencies.fs.open(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      const descriptorBefore = await handle.stat();
      if (!descriptorBefore.isFile() || descriptorBefore.uid !== uid) {
        throw new MacOsTransactionLockOperationalError();
      }
      await handle.chmod(0o600);
      const descriptorStats = await handle.stat();
      if (
        !descriptorStats.isFile() ||
        !this.hasIdentity(descriptorStats, descriptorBefore) ||
        descriptorStats.uid !== uid ||
        (descriptorStats.mode & 0o777) !== 0o600
      ) {
        throw new MacOsTransactionLockOperationalError();
      }
      await this.assertOwnerOnlyParent(parentPath, parentIdentity, uid);
      await this.assertStableLockFile(path, handle, descriptorStats, uid);

      const result = await this.dependencies.runner.acquire(handle.fd);
      await this.assertOwnerOnlyParent(parentPath, parentIdentity, uid);
      await this.assertStableLockFile(path, handle, descriptorStats, uid);
      if (result.exitCode === EX_TEMPFAIL && result.signal === null) {
        throw new MacOsTransactionLockUnavailableError();
      }
      if (result.exitCode !== 0 || result.signal !== null) {
        throw new MacOsTransactionLockOperationalError();
      }

      const retainedHandle = handle;
      handle = undefined;
      let released = false;
      return {
        release: async (): Promise<void> => {
          if (released) {
            throw new MacOsTransactionLockOperationalError();
          }
          released = true;
          try {
            await retainedHandle.close();
          } catch {
            throw new MacOsTransactionLockOperationalError();
          }
        },
      };
    } catch (error) {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch {
          throw new MacOsTransactionLockOperationalError();
        }
      }
      if (
        error instanceof MacOsTransactionLockUnavailableError ||
        error instanceof MacOsTransactionLockOperationalError
      ) {
        throw error;
      }
      throw new MacOsTransactionLockOperationalError();
    }
  }

  private async ensureOwnerOnlyParent(
    path: string,
    uid: number,
  ): Promise<FileIdentity> {
    try {
      await this.dependencies.fs.mkdir(path, {
        recursive: true,
        mode: 0o700,
      });
      const before = await this.dependencies.fs.lstat(path);
      if (
        before.isSymbolicLink() ||
        !before.isDirectory() ||
        before.uid !== uid
      ) {
        throw new MacOsTransactionLockOperationalError();
      }
      await this.dependencies.fs.chmod(path, 0o700);
      const after = await this.dependencies.fs.lstat(path);
      if (
        after.isSymbolicLink() ||
        !after.isDirectory() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        after.uid !== uid ||
        (after.mode & 0o777) !== 0o700
      ) {
        throw new MacOsTransactionLockOperationalError();
      }
      return { dev: after.dev, ino: after.ino };
    } catch (error) {
      if (error instanceof MacOsTransactionLockOperationalError) throw error;
      throw new MacOsTransactionLockOperationalError();
    }
  }

  private async assertOwnerOnlyParent(
    path: string,
    identity: FileIdentity,
    uid: number,
  ): Promise<void> {
    const stats = await this.dependencies.fs.lstat(path);
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      !this.hasIdentity(stats, identity) ||
      stats.uid !== uid ||
      (stats.mode & 0o777) !== 0o700
    ) {
      throw new MacOsTransactionLockOperationalError();
    }
  }

  private async assertStableLockFile(
    path: string,
    handle: FileHandle,
    identity: FileIdentity,
    uid: number,
  ): Promise<void> {
    const descriptorStats = await handle.stat();
    if (
      !descriptorStats.isFile() ||
      !this.hasIdentity(descriptorStats, identity) ||
      descriptorStats.uid !== uid ||
      (descriptorStats.mode & 0o777) !== 0o600
    ) {
      throw new MacOsTransactionLockOperationalError();
    }

    const pathStats = await this.dependencies.fs.lstat(path);
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      !this.hasIdentity(pathStats, identity) ||
      pathStats.uid !== uid ||
      (pathStats.mode & 0o777) !== 0o600
    ) {
      throw new MacOsTransactionLockOperationalError();
    }
  }

  private hasIdentity(
    stats: FileIdentity,
    identity: FileIdentity,
  ): boolean {
    return stats.dev === identity.dev && stats.ino === identity.ino;
  }
}
