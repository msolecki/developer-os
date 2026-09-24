/**
 * Test support for the `git` command: a scripted `GitRuntimeV1` that never spawns the pinned
 * Git (Q5: CI cannot run it) and ports that can make the destination effect refuse before its
 * journal exists — the one way a local push reaches `push_pending`.
 */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { basename, join } from "node:path";

import {
  parseCanonicalAbsolutePathText,
  parseLowerHexSha1,
  parseLowerHexSha256,
  parseUInt64Decimal,
  validateGitEffectTransition,
  validateGitPackReaderBudget,
} from "@developer-os/core";
import type { GitEffectTransitionV1 } from "@developer-os/core";
import { SUPPORTED_GIT_DISTRIBUTION, SecurityRefusalError, hashGitProcessTable } from "@developer-os/security";

import { createLifecycleEffectPorts, REJECTING_LAUNCHD_HOST } from "../../lifecycle/adapters.js";
import type { LifecycleEffectPortsV1 } from "../../lifecycle/adapters.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { createProductionGitRuntime } from "./runtime.js";
import type { GitLocalPushRequestV1, GitRuntimeV1 } from "./runtime.js";

export interface ScriptedGitRuntimeV1 extends GitRuntimeV1 {
  /** Every Git process tree the runtime would have started, by commit pushed. */
  readonly spawns: string[];
  /** Every network push attempted; the scripted runtime has none, so this stays empty. */
  readonly networkCalls: string[];
  drifted: boolean;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function stage(path: string, bytes: Uint8Array): Promise<GitEffectTransitionV1["evidence"]["stagedPostimage"]> {
  await nodeFs.writeFile(path, bytes, { mode: 0o444, flag: "wx" });
  const stats = await nodeFs.lstat(path, { bigint: true });
  return {
    state: "regular_file",
    hash: parseLowerHexSha256(sha256(bytes)),
    size: bytes.byteLength,
    mode: Number(stats.mode & 0o777n),
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
    semantic: { kind: "none" },
  };
}

/**
 * Stands in for the helper graph: a synthetic pack and index named by their own checksum are
 * staged as the destination's two creates. The executor moves bytes and never parses a pack.
 */
async function scriptedLocalPush(request: GitLocalPushRequestV1): ReturnType<GitRuntimeV1["prepareLocalPush"]> {
  const post = join(request.quarantineRoot, "post");
  await nodeFs.mkdir(post, { mode: 0o700 });
  const pack = new TextEncoder().encode(`PACK synthetic ${request.commitOid}\n`);
  const index = new TextEncoder().encode(`IDX synthetic ${request.commitOid}\n`);
  const packChecksum = parseLowerHexSha1(createHash("sha1").update(pack).digest("hex"));
  const stem = `pack-${packChecksum}`;
  const transitions = [];
  for (const [position, [role, bytes, suffix]] of ([
    ["destination_pack", pack, "pack"],
    ["destination_index", index, "idx"],
  ] as const).entries()) {
    const staged = await stage(join(post, String(position)), bytes);
    if (staged === null || staged.state !== "regular_file") throw new Error("unreachable");
    transitions.push(
      validateGitEffectTransition(
        {
          role,
          path: parseCanonicalAbsolutePathText(`${request.destination.gitDirectory}/objects/pack/${stem}.${suffix}`),
          operation: "create",
          before: { state: "absent" },
          after: { state: "regular_file", hash: staged.hash, size: staged.size, mode: staged.mode, semantic: { kind: "none" } },
          evidence: { stagedPostimagePath: parseCanonicalAbsolutePathText(join(post, String(position))), stagedPostimage: staged, beforeTombstonePath: null, afterTombstonePath: null },
        },
        request.effectiveUid,
      ),
    );
  }
  const count = request.candidate.blobs.length + request.candidate.trees.length + (request.candidate.commit === null ? 0 : 1);
  const budget = validateGitPackReaderBudget({
    compressedPackMaxBytes: 2147483648,
    packHeaderObjectCount: count,
    closedEffectObjectCount: count,
    admittedObjectCount: count,
    perObjectInflatedMaxBytes: 536870912,
    aggregateInflatedMaxBytes: 8589934592,
    deltaDepthMax: 50,
    deltaInstructionMax: 10000000,
    deltaWorkMaxBytes: 8589934592,
    residentMemoryMaxBytes: 268435456,
    additionalTempMaxBytes: 10737418240,
    inheritedPushDeadlineMs: 600000,
  });
  return {
    preparation: {
      kind: "pack_received",
      commitOid: request.commitOid,
      processNodes: ["receive-pack", "index-pack"],
      destinationTransitions: transitions,
      packReaderBudget: budget,
      closure: {
        targetOid: request.commitOid,
        packChecksum,
        packSha256: parseLowerHexSha256(sha256(pack)),
        packSize: pack.byteLength,
        indexSha256: parseLowerHexSha256(sha256(index)),
        indexSize: index.byteLength,
        budget,
        closureHash: parseLowerHexSha256(sha256(`${request.commitOid}\n`)),
        inflatedBytes: 0,
        deltaInstructions: 0,
        deltaWorkBytes: 0,
        maximumDeltaDepth: 0,
        peakResidentBytes: 0,
        peakTempBytes: 0,
      },
    },
    planningTranscriptHash: parseLowerHexSha256(sha256(`scripted ${request.commitOid}`)),
  };
}

export function scriptedGitRuntime(): ScriptedGitRuntimeV1 {
  const reader = createProductionGitRuntime();
  const runtime: ScriptedGitRuntimeV1 = {
    spawns: [],
    networkCalls: [],
    drifted: false,
    processTableHash: hashGitProcessTable(SUPPORTED_GIT_DISTRIBUTION.processTable),
    admitDistribution: (transport) => {
      if (runtime.drifted || transport !== "local") return Promise.reject(new SecurityRefusalError("unsupported_git_distribution"));
      return Promise.resolve();
    },
    commitTree: (gitDirectory, commit) => reader.commitTree(gitDirectory, commit),
    commitParents: (gitDirectory, commit) => reader.commitParents(gitDirectory, commit),
    prepareLocalPush: async (request) => {
      runtime.spawns.push(request.commitOid);
      return scriptedLocalPush(request);
    },
  };
  return runtime;
}

/** When `rejectDestination.on`, the destination effect's first journal write refuses: `D` stays unjournaled. */
export function scriptedEffectPorts(
  runtime: ScriptedGitRuntimeV1,
  rejectDestination: { on: boolean },
): (context: CliLifecycleContext) => LifecycleEffectPortsV1 {
  return (context) => {
    const ports = createLifecycleEffectPorts(context, REJECTING_LAUNCHD_HOST);
    const writeExclusive: typeof ports.git.fs.writeExclusive = async (path, bytes) => {
      const id = /^\.(ge_[0-9a-f]{64}_[0-9]+)\.[0-9a-f-]+\.json\.tmp$/u.exec(basename(path))?.[1];
      if (rejectDestination.on && id !== undefined) {
        const plan = JSON.parse(await nodeFs.readFile(join(ports.git.journalRoot, `${id}.plan.json`), "utf8")) as { readonly side?: unknown };
        if (plan.side === "destination") throw new SecurityRefusalError("synthetic_destination_refusal");
      }
      return ports.git.fs.writeExclusive(path, bytes);
    };
    return {
      ...ports,
      gitRuntime: runtime,
      git: { ...ports.git, fs: { ...ports.git.fs, writeExclusive } },
      push: {
        push: (_plan, hash) => {
          runtime.networkCalls.push(hash);
          return Promise.reject(new SecurityRefusalError("unsupported_git_distribution"));
        },
      },
    };
  };
}

/** A synthetic empty bare repository: exactly the layout `git init --bare` leaves, without Git. */
export async function createBareRemote(path: string): Promise<string> {
  for (const directory of [path, join(path, "objects"), join(path, "objects", "pack"), join(path, "objects", "info"), join(path, "refs"), join(path, "refs", "heads")]) {
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o755 });
  }
  await nodeFs.writeFile(join(path, "HEAD"), "ref: refs/heads/main\n", { mode: 0o644 });
  await nodeFs.writeFile(join(path, "config"), "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n", { mode: 0o644 });
  return nodeFs.realpath(path);
}
