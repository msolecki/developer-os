import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderEntrypoint } from "./entrypoint.js";
import { LOCAL_BUNDLE_CLI_ENTRY } from "./local-release.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function entrypointFor(bundle: string | null): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-entrypoint-")));
  dirs.push(root);
  const bundleRoot = join(root, "bundle");
  if (bundle !== null) {
    await mkdir(dirname(join(bundleRoot, LOCAL_BUNDLE_CLI_ENTRY)), { recursive: true });
    await writeFile(join(bundleRoot, LOCAL_BUNDLE_CLI_ENTRY), bundle);
  }
  const path = join(root, "bin", "developer-os.mjs");
  await mkdir(dirname(path));
  await writeFile(path, renderEntrypoint(bundleRoot));
  return path;
}

const run = (path: string, args: readonly string[]) =>
  spawnSync(process.execPath, [path, ...args], { encoding: "utf8", input: "" });

describe("renderEntrypoint", () => {
  it("runs the active release's CLI with the caller's argv", async () => {
    const path = await entrypointFor("process.stdout.write(process.argv.slice(2).join(' ')); process.exitCode = 7;\n");
    const result = run(path, ["guard", "command", "--vendor", "claude"]);
    expect(result.status).toBe(7);
    expect(result.stdout).toBe("guard command --vendor claude");
  });

  it.each([
    [["guard", "command", "--vendor", "claude"], 2],
    [["guard", "path", "--vendor", "codex"], 2],
    [["guard", "commit", "--vendor", "claude"], 2],
    [["guard", "stop", "--vendor", "claude"], 1],
    [["brain", "status", "--inject", "--vendor", "claude"], 1],
    [["doctor"], 1],
  ])("exits %j -> %i when the active release cannot be loaded", async (args, code) => {
    const path = await entrypointFor(null);
    const result = run(path, args);
    expect(result.status).toBe(code);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("developer-os: the active release could not be loaded\n");
  });
});
