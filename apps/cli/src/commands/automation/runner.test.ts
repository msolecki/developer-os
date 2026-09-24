import { describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  LifecycleLockBusyError,
  LifecycleLockMissingError,
  LifecycleRecoveryRequiredError,
  SCHEDULED_JOB_IDS,
  hashBytes,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  redactPayload,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleJournalClosureV1,
  LifecycleLockDeadlineV1,
  LifecycleStableLockProviderV1,
  ScheduledJobIdV1,
  UtcTimestampV1,
} from "@developer-os/core";
import {
  encodeLaunchdPlist,
  launchdGeneration,
  launchdGuiDomain,
  launchdJob,
  launchdLogPath,
  launchdPlistDictionary,
  launchdPlistPath,
  launchdStatusPath,
  parseScheduledProductHome,
  scheduledBaseArgv,
} from "@developer-os/platform-macos";
import type { LaunchdGenerationV1 } from "@developer-os/platform-macos";

import {
  automationRunnerLeasePath,
  uninstallingMarkerPath,
} from "../../lifecycle/runtime-records.js";
import type {
  AutomationLogRecordV1,
  AutomationStatusRecordV1,
  HeldAutomationLeaseV1,
  ScheduledHandlerResultV1,
} from "../../lifecycle/runtime-records.js";
import {
  AutomationRunner,
  SCHEDULED_GLOBAL_LOCK_WAIT_MS,
  ScheduledAuthenticationError,
  authenticateScheduledGeneration,
} from "./runner.js";
import type { ScheduledEligibilityV1, ScheduledRunRequestV1 } from "./runner.js";

const PRODUCT_HOME = parseCanonicalAbsolutePathText("/synthetic-user/.developer-os");
const USER_HOME = parseCanonicalAbsolutePathText("/synthetic-user");
const EXECUTABLE = parseCanonicalAbsolutePathText("/synthetic-user/.developer-os/bin/developer-os");
const GLOBAL = parseCanonicalAbsolutePathText(`${PRODUCT_HOME}/state/.lifecycle.lock`);
const GENERATION = parseLowerHexSha256("a".repeat(64));
const SECRET = "sk-synthetic-0123456789abcdef";
const START_MS = Date.parse("2026-09-23T02:00:00.000Z");

function entry(path: CanonicalAbsolutePathV1, ino: string, size = "0"): LifecycleGuardedEntryV1 {
  return {
    path,
    kind: "regular_file",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal(size),
    dev: parseUInt64Decimal("16777232"),
    ino: parseUInt64Decimal(ino),
  };
}

interface RunnerFixtureOptions {
  readonly job?: ScheduledJobIdV1;
  readonly eligibility?: ScheduledEligibilityV1;
  readonly closure?: LifecycleJournalClosureV1["kind"];
  /** The closure step 8 reads after the handler; defaults to `closure`. */
  readonly closureAfterHandler?: LifecycleJournalClosureV1["kind"];
  readonly leaseAbsent?: boolean;
  readonly leaseBusy?: boolean;
  readonly leaseReplacedOnAcquire?: boolean;
  /** The post-acquisition identity recheck itself refuses. */
  readonly leaseRecheckRefuses?: boolean;
  readonly markerPresent?: boolean;
  readonly markerAfterLease?: boolean;
  readonly uninstallProof?: boolean;
  readonly globalBusyWithin?: boolean;
  readonly globalBusyFinal?: boolean;
  readonly authenticationFailure?: string;
  readonly handler?: (job: ScheduledJobIdV1, global: HeldLifecycleStableLockV1) => Promise<ScheduledHandlerResultV1>;
}

function runnerFixture(options: RunnerFixtureOptions = {}) {
  const job = options.job ?? "brain-reindex";
  const leasePath = automationRunnerLeasePath(PRODUCT_HOME, job);
  const markerPath = uninstallingMarkerPath(PRODUCT_HOME);
  const files = new Map<string, LifecycleGuardedEntryV1>();
  if (options.leaseAbsent !== true) files.set(leasePath, entry(leasePath, "100"));
  // Fresh `init` reserves the marker path as an empty file; only a non-empty one is a marker.
  files.set(markerPath, entry(markerPath, "200", options.markerPresent === true ? "96" : "0"));

  const lockEvents: string[] = [];
  const deadlines: number[] = [];
  const statuses: AutomationStatusRecordV1[] = [];
  const logs: AutomationLogRecordV1[] = [];
  const handlerCalls: ScheduledJobIdV1[] = [];
  const networkCalls: string[] = [];
  const authentications: ScheduledRunRequestV1[] = [];
  let inspections = 0;
  let leaseRecheckArmed = false;
  let clockTick = 0;
  let nowMs = START_MS;

  const held = (path: CanonicalAbsolutePathV1, ino: string, label: string): HeldLifecycleStableLockV1 => ({
    path,
    dev: parseUInt64Decimal("16777232"),
    ino: parseUInt64Decimal(ino),
    release: () => {
      lockEvents.push(`${label}-released`);
      return Promise.resolve();
    },
  });

  const locks: LifecycleStableLockProviderV1 = {
    acquireExisting: (path) => {
      if (path === leasePath) {
        if (options.leaseAbsent === true) return Promise.reject(new LifecycleLockMissingError(path));
        if (options.leaseBusy === true) return Promise.reject(new LifecycleLockBusyError(path));
        lockEvents.push("lease-acquired");
        if (options.leaseReplacedOnAcquire === true) files.set(leasePath, entry(leasePath, "101"));
        if (options.leaseRecheckRefuses === true) leaseRecheckArmed = true;
        if (options.markerAfterLease === true) files.set(markerPath, entry(markerPath, "200", "96"));
        return Promise.resolve(held(path, "100", "lease"));
      }
      if (path === GLOBAL) {
        lockEvents.push("global-final");
        if (options.globalBusyFinal === true) return Promise.reject(new LifecycleLockBusyError(path));
        return Promise.resolve(held(path, "300", "global"));
      }
      return Promise.reject(new Error(`unexpected lock ${path}`));
    },
    acquireExistingWithin: (paths, deadline: LifecycleLockDeadlineV1) => {
      lockEvents.push("global-wait");
      deadlines.push(deadline.deadlineMs - deadline.nowMs());
      if (paths.length !== 1 || paths[0] !== GLOBAL) return Promise.reject(new Error("unexpected wait"));
      if (options.globalBusyWithin === true) {
        nowMs += SCHEDULED_GLOBAL_LOCK_WAIT_MS;
        return Promise.reject(new LifecycleLockBusyError(GLOBAL));
      }
      lockEvents.push("global-acquired");
      return Promise.resolve([held(GLOBAL, "300", "global")]);
    },
  };

  const fs = {
    lstat: (path: CanonicalAbsolutePathV1) =>
      leaseRecheckArmed && path === leasePath
        ? Promise.reject(new LifecycleRecoveryRequiredError("lifecycle_guarded_identity", [path]))
        : Promise.resolve(files.get(path) ?? null),
  } as unknown as LifecycleGuardedFileSystemV1;

  const runner = new AutomationRunner({
    productHome: PRODUCT_HOME,
    fs,
    locks,
    nowMs: () => nowMs,
    sleepMs: (milliseconds) => {
      nowMs += milliseconds;
      return Promise.resolve();
    },
    clock: (): UtcTimestampV1 => {
      clockTick += 1;
      return parseUtcTimestamp(new Date(START_MS + clockTick * 1_000).toISOString());
    },
    redact: (data) => redactPayload((text) => text.replaceAll(SECRET, "[redacted]"), data),
    authenticate: (request) => {
      authentications.push(request);
      return options.authenticationFailure === undefined
        ? Promise.resolve()
        : Promise.reject(new ScheduledAuthenticationError(options.authenticationFailure));
    },
    inspect: () => {
      inspections += 1;
      const closure =
        inspections > 1 && options.closureAfterHandler !== undefined
          ? options.closureAfterHandler
          : (options.closure ?? "clear");
      return Promise.resolve({ closure, eligibility: options.eligibility ?? "active" });
    },
    leaseRemovedByUninstall: () => Promise.resolve(options.uninstallProof === true),
    records: () => ({
      writeStatus: (record: AutomationStatusRecordV1, lease: HeldAutomationLeaseV1) => {
        expect(lease.job).toBe(record.job);
        statuses.push(record);
        return Promise.resolve();
      },
      writeLog: (record: AutomationLogRecordV1, lease: HeldAutomationLeaseV1) => {
        expect(lease.job).toBe(record.job);
        logs.push(record);
        return Promise.resolve();
      },
    }),
    handlers: {
      run: (runJob, global) => {
        handlerCalls.push(runJob);
        if (runJob === "git-sync") networkCalls.push("push");
        return (
          options.handler?.(runJob, global) ??
          Promise.resolve({ outcome: "success", reasonCode: parseSafeReasonCode("ok"), data: { written: [] } })
        );
      },
    },
  });

  return {
    runner,
    request: { job, generation: GENERATION } satisfies ScheduledRunRequestV1,
    lockEvents,
    deadlines,
    statuses,
    logs,
    handlerCalls,
    networkCalls,
    authentications,
  };
}

describe("AutomationRunner step order", () => {
  it("acquires the lifetime lease before waiting for the global lock", async () => {
    const fixture = runnerFixture();
    await fixture.runner.run(fixture.request);
    expect(fixture.lockEvents.slice(0, 2)).toEqual(["lease-acquired", "global-wait"]);
    expect(fixture.lockEvents.slice(-2)).toEqual(["global-released", "lease-released"]);
  });

  it("runs the handler under the held global lock and records one redacted log and status", async () => {
    let seen: HeldLifecycleStableLockV1 | null = null;
    const fixture = runnerFixture({
      handler: (_job, global) => {
        seen = global;
        return Promise.resolve({ outcome: "success", reasonCode: parseSafeReasonCode("ok"), data: { note: SECRET } });
      },
    });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "recorded", outcome: "success" });
    expect(seen).toMatchObject({ path: GLOBAL });
    expect(fixture.logs).toHaveLength(1);
    expect(JSON.stringify(fixture.logs[0])).not.toContain(SECRET);
    expect(fixture.logs[0]?.data).toStrictEqual({ note: "[redacted]" });
    expect(fixture.statuses).toStrictEqual([]);
  });

  it("records a handler that throws as handler_failed", async () => {
    const fixture = runnerFixture({ handler: () => Promise.reject(new Error(`boom ${SECRET}`)) });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "recorded", outcome: "handler_failed" });
    expect(fixture.logs[0]).toMatchObject({ outcome: "handler_failed", reasonCode: "handler_exception" });
    expect(JSON.stringify(fixture.logs[0])).not.toContain(SECRET);
  });
});

describe("AutomationRunner inert outcomes", () => {
  it.each(["automation_disabled", "git_disabled"] as const)("records only inert %s", async (outcome) => {
    const fixture = runnerFixture({ job: "git-sync", eligibility: outcome });
    await fixture.runner.run(fixture.request);
    expect(fixture.handlerCalls).toEqual([]);
    expect(fixture.networkCalls).toEqual([]);
    expect(fixture.logs).toEqual([]);
    expect(fixture.statuses).toHaveLength(1);
    expect(fixture.statuses[0]).toMatchObject({ outcome, startedAt: null, reasonCode: outcome });
  });

  it("authenticates a stale installation at stage 1 and still records only automation_disabled", async () => {
    const fixture = runnerFixture({ eligibility: "automation_disabled" });
    await fixture.runner.run(fixture.request);
    expect(fixture.authentications.length).toBeGreaterThan(0);
    expect(fixture.statuses[0]).toMatchObject({ outcome: "automation_disabled" });
  });
});

describe("AutomationRunner lease", () => {
  it("exits silently when another run of the same job holds the lease", async () => {
    const fixture = runnerFixture({ leaseBusy: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "lease_busy" });
    expect(fixture.lockEvents).toEqual([]);
    expect(fixture.statuses).toEqual([]);
    expect(fixture.authentications).toEqual([]);
  });

  it("refuses recovery-required when the lease is absent with no uninstall proof", async () => {
    const fixture = runnerFixture({ leaseAbsent: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({
      kind: "refused",
      code: EXIT_CODES.recoveryRequired,
      reason: "automation_lease_missing",
    });
    expect(fixture.statuses).toEqual([]);
  });

  it("exits silently when the lease is absent because an uninstall drained it", async () => {
    const fixture = runnerFixture({ leaseAbsent: true, uninstallProof: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "lease_released_by_uninstall" });
    expect(fixture.lockEvents).toEqual([]);
  });

  it("releases a replaced lease and refuses without uninstall proof", async () => {
    const fixture = runnerFixture({ leaseReplacedOnAcquire: true });
    expect(await fixture.runner.run(fixture.request)).toMatchObject({ kind: "refused", reason: "automation_lease_missing" });
    expect(fixture.lockEvents).toEqual(["lease-acquired", "lease-released"]);
  });

  it("releases a replaced lease and exits silently with uninstall proof", async () => {
    const fixture = runnerFixture({ leaseReplacedOnAcquire: true, uninstallProof: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "lease_released_by_uninstall" });
    expect(fixture.lockEvents).toEqual(["lease-acquired", "lease-released"]);
  });
});

describe("AutomationRunner lease error paths", () => {
  it("releases an acquired lease whose identity recheck refuses, and reports the refusal", async () => {
    const fixture = runnerFixture({ leaseRecheckRefuses: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({
      kind: "refused",
      code: EXIT_CODES.recoveryRequired,
      reason: "lifecycle_guarded_identity",
    });
    expect(fixture.lockEvents).toEqual(["lease-acquired", "lease-released"]);
    expect(fixture.statuses).toEqual([]);
  });
});

describe("AutomationRunner uninstall marker", () => {
  it("exits silently before the lease when the marker is present", async () => {
    const fixture = runnerFixture({ markerPresent: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "uninstalling" });
    expect(fixture.lockEvents).toEqual([]);
    expect(fixture.authentications).toEqual([]);
  });

  it("rechecks the marker after the lease and exits silently, releasing it", async () => {
    const fixture = runnerFixture({ markerAfterLease: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "uninstalling" });
    expect(fixture.lockEvents).toEqual(["lease-acquired", "lease-released"]);
    expect(fixture.statuses).toEqual([]);
  });
});

describe("AutomationRunner stage 1", () => {
  it("refuses before any global wait, status, or handler", async () => {
    const fixture = runnerFixture({ authenticationFailure: "scheduled_plist_drifted" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({
      kind: "refused",
      code: EXIT_CODES.securityRefusal,
      reason: "scheduled_plist_drifted",
    });
    expect(fixture.lockEvents).toEqual(["lease-acquired", "lease-released"]);
    expect(fixture.handlerCalls).toEqual([]);
    expect(fixture.statuses).toEqual([]);
  });
});

describe("AutomationRunner global-lock deadline", () => {
  it("waits at most ten minutes, then exits silently when the final attempt is busy", async () => {
    const fixture = runnerFixture({ globalBusyWithin: true, globalBusyFinal: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "global_lock_busy" });
    expect(fixture.deadlines).toEqual([SCHEDULED_GLOBAL_LOCK_WAIT_MS]);
    expect(fixture.lockEvents).toEqual(["lease-acquired", "global-wait", "global-final", "lease-released"]);
    expect(fixture.statuses).toEqual([]);
  });

  it("records skipped_lock_timeout when the one final attempt succeeds on active state", async () => {
    const fixture = runnerFixture({ globalBusyWithin: true });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "recorded", outcome: "skipped_lock_timeout" });
    expect(fixture.handlerCalls).toEqual([]);
    expect(fixture.logs).toEqual([]);
    expect(fixture.statuses[0]).toMatchObject({ outcome: "skipped_lock_timeout", startedAt: null });
    expect(fixture.lockEvents.slice(-2)).toEqual(["global-released", "lease-released"]);
  });

  it("records automation_disabled rather than a timeout for inactive state", async () => {
    const fixture = runnerFixture({ globalBusyWithin: true, eligibility: "automation_disabled" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "recorded", outcome: "automation_disabled" });
  });

  it("exits silently after the final attempt when closure is not clear", async () => {
    const fixture = runnerFixture({ globalBusyWithin: true, closure: "lifecycle_recovery_required" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "closure_not_clear" });
    expect(fixture.statuses).toEqual([]);
  });
});

describe("AutomationRunner closure", () => {
  it.each(["retry_only", "uninstall_draining", "lifecycle_recovery_required"] as const)(
    "exits silently for a non-Git job under %s closure",
    async (closure) => {
      const fixture = runnerFixture({ closure });
      expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "closure_not_clear" });
      expect(fixture.handlerCalls).toEqual([]);
      expect(fixture.statuses).toEqual([]);
      expect(fixture.logs).toEqual([]);
    },
  );

  it("lets an active git-sync proceed to its bound retry under retry_only, then records once clear", async () => {
    const fixture = runnerFixture({ job: "git-sync", closure: "retry_only", closureAfterHandler: "clear" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "recorded", outcome: "success" });
    expect(fixture.handlerCalls).toEqual(["git-sync"]);
    expect(fixture.logs).toHaveLength(1);
  });

  it("writes nothing when the post-handler recheck is still retry_only", async () => {
    const fixture = runnerFixture({ job: "git-sync", closure: "retry_only" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "closure_not_clear" });
    expect(fixture.handlerCalls).toEqual(["git-sync"]);
    expect(fixture.logs).toEqual([]);
    expect(fixture.statuses).toEqual([]);
  });

  it("exits silently for a git-sync under retry_only that is no longer active", async () => {
    const fixture = runnerFixture({ job: "git-sync", closure: "retry_only", eligibility: "git_disabled" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "closure_not_clear" });
    expect(fixture.handlerCalls).toEqual([]);
    expect(fixture.networkCalls).toEqual([]);
  });

  it("writes nothing when the closure is no longer clear after the handler", async () => {
    const fixture = runnerFixture({ closureAfterHandler: "lifecycle_recovery_required" });
    expect(await fixture.runner.run(fixture.request)).toStrictEqual({ kind: "silent", reason: "closure_not_clear" });
    expect(fixture.handlerCalls).toEqual(["brain-reindex"]);
    expect(fixture.logs).toEqual([]);
  });
});

describe("authenticateScheduledGeneration", () => {
  const productHome = parseScheduledProductHome(PRODUCT_HOME);
  const domain = launchdGuiDomain(parseEffectiveUid(501, 501));

  function installed(job: ScheduledJobIdV1 = "doctor") {
    const plistPath = launchdPlistPath(USER_HOME, job);
    const projection = {
      job,
      baseLabel: launchdJob(job).baseLabel,
      domain,
      schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 },
      productHome,
      plistPath,
      executablePath: EXECUTABLE,
      baseArgv: scheduledBaseArgv(job, productHome, EXECUTABLE),
      logPath: launchdLogPath(productHome, job),
      statusPath: launchdStatusPath(productHome, job),
    } as const;
    const generation: LaunchdGenerationV1 = launchdGeneration(projection);
    const plistBytes = new TextEncoder().encode(encodeLaunchdPlist(launchdPlistDictionary(projection, generation)));
    const manifest = {
      artifacts: [
        { owner: "macos", path: plistPath, kind: "file", verification: { mode: "content", installedHash: hashBytes(plistBytes) } },
      ],
    } as unknown as InstallationManifestV2;
    return {
      request: { job, generation },
      evidence: { productHome: PRODUCT_HOME, userHome: USER_HOME, domain, executablePath: EXECUTABLE, manifest, plistBytes },
    };
  }

  it("authenticates every registry job from exact retained evidence alone", () => {
    expect(SCHEDULED_JOB_IDS.length).toBe(4);
    for (const job of SCHEDULED_JOB_IDS) {
      const { request, evidence } = installed(job);
      expect(() => {
        authenticateScheduledGeneration(request, evidence);
      }).not.toThrow();
    }
  });

  it.each([
    ["an absent plist", (input: ReturnType<typeof installed>) => ({ ...input, evidence: { ...input.evidence, plistBytes: null } }), "scheduled_plist_drifted"],
    ["drifted plist bytes", (input: ReturnType<typeof installed>) => ({ ...input, evidence: { ...input.evidence, plistBytes: new TextEncoder().encode("<plist/>\n") } }), "scheduled_plist_drifted"],
    ["an unowned plist", (input: ReturnType<typeof installed>) => ({ ...input, evidence: { ...input.evidence, manifest: { artifacts: [] } as unknown as InstallationManifestV2 } }), "scheduled_plist_unowned"],
    ["another generation", (input: ReturnType<typeof installed>) => ({ ...input, request: { ...input.request, generation: GENERATION } }), "scheduled_generation_mismatch"],
    ["another executable", (input: ReturnType<typeof installed>) => ({ ...input, evidence: { ...input.evidence, executablePath: parseCanonicalAbsolutePathText("/synthetic-user/other-binary") } }), "scheduled_projection_mismatch"],
    ["another product home", (input: ReturnType<typeof installed>) => ({ ...input, evidence: { ...input.evidence, productHome: parseCanonicalAbsolutePathText("/synthetic-user/other-home") } }), "scheduled_projection_mismatch"],
  ])("refuses %s", (_label, mutate, reason) => {
    const { request, evidence } = mutate(installed());
    let thrown: unknown = null;
    try {
      authenticateScheduledGeneration(request, evidence);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScheduledAuthenticationError);
    expect(thrown).toMatchObject({ reason, code: EXIT_CODES.securityRefusal });
  });
});
