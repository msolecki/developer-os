import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { probeCodex } from "./probe.js";

const installation = { executable: "/opt/synthetic/bin/codex", version: "0.147.0" } as const;
const pluginRoot = "/synthetic/home/.developer-os/codex/plugins/developer-os";

/**
 * `codex plugin list --json`'s real top-level shape, per spec §14.4 (Task
 * 17, verified against a real 0.147.0 binary): `{ installed: [...],
 * available: [...] }`, never `{ plugins: [...] }`.
 */
function listing(payload: { installed?: unknown; available?: unknown }): ProcessRunner {
  return {
    run(): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: JSON.stringify(payload),
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
      runner: listing({
        installed: [{ name: "developer-os", enabled: true, source: { path: pluginRoot } }],
        available: [],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
    expect(probed.enabled).toBe(true);
    expect(probed.resolvedPath).toBe(pluginRoot);
  });

  it("reports absent when the listing contains no plugin of ours", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [{ name: "somebody-else", enabled: true, source: { path: "/x" } }],
        available: [],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
    expect(probed.resolvedPath).toBeNull();
  });

  /**
   * The property the whole install shape was chosen for: a plugin under our
   * name, resolved somewhere we never wrote, is not our tree. Reporting
   * `observed` for it claims we verified an artifact somebody else installed.
   * The path that must equal `pluginRoot` is `source.path` — the marketplace
   * source the listing resolves — never the `$CODEX_HOME/plugins/cache/...`
   * copy Codex also stages (spec §14.4); this fixture uses a path shaped
   * like that cache copy to prove the check does not accidentally accept it.
   */
  it("reports absent when our name resolves to a path we do not own", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [
          {
            name: "developer-os",
            enabled: true,
            source: { path: "/synthetic/codex-home/plugins/cache/developer-os/developer-os/0.0.0" },
          },
        ],
        available: [],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
  });

  it("distinguishes installed-but-disabled from absent", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [{ name: "developer-os", enabled: false, source: { path: pluginRoot } }],
        available: [],
      }),
      pluginRoot,
    });
    expect(probed.enabled).toBe(false);
    expect(probed.observations.get("skills")).toBe("absent");
  });

  /**
   * Spec §14.4: `available` lists what a marketplace offers, not what is
   * installed. A plugin under our name sitting only in `available` must not
   * read as installed — the probe must search `installed`, never fall back
   * to `available`.
   */
  it("does not treat a plugin offered but not installed as observed", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [],
        available: [{ name: "developer-os", enabled: true, source: { path: pluginRoot } }],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
    expect(probed.resolvedPath).toBeNull();
  });

  it.each([
    { name: "a non-zero exit", result: { exitCode: 1 } },
    { name: "a timeout", result: { timedOut: true, exitCode: null } },
    { name: "output that is not JSON", result: { stdout: "not json" } },
    { name: "JSON of the wrong shape", result: { stdout: '{"installed":"nope"}' } },
    { name: "an installed entry that is not an object", result: { stdout: '{"installed":[1]}' } },
    { name: "an installed listing missing entirely", result: { stdout: '{"available":[]}' } },
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
        installed: [
          {
            pluginId: "developer-os@developer-os",
            name: "developer-os",
            marketplaceName: "developer-os",
            version: "0.0.0",
            installed: true,
            enabled: true,
            source: { source: "local", path: pluginRoot },
            marketplaceSource: { sourceType: "local", source: "/synthetic/home/.developer-os/codex" },
            installPolicy: "AVAILABLE",
            authPolicy: "ON_INSTALL",
          },
        ],
        available: [],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
  });

  it("settles nothing about a lifecycle event, which needs a session", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [{ name: "developer-os", enabled: true, source: { path: pluginRoot } }],
        available: [],
      }),
      pluginRoot,
    });
    for (const key of ["session_start_injection", "session_end_capture", "pre_compact_backup"]) {
      expect(probed.observations.has(key), key).toBe(false);
    }
  });

  it("settles nothing about plugin_hooks, which spec §15.1 leaves unobserved", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        installed: [{ name: "developer-os", enabled: true, source: { path: pluginRoot } }],
        available: [],
      }),
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
            stdout: '{"installed":[],"available":[]}',
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
    const probed = await probeCodex(installation, {
      runner: listing({ installed: [], available: [] }),
      pluginRoot,
    });
    expect(probed.observations.size).toBeGreaterThan(0);
  });
});
