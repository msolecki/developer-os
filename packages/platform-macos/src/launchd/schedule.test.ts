import type { AutomationConfigV1, NormalizedScheduleV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { launchdCalendarInterval, parseScheduleFlag, reconcileAutomationSchedules } from "./schedule.js";

const threeJobs: AutomationConfigV1 = {
  schemaVersion: 1,
  schedules: [
    { job: "brain-reindex", schedule: { cadence: "daily", hour: 2, minute: 0 } },
    { job: "brain-lint", schedule: { cadence: "daily", hour: 2, minute: 30 } },
    { job: "doctor", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 } },
  ],
};

const firstEnableFlags = ["brain-reindex=daily@02:00", "brain-lint=daily@02:30", "doctor=weekly@mon,03:00"];

describe("parseScheduleFlag", () => {
  it.each([
    ["brain-reindex=daily@02:00", { job: "brain-reindex", schedule: { cadence: "daily", hour: 2, minute: 0 } }],
    ["git-sync=hourly@15", { job: "git-sync", schedule: { cadence: "hourly", minute: 15 } }],
    ["doctor=weekly@mon,03:00", { job: "doctor", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 } }],
  ])("parses %s", (input, expected) => {
    expect(parseScheduleFlag(input)).toEqual(expected);
  });

  it.each(["import=daily@02:00", "ingest=daily@02:00", "doctor=daily@24:00", "doctor=hourly@60", "doctor=*/5 * * * *", "doctor=daily@2:00", "doctor=daily@02:00Z"])(
    "refuses %s", (input) => {
      expect(() => parseScheduleFlag(input)).toThrow();
    });

  it.each([
    ["brain-lint=hourly@00", { cadence: "hourly", minute: 0 }],
    ["brain-lint=hourly@59", { cadence: "hourly", minute: 59 }],
    ["brain-lint=daily@00:00", { cadence: "daily", hour: 0, minute: 0 }],
    ["brain-lint=daily@23:59", { cadence: "daily", hour: 23, minute: 59 }],
    ["brain-lint=weekly@sun,23:59", { cadence: "weekly", day: "sun", hour: 23, minute: 59 }],
    ["brain-lint=weekly@sat,00:00", { cadence: "weekly", day: "sat", hour: 0, minute: 0 }],
  ])("accepts the bound %s", (input, schedule) => {
    expect(parseScheduleFlag(input)).toEqual({ job: "brain-lint", schedule });
  });

  it.each([
    "brain-lint=hourly@5",
    "brain-lint=hourly@060",
    "brain-lint=daily@23:60",
    "brain-lint=daily@-1:00",
    "brain-lint=weekly@Mon,03:00",
    "brain-lint=weekly@monday,03:00",
    "brain-lint=weekly@mon 03:00",
    "brain-lint=weekly@mon,24:00",
    "brain-lint=every 5 minutes",
    "brain-lint=interval@300",
    "brain-lint=daily@02:00+02:00",
    "brain-lint=daily@02:00 Europe/Warsaw",
    " brain-lint=daily@02:00",
    "brain-lint=daily@02:00\n",
    "brain-lint",
    "=daily@02:00",
    "",
  ])("refuses %j", (input) => {
    expect(() => parseScheduleFlag(input)).toThrow();
  });
});

describe("launchdCalendarInterval", () => {
  it("emits only Minute, Hour then Minute, or Weekday, Hour then Minute", () => {
    expect(Object.keys(launchdCalendarInterval({ cadence: "hourly", minute: 15 }))).toEqual(["Minute"]);
    expect(Object.keys(launchdCalendarInterval({ cadence: "daily", hour: 2, minute: 0 }))).toEqual(["Hour", "Minute"]);
    expect(launchdCalendarInterval({ cadence: "weekly", day: "mon", hour: 3, minute: 0 })).toEqual({ Weekday: 1, Hour: 3, Minute: 0 });
  });

  it("maps every weekday with sun=0 through sat=6", () => {
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    expect(days.length).toBeGreaterThan(0);
    expect(days.map((day) => launchdCalendarInterval({ cadence: "weekly", day, hour: 0, minute: 0 })).map((value) => (value as { Weekday: number }).Weekday)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it.each([
    { cadence: "hourly", minute: 60 },
    { cadence: "hourly", minute: -1 },
    { cadence: "hourly", minute: 1.5 },
    { cadence: "daily", hour: 24, minute: 0 },
    { cadence: "weekly", day: "xyz", hour: 1, minute: 0 },
    { cadence: "hourly", minute: 1, hour: 2 },
    { cadence: "monthly", minute: 1 },
  ])("refuses the out-of-grammar schedule %j", (schedule) => {
    expect(() => launchdCalendarInterval(schedule as unknown as NormalizedScheduleV1)).toThrow();
  });
});

describe("reconcileAutomationSchedules", () => {
  it("requires a flag for every eligible job on first enable", () => {
    expect(reconcileAutomationSchedules({ prior: null, flags: firstEnableFlags, gitEligible: false })).toEqual(threeJobs);
    expect(() => reconcileAutomationSchedules({ prior: null, flags: firstEnableFlags.slice(0, 2), gitEligible: false })).toThrow();
    expect(() => reconcileAutomationSchedules({ prior: null, flags: firstEnableFlags, gitEligible: true })).toThrow();
  });

  it("emits registry order regardless of flag order", () => {
    const reversed = [...firstEnableFlags].reverse();
    expect(reconcileAutomationSchedules({ prior: null, flags: reversed, gitEligible: false })).toEqual(threeJobs);
  });

  it("refuses duplicate and unknown jobs", () => {
    expect(() =>
      reconcileAutomationSchedules({ prior: null, flags: [...firstEnableFlags, "doctor=daily@04:00"], gitEligible: false }),
    ).toThrow();
    expect(() =>
      reconcileAutomationSchedules({ prior: null, flags: [...firstEnableFlags, "doctor=weekly@mon,03:00"], gitEligible: false }),
    ).toThrow();
    expect(() => reconcileAutomationSchedules({ prior: null, flags: [...firstEnableFlags, "import=daily@01:00"], gitEligible: false })).toThrow();
  });

  it("refuses a git-sync schedule while Git is not eligible", () => {
    expect(() =>
      reconcileAutomationSchedules({ prior: null, flags: [...firstEnableFlags, "git-sync=hourly@15"], gitEligible: false }),
    ).toThrow();
  });

  it("preserves prior schedules and replaces only the supplied ones", () => {
    const result = reconcileAutomationSchedules({ prior: threeJobs, flags: ["brain-lint=hourly@45"], gitEligible: false });
    expect(result).toEqual({
      schemaVersion: 1,
      schedules: [threeJobs.schedules[0], { job: "brain-lint", schedule: { cadence: "hourly", minute: 45 } }, threeJobs.schedules[2]],
    });
    expect(reconcileAutomationSchedules({ prior: threeJobs, flags: [], gitEligible: false })).toEqual(threeJobs);
  });

  it("requires a flag only for a newly eligible git-sync", () => {
    expect(() => reconcileAutomationSchedules({ prior: threeJobs, flags: [], gitEligible: true })).toThrow();
    const result = reconcileAutomationSchedules({ prior: threeJobs, flags: ["git-sync=hourly@15"], gitEligible: true });
    expect(result.schedules.map((entry) => entry.job)).toEqual(["brain-reindex", "brain-lint", "doctor", "git-sync"]);
    expect(result.schedules[3]).toEqual({ job: "git-sync", schedule: { cadence: "hourly", minute: 15 } });
    expect(reconcileAutomationSchedules({ prior: result, flags: [], gitEligible: true })).toEqual(result);
  });

  it("enables brain-garden only when flagged and keeps it from the prior config", () => {
    const raw = ["brain-reindex=daily@03:00", "brain-lint=daily@03:10", "doctor=daily@03:20"];
    const first = reconcileAutomationSchedules({ prior: null, flags: [...raw, "brain-garden=weekly@sun,17:00"], gitEligible: false });
    expect(first.schedules.map((s) => s.job)).toEqual(["brain-reindex", "brain-lint", "doctor", "brain-garden"]);
    const again = reconcileAutomationSchedules({ prior: first, flags: [], gitEligible: false });
    expect(again.schedules.map((s) => s.job)).toContain("brain-garden");
    const without = reconcileAutomationSchedules({ prior: null, flags: raw, gitEligible: false });
    expect(without.schedules.map((s) => s.job)).not.toContain("brain-garden");
  });

  it("parses an off value and lets it drop an optional job the prior config held", () => {
    expect(parseScheduleFlag("brain-pulse=off")).toEqual({ job: "brain-pulse", schedule: null });
    const prior = reconcileAutomationSchedules({ prior: null, flags: [...firstEnableFlags, "brain-garden=weekly@sun,17:00", "brain-pulse=hourly@05"], gitEligible: false });
    const result = reconcileAutomationSchedules({ prior, flags: ["brain-garden=off"], gitEligible: false });
    expect(result.schedules.map((s) => s.job)).toEqual(["brain-reindex", "brain-lint", "doctor", "brain-pulse"]);
  });

  it.each(["doctor=off", "git-sync=off"])("refuses %s as mandatory", (flag) => {
    expect(() => reconcileAutomationSchedules({ prior: threeJobs, flags: [flag], gitEligible: true })).toThrow(/mandatory and cannot be turned off/);
  });

  it("places git-sync fourth, before the optional jobs, when Git is eligible", () => {
    const result = reconcileAutomationSchedules({
      prior: null,
      flags: [...firstEnableFlags, "brain-garden=weekly@sun,17:00", "git-sync=hourly@15"],
      gitEligible: true,
    });
    expect(result.schedules.map((s) => s.job)).toEqual(["brain-reindex", "brain-lint", "doctor", "git-sync", "brain-garden"]);
  });

  it("drops a git-sync schedule that is no longer eligible", () => {
    const four = reconcileAutomationSchedules({ prior: threeJobs, flags: ["git-sync=hourly@15"], gitEligible: true });
    expect(reconcileAutomationSchedules({ prior: four, flags: [], gitEligible: false })).toEqual(threeJobs);
  });
});
