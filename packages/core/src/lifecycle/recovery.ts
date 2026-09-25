/**
 * Spec 1 §2.4's recovery pass: under the global mutation lock it resumes or compensates every
 * non-terminal coordinator per its point of no return, completes the legal orphan states,
 * compacts terminal coordinators and standalone Foundation transactions, and recomputes the
 * snapshot. `assertRecoverable` refuses on the opening snapshot before any phase mutates; each
 * later phase re-verifies only its own specific object under the lock, not the ledger as a whole.
 */
import { EXIT_CODES } from "../result.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseSafeReasonCode, type SafeReasonCodeV1 } from "../update/scalars.js";
import { LifecycleCoordinator } from "./coordinator.js";
import { requireHeldGlobalLock } from "./coordinator.js";
import {
  compactTerminalCoordinator,
  completeCoordinatorEnvelope,
  type LifecycleCoordinatorCompactionDependenciesV1,
} from "./coordinator-compaction.js";
import {
  compactTerminalFoundationTransaction,
  removeFoundationOrphan,
} from "./foundation-compaction.js";
import type { FoundationLedgerOrphanV1 } from "./foundation-ledger.js";
import {
  lifecycleParentPath,
  refuseLifecycleRecovery,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import type { LifecycleCoordinatorRecordV1, LifecycleLedgerSnapshotV1 } from "./ledger.js";
import type { HeldLifecycleStableLockV1 } from "./locks.js";
import type { UpdateConstructionClosureV1 } from "../update/construction.js";
import type { UpdateOperationV1 } from "../update/coordinator.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type {
  LifecycleCoordinatorPlanCoreV1,
  LifecycleJournalClosureV1,
  LifecycleJournalClosureV2,
} from "./types.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

const STAGED_JOURNAL_LEAF = "journal.json";
const FOUNDATION_STAGING_LEAF = "foundation";
const DERIVED_STAGING_CHILDREN: readonly string[] = ["git", "launchd-process", "participants"];

export interface LifecycleRecoveryPolicyV1 {
  readonly resumeUninstall: boolean;
  /**
   * The one non-terminal standalone Foundation journal the caller is explicitly resolving
   * (`repair`); recovery leaves it untouched instead of refusing.
   */
  readonly standaloneFoundationId?: string;
}

/**
 * `SafeReasonCodeV1` is a lowercase identifier, so §2.4's recovery instruction — a literal
 * command line — cannot travel as one. It rides beside the reason, in the member the standing
 * error envelope already publishes (`packages/core/src/result.ts`).
 */
export class LifecycleRecoveryRefusalError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;
  readonly reason: SafeReasonCodeV1;
  readonly recovery: string;
  readonly paths: readonly string[];

  constructor(reason: string, recovery: string, paths: readonly string[]) {
    super(`lifecycle recovery refused: ${reason}`);
    this.name = "LifecycleRecoveryRefusalError";
    this.reason = parseSafeReasonCode(reason);
    this.recovery = recovery;
    this.paths = [...paths];
  }
}

export type LifecycleRecoveryDependenciesV1<TPlan> =
  LifecycleCoordinatorCompactionDependenciesV1<TPlan> & {
    readonly inspect: () => Promise<LifecycleLedgerSnapshotV1<TPlan>>;
  };

export class LifecycleRecoveryService<TPlan extends CoordinatorPlan> {
  private readonly dependencies: LifecycleRecoveryDependenciesV1<TPlan>;

  constructor(dependencies: LifecycleRecoveryDependenciesV1<TPlan>) {
    this.dependencies = dependencies;
  }

  async recover(
    global: HeldLifecycleStableLockV1,
    policy: LifecycleRecoveryPolicyV1,
  ): Promise<{
    readonly snapshot: LifecycleLedgerSnapshotV1<TPlan>;
    readonly global: HeldLifecycleStableLockV1;
  }> {
    const { fs, inspect } = this.dependencies;
    await requireHeldGlobalLock(fs, global);
    let held = global;
    const opening = await inspect();
    assertRecoverable(opening, policy);

    for (const record of opening.coordinators) {
      if (record.state !== "active") continue;
      const result = await new LifecycleCoordinator<TPlan>(this.dependencies).execute(
        record.id,
        held,
      );
      held = result.global;
    }

    const settledCoordinators = await inspect();
    for (const record of settledCoordinators.coordinators) {
      await this.collectCoordinator(record, settledCoordinators.closure, held);
    }

    await this.removeCoordinatorOrphans(await inspect(), held);

    /**
     * §2.4 derives terminal Foundation collection from a journal "not referenced by a
     * non-terminal coordinator", which only a snapshot taken after every coordinator reached a
     * terminal state can answer; a list carried over from the opening scan would compact a
     * participant out from under a coordinator that had not finished yet.
     */
    const settled = await inspect();
    for (const compaction of settled.standaloneTerminalFoundation) {
      await compactTerminalFoundationTransaction(
        {
          fs,
          roots: this.dependencies.roots,
          store: this.dependencies.foundationStore,
          global: held,
        },
        compaction,
      );
    }

    const collected = await inspect();
    for (const orphan of collected.foundation.orphans) {
      await this.removeOrphan(collected, orphan, held);
    }

    return { snapshot: await inspect(), global: held };
  }

  private async collectCoordinator(
    record: LifecycleCoordinatorRecordV1<TPlan>,
    closure: LifecycleJournalClosureV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<void> {
    switch (record.state) {
      case "terminal":
      case "compacting":
        await compactTerminalCoordinator(this.dependencies, record, global);
        return;
      case "envelope_suffix_plan_and_lock":
      case "envelope_suffix_plan_only":
      case "pre_journal_orphan":
        await completeCoordinatorEnvelope(this.dependencies, record, global);
        return;
      case "active":
        /**
         * `classify()` (ledger.ts) already treats this exact on-disk state — the sole
         * non-terminal coordinator, stuck at `push_pending` on its own bound push — as the
         * healthy, retryable closure `retry_only`, not a finding. Recovery must leave it alone
         * rather than re-deriving the same condition and refusing it (Task 25 review, 2026-09-22).
         */
        if (closure.kind === "retry_only" && closure.transactionId === record.id) return;
        refuseLifecycleRecovery(
          "lifecycle_coordinator_not_terminal",
          record.plan.authority.productHome,
        );
    }
  }

  /**
   * §2.4 admits the `rewrite_temp` arm only "under its stable lock when the strict matching final
   * journal exists", and the orphan carries no identity for that journal, so a re-scan inside
   * `removeFoundationOrphan` would re-read the value under suspicion. The scan that produced the
   * orphan already bound the journal's inode; this compares it under the lock the removal takes
   * (Task 15 review, 2026-09-20).
   */
  private async removeOrphan(
    snapshot: LifecycleLedgerSnapshotV1<TPlan>,
    orphan: FoundationLedgerOrphanV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<void> {
    const { fs, roots, foundationStore } = this.dependencies;
    const compaction = { fs, roots, store: foundationStore, global };
    if (orphan.kind !== "rewrite_temp") {
      await removeFoundationOrphan(compaction, orphan);
      return;
    }
    const held = snapshot.foundation.journals.get(orphan.id);
    if (held === undefined) {
      refuseLifecycleRecovery("lifecycle_foundation_orphan_journal", orphan.temp.path);
    }
    await foundationStore.withTransactionLock(orphan.id, async () => {
      const observed = await fs.lstat(held.entry.path);
      if (!sameLifecycleGuardedIdentity(observed, held.entry)) {
        refuseLifecycleRecovery("lifecycle_foundation_journal_identity", held.entry.path);
      }
      await removeFoundationOrphan(compaction, orphan);
    });
  }

  private async removeCoordinatorOrphans(
    snapshot: LifecycleLedgerSnapshotV1<TPlan>,
    global: HeldLifecycleStableLockV1,
  ): Promise<void> {
    const { fs } = this.dependencies;
    for (const orphan of snapshot.coordinatorOrphans) {
      await requireHeldGlobalLock(fs, global);
      if (orphan.kind === "planless_staging") {
        await removePlanlessCoordinatorStaging(fs, orphan.path);
        continue;
      }
      const entry = await fs.lstat(orphan.path);
      if (entry === null) continue;
      await fs.unlinkExact(entry);
      await syncDirectoryAt(fs, lifecycleParentPath(orphan.path));
    }
  }
}

function assertRecoverable<TPlan extends CoordinatorPlan>(
  snapshot: LifecycleLedgerSnapshotV1<TPlan>,
  policy: LifecycleRecoveryPolicyV1,
): void {
  const [finding] = snapshot.findings;
  if (finding !== undefined) {
    throw new LifecycleRecoveryRefusalError("lifecycle_ledger_finding", "developer-os doctor", [
      finding.path,
    ]);
  }
  for (const record of snapshot.coordinators) {
    if (record.state !== "active" || record.plan.operation !== "uninstall") continue;
    if (policy.resumeUninstall) continue;
    throw new LifecycleRecoveryRefusalError("lifecycle_uninstall_incomplete", "developer-os uninstall", [
      record.id,
    ]);
  }
  for (const standalone of snapshot.standaloneNonTerminalFoundation) {
    if (standalone.id === policy.standaloneFoundationId) continue;
    throw new LifecycleRecoveryRefusalError(
      "lifecycle_standalone_transaction_incomplete",
      `developer-os repair --resume ${standalone.id} or developer-os repair --rollback ${standalone.id}`,
      [standalone.id],
    );
  }
}

/**
 * The ledger admitted this tree under §2.4's exact planless grammar, so the removal enumerates
 * exactly that grammar again and preserves every other name rather than deleting what it finds.
 */
async function removePlanlessCoordinatorStaging(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const root = await fs.lstat(path);
  if (root === null) return;
  const children = await namesOf(fs, root);
  for (const name of children) {
    if (DERIVED_STAGING_CHILDREN.includes(name)) {
      const derived = await fs.lstat(childPath(path, name));
      if (derived !== null) await removeAdmittedTree(fs, derived);
      continue;
    }
    if (name !== FOUNDATION_STAGING_LEAF) {
      refuseLifecycleRecovery("lifecycle_staging_shape", childPath(path, name));
    }
    const foundation = await fs.lstat(childPath(path, name));
    if (foundation === null) continue;
    for (const participant of await namesOf(fs, foundation)) {
      const directory = await fs.lstat(childPath(foundation.path, participant));
      if (directory === null) continue;
      for (const leaf of await namesOf(fs, directory)) {
        if (leaf !== STAGED_JOURNAL_LEAF) {
          refuseLifecycleRecovery("lifecycle_staging_shape", childPath(directory.path, leaf));
        }
        const entry = await fs.lstat(childPath(directory.path, leaf));
        if (entry === null) continue;
        await fs.unlinkExact(entry);
      }
      await fs.syncDirectory(directory);
      await fs.rmdirExactEmpty(directory);
    }
    await fs.syncDirectory(foundation);
    await fs.rmdirExactEmpty(foundation);
  }
  await fs.syncDirectory(root);
  await fs.rmdirExactEmpty(root);
  await syncDirectoryAt(fs, lifecycleParentPath(path));
}

/**
 * The derived effect and manifest staging a planless tree may hold before its coordinator plan
 * (§2.4). The ledger admitted every entry below it by exact path and shape, so removal walks it
 * child first and refuses anything that is no longer a plain directory or regular file.
 */
async function removeAdmittedTree(fs: LifecycleGuardedFileSystemV1, entry: LifecycleGuardedEntryV1): Promise<void> {
  if (entry.kind === "regular_file") {
    await fs.unlinkExact(entry);
    return;
  }
  if (entry.kind !== "directory") refuseLifecycleRecovery("lifecycle_staging_shape", entry.path);
  for (const name of await namesOf(fs, entry)) {
    const child = await fs.lstat(childPath(entry.path, name));
    if (child !== null) await removeAdmittedTree(fs, child);
  }
  await fs.syncDirectory(entry);
  await fs.rmdirExactEmpty(entry);
}

async function namesOf(
  fs: LifecycleGuardedFileSystemV1,
  directory: LifecycleGuardedEntryV1,
): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const name of fs.names(directory)) names.push(name);
  return names.sort();
}

function childPath(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 {
  return `${directory}/${name}` as CanonicalAbsolutePathV1;
}

async function syncDirectoryAt(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const entry = await fs.lstat(path);
  if (entry === null) refuseLifecycleRecovery("lifecycle_guarded_parent", path);
  await fs.syncDirectory(entry);
}

/** What the V2 scan observed beside the V1 ledger; the V1 closure is computed without V2 envelopes. */
export interface LifecycleClosureV2ObservationV1 {
  readonly v1: LifecycleJournalClosureV1;
  /** Unknown schema, missing plan or journal, a cursor mismatch, or any unparseable V2 residue. */
  readonly malformed: boolean;
  readonly updateCoordinators: readonly {
    readonly id: LifecycleCoordinatorIdV1;
    readonly operation: UpdateOperationV1;
    readonly direction: "forward" | "compensating";
  }[];
  readonly constructions: readonly UpdateConstructionClosureV1[];
  readonly executorRecord: {
    readonly state: "executing" | "terminal_cleanup";
    readonly coordinatorId: LifecycleCoordinatorIdV1;
  } | null;
}

/**
 * Spec 2 §9.2's closure V2. One update coordinator (terminal ones compact before `clear`) yields
 * `update_recovery`; with no outer plan, one construction envelope yields its compensation-only
 * cleanup; a lone `terminal_cleanup` record yields executor cleanup. Two coordinators, V1/V2
 * mixing, an orphan `executing` record, or a record naming another coordinator is recovery-required.
 */
export function classifyLifecycleJournalClosureV2(
  observation: LifecycleClosureV2ObservationV1,
): LifecycleJournalClosureV2 {
  const required = { kind: "lifecycle_recovery_required" } as const;
  const { v1, updateCoordinators, constructions, executorRecord } = observation;
  if (observation.malformed || updateCoordinators.length + constructions.length > 1) return required;
  const [coordinator] = updateCoordinators;
  if (coordinator !== undefined) {
    if (v1.kind !== "clear") return required;
    if (executorRecord !== null && executorRecord.coordinatorId !== coordinator.id) return required;
    return {
      kind: "update_recovery",
      coordinatorId: coordinator.id,
      operation: coordinator.operation,
      direction: coordinator.direction,
    };
  }
  const [construction] = constructions;
  if (construction !== undefined) {
    if (v1.kind !== "clear" || executorRecord !== null) return required;
    return {
      kind: "update_construction_cleanup",
      coordinatorId: construction.coordinatorId,
      direction: "compensating",
      construction: construction.construction,
    };
  }
  if (executorRecord === null) return v1;
  if (executorRecord.state !== "terminal_cleanup" || v1.kind !== "clear") return required;
  return { kind: "update_executor_cleanup", coordinatorId: executorRecord.coordinatorId };
}
