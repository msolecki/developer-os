import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { discoverClaude } from "./discover.js";

const CLAUDE = "/opt/synthetic/bin/claude";

/**
 * The exhaustive discovery battery — never-throw cases, the timeout, the
 * argv/`env: {}`/`stdin` shape — moved to `packages/security/src/cli.test.ts`
 * (Task 3.5), because `discoverClaude` is now `discoverCli` with no
 * Claude-specific behaviour of its own. This is the one test left here: that
 * the binding actually wires through.
 */
describe("discoverClaude", () => {
  it("is discoverCli bound to Claude, reading the version from --version output", async () => {
    const runner: ProcessRunner = {
      run(request: ProcessRequest): Promise<ProcessResult> {
        void request;
        return Promise.resolve({
          stdout: "2.1.216 (Claude Code)\n",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
        });
      },
    };
    const found = await discoverClaude({ runner, executable: CLAUDE });
    expect(found).toEqual({ executable: CLAUDE, version: "2.1.216" });
  });
});
