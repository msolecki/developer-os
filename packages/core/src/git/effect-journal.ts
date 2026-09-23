/**
 * Spec 1 §2.4's `GitEffectPlanV1` and `GitEffectJournalV1`: the strict
 * validators, the exact journal-size feasibility bound, and the ledger codec
 * through which closure reads the Git effect root. The codec checks only what
 * a journal proves on its own; the plan-bound half of the phase table is
 * `assertGitEffectJournalForPlan`, which the executor applies at every reopen.
 */
import type { ValidatedGitBranchV1 } from "../config/lifecycle.js";
import { encodeCanonicalJson, hashCanonicalJson, type CanonicalJsonV1, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import {
  GIT_EFFECT_STAGING_SIDES,
  MAX_GIT_EFFECT_JOURNAL_BYTES,
  type GitEffectStagingSideV1,
  type LifecycleEffectLedgerCodecV1,
  type LifecycleEffectTerminalV1,
} from "../lifecycle/effect-ledger.js";
import { parseGitEffectId, parseLifecycleCoordinatorId, type GitEffectIdV1 } from "../lifecycle/ids.js";
import { LIFECYCLE_HASH_DOMAINS } from "../lifecycle/types.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUtcTimestamp,
  type LowerHexSha256,
  type UtcTimestampV1,
} from "../update/scalars.js";
import {
  GIT_SYNC_CARDINALITY,
  assertGitSyncSourceTransitions,
  validateGitEffectTransition,
  type GitEffectTransitionRoleV1,
  type GitEffectTransitionV1,
} from "./planner.js";
import { initialGitDirectoryPaths } from "./repository.js";
import {
  GIT_ZERO_OID,
  validateGitPackReaderBudget,
  validateGitReflogPlan,
  validateGitRelinquishedDirectoryRoot,
  validateGitSourceState,
  validateGuardedGitPathState,
  type GitPackReaderBudgetV1,
  type GitReflogAppendV1,
  type GitReflogPlanV1,
  type GitRelinquishedDirectoryRootV1,
  type GitSemanticStateV1,
  type GitSourceStateV1,
  type GuardedGitPathStateV1,
  type PlannedGitPathStateV1,
} from "./types.js";

export const GIT_EFFECT_PHASES = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified",
  "compensating",
  "finalized",
  "rolled_back",
] as const;
export type GitEffectPhaseV1 = (typeof GIT_EFFECT_PHASES)[number];

export const GIT_EFFECT_OUTCOMES = [
  "created",
  "replaced",
  "removed",
  "reused",
  "relinquished_created_object",
  "relinquished_created_git_tree",
] as const;
export type GitEffectOutcomeV1 = (typeof GIT_EFFECT_OUTCOMES)[number];

export const GIT_EFFECT_MATCHED_IDENTITIES = ["staged_postimage", "planned_preimage", "published_root_identity"] as const;
export type GitEffectMatchedIdentityV1 = (typeof GIT_EFFECT_MATCHED_IDENTITIES)[number];

/** §2.4's first reverse exception: a created object, pack or pack index is relinquished, never renamed. */
export const GIT_EFFECT_RELINQUISHABLE_OBJECT_ROLES: readonly GitEffectTransitionRoleV1[] = Object.freeze([
  "source_object",
  "destination_pack",
  "destination_index",
]);

export interface GitEffectObservationV1 {
  readonly transitionIndex: number;
  readonly outcome: GitEffectOutcomeV1;
  readonly observedAfter: GuardedGitPathStateV1 | GitRelinquishedDirectoryRootV1;
  readonly matchedIdentity: GitEffectMatchedIdentityV1;
}

export interface GitEffectPlanV1 {
  readonly schemaVersion: 1;
  readonly id: GitEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly side: GitEffectStagingSideV1;
  readonly worktreeRoot: CanonicalAbsolutePathV1 | null;
  readonly gitDirectory: CanonicalAbsolutePathV1;
  readonly quarantineRoot: CanonicalAbsolutePathV1;
  readonly processTableHash: LowerHexSha256;
  readonly planningTranscriptHash: LowerHexSha256;
  readonly reflogPlan: GitReflogPlanV1 | null;
  readonly packReaderBudget: GitPackReaderBudgetV1 | null;
  readonly maximumJournalBytes: number;
  readonly pushSourceProjection: { readonly before: GitSourceStateV1; readonly after: GitSourceStateV1 } | null;
  readonly transitions: readonly GitEffectTransitionV1[];
}

export interface GitEffectJournalV1 {
  readonly schemaVersion: 1;
  readonly id: GitEffectIdV1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly phase: GitEffectPhaseV1;
  readonly planHash: LowerHexSha256;
  readonly nextTransition: number;
  readonly compensationNext: number | null;
  readonly observations: readonly GitEffectObservationV1[];
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

const MAX_TRANSITIONS = GIT_SYNC_CARDINALITY.maxGitEffectTransitions;
const PRE_APPLY_PHASES: readonly GitEffectPhaseV1[] = ["planned", "backed_up", "staged", "validated"];
const WIDEST_HASH = "f".repeat(64) as LowerHexSha256;
const WIDEST_TIMESTAMP = "2026-09-19T00:00:00.000Z" as UtcTimestampV1;
const WIDEST_UID = 4_294_967_295;
const WIDEST_MODE = 4095;
const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

function list(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(label);
  return value as readonly unknown[];
}

function literal<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) fail(label);
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function nullable<T>(value: unknown, parse: (input: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function json(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(json(left)) === encodeCanonicalJson(json(right));
}

/** Canonical bytes without the encoder's trailing LF, for summing array members. */
function memberBytes(value: unknown): number {
  return encoder.encode(encodeCanonicalJson(json(value))).byteLength - 1;
}

function within(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

export function gitEffectEvidencePath(
  plan: Pick<GitEffectPlanV1, "quarantineRoot">,
  root: "post" | "before" | "after",
  index: number,
): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${plan.quarantineRoot}/${root}/${index.toString(10)}`);
}

export function isRelinquishableGitCreate(transition: GitEffectTransitionV1): boolean {
  return (
    transition.operation === "create" &&
    (transition.role === "source_git_directory_tree" || GIT_EFFECT_RELINQUISHABLE_OBJECT_ROLES.includes(transition.role))
  );
}

function expectedSemanticKind(role: GitEffectTransitionRoleV1): GitSemanticStateV1["kind"] {
  if (role === "source_head") return "symbolic_ref";
  if (role === "source_branch_ref" || role === "destination_ref") return "oid";
  return "none";
}

function plannedMatchesGuarded(planned: PlannedGitPathStateV1, guarded: GuardedGitPathStateV1): boolean {
  if (planned.state === "absent" || guarded.state === "absent") return planned.state === guarded.state;
  if (planned.state === "regular_file" && guarded.state === "regular_file") {
    return (
      planned.hash === guarded.hash &&
      planned.size === guarded.size &&
      planned.mode === guarded.mode &&
      sameJson(planned.semantic, guarded.semantic)
    );
  }
  if (planned.state === "directory_tree" && guarded.state === "directory_tree") {
    return (
      planned.treeHash === guarded.treeHash &&
      planned.entryCount === guarded.entryCount &&
      planned.ownerUid === guarded.ownerUid &&
      planned.mode === guarded.mode &&
      planned.symbolicHead === guarded.symbolicHead
    );
  }
  return false;
}

function assertTransitionShape(
  label: string,
  plan: Pick<GitEffectPlanV1, "side" | "gitDirectory" | "quarantineRoot">,
  transition: GitEffectTransitionV1,
  index: number,
): void {
  const at = `${label}.transitions[${index.toString(10)}]`;
  if (!transition.role.startsWith(`${plan.side}_`)) fail(`${at}.role: side`);
  const tree = transition.role === "source_git_directory_tree";
  if (tree) {
    if (transition.path !== plan.gitDirectory || transition.operation !== "create") fail(`${at}: git directory tree`);
    if (transition.after.state !== "directory_tree") fail(`${at}.after`);
  } else if (!transition.path.startsWith(`${plan.gitDirectory}/`)) {
    fail(`${at}.path: containment`);
  }
  const states = [transition.before, transition.after, transition.evidence.stagedPostimage];
  for (const state of states) {
    if (state === null || state.state === "absent") continue;
    if ((state.state === "directory_tree") !== tree) fail(`${at}: directory tree role`);
    if (state.state === "regular_file" && state.semantic.kind !== expectedSemanticKind(transition.role)) {
      fail(`${at}: semantic`);
    }
  }
  if (transition.operation === "reuse") {
    if (!GIT_EFFECT_RELINQUISHABLE_OBJECT_ROLES.includes(transition.role)) fail(`${at}: reuse role`);
    if (!plannedMatchesGuarded(transition.after, transition.before)) fail(`${at}: reuse state`);
  }
  const { evidence } = transition;
  const staged = transition.operation !== "reuse" && transition.after.state !== "absent";
  if (staged) {
    if (evidence.stagedPostimagePath !== gitEffectEvidencePath(plan, "post", index)) fail(`${at}.evidence.stagedPostimagePath`);
    if (evidence.stagedPostimage === null || !plannedMatchesGuarded(transition.after, evidence.stagedPostimage)) {
      fail(`${at}.evidence.stagedPostimage`);
    }
  } else if (evidence.stagedPostimagePath !== null) {
    fail(`${at}.evidence.stagedPostimagePath`);
  }
  const beforeTombstone = transition.operation === "replace" || transition.operation === "remove";
  const expectedBefore = beforeTombstone ? gitEffectEvidencePath(plan, "before", index) : null;
  if (evidence.beforeTombstonePath !== expectedBefore) fail(`${at}.evidence.beforeTombstonePath`);
  const afterTombstone =
    transition.operation === "replace" || (transition.operation === "create" && !isRelinquishableGitCreate(transition));
  const expectedAfter = afterTombstone ? gitEffectEvidencePath(plan, "after", index) : null;
  if (evidence.afterTombstonePath !== expectedAfter) fail(`${at}.evidence.afterTombstonePath`);
}

function reflogAppends(reflogPlan: GitReflogPlanV1 | null): readonly GitReflogAppendV1[] {
  if (reflogPlan === null) return [];
  const members = reflogPlan.side === "source" ? [reflogPlan.head, reflogPlan.branch] : [reflogPlan.branch];
  return members.filter((append): append is GitReflogAppendV1 => append !== null);
}

const REFLOG_ROLES: readonly GitEffectTransitionRoleV1[] = [
  "source_head_reflog",
  "source_branch_reflog",
  "destination_branch_reflog",
];

/**
 * §2.4: every append binds exactly one reflog transition of its role and path,
 * its preimage selects create or replace, its postimage is the planned one, and
 * its OIDs are the controlling ref's old and new values.
 */
function assertReflogBijection(
  label: string,
  side: GitEffectStagingSideV1,
  transitions: readonly GitEffectTransitionV1[],
  reflogPlan: GitReflogPlanV1 | null,
): void {
  const appends = reflogAppends(reflogPlan);
  const logs = transitions.filter((transition) => REFLOG_ROLES.includes(transition.role));
  if (logs.length !== appends.length) fail(`${label}: reflog_bijection`);
  if (appends.length === 0) return;
  const ref = transitions.find((transition) => transition.role === (side === "source" ? "source_branch_ref" : "destination_ref"));
  if (ref === undefined || ref.after.state !== "regular_file" || ref.after.semantic.kind !== "oid") {
    fail(`${label}: reflog_bijection`);
  }
  const oldOid =
    ref.before.state === "regular_file" && ref.before.semantic.kind === "oid" ? ref.before.semantic.value : GIT_ZERO_OID;
  for (const append of appends) {
    const matches = logs.filter((log) => log.role === append.role);
    const log = matches[0];
    const preimageMatches =
      log !== undefined &&
      (append.before.state === "absent"
        ? log.operation === "create"
        : log.operation === "replace" &&
          log.before.state === "regular_file" &&
          log.before.hash === append.before.bytesHash &&
          log.before.size === append.before.size);
    if (
      matches.length !== 1 ||
      log === undefined ||
      log.path !== append.path ||
      !preimageMatches ||
      log.after.state !== "regular_file" ||
      log.after.hash !== append.after.bytesHash ||
      log.after.size !== append.after.size ||
      append.newOid !== ref.after.semantic.value ||
      append.oldOid !== oldOid
    ) {
      fail(`${label}: reflog_bijection`);
    }
  }
}

const DESTINATION_ROLE_RANK: Readonly<Partial<Record<GitEffectTransitionRoleV1, number>>> = {
  destination_pack: 0,
  destination_index: 0,
  destination_branch_reflog: 1,
  destination_ref: 2,
};

/**
 * Publication order is objects, then index, reflogs and ref, so the reverse
 * walk restores every control file before it reaches a relinquishable create.
 */
function assertTransitionOrder(label: string, plan: Omit<GitEffectPlanV1, "maximumJournalBytes">): void {
  const { transitions } = plan;
  if (plan.side === "source" && plan.reflogPlan !== null) {
    if (plan.reflogPlan.side !== "source") fail(`${label}.reflogPlan.side`);
    assertGitSyncSourceTransitions(transitions, plan.reflogPlan);
  }
  if (plan.side === "destination") {
    let rank = 0;
    for (const transition of transitions) {
      const next = DESTINATION_ROLE_RANK[transition.role] ?? 0;
      if (next < rank) fail(`${label}.transitions: order`);
      rank = next;
    }
  }
  let controlSeen = false;
  for (const transition of transitions) {
    if (isRelinquishableGitCreate(transition)) {
      if (controlSeen) fail(`${label}.transitions: relinquishable after control`);
    } else if (!GIT_EFFECT_RELINQUISHABLE_OBJECT_ROLES.includes(transition.role)) {
      controlSeen = true;
    }
  }
}

function expectedForwardObservation(transition: GitEffectTransitionV1, index: number): GitEffectObservationV1 {
  switch (transition.operation) {
    case "create":
    case "replace":
      return {
        transitionIndex: index,
        outcome: transition.operation === "create" ? "created" : "replaced",
        observedAfter: transition.evidence.stagedPostimage as GuardedGitPathStateV1,
        matchedIdentity: "staged_postimage",
      };
    case "remove":
      return { transitionIndex: index, outcome: "removed", observedAfter: { state: "absent" }, matchedIdentity: "planned_preimage" };
    case "reuse":
      return { transitionIndex: index, outcome: "reused", observedAfter: transition.before, matchedIdentity: "planned_preimage" };
  }
}

/** The forward observation §2.4 requires once transition `index` verifies. */
export function gitEffectForwardObservation(plan: GitEffectPlanV1, index: number): GitEffectObservationV1 {
  const transition = plan.transitions[index];
  if (transition === undefined) fail("GitEffectObservationV1.transitionIndex");
  return expectedForwardObservation(transition, index);
}

export function relinquishedObjectObservation(plan: GitEffectPlanV1, index: number): GitEffectObservationV1 {
  return { ...gitEffectForwardObservation(plan, index), outcome: "relinquished_created_object" };
}

export function relinquishedTreeObservation(
  plan: GitEffectPlanV1,
  index: number,
  observed: { readonly ownerUid: number; readonly mode: number },
): GitEffectObservationV1 {
  const staged = plan.transitions[index]?.evidence.stagedPostimage;
  if (staged === undefined || staged === null || staged.state !== "directory_tree") fail("GitEffectObservationV1: tree");
  return {
    transitionIndex: index,
    outcome: "relinquished_created_git_tree",
    observedAfter: {
      state: "relinquished_directory_root",
      dev: staged.dev,
      ino: staged.ino,
      observedOwnerUid: observed.ownerUid,
      observedMode: observed.mode,
    },
    matchedIdentity: "published_root_identity",
  };
}

function widestObservationBytes(transition: GitEffectTransitionV1, index: number): number {
  const forward = expectedForwardObservation(transition, index);
  let widest = memberBytes(forward);
  if (isRelinquishableGitCreate(transition)) {
    const staged = transition.evidence.stagedPostimage as GuardedGitPathStateV1 & { readonly dev: string; readonly ino: string };
    const relinquished: GitEffectObservationV1 =
      transition.role === "source_git_directory_tree"
        ? {
            transitionIndex: index,
            outcome: "relinquished_created_git_tree",
            observedAfter: {
              state: "relinquished_directory_root",
              dev: staged.dev,
              ino: staged.ino,
              observedOwnerUid: WIDEST_UID,
              observedMode: WIDEST_MODE,
            } as GitRelinquishedDirectoryRootV1,
            matchedIdentity: "published_root_identity",
          }
        : { ...forward, outcome: "relinquished_created_object" };
    widest = Math.max(widest, memberBytes(relinquished));
  }
  return widest;
}

/**
 * §2.4's exact feasibility proof for one Git effect journal: the widest legal
 * phase and cursors, fixed-width hash and timestamps, and for every transition
 * the widest outcome arm it can reach. Observations are summed rather than
 * encoded as one array, so 200,005 transitions cost one pass, not a 16-MiB string.
 */
export function maximumGitEffectJournalBytes(plan: Omit<GitEffectPlanV1, "maximumJournalBytes">): number {
  const count = plan.transitions.length;
  const skeleton: GitEffectJournalV1 = {
    schemaVersion: 1,
    id: plan.id,
    coordinatorId: plan.coordinatorId,
    phase: "compensating",
    planHash: WIDEST_HASH,
    nextTransition: count,
    compensationNext: count > 10 ? count - 1 : -1,
    observations: [],
    createdAt: WIDEST_TIMESTAMP,
    updatedAt: WIDEST_TIMESTAMP,
  };
  let total = encoder.encode(encodeCanonicalJson(json(skeleton))).byteLength;
  for (const [index, transition] of plan.transitions.entries()) {
    total += widestObservationBytes(transition, index) + (index === 0 ? 0 : 1);
  }
  return total;
}

const PLAN_KEYS = [
  "schemaVersion",
  "id",
  "coordinatorId",
  "side",
  "worktreeRoot",
  "gitDirectory",
  "quarantineRoot",
  "processTableHash",
  "planningTranscriptHash",
  "reflogPlan",
  "packReaderBudget",
  "maximumJournalBytes",
  "pushSourceProjection",
  "transitions",
] as const;

export function validateGitEffectPlan(value: unknown, effectiveUid: number): GitEffectPlanV1 {
  const label = "GitEffectPlanV1";
  const input = exact(value, PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const id = parseGitEffectId(input.id);
  const coordinatorId = parseLifecycleCoordinatorId(input.coordinatorId, null);
  const side = literal(input.side, GIT_EFFECT_STAGING_SIDES, `${label}.side`);
  const worktreeRoot = nullable(input.worktreeRoot, parseCanonicalAbsolutePathText);
  const gitDirectory = parseCanonicalAbsolutePathText(input.gitDirectory);
  if (side === "source" ? worktreeRoot === null || gitDirectory !== `${worktreeRoot}/.git` : worktreeRoot !== null) {
    fail(`${label}.gitDirectory`);
  }
  const quarantineRoot = parseCanonicalAbsolutePathText(input.quarantineRoot);
  if (!quarantineRoot.endsWith(`/staging/lifecycle/${coordinatorId}/git/${side}/${id}`)) fail(`${label}.quarantineRoot`);
  if (within(quarantineRoot, gitDirectory) || within(gitDirectory, quarantineRoot)) fail(`${label}.quarantineRoot: overlap`);
  const reflogPlan = nullable(input.reflogPlan, validateGitReflogPlan);
  if (reflogPlan !== null && reflogPlan.side !== side) fail(`${label}.reflogPlan.side`);
  const pushSourceProjection = nullable(input.pushSourceProjection, (projection) => {
    const pair = exact(projection, ["before", "after"], `${label}.pushSourceProjection`);
    return { before: validateGitSourceState(pair.before), after: validateGitSourceState(pair.after) };
  });
  if (pushSourceProjection !== null && side !== "source") fail(`${label}.pushSourceProjection`);
  const transitions = list(input.transitions, MAX_TRANSITIONS, `${label}.transitions`).map((transition) =>
    validateGitEffectTransition(transition, effectiveUid),
  );
  const unbound: Omit<GitEffectPlanV1, "maximumJournalBytes"> = {
    schemaVersion: 1,
    id,
    coordinatorId,
    side,
    worktreeRoot,
    gitDirectory,
    quarantineRoot,
    processTableHash: parseLowerHexSha256(input.processTableHash),
    planningTranscriptHash: parseLowerHexSha256(input.planningTranscriptHash),
    reflogPlan,
    packReaderBudget: nullable(input.packReaderBudget, validateGitPackReaderBudget),
    pushSourceProjection,
    transitions,
  };
  const paths = new Set<string>();
  for (const [index, transition] of transitions.entries()) {
    assertTransitionShape(label, unbound, transition, index);
    if (paths.has(transition.path)) fail(`${label}.transitions: duplicate path`);
    paths.add(transition.path);
  }
  assertReflogBijection(label, side, transitions, reflogPlan);
  assertTransitionOrder(label, unbound);
  const maximumJournalBytes = integer(input.maximumJournalBytes, 1, MAX_GIT_EFFECT_JOURNAL_BYTES, `${label}.maximumJournalBytes`);
  if (maximumJournalBytes !== maximumGitEffectJournalBytes(unbound)) fail(`${label}.maximumJournalBytes`);
  return { ...unbound, maximumJournalBytes };
}

export function gitEffectPlanHash(plan: GitEffectPlanV1): LowerHexSha256 {
  return hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.gitEffectPlan, json(plan));
}

function validateObservation(value: unknown, effectiveUid: number): GitEffectObservationV1 {
  const label = "GitEffectObservationV1";
  const input = exact(value, ["transitionIndex", "outcome", "observedAfter", "matchedIdentity"], label);
  const outcome = literal(input.outcome, GIT_EFFECT_OUTCOMES, `${label}.outcome`);
  const matchedIdentity = literal(input.matchedIdentity, GIT_EFFECT_MATCHED_IDENTITIES, `${label}.matchedIdentity`);
  const tree = outcome === "relinquished_created_git_tree";
  if (tree !== (matchedIdentity === "published_root_identity")) fail(`${label}.matchedIdentity`);
  return {
    transitionIndex: integer(input.transitionIndex, 0, MAX_TRANSITIONS - 1, `${label}.transitionIndex`),
    outcome,
    observedAfter: tree
      ? validateGitRelinquishedDirectoryRoot(input.observedAfter)
      : validateGuardedGitPathState(input.observedAfter, effectiveUid),
    matchedIdentity,
  };
}

const JOURNAL_KEYS = [
  "schemaVersion",
  "id",
  "coordinatorId",
  "phase",
  "planHash",
  "nextTransition",
  "compensationNext",
  "observations",
  "createdAt",
  "updatedAt",
] as const;

/** The plan-independent rows of §2.4's exhaustive phase/cursor/observation table. */
export function validateGitEffectJournal(value: unknown, effectiveUid: number): GitEffectJournalV1 {
  const label = "GitEffectJournalV1";
  const input = exact(value, JOURNAL_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  const phase = literal(input.phase, GIT_EFFECT_PHASES, `${label}.phase`);
  const nextTransition = integer(input.nextTransition, 0, MAX_TRANSITIONS, `${label}.nextTransition`);
  const compensationNext = nullable(input.compensationNext, (next) =>
    integer(next, -1, MAX_TRANSITIONS - 1, `${label}.compensationNext`),
  );
  const observations = list(input.observations, MAX_TRANSITIONS, `${label}.observations`).map((observation) =>
    validateObservation(observation, effectiveUid),
  );
  if (observations.length !== nextTransition) fail(`${label}.observations: cursor`);
  for (const [index, observation] of observations.entries()) {
    if (observation.transitionIndex !== index) fail(`${label}.observations: contiguity`);
  }
  const reversing = phase === "compensating" || phase === "rolled_back";
  if (PRE_APPLY_PHASES.includes(phase) && nextTransition !== 0) fail(`${label}.nextTransition`);
  if (!reversing && compensationNext !== null) fail(`${label}.compensationNext`);
  if (phase === "compensating" && (compensationNext === null || compensationNext >= nextTransition)) {
    fail(`${label}.compensationNext`);
  }
  if (phase === "rolled_back" && compensationNext !== -1) fail(`${label}.compensationNext`);
  for (const observation of observations) {
    const relinquished =
      observation.outcome === "relinquished_created_object" || observation.outcome === "relinquished_created_git_tree";
    if (relinquished && (!reversing || observation.transitionIndex <= (compensationNext ?? -1))) {
      fail(`${label}.observations: relinquished outside the reverse suffix`);
    }
  }
  return {
    schemaVersion: 1,
    id: parseGitEffectId(input.id),
    coordinatorId: parseLifecycleCoordinatorId(input.coordinatorId, null),
    phase,
    planHash: parseLowerHexSha256(input.planHash),
    nextTransition,
    compensationNext,
    observations,
    createdAt: parseUtcTimestamp(input.createdAt),
    updatedAt: parseUtcTimestamp(input.updatedAt),
  };
}

/**
 * The plan-bound rows: `applied` stops short of `n`, `verified` and
 * `finalized` reach it, and every observation is exactly the verified forward
 * post-state or, behind the reverse cursor, the one relinquished rewrite its
 * transition admits.
 */
export function assertGitEffectJournalForPlan(plan: GitEffectPlanV1, journal: GitEffectJournalV1): void {
  const label = "GitEffectJournalV1";
  if (journal.id !== plan.id || journal.coordinatorId !== plan.coordinatorId) fail(`${label}: identity`);
  const count = plan.transitions.length;
  const cursor = journal.nextTransition;
  if (cursor > count) fail(`${label}.nextTransition`);
  if (journal.phase === "applied" && cursor >= count) fail(`${label}.nextTransition`);
  if ((journal.phase === "verified" || journal.phase === "finalized") && cursor !== count) fail(`${label}.nextTransition`);
  for (const [index, observation] of journal.observations.entries()) {
    const transition = plan.transitions[index] as GitEffectTransitionV1;
    const forward = expectedForwardObservation(transition, index);
    if (observation.outcome === "relinquished_created_object") {
      if (!isRelinquishableGitCreate(transition) || transition.role === "source_git_directory_tree") {
        fail(`${label}.observations: relinquished role`);
      }
      if (!sameJson(observation, { ...forward, outcome: "relinquished_created_object" })) fail(`${label}.observations`);
      continue;
    }
    if (observation.outcome === "relinquished_created_git_tree") {
      const staged = transition.evidence.stagedPostimage;
      const root = observation.observedAfter;
      if (
        transition.role !== "source_git_directory_tree" ||
        staged === null ||
        staged.state !== "directory_tree" ||
        root.state !== "relinquished_directory_root" ||
        root.dev !== staged.dev ||
        root.ino !== staged.ino
      ) {
        fail(`${label}.observations: relinquished tree`);
      }
      continue;
    }
    if (!sameJson(observation, forward)) fail(`${label}.observations`);
  }
}

export function gitEffectTerminal(journal: GitEffectJournalV1): LifecycleEffectTerminalV1 {
  return journal.phase === "finalized" || journal.phase === "rolled_back" ? journal.phase : null;
}

/** Every evidence root and leaf the plan may create below its quarantine, parents first. */
export function gitEffectStagingChildren(plan: GitEffectPlanV1): readonly string[] {
  const children = new Set<string>();
  for (const [index, transition] of plan.transitions.entries()) {
    const { evidence } = transition;
    const roots = [
      ["post", evidence.stagedPostimagePath],
      ["before", evidence.beforeTombstonePath],
      ["after", evidence.afterTombstonePath],
    ] as const;
    for (const [root, path] of roots) {
      if (path === null) continue;
      children.add(root);
      children.add(`${root}/${index.toString(10)}`);
    }
    const staged = evidence.stagedPostimage;
    if (transition.role === "source_git_directory_tree" && staged?.state === "directory_tree") {
      const branch = staged.symbolicHead.slice("refs/heads/".length) as ValidatedGitBranchV1;
      for (const relative of initialGitDirectoryPaths(branch)) children.add(`post/${index.toString(10)}/${relative}`);
    }
  }
  return [...children];
}

function encode(value: unknown): CanonicalJsonV1 {
  return encodeCanonicalJson(json(value));
}

/**
 * `GitEffectPlanV1` binds `EffectiveUidV1` in every tree state, so the ledger
 * codec cannot be a uid-free constant: the composition root builds it with the
 * same effective uid its ledger dependencies already carry.
 */
export function createGitEffectLedgerCodec(effectiveUid: number): LifecycleEffectLedgerCodecV1 {
  return Object.freeze({
    plan: Object.freeze({ validate: (value: unknown): unknown => validateGitEffectPlan(value, effectiveUid), encode }),
    journal: Object.freeze({ validate: (value: unknown): unknown => validateGitEffectJournal(value, effectiveUid), encode }),
    terminal: (journal: unknown): LifecycleEffectTerminalV1 => gitEffectTerminal(journal as GitEffectJournalV1),
    stagingChildren: (plan: unknown): readonly string[] => gitEffectStagingChildren(plan as GitEffectPlanV1),
  });
}
