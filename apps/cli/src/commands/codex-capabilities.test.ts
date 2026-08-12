import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { CODEX_CAPABILITY_KEYS } from "@developer-os/adapter-codex";
import { reportCodexCapabilities } from "./codex-capabilities.js";

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

/** A `codex plugin list --json` response naming our plugin, resolved at `pluginRoot`. */
const ourTreeAt = (pluginRoot: string) =>
  runner((request) => {
    if (request.args[0] === "--version") return { stdout: "codex-cli 0.147.0" };
    if (request.args[0] === "plugin" && request.args[1] === "list") {
      return {
        stdout: JSON.stringify({
          plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }],
        }),
      };
    }
    return { exitCode: 0 };
  });

describe("reportCodexCapabilities", () => {
  it("reports rather than refusing when nothing is installed", async () => {
    const report = await reportCodexCapabilities({
      executablePath: null,
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.installed).toBe(false);
    expect(new Set(Object.values(report.capabilities))).toEqual(new Set(["unknown"]));
  });

  it("distinguishes a present-but-unreadable binary from an absent one", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: runner(() => ({ exitCode: 97 })),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("codex=unreadable");
    expect(report.summary).not.toContain("codex=absent");
  });

  /** Spec §5.3: the fix is one command, and a report that omits it is not a report. */
  it("names the command that grants hook trust", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(report.captureVia).toBe("wrapper");
    expect(report.recovery).toContain("/hooks");
  });

  it("reports every capability key, so the matrix is complete", async () => {
    const report = await reportCodexCapabilities({
      executablePath: null,
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(Object.keys(report.capabilities)).toHaveLength(9);
  });

  it("does not probe unless asked, because the probe spawns the vendor's CLI", async () => {
    let spawned = false;
    await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: runner((request) => {
        if (request.args[0] === "plugin") spawned = true;
        return { stdout: "codex-cli 0.147.0" };
      }),
      pluginRoot: "/synthetic/plugin",
    });
    expect(spawned).toBe(false);
  });

  it("reads the version from a real executable path", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.version).toBe("0.147.0");
  });

  it("reports unreadable rather than absent when the version cannot be parsed", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: version("not a version at all"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("codex=unreadable");
  });

  it("never throws when the runner fails outright", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.installed).toBe(true);
    expect(report.summary).toContain("codex=unreadable");
    expect(new Set(Object.values(report.capabilities))).toEqual(new Set(["unknown"]));
  });

  it("reports every capability as unknown when it did not probe", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.summary).toContain("not-probed");
    expect(new Set(Object.values(report.capabilities))).toEqual(new Set(["unknown"]));
  });

  it("earns yes for skills only when the probe observes our tree, enabled, at the plugin root", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: ourTreeAt("/synthetic/plugin"),
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(report.capabilities.skills).toBe("yes");
  });

  it("does not report yes when the resolved path is not the tree we own", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: ourTreeAt("/somewhere/else"),
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(report.capabilities.skills).toBe("wrapper-required");
  });

  /**
   * `plugin_hooks` is UNSETTLED (spec §15.1: the plugin-bundled hooks path is
   * documented but unobserved) and must report `unknown` regardless of what the
   * probe observed for anything else.
   */
  it("reports plugin_hooks as unknown even when the probe observes our tree", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: ourTreeAt("/synthetic/plugin"),
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(report.capabilities.plugin_hooks).toBe("unknown");
  });

  it("renders a matrix line naming every key", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    for (const key of CODEX_CAPABILITY_KEYS) {
      expect(report.summary, `${key} must appear`).toContain(key);
    }
  });

  it("names the wrapper as the capture route even once probed", async () => {
    const report = await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: ourTreeAt("/synthetic/plugin"),
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(report.captureVia).toBe("wrapper");
  });

  it("carries the hook-trust recovery even when nothing is installed", async () => {
    const report = await reportCodexCapabilities({
      executablePath: null,
      runner: version("codex-cli 0.147.0"),
      pluginRoot: "/synthetic/plugin",
    });
    expect(report.recovery).toContain("/hooks");
  });
});

describe("the probe is opt-in", () => {
  it("does not spawn plugin list unless asked", async () => {
    const seen: string[][] = [];
    await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen.push([...request.args]);
          return Promise.resolve({
            stdout: "codex-cli 0.147.0",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginRoot: "/synthetic/plugin",
    });
    expect(seen).toEqual([["--version"]]);
  });

  it("spawns plugin list only when asked", async () => {
    const seen: string[][] = [];
    await reportCodexCapabilities({
      executablePath: "/opt/synthetic/bin/codex",
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen.push([...request.args]);
          return Promise.resolve({
            stdout: request.args[0] === "--version"
              ? "codex-cli 0.147.0"
              : '{"plugins":[]}',
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginRoot: "/synthetic/plugin",
      probe: true,
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(["plugin", "list", "--json"]);
  });
});
