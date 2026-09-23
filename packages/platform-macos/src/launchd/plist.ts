import {
  SCHEDULED_JOB_IDS,
  hashBytes,
  hashCanonicalJson,
  parseLowerHexSha256,
  type CanonicalAbsolutePathV1,
  type LowerHexSha256,
  type NormalizedScheduleV1,
  type ScheduledJobIdV1,
} from "@developer-os/core";

import {
  assertBoundedPlistString,
  generatedLabel,
  launchdGeneration,
  launchdJob,
  launchdLogPath,
  launchdPlistPath,
  launchdStatusPath,
  parseGeneratedLabel,
  parseScheduledProductHome,
  scheduledBaseArgv,
  scheduledProgramArguments,
} from "./registry.js";
import { assertNormalizedSchedule, launchdCalendarInterval } from "./schedule.js";
import {
  LaunchdInputError,
  type BoundedCanonicalPlistXmlV1,
  type LaunchdCalendarIntervalV1,
  type LaunchdGenerationProjectionV1,
  type LaunchdGenerationV1,
  type LaunchdGuiDomainV1,
  type LaunchdLiveStateV1,
  type LaunchdPlanPreviewEntryV1,
  type LaunchdPlanPreviewV1,
  type LaunchdPlistDictionaryV1,
  type LaunchdPreviewRequestV1,
  type LaunchdPriorJobStateV1,
} from "./types.js";

export const MAX_LAUNCHD_PLIST_BYTES = 1_048_576;

const encoder = new TextEncoder();

const PLIST_KEYS = ["Label", "ProgramArguments", "StartCalendarInterval", "StandardOutPath", "StandardErrorPath"] as const;

const PLIST_HEADER = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
] as const;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

/** Only `&`, `<` and `>` are escaped; every other scalar is emitted as UTF-8 (§5.3). */
function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function unsignedInteger(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) refuse(label);
  return value;
}

function calendarLines(interval: LaunchdCalendarIntervalV1): readonly (readonly [string, number])[] {
  if ("Weekday" in interval) {
    if (!exactKeys(interval, ["Weekday", "Hour", "Minute"])) refuse("StartCalendarInterval keys");
    return [
      ["Weekday", unsignedInteger(interval.Weekday, 6, "Weekday")],
      ["Hour", unsignedInteger(interval.Hour, 23, "Hour")],
      ["Minute", unsignedInteger(interval.Minute, 59, "Minute")],
    ];
  }
  if ("Hour" in interval) {
    if (!exactKeys(interval, ["Hour", "Minute"])) refuse("StartCalendarInterval keys");
    return [
      ["Hour", unsignedInteger(interval.Hour, 23, "Hour")],
      ["Minute", unsignedInteger(interval.Minute, 59, "Minute")],
    ];
  }
  if (!exactKeys(interval, ["Minute"])) refuse("StartCalendarInterval keys");
  return [["Minute", unsignedInteger(interval.Minute, 59, "Minute")]];
}

/** The byte-grammar gate every encoded plist passes: 1..1 MiB UTF-8, no NUL, exactly one trailing LF. */
export function boundedCanonicalPlistXml(value: string): BoundedCanonicalPlistXmlV1 {
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > MAX_LAUNCHD_PLIST_BYTES) refuse("BoundedCanonicalPlistXmlV1: byte length");
  if (value.includes("\0")) refuse("BoundedCanonicalPlistXmlV1: NUL");
  if (!value.endsWith("\n") || value.endsWith("\n\n")) refuse("BoundedCanonicalPlistXmlV1: trailing LF");
  return value as BoundedCanonicalPlistXmlV1;
}

/**
 * Spec 1 §5.3's single byte grammar: the fixed header, one root `<dict>` in schema key
 * order, two spaces per nesting level below `<plist>`, LF after every line. Anything other
 * than the approved five keys, the nine-string argv bound to the label's generation, or the
 * literal null sinks refuses rather than being serialized.
 */
export function encodeLaunchdPlist(value: LaunchdPlistDictionaryV1): BoundedCanonicalPlistXmlV1 {
  if (!exactKeys(value, PLIST_KEYS)) refuse("plist keys");
  const { job, generation } = parseGeneratedLabel(value.Label);
  const argv = value.ProgramArguments as readonly unknown[];
  if (!Array.isArray(argv) || argv.length !== 9) refuse("ProgramArguments length");
  const expected = scheduledProgramArguments(
    job,
    parseScheduledProductHome(argv[6]),
    generation,
    argv[0] as CanonicalAbsolutePathV1,
  );
  if (expected.some((argument, index) => argv[index] !== argument)) refuse("ProgramArguments");
  const sinks: readonly unknown[] = [value.StandardOutPath, value.StandardErrorPath];
  if (sinks.some((sink) => sink !== "/dev/null")) refuse("output paths");
  const lines: string[] = [
    ...PLIST_HEADER,
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${escapeText(assertBoundedPlistString(value.Label, "Label"))}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array>",
    ...expected.map((argument) => `      <string>${escapeText(assertBoundedPlistString(argument, "ProgramArguments"))}</string>`),
    "    </array>",
    "    <key>StartCalendarInterval</key>",
    "    <dict>",
    ...calendarLines(value.StartCalendarInterval).flatMap(([key, integer]) => [
      `      <key>${key}</key>`,
      `      <integer>${String(integer)}</integer>`,
    ]),
    "    </dict>",
    "    <key>StandardOutPath</key>",
    "    <string>/dev/null</string>",
    "    <key>StandardErrorPath</key>",
    "    <string>/dev/null</string>",
    "  </dict>",
    "</plist>",
  ];
  return boundedCanonicalPlistXml(`${lines.join("\n")}\n`);
}

export function launchdPlistDictionary(
  projection: LaunchdGenerationProjectionV1,
  generation: LaunchdGenerationV1,
): LaunchdPlistDictionaryV1 {
  return {
    Label: generatedLabel(projection.job, generation),
    ProgramArguments: scheduledProgramArguments(projection.job, projection.productHome, generation, projection.executablePath),
    StartCalendarInterval: launchdCalendarInterval(projection.schedule),
    StandardOutPath: "/dev/null",
    StandardErrorPath: "/dev/null",
  };
}

/** SHA-256 over `developer-os:launchd-prior-state:v1\0` plus the canonical prior-state projection. */
export function launchdPriorStateFingerprint(entry: {
  readonly job: ScheduledJobIdV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly plistPath: string;
  readonly beforeFileHash: LowerHexSha256 | null;
  readonly beforeLiveState: LaunchdLiveStateV1;
}): LowerHexSha256 {
  return hashCanonicalJson("developer-os:launchd-prior-state:v1", {
    job: entry.job,
    baseLabel: launchdJob(entry.job).baseLabel,
    domain: entry.domain,
    plistPath: entry.plistPath,
    beforeFileHash: entry.beforeFileHash,
    beforeLiveState: { ...entry.beforeLiveState },
  });
}

function assertPrior(job: ScheduledJobIdV1, prior: LaunchdPriorJobStateV1): void {
  if (!exactKeys(prior, ["beforeFileHash", "beforeGeneration", "beforeLiveState"])) refuse(`${job}: prior state keys`);
  if ((prior.beforeFileHash === null) !== (prior.beforeGeneration === null)) refuse(`${job}: prior file and generation disagree`);
  if (prior.beforeFileHash !== null) parseLowerHexSha256(prior.beforeFileHash);
  const live = prior.beforeLiveState;
  if (live.state === "unloaded") {
    if (!exactKeys(live, ["state"])) refuse(`${job}: live state keys`);
    return;
  }
  const state: unknown = live.state;
  if (state !== "loaded" || !exactKeys(live, ["state", "label", "generation"])) refuse(`${job}: live state`);
  if (prior.beforeGeneration === null || live.generation !== prior.beforeGeneration) {
    refuse(`${job}: loaded generation is not the retained plist's generation`);
  }
  if (live.label !== generatedLabel(job, live.generation)) refuse(`${job}: loaded label`);
}

function targetSchedules(request: LaunchdPreviewRequestV1): ReadonlyMap<ScheduledJobIdV1, NormalizedScheduleV1> {
  const schedules = new Map<ScheduledJobIdV1, NormalizedScheduleV1>();
  if (request.automation === null) return schedules;
  let position = 0;
  for (const entry of request.automation.schedules) {
    const index = SCHEDULED_JOB_IDS.indexOf(entry.job);
    if (index < position) refuse("automation schedules are not unique in registry order");
    position = index + 1;
    schedules.set(entry.job, assertNormalizedSchedule(entry.schedule));
  }
  return schedules;
}

/**
 * Side-effect-free: every live and retained fact arrives already observed in `prior`. Entries
 * follow registry order; a job neither targeted nor retained produces no entry, and the
 * `keep`/`replace` choice is made only by comparing the freshly derived generation with the
 * retained one.
 */
export function buildLaunchdPlanPreview(request: LaunchdPreviewRequestV1): LaunchdPlanPreviewV1 {
  const productHome = parseScheduledProductHome(request.productHome);
  if (!/^gui\/(0|[1-9][0-9]*)$/.test(request.domain)) refuse("LaunchdGuiDomainV1");
  if (!exactKeys(request.prior, SCHEDULED_JOB_IDS)) refuse("prior state must name every registry job");
  const schedules = targetSchedules(request);
  const entries: LaunchdPlanPreviewEntryV1[] = [];
  for (const job of SCHEDULED_JOB_IDS) {
    const prior = request.prior[job];
    assertPrior(job, prior);
    const plistPath = launchdPlistPath(request.userHome, job);
    const common = {
      job,
      baseLabel: launchdJob(job).baseLabel,
      domain: request.domain,
      productHome,
      plistPath,
      executablePath: request.executablePath,
      baseArgv: scheduledBaseArgv(job, productHome, request.executablePath),
      logPath: launchdLogPath(productHome, job),
      statusPath: launchdStatusPath(productHome, job),
      beforeFileHash: prior.beforeFileHash,
      beforeLiveState: prior.beforeLiveState,
      priorStateFingerprint: launchdPriorStateFingerprint({
        job,
        domain: request.domain,
        plistPath,
        beforeFileHash: prior.beforeFileHash,
        beforeLiveState: prior.beforeLiveState,
      }),
    };
    const schedule = schedules.get(job);
    if (schedule === undefined) {
      if (prior.beforeFileHash === null) continue;
      entries.push({
        ...common,
        operation: "remove",
        schedule: null,
        plistBytes: null,
        generationProjection: null,
        generation: null,
        generatedLabel: null,
      });
      continue;
    }
    const generationProjection: LaunchdGenerationProjectionV1 = {
      job,
      baseLabel: common.baseLabel,
      domain: common.domain,
      schedule,
      productHome,
      plistPath,
      executablePath: common.executablePath,
      baseArgv: common.baseArgv,
      logPath: common.logPath,
      statusPath: common.statusPath,
    };
    const generation = launchdGeneration(generationProjection);
    const plistBytes = encodeLaunchdPlist(launchdPlistDictionary(generationProjection, generation));
    let operation: LaunchdPlanPreviewEntryV1["operation"];
    if (prior.beforeFileHash === null) {
      operation = "install";
    } else if (prior.beforeGeneration === generation) {
      if (prior.beforeFileHash !== hashBytes(encoder.encode(plistBytes))) refuse(`${job}: retained plist drifted`);
      operation = "keep";
    } else {
      operation = "replace";
    }
    entries.push({
      ...common,
      operation,
      schedule,
      plistBytes,
      generationProjection,
      generation,
      generatedLabel: generatedLabel(job, generation),
    });
  }
  return {
    schemaVersion: 1,
    observationProcessTableHash: parseLowerHexSha256(request.observationProcessTableHash),
    mutationProcessTableTemplateHash: parseLowerHexSha256(request.mutationProcessTableTemplateHash),
    entries,
  };
}
