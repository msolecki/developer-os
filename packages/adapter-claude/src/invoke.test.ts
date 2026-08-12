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

/**
 * `screenValueArgument` and `parseStructuredPayload` moved to
 * `packages/security/src/cli.ts` (Task 3.5) — their own batteries, including the
 * exhaustive hostile-value matrix and the payload/`__proto__` cases, live in
 * `packages/security/src/cli.test.ts`. What remains here is Claude-specific:
 * the argv shape, `maxTurns`, and the process-result handling this function
 * still owns, plus two minimal tests proving the shared screen is actually
 * wired in at both of its call sites (prompt and each allowed tool).
 */
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

  it("refuses a non-absolute executable rather than spawning it", async () => {
    const { runner } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      { executable: "claude", version: "2.1.216" },
      invocation,
      { runner },
    );
    expect(result).toEqual({ ok: false, reason: "spawn-failed" });
  });

  it("refuses before spawning when the prompt fails the shared screen", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, prompt: "--dangerously-skip-permissions" },
      { runner },
    );
    expect(result).toMatchObject({ ok: false, reason: "refused" });
    expect(seen()).toBeNull();
  });

  it("refuses before spawning when an allowed tool fails the shared screen", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, allowedTools: ["--dangerously-skip-permissions=true", "Read"] },
      { runner },
    );
    expect(result.ok, "a hostile tool must be refused").toBe(false);
    expect(seen(), "a refused invocation must never reach a spawn").toBeNull();
  });

  /** The hostile entry sits after an ordinary one, so this also pins that the
   * loop over `allowedTools` keeps checking past the first element rather
   * than stopping once one tool has passed the screen. */
  it("refuses when a later allowed tool fails the shared screen, not only the first", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, allowedTools: ["Read", "--mcp-config"] },
      { runner },
    );
    expect(result.ok, "a hostile tool later in the list must be refused").toBe(
      false,
    );
    expect(seen(), "a refused invocation must never reach a spawn").toBeNull();
  });

  /**
   * `maxTurns` lands in a value position too, so `-1` is one more `-`-prefixed
   * argv element and `NaN` is a string the vendor interprets however it likes.
   */
  it("refuses a maxTurns that is not a bounded integer", async () => {
    for (const maxTurns of [-1, 0, 1.5, Number.NaN, 1000, Infinity]) {
      const { runner, seen } = capturing({ stdout: "{}" });
      const result = await invokeClaude(
        installation,
        { ...invocation, maxTurns },
        { runner },
      );
      expect(result.ok, `maxTurns ${String(maxTurns)} must be refused`).toBe(
        false,
      );
      expect(seen()).toBeNull();
    }
  });

  it("still allows an ordinary tool list through", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, allowedTools: ["Read", "Bash(git log *)"] },
      { runner },
    );
    expect(result.ok).toBe(true);
    expect(seen()?.args).toContain("--allowedTools");
  });
});
