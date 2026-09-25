import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { LowerHexSha256 } from "@developer-os/core";

import { SecurityRefusalError } from "./paths.js";
import { assertSafeCommand } from "./process.js";

/** One absolute deadline shared by every child of a top-level phase; no child can reset it. */
export interface SupervisedPhaseV1 {
  readonly id: string;
  readonly deadlineAtMs: number;
  remainingMilliseconds(): number;
}

export interface SupervisedSpawnRequestV1 {
  /** Absolute; never resolved through `PATH` or a shell. */
  readonly executable: string;
  /** Literal, already expanded. */
  readonly argv: readonly string[];
  /** Exact; nothing is inherited from the parent environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** A stream is piped as it arrives, for the one bidirectional protocol child (receive-pack). */
  readonly stdin: "ignore" | { readonly bytes: Uint8Array } | { readonly stream: AsyncIterable<Uint8Array> };
  /** Empty except for the launchd bootstrap's FD 3 plist snapshot. */
  readonly inheritedFds: readonly { readonly childFd: 3; readonly parentFd: number }[];
  readonly stdoutCap: number;
  readonly stderrCap: number;
  readonly idleMs: number;
  readonly wallMs: number;
  readonly terminationGraceMs: number;
  readonly phase: SupervisedPhaseV1;
}

export type SupervisedTerminationV1 = "exited" | "idle_deadline" | "wall_deadline" | "phase_deadline" | "output_cap";

export interface SupervisedProcessEvidenceV1 {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutSha256: LowerHexSha256;
  readonly stderrSha256: LowerHexSha256;
  readonly termination: SupervisedTerminationV1;
  readonly groupReaped: true;
}

/** What the runner hands the spawn dependency: the request plus the exact descriptor table it derived. */
export interface SupervisedChildSpawnV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdio: readonly ["ignore" | "pipe", "pipe", "pipe", ...number[]];
  /** Written once and closed when `stdio[0]` is `"pipe"` and no stream is given. */
  readonly stdinBytes: Uint8Array | null;
  readonly stdinStream: AsyncIterable<Uint8Array> | null;
}

export interface SupervisedChildHandleV1 {
  /** `undefined` when the executable never started. */
  readonly pid: number | undefined;
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  /** Settles once the child is reaped and its pipes are closed, or when it failed to start. */
  readonly closed: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>;
  /** Closes the counted output pipes without waiting for the child. */
  closeOutput(): void;
}

export interface SupervisedProcessDependenciesV1 {
  spawn(request: SupervisedChildSpawnV1): SupervisedChildHandleV1;
  killGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  /** Monotonic milliseconds. */
  now(): number;
  /** Returns a cancel function. */
  setTimer(ms: number, fire: () => void): () => void;
}

type OutputSink = (chunk: Uint8Array, stream: "stdout" | "stderr") => void;

function refuse(message: string): never {
  throw new SecurityRefusalError(message);
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRequest(request: SupervisedSpawnRequestV1): void {
  assertSafeCommand({ executable: request.executable, args: request.argv, cwd: request.cwd, stdin: "", timeoutMs: request.wallMs, env: request.env });
  if (!isAbsolute(request.cwd)) refuse("Supervised process working directory must be absolute");
  for (const [name, value] of Object.entries(request.env)) {
    if (name === "" || name.includes("=") || name.includes("\0") || value.includes("\0")) refuse("Supervised process environment is malformed");
  }
  if (request.stdin !== "ignore" && !("stream" in request.stdin) && !(request.stdin.bytes instanceof Uint8Array)) {
    refuse("Supervised process stdin must be bytes");
  }
  const fds = request.inheritedFds;
  if (fds.length > 1) refuse("Supervised process may inherit only FD 3");
  const fd = fds[0];
  if (fd !== undefined && ((fd.childFd as number) !== 3 || !Number.isSafeInteger(fd.parentFd) || fd.parentFd < 0)) {
    refuse("Supervised process may inherit only FD 3");
  }
  if (!Number.isSafeInteger(request.stdoutCap) || request.stdoutCap < 0 || !Number.isSafeInteger(request.stderrCap) || request.stderrCap < 0) {
    refuse("Supervised process output caps must be non-negative integers");
  }
  if (!isPositiveInteger(request.idleMs) || !isPositiveInteger(request.wallMs) || !isPositiveInteger(request.terminationGraceMs)) {
    refuse("Supervised process deadlines must be positive integers");
  }
}

/**
 * Spec §4.4/§5.3's process supervision: no shell, an exact environment, counted and hashed
 * stdout/stderr, and a fresh process group. Crossing a stream cap, the idle deadline, the
 * per-process wall deadline, or the inherited phase deadline closes the pipes, sends SIGTERM to
 * the whole group, waits the termination grace, sends SIGKILL to the group, and resolves only
 * after the child is reaped. Over-cap bytes are never hashed or handed to the sink.
 */
export class SupervisedProcessRunner {
  readonly #dependencies: SupervisedProcessDependenciesV1;

  constructor(dependencies: SupervisedProcessDependenciesV1) {
    this.#dependencies = dependencies;
  }

  beginPhase(id: string, wallMs: number): SupervisedPhaseV1 {
    if (id === "") refuse("Supervised phase needs an id");
    if (!isPositiveInteger(wallMs)) refuse("Supervised phase deadline must be a positive integer");
    const dependencies = this.#dependencies;
    const deadlineAtMs = dependencies.now() + wallMs;
    return Object.freeze({ id, deadlineAtMs, remainingMilliseconds: () => Math.max(0, deadlineAtMs - dependencies.now()) });
  }

  async run(request: SupervisedSpawnRequestV1, sink?: OutputSink): Promise<SupervisedProcessEvidenceV1> {
    validateRequest(request);
    const dependencies = this.#dependencies;
    const now = (): number => dependencies.now();
    const setTimer = (ms: number, fire: () => void): (() => void) => dependencies.setTimer(ms, fire);
    const killGroup = (pid: number, signal: "SIGTERM" | "SIGKILL"): void => {
      dependencies.killGroup(pid, signal);
    };
    if (request.phase.remainingMilliseconds() <= 0) refuse("Supervised phase deadline has passed");

    const child = dependencies.spawn({
      executable: request.executable,
      argv: [...request.argv],
      env: { ...request.env },
      cwd: request.cwd,
      stdio: [request.stdin === "ignore" ? "ignore" : "pipe", "pipe", "pipe", ...request.inheritedFds.map((fd) => fd.parentFd)],
      stdinBytes: request.stdin === "ignore" || "stream" in request.stdin ? null : request.stdin.bytes,
      stdinStream: request.stdin !== "ignore" && "stream" in request.stdin ? request.stdin.stream : null,
    });
    const { pid } = child;
    if (pid === undefined) {
      await child.closed;
      refuse("Supervised process failed to start");
    }

    // An object, not `let`s: TypeScript does not see closure assignments and would narrow them to `null`.
    const state: { stopped: SupervisedTerminationV1 | "sink_failed" | "stream_failed" | null; sinkError: unknown } = { stopped: null, sinkError: null };
    let settled = false;
    let escalation: Promise<void> = Promise.resolve();
    let cancelIdle: () => void = () => undefined;
    let cancelDeadline: () => void = () => undefined;

    const stop = (reason: NonNullable<typeof state.stopped>): void => {
      if (settled || state.stopped !== null) return;
      state.stopped = reason;
      cancelIdle();
      cancelDeadline();
      child.closeOutput();
      killGroup(pid, "SIGTERM");
      escalation = new Promise((resolveEscalation) => {
        setTimer(request.terminationGraceMs, () => {
          killGroup(pid, "SIGKILL");
          resolveEscalation();
        });
      });
    };
    const progress = (): void => {
      cancelIdle();
      cancelIdle = setTimer(request.idleMs, () => {
        stop("idle_deadline");
      });
    };

    const wallAt = now() + request.wallMs;
    const phaseAt = request.phase.deadlineAtMs;
    const deadlineClass = phaseAt <= wallAt ? "phase_deadline" : "wall_deadline";
    cancelDeadline = setTimer(Math.max(0, Math.min(wallAt, phaseAt) - now()), () => {
      stop(deadlineClass);
    });
    progress();

    const pump = async (stream: "stdout" | "stderr", source: AsyncIterable<Uint8Array>, cap: number): Promise<{ bytes: number; sha256: LowerHexSha256 }> => {
      const hash = createHash("sha256");
      let bytes = 0;
      try {
        for await (const chunk of source) {
          if (state.stopped !== null) continue;
          if (bytes + chunk.byteLength > cap) {
            stop("output_cap");
            continue;
          }
          bytes += chunk.byteLength;
          hash.update(chunk);
          progress();
          try {
            sink?.(chunk, stream);
          } catch (error) {
            state.sinkError = error;
            stop("sink_failed");
          }
        }
      } catch {
        // Closing the pipes during a termination ends the iteration early; `stop` is then a no-op.
        stop("stream_failed");
      }
      return { bytes, sha256: hash.digest("hex") as LowerHexSha256 };
    };

    try {
      const [stdout, stderr] = await Promise.all([pump("stdout", child.stdout, request.stdoutCap), pump("stderr", child.stderr, request.stderrCap)]);
      const exit = await child.closed;
      settled = true;
      await escalation;
      const termination = state.stopped ?? "exited";
      if (termination === "sink_failed") throw state.sinkError;
      if (termination === "stream_failed") refuse("Supervised process output stream failed");
      return {
        exitCode: exit.exitCode,
        signal: exit.signal,
        stdoutBytes: stdout.bytes,
        stderrBytes: stderr.bytes,
        stdoutSha256: stdout.sha256,
        stderrSha256: stderr.sha256,
        termination,
        groupReaped: true,
      };
    } finally {
      settled = true;
      cancelIdle();
      cancelDeadline();
    }
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/** The production dependencies: `shell: false`, `detached: true` so the child leads its own group. */
export const nodeSupervisedProcessDependencies: SupervisedProcessDependenciesV1 = Object.freeze({
  spawn(request: SupervisedChildSpawnV1): SupervisedChildHandleV1 {
    const child = spawn(request.executable, [...request.argv], {
      cwd: request.cwd,
      env: { ...request.env },
      shell: false,
      detached: true,
      stdio: [...request.stdio],
    });
    const stdout = child.stdout as Readable;
    const stderr = child.stderr as Readable;
    const closed = new Promise<{ readonly exitCode: number | null; readonly signal: string | null }>((resolveClose) => {
      child.once("close", (exitCode, signal) => {
        resolveClose({ exitCode, signal });
      });
      child.once("error", () => {
        if (child.pid === undefined) resolveClose({ exitCode: null, signal: null });
      });
    });
    if (child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      if (request.stdinStream === null) child.stdin.end(request.stdinBytes ?? new Uint8Array());
      // A closed or killed child ends the pipe; the runner's own evidence reports why.
      else pipeline(Readable.from(request.stdinStream), child.stdin).catch(() => undefined);
    }
    return {
      pid: child.pid,
      stdout,
      stderr,
      closed,
      closeOutput: () => {
        stdout.destroy();
        stderr.destroy();
      },
    };
  },
  killGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!isNoSuchProcessError(error)) throw error;
    }
  },
  now: () => performance.now(),
  setTimer(ms: number, fire: () => void): () => void {
    const timer = setTimeout(fire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
});
