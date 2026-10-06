/**
 * Small guarded-filesystem helpers the lifecycle modules share. Internal: not re-exported from
 * the lifecycle index or the package door.
 */
import { encodeFoundationJournalJsonV1, validateJournal } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
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
