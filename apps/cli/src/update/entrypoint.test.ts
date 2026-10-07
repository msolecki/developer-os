import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderEntrypoint } from "./entrypoint.js";
import { LOCAL_BUNDLE_CLI_ENTRY } from "./local-release.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A home with `bin/developer-os.mjs`, and (unless `bundle` is null) an active record, retained manifest and bundle. */
async function entrypointHome(
  bundle: string | null,
  manifest: Record<string, unknown> = {},
  entry: string = LOCAL_BUNDLE_CLI_ENTRY,
): Promise<{ readonly entrypoint: string; readonly root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-entrypoint-")));
  dirs.push(root);
  const bundleRoot = join(root, "bundle");
  const entrypoint = join(root, "bin", "developer-os.mjs");
  await mkdir(dirname(entrypoint));
  await writeFile(entrypoint, renderEntrypoint());
  if (bundle !== null) {
    await mkdir(dirname(join(bundleRoot, entry)), { recursive: true });
    await writeFile(join(bundleRoot, entry), bundle);
    const manifestBytes = JSON.stringify({ schemaVersion: 1, ...manifest });
    const bundleManifestHash = createHash("sha256").update(manifestBytes).digest("hex");
    await mkdir(join(root, "state", "release-metadata", "bundles"), { recursive: true });
    await writeFile(join(root, "state", "release-metadata", "bundles", `${bundleManifestHash}.json`), manifestBytes);
    await writeFile(join(root, "state", "active-release.json"), JSON.stringify({ bundleManifestHash, bundleRoot }));
  }
  return { entrypoint, root };
}

const entrypointFor = async (bundle: string | null): Promise<string> => (await entrypointHome(bundle)).entrypoint;

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

  it("renders one release-independent entrypoint (NEW-163 B)", () => {
    expect(renderEntrypoint()).toEqual(renderEntrypoint());
    expect(new TextDecoder().decode(renderEntrypoint())).toContain("active-release.json");
  });

  it("loads the CLI the active record's bundle manifest names, and refuses a traversing or tampered one", async () => {
    const named = await entrypointHome('process.stdout.write("loaded\\n");\n', { entrypoint: "cli/main.mjs" }, "cli/main.mjs");
    expect(run(named.entrypoint, ["--version"])).toMatchObject({ status: 0, stdout: "loaded\n" });

    const traversing = await entrypointHome('process.stdout.write("escaped\\n");\n', { entrypoint: "../escape.mjs" }, "escape.mjs");
    expect(run(traversing.entrypoint, ["guard", "command"])).toMatchObject({ status: 2, stdout: "" });

    const tampered = await entrypointHome('process.stdout.write("loaded\\n");\n');
    const metadata = join(tampered.root, "state", "release-metadata", "bundles");
    const [name] = await readdir(metadata);
    await writeFile(join(metadata, name as string), JSON.stringify({ schemaVersion: 1, entrypoint: "other.mjs" }));
    expect(run(tampered.entrypoint, ["guard", "path"])).toMatchObject({ status: 2, stdout: "" });
  });

  it("refuses a group-writable active record", async () => {
    const home = await entrypointHome('process.stdout.write("loaded\\n");\n');
    await chmod(join(home.root, "state", "active-release.json"), 0o664);
    expect(run(home.entrypoint, ["guard", "commit"])).toMatchObject({ status: 2, stdout: "" });
  });
});
