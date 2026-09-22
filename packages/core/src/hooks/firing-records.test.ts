import { describe, expect, it } from "vitest";

import type { LifecycleBookkeepingObservationV1 } from "../lifecycle/bookkeeping.js";
import {
  decodeHookFiringRecord,
  encodeHookFiringRecord,
  HOOK_FIRING_RECORDS_RELATIVE_PATH,
  hookFiringRecordName,
  inspectHookFiringRecordsShape,
  MAX_HOOK_FIRING_RECORD_BYTES,
  MAX_HOOK_FIRING_RECORD_CHILDREN,
} from "./firing-records.js";

const dir = (childNames: string[], mode = 0o700): LifecycleBookkeepingObservationV1 =>
  ({ kind: "directory", ownerUid: 501, mode, childNames });
const file = (size: bigint): LifecycleBookkeepingObservationV1 =>
  ({ kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 1, size });

const RECORD = {
  schemaVersion: 1,
  vendor: "claude",
  event: "PreToolUse",
  productVersion: "0.0.0",
  firstSeen: "2026-09-22T00:00:00.000Z",
  lastSeen: "2026-09-22T00:00:00.000Z",
} as const;

describe("the state/hooks reserved runtime path", () => {
  it("publishes the path and bounds the spec fixes", () => {
    expect(HOOK_FIRING_RECORDS_RELATIVE_PATH).toBe("state/hooks");
    expect(MAX_HOOK_FIRING_RECORD_BYTES).toBe(512);
    expect(MAX_HOOK_FIRING_RECORD_CHILDREN).toBe(32);
  });

  it("admits records and leftover temps by shape", () => {
    const names = ["claude.PreToolUse.json", "codex.session_start.json", "claude.Stop.json.tmp-0123456789abcdef"];
    expect(inspectHookFiringRecordsShape(dir(names), () => file(100n), 501)).toStrictEqual({ admitted: true });
  });

  it("admits an empty directory and exactly 32 children", () => {
    expect(inspectHookFiringRecordsShape(dir([]), () => file(1n), 501)).toStrictEqual({ admitted: true });
    const names = Array.from({ length: 32 }, (_, i) => `claude.E${"x".repeat(i)}.json`);
    expect(inspectHookFiringRecordsShape(dir(names), () => file(512n), 501)).toStrictEqual({ admitted: true });
  });

  it.each([
    ["mode", dir([], 0o755), () => file(1n)],
    ["foreign name", dir(["notes.txt"]), () => file(1n)],
    ["oversized", dir(["claude.Stop.json"]), () => file(513n)],
    ["symlink", dir(["claude.Stop.json"]), () => ({ kind: "other" }) as const],
    ["subdirectory", dir(["claude.Stop.json"]), () => dir([])],
    ["too many", dir(Array.from({ length: 33 }, (_, i) => `claude.E${"x".repeat(i)}.json`)), () => file(1n)],
  ] as const)("refuses %s", (_name, observation, child) => {
    expect(inspectHookFiringRecordsShape(observation, child, 501).admitted).toBe(false);
  });

  it("names the offending child, or null when the directory itself is refused", () => {
    expect(inspectHookFiringRecordsShape(dir(["notes.txt"]), () => file(1n), 501))
      .toStrictEqual({ admitted: false, offendingName: "notes.txt" });
    expect(inspectHookFiringRecordsShape(dir([]), () => file(1n), 502))
      .toStrictEqual({ admitted: false, offendingName: null });
  });

  it("refuses a foreign-owned or hard-linked record", () => {
    const foreign = (): LifecycleBookkeepingObservationV1 =>
      ({ kind: "regular_file", ownerUid: 502, mode: 0o600, nlink: 1, size: 1n });
    const linked = (): LifecycleBookkeepingObservationV1 =>
      ({ kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 2, size: 1n });
    expect(inspectHookFiringRecordsShape(dir(["claude.Stop.json"]), foreign, 501).admitted).toBe(false);
    expect(inspectHookFiringRecordsShape(dir(["claude.Stop.json"]), linked, 501).admitted).toBe(false);
  });
});

describe("the firing record codec", () => {
  it("names a record by vendor and event and refuses an event outside the grammar", () => {
    expect(hookFiringRecordName("codex", "session_start")).toBe("codex.session_start.json");
    expect(() => hookFiringRecordName("claude", "../x")).toThrow(RangeError);
    expect(() => hookFiringRecordName("claude", "")).toThrow(RangeError);
  });

  it("round-trips a record canonically and refuses unknown fields", () => {
    expect(decodeHookFiringRecord(encodeHookFiringRecord(RECORD))).toStrictEqual(RECORD);
    expect(decodeHookFiringRecord(encodeHookFiringRecord(RECORD).replace("{", '{"x":1,'))).toBeNull();
  });

  it("refuses to encode a record above 512 bytes", () => {
    expect(() => encodeHookFiringRecord({ ...RECORD, event: "E".repeat(64), productVersion: "é".repeat(300) }))
      .toThrow(RangeError);
  });

  it.each([
    ["an extra key in canonical order", (text: string) => text.replace(/\}\n$/u, ',"zzz":1}\n')],
    ["a missing key",(text: string) => text.replace(/"event":"PreToolUse",/u, "")],
    ["another schema version", (text: string) => text.replace('"schemaVersion":1', '"schemaVersion":2')],
    ["another vendor", (text: string) => text.replace('"vendor":"claude"', '"vendor":"other"')],
    ["an event outside the grammar", (text: string) => text.replace('"event":"PreToolUse"', '"event":"Pre-Tool"')],
    ["an empty product version", (text: string) => text.replace('"productVersion":"0.0.0"', '"productVersion":""')],
    ["a timestamp without milliseconds", (text: string) => text.replace('"lastSeen":"2026-09-22T00:00:00.000Z"', '"lastSeen":"2026-09-22T00:00:00Z"')],
    ["firstSeen after lastSeen", (text: string) => text.replace('"firstSeen":"2026-09-22T00:00:00.000Z"', '"firstSeen":"2026-09-23T00:00:00.000Z"')],
    ["text that is not JSON", () => "not json"],
    ["an array", () => "[]\n"],
  ])("decodes %s to null", (_label, mutate) => {
    const text = mutate(encodeHookFiringRecord(RECORD));
    expect(text).not.toBe(encodeHookFiringRecord(RECORD));
    expect(decodeHookFiringRecord(text)).toBeNull();
  });
});
