import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import {
  advanceBundleSourceJournal,
  bundleEntryParentOrdinal,
  bundleSourceCompactionTarget,
  bundleSourceEvidencePath,
  bundleSourceJournalBytes,
  bundleSourcePaths,
  bundleSourceReadyEvidence,
  bundleSourceReadyEvidenceBytes,
  bundleSourceStructures,
  decodeCanonicalJson,
  durableEntryEvidenceBytes,
  durableSourceEntryEvidence,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES,
  MAXIMUM_SOURCE_READY_EVIDENCE_BYTES,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateParticipantJournalPath,
  updateSourceEvidenceSetHash,
  validateBundleSourceJournal,
  validateBundleSourceStagingPlan,
  validateDurableSourceEntryEvidence,
  type BundleSourceReadyEvidenceV1,
  type BundleSourceStagingJournalV1,
  type BundleSourceStagingPlanV1,
  type BundleSourceStepV1,
  type CanonicalAbsolutePathV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LowerHexSha256,
  type ReleaseBundleEntryV1,
  type UInt64DecimalV1,
  type UpdateEntryStepV1,
  type UpdateEntryWriteStateV1,
  type UtcTimestampV1,
} from "@developer-os/core";
import type { VerifiedScratchBundleV1 } from "@developer-os/security";

/** Where a test may kill the process; each point follows a durable effect. */
export type BundleEntryDeathPointV1 = "journal_rewritten" | "entry_created" | "entry_written" | "evidence_created" | "evidence_written" | "compensation_step" | "compaction_step";

export type BundleSourceDeathPointV1 = BundleEntryDeathPointV1 | "structure_made" | "ready_created" | "ready_written" | "ready_removed";

export const BUNDLE_SOURCE_DEATH_POINTS: readonly BundleSourceDeathPointV1[] = Object.freeze([
  "journal_rewritten",
  "structure_made",
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

export interface BundleParticipantDependenciesV1<TPoint extends string> {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly now: () => Date;
  readonly interrupt?: (point: TPoint) => void;
}

type Identity = { readonly dev: string; readonly ino: string };

const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW;
const COPY_CHUNK_BYTES = 1_048_576;
const encoder = new TextEncoder();

/** A third state: preserved as found and surfaced as recovery-required (exit 6). */
export function refuseBundle(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

export function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

export function parentPath(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

export function sameInode(entry: LifecycleGuardedEntryV1, identity: Identity): boolean {
  return entry.dev === identity.dev && entry.ino === identity.ino;
}

export function stampAfter(now: () => Date, floor: UtcTimestampV1): UtcTimestampV1 {
  const stamp = parseUtcTimestamp(now().toISOString());
  return stamp > floor ? stamp : floor;
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

export async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten < 1) throw new Error("bundle participant write made no progress");
    offset += bytesWritten;
  }
  await handle.sync();
}

/**
 * The guarded filesystem operations both bundle participants share. Every removal rechecks
 * kind/owner/mode/link/size cap and the recorded device/inode, then syncs the owned parent.
 */
export class BundleGuardedIo {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly uid: number;

  constructor(fs: LifecycleGuardedFileSystemV1, uid: number) {
    this.fs = fs;
    this.uid = uid;
  }

  isBoundedRegular(entry: LifecycleGuardedEntryV1 | null, mode: number, maximumBytes: number): entry is LifecycleGuardedEntryV1 {
    return entry?.kind === "regular_file" && entry.ownerUid === this.uid && entry.mode === mode && entry.nlink === 1 && BigInt(entry.size) <= BigInt(maximumBytes);
  }

  async ownedDirectory(path: CanonicalAbsolutePathV1, identity: Identity | null = null): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.fs.lstat(path);
    if (entry?.kind !== "directory" || entry.ownerUid !== this.uid || entry.mode !== 0o700 || (identity !== null && !sameInode(entry, identity))) return refuseBundle("bundle_directory_identity", path);
    return entry;
  }

  async emptyDirectory(entry: LifecycleGuardedEntryV1): Promise<boolean> {
    for await (const name of this.fs.names(entry)) if (name.length > 0) return false;
    return true;
  }

  /** `O_CREAT | O_EXCL | O_NOFOLLOW`; the returned identity is journaled before byte zero. */
  async createEmpty(path: CanonicalAbsolutePathV1, mode: number): Promise<{ readonly handle: FileHandle; readonly entry: LifecycleGuardedEntryV1 }> {
    let handle: FileHandle;
    try {
      handle = await nodeFs.open(path, CREATE_FLAGS, mode);
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "EEXIST" || code === "ELOOP") refuseBundle("bundle_path_exists", path);
      throw error;
    }
    try {
      await handle.chmod(mode);
      const entry = entryOf(path, await handle.stat({ bigint: true }));
      if (!this.isBoundedRegular(entry, mode, 0)) refuseBundle("bundle_postimage", path);
      return { handle, entry };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** Reopens a completed write: same inode, exact length/mode, raw hash over the synced bytes. */
  async verifyWritten(created: Identity & { readonly path: CanonicalAbsolutePathV1 }, bytes: number, sha256: LowerHexSha256, mode: number): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.fs.lstat(created.path);
    if (!this.isBoundedRegular(entry, mode, bytes) || !sameInode(entry, created) || entry.size !== bytes.toString(10)) return refuseBundle("bundle_postimage", created.path);
    if ((await this.fs.hashRegular(entry, BigInt(bytes))) !== sha256) refuseBundle("bundle_postimage", created.path);
    return entry;
  }

  async readBounded(path: CanonicalAbsolutePathV1, mode: number, maximumBytes: number): Promise<{ readonly entry: LifecycleGuardedEntryV1; readonly bytes: Uint8Array } | null> {
    const entry = await this.fs.lstat(path);
    if (entry === null) return null;
    if (!this.isBoundedRegular(entry, mode, maximumBytes)) return refuseBundle("bundle_unbound", path);
    return { entry, bytes: await this.fs.readRegular(entry, maximumBytes) };
  }

  async removeFile(path: CanonicalAbsolutePathV1, mode: number, maximumBytes: number, identity: Identity | null): Promise<void> {
    const entry = await this.fs.lstat(path);
    if (entry === null) return;
    if (!this.isBoundedRegular(entry, mode, maximumBytes) || (identity !== null && !sameInode(entry, identity))) refuseBundle("bundle_unbound", path);
    const parent = await this.ownedDirectory(parentPath(path));
    await this.fs.unlinkExact(entry);
    await this.fs.syncDirectory(parent);
  }

  async removeDirectory(path: CanonicalAbsolutePathV1, identity: Identity): Promise<void> {
    const entry = await this.fs.lstat(path);
    if (entry === null) return;
    if (entry.kind !== "directory" || entry.ownerUid !== this.uid || entry.mode !== 0o700 || !sameInode(entry, identity)) refuseBundle("bundle_unbound", path);
    const parent = await this.ownedDirectory(parentPath(path));
    await this.fs.rmdirExactEmpty(entry);
    await this.fs.syncDirectory(parent);
  }

  /** Exact canonical bytes only: a decode that re-encodes to anything else is not this file. */
  decodeExact(bytes: Uint8Array, maximumBytes: number, path: string): unknown {
    const value = decodeCanonicalJson(bytes, maximumBytes);
    if (Buffer.compare(encoder.encode(encodeCanonicalJson(value)), bytes) !== 0) refuseBundle("bundle_not_canonical", path);
    return value;
  }

  /**
   * Streams one verified file into a created target with a running hash; the source must stay the
   * same bounded single-link inode, and a byte mismatch refuses before the evidence is written.
   */
  async copyVerified(from: CanonicalAbsolutePathV1, fromIdentity: Identity | null, target: FileHandle, entry: Extract<ReleaseBundleEntryV1, { readonly kind: "file" }>): Promise<void> {
    const source = await nodeFs.open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const observed = entryOf(from, await source.stat({ bigint: true }));
      if (observed.kind !== "regular_file" || observed.mode !== entry.mode || observed.nlink !== 1 || observed.size !== entry.bytes || (fromIdentity !== null && !sameInode(observed, fromIdentity))) refuseBundle("bundle_source_changed", from);
      const hash = createHash("sha256");
      const buffer = new Uint8Array(COPY_CHUNK_BYTES);
      const total = Number(entry.bytes);
      for (let offset = 0; offset < total;) {
        const { bytesRead } = await source.read(buffer, 0, Math.min(COPY_CHUNK_BYTES, total - offset), offset);
        if (bytesRead < 1) refuseBundle("bundle_source_changed", from);
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        for (let written = 0; written < bytesRead;) {
          const result = await target.write(chunk, written, bytesRead - written, offset + written);
          if (result.bytesWritten < 1) throw new Error("bundle participant write made no progress");
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      if (hash.digest("hex") !== entry.sha256) refuseBundle("bundle_source_changed", from);
      await target.sync();
    } finally {
      await source.close();
    }
  }
}

/**
 * A participant journal rewritten in place: the construction evidence binds its inode, so a
 * rename-over would be an unowned inode change. A write torn by death is a third state (exit 6).
 */
export class BundleJournalFile<TJournal> {
  readonly #io: BundleGuardedIo;
  readonly path: CanonicalAbsolutePathV1;
  readonly #maximumBytes: number;
  #entry: LifecycleGuardedEntryV1 | null = null;
  value: TJournal | null = null;

  constructor(io: BundleGuardedIo, path: CanonicalAbsolutePathV1, maximumBytes: number) {
    this.#io = io;
    this.path = path;
    this.#maximumBytes = maximumBytes;
  }

  async load(validate: (value: unknown) => TJournal): Promise<TJournal> {
    const found = await this.#io.readBounded(this.path, 0o600, this.#maximumBytes);
    if (found === null) return refuseBundle("bundle_journal_missing", this.path);
    this.value = validate(this.#io.decodeExact(found.bytes, this.#maximumBytes, this.path));
    this.#entry = found.entry;
    return this.value;
  }

  async write(value: TJournal, bytes: Uint8Array): Promise<void> {
    const entry = this.#entry;
    if (entry === null) return refuseBundle("bundle_journal_missing", this.path);
    if (bytes.byteLength > this.#maximumBytes) refuseBundle("bundle_journal_bound", this.path);
    const handle = await nodeFs.open(this.path, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      if (!sameInode(entryOf(this.path, await handle.stat({ bigint: true })), entry)) refuseBundle("bundle_journal_identity", this.path);
      await writeAll(handle, bytes);
      await handle.truncate(bytes.byteLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const reopened = await this.#io.fs.lstat(this.path);
    if (!this.#io.isBoundedRegular(reopened, 0o600, bytes.byteLength) || !sameInode(reopened, entry)) refuseBundle("bundle_journal_identity", this.path);
    this.#entry = reopened;
    this.value = value;
  }
}

/** Everything one recorded entry copy needs; the journal step callback owns persistence. */
export interface BundleEntryCopyV1 {
  readonly io: BundleGuardedIo;
  readonly entry: ReleaseBundleEntryV1;
  readonly from: CanonicalAbsolutePathV1;
  readonly fromIdentity: Identity | null;
  readonly target: CanonicalAbsolutePathV1;
  readonly targetParent: LifecycleGuardedEntryV1;
  readonly evidencePath: CanonicalAbsolutePathV1;
  readonly evidenceParent: LifecycleGuardedEntryV1;
  readonly evidenceBytes: (dev: UInt64DecimalV1, ino: UInt64DecimalV1) => Uint8Array;
  readonly advance: (step: UpdateEntryStepV1) => Promise<void>;
  readonly interrupt: (point: BundleEntryDeathPointV1) => void;
}

/** `entry_intent` → exclusive create → recorded inode → bytes → reopen → evidence → advance. */
export async function copyBundleEntry(copy: BundleEntryCopyV1): Promise<void> {
  const { io, entry } = copy;
  await copy.advance({ kind: "entry_intent" });
  let created: LifecycleGuardedEntryV1;
  if (entry.kind === "directory") {
    created = await io.fs.mkdirExclusive(copy.target);
    await copy.advance({ kind: "entry_created", dev: created.dev, ino: created.ino });
    copy.interrupt("entry_created");
  } else {
    const target = await io.createEmpty(copy.target, entry.mode);
    try {
      await copy.advance({ kind: "entry_created", dev: target.entry.dev, ino: target.entry.ino });
      copy.interrupt("entry_created");
      await io.copyVerified(copy.from, copy.fromIdentity, target.handle, entry);
      copy.interrupt("entry_written");
    } finally {
      await target.handle.close();
    }
    created = await io.verifyWritten(target.entry, Number(entry.bytes), entry.sha256, entry.mode);
  }
  await io.fs.syncDirectory(copy.targetParent);
  await writeEntryEvidence(copy, created);
}

/** `evidence_intent` → exclusive create → recorded inode → canonical bytes → reopen → `entry_complete`. */
export async function writeEntryEvidence(copy: Pick<BundleEntryCopyV1, "io" | "evidencePath" | "evidenceParent" | "evidenceBytes" | "advance" | "interrupt">, created: Identity): Promise<void> {
  const { io } = copy;
  const bytes = copy.evidenceBytes(created.dev as UInt64DecimalV1, created.ino as UInt64DecimalV1);
  await copy.advance({ kind: "evidence_intent" });
  const evidence = await io.createEmpty(copy.evidencePath, 0o600);
  try {
    await copy.advance({ kind: "evidence_created", dev: evidence.entry.dev, ino: evidence.entry.ino });
    copy.interrupt("evidence_created");
    await writeAll(evidence.handle, bytes);
    copy.interrupt("evidence_written");
  } finally {
    await evidence.handle.close();
  }
  await io.verifyWritten(evidence.entry, bytes.byteLength, sha256Hex(bytes), 0o600);
  await io.fs.syncDirectory(copy.evidenceParent);
  await copy.advance({ kind: "entry_complete" });
}

/**
 * An entry/evidence `*_intent` whose path is present binds only the exact empty attempt-created
 * object; the returned step records its identity before compensation may remove it.
 */
export async function bindEntryIntent(io: BundleGuardedIo, state: UpdateEntryWriteStateV1 | null, entry: ReleaseBundleEntryV1 | undefined, target: CanonicalAbsolutePathV1, evidencePath: CanonicalAbsolutePathV1): Promise<UpdateEntryStepV1 | null> {
  if (state?.state === "entry_intent" && entry !== undefined) {
    const found = await io.fs.lstat(target);
    if (found === null) return null;
    const empty = entry.kind === "directory"
      ? found.kind === "directory" && found.ownerUid === io.uid && found.mode === 0o700 && (await io.emptyDirectory(found))
      : io.isBoundedRegular(found, entry.mode, 0);
    if (!empty) refuseBundle("bundle_unbound", target);
    return { kind: "entry_created", dev: found.dev, ino: found.ino };
  }
  if (state?.state === "evidence_intent") {
    const found = await io.fs.lstat(evidencePath);
    if (found === null) return null;
    if (!io.isBoundedRegular(found, 0o600, 0)) refuseBundle("bundle_unbound", evidencePath);
    return { kind: "evidence_created", dev: found.dev, ino: found.ino };
  }
  return null;
}

/**
 * One reverse compensation/compaction part: the entry first under its in-flight or evidenced
 * identity, then its evidence. With the evidence already gone the entry was removed first, so
 * absence is then the only legal state.
 */
export async function removeBundleEntryPart(io: BundleGuardedIo, options: {
  readonly entry: ReleaseBundleEntryV1;
  readonly target: CanonicalAbsolutePathV1;
  readonly evidencePath: CanonicalAbsolutePathV1;
  readonly part: "entry" | "evidence";
  readonly inFlight: UpdateEntryWriteStateV1 | null;
  readonly evidencedIdentity: (bytes: Uint8Array) => Identity;
}): Promise<void> {
  const { entry, target, evidencePath, inFlight } = options;
  if (options.part === "evidence") {
    if (inFlight !== null) {
      if (inFlight.state === "evidence_created") await io.removeFile(evidencePath, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, { dev: inFlight.evidenceDev, ino: inFlight.evidenceIno });
      return;
    }
    const found = await io.readBounded(evidencePath, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    if (found === null) return;
    options.evidencedIdentity(found.bytes);
    await io.removeFile(evidencePath, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES, found.entry);
    return;
  }
  let identity: Identity | null;
  if (inFlight !== null) identity = inFlight.state === "entry_intent" ? null : inFlight;
  else {
    const found = await io.readBounded(evidencePath, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    identity = found === null ? null : options.evidencedIdentity(found.bytes);
  }
  if (identity === null) {
    if ((await io.fs.lstat(target)) !== null) refuseBundle("bundle_unbound", target);
    return;
  }
  if (entry.kind === "directory") await io.removeDirectory(target, identity);
  else await io.removeFile(target, entry.mode, Number(entry.bytes), identity);
}

function inFlightAt(state: UpdateEntryWriteStateV1 | null, ordinal: number): UpdateEntryWriteStateV1 | null {
  return state?.ordinal === ordinal ? state : null;
}

/**
 * Spec 2 §9.2's bundle source envelope: copies the already verified scratch extraction into the
 * product-owned `update/source/bundle/<id>/payload` before any outer intent. Every structure,
 * entry, evidence, and ready file has its inode journaled before byte zero; after process death
 * only `compensate` runs, and it removes recorded identities in exact reverse order.
 */
export class BundleSourceExecutor {
  readonly #dependencies: BundleParticipantDependenciesV1<BundleSourceDeathPointV1>;
  readonly #io: BundleGuardedIo;
  readonly #root: CanonicalAbsolutePathV1;

  constructor(dependencies: BundleParticipantDependenciesV1<BundleSourceDeathPointV1>, stagingRoot: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#io = new BundleGuardedIo(dependencies.fs, dependencies.effectiveUid);
    this.#root = parseCanonicalAbsolutePathText(stagingRoot);
  }

  #interrupt(point: BundleSourceDeathPointV1): void {
    this.#dependencies.interrupt?.(point);
  }

  async #open(value: BundleSourceStagingPlanV1): Promise<{ readonly plan: BundleSourceStagingPlanV1; readonly journal: BundleJournalFile<BundleSourceStagingJournalV1> }> {
    const plan = validateBundleSourceStagingPlan(value, this.#root);
    const journal = new BundleJournalFile<BundleSourceStagingJournalV1>(this.#io, updateParticipantJournalPath(this.#root, "bundle_source_staging", plan.id), plan.maximumJournalBytes);
    await journal.load((input) => validateBundleSourceJournal(input, plan));
    return { plan, journal };
  }

  async #advance(plan: BundleSourceStagingPlanV1, file: BundleJournalFile<BundleSourceStagingJournalV1>, step: BundleSourceStepV1): Promise<BundleSourceStagingJournalV1> {
    const current = file.value as BundleSourceStagingJournalV1;
    const next = advanceBundleSourceJournal(plan, current, step, stampAfter(this.#dependencies.now, current.updatedAt));
    await file.write(next, bundleSourceJournalBytes(next));
    this.#interrupt("journal_rewritten");
    return next;
  }

  /** `update/source/bundle`, bound by the plan's parent identity before the envelope exists. */
  async #sourceParent(plan: BundleSourceStagingPlanV1): Promise<LifecycleGuardedEntryV1> {
    return this.#io.ownedDirectory(bundleSourcePaths(this.#root, plan.id).parent, { dev: plan.sourceParentDev, ino: plan.sourceParentIno });
  }

  async #structure(journal: BundleSourceStagingJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const identity = journal.structureIdentities[ordinal];
    if (identity === undefined) return refuseBundle("bundle_source_structure", this.#root);
    return this.#io.ownedDirectory(identity.path, identity);
  }

  /** A root child's parent is the payload root; any other parent is the evidenced directory entry. */
  async #entryParent(plan: BundleSourceStagingPlanV1, journal: BundleSourceStagingJournalV1, ordinal: number): Promise<LifecycleGuardedEntryV1> {
    const parent = bundleEntryParentOrdinal(plan.entries, ordinal);
    if (parent === null) return this.#structure(journal, 1);
    const found = await this.#io.readBounded(bundleSourceEvidencePath(plan, parent), 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    if (found === null) return refuseBundle("bundle_source_parent", plan.sourceRoot);
    const evidence = validateDurableSourceEntryEvidence(found.bytes, plan, parent);
    return this.#io.ownedDirectory(sourceEntryPath(plan, parent), evidence);
  }

  /**
   * Structures, then every entry in inventory order, then ready evidence. Legal only from the
   * construction-published initial journal in the still-running originating process.
   */
  async stage(value: BundleSourceStagingPlanV1, source: VerifiedScratchBundleV1): Promise<BundleSourceReadyEvidenceV1> {
    const { plan, journal: file } = await this.#open(value);
    if ((file.value as BundleSourceStagingJournalV1).phase !== "planned") refuseBundle("bundle_source_not_fresh", file.path);
    if (source.entries !== plan.entries.length) refuseBundle("bundle_source_scratch", source.root);
    const structures = bundleSourceStructures(plan);
    for (let journal = file.value as BundleSourceStagingJournalV1; journal.nextStructure < 3; journal = file.value as BundleSourceStagingJournalV1) {
      const parent = journal.nextStructure === 0 ? await this.#sourceParent(plan) : await this.#structure(journal, 0);
      await this.#advance(plan, file, { kind: "structure_intent" });
      const created = await this.#io.fs.mkdirExclusive((structures[journal.nextStructure] as (typeof structures)[number]).path);
      this.#interrupt("structure_made");
      await this.#io.fs.syncDirectory(parent);
      await this.#advance(plan, file, { kind: "structure_created", dev: created.dev, ino: created.ino });
      await this.#advance(plan, file, { kind: "structure_complete" });
    }
    for (let journal = file.value as BundleSourceStagingJournalV1; journal.nextEntry < plan.entries.length; journal = file.value as BundleSourceStagingJournalV1) {
      const ordinal = journal.nextEntry;
      const entry = plan.entries[ordinal] as ReleaseBundleEntryV1;
      await copyBundleEntry({
        io: this.#io,
        entry,
        from: parseCanonicalAbsolutePathText(`${source.root}/${entry.path}`),
        fromIdentity: null,
        target: sourceEntryPath(plan, ordinal),
        targetParent: await this.#entryParent(plan, journal, ordinal),
        evidencePath: bundleSourceEvidencePath(plan, ordinal),
        evidenceParent: await this.#structure(journal, 2),
        evidenceBytes: (dev, ino) => durableEntryEvidenceBytes(durableSourceEntryEvidence(plan, ordinal, dev, ino)),
        advance: async (step) => {
          await this.#advance(plan, file, step);
        },
        interrupt: (point) => {
          this.#interrupt(point);
        },
      });
    }
    return this.#publishReady(plan, file);
  }

  async #publishReady(plan: BundleSourceStagingPlanV1, file: BundleJournalFile<BundleSourceStagingJournalV1>): Promise<BundleSourceReadyEvidenceV1> {
    const evidence = bundleSourceReadyEvidence(plan, file.value as BundleSourceStagingJournalV1, await bundleSourceEvidenceSetHash(this.#io, plan));
    const bytes = bundleSourceReadyEvidenceBytes(evidence);
    const parent = await this.#sourceParent(plan);
    await this.#advance(plan, file, { kind: "ready_intent" });
    const ready = await this.#io.createEmpty(bundleSourcePaths(this.#root, plan.id).ready, 0o600);
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

  async #bindIntents(plan: BundleSourceStagingPlanV1, file: BundleJournalFile<BundleSourceStagingJournalV1>): Promise<void> {
    const journal = file.value as BundleSourceStagingJournalV1;
    if (journal.structureWriteState?.state === "create_intent") {
      const path = (bundleSourceStructures(plan)[journal.nextStructure] as { readonly path: CanonicalAbsolutePathV1 }).path;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (found.kind !== "directory" || found.ownerUid !== this.#io.uid || found.mode !== 0o700 || !(await this.#io.emptyDirectory(found))) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "structure_created", dev: found.dev, ino: found.ino });
      }
    }
    const state = (file.value as BundleSourceStagingJournalV1).entryWriteState;
    if (state !== null) {
      const step = await bindEntryIntent(this.#io, state, plan.entries[state.ordinal], sourceEntryPath(plan, state.ordinal), bundleSourceEvidencePath(plan, state.ordinal));
      if (step !== null) await this.#advance(plan, file, step);
    }
    if ((file.value as BundleSourceStagingJournalV1).readyWriteState?.state === "create_intent") {
      const path = bundleSourcePaths(this.#root, plan.id).ready;
      const found = await this.#io.fs.lstat(path);
      if (found !== null) {
        if (!this.#io.isBoundedRegular(found, 0o600, 0)) refuseBundle("bundle_unbound", path);
        await this.#advance(plan, file, { kind: "ready_created", dev: found.dev, ino: found.ino });
      }
    }
  }

  /**
   * Compensation-only recovery for any reached prefix, including `source_ready` before an outer
   * plan exists: ready evidence, then entries (entry, then evidence) in reverse, then structures
   * in reverse. It never resumes a copy, re-reads scratch, or adopts an unrecorded path.
   */
  async compensate(value: BundleSourceStagingPlanV1): Promise<void> {
    const { plan, journal: file } = await this.#open(value);
    const phase = (file.value as BundleSourceStagingJournalV1).phase;
    if (phase === "rolled_back") return;
    if (phase === "compacting") refuseBundle("bundle_source_compacting", file.path);
    if (phase !== "compensating") {
      await this.#bindIntents(plan, file);
      await this.#advance(plan, file, { kind: "compensate" });
    }
    const readyJournal = file.value as BundleSourceStagingJournalV1;
    const ready = readyJournal.readyIdentity ?? (readyJournal.readyWriteState?.state === "created" ? readyJournal.readyWriteState : null);
    if (ready !== null || readyJournal.readyWriteState !== null) {
      if (ready !== null) await this.#io.removeFile(bundleSourcePaths(this.#root, plan.id).ready, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES, ready);
      await this.#advance(plan, file, { kind: "ready_removed" });
      this.#interrupt("ready_removed");
    }
    for (let journal = file.value as BundleSourceStagingJournalV1; journal.phase === "compensating"; journal = file.value as BundleSourceStagingJournalV1) {
      const at = journal.compensationNext as number;
      if (at >= 0) {
        await removeBundleEntryPart(this.#io, {
          entry: plan.entries[at] as ReleaseBundleEntryV1,
          target: sourceEntryPath(plan, at),
          evidencePath: bundleSourceEvidencePath(plan, at),
          part: journal.compensationPart as "entry" | "evidence",
          inFlight: inFlightAt(journal.entryWriteState, at),
          evidencedIdentity: (bytes) => validateDurableSourceEntryEvidence(bytes, plan, at),
        });
      } else if ((journal.compensationStructureNext as number) >= 0) {
        await this.#removeStructure(plan, journal, journal.compensationStructureNext as number);
      }
      await this.#advance(plan, file, { kind: "compensation_step" });
      this.#interrupt("compensation_step");
    }
  }

  async #removeStructure(plan: BundleSourceStagingPlanV1, journal: BundleSourceStagingJournalV1, ordinal: number): Promise<void> {
    const inFlight = journal.structureWriteState?.state === "created" && journal.structureWriteState.ordinal === ordinal ? journal.structureWriteState : null;
    const identity = inFlight ?? journal.structureIdentities[ordinal];
    const path = (bundleSourceStructures(plan)[ordinal] as { readonly path: CanonicalAbsolutePathV1 }).path;
    if (identity === undefined) return refuseBundle("bundle_unbound", path);
    await this.#io.removeDirectory(path, identity);
  }

  /**
   * Terminal compaction after the target bundle is published and verified: ready evidence, reverse
   * entries then evidence, then structures. The enclosing construction cursor removes the journal
   * and immutable plan afterwards.
   */
  async compact(value: BundleSourceStagingPlanV1): Promise<void> {
    const { plan, journal: file } = await this.#open(value);
    const phase = (file.value as BundleSourceStagingJournalV1).phase;
    if (phase === "source_ready") await this.#advance(plan, file, { kind: "compaction_step" });
    else if (phase !== "compacting") refuseBundle("bundle_source_not_ready", file.path);
    const last = 2 * plan.entries.length + 4;
    for (let journal = file.value as BundleSourceStagingJournalV1; (journal.compactionNext as number) < last; journal = file.value as BundleSourceStagingJournalV1) {
      const target = bundleSourceCompactionTarget(plan, journal.compactionNext as number);
      if (target.kind === "ready") {
        await this.#io.removeFile(bundleSourcePaths(this.#root, plan.id).ready, 0o600, MAXIMUM_SOURCE_READY_EVIDENCE_BYTES, journal.readyIdentity);
      } else if (target.kind === "structure") {
        await this.#removeStructure(plan, journal, target.ordinal);
      } else {
        const ordinal = target.ordinal;
        if (target.kind === "entry" && (await this.#io.fs.lstat(bundleSourceEvidencePath(plan, ordinal))) === null) refuseBundle("bundle_unbound", bundleSourceEvidencePath(plan, ordinal));
        await removeBundleEntryPart(this.#io, {
          entry: plan.entries[ordinal] as ReleaseBundleEntryV1,
          target: sourceEntryPath(plan, ordinal),
          evidencePath: bundleSourceEvidencePath(plan, ordinal),
          part: target.kind,
          inFlight: null,
          evidencedIdentity: (bytes) => validateDurableSourceEntryEvidence(bytes, plan, ordinal),
        });
      }
      await this.#advance(plan, file, { kind: "compaction_step" });
      this.#interrupt("compaction_step");
    }
  }
}

export function sourceEntryPath(plan: BundleSourceStagingPlanV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.sourceRoot}/${(plan.entries[ordinal] as ReleaseBundleEntryV1).path}`);
}

/** Recomputes the evidence-set hash over the exact, complete, contiguous evidence files. */
export async function bundleSourceEvidenceSetHash(io: BundleGuardedIo, plan: BundleSourceStagingPlanV1): Promise<LowerHexSha256> {
  const hashes: LowerHexSha256[] = [];
  for (let ordinal = 0; ordinal < plan.entries.length; ordinal += 1) {
    const path = bundleSourceEvidencePath(plan, ordinal);
    const found = await io.readBounded(path, 0o600, MAXIMUM_DURABLE_ENTRY_EVIDENCE_BYTES);
    if (found === null) return refuseBundle("bundle_source_evidence_missing", path);
    const evidence = validateDurableSourceEntryEvidence(found.bytes, plan, ordinal);
    const target = await io.fs.lstat(sourceEntryPath(plan, ordinal));
    if (target === null || !sameInode(target, evidence)) refuseBundle("bundle_source_identity", sourceEntryPath(plan, ordinal));
    hashes.push(sha256Hex(found.bytes));
  }
  return updateSourceEvidenceSetHash(hashes);
}
