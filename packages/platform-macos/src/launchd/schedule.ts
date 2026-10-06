import {
  SCHEDULED_JOB_IDS,
  isOptionalScheduledJob,
  type AutomationConfigV1,
  type NormalizedScheduleV1,
  type ScheduledJobIdV1,
} from "@developer-os/core";

import { eligibleLaunchdJobs } from "./registry.js";
import { LaunchdInputError, type LaunchdCalendarIntervalV1 } from "./types.js";

type WeekdayIdV1 = Extract<NormalizedScheduleV1, { readonly cadence: "weekly" }>["day"];

/** Spec 1 §5.3's exact launchd weekday map; the stored `mon..sun` arm maps through it. */
const LAUNCHD_WEEKDAYS: Readonly<Record<WeekdayIdV1, number>> = Object.freeze({
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
});

const SCHEDULE_FLAG = /^([a-z-]+)=(?:(off)|(hourly)@([0-5][0-9])|(daily)@([01][0-9]|2[0-3]):([0-5][0-9])|(weekly)@(mon|tue|wed|thu|fri|sat|sun),([01][0-9]|2[0-3]):([0-5][0-9]))$/;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function isScheduledJob(value: string): value is ScheduledJobIdV1 {
  return (SCHEDULED_JOB_IDS as readonly string[]).includes(value);
}

function inRange(value: unknown, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

export function assertNormalizedSchedule(value: NormalizedScheduleV1): NormalizedScheduleV1 {
  switch (value.cadence) {
    case "hourly":
      if (exactKeys(value, ["cadence", "minute"]) && inRange(value.minute, 59)) return value;
      break;
    case "daily":
      if (exactKeys(value, ["cadence", "hour", "minute"]) && inRange(value.hour, 23) && inRange(value.minute, 59)) {
        return value;
      }
      break;
    case "weekly":
      if (
        exactKeys(value, ["cadence", "day", "hour", "minute"]) &&
        Object.hasOwn(LAUNCHD_WEEKDAYS, value.day) &&
        inRange(value.hour, 23) &&
        inRange(value.minute, 59)
      ) {
        return value;
      }
      break;
    default:
      break;
  }
  return refuse("NormalizedScheduleV1");
}

/**
 * `--schedule <job>=hourly@MM | daily@HH:MM | weekly@<day>,HH:MM | off`, and nothing else: no
 * cron, interval, time zone or natural language. Only the tagged numeric record survives;
 * the input spelling is never retained. `off` (schedule null) removes an optional job;
 * reconcile refuses it for a mandatory one.
 */
export function parseScheduleFlag(value: string): { readonly job: ScheduledJobIdV1; readonly schedule: NormalizedScheduleV1 | null } {
  const match = SCHEDULE_FLAG.exec(value);
  if (match === null) return refuse("schedule flag grammar");
  const job = match[1] as string;
  if (!isScheduledJob(job)) return refuse("unknown scheduled job");
  if (match[2] !== undefined) return { job, schedule: null };
  if (match[3] !== undefined) {
    return { job, schedule: { cadence: "hourly", minute: Number(match[4]) } };
  }
  if (match[5] !== undefined) {
    return { job, schedule: { cadence: "daily", hour: Number(match[6]), minute: Number(match[7]) } };
  }
  return {
    job,
    schedule: { cadence: "weekly", day: match[9] as WeekdayIdV1, hour: Number(match[10]), minute: Number(match[11]) },
  };
}

/**
 * Spec 1 §5.2 over the prior validated configuration. The first enable needs a flag for
 * every eligible mandatory job; a later one preserves prior schedules unless replaced and needs flags
 * only for newly eligible jobs. An optional job is kept only when a flag or the prior configuration
 * names it, and `<job>=off` drops it. The result is the complete set in registry order, so an
 * ineligible `git-sync` drops out rather than lingering.
 */
export function reconcileAutomationSchedules(request: {
  readonly prior: AutomationConfigV1 | null;
  readonly flags: readonly string[];
  readonly gitEligible: boolean;
}): AutomationConfigV1 {
  // MACOS-5: the registry's `requiresGitActivation` is the one source of the git-gated rule.
  const eligible = eligibleLaunchdJobs(request.gitEligible).map((definition) => definition.id);
  const supplied = new Map<ScheduledJobIdV1, NormalizedScheduleV1 | null>();
  for (const flag of request.flags) {
    const parsed = parseScheduleFlag(flag);
    if (supplied.has(parsed.job)) refuse(`duplicate schedule for ${parsed.job}`);
    if (!eligible.includes(parsed.job)) refuse(`${parsed.job} is not eligible`);
    if (parsed.schedule === null && !isOptionalScheduledJob(parsed.job)) {
      refuse(`${parsed.job} is mandatory and cannot be turned off`);
    }
    supplied.set(parsed.job, parsed.schedule);
  }
  const prior = new Map<ScheduledJobIdV1, NormalizedScheduleV1>();
  for (const entry of request.prior?.schedules ?? []) {
    prior.set(entry.job, assertNormalizedSchedule(entry.schedule));
  }
  const schedules: { job: ScheduledJobIdV1; schedule: NormalizedScheduleV1 }[] = [];
  for (const job of eligible) {
    const flagged = supplied.get(job);
    if (flagged === null) continue;
    const schedule = flagged ?? prior.get(job);
    if (schedule === undefined) {
      if (isOptionalScheduledJob(job)) continue;
      refuse(`schedule required for ${job}`);
    }
    schedules.push({ job, schedule });
  }
  return { schemaVersion: 1, schedules };
}

export function launchdCalendarInterval(schedule: NormalizedScheduleV1): LaunchdCalendarIntervalV1 {
  const value = assertNormalizedSchedule(schedule);
  switch (value.cadence) {
    case "hourly":
      return { Minute: value.minute };
    case "daily":
      return { Hour: value.hour, Minute: value.minute };
    case "weekly":
      return { Weekday: LAUNCHD_WEEKDAYS[value.day], Hour: value.hour, Minute: value.minute };
    default: {
      const unknown: never = value;
      return refuse(`unknown cadence ${String(unknown)}`);
    }
  }
}
