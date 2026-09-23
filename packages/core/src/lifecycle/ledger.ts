/**
 * Spec 1 §2.4's coordinator half of the closed four-root ledger, and the one
 * place `LifecycleJournalClosureV1` is decided. It reads the coordinator root,
 * both effect roots and the lifecycle staging companion through the guarded
 * port, consumes Task 10's allocator and Task 11's Foundation inventory, and
 * classifies fail-closed: any finding makes the result
 * `lifecycle_recovery_required` globally, `clear` needs a fully valid terminal
 * ledger, and the only two typed non-clear outcomes are the exact bound push
 * retry and the exact verified uninstall drain.
 *
 * It never mutates. §2.4's cleanup, terminal compaction and overflow recovery
 * are separate guarded protocols that consume this snapshot.
 */
import type { LifecycleInstallNonceV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { TransactionPhase } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseSafeReasonCode,
  type LowerHexSha256,
  type SafeReasonCodeV1,
} from "../update/scalars.js";
import { inspectLifecycleAllocator, type LifecycleAllocatorStateV1 } from "./allocator.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import { decodeCanonicalJson, hashCanonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import type { LifecycleValueCodec } from "./codecs.js";
import {
  GIT_EFFECT_STAGING_SIDES,
  LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  MAX_GIT_EFFECT_JOURNAL_BYTES,
  MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES,
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  effectJournalBinding,
  parseEffectStagingChildren,
  type LifecycleEffectLedgerCodecV1,
  type LifecycleEffectTerminalV1,
} from "./effect-ledger.js";
import {
  inspectFoundationLedger,
  type FoundationLedgerV1,
  type LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
import {
  deriveTerminalCompaction,
  validateCoordinatorJournalForPlan,
  validateLifecyclePlanGrammar,
  type LifecycleOperationVariantV1,
  type LifecycleVariantFactsV1,
} from "./grammar.js";
import {
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  LIFECYCLE_LEDGER_BOUNDS,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
  type FoundationTransactionIdV1,
} from "./ids.js";
import {
  LIFECYCLE_HASH_DOMAINS,
  LIFECYCLE_PLAN_BOUNDS,
  type FoundationTerminalCompactionV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleJournalClosureV1,
} from "./types.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

export interface LifecycleLedgerDependenciesV1<TPlan extends CoordinatorPlan> {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly executionPlanCodec: LifecycleValueCodec<TPlan>;
  readonly coordinatorJournalCodec: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
  readonly variantFacts: (plan: TPlan) => LifecycleVariantFactsV1;
  readonly pushPlanHash: (plan: TPlan) => LowerHexSha256 | null;
  /** null keeps plan 1a's refusal: every leaf in that root, or its staging, is a finding. */
  readonly gitEffectPlanCodec: LifecycleEffectLedgerCodecV1 | null;
  readonly launchdEffectPlanCodec: LifecycleEffectLedgerCodecV1 | null;
  readonly residue: LifecycleBookkeepingResidueV1;
  /** The plan's manifest before-state hash, or null where the variant binds no manifest preimage. */
  readonly manifestBeforeHash: (plan: TPlan) => LowerHexSha256 | null;
  /** The four lease paths an uninstall plan binds, for the draining discriminator. */
  readonly leasePaths: (plan: TPlan) => readonly CanonicalAbsolutePathV1[];
}

export interface LifecycleCoordinatorRecordV1<TPlan> {
  readonly id: LifecycleCoordinatorIdV1;
  readonly plan: TPlan;
  readonly variant: LifecycleOperationVariantV1;
  readonly journal: LifecycleCoordinatorJournalV1 | null;
  readonly lock: LifecycleGuardedEntryV1 | null;
  readonly state:
    | "active"
    | "terminal"
    | "compacting"
    | "pre_journal_orphan"
    | "envelope_suffix_plan_and_lock"
    | "envelope_suffix_plan_only";
}

export interface LifecycleLedgerSnapshotV1<TPlan> {
  readonly closure: LifecycleJournalClosureV1;
  readonly allocator: LifecycleAllocatorStateV1 | null;
  readonly foundation: FoundationLedgerV1;
  readonly coordinators: readonly LifecycleCoordinatorRecordV1<TPlan>[];
  readonly standaloneTerminalFoundation: readonly FoundationTerminalCompactionV1[];
  readonly standaloneNonTerminalFoundation: readonly {
    readonly id: FoundationTransactionIdV1;
    readonly phase: TransactionPhase;
  }[];
  readonly coordinatorOrphans: readonly {
    readonly kind: "planless_staging" | "initial_journal_temp" | "plan_publication_temp" | "rewrite_temp";
    readonly path: CanonicalAbsolutePathV1;
  }[];
  readonly findings: readonly {
    readonly reason: SafeReasonCodeV1;
    readonly path: CanonicalAbsolutePathV1;
  }[];
  readonly counts: {
    readonly coordinatorJournals: number;
    readonly gitEffectJournals: number;
    readonly launchdEffectJournals: number;
    readonly lifecycleStagingAggregate: number;
    readonly lifecycleStagingMaximumPerCoordinator: number;
  };
}

const MAX_PLAN_BYTES = 16_777_216;
const MAX_COORDINATOR_JOURNAL_BYTES = 1_048_576;
const MAX_STAGED_JOURNAL_BYTES = 1_048_576;
/** The manifest is published through a Foundation mutation, so its bytes carry that ceiling. */
const MAX_MANIFEST_BYTES = BigInt(LIFECYCLE_PLAN_BOUNDS.mutationContentSize.maximum);

const PLAN_SUFFIX = ".plan.json";
const JOURNAL_SUFFIX = ".json";
const LOCK_SUFFIX = ".lock";
const PLAN_TEMP_SUFFIX = ".plan.json.tmp";
const JOURNAL_TEMP_SUFFIX = ".json.tmp";
const NONCE_LEAF = "lifecycle-install-nonce";
const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
const STAGED_JOURNAL_LEAF = "journal.json";

const EFFECT_PLAN_DOMAINS = {
  git: LIFECYCLE_HASH_DOMAINS.gitEffectPlan,
  launchd: LIFECYCLE_HASH_DOMAINS.launchdEffectPlan,
} as const;

const LOWERCASE_V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type EffectKindV1 = "git" | "launchd";

interface CoordinatorFactsV1<TPlan> {
  planEntry: LifecycleGuardedEntryV1 | null;
  journalEntry: LifecycleGuardedEntryV1 | null;
  lock: LifecycleGuardedEntryV1 | null;
  readonly journalTemps: LifecycleGuardedEntryV1[];
  readonly planTemps: LifecycleGuardedEntryV1[];
  plan: TPlan | null;
  planHash: LowerHexSha256 | null;
  variant: LifecycleOperationVariantV1 | null;
  journal: LifecycleCoordinatorJournalV1 | null;
  malformed: boolean;
}

interface EffectFactsV1 {
  planEntry: LifecycleGuardedEntryV1 | null;
  journalEntry: LifecycleGuardedEntryV1 | null;
  lock: LifecycleGuardedEntryV1 | null;
  planHash: LowerHexSha256 | null;
  plan: unknown;
  journal: unknown;
  terminal: LifecycleEffectTerminalV1;
  malformed: boolean;
}

interface StagingFactsV1 {
  readonly entry: LifecycleGuardedEntryV1;
  leaves: number;
  readonly participantIds: Set<AllocatedLifecycleIdV1<"tx">>;
}

interface LedgerScanV1<TPlan extends CoordinatorPlan> {
  readonly dependencies: LifecycleLedgerDependenciesV1<TPlan>;
  readonly roots: LifecycleLedgerRootsV1;
  readonly coordinators: Map<string, CoordinatorFactsV1<TPlan>>;
  readonly effects: Record<EffectKindV1, Map<string, EffectFactsV1>>;
  readonly staging: Map<string, StagingFactsV1>;
  readonly findings: { reason: SafeReasonCodeV1; path: CanonicalAbsolutePathV1 }[];
  readonly orphans: LifecycleLedgerSnapshotV1<TPlan>["coordinatorOrphans"][number][];
  readonly counts: {
    coordinatorJournals: number;
    gitEffectJournals: number;
    launchdEffectJournals: number;
    lifecycleStagingAggregate: number;
    lifecycleStagingMaximumPerCoordinator: number;
  };
  stopped: boolean;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function refuse<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  reason: string,
  path: CanonicalAbsolutePathV1,
): void {
  scan.findings.push({ reason: parseSafeReasonCode(reason), path });
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

function leafPath(directory: CanonicalAbsolutePathV1, leaf: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${directory}/${leaf}`);
}

function coordinatorFactsFor<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  id: string,
): CoordinatorFactsV1<TPlan> {
  const existing = scan.coordinators.get(id);
  if (existing !== undefined) return existing;
  const created: CoordinatorFactsV1<TPlan> = {
    planEntry: null,
    journalEntry: null,
    lock: null,
    journalTemps: [],
    planTemps: [],
    plan: null,
    planHash: null,
    variant: null,
    journal: null,
    malformed: false,
  };
  scan.coordinators.set(id, created);
  return created;
}

function effectFactsFor<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  kind: EffectKindV1,
  id: string,
): EffectFactsV1 {
  const map = scan.effects[kind];
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const created: EffectFactsV1 = {
    planEntry: null,
    journalEntry: null,
    lock: null,
    planHash: null,
    plan: null,
    journal: null,
    terminal: null,
    malformed: false,
  };
  map.set(id, created);
  return created;
}

function coordinatorIdOf(value: string, nonce: LifecycleInstallNonceV1 | null): string | null {
  try {
    return parseLifecycleCoordinatorId(value, nonce);
  } catch {
    return null;
  }
}

function participantIdOf(
  value: string,
  nonce: LifecycleInstallNonceV1 | null,
): AllocatedLifecycleIdV1<"tx"> | null {
  try {
    return parseAllocatedLifecycleId("tx", value, nonce);
  } catch {
    return null;
  }
}

function allocatedIdOf(
  prefix: "tx" | "ge" | "le",
  value: string,
  nonce: LifecycleInstallNonceV1 | null,
): string | null {
  try {
    return parseAllocatedLifecycleId(prefix, value, nonce);
  } catch {
    return null;
  }
}

function temporaryStem(name: string, suffix: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(suffix)) return null;
  const stem = name.slice(1, name.length - suffix.length);
  const boundary = stem.lastIndexOf(".");
  if (boundary < 1) return null;
  if (!LOWERCASE_V4_UUID.test(stem.slice(boundary + 1))) return null;
  return stem.slice(0, boundary);
}

function stableLockOwner(name: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(LOCK_SUFFIX)) return null;
  const owner = name.slice(1, name.length - LOCK_SUFFIX.length);
  return owner.length === 0 ? null : owner;
}

async function openRoot<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
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

async function guardedRegularFile<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
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

async function guardedDirectory<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
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

async function guardedText<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  entry: LifecycleGuardedEntryV1,
  maximumBytes: number,
  reason: string,
): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = await scan.dependencies.fs.readRegular(entry, maximumBytes);
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) {
      scan.findings.push({ reason: error.reason, path: entry.path });
      return null;
    }
    throw error;
  }
  try {
    return decoder.decode(bytes);
  } catch {
    refuse(scan, reason, entry.path);
    return null;
  }
}

function admitLeaf<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  counter: "coordinatorJournals" | "gitEffectJournals" | "launchdEffectJournals",
  path: CanonicalAbsolutePathV1,
): boolean {
  scan.counts[counter] += 1;
  if (scan.counts[counter] > LIFECYCLE_LEDGER_BOUNDS.journalLeavesPerRoot) {
    refuse(scan, "ledger_capacity_exceeded", path);
    return false;
  }
  return true;
}

async function scanCoordinatorRoot<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
): Promise<void> {
  const root = await openRoot(scan, scan.roots.coordinatorJournals);
  if (root === null) return;
  for await (const name of scan.dependencies.fs.names(root)) {
    const path = childPath(root.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_coordinator_journal_name", root.path);
      continue;
    }
    if (!admitLeaf(scan, "coordinatorJournals", path)) return;
    if (scan.dependencies.residue.retainedPaths.has(path)) continue;
    await admitCoordinatorLeaf(scan, path, name);
  }
}

async function admitCoordinatorLeaf<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  path: CanonicalAbsolutePathV1,
  name: string,
): Promise<void> {
  const planTemp = temporaryStem(name, PLAN_TEMP_SUFFIX);
  if (planTemp !== null) {
    const id = coordinatorIdOf(planTemp, null);
    if (id !== null) {
      const entry = await guardedRegularFile(scan, path, MAX_PLAN_BYTES, "lifecycle_coordinator_temp_shape");
      const facts = coordinatorFactsFor(scan, id);
      if (entry === null) facts.malformed = true;
      else facts.planTemps.push(entry);
      return;
    }
  }
  const journalTemp = temporaryStem(name, JOURNAL_TEMP_SUFFIX);
  if (journalTemp !== null) {
    const id = coordinatorIdOf(journalTemp, null);
    if (id !== null) {
      const entry = await guardedRegularFile(
        scan,
        path,
        MAX_COORDINATOR_JOURNAL_BYTES,
        "lifecycle_coordinator_temp_shape",
      );
      const facts = coordinatorFactsFor(scan, id);
      if (entry === null) facts.malformed = true;
      else facts.journalTemps.push(entry);
      return;
    }
  }
  const lockOwner = stableLockOwner(name);
  if (lockOwner !== null) {
    const id = coordinatorIdOf(lockOwner, null);
    if (id !== null) {
      const entry = await guardedRegularFile(scan, path, 0, "lifecycle_coordinator_lock_shape");
      const facts = coordinatorFactsFor(scan, id);
      if (entry === null) facts.malformed = true;
      else facts.lock = entry;
      return;
    }
  }
  if (!name.startsWith(".") && name.endsWith(PLAN_SUFFIX)) {
    const id = coordinatorIdOf(name.slice(0, name.length - PLAN_SUFFIX.length), null);
    if (id !== null) {
      const entry = await guardedRegularFile(scan, path, MAX_PLAN_BYTES, "lifecycle_coordinator_plan_shape");
      const facts = coordinatorFactsFor(scan, id);
      if (entry === null) facts.malformed = true;
      else facts.planEntry = entry;
      return;
    }
  }
  if (!name.startsWith(".") && name.endsWith(JOURNAL_SUFFIX)) {
    const id = coordinatorIdOf(name.slice(0, name.length - JOURNAL_SUFFIX.length), null);
    if (id !== null) {
      const entry = await guardedRegularFile(
        scan,
        path,
        MAX_COORDINATOR_JOURNAL_BYTES,
        "lifecycle_coordinator_journal_shape",
      );
      const facts = coordinatorFactsFor(scan, id);
      if (entry === null) facts.malformed = true;
      else facts.journalEntry = entry;
      return;
    }
  }
  refuse(scan, "lifecycle_coordinator_journal_name", path);
}

async function validateCoordinatorEnvelopes<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
): Promise<void> {
  for (const [id, facts] of scan.coordinators) {
    if (facts.planEntry !== null) await validatePlan(scan, id, facts);
    if (facts.journalEntry === null) continue;
    if (facts.planEntry === null) {
      refuse(scan, "lifecycle_coordinator_plan_missing", facts.journalEntry.path);
      facts.malformed = true;
      continue;
    }
    if (facts.plan !== null) await validateJournal(scan, id, facts);
  }
}

async function validatePlan<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  id: string,
  facts: CoordinatorFactsV1<TPlan>,
): Promise<void> {
  const entry = facts.planEntry;
  if (entry === null) return;
  const text = await guardedText(scan, entry, MAX_PLAN_BYTES, "lifecycle_coordinator_plan_bytes");
  if (text === null) {
    facts.malformed = true;
    return;
  }
  let decoded: CanonicalJsonValue;
  let plan: TPlan;
  try {
    decoded = decodeCanonicalJson(new TextEncoder().encode(text), MAX_PLAN_BYTES);
    plan = scan.dependencies.executionPlanCodec.validate(decoded);
    if (scan.dependencies.executionPlanCodec.encode(plan) !== text) {
      throw new Error("plan bytes are not their own re-encoding");
    }
  } catch {
    refuse(scan, "lifecycle_coordinator_plan_bytes", entry.path);
    facts.malformed = true;
    return;
  }
  if (plan.id !== id) {
    refuse(scan, "lifecycle_coordinator_plan_identity", entry.path);
    facts.malformed = true;
    return;
  }
  let variant: LifecycleOperationVariantV1;
  try {
    variant = validateLifecyclePlanGrammar(plan, scan.dependencies.variantFacts(plan));
  } catch {
    refuse(scan, "lifecycle_coordinator_plan_grammar", entry.path);
    facts.malformed = true;
    return;
  }
  facts.plan = plan;
  facts.variant = variant;
  facts.planHash = hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.coordinatorPlan, decoded);
}

async function validateJournal<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  id: string,
  facts: CoordinatorFactsV1<TPlan>,
): Promise<void> {
  const entry = facts.journalEntry;
  const plan = facts.plan;
  const variant = facts.variant;
  if (entry === null || plan === null || variant === null) return;
  if (BigInt(entry.size) > BigInt(plan.maximumJournalBytes)) {
    refuse(scan, "lifecycle_coordinator_journal_shape", entry.path);
    facts.malformed = true;
    return;
  }
  const text = await guardedText(
    scan,
    entry,
    plan.maximumJournalBytes,
    "lifecycle_coordinator_journal_bytes",
  );
  if (text === null) {
    facts.malformed = true;
    return;
  }
  let journal: LifecycleCoordinatorJournalV1;
  try {
    const decoded = decodeCanonicalJson(new TextEncoder().encode(text), plan.maximumJournalBytes);
    journal = scan.dependencies.coordinatorJournalCodec.validate(decoded);
    if (scan.dependencies.coordinatorJournalCodec.encode(journal) !== text) {
      throw new Error("journal bytes are not their own re-encoding");
    }
  } catch {
    refuse(scan, "lifecycle_coordinator_journal_bytes", entry.path);
    facts.malformed = true;
    return;
  }
  if (journal.id !== id) {
    refuse(scan, "lifecycle_coordinator_journal_identity", entry.path);
    facts.malformed = true;
    return;
  }
  if (journal.planHash !== facts.planHash) {
    refuse(scan, "lifecycle_coordinator_plan_hash", entry.path);
    facts.malformed = true;
    return;
  }
  try {
    validateCoordinatorJournalForPlan(plan, journal, variant, scan.dependencies.pushPlanHash(plan));
  } catch {
    refuse(scan, "lifecycle_coordinator_journal_state", entry.path);
    facts.malformed = true;
    return;
  }
  facts.journal = journal;
}

/**
 * §2.4's only missing-control-file exception: the exact uninstall `compacting`,
 * plan-plus-lock or plan-only envelope cursor. Anything else that cannot read
 * both control files is a finding, so a home that lost them cannot allocate.
 */
function admitsControlFileAbsence<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
): boolean {
  if (scan.coordinators.size !== 1) return false;
  const [facts] = [...scan.coordinators.values()];
  if (facts === undefined || facts.plan === null || facts.malformed) return false;
  if (facts.plan.operation !== "uninstall") return false;
  if (facts.journal === null) return facts.journalEntry === null;
  if (facts.journal.phase !== "compacting") return false;
  const entries = deriveTerminalCompaction(facts.plan, facts.journal.terminalOutcome ?? "finalized").entries;
  return facts.journal.compactionNext === entries.length - 1;
}

async function resolveAllocator<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  allocatedIds: readonly string[],
): Promise<LifecycleAllocatorStateV1 | null> {
  const { fs } = scan.dependencies;
  const noncePath = leafPath(scan.roots.stateDirectory, NONCE_LEAF);
  const allocatorPath = leafPath(scan.roots.stateDirectory, ALLOCATOR_LEAF);
  const nonce = await fs.lstat(noncePath);
  const allocator = await fs.lstat(allocatorPath);
  if (nonce !== null && allocator !== null) {
    try {
      const state = await inspectLifecycleAllocator(
        fs,
        scan.roots.stateDirectory,
        scan.dependencies.effectiveUid,
        allocatedIds,
      );
      if (state.temp !== null) refuse(scan, "lifecycle_allocator_temp_present", state.temp.path);
      return state;
    } catch (error) {
      if (!(error instanceof LifecycleRecoveryRequiredError)) throw error;
      scan.findings.push({
        reason: error.reason,
        path: parseCanonicalAbsolutePathText(error.paths[0] ?? allocatorPath),
      });
      return null;
    }
  }
  if (nonce === null && allocator !== null) {
    refuse(scan, "lifecycle_install_nonce_shape", noncePath);
    return null;
  }
  if (admitsControlFileAbsence(scan)) return null;
  refuse(scan, "lifecycle_id_allocator_shape", allocatorPath);
  return null;
}

function effectRootPath<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  kind: EffectKindV1,
): CanonicalAbsolutePathV1 {
  return kind === "git" ? scan.roots.gitEffectJournals : scan.roots.launchdEffectJournals;
}

async function scanEffectRoot<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  kind: EffectKindV1,
  nonce: LifecycleInstallNonceV1 | null,
): Promise<void> {
  const counter = kind === "git" ? "gitEffectJournals" : "launchdEffectJournals";
  const codec = kind === "git" ? scan.dependencies.gitEffectPlanCodec : scan.dependencies.launchdEffectPlanCodec;
  const root = await openRoot(scan, effectRootPath(scan, kind));
  if (root === null) return;
  const prefix = kind === "git" ? "ge" : "le";
  const maximumJournalBytes =
    kind === "git" ? MAX_GIT_EFFECT_JOURNAL_BYTES : MAX_LAUNCHD_EFFECT_JOURNAL_BYTES;
  for await (const name of scan.dependencies.fs.names(root)) {
    const path = childPath(root.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_effect_name", root.path);
      continue;
    }
    if (!admitLeaf(scan, counter, path)) return;
    if (scan.dependencies.residue.retainedPaths.has(path)) continue;
    if (codec === null) {
      refuse(scan, "lifecycle_effect_root_unsupported", path);
      continue;
    }
    const lockOwner = stableLockOwner(name);
    if (lockOwner !== null) {
      const id = allocatedIdOf(prefix, lockOwner, nonce);
      if (id !== null) {
        const entry = await guardedRegularFile(scan, path, 0, "lifecycle_effect_lock_shape");
        const facts = effectFactsFor(scan, kind, id);
        if (entry === null) facts.malformed = true;
        else facts.lock = entry;
        continue;
      }
    }
    if (!name.startsWith(".") && name.endsWith(PLAN_SUFFIX)) {
      const id = allocatedIdOf(prefix, name.slice(0, name.length - PLAN_SUFFIX.length), nonce);
      if (id !== null) {
        const entry = await guardedRegularFile(scan, path, MAX_PLAN_BYTES, "lifecycle_effect_plan_shape");
        const facts = effectFactsFor(scan, kind, id);
        if (entry === null) {
          facts.malformed = true;
          continue;
        }
        facts.planEntry = entry;
        await admitEffectPlan(scan, kind, codec.plan, facts, entry);
        continue;
      }
    }
    if (!name.startsWith(".") && name.endsWith(JOURNAL_SUFFIX)) {
      const id = allocatedIdOf(prefix, name.slice(0, name.length - JOURNAL_SUFFIX.length), nonce);
      if (id !== null) {
        const entry = await guardedRegularFile(
          scan,
          path,
          maximumJournalBytes,
          "lifecycle_effect_journal_shape",
        );
        const facts = effectFactsFor(scan, kind, id);
        if (entry === null) facts.malformed = true;
        else facts.journalEntry = entry;
        continue;
      }
    }
    refuse(scan, "lifecycle_effect_name", path);
  }
  if (codec !== null) await validateEffectJournals(scan, kind, codec, maximumJournalBytes);
}

async function admitEffectPlan<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  kind: EffectKindV1,
  codec: LifecycleValueCodec<unknown>,
  facts: EffectFactsV1,
  entry: LifecycleGuardedEntryV1,
): Promise<void> {
  const text = await guardedText(scan, entry, MAX_PLAN_BYTES, "lifecycle_effect_plan_bytes");
  if (text === null) {
    facts.malformed = true;
    return;
  }
  try {
    const decoded = decodeCanonicalJson(new TextEncoder().encode(text), MAX_PLAN_BYTES);
    const plan = codec.validate(decoded);
    if (codec.encode(plan) !== text) {
      throw new Error("effect plan bytes are not their own re-encoding");
    }
    facts.plan = plan;
    facts.planHash = hashCanonicalJson(EFFECT_PLAN_DOMAINS[kind], decoded);
  } catch {
    refuse(scan, "lifecycle_effect_plan_bytes", entry.path);
    facts.malformed = true;
  }
}

/**
 * Runs after the whole root is enumerated, because a journal is judged against
 * its plan's hash and directory order puts no plan before its journal.
 */
async function validateEffectJournals<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  kind: EffectKindV1,
  codec: LifecycleEffectLedgerCodecV1,
  maximumJournalBytes: number,
): Promise<void> {
  for (const [id, facts] of scan.effects[kind]) {
    const entry = facts.journalEntry;
    if (entry === null || facts.malformed || facts.planHash === null) continue;
    const text = await guardedText(scan, entry, maximumJournalBytes, "lifecycle_effect_journal_bytes");
    if (text === null) {
      facts.malformed = true;
      continue;
    }
    let journal: unknown;
    try {
      const decoded = decodeCanonicalJson(new TextEncoder().encode(text), maximumJournalBytes);
      journal = codec.journal.validate(decoded);
      if (codec.journal.encode(journal) !== text) {
        throw new Error("effect journal bytes are not their own re-encoding");
      }
    } catch {
      refuse(scan, "lifecycle_effect_journal_bytes", entry.path);
      facts.malformed = true;
      continue;
    }
    const binding = effectJournalBinding(journal);
    if (binding === null || binding.id !== id) {
      refuse(scan, "lifecycle_effect_journal_identity", entry.path);
      facts.malformed = true;
      continue;
    }
    if (binding.planHash !== facts.planHash) {
      refuse(scan, "lifecycle_effect_plan_hash", entry.path);
      facts.malformed = true;
      continue;
    }
    facts.journal = journal;
    facts.terminal = codec.terminal(journal);
  }
}

const STAGING_CHILDREN = ["foundation", "git", "launchd-process"] as const;

async function scanLifecycleStaging<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  nonce: LifecycleInstallNonceV1 | null,
): Promise<void> {
  const root = await openRoot(scan, scan.roots.lifecycleStaging);
  if (root === null) return;
  for await (const name of scan.dependencies.fs.names(root)) {
    const path = childPath(root.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_staging_name", root.path);
      continue;
    }
    if (!admitStagingLeaf(scan, path)) return;
    if (scan.dependencies.residue.retainedPaths.has(path)) continue;
    const id = coordinatorIdOf(name, nonce);
    if (id === null) {
      refuse(scan, "lifecycle_staging_name", path);
      continue;
    }
    const entry = await guardedDirectory(scan, path, "lifecycle_staging_shape");
    if (entry === null) continue;
    const facts: StagingFactsV1 = { entry, leaves: 1, participantIds: new Set() };
    scan.staging.set(id, facts);
    await scanCoordinatorStaging(scan, id, facts, nonce);
    scan.counts.lifecycleStagingMaximumPerCoordinator = Math.max(
      scan.counts.lifecycleStagingMaximumPerCoordinator,
      facts.leaves,
    );
    if (facts.leaves > LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingPerCoordinatorLeaves) {
      refuse(scan, "ledger_capacity_exceeded", entry.path);
      scan.stopped = true;
    }
    if (scan.stopped) return;
  }
}

function admitStagingLeaf<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  path: CanonicalAbsolutePathV1,
): boolean {
  scan.counts.lifecycleStagingAggregate += 1;
  if (scan.counts.lifecycleStagingAggregate > LIFECYCLE_LEDGER_BOUNDS.lifecycleStagingAggregateLeaves) {
    refuse(scan, "ledger_capacity_exceeded", path);
    scan.stopped = true;
    return false;
  }
  return true;
}

async function scanCoordinatorStaging<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  coordinatorId: string,
  facts: StagingFactsV1,
  nonce: LifecycleInstallNonceV1 | null,
): Promise<void> {
  for await (const name of scan.dependencies.fs.names(facts.entry)) {
    const path = childPath(facts.entry.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_staging_name", facts.entry.path);
      continue;
    }
    if (!admitStagingLeaf(scan, path)) return;
    facts.leaves += 1;
    if (!STAGING_CHILDREN.includes(name as (typeof STAGING_CHILDREN)[number])) {
      refuse(scan, "lifecycle_staging_name", path);
      continue;
    }
    const entry = await guardedDirectory(scan, path, "lifecycle_staging_shape");
    if (entry === null) continue;
    if (name === "foundation") {
      await scanStagedParticipants(scan, facts, entry, nonce);
      if (scan.stopped) return;
      continue;
    }
    const codec = name === "git" ? scan.dependencies.gitEffectPlanCodec : scan.dependencies.launchdEffectPlanCodec;
    if (codec === null) {
      refuse(scan, "lifecycle_staging_effect_unsupported", path);
      continue;
    }
    const admit =
      name === "git"
        ? gitStagingAdmission(scan, coordinatorId, codec, entry.path, nonce)
        : launchdStagingAdmission(scan, coordinatorId, codec, entry.path);
    await countStagingSubtree(scan, facts, entry, admit, "");
    if (scan.stopped) return;
  }
}

/**
 * What a relative path below `git` or `launchd-process` must be: a guarded
 * 0700 directory, any owner-held directory or regular file a validated effect
 * plan lists, or the one bounded 0600 bootstrap snapshot.
 */
type StagingShapeV1 = "directory" | "entry" | "snapshot";
type StagingAdmissionV1 = (relative: string) => StagingShapeV1 | null;

function effectStagingChildren<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  codec: LifecycleEffectLedgerCodecV1,
  plan: unknown,
  path: CanonicalAbsolutePathV1,
): ReadonlySet<string> {
  try {
    return parseEffectStagingChildren(codec.stagingChildren(plan));
  } catch {
    refuse(scan, "lifecycle_effect_staging_children", path);
    return new Set();
  }
}

/**
 * Exact `<side>/<ge-id>` directories. With a coordinator plan, only its bound
 * side/effect pairs and the children each validated effect plan owns are
 * admitted. A planless tree may hold only empty ID directories, because no
 * immutable plan yet says what may sit inside them.
 */
function gitStagingAdmission<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  coordinatorId: string,
  codec: LifecycleEffectLedgerCodecV1,
  path: CanonicalAbsolutePathV1,
  nonce: LifecycleInstallNonceV1 | null,
): StagingAdmissionV1 {
  const plan = scan.coordinators.get(coordinatorId)?.plan ?? null;
  const admitted = new Map<string, StagingShapeV1>();
  if (plan === null) {
    for (const side of GIT_EFFECT_STAGING_SIDES) admitted.set(side, "directory");
    return (relative) => {
      const known = admitted.get(relative);
      if (known !== undefined) return known;
      const [side, id, ...rest] = relative.split("/");
      const planless =
        rest.length === 0 &&
        side !== undefined &&
        admitted.has(side) &&
        id !== undefined &&
        allocatedIdOf("ge", id, nonce) !== null;
      return planless ? "directory" : null;
    };
  }
  const sides = [
    ["source", plan.participants.sourceGitEffect],
    ["destination", plan.participants.destinationGitEffect],
  ] as const;
  for (const [side, ref] of sides) {
    if (ref === null) continue;
    const prefix = `${side}/${ref.id}`;
    admitted.set(side, "directory");
    admitted.set(prefix, "directory");
    const effect = scan.effects.git.get(ref.id);
    if (effect === undefined || effect.malformed || effect.plan === null) continue;
    for (const child of effectStagingChildren(scan, codec, effect.plan, path)) {
      admitted.set(`${prefix}/${child}`, "entry");
    }
  }
  return (relative) => admitted.get(relative) ?? null;
}

/**
 * `home` and `tmp` stay empty at every process boundary (spec §2.4, §5.3). The
 * one exception is the linked bootstrap snapshot in `tmp`, admitted only while
 * one of this coordinator's launchd effects holds a non-terminal journal whose
 * plan owns it; whether that journal names the exact current frontier is the
 * effect-locked recovery's check, not this read-only one.
 */
function launchdStagingAdmission<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  coordinatorId: string,
  codec: LifecycleEffectLedgerCodecV1,
  path: CanonicalAbsolutePathV1,
): StagingAdmissionV1 {
  const admitted = new Map<string, StagingShapeV1>(
    LAUNCHD_PROCESS_STAGING_CHILDREN.map((child) => [child, "directory"]),
  );
  const plan = scan.coordinators.get(coordinatorId)?.plan ?? null;
  const refs = plan === null ? [] : [plan.participants.launchdBeforeFiles, plan.participants.launchdAfterFiles];
  for (const ref of refs) {
    if (ref === null) continue;
    const effect = scan.effects.launchd.get(ref.id);
    if (
      effect === undefined ||
      effect.malformed ||
      effect.plan === null ||
      effect.journal === null ||
      effect.terminal !== null
    ) {
      continue;
    }
    if (effectStagingChildren(scan, codec, effect.plan, path).has(LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD)) {
      admitted.set(LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD, "snapshot");
    }
  }
  return (relative) => admitted.get(relative) ?? null;
}

async function admitStagingShape<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  path: CanonicalAbsolutePathV1,
  shape: StagingShapeV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  if (shape === "directory") return guardedDirectory(scan, path, "lifecycle_staging_shape");
  if (shape === "snapshot") {
    return guardedRegularFile(scan, path, MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES, "lifecycle_staging_shape");
  }
  const entry = await scan.dependencies.fs.lstat(path);
  if (
    entry === null ||
    (entry.kind !== "directory" && entry.kind !== "regular_file") ||
    entry.ownerUid !== scan.dependencies.effectiveUid
  ) {
    refuse(scan, "lifecycle_staging_shape", path);
    return null;
  }
  return entry;
}

/**
 * The one walker for effect staging: every entry counts against the ledger
 * caps, and each must be admitted by its exact relative path and shape. An
 * unadmitted entry is a finding and is not descended into.
 */
async function countStagingSubtree<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  facts: StagingFactsV1,
  directory: LifecycleGuardedEntryV1,
  admit: StagingAdmissionV1,
  prefix: string,
): Promise<void> {
  for await (const name of scan.dependencies.fs.names(directory)) {
    const child = childPath(directory.path, name);
    if (child === null) {
      refuse(scan, "lifecycle_staging_name", directory.path);
      continue;
    }
    if (!admitStagingLeaf(scan, child)) return;
    facts.leaves += 1;
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    const shape = admit(relative);
    if (shape === null) {
      refuse(scan, "lifecycle_staging_name", child);
      continue;
    }
    const entry = await admitStagingShape(scan, child, shape);
    if (entry !== null && entry.kind === "directory") {
      await countStagingSubtree(scan, facts, entry, admit, relative);
      if (scan.stopped) return;
    }
  }
}

async function scanStagedParticipants<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  facts: StagingFactsV1,
  foundation: LifecycleGuardedEntryV1,
  nonce: LifecycleInstallNonceV1 | null,
): Promise<void> {
  for await (const name of scan.dependencies.fs.names(foundation)) {
    const path = childPath(foundation.path, name);
    if (path === null) {
      refuse(scan, "lifecycle_staging_name", foundation.path);
      continue;
    }
    if (!admitStagingLeaf(scan, path)) return;
    facts.leaves += 1;
    const id = participantIdOf(name, nonce);
    if (id === null) {
      refuse(scan, "lifecycle_staging_name", path);
      continue;
    }
    const entry = await guardedDirectory(scan, path, "lifecycle_staging_shape");
    if (entry === null) continue;
    facts.participantIds.add(id);
    for await (const child of scan.dependencies.fs.names(entry)) {
      const childLeaf = childPath(entry.path, child);
      if (childLeaf === null) {
        refuse(scan, "lifecycle_staging_name", entry.path);
        continue;
      }
      if (!admitStagingLeaf(scan, childLeaf)) return;
      facts.leaves += 1;
      if (child !== STAGED_JOURNAL_LEAF) {
        refuse(scan, "lifecycle_staging_name", childLeaf);
        continue;
      }
      await guardedRegularFile(scan, childLeaf, MAX_STAGED_JOURNAL_BYTES, "lifecycle_staging_shape");
    }
  }
}

async function earlierCompactionEntriesAbsent<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  id: string,
  plan: TPlan,
  foundation: FoundationLedgerV1,
): Promise<boolean> {
  let entries;
  try {
    entries = deriveTerminalCompaction(plan, "finalized").entries.slice(0, -1);
  } catch {
    return false;
  }
  for (const entry of entries) {
    switch (entry.kind) {
      case "foundation_transaction": {
        const participant = entry.participantId as string;
        if (foundation.journals.has(entry.participantId)) return false;
        for (const candidate of [
          leafPath(scan.roots.foundationStaging, participant),
          leafPath(scan.roots.foundationBackups, participant),
          leafPath(scan.roots.foundationJournals, `.${participant}${LOCK_SUFFIX}`),
        ]) {
          if ((await scan.dependencies.fs.lstat(candidate)) !== null) return false;
        }
        break;
      }
      case "git_effect":
        if (scan.effects.git.has(entry.participantId)) return false;
        break;
      case "launchd_effect":
        if (scan.effects.launchd.has(entry.participantId)) return false;
        break;
      case "coordinator_staging":
        if (scan.staging.has(id)) return false;
        if ((await scan.dependencies.fs.lstat(leafPath(scan.roots.lifecycleStaging, id))) !== null) {
          return false;
        }
        break;
      case "coordinator_envelope":
        break;
    }
  }
  return true;
}

type ParticipantPositionV1 = "consumed" | "current" | "future";

/**
 * A durable cursor advance follows the participant it authorized, so the step
 * the cursor sits on may legally hold a journal in any phase while every step
 * behind it must be `finalized` and every step ahead must hold none.
 */
function forwardPosition(index: number, cursor: number): ParticipantPositionV1 {
  if (index < cursor) return "consumed";
  return index === cursor ? "current" : "future";
}

function compensationPosition(index: number, cursor: number): ParticipantPositionV1 {
  if (index > cursor) return "consumed";
  return index === cursor ? "current" : "future";
}

function participantPositions(
  plan: CoordinatorPlan,
  journal: LifecycleCoordinatorJournalV1,
): ReadonlyMap<string, ParticipantPositionV1> {
  const positions = new Map<string, ParticipantPositionV1>();
  const byId = new Map(plan.participants.foundation.map((ref) => [ref.id as string, ref]));
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind !== "foundation") continue;
    positions.set(step.participantId, forwardPosition(index, journal.nextStep));
    const ref = byId.get(step.participantId);
    const compensationId = ref?.role.kind === "forward" ? ref.role.compensationId : null;
    if (compensationId === null) continue;
    positions.set(
      compensationId,
      journal.compensationNext === null || index >= journal.nextStep
        ? "future"
        : compensationPosition(index, journal.compensationNext),
    );
  }
  return positions;
}

/**
 * §2.4: a missing consumed participant, an unpaired compensation journal, or a
 * participant journal earlier than its current position is malformed. Compaction
 * removes these journals one entry at a time under its own cursor, so a
 * `compacting` coordinator is judged by Task 14's protocol, not by this rule.
 */
function admitParticipantCursor<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  plan: TPlan,
  journal: LifecycleCoordinatorJournalV1,
  foundation: FoundationLedgerV1,
): void {
  if (journal.phase === "compacting") return;
  const positions = participantPositions(plan, journal);
  for (const ref of plan.participants.foundation) {
    const position = positions.get(ref.id) ?? "future";
    if (position === "current") continue;
    const held = foundation.journals.get(ref.id);
    const legal =
      position === "consumed"
        ? held !== undefined && held.journal.phase === "finalized"
        : held === undefined;
    if (legal) continue;
    refuse(
      scan,
      "lifecycle_coordinator_participant_state",
      leafPath(scan.roots.foundationJournals, `${ref.id}${JOURNAL_SUFFIX}`),
    );
  }
}

function participantFinalJournalExists(
  plan: CoordinatorPlan,
  foundation: FoundationLedgerV1,
): boolean {
  return plan.participants.foundation.some((ref) => foundation.journals.has(ref.id));
}

async function resolveCoordinators<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  foundation: FoundationLedgerV1,
): Promise<readonly LifecycleCoordinatorRecordV1<TPlan>[]> {
  const records: LifecycleCoordinatorRecordV1<TPlan>[] = [];
  for (const id of [...scan.coordinators.keys()].sort()) {
    const facts = scan.coordinators.get(id);
    if (facts === undefined) continue;
    resolveCoordinatorTemps(scan, facts, foundation);
    if (facts.malformed) continue;
    const plan = facts.plan;
    const variant = facts.variant;
    if (plan === null || variant === null) {
      if (facts.planEntry === null && facts.journalEntry === null && facts.lock !== null) {
        refuse(scan, "lifecycle_coordinator_lock_only", facts.lock.path);
      }
      continue;
    }
    const coordinatorId = plan.id;
    const journal = facts.journal;
    if (journal !== null) {
      const state =
        journal.phase === "compacting"
          ? "compacting"
          : journal.phase === "finalized" || journal.phase === "rolled_back"
            ? "terminal"
            : "active";
      admitParticipantCursor(scan, plan, journal, foundation);
      records.push({ id: coordinatorId, plan, variant, journal, lock: facts.lock, state });
      continue;
    }
    if (await earlierCompactionEntriesAbsent(scan, id, plan, foundation)) {
      records.push({
        id: coordinatorId,
        plan,
        variant,
        journal: null,
        lock: facts.lock,
        state: facts.lock === null ? "envelope_suffix_plan_only" : "envelope_suffix_plan_and_lock",
      });
      continue;
    }
    if (!participantFinalJournalExists(plan, foundation)) {
      records.push({
        id: coordinatorId,
        plan,
        variant,
        journal: null,
        lock: facts.lock,
        state: "pre_journal_orphan",
      });
      continue;
    }
    if (facts.planEntry !== null) {
      refuse(scan, "lifecycle_coordinator_suffix_state", facts.planEntry.path);
    }
  }
  return records;
}

/**
 * §2.4's narrower initial-publication cleanup: an empty, partial or complete
 * temp needs no parse in exactly the states where durable intent cannot yet have
 * authorized a mutation, while a post-intent rewrite temp keeps the strict
 * final/plan-hash rule its holder checks under the stable lock.
 */
function resolveCoordinatorTemps<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  facts: CoordinatorFactsV1<TPlan>,
  foundation: FoundationLedgerV1,
): void {
  const temps = [...facts.planTemps, ...facts.journalTemps];
  const [first, second] = temps;
  if (first === undefined) return;
  if (second !== undefined) {
    refuse(scan, "lifecycle_coordinator_temp_count", first.path);
    facts.malformed = true;
    return;
  }
  const participantsStarted =
    facts.plan !== null && participantFinalJournalExists(facts.plan, foundation);
  if (facts.planTemps.length === 1) {
    if (facts.planEntry === null && facts.journalEntry === null) {
      scan.orphans.push({ kind: "plan_publication_temp", path: first.path });
      return;
    }
    refuse(scan, "lifecycle_coordinator_temp_state", first.path);
    return;
  }
  if (facts.journal !== null) {
    scan.orphans.push({ kind: "rewrite_temp", path: first.path });
    return;
  }
  if (facts.journalEntry === null && facts.plan !== null && !participantsStarted) {
    scan.orphans.push({ kind: "initial_journal_temp", path: first.path });
    return;
  }
  refuse(scan, "lifecycle_coordinator_temp_state", first.path);
}

const TERMINAL_FOUNDATION_PHASES: readonly TransactionPhase[] = ["finalized", "rolled_back"];

function nonTerminalRecords<TPlan extends CoordinatorPlan>(
  records: readonly LifecycleCoordinatorRecordV1<TPlan>[],
): readonly LifecycleCoordinatorRecordV1<TPlan>[] {
  return records.filter((record) => record.state !== "terminal");
}

function stepIndexOf<TPlan extends CoordinatorPlan>(
  plan: TPlan,
  predicate: (step: TPlan["steps"][number]) => boolean,
): number {
  return plan.steps.findIndex((step) => predicate(step));
}

async function admitsUninstallDraining<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  record: LifecycleCoordinatorRecordV1<TPlan>,
  foundation: FoundationLedgerV1,
): Promise<boolean> {
  const { plan, journal } = record;
  if (journal === null || record.state !== "active") return false;
  if (plan.operation !== "uninstall") return false;
  /**
   * D45 repeats the step; the first one is the witness because the CLI orders the four runner
   * leases ahead of every other removal, so they never fall in a later chunk.
   */
  const artifacts = stepIndexOf(
    plan,
    (step) => step.kind === "foundation" && step.slot === "uninstall_artifacts",
  );
  const commitAbsence = stepIndexOf(
    plan,
    (step) => step.kind === "manifest" && step.transition === "commit_absence",
  );
  if (artifacts < 0 || commitAbsence < 0) return false;
  /** §2.2 admits the drain "at or beyond" the artifacts step: the cursor advance follows its journal. */
  if (journal.nextStep < artifacts) return false;
  const step = plan.steps[artifacts];
  if (step === undefined || step.kind !== "foundation") return false;
  const held = foundation.journals.get(step.participantId);
  if (held === undefined || held.journal.phase !== "finalized") return false;
  for (const lease of scan.dependencies.leasePaths(plan)) {
    if ((await scan.dependencies.fs.lstat(lease)) !== null) return false;
  }
  return manifestAgreesWithCursor(scan, plan, journal.nextStep <= commitAbsence);
}

/**
 * §7: the drain cannot be synthesized by path absence, so a manifest the cursor
 * still places at its preimage must carry that preimage's exact bytes. Past
 * `M(commit_absence)` the manifest state is `absent`, which binds no bytes, so
 * agreement there is presence-only and no preimage hash is consulted.
 */
async function manifestAgreesWithCursor<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  plan: TPlan,
  expectPresent: boolean,
): Promise<boolean> {
  const manifest = await scan.dependencies.fs.lstat(plan.authority.manifestPath);
  if (!expectPresent) return manifest === null;
  if (manifest === null || manifest.kind !== "regular_file") return false;
  const expected = scan.dependencies.manifestBeforeHash(plan);
  if (expected === null) return false;
  try {
    return (await scan.dependencies.fs.hashRegular(manifest, MAX_MANIFEST_BYTES)) === expected;
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) return false;
    throw error;
  }
}

/**
 * A journal the codec did not call terminal, including every journal present
 * under a `null` codec, keeps closure non-clear.
 */
function nonTerminalEffectJournals<TPlan extends CoordinatorPlan>(scan: LedgerScanV1<TPlan>): number {
  let present = 0;
  for (const kind of ["git", "launchd"] as const) {
    for (const facts of scan.effects[kind].values()) {
      if (facts.journalEntry !== null && facts.terminal === null) present += 1;
    }
  }
  return present;
}

function admitEffectCursors<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  records: readonly LifecycleCoordinatorRecordV1<TPlan>[],
): void {
  for (const kind of ["git", "launchd"] as const) {
    for (const [id, facts] of scan.effects[kind]) {
      if (facts.malformed) continue;
      const reference = referencedEffect(records, id);
      if (reference === null) {
        const path = facts.planEntry ?? facts.journalEntry ?? facts.lock;
        if (path !== null) refuse(scan, "lifecycle_effect_unreferenced", path.path);
        continue;
      }
      if (facts.planEntry === null) {
        const path = facts.journalEntry ?? facts.lock;
        if (facts.journalEntry !== null && path !== null) {
          refuse(scan, "lifecycle_effect_plan_missing", path.path);
        }
        continue;
      }
      if (facts.planHash !== reference.planHash) {
        refuse(scan, "lifecycle_effect_plan_hash", facts.planEntry.path);
        continue;
      }
      if (facts.journalEntry === null && reference.stepIndex < reference.nextStep) {
        refuse(scan, "lifecycle_effect_journal_missing", facts.planEntry.path);
      }
    }
  }
}

function referencedEffect<TPlan extends CoordinatorPlan>(
  records: readonly LifecycleCoordinatorRecordV1<TPlan>[],
  id: string,
): { readonly planHash: LowerHexSha256; readonly stepIndex: number; readonly nextStep: number } | null {
  for (const record of records) {
    const arms = [
      record.plan.participants.sourceGitEffect,
      record.plan.participants.destinationGitEffect,
      record.plan.participants.launchdBeforeFiles,
      record.plan.participants.launchdAfterFiles,
    ];
    for (const arm of arms) {
      if (arm === null || (arm.id as string) !== id) continue;
      const stepIndex = record.plan.steps.findIndex(
        (step) => "participantId" in step && (step.participantId as string) === id,
      );
      return {
        planHash: arm.planHash,
        stepIndex,
        nextStep: record.journal?.nextStep ?? record.plan.steps.length,
      };
    }
  }
  return null;
}

function classify<TPlan extends CoordinatorPlan>(
  scan: LedgerScanV1<TPlan>,
  records: readonly LifecycleCoordinatorRecordV1<TPlan>[],
  foundation: FoundationLedgerV1,
  standaloneNonTerminal: number,
): Promise<LifecycleJournalClosureV1> {
  if (scan.findings.length > 0 || foundation.findings.length > 0) {
    return Promise.resolve({ kind: "lifecycle_recovery_required" });
  }
  if (foundation.overflow || scan.orphans.length > 0) {
    return Promise.resolve({ kind: "lifecycle_recovery_required" });
  }
  if (foundation.orphans.some((orphan) => orphan.kind !== "lock_only")) {
    return Promise.resolve({ kind: "lifecycle_recovery_required" });
  }
  const candidates = nonTerminalRecords(records);
  const others = standaloneNonTerminal + nonTerminalEffectJournals(scan);
  if (candidates.length === 0 && others === 0) return Promise.resolve({ kind: "clear" });
  const [candidate] = candidates;
  if (candidates.length !== 1 || others > 0 || candidate === undefined) {
    return Promise.resolve({ kind: "lifecycle_recovery_required" });
  }
  const journal = candidate.journal;
  if (journal !== null && journal.phase === "push_pending") {
    const pushPlanHash = scan.dependencies.pushPlanHash(candidate.plan);
    if (pushPlanHash !== null && journal.pushPlanHash === pushPlanHash) {
      return Promise.resolve({ kind: "retry_only", transactionId: candidate.id, pushPlanHash });
    }
    return Promise.resolve({ kind: "lifecycle_recovery_required" });
  }
  return admitsUninstallDraining(scan, candidate, foundation).then((drained) =>
    drained
      ? { kind: "uninstall_draining", transactionId: candidate.id }
      : { kind: "lifecycle_recovery_required" },
  );
}

export async function inspectLifecycleLedger<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleLedgerDependenciesV1<TPlan>,
  roots: LifecycleLedgerRootsV1,
): Promise<LifecycleLedgerSnapshotV1<TPlan>> {
  const scan: LedgerScanV1<TPlan> = {
    dependencies,
    roots,
    coordinators: new Map(),
    effects: { git: new Map(), launchd: new Map() },
    staging: new Map(),
    findings: [],
    orphans: [],
    counts: {
      coordinatorJournals: 0,
      gitEffectJournals: 0,
      launchdEffectJournals: 0,
      lifecycleStagingAggregate: 0,
      lifecycleStagingMaximumPerCoordinator: 0,
    },
    stopped: false,
  };

  await scanCoordinatorRoot(scan);
  await validateCoordinatorEnvelopes(scan);

  const participantIds = new Set<string>();
  const allocatedIds: string[] = [];
  for (const [id, facts] of scan.coordinators) {
    allocatedIds.push(id);
    if (facts.plan === null) continue;
    for (const ref of facts.plan.participants.foundation) participantIds.add(ref.id);
    for (const arm of [
      facts.plan.participants.sourceGitEffect,
      facts.plan.participants.destinationGitEffect,
      facts.plan.participants.launchdBeforeFiles,
      facts.plan.participants.launchdAfterFiles,
    ]) {
      if (arm !== null) allocatedIds.push(arm.id);
    }
  }
  for (const id of participantIds) allocatedIds.push(id);

  const allocator = await resolveAllocator(scan, allocatedIds);
  const nonce = allocator?.nonce ?? null;

  const foundation = await inspectFoundationLedger(
    {
      fs: dependencies.fs,
      nonce,
      residue: dependencies.residue,
      effectiveUid: dependencies.effectiveUid,
      coordinatorParticipantIds: participantIds,
    },
    roots,
  );

  await scanEffectRoot(scan, "git", nonce);
  await scanEffectRoot(scan, "launchd", nonce);
  await scanLifecycleStaging(scan, nonce);

  const records = await resolveCoordinators(scan, foundation);
  admitEffectCursors(scan, records);

  for (const [id, facts] of scan.staging) {
    const coordinator = scan.coordinators.get(id);
    if (coordinator !== undefined && (coordinator.planEntry !== null || coordinator.journalEntry !== null)) {
      continue;
    }
    const applied = [...facts.participantIds].filter((participant) =>
      foundation.journals.has(participant),
    );
    if (applied.length === 0) {
      scan.orphans.push({ kind: "planless_staging", path: facts.entry.path });
      continue;
    }
    for (const participant of applied) {
      refuse(
        scan,
        "lifecycle_staging_participant_journal",
        leafPath(roots.foundationJournals, `${participant}${JOURNAL_SUFFIX}`),
      );
    }
  }

  const nonTerminalCoordinators = new Set<string>();
  for (const record of nonTerminalRecords(records)) {
    for (const ref of record.plan.participants.foundation) nonTerminalCoordinators.add(ref.id);
  }
  const standaloneTerminalFoundation: FoundationTerminalCompactionV1[] = [];
  const standaloneNonTerminalFoundation: {
    readonly id: FoundationTransactionIdV1;
    readonly phase: TransactionPhase;
  }[] = [];
  for (const [id, held] of foundation.journals) {
    if (nonTerminalCoordinators.has(id)) continue;
    if (TERMINAL_FOUNDATION_PHASES.includes(held.journal.phase)) {
      standaloneTerminalFoundation.push({
        transactionId: id,
        terminalPhase: held.journal.phase === "rolled_back" ? "rolled_back" : "finalized",
        mutationCount: held.journal.mutations.length,
      });
      continue;
    }
    standaloneNonTerminalFoundation.push({ id, phase: held.journal.phase });
  }

  const closure = await classify(scan, records, foundation, standaloneNonTerminalFoundation.length);
  const findings = [...scan.findings, ...foundation.findings].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    return left.reason === right.reason ? 0 : left.reason < right.reason ? -1 : 1;
  });

  return {
    closure,
    allocator,
    foundation,
    coordinators: records,
    standaloneTerminalFoundation,
    standaloneNonTerminalFoundation,
    coordinatorOrphans: scan.orphans,
    findings,
    counts: { ...scan.counts },
  };
}
