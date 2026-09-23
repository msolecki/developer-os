import {
  admitUpdateFoundationInitialJournal,
  compactTerminalFoundationTransaction,
  deriveFoundationTerminalCompaction,
  LIFECYCLE_PLAN_BOUNDS,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseFoundationTransactionId,
  validateJournal,
  type BootstrapInitialJournalPublicationV1,
  type CanonicalAbsolutePathV1,
  type HeldLifecycleStableLockV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleLedgerRootsV1,
  type TransactionExecutor,
  type TransactionJournalV1,
  type TransactionStore,
  type UpdateFoundationParticipantRefV2,
  type UpdateFoundationPayloadIdentityV1,
} from "@developer-os/core";

import type { UpdateFoundationPortV1 } from "./owner-participant.js";

export interface UpdateFoundationPortDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly executor: TransactionExecutor;
  readonly store: TransactionStore;
  readonly global: HeldLifecycleStableLockV1;
  readonly effectiveUid: number;
  /** The reopened construction evidence of one construction row, by its ordinal. */
  readonly evidence: (ordinal: number) => Promise<UpdateFoundationPayloadIdentityV1>;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** A third state: preserved as found and surfaced as recovery-required (exit 6). */
function refuse(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function parentOf(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

/** Every construction row a ref consumes: its staged initial journal, then each content and sidecar. */
function consumedRows(ref: UpdateFoundationParticipantRefV2): readonly { readonly path: CanonicalAbsolutePathV1; readonly ordinal: number }[] {
  const rows = [{ path: ref.initialJournal.staged.path as CanonicalAbsolutePathV1, ordinal: ref.initialJournal.staged.ordinal }];
  for (const mutation of ref.mutations) {
    for (const payload of [mutation.content, mutation.digest]) {
      if (payload !== null) rows.push({ path: payload.path, ordinal: payload.ordinal });
    }
  }
  return rows;
}

/**
 * Spec 2 §5.3 (D60): Spec 1's executor over a lifecycle update ref. `apply` hands the ref, its
 * planned journal, and the construction evidence of every row it consumes to the executor's
 * update arm, which publishes content, sidecar, and journal no-replace and then runs the
 * unchanged state machine. Nothing here moves a target or trusts an inode it did not read from
 * construction evidence.
 */
export class UpdateFoundationPort implements UpdateFoundationPortV1 {
  readonly #dependencies: UpdateFoundationPortDependenciesV1;

  constructor(dependencies: UpdateFoundationPortDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async apply(ref: UpdateFoundationParticipantRefV2): Promise<void> {
    const { fs, evidence } = this.#dependencies;
    const stagedPath = ref.initialJournal.staged.path as CanonicalAbsolutePathV1;
    const source = (await fs.lstat(stagedPath)) ?? (await fs.lstat(ref.initialJournal.finalPath));
    if (source === null) refuse("update_foundation_participant_absent", stagedPath, ref.initialJournal.finalPath);
    const payloadIdentities = [];
    for (const mutation of ref.mutations) {
      payloadIdentities.push(mutation.content === null || mutation.digest === null ? null : { content: await evidence(mutation.content.ordinal), digest: await evidence(mutation.digest.ordinal) });
    }
    const sourceParent = await this.#publicationParent(parentOf(stagedPath));
    const firstPayload = ref.mutations.find((mutation) => mutation.content !== null)?.content ?? null;
    const admitted = admitUpdateFoundationInitialJournal({
      ref,
      ownerUid: this.#dependencies.effectiveUid,
      initialJournal: await this.#plannedJournal(ref, source),
      journalIdentity: await evidence(ref.initialJournal.staged.ordinal),
      payloadIdentities,
      // An all-remove ref consumes no payload, so its parent binding is vacuous.
      payloadParent: firstPayload === null ? sourceParent : await this.#publicationParent(parentOf(firstPayload.path)),
      sourceParent,
      destinationParent: await this.#publicationParent(parentOf(ref.initialJournal.finalPath)),
    });
    await this.#dependencies.executor.executeUpdateFoundationParticipant(admitted);
  }

  /** No final journal is `future`, even after content moved: no target has been touched yet. */
  async observe(ref: UpdateFoundationParticipantRefV2): Promise<"future" | "partial" | "committed" | "rolled_back"> {
    const journal = await this.#finalJournal(ref);
    if (journal === null) return "future";
    if (journal.phase === "finalized") return "committed";
    if (journal.phase === "rolled_back") return "rolled_back";
    return "partial";
  }

  async rollback(ref: UpdateFoundationParticipantRefV2): Promise<void> {
    await this.#dependencies.executor.rollback(ref.id);
  }

  /**
   * A terminal (or never-journaled) transaction's executor residue through Spec 1's exact
   * collection, then every construction row the ref never consumed, each only at its evidenced
   * inode. A non-terminal journal or a foreign inode is a third state.
   */
  async compact(ref: UpdateFoundationParticipantRefV2): Promise<void> {
    const { fs, roots, store, global } = this.#dependencies;
    const journal = await this.#finalJournal(ref);
    const compaction = journal === null
      ? { transactionId: parseFoundationTransactionId(ref.id, null), terminalPhase: "rolled_back" as const, mutationCount: ref.mutations.length }
      : deriveFoundationTerminalCompaction(journal);
    // Every unconsumed row is proven before any is removed, so a foreign inode preserves them all.
    const unconsumed: LifecycleGuardedEntryV1[] = [];
    for (const row of consumedRows(ref)) {
      const entry = await fs.lstat(row.path);
      if (entry === null) continue;
      const identity = await this.#dependencies.evidence(row.ordinal);
      if (entry.kind !== "regular_file" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.nlink !== 1 || entry.dev !== identity.dev || entry.ino !== identity.ino) {
        refuse("update_foundation_unbound", row.path);
      }
      unconsumed.push(entry);
    }
    await compactTerminalFoundationTransaction({ fs, roots, store, global }, compaction);
    for (const entry of unconsumed) {
      await fs.unlinkExact(entry);
      await fs.syncDirectory(await this.#directory(parentOf(entry.path)));
    }
  }

  /** Construction's delegated-deletion answer: every row, journal, and executor directory of the ref is gone. */
  async consumed(ref: UpdateFoundationParticipantRefV2): Promise<boolean> {
    const { fs, roots } = this.#dependencies;
    const paths = [
      ref.initialJournal.finalPath,
      parseCanonicalAbsolutePathText(`${roots.foundationStaging}/${ref.id}`),
      parseCanonicalAbsolutePathText(`${roots.foundationBackups}/${ref.id}`),
      ...consumedRows(ref).map((row) => row.path),
    ];
    for (const path of paths) if ((await fs.lstat(path)) !== null) return false;
    return true;
  }

  async #finalJournal(ref: UpdateFoundationParticipantRefV2): Promise<TransactionJournalV1 | null> {
    const entry = await this.#dependencies.fs.lstat(ref.initialJournal.finalPath);
    if (entry === null) return null;
    const journal = this.#decode(await this.#dependencies.fs.readRegular(entry, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum), entry.path);
    if (journal.id !== ref.id) refuse("update_foundation_journal_id", entry.path);
    return journal;
  }

  /**
   * The store rewrites a journal past `planned` with later `phase`/`updatedAt` members; rewinding
   * exactly those recovers the planned value, which admission then rehashes against the ref.
   */
  async #plannedJournal(ref: UpdateFoundationParticipantRefV2, entry: LifecycleGuardedEntryV1): Promise<TransactionJournalV1> {
    const observed = this.#decode(await this.#dependencies.fs.readRegular(entry, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum), entry.path);
    if (observed.id !== ref.id) refuse("update_foundation_journal_id", entry.path);
    return { ...observed, phase: "planned", updatedAt: observed.createdAt };
  }

  #decode(bytes: Uint8Array, path: string): TransactionJournalV1 {
    try {
      return validateJournal(JSON.parse(decoder.decode(bytes)) as unknown);
    } catch {
      return refuse("update_foundation_journal_bytes", path);
    }
  }

  async #directory(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry?.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o700) refuse("update_foundation_parent", path);
    return entry;
  }

  async #publicationParent(path: CanonicalAbsolutePathV1): Promise<BootstrapInitialJournalPublicationV1["sourceParent"]> {
    const parent = await this.#directory(path);
    return { path, ownerUid: parent.ownerUid, mode: 0o700, dev: parent.dev, ino: parent.ino };
  }
}
