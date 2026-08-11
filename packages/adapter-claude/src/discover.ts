import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { cwd, env } from "node:process";
import type { ProcessRunner } from "@developer-os/security";

export interface ClaudeInstallation {
  readonly executable: string;
  readonly version: string;
}

export interface DiscoverDependencies {
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
 * `doctor` unable to report on the environment it exists to describe — and
 * reporting on an environment with nothing in it is precisely what spec §5.3
 * requires of it.
 */
export interface ResolveDependencies {
  readonly pathValue: string;
  readonly isExecutable: (candidate: string) => Promise<boolean>;
}

function defaultIsExecutable(candidate: string): Promise<boolean> {
  return access(candidate, constants.X_OK).then(
    () => true,
    () => false,
  );
}

/**
 * Turn a bare command name into the absolute path `discoverClaude` requires.
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
  dependencies: ResolveDependencies = {
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

export async function discoverClaude(
  dependencies: DiscoverDependencies,
): Promise<ClaudeInstallation | null> {
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
