/**
 * Spec 1 §4.2's pre-intent local receive. The fixed helper graph pushes into
 * the private `SanitizedBareDestinationShadowV1` (never the real bare
 * destination); this module then proves what that graph produced, stages
 * the self-contained pack/index as destination effect evidence, and runs
 * the guarded pack reader before any coordinator or effect journal exists.
 * The no-pack arm is the exact up-to-date target with zero transitions.
 * Every refusal destroys the private quarantine.
 */
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";

import {
  parseCanonicalAbsolutePathText,
  parseLowerHexSha1,
  parseLowerHexSha256,
  parseUInt64Decimal,
  validateGitEffectTransition,
  type CanonicalAbsolutePathV1,
  type FullBranchRefV1,
  type GitEffectTransitionV1,
  type GitPackReaderBudgetV1,
  type GitRefStateV1,
  type GuardedGitPathStateV1,
  type LowerHexSha1,
  type LowerHexSha256,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import { destroyGitQuarantine, gitPackReaderBudget, GuardedSha1PackReader, type GitPackClosureEvidenceV1 } from "./pack-reader.js";
import { verifySanitizedGitShadow, type SanitizedBareDestinationShadowV1 } from "./shadow.js";
import type { GitProcessPhaseV1 } from "./supervisor.js";
import type { ClosedGitProcessNodeIdV1 } from "./types.js";

/** The destination-side processes a local receive may have run, as plumbing names. */
export type GitLocalReceiveProcessNodeV1 = "receive-pack" | "index-pack";

/** What the composition root's run of the fixed helper graph reports back. */
export interface GitLocalReceiveRunV1 {
  /** Every `destination_receive` node the supervisor admitted, in consumption order. */
  readonly nodes: readonly ClosedGitProcessNodeIdV1[];
  /** The canonical count the one `--pack_header=2,<count>` permit carried; null when no ref-update command ran. */
  readonly packHeaderObjectCount: number | null;
}

export interface GitLocalReceiveRequestV1 {
  /** The private owner-only destination quarantine, `staging/lifecycle/<id>/git/destination/<ge-id>`. */
  readonly quarantineRoot: CanonicalAbsolutePathV1;
  /** Materialized inside `quarantineRoot` with `receive.unpackLimit=0` and an empty hooks directory. */
  readonly destinationShadow: SanitizedBareDestinationShadowV1;
  readonly destination: {
    /** The validated real bare Git directory; only its two exact final pack/index paths are read. */
    readonly gitDirectory: CanonicalAbsolutePathV1;
    readonly branchRef: FullBranchRefV1;
    /** The guarded real target ref, as the plan recorded it. */
    readonly target: GitRefStateV1;
  };
  readonly commitOid: LowerHexSha1;
  /** Objects the planned destination snapshot already owns (see `GitPackReadRequestV1.boundary`). */
  readonly boundary: ReadonlySet<LowerHexSha1>;
  readonly phase: Pick<GitProcessPhaseV1, "remainingMilliseconds">;
  readonly effectiveUid: number;
  /** Runs source push → local helper → shadow receive-pack through the supervisor's fixed graph. */
  readonly receive: () => Promise<GitLocalReceiveRunV1>;
}

export type GitLocalReceivePreparationV1 =
  | {
      readonly kind: "up_to_date";
      readonly commitOid: LowerHexSha1;
      readonly processNodes: readonly ["receive-pack"];
      readonly destinationTransitions: readonly [];
      readonly packReaderBudget: null;
      readonly closure: null;
    }
  | {
      readonly kind: "pack_received";
      readonly commitOid: LowerHexSha1;
      readonly processNodes: readonly ["receive-pack", "index-pack"];
      /** The pack then the index, at transition indexes 0 and 1; reflog and ref follow in the caller's plan. */
      readonly destinationTransitions: readonly GitEffectTransitionV1[];
      readonly packReaderBudget: GitPackReaderBudgetV1;
      readonly closure: GitPackClosureEvidenceV1;
    };

const RECEIVE_NODES: readonly ClosedGitProcessNodeIdV1[] = ["gateway_receive_pack", "real_receive_pack"];
const INDEX_NODES: readonly ClosedGitProcessNodeIdV1[] = [...RECEIVE_NODES, "gateway_index_git", "real_index_git"];
const LOOSE_REF_BYTES = 41;
const READ_CHUNK_BYTES = 64 * 1024;

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function within(path: string, root: string): boolean {
  return path.startsWith(`${root}/`);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await nodeFs.lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function hashRegular(path: string): Promise<{ readonly stats: BigIntStats; readonly sha256: LowerHexSha256 }> {
  const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) refuse("git_receive_final_path_conflicting");
    const hash = createHash("sha256");
    const buffer = new Uint8Array(READ_CHUNK_BYTES);
    let total = 0n;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += BigInt(bytesRead);
      if (total > stats.size) refuse("git_receive_final_path_conflicting");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (total !== stats.size) refuse("git_receive_final_path_conflicting");
    return { stats, sha256: parseLowerHexSha256(hash.digest("hex")) };
  } finally {
    await handle.close();
  }
}

function regularState(stats: BigIntStats, sha256: LowerHexSha256): Extract<GuardedGitPathStateV1, { state: "regular_file" }> {
  return {
    state: "regular_file",
    hash: sha256,
    size: Number(stats.size),
    mode: Number(stats.mode & 0o777n),
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
    semantic: { kind: "none" },
  };
}

async function requireOwnerOnlyDirectory(path: string, effectiveUid: number, reason: string): Promise<void> {
  const stats = await lstatOrNull(path);
  if (stats === null || !stats.isDirectory() || Number(stats.uid) !== effectiveUid || Number(stats.mode & 0o777n) !== 0o700) {
    refuse(reason);
  }
}

/** The shadow's resulting loose ref: exactly one 41-byte `<oid>\n`, no symlink. */
async function readShadowRef(shadow: SanitizedBareDestinationShadowV1, ref: FullBranchRefV1): Promise<LowerHexSha1> {
  let handle: nodeFs.FileHandle;
  try {
    handle = await nodeFs.open(`${shadow.gitDir}/${ref}`, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ELOOP") refuse("git_receive_ref_mismatch");
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.size !== BigInt(LOOSE_REF_BYTES)) refuse("git_receive_ref_mismatch");
    const buffer = new Uint8Array(LOOSE_REF_BYTES + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.byteLength - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > LOOSE_REF_BYTES) refuse("git_receive_ref_mismatch");
    }
    const text = Buffer.from(buffer.subarray(0, length)).toString("latin1");
    if (!/^[0-9a-f]{40}\n$/u.test(text)) refuse("git_receive_ref_mismatch");
    return parseLowerHexSha1(text.slice(0, 40));
  } finally {
    await handle.close();
  }
}

/**
 * `receive.unpackLimit=0` sends every object to one kept pack: the object
 * directory holds only `info` (empty) and `pack`, and the pack directory
 * holds nothing (no ref command) or exactly one `pack-<hex>` pack and
 * index, plus the keep marker receive-pack may not have released yet and
 * the reverse index Git 2.41+ writes by default.
 */
async function shadowPackFiles(shadow: SanitizedBareDestinationShadowV1, effectiveUid: number): Promise<string | null> {
  const objects = (await nodeFs.readdir(shadow.objectDirectory)).sort();
  if (!sameList(objects, ["info", "pack"])) refuse("git_receive_unexpected_object_file");
  if ((await nodeFs.readdir(`${shadow.objectDirectory}/info`)).length !== 0) refuse("git_receive_unexpected_object_file");
  const names = (await nodeFs.readdir(`${shadow.objectDirectory}/pack`)).sort();
  if (names.length === 0) return null;
  const match = /^pack-([0-9a-f]{40})\.pack$/u.exec(names.find((name) => name.endsWith(".pack")) ?? "");
  if (match === null) refuse("git_receive_unexpected_pack_file");
  const stem = `pack-${match[1] as string}`;
  const allowed = new Set([`${stem}.idx`, `${stem}.keep`, `${stem}.pack`, `${stem}.rev`]);
  if (!names.includes(`${stem}.idx`) || names.some((name) => !allowed.has(name))) refuse("git_receive_unexpected_pack_file");
  for (const name of names) {
    const stats = await nodeFs.lstat(`${shadow.objectDirectory}/pack/${name}`, { bigint: true });
    if (!stats.isFile() || Number(stats.uid) !== effectiveUid || stats.nlink !== 1n) refuse("git_receive_unexpected_pack_file");
  }
  return match[1] as string;
}

/**
 * An exact final path is `absent` (create), a byte-identical regular file
 * (ownership-neutral reuse), or conflicting: wrong type, a symlink, or any
 * differing byte refuses.
 */
async function classifyFinal(
  role: "destination_pack" | "destination_index",
  path: CanonicalAbsolutePathV1,
  staged: CanonicalAbsolutePathV1,
  stagedState: Extract<GuardedGitPathStateV1, { state: "regular_file" }>,
  effectiveUid: number,
): Promise<GitEffectTransitionV1> {
  const after = { state: "regular_file", hash: stagedState.hash, size: stagedState.size, mode: stagedState.mode, semantic: { kind: "none" } } as const;
  const existing = await lstatOrNull(path);
  if (existing === null) {
    return validateGitEffectTransition(
      {
        role,
        path,
        operation: "create",
        before: { state: "absent" },
        after,
        evidence: { stagedPostimagePath: staged, stagedPostimage: stagedState, beforeTombstonePath: null, afterTombstonePath: null },
      },
      effectiveUid,
    );
  }
  if (!existing.isFile()) refuse("git_receive_final_path_conflicting");
  const { stats, sha256 } = await hashRegular(path);
  if (sha256 !== stagedState.hash || Number(stats.size) !== stagedState.size || stats.ino !== existing.ino) {
    refuse("git_receive_final_path_conflicting");
  }
  await nodeFs.unlink(staged);
  return validateGitEffectTransition(
    {
      role,
      path,
      operation: "reuse",
      before: regularState(stats, sha256),
      after: { ...after, mode: Number(stats.mode & 0o777n) },
      evidence: { stagedPostimagePath: null, stagedPostimage: null, beforeTombstonePath: null, afterTombstonePath: null },
    },
    effectiveUid,
  );
}

async function prepare(request: GitLocalReceiveRequestV1, reader: GuardedSha1PackReader): Promise<GitLocalReceivePreparationV1> {
  const { quarantineRoot, destinationShadow: shadow, destination, commitOid, effectiveUid } = request;
  await requireOwnerOnlyDirectory(quarantineRoot, effectiveUid, "git_quarantine_changed");
  if (!within(shadow.gitDir, quarantineRoot)) refuse("git_local_shadow_mismatch");
  if (shadow.configProjection.receive?.unpackLimit !== 0) refuse("git_shadow_config_changed");
  await verifySanitizedGitShadow(shadow, effectiveUid);
  if ((await shadowPackFiles(shadow, effectiveUid)) !== null) refuse("git_receive_unexpected_pack_file");

  const run = await request.receive();

  // A hook, proc-receive or maintenance setting planted during the run changes the verified shadow.
  await verifySanitizedGitShadow(shadow, effectiveUid);
  if (request.phase.remainingMilliseconds() <= 0) refuse("git_pack_deadline");
  const packed = run.packHeaderObjectCount !== null;
  if (!sameList(run.nodes, packed ? INDEX_NODES : RECEIVE_NODES)) refuse("git_receive_unexpected_process");
  if ((await readShadowRef(shadow, destination.branchRef)) !== commitOid) refuse("git_receive_ref_mismatch");
  const stem = await shadowPackFiles(shadow, effectiveUid);
  const target = destination.target;

  if (!packed) {
    if (stem !== null) refuse("git_receive_unexpected_pack_file");
    if (target.state !== "present" || target.oid !== commitOid) refuse("git_receive_contradictory");
    return { kind: "up_to_date", commitOid, processNodes: ["receive-pack"], destinationTransitions: [], packReaderBudget: null, closure: null };
  }
  if (stem === null) refuse("git_receive_contradictory");
  if (target.state === "present" && target.oid === commitOid) refuse("git_receive_contradictory");

  const budget = gitPackReaderBudget(run.packHeaderObjectCount);
  const post = `${quarantineRoot}/post`;
  await nodeFs.mkdir(post, { mode: 0o700 });
  const stagedPack = parseCanonicalAbsolutePathText(`${post}/0`);
  const stagedIndex = parseCanonicalAbsolutePathText(`${post}/1`);
  await nodeFs.rename(`${shadow.objectDirectory}/pack/${stem}.pack`, stagedPack);
  await nodeFs.rename(`${shadow.objectDirectory}/pack/${stem}.idx`, stagedIndex);

  const closure = await reader.validate(
    {
      packPath: stagedPack,
      indexPath: stagedIndex,
      quarantineRoot,
      targetOid: commitOid,
      boundary: request.boundary,
      phase: request.phase,
      effectiveUid,
    },
    budget,
  );
  if (`pack-${closure.packChecksum}` !== stem) refuse("git_receive_pack_name_mismatch");

  const packStats = await nodeFs.lstat(stagedPack, { bigint: true });
  const indexStats = await nodeFs.lstat(stagedIndex, { bigint: true });
  if (Number(packStats.size) !== closure.packSize || Number(indexStats.size) !== closure.indexSize) refuse("git_pack_file_changed");
  const finalDirectory = `${destination.gitDirectory}/objects/pack`;
  const transitions = [
    await classifyFinal(
      "destination_pack",
      parseCanonicalAbsolutePathText(`${finalDirectory}/${stem}.pack`),
      stagedPack,
      regularState(packStats, closure.packSha256),
      effectiveUid,
    ),
    await classifyFinal(
      "destination_index",
      parseCanonicalAbsolutePathText(`${finalDirectory}/${stem}.idx`),
      stagedIndex,
      regularState(indexStats, closure.indexSha256),
      effectiveUid,
    ),
  ];
  if ((await nodeFs.readdir(post)).length === 0) await nodeFs.rmdir(post);
  return {
    kind: "pack_received",
    commitOid,
    processNodes: ["receive-pack", "index-pack"],
    destinationTransitions: transitions,
    packReaderBudget: budget,
    closure,
  };
}

/**
 * Pre-intent only: nothing here writes a journal or touches the real
 * destination beyond reading its two exact final paths.
 */
export async function prepareLocalReceive(
  request: GitLocalReceiveRequestV1,
  reader: GuardedSha1PackReader = new GuardedSha1PackReader(),
): Promise<GitLocalReceivePreparationV1> {
  try {
    return await prepare(request, reader);
  } catch (error) {
    await destroyGitQuarantine(request.quarantineRoot, request.effectiveUid);
    throw error;
  }
}
