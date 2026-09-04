import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import { parseStructuredPayload, screenProseArgument } from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";
import type { ClaudeInstallation } from "./discover.js";

export interface ClaudeInvocation {
  readonly prompt: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
}

export type ClaudeRunResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: "timeout" }
  | { readonly ok: false; readonly reason: "signal"; readonly signal: string }
  | { readonly ok: false; readonly reason: "exit"; readonly exitCode: number }
  | { readonly ok: false; readonly reason: "malformed-output" }
  | { readonly ok: false; readonly reason: "spawn-failed" }
  | { readonly ok: false; readonly reason: "refused"; readonly detail: string };

export interface InvokeDependencies {
  readonly runner: ProcessRunner;
}

const MAX_TURNS_CEILING = 50;

/**
 * `packages/core/src/agent-prompt/index.ts` refuses `maxTurns` outright
 * rather than half-honouring it on one vendor and dropping it on the other
 * (owner DOS-P7) — so `parseAgentPromptArgs`, which used to default the
 * value, no longer produces one at all. `ClaudeInvocation.maxTurns` is still
 * required, though: bounded because an unbounded agentic loop inside a
 * workflow with declared scopes is a workflow whose cost and reach are
 * decided by the model, not by the workflow's author. Exported as a named
 * constant, not left as a literal at whatever future call site builds a
 * `ClaudeInvocation` from a workflow step, so that reasoning travels with the
 * value instead of being re-invented — or silently dropped — the day
 * DOS-P7's real turn bound needs somewhere to start from. Re-exported through
 * `index.ts`, this package's only door: the future call site this constant
 * exists for is outside this package (wherever a workflow step becomes a
 * `ClaudeInvocation`), so a package-internal export alone would leave it
 * unreachable by the one consumer it was added for.
 *
 * `--max-turns` is registered on Claude Code 2.1.261 but hidden from
 * `--help` (`.hideHelp()`) — `docs/architecture/vendor-invocation.md`,
 * Claude table rows 14-17.
 */
export const DEFAULT_MAX_TURNS = 5;

export async function invokeClaude(
  installation: ClaudeInstallation,
  invocation: ClaudeInvocation,
  dependencies: InvokeDependencies,
): Promise<ClaudeRunResult> {
  // `assertSafeCommand` refuses a non-absolute executable and the request
  // carries no PATH, so this cannot succeed downstream. Reported as a spawn
  // failure rather than thrown, because every other failure here is a value.
  if (!isAbsolute(installation.executable)) {
    return { ok: false, reason: "spawn-failed" };
  }

  // `maxTurns` reaches argv as a value. `-1` is another `-`-prefixed token in a
  // value position, and `NaN` is a string the vendor will interpret however it
  // likes. Bounded here rather than trusted from the type, because
  // `ClaudeInvocation` is constructed by callers and shares no type with
  // `AgentPromptArgs`.
  if (
    !Number.isInteger(invocation.maxTurns) ||
    invocation.maxTurns < 1 ||
    invocation.maxTurns > MAX_TURNS_CEILING
  ) {
    return {
      ok: false,
      reason: "refused",
      detail: `maxTurns must be an integer between 1 and ${String(MAX_TURNS_CEILING)}`,
    };
  }

  // Prose, so the positional rule alone (BACKLOG NEW-12): the word list would
  // refuse a prompt for containing an ordinary English word, and DOS-P6 puts a
  // capture body here.
  const promptRefusal = screenProseArgument(invocation.prompt, "prompt");
  if (promptRefusal !== null) {
    return { ok: false, reason: "refused", detail: promptRefusal };
  }

  /**
   * Every flag below is a mechanical fact from `claude --help` on 2.1.261
   * (`docs/architecture/vendor-invocation.md`, Claude table), not a restatement
   * of its own name:
   * - `--tools ""` — an empty tool *set*, per the flag's own help text: `""`
   *   disables all tools (row 2). Not a grant list; there is no allow-list left.
   * - `--strict-mcp-config` — with no `--mcp-config` given, loads zero MCP
   *   servers (row 9).
   * - `--restricted` — ignores user, project and local settings files (row 18).
   * - `--safe-mode` — starts with hooks, plugins, skills, CLAUDE.md, MCP
   *   servers, custom commands and agents disabled; auth and built-in tools
   *   stay (row 19).
   * - `--no-session-persistence` — keeps the run out of the user's resumable
   *   history; print mode only (row 11).
   * - `--permission-prompts none` — denies anything that would prompt in print
   *   mode (row 11).
   *
   * Deliberately NOT passed: `--setting-sources ""` (row 6 — whether an empty
   * value means "load none" is unobserved); `--permission-mode` (row 8 — the
   * help gives no ordering of its six values, and with no tools it decides
   * nothing); `--json-schema` (row 10 — registered, but the shape it produces
   * under `--output-format json` is unobserved; a later plan may add it against
   * an observation). Whether these six flags interact with each other at
   * runtime is unobserved and needs a session —
   * `docs/architecture/vendor-invocation.md`.
   */
  const args = [
    "-p",
    invocation.prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(invocation.maxTurns),
    "--tools",
    "",
    "--strict-mcp-config",
    "--restricted",
    "--safe-mode",
    "--no-session-persistence",
    "--permission-prompts",
    "none",
  ];

  let result;
  try {
    result = await dependencies.runner.run({
      executable: installation.executable,
      args,
      cwd: cwd(),
      stdin: "",
      timeoutMs: invocation.timeoutMs,
      env: {},
    });
  } catch {
    return { ok: false, reason: "spawn-failed" };
  }

  // Ordered so each failure keeps its own identity. A timeout is retryable; a
  // malformed result is a contract violation worth investigating; collapsing
  // them loses the only distinction that changes what a caller should do.
  if (result.timedOut) return { ok: false, reason: "timeout" };
  if (result.signal !== null) {
    return { ok: false, reason: "signal", signal: result.signal };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: "exit", exitCode: result.exitCode ?? 1 };
  }
  return parseStructuredPayload(result.stdout);
}
