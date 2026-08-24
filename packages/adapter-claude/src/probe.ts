import { cwd } from "node:process";
import type { ProcessRunner } from "@developer-os/security";
import type { ProbeObservation } from "./capabilities.js";
import type { ClaudeInstallation } from "./discover.js";

export interface ProbeDependencies {
  readonly runner: ProcessRunner;
  readonly pluginDirectory: string;
  /**
   * Every path under `pluginDirectory`, relative or absolute — only the
   * suffixes are read. Injected rather than read here, because this package
   * touches no filesystem and a probe that did would need a real directory to
   * be testable at all.
   */
  readonly listPluginFiles: () => Promise<readonly string[]>;
}

const PROBE_TIMEOUT_MS = 30_000;

/**
 * The capabilities `claude plugin validate` can settle **for the tree this
 * adapter actually ships**. Claude architecture former §14.1: validate checks the manifest, skill,
 * agent and command frontmatter, and `hooks/hooks.json`, for syntax and schema
 * errors.
 *
 * It settles no lifecycle event, and this list is where that boundary is
 * enforced rather than remembered. A `SessionEnd` hook cannot be made to fire
 * without a real session (Claude architecture former §6.1), so `session_end_capture` is absent here
 * on purpose and reaches `resolveCapabilities` as an unmentioned key — which
 * that function reports as `not-used`, since no hook ships to fire (DOS-P6
 * Task 3).
 *
 * **`plugin_hooks` and `subagents` were on this list and are not any more.** The
 * tree contains `.claude-plugin/plugin.json` and six `SKILL.md` files: no
 * `hooks/` and no `agents/` directory exist in it, so a clean exit code cannot
 * have observed either one — and both resolved to `yes` on the strength of that
 * exit code. It is the same defect the removal of `hooks/hooks.json` was meant
 * to close, one layer up: a verified-present claim about something that is not
 * there. Restoring a key here means shipping the artifact it describes in the
 * same change. Found by fresh-context review, 2026-08-11.
 */
const VALIDATE_SETTLES = [
  { key: "skills", evidence: (file: string) => file.endsWith("SKILL.md") },
] as const;

/**
 * Probes only what a probe can honestly settle, and never throws.
 *
 * `claude plugin validate` is **not** a security control: Claude architecture former §10 records that
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
  for (const settled of VALIDATE_SETTLES) {
    observations.set(
      settled.key,
      await witness(validated, settled.evidence, dependencies),
    );
  }
  return observations;
}

/**
 * A clean exit code is not an observation of the artifact.
 *
 * `claude plugin validate` exits 0 over a directory holding nothing but a
 * schema-valid `.claude-plugin/plugin.json` — a partial install, or a user who
 * deleted `skills/` — and `skills` then resolved to `yes` over a plugin that
 * ships no skills. It is the narrower survivor of the defect that took
 * `plugin_hooks` and `subagents` off the list above, and the fix is this
 * repository's own rule applied to the one scan that did not follow it: every
 * scan asserts a non-empty set. A directory that cannot be listed is
 * `unavailable` — we could not ask — never `absent`. Found by fresh-context
 * review, 2026-08-11.
 */
async function witness(
  validated: ProbeObservation,
  evidence: (file: string) => boolean,
  dependencies: ProbeDependencies,
): Promise<ProbeObservation> {
  if (validated !== "observed") return validated;
  let files: readonly string[];
  try {
    files = await dependencies.listPluginFiles();
  } catch {
    return "unavailable";
  }
  return files.some(evidence) ? "observed" : "absent";
}
