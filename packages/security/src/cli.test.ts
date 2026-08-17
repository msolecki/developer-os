import { describe, expect, it } from "vitest";
import {
  discoverCli,
  parseStructuredPayload,
  screenDerivedPathArgument,
  screenProseArgument,
  screenValueArgument,
} from "./cli.js";
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
   * the worst this truncation can produce is a `yes` where a stricter parse
   * would have produced `unknown`, and only for a capability a probe already
   * observed. (It read `wrapper-required` until DOS-P6 Task 3, which replaced
   * that state with `unknown` throughout.)
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

describe("screenProseArgument", () => {
  /**
   * **The word list is dropped here and only here.** Prose cannot be reread as
   * an option, so the nominal rule buys nothing in this position while refusing
   * text a user did not choose: DOS-P6 puts a redacted capture body in an argv
   * value, and an ordinary error message contains the word `permission`.
   */
  it("permits prose the value screen refuses for naming a permission surface", () => {
    const body = "npm ERR! EACCES: permission denied, open /usr/local/lib";
    expect(screenValueArgument(body, "prompt")).not.toBeNull();
    expect(screenProseArgument(body, "prompt")).toBeNull();
  });

  it("permits the other two words of the list as well", () => {
    for (const body of [
      "the change is dangerous and needs review",
      "we bypass the cache on a cold start",
    ]) {
      expect(screenProseArgument(body, "prompt"), body).toBeNull();
    }
  });

  /**
   * The positional rule is the complete one and stays, so this screen is a
   * narrowing of the other rather than a hole beside it: a prompt that would be
   * reread as an option is still refused.
   */
  it("keeps the leading-dash rule, which is the rule that is complete", () => {
    for (const value of ["--permission-mode=bypassPermissions", "-p", "--add-dir"]) {
      expect(screenProseArgument(value, "prompt"), value).not.toBeNull();
    }
  });

  it("permits an ordinary prompt", () => {
    expect(screenProseArgument("summarise this capture", "prompt")).toBeNull();
  });
});

describe("screenDerivedPathArgument", () => {
  /**
   * **The defect this closes, stated as the user meets it (BACKLOG NEW-12).**
   * `workingRoot` is derived from the user's own `brainPath`, so a vault at
   * `~/Danger/DeveloperBrain` refused every `codex` ingest — forever, under a
   * recovery line telling the user to run `ingest` again.
   */
  it("permits a product-derived path that names a word-list term", () => {
    expect(
      screenDerivedPathArgument("/synthetic/Danger/DeveloperBrain", "the working root"),
    ).toBeNull();
    expect(
      screenValueArgument("/synthetic/Danger/DeveloperBrain", "the working root"),
    ).not.toBeNull();
  });

  it("permits the other two words of the list in a derived path", () => {
    for (const value of [
      "/synthetic/permissions-audit/vault",
      "/synthetic/bypass-notes/vault",
    ]) {
      expect(screenDerivedPathArgument(value, "the working root"), value).toBeNull();
    }
  });

  /**
   * The dash rule is the one that was ever load-bearing here, and it stays: an
   * absolute path cannot begin with `-`, so a value that does is not the path
   * this product derived, whatever produced it.
   */
  it("keeps the leading-dash rule", () => {
    expect(screenDerivedPathArgument("-/synthetic/vault", "the working root")).toBe(
      'the working root may not begin with "-": it would be read as an option, not a value',
    );
  });

  /**
   * **A tripwire on one function's body, and deliberately not more than that.**
   * `screenDerivedPathArgument` is `return screenProseArgument(...)`, so this
   * case holds by construction and cannot fail while that delegation stands.
   * What it catches is somebody giving the derived function a body of its own:
   * it goes red, and they have to say here what diverged and why.
   *
   * **It does not cover the drift direction that actually worries this file**,
   * and saying otherwise would be the exact failure this repository names — a
   * comment promising coverage that does not exist. Add a rule to
   * `screenProseArgument` and both functions change identically, this case
   * stays green, and derived paths silently gain a prose rule. **Only review
   * catches that**, which is why `screenProseArgument`'s own docblock carries
   * the warning rather than relying on a test to raise it.
   */
  it("agrees with screenProseArgument on every input today", () => {
    for (const value of [
      "/synthetic/vault",
      "/synthetic/Danger/DeveloperBrain",
      "-/synthetic/vault",
      "--output-schema",
      "",
      "relative/path",
      "/synthetic/vault with spaces/brain",
    ]) {
      expect(
        screenDerivedPathArgument(value, "the working root"),
        value,
      ).toStrictEqual(screenProseArgument(value, "the working root"));
    }
  });

  /**
   * The guard on the split itself. Narrowing the word list was the fix this row
   * explicitly forbids, because it would weaken the values that do need both
   * rules — so a change that closes NEW-12 by touching the pattern must turn
   * this red rather than pass quietly.
   *
   * **Each sample isolates exactly one alternative, and that is the whole point
   * of the case.** The obvious sample for `bypass` is `bypassPermissions`, and
   * it is useless here: it also contains `Permissions`, so it stays refused
   * with `bypass` deleted from the pattern and the guard passes over its own
   * subject. `bypassApprovals` contains none of the other two. A sample that
   * matches two alternatives tests neither.
   */
  it.each([
    ["permission", "permission-cache"],
    ["danger", "danger-full-access"],
    ["bypass", "bypassApprovals"],
  ])("keeps %s in the word list for values that originate outside", (_word, value) => {
    expect(screenValueArgument(value, "an allowed tool")).toBe(
      "an allowed tool names a permission or bypass surface that is refused in a value position",
    );
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
