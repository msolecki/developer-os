import {
  LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  LIFECYCLE_HASH_DOMAINS,
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  SCHEDULED_JOB_IDS,
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLaunchdEffectId,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseUtcTimestamp,
  LifecycleRecoveryRequiredError,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonV1,
  type CanonicalJsonValue,
  type LaunchdEffectIdV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleEffectLedgerCodecV1,
  type LifecycleEffectRefV1,
  type LifecycleEffectTerminalV1,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleLedgerRootsV1,
  type LifecycleValueCodec,
  type LowerHexSha256,
  type ScheduledJobIdV1,
  type TransactionLockHandle,
  type TransactionLockProvider,
  type UtcTimestampV1,
} from "@developer-os/core";

import { generatedLabel, launchdJob, parseGeneratedLabel } from "./registry.js";
import { LaunchdInputError, type GeneratedLaunchdLabelV1, type LaunchdGenerationV1, type LaunchdGuiDomainV1, type LaunchdLiveStateV1 } from "./types.js";

export type LaunchdEffectPositionV1 = "before_files" | "after_files";

/**
 * Spec §2.4: a `before_files` transition is exactly `loaded { old } → unloaded`, an `after_files`
 * one exactly `unloaded → loaded { new }`; there is no loaded→loaded transition.
 */
export type LaunchdEffectTransitionV1 = {
  readonly job: ScheduledJobIdV1;
  readonly label: GeneratedLaunchdLabelV1;
  readonly generation: LaunchdGenerationV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly plistPath: CanonicalAbsolutePathV1;
  readonly plistHash: LowerHexSha256;
  readonly before: LaunchdLiveStateV1;
  readonly after: LaunchdLiveStateV1;
};

export type LaunchdEffectPlanV1 = {
  readonly schemaVersion: 1;
  readonly id: LaunchdEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly position: LaunchdEffectPositionV1;
  readonly processTableHash: LowerHexSha256;
  readonly maximumJournalBytes: number;
  readonly transitions: readonly LaunchdEffectTransitionV1[];
};

export type LaunchdEffectObservationV1 = {
  readonly transitionIndex: number;
  readonly observedAfter: LaunchdLiveStateV1;
};

export type LaunchdEffectJournalPhaseV1 =
  | "planned"
  | "backed_up"
  | "staged"
  | "validated"
  | "applied"
  | "verified"
  | "compensating"
  | "finalized"
  | "rolled_back";

export type LaunchdEffectJournalV1 = {
  readonly schemaVersion: 1;
  readonly id: LaunchdEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly phase: LaunchdEffectJournalPhaseV1;
  readonly planHash: LowerHexSha256;
  /**
   * Spec §5.3 rule 4: the launchctl the journal was opened with, so a resume after a macOS update
   * refuses `unsupported_launchd_distribution` rather than a bare table-hash mismatch. `null`
   * exactly when the effect has no transition and so never loads a process table.
   */
  readonly launchctlIdentityHash: LowerHexSha256 | null;
  readonly nextTransition: number;
  readonly compensationNext: number | null;
  readonly observations: readonly LaunchdEffectObservationV1[];
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
};

export const LAUNCHD_EFFECT_JOURNAL_PHASES: readonly LaunchdEffectJournalPhaseV1[] = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "compensating",
  "finalized",
  "rolled_back",
];

const MAX_TRANSITIONS = 8;
const MAX_PLAN_BYTES = 16_777_216;
const PRE_APPLY_PHASES: ReadonlySet<LaunchdEffectJournalPhaseV1> = new Set(["planned", "backed_up", "staged", "validated"]);
const FIXED_WIDTH_TIMESTAMP = "2000-01-01T00:00:00.000Z" as UtcTimestampV1;
const PLACEHOLDER_HASH = "0".repeat(64) as LowerHexSha256;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function refuseLifecycleRecovery(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(`${label}: not an object`);
  const present = Object.keys(value);
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) refuse(`${label}: keys`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) refuse(label);
  return value;
}

function canonical(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

export function sameLaunchdLiveState(left: LaunchdLiveStateV1, right: LaunchdLiveStateV1): boolean {
  if (left.state === "unloaded" || right.state === "unloaded") return left.state === right.state;
  return left.label === right.label && left.generation === right.generation;
}

/** `job === null` accepts a loaded label of any registry job (a journal observation names no job). */
export function parseLaunchdLiveState(value: unknown, job: ScheduledJobIdV1 | null, label: string): LaunchdLiveStateV1 {
  const state = (value as { readonly state?: unknown } | null)?.state;
  if (state === "unloaded") {
    exactKeys(value, ["state"], label);
    return Object.freeze({ state: "unloaded" });
  }
  const loaded = exactKeys(value, ["state", "label", "generation"], label);
  if (state !== "loaded") refuse(`${label}: state`);
  const parsed = parseGeneratedLabel(loaded.label);
  if ((job !== null && parsed.job !== job) || parsed.generation !== loaded.generation) refuse(`${label}: label`);
  return Object.freeze({ state: "loaded", label: generatedLabel(parsed.job, parsed.generation), generation: parsed.generation });
}

function parseTransition(value: unknown, position: LaunchdEffectPositionV1, index: number): LaunchdEffectTransitionV1 {
  const label = `LaunchdEffectTransitionV1[${String(index)}]`;
  const raw = exactKeys(value, ["job", "label", "generation", "domain", "plistPath", "plistHash", "before", "after"], label);
  const job = launchdJob(raw.job).id;
  const parsed = parseGeneratedLabel(raw.label);
  if (parsed.job !== job || parsed.generation !== raw.generation) refuse(`${label}: label`);
  if (typeof raw.domain !== "string" || !/^gui\/(0|[1-9][0-9]{0,9})$/.test(raw.domain)) refuse(`${label}: domain`);
  const before = parseLaunchdLiveState(raw.before, job, `${label}.before`);
  const after = parseLaunchdLiveState(raw.after, job, `${label}.after`);
  const loaded = position === "before_files" ? before : after;
  const unloaded = position === "before_files" ? after : before;
  if (loaded.state !== "loaded" || unloaded.state !== "unloaded" || loaded.label !== raw.label) refuse(`${label}: ${position} direction`);
  return Object.freeze({
    job,
    label: generatedLabel(job, parsed.generation),
    generation: parsed.generation,
    domain: raw.domain as LaunchdGuiDomainV1,
    plistPath: parseCanonicalAbsolutePathText(raw.plistPath),
    plistHash: parseLowerHexSha256(raw.plistHash),
    before,
    after,
  });
}

/**
 * The exact `CanonicalJsonV1` maximum over every reachable journal of `plan` (spec §2.4). The
 * widest phase is `compensating` with the full observation prefix and `compensationNext == -1`:
 * `rolled_back`/`finalized` are shorter phase names and `verified`'s `null` loses to that pair.
 * `planHash` and both timestamps are fixed-width, so placeholders measure the real bytes.
 */
export function maximumLaunchdEffectJournalBytes(
  plan: Pick<LaunchdEffectPlanV1, "id" | "coordinatorId" | "transitions">,
): number {
  const widest: LaunchdEffectJournalV1 = {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    phase: "compensating",
    planHash: PLACEHOLDER_HASH,
    launchctlIdentityHash: plan.transitions.length === 0 ? null : PLACEHOLDER_HASH,
    nextTransition: plan.transitions.length,
    compensationNext: -1,
    observations: plan.transitions.map((transition, transitionIndex) => ({ transitionIndex, observedAfter: transition.after })),
    createdAt: FIXED_WIDTH_TIMESTAMP,
    updatedAt: FIXED_WIDTH_TIMESTAMP,
  };
  return encoder.encode(encodeCanonicalJson(canonical(widest))).byteLength;
}

/** Transitions are unique per job and in closed registry order; each obeys its position's direction. */
export function validateLaunchdEffectPlan(value: unknown): LaunchdEffectPlanV1 {
  const raw = exactKeys(value, ["schemaVersion", "id", "coordinatorId", "position", "processTableHash", "maximumJournalBytes", "transitions"], "LaunchdEffectPlanV1");
  if (raw.schemaVersion !== 1) refuse("LaunchdEffectPlanV1: schemaVersion");
  if (raw.position !== "before_files" && raw.position !== "after_files") refuse("LaunchdEffectPlanV1: position");
  const position = raw.position;
  if (!Array.isArray(raw.transitions) || raw.transitions.length > MAX_TRANSITIONS) refuse("LaunchdEffectPlanV1: transitions");
  const transitions = (raw.transitions as readonly unknown[]).map((transition, index) => parseTransition(transition, position, index));
  let order = -1;
  for (const transition of transitions) {
    const index = SCHEDULED_JOB_IDS.indexOf(transition.job);
    if (index <= order) refuse("LaunchdEffectPlanV1: transitions are not unique in registry order");
    order = index;
  }
  const domains = new Set(transitions.map((transition) => transition.domain));
  if (domains.size > 1) refuse("LaunchdEffectPlanV1: more than one domain");
  const plan: LaunchdEffectPlanV1 = Object.freeze({
    schemaVersion: 1,
    id: parseLaunchdEffectId(raw.id),
    coordinatorId: parseLifecycleCoordinatorId(raw.coordinatorId, null),
    position,
    processTableHash: parseLowerHexSha256(raw.processTableHash),
    maximumJournalBytes: integer(raw.maximumJournalBytes, 1, MAX_LAUNCHD_EFFECT_JOURNAL_BYTES, "LaunchdEffectPlanV1: maximumJournalBytes"),
    transitions: Object.freeze(transitions),
  });
  if (plan.maximumJournalBytes !== maximumLaunchdEffectJournalBytes(plan)) refuse("LaunchdEffectPlanV1: maximumJournalBytes is not the exact maximum");
  return plan;
}

export function encodeLaunchdEffectPlan(plan: LaunchdEffectPlanV1): CanonicalJsonV1 {
  return encodeCanonicalJson(canonical(plan));
}

/** SHA-256 over `developer-os:launchd-effect-plan:v1\0` plus the plan's canonical JSON. */
export function launchdEffectPlanHash(plan: LaunchdEffectPlanV1): LowerHexSha256 {
  return hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.launchdEffectPlan, canonical(plan));
}

export function validateLaunchdEffectJournal(value: unknown): LaunchdEffectJournalV1 {
  const label = "LaunchdEffectJournalV1";
  const raw = exactKeys(
    value,
    [
      "schemaVersion",
      "id",
      "coordinatorId",
      "phase",
      "planHash",
      "launchctlIdentityHash",
      "nextTransition",
      "compensationNext",
      "observations",
      "createdAt",
      "updatedAt",
    ],
    label,
  );
  if (raw.schemaVersion !== 1) refuse(`${label}: schemaVersion`);
  if (!LAUNCHD_EFFECT_JOURNAL_PHASES.includes(raw.phase as LaunchdEffectJournalPhaseV1)) refuse(`${label}: phase`);
  if (!Array.isArray(raw.observations) || raw.observations.length > MAX_TRANSITIONS) refuse(`${label}: observations`);
  const observations = (raw.observations as readonly unknown[]).map((observation, index) => {
    const entry = exactKeys(observation, ["transitionIndex", "observedAfter"], `${label}.observations[${String(index)}]`);
    const observedAfter = parseLaunchdLiveState(entry.observedAfter, null, `${label}.observedAfter`);
    return Object.freeze({ transitionIndex: integer(entry.transitionIndex, 0, MAX_TRANSITIONS - 1, `${label}: transitionIndex`), observedAfter });
  });
  return Object.freeze({
    schemaVersion: 1,
    id: parseLaunchdEffectId(raw.id),
    coordinatorId: parseLifecycleCoordinatorId(raw.coordinatorId, null),
    phase: raw.phase as LaunchdEffectJournalPhaseV1,
    planHash: parseLowerHexSha256(raw.planHash),
    launchctlIdentityHash: raw.launchctlIdentityHash === null ? null : parseLowerHexSha256(raw.launchctlIdentityHash),
    nextTransition: integer(raw.nextTransition, 0, MAX_TRANSITIONS, `${label}: nextTransition`),
    compensationNext: raw.compensationNext === null ? null : integer(raw.compensationNext, -1, MAX_TRANSITIONS - 1, `${label}: compensationNext`),
    observations: Object.freeze(observations),
    createdAt: parseUtcTimestamp(raw.createdAt),
    updatedAt: parseUtcTimestamp(raw.updatedAt),
  });
}

export function encodeLaunchdEffectJournal(journal: LaunchdEffectJournalV1): CanonicalJsonV1 {
  return encodeCanonicalJson(canonical(journal));
}

/**
 * Spec §2.4's exhaustive phase relation: any other phase/cursor/observation/compensation tuple is
 * malformed, and every observation is the plan-bound postimage of its transition.
 */
export function validateLaunchdEffectJournalForPlan(plan: LaunchdEffectPlanV1, journal: LaunchdEffectJournalV1): void {
  const malformed = (detail: string): never => refuseLifecycleRecovery("lifecycle_effect_journal_state", `${plan.id}: ${detail}`);
  if (journal.id !== plan.id || journal.coordinatorId !== plan.coordinatorId || journal.planHash !== launchdEffectPlanHash(plan)) {
    malformed("identity");
  }
  const n = plan.transitions.length;
  if ((journal.launchctlIdentityHash === null) !== (n === 0)) malformed("launchctl identity");
  const c = journal.nextTransition;
  const compensation = journal.compensationNext;
  if (journal.observations.length !== c) malformed("observation count");
  journal.observations.forEach((observation, index) => {
    const transition = plan.transitions[index];
    if (transition === undefined || observation.transitionIndex !== index || !sameLaunchdLiveState(observation.observedAfter, transition.after)) {
      malformed("observation");
    }
  });
  const phase = journal.phase;
  if (PRE_APPLY_PHASES.has(phase)) {
    if (c !== 0 || compensation !== null) malformed(phase);
    return;
  }
  switch (phase) {
    case "applied":
      if (c >= n || compensation !== null) malformed(phase);
      return;
    case "verified":
    case "finalized":
      if (c !== n || compensation !== null) malformed(phase);
      return;
    case "compensating":
      if (c > n || compensation === null || compensation >= c) malformed(phase);
      return;
    case "rolled_back":
      if (c > n || compensation !== -1) malformed(phase);
      return;
    default:
      malformed("phase");
  }
}

function launchdEffectTerminal(journal: unknown): LifecycleEffectTerminalV1 {
  const phase = (journal as LaunchdEffectJournalV1).phase;
  return phase === "finalized" || phase === "rolled_back" ? phase : null;
}

/**
 * Every plan with a transition may bootstrap: forward for `after_files`, as compensation for
 * `before_files`. Only such a plan owns the one linked snapshot leaf in `tmp`, retained only to
 * recognise residue from builds before D82, which no longer create it.
 */
function launchdEffectStagingChildren(plan: unknown): readonly string[] {
  const { transitions } = plan as LaunchdEffectPlanV1;
  return transitions.length === 0 ? [] : ["tmp", LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD];
}

const PLAN_CODEC: LifecycleValueCodec<LaunchdEffectPlanV1> = {
  validate: validateLaunchdEffectPlan,
  encode: encodeLaunchdEffectPlan,
};

const JOURNAL_CODEC: LifecycleValueCodec<LaunchdEffectJournalV1> = {
  validate: validateLaunchdEffectJournal,
  encode: encodeLaunchdEffectJournal,
};

/** Task 1's ledger seam: the ledger binds id, coordinatorId and planHash itself. */
export const LAUNCHD_EFFECT_LEDGER_CODEC: LifecycleEffectLedgerCodecV1 = Object.freeze({
  plan: PLAN_CODEC,
  journal: JOURNAL_CODEC,
  terminal: launchdEffectTerminal,
  stagingChildren: launchdEffectStagingChildren,
});

/** What the executor needs from durable storage; `LaunchdEffectJournalStore` is the guarded one. */
export interface LaunchdEffectJournalPortV1 {
  readPlan(ref: LifecycleEffectRefV1<string>): Promise<LaunchdEffectPlanV1>;
  readJournal(plan: LaunchdEffectPlanV1): Promise<LaunchdEffectJournalV1 | null>;
  /** `current === null` creates the journal no-replace; otherwise `current` must be what is on disk. */
  writeJournal(plan: LaunchdEffectPlanV1, current: LaunchdEffectJournalV1 | null, next: LaunchdEffectJournalV1): Promise<void>;
  lock(plan: LaunchdEffectPlanV1): Promise<TransactionLockHandle>;
  /** Removes the terminal journal, lock, plan and the exact empty `launchd-process` tree. */
  compact(plan: LaunchdEffectPlanV1): Promise<void>;
}

export interface LaunchdEffectJournalStoreDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
  readonly locks: TransactionLockProvider;
  readonly uuid: () => string;
}

const LOWERCASE_V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function child(directory: CanonicalAbsolutePathV1, name: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${directory}/${name}`);
}

function lifecycleParent(path: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
}

/**
 * The guarded `state/launchd-effect-journals` leaves of one effect: `<id>.plan.json` (published
 * once, before coordinator intent), `<id>.json` (created no-replace, then rewritten through a
 * synced temp and an identity-checked rename) and the stable `.<id>.lock`.
 */
export class LaunchdEffectJournalStore implements LaunchdEffectJournalPortV1 {
  readonly #dependencies: LaunchdEffectJournalStoreDependenciesV1;

  constructor(dependencies: LaunchdEffectJournalStoreDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async publishPlan(plan: LaunchdEffectPlanV1): Promise<LowerHexSha256> {
    const validated = validateLaunchdEffectPlan(plan);
    const bytes = encoder.encode(encodeLaunchdEffectPlan(validated));
    if (bytes.byteLength > MAX_PLAN_BYTES) refuse("LaunchdEffectPlanV1: plan too large");
    const root = await this.#root();
    const path = this.#path(validated.id, ".plan.json");
    if ((await this.#dependencies.fs.lstat(path)) !== null) refuseLifecycleRecovery("lifecycle_effect_plan_exists", path);
    const temp = await this.#dependencies.fs.writeExclusive(this.#tempPath(validated.id, ".plan.json"), bytes);
    await this.#dependencies.fs.renameNoReplace(temp, path);
    await this.#dependencies.fs.syncDirectory(root);
    return launchdEffectPlanHash(validated);
  }

  async readPlan(ref: LifecycleEffectRefV1<string>): Promise<LaunchdEffectPlanV1> {
    const id = parseLaunchdEffectId(ref.id);
    const path = this.#path(id, ".plan.json");
    const text = await this.#readText(path, MAX_PLAN_BYTES, "lifecycle_effect_plan_shape");
    let plan: LaunchdEffectPlanV1;
    try {
      plan = validateLaunchdEffectPlan(decodeCanonicalJson(encoder.encode(text), MAX_PLAN_BYTES));
    } catch {
      return refuseLifecycleRecovery("lifecycle_effect_plan_bytes", path);
    }
    if (encodeLaunchdEffectPlan(plan) !== text || plan.id !== id) refuseLifecycleRecovery("lifecycle_effect_plan_bytes", path);
    if (launchdEffectPlanHash(plan) !== ref.planHash) refuseLifecycleRecovery("lifecycle_effect_plan_hash", path);
    return plan;
  }

  async readJournal(plan: LaunchdEffectPlanV1): Promise<LaunchdEffectJournalV1 | null> {
    const path = this.#path(plan.id, ".json");
    if ((await this.#dependencies.fs.lstat(path)) === null) return null;
    const text = await this.#readText(path, plan.maximumJournalBytes, "lifecycle_effect_journal_shape");
    let journal: LaunchdEffectJournalV1;
    try {
      journal = validateLaunchdEffectJournal(decodeCanonicalJson(encoder.encode(text), plan.maximumJournalBytes));
    } catch {
      return refuseLifecycleRecovery("lifecycle_effect_journal_bytes", path);
    }
    if (encodeLaunchdEffectJournal(journal) !== text) refuseLifecycleRecovery("lifecycle_effect_journal_bytes", path);
    validateLaunchdEffectJournalForPlan(plan, journal);
    return journal;
  }

  async writeJournal(plan: LaunchdEffectPlanV1, current: LaunchdEffectJournalV1 | null, next: LaunchdEffectJournalV1): Promise<void> {
    validateLaunchdEffectJournalForPlan(plan, next);
    const bytes = encoder.encode(encodeLaunchdEffectJournal(next));
    if (bytes.byteLength > plan.maximumJournalBytes || bytes.byteLength > MAX_LAUNCHD_EFFECT_JOURNAL_BYTES) {
      refuseLifecycleRecovery("lifecycle_effect_journal_too_large", this.#path(plan.id, ".json"));
    }
    const { fs } = this.#dependencies;
    const root = await this.#root();
    const path = this.#path(plan.id, ".json");
    const final = await fs.lstat(path);
    if (current === null) {
      if (final !== null) refuseLifecycleRecovery("lifecycle_effect_journal_exists", path);
      const temp = await fs.writeExclusive(this.#tempPath(plan.id, ".json"), bytes);
      await fs.renameNoReplace(temp, path);
    } else {
      if (final === null) refuseLifecycleRecovery("lifecycle_effect_journal_missing", path);
      const onDisk = decoder.decode(await fs.readRegular(this.#requireLeaf(final, plan.maximumJournalBytes, "lifecycle_effect_journal_shape"), plan.maximumJournalBytes));
      if (onDisk !== encodeLaunchdEffectJournal(current)) refuseLifecycleRecovery("lifecycle_effect_journal_stale", path);
      const temp = await fs.writeExclusive(this.#tempPath(plan.id, ".json"), bytes);
      await fs.renameOver(temp, final);
    }
    await fs.syncDirectory(root);
  }

  lock(plan: LaunchdEffectPlanV1): Promise<TransactionLockHandle> {
    return this.#dependencies.locks.acquire(this.#lockPath(plan.id));
  }

  async compact(plan: LaunchdEffectPlanV1): Promise<void> {
    const { fs, roots } = this.#dependencies;
    const journal = await this.readJournal(plan);
    if (journal !== null && launchdEffectTerminal(journal) === null) {
      refuseLifecycleRecovery("lifecycle_effect_not_terminal", this.#path(plan.id, ".json"));
    }
    // Core's coordinator-staging entry removes only `foundation/` and the coordinator directory, so
    // the effect that owned `launchd-process` removes its exact empty tree child-first (spec §2.4).
    const processRoot = child(child(roots.lifecycleStaging, plan.coordinatorId), "launchd-process");
    const tree = await this.#emptyProcessTree(processRoot);
    for (const path of [this.#path(plan.id, ".json"), this.#lockPath(plan.id), this.#path(plan.id, ".plan.json")]) {
      const entry = await fs.lstat(path);
      if (entry === null) continue;
      await fs.unlinkExact(entry);
      await fs.syncDirectory(await this.#root());
    }
    for (const entry of tree) {
      await fs.rmdirExactEmpty(entry);
      const parent = await fs.lstat(lifecycleParent(entry.path));
      if (parent !== null) await fs.syncDirectory(parent);
    }
  }

  /**
   * The removable `launchd-process` tree, children first, proved empty before anything is removed:
   * an unknown child, a leftover snapshot or a non-directory is preserved as recovery-required.
   */
  async #emptyProcessTree(processRoot: CanonicalAbsolutePathV1): Promise<readonly LifecycleGuardedEntryV1[]> {
    const { fs } = this.#dependencies;
    const root = await fs.lstat(processRoot);
    if (root === null) return [];
    const tree: LifecycleGuardedEntryV1[] = [];
    for await (const name of fs.names(this.#requireDirectory(root))) {
      if (!(LAUNCHD_PROCESS_STAGING_CHILDREN as readonly string[]).includes(name)) refuseLifecycleRecovery("launchd_process_staging_changed", processRoot);
      const entry = this.#requireDirectory((await fs.lstat(child(processRoot, name))) ?? refuseLifecycleRecovery("launchd_process_staging_changed", processRoot));
      for await (const leaf of fs.names(entry)) refuseLifecycleRecovery("launchd_process_staging_not_empty", child(entry.path, leaf));
      tree.push(entry);
    }
    return [...tree, root];
  }

  #path(id: string, suffix: ".json" | ".plan.json"): CanonicalAbsolutePathV1 {
    return child(this.#dependencies.roots.launchdEffectJournals, `${id}${suffix}`);
  }

  #lockPath(id: string): CanonicalAbsolutePathV1 {
    return child(this.#dependencies.roots.launchdEffectJournals, `.${id}.lock`);
  }

  #tempPath(id: string, suffix: string): CanonicalAbsolutePathV1 {
    const uuid = this.#dependencies.uuid();
    if (!LOWERCASE_V4_UUID.test(uuid)) throw new Error("invalid launchd effect temporary uuid");
    return child(this.#dependencies.roots.launchdEffectJournals, `.${id}.${uuid}${suffix}.tmp`);
  }

  async #root(): Promise<LifecycleGuardedEntryV1> {
    const path = this.#dependencies.roots.launchdEffectJournals;
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return refuseLifecycleRecovery("lifecycle_effect_root_missing", path);
    return this.#requireDirectory(entry);
  }

  #requireDirectory(entry: LifecycleGuardedEntryV1): LifecycleGuardedEntryV1 {
    if (entry.kind !== "directory" || entry.mode !== 0o700) refuseLifecycleRecovery("lifecycle_staging_shape", entry.path);
    return entry;
  }

  #requireLeaf(entry: LifecycleGuardedEntryV1, maximumBytes: number, reason: string): LifecycleGuardedEntryV1 {
    if (entry.kind !== "regular_file" || entry.mode !== 0o600 || entry.nlink !== 1 || BigInt(entry.size) > BigInt(maximumBytes)) {
      refuseLifecycleRecovery(reason, entry.path);
    }
    return entry;
  }

  async #readText(path: CanonicalAbsolutePathV1, maximumBytes: number, reason: string): Promise<string> {
    const entry = await this.#dependencies.fs.lstat(path);
    if (entry === null) return refuseLifecycleRecovery(reason, path);
    const bytes = await this.#dependencies.fs.readRegular(this.#requireLeaf(entry, maximumBytes, reason), maximumBytes);
    try {
      return decoder.decode(bytes);
    } catch {
      return refuseLifecycleRecovery(reason, path);
    }
  }
}
