import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { CLAUDE_CAPABILITY_KEYS } from "@developer-os/adapter-claude";
import { reportClaudeCapabilities } from "./claude-capabilities.js";

function runner(
  handler: (request: ProcessRequest) => Partial<ProcessResult>,
): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...handler(request),
      });
    },
  };
}

/** The shipped tree's shape: a manifest and at least one skill. */
const skillsPresent = (): Promise<readonly string[]> =>
  Promise.resolve([
    ".claude-plugin/plugin.json",
    "skills/developer-os-shared/SKILL.md",
  ]);

const version = (stdout: string) =>
  runner((request) =>
    request.args[0] === "--version" ? { stdout } : { exitCode: 0 },
  );

describe("reportClaudeCapabilities", () => {
  /**
   * `workflow-schema.md` §7 records the contradiction this resolves: the
   * `doctor` *workflow* refuses when no installation is found, while `shared`
   * tells a user in exactly that state to run `developer-os doctor`. They are
   * different objects sharing a name. The command reports; only the agent-facing
   * workflow refuses.
   */
  it("reports rather than refusing when nothing is installed", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: null,
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.installed).toBe(false);
    expect(report.version).toBeNull();
    // Pinned in both directions: `unreadable` asserts it is not `absent`, so
    // something has to assert that `absent` is what absence says.
    expect(report.summary).toContain("claude=absent");
  });

  it("reports every capability key even with nothing installed", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: null,
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(Object.keys(report.capabilities)).toHaveLength(
      CLAUDE_CAPABILITY_KEYS.length,
    );
  });

  /**
   * Claude architecture former §9.2. With nothing to ask, every answer is `unknown` — never a claim
   * that the install lacks the feature, because no install was examined.
   */
  it("reports unknown, not absence, when there is nothing to probe", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: null,
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(new Set(Object.values(report.capabilities))).toEqual(
      new Set(["unknown"]),
    );
  });

  /**
   * A binary that exists and does not answer used to report `claude=absent`,
   * so one `doctor` run said `agents: claude=present` and
   * `claude-capabilities: claude=absent` about the same file. "We could not
   * ask" is `unknown`, and the two states must be distinguishable in the line
   * a user reads.
   */
  it("distinguishes a present-but-unreadable binary from an absent one", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: runner(() => ({ exitCode: 97 })),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.version).toBeNull();
    expect(report.summary).toContain("claude=unreadable");
    expect(report.summary).not.toContain("claude=absent");
  });

  it("reports unreadable rather than absent when the version cannot be parsed", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("not a version at all"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("claude=unreadable");
  });

  it("reads the version from a real executable path", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216 (Claude Code)"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.version).toBe("2.1.216");
  });

  it("earns yes only where the probe observed and the table permits", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: skillsPresent,
    });
    expect(report.capabilities.skills).toBe("yes");
    expect(report.capabilities.session_end_capture).toBe("not-used");
  });

  it("never reports a lifecycle capability as yes", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: skillsPresent,
    });
    for (const key of [
      "session_start_injection",
      "session_end_capture",
      "pre_compact_backup",
    ] as const) {
      expect(report.capabilities[key], `${key} must not be yes`).not.toBe("yes");
    }
  });

  /**
   * The loop above enumerated three keys and the two that actually turned
   * `yes` were not among them: a clean `claude plugin validate` settled
   * `plugin_hooks` and `subagents`, neither of which exists in the shipped
   * tree. Enumerate every key instead, and name the one artifact that is
   * really there — a list that has to be edited to add a `yes` is the point.
   * Found by fresh-context review, 2026-08-11.
   */
  it("reports yes for exactly the one capability the tree ships", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: skillsPresent,
    });
    const granted = Object.entries(report.capabilities)
      .filter(([, state]) => state === "yes")
      .map(([key]) => key);
    expect(granted).toEqual(["skills"]);
  });

  /**
   * A capture reaches the vault because somebody ran a command. Knowledge-pipeline spec §8.2's
   * fallback to the wrapper, and the `hook` branch beside it, both name paths
   * this product is not building (knowledge-pipeline spec §3.1).
   */
  it("names the command as the capture route", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: skillsPresent,
    });
    expect(report.captureVia).toBe("command");
  });

  it("never throws when the runner fails outright", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      pluginDirectory: "/synthetic/plugin",
    });
    /**
     * `installed` was `false` here until 2026-08-11, which is the defect the
     * review found rather than a contract this test should keep: the binary
     * was discovered by the platform adapter and only *executing* it failed.
     * What this case pins is that the failure never propagates and never
     * produces a capability claim.
     */
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("claude=unreadable");
    expect(new Set(Object.values(report.capabilities))).toEqual(
      new Set(["unknown"]),
    );
  });

  /**
   * A clean `claude plugin validate` exits 0 over a directory holding nothing
   * but a schema-valid manifest — a partial install, or a user who deleted
   * `skills/`. The exit code is not an observation of the artifact.
   */
  it("does not report skills as yes over a directory that ships none", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: () =>
        Promise.resolve([".claude-plugin/plugin.json"]),
    });
    expect(report.capabilities.skills).toBe("unknown");
  });

  it("reports unknown when the plugin directory cannot be listed at all", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: () => Promise.reject(new Error("ENOENT")),
    });
    expect(report.capabilities.skills).toBe("unknown");
  });

  /**
   * A discovery that raised is a third input, not a second spelling of an
   * absent path: `doctor` used to flatten it into `executablePath: null` and
   * print `claude=absent` about a binary nothing had managed to ask.
   */
  it("reports a raised discovery as unreadable, never absent", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: null,
      discoveryFailed: true,
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("claude=unreadable");
    expect(report.summary).not.toContain("claude=absent");
  });

  it("renders a matrix line naming every key", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    for (const key of CLAUDE_CAPABILITY_KEYS) {
      expect(report.summary, `${key} must appear`).toContain(key);
    }
  });
});

/**
 * The probe's side effect is the reason `doctor` does not run it, so the
 * default is pinned by a test rather than left to a comment.
 */
describe("the probe is opt-in", () => {
  it("does not spawn plugin validate unless asked", async () => {
    const seen: string[][] = [];
    await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen.push([...request.args]);
          return Promise.resolve({
            stdout: "2.1.216",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginDirectory: "/synthetic/plugin",
    });
    expect(seen).toEqual([["--version"]]);
  });

  it("spawns plugin validate only when asked", async () => {
    const seen: string[][] = [];
    await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen.push([...request.args]);
          return Promise.resolve({
            stdout: "2.1.216",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginDirectory: "/synthetic/plugin",
      probe: true,
      listPluginFiles: skillsPresent,
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.[0]).toBe("plugin");
  });

  it("reports every capability as unknown when it did not probe", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
    });
    expect(report.summary).toContain("not-probed");
    expect(new Set(Object.values(report.capabilities))).toEqual(
      new Set(["unknown"]),
    );
  });
});
