import {
  CLAUDE_CAPABILITY_KEYS,
  discoverClaude,
  probeClaude,
  resolveCapabilities,
} from "@developer-os/adapter-claude";
import type { ClaudeCapabilities } from "@developer-os/adapter-claude";
import { readdir } from "node:fs/promises";

import type { ProcessRunner } from "@developer-os/security";

export interface ClaudeCapabilityRequest {
  /** From `discoverExecutable`; `null` when Claude Code is not installed. */
  readonly executablePath: string | null;
  /**
   * Discovery itself raised rather than answering, so no path was produced and
   * the binary was never asked anything.
   *
   * It is a third input, not a second reading of `executablePath`, because
   * `null` already means "the machine has no Claude Code" and a raised
   * discovery means the opposite of settled: `MacOsPlatformAdapter` refuses a
   * `which` result it cannot vouch for — it found something. `doctor` used to
   * flatten that into `executablePath: null` and print `claude=absent`, which
   * is "we could not ask" reported as "not installed" — the same conflation
   * `unreadable` exists to prevent, one layer up (`codex-adapter.md` §11.6).
   * When set, it decides the report before `executablePath` is read at all.
   */
  readonly discoveryFailed?: boolean;
  readonly runner: ProcessRunner;
  readonly pluginDirectory: string;
  /**
   * Whether to run the capability probe.
   *
   * **Default `false`, and that is a finding rather than a preference.** The
   * probe is `claude plugin validate`, which Claude architecture former §14.1 records as creating
   * `~/.claude.json` and a backup under `~/.claude/backups/` — observed against
   * a real installation on 2026-08-11. `doctor` is a diagnostic, and Foundation's
   * end-to-end suite asserts it touches nothing outside the product's own paths;
   * probing from there broke that assertion, which is how this was found.
   *
   * So Claude architecture former §5's "the probe decides" cannot hold inside a read-only command.
   * `doctor` reads the version — `claude --version` writes nothing, measured —
   * and reports every probe-settled capability as `unknown`, which is exactly
   * what §9.2 means by it: we did not ask.
   */
  readonly probe?: boolean;
  /**
   * Lists the plugin directory, so the probe can require the artifact it is
   * about to claim. Injected for tests; the default reads the real directory,
   * which is a read and not a mutation.
   */
  readonly listPluginFiles?: () => Promise<readonly string[]>;
}

export interface ClaudeCapabilityReport {
  readonly installed: boolean;
  readonly version: string | null;
  readonly capabilities: ClaudeCapabilities;
  /**
   * How capture reaches the vault on this machine, today: a command the user
   * ran, and nothing else.
   *
   * A single-member union rather than a dropped field, because the line
   * `doctor` prints still has to say it. It was `"hook" | "wrapper"`, chosen by
   * `session_end_capture === "yes"`; that key is `not-used` unconditionally now
   * (knowledge-pipeline architecture note §2 declines both automatic paths), so the
   * ternary was dead code that read as a live possibility.
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
 * satisfies `ClaudeCapabilities`'s named properties, so this compiled even if
 * the loop never assigned a required key — a renamed or dropped capability key
 * was not a compile error (`codex-adapter.md` §11.7). The same fix is applied
 * to `resolveCapabilities` in both adapters and to `allUnknown` in the Codex
 * command beside this one; all four sites are the same gap.
 *
 * The six `not-used` keys stay `unknown` here on purpose. `not-used` is a claim
 * about a resolved matrix; this one resolves nothing, and Claude architecture former §9.2's rule is
 * that a report about an install nobody examined says only that.
 */
function allUnknown(): ClaudeCapabilities {
  const resolved: ClaudeCapabilities = {
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
 * (Claude architecture former §9.2): "we could not ask" and "the answer is no" are different facts,
 * and only one of them justifies telling a user their install lacks a feature.
 *
 * **The probe has a side effect.** `probeClaude` runs `claude plugin validate`,
 * which Claude architecture former §14.1 records as creating `~/.claude.json` and a backup under
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
      captureVia: "command",
      summary: `claude=absent ${summarise(capabilities)}`,
    };
  };

  /**
   * A binary that is there and did not answer is **not** absent.
   *
   * `discoverClaude` returns `null` for a missing binary, a non-zero exit, a
   * timeout and unparseable output alike, and all four used to become
   * `claude=absent`. One `doctor` run then printed `agents: claude=present`
   * and `claude-capabilities: claude=absent` about the same file — pinned
   * green by an end-to-end fixture whose fake `claude` exits 97, because the
   * assertions read check ids and not messages. It is also the wrong state by
   * this product's own rule: "we could not ask" is `unknown`, which is what
   * every capability already reports here. Found by fresh-context review,
   * 2026-08-11.
   *
   * A raised discovery reports it too, and until DOS-P6 Task 3 nothing did:
   * this branch needed a non-null path *and* a `discoverClaude` that returned
   * `null`, while `doctor` caught the raise and passed `executablePath: null`,
   * so the one state that had a word for "we could not ask" had no producer.
   */
  const unreadable = (): ClaudeCapabilityReport => {
    const capabilities = allUnknown();
    return {
      installed: true,
      version: null,
      capabilities,
      captureVia: "command",
      summary: `claude=unreadable ${summarise(capabilities)}`,
    };
  };

  if (request.discoveryFailed === true) return unreadable();
  if (request.executablePath === null) return absent();

  const installation = await discoverClaude({
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
      summary: `claude=${installation.version} not-probed ${summarise(capabilities)}`,
    };
  }

  const observations = await probeClaude(installation, {
    runner: request.runner,
    pluginDirectory: request.pluginDirectory,
    listPluginFiles:
      request.listPluginFiles ??
      (() => readdir(request.pluginDirectory, { recursive: true })),
  });
  const capabilities = resolveCapabilities(installation.version, observations);

  return {
    installed: true,
    version: installation.version,
    capabilities,
    // A capture reaches the vault because somebody ran a command. Claude architecture former §8.2
    // used to name the wrapper here, chosen by `session_end_capture === "yes"`;
    // that key is `not-used` unconditionally now, so the branch was dead.
    captureVia: "command",
    summary: `claude=${installation.version} ${summarise(capabilities)}`,
  };
}
