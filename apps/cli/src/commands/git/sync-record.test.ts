import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "@developer-os/core";
import type { CanonicalJsonValue } from "@developer-os/core";

import { encodeSyncRecord, nextSyncRecord, parseSyncRecord, syncRecordPath, validateSyncRecord } from "./sync-record.js";
import type { SyncRecordV1 } from "./sync-record.js";

const HEAD = "c".repeat(40);
const RECORD = validateSyncRecord({
  schemaVersion: 1,
  outcome: "pushed",
  repositoryRoot: "/synthetic-brain",
  branch: "main",
  scopeFingerprint: "a".repeat(64),
  headOid: HEAD,
  lastPushedHeadOid: HEAD,
  managedPaths: ["content/DEV/B.md", "content/DEV/a.md", "content/DEV/é.md", "content/_indexes/index.json"],
  completedAt: "2026-09-23T12:00:00.000Z",
});

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

describe("SyncRecordV1", () => {
  it("lives at the one reserved runtime path", () => {
    expect(syncRecordPath({ stateDir: "/synthetic-home/state" })).toBe("/synthetic-home/state/git-sync.json");
  });

  it("round-trips its exact canonical bytes", () => {
    const encoded = encodeSyncRecord(RECORD);
    expect(parseSyncRecord(encoded)).toEqual(RECORD);
    expect(new TextDecoder().decode(encoded).endsWith("}\n")).toBe(true);
  });

  it.each([
    ["an unknown field", { ...RECORD, extra: true }],
    ["a missing field", Object.fromEntries(Object.entries(RECORD).filter(([key]) => key !== "completedAt"))],
    ["an unknown outcome", { ...RECORD, outcome: "failed" }],
    ["a head that is not the last pushed head", { ...RECORD, lastPushedHeadOid: "d".repeat(40) }],
    ["an uppercase OID", { ...RECORD, headOid: HEAD.toUpperCase(), lastPushedHeadOid: HEAD.toUpperCase() }],
    ["unsorted managed paths", { ...RECORD, managedPaths: ["content/DEV/b.md", "content/DEV/a.md"] }],
    ["duplicate managed paths", { ...RECORD, managedPaths: ["content/DEV/a.md", "content/DEV/a.md"] }],
    ["a dot segment", { ...RECORD, managedPaths: ["content/../a.md"] }],
    ["a non-canonical timestamp", { ...RECORD, completedAt: "2026-09-23T12:00:00Z" }],
    ["an impossible date", { ...RECORD, completedAt: "2026-02-30T12:00:00.000Z" }],
    ["a relative repository root", { ...RECORD, repositoryRoot: "synthetic-brain" }],
  ])("refuses %s", (_name, value) => {
    expect(() => parseSyncRecord(bytes(value))).toThrow();
  });

  it("refuses bytes that are valid JSON but not the canonical encoding", () => {
    const pretty = new TextEncoder().encode(`${JSON.stringify(RECORD, null, 2)}\n`);
    expect(() => parseSyncRecord(pretty)).toThrow();
  });

  it("records no_changes only over a pushed baseline at the same head", () => {
    const next = (previous: SyncRecordV1 | null, pushed: boolean, headOid: string): SyncRecordV1 =>
      nextSyncRecord({
        previous,
        pushed,
        repositoryRoot: RECORD.repositoryRoot,
        branch: RECORD.branch,
        scopeFingerprint: RECORD.scopeFingerprint,
        headOid: headOid as SyncRecordV1["headOid"],
        managedPaths: RECORD.managedPaths,
        completedAt: RECORD.completedAt,
      });
    expect(next(RECORD, false, HEAD)).toMatchObject({ outcome: "no_changes", headOid: HEAD, lastPushedHeadOid: HEAD });
    expect(() => next(null, false, HEAD)).toThrow();
    expect(() => next(RECORD, false, "d".repeat(40))).toThrow();
    expect(next(null, true, "d".repeat(40))).toMatchObject({ outcome: "pushed", lastPushedHeadOid: "d".repeat(40) });
  });
});
