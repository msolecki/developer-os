import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, hashBytes, loadConfig, parseCanonicalAbsolutePathText, parseUtcTimestamp } from "@developer-os/core";
import type { InstallationManifestV2, ManagedArtifactV2 } from "@developer-os/core";
import { NodeLaunchdPlistReader, parseCanonicalLaunchdPlist } from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName, LaunchdBootstrapPlistIdentityV1, LaunchdPlistPortV1 } from "@developer-os/platform-macos";

import { failureFrom } from "../../context.js";
import type { CliContext } from "../../context.js";
import { compareManifestRows } from "../../instructions/attach.js";
import { gatedState, manifestMutation } from "../../instructions/apply.js";
import type { LifecycleEffectPortsV1 } from "../../lifecycle/adapters.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import { hostWith, scriptedLaunchd } from "../../lifecycle/testing.js";
import { entrypointPath } from "../../update/local-release.js";
import { scriptedEffectPorts, scriptedGitRuntime } from "../git/testing.js";
import { runInit } from "../init.js";
import { createCommandFixture, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runAutomation } from "./index.js";
import { AutomationCommandRefusal, createAutomationService, verifiedAutomationExecutable } from "./service.js";

afterEach(removeCommandFixtures);

const ENTRYPOINT = "// synthetic entrypoint\n";

function lifecycleOf(fixture: CommandFixture): NonNullable<CommandFixture["context"]["lifecycle"]> {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

function manifestWith(rows: readonly object[]): InstallationManifestV2 {
  return { artifacts: rows } as unknown as InstallationManifestV2;
}

function entrypointRow(path: string, installedHash: string, owner = "core"): object {
  return { owner, path, kind: "file", verification: { mode: "content", installedHash } };
}

describe("AutomationCommandRefusal", () => {
  it("publishes its reason as the failure kind", () => {
    const refusal = new AutomationCommandRefusal("automation_already_disabled", EXIT_CODES.invalidInput, ["/synthetic/config.toml"]);
    const result = failureFrom({ guards: { redactDiagnostic: (text: string) => text } } as never, refusal, refusal.paths);
    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "automation_already_disabled" } });
  });
});

describe("createAutomationService", () => {
  it("refuses every preview on a home with no installation, before any observation or write", async () => {
    const fixture = await createCommandFixture("automation-no-install");
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    const before = await inventoryDigest(fixture.root);
    const service = createAutomationService(fixture.context, lifecycleOf(fixture));

    await expect(service.previewEnable(["doctor=daily@02:00"])).rejects.toMatchObject({ reason: "manifest_absent" });
    await expect(service.previewDisable()).rejects.toMatchObject({ reason: "manifest_absent" });
    await expect(service.status()).rejects.toMatchObject({ reason: "manifest_absent" });
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
  });
});

describe("verifiedAutomationExecutable", () => {
  it("names the installed entrypoint only when its core content row and bytes agree", async () => {
    const fixture = await createCommandFixture("automation-executable");
    const lifecycle = lifecycleOf(fixture);
    const productHome = parseCanonicalAbsolutePathText(fixture.paths.home);
    const path = entrypointPath(productHome);
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, ENTRYPOINT, { mode: 0o600 });
    const hash = createHash("sha256").update(ENTRYPOINT).digest("hex");

    expect(await verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, hash)]))).toBe(path);
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([]))).rejects.toMatchObject({
      reason: "automation_executable_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
    });
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, hash, "macos")]))).rejects.toMatchObject({
      reason: "automation_executable_unavailable",
    });
    await expect(verifiedAutomationExecutable(lifecycle, productHome, manifestWith([entrypointRow(path, "0".repeat(64))]))).rejects.toMatchObject({
      reason: "automation_executable_drifted",
      code: EXIT_CODES.recoveryRequired,
    });
  });
});

describe("automation enable pins the brain-garden vendor", () => {
  const launchd = scriptedLaunchd({ clock: () => parseUtcTimestamp("2026-10-01T00:00:00.000Z"), host: hostWith() });
  /** As automation.v2.test.ts: the published plist's inode is never the staged one, so only it is unchecked. */
  const plists: LaunchdPlistPortV1 = {
    read: async (identity: LaunchdBootstrapPlistIdentityV1) => {
      const bytes = await nodeFs.readFile(identity.path);
      if (hashBytes(bytes) !== identity.hash) throw new Error(`the bootstrap plist changed: ${identity.path}`);
      return parseCanonicalLaunchdPlist(bytes);
    },
    verifyHash: (path, hash) => new NodeLaunchdPlistReader().verifyHash(path, hash),
  };
  const effectPorts = (context: CliLifecycleContext): LifecycleEffectPortsV1 => ({
    ...scriptedEffectPorts(scriptedGitRuntime(), { on: false })(context),
    launchd: { ...launchd.ports, plists },
  });
  const schedules = ["brain-reindex=daily@02:00", "brain-lint=daily@02:30", "doctor=weekly@mon,03:00", "brain-garden=weekly@sun,17:00"];

  async function installEntrypoint(fixture: CommandFixture, lifecycle: CliLifecycleContext): Promise<void> {
    const path = entrypointPath(fixture.paths.home);
    const content = new TextEncoder().encode(ENTRYPOINT);
    await withLifecycleMutation(fixture.context, lifecycle, async (authority) => {
      const state = await gatedState(fixture.context, authority);
      const common = {
        owner: "core",
        productVersion: state.manifest.productVersion,
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        mergeStrategy: "dedicated",
        verifiedAt: state.manifest.installedAt,
      };
      const parentOwned = state.manifest.artifacts.some((artifact) => artifact.path === dirname(path));
      const rows = [
        ...state.manifest.artifacts,
        ...(parentOwned ? [] : [{ ...common, path: dirname(path), source: "generated/directory", kind: "directory", verification: { mode: "content" } }]),
        { ...common, path, source: "generated/entrypoint", kind: "file", verification: { mode: "content", installedHash: hashBytes(content) } },
      ] as unknown as ManagedArtifactV2[];
      await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await fixture.context.executor.execute({
        kind: "entrypoint",
        mutations: [
          { targetPath: path, operation: "create", content },
          manifestMutation(fixture.context, { ...state.manifest, artifacts: rows.sort(compareManifestRows) }, state.manifestHash),
        ],
      });
    });
  }

  function pinHome(): Promise<{ readonly fixture: CommandFixture; readonly claude: string }> {
    return (async () => {
      const root = await nodeFs.mkdtemp(join(tmpdir(), "dos-garden-agent-"));
      const claude = join(root, "claude");
      await nodeFs.writeFile(claude, "#!/bin/sh\n", { mode: 0o755 });
      const discovery = (name: AgentName, path: string | null): AgentDiscovery => ({ name, installed: path !== null, executablePath: path, version: null });
      const fixture = await createCommandFixture("automation-garden-pin", {
        bootstrapAvailable: true,
        effectPorts,
        agents: { claude: discovery("claude", claude), codex: discovery("codex", null) },
      });
      await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
      const installed = await runInit(fixture.context, { dryRun: false, assumeYes: true });
      if (!installed.ok) throw new Error(`fixture init failed: ${JSON.stringify(installed)}`);
      await nodeFs.mkdir(join(fixture.userHome, "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
      await installEntrypoint(fixture, lifecycleOf(fixture));
      return { fixture, claude };
    })();
  }

  it("refuses capability_unavailable without a discoverable agent and writes nothing, then pins the discovered path (garden)", async () => {
    const { fixture, claude } = await pinHome();
    const nothingInstalled = new Proxy(fixture.context.platform, {
      get: (target, property): unknown =>
        property === "discoverExecutable"
          ? (name: AgentName) => Promise.resolve({ name, installed: false, executablePath: null, version: null })
          : Reflect.get(target, property),
    });
    const context: CliContext = { ...fixture.context, platform: nothingInstalled };
    const before = await inventoryDigest(fixture.paths.home);

    const refused = await runAutomation(context, { subcommand: "enable", schedules, gardenAgent: "claude", apply: true });

    expect(refused).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable, error: { kind: "capability_unavailable" } });
    expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
    expect(loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8")).automation.brainGarden).toBeUndefined();

    // Then, with claude discoverable, the same command pins it in the enable transaction.
    const result = await runAutomation(fixture.context, { subcommand: "enable", schedules, gardenAgent: "claude", apply: true });

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { kind: "applied", operation: "automation_enable" } });
    const config = loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8"));
    expect(config.automation.brainGarden).toStrictEqual({ agent: "claude", executable: claude });
    expect(config.automation.lifecycle?.schedules.map((entry) => entry.job)).toContain("brain-garden");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
