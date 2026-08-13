import {
  CODEX_CAPABILITY_KEYS,
  discoverCodex,
  probeCodex,
  resolveCapabilities,
} from "@developer-os/adapter-codex";
import type { CodexCapabilities } from "@developer-os/adapter-codex";

import type { ProcessRunner } from "@developer-os/security";

export interface CodexCapabilityRequest {
  /** From `discoverExecutable`; `null` when Codex is not installed. */
  readonly executablePath: string | null;
  /**
   * Discovery itself raised rather than answering, so no path was produced and
   * the binary was never asked anything. Mirrors
   * `ClaudeCapabilityRequest.discoveryFailed`, which carries the reasoning:
   * `null` means "this machine has no Codex", a raised discovery means the
   * opposite of settled, and flattening the second into the first printed "we
   * could not ask" as "not installed" (`codex-adapter.md` §11.6).
   */
  readonly discoveryFailed?: boolean;
  readonly runner: ProcessRunner;
  /**
   * The absolute path the plugin tree is installed to — the tree's own root,
   * `<product-home>/codex/plugins/developer-os` (spec §4), not the
   * marketplace root a level above it. `probeCodex` compares this against the
   * resolved path `codex plugin list --json` reports, so it must be the exact
   * value `install.ts` writes to, not a value this file invents.
   */
  readonly pluginRoot: string;
  /**
   * Whether to run the capability probe.
   *
   * **Default `false`, and that is a finding rather than a preference.**
   * `doctor` is a diagnostic and must not shell out to the vendor's CLI on
   * every invocation — `claude-capabilities.ts` settles the same question for
   * Claude's probe, which spec §14.1 records as *mutating* (it writes
   * `~/.claude.json` and a backup). This probe is different in kind: `codex
   * plugin list --json` is a read-only structured query (spec §5.2), so
   * nothing here is refusing a write. It stays opt-in anyway, because
   * spawning any vendor process from a read-only command is a decision
   * `doctor` should make once, explicitly, rather than on every run.
   */
  readonly probe?: boolean;
}

export interface CodexCapabilityReport {
  readonly installed: boolean;
  readonly version: string | null;
  readonly capabilities: CodexCapabilities;
  /**
   * How capture reaches the vault on this machine, today: a command the user
   * ran, and nothing else. `ClaudeCapabilityReport.captureVia` carries the
   * reasoning; the two must say the same thing, because one `doctor` report
   * prints both.
   */
  readonly captureVia: "command";
  /** One line, for a `DoctorCheck.message`. */
  readonly summary: string;
}

/**
 * Every key `unknown`: the matrix for a machine nothing was asked about.
 *
 * **Written out key by key, and that is the type check rather than a style.**
 * The accumulator was `Record<string, CapabilityState>`, whose index signature
 * satisfies `CodexCapabilities`'s required named properties, so this compiled
 * even if the loop never assigned a required key — a renamed or dropped
 * capability key was not a compile error (`codex-adapter.md` §11.7). The same
 * fix is applied to `resolveCapabilities` in both adapters and to `allUnknown`
 * in the Claude command beside this one; all four sites are the same gap.
 *
 * The six `not-used` keys stay `unknown` here for the reason the Claude twin
 * records: `not-used` is a claim about a resolved matrix, and this one resolves
 * nothing.
 */
function allUnknown(): CodexCapabilities {
  const resolved: CodexCapabilities = {
    skills: "unknown",
    plugin_hooks: "unknown",
    session_start_injection: "unknown",
    session_end_capture: "unknown",
    pre_compact_backup: "unknown",
    non_interactive_run: "unknown",
    structured_result: "unknown",
    subagents: "unknown",
    durable_project_guidance: "unknown",
  };
  return Object.freeze(resolved);
}

function summarise(capabilities: CodexCapabilities): string {
  return CODEX_CAPABILITY_KEYS.map(
    (key) => `${key}=${capabilities[key]}`,
  ).join(" ");
}

/**
 * The capability matrix product spec §11 asks `doctor` to print, for Codex.
 *
 * Mirrors `reportClaudeCapabilities`'s three-branch shape deliberately: a
 * binary that is there and did not answer is **not** absent, for the same
 * reason recorded there — `discoverCodex` (the shared `discoverCli`) returns
 * `null` for a missing binary, a non-zero exit, a timeout and unparseable
 * output alike, and collapsing all four into `codex=absent` would let one
 * `doctor` run say `agents: codex=present` and `codex-capabilities:
 * codex=absent` about the same file.
 *
 * With nothing to examine, every capability is `unknown` rather than absent
 * (spec §9.2): "we could not ask" and "the answer is no" are different facts.
 */
export async function reportCodexCapabilities(
  request: CodexCapabilityRequest,
): Promise<CodexCapabilityReport> {
  const absent = (): CodexCapabilityReport => {
    const capabilities = allUnknown();
    return {
      installed: false,
      version: null,
      capabilities,
      captureVia: "command",
      summary: `codex=absent ${summarise(capabilities)}`,
    };
  };

  /**
   * A binary that is there and did not answer is **not** absent, and neither
   * is one whose discovery raised — until DOS-P6 Task 3 that second case had
   * no producer at all, because `doctor` caught the raise and passed
   * `executablePath: null`. The Claude twin carries the full record.
   */
  const unreadable = (): CodexCapabilityReport => {
    const capabilities = allUnknown();
    return {
      installed: true,
      version: null,
      capabilities,
      captureVia: "command",
      summary: `codex=unreadable ${summarise(capabilities)}`,
    };
  };

  if (request.discoveryFailed === true) return unreadable();
  if (request.executablePath === null) return absent();

  const installation = await discoverCodex({
    runner: request.runner,
    executable: request.executablePath,
  });
  if (installation === null) return unreadable();

  if (request.probe !== true) {
    const capabilities = allUnknown();
    return {
      installed: true,
      version: installation.version,
      capabilities,
      captureVia: "command",
      summary: `codex=${installation.version} not-probed ${summarise(capabilities)}`,
    };
  }

  const probed = await probeCodex(installation, {
    runner: request.runner,
    pluginRoot: request.pluginRoot,
  });
  const capabilities = resolveCapabilities(installation.version, probed.observations);

  return {
    installed: true,
    version: installation.version,
    capabilities,
    // A capture reaches the vault because somebody ran a command. Spec §5.3
    // used to name the wrapper here, chosen by `session_end_capture === "yes"`;
    // that key is `not-used` unconditionally now, so the branch was dead.
    captureVia: "command",
    summary: `codex=${installation.version} ${summarise(capabilities)}`,
  };
}
