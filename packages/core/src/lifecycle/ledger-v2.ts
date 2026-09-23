/**
 * Spec 2 §9.2's `LifecycleJournalClosureV2` inspector. Update coordinators and construction
 * envelopes are split out *before* the V1 scan, which then runs over the V1 set only (through
 * `ledger.ts`'s exclusion input), so V2 residue neither reads as a V1 finding nor lets V1
 * recovery compact an update's Foundation participants. The V2 half reads every schema-2 outer
 * plan under the shared 16-MiB cap, the construction envelope beside each update staging root,
 * and `state/update-executor.json`, then `classifyLifecycleJournalClosureV2` decides.
 *
 * It never mutates. Identity-bound content below the staging grammar's second level is the
 * resumed arm's check under the lock, not this read-only one.
 */
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import {
  constructionJournalBytes,
  constructionPlanHash,
  isPreHandoffConstructionPhase,
  MAXIMUM_CONSTRUCTION_PLAN_BYTES,
  updateConstructionEnvelopePaths,
  validateConstructionBijections,
  validateConstructionJournal,
  type UpdateConstructionClosureV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionPlanV1,
} from "../update/construction.js";
import {
  decodeUpdateRecoveryExecutorRecord,
  MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES,
  readLifecycleExecutionPlanV2,
  updateCoordinatorJournalBytes,
  updateCoordinatorPlanHash,
  updateCoordinatorStagingRoot,
  validateUpdateCoordinatorJournal,
  type UpdateLifecycleCoordinatorJournalV2,
  type UpdateLifecycleCoordinatorPlanV2,
} from "../update/coordinator.js";
import {
  deriveUpdateExecutorRecordPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
} from "../update/paths.js";
import { decodeCanonicalJson, encodeCanonicalJson } from "./canonical-json.js";
import type { LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import type { LifecycleGuardedEntryV1, LifecycleGuardedFileSystemV1 } from "./guarded-fs.js";
import { parseAllocatedLifecycleId, parseLifecycleCoordinatorId } from "./ids.js";
import {
  coordinatorLeafStem,
  inspectLifecycleLedger,
  type LifecycleLedgerDependenciesV1,
  type LifecycleLedgerSnapshotV1,
} from "./ledger.js";
import { classifyLifecycleJournalClosureV2, type LifecycleClosureV2ObservationV1 } from "./recovery.js";
import type { LifecycleCoordinatorPlanCoreV1, LifecycleJournalClosureV2 } from "./types.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

export type LifecycleLedgerV2DependenciesV1<TPlan extends CoordinatorPlan> = Omit<
  LifecycleLedgerDependenciesV1<TPlan>,
  "exclude"
> & {
  /** Decodes the executor record's absolute paths; supplied by the guarded filesystem adapter. */
  readonly evidence: CanonicalPathEvidenceV1;
};

export interface LifecycleLedgerV2SnapshotV1<TPlan> {
  /** The V1 ledger with every update coordinator, staging root, and Foundation participant excluded. */
  readonly snapshot: LifecycleLedgerSnapshotV1<TPlan>;
  readonly observation: LifecycleClosureV2ObservationV1;
  readonly closure: LifecycleJournalClosureV2;
}

const CONSTRUCTION_PREFIX = "update-construction.";
const PLAN_LEAF = "update-construction.plan.json";
const PLAN_PENDING_LEAF = "update-construction.plan.pending";
const JOURNAL_LEAF = "update-construction.journal.json";
const JOURNAL_PENDING_LEAF = "update-construction.journal.pending";
const JOURNAL_REWRITE_LEAF = "update-construction.journal.rewrite.pending";
const PENDING_LEAVES: readonly string[] = [PLAN_PENDING_LEAF, JOURNAL_PENDING_LEAF, JOURNAL_REWRITE_LEAF];
/**
 * §9.2's closed coordinator staging grammar, as amended 2026-09-23 (D60): the construction
 * envelope, then these two directories and exactly these children; no other child is legal.
 */
const STAGING_SUBTREES: ReadonlyMap<string, readonly string[]> = new Map([
  ["update", ["construction", "plans", "initial-journals", "journals", "evidence", "source", "payloads", "recovery-executor"]],
  ["participants", ["foundation", "manifest"]],
]);
const MAX_EXECUTOR_RECORD_BYTES = 16_384;

interface EnvelopeFactsV1 {
  plan: UpdateLifecycleCoordinatorPlanV2 | null;
  journal: UpdateLifecycleCoordinatorJournalV2 | null;
  /** Any envelope leaf of this ID beyond the outer plan: journal, lock, or rewrite temp. */
  readonly leaves: Set<string>;
  malformed: boolean;
}

interface StagingFactsV1 {
  readonly children: readonly string[];
  readonly foundationTransactionIds: readonly string[];
  readonly construction: UpdateConstructionClosureV1["construction"] | "handed_off" | null;
  readonly malformed: boolean;
}

interface ScanV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly roots: LifecycleLedgerRootsV1;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function at(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 | null {
  try {
    return parseCanonicalAbsolutePathText(`${directory}/${name}`);
  } catch {
    return null;
  }
}

function coordinatorIdOf(value: string): LifecycleCoordinatorIdV1 | null {
  try {
    return parseLifecycleCoordinatorId(value, null);
  } catch {
    return null;
  }
}

async function namesOf(scan: ScanV1, directory: LifecycleGuardedEntryV1): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const name of scan.fs.names(directory)) names.push(name);
  return names.sort();
}

async function ownedDirectory(scan: ScanV1, path: CanonicalAbsolutePathV1 | null): Promise<LifecycleGuardedEntryV1 | null> {
  if (path === null) return null;
  const entry = await scan.fs.lstat(path);
  if (entry?.kind !== "directory" || entry.ownerUid !== scan.effectiveUid || entry.mode !== 0o700) return null;
  return entry;
}

/** The exact bytes of an owner-only single-link `0600` leaf, or null for any other shape or read. */
async function ownedBytes(scan: ScanV1, path: CanonicalAbsolutePathV1 | null, maximumBytes: number): Promise<Uint8Array | null> {
  if (path === null) return null;
  const entry = await scan.fs.lstat(path);
  if (
    entry?.kind !== "regular_file" ||
    entry.ownerUid !== scan.effectiveUid ||
    entry.mode !== 0o600 ||
    entry.nlink !== 1 ||
    BigInt(entry.size) > BigInt(maximumBytes)
  ) {
    return null;
  }
  try {
    return await scan.fs.readRegular(entry, maximumBytes);
  } catch {
    return null;
  }
}

function canonicalValue(bytes: Uint8Array, maximumBytes: number): unknown {
  const value = decodeCanonicalJson(bytes, maximumBytes);
  if (encodeCanonicalJson(value) !== decoder.decode(bytes)) throw new Error("not canonical");
  return value;
}

/**
 * Every `<id>.plan.json` in the coordinator root, dispatched on its exact `schemaVersion`. A
 * schema-1 or unreadable plan stays with the V1 scan, whose own finding keeps closure non-clear.
 */
async function scanEnvelopes(scan: ScanV1): Promise<{
  readonly envelopes: Map<LifecycleCoordinatorIdV1, EnvelopeFactsV1>;
  /** Every coordinator ID with any leaf in the root, parsed or not. */
  readonly leafIds: ReadonlySet<string>;
}> {
  const envelopes = new Map<LifecycleCoordinatorIdV1, EnvelopeFactsV1>();
  const root = await ownedDirectory(scan, scan.roots.coordinatorJournals);
  if (root === null) return { envelopes, leafIds: new Set() };
  const names = await namesOf(scan, root);
  const leafIds = new Set(names.map(coordinatorLeafStem));
  for (const name of names) {
    const id = coordinatorIdOf(coordinatorLeafStem(name));
    if (id === null || name !== `${id}.plan.json`) continue;
    const bytes = await ownedBytes(scan, at(root.path, name), MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES);
    if (bytes === null) continue;
    let plan: UpdateLifecycleCoordinatorPlanV2;
    try {
      const dispatched = readLifecycleExecutionPlanV2(bytes, { v1: () => null, productHome: scan.roots.productHome });
      if (dispatched.schemaVersion !== 2) continue;
      plan = dispatched.plan;
    } catch {
      continue;
    }
    envelopes.set(id, { plan: plan.id === id ? plan : null, journal: null, leaves: new Set(), malformed: plan.id !== id });
  }
  for (const name of names) {
    const id = coordinatorIdOf(coordinatorLeafStem(name));
    if (id !== null && name !== `${id}.plan.json`) envelopes.get(id)?.leaves.add(name);
  }
  for (const [id, facts] of envelopes) await readEnvelopeJournal(scan, root, id, facts);
  return { envelopes, leafIds };
}

/** `UpdateCoordinatorJournalStore.read`'s rule: plan-bound, validated, and its own re-encoding. */
async function readEnvelopeJournal(
  scan: ScanV1,
  root: LifecycleGuardedEntryV1,
  id: LifecycleCoordinatorIdV1,
  facts: EnvelopeFactsV1,
): Promise<void> {
  const plan = facts.plan;
  if (plan === null || !facts.leaves.has(`${id}.json`)) return;
  const bytes = await ownedBytes(scan, at(root.path, `${id}.json`), plan.maximumJournalBytes);
  try {
    if (bytes === null) throw new Error("journal shape");
    const journal = validateUpdateCoordinatorJournal(
      decodeCanonicalJson(bytes, plan.maximumJournalBytes),
      plan,
      updateCoordinatorPlanHash(plan),
    );
    if (decoder.decode(updateCoordinatorJournalBytes(plan, journal)) !== decoder.decode(bytes)) throw new Error("journal bytes");
    facts.journal = journal;
  } catch {
    facts.malformed = true;
  }
}

/** A staging root is the update's when its outer plan is V2 or it holds construction or `update` state. */
async function scanStagingRoots(
  scan: ScanV1,
  envelopes: ReadonlyMap<LifecycleCoordinatorIdV1, EnvelopeFactsV1>,
): Promise<Map<LifecycleCoordinatorIdV1, StagingFactsV1>> {
  const stagings = new Map<LifecycleCoordinatorIdV1, StagingFactsV1>();
  const root = await ownedDirectory(scan, scan.roots.lifecycleStaging);
  if (root === null) return stagings;
  for (const name of await namesOf(scan, root)) {
    const id = coordinatorIdOf(name);
    const entry = id === null ? null : await ownedDirectory(scan, at(root.path, name));
    if (id === null || entry === null) continue;
    const children = await namesOf(scan, entry);
    const claimed = envelopes.has(id) || children.some((child) => child === "update" || child.startsWith(CONSTRUCTION_PREFIX));
    if (claimed) stagings.set(id, await inspectStaging(scan, id, entry, children));
  }
  return stagings;
}

async function inspectStaging(
  scan: ScanV1,
  id: LifecycleCoordinatorIdV1,
  entry: LifecycleGuardedEntryV1,
  children: readonly string[],
): Promise<StagingFactsV1> {
  const envelope = children.filter((child) => child.startsWith(CONSTRUCTION_PREFIX));
  const subtrees = children.filter((child) => !child.startsWith(CONSTRUCTION_PREFIX));
  const legalEnvelope = envelope.every((child) => child === PLAN_LEAF || child === JOURNAL_LEAF || PENDING_LEAVES.includes(child));
  let malformed = !legalEnvelope || envelope.filter((child) => PENDING_LEAVES.includes(child)).length > 1;
  const foundationTransactionIds: string[] = [];
  for (const subtree of subtrees) {
    const legal = STAGING_SUBTREES.get(subtree);
    const directory = legal === undefined ? null : await ownedDirectory(scan, at(entry.path, subtree));
    if (legal === undefined || directory === null) {
      malformed = true;
      continue;
    }
    for (const child of await namesOf(scan, directory)) {
      const nested = legal.includes(child) ? await ownedDirectory(scan, at(directory.path, child)) : null;
      if (nested === null) {
        malformed = true;
        continue;
      }
      if (subtree !== "participants" || child !== "foundation") continue;
      for (const transaction of await namesOf(scan, nested)) {
        try {
          foundationTransactionIds.push(parseAllocatedLifecycleId("tx", transaction, null));
        } catch {
          malformed = true;
        }
      }
    }
  }
  const construction = malformed ? null : await constructionFrontier(scan, id, entry, envelope, subtrees);
  return {
    children,
    foundationTransactionIds,
    construction: construction === "malformed" ? null : construction,
    malformed: malformed || construction === "malformed",
  };
}

/**
 * §9.2's four construction frontiers. `plan_pending` is the lone root temp and is never parsed;
 * `journal_bootstrap` is the complete plan with no journal yet (or its sole temp); `journal` is a
 * pre-handoff, compensating or rolled-back journal. A lone complete plan is also what
 * `plan_only_suffix` leaves, and `UpdateConstructionStore.recover` removes both the same way, so
 * that disk state is reported as `journal_bootstrap` with an absent journal.
 */
async function constructionFrontier(
  scan: ScanV1,
  id: LifecycleCoordinatorIdV1,
  entry: LifecycleGuardedEntryV1,
  envelope: readonly string[],
  subtrees: readonly string[],
): Promise<UpdateConstructionClosureV1["construction"] | "handed_off" | "malformed" | null> {
  if (envelope.length === 0) return null;
  const layout = envelope.join("/");
  if (layout === PLAN_PENDING_LEAF) return subtrees.length === 0 ? { frontier: "plan_pending" } : "malformed";
  const paths = updateConstructionEnvelopePaths(entry.path);
  const plan = await readConstructionPlan(scan, id, paths.plan);
  if (plan === null) return "malformed";
  const identity = { operation: plan.operation, constructionPlanHash: constructionPlanHash(plan) };
  if (layout === PLAN_LEAF || layout === [JOURNAL_PENDING_LEAF, PLAN_LEAF].join("/")) {
    if (subtrees.length !== 0) return "malformed";
    return { frontier: "journal_bootstrap", journal: layout === PLAN_LEAF ? "absent" : "pending", ...identity };
  }
  if (layout !== [JOURNAL_LEAF, PLAN_LEAF].join("/") && layout !== [JOURNAL_LEAF, JOURNAL_REWRITE_LEAF, PLAN_LEAF].join("/")) {
    return "malformed";
  }
  const journal = await readConstructionJournal(scan, plan, paths.journal);
  if (journal === null) return "malformed";
  if (isPreHandoffConstructionPhase(journal.phase) || journal.phase === "compensating" || journal.phase === "rolled_back") {
    return { frontier: "journal", ...identity };
  }
  return "handed_off";
}

async function readConstructionPlan(
  scan: ScanV1,
  id: LifecycleCoordinatorIdV1,
  path: CanonicalAbsolutePathV1,
): Promise<UpdateConstructionPlanV1 | null> {
  const bytes = await ownedBytes(scan, path, MAXIMUM_CONSTRUCTION_PLAN_BYTES);
  if (bytes === null) return null;
  try {
    const plan = canonicalValue(bytes, MAXIMUM_CONSTRUCTION_PLAN_BYTES) as UpdateConstructionPlanV1;
    validateConstructionBijections(plan);
    const root = updateCoordinatorStagingRoot(scan.roots.productHome, id);
    return plan.coordinatorId === id && plan.stagingRoot.path === root ? plan : null;
  } catch {
    return null;
  }
}

async function readConstructionJournal(
  scan: ScanV1,
  plan: UpdateConstructionPlanV1,
  path: CanonicalAbsolutePathV1,
): Promise<UpdateConstructionJournalV1 | null> {
  const bytes = await ownedBytes(scan, path, plan.maximumJournalBytes);
  if (bytes === null) return null;
  try {
    const journal = validateConstructionJournal(canonicalValue(bytes, plan.maximumJournalBytes), plan);
    return decoder.decode(constructionJournalBytes(journal)) === decoder.decode(bytes) ? journal : null;
  } catch {
    return null;
  }
}

async function readExecutorRecord(
  scan: ScanV1,
  evidence: CanonicalPathEvidenceV1,
): Promise<LifecycleClosureV2ObservationV1["executorRecord"] | "malformed"> {
  const path = deriveUpdateExecutorRecordPath(scan.roots.productHome);
  if ((await scan.fs.lstat(path)) === null) return null;
  const bytes = await ownedBytes(scan, path, MAX_EXECUTOR_RECORD_BYTES);
  if (bytes === null) return "malformed";
  try {
    const record = decodeUpdateRecoveryExecutorRecord(bytes, evidence);
    return { state: record.state, coordinatorId: record.coordinatorId };
  } catch {
    return "malformed";
  }
}

/**
 * One ID's arm. A pre-handoff construction journal owns any outer leaves it recorded, so it
 * outranks the outer envelope; a complete outer journal is the coordinator; an outer plan with
 * no journal and no staging root is the envelope suffix, which records no direction and resumes
 * forward through compaction. Everything else is malformed.
 */
function resolveUpdate(
  id: LifecycleCoordinatorIdV1,
  envelope: EnvelopeFactsV1 | undefined,
  staging: StagingFactsV1 | undefined,
  outerPresent: boolean,
): LifecycleClosureV2ObservationV1["updateCoordinators"][number] | UpdateConstructionClosureV1 | "malformed" {
  if (staging?.malformed === true) return "malformed";
  const construction = staging?.construction ?? null;
  if (construction !== null && construction !== "handed_off") {
    // Only the `journal` frontier can have reached the outer intents that write these leaves.
    if (construction.frontier !== "journal" && outerPresent) return "malformed";
    return { coordinatorId: id, construction };
  }
  if (envelope === undefined || envelope.malformed || envelope.plan === null) return "malformed";
  const extra = [...envelope.leaves].filter((leaf) => leaf !== `${id}.json` && leaf !== `.${id}.lock`);
  if (envelope.journal !== null) {
    if (extra.length > 1) return "malformed";
    return { id, operation: envelope.plan.operation, direction: envelope.journal.direction };
  }
  if (staging !== undefined || envelope.leaves.has(`${id}.json`) || extra.length > 0) return "malformed";
  return { id, operation: envelope.plan.operation, direction: "forward" };
}

export async function inspectLifecycleLedgerV2<TPlan extends CoordinatorPlan>(
  dependencies: LifecycleLedgerV2DependenciesV1<TPlan>,
  roots: LifecycleLedgerRootsV1,
): Promise<LifecycleLedgerV2SnapshotV1<TPlan>> {
  const scan: ScanV1 = { fs: dependencies.fs, effectiveUid: dependencies.effectiveUid, roots };
  const { envelopes, leafIds } = await scanEnvelopes(scan);
  const stagings = await scanStagingRoots(scan, envelopes);
  const ids = [...new Set([...envelopes.keys(), ...stagings.keys()])].sort();

  const foundationTransactionIds = new Set<string>();
  for (const staging of stagings.values()) {
    for (const transaction of staging.foundationTransactionIds) foundationTransactionIds.add(transaction);
  }
  const { evidence, ...ledger } = dependencies;
  const snapshot = await inspectLifecycleLedger(
    { ...ledger, exclude: { coordinatorIds: new Set(ids), foundationTransactionIds } },
    roots,
  );

  let malformed = false;
  const updateCoordinators: LifecycleClosureV2ObservationV1["updateCoordinators"][number][] = [];
  const constructions: UpdateConstructionClosureV1[] = [];
  for (const id of ids) {
    const resolved = resolveUpdate(id, envelopes.get(id), stagings.get(id), leafIds.has(id));
    if (resolved === "malformed") malformed = true;
    else if ("construction" in resolved) constructions.push(resolved);
    else updateCoordinators.push(resolved);
  }
  const executorRecord = await readExecutorRecord(scan, evidence);
  const observation: LifecycleClosureV2ObservationV1 = {
    v1: snapshot.closure,
    malformed: malformed || executorRecord === "malformed",
    updateCoordinators,
    constructions,
    executorRecord: executorRecord === "malformed" ? null : executorRecord,
  };
  return { snapshot, observation, closure: classifyLifecycleJournalClosureV2(observation) };
}
