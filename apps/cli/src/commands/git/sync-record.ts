/**
 * Spec 1 §2.1's `SyncRecordV1` at `state/git-sync.json`: the one retained
 * runtime record of the last successful synchronization. It is written only
 * by a sync coordinator's terminal `F(sync_record)` step, after an exact push
 * success or a truthful `no_changes`, so a failed push leaves it unchanged.
 */
import { join } from "node:path";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha1,
  parseLowerHexSha256,
  parseUtcTimestamp,
  parseValidatedGitBranch,
  parseVaultRelativePathText,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleGuardedFileSystemV1,
  LowerHexSha1,
  LowerHexSha256,
  RuntimePaths,
  UtcTimestampV1,
  ValidatedGitBranchV1,
  VaultRelativePathV1,
} from "@developer-os/core";

export const MAX_SYNC_RECORD_BYTES = 16_777_216;
export const MAX_SYNC_RECORD_PATHS = 100_000;

export interface SyncRecordV1 {
  readonly schemaVersion: 1;
  readonly outcome: "pushed" | "no_changes";
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branch: ValidatedGitBranchV1;
  readonly scopeFingerprint: LowerHexSha256;
  readonly headOid: LowerHexSha1;
  readonly lastPushedHeadOid: LowerHexSha1;
  readonly managedPaths: readonly VaultRelativePathV1[];
  readonly completedAt: UtcTimestampV1;
}

const KEYS = [
  "branch",
  "completedAt",
  "headOid",
  "lastPushedHeadOid",
  "managedPaths",
  "outcome",
  "repositoryRoot",
  "schemaVersion",
  "scopeFingerprint",
];
const encoder = new TextEncoder();

function fail(detail: string): never {
  throw new Error(`invalid SyncRecordV1: ${detail}`);
}

export function syncRecordPath(paths: Pick<RuntimePaths, "stateDir">): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(join(paths.stateDir, "git-sync.json"));
}

export function validateSyncRecord(value: unknown): SyncRecordV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("not an object");
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input).sort();
  if (keys.length !== KEYS.length || keys.some((key, index) => key !== KEYS[index])) fail("keys");
  if (input.schemaVersion !== 1) fail("schemaVersion");
  if (input.outcome !== "pushed" && input.outcome !== "no_changes") fail("outcome");
  if (!Array.isArray(input.managedPaths) || input.managedPaths.length > MAX_SYNC_RECORD_PATHS) fail("managedPaths");
  const managedPaths = (input.managedPaths as readonly unknown[]).map((path) => parseVaultRelativePathText(path));
  for (let index = 1; index < managedPaths.length; index += 1) {
    if (Buffer.compare(Buffer.from(managedPaths[index - 1] as string), Buffer.from(managedPaths[index] as string)) >= 0) {
      fail("managedPaths order");
    }
  }
  const headOid = parseLowerHexSha1(input.headOid);
  const lastPushedHeadOid = parseLowerHexSha1(input.lastPushedHeadOid);
  if (headOid !== lastPushedHeadOid) fail("headOid");
  const completedAt = parseUtcTimestamp(input.completedAt);
  if (new Date(completedAt).toISOString() !== completedAt) fail("completedAt");
  return {
    schemaVersion: 1,
    outcome: input.outcome,
    repositoryRoot: parseCanonicalAbsolutePathText(input.repositoryRoot),
    branch: parseValidatedGitBranch(input.branch),
    scopeFingerprint: parseLowerHexSha256(input.scopeFingerprint),
    headOid,
    lastPushedHeadOid,
    managedPaths,
    completedAt,
  };
}

export function encodeSyncRecord(record: SyncRecordV1): Uint8Array {
  const bytes = encoder.encode(encodeCanonicalJson(validateSyncRecord(record) as unknown as CanonicalJsonValue));
  if (bytes.byteLength > MAX_SYNC_RECORD_BYTES) fail("over 16 MiB");
  return bytes;
}

export function parseSyncRecord(bytes: Uint8Array): SyncRecordV1 {
  const record = validateSyncRecord(decodeCanonicalJson(bytes, MAX_SYNC_RECORD_BYTES));
  if (Buffer.compare(Buffer.from(encodeSyncRecord(record)), Buffer.from(bytes)) !== 0) fail("not canonical");
  return record;
}

/**
 * `no_changes` is truthful only over an established pushed baseline at the
 * same `HEAD`, so it is derived here rather than chosen by the caller.
 */
export function nextSyncRecord(input: {
  readonly previous: SyncRecordV1 | null;
  readonly pushed: boolean;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branch: ValidatedGitBranchV1;
  readonly scopeFingerprint: LowerHexSha256;
  readonly headOid: LowerHexSha1;
  readonly managedPaths: readonly VaultRelativePathV1[];
  readonly completedAt: UtcTimestampV1;
}): SyncRecordV1 {
  if (!input.pushed && input.previous?.lastPushedHeadOid !== input.headOid) fail("no_changes without a pushed baseline");
  return validateSyncRecord({
    schemaVersion: 1,
    outcome: input.pushed ? "pushed" : "no_changes",
    repositoryRoot: input.repositoryRoot,
    branch: input.branch,
    scopeFingerprint: input.scopeFingerprint,
    headOid: input.headOid,
    lastPushedHeadOid: input.headOid,
    managedPaths: input.managedPaths,
    completedAt: input.completedAt,
  });
}

/** Absent is `null`; any present entry that is not the owned record refuses. */
export async function readSyncRecord(
  fs: LifecycleGuardedFileSystemV1,
  paths: Pick<RuntimePaths, "stateDir">,
  effectiveUid: number,
): Promise<{ readonly record: SyncRecordV1 | null; readonly bytes: Uint8Array } | null> {
  const path = syncRecordPath(paths);
  const entry = await fs.lstat(path);
  if (entry === null) return null;
  if (entry.kind !== "regular_file" || entry.ownerUid !== effectiveUid || entry.nlink !== 1) {
    throw new Error("invalid SyncRecordV1: not the owned regular file");
  }
  const bytes = await fs.readRegular(entry, MAX_SYNC_RECORD_BYTES);
  // Fresh `init`'s zero-byte runtime reservation holds no record, exactly as the lifecycle ledger reads it.
  return { record: bytes.byteLength === 0 ? null : parseSyncRecord(bytes), bytes };
}
