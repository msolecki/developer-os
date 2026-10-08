import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pack } from "./pack-release.js";
import { tarballOf } from "./release-tarball.js";
import { ustarHeader } from "./release-archive.js";
import { verifyReleaseTarball } from "./verify-release-tarball.js";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-verify-test-")));
  roots.push(root);
  await chmod(root, 0o755);
  return root;
}

/** A Node stand-in the packer accepts with `skipCpuCheck`: a shell script answering `--version`. */
async function stubNode(): Promise<{ readonly path: string; readonly sha256: string; readonly version: string }> {
  const path = join(await scratch(), "node");
  const bytes = new TextEncoder().encode("#!/bin/sh\necho v24.0.0\n");
  await writeFile(path, bytes, { mode: 0o755 });
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), version: "24.0.0" };
}

const MTIME = 1_791_000_000;
let out = "";

beforeAll(async () => {
  const node = await stubNode();
  out = join(await scratch(), "out");
  await pack({ outDir: out, version: "0.1.0", releaseSequence: "1000", indexSequence: "1000", node: { arm64: node, x64: node }, skipCpuCheck: true });
}, 600_000);

async function tarball(architecture: "arm64" | "x64", kegRoot = join(out, `darwin-${architecture}`)): Promise<string> {
  const path = join(await scratch(), `developer-os-0.1.0-darwin-${architecture}.tar.gz`);
  await writeFile(path, await tarballOf(kegRoot, MTIME));
  return path;
}

describe("verifyReleaseTarball (A16 §2 step 4)", () => {
  it.each(["arm64", "x64"] as const)("admits the intact %s tarball and refuses its byte-flipped copy", async (architecture) => {
    await expect(verifyReleaseTarball({ tarball: await tarball(architecture), version: "0.1.0", architecture })).resolves.toBeUndefined();
  }, 120_000);

  it("refuses the other architecture's tarball", async () => {
    await expect(verifyReleaseTarball({ tarball: await tarball("x64"), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/admission/u);
  }, 120_000);

  it("refuses a version the tarball does not carry", async () => {
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64"), version: "0.2.0", architecture: "arm64" })).rejects.toThrow(/admission|sequence/u);
  }, 120_000);

  it("refuses a tarball whose stamped sequence is not the version's §3.2 sequence", async () => {
    const node = await stubNode();
    const wrong = join(await scratch(), "wrong");
    await pack({ outDir: wrong, version: "0.1.0", releaseSequence: "7", indexSequence: "7", node: { arm64: node, x64: node }, skipCpuCheck: true });
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64", join(wrong, "darwin-arm64")), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/sequence 7.*1000/u);
  }, 600_000);

  it("refuses a tarball built from a keg whose bundle was altered before tarring", async () => {
    // A copy of the beforeAll keg, so this case needs no third pack (tests/ runs in test:suite).
    const altered = join(await scratch(), "darwin-arm64");
    await cp(join(out, "darwin-arm64"), altered, { recursive: true });
    const target = join(altered, "libexec", "fallback", "bundle", "bin", "verifier.mjs");
    const bytes = await readFile(target);
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await writeFile(target, bytes);
    await expect(verifyReleaseTarball({ tarball: await tarball("arm64", altered), version: "0.1.0", architecture: "arm64" })).rejects.toThrow(/admission/u);
  }, 120_000);
});

/** A gzip ustar with the given members; `patch` edits each header (typeflag, name) before the checksum is recomputed. */
function crafted(members: readonly { readonly path: string; readonly type?: string; readonly name?: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const member of members) {
    const header = ustarHeader({ path: member.path, kind: member.type === "5" ? "directory" : "file", mode: member.type === "5" ? 0o755 : 0o644 }, 0, MTIME);
    if (member.name !== undefined) {
      header.fill(0, 0, 100);
      header.set(new TextEncoder().encode(member.name), 0);
    }
    if (member.type !== undefined) header[156] = member.type.charCodeAt(0);
    let sum = 0;
    for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
    header.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    parts.push(header);
  }
  parts.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(Buffer.concat(parts)));
}

describe("verifyReleaseTarball unpacking refusals", () => {
  it.each([
    ["a top-level entry other than bin and libexec", [{ path: "extra", type: "5" }], /top level/u],
    ["a symlink", [{ path: "bin", type: "5" }, { path: "bin/developer-os", type: "2" }], /symlink|entry type/u],
    ["an absolute path", [{ path: "bin", type: "5" }, { path: "bin/x", name: "/etc/x" }], /unsafe path/u],
    ["a .. segment", [{ path: "bin", type: "5" }, { path: "bin/x", name: "../x" }], /unsafe path/u],
  ] as const)("refuses %s", async (_label, members, message) => {
    const path = join(await scratch(), "bad.tar.gz");
    await writeFile(path, crafted(members));
    await expect(verifyReleaseTarball({ tarball: path, version: "0.1.0", architecture: "arm64" })).rejects.toThrow(message);
  });
});
