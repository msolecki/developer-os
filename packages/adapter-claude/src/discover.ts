import { cwd } from "node:process";
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
export async function discoverClaude(
  dependencies: DiscoverDependencies,
): Promise<ClaudeInstallation | null> {
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
