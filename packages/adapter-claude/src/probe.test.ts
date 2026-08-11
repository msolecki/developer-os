import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { probeClaude } from "./probe.js";

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

const installation = { executable: "claude", version: "2.1.216" } as const;
const pluginDirectory = "/synthetic/plugin";

describe("probeClaude", () => {
  it("observes the validate-settled capabilities when validate succeeds", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0, stdout: "OK" })),
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("observed");
    expect(seen.get("plugin_hooks")).toBe("observed");
    expect(seen.get("subagents")).toBe("observed");
  });

  it("marks them absent when validate exits non-zero", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 1, stderr: "bad manifest" })),
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("absent");
  });

  it("marks them unavailable when the runner throws", async () => {
    const seen = await probeClaude(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  it("marks them unavailable when the runner rejects", async () => {
    const seen = await probeClaude(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.reject(new Error("spawn failed"));
        },
      },
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  it("marks a timed-out probe unavailable, not absent", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ timedOut: true, exitCode: null })),
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  /**
   * Named for what it checks. A signal death surfaces in `ProcessResult` as a
   * null exit code, and that null is what this asserts on — `probeClaude` never
   * reads `signal`. The earlier name claimed the signal was the cause, which
   * would have kept passing if signal handling were removed entirely.
   */
  it("marks a probe with no exit code unavailable, not absent", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: null, signal: "SIGKILL" })),
      pluginDirectory,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  /**
   * Spec §6.1: a lifecycle surface is verified only when a hook is *observed to
   * fire*, and a `SessionEnd` hook cannot be made to fire without a real
   * session. `claude plugin validate` settles the manifest and frontmatter; it
   * settles no lifecycle event, and must never be read as if it did.
   */
  it("never records a lifecycle capability as observed", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0 })),
      pluginDirectory,
    });
    for (const lifecycle of [
      "session_start_injection",
      "session_end_capture",
      "pre_compact_backup",
    ]) {
      expect(seen.get(lifecycle), `${lifecycle} must not be observed`).not.toBe(
        "observed",
      );
    }
  });

  it("passes argv as an array and never through a shell", async () => {
    let request: ProcessRequest | null = null;
    await probeClaude(installation, {
      runner: runner((incoming) => {
        request = incoming;
        return { exitCode: 0 };
      }),
      pluginDirectory,
    });
    const seen = request as ProcessRequest | null;
    expect(seen?.args).toEqual(["plugin", "validate", pluginDirectory]);
    expect(seen?.stdin).toBe("");
    expect(seen?.env).toEqual({});
  });

  it("reports a non-empty observation set, so a clean result means something", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0 })),
      pluginDirectory,
    });
    expect(seen.size).toBeGreaterThan(0);
  });
});
