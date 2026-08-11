import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { invokeClaude } from "./invoke.js";
import type { ClaudeInvocation } from "./invoke.js";

const installation = {
  executable: "/opt/synthetic/bin/claude",
  version: "2.1.216",
} as const;

const invocation: ClaudeInvocation = {
  prompt: "summarise",
  maxTurns: 3,
  allowedTools: ["Read", "Bash(git log *)"],
  timeoutMs: 60_000,
};

function capturing(result: Partial<ProcessResult>): {
  runner: ProcessRunner;
  seen: () => ProcessRequest | null;
} {
  let request: ProcessRequest | null = null;
  return {
    seen: () => request,
    runner: {
      run(incoming: ProcessRequest): Promise<ProcessResult> {
        request = incoming;
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
          ...result,
        });
      },
    },
  };
}

describe("invokeClaude", () => {
  it("passes argv as an array, in print mode, asking for json", async () => {
    const { runner, seen } = capturing({ stdout: '{"result":"ok"}' });
    await invokeClaude(installation, invocation, { runner });
    expect(seen()?.args).toEqual([
      "-p",
      "summarise",
      "--output-format",
      "json",
      "--max-turns",
      "3",
      "--allowedTools",
      "Read",
      "Bash(git log *)",
    ]);
  });

  it("passes an empty environment, so nothing inherits by accident", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    await invokeClaude(installation, invocation, { runner });
    expect(seen()?.env).toEqual({});
    expect(seen()?.stdin).toBe("");
  });

  it("omits allowedTools entirely when the list is empty", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    await invokeClaude(
      installation,
      { ...invocation, allowedTools: [] },
      { runner },
    );
    expect(seen()?.args).not.toContain("--allowedTools");
  });

  /**
   * A timeout is retryable and a malformed result is a contract violation worth
   * investigating. Reporting one as the other loses that distinction, which is
   * the whole reason these are separate reasons rather than a boolean.
   */
  it("reports a timeout as a timeout, never as malformed output", async () => {
    const { runner } = capturing({ timedOut: true, exitCode: null, stdout: "" });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("reports a signal death distinctly", async () => {
    const { runner } = capturing({ exitCode: null, signal: "SIGKILL" });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "signal",
      signal: "SIGKILL",
    });
  });

  it("reports a non-zero exit carrying the code", async () => {
    const { runner } = capturing({ exitCode: 3, stdout: "{}" });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "exit",
      exitCode: 3,
    });
  });

  it("reports malformed output as a failure, never a best-effort parse", async () => {
    const { runner } = capturing({ stdout: "not json at all" });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "malformed-output",
    });
  });

  it("reports a spawn failure rather than throwing", async () => {
    const runner: ProcessRunner = {
      run(): Promise<ProcessResult> {
        throw new Error("spawn failed");
      },
    };
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "spawn-failed",
    });
  });

  it("returns the parsed payload on success", async () => {
    const { runner } = capturing({ stdout: '{"result":"done"}' });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: true,
      payload: { result: "done" },
    });
  });

  /**
   * A JSON payload whose top level is `__proto__` must not reach a consumer as
   * a prototype mutation. `JSON.parse` does not pollute by itself, but anything
   * that later spreads or merges the payload would.
   */
  it("refuses a payload carrying a reserved key", async () => {
    const { runner } = capturing({
      stdout: '{"__proto__":{"polluted":true},"result":"x"}',
    });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "malformed-output",
    });
  });

  it("refuses a non-absolute executable rather than spawning it", async () => {
    const { runner } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      { executable: "claude", version: "2.1.216" },
      invocation,
      { runner },
    );
    expect(result).toEqual({ ok: false, reason: "spawn-failed" });
  });

  it("never passes a dangerous bypass flag, whatever the invocation asks for", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    await invokeClaude(
      installation,
      {
        ...invocation,
        allowedTools: ["--dangerously-skip-permissions", "Read"],
      },
      { runner },
    );
    const args = seen()?.args ?? [];
    for (const forbidden of [
      "--dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
    ]) {
      expect(args, `${forbidden} must never be an argv element`).not.toContain(
        forbidden,
      );
    }
  });
});
