/**
 * `automation enable|disable|status` on one shared real V2 home. launchd is an injected domain —
 * the real `launchctl` never runs — while every lifecycle participant (Foundation, manifest, both
 * launchd effects) is real. Cases run in order and each leaves the home in the state the next reads.
 */
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  encodeCanonicalJson,
  hashBytes,
  hashCanonicalJson,
  lifecycleConfigHash,
  lifecycleReservationOrder,
  loadConfig,
  parseCanonicalAbsolutePathText,
  parseLifecycleActivationRecord,
  parseUtcTimestamp,
  serializeConfig,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleCoordinatorStore,
  ManagedArtifactV2,
  ScheduledJobIdV1,
} from "@developer-os/core";
import { DEFAULT_BRAIN_CONFIG } from "@developer-os/brain";
import {
  LaunchdDistributionUnsupportedError,
  NodeLaunchdPlistReader,
  encodeRetainedLaunchdPlist,
  generatedLabel,
  parseCanonicalLaunchdPlist,
} from "@developer-os/platform-macos";
import type { GeneratedLaunchdLabelV1, LaunchdPlanPreviewV1, LaunchdPlistPortV1 } from "@developer-os/platform-macos";

import { compareManifestRows } from "../../instructions/attach.js";
import { gatedState, manifestMutation, stableNodePath } from "../../instructions/apply.js";
import type { LifecycleEffectPortsV1 } from "../../lifecycle/adapters.js";
import { lifecycleVariantFacts } from "../../lifecycle/codecs.js";
import type { LifecycleExecutionPlanV1 } from "../../lifecycle/codecs.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import { automationLogSlotPath, automationRunnerLeasePath, automationStatusPath } from "../../lifecycle/runtime-records.js";
import { hostWith, scriptedLaunchd } from "../../lifecycle/testing.js";
import { renderEntrypoint } from "../../update/entrypoint.js";
import { entrypointPath } from "../../update/local-release.js";
import { runConfig } from "../config.js";
import { runGit } from "../git/index.js";
import { createBareRemote, scriptedEffectPorts, scriptedGitRuntime } from "../git/testing.js";
import { runInit } from "../init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { renderAutomation, runAutomation } from "./index.js";
import type { AutomationCommandDataV1, AutomationCommandResultV1 } from "./index.js";
import { createAutomationService } from "./service.js";

afterAll(removeCommandFixtures);

const UID = process.getuid?.() ?? 0;
const CLOCK = parseUtcTimestamp("2026-09-23T00:00:00.000Z");
const BASE_SCHEDULES = ["brain-reindex=daily@02:00", "brain-lint=daily@02:30", "doctor=weekly@mon,03:00"] as const;
/**
 * The entrypoint `init` renders, aimed at this checkout's built CLI (`tests/node_modules/@developer-os/cli`)
 * so a generated plist's argv can really be executed (NEW-144).
 */
const ENTRYPOINT = renderEntrypoint(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "tests"));
const encoder = new TextEncoder();

const host = { drifted: false, thirdState: false, belowFloor: false };
const [admittedHost, belowFloorHost] = [hostWith(), hostWith({ productVersion: "26.5" })];
/** Only `/bin/launchctl` is scripted: the plist reader, FD-3 snapshot and bootout runner are real. */
const launchd = scriptedLaunchd({
  clock: () => CLOCK,
  launchctl: "scripted",
  host: {
    operatingSystem: () => (host.belowFloor ? belowFloorHost : admittedHost).operatingSystem(),
    inspect: (path) => (host.belowFloor ? belowFloorHost : admittedHost).inspect(path),
  },
});
const runtime = scriptedGitRuntime();

/**
 * One-shot tampering around the real reader: `beforeRead` changes the published plist after
 * Foundation wrote it and returns how to put the bytes back (so the inverse transaction still
 * finds its postimage); `afterRead` swaps the path once the reader has admitted it.
 */
const plistFaults: {
  beforeRead: ((path: string) => Promise<() => Promise<void>>) | null;
  afterRead: ((path: string) => Promise<void>) | null;
} = { beforeRead: null, afterRead: null };
const realPlists = new NodeLaunchdPlistReader();
const plists: LaunchdPlistPortV1 = {
  read: async (identity) => {
    const tamper = plistFaults.beforeRead;
    plistFaults.beforeRead = null;
    const restore = await tamper?.(identity.path);
    try {
      const admitted = await realPlists.read(identity);
      const swap = plistFaults.afterRead;
      plistFaults.afterRead = null;
      await swap?.(identity.path);
      return admitted;
    } finally {
      await restore?.();
    }
  },
  verifyHash: (path, hash) => realPlists.verifyHash(path, hash),
};

/** Renames a fresh inode holding `bytes` over `path`, as an attacker (or Foundation) would. */
async function swapInode(path: string, bytes: Uint8Array | string): Promise<void> {
  await nodeFs.writeFile(`${path}.swap`, bytes, { mode: 0o600 });
  await nodeFs.rename(`${path}.swap`, path);
}

function effectPorts(context: CliLifecycleContext): LifecycleEffectPortsV1 {
  const ports = scriptedEffectPorts(runtime, { on: false })(context);
  return {
    ...ports,
    launchd: {
      ...launchd.ports,
      plists,
      observer: {
        observe: (request) =>
          host.drifted
            ? Promise.reject(new LaunchdDistributionUnsupportedError("operating system version is below the floor or malformed"))
            : launchd.ports.observer.observe(request).then((observed) =>
                host.thirdState && observed.kind === "observed"
                  ? { ...observed, jobs: observed.jobs.map((entry) => ({ ...entry, state: { kind: "third_state" as const, reason: "dual_generation" as const } })) }
                  : observed,
              ),
      },
    },
  };
}

interface AutomationHomeV1 extends CommandFixture {
  readonly remote: string;
  readonly lifecycle: CliLifecycleContext;
  readonly plans: LifecycleExecutionPlanV1[];
}

function recordingStore(
  store: LifecycleCoordinatorStore<LifecycleExecutionPlanV1>,
  plans: LifecycleExecutionPlanV1[],
): LifecycleCoordinatorStore<LifecycleExecutionPlanV1> {
  return new Proxy(store, {
    get(target, property): unknown {
      if (property === "publish") {
        return async (plan: LifecycleExecutionPlanV1, global: HeldLifecycleStableLockV1) => {
          plans.push(plan);
          return target.publish(plan, global);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

/** The fixture release carries no CLI, so the entrypoint row `init` would write is written here the same way. */
async function installSyntheticEntrypoint(fixture: CommandFixture, lifecycle: CliLifecycleContext): Promise<void> {
  const path = entrypointPath(fixture.paths.home);
  const content = ENTRYPOINT;
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

/**
 * Rewrites every installed plist into the nine-argument shape builds before NEW-144 wrote — argv[0]
 * the entrypoint, the label's generation over that argv — with matching manifest rows and the old
 * labels loaded, which is the founder's broken home.
 */
async function installLegacyPlists(home: AutomationHomeV1, jobs: readonly ScheduledJobIdV1[]): Promise<ReadonlyMap<ScheduledJobIdV1, GeneratedLaunchdLabelV1>> {
  const labels = new Map<ScheduledJobIdV1, GeneratedLaunchdLabelV1>();
  await withLifecycleMutation(home.context, home.lifecycle, async (authority) => {
    const state = await gatedState(home.context, authority);
    const mutations = [];
    const rows = [...state.manifest.artifacts];
    for (const job of jobs) {
      const path = plistPath(home, job);
      const current = await nodeFs.readFile(path);
      const plist = parseCanonicalLaunchdPlist(current);
      const legacyBase = plist.ProgramArguments.slice(1, 8);
      const generation = hashCanonicalJson("developer-os:launchd-generation:v1", { job, legacyBase });
      const label = generatedLabel(job, generation);
      const content = encoder.encode(
        encodeRetainedLaunchdPlist({ ...plist, Label: label, ProgramArguments: [...legacyBase, "--generation", generation] as unknown as typeof plist.ProgramArguments }),
      );
      mutations.push({ targetPath: path, operation: "replace" as const, content, expectedBeforeHash: hashBytes(current) });
      const index = rows.findIndex((row) => row.path === path);
      rows[index] = { ...rows[index], verification: { mode: "content", installedHash: hashBytes(content) } } as ManagedArtifactV2;
      labels.set(job, label);
    }
    await home.context.executor.execute({
      kind: "legacy-plists",
      mutations: [...mutations, manifestMutation(home.context, { ...state.manifest, artifacts: rows }, state.manifestHash)],
    });
  });
  for (const [job, label] of labels) launchd.loaded.set(job, label);
  return labels;
}

let shared: Promise<AutomationHomeV1> | null = null;

function sharedHome(): Promise<AutomationHomeV1> {
  shared ??= (async () => {
    const fixture = await createCommandFixture("automation-v2", { bootstrapAvailable: true, effectPorts });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const result = await runInit(fixture.context, { dryRun: false, assumeYes: true });
    if (!result.ok) throw new Error(`fixture init failed: ${JSON.stringify(result)}`);
    await nodeFs.mkdir(join(fixture.userHome, "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
    const base = lifecycleOf(fixture);
    await installSyntheticEntrypoint(fixture, base);
    const plans: LifecycleExecutionPlanV1[] = [];
    const lifecycle: CliLifecycleContext = { ...base, store: (key) => recordingStore(base.store(key), plans) };
    const remote = await createBareRemote(join(fixture.root, "remote.git"));
    return { ...fixture, remote, lifecycle, plans };
  })();
  return shared;
}

async function apply(
  home: AutomationHomeV1,
  command: "enable" | "disable",
  schedules: readonly string[] = [],
  context: CommandFixture["context"] = home.context,
): Promise<AutomationCommandResultV1> {
  const service = createAutomationService(context, home.lifecycle);
  const preview = command === "enable" ? await service.previewEnable(schedules) : await service.previewDisable();
  const global = await home.lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(home.paths.stateDir, ".lifecycle.lock")));
  try {
    return command === "enable" ? await service.applyEnable(preview, global) : await service.applyDisable(preview, global);
  } finally {
    await global.release();
  }
}

function dataOf(result: Awaited<ReturnType<typeof runAutomation>>): AutomationCommandDataV1 {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

function lastPlan(home: AutomationHomeV1): LifecycleExecutionPlanV1 {
  const plan = home.plans.at(-1);
  if (plan === undefined) throw new Error("no coordinator plan was published");
  return plan;
}

function stepNames(plan: LifecycleExecutionPlanV1): readonly string[] {
  return plan.steps.map((step) => {
    if (step.kind === "manifest") return `manifest:${step.transition}`;
    if (step.kind === "foundation") return `foundation:${step.slot}`;
    return step.kind;
  });
}

function entriesOf(plan: LifecycleExecutionPlanV1): NonNullable<LifecycleExecutionPlanV1["participants"]["launchd"]>["entries"] {
  const launchdPlan = plan.participants.launchd;
  if (launchdPlan === null) throw new Error("the plan carries no launchd leaf");
  return launchdPlan.entries;
}

function plistPath(home: AutomationHomeV1, job: ScheduledJobIdV1): string {
  return join(home.userHome, "Library", "LaunchAgents", `com.developer-os.${job}.plist`);
}

async function readConfig(home: AutomationHomeV1): Promise<ReturnType<typeof loadConfig>> {
  return loadConfig(await nodeFs.readFile(home.paths.configFile, "utf8"));
}

async function readManifest(home: AutomationHomeV1): Promise<InstallationManifestV2> {
  return JSON.parse(await nodeFs.readFile(home.paths.manifestFile, "utf8")) as InstallationManifestV2;
}

async function readOrNull(path: string): Promise<string | null> {
  return nodeFs.readFile(path, "utf8").catch(() => null);
}

function allocatorPath(home: AutomationHomeV1): string {
  return join(home.paths.stateDir, "lifecycle-id-allocator.json");
}

describe("automation on a real V2 home", () => {
  it(
    "keeps a forged config.toml automation lifecycle with no activation arm inert in status",
    async () => {
      const home = await sharedHome();
      const original = await nodeFs.readFile(home.paths.configFile, "utf8");
      const config = loadConfig(original);
      await nodeFs.writeFile(
        home.paths.configFile,
        serializeConfig({
          ...config,
          automation: {
            enabled: true,
            lifecycle: {
              schemaVersion: 1,
              schedules: (["brain-reindex", "brain-lint", "doctor"] as const).map((job) => ({ job, schedule: { cadence: "daily", hour: 2, minute: 0 } })),
            },
          },
        }),
      );
      try {
        const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
        expect(status).toMatchObject({ kind: "status", enabled: true, activation: "absent", closure: "clear" });
        if (status.kind !== "status") throw new Error("unreachable");
        expect(status.jobs.length).toBe(6);
        expect(status.jobs.every((job) => !job.eligible && job.installed === "absent")).toBe(true);
        expect(launchd.events).toStrictEqual([]);
      } finally {
        await nodeFs.writeFile(home.paths.configFile, original);
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "requires every eligible schedule on first enable, has no default time, and allocates nothing",
    async () => {
      const home = await sharedHome();
      const allocatorBefore = await nodeFs.readFile(allocatorPath(home));
      for (const schedules of [[], ["brain-reindex=daily@02:00"], [...BASE_SCHEDULES, "git-sync=hourly@15"]]) {
        const result = await runAutomation(home.context, { subcommand: "enable", schedules, apply: true });
        expect(result, schedules.join(" ")).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "automation_schedule_invalid" } });
      }
      expect(await nodeFs.readFile(allocatorPath(home))).toEqual(allocatorBefore);
      expect(launchd.events).toStrictEqual([]);
      expect(await readOrNull(plistPath(home, "doctor"))).toBeNull();
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "prints the same allocation-free enable preview twice, reconciling the full eligible set",
    async () => {
      const home = await sharedHome();
      const allocatorBefore = await nodeFs.readFile(allocatorPath(home));
      const staging = join(home.paths.stagingDir, "lifecycle");
      const stagingBefore = await nodeFs.readdir(staging).catch(() => [] as string[]);
      const request = { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: false } as const;
      const first = await runAutomation(home.context, request);
      const second = await runAutomation(home.context, request);
      expect(encodeCanonicalJson(first as unknown as CanonicalJsonValue)).toBe(encodeCanonicalJson(second as unknown as CanonicalJsonValue));
      const data = dataOf(first);
      if (data.kind !== "preview") throw new Error("not a preview");
      expect(data.preview.executionOperation).toBe("automation_enable");
      const entries = (data.preview.launchd as LaunchdPlanPreviewV1).entries;
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.map((entry) => [entry.job, entry.operation])).toStrictEqual([
        ["brain-reindex", "install"],
        ["brain-lint", "install"],
        ["doctor", "install"],
      ]);
      expect(await nodeFs.readFile(allocatorPath(home))).toEqual(allocatorBefore);
      expect(await nodeFs.readdir(staging).catch(() => [] as string[])).toStrictEqual(stagingBefore);
      expect(await readOrNull(plistPath(home, "doctor"))).toBeNull();
      expect(launchd.events).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it.each([
    {
      name: "bytes that grew after Foundation published them",
      cause: "launchd_plist_changed",
      fault: () => {
        plistFaults.beforeRead = async (path) => {
          const original = await nodeFs.readFile(path);
          await nodeFs.appendFile(path, "\n");
          return () => nodeFs.writeFile(path, original);
        };
      },
    },
    {
      name: "a different file of identical size swapped in after publish",
      cause: "launchd_bootstrap_plist_changed",
      fault: () => {
        plistFaults.beforeRead = async (path) => {
          const original = await nodeFs.readFile(path);
          const forged = Uint8Array.from(original);
          forged[forged.byteLength - 2] = 0x58;
          await swapInode(path, forged);
          return () => nodeFs.writeFile(path, original);
        };
      },
    },
    {
      name: "a byte-identical fresh inode swapped in after the reader admitted the file",
      cause: "launchd_bootstrap_plist_changed",
      fault: () => {
        plistFaults.afterRead = async (path) => swapInode(path, await nodeFs.readFile(path));
      },
    },
  ])(
    "refuses to bootstrap $name and rolls enable back naming the cause (NEW-138)",
    async ({ cause, fault }) => {
      const home = await sharedHome();
      const configBefore = await nodeFs.readFile(home.paths.configFile);
      fault();
      try {
        const result = await runAutomation(home.context, { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: true });
        expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired, error: { kind: "automation_lifecycle_rolled_back" } });
        if (result.ok) throw new Error("unreachable");
        expect(result.error.message).toBe(`automation refused: automation_lifecycle_rolled_back (cause: ${cause})`);
      } finally {
        plistFaults.beforeRead = null;
        plistFaults.afterRead = null;
      }
      expect(launchd.events).toStrictEqual([]);
      expect(launchd.loaded.size).toBe(0);
      for (const job of ["brain-reindex", "brain-lint", "doctor"] as const) expect(await readOrNull(plistPath(home, job))).toBeNull();
      expect(await nodeFs.readFile(home.paths.configFile)).toEqual(configBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it.each([
    {
      name: "a byte-identical fresh inode swapped in right after launchd read the path",
      fault: () => {
        launchd.faults.afterBootstrap = async (path) => swapInode(path, await nodeFs.readFile(path));
      },
    },
    { name: "a loaded job whose printed program is not the plan's", fault: () => (launchd.faults.print = "other_program") },
    { name: "a post-bootstrap print that fails", fault: () => (launchd.faults.print = "exit_5") },
  ])(
    "boots out $name and rolls enable back with launchd_bootstrap_plist_changed (D82)",
    async ({ fault }) => {
      const home = await sharedHome();
      const configBefore = await nodeFs.readFile(home.paths.configFile);
      const eventsBefore = launchd.events.length;
      fault();
      try {
        const result = await runAutomation(home.context, { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: true });
        expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired, error: { kind: "automation_lifecycle_rolled_back" } });
        if (result.ok) throw new Error("unreachable");
        expect(result.error.message).toBe("automation refused: automation_lifecycle_rolled_back (cause: launchd_bootstrap_plist_changed)");
      } finally {
        launchd.faults.afterBootstrap = null;
        launchd.faults.print = null;
      }
      const [first] = launchd.events.slice(eventsBefore);
      expect(first).toMatch(/^bootstrap com\.developer-os\.brain-reindex\.g\./u);
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([first, first?.replace("bootstrap", "bootout")]);
      expect(launchd.loaded.size).toBe(0);
      for (const job of ["brain-reindex", "brain-lint", "doctor"] as const) expect(await readOrNull(plistPath(home, job))).toBeNull();
      expect(await nodeFs.readFile(home.paths.configFile)).toEqual(configBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it.each([
    { name: "missing", make: (): Promise<void> => Promise.resolve() },
    { name: "not executable", make: async (path: string) => nodeFs.writeFile(path, "#!/bin/sh\n", { mode: 0o600 }) },
    { name: "a directory", make: async (path: string) => nodeFs.mkdir(path, { mode: 0o700 }) },
  ])(
    "refuses enable when the Node every plist would name is $name, and writes nothing (NEW-144)",
    async ({ name, make }) => {
      const home = await sharedHome();
      const node = join(home.root, `node-${name.replaceAll(" ", "-")}`);
      await make(node);
      const allocatorBefore = await nodeFs.readFile(allocatorPath(home));
      const eventsBefore = [...launchd.events];
      const result = await runAutomation({ ...home.context, nodeExecutable: node }, { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: true });
      expect(result).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable, error: { kind: "automation_node_unavailable" } });
      expect(await nodeFs.readFile(allocatorPath(home))).toEqual(allocatorBefore);
      expect(launchd.events).toStrictEqual(eventsBefore);
      expect(await readOrNull(plistPath(home, "doctor"))).toBeNull();
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "enables every eligible job, publishing plists, activation and manifest before loading, and the enabled config last",
    async () => {
      const home = await sharedHome();
      const eventsBefore = launchd.events.length;
      const result = await apply(home, "enable", BASE_SCHEDULES);
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_enable" });

      const plan = lastPlan(home);
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("automation_enable");
      expect(JSON.stringify(plan)).not.toMatch(/certif/u);
      expect(stepNames(plan)).toStrictEqual([
        "manifest:preserve_before",
        "foundation:plist_files",
        "foundation:activation",
        "manifest:publish_after",
        "launchd_after_files",
        "foundation:config",
        "manifest:finalize_tombstones",
      ]);
      expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "tx", "le", "mf"]);

      const entries = entriesOf(plan);
      expect(launchd.events.slice(eventsBefore)).toStrictEqual(entries.map((entry) => `bootstrap ${String(entry.generatedLabel)}`));
      const manifest = await readManifest(home);
      const node = await stableNodePath(process.execPath);
      expect(isAbsolute(node)).toBe(true);
      await nodeFs.access(node, constants.X_OK);
      for (const entry of entries) {
        expect(await nodeFs.readFile(entry.plistPath, "utf8")).toBe(entry.plistBytes);
        // NEW-144: launchd execs argv[0], so it is the absolute Node and the 0600 module is argv[1].
        const argv = parseCanonicalLaunchdPlist(encoder.encode(String(entry.plistBytes))).ProgramArguments;
        expect(argv.slice(0, 3)).toStrictEqual([node, entrypointPath(home.paths.home), "automation"]);
        expect(entry.baseArgv.slice(0, 2)).toStrictEqual([node, entrypointPath(home.paths.home)]);
        expect((await nodeFs.stat(entry.plistPath)).mode & 0o777).toBe(0o600);
        expect(entry.generatedLabel === null ? undefined : launchd.loaded.get(entry.job)).toBe(entry.generatedLabel);
        expect(manifest.artifacts.find((artifact) => artifact.path === entry.plistPath)).toMatchObject({
          owner: "macos",
          kind: "file",
          existedBefore: false,
          verification: { mode: "content", installedHash: hashBytes(encoder.encode(String(entry.plistBytes))) },
        });
      }
      const config = await readConfig(home);
      expect(config.automation.enabled).toBe(true);
      expect(config.automation.lifecycle?.schedules.map((entry) => entry.job)).toStrictEqual(["brain-reindex", "brain-lint", "doctor"]);
      const activation = parseLifecycleActivationRecord(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json")));
      if (config.automation.lifecycle === undefined) throw new Error("no automation lifecycle");
      expect(activation.automation).toStrictEqual({ state: "active", configHash: lifecycleConfigHash("automation", config.automation.lifecycle) });
      expect(await nodeFs.readdir(join(home.paths.stateDir, "launchd-effect-journals"))).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "execs a generated plist's ProgramArguments as launchd does: Node starts the CLI and the runner answers (NEW-144)",
    async () => {
      const home = await sharedHome();
      const argv = parseCanonicalLaunchdPlist(await nodeFs.readFile(plistPath(home, "doctor"))).ProgramArguments;
      // launchd's environment: HOME and a minimal PATH, no mise or Homebrew, no working directory.
      const env = { HOME: home.userHome, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
      // The pre-NEW-144 argv named the 0600, shebang-less module as the program: it cannot be executed.
      expect(spawnSync(argv[1], argv.slice(2), { cwd: "/", env }).error).toMatchObject({ code: "EACCES" });
      const run = spawnSync(argv[0], argv.slice(1), { cwd: "/", env, encoding: "utf8", timeout: 120_000 });
      expect(run.error).toBeUndefined();
      expect(run.signal).toBeNull();
      expect(run.stderr).not.toContain("could not be loaded");
      // Node loaded the entrypoint, the CLI parsed the scheduled invocation and admitted the product
      // home, and the runner answered with its own code: the production context does not admit this
      // fixture home's manifest (`manifest_invalid`, exit 6), and §5.3 takes the user home from the
      // account record, never this HOME. A full run is the NEW-144 real-host `launchctl kickstart`.
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(EXIT_CODES.recoveryRequired);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports configured, installed, live and last-run state without repairing anything",
    async () => {
      const home = await sharedHome();
      const eventsBefore = [...launchd.events];
      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      expect(status).toMatchObject({ kind: "status", enabled: true, activation: "active", distribution: "supported", closure: "clear" });
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.map((job) => [job.job, job.eligible, job.installed, job.live, job.lastRun])).toStrictEqual([
        ["brain-reindex", true, "current", "loaded", null],
        ["brain-lint", true, "current", "loaded", null],
        ["doctor", true, "current", "loaded", null],
        ["git-sync", false, "absent", null, null],
        // NEW-134: the optional jobs are eligible, but off until a --schedule names them.
        ["brain-garden", true, "absent", null, null],
        ["brain-pulse", true, "absent", null, null],
      ]);
      expect(launchd.events).toStrictEqual(eventsBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "replaces every pre-NEW-144 plist when enable runs again, reporting them stale until then",
    async () => {
      const home = await sharedHome();
      const currentBytes = new Map<ScheduledJobIdV1, string>();
      const jobs = ["brain-reindex", "brain-lint", "doctor"] as const;
      for (const job of jobs) currentBytes.set(job, await nodeFs.readFile(plistPath(home, job), "utf8"));
      const legacy = await installLegacyPlists(home, jobs);
      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.filter((job) => job.installed !== "absent").map((job) => [job.job, job.installed, job.live])).toStrictEqual(
        jobs.map((job) => [job, "stale", "loaded"]),
      );
      const eventsBefore = launchd.events.length;
      const result = await apply(home, "enable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      const plan = lastPlan(home);
      expect(entriesOf(plan).map((entry) => [entry.job, entry.operation])).toStrictEqual(jobs.map((job) => [job, "replace"]));
      expect(launchd.events.slice(eventsBefore)).toStrictEqual(
        [
          ...entriesOf(plan).map((entry) => `bootout ${String(legacy.get(entry.job))}`),
          ...entriesOf(plan).map((entry) => `bootstrap ${String(entry.generatedLabel)}`),
        ],
      );
      for (const job of jobs) expect(await nodeFs.readFile(plistPath(home, job), "utf8")).toBe(currentBytes.get(job));
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "disables a home holding pre-NEW-144 plists: boots their labels out and removes them",
    async () => {
      const home = await sharedHome();
      const jobs = ["brain-reindex", "brain-lint", "doctor"] as const;
      const legacy = await installLegacyPlists(home, jobs);
      const eventsBefore = launchd.events.length;
      const result = await apply(home, "disable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_disable" });
      expect(entriesOf(lastPlan(home)).map((entry) => [entry.job, entry.operation])).toStrictEqual(jobs.map((job) => [job, "remove"]));
      expect(launchd.events.slice(eventsBefore)).toStrictEqual(jobs.map((job) => `bootout ${String(legacy.get(job))}`));
      for (const job of jobs) expect(await readOrNull(plistPath(home, job))).toBeNull();
      expect(launchd.loaded.size).toBe(0);
      // Back to the state the later cases read.
      expect((await apply(home, "enable", BASE_SCHEDULES)).data).toMatchObject({ kind: "applied", operation: "automation_enable" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports node_unavailable once the Node the plists name is gone, and enable under a present Node replaces them",
    async () => {
      const home = await sharedHome();
      const link = join(home.root, "moved-node");
      await nodeFs.symlink(process.execPath, link);
      const moved = await apply(home, "enable", [], { ...home.context, nodeExecutable: link });
      expect(moved.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      expect(parseCanonicalLaunchdPlist(await nodeFs.readFile(plistPath(home, "doctor"))).ProgramArguments[0]).toBe(link);
      await nodeFs.unlink(link);
      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.filter((job) => job.installed !== "absent").map((job) => job.installed)).toStrictEqual(["node_unavailable", "node_unavailable", "node_unavailable"]);
      const restored = await apply(home, "enable");
      expect(restored.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      expect(entriesOf(lastPlan(home)).map((entry) => entry.operation)).toStrictEqual(["replace", "replace", "replace"]);
      const after = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      if (after.kind !== "status") throw new Error("unreachable");
      expect(after.jobs.filter((job) => job.installed !== "absent").map((job) => job.installed)).toStrictEqual(["current", "current", "current"]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports launchd's non-zero last exit for a loaded job with no status record (NEW-169)",
    async () => {
      const home = await sharedHome();
      // Run alone (`-t`), the shared home is not enabled yet; in file order an earlier case enabled it.
      if (!launchd.loaded.has("doctor")) await apply(home, "enable", BASE_SCHEDULES);
      launchd.exits.set("doctor", 78);
      try {
        const result = await runAutomation(home.context, { subcommand: "status" });
        const status = dataOf(result);
        if (status.kind !== "status") throw new Error("unreachable");
        const doctor = status.jobs.find((job) => job.job === "doctor");
        expect(doctor).toMatchObject({ live: "loaded", lastRun: null, launchdExit: 78 });
        expect(status.jobs.filter((job) => job.job !== "doctor").every((job) => job.launchdExit === undefined)).toBe(true);
        expect(renderAutomation(status).some((line) => line.startsWith("doctor") && line.endsWith("last run never; launchd exit 78, no run recorded since"))).toBe(true);
      } finally {
        launchd.exits.clear();
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports unsupported_launchd_distribution in status on a host below the macOS floor, without refusing",
    async () => {
      const home = await sharedHome();
      const eventsBefore = [...launchd.events];
      host.belowFloor = true;
      try {
        const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
        expect(status).toMatchObject({ kind: "status", activation: "active", distribution: "unsupported_launchd_distribution" });
      } finally {
        host.belowFloor = false;
      }
      expect(launchd.events).toStrictEqual(eventsBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports a live third state in status instead of hiding it as unobserved",
    async () => {
      const home = await sharedHome();
      host.thirdState = true;
      try {
        const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
        if (status.kind !== "status") throw new Error("unreachable");
        expect(status.jobs.map((job) => [job.job, job.live])).toStrictEqual([
          ["brain-reindex", "third_state"],
          ["brain-lint", "third_state"],
          ["doctor", "third_state"],
          ["git-sync", null],
          ["brain-garden", null],
          ["brain-pulse", null],
        ]);
      } finally {
        host.thirdState = false;
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses a preview that went stale before apply and changes nothing",
    async () => {
      const home = await sharedHome();
      const service = createAutomationService(home.context, home.lifecycle);
      const preview = await service.previewEnable(["doctor=daily@04:00"]);
      /** Fresh `init` writes no `[brain]` table, so the whole section is the change that stales the preview. */
      const changed = await runConfig(home.context, {
        operation: "set",
        key: "brain",
        value: encodeCanonicalJson(DEFAULT_BRAIN_CONFIG as unknown as CanonicalJsonValue).slice(0, -1),
      });
      expect(changed.ok, JSON.stringify(changed)).toBe(true);
      const eventsBefore = [...launchd.events];
      const doctorBefore = await nodeFs.readFile(plistPath(home, "doctor"), "utf8");
      const allocatorBefore = await nodeFs.readFile(allocatorPath(home));
      const global = await home.lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(home.paths.stateDir, ".lifecycle.lock")));
      try {
        await expect(service.applyEnable(preview, global)).rejects.toMatchObject({ reason: "lifecycle_preview_stale", code: EXIT_CODES.decisionRequired });
      } finally {
        await global.release();
      }
      expect(launchd.events).toStrictEqual(eventsBefore);
      expect(await nodeFs.readFile(plistPath(home, "doctor"), "utf8")).toBe(doctorBefore);
      expect(await nodeFs.readFile(allocatorPath(home))).toEqual(allocatorBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "replaces one schedule: unloads the old generation, rewrites its plist and loads the new one",
    async () => {
      const home = await sharedHome();
      const oldLabel = launchd.loaded.get("doctor");
      const eventsBefore = launchd.events.length;
      const result = await apply(home, "enable", ["doctor=daily@04:00"]);
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      const plan = lastPlan(home);
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("automation_reconcile/files");
      const doctor = entriesOf(plan).find((entry) => entry.job === "doctor");
      expect(doctor?.operation).toBe("replace");
      expect(entriesOf(plan).filter((entry) => entry.job !== "doctor").every((entry) => entry.operation === "keep")).toBe(true);
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([`bootout ${String(oldLabel)}`, `bootstrap ${String(doctor?.generatedLabel)}`]);
      expect(await nodeFs.readFile(plistPath(home, "doctor"), "utf8")).toBe(doctor?.plistBytes);
      expect((await readConfig(home)).automation.lifecycle?.schedules.find((entry) => entry.job === "doctor")?.schedule).toStrictEqual({
        cadence: "daily",
        hour: 4,
        minute: 0,
      });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "rolls a failed schedule change back, reloading the restored preimage through its fresh inode (NEW-138)",
    async () => {
      const home = await sharedHome();
      const path = plistPath(home, "doctor");
      const oldLabel = launchd.loaded.get("doctor");
      const oldBytes = await nodeFs.readFile(path, "utf8");
      const oldInode = (await nodeFs.stat(path)).ino;
      const service = createAutomationService(home.context, home.lifecycle);
      const preview = await service.previewEnable(["doctor=daily@05:00"]);
      const newLabel = (preview.launchd as LaunchdPlanPreviewV1).entries.find((entry) => entry.job === "doctor")?.generatedLabel;
      if (newLabel === undefined || newLabel === null || oldLabel === undefined) throw new Error("doctor must change generation");
      const eventsBefore = launchd.events.length;
      launchd.failingBootstraps.add(newLabel);
      try {
        const result = await runAutomation(home.context, { subcommand: "enable", schedules: ["doctor=daily@05:00"], apply: true });
        expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired, error: { kind: "automation_lifecycle_rolled_back" } });
        if (result.ok) throw new Error("unreachable");
        expect(result.error.message).toBe("automation refused: automation_lifecycle_rolled_back (cause: launchd_command_failed)");
      } finally {
        launchd.failingBootstraps.clear();
      }
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([`bootout ${oldLabel}`, `bootstrap ${newLabel}`, `bootstrap ${oldLabel}`]);
      expect(launchd.loaded.get("doctor")).toBe(oldLabel);
      expect(await nodeFs.readFile(path, "utf8")).toBe(oldBytes);
      expect((await nodeFs.stat(path)).ino).not.toBe(oldInode);
      expect((await readConfig(home)).automation.lifecycle?.schedules.find((entry) => entry.job === "doctor")?.schedule).toStrictEqual({
        cadence: "daily",
        hour: 4,
        minute: 0,
      });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reconciles live only when a kept job is unloaded, loading exactly that generation and writing no file",
    async () => {
      const home = await sharedHome();
      const doctorLabel = launchd.loaded.get("doctor");
      launchd.loaded.delete("doctor");
      const configBefore = await nodeFs.readFile(home.paths.configFile);
      const manifestBefore = await nodeFs.readFile(home.paths.manifestFile);
      const eventsBefore = launchd.events.length;
      const result = await apply(home, "enable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      const plan = lastPlan(home);
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("automation_reconcile/live_only");
      expect(stepNames(plan)).toStrictEqual(["launchd_after_files"]);
      expect(plan.participants.foundation).toStrictEqual([]);
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([`bootstrap ${String(doctorLabel)}`]);
      expect(await nodeFs.readFile(home.paths.configFile)).toEqual(configBefore);
      expect(await nodeFs.readFile(home.paths.manifestFile)).toEqual(manifestBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "a later git enable does not touch launchd; re-running automation enable requires and then adds git-sync",
    async () => {
      const home = await sharedHome();
      const eventsBefore = launchd.events.length;
      const enabled = await runGit(home.context, { subcommand: "enable", remote: home.remote, branch: null, apply: true });
      expect(enabled.ok, JSON.stringify(enabled)).toBe(true);
      expect(launchd.events.length).toBe(eventsBefore);
      expect(await readOrNull(plistPath(home, "git-sync"))).toBeNull();

      const missing = await runAutomation(home.context, { subcommand: "enable", schedules: [], apply: false });
      expect(missing).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "automation_schedule_invalid" } });

      const result = await apply(home, "enable", ["git-sync=hourly@15"]);
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      const entries = entriesOf(lastPlan(home));
      expect(entries.map((entry) => [entry.job, entry.operation])).toStrictEqual([
        ["brain-reindex", "keep"],
        ["brain-lint", "keep"],
        ["doctor", "keep"],
        ["git-sync", "install"],
      ]);
      const gitSync = entries.find((entry) => entry.job === "git-sync");
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([`bootstrap ${String(gitSync?.generatedLabel)}`]);
      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.find((job) => job.job === "git-sync")).toMatchObject({ eligible: true, installed: "current", live: "loaded" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "marks an installed git-sync stale after git disable, and the next reconcile removes it",
    async () => {
      const home = await sharedHome();
      const gitSyncLabel = launchd.loaded.get("git-sync");
      const eventsBefore = launchd.events.length;
      const disabled = await runGit(home.context, { subcommand: "disable", apply: true });
      expect(disabled.ok, JSON.stringify(disabled)).toBe(true);
      expect(launchd.events.length).toBe(eventsBefore);

      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.find((job) => job.job === "git-sync")).toMatchObject({ eligible: false, installed: "stale", live: "loaded" });

      const preview = dataOf(await runAutomation(home.context, { subcommand: "enable", schedules: [], apply: false }));
      if (preview.kind !== "preview") throw new Error("not a preview");
      expect((preview.preview.launchd as LaunchdPlanPreviewV1).entries.find((entry) => entry.job === "git-sync")?.operation).toBe("remove");

      const result = await apply(home, "enable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_reconcile" });
      expect(launchd.events.slice(eventsBefore)).toStrictEqual([`bootout ${String(gitSyncLabel)}`]);
      expect(await readOrNull(plistPath(home, "git-sync"))).toBeNull();
      expect((await readManifest(home)).artifacts.some((artifact) => artifact.path === plistPath(home, "git-sync"))).toBe(false);
      expect((await readConfig(home)).automation.lifecycle?.schedules.map((entry) => entry.job)).toStrictEqual(["brain-reindex", "brain-lint", "doctor"]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses disable on a drifted launchctl row, naming the manual bootout, and mutates nothing",
    async () => {
      const home = await sharedHome();
      const jobs: readonly ScheduledJobIdV1[] = ["brain-reindex", "brain-lint", "doctor"];
      const plistsBefore = await Promise.all(jobs.map((job) => nodeFs.readFile(plistPath(home, job), "utf8")));
      const eventsBefore = [...launchd.events];
      const configBefore = await nodeFs.readFile(home.paths.configFile);
      host.drifted = true;
      try {
        const result = await runAutomation(home.context, { subcommand: "disable", apply: true });
        expect(result).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable, error: { kind: "unsupported_launchd_distribution" } });
        if (result.ok) throw new Error("unreachable");
        expect(result.error.message).toContain("every file is preserved");
        for (const job of jobs) expect(result.error.message).toContain(`launchctl bootout gui/${String(UID)}/com.developer-os.${job}.g.`);

        const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
        expect(status).toMatchObject({ kind: "status", distribution: "unsupported_launchd_distribution" });
        if (status.kind !== "status") throw new Error("unreachable");
        expect(status.jobs.every((job) => job.live === null)).toBe(true);
      } finally {
        host.drifted = false;
      }
      expect(await Promise.all(jobs.map((job) => nodeFs.readFile(plistPath(home, job), "utf8")))).toStrictEqual(plistsBefore);
      expect(launchd.events).toStrictEqual(eventsBefore);
      expect(await nodeFs.readFile(home.paths.configFile)).toEqual(configBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "disables every installed job, preserving schedules, logs, status and every runtime reservation",
    async () => {
      const home = await sharedHome();
      const eventsBefore = launchd.events.length;
      const loaded = new Map(launchd.loaded);
      const result = await apply(home, "disable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_disable" });
      const plan = lastPlan(home);
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("automation_disable");
      const entries = entriesOf(plan);
      expect(entries.map((entry) => entry.operation)).toStrictEqual(["remove", "remove", "remove"]);
      expect(launchd.events.slice(eventsBefore)).toStrictEqual(entries.map((entry) => `bootout ${String(loaded.get(entry.job))}`));
      expect(launchd.loaded.size).toBe(0);
      for (const job of ["brain-reindex", "brain-lint", "doctor"] as const) expect(await readOrNull(plistPath(home, job))).toBeNull();

      const config = await readConfig(home);
      expect(config.automation.enabled).toBe(false);
      expect(config.automation.lifecycle?.schedules.map((entry) => entry.job)).toStrictEqual(["brain-reindex", "brain-lint", "doctor"]);
      const activation = parseLifecycleActivationRecord(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json")));
      expect(activation.automation).toStrictEqual({ state: "inactive" });
      const productHome = parseCanonicalAbsolutePathText(home.paths.home);
      for (const job of ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const) {
        expect(await readOrNull(automationStatusPath(productHome, job))).not.toBeNull();
        expect(await readOrNull(automationRunnerLeasePath(productHome, job))).not.toBeNull();
        expect(await readOrNull(automationLogSlotPath(productHome, job, 0))).not.toBeNull();
      }

      expect(await runAutomation(home.context, { subcommand: "disable", apply: false })).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "automation_already_disabled" },
      });
      const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
      expect(status).toMatchObject({ kind: "status", enabled: false, activation: "inactive" });
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.every((job) => job.installed === "absent" && !job.eligible)).toBe(true);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "re-enables from the preserved schedules without asking for them again",
    async () => {
      const home = await sharedHome();
      const result = await apply(home, "enable");
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_enable" });
      expect(entriesOf(lastPlan(home)).map((entry) => entry.operation)).toStrictEqual(["install", "install", "install"]);
      expect(launchd.loaded.size).toBe(3);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});
