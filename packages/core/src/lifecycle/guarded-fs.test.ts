import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  LifecycleRecoveryRequiredError,
  createNodeLifecycleGuardedFileSystem,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  createInMemoryLifecycleGuardedFileSystem,
  createLinkUnlinkRenameNoReplace,
  recordLifecycleGuardedTranscript,
  type LifecycleRenameNoReplaceDoubleV1,
} from "./testing.js";

const encoder = new TextEncoder();
const UID = process.getuid?.() ?? 0;
const MEBIBYTE = 1_048_576;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

async function freshRoot(label: string): Promise<CanonicalAbsolutePathV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`));
  roots.push(created);
  await nodeFs.chmod(created, 0o700);
  return parseCanonicalAbsolutePathText(created);
}

function leaf(root: CanonicalAbsolutePathV1, ...segments: readonly string[]): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(join(root, ...segments));
}

function nodePort(): {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly double: LifecycleRenameNoReplaceDoubleV1;
} {
  const double = createLinkUnlinkRenameNoReplace();
  return {
    fs: createNodeLifecycleGuardedFileSystem({
      renameNoReplace: double.publish,
      effectiveUid: UID,
    }),
    double,
  };
}

async function collect(names: AsyncIterable<string>): Promise<readonly string[]> {
  const collected: string[] = [];
  for await (const name of names) collected.push(name);
  return collected.sort();
}

async function reasonOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) return error.reason;
    return `unexpected:${String(error)}`;
  }
  return "resolved";
}

describe("the guarded filesystem port", () => {
  it("returns null for an absent path and classifies a symlink without following it", async () => {
    const root = await freshRoot("guarded-lstat");
    const { fs } = nodePort();
    await nodeFs.writeFile(leaf(root, "target"), "bytes", { mode: 0o600 });
    await nodeFs.symlink(leaf(root, "target"), leaf(root, "link"));

    expect(await fs.lstat(leaf(root, "absent"))).toBeNull();
    expect((await fs.lstat(leaf(root, "link")))?.kind).toBe("symlink");
    expect((await fs.lstat(leaf(root, "target")))?.kind).toBe("regular_file");
    expect((await fs.lstat(root))?.kind).toBe("directory");
  });

  it("records an inode number that a JavaScript number would round", async () => {
    const root = await freshRoot("guarded-ino");
    const { fs } = nodePort();
    const entry = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("x"));
    const exact = await nodeFs.lstat(entry.path, { bigint: true });

    expect(entry.ino).toBe(exact.ino.toString(10));
    expect(entry.dev).toBe(exact.dev.toString(10));
  });

  it("creates an owner-only 0600 single-link file and returns its reopened identity", async () => {
    const root = await freshRoot("guarded-write");
    const { fs } = nodePort();
    const entry = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("hello\n"));

    expect(entry).toMatchObject({ kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: "6" });
    expect(await nodeFs.readFile(entry.path, "utf8")).toBe("hello\n");
    expect(await fs.readRegular(entry, 16)).toStrictEqual(encoder.encode("hello\n"));
  });

  it("refuses writeExclusive at an existing path or a symlink and leaves the bytes", async () => {
    const root = await freshRoot("guarded-exclusive");
    const { fs } = nodePort();
    await nodeFs.writeFile(leaf(root, "leaf"), "existing", { mode: 0o600 });
    await nodeFs.symlink(leaf(root, "leaf"), leaf(root, "link"));

    expect(await reasonOf(() => fs.writeExclusive(leaf(root, "leaf"), encoder.encode("new")))).toBe(
      "lifecycle_guarded_path_exists",
    );
    expect(await reasonOf(() => fs.writeExclusive(leaf(root, "link"), encoder.encode("new")))).toBe(
      "lifecycle_guarded_path_exists",
    );
    expect(await nodeFs.readFile(leaf(root, "leaf"), "utf8")).toBe("existing");
  });

  it("refuses readRegular above its maximum and for an identity that moved", async () => {
    const root = await freshRoot("guarded-read");
    const { fs } = nodePort();
    const entry = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("0123456789"));

    expect(await reasonOf(() => fs.readRegular(entry, 9))).toBe("lifecycle_guarded_size");
    await nodeFs.rm(entry.path);
    await nodeFs.writeFile(entry.path, "0123456789", { mode: 0o600 });
    expect(await reasonOf(() => fs.readRegular(entry, 16))).toBe("lifecycle_guarded_identity");
  });

  it("hashes a 20-MiB sparse file through one reused 1-MiB chunk", async () => {
    const root = await freshRoot("guarded-hash");
    const { fs } = nodePort();
    const target = leaf(root, "sparse.bin");
    const created = await nodeFs.open(target, "w", 0o600);
    await created.truncate(20 * MEBIBYTE);
    await created.close();
    const entry = await fs.lstat(target);
    if (entry === null) throw new Error("fixture file is absent");

    const probe = await nodeFs.open(target, "r");
    const prototype = Object.getPrototypeOf(probe) as { read: (...args: unknown[]) => unknown };
    await probe.close();
    const original = prototype.read;
    const buffers = new Set<object>();
    const sizes: number[] = [];
    prototype.read = function spy(this: unknown, ...args: unknown[]): unknown {
      const buffer: unknown = args[0];
      if (buffer instanceof Uint8Array) {
        buffers.add(buffer);
        sizes.push(buffer.byteLength);
      }
      return original.apply(this, args);
    };
    let hash: string;
    try {
      hash = await fs.hashRegular(entry, BigInt(32 * MEBIBYTE));
    } finally {
      prototype.read = original;
    }

    expect(entry.size).toBe(String(20 * MEBIBYTE));
    expect(sizes.length).toBeGreaterThanOrEqual(20);
    expect(Math.max(...sizes)).toBe(MEBIBYTE);
    expect(buffers.size).toBe(1);
    expect(hash).toBe("cd52d81e25f372e6fa4db2c0dfceb59862c1969cab17096da352b34950c973cc");
  });

  it("refuses hashRegular above its maximum", async () => {
    const root = await freshRoot("guarded-hash-bound");
    const { fs } = nodePort();
    const entry = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("0123456789"));

    expect(await reasonOf(() => fs.hashRegular(entry, 9n))).toBe("lifecycle_guarded_size");
    expect(await fs.hashRegular(entry, 10n)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses names when the directory identity changes during iteration", async () => {
    const root = await freshRoot("guarded-names");
    const { fs } = nodePort();
    const directory = await fs.mkdirExclusive(leaf(root, "branch"));
    for (const name of ["a", "b", "c"]) {
      await fs.writeExclusive(leaf(directory.path, name), encoder.encode(name));
    }

    expect(await collect(fs.names(directory))).toStrictEqual(["a", "b", "c"]);

    const swapped = async (): Promise<readonly string[]> => {
      const seen: string[] = [];
      for await (const name of fs.names(directory)) {
        seen.push(name);
        if (seen.length === 1) {
          await nodeFs.rename(directory.path, leaf(root, "moved"));
          await nodeFs.mkdir(directory.path, { mode: 0o700 });
        }
      }
      return seen;
    };
    expect(await reasonOf(swapped)).toBe("lifecycle_guarded_identity");
  });

  it("refuses unlinkExact and rmdirExactEmpty for an identity that changed, and deletes nothing", async () => {
    const root = await freshRoot("guarded-unlink");
    const { fs } = nodePort();
    const file = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("bytes"));
    const directory = await fs.mkdirExclusive(leaf(root, "branch"));

    await nodeFs.rm(file.path);
    await nodeFs.writeFile(file.path, "replacement", { mode: 0o600 });
    await nodeFs.rmdir(directory.path);
    await nodeFs.mkdir(directory.path, { mode: 0o700 });

    expect(await reasonOf(() => fs.unlinkExact(file))).toBe("lifecycle_guarded_identity");
    expect(await reasonOf(() => fs.rmdirExactEmpty(directory))).toBe("lifecycle_guarded_identity");
    expect(await nodeFs.readFile(file.path, "utf8")).toBe("replacement");
    expect((await nodeFs.lstat(directory.path)).isDirectory()).toBe(true);
  });

  it("refuses rmdirExactEmpty for a non-empty directory and unlinkExact for a directory", async () => {
    const root = await freshRoot("guarded-rmdir");
    const { fs } = nodePort();
    const directory = await fs.mkdirExclusive(leaf(root, "branch"));
    await fs.writeExclusive(leaf(directory.path, "child"), encoder.encode("c"));
    const reopened = await fs.lstat(directory.path);
    if (reopened === null) throw new Error("fixture directory is absent");

    expect(await reasonOf(() => fs.rmdirExactEmpty(reopened))).toBe("lifecycle_guarded_not_empty");
    expect(await reasonOf(() => fs.unlinkExact(reopened))).toBe("lifecycle_guarded_kind");
    expect((await nodeFs.lstat(directory.path)).isDirectory()).toBe(true);
  });

  it("renameOver replaces inside one parent and refuses two parents or a moved identity", async () => {
    const root = await freshRoot("guarded-rename-over");
    const { fs } = nodePort();
    const source = await fs.writeExclusive(leaf(root, "source"), encoder.encode("new"));
    const destination = await fs.writeExclusive(leaf(root, "destination"), encoder.encode("old"));
    const elsewhere = await fs.mkdirExclusive(leaf(root, "branch"));
    const outside = await fs.writeExclusive(leaf(elsewhere.path, "destination"), encoder.encode("far"));

    expect(await reasonOf(() => fs.renameOver(source, outside))).toBe("lifecycle_guarded_parent");
    await fs.renameOver(source, destination);
    expect(await nodeFs.readFile(destination.path, "utf8")).toBe("new");
    expect(await fs.lstat(source.path)).toBeNull();
    expect(await reasonOf(() => fs.renameOver(source, destination))).toBe("lifecycle_guarded_identity");
  });

  it("renameNoReplace publishes the regular_file postimage through the injected port", async () => {
    const root = await freshRoot("guarded-rename-noreplace");
    const { fs, double } = nodePort();
    const source = await fs.writeExclusive(leaf(root, "source"), encoder.encode("bytes\n"));
    const parent = await fs.lstat(root);

    await fs.renameNoReplace(source, leaf(root, "destination"));

    expect(await nodeFs.readFile(leaf(root, "destination"), "utf8")).toBe("bytes\n");
    expect(await fs.lstat(source.path)).toBeNull();
    expect(double.requests).toHaveLength(1);
    expect(double.requests[0]).toMatchObject({
      sourcePath: source.path,
      destinationPath: leaf(root, "destination"),
      sourceParent: { path: root, ownerUid: UID, mode: 0o700, dev: parent?.dev, ino: parent?.ino },
      destinationParent: { path: root, ownerUid: UID, mode: 0o700 },
      postimage: {
        kind: "regular_file",
        ownerUid: UID,
        mode: 0o600,
        nlink: 1,
        bytes: "6",
        dev: source.dev,
        ino: source.ino,
      },
    });
  });

  it("refuses renameNoReplace at an existing destination and leaves both", async () => {
    const root = await freshRoot("guarded-noreplace-exists");
    const { fs, double } = nodePort();
    const source = await fs.writeExclusive(leaf(root, "source"), encoder.encode("source"));
    await fs.writeExclusive(leaf(root, "destination"), encoder.encode("destination"));

    expect(await reasonOf(() => fs.renameNoReplace(source, leaf(root, "destination")))).toBe(
      "lifecycle_guarded_path_exists",
    );
    expect(double.requests).toHaveLength(0);
    expect(await nodeFs.readFile(source.path, "utf8")).toBe("source");
    expect(await nodeFs.readFile(leaf(root, "destination"), "utf8")).toBe("destination");
  });

  it("refuses syncDirectory and mkdirExclusive against a replaced or existing directory", async () => {
    const root = await freshRoot("guarded-sync");
    const { fs } = nodePort();
    const directory = await fs.mkdirExclusive(leaf(root, "branch"));

    await fs.syncDirectory(directory);
    expect(await reasonOf(() => fs.mkdirExclusive(directory.path))).toBe("lifecycle_guarded_path_exists");

    await nodeFs.rmdir(directory.path);
    await nodeFs.mkdir(directory.path, { mode: 0o700 });
    expect(await reasonOf(() => fs.syncDirectory(directory))).toBe("lifecycle_guarded_identity");
  });

  it("syncs the parent only when a caller asks, so a temp survives its own fsync", async () => {
    const root = await freshRoot("guarded-parent-sync");
    const { fs } = nodePort();
    const entry = await fs.writeExclusive(leaf(root, "leaf"), encoder.encode("bytes"));
    const parent = await fs.lstat(root);
    if (parent === null) throw new Error("fixture root is absent");

    await fs.syncDirectory(parent);
    expect((await fs.lstat(entry.path))?.ino).toBe(entry.ino);
  });
});

describe("the in-memory guarded filesystem port", () => {
  it("matches the Node port on the agreement tree", async () => {
    const physicalRoot = await freshRoot("guarded-agreement");
    const { fs } = nodePort();
    const memory = createInMemoryLifecycleGuardedFileSystem({
      effectiveUid: UID,
      root: parseCanonicalAbsolutePathText("/memory/root"),
    });

    const physical = await recordLifecycleGuardedTranscript(fs, physicalRoot);
    const injected = await recordLifecycleGuardedTranscript(
      memory,
      parseCanonicalAbsolutePathText("/memory/root"),
    );

    expect(physical.length).toBeGreaterThan(0);
    expect(injected).toStrictEqual(physical);
  });

  it("counts every call it serves", async () => {
    const memory = createInMemoryLifecycleGuardedFileSystem({
      effectiveUid: UID,
      root: parseCanonicalAbsolutePathText("/memory/counted"),
    });

    await recordLifecycleGuardedTranscript(memory, parseCanonicalAbsolutePathText("/memory/counted"));

    expect([...memory.callCounts.keys()].sort()).toStrictEqual([
      "hashRegular",
      "lstat",
      "mkdirExclusive",
      "names",
      "readRegular",
      "renameNoReplace",
      "renameOver",
      "rmdirExactEmpty",
      "syncDirectory",
      "unlinkExact",
      "writeExclusive",
    ]);
    expect(memory.callCounts.get("writeExclusive")).toBeGreaterThan(0);
  });
});
