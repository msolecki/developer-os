import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import { parseStructuredPayload, screenValueArgument } from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";
import type { ClaudeInstallation } from "./discover.js";

export interface ClaudeInvocation {
  readonly prompt: string;
  readonly maxTurns: number;
  /**
   * Spec §8: where a compile-time scope becomes a runtime restriction. The
   * workflow's derived read and write scopes translate into allowed-tool rules,
   * so the equality rule DOS-P3 enforces on paper is enforced again by the
   * agent's own permission system.
   *
   * Defence in depth, not a replacement — `workflow-schema.md` §8.6 records
   * that `steps[].with` sits outside the scope guarantee entirely, which is
   * what `parseAgentPromptArgs` exists to cover.
   */
  readonly allowedTools: readonly string[];
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
 * DOS-P7's real turn bound needs somewhere to start from.
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

  const promptRefusal = screenValueArgument(invocation.prompt, "prompt");
  if (promptRefusal !== null) {
    return { ok: false, reason: "refused", detail: promptRefusal };
  }
  for (const tool of invocation.allowedTools) {
    const refusal = screenValueArgument(tool, "an allowed tool");
    if (refusal !== null) {
      return { ok: false, reason: "refused", detail: refusal };
    }
  }

  const args = [
    "-p",
    invocation.prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(invocation.maxTurns),
  ];
  if (invocation.allowedTools.length > 0) {
    args.push("--allowedTools", ...invocation.allowedTools);
  }

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
