import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeLifecycleGuardedFileSystem, type LifecycleGuardedEntryV1 } from "../lifecycle/guarded-fs.js";
import { UID, createLinkUnlinkRenameNoReplace } from "../lifecycle/testing.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseValidatedGitBranch } from "../config/lifecycle.js";
import {
  GitMetadataRefusalError,
  createNodeGitMetadataStream,
  inspectGitMetadata,
  type GitMetadataDependencies,
  type GitMetadataRequestV1,
} from "./metadata.js";
import { GIT_METADATA_BOUNDS, validateGitSourceState } from "./types.js";

const OID = "0123456789abcdef0123456789abcdef01234567";
const CONFIG = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";
const REFLOG_LINE = `${"0".repeat(40)} ${OID} Synthetic Tester <tester@example.invalid> 1790000000 +0000\tcommit (initial): seed\n`;
const SECRET = "ghp_SyntheticSecretValue0123456789";
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

interface IndexEntrySpec {
  readonly name: string;
  readonly mode?: number;
  readonly flags?: number;
}

interface IndexSpec {
  readonly version?: number;
  readonly entries: readonly IndexEntrySpec[];
  readonly extensions?: readonly { readonly signature: string; readonly data: Uint8Array }[];
  readonly corruptChecksum?: boolean;
}

function indexBytes(spec: IndexSpec): Uint8Array {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write("DIRC", 0, "ascii");
  header.writeUInt32BE(spec.version ?? 2, 4);
  header.writeUInt32BE(spec.entries.length, 8);
  parts.push(header);
  for (const entry of spec.entries) {
    const name = Buffer.from(entry.name, "utf8");
    const fixed = Buffer.alloc(62);
    fixed.writeUInt32BE(entry.mode ?? 0o100644, 24);
    fixed.writeUInt32BE(UID, 28);
    fixed.write(OID, 40, "hex");
    fixed.writeUInt16BE((entry.flags ?? 0) | Math.min(name.byteLength, 0xfff), 60);
    parts.push(fixed, name, Buffer.alloc(8 - ((62 + name.byteLength) % 8)));
  }
  for (const extension of spec.extensions ?? []) {
    const extensionHeader = Buffer.alloc(8);
    extensionHeader.write(extension.signature, 0, "ascii");
    extensionHeader.writeUInt32BE(extension.data.byteLength, 4);
    parts.push(extensionHeader, Buffer.from(extension.data));
  }
  const body = Buffer.concat(parts);
  const checksum = createHash("sha1").update(body).digest();
  if (spec.corruptChecksum === true) checksum[0] = (checksum[0] as number) ^ 0xff;
  return Buffer.concat([body, checksum]);
}

function treeExtension(): Uint8Array {
  const oid = Buffer.from(OID, "hex");
  return Buffer.concat([Buffer.from("\u00002 1\n", "binary"), oid, Buffer.from("docs\u00001 0\n", "binary"), oid]);
}

const PLAIN_ENTRIES: readonly IndexEntrySpec[] = [{ name: "content/a.md" }, { name: "content/b.md", mode: 0o100755 }];

interface Repository {
  readonly root: CanonicalAbsolutePathV1;
  readonly git: string;
  write(relative: string, bytes: string | Uint8Array): Promise<void>;
  sparse(relative: string, size: number, lastByte?: number): Promise<void>;
  request(branch?: string | null): GitMetadataRequestV1;
}

async function repository(options: { readonly born?: boolean } = {}): Promise<Repository> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-git-metadata-"));
  roots.push(created);
  const root = parseCanonicalAbsolutePathText(await nodeFs.realpath(created));
  const git = join(root, ".git");
  const write = async (relative: string, bytes: string | Uint8Array): Promise<void> => {
    await nodeFs.mkdir(dirname(join(git, relative)), { recursive: true });
    await nodeFs.writeFile(join(git, relative), bytes);
  };
  const sparse = async (relative: string, size: number, lastByte?: number): Promise<void> => {
    await write(relative, "");
    await nodeFs.truncate(join(git, relative), size);
    if (lastByte !== undefined) {
      const handle = await nodeFs.open(join(git, relative), "r+");
      await handle.write(Uint8Array.of(lastByte), 0, 1, size - 1);
      await handle.close();
    }
  };
  await nodeFs.mkdir(join(git, "objects"), { recursive: true });
  await nodeFs.mkdir(join(git, "refs", "heads"), { recursive: true });
  await write("config", CONFIG);
  await write("HEAD", "ref: refs/heads/main\n");
  if (options.born !== false) {
    await write("refs/heads/main", `${OID}\n`);
    await write("index", indexBytes({ entries: PLAIN_ENTRIES }));
    await write("logs/HEAD", REFLOG_LINE);
    await write("logs/refs/heads/main", REFLOG_LINE);
  }
  return {
    root,
    git,
    write,
    sparse,
    request: (branch = "main") => ({ repositoryRoot: root, branch: branch === null ? null : parseValidatedGitBranch(branch) }),
  };
}

interface CountingDependencies extends GitMetadataDependencies {
  readonly hashCalls: number;
  readonly bufferAllocations: number;
}

/**
 * Counts every content read of one watched leaf: a buffer materialized by
 * `readRegular` or a chunk delivered by `streamRegular`, either of which is
 * the only way bytes can reach a hash or a parse.
 */
function dependencies(options: {
  readonly watch?: string;
  readonly effectiveUid?: number;
  readonly afterLstat?: (entry: LifecycleGuardedEntryV1) => Promise<void>;
} = {}): CountingDependencies {
  const fs = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: options.effectiveUid ?? UID,
  });
  const stream = createNodeGitMetadataStream();
  let hashCalls = 0;
  let bufferAllocations = 0;
  const watched = (entry: LifecycleGuardedEntryV1): boolean => options.watch !== undefined && entry.path.endsWith(options.watch);
  return {
    fs: {
      lstat: async (path) => {
        const entry = await fs.lstat(path);
        if (entry !== null && options.afterLstat !== undefined) await options.afterLstat(entry);
        return entry;
      },
      readRegular: async (entry, maximumBytes) => {
        if (watched(entry)) {
          hashCalls += 1;
          bufferAllocations += 1;
        }
        return fs.readRegular(entry, maximumBytes);
      },
    },
    streamRegular: async function* (entry, maximumBytes) {
      for await (const chunk of stream(entry, maximumBytes)) {
        if (watched(entry)) {
          hashCalls += 1;
          bufferAllocations += 1;
        }
        yield chunk;
      }
    },
    redact: (text) => text.replaceAll(SECRET, "[REDACTED]"),
    effectiveUid: options.effectiveUid ?? UID,
    get hashCalls() {
      return hashCalls;
    },
    get bufferAllocations() {
      return bufferAllocations;
    },
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("inspectGitMetadata", () => {
  it("admits only plain DIRC v2 plus the supported TREE cache", async () => {
    const repo = await repository();
    const deps = dependencies();
    const plain = indexBytes({ entries: PLAIN_ENTRIES });
    expect(await inspectGitMetadata(deps, repo.request())).toMatchObject({
      index: { state: "present", bytesHash: sha256(plain) },
    });
    const withTree = indexBytes({ entries: PLAIN_ENTRIES, extensions: [{ signature: "TREE", data: treeExtension() }] });
    await repo.write("index", withTree);
    expect(await inspectGitMetadata(deps, repo.request())).toMatchObject({
      index: { state: "present", bytesHash: sha256(withTree) },
    });
    await repo.write("index", indexBytes({ entries: PLAIN_ENTRIES, extensions: [{ signature: "link", data: new Uint8Array(20) }] }));
    await expect(inspectGitMetadata(deps, repo.request())).rejects.toThrow("unsupported_index_format");
  });

  it("projects a born repository into a valid GitSourceStateV1", async () => {
    const repo = await repository();
    const state = await inspectGitMetadata(dependencies(), repo.request());
    expect(validateGitSourceState(state)).toEqual(state);
    expect(state).toEqual({
      configHash: sha256(CONFIG),
      index: { state: "present", bytesHash: sha256(indexBytes({ entries: PLAIN_ENTRIES })) },
      head: {
        state: "present",
        bytesHash: sha256("ref: refs/heads/main\n"),
        semantic: { kind: "symbolic_ref", value: "refs/heads/main" },
      },
      headReflog: { state: "present", bytesHash: sha256(REFLOG_LINE), size: Buffer.byteLength(REFLOG_LINE) },
      branchReflog: { state: "present", bytesHash: sha256(REFLOG_LINE), size: Buffer.byteLength(REFLOG_LINE) },
      branchRef: { state: "present", oid: OID, bytesHash: sha256(`${OID}\n`) },
    });
  });

  it("admits the unborn repository with an absent index, ref and reflogs", async () => {
    const repo = await repository({ born: false });
    const state = await inspectGitMetadata(dependencies(), repo.request());
    expect(state.index).toEqual({ state: "absent" });
    expect(state.branchRef).toEqual({ state: "absent" });
    expect(state.headReflog).toEqual({ state: "absent" });
    expect(state.branchReflog).toEqual({ state: "absent" });
  });

  it("adopts the attached branch when the request names none", async () => {
    const repo = await repository();
    await repo.write("HEAD", "ref: refs/heads/feature/x\n");
    await repo.write("refs/heads/feature/x", `${OID}\n`);
    const state = await inspectGitMetadata(dependencies(), repo.request(null));
    expect(state.head.semantic).toEqual({ kind: "symbolic_ref", value: "refs/heads/feature/x" });
    expect(state.branchRef.state).toBe("present");
    expect(state.branchReflog).toEqual({ state: "absent" });
  });

  it("refuses a detached HEAD, another branch and an absent index on a born branch", async () => {
    const repo = await repository();
    await expect(inspectGitMetadata(dependencies(), repo.request("other"))).rejects.toThrow("branch_mismatch");
    await nodeFs.rm(join(repo.git, "index"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_index_format");
    await repo.write("HEAD", `${OID}\n`);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("detached_head");
  });

  const refusedIndexes: readonly (readonly [string, IndexSpec])[] = [
    ["version 3", { version: 3, entries: PLAIN_ENTRIES }],
    ["version 4", { version: 4, entries: PLAIN_ENTRIES }],
    ["a stage-one entry", { entries: [{ name: "a.md", flags: 0x1000 }] }],
    ["an assume-valid entry", { entries: [{ name: "a.md", flags: 0x8000 }] }],
    ["an extended-flag entry", { entries: [{ name: "a.md", flags: 0x4000 }] }],
    ["a sparse-directory entry", { entries: [{ name: "docs/", mode: 0o040000 }] }],
    ["a gitlink entry", { entries: [{ name: "vendor", mode: 0o160000 }] }],
    ["unsorted entries", { entries: [{ name: "b.md" }, { name: "a.md" }] }],
    ["duplicate entries", { entries: [{ name: "a.md" }, { name: "a.md" }] }],
    ["a split-index link", { entries: PLAIN_ENTRIES, extensions: [{ signature: "link", data: new Uint8Array(20) }] }],
    ["an untracked cache", { entries: PLAIN_ENTRIES, extensions: [{ signature: "UNTR", data: new Uint8Array(4) }] }],
    ["an unknown extension", { entries: PLAIN_ENTRIES, extensions: [{ signature: "ZZZZ", data: new Uint8Array(0) }] }],
    [
      "two TREE caches",
      {
        entries: PLAIN_ENTRIES,
        extensions: [
          { signature: "TREE", data: treeExtension() },
          { signature: "TREE", data: treeExtension() },
        ],
      },
    ],
    ["a truncated TREE cache", { entries: PLAIN_ENTRIES, extensions: [{ signature: "TREE", data: treeExtension().subarray(0, 10) }] }],
    ["a TREE cache with a malformed count", { entries: PLAIN_ENTRIES, extensions: [{ signature: "TREE", data: Buffer.from("\u0000x 0\n", "binary") }] }],
    ["a corrupt checksum", { entries: PLAIN_ENTRIES, corruptChecksum: true }],
  ];

  it("enumerates a non-empty refused-index set", () => {
    expect(refusedIndexes.length).toBeGreaterThan(0);
  });

  it.each(refusedIndexes)("refuses an index with %s", async (_name, spec) => {
    const repo = await repository();
    await repo.write("index", indexBytes(spec));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_index_format");
  });

  it("refuses a truncated index header", async () => {
    const repo = await repository();
    await repo.write("index", Buffer.from("DIRC"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_index_format");
  });

  const refusedConfigs: readonly (readonly [string, string, string])[] = [
    ["a repository extension", `${CONFIG}[extensions]\n\tobjectformat = sha256\n`, "unsupported_repository_format"],
    ["format version 1", "[core]\n\trepositoryformatversion = 1\n", "unsupported_repository_format"],
    ["a bare repository", "[core]\n\tbare = true\n", "unsupported_repository_layout"],
    ["a bare-key bare repository", "[core]\n\tbare\n", "unsupported_repository_layout"],
    ["a worktree override", `${CONFIG}\tworktree = /elsewhere\n`, "unsupported_repository_layout"],
    ["sparse checkout", `${CONFIG}\tsparseCheckout = true\n`, "unsupported_repository_format"],
    ["a split index", `${CONFIG}\tsplitIndex = yes\n`, "unsupported_index_format"],
    ["a sparse index", `${CONFIG}[index]\n\tsparse = true\n`, "unsupported_index_format"],
    ["a promisor remote", `${CONFIG}[remote "origin"]\n\tpromisor = true\n`, "unsupported_repository_format"],
    ["an include", `${CONFIG}[include]\n\tpath = other.config\n`, "unsupported_repository_config"],
    ["an includeIf", `${CONFIG}[includeIf "gitdir:/x/"]\n\tpath = other.config\n`, "unsupported_repository_config"],
    ["CR line endings", CONFIG.replaceAll("\n", "\r\n"), "unsupported_repository_config"],
    ["an unterminated quote", `${CONFIG}[user]\n\tname = "open\n`, "unsupported_repository_config"],
    ["an unknown escape", `${CONFIG}[user]\n\tname = a\\qb\n`, "unsupported_repository_config"],
    ["a key before any section", `bare = false\n${CONFIG}`, "unsupported_repository_config"],
  ];

  it("enumerates a non-empty refused-config set", () => {
    expect(refusedConfigs.length).toBeGreaterThan(0);
  });

  it.each(refusedConfigs)("refuses a config with %s", async (_name, config, reason) => {
    const repo = await repository();
    await repo.write("config", config);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow(reason);
  });

  it("reads quoted, continued, commented and legacy-subsection config lines", async () => {
    const repo = await repository();
    await repo.write(
      "config",
      `# leading comment\n${CONFIG}[remote "developer-os"]\n\turl = "file:///tmp/a b" ; trailing\n[branch.main]\n\tremote = developer-os\n[user]\n\tname = first \\\n second\n`,
    );
    await expect(inspectGitMetadata(dependencies(), repo.request())).resolves.toMatchObject({ index: { state: "present" } });
  });

  it("scans the config for secrets before hashing and publishes only the class", async () => {
    const repo = await repository();
    await repo.write("config", `${CONFIG}[remote "origin"]\n\turl = https://x-access-token:${SECRET}@example.invalid/r.git\n`);
    const refusal = await inspectGitMetadata(dependencies(), repo.request()).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(GitMetadataRefusalError);
    expect((refusal as GitMetadataRefusalError).reason).toBe("git_config_secret");
    expect((refusal as GitMetadataRefusalError).code).toBe(5);
    expect((refusal as Error).message).not.toContain(SECRET);
  });

  const refusedPresence: readonly (readonly [string, string])[] = [
    ["packed-refs", "unsupported_ref_format"],
    ["shallow", "unsupported_repository_layout"],
    ["objects/info/alternates", "unsupported_repository_layout"],
    ["info/grafts", "unsupported_repository_layout"],
    ["commondir", "unsupported_repository_layout"],
  ];

  it("enumerates a non-empty refused-presence set", () => {
    expect(refusedPresence.length).toBeGreaterThan(0);
  });

  it.each(refusedPresence)("refuses a repository with %s", async (relative, reason) => {
    const repo = await repository();
    await repo.write(relative, "");
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow(reason);
  });

  it("refuses an absent .git, a gitfile and a symlinked .git", async () => {
    const repo = await repository();
    await nodeFs.rename(repo.git, `${repo.root}/moved.git`);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_repository_absent");
    await nodeFs.writeFile(repo.git, `gitdir: ${repo.root}/moved.git\n`);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_repository_layout");
    await nodeFs.rm(repo.git);
    await nodeFs.symlink(`${repo.root}/moved.git`, repo.git);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_metadata_symlink");
  });

  it("refuses a symlinked, hard-linked or directory HEAD", async () => {
    const repo = await repository();
    await repo.write("HEAD.real", "ref: refs/heads/main\n");
    await nodeFs.rm(join(repo.git, "HEAD"));
    await nodeFs.symlink(join(repo.git, "HEAD.real"), join(repo.git, "HEAD"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_metadata_symlink");
    await nodeFs.rm(join(repo.git, "HEAD"));
    await nodeFs.link(join(repo.git, "HEAD.real"), join(repo.git, "HEAD"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_metadata_hard_link");
    await nodeFs.rm(join(repo.git, "HEAD"));
    await nodeFs.mkdir(join(repo.git, "HEAD"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_metadata_unsupported_type");
  });

  it("refuses a symlinked ref ancestor and a foreign owner", async () => {
    const repo = await repository();
    await expect(inspectGitMetadata(dependencies({ effectiveUid: UID + 1 }), repo.request())).rejects.toThrow("git_metadata_owner");
    await nodeFs.rename(join(repo.git, "refs", "heads"), join(repo.root, "heads-elsewhere"));
    await nodeFs.symlink(join(repo.root, "heads-elsewhere"), join(repo.git, "refs", "heads"));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("git_metadata_symlink");
  });

  it.each([
    ["ref: refs/heads/main", "no trailing LF"],
    ["ref: refs/heads/main\n\n", "a second line"],
    ["ref:  refs/heads/main\n", "a doubled space"],
    ["ref: refs/tags/v1\n", "a tag target"],
    [`${"0".repeat(40)}\n`, "the all-zero OID"],
    [`${OID.toUpperCase()}\n`, "an uppercase OID"],
  ])("refuses the HEAD bytes %j (%s)", async (bytes) => {
    const repo = await repository();
    await repo.write("HEAD", bytes);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_ref_format");
  });

  it("refuses a malformed loose ref and a reflog that does not end in LF", async () => {
    const repo = await repository();
    await repo.write("refs/heads/main", OID);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_ref_format");
    await repo.write("refs/heads/main", `${OID}\n`);
    await repo.write("logs/HEAD", REFLOG_LINE.slice(0, -1));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_reflog_layout");
  });

  it("admits an empty reflog", async () => {
    const repo = await repository();
    await repo.write("logs/HEAD", "");
    const state = await inspectGitMetadata(dependencies(), repo.request());
    expect(state.headReflog).toEqual({ state: "present", bytesHash: sha256(""), size: 0 });
  });

  const metadataBoundaries: readonly {
    readonly name: string;
    readonly leaf: string;
    readonly plant: (repo: Repository) => Promise<void>;
    readonly reason: string;
  }[] = [
    {
      name: "config",
      leaf: "/.git/config",
      plant: (repo) => repo.write("config", CONFIG.padEnd(GIT_METADATA_BOUNDS.sourceConfigMaxBytes, "#").concat("#")),
      reason: "git_metadata_too_large",
    },
    {
      name: "HEAD",
      leaf: "/.git/HEAD",
      plant: (repo) => repo.write("HEAD", "x".repeat(GIT_METADATA_BOUNDS.sourceHeadMaxBytes + 1)),
      reason: "git_metadata_too_large",
    },
    {
      name: "loose ref",
      leaf: "/.git/refs/heads/main",
      plant: (repo) => repo.write("refs/heads/main", `${OID}\n\n`),
      reason: "git_metadata_too_large",
    },
    {
      name: "index",
      leaf: "/.git/index",
      plant: (repo) => repo.sparse("index", GIT_METADATA_BOUNDS.sourceIndexMaxBytes + 1),
      reason: "git_metadata_too_large",
    },
    {
      name: "HEAD reflog",
      leaf: "/.git/logs/HEAD",
      plant: (repo) => repo.sparse("logs/HEAD", GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes + 1, 0x0a),
      reason: "git_metadata_too_large",
    },
    {
      name: "branch reflog",
      leaf: "/.git/logs/refs/heads/main",
      plant: (repo) => repo.sparse("logs/refs/heads/main", GIT_METADATA_BOUNDS.sourceBranchReflogMaxBytes + 1, 0x0a),
      reason: "git_metadata_too_large",
    },
  ];

  it("enumerates a non-empty boundary set", () => {
    expect(metadataBoundaries.length).toBeGreaterThan(0);
  });

  it.each(metadataBoundaries)("refuses the first byte over $name before allocation or hash", async ({ leaf, plant, reason }) => {
    const repo = await repository();
    await plant(repo);
    const deps = dependencies({ watch: leaf });
    await expect(inspectGitMetadata(deps, repo.request())).rejects.toThrow(reason);
    expect(deps.hashCalls).toBe(0);
    expect(deps.bufferAllocations).toBe(0);
  });

  it("admits each bounded leaf at exactly its cap", async () => {
    const repo = await repository();
    await repo.write("config", CONFIG.padEnd(GIT_METADATA_BOUNDS.sourceConfigMaxBytes, "#"));
    await repo.sparse("logs/HEAD", GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes, 0x0a);
    await repo.sparse("logs/refs/heads/main", GIT_METADATA_BOUNDS.sourceBranchReflogMaxBytes, 0x0a);
    const state = await inspectGitMetadata(dependencies(), repo.request());
    expect(state.headReflog).toMatchObject({ state: "present", size: 67108864 });
    expect(state.branchReflog).toMatchObject({ state: "present", size: 67108864 });
  });

  it("parses rather than size-refuses a HEAD and an index at exactly their caps", async () => {
    const repo = await repository();
    await repo.write("HEAD", "x".repeat(GIT_METADATA_BOUNDS.sourceHeadMaxBytes));
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_ref_format");
    await repo.write("HEAD", "ref: refs/heads/main\n");
    await repo.sparse("index", GIT_METADATA_BOUNDS.sourceIndexMaxBytes);
    await expect(inspectGitMetadata(dependencies(), repo.request())).rejects.toThrow("unsupported_index_format");
  });

  it("reads with no-follow and refuses an identity change between lstat and read", async () => {
    const repo = await repository();
    let swapped = false;
    const deps = dependencies({
      afterLstat: async (entry) => {
        if (swapped || !entry.path.endsWith("/.git/HEAD")) return;
        swapped = true;
        await nodeFs.writeFile(join(repo.git, "HEAD.swap"), "ref: refs/heads/main\n");
        await nodeFs.rename(join(repo.git, "HEAD.swap"), join(repo.git, "HEAD"));
      },
    });
    await expect(inspectGitMetadata(deps, repo.request())).rejects.toThrow("git_metadata_identity_changed");
    expect(swapped).toBe(true);
  });

  it("refuses a streamed leaf swapped between lstat and read", async () => {
    const repo = await repository();
    let swapped = false;
    const deps = dependencies({
      afterLstat: async (entry) => {
        if (swapped || !entry.path.endsWith("/.git/logs/HEAD")) return;
        swapped = true;
        await nodeFs.writeFile(join(repo.git, "logs", "HEAD.swap"), REFLOG_LINE);
        await nodeFs.rename(join(repo.git, "logs", "HEAD.swap"), join(repo.git, "logs", "HEAD"));
      },
    });
    await expect(inspectGitMetadata(deps, repo.request())).rejects.toThrow("git_metadata_identity_changed");
    expect(swapped).toBe(true);
  });
});
