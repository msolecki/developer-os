/**
 * Small guarded-filesystem helpers the lifecycle modules share. Internal: not re-exported from
 * the lifecycle index or the package door.
 */
import { encodeFoundationJournalJsonV1, validateJournal } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseSafeReasonCode, type SafeReasonCodeV1 } from "../update/scalars.js";
import {
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { LIFECYCLE_PLAN_BOUNDS } from "./types.js";

export const LOWERCASE_V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * A validated canonical child path. A name that does not make one — possible only for a name a
 * directory listing returned — is a recovery refusal naming the directory, not a parser error.
 */
export function childOf(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 {
  try {
    return parseCanonicalAbsolutePathText(`${directory}/${name}`);
  } catch {
    return refuseLifecycleRecovery("lifecycle_child_path", directory);
  }
}

export async function syncDirectoryAt(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const entry = await fs.lstat(path);
  if (entry === null) refuseLifecycleRecovery("lifecycle_guarded_parent", path);
  await fs.syncDirectory(entry);
}

export async function namesOf(
  fs: LifecycleGuardedFileSystemV1,
  directory: LifecycleGuardedEntryV1,
): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const name of fs.names(directory)) names.push(name);
  return names.sort();
}

/**
 * §2.4's "strict matching final journal": complete, canonical `FoundationJournalJsonV1` bytes for
 * exactly this ID, read under the stable lock rather than trusted from the enumeration that chose
 * the leaf.
 */
export async function readStrictFoundationJournal(
  fs: LifecycleGuardedFileSystemV1,
  entry: LifecycleGuardedEntryV1,
  id: string,
): Promise<TransactionJournalV1> {
  const bytes = await fs.readRegular(entry, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum);
  let text: string;
  let journal: TransactionJournalV1;
  try {
    text = decoder.decode(bytes);
    journal = validateJournal(JSON.parse(text) as unknown);
  } catch {
    return refuseLifecycleRecovery("lifecycle_foundation_journal_bytes", entry.path);
  }
  if (journal.id !== id || encodeFoundationJournalJsonV1(journal) !== text) {
    refuseLifecycleRecovery("lifecycle_foundation_journal_bytes", entry.path);
  }
  return journal;
}

/** Unlinks one staged mutation blob and its `.sha256` sidecar; says whether either existed. */
export async function unlinkStagedBlob(
  fs: LifecycleGuardedFileSystemV1,
  stagedPath: CanonicalAbsolutePathV1,
): Promise<boolean> {
  let removed = false;
  for (const path of [stagedPath, parseCanonicalAbsolutePathText(`${stagedPath}.sha256`)]) {
    const leaf = await fs.lstat(path);
    if (leaf === null) continue;
    await fs.unlinkExact(leaf);
    removed = true;
  }
  return removed;
}

/**
 * The global mutation lock's path alone is not the hold: §2.4 binds it to a device and inode, and
 * `discardUnstarted` deletes staged bytes without re-proving either.
 */
export async function requireHeldGlobalLock(
  fs: LifecycleGuardedFileSystemV1,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const observed = await fs.lstat(global.path);
  if (
    observed === null ||
    observed.kind !== "regular_file" ||
    observed.dev !== global.dev ||
    observed.ino !== global.ino
  ) {
    refuseLifecycleRecovery("lifecycle_global_lock_identity", global.path);
  }
}

/**
 * What the read-only V1 ledger scans (`ledger.ts`, `foundation-ledger.ts`) share: the guarded
 * filesystem, the owner every entry must carry, and the findings a shape refusal appends to.
 */
export interface LedgerScanGuardsV1 {
  readonly dependencies: { readonly fs: LifecycleGuardedFileSystemV1; readonly effectiveUid: number };
  readonly findings: { readonly reason: SafeReasonCodeV1; readonly path: CanonicalAbsolutePathV1 }[];
}

export const LOCK_SUFFIX = ".lock";

export function refuseLedgerEntry(scan: LedgerScanGuardsV1, reason: string, path: CanonicalAbsolutePathV1): void {
  scan.findings.push({ reason: parseSafeReasonCode(reason), path });
}

/** Unlike `childOf`, a name that makes no canonical path is null, so a scan records it and goes on. */
export function childPath(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 | null {
  try {
    return parseCanonicalAbsolutePathText(`${directory}/${name}`);
  } catch {
    return null;
  }
}

export function stableLockOwner(name: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(LOCK_SUFFIX)) return null;
  const owner = name.slice(1, name.length - LOCK_SUFFIX.length);
  return owner.length === 0 ? null : owner;
}

export async function openRoot(
  scan: LedgerScanGuardsV1,
  path: CanonicalAbsolutePathV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  return guardedDirectory(scan, path, "lifecycle_ledger_root_shape");
}

export async function guardedRegularFile(
  scan: LedgerScanGuardsV1,
  path: CanonicalAbsolutePathV1,
  maximumBytes: number,
  reason: string,
): Promise<LifecycleGuardedEntryV1 | null> {
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    entry.kind !== "regular_file" ||
    entry.ownerUid !== scan.dependencies.effectiveUid ||
    entry.mode !== 0o600 ||
    entry.nlink !== 1 ||
    BigInt(entry.size) > BigInt(maximumBytes)
  ) {
    refuseLedgerEntry(scan, reason, path);
    return null;
  }
  return entry;
}

export async function guardedDirectory(
  scan: LedgerScanGuardsV1,
  path: CanonicalAbsolutePathV1,
  reason: string,
): Promise<LifecycleGuardedEntryV1 | null> {
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    entry.kind !== "directory" ||
    entry.ownerUid !== scan.dependencies.effectiveUid ||
    entry.mode !== 0o700
  ) {
    refuseLedgerEntry(scan, reason, path);
    return null;
  }
  return entry;
}
