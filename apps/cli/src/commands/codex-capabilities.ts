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
   * **Default `false`, and that is a finding rather than a preference** — the
   * same reasoning `claude-capabilities.ts` records: `doctor` is a diagnostic
   * and must not shell out to the vendor's CLI on every invocation. The probe
   * here is `codex plugin list --json`, which spec §5.2 documents as a
   * read-only structured query, but running any vendor process from a
   * read-only command is a decision `doctor` should make once, not per call.
   */
  readonly probe?: boolean;
}

export interface CodexCapabilityReport {
  readonly installed: boolean;
  readonly version: string | null;
  readonly capabilities: CodexCapabilities;
  /** How capture reaches the vault on this machine, today. */
  readonly captureVia: "hook" | "wrapper";
  /** One line, for a `DoctorCheck.message`. */
  readonly summary: string;
  /**
   * The command that grants Codex's hook trust gate. Spec §5.3: Codex holds a
   * non-managed command hook inert until the user reviews and trusts it, so a
   * freshly installed plugin reports `wrapper-required` for every hook-backed
   * capability until one fires. That is not a degraded state — capture already
   * works through `developer-os run codex`, which needs no trust at all — but a
   * capability report that never names the one command that closes the gap is
   * useless to whoever reads it. Carried on every report, not only the ones a
   * probe found something to fix, so a report can never omit it.
   */
  readonly recovery: string;
}

const HOOK_TRUST_RECOVERY =
  "inside a Codex session, run /hooks to review and trust the developer-os hooks";

function allUnknown(): CodexCapabilities {
  const resolved: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const key of CODEX_CAPABILITY_KEYS) resolved[key] = "unknown";
  return Object.freeze(resolved) as unknown as CodexCapabilities;
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
      captureVia: "wrapper",
      summary: `codex=absent ${summarise(capabilities)}`,
      recovery: HOOK_TRUST_RECOVERY,
    };
  };

  const unreadable = (): CodexCapabilityReport => {
    const capabilities = allUnknown();
    return {
      installed: true,
      version: null,
      capabilities,
      captureVia: "wrapper",
      summary: `codex=unreadable ${summarise(capabilities)}`,
      recovery: HOOK_TRUST_RECOVERY,
    };
  };

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
      captureVia: "wrapper",
      summary: `codex=${installation.version} not-probed ${summarise(capabilities)}`,
      recovery: HOOK_TRUST_RECOVERY,
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
    // Spec §5.3: the wrapper is the route whenever `session_end_capture` is
    // not `yes`, and it stays that way until a hook is observed firing —
    // which requires the trust gate `recovery` names to be granted first.
    captureVia: capabilities.session_end_capture === "yes" ? "hook" : "wrapper",
    summary: `codex=${installation.version} ${summarise(capabilities)}`,
    recovery: HOOK_TRUST_RECOVERY,
  };
}
