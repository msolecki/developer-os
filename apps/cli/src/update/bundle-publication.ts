import {
  advanceBundlePublicationJournal,
  bundleEntryParentOrdinal,
  bundleMetadataCreates,
  bundlePublicationCompactionOrdinal,
  bundlePublicationEvidenceDirectory,
  bundlePublicationEvidencePath,
  bundlePublicationJournalBytes,
  bundleSourceEvidencePath,
  bundleSourcePaths,
  durableEntryEvidenceBytes,
  durablePublicationEntryEvidence,
  isBundlePublicationForward,
  MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES,
  MAXIMUM_LEAF_PLAN_BYTES,
  MAXIMUM_SOURCE_READY_EVIDENCE_BYTES,
  parseCanonicalAbsolutePathText,
  updateLeafPlanHash,
  updateParticipantJournalPath,
  validateBundlePublicationJournal,
  validateBundlePublicationPlan,
  validateBundleSourceJournal,
  validateBundleSourceReadyEvidence,
  validateBundleSourceStagingPlan,
  validateDurablePublicationEntryEvidence,
  validateDurableSourceEntryEvidence,
  type BundleMetadataStatePlanV1,
  type BundlePublicationJournalV1,
  type BundlePublicationPlanV1,
  type BundlePublicationStepV1,
  type BundleSourceStagingJournalV1,
  type BundleSourceStagingPlanV1,
  type CanonicalAbsolutePathV1,
  type LifecycleGuardedEntryV1,
  type PresentBundleMetadataPostimageV1,
  type PresentBundleMetadataPreimageV1,
  type ReleaseBundleEntryV1,
  type UpdateDirectoryIdentityV1,
  type UpdatePublishedMetadataIdentityV1,
} from "@developer-os/core";

import {
  bindEntryIntent,
  BundleGuardedIo,
  BundleJournalFile,
  bundleSourceEvidenceSetHash,
  copyBundleEntry,
  createFresh,
  parentPath,
  refuseBundle,
  removeBundleEntryPart,
  sameInode,
  sourceEntryPath,
  stampAfter,
  type BundleEntryDeathPointV1,
  type BundleParticipantDependenciesV1,
} from "./bundle-source.js";
import type { UpdatePayloadIdentityResolverV1 } from "./state-participant.js";

export type BundlePublicationDeathPointV1 = BundleEntryDeathPointV1 | "version_directory_made" | "root_made" | "metadata_renamed";

export const BUNDLE_PUBLICATION_DEATH_POINTS: readonly BundlePublicationDeathPointV1[] = Object.freeze([
  "journal_rewritten",
  "version_directory_made",
  "root_made",
  "entry_created",
  "entry_written",
  "evidence_created",
  "evidence_written",
  "metadata_renamed",
  "compensation_step",
  "compaction_step",
]);

/** What the coordinator step records after the participant returns. */
export interface BundlePublicationObservationV1 {
  readonly phase: BundlePublicationJournalV1["phase"];
  readonly targetRootIdentity: UpdateDirectoryIdentityV1 | null;
  readonly metadataIdentities: readonly UpdatePublishedMetadataIdentityV1[];
}

interface StagedSource {
  readonly plan: BundleSourceStagingPlanV1;
  readonly journal: BundleSourceStagingJournalV1;
}

type Journal = BundleJournalFile<BundlePublicationJournalV1>;

export interface BundlePublicationDependenciesV1 extends BundleParticipantDependenciesV1<BundlePublicationDeathPointV1> {
  /** A created metadata postimage's identity, from its payload's construction evidence only (D60). */
  readonly payloadIdentity: UpdatePayloadIdentityResolverV1;
}

function observe(journal: BundlePublicationJournalV1): BundlePublicationObservationV1 {
  return { phase: journal.phase, targetRootIdentity: journal.targetRootIdentity, metadataIdentities: journal.metadataIdentities };
}

function targetEntryPath(plan: BundlePublicationPlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.target.bundleRoot}/${(plan.entries[ordinal] as ReleaseBundleEntryV1).path}`);
}

/**
 * Spec 2 §9.2's bundle publication participant. `publish_target` creates the absent target root,
 * copies every entry from the ready staged source with recorded-inode evidence, then publishes the
 * delegation, index, and bundle manifest by no-replace rename. `verify_previous` walks the same
 * cursors over the retained bundle and mutates nothing. Deletion authority is only the journal's
 * recorded identities; a retained path is never replaced or recursively removed.
 */
export class BundlePublicationParticipant {
  readonly #dependencies: BundlePublicationDependenciesV1;
  readonly #io: BundleGuardedIo;
  readonly #root: CanonicalAbsolutePathV1;

  constructor(dependencies: BundlePublicationDependenciesV1, stagingRoot: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#io = new BundleGuardedIo(dependencies.fs, dependencies.effectiveUid);
    this.#root = parseCanonicalAbsolutePathText(stagingRoot);
  }

  #interrupt(point: BundlePublicationDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  async #open(value: BundlePublicationPlanV1): Promise<{ readonly plan: BundlePublicationPlanV1; readonly file: Journal }> {
    const plan = validateBundlePublicationPlan(value, this.#root);
    const file = new BundleJournalFile<BundlePublicationJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "bundle_publication", plan.id), plan.maximumJournalBytes);
    await file.load((input) => validateBundlePublicationJournal(input, plan));
    return { plan, file };
  }

  async #advance(plan: BundlePublicationPlanV1, file: Journal, step: BundlePublicationStepV1): Promise<BundlePublicationJournalV1> {
    const current = file.value as BundlePublicationJournalV1;
    const next = advanceBundlePublicationJournal(plan, current, step, stampAfter(this.#dependencies.now, current.updatedAt));
    await file.write(next, bundlePublicationJournalBytes(next));
    this.#interrupt("journal_rewritten");
    return next;
  }

  async #refuseCreate(plan: BundlePublicationPlanV1, file: Journal): Promise<void> {
    await this.#advance(plan, file, { kind: "create_refused" });
  }

  /**
   * Forward publication or verification. Process death never chooses rollback (Spec 2 §9.4), so a
   * forward journal left inside a microstate resumes it: an intent binds its exact empty crash
   * frontier or retries the absent path, and a recorded inode is reopened and completed.
   */
  async apply(value: BundlePublicationPlanV1): Promise<BundlePublicationObservationV1> {
    const { plan, file } = await this.#open(value);
    const journal = file.value as BundlePublicationJournalV1;
    if (!isBundlePublicationForward(journal.phase)) refuseBundle("bundle_publication_not_forward", file.path);
    if (plan.action === "publish_target") await this.#publish(plan, file);
    else await this.#verify(plan, file);
    return observe(file.value as BundlePublicationJournalV1);
  }

  async #publish(plan: BundlePublicationPlanV1, file: Journal): Promise<void> {
    const source = await this.#stagedSource(plan);
    if ((file.value as BundlePublicationJournalV1).nextRootTransition === 0) {
      const parent = await this.#versionDirectory(plan, file);
      // Only an intent persisted before this run is a crash frontier; a fresh intent never binds a present path.
      const resumed = (file.value as BundlePublicationJournalV1).rootWriteState;
      if (resumed === null) await this.#advance(plan, file, { kind: "root_intent" });
      if (resumed?.state !== "created") {
        let created = resumed === null ? null : await this.#boundRoot(plan);
        if (created === null) {
          created = await createFresh(() => this.#io.fs.mkdirExclusive(plan.target.bundleRoot), () => this.#refuseCreate(plan, file));
          this.#interrupt("root_made");
        }
        // The parent entry is durable before the journal records the root's identity.
        await this.#io.fs.syncDirectory(parent);
        await this.#advance(plan, file, { kind: "root_created", dev: created.dev, ino: created.ino });
      }
      await this.#io.ownedDirectory(plan.target.bundleRoot, (file.value as BundlePublicationJournalV1).rootWriteState as Extract<BundlePublicationJournalV1["rootWriteState"], { readonly state: "created" }>);
      await this.#advance(plan, file, { kind: "root_complete" });
    }
    const evidenceParent = await this.#evidenceDirectory(plan);
    for (let journal = file.value as BundlePublicationJournalV1; journal.nextEntry < plan.entries.length; journal = file.value as BundlePublicationJournalV1) {
      const ordinal = journal.nextEntry;
      const entry = plan.entries[ordinal] as ReleaseBundleEntryV1;
      const sourceEvidence = await this.#io.readBounded(bundleSourceEvidencePath(source.plan, ordinal), 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
      if (sourceEvidence === null) return refuseBundle("bundle_source_evidence_missing", source.plan.evidenceRoot);
      await copyBundleEntry({
        io: this.#io,
        entry,
        from: sourceEntryPath(source.plan, ordinal),
        fromIdentity: validateDurableSourceEntryEvidence(sourceEvidence.bytes, source.plan, ordinal),
        target: targetEntryPath(plan, ordinal),
        targetParent: await this.#entryParent(plan, journal, ordinal),
        evidencePath: bundlePublicationEvidencePath(this.#root, plan, ordinal),
        evidenceParent,
        evidenceBytes: (dev, ino) => durableEntryEvidenceBytes(durablePublicationEntryEvidence(plan, ordinal, dev, ino)),
        advance: async (step) => {
          await this.#advance(plan, file, step);
        },
        interrupt: (point) => {
          this.#interrupt(point);
        },
        refuseCreate: () => this.#refuseCreate(plan, file),
      }, journal.entryWriteState);
    }
    for (let journal = file.value as BundlePublicationJournalV1; journal.nextMetadata < 3; journal = file.value as BundlePublicationJournalV1) {
      const ordinal = journal.nextMetadata;
      if (bundleMetadataCreates(plan, ordinal)) await this.#publishMetadata(plan, file, plan.metadata[ordinal] as BundleMetadataStatePlanV1);
      else await this.#verifyMetadata(plan, file, plan.metadata[ordinal] as BundleMetadataStatePlanV1);
    }
  }

  /**
   * D72 addendum, D84 K5 (NEW-118 (1)): a new release's `releases/<version>` is created no-replace
   * under the retained `releases` root, or reused when a compensated attempt left it or another
   * bundle of the version shares it. It is outside the coordinator staging root, so it is journaled
   * here: an intent while the path is absent, then its identity with `created`. Compensation removes
   * only a directory this attempt created, and only while it is empty under that identity.
   */
  async #versionDirectory(plan: BundlePublicationPlanV1, file: Journal): Promise<LifecycleGuardedEntryV1> {
    const path = parentPath(plan.target.bundleRoot);
    const recorded = (file.value as BundlePublicationJournalV1).versionDirectory;
    if (recorded?.state === "created") return this.#io.ownedDirectory(path, recorded);
    const releases = await this.#io.ownedDirectory(parentPath(path));
    let found = await this.#io.fs.lstat(path);
    if (recorded === null && found !== null) {
      const reused = await this.#io.ownedDirectory(path);
      await this.#advance(plan, file, { kind: "version_directory_created", created: false, dev: reused.dev, ino: reused.ino });
      return reused;
    }
    // After a refused create (`create_refused`) the intent is withdrawn and the directory belongs to someone else:
    // the next run finds it present and records it `created: false`, so it is reused and never compensated.
    if (recorded === null) await this.#advance(plan, file, { kind: "version_directory_intent" });
    // A resumed intent binds only the exact empty attempt-created directory; a fresh intent never binds a present path.
    found = recorded === null ? null : await this.#boundVersionDirectory(plan);
    if (found === null) {
      found = await createFresh(() => this.#io.fs.mkdirExclusive(path), () => this.#refuseCreate(plan, file));
      this.#interrupt("version_directory_made");
    }
    await this.#io.fs.syncDirectory(releases);
    await this.#advance(plan, file, { kind: "version_directory_created", created: true, dev: found.dev, ino: found.ino });
    return this.#io.ownedDirectory(path, found);
  }

  /** A present path under a `create_intent` binds only the exact empty owned directory; null when absent. */
  async #boundVersionDirectory(plan: BundlePublicationPlanV1): Promise<LifecycleGuardedEntryV1 | null> {
    const path = parentPath(plan.target.bundleRoot);
    const found = await this.#io.fs.lstat(path);
    if (found === null) return null;
    if (found.kind !== "directory" || found.ownerUid !== this.#io.uid || found.mode !== 0o700 || !(await this.#io.emptyDirectory(found))) refuseBundle("bundle_unbound", path);
    return found;
  }

  /**
   * The staged source is authority only through its hash-bound immutable plan, its terminal
   * `source_ready` journal, and ready evidence recomputed over the exact evidence set.
   */
  async #stagedSource(plan: BundlePublicationPlanV1): Promise<StagedSource> {
    if (plan.source.kind !== "staged_source") return refuseBundle("bundle_publication_source", this.#root);
    const ref = plan.source.stagingPlan;
    const planFile = await this.#io.readBounded(ref.path, 0o600, MAXIMUM_LEAF_PLAN_BYTES);
    if (planFile === null || planFile.bytes.byteLength !== ref.bytes || updateLeafPlanHash("bundle_source_staging", planFile.bytes) !== ref.hash) return refuseBundle("bundle_source_plan", ref.path);
    const sourcePlan = validateBundleSourceStagingPlan(this.#io.decodeExact(planFile.bytes, MAXIMUM_LEAF_PLAN_BYTES, ref.path), this.#root);
    if (sourcePlan.id !== ref.id || sourcePlan.coordinatorId !== plan.coordinatorId || sourcePlan.inventoryHash !== plan.inventoryHash) refuseBundle("bundle_source_plan", ref.path);
    const journalFile = new BundleJournalFile<BundleSourceStagingJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "bundle_source_staging", sourcePlan.id), sourcePlan.maximumJournalBytes);
    const journal = await journalFile.load((input) => validateBundleSourceJournal(input, sourcePlan));
    if (journal.phase !== "source_ready" || journal.readyIdentity === null) return refuseBundle("bundle_source_not_ready", journalFile.path);
    if (plan.source.readyEvidencePath !== bundleSourcePaths(this.#root, sourcePlan.id).ready) refuseBundle("bundle_source_ready", plan.source.readyEvidencePath);
    const ready = await this.#io.readBounded(plan.source.readyEvidencePath, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES);
    if (ready === null || !sameInode(ready.entry, journal.readyIdentity)) return refuseBundle("bundle_source_ready", plan.source.readyEvidencePath);
    validateBundleSourceReadyEvidence(ready.bytes, sourcePlan, journal, await bundleSourceEvidenceSetHash(this.#io, sourcePlan));
    return { plan: sourcePlan, journal };
  }

  /** `update/evidence/publication/bundle_publication/<id>` beneath the construction-created `update`. */
  async #evidenceDirectory(plan: BundlePublicationPlanV1): Promise<LifecycleGuardedEntryV1> {
    const target = bundlePublicationEvidenceDirectory(this.#root, plan.id);
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

  async #entryParent(plan: BundlePublicationPlanV1, journal: BundlePublicationJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const root = journal.targetRootIdentity;
    if (root === null) return refuseBundle("bundle_publication_root", plan.target.bundleRoot);
    const parent = bundleEntryParentOrdinal(plan.entries, ordinal);
    if (parent === null) return this.#io.ownedDirectory(root.path, root);
    const found = await this.#io.readBounded(bundlePublicationEvidencePath(this.#root, plan, parent), 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    if (found === null) return refuseBundle("bundle_publication_parent", targetEntryPath(plan, parent));
    return this.#io.ownedDirectory(targetEntryPath(plan, parent), validateDurablePublicationEntryEvidence(found.bytes, plan, parent));
  }

  /**
   * `publish_intent`, identity-preserving no-replace rename of the construction payload, reopen. A
   * resumed intent first binds a crash-renamed payload by its construction-evidenced identity.
   */
  async #publishMetadata(plan: BundlePublicationPlanV1, file: Journal, row: BundleMetadataStatePlanV1): Promise<void> {
    const after = row.after as PresentBundleMetadataPostimageV1;
    const payload = after.payload;
    if (payload === null) return refuseBundle("bundle_metadata_payload", row.path);
    const targetParent = await this.#io.ownedDirectory(parentPath(row.path));
    const payloadParent = await this.#io.ownedDirectory(parentPath(payload.path));
    let state = (file.value as BundlePublicationJournalV1).metadataWriteState;
    if (state?.state !== "published") {
      let moved = state === null ? null : await this.#boundMetadata(plan, file);
      if (moved === null) {
        const planned = await this.#dependencies.payloadIdentity(payload);
        const found = await this.#io.fs.lstat(payload.path);
        if (!this.#io.isBoundedRegular(found, 0o600, after.size) || found.size !== after.size.toString(10) || !sameInode(found, planned)) return refuseBundle("bundle_metadata_payload", payload.path);
        if ((await this.#io.fs.hashRegular(found, BigInt(after.size))) !== after.hash) refuseBundle("bundle_metadata_payload", payload.path);
        if ((await this.#io.fs.lstat(row.path)) !== null) refuseBundle("bundle_metadata_exists", row.path);
        if (state === null) await this.#advance(plan, file, { kind: "metadata_intent" });
        await createFresh(() => this.#io.fs.renameNoReplace(found, row.path), () => this.#refuseCreate(plan, file));
        this.#interrupt("metadata_renamed");
        moved = found;
      }
      // Both directory entries are durable before the journal records the moved inode.
      await this.#io.fs.syncDirectory(targetParent);
      await this.#io.fs.syncDirectory(payloadParent);
      await this.#advance(plan, file, { kind: "metadata_published", dev: moved.dev, ino: moved.ino });
      state = (file.value as BundlePublicationJournalV1).metadataWriteState;
    }
    const published = await this.#io.fs.lstat(row.path);
    if (published === null || state?.state !== "published" || !sameInode(published, state)) return refuseBundle("bundle_metadata_identity", row.path);
    await this.#io.verifyWritten(published, after.size, after.hash, 0o600);
    await this.#advance(plan, file, { kind: "metadata_complete" });
  }

  /** Present metadata records its already planned identity without gaining deletion authority. */
  async #verifyMetadata(plan: BundlePublicationPlanV1, file: Journal, row: BundleMetadataStatePlanV1): Promise<void> {
    const before = row.before as PresentBundleMetadataPreimageV1;
    const found = await this.#io.fs.lstat(row.path);
    if (!this.#io.isBoundedRegular(found, 0o600, before.size) || found.ownerUid !== before.ownerUid || !sameInode(found, before)) return refuseBundle("bundle_metadata_identity", row.path);
    await this.#io.verifyWritten(found, before.size, before.hash, 0o600);
    await this.#advance(plan, file, { kind: "metadata_verified" });
  }

  /** `verify_previous`: the retained root, every inventory entry, and all three metadata files; no byte changes. */
  async #verify(plan: BundlePublicationPlanV1, file: Journal): Promise<void> {
    const before = plan.targetRootBefore;
    if (before.state !== "present") return refuseBundle("bundle_publication_root", plan.target.bundleRoot);
    if ((file.value as BundlePublicationJournalV1).nextRootTransition === 0) {
      await this.#io.ownedDirectory(plan.target.bundleRoot, before);
      await this.#advance(plan, file, { kind: "root_verified" });
    }
    for (let journal = file.value as BundlePublicationJournalV1; journal.nextEntry < plan.entries.length; journal = file.value as BundlePublicationJournalV1) {
      const entry = plan.entries[journal.nextEntry] as ReleaseBundleEntryV1;
      const path = targetEntryPath(plan, journal.nextEntry);
      if (entry.kind === "directory") await this.#io.ownedDirectory(path);
      else {
        const found = await this.#io.fs.lstat(path);
        if (!this.#io.isBoundedRegular(found, entry.mode, Number(entry.bytes)) || found.size !== entry.bytes) return refuseBundle("bundle_retained_entry", path);
        await this.#io.verifyWritten(found, Number(entry.bytes), entry.sha256, entry.mode);
      }
      await this.#advance(plan, file, { kind: "entry_verified" });
    }
    for (let journal = file.value as BundlePublicationJournalV1; journal.nextMetadata < 3; journal = file.value as BundlePublicationJournalV1) {
      await this.#verifyMetadata(plan, file, plan.metadata[journal.nextMetadata] as BundleMetadataStatePlanV1);
    }
  }

  /** A present path under a root `create_intent` binds only the exact empty attempt-created directory; null when absent. */
  async #boundRoot(plan: BundlePublicationPlanV1): Promise<LifecycleGuardedEntryV1 | null> {
    const found = await this.#io.fs.lstat(plan.target.bundleRoot);
    if (found === null) return null;
    if (found.kind !== "directory" || found.ownerUid !== this.#io.uid || found.mode !== 0o700 || !(await this.#io.emptyDirectory(found))) refuseBundle("bundle_unbound", plan.target.bundleRoot);
    return found;
  }

  async #bindIntents(plan: BundlePublicationPlanV1, file: Journal): Promise<void> {
    if ((file.value as BundlePublicationJournalV1).versionDirectory?.state === "create_intent") {
      const found = await this.#boundVersionDirectory(plan);
      if (found !== null) await this.#advance(plan, file, { kind: "version_directory_created", created: true, dev: found.dev, ino: found.ino });
    }
    if ((file.value as BundlePublicationJournalV1).rootWriteState?.state === "create_intent") {
      const found = await this.#boundRoot(plan);
      if (found !== null) await this.#advance(plan, file, { kind: "root_created", dev: found.dev, ino: found.ino });
    }
    const state = (file.value as BundlePublicationJournalV1).entryWriteState;
    if (state !== null) {
      const step = await bindEntryIntent(this.#io, state, plan.entries[state.ordinal], targetEntryPath(plan, state.ordinal), bundlePublicationEvidencePath(this.#root, plan, state.ordinal));
      if (step !== null) await this.#advance(plan, file, step);
    }
    if ((file.value as BundlePublicationJournalV1).metadataWriteState?.state === "publish_intent") {
      const found = await this.#boundMetadata(plan, file);
      if (found !== null) await this.#advance(plan, file, { kind: "metadata_published", dev: found.dev, ino: found.ino });
    }
  }

  /** A present target under a metadata `publish_intent` binds only the payload's construction-evidenced inode; null when absent. */
  async #boundMetadata(plan: BundlePublicationPlanV1, file: Journal): Promise<LifecycleGuardedEntryV1 | null> {
    const row = plan.metadata[(file.value as BundlePublicationJournalV1).nextMetadata] as BundleMetadataStatePlanV1;
    const found = await this.#io.fs.lstat(row.path);
    if (found === null) return null;
    // The rename moves the payload inode, so only its construction-evidenced identity binds the intent.
    const payload = (row.after as PresentBundleMetadataPostimageV1).payload;
    if (payload === null || !sameInode(found, await this.#dependencies.payloadIdentity(payload))) refuseBundle("bundle_unbound", row.path);
    return found;
  }

  /**
   * Reverse walk of the reached prefix: created metadata, then entries (entry, then evidence),
   * then the identity-bound target root. `verify_previous` has no deletion authority at all.
   */
  async compensate(value: BundlePublicationPlanV1): Promise<BundlePublicationObservationV1> {
    const { plan, file } = await this.#open(value);
    if (isBundlePublicationForward((file.value as BundlePublicationJournalV1).phase)) {
      await this.#bindIntents(plan, file);
      await this.#advance(plan, file, { kind: "compensate" });
    }
    for (let journal = file.value as BundlePublicationJournalV1; journal.phase.startsWith("compensating_"); journal = file.value as BundlePublicationJournalV1) {
      if (journal.phase === "compensating_metadata") await this.#compensateMetadata(plan, journal);
      else if (journal.phase === "compensating_entries") await this.#compensateEntry(plan, journal);
      else if (journal.compensationRootNext === 0) await this.#removeVersionDirectory(plan, journal);
      else if (journal.compensationRootNext === 1) {
        const identity = journal.targetRootIdentity ?? (journal.rootWriteState?.state === "created" ? journal.rootWriteState : null);
        if (identity === null) return refuseBundle("bundle_unbound", plan.target.bundleRoot);
        await this.#io.removeDirectory(plan.target.bundleRoot, identity);
      }
      await this.#advance(plan, file, { kind: "compensation_step" });
      this.#interrupt("compensation_step");
    }
    const terminal = file.value as BundlePublicationJournalV1;
    if (terminal.phase !== "rolled_back") refuseBundle("bundle_publication_not_compensable", file.path);
    return observe(terminal);
  }

  /** Only a directory this attempt created, and only while empty: a sibling bundle of the version keeps it. */
  async #removeVersionDirectory(plan: BundlePublicationPlanV1, journal: BundlePublicationJournalV1): Promise<void> {
    const recorded = journal.versionDirectory;
    if (recorded?.state !== "created" || !recorded.created) return;
    const path = parentPath(plan.target.bundleRoot);
    const found = await this.#io.fs.lstat(path);
    if (found === null) return;
    const directory = await this.#io.ownedDirectory(path, recorded);
    if (await this.#io.emptyDirectory(directory)) await this.#io.removeDirectory(path, recorded);
  }

  async #compensateMetadata(plan: BundlePublicationPlanV1, journal: BundlePublicationJournalV1): Promise<void> {
    const ordinal = journal.compensationMetadataNext as number;
    if (ordinal < 0 || !bundleMetadataCreates(plan, ordinal)) return;
    const row = plan.metadata[ordinal] as BundleMetadataStatePlanV1;
    const inFlight = journal.metadataWriteState?.ordinal === ordinal && journal.metadataWriteState.state === "published" ? journal.metadataWriteState : null;
    const identity = inFlight ?? journal.metadataIdentities[ordinal];
    if (identity === undefined) return;
    await this.#io.removeFile(row.path, 0o600, (row.after as PresentBundleMetadataPostimageV1).size, identity);
  }

  async #compensateEntry(plan: BundlePublicationPlanV1, journal: BundlePublicationJournalV1): Promise<void> {
    const at = journal.compensationNext as number;
    if (at < 0) return;
    await removeBundleEntryPart(this.#io, {
      entry: plan.entries[at] as ReleaseBundleEntryV1,
      target: targetEntryPath(plan, at),
      evidencePath: bundlePublicationEvidencePath(this.#root, plan, at),
      part: journal.compensationPart as "entry" | "evidence",
      inFlight: journal.entryWriteState?.ordinal === at ? journal.entryWriteState : null,
      evidencedIdentity: (bytes) => validateDurablePublicationEntryEvidence(bytes, plan, at),
    });
  }

  /**
   * After the outer point of no return: `verified` → `finalized`, then publication evidence in
   * reverse ordinal order. It never removes a retained target entry; the outer compaction entry
   * removes the journal and immutable plan afterwards. A `rolled_back` publication is terminal:
   * its compensation already removed every entry, evidence file, metadata file and the root.
   */
  async compact(value: BundlePublicationPlanV1): Promise<void> {
    const { plan, file } = await this.#open(value);
    if ((file.value as BundlePublicationJournalV1).phase === "rolled_back") return;
    if ((file.value as BundlePublicationJournalV1).phase === "verified") await this.#advance(plan, file, { kind: "finalize" });
    if ((file.value as BundlePublicationJournalV1).phase === "finalized") await this.#advance(plan, file, { kind: "compaction_step" });
    if ((file.value as BundlePublicationJournalV1).phase !== "compacting") refuseBundle("bundle_publication_not_terminal", file.path);
    for (let journal = file.value as BundlePublicationJournalV1; (journal.compactionNext as number) < plan.entries.length; journal = file.value as BundlePublicationJournalV1) {
      const ordinal = bundlePublicationCompactionOrdinal(plan, journal.compactionNext as number);
      const path = bundlePublicationEvidencePath(this.#root, plan, ordinal);
      const found = await this.#io.readBounded(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
      if (found !== null) {
        if (plan.action === "verify_previous") refuseBundle("bundle_unbound", path);
        validateDurablePublicationEntryEvidence(found.bytes, plan, ordinal);
        await this.#io.removeFile(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, found.entry);
      }
      await this.#advance(plan, file, { kind: "compaction_step" });
      this.#interrupt("compaction_step");
    }
  }
}
