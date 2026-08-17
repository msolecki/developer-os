import { isAbsolute } from "node:path";
import { cwd } from "node:process";
import type { ProcessRunner } from "./process.js";

/**
 * The vendor-CLI boundary both adapters cross the same way: discover its
 * version without throwing, screen what reaches its argv, parse what comes
 * back.
 *
 * It lived in `packages/adapter-claude` while there was one adapter. A
 * security screen and a fail-open fix are exactly the kind of logic that must
 * not exist twice — two copies drift, and a drifted copy is a hole neither
 * adapter's tests can see.
 *
 * Finding the executable is not this module's job. `discoverCli` takes an
 * absolute `executable` and only reads its version; production discovery is
 * `MacOsPlatformAdapter.discoverExecutable` (`packages/platform-macos`),
 * which shells `/usr/bin/which` with a controlled `PATH`. Two mechanisms that
 * both resolve a bare name to a path is a duplicated door with two different
 * security properties — one platform-specific and reached from
 * `apps/cli/src/commands/doctor.ts`, the other unreachable from any
 * production caller. `apps/cli/src/commands/claude-capabilities.ts` already
 * follows this split: it takes `executablePath` as an input and calls
 * `discoverClaude` only to read the version.
 */

export interface CliInstallation {
  readonly executable: string;
  readonly version: string;
}

export interface DiscoverCliDependencies {
  readonly runner: ProcessRunner;
  readonly executable: string;
}

/**
 * `MAJOR.MINOR.PATCH`, no pre-release and no build metadata — the same
 * narrowing DOS-P3 applied to workflow versions, for a related reason: a
 * version is compared against a documented floor, and comparing `2.1.216-rc.1`
 * against `2.1.216` there would mean nothing.
 */
const VERSION_PATTERN = /\b(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\b/u;

const VERSION_TIMEOUT_MS = 10_000;

/**
 * Never throws. A missing binary, a non-zero exit, a timeout and unparseable
 * output are all "no installation", because a discovery step that throws makes
 * a diagnostic command unable to report on the environment it exists to
 * describe — and reporting on an environment with nothing in it is precisely
 * what such a command is for.
 */
export async function discoverCli(
  dependencies: DiscoverCliDependencies,
): Promise<CliInstallation | null> {
  // `assertSafeCommand` refuses a non-absolute executable, and `env: {}` leaves
  // a child no `PATH` to resolve one against. Refusing here rather than at the
  // runner keeps the failure a reportable "no installation" instead of a
  // security refusal thrown out of a diagnostic command.
  if (!isAbsolute(dependencies.executable)) return null;

  let result;
  try {
    result = await dependencies.runner.run({
      executable: dependencies.executable,
      args: ["--version"],
      cwd: cwd(),
      stdin: "",
      timeoutMs: VERSION_TIMEOUT_MS,
      env: {},
    });
  } catch {
    return null;
  }
  if (result.timedOut || result.exitCode !== 0) return null;
  const match = VERSION_PATTERN.exec(result.stdout);
  if (match === null) return null;
  return { executable: dependencies.executable, version: match[0] };
}

/**
 * Two rules, stacked — one positional and complete, one nominal and
 * best-effort. Neither subsumes the other; both are load-bearing.
 *
 * The first version screened three exact strings out of an adapter's
 * `allowedTools`. A fresh-context review defeated it in one line:
 * `--permission-mode` is documented as taking a value, every parser accepts
 * `--opt=value`, and `"--permission-mode=bypassPermissions"` is not equal to
 * any of the three literals. `--add-dir /` and `--mcp-config` were not on the
 * list at all. A variadic flag stops at the first `-`-prefixed token, so each
 * of those became a flag rather than a value.
 *
 * **Rule one, the dash rule, is positional and complete:** nothing a caller
 * puts in a value position may look like an option. It needs no word list —
 * a leading `-` is refused regardless of what follows — and it is what closed
 * the `--opt=value` and variadic-flag gaps above. It refuses the invocation
 * rather than silently dropping the offending entry, because a caller that
 * asked for a bypass has a bug worth reporting.
 *
 * **The two rules are applied by three functions, and the split is by
 * provenance rather than by position.** It was positional until 2026-08-17, and
 * the paragraph you are reading said so; NEW-12 closed by splitting the *value*
 * case in two, because where a value came from is what decides whether the word
 * list can tell you anything about it.
 *
 * - `screenValueArgument` applies both rules, and is what a value originating
 *   **outside this repository** gets — a tool name, a write scope, a sandbox
 *   mode. These are short vendor vocabulary chosen by a workflow author or
 *   echoed from a model, so a permission surface really can appear in one
 *   without a leading dash.
 * - `screenDerivedPathArgument` applies rule one, and is what a path **this
 *   product computed** gets — the working root, the output schema path.
 * - `screenProseArgument` applies rule one, and is what a free-form prose
 *   argument gets. The word list buys nothing on prose, which cannot be
 *   reinterpreted as an option, while refusing text nobody chose: DOS-P6 puts a
 *   **capture body** in an argv value position, and an ordinary `EACCES`
 *   message names a permission.
 *
 * Narrowing the word list instead would weaken the values that do need it,
 * which is the direction this screen exists to prevent — so the pattern below
 * is byte-identical to the one that shipped, and `cli.test.ts` guards each of
 * its three alternatives with a sample that isolates it (BACKLOG NEW-12).
 *
 * **Rule two, the word list, is nominal and best-effort:** `permission|danger|
 * bypass`, wider than the `permission|dangerous` that first shipped. It
 * exists because a value naming a permission or bypass surface can arrive
 * without a leading dash at all (`"bypassPermissions"` as a bare
 * `allowedTools` entry, for instance), which the dash rule cannot see. `danger`
 * alone (not only the full word `dangerous`) and `bypass` both catch values a
 * narrower pattern let through — see `cli.test.ts` for the exact strings that
 * motivated each addition, ported forward from `adapter-claude` where the gap
 * was found. Being a word list, it must grow whenever a vendor coins a new
 * term; it is not, and cannot be made, complete the way the dash rule is.
 */
export function screenValueArgument(value: string, field: string): string | null {
  const positional = screenProseArgument(value, field);
  if (positional !== null) return positional;
  if (/permission|danger|bypass/iu.test(value)) {
    return `${field} names a permission or bypass surface that is refused in a value position`;
  }
  return null;
}

/**
 * **The weakest of the three screens, and the wrong default.** Reach for
 * `screenValueArgument` unless the value is prose that a vendor CLI cannot
 * reread as a flag — a prompt, and nothing else in this codebase today. A caller
 * choosing between the three by which one accepts its string has chosen wrongly
 * by construction, which is the hazard of exporting them all: each name says
 * what the argument must *be*, not that this function asks less of it.
 *
 * Rule one alone, then: it is a narrowing of `screenValueArgument` rather than a
 * second policy beside it — the complete rule is kept and the best-effort one is
 * dropped — so a prompt beginning with `-` is refused here exactly as it was
 * before.
 *
 * **A rule added here reaches derived paths too, silently.**
 * `screenDerivedPathArgument` delegates to this function, so anything added
 * below becomes a rule on `workingRoot` and `outputSchemaPath` as well as on the
 * prompt. **No test catches that** — both functions change together and stay
 * equal, so the agreement case in `cli.test.ts` stays green through it. Whoever
 * edits this body owes a sentence on whether a path should have got the rule
 * too, and this paragraph is the only thing that will ask them (BACKLOG NEW-12).
 */
export function screenProseArgument(value: string, field: string): string | null {
  if (value.startsWith("-")) {
    return `${field} may not begin with "-": it would be read as an option, not a value`;
  }
  return null;
}

/**
 * **The third screen, and the only one whose name states a provenance rather
 * than a shape.** A derived path is one *this product assembled* — the working
 * root, from the user's validated `brainPath`; the output schema path, from the
 * product state root plus a fixed `schemas/<verb>.schema.json` tail.
 *
 * **Careful about what "derived" claims, because the obvious stronger claim is
 * false.** These paths are full of text the user chose: their home directory
 * name is in both, and `DEVELOPER_OS_HOME` can put anything in front of the
 * shipped tail. What is true — and what the word list actually depends on — is
 * that **no party outside this process chose the argument**. A workflow author
 * or a model can hand us a write scope; neither hands us this. That is the
 * whole distinction, and it does not need the user's own path segments to be
 * innocent.
 *
 * **So the word list screens nothing here while refusing a directory the user
 * named themselves.** Rule two exists to catch a value naming a permission or
 * bypass surface that arrived from outside without a leading dash. A vault at
 * `~/Danger/DeveloperBrain` refused every `codex` ingest until this existed —
 * permanently, under a recovery line telling the user to run `ingest` again
 * (BACKLOG NEW-12).
 *
 * **The dash rule is kept, and it is the one that was ever load-bearing here.**
 * `process.ts` spawns with `shell: false` and an args array, so a value that
 * does not begin with `-` cannot become anything but a value; an absolute path
 * that does begin with one is not the path this product assembled, whatever
 * produced it.
 *
 * **It delegates to `screenProseArgument`, and the drift that creates runs one
 * way — toward here.** Any rule added to that function silently becomes a rule
 * on derived paths; the reverse cannot happen, because nothing delegates to
 * this. **No test catches that direction and none can while the delegation
 * stands**, since both functions change together and stay equal — so the guard
 * is this paragraph and the reviewer who reads it. `cli.test.ts`'s agreement
 * case is a tripwire on *this* function's body, not coverage of that leak, and
 * it says so. Whoever adds a rule to the prose screen owes a sentence about
 * whether a path should have got it too.
 *
 * **Do not add a NUL check here** — `process.ts` already applies one to every
 * argument of every request, and this file's own header forbids a security
 * screen existing twice.
 *
 * **Choosing between the three screens is a question about where the value came
 * from, never about which one accepts your string.** A caller reaching for this
 * because `screenValueArgument` refused its input has chosen wrongly by
 * construction unless it can name the code in this repository that assembled
 * the value.
 */
export function screenDerivedPathArgument(
  value: string,
  field: string,
): string | null {
  return screenProseArgument(value, field);
}

/**
 * Structured output is validated, never best-effort parsed.
 *
 * A payload carrying `__proto__` at its top level is refused rather than
 * returned: `JSON.parse` does not pollute by itself, but this value is handed
 * to consumers that will spread and merge it, and the refusal belongs at the
 * boundary where the untrusted text becomes an object. **Only the top level is
 * checked** — a nested `{"a":{"__proto__":{...}}}` is not walked and passes
 * through. That was an acceptable boundary for one adapter's own result
 * shape; a caller merging a nested field of the payload is responsible for
 * its own guard.
 */
export function parseStructuredPayload(
  stdout: string,
):
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: "malformed-output" } {
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
