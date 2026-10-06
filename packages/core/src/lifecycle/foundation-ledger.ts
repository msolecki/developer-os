/**
 * Spec 1 §2.4's closed Foundation ledger inventory. The lifecycle ledger has
 * exactly four roots and three companion inventories; this module reads the
 * Foundation journal root and its two companions once, through the guarded
 * port, and decides every leaf against the exact grammar. It never mutates:
 * §2.4's cleanup, compaction and overflow recovery are separate guarded
 * protocols that consume this inventory.
 *
 * Fail-closed is the whole contract. An unknown leaf, a malformed name, a
 * symlink, a special file, a wrong owner or mode, an identity third state and
 * the millionth-and-first aggregate leaf all become findings that preserve
 * what was found; a finding carries the leaf's path and a safe reason code,
 * never a byte of its content.
 */
import type { LifecycleInstallNonceV1 } from "../manifest/bootstrap.js";
import { encodeFoundationJournalJsonV1, validateJournal } from "../transactions/store.js";
import type { TransactionJournalV1 } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseSafeReasonCode, type SafeReasonCodeV1 } from "../update/scalars.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import {
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  LIFECYCLE_LEDGER_BOUNDS,
  parseAllocatedFoundationMutationIndex,
  parseAllocatedLifecycleId,
  parseFoundationTransactionId,
  parseLegacyFoundationMutationIndex,
  type FoundationTransactionIdV1,
} from "./ids.js";
import { maximumFoundationJournalBytes } from "./store.js";
import { LOWERCASE_V4_UUID } from "./fs-helpers.js";

export interface LifecycleLedgerRootsV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly foundationJournals: CanonicalAbsolutePathV1;
  readonly coordinatorJournals: CanonicalAbsolutePathV1;
  readonly gitEffectJournals: CanonicalAbsolutePathV1;
  readonly launchdEffectJournals: CanonicalAbsolutePathV1;
  readonly foundationStaging: CanonicalAbsolutePathV1;
  readonly foundationBackups: CanonicalAbsolutePathV1;
  readonly lifecycleStaging: CanonicalAbsolutePathV1;
}

export type FoundationLedgerOrphanV1 =
  | { readonly kind: "lock_only"; readonly id: FoundationTransactionIdV1; readonly lock: LifecycleGuardedEntryV1 }
  | {
      readonly kind: "planless";
      readonly id: FoundationTransactionIdV1;
      readonly leaves: readonly LifecycleGuardedEntryV1[];
    }
  | { readonly kind: "rewrite_temp"; readonly id: FoundationTransactionIdV1; readonly temp: LifecycleGuardedEntryV1 };

export interface FoundationLedgerHeldJournalV1 {
  readonly journal: TransactionJournalV1;
  readonly entry: LifecycleGuardedEntryV1;
  readonly lock: LifecycleGuardedEntryV1 | null;
}

export interface FoundationLedgerFindingV1 {
  readonly reason: SafeReasonCodeV1;
  readonly path: CanonicalAbsolutePathV1;
}

export interface FoundationLedgerV1 {
  readonly journals: ReadonlyMap<FoundationTransactionIdV1, FoundationLedgerHeldJournalV1>;
  readonly orphans: readonly FoundationLedgerOrphanV1[];
  readonly findings: readonly FoundationLedgerFindingV1[];
  readonly counts: { readonly journalRoot: number; readonly staging: number; readonly backups: number };
  /**
   * A root over its steady-state cap while every leaf is valid and the aggregate is within
   * 1,000,000. It is a routing decision — "§2.4 overflow recovery is the next step" — not a count
   * fact, so a caller reads `findings` first: exceeded counts alongside any refusal leave this
   * `false`, because a ledger that cannot be validated cannot be declared recoverable by streaming.
   */
  readonly overflow: boolean;
}

const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_ALLOCATED_PAYLOAD_BYTES = 16_777_216;
/** The shipped executor's legacy range: `Stats.size` up to the ECMAScript safe integer. */
const MAX_LEGACY_PAYLOAD_BYTES = Number.MAX_SAFE_INTEGER;
const DIGEST_FILE_BYTES = 65;
const JOURNAL_SUFFIX = ".json";
const LOCK_SUFFIX = ".lock";
const TEMP_SUFFIX = ".json.tmp";
const LOWERCASE_SHA256_LINE = /^[0-9a-f]{64}\n$/u;

const STAGING_SPELLINGS = [
  { suffix: ".bin.sha256.tmp", spelling: "digest_temp" },
  { suffix: ".bin.sha256", spelling: "digest" },
  { suffix: ".bin.tmp", spelling: "content_temp" },
  { suffix: ".bin", spelling: "content" },
] as const;

const BACKUP_SUFFIXES = [
  ".bin.tmp",
  ".bin",
  ".json.sha256.tmp",
  ".json.sha256",
  ".json.tmp",
  ".json",
] as const;

type StagingSpellingV1 = (typeof STAGING_SPELLINGS)[number]["spelling"];
type CompanionRootV1 = "staging" | "backups";

const decoder = new TextDecoder("utf-8", { fatal: true });

export function deriveLifecycleLedgerRoots(
  productHome: CanonicalAbsolutePathV1,
): LifecycleLedgerRootsV1 {
  const at = (relative: string): CanonicalAbsolutePathV1 =>
    parseCanonicalAbsolutePathText(`${productHome}/${relative}`);
  return {
    productHome,
    stateDirectory: at("state"),
    foundationJournals: at("state/transactions"),
    coordinatorJournals: at("state/lifecycle-journals"),
    gitEffectJournals: at("state/git-effect-journals"),
    launchdEffectJournals: at("state/launchd-effect-journals"),
    foundationStaging: at("staging/transactions"),
    foundationBackups: at("backups/transactions"),
    lifecycleStaging: at("staging/lifecycle"),
  };
}

export interface FoundationLedgerDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly nonce: LifecycleInstallNonceV1 | null;
  readonly residue: LifecycleBookkeepingResidueV1;
  readonly effectiveUid: number;
  /** IDs a coordinator plan names as a participant; their staging may precede their journal. */
  readonly coordinatorParticipantIds: ReadonlySet<string>;
}

interface CompanionDirectoryV1 {
  readonly entry: LifecycleGuardedEntryV1;
  readonly indices: Map<number, Map<StagingSpellingV1, LifecycleGuardedEntryV1>>;
  readonly leaves: LifecycleGuardedEntryV1[];
  malformed: boolean;
}

interface IdFactsV1 {
  journal: { readonly journal: TransactionJournalV1; readonly entry: LifecycleGuardedEntryV1 } | null;
  lock: LifecycleGuardedEntryV1 | null;
  readonly temps: LifecycleGuardedEntryV1[];
  staging: CompanionDirectoryV1 | null;
  backups: CompanionDirectoryV1 | null;
  malformed: boolean;
}

interface LedgerScanV1 {
  readonly dependencies: FoundationLedgerDependenciesV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly ids: Map<string, IdFactsV1>;
  readonly findings: FoundationLedgerFindingV1[];
  readonly counts: { journalRoot: number; staging: number; backups: number };
  total: number;
  stopped: boolean;
}

function refuse(scan: LedgerScanV1, reason: string, path: CanonicalAbsolutePathV1): void {
  scan.findings.push({ reason: parseSafeReasonCode(reason), path });
}

function factsFor(scan: LedgerScanV1, id: FoundationTransactionIdV1): IdFactsV1 {
  const existing = scan.ids.get(id);
  if (existing !== undefined) return existing;
  const created: IdFactsV1 = {
    journal: null,
    lock: null,
    temps: [],
    staging: null,
    backups: null,
    malformed: false,
  };
  scan.ids.set(id, created);
  return created;
}

function childPath(
  directory: CanonicalAbsolutePathV1,
  name: string,
): CanonicalAbsolutePathV1 | null {
  try {
    return parseCanonicalAbsolutePathText(`${directory}/${name}`);
  } catch {
    return null;
  }
}

function transactionIdOf(
  value: string,
  nonce: LifecycleInstallNonceV1 | null,
): FoundationTransactionIdV1 | null {
  try {
    return parseFoundationTransactionId(value, nonce);
  } catch {
    return null;
  }
}

function isAllocatedTransactionId(
  id: FoundationTransactionIdV1,
  nonce: LifecycleInstallNonceV1 | null,
): boolean {
  try {
    parseAllocatedLifecycleId("tx", id, nonce);
    return true;
  } catch {
    return false;
  }
}

function stableLockOwner(name: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(LOCK_SUFFIX)) return null;
  const owner = name.slice(1, name.length - LOCK_SUFFIX.length);
  return owner.length === 0 ? null : owner;
}

/**
 * The aggregate ceiling is enforced before any leaf is read, so the state a
 * refusal preserves is exactly what overflow recovery will re-enter.
 */
function admitLeaf(
  scan: LedgerScanV1,
  root: "journalRoot" | CompanionRootV1,
  path: CanonicalAbsolutePathV1,
): boolean {
  scan.counts[root] += 1;
  scan.total += 1;
  if (scan.total > LIFECYCLE_LEDGER_BOUNDS.foundationOverflowAggregateLeaves) {
    refuse(scan, "ledger_capacity_exceeded", path);
    scan.stopped = true;
    return false;
  }
  return true;
}

async function guardedRead<T>(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
  action: () => Promise<T>,
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) {
      scan.findings.push({ reason: error.reason, path });
      return null;
    }
    throw error;
  }
}

async function openRoot(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    entry.kind !== "directory" ||
    entry.ownerUid !== scan.dependencies.effectiveUid ||
    entry.mode !== 0o700
  ) {
    refuse(scan, "lifecycle_ledger_root_shape", path);
    return null;
  }
  return entry;
}

async function guardedRegularFile(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
  maximumBytes: number,
  reason: string,
): Promise<LifecycleGuardedEntryV1 | null> {
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    entry.kind !== "regular_file" ||
    entry.ownerUid !== scan.dependencies.effectiveUid ||
    entry.mode !== 0o600 ||
    entry.nlink !== 1 ||
    BigInt(entry.size) > BigInt(maximumBytes)
  ) {
    refuse(scan, reason, path);
    return null;
  }
  return entry;
}

async function guardedDirectory(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
  reason: string,
): Promise<LifecycleGuardedEntryV1 | null> {
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    entry.kind !== "directory" ||
    entry.ownerUid !== scan.dependencies.effectiveUid ||
    entry.mode !== 0o700
  ) {
    refuse(scan, reason, path);
    return null;
  }
  return entry;
}

async function readText(
  scan: LedgerScanV1,
  entry: LifecycleGuardedEntryV1,
  maximumBytes: number,
  decodeReason: string,
): Promise<string | null> {
  const bytes = await guardedRead(scan, entry.path, () =>
    scan.dependencies.fs.readRegular(entry, maximumBytes),
  );
  if (bytes === null) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    refuse(scan, decodeReason, entry.path);
    return null;
  }
}

function parsedJournal(text: string, id: FoundationTransactionIdV1): TransactionJournalV1 | null {
  try {
    const journal = validateJournal(JSON.parse(text));
    return journal.id === id ? journal : null;
  } catch {
    return null;
  }
}

/**
 * §2.2: allocated Foundation journal bytes are exactly `FoundationJournalJsonV1`,
 * while a legacy `tx_<lowercase-v4-uuid>` journal keeps the compatibility read —
 * historical key order and insignificant whitespace are not rejected merely for
 * being non-canonical.
 */
async function admitJournal(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
  id: FoundationTransactionIdV1,
): Promise<void> {
  const entry = await guardedRegularFile(
    scan,
    path,
    MAX_JOURNAL_BYTES,
    "lifecycle_foundation_journal_shape",
  );
  if (entry === null) {
    factsFor(scan, id).malformed = true;
    return;
  }
  const text = await readText(scan, entry, MAX_JOURNAL_BYTES, "lifecycle_foundation_journal_bytes");
  const journal = text === null ? null : parsedJournal(text, id);
  if (text === null || journal === null) {
    if (text !== null) refuse(scan, "lifecycle_foundation_journal_bytes", path);
    factsFor(scan, id).malformed = true;
    return;
  }
  if (
    isAllocatedTransactionId(id, scan.dependencies.nonce) &&
    encodeFoundationJournalJsonV1(journal) !== text
  ) {
    refuse(scan, "lifecycle_foundation_journal_bytes", path);
    factsFor(scan, id).malformed = true;
    return;
  }
  factsFor(scan, id).journal = { journal, entry };
}

async function admitJournalRootLeaf(
  scan: LedgerScanV1,
  path: CanonicalAbsolutePathV1,
  name: string,
): Promise<void> {
  const { residue, nonce } = scan.dependencies;
  if (residue.retainedPaths.has(path)) return;
  const lockOwner = stableLockOwner(name);
  if (lockOwner !== null && residue.bootstrapParticipantIds.has(lockOwner)) {
    await guardedRegularFile(scan, path, 0, "lifecycle_foundation_journal_shape");
    return;
  }
  if (!name.startsWith(".") && name.endsWith(JOURNAL_SUFFIX)) {
    const id = transactionIdOf(name.slice(0, name.length - JOURNAL_SUFFIX.length), nonce);
    if (id !== null) {
      await admitJournal(scan, path, id);
      return;
    }
  }
  if (lockOwner !== null) {
    const id = transactionIdOf(lockOwner, nonce);
    if (id !== null) {
      const entry = await guardedRegularFile(scan, path, 0, "lifecycle_foundation_journal_shape");
      if (entry === null) factsFor(scan, id).malformed = true;
      else factsFor(scan, id).lock = entry;
      return;
    }
  }
  const temp = temporaryJournalId(name, nonce);
  if (temp !== null) {
    const entry = await guardedRegularFile(
      scan,
      path,
      MAX_JOURNAL_BYTES,
      "lifecycle_foundation_journal_shape",
    );
    if (entry === null) factsFor(scan, temp).malformed = true;
    else factsFor(scan, temp).temps.push(entry);
    return;
  }
  refuse(scan, "lifecycle_foundation_journal_name", path);
}

/** `TransactionStore.write`'s exact hidden temporary: `.<id>.<lowercase-v4-uuid>.json.tmp`. */
function temporaryJournalId(
  name: string,
  nonce: LifecycleInstallNonceV1 | null,
): FoundationTransactionIdV1 | null {
  if (!name.startsWith(".") || !name.endsWith(TEMP_SUFFIX)) return null;
  const stem = name.slice(1, name.length - TEMP_SUFFIX.length);
  const boundary = stem.lastIndexOf(".");
  if (boundary < 1) return null;
  if (!LOWERCASE_V4_UUID.test(stem.slice(boundary + 1))) return null;
  return transactionIdOf(stem.slice(0, boundary), nonce);
}

async function scanJournalRoot(scan: LedgerScanV1): Promise<void> {
  const root = await openRoot(scan, scan.roots.foundationJournals);
  if (root === null) return;
  for await (const name of scan.dependencies.fs.names(root)) {
    const path = childPath(root.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_foundation_journal_name", root.path);
      continue;
    }
    if (!admitLeaf(scan, "journalRoot", path)) return;
    await admitJournalRootLeaf(scan, path, name);
  }
}

function mutationIndexOf(
  text: string,
  allocated: boolean,
): number | null {
  try {
    return allocated
      ? parseAllocatedFoundationMutationIndex(text)
      : parseLegacyFoundationMutationIndex(text);
  } catch {
    return null;
  }
}

function stagingSpellingOf(
  name: string,
  allocated: boolean,
): { readonly index: number; readonly spelling: StagingSpellingV1 } | null {
  for (const candidate of STAGING_SPELLINGS) {
    if (!name.endsWith(candidate.suffix)) continue;
    const index = mutationIndexOf(name.slice(0, name.length - candidate.suffix.length), allocated);
    return index === null ? null : { index, spelling: candidate.spelling };
  }
  return null;
}

function backupIndexOf(name: string, allocated: boolean): number | null {
  for (const suffix of BACKUP_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    return mutationIndexOf(name.slice(0, name.length - suffix.length), allocated);
  }
  return null;
}

function maximumLeafBytes(spelling: StagingSpellingV1, allocated: boolean): number {
  if (spelling === "digest" || spelling === "digest_temp") return DIGEST_FILE_BYTES;
  return allocated ? MAX_ALLOCATED_PAYLOAD_BYTES : MAX_LEGACY_PAYLOAD_BYTES;
}

async function admitStagingChild(
  scan: LedgerScanV1,
  directory: CompanionDirectoryV1,
  path: CanonicalAbsolutePathV1,
  name: string,
  allocated: boolean,
): Promise<void> {
  const parsed = stagingSpellingOf(name, allocated);
  if (parsed === null) {
    refuse(scan, "lifecycle_foundation_staging_name", path);
    directory.malformed = true;
    return;
  }
  const entry = await guardedRegularFile(
    scan,
    path,
    maximumLeafBytes(parsed.spelling, allocated),
    "lifecycle_foundation_staging_shape",
  );
  if (entry === null) {
    directory.malformed = true;
    return;
  }
  const spellings = directory.indices.get(parsed.index) ?? new Map<StagingSpellingV1, LifecycleGuardedEntryV1>();
  spellings.set(parsed.spelling, entry);
  directory.indices.set(parsed.index, spellings);
  directory.leaves.push(entry);
}

async function admitBackupChild(
  scan: LedgerScanV1,
  directory: CompanionDirectoryV1,
  path: CanonicalAbsolutePathV1,
  name: string,
  allocated: boolean,
): Promise<void> {
  const index = backupIndexOf(name, allocated);
  if (index === null) {
    refuse(scan, "lifecycle_foundation_backup_name", path);
    directory.malformed = true;
    return;
  }
  const entry = await guardedRegularFile(
    scan,
    path,
    allocated ? MAX_ALLOCATED_PAYLOAD_BYTES : MAX_LEGACY_PAYLOAD_BYTES,
    "lifecycle_foundation_backup_shape",
  );
  if (entry === null) {
    directory.malformed = true;
    return;
  }
  directory.indices.set(index, new Map());
  directory.leaves.push(entry);
}

/**
 * A13: a bootstrap participant's ID directory under `staging/transactions` or
 * `backups/transactions` is projected away when it is empty or holds only
 * retained paths, and its entries still count toward the caps.
 */
async function admitResidueDirectory(
  scan: LedgerScanV1,
  root: CompanionRootV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const reason = root === "staging"
    ? "lifecycle_foundation_staging_shape"
    : "lifecycle_foundation_backup_shape";
  const entry = await guardedDirectory(scan, path, reason);
  if (entry === null) return;
  for await (const name of scan.dependencies.fs.names(entry)) {
    const child = childPath(entry.path, name);
    if (child === null) {
      refuse(scan, nameReason(root), entry.path);
      continue;
    }
    if (!admitLeaf(scan, root, child)) return;
    if (!scan.dependencies.residue.retainedPaths.has(child)) refuse(scan, nameReason(root), child);
  }
}

function nameReason(root: CompanionRootV1): string {
  return root === "staging" ? "lifecycle_foundation_staging_name" : "lifecycle_foundation_backup_name";
}

async function admitCompanionDirectory(
  scan: LedgerScanV1,
  root: CompanionRootV1,
  path: CanonicalAbsolutePathV1,
  id: FoundationTransactionIdV1,
): Promise<void> {
  const entry = await guardedDirectory(
    scan,
    path,
    root === "staging" ? "lifecycle_foundation_staging_shape" : "lifecycle_foundation_backup_shape",
  );
  const facts = factsFor(scan, id);
  if (entry === null) {
    facts.malformed = true;
    return;
  }
  const directory: CompanionDirectoryV1 = { entry, indices: new Map(), leaves: [], malformed: false };
  if (root === "staging") facts.staging = directory;
  else facts.backups = directory;

  const allocated = isAllocatedTransactionId(id, scan.dependencies.nonce);
  for await (const name of scan.dependencies.fs.names(entry)) {
    const child = childPath(entry.path, name);
    if (child === null) {
      refuse(scan, nameReason(root), entry.path);
      directory.malformed = true;
      continue;
    }
    if (!admitLeaf(scan, root, child)) return;
    if (root === "staging") await admitStagingChild(scan, directory, child, name, allocated);
    else await admitBackupChild(scan, directory, child, name, allocated);
  }
}

async function scanCompanionRoot(scan: LedgerScanV1, root: CompanionRootV1): Promise<void> {
  const rootPath = root === "staging" ? scan.roots.foundationStaging : scan.roots.foundationBackups;
  const entry = await openRoot(scan, rootPath);
  if (entry === null) return;
  for await (const name of scan.dependencies.fs.names(entry)) {
    const path = childPath(entry.path, name);
    if (path === null) {
      refuse(scan, nameReason(root), entry.path);
      continue;
    }
    if (!admitLeaf(scan, root, path)) return;
    if (scan.dependencies.residue.retainedPaths.has(path)) continue;
    if (scan.dependencies.residue.bootstrapParticipantIds.has(name)) {
      await admitResidueDirectory(scan, root, path);
      if (scan.stopped) return;
      continue;
    }
    const id = transactionIdOf(name, scan.dependencies.nonce);
    if (id === null) {
      refuse(scan, nameReason(root), path);
      continue;
    }
    await admitCompanionDirectory(scan, root, path, id);
    if (scan.stopped) return;
  }
}

/**
 * §2.4's `FoundationJournalJsonPrefixV1`: the store temp's bytes are a byte
 * prefix, possibly empty, of at least one valid `planned` record for the same
 * ID, and a complete value must parse and validate as that journal. Only the
 * fixed head of the encoding is decidable for an incomplete write — the `kind`
 * text that follows it is free — so the rule checks that head, forbids an
 * interior LF, and validates the whole record whenever the terminating LF
 * arrived. A rewrite temp beside its final journal is read only up to that
 * journal's recomputed standalone maximum, and a complete one must be a
 * `transition` of it: same kind, creation time and mutations, never `planned`.
 */
async function admitTemporaryJournal(
  scan: LedgerScanV1,
  temp: LifecycleGuardedEntryV1,
  id: FoundationTransactionIdV1,
  expected:
    | { readonly completeIndices: ReadonlySet<number> }
    | { readonly final: TransactionJournalV1 }
    | null,
): Promise<boolean> {
  const maximumBytes =
    expected !== null && "final" in expected
      ? Math.min(maximumFoundationJournalBytes(expected.final), MAX_JOURNAL_BYTES)
      : MAX_JOURNAL_BYTES;
  const text = await readText(scan, temp, maximumBytes, "lifecycle_foundation_temp_bytes");
  if (text === null) return false;
  if (text.length === 0) return true;
  const head = `{"schemaVersion":1,"id":${JSON.stringify(id)},"kind":"`;
  if (!head.startsWith(text) && !text.startsWith(head)) {
    refuse(scan, "lifecycle_foundation_temp_bytes", temp.path);
    return false;
  }
  if (!text.endsWith("\n")) {
    if (text.includes("\n")) {
      refuse(scan, "lifecycle_foundation_temp_bytes", temp.path);
      return false;
    }
    return true;
  }
  const journal = parsedJournal(text, id);
  if (journal === null || encodeFoundationJournalJsonV1(journal) !== text) {
    refuse(scan, "lifecycle_foundation_temp_bytes", temp.path);
    return false;
  }
  if (expected === null) return true;
  if ("final" in expected) {
    const rebased = { ...journal, phase: expected.final.phase, updatedAt: expected.final.updatedAt };
    if (
      journal.phase === "planned" ||
      encodeFoundationJournalJsonV1(rebased) !== encodeFoundationJournalJsonV1(expected.final)
    ) {
      refuse(scan, "lifecycle_foundation_temp_bytes", temp.path);
      return false;
    }
    return true;
  }
  const staged = journal.mutations
    .map((mutation, index) => (mutation.operation === "remove" ? null : index))
    .filter((index): index is number => index !== null);
  if (
    journal.phase !== "planned" ||
    staged.length !== expected.completeIndices.size ||
    staged.some((index) => !expected.completeIndices.has(index))
  ) {
    refuse(scan, "lifecycle_foundation_temp_bytes", temp.path);
    return false;
  }
  return true;
}

function admitTemporaryCount(
  scan: LedgerScanV1,
  facts: IdFactsV1,
): LifecycleGuardedEntryV1 | null {
  const [first, second] = [...facts.temps].sort((left, right) =>
    left.path < right.path ? -1 : 1,
  );
  if (second !== undefined && first !== undefined) {
    refuse(scan, "lifecycle_foundation_temp_count", first.path);
    facts.malformed = true;
    return null;
  }
  return first ?? null;
}

const COMPLETE_PAIR: readonly StagingSpellingV1[] = ["content", "digest"];
const LEGAL_PARTIAL_STATES: readonly (readonly StagingSpellingV1[])[] = [
  ["content_temp"],
  ["content"],
  ["content", "digest_temp"],
];

function sameSpellings(
  spellings: ReadonlyMap<StagingSpellingV1, LifecycleGuardedEntryV1>,
  expected: readonly StagingSpellingV1[],
): boolean {
  return (
    spellings.size === expected.length && expected.every((spelling) => spellings.has(spelling))
  );
}

async function admitCompletePair(
  scan: LedgerScanV1,
  spellings: ReadonlyMap<StagingSpellingV1, LifecycleGuardedEntryV1>,
  allocated: boolean,
): Promise<boolean> {
  const content = spellings.get("content");
  const digest = spellings.get("digest");
  if (content === undefined || digest === undefined) return false;
  const text = await readText(
    scan,
    digest,
    DIGEST_FILE_BYTES,
    "lifecycle_foundation_staging_digest",
  );
  if (text === null) return false;
  if (!LOWERCASE_SHA256_LINE.test(text)) {
    refuse(scan, "lifecycle_foundation_staging_digest", digest.path);
    return false;
  }
  const hash = await guardedRead(scan, content.path, () =>
    scan.dependencies.fs.hashRegular(
      content,
      BigInt(allocated ? MAX_ALLOCATED_PAYLOAD_BYTES : MAX_LEGACY_PAYLOAD_BYTES),
    ),
  );
  if (hash === null) return false;
  if (`${hash}\n` !== text) {
    refuse(scan, "lifecycle_foundation_staging_digest", digest.path);
    return false;
  }
  return true;
}

/**
 * §2.4's planless-orphan grammar: numeric gaps are legal, every index below the
 * greatest observed one is a complete pair, and the greatest may instead be one
 * of the three write-in-progress states unchanged `writeStaged` emits.
 */
async function admitPlanlessStaging(
  scan: LedgerScanV1,
  staging: CompanionDirectoryV1,
  allocated: boolean,
): Promise<ReadonlySet<number> | null> {
  const indices = [...staging.indices.keys()].sort((left, right) => left - right);
  const greatest = indices.at(-1);
  const complete = new Set<number>();
  let admitted = true;
  for (const index of indices) {
    const spellings = staging.indices.get(index);
    if (spellings === undefined) continue;
    if (sameSpellings(spellings, COMPLETE_PAIR)) {
      if (await admitCompletePair(scan, spellings, allocated)) complete.add(index);
      else admitted = false;
      continue;
    }
    const legal =
      index === greatest &&
      LEGAL_PARTIAL_STATES.some((state) => sameSpellings(spellings, state));
    if (!legal) {
      refuse(scan, "lifecycle_foundation_staging_planless", staging.entry.path);
      admitted = false;
    }
  }
  return admitted ? complete : null;
}

function planlessLeaves(facts: IdFactsV1, temp: LifecycleGuardedEntryV1 | null): readonly LifecycleGuardedEntryV1[] {
  const leaves: LifecycleGuardedEntryV1[] = [];
  if (facts.staging !== null) leaves.push(facts.staging.entry, ...facts.staging.leaves);
  if (facts.backups !== null) leaves.push(facts.backups.entry);
  if (temp !== null) leaves.push(temp);
  if (facts.lock !== null) leaves.push(facts.lock);
  return leaves.sort((left, right) => (left.path < right.path ? -1 : 1));
}

async function resolvePlanless(
  scan: LedgerScanV1,
  id: FoundationTransactionIdV1,
  facts: IdFactsV1,
): Promise<FoundationLedgerOrphanV1 | null> {
  const temp = admitTemporaryCount(scan, facts);
  if (facts.malformed || facts.staging?.malformed === true || facts.backups?.malformed === true) {
    return null;
  }
  if (facts.backups !== null && facts.backups.leaves.length > 0) {
    refuse(scan, "lifecycle_foundation_backup_not_empty", facts.backups.entry.path);
    return null;
  }
  if (facts.staging === null && facts.backups === null && temp === null) {
    return facts.lock === null ? null : { kind: "lock_only", id, lock: facts.lock };
  }
  const allocated = isAllocatedTransactionId(id, scan.dependencies.nonce);
  const complete =
    facts.staging === null
      ? new Set<number>()
      : await admitPlanlessStaging(scan, facts.staging, allocated);
  if (complete === null) return null;
  if (temp !== null && !(await admitTemporaryJournal(scan, temp, id, { completeIndices: complete }))) {
    return null;
  }
  return { kind: "planless", id, leaves: planlessLeaves(facts, temp) };
}

/** §2.4: the companions admit only the exact mutation-index files a validated journal derives. */
function admitDerivedCompanions(
  scan: LedgerScanV1,
  id: FoundationTransactionIdV1,
  journal: TransactionJournalV1,
  facts: IdFactsV1,
): void {
  const allocated = isAllocatedTransactionId(id, scan.dependencies.nonce);
  const staged = new Set(
    journal.mutations
      .map((mutation, index) => (mutation.operation === "remove" ? null : index))
      .filter((index): index is number => index !== null),
  );
  for (const [index, spellings] of facts.staging?.indices ?? []) {
    if (staged.has(index)) continue;
    for (const entry of spellings.values()) {
      refuse(scan, "lifecycle_foundation_staging_name", entry.path);
    }
  }
  for (const entry of facts.backups?.leaves ?? []) {
    const index = backupIndexOf(entry.path.slice(entry.path.lastIndexOf("/") + 1), allocated);
    if (index === null || index >= journal.mutations.length) {
      refuse(scan, "lifecycle_foundation_backup_name", entry.path);
    }
  }
}

async function resolveId(
  scan: LedgerScanV1,
  id: FoundationTransactionIdV1,
  facts: IdFactsV1,
  journals: Map<FoundationTransactionIdV1, FoundationLedgerHeldJournalV1>,
): Promise<FoundationLedgerOrphanV1 | null> {
  if (facts.journal !== null) {
    journals.set(id, { journal: facts.journal.journal, entry: facts.journal.entry, lock: facts.lock });
    admitDerivedCompanions(scan, id, facts.journal.journal, facts);
    const temp = admitTemporaryCount(scan, facts);
    if (temp === null) return null;
    return (await admitTemporaryJournal(scan, temp, id, { final: facts.journal.journal }))
      ? { kind: "rewrite_temp", id, temp }
      : null;
  }
  if (scan.dependencies.coordinatorParticipantIds.has(id)) {
    const temp = admitTemporaryCount(scan, facts);
    if (temp !== null) await admitTemporaryJournal(scan, temp, id, null);
    return null;
  }
  return resolvePlanless(scan, id, facts);
}

export async function inspectFoundationLedger(
  dependencies: FoundationLedgerDependenciesV1,
  roots: LifecycleLedgerRootsV1,
): Promise<FoundationLedgerV1> {
  const scan: LedgerScanV1 = {
    dependencies,
    roots,
    ids: new Map(),
    findings: [],
    counts: { journalRoot: 0, staging: 0, backups: 0 },
    total: 0,
    stopped: false,
  };

  await scanJournalRoot(scan);
  if (!scan.stopped) await scanCompanionRoot(scan, "backups");
  if (!scan.stopped) await scanCompanionRoot(scan, "staging");

  const journals = new Map<FoundationTransactionIdV1, FoundationLedgerHeldJournalV1>();
  const orphans: FoundationLedgerOrphanV1[] = [];
  if (!scan.stopped) {
    for (const id of [...scan.ids.keys()].sort()) {
      const facts = scan.ids.get(id);
      if (facts === undefined) continue;
      const orphan = await resolveId(scan, id as FoundationTransactionIdV1, facts, journals);
      if (orphan !== null) orphans.push(orphan);
    }
  }

  const findings = [...scan.findings].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    return left.reason === right.reason ? 0 : left.reason < right.reason ? -1 : 1;
  });
  const bounds = LIFECYCLE_LEDGER_BOUNDS;
  return {
    journals,
    orphans,
    findings,
    counts: { ...scan.counts },
    overflow:
      findings.length === 0 &&
      (scan.counts.journalRoot > bounds.journalLeavesPerRoot ||
        scan.counts.staging > bounds.foundationStagingAggregateLeaves ||
        scan.counts.backups > bounds.foundationBackupAggregateLeaves),
  };
}
