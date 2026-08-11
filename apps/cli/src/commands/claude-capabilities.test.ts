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
   * Spec §9.2. With nothing to ask, every answer is `unknown` — never a claim
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
    });
    expect(report.capabilities.skills).toBe("yes");
    expect(report.capabilities.session_end_capture).toBe("wrapper-required");
  });

  it("never reports a lifecycle capability as yes", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
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
   * Spec §8.2: capture falls back to the wrapper whenever
   * `session_end_capture` is not `yes`, and `doctor` reports that rather than
   * failing.
   */
  it("names the wrapper as the capture route", async () => {
    const report = await reportClaudeCapabilities({
      executablePath: "/opt/synthetic/bin/claude",
      runner: version("2.1.216"),
      pluginDirectory: "/synthetic/plugin",
      probe: true,
    });
    expect(report.captureVia).toBe("wrapper");
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
    expect(report.installed).toBe(false);
    expect(new Set(Object.values(report.capabilities))).toEqual(
      new Set(["unknown"]),
    );
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
