import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import { parseAgentPromptArgs } from "@developer-os/core";
import { parseStructuredPayload, screenValueArgument } from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";
import type { CodexInstallation } from "./discover.js";

/**
 * Spec §7: the shape a compiled `agent.prompt` step and its derived scopes
 * become before they reach `invokeCodex`. `prompt` and `writeScopes` still
 * need `screenValueArgument` before they reach argv — this type only
 * describes the *shape*, not that the values are already safe.
 */
export interface CodexInvocation {
  readonly prompt: string;
  readonly workingRoot: string;
  readonly writeScopes: readonly string[];
  readonly outputSchemaPath: string;
  readonly timeoutMs: number;
}

export type CodexRunResult =
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

export interface InvocationContext {
  readonly workingRoot: string;
  readonly writeScopes: readonly string[];
  readonly outputSchemaPath: string;
}

/**
 * The one door from a workflow's `agent.prompt` `with` block to a
 * `CodexInvocation`. `parseAgentPromptArgs` (from `@developer-os/core`) is
 * the single schema both adapters consume for this verb — see that module's
 * own doc comment for why a second, Codex-specific schema would be a
 * workflow that validates against one vendor and not the other.
 *
 * `context` carries what the compiler already derived — `workingRoot`,
 * `writeScopes`, `outputSchemaPath` — and is never author-controlled the way
 * `args` is, so it is trusted as given rather than re-validated here.
 */
export function invocationFromAgentPrompt(
  args: unknown,
  context: InvocationContext,
): { ok: true; invocation: CodexInvocation } | { ok: false; detail: string } {
  const parsed = parseAgentPromptArgs(args);
  if (!parsed.ok) {
    // The rejected value is never echoed: a `with` block is author-controlled
    // and this detail reaches a log. `parsed.message` is already scrubbed of
    // it by `parseAgentPromptArgs`.
    return { ok: false, detail: parsed.message };
  }
  return {
    ok: true,
    invocation: {
      prompt: parsed.args.prompt,
      workingRoot: context.workingRoot,
      writeScopes: context.writeScopes,
      outputSchemaPath: context.outputSchemaPath,
      timeoutMs: 30_000,
    },
  };
}

/**
 * Spec §7's fixed argv. The sandbox mode (`-s`) is derived from
 * `invocation.writeScopes.length` and never taken from an argument — that is
 * what makes `danger-full-access` unreachable rather than merely unwritten.
 * No caller and no workflow author can ask for it; the only two values this
 * package can ever place there are `read-only` and `workspace-write`.
 */
export async function invokeCodex(
  installation: CodexInstallation,
  invocation: CodexInvocation,
  dependencies: InvokeDependencies,
): Promise<CodexRunResult> {
  // `assertSafeCommand` refuses a non-absolute executable and the request
  // carries no PATH, so this cannot succeed downstream. Reported as a spawn
  // failure rather than thrown, because every other failure here is a value.
  if (!isAbsolute(installation.executable)) {
    return { ok: false, reason: "spawn-failed" };
  }

  const promptRefusal = screenValueArgument(invocation.prompt, "prompt");
  if (promptRefusal !== null) {
    return { ok: false, reason: "refused", detail: promptRefusal };
  }
  for (const scope of invocation.writeScopes) {
    const refusal = screenValueArgument(scope, "a write scope");
    if (refusal !== null) {
      return { ok: false, reason: "refused", detail: refusal };
    }
  }

  const args = [
    "exec",
    "--json",
    "--output-schema",
    invocation.outputSchemaPath,
    "-s",
    invocation.writeScopes.length === 0 ? "read-only" : "workspace-write",
    ...invocation.writeScopes.flatMap((scope) => ["--add-dir", scope]),
    "--skip-git-repo-check",
    "-C",
    invocation.workingRoot,
    invocation.prompt,
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
  // malformed result is a contract violation worth investigating; a signal is
  // neither. Collapsing them loses the only distinction that changes what a
  // caller should do.
  if (result.timedOut) return { ok: false, reason: "timeout" };
  if (result.signal !== null) {
    return { ok: false, reason: "signal", signal: result.signal };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: "exit", exitCode: result.exitCode ?? 1 };
  }
  return parseStructuredPayload(result.stdout);
}
