import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";

import {
  canonicalStatePhaseAfter,
  decodeCanonicalJson,
  encodeCanonicalJson,
  isRetainedRecordVerification,
  LifecycleRecoveryRequiredError,
  MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES,
  MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES,
  parseCanonicalAbsolutePathText,
  parseUtcTimestamp,
  rejectUpdateStep,
  stateLeafKindForRole,
  updateConstructionEvidencePath,
  updateParticipantDocumentHash,
  validateConstructionFileEvidence,
  validateStateParticipantJournal,
  type CanonicalAbsolutePathV1,
  type CanonicalStateFilePlanV1,
  type CanonicalStatePreimageV1,
  type CanonicalStatePostimageV1,
  type ImmutableUpdatePlanRefV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LowerHexSha256,
  type StatePayloadRefV1,
  type TargetVerificationPlanV1,
  type UInt64DecimalV1,
  type UpdateConstructionPlanV1,
  type UpdateInitialJournalRefV1,
  type UpdateParticipantObservationV1,
  type UpdateStateParticipantJournalV1,
  type UtcTimestampV1,
} from "@developer-os/core";

const encoder = new TextEncoder();
const REWRITE_FLAGS = constants.O_WRONLY | constants.O_NOFOLLOW;

/** A third state: preserved as found and surfaced as recovery-required (exit 6). */
export function refuseParticipant(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function parentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

export function participantTimestamp(now: () => Date, floor: UtcTimestampV1): UtcTimestampV1 {
  const stamp = parseUtcTimestamp(now().toISOString());
  return stamp > floor ? stamp : floor;
}

export interface UpdatePayloadIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

/**
 * Resolves a planned postimage payload to the device/inode its construction row recorded. A plan
 * never carries a postimage inode (D60): it is written before its payload exists.
 */
export type UpdatePayloadIdentityResolverV1 = (payload: Pick<StatePayloadRefV1, "coordinatorId" | "ordinal" | "path" | "hash" | "bytes" | "mode">) => Promise<UpdatePayloadIdentityV1>;

/**
 * The production resolver: the payload ref must equal its `state_after` construction row, and the
 * identity comes only from that row's reopened, canonical construction evidence.
 */
export function constructionPayloadIdentity(fs: LifecycleGuardedFileSystemV1, effectiveUid: number, plan: UpdateConstructionPlanV1): UpdatePayloadIdentityResolverV1 {
  return async (payload) => {
    const row = plan.files[payload.ordinal];
    if (payload.coordinatorId !== plan.coordinatorId || row?.role.kind !== "payload" || row.role.payloadKind !== "state_after" || row.path !== payload.path || row.sha256 !== payload.hash || row.bytes !== payload.bytes || row.mode !== payload.mode) {
      return refuseParticipant("update_state_payload_row", payload.path);
    }
    const path = updateConstructionEvidencePath(plan.stagingRoot.path, payload.ordinal);
    const entry = await fs.lstat(path);
    if (entry?.kind !== "regular_file" || entry.ownerUid !== effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES)) return refuseParticipant("update_state_payload_evidence", path);
    try {
      const evidence = validateConstructionFileEvidence(await fs.readRegular(entry, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES), plan, payload.ordinal);
      return { dev: evidence.dev, ino: evidence.ino };
    } catch (error) {
      if (error instanceof LifecycleRecoveryRequiredError) throw error;
      throw Object.assign(new LifecycleRecoveryRequiredError("update_state_payload_evidence", [path]), { cause: error });
    }
  };
}

export interface UpdateParticipantJournalStoreDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
}

/**
 * Spec 2 §9.2's participant journal protocol. A staged initial journal moves no-replace to its one
 * final path, keeping the construction-evidenced inode; later rewrites stay on that same inode.
 * A torn rewrite is non-canonical and therefore exit 6, never silently adopted.
 */
export class UpdateParticipantJournalStore {
  readonly #dependencies: UpdateParticipantJournalStoreDependenciesV1;

  constructor(dependencies: UpdateParticipantJournalStoreDependenciesV1) {
    this.#dependencies = dependencies;
  }

  /** Publishes the evidence-bound staged journal on first reach, then returns the current value. */
  async open(ref: UpdateInitialJournalRefV1): Promise<unknown> {
    const { fs } = this.#dependencies;
    const staged = await fs.lstat(ref.stagedPath);
    const final = await fs.lstat(ref.finalPath);
    if (staged !== null && final !== null) refuseParticipant("update_participant_journal_two_copies", ref.stagedPath, ref.finalPath);
    if (final !== null) return this.read(final);
    if (staged === null) return refuseParticipant("update_participant_journal_absent", ref.stagedPath, ref.finalPath);
    const bytes = await this.readBytes(staged);
    if (bytes.byteLength !== ref.stagedExpected.bytes || sha256Hex(bytes) !== ref.stagedExpected.hash) refuseParticipant("update_participant_journal_staged_bytes", ref.stagedPath);
    const destination = await this.ensureDirectory(parentPath(ref.finalPath));
    await fs.renameNoReplace(staged, ref.finalPath);
    await fs.syncDirectory(destination);
    const source = await fs.lstat(parentPath(ref.stagedPath));
    if (source?.kind === "directory") await fs.syncDirectory(source);
    const moved = await fs.lstat(ref.finalPath);
    if (moved?.dev !== staged.dev || moved.ino !== staged.ino) refuseParticipant("update_participant_journal_inode", ref.finalPath);
    return this.read(moved);
  }

  /** The staged journal was never published: the step was not reached. */
  async unreached(ref: UpdateInitialJournalRefV1): Promise<boolean> {
    return (await this.#dependencies.fs.lstat(ref.finalPath)) === null && (await this.#dependencies.fs.lstat(ref.stagedPath)) !== null;
  }

  async exists(path: CanonicalAbsolutePathV1): Promise<boolean> {
    return (await this.#dependencies.fs.lstat(path)) !== null;
  }

  async readAt(path: CanonicalAbsolutePathV1): Promise<unknown> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return refuseParticipant("update_participant_journal_absent", path);
    return this.read(entry);
  }

  /** Rewrites the same inode and syncs it before any later effect may run. */
  async rewrite(path: CanonicalAbsolutePathV1, value: unknown): Promise<void> {
    const bytes = encoder.encode(encodeCanonicalJson(value as never));
    if (bytes.byteLength > MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES) refuseParticipant("update_participant_journal_size", path);
    const entry = this.requireOwned(await this.#dependencies.fs.lstat(path), path);
    const handle = await nodeFs.open(path, REWRITE_FLAGS);
    try {
      const stat = await handle.stat({ bigint: true });
      if (stat.dev.toString(10) !== entry.dev || stat.ino.toString(10) !== entry.ino) refuseParticipant("update_participant_journal_inode", path);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (bytesWritten < 1) refuseParticipant("update_participant_journal_write", path);
        offset += bytesWritten;
      }
      await handle.truncate(bytes.byteLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Guarded removal of one recognizable leaf, then a parent sync. Absence is already done. */
  async remove(path: CanonicalAbsolutePathV1, expectedHash: LowerHexSha256 | null = null): Promise<void> {
    const { fs } = this.#dependencies;
    const entry = await fs.lstat(path);
    if (entry === null) return;
    this.requireOwned(entry, path);
    if (expectedHash !== null && (await fs.hashRegular(entry, BigInt(entry.size))) !== expectedHash) refuseParticipant("update_participant_leaf_changed", path);
    await fs.unlinkExact(entry);
    const parent = await fs.lstat(parentPath(path));
    if (parent !== null) await fs.syncDirectory(parent);
  }

  /** Writes one canonical evidence file exclusively; an existing file must hold the same bytes. */
  async writeEvidence(path: CanonicalAbsolutePathV1, value: unknown, maximumBytes: number): Promise<LowerHexSha256> {
    const { fs } = this.#dependencies;
    const bytes = encoder.encode(encodeCanonicalJson(value as never));
    if (bytes.byteLength > maximumBytes) refuseParticipant("update_participant_evidence_size", path);
    const existing = await fs.lstat(path);
    if (existing !== null) {
      if (sha256Hex(await this.readBytes(existing, maximumBytes)) !== sha256Hex(bytes)) refuseParticipant("update_participant_evidence_changed", path);
      return sha256Hex(bytes);
    }
    const parent = await this.ensureDirectory(parentPath(path));
    await fs.writeExclusive(path, bytes);
    await fs.syncDirectory(parent);
    return sha256Hex(bytes);
  }

  async ensureDirectory(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    const { fs, effectiveUid } = this.#dependencies;
    const existing = await fs.lstat(path);
    if (existing !== null) {
      if (existing.kind !== "directory" || existing.ownerUid !== effectiveUid || existing.mode !== 0o700) refuseParticipant("update_participant_directory", path);
      return existing;
    }
    const parent = await this.ensureDirectory(parentPath(path));
    const created = await fs.mkdirExclusive(path);
    await fs.syncDirectory(parent);
    return created;
  }

  private requireOwned(entry: LifecycleGuardedEntryV1 | null, path: CanonicalAbsolutePathV1): LifecycleGuardedEntryV1 {
    if (entry?.kind !== "regular_file" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o600 || entry.nlink !== 1) return refuseParticipant("update_participant_leaf_identity", path);
    return entry;
  }

  private async readBytes(entry: LifecycleGuardedEntryV1, maximumBytes = MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES): Promise<Uint8Array> {
    this.requireOwned(entry, entry.path);
    if (BigInt(entry.size) > BigInt(maximumBytes)) refuseParticipant("update_participant_leaf_size", entry.path);
    return this.#dependencies.fs.readRegular(entry, maximumBytes);
  }

  private async read(entry: LifecycleGuardedEntryV1): Promise<unknown> {
    const bytes = await this.readBytes(entry);
    try {
      const value = decodeCanonicalJson(bytes, MAXIMUM_UPDATE_PARTICIPANT_JOURNAL_BYTES);
      if (encodeCanonicalJson(value) !== new TextDecoder().decode(bytes)) refuseParticipant("update_participant_journal_not_canonical", entry.path);
      return value;
    } catch (error) {
      if (error instanceof LifecycleRecoveryRequiredError) throw error;
      return refuseParticipant("update_participant_journal_not_canonical", entry.path);
    }
  }
}

type PresentPreimage = Extract<CanonicalStatePreimageV1, { readonly state: "present" }>;
type PresentPostimage = Extract<CanonicalStatePostimageV1, { readonly state: "present" }>;
type PresentState = Pick<PresentPreimage, "hash" | "ownerUid" | "size"> & UpdatePayloadIdentityV1;
type Observed = "missing" | "before" | "after" | "third";
type StateKind = "release_trust_state" | "active_release_state" | "rollback_record_state";
type StateJournal = UpdateStateParticipantJournalV1<StateKind>;

export interface CanonicalStateParticipantDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly journals: UpdateParticipantJournalStore;
  readonly effectiveUid: number;
  readonly now: () => Date;
  /** The role's own strict codec over reopened bytes; throws on anything else. */
  readonly validateBytes: (role: CanonicalStateFilePlanV1["role"], bytes: Uint8Array) => void;
  /** The postimage identity, from construction evidence only (`constructionPayloadIdentity`). */
  readonly payloadIdentity: UpdatePayloadIdentityResolverV1;
}

export interface CanonicalStateStepV1 {
  readonly plan: CanonicalStateFilePlanV1;
  readonly planRef: ImmutableUpdatePlanRefV1<"release_trust_state" | "active_release_state" | "rollback_record_state">;
  readonly journal: UpdateInitialJournalRefV1;
}

/**
 * Spec 2 §9.2's trust/active/rollback-record participant, the manifest-state pattern over one
 * canonical file: preimage to a sibling tombstone, pre-intent payload in no-replace, reopen and
 * verify. Every transition adopts an already-moved inventory, so a death between a move and its
 * journal rewrite resumes; any other inventory is exit 6.
 */
export class CanonicalStateParticipant {
  readonly #dependencies: CanonicalStateParticipantDependenciesV1;

  constructor(dependencies: CanonicalStateParticipantDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async apply(step: CanonicalStateStepV1): Promise<UpdateParticipantObservationV1> {
    const path = step.journal.finalPath;
    let journal = await this.openJournal(step);
    if (journal.phase === "verified" || journal.phase === "finalized") return { state: "verified" };
    if (journal.phase !== "planned" && journal.phase !== "preimage_preserved" && journal.phase !== "published") refuseParticipant("update_state_journal_direction", path);
    while (journal.nextTransition < 3) {
      await this.forward(step.plan, journal.nextTransition);
      const next = journal.nextTransition + 1;
      journal = await this.persist(path, { ...journal, phase: canonicalStatePhaseAfter(next), nextTransition: next });
    }
    return { state: "verified" };
  }

  async observe(step: CanonicalStateStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    const journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    return { state: journal.phase === "verified" || journal.phase === "finalized" ? "verified" : "applied" };
  }

  /** Trust is observed and never reversed; every other plan walks its reached prefix back to -1. */
  async compensate(step: CanonicalStateStepV1): Promise<UpdateParticipantObservationV1> {
    const { plan } = step;
    if (plan.reversal === "monotonic_no_reverse") return { state: "not_reversed" };
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    const path = step.journal.finalPath;
    let journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    if (journal.phase === "finalized") refuseParticipant("update_state_compensation_after_terminal", path);
    if (isRetainedRecordVerification(plan)) {
      await this.persist(path, { ...journal, phase: "rolled_back", compensationNext: -1 });
      return { state: "compensated" };
    }
    const reached = journal.nextTransition;
    if (journal.phase !== "compensating") {
      // The transition at `reached` may have moved its inode before the journal said so.
      if (reached < 3) await this.backward(plan, reached);
      journal = await this.persist(path, reached === 0 ? { ...journal, phase: "rolled_back", compensationNext: -1 } : { ...journal, phase: "compensating", compensationNext: Math.min(reached, 3) - 1 });
    }
    while (journal.phase === "compensating" && journal.compensationNext !== null && journal.compensationNext >= 0) {
      await this.backward(plan, journal.compensationNext);
      const next = journal.compensationNext - 1;
      journal = await this.persist(path, next < 0 ? { ...journal, phase: "rolled_back", compensationNext: -1 } : { ...journal, compensationNext: next });
    }
    await this.requireInventory(plan, plan.before.state === "present" ? "before" : "missing", "missing", plan.after.state === "present" ? "after" : "missing");
    return { state: "compensated" };
  }

  /** Manual rollback's retained record: reopen, verify unchanged, reach `verified` at transition 0. */
  async verifyRetained(step: CanonicalStateStepV1): Promise<UpdateParticipantObservationV1> {
    if (!isRetainedRecordVerification(step.plan)) refuseParticipant("update_state_not_retained_record", step.plan.path);
    const journal = await this.openJournal(step);
    if (journal.phase === "verified") return { state: "verified" };
    if (journal.phase !== "planned") refuseParticipant("update_state_journal_direction", step.journal.finalPath);
    await this.requireInventory(step.plan, "before", "missing", "missing");
    await this.validateAt(step.plan, step.plan.path);
    await this.persist(step.journal.finalPath, { ...journal, phase: "verified" });
    return { state: "verified" };
  }

  /** Terminal finalization after the point of no return: removes only the plan-bound tombstone. */
  async finalize(step: CanonicalStateStepV1): Promise<void> {
    const journal = await this.openJournal(step);
    if (journal.phase === "finalized") return;
    const retained = isRetainedRecordVerification(step.plan);
    if (journal.phase !== "verified") refuseParticipant("update_state_finalize_before_verified", step.journal.finalPath);
    if (retained) {
      const record = await this.#dependencies.fs.lstat(step.plan.path);
      if (record !== null) {
        if ((await this.observeFile(step.plan.path, step.plan)) !== "before") refuseParticipant("update_state_third", step.plan.path);
        await this.#dependencies.journals.remove(step.plan.path, (step.plan.before as PresentPreimage).hash);
      }
    } else if (step.plan.before.state === "present") {
      if ((await this.observeFile(step.plan.tombstonePath, step.plan)) !== "missing") await this.#dependencies.journals.remove(step.plan.tombstonePath, step.plan.before.hash);
    }
    await this.persist(step.journal.finalPath, { ...journal, phase: "finalized", nextTransition: 4 });
  }

  /** The matching outer compaction entry: an unconsumed payload, then the journal, then the plan last. */
  async compact(step: CanonicalStateStepV1): Promise<void> {
    const { journals, fs } = this.#dependencies;
    if ((await fs.lstat(step.journal.finalPath)) !== null) {
      const journal = await this.openJournal(step);
      if (journal.phase !== "finalized" && journal.phase !== "rolled_back") refuseParticipant("update_state_compaction_not_terminal", step.journal.finalPath);
      if (step.plan.after.state === "present") await journals.remove(step.plan.after.payload.path, step.plan.after.hash);
      await journals.remove(step.journal.finalPath);
    }
    await journals.remove(step.planRef.path, step.planRef.hash);
  }

  private async openJournal(step: CanonicalStateStepV1): Promise<StateJournal> {
    const role = step.plan.role;
    if (role === "release_metadata") return refuseParticipant("update_state_role", step.plan.path);
    const kind = stateLeafKindForRole(role);
    if (step.journal.kind !== kind || step.planRef.kind !== kind || step.planRef.hash !== updateParticipantDocumentHash(step.plan) || step.journal.planHash !== step.planRef.hash) refuseParticipant("update_state_binding", step.journal.finalPath);
    const value = await this.#dependencies.journals.open(step.journal);
    return validateStateParticipantJournal(value, kind, { id: step.plan.id, coordinatorId: step.plan.coordinatorId, retainedVerification: isRetainedRecordVerification(step.plan) }, step.planRef.hash);
  }

  private async persist(path: CanonicalAbsolutePathV1, journal: StateJournal): Promise<StateJournal> {
    const next = { ...journal, updatedAt: participantTimestamp(this.#dependencies.now, journal.updatedAt) };
    await this.#dependencies.journals.rewrite(path, next);
    return next;
  }

  private async forward(plan: CanonicalStateFilePlanV1, transition: number): Promise<void> {
    const { fs } = this.#dependencies;
    const payloadPath = plan.after.state === "present" ? plan.after.payload.path : null;
    if (transition === 0 && plan.before.state === "present") {
      const [current, tombstone] = [await this.observeFile(plan.path, plan), await this.observeFile(plan.tombstonePath, plan)];
      if (current === "before" && tombstone === "missing") await this.move(plan.path, plan.tombstonePath);
      else if (!(current === "missing" && tombstone === "before")) refuseParticipant("update_state_third", plan.path, plan.tombstonePath);
    } else if (transition === 1 && payloadPath !== null) {
      const [current, payload] = [await this.observeFile(plan.path, plan), await this.observeFile(payloadPath, plan)];
      if (current === "missing" && payload === "after") await this.move(payloadPath, plan.path);
      else if (!(current === "after" && payload === "missing")) refuseParticipant("update_state_third", plan.path, payloadPath);
    } else if (transition === 2) {
      await this.requireInventory(plan, plan.after.state === "present" ? "after" : "missing", plan.before.state === "present" ? "before" : "missing", "missing");
      if (plan.after.state === "present") await this.validateAt(plan, plan.path);
    }
    if ((await fs.lstat(parentPath(plan.path))) === null) refuseParticipant("update_state_parent", plan.path);
  }

  private async backward(plan: CanonicalStateFilePlanV1, transition: number): Promise<void> {
    const payloadPath = plan.after.state === "present" ? plan.after.payload.path : null;
    if (transition === 1 && payloadPath !== null) {
      const [current, payload] = [await this.observeFile(plan.path, plan), await this.observeFile(payloadPath, plan)];
      if (current === "after" && payload === "missing") await this.move(plan.path, payloadPath);
      else if (!(current !== "after" && payload === "after")) refuseParticipant("update_state_third", plan.path, payloadPath);
    } else if (transition === 0 && plan.before.state === "present") {
      const [current, tombstone] = [await this.observeFile(plan.path, plan), await this.observeFile(plan.tombstonePath, plan)];
      if (current === "missing" && tombstone === "before") await this.move(plan.tombstonePath, plan.path);
      else if (!(current === "before" && tombstone === "missing")) refuseParticipant("update_state_third", plan.path, plan.tombstonePath);
    }
  }

  private async move(source: CanonicalAbsolutePathV1, destination: CanonicalAbsolutePathV1): Promise<void> {
    const { fs } = this.#dependencies;
    const entry = await fs.lstat(source);
    if (entry === null) return refuseParticipant("update_state_move_source", source);
    await fs.renameNoReplace(entry, destination);
    for (const parent of new Set([parentPath(source), parentPath(destination)])) {
      const directory = await fs.lstat(parent);
      if (directory?.kind !== "directory") refuseParticipant("update_state_parent", parent);
      await fs.syncDirectory(directory);
    }
    const moved = await fs.lstat(destination);
    if (moved?.dev !== entry.dev || moved.ino !== entry.ino) refuseParticipant("update_state_move_inode", destination);
  }

  private async requireInventory(plan: CanonicalStateFilePlanV1, current: Observed, tombstone: Observed, payload: Observed): Promise<void> {
    const payloadPath = plan.after.state === "present" ? plan.after.payload.path : null;
    if ((await this.observeFile(plan.path, plan)) !== current) refuseParticipant("update_state_third", plan.path);
    if ((await this.observeFile(plan.tombstonePath, plan)) !== tombstone) refuseParticipant("update_state_third", plan.tombstonePath);
    if (payloadPath !== null && (await this.observeFile(payloadPath, plan)) !== payload) refuseParticipant("update_state_third", payloadPath);
  }

  /**
   * Classifies one path by exact owner/mode/link/size/inode/content identity. The preimage inode is
   * planned; the postimage inode is its payload's construction evidence, so a moved inode is third.
   */
  private async observeFile(path: CanonicalAbsolutePathV1, plan: CanonicalStateFilePlanV1): Promise<Observed> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return "missing";
    const candidates: [Observed, PresentState | null][] = [
      ["before", plan.before.state === "present" ? plan.before : null],
      ["after", plan.after.state === "present" ? await this.postimage(plan.after) : null],
    ];
    for (const [label, state] of candidates) {
      if (state === null || !this.matches(entry, state)) continue;
      if ((await this.#dependencies.fs.hashRegular(entry, BigInt(state.size))) === state.hash) return label;
    }
    return "third";
  }

  private async postimage(after: PresentPostimage): Promise<PresentState> {
    const { dev, ino } = await this.#dependencies.payloadIdentity(after.payload);
    return { hash: after.hash, ownerUid: after.ownerUid, size: after.size, dev, ino };
  }

  private matches(entry: LifecycleGuardedEntryV1, state: PresentState): boolean {
    return entry.kind === "regular_file" && entry.ownerUid === state.ownerUid && entry.ownerUid === this.#dependencies.effectiveUid && entry.mode === 0o600 && entry.nlink === 1 && entry.size === String(state.size) && entry.dev === state.dev && entry.ino === state.ino;
  }

  private async validateAt(plan: CanonicalStateFilePlanV1, path: CanonicalAbsolutePathV1): Promise<void> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return refuseParticipant("update_state_third", path);
    const bytes = await this.#dependencies.fs.readRegular(entry, 67_108_864);
    try {
      this.#dependencies.validateBytes(plan.role, bytes);
    } catch (error) {
      throw Object.assign(new LifecycleRecoveryRequiredError("update_state_invalid_bytes", [path]), { cause: error });
    }
  }
}

export interface TargetVerifierObservationV1 {
  readonly exitCode: number;
  readonly manifestHash: LowerHexSha256;
  readonly ownerPostimagesHash: LowerHexSha256;
  readonly migrationPostimagesHash: LowerHexSha256;
}

/** The signed target verifier under the plan's fixed read-only table; Security supervises the process. */
export interface TargetVerifierPortV1 {
  verify(plan: TargetVerificationPlanV1): Promise<TargetVerifierObservationV1>;
}

/**
 * Success only when the verifier exits zero and echoes every plan-bound postimage digest. A
 * disagreeing verifier is a rejection the coordinator compensates (§9.4); a plan that breaches
 * the read-only single-process policy is a third state (exit 6).
 */
export async function runTargetVerifier(plan: TargetVerificationPlanV1, port: TargetVerifierPortV1): Promise<UpdateParticipantObservationV1> {
  if (!(plan.readOnly as boolean) || (plan.processCount as number) !== 1) refuseParticipant("update_verifier_policy");
  const observed = await port.verify(plan);
  if (observed.exitCode !== 0 || observed.manifestHash !== plan.manifestHash || observed.ownerPostimagesHash !== plan.ownerPostimagesHash || observed.migrationPostimagesHash !== plan.migrationPostimagesHash) {
    rejectUpdateStep("update_verifier_rejected");
  }
  return { state: "verified" };
}
