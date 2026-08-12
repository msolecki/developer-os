import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { probeCodex } from "./probe.js";

const installation = { executable: "/opt/synthetic/bin/codex", version: "0.147.0" } as const;
const pluginRoot = "/synthetic/home/.developer-os/codex/plugins/developer-os";

function listing(plugins: unknown): ProcessRunner {
  return {
    run(): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: JSON.stringify(plugins),
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      });
    },
  };
}

describe("probeCodex", () => {
  it("observes skills when our plugin is installed, enabled, at the path we own", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
    expect(probed.enabled).toBe(true);
    expect(probed.resolvedPath).toBe(pluginRoot);
  });

  it("reports absent when the listing contains no plugin of ours", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "somebody-else", status: "enabled", path: "/x" }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
    expect(probed.resolvedPath).toBeNull();
  });

  /**
   * The property the whole install shape was chosen for: a plugin under our
   * name, resolved somewhere we never wrote, is not our tree. Reporting
   * `observed` for it claims we verified an artifact somebody else installed.
   */
  it("reports absent when our name resolves to a path we do not own", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: "/somewhere/else" }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
  });

  it("distinguishes installed-but-disabled from absent", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "disabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.enabled).toBe(false);
    expect(probed.observations.get("skills")).toBe("absent");
  });

  it.each([
    { name: "a non-zero exit", result: { exitCode: 1 } },
    { name: "a timeout", result: { timedOut: true, exitCode: null } },
    { name: "output that is not JSON", result: { stdout: "not json" } },
    { name: "JSON of the wrong shape", result: { stdout: '{"plugins":"nope"}' } },
    { name: "a plugins entry that is not an object", result: { stdout: '{"plugins":[1]}' } },
  ])("reports unavailable, never absent, for $name", async ({ result }) => {
    const probed = await probeCodex(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.resolve({
            stdout: "",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
            ...result,
          });
        },
      },
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("unavailable");
    expect(probed.enabled).toBeNull();
  });

  it("accepts a listing carrying fields we do not know, because it is the vendor's shape", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        schemaVersion: 9,
        plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot, futureField: true }],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
  });

  it("settles nothing about a lifecycle event, which needs a session", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    for (const key of ["session_start_injection", "session_end_capture", "pre_compact_backup"]) {
      expect(probed.observations.has(key), key).toBe(false);
    }
  });

  it("settles nothing about plugin_hooks, which spec §15.1 leaves unobserved", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.observations.has("plugin_hooks")).toBe(false);
  });

  it("passes argv as an array and inherits no environment", async () => {
    let seen: ProcessRequest | null = null;
    await probeCodex(installation, {
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen = request;
          return Promise.resolve({
            stdout: '{"plugins":[]}',
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginRoot,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["plugin", "list", "--json"]);
    expect(request?.env).toEqual({});
  });

  it("reports a non-empty observation set, so a clean result means something", async () => {
    const probed = await probeCodex(installation, { runner: listing({ plugins: [] }), pluginRoot });
    expect(probed.observations.size).toBeGreaterThan(0);
  });
});
