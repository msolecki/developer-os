/**
 * Test-only companions to `guarded-fs.ts`. Imported by tests, never by a
 * package index or door list: an in-memory port exists so a §7 ceiling can be
 * proven at its exact maximum through the production counting path (A8), and
 * A8 also requires one small physical fixture proving the injected and real
 * ports agree — that is `recordLifecycleGuardedTranscript`, run against both.
 */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";

import type {
  BootstrapInitialJournalPublicationV1,
  PublishBootstrapInitialJournalNoReplace,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal, type LowerHexSha256 } from "../update/scalars.js";
import {
  LifecycleRecoveryRequiredError,
  lifecycleParentPath,
  refuseLifecycleRecovery,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleGuardedKindV1,
} from "./guarded-fs.js";

const encoder = new TextEncoder();

export interface LifecycleRenameNoReplaceDoubleV1 {
  readonly publish: PublishBootstrapInitialJournalNoReplace;
  readonly requests: readonly BootstrapInitialJournalPublicationV1[];
}

/**
 * The platform's `renameat2`/`RENAME_EXCL` equivalent is not reachable from
 * Node, and the production port receives it injected. A hard link followed by
 * an unlink of the source is the portable no-replace publication: `link` itself
 * fails `EEXIST` when the destination exists.
 */
export function createLinkUnlinkRenameNoReplace(): LifecycleRenameNoReplaceDoubleV1 {
  const requests: BootstrapInitialJournalPublicationV1[] = [];
  return {
    requests,
    publish: async (request) => {
      requests.push(request);
      await nodeFs.link(request.sourcePath, request.destinationPath);
      await nodeFs.unlink(request.sourcePath);
    },
  };
}

interface MemoryNodeV1 {
  kind: LifecycleGuardedKindV1;
  ownerUid: number;
  mode: number;
  nlink: number;
  ino: bigint;
  bytes: Uint8Array;
}

export interface LifecycleCountingGuardedFileSystemV1 extends LifecycleGuardedFileSystemV1 {
  readonly callCounts: ReadonlyMap<string, number>;
}

const MEMORY_DEVICE = 4_294_967_296n;

export function createInMemoryLifecycleGuardedFileSystem(dependencies: {
  readonly effectiveUid: number;
  readonly root: CanonicalAbsolutePathV1;
}): LifecycleCountingGuardedFileSystemV1 {
  const nodes = new Map<string, MemoryNodeV1>();
  const callCounts = new Map<string, number>();
  let nextIno = 2n;

  function count(method: string): void {
    callCounts.set(method, (callCounts.get(method) ?? 0) + 1);
  }

  nodes.set(dependencies.root, {
    kind: "directory",
    ownerUid: dependencies.effectiveUid,
    mode: 0o700,
    nlink: 2,
    ino: 1n,
    bytes: new Uint8Array(0),
  });

  function entryOf(path: CanonicalAbsolutePathV1, node: MemoryNodeV1): LifecycleGuardedEntryV1 {
    return {
      path,
      kind: node.kind,
      ownerUid: node.ownerUid,
      mode: node.mode,
      nlink: node.nlink,
      size: parseUInt64Decimal(
        (node.kind === "directory" ? 0 : node.bytes.byteLength).toString(10),
      ),
      dev: parseUInt64Decimal(MEMORY_DEVICE.toString(10)),
      ino: parseUInt64Decimal(node.ino.toString(10)),
    };
  }

  function lookup(path: CanonicalAbsolutePathV1): LifecycleGuardedEntryV1 | null {
    const node = nodes.get(path);
    return node === undefined ? null : entryOf(path, node);
  }

  function childNames(path: CanonicalAbsolutePathV1): readonly string[] {
    const prefix = `${path}/`;
    return [...nodes.keys()]
      .filter((candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"))
      .map((candidate) => candidate.slice(prefix.length));
  }

  function requireNode(entry: LifecycleGuardedEntryV1): MemoryNodeV1 {
    const node = nodes.get(entry.path);
    if (node === undefined || !sameLifecycleGuardedIdentity(entryOf(entry.path, node), entry)) {
      refuseLifecycleRecovery("lifecycle_guarded_identity", entry.path);
    }
    return node;
  }

  function requireOwnedRegular(entry: LifecycleGuardedEntryV1): void {
    if (entry.kind !== "regular_file") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
    if (entry.ownerUid !== dependencies.effectiveUid) {
      refuseLifecycleRecovery("lifecycle_guarded_owner", entry.path);
    }
  }

  function requireOwnedParent(path: CanonicalAbsolutePathV1): void {
    const parent = nodes.get(lifecycleParentPath(path));
    if (parent === undefined || parent.kind !== "directory" || parent.mode !== 0o700 ||
      parent.ownerUid !== dependencies.effectiveUid) {
      refuseLifecycleRecovery("lifecycle_guarded_parent", lifecycleParentPath(path));
    }
  }

  function create(
    path: CanonicalAbsolutePathV1,
    kind: LifecycleGuardedKindV1,
    mode: number,
    bytes: Uint8Array,
  ): LifecycleGuardedEntryV1 {
    if (nodes.has(path)) refuseLifecycleRecovery("lifecycle_guarded_path_exists", path);
    requireOwnedParent(path);
    const node: MemoryNodeV1 = {
      kind,
      ownerUid: dependencies.effectiveUid,
      mode,
      nlink: kind === "directory" ? 2 : 1,
      ino: nextIno,
      bytes,
    };
    nextIno += 1n;
    nodes.set(path, node);
    return entryOf(path, node);
  }

  async function* streamNames(directory: LifecycleGuardedEntryV1): AsyncGenerator<string> {
    count("names");
    if (directory.kind !== "directory") {
      refuseLifecycleRecovery("lifecycle_guarded_kind", directory.path);
    }
    requireNode(directory);
    for (const name of childNames(directory.path)) {
      yield await Promise.resolve(name);
    }
    requireNode(directory);
  }

  function digestOf(bytes: Uint8Array): LowerHexSha256 {
    return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
  }

  return {
    callCounts,
    lstat: (path) => {
      count("lstat");
      return Promise.resolve(lookup(path));
    },
    readRegular: (entry, maximumBytes) => {
      count("readRegular");
      requireOwnedRegular(entry);
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
        throw new Error("maximumBytes must be a non-negative safe integer");
      }
      if (BigInt(entry.size) > BigInt(maximumBytes)) {
        refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
      }
      return Promise.resolve(Uint8Array.from(requireNode(entry).bytes));
    },
    hashRegular: (entry, maximumBytes) => {
      count("hashRegular");
      requireOwnedRegular(entry);
      if (BigInt(entry.size) > maximumBytes) {
        refuseLifecycleRecovery("lifecycle_guarded_size", entry.path);
      }
      return Promise.resolve(digestOf(requireNode(entry).bytes));
    },
    names: (directory) => streamNames(directory),
    writeExclusive: (path, bytes) => {
      count("writeExclusive");
      return Promise.resolve(create(path, "regular_file", 0o600, Uint8Array.from(bytes)));
    },
    mkdirExclusive: (path) => {
      count("mkdirExclusive");
      return Promise.resolve(create(path, "directory", 0o700, new Uint8Array(0)));
    },
    renameOver: (source, destination) => {
      count("renameOver");
      if (lifecycleParentPath(source.path) !== lifecycleParentPath(destination.path)) {
        refuseLifecycleRecovery("lifecycle_guarded_parent", source.path, destination.path);
      }
      const moved = requireNode(source);
      requireNode(destination);
      nodes.delete(source.path);
      nodes.set(destination.path, moved);
      return Promise.resolve();
    },
    renameNoReplace: (source, destinationPath) => {
      count("renameNoReplace");
      requireOwnedRegular(source);
      if (source.nlink !== 1 || (source.mode !== 0o600 && source.mode !== 0o700)) {
        refuseLifecycleRecovery("lifecycle_guarded_postimage", source.path);
      }
      const moved = requireNode(source);
      if (nodes.has(destinationPath)) {
        refuseLifecycleRecovery("lifecycle_guarded_path_exists", destinationPath);
      }
      requireOwnedParent(destinationPath);
      nodes.delete(source.path);
      nodes.set(destinationPath, moved);
      return Promise.resolve();
    },
    unlinkExact: (entry) => {
      count("unlinkExact");
      if (entry.kind === "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
      requireNode(entry);
      nodes.delete(entry.path);
      return Promise.resolve();
    },
    rmdirExactEmpty: (entry) => {
      count("rmdirExactEmpty");
      if (entry.kind !== "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
      requireNode(entry);
      const [first] = childNames(entry.path);
      if (first !== undefined) {
        refuseLifecycleRecovery("lifecycle_guarded_not_empty", `${entry.path}/${first}`);
      }
      nodes.delete(entry.path);
      return Promise.resolve();
    },
    syncDirectory: (entry) => {
      count("syncDirectory");
      if (entry.kind !== "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", entry.path);
      requireNode(entry);
      return Promise.resolve();
    },
  };
}


function leafOf(root: CanonicalAbsolutePathV1, ...segments: readonly string[]): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText([root, ...segments].join("/"));
}

async function record(
  transcript: unknown[],
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    transcript.push([label, await action()]);
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) {
      transcript.push([label, { refused: error.reason, code: error.code }]);
      return;
    }
    throw error;
  }
}

/**
 * A8's port-agreement fixture: one scripted pass over every method of the
 * guarded port, reduced to values that cannot depend on the root's name or on
 * device and inode numbering. The Node port runs it against a physical `0700`
 * directory and the in-memory port against its own root; both transcripts must
 * be identical. Later tasks reuse it whenever they prove an injected enumerator
 * agrees with the real one.
 */
export async function recordLifecycleGuardedTranscript(
  fs: LifecycleGuardedFileSystemV1,
  root: CanonicalAbsolutePathV1,
): Promise<readonly unknown[]> {
  const transcript: unknown[] = [];
  const branch = leafOf(root, "branch");
  const nested = leafOf(root, "branch", "nested");
  const first = leafOf(root, "branch", "first.json");
  const second = leafOf(root, "branch", "second.json");
  const moved = leafOf(root, "branch", "moved.json");
  const bytes = encoder.encode('{"schemaVersion":1}\n');

  /** Device and inode numbers, and a directory's own link count and size, legitimately differ between ports. */
  const shape = (entry: LifecycleGuardedEntryV1 | null): Readonly<Record<string, unknown>> | null => {
    if (entry === null) return null;
    const common = {
      relative: entry.path.slice(root.length),
      kind: entry.kind,
      ownerUid: entry.ownerUid,
      mode: entry.mode,
    };
    return entry.kind === "directory" ? common : { ...common, nlink: entry.nlink, size: entry.size };
  };

  const existing = async (path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> => {
    const entry = await fs.lstat(path);
    if (entry === null) throw new Error(`agreement fixture lost ${path}`);
    return entry;
  };

  const collect = async (directory: CanonicalAbsolutePathV1): Promise<readonly string[]> => {
    const names: string[] = [];
    for await (const name of fs.names(await existing(directory))) names.push(name);
    return names.sort();
  };

  await record(transcript, "lstat root", async () => shape(await fs.lstat(root)));
  await record(transcript, "lstat absent", async () => shape(await fs.lstat(leafOf(root, "absent"))));
  await record(transcript, "mkdir branch", async () => shape(await fs.mkdirExclusive(branch)));
  await record(transcript, "mkdir nested", async () => shape(await fs.mkdirExclusive(nested)));
  await record(transcript, "mkdir branch twice", async () => shape(await fs.mkdirExclusive(branch)));
  await record(transcript, "write first", async () => shape(await fs.writeExclusive(first, bytes)));
  await record(transcript, "write first twice", async () => shape(await fs.writeExclusive(first, bytes)));
  await record(transcript, "write second", async () => shape(await fs.writeExclusive(second, new Uint8Array(0))));
  await record(transcript, "names root", () => collect(root));
  await record(transcript, "names branch", () => collect(branch));
  await record(transcript, "names nested", () => collect(nested));
  await record(transcript, "read first", async () => [...(await fs.readRegular(await existing(first), 4096))]);
  await record(transcript, "read first bounded", async () => fs.readRegular(await existing(first), 4));
  await record(transcript, "hash first", async () => fs.hashRegular(await existing(first), 4096n));
  await record(transcript, "hash first bounded", async () => fs.hashRegular(await existing(first), 4n));
  await record(transcript, "hash second", async () => fs.hashRegular(await existing(second), 4096n));
  await record(transcript, "sync branch", async () => {
    await fs.syncDirectory(await existing(branch));
    return "synced";
  });
  await record(transcript, "rmdir branch while populated", async () => {
    await fs.rmdirExactEmpty(await existing(branch));
    return "removed";
  });
  await record(transcript, "rmdir nested", async () => {
    await fs.rmdirExactEmpty(await existing(nested));
    return shape(await fs.lstat(nested));
  });
  await record(transcript, "unlink branch", async () => {
    await fs.unlinkExact(await existing(branch));
    return "unlinked";
  });
  await record(transcript, "rename first over second", async () => {
    await fs.renameOver(await existing(first), await existing(second));
    return shape(await fs.lstat(second));
  });
  await record(transcript, "rename across parents", async () => {
    await fs.renameOver(await existing(second), await existing(root));
    return "renamed";
  });
  await record(transcript, "rename no replace", async () => {
    await fs.renameNoReplace(await existing(second), moved);
    return shape(await fs.lstat(moved));
  });
  await record(transcript, "rename no replace onto itself", async () => {
    await fs.renameNoReplace(await existing(moved), moved);
    return "renamed";
  });
  await record(transcript, "names branch after moves", () => collect(branch));
  const movedIdentity = await existing(moved);
  await record(transcript, "unlink moved", async () => {
    await fs.unlinkExact(movedIdentity);
    return shape(await fs.lstat(moved));
  });
  await record(transcript, "unlink moved twice", async () => {
    await fs.unlinkExact(movedIdentity);
    return "unlinked";
  });
  await record(transcript, "rmdir branch when empty", async () => {
    await fs.rmdirExactEmpty(await existing(branch));
    return shape(await fs.lstat(branch));
  });
  await record(transcript, "names root when empty", () => collect(root));

  return transcript;
}
