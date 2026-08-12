import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { cwd, env } from "node:process";
import type { ProcessRunner } from "./process.js";

/**
 * The vendor-CLI boundary both adapters cross the same way: find the
 * executable, discover its version without throwing, screen what reaches its
 * argv, parse what comes back.
 *
 * It lived in `packages/adapter-claude` while there was one adapter. A
 * security screen and a fail-open fix are exactly the kind of logic that must
 * not exist twice — two copies drift, and a drifted copy is a hole neither
 * adapter's tests can see.
 */

export interface CliInstallation {
  readonly executable: string;
  readonly version: string;
}

export interface DiscoverCliDependencies {
  readonly runner: ProcessRunner;
  readonly executable: string;
}

export interface ResolveExecutableDependencies {
  readonly pathValue: string;
  readonly isExecutable: (candidate: string) => Promise<boolean>;
}

/**
 * `MAJOR.MINOR.PATCH`, no pre-release and no build metadata — the same
 * narrowing DOS-P3 applied to workflow versions, for a related reason: a
 * version is compared against a documented floor, and comparing `2.1.216-rc.1`
 * against `2.1.216` there would mean nothing.
 */
const VERSION_PATTERN = /\b(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\b/u;

const VERSION_TIMEOUT_MS = 10_000;

function defaultIsExecutable(candidate: string): Promise<boolean> {
  return access(candidate, constants.X_OK).then(
    () => true,
    () => false,
  );
}

/**
 * Turn a bare command name into the absolute path `discoverCli` requires.
 *
 * This exists because of a defect the fresh-context review caught: the process
 * request is built with `env: {}`, so a child has no `PATH` to resolve a bare
 * name against, and `assertSafeCommand` refuses a non-absolute executable
 * anyway. Resolution therefore has to happen here, in the parent, before a
 * request is ever built.
 *
 * A relative `PATH` entry is skipped rather than resolved against the working
 * directory: a directory named on `PATH` relative to wherever the process
 * happens to be running is an executable an attacker can place.
 */
export async function resolveExecutable(
  name: string,
  dependencies: ResolveExecutableDependencies = {
    pathValue: env["PATH"] ?? "",
    isExecutable: defaultIsExecutable,
  },
): Promise<string | null> {
  if (isAbsolute(name)) {
    return (await dependencies.isExecutable(name)) ? name : null;
  }
  if (name === "" || name.includes("/")) return null;

  for (const entry of dependencies.pathValue.split(delimiter)) {
    if (entry === "" || !isAbsolute(entry)) continue;
    const candidate = join(entry, name);
    if (await dependencies.isExecutable(candidate)) return candidate;
  }
  return null;
}

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
 * Structural, not a denylist — and that is the whole fix.
 *
 * The first version screened three exact strings out of an adapter's
 * `allowedTools`. A fresh-context review defeated it in one line:
 * `--permission-mode` is documented as taking a value, every parser accepts
 * `--opt=value`, and `"--permission-mode=bypassPermissions"` is not equal to
 * any of the three literals. `--add-dir /` and `--mcp-config` were not on the
 * list at all. A variadic flag stops at the first `-`-prefixed token, so each
 * of those became a flag rather than a value.
 *
 * The rule is positional rather than nominal: **nothing a caller puts in a
 * value position may look like an option.** A denylist has to enumerate every
 * dangerous flag a vendor will ever ship; this has to be right once. And it
 * refuses the invocation rather than silently dropping the offending entry,
 * because a caller that asked for a bypass has a bug worth reporting.
 *
 * The word list is `permission|danger|bypass`, wider than the
 * `permission|dangerous` that first shipped. `danger` alone (not only the full
 * word `dangerous`) and `bypass` both catch values a narrower pattern let
 * through — see `cli.test.ts` for the exact strings that motivated each
 * addition, ported forward from `adapter-claude` where the gap was found.
 */
export function screenValueArgument(value: string, field: string): string | null {
  if (value.startsWith("-")) {
    return `${field} may not begin with "-": it would be read as an option, not a value`;
  }
  if (/permission|danger|bypass/iu.test(value)) {
    return `${field} names a permission or bypass surface that is refused in a value position`;
  }
  return null;
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
