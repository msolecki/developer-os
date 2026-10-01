/**
 * Spec 1 §2.1 and §5.4: the bounded runtime records a scheduled run leaves — one status per
 * job, ten fixed log slots per job — and the lifetime lease that serializes them. Every write
 * is one Foundation transaction the caller runs under the global lock it already holds; the
 * lease is only ever the pre-created `state/.automation-<job>.lock` that fresh `init` reserved.
 */
import { join } from "node:path";

import {
  SCHEDULED_JOB_IDS,
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashBytes,
  parseCanonicalAbsolutePathText,
  parseSafeReasonCode,
  parseUtcTimestamp,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  LifecycleGuardedFileSystemV1,
  PlannedFileMutation,
  RedactedPayload,
  RuntimePaths,
  SafeReasonCodeV1,
  ScheduledJobIdV1,
  TransactionPlan,
  UtcTimestampV1,
} from "@developer-os/core";

export type { UninstallingMarkerV1 } from "@developer-os/core";

export const MAX_AUTOMATION_STATUS_BYTES = 65_536;
export const MAX_AUTOMATION_LOG_BYTES = 1_048_576;
export const AUTOMATION_LOG_SLOTS = 10;
export const MAX_REDACTED_JSON_DEPTH = 32;
export const MAX_REDACTED_JSON_ENTRIES = 1_024;
export const MAX_REDACTED_JSON_STRING_BYTES = 65_536;

const encoder = new TextEncoder();

export type BoundedRedactedJsonV1 =
  | null
  | boolean
  | number
  | string
  | readonly BoundedRedactedJsonV1[]
  | { readonly [key: string]: BoundedRedactedJsonV1 };

export type AutomationHandlerOutcomeV1 = "success" | "handler_refused" | "handler_failed";
export type AutomationInertOutcomeV1 = "git_disabled" | "automation_disabled" | "skipped_lock_timeout";

export type AutomationStatusRecordV1 =
  | {
      readonly schemaVersion: 1;
      readonly job: ScheduledJobIdV1;
      readonly outcome: AutomationHandlerOutcomeV1;
      readonly reasonCode: SafeReasonCodeV1;
      readonly startedAt: UtcTimestampV1;
      readonly completedAt: UtcTimestampV1;
    }
  | {
      readonly schemaVersion: 1;
      readonly job: ScheduledJobIdV1;
      readonly outcome: AutomationInertOutcomeV1;
      readonly reasonCode: SafeReasonCodeV1;
      readonly startedAt: null;
      readonly completedAt: UtcTimestampV1;
    };

export interface AutomationLogRecordV1 {
  readonly schemaVersion: 1;
  readonly job: ScheduledJobIdV1;
  readonly outcome: AutomationHandlerOutcomeV1;
  readonly reasonCode: SafeReasonCodeV1;
  readonly startedAt: UtcTimestampV1;
  readonly completedAt: UtcTimestampV1;
  readonly data: BoundedRedactedJsonV1;
}

/** The exact zero-byte lease path `init` created; its descriptor is the job's runtime-record lock. */
export type AutomationRunnerLeaseV1 = CanonicalAbsolutePathV1 & { readonly automationRunnerLease: true };

export interface HeldAutomationLeaseV1 {
  readonly job: ScheduledJobIdV1;
  readonly lock: HeldLifecycleStableLockV1;
}

/** What a scheduled handler hands the runner; `data` is unredacted until step 7. */
export interface ScheduledHandlerResultV1 {
  readonly outcome: AutomationHandlerOutcomeV1;
  readonly reasonCode: SafeReasonCodeV1;
  readonly data: unknown;
}

const HANDLER_OUTCOMES: readonly AutomationHandlerOutcomeV1[] = ["success", "handler_refused", "handler_failed"];
const INERT_OUTCOMES: readonly AutomationInertOutcomeV1[] = ["git_disabled", "automation_disabled", "skipped_lock_timeout"];

export class AutomationRuntimeRecordError extends Error {
  constructor(message: string) {
    super(`invalid automation runtime record: ${message}`);
    this.name = "AutomationRuntimeRecordError";
  }
}

function refuse(message: string): never {
  throw new AutomationRuntimeRecordError(message);
}

function scheduledJob(value: unknown): ScheduledJobIdV1 {
  const found = SCHEDULED_JOB_IDS.find((job) => job === value);
  return found ?? refuse("job");
}

function exactObject(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(label);
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    refuse(`${label}: keys`);
  }
  return record;
}

/**
 * §2.1: `success` carries exactly `ok`, each inert outcome its own name, and a refusal or
 * failure neither; `startedAt` never follows `completedAt`.
 */
function assertReasonCode(outcome: string, reasonCode: SafeReasonCodeV1): void {
  if (outcome === "success") {
    if (reasonCode !== "ok") refuse("success requires reason code ok");
    return;
  }
  if ((INERT_OUTCOMES as readonly string[]).includes(outcome)) {
    if (reasonCode !== outcome) refuse("an inert outcome carries its own name as reason code");
    return;
  }
  if (reasonCode === "ok" || (INERT_OUTCOMES as readonly string[]).includes(reasonCode)) {
    refuse("a refusal or failure may not use ok or an inert outcome name");
  }
}

function assertOrdered(startedAt: UtcTimestampV1 | null, completedAt: UtcTimestampV1): void {
  if (startedAt !== null && startedAt > completedAt) refuse("startedAt follows completedAt");
}

export function validateAutomationStatusRecord(value: unknown): AutomationStatusRecordV1 {
  const input = exactObject(value, ["completedAt", "job", "outcome", "reasonCode", "schemaVersion", "startedAt"], "status");
  if (input.schemaVersion !== 1) refuse("status: schemaVersion");
  const job = scheduledJob(input.job);
  const reasonCode = parseSafeReasonCode(input.reasonCode);
  const completedAt = parseUtcTimestamp(input.completedAt);
  const outcome = input.outcome;
  if (HANDLER_OUTCOMES.some((candidate) => candidate === outcome)) {
    const startedAt = parseUtcTimestamp(input.startedAt);
    assertReasonCode(outcome as string, reasonCode);
    assertOrdered(startedAt, completedAt);
    return { schemaVersion: 1, job, outcome: outcome as AutomationHandlerOutcomeV1, reasonCode, startedAt, completedAt };
  }
  const inert = INERT_OUTCOMES.find((candidate) => candidate === outcome) ?? refuse("status: outcome");
  if (input.startedAt !== null) refuse("an inert status has no startedAt");
  assertReasonCode(inert, reasonCode);
  return { schemaVersion: 1, job, outcome: inert, reasonCode, startedAt: null, completedAt };
}

export function encodeAutomationStatusRecord(value: AutomationStatusRecordV1): Uint8Array {
  const record = validateAutomationStatusRecord(value);
  const bytes = encoder.encode(encodeCanonicalJson({ ...record }));
  if (bytes.byteLength > MAX_AUTOMATION_STATUS_BYTES) refuse("status exceeds 64 KiB");
  return bytes;
}

export function parseAutomationStatusRecord(bytes: Uint8Array): AutomationStatusRecordV1 {
  return validateAutomationStatusRecord(decodeCanonicalJson(bytes, MAX_AUTOMATION_STATUS_BYTES));
}

function assertBoundedJson(value: unknown, depth: number): BoundedRedactedJsonV1 {
  if (depth > MAX_REDACTED_JSON_DEPTH) refuse("data depth");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) refuse("data number is not an integer");
    return value;
  }
  if (typeof value === "string") {
    if (!value.isWellFormed() || encoder.encode(value).byteLength > MAX_REDACTED_JSON_STRING_BYTES) refuse("data string");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_REDACTED_JSON_ENTRIES) refuse("data array entries");
    return value.map((entry: unknown) => assertBoundedJson(entry, depth + 1));
  }
  if (typeof value !== "object") refuse("data type");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_REDACTED_JSON_ENTRIES) refuse("data object entries");
  const object: Record<string, BoundedRedactedJsonV1> = {};
  for (const [key, entry] of entries) {
    if (!key.isWellFormed() || encoder.encode(key).byteLength > MAX_REDACTED_JSON_STRING_BYTES) refuse("data key");
    object[key] = assertBoundedJson(entry, depth + 1);
  }
  return object;
}

export function validateAutomationLogRecord(value: unknown): AutomationLogRecordV1 {
  const input = exactObject(
    value,
    ["completedAt", "data", "job", "outcome", "reasonCode", "schemaVersion", "startedAt"],
    "log",
  );
  if (input.schemaVersion !== 1) refuse("log: schemaVersion");
  const outcome = HANDLER_OUTCOMES.find((candidate) => candidate === input.outcome) ?? refuse("log: outcome");
  const reasonCode = parseSafeReasonCode(input.reasonCode);
  const startedAt = parseUtcTimestamp(input.startedAt);
  const completedAt = parseUtcTimestamp(input.completedAt);
  assertReasonCode(outcome, reasonCode);
  assertOrdered(startedAt, completedAt);
  return {
    schemaVersion: 1,
    job: scheduledJob(input.job),
    outcome,
    reasonCode,
    startedAt,
    completedAt,
    data: assertBoundedJson(input.data, 0),
  };
}

export function encodeAutomationLogRecord(value: AutomationLogRecordV1): Uint8Array {
  const record = validateAutomationLogRecord(value);
  const bytes = encoder.encode(encodeCanonicalJson({ ...record }));
  if (bytes.byteLength > MAX_AUTOMATION_LOG_BYTES) refuse("log exceeds 1 MiB");
  return bytes;
}

export function parseAutomationLogRecord(bytes: Uint8Array): AutomationLogRecordV1 {
  return validateAutomationLogRecord(decodeCanonicalJson(bytes, MAX_AUTOMATION_LOG_BYTES));
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const wellFormed = value.toWellFormed();
  if (encoder.encode(wellFormed).byteLength <= maximumBytes) return wellFormed;
  let kept = "";
  let bytes = 0;
  for (const character of wellFormed) {
    const width = encoder.encode(character).byteLength;
    if (bytes + width > maximumBytes) break;
    kept += character;
    bytes += width;
  }
  return kept;
}

function bound(value: unknown, depth: number): BoundedRedactedJsonV1 {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : String(value);
  if (typeof value === "string") return truncateUtf8(value, MAX_REDACTED_JSON_STRING_BYTES);
  if (typeof value !== "object" || depth >= MAX_REDACTED_JSON_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_REDACTED_JSON_ENTRIES).map((entry: unknown) => bound(entry, depth + 1));
  }
  const object: Record<string, BoundedRedactedJsonV1> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_REDACTED_JSON_ENTRIES)) {
    object[truncateUtf8(key, MAX_REDACTED_JSON_STRING_BYTES)] = bound(entry, depth + 1);
  }
  return object;
}

/**
 * §5.4 step 7: the product redactor runs first, on the whole structured result, and only
 * the redacted tree is truncated to `BoundedRedactedJsonV1` — truncating first could cut a
 * secret in half and leave a prefix no pattern recognizes. The parameter's type is that
 * order: only `guards.redactData`, bound to the product redactor in `context.ts`, produces one.
 */
export function redactScheduledData(data: RedactedPayload): BoundedRedactedJsonV1 {
  return bound(data, 0);
}

/** A record whose encoding would pass the 1-MiB slot keeps its envelope and loses its data. */
export function boundedLogRecord(record: AutomationLogRecordV1): AutomationLogRecordV1 {
  try {
    encodeAutomationLogRecord(record);
    return record;
  } catch (error) {
    if (!(error instanceof AutomationRuntimeRecordError)) throw error;
    return { ...record, data: { truncated: true } };
  }
}

export function automationStatusPath(productHome: CanonicalAbsolutePathV1, job: ScheduledJobIdV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${productHome}/state/automation-${scheduledJob(job)}.status.json`);
}

export function automationLogSlotPath(
  productHome: CanonicalAbsolutePathV1,
  job: ScheduledJobIdV1,
  slot: number,
): CanonicalAbsolutePathV1 {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= AUTOMATION_LOG_SLOTS) refuse("log slot");
  return parseCanonicalAbsolutePathText(`${productHome}/logs/automation-${scheduledJob(job)}.${String(slot)}.json`);
}

export function automationRunnerLeasePath(
  productHome: CanonicalAbsolutePathV1,
  job: ScheduledJobIdV1,
): AutomationRunnerLeaseV1 {
  return parseCanonicalAbsolutePathText(`${productHome}/state/.automation-${scheduledJob(job)}.lock`) as AutomationRunnerLeaseV1;
}

export const PULSE_REPORT_SLOTS = 8;

export function pulseReportSlotPath(paths: RuntimePaths, slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PULSE_REPORT_SLOTS) throw new RangeError(`pulse slot ${String(slot)}`);
  return join(paths.stateDir, `pulse.${String(slot)}.md`);
}

export function uninstallingMarkerPath(productHome: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${productHome}/state/uninstalling.json`);
}

/**
 * §5.4 step 1 reads presence only, never the bytes: parsing needs the install nonce, which
 * step 1 must not load. Fresh `init` reserves the path as an empty regular file, so only that
 * exact empty reservation means "no uninstall"; any other entry is an uninstall's marker.
 */
export async function uninstallingMarkerPresent(
  fs: LifecycleGuardedFileSystemV1,
  productHome: CanonicalAbsolutePathV1,
): Promise<boolean> {
  // identity-free stat: presence and size decide; nothing is read or recorded.
  const entry = await fs.lstat(uninstallingMarkerPath(productHome));
  return entry !== null && !(entry.kind === "regular_file" && entry.size === "0");
}

/** The current bytes of one reserved regular file, or null when it is absent. */
export async function currentBytes(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  // identity-free stat: the guarded port's entry, read through the same port; no dev/ino is recorded.
  const entry = await fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== effectiveUid || entry.nlink !== 1) {
    refuse(`reserved runtime path is not an owned regular file: ${path}`);
  }
  return fs.readRegular(entry, maximumBytes);
}

export function writeMutation(targetPath: string, before: Uint8Array | null, content: Uint8Array): PlannedFileMutation {
  return before === null
    ? { targetPath, operation: "create", content }
    : { targetPath, operation: "replace", content, expectedBeforeHash: hashBytes(before) };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

/**
 * §5.4's fixed-name rotation: slot n+1 takes slot n's bytes for n = 8..0, slot 0 takes the new
 * record, and the old slot 9 — the eleventh — is overwritten rather than moved. No directory is
 * scanned and no reservation is removed: fresh `init` creates every slot empty, and an empty or
 * absent source leaves its successor empty.
 */
export function planLogRotation(
  slots: readonly { readonly path: CanonicalAbsolutePathV1; readonly bytes: Uint8Array | null }[],
  record: Uint8Array,
): readonly PlannedFileMutation[] {
  if (slots.length !== AUTOMATION_LOG_SLOTS) refuse("log slot count");
  const mutations: PlannedFileMutation[] = [];
  for (let slot = AUTOMATION_LOG_SLOTS - 1; slot >= 1; slot -= 1) {
    const target = slots[slot] as (typeof slots)[number];
    const source = (slots[slot - 1] as (typeof slots)[number]).bytes;
    if (source === null && target.bytes === null) continue;
    const content = source ?? new Uint8Array();
    if (target.bytes !== null && sameBytes(target.bytes, content)) continue;
    mutations.push(writeMutation(target.path, target.bytes, content));
  }
  const current = slots[0] as (typeof slots)[number];
  mutations.push(writeMutation(current.path, current.bytes, record));
  return mutations;
}

export interface AutomationRuntimeRecordStoreDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
  /** Runs one Foundation transaction under the global lock the caller already holds. */
  readonly execute: (plan: TransactionPlan) => Promise<unknown>;
}

export class AutomationRuntimeRecordStore {
  readonly #dependencies: AutomationRuntimeRecordStoreDependenciesV1;

  constructor(dependencies: AutomationRuntimeRecordStoreDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async writeStatus(record: AutomationStatusRecordV1, lease: HeldAutomationLeaseV1): Promise<void> {
    await this.#requireLease(record.job, lease);
    await this.#dependencies.execute({
      kind: "automation-status",
      mutations: [await this.#statusMutation(record)],
    });
  }

  /** Rotates the log and replaces the status in one transaction, as §5.4 step 8 requires. */
  async writeLog(record: AutomationLogRecordV1, lease: HeldAutomationLeaseV1): Promise<void> {
    await this.#requireLease(record.job, lease);
    const bounded = boundedLogRecord(record);
    const { fs, productHome, effectiveUid } = this.#dependencies;
    const slots = [];
    for (let slot = 0; slot < AUTOMATION_LOG_SLOTS; slot += 1) {
      const path = automationLogSlotPath(productHome, record.job, slot);
      slots.push({ path, bytes: await currentBytes(fs, path, effectiveUid, MAX_AUTOMATION_LOG_BYTES) });
    }
    await this.#dependencies.execute({
      kind: "automation-log",
      mutations: [
        ...planLogRotation(slots, encodeAutomationLogRecord(bounded)),
        await this.#statusMutation({
          schemaVersion: 1,
          job: bounded.job,
          outcome: bounded.outcome,
          reasonCode: bounded.reasonCode,
          startedAt: bounded.startedAt,
          completedAt: bounded.completedAt,
        }),
      ],
    });
  }

  async #statusMutation(record: AutomationStatusRecordV1): Promise<PlannedFileMutation> {
    const { fs, productHome, effectiveUid } = this.#dependencies;
    const path = automationStatusPath(productHome, record.job);
    return writeMutation(
      path,
      await currentBytes(fs, path, effectiveUid, MAX_AUTOMATION_STATUS_BYTES),
      encodeAutomationStatusRecord(record),
    );
  }

  /** §2.3: only the job's own still-bound lease serializes its records. */
  async #requireLease(job: ScheduledJobIdV1, lease: HeldAutomationLeaseV1): Promise<void> {
    const path = automationRunnerLeasePath(this.#dependencies.productHome, job);
    if (lease.job !== job || lease.lock.path !== path) refuse("the record is not serialized by its job's lease");
    // identity-free stat: compared against the held descriptor's identity and not recorded.
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null || entry.dev !== lease.lock.dev || entry.ino !== lease.lock.ino) {
      refuse("the job's lease path no longer names the held descriptor");
    }
  }
}
