import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  fstatSync,
  renameSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXIT_CODES,
  parseLowerHexSha256,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type FreshV2InitIdV1,
  type SameParentRenameNoReplaceV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  MacOsRetainedRename,
  MacOsRetainedRenameRefusalError,
  MacOsRetainedRenameThirdStateError,
  MacOsRetainedRenameUnavailableError,
  SpawnRenameAtxRunner,
  type MacOsRetainedRenameDependencies,
  type RenameAtxRunner,
} from "./retained-rename.js";

const BOOTSTRAP_ID = "fi_00000000-0000-4000-8000-000000000000" as FreshV2InitIdV1;
const SOURCE_NAME = `.fresh-v2-init.${BOOTSTRAP_ID}.0000000000.payload`;
const TOMBSTONE_NAME = `.developer-os-retained.${BOOTSTRAP_ID}.0000000000.tombstone`;
const OSASCRIPT = "/usr/bin/osascript";

interface RenameFixture {
  readonly root: string;
  readonly parentPath: string;
  readonly sourcePath: string;
  readonly tombstonePath: string;
  readonly request: SameParentRenameNoReplaceV1;
}

function currentUid(): number {
  if (process.getuid === undefined) throw new Error("UID inspection unavailable in test");
  return process.getuid();
}

function decimal(value: bigint) {
  return parseUInt64Decimal(String(value));
}

function syntheticExecutableStats(
  identity: { readonly dev: bigint; readonly ino: bigint } = { dev: 9_001n, ino: 9_002n },
): BigIntStats {
  return {
    dev: identity.dev,
    ino: identity.ino,
    uid: 0n,
    mode: 0o100755n,
    nlink: 1n,
    size: 1n,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  } as BigIntStats;
}

function injectedLstat(
  executable: () => BigIntStats = syntheticExecutableStats,
): typeof nodeFs.lstat {
  return (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
    if (String(path) === OSASCRIPT) return executable();
    return nodeFs.lstat(path, options as { bigint?: false } | { bigint: true });
  }) as typeof nodeFs.lstat;
}

function delayedPostSpawnLstat(): typeof nodeFs.lstat {
  const base = injectedLstat();
  let executableObservations = 0;
  return (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
    if (String(path) === OSASCRIPT && executableObservations++ === 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return base(path, options as { bigint: true });
  }) as typeof nodeFs.lstat;
}

async function createFileFixture(label: string): Promise<RenameFixture> {
  const root = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-retained-rename-${label}-`));
  const parentPath = join(root, "retention-parent");
  const sourcePath = join(parentPath, SOURCE_NAME);
  const tombstonePath = join(parentPath, TOMBSTONE_NAME);
  await nodeFs.mkdir(parentPath, { mode: 0o700 });
  await nodeFs.chmod(parentPath, 0o700);
  await nodeFs.writeFile(sourcePath, "synthetic retained payload", { mode: 0o600 });
  await nodeFs.chmod(sourcePath, 0o600);
  const [parent, source, bytes] = await Promise.all([
    nodeFs.lstat(parentPath, { bigint: true }),
    nodeFs.lstat(sourcePath, { bigint: true }),
    nodeFs.readFile(sourcePath),
  ]);
  return {
    root,
    parentPath,
    sourcePath,
    tombstonePath,
    request: {
      entry: {
        schemaVersion: 1,
        bootstrapId: BOOTSTRAP_ID,
        ordinal: 0,
        role: "payload",
        sourcePath: sourcePath as CanonicalAbsolutePathV1,
        tombstonePath: tombstonePath as CanonicalAbsolutePathV1,
        parent: {
          path: parentPath as CanonicalAbsolutePathV1,
          dev: decimal(parent.dev),
          ino: decimal(parent.ino),
        },
        postimage: {
          kind: "regular_file",
          ownerUid: currentUid(),
          mode: 0o600,
          nlink: 1,
          bytes: decimal(source.size),
          sha256: parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex")),
          dev: decimal(source.dev),
          ino: decimal(source.ino),
        },
      },
    },
  };
}

async function createDirectoryFixture(label: string): Promise<RenameFixture> {
  const fixture = await createFileFixture(label);
  await nodeFs.rm(fixture.sourcePath);
  await nodeFs.mkdir(fixture.sourcePath, { mode: 0o700 });
  await nodeFs.writeFile(join(fixture.sourcePath, "synthetic-child"), "child", { mode: 0o600 });
  const source = await nodeFs.lstat(fixture.sourcePath, { bigint: true });
  return {
    ...fixture,
    request: {
      entry: {
        ...fixture.request.entry,
        role: "staging_subtree",
        postimage: {
          kind: "directory_tree",
          ownerUid: currentUid(),
          mode: 0o700,
          nlink: Number(source.nlink),
          treeHash: parseLowerHexSha256(createHash("sha256").update("synthetic-tree").digest("hex")),
          entryCount: 1,
          regularFileBytes: parseUInt64Decimal("5"),
          dev: decimal(source.dev),
          ino: decimal(source.ino),
        },
      },
    },
  };
}

async function removeFixture(fixture: RenameFixture): Promise<void> {
  await nodeFs.rm(fixture.root, { recursive: true, force: true });
}

function dependencies(
  runner: RenameAtxRunner,
  overrides: Partial<MacOsRetainedRenameDependencies> = {},
): Partial<MacOsRetainedRenameDependencies> {
  return {
    runner,
    lstat: injectedLstat(),
    getUid: currentUid,
    ...overrides,
  };
}

async function pathIdentity(path: string): Promise<{ readonly dev: bigint; readonly ino: bigint } | null> {
  try {
    const stats = await nodeFs.lstat(path, { bigint: true });
    return { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

describe("MacOsRetainedRename guarded port", () => {
  it("passes only two derived basenames and retained parent FD 3", async () => {
    const fixture = await createFileFixture("arguments");
    const calls: { readonly parentDescriptor: number; readonly sourceName: string; readonly tombstoneName: string }[] = [];
    const runner: RenameAtxRunner = {
      run: async (request) => {
        calls.push(request);
        expect(fstatSync(request.parentDescriptor, { bigint: true }).ino).toBe(
          BigInt(fixture.request.entry.parent.ino),
        );
        await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
        return { exitCode: 0, signal: null };
      },
    };

    try {
      await new MacOsRetainedRename(dependencies(runner)).rename(fixture.request);
      expect(calls).toHaveLength(1);
      expect(typeof calls[0]?.parentDescriptor).toBe("number");
      expect(calls[0]).toMatchObject({
        sourceName: SOURCE_NAME,
        tombstoneName: TOMBSTONE_NAME,
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("rejects a wrong parent identity before invoking the helper", async () => {
    const fixture = await createFileFixture("wrong-parent");
    let calls = 0;
    const runner: RenameAtxRunner = {
      run: () => {
        calls += 1;
        return Promise.resolve({ exitCode: 0, signal: null });
      },
    };
    const request = {
      entry: {
        ...fixture.request.entry,
        parent: { ...fixture.request.entry.parent, ino: parseUInt64Decimal("1") },
      },
    } as SameParentRenameNoReplaceV1;

    try {
      await expect(new MacOsRetainedRename(dependencies(runner)).rename(request)).rejects.toBeInstanceOf(
        MacOsRetainedRenameThirdStateError,
      );
      expect(calls).toBe(0);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("rejects a symlink parent and does not rename through it", async () => {
    const fixture = await createFileFixture("symlink-parent");
    const actualParent = join(fixture.root, "actual-parent");
    await nodeFs.rename(fixture.parentPath, actualParent);
    await nodeFs.symlink(actualParent, fixture.parentPath);

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: () => Promise.resolve({ exitCode: 0, signal: null }),
      })).rename(fixture.request)).rejects.toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(await pathIdentity(join(actualParent, SOURCE_NAME))).not.toBeNull();
      expect(await pathIdentity(join(actualParent, TOMBSTONE_NAME))).toBeNull();
    } finally {
      await removeFixture(fixture);
    }
  });

  it("rejects a symlink source before invoking the helper", async () => {
    const fixture = await createFileFixture("symlink-source");
    const target = join(fixture.parentPath, "target");
    await nodeFs.rename(fixture.sourcePath, target);
    await nodeFs.symlink(target, fixture.sourcePath);
    let calls = 0;

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: () => {
          calls += 1;
          return Promise.resolve({ exitCode: 0, signal: null });
        },
      })).rename(fixture.request)).rejects.toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(calls).toBe(0);
      expect((await nodeFs.lstat(fixture.sourcePath)).isSymbolicLink()).toBe(true);
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { label: "non-ASCII source", sourceName: "payload-é", tombstoneName: TOMBSTONE_NAME, ordinal: 0 },
    { label: "slash-bearing relative source", sourceName: "nested/payload", tombstoneName: TOMBSTONE_NAME, ordinal: 0 },
    { label: "wrong retained prefix", sourceName: SOURCE_NAME, tombstoneName: `.other.${BOOTSTRAP_ID}.0000000000.tombstone`, ordinal: 0 },
    { label: "wrong retained ordinal", sourceName: SOURCE_NAME, tombstoneName: `.developer-os-retained.${BOOTSTRAP_ID}.0000000001.tombstone`, ordinal: 0 },
    { label: "non-integer ordinal", sourceName: SOURCE_NAME, tombstoneName: TOMBSTONE_NAME, ordinal: 0.5 },
  ])("refuses $label before opening the parent", async ({ sourceName, tombstoneName, ordinal }) => {
    const fixture = await createFileFixture("grammar");
    let opened = 0;
    const request = {
      entry: {
        ...fixture.request.entry,
        ordinal,
        sourcePath: join(fixture.parentPath, sourceName) as CanonicalAbsolutePathV1,
        tombstonePath: join(fixture.parentPath, tombstoneName) as CanonicalAbsolutePathV1,
      },
    } as SameParentRenameNoReplaceV1;

    try {
      const operation = new MacOsRetainedRename(dependencies(
        { run: () => Promise.resolve({ exitCode: 0, signal: null }) },
        {
          openParent: async (path) => {
            opened += 1;
            return nodeFs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          },
        },
      ));
      const error = await operation.rename(request).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(MacOsRetainedRenameRefusalError);
      expect(error).toMatchObject({ code: EXIT_CODES.securityRefusal });
      expect(opened).toBe(0);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("preserves both names when the destination is already present", async () => {
    const fixture = await createFileFixture("destination-present");
    await nodeFs.writeFile(fixture.tombstonePath, "unrelated destination", { mode: 0o600 });
    const before = await Promise.all([pathIdentity(fixture.sourcePath), pathIdentity(fixture.tombstonePath)]);
    let calls = 0;

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: () => {
          calls += 1;
          return Promise.resolve({ exitCode: 0, signal: null });
        },
      })).rename(fixture.request)).rejects.toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(calls).toBe(0);
      expect(await Promise.all([pathIdentity(fixture.sourcePath), pathIdentity(fixture.tombstonePath)])).toEqual(before);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("classifies a missing source and destination as a third state", async () => {
    const fixture = await createFileFixture("source-missing");
    await nodeFs.rm(fixture.sourcePath);

    try {
      const error = await new MacOsRetainedRename(dependencies({
        run: () => Promise.resolve({ exitCode: 0, signal: null }),
      })).rename(fixture.request).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(error).toMatchObject({ code: EXIT_CODES.recoveryRequired });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("detects source replacement between observation and the child call", async () => {
    const fixture = await createFileFixture("replace-before");
    const displaced = join(fixture.parentPath, "displaced-source");
    let sourceObservations = 0;
    let calls = 0;
    const lstat = injectedLstat();
    const replacingLstat = (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
      const stats = await lstat(path, options as { bigint: true });
      if (String(path) === fixture.sourcePath && sourceObservations++ === 0) {
        await nodeFs.rename(fixture.sourcePath, displaced);
        await nodeFs.writeFile(fixture.sourcePath, "replacement", { mode: 0o600 });
      }
      return stats;
    }) as typeof nodeFs.lstat;

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: () => {
          calls += 1;
          return Promise.resolve({ exitCode: 0, signal: null });
        },
      }, { lstat: replacingLstat })).rename(fixture.request)).rejects.toBeInstanceOf(
        MacOsRetainedRenameThirdStateError,
      );
      expect(calls).toBe(0);
      expect(await pathIdentity(displaced)).toMatchObject({
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("detects source replacement after the child returns and preserves both inodes", async () => {
    const fixture = await createFileFixture("replace-after");
    let replacement: { readonly dev: bigint; readonly ino: bigint } | null = null;
    const runner: RenameAtxRunner = {
      run: async () => {
        await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
        await nodeFs.writeFile(fixture.sourcePath, "replacement after child", { mode: 0o600 });
        replacement = await pathIdentity(fixture.sourcePath);
        return { exitCode: 0, signal: null };
      },
    };

    try {
      await expect(new MacOsRetainedRename(dependencies(runner)).rename(fixture.request)).rejects.toBeInstanceOf(
        MacOsRetainedRenameThirdStateError,
      );
      expect(await pathIdentity(fixture.sourcePath)).toEqual(replacement);
      expect(await pathIdentity(fixture.tombstonePath)).toMatchObject({
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { result: { exitCode: 1, signal: null }, errorType: MacOsRetainedRenameRefusalError, code: EXIT_CODES.securityRefusal },
    { result: { exitCode: null, signal: "SIGTERM" as const }, errorType: MacOsRetainedRenameUnavailableError, code: EXIT_CODES.capabilityUnavailable },
    { result: { exitCode: null, signal: null }, errorType: MacOsRetainedRenameUnavailableError, code: EXIT_CODES.capabilityUnavailable },
  ])("classifies an unchanged pre-state after helper status $result", async ({ result, errorType, code }) => {
    const fixture = await createFileFixture("helper-status");

    try {
      const error = await new MacOsRetainedRename(dependencies({
        run: () => Promise.resolve(result),
      })).rename(fixture.request).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(errorType);
      expect(error).toMatchObject({ code });
      expect(await pathIdentity(fixture.sourcePath)).not.toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toBeNull();
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { state: "pre", expected: "unavailable" },
    { state: "post", expected: "success" },
    { state: "third", expected: "third" },
  ] as const)("settles an immediate runner rejection before delayed helper verification in the $state state", async ({ state, expected }) => {
    const fixture = await createFileFixture(`runner-rejection-${state}`);
    const runner: RenameAtxRunner = {
      run: () => {
        if (state === "post") renameSync(fixture.sourcePath, fixture.tombstonePath);
        if (state === "third") writeFileSync(fixture.tombstonePath, "unexpected destination", { mode: 0o600 });
        return Promise.reject(new Error("synthetic immediate runner rejection"));
      },
    };

    try {
      const outcome = await new MacOsRetainedRename(dependencies(runner, {
        lstat: delayedPostSpawnLstat(),
      })).rename(fixture.request).then(
        () => "success" as const,
        (error: unknown) => error instanceof MacOsRetainedRenameUnavailableError
          ? "unavailable" as const
          : error instanceof MacOsRetainedRenameThirdStateError
            ? "third" as const
            : "unexpected" as const,
      );
      expect(outcome).toBe(expected);
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { exitCode: null, signal: "SIGTERM" as const },
    { exitCode: null, signal: null },
  ])("accepts a verified post-state when child status is lost: $signal", async (result) => {
    const fixture = await createFileFixture("lost-status-post-state");

    try {
      await new MacOsRetainedRename(dependencies({
        run: async () => {
          await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
          return result;
        },
      })).rename(fixture.request);
      expect(await pathIdentity(fixture.sourcePath)).toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toMatchObject({
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("keeps the parent descriptor live through child exit after its pathname is swapped", async () => {
    const fixture = await createFileFixture("parent-swap");
    const movedParent = join(fixture.root, "moved-parent");
    let descriptorIdentity: bigint | null = null;
    const runner: RenameAtxRunner = {
      run: async ({ parentDescriptor }) => {
        await nodeFs.rename(fixture.parentPath, movedParent);
        await nodeFs.mkdir(fixture.parentPath, { mode: 0o700 });
        descriptorIdentity = fstatSync(parentDescriptor, { bigint: true }).ino;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fstatSync(parentDescriptor, { bigint: true }).ino).toBe(descriptorIdentity);
        return { exitCode: null, signal: "SIGTERM" };
      },
    };

    try {
      await expect(new MacOsRetainedRename(dependencies(runner)).rename(fixture.request)).rejects.toBeInstanceOf(
        MacOsRetainedRenameThirdStateError,
      );
      expect(descriptorIdentity).toBe(BigInt(fixture.request.entry.parent.ino));
      expect(await pathIdentity(join(movedParent, SOURCE_NAME))).not.toBeNull();
      expect(await pathIdentity(join(movedParent, TOMBSTONE_NAME))).toBeNull();
    } finally {
      await removeFixture(fixture);
    }
  });

  it("moves a regular file and verifies the admitted inode at the destination", async () => {
    const fixture = await createFileFixture("file-success");

    try {
      await new MacOsRetainedRename(dependencies({
        run: async () => {
          await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
          return { exitCode: 0, signal: null };
        },
      })).rename(fixture.request);
      expect(await pathIdentity(fixture.sourcePath)).toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toMatchObject({
        dev: BigInt(fixture.request.entry.postimage.dev),
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("moves a directory tree as one inode and leaves its child below it", async () => {
    const fixture = await createDirectoryFixture("directory-success");

    try {
      await new MacOsRetainedRename(dependencies({
        run: async () => {
          await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
          return { exitCode: 0, signal: null };
        },
      })).rename(fixture.request);
      expect(await pathIdentity(fixture.sourcePath)).toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toMatchObject({
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
      expect(await nodeFs.readFile(join(fixture.tombstonePath, "synthetic-child"), "utf8")).toBe("child");
    } finally {
      await removeFixture(fixture);
    }
  });

  it("rejects a reported success that leaves the pre-state unchanged", async () => {
    const fixture = await createFileFixture("false-success");

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: () => Promise.resolve({ exitCode: 0, signal: null }),
      })).rename(fixture.request)).rejects.toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(await pathIdentity(fixture.sourcePath)).not.toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toBeNull();
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each([
    { status: "success", result: { exitCode: 0, signal: null } },
    { status: "lost", result: { exitCode: null, signal: null } },
  ] as const)("rejects destination replacement between postprojection and no-follow reopen after $status status", async ({ result }) => {
    const fixture = await createFileFixture("replace-at-reopen");
    const displaced = join(fixture.parentPath, "displaced-tombstone");
    const expectedIno = BigInt(fixture.request.entry.postimage.ino);
    let replaced = false;
    const base = injectedLstat();
    const replacingLstat = (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
      const stats = await base(path, options as { bigint: true });
      if (String(path) === fixture.tombstonePath && stats.ino === expectedIno && !replaced) {
        replaced = true;
        renameSync(fixture.tombstonePath, displaced);
        writeFileSync(fixture.tombstonePath, "replacement at reopen", { mode: 0o600 });
      }
      return stats;
    }) as typeof nodeFs.lstat;

    try {
      const error = await new MacOsRetainedRename(dependencies({
        run: () => {
          renameSync(fixture.sourcePath, fixture.tombstonePath);
          return Promise.resolve(result);
        },
      }, { lstat: replacingLstat })).rename(fixture.request).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(replaced).toBe(true);
      expect(error).toBeInstanceOf(MacOsRetainedRenameThirdStateError);
      expect(await pathIdentity(displaced)).toMatchObject({ ino: expectedIno });
      expect(await pathIdentity(fixture.tombstonePath)).not.toMatchObject({ ino: expectedIno });
    } finally {
      await removeFixture(fixture);
    }
  });

  it.runIf(process.platform === "darwin")(
    "does not wait for a FIFO writer after destination replacement before reopen",
    async () => {
      const fixture = await createFileFixture("fifo-at-reopen");
      const displaced = join(fixture.parentPath, "displaced-fifo-tombstone");
      const expectedIno = BigInt(fixture.request.entry.postimage.ino);
      let replaced = false;
      let writerWasRequired = false;
      let releaseTimer: NodeJS.Timeout | undefined;
      let writerCompletion: Promise<void> | undefined;
      const base = injectedLstat();
      const replacingLstat = (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
        const stats = await base(path, options as { bigint: true });
        if (String(path) === fixture.tombstonePath && stats.ino === expectedIno && !replaced) {
          replaced = true;
          renameSync(fixture.tombstonePath, displaced);
          const mkfifo = spawnSync("/usr/bin/mkfifo", [fixture.tombstonePath], {
            shell: false,
            stdio: "ignore",
          });
          if (mkfifo.status !== 0) throw new Error("synthetic FIFO setup failed");
        }
        return stats;
      }) as typeof nodeFs.lstat;

      try {
        releaseTimer = setTimeout(() => {
          writerWasRequired = true;
          writerCompletion = nodeFs.open(fixture.tombstonePath, constants.O_WRONLY)
            .then(async (handle) => handle.close());
        }, 500);
        const error = await new MacOsRetainedRename(dependencies({
          run: () => {
            renameSync(fixture.sourcePath, fixture.tombstonePath);
            return Promise.resolve({ exitCode: 0, signal: null });
          },
        }, { lstat: replacingLstat })).rename(fixture.request).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        clearTimeout(releaseTimer);
        await writerCompletion;
        expect(replaced).toBe(true);
        expect(error).toBeInstanceOf(MacOsRetainedRenameThirdStateError);
        expect(writerWasRequired).toBe(false);
      } finally {
        if (releaseTimer !== undefined) clearTimeout(releaseTimer);
        await writerCompletion?.catch(() => undefined);
        await removeFixture(fixture);
      }
    },
  );

  it.runIf(process.platform === "darwin" && currentUid() !== 0)(
    "classifies an unreadable destination replacement race as a third state",
    async () => {
      const fixture = await createFileFixture("unreadable-at-reopen");
      const displaced = join(fixture.parentPath, "displaced-unreadable-tombstone");
      const expectedIno = BigInt(fixture.request.entry.postimage.ino);
      let replaced = false;
      const base = injectedLstat();
      const replacingLstat = (async (path: Parameters<typeof nodeFs.lstat>[0], options?: unknown) => {
        const stats = await base(path, options as { bigint: true });
        if (String(path) === fixture.tombstonePath && stats.ino === expectedIno && !replaced) {
          replaced = true;
          renameSync(fixture.tombstonePath, displaced);
          writeFileSync(fixture.tombstonePath, "unreadable replacement", { mode: 0o600 });
          chmodSync(fixture.tombstonePath, 0o000);
        }
        return stats;
      }) as typeof nodeFs.lstat;

      try {
        const error = await new MacOsRetainedRename(dependencies({
          run: () => {
            renameSync(fixture.sourcePath, fixture.tombstonePath);
            return Promise.resolve({ exitCode: 0, signal: null });
          },
        }, { lstat: replacingLstat })).rename(fixture.request).then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(replaced).toBe(true);
        expect(error).toBeInstanceOf(MacOsRetainedRenameThirdStateError);
        expect(error).toMatchObject({ code: EXIT_CODES.recoveryRequired });
      } finally {
        await removeFixture(fixture);
      }
    },
  );

  it("refuses an untrusted osascript before opening the parent", async () => {
    const fixture = await createFileFixture("untrusted-helper");
    let opened = 0;
    const untrusted = (): BigIntStats => ({
      ...syntheticExecutableStats(),
      mode: 0o100775n,
    });

    try {
      const error = await new MacOsRetainedRename(dependencies(
        { run: () => Promise.resolve({ exitCode: 0, signal: null }) },
        {
          lstat: injectedLstat(untrusted),
          openParent: async (path) => {
            opened += 1;
            return nodeFs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          },
        },
      )).rename(fixture.request).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(MacOsRetainedRenameRefusalError);
      expect(error).toMatchObject({ code: EXIT_CODES.securityRefusal });
      expect(opened).toBe(0);
    } finally {
      await removeFixture(fixture);
    }
  });

  it("refuses executable replacement immediately after the child is spawned", async () => {
    const fixture = await createFileFixture("helper-replacement");
    let observations = 0;
    const lstat = injectedLstat(() => syntheticExecutableStats({
      dev: 9_001n,
      ino: observations++ === 0 ? 9_002n : 9_003n,
    }));

    try {
      await expect(new MacOsRetainedRename(dependencies({
        run: async () => {
          await nodeFs.rename(fixture.sourcePath, fixture.tombstonePath);
          return { exitCode: 0, signal: null };
        },
      }, { lstat })).rename(fixture.request)).rejects.toBeInstanceOf(MacOsRetainedRenameRefusalError);
      expect(observations).toBe(2);
    } finally {
      await removeFixture(fixture);
    }
  });

  it.each(["fulfilled", "rejected"] as const)(
    "makes a third filesystem state dominate executable replacement after a %s child",
    async (settlement) => {
      const fixture = await createFileFixture(`helper-and-third-${settlement}`);
      let executableObservations = 0;
      const lstat = injectedLstat(() => syntheticExecutableStats({
        dev: 9_001n,
        ino: executableObservations++ === 0 ? 9_002n : 9_003n,
      }));
      const runner: RenameAtxRunner = {
        run: () => {
          writeFileSync(fixture.tombstonePath, "unexpected destination", { mode: 0o600 });
          return settlement === "fulfilled"
            ? Promise.resolve({ exitCode: 0, signal: null })
            : Promise.reject(new Error("synthetic runner rejection"));
        },
      };

      try {
        const error = await new MacOsRetainedRename(dependencies(runner, { lstat }))
          .rename(fixture.request)
          .then(
            () => undefined,
            (caught: unknown) => caught,
          );
        expect(error).toBeInstanceOf(MacOsRetainedRenameThirdStateError);
        expect(error).toMatchObject({ code: EXIT_CODES.recoveryRequired });
        expect(await pathIdentity(fixture.sourcePath)).not.toBeNull();
        expect(await pathIdentity(fixture.tombstonePath)).not.toBeNull();
      } finally {
        await removeFixture(fixture);
      }
    },
  );
});

it("requires the fixed osascript capability on a supported macOS host", async () => {
  if (process.platform !== "darwin") return;
  await expect(nodeFs.access(OSASCRIPT, constants.X_OK)).resolves.toBeUndefined();
});

describe.runIf(process.platform === "darwin")("SpawnRenameAtxRunner real kernel boundary", () => {
  it("atomically refuses an existing destination without changing either inode", async () => {
    const fixture = await createFileFixture("real-no-clobber");
    await nodeFs.writeFile(fixture.tombstonePath, "existing destination", { mode: 0o600 });
    const before = await Promise.all([pathIdentity(fixture.sourcePath), pathIdentity(fixture.tombstonePath)]);
    let parent: nodeFs.FileHandle | undefined;

    try {
      parent = await nodeFs.open(
        fixture.parentPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const result = await new SpawnRenameAtxRunner().run({
        parentDescriptor: parent.fd,
        sourceName: SOURCE_NAME,
        tombstoneName: TOMBSTONE_NAME,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.signal).toBeNull();
      expect(await Promise.all([pathIdentity(fixture.sourcePath), pathIdentity(fixture.tombstonePath)])).toEqual(before);

      await expect(new MacOsRetainedRename().rename(fixture.request)).rejects.toBeInstanceOf(
        MacOsRetainedRenameThirdStateError,
      );
      expect(await Promise.all([pathIdentity(fixture.sourcePath), pathIdentity(fixture.tombstonePath)])).toEqual(before);
    } finally {
      await parent?.close();
      await removeFixture(fixture);
    }
  });

  it("moves a regular file through renameatx_np without replacing another name", async () => {
    const fixture = await createFileFixture("real-file");

    try {
      await new MacOsRetainedRename().rename(fixture.request);
      expect(await pathIdentity(fixture.sourcePath)).toBeNull();
      expect(await pathIdentity(fixture.tombstonePath)).toMatchObject({
        ino: BigInt(fixture.request.entry.postimage.ino),
      });
    } finally {
      await removeFixture(fixture);
    }
  });

  it("moves a directory tree through renameatx_np as one retained root", async () => {
    const fixture = await createDirectoryFixture("real-directory");

    try {
      await new MacOsRetainedRename().rename(fixture.request);
      expect(await pathIdentity(fixture.sourcePath)).toBeNull();
      expect(await nodeFs.readFile(join(fixture.tombstonePath, "synthetic-child"), "utf8")).toBe("child");
    } finally {
      await removeFixture(fixture);
    }
  });
});
