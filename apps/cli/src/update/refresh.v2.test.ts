import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { encodeCanonicalJson, EXIT_CODES } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { REFRESH_ARGV, REFRESH_STDIO, REFRESH_TIMEOUT_MS, refreshActiveRelease, refreshEnvironment, refreshExitCode, refreshProcess, runRefreshProcess } from "./refresh.js";

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
    expect(Object.keys(env).sort()).toStrictEqual(["CODEX_HOME", "DEVELOPER_OS_BRAIN", "DEVELOPER_OS_HOME", "HOME"]);
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

  it("(f2) returns exit 6 without spawning when the runtime differs from the bundle manifest", async () => {
    const fixture = await createCommandFixture("refresh-runtime", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleRoot: string };
    const runtime = `${active.bundleRoot}/bin/runtime`;
    const marker = join(fixture.root, "swapped-runtime-ran");
    await nodeFs.chmod(dirname(runtime), 0o700);
    await nodeFs.rm(runtime);
    await nodeFs.writeFile(runtime, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o700 });
    await expect(refreshProcess(fixture.context)).rejects.toMatchObject({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired, paths: [runtime] });
    expect(await refreshActiveRelease(fixture.context)).toBe(EXIT_CODES.recoveryRequired);
    await expect(nodeFs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(g) refuses exit 6 when the active record's bundle root is not the derived release root", async () => {
    const fixture = await createCommandFixture("refresh-root", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    const recordPath = join(fixture.paths.stateDir, "active-release.json");
    const active = JSON.parse(await nodeFs.readFile(recordPath, "utf8")) as { bundleRoot: string; architecture: string };
    await nodeFs.writeFile(recordPath, encodeCanonicalJson({ ...active, bundleRoot: `${fixture.paths.home}/releases/9.9.9/darwin-${active.architecture}` }));
    await expect(refreshProcess(fixture.context)).rejects.toMatchObject({ reason: "active_release_root_mismatch", code: EXIT_CODES.recoveryRequired });
    expect(await refreshActiveRelease(fixture.context)).toBe(EXIT_CODES.recoveryRequired);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(h) refuses an active release built for another architecture than the host", async () => {
    const fixture = await createCommandFixture("refresh-arch", { bootstrapAvailable: true, architecture: process.arch === "x64" ? "arm64" : "x64" });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    expect((await runInit(fixture.context, { dryRun: false, assumeYes: true })).ok).toBe(true);
    expect((await fixture.context.platform.inspect()).architecture).not.toBe((JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { architecture: string }).architecture);
    await expect(refreshProcess(fixture.context)).rejects.toMatchObject({ reason: "active_release_root_mismatch", code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(i) refuses a non-canonical Brain override as the launcher does (exit 2) and passes a valid one through", async () => {
    const bad = await createCommandFixture("refresh-brain", { env: { DEVELOPER_OS_BRAIN: "/synthetic/a/../brain" } });
    expect(() => refreshEnvironment(bad.context)).toThrow(expect.objectContaining({ reason: "brain_override_invalid", code: EXIT_CODES.invalidInput }));
    const good = await createCommandFixture("refresh-brain-ok", { env: { DEVELOPER_OS_BRAIN: "/synthetic/brain" } });
    expect(refreshEnvironment(good.context).DEVELOPER_OS_BRAIN).toBe("/synthetic/brain");
  });

  it("(j) passes the vendor search path on when the parent has a valid one, and drops it otherwise (NEW-202)", async () => {
    const withIt = await createCommandFixture("refresh-vendor", { env: { PATH: "/synthetic/bin", DEVELOPER_OS_VENDOR_SEARCH_PATH: "/opt/homebrew/bin:/usr/bin" } });
    expect(refreshEnvironment(withIt.context)).toStrictEqual({ HOME: withIt.context.userHome, DEVELOPER_OS_HOME: withIt.context.paths.home, DEVELOPER_OS_VENDOR_SEARCH_PATH: "/opt/homebrew/bin:/usr/bin" });
    for (const raw of ["", "/opt/homebrew/bin\0", `/${"a".repeat(32 * 1024)}`]) {
      const fixture = await createCommandFixture("refresh-vendor-bad", { env: { DEVELOPER_OS_VENDOR_SEARCH_PATH: raw } });
      expect(Object.keys(refreshEnvironment(fixture.context)).sort()).toStrictEqual(["DEVELOPER_OS_HOME", "HOME"]);
    }
  });

  it("(k) passes valid vendor homes on, omits absent or empty ones, and refuses an invalid one as the launcher does (exit 2) (NEW-208)", async () => {
    const withThem = await createCommandFixture("refresh-homes", { env: { CODEX_HOME: "/synthetic/codex", CLAUDE_CONFIG_DIR: "/synthetic/claude" } });
    expect(refreshEnvironment(withThem.context)).toStrictEqual({ HOME: withThem.context.userHome, DEVELOPER_OS_HOME: withThem.context.paths.home, CODEX_HOME: "/synthetic/codex", CLAUDE_CONFIG_DIR: "/synthetic/claude" });
    const empty = await createCommandFixture("refresh-homes-empty", { env: { CODEX_HOME: "", CLAUDE_CONFIG_DIR: "" } });
    expect(Object.keys(refreshEnvironment(empty.context)).sort()).toStrictEqual(["DEVELOPER_OS_HOME", "HOME"]);
    for (const variable of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]) {
      for (const raw of ["/synthetic/co\0dex", "relative/codex", "/synthetic/a/../codex", "/synthetic/codex/"]) {
        const bad = { ...empty.context, env: { ...empty.context.env, [variable]: raw } };
        expect(() => refreshEnvironment(bad), `${variable}=${raw}`).toThrow(expect.objectContaining({ reason: "vendor_home_invalid", code: EXIT_CODES.invalidInput, recovery: `unset ${variable} or set a canonical absolute path` }));
      }
    }
  });

  it("(j) kills a refresh that outlives its bound and maps it to exit 1 (K8's bounded timeout)", async () => {
    expect(REFRESH_TIMEOUT_MS).toBe(600_000);
    const fixture = await createCommandFixture("refresh-hang", {});
    const pidFile = join(fixture.root, "hung.pid");
    const started = Date.now();
    const code = await runRefreshProcess({ executable: process.execPath, argv: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`], env: {} }, 500);
    expect(code).toBe(EXIT_CODES.operationalFailure);
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number(await nodeFs.readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
  });
});
