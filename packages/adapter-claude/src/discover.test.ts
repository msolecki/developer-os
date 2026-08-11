import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { discoverClaude } from "./discover.js";

/**
 * Fake runners are written non-`async` and return a resolved promise. There is
 * no prior convention in this repository — `packages/security` tests the real
 * `NodeProcessRunner` — and `@typescript-eslint/require-await` refuses an
 * `async` method with nothing to await, which every fake here would be.
 */
function runnerReturning(result: Partial<ProcessResult>): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      void request;
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...result,
      });
    },
  };
}

describe("discoverClaude", () => {
  it("reads the version from --version output", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ stdout: "2.1.216 (Claude Code)\n" }),
      executable: "claude",
    });
    expect(found).toEqual({ executable: "claude", version: "2.1.216" });
  });

  it("returns null when the binary is absent", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ exitCode: 127, stdout: "" }),
      executable: "claude",
    });
    expect(found).toBeNull();
  });

  it("returns null rather than throwing when the version is unparseable", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ stdout: "not a version" }),
      executable: "claude",
    });
    expect(found).toBeNull();
  });

  it("returns null when the runner throws", async () => {
    const found = await discoverClaude({
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      executable: "claude",
    });
    expect(found).toBeNull();
  });

  it("returns null when the runner rejects", async () => {
    const found = await discoverClaude({
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.reject(new Error("spawn failed"));
        },
      },
      executable: "claude",
    });
    expect(found).toBeNull();
  });

  it("returns null when the probe times out", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ timedOut: true, exitCode: null }),
      executable: "claude",
    });
    expect(found).toBeNull();
  });

  /**
   * A pre-release reports as its release triple, and that is safe **only
   * because of the capability model**, not because the two are equivalent.
   * `2.1.216-rc.1` may lack what `2.1.216` ships, so granting it the release's
   * documented floor would be a lie — except that a floor never earns a `yes`
   * on its own (spec §5.1). The probe still has to observe every capability, so
   * the worst this truncation can produce is a `wrapper-required` where a
   * stricter parse would have produced `unknown`.
   *
   * If the table is ever allowed to grant a capability without a probe, this
   * test must be revisited in the same change.
   */
  it("reads a pre-release as its release triple", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ stdout: "2.1.216-rc.1 (Claude Code)\n" }),
      executable: "claude",
    });
    expect(found).toEqual({ executable: "claude", version: "2.1.216" });
  });

  it("never runs through a shell", async () => {
    let seen: ProcessRequest | null = null;
    await discoverClaude({
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen = request;
          return Promise.resolve({
            stdout: "2.1.216",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      executable: "claude",
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["--version"]);
    expect(request?.stdin).toBe("");
    expect(request?.env).toEqual({});
  });
});
