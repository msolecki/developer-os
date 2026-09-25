import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { encodeCanonicalJson, EXIT_CODES, serializeConfig } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { createCommandFixture, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { inspectPackagedRelease } from "../update/packaged-release.js";
import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import { applyInstructions, instructionRefusalDetails, parseAdaptersFlag, stableNodePath } from "./apply.js";
import { InstructionRefusal } from "./attach.js";

afterAll(removeCommandFixtures);

const CLAUDE = "/opt/synthetic/bin/claude";
const CODEX = "/opt/synthetic/bin/codex";

type Vendor = "claude" | "codex";

/** `--version` answers per executable; `null` is a binary that exits non-zero (unreadable). */
function versionRunner(versions: Readonly<Record<string, string | null>>): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      const version = versions[request.executable];
      if (request.args.join(" ") !== "--version" || version === undefined) {
        return Promise.reject(new Error(`unexpected spawn: ${request.executable} ${request.args.join(" ")}`));
      }
      return Promise.resolve(version === null
        ? { stdout: "", stderr: "", exitCode: 1, signal: null, timedOut: false }
        : { stdout: `${version}\n`, stderr: "", exitCode: 0, signal: null, timedOut: false });
    },
  };
}

function agents(installed: readonly Vendor[]): Readonly<Record<Vendor, AgentDiscovery>> {
  const discovery = (name: Vendor, path: string): AgentDiscovery =>
    installed.includes(name)
      ? { name, installed: true, executablePath: path, version: null }
      : { name, installed: false, executablePath: null, version: null };
  return { claude: discovery("claude", CLAUDE), codex: discovery("codex", CODEX) };
}

interface Planted {
  readonly fixture: CommandFixture;
  readonly release: AdmittedPackagedReleaseV1;
  readonly snapshot: () => Promise<readonly string[]>;
}

/**
 * A V2-shaped home without a real `init`: every case here refuses before the mutation gate,
 * so only the three files the pre-gate checks read are planted.
 */
async function plant(label: string, options: {
  readonly installed: readonly Vendor[];
  readonly versions: Readonly<Record<string, string | null>>;
  readonly productVersion?: string;
  readonly activeReleaseIdentityHash?: string | null;
}): Promise<Planted> {
  const fixture = await createCommandFixture(label, {
    bootstrapAvailable: true,
    agents: agents(options.installed),
    runner: versionRunner(options.versions),
  });
  const bootstrap = fixture.context.bootstrap;
  if (bootstrap?.state !== "available") throw new Error("the fixture has no admitted release");
  const release = await inspectPackagedRelease(bootstrap.packagedRelease);
  const { paths } = fixture;
  await nodeFs.mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(paths.configFile, serializeConfig({
    schemaVersion: 1,
    brainPath: paths.brain,
    adapters: { claude: false, codex: false },
    git: { enabled: false },
    automation: { enabled: false },
    telemetry: false,
  }), { mode: 0o600 });
  await nodeFs.writeFile(paths.manifestFile, encodeCanonicalJson({
    schemaVersion: 2,
    productVersion: options.productVersion ?? release.identity.version,
    installedAt: "2026-07-30T12:00:00.000Z",
    artifacts: [],
  }), { mode: 0o600 });
  const hash = options.activeReleaseIdentityHash === undefined ? release.identity.releaseIdentityHash : options.activeReleaseIdentityHash;
  if (hash !== null) {
    const { identity } = release;
    await nodeFs.writeFile(join(paths.stateDir, "active-release.json"), encodeCanonicalJson({
      schemaVersion: 1,
      version: identity.version,
      releaseSequence: identity.releaseSequence,
      releaseIdentityHash: hash,
      delegationSequence: identity.delegationSequence,
      delegationHash: identity.delegationHash,
      releaseIndexSequence: identity.releaseIndexSequence,
      releaseIndexHash: identity.releaseIndexHash,
      bundleManifestHash: identity.bundleManifestHash,
      bundleRoot: join(paths.home, "releases", identity.version, `darwin-${identity.architecture}`),
      platform: identity.platform,
      architecture: identity.architecture,
      launcherProtocol: identity.launcherProtocol,
      updateProtocol: identity.updateProtocol,
      activatedAt: "2026-07-30T12:00:00.000Z",
    }), { mode: 0o600 });
  }
  const snapshot = async (): Promise<readonly string[]> => {
    const files = [paths.configFile, paths.manifestFile];
    return Promise.all(files.map(async (path) => (await nodeFs.readFile(path)).toString("base64")));
  };
  return { fixture, release, snapshot };
}

async function refused(promise: Promise<unknown>, reason: string, code: number): Promise<InstructionRefusal> {
  const error: unknown = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(InstructionRefusal);
  const refusal = error as InstructionRefusal;
  expect(refusal.reason).toBe(reason);
  expect(refusal.code).toBe(code);
  return refusal;
}

async function vendorHomesUntouched(fixture: CommandFixture): Promise<void> {
  for (const path of [join(fixture.userHome, ".claude"), join(fixture.userHome, ".codex")]) {
    await expect(nodeFs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
}

describe("parseAdaptersFlag", () => {
  it("accepts exactly the four documented spellings", () => {
    expect(parseAdaptersFlag("claude,codex")).toStrictEqual(["claude", "codex"]);
    expect(parseAdaptersFlag("claude")).toStrictEqual(["claude"]);
    expect(parseAdaptersFlag("codex")).toStrictEqual(["codex"]);
    expect(parseAdaptersFlag("none")).toStrictEqual([]);
  });

  it("refuses every other value with exit 2", () => {
    const values = ["", "codex,claude", "claude,claude", "claude,", "all", "Claude", "none,claude", " claude"];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      let error: unknown = null;
      try {
        parseAdaptersFlag(value);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(InstructionRefusal);
      expect((error as InstructionRefusal).code).toBe(EXIT_CODES.invalidInput);
      expect((error as InstructionRefusal).name).toBe("AdaptersFlagInvalidError");
    }
  });
});

describe("applyInstructions: nothing selected", () => {
  it("does nothing, spawns nothing and enters no gate when nothing is selected or installed", async () => {
    const planted = await plant("apply-none", { installed: [], versions: {} });
    const before = await planted.snapshot();
    const stagingBefore = await nodeFs.readdir(planted.fixture.paths.home, { recursive: true });

    const result = await applyInstructions(planted.fixture.context, { selection: null, release: null });

    expect(result).toStrictEqual({
      installed: [],
      restored: [],
      unchanged: [],
      emulated: [],
      unsupported: [],
      heldBack: [],
      registration: null,
      warnings: [],
    });
    expect(await planted.snapshot()).toStrictEqual(before);
    expect(await nodeFs.readdir(planted.fixture.paths.home, { recursive: true })).toStrictEqual(stagingBefore);
    expect(planted.fixture.vendorProcesses).toStrictEqual([]);
    expect(planted.fixture.stableLockEvents).toStrictEqual([]);
  });
});

describe("applyInstructions: refusals before any mutation", () => {
  it("refuses a selected vendor whose CLI is absent, unreadable or below its floor with adapter_unavailable, exit 4", async () => {
    const cases: readonly {
      readonly label: string;
      readonly installed: readonly Vendor[];
      readonly versions: Readonly<Record<string, string | null>>;
      readonly selection: readonly Vendor[];
    }[] = [
      { label: "apply-absent", installed: ["claude"], versions: { [CLAUDE]: "2.1.280" }, selection: ["claude", "codex"] },
      { label: "apply-unreadable", installed: ["claude", "codex"], versions: { [CLAUDE]: "2.1.280", [CODEX]: null }, selection: ["claude", "codex"] },
      { label: "apply-below-floor", installed: ["claude"], versions: { [CLAUDE]: "1.0.0" }, selection: ["claude"] },
    ];
    expect(cases.length).toBeGreaterThan(0);
    for (const entry of cases) {
      const planted = await plant(entry.label, { installed: entry.installed, versions: entry.versions });
      const before = await planted.snapshot();

      const refusal = await refused(
        applyInstructions(planted.fixture.context, { selection: entry.selection, release: planted.release }),
        "adapter_unavailable",
        EXIT_CODES.capabilityUnavailable,
      );

      expect(refusal.name).toBe("AdapterUnavailableError");
      expect(instructionRefusalDetails(refusal)?.recovery).toContain("--adapters");
      expect(await planted.snapshot()).toStrictEqual(before);
      expect(planted.fixture.vendorProcesses.every((line) => line.endsWith(" --version"))).toBe(true);
      expect(planted.fixture.stableLockEvents).toStrictEqual([]);
      await vendorHomesUntouched(planted.fixture);
    }
  });

  it("refuses a needed instruction step without a release with packaged_release_unavailable, exit 4", async () => {
    const planted = await plant("apply-no-release", { installed: ["claude"], versions: { [CLAUDE]: "2.1.280" } });
    const before = await planted.snapshot();

    await refused(
      applyInstructions(planted.fixture.context, { selection: ["claude"], release: null }),
      "packaged_release_unavailable",
      EXIT_CODES.capabilityUnavailable,
    );

    expect(await planted.snapshot()).toStrictEqual(before);
    expect(planted.fixture.stableLockEvents).toStrictEqual([]);
    await vendorHomesUntouched(planted.fixture);
  });

  it("refuses release_mismatch, exit 4, when the version or the release identity differs from the installed one", async () => {
    const cases = [
      { label: "apply-version", productVersion: "9.9.9" },
      { label: "apply-identity", activeReleaseIdentityHash: "0".repeat(64) },
      { label: "apply-no-active", activeReleaseIdentityHash: null },
    ] as const;
    expect(cases.length).toBeGreaterThan(0);
    for (const entry of cases) {
      const planted = await plant(entry.label, { installed: ["claude"], versions: { [CLAUDE]: "2.1.280" }, ...entry });
      const before = await planted.snapshot();

      const refusal = await refused(
        applyInstructions(planted.fixture.context, { selection: ["claude"], release: planted.release }),
        "release_mismatch",
        EXIT_CODES.capabilityUnavailable,
      );

      expect(refusal.name).toBe("ReleaseMismatchError");
      expect(refusal.paths).toContain(planted.fixture.paths.manifestFile);
      expect(await planted.snapshot()).toStrictEqual(before);
      expect(planted.fixture.stableLockEvents).toStrictEqual([]);
      await vendorHomesUntouched(planted.fixture);
    }
  });
});

describe("stableNodePath", () => {
  async function homebrew(optTarget: string): Promise<{ root: string; cellar: string }> {
    const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-stable-node-")));
    for (const version of ["24.16.0", "24.17.0"]) {
      await nodeFs.mkdir(join(root, "Cellar", "node@24", version, "bin"), { recursive: true });
      await nodeFs.writeFile(join(root, "Cellar", "node@24", version, "bin", "node"), "", { mode: 0o755 });
    }
    await nodeFs.mkdir(join(root, "opt"));
    await nodeFs.symlink(join("..", "Cellar", "node@24", optTarget), join(root, "opt", "node@24"));
    return { root, cellar: join(root, "Cellar", "node@24", "24.16.0", "bin", "node") };
  }

  it("names Homebrew's version-free opt link when it resolves to the running Node", async () => {
    const { root, cellar } = await homebrew("24.16.0");
    try {
      expect(await stableNodePath(cellar)).toBe(join(root, "opt", "node@24", "bin", "node"));
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the running Node when the opt link names another version", async () => {
    const { root, cellar } = await homebrew("24.17.0");
    try {
      expect(await stableNodePath(cellar)).toBe(cellar);
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a Node outside a Homebrew cellar", async () => {
    expect(await stableNodePath("/synthetic/bin/node")).toBe("/synthetic/bin/node");
  });
});
