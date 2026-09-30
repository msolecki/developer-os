import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LIFECYCLE_LEDGER_BOUNDS,
  SCHEDULED_JOB_IDS,
  createNodeLifecycleGuardedFileSystem,
  parseCanonicalAbsolutePathText,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  redactPayload,
  standaloneFoundationLeafReservation,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  LifecycleGuardedFileSystemV1,
  TransactionPlan,
} from "@developer-os/core";

import {
  AUTOMATION_LOG_SLOTS,
  AutomationRuntimeRecordError,
  AutomationRuntimeRecordStore,
  MAX_AUTOMATION_LOG_BYTES,
  MAX_AUTOMATION_STATUS_BYTES,
  PULSE_REPORT_SLOTS,
  pulseReportSlotPath,
  MAX_REDACTED_JSON_DEPTH,
  MAX_REDACTED_JSON_ENTRIES,
  automationLogSlotPath,
  automationRunnerLeasePath,
  automationStatusPath,
  encodeAutomationLogRecord,
  encodeAutomationStatusRecord,
  parseAutomationLogRecord,
  parseAutomationStatusRecord,
  planLogRotation,
  redactScheduledData,
  uninstallingMarkerPresent,
  validateAutomationLogRecord,
  validateAutomationStatusRecord,
} from "./runtime-records.js";
import type { AutomationLogRecordV1, AutomationStatusRecordV1, HeldAutomationLeaseV1 } from "./runtime-records.js";

const UID = process.getuid?.() ?? 0;
const STARTED = parseUtcTimestamp("2026-09-23T02:00:00.000Z");
const COMPLETED = parseUtcTimestamp("2026-09-23T02:00:05.000Z");
const SECRET = "sk-synthetic-0123456789abcdef";
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

function success(job: AutomationLogRecordV1["job"] = "brain-reindex", data: AutomationLogRecordV1["data"] = null): AutomationLogRecordV1 {
  return { schemaVersion: 1, job, outcome: "success", reasonCode: parseSafeReasonCode("ok"), startedAt: STARTED, completedAt: COMPLETED, data };
}

function inert(outcome: "git_disabled" | "automation_disabled" | "skipped_lock_timeout"): AutomationStatusRecordV1 {
  return { schemaVersion: 1, job: "git-sync", outcome, reasonCode: parseSafeReasonCode(outcome), startedAt: null, completedAt: COMPLETED };
}

function guardedFs(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: UID,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

interface StoreFixture {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly plans: TransactionPlan[];
  readonly store: AutomationRuntimeRecordStore;
  lease(job: HeldAutomationLeaseV1["job"]): Promise<HeldAutomationLeaseV1>;
}

/** A real product-home tree whose "transaction" applies each planned mutation to disk. */
async function storeFixture(): Promise<StoreFixture> {
  const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-runtime-records-")));
  roots.push(root);
  const productHome = parseCanonicalAbsolutePathText(join(root, ".developer-os"));
  await nodeFs.mkdir(join(productHome, "state"), { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(join(productHome, "logs"), { recursive: true, mode: 0o700 });
  for (const job of SCHEDULED_JOB_IDS) {
    await nodeFs.writeFile(automationRunnerLeasePath(productHome, job), new Uint8Array(), { mode: 0o600 });
  }
  const plans: TransactionPlan[] = [];
  const store = new AutomationRuntimeRecordStore({
    fs: guardedFs(),
    productHome,
    effectiveUid: UID,
    execute: async (plan) => {
      plans.push(plan);
      for (const mutation of plan.mutations) {
        if (mutation.operation === "remove") await nodeFs.rm(mutation.targetPath);
        else await nodeFs.writeFile(mutation.targetPath, mutation.content ?? new Uint8Array(), { mode: 0o600 });
      }
    },
  });
  return {
    productHome,
    plans,
    store,
    lease: async (job) => {
      const path = automationRunnerLeasePath(productHome, job);
      const stats = await nodeFs.lstat(path, { bigint: true });
      const lock: HeldLifecycleStableLockV1 = {
        path,
        dev: parseUInt64Decimal(stats.dev.toString()),
        ino: parseUInt64Decimal(stats.ino.toString()),
        release: () => Promise.resolve(),
      };
      return { job, lock };
    },
  };
}

describe("AutomationStatusRecordV1", () => {
  it("round-trips every outcome through its exact canonical bytes", () => {
    const all: readonly AutomationStatusRecordV1[] = [
      { schemaVersion: 1, job: "brain-reindex", outcome: "success", reasonCode: parseSafeReasonCode("ok"), startedAt: STARTED, completedAt: COMPLETED },
      inert("git_disabled"),
      inert("automation_disabled"),
      inert("skipped_lock_timeout"),
      { schemaVersion: 1, job: "doctor", outcome: "handler_failed", reasonCode: parseSafeReasonCode("doctor_check_failed"), startedAt: STARTED, completedAt: COMPLETED },
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const record of all) {
      const bytes = encodeAutomationStatusRecord(record);
      expect(new TextDecoder().decode(bytes).endsWith("}\n")).toBe(true);
      expect(parseAutomationStatusRecord(bytes)).toStrictEqual(record);
    }
  });

  it.each([
    ["success without ok", { outcome: "success", reasonCode: "done" }],
    ["an inert outcome with another reason", { outcome: "git_disabled", reasonCode: "automation_disabled", startedAt: null }],
    ["a failure reusing ok", { outcome: "handler_failed", reasonCode: "ok" }],
    ["a refusal reusing an inert name", { outcome: "handler_refused", reasonCode: "skipped_lock_timeout" }],
    ["an inert outcome with a start time", { outcome: "automation_disabled", reasonCode: "automation_disabled" }],
    ["a start after completion", { startedAt: "2026-09-23T02:00:06.000Z" }],
    ["an unknown job", { job: "import" }],
    ["an unknown field", { extra: true }],
  ])("refuses %s", (_label, override) => {
    const base = { schemaVersion: 1, job: "brain-lint", outcome: "success", reasonCode: "ok", startedAt: STARTED, completedAt: COMPLETED };
    expect(() => validateAutomationStatusRecord({ ...base, ...override })).toThrow();
  });

  it("refuses a status record over 64 KiB before parsing", () => {
    const oversized = new TextEncoder().encode(`{"pad":"${"x".repeat(MAX_AUTOMATION_STATUS_BYTES)}"}\n`);
    expect(() => parseAutomationStatusRecord(oversized)).toThrow();
  });
});

describe("AutomationLogRecordV1 and redaction", () => {
  it("redacts the structured result before it is bounded or encoded", () => {
    const redact = (text: string): string => text.replaceAll(SECRET, "[redacted]");
    const data = redactScheduledData(redactPayload(redact, { note: `token ${SECRET}`, nested: [{ key: SECRET }] }));
    const bytes = encodeAutomationLogRecord(success("brain-reindex", data));
    expect(new TextDecoder().decode(bytes)).not.toContain(SECRET);
    expect(parseAutomationLogRecord(bytes).data).toStrictEqual({ note: "token [redacted]", nested: [{ key: "[redacted]" }] });
  });

  it("bounds depth, entries and non-integer numbers into BoundedRedactedJsonV1", () => {
    let deep: unknown = "leaf";
    for (let level = 0; level < MAX_REDACTED_JSON_DEPTH + 8; level += 1) deep = [deep];
    const data = redactScheduledData(redactPayload((text) => text, {
      deep,
      wide: Array.from({ length: MAX_REDACTED_JSON_ENTRIES + 5 }, (_unused, index) => index),
      ratio: 0.5,
    }));
    expect(() => validateAutomationLogRecord(success("doctor", data))).not.toThrow();
    const wide = (data as { readonly wide: readonly unknown[] }).wide;
    expect(wide).toHaveLength(MAX_REDACTED_JSON_ENTRIES);
    expect((data as { readonly ratio: unknown }).ratio).toBe("0.5");
  });

  it("refuses unbounded data at validation", () => {
    expect(() => validateAutomationLogRecord(success("doctor", { value: 1.5 }))).toThrow(AutomationRuntimeRecordError);
    expect(() => validateAutomationLogRecord(success("doctor", "\ud800"))).toThrow(AutomationRuntimeRecordError);
  });

  it("refuses a log record over its 1-MiB slot, envelope and LF included", () => {
    const strings = Array.from({ length: 20 }, () => "x".repeat(60_000));
    const record = success("brain-lint", redactScheduledData(redactPayload((text) => text, strings)));
    expect(() => encodeAutomationLogRecord(record)).toThrow(AutomationRuntimeRecordError);
    expect(MAX_AUTOMATION_LOG_BYTES).toBe(1_048_576);
  });
});

describe("the fixed log rotation", () => {
  it("shifts ten slots and discards the eleventh without a directory scan", () => {
    const home = parseCanonicalAbsolutePathText("/synthetic-home");
    const slots = Array.from({ length: AUTOMATION_LOG_SLOTS }, (_unused, slot) => ({
      path: automationLogSlotPath(home, "doctor", slot),
      bytes: new TextEncoder().encode(`slot-${String(slot)}\n`),
    }));
    const mutations = planLogRotation(slots, new TextEncoder().encode("new\n"));
    expect(mutations).toHaveLength(AUTOMATION_LOG_SLOTS);
    expect(mutations.every((mutation) => mutation.operation === "replace")).toBe(true);
    expect(new TextDecoder().decode(mutations.at(-1)?.content ?? new Uint8Array())).toBe("new\n");
    expect(new TextDecoder().decode(mutations[0]?.content ?? new Uint8Array())).toBe("slot-8\n");
    expect(mutations.some((mutation) => new TextDecoder().decode(mutation.content ?? new Uint8Array()) === "slot-9\n")).toBe(false);
  });

  it("never removes a reserved slot: init's empty slots rotate as empty", () => {
    const home = parseCanonicalAbsolutePathText("/synthetic-home");
    const slots = Array.from({ length: AUTOMATION_LOG_SLOTS }, (_unused, slot) => ({
      path: automationLogSlotPath(home, "brain-lint", slot),
      bytes: slot === 0 ? new TextEncoder().encode("first\n") : new Uint8Array(),
    }));
    const mutations = planLogRotation(slots, new TextEncoder().encode("second\n"));
    expect(mutations.every((mutation) => mutation.operation === "replace")).toBe(true);
    expect(mutations.map((mutation) => mutation.targetPath)).toStrictEqual([
      automationLogSlotPath(home, "brain-lint", 1),
      automationLogSlotPath(home, "brain-lint", 0),
    ]);
  });

  it("keeps the newest ten of eleven writes and replaces the status in the same transaction", async () => {
    const fixture = await storeFixture();
    const lease = await fixture.lease("brain-reindex");
    for (let run = 0; run < AUTOMATION_LOG_SLOTS + 1; run += 1) {
      await fixture.store.writeLog(success("brain-reindex", { run }), lease);
    }
    expect(fixture.plans).toHaveLength(AUTOMATION_LOG_SLOTS + 1);
    for (const plan of fixture.plans) {
      expect(plan.mutations.map((mutation) => mutation.targetPath)).toContain(
        automationStatusPath(fixture.productHome, "brain-reindex"),
      );
    }
    const runs: unknown[] = [];
    for (let slot = 0; slot < AUTOMATION_LOG_SLOTS; slot += 1) {
      const bytes = await nodeFs.readFile(automationLogSlotPath(fixture.productHome, "brain-reindex", slot));
      runs.push(parseAutomationLogRecord(bytes).data);
    }
    expect(runs).toStrictEqual(Array.from({ length: AUTOMATION_LOG_SLOTS }, (_unused, slot) => ({ run: AUTOMATION_LOG_SLOTS - slot })));
    expect(
      parseAutomationStatusRecord(await nodeFs.readFile(automationStatusPath(fixture.productHome, "brain-reindex"))),
    ).toMatchObject({ outcome: "success", reasonCode: "ok" });
  });

  it("writes an oversized result as its envelope with truncated data", async () => {
    const fixture = await storeFixture();
    const strings = Array.from({ length: 20 }, () => "y".repeat(60_000));
    await fixture.store.writeLog(
      success("brain-lint", redactScheduledData(redactPayload((text) => text, strings))),
      await fixture.lease("brain-lint"),
    );
    const bytes = await nodeFs.readFile(automationLogSlotPath(fixture.productHome, "brain-lint", 0));
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_AUTOMATION_LOG_BYTES);
    expect(parseAutomationLogRecord(bytes).data).toStrictEqual({ truncated: true });
  });

  it("keeps every write's leaf reservation far inside the ledger ceilings a compacted ledger resets", async () => {
    const fixture = await storeFixture();
    const lease = await fixture.lease("doctor");
    for (let run = 0; run < 2_000; run += 1) {
      await fixture.store.writeLog(success("doctor", { run }), lease);
    }
    expect(fixture.plans.length).toBe(2_000);
    const widest = fixture.plans.reduce((left, right) => (right.mutations.length > left.mutations.length ? right : left));
    const reservation = standaloneFoundationLeafReservation(widest.mutations);
    expect(reservation.foundationJournals).toBeLessThan(LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot);
    expect(reservation.foundationStaging).toBeLessThan(LIFECYCLE_LEDGER_BOUNDS.foundationStagingAggregateLeaves);
    expect(reservation.foundationBackups).toBeLessThan(LIFECYCLE_LEDGER_BOUNDS.foundationBackupAggregateLeaves);
    expect(reservation.foundationStaging).toBeLessThan(LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingAggregateLeaves);
    expect(widest.mutations.length).toBe(AUTOMATION_LOG_SLOTS + 1);
  });
});

describe("the runtime-record lease", () => {
  it("refuses a record serialized by another job's lease", async () => {
    const fixture = await storeFixture();
    await expect(fixture.store.writeStatus(inert("git_disabled"), await fixture.lease("doctor"))).rejects.toThrow(
      AutomationRuntimeRecordError,
    );
    expect(fixture.plans).toStrictEqual([]);
  });

  it("refuses once the lease path no longer names the held descriptor", async () => {
    const fixture = await storeFixture();
    const lease = await fixture.lease("git-sync");
    const path = automationRunnerLeasePath(fixture.productHome, "git-sync");
    await nodeFs.rm(path);
    await nodeFs.writeFile(path, new Uint8Array(), { mode: 0o600 });
    await expect(fixture.store.writeStatus(inert("automation_disabled"), lease)).rejects.toThrow(AutomationRuntimeRecordError);
    expect(fixture.plans).toStrictEqual([]);
  });

  it("writes an inert status alone, with no log rotation", async () => {
    const fixture = await storeFixture();
    await fixture.store.writeStatus(inert("skipped_lock_timeout"), await fixture.lease("git-sync"));
    expect(fixture.plans).toHaveLength(1);
    expect(fixture.plans[0]?.mutations.map((mutation) => mutation.targetPath)).toStrictEqual([
      automationStatusPath(fixture.productHome, "git-sync"),
    ]);
  });
});

describe("the uninstalling marker", () => {
  it("reads an absent path or init's empty reservation as no uninstall", async () => {
    const fixture = await storeFixture();
    expect(await uninstallingMarkerPresent(guardedFs(), fixture.productHome)).toBe(false);
    await nodeFs.writeFile(join(fixture.productHome, "state", "uninstalling.json"), new Uint8Array(), { mode: 0o600 });
    expect(await uninstallingMarkerPresent(guardedFs(), fixture.productHome)).toBe(false);
  });

  it("reads any other entry as present, even bytes no parser would admit", async () => {
    const fixture = await storeFixture();
    await nodeFs.writeFile(join(fixture.productHome, "state", "uninstalling.json"), "not json", { mode: 0o600 });
    expect(await uninstallingMarkerPresent(guardedFs(), fixture.productHome)).toBe(true);
  });
});

describe("pulse report slots", () => {
  const paths = { stateDir: "/home/state" } as never;

  it("names eight slots under the state directory and refuses any other ordinal", () => {
    expect(PULSE_REPORT_SLOTS).toBe(8);
    expect(pulseReportSlotPath(paths, 0)).toBe("/home/state/pulse.0.md");
    expect(pulseReportSlotPath(paths, 7)).toBe("/home/state/pulse.7.md");
    for (const bad of [-1, 8, 1.5, Number.NaN]) expect(() => pulseReportSlotPath(paths, bad)).toThrow(RangeError);
  });
});
