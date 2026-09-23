import {
  SCHEDULED_JOB_IDS,
  type AutomationConfigV1,
  type NormalizedScheduleV1,
  type ScheduledJobIdV1,
} from "@developer-os/core";

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

const SCHEDULE_FLAG = /^([a-z-]+)=(?:(hourly)@([0-5][0-9])|(daily)@([01][0-9]|2[0-3]):([0-5][0-9])|(weekly)@(mon|tue|wed|thu|fri|sat|sun),([01][0-9]|2[0-3]):([0-5][0-9]))$/;

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
 * `--schedule <job>=hourly@MM | daily@HH:MM | weekly@<day>,HH:MM`, and nothing else: no
 * cron, interval, time zone or natural language. Only the tagged numeric record survives;
 * the input spelling is never retained.
 */
export function parseScheduleFlag(value: string): { readonly job: ScheduledJobIdV1; readonly schedule: NormalizedScheduleV1 } {
  const match = SCHEDULE_FLAG.exec(value);
  if (match === null) return refuse("schedule flag grammar");
  const job = match[1] as string;
  if (!isScheduledJob(job)) return refuse("unknown scheduled job");
  if (match[2] !== undefined) {
    return { job, schedule: { cadence: "hourly", minute: Number(match[3]) } };
  }
  if (match[4] !== undefined) {
    return { job, schedule: { cadence: "daily", hour: Number(match[5]), minute: Number(match[6]) } };
  }
  return {
    job,
    schedule: { cadence: "weekly", day: match[8] as WeekdayIdV1, hour: Number(match[9]), minute: Number(match[10]) },
  };
}

/**
 * Spec 1 §5.2 over the prior validated configuration. The first enable needs a flag for
 * every eligible job; a later one preserves prior schedules unless replaced and needs flags
 * only for newly eligible jobs. The result is always the complete eligible set, in registry
 * order, so an ineligible `git-sync` drops out rather than lingering.
 */
export function reconcileAutomationSchedules(request: {
  readonly prior: AutomationConfigV1 | null;
  readonly flags: readonly string[];
  readonly gitEligible: boolean;
}): AutomationConfigV1 {
  const eligible = SCHEDULED_JOB_IDS.filter((job) => job !== "git-sync" || request.gitEligible);
  const supplied = new Map<ScheduledJobIdV1, NormalizedScheduleV1>();
  for (const flag of request.flags) {
    const parsed = parseScheduleFlag(flag);
    if (supplied.has(parsed.job)) refuse(`duplicate schedule for ${parsed.job}`);
    if (!eligible.includes(parsed.job)) refuse(`${parsed.job} is not eligible`);
    supplied.set(parsed.job, parsed.schedule);
  }
  const prior = new Map<ScheduledJobIdV1, NormalizedScheduleV1>();
  for (const entry of request.prior?.schedules ?? []) {
    prior.set(entry.job, assertNormalizedSchedule(entry.schedule));
  }
  return {
    schemaVersion: 1,
    schedules: eligible.map((job) => {
      const schedule = supplied.get(job) ?? prior.get(job) ?? refuse(`schedule required for ${job}`);
      return { job, schedule };
    }),
  };
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
