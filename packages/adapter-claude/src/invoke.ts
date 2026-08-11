import { isAbsolute } from "node:path";
import { cwd } from "node:process";
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
  | { readonly ok: false; readonly reason: "spawn-failed" };

export interface InvokeDependencies {
  readonly runner: ProcessRunner;
}

/**
 * Flags this adapter never passes, on any code path, for any invocation.
 *
 * Implemented as a screen rather than as "we do not currently write them",
 * because `allowedTools` is caller-supplied and a rule nobody enforces is a
 * convention. A refusal that is only a habit is not a refusal.
 */
const FORBIDDEN_ARGUMENTS: ReadonlySet<string> = new Set([
  "--dangerously-skip-permissions",
  "--permission-mode",
  "bypassPermissions",
]);

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

  const args = [
    "-p",
    invocation.prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(invocation.maxTurns),
  ];
  const allowed = invocation.allowedTools.filter(
    (tool) => !FORBIDDEN_ARGUMENTS.has(tool),
  );
  if (allowed.length > 0) args.push("--allowedTools", ...allowed);

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
  return parsePayload(result.stdout);
}

/**
 * Structured output is validated, never best-effort parsed.
 *
 * A payload carrying `__proto__` at the top level is refused rather than
 * returned: `JSON.parse` does not pollute by itself, but this value is handed
 * to consumers that will spread and merge it, and the refusal belongs at the
 * boundary where the untrusted text becomes an object.
 */
function parsePayload(stdout: string): ClaudeRunResult {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "malformed-output" };
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    Object.prototype.hasOwnProperty.call(payload, "__proto__")
  ) {
    return { ok: false, reason: "malformed-output" };
  }
  return { ok: true, payload };
}
