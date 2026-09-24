import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  gitScopeFingerprint,
  parseNormalizedRemoteUrl,
  parseValidatedGitBranch,
  parseVaultSegment,
  type GitScopeSnapshotV1,
  type GitSyncConfigV1,
} from "../config/lifecycle.js";
import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { LifecycleValueCodec } from "../lifecycle/codecs.js";
import { createNodeLifecycleGuardedFileSystem } from "../lifecycle/guarded-fs.js";
import { UID, createLinkUnlinkRenameNoReplace } from "../lifecycle/testing.js";
import {
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalAbsolutePathV1,
  type VaultRelativePathV1,
} from "../update/paths.js";
import { parseUInt64Decimal } from "../update/scalars.js";
import { GitMetadataRefusalError, createNodeGitMetadataStream, inspectGitMetadata } from "./metadata.js";
import {
  GIT_EFFECT_EVIDENCE_UNBOUND,
  GIT_ENABLE_BRANCH_HISTORY_WARNING,
  GIT_PLAN_PREVIEW_CODEC,
  GIT_SYNC_CARDINALITY,
  GitPlanner,
  assertGitSyncSourceTransitions,
  deriveGitSyncCardinality,
  describeGitEnablePlan,
  validateGitEffectTransition,
  validateGitSyncPlanCore,
  type GitEffectTransitionV1,
  type GitEnableRequestV1,
  type GitPlannerDependenciesV1,
  type GitSyncBaselineV1,
  type GitSyncPlanCoreV1,
  type GitSyncPlanningDraft,
  type GitSyncRequestV1,
} from "./planner.js";
import {
  GIT_EMPTY_TREE_OID,
  appendGitRemoteSection,
  buildGitTree,
  gitCommitObject,
  gitIndexBytes,
  gitIndexEntry,
  gitObject,
  parseAdmittedGitIndex,
  planInitialGitDirectory,
  initialGitDirectoryPaths,
  type GitCommitterV1,
  type GitIndexEntryV1,
} from "./repository.js";
import { GIT_SCOPE_BOUNDS, GitPlanningRefusalError, type GitPlanningRefusalReasonV1, type GitScopeEnumeratorV1 } from "./scope.js";
import {
  GIT_METADATA_BOUNDS,
  GIT_ZERO_OID,
  compareUnsignedUtf8,
  validateGitSourceState,
  type GitSourceStateV1,
  type LowerHexSha1,
} from "./types.js";

const CONFIG = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";
const URL = parseNormalizedRemoteUrl("https://example.com/org/brain.git", "https");
const OTHER_URL = parseNormalizedRemoteUrl("https://example.com/org/other.git", "https");
const REMOTE: GitSyncConfigV1["remote"] = {
  name: "developer-os",
  transport: "https",
  declaredUrl: URL,
  effectivePushUrl: URL,
};
const COMMITTER: GitCommitterV1 = {
  name: "Synthetic Tester",
  email: "tester@example.invalid",
  unixSeconds: 1790000000,
  utcOffset: "+0000",
};
const SEED_REFLOG = `${GIT_ZERO_OID} ${"1".repeat(40)} Synthetic Tester <tester@example.invalid> 1789990000 +0000\tcommit (initial): seed\n`;
const SECRET = "ghp_SyntheticSecretValue0123456789";
const PRIVATE_SEGMENTS = ["_raw", "_outputs", "_graveyard", "templates"];
const BASE_NOTES: Readonly<Record<string, string>> = {
  "content/DEV/a.md": "# A\n",
  "content/DEV/B.md": "# B\n",
  "content/DEV/é.md": "# E\n",
  "content/_indexes/index.json": "{}\n",
  "content/_indexes/catalog.md": "# Catalog\n",
};
const UNSCOPED_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Unrelated tracked file\n",
  "content/_raw/capture.md": "quarantined\n",
  "content/templates/t.md": "template\n",
  "content/.obsidian/workspace.json": "{}\n",
  "content/DEV/_outputs/model.md": "generated\n",
  "content/OPS/o.md": "# O\n",
};
const TRACKED_UNRELATED = ["README.md"];
const encoder = new TextEncoder();
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortUnsignedUtf8(paths: readonly string[]): readonly VaultRelativePathV1[] {
  return paths.map(parseVaultRelativePathText).sort(compareUnsignedUtf8);
}

interface VaultOptions {
  readonly git?: boolean;
  readonly born?: boolean;
  readonly treeCache?: boolean;
  readonly remote?: string | null;
  readonly notes?: Readonly<Record<string, string>>;
}

interface Vault {
  readonly root: CanonicalAbsolutePathV1;
  readonly home: CanonicalAbsolutePathV1;
  readonly otherHome: CanonicalAbsolutePathV1;
  readonly git: string;
  readonly headOid: LowerHexSha1 | null;
  readonly commitTrees: Map<string, LowerHexSha1>;
  write(relative: string, bytes: string | Uint8Array): Promise<void>;
  writeGit(relative: string, bytes: string | Uint8Array): Promise<void>;
  sparseGit(relative: string, size: number, lastByte: number): Promise<void>;
  scope(topics?: readonly string[], brainPath?: CanonicalAbsolutePathV1): GitScopeSnapshotV1;
  config(scope?: GitScopeSnapshotV1): GitSyncConfigV1;
  syncRequest(options?: {
    readonly scope?: GitScopeSnapshotV1;
    readonly config?: GitSyncConfigV1;
    readonly baseline?: GitSyncBaselineV1 | null;
    readonly productHome?: CanonicalAbsolutePathV1;
  }): GitSyncRequestV1;
  enableRequest(overrides?: Partial<GitEnableRequestV1>): GitEnableRequestV1;
  dependencies(overrides?: Partial<GitPlannerDependenciesV1>): GitPlannerDependenciesV1;
  snapshotGit(): Promise<Readonly<Record<string, string>>>;
  readonly reservations: Promise<number>;
  with(name: HazardName): GitSyncRequestV1;
}

type HazardName = "nestedGitDirectory" | "symlinkInScope" | "hardLinkInScope" | "fileOver16MiB" | "otherDevice";

const HAZARD_TOPICS: Readonly<Record<Exclude<HazardName, "otherDevice">, string>> = {
  nestedGitDirectory: "NESTED",
  symlinkInScope: "LINKED",
  hardLinkInScope: "HARD",
  fileOver16MiB: "BIG",
};

async function walk(root: string, relative: string, visit: (relative: string, kind: "file" | "directory" | "link") => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await nodeFs.readdir(join(root, relative), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      await visit(path, "directory");
      await walk(root, path, visit);
    } else {
      await visit(path, entry.isSymbolicLink() ? "link" : "file");
    }
  }
}

/** A synthetic stand-in for the Brain's canonical-note enumerator. */
function syntheticEnumerator(): GitScopeEnumeratorV1 {
  const excluded = (segment: string, scope: GitScopeSnapshotV1): boolean =>
    segment.startsWith(".") || segment === scope.indexesDir || PRIVATE_SEGMENTS.includes(segment);
  return {
    async canonicalNotes(scope) {
      const notes: string[] = [];
      for (const topic of scope.topicFolders) {
        const base = `${scope.contentRoot}/${topic}`;
        await walk(scope.brainPath, base, async (relative, kind) => {
          if (kind === "directory") return;
          if (relative.slice(base.length + 1).split("/").some((segment) => excluded(segment, scope))) return;
          if (relative.endsWith(".md")) notes.push(relative);
          await Promise.resolve();
        });
      }
      return notes;
    },
    isCanonicalNote(scope, path) {
      const segments = path.split("/");
      return (
        segments[0] === scope.contentRoot &&
        scope.topicFolders.some((topic) => topic === segments[1]) &&
        path.endsWith(".md") &&
        segments.slice(2).every((segment) => !excluded(segment, scope))
      );
    },
  };
}

async function vault(options: VaultOptions = {}): Promise<Vault> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-git-planner-"));
  roots.push(created);
  const base = await nodeFs.realpath(created);
  const root = parseCanonicalAbsolutePathText(join(base, "vault"));
  const home = parseCanonicalAbsolutePathText(join(base, "home"));
  const otherHome = parseCanonicalAbsolutePathText(join(base, "other-home"));
  await nodeFs.mkdir(root, { recursive: true });
  await nodeFs.mkdir(home, { mode: 0o700 });
  await nodeFs.mkdir(otherHome, { mode: 0o700 });
  const git = join(root, ".git");
  const write = async (relative: string, bytes: string | Uint8Array): Promise<void> => {
    await nodeFs.mkdir(dirname(join(root, relative)), { recursive: true });
    await nodeFs.writeFile(join(root, relative), bytes);
  };
  const writeGit = (relative: string, bytes: string | Uint8Array): Promise<void> => write(`.git/${relative}`, bytes);
  const sparseGit = async (relative: string, size: number, lastByte: number): Promise<void> => {
    await writeGit(relative, "");
    await nodeFs.truncate(join(git, relative), size);
    const handle = await nodeFs.open(join(git, relative), "r+");
    await handle.write(Uint8Array.of(lastByte), 0, 1, size - 1);
    await handle.close();
  };

  const notes = options.notes ?? BASE_NOTES;
  for (const [relative, text] of Object.entries({ ...notes, ...UNSCOPED_FILES })) await write(relative, text);
  await write("content/NESTED/sub/n.md", "# nested\n");
  await nodeFs.mkdir(join(root, "content/NESTED/sub/.git"), { recursive: true });
  await write("content/LINKED/a.md", "# linked\n");
  await nodeFs.symlink("a.md", join(root, "content/LINKED/link.md"));
  await write("content/HARD/a.md", "# hard\n");
  await nodeFs.link(join(root, "content/HARD/a.md"), join(root, "content/HARD/b.md"));
  await write("content/BIG/big.md", "");
  await nodeFs.truncate(join(root, "content/BIG/big.md"), GIT_SCOPE_BOUNDS.fileMaxBytes + 1);

  const commitTrees = new Map<string, LowerHexSha1>();
  let headOid: LowerHexSha1 | null = null;
  if (options.git !== false) {
    for (const relative of initialGitDirectoryPaths(parseValidatedGitBranch("main"))) {
      if (relative !== "HEAD" && relative !== "config") await nodeFs.mkdir(join(git, relative), { recursive: true });
    }
    const remote = options.remote === undefined ? null : options.remote;
    await writeGit("config", remote === null ? CONFIG : `${CONFIG}[remote "developer-os"]\n\turl = ${remote}\n`);
    await writeGit("HEAD", "ref: refs/heads/main\n");
    if (options.born !== false) {
      const tracked = [...Object.keys(notes), ...TRACKED_UNRELATED];
      const entries: GitIndexEntryV1[] = tracked
        .map((relative) => {
          const bytes = encoder.encode({ ...notes, ...UNSCOPED_FILES }[relative]);
          return gitIndexEntry(encoder.encode(relative), 0o100644, gitObject("blob", bytes).oid, bytes.byteLength);
        })
        .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
      const tree = buildGitTree(entries);
      const commit = gitCommitObject(tree.object.oid, null, COMMITTER);
      commitTrees.set(commit.oid, tree.object.oid);
      headOid = commit.oid;
      await writeGit("index", gitIndexBytes(entries, options.treeCache === true ? tree : null));
      await writeGit("refs/heads/main", `${commit.oid}\n`);
      await writeGit("logs/HEAD", SEED_REFLOG);
      await writeGit("logs/refs/heads/main", SEED_REFLOG);
    }
  }

  const scope = (topics: readonly string[] = ["DEV"], brainPath: CanonicalAbsolutePathV1 = root): GitScopeSnapshotV1 => {
    const fields = {
      brainPath,
      contentRoot: parseVaultSegment("content"),
      topicFolders: topics.map(parseVaultSegment),
      topicAliases: {},
      indexesDir: parseVaultSegment("_indexes"),
    };
    return { ...fields, fingerprint: gitScopeFingerprint(fields) };
  };
  const config = (snapshot: GitScopeSnapshotV1 = scope()): GitSyncConfigV1 => ({
    schemaVersion: 1,
    repositoryRoot: root,
    branch: parseValidatedGitBranch("main"),
    remote: REMOTE,
    scope: snapshot,
  });
  const syncRequest: Vault["syncRequest"] = (request = {}) => {
    const snapshot = request.scope ?? scope();
    return {
      productHome: request.productHome ?? home,
      config: request.config ?? config(snapshot),
      scope: snapshot,
      committer: COMMITTER,
      baseline: request.baseline ?? null,
    };
  };
  const guarded = createNodeLifecycleGuardedFileSystem({
    renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
    effectiveUid: UID,
  });
  const dependencies = (overrides: Partial<GitPlannerDependenciesV1> = {}): GitPlannerDependenciesV1 => ({
    fs: {
      lstat: async (path) => {
        const entry = await guarded.lstat(path);
        if (entry === null || path !== otherHome) return entry;
        return { ...entry, dev: parseUInt64Decimal((BigInt(entry.dev) + 1n).toString(10)) };
      },
      readRegular: (entry, maximumBytes) => guarded.readRegular(entry, maximumBytes),
      hashRegular: (entry, maximumBytes) => guarded.hashRegular(entry, maximumBytes),
    },
    streamRegular: createNodeGitMetadataStream(),
    redact: (text) => text.replaceAll(SECRET, "[REDACTED]"),
    effectiveUid: UID,
    enumerator: syntheticEnumerator(),
    commitTree: (commit) => {
      const tree = commitTrees.get(commit);
      return tree === undefined ? Promise.reject(new Error("unknown synthetic commit")) : Promise.resolve(tree);
    },
    lintSnapshot: () => Promise.resolve(),
    ...overrides,
  });
  const snapshotGit = async (): Promise<Readonly<Record<string, string>>> => {
    const snapshot: Record<string, string> = {};
    await walk(git, "", async (relative, kind) => {
      snapshot[relative] =
        kind === "directory"
          ? "directory"
          : kind === "link"
            ? `link:${await nodeFs.readlink(join(git, relative))}`
            : sha256(await nodeFs.readFile(join(git, relative)));
    });
    return snapshot;
  };
  return {
    root,
    home,
    otherHome,
    git,
    headOid,
    commitTrees,
    write,
    writeGit,
    sparseGit,
    scope,
    config,
    syncRequest,
    enableRequest: (overrides = {}) => ({
      productHome: home,
      scope: scope(),
      remote: REMOTE,
      branch: null,
      recorded: null,
      baseline: null,
      pushPending: false,
      ...overrides,
    }),
    dependencies,
    snapshotGit,
    get reservations() {
      return nodeFs.readdir(home).then((entries) => entries.length);
    },
    with: (name) =>
      name === "otherDevice"
        ? syncRequest({ productHome: otherHome })
        : syncRequest({ scope: scope(["DEV", HAZARD_TOPICS[name]]) }),
  };
}

async function refusal(promise: Promise<unknown>): Promise<GitPlanningRefusalReasonV1> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitPlanningRefusalError) return error.reason;
    throw error;
  }
  throw new Error("expected a GitPlanningRefusalError");
}

interface TestPush {
  readonly sourceBefore: GitSourceStateV1;
  readonly sourceAfter: GitSourceStateV1;
}

const pushCodec: LifecycleValueCodec<TestPush> = {
  validate(value) {
    const input = value as Readonly<Record<string, unknown>>;
    if (Object.keys(input).sort().join(",") !== "sourceAfter,sourceBefore") throw new Error("invalid TestPush");
    return { sourceBefore: validateGitSourceState(input.sourceBefore), sourceAfter: validateGitSourceState(input.sourceAfter) };
  },
  encode: (value) => encodeCanonicalJson(value as unknown as CanonicalJsonValue),
};

function corePlan(draft: GitSyncPlanningDraft): GitSyncPlanCoreV1<TestPush> {
  return {
    ...draft.sync,
    sourceGitEffectPlanHash: draft.sync.commit === null ? null : "a".repeat(64),
    destinationGitEffectPlanHash: null,
    push: { sourceBefore: draft.sync.sourcePreconditions, sourceAfter: draft.sourceAfter },
  } as GitSyncPlanCoreV1<TestPush>;
}

describe("GitPlanner.planSync", () => {
  it("plans only the guarded Brain scope in unsigned UTF-8 order", async () => {
    const fixture = await vault();
    const planner = new GitPlanner(fixture.dependencies());
    await fixture.write("content/DEV/new.md", "# New\n");
    await fixture.write("content/_raw/capture.md", "dirty quarantine\n");
    await fixture.write("README.md", "dirty unrelated\n");
    const expectedManagedPaths = [...Object.keys(BASE_NOTES), "content/DEV/new.md"];
    const draft = await planner.planSync(fixture.syncRequest());
    expect(draft.sync.managedPaths.length).toBeGreaterThan(0);
    expect(draft.sync.managedPaths).toEqual(sortUnsignedUtf8(expectedManagedPaths));
    expect(planner.publicMethods()).toEqual(["assertCoreSyncFeasible", "planSync", "previewDisable", "previewEnable"]);
    expect(draft.sync.changes.map((change) => [change.path, change.operation])).toEqual([["content/DEV/new.md", "create"]]);
    const candidate = parseAdmittedGitIndex(draft.candidateIndex as Uint8Array);
    const readme = candidate.entries.find((entry) => Buffer.from(entry.name).toString("utf8") === "README.md");
    const originalIndex = parseAdmittedGitIndex(await nodeFs.readFile(join(fixture.git, "index")));
    const original = originalIndex.entries.find((entry) => Buffer.from(entry.name).toString("utf8") === "README.md");
    if (readme === undefined || original === undefined) throw new Error("README.md left the index");
    expect(Buffer.from(readme.raw)).toEqual(original.raw);
  });

  it("binds every reflog append bijectively to one ref transition", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    const draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    const valid = corePlan(draft);
    expect(validateGitSyncPlanCore(valid, pushCodec)).toEqual(valid);
    const push = valid.push as TestPush;
    const lineBytes = draft.reflogPlan?.side === "source" ? (draft.reflogPlan.branch?.lineBytes ?? 0) : 0;
    expect(lineBytes).toBeGreaterThan(0);
    const branchReflog = push.sourceAfter.branchReflog;
    if (branchReflog.state !== "present") throw new Error("expected a present branch reflog");
    const planWithDuplicateReflog = {
      ...valid,
      push: { ...push, sourceAfter: { ...push.sourceAfter, branchReflog: { ...branchReflog, size: branchReflog.size + lineBytes } } },
    };
    expect(() => validateGitSyncPlanCore(planWithDuplicateReflog, pushCodec)).toThrow("reflog_bijection");
    const planWithoutRefAdvance = {
      ...valid,
      push: { ...push, sourceAfter: { ...push.sourceAfter, branchRef: push.sourceBefore.branchRef } },
    };
    expect(() => validateGitSyncPlanCore(planWithoutRefAdvance, pushCodec)).toThrow("reflog_bijection");
    const branchLog = draft.transitions.find((transition) => transition.role === "source_branch_reflog");
    const duplicated = [...draft.transitions.slice(0, -1), branchLog, draft.transitions.at(-1)].filter(
      (transition): transition is GitEffectTransitionV1 => transition !== undefined,
    );
    expect(() => {
      assertGitSyncSourceTransitions(duplicated, draft.reflogPlan);
    }).toThrow("control order");
    const withoutBranchLog = draft.transitions.filter((transition) => transition.role !== "source_branch_reflog");
    expect(() => {
      assertGitSyncSourceTransitions(withoutBranchLog, draft.reflogPlan);
    }).toThrow("reflog_bijection");
  });

  it.each(["nestedGitDirectory", "symlinkInScope", "hardLinkInScope", "fileOver16MiB", "otherDevice"] as const)(
    "refuses %s before any ID reservation and leaves .git byte-identical", async (name) => {
      const fixture = await vault();
      const planner = new GitPlanner(fixture.dependencies());
      const before = await fixture.snapshotGit();
      await expect(planner.planSync(fixture.with(name))).rejects.toThrow();
      expect(await fixture.reservations).toBe(0);
      expect(await fixture.snapshotGit()).toEqual(before);
    });

  it.each([
    ["nestedGitDirectory", "nested_git_directory"],
    ["symlinkInScope", "symlink_in_scope"],
    ["hardLinkInScope", "hard_link_in_scope"],
    ["fileOver16MiB", "scope_file_too_large"],
    ["otherDevice", "cross_device_git_state"],
  ] as const)("names the %s refusal class", async (name, expected) => {
    const fixture = await vault();
    expect(await refusal(new GitPlanner(fixture.dependencies()).planSync(fixture.with(name)))).toBe(expected);
  });

  it("orders source objects by path, then index, HEAD reflog, branch reflog and the branch ref last", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    await fixture.write("content/DEV/deep/er.md", "# Deeper\n");
    await nodeFs.rm(join(fixture.root, "content/DEV/B.md"));
    const planner = new GitPlanner(fixture.dependencies());
    const draft = await planner.planSync(fixture.syncRequest());
    const objects = draft.transitions.filter((transition) => transition.role === "source_object");
    expect(objects.length).toBeGreaterThan(0);
    expect(draft.transitions.map((transition) => transition.role)).toEqual([
      ...objects.map(() => "source_object"),
      "source_index",
      "source_head_reflog",
      "source_branch_reflog",
      "source_branch_ref",
    ]);
    const objectPaths = objects.map((transition) => transition.path);
    expect(objectPaths).toEqual([...objectPaths].sort(compareUnsignedUtf8));
    expect(draft.transitions.every((transition) => transition.evidence === GIT_EFFECT_EVIDENCE_UNBOUND)).toBe(true);
    for (const transition of draft.transitions) {
      expect(validateGitEffectTransition(JSON.parse(JSON.stringify(transition)), UID)).toEqual(transition);
    }
    expect(draft.sync.changes.map((change) => [change.path, change.operation])).toEqual([
      ["content/DEV/B.md", "remove"],
      ["content/DEV/deep/er.md", "create"],
      ["content/DEV/new.md", "create"],
    ]);
    expect(draft.counts).toEqual({
      changes: 3,
      managedPaths: draft.sync.managedPaths.length,
      newBlobs: 2,
      newTrees: 4,
      newCommits: 1,
      sourceControlTransitions: 4,
    });
    const feasibility = planner.assertCoreSyncFeasible(draft);
    expect(feasibility.objects).toBe(7);
    expect(feasibility.transitions).toBe(draft.transitions.length);
  });

  it("refuses an adopted repository missing a planned object's fan-out directory before any reservation", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    const planned = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    const object = planned.transitions.find((transition) => transition.role === "source_object" && transition.operation === "create");
    expect(object).toBeDefined();
    await nodeFs.rm(dirname(object?.path ?? ""), { recursive: true });
    const before = await fixture.snapshotGit();
    expect(await refusal(new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest()))).toBe("git_object_parent_absent");
    expect(await fixture.reservations).toBe(0);
    expect(await fixture.snapshotGit()).toEqual(before);
  });

  it("builds the exact commit with the fixed committer, date and message", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    const draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    const commit = draft.objects.find((planned) => planned.object.type === "commit");
    const person = "Synthetic Tester <tester@example.invalid> 1790000000 +0000";
    const text =
      `tree ${draft.sync.candidateTreeOid}\nparent ${fixture.headOid ?? ""}\n` +
      `author ${person}\ncommitter ${person}\n\nchore(brain): sync\n`;
    expect(Buffer.from(commit?.object.raw ?? []).toString("utf8")).toBe(`commit ${Buffer.byteLength(text).toString(10)}\0${text}`);
    expect(draft.sync.commit).toEqual({ parentOid: fixture.headOid, commitOid: commit?.object.oid, message: "chore(brain): sync" });
    const head = draft.reflogPlan?.side === "source" ? draft.reflogPlan.head : null;
    expect(head?.oldOid).toBe(fixture.headOid);
    expect(head?.newOid).toBe(commit?.object.oid);
    expect(head?.committer).toEqual(COMMITTER);
    expect(draft.sourceAfter.branchRef).toEqual({
      state: "present",
      oid: commit?.object.oid,
      bytesHash: sha256(`${commit?.object.oid ?? ""}\n`),
    });
  });

  it("plans an existing unborn repository's first sync with an all-zero old OID and created control files", async () => {
    const fixture = await vault({ born: false });
    const draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    expect(draft.kind).toBe("commit");
    expect(draft.sync.sourcePreconditions.index).toEqual({ state: "absent" });
    expect(draft.sync.commit?.parentOid).toBeNull();
    const head = draft.reflogPlan?.side === "source" ? draft.reflogPlan.head : null;
    expect(head?.oldOid).toBe(GIT_ZERO_OID);
    expect(draft.transitions.filter((transition) => transition.role !== "source_object").map((transition) => transition.operation)).toEqual([
      "create",
      "create",
      "create",
      "create",
    ]);
    expect(draft.transitions.some((transition) => transition.role === "source_git_directory_tree")).toBe(false);
  });

  it("refuses an unborn branch with no scoped content to commit", async () => {
    const fixture = await vault({ born: false, notes: {} });
    expect(await refusal(new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest()))).toBe("unborn_branch_empty");
  });

  it("regenerates a TREE cache the real index carried, and the candidate passes metadata admission", async () => {
    const fixture = await vault({ treeCache: true });
    await fixture.write("content/DEV/new.md", "# New\n");
    const draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    const candidate = draft.candidateIndex as Uint8Array;
    expect(parseAdmittedGitIndex(candidate).hasTreeCache).toBe(true);
    const rootOid = Buffer.from(draft.sync.candidateTreeOid, "hex");
    const marker = Buffer.from(candidate).indexOf(Buffer.from("TREE"));
    expect(marker).toBeGreaterThan(0);
    const header = Buffer.from(`\0${(parseAdmittedGitIndex(candidate).entries.length).toString(10)} `);
    const rootRecord = Buffer.from(candidate).subarray(marker + 8);
    expect(rootRecord.subarray(0, header.byteLength)).toEqual(header);
    const newline = rootRecord.indexOf(0x0a);
    expect(rootRecord.subarray(newline + 1, newline + 21)).toEqual(rootOid);

    await fixture.writeGit("index", candidate);
    const admitted = await inspectGitMetadata(
      {
        fs: fixture.dependencies().fs,
        streamRegular: createNodeGitMetadataStream(),
        redact: (text) => text,
        effectiveUid: UID,
      },
      { repositoryRoot: fixture.root, branch: parseValidatedGitBranch("main") },
    );
    expect(admitted.index).toEqual({ state: "present", bytesHash: sha256(candidate) });

    const plain = await vault();
    await plain.write("content/DEV/new.md", "# New\n");
    const plainDraft = await new GitPlanner(plain.dependencies()).planSync(plain.syncRequest());
    expect(parseAdmittedGitIndex(plainDraft.candidateIndex as Uint8Array).hasTreeCache).toBe(false);
  });

  it("refuses a dirty index and an in-progress history operation", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    const dirty = fixture.dependencies({ commitTree: () => Promise.resolve(GIT_EMPTY_TREE_OID) });
    expect(await refusal(new GitPlanner(dirty).planSync(fixture.syncRequest()))).toBe("dirty_index");
    for (const marker of ["MERGE_HEAD", "rebase-merge/head-name", "CHERRY_PICK_HEAD", "sequencer/todo"]) {
      const inProgress = await vault();
      await inProgress.writeGit(marker, `${"2".repeat(40)}\n`);
      expect(await refusal(new GitPlanner(inProgress.dependencies()).planSync(inProgress.syncRequest()))).toBe(
        "history_operation_in_progress",
      );
    }
  });

  it("refuses a scoped tab, LF or CR filename at scope admission, before any read", async () => {
    for (const name of ["content/DEV/tab\tname.md", "content/DEV/line\nfeed.md", "content/DEV/carriage\rreturn.md"]) {
      const fixture = await vault();
      await fixture.write(name, "# control\n");
      expect(await refusal(new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest()))).toBe(
        "unsupported_scope_entry",
      );
    }
  });

  it("accepts the 64-MiB reflog preimage plus one append and refuses the next preimage byte", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    await fixture.sparseGit("logs/HEAD", GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes, 0x0a);
    const draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
    const head = draft.reflogPlan?.side === "source" ? draft.reflogPlan.head : null;
    expect(head?.after.size).toBe(GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes + (head?.lineBytes ?? 0));
    expect(head?.after.size).toBeLessThanOrEqual(GIT_METADATA_BOUNDS.reflogPostimageMaxBytes);

    const over = await vault();
    await over.write("content/DEV/new.md", "# New\n");
    await over.sparseGit("logs/HEAD", GIT_METADATA_BOUNDS.sourceHeadReflogMaxBytes + 1, 0x0a);
    await expect(new GitPlanner(over.dependencies()).planSync(over.syncRequest())).rejects.toThrow(GitMetadataRefusalError);
  });

  it("reports no_changes only when nothing changed and HEAD equals the last pushed HEAD", async () => {
    const fixture = await vault();
    const planner = new GitPlanner(fixture.dependencies());
    const head = fixture.headOid as LowerHexSha1;
    const managedPaths = sortUnsignedUtf8(Object.keys(BASE_NOTES));
    const pushed = await planner.planSync(fixture.syncRequest({ baseline: { lastPushedHeadOid: head, managedPaths } }));
    expect(pushed.kind).toBe("no_changes");
    expect(pushed.sync.commit).toBeNull();
    expect(pushed.sourceAfter).toEqual(pushed.sync.sourcePreconditions);
    expect(pushed.transitions).toEqual([]);
    expect((await planner.planSync(fixture.syncRequest())).kind).toBe("push_only");
    const behind = await planner.planSync(
      fixture.syncRequest({ baseline: { lastPushedHeadOid: "3".repeat(40) as LowerHexSha1, managedPaths } }),
    );
    expect(behind.kind).toBe("push_only");
    const pushOnly = corePlan(behind);
    expect(validateGitSyncPlanCore(pushOnly, pushCodec)).toEqual(pushOnly);
  });

  it("retires the last managed inventory minus the current scope without touching the local files", async () => {
    const fixture = await vault();
    const head = fixture.headOid as LowerHexSha1;
    const managedPaths = sortUnsignedUtf8(Object.keys(BASE_NOTES));
    const snapshot = fixture.scope(["OPS"]);
    const draft = await new GitPlanner(fixture.dependencies()).planSync(
      fixture.syncRequest({ scope: snapshot, config: fixture.config(snapshot), baseline: { lastPushedHeadOid: head, managedPaths } }),
    );
    expect(draft.sync.changes.map((change) => [change.path, change.operation])).toEqual([
      ["content/DEV/B.md", "remove"],
      ["content/DEV/a.md", "remove"],
      ["content/DEV/é.md", "remove"],
      ["content/OPS/o.md", "create"],
    ]);
    await expect(nodeFs.readFile(join(fixture.root, "content/DEV/a.md"), "utf8")).resolves.toBe("# A\n");
  });

  it("refuses a changed scope key as scope_reconcile_required and a changed brainPath as repository identity", async () => {
    const fixture = await vault();
    const planner = new GitPlanner(fixture.dependencies());
    const widened = fixture.scope(["DEV", "OPS"]);
    expect(await refusal(planner.planSync(fixture.syncRequest({ scope: widened, config: fixture.config() })))).toBe(
      "scope_reconcile_required",
    );
    const moved = fixture.scope(["DEV"], fixture.home);
    expect(await refusal(planner.planSync(fixture.syncRequest({ scope: moved, config: fixture.config() })))).toBe(
      "repository_identity_changed",
    );
  });

  it("refuses a scoped secret before hashing it", async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/key.md", `token ${SECRET}\n`);
    expect(await refusal(new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest()))).toBe("scope_secret");
  });
});

describe("buildGitTree", () => {
  it("renders tab, LF and CR names through the NUL-delimited mktree grammar and the binary tree object", () => {
    const leaves = ["carriage\rreturn.md", "line\nfeed.md", "tab\tname.md", "plain.md"];
    const entries = leaves
      .map((leaf) => {
        const bytes = encoder.encode(`# ${leaf}\n`);
        return gitIndexEntry(encoder.encode(`content/DEV/${leaf}`), 0o100644, gitObject("blob", bytes).oid, bytes.byteLength);
      })
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    const root = buildGitTree(entries);
    const dev = root.subtrees[0]?.node.subtrees[0]?.node;
    expect(Buffer.from(dev?.directory ?? []).toString("utf8")).toBe("content/DEV");
    const input = Buffer.from(dev?.mktreeInput ?? []);
    const content = Buffer.from(dev?.object.raw ?? []);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const leaf = Buffer.from(entry.name).subarray("content/DEV/".length);
      expect(input.includes(Buffer.concat([Buffer.from(`100644 blob ${entry.oid}\t`), leaf, Buffer.of(0)]))).toBe(true);
      expect(
        content.includes(Buffer.concat([Buffer.from("100644 "), leaf, Buffer.of(0), Buffer.from(entry.oid, "hex")])),
      ).toBe(true);
    }
    expect(input.at(-1)).toBe(0);
    expect(input.toString("utf8").split("\0").filter((record) => record.length > 0)).toHaveLength(leaves.length);
  });

  it("refuses a name used both as a file and a directory", () => {
    const oid = gitObject("blob", encoder.encode("x")).oid;
    const entries = [gitIndexEntry(encoder.encode("a"), 0o100644, oid, 1), gitIndexEntry(encoder.encode("a/b"), 0o100644, oid, 1)];
    expect(() => buildGitTree(entries)).toThrow(GitMetadataRefusalError);
    expect(buildGitTree([]).object.oid).toBe(GIT_EMPTY_TREE_OID);
  });
});

describe("GIT_SYNC_CARDINALITY", () => {
  const counts = { changes: 0, managedPaths: 0, newBlobs: 0, newTrees: 0, newCommits: 0, sourceControlTransitions: 0 };

  it("admits 100,000 blobs, 100,000 trees and one commit as exactly 200,001 objects", () => {
    expect(
      deriveGitSyncCardinality({ ...counts, changes: 100000, newBlobs: 100000, newTrees: 100000, newCommits: 1, sourceControlTransitions: 4 }),
    ).toEqual({ objects: 200001, transitions: 200005 });
    expect(GIT_SYNC_CARDINALITY.maxSourceObjectTransitions).toBe(200001);
    expect(GIT_SYNC_CARDINALITY.maxGitEffectTransitions).toBe(200005);
  });

  it.each([
    ["a 100,001st blob", { newBlobs: 100001, newTrees: 100000, newCommits: 1 }],
    ["a 100,001st tree", { newBlobs: 100000, newTrees: 100001, newCommits: 1 }],
    ["a second commit", { newBlobs: 0, newTrees: 0, newCommits: 2 }],
    ["a fifth control transition", { sourceControlTransitions: 5 }],
    ["a 100,001st change", { changes: 100001 }],
  ] as const)("refuses %s (the 200,002 boundary)", (_name, override) => {
    expect(() => deriveGitSyncCardinality({ ...counts, ...override })).toThrow(GitPlanningRefusalError);
  });
});

describe("GitPlanner previews", () => {
  it("initializes an absent repository with the enable-only minimal .git", async () => {
    const fixture = await vault({ git: false });
    const preview = await new GitPlanner(fixture.dependencies()).previewEnable(fixture.enableRequest());
    const initial = planInitialGitDirectory(parseValidatedGitBranch("main"), URL);
    expect(preview.repositoryMode).toBe("initialize");
    expect(preview.branch).toBe("main");
    expect(preview.changes).toEqual([
      {
        role: "source_git",
        targetPath: `${fixture.root}/.git`,
        operation: "create",
        before: { state: "absent" },
        after: { state: "present", hash: initial.treeHash, size: initial.totalBytes },
      },
    ]);
    expect(initial.entries.map((entry) => entry.relativePath)).toEqual(
      initialGitDirectoryPaths(parseValidatedGitBranch("main")),
    );
    expect(initial.entries.map((entry) => entry.relativePath)).toEqual(
      expect.arrayContaining(["HEAD", "config", "objects", "objects/00", "objects/ff", "refs", "refs/heads", "logs", "logs/refs", "logs/refs/heads"]),
    );
    expect(initial.entries).toHaveLength(264);
    expect(Buffer.from(initial.entries[0]?.bytes ?? []).toString("utf8")).toBe("ref: refs/heads/main\n");
    expect(Buffer.from(initial.entries[1]?.bytes ?? []).toString("utf8")).toContain(
      '[remote "developer-os"]\n\turl = "https://example.com/org/brain.git"\n',
    );
    const explicit = await new GitPlanner(fixture.dependencies()).previewEnable(
      fixture.enableRequest({ branch: parseValidatedGitBranch("brain") }),
    );
    expect(explicit.branch).toBe("brain");
    await expect(nodeFs.readdir(fixture.root)).resolves.not.toContain(".git");
  });

  it("adopts an existing repository by adding, reusing or refusing the fixed remote", async () => {
    const bare = await vault();
    const added = await new GitPlanner(bare.dependencies()).previewEnable(bare.enableRequest());
    expect(added.repositoryMode).toBe("adopt");
    const after = appendGitRemoteSection(encoder.encode(CONFIG), URL);
    expect(added.changes).toEqual([
      {
        role: "source_git",
        targetPath: `${bare.git}/config`,
        operation: "replace",
        before: { state: "present", hash: sha256(CONFIG), size: encoder.encode(CONFIG).byteLength },
        after: { state: "present", hash: sha256(after), size: after.byteLength },
      },
    ]);

    const same = await vault({ remote: URL });
    const reused = await new GitPlanner(same.dependencies()).previewEnable(same.enableRequest());
    expect(reused.changes.map((change) => change.operation)).toEqual(["keep"]);

    const different = await vault({ remote: OTHER_URL });
    expect(await refusal(new GitPlanner(different.dependencies()).previewEnable(different.enableRequest()))).toBe(
      "remote_conflict",
    );
    const mismatched = await vault();
    await expect(
      new GitPlanner(mismatched.dependencies()).previewEnable(
        mismatched.enableRequest({ branch: parseValidatedGitBranch("other") }),
      ),
    ).rejects.toThrow(GitMetadataRefusalError);
  });

  it("prints byte-identical, allocation-free enable previews", async () => {
    const fixture = await vault();
    const planner = new GitPlanner(fixture.dependencies());
    const before = await fixture.snapshotGit();
    const first = await planner.previewEnable(fixture.enableRequest());
    const second = await planner.previewEnable(fixture.enableRequest());
    expect(GIT_PLAN_PREVIEW_CODEC.encode(first)).toBe(GIT_PLAN_PREVIEW_CODEC.encode(second));
    expect(GIT_PLAN_PREVIEW_CODEC.validate(JSON.parse(GIT_PLAN_PREVIEW_CODEC.encode(first)))).toEqual(first);
    expect(await fixture.reservations).toBe(0);
    expect(await fixture.snapshotGit()).toEqual(before);
    expect(() => GIT_PLAN_PREVIEW_CODEC.validate({ ...first, extra: true })).toThrow();
  });

  it("states the branch-history warning with every enable plan", async () => {
    const fixture = await vault();
    const plan = describeGitEnablePlan(await new GitPlanner(fixture.dependencies()).previewEnable(fixture.enableRequest()));
    expect(plan.warning).toBe(GIT_ENABLE_BRANCH_HISTORY_WARNING);
    expect(plan.warning).toContain("may reach the remote");
    expect(plan.warning).toContain("neither scans nor rewrites");
  });

  it("shows reconcile retirements and refuses reconcile over pending or unpushed history", async () => {
    const fixture = await vault({ remote: URL });
    const planner = new GitPlanner(fixture.dependencies());
    const head = fixture.headOid as LowerHexSha1;
    const recorded = fixture.config();
    const baseline: GitSyncBaselineV1 = { lastPushedHeadOid: head, managedPaths: sortUnsignedUtf8(Object.keys(BASE_NOTES)) };
    const request = fixture.enableRequest({ scope: fixture.scope(["OPS"]), recorded, baseline });
    const preview = await planner.previewEnable(request);
    expect(preview.repositoryMode).toBe("preserve");
    const removed = preview.changes.filter((change) => change.operation === "remove");
    expect(removed.map((change) => change.targetPath)).toEqual(
      ["content/DEV/B.md", "content/DEV/a.md", "content/DEV/é.md"].map((path) => `${fixture.root}/${path}`),
    );
    expect(removed[1]?.before).toEqual({ state: "present", hash: sha256("# A\n"), size: 4 });
    expect(removed.every((change) => change.after.state === "absent")).toBe(true);
    expect(await refusal(planner.previewEnable({ ...request, pushPending: true }))).toBe("reconcile_push_pending");
    expect(
      await refusal(
        planner.previewEnable({ ...request, baseline: { ...baseline, lastPushedHeadOid: "4".repeat(40) as LowerHexSha1 } }),
      ),
    ).toBe("reconcile_local_history");
    expect(
      await refusal(planner.previewEnable({ ...request, remote: { ...REMOTE, declaredUrl: OTHER_URL, effectivePushUrl: OTHER_URL } })),
    ).toBe("retained_identity_mismatch");
  });

  it("previews disable with no Git mutation", async () => {
    const fixture = await vault();
    const config = fixture.config();
    const preview = await new GitPlanner(fixture.dependencies()).previewDisable({ config });
    expect(preview).toEqual({
      repositoryMode: "preserve",
      repositoryRoot: fixture.root,
      branch: config.branch,
      remote: config.remote,
      scope: config.scope,
      changes: [],
    });
  });
});

describe("GitSyncPlanCoreV1", () => {
  let draft: GitSyncPlanningDraft;

  beforeAll(async () => {
    const fixture = await vault();
    await fixture.write("content/DEV/new.md", "# New\n");
    draft = await new GitPlanner(fixture.dependencies()).planSync(fixture.syncRequest());
  });

  it("refuses unknown keys, unsorted paths and a commit without a source effect", () => {
    const valid = corePlan(draft);
    expect(() => validateGitSyncPlanCore({ ...valid, extra: 1 }, pushCodec)).toThrow("keys");
    expect(() => validateGitSyncPlanCore({ ...valid, managedPaths: [...valid.managedPaths].reverse() }, pushCodec)).toThrow("order");
    expect(() => validateGitSyncPlanCore({ ...valid, sourceGitEffectPlanHash: null }, pushCodec)).toThrow(
      "sourceGitEffectPlanHash",
    );
    expect(() => validateGitSyncPlanCore({ ...valid, push: null }, pushCodec)).toThrow("push");
    expect(() =>
      validateGitSyncPlanCore({ ...valid, commit: { ...valid.commit, message: "chore: other" } }, pushCodec),
    ).toThrow("message");
  });
});
