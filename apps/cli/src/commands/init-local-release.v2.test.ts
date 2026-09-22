import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { createProductionContext, PRODUCT_VERSION } from "../context.js";
import type { CliContext } from "../context.js";
import { run } from "../main.js";
import type { CliContextFactory } from "../main.js";
import { LOCAL_BUNDLE_BIN, writeUnsignedLocalRelease } from "../update/local-release.js";
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
        LOCAL_BUNDLE_BIN,
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
