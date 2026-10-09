import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { execPath } from "node:process";
import { Readable } from "node:stream";

import { afterAll, describe, expect, it } from "vitest";

import { decodeCanonicalJson, validateBundleManifest, validateReleaseIndex } from "@developer-os/core";
import { ZstdUstarAdmission } from "@developer-os/security";
import { renderEntrypoint } from "@developer-os/cli/dist/update/entrypoint.js";
import { admitPackageChannelRelease, inspectPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { assertCleanCheckout, assertNodeBinary, pack } from "./pack-release.js";
import { archiveOf } from "./release-archive.js";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** A realpathed `0755` scratch directory and the not-yet-existing `out` inside it. */
async function freshOutDir(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-pack-release-")));
  roots.push(root);
  await chmod(root, 0o755);
  return join(root, "out");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const HOST_NODE = { path: execPath, sha256: sha256(await readFile(execPath)), version: process.versions.node };
const ARCH = process.arch as "arm64" | "x64";

/** A Node stand-in: a shell script running `body`, pinned to `version`. It needs `skipCpuCheck`. */
async function stubNode(body = "echo v24.0.0", version = "24.0.0"): Promise<{ readonly path: string; readonly sha256: string; readonly version: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-stub-node-")));
  roots.push(root);
  const path = join(root, "node");
  const bytes = new TextEncoder().encode(`#!/bin/sh\n${body}\n`);
  await writeFile(path, bytes, { mode: 0o755 });
  return { path, sha256: sha256(bytes), version };
}

/** Relative path → mode and content digest for every entry under `root`. */
async function tree(root: string): Promise<ReadonlyMap<string, string>> {
  const rows = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const mode = ((await stat(path)).mode & 0o777).toString(8);
    rows.set(relative(root, path), entry.isFile() ? `${mode}:${sha256(await readFile(path))}` : `${mode}:${entry.isDirectory() ? "dir" : "other"}`);
  }
  return rows;
}

/** A resolved runtime is ~120 MB; never let a failing expectation try to print it. */
function settled(work: Promise<Uint8Array>): Promise<string> {
  return work.then(() => "resolved");
}

const OPTIONS = { version: "0.1.0", releaseSequence: "7", indexSequence: "9" } as const;

describe("pack:release (Task 11b K2)", () => {
  it("produces an admissible keg per architecture with stamped sequences and Homebrew modes", async () => {
    const out = await freshOutDir();
    const kegs = await pack({ outDir: out, ...OPTIONS, node: { arm64: HOST_NODE, x64: HOST_NODE }, skipCpuCheck: true });
    const fallback = `${kegs[ARCH]}/libexec/fallback`;
    // Task 3 adds a required `architecture` option; a variable keeps this call valid on both signatures.
    const admission = { prefix: out, requireVersion: null, architecture: ARCH };
    const admitted = await inspectPackagedRelease(await admitPackageChannelRelease(fallback, admission));
    expect(admitted.identity).toMatchObject({ version: "0.1.0", releaseSequence: "7", releaseIndexSequence: "9", launcherProtocol: 1, updateProtocol: 1 });
    expect((await stat(`${fallback}/bundle/bin/node`)).mode & 0o777).toBe(0o755);
    expect((await stat(`${kegs[ARCH]}/bin/developer-os`)).mode & 0o777).toBe(0o755);
    expect((await stat(`${kegs[ARCH]}/libexec/launcher.mjs`)).mode & 0o777).toBe(0o644);
    expect(await readFile(`${kegs.arm64}/bin/developer-os`, "utf8")).toBe(
      '#!/bin/sh\nexec "/opt/homebrew/opt/developer-os/libexec/fallback/bundle/bin/node" "/opt/homebrew/opt/developer-os/libexec/launcher.mjs" "$@"\n',
    );
    expect(await readFile(`${kegs.x64}/bin/developer-os`, "utf8")).toContain('"/usr/local/opt/developer-os/libexec/launcher.mjs"');

    // The manifest: the brief's entrypoints and modes, every parent a 448 directory.
    const manifestBytes = await readFile(`${out}/archives/0.1.0/darwin-${ARCH}.manifest.json`);
    expect(new Uint8Array(manifestBytes)).toEqual(new Uint8Array(await readFile(`${fallback}/metadata/bundle-manifest.json`)));
    const manifest = validateBundleManifest(decodeCanonicalJson(manifestBytes, 16 * 1024 * 1024));
    expect(manifest).toMatchObject({
      entrypoint: "node_modules/@developer-os/cli/dist/bin.js",
      runtimeEntrypoint: "bin/node",
      plannerEntrypoint: "bin/planner.mjs",
      verifierEntrypoint: "bin/verifier.mjs",
      launcherProtocol: 1,
      updateProtocol: 1,
      architecture: ARCH,
    });
    const modes = new Map<string, string>(manifest.entries.map((entry) => [entry.path, `${entry.kind}:${String(entry.mode)}`]));
    for (const path of ["bin/node", "bin/planner.mjs", "bin/verifier.mjs", "node_modules/@developer-os/cli/dist/bin.js"]) expect(modes.get(path)).toBe("file:448");
    for (const path of ["bin", "node_modules", "node_modules/@developer-os", "node_modules/@developer-os/cli", "node_modules/@developer-os/cli/dist", "workflows", "instructions"]) expect(modes.get(path)).toBe("directory:448");
    expect(modes.get("THIRD-PARTY-LICENSES")).toBe("file:384");
    const files = manifest.entries.filter((entry) => entry.kind === "file");
    expect(files.filter((entry) => entry.path.startsWith("workflows/")).length).toBeGreaterThan(0);
    expect(files.filter((entry) => entry.path.startsWith("instructions/")).length).toBeGreaterThan(0);
    for (const entry of files) if (entry.path.startsWith("workflows/") || entry.path.startsWith("instructions/")) expect(entry.mode).toBe(384);
    expect(files.find((entry) => entry.path === "bin/node")?.sha256).toBe(HOST_NODE.sha256);

    // The index row references the real archive and manifest bytes.
    const index = validateReleaseIndex(decodeCanonicalJson(await readFile(`${fallback}/metadata/release-index.json`), 4 * 1024 * 1024));
    expect(index).toMatchObject({ sequence: "9", latestVersion: "0.1.0" });
    const row = index.releases[0];
    expect(row).toMatchObject({ version: "0.1.0", releaseSequence: "7", minimumLauncherProtocol: 1, updateProtocol: 1 });
    for (const [position, architecture] of (["arm64", "x64"] as const).entries()) {
      const reference = row?.bundles[position];
      const archive = await readFile(`${out}/archives/0.1.0/darwin-${architecture}.tar.zst`);
      const bundleManifest = await readFile(`${out}/archives/0.1.0/darwin-${architecture}.manifest.json`);
      expect(reference).toMatchObject({
        archivePath: `archives/0.1.0/darwin-${architecture}.tar.zst`,
        archiveBytes: String(archive.byteLength),
        archiveSha256: sha256(archive),
        manifestPath: `archives/0.1.0/darwin-${architecture}.manifest.json`,
        manifestBytes: String(bundleManifest.byteLength),
        manifestSha256: sha256(bundleManifest),
      });
    }

    // Each real archive passes the production archive admission against its own manifest.
    for (const [position, architecture] of (["arm64", "x64"] as const).entries()) {
      const reference = row?.bundles[position];
      if (reference === undefined) throw new Error("the index row lists both bundles");
      const archiveManifest = validateBundleManifest(decodeCanonicalJson(await readFile(`${out}/archives/0.1.0/darwin-${architecture}.manifest.json`), 16 * 1024 * 1024));
      const admittedArchive = await new ZstdUstarAdmission().extract({
        bundle: reference,
        manifest: archiveManifest,
        source: Readable.from([await readFile(`${out}/archives/0.1.0/darwin-${architecture}.tar.zst`)]) as AsyncIterable<Uint8Array>,
        sink: { begin: () => Promise.resolve(), write: () => Promise.resolve(), end: () => Promise.resolve() },
      });
      expect(admittedArchive.entries).toBe(archiveManifest.entries.length);
      expect(admittedArchive.entries).toBeGreaterThan(10);
    }

    // Carried (1) and (2): the version-free entrypoint script imports the packed CLI, which reports
    // the stamped version; the Codex plugin version is the same bundled constant.
    const cli = await readFile(`${fallback}/bundle/node_modules/@developer-os/cli/dist/bin.js`, "utf8");
    expect(cli).not.toContain("__DEVELOPER_OS_RELEASE_VERSION__");
    expect(cli).toMatch(/PLUGIN_VERSION = RELEASE_VERSION/u);
    const home = await realpath(await mkdtemp(join(tmpdir(), "developer-os-pack-home-")));
    roots.push(home);
    const bundleRoot = join(home, "releases", "0.1.0", `darwin-${ARCH}`);
    await cp(`${fallback}/bundle`, bundleRoot, { recursive: true });
    await mkdir(join(home, "state", "release-metadata", "bundles"), { recursive: true });
    const manifestHash = sha256(manifestBytes);
    await writeFile(join(home, "state", "release-metadata", "bundles", `${manifestHash}.json`), manifestBytes, { mode: 0o600 });
    await writeFile(join(home, "state", "active-release.json"), JSON.stringify({ version: "0.1.0", bundleRoot, bundleManifestHash: manifestHash }), { mode: 0o600 });
    await mkdir(join(home, "bin"));
    await writeFile(join(home, "bin", "developer-os.mjs"), renderEntrypoint(), { mode: 0o600 });
    const run = spawnSync(join(bundleRoot, "bin", "node"), [join(home, "bin", "developer-os.mjs"), "--version"], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: home, DEVELOPER_OS_HOME: home },
    });
    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("developer-os 0.1.0\n");
    expect(run.status).toBe(0);
  }, 600_000);

  it("packs the same inputs to byte-identical trees and archives", async () => {
    const node = await stubNode();
    const options = { ...OPTIONS, node: { arm64: node, x64: node }, skipCpuCheck: true };
    const first = await freshOutDir();
    const second = await freshOutDir();
    await pack({ outDir: first, ...options });
    await pack({ outDir: second, ...options });
    const left = await tree(first);
    expect([...left.keys()].filter((path) => path.endsWith(".tar.zst")).length).toBe(2);
    expect(left.size).toBeGreaterThan(10);
    expect(await tree(second)).toEqual(left);
  }, 600_000);

  it("refuses a Node binary of the wrong architecture", async () => {
    await expect(settled(assertNodeBinary(HOST_NODE, ARCH === "arm64" ? "x64" : "arm64"))).rejects.toThrow(/architecture/u);
    await expect(settled(assertNodeBinary(HOST_NODE, ARCH))).resolves.toBe("resolved");
  });

  it("refuses a Node binary that is not Node 24 or does not match its pinned SHA-256", async () => {
    const old = await stubNode("echo v22.11.0", "22.11.0");
    await expect(assertNodeBinary(old, ARCH, { skipCpuCheck: true })).rejects.toThrow(/Node 24/u);
    await expect(assertNodeBinary(await stubNode("echo v24.0", "24.0"), ARCH, { skipCpuCheck: true })).rejects.toThrow(/Node 24/u);
    // The host-architecture slot must report exactly the version it is pinned as.
    await expect(assertNodeBinary(await stubNode("echo v24.0.0", "24.1.0"), ARCH, { skipCpuCheck: true })).rejects.toThrow(/reports/u);
    // A pin copied in upper case is the same pin.
    await expect(settled(assertNodeBinary({ ...HOST_NODE, sha256: HOST_NODE.sha256.toUpperCase() }, ARCH))).resolves.toBe("resolved");
    await expect(settled(assertNodeBinary({ ...HOST_NODE, sha256: "0".repeat(64) }, ARCH))).rejects.toThrow(/SHA-256/u);
    // The hash is checked before the binary runs: a mismatched stub never answers `--version`.
    const current = await stubNode();
    await expect(assertNodeBinary({ ...current, sha256: "0".repeat(64) }, ARCH, { skipCpuCheck: true })).rejects.toThrow(/SHA-256/u);
  });

  it("never runs the foreign-architecture binary: its SHA-256 pin is the integrity authority", async () => {
    const marker = join(dirname(await freshOutDir()), "ran");
    const foreign = await stubNode(`touch ${marker}\necho v24.0.0`);
    await expect(assertNodeBinary(foreign, ARCH === "arm64" ? "x64" : "arm64", { skipCpuCheck: true })).resolves.toBeInstanceOf(Uint8Array);
    await expect(stat(marker)).rejects.toThrow(/ENOENT/u);
    await expect(assertNodeBinary(foreign, ARCH, { skipCpuCheck: true })).resolves.toBeInstanceOf(Uint8Array);
    expect((await stat(marker)).isFile()).toBe(true);
  });

  it("bounds the --version probe at 10 s", async () => {
    const hung = await stubNode("exec sleep 60");
    const started = Date.now();
    await expect(assertNodeBinary(hung, ARCH, { skipCpuCheck: true })).rejects.toThrow(/--version/u);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("the archive writer refuses a file entry with no bytes", () => {
    expect(() => archiveOf([{ path: "missing", kind: "file", mode: 384, bytes: "0", sha256: "0".repeat(64) }] as unknown as Parameters<typeof archiveOf>[0], new Map())).toThrow(/missing/u);
  });

  it("the CLI refuses a dirty checkout unless --allow-dirty, and refuses --allow-dirty when CI is set", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-dirty-")));
    roots.push(root);
    const git = (...args: string[]): void => {
      const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git("init", "-q");
    await writeFile(join(root, "tracked"), "tracked\n");
    git("add", "tracked");
    git("commit", "-q", "-m", "fixture");
    expect(() => { assertCleanCheckout(root, false, {}); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, false, { CI: "true" }); }).not.toThrow();
    // A clean tree does not make the flag acceptable in CI: the flag itself is refused.
    expect(() => { assertCleanCheckout(root, true, { CI: "true" }); }).toThrow(/--allow-dirty is refused when CI is set/u);
    await writeFile(join(root, "untracked"), "draft\n");
    expect(() => { assertCleanCheckout(root, false, {}); }).toThrow(/uncommitted|--allow-dirty/u);
    expect(() => { assertCleanCheckout(root, true, {}); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, true, { CI: "" }); }).not.toThrow();
    expect(() => { assertCleanCheckout(root, true, { CI: "1" }); }).toThrow(/--allow-dirty is refused when CI is set/u);
  });

  it.each([
    ["a version that is not stable semver", { version: "1.0" }, /version/u],
    ["a prerelease version", { version: "1.0.0-beta.1" }, /version/u],
    ["a zero release sequence", { releaseSequence: "0" }, /releaseSequence/u],
    ["a non-decimal release sequence", { releaseSequence: "07" }, /releaseSequence/u],
    ["an index sequence beyond UInt64", { indexSequence: "18446744073709551616" }, /indexSequence/u],
  ])("refuses %s", async (_label, override, message) => {
    const node = await stubNode();
    const out = await freshOutDir();
    await expect(pack({ outDir: out, ...OPTIONS, ...override, node: { arm64: node, x64: node }, skipCpuCheck: true })).rejects.toThrow(message);
  });

  it("refuses an existing output directory", async () => {
    const node = await stubNode();
    const out = await freshOutDir();
    await mkdir(out);
    await expect(pack({ outDir: out, ...OPTIONS, node: { arm64: node, x64: node }, skipCpuCheck: true })).rejects.toThrow(/already exists/u);
  });
});
