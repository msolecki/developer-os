/**
 * Spec 1 §2.4's DOS-P7 Foundation participant. A coordinator stages a participant's blobs
 * and its initial journal into lifecycle staging, then reaches the step and publishes that
 * exact inode into `state/transactions` through the executor's first-write bridge. Nothing
 * here unlinks a coordinator or participant plan, and nothing here mutates a target: the
 * unchanged `TransactionExecutor` owns every phase past `planned`.
 */
import { createHash } from "node:crypto";

import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { admitLifecycleFoundationInitialJournal } from "../transactions/executor.js";
import type { TransactionExecutor } from "../transactions/executor.js";
import { encodeFoundationJournalJsonV1, validateJournal } from "../transactions/store.js";
import type {
  BootstrapInitialJournalPublicationV1,
  TransactionJournalV1,
  TransactionPhase,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  type LowerHexSha256,
  type UtcTimestampV1,
} from "../update/scalars.js";
import { foundationParticipantPlanHash } from "./codecs.js";
import type { LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import {
  lifecycleParentPath,
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { parseAllocatedLifecycleId, type FoundationTransactionIdV1 } from "./ids.js";
import {
  FOUNDATION_STAGED_JOURNAL_MODE,
  LIFECYCLE_PLAN_BOUNDS,
  type FoundationParticipantRefV1,
  type FoundationParticipantSlotV1,
} from "./types.js";

export interface FoundationParticipantMutationInputV1 {
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: LowerHexSha256 | null;
  readonly content: Uint8Array | null;
}

export interface FoundationParticipantStageInputV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly id: FoundationTransactionIdV1;
  readonly slot: FoundationParticipantSlotV1;
  readonly role: FoundationParticipantRefV1["role"];
  readonly createdAt: UtcTimestampV1;
  readonly mutations: readonly FoundationParticipantMutationInputV1[];
}

export type FoundationParticipantStateV1 = "future" | "staged" | TransactionPhase;

export interface FoundationParticipantDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly executor: TransactionExecutor;
  readonly effectiveUid: number;
  readonly afterBoundary?: ((boundary: string) => void | Promise<void>) | undefined;
}

const PHASES: readonly TransactionPhase[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
  "rolled_back",
];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function child(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${directory}/${name}`);
}

function journalKindOf(
  slot: FoundationParticipantSlotV1,
  role: FoundationParticipantRefV1["role"],
): string {
  return role.kind === "forward" ? `lifecycle.${slot}` : `lifecycle.${slot}.compensation`;
}

function plannedJournalOf(
  id: string,
  kind: string,
  createdAt: UtcTimestampV1,
  mutations: readonly FoundationMutationRefV1[],
): TransactionJournalV1 {
  return validateJournal({
    schemaVersion: 1,
    id,
    kind,
    phase: "planned",
    createdAt,
    updatedAt: createdAt,
    mutations: mutations.map((mutation, index) => ({
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      stagedRelativePath: mutation.operation === "remove" ? null : `${String(index)}.bin`,
    })),
  });
}

function widestJournalBytes(planned: TransactionJournalV1): number {
  return Math.max(
    ...PHASES.map(
      (phase) => encoder.encode(encodeFoundationJournalJsonV1({ ...planned, phase })).byteLength,
    ),
  );
}

function decodeJournal(bytes: Uint8Array, path: CanonicalAbsolutePathV1): TransactionJournalV1 {
  try {
    return validateJournal(JSON.parse(decoder.decode(bytes)) as unknown);
  } catch {
    return refuseLifecycleRecovery("lifecycle_foundation_journal_bytes", path);
  }
}

export class FoundationParticipantExecutor {
  private readonly dependencies: FoundationParticipantDependenciesV1;

  constructor(dependencies: FoundationParticipantDependenciesV1) {
    this.dependencies = dependencies;
  }

  async stage(input: FoundationParticipantStageInputV1): Promise<FoundationParticipantRefV1> {
    const { fs, roots } = this.dependencies;
    const id = parseAllocatedLifecycleId("tx", input.id, null);
    const mutations = this.plannedMutations(id, input.mutations);
    if (input.role.kind === "compensation") {
      await this.requireInverseOfStagedForward(input, mutations, input.role.forwardId);
    }

    const blobDirectory = await this.ensureDirectory(child(roots.foundationStaging, id));
    for (const [index, mutation] of input.mutations.entries()) {
      const content = mutation.content;
      if (content === null) continue;
      await fs.writeExclusive(child(blobDirectory.path, `${String(index)}.bin`), content);
      await fs.writeExclusive(
        child(blobDirectory.path, `${String(index)}.bin.sha256`),
        encoder.encode(`${digestOf(content)}\n`),
      );
    }
    await fs.syncDirectory(blobDirectory);

    const kind = journalKindOf(input.slot, input.role);
    const planned = plannedJournalOf(id, kind, input.createdAt, mutations);
    const plannedBytes = encoder.encode(encodeFoundationJournalJsonV1(planned));
    const maximumJournalBytes = widestJournalBytes(planned);
    if (
      maximumJournalBytes < LIFECYCLE_PLAN_BOUNDS.journalBytes.minimum ||
      maximumJournalBytes > LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum
    ) {
      refuseLifecycleRecovery("lifecycle_foundation_journal_size", blobDirectory.path);
    }

    const coordinatorDirectory = await this.ensureDirectory(
      child(roots.lifecycleStaging, input.coordinatorId),
    );
    const foundationDirectory = await this.ensureDirectory(
      child(coordinatorDirectory.path, "foundation"),
    );
    const journalDirectory = await this.ensureDirectory(child(foundationDirectory.path, id));
    const staged = await fs.writeExclusive(child(journalDirectory.path, "journal.json"), plannedBytes);
    await fs.syncDirectory(journalDirectory);
    await this.dependencies.afterBoundary?.("participant_staged");

    const core = {
      slot: input.slot,
      role: input.role,
      mutations,
      maximumJournalBytes,
      initialJournal: {
        finalPath: child(roots.foundationJournals, `${id}.json`),
        plannedBytesHash: digestOf(plannedBytes),
        stagedPath: staged.path,
        stagedIdentity: {
          hash: digestOf(plannedBytes),
          size: plannedBytes.byteLength,
          mode: FOUNDATION_STAGED_JOURNAL_MODE,
          dev: staged.dev,
          ino: staged.ino,
        },
      },
    } satisfies Omit<FoundationParticipantRefV1, "id" | "planHash">;
    return { id, ...core, planHash: foundationParticipantPlanHash(core) };
  }

  async apply(ref: FoundationParticipantRefV1): Promise<TransactionJournalV1> {
    const { fs, effectiveUid } = this.dependencies;
    const staged = await fs.lstat(ref.initialJournal.stagedPath);
    const final = await fs.lstat(ref.initialJournal.finalPath);
    const source = staged ?? final;
    if (source === null) {
      refuseLifecycleRecovery(
        "lifecycle_foundation_participant_absent",
        ref.initialJournal.stagedPath,
        ref.initialJournal.finalPath,
      );
    }
    const admitted = admitLifecycleFoundationInitialJournal({
      ref,
      ownerUid: effectiveUid,
      initialJournal: await this.readPlannedJournal(ref, source),
      sourceParent: await this.publicationParent(ref.initialJournal.stagedPath),
      destinationParent: await this.publicationParent(ref.initialJournal.finalPath),
    });
    return this.dependencies.executor.executeLifecycleFoundationParticipant(admitted);
  }

  async observe(ref: FoundationParticipantRefV1): Promise<FoundationParticipantStateV1> {
    const { fs } = this.dependencies;
    const final = await fs.lstat(ref.initialJournal.finalPath);
    if (final !== null) {
      const journal = decodeJournal(
        await fs.readRegular(final, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum),
        final.path,
      );
      if (journal.id !== ref.id) {
        refuseLifecycleRecovery("lifecycle_foundation_journal_id", final.path);
      }
      return journal.phase;
    }
    return (await fs.lstat(ref.initialJournal.stagedPath)) === null ? "future" : "staged";
  }

  async discardUnstarted(ref: FoundationParticipantRefV1): Promise<void> {
    const { fs } = this.dependencies;
    if ((await fs.lstat(ref.initialJournal.finalPath)) !== null) {
      refuseLifecycleRecovery(
        "lifecycle_foundation_participant_started",
        ref.initialJournal.finalPath,
      );
    }
    for (const mutation of ref.mutations) {
      await this.requireRecordedPreimage(mutation);
    }

    const staged = await fs.lstat(ref.initialJournal.stagedPath);
    if (staged !== null) {
      await fs.unlinkExact(staged);
      await this.syncDirectoryAt(lifecycleParentPath(staged.path));
      await this.dependencies.afterBoundary?.("staged_journal_unlinked");
    }
    for (const mutation of ref.mutations) {
      const stagedPath = mutation.stagedPath;
      if (stagedPath === null) continue;
      for (const path of [stagedPath, parseCanonicalAbsolutePathText(`${stagedPath}.sha256`)]) {
        const leaf = await fs.lstat(path);
        if (leaf === null) continue;
        await fs.unlinkExact(leaf);
      }
      await this.syncDirectoryAt(lifecycleParentPath(stagedPath));
      await this.dependencies.afterBoundary?.("staged_blob_unlinked");
    }
  }

  private plannedMutations(
    id: string,
    inputs: readonly FoundationParticipantMutationInputV1[],
  ): readonly FoundationMutationRefV1[] {
    const bounds = LIFECYCLE_PLAN_BOUNDS;
    if (inputs.length < bounds.mutationsPerRef.minimum || inputs.length > bounds.mutationsPerRef.maximum) {
      refuseLifecycleRecovery("lifecycle_foundation_mutation_count", this.dependencies.roots.productHome);
    }
    const targets = new Set<string>();
    return inputs.map((input, index) => {
      if (targets.has(input.targetPath)) {
        refuseLifecycleRecovery("lifecycle_foundation_target_duplicate", input.targetPath);
      }
      targets.add(input.targetPath);
      const content = input.content;
      if (input.operation === "remove") {
        if (content !== null || input.expectedBeforeHash === null) {
          refuseLifecycleRecovery("lifecycle_foundation_mutation_shape", input.targetPath);
        }
        return {
          targetPath: input.targetPath,
          operation: input.operation,
          expectedBeforeHash: input.expectedBeforeHash,
          contentHash: null,
          contentSize: null,
          stagedPath: null,
        };
      }
      if (
        content === null ||
        (input.operation === "create") !== (input.expectedBeforeHash === null) ||
        content.byteLength < bounds.mutationContentSize.minimum ||
        content.byteLength > bounds.mutationContentSize.maximum
      ) {
        refuseLifecycleRecovery("lifecycle_foundation_mutation_shape", input.targetPath);
      }
      return {
        targetPath: input.targetPath,
        operation: input.operation,
        expectedBeforeHash: input.expectedBeforeHash,
        contentHash: digestOf(content),
        contentSize: content.byteLength,
        stagedPath: child(
          child(this.dependencies.roots.foundationStaging, id),
          `${String(index)}.bin`,
        ),
      };
    });
  }

  /**
   * §2.4 pairs an inverse against the forward's *staged* plan, not against a value the
   * caller passes twice: the compensation is planned while the forward is still unapplied,
   * so the forward's staged journal and blobs are the only authority for what it will do.
   */
  private async requireInverseOfStagedForward(
    input: FoundationParticipantStageInputV1,
    inverse: readonly FoundationMutationRefV1[],
    forwardId: string,
  ): Promise<void> {
    const { fs, roots } = this.dependencies;
    const forwardJournalPath = child(
      child(
        child(child(roots.lifecycleStaging, input.coordinatorId), "foundation"),
        forwardId,
      ),
      "journal.json",
    );
    const entry = await fs.lstat(forwardJournalPath);
    if (entry === null) {
      refuseLifecycleRecovery("lifecycle_foundation_forward_absent", forwardJournalPath);
    }
    const forward = decodeJournal(
      await fs.readRegular(entry, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum),
      forwardJournalPath,
    );
    if (
      forward.id !== forwardId ||
      forward.phase !== "planned" ||
      forward.kind !== journalKindOf(input.slot, { kind: "forward", compensationId: null }) ||
      forward.mutations.length !== inverse.length
    ) {
      refuseLifecycleRecovery("lifecycle_foundation_forward_shape", forwardJournalPath);
    }

    const count = inverse.length;
    for (const [index, compensation] of inverse.entries()) {
      const source = forward.mutations[count - 1 - index];
      if (source === undefined || source.targetPath !== compensation.targetPath) {
        refuseLifecycleRecovery("lifecycle_foundation_inverse_target", compensation.targetPath);
      }
      const sourceContentHash =
        source.stagedRelativePath === null
          ? null
          : await this.stagedBlobHash(
              child(child(roots.foundationStaging, forwardId), source.stagedRelativePath),
            );
      const inverted =
        source.operation === "create"
          ? compensation.operation === "remove" &&
            compensation.expectedBeforeHash === sourceContentHash
          : source.operation === "remove"
            ? compensation.operation === "create" &&
              compensation.contentHash === source.expectedBeforeHash
            : compensation.operation === "replace" &&
              compensation.expectedBeforeHash === sourceContentHash &&
              compensation.contentHash === source.expectedBeforeHash;
      if (!inverted) {
        refuseLifecycleRecovery("lifecycle_foundation_inverse_shape", compensation.targetPath);
      }
    }
  }

  private async stagedBlobHash(path: CanonicalAbsolutePathV1): Promise<LowerHexSha256> {
    const entry = await this.dependencies.fs.lstat(path);
    if (entry === null) refuseLifecycleRecovery("lifecycle_foundation_forward_absent", path);
    return this.dependencies.fs.hashRegular(
      entry,
      BigInt(LIFECYCLE_PLAN_BOUNDS.mutationContentSize.maximum),
    );
  }

  private async requireRecordedPreimage(mutation: FoundationMutationRefV1): Promise<void> {
    const observed = await this.dependencies.fs.lstat(mutation.targetPath);
    if (mutation.expectedBeforeHash === null) {
      if (observed !== null) {
        refuseLifecycleRecovery("lifecycle_foundation_target_drift", mutation.targetPath);
      }
      return;
    }
    if (observed === null || observed.kind !== "regular_file") {
      refuseLifecycleRecovery("lifecycle_foundation_target_drift", mutation.targetPath);
    }
    const hash = await this.dependencies.fs.hashRegular(
      observed,
      BigInt(LIFECYCLE_PLAN_BOUNDS.mutationContentSize.maximum),
    );
    if (hash !== mutation.expectedBeforeHash) {
      refuseLifecycleRecovery("lifecycle_foundation_target_drift", mutation.targetPath);
    }
  }

  /**
   * The store rewrites a journal through a temp and a rename, so a final journal past
   * `planned` carries later `phase` and `updatedAt` members. Rewinding exactly those two and
   * requiring the recorded `plannedBytesHash` recovers the admitted planned value without
   * trusting the bytes that are actually on disk.
   */
  private async readPlannedJournal(
    ref: FoundationParticipantRefV1,
    entry: LifecycleGuardedEntryV1,
  ): Promise<TransactionJournalV1> {
    const observed = decodeJournal(
      await this.dependencies.fs.readRegular(entry, LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum),
      entry.path,
    );
    const planned: TransactionJournalV1 = {
      ...observed,
      phase: "planned",
      updatedAt: observed.createdAt,
    };
    const bytes = encoder.encode(encodeFoundationJournalJsonV1(planned));
    if (observed.id !== ref.id || digestOf(bytes) !== ref.initialJournal.plannedBytesHash) {
      refuseLifecycleRecovery("lifecycle_foundation_planned_bytes", entry.path);
    }
    return planned;
  }

  private async publicationParent(
    path: CanonicalAbsolutePathV1,
  ): Promise<BootstrapInitialJournalPublicationV1["sourceParent"]> {
    const parentPath = lifecycleParentPath(path);
    const parent = await this.dependencies.fs.lstat(parentPath);
    if (
      parent === null ||
      parent.kind !== "directory" ||
      parent.ownerUid !== this.dependencies.effectiveUid ||
      parent.mode !== 0o700
    ) {
      refuseLifecycleRecovery("lifecycle_guarded_parent", parentPath);
    }
    return { path: parentPath, ownerUid: parent.ownerUid, mode: 0o700, dev: parent.dev, ino: parent.ino };
  }

  private async ensureDirectory(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    const observed = await this.dependencies.fs.lstat(path);
    if (observed === null) return this.dependencies.fs.mkdirExclusive(path);
    if (
      observed.kind !== "directory" ||
      observed.ownerUid !== this.dependencies.effectiveUid ||
      observed.mode !== 0o700
    ) {
      refuseLifecycleRecovery("lifecycle_guarded_kind", path);
    }
    return observed;
  }

  private async syncDirectoryAt(path: CanonicalAbsolutePathV1): Promise<void> {
    const entry = await this.dependencies.fs.lstat(path);
    if (entry === null) refuseLifecycleRecovery("lifecycle_guarded_parent", path);
    await this.dependencies.fs.syncDirectory(entry);
  }
}

function digestOf(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}
