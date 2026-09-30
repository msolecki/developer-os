import {
  SCHEDULED_JOB_IDS,
  hashCanonicalJson,
  isOptionalScheduledJob,
  lifecycleConfigHash,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type GitSyncConfigV1,
  type LifecycleActivationRecordV1,
  type ScheduledJobIdV1,
} from "@developer-os/core";

import { assertNormalizedSchedule } from "./schedule.js";
import {
  LaunchdInputError,
  type ClosedLaunchdBaseLabelV1,
  type GeneratedLaunchdLabelV1,
  type LaunchdBaseArgvV1,
  type LaunchdGenerationProjectionV1,
  type LaunchdGenerationV1,
  type LaunchdGuiDomainV1,
  type LaunchdJobDefinitionV1,
  type LaunchdProgramArgumentsV1,
  type LaunchdScheduledProductHomeV1,
} from "./types.js";

const encoder = new TextEncoder();
const MAX_BOUNDED_ARG_BYTES = 4096;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function job(id: ScheduledJobIdV1): LaunchdJobDefinitionV1 {
  switch (id) {
    case "brain-reindex":
      return {
        id,
        baseLabel: "com.developer-os.brain-reindex",
        plistFileName: "com.developer-os.brain-reindex.plist",
        requiresGitActivation: false,
        maySpawnVendor: false,
      };
    case "brain-lint":
      return {
        id,
        baseLabel: "com.developer-os.brain-lint",
        plistFileName: "com.developer-os.brain-lint.plist",
        requiresGitActivation: false,
        maySpawnVendor: false,
      };
    case "doctor":
      return {
        id,
        baseLabel: "com.developer-os.doctor",
        plistFileName: "com.developer-os.doctor.plist",
        requiresGitActivation: false,
        maySpawnVendor: false,
      };
    case "git-sync":
      return {
        id,
        baseLabel: "com.developer-os.git-sync",
        plistFileName: "com.developer-os.git-sync.plist",
        requiresGitActivation: true,
        maySpawnVendor: false,
      };
    case "brain-garden":
    case "brain-pulse":
      // Temporary (NEW-134 Task 1): Task 2 defines these registry entries.
      throw new Error(`${id} is wired in NEW-134 Task 2`);
    default: {
      const unknown: never = id;
      return refuse(`unknown scheduled job ${String(unknown)}`);
    }
  }
}

/** Spec 1 §5.1's closed registry, in `SCHEDULED_JOB_IDS` order. `import` and `ingest` are not jobs (D47). */
export const LAUNCHD_JOBS: readonly LaunchdJobDefinitionV1[] = Object.freeze(
  // Temporary (NEW-134 Task 1): optional jobs join the registry in Task 2, so its module load keeps working.
  SCHEDULED_JOB_IDS.filter((id) => !isOptionalScheduledJob(id)).map((id) => Object.freeze(job(id))),
);

export function launchdJob(id: unknown): LaunchdJobDefinitionV1 {
  const found = LAUNCHD_JOBS.find((candidate) => candidate.id === id);
  return found ?? refuse("unknown scheduled job");
}

/** `BoundedArgV1` that is also XML-1.0 scalar text, the only string a plist may carry. */
export function assertBoundedPlistString(value: unknown, label: string): string {
  if (typeof value !== "string") refuse(`${label}: not a string`);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > MAX_BOUNDED_ARG_BYTES) refuse(`${label}: byte length`);
  if (!value.isWellFormed()) refuse(`${label}: lone surrogate`);
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      refuse(`${label}: control, line break or non-XML scalar`);
    }
  }
  return value;
}

function boundedPath(value: unknown, label: string): CanonicalAbsolutePathV1 {
  const path = parseCanonicalAbsolutePathText(value);
  assertBoundedPlistString(path, label);
  return path;
}

/** Grammar only: the caller supplies the guarded canonical product home it already resolved. */
export function parseScheduledProductHome(value: unknown): LaunchdScheduledProductHomeV1 {
  return boundedPath(value, "LaunchdScheduledProductHomeV1") as LaunchdScheduledProductHomeV1;
}

export function launchdGuiDomain(uid: EffectiveUidV1): LaunchdGuiDomainV1 {
  if (!Number.isSafeInteger(uid) || uid < 0) refuse("LaunchdGuiDomainV1: effective uid");
  return `gui/${String(uid)}` as LaunchdGuiDomainV1;
}

export function launchdPlistPath(userHome: CanonicalAbsolutePathV1, id: ScheduledJobIdV1): CanonicalAbsolutePathV1 {
  return boundedPath(`${boundedPath(userHome, "user home")}/Library/LaunchAgents/${launchdJob(id).plistFileName}`, "plist path");
}

/** The current slot of the ten fixed log rotations `init` reserves. */
export function launchdLogPath(productHome: LaunchdScheduledProductHomeV1, id: ScheduledJobIdV1): CanonicalAbsolutePathV1 {
  return boundedPath(`${parseScheduledProductHome(productHome)}/logs/automation-${launchdJob(id).id}.0.json`, "log path");
}

export function launchdStatusPath(productHome: LaunchdScheduledProductHomeV1, id: ScheduledJobIdV1): CanonicalAbsolutePathV1 {
  return boundedPath(`${parseScheduledProductHome(productHome)}/state/automation-${launchdJob(id).id}.status.json`, "status path");
}

export function scheduledBaseArgv(
  id: ScheduledJobIdV1,
  home: LaunchdScheduledProductHomeV1,
  executable: CanonicalAbsolutePathV1,
): LaunchdBaseArgvV1 {
  return [
    boundedPath(executable, "executable path"),
    "automation",
    "run",
    launchdJob(id).id,
    "--scheduled",
    "--product-home",
    parseScheduledProductHome(home),
  ];
}

export function scheduledProgramArguments(
  id: ScheduledJobIdV1,
  home: LaunchdScheduledProductHomeV1,
  generation: LaunchdGenerationV1,
  executable: CanonicalAbsolutePathV1,
): LaunchdProgramArgumentsV1 {
  return [...scheduledBaseArgv(id, home, executable), "--generation", parseLowerHexSha256(generation)];
}

function assertProjection(projection: LaunchdGenerationProjectionV1): void {
  const definition = launchdJob(projection.job);
  if (projection.baseLabel !== definition.baseLabel) refuse("generation projection: base label");
  if (!/^gui\/(0|[1-9][0-9]*)$/.test(projection.domain)) refuse("generation projection: domain");
  assertNormalizedSchedule(projection.schedule);
  const productHome = parseScheduledProductHome(projection.productHome);
  if (!projection.plistPath.endsWith(`/Library/LaunchAgents/${definition.plistFileName}`)) {
    refuse("generation projection: plist path");
  }
  boundedPath(projection.plistPath, "plist path");
  const expectedArgv = scheduledBaseArgv(definition.id, productHome, projection.executablePath);
  const baseArgv: readonly unknown[] = projection.baseArgv;
  if (baseArgv.length !== expectedArgv.length || expectedArgv.some((argument, index) => baseArgv[index] !== argument)) {
    refuse("generation projection: base argv");
  }
  if (projection.logPath !== launchdLogPath(productHome, definition.id)) refuse("generation projection: log path");
  if (projection.statusPath !== launchdStatusPath(productHome, definition.id)) refuse("generation projection: status path");
}

/** SHA-256 over `developer-os:launchd-generation:v1\0` plus the projection's canonical JSON. */
export function launchdGeneration(projection: LaunchdGenerationProjectionV1): LaunchdGenerationV1 {
  assertProjection(projection);
  return hashCanonicalJson("developer-os:launchd-generation:v1", {
    job: projection.job,
    baseLabel: projection.baseLabel,
    domain: projection.domain,
    schedule: { ...projection.schedule },
    productHome: projection.productHome,
    plistPath: projection.plistPath,
    executablePath: projection.executablePath,
    baseArgv: [...projection.baseArgv],
    logPath: projection.logPath,
    statusPath: projection.statusPath,
  });
}

export function generatedLabel(id: ScheduledJobIdV1, generation: LaunchdGenerationV1): GeneratedLaunchdLabelV1 {
  return `${launchdJob(id).baseLabel}.g.${parseLowerHexSha256(generation)}`;
}

/** Inverse of `generatedLabel` for one closed base label; anything else is not product-owned. */
export function parseGeneratedLabel(value: unknown): { readonly job: ScheduledJobIdV1; readonly generation: LaunchdGenerationV1 } {
  if (typeof value !== "string") refuse("GeneratedLaunchdLabelV1");
  for (const definition of LAUNCHD_JOBS) {
    const prefix: `${ClosedLaunchdBaseLabelV1}.g.` = `${definition.baseLabel}.g.`;
    if (value.startsWith(prefix)) {
      return { job: definition.id, generation: parseLowerHexSha256(value.slice(prefix.length)) };
    }
  }
  return refuse("GeneratedLaunchdLabelV1");
}

/**
 * Spec 1 §5.1: `git-sync` is eligible only while Git has matching active provenance — the
 * flag, a lifecycle record, and an active arm whose hash equals that record's hash.
 */
export function gitSyncEligible(
  git: { readonly enabled: boolean; readonly lifecycle?: GitSyncConfigV1 },
  activation: LifecycleActivationRecordV1,
): boolean {
  if (!git.enabled || git.lifecycle === undefined || activation.git.state !== "active") return false;
  return activation.git.configHash === lifecycleConfigHash("git", git.lifecycle);
}

export function eligibleLaunchdJobs(gitEligible: boolean): readonly LaunchdJobDefinitionV1[] {
  return LAUNCHD_JOBS.filter((definition) => !definition.requiresGitActivation || gitEligible);
}
