import type { LifecycleBookkeepingObservationV1 } from "../lifecycle/bookkeeping.js";
import { decodeCanonicalJson, encodeCanonicalJson } from "../lifecycle/canonical-json.js";

export const HOOK_FIRING_RECORDS_RELATIVE_PATH = "state/hooks";
export const MAX_HOOK_FIRING_RECORD_BYTES = 512;
export const MAX_HOOK_FIRING_RECORD_CHILDREN = 32;

export interface HookFiringRecordV1 {
  readonly schemaVersion: 1;
  readonly vendor: "claude" | "codex";
  readonly event: string;
  readonly productVersion: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export type HookFiringRecordsShapeV1 =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly offendingName: string | null };

const RECORD_NAME = /^(claude|codex)\.[A-Za-z_]{1,64}\.json$/u;
const TEMP_NAME = /^(claude|codex)\.[A-Za-z_]{1,64}\.json\.tmp-[0-9a-f]{16}$/u;
const EVENT = /^[A-Za-z_]{1,64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RECORD_KEYS = ["schemaVersion", "vendor", "event", "productVersion", "firstSeen", "lastSeen"] as const;
const MAX_PRODUCT_VERSION_BYTES = 64;

const encoder = new TextEncoder();

export function hookFiringRecordName(vendor: "claude" | "codex", event: string): string {
  if (!EVENT.test(event)) throw new RangeError("hook event name is outside the record grammar");
  return `${vendor}.${event}.json`;
}

/** Spec 1 §2.1 (amended 2026-09-22, A13 Q3-A): the only shape `state/hooks` is admitted in. */
export function inspectHookFiringRecordsShape(
  observation: LifecycleBookkeepingObservationV1,
  observeChild: (name: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
): HookFiringRecordsShapeV1 {
  if (observation.kind !== "directory" || observation.ownerUid !== effectiveUid || observation.mode !== 0o700) {
    return { admitted: false, offendingName: null };
  }
  if (observation.childNames.length > MAX_HOOK_FIRING_RECORD_CHILDREN) {
    return { admitted: false, offendingName: null };
  }
  for (const name of observation.childNames) {
    if (!RECORD_NAME.test(name) && !TEMP_NAME.test(name)) return { admitted: false, offendingName: name };
    const child = observeChild(name);
    if (
      child.kind !== "regular_file" ||
      child.ownerUid !== effectiveUid ||
      child.nlink !== 1 ||
      child.size > BigInt(MAX_HOOK_FIRING_RECORD_BYTES)
    ) {
      return { admitted: false, offendingName: name };
    }
  }
  return { admitted: true };
}

export function encodeHookFiringRecord(record: HookFiringRecordV1): string {
  const text = encodeCanonicalJson({
    schemaVersion: record.schemaVersion,
    vendor: record.vendor,
    event: record.event,
    productVersion: record.productVersion,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
  });
  if (encoder.encode(text).byteLength > MAX_HOOK_FIRING_RECORD_BYTES) {
    throw new RangeError("hook firing record exceeds 512 bytes");
  }
  return text;
}

export function decodeHookFiringRecord(text: string): HookFiringRecordV1 | null {
  let value: unknown;
  try {
    value = decodeCanonicalJson(encoder.encode(text), MAX_HOOK_FIRING_RECORD_BYTES);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!RECORD_KEYS.every((key) => Object.hasOwn(record, key))) return null;
  const { schemaVersion, vendor, event, productVersion, firstSeen, lastSeen } = record;
  if (schemaVersion !== 1) return null;
  if (vendor !== "claude" && vendor !== "codex") return null;
  if (typeof event !== "string" || !EVENT.test(event)) return null;
  if (typeof productVersion !== "string") return null;
  const versionBytes = encoder.encode(productVersion).byteLength;
  if (versionBytes < 1 || versionBytes > MAX_PRODUCT_VERSION_BYTES) return null;
  if (typeof firstSeen !== "string" || !ISO.test(firstSeen)) return null;
  if (typeof lastSeen !== "string" || !ISO.test(lastSeen)) return null;
  if (firstSeen > lastSeen) return null;
  const decoded: HookFiringRecordV1 = { schemaVersion, vendor, event, productVersion, firstSeen, lastSeen };
  /** Re-encoding refuses any key beyond the six without enumerating the decoded object. */
  return encodeHookFiringRecord(decoded) === text ? decoded : null;
}
