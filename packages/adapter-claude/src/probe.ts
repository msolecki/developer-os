import { cwd } from "node:process";
import type { ProcessRunner } from "@developer-os/security";
import type { ProbeObservation } from "./capabilities.js";
import type { ClaudeInstallation } from "./discover.js";

export interface ProbeDependencies {
  readonly runner: ProcessRunner;
  readonly pluginDirectory: string;
}

const PROBE_TIMEOUT_MS = 30_000;

/**
 * The capabilities `claude plugin validate` can settle. Spec §14.1: it checks
 * the manifest, skill/agent/command frontmatter and `hooks/hooks.json` for
 * syntax and schema errors.
 *
 * It settles no lifecycle event, and this list is where that boundary is
 * enforced rather than remembered. A `SessionEnd` hook cannot be made to fire
 * without a real session (spec §6.1), so `session_end_capture` is absent here
 * on purpose and reaches `resolveCapabilities` as an unmentioned key — which
 * that function reports as `wrapper-required`.
 */
const VALIDATE_SETTLES = ["skills", "plugin_hooks", "subagents"] as const;

/**
 * Probes only what a probe can honestly settle, and never throws.
 *
 * `claude plugin validate` is **not** a security control: spec §10 records that
 * it reports unrecognized manifest fields as warnings and that such a plugin
 * still loads. Our own drift check is the authority on our manifest's contents;
 * this call is used to catch syntax and schema errors early, which is a
 * different job.
 */
export async function probeClaude(
  installation: ClaudeInstallation,
  dependencies: ProbeDependencies,
): Promise<ReadonlyMap<string, ProbeObservation>> {
  let validated: ProbeObservation;
  try {
    const result = await dependencies.runner.run({
      executable: installation.executable,
      args: ["plugin", "validate", dependencies.pluginDirectory],
      cwd: cwd(),
      stdin: "",
      timeoutMs: PROBE_TIMEOUT_MS,
      env: {},
    });
    if (result.timedOut || result.exitCode === null) {
      validated = "unavailable";
    } else {
      validated = result.exitCode === 0 ? "observed" : "absent";
    }
  } catch {
    validated = "unavailable";
  }

  const observations = new Map<string, ProbeObservation>();
  for (const key of VALIDATE_SETTLES) observations.set(key, validated);
  return observations;
}
