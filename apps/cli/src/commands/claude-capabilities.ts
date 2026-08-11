import {
  CLAUDE_CAPABILITY_KEYS,
  discoverClaude,
  probeClaude,
  resolveCapabilities,
} from "@developer-os/adapter-claude";
import type { ClaudeCapabilities } from "@developer-os/adapter-claude";
import type { ProcessRunner } from "@developer-os/security";

export interface ClaudeCapabilityRequest {
  /** From `discoverExecutable`; `null` when Claude Code is not installed. */
  readonly executablePath: string | null;
  readonly runner: ProcessRunner;
  readonly pluginDirectory: string;
  /**
   * Whether to run the capability probe.
   *
   * **Default `false`, and that is a finding rather than a preference.** The
   * probe is `claude plugin validate`, which spec §14.1 records as creating
   * `~/.claude.json` and a backup under `~/.claude/backups/` — observed against
   * a real installation on 2026-08-11. `doctor` is a diagnostic, and Foundation's
   * end-to-end suite asserts it touches nothing outside the product's own paths;
   * probing from there broke that assertion, which is how this was found.
   *
   * So spec §5's "the probe decides" cannot hold inside a read-only command.
   * `doctor` reads the version — `claude --version` writes nothing, measured —
   * and reports every probe-settled capability as `unknown`, which is exactly
   * what §9.2 means by it: we did not ask.
   */
  readonly probe?: boolean;
}

export interface ClaudeCapabilityReport {
  readonly installed: boolean;
  readonly version: string | null;
  readonly capabilities: ClaudeCapabilities;
  /** How capture reaches the vault on this machine, today. */
  readonly captureVia: "hook" | "wrapper";
  /** One line, for a `DoctorCheck.message`. */
  readonly summary: string;
}

function allUnknown(): ClaudeCapabilities {
  const resolved: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of CLAUDE_CAPABILITY_KEYS) resolved[key] = "unknown";
  return Object.freeze(resolved) as unknown as ClaudeCapabilities;
}

function summarise(capabilities: ClaudeCapabilities): string {
  return CLAUDE_CAPABILITY_KEYS.map(
    (key) => `${key}=${capabilities[key]}`,
  ).join(" ");
}

/**
 * The capability matrix product spec §11 asks `doctor` to print.
 *
 * **It reports; it never refuses.** `workflow-schema.md` §7 records the
 * contradiction this resolves: the `doctor` *workflow* refuses when no
 * installation is found, while `shared` tells a user in exactly that state to
 * run `developer-os doctor`. They are different objects that share a name. The
 * agent-facing workflow is right to refuse — an agent cannot diagnose an
 * install that is not there. The command is right to report, because reporting
 * on an empty environment is the whole job.
 *
 * With nothing to examine, every capability is `unknown` rather than absent
 * (spec §9.2): "we could not ask" and "the answer is no" are different facts,
 * and only one of them justifies telling a user their install lacks a feature.
 *
 * **The probe has a side effect.** `probeClaude` runs `claude plugin validate`,
 * which spec §14.1 records as creating `~/.claude.json` and a backup under
 * `~/.claude/backups/`. That is the vendor's own state rather than ours, but it
 * means `doctor` is not a read-only command and must not be described as one.
 */
export async function reportClaudeCapabilities(
  request: ClaudeCapabilityRequest,
): Promise<ClaudeCapabilityReport> {
  const absent = (): ClaudeCapabilityReport => {
    const capabilities = allUnknown();
    return {
      installed: false,
      version: null,
      capabilities,
      captureVia: "wrapper",
      summary: `claude=absent ${summarise(capabilities)}`,
    };
  };

  if (request.executablePath === null) return absent();

  const installation = await discoverClaude({
    runner: request.runner,
    executable: request.executablePath,
  });
  if (installation === null) return absent();

  if (request.probe !== true) {
    const capabilities = allUnknown();
    return {
      installed: true,
      version: installation.version,
      capabilities,
      captureVia: "wrapper",
      summary: `claude=${installation.version} not-probed ${summarise(capabilities)}`,
    };
  }

  const observations = await probeClaude(installation, {
    runner: request.runner,
    pluginDirectory: request.pluginDirectory,
  });
  const capabilities = resolveCapabilities(installation.version, observations);

  return {
    installed: true,
    version: installation.version,
    capabilities,
    // Spec §8.2: the wrapper is used whenever the capture surface is not `yes`,
    // and §6.1 makes that the state until a hook is observed firing.
    captureVia: capabilities.session_end_capture === "yes" ? "hook" : "wrapper",
    summary: `claude=${installation.version} ${summarise(capabilities)}`,
  };
}
