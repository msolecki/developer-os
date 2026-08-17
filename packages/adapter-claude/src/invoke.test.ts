import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { DEFAULT_MAX_TURNS, invokeClaude } from "./invoke.js";
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

  /**
   * **The prompt is prose and is screened as prose** (BACKLOG NEW-12). The
   * positional rule above still applies to it; the word list does not, because
   * prose cannot be reread as a CLI option and DOS-P6 puts a *capture body* in
   * this position — an ordinary `EACCES` message names a permission, and a
   * capture carrying one could never be ingested while both rules applied here.
   */
  it("invokes rather than refusing when the prompt is prose naming a permission", async () => {
    const { runner, seen } = capturing({ stdout: '{"result":"done"}' });
    const prompt = "npm ERR! EACCES: permission denied, open /usr/local/lib";
    const result = await invokeClaude(installation, { ...invocation, prompt }, {
      runner,
    });

    expect(result).toEqual({ ok: true, payload: { result: "done" } });
    expect(seen()?.args).toContain(prompt);
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

  /**
   * `DEFAULT_MAX_TURNS` is `packages/core/src/agent-prompt/index.ts`'s
   * removed default, moved here now that `maxTurns` is refused outright there
   * (owner DOS-P7) rather than defaulted. Pinned against the bound
   * `invokeClaude` enforces above, not against a second copy of the private
   * `MAX_TURNS_CEILING` — re-declaring that value here would let the two
   * drift independently and prove nothing about what this module actually
   * does with it. A default outside `[1, MAX_TURNS_CEILING]` would make
   * every default-configured invocation refuse, which this test would catch
   * as `result.ok === false`; deleting the constant altogether breaks this
   * file's import instead of leaving the change silently green.
   */
  it("keeps DEFAULT_MAX_TURNS within the bound invokeClaude enforces on every invocation", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, maxTurns: DEFAULT_MAX_TURNS },
      { runner },
    );
    expect(
      result.ok,
      "DEFAULT_MAX_TURNS must not be refused as out of bounds",
    ).toBe(true);
    expect(seen()?.args).toContain("--max-turns");
    expect(seen()?.args).toContain(String(DEFAULT_MAX_TURNS));
  });

  /**
   * Regression, exercised through `invokeClaude`'s own real code path rather
   * than only as a unit test of `parseStructuredPayload`
   * (`packages/security/src/cli.test.ts`). The Codex adapter's `invoke.test.ts`
   * pins all three of the shared screen's failure shapes end to end; this
   * adapter had lost them when the screen moved to `@developer-os/security`.
   */
  it("reports unparseable stdout as malformed output", async () => {
    const { runner } = capturing({ stdout: "not json at all" });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "malformed-output",
    });
  });

  it("refuses a payload carrying a top-level __proto__ rather than returning it", async () => {
    const { runner } = capturing({
      stdout: '{"result":"x","__proto__":{"polluted":true}}',
    });
    expect(await invokeClaude(installation, invocation, { runner })).toEqual({
      ok: false,
      reason: "malformed-output",
    });
  });

  /**
   * Every surviving screen case above trips the leading-dash rule
   * (`--dangerously-skip-permissions`, `--mcp-config`), so the word-list rule
   * — `permission|danger|bypass`, catching a hostile value with no leading
   * dash at all — was unexercised end to end on this adapter's own wiring.
   */
  it("refuses an allowed tool naming a permission surface even without a leading dash", async () => {
    const { runner, seen } = capturing({ stdout: "{}" });
    const result = await invokeClaude(
      installation,
      { ...invocation, allowedTools: ["bypassPermissions"] },
      { runner },
    );
    expect(result).toMatchObject({ ok: false, reason: "refused" });
    expect(seen()).toBeNull();
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
