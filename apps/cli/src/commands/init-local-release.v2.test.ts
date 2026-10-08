import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson, EXIT_CODES, hashBytes } from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2 } from "@developer-os/core";

import { createProductionContext, PRODUCT_VERSION } from "../context.js";
import type { CliContext } from "../context.js";
import { run } from "../main.js";
import type { CliContextFactory } from "../main.js";
import { withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import { renderEntrypoint } from "../update/entrypoint.js";
import { entrypointPath, LOCAL_BUNDLE_CLI_ENTRY, writeUnsignedLocalRelease } from "../update/local-release.js";
import { admitUnsignedLocalPackagedRelease } from "../update/packaged-release.js";
import { RecordingIo, REAL_FILESYSTEM_TIMEOUT_MS } from "./testing.js";

const roots: string[] = [];
const contexts: CliContext[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (contexts.length > 0) {
    const context = contexts.pop();
    if (context?.bootstrap?.state === "available") await context.bootstrap.executor.close();
  }
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await nodeFs.rm(root, { recursive: true, force: true });
  }
});

/**
 * A canonical 0700 temporary HOME, with `PATH` pointed at an empty directory so the real
 * `MacOsPlatformAdapter` this production context wires can never discover the machine's own
 * `claude` or `codex`.
 */
async function temporaryHome(label: string): Promise<{ readonly root: string; readonly home: string }> {
  const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), `developer-os-${label}-`)));
  roots.push(root);
  const home = join(root, "home");
  const emptyPath = join(root, "empty-path");
  await nodeFs.mkdir(home, { mode: 0o700 });
  await nodeFs.chmod(home, 0o700);
  await nodeFs.mkdir(emptyPath, { mode: 0o700 });
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", emptyPath);
  vi.stubEnv("CODEX_HOME", join(home, ".codex"));
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
  return { root, home };
}

function productionFactory(home: string): CliContextFactory {
  return async (io, request) => {
    const context = createProductionContext({
      io,
      env: {},
      userHome: home,
      localRelease: request.localRelease === null
        ? null
        : await admitUnsignedLocalPackagedRelease(request.localRelease, PRODUCT_VERSION),
    });
    contexts.push(context);
    return context;
  };
}

async function manifestSchemaVersion(home: string): Promise<unknown> {
  const manifest = JSON.parse(
    await nodeFs.readFile(join(home, ".developer-os", "installation-manifest.json"), "utf8"),
  ) as { readonly schemaVersion?: unknown };
  return manifest.schemaVersion;
}

describe("init --local-release", () => {
  it("installs V2 from an explicitly named unsigned local build and records the downgrade", async () => {
    const { root, home } = await temporaryHome("init-local-release");
    const dir = await writeUnsignedLocalRelease({
      outDir: join(root, "pkg"),
      version: PRODUCT_VERSION,
      bundleFiles: [
        {
          relativePath: "instructions/catalog.json",
          bytes: new TextEncoder().encode('{"artifacts":[],"schemaVersion":1}\n'),
          mode: 0o600,
        },
      ],
    });
    const io = new RecordingIo();

    const code = await run(["init", "--yes", "--local-release", dir], io, productionFactory(home));

    expect(code, io.err.join("\n")).toBe(EXIT_CODES.success);
    expect(await manifestSchemaVersion(home)).toBe(2);
    const trust = await nodeFs.readFile(join(home, ".developer-os", "state", "release-trust.json"), "utf8");
    expect(trust).toContain('"trust":"unsigned-local"');
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(c) re-runs init without flags on an unsigned-local home unchanged: no exit 6 from the active-tree reader (C2)", async () => {
    const { root, home } = await temporaryHome("init-local-release-rerun");
    const dir = await writeUnsignedLocalRelease({ outDir: join(root, "pkg"), version: PRODUCT_VERSION, bundleFiles: [{ relativePath: "instructions/catalog.json", bytes: new TextEncoder().encode('{"artifacts":[],"schemaVersion":1}\n'), mode: 0o600 }] });
    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), productionFactory(home))).toBe(EXIT_CODES.success);
    const io = new RecordingIo();
    expect(await run(["init", "--yes"], io, productionFactory(home)), io.err.join("\n")).toBe(EXIT_CODES.success);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("still takes the V1 path without the flag: no silent fallback to a local build", async () => {
    const { home } = await temporaryHome("init-no-local-release");
    const io = new RecordingIo();

    const code = await run(["init", "--yes"], io, productionFactory(home));

    expect(code, io.err.join("\n")).toBe(EXIT_CODES.success);
    expect(await manifestSchemaVersion(home)).toBe(1);
    await expect(
      nodeFs.lstat(join(home, ".developer-os", "state", "release-trust.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

const encoder = new TextEncoder();

/** A launchable bundle in miniature: the CLI entry is a stub that says it ran. */
async function launchableRelease(root: string): Promise<string> {
  return writeUnsignedLocalRelease({
    outDir: join(root, "pkg"),
    version: PRODUCT_VERSION,
    bundleFiles: [
      { relativePath: LOCAL_BUNDLE_CLI_ENTRY, bytes: encoder.encode('process.stdout.write("launched\\n");\n'), mode: 0o600 },
      { relativePath: "instructions/catalog.json", bytes: encoder.encode('{"artifacts":[],"schemaVersion":1}\n'), mode: 0o600 },
    ],
  });
}

async function readManifest(home: string): Promise<{ readonly bytes: Uint8Array; readonly manifest: InstallationManifestV2 }> {
  const bytes = new Uint8Array(await nodeFs.readFile(join(home, ".developer-os", "installation-manifest.json")));
  return { bytes, manifest: decodeCanonicalJson(bytes, 64 * 1024 * 1024) as unknown as InstallationManifestV2 };
}

describe("init --local-release writes the version-free entrypoint (D53)", () => {
  it("writes bin/developer-os.mjs as a 0600 manifest row that loads the active release, and it launches", async () => {
    const { root, home } = await temporaryHome("init-entrypoint");
    const dir = await launchableRelease(root);
    const io = new RecordingIo();

    const code = await run(["init", "--yes", "--local-release", dir], io, productionFactory(home));

    expect(code, io.err.join("\n")).toBe(EXIT_CODES.success);
    const productHome = join(home, ".developer-os");
    const entrypoint = entrypointPath(productHome);
    // NEW-163 B: the script is release-independent; the active record, not the script, names the bundle.
    expect(new Uint8Array(await nodeFs.readFile(entrypoint))).toEqual(renderEntrypoint());
    expect((await nodeFs.stat(entrypoint)).mode & 0o777).toBe(0o600);
    expect((await nodeFs.stat(join(productHome, "bin"))).mode & 0o777).toBe(0o700);
    const { manifest } = await readManifest(home);
    const row = manifest.artifacts.find((artifact) => artifact.path === entrypoint);
    expect(row).toMatchObject({
      owner: "core",
      kind: "file",
      verification: { mode: "content", installedHash: hashBytes(await nodeFs.readFile(entrypoint)) },
    });
    expect(manifest.artifacts.find((artifact) => artifact.path === join(productHome, "bin"))).toMatchObject({
      owner: "core",
      kind: "directory",
    });

    const launched = spawnSync(process.execPath, [entrypoint], { cwd: "/", encoding: "utf8" });
    expect(launched.status).toBe(0);
    expect(launched.stdout).toBe("launched\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("leaves a current entrypoint alone and rewrites one naming another release", async () => {
    const { root, home } = await temporaryHome("init-entrypoint-rewrite");
    const dir = await launchableRelease(root);
    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), productionFactory(home))).toBe(EXIT_CODES.success);
    const entrypoint = entrypointPath(join(home, ".developer-os"));
    const current = await nodeFs.readFile(entrypoint);

    const again = new RecordingIo();
    expect(await run(["init", "--yes", "--local-release", dir], again, productionFactory(home)), again.err.join("\n")).toBe(EXIT_CODES.success);
    expect(await nodeFs.readFile(entrypoint)).toStrictEqual(current);

    // An entrypoint an earlier release wrote, recorded as installed: the next init must move it.
    const stale = encoder.encode('import "file:///nowhere/releases/0.0.0-old/node_modules/@developer-os/cli/dist/bin.js";\n');
    const { bytes, manifest } = await readManifest(home);
    const artifacts = manifest.artifacts.map((artifact) =>
      artifact.path === entrypoint ? { ...artifact, verification: { mode: "content" as const, installedHash: hashBytes(stale) } } : artifact);
    const context = createProductionContext({ io: new RecordingIo(), env: {}, userHome: home, localRelease: null });
    contexts.push(context);
    const lifecycle = context.lifecycle;
    if (lifecycle === undefined) throw new Error("the production context composed no lifecycle context");
    await withLifecycleMutation(context, lifecycle, () => context.executor.execute({
      kind: "entrypoint",
      mutations: [
        { targetPath: entrypoint, operation: "replace", content: stale, expectedBeforeHash: hashBytes(current) },
        {
          targetPath: context.paths.manifestFile,
          operation: "replace",
          content: encoder.encode(encodeCanonicalJson({ ...manifest, artifacts } as unknown as CanonicalJsonValue)),
          expectedBeforeHash: hashBytes(bytes),
        },
      ],
    }));

    const rewrite = new RecordingIo();
    expect(await run(["init", "--yes", "--local-release", dir], rewrite, productionFactory(home)), rewrite.err.join("\n")).toBe(EXIT_CODES.success);
    expect(await nodeFs.readFile(entrypoint)).toStrictEqual(current);
    const after = (await readManifest(home)).manifest.artifacts.find((artifact) => artifact.path === entrypoint);
    // decodeCanonicalJson builds null-prototype objects, which toStrictEqual never equates with a literal.
    expect({ ...after?.verification }).toStrictEqual({ mode: "content", installedHash: hashBytes(current) });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("leaves no unmanaged bin directory when writing the entrypoint fails, and never adopts one", async () => {
    const { root, home } = await temporaryHome("init-entrypoint-failure");
    const dir = await launchableRelease(root);
    const bin = join(home, ".developer-os", "bin");
    const production = productionFactory(home);
    const failing: CliContextFactory = async (io, request) => {
      const context = await production(io, request);
      const { executor } = context;
      return {
        ...context,
        executor: {
          execute: (plan) => plan.kind === "entrypoint" ? Promise.reject(new Error("injected entrypoint failure")) : executor.execute(plan),
          resume: (id) => executor.resume(id),
          rollback: (id) => executor.rollback(id),
        },
      };
    };

    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), failing)).not.toBe(EXIT_CODES.success);
    await expect(nodeFs.lstat(bin)).rejects.toMatchObject({ code: "ENOENT" });

    // What a process killed between the directory and the transaction would leave behind.
    await nodeFs.mkdir(bin, { mode: 0o700 });
    const residue = new RecordingIo();
    expect(await run(["init", "--yes", "--local-release", dir], residue, production)).toBe(EXIT_CODES.decisionRequired);
    expect(residue.err.join("\n")).toContain(bin);

    await nodeFs.rmdir(bin);
    const again = new RecordingIo();
    expect(await run(["init", "--yes", "--local-release", dir], again, production), again.err.join("\n")).toBe(EXIT_CODES.success);
    const rows = (await readManifest(home)).manifest.artifacts.filter((artifact) => artifact.path === bin);
    expect(rows.map((row) => row.kind)).toStrictEqual(["directory"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("is removed by uninstall with its bin directory", async () => {
    const { root, home } = await temporaryHome("init-entrypoint-uninstall");
    const dir = await launchableRelease(root);
    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), productionFactory(home))).toBe(EXIT_CODES.success);

    const io = new RecordingIo();
    expect(await run(["uninstall", "--yes"], io, productionFactory(home)), io.err.join("\n")).toBe(EXIT_CODES.success);

    await expect(nodeFs.lstat(join(home, ".developer-os", "bin"))).rejects.toMatchObject({ code: "ENOENT" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("doctor names the command and suggests an alias without writing a shell file", async () => {
    const { root, home } = await temporaryHome("init-entrypoint-doctor");
    const dir = await launchableRelease(root);
    expect(await run(["init", "--yes", "--local-release", dir], new RecordingIo(), productionFactory(home))).toBe(EXIT_CODES.success);
    const before = await nodeFs.readdir(home);

    const io = new RecordingIo();
    await run(["doctor"], io, productionFactory(home));

    const entrypoint = entrypointPath(join(home, ".developer-os"));
    const line = io.out.find((candidate) => candidate.startsWith("[pass] entrypoint:"));
    expect(line).toContain(`node ${entrypoint}`);
    expect(line).toContain(`alias developer-os='node ${entrypoint}'`);
    expect(await nodeFs.readdir(home)).toStrictEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
