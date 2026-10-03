import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  hashBytes,
  loadConfig,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLowerHexSha256,
  parseUtcTimestamp,
  serializeConfig,
} from "@developer-os/core";
import type { InstallationManifestV2, ManagedArtifactV2 } from "@developer-os/core";
import { launchdGuiDomain, launchdPlistPath } from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";

import { failureFrom } from "../../context.js";
import type { CliContext } from "../../context.js";
import { compareManifestRows } from "../../instructions/attach.js";
import { gatedState, manifestMutation } from "../../instructions/apply.js";
import type { LifecycleEffectPortsV1 } from "../../lifecycle/adapters.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import { automationStatusPath, parseAutomationStatusRecord } from "../../lifecycle/runtime-records.js";
import { hostWith, scriptedLaunchd } from "../../lifecycle/testing.js";
import { entrypointPath } from "../../update/local-release.js";
import { scriptedEffectPorts, scriptedGitRuntime } from "../git/testing.js";
import { runInit } from "../init.js";
import { createCommandFixture, inventoryDigest, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runAutomation } from "./index.js";
import { AutomationRunner, createAutomationRunnerDependencies, scheduledEligibility } from "./runner.js";
import { AutomationCommandRefusal, createAutomationService, verifiedAutomationExecutable } from "./service.js";

afterEach(removeCommandFixtures);

/** A proxied adapter's own methods run on the adapter itself, whose private fields a proxy lacks. */
function bound(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property);
  return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
}

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
  /** One scripted launchd per home: its loaded labels are per job, so a shared one leaks between cases. */
  const effectPorts = (launchd: ReturnType<typeof scriptedLaunchd>) => (context: CliLifecycleContext): LifecycleEffectPortsV1 => ({
    ...scriptedEffectPorts(scriptedGitRuntime(), { on: false })(context),
    launchd: launchd.ports,
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
        effectPorts: effectPorts(scriptedLaunchd({ clock: () => parseUtcTimestamp("2026-10-01T00:00:00.000Z"), host: hostWith() })),
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

  it("refuses capability_unavailable without a discoverable agent and writes nothing, then pins and keeps the discovered path (garden)", async () => {
    const { fixture, claude } = await pinHome();
    const nothingInstalled = new Proxy(fixture.context.platform, {
      get: (target, property): unknown =>
        property === "discoverExecutable"
          ? (name: AgentName) => Promise.resolve({ name, installed: false, executablePath: null, version: null })
          : bound(target, property),
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

    const pinAfter = async (request: Parameters<typeof runAutomation>[1], on: CliContext = fixture.context) => {
      const applied = await runAutomation(on, request);
      expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, data: { kind: "applied" } });
      return loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8")).automation.brainGarden;
    };
    // Ruling 34: an unrelated schedule change keeps the pin, even with the agent uninstalled.
    expect(await pinAfter({ subcommand: "enable", schedules: ["doctor=weekly@tue,03:00"], apply: true }, context)).toStrictEqual({
      agent: "claude",
      executable: claude,
    });
    // Ruling 38: the scheduled gardener refuses Codex — named, or resolved because claude is absent — and writes nothing.
    const codex = join(dirname(claude), "codex");
    await nodeFs.writeFile(codex, "#!/bin/sh\n", { mode: 0o755 });
    const codexOnly: CliContext = {
      ...fixture.context,
      platform: new Proxy(fixture.context.platform, {
        get: (target, property): unknown =>
          property === "discoverExecutable"
            ? (name: AgentName) => Promise.resolve({ name, installed: name === "codex", executablePath: name === "codex" ? codex : null, version: null })
            : bound(target, property),
      }),
    };
    const refusesCodex = async (request: Parameters<typeof runAutomation>[1], on: CliContext): Promise<void> => {
      const unchanged = await inventoryDigest(fixture.paths.home);
      const codexRefused = await runAutomation(on, request);
      expect(codexRefused).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable, error: { kind: "capability_unavailable" } });
      expect(JSON.stringify(codexRefused)).toContain("Codex has no tool-free mode");
      expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(unchanged);
    };
    await refusesCodex({ subcommand: "enable", schedules: ["doctor=weekly@wed,03:00"], gardenAgent: "codex", apply: true }, fixture.context);
    await refusesCodex({ subcommand: "enable", schedules: ["doctor=weekly@wed,03:00"], gardenAgent: "codex", apply: false }, codexOnly);
    // Disable keeps the pin; enable without --garden-agent keeps it without resolving anything.
    expect(await pinAfter({ subcommand: "disable", apply: true })).toStrictEqual({ agent: "claude", executable: claude });
    expect(await pinAfter({ subcommand: "enable", schedules: [], apply: true }, context)).toStrictEqual({ agent: "claude", executable: claude });
    // Removing the job drops the pin and removes its plist (Ruling 39).
    const gardenPlist = launchdPlistPath(parseCanonicalAbsolutePathText(fixture.userHome), "brain-garden");
    expect((await nodeFs.lstat(gardenPlist)).isFile()).toBe(true);
    expect(await pinAfter({ subcommand: "enable", schedules: ["brain-garden=off"], apply: true })).toBeUndefined();
    await expect(nodeFs.lstat(gardenPlist)).rejects.toMatchObject({ code: "ENOENT" });
    // Scheduling it again with only codex installed resolves codex, which is refused the same way.
    await refusesCodex({ subcommand: "enable", schedules: ["brain-garden=weekly@sun,17:00"], apply: true }, codexOnly);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** Ruling 37: the pin is part of the activation, so retargeting config.toml after enable stops the job. */
  it("records automation_disabled and spawns nothing when config.toml's pinned executable changes after enable", async () => {
    const { fixture } = await pinHome();
    const lifecycle = lifecycleOf(fixture);
    const enabled = await runAutomation(fixture.context, { subcommand: "enable", schedules, gardenAgent: "claude", apply: true });
    expect(enabled, JSON.stringify(enabled)).toMatchObject({ ok: true, data: { kind: "applied" } });
    expect(await scheduledEligibility(fixture.context, lifecycle, "brain-garden")).toBe("active");

    const config = loadConfig(await nodeFs.readFile(fixture.paths.configFile, "utf8"));
    await nodeFs.writeFile(
      fixture.paths.configFile,
      serializeConfig({ ...config, automation: { ...config.automation, brainGarden: { agent: "claude", executable: "/bin/sh" } } }),
      { mode: 0o600 },
    );
    expect(await scheduledEligibility(fixture.context, lifecycle, "brain-garden")).toBe("automation_disabled");

    const spawned: string[] = [];
    const uid = process.getuid?.() ?? 0;
    const production = createAutomationRunnerDependencies(fixture.context, lifecycle, {
      userHome: parseCanonicalAbsolutePathText(fixture.userHome),
      domain: launchdGuiDomain(parseEffectiveUid(uid, uid)),
      executablePath: parseCanonicalAbsolutePathText(entrypointPath(fixture.paths.home)),
    });
    const runner = new AutomationRunner({
      ...production,
      authenticate: () => Promise.resolve(),
      handlers: {
        run: (job) => {
          spawned.push(job);
          return Promise.reject(new Error("the handler must not run"));
        },
      },
    });

    expect(await runner.run({ job: "brain-garden", generation: parseLowerHexSha256("b".repeat(64)) })).toStrictEqual({
      kind: "recorded",
      outcome: "automation_disabled",
    });
    expect(spawned).toStrictEqual([]);
    const status = parseAutomationStatusRecord(await nodeFs.readFile(automationStatusPath(parseCanonicalAbsolutePathText(fixture.paths.home), "brain-garden")));
    expect(status).toMatchObject({ job: "brain-garden", outcome: "automation_disabled", reasonCode: "automation_disabled" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("installs and loads a current plist for both optional jobs beside the mandatory three", async () => {
    const { fixture } = await pinHome();

    const result = await runAutomation(fixture.context, { subcommand: "enable", schedules: [...schedules, "brain-pulse=daily@07:00"], apply: true });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { kind: "applied", operation: "automation_enable" } });

    const status = await runAutomation(fixture.context, { subcommand: "status" });
    if (!status.ok || status.data.kind !== "status") throw new Error(JSON.stringify(status));
    const installed = status.data.jobs.filter((job) => job.eligible && job.installed === "current").map((job) => job.job);
    // git-sync stays ineligible without Git, so five of the six registry jobs.
    expect(installed).toStrictEqual(["brain-reindex", "brain-lint", "doctor", "brain-garden", "brain-pulse"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
