import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import { LOCAL_BUNDLE_CLI_ENTRY } from "@developer-os/cli/dist/update/local-release.js";
import { admitUnsignedLocalPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { isDependencyRuntimeFile, isWorkspaceRuntimeFile, pack, RUNTIME_PACKAGES } from "./pack-local-release.js";

/** This file is `tests/tools/…`, whether run from source or from `tests/dist/tools/…`'s sibling. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPTIONS = { workingDirectory: REPOSITORY_ROOT, repositoryRoot: REPOSITORY_ROOT };

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-pack-")));
  roots.push(root);
  return root;
}

/** Relative path → mode and content digest, for every regular file under `root`. */
async function tree(root: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    files.set(relative(root, path), `${((await stat(path)).mode & 0o777).toString(8)}:${digest}`);
  }
  return files;
}

describe("runtime file selection", () => {
  it("keeps compiled workspace JavaScript and drops declarations, maps, tests and test helpers", () => {
    expect(isWorkspaceRuntimeFile("bin.js")).toBe(true);
    expect(isWorkspaceRuntimeFile("commands/init.js")).toBe(true);
    for (const path of ["bin.d.ts", "bin.js.map", "commands/init.test.js", "commands/testing.js", "lifecycle/testing.js"]) {
      expect(isWorkspaceRuntimeFile(path), path).toBe(false);
    }
  });

  it("keeps what import resolution reaches in a dependency, and its licence", () => {
    for (const path of ["LICENSE", "LICENSE.md", "package.json", "v4/package.json", "index.js", "dist/index.mjs", "bin.mjs"]) {
      expect(isDependencyRuntimeFile(path), path).toBe(true);
    }
    for (const path of ["index.cjs", "index.d.ts", "index.d.cts", "v4/index.d.mts", "browser/index.js", "README.md", "src/index.ts", "dist/index.js.map", "docs/LICENSE"]) {
      expect(isDependencyRuntimeFile(path), path).toBe(false);
    }
  });
});

describe("pack (D53: a launchable local release)", () => {
  it("packs every workspace runtime package and its dependencies, and nothing a runtime does not load", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const files = [...(await tree(join(out, "bundle"))).keys()];

    expect(files).toContain(LOCAL_BUNDLE_CLI_ENTRY);
    for (const name of RUNTIME_PACKAGES.keys()) {
      expect(files, name).toContain(`node_modules/@developer-os/${name}/package.json`);
      expect(files.some((path) => path.startsWith(`node_modules/@developer-os/${name}/dist/`) && path.endsWith(".js")), name).toBe(true);
    }
    for (const dependency of ["zod", "yaml", "smol-toml"]) {
      expect(files, dependency).toContain(`node_modules/${dependency}/package.json`);
      expect(files, dependency).toContain(`node_modules/${dependency}/LICENSE`);
    }
    const unwanted = files.filter((path) =>
      /\.d\.[cm]?ts$|\.map$|\.test\.js$|\.cjs$|\/testing\.js$|\/src\//u.test(path) ||
      path.startsWith("node_modules/yaml/browser/") ||
      path === "bin/developer-os");
    expect(unwanted).toStrictEqual([]);
    expect(files).toContain("workflows/capture/workflow.yaml");
    expect(files).toContain("instructions/catalog.json");

    const modes = new Set([...(await tree(out)).values()].map((value) => value.split(":")[0]));
    expect(modes).toStrictEqual(new Set(["600"]));
    await expect(admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION)).resolves.toBeDefined();
  });

  it("packs byte-identical releases from the same checkout", async () => {
    const root = await temporary();
    const first = await tree(await pack(join(root, "a"), OPTIONS));
    const second = await tree(await pack(join(root, "b"), OPTIONS));
    expect(first.size).toBeGreaterThan(0);
    expect(second).toStrictEqual(first);
  });

  it("packs a CLI that runs from the bundle alone", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const home = join(root, "home");
    await mkdir(home, { mode: 0o700 });

    const result = spawnSync(process.execPath, [join(out, "bundle", LOCAL_BUNDLE_CLI_ENTRY), "status"], {
      cwd: "/",
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("product home");
  });
});
