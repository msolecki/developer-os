/**
 * Spec 1 §2.4's journaled Git effect: the one executor with authority over a
 * repository's `.git` internals. It reads its immutable plan from the Git
 * effect root by ID, refuses a plan whose hash is not the coordinator's, and
 * moves every transition through the closed forward and reverse microstates
 * with no-replace renames only. A leaf is the plan's postimage because its
 * staged `dev`/`ino` says so, never because its bytes match; anything else is
 * a preserved third state and exit 6.
 */
import type { LifecycleEffectAdapterV1, LifecycleEffectStateV1 } from "../lifecycle/coordinator.js";
import { decodeCanonicalJson } from "../lifecycle/canonical-json.js";
import {
  lifecycleParentPath,
  refuseLifecycleRecovery,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "../lifecycle/guarded-fs.js";
import { LIFECYCLE_PLAN_BOUNDS, type LifecycleEffectRefV1 } from "../lifecycle/types.js";
import type { TransactionLockHandle, TransactionLockProvider } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { UtcTimestampV1 } from "../update/scalars.js";
import {
  assertGitEffectJournalForPlan,
  createGitEffectLedgerCodec,
  gitEffectForwardObservation,
  gitEffectPlanHash,
  relinquishedObjectObservation,
  relinquishedTreeObservation,
  validateGitEffectJournal,
  validateGitEffectPlan,
  type GitEffectJournalV1,
  type GitEffectObservationV1,
  type GitEffectPhaseV1,
  type GitEffectPlanV1,
} from "./effect-journal.js";
import type { GitEffectTransitionRoleV1, GitEffectTransitionV1 } from "./planner.js";
import { GIT_SCOPE_BOUNDS } from "./scope.js";
import {
  GIT_TREE_FINGERPRINT_MAX_ENTRIES,
  compareUnsignedUtf8,
  gitTreeFingerprintHash,
  parseGitTreeRelativePath,
  validateGitTreeFingerprint,
  type GitTreeFingerprintEntryV1,
  type GuardedGitPathStateV1,
} from "./types.js";

/**
 * The guarded port plus the one primitive `.git` needs that the lifecycle
 * port refuses: its `renameNoReplace` admits only owner-only parents and
 * regular files, while a Git publication crosses from the 0700 quarantine into
 * a 0755 repository and publishes a whole `.git` directory on enable.
 */
export interface GitEffectFileSystemV1 extends LifecycleGuardedFileSystemV1 {
  /**
   * Atomic no-replace rename of the exact reopened `source` (a regular file or
   * a directory) to `destinationPath` on the same device. `"exists"` means the
   * destination was present and nothing moved; it never replaces.
   */
  renameGitNoReplace(
    source: LifecycleGuardedEntryV1,
    destinationPath: CanonicalAbsolutePathV1,
  ): Promise<"renamed" | "exists">;
}

export type GitEffectMoveV1 = "stage_to_final" | "final_to_before" | "final_to_after" | "before_to_final";

export type GitEffectBoundaryV1 =
  | {
      readonly kind: "journal_written";
      readonly phase: GitEffectPhaseV1;
      readonly nextTransition: number;
      readonly compensationNext: number | null;
    }
  | {
      readonly kind: "renamed";
      readonly transitionIndex: number;
      readonly role: GitEffectTransitionRoleV1;
      readonly move: GitEffectMoveV1;
    }
  | { readonly kind: "evidence_removed"; readonly path: CanonicalAbsolutePathV1 };

export interface GitEffectDependenciesV1 {
  readonly fs: GitEffectFileSystemV1;
  /** Exact `<product home>/state/git-effect-journals`. */
  readonly journalRoot: CanonicalAbsolutePathV1;
  readonly effectiveUid: number;
  readonly locks: TransactionLockProvider;
  readonly clock: () => UtcTimestampV1;
  readonly uuid: () => string;
  readonly afterBoundary?: (boundary: GitEffectBoundaryV1) => void | Promise<void>;
}

interface SessionV1 {
  readonly plan: GitEffectPlanV1;
  journal: GitEffectJournalV1 | null;
  /** The journal leaf this session last read or wrote; a rewrite requires it unchanged. */
  journalEntry: LifecycleGuardedEntryV1 | null;
}

const MAX_PLAN_BYTES = LIFECYCLE_PLAN_BOUNDS.planBytes.maximum;
const LOWERCASE_V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_TREE_DEPTH = 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const EFFECT_STATES: Readonly<Record<GitEffectPhaseV1, LifecycleEffectStateV1>> = {
  planned: "planned",
  backed_up: "planned",
  staged: "planned",
  validated: "planned",
  applied: "applied",
  verified: "verified",
  compensating: "compensating",
  finalized: "finalized",
  rolled_back: "rolled_back",
};

function child(parent: CanonicalAbsolutePathV1, leaf: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${parent}/${leaf}`);
}

/** A regular or tree state's recorded identity, which a rename carries unchanged. */
function holds(entry: LifecycleGuardedEntryV1 | null, state: GuardedGitPathStateV1 | null): boolean {
  if (entry === null || state === null || state.state === "absent") return false;
  if (state.state === "regular_file") {
    return (
      entry.kind === "regular_file" &&
      entry.dev === state.dev &&
      entry.ino === state.ino &&
      entry.mode === state.mode &&
      entry.size === state.size.toString(10)
    );
  }
  return (
    entry.kind === "directory" &&
    entry.dev === state.dev &&
    entry.ino === state.ino &&
    entry.ownerUid === state.ownerUid &&
    entry.mode === state.mode
  );
}

function stagedOf(transition: GitEffectTransitionV1): {
  readonly path: CanonicalAbsolutePathV1;
  readonly state: GuardedGitPathStateV1;
} {
  const { stagedPostimagePath, stagedPostimage } = transition.evidence;
  if (stagedPostimagePath === null || stagedPostimage === null) {
    refuseLifecycleRecovery("git_effect_evidence", transition.path);
  }
  return { path: stagedPostimagePath, state: stagedPostimage };
}

function tombstoneOf(transition: GitEffectTransitionV1, which: "before" | "after"): CanonicalAbsolutePathV1 {
  const path = which === "before" ? transition.evidence.beforeTombstonePath : transition.evidence.afterTombstonePath;
  if (path === null) refuseLifecycleRecovery("git_effect_evidence", transition.path);
  return path;
}

export class GitEffectExecutor implements LifecycleEffectAdapterV1 {
  readonly #dependencies: GitEffectDependenciesV1;

  constructor(dependencies: GitEffectDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1> {
    const { journal } = await this.#read(ref);
    return journal === null ? "future" : EFFECT_STATES[journal.phase];
  }

  async apply(ref: LifecycleEffectRefV1<string>): Promise<void> {
    await this.#locked(ref, async () => {
      const session = await this.#read(ref);
      if (session.journal === null) await this.#writeInitial(session);
      for (;;) {
        const journal = session.journal as GitEffectJournalV1;
        switch (journal.phase) {
          case "planned":
            await this.#bindPreimages(session.plan);
            await this.#rewrite(session, { phase: "backed_up" });
            break;
          case "backed_up":
            await this.#bindStaged(session.plan);
            await this.#rewrite(session, { phase: "staged" });
            break;
          case "staged":
            await this.#revalidate(session.plan);
            await this.#rewrite(session, { phase: "validated" });
            break;
          case "applied": {
            const cursor = journal.nextTransition;
            await this.#forward(session.plan, cursor, "complete");
            const next = cursor + 1;
            await this.#rewrite(session, {
              phase: next === session.plan.transitions.length ? "verified" : "applied",
              nextTransition: next,
              observations: [...journal.observations, gitEffectForwardObservation(session.plan, cursor)],
            });
            break;
          }
          case "validated":
            await this.#revalidate(session.plan);
            await this.#rewrite(session, {
              phase: session.plan.transitions.length === 0 ? "verified" : "applied",
            });
            break;
          case "verified":
          case "finalized":
            return;
          case "compensating":
          case "rolled_back":
            refuseLifecycleRecovery("git_effect_direction", this.#journalPath(ref.id));
        }
      }
    });
  }

  /** Removes the retained preimage tombstones, then records the effect as past its point of no return. */
  async finalize(ref: LifecycleEffectRefV1<string>): Promise<void> {
    await this.#locked(ref, async () => {
      const session = await this.#read(ref);
      const phase = session.journal?.phase;
      if (phase === "finalized") return;
      if (phase !== "verified") refuseLifecycleRecovery("git_effect_not_verified", this.#journalPath(ref.id));
      for (const transition of session.plan.transitions) {
        if (transition.evidence.beforeTombstonePath === null) continue;
        const tombstone = await this.#dependencies.fs.lstat(transition.evidence.beforeTombstonePath);
        if (tombstone === null) continue;
        if (!holds(tombstone, transition.before)) {
          refuseLifecycleRecovery("git_effect_third_state", tombstone.path);
        }
        await this.#unlinkEvidence(tombstone);
      }
      await this.#rewrite(session, { phase: "finalized" });
    });
  }

  async compensate(ref: LifecycleEffectRefV1<string>): Promise<void> {
    await this.#locked(ref, async () => {
      const session = await this.#read(ref);
      const journal = session.journal;
      if (journal === null || journal.phase === "rolled_back") return;
      const count = session.plan.transitions.length;
      switch (journal.phase) {
        case "finalized":
          refuseLifecycleRecovery("git_effect_finalized", this.#journalPath(ref.id));
          break;
        case "planned":
        case "backed_up":
        case "staged":
        case "validated":
          await this.#rewrite(session, { phase: "rolled_back", compensationNext: -1 });
          return;
        case "applied": {
          const cursor = journal.nextTransition;
          const touched = await this.#forward(session.plan, cursor, "resolve");
          const next = touched ? cursor + 1 : cursor;
          await this.#rewrite(session, {
            phase: "compensating",
            nextTransition: next,
            compensationNext: next - 1,
            observations: touched
              ? [...journal.observations, gitEffectForwardObservation(session.plan, cursor)]
              : journal.observations,
          });
          break;
        }
        case "verified":
          await this.#rewrite(session, { phase: "compensating", compensationNext: count - 1 });
          break;
        case "compensating":
          break;
      }
      for (;;) {
        const current = session.journal as GitEffectJournalV1;
        const frontier = current.compensationNext ?? -1;
        if (frontier < 0) {
          await this.#rewrite(session, { phase: "rolled_back", compensationNext: -1 });
          return;
        }
        const relinquished = await this.#reverse(session.plan, frontier);
        const observations =
          relinquished === null
            ? current.observations
            : current.observations.map((observation, index) => (index === frontier ? relinquished : observation));
        await this.#rewrite(session, { compensationNext: frontier - 1, observations });
      }
    });
  }

  /**
   * §2.4 terminal compaction of one effect entry: only plan-derived quarantine
   * and evidence, then journal, immutable plan and stable lock. Final Git paths
   * are never touched, so a published or relinquished object survives. A
   * death after any removal resumes here and accepts that exact absence.
   */
  async compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void> {
    const { fs } = this.#dependencies;
    const planPath = this.#planPath(ref.id);
    const lockPath = child(this.#dependencies.journalRoot, `.${ref.id}.lock`);
    if ((await fs.lstat(planPath)) === null) {
      if ((await fs.lstat(this.#journalPath(ref.id))) !== null) {
        refuseLifecycleRecovery("git_effect_journal_without_plan", this.#journalPath(ref.id));
      }
      const lock = await fs.lstat(lockPath);
      if (lock !== null) {
        await fs.unlinkExact(lock);
        await this.#syncDirectory(this.#dependencies.journalRoot);
      }
      return;
    }
    const held = await this.#dependencies.locks.acquire(lockPath);
    try {
      const session = await this.#read(ref);
      const phase = session.journal?.phase ?? null;
      if (phase === null ? outcome !== "rolled_back" : phase !== outcome) {
        refuseLifecycleRecovery("git_effect_not_terminal", this.#journalPath(ref.id));
      }
      await this.#removeEvidence(session.plan, outcome);
      await this.#removeQuarantine(session.plan);
      for (const path of [this.#journalPath(ref.id), planPath, lockPath]) {
        const entry = await fs.lstat(path);
        if (entry === null) continue;
        await fs.unlinkExact(entry);
        await this.#syncDirectory(this.#dependencies.journalRoot);
      }
    } finally {
      await held.release();
    }
  }

  async #locked(ref: LifecycleEffectRefV1<string>, work: () => Promise<void>): Promise<void> {
    const held: TransactionLockHandle = await this.#dependencies.locks.acquire(
      child(this.#dependencies.journalRoot, `.${ref.id}.lock`),
    );
    try {
      await work();
    } finally {
      await held.release();
    }
  }

  #planPath(id: string): CanonicalAbsolutePathV1 {
    return child(this.#dependencies.journalRoot, `${id}.plan.json`);
  }

  #journalPath(id: string): CanonicalAbsolutePathV1 {
    return child(this.#dependencies.journalRoot, `${id}.json`);
  }

  async #guardedLeaf(path: CanonicalAbsolutePathV1, maximumBytes: number, reason: string): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (
      entry === null ||
      entry.kind !== "regular_file" ||
      entry.ownerUid !== this.#dependencies.effectiveUid ||
      entry.mode !== 0o600 ||
      entry.nlink !== 1 ||
      BigInt(entry.size) > BigInt(maximumBytes)
    ) {
      refuseLifecycleRecovery(reason, path);
    }
    return entry;
  }

  async #read(ref: LifecycleEffectRefV1<string>): Promise<SessionV1> {
    const { fs, effectiveUid } = this.#dependencies;
    const planPath = this.#planPath(ref.id);
    const planEntry = await this.#guardedLeaf(planPath, MAX_PLAN_BYTES, "git_effect_plan_shape");
    const planText = decoder.decode(await fs.readRegular(planEntry, MAX_PLAN_BYTES));
    let plan: GitEffectPlanV1;
    try {
      plan = validateGitEffectPlan(decodeCanonicalJson(encoder.encode(planText), MAX_PLAN_BYTES), effectiveUid);
    } catch {
      return refuseLifecycleRecovery("git_effect_plan_invalid", planPath);
    }
    const codec = createGitEffectLedgerCodec(effectiveUid);
    if (codec.plan.encode(plan) !== planText || plan.id !== ref.id) {
      refuseLifecycleRecovery("git_effect_plan_bytes", planPath);
    }
    if (gitEffectPlanHash(plan) !== ref.planHash) refuseLifecycleRecovery("git_effect_plan_hash", planPath);

    const journalPath = this.#journalPath(ref.id);
    if ((await fs.lstat(journalPath)) === null) return { plan, journal: null, journalEntry: null };
    const journalEntry = await this.#guardedLeaf(journalPath, plan.maximumJournalBytes, "git_effect_journal_shape");
    const journalText = decoder.decode(await fs.readRegular(journalEntry, plan.maximumJournalBytes));
    let journal: GitEffectJournalV1;
    try {
      journal = validateGitEffectJournal(
        decodeCanonicalJson(encoder.encode(journalText), plan.maximumJournalBytes),
        effectiveUid,
      );
      assertGitEffectJournalForPlan(plan, journal);
    } catch {
      return refuseLifecycleRecovery("git_effect_journal_invalid", journalPath);
    }
    if (codec.journal.encode(journal) !== journalText || journal.planHash !== ref.planHash) {
      refuseLifecycleRecovery("git_effect_journal_bytes", journalPath);
    }
    return { plan, journal, journalEntry };
  }

  #encodeJournal(plan: GitEffectPlanV1, journal: GitEffectJournalV1): Uint8Array {
    const bytes = encoder.encode(createGitEffectLedgerCodec(this.#dependencies.effectiveUid).journal.encode(journal));
    if (bytes.byteLength > plan.maximumJournalBytes) {
      refuseLifecycleRecovery("git_effect_journal_too_large", this.#journalPath(plan.id));
    }
    return bytes;
  }

  #tempPath(id: string): CanonicalAbsolutePathV1 {
    const uuid = this.#dependencies.uuid();
    if (!LOWERCASE_V4_UUID.test(uuid)) throw new Error("invalid lifecycle temporary uuid");
    return child(this.#dependencies.journalRoot, `.${id}.${uuid}.json.tmp`);
  }

  async #journalRoot(): Promise<LifecycleGuardedEntryV1> {
    const root = await this.#dependencies.fs.lstat(this.#dependencies.journalRoot);
    if (root === null || root.kind !== "directory" || root.mode !== 0o700) {
      refuseLifecycleRecovery("lifecycle_ledger_root_shape", this.#dependencies.journalRoot);
    }
    return root;
  }

  /** The plan-bound journal is durable before the first Git mutation, including the first read-back. */
  async #writeInitial(session: SessionV1): Promise<void> {
    const { fs } = this.#dependencies;
    const createdAt = this.#dependencies.clock();
    const journal: GitEffectJournalV1 = {
      schemaVersion: 1,
      id: session.plan.id,
      coordinatorId: session.plan.coordinatorId,
      phase: "planned",
      planHash: gitEffectPlanHash(session.plan),
      nextTransition: 0,
      compensationNext: null,
      observations: [],
      createdAt,
      updatedAt: createdAt,
    };
    assertGitEffectJournalForPlan(session.plan, journal);
    const root = await this.#journalRoot();
    const temp = await fs.writeExclusive(this.#tempPath(session.plan.id), this.#encodeJournal(session.plan, journal));
    await fs.renameNoReplace(temp, this.#journalPath(session.plan.id));
    await fs.syncDirectory(root);
    session.journal = journal;
    session.journalEntry = { ...temp, path: this.#journalPath(session.plan.id) };
    await this.#boundary({ kind: "journal_written", phase: "planned", nextTransition: 0, compensationNext: null });
  }

  async #rewrite(session: SessionV1, patch: Partial<GitEffectJournalV1>): Promise<void> {
    const { fs } = this.#dependencies;
    const current = session.journal;
    if (current === null) refuseLifecycleRecovery("git_effect_journal_absent", this.#journalPath(session.plan.id));
    const next: GitEffectJournalV1 = { ...current, ...patch, updatedAt: this.#dependencies.clock() };
    const nextBytes = this.#encodeJournal(session.plan, next);
    try {
      assertGitEffectJournalForPlan(session.plan, validateGitEffectJournal(JSON.parse(decoder.decode(nextBytes)), this.#dependencies.effectiveUid));
    } catch {
      refuseLifecycleRecovery("git_effect_journal_invalid", this.#journalPath(session.plan.id));
    }
    const root = await this.#journalRoot();
    const journalPath = this.#journalPath(session.plan.id);
    const entry = await this.#guardedLeaf(journalPath, session.plan.maximumJournalBytes, "git_effect_journal_shape");
    if (session.journalEntry === null || !sameLifecycleGuardedIdentity(entry, session.journalEntry)) {
      refuseLifecycleRecovery("git_effect_journal_stale", journalPath);
    }
    const temp = await fs.writeExclusive(this.#tempPath(session.plan.id), nextBytes);
    await fs.renameOver(temp, entry);
    await fs.syncDirectory(root);
    session.journal = next;
    session.journalEntry = { ...temp, path: journalPath };
    await this.#boundary({
      kind: "journal_written",
      phase: next.phase,
      nextTransition: next.nextTransition,
      compensationNext: next.compensationNext,
    });
  }

  async #boundary(reached: GitEffectBoundaryV1): Promise<void> {
    await this.#dependencies.afterBoundary?.(reached);
  }

  async #syncDirectory(path: CanonicalAbsolutePathV1): Promise<void> {
    const directory = await this.#dependencies.fs.lstat(path);
    if (directory === null || directory.kind !== "directory") {
      refuseLifecycleRecovery("git_effect_parent", path);
    }
    await this.#dependencies.fs.syncDirectory(directory);
  }

  /** Reopens a state by identity and, for a regular file, by content hash. */
  async #requireState(path: CanonicalAbsolutePathV1, state: GuardedGitPathStateV1): Promise<LifecycleGuardedEntryV1 | null> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (state.state === "absent") {
      if (entry !== null) refuseLifecycleRecovery("git_effect_third_state", path);
      return null;
    }
    if (!holds(entry, state)) refuseLifecycleRecovery("git_effect_third_state", path);
    const bound = entry as LifecycleGuardedEntryV1;
    if (state.state === "regular_file") {
      if ((await this.#dependencies.fs.hashRegular(bound, BigInt(state.size))) !== state.hash) {
        refuseLifecycleRecovery("git_effect_third_state", path);
      }
    } else {
      const fingerprint = await this.#fingerprint(bound);
      if (fingerprint.hash !== state.treeHash || fingerprint.entries.length !== state.entryCount) {
        refuseLifecycleRecovery("git_effect_third_state", path);
      }
    }
    return bound;
  }

  /** `backed_up`: every preimage is reopened and bound by identity and hash. */
  async #bindPreimages(plan: GitEffectPlanV1): Promise<void> {
    for (const transition of plan.transitions) await this.#requireState(transition.path, transition.before);
  }

  /** `staged`: every required postimage sits at its exact quarantine path with its recorded identity. */
  async #bindStaged(plan: GitEffectPlanV1): Promise<void> {
    for (const transition of plan.transitions) {
      if (transition.evidence.stagedPostimagePath === null) continue;
      const staged = stagedOf(transition);
      await this.#requireState(staged.path, staged.state);
    }
  }

  /**
   * `validated`: containment and device, absent tombstones, and each preimage
   * and staged identity once more by `dev`/`ino` (both were hashed a phase ago).
   */
  async #revalidate(plan: GitEffectPlanV1): Promise<void> {
    const { fs } = this.#dependencies;
    const quarantine = await fs.lstat(plan.quarantineRoot);
    if (
      quarantine === null ||
      quarantine.kind !== "directory" ||
      quarantine.ownerUid !== this.#dependencies.effectiveUid ||
      quarantine.mode !== 0o700
    ) {
      refuseLifecycleRecovery("git_effect_quarantine_shape", plan.quarantineRoot);
    }
    const target = (await fs.lstat(plan.gitDirectory)) ?? (plan.worktreeRoot === null ? null : await fs.lstat(plan.worktreeRoot));
    if (target === null || target.kind !== "directory") refuseLifecycleRecovery("git_effect_target_shape", plan.gitDirectory);
    if (target.dev !== quarantine.dev) refuseLifecycleRecovery("cross_device_git_state", plan.gitDirectory);
    for (const transition of plan.transitions) {
      const parent = await fs.lstat(lifecycleParentPath(transition.path));
      if (parent === null || parent.kind !== "directory") {
        refuseLifecycleRecovery("git_effect_parent", lifecycleParentPath(transition.path));
      }
      const final = await fs.lstat(transition.path);
      if (transition.before.state === "absent" ? final !== null : !holds(final, transition.before)) {
        refuseLifecycleRecovery("git_effect_third_state", transition.path);
      }
      const { stagedPostimagePath, stagedPostimage, beforeTombstonePath, afterTombstonePath } = transition.evidence;
      if (stagedPostimagePath !== null && !holds(await fs.lstat(stagedPostimagePath), stagedPostimage)) {
        refuseLifecycleRecovery("git_effect_third_state", stagedPostimagePath);
      }
      for (const tombstone of [beforeTombstonePath, afterTombstonePath]) {
        if (tombstone !== null && (await fs.lstat(tombstone)) !== null) {
          refuseLifecycleRecovery("git_effect_third_state", tombstone);
        }
      }
    }
  }

  async #ensureEvidenceRoot(path: CanonicalAbsolutePathV1): Promise<void> {
    const { fs } = this.#dependencies;
    const root = lifecycleParentPath(path);
    const existing = await fs.lstat(root);
    if (existing !== null) {
      if (existing.kind !== "directory" || existing.mode !== 0o700) refuseLifecycleRecovery("git_effect_evidence_root", root);
      return;
    }
    await fs.mkdirExclusive(root);
    await this.#syncDirectory(lifecycleParentPath(root));
  }

  async #move(
    transition: GitEffectTransitionV1,
    index: number,
    source: LifecycleGuardedEntryV1,
    destinationPath: CanonicalAbsolutePathV1,
    move: GitEffectMoveV1,
  ): Promise<void> {
    if (move === "final_to_before" || move === "final_to_after") await this.#ensureEvidenceRoot(destinationPath);
    const outcome = await this.#dependencies.fs.renameGitNoReplace(source, destinationPath);
    if (outcome === "exists") refuseLifecycleRecovery("git_effect_publication_collision", destinationPath);
    await this.#syncDirectory(lifecycleParentPath(destinationPath));
    await this.#syncDirectory(lifecycleParentPath(source.path));
    await this.#boundary({ kind: "renamed", transitionIndex: index, role: transition.role, move });
  }

  /**
   * Resolves transition `index` from whichever closed forward microstate is on
   * disk. `"complete"` publishes and verifies it; `"resolve"` (entering
   * compensation) finishes only a publication that already started and
   * reports whether it did, so an untouched transition is never published.
   */
  async #forward(plan: GitEffectPlanV1, index: number, mode: "complete" | "resolve"): Promise<boolean> {
    const { fs } = this.#dependencies;
    const transition = plan.transitions[index];
    if (transition === undefined) refuseLifecycleRecovery("git_effect_cursor", this.#journalPath(plan.id));
    const final = await fs.lstat(transition.path);
    switch (transition.operation) {
      case "reuse":
        if (!holds(final, transition.before)) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        return mode === "complete";
      case "create": {
        const staged = stagedOf(transition);
        if (holds(final, staged.state)) {
          await this.#requireAbsent(staged.path);
          return true;
        }
        if (final !== null) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        if (mode === "resolve") {
          await this.#requireHeld(staged.path, staged.state);
          return false;
        }
        await this.#move(transition, index, await this.#requireHeld(staged.path, staged.state), transition.path, "stage_to_final");
        await this.#requireHeld(transition.path, staged.state);
        return true;
      }
      case "replace": {
        const staged = stagedOf(transition);
        const before = tombstoneOf(transition, "before");
        if (holds(final, staged.state)) {
          await this.#requireHeld(before, transition.before);
          await this.#requireAbsent(staged.path);
          return true;
        }
        let tombstoned = false;
        if (holds(final, transition.before)) {
          await this.#requireAbsent(before);
          await this.#requireHeld(staged.path, staged.state);
          if (mode === "resolve") return false;
          await this.#move(transition, index, final as LifecycleGuardedEntryV1, before, "final_to_before");
          tombstoned = true;
        } else if (final !== null) {
          refuseLifecycleRecovery("git_effect_third_state", transition.path);
        }
        if (!tombstoned) await this.#requireHeld(before, transition.before);
        await this.#move(transition, index, await this.#requireHeld(staged.path, staged.state), transition.path, "stage_to_final");
        await this.#requireHeld(transition.path, staged.state);
        return true;
      }
      case "remove": {
        const before = tombstoneOf(transition, "before");
        if (final === null) {
          await this.#requireHeld(before, transition.before);
          return true;
        }
        if (!holds(final, transition.before)) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        await this.#requireAbsent(before);
        if (mode === "resolve") return false;
        await this.#move(transition, index, final, before, "final_to_before");
        await this.#requireHeld(before, transition.before);
        return true;
      }
    }
  }

  /**
   * One reverse step at the frontier. Created objects and a created `.git`
   * are relinquished in place (their observation is returned for the atomic
   * rewrite); every other transition is restored through its tombstones.
   */
  async #reverse(plan: GitEffectPlanV1, index: number): Promise<GitEffectObservationV1 | null> {
    const { fs } = this.#dependencies;
    const transition = plan.transitions[index];
    if (transition === undefined) refuseLifecycleRecovery("git_effect_cursor", this.#journalPath(plan.id));
    const final = await fs.lstat(transition.path);
    switch (transition.operation) {
      case "reuse":
        if (!holds(final, transition.before)) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        return null;
      case "create": {
        const staged = stagedOf(transition);
        if (transition.role === "source_git_directory_tree") {
          const root = staged.state;
          if (
            root.state !== "directory_tree" ||
            final === null ||
            final.kind !== "directory" ||
            final.dev !== root.dev ||
            final.ino !== root.ino
          ) {
            refuseLifecycleRecovery("git_effect_third_state", transition.path);
          }
          return relinquishedTreeObservation(plan, index, { ownerUid: final.ownerUid, mode: final.mode });
        }
        if (isObjectRole(transition.role)) {
          await this.#requireState(transition.path, staged.state);
          return relinquishedObjectObservation(plan, index);
        }
        const after = tombstoneOf(transition, "after");
        if (final === null) {
          await this.#requireHeld(after, staged.state);
          return null;
        }
        if (!holds(final, staged.state)) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        await this.#requireAbsent(after);
        await this.#move(transition, index, final, after, "final_to_after");
        return null;
      }
      case "replace": {
        const staged = stagedOf(transition);
        const before = tombstoneOf(transition, "before");
        const after = tombstoneOf(transition, "after");
        if (holds(final, transition.before)) {
          await this.#requireHeld(after, staged.state);
          await this.#requireAbsent(before);
          return null;
        }
        if (holds(final, staged.state)) {
          await this.#requireAbsent(after);
          await this.#requireHeld(before, transition.before);
          await this.#move(transition, index, final as LifecycleGuardedEntryV1, after, "final_to_after");
        } else if (final !== null) {
          refuseLifecycleRecovery("git_effect_third_state", transition.path);
        } else {
          await this.#requireHeld(after, staged.state);
        }
        await this.#move(transition, index, await this.#requireHeld(before, transition.before), transition.path, "before_to_final");
        await this.#requireHeld(transition.path, transition.before);
        return null;
      }
      case "remove": {
        const before = tombstoneOf(transition, "before");
        if (holds(final, transition.before)) {
          await this.#requireAbsent(before);
          return null;
        }
        if (final !== null) refuseLifecycleRecovery("git_effect_third_state", transition.path);
        await this.#move(transition, index, await this.#requireHeld(before, transition.before), transition.path, "before_to_final");
        await this.#requireHeld(transition.path, transition.before);
        return null;
      }
    }
  }

  async #requireHeld(path: CanonicalAbsolutePathV1, state: GuardedGitPathStateV1): Promise<LifecycleGuardedEntryV1> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (!holds(entry, state)) refuseLifecycleRecovery("git_effect_third_state", path);
    return entry as LifecycleGuardedEntryV1;
  }

  async #requireAbsent(path: CanonicalAbsolutePathV1): Promise<void> {
    if ((await this.#dependencies.fs.lstat(path)) !== null) refuseLifecycleRecovery("git_effect_third_state", path);
  }

  async #unlinkEvidence(entry: LifecycleGuardedEntryV1): Promise<void> {
    await this.#dependencies.fs.unlinkExact(entry);
    await this.#syncDirectory(lifecycleParentPath(entry.path));
    await this.#boundary({ kind: "evidence_removed", path: entry.path });
  }

  /**
   * Terminal evidence cleanup. A rolled-back effect's `before/<i>` would be a
   * preimage that never came back, so it is refused rather than deleted.
   */
  async #removeEvidence(plan: GitEffectPlanV1, outcome: "finalized" | "rolled_back"): Promise<void> {
    const { fs } = this.#dependencies;
    for (const transition of plan.transitions) {
      const { stagedPostimagePath, stagedPostimage, beforeTombstonePath, afterTombstonePath } = transition.evidence;
      if (stagedPostimagePath !== null) {
        const staged = await fs.lstat(stagedPostimagePath);
        if (staged !== null) {
          if (outcome === "finalized" || !holds(staged, stagedPostimage)) {
            refuseLifecycleRecovery("git_effect_third_state", stagedPostimagePath);
          }
          if (staged.kind === "directory") await this.#removeStagedTree(staged);
          else await this.#unlinkEvidence(staged);
        }
      }
      if (beforeTombstonePath !== null) {
        const tombstone = await fs.lstat(beforeTombstonePath);
        if (tombstone !== null) {
          if (outcome === "rolled_back" || !holds(tombstone, transition.before)) {
            refuseLifecycleRecovery("git_effect_third_state", beforeTombstonePath);
          }
          await this.#unlinkEvidence(tombstone);
        }
      }
      if (afterTombstonePath !== null) {
        const tombstone = await fs.lstat(afterTombstonePath);
        if (tombstone !== null) {
          if (outcome === "finalized" || !holds(tombstone, stagedPostimage)) {
            refuseLifecycleRecovery("git_effect_third_state", afterTombstonePath);
          }
          await this.#unlinkEvidence(tombstone);
        }
      }
    }
  }

  /**
   * Removes the exact empty evidence roots, the effect directory and its side
   * directory, then `git` only when the other side's effect is already gone:
   * the coordinator's own staging entry removes neither.
   */
  async #removeQuarantine(plan: GitEffectPlanV1): Promise<void> {
    const { fs } = this.#dependencies;
    const side = lifecycleParentPath(plan.quarantineRoot);
    const git = lifecycleParentPath(side);
    const directories = [
      child(plan.quarantineRoot, "post"),
      child(plan.quarantineRoot, "before"),
      child(plan.quarantineRoot, "after"),
      plan.quarantineRoot,
      side,
    ];
    for (const path of directories) {
      const directory = await fs.lstat(path);
      if (directory === null) continue;
      await fs.rmdirExactEmpty(directory);
      await this.#syncDirectory(lifecycleParentPath(path));
    }
    const shared = await fs.lstat(git);
    if (shared === null) return;
    for await (const name of fs.names(shared)) {
      if (name.length > 0) return;
    }
    await fs.rmdirExactEmpty(shared);
    await this.#syncDirectory(lifecycleParentPath(git));
  }

  /** An unpublished staged `.git` is removed children-first, only after it re-fingerprints to the plan. */
  async #removeStagedTree(root: LifecycleGuardedEntryV1): Promise<void> {
    const { fs } = this.#dependencies;
    const fingerprint = await this.#fingerprint(root);
    for (const entry of [...fingerprint.entries].reverse()) {
      const path = child(root.path, entry.relativePath);
      const observed = await fs.lstat(path);
      if (observed === null || observed.dev !== entry.dev || observed.ino !== entry.ino) {
        refuseLifecycleRecovery("git_effect_third_state", path);
      }
      if (observed.kind === "directory") await fs.rmdirExactEmpty(observed);
      else await fs.unlinkExact(observed);
    }
    await fs.rmdirExactEmpty(root);
    await this.#syncDirectory(lifecycleParentPath(root.path));
    await this.#boundary({ kind: "evidence_removed", path: root.path });
  }

  /**
   * §2.4's one recursive `directory_tree` fingerprint: no link is followed,
   * directories are owner-owned, regular files single-link and hashed through
   * the guarded port, and records sort by unsigned UTF-8 relative path.
   */
  async #fingerprint(root: LifecycleGuardedEntryV1): Promise<{
    readonly hash: string;
    readonly entries: readonly GitTreeFingerprintEntryV1[];
  }> {
    const { fs, effectiveUid } = this.#dependencies;
    const entries: GitTreeFingerprintEntryV1[] = [];
    const walk = async (directory: LifecycleGuardedEntryV1, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_TREE_DEPTH) refuseLifecycleRecovery("git_effect_tree_shape", directory.path);
      for await (const name of fs.names(directory)) {
        const relativePath = prefix === "" ? name : `${prefix}/${name}`;
        try {
          parseGitTreeRelativePath(relativePath);
        } catch {
          refuseLifecycleRecovery("git_effect_tree_shape", directory.path);
        }
        if (entries.length >= GIT_TREE_FINGERPRINT_MAX_ENTRIES) refuseLifecycleRecovery("git_effect_tree_shape", root.path);
        const entry = await fs.lstat(child(directory.path, name));
        if (entry === null || entry.ownerUid !== effectiveUid) refuseLifecycleRecovery("git_effect_tree_shape", directory.path);
        const identity = { ownerUid: entry.ownerUid, mode: entry.mode, dev: entry.dev, ino: entry.ino };
        if (entry.kind === "directory") {
          entries.push({ relativePath, kind: "directory", ...identity } as GitTreeFingerprintEntryV1);
          await walk(entry, relativePath, depth + 1);
        } else if (entry.kind === "regular_file" && entry.nlink === 1) {
          const hash = await fs.hashRegular(entry, BigInt(GIT_SCOPE_BOUNDS.fileMaxBytes));
          entries.push({ relativePath, kind: "regular_file", ...identity, nlink: 1, size: Number(entry.size), hash } as GitTreeFingerprintEntryV1);
        } else {
          refuseLifecycleRecovery("git_effect_tree_shape", entry.path);
        }
      }
    };
    await walk(root, "", 1);
    entries.sort((left, right) => compareUnsignedUtf8(left.relativePath, right.relativePath));
    let fingerprint;
    try {
      fingerprint = validateGitTreeFingerprint(
        { root: { ownerUid: root.ownerUid, mode: root.mode, dev: root.dev, ino: root.ino }, entries },
        effectiveUid,
      );
    } catch {
      return refuseLifecycleRecovery("git_effect_tree_shape", root.path);
    }
    return { hash: gitTreeFingerprintHash(fingerprint), entries: fingerprint.entries };
  }
}

function isObjectRole(role: GitEffectTransitionRoleV1): boolean {
  return role === "source_object" || role === "destination_pack" || role === "destination_index";
}
