import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, parseCanonicalAbsolutePathText, parseSafeReasonCode, parseUtcTimestamp, SCHEDULED_JOB_IDS } from "@developer-os/core";

import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import { admitScheduledProductHome, parseScheduledInvocation, renderAutomation, scheduledExitCode } from "./index.js";

afterEach(removeCommandFixtures);

const HOME = "/Users/synthetic/.developer-os";
const GENERATION = "a".repeat(64);
const UID = process.getuid?.() ?? 0;

function argv(job: string = "doctor", home: string = HOME, generation: string = GENERATION): string[] {
  return ["automation", "run", job, "--scheduled", "--product-home", home, "--generation", generation];
}

describe("parseScheduledInvocation", () => {
  it("accepts the exact ProgramArguments tail for every registry job", () => {
    expect(SCHEDULED_JOB_IDS.length).toBeGreaterThan(0);
    for (const job of SCHEDULED_JOB_IDS) {
      expect(parseScheduledInvocation(argv(job))).toStrictEqual({ job, productHome: HOME, generation: GENERATION });
    }
  });

  it("returns null for any other position, spelling, count or value", () => {
    const exact = argv();
    const variants: string[][] = [
      exact.slice(0, 7),
      [...exact, "--json"],
      ["automation", "run", "doctor", "--product-home", HOME, "--scheduled", "--generation", GENERATION],
      exact.map((token) => (token === "run" ? "Run" : token)),
      exact.map((token) => (token === "--scheduled" ? "--scheduled=true" : token)),
      argv("import"),
      argv("ingest"),
      argv("toString"),
      argv("doctor", "relative/home"),
      argv("doctor", `${HOME}/`),
      argv("doctor", `${HOME}/../elsewhere`),
      argv("doctor", HOME, "A".repeat(64)),
      argv("doctor", HOME, "a".repeat(63)),
      ["status", "--product-home", HOME],
    ];
    for (const variant of variants) expect(parseScheduledInvocation(variant), variant.join(" ")).toBeNull();
  });
});

describe("admitScheduledProductHome", () => {
  it("admits only an owned real directory whose parents are already canonical", async () => {
    const fixture = await createCommandFixture("scheduled-home");
    const real = join(fixture.root, "product");
    await nodeFs.mkdir(real, { mode: 0o700 });
    await nodeFs.symlink(real, join(fixture.root, "linked"));
    await nodeFs.mkdir(join(fixture.root, "parent"), { mode: 0o700 });
    await nodeFs.symlink(join(fixture.root, "parent"), join(fixture.root, "linked-parent"));
    await nodeFs.mkdir(join(fixture.root, "parent", "product"), { mode: 0o700 });
    await nodeFs.writeFile(join(fixture.root, "file"), "not a directory\n", { mode: 0o600 });

    const admit = (path: string): Promise<boolean> => admitScheduledProductHome(parseCanonicalAbsolutePathText(path), UID);
    expect(await admit(real)).toBe(true);
    expect(await admit(join(fixture.root, "linked"))).toBe(false);
    expect(await admit(join(fixture.root, "linked-parent", "product"))).toBe(false);
    expect(await admit(join(fixture.root, "file"))).toBe(false);
    expect(await admit(join(fixture.root, "absent"))).toBe(false);
    expect(await admitScheduledProductHome(parseCanonicalAbsolutePathText(real), UID + 1)).toBe(false);
  });
});

describe("scheduledExitCode", () => {
  it("exits 0 for a silent or recorded run and with the refusal's own code otherwise", () => {
    expect(scheduledExitCode({ kind: "silent", reason: "lease_busy" })).toBe(EXIT_CODES.success);
    expect(scheduledExitCode({ kind: "recorded", outcome: "automation_disabled" })).toBe(EXIT_CODES.success);
    expect(
      scheduledExitCode({ kind: "refused", code: EXIT_CODES.securityRefusal, reason: parseSafeReasonCode("scheduled_plist_drifted") }),
    ).toBe(EXIT_CODES.securityRefusal);
  });
});

describe("renderAutomation", () => {
  it("renders status without repairing or hiding a stale or unobserved job", () => {
    const lines = renderAutomation({
      kind: "status",
      enabled: true,
      activation: "active",
      distribution: "unsupported_launchd_distribution",
      closure: "clear",
      jobs: [
        { job: "doctor", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 }, eligible: true, installed: "current", live: "loaded", lastRun: null },
        { job: "git-sync", schedule: null, eligible: false, installed: "stale", live: null, lastRun: "invalid" },
        { job: "brain-garden", schedule: null, eligible: true, installed: "absent", live: null, lastRun: null },
        { job: "brain-pulse", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 }, eligible: true, installed: "absent", live: null, lastRun: null },
        { job: "git-sync", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 }, eligible: false, installed: "absent", live: null, lastRun: null },
        { job: "brain-reindex", schedule: null, eligible: true, installed: "absent", live: null, lastRun: null },
      ],
    });
    expect(lines).toContain("brain-garden   off - last run never");
    expect(lines.some((line) => line.startsWith("brain-pulse") && line.includes("eligible absent - last run never"))).toBe(true);
    expect(lines.some((line) => line.startsWith("git-sync") && line.includes("off - last run never"))).toBe(true);
    expect(lines.some((line) => line.startsWith("brain-reindex") && line.includes("eligible absent - last run never"))).toBe(true);
    expect(lines).toContain("distribution   unsupported_launchd_distribution");
    expect(lines.some((line) => line.startsWith("doctor") && line.includes("current loaded last run never"))).toBe(true);
    expect(lines.some((line) => line.startsWith("git-sync") && line.includes("ineligible stale - last run invalid"))).toBe(true);
  });

  /** NEW-169: a run that wrote no record (launchd could not spawn it, or it died first) shows launchd's exit. */
  it("names a non-zero launchd exit beside the last run, and nothing for exit 0", () => {
    const lines = renderAutomation({
      kind: "status",
      enabled: true,
      activation: "active",
      distribution: "supported",
      closure: "clear",
      jobs: [
        { job: "doctor", schedule: null, eligible: true, installed: "current", live: "loaded", lastRun: null, launchdExit: 78 },
        { job: "brain-pulse", schedule: null, eligible: true, installed: "current", live: "loaded", lastRun: null, launchdExit: 0 },
      ],
    });
    expect(lines).toContain("doctor         eligible current loaded last run never; launchd exit 78, no run recorded since");
    expect(lines).toContain("brain-pulse    eligible current loaded last run never");
  });

  it("appends the brain-pulse verdict from its last run's reason code, and no other job's", () => {
    const at = parseUtcTimestamp("2026-10-01T07:00:01.000Z");
    const run = (job: "brain-pulse" | "doctor", reasonCode: string) =>
      ({ schemaVersion: 1, job, outcome: "success", reasonCode: parseSafeReasonCode(reasonCode), startedAt: at, completedAt: at }) as const;
    const lines = renderAutomation({
      kind: "status",
      enabled: true,
      activation: "active",
      distribution: "supported",
      closure: "clear",
      jobs: [
        { job: "brain-pulse", schedule: null, eligible: true, installed: "current", live: null, lastRun: run("brain-pulse", "pulse_attention") },
        { job: "doctor", schedule: null, eligible: true, installed: "current", live: null, lastRun: run("doctor", "ok") },
      ],
    });
    expect(lines).toContain("brain-pulse    eligible current - last run success at 2026-10-01T07:00:01.000Z verdict attention report state/pulse.0.md");
    expect(lines).toContain("doctor         eligible current - last run success at 2026-10-01T07:00:01.000Z");

    const failed = renderAutomation({
      kind: "status",
      enabled: true,
      activation: "active",
      distribution: "supported",
      closure: "clear",
      jobs: [
        {
          job: "brain-pulse",
          schedule: null,
          eligible: true,
          installed: "current",
          live: null,
          lastRun: { ...run("brain-pulse", "pulse_rotation_failed"), outcome: "handler_failed" },
        },
      ],
    });
    expect(failed).toContain("brain-pulse    eligible current - last run handler_failed at 2026-10-01T07:00:01.000Z");
  });
});
