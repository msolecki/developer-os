import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { discoverCodex } from "./discover.js";

function runner(handler: (request: ProcessRequest) => Partial<ProcessResult>): ProcessRunner {
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

const executable = "/opt/synthetic/bin/codex";

/**
 * The full never-throw battery — every failure mode, the timeout — lives in
 * `packages/security/src/cli.test.ts` (Task 3.5), because `discoverCodex` is
 * now `discoverCli` with no Codex-specific behaviour of its own. Kept here,
 * to pin that this really is that binding: the two version-format cases,
 * one failure case, and the argv shape.
 */
describe("discoverCodex", () => {
  it("reads the version out of the vendor's own format", async () => {
    expect(
      await discoverCodex({ runner: runner(() => ({ stdout: "codex-cli 0.147.0\n" })), executable }),
    ).toEqual({ executable, version: "0.147.0" });
  });

  /**
   * Inherited from DOS-P4 and deliberate: the pattern matches a version
   * *inside* the line, so `codex-cli 0.148.0-rc.1` reads as `0.148.0`. A
   * pre-release is its release triple for floor purposes, and
   * `packages/security/src/cli.test.ts` records why. Do not fork it.
   */
  it("reads a pre-release as its release triple, as the Claude adapter does", async () => {
    expect(
      await discoverCodex({
        runner: runner(() => ({ stdout: "codex-cli 0.148.0-rc.1" })),
        executable,
      }),
    ).toEqual({ executable, version: "0.148.0" });
  });

  it("never throws when the runner itself fails", async () => {
    expect(
      await discoverCodex({
        runner: {
          run(): Promise<ProcessResult> {
            throw new Error("spawn failed");
          },
        },
        executable,
      }),
    ).toBeNull();
  });

  /**
   * Named for what it checks. `ProcessRequest` has no shell field, so "never
   * runs through a shell" is `NodeProcessRunner`'s property, not this one's —
   * what this pins is the argv array and the empty environment.
   */
  it("passes argv as an array with an empty environment", async () => {
    let seen: ProcessRequest | null = null;
    await discoverCodex({
      runner: runner((request) => {
        seen = request;
        return { stdout: "codex-cli 0.147.0" };
      }),
      executable,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["--version"]);
    expect(request?.env).toEqual({});
    expect(request?.stdin).toBe("");
  });
});
