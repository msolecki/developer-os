import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import { parseAgentPromptArgs } from "@developer-os/core";
import {
  parseStructuredPayload,
  screenProseArgument,
  screenValueArgument,
} from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";
import type { CodexInstallation } from "./discover.js";

/**
 * Spec §7: the shape a compiled `agent.prompt` step and its derived scopes
 * become before they reach `invokeCodex`. Every field here that reaches an
 * argv value position still needs `screenValueArgument` before it gets
 * there — this type only describes the *shape*, not that the values are
 * already safe.
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
 * Applied when a caller does not supply its own `timeoutMs`. Not sourced from
 * the spec, which names no default duration; chosen to match the fixed value
 * `adapter-codex/src/probe.ts`'s `PROBE_TIMEOUT_MS` already uses elsewhere in
 * this package. A named constant so a future change to it shows as a diff
 * here, rather than as a silent edit inside a literal nothing else points at.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The one door from a workflow's `agent.prompt` `with` block to a
 * `CodexInvocation`. `parseAgentPromptArgs` (from `@developer-os/core`) is
 * the single schema both adapters consume for this verb — see that module's
 * own doc comment for why a second, Codex-specific schema would be a
 * workflow that validates against one vendor and not the other.
 *
 * `context` carries what the compiler already derived — `workingRoot`,
 * `writeScopes`, `outputSchemaPath` — rather than anything read directly out
 * of `args`. That is not a trust boundary: `invokeCodex` screens every one
 * of these fields with `screenValueArgument` before they reach argv
 * regardless of where they came from, because the positional rule it
 * enforces does not take provenance as an input.
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
  // `parsed` can no longer carry a `maxTurns`: `parseAgentPromptArgs` refuses
  // the key outright (owner DOS-P7) rather than accepting a value this module
  // would have had nowhere to put — `CodexInvocation` carries no field for it
  // and the argv built below has no flag for it either (spec §7 names none).
  // A workflow author writing `maxTurns: 3` now gets a refusal naming DOS-P7
  // instead of the silent no-op this comment used to describe.
  return {
    ok: true,
    invocation: {
      prompt: parsed.args.prompt,
      workingRoot: context.workingRoot,
      writeScopes: context.writeScopes,
      outputSchemaPath: context.outputSchemaPath,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  };
}

/**
 * Codex's `--json` streams events to stdout as JSONL (spec §14.1), and
 * `--output-schema` constrains only the model's *final* response, not the
 * whole stream (spec §7) — so `parseStructuredPayload`, built for one JSON
 * document, must never see the raw stream directly.
 *
 * **Provisional, and this must stay visible at the call site.** The spec
 * documents that the output is JSONL but does not document the event
 * vocabulary, so "the last line that parses to a non-null JSON object" is
 * the best available rule, not a verified one — there is no confirmed
 * guarantee that the terminal event is always the final response rather
 * than, say, a trailing usage or session-close event on some Codex version.
 * Establishing the real terminal event's shape, and amending this spec with
 * it, is the integration task's job (against a real installation), not this
 * unit-tested module's. No event-type value is filtered on here for the same
 * reason: inventing one risks silently mismatching a future vendor version,
 * a failure only that integration test would catch.
 *
 * The object requirement guards the same risk from the other side: a stray
 * scalar or `null` line after the real result — a `123` or `"done"` emitted
 * by some event type this module has not seen — must not be read as the
 * payload just because it parses.
 *
 * This rule also **narrows** an input class the direct
 * `parseStructuredPayload(stdout)` call it replaced could still handle: a
 * pretty-printed single JSON document spread over several lines parses fine
 * as one string, but split by line here, no individual line parses on its
 * own, so this function returns `""` and the call now fails as
 * `malformed-output`. Harmless today because this module's argv always
 * passes `--json`, which Codex documents as one event per line (spec
 * §14.1), and the failure is closed rather than open — but whoever changes
 * this rule next should know it already gave something up, not only that it
 * might give up more.
 */
function finalJsonlLine(stdout: string): string {
  let last = "";
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    last = trimmed;
  }
  return last;
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

  // Prose, so the positional rule alone (BACKLOG NEW-12): the word list would
  // refuse a prompt for containing an ordinary English word, and DOS-P6 puts a
  // capture body in this terminal argument.
  const promptRefusal = screenProseArgument(invocation.prompt, "prompt");
  if (promptRefusal !== null) {
    return { ok: false, reason: "refused", detail: promptRefusal };
  }
  for (const scope of invocation.writeScopes) {
    const refusal = screenValueArgument(scope, "a write scope");
    if (refusal !== null) {
      return { ok: false, reason: "refused", detail: refusal };
    }
  }
  // The screen is positional, not nominal: every value this module places in
  // an argv value position is screened, regardless of where it came from.
  // `workingRoot` and `outputSchemaPath` are `readonly string` fields of an
  // exported interface reached through an exported function — nothing in the
  // type system marks them trusted, so they are screened exactly like
  // `prompt` and each write scope above.
  const workingRootRefusal = screenValueArgument(invocation.workingRoot, "the working root");
  if (workingRootRefusal !== null) {
    return { ok: false, reason: "refused", detail: workingRootRefusal };
  }
  const outputSchemaPathRefusal = screenValueArgument(
    invocation.outputSchemaPath,
    "the output schema path",
  );
  if (outputSchemaPathRefusal !== null) {
    return { ok: false, reason: "refused", detail: outputSchemaPathRefusal };
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
    // `?? 1` is synthetic: `CodexRunResult`'s `exit` variant requires a
    // number, but a process can in principle end with no code, no signal and
    // no timeout. `1` is invented only to satisfy that shape — it is not a
    // code the child ever reported.
    return { ok: false, reason: "exit", exitCode: result.exitCode ?? 1 };
  }
  return parseStructuredPayload(finalJsonlLine(result.stdout));
}
