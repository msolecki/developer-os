/**
 * Spec 1 §5.4: the hidden scheduled runner, steps 1–9 in order. It takes the job's lifetime
 * lease before any wait for the global lock, authenticates the installed generation (stage 1)
 * without asking whether automation is still active, and only under both locks decides
 * between the handler and the two inert status arms (stage 2). Every silent exit writes
 * nothing; every record goes through one Foundation transaction under the held locks.
 */
import {
  EXIT_CODES,
  LifecycleLockBusyError,
  LifecycleLockMissingError,
  hashBytes,
  lifecycleConfigHash,
  parseCanonicalAbsolutePathText,
  parseSafeReasonCode,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  ExitCode,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleGuardedFileSystemV1,
  LifecycleJournalClosureV1,
  LifecycleStableLockProviderV1,
  NormalizedScheduleV1,
  RedactedPayload,
  SafeReasonCodeV1,
  ScheduledJobIdV1,
  UtcTimestampV1,
} from "@developer-os/core";
import {
  MAX_LAUNCHD_PLIST_BYTES,
  generatedLabel,
  gitSyncEligible,
  launchdGeneration,
  launchdJob,
  launchdLogPath,
  launchdPlistPath,
  launchdStatusPath,
  parseCanonicalLaunchdPlist,
  parseGeneratedLabel,
  parseScheduledProductHome,
  scheduledBaseArgv,
  scheduledProgramArguments,
} from "@developer-os/platform-macos";
import type {
  LaunchdCalendarIntervalV1,
  LaunchdGenerationV1,
  LaunchdGuiDomainV1,
} from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../../bootstrap/report.js";
import { readConfigFile } from "../../config-file.js";
import type { CliContext } from "../../context.js";
import { admitInstalledV2Home, observeLifecycleActivationRecord } from "../../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../../lifecycle/context.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import {
  gateManifestAdmission,
  requireLifecycleStagingRoot,
  withLifecycleMutation,
} from "../../lifecycle/mutation-gate.js";
import {
  AutomationRuntimeRecordStore,
  automationRunnerLeasePath,
  redactScheduledData,
  uninstallingMarkerPresent,
} from "../../lifecycle/runtime-records.js";
import type {
  AutomationInertOutcomeV1,
  AutomationStatusRecordV1,
  HeldAutomationLeaseV1,
  ScheduledHandlerResultV1,
} from "../../lifecycle/runtime-records.js";
import { runScheduledBrain } from "../brain.js";
import { runScheduledDoctor } from "../doctor.js";
import { runScheduledGarden } from "./garden.js";
import { runScheduledPulse } from "./pulse.js";
import { withScheduledJob } from "./scheduled-scope.js";

/** §2.3: a scheduled run waits at most ten minutes for the global lock, then tries once more. */
export const SCHEDULED_GLOBAL_LOCK_WAIT_MS = 600_000;

export interface ScheduledRunRequestV1 {
  readonly job: ScheduledJobIdV1;
  readonly generation: LaunchdGenerationV1;
}

export type ScheduledSilentReasonV1 =
  | "uninstalling"
  | "lease_busy"
  | "lease_released_by_uninstall"
  | "global_lock_busy"
  | "closure_not_clear";

export type ScheduledRunOutcomeV1 =
  | { readonly kind: "silent"; readonly reason: ScheduledSilentReasonV1 }
  | { readonly kind: "recorded"; readonly outcome: AutomationStatusRecordV1["outcome"] }
  | { readonly kind: "refused"; readonly code: ExitCode; readonly reason: SafeReasonCodeV1 };

export type ScheduledEligibilityV1 = "active" | "automation_disabled" | "git_disabled";

/** Stage 2's facts, read only while the lease and the global lock are both held. */
export interface ScheduledStateV1 {
  readonly closure: LifecycleJournalClosureV1["kind"];
  readonly eligibility: ScheduledEligibilityV1;
}

export interface ScheduledJobHandlersV1 {
  run(job: ScheduledJobIdV1, global: HeldLifecycleStableLockV1): Promise<ScheduledHandlerResultV1>;
}

export interface AutomationRunnerDependenciesV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly locks: LifecycleStableLockProviderV1;
  readonly nowMs: () => number;
  readonly sleepMs: (milliseconds: number) => Promise<void>;
  readonly clock: () => UtcTimestampV1;
  /** `guards.redactData`, bound to the product redactor in `context.ts`. */
  readonly redact: (data: unknown) => RedactedPayload;
  /** Stage 1; throws `ScheduledAuthenticationError` (or an admission refusal) and writes nothing. */
  authenticate(request: ScheduledRunRequestV1): Promise<void>;
  inspect(job: ScheduledJobIdV1): Promise<ScheduledStateV1>;
  /** Step 2's one process-free explanation of a lease path that is absent or replaced. */
  leaseRemovedByUninstall(job: ScheduledJobIdV1): Promise<boolean>;
  /** A record store whose transactions borrow this held global lock. */
  records(global: HeldLifecycleStableLockV1): Pick<AutomationRuntimeRecordStore, "writeStatus" | "writeLog">;
}

export class ScheduledAuthenticationError extends Error {
  readonly code = EXIT_CODES.securityRefusal;
  readonly reason: SafeReasonCodeV1;

  constructor(reason: string) {
    super(`the scheduled invocation is not an installed Developer OS generation: ${reason}`);
    this.name = "ScheduledAuthenticationError";
    this.reason = parseSafeReasonCode(reason);
  }
}

class LeaseIdentityError extends Error {}

const silent = (reason: ScheduledSilentReasonV1): ScheduledRunOutcomeV1 => ({ kind: "silent", reason });

function refused(error: unknown): ScheduledRunOutcomeV1 | null {
  if (error instanceof LeaseIdentityError) {
    return { kind: "refused", code: EXIT_CODES.recoveryRequired, reason: parseSafeReasonCode("automation_lease_identity") };
  }
  if (typeof error !== "object" || error === null || !("code" in error) || !("reason" in error)) return null;
  const { code, reason } = error as { readonly code: unknown; readonly reason: unknown };
  if (typeof code !== "number" || code === EXIT_CODES.success) return null;
  try {
    return { kind: "refused", code: code as ExitCode, reason: parseSafeReasonCode(reason) };
  } catch {
    return null;
  }
}

export class AutomationRunner {
  readonly #dependencies: AutomationRunnerDependenciesV1 & { readonly handlers: ScheduledJobHandlersV1 };

  constructor(dependencies: AutomationRunnerDependenciesV1 & { readonly handlers: ScheduledJobHandlersV1 }) {
    this.#dependencies = dependencies;
  }

  async run(request: ScheduledRunRequestV1): Promise<ScheduledRunOutcomeV1> {
    const job = launchdJob(request.job).id;
    try {
      if (await this.#markerPresent()) return silent("uninstalling");
      const lease = await this.#acquireLease(job);
      if (!("lock" in lease)) return lease;
      try {
        return await this.#underLease({ job, generation: request.generation }, lease);
      } finally {
        await lease.lock.release();
      }
    } catch (error) {
      const refusal = refused(error);
      if (refusal === null) throw error;
      return refusal;
    }
  }

  async #underLease(request: ScheduledRunRequestV1, lease: HeldAutomationLeaseV1): Promise<ScheduledRunOutcomeV1> {
    await this.#dependencies.authenticate(request);
    const global = await this.#acquireGlobal();
    if (global === null) return silent("global_lock_busy");
    try {
      return global.timedOut
        ? await this.#afterTimeout(request, lease, global.lock)
        : await this.#underGlobal(request, lease, global.lock);
    } finally {
      await global.lock.release();
    }
  }

  /** Step 2. */
  async #acquireLease(job: ScheduledJobIdV1): Promise<HeldAutomationLeaseV1 | ScheduledRunOutcomeV1> {
    const { fs, locks, productHome } = this.#dependencies;
    const path = automationRunnerLeasePath(productHome, job);
    // identity-free stat: presence only; the descriptor's own identity is compared below.
    if ((await fs.lstat(path)) === null) return this.#missingLease(job);
    let lock: HeldLifecycleStableLockV1;
    try {
      lock = await locks.acquireExisting(path);
    } catch (error) {
      if (error instanceof LifecycleLockBusyError) return silent("lease_busy");
      if (error instanceof LifecycleLockMissingError) return this.#missingLease(job);
      throw error;
    }
    const lease = { job, lock };
    let bound: boolean;
    let marker: boolean;
    try {
      bound = await this.#leaseStillBound(lease);
      marker = bound && (await this.#markerPresent());
    } catch (error) {
      await lock.release();
      throw error;
    }
    if (!bound || marker) await lock.release();
    if (!bound) return this.#missingLease(job);
    return marker ? silent("uninstalling") : lease;
  }

  async #missingLease(job: ScheduledJobIdV1): Promise<ScheduledRunOutcomeV1> {
    if ((await this.#markerPresent()) || (await this.#dependencies.leaseRemovedByUninstall(job))) {
      return silent("lease_released_by_uninstall");
    }
    return { kind: "refused", code: EXIT_CODES.recoveryRequired, reason: parseSafeReasonCode("automation_lease_missing") };
  }

  /** Step 4: the bounded wait, then exactly one final non-blocking attempt. */
  async #acquireGlobal(): Promise<{ readonly lock: HeldLifecycleStableLockV1; readonly timedOut: boolean } | null> {
    const { locks, nowMs, sleepMs, productHome } = this.#dependencies;
    const path = parseCanonicalAbsolutePathText(`${productHome}/state/.lifecycle.lock`);
    try {
      const [lock] = await locks.acquireExistingWithin([path], {
        nowMs,
        sleepMs,
        deadlineMs: nowMs() + SCHEDULED_GLOBAL_LOCK_WAIT_MS,
      });
      if (lock === undefined) throw new Error("the lock provider returned no global lock");
      return { lock, timedOut: false };
    } catch (error) {
      if (!(error instanceof LifecycleLockBusyError)) throw error;
    }
    try {
      return { lock: await locks.acquireExisting(path), timedOut: true };
    } catch (error) {
      if (error instanceof LifecycleLockBusyError) return null;
      throw error;
    }
  }

  /** The rechecks steps 4 and 5 share: marker, lease identity, stage-1 evidence, then stage 2. */
  async #recheck(request: ScheduledRunRequestV1, lease: HeldAutomationLeaseV1): Promise<ScheduledStateV1 | null> {
    if (await this.#markerPresent()) return null;
    if (!(await this.#leaseStillBound(lease))) throw new LeaseIdentityError();
    await this.#dependencies.authenticate(request);
    return this.#dependencies.inspect(request.job);
  }

  async #afterTimeout(
    request: ScheduledRunRequestV1,
    lease: HeldAutomationLeaseV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<ScheduledRunOutcomeV1> {
    const state = await this.#recheck(request, lease);
    if (state === null) return silent("uninstalling");
    if (state.closure !== "clear") return silent("closure_not_clear");
    return this.#writeInert(lease, global, state.eligibility === "active" ? "skipped_lock_timeout" : state.eligibility);
  }

  /** Steps 5–8. */
  async #underGlobal(
    request: ScheduledRunRequestV1,
    lease: HeldAutomationLeaseV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<ScheduledRunOutcomeV1> {
    const state = await this.#recheck(request, lease);
    if (state === null) return silent("uninstalling");
    const retry = request.job === "git-sync" && state.closure === "retry_only" && state.eligibility === "active";
    if (state.closure !== "clear" && !retry) return silent("closure_not_clear");
    if (state.eligibility !== "active") return this.#writeInert(lease, global, state.eligibility);

    const { clock, redact } = this.#dependencies;
    const startedAt = clock();
    const result = await this.#invoke(request.job, global);
    const completedAt = clock();
    const data = redactScheduledData(redact(result.data));

    if (await this.#markerPresent()) return silent("uninstalling");
    if ((await this.#dependencies.inspect(request.job)).closure !== "clear") return silent("closure_not_clear");
    await this.#dependencies.records(global).writeLog(
      {
        schemaVersion: 1,
        job: request.job,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        startedAt,
        completedAt: completedAt < startedAt ? startedAt : completedAt,
        data,
      },
      lease,
    );
    return { kind: "recorded", outcome: result.outcome };
  }

  async #invoke(job: ScheduledJobIdV1, global: HeldLifecycleStableLockV1): Promise<ScheduledHandlerResultV1> {
    try {
      return await withScheduledJob(job, () => this.#dependencies.handlers.run(job, global));
    } catch (error) {
      return {
        outcome: "handler_failed",
        reasonCode: parseSafeReasonCode("handler_exception"),
        data: { message: error instanceof Error ? error.message : "the handler threw a non-error value" },
      };
    }
  }

  async #writeInert(
    lease: HeldAutomationLeaseV1,
    global: HeldLifecycleStableLockV1,
    outcome: AutomationInertOutcomeV1,
  ): Promise<ScheduledRunOutcomeV1> {
    await this.#dependencies.records(global).writeStatus(
      {
        schemaVersion: 1,
        job: lease.job,
        outcome,
        reasonCode: parseSafeReasonCode(outcome),
        startedAt: null,
        completedAt: this.#dependencies.clock(),
      },
      lease,
    );
    return { kind: "recorded", outcome };
  }

  #markerPresent(): Promise<boolean> {
    return uninstallingMarkerPresent(this.#dependencies.fs, this.#dependencies.productHome);
  }

  async #leaseStillBound(lease: HeldAutomationLeaseV1): Promise<boolean> {
    // identity-free stat: compared against the held descriptor's identity and not recorded.
    const entry = await this.#dependencies.fs.lstat(lease.lock.path);
    return entry !== null && entry.dev === lease.lock.dev && entry.ino === lease.lock.ino;
  }
}

const LAUNCHD_WEEKDAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The inverse of `launchdCalendarInterval`; `launchdGeneration` re-validates the result. */
function scheduleOf(interval: LaunchdCalendarIntervalV1): NormalizedScheduleV1 {
  if ("Weekday" in interval) {
    const day = LAUNCHD_WEEKDAY_IDS[interval.Weekday];
    if (day === undefined) throw new ScheduledAuthenticationError("scheduled_plist_not_canonical");
    return { cadence: "weekly", day, hour: interval.Hour, minute: interval.Minute };
  }
  if ("Hour" in interval) return { cadence: "daily", hour: interval.Hour, minute: interval.Minute };
  return { cadence: "hourly", minute: interval.Minute };
}

export interface ScheduledInstallationEvidenceV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly userHome: CanonicalAbsolutePathV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly executablePath: CanonicalAbsolutePathV1;
  readonly manifest: InstallationManifestV2;
  /** The guarded bytes at the job's exact plist path, or null when nothing owned is there. */
  readonly plistBytes: Uint8Array | null;
}

/**
 * §5.3 stage 1: the manifest owns the exact plist path and hash, the plist parses canonically,
 * and its label, argv and every projected field reproduce the supplied generation. Nothing
 * here reads configuration or activation — a stale plist still authenticates, and stage 2
 * decides that it may only write an inert status.
 */
export function authenticateScheduledGeneration(
  request: ScheduledRunRequestV1,
  evidence: ScheduledInstallationEvidenceV1,
): void {
  const job = launchdJob(request.job).id;
  const plistPath = launchdPlistPath(evidence.userHome, job);
  const owned = evidence.manifest.artifacts.find((artifact) => artifact.path === plistPath);
  if (owned?.owner !== "macos" || owned.kind !== "file" || owned.verification.mode !== "content") {
    throw new ScheduledAuthenticationError("scheduled_plist_unowned");
  }
  if (evidence.plistBytes === null || hashBytes(evidence.plistBytes) !== owned.verification.installedHash) {
    throw new ScheduledAuthenticationError("scheduled_plist_drifted");
  }
  let dictionary: ReturnType<typeof parseCanonicalLaunchdPlist>;
  let labelled: ReturnType<typeof parseGeneratedLabel>;
  try {
    dictionary = parseCanonicalLaunchdPlist(evidence.plistBytes);
    labelled = parseGeneratedLabel(dictionary.Label);
  } catch {
    throw new ScheduledAuthenticationError("scheduled_plist_not_canonical");
  }
  if (labelled.job !== job || labelled.generation !== request.generation) {
    throw new ScheduledAuthenticationError("scheduled_generation_mismatch");
  }
  const productHome = parseScheduledProductHome(evidence.productHome);
  const actual: readonly string[] = dictionary.ProgramArguments;
  // NEW-144: argv[0] is the Node launchd ran, read from the manifest-hash-bound plist bytes above and
  // bound below by the generation it reproduces. A pre-NEW-144 nine-argument plist never matches.
  const node = actual.length === 10 ? (actual[0] as CanonicalAbsolutePathV1) : evidence.executablePath;
  const expected = scheduledProgramArguments(job, productHome, request.generation, evidence.executablePath, node);
  if (actual.length !== expected.length || expected.some((argument, index) => actual[index] !== argument)) {
    throw new ScheduledAuthenticationError("scheduled_projection_mismatch");
  }
  let generation: LaunchdGenerationV1;
  try {
    generation = launchdGeneration({
      job,
      baseLabel: launchdJob(job).baseLabel,
      domain: evidence.domain,
      schedule: scheduleOf(dictionary.StartCalendarInterval),
      productHome,
      plistPath,
      executablePath: evidence.executablePath,
      baseArgv: scheduledBaseArgv(job, productHome, evidence.executablePath, node),
      logPath: launchdLogPath(productHome, job),
      statusPath: launchdStatusPath(productHome, job),
    });
  } catch {
    throw new ScheduledAuthenticationError("scheduled_projection_mismatch");
  }
  if (generation !== request.generation || dictionary.Label !== generatedLabel(job, generation)) {
    throw new ScheduledAuthenticationError("scheduled_generation_mismatch");
  }
}

/**
 * §5.1 stage 2: exact active provenance — the lifecycle record and, since Ruling 37, the
 * `brain-garden` pin — then `git-sync`'s Git eligibility. Malformed,
 * disabled, inactive, incomplete or mismatched state is `automation_disabled` — never a refusal,
 * because an inert record is the whole of what a stale plist may leave.
 */
export async function scheduledEligibility(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  job: ScheduledJobIdV1,
): Promise<ScheduledEligibilityV1> {
  let config: Awaited<ReturnType<typeof readConfigFile>>;
  let activation: Awaited<ReturnType<typeof observeLifecycleActivationRecord>>;
  try {
    config = await readConfigFile(context, context.paths.configFile);
    activation = await observeLifecycleActivationRecord(lifecycle.fs, context.paths);
  } catch {
    return "automation_disabled";
  }
  if (config === null || activation.state === "absent") return "automation_disabled";
  const { automation } = config;
  const arm = activation.record.automation;
  if (
    !automation.enabled ||
    automation.lifecycle === undefined ||
    arm.state !== "active" ||
    arm.configHash !== lifecycleConfigHash("automation", automation.lifecycle, automation.brainGarden)
  ) {
    return "automation_disabled";
  }
  if (job === "git-sync" && !gitSyncEligible(config.git, activation.record)) return "git_disabled";
  return automation.lifecycle.schedules.some((entry) => entry.job === job) ? "active" : "automation_disabled";
}

export interface ScheduledInstallationV1 {
  /** The guarded canonical home of the console user, never ambient `HOME`. */
  readonly userHome: CanonicalAbsolutePathV1;
  readonly domain: LaunchdGuiDomainV1;
  /** The supported installed Developer OS executable every plist's argv[0] must name. */
  readonly executablePath: CanonicalAbsolutePathV1;
}

/** The production ports over one admitted home; Task 17's scheduled grammar supplies `installation`. */
export function createAutomationRunnerDependencies(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  installation: ScheduledInstallationV1,
): AutomationRunnerDependenciesV1 {
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const admit = (): ReturnType<typeof admitInstalledV2Home> =>
    admitInstalledV2Home({
      fs: lifecycle.fs,
      paths: context.paths,
      manifestAdmission: gateManifestAdmission(context),
      effectiveUid: lifecycle.effectiveUid,
    });
  /** `underGlobal` is false only for step 2's lock-free recheck, which must never write. */
  const closureOf = async (underGlobal: boolean): Promise<LifecycleJournalClosureV1["kind"]> => {
    const admitted = await admit();
    if (underGlobal) await requireLifecycleStagingRoot(lifecycle, context.paths);
    const residue = residueFrom(
      await inspectBootstrapEvidenceAdmission(
        createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }),
      ),
    );
    return (await lifecycle.inspectLedger(lifecycleHomeKeyFromAdmission(admitted, context.paths), residue)).closure.kind;
  };
  return {
    productHome,
    fs: lifecycle.fs,
    locks: lifecycle.locks,
    nowMs: lifecycle.nowMs,
    sleepMs: lifecycle.sleepMs,
    clock: lifecycle.clock,
    redact: context.guards.redactData,
    authenticate: async (request) => {
      const { manifest } = await admit();
      const plistPath = launchdPlistPath(installation.userHome, request.job);
      // identity-free stat: the guarded port's entry, read through the same port; no dev/ino is recorded.
      const entry = await lifecycle.fs.lstat(plistPath);
      const plistBytes =
        entry?.kind === "regular_file" && entry.ownerUid === lifecycle.effectiveUid && entry.nlink === 1
          ? await lifecycle.fs.readRegular(entry, MAX_LAUNCHD_PLIST_BYTES)
          : null;
      authenticateScheduledGeneration(request, { ...installation, productHome, manifest, plistBytes });
    },
    inspect: async (job) => ({
      closure: await closureOf(true),
      eligibility: await scheduledEligibility(context, lifecycle, job),
    }),
    leaseRemovedByUninstall: async (job) => {
      // identity-free stat: presence of the manifest alone.
      const manifest = await lifecycle.fs.lstat(parseCanonicalAbsolutePathText(context.paths.manifestFile));
      if (manifest === null) return true;
      // identity-free stat: absence of the bound lease path is the whole of the proof read here.
      const leaseGone = (await lifecycle.fs.lstat(automationRunnerLeasePath(productHome, job))) === null;
      if (!leaseGone) return false;
      try {
        return (await closureOf(false)) === "uninstall_draining";
      } catch (error) {
        if (refused(error) === null) throw error;
        return false;
      }
    },
    records: (global) =>
      new AutomationRuntimeRecordStore({
        fs: lifecycle.fs,
        productHome,
        effectiveUid: lifecycle.effectiveUid,
        execute: (plan) =>
          withLifecycleMutation(context, lifecycle, () => context.executor.execute(plan), undefined, { global }),
      }),
  };
}

/**
 * The local §5.1 handlers, plus NEW-134's `brain-garden` and `brain-pulse`. `git-sync` is the §4 sync handler, which only the Git
 * command owns; until it is supplied the job refuses rather than running something else.
 */
export function createScheduledJobHandlers(
  context: CliContext,
  gitSync: ScheduledJobHandlersV1 | null,
): ScheduledJobHandlersV1 {
  return {
    run: (job, global) => {
      switch (job) {
        case "brain-reindex":
        case "brain-lint":
          return runScheduledBrain(context, job, global);
        case "doctor":
          return runScheduledDoctor(context);
        case "git-sync":
          return gitSync === null
            ? Promise.resolve({
                outcome: "handler_refused",
                reasonCode: parseSafeReasonCode("git_sync_handler_unavailable"),
                data: null,
              })
            : gitSync.run(job, global);
        case "brain-garden":
          return runScheduledGarden(context, global);
        case "brain-pulse":
          return runScheduledPulse(context, global);
        default: {
          const unknown: never = job;
          throw new Error(`unknown scheduled job ${String(unknown)}`);
        }
      }
    },
  };
}
