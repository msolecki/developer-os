import {
  advanceRollbackPayloadSourceJournal,
  decodeCanonicalJson,
  durableEntryEvidenceBytes,
  durableRollbackSourceEntryEvidence,
  encodeCanonicalJson,
  MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  MAXIMUM_SOURCE_READY_EVIDENCE_BYTES,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  rollbackEntryParentStructure,
  rollbackPayloadSourceCompactionTarget,
  rollbackPayloadSourceJournalBytes,
  rollbackPayloadSourcePaths,
  rollbackPayloadSourceReadyEvidence,
  rollbackPayloadSourceReadyEvidenceBytes,
  rollbackPayloadSourceStructures,
  rollbackSourceEntriesProjectionHash,
  rollbackSourceEntryPath,
  rollbackSourceEvidencePath,
  updateParticipantJournalPath,
  updateSourceEvidenceSetHash,
  validateDurableRollbackSourceEntryEvidence,
  validateRollbackPayloadInventory,
  validateRollbackPayloadSourceJournal,
  validateRollbackPayloadSourceStagingPlan,
  type BundleRelativePathV1,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LifecycleGuardedEntryV1,
  type LowerHexSha256,
  type ReleaseBundleEntryV1,
  type RollbackPayloadEntryV1,
  type RollbackPayloadSourceReadyEvidenceV1,
  type RollbackPayloadSourceStagingJournalV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadSourceStepV1,
  type SecretScreenedBlobV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionRollbackEntrySourceV1,
  type UpdateConstructionRollbackSourceEntryV1,
  type UpdateEntryWriteStateV1,
} from "@developer-os/core";

import {
  bindEntryIntent,
  BundleGuardedIo,
  BundleJournalFile,
  refuseBundle,
  removeBundleEntryPart,
  sameInode,
  sha256Hex,
  stampAfter,
  writeAll,
  writeEntryEvidence,
  type BundleEntryDeathPointV1,
  type BundleParticipantDependenciesV1,
} from "./bundle-source.js";

export type RollbackSourceDeathPointV1 = BundleEntryDeathPointV1 | "structure_made" | "metadata_created" | "metadata_written" | "ready_created" | "ready_written" | "ready_removed";

export const ROLLBACK_SOURCE_DEATH_POINTS: readonly RollbackSourceDeathPointV1[] = Object.freeze([
  "journal_rewritten",
  "structure_made",
  "metadata_created",
  "metadata_written",
  "entry_created",
  "entry_written",
  "evidence_created",
  "evidence_written",
  "ready_created",
  "ready_written",
  "ready_removed",
  "compensation_step",
  "compaction_step",
]);

/** The bound inverse-plan and inventory bytes the originating process derived for this payload. */
export interface RollbackSourceDocumentsV1 {
  readonly inversePlan: Uint8Array;
  readonly inventory: Uint8Array;
}

type Journal = BundleJournalFile<RollbackPayloadSourceStagingJournalV1>;

/** Source structure ordinal = publication structure ordinal + the envelope, payload, and evidence roots. */
const SOURCE_STRUCTURE_OFFSET = 2;
const encoder = new TextEncoder();
const PROJECTED = new WeakMap<object, LowerHexSha256>();

/** A payload entry in the bundle entry shape the shared copy/removal helpers take: an owner-only file. */
export function rollbackEntryAsFile(entry: RollbackPayloadEntryV1): Extract<ReleaseBundleEntryV1, { readonly kind: "file" }> {
  return { path: entry.path as unknown as BundleRelativePathV1, kind: "file", mode: 384, bytes: parseUInt64Decimal(entry.bytes.toString(10)), sha256: entry.sha256 };
}

/**
 * The construction plan's `rollbackSource`, accepted only when its ID, payload, binding, inventory,
 * count, and recomputed entries projection all equal the compact source plan.
 */
export function rollbackSourceEntries(plan: RollbackPayloadSourceStagingPlanV1, construction: UpdateConstructionPlanV1): readonly UpdateConstructionRollbackSourceEntryV1[] {
  const source = construction.rollbackSource;
  if (
    source === null || construction.coordinatorId !== plan.coordinatorId || source.sourcePlanId !== plan.id || source.payloadId !== plan.payloadId
    || source.rollbackBindingHash !== plan.rollbackBindingHash || source.inventoryHash !== plan.inventoryHash || source.entries.length !== plan.entryCount
    || source.entriesProjectionHash !== plan.entriesProjectionHash
  ) {
    return refuseBundle("rollback_source_authority", plan.sourceRoot);
  }
  // The immutable construction object is recomputed once, not once per planner frame.
  if (PROJECTED.get(source) !== plan.entriesProjectionHash) {
    if (rollbackSourceEntriesProjectionHash(source) !== plan.entriesProjectionHash) return refuseBundle("rollback_source_authority", plan.sourceRoot);
    PROJECTED.set(source, plan.entriesProjectionHash);
  }
  return source.entries;
}

/** Recomputes the evidence-set hash over the exact, complete, contiguous evidence files. */
export async function rollbackSourceEvidenceSetHash(io: BundleGuardedIo, plan: RollbackPayloadSourceStagingPlanV1, entries: readonly RollbackPayloadEntryV1[]): Promise<LowerHexSha256> {
  if (entries.length !== plan.entryCount) return refuseBundle("rollback_source_entries", plan.sourceRoot);
  const hashes: LowerHexSha256[] = [];
  for (const entry of entries) {
    const path = rollbackSourceEvidencePath(plan, entry.ordinal);
    const found = await io.readBounded(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    if (found === null) return refuseBundle("rollback_source_evidence_missing", path);
    const evidence = validateDurableRollbackSourceEntryEvidence(found.bytes, plan, entry);
    const target = await io.fs.lstat(rollbackSourceEntryPath(plan, entry));
    if (target === null || !sameInode(target, evidence)) refuseBundle("rollback_source_identity", rollbackSourceEntryPath(plan, entry));
    hashes.push(sha256Hex(found.bytes));
  }
  return updateSourceEvidenceSetHash(hashes);
}

/**
 * Spec 2 §9.2's rollback-payload source envelope under `update/source/rollback/<payload-id>`,
 * staged before any outer intent: seven structures, the bound inverse plan and inventory, then every
 * inventory entry from its one construction authority (a planner frame, a guarded preimage, or a
 * plan-derived retained leaf), then ready evidence. Every inode is journaled before byte zero;
 * after process death only `compensate` runs.
 */
export class RollbackPayloadSourceExecutor {
  readonly #dependencies: BundleParticipantDependenciesV1<RollbackSourceDeathPointV1>;
  readonly #io: BundleGuardedIo;
  readonly #root: CanonicalAbsolutePathV1;

  constructor(dependencies: BundleParticipantDependenciesV1<RollbackSourceDeathPointV1>, stagingRoot: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#io = new BundleGuardedIo(dependencies.fs, dependencies.effectiveUid);
    this.#root = parseCanonicalAbsolutePathText(stagingRoot);
  }

  #interrupt(point: RollbackSourceDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  async #open(value: RollbackPayloadSourceStagingPlanV1): Promise<{ readonly plan: RollbackPayloadSourceStagingPlanV1; readonly file: Journal }> {
    const plan = validateRollbackPayloadSourceStagingPlan(value, this.#root);
    const file = new BundleJournalFile<RollbackPayloadSourceStagingJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "rollback_payload_source", plan.id), plan.maximumJournalBytes);
    await file.load((input) => validateRollbackPayloadSourceJournal(input, plan));
    return { plan, file };
  }

  async #advance(plan: RollbackPayloadSourceStagingPlanV1, file: Journal, step: RollbackPayloadSourceStepV1): Promise<RollbackPayloadSourceStagingJournalV1> {
    const current = file.value as RollbackPayloadSourceStagingJournalV1;
    const next = advanceRollbackPayloadSourceJournal(plan, current, step, stampAfter(this.#dependencies.now, current.updatedAt));
    await file.write(next, rollbackPayloadSourceJournalBytes(next));
    this.#interrupt("journal_rewritten");
    return next;
  }

  async #structure(journal: RollbackPayloadSourceStagingJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const identity = journal.structureIdentities[ordinal];
    if (identity === undefined) return refuseBundle("rollback_source_structure", this.#root);
    return this.#io.ownedDirectory(identity.path, identity);
  }

  /** `update/source/rollback` for the envelope; then envelope, payload root, and `payload/plans`. */
  async #structureParent(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    if (ordinal === 0) return this.#io.ownedDirectory(rollbackPayloadSourcePaths(this.#root, plan.payloadId).parent, { dev: plan.sourceParentDev, ino: plan.sourceParentIno });
    return this.#structure(journal, [0, 0, 0, 1, 3, 3, 1][ordinal] as number);
  }

  /**
   * Structures, then the two bound documents. Legal only from the construction-published initial
   * journal in the originating process, after the construction authority is resolved.
   */
  async prepare(value: RollbackPayloadSourceStagingPlanV1, construction: UpdateConstructionPlanV1, documents: RollbackSourceDocumentsV1): Promise<void> {
    const { plan, file } = await this.#open(value);
    if ((file.value as RollbackPayloadSourceStagingJournalV1).phase !== "planned") refuseBundle("rollback_source_not_fresh", file.path);
    const entries = rollbackSourceEntries(plan, construction);
    const bytes = [documents.inversePlan, documents.inventory];
    plan.metadata.forEach((row, ordinal) => {
      const document = bytes[ordinal] as Uint8Array;
      if (document.byteLength !== row.bytes || sha256Hex(document) !== row.sha256) refuseBundle("rollback_source_document", row.path);
    });
    const inventory = validateRollbackPayloadInventory(decodeCanonicalJson(documents.inventory, MAXIMUM_ROLLBACK_DOCUMENT_BYTES));
    if (inventory.payloadId !== plan.payloadId || inventory.rollbackBindingHash !== plan.rollbackBindingHash || inventory.inversePlanHash !== plan.inversePlanHash || inventory.aggregateBytes !== plan.aggregateBytes
      || encodeCanonicalJson(inventory.entries as unknown as CanonicalJsonValue) !== encodeCanonicalJson(entries.map((row) => row.entry) as unknown as CanonicalJsonValue)) {
      refuseBundle("rollback_source_inventory", plan.sourceRoot);
    }
    const structures = rollbackPayloadSourceStructures(plan);
    for (let journal = file.value as RollbackPayloadSourceStagingJournalV1; journal.nextStructure < structures.length; journal = file.value as RollbackPayloadSourceStagingJournalV1) {
      const parent = await this.#structureParent(plan, journal, journal.nextStructure);
      await this.#advance(plan, file, { kind: "structure_intent" });
      const created = await this.#io.fs.mkdirExclusive((structures[journal.nextStructure] as (typeof structures)[number]).path);
      this.#interrupt("structure_made");
      await this.#io.fs.syncDirectory(parent);
      await this.#advance(plan, file, { kind: "structure_created", dev: created.dev, ino: created.ino });
      await this.#advance(plan, file, { kind: "structure_complete" });
    }
    for (let journal = file.value as RollbackPayloadSourceStagingJournalV1; journal.nextMetadata < 2; journal = file.value as RollbackPayloadSourceStagingJournalV1) {
      const row = plan.metadata[journal.nextMetadata] as RollbackPayloadSourceStagingPlanV1["metadata"][number];
      const parent = await this.#structure(journal, 1);
      await this.#advance(plan, file, { kind: "metadata_intent" });
      const created = await this.#io.createEmpty(row.path, 0o600);
      try {
        await this.#advance(plan, file, { kind: "metadata_created", dev: created.entry.dev, ino: created.entry.ino });
        this.#interrupt("metadata_created");
        await writeAll(created.handle, bytes[journal.nextMetadata] as Uint8Array);
        this.#interrupt("metadata_written");
      } finally {
        await created.handle.close();
      }
      await this.#io.verifyWritten(created.entry, row.bytes, row.sha256, 0o600);
      await this.#io.fs.syncDirectory(parent);
      await this.#advance(plan, file, { kind: "metadata_complete" });
    }
  }

  /**
   * One planner frame's rollback consumer: every lower non-planner ordinal first, then this entry
   * from the frame. Frames arrive in ordinal order, so a consumer below the cursor is out of order.
   */
  async consume(value: RollbackPayloadSourceStagingPlanV1, construction: UpdateConstructionPlanV1, ordinal: number, frame: SecretScreenedBlobV1): Promise<void> {
    const { plan, file } = await this.#open(value);
    const entries = rollbackSourceEntries(plan, construction);
    this.#requireStaging(file);
    await this.#stageThrough(plan, file, entries, ordinal);
    const row = entries[ordinal];
    const journal = file.value as RollbackPayloadSourceStagingJournalV1;
    if (row?.source.kind !== "planner_output" || row.source.ordinal !== frame.ordinal || journal.nextEntry !== ordinal) return refuseBundle("rollback_source_frame_order", plan.sourceRoot);
    if (frame.content.byteLength !== row.entry.bytes || sha256Hex(frame.content) !== row.entry.sha256) refuseBundle("rollback_source_frame", plan.sourceRoot);
    await this.#stageEntry(plan, file, row.entry, frame.content);
  }

  /** The remaining non-planner entries, then ready evidence over the exact complete evidence set. */
  async finish(value: RollbackPayloadSourceStagingPlanV1, construction: UpdateConstructionPlanV1): Promise<RollbackPayloadSourceReadyEvidenceV1> {
    const { plan, file } = await this.#open(value);
    const entries = rollbackSourceEntries(plan, construction);
    this.#requireStaging(file);
    await this.#stageThrough(plan, file, entries, entries.length);
    return this.#publishReady(plan, file, entries.map((row) => row.entry));
  }

  #requireStaging(file: Journal): void {
    const journal = file.value as RollbackPayloadSourceStagingJournalV1;
    if (journal.phase !== "payload_staging" || journal.entryWriteState !== null || journal.readyWriteState !== null) refuseBundle("rollback_source_not_staging", file.path);
  }

  async #stageThrough(plan: RollbackPayloadSourceStagingPlanV1, file: Journal, entries: readonly UpdateConstructionRollbackSourceEntryV1[], end: number): Promise<void> {
    if ((file.value as RollbackPayloadSourceStagingJournalV1).nextEntry > end) refuseBundle("rollback_source_frame_order", plan.sourceRoot);
    for (let journal = file.value as RollbackPayloadSourceStagingJournalV1; journal.nextEntry < end; journal = file.value as RollbackPayloadSourceStagingJournalV1) {
      const row = entries[journal.nextEntry] as UpdateConstructionRollbackSourceEntryV1;
      await this.#stageEntry(plan, file, row.entry, await this.#entryBytes(row.entry, row.source));
    }
  }

  /** The unique bytes of a non-planner authority, reopened and rechecked before any create. */
  async #entryBytes(entry: RollbackPayloadEntryV1, source: UpdateConstructionRollbackEntrySourceV1): Promise<Uint8Array> {
    let bytes: Uint8Array;
    if (source.kind === "plan_derived") bytes = encoder.encode(source.value);
    else if (source.kind === "guarded_preimage") {
      const found = await this.#io.fs.lstat(source.path);
      if (!this.#io.isBoundedRegular(found, source.mode, source.bytes) || found.ownerUid !== source.ownerUid || found.size !== source.bytes.toString(10) || !sameInode(found, source)) return refuseBundle("rollback_source_preimage_changed", source.path);
      bytes = await this.#io.fs.readRegular(found, source.bytes);
    } else return refuseBundle("rollback_source_frame_order", source.kind);
    if (bytes.byteLength !== entry.bytes || sha256Hex(bytes) !== entry.sha256) refuseBundle("rollback_source_authority_changed", entry.path);
    return bytes;
  }

  /** `entry_intent` → exclusive create → recorded inode → bytes → reopen → evidence → advance. */
  async #stageEntry(plan: RollbackPayloadSourceStagingPlanV1, file: Journal, entry: RollbackPayloadEntryV1, bytes: Uint8Array): Promise<void> {
    const journal = file.value as RollbackPayloadSourceStagingJournalV1;
    if (entry.ordinal !== journal.nextEntry) refuseBundle("rollback_source_frame_order", plan.sourceRoot);
    const targetParent = await this.#structure(journal, rollbackEntryParentStructure(entry) + SOURCE_STRUCTURE_OFFSET);
    const evidenceParent = await this.#structure(journal, 2);
    const advance = async (step: RollbackPayloadSourceStepV1): Promise<void> => {
      await this.#advance(plan, file, step);
    };
    await advance({ kind: "entry_intent" });
    const target = await this.#io.createEmpty(rollbackSourceEntryPath(plan, entry), 0o600);
    try {
      await advance({ kind: "entry_created", dev: target.entry.dev, ino: target.entry.ino });
      this.#interrupt("entry_created");
      await writeAll(target.handle, bytes);
      this.#interrupt("entry_written");
    } finally {
      await target.handle.close();
    }
    const created = await this.#io.verifyWritten(target.entry, entry.bytes, entry.sha256, 0o600);
    await this.#io.fs.syncDirectory(targetParent);
    await writeEntryEvidence({
      io: this.#io,
      evidencePath: rollbackSourceEvidencePath(plan, entry.ordinal),
      evidenceParent,
      evidenceBytes: (dev, ino) => durableEntryEvidenceBytes(durableRollbackSourceEntryEvidence(plan, entry, dev, ino)),
      advance,
      interrupt: (point) => {
        this.#interrupt(point);
      },
    }, created);
  }

  async #publishReady(plan: RollbackPayloadSourceStagingPlanV1, file: Journal, entries: readonly RollbackPayloadEntryV1[]): Promise<RollbackPayloadSourceReadyEvidenceV1> {
    const evidence = rollbackPayloadSourceReadyEvidence(plan, file.value as RollbackPayloadSourceStagingJournalV1, await rollbackSourceEvidenceSetHash(this.#io, plan, entries));
    const bytes = rollbackPayloadSourceReadyEvidenceBytes(evidence);
    const paths = rollbackPayloadSourcePaths(this.#root, plan.payloadId);
    const parent = await this.#io.ownedDirectory(paths.parent, { dev: plan.sourceParentDev, ino: plan.sourceParentIno });
    await this.#advance(plan, file, { kind: "ready_intent" });
    const ready = await this.#io.createEmpty(paths.ready, 0o600);
    try {
      await this.#advance(plan, file, { kind: "ready_created", dev: ready.entry.dev, ino: ready.entry.ino });
      this.#interrupt("ready_created");
      await writeAll(ready.handle, bytes);
      this.#interrupt("ready_written");
    } finally {
      await ready.handle.close();
    }
    await this.#io.verifyWritten(ready.entry, bytes.byteLength, sha256Hex(bytes), 0o600);
    await this.#io.fs.syncDirectory(parent);
    await this.#advance(plan, file, { kind: "ready_complete" });
    return evidence;
  }

  /** Binds each current intent to the exact empty crash frontier, recording its identity first. */
  async #bindIntents(plan: RollbackPayloadSourceStagingPlanV1, file: Journal, entries: readonly RollbackPayloadEntryV1[] | null): Promise<void> {
    const journal = file.value as RollbackPayloadSourceStagingJournalV1;
    if (journal.structureWriteState?.state === "create_intent") {
      const path = (rollbackPayloadSourceStructures(plan)[journal.nextStructure] as { readonly path: CanonicalAbsolutePathV1 }).path;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (found.kind !== "directory" || found.ownerUid !== this.#io.uid || found.mode !== 0o700 || !(await this.#io.emptyDirectory(found))) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "structure_created", dev: found.dev, ino: found.ino });
      }
    }
    const metadata = (file.value as RollbackPayloadSourceStagingJournalV1).metadataWriteState;
    if (metadata?.state === "create_intent") {
      const path = (plan.metadata[metadata.ordinal] as { readonly path: CanonicalAbsolutePathV1 }).path;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (!this.#io.isBoundedRegular(found, 0o600, 0)) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "metadata_created", dev: found.dev, ino: found.ino });
      }
    }
    const state = (file.value as RollbackPayloadSourceStagingJournalV1).entryWriteState;
    if (state !== null) {
      const entry = entries?.[state.ordinal];
      if (entry === undefined) return refuseBundle("rollback_source_entries", plan.sourceRoot);
      const step = await bindEntryIntent(this.#io, state, rollbackEntryAsFile(entry), rollbackSourceEntryPath(plan, entry), rollbackSourceEvidencePath(plan, state.ordinal));
      if (step !== null) await this.#advance(plan, file, step);
    }
    if ((file.value as RollbackPayloadSourceStagingJournalV1).readyWriteState?.state === "create_intent") {
      const path = rollbackPayloadSourcePaths(this.#root, plan.payloadId).ready;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (!this.#io.isBoundedRegular(found, 0o600, 0)) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "ready_created", dev: found.dev, ino: found.ino });
      }
    }
  }

  /**
   * Compensation-only recovery for any reached prefix: ready evidence, then entries (entry, then
   * evidence) in reverse, then metadata and structures in reverse. It never resumes a write or adopts
   * an unrecorded path. Entry rows come from `construction`, or else from the source's own bound inventory.
   */
  async compensate(value: RollbackPayloadSourceStagingPlanV1, construction: UpdateConstructionPlanV1 | null): Promise<void> {
    const { plan, file } = await this.#open(value);
    const phase = (file.value as RollbackPayloadSourceStagingJournalV1).phase;
    if (phase === "rolled_back") return;
    if (phase === "compacting") refuseBundle("rollback_source_compacting", file.path);
    const reached = file.value as RollbackPayloadSourceStagingJournalV1;
    const entries = construction !== null
      ? rollbackSourceEntries(plan, construction).map((row) => row.entry)
      : reached.nextMetadata === 2 ? await this.#sourceInventory(plan, reached) : null;
    if (phase !== "compensating") {
      await this.#bindIntents(plan, file, entries);
      await this.#advance(plan, file, { kind: "compensate" });
    }
    const readyJournal = file.value as RollbackPayloadSourceStagingJournalV1;
    const ready = readyJournal.readyIdentity ?? (readyJournal.readyWriteState?.state === "created" ? readyJournal.readyWriteState : null);
    if (ready !== null || readyJournal.readyWriteState !== null) {
      if (ready !== null) await this.#io.removeFile(rollbackPayloadSourcePaths(this.#root, plan.payloadId).ready, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES, ready);
      await this.#advance(plan, file, { kind: "ready_removed" });
      this.#interrupt("ready_removed");
    }
    for (let journal = file.value as RollbackPayloadSourceStagingJournalV1; journal.phase === "compensating"; journal = file.value as RollbackPayloadSourceStagingJournalV1) {
      const at = journal.compensationNext as number;
      if (at >= 0) {
        const entry = entries?.[at];
        if (entry === undefined) return refuseBundle("rollback_source_entries", plan.sourceRoot);
        await this.#removeEntryPart(plan, entry, journal.compensationPart as "entry" | "evidence", journal.entryWriteState?.ordinal === at ? journal.entryWriteState : null);
      } else if (journal.compensationMetadataNext !== null && journal.compensationMetadataNext >= 0) {
        await this.#removeMetadata(plan, journal, journal.compensationMetadataNext);
      } else if ((journal.compensationStructureNext as number) >= 0) {
        await this.#removeStructure(plan, journal, journal.compensationStructureNext as number);
      }
      await this.#advance(plan, file, { kind: "compensation_step" });
      this.#interrupt("compensation_step");
    }
  }

  async #removeEntryPart(plan: RollbackPayloadSourceStagingPlanV1, entry: RollbackPayloadEntryV1, part: "entry" | "evidence", inFlight: UpdateEntryWriteStateV1 | null): Promise<void> {
    await removeBundleEntryPart(this.#io, {
      entry: rollbackEntryAsFile(entry),
      target: rollbackSourceEntryPath(plan, entry),
      evidencePath: rollbackSourceEvidencePath(plan, entry.ordinal),
      part,
      inFlight,
      evidencedIdentity: (bytes) => validateDurableRollbackSourceEntryEvidence(bytes, plan, entry),
    });
  }

  async #removeMetadata(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, ordinal: number): Promise<void> {
    const inFlight = journal.metadataWriteState?.state === "created" && journal.metadataWriteState.ordinal === ordinal ? journal.metadataWriteState : null;
    const identity = inFlight ?? journal.metadataIdentities[ordinal];
    const row = plan.metadata[ordinal] as RollbackPayloadSourceStagingPlanV1["metadata"][number];
    if (identity === undefined) return refuseBundle("bundle_unbound", row.path);
    await this.#io.removeFile(row.path, 0o600, row.bytes, identity);
  }

  async #removeStructure(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1, ordinal: number): Promise<void> {
    const inFlight = journal.structureWriteState?.state === "created" && journal.structureWriteState.ordinal === ordinal ? journal.structureWriteState : null;
    const identity = inFlight ?? journal.structureIdentities[ordinal];
    const path = (rollbackPayloadSourceStructures(plan)[ordinal] as { readonly path: CanonicalAbsolutePathV1 }).path;
    if (identity === undefined) return refuseBundle("bundle_unbound", path);
    await this.#io.removeDirectory(path, identity);
  }

  /**
   * Terminal compaction after the payload is published and verified: ready evidence, reverse entries
   * then evidence, metadata, then structures. Entry rows come from the source's own bound inventory.
   */
  async compact(value: RollbackPayloadSourceStagingPlanV1): Promise<void> {
    const { plan, file } = await this.#open(value);
    const phase = (file.value as RollbackPayloadSourceStagingJournalV1).phase;
    if (phase === "source_ready") await this.#advance(plan, file, { kind: "compaction_step" });
    else if (phase !== "compacting") refuseBundle("rollback_source_not_ready", file.path);
    const last = 2 * plan.entryCount + 10;
    let entries: readonly RollbackPayloadEntryV1[] | null = null;
    for (let journal = file.value as RollbackPayloadSourceStagingJournalV1; (journal.compactionNext as number) < last; journal = file.value as RollbackPayloadSourceStagingJournalV1) {
      const target = rollbackPayloadSourceCompactionTarget(plan, journal.compactionNext as number);
      if (target.kind === "ready") {
        await this.#io.removeFile(rollbackPayloadSourcePaths(this.#root, plan.payloadId).ready, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES, journal.readyIdentity);
      } else if (target.kind === "structure") {
        await this.#removeStructure(plan, journal, target.ordinal);
      } else if (target.kind === "metadata") {
        await this.#removeMetadata(plan, journal, target.ordinal);
      } else {
        entries ??= await this.#sourceInventory(plan, journal);
        const entry = entries[target.ordinal] as RollbackPayloadEntryV1;
        if (target.kind === "entry" && (await this.#io.fs.lstat(rollbackSourceEvidencePath(plan, target.ordinal))) === null) refuseBundle("bundle_unbound", rollbackSourceEvidencePath(plan, target.ordinal));
        await this.#removeEntryPart(plan, entry, target.kind, null);
      }
      await this.#advance(plan, file, { kind: "compaction_step" });
      this.#interrupt("compaction_step");
    }
  }

  /** The source's own identity-bound `inventory.json`, still present until the metadata cursors. */
  async #sourceInventory(plan: RollbackPayloadSourceStagingPlanV1, journal: RollbackPayloadSourceStagingJournalV1): Promise<readonly RollbackPayloadEntryV1[]> {
    const row = journal.metadataIdentities[1];
    if (row === undefined) return refuseBundle("rollback_source_inventory", plan.sourceRoot);
    const found = await this.#io.readBounded(row.path, 0o600, row.bytes);
    if (found === null || !sameInode(found.entry, row) || sha256Hex(found.bytes) !== plan.inventoryHash) return refuseBundle("rollback_source_inventory", row.path);
    return validateRollbackPayloadInventory(this.#io.decodeExact(found.bytes, MAXIMUM_ROLLBACK_DOCUMENT_BYTES, row.path)).entries;
  }
}
