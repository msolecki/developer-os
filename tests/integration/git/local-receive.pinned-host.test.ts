import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  parseCanonicalAbsolutePathText,
  parseFullBranchRef,
  parseLowerHexSha1,
  type GitRefStateV1,
  type LowerHexSha1,
  type LowerHexSha256,
} from "@developer-os/core";
import {
  SUPPORTED_GIT_DISTRIBUTION,
  admitGitDistribution,
  materializeSanitizedBareDestinationShadow,
  prepareLocalReceive,
  validateShadowConfigTemplate,
  type GitLocalReceiveRunV1,
  type ObservedGitDistributionV1,
  type SanitizedBareDestinationShadowV1,
} from "@developer-os/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Plan 1b Task 13 on the pinned host (founder Q5): real `git-receive-pack`
 * and its `index-pack --keep` child write into a materialized private
 * destination shadow, then `prepareLocalReceive` validates what they
 * produced. Every repository is a synthetic one under a fresh `mktemp`
 * directory. On any other Git distribution the observation refuses
 * `unsupported_git_distribution`: a skip would read as a pass.
 */

const git = (id: "git_main" | "system_ssh" | "git_remote_https"): string => {
  const executable = SUPPORTED_GIT_DISTRIBUTION.executables.find((candidate) => candidate.id === id);
  if (executable === undefined) throw new Error(`the supported row has no ${id}`);
  return executable.invokedPath;
};

const GIT = git("git_main");
const UID = process.getuid?.() ?? 0;
const BRANCH = parseFullBranchRef("refs/heads/main");

async function linkChain(path: string): Promise<{ path: string; target: string }[]> {
  const chain: { path: string; target: string }[] = [];
  let current = path;
  while ((await lstat(current)).isSymbolicLink()) {
    const target = await readlink(current);
    chain.push({ path: current, target });
    current = target.startsWith("/") ? target : `${current.slice(0, current.lastIndexOf("/"))}/${target}`;
  }
  return chain;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

/** The measured identity of the installed distribution, read-only, exactly as the row records it. */
async function observeInstalledGitDistribution(): Promise<ObservedGitDistributionV1> {
  const xcode = lines(execFileSync("/usr/bin/xcodebuild", ["-version"], { encoding: "utf8", env: {} }));
  const build = lines(execFileSync(GIT, ["version", "--build-options"], { encoding: "utf8", env: {} }));
  const executables = [];
  for (const row of SUPPORTED_GIT_DISTRIBUTION.executables) {
    const canonicalPath = await realpath(row.invokedPath);
    const stats = await lstat(canonicalPath);
    const versionLines =
      row.id === "git_main"
        ? build.slice(0, 1)
        : row.id === "system_ssh"
          ? lines(spawnSync(row.invokedPath, ["-V"], { encoding: "utf8", env: {} }).stderr)
          : [];
    executables.push({
      id: row.id,
      invokedPath: row.invokedPath,
      linkChain: await linkChain(row.invokedPath),
      target: {
        canonicalPath,
        ownerUid: stats.uid,
        mode: stats.mode & 0o7777,
        size: stats.size,
        sha256: createHash("sha256").update(await readFile(canonicalPath)).digest("hex"),
      },
      versionLines,
    });
  }
  const execPathLinks = [];
  for (const row of SUPPORTED_GIT_DISTRIBUTION.execPathLinks) {
    const stats = await lstat(row.path);
    execPathLinks.push({
      name: row.name,
      path: row.path,
      ownerUid: stats.uid,
      mode: stats.mode & 0o7777,
      size: stats.size,
      target: await readlink(row.path),
    });
  }
  return {
    xcode: { version: (xcode[0] ?? "").replace(/^Xcode /u, ""), build: (xcode[1] ?? "").replace(/^Build version /u, "") },
    architecture: execFileSync("/usr/bin/uname", ["-m"], { encoding: "utf8", env: {} }).trim(),
    buildOptionLines: build.slice(1),
    executables,
    execPathLinks,
  };
}

const destinationTemplate = validateShadowConfigTemplate({
  schemaVersion: 1,
  kind: "bare_destination",
  core: { repositoryFormatVersion: 0, fileMode: true, bare: true, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
  remote: null,
  receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: false },
});

let root: string;
let source: string;
let environment: Record<string, string>;

function run(args: readonly string[], cwd: string, extra: Record<string, string> = {}): string {
  return execFileSync(GIT, args, { cwd, encoding: "utf8", env: { ...environment, ...extra } }).trim();
}

async function commitFile(name: string, text: string): Promise<LowerHexSha1> {
  await writeFile(`${source}/${name}`, text);
  run(["add", "--", name], source);
  run(["commit", "-q", "-m", "developer-os sync"], source);
  return parseLowerHexSha1(run(["rev-parse", "HEAD"], source));
}

function reachable(oid: LowerHexSha1): LowerHexSha1[] {
  return lines(run(["rev-list", "--objects", oid], source)).map((line) => parseLowerHexSha1(line.slice(0, 40)));
}

async function packHeaderCount(shadow: SanitizedBareDestinationShadowV1): Promise<number | null> {
  const name = (await readdir(`${shadow.objectDirectory}/pack`)).find((entry) => entry.endsWith(".pack"));
  if (name === undefined) return null;
  const handle = await open(`${shadow.objectDirectory}/pack/${name}`, "r");
  try {
    const header = new Uint8Array(12);
    await handle.read(header, 0, 12, 0);
    return new DataView(header.buffer).getUint32(8);
  } finally {
    await handle.close();
  }
}

interface ScenarioV1 {
  readonly commitOid: LowerHexSha1;
  readonly snapshot: readonly { readonly ref: string; readonly oid: LowerHexSha1 }[];
  readonly target: LowerHexSha1 | null;
  readonly boundary: readonly LowerHexSha1[];
}

/**
 * The real receive: `send-pack` from the source starts the pinned
 * `receive-pack --skip-connectivity-check` against the private shadow,
 * whose only view of existing objects is the source object alternate.
 */
async function scenario(input: ScenarioV1): Promise<Awaited<ReturnType<typeof prepareLocalReceive>>> {
  const quarantine = parseCanonicalAbsolutePathText(`${root}/staging/lifecycle/c1/git/destination/ge1`);
  await mkdir(quarantine, { recursive: true, mode: 0o700 });
  const gitDirectory = parseCanonicalAbsolutePathText(`${root}/remote.git`);
  await mkdir(`${gitDirectory}/objects/pack`, { recursive: true });
  const shadow = await materializeSanitizedBareDestinationShadow({
    gitDir: parseCanonicalAbsolutePathText(`${quarantine}/shadow`),
    template: destinationTemplate,
    opaqueLocalToken: null,
    head: new TextEncoder().encode(`ref: ${BRANCH}\n`),
    refs: input.snapshot.map((entry) => ({ ref: parseFullBranchRef(entry.ref), bytes: new TextEncoder().encode(`${entry.oid}\n`) })),
    effectiveUid: UID,
  });
  const target: GitRefStateV1 =
    input.target === null ? { state: "absent" } : { state: "present", oid: input.target, bytesHash: "0".repeat(64) as LowerHexSha256 };
  const receive = async (): Promise<GitLocalReceiveRunV1> => {
    run(
      ["send-pack", `--receive-pack=${GIT} receive-pack --skip-connectivity-check`, shadow.gitDir, `${input.commitOid}:${BRANCH}`],
      source,
      { GIT_ALTERNATE_OBJECT_DIRECTORIES: `${source}/.git/objects` },
    );
    const count = await packHeaderCount(shadow);
    return {
      nodes:
        count === null
          ? ["gateway_receive_pack", "real_receive_pack"]
          : ["gateway_receive_pack", "real_receive_pack", "gateway_index_git", "real_index_git"],
      packHeaderObjectCount: count,
    };
  };
  const result = await prepareLocalReceive({
    quarantineRoot: quarantine,
    destinationShadow: shadow,
    destination: { gitDirectory, branchRef: BRANCH, target },
    commitOid: input.commitOid,
    boundary: new Set(input.boundary),
    phase: { remainingMilliseconds: () => 600000 },
    effectiveUid: UID,
    receive,
  });
  expect(await readdir(`${gitDirectory}/objects/pack`)).toEqual([]);
  return result;
}

describe("local receive on the pinned Git distribution", () => {
  beforeEach(async () => {
    admitGitDistribution(await observeInstalledGitDistribution(), SUPPORTED_GIT_DISTRIBUTION);
    root = await realpath(await mkdtemp(`${tmpdir()}/developer-os-local-receive-pinned-`));
    const home = `${root}/home`;
    await mkdir(home, { mode: 0o700 });
    source = `${root}/source`;
    environment = {
      HOME: home,
      PATH: "/usr/bin:/bin",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Synthetic",
      GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_NAME: "Synthetic",
      GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    };
    run(["init", "-q", "-b", "main", source], root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("validates the first received closure with all three counts equal", async () => {
    await commitFile("a.md", "alpha\n");
    const head = await commitFile("b.md", "beta\n");
    const result = await scenario({ commitOid: head, snapshot: [], target: null, boundary: [] });
    expect(result.kind).toBe("pack_received");
    expect(result.processNodes).toEqual(["receive-pack", "index-pack"]);
    const count = reachable(head).length;
    expect(result.packReaderBudget).toMatchObject({ packHeaderObjectCount: count, admittedObjectCount: count, closedEffectObjectCount: count });
    expect(result.destinationTransitions.map((transition) => transition.operation)).toEqual(["create", "create"]);
  });

  it("validates a thin incremental pack whose fix-thin bases the destination already owns", async () => {
    await commitFile("a.md", `${"line\n".repeat(400)}alpha\n`);
    const prior = await commitFile("b.md", "beta\n");
    const head = await commitFile("a.md", `${"line\n".repeat(400)}gamma\n`);
    const result = await scenario({ commitOid: head, snapshot: [{ ref: BRANCH, oid: prior }], target: prior, boundary: reachable(prior) });
    expect(result.kind).toBe("pack_received");
    expect(result.closure?.budget.admittedObjectCount).toBe(result.closure?.budget.closedEffectObjectCount);
  });

  it("accepts a zero-object pack when the destination already owns the commit through another ref", async () => {
    const head = await commitFile("a.md", "alpha\n");
    const result = await scenario({
      commitOid: head,
      snapshot: [{ ref: "refs/heads/other", oid: head }],
      target: null,
      boundary: reachable(head),
    });
    expect(result.packReaderBudget).toMatchObject({ packHeaderObjectCount: 0, admittedObjectCount: 0, closedEffectObjectCount: 0 });
  });

  it("accepts the exact up-to-date target without pack/index children", async () => {
    const head = await commitFile("a.md", "alpha\n");
    const result = await scenario({ commitOid: head, snapshot: [{ ref: BRANCH, oid: head }], target: head, boundary: reachable(head) });
    expect(result.destinationTransitions).toEqual([]);
    expect(result.processNodes).toEqual(["receive-pack"]);
  });
});
