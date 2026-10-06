/**
 * Spec 1 §2.4's feasibility proof and coordinator publication. Every
 * `maximumJournalBytes` is derived here, never chosen by a caller: planning
 * computes conservative maxima over the widest legal IDs before it reserves an
 * ID block, and `publish` recomputes the exact coordinator maximum from the
 * real IDs and refuses a plan whose field disagrees.
 *
 * The store never allocates. Callers reserve their block with Task 10 only
 * after `assertLifecycleExecutionFeasible` passes, so an infeasible operation
 * consumes no counter.
 */
import { EXIT_CODES } from "../result.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type {
  FileMutation,
  TransactionLockProvider,
  TransactionPhase,
} from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseSafeReasonCode,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type UtcTimestampV1,
} from "../update/scalars.js";
import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import type { LifecycleValueCodec } from "./codecs.js";
import type { LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import { deriveTerminalCompaction, lifecycleReservationOrder } from "./grammar.js";
import {
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import {
  LIFECYCLE_LEDGER_BOUNDS,
  UINT64_MAX,
  type LifecycleIdPrefixV1,
} from "./ids.js";
import type { LifecycleLedgerSnapshotV1 } from "./ledger.js";
import { LifecycleLockShapeError, type HeldLifecycleStableLockV1 } from "./locks.js";
import {
  LIFECYCLE_COORDINATOR_PHASES,
  LIFECYCLE_HASH_DOMAINS,
  LIFECYCLE_TERMINAL_OUTCOMES,
  LIFECYCLE_PLAN_BOUNDS,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
} from "./types.js";
import { LOWERCASE_V4_UUID } from "./fs-helpers.js";

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

const MAX_PLAN_BYTES = LIFECYCLE_PLAN_BOUNDS.planBytes.maximum;
const MAX_JOURNAL_BYTES = LIFECYCLE_PLAN_BOUNDS.journalBytes.maximum;
const LOCK_LEAF = ".lifecycle.lock";
const PLAN_SUFFIX = ".plan.json";
const JOURNAL_SUFFIX = ".json";
/** One coordinator, every Foundation ref, both Git and both launchd effects, and the manifest. */
const MAX_RESERVATION_SLOTS = 1 + LIFECYCLE_PLAN_BOUNDS.foundationRefs.maximum + 4 + 1;


/** A placeholder of the exact width `LowerHexSha256` fixes, for the conservative arms. */
const WIDEST_HASH = "f".repeat(64) as LowerHexSha256;
const WIDEST_TIMESTAMP = "2026-09-19T00:00:00.000Z" as UtcTimestampV1;

const FOUNDATION_PHASES: readonly TransactionPhase[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "finalized",
  "rolled_back",
];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface LifecycleLeafReservationV1 {
  readonly foundationJournals: number;
  readonly coordinatorJournals: number;
  readonly gitEffectJournals: number;
  readonly launchdEffectJournals: number;
  readonly foundationStaging: number;
  readonly foundationBackups: number;
  readonly lifecycleStaging: number;
}

/**
 * §2.4's pre-reservation refusals are capacity verdicts, not recovery states:
 * nothing is durable when one fires, so D26's `uninstall_artifact_capacity_exceeded`
 * exit sets the class for every "this installation cannot carry that work" answer.
 */
export class LifecycleInfeasiblePlanError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;
  readonly reason: SafeReasonCodeV1;

  constructor(reason: string, detail: string) {
    super(`lifecycle plan is infeasible: ${reason} (${detail.slice(0, 64)})`);
    this.name = "LifecycleInfeasiblePlanError";
    this.reason = parseSafeReasonCode(reason);
  }
}

function refuseInfeasible(reason: string, detail: string): never {
  throw new LifecycleInfeasiblePlanError(reason, detail);
}

export function longestLegalAllocatedId(prefix: LifecycleIdPrefixV1): string {
  return `${prefix}_${"f".repeat(64)}_${UINT64_MAX.toString(10)}`;
}

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function maximumFoundationJournalBytes(input: {
  readonly id: string;
  readonly kind: string;
  readonly mutations: readonly FileMutation[];
}): number {
  return Math.max(
    ...FOUNDATION_PHASES.map((phase) =>
      byteLength(
        encodeFoundationJournalJsonV1({
          schemaVersion: 1,
          id: input.id,
          kind: input.kind,
          phase,
          createdAt: WIDEST_TIMESTAMP,
          updatedAt: WIDEST_TIMESTAMP,
          mutations: input.mutations,
        }),
      ),
    ),
  );
}

export function maximumCoordinatorJournalBytes(plan: CoordinatorPlan): number {
  const steps = plan.steps.length;
  const entries = deriveTerminalCompaction(plan, "rolled_back").entries.length;
  const pushPlanHash = plan.push === null ? null : WIDEST_HASH;
  let widest = 0;
  for (const phase of LIFECYCLE_COORDINATOR_PHASES) {
    const compacting = phase === "compacting";
    const compensating = phase === "compensating" || phase === "rolled_back";
    for (const compensationNext of compensating ? [-1, Math.max(0, steps - 1)] : [null]) {
      for (const compactionNext of compacting ? [0, entries] : [null]) {
        for (const terminalOutcome of compacting
          ? LIFECYCLE_TERMINAL_OUTCOMES
          : ([null] as const)) {
          const journal: LifecycleCoordinatorJournalV1 = {
            schemaVersion: 1,
            id: plan.id,
            operation: plan.operation,
            phase,
            planHash: WIDEST_HASH,
            pushPlanHash,
            nextStep: steps,
            compensationNext,
            compactionNext,
            terminalOutcome,
            createdAt: WIDEST_TIMESTAMP,
            updatedAt: WIDEST_TIMESTAMP,
          };
          widest = Math.max(
            widest,
            byteLength(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)),
          );
        }
      }
    }
  }
  return widest;
}

export function standaloneFoundationLeafReservation(
  mutations: readonly { readonly operation: "create" | "replace" | "remove" }[],
): LifecycleLeafReservationV1 {
  const staged = mutations.filter((mutation) => mutation.operation !== "remove").length;
  const backed = mutations.filter((mutation) => mutation.operation !== "create").length;
  return {
    foundationJournals: 3,
    coordinatorJournals: 0,
    gitEffectJournals: 0,
    launchdEffectJournals: 0,
    foundationStaging: 1 + 3 * staged,
    foundationBackups: 1 + 5 * backed,
    lifecycleStaging: 0,
  };
}

export function assertLifecycleCapacity(
  snapshot: LifecycleLedgerSnapshotV1<unknown>,
  reservation: LifecycleLeafReservationV1,
): void {
  const bounds = LIFECYCLE_LEDGER_BOUNDS;
  const checks: readonly (readonly [string, number, number])[] = [
    [
      "foundationJournals",
      snapshot.foundation.counts.journalRoot + reservation.foundationJournals,
      bounds.journalLeavesPerRoot,
    ],
    [
      "coordinatorJournals",
      snapshot.counts.coordinatorJournals + reservation.coordinatorJournals,
      bounds.journalLeavesPerRoot,
    ],
    [
      "gitEffectJournals",
      snapshot.counts.gitEffectJournals + reservation.gitEffectJournals,
      bounds.journalLeavesPerRoot,
    ],
    [
      "launchdEffectJournals",
      snapshot.counts.launchdEffectJournals + reservation.launchdEffectJournals,
      bounds.journalLeavesPerRoot,
    ],
    [
      "foundationStaging",
      snapshot.foundation.counts.staging + reservation.foundationStaging,
      bounds.foundationStagingAggregateLeaves,
    ],
    [
      "foundationBackups",
      snapshot.foundation.counts.backups + reservation.foundationBackups,
      bounds.foundationBackupAggregateLeaves,
    ],
    [
      "lifecycleStaging",
      snapshot.counts.lifecycleStagingAggregate + reservation.lifecycleStaging,
      bounds.lifecycleStagingAggregateLeaves,
    ],
    [
      "lifecycleStagingPerCoordinator",
      reservation.lifecycleStaging,
      bounds.lifecycleStagingPerCoordinatorLeaves,
    ],
  ];
  for (const [root, projected, cap] of checks) {
    if (projected > cap) refuseInfeasible("ledger_capacity_exceeded", root);
  }
}

export interface LifecycleExecutionBuilderV1<TPlan> {
  readonly slotCount: number;
  build(ids: readonly string[]): {
    readonly plan: TPlan;
    readonly reservation: LifecycleLeafReservationV1;
  };
}

/**
 * The prefix sequence of a reservation block is only knowable from the plan the
 * builder is about to build, so the conservative pass cannot supply one: it
 * hands `build` distinct placeholder IDs of the widest legal width and expects
 * them bound by position. The conservative plan is measured, never validated or
 * published; the real plan is validated by the codec at `publish`.
 */
function conservativeIds(slotCount: number): readonly string[] {
  if (!Number.isSafeInteger(slotCount) || slotCount < 1 || slotCount > MAX_RESERVATION_SLOTS) {
    refuseInfeasible("reservation_slot_count", String(slotCount));
  }
  const widest = longestLegalAllocatedId("tx");
  const stem = widest.slice(0, widest.lastIndexOf("_") + 1);
  return Array.from(
    { length: slotCount },
    (_, index) => `${stem}${(UINT64_MAX - BigInt(index)).toString(10)}`,
  );
}

export function assertLifecycleExecutionFeasible<TPlan extends CoordinatorPlan>(
  builder: LifecycleExecutionBuilderV1<TPlan>,
  snapshot: LifecycleLedgerSnapshotV1<TPlan>,
  codec: LifecycleValueCodec<TPlan>,
): void {
  const built = builder.build(conservativeIds(builder.slotCount));
  const order = lifecycleReservationOrder(built.plan);
  if (order.length !== builder.slotCount) {
    refuseInfeasible("reservation_slot_count", order.length.toString(10));
  }
  if (byteLength(codec.encode(built.plan)) > MAX_PLAN_BYTES) {
    refuseInfeasible("plan_too_large", built.plan.id);
  }
  requireJournalMaximum(maximumCoordinatorJournalBytes(built.plan), built.plan.id);
  for (const ref of built.plan.participants.foundation) {
    requireJournalMaximum(ref.maximumJournalBytes, ref.id);
  }
  assertLifecycleCapacity(snapshot, built.reservation);
}

function requireJournalMaximum(maximum: number, detail: string): void {
  if (maximum < LIFECYCLE_PLAN_BOUNDS.journalBytes.minimum || maximum > MAX_JOURNAL_BYTES) {
    refuseInfeasible("journal_too_large", detail);
  }
}

export type LifecycleStoreBoundaryV1 =
  | "staging_directory_created"
  | "plan_temp_written"
  | "plan_published"
  | "plan_parent_synced"
  | "coordinator_lock_created"
  | "journal_temp_written"
  | "journal_published"
  | "journal_parent_synced"
  | "rewrite_temp_written"
  | "rewrite_renamed";

export interface LifecycleCoordinatorStoreDependenciesV1<TPlan> {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly executionPlanCodec: LifecycleValueCodec<TPlan>;
  readonly coordinatorJournalCodec: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
  readonly uuid: () => string;
  readonly clock: () => UtcTimestampV1;
  readonly locks: TransactionLockProvider;
  readonly afterBoundary?: (boundary: LifecycleStoreBoundaryV1) => void | Promise<void>;
}

function leafPath(directory: CanonicalAbsolutePathV1, leaf: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${directory}/${leaf}`);
}

export class LifecycleCoordinatorStore<TPlan extends CoordinatorPlan> {
  private readonly dependencies: LifecycleCoordinatorStoreDependenciesV1<TPlan>;

  constructor(dependencies: LifecycleCoordinatorStoreDependenciesV1<TPlan>) {
    this.dependencies = dependencies;
  }

  async ensureStagingDirectory(
    id: LifecycleCoordinatorIdV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<LifecycleGuardedEntryV1> {
    this.requireGlobalLock(global);
    const { roots } = this.dependencies;
    await this.ensureDirectory(roots.lifecycleStaging, leafPath(roots.productHome, "staging"));
    const entry = await this.ensureDirectory(
      leafPath(roots.lifecycleStaging, id),
      roots.lifecycleStaging,
    );
    await this.boundary("staging_directory_created");
    return entry;
  }

  async publish(plan: TPlan, global: HeldLifecycleStableLockV1): Promise<LifecycleCoordinatorJournalV1> {
    this.requireGlobalLock(global);
    const exact = maximumCoordinatorJournalBytes(plan);
    if (plan.maximumJournalBytes !== exact) {
      refuseInfeasible("coordinator_journal_maximum", exact.toString(10));
    }
    const planText = this.dependencies.executionPlanCodec.encode(plan);
    const planBytes = encoder.encode(planText);
    if (planBytes.byteLength > MAX_PLAN_BYTES) refuseInfeasible("plan_too_large", plan.id);

    const root = await this.coordinatorRoot();
    const planPath = leafPath(root.path, `${plan.id}${PLAN_SUFFIX}`);
    const journalPath = leafPath(root.path, `${plan.id}${JOURNAL_SUFFIX}`);
    const { fs } = this.dependencies;
    if ((await fs.lstat(planPath)) !== null) {
      refuseLifecycleRecovery("lifecycle_coordinator_plan_exists", planPath);
    }
    if ((await fs.lstat(journalPath)) !== null) {
      refuseLifecycleRecovery("lifecycle_coordinator_journal_exists", journalPath);
    }

    const planTemp = await fs.writeExclusive(this.tempPath(root, plan.id, PLAN_SUFFIX), planBytes);
    await this.boundary("plan_temp_written");
    await fs.renameNoReplace(planTemp, planPath);
    await this.boundary("plan_published");
    await fs.syncDirectory(root);
    await this.boundary("plan_parent_synced");

    const held = await this.dependencies.locks.acquire(leafPath(root.path, `.${plan.id}.lock`));
    await this.boundary("coordinator_lock_created");
    try {
      const createdAt = this.dependencies.clock();
      const journal: LifecycleCoordinatorJournalV1 = {
        schemaVersion: 1,
        id: plan.id,
        operation: plan.operation,
        phase: "planned",
        planHash: hashCanonicalJson(
          LIFECYCLE_HASH_DOMAINS.coordinatorPlan,
          decodeCanonicalJson(planBytes, MAX_PLAN_BYTES),
        ),
        pushPlanHash: pushPlanHashOf(plan),
        nextStep: 0,
        compensationNext: null,
        compactionNext: null,
        terminalOutcome: null,
        createdAt,
        updatedAt: createdAt,
      };
      const journalBytes = this.encodeJournal(journal, plan);
      const journalTemp = await fs.writeExclusive(
        this.tempPath(root, plan.id, JOURNAL_SUFFIX),
        journalBytes,
      );
      await this.boundary("journal_temp_written");
      await fs.renameNoReplace(journalTemp, journalPath);
      await this.boundary("journal_published");
      await fs.syncDirectory(root);
      await this.boundary("journal_parent_synced");
      return journal;
    } finally {
      await held.release();
    }
  }

  async read(id: LifecycleCoordinatorIdV1): Promise<{
    readonly plan: TPlan;
    readonly journal: LifecycleCoordinatorJournalV1 | null;
  }> {
    const root = await this.coordinatorRoot();
    const planPath = leafPath(root.path, `${id}${PLAN_SUFFIX}`);
    const planEntry = await this.guardedLeaf(planPath, MAX_PLAN_BYTES, "lifecycle_coordinator_plan_shape");
    const planText = decoder.decode(await this.dependencies.fs.readRegular(planEntry, MAX_PLAN_BYTES));
    const plan = this.dependencies.executionPlanCodec.validate(
      decodeCanonicalJson(encoder.encode(planText), MAX_PLAN_BYTES),
    );
    if (this.dependencies.executionPlanCodec.encode(plan) !== planText || plan.id !== id) {
      refuseLifecycleRecovery("lifecycle_coordinator_plan_bytes", planPath);
    }

    const journalPath = leafPath(root.path, `${id}${JOURNAL_SUFFIX}`);
    if ((await this.dependencies.fs.lstat(journalPath)) === null) return { plan, journal: null };
    const journalEntry = await this.guardedLeaf(
      journalPath,
      plan.maximumJournalBytes,
      "lifecycle_coordinator_journal_shape",
    );
    const journalText = decoder.decode(
      await this.dependencies.fs.readRegular(journalEntry, plan.maximumJournalBytes),
    );
    const journal = this.dependencies.coordinatorJournalCodec.validate(
      decodeCanonicalJson(encoder.encode(journalText), plan.maximumJournalBytes),
    );
    if (
      this.dependencies.coordinatorJournalCodec.encode(journal) !== journalText ||
      journal.id !== id
    ) {
      refuseLifecycleRecovery("lifecycle_coordinator_journal_bytes", journalPath);
    }
    return { plan, journal };
  }

  async rewriteJournal(
    plan: TPlan,
    current: LifecycleCoordinatorJournalV1,
    next: LifecycleCoordinatorJournalV1,
    global: HeldLifecycleStableLockV1,
  ): Promise<void> {
    this.requireGlobalLock(global);
    if (current.id !== plan.id || next.id !== plan.id) {
      refuseLifecycleRecovery(
        "lifecycle_coordinator_journal_identity",
        leafPath(this.dependencies.roots.coordinatorJournals, `${plan.id}${JOURNAL_SUFFIX}`),
      );
    }
    const nextBytes = this.encodeJournal(next, plan);

    const root = await this.coordinatorRoot();
    const journalPath = leafPath(root.path, `${plan.id}${JOURNAL_SUFFIX}`);
    const journalEntry = await this.guardedLeaf(
      journalPath,
      plan.maximumJournalBytes,
      "lifecycle_coordinator_journal_shape",
    );
    const onDisk = decoder.decode(
      await this.dependencies.fs.readRegular(journalEntry, plan.maximumJournalBytes),
    );
    if (onDisk !== this.dependencies.coordinatorJournalCodec.encode(current)) {
      refuseLifecycleRecovery("lifecycle_coordinator_journal_stale", journalPath);
    }

    const temp = await this.dependencies.fs.writeExclusive(
      this.tempPath(root, plan.id, JOURNAL_SUFFIX),
      nextBytes,
    );
    await this.boundary("rewrite_temp_written");
    await this.dependencies.fs.renameOver(temp, journalEntry);
    await this.boundary("rewrite_renamed");
    await this.dependencies.fs.syncDirectory(root);
  }

  private encodeJournal(journal: LifecycleCoordinatorJournalV1, plan: TPlan): Uint8Array {
    const bytes = encoder.encode(this.dependencies.coordinatorJournalCodec.encode(journal));
    if (bytes.byteLength > plan.maximumJournalBytes || bytes.byteLength > MAX_JOURNAL_BYTES) {
      refuseInfeasible("journal_too_large", bytes.byteLength.toString(10));
    }
    return bytes;
  }

  private tempPath(
    root: LifecycleGuardedEntryV1,
    id: LifecycleCoordinatorIdV1,
    suffix: string,
  ): CanonicalAbsolutePathV1 {
    const uuid = this.dependencies.uuid();
    if (!LOWERCASE_V4_UUID.test(uuid)) throw new Error("invalid lifecycle temporary uuid");
    return leafPath(root.path, `.${id}.${uuid}${suffix}.tmp`);
  }

  private async boundary(reached: LifecycleStoreBoundaryV1): Promise<void> {
    await this.dependencies.afterBoundary?.(reached);
  }

  private requireGlobalLock(global: HeldLifecycleStableLockV1): void {
    if (global.path !== leafPath(this.dependencies.roots.stateDirectory, LOCK_LEAF)) {
      throw new LifecycleLockShapeError(global.path);
    }
  }

  private async coordinatorRoot(): Promise<LifecycleGuardedEntryV1> {
    return this.requireOwnedDirectory(
      this.dependencies.roots.coordinatorJournals,
      "lifecycle_ledger_root_shape",
    );
  }

  private async requireOwnedDirectory(
    path: CanonicalAbsolutePathV1,
    reason: string,
  ): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.dependencies.fs.lstat(path);
    if (entry === null || entry.kind !== "directory" || entry.mode !== 0o700) {
      refuseLifecycleRecovery(reason, path);
    }
    return entry;
  }

  private async ensureDirectory(
    path: CanonicalAbsolutePathV1,
    parent: CanonicalAbsolutePathV1,
  ): Promise<LifecycleGuardedEntryV1> {
    const existing = await this.dependencies.fs.lstat(path);
    if (existing !== null) return this.requireOwnedDirectory(path, "lifecycle_staging_shape");
    const created = await this.dependencies.fs.mkdirExclusive(path);
    await this.dependencies.fs.syncDirectory(
      await this.requireOwnedDirectory(parent, "lifecycle_staging_shape"),
    );
    return created;
  }

  private async guardedLeaf(
    path: CanonicalAbsolutePathV1,
    maximumBytes: number,
    reason: string,
  ): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.dependencies.fs.lstat(path);
    if (
      entry === null ||
      entry.kind !== "regular_file" ||
      entry.mode !== 0o600 ||
      entry.nlink !== 1 ||
      BigInt(entry.size) > BigInt(maximumBytes)
    ) {
      refuseLifecycleRecovery(reason, path);
    }
    return entry;
  }
}

/**
 * The plan codec binds every push step to the plan's own push arm, so the
 * journal's hash is the one those steps carry and the store needs no second
 * accessor for a leaf it cannot decode.
 */
function pushPlanHashOf(plan: CoordinatorPlan): LowerHexSha256 | null {
  for (const step of plan.steps) {
    if (step.kind === "network_push" || step.kind === "destination_git_effect") {
      return step.pushPlanHash;
    }
  }
  return null;
}
