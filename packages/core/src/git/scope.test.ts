import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { gitScopeFingerprint, parseVaultSegment, type GitScopeSnapshotV1 } from "../config/lifecycle.js";
import type { LifecycleGuardedEntryV1, LifecycleGuardedKindV1 } from "../lifecycle/guarded-fs.js";
import { UID } from "../lifecycle/testing.js";
import { parseCanonicalAbsolutePathText, parseVaultRelativePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseUInt64Decimal } from "../update/scalars.js";
import {
  GIT_SCOPE_BOUNDS,
  GitPlanningRefusalError,
  assertGitSameDevice,
  assertGitScopeRoots,
  enumerateGitScopePaths,
  gitScopeIndexArtifactPaths,
  isGitScopePath,
  readGitRetiringPath,
  readGitScopeSnapshot,
  type GitPlanningRefusalReasonV1,
  type GitScopeDependenciesV1,
  type GitScopeEnumeratorV1,
} from "./scope.js";
import { compareUnsignedUtf8 } from "./types.js";

const ROOT = parseCanonicalAbsolutePathText("/synthetic/vault");
const SECRET = "ghp_SyntheticSecretValue0123456789";
const encoder = new TextEncoder();

function scope(topics: readonly string[] = ["DEV"]): GitScopeSnapshotV1 {
  const fields = {
    brainPath: ROOT,
    contentRoot: parseVaultSegment("content"),
    topicFolders: topics.map(parseVaultSegment),
    topicAliases: {},
    indexesDir: parseVaultSegment("_indexes"),
  };
  return { ...fields, fingerprint: gitScopeFingerprint(fields) };
}

function enumerator(notes: readonly string[]): GitScopeEnumeratorV1 {
  return {
    canonicalNotes: () => Promise.resolve(notes),
    isCanonicalNote: (snapshot, path) =>
      path.endsWith(".md") && snapshot.topicFolders.some((topic) => path.startsWith(`content/${topic}/`)),
  };
}

interface FakeNode {
  readonly kind: LifecycleGuardedKindV1;
  readonly size?: number;
  readonly nlink?: number;
  readonly mode?: number;
  readonly dev?: string;
  readonly bytes?: Uint8Array;
}

interface FakeFs {
  readonly dependencies: GitScopeDependenciesV1;
  readonly reads: string[];
}

/**
 * A synthetic guarded filesystem: directories are implied by every node
 * path's ancestors, and a node's reported size need not be backed by bytes,
 * so the 16-MiB and 1-GiB bounds are exercised without materializing them.
 */
function fakeFs(nodes: Readonly<Record<string, FakeNode>>, notes: readonly string[] = []): FakeFs {
  const reads: string[] = [];
  const directories = new Set<string>([ROOT]);
  for (const relative of Object.keys(nodes)) {
    const parts = relative.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) directories.add(`${ROOT}/${parts.slice(0, depth).join("/")}`);
  }
  let ino = 10;
  const entry = (path: CanonicalAbsolutePathV1, node: FakeNode): LifecycleGuardedEntryV1 => {
    ino += 1;
    return {
      path,
      kind: node.kind,
      ownerUid: UID,
      mode: node.mode ?? (node.kind === "directory" ? 0o755 : 0o644),
      nlink: node.nlink ?? 1,
      size: parseUInt64Decimal((node.size ?? node.bytes?.byteLength ?? 0).toString(10)),
      dev: parseUInt64Decimal(node.dev ?? "1"),
      ino: parseUInt64Decimal(ino.toString(10)),
    };
  };
  return {
    reads,
    dependencies: {
      fs: {
        lstat: (path) => {
          const relative = path === ROOT ? "" : path.slice(ROOT.length + 1);
          const node = nodes[relative];
          if (node !== undefined) return Promise.resolve(entry(path, node));
          if (directories.has(path)) return Promise.resolve(entry(path, { kind: "directory" }));
          return Promise.resolve(null);
        },
        readRegular: (guarded) => {
          reads.push(guarded.path);
          const node = nodes[guarded.path.slice(ROOT.length + 1)];
          return Promise.resolve(node?.bytes ?? new Uint8Array(0));
        },
      },
      redact: (text) => text.replaceAll(SECRET, "[REDACTED]"),
      effectiveUid: UID,
      enumerator: enumerator(notes),
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<GitPlanningRefusalError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitPlanningRefusalError) return error;
    throw error;
  }
  throw new Error("expected a GitPlanningRefusalError");
}

async function reason(promise: Promise<unknown>): Promise<GitPlanningRefusalReasonV1> {
  return (await refusal(promise)).reason;
}

const paths = (values: readonly string[]) => values.map(parseVaultRelativePathText);

describe("enumerateGitScopePaths", () => {
  it("adds the four index artifacts and orders every path by unsigned UTF-8 bytes", async () => {
    const notes = ["content/DEV/é.md", "content/DEV/a.md", "content/DEV/Z.md", "content/DEV/b c.md"];
    const enumerated: readonly string[] = await enumerateGitScopePaths(enumerator(notes), scope());
    expect(enumerated.length).toBeGreaterThan(0);
    expect(enumerated).toEqual(
      [...notes, ...gitScopeIndexArtifactPaths(scope())].sort(compareUnsignedUtf8),
    );
    expect(enumerated.indexOf("content/DEV/Z.md")).toBeLessThan(enumerated.indexOf("content/DEV/a.md"));
    expect(enumerated.indexOf("content/DEV/a.md")).toBeLessThan(enumerated.indexOf("content/DEV/é.md"));
    expect(gitScopeIndexArtifactPaths(scope())).toEqual([
      "content/_indexes/index.json",
      "content/_indexes/graph.json",
      "content/_indexes/vault-map.md",
      "content/_indexes/catalog.md",
    ]);
  });

  it.each([
    ["content/DEV/sub/.git/config", "nested_git_directory"],
    ["content/DEV/sub/.GIT/x.md", "nested_git_directory"],
    ["other/DEV/a.md", "scope_outside_repository"],
    ["content/DEV/../a.md", "unsupported_scope_entry"],
    ["content/DEV/tab\tname.md", "unsupported_scope_entry"],
    ["content/DEV/line\nfeed.md", "unsupported_scope_entry"],
    ["content/DEV/carriage\rreturn.md", "unsupported_scope_entry"],
    ["content/DEV/e\u0301.md", "unsupported_scope_entry"],
  ] as const)("refuses the enumerated path %j as %s", async (path, expected) => {
    expect(await reason(enumerateGitScopePaths(enumerator([path]), scope()))).toBe(expected);
  });

  it("refuses a duplicated enumerated path", async () => {
    expect(await reason(enumerateGitScopePaths(enumerator(["content/DEV/a.md", "content/DEV/a.md"]), scope()))).toBe(
      "unsupported_scope_entry",
    );
  });

  it("admits the artifacts and the injected predicate only", () => {
    const predicate = enumerator([]);
    expect(isGitScopePath(predicate, scope(), "content/_indexes/catalog.md")).toBe(true);
    expect(isGitScopePath(predicate, scope(), "content/DEV/gone.md")).toBe(true);
    expect(isGitScopePath(predicate, scope(), "content/_indexes/other.json")).toBe(false);
    expect(isGitScopePath(predicate, scope(), "README.md")).toBe(false);
  });
});

describe("readGitScopeSnapshot", () => {
  it("reads the exact 16-MiB boundary and refuses the next byte before any read", async () => {
    const atLimit = fakeFs({ "content/DEV/big.md": { kind: "regular_file", size: GIT_SCOPE_BOUNDS.fileMaxBytes } });
    await expect(readGitScopeSnapshot(atLimit.dependencies, scope(), paths(["content/DEV/big.md"]))).resolves.toHaveLength(1);
    const over = fakeFs({ "content/DEV/big.md": { kind: "regular_file", size: GIT_SCOPE_BOUNDS.fileMaxBytes + 1 } });
    const refused = await refusal(readGitScopeSnapshot(over.dependencies, scope(), paths(["content/DEV/big.md"])));
    expect(refused.reason).toBe("scope_file_too_large");
    expect(refused.path).toBe("content/DEV/big.md");
    expect(over.reads).toEqual([]);
  });

  it("admits exactly 1 GiB in aggregate and refuses the next file before any read", async () => {
    const count = GIT_SCOPE_BOUNDS.aggregateMaxBytes / GIT_SCOPE_BOUNDS.fileMaxBytes;
    const names = Array.from({ length: count }, (_, index) => `content/DEV/n${index.toString(10).padStart(3, "0")}.md`);
    const full: FakeNode = { kind: "regular_file", size: GIT_SCOPE_BOUNDS.fileMaxBytes };
    const nodes = Object.fromEntries(names.map((name) => [name, full]));
    const exact = fakeFs(nodes);
    await expect(readGitScopeSnapshot(exact.dependencies, scope(), paths(names))).resolves.toHaveLength(count);
    const extra = "content/DEV/overflow.md";
    const over = fakeFs({ ...nodes, [extra]: { kind: "regular_file", size: 1 } });
    const refused = await refusal(readGitScopeSnapshot(over.dependencies, scope(), paths([...names, extra])));
    expect(refused.reason).toBe("scope_aggregate_too_large");
    expect(over.reads).toEqual([]);
  });

  it("refuses a secret before hashing and publishes only its class and path", async () => {
    const fixture = fakeFs({ "content/DEV/key.md": { kind: "regular_file", bytes: encoder.encode(`token ${SECRET}\n`) } });
    const refused = await refusal(readGitScopeSnapshot(fixture.dependencies, scope(), paths(["content/DEV/key.md"])));
    expect(refused.reason).toBe("scope_secret");
    expect(refused.code).toBe(5);
    expect(refused.path).toBe("content/DEV/key.md");
    expect(refused.message).not.toContain(SECRET);
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });

  it("masks only the index's contentHash digests from the secret scan", async () => {
    const noteBytes = encoder.encode("# A\n");
    const digest = createHash("sha256").update(noteBytes).digest("hex");
    const index = (extra: string, hash = digest) => encoder.encode(`{\n  "notes": [\n    {\n      "path": "content/DEV/a.md",\n      "title": "${extra}",\n      "contentHash": "${hash}"\n    }\n  ]\n}\n`);
    const hexAware = (text: string) => text.replace(/[0-9a-f]{64}/gu, "[REDACTED]").replaceAll(SECRET, "[REDACTED]");
    const snapshot = (nodes: Readonly<Record<string, FakeNode>>) => {
      const fixture = fakeFs({ "content/DEV/a.md": { kind: "regular_file", bytes: noteBytes }, ...nodes });
      return readGitScopeSnapshot({ ...fixture.dependencies, redact: hexAware }, scope(), paths(["content/DEV/a.md", ...Object.keys(nodes)]));
    };
    const files = await snapshot({ "content/_indexes/index.json": { kind: "regular_file", bytes: index("A") } });
    expect(files.map((file) => file.bytes)).toEqual([noteBytes, index("A")]);

    const leaked = await refusal(snapshot({ "content/_indexes/index.json": { kind: "regular_file", bytes: index(digest) } }));
    expect(leaked.reason).toBe("scope_secret");

    /** A 256-bit secret in the slot is not the digest of the note the entry names. */
    const hidden = "5ec2e75ec2e75ec2e75ec2e75ec2e75ec2e75ec2e75ec2e75ec2e75ec2e75ec2";
    const smuggled = await refusal(snapshot({ "content/_indexes/index.json": { kind: "regular_file", bytes: index("A", hidden) } }));
    expect(smuggled.reason).toBe("scope_secret");
    expect(smuggled.path).toBe("content/_indexes/index.json");

    /** Only the scope's own index artifact is masked, not any file of that name. */
    const elsewhere = await refusal(snapshot({ "content/DEV/index.json": { kind: "regular_file", bytes: index("A") } }));
    expect(elsewhere.reason).toBe("scope_secret");

    const note = fakeFs({ "content/DEV/a.md": { kind: "regular_file", bytes: encoder.encode(`"contentHash": "${digest}"\n`) } });
    const noteRefused = await refusal(readGitScopeSnapshot({ ...note.dependencies, redact: hexAware }, scope(), paths(["content/DEV/a.md"])));
    expect(noteRefused.reason).toBe("scope_secret");
  });

  it("skips an absent index artifact but treats a vanished note as a concurrent edit", async () => {
    const fixture = fakeFs({ "content/DEV/a.md": { kind: "regular_file", bytes: encoder.encode("# A\n") } });
    const files = await readGitScopeSnapshot(
      fixture.dependencies,
      scope(),
      paths(["content/DEV/a.md", "content/_indexes/catalog.md"]),
    );
    expect(files.map((file) => file.path)).toEqual(["content/DEV/a.md"]);
    expect(await reason(readGitScopeSnapshot(fixture.dependencies, scope(), paths(["content/DEV/gone.md"])))).toBe(
      "concurrent_change",
    );
  });

  it("records the owner-executable bit as the Git mode", async () => {
    const fixture = fakeFs({
      "content/DEV/run.md": { kind: "regular_file", mode: 0o755, bytes: encoder.encode("x\n") },
      "content/DEV/doc.md": { kind: "regular_file", mode: 0o644, bytes: encoder.encode("y\n") },
    });
    const files = await readGitScopeSnapshot(fixture.dependencies, scope(), paths(["content/DEV/doc.md", "content/DEV/run.md"]));
    expect(files.map((file) => file.executable)).toEqual([false, true]);
  });

  it.each([
    ["a symlinked note", { "content/DEV/link.md": { kind: "symlink" } }, "content/DEV/link.md", "symlink_in_scope"],
    ["a symlinked directory", { "content/DEV/sub": { kind: "symlink" } }, "content/DEV/sub/a.md", "symlink_in_scope"],
    ["a hard link", { "content/DEV/hard.md": { kind: "regular_file", nlink: 2 } }, "content/DEV/hard.md", "hard_link_in_scope"],
    [
      "a nested repository",
      { "content/DEV/sub/a.md": { kind: "regular_file" }, "content/DEV/sub/.git": { kind: "directory" } },
      "content/DEV/sub/a.md",
      "nested_git_directory",
    ],
    ["a FIFO", { "content/DEV/pipe.md": { kind: "other" } }, "content/DEV/pipe.md", "unsupported_scope_entry"],
  ] as const)("refuses %s before reading it", async (_name, nodes, path, expected) => {
    const fixture = fakeFs(nodes);
    expect(await reason(readGitScopeSnapshot(fixture.dependencies, scope(), paths([path])))).toBe(expected);
    expect(fixture.reads).toEqual([]);
  });

  it("returns null for a retiring path that is already gone and scans one that remains", async () => {
    const fixture = fakeFs({ "content/OLD/a.md": { kind: "regular_file", bytes: encoder.encode("# old\n") } });
    await expect(readGitRetiringPath(fixture.dependencies, ROOT, "content/OLD/gone.md")).resolves.toBeNull();
    await expect(readGitRetiringPath(fixture.dependencies, ROOT, "content/OLD/a.md")).resolves.toEqual(
      encoder.encode("# old\n"),
    );
  });
});

describe("tracked roots and devices", () => {
  it("refuses a tracked root that is an existing symlink and accepts missing roots", async () => {
    const missing = fakeFs({});
    await expect(assertGitScopeRoots(missing.dependencies, scope(["DEV", "OPS"]))).resolves.toBeUndefined();
    const linked = fakeFs({ "content/OPS": { kind: "symlink" } });
    expect(await reason(assertGitScopeRoots(linked.dependencies, scope(["DEV", "OPS"])))).toBe("scope_outside_repository");
    const linkedIndexes = fakeFs({ "content/_indexes": { kind: "symlink" } });
    expect(await reason(assertGitScopeRoots(linkedIndexes.dependencies, scope()))).toBe("scope_outside_repository");
  });

  it("refuses a repository on another device from the product home", async () => {
    const home = parseCanonicalAbsolutePathText("/synthetic/vault/home");
    const same = fakeFs({ home: { kind: "directory" } });
    await expect(assertGitSameDevice(same.dependencies.fs, home, ROOT)).resolves.toBeUndefined();
    const other = fakeFs({ home: { kind: "directory", dev: "2" } });
    expect(await reason(assertGitSameDevice(other.dependencies.fs, home, ROOT))).toBe("cross_device_git_state");
  });
});
