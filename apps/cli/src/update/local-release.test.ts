import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { PRODUCT_VERSION } from "../context.js";
import {
  entrypointPath,
  LOCAL_BUNDLE_CLI_ENTRY,
  releaseTemplateFiles,
  writeUnsignedLocalRelease,
} from "./local-release.js";
import type { ReleaseFileV1 } from "./local-release.js";
import {
  admitUnsignedLocalPackagedRelease,
  inspectPackagedRelease,
} from "./packaged-release.js";

const CATALOG = new TextEncoder().encode('{"artifacts":[],"schemaVersion":1}\n');
const BUNDLE: readonly ReleaseFileV1[] = [
  { relativePath: "bin/tool", bytes: new TextEncoder().encode("#!/bin/sh\n"), mode: 0o700 },
  { relativePath: "instructions/catalog.json", bytes: CATALOG, mode: 0o600 },
  { relativePath: "workflows/capture/workflow.yaml", bytes: new TextEncoder().encode("id: capture\n"), mode: 0o600 },
];

let tmp: string;

beforeEach(async () => {
  tmp = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-local-release-")));
});

afterEach(async () => {
  await nodeFs.rm(tmp, { recursive: true, force: true });
});

async function tree(root: string): Promise<ReadonlyMap<string, string>> {
  const entries = await nodeFs.readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const stats = await nodeFs.stat(path);
    files.set(path.slice(root.length + 1), `${(stats.mode & 0o777).toString(8)}:${(await nodeFs.readFile(path)).toString("hex")}`);
  }
  return files;
}

describe("writeUnsignedLocalRelease", () => {
  it("writes a package the unsigned-local admission accepts", async () => {
    const out = await writeUnsignedLocalRelease({ outDir: join(tmp, "pkg"), version: PRODUCT_VERSION, bundleFiles: BUNDLE });
    const release = await inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION));
    expect(release.trust).toBe("unsigned-local");
    const paths = release.files.map((file) => file.relativePath);
    expect(paths).toContain("bundle/instructions/catalog.json");
    expect(paths).toContain("bundle/bin/tool");
    const templates = releaseTemplateFiles();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) expect(paths).toContain(template.relativePath);
    expect(release.files.find((file) => file.relativePath === "bundle/bin/tool")?.mode).toBe(0o700);
    expect(new TextDecoder().decode(await release.readFile("bundle/instructions/catalog.json"))).toBe(
      new TextDecoder().decode(CATALOG),
    );
  });

  it("returns the realpath of the output directory", async () => {
    await nodeFs.mkdir(join(tmp, "real"), { mode: 0o700 });
    await nodeFs.symlink(join(tmp, "real"), join(tmp, "link"));
    const out = await writeUnsignedLocalRelease({ outDir: join(tmp, "link", "pkg"), version: PRODUCT_VERSION, bundleFiles: BUNDLE });
    expect(out).toBe(join(tmp, "real", "pkg"));
  });

  it("refuses an existing output directory", async () => {
    const outDir = join(tmp, "pkg");
    await nodeFs.mkdir(outDir, { mode: 0o700 });
    await expect(
      writeUnsignedLocalRelease({ outDir, version: PRODUCT_VERSION, bundleFiles: BUNDLE }),
    ).rejects.toMatchObject({ code: EXIT_CODES.invalidInput });
    expect(await nodeFs.readdir(outDir)).toStrictEqual([]);
  });

  const unsafe = ["", "/abs", "../escape", "a/../b", "a//b", "./a", "a\\b"] as const;
  it.each(unsafe)("refuses the bundle path %j before writing anything", async (relativePath) => {
    const outDir = join(tmp, "pkg");
    await expect(
      writeUnsignedLocalRelease({
        outDir,
        version: PRODUCT_VERSION,
        bundleFiles: [...BUNDLE, { relativePath, bytes: CATALOG, mode: 0o600 }],
      }),
    ).rejects.toMatchObject({ code: EXIT_CODES.invalidInput });
    await expect(nodeFs.lstat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a bundle path listed twice", async () => {
    await expect(
      writeUnsignedLocalRelease({ outDir: join(tmp, "pkg"), version: PRODUCT_VERSION, bundleFiles: [...BUNDLE, BUNDLE[1] as ReleaseFileV1] }),
    ).rejects.toMatchObject({ code: EXIT_CODES.invalidInput });
  });

  it("writes byte-identical files for the same input", async () => {
    const first = await tree(await writeUnsignedLocalRelease({ outDir: join(tmp, "a"), version: PRODUCT_VERSION, bundleFiles: BUNDLE }));
    const second = await tree(
      await writeUnsignedLocalRelease({ outDir: join(tmp, "b"), version: PRODUCT_VERSION, bundleFiles: [...BUNDLE].reverse() }),
    );
    expect(first.size).toBeGreaterThan(0);
    expect(second).toStrictEqual(first);
  });

  it("refuses a package written for another version as release_mismatch", async () => {
    const out = await writeUnsignedLocalRelease({ outDir: join(tmp, "pkg"), version: "9.9.9", bundleFiles: BUNDLE });
    await expect(admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION)).rejects.toMatchObject({
      code: EXIT_CODES.capabilityUnavailable,
      message: "release_mismatch",
    });
  });
});

describe("D53 entrypoint locations", () => {
  it("names the packed CLI inside the bundle and a version-free product file", () => {
    expect(LOCAL_BUNDLE_CLI_ENTRY).toBe("node_modules/@developer-os/cli/dist/bin.js");
    expect(entrypointPath("/Users/someone/.developer-os")).toBe("/Users/someone/.developer-os/bin/developer-os.mjs");
  });
});
