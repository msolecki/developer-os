import type { LifecycleActivationArmV1 } from "../config/lifecycle.js";
import type { LowerHexSha256 } from "../update/scalars.js";
import type { LifecycleIdPrefixV1 } from "./ids.js";
import {
  LIFECYCLE_PLAN_BOUNDS,
  type LIFECYCLE_MANIFEST_STEP_TRANSITIONS,
  type LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS,
  type FoundationParticipantRefV1,
  type FoundationParticipantSlotV1,
  type LifecycleCompactionEntryV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorOperationV1,
  type LifecycleCoordinatorPhaseV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
  type LifecycleEffectRefV1,
  type LifecycleTerminalCompactionV1,
  type LifecycleTerminalOutcomeV1,
} from "./types.js";

export type LifecycleOperationVariantV1 =
  | "git_enable"
  | "git_reconcile"
  | "git_disable"
  | "git_sync/no_changes"
  | "git_sync/new_network"
  | "git_sync/existing_network"
  | "git_sync/new_local"
  | "git_sync/existing_local"
  | "automation_enable"
  | "automation_reconcile/files"
  | "automation_reconcile/live_only"
  | "automation_disable"
  | "uninstall/present_manifest"
  | "uninstall/present_manifest_without_launchd";

export type LifecycleStepTemplateV1 =
  | { readonly kind: "F"; readonly slot: FoundationParticipantSlotV1 }
  | { readonly kind: "M"; readonly transition: (typeof LIFECYCLE_MANIFEST_STEP_TRANSITIONS)[number] }
  | { readonly kind: "S" }
  | { readonly kind: "D" }
  | { readonly kind: "P" }
  | { readonly kind: "Q" }
  | { readonly kind: "K"; readonly transition: (typeof LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS)[number] }
  | { readonly kind: "N" }
  | { readonly kind: "R" };

/** The "required recovery after it" column of Spec 1 §2.4's point-of-no-return table, verbatim. */
export type LifecycleRequiredRecoveryV1 =
  | "finalize verified effects and manifest tombstones"
  | "terminal compaction only"
  | "finalize `S`; retry/finish the exact bound destination, then sync record"
  | "write the exact sync record"
  | "finalize `D`; write the exact sync record"
  | "finalize verified launchd effects and manifest tombstones"
  | "finalize `Q`, then terminal compaction"
  | "finalize prior effects, delete the staged key, and finalize tombstones"
  | "delete the staged key and finalize tombstones";

export type LifecyclePointOfNoReturnV1 = (
  | { readonly kind: "terminal_foundation"; readonly slot: FoundationParticipantSlotV1 }
  | { readonly kind: "effect_verified"; readonly step: "S" | "D" | "Q" }
  | { readonly kind: "push_succeeded" }
  | { readonly kind: "manifest_commit_absence" }
) & { readonly recovery: LifecycleRequiredRecoveryV1 };

export interface LifecycleVariantFactsV1 {
  readonly gitSync: null | {
    readonly newCommit: boolean;
    readonly transport: "network" | "local";
    readonly noChanges: boolean;
  };
  readonly automationReconcile: null | "files" | "live_only";
  /** A14: true when the manifest owns a plist, the config has `automation.lifecycle`, or the activation automation arm is `active`. */
  readonly uninstallLaunchdEvidence: null | boolean;
}

/** A14's three evidence conditions, so the CLI derives `uninstallLaunchdEvidence` instead of paraphrasing them. */
export interface LifecycleUninstallLaunchdEvidenceV1 {
  /** The manifest owns at least one plist artifact among §6's closed external-plist rows. */
  readonly manifestOwnsPlist: boolean;
  /** The validated configuration carries an `automation.lifecycle` record. */
  readonly configHasAutomationLifecycle: boolean;
  /**
   * The activation record's `automation` arm, or null when the record is absent. A14: an activation
   * path that is not a guarded regular file is recovery-required, never absent, so planning must
   * refuse before it reaches this struct.
   */
  readonly activationAutomation: LifecycleActivationArmV1 | null;
}

export function deriveUninstallLaunchdEvidence(evidence: LifecycleUninstallLaunchdEvidenceV1): boolean {
  return (
    evidence.manifestOwnsPlist ||
    evidence.configHasAutomationLifecycle ||
    evidence.activationAutomation?.state === "active"
  );
}

export type LifecycleReservationSlotV1 = {
  readonly prefix: LifecycleIdPrefixV1;
  readonly role: string;
};

type CoordinatorPlan = LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function F(slot: FoundationParticipantSlotV1): LifecycleStepTemplateV1 {
  return { kind: "F", slot };
}

function M(transition: (typeof LIFECYCLE_MANIFEST_STEP_TRANSITIONS)[number]): LifecycleStepTemplateV1 {
  return { kind: "M", transition };
}

function K(transition: (typeof LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS)[number]): LifecycleStepTemplateV1 {
  return { kind: "K", transition };
}

const S: LifecycleStepTemplateV1 = { kind: "S" };
const D: LifecycleStepTemplateV1 = { kind: "D" };
const P: LifecycleStepTemplateV1 = { kind: "P" };
const Q: LifecycleStepTemplateV1 = { kind: "Q" };
const N: LifecycleStepTemplateV1 = { kind: "N" };
const R: LifecycleStepTemplateV1 = { kind: "R" };

const GIT_ENABLE_STEPS: readonly LifecycleStepTemplateV1[] = [
  M("preserve_before"),
  F("activation"),
  M("publish_after"),
  S,
  F("config"),
  M("finalize_tombstones"),
];

const UNINSTALL_SUFFIX: readonly LifecycleStepTemplateV1[] = [
  F("uninstall_artifacts"),
  K("stage"),
  M("preserve_before"),
  M("commit_absence"),
  K("delete"),
  M("finalize_tombstones"),
];

export const LIFECYCLE_STEP_GRAMMAR: Readonly<
  Record<LifecycleOperationVariantV1, readonly LifecycleStepTemplateV1[]>
> = {
  git_enable: GIT_ENABLE_STEPS,
  git_reconcile: GIT_ENABLE_STEPS,
  git_disable: [M("preserve_before"), F("activation"), M("publish_after"), F("config"), M("finalize_tombstones")],
  "git_sync/no_changes": [F("sync_record")],
  "git_sync/new_network": [S, N, F("sync_record")],
  "git_sync/existing_network": [N, F("sync_record")],
  "git_sync/new_local": [S, D, F("sync_record")],
  "git_sync/existing_local": [D, F("sync_record")],
  automation_enable: [
    M("preserve_before"),
    F("plist_files"),
    F("activation"),
    M("publish_after"),
    Q,
    F("config"),
    M("finalize_tombstones"),
  ],
  "automation_reconcile/files": [
    P,
    M("preserve_before"),
    F("plist_files"),
    F("activation"),
    M("publish_after"),
    Q,
    F("config"),
    M("finalize_tombstones"),
  ],
  "automation_reconcile/live_only": [Q],
  automation_disable: [
    P,
    M("preserve_before"),
    F("plist_files"),
    F("activation"),
    M("publish_after"),
    F("config"),
    M("finalize_tombstones"),
  ],
  "uninstall/present_manifest": [F("uninstall_marker"), P, R, ...UNINSTALL_SUFFIX],
  "uninstall/present_manifest_without_launchd": [F("uninstall_marker"), R, ...UNINSTALL_SUFFIX],
};

const GIT_TERMINAL_CONFIG: LifecyclePointOfNoReturnV1 = {
  kind: "terminal_foundation",
  slot: "config",
  recovery: "finalize verified effects and manifest tombstones",
};
const AUTOMATION_TERMINAL_CONFIG: LifecyclePointOfNoReturnV1 = {
  kind: "terminal_foundation",
  slot: "config",
  recovery: "finalize verified launchd effects and manifest tombstones",
};
const SOURCE_VERIFIED: LifecyclePointOfNoReturnV1 = {
  kind: "effect_verified",
  step: "S",
  recovery: "finalize `S`; retry/finish the exact bound destination, then sync record",
};

export const LIFECYCLE_POINT_OF_NO_RETURN: Readonly<
  Record<LifecycleOperationVariantV1, LifecyclePointOfNoReturnV1>
> = {
  git_enable: GIT_TERMINAL_CONFIG,
  git_reconcile: GIT_TERMINAL_CONFIG,
  git_disable: GIT_TERMINAL_CONFIG,
  "git_sync/no_changes": {
    kind: "terminal_foundation",
    slot: "sync_record",
    recovery: "terminal compaction only",
  },
  "git_sync/new_network": SOURCE_VERIFIED,
  "git_sync/existing_network": { kind: "push_succeeded", recovery: "write the exact sync record" },
  "git_sync/new_local": SOURCE_VERIFIED,
  "git_sync/existing_local": {
    kind: "effect_verified",
    step: "D",
    recovery: "finalize `D`; write the exact sync record",
  },
  automation_enable: AUTOMATION_TERMINAL_CONFIG,
  "automation_reconcile/files": AUTOMATION_TERMINAL_CONFIG,
  "automation_reconcile/live_only": {
    kind: "effect_verified",
    step: "Q",
    recovery: "finalize `Q`, then terminal compaction",
  },
  automation_disable: AUTOMATION_TERMINAL_CONFIG,
  "uninstall/present_manifest": {
    kind: "manifest_commit_absence",
    recovery: "finalize prior effects, delete the staged key, and finalize tombstones",
  },
  "uninstall/present_manifest_without_launchd": {
    kind: "manifest_commit_absence",
    recovery: "delete the staged key and finalize tombstones",
  },
};

const TEMPLATE_STEP_KINDS = {
  F: "foundation",
  M: "manifest",
  S: "source_git_effect",
  D: "destination_git_effect",
  P: "launchd_before_files",
  Q: "launchd_after_files",
  K: "redaction_key",
  N: "network_push",
  R: "drain_runners",
} as const satisfies Record<LifecycleStepTemplateV1["kind"], LifecycleCoordinatorStepV1["kind"]>;

/** The full `launchd` plan is non-null for exactly the three automation operations and `uninstall/present_manifest` (A14). */
const LAUNCHD_PLAN_VARIANTS: ReadonlySet<LifecycleOperationVariantV1> = new Set([
  "automation_enable",
  "automation_reconcile/files",
  "automation_reconcile/live_only",
  "automation_disable",
  "uninstall/present_manifest",
]);

function operationOfVariant(variant: LifecycleOperationVariantV1): LifecycleCoordinatorOperationV1 {
  const [operation] = variant.split("/");
  if (operation === undefined) fail(`LifecycleOperationVariantV1: ${variant}`);
  return operation as LifecycleCoordinatorOperationV1;
}

export function deriveLifecycleOperationVariant(
  plan: CoordinatorPlan,
  facts: LifecycleVariantFactsV1,
): LifecycleOperationVariantV1 {
  const label = "LifecycleVariantFactsV1";
  const operation = plan.operation;
  if ((facts.gitSync !== null) !== (operation === "git_sync")) fail(`${label}: gitSync`);
  if ((facts.automationReconcile !== null) !== (operation === "automation_reconcile")) {
    fail(`${label}: automationReconcile`);
  }
  if ((facts.uninstallLaunchdEvidence !== null) !== (operation === "uninstall")) {
    fail(`${label}: uninstallLaunchdEvidence`);
  }
  switch (operation) {
    case "git_enable":
    case "git_reconcile":
    case "git_disable":
    case "automation_enable":
    case "automation_disable":
      return operation;
    case "git_sync": {
      const sync = facts.gitSync;
      if (sync === null) fail(`${label}: gitSync`);
      if (sync.noChanges) {
        if (sync.newCommit) fail(`${label}: no_changes with a new candidate commit`);
        return "git_sync/no_changes";
      }
      if (sync.newCommit) {
        return sync.transport === "network" ? "git_sync/new_network" : "git_sync/new_local";
      }
      return sync.transport === "network" ? "git_sync/existing_network" : "git_sync/existing_local";
    }
    case "automation_reconcile": {
      const reconcile = facts.automationReconcile;
      if (reconcile === null) fail(`${label}: automationReconcile`);
      return reconcile === "files" ? "automation_reconcile/files" : "automation_reconcile/live_only";
    }
    case "uninstall": {
      const evidence = facts.uninstallLaunchdEvidence;
      if (evidence === null) fail(`${label}: uninstallLaunchdEvidence`);
      return evidence ? "uninstall/present_manifest" : "uninstall/present_manifest_without_launchd";
    }
  }
}

function stepMatchesTemplate(step: LifecycleCoordinatorStepV1, template: LifecycleStepTemplateV1): boolean {
  if (step.kind !== TEMPLATE_STEP_KINDS[template.kind]) return false;
  if (template.kind === "F") return step.kind === "foundation" && step.slot === template.slot;
  if (template.kind === "M") return step.kind === "manifest" && step.transition === template.transition;
  if (template.kind === "K") return step.kind === "redaction_key" && step.transition === template.transition;
  return true;
}

function stepIsPointOfNoReturn(
  step: LifecycleCoordinatorStepV1,
  boundary: LifecyclePointOfNoReturnV1,
): boolean {
  switch (boundary.kind) {
    case "terminal_foundation":
      return step.kind === "foundation" && step.slot === boundary.slot;
    case "effect_verified":
      return step.kind === TEMPLATE_STEP_KINDS[boundary.step];
    case "push_succeeded":
      return step.kind === "network_push";
    case "manifest_commit_absence":
      return step.kind === "manifest" && step.transition === "commit_absence";
  }
}

export function pointOfNoReturnStepIndex(
  variant: LifecycleOperationVariantV1,
  steps: readonly LifecycleCoordinatorStepV1[],
): number {
  const boundary = LIFECYCLE_POINT_OF_NO_RETURN[variant];
  let found = -1;
  for (const [index, step] of steps.entries()) {
    if (!stepIsPointOfNoReturn(step, boundary)) continue;
    if (found >= 0) fail(`${variant}: duplicate point-of-no-return step`);
    found = index;
  }
  if (found < 0) fail(`${variant}: point-of-no-return step`);
  return found;
}

export function derivedCoordinatorPhase(
  step: LifecycleCoordinatorStepV1,
): Exclude<
  LifecycleCoordinatorPhaseV1,
  "planned" | "push_pending" | "compensating" | "finalized" | "rolled_back" | "compacting"
> {
  switch (step.kind) {
    case "manifest":
      return "manifest_publishing";
    case "source_git_effect":
    case "destination_git_effect":
    case "launchd_before_files":
    case "launchd_after_files":
    case "network_push":
      return "external_applying";
    case "foundation":
      return step.slot === "config" ? "config_publishing" : "participants_applying";
    case "redaction_key":
    case "drain_runners":
      return "participants_applying";
  }
}

function requireFoundationBijection(plan: CoordinatorPlan, boundary: number, label: string): void {
  const byId = new Map<string, FoundationParticipantRefV1>();
  for (const ref of plan.participants.foundation) {
    if (byId.has(ref.id)) fail(`${label}: duplicate Foundation reference`);
    byId.set(ref.id, ref);
  }
  const referenced = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind !== "foundation") continue;
    const position = index.toString(10);
    const ref = byId.get(step.participantId);
    if (ref === undefined) fail(`${label}: step ${position} names an absent Foundation reference`);
    if (ref.role.kind !== "forward") fail(`${label}: step ${position} names a compensation reference`);
    if (ref.slot !== step.slot) fail(`${label}: step ${position} slot`);
    if (referenced.has(ref.id)) fail(`${label}: step ${position} duplicates a Foundation reference`);
    referenced.add(ref.id);
    const compensationId = ref.role.compensationId;
    if (index >= boundary) {
      if (compensationId !== null) fail(`${label}: step ${position} compensates past the point of no return`);
      continue;
    }
    if (compensationId === null) fail(`${label}: step ${position} has no compensation reference`);
    const compensation = byId.get(compensationId);
    if (compensation === undefined) fail(`${label}: step ${position} names an absent compensation reference`);
    if (compensation.role.kind !== "compensation" || compensation.role.forwardId !== ref.id) {
      fail(`${label}: step ${position} compensation binding`);
    }
    if (compensation.slot !== ref.slot) fail(`${label}: step ${position} compensation slot`);
    referenced.add(compensationId);
  }
  if (referenced.size !== plan.participants.foundation.length) fail(`${label}: unused Foundation reference`);
}

function effectStepIds(
  steps: readonly LifecycleCoordinatorStepV1[],
  kind: LifecycleCoordinatorStepV1["kind"],
): readonly string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.kind !== kind) continue;
    if (!("participantId" in step)) fail(`LifecycleCoordinatorStepV1: ${kind} participantId`);
    ids.push(step.participantId);
  }
  return ids;
}

function requireEffectArm(
  steps: readonly LifecycleCoordinatorStepV1[],
  kind: LifecycleCoordinatorStepV1["kind"],
  arm: LifecycleEffectRefV1<string> | null,
  label: string,
): void {
  const ids = effectStepIds(steps, kind);
  if (ids.length !== (arm === null ? 0 : 1)) fail(`${label}: ${kind} arm`);
  if (arm !== null && ids[0] !== arm.id) fail(`${label}: ${kind} identity`);
}

export function validateLifecyclePlanGrammar(
  plan: CoordinatorPlan,
  facts: LifecycleVariantFactsV1,
): LifecycleOperationVariantV1 {
  const variant = deriveLifecycleOperationVariant(plan, facts);
  const templates = LIFECYCLE_STEP_GRAMMAR[variant];
  const label = `LifecycleCoordinatorPlanV1 (${variant})`;
  if (plan.steps.length !== templates.length) fail(`${label}: steps length`);
  for (const [index, template] of templates.entries()) {
    const step = plan.steps[index];
    if (step === undefined || !stepMatchesTemplate(step, template)) {
      fail(`${label}: step ${index.toString(10)}`);
    }
  }
  requireFoundationBijection(plan, pointOfNoReturnStepIndex(variant, plan.steps), label);
  requireEffectArm(plan.steps, "source_git_effect", plan.participants.sourceGitEffect, label);
  requireEffectArm(plan.steps, "destination_git_effect", plan.participants.destinationGitEffect, label);
  requireEffectArm(plan.steps, "launchd_before_files", plan.participants.launchdBeforeFiles, label);
  requireEffectArm(plan.steps, "launchd_after_files", plan.participants.launchdAfterFiles, label);
  const has = (kind: LifecycleStepTemplateV1["kind"]): boolean =>
    templates.some((template) => template.kind === kind);
  if ((plan.participants.manifest !== null) !== has("M")) fail(`${label}: manifest arm`);
  if ((plan.participants.redactionKey !== null) !== has("K")) fail(`${label}: redaction key arm`);
  if ((plan.push !== null) !== (has("N") || has("D"))) fail(`${label}: push arm`);
  if ((plan.participants.launchd !== null) !== LAUNCHD_PLAN_VARIANTS.has(variant)) fail(`${label}: launchd arm`);
  const pushHashes = new Set<LowerHexSha256>();
  for (const step of plan.steps) {
    if (step.kind === "network_push" || step.kind === "destination_git_effect") pushHashes.add(step.pushPlanHash);
  }
  if (pushHashes.size > 1) fail(`${label}: pushPlanHash`);
  // A14 empties `plistPaths` for the derived variant, and `/files` "requires its real plist mutations"
  // as its discriminator from `/live_only`. §2.4 states no minimum for any other variant.
  if (variant === "uninstall/present_manifest_without_launchd" && plan.authority.plistPaths.length !== 0) {
    fail(`${label}: plistPaths`);
  }
  if (variant === "automation_reconcile/files" && plan.authority.plistPaths.length === 0) {
    fail(`${label}: plistPaths`);
  }
  return variant;
}

function requireFinalizedCursor(
  journal: LifecycleCoordinatorJournalV1,
  stepCount: number,
  label: string,
): void {
  if (journal.nextStep !== stepCount) fail(`${label}: finalized cursor`);
  if (journal.compensationNext !== null) fail(`${label}: finalized compensation cursor`);
}

function requireReversibleCursor(
  journal: LifecycleCoordinatorJournalV1,
  boundary: number,
  label: string,
): void {
  if (journal.nextStep > boundary) fail(`${label}: compensation past the point of no return`);
}

export function validateCoordinatorJournalForPlan(
  plan: CoordinatorPlan,
  journal: LifecycleCoordinatorJournalV1,
  variant: LifecycleOperationVariantV1,
  pushPlanHash: LowerHexSha256 | null,
): void {
  const label = `LifecycleCoordinatorJournalV1 (${variant})`;
  if (plan.operation !== operationOfVariant(variant)) fail(`${label}: variant operation`);
  if (journal.id !== plan.id) fail(`${label}: id`);
  if (journal.operation !== plan.operation) fail(`${label}: operation`);
  if ((pushPlanHash === null) !== (plan.push === null)) fail(`${label}: pushPlanHash arm`);
  if (journal.pushPlanHash !== pushPlanHash) fail(`${label}: pushPlanHash`);
  for (const step of plan.steps) {
    if (step.kind !== "network_push" && step.kind !== "destination_git_effect") continue;
    if (step.pushPlanHash !== pushPlanHash) fail(`${label}: step pushPlanHash`);
  }
  const steps = plan.steps;
  if (journal.nextStep > steps.length) fail(`${label}: nextStep`);
  const compensating = journal.phase === "compensating" || journal.phase === "rolled_back";
  if ((journal.compensationNext !== null) !== compensating) fail(`${label}: compensationNext arm`);
  const compacting = journal.phase === "compacting";
  if ((journal.compactionNext !== null) !== compacting) fail(`${label}: compactionNext arm`);
  if ((journal.terminalOutcome !== null) !== compacting) fail(`${label}: terminalOutcome arm`);
  const boundary = pointOfNoReturnStepIndex(variant, steps);
  switch (journal.phase) {
    case "planned":
      if (journal.nextStep !== 0) fail(`${label}: planned cursor`);
      return;
    case "participants_applying":
    case "manifest_publishing":
    case "external_applying":
    case "config_publishing": {
      const step = steps[journal.nextStep];
      if (step === undefined) fail(`${label}: cursor past the last step`);
      if (derivedCoordinatorPhase(step) !== journal.phase) fail(`${label}: derived phase`);
      return;
    }
    case "push_pending": {
      const step = steps[journal.nextStep];
      if (step === undefined) fail(`${label}: cursor past the last step`);
      if (step.kind !== "network_push" && step.kind !== "destination_git_effect") {
        fail(`${label}: push_pending cursor`);
      }
      if (pushPlanHash === null || step.pushPlanHash !== pushPlanHash) fail(`${label}: push_pending pushPlanHash`);
      return;
    }
    case "finalized":
      requireFinalizedCursor(journal, steps.length, label);
      return;
    case "compensating": {
      requireReversibleCursor(journal, boundary, label);
      const cursor = journal.compensationNext;
      if (cursor === null || cursor < 0 || cursor > journal.nextStep - 1) fail(`${label}: compensating cursor`);
      return;
    }
    case "rolled_back":
      requireReversibleCursor(journal, boundary, label);
      if (journal.compensationNext !== -1) fail(`${label}: rolled_back cursor`);
      return;
    case "compacting":
      if (journal.terminalOutcome === "finalized") requireFinalizedCursor(journal, steps.length, label);
      else requireReversibleCursor(journal, boundary, label);
      return;
  }
}

/** Allocated and legacy Foundation IDs are ASCII, so code-unit order is the byte order §2.4 requires. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function deriveTerminalCompaction(
  plan: CoordinatorPlan,
  outcome: LifecycleTerminalOutcomeV1,
): LifecycleTerminalCompactionV1 {
  const entries: LifecycleCompactionEntryV1[] = plan.participants.foundation
    .map((ref) => ref.id)
    .sort(compareIds)
    .map((participantId) => ({ kind: "foundation_transaction", participantId }));
  if (plan.participants.sourceGitEffect !== null) {
    entries.push({ kind: "git_effect", side: "source", participantId: plan.participants.sourceGitEffect.id });
  }
  if (plan.participants.destinationGitEffect !== null) {
    entries.push({
      kind: "git_effect",
      side: "destination",
      participantId: plan.participants.destinationGitEffect.id,
    });
  }
  if (plan.participants.launchdBeforeFiles !== null) {
    entries.push({
      kind: "launchd_effect",
      position: "before_files",
      participantId: plan.participants.launchdBeforeFiles.id,
    });
  }
  if (plan.participants.launchdAfterFiles !== null) {
    entries.push({
      kind: "launchd_effect",
      position: "after_files",
      participantId: plan.participants.launchdAfterFiles.id,
    });
  }
  entries.push({ kind: "coordinator_staging" }, { kind: "coordinator_envelope" });
  const bounds = LIFECYCLE_PLAN_BOUNDS.compactionEntries;
  if (entries.length < bounds.minimum || entries.length > bounds.maximum) {
    fail("LifecycleTerminalCompactionV1: entries");
  }
  return { coordinatorId: plan.id, terminalOutcome: outcome, entries };
}

export function lifecycleReservationOrder(plan: CoordinatorPlan): readonly LifecycleReservationSlotV1[] {
  const slots: LifecycleReservationSlotV1[] = [{ prefix: "lc", role: "coordinator" }];
  const byId = new Map(plan.participants.foundation.map((ref) => [ref.id as string, ref]));
  for (const step of plan.steps) {
    if (step.kind !== "foundation") continue;
    const ref = byId.get(step.participantId);
    if (ref === undefined || ref.role.kind !== "forward") {
      fail(`LifecycleCoordinatorPlanV1: reservation order names ${step.participantId}`);
    }
    slots.push({ prefix: "tx", role: `forward:${ref.slot}` });
    if (ref.role.compensationId !== null) slots.push({ prefix: "tx", role: `compensation:${ref.slot}` });
  }
  if (plan.participants.sourceGitEffect !== null) slots.push({ prefix: "ge", role: "source_git_effect" });
  if (plan.participants.destinationGitEffect !== null) {
    slots.push({ prefix: "ge", role: "destination_git_effect" });
  }
  if (plan.participants.launchdBeforeFiles !== null) slots.push({ prefix: "le", role: "launchd_before_files" });
  if (plan.participants.launchdAfterFiles !== null) slots.push({ prefix: "le", role: "launchd_after_files" });
  if (plan.participants.manifest !== null) slots.push({ prefix: "mf", role: "manifest" });
  return slots;
}
