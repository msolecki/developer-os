import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { parseCanonicalAbsolutePathText, parseFullBranchRef, parseLowerHexSha1, type LowerHexSha1, type LowerHexSha256 } from "@developer-os/core";
import { createProductionGitRuntime } from "@developer-os/cli/dist/commands/git/runtime.js";
import type { GitLocalPushPreparationV1 } from "@developer-os/cli/dist/commands/git/runtime.js";
import { SUPPORTED_GIT_DISTRIBUTION } from "@developer-os/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The production `prepareLocalPush` on the pinned host (founder Q5, D62):
 * the real gateway graph against synthetic repositories under a fresh
 * `mktemp` directory. On any other Git distribution it refuses
 * `unsupported_git_distribution`: a skip would read as a pass.
 */

const GIT = SUPPORTED_GIT_DISTRIBUTION.executables.find((candidate) => candidate.id === "git_main")?.invokedPath ?? "";
const UID = process.getuid?.() ?? 0;
const BRANCH = parseFullBranchRef("refs/heads/main");

let root: string;
let source: string;
let remote: string;
let environment: Record<string, string>;
let quarantines = 0;

function run(args: readonly string[], cwd: string): string {
  return execFileSync(GIT, args, { cwd, encoding: "utf8", env: environment }).trim();
}

async function commitFile(name: string, text: string): Promise<LowerHexSha1> {
  await writeFile(`${source}/${name}`, text);
  run(["add", "--", name], source);
  run(["commit", "-q", "-m", "developer-os sync"], source);
  return parseLowerHexSha1(run(["rev-parse", "HEAD"], source));
}

/** Publishes `oid` into the real bare remote with plain Git, as an earlier sync would have. */
function publish(oid: LowerHexSha1): void {
  run(["push", "-q", remote, `${oid}:${BRANCH}`], source);
}

async function push(commitOid: LowerHexSha1): Promise<GitLocalPushPreparationV1> {
  quarantines += 1;
  const quarantineRoot = parseCanonicalAbsolutePathText(`${root}/staging/q${String(quarantines)}`);
  await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  let target;
  try {
    target = { state: "present" as const, oid: parseLowerHexSha1(run(["rev-parse", BRANCH], remote)), bytesHash: "0".repeat(64) as LowerHexSha256 };
  } catch {
    target = { state: "absent" as const };
  }
  return createProductionGitRuntime().prepareLocalPush({
    sourceGitDirectory: parseCanonicalAbsolutePathText(`${source}/.git`),
    candidate: { blobs: [], trees: [], commit: null },
    commitOid,
    branchRef: BRANCH,
    destination: { gitDirectory: parseCanonicalAbsolutePathText(remote), head: new TextEncoder().encode(`ref: ${BRANCH}\n`), target },
    quarantineRoot,
    effectiveUid: UID,
  });
}

describe("local push through the production gateway graph on the pinned Git distribution", () => {
  beforeEach(async () => {
    root = await realpath(await mkdtemp(`${tmpdir()}/developer-os-local-push-pinned-`));
    const home = `${root}/home`;
    await mkdir(home, { mode: 0o700 });
    source = `${root}/source`;
    remote = `${root}/remote.git`;
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
    run(["init", "-q", "--bare", "-b", "main", remote], root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("pushes a first one-file sync through the production gateway graph", async () => {
    const head = await commitFile("a.md", "alpha\n");
    const { preparation } = await push(head);
    expect(preparation.kind).toBe("pack_received");
    expect(preparation.packReaderBudget?.packHeaderObjectCount).toBe(3);
  });

  it("packs only the new objects on the second of two one-file syncs", async () => {
    const first = await commitFile("a.md", "alpha\n");
    publish(first);
    const second = await commitFile("b.md", "beta\n");
    // The new blob, the new root tree and the new commit; the first commit's tree and blob stay behind.
    expect((await push(second)).preparation.packReaderBudget?.packHeaderObjectCount).toBe(3);
  });

  it("closes a pack that re-adds content only the destination's history holds", async () => {
    await commitFile("a.md", "alpha\n");
    const second = await commitFile("a.md", "beta\n");
    publish(second);
    const third = await commitFile("a.md", "alpha\n");
    const { preparation } = await push(third);
    expect(preparation.kind).toBe("pack_received");
    // pack-objects excludes only the target's own tree, so the older blob travels again.
    expect(preparation.packReaderBudget?.packHeaderObjectCount).toBe(3);
  });

  it("takes the zero-transition up-to-date arm for an already-pushed commit", async () => {
    const head = await commitFile("a.md", "alpha\n");
    publish(head);
    const { preparation } = await push(head);
    expect(preparation.kind).toBe("up_to_date");
    expect(preparation.destinationTransitions).toEqual([]);
    expect(preparation.processNodes).toEqual(["receive-pack"]);
  });

  it("stops the boundary at packed history below a loose target", async () => {
    await mkdir(`${source}/notes`);
    await commitFile("notes/a.md", "alpha\n");
    run(["repack", "-a", "-d", "-q"], source);
    run(["prune-packed"], source);
    const target = await commitFile("b.md", "beta\n");
    publish(target);
    const head = await commitFile("b.md", "gamma\n");
    const { preparation } = await push(head);
    expect(preparation.kind).toBe("pack_received");
    // The new blob, the new root tree and the new commit; the packed notes/ subtree stays behind.
    expect(preparation.packReaderBudget?.packHeaderObjectCount).toBe(3);
  });
});
