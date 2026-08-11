import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { discoverClaude, resolveExecutable } from "./discover.js";

const CLAUDE = "/opt/synthetic/bin/claude";

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
      executable: CLAUDE,
    });
    expect(found).toEqual({ executable: CLAUDE, version: "2.1.216" });
  });

  it("returns null when the binary is absent", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ exitCode: 127, stdout: "" }),
      executable: CLAUDE,
    });
    expect(found).toBeNull();
  });

  it("returns null rather than throwing when the version is unparseable", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ stdout: "not a version" }),
      executable: CLAUDE,
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
      executable: CLAUDE,
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
      executable: CLAUDE,
    });
    expect(found).toBeNull();
  });

  it("returns null when the probe times out", async () => {
    const found = await discoverClaude({
      runner: runnerReturning({ timedOut: true, exitCode: null }),
      executable: CLAUDE,
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
      executable: CLAUDE,
    });
    expect(found).toEqual({ executable: CLAUDE, version: "2.1.216" });
  });

  /**
   * Regression, found by fresh-context review on 2026-08-11.
   *
   * `assertSafeCommand` refuses any non-absolute executable outright, and the
   * request is built with `env: {}` so a child has no `PATH` to resolve a bare
   * name against. Passing `"claude"` therefore fails against the real runner on
   * a machine that *has* Claude Code — reported as "no installation", after
   * which every capability degrades to wrapper or unknown permanently. Every
   * test used a fake runner that happily accepted a bare name, so nothing could
   * catch it.
   */
  it("refuses a non-absolute executable rather than spawning one", async () => {
    for (const bare of ["claude", "./claude", "bin/claude", ""]) {
      const found = await discoverClaude({
        runner: runnerReturning({ stdout: "2.1.216" }),
        executable: bare,
      });
      expect(found, `${JSON.stringify(bare)} must be refused`).toBeNull();
    }
  });

  /**
   * Named for what it checks. `ProcessRequest` has no shell field, so "never
   * runs through a shell" is `NodeProcessRunner`'s property, not this one's —
   * what this pins is the argv array and the empty environment.
   */
  it("passes argv as an array with an empty environment", async () => {
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
      executable: CLAUDE,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["--version"]);
    expect(request?.stdin).toBe("");
    expect(request?.env).toEqual({});
  });
});

/**
 * Resolution is a separate concern from discovery, and it exists because
 * `discoverClaude` requires an absolute path. Without it nothing in this
 * package could ever find a real installation, which is the defect the review
 * caught.
 */
describe("resolveExecutable", () => {
  const isExecutable = (allowed: readonly string[]) => (candidate: string) =>
    Promise.resolve(allowed.includes(candidate));

  it("returns the first PATH entry that holds an executable", async () => {
    const found = await resolveExecutable("claude", {
      pathValue: "/a:/b:/c",
      isExecutable: isExecutable(["/b/claude", "/c/claude"]),
    });
    expect(found).toBe("/b/claude");
  });

  it("returns null when no entry holds it", async () => {
    const found = await resolveExecutable("claude", {
      pathValue: "/a:/b",
      isExecutable: isExecutable([]),
    });
    expect(found).toBeNull();
  });

  it("returns null for an empty PATH rather than searching the whole filesystem", async () => {
    const found = await resolveExecutable("claude", {
      pathValue: "",
      isExecutable: isExecutable(["/claude"]),
    });
    expect(found).toBeNull();
  });

  it("returns an absolute path already given, without searching", async () => {
    let searched = false;
    const found = await resolveExecutable("/opt/bin/claude", {
      pathValue: "/a",
      isExecutable: (candidate) => {
        searched = true;
        return Promise.resolve(candidate === "/opt/bin/claude");
      },
    });
    expect(found).toBe("/opt/bin/claude");
    expect(searched).toBe(true);
  });

  /** A name with a separator is not a name to look up on PATH. */
  it("refuses a relative name containing a separator", async () => {
    const found = await resolveExecutable("../claude", {
      pathValue: "/a",
      isExecutable: isExecutable(["/a/../claude"]),
    });
    expect(found).toBeNull();
  });

  it("skips a relative PATH entry rather than resolving against the cwd", async () => {
    const found = await resolveExecutable("claude", {
      pathValue: "relative:/b",
      isExecutable: isExecutable(["relative/claude", "/b/claude"]),
    });
    expect(found).toBe("/b/claude");
  });
});
