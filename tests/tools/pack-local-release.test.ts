import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import { LOCAL_BUNDLE_CLI_ENTRY } from "@developer-os/cli/dist/update/local-release.js";
import { admitUnsignedLocalPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { collectTree, pack, THIRD_PARTY_LICENSES, thirdPartyPackageDirectory } from "./pack-local-release.js";

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

describe("release trees", () => {
  function git(root: string, ...args: string[]): void {
    const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }

  async function checkout(): Promise<string> {
    const root = await temporary();
    git(root, "init", "-q");
    await mkdir(join(root, "instructions", "nested"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "instructions/.DS_Store\n");
    await writeFile(join(root, "instructions", "nested", "tracked.md"), "tracked\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "fixture");
    return root;
  }

  it("packs only tracked files, never an ignored or untracked one", async () => {
    const root = await checkout();
    await writeFile(join(root, "instructions", ".DS_Store"), "finder\n");
    await writeFile(join(root, "instructions", "draft.md"), "private draft\n");

    const files = await collectTree(root, "instructions");

    expect(files.map((file) => file.relativePath)).toStrictEqual(["instructions/nested/tracked.md"]);
  });

  it("refuses a tree with uncommitted changes to a tracked file", async () => {
    const root = await checkout();
    await writeFile(join(root, "instructions", "nested", "tracked.md"), "edited\n");

    await expect(collectTree(root, "instructions")).rejects.toThrow(/uncommitted/u);
  });
});

describe("third-party package directory", () => {
  it("finds the installed package of a bundled input, scoped or not, and skips workspace files", () => {
    expect(thirdPartyPackageDirectory("node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js"))
      .toBe("node_modules/.pnpm/zod@4.4.3/node_modules/zod");
    expect(thirdPartyPackageDirectory("node_modules/.pnpm/@a+b@1.0.0/node_modules/@a/b/index.js"))
      .toBe("node_modules/.pnpm/@a+b@1.0.0/node_modules/@a/b");
    expect(thirdPartyPackageDirectory("packages/core/dist/index.js")).toBeUndefined();
  });
});

describe("pack (D55: one bundled CLI module)", () => {
  it("packs the CLI as one module plus its third-party licences, and nothing else outside the release trees", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const files = [...(await tree(join(out, "bundle"))).keys()];

    const rest = files.filter((path) => !path.startsWith("workflows/") && !path.startsWith("instructions/")).sort();
    expect(rest).toStrictEqual([THIRD_PARTY_LICENSES, LOCAL_BUNDLE_CLI_ENTRY].sort());
    expect(files.filter((path) => path.endsWith(".js"))).toStrictEqual([LOCAL_BUNDLE_CLI_ENTRY]);
    expect(files).toContain("workflows/capture/workflow.yaml");
    expect(files).toContain("instructions/catalog.json");

    const licenses = await readFile(join(out, "bundle", THIRD_PARTY_LICENSES), "utf8");
    for (const dependency of ["zod", "yaml", "smol-toml"]) {
      expect(licenses, dependency).toMatch(new RegExp(`^${dependency}@\\d`, "mu"));
    }

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
