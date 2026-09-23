import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  admitTargetUpdateDraft,
  decodePlannerJson,
  PLANNER_PROTOCOL_V1,
  PLANNER_WIRE_BOUNDS_V1,
  PlannerBlobSetHasher,
  plannerInputBlobRefs,
  plannerJsonBytes,
  plannerJsonHash,
  PlannerWireDecoder,
  PlannerWireEncoder,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type {
  LowerHexSha256,
  PlannerOutputBlobExpectationV1,
  PlannerTranscriptIdentityV1,
  PlannerWireBoundsV1,
  SecretScreenedBlobV1,
  TargetUpdateDraftV1,
  UpdatePlannerRequestV1,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import { assertSafeCommand } from "../process.js";
import type { Redactor } from "../redaction.js";

export type { PlannerTranscriptIdentityV1, PlannerWireBoundsV1 } from "@developer-os/core";

/** The only launch shape: the pinned runtime, the planner entrypoint, an empty cwd, no environment. */
export interface PlannerSpawnRequestV1 {
  readonly executable: string;
  readonly args: readonly [string];
  readonly cwd: string;
  readonly env: Readonly<Record<string, never>>;
}

export interface PlannerChildProcessV1 {
  readonly pid: number | undefined;
  /** Resolves once the pipe accepted the chunk, so a slow reader backpressures the writer. */
  write(chunk: Uint8Array): Promise<void>;
  endInput(): Promise<void>;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  /** Settles only once the child is reaped. */
  readonly exited: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>;
  /** Kills the child's whole process group. */
  kill(): void;
}

export interface PlannerProcessSampleV1 {
  readonly residentBytes: number;
  readonly descendants: number;
}

export interface TargetPlannerSupervisorDependencies {
  readonly spawn: (request: PlannerSpawnRequestV1) => PlannerChildProcessV1;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  /** Returns a cancel function. */
  readonly setTimer: (callback: () => void, milliseconds: number) => () => void;
  /** `null` when the process is already gone. */
  readonly sample: (pid: number) => Promise<PlannerProcessSampleV1 | null>;
  /** The user-bound redactor; any finding is a secret-screen refusal. */
  readonly redactor: Redactor;
  readonly sampleIntervalMilliseconds?: number;
}

export interface TargetPlannerRunRequestV1 {
  /** The verified target bundle's pinned runtime executable. */
  readonly runtime: string;
  /** The verified target bundle's planner entrypoint. */
  readonly planner: string;
  /** An empty guarded directory. */
  readonly cwd: string;
  readonly request: UpdatePlannerRequestV1;
  readonly inputBlobs: readonly Uint8Array[];
  /** What is left of the enclosing attempt's wall budget; the planner never extends it. */
  readonly remainingMilliseconds: number;
}

export interface TargetPlannerRunResultV1 {
  readonly draft: TargetUpdateDraftV1;
  readonly outputBlobs: readonly SecretScreenedBlobV1[];
  readonly transcript: PlannerTranscriptIdentityV1;
}

const SAMPLE_INTERVAL_MILLISECONDS = 1_000;
const textDecoder = new TextDecoder("utf-8", { fatal: false });

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

/**
 * Spec 2 §8.2: every request/result frame and blob is screened before it is hashed, sent, or
 * accepted. The diagnostic is fixed; neither the bytes nor the finding reach it.
 */
export function screenPlannerFrame(redactor: Redactor, bytes: Uint8Array): void {
  if (redactor(textDecoder.decode(bytes)).findings.length > 0) refuse("Planner frame failed the secret screen");
}

interface Supervision {
  failure: Error | null;
  readonly fail: (error: unknown) => void;
  readonly progress: () => void;
}

/**
 * Runs exactly one target planner process under Spec 2 §8.2's fixed ceilings. The first byte,
 * frame, count, time, stderr, RSS, or descendant overflow kills its process group, waits for
 * the reap, and refuses; nothing is ever truncated and accepted. Raw stderr is counted and
 * dropped.
 */
export class TargetPlannerSupervisor {
  readonly #bounds: PlannerWireBoundsV1 = PLANNER_WIRE_BOUNDS_V1;

  constructor(readonly dependencies: TargetPlannerSupervisorDependencies) {}

  async run(run: TargetPlannerRunRequestV1): Promise<TargetPlannerRunResultV1> {
    const request = validateUpdatePlannerRequest(run.request);
    if (request.protocol !== PLANNER_PROTOCOL_V1 || request.targetRelease.updateProtocol > PLANNER_PROTOCOL_V1) {
      refuse("Target planner protocol is newer than this release supports; upgrade the launcher first");
    }
    for (const path of [run.runtime, run.planner, run.cwd]) if (!isAbsolute(path)) refuse("Planner paths must be absolute");
    if (!Number.isSafeInteger(run.remainingMilliseconds) || run.remainingMilliseconds < 1) refuse("Planner attempt budget is exhausted");

    const { redactor } = this.dependencies;
    const requestJson = plannerJsonBytes(request);
    if (requestJson.byteLength > this.#bounds.requestJsonBytes) refuse("Planner request exceeds its bound");
    screenPlannerFrame(redactor, requestJson);
    const refs = plannerInputBlobRefs(request);
    if (refs.length !== run.inputBlobs.length) refuse("Planner input blobs differ from the request");
    const inputHasher = new PlannerBlobSetHasher("input", refs.length);
    run.inputBlobs.forEach((blob, ordinal) => {
      screenPlannerFrame(redactor, blob);
      const hash = sha256(blob);
      const ref = refs[ordinal];
      if (ref === undefined || ref.bytes !== blob.byteLength || ref.sha256 !== hash) refuse("Planner input blob differs from its reference");
      inputHasher.add(ordinal, blob, hash);
    });
    const requestHash = plannerJsonHash("input", requestJson);
    const inputBlobsHash = inputHasher.digest();

    const child = this.dependencies.spawn({ executable: run.runtime, args: [run.planner], cwd: run.cwd, env: {} });
    const output = await this.#supervise(child, requestJson, run, request);
    return {
      draft: output.draft,
      outputBlobs: output.blobs,
      transcript: { protocol: request.protocol, bounds: this.#bounds, requestHash, inputBlobsHash, resultHash: output.resultHash, outputBlobsHash: output.outputBlobsHash },
    };
  }

  async #supervise(
    child: PlannerChildProcessV1,
    requestJson: Uint8Array,
    run: TargetPlannerRunRequestV1,
    request: UpdatePlannerRequestV1,
  ): Promise<{ readonly draft: TargetUpdateDraftV1; readonly blobs: SecretScreenedBlobV1[]; readonly resultHash: LowerHexSha256; readonly outputBlobsHash: LowerHexSha256 }> {
    const { setTimer, now } = this.dependencies;
    const deadline = now() + Math.min(this.#bounds.wallMilliseconds, run.remainingMilliseconds);
    let cancelIdle: () => void = () => undefined;
    let cancelWall: () => void = () => undefined;
    let cancelSample: () => void = () => undefined;
    let running = true;
    const supervision: Supervision = {
      failure: null,
      fail: (error) => {
        if (supervision.failure !== null) return;
        supervision.failure = error instanceof SecurityRefusalError ? error : new SecurityRefusalError("Planner output failed validation");
        child.kill();
      },
      progress: () => {
        cancelIdle();
        cancelIdle = setTimer(() => {
          supervision.fail(new SecurityRefusalError("Planner exceeded its idle deadline"));
        }, this.#bounds.idleMilliseconds);
      },
    };
    cancelWall = setTimer(() => {
      supervision.fail(new SecurityRefusalError("Planner exceeded its wall deadline"));
    }, Math.max(0, deadline - now()));
    supervision.progress();
    const sample = (): void => {
      cancelSample = setTimer(() => {
        if (!running || child.pid === undefined) return;
        this.dependencies.sample(child.pid).then((observed) => {
          if (observed === null || !running) return;
          if (observed.descendants > 0) supervision.fail(new SecurityRefusalError("Planner started another process"));
          else if (observed.residentBytes > this.#bounds.residentBytes) supervision.fail(new SecurityRefusalError("Planner exceeded its resident memory bound"));
          else sample();
        }, (error: unknown) => {
          supervision.fail(error);
        });
      }, this.dependencies.sampleIntervalMilliseconds ?? SAMPLE_INTERVAL_MILLISECONDS);
    };
    sample();

    // The first failing task kills the group at once, which ends the other two.
    const guard = <T>(task: Promise<T>): Promise<T | null> =>
      task.catch((error: unknown) => {
        supervision.fail(error);
        return null;
      });
    let result: Awaited<ReturnType<typeof readOutput>> | null = null;
    try {
      [, result] = await Promise.all([
        guard(writeInput(child, requestJson, run.inputBlobs, supervision)),
        guard(readOutput(child, request, this.#bounds, this.dependencies.redactor, supervision)),
        guard(drainStderr(child, this.#bounds, supervision)),
      ]);
      const exit = await child.exited;
      if (supervision.failure === null && (exit.exitCode !== 0 || exit.signal !== null)) supervision.fail(new SecurityRefusalError("Planner exited unsuccessfully"));
    } finally {
      running = false;
      cancelIdle();
      cancelWall();
      cancelSample();
    }
    if (supervision.failure !== null) {
      await child.exited;
      throw supervision.failure;
    }
    if (result === null) refuse("Planner produced no result");
    return result;
  }
}

async function writeInput(child: PlannerChildProcessV1, requestJson: Uint8Array, blobs: readonly Uint8Array[], supervision: Supervision): Promise<void> {
  const wire = new PlannerWireEncoder("input");
  const write = async (chunk: Uint8Array): Promise<void> => {
    if (supervision.failure !== null) return;
    await child.write(chunk);
    supervision.progress();
  };
  try {
    await write(wire.magic());
    await write(wire.json(requestJson));
    await write(requestJson);
    for (const blob of blobs) {
      await write(wire.blob(blob));
      await write(blob);
    }
    await write(wire.end());
    if (supervision.failure === null) await child.endInput();
  } catch {
    // A pipe torn down by our own kill is the consequence of the recorded failure, not a second one.
    if (supervision.failure === null) refuse("Planner closed its input early");
  }
}

async function readOutput(
  child: PlannerChildProcessV1,
  request: UpdatePlannerRequestV1,
  bounds: PlannerWireBoundsV1,
  redactor: Redactor,
  supervision: Supervision,
): Promise<{ readonly draft: TargetUpdateDraftV1; readonly blobs: SecretScreenedBlobV1[]; readonly resultHash: LowerHexSha256; readonly outputBlobsHash: LowerHexSha256 }> {
  const wire = new PlannerWireDecoder("output", bounds);
  let admitted: { readonly draft: TargetUpdateDraftV1; readonly outputBlobs: readonly PlannerOutputBlobExpectationV1[] } | null = null;
  let resultHash: LowerHexSha256 | null = null;
  let hasher: PlannerBlobSetHasher | null = null;
  let outputBlobsHash: LowerHexSha256 | null = null;
  const blobs: SecretScreenedBlobV1[] = [];
  for await (const chunk of child.stdout) {
    if (supervision.failure !== null) break;
    supervision.progress();
    for (const frame of wire.push(chunk)) {
      if (frame.kind === "json") {
        screenPlannerFrame(redactor, frame.payload);
        admitted = admitTargetUpdateDraft(decodePlannerJson(frame.payload, bounds.resultJsonBytes), request);
        resultHash = plannerJsonHash("output", frame.payload);
        hasher = new PlannerBlobSetHasher("output", admitted.outputBlobs.length);
      } else if (frame.kind === "blob") {
        const expected = admitted?.outputBlobs[frame.ordinal];
        if (expected === undefined || hasher === null || expected.bytes !== frame.payload.byteLength) refuse("Planner output blob differs from its reference");
        screenPlannerFrame(redactor, frame.payload);
        const hash = sha256(frame.payload);
        hasher.add(frame.ordinal, frame.payload, hash);
        blobs.push({ ordinal: frame.ordinal, bytes: frame.payload.byteLength, sha256: hash, content: frame.payload } as SecretScreenedBlobV1);
      } else {
        if (hasher === null) refuse("Planner output ended before its result");
        outputBlobsHash = hasher.digest();
      }
    }
  }
  if (supervision.failure !== null) throw supervision.failure;
  wire.finish();
  if (admitted === null || resultHash === null || outputBlobsHash === null) refuse("Planner output is incomplete");
  return { draft: admitted.draft, blobs, resultHash, outputBlobsHash };
}

async function drainStderr(child: PlannerChildProcessV1, bounds: PlannerWireBoundsV1, supervision: Supervision): Promise<void> {
  let bytes = 0;
  for await (const chunk of child.stderr) {
    bytes += chunk.byteLength;
    if (bytes > bounds.stderrBytes) refuse("Planner stderr exceeded its bound");
    supervision.progress();
  }
}

/**
 * The production child: no shell, an empty environment, exactly three pipes, and its own
 * process group so a kill reaches anything it started before the sampler saw it.
 */
export function spawnNodePlannerChild(request: PlannerSpawnRequestV1): PlannerChildProcessV1 {
  assertSafeCommand({ executable: request.executable, args: request.args, cwd: request.cwd, stdin: "", timeoutMs: 0, env: {} });
  const child = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    env: {},
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => undefined);
  const exited = new Promise<{ readonly exitCode: number | null; readonly signal: string | null }>((resolveExit) => {
    child.once("close", (exitCode, signal) => {
      resolveExit({ exitCode, signal });
    });
    child.once("error", () => {
      resolveExit({ exitCode: null, signal: null });
    });
  });
  return {
    pid: child.pid,
    write: (chunk) =>
      new Promise((resolveWrite, rejectWrite) => {
        child.stdin.write(chunk, (error) => {
          if (error === null || error === undefined) resolveWrite();
          else rejectWrite(error);
        });
      }),
    endInput: () =>
      new Promise((resolveEnd) => {
        child.stdin.end(() => {
          resolveEnd();
        });
      }),
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill: () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // The group is already gone; fall through to the direct handle.
        }
      }
      child.kill("SIGKILL");
    },
  };
}

/**
 * The production sampler: one `ps` snapshot, the planner's resident bytes plus its descendant
 * count. ponytail: polled, so a descendant or RSS spike shorter than the interval is missed;
 * the capability graph gate is the primary control, and a kernel-event source would close it.
 */
export function sampleNodePlannerProcess(pid: number): Promise<PlannerProcessSampleV1 | null> {
  return new Promise((resolveSample) => {
    execFile("/bin/ps", ["-A", "-o", "pid=,ppid=,rss="], { env: {}, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) {
        resolveSample(null);
        return;
      }
      const rows = stdout.split("\n").map((line) => line.trim().split(/\s+/u).map(Number)).filter((row) => row.length === 3 && row.every(Number.isSafeInteger));
      const own = rows.find((row) => row[0] === pid);
      if (own === undefined) {
        resolveSample(null);
        return;
      }
      const tree = new Set([pid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [child, parent] of rows) {
          if (parent !== undefined && child !== undefined && tree.has(parent) && !tree.has(child)) {
            tree.add(child);
            grew = true;
          }
        }
      }
      resolveSample({ residentBytes: (own[2] ?? 0) * 1024, descendants: tree.size - 1 });
    });
  });
}
