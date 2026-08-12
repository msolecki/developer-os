import { describe, expect, it } from "vitest";
import { discoverCli, parseStructuredPayload, screenValueArgument } from "./cli.js";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "./process.js";

const EXECUTABLE = "/opt/synthetic/bin/vendor-cli";

/**
 * Fake runners are written non-`async` and return a resolved promise, to keep
 * `@typescript-eslint/require-await` from refusing an `async` method with
 * nothing to await — every fake here would be exactly that.
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

describe("discoverCli", () => {
  it("reads the version from --version output", async () => {
    const found = await discoverCli({
      runner: runnerReturning({ stdout: "2.1.216 (vendor cli)\n" }),
      executable: EXECUTABLE,
    });
    expect(found).toEqual({ executable: EXECUTABLE, version: "2.1.216" });
  });

  it("returns null when the binary is absent", async () => {
    const found = await discoverCli({
      runner: runnerReturning({ exitCode: 127, stdout: "" }),
      executable: EXECUTABLE,
    });
    expect(found).toBeNull();
  });

  it("returns null rather than throwing when the version is unparseable", async () => {
    const found = await discoverCli({
      runner: runnerReturning({ stdout: "not a version" }),
      executable: EXECUTABLE,
    });
    expect(found).toBeNull();
  });

  it("returns null when the runner throws", async () => {
    const found = await discoverCli({
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      executable: EXECUTABLE,
    });
    expect(found).toBeNull();
  });

  it("returns null when the runner rejects", async () => {
    const found = await discoverCli({
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.reject(new Error("spawn failed"));
        },
      },
      executable: EXECUTABLE,
    });
    expect(found).toBeNull();
  });

  it("returns null when the probe times out", async () => {
    const found = await discoverCli({
      runner: runnerReturning({ timedOut: true, exitCode: null }),
      executable: EXECUTABLE,
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
    const found = await discoverCli({
      runner: runnerReturning({ stdout: "2.1.216-rc.1 (vendor cli)\n" }),
      executable: EXECUTABLE,
    });
    expect(found).toEqual({ executable: EXECUTABLE, version: "2.1.216" });
  });

  /**
   * Regression, found by fresh-context review on 2026-08-11.
   *
   * `assertSafeCommand` refuses any non-absolute executable outright, and the
   * request is built with `env: {}` so a child has no `PATH` to resolve a bare
   * name against. Passing a bare command name therefore fails against the real
   * runner on a machine that *has* the vendor CLI installed — reported as "no
   * installation", after which every capability degrades to wrapper or unknown
   * permanently. Every test used a fake runner that happily accepted a bare
   * name, so nothing could catch it.
   */
  it("refuses a non-absolute executable rather than spawning one", async () => {
    for (const bare of ["vendor-cli", "./vendor-cli", "bin/vendor-cli", ""]) {
      const found = await discoverCli({
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
    await discoverCli({
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
      executable: EXECUTABLE,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["--version"]);
    expect(request?.stdin).toBe("");
    expect(request?.env).toEqual({});
  });
});

describe("screenValueArgument", () => {
  /**
   * The version of this test that shipped in `adapter-claude` asserted only
   * that three exact strings were absent, which is why the hole below shipped
   * with it: a denylist of literals is defeated by `--opt=value`, and the test
   * could not go red for the property its own name claimed. It now asserts the
   * property.
   */
  it("refuses a value that would be read as an option, not a value", () => {
    const hostile = [
      "--permission-mode=bypassPermissions",
      "--dangerously-skip-permissions=true",
      "--add-dir",
      "--mcp-config",
      "-p",
    ];
    for (const value of hostile) {
      expect(
        screenValueArgument(value, "an allowed tool"),
        `${value} must be refused`,
      ).not.toBeNull();
    }
  });

  it("refuses a value naming a permission surface even without a leading dash", () => {
    expect(screenValueArgument("bypassPermissions", "an allowed tool")).not
      .toBeNull();
  });

  it("permits an ordinary value", () => {
    expect(screenValueArgument("Read", "an allowed tool")).toBeNull();
    expect(screenValueArgument("summarise", "prompt")).toBeNull();
  });

  /**
   * Decision 3 above widens the regex from `/permission|dangerous/iu` to
   * `/permission|danger|bypass/iu`, strictly wider than what shipped. These
   * two cases are the reason, and each **fails against the old pattern**:
   * `danger-full-access` contains `danger` but not the full word `dangerous`,
   * and `permit-bypass-route` contains `bypass` but not `permission` — so the
   * old regex matched neither, and the old `screenValueArgument` would have
   * permitted both.
   */
  it("refuses danger-full-access in a value position", () => {
    expect(screenValueArgument("danger-full-access", "an allowed tool")).not
      .toBeNull();
  });

  it("refuses a value containing bypass", () => {
    expect(screenValueArgument("permit-bypass-route", "an allowed tool")).not
      .toBeNull();
  });

  /**
   * Unlike the two cases above, these are refused under the **old** code too
   * — `dangerously` contains `dangerous`, and both begin with `-`, so the
   * leading-dash rule alone already caught them. Included for completeness:
   * all three real vendor flags decision 3 names are covered, whichever
   * mechanism does it. Pinned together so an edit to the dash rule cannot
   * regress one of the three unnoticed because only the other two were
   * asserted.
   */
  it("refuses --dangerously-bypass-approvals-and-sandbox, --dangerously-bypass-hook-trust and --ignore-user-config via the leading-dash rule", () => {
    for (const flag of [
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "--ignore-user-config",
    ]) {
      expect(
        screenValueArgument(flag, "an allowed tool"),
        `${flag} must be refused`,
      ).not.toBeNull();
    }
  });
});

describe("parseStructuredPayload", () => {
  it("returns the parsed payload on success", () => {
    expect(parseStructuredPayload('{"result":"done"}')).toEqual({
      ok: true,
      payload: { result: "done" },
    });
  });

  it("reports malformed output as a failure, never a best-effort parse", () => {
    expect(parseStructuredPayload("not json at all")).toEqual({
      ok: false,
      reason: "malformed-output",
    });
  });

  /**
   * A JSON payload whose top level is `__proto__` must not reach a consumer as
   * a prototype mutation. `JSON.parse` does not pollute by itself, but anything
   * that later spreads or merges the payload would.
   */
  it("refuses a payload carrying a reserved key", () => {
    expect(
      parseStructuredPayload('{"__proto__":{"polluted":true},"result":"x"}'),
    ).toEqual({ ok: false, reason: "malformed-output" });
  });
});
