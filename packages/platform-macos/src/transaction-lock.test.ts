import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type LockfResult,
  type LockfRunner,
  type MacOsTransactionLockFileSystem,
  MacOsTransactionLockOperationalError,
  MacOsTransactionLockProvider,
  MacOsTransactionLockUnavailableError,
} from "./transaction-lock.js";

interface LockFixture {
  readonly root: string;
  readonly parentPath: string;
  readonly lockPath: string;
}

async function createLockFixture(label: string): Promise<LockFixture> {
  const root = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-lock-${label}-`));
  const parentPath = join(root, "transactions");
  return {
    root,
    parentPath,
    lockPath: join(parentPath, ".tx-0001.lock"),
  };
}

async function removeLockFixture(fixture: LockFixture): Promise<void> {
  await nodeFs.rm(fixture.root, { recursive: true, force: true });
}

function currentUid(): number {
  if (process.getuid === undefined) {
    throw new Error("UID inspection is unavailable");
  }
  return process.getuid();
}

function waitForExit(child: ChildProcess): Promise<LockfResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      exitCode: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function waitForLine(
  stream: NodeJS.ReadableStream | null,
  expected: string,
): Promise<void> {
  if (stream === null) throw new Error("child stdout is unavailable");
  return new Promise((resolve, reject) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
      if (output.split("\n").includes(expected)) resolve();
    });
    stream.once("error", reject);
    stream.once("end", () => {
      if (!output.split("\n").includes(expected)) {
        reject(new Error("child exited before lock acquisition"));
      }
    });
  });
}

function spawnCrashOwner(lockPath: string): ChildProcess {
  const script = String.raw`
    import { spawn } from 'node:child_process';
    import { constants } from 'node:fs';
    import { open } from 'node:fs/promises';
    import { setTimeout as delay } from 'node:timers/promises';

    const handle = await open(
      process.argv[1],
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    const child = spawn(
      '/usr/bin/lockf',
      ['-s', '-t', '0', '3'],
      {
        shell: false,
        stdio: ['ignore', 'ignore', 'ignore', handle.fd],
      },
    );
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if (result.exitCode !== 0 || result.signal !== null) process.exit(2);
    process.stdout.write('locked\n');
    await delay(500);
    process.exit(0);
  `;
  return spawn(
    process.execPath,
    ["--input-type=module", "-e", script, lockPath],
    { shell: false, stdio: ["ignore", "pipe", "ignore"] },
  );
}

it("requires the lockf capability on a supported macOS host", async () => {
  if (process.platform !== "darwin") return;
  await expect(nodeFs.access("/usr/bin/lockf", constants.X_OK)).resolves.toBeUndefined();
});

describe.runIf(process.platform === "darwin")(
  "MacOsTransactionLockProvider real kernel contract",
  () => {
    it("retains contention after lockf exits and reacquires after release", async () => {
      const fixture = await createLockFixture("retained");
      const firstProvider = new MacOsTransactionLockProvider();
      const secondProvider = new MacOsTransactionLockProvider();
      let first: Awaited<ReturnType<MacOsTransactionLockProvider["acquire"]>> | undefined;
      let second: Awaited<ReturnType<MacOsTransactionLockProvider["acquire"]>> | undefined;

      try {
        first = await firstProvider.acquire(fixture.lockPath);
        await expect(secondProvider.acquire(fixture.lockPath)).rejects.toBeInstanceOf(
          MacOsTransactionLockUnavailableError,
        );

        await first.release();
        first = undefined;
        second = await secondProvider.acquire(fixture.lockPath);
        await second.release();
        second = undefined;

        const stats = await nodeFs.lstat(fixture.lockPath);
        expect(stats.isFile()).toBe(true);
        expect(stats.mode & 0o777).toBe(0o600);
      } finally {
        await first?.release().catch(() => undefined);
        await second?.release().catch(() => undefined);
        await removeLockFixture(fixture);
      }
    });

    it("releases automatically when a separate owner process exits", async () => {
      const fixture = await createLockFixture("process-exit");

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o700,
        });
        const child = spawnCrashOwner(fixture.lockPath);
        await waitForLine(child.stdout, "locked");
        await expect(
          new MacOsTransactionLockProvider().acquire(fixture.lockPath),
        ).rejects.toBeInstanceOf(MacOsTransactionLockUnavailableError);
        expect(await waitForExit(child)).toStrictEqual({
          exitCode: 0,
          signal: null,
        });

        const recovered = await new MacOsTransactionLockProvider().acquire(
          fixture.lockPath,
        );
        await recovered.release();
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("keeps the lock while the owning event loop is synchronously paused", async () => {
      const fixture = await createLockFixture("paused-loop");
      const owner = await new MacOsTransactionLockProvider().acquire(
        fixture.lockPath,
      );

      try {
        const contender = spawn(
          "/usr/bin/lockf",
          ["-s", "-t", "0", "-k", fixture.lockPath, "/usr/bin/true"],
          { shell: false, stdio: "ignore" },
        );
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        expect(await waitForExit(contender)).toStrictEqual({
          exitCode: 75,
          signal: null,
        });
      } finally {
        await owner.release();
        await removeLockFixture(fixture);
      }
    });
  },
);

describe.runIf(process.platform === "darwin")(
  "MacOsTransactionLockProvider file safety",
  () => {
    it("rejects a final-component symlink without touching its target", async () => {
      const fixture = await createLockFixture("symlink");
      const substitutePath = join(fixture.root, "substitute");
      const substituteBytes = new TextEncoder().encode("synthetic-substitute");

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o700,
        });
        await nodeFs.writeFile(substitutePath, substituteBytes);
        await nodeFs.symlink(substitutePath, fixture.lockPath);

        await expect(
          new MacOsTransactionLockProvider().acquire(fixture.lockPath),
        ).rejects.toBeInstanceOf(MacOsTransactionLockOperationalError);
        expect(await nodeFs.readFile(substitutePath)).toStrictEqual(
          Buffer.from(substituteBytes),
        );
        expect((await nodeFs.lstat(fixture.lockPath)).isSymbolicLink()).toBe(
          true,
        );
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("rejects a symlink lock parent", async () => {
      const fixture = await createLockFixture("parent-symlink");
      const actualParent = join(fixture.root, "actual-transactions");

      try {
        await nodeFs.mkdir(actualParent, { mode: 0o700 });
        await nodeFs.symlink(actualParent, fixture.parentPath);

        await expect(
          new MacOsTransactionLockProvider().acquire(fixture.lockPath),
        ).rejects.toBeInstanceOf(MacOsTransactionLockOperationalError);
        await expect(nodeFs.lstat(join(actualParent, ".tx-0001.lock"))).rejects.toMatchObject(
          { code: "ENOENT" },
        );
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("rejects parent substitution between validation and lock-file open", async () => {
      const fixture = await createLockFixture("parent-substitution");
      const originalParent = join(fixture.root, "original-transactions");
      const substituteParent = join(fixture.root, "substitute-transactions");
      let runnerCalls = 0;

      const injectedFs: MacOsTransactionLockFileSystem = {
        mkdir: nodeFs.mkdir,
        chmod: nodeFs.chmod,
        lstat: nodeFs.lstat,
        open: async (path, flags, mode) => {
          await nodeFs.rename(fixture.parentPath, originalParent);
          await nodeFs.mkdir(substituteParent, { mode: 0o700 });
          await nodeFs.symlink(substituteParent, fixture.parentPath);
          return nodeFs.open(path, flags, mode);
        },
      };
      const runner: LockfRunner = {
        acquire: () => {
          runnerCalls += 1;
          return Promise.resolve({ exitCode: 0, signal: null });
        },
      };

      try {
        const error = await new MacOsTransactionLockProvider({
          fs: injectedFs,
          runner,
          getUid: currentUid,
        })
          .acquire(fixture.lockPath)
          .then(
            async (handle) => {
              await handle.release();
              return undefined;
            },
            (caught: unknown) => caught,
          );

        expect(error).toBeInstanceOf(MacOsTransactionLockOperationalError);
        expect(runnerCalls).toBe(0);
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("rejects inode substitution before invoking lockf", async () => {
      const fixture = await createLockFixture("inode-substitution");
      const openedPath = join(fixture.root, "opened-original");
      const substituteBytes = new TextEncoder().encode("replacement-inode");
      let runnerCalls = 0;

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o700,
        });
        await nodeFs.writeFile(fixture.lockPath, "original-inode", {
          mode: 0o600,
        });
        const injectedFs: MacOsTransactionLockFileSystem = {
          mkdir: nodeFs.mkdir,
          chmod: nodeFs.chmod,
          lstat: nodeFs.lstat,
          open: async (path, flags, mode) => {
            const handle = await nodeFs.open(path, flags, mode);
            await nodeFs.rename(path, openedPath);
            await nodeFs.writeFile(path, substituteBytes, { mode: 0o600 });
            return handle;
          },
        };
        const runner: LockfRunner = {
          acquire: () => {
            runnerCalls += 1;
            return Promise.resolve({ exitCode: 0, signal: null });
          },
        };
        const provider = new MacOsTransactionLockProvider({
          fs: injectedFs,
          runner,
          getUid: currentUid,
        });

        await expect(provider.acquire(fixture.lockPath)).rejects.toBeInstanceOf(
          MacOsTransactionLockOperationalError,
        );
        expect(runnerCalls).toBe(0);
        expect(await nodeFs.readFile(fixture.lockPath)).toStrictEqual(
          Buffer.from(substituteBytes),
        );
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("rejects lock-path substitution during snapshot validation", async () => {
      const fixture = await createLockFixture("snapshot-substitution");
      const openedPath = join(fixture.root, "opened-original");
      const substituteBytes = new TextEncoder().encode("replacement-inode");
      let substituted = false;

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o700,
        });
        await nodeFs.writeFile(fixture.lockPath, "original-inode", {
          mode: 0o600,
        });
        const injectedFs: MacOsTransactionLockFileSystem = {
          mkdir: nodeFs.mkdir,
          chmod: nodeFs.chmod,
          lstat: async (path) => {
            const stats = await nodeFs.lstat(path);
            if (path === fixture.lockPath && !substituted) {
              substituted = true;
              await nodeFs.rename(path, openedPath);
              await nodeFs.writeFile(path, substituteBytes, { mode: 0o600 });
            }
            return stats;
          },
          open: nodeFs.open,
        };
        const runner: LockfRunner = {
          acquire: () => Promise.resolve({ exitCode: 0, signal: null }),
        };

        const error = await new MacOsTransactionLockProvider({
          fs: injectedFs,
          runner,
          getUid: currentUid,
        })
          .acquire(fixture.lockPath)
          .then(
            async (handle) => {
              await handle.release();
              return undefined;
            },
            (caught: unknown) => caught,
          );

        expect(error).toBeInstanceOf(MacOsTransactionLockOperationalError);
        expect(await nodeFs.readFile(fixture.lockPath)).toStrictEqual(
          Buffer.from(substituteBytes),
        );
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("validates descriptor type and owner before normalizing its mode", async () => {
      const fixture = await createLockFixture("fstat-before-chmod");
      const events: string[] = [];

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o700,
        });
        await nodeFs.writeFile(fixture.lockPath, "", { mode: 0o666 });
        const injectedFs: MacOsTransactionLockFileSystem = {
          mkdir: nodeFs.mkdir,
          chmod: nodeFs.chmod,
          lstat: nodeFs.lstat,
          open: async (path, flags, mode) => {
            const handle = await nodeFs.open(path, flags, mode);
            const originalStat = handle.stat.bind(handle);
            const originalChmod = handle.chmod.bind(handle);
            Object.defineProperties(handle, {
              stat: {
                value: async () => {
                  events.push("stat");
                  return originalStat();
                },
              },
              chmod: {
                value: async (nextMode: number) => {
                  events.push("chmod");
                  return originalChmod(nextMode);
                },
              },
            });
            return handle;
          },
        };
        const runner: LockfRunner = {
          acquire: () => Promise.resolve({ exitCode: 0, signal: null }),
        };

        const handle = await new MacOsTransactionLockProvider({
          fs: injectedFs,
          runner,
          getUid: currentUid,
        }).acquire(fixture.lockPath);
        await handle.release();

        expect(events[0]).toBe("stat");
        expect(events).toContain("chmod");
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("normalizes parent and stable-file permissions without deleting the file", async () => {
      const fixture = await createLockFixture("permissions");

      try {
        await nodeFs.mkdir(fixture.parentPath, {
          recursive: true,
          mode: 0o777,
        });
        await nodeFs.chmod(fixture.parentPath, 0o777);
        await nodeFs.writeFile(fixture.lockPath, "", { mode: 0o666 });
        await nodeFs.chmod(fixture.lockPath, 0o666);

        const handle = await new MacOsTransactionLockProvider().acquire(
          fixture.lockPath,
        );
        await handle.release();

        const [parentStats, fileStats] = await Promise.all([
          nodeFs.lstat(fixture.parentPath),
          nodeFs.lstat(fixture.lockPath),
        ]);
        expect(parentStats.mode & 0o777).toBe(0o700);
        expect(fileStats.mode & 0o777).toBe(0o600);
        expect(parentStats.uid).toBe(currentUid());
        expect(fileStats.uid).toBe(currentUid());
        expect(fileStats.isFile()).toBe(true);
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it.each([
      {
        result: { exitCode: 75, signal: null },
        errorType: MacOsTransactionLockUnavailableError,
        message: "transaction lock is unavailable",
      },
      {
        result: { exitCode: 70, signal: null },
        errorType: MacOsTransactionLockOperationalError,
        message: "transaction lock operation failed",
      },
      {
        result: { exitCode: null, signal: "SIGTERM" as const },
        errorType: MacOsTransactionLockOperationalError,
        message: "transaction lock operation failed",
      },
    ])("maps lockf result $result without diagnostics", async ({
      result,
      errorType,
      message,
    }) => {
      const fixture = await createLockFixture("result-map");
      const runner: LockfRunner = {
        acquire: () => Promise.resolve(result),
      };

      try {
        const error = await new MacOsTransactionLockProvider({ runner })
          .acquire(fixture.lockPath)
          .then(
            () => undefined,
            (caught: unknown) => caught,
          );
        expect(error).toBeInstanceOf(errorType);
        expect(error).toMatchObject({ message });
        expect(String(error)).not.toContain(fixture.root);
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("maps runner rejection without exposing its diagnostics", async () => {
      const fixture = await createLockFixture("runner-rejection");
      const runner: LockfRunner = {
        acquire: () => Promise.reject(new Error(`sensitive ${fixture.root}`)),
      };

      try {
        const error = await new MacOsTransactionLockProvider({ runner })
          .acquire(fixture.lockPath)
          .then(
            () => undefined,
            (caught: unknown) => caught,
          );
        expect(error).toBeInstanceOf(MacOsTransactionLockOperationalError);
        expect(error).toMatchObject({
          message: "transaction lock operation failed",
        });
        expect(String(error)).not.toContain(fixture.root);
      } finally {
        await removeLockFixture(fixture);
      }
    });

    it("closes a handle exactly once and keeps the stable pathname", async () => {
      const fixture = await createLockFixture("one-shot-release");

      try {
        const handle = await new MacOsTransactionLockProvider().acquire(
          fixture.lockPath,
        );
        await handle.release();
        await expect(handle.release()).rejects.toBeInstanceOf(
          MacOsTransactionLockOperationalError,
        );
        expect((await nodeFs.lstat(fixture.lockPath)).isFile()).toBe(true);
      } finally {
        await removeLockFixture(fixture);
      }
    });
  },
);
