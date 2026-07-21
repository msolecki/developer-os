import { spawn } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import type { RedactionResult } from "./redaction.js";
import { SecurityRefusalError } from "./paths.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;

export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export interface CommandPolicy {
  assertCommand(request: ProcessRequest): void;
  redact(text: string): RedactionResult;
}

function containsNul(value: string): boolean {
  return value.includes("\0");
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

export function assertSafeCommand(request: ProcessRequest): void {
  if (
    containsNul(request.executable) ||
    !isAbsolute(request.executable)
  ) {
    throw new SecurityRefusalError(
      "Process executable must be an absolute path without NUL bytes",
    );
  }
  if (
    containsNul(request.cwd) ||
    request.args.some(containsNul) ||
    containsNul(request.stdin)
  ) {
    throw new SecurityRefusalError("Process request contains a NUL byte");
  }
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0) {
    throw new SecurityRefusalError("Process timeout must be a finite duration");
  }

  const executableName = basename(request.executable).toLowerCase();
  if (executableName !== "curl" && executableName !== "wget") {
    return;
  }

  const normalizedCommand = request.args.join(" ").replace(/[\r\n]+/gu, " ");
  if (/\|\s*(?:ba|z)?sh(?:\s|$)/iu.test(normalizedCommand)) {
    throw new SecurityRefusalError("Pipe-to-shell command is not allowed");
  }
}

export class NodeProcessRunner implements ProcessRunner {
  readonly #policy: CommandPolicy;

  constructor(policy: CommandPolicy) {
    this.#policy = policy;
  }

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.#policy.assertCommand(request);

    const child = spawn(request.executable, [...request.args], {
      shell: false,
      cwd: request.cwd,
      detached: process.platform === "darwin",
      env: { ...request.env },
      stdio: "pipe",
    });

    return new Promise<ProcessResult>((resolveResult, rejectResult) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let settled = false;
      let timeoutEscalationComplete = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let closeInformation:
        | {
            readonly exitCode: number | null;
            readonly signal: NodeJS.Signals | null;
          }
        | undefined;

      const signalProcessTree = (signal: NodeJS.Signals): void => {
        if (process.platform === "darwin" && child.pid !== undefined) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch (error) {
            if (isNoSuchProcessError(error)) {
              return;
            }
          }
        }

        try {
          child.kill(signal);
        } catch {
          return;
        }
      };

      const clearTimers = (): void => {
        clearTimeout(timeout);
        if (forceKillTimer !== undefined) {
          clearTimeout(forceKillTimer);
        }
      };

      const finishFromClose = (): void => {
        const completedProcess = closeInformation;
        if (
          settled ||
          completedProcess === undefined ||
          (timedOut && !timeoutEscalationComplete)
        ) {
          return;
        }

        settled = true;
        clearTimers();
        try {
          const stdout = this.#policy.redact(
            Buffer.concat(stdoutChunks).toString("utf8"),
          ).text;
          const stderr = this.#policy.redact(
            Buffer.concat(stderrChunks).toString("utf8"),
          ).text;
          resolveResult({
            stdout,
            stderr,
            exitCode: completedProcess.exitCode,
            signal: completedProcess.signal,
            timedOut,
          });
        } catch {
          rejectResult(new Error("Process output redaction failed"));
        }
      };

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        signalProcessTree("SIGTERM");
        forceKillTimer = setTimeout(() => {
          signalProcessTree("SIGKILL");
          timeoutEscalationComplete = true;
          finishFromClose();
        }, 100);
      }, request.timeoutMs);

      const rejectCaptureOverflow = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        stdoutChunks.length = 0;
        stderrChunks.length = 0;
        clearTimers();
        signalProcessTree("SIGKILL");
        rejectResult(
          new SecurityRefusalError("Process output exceeded capture limit"),
        );
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_CAPTURE_BYTES) {
          rejectCaptureOverflow();
          return;
        }
        if (settled) {
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_CAPTURE_BYTES) {
          rejectCaptureOverflow();
          return;
        }
        if (settled) {
          return;
        }
        stderrChunks.push(chunk);
      });
      child.stdin.on("error", () => undefined);

      child.once("error", (error) => {
        if (settled) {
          return;
        }
        if (timedOut) {
          return;
        }
        settled = true;
        clearTimers();
        rejectResult(error);
      });

      child.once("close", (exitCode, signal) => {
        closeInformation = { exitCode, signal };
        finishFromClose();
      });

      child.stdin.end(request.stdin);
    });
  }
}
