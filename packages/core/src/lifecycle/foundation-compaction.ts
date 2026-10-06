/**
 * Spec 1 §2.4's exact terminal Foundation collection and its two guarded orphan rules.
 * Every deletion here is derived from a value — a terminal journal's mutation count, or the
 * ledger's admitted orphan leaves — never from walking a directory and removing what is
 * found: an unknown child, a wrong type and a non-empty directory are all preserved.
 */
import { validateJournal } from "../transactions/store.js";
import type { TransactionStore } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { FoundationLedgerOrphanV1, LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import {
  lifecycleParentPath,
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { parseFoundationTransactionId } from "./ids.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import { requireHeldGlobalLock } from "./coordinator.js";
import {
  LIFECYCLE_PLAN_BOUNDS,
  type FoundationTerminalCompactionV1,
  type LifecycleTerminalOutcomeV1,
} from "./types.js";
import { childOf, LOWERCASE_V4_UUID, readStrictFoundationJournal, syncDirectoryAt } from "./fs-helpers.js";

export interface FoundationCompactionDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly store: TransactionStore;
  readonly global: HeldLifecycleStableLockV1;
  readonly afterBoundary?: ((boundary: string) => void | Promise<void>) | undefined;
}

const TERMINAL_PHASES: readonly LifecycleTerminalOutcomeV1[] = ["finalized", "rolled_back"];
const STAGING_LEAF = /^(0|[1-9][0-9]*)\.bin(?:\.sha256)?(?:\.tmp)?$/u;
const BACKUP_LEAF = /^(0|[1-9][0-9]*)\.(?:bin(?:\.tmp)?|json(?:\.sha256)?(?:\.tmp)?)$/u;
const STORE_TEMP_SUFFIX = ".json.tmp";

/** §2.4's `.<id>.<lowercase-v4-uuid>.json.tmp`, bound to the one ID whose orphan named it. */
function storeRewriteTempOf(id: string, name: string): boolean {
  const head = `.${id}.`;
  return (
    name.startsWith(head) &&
    name.endsWith(STORE_TEMP_SUFFIX) &&
    LOWERCASE_V4_UUID.test(name.slice(head.length, name.length - STORE_TEMP_SUFFIX.length))
  );
}

export function deriveFoundationTerminalCompaction(
  journal: TransactionJournalV1,
): FoundationTerminalCompactionV1 {
  const validated = validateJournal(journal);
  const terminalPhase = TERMINAL_PHASES.find((phase) => phase === validated.phase);
  const bounds = LIFECYCLE_PLAN_BOUNDS.foundationMutationCount;
  if (
    terminalPhase === undefined ||
    validated.mutations.length < bounds.minimum ||
    validated.mutations.length > bounds.maximum
  ) {
    refuseLifecycleRecovery("lifecycle_foundation_compaction_phase");
  }
  return {
    transactionId: parseFoundationTransactionId(validated.id, null),
    terminalPhase,
    mutationCount: validated.mutations.length,
  };
}

export async function compactTerminalFoundationTransaction(
  dependencies: FoundationCompactionDependenciesV1,
  compaction: FoundationTerminalCompactionV1,
): Promise<void> {
  const { fs, roots, store } = dependencies;
  await requireHeldGlobalLock(dependencies.fs, dependencies.global);
  const id = compaction.transactionId;

  await store.withTransactionLock(id, async () => {
    const journal = await fs.lstat(childOf(roots.foundationJournals, `${id}.json`));
    if (journal !== null) await requireTerminalJournal(dependencies, journal, compaction);

    await collectIdDirectory(dependencies, childOf(roots.foundationStaging, id), STAGING_LEAF, {
      leaf: "staging_leaf_unlinked",
      directory: "staging_directory_removed",
    }, compaction.mutationCount);
    await collectIdDirectory(dependencies, childOf(roots.foundationBackups, id), BACKUP_LEAF, {
      leaf: "backup_leaf_unlinked",
      directory: "backup_directory_removed",
    }, compaction.mutationCount);

    if (journal !== null) {
      await fs.unlinkExact(journal);
      await syncDirectoryAt(dependencies.fs, roots.foundationJournals);
      await dependencies.afterBoundary?.("journal_unlinked");
    }
    const lock = await fs.lstat(childOf(roots.foundationJournals, `.${id}.lock`));
    if (lock !== null) {
      await fs.unlinkExact(lock);
      await syncDirectoryAt(dependencies.fs, roots.foundationJournals);
      await dependencies.afterBoundary?.("lock_unlinked");
    }
  });
}

export async function removeFoundationOrphan(
  dependencies: FoundationCompactionDependenciesV1,
  orphan: FoundationLedgerOrphanV1,
): Promise<void> {
  const { fs, roots, store } = dependencies;
  await requireHeldGlobalLock(dependencies.fs, dependencies.global);
  const id = orphan.id;
  const journalPath = childOf(roots.foundationJournals, `${id}.json`);

  await store.withTransactionLock(id, async () => {
    const journal = await fs.lstat(journalPath);
    if (orphan.kind === "rewrite_temp") {
      if (journal === null) {
        refuseLifecycleRecovery("lifecycle_foundation_orphan_journal", journalPath);
      }
      await readStrictFoundationJournal(dependencies.fs, journal, id);
      await fs.unlinkExact(orphan.temp);
      await syncDirectoryAt(dependencies.fs, roots.foundationJournals);
      await dependencies.afterBoundary?.("rewrite_temp_unlinked");
      return;
    }
    if (journal !== null) {
      refuseLifecycleRecovery("lifecycle_foundation_orphan_journal", journalPath);
    }
    if (orphan.kind === "lock_only") {
      for (const directory of [roots.foundationStaging, roots.foundationBackups]) {
        const present = await fs.lstat(childOf(directory, id));
        if (present !== null) {
          refuseLifecycleRecovery("lifecycle_foundation_orphan_leaf", present.path);
        }
      }
      await fs.unlinkExact(orphan.lock);
      await syncDirectoryAt(dependencies.fs, roots.foundationJournals);
      await dependencies.afterBoundary?.("lock_unlinked");
      return;
    }
    await removePlanlessLeaves(dependencies, orphan.id, orphan.leaves);
  });
}

async function removePlanlessLeaves(
  dependencies: FoundationCompactionDependenciesV1,
  id: string,
  leaves: readonly LifecycleGuardedEntryV1[],
): Promise<void> {
  const { fs, roots } = dependencies;
  const stagingRoot = childOf(roots.foundationStaging, id);
  const backupRoot = childOf(roots.foundationBackups, id);
  const lockPath = childOf(roots.foundationJournals, `.${id}.lock`);
  const files: LifecycleGuardedEntryV1[] = [];
  const directories: LifecycleGuardedEntryV1[] = [];
  const locks: LifecycleGuardedEntryV1[] = [];

  for (const leaf of leaves) {
    if (leaf.path === lockPath) locks.push(leaf);
    else if (leaf.path === stagingRoot || leaf.path === backupRoot) directories.push(leaf);
    else if (
      lifecycleParentPath(leaf.path) === stagingRoot ||
      (lifecycleParentPath(leaf.path) === roots.foundationJournals &&
        storeRewriteTempOf(id, leaf.path.slice(roots.foundationJournals.length + 1)))
    ) {
      files.push(leaf);
    } else refuseLifecycleRecovery("lifecycle_foundation_orphan_leaf", leaf.path);
  }

  for (const file of files) await fs.unlinkExact(file);
  for (const directory of [...directories].sort((left, right) =>
    left.path < right.path ? 1 : -1,
  )) {
    await fs.rmdirExactEmpty(directory);
    await syncDirectoryAt(dependencies.fs, lifecycleParentPath(directory.path));
  }
  for (const lock of locks) {
    await fs.unlinkExact(lock);
    await syncDirectoryAt(dependencies.fs, roots.foundationJournals);
  }
  await dependencies.afterBoundary?.("orphan_removed");
}

async function collectIdDirectory(
  dependencies: FoundationCompactionDependenciesV1,
  path: CanonicalAbsolutePathV1,
  grammar: RegExp,
  boundaries: { readonly leaf: string; readonly directory: string },
  mutationCount: number,
): Promise<void> {
  const { fs } = dependencies;
  const directory = await fs.lstat(path);
  if (directory === null) return;
  if (directory.kind !== "directory") refuseLifecycleRecovery("lifecycle_guarded_kind", path);

  const names: string[] = [];
  for await (const name of fs.names(directory)) {
    const matched = grammar.exec(name);
    if (matched === null || Number(matched[1]) >= mutationCount) {
      refuseLifecycleRecovery("lifecycle_foundation_compaction_child", childOf(path, name));
    }
    names.push(name);
  }

  for (const name of names.sort()) {
    const leaf = await fs.lstat(childOf(path, name));
    if (leaf === null) continue;
    if (leaf.kind !== "regular_file") {
      refuseLifecycleRecovery("lifecycle_guarded_kind", leaf.path);
    }
    await fs.unlinkExact(leaf);
    await dependencies.afterBoundary?.(boundaries.leaf);
  }
  await fs.syncDirectory(directory);
  await fs.rmdirExactEmpty(directory);
  await syncDirectoryAt(dependencies.fs, lifecycleParentPath(path));
  await dependencies.afterBoundary?.(boundaries.directory);
}

async function requireTerminalJournal(
  dependencies: FoundationCompactionDependenciesV1,
  entry: LifecycleGuardedEntryV1,
  compaction: FoundationTerminalCompactionV1,
): Promise<void> {
  const journal = await readStrictFoundationJournal(dependencies.fs, entry, compaction.transactionId);
  if (
    journal.phase !== compaction.terminalPhase ||
    journal.mutations.length !== compaction.mutationCount
  ) {
    refuseLifecycleRecovery("lifecycle_foundation_compaction_journal", entry.path);
  }
}

