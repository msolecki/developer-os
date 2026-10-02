import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  parseCanonicalAbsolutePathText,
  parseFullBranchRef,
  parseLowerHexSha1,
  type GitRefStateV1,
  type LowerHexSha1,
  type LowerHexSha256,
} from "@developer-os/core";
import { DESTINATION_SHADOW_TEMPLATE } from "@developer-os/cli/dist/commands/git/runtime.js";
import { DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath } from "@developer-os/platform-macos";
import {
  admitGitCapability,
  admitGitExecutables,
  materializeSanitizedBareDestinationShadow,
  prepareLocalReceive,
  validateShadowConfigTemplate,
  type AdmittedGitExecutablesV1,
  type GitLocalReceiveRunV1,
  type SanitizedBareDestinationShadowV1,
} from "@developer-os/security";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Plan 1b Task 13 on an admitted host (founder Q5, D71): the real
 * `/usr/bin/git-receive-pack` shim and its `index-pack --keep` child write into
 * a materialized private destination shadow, then `prepareLocalReceive`
 * validates what they produced. Every repository is a synthetic one under a
 * fresh `mktemp` directory. A host whose fixed-path Git does not admit refuses
 * `unsupported_git_distribution` and fails the file: a skip would read as a pass.
 */

let admitted: AdmittedGitExecutablesV1;
let GIT = "";
let RECEIVE_PACK = "";
const UID = process.getuid?.() ?? 0;
const BRANCH = parseFullBranchRef("refs/heads/main");

beforeAll(async () => {
  admitted = await admitGitExecutables(DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath, process.arch, "local");
  GIT = admitted.git.canonicalPath;
  RECEIVE_PACK = admitted.receivePack.canonicalPath;
});

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

/** The production destination shadow's own template: no destination objects, no fast-forward parse. */
const destinationTemplate = validateShadowConfigTemplate(DESTINATION_SHADOW_TEMPLATE);

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
 * which, like production's, holds none of the destination's objects.
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
    // As production: a self-contained (`--no-thin`) pack and nothing else to read from. Git's local
    // transport unsets GIT_ALTERNATE_OBJECT_DIRECTORIES before receive-pack, and production's
    // `destination_receive` profile and shadow carry no alternate either.
    run(["send-pack", "--no-thin", `--receive-pack=${RECEIVE_PACK} --skip-connectivity-check`, shadow.gitDir, `${input.commitOid}:${BRANCH}`], source);
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

// No raw receive of a commit the destination already owns is pinned here: production materializes only
// the branch ref in the shadow, so a contained commit is either the up-to-date target below or refused
// non_fast_forward before any receive-pack runs (tests/integration/git/lifecycle.test.ts).
describe("local receive on the admitted fixed-path Git", () => {
  beforeEach(async () => {
    admitGitCapability(admitted, execFileSync(GIT, ["--version", "--build-options"], { encoding: "utf8", env: {} }), 0);
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

  it("accepts the exact up-to-date target without pack/index children", async () => {
    const head = await commitFile("a.md", "alpha\n");
    const result = await scenario({ commitOid: head, snapshot: [{ ref: BRANCH, oid: head }], target: head, boundary: reachable(head) });
    expect(result.destinationTransitions).toEqual([]);
    expect(result.processNodes).toEqual(["receive-pack"]);
  });
});
