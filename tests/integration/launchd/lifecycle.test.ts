/**
 * Plan 1b Task 20: `automation` end to end on one real V2 home through an injected launchd
 * domain only — the real `launchctl` never runs, so nothing here loads, unloads or inspects a
 * job on the host. Git is never enabled, so `git-sync` stays ineligible throughout. Cases run
 * in order and each leaves the home in the state the next one reads.
 */
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES, parseCanonicalAbsolutePathText, validateLifecyclePlanGrammar } from "@developer-os/core";
import type { ScheduledJobIdV1 } from "@developer-os/core";
import { runAutomation } from "@developer-os/cli/dist/commands/automation/index.js";
import type { AutomationCommandDataV1 } from "@developer-os/cli/dist/commands/automation/index.js";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";
import { lifecycleVariantFacts } from "@developer-os/cli/dist/lifecycle/codecs.js";
import { automationStatusPath, parseAutomationStatusRecord } from "@developer-os/cli/dist/lifecycle/runtime-records.js";

import { BASE_SCHEDULES, createOptInHome, plistPath, readOrNull, runScheduledJob } from "../../helpers/opt-in-home.js";
import type { OptInHomeV1 } from "../../helpers/opt-in-home.js";

afterAll(removeCommandFixtures);

const INSTALLED: readonly ScheduledJobIdV1[] = ["brain-reindex", "brain-lint", "doctor"];

let shared: Promise<OptInHomeV1> | null = null;

function sharedHome(): Promise<OptInHomeV1> {
  shared ??= createOptInHome("launchd-lifecycle");
  return shared;
}

function dataOf(result: Awaited<ReturnType<typeof runAutomation>>): AutomationCommandDataV1 {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

async function statusOf(home: OptInHomeV1): Promise<Extract<AutomationCommandDataV1, { readonly kind: "status" }>> {
  const status = dataOf(await runAutomation(home.context, { subcommand: "status" }));
  if (status.kind !== "status") throw new Error("not a status");
  return status;
}

function statusRecordPath(home: OptInHomeV1, job: ScheduledJobIdV1): string {
  return automationStatusPath(parseCanonicalAbsolutePathText(home.paths.home), job);
}

async function statusRecords(home: OptInHomeV1): Promise<readonly (string | null)[]> {
  return Promise.all(INSTALLED.map((job) => readOrNull(statusRecordPath(home, job))));
}

async function plists(home: OptInHomeV1): Promise<readonly (string | null)[]> {
  return Promise.all(INSTALLED.map((job) => readOrNull(plistPath(home, job))));
}

async function recoverThroughNextMutation(home: OptInHomeV1): Promise<void> {
  const reindex = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
  expect(reindex.ok, JSON.stringify(reindex)).toBe(true);
}

describe("automation end to end through an injected launchd domain", () => {
  it(
    "keeps a disabled automation inert: status and disable load, write and run nothing",
    async () => {
      const home = await sharedHome();
      const records = await statusRecords(home);
      expect(await statusOf(home)).toMatchObject({ enabled: false, activation: "absent", closure: "clear" });
      expect(await runAutomation(home.context, { subcommand: "disable", apply: false })).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "automation_already_disabled" },
      });
      expect(home.launchd.events).toStrictEqual([]);
      expect(await plists(home)).toStrictEqual([null, null, null]);
      expect(await statusRecords(home)).toStrictEqual(records);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "loads and writes nothing after an enable dies right after its plan is published, and the next apply recovers first",
    async () => {
      const home = await sharedHome();
      const records = await statusRecords(home);
      home.faults.deathAfterPublish = true;
      try {
        expect((await runAutomation(home.context, { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: true })).ok).toBe(false);
      } finally {
        home.faults.deathAfterPublish = false;
      }
      expect(home.launchd.events).toStrictEqual([]);
      expect(await plists(home)).toStrictEqual([null, null, null]);
      expect(await statusRecords(home)).toStrictEqual(records);

      await recoverThroughNextMutation(home);
      expect(dataOf(await runAutomation(home.context, { subcommand: "enable", schedules: [...BASE_SCHEDULES], apply: true }))).toMatchObject({
        kind: "applied",
        operation: "automation_enable",
      });
      expect([...home.launchd.loaded.keys()].sort()).toStrictEqual([...INSTALLED].sort());
      expect(home.launchd.events.map((event) => event.split(" ")[0])).toStrictEqual(["bootstrap", "bootstrap", "bootstrap"]);
      expect((await plists(home)).every((bytes) => bytes !== null)).toBe(true);
      const status = await statusOf(home);
      expect(status.jobs.map((job) => [job.job, job.installed, job.live])).toStrictEqual([
        ["brain-reindex", "current", "loaded"],
        ["brain-lint", "current", "loaded"],
        ["doctor", "current", "loaded"],
        ["git-sync", "absent", null],
        // NEW-134: the optional jobs are off until a --schedule names them.
        ["brain-garden", "absent", null],
        ["brain-pulse", "absent", null],
      ]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "runs a scheduled job against its installed generation and records its status",
    async () => {
      const home = await sharedHome();
      const eventsBefore = [...home.launchd.events];
      expect(await runScheduledJob(home, "brain-lint")).toStrictEqual({ kind: "recorded", outcome: "success" });
      expect(parseAutomationStatusRecord(await nodeFs.readFile(statusRecordPath(home, "brain-lint")))).toMatchObject({
        job: "brain-lint",
        outcome: "success",
        reasonCode: "ok",
      });
      expect(home.launchd.events).toStrictEqual(eventsBefore);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "replaces one schedule by unloading the old generation before loading the new one",
    async () => {
      const home = await sharedHome();
      const oldLabel = home.launchd.loaded.get("doctor");
      const oldPlist = await readOrNull(plistPath(home, "doctor"));
      const eventsBefore = home.launchd.events.length;
      expect(dataOf(await runAutomation(home.context, { subcommand: "enable", schedules: ["doctor=daily@04:00"], apply: true }))).toMatchObject({
        kind: "applied",
        operation: "automation_reconcile",
      });
      const newLabel = home.launchd.loaded.get("doctor");
      expect(newLabel).not.toBe(oldLabel);
      expect(home.launchd.events.slice(eventsBefore)).toStrictEqual([`bootout ${String(oldLabel)}`, `bootstrap ${String(newLabel)}`]);
      expect(await readOrNull(plistPath(home, "doctor"))).not.toBe(oldPlist);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "keeps an interrupted replace inert for scheduled runs until the next mutation recovers it",
    async () => {
      const home = await sharedHome();
      home.faults.bootoutDeath = true;
      try {
        expect((await runAutomation(home.context, { subcommand: "enable", schedules: ["doctor=daily@05:00"], apply: true })).ok).toBe(false);
      } finally {
        home.faults.bootoutDeath = false;
      }
      const record = await readOrNull(statusRecordPath(home, "doctor"));
      const outcome = await runScheduledJob(home, "doctor");
      expect(outcome.kind).not.toBe("recorded");
      expect(await readOrNull(statusRecordPath(home, "doctor"))).toBe(record);

      await recoverThroughNextMutation(home);
      const status = await statusOf(home);
      expect(status.closure).toBe("clear");
      /** NEW-134: an unscheduled optional job is eligible but off, so only the scheduled ones are installed. */
      const scheduled = status.jobs.filter((job) => job.eligible && job.schedule !== null);
      expect(scheduled.map((job) => job.job)).toStrictEqual([...INSTALLED]);
      expect(scheduled.every((job) => job.installed === "current" && job.live === "loaded")).toBe(true);
      expect(status.jobs.filter((job) => job.schedule === null).map((job) => [job.job, job.installed])).toStrictEqual([
        ["git-sync", "absent"],
        ["brain-garden", "absent"],
        ["brain-pulse", "absent"],
      ]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports a hand-edited plist as drifted and refuses to plan over it until its bytes are restored",
    async () => {
      const home = await sharedHome();
      const path = plistPath(home, "doctor");
      const original = await nodeFs.readFile(path);
      const eventsBefore = [...home.launchd.events];
      await nodeFs.appendFile(path, "<!-- a hand edit -->\n");
      try {
        expect((await statusOf(home)).jobs.find((job) => job.job === "doctor")).toMatchObject({ installed: "drifted" });
        const refused = await runAutomation(home.context, { subcommand: "enable", schedules: [], apply: true });
        expect(refused).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
        expect(home.launchd.events).toStrictEqual(eventsBefore);
        expect(await readOrNull(plistPath(home, "brain-lint"))).not.toBeNull();
      } finally {
        await nodeFs.writeFile(path, original);
      }
      expect((await statusOf(home)).jobs.find((job) => job.job === "doctor")).toMatchObject({ installed: "current" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses to plan over an unowned plist at a generated path and leaves it byte-identical",
    async () => {
      const home = await sharedHome();
      const path = plistPath(home, "git-sync");
      const planted = "<plist version=\"1.0\"><dict/></plist>\n";
      await nodeFs.writeFile(path, planted, { mode: 0o600 });
      const eventsBefore = [...home.launchd.events];
      try {
        expect((await statusOf(home)).jobs.find((job) => job.job === "git-sync")).toMatchObject({ installed: "unowned" });
        const refused = await runAutomation(home.context, { subcommand: "enable", schedules: [], apply: true });
        expect(refused).toMatchObject({ ok: false, code: EXIT_CODES.decisionRequired });
        expect(await nodeFs.readFile(path, "utf8")).toBe(planted);
        expect(home.launchd.events).toStrictEqual(eventsBefore);
      } finally {
        await nodeFs.rm(path);
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "disables every job, booting each generation out and preserving the schedules",
    async () => {
      const home = await sharedHome();
      const loaded = new Map(home.launchd.loaded);
      const eventsBefore = home.launchd.events.length;
      expect(dataOf(await runAutomation(home.context, { subcommand: "disable", apply: true }))).toMatchObject({
        kind: "applied",
        operation: "automation_disable",
      });
      expect([...home.launchd.events.slice(eventsBefore)].sort()).toStrictEqual([...loaded.values()].map((label) => `bootout ${label}`).sort());
      expect(home.launchd.loaded.size).toBe(0);
      expect(await plists(home)).toStrictEqual([null, null, null]);
      expect(await statusOf(home)).toMatchObject({ enabled: false, activation: "inactive" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "uninstalls a disabled automation without touching launchd and preserves foreign LaunchAgents",
    async () => {
      const home = await sharedHome();
      const foreign = join(home.userHome, "Library", "LaunchAgents", "com.example.synthetic.plist");
      await nodeFs.writeFile(foreign, "<plist version=\"1.0\"><dict/></plist>\n", { mode: 0o644 });
      const eventsBefore = [...home.launchd.events];

      const removed = await runUninstall(home.context, { dryRun: false, assumeYes: true });
      expect(removed.ok, JSON.stringify(removed)).toBe(true);

      const plan = home.plans.at(-1);
      if (plan === undefined) throw new Error("no coordinator plan was published");
      // Disable preserves the schedules, so the config's automation.lifecycle record selects P (Spec 1 A14), with nothing to unload.
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest");
      expect(home.launchd.events).toStrictEqual(eventsBefore);
      expect(await nodeFs.readFile(foreign, "utf8")).toBe("<plist version=\"1.0\"><dict/></plist>\n");
      expect(await readOrNull(home.paths.manifestFile)).toBeNull();
      expect((await nodeFs.stat(home.paths.brain)).isDirectory()).toBe(true);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});
