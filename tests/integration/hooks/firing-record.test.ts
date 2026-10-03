import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../../helpers/run-cli.js";
import { createTempHome, removeTempHome } from "../../helpers/temp-home.js";
import type { TempHome } from "../../helpers/temp-home.js";

/**
 * NEW-139: `bin.ts` exits explicitly after a hook (NEW-115), which killed the fire-and-forget firing
 * record write, so `doctor` read every hook as `never`. These run the compiled binary as a vendor does.
 */
const PAYLOAD = JSON.stringify({
  session_id: "synthetic",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "ls" },
  cwd: "/Users/synthetic",
});
const ARGS = ["guard", "command", "--vendor", "claude"] as const;

let home: TempHome;
let hooks: string;

beforeEach(async () => {
  home = await createTempHome();
  hooks = join(home.productHome, "state", "hooks");
  await mkdir(hooks, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  await removeTempHome(home);
});

describe("a hook run through the compiled binary", () => {
  it("leaves its firing record once the process has exited", async () => {
    const run = await runCli(home, ARGS, { stdin: PAYLOAD, timeoutMs: 10_000 });
    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(0);
    expect(await readdir(hooks)).toStrictEqual(["claude.command.json"]);
  });

  it("exits when a FIFO stands in place of the record", async () => {
    // Without O_NONBLOCK, opening a FIFO with no writer parks a libuv worker and `process.exit()` waits on it;
    // the bounded wait cannot help there, so this pins the open flags. The bound itself is unit-tested.
    execFileSync("/usr/bin/mkfifo", [join(hooks, "claude.command.json")]);
    const run = await runCli(home, ARGS, { stdin: PAYLOAD, timeoutMs: 10_000 });
    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
  });

  it("writes nothing, with the same exit code and stdout, when admission refuses the write", async () => {
    // A declared V2 manifest that is not one: `assertOrdinaryCommandAdmitted` refuses the record write.
    await writeFile(join(home.productHome, "installation-manifest.json"), '{"schemaVersion":2}', { mode: 0o600 });
    const run = await runCli(home, ARGS, { stdin: PAYLOAD, timeoutMs: 10_000 });
    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(await readdir(hooks)).toStrictEqual([]);
  });
});
