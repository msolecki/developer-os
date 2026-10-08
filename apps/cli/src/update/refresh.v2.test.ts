import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { REFRESH_ARGV, REFRESH_STDIO, refreshActiveRelease, refreshEnvironment, refreshExitCode, refreshProcess, runRefreshProcess } from "./refresh.js";

afterAll(removeCommandFixtures);

/** A runtime stub the kernel runs directly (no shell adds PWD or SHLVL): records argv and env, writes stdout, exits `code`. */
async function stub(dir: string, code: number): Promise<{ readonly executable: string; readonly record: string }> {
  const executable = join(dir, `runtime-${String(code)}`);
  const record = join(dir, `record-${String(code)}.json`);
  await nodeFs.writeFile(executable, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.stdout.write("noise\\n");\nprocess.exitCode = ${String(code)};\n`, { mode: 0o700 });
  return { executable, record };
}

describe("the K8 refresh process", () => {
  it.each([[0, 0], [1, 1], [3, 3], [6, 6], [7, 1], [127, 1], [null, 1]] as const)("(a) maps child exit %s to %s", (code, expected) => {
    expect(refreshExitCode(code)).toBe(expected);
  });

  it("(b) passes argv and exactly the launcher's closed environment, and returns the child's code", async () => {
    const fixture = await createCommandFixture("refresh-spawn", { env: { PATH: "/synthetic/bin", DEVELOPER_OS_BRAIN: "/synthetic/brain", CODEX_HOME: "/synthetic/codex" } });
    const { executable, record } = await stub(fixture.root, 3);
    const env = refreshEnvironment(fixture.context);
    expect(Object.keys(env).sort()).toStrictEqual(["DEVELOPER_OS_BRAIN", "DEVELOPER_OS_HOME", "HOME"]);
    expect(await runRefreshProcess({ executable, argv: ["/synthetic/home/bin/developer-os.mjs", ...REFRESH_ARGV], env })).toBe(EXIT_CODES.decisionRequired);
    const seen = JSON.parse(await nodeFs.readFile(record, "utf8")) as { argv: string[]; env: Record<string, string> };
    expect(seen.argv).toStrictEqual(["/synthetic/home/bin/developer-os.mjs", "init"]);
    // macOS adds __CF_USER_TEXT_ENCODING to every exec'd process; it is not ours.
    expect(Object.fromEntries(Object.entries(seen.env).filter(([key]) => key !== "__CF_USER_TEXT_ENCODING"))).toStrictEqual(env);
    expect(Object.keys(refreshEnvironment((await createCommandFixture("refresh-env", {})).context)).sort()).toStrictEqual(["DEVELOPER_OS_HOME", "HOME"]);
  });

  it("(c) never lets the child write to the parent's stdout", async () => {
    expect(REFRESH_STDIO).toStrictEqual(["ignore", "ignore", "inherit"]);
    const fixture = await createCommandFixture("refresh-stdout", {});
    const { executable } = await stub(fixture.root, 0);
    const module = new URL("../../dist/update/refresh.js", import.meta.url).href;
    const parent = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const m = await import(${JSON.stringify(module)}); process.stdout.write("parent:" + String(await m.runRefreshProcess({ executable: ${JSON.stringify(executable)}, argv: [], env: {} })));`], { encoding: "utf8" });
    expect(parent.stdout).toBe("parent:0");
  });

  it("(d) maps a missing runtime to exit 1, never success", async () => {
    expect(await runRefreshProcess({ executable: "/synthetic/absent/runtime", argv: [], env: {} })).toBe(EXIT_CODES.operationalFailure);
  });

  it("(e) execs the active release's runtime on the version-free entrypoint, never process.execPath", async () => {
    const fixture = await createCommandFixture("refresh-process", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleRoot: string };
    const spawned = await refreshProcess(fixture.context);
    expect(spawned.executable).toBe(`${active.bundleRoot}/bin/runtime`);
    expect(spawned.executable).not.toBe(process.execPath);
    expect(spawned.argv).toStrictEqual([join(fixture.paths.home, "bin", "developer-os.mjs"), "init"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(f) returns exit 6 without spawning when the retained bundle manifest is altered", async () => {
    const fixture = await createCommandFixture("refresh-invalid", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleManifestHash: string };
    await nodeFs.appendFile(join(fixture.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`), " ");
    expect(await refreshActiveRelease(fixture.context)).toBe(EXIT_CODES.recoveryRequired);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
