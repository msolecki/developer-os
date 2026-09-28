import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import {
  advanceConstructionJournal,
  constructionCompactionTarget,
  constructionDeletionAuthority,
  constructionEvidenceBytes,
  constructionFileEvidence,
  constructionJournalBytes,
  constructionPlanBytes,
  constructionPlanHash,
  decodeCanonicalJson,
  encodeCanonicalJson,
  initialConstructionJournal,
  isPreHandoffConstructionPhase,
  LifecycleRecoveryRequiredError,
  MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES,
  MAXIMUM_CONSTRUCTION_PLAN_BYTES,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_PARTICIPANT_JOURNAL_BYTES,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateConstructionEnvelopePaths,
  updateConstructionEvidencePath,
  validateConstructionBijections,
  validateConstructionFileEvidence,
  validateConstructionJournal,
  type CanonicalAbsolutePathV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LowerHexSha256,
  type SecretScreenedBlobV1,
  type UInt64DecimalV1,
  type UpdateConstructionClosureV1,
  type UpdateConstructionEnvelopePathsV1,
  type UpdateConstructionFilePlanV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionOuterFileV1,
  type UpdateConstructionParentV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionStepV1,
  type UtcTimestampV1,
} from "@developer-os/core";

/** Where a test may kill the constructing process; each point follows a durable effect. */
export type UpdateConstructionStoreDeathPointV1 =
  | "plan_pending_written"
  | "plan_published"
  | "journal_pending_written"
  | "journal_published"
  | "journal_rewrite_pending"
  | "journal_rewritten"
  | "directory_made"
  | "file_created"
  | "file_written"
  | "evidence_created"
  | "evidence_written"
  | "output_consumer"
  | "outer_created"
  | "outer_written"
  | "compensation_step"
  | "compaction_step";

export const UPDATE_CONSTRUCTION_STORE_DEATH_POINTS: readonly UpdateConstructionStoreDeathPointV1[] = Object.freeze([
  "plan_pending_written",
  "plan_published",
  "journal_pending_written",
  "journal_published",
  "journal_rewrite_pending",
  "journal_rewritten",
  "directory_made",
  "file_created",
  "file_written",
  "evidence_created",
  "evidence_written",
  "output_consumer",
  "outer_created",
  "outer_written",
  "compensation_step",
  "compaction_step",
]);

/**
 * Tasks 19–21 own the concrete readers and the nested source journals. The store owns only the
 * construction envelope: it never guesses a source path and never opens a nested journal itself.
 */
export interface UpdateConstructionSourcePortV1 {
  /** Reopens the row's selected authority and returns its unique bytes; the store rechecks them. */
  readonly readRow: (plan: UpdateConstructionPlanV1, row: UpdateConstructionFilePlanV1) => Promise<Uint8Array>;
  /**
   * Called once the source plan/journal rows are complete and before the first output frame. The
   * journal carries the source parents' identities (`resolveSourceParent`).
   */
  readonly prepareSources: (plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1) => Promise<void>;
  readonly consumeRollbackEntry: (plan: UpdateConstructionPlanV1, ordinal: number, frame: SecretScreenedBlobV1) => Promise<void>;
  readonly finishSources: (plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1) => Promise<void>;
  /** Pre-handoff compensation of the reached nested prefix; runs before construction rows are removed. */
  readonly compensateSources: (plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1) => Promise<void>;
  /** Terminal nested evidence that makes a delegated row's guarded absence legal during compaction. */
  readonly nestedTerminal: (plan: UpdateConstructionPlanV1, row: UpdateConstructionFilePlanV1) => Promise<boolean>;
}

export interface UpdateConstructionStoreDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly now: () => Date;
  /** The Security secret screen; throws on any finding. Runs before bytes are hashed or persisted. */
  readonly screen: (bytes: Uint8Array) => void;
  readonly sources: UpdateConstructionSourcePortV1;
  readonly interrupt?: (point: UpdateConstructionStoreDeathPointV1) => void;
}

/** The exact outer V2 coordinator plan and initial journal bytes; Task 22 derives both. */
export interface UpdateConstructionOuterBytesV1 {
  readonly plan: Uint8Array;
  readonly journal: Uint8Array;
}

interface CurrentJournal {
  readonly plan: UpdateConstructionPlanV1;
  readonly journal: UpdateConstructionJournalV1;
  readonly entry: LifecycleGuardedEntryV1;
}

const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW;
const SOURCE_JOURNAL_KINDS: readonly string[] = ["bundle_source_staging", "rollback_payload_source"];
const encoder = new TextEncoder();

/** A third state: preserved as found and surfaced as recovery-required (exit 6). */
function refuse(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function lifecycleParentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

/** Directory link counts and sizes are bookkeeping, not identity. */
function sameDirectory(observed: LifecycleGuardedEntryV1 | null, expected: LifecycleGuardedEntryV1): boolean {
  return observed?.kind === "directory" && observed.path === expected.path && observed.ownerUid === expected.ownerUid && observed.mode === expected.mode && observed.dev === expected.dev && observed.ino === expected.ino;
}

function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function entryOf(path: CanonicalAbsolutePathV1, stats: BigIntStats): LifecycleGuardedEntryV1 {
  return {
    path,
    kind: stats.isDirectory() ? "directory" : stats.isFile() ? "regular_file" : "other",
    ownerUid: Number(stats.uid),
    mode: Number(stats.mode & 0o777n),
    nlink: Number(stats.nlink),
    size: parseUInt64Decimal(stats.size.toString(10)),
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
  };
}

function directoryEntry(path: CanonicalAbsolutePathV1, ownerUid: number, dev: UInt64DecimalV1, ino: UInt64DecimalV1): LifecycleGuardedEntryV1 {
  return { path, kind: "directory", ownerUid, mode: 0o700, nlink: 2, size: parseUInt64Decimal("0"), dev, ino };
}

function sameInode(entry: LifecycleGuardedEntryV1, dev: string, ino: string): boolean {
  return entry.dev === dev && entry.ino === ino;
}

function isBoundedRegular(entry: LifecycleGuardedEntryV1, ownerUid: number, mode: number, maximumBytes: number): boolean {
  return entry.kind === "regular_file" && entry.ownerUid === ownerUid && entry.mode === mode && entry.nlink === 1 && BigInt(entry.size) <= BigInt(maximumBytes);
}

function timestamp(now: () => Date, floor: UtcTimestampV1): UtcTimestampV1 {
  const stamp = parseUtcTimestamp(now().toISOString());
  return stamp > floor ? stamp : floor;
}

/** Exact bytes only: a canonical decode that re-encodes to anything else is not this file. */
function decodeExact(bytes: Uint8Array, maximumBytes: number, path: string): unknown {
  const value = decodeCanonicalJson(bytes, maximumBytes);
  if (Buffer.compare(encoder.encode(encodeCanonicalJson(value)), bytes) !== 0) refuse("update_construction_not_canonical", path);
  return value;
}

function sourceJournal(row: UpdateConstructionFilePlanV1): boolean {
  return row.role.kind === "initial_journal" && SOURCE_JOURNAL_KINDS.includes(row.role.journalKind);
}

/** Rows before the first output frame: every immutable plan and each source's initial journal. */
function precedesFrames(row: UpdateConstructionFilePlanV1): boolean {
  return row.role.kind === "immutable_plan" || sourceJournal(row);
}

/** A source journal may have rewritten its inode before handoff; every other row keeps its planned size. */
function compensationCap(row: UpdateConstructionFilePlanV1): number {
  return row.role.kind === "initial_journal" ? MAXIMUM_PARTICIPANT_JOURNAL_BYTES : row.bytes;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten < 1) throw new Error("update construction write made no progress");
    offset += bytesWritten;
  }
  await handle.sync();
}

/**
 * P1 (D72): a source parent (`update/source/bundle` or `update/source/rollback`) is a construction
 * directory, and its identity is only the construction journal's `directoryIdentities` row of that
 * directory's ordinal. The caller reopens the parent no-follow and requires this identity.
 */
export function resolveSourceParent(journal: UpdateConstructionJournalV1, plan: UpdateConstructionPlanV1, kind: "bundle" | "rollback"): { readonly ordinal: number; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 } {
  const path = `${plan.stagingRoot.path}/update/source/${kind}`;
  if (journal.constructionPlanHash !== constructionPlanHash(plan)) return refuse("update_construction_source_parent", path);
  const ordinal = plan.directories.findIndex((directory) => directory.path === path);
  const identity = journal.directoryIdentities[ordinal];
  if (ordinal === -1 || identity?.ordinal !== ordinal) return refuse("update_construction_source_parent", path);
  return { ordinal, dev: identity.dev, ino: identity.ino };
}

/**
 * Spec 2 §9.2's pre-intent construction envelope. Every file is created exclusively and its inode
 * is journaled before byte zero; every row is evidenced before the cursor advances; recovery
 * before handoff only compensates, by recorded identity, and never resumes a write.
 */
export class UpdateConstructionStore {
  readonly #dependencies: UpdateConstructionStoreDependenciesV1;
  readonly #root: CanonicalAbsolutePathV1;
  readonly #paths: UpdateConstructionEnvelopePathsV1;
  #current: CurrentJournal | null = null;

  constructor(dependencies: UpdateConstructionStoreDependenciesV1, stagingRoot: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#root = parseCanonicalAbsolutePathText(stagingRoot);
    this.#paths = updateConstructionEnvelopePaths(this.#root);
  }

  #interrupt(point: UpdateConstructionStoreDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  async #rootEntry(plan: UpdateConstructionPlanV1 | null): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(this.#root);
    if (entry?.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o700) refuse("update_construction_staging_root", this.#root);
    if (plan !== null && !sameInode(entry, plan.stagingRoot.dev, plan.stagingRoot.ino)) refuse("update_construction_staging_root", this.#root);
    return entry;
  }

  async #children(root: LifecycleGuardedEntryV1): Promise<readonly string[]> {
    const names: string[] = [];
    for await (const name of this.#dependencies.fs.names(root)) names.push(name);
    return names.sort();
  }

  async #parentEntry(plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1, parent: UpdateConstructionParentV1): Promise<LifecycleGuardedEntryV1> {
    let expected: LifecycleGuardedEntryV1;
    if (parent.kind === "staging_root") {
      expected = directoryEntry(plan.stagingRoot.path, plan.stagingRoot.ownerUid, plan.stagingRoot.dev, plan.stagingRoot.ino);
    } else {
      const identity = journal.directoryIdentities[parent.ordinal];
      const directory = plan.directories[parent.ordinal];
      if (identity === undefined || directory === undefined) return refuse("update_construction_parent", this.#root);
      expected = directoryEntry(directory.path, directory.ownerUid, identity.dev, identity.ino);
    }
    if (!sameDirectory(await this.#dependencies.fs.lstat(expected.path), expected)) refuse("update_construction_parent", expected.path);
    return expected;
  }

  #plan(plan: UpdateConstructionPlanV1): CurrentJournal {
    const current = this.#current;
    if (current?.plan !== plan) return refuse("update_construction_not_published", this.#root);
    return current;
  }

  /** One journal transition: exclusive rewrite temp, atomic replace of the exact current inode, reopen. */
  async #advance(plan: UpdateConstructionPlanV1, step: UpdateConstructionStepV1): Promise<UpdateConstructionJournalV1> {
    const { fs } = this.#dependencies;
    const current = this.#plan(plan);
    const next = advanceConstructionJournal(plan, current.journal, step, timestamp(this.#dependencies.now, current.journal.updatedAt));
    const bytes = constructionJournalBytes(next);
    if (bytes.byteLength > plan.maximumJournalBytes) refuse("update_construction_journal_bound", this.#paths.journal);
    const root = await this.#rootEntry(plan);
    const pending = await fs.writeExclusive(this.#paths.journalRewritePending, bytes);
    this.#interrupt("journal_rewrite_pending");
    await fs.syncDirectory(root);
    await fs.renameOver(pending, current.entry);
    await fs.syncDirectory(root);
    const entry = await fs.lstat(this.#paths.journal);
    if (entry === null || !sameInode(entry, pending.dev, pending.ino)) return refuse("update_construction_journal_identity", this.#paths.journal);
    this.#current = { plan, journal: next, entry };
    this.#interrupt("journal_rewritten");
    return next;
  }

  /** `O_CREAT | O_EXCL | O_NOFOLLOW`, then the identity the journal records before byte zero. */
  async #createEmpty(path: CanonicalAbsolutePathV1, mode: number): Promise<{ readonly handle: FileHandle; readonly entry: LifecycleGuardedEntryV1 }> {
    let handle: FileHandle;
    try {
      handle = await nodeFs.open(path, CREATE_FLAGS, mode);
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "EEXIST" || code === "ELOOP") refuse("update_construction_path_exists", path);
      throw error;
    }
    try {
      await handle.chmod(mode);
      const entry = entryOf(path, await handle.stat({ bigint: true }));
      if (!isBoundedRegular(entry, this.#dependencies.effectiveUid, mode, 0)) refuse("update_construction_postimage", path);
      return { handle, entry };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** Reopens a completed write: same inode, exact length/mode, raw hash over the synced bytes. */
  async #verifyWritten(created: LifecycleGuardedEntryV1, bytes: number, sha256: LowerHexSha256, mode: number): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(created.path);
    if (entry === null || !sameInode(entry, created.dev, created.ino) || !isBoundedRegular(entry, this.#dependencies.effectiveUid, mode, bytes) || entry.size !== bytes.toString(10)) {
      return refuse("update_construction_postimage", created.path);
    }
    if ((await this.#dependencies.fs.hashRegular(entry, BigInt(bytes))) !== sha256) refuse("update_construction_postimage", created.path);
    return entry;
  }

  /**
   * Publishes the immutable plan, then its plan-derived initial journal, each through its one
   * sibling `.pending` temp and a no-replace rename, into the empty allocator-reserved root.
   */
  async publish(plan: UpdateConstructionPlanV1): Promise<UpdateConstructionJournalV1> {
    const { fs } = this.#dependencies;
    validateConstructionBijections(plan);
    if (plan.stagingRoot.path !== this.#root || plan.stagingRoot.ownerUid !== this.#dependencies.effectiveUid) refuse("update_construction_staging_root", this.#root);
    const root = await this.#rootEntry(plan);
    if ((await this.#children(root)).length !== 0) refuse("update_construction_root_not_empty", this.#root);
    const planBytes = constructionPlanBytes(plan);
    this.#dependencies.screen(planBytes);
    const planPending = await fs.writeExclusive(this.#paths.planPending, planBytes);
    this.#interrupt("plan_pending_written");
    await fs.syncDirectory(root);
    await fs.renameNoReplace(planPending, this.#paths.plan);
    await fs.syncDirectory(root);
    const published = await fs.lstat(this.#paths.plan);
    if (published === null || !sameInode(published, planPending.dev, planPending.ino)) refuse("update_construction_plan_identity", this.#paths.plan);
    this.#interrupt("plan_published");

    const journal = initialConstructionJournal(plan);
    const journalBytes = constructionJournalBytes(journal);
    if (journalBytes.byteLength > plan.maximumJournalBytes) refuse("update_construction_journal_bound", this.#paths.journal);
    const journalPending = await fs.writeExclusive(this.#paths.journalPending, journalBytes);
    this.#interrupt("journal_pending_written");
    await fs.syncDirectory(root);
    await fs.renameNoReplace(journalPending, this.#paths.journal);
    await fs.syncDirectory(root);
    const entry = await fs.lstat(this.#paths.journal);
    if (entry === null || !sameInode(entry, journalPending.dev, journalPending.ino)) return refuse("update_construction_journal_identity", this.#paths.journal);
    this.#current = { plan, journal, entry };
    this.#interrupt("journal_published");
    return journal;
  }

  /** Parent-before-child: intent, exclusive mkdir, parent sync, recorded identity, then advance. */
  async stageDirectories(plan: UpdateConstructionPlanV1): Promise<void> {
    const { fs } = this.#dependencies;
    for (let journal = this.#plan(plan).journal; journal.nextDirectory < plan.directories.length; journal = this.#plan(plan).journal) {
      const directory = plan.directories[journal.nextDirectory] as UpdateConstructionPlanV1["directories"][number];
      const parent = await this.#parentEntry(plan, journal, directory.parent);
      await this.#advance(plan, { kind: "directory_intent" });
      const created = await fs.mkdirExclusive(directory.path);
      this.#interrupt("directory_made");
      await fs.syncDirectory(parent);
      await this.#advance(plan, { kind: "directory_created", dev: created.dev, ino: created.ino });
      await this.#advance(plan, { kind: "directory_complete" });
    }
  }

  /** One row: intent → exclusive create → recorded inode → bytes → reopen → evidence → advance. */
  async #stageRow(plan: UpdateConstructionPlanV1, row: UpdateConstructionFilePlanV1, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== row.bytes || sha256Hex(bytes) !== row.sha256) refuse("update_construction_source_changed", row.path);
    this.#dependencies.screen(bytes);
    const current = this.#plan(plan).journal;
    if (current.nextFile !== row.ordinal || current.fileWriteState !== null) refuse("update_construction_cursor", row.path);
    const parent = await this.#parentEntry(plan, current, row.parent);
    await this.#advance(plan, { kind: "file_intent" });
    const target = await this.#createEmpty(row.path, row.mode);
    try {
      await this.#advance(plan, { kind: "file_created", dev: target.entry.dev, ino: target.entry.ino });
      this.#interrupt("file_created");
      await writeAll(target.handle, bytes);
      this.#interrupt("file_written");
    } finally {
      await target.handle.close();
    }
    const written = await this.#verifyWritten(target.entry, row.bytes, row.sha256, row.mode);
    await this.#dependencies.fs.syncDirectory(parent);

    const evidencePath = updateConstructionEvidencePath(plan.stagingRoot.path, row.ordinal);
    const evidenceBytes = constructionEvidenceBytes(constructionFileEvidence(plan, row.ordinal, written.dev, written.ino));
    const evidenceParent = await this.#evidenceParent(plan);
    await this.#advance(plan, { kind: "evidence_intent" });
    const evidence = await this.#createEmpty(evidencePath, 0o600);
    try {
      await this.#advance(plan, { kind: "evidence_created", dev: evidence.entry.dev, ino: evidence.entry.ino });
      this.#interrupt("evidence_created");
      await writeAll(evidence.handle, evidenceBytes);
      this.#interrupt("evidence_written");
    } finally {
      await evidence.handle.close();
    }
    await this.#verifyWritten(evidence.entry, evidenceBytes.byteLength, sha256Hex(evidenceBytes), 0o600);
    await this.#dependencies.fs.syncDirectory(evidenceParent);
    await this.#advance(plan, { kind: "file_complete" });
  }

  async #evidenceParent(plan: UpdateConstructionPlanV1): Promise<LifecycleGuardedEntryV1> {
    const path = lifecycleParentPath(updateConstructionEvidencePath(plan.stagingRoot.path, 0));
    const ordinal = plan.directories.findIndex((directory) => directory.path === path);
    return this.#parentEntry(plan, this.#plan(plan).journal, { kind: "created_directory", ordinal });
  }

  /**
   * Stages every row in ordinal order. Output frames are read only after every immutable plan and
   * source journal row is complete; each frame is rechecked, screened, and written to all of its
   * exact consumers before the next frame is accepted.
   */
  async stageFiles(plan: UpdateConstructionPlanV1, frames: AsyncIterable<SecretScreenedBlobV1>): Promise<void> {
    const { sources } = this.#dependencies;
    let framesRead = false;
    for (;;) {
      const journal = this.#plan(plan).journal;
      const row = plan.files[journal.nextFile];
      if (!framesRead && (row === undefined || !precedesFrames(row))) {
        await sources.prepareSources(plan, journal);
        await this.#streamFrames(plan, frames);
        framesRead = true;
        continue;
      }
      if (row === undefined) break;
      if (row.role.kind === "payload" && row.role.source.kind === "planner_output") refuse("update_construction_unconsumed_frame", row.path);
      await this.#stageRow(plan, row, await this.#rowBytes(plan, row));
    }
    await this.#advance(plan, { kind: "sources_staging" });
    await sources.finishSources(plan, this.#plan(plan).journal);
    await this.#advance(plan, { kind: "files_ready" });
  }

  // ponytail: whole-row buffers, bounded by the 512 MiB row cap; stream in chunks if RSS matters.
  async #rowBytes(plan: UpdateConstructionPlanV1, row: UpdateConstructionFilePlanV1): Promise<Uint8Array> {
    if (row.role.kind === "payload" && row.role.source.kind === "plan_derived") return encoder.encode(row.role.source.value);
    return this.#dependencies.sources.readRow(plan, row);
  }

  async #streamFrames(plan: UpdateConstructionPlanV1, frames: AsyncIterable<SecretScreenedBlobV1>): Promise<void> {
    for await (const frame of frames) {
      const expected = plan.outputFrames[this.#plan(plan).journal.nextOutputFrame];
      if (expected?.ordinal !== frame.ordinal || frame.bytes !== expected.bytes || frame.content.byteLength !== expected.bytes || sha256Hex(frame.content) !== expected.sha256) {
        refuse("update_construction_output_frame", this.#root);
      }
      this.#dependencies.screen(frame.content);
      while (this.#plan(plan).journal.nextOutputFrame === expected.ordinal) {
        const journal = this.#plan(plan).journal;
        const consumer = expected.consumers[journal.nextOutputConsumer];
        if (consumer === undefined) return refuse("update_construction_output_frame", this.#root);
        if (consumer.kind === "construction_file") {
          await this.#stageRow(plan, plan.files[consumer.ordinal] as UpdateConstructionFilePlanV1, frame.content);
        } else {
          await this.#dependencies.sources.consumeRollbackEntry(plan, consumer.ordinal, frame);
          await this.#advance(plan, { kind: "source_consumer_complete" });
        }
        this.#interrupt("output_consumer");
      }
    }
    if (this.#plan(plan).journal.nextOutputFrame !== plan.outputFrames.length) refuse("update_construction_output_frame", this.#root);
  }

  /** Publishes the exact outer plan, then its initial journal; completing the journal is handoff. */
  async publishOuter(plan: UpdateConstructionPlanV1, outer: UpdateConstructionOuterBytesV1): Promise<void> {
    for (const [path, bytes] of [[plan.outerPlanPath, outer.plan], [plan.outerJournalPath, outer.journal]] as const) {
      if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_LEAF_PLAN_BYTES) refuse("update_construction_outer_bound", path);
      this.#dependencies.screen(bytes);
      const file: UpdateConstructionOuterFileV1 = { path, bytes: bytes.byteLength, sha256: sha256Hex(bytes), mode: 384 };
      const parent = await this.#ownedDirectory(lifecycleParentPath(path));
      await this.#advance(plan, { kind: "outer_intent", file });
      const created = await this.#createEmpty(path, 0o600);
      try {
        await this.#advance(plan, { kind: "outer_created", dev: created.entry.dev, ino: created.entry.ino });
        this.#interrupt("outer_created");
        await writeAll(created.handle, bytes);
        this.#interrupt("outer_written");
      } finally {
        await created.handle.close();
      }
      await this.#verifyWritten(created.entry, file.bytes, file.sha256, 0o600);
      await this.#dependencies.fs.syncDirectory(parent);
      await this.#advance(plan, { kind: "outer_complete" });
    }
  }

  async #ownedDirectory(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry?.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid || entry.mode !== 0o700) return refuse("update_construction_parent", path);
    return entry;
  }

  async #readPlan(expectedHash: LowerHexSha256 | null): Promise<UpdateConstructionPlanV1> {
    const entry = await this.#dependencies.fs.lstat(this.#paths.plan);
    if (entry === null || !isBoundedRegular(entry, this.#dependencies.effectiveUid, 0o600, MAXIMUM_CONSTRUCTION_PLAN_BYTES)) return refuse("update_construction_plan", this.#paths.plan);
    const bytes = await this.#dependencies.fs.readRegular(entry, MAXIMUM_CONSTRUCTION_PLAN_BYTES);
    const plan = decodeExact(bytes, MAXIMUM_CONSTRUCTION_PLAN_BYTES, this.#paths.plan) as UpdateConstructionPlanV1;
    validateConstructionBijections(plan);
    if (plan.stagingRoot.path !== this.#root || (expectedHash !== null && constructionPlanHash(plan) !== expectedHash)) refuse("update_construction_plan", this.#paths.plan);
    await this.#rootEntry(plan);
    return plan;
  }

  async #loadJournal(plan: UpdateConstructionPlanV1): Promise<CurrentJournal> {
    const entry = await this.#dependencies.fs.lstat(this.#paths.journal);
    if (entry === null || !isBoundedRegular(entry, this.#dependencies.effectiveUid, 0o600, plan.maximumJournalBytes)) return refuse("update_construction_journal", this.#paths.journal);
    const bytes = await this.#dependencies.fs.readRegular(entry, plan.maximumJournalBytes);
    const journal = validateConstructionJournal(decodeExact(bytes, plan.maximumJournalBytes, this.#paths.journal), plan);
    this.#current = { plan, journal, entry };
    return this.#current;
  }

  /** Unlinks one recorded temp or attempt-created file after owner/mode/link/size checks; absence is done. */
  async #removeFile(path: CanonicalAbsolutePathV1, mode: number, maximumBytes: number, identity: { readonly dev: string; readonly ino: string } | null): Promise<void> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return;
    if (!isBoundedRegular(entry, this.#dependencies.effectiveUid, mode, maximumBytes) || (identity !== null && !sameInode(entry, identity.dev, identity.ino))) refuse("update_construction_unbound", path);
    const parent = await this.#ownedDirectory(lifecycleParentPath(path));
    await this.#dependencies.fs.unlinkExact(entry);
    await this.#dependencies.fs.syncDirectory(parent);
  }

  /**
   * Spec 2 §9.2 pre-handoff recovery for the `update_construction_cleanup` closure. It never
   * resumes a write, never calls the planner or network, and removes only recorded inodes.
   */
  async recover(closure: UpdateConstructionClosureV1): Promise<void> {
    if (this.#root.slice(this.#root.lastIndexOf("/") + 1) !== closure.coordinatorId) refuse("update_construction_closure", this.#root);
    const construction = closure.construction;
    if (construction.frontier === "plan_pending") {
      const root = await this.#rootEntry(null);
      const names = await this.#children(root);
      if (names.length !== 1 || names[0] !== "update-construction.plan.pending") refuse("update_construction_closure", this.#root);
      await this.#removeFile(this.#paths.planPending, 0o600, MAXIMUM_CONSTRUCTION_PLAN_BYTES + 1, null);
      return;
    }
    const plan = await this.#readPlan(construction.constructionPlanHash);
    if (plan.operation !== construction.operation) refuse("update_construction_closure", this.#root);
    const names = await this.#children(await this.#rootEntry(plan));
    if (construction.frontier === "journal_bootstrap") {
      const pending = construction.journal === "pending" ? ["update-construction.journal.pending"] : [];
      if (names.join("/") !== [...pending, "update-construction.plan.json"].sort().join("/")) refuse("update_construction_closure", this.#root);
      if (construction.journal === "pending") await this.#removeJournalPrefix(plan);
      await this.removeEnvelope(plan);
      return;
    }
    if (construction.frontier === "plan_only_suffix") {
      if (names.join("/") !== "update-construction.plan.json") refuse("update_construction_closure", this.#root);
      await this.removeEnvelope(plan);
      return;
    }
    await this.#removeRewriteTemp(plan);
    const { journal } = await this.#loadJournal(plan);
    if (!isPreHandoffConstructionPhase(journal.phase) && journal.phase !== "compensating" && journal.phase !== "rolled_back") refuse("update_construction_handed_off", this.#root);
    await this.#compensate(plan);
  }

  /**
   * A rewrite temp never took effect: its transition's filesystem step follows the rename, and a
   * created-but-unrecorded inode is bound from its `create_intent`. A complete temp must still be
   * a valid journal of this plan; a partial one is removed after owner/mode/link/size checks.
   */
  async #removeRewriteTemp(plan: UpdateConstructionPlanV1): Promise<void> {
    const path = this.#paths.journalRewritePending;
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return;
    if (!isBoundedRegular(entry, this.#dependencies.effectiveUid, 0o600, plan.maximumJournalBytes)) refuse("update_construction_unbound", path);
    const bytes = await this.#dependencies.fs.readRegular(entry, plan.maximumJournalBytes);
    if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0a) validateConstructionJournal(decodeExact(bytes, plan.maximumJournalBytes, path), plan);
    await this.#removeFile(path, 0o600, plan.maximumJournalBytes, entry);
  }

  /** The initial-journal temp may only be an exact prefix of the one plan-derived initial journal. */
  async #removeJournalPrefix(plan: UpdateConstructionPlanV1): Promise<void> {
    const expected = constructionJournalBytes(initialConstructionJournal(plan));
    const entry = await this.#dependencies.fs.lstat(this.#paths.journalPending);
    if (entry === null || !isBoundedRegular(entry, this.#dependencies.effectiveUid, 0o600, expected.byteLength)) return refuse("update_construction_unbound", this.#paths.journalPending);
    const bytes = await this.#dependencies.fs.readRegular(entry, expected.byteLength);
    if (Buffer.compare(bytes, expected.subarray(0, bytes.byteLength)) !== 0) refuse("update_construction_unbound", this.#paths.journalPending);
    await this.#removeFile(this.#paths.journalPending, 0o600, expected.byteLength, entry);
  }

  /**
   * A `create_intent` whose path is present binds only the exact empty attempt-created object;
   * its identity is persisted before compensation may remove it.
   */
  async #bindIntents(plan: UpdateConstructionPlanV1): Promise<void> {
    const { fs, effectiveUid } = this.#dependencies;
    let journal = this.#plan(plan).journal;
    if (journal.directoryWriteState?.state === "create_intent") {
      const directory = plan.directories[journal.nextDirectory] as UpdateConstructionPlanV1["directories"][number];
      const entry = await fs.lstat(directory.path);
      if (entry !== null) {
        if (entry.kind !== "directory" || entry.ownerUid !== effectiveUid || entry.mode !== 0o700) refuse("update_construction_unbound", directory.path);
        await this.#parentEntry(plan, journal, directory.parent);
        if ((await this.#children(entry)).length !== 0) refuse("update_construction_unbound", directory.path);
        journal = await this.#advance(plan, { kind: "directory_created", dev: entry.dev, ino: entry.ino });
      }
    }
    const state = journal.fileWriteState;
    if (state?.state === "create_intent" || state?.state === "evidence_intent") {
      const row = plan.files[state.ordinal] as UpdateConstructionFilePlanV1;
      const evidence = state.state === "evidence_intent";
      const path = evidence ? updateConstructionEvidencePath(plan.stagingRoot.path, row.ordinal) : row.path;
      const entry = await fs.lstat(path);
      if (entry !== null) {
        if (!isBoundedRegular(entry, effectiveUid, evidence ? 0o600 : row.mode, 0)) refuse("update_construction_unbound", path);
        journal = await this.#advance(plan, evidence ? { kind: "evidence_created", dev: entry.dev, ino: entry.ino } : { kind: "file_created", dev: entry.dev, ino: entry.ino });
      }
    }
    const outer = journal.outerJournalWriteState !== null ? journal.outerJournal : journal.outerPlan;
    const outerState = journal.outerJournalWriteState ?? journal.outerPlanWriteState;
    if (outer !== null && outerState?.state === "create_intent") {
      const entry = await fs.lstat(outer.path);
      if (entry !== null) {
        if (!isBoundedRegular(entry, effectiveUid, 0o600, 0)) refuse("update_construction_unbound", outer.path);
        await this.#advance(plan, { kind: "outer_created", dev: entry.dev, ino: entry.ino });
      }
    }
  }

  /** Nested sources first, then outer files, then files/evidence and directories in exact reverse. */
  async #compensate(plan: UpdateConstructionPlanV1): Promise<void> {
    if (isPreHandoffConstructionPhase(this.#plan(plan).journal.phase)) {
      await this.#bindIntents(plan);
      await this.#advance(plan, { kind: "compensate" });
    }
    if (this.#plan(plan).journal.phase === "compensating") {
      await this.#dependencies.sources.compensateSources(plan, this.#plan(plan).journal);
      await this.#removeOuter(this.#plan(plan).journal);
    }
    for (let journal = this.#plan(plan).journal; journal.phase === "compensating"; journal = this.#plan(plan).journal) {
      const ordinal = journal.compensationNext as number;
      if (ordinal >= 0) await this.#compensateRow(plan, journal, ordinal, journal.compensationPart === "evidence");
      else if ((journal.compensationDirectoryNext as number) >= 0) await this.#removeDirectory(plan, journal, journal.compensationDirectoryNext as number);
      await this.#advance(plan, { kind: "compensation_step" });
      this.#interrupt("compensation_step");
    }
    await this.removeEnvelope(plan);
  }

  async #removeOuter(journal: UpdateConstructionJournalV1): Promise<void> {
    const slots = [
      [journal.outerJournal, journal.outerJournalIdentity ?? journal.outerJournalWriteState],
      [journal.outerPlan, journal.outerPlanIdentity ?? journal.outerPlanWriteState],
    ] as const;
    for (const [file, recorded] of slots) {
      if (file === null || recorded === null || !("dev" in recorded)) continue;
      await this.#removeFile(file.path, 0o600, file.bytes, recorded);
    }
  }

  /** The in-flight row's identity comes from the write state; a completed row's from its evidence. */
  async #compensateRow(plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1, ordinal: number, evidencePart: boolean): Promise<void> {
    const row = plan.files[ordinal] as UpdateConstructionFilePlanV1;
    const evidencePath = updateConstructionEvidencePath(plan.stagingRoot.path, ordinal);
    const inFlight = journal.fileWriteState?.ordinal === ordinal ? journal.fileWriteState : null;
    if (evidencePart) {
      if (inFlight !== null) {
        if (inFlight.state === "evidence_created") await this.#removeFile(evidencePath, 0o600, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES, { dev: inFlight.evidenceDev, ino: inFlight.evidenceIno });
        return;
      }
      await this.#removeEvidence(plan, ordinal, evidencePath);
      return;
    }
    let identity: { readonly dev: string; readonly ino: string } | null;
    if (inFlight !== null) identity = inFlight.state === "create_intent" ? null : inFlight;
    else identity = await this.#evidencedIdentity(plan, ordinal, evidencePath);
    // With the evidence already gone the target was removed first; absence is then the only legal state.
    if (identity === null) {
      if ((await this.#dependencies.fs.lstat(row.path)) !== null) refuse("update_construction_unbound", row.path);
      return;
    }
    await this.#removeFile(row.path, row.mode, compensationCap(row), identity);
  }

  async #evidencedIdentity(plan: UpdateConstructionPlanV1, ordinal: number, evidencePath: CanonicalAbsolutePathV1): Promise<{ readonly dev: string; readonly ino: string } | null> {
    const entry = await this.#dependencies.fs.lstat(evidencePath);
    if (entry === null) return null;
    if (!isBoundedRegular(entry, this.#dependencies.effectiveUid, 0o600, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES)) return refuse("update_construction_unbound", evidencePath);
    return validateConstructionFileEvidence(await this.#dependencies.fs.readRegular(entry, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES), plan, ordinal);
  }

  async #removeEvidence(plan: UpdateConstructionPlanV1, ordinal: number, evidencePath: CanonicalAbsolutePathV1): Promise<void> {
    const entry = await this.#dependencies.fs.lstat(evidencePath);
    if (entry === null) return;
    await this.#evidencedIdentity(plan, ordinal, evidencePath);
    await this.#removeFile(evidencePath, 0o600, MAXIMUM_CONSTRUCTION_EVIDENCE_BYTES, entry);
  }

  async #removeDirectory(plan: UpdateConstructionPlanV1, journal: UpdateConstructionJournalV1, ordinal: number): Promise<void> {
    const { fs } = this.#dependencies;
    const directory = plan.directories[ordinal] as UpdateConstructionPlanV1["directories"][number];
    const inFlight = journal.directoryWriteState?.state === "created" && journal.directoryWriteState.ordinal === ordinal ? journal.directoryWriteState : null;
    const identity = inFlight ?? journal.directoryIdentities[ordinal];
    if (identity === undefined) return refuse("update_construction_unbound", directory.path);
    const expected = directoryEntry(directory.path, directory.ownerUid, identity.dev, identity.ino);
    const observed = await fs.lstat(directory.path);
    if (observed === null) return;
    if (!sameDirectory(observed, expected)) refuse("update_construction_unbound", directory.path);
    const parent = await this.#ownedDirectory(lifecycleParentPath(directory.path));
    await fs.rmdirExactEmpty(observed);
    await fs.syncDirectory(parent);
  }

  /**
   * Terminal compaction, legal only after the outer coordinator is terminal: files then their
   * evidence in reverse ordinal order, then recorded directories in reverse. A delegated row must
   * already be absent under its nested terminal evidence; construction deletes only the three
   * read-only leaves itself. The caller then runs `removeEnvelope`.
   */
  async compact(plan: UpdateConstructionPlanV1): Promise<void> {
    const current = this.#current?.plan === plan ? this.#current : await this.#loadJournal(plan);
    if (current.journal.phase === "handed_off") await this.#advance(plan, { kind: "compaction_step" });
    else if (current.journal.phase !== "compacting") refuse("update_construction_not_terminal", this.#root);
    const F = plan.files.length;
    for (let journal = this.#plan(plan).journal; (journal.compactionNext as number) < 2 * F || (journal.compactionDirectoryNext as number) < plan.directories.length; journal = this.#plan(plan).journal) {
      const cursor = journal.compactionNext as number;
      if (cursor < 2 * F) {
        const { ordinal, part } = constructionCompactionTarget(plan, cursor);
        await this.#compactRow(plan, plan.files[ordinal] as UpdateConstructionFilePlanV1, part);
      } else {
        await this.#removeDirectory(plan, journal, plan.directories.length - 1 - (journal.compactionDirectoryNext as number));
      }
      await this.#advance(plan, { kind: "compaction_step" });
      this.#interrupt("compaction_step");
    }
  }

  async #compactRow(plan: UpdateConstructionPlanV1, row: UpdateConstructionFilePlanV1, part: "file" | "evidence"): Promise<void> {
    const evidencePath = updateConstructionEvidencePath(plan.stagingRoot.path, row.ordinal);
    if (part === "evidence") {
      await this.#removeEvidence(plan, row.ordinal, evidencePath);
      return;
    }
    const target = await this.#dependencies.fs.lstat(row.path);
    if (constructionDeletionAuthority(row) === "nested") {
      if (target !== null || !(await this.#dependencies.sources.nestedTerminal(plan, row))) refuse("update_construction_nested_not_terminal", row.path);
      return;
    }
    // Evidence is removed only at the following odd cursor, so it must still be here.
    const identity = await this.#evidencedIdentity(plan, row.ordinal, evidencePath);
    if (identity === null) return refuse("update_construction_unbound", evidencePath);
    if (target === null) return;
    if (!sameInode(target, identity.dev, identity.ino) || !isBoundedRegular(target, this.#dependencies.effectiveUid, row.mode, row.bytes)) return refuse("update_construction_unbound", row.path);
    if ((await this.#dependencies.fs.hashRegular(target, BigInt(row.bytes))) !== row.sha256) refuse("update_construction_unbound", row.path);
    await this.#removeFile(row.path, row.mode, row.bytes, identity);
  }

  /**
   * The two fixed suffix actions: guarded-unlink the terminal journal, then the immutable plan.
   * Journal absent with the plan present is the only admitted crash state between them.
   */
  async removeEnvelope(plan: UpdateConstructionPlanV1): Promise<void> {
    const journalEntry = await this.#dependencies.fs.lstat(this.#paths.journal);
    if (journalEntry !== null) {
      const { journal } = await this.#loadJournal(plan);
      const compacted = journal.phase === "compacting" && journal.compactionNext === 2 * plan.files.length && journal.compactionDirectoryNext === plan.directories.length;
      if (journal.phase !== "rolled_back" && !compacted) refuse("update_construction_not_terminal", this.#paths.journal);
      await this.#removeFile(this.#paths.journal, 0o600, plan.maximumJournalBytes, this.#plan(plan).entry);
    }
    const planEntry = await this.#dependencies.fs.lstat(this.#paths.plan);
    if (planEntry !== null) {
      if (constructionPlanHash(await this.#readPlan(null)) !== constructionPlanHash(plan)) refuse("update_construction_plan", this.#paths.plan);
      await this.#removeFile(this.#paths.plan, 0o600, MAXIMUM_CONSTRUCTION_PLAN_BYTES, planEntry);
    }
    this.#current = null;
  }
}
