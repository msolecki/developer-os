import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { archiveOf } from "./release-archive.js";
import { tarballOf, writeReleaseTarballs } from "./release-tarball.js";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-tarball-")));
  roots.push(root);
  await chmod(root, 0o755);
  return root;
}

async function dir(path: string): Promise<void> {
  await mkdir(path);
  await chmod(path, 0o755);
}

async function file(path: string, text: string, mode: number): Promise<void> {
  await writeFile(path, text);
  await chmod(path, mode);
}

/** A keg-shaped tree: the same top level and modes the packer writes. */
async function keg(root: string, marker: string): Promise<string> {
  await dir(root);
  await dir(join(root, "bin"));
  await dir(join(root, "libexec"));
  await dir(join(root, "libexec", "fallback"));
  await file(join(root, "bin", "developer-os"), `#!/bin/sh\necho ${marker}\n`, 0o755);
  await file(join(root, "libexec", "launcher.mjs"), `export const marker = "${marker}";\n`, 0o644);
  await file(join(root, "libexec", "fallback", "a-file"), "a\n", 0o644);
  return root;
}

const MTIME = 1_791_000_000;

interface Member { readonly path: string; readonly mode: string; readonly uid: string; readonly gid: string; readonly mtime: string; readonly type: string }

/** The raw ustar header fields of every member, in archive order. */
function members(tar: Uint8Array): Member[] {
  const text = (offset: number, length: number): string => new TextDecoder().decode(tar.subarray(offset, offset + length)).replace(/\0.*$/su, "");
  const rows: Member[] = [];
  for (let at = 0; at + 512 <= tar.byteLength && tar[at] !== 0; ) {
    const size = Number.parseInt(text(at + 124, 12), 8);
    const prefix = text(at + 345, 155);
    rows.push({ path: prefix === "" ? text(at, 100) : `${prefix}/${text(at, 100)}`, mode: text(at + 100, 8), uid: text(at + 108, 8), gid: text(at + 116, 8), mtime: text(at + 136, 12), type: text(at + 156, 1) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return rows;
}

describe("release tarballs (A16 §2 step 3)", () => {
  it("writes sorted 0:0 members with the given mtime and the keg's modes, gzip without name or mtime", async () => {
    const root = await keg(join(await scratch(), "darwin-arm64"), "one");
    const gz = await tarballOf(root, MTIME);
    expect(gz[3]).toBe(0);
    expect([...gz.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    const rows = members(gunzipSync(gz));
    expect(rows.map((row) => row.path)).toEqual(["bin", "bin/developer-os", "libexec", "libexec/fallback", "libexec/fallback/a-file", "libexec/launcher.mjs"]);
    for (const row of rows) expect([row.uid, row.gid, row.mtime]).toEqual(["0000000", "0000000", MTIME.toString(8).padStart(11, "0")]);
    expect(rows.map((row) => `${row.type}:${row.mode}`)).toEqual(["5:0000755", "0:0000755", "5:0000755", "5:0000755", "0:0000644", "0:0000644"]);
  });

  it("lists exactly bin and libexec at the top level, so Homebrew does not descend into a lone directory", async () => {
    const rows = members(gunzipSync(await tarballOf(await keg(join(await scratch(), "k"), "x"), MTIME)));
    expect([...new Set(rows.map((row) => row.path.split("/")[0]))]).toEqual(["bin", "libexec"]);
  });

  it("is a function of the tree and the mtime only", async () => {
    const left = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME);
    const right = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME);
    expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
    const later = await tarballOf(await keg(join(await scratch(), "k"), "same"), MTIME + 1);
    expect(Buffer.from(left).equals(Buffer.from(later))).toBe(false);
  });

  it("extracts with the system tar to the same tree and modes", async () => {
    const root = await keg(join(await scratch(), "k"), "tar");
    const out = join(await scratch(), "out");
    await dir(out);
    const archive = join(await scratch(), "k.tar.gz");
    await writeFile(archive, await tarballOf(root, MTIME));
    const result = spawnSync("/usr/bin/tar", ["-xpzf", archive, "-C", out], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const entry of await readdir(root, { recursive: true })) {
      expect(((await stat(join(out, entry))).mode & 0o777).toString(8)).toBe(((await stat(join(root, entry))).mode & 0o777).toString(8));
    }
    expect(await readFile(join(out, "bin", "developer-os"), "utf8")).toBe("#!/bin/sh\necho tar\n");
  });

  it.each([
    ["a 0600 file", async (root: string) => { await chmod(join(root, "libexec", "launcher.mjs"), 0o600); }],
    ["a 0775 directory", async (root: string) => { await chmod(join(root, "libexec"), 0o775); }],
    ["a symlink", async (root: string) => { await symlink("launcher.mjs", join(root, "libexec", "link")); }],
    ["a hard link", async (root: string) => { await link(join(root, "libexec", "launcher.mjs"), join(root, "libexec", "second")); }],
  ])("refuses %s", async (_label, damage) => {
    const root = await keg(join(await scratch(), "k"), "bad");
    await damage(root);
    await expect(tarballOf(root, MTIME)).rejects.toThrow(/refusing to tar/u);
  });

  it("refuses an mtime that is negative, fractional or beyond the ustar field", async () => {
    const root = await keg(join(await scratch(), "k"), "m");
    for (const mtime of [-1, 1.5, 8 ** 11]) await expect(tarballOf(root, mtime)).rejects.toThrow(/mtime/u);
  });

  it("refuses a path that does not fit a ustar header", async () => {
    const root = await keg(join(await scratch(), "k"), "long");
    await file(join(root, "libexec", "x".repeat(101)), "x\n", 0o644);
    await expect(tarballOf(root, MTIME)).rejects.toThrow(/does not fit a ustar header/u);
  });

  it("keeps the bundle archive's fixed mtime", () => {
    const archive = archiveOf([{ path: "a", kind: "file", mode: 384, bytes: "1", sha256: "0".repeat(64) }] as unknown as Parameters<typeof archiveOf>[0], new Map([["a", new Uint8Array([0x61])]]));
    const header = zstdDecompressSync(archive).subarray(0, 512);
    expect(new TextDecoder().decode(header.subarray(136, 148))).toBe("14000000000\0");
  });

  it("writes both tarballs and a SHA256SUMS that shasum verifies", async () => {
    const pack = join(await scratch(), "pack");
    await dir(pack);
    await keg(join(pack, "darwin-arm64"), "arm");
    await keg(join(pack, "darwin-x64"), "intel");
    const dest = join(await scratch(), "dist");
    await writeReleaseTarballs({ packDir: pack, version: "0.1.0", mtime: MTIME, dest });
    const sums = await readFile(join(dest, "SHA256SUMS"), "utf8");
    const names = ["developer-os-0.1.0-darwin-arm64.tar.gz", "developer-os-0.1.0-darwin-x64.tar.gz"];
    const expected = await Promise.all(names.map(async (name) => `${createHash("sha256").update(await readFile(join(dest, name))).digest("hex")}  ${name}\n`));
    expect(sums).toBe(expected.join(""));
    const check = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: dest, encoding: "utf8" });
    expect(check.status).toBe(0);
    expect((await readdir(dest)).sort()).toEqual(["SHA256SUMS", ...names]);
  });

  it("refuses an existing destination and a version that is not stable semver", async () => {
    const pack = join(await scratch(), "pack");
    await dir(pack);
    await keg(join(pack, "darwin-arm64"), "a");
    await keg(join(pack, "darwin-x64"), "b");
    const dest = join(await scratch(), "dist");
    await dir(dest);
    await expect(writeReleaseTarballs({ packDir: pack, version: "0.1.0", mtime: MTIME, dest })).rejects.toThrow(/already exists/u);
    await expect(writeReleaseTarballs({ packDir: pack, version: "0.1", mtime: MTIME, dest: join(await scratch(), "d2") })).rejects.toThrow(/stable semver/u);
  });
});
