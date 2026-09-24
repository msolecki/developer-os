/**
 * `automation enable|disable|status` on one shared real V2 home. launchd is an injected domain —
 * the real `launchctl` never runs — while every lifecycle participant (Foundation, manifest, both
 * launchd effects) is real. Cases run in order and each leaves the home in the state the next reads.
 */
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  encodeCanonicalJson,
  hashBytes,
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
  parseCanonicalLaunchdPlist,
} from "@developer-os/platform-macos";
import type { LaunchdBootstrapPlistIdentityV1, LaunchdPlanPreviewV1, LaunchdPlistPortV1 } from "@developer-os/platform-macos";

import { compareManifestRows } from "../../instructions/attach.js";
import { gatedState, manifestMutation } from "../../instructions/apply.js";
import type { LifecycleEffectPortsV1 } from "../../lifecycle/adapters.js";
import { lifecycleVariantFacts } from "../../lifecycle/codecs.js";
import type { LifecycleExecutionPlanV1 } from "../../lifecycle/codecs.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import { automationLogSlotPath, automationRunnerLeasePath, automationStatusPath } from "../../lifecycle/runtime-records.js";
import { scriptedLaunchd } from "../../lifecycle/testing.js";
import { entrypointPath } from "../../update/local-release.js";
import { runConfig } from "../config.js";
import { runGit } from "../git/index.js";
import { createBareRemote, scriptedEffectPorts, scriptedGitRuntime } from "../git/testing.js";
import { runInit } from "../init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runAutomation } from "./index.js";
import type { AutomationCommandDataV1, AutomationCommandResultV1 } from "./index.js";
import { createAutomationService } from "./service.js";

afterAll(removeCommandFixtures);

const UID = process.getuid?.() ?? 0;
const CLOCK = parseUtcTimestamp("2026-09-23T00:00:00.000Z");
const BASE_SCHEDULES = ["brain-reindex=daily@02:00", "brain-lint=daily@02:30", "doctor=weekly@mon,03:00"] as const;
const ENTRYPOINT = "// synthetic Developer OS entrypoint\n";
const encoder = new TextEncoder();

const launchd = scriptedLaunchd({ clock: () => CLOCK, certified: true });
const host = { drifted: false };
const runtime = scriptedGitRuntime();

/**
 * Foundation publishes a plist through a fresh temp inode and a rename, so the staged-postimage
 * inode the plan binds is never the published file's on a real host (reported with plan 1b
 * Task 17). This reader keeps the path, hash and canonical-byte checks and drops only that
 * inode comparison, so the rest of the protocol is exercised.
 */
const hashBoundPlists: LaunchdPlistPortV1 = {
  read: async (identity: LaunchdBootstrapPlistIdentityV1) => {
    const bytes = await nodeFs.readFile(identity.path);
    if (hashBytes(bytes) !== identity.hash) throw new Error(`the bootstrap plist changed: ${identity.path}`);
    return parseCanonicalLaunchdPlist(bytes);
  },
  verifyHash: (path, hash) => new NodeLaunchdPlistReader().verifyHash(path, hash),
};

function effectPorts(context: CliLifecycleContext): LifecycleEffectPortsV1 {
  const ports = scriptedEffectPorts(runtime, { on: false })(context);
  return {
    ...ports,
    launchd: {
      ...launchd.ports,
      plists: hashBoundPlists,
      observer: {
        observe: (request) =>
          host.drifted
            ? Promise.reject(new LaunchdDistributionUnsupportedError("operating system build 25G84 is not the pinned row"))
            : launchd.ports.observer.observe(request),
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
  const content = encoder.encode(ENTRYPOINT);
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

async function apply(home: AutomationHomeV1, command: "enable" | "disable", schedules: readonly string[] = []): Promise<AutomationCommandResultV1> {
  const service = createAutomationService(home.context, home.lifecycle);
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
        expect(status.jobs.length).toBe(4);
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

  it(
    "enables every eligible job, publishing plists, activation and manifest before loading, and the enabled config last",
    async () => {
      const home = await sharedHome();
      const result = await apply(home, "enable", BASE_SCHEDULES);
      expect(result.data).toMatchObject({ kind: "applied", operation: "automation_enable" });

      const plan = lastPlan(home);
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("automation_enable");
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
      expect(launchd.events).toStrictEqual(entries.map((entry) => `bootstrap ${String(entry.generatedLabel)}`));
      const manifest = await readManifest(home);
      for (const entry of entries) {
        expect(await nodeFs.readFile(entry.plistPath, "utf8")).toBe(entry.plistBytes);
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
      ]);
      expect(launchd.events).toStrictEqual(eventsBefore);
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
