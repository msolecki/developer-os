import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import { parseAgentPromptArgs } from "@developer-os/core";
import {
  parseStructuredPayload,
  screenDerivedPathArgument,
  screenProseArgument,
  screenValueArgument,
} from "@developer-os/security";
import type { ProcessRunner } from "@developer-os/security";
import type { CodexInstallation } from "./discover.js";

/**
 * Codex architecture former §7: the shape a compiled `agent.prompt` step and its derived scopes
 * become before they reach `invokeCodex`. Every field here that reaches an
 * argv value position still needs a screen before it gets there — this type
 * only describes the *shape*, not that the values are already safe.
 *
 * **Which screen depends on where the field came from**, and `invokeCodex` is
 * where that is decided: `screenValueArgument` for a write scope,
 * `screenProseArgument` for the prompt, and `screenDerivedPathArgument` for
 * `workingRoot` and `outputSchemaPath`, which this product assembles itself
 * (BACKLOG NEW-12).
 *
 * **The write-scope row is provisional, and the first real caller will have to
 * revisit it.** No production caller passes a write scope today — `ingest`
 * passes `[]` under knowledge-pipeline spec §3.3 — so keeping both rules there costs nothing and
 * is the safe default for a value a workflow author will eventually write. But
 * `--add-dir` takes a *directory*, and `resolveScopeGlob` returns a
 * vault-relative glob, so whoever wires the first scope will join it onto the
 * user's own vault root and hand this function a **derived path wearing a write
 * scope's name**. At that moment a vault at `~/Danger/DeveloperBrain` refuses
 * again, by exactly the mechanism NEW-12 closed, one field over. The same trap
 * is set in `adapter-claude`, whose `allowedTools` entries are documented as
 * carrying derived read and write scopes. **The concrete `Read(<path>/**)`
 * spelling is an inference from the vendor's own `--allowedTools` syntax, not
 * something that docblock states** — the trap does not depend on the spelling,
 * only on a derived path reaching a screen that carries the word list.
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
 * Applied when a caller does not supply its own `timeoutMs`. Codex architecture
 * former §7 names no default duration; the value is chosen to match the fixed value
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
 * of `args`. That is not a trust boundary: `invokeCodex` screens every one of
 * these fields before they reach argv regardless of where they came from, and
 * the positional rule — the complete one — is applied to all of them. What
 * provenance decides is only whether the *nominal* rule is applied on top, and
 * for these three it is not (BACKLOG NEW-12).
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
  // and the argv built below has no flag for it either (Codex architecture former §7 names none).
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
 * Codex's `--json` streams events to stdout as JSONL (Codex architecture former §14.1), and
 * `--output-schema` constrains only the model's *final response*, not the
 * whole stream (Codex architecture former §7) — so `parseStructuredPayload`, built for one JSON
 * document, must never see the raw stream directly.
 *
 * **The response is not the last line, and until 2026-08-20 this module
 * believed it was.** NEW-21 ran three successful turns against `codex-cli
 * 0.147.0` on that date — one per sandbox branch this module can emit, plus one
 * testing `--output-last-message` — and all three end the same way: the
 * terminal event is `turn.completed`, a **usage record**. The response is the
 * line before it — an `item.completed` whose `item.type` is `agent_message`,
 * carrying the schema-constrained JSON as a *string* in `item.text`. The
 * primary recording is
 * `tests/fixtures/codex/observed-exec-success-stream.jsonl`; the other two are
 * beside it, and Codex architecture former §14.1 tabulates which claim each one carries.
 *
 * **What the superseded rule did was worse than failing.** "The last line that
 * parses to a non-null object" selected `turn.completed`, which parses
 * perfectly, so `parseStructuredPayload` returned `ok: true` over vendor
 * telemetry: a caller told nothing had gone wrong, holding a payload with no
 * proposal in it. It shipped on 2026-08-12 and was wrong for the whole eight
 * days it stood, because the only real stream anyone had was the failed turn of
 * 2026-08-15, and a failed turn emits no response for a rule to be wrong about.
 *
 * **This filters on three vendor field names, and that is a deliberate trade.**
 * Codex architecture former §14.1 requires a narrowing to be proven against a stream where the old
 * rule and the new one agree; no such stream exists, because the old rule is
 * not narrower than this one but simply wrong. What the dependency buys is that
 * a vendor rename now yields `""` and therefore `malformed-output` — a loud
 * failure at the boundary — where the positional rule yielded a confident wrong
 * answer. A failure a caller can act on is worth more than a coincidence that
 * held on one stream shape.
 *
 * **Two things select the response, and only one of them is observed.**
 *
 * The `item.type` test is: the observed stream carries two `item.completed`
 * events and the first is a `command_execution`. It has no `text`, so that
 * check alone would skip it — what the `item.type` test actually guards is an
 * item that *does* carry `text` and is not the response, which is the shape of
 * a reasoning item, and `invoke.test.ts` pins exactly that.
 *
 * **The last-wins tie-break is an inference and is labelled as one**, per Codex
 * architecture former §14.1's rule that an unobserved claim is not written as an observation. The
 * recording contains exactly **one** `agent_message`. Nothing observed says
 * whether `--output-schema` constrains every assistant message or only the
 * terminal one, so nothing rules out a free-text summary arriving after the
 * structured response — under which this returns the summary and every Codex
 * ingest fails as `malformed-output`. That is the same silent-and-total shape
 * this function was rewritten to end, which is why it is named here rather than
 * left implicit. `BACKLOG.md` §1 NEW-45.
 *
 * **What keeps the failure path safe is still not this function.** On a failed
 * turn no `agent_message` is ever emitted, so this returns `""`; but the
 * `exitCode !== 0` check in `invokeCodex` runs first and is what gives that
 * caller `exit` rather than `malformed-output`, which is the distinction that
 * tells them whether to retry.
 */
function finalAgentMessage(stdout: string): string {
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
    const event = parsed as { type?: unknown; item?: unknown };
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (typeof item !== "object" || item === null) continue;
    const message = item as { type?: unknown; text?: unknown };
    if (message.type !== "agent_message") continue;
    if (typeof message.text !== "string") continue;
    last = message.text;
  }
  return last;
}

/**
 * Codex architecture former §7's fixed argv. The sandbox mode (`-s`) is derived from
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
  // Assembled here, so the positional rule alone (BACKLOG NEW-12). Both are
  // put together by this product — `workingRoot` from the user's validated
  // `brainPath`, `outputSchemaPath` from the product state root plus a fixed
  // `schemas/<verb>.schema.json` tail, of which only the tail ships. Both are
  // therefore full of text the user chose; what matters is that no party
  // outside this process chose the *argument*, which is the premise the word
  // list needs. It screened nothing here while refusing a directory the user
  // named themselves: a vault at `~/Danger/DeveloperBrain` refused every
  // ingest.
  //
  // This corrects, rather than relaxes, what stood here before. That comment
  // argued these fields are screened because "nothing in the type system marks
  // them trusted" — true, and the reason the screen is chosen by a function
  // whose *name* states the provenance the type cannot. Every value this
  // module places in an argv position is still screened; two of them are now
  // screened by the rule that applies to them.
  const workingRootRefusal = screenDerivedPathArgument(
    invocation.workingRoot,
    "the working root",
  );
  if (workingRootRefusal !== null) {
    return { ok: false, reason: "refused", detail: workingRootRefusal };
  }
  const outputSchemaPathRefusal = screenDerivedPathArgument(
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
      // Not a formality. `codex exec` reads its prompt from stdin whenever
      // stdin is not a TTY — Task 17 observed it print "Reading additional
      // input from stdin..." and block — so what makes this call return with a
      // *result* rather than after `timeoutMs` is `NodeProcessRunner` closing
      // the pipe with `child.stdin.end(request.stdin)`. Undocumented by the
      // vendor; Codex architecture former §14.1 carries the observation of 2026-08-15.
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
  return parseStructuredPayload(finalAgentMessage(result.stdout));
}
