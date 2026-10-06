import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  encodeTenDigitOrdinal,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  validateBundleManifest,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LowerHexSha256,
  ReleaseBundleEntryV1,
  ReleaseBundleManifestV1,
  ReleaseBundleReferenceV1,
  UInt64DecimalV1,
  UtcTimestampV1,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import { ZstdUstarAdmission } from "./archive.js";
import type { BoundedReleaseResponseV1, ReleaseBodySink } from "./transport.js";

export type ReleasePlanningAttemptIdV1 = `rp_${string}`;

export interface ReleaseScratchIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ReleasePlanningScratchV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly planPath: CanonicalAbsolutePathV1;
  readonly journalPath: CanonicalAbsolutePathV1;
  readonly parentDev: UInt64DecimalV1;
  readonly parentIno: UInt64DecimalV1;
  readonly rootExpectedBefore: "absent";
  readonly ownerUid: number;
  readonly mode: 448;
  readonly archive: { readonly path: "archive.zst"; readonly bytes: UInt64DecimalV1; readonly sha256: LowerHexSha256 };
  readonly manifestHash: LowerHexSha256;
  readonly manifest: ReleaseBundleManifestV1;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
  readonly maximumScratchBytes: number;
}

export type ReleaseScratchPathWriteStateV1 =
  | { readonly state: "create_intent" }
  | { readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };

export type ReleaseScratchEntryWriteStateV1 =
  | { readonly ordinal: number; readonly state: "create_intent" }
  | { readonly ordinal: number; readonly state: "created"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | { readonly ordinal: number; readonly state: "evidence_intent"; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }
  | {
      readonly ordinal: number;
      readonly state: "evidence_created";
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
      readonly evidenceDev: UInt64DecimalV1;
      readonly evidenceIno: UInt64DecimalV1;
    };

export type ReleasePlanningScratchPhaseV1 = "planned" | "downloading" | "extracting" | "verified" | "cleaning" | "cleaned";

export interface ReleasePlanningScratchJournalV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly planHash: LowerHexSha256;
  readonly planIdentity: ReleaseScratchIdentityV1;
  readonly phase: ReleasePlanningScratchPhaseV1;
  readonly rootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly extractedRootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly evidenceRootWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly archiveWriteState: ReleaseScratchPathWriteStateV1 | null;
  readonly archiveIdentity: ReleaseScratchIdentityV1 | null;
  readonly archiveBytesWritten: UInt64DecimalV1;
  readonly nextExtractedEntry: number;
  readonly entryWriteState: ReleaseScratchEntryWriteStateV1 | null;
  readonly cleanupNext: number | null;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface ReleaseScratchEntryEvidenceV1 {
  readonly schemaVersion: 1;
  readonly id: ReleasePlanningAttemptIdV1;
  readonly planHash: LowerHexSha256;
  readonly ordinal: number;
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory";
  readonly mode: 384 | 448;
  readonly bytes: number;
  readonly sha256: LowerHexSha256 | null;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

/** The extracted bundle a later planner/verifier may read; `root` is the attempt's `extracted` directory. */
export interface VerifiedScratchBundleV1 {
  readonly id: ReleasePlanningAttemptIdV1;
  readonly planHash: LowerHexSha256;
  readonly manifestHash: LowerHexSha256;
  readonly root: CanonicalAbsolutePathV1;
  readonly entries: number;
}

export interface ReleasePlanningScratchRequestV1 {
  readonly archive: { readonly bytes: UInt64DecimalV1; readonly sha256: LowerHexSha256 };
  readonly manifestHash: LowerHexSha256;
  readonly manifest: ReleaseBundleManifestV1;
  readonly maximumScratchBytes: number;
}

/** Every durable step, so a test can die exactly after it (the allocator's `afterBoundary` precedent). */
export type ReleaseScratchBoundaryV1 =
  | "plan_temp_written"
  | "plan_published"
  | "journal_published"
  | "root_intent"
  | "root_created"
  | "root_recorded"
  | "extracted_intent"
  | "extracted_created"
  | "extracted_recorded"
  | "evidence_root_intent"
  | "evidence_root_created"
  | "evidence_root_recorded"
  | "archive_intent"
  | "archive_created"
  | "archive_recorded"
  | "archive_complete"
  | "extracting"
  | "entry_intent"
  | "entry_created"
  | "entry_recorded"
  | "entry_written"
  | "evidence_intent"
  | "evidence_created"
  | "evidence_recorded"
  | "entry_advanced"
  | "verified"
  | "cleaning"
  | "cleanup_step"
  | "cleaned"
  | "plan_removed";

export interface ReleasePlanningScratchStoreDependencies {
  /** Composed with the platform's no-replace publication; the system temp must be an owner-only `0700` directory. */
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly systemTemp: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
  readonly uuid: () => string;
  /** Wall-clock `UtcTimestampV1` text for journal timestamps only. */
  readonly clock: () => string;
  readonly afterBoundary?: (boundary: ReleaseScratchBoundaryV1) => void | Promise<void>;
  /**
   * Non-blocking exclusive lock on the attempt's sibling `.lock` file, created if absent; null
   * when another live process holds it. The attempt holds it for its whole lifetime, so recovery
   * cleans only an attempt whose owner is gone (§7.2 "after process death", NEW-173).
   */
  readonly tryLock: (path: CanonicalAbsolutePathV1) => Promise<ReleaseScratchLockV1 | null>;
}

/** A held attempt lock; released by closing it, and with the process on death. Idempotent. */
export interface ReleaseScratchLockV1 {
  release(): Promise<void>;
}

/** The attempt's lock file beside its journal; never in the plan, whose keys are exact. */
export function releasePlanningScratchLockPath(journalPath: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(journalPath.replace(/\.journal\.json$/u, ".lock"));
}

/** Removes a held attempt's lock file, then releases it; a held lock is never left behind unnamed for another holder. */
async function dropLock(fs: LifecycleGuardedFileSystemV1, parent: LifecycleGuardedEntryV1, path: CanonicalAbsolutePathV1, lock: ReleaseScratchLockV1): Promise<void> {
  try {
    const entry = await fs.lstat(path);
    if (entry !== null) {
      await fs.unlinkExact(entry);
      await fs.syncDirectory(parent);
    }
  } finally {
    await lock.release();
  }
}

const MAXIMUM_PLAN_BYTES = 20_971_520;
const MAXIMUM_JOURNAL_BYTES = 1_048_576;
const MAXIMUM_SCRATCH_BYTES = 12_884_901_888;
const MAXIMUM_EVIDENCE_BYTES = 1_024;
const MAXIMUM_ENTRY_BYTES = 536_870_912;
const MAXIMUM_ENTRIES = 200_000;
const MAXIMUM_CANDIDATES = 32;
const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_V4 = new RegExp(`^${UUID_V4_SOURCE}$`);
const PHASES: readonly ReleasePlanningScratchPhaseV1[] = ["planned", "downloading", "extracting", "verified", "cleaning", "cleaned"];
const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const encoder = new TextEncoder();

type UnknownRecord = Readonly<Record<string, unknown>>;

function invalid(label: string): never {
  throw new Error(`invalid ${label}`);
}

/** A third state: preserved, content-free, exit 6. */
function recovery(reason: string): never {
  throw new LifecycleRecoveryRequiredError(reason, []);
}

function exact(value: unknown, label: string, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(label);
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid(label);
  return value as UnknownRecord;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label);
  return value;
}

function identity(value: unknown, label: string): ReleaseScratchIdentityV1 {
  const input = exact(value, label, ["dev", "ino"]);
  return { dev: parseUInt64Decimal(input.dev), ino: parseUInt64Decimal(input.ino) };
}

function sameIdentity(left: ReleaseScratchIdentityV1 | null, right: ReleaseScratchIdentityV1 | null): boolean {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
}

function sha256(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
}

export function parseReleasePlanningAttemptId(value: unknown): ReleasePlanningAttemptIdV1 {
  if (typeof value !== "string" || !value.startsWith("rp_") || !UUID_V4.test(value.slice(3))) invalid("ReleasePlanningAttemptIdV1");
  return value as ReleasePlanningAttemptIdV1;
}

/** §7.2's exact names: the root and its two sibling dot-files under the canonical system temp. */
export function releasePlanningScratchPaths(
  systemTemp: CanonicalAbsolutePathV1,
  effectiveUid: number,
  id: ReleasePlanningAttemptIdV1,
): { readonly root: CanonicalAbsolutePathV1; readonly planPath: CanonicalAbsolutePathV1; readonly journalPath: CanonicalAbsolutePathV1 } {
  const stem = `developer-os-release-planning-v1-${effectiveUid.toString(10)}-${parseReleasePlanningAttemptId(id).slice(3)}`;
  return {
    root: parseCanonicalAbsolutePathText(`${systemTemp}/${stem}`),
    planPath: parseCanonicalAbsolutePathText(`${systemTemp}/.${stem}.plan.json`),
    journalPath: parseCanonicalAbsolutePathText(`${systemTemp}/.${stem}.journal.json`),
  };
}

export function validateReleasePlanningScratch(value: unknown): ReleasePlanningScratchV1 {
  const input = exact(value, "ReleasePlanningScratchV1", [
    "schemaVersion", "id", "root", "planPath", "journalPath", "parentDev", "parentIno", "rootExpectedBefore",
    "ownerUid", "mode", "archive", "manifestHash", "manifest", "maximumPlanBytes", "maximumJournalBytes", "maximumScratchBytes",
  ]);
  if (input.schemaVersion !== 1 || input.rootExpectedBefore !== "absent" || input.mode !== 448) invalid("ReleasePlanningScratchV1");
  const id = parseReleasePlanningAttemptId(input.id);
  const ownerUid = integer(input.ownerUid, "ReleasePlanningScratchV1.ownerUid", 0, 4_294_967_295);
  const root = parseCanonicalAbsolutePathText(input.root);
  const systemTemp = parseCanonicalAbsolutePathText(root.slice(0, root.lastIndexOf("/")));
  const derived = releasePlanningScratchPaths(systemTemp, ownerUid, id);
  if (derived.root !== root || derived.planPath !== input.planPath || derived.journalPath !== input.journalPath) invalid("ReleasePlanningScratchV1 paths");
  const archive = exact(input.archive, "ReleasePlanningScratchV1.archive", ["path", "bytes", "sha256"]);
  if (archive.path !== "archive.zst") invalid("ReleasePlanningScratchV1.archive");
  const manifest = validateBundleManifest(input.manifest);
  return {
    schemaVersion: 1,
    id,
    root,
    planPath: derived.planPath,
    journalPath: derived.journalPath,
    parentDev: parseUInt64Decimal(input.parentDev),
    parentIno: parseUInt64Decimal(input.parentIno),
    rootExpectedBefore: "absent",
    ownerUid,
    mode: 448,
    archive: { path: "archive.zst", bytes: parseUInt64Decimal(archive.bytes), sha256: parseLowerHexSha256(archive.sha256) },
    manifestHash: parseLowerHexSha256(input.manifestHash),
    manifest,
    maximumPlanBytes: integer(input.maximumPlanBytes, "ReleasePlanningScratchV1.maximumPlanBytes", 1, MAXIMUM_PLAN_BYTES),
    maximumJournalBytes: integer(input.maximumJournalBytes, "ReleasePlanningScratchV1.maximumJournalBytes", 1, MAXIMUM_JOURNAL_BYTES),
    maximumScratchBytes: integer(input.maximumScratchBytes, "ReleasePlanningScratchV1.maximumScratchBytes", 1, MAXIMUM_SCRATCH_BYTES),
  };
}

function pathState(value: unknown, label: string): ReleaseScratchPathWriteStateV1 | null {
  if (value === null) return null;
  const input = value as UnknownRecord;
  if (input.state === "create_intent") {
    exact(value, label, ["state"]);
    return { state: "create_intent" };
  }
  exact(value, label, ["state", "dev", "ino"]);
  if (input.state !== "created") invalid(label);
  return { state: "created", ...identity({ dev: input.dev, ino: input.ino }, label) };
}

function entryState(value: unknown, entries: number): ReleaseScratchEntryWriteStateV1 | null {
  const label = "ReleaseScratchEntryWriteStateV1";
  if (value === null) return null;
  const input = value as UnknownRecord;
  const keys = {
    create_intent: ["ordinal", "state"],
    created: ["ordinal", "state", "dev", "ino"],
    evidence_intent: ["ordinal", "state", "dev", "ino"],
    evidence_created: ["ordinal", "state", "dev", "ino", "evidenceDev", "evidenceIno"],
  }[String(input.state)];
  if (keys === undefined) invalid(label);
  exact(value, label, keys);
  const ordinal = integer(input.ordinal, label, 0, Math.min(entries, MAXIMUM_ENTRIES) - 1);
  if (input.state === "create_intent") return { ordinal, state: "create_intent" };
  const target = identity({ dev: input.dev, ino: input.ino }, label);
  if (input.state === "created" || input.state === "evidence_intent") return { ordinal, state: input.state, ...target };
  const evidence = identity({ dev: input.evidenceDev, ino: input.evidenceIno }, label);
  return { ordinal, state: "evidence_created", ...target, evidenceDev: evidence.dev, evidenceIno: evidence.ino };
}

function createdIdentity(state: ReleaseScratchPathWriteStateV1 | null): ReleaseScratchIdentityV1 | null {
  return state?.state === "created" ? { dev: state.dev, ino: state.ino } : null;
}

/**
 * The linear journal grammar: each phase owns only its fields, every other
 * field is null/zero or the immutable identity prefix an earlier phase
 * recorded, and the first cursor or byte beyond its plan-derived bound refuses.
 * `cleaning`/`cleaned` freeze whatever prefix was reached and add only `cleanupNext`.
 */
export function validateReleasePlanningScratchJournal(
  value: unknown,
  plan: ReleasePlanningScratchV1,
  planHash: LowerHexSha256,
): ReleasePlanningScratchJournalV1 {
  const label = "ReleasePlanningScratchJournalV1";
  const input = exact(value, label, [
    "schemaVersion", "id", "planHash", "planIdentity", "phase", "rootWriteState", "extractedRootWriteState",
    "evidenceRootWriteState", "archiveWriteState", "archiveIdentity", "archiveBytesWritten", "nextExtractedEntry",
    "entryWriteState", "cleanupNext", "createdAt", "updatedAt",
  ]);
  const entries = plan.manifest.entries.length;
  const phase = PHASES.find((candidate) => candidate === input.phase);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.planHash !== planHash || phase === undefined) invalid(label);
  const journal: ReleasePlanningScratchJournalV1 = {
    schemaVersion: 1,
    id: plan.id,
    planHash,
    planIdentity: identity(input.planIdentity, `${label}.planIdentity`),
    phase,
    rootWriteState: pathState(input.rootWriteState, `${label}.rootWriteState`),
    extractedRootWriteState: pathState(input.extractedRootWriteState, `${label}.extractedRootWriteState`),
    evidenceRootWriteState: pathState(input.evidenceRootWriteState, `${label}.evidenceRootWriteState`),
    archiveWriteState: pathState(input.archiveWriteState, `${label}.archiveWriteState`),
    archiveIdentity: input.archiveIdentity === null ? null : identity(input.archiveIdentity, `${label}.archiveIdentity`),
    archiveBytesWritten: parseUInt64Decimal(input.archiveBytesWritten),
    nextExtractedEntry: integer(input.nextExtractedEntry, `${label}.nextExtractedEntry`, 0, entries),
    entryWriteState: entryState(input.entryWriteState, entries),
    cleanupNext: input.cleanupNext === null ? null : integer(input.cleanupNext, `${label}.cleanupNext`, 0, 2 * MAXIMUM_ENTRIES + 4),
    createdAt: parseUtcTimestamp(input.createdAt),
    updatedAt: parseUtcTimestamp(input.updatedAt),
  };
  if (journal.updatedAt < journal.createdAt) invalid(`${label} timestamps`);

  const structure = [journal.rootWriteState, journal.extractedRootWriteState, journal.evidenceRootWriteState];
  structure.forEach((state, index) => {
    if (state !== null && structure.slice(0, index).some((prior) => prior?.state !== "created")) invalid(`${label} structure prefix`);
  });
  const structureComplete = structure.every((state) => state?.state === "created");
  const archive = createdIdentity(journal.archiveWriteState);
  if (journal.archiveWriteState !== null && !structureComplete) invalid(`${label} archive before structure`);
  if ((archive === null) !== (journal.archiveIdentity === null) || (archive !== null && !sameIdentity(archive, journal.archiveIdentity))) {
    invalid(`${label} archive identity`);
  }
  const written = BigInt(journal.archiveBytesWritten);
  if (written > BigInt(plan.archive.bytes) || (written > 0n && archive === null)) invalid(`${label} archive bytes`);
  const archiveComplete = archive !== null && written === BigInt(plan.archive.bytes);
  if ((journal.nextExtractedEntry > 0 || journal.entryWriteState !== null) && !archiveComplete) invalid(`${label} extraction before archive`);
  if (journal.entryWriteState !== null && journal.entryWriteState.ordinal !== journal.nextExtractedEntry) invalid(`${label} entry cursor`);
  if ((journal.cleanupNext === null) !== (phase !== "cleaning" && phase !== "cleaned")) invalid(`${label} cleanup cursor`);

  const phaseHolds = {
    planned: journal.archiveWriteState === null && written === 0n && journal.nextExtractedEntry === 0 && journal.entryWriteState === null,
    downloading: structureComplete && journal.nextExtractedEntry === 0 && journal.entryWriteState === null,
    extracting: archiveComplete,
    verified: archiveComplete && journal.nextExtractedEntry === entries && journal.entryWriteState === null,
    cleaning: true,
    cleaned: true,
  }[phase];
  if (!phaseHolds) invalid(`${label} phase`);
  if (journal.cleanupNext !== null) {
    const length = releaseScratchCleanupListLength(journal);
    if (journal.cleanupNext > length || (phase === "cleaned" && journal.cleanupNext !== length)) invalid(`${label} cleanup cursor`);
  }
  return journal;
}

export function validateReleaseScratchEntryEvidence(value: unknown): ReleaseScratchEntryEvidenceV1 {
  const label = "ReleaseScratchEntryEvidenceV1";
  const input = exact(value, label, ["schemaVersion", "id", "planHash", "ordinal", "pathHash", "kind", "mode", "bytes", "sha256", "dev", "ino"]);
  if (input.schemaVersion !== 1 || (input.kind !== "file" && input.kind !== "directory") || (input.mode !== 384 && input.mode !== 448)) invalid(label);
  const bytes = integer(input.bytes, label, 0, MAXIMUM_ENTRY_BYTES);
  const hash = input.sha256 === null ? null : parseLowerHexSha256(input.sha256);
  if (input.kind === "directory" && (input.mode !== 448 || bytes !== 0 || hash !== null)) invalid(label);
  if (input.kind === "file" && hash === null) invalid(label);
  return {
    schemaVersion: 1,
    id: parseReleasePlanningAttemptId(input.id),
    planHash: parseLowerHexSha256(input.planHash),
    ordinal: integer(input.ordinal, label, 0, MAXIMUM_ENTRIES - 1),
    pathHash: parseLowerHexSha256(input.pathHash),
    kind: input.kind,
    mode: input.mode,
    bytes,
    sha256: hash,
    ...identity({ dev: input.dev, ino: input.ino }, label),
  };
}

export interface ReleaseScratchPathCleanupItemV1 {
  readonly kind: "path";
  readonly path: CanonicalAbsolutePathV1;
  readonly expected: "directory" | "regular_file";
  readonly mode: number;
  readonly maximumBytes: bigint;
  readonly state: ReleaseScratchPathWriteStateV1;
}

export type ReleaseScratchCleanupItemV1 =
  | ReleaseScratchPathCleanupItemV1
  | { readonly kind: "completed_target" | "completed_evidence"; readonly ordinal: number };

/** The derived list's length without materializing it, so every journal rewrite can bound `cleanupNext` in O(1). */
function releaseScratchCleanupListLength(journal: ReleasePlanningScratchJournalV1): number {
  const current = journal.entryWriteState;
  const microstate = current === null ? 0 : current.state === "evidence_intent" || current.state === "evidence_created" ? 2 : 1;
  const structure = [journal.archiveWriteState, journal.extractedRootWriteState, journal.evidenceRootWriteState, journal.rootWriteState];
  return microstate + 2 * journal.nextExtractedEntry + structure.filter((state) => state !== null).length;
}

function entryPath(plan: ReleasePlanningScratchV1, entry: ReleaseBundleEntryV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.root}/extracted/${entry.path}`);
}

function evidencePath(plan: ReleasePlanningScratchV1, ordinal: number): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.root}/evidence/${encodeTenDigitOrdinal(ordinal)}.json`);
}

function entryTarget(plan: ReleasePlanningScratchV1, ordinal: number, state: ReleaseScratchPathWriteStateV1): ReleaseScratchPathCleanupItemV1 {
  const entry = plan.manifest.entries[ordinal] as ReleaseBundleEntryV1;
  return {
    kind: "path",
    path: entryPath(plan, entry),
    expected: entry.kind === "directory" ? "directory" : "regular_file",
    mode: entry.mode === 448 ? 0o700 : 0o600,
    maximumBytes: entry.kind === "file" ? BigInt(entry.bytes) : 0n,
    state,
  };
}

/**
 * §7.2's unique reached list: current microstate target then evidence; completed
 * entries in reverse ordinal order, each target then evidence; archive;
 * `extracted`; `evidence`; root. Nothing outside it is ever deleted.
 */
export function deriveReleaseScratchCleanupList(
  plan: ReleasePlanningScratchV1,
  journal: ReleasePlanningScratchJournalV1,
): readonly ReleaseScratchCleanupItemV1[] {
  const items: ReleaseScratchCleanupItemV1[] = [];
  const current = journal.entryWriteState;
  if (current !== null) {
    items.push(entryTarget(plan, current.ordinal, current.state === "create_intent" ? { state: "create_intent" } : { state: "created", dev: current.dev, ino: current.ino }));
    const evidence = (state: ReleaseScratchPathWriteStateV1): ReleaseScratchPathCleanupItemV1 => ({
      kind: "path",
      path: evidencePath(plan, current.ordinal),
      expected: "regular_file",
      mode: 0o600,
      maximumBytes: BigInt(MAXIMUM_EVIDENCE_BYTES),
      state,
    });
    if (current.state === "evidence_intent") items.push(evidence({ state: "create_intent" }));
    if (current.state === "evidence_created") items.push(evidence({ state: "created", dev: current.evidenceDev, ino: current.evidenceIno }));
  }
  for (let ordinal = journal.nextExtractedEntry - 1; ordinal >= 0; ordinal -= 1) {
    items.push({ kind: "completed_target", ordinal }, { kind: "completed_evidence", ordinal });
  }
  const structure: readonly [ReleaseScratchPathWriteStateV1 | null, string, "directory" | "regular_file", number, bigint][] = [
    [journal.archiveWriteState, `${plan.root}/${plan.archive.path}`, "regular_file", 0o600, BigInt(plan.archive.bytes)],
    [journal.extractedRootWriteState, `${plan.root}/extracted`, "directory", 0o700, 0n],
    [journal.evidenceRootWriteState, `${plan.root}/evidence`, "directory", 0o700, 0n],
    [journal.rootWriteState, plan.root, "directory", 0o700, 0n],
  ];
  for (const [state, path, expected, mode, maximumBytes] of structure) {
    if (state !== null) items.push({ kind: "path", path: parseCanonicalAbsolutePathText(path), expected, mode, maximumBytes, state });
  }
  return items;
}

interface OpenFileV1 {
  readonly handle: FileHandle;
  readonly identity: ReleaseScratchIdentityV1;
}

/** One exclusive no-follow create whose inode is known before byte zero; the guarded port only writes whole buffers. */
async function openExclusive(path: CanonicalAbsolutePathV1, mode: 0o600 | 0o700, effectiveUid: number): Promise<OpenFileV1> {
  let handle: FileHandle;
  try {
    handle = await nodeFs.open(path, CREATE_FLAGS, mode);
  } catch (error) {
    if (errorCode(error) === "EEXIST" || errorCode(error) === "ELOOP") recovery("release_scratch_path_exists");
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || Number(stats.uid) !== effectiveUid || Number(stats.mode & 0o777n) !== mode || stats.nlink !== 1n || stats.size !== 0n) {
      recovery("release_scratch_postimage");
    }
    return { handle, identity: { dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) } };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
    offset += bytesWritten;
  }
}

/**
 * One attempt-owned planning scratch (Spec 2 §7.2). Every deletion it ever
 * performs is downstream of a durable journal identity; nothing is inferred
 * from a name or adopted from content.
 */
export class ReleasePlanningScratchAttempt {
  #journal: ReleasePlanningScratchJournalV1;
  #journalEntry: LifecycleGuardedEntryV1;

  constructor(
    readonly dependencies: ReleasePlanningScratchStoreDependencies,
    readonly plan: ReleasePlanningScratchV1,
    readonly planHash: LowerHexSha256,
    readonly parent: LifecycleGuardedEntryV1,
    journal: ReleasePlanningScratchJournalV1,
    journalEntry: LifecycleGuardedEntryV1,
    readonly lock: ReleaseScratchLockV1,
  ) {
    this.#journal = journal;
    this.#journalEntry = journalEntry;
  }

  get journal(): ReleasePlanningScratchJournalV1 {
    return this.#journal;
  }

  async #boundary(boundary: ReleaseScratchBoundaryV1): Promise<void> {
    await this.dependencies.afterBoundary?.(boundary);
  }

  /** Atomic journal rewrite: exclusive temp, rename over the reopened current journal, parent sync. */
  async #update(changes: Partial<ReleasePlanningScratchJournalV1>): Promise<void> {
    const { fs, clock, uuid } = this.dependencies;
    const next = validateReleasePlanningScratchJournal(
      { ...this.#journal, ...changes, updatedAt: parseUtcTimestamp(clock()) },
      this.plan,
      this.planHash,
    );
    const bytes = canonicalBytes(next);
    if (bytes.byteLength > this.plan.maximumJournalBytes) recovery("release_scratch_journal_bound");
    const tempUuid = uuid();
    if (!UUID_V4.test(tempUuid)) throw new Error("invalid release scratch temp uuid");
    const temp = await fs.writeExclusive(parseCanonicalAbsolutePathText(`${this.plan.journalPath}.${tempUuid}.tmp`), bytes);
    await fs.renameOver(temp, this.#journalEntry);
    this.#journalEntry = { ...temp, path: this.plan.journalPath };
    this.#journal = next;
    await fs.syncDirectory(this.parent);
  }

  /** A directory this attempt created, rechecked by kind/owner/mode and, where recorded, identity. */
  async #directory(path: CanonicalAbsolutePathV1, expected: ReleaseScratchIdentityV1 | null): Promise<LifecycleGuardedEntryV1> {
    const observed = await this.dependencies.fs.lstat(path);
    if (
      observed === null ||
      observed.kind !== "directory" ||
      observed.ownerUid !== this.plan.ownerUid ||
      observed.mode !== 0o700 ||
      (expected !== null && !sameIdentity(observed, expected))
    ) {
      recovery("release_scratch_parent");
    }
    return observed;
  }

  async #createStructure(
    field: "rootWriteState" | "extractedRootWriteState" | "evidenceRootWriteState",
    path: CanonicalAbsolutePathV1,
    parent: LifecycleGuardedEntryV1,
    names: readonly [ReleaseScratchBoundaryV1, ReleaseScratchBoundaryV1, ReleaseScratchBoundaryV1],
  ): Promise<LifecycleGuardedEntryV1> {
    await this.#update({ [field]: { state: "create_intent" } });
    await this.#boundary(names[0]);
    const created = await this.dependencies.fs.mkdirExclusive(path);
    await this.#boundary(names[1]);
    await this.dependencies.fs.syncDirectory(created);
    await this.dependencies.fs.syncDirectory(parent);
    await this.#update({ [field]: { state: "created", dev: created.dev, ino: created.ino } });
    await this.#boundary(names[2]);
    return created;
  }

  /** Root, then `extracted`, then `evidence`, each intent → exclusive create → recorded identity before any child. */
  async createStructure(): Promise<void> {
    const root = await this.#createStructure("rootWriteState", this.plan.root, this.parent, ["root_intent", "root_created", "root_recorded"]);
    await this.#createStructure("extractedRootWriteState", parseCanonicalAbsolutePathText(`${this.plan.root}/extracted`), root, [
      "extracted_intent",
      "extracted_created",
      "extracted_recorded",
    ]);
    await this.#createStructure("evidenceRootWriteState", parseCanonicalAbsolutePathText(`${this.plan.root}/evidence`), root, [
      "evidence_root_intent",
      "evidence_root_created",
      "evidence_root_recorded",
    ]);
  }

  /**
   * Streams the signed archive into `archive.zst`. `receive` is the Task 12
   * transport call bound to this sink. A policy refusal raised here is a
   * `SecurityRefusalError`, which the transport passes through; any other sink
   * failure (an identity third state, a disk error) is rethrown as itself
   * rather than as the transport's network label.
   */
  async download(receive: (sink: ReleaseBodySink) => Promise<BoundedReleaseResponseV1>): Promise<void> {
    const { fs, effectiveUid } = this.dependencies;
    if (this.#journal.phase !== "planned" || this.#journal.evidenceRootWriteState?.state !== "created") recovery("release_scratch_phase");
    const archivePath = parseCanonicalAbsolutePathText(`${this.plan.root}/${this.plan.archive.path}`);
    await this.#update({ phase: "downloading", archiveWriteState: { state: "create_intent" } });
    await this.#boundary("archive_intent");
    const opened = await openExclusive(archivePath, 0o600, effectiveUid);
    let sinkError: unknown = null;
    let written = 0n;
    try {
      await this.#boundary("archive_created");
      await this.#update({ archiveWriteState: { state: "created", ...opened.identity }, archiveIdentity: opened.identity });
      await this.#boundary("archive_recorded");
      let response: BoundedReleaseResponseV1;
      try {
        response = await receive(async (chunk) => {
          try {
            if (written + BigInt(chunk.byteLength) > BigInt(this.plan.archive.bytes)) {
              throw new SecurityRefusalError("Release archive exceeds its signed size");
            }
            await writeAll(opened.handle, chunk);
            written += BigInt(chunk.byteLength);
          } catch (error) {
            sinkError ??= error;
            throw error;
          }
        });
      } catch (error) {
        if (sinkError !== null && !(sinkError instanceof SecurityRefusalError)) throw sinkError as Error;
        throw error;
      }
      if (response.bodyBytes !== this.plan.archive.bytes || response.bodyHash !== this.plan.archive.sha256 || written !== BigInt(this.plan.archive.bytes)) {
        throw new SecurityRefusalError("Release archive differs from its signed reference");
      }
      await opened.handle.sync();
    } finally {
      await opened.handle.close();
    }
    const observed = await fs.lstat(archivePath);
    if (
      observed === null ||
      observed.kind !== "regular_file" ||
      !sameIdentity(observed, opened.identity) ||
      observed.ownerUid !== effectiveUid ||
      observed.mode !== 0o600 ||
      observed.nlink !== 1 ||
      observed.size !== this.plan.archive.bytes
    ) {
      recovery("release_scratch_identity");
    }
    if ((await fs.hashRegular(observed, BigInt(this.plan.archive.bytes))) !== this.plan.archive.sha256) {
      throw new SecurityRefusalError("Release archive differs from its signed reference");
    }
    await fs.syncDirectory(await this.#directory(this.plan.root, createdIdentity(this.#journal.rootWriteState)));
    await this.#update({ archiveBytesWritten: this.plan.archive.bytes });
    await this.#boundary("archive_complete");
  }

  /** Admits the downloaded archive entry by entry into `extracted`, with one evidence file per manifest ordinal. */
  async extract(bundle: ReleaseBundleReferenceV1): Promise<VerifiedScratchBundleV1> {
    const { fs, effectiveUid } = this.dependencies;
    const journal = this.#journal;
    if (journal.phase !== "downloading" || journal.archiveBytesWritten !== this.plan.archive.bytes) recovery("release_scratch_phase");
    if (bundle.archiveBytes !== this.plan.archive.bytes || bundle.archiveSha256 !== this.plan.archive.sha256) {
      throw new SecurityRefusalError("Release archive differs from its signed reference");
    }
    const archiveIdentity = journal.archiveIdentity as ReleaseScratchIdentityV1;
    const extractedRoot = createdIdentity(journal.extractedRootWriteState);
    const evidenceRoot = await this.#directory(parseCanonicalAbsolutePathText(`${this.plan.root}/evidence`), createdIdentity(journal.evidenceRootWriteState));
    await this.#update({ phase: "extracting" });
    await this.#boundary("extracting");

    const archive = await nodeFs.open(`${this.plan.root}/${this.plan.archive.path}`, READ_FLAGS);
    let current: { readonly ordinal: number; readonly entry: ReleaseBundleEntryV1; readonly path: CanonicalAbsolutePathV1; readonly identity: ReleaseScratchIdentityV1; handle: FileHandle | null; written: number } | null = null;
    try {
      const stats = await archive.stat({ bigint: true });
      if (!sameIdentity({ dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) }, archiveIdentity) || stats.size.toString(10) !== this.plan.archive.bytes) {
        recovery("release_scratch_identity");
      }
      await new ZstdUstarAdmission().extract({
        bundle,
        manifest: this.plan.manifest,
        source: archive.createReadStream({ autoClose: false, highWaterMark: 65_536 }) as AsyncIterable<Uint8Array>,
        sink: {
          begin: async (ordinal, entry) => {
            if (ordinal !== this.#journal.nextExtractedEntry || this.#journal.entryWriteState !== null || current !== null) recovery("release_scratch_entry_cursor");
            await this.#update({ entryWriteState: { ordinal, state: "create_intent" } });
            await this.#boundary("entry_intent");
            const path = entryPath(this.plan, entry);
            let handle: FileHandle | null = null;
            let created: ReleaseScratchIdentityV1;
            if (entry.kind === "directory") {
              const made = await fs.mkdirExclusive(path);
              created = { dev: made.dev, ino: made.ino };
            } else {
              const opened = await openExclusive(path, entry.mode === 448 ? 0o700 : 0o600, effectiveUid);
              handle = opened.handle;
              created = opened.identity;
            }
            current = { ordinal, entry, path, identity: created, handle, written: 0 };
            await this.#boundary("entry_created");
            const parentPath = parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
            await fs.syncDirectory(await this.#directory(parentPath, entry.path.includes("/") ? null : extractedRoot));
            await this.#update({ entryWriteState: { ordinal, state: "created", dev: created.dev, ino: created.ino } });
            await this.#boundary("entry_recorded");
          },
          write: async (chunk) => {
            if (current === null || current.handle === null || current.entry.kind !== "file") return recovery("release_scratch_entry_cursor");
            if (current.written + chunk.byteLength > Number(current.entry.bytes)) throw new SecurityRefusalError("Release archive entry exceeds its manifest size");
            await writeAll(current.handle, chunk);
            current.written += chunk.byteLength;
          },
          end: async (ordinal) => {
            if (current === null || current.ordinal !== ordinal) return recovery("release_scratch_entry_cursor");
            const { entry, path } = current;
            if (current.handle !== null) {
              await current.handle.sync();
              await current.handle.close();
              current.handle = null;
            }
            const observed = await fs.lstat(path);
            const mode = entry.mode === 448 ? 0o700 : 0o600;
            const bytes = entry.kind === "file" ? entry.bytes : null;
            if (
              observed === null ||
              observed.kind !== (entry.kind === "file" ? "regular_file" : "directory") ||
              !sameIdentity(observed, current.identity) ||
              observed.ownerUid !== effectiveUid ||
              observed.mode !== mode ||
              (bytes !== null && (observed.nlink !== 1 || observed.size !== bytes))
            ) {
              recovery("release_scratch_identity");
            }
            if (entry.kind === "file" && (await fs.hashRegular(observed, BigInt(entry.bytes))) !== entry.sha256) {
              throw new SecurityRefusalError("Release archive entry differs from its manifest row after reopen");
            }
            await this.#boundary("entry_written");
            await this.#update({ entryWriteState: { ordinal, state: "evidence_intent", ...current.identity } });
            await this.#boundary("evidence_intent");
            const evidence: ReleaseScratchEntryEvidenceV1 = {
              schemaVersion: 1,
              id: this.plan.id,
              planHash: this.planHash,
              ordinal,
              pathHash: sha256(entry.path),
              kind: entry.kind,
              mode: entry.mode,
              bytes: entry.kind === "file" ? Number(entry.bytes) : 0,
              sha256: entry.kind === "file" ? entry.sha256 : null,
              ...current.identity,
            };
            const evidenceBytes = canonicalBytes(evidence);
            if (evidenceBytes.byteLength > MAXIMUM_EVIDENCE_BYTES) recovery("release_scratch_evidence_bound");
            const written = await fs.writeExclusive(evidencePath(this.plan, ordinal), evidenceBytes);
            await this.#boundary("evidence_created");
            await fs.syncDirectory(evidenceRoot);
            await this.#update({ entryWriteState: { ordinal, state: "evidence_created", ...current.identity, evidenceDev: written.dev, evidenceIno: written.ino } });
            await this.#boundary("evidence_recorded");
            const [target, reopened] = await Promise.all([fs.lstat(path), fs.lstat(written.path)]);
            if (!sameIdentity(target, current.identity) || !sameIdentity(reopened, written) || reopened?.size !== written.size) recovery("release_scratch_identity");
            await this.#update({ nextExtractedEntry: ordinal + 1, entryWriteState: null });
            await this.#boundary("entry_advanced");
            current = null;
          },
        },
      });
    } finally {
      const open = current as { handle: FileHandle | null } | null;
      await open?.handle?.close().catch(() => undefined);
      await archive.close();
    }
    await this.#update({ phase: "verified" });
    await this.#boundary("verified");
    return {
      id: this.plan.id,
      planHash: this.planHash,
      manifestHash: this.plan.manifestHash,
      root: parseCanonicalAbsolutePathText(`${this.plan.root}/extracted`),
      entries: this.plan.manifest.entries.length,
    };
  }

  /** Reads and binds one completed entry's evidence to the plan and manifest; the only source of a completed target's identity. */
  async #evidence(ordinal: number): Promise<{ readonly entry: LifecycleGuardedEntryV1; readonly evidence: ReleaseScratchEntryEvidenceV1 } | null> {
    const { fs, effectiveUid } = this.dependencies;
    const observed = await fs.lstat(evidencePath(this.plan, ordinal));
    if (observed === null) return null;
    if (observed.kind !== "regular_file" || observed.ownerUid !== effectiveUid || observed.mode !== 0o600 || observed.nlink !== 1 || BigInt(observed.size) > BigInt(MAXIMUM_EVIDENCE_BYTES)) {
      recovery("release_scratch_evidence");
    }
    let evidence: ReleaseScratchEntryEvidenceV1;
    try {
      evidence = validateReleaseScratchEntryEvidence(decodeCanonicalJson(await fs.readRegular(observed, MAXIMUM_EVIDENCE_BYTES), MAXIMUM_EVIDENCE_BYTES));
    } catch (error) {
      if (error instanceof LifecycleRecoveryRequiredError) throw error;
      return recovery("release_scratch_evidence");
    }
    const entry = this.plan.manifest.entries[ordinal] as ReleaseBundleEntryV1;
    if (
      evidence.id !== this.plan.id ||
      evidence.planHash !== this.planHash ||
      evidence.ordinal !== ordinal ||
      evidence.pathHash !== sha256(entry.path) ||
      evidence.kind !== entry.kind ||
      evidence.mode !== entry.mode ||
      evidence.sha256 !== (entry.kind === "file" ? entry.sha256 : null) ||
      evidence.bytes !== (entry.kind === "file" ? Number(entry.bytes) : 0)
    ) {
      recovery("release_scratch_evidence");
    }
    return { entry: observed, evidence };
  }

  async #removePath(item: ReleaseScratchPathCleanupItemV1): Promise<void> {
    const { fs, effectiveUid } = this.dependencies;
    const observed = await fs.lstat(item.path);
    if (observed === null) return;
    if (item.state.state === "create_intent") recovery("release_scratch_unrecorded_path");
    if (
      observed.kind !== item.expected ||
      !sameIdentity(observed, item.state) ||
      observed.ownerUid !== effectiveUid ||
      observed.mode !== item.mode ||
      (item.expected === "regular_file" && (observed.nlink !== 1 || BigInt(observed.size) > item.maximumBytes))
    ) {
      recovery("release_scratch_identity");
    }
    if (item.expected === "directory") await fs.rmdirExactEmpty(observed);
    else await fs.unlinkExact(observed);
  }

  async #remove(item: ReleaseScratchCleanupItemV1): Promise<void> {
    if (item.kind === "path") return this.#removePath(item);
    const found = await this.#evidence(item.ordinal);
    if (item.kind === "completed_evidence") {
      if (found !== null) await this.dependencies.fs.unlinkExact(found.entry);
      return;
    }
    if (found === null) {
      // A present target whose evidence is gone has no recorded identity left: preserve it.
      const entry = this.plan.manifest.entries[item.ordinal] as ReleaseBundleEntryV1;
      if ((await this.dependencies.fs.lstat(entryPath(this.plan, entry))) !== null) recovery("release_scratch_unrecorded_path");
      return;
    }
    await this.#removePath(entryTarget(this.plan, item.ordinal, { state: "created", dev: found.evidence.dev, ino: found.evidence.ino }));
  }

  /**
   * Normal completion and crash recovery share this path: freeze the reached
   * prefix as `cleaning`, remove the derived list in order under `cleanupNext`,
   * mark `cleaned`, remove the plan at its recorded identity, then the journal
   * last. Never a recursive delete: an unknown child makes its directory's
   * exact-empty removal refuse and everything from there on is preserved.
   */
  async cleanup(): Promise<void> {
    try {
      await this.#cleanup();
    } catch (error) {
      // Preserved residue is a dead attempt now: let the next sweep retry it.
      await this.lock.release();
      throw error;
    }
    await dropLock(this.dependencies.fs, this.parent, releasePlanningScratchLockPath(this.plan.journalPath), this.lock);
  }

  async #cleanup(): Promise<void> {
    const { fs, effectiveUid } = this.dependencies;
    if (this.#journal.phase !== "cleaning" && this.#journal.phase !== "cleaned") {
      await this.#update({ phase: "cleaning", cleanupNext: 0 });
      await this.#boundary("cleaning");
    }
    const list = deriveReleaseScratchCleanupList(this.plan, this.#journal);
    while ((this.#journal.cleanupNext as number) < list.length) {
      await this.#remove(list[this.#journal.cleanupNext as number] as ReleaseScratchCleanupItemV1);
      await this.#update({ cleanupNext: (this.#journal.cleanupNext as number) + 1 });
      await this.#boundary("cleanup_step");
    }
    if (this.#journal.phase !== "cleaned") {
      await this.#update({ phase: "cleaned" });
      await this.#boundary("cleaned");
    }
    const plan = await fs.lstat(this.plan.planPath);
    if (plan !== null) {
      if (plan.kind !== "regular_file" || !sameIdentity(plan, this.#journal.planIdentity) || plan.ownerUid !== effectiveUid || plan.mode !== 0o600 || plan.nlink !== 1) {
        recovery("release_scratch_plan_identity");
      }
      await fs.unlinkExact(plan);
      await fs.syncDirectory(this.parent);
    }
    await this.#boundary("plan_removed");
    await fs.unlinkExact(this.#journalEntry);
    await fs.syncDirectory(this.parent);
  }
}

/**
 * Creates and recovers `ReleasePlanningScratchV1` attempts under one canonical
 * system temp. Plan-only update may hold one attempt; it touches nothing else.
 */
export class ReleasePlanningScratchStore {
  constructor(readonly dependencies: ReleasePlanningScratchStoreDependencies) {}

  async #parent(): Promise<LifecycleGuardedEntryV1> {
    const { fs, systemTemp, effectiveUid } = this.dependencies;
    const parent = await fs.lstat(systemTemp);
    if (parent === null || parent.kind !== "directory" || parent.ownerUid !== effectiveUid || parent.mode !== 0o700) recovery("release_scratch_parent");
    return parent;
  }

  #fresh(): string {
    const value = this.dependencies.uuid();
    if (!UUID_V4.test(value)) throw new Error("invalid release scratch uuid");
    return value;
  }

  /**
   * Up to 32 fresh IDs: all three names must be absent, the immutable plan is
   * published no-replace and reopened, and its identity enters the initial
   * journal before the root exists. A collision is preserved, never adopted.
   */
  async create(request: ReleasePlanningScratchRequestV1): Promise<ReleasePlanningScratchAttempt> {
    const { fs, systemTemp, effectiveUid, clock } = this.dependencies;
    const boundary = async (reached: ReleaseScratchBoundaryV1): Promise<void> => {
      await this.dependencies.afterBoundary?.(reached);
    };
    const parent = await this.#parent();
    const manifest = validateBundleManifest(request.manifest);
    const archiveBytes = BigInt(parseUInt64Decimal(request.archive.bytes));
    const maximumScratchBytes = integer(request.maximumScratchBytes, "maximumScratchBytes", 1, MAXIMUM_SCRATCH_BYTES);
    let expanded = 0n;
    for (const entry of manifest.entries) if (entry.kind === "file") expanded += BigInt(entry.bytes);

    for (let candidate = 0; candidate < MAXIMUM_CANDIDATES; candidate += 1) {
      const id = parseReleasePlanningAttemptId(`rp_${this.#fresh()}`);
      const paths = releasePlanningScratchPaths(systemTemp, effectiveUid, id);
      const plan: ReleasePlanningScratchV1 = {
        schemaVersion: 1,
        id,
        ...paths,
        parentDev: parent.dev,
        parentIno: parent.ino,
        rootExpectedBefore: "absent",
        ownerUid: effectiveUid,
        mode: 448,
        archive: { path: "archive.zst", bytes: request.archive.bytes, sha256: parseLowerHexSha256(request.archive.sha256) },
        manifestHash: parseLowerHexSha256(request.manifestHash),
        manifest,
        maximumPlanBytes: MAXIMUM_PLAN_BYTES,
        maximumJournalBytes: MAXIMUM_JOURNAL_BYTES,
        maximumScratchBytes,
      };
      const planBytes = canonicalBytes(validateReleasePlanningScratch(plan));
      if (planBytes.byteLength > MAXIMUM_PLAN_BYTES) throw new SecurityRefusalError("Release planning scratch plan exceeds its bound");
      const required =
        archiveBytes + expanded + BigInt(manifest.entries.length * MAXIMUM_EVIDENCE_BYTES) + BigInt(planBytes.byteLength) + 2n * BigInt(MAXIMUM_JOURNAL_BYTES);
      if (required > BigInt(maximumScratchBytes)) throw new SecurityRefusalError("Release planning scratch exceeds its byte bound");

      const lockPath = releasePlanningScratchLockPath(paths.journalPath);
      const present = await Promise.all([fs.lstat(paths.planPath), fs.lstat(paths.journalPath), fs.lstat(paths.root), fs.lstat(lockPath)]);
      if (present.some((entry) => entry !== null)) continue;
      const planHash = sha256(planBytes);
      const now = parseUtcTimestamp(clock());
      let planEntry: LifecycleGuardedEntryV1;
      let journalEntry: LifecycleGuardedEntryV1;
      let journal: ReleasePlanningScratchJournalV1;
      let lock: ReleaseScratchLockV1 | null = null;
      try {
        const planTemp = await fs.writeExclusive(parseCanonicalAbsolutePathText(`${paths.planPath}.${this.#fresh()}.tmp`), planBytes);
        await boundary("plan_temp_written");
        await fs.renameNoReplace(planTemp, paths.planPath);
        const reopened = await fs.lstat(paths.planPath);
        if (reopened === null || !sameIdentity(reopened, planTemp) || reopened.nlink !== 1 || reopened.size !== planTemp.size) recovery("release_scratch_plan_identity");
        planEntry = reopened;
        await fs.syncDirectory(parent);
        await boundary("plan_published");
        // Held before the journal exists, so no listed attempt is ever unlocked while it lives.
        lock = await this.dependencies.tryLock(lockPath);
        if (lock === null) {
          // Our own plan, published a moment ago with no journal: remove it rather than leave residue.
          await fs.unlinkExact(planEntry);
          await fs.syncDirectory(parent);
          continue;
        }
        journal = validateReleasePlanningScratchJournal(
          {
            schemaVersion: 1,
            id,
            planHash,
            planIdentity: { dev: planEntry.dev, ino: planEntry.ino },
            phase: "planned",
            rootWriteState: null,
            extractedRootWriteState: null,
            evidenceRootWriteState: null,
            archiveWriteState: null,
            archiveIdentity: null,
            archiveBytesWritten: "0",
            nextExtractedEntry: 0,
            entryWriteState: null,
            cleanupNext: null,
            createdAt: now,
            updatedAt: now,
          },
          plan,
          planHash,
        );
        const journalTemp = await fs.writeExclusive(parseCanonicalAbsolutePathText(`${paths.journalPath}.${this.#fresh()}.tmp`), canonicalBytes(journal));
        await fs.renameNoReplace(journalTemp, paths.journalPath);
        const reopenedJournal = await fs.lstat(paths.journalPath);
        if (reopenedJournal === null || !sameIdentity(reopenedJournal, journalTemp) || reopenedJournal.size !== journalTemp.size) recovery("release_scratch_journal_identity");
        journalEntry = reopenedJournal;
        await fs.syncDirectory(parent);
        await boundary("journal_published");
      } catch (error) {
        if ((error instanceof LifecycleRecoveryRequiredError && error.reason === "lifecycle_guarded_path_exists") || errorCode(error) === "EEXIST") {
          if (lock !== null) await dropLock(fs, parent, lockPath, lock);
          continue;
        }
        await lock?.release();
        throw error;
      }
      const attempt = new ReleasePlanningScratchAttempt(this.dependencies, plan, planHash, parent, journal, journalEntry, lock);
      try {
        await attempt.createStructure();
      } catch (error) {
        await lock.release();
        throw error;
      }
      return attempt;
    }
    return recovery("release_scratch_candidates_exhausted");
  }

  /** At most 32 attempts whose journal exists; a plan-only residue is never listed. */
  async listRecoverableAttempts(): Promise<readonly ReleasePlanningAttemptIdV1[]> {
    const parent = await this.#parent();
    const pattern = new RegExp(`^\\.developer-os-release-planning-v1-${this.dependencies.effectiveUid.toString(10)}-(${UUID_V4_SOURCE})\\.journal\\.json$`);
    const found: ReleasePlanningAttemptIdV1[] = [];
    for await (const name of this.dependencies.fs.names(parent)) {
      const match = pattern.exec(name);
      if (match !== null) found.push(parseReleasePlanningAttemptId(`rp_${match[1] as string}`));
      if (found.length === MAXIMUM_CANDIDATES) break;
    }
    return found.sort();
  }

  /**
   * Cleanup-only recovery after process death. Admitted states: both plan and
   * journal present (resume cleanup), plan absent with a `cleaned` journal
   * (remove the journal), both absent (done). A plan-only residue is preserved.
   */
  async recoverCleanup(id: ReleasePlanningAttemptIdV1): Promise<void> {
    const { fs, systemTemp, effectiveUid } = this.dependencies;
    const parent = await this.#parent();
    const paths = releasePlanningScratchPaths(systemTemp, effectiveUid, parseReleasePlanningAttemptId(id));
    const lockPath = releasePlanningScratchLockPath(paths.journalPath);
    // A live owner holds its lock: that attempt is not residue, so it is skipped, not refused.
    const lock = await this.dependencies.tryLock(lockPath);
    if (lock === null) return;
    let attempt: ReleasePlanningScratchAttempt | null;
    try {
      attempt = await this.#recoverable(id, paths, parent, lock);
    } catch (error) {
      await lock.release();
      throw error;
    }
    if (attempt === null) await dropLock(fs, parent, lockPath, lock);
    else await attempt.cleanup();
  }

  /** The dead attempt to clean, or null once nothing but the journal (or nothing at all) is left. */
  async #recoverable(
    id: ReleasePlanningAttemptIdV1,
    paths: ReturnType<typeof releasePlanningScratchPaths>,
    parent: LifecycleGuardedEntryV1,
    lock: ReleaseScratchLockV1,
  ): Promise<ReleasePlanningScratchAttempt | null> {
    const { fs, effectiveUid } = this.dependencies;
    const [planEntry, journalEntry] = await Promise.all([fs.lstat(paths.planPath), fs.lstat(paths.journalPath)]);
    if (journalEntry === null) return null;
    if (journalEntry.kind !== "regular_file" || journalEntry.ownerUid !== effectiveUid || journalEntry.mode !== 0o600 || journalEntry.nlink !== 1) {
      recovery("release_scratch_journal_identity");
    }
    const decode = async (entry: LifecycleGuardedEntryV1, maximum: number): Promise<unknown> => {
      try {
        return decodeCanonicalJson(await fs.readRegular(entry, maximum), maximum);
      } catch (error) {
        if (error instanceof LifecycleRecoveryRequiredError) throw error;
        return recovery("release_scratch_malformed");
      }
    };
    const journalValue = await decode(journalEntry, MAXIMUM_JOURNAL_BYTES);
    if (planEntry === null) {
      const terminal = journalValue as UnknownRecord | null;
      if (terminal === null || typeof terminal !== "object" || terminal.id !== id || terminal.phase !== "cleaned") recovery("release_scratch_plan_missing");
      await fs.unlinkExact(journalEntry);
      await fs.syncDirectory(parent);
      return null;
    }
    if (planEntry.kind !== "regular_file" || planEntry.ownerUid !== effectiveUid || planEntry.mode !== 0o600 || planEntry.nlink !== 1) recovery("release_scratch_plan_identity");
    const planBytes = await fs.readRegular(planEntry, MAXIMUM_PLAN_BYTES);
    let plan: ReleasePlanningScratchV1;
    let journal: ReleasePlanningScratchJournalV1;
    try {
      plan = validateReleasePlanningScratch(decodeCanonicalJson(planBytes, MAXIMUM_PLAN_BYTES));
      journal = validateReleasePlanningScratchJournal(journalValue, plan, sha256(planBytes));
    } catch {
      return recovery("release_scratch_malformed");
    }
    if (plan.id !== id || plan.root !== paths.root || plan.ownerUid !== effectiveUid || plan.parentDev !== parent.dev || plan.parentIno !== parent.ino || !sameIdentity(planEntry, journal.planIdentity)) {
      recovery("release_scratch_plan_identity");
    }
    return new ReleasePlanningScratchAttempt(this.dependencies, plan, sha256(planBytes), parent, journal, journalEntry, lock);
  }
}
