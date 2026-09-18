import { spawnSync } from "node:child_process";
import { constants, type Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  LIFECYCLE_LEASE_DRAIN_MS,
  LIFECYCLE_LOCK_RETRY_MS,
  LifecycleLockBusyError,
  LifecycleLockMissingError,
  LifecycleLockShapeError,
  LifecycleLockUnavailableError,
  SCHEDULED_JOB_IDS,
  type CanonicalAbsolutePathV1,
  type HeldLifecycleStableLockV1,
  type LifecycleLockDeadlineV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  MacOsStableLockProvider,
  type MacOsStableLockFileSystem,
} from "./stable-lock.js";
import {
  EX_TEMPFAIL,
  type LockfResult,
  type LockfRunner,
} from "./transaction-lock.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

function currentUid(): number {
  if (process.getuid === undefined) throw new Error("UID inspection is unavailable");
  return process.getuid();
}

async function ownerOnlyDirectory(label: string): Promise<string> {
  const root = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-stable-lock-${label}-`));
  temporaryRoots.push(root);
  return root;
}

interface HomeFixture {
  readonly root: string;
  readonly statePath: string;
  readonly lockPath: CanonicalAbsolutePathV1;
}

async function temporaryHome(label: string): Promise<HomeFixture> {
  const root = await ownerOnlyDirectory(label);
  const statePath = join(root, "state");
  await nodeFs.mkdir(statePath, { mode: 0o700 });
  return {
    root,
    statePath,
    lockPath: join(statePath, ".lifecycle.lock") as CanonicalAbsolutePathV1,
  };
}

async function createExactLockFile(path: string): Promise<void> {
  const handle = await nodeFs.open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  await handle.close();
}

async function homeWithLock(label: string): Promise<HomeFixture> {
  const fixture = await temporaryHome(label);
  await createExactLockFile(fixture.lockPath);
  return fixture;
}

interface LeaseFixture {
  readonly home: HomeFixture;
  readonly paths: readonly CanonicalAbsolutePathV1[];
}

async function homeWithLeases(label: string): Promise<LeaseFixture> {
  const home = await temporaryHome(label);
  const paths = SCHEDULED_JOB_IDS.map(
    (job) => join(home.statePath, `.automation-${job}.lock`) as CanonicalAbsolutePathV1,
  );
  for (const path of paths) await createExactLockFile(path);
  return { home, paths };
}

function leasePath(fixture: LeaseFixture, index: number): CanonicalAbsolutePathV1 {
  const path = fixture.paths[index];
  if (path === undefined) throw new Error("lease fixture index is out of range");
  return path;
}

interface RecordedOpen {
  readonly path: string;
  readonly flags: number;
  closed: boolean;
}

interface RecordingFileSystem {
  readonly fs: MacOsStableLockFileSystem;
  readonly opens: readonly RecordedOpen[];
}

interface RecordingHooks {
  readonly beforeOpen?: (path: string) => Promise<void>;
}

/**
 * Only `fd`, `stat()` and `close()` are delegated: anything else the provider
 * reaches for on a `FileHandle` fails loudly instead of silently escaping the
 * close accounting these tests depend on.
 */
function recordedHandle(handle: FileHandle, record: RecordedOpen): FileHandle {
  return {
    fd: handle.fd,
    stat: (): Promise<Stats> => handle.stat(),
    close: async (): Promise<void> => {
      record.closed = true;
      await handle.close();
    },
  } as unknown as FileHandle;
}

function recordingFileSystem(hooks: RecordingHooks = {}): RecordingFileSystem {
  const opens: RecordedOpen[] = [];
  return {
    opens,
    fs: {
      lstat: (path) => nodeFs.lstat(path),
      open: async (path, flags) => {
        await hooks.beforeOpen?.(path);
        const handle = await nodeFs.open(path, flags);
        const record: RecordedOpen = { path, flags, closed: false };
        opens.push(record);
        return recordedHandle(handle, record);
      },
    },
  };
}

interface ScriptedRunner extends LockfRunner {
  readonly descriptors: readonly number[];
  readonly results: { readonly remaining: number };
}

interface ScriptedRunnerHooks {
  readonly onAcquire?: () => Promise<void>;
}

function scriptedLockf(
  exitCodes: readonly number[],
  hooks: ScriptedRunnerHooks = {},
): ScriptedRunner {
  const pending = [...exitCodes];
  const descriptors: number[] = [];
  return {
    descriptors,
    results: {
      get remaining(): number {
        return pending.length;
      },
    },
    acquire: async (descriptor: number): Promise<LockfResult> => {
      descriptors.push(descriptor);
      await hooks.onAcquire?.();
      const exitCode = pending.shift();
      if (exitCode === undefined) throw new Error("scripted lockf ran out of results");
      return { exitCode, signal: null };
    },
  };
}

function fixedLockf(result: LockfResult): LockfRunner {
  return { acquire: () => Promise.resolve(result) };
}

function failingLstat(code: string): MacOsStableLockFileSystem {
  return {
    lstat: () => {
      const error: Error & { code?: string } = new Error(`synthetic ${code}`);
      error.code = code;
      return Promise.reject(error);
    },
    open: () => Promise.reject(new Error("open must not be reached")),
  };
}

interface FakeClock {
  readonly sleeps: readonly number[];
  readonly nowMs: () => number;
  readonly sleepMs: (milliseconds: number) => Promise<void>;
}

function fakeClock(): FakeClock {
  const sleeps: number[] = [];
  let now = 0;
  return {
    sleeps,
    nowMs: () => now,
    sleepMs: (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      now += milliseconds;
      return Promise.resolve();
    },
  };
}

function deadlineIn(clock: FakeClock, milliseconds: number): LifecycleLockDeadlineV1 {
  return {
    nowMs: clock.nowMs,
    sleepMs: clock.sleepMs,
    deadlineMs: clock.nowMs() + milliseconds,
  };
}

async function releaseAll(
  locks: readonly HeldLifecycleStableLockV1[],
): Promise<void> {
  for (const lock of locks) await lock.release();
}

describe("the lifecycle stable-lock contract core owns", () => {
  it("pins the drain deadline and the retry interval", () => {
    expect(LIFECYCLE_LEASE_DRAIN_MS).toBe(600_000);
    expect(LIFECYCLE_LOCK_RETRY_MS).toBe(250);
  });

  it("pins each refusal's exit class, reason and path", () => {
    const busy = new LifecycleLockBusyError("/home/state/.lifecycle.lock");
    const missing = new LifecycleLockMissingError("/home/state/.lifecycle.lock");
    const badShape = new LifecycleLockShapeError("/home/state/.lifecycle.lock");

    expect([busy.code, busy.reason, busy.path]).toStrictEqual([
      6,
      "lifecycle_lock_busy",
      "/home/state/.lifecycle.lock",
    ]);
    expect([missing.code, missing.reason, missing.path]).toStrictEqual([
      6,
      "lifecycle_lock_missing",
      "/home/state/.lifecycle.lock",
    ]);
    expect([badShape.code, badShape.reason, badShape.path]).toStrictEqual([
      5,
      "lifecycle_lock_shape",
      "/home/state/.lifecycle.lock",
    ]);
    const unavailable = new LifecycleLockUnavailableError(
      "/home/state/.lifecycle.lock",
    );
    expect([unavailable.code, unavailable.reason, unavailable.path]).toStrictEqual([
      6,
      "lifecycle_lock_unavailable",
      "/home/state/.lifecycle.lock",
    ]);
    expect([busy.name, missing.name, badShape.name, unavailable.name]).toStrictEqual([
      "LifecycleLockBusyError",
      "LifecycleLockMissingError",
      "LifecycleLockShapeError",
      "LifecycleLockUnavailableError",
    ]);
  });
});

describe.runIf(process.platform === "darwin")("MacOsStableLockProvider", () => {
  it("refuses an absent lock path without creating it or its parent", async () => {
    const root = await ownerOnlyDirectory("absent");
    const path = join(root, "state", ".lifecycle.lock") as CanonicalAbsolutePathV1;

    await expect(
      new MacOsStableLockProvider().acquireExisting(path),
    ).rejects.toBeInstanceOf(LifecycleLockMissingError);
    await expect(nodeFs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(nodeFs.lstat(dirname(path))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a second holder as busy and admits it after release", async () => {
    const fixture = await homeWithLock("busy");
    const first = new MacOsStableLockProvider();
    const second = new MacOsStableLockProvider();
    const held = await first.acquireExisting(fixture.lockPath);

    await expect(
      second.acquireExisting(fixture.lockPath),
    ).rejects.toBeInstanceOf(LifecycleLockBusyError);

    await held.release();
    await (await second.acquireExisting(fixture.lockPath)).release();
  });

  it("reports the acquired path's own device and inode as decimal text", async () => {
    const fixture = await homeWithLock("identity");
    const stats = await nodeFs.lstat(fixture.lockPath);
    const held = await new MacOsStableLockProvider().acquireExisting(fixture.lockPath);

    try {
      expect(held.path).toBe(fixture.lockPath);
      expect(held.dev).toBe(String(stats.dev));
      expect(held.ino).toBe(String(stats.ino));
    } finally {
      await held.release();
    }
  });

  it("closes the descriptor exactly once however often release is called", async () => {
    const fixture = await homeWithLock("release-once");
    const recording = recordingFileSystem();
    const held = await new MacOsStableLockProvider({
      fs: recording.fs,
      getUid: currentUid,
    }).acquireExisting(fixture.lockPath);

    await held.release();
    await expect(held.release()).resolves.toBeUndefined();

    expect(recording.opens.map((open) => open.closed)).toStrictEqual([true]);
    await (await new MacOsStableLockProvider().acquireExisting(fixture.lockPath)).release();
  });

  it("opens the existing lock read-write without following links or creating it", async () => {
    const fixture = await homeWithLock("flags");
    const recording = recordingFileSystem();
    const held = await new MacOsStableLockProvider({
      fs: recording.fs,
      getUid: currentUid,
    }).acquireExisting(fixture.lockPath);

    try {
      expect(recording.opens).toHaveLength(1);
      expect(recording.opens[0]?.flags).toBe(constants.O_RDWR | constants.O_NOFOLLOW);
      expect((recording.opens[0]?.flags ?? -1) & constants.O_CREAT).toBe(0);
    } finally {
      await held.release();
    }
  });

  it("changes no mode on the lock file or its parent", async () => {
    const fixture = await homeWithLock("modes");
    await nodeFs.chmod(fixture.statePath, 0o750);
    const parentBefore = await nodeFs.lstat(fixture.statePath);
    const lockBefore = await nodeFs.lstat(fixture.lockPath);

    const held = await new MacOsStableLockProvider().acquireExisting(fixture.lockPath);
    await held.release();

    const parentAfter = await nodeFs.lstat(fixture.statePath);
    const lockAfter = await nodeFs.lstat(fixture.lockPath);
    expect(parentAfter.mode & 0o777).toBe(0o750);
    expect(parentAfter.mode).toBe(parentBefore.mode);
    expect(parentAfter.ino).toBe(parentBefore.ino);
    expect(lockAfter.mode).toBe(lockBefore.mode);
    expect(lockAfter.size).toBe(0);
    expect(lockAfter.nlink).toBe(1);
    expect(lockAfter.ino).toBe(lockBefore.ino);
  });

  interface ShapeCase {
    readonly label: string;
    readonly prepare: (path: string, root: string) => Promise<void>;
    readonly uid?: (actual: number) => number;
  }

  const shapeCases: readonly ShapeCase[] = [
    {
      label: "a final-component symlink",
      prepare: async (path, root) => {
        const target = join(root, "state", ".target.lock");
        await createExactLockFile(target);
        await nodeFs.symlink(target, path);
      },
    },
    {
      label: "a directory",
      prepare: async (path) => {
        await nodeFs.mkdir(path, { mode: 0o700 });
      },
    },
    {
      label: "a FIFO",
      prepare: (path) => {
        const created = spawnSync("/usr/bin/mkfifo", ["-m", "600", path], {
          shell: false,
          stdio: "ignore",
        });
        if (created.status !== 0) throw new Error("mkfifo is unavailable");
        return Promise.resolve();
      },
    },
    {
      label: "a group-readable mode",
      prepare: async (path) => {
        await createExactLockFile(path);
        await nodeFs.chmod(path, 0o644);
      },
    },
    {
      label: "a single byte of content",
      prepare: async (path) => {
        await createExactLockFile(path);
        await nodeFs.writeFile(path, "x");
      },
    },
    {
      label: "a second hard link",
      prepare: async (path, root) => {
        await createExactLockFile(path);
        await nodeFs.link(path, join(root, "state", ".second.lock"));
      },
    },
    {
      label: "a foreign owner",
      prepare: (path) => createExactLockFile(path),
      uid: (actual) => actual + 1,
    },
  ];

  it.each(shapeCases)("refuses $label without running lockf", async (shapeCase) => {
    const fixture = await temporaryHome("shape");
    await shapeCase.prepare(fixture.lockPath, fixture.root);
    const runner = scriptedLockf([0]);
    const before = await nodeFs.lstat(fixture.lockPath);

    await expect(
      new MacOsStableLockProvider({
        runner,
        getUid: () => (shapeCase.uid ?? ((actual: number) => actual))(currentUid()),
      }).acquireExisting(fixture.lockPath),
    ).rejects.toBeInstanceOf(LifecycleLockShapeError);

    expect(runner.descriptors).toStrictEqual([]);
    expect(runner.results.remaining).toBe(1);
    const after = await nodeFs.lstat(fixture.lockPath);
    expect([after.ino, after.mode, after.nlink]).toStrictEqual([
      before.ino,
      before.mode,
      before.nlink,
    ]);
  });

  it("refuses an identity swap between lstat and open, before running lockf", async () => {
    const fixture = await homeWithLock("swap-before-lockf");
    const movedAside = join(fixture.statePath, ".moved-aside.lock");
    const runner = scriptedLockf([0]);
    const recording = recordingFileSystem({
      beforeOpen: async (path) => {
        await nodeFs.rename(path, movedAside);
        await createExactLockFile(path);
      },
    });

    await expect(
      new MacOsStableLockProvider({
        fs: recording.fs,
        runner,
        getUid: currentUid,
      }).acquireExisting(fixture.lockPath),
    ).rejects.toBeInstanceOf(LifecycleLockShapeError);

    expect(runner.descriptors).toStrictEqual([]);
    expect(recording.opens.map((open) => open.closed)).toStrictEqual([true]);
  });

  it("refuses an identity swap observed after lockf returns", async () => {
    const fixture = await homeWithLock("swap-after-lockf");
    const movedAside = join(fixture.statePath, ".moved-aside.lock");
    const recording = recordingFileSystem();
    const runner = scriptedLockf([0], {
      onAcquire: async () => {
        await nodeFs.rename(fixture.lockPath, movedAside);
        await createExactLockFile(fixture.lockPath);
      },
    });

    await expect(
      new MacOsStableLockProvider({
        fs: recording.fs,
        runner,
        getUid: currentUid,
      }).acquireExisting(fixture.lockPath),
    ).rejects.toBeInstanceOf(LifecycleLockShapeError);

    expect(runner.descriptors).toHaveLength(1);
    expect(recording.opens.map((open) => open.closed)).toStrictEqual([true]);
  });

  it("treats a signal-killed lockf as recovery-required, not a security verdict", async () => {
    const fixture = await homeWithLock("lockf-signal");
    const recording = recordingFileSystem();

    const refusal = await new MacOsStableLockProvider({
      fs: recording.fs,
      runner: fixedLockf({ exitCode: null, signal: "SIGKILL" }),
      getUid: currentUid,
    })
      .acquireExisting(fixture.lockPath)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(LifecycleLockUnavailableError);
    expect((refusal as LifecycleLockUnavailableError).code).toBe(6);
    expect(recording.opens.map((open) => open.closed)).toStrictEqual([true]);
  });

  it("treats an unexpected lockf exit code as recovery-required", async () => {
    const fixture = await homeWithLock("lockf-exit-code");
    const recording = recordingFileSystem();

    const refusal = await new MacOsStableLockProvider({
      fs: recording.fs,
      runner: fixedLockf({ exitCode: 1, signal: null }),
      getUid: currentUid,
    })
      .acquireExisting(fixture.lockPath)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(LifecycleLockUnavailableError);
    expect((refusal as LifecycleLockUnavailableError).code).toBe(6);
    expect(recording.opens.map((open) => open.closed)).toStrictEqual([true]);
  });

  it("keeps an unreadable lock path a security refusal", async () => {
    const path = "/home/state/.lifecycle.lock" as CanonicalAbsolutePathV1;

    await expect(
      new MacOsStableLockProvider({
        fs: failingLstat("EACCES"),
        runner: fixedLockf({ exitCode: 0, signal: null }),
        getUid: currentUid,
      }).acquireExisting(path),
    ).rejects.toBeInstanceOf(LifecycleLockShapeError);
  });

  it("keeps an unavailable effective uid a security refusal", async () => {
    const fixture = await homeWithLock("uid-unavailable");

    await expect(
      new MacOsStableLockProvider({
        runner: fixedLockf({ exitCode: 0, signal: null }),
        getUid: () => {
          throw new Error("effective uid is unavailable");
        },
      }).acquireExisting(fixture.lockPath),
    ).rejects.toBeInstanceOf(LifecycleLockShapeError);
  });

  it("acquires no lock and consults no clock for an empty path list", async () => {
    const clock = fakeClock();
    const runner = scriptedLockf([]);

    await expect(
      new MacOsStableLockProvider({ runner }).acquireExistingWithin(
        [],
        deadlineIn(clock, LIFECYCLE_LEASE_DRAIN_MS),
      ),
    ).resolves.toStrictEqual([]);
    expect(runner.descriptors).toStrictEqual([]);
    expect(clock.sleeps).toStrictEqual([]);
  });

  it("acquires the four registry leases in the given order and never re-sorts them", async () => {
    const fixture = await homeWithLeases("order");
    const clock = fakeClock();
    const recording = recordingFileSystem();

    expect(SCHEDULED_JOB_IDS).toStrictEqual([
      "brain-reindex",
      "brain-lint",
      "doctor",
      "git-sync",
    ]);
    expect(fixture.paths).toHaveLength(4);
    expect([...fixture.paths]).not.toStrictEqual([...fixture.paths].sort());

    const held = await new MacOsStableLockProvider({
      fs: recording.fs,
      getUid: currentUid,
    }).acquireExistingWithin(fixture.paths, deadlineIn(clock, LIFECYCLE_LEASE_DRAIN_MS));

    try {
      expect(held.map((lock) => lock.path)).toStrictEqual([...fixture.paths]);
      expect(recording.opens.map((open) => open.path)).toStrictEqual([...fixture.paths]);
      expect(clock.sleeps).toStrictEqual([]);
    } finally {
      await releaseAll(held);
    }
  });

  it("drains in order under one absolute deadline and releases everything on timeout", async () => {
    const fixture = await homeWithLeases("deadline");
    const clock = fakeClock();
    const recording = recordingFileSystem();
    const runner = scriptedLockf([
      0,
      0,
      EX_TEMPFAIL,
      EX_TEMPFAIL,
      EX_TEMPFAIL,
      EX_TEMPFAIL,
    ]);

    await expect(
      new MacOsStableLockProvider({
        fs: recording.fs,
        runner,
        getUid: currentUid,
      }).acquireExistingWithin(fixture.paths, deadlineIn(clock, 600)),
    ).rejects.toBeInstanceOf(LifecycleLockBusyError);

    expect(runner.results.remaining).toBe(0);
    expect(clock.sleeps).toStrictEqual([
      LIFECYCLE_LOCK_RETRY_MS,
      LIFECYCLE_LOCK_RETRY_MS,
      LIFECYCLE_LOCK_RETRY_MS,
    ]);
    expect(recording.opens.map((open) => open.path)).toStrictEqual([
      leasePath(fixture, 0),
      leasePath(fixture, 1),
      leasePath(fixture, 2),
      leasePath(fixture, 2),
      leasePath(fixture, 2),
      leasePath(fixture, 2),
    ]);
    expect(recording.opens.filter((open) => open.closed)).toHaveLength(6);
  });

  it("releases the kernel leases it held when the drain deadline expires", async () => {
    const fixture = await homeWithLeases("timeout-release");
    const clock = fakeClock();
    const contender = await new MacOsStableLockProvider().acquireExisting(
      leasePath(fixture, 2),
    );

    try {
      await expect(
        new MacOsStableLockProvider().acquireExistingWithin(
          fixture.paths,
          deadlineIn(clock, 600),
        ),
      ).rejects.toBeInstanceOf(LifecycleLockBusyError);
      expect(clock.sleeps).toStrictEqual([
        LIFECYCLE_LOCK_RETRY_MS,
        LIFECYCLE_LOCK_RETRY_MS,
        LIFECYCLE_LOCK_RETRY_MS,
      ]);

      const reacquired = await new MacOsStableLockProvider().acquireExistingWithin(
        [leasePath(fixture, 0), leasePath(fixture, 1)],
        deadlineIn(clock, LIFECYCLE_LEASE_DRAIN_MS),
      );
      await releaseAll(reacquired);
      await expect(
        new MacOsStableLockProvider().acquireExisting(leasePath(fixture, 2)),
      ).rejects.toBeInstanceOf(LifecycleLockBusyError);
    } finally {
      await contender.release();
    }
  });

  it("refuses a lease path removed mid-drain and releases what it held", async () => {
    const fixture = await homeWithLeases("removed-mid-drain");
    const clock = fakeClock();
    const recording = recordingFileSystem({
      beforeOpen: async (path) => {
        if (path === leasePath(fixture, 1)) await nodeFs.rm(leasePath(fixture, 2));
      },
    });

    await expect(
      new MacOsStableLockProvider({
        fs: recording.fs,
        getUid: currentUid,
      }).acquireExistingWithin(fixture.paths, deadlineIn(clock, LIFECYCLE_LEASE_DRAIN_MS)),
    ).rejects.toBeInstanceOf(LifecycleLockMissingError);

    expect(recording.opens.map((open) => open.path)).toStrictEqual([
      leasePath(fixture, 0),
      leasePath(fixture, 1),
    ]);
    expect(recording.opens.filter((open) => open.closed)).toHaveLength(2);
    expect(clock.sleeps).toStrictEqual([]);

    const reacquired = await new MacOsStableLockProvider().acquireExistingWithin(
      [leasePath(fixture, 0), leasePath(fixture, 1)],
      deadlineIn(clock, LIFECYCLE_LEASE_DRAIN_MS),
    );
    await releaseAll(reacquired);
  });
});
