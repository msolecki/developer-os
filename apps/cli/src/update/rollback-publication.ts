import {
  advanceRollbackPayloadPublicationJournal,
  decodeRollbackPayloadInventory,
  durableEntryEvidenceBytes,
  durableRollbackPublicationEntryEvidence,
  isRollbackPayloadPublicationForward,
  MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  MAXIMUM_SOURCE_READY_EVIDENCE_BYTES,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  productHomeOfStagingRoot,
  ROLLBACK_INVENTORY_NAME,
  ROLLBACK_INVERSE_PLAN_NAME,
  rollbackEntryParentStructure,
  rollbackPayloadMetadataPath,
  rollbackPayloadPublicationJournalBytes,
  rollbackPayloadRetirementLeaves,
  rollbackPayloadSourcePaths,
  rollbackPayloadStructures,
  rollbackPublicationCompactionOrdinal,
  rollbackPublicationEntryCount,
  rollbackPublicationEvidenceDirectory,
  rollbackPublicationEvidencePath,
  rollbackSourceEntryPath,
  rollbackSourceEvidencePath,
  updateLeafPlanHash,
  updateParticipantJournalPath,
  validateBoundedUpdateInversePlan,
  validateDurableRollbackPublicationEntryEvidence,
  validateDurableRollbackSourceEntryEvidence,
  validateRollbackPayloadPublicationJournal,
  validateRollbackPayloadSourceJournal,
  validateRollbackPayloadSourceReadyEvidence,
  validateRollbackPayloadSourceStagingPlan,
  validateRollbackPayloadStatePlan,
  type BundleRelativePathV1,
  type CanonicalAbsolutePathV1,
  type LifecycleGuardedEntryV1,
  type RollbackPayloadEntryV1,
  type RollbackPayloadIdentityV1,
  type RollbackPayloadInventoryV1,
  type RollbackPayloadPublicationJournalV1,
  type RollbackPayloadPublicationStepV1,
  type RollbackPayloadSourceStagingJournalV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadStatePlanV1,
  type UpdateDirectoryIdentityV1,
  type UpdatePublishedMetadataIdentityV1,
} from "@developer-os/core";

import {
  bindEntryIntent,
  BundleGuardedIo,
  BundleJournalFile,
  copyBundleEntry,
  parentPath,
  refuseBundle,
  removeBundleEntryPart,
  sameInode,
  sha256Hex,
  stampAfter,
  type BundleEntryDeathPointV1,
  type BundleParticipantDependenciesV1,
} from "./bundle-source.js";
import { rollbackEntryAsFile, rollbackSourceEvidenceSetHash } from "./rollback-source.js";

export type RollbackPublicationDeathPointV1 = BundleEntryDeathPointV1 | "structure_made" | "metadata_created" | "metadata_written" | "retired_leaf";

export const ROLLBACK_PUBLICATION_DEATH_POINTS: readonly RollbackPublicationDeathPointV1[] = Object.freeze([
  "journal_rewritten",
  "structure_made",
  "entry_created",
  "entry_written",
  "evidence_created",
  "evidence_written",
  "metadata_created",
  "metadata_written",
  "retired_leaf",
  "compensation_step",
  "compaction_step",
]);

/** What the coordinator step records after the participant returns. */
export interface RollbackPayloadObservationV1 {
  readonly phase: RollbackPayloadPublicationJournalV1["phase"];
  readonly structureIdentities: readonly UpdateDirectoryIdentityV1[];
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[];
}

interface StagedSource {
  readonly plan: RollbackPayloadSourceStagingPlanV1;
  readonly journal: RollbackPayloadSourceStagingJournalV1;
  readonly inventory: RollbackPayloadInventoryV1;
}

type Journal = BundleJournalFile<RollbackPayloadPublicationJournalV1>;

/** The parent of each publication structure: `<home>/rollback`, then root, root, `plans`, `plans`, root. */
const STRUCTURE_PARENTS = [-1, 0, 1, 1, 0] as const;
const PLAN_KIND_DIRECTORIES = ["owner_inverse", "schema_migration_inverse"] as const;

function observe(journal: RollbackPayloadPublicationJournalV1): RollbackPayloadObservationV1 {
  return { phase: journal.phase, structureIdentities: journal.structureIdentities, metadataIdentities: journal.metadataIdentities };
}

function entryPath(root: CanonicalAbsolutePathV1, entry: RollbackPayloadEntryV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${root}/${entry.path}`);
}

async function names(io: BundleGuardedIo, directory: LifecycleGuardedEntryV1): Promise<readonly string[]> {
  const found: string[] = [];
  for await (const name of io.fs.names(directory)) found.push(name);
  return found.sort();
}

function sameNames(found: readonly string[], expected: readonly string[]): boolean {
  const sorted = [...expected].sort();
  return found.length === sorted.length && found.every((name, index) => name === sorted[index]);
}

/**
 * Read-only proof that a retained payload is exactly its identity: the five owner-only directories
 * with no unknown child, the inverse plan and inventory by hash, and every entry by size, mode, and
 * hash. Returns the bound inventory; any disagreement preserves the payload as exit 6.
 */
export async function verifyRetainedRollbackPayload(io: BundleGuardedIo, retained: RollbackPayloadIdentityV1): Promise<RollbackPayloadInventoryV1> {
  const root = retained.root;
  const inversePath = rollbackPayloadMetadataPath(root, 0);
  const inverse = await io.readBounded(inversePath, 0o600, MAXIMUM_ROLLBACK_DOCUMENT_BYTES);
  if (inverse === null || sha256Hex(inverse.bytes) !== retained.inversePlanHash) return refuseBundle("rollback_retained_inverse_plan", inversePath);
  const inversePlan = validateBoundedUpdateInversePlan(io.decodeExact(inverse.bytes, MAXIMUM_LEAF_PLAN_BYTES, inversePath));
  if (inversePlan.payloadId !== retained.payloadId || inversePlan.rollbackBindingHash !== retained.rollbackBindingHash) refuseBundle("rollback_retained_inverse_plan", inversePath);
  const inventoryPath = rollbackPayloadMetadataPath(root, 1);
  const found = await io.readBounded(inventoryPath, 0o600, MAXIMUM_ROLLBACK_DOCUMENT_BYTES);
  if (found === null) return refuseBundle("rollback_retained_inventory", inventoryPath);
  let inventory: RollbackPayloadInventoryV1;
  try {
    inventory = decodeRollbackPayloadInventory(found.bytes, retained);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    return refuseBundle("rollback_retained_inventory", inventoryPath);
  }
  const structures = rollbackPayloadStructures(root);
  const directories = await Promise.all(structures.map((structure) => io.ownedDirectory(structure.path)));
  const leafNames = (prefix: string): readonly string[] => inventory.entries.filter((entry) => entry.path.startsWith(prefix)).map((entry) => entry.path.slice(prefix.length));
  const expected: readonly (readonly string[])[] = [
    ["plans", "blobs", ROLLBACK_INVERSE_PLAN_NAME, ROLLBACK_INVENTORY_NAME],
    [...PLAN_KIND_DIRECTORIES],
    leafNames("plans/owner_inverse/"),
    leafNames("plans/schema_migration_inverse/"),
    leafNames("blobs/"),
  ];
  for (const [ordinal, directory] of directories.entries()) {
    if (!sameNames(await names(io, directory), expected[ordinal] as readonly string[])) refuseBundle("rollback_retained_unknown_child", directory.path);
  }
  for (const entry of inventory.entries) {
    const path = entryPath(root, entry);
    const file = await io.fs.lstat(path);
    if (!io.isBoundedRegular(file, 0o600, entry.bytes) || file.size !== entry.bytes.toString(10)) return refuseBundle("rollback_retained_entry", path);
    await io.verifyWritten(file, entry.bytes, entry.sha256, 0o600);
  }
  return inventory;
}

async function removeCheckedFile(io: BundleGuardedIo, path: CanonicalAbsolutePathV1, bytes: number, sha256: string): Promise<void> {
  const found = await io.fs.lstat(path);
  if (found === null) return;
  if (!io.isBoundedRegular(found, 0o600, bytes) || (await io.fs.hashRegular(found, BigInt(bytes))) !== sha256) refuseBundle("rollback_retired_leaf", path);
  await io.removeFile(path, 0o600, bytes, found);
}

async function removeEmptyDirectory(io: BundleGuardedIo, path: CanonicalAbsolutePathV1): Promise<void> {
  const found = await io.fs.lstat(path);
  if (found === null) return;
  const directory = await io.ownedDirectory(path);
  if (!(await io.emptyDirectory(directory))) refuseBundle("rollback_retained_unknown_child", path);
  await io.removeDirectory(path, directory);
}

/**
 * Removes one retained payload through its exact retirement inventory after the point of no return.
 * Each file is hash-checked before its guarded unlink; `inventory.json` goes last among files so a
 * crash leaves the authority for whatever remains. Rerunning after death force-forwards: an absent
 * leaf is already retired, and with the inventory gone only empty fixed directories may remain.
 */
export async function removeRetainedRollbackPayload(io: BundleGuardedIo, retained: RollbackPayloadIdentityV1, interrupt: (point: "retired_leaf") => void = () => undefined): Promise<void> {
  const inventoryPath = rollbackPayloadMetadataPath(retained.root, 1);
  const found = await io.readBounded(inventoryPath, 0o600, MAXIMUM_ROLLBACK_DOCUMENT_BYTES);
  if (found === null) {
    if ((await io.fs.lstat(rollbackPayloadMetadataPath(retained.root, 0))) !== null) refuseBundle("rollback_retired_leaf", rollbackPayloadMetadataPath(retained.root, 0));
    for (const ordinal of [4, 3, 2, 1, 0]) {
      await removeEmptyDirectory(io, (rollbackPayloadStructures(retained.root)[ordinal] as { readonly path: CanonicalAbsolutePathV1 }).path);
      interrupt("retired_leaf");
    }
    return;
  }
  for (const leaf of rollbackPayloadRetirementLeaves(retained, decodeRollbackPayloadInventory(found.bytes, retained))) {
    if (leaf.kind === "directory") await removeEmptyDirectory(io, leaf.path);
    else await removeCheckedFile(io, leaf.path, leaf.bytes ?? MAXIMUM_ROLLBACK_DOCUMENT_BYTES, leaf.sha256 as string);
    interrupt("retired_leaf");
  }
}

/**
 * Spec 2 §9.2's rollback-payload state participant. `publish` creates the five fixed structures,
 * copies every inventory entry from the ready source with recorded-inode evidence, then the inverse
 * plan and inventory; nothing is replaced. A verify-only plan proves the retained payload read-only,
 * and only `retire`, after the rollback point of no return, removes it. Deletion authority is the
 * journal's recorded identities or the retained inventory; never a recursive removal.
 */
export class RollbackPayloadParticipant {
  readonly #dependencies: BundleParticipantDependenciesV1<RollbackPublicationDeathPointV1>;
  readonly #io: BundleGuardedIo;
  readonly #root: CanonicalAbsolutePathV1;

  constructor(dependencies: BundleParticipantDependenciesV1<RollbackPublicationDeathPointV1>, stagingRoot: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#io = new BundleGuardedIo(dependencies.fs, dependencies.effectiveUid);
    this.#root = parseCanonicalAbsolutePathText(stagingRoot);
  }

  #interrupt(point: RollbackPublicationDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  async #open(value: RollbackPayloadStatePlanV1): Promise<{ readonly plan: RollbackPayloadStatePlanV1; readonly file: Journal }> {
    const plan = validateRollbackPayloadStatePlan(value, this.#root);
    const file = new BundleJournalFile<RollbackPayloadPublicationJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "rollback_payload_state", plan.id), plan.maximumJournalBytes);
    await file.load((input) => validateRollbackPayloadPublicationJournal(input, plan));
    return { plan, file };
  }

  async #advance(plan: RollbackPayloadStatePlanV1, file: Journal, step: RollbackPayloadPublicationStepV1): Promise<RollbackPayloadPublicationJournalV1> {
    const current = file.value as RollbackPayloadPublicationJournalV1;
    const next = advanceRollbackPayloadPublicationJournal(plan, current, step, stampAfter(this.#dependencies.now, current.updatedAt));
    await file.write(next, rollbackPayloadPublicationJournalBytes(next));
    this.#interrupt("journal_rewritten");
    return next;
  }

  #published(plan: RollbackPayloadStatePlanV1): RollbackPayloadIdentityV1 {
    return plan.publish ?? refuseBundle("rollback_payload_not_publishing", this.#root);
  }

  /** Forward publication from a clean cursor; an in-flight microstate only compensates. */
  async publish(value: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1> {
    const { plan, file } = await this.#open(value);
    const published = this.#published(plan);
    const journal = file.value as RollbackPayloadPublicationJournalV1;
    if (!isRollbackPayloadPublicationForward(journal.phase)) refuseBundle("rollback_payload_not_forward", file.path);
    if (journal.structureWriteState !== null || journal.entryWriteState !== null || journal.metadataWriteState !== null) refuseBundle("rollback_payload_in_flight", file.path);
    if (journal.phase === "verified") return observe(journal);
    const source = await this.#stagedSource(plan, true);
    const structures = rollbackPayloadStructures(published.root);
    for (let current = file.value as RollbackPayloadPublicationJournalV1; current.nextStructure < structures.length; current = file.value as RollbackPayloadPublicationJournalV1) {
      const parent = await this.#structureParent(current, current.nextStructure);
      await this.#advance(plan, file, { kind: "structure_intent" });
      const created = await this.#io.fs.mkdirExclusive((structures[current.nextStructure] as (typeof structures)[number]).path);
      this.#interrupt("structure_made");
      await this.#io.fs.syncDirectory(parent);
      await this.#advance(plan, file, { kind: "structure_created", dev: created.dev, ino: created.ino });
      await this.#advance(plan, file, { kind: "structure_complete" });
    }
    const evidenceParent = await this.#evidenceDirectory(plan);
    for (let current = file.value as RollbackPayloadPublicationJournalV1; current.nextEntry < published.entryCount; current = file.value as RollbackPayloadPublicationJournalV1) {
      const entry = source.inventory.entries[current.nextEntry] as RollbackPayloadEntryV1;
      const sourceEvidence = await this.#io.readBounded(rollbackSourceEvidencePath(source.plan, entry.ordinal), 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
      if (sourceEvidence === null) return refuseBundle("rollback_source_evidence_missing", source.plan.evidenceRoot);
      await copyBundleEntry({
        io: this.#io,
        entry: rollbackEntryAsFile(entry),
        from: rollbackSourceEntryPath(source.plan, entry),
        fromIdentity: validateDurableRollbackSourceEntryEvidence(sourceEvidence.bytes, source.plan, entry),
        target: entryPath(published.root, entry),
        targetParent: await this.#structure(current, rollbackEntryParentStructure(entry)),
        evidencePath: rollbackPublicationEvidencePath(this.#root, plan, entry.ordinal),
        evidenceParent,
        evidenceBytes: (dev, ino) => durableEntryEvidenceBytes(durableRollbackPublicationEntryEvidence(plan, entry, dev, ino)),
        advance: async (step) => {
          await this.#advance(plan, file, step);
        },
        interrupt: (point) => {
          this.#interrupt(point);
        },
      });
    }
    for (let current = file.value as RollbackPayloadPublicationJournalV1; current.nextMetadata < 2; current = file.value as RollbackPayloadPublicationJournalV1) {
      await this.#publishMetadata(plan, file, source, current.nextMetadata);
    }
    return observe(file.value as RollbackPayloadPublicationJournalV1);
  }

  /** Copies one bound document from the source: `publish_intent`, exclusive create, recorded inode, bytes, reopen. */
  async #publishMetadata(plan: RollbackPayloadStatePlanV1, file: Journal, source: StagedSource, ordinal: number): Promise<void> {
    const published = this.#published(plan);
    const row = source.journal.metadataIdentities[ordinal];
    if (row === undefined) return refuseBundle("rollback_source_metadata", source.plan.sourceRoot);
    const parent = await this.#structure(file.value as RollbackPayloadPublicationJournalV1, 0);
    await this.#advance(plan, file, { kind: "metadata_intent" });
    const target = await this.#io.createEmpty(rollbackPayloadMetadataPath(published.root, ordinal), 0o600);
    try {
      await this.#advance(plan, file, { kind: "metadata_published", dev: target.entry.dev, ino: target.entry.ino });
      this.#interrupt("metadata_created");
      await this.#io.copyVerified(row.path, row, target.handle, { path: row.path as unknown as BundleRelativePathV1, kind: "file", mode: 384, bytes: parseUInt64Decimal(row.bytes.toString(10)), sha256: row.sha256 });
      this.#interrupt("metadata_written");
    } finally {
      await target.handle.close();
    }
    await this.#io.verifyWritten(target.entry, row.bytes, row.sha256, 0o600);
    await this.#io.fs.syncDirectory(parent);
    await this.#advance(plan, file, { kind: "metadata_complete" });
  }

  /**
   * The staged source is authority only through its hash-bound immutable plan, its terminal
   * `source_ready` journal, and (for publication) ready evidence recomputed over the exact evidence
   * set. Its entries come from its own identity-bound `inventory.json`, whose hash the plan binds.
   */
  async #stagedSource(plan: RollbackPayloadStatePlanV1, requireReady: boolean): Promise<StagedSource> {
    const published = this.#published(plan);
    const reference = plan.source ?? refuseBundle("rollback_payload_source", this.#root);
    const ref = reference.stagingPlan;
    const planFile = await this.#io.readBounded(ref.path, 0o600, MAXIMUM_LEAF_PLAN_BYTES);
    if (planFile === null || planFile.bytes.byteLength !== ref.bytes || updateLeafPlanHash("rollback_payload_source", planFile.bytes) !== ref.hash) return refuseBundle("rollback_source_plan", ref.path);
    const sourcePlan = validateRollbackPayloadSourceStagingPlan(this.#io.decodeExact(planFile.bytes, MAXIMUM_LEAF_PLAN_BYTES, ref.path), this.#root);
    if (sourcePlan.id !== ref.id || sourcePlan.coordinatorId !== plan.coordinatorId || sourcePlan.payloadId !== published.payloadId || sourcePlan.rollbackBindingHash !== published.rollbackBindingHash
      || sourcePlan.inversePlanHash !== published.inversePlanHash || sourcePlan.inventoryHash !== published.inventoryHash || sourcePlan.entryCount !== published.entryCount || sourcePlan.aggregateBytes !== published.aggregateBytes) {
      refuseBundle("rollback_source_plan", ref.path);
    }
    const journalFile = new BundleJournalFile<RollbackPayloadSourceStagingJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "rollback_payload_source", sourcePlan.id), sourcePlan.maximumJournalBytes);
    const journal = await journalFile.load((input) => validateRollbackPayloadSourceJournal(input, sourcePlan));
    if (journal.phase !== "source_ready" || journal.readyIdentity === null) return refuseBundle("rollback_source_not_ready", journalFile.path);
    const inventoryRow = journal.metadataIdentities[1];
    if (inventoryRow === undefined) return refuseBundle("rollback_source_inventory", sourcePlan.sourceRoot);
    const inventoryFile = await this.#io.readBounded(inventoryRow.path, 0o600, inventoryRow.bytes);
    if (inventoryFile === null || !sameInode(inventoryFile.entry, inventoryRow)) return refuseBundle("rollback_source_inventory", inventoryRow.path);
    const inventory = decodeRollbackPayloadInventory(inventoryFile.bytes, published);
    if (requireReady) {
      if (reference.readyEvidencePath !== rollbackPayloadSourcePaths(this.#root, sourcePlan.payloadId).ready) refuseBundle("rollback_source_ready", reference.readyEvidencePath);
      const ready = await this.#io.readBounded(reference.readyEvidencePath, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES);
      if (ready === null || !sameInode(ready.entry, journal.readyIdentity)) return refuseBundle("rollback_source_ready", reference.readyEvidencePath);
      validateRollbackPayloadSourceReadyEvidence(ready.bytes, sourcePlan, journal, await rollbackSourceEvidenceSetHash(this.#io, sourcePlan, inventory.entries));
    }
    return { plan: sourcePlan, journal, inventory };
  }

  async #structure(journal: RollbackPayloadPublicationJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const identity = journal.structureIdentities[ordinal];
    if (identity === undefined) return refuseBundle("rollback_payload_structure", this.#root);
    return this.#io.ownedDirectory(identity.path, identity);
  }

  /** The payload root's parent is the product home's manifest-owned `rollback` directory. */
  async #structureParent(journal: RollbackPayloadPublicationJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const parent = STRUCTURE_PARENTS[ordinal] as number;
    if (parent >= 0) return this.#structure(journal, parent);
    return this.#io.ownedDirectory(parseCanonicalAbsolutePathText(`${productHomeOfStagingRoot(this.#root, journal.coordinatorId)}/rollback`));
  }

  /** `update/evidence/publication/rollback_payload_state/<id>` beneath the construction-created `update`. */
  async #evidenceDirectory(plan: RollbackPayloadStatePlanV1): Promise<LifecycleGuardedEntryV1> {
    const target = rollbackPublicationEvidenceDirectory(this.#root, plan.id);
    let path = `${this.#root}/update`;
    let entry = await this.#io.ownedDirectory(parseCanonicalAbsolutePathText(path));
    for (const component of target.slice(path.length + 1).split("/")) {
      path = `${path}/${component}`;
      const child = parseCanonicalAbsolutePathText(path);
      if ((await this.#io.fs.lstat(child)) === null) {
        await this.#io.fs.mkdirExclusive(child);
        await this.#io.fs.syncDirectory(entry);
      }
      entry = await this.#io.ownedDirectory(child);
    }
    return entry;
  }

  /** `rollback_payload/verify_retained`: the retained payload proves itself; no byte changes. */
  async verifyRetained(value: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1> {
    const { plan, file } = await this.#open(value);
    const retained = plan.retainedBefore;
    if (plan.publish !== null || retained === null) return refuseBundle("rollback_payload_not_verify_only", file.path);
    const journal = file.value as RollbackPayloadPublicationJournalV1;
    if (journal.phase === "verified") return observe(journal);
    if (journal.phase !== "planned") refuseBundle("rollback_payload_not_forward", file.path);
    await verifyRetainedRollbackPayload(this.#io, retained);
    await this.#advance(plan, file, { kind: "retained_verified" });
    return observe(file.value as RollbackPayloadPublicationJournalV1);
  }

  /**
   * `terminal_retire/consumed_rollback_and_rejected_release`, after the previous verifier's durable
   * success: removes the verified retained payload through its inventory, then finalizes.
   */
  async retire(value: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1> {
    const { plan, file } = await this.#open(value);
    const retained = plan.retainedBefore;
    if (plan.publish !== null || retained === null) return refuseBundle("rollback_payload_not_verify_only", file.path);
    const phase = (file.value as RollbackPayloadPublicationJournalV1).phase;
    if (phase === "finalized" || phase === "compacting") return observe(file.value as RollbackPayloadPublicationJournalV1);
    if (phase !== "verified") refuseBundle("rollback_payload_not_verified", file.path);
    await removeRetainedRollbackPayload(this.#io, retained, (point) => {
      this.#interrupt(point);
    });
    if ((await this.#io.fs.lstat(retained.root)) !== null) refuseBundle("rollback_retired_leaf", retained.root);
    await this.#advance(plan, file, { kind: "finalize" });
    return observe(file.value as RollbackPayloadPublicationJournalV1);
  }

  async #bindIntents(plan: RollbackPayloadStatePlanV1, file: Journal, source: StagedSource | null): Promise<void> {
    const published = this.#published(plan);
    const journal = file.value as RollbackPayloadPublicationJournalV1;
    if (journal.structureWriteState?.state === "create_intent") {
      const path = (rollbackPayloadStructures(published.root)[journal.nextStructure] as { readonly path: CanonicalAbsolutePathV1 }).path;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (found.kind !== "directory" || found.ownerUid !== this.#io.uid || found.mode !== 0o700 || !(await this.#io.emptyDirectory(found))) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "structure_created", dev: found.dev, ino: found.ino });
      }
    }
    const state = (file.value as RollbackPayloadPublicationJournalV1).entryWriteState;
    if (state !== null) {
      const entry = source?.inventory.entries[state.ordinal];
      if (entry === undefined) return refuseBundle("rollback_source_inventory", published.root);
      const step = await bindEntryIntent(this.#io, state, rollbackEntryAsFile(entry), entryPath(published.root, entry), rollbackPublicationEvidencePath(this.#root, plan, state.ordinal));
      if (step !== null) await this.#advance(plan, file, step);
    }
    const metadata = (file.value as RollbackPayloadPublicationJournalV1).metadataWriteState;
    if (metadata?.state === "publish_intent") {
      const path = rollbackPayloadMetadataPath(published.root, metadata.ordinal);
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (!this.#io.isBoundedRegular(found, 0o600, 0)) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "metadata_published", dev: found.dev, ino: found.ino });
      }
    }
  }

  /**
   * Reverse walk of the reached prefix: created metadata, then entries (entry, then evidence), then
   * structures by recorded identity. A verify-only plan only marks itself rolled back.
   */
  async compensate(value: RollbackPayloadStatePlanV1): Promise<RollbackPayloadObservationV1> {
    const { plan, file } = await this.#open(value);
    const reached = file.value as RollbackPayloadPublicationJournalV1;
    const source = plan.publish !== null && (reached.nextEntry > 0 || reached.entryWriteState !== null) ? await this.#stagedSource(plan, false) : null;
    if (isRollbackPayloadPublicationForward(reached.phase)) {
      if (plan.publish !== null) await this.#bindIntents(plan, file, source);
      await this.#advance(plan, file, { kind: "compensate" });
    }
    for (let journal = file.value as RollbackPayloadPublicationJournalV1; journal.phase.startsWith("compensating_"); journal = file.value as RollbackPayloadPublicationJournalV1) {
      const published = this.#published(plan);
      if (journal.phase === "compensating_metadata") await this.#compensateMetadata(published, journal);
      else if (journal.phase === "compensating_entries") await this.#compensateEntry(plan, published, journal, source);
      else await this.#compensateStructure(published, journal);
      await this.#advance(plan, file, { kind: "compensation_step" });
      this.#interrupt("compensation_step");
    }
    const terminal = file.value as RollbackPayloadPublicationJournalV1;
    if (terminal.phase !== "rolled_back") refuseBundle("rollback_payload_not_compensable", file.path);
    return observe(terminal);
  }

  async #compensateMetadata(published: RollbackPayloadIdentityV1, journal: RollbackPayloadPublicationJournalV1): Promise<void> {
    const ordinal = journal.compensationMetadataNext as number;
    if (ordinal < 0) return;
    const inFlight = journal.metadataWriteState?.ordinal === ordinal && journal.metadataWriteState.state === "published" ? journal.metadataWriteState : null;
    const identity = inFlight ?? journal.metadataIdentities[ordinal];
    if (identity === undefined) return;
    await this.#io.removeFile(rollbackPayloadMetadataPath(published.root, ordinal), 0o600, MAXIMUM_ROLLBACK_DOCUMENT_BYTES, identity);
  }

  async #compensateEntry(plan: RollbackPayloadStatePlanV1, published: RollbackPayloadIdentityV1, journal: RollbackPayloadPublicationJournalV1, source: StagedSource | null): Promise<void> {
    const at = journal.compensationNext as number;
    if (at < 0) return;
    const entry = source?.inventory.entries[at];
    if (entry === undefined) return refuseBundle("rollback_source_inventory", published.root);
    await removeBundleEntryPart(this.#io, {
      entry: rollbackEntryAsFile(entry),
      target: entryPath(published.root, entry),
      evidencePath: rollbackPublicationEvidencePath(this.#root, plan, at),
      part: journal.compensationPart as "entry" | "evidence",
      inFlight: journal.entryWriteState?.ordinal === at ? journal.entryWriteState : null,
      evidencedIdentity: (bytes) => validateDurableRollbackPublicationEntryEvidence(bytes, plan, entry),
    });
  }

  async #compensateStructure(published: RollbackPayloadIdentityV1, journal: RollbackPayloadPublicationJournalV1): Promise<void> {
    const ordinal = journal.compensationStructureNext as number;
    if (ordinal < 0) return;
    const inFlight = journal.structureWriteState?.state === "created" && journal.structureWriteState.ordinal === ordinal ? journal.structureWriteState : null;
    const identity = inFlight ?? journal.structureIdentities[ordinal];
    const path = (rollbackPayloadStructures(published.root)[ordinal] as { readonly path: CanonicalAbsolutePathV1 }).path;
    if (identity === undefined) return refuseBundle("bundle_unbound", path);
    await this.#io.ownedDirectory(parentPath(path));
    await this.#io.removeDirectory(path, identity);
  }

  /**
   * After the outer point of no return: a published payload goes `verified` → `finalized` (a
   * verify-only plan finalizes only through `retire`), then publication evidence in reverse ordinal
   * order. The retained payload is never touched; its own `inventory.json` names the rows.
   */
  async compact(value: RollbackPayloadStatePlanV1): Promise<void> {
    const { plan, file } = await this.#open(value);
    if ((file.value as RollbackPayloadPublicationJournalV1).phase === "verified" && plan.publish !== null) await this.#advance(plan, file, { kind: "finalize" });
    if ((file.value as RollbackPayloadPublicationJournalV1).phase === "finalized") await this.#advance(plan, file, { kind: "compaction_step" });
    if ((file.value as RollbackPayloadPublicationJournalV1).phase !== "compacting") refuseBundle("rollback_payload_not_terminal", file.path);
    const count = rollbackPublicationEntryCount(plan);
    if ((file.value as RollbackPayloadPublicationJournalV1).compactionNext === count) return;
    const published = this.#published(plan);
    const inventoryPath = rollbackPayloadMetadataPath(published.root, 1);
    const found = await this.#io.readBounded(inventoryPath, 0o600, MAXIMUM_ROLLBACK_DOCUMENT_BYTES);
    if (found === null) return refuseBundle("rollback_retained_inventory", inventoryPath);
    const inventory = decodeRollbackPayloadInventory(found.bytes, published);
    for (let journal = file.value as RollbackPayloadPublicationJournalV1; (journal.compactionNext as number) < count; journal = file.value as RollbackPayloadPublicationJournalV1) {
      const entry = inventory.entries[rollbackPublicationCompactionOrdinal(plan, journal.compactionNext as number)] as RollbackPayloadEntryV1;
      const path = rollbackPublicationEvidencePath(this.#root, plan, entry.ordinal);
      const evidence = await this.#io.readBounded(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
      if (evidence !== null) {
        validateDurableRollbackPublicationEntryEvidence(evidence.bytes, plan, entry);
        await this.#io.removeFile(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, evidence.entry);
      }
      await this.#advance(plan, file, { kind: "compaction_step" });
      this.#interrupt("compaction_step");
    }
  }
}
