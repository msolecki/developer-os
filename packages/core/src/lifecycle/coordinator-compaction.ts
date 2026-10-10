/**
 * Spec 1 §2.4's terminal coordinator collection. Every deletion is derived from the immutable
 * plan through `deriveTerminalCompaction`, never from walking a directory: an entry is removed,
 * its absence proved, and only then does `compactionNext` advance, so a death between the two
 * resumes on the same entry.
 */
import type { TransactionStore } from "../transactions/store.js";
import {
  foundationRefById,
  requireHeldGlobalLock,
  type LifecycleCoordinatorDependenciesV1,
} from "./coordinator.js";
import {
  compactTerminalFoundationTransaction,
  deriveFoundationTerminalCompaction,
} from "./foundation-compaction.js";
import type { LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import { deriveTerminalCompaction } from "./grammar.js";
import {
  lifecycleParentPath,
  refuseLifecycleRecovery,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import type { LifecycleCoordinatorRecordV1 } from "./ledger.js";
import {
  type FoundationParticipantRefV1,
  type LifecycleCompactionEntryV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleRedactionKeyCoreV1,
  type LifecycleTerminalOutcomeV1,
} from "./types.js";
import { childOf, readStrictFoundationJournal, syncDirectoryAt, unlinkStagedBlob } from "./fs-helpers.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, LifecycleRedactionKeyCoreV1, unknown>;

type ParticipantCompactionPositionV1 =
  | "executed"
  | "current"
  | "unstarted"
  | "counterfactual_inverse";

export type LifecycleCoordinatorCompactionDependenciesV1<TPlan> =
  LifecycleCoordinatorDependenciesV1<TPlan> & {
    readonly fs: LifecycleGuardedFileSystemV1;
    readonly roots: LifecycleLedgerRootsV1;
    /**
     * `compactTerminalFoundationTransaction` takes each participant's stable lock through the
     * shipped store, and `LifecycleCoordinatorStore` is not that store.
     */
    readonly foundationStore: TransactionStore;
  };

const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
const NONCE_LEAF = "lifecycle-install-nonce";

/**
 * `discardUnstarted` proves every mutation target at the ref's own recorded preimage, which is the
 * right proof for a forward the cursor never reached and for an unused inverse of a forward that
 * did finalize. It is *not* satisfiable for the inverse of a forward that never ran: that ref's
 * preimage describes the post-forward world, which never existed, so proving it would require the
 * target to hold bytes nothing ever wrote. Those staged leaves are removed from the immutable ref
 * instead, once both final journals are proved absent.
 */
async function discardCounterfactualInverse(
  fs: LifecycleGuardedFileSystemV1,
  ref: FoundationParticipantRefV1,
): Promise<void> {
  const staged = await fs.lstat(ref.initialJournal.stagedPath);
  if (staged !== null) {
    await fs.unlinkExact(staged);
    await syncDirectoryAt(fs, lifecycleParentPath(staged.path));
  }
  for (const mutation of ref.mutations) {
    const stagedPath = mutation.stagedPath;
    if (stagedPath === null) continue;
    // A repeat after a death may find the staging directory itself already collected.
    if (await unlinkStagedBlob(fs, stagedPath)) await syncDirectoryAt(fs, lifecycleParentPath(stagedPath));
  }
}

/**
 * "Consumed" and "never executed" are two rules, not one: a consumed participant whose journal is
 * already gone is an idempotent repeat of this same entry after a death, while an absent journal
 * for a participant the cursor never reached is the never-executed ref whose staged bytes are the
 * cleanup index. Reading only the journal's presence collapses them, and then a resumed
 * compaction discards a forward whose target it has already published.
 */
async function removeFoundationEntry<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  plan: TPlan,
  participantId: string,
  position: ParticipantCompactionPositionV1,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const { fs, roots } = dependencies;
  const journalPath = childOf(roots.foundationJournals, `${participantId}.json`);
  const journalEntry = await fs.lstat(journalPath);
  /**
   * The forward a rolled-back coordinator stopped on: `resolveCurrentStep` either discarded it
   * unstarted or rolled its published journal back, so a journal here is terminal `rolled_back`.
   */
  if (position === "executed" || (position === "current" && journalEntry !== null)) {
    if (journalEntry === null) return;
    const journal = await readStrictFoundationJournal(fs, journalEntry, participantId);
    if (position === "current" && journal.phase !== "rolled_back") {
      refuseLifecycleRecovery("lifecycle_coordinator_participant_state", journalPath);
    }
    await compactTerminalFoundationTransaction(
      { fs, roots, store: dependencies.foundationStore, global },
      deriveFoundationTerminalCompaction(journal),
    );
    return;
  }
  if (journalEntry !== null) {
    refuseLifecycleRecovery("lifecycle_coordinator_participant_state", journalPath);
  }

  const ref = foundationRefById(plan, participantId);
  const backups = await fs.lstat(childOf(roots.foundationBackups, participantId));
  if (backups !== null) {
    refuseLifecycleRecovery("lifecycle_foundation_orphan_leaf", backups.path);
  }
  await requireHeldGlobalLock(fs, global);
  /**
   * A `current` forward with no journal is either one `resolveCurrentStep` discarded unstarted or
   * one whose rolled-back journal this compaction already unlinked before a death. Its targets are
   * the user's again, so no preimage proof applies; only its staged leaves are removed.
   */
  if (position === "current") {
    await discardCounterfactualInverse(fs, ref);
  } else if (position === "counterfactual_inverse") {
    const forwardId = ref.role.kind === "compensation" ? ref.role.forwardId : null;
    if (forwardId === null) {
      refuseLifecycleRecovery("lifecycle_coordinator_participant_state", journalPath);
    }
    /**
     * Entries run in ID order, so the forward a rolled-back coordinator stopped on may still hold
     * its own journal here. A terminal `rolled_back` forward left its targets at their preimage,
     * which keeps this inverse counterfactual; any other forward journal does not.
     */
    const forwardJournal = await fs.lstat(childOf(roots.foundationJournals, `${forwardId}.json`));
    if (
      forwardJournal !== null &&
      (await readStrictFoundationJournal(fs, forwardJournal, forwardId)).phase !== "rolled_back"
    ) {
      refuseLifecycleRecovery("lifecycle_coordinator_participant_state", journalPath);
    }
    await discardCounterfactualInverse(fs, ref);
  } else {
    await dependencies.adapters.foundation.discardUnstarted(ref);
  }
  const lock = await fs.lstat(childOf(roots.foundationJournals, `.${participantId}.lock`));
  if (lock !== null) {
    await fs.unlinkExact(lock);
    await syncDirectoryAt(fs, roots.foundationJournals);
  }
  const staging = await fs.lstat(childOf(roots.foundationStaging, participantId));
  if (staging !== null) {
    await fs.rmdirExactEmpty(staging);
    await syncDirectoryAt(fs, roots.foundationStaging);
  }
}

async function removeCoordinatorStaging<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  plan: TPlan,
): Promise<void> {
  const { fs, roots } = dependencies;
  const coordinatorStaging = childOf(roots.lifecycleStaging, plan.id);
  const foundationStaging = childOf(coordinatorStaging, "foundation");
  // NEW-210: refuse a non-empty `payloads` before any unlink, so a refusal leaves the other pieces intact.
  const payloads = await fs.lstat(childOf(coordinatorStaging, "payloads"));
  if (payloads !== null) {
    for await (const name of fs.names(payloads)) {
      refuseLifecycleRecovery("lifecycle_guarded_not_empty", `${payloads.path}/${name}`);
    }
  }
  for (const ref of plan.participants.foundation) {
    const directory = await fs.lstat(childOf(foundationStaging, ref.id));
    if (directory === null) continue;
    await fs.rmdirExactEmpty(directory);
    await syncDirectoryAt(fs, foundationStaging);
  }
  const participants = childOf(coordinatorStaging, "participants");
  const manifestStaging = childOf(participants, "manifest");
  const manifestId = (plan.participants.manifest as { readonly participantId?: unknown } | null)?.participantId;
  const payloadDirectory = typeof manifestId === "string" ? childOf(manifestStaging, manifestId) : null;
  if (payloadDirectory !== null) {
    const payload = await fs.lstat(childOf(payloadDirectory, "after.json"));
    if (payload !== null) {
      await fs.unlinkExact(payload);
      await syncDirectoryAt(fs, payloadDirectory);
    }
  }
  const directories = [
    ...(payloadDirectory === null ? [] : [payloadDirectory]),
    manifestStaging,
    participants,
    foundationStaging,
    // NEW-210: `K` empties `payloads` before the terminal phase; a non-empty one refuses and stays.
    childOf(coordinatorStaging, "payloads"),
    coordinatorStaging,
  ];
  for (const path of directories) {
    const directory = await fs.lstat(path);
    if (directory === null) continue;
    await fs.rmdirExactEmpty(directory);
    await syncDirectoryAt(fs, lifecycleParentPath(path));
  }
}

async function removeEnvelopeLeaves<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  plan: TPlan,
  outcome: LifecycleTerminalOutcomeV1,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const { fs, roots, adapters } = dependencies;
  await requireHeldGlobalLock(fs, global);
  if (plan.operation === "uninstall") {
    const allocator = await fs.lstat(childOf(roots.stateDirectory, ALLOCATOR_LEAF));
    const nonce = await fs.lstat(childOf(roots.stateDirectory, NONCE_LEAF));
    if (allocator !== null && nonce === null) {
      refuseLifecycleRecovery("lifecycle_control_file_state", allocator.path);
    }
    // NEW-122: a compensated uninstall keeps both files (the adapter returns early), so no removal boundary.
    const removes = outcome !== "rolled_back";
    if (allocator !== null) {
      await adapters.controlFiles.removeAllocator(plan, outcome);
      await syncDirectoryAt(fs, roots.stateDirectory);
      if (removes) {
        await dependencies.afterBoundary?.({ kind: "control_file_removed", file: "allocator" });
      }
    }
    if (nonce !== null) {
      await adapters.controlFiles.removeNonce(plan, outcome);
      await syncDirectoryAt(fs, roots.stateDirectory);
      if (removes) {
        await dependencies.afterBoundary?.({ kind: "control_file_removed", file: "nonce" });
      }
    }
  }

  const leaves = [
    ["journal", childOf(roots.coordinatorJournals, `${plan.id}.json`)],
    ["lock", childOf(roots.coordinatorJournals, `.${plan.id}.lock`)],
    ["plan", childOf(roots.coordinatorJournals, `${plan.id}.plan.json`)],
  ] as const;
  for (const [leaf, path] of leaves) {
    const entry = await fs.lstat(path);
    if (entry === null) continue;
    await fs.unlinkExact(entry);
    await syncDirectoryAt(fs, roots.coordinatorJournals);
    await dependencies.afterBoundary?.({ kind: "envelope_leaf_removed", leaf });
  }
}

/**
 * A `compacting` journal carries no compensation cursor — §2.4 nulls it outside
 * `compensating`/`rolled_back` — so the rollback evidence is `terminalOutcome`: a rolled-back
 * coordinator reached `compensationNext == -1`, which consumed the paired inverse of every
 * forward the cursor had passed.
 */
function participantPositions(
  plan: CoordinatorPlan,
  nextStep: number,
  outcome: LifecycleTerminalOutcomeV1,
): ReadonlyMap<string, ParticipantCompactionPositionV1> {
  const positions = new Map<string, ParticipantCompactionPositionV1>();
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind !== "foundation") continue;
    const consumed = index < nextStep;
    positions.set(
      step.participantId,
      consumed
        ? "executed"
        : index === nextStep && outcome === "rolled_back"
          ? "current"
          : "unstarted",
    );
    const ref = foundationRefById(plan, step.participantId);
    const compensationId = ref.role.kind === "forward" ? ref.role.compensationId : null;
    if (compensationId === null) continue;
    positions.set(
      compensationId,
      consumed
        ? outcome === "rolled_back"
          ? "executed"
          : "unstarted"
        : "counterfactual_inverse",
    );
  }
  return positions;
}

async function removeEntry<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  plan: TPlan,
  entry: LifecycleCompactionEntryV1,
  outcome: LifecycleTerminalOutcomeV1,
  positions: ReadonlyMap<string, ParticipantCompactionPositionV1>,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  switch (entry.kind) {
    case "foundation_transaction":
      await removeFoundationEntry(
        dependencies,
        plan,
        entry.participantId,
        positions.get(entry.participantId) ?? "unstarted",
        global,
      );
      return;
    case "git_effect": {
      const adapter =
        entry.side === "source"
          ? dependencies.adapters.sourceGitEffect
          : dependencies.adapters.destinationGitEffect;
      const ref =
        entry.side === "source"
          ? plan.participants.sourceGitEffect
          : plan.participants.destinationGitEffect;
      if (adapter === null || ref === null) {
        refuseLifecycleRecovery("lifecycle_coordinator_effect_absent", plan.authority.productHome);
      }
      await adapter.compact(ref, outcome);
      return;
    }
    case "launchd_effect": {
      const adapter =
        entry.position === "before_files"
          ? dependencies.adapters.launchdBeforeFiles
          : dependencies.adapters.launchdAfterFiles;
      const ref =
        entry.position === "before_files"
          ? plan.participants.launchdBeforeFiles
          : plan.participants.launchdAfterFiles;
      if (adapter === null || ref === null) {
        refuseLifecycleRecovery("lifecycle_coordinator_effect_absent", plan.authority.productHome);
      }
      await adapter.compact(ref, outcome);
      return;
    }
    case "coordinator_staging":
      await removeCoordinatorStaging(dependencies, plan);
      return;
    case "coordinator_envelope":
      await removeEnvelopeLeaves(dependencies, plan, outcome, global);
      return;
  }
}

export async function compactTerminalCoordinator<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  record: LifecycleCoordinatorRecordV1<TPlan>,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const { fs, store } = dependencies;
  await requireHeldGlobalLock(fs, global);
  const plan = record.plan;
  let journal = record.journal;
  if (journal === null) {
    refuseLifecycleRecovery("lifecycle_coordinator_not_terminal", plan.authority.productHome);
  }

  if (journal.phase === "finalized" || journal.phase === "rolled_back") {
    const next: LifecycleCoordinatorJournalV1 = {
      ...journal,
      phase: "compacting",
      terminalOutcome: journal.phase,
      compactionNext: 0,
      compensationNext: null,
      updatedAt: dependencies.clock(),
    };
    await store.rewriteJournal(plan, journal, next, global);
    journal = next;
    await dependencies.afterBoundary?.({
      kind: "journal_rewritten",
      phase: next.phase,
      nextStep: next.nextStep,
    });
  } else if (journal.phase !== "compacting") {
    refuseLifecycleRecovery("lifecycle_coordinator_not_terminal", plan.authority.productHome);
  }

  const outcome = journal.terminalOutcome;
  if (outcome === null) {
    refuseLifecycleRecovery("lifecycle_coordinator_not_terminal", plan.authority.productHome);
  }
  const entries = deriveTerminalCompaction(plan, outcome).entries;
  const positions = participantPositions(plan, journal.nextStep, outcome);
  for (let index = journal.compactionNext ?? 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) break;
    await removeEntry(dependencies, plan, entry, outcome, positions, global);
    await dependencies.afterBoundary?.({ kind: "compaction_entry_removed", index });
    if (entry.kind === "coordinator_envelope") return;
    const next: LifecycleCoordinatorJournalV1 = {
      ...journal,
      compactionNext: index + 1,
      updatedAt: dependencies.clock(),
    };
    await store.rewriteJournal(plan, journal, next, global);
    journal = next;
    await dependencies.afterBoundary?.({
      kind: "journal_rewritten",
      phase: next.phase,
      nextStep: next.nextStep,
    });
  }
}

/**
 * §2.4's guarded orphan rule for the states with no journal to carry a cursor: the
 * plan-plus-lock and plan-only compaction suffixes, and the pre-journal plan orphan. Each one
 * proves every preceding entry absent — which is exactly what made the ledger classify it — and
 * then completes only the bound suffix. No control file is created, and none is removed for a
 * plan-only orphan of an unrelated coordinator.
 */
export async function completeCoordinatorEnvelope<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleCoordinatorCompactionDependenciesV1<TPlan>,
  record: LifecycleCoordinatorRecordV1<TPlan>,
  global: HeldLifecycleStableLockV1,
): Promise<void> {
  const { fs, roots } = dependencies;
  await requireHeldGlobalLock(fs, global);
  if (record.journal !== null) {
    refuseLifecycleRecovery("lifecycle_coordinator_envelope_state", record.plan.authority.productHome);
  }
  const plan = record.plan;
  if (record.state === "pre_journal_orphan") {
    for (const ref of plan.participants.foundation) {
      if ((await fs.lstat(ref.initialJournal.finalPath)) !== null) {
        refuseLifecycleRecovery(
          "lifecycle_coordinator_participant_state",
          ref.initialJournal.finalPath,
        );
      }
      await requireHeldGlobalLock(fs, global);
      if (ref.role.kind === "compensation") await discardCounterfactualInverse(fs, ref);
      else await dependencies.adapters.foundation.discardUnstarted(ref);
      const staging = await fs.lstat(childOf(roots.foundationStaging, ref.id));
      if (staging !== null) {
        await fs.rmdirExactEmpty(staging);
        await syncDirectoryAt(fs, roots.foundationStaging);
      }
    }
    await removeCoordinatorStaging(dependencies, plan);
  }

  for (const [leaf, path] of [
    ["lock", childOf(roots.coordinatorJournals, `.${plan.id}.lock`)],
    ["plan", childOf(roots.coordinatorJournals, `${plan.id}.plan.json`)],
  ] as const) {
    const entry = await fs.lstat(path);
    if (entry === null) continue;
    await fs.unlinkExact(entry);
    await syncDirectoryAt(fs, roots.coordinatorJournals);
    await dependencies.afterBoundary?.({ kind: "envelope_leaf_removed", leaf });
  }
}
