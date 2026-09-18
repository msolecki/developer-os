import { describe, expect, it } from "vitest";

import type { LifecycleActivationArmV1 } from "../config/lifecycle.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import {
  LIFECYCLE_POINT_OF_NO_RETURN,
  LIFECYCLE_STEP_GRAMMAR,
  deriveLifecycleOperationVariant,
  deriveTerminalCompaction,
  deriveUninstallLaunchdEvidence,
  derivedCoordinatorPhase,
  lifecycleReservationOrder,
  pointOfNoReturnStepIndex,
  validateCoordinatorJournalForPlan,
  validateLifecyclePlanGrammar,
  type LifecycleOperationVariantV1,
  type LifecyclePointOfNoReturnV1,
  type LifecycleStepTemplateV1,
  type LifecycleUninstallLaunchdEvidenceV1,
  type LifecycleVariantFactsV1,
} from "./grammar.js";
import {
  formatAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
  type GitEffectIdV1,
  type LaunchdEffectIdV1,
} from "./ids.js";
import {
  FOUNDATION_PARTICIPANT_SLOTS,
  LIFECYCLE_COORDINATOR_PHASES,
  LIFECYCLE_MANIFEST_STEP_TRANSITIONS,
  LIFECYCLE_PLAN_BOUNDS,
  LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS,
  type FoundationParticipantRefV1,
  type FoundationParticipantSlotV1,
  type LifecycleCompactionEntryV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPhaseV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
  type LifecycleEffectRefV1,
} from "./types.js";

const HOME = parseCanonicalAbsolutePathText("/product");
const NONCE = parseLowerHexSha256("a".repeat(64));
const TIMESTAMP = parseUtcTimestamp("2026-09-18T00:00:00.000Z");
const DEV = parseUInt64Decimal("16777232");
const INO = parseUInt64Decimal("184467440737095516");

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

const PLAN_HASH = hash("1");
const PUSH_HASH = hash("2");
const OTHER_HASH = hash("3");

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture index ${index.toString(10)} is absent`);
  return value;
}

const COORDINATOR = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 0n), NONCE);

function transactionId(counter: bigint): AllocatedLifecycleIdV1<"tx"> {
  return formatAllocatedLifecycleId("tx", NONCE, counter);
}

function gitEffectId(counter: bigint): GitEffectIdV1 {
  return formatAllocatedLifecycleId("ge", NONCE, counter);
}

function launchdEffectId(counter: bigint): LaunchdEffectIdV1 {
  return formatAllocatedLifecycleId("le", NONCE, counter);
}

/**
 * The fourteen Spec 1 §2.4 rows, written out here rather than read from the implementation:
 * a table that derives its own expectation proves nothing.
 */
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

const EXPECTED_STEPS: Readonly<Record<LifecycleOperationVariantV1, readonly LifecycleStepTemplateV1[]>> = {
  git_enable: [M("preserve_before"), F("activation"), M("publish_after"), S, F("config"), M("finalize_tombstones")],
  git_reconcile: [M("preserve_before"), F("activation"), M("publish_after"), S, F("config"), M("finalize_tombstones")],
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
  "uninstall/present_manifest": [
    F("uninstall_marker"),
    P,
    R,
    F("uninstall_artifacts"),
    K("stage"),
    M("preserve_before"),
    M("commit_absence"),
    K("delete"),
    M("finalize_tombstones"),
  ],
  "uninstall/present_manifest_without_launchd": [
    F("uninstall_marker"),
    R,
    F("uninstall_artifacts"),
    K("stage"),
    M("preserve_before"),
    M("commit_absence"),
    K("delete"),
    M("finalize_tombstones"),
  ],
};

const EXPECTED_POINT_OF_NO_RETURN: Readonly<Record<LifecycleOperationVariantV1, LifecyclePointOfNoReturnV1>> = {
  git_enable: {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified effects and manifest tombstones",
  },
  git_reconcile: {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified effects and manifest tombstones",
  },
  git_disable: {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified effects and manifest tombstones",
  },
  "git_sync/no_changes": {
    kind: "terminal_foundation",
    slot: "sync_record",
    recovery: "terminal compaction only",
  },
  "git_sync/new_network": {
    kind: "effect_verified",
    step: "S",
    recovery: "finalize `S`; retry/finish the exact bound destination, then sync record",
  },
  "git_sync/existing_network": { kind: "push_succeeded", recovery: "write the exact sync record" },
  "git_sync/new_local": {
    kind: "effect_verified",
    step: "S",
    recovery: "finalize `S`; retry/finish the exact bound destination, then sync record",
  },
  "git_sync/existing_local": {
    kind: "effect_verified",
    step: "D",
    recovery: "finalize `D`; write the exact sync record",
  },
  automation_enable: {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified launchd effects and manifest tombstones",
  },
  "automation_reconcile/files": {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified launchd effects and manifest tombstones",
  },
  "automation_reconcile/live_only": {
    kind: "effect_verified",
    step: "Q",
    recovery: "finalize `Q`, then terminal compaction",
  },
  automation_disable: {
    kind: "terminal_foundation",
    slot: "config",
    recovery: "finalize verified launchd effects and manifest tombstones",
  },
  "uninstall/present_manifest": {
    kind: "manifest_commit_absence",
    recovery: "finalize prior effects, delete the staged key, and finalize tombstones",
  },
  "uninstall/present_manifest_without_launchd": {
    kind: "manifest_commit_absence",
    recovery: "delete the staged key and finalize tombstones",
  },
};

const EXPECTED_FACTS: Readonly<Record<LifecycleOperationVariantV1, LifecycleVariantFactsV1>> = {
  git_enable: { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null },
  git_reconcile: { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null },
  git_disable: { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null },
  "git_sync/no_changes": {
    gitSync: { newCommit: false, transport: "network", noChanges: true },
    automationReconcile: null,
    uninstallLaunchdEvidence: null,
  },
  "git_sync/new_network": {
    gitSync: { newCommit: true, transport: "network", noChanges: false },
    automationReconcile: null,
    uninstallLaunchdEvidence: null,
  },
  "git_sync/existing_network": {
    gitSync: { newCommit: false, transport: "network", noChanges: false },
    automationReconcile: null,
    uninstallLaunchdEvidence: null,
  },
  "git_sync/new_local": {
    gitSync: { newCommit: true, transport: "local", noChanges: false },
    automationReconcile: null,
    uninstallLaunchdEvidence: null,
  },
  "git_sync/existing_local": {
    gitSync: { newCommit: false, transport: "local", noChanges: false },
    automationReconcile: null,
    uninstallLaunchdEvidence: null,
  },
  automation_enable: { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null },
  "automation_reconcile/files": { gitSync: null, automationReconcile: "files", uninstallLaunchdEvidence: null },
  "automation_reconcile/live_only": { gitSync: null, automationReconcile: "live_only", uninstallLaunchdEvidence: null },
  automation_disable: { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null },
  "uninstall/present_manifest": { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: true },
  "uninstall/present_manifest_without_launchd": {
    gitSync: null,
    automationReconcile: null,
    uninstallLaunchdEvidence: false,
  },
};

const VARIANTS = Object.keys(EXPECTED_STEPS) as readonly LifecycleOperationVariantV1[];

function matchesPointOfNoReturn(
  template: LifecycleStepTemplateV1,
  boundary: LifecyclePointOfNoReturnV1,
): boolean {
  switch (boundary.kind) {
    case "terminal_foundation":
      return template.kind === "F" && template.slot === boundary.slot;
    case "effect_verified":
      return template.kind === boundary.step;
    case "push_succeeded":
      return template.kind === "N";
    case "manifest_commit_absence":
      return template.kind === "M" && template.transition === "commit_absence";
  }
}

function expectedPointOfNoReturnIndex(variant: LifecycleOperationVariantV1): number {
  const boundary = EXPECTED_POINT_OF_NO_RETURN[variant];
  const index = EXPECTED_STEPS[variant].findIndex((template) => matchesPointOfNoReturn(template, boundary));
  if (index < 0) throw new Error(`${variant} has no point-of-no-return step`);
  return index;
}

interface Leaf {
  readonly marker: string;
}
type Plan = LifecycleCoordinatorPlanCoreV1<Leaf, Leaf, Leaf, Leaf>;

function foundationRef(
  id: AllocatedLifecycleIdV1<"tx">,
  slot: FoundationParticipantSlotV1,
  role: FoundationParticipantRefV1["role"],
): FoundationParticipantRefV1 {
  return {
    id,
    slot,
    role,
    mutations: [
      {
        targetPath: path(`${HOME}/state/${slot}.json`),
        operation: "create",
        expectedBeforeHash: null,
        contentHash: hash("4"),
        contentSize: 16,
        stagedPath: path(`${HOME}/staging/transactions/${id}/0.bin`),
      },
    ],
    maximumJournalBytes: 4096,
    planHash: hash("5"),
    initialJournal: {
      finalPath: path(`${HOME}/state/transactions/${id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(`${HOME}/staging/lifecycle/${COORDINATOR}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384, dev: DEV, ino: INO },
    },
  };
}

interface Allocation {
  readonly forwardIds: readonly AllocatedLifecycleIdV1<"tx">[];
  readonly foundation: readonly FoundationParticipantRefV1[];
  readonly sourceGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null;
  readonly destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null;
  readonly launchdBeforeFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null;
  readonly launchdAfterFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null;
}

/**
 * Counters follow §2.4's reservation order so `participants.foundation` is sorted by ID and the
 * compaction expectation is unambiguous; single digits keep decimal order equal to byte order.
 */
function allocate(variant: LifecycleOperationVariantV1): Allocation {
  const templates = EXPECTED_STEPS[variant];
  const boundary = expectedPointOfNoReturnIndex(variant);
  let next = 1n;
  const reserve = (): bigint => {
    const counter = next;
    next += 1n;
    if (counter > 9n) throw new Error("fixture counters must stay single-digit");
    return counter;
  };
  const forwardIds: AllocatedLifecycleIdV1<"tx">[] = [];
  const foundation: FoundationParticipantRefV1[] = [];
  for (const [index, template] of templates.entries()) {
    if (template.kind !== "F") continue;
    const forwardId = transactionId(reserve());
    const compensationId = index < boundary ? transactionId(reserve()) : null;
    forwardIds.push(forwardId);
    foundation.push(foundationRef(forwardId, template.slot, { kind: "forward", compensationId }));
    if (compensationId !== null) {
      foundation.push(
        foundationRef(compensationId, template.slot, { kind: "compensation", forwardId }),
      );
    }
  }
  const has = (kind: LifecycleStepTemplateV1["kind"]): boolean =>
    templates.some((template) => template.kind === kind);
  return {
    forwardIds,
    foundation,
    sourceGitEffect: has("S") ? { id: gitEffectId(reserve()), planHash: hash("8") } : null,
    destinationGitEffect: has("D") ? { id: gitEffectId(reserve()), planHash: hash("9") } : null,
    launchdBeforeFiles: has("P") ? { id: launchdEffectId(reserve()), planHash: hash("a") } : null,
    launchdAfterFiles: has("Q") ? { id: launchdEffectId(reserve()), planHash: hash("b") } : null,
  };
}

function requireRef<T>(ref: LifecycleEffectRefV1<T> | null, label: string): T {
  if (ref === null) throw new Error(`fixture is missing its ${label} reference`);
  return ref.id;
}

function syntheticPlanFor(variant: LifecycleOperationVariantV1): {
  readonly plan: Plan;
  readonly facts: LifecycleVariantFactsV1;
} {
  const templates = EXPECTED_STEPS[variant];
  const allocation = allocate(variant);
  let forwardCursor = 0;
  const steps: LifecycleCoordinatorStepV1[] = templates.map((template) => {
    switch (template.kind) {
      case "F": {
        const participantId = at(allocation.forwardIds, forwardCursor);
        forwardCursor += 1;
        return { kind: "foundation", slot: template.slot, participantId };
      }
      case "M":
        return { kind: "manifest", transition: template.transition };
      case "K":
        return { kind: "redaction_key", transition: template.transition };
      case "S":
        return { kind: "source_git_effect", participantId: requireRef(allocation.sourceGitEffect, "source Git") };
      case "D":
        return {
          kind: "destination_git_effect",
          participantId: requireRef(allocation.destinationGitEffect, "destination Git"),
          pushPlanHash: PUSH_HASH,
        };
      case "P":
        return {
          kind: "launchd_before_files",
          participantId: requireRef(allocation.launchdBeforeFiles, "before-files launchd"),
        };
      case "Q":
        return {
          kind: "launchd_after_files",
          participantId: requireRef(allocation.launchdAfterFiles, "after-files launchd"),
        };
      case "N":
        return { kind: "network_push", pushPlanHash: PUSH_HASH };
      case "R":
        return { kind: "drain_runners" };
    }
  });
  const hasManifest = templates.some((template) => template.kind === "M");
  const hasRedactionKey = templates.some((template) => template.kind === "K");
  const hasPush = templates.some((template) => template.kind === "N" || template.kind === "D");
  const launchdPlan =
    variant.startsWith("automation_") || variant === "uninstall/present_manifest"
      ? { marker: "launchd" }
      : null;
  return {
    plan: {
      schemaVersion: 1,
      id: COORDINATOR,
      previewHash: null,
      operation: operationOf(variant),
      maximumJournalBytes: 8192,
      authority: {
        productHome: HOME,
        configPath: path(`${HOME}/config.toml`),
        activationPath: path(`${HOME}/state/lifecycle-activation.json`),
        manifestPath: path(`${HOME}/state/installation.json`),
        repositoryRoot: variant.startsWith("git_") ? path("/brain") : null,
        plistPaths: launchdPlan === null ? [] : [path("/Library/LaunchAgents/com.developer-os.doctor.plist")],
      },
      participants: {
        foundation: allocation.foundation,
        manifest: hasManifest ? { marker: "manifest" } : null,
        sourceGitEffect: allocation.sourceGitEffect,
        destinationGitEffect: allocation.destinationGitEffect,
        launchdBeforeFiles: allocation.launchdBeforeFiles,
        launchdAfterFiles: allocation.launchdAfterFiles,
        launchd: launchdPlan,
        redactionKey: hasRedactionKey ? { marker: "redaction-key" } : null,
      },
      push: hasPush ? { marker: "push" } : null,
      steps,
    },
    facts: EXPECTED_FACTS[variant],
  };
}

function operationOf(variant: LifecycleOperationVariantV1): Plan["operation"] {
  const [operation] = variant.split("/");
  if (operation === undefined) throw new Error(`${variant} has no operation`);
  return operation as Plan["operation"];
}

function replacedStep(
  steps: readonly LifecycleCoordinatorStepV1[],
  index: number,
  step: LifecycleCoordinatorStepV1,
): readonly LifecycleCoordinatorStepV1[] {
  return steps.map((current, position) => (position === index ? step : current));
}

function otherOf<T>(values: readonly T[], value: T): T {
  const other = values.find((candidate) => candidate !== value);
  if (other === undefined) throw new Error("no alternative literal");
  return other;
}

interface Corruption {
  readonly label: string;
  readonly plan: Plan;
}

function stepCorruptionsOf(plan: Plan): readonly Corruption[] {
  const corruptions: Corruption[] = [];
  const steps = plan.steps;
  const withSteps = (label: string, next: readonly LifecycleCoordinatorStepV1[]): void => {
    corruptions.push({ label, plan: { ...plan, steps: next } });
  };
  for (const [index, step] of steps.entries()) {
    const position = index.toString(10);
    withSteps(`missing step ${position}`, steps.filter((_, other) => other !== index));
    withSteps(`duplicated step ${position}`, [...steps.slice(0, index), step, ...steps.slice(index)]);
    if (index > 0) {
      const reordered = [...steps];
      reordered[index - 1] = step;
      reordered[index] = at(steps, index - 1);
      withSteps(`reordered steps ${position}`, reordered);
    }
    switch (step.kind) {
      case "foundation":
        withSteps(
          `wrong slot at ${position}`,
          replacedStep(steps, index, { ...step, slot: otherOf(FOUNDATION_PARTICIPANT_SLOTS, step.slot) }),
        );
        break;
      case "manifest":
        withSteps(
          `wrong manifest transition at ${position}`,
          replacedStep(steps, index, {
            ...step,
            transition: otherOf(LIFECYCLE_MANIFEST_STEP_TRANSITIONS, step.transition),
          }),
        );
        break;
      case "redaction_key":
        withSteps(
          `wrong redaction transition at ${position}`,
          replacedStep(steps, index, {
            ...step,
            transition: otherOf(LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS, step.transition),
          }),
        );
        break;
      case "source_git_effect":
        withSteps(
          `wrong Git side at ${position}`,
          replacedStep(steps, index, {
            kind: "destination_git_effect",
            participantId: step.participantId,
            pushPlanHash: PUSH_HASH,
          }),
        );
        break;
      case "destination_git_effect":
        withSteps(
          `wrong Git side at ${position}`,
          replacedStep(steps, index, { kind: "source_git_effect", participantId: step.participantId }),
        );
        break;
      case "launchd_before_files":
        withSteps(
          `wrong launchd position at ${position}`,
          replacedStep(steps, index, { kind: "launchd_after_files", participantId: step.participantId }),
        );
        break;
      case "launchd_after_files":
        withSteps(
          `wrong launchd position at ${position}`,
          replacedStep(steps, index, { kind: "launchd_before_files", participantId: step.participantId }),
        );
        break;
      case "network_push":
        withSteps(
          `push step turned into a destination effect at ${position}`,
          replacedStep(steps, index, {
            kind: "destination_git_effect",
            participantId: gitEffectId(9n),
            pushPlanHash: step.pushPlanHash,
          }),
        );
        break;
      case "drain_runners":
        break;
    }
  }
  return [...corruptions, ...participantCorruptionsOf(plan)];
}

function participantCorruptionsOf(plan: Plan): readonly Corruption[] {
  const corruptions: Corruption[] = [];
  const participants = plan.participants;
  const withParticipants = (label: string, patch: Partial<Plan["participants"]>): void => {
    corruptions.push({ label, plan: { ...plan, participants: { ...participants, ...patch } } });
  };
  withParticipants("flipped manifest arm", { manifest: participants.manifest === null ? { marker: "x" } : null });
  withParticipants("flipped redaction key arm", {
    redactionKey: participants.redactionKey === null ? { marker: "x" } : null,
  });
  withParticipants("flipped launchd arm", { launchd: participants.launchd === null ? { marker: "x" } : null });
  withParticipants("flipped source Git arm", {
    sourceGitEffect: participants.sourceGitEffect === null ? { id: gitEffectId(9n), planHash: OTHER_HASH } : null,
  });
  withParticipants("flipped destination Git arm", {
    destinationGitEffect:
      participants.destinationGitEffect === null ? { id: gitEffectId(9n), planHash: OTHER_HASH } : null,
  });
  withParticipants("flipped before-files launchd arm", {
    launchdBeforeFiles:
      participants.launchdBeforeFiles === null ? { id: launchdEffectId(9n), planHash: OTHER_HASH } : null,
  });
  withParticipants("flipped after-files launchd arm", {
    launchdAfterFiles:
      participants.launchdAfterFiles === null ? { id: launchdEffectId(9n), planHash: OTHER_HASH } : null,
  });
  corruptions.push({
    label: "flipped push arm",
    plan: { ...plan, push: plan.push === null ? { marker: "push" } : null },
  });
  withParticipants("unused Foundation reference", {
    foundation: [
      ...participants.foundation,
      foundationRef(transactionId(9n), "config", { kind: "forward", compensationId: null }),
    ],
  });
  for (const [index, ref] of participants.foundation.entries()) {
    if (ref.role.kind !== "forward") {
      withParticipants(`dropped compensation reference ${index.toString(10)}`, {
        foundation: participants.foundation.filter((_, other) => other !== index),
      });
      continue;
    }
    const flipped =
      ref.role.compensationId === null
        ? { kind: "forward" as const, compensationId: transactionId(9n) }
        : { kind: "forward" as const, compensationId: null };
    withParticipants(`flipped compensation binding ${index.toString(10)}`, {
      foundation: participants.foundation.map((current, other) =>
        other === index ? { ...current, role: flipped } : current,
      ),
    });
  }
  return corruptions;
}

function journalFor(
  plan: Plan,
  overrides: Partial<LifecycleCoordinatorJournalV1>,
): LifecycleCoordinatorJournalV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    operation: plan.operation,
    phase: "planned",
    planHash: PLAN_HASH,
    pushPlanHash: null,
    nextStep: 0,
    compensationNext: null,
    compactionNext: null,
    terminalOutcome: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function pushHashOf(plan: Plan): LowerHexSha256 | null {
  return plan.push === null ? null : PUSH_HASH;
}

function journalChecker(
  plan: Plan,
  variant: LifecycleOperationVariantV1,
  pushPlanHash: LowerHexSha256 | null,
): (overrides: Partial<LifecycleCoordinatorJournalV1>) => () => void {
  return (overrides) => (): void => {
    validateCoordinatorJournalForPlan(
      plan,
      journalFor(plan, { pushPlanHash, ...overrides }),
      variant,
      pushPlanHash,
    );
  };
}

const ACTIVE_PHASES: readonly LifecycleCoordinatorPhaseV1[] = [
  "participants_applying",
  "manifest_publishing",
  "external_applying",
  "config_publishing",
];

describe("the exact Spec 1 §2.4 operation grammar", () => {
  it("enumerates exactly the fourteen Spec 1 variants, A14's included", () => {
    expect(VARIANTS.length).toBeGreaterThan(0);
    expect(VARIANTS).toHaveLength(14);
    expect(Object.keys(LIFECYCLE_STEP_GRAMMAR).sort()).toStrictEqual([...VARIANTS].sort());
    expect(Object.keys(LIFECYCLE_POINT_OF_NO_RETURN).sort()).toStrictEqual([...VARIANTS].sort());
  });

  it("carries every step row literally, including A14's derived row", () => {
    expect(LIFECYCLE_STEP_GRAMMAR).toStrictEqual(EXPECTED_STEPS);
  });

  it("carries every point of no return literally", () => {
    expect(LIFECYCLE_POINT_OF_NO_RETURN).toStrictEqual(EXPECTED_POINT_OF_NO_RETURN);
  });

  it("encodes the table's required-recovery column on every row, with its nine distinct clauses", () => {
    const clauses = VARIANTS.map((variant) => LIFECYCLE_POINT_OF_NO_RETURN[variant].recovery);
    expect(clauses.length).toBeGreaterThan(0);
    expect(new Set(clauses).size).toBe(9);
    for (const variant of VARIANTS) {
      expect(LIFECYCLE_POINT_OF_NO_RETURN[variant].recovery).toBe(
        EXPECTED_POINT_OF_NO_RETURN[variant].recovery,
      );
    }
  });

  it("derives A14's launchd evidence from its three conditions and nothing else", () => {
    const arms: readonly (LifecycleActivationArmV1 | null)[] = [
      null,
      { state: "inactive" },
      { state: "active", configHash: OTHER_HASH },
    ];
    const combinations = [false, true].flatMap((manifestOwnsPlist) =>
      [false, true].flatMap((configHasAutomationLifecycle) =>
        arms.map((activationAutomation) => ({
          manifestOwnsPlist,
          configHasAutomationLifecycle,
          activationAutomation,
        })),
      ),
    );
    expect(combinations).toHaveLength(12);
    for (const evidence of combinations) {
      const withoutLaunchd =
        !evidence.manifestOwnsPlist &&
        !evidence.configHasAutomationLifecycle &&
        (evidence.activationAutomation === null || evidence.activationAutomation.state === "inactive");
      expect(deriveUninstallLaunchdEvidence(evidence)).toBe(!withoutLaunchd);
    }
  });

  it("carries the derived evidence through to A14's variant", () => {
    const { plan } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
    const facts = (evidence: LifecycleUninstallLaunchdEvidenceV1): LifecycleVariantFactsV1 => ({
      gitSync: null,
      automationReconcile: null,
      uninstallLaunchdEvidence: deriveUninstallLaunchdEvidence(evidence),
    });
    expect(
      validateLifecyclePlanGrammar(
        plan,
        facts({
          manifestOwnsPlist: false,
          configHasAutomationLifecycle: false,
          activationAutomation: { state: "inactive" },
        }),
      ),
    ).toBe("uninstall/present_manifest_without_launchd");
    expect(() =>
      validateLifecyclePlanGrammar(
        plan,
        facts({
          manifestOwnsPlist: false,
          configHasAutomationLifecycle: true,
          activationAutomation: null,
        }),
      ),
    ).toThrow();
  });

  it.each(VARIANTS)("accepts the exact synthetic plan for %s and rejects every single-step corruption", (variant) => {
    const { plan, facts } = syntheticPlanFor(variant);
    expect(validateLifecyclePlanGrammar(plan, facts)).toBe(variant);
    expect(deriveLifecycleOperationVariant(plan, facts)).toBe(variant);
    const corruptions = stepCorruptionsOf(plan);
    expect(corruptions.length).toBeGreaterThan(0);
    for (const corrupted of corruptions) {
      expect(() => validateLifecyclePlanGrammar(corrupted.plan, facts), corrupted.label).toThrow();
    }
  });

  it.each(VARIANTS)("puts %s's point of no return at the Spec 1 step", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    expect(pointOfNoReturnStepIndex(variant, plan.steps)).toBe(expectedPointOfNoReturnIndex(variant));
  });

  it.each(VARIANTS)("compensates %s's forwards strictly before the boundary and no later one", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const boundary = expectedPointOfNoReturnIndex(variant);
    const forwards = plan.steps
      .map((step, index) => ({ step, index }))
      .filter((entry) => entry.step.kind === "foundation");
    const byId = new Map(plan.participants.foundation.map((ref) => [ref.id as string, ref]));
    for (const entry of forwards) {
      if (entry.step.kind !== "foundation") continue;
      const ref = byId.get(entry.step.participantId);
      expect(ref?.role.kind).toBe("forward");
      const compensationId = ref?.role.kind === "forward" ? ref.role.compensationId : null;
      if (entry.index < boundary) {
        expect(compensationId).not.toBeNull();
      } else {
        expect(compensationId).toBeNull();
      }
    }
    const compensations = plan.participants.foundation.filter((ref) => ref.role.kind === "compensation");
    expect(compensations).toHaveLength(forwards.filter((entry) => entry.index < boundary).length);
  });

  it("refuses an automation_reconcile/files plan with no plist authority", () => {
    const { plan, facts } = syntheticPlanFor("automation_reconcile/files");
    expect(plan.authority.plistPaths.length).toBeGreaterThan(0);
    expect(() =>
      validateLifecyclePlanGrammar({ ...plan, authority: { ...plan.authority, plistPaths: [] } }, facts),
    ).toThrow();
  });

  it("makes automation_reconcile/live_only exactly one Q with no Foundation or manifest arm", () => {
    const { plan, facts } = syntheticPlanFor("automation_reconcile/live_only");
    expect(validateLifecyclePlanGrammar(plan, facts)).toBe("automation_reconcile/live_only");
    expect(plan.steps).toStrictEqual([
      { kind: "launchd_after_files", participantId: plan.participants.launchdAfterFiles?.id },
    ]);
    expect(plan.participants.foundation).toStrictEqual([]);
    expect(plan.participants.manifest).toBeNull();
    expect(plan.participants.launchdBeforeFiles).toBeNull();
    expect(plan.participants.launchd).not.toBeNull();
  });

  it("binds each git_sync variant's effect and push arms to its row", () => {
    const arms = (variant: LifecycleOperationVariantV1): readonly boolean[] => {
      const { plan } = syntheticPlanFor(variant);
      return [
        plan.participants.sourceGitEffect !== null,
        plan.participants.destinationGitEffect !== null,
        plan.push !== null,
        plan.steps.some((step) => step.kind === "network_push"),
      ];
    };
    expect(arms("git_sync/no_changes")).toStrictEqual([false, false, false, false]);
    expect(arms("git_sync/new_network")).toStrictEqual([true, false, true, true]);
    expect(arms("git_sync/existing_network")).toStrictEqual([false, false, true, true]);
    expect(arms("git_sync/new_local")).toStrictEqual([true, true, true, false]);
    expect(arms("git_sync/existing_local")).toStrictEqual([false, true, true, false]);
  });

  it("makes launchd non-null for exactly the three automation operations and uninstall/present_manifest", () => {
    const withLaunchd = VARIANTS.filter((variant) => syntheticPlanFor(variant).plan.participants.launchd !== null);
    expect(withLaunchd).toStrictEqual([
      "automation_enable",
      "automation_reconcile/files",
      "automation_reconcile/live_only",
      "automation_disable",
      "uninstall/present_manifest",
    ]);
  });

  it("reserves lc, then forward Foundation refs in step order each followed by its compensation, then S, D, P, Q, then mf last (A16)", () => {
    const { plan } = syntheticPlanFor("uninstall/present_manifest");
    expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual([
      "lc",
      "tx",
      "tx",
      "tx",
      "tx",
      "le",
      "mf",
    ]);
    const { plan: withoutLaunchd } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
    expect(lifecycleReservationOrder(withoutLaunchd).map((slot) => slot.prefix)).toStrictEqual([
      "lc",
      "tx",
      "tx",
      "tx",
      "tx",
      "mf",
    ]);
  });

  it.each(VARIANTS)("reserves %s's block in Spec 1 order with mf last when a manifest arm exists", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const boundary = expectedPointOfNoReturnIndex(variant);
    const expected: string[] = ["lc"];
    for (const [index, template] of EXPECTED_STEPS[variant].entries()) {
      if (template.kind !== "F") continue;
      expected.push("tx");
      if (index < boundary) expected.push("tx");
    }
    for (const [kind, prefix] of [
      ["S", "ge"],
      ["D", "ge"],
      ["P", "le"],
      ["Q", "le"],
    ] as const) {
      if (EXPECTED_STEPS[variant].some((template) => template.kind === kind)) expected.push(prefix);
    }
    if (plan.participants.manifest !== null) expected.push("mf");
    const order = lifecycleReservationOrder(plan);
    expect(order.map((slot) => slot.prefix)).toStrictEqual(expected);
    expect(new Set(order.map((slot) => `${slot.prefix}:${slot.role}`)).size).toBe(order.length);
    if (plan.participants.manifest !== null) {
      expect(at(order, order.length - 1).prefix).toBe("mf");
    }
  });

  it("derives the uninstall variant from launchd evidence and refuses a plan shaped for the other one (A14)", () => {
    const { plan, facts } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
    expect(validateLifecyclePlanGrammar(plan, facts)).toBe("uninstall/present_manifest_without_launchd");
    expect(() => validateLifecyclePlanGrammar(plan, { ...facts, uninstallLaunchdEvidence: true })).toThrow();
    const withP = syntheticPlanFor("uninstall/present_manifest");
    expect(() =>
      validateLifecyclePlanGrammar(withP.plan, { ...withP.facts, uninstallLaunchdEvidence: false }),
    ).toThrow();
  });

  it("gives A14's derived variant null launchd arms, empty plistPaths and present_manifest's boundary", () => {
    const { plan } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
    expect(plan.participants.launchd).toBeNull();
    expect(plan.participants.launchdBeforeFiles).toBeNull();
    expect(plan.participants.launchdAfterFiles).toBeNull();
    expect(plan.authority.plistPaths).toStrictEqual([]);
    const derived = LIFECYCLE_POINT_OF_NO_RETURN["uninstall/present_manifest_without_launchd"];
    const withP = LIFECYCLE_POINT_OF_NO_RETURN["uninstall/present_manifest"];
    expect(derived.kind).toBe(withP.kind);
    expect(derived.recovery).toBe("delete the staged key and finalize tombstones");
    expect(withP.recovery).toBe("finalize prior effects, delete the staged key, and finalize tombstones");
    expect(LIFECYCLE_STEP_GRAMMAR["uninstall/present_manifest_without_launchd"]).toStrictEqual(
      LIFECYCLE_STEP_GRAMMAR["uninstall/present_manifest"].filter((template) => template.kind !== "P"),
    );
  });

  it("requires uninstallLaunchdEvidence exactly for uninstall and each other fact arm for its operation", () => {
    for (const variant of VARIANTS) {
      const { plan, facts } = syntheticPlanFor(variant);
      const uninstall = plan.operation === "uninstall";
      expect(facts.uninstallLaunchdEvidence === null).toBe(!uninstall);
      expect(facts.gitSync === null).toBe(plan.operation !== "git_sync");
      expect(facts.automationReconcile === null).toBe(plan.operation !== "automation_reconcile");
      expect(() =>
        deriveLifecycleOperationVariant(plan, {
          ...facts,
          uninstallLaunchdEvidence: uninstall ? null : true,
        }),
      ).toThrow();
      expect(() =>
        deriveLifecycleOperationVariant(plan, {
          ...facts,
          gitSync:
            plan.operation === "git_sync" ? null : { newCommit: false, transport: "network", noChanges: false },
        }),
      ).toThrow();
      expect(() =>
        deriveLifecycleOperationVariant(plan, {
          ...facts,
          automationReconcile: plan.operation === "automation_reconcile" ? null : "files",
        }),
      ).toThrow();
    }
  });

  it("refuses a no_changes fact set that also claims a new commit", () => {
    const { plan, facts } = syntheticPlanFor("git_sync/no_changes");
    expect(() =>
      deriveLifecycleOperationVariant(plan, {
        ...facts,
        gitSync: { newCommit: true, transport: "network", noChanges: true },
      }),
    ).toThrow();
  });
});

describe("derived coordinator phases and journal legality", () => {
  it("derives every step kind's phase from Spec 1 §2.4", () => {
    expect(derivedCoordinatorPhase({ kind: "manifest", transition: "preserve_before" })).toBe("manifest_publishing");
    expect(derivedCoordinatorPhase({ kind: "source_git_effect", participantId: gitEffectId(1n) })).toBe(
      "external_applying",
    );
    expect(
      derivedCoordinatorPhase({
        kind: "destination_git_effect",
        participantId: gitEffectId(1n),
        pushPlanHash: PUSH_HASH,
      }),
    ).toBe("external_applying");
    expect(derivedCoordinatorPhase({ kind: "launchd_before_files", participantId: launchdEffectId(1n) })).toBe(
      "external_applying",
    );
    expect(derivedCoordinatorPhase({ kind: "launchd_after_files", participantId: launchdEffectId(1n) })).toBe(
      "external_applying",
    );
    expect(derivedCoordinatorPhase({ kind: "network_push", pushPlanHash: PUSH_HASH })).toBe("external_applying");
    expect(derivedCoordinatorPhase({ kind: "foundation", slot: "config", participantId: transactionId(1n) })).toBe(
      "config_publishing",
    );
    for (const slot of FOUNDATION_PARTICIPANT_SLOTS.filter((candidate) => candidate !== "config")) {
      expect(derivedCoordinatorPhase({ kind: "foundation", slot, participantId: transactionId(1n) })).toBe(
        "participants_applying",
      );
    }
    expect(derivedCoordinatorPhase({ kind: "redaction_key", transition: "stage" })).toBe("participants_applying");
    expect(derivedCoordinatorPhase({ kind: "drain_runners" })).toBe("participants_applying");
  });

  it.each(VARIANTS)("accepts %s's derived phase at every cursor and refuses every other active phase", (variant) => {
    const { plan, facts } = syntheticPlanFor(variant);
    expect(validateLifecyclePlanGrammar(plan, facts)).toBe(variant);
    const check = journalChecker(plan, variant, pushHashOf(plan));
    for (const [cursor, step] of plan.steps.entries()) {
      const derived = derivedCoordinatorPhase(step);
      expect(check({ phase: derived, nextStep: cursor })).not.toThrow();
      for (const phase of ACTIVE_PHASES) {
        if (phase === derived) continue;
        expect(check({ phase, nextStep: cursor })).toThrow();
      }
      const pushPending = check({ phase: "push_pending", nextStep: cursor });
      if (step.kind === "network_push" || step.kind === "destination_git_effect") {
        expect(pushPending).not.toThrow();
      } else {
        expect(pushPending).toThrow();
      }
    }
  });

  it.each(VARIANTS)("accepts %s's planned journal only at cursor zero", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const check = journalChecker(plan, variant, pushHashOf(plan));
    expect(check({ phase: "planned" })).not.toThrow();
    expect(check({ phase: "planned", nextStep: plan.steps.length })).toThrow();
  });

  it.each(VARIANTS)("holds %s's pushPlanHash invariant in every phase", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const pushPlanHash = pushHashOf(plan);
    const check = journalChecker(plan, variant, pushPlanHash);
    for (const phase of LIFECYCLE_COORDINATOR_PHASES) {
      expect(check({ phase, nextStep: 0, pushPlanHash: pushPlanHash === null ? OTHER_HASH : null })).toThrow();
    }
    if (pushPlanHash !== null) {
      expect(journalChecker(plan, variant, OTHER_HASH)({ phase: "planned" })).toThrow();
    }
  });

  it.each(VARIANTS)("requires %s's finalized journal past the last step with null auxiliary cursors", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const check = journalChecker(plan, variant, pushHashOf(plan));
    expect(check({ phase: "finalized", nextStep: plan.steps.length })).not.toThrow();
    expect(check({ phase: "finalized", nextStep: plan.steps.length - 1 })).toThrow();
    expect(check({ phase: "finalized", nextStep: plan.steps.length, compensationNext: -1 })).toThrow();
  });

  it.each(VARIANTS)("requires %s's rolled_back journal to have drained its reverse frontier", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const check = journalChecker(plan, variant, pushHashOf(plan));
    const boundary = expectedPointOfNoReturnIndex(variant);
    expect(check({ phase: "rolled_back", nextStep: boundary, compensationNext: -1 })).not.toThrow();
    expect(check({ phase: "rolled_back", nextStep: boundary, compensationNext: 0 })).toThrow();
    expect(check({ phase: "rolled_back", nextStep: plan.steps.length, compensationNext: -1 })).toThrow();
  });

  it.each(VARIANTS)("requires %s's compacting journal to name the preceding terminal phase", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    const check = journalChecker(plan, variant, pushHashOf(plan));
    const boundary = expectedPointOfNoReturnIndex(variant);
    expect(
      check({ phase: "compacting", nextStep: plan.steps.length, compactionNext: 0, terminalOutcome: "finalized" }),
    ).not.toThrow();
    expect(
      check({ phase: "compacting", nextStep: boundary, compactionNext: 0, terminalOutcome: "rolled_back" }),
    ).not.toThrow();
    expect(
      check({ phase: "compacting", nextStep: boundary, compactionNext: 0, terminalOutcome: "finalized" }),
    ).toThrow();
    expect(check({ phase: "compacting", nextStep: plan.steps.length })).toThrow();
  });

  it("refuses a compensating cursor that runs ahead of the forward cursor", () => {
    const check = journalChecker(syntheticPlanFor("uninstall/present_manifest").plan, "uninstall/present_manifest", null);
    expect(check({ phase: "compensating", nextStep: 2, compensationNext: 1 })).not.toThrow();
    expect(check({ phase: "compensating", nextStep: 2, compensationNext: 2 })).toThrow();
  });

  it("refuses a journal whose identity or operation leaves its plan", () => {
    const { plan } = syntheticPlanFor("git_disable");
    expect(journalChecker(plan, "git_disable", null)({ operation: "git_enable" })).toThrow();
    expect(journalChecker(plan, "git_enable", null)({})).toThrow();
    expect(
      journalChecker(plan, "git_disable", null)({
        id: parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 9n), NONCE),
      }),
    ).toThrow();
  });
});

describe("terminal compaction entry order", () => {
  it.each(VARIANTS)("orders %s's entries by Foundation ID, then the four effects, staging and envelope", (variant) => {
    const { plan } = syntheticPlanFor(variant);
    for (const outcome of ["finalized", "rolled_back"] as const) {
      const compaction = deriveTerminalCompaction(plan, outcome);
      const expected: LifecycleCompactionEntryV1[] = [
        ...[...plan.participants.foundation]
          .map((ref) => ref.id as string)
          .sort()
          .map((participantId) => ({
            kind: "foundation_transaction" as const,
            participantId: participantId as AllocatedLifecycleIdV1<"tx">,
          })),
      ];
      if (plan.participants.sourceGitEffect !== null) {
        expected.push({
          kind: "git_effect",
          side: "source",
          participantId: plan.participants.sourceGitEffect.id,
        });
      }
      if (plan.participants.destinationGitEffect !== null) {
        expected.push({
          kind: "git_effect",
          side: "destination",
          participantId: plan.participants.destinationGitEffect.id,
        });
      }
      if (plan.participants.launchdBeforeFiles !== null) {
        expected.push({
          kind: "launchd_effect",
          position: "before_files",
          participantId: plan.participants.launchdBeforeFiles.id,
        });
      }
      if (plan.participants.launchdAfterFiles !== null) {
        expected.push({
          kind: "launchd_effect",
          position: "after_files",
          participantId: plan.participants.launchdAfterFiles.id,
        });
      }
      expected.push({ kind: "coordinator_staging" }, { kind: "coordinator_envelope" });
      expect(compaction.coordinatorId).toBe(plan.id);
      expect(compaction.terminalOutcome).toBe(outcome);
      expect(compaction.entries).toStrictEqual(expected);
      expect(compaction.entries.length).toBeGreaterThanOrEqual(LIFECYCLE_PLAN_BOUNDS.compactionEntries.minimum);
      expect(compaction.entries.length).toBeLessThanOrEqual(LIFECYCLE_PLAN_BOUNDS.compactionEntries.maximum);
    }
  });

  it("puts uninstall/present_manifest's before-files launchd entry after every Foundation entry", () => {
    const { plan } = syntheticPlanFor("uninstall/present_manifest");
    expect(deriveTerminalCompaction(plan, "finalized").entries.map((entry) => entry.kind)).toStrictEqual([
      "foundation_transaction",
      "foundation_transaction",
      "foundation_transaction",
      "foundation_transaction",
      "launchd_effect",
      "coordinator_staging",
      "coordinator_envelope",
    ]);
  });

  it("refuses more compaction entries than LifecycleTerminalCompactionV1 admits", () => {
    const { plan } = syntheticPlanFor("uninstall/present_manifest");
    const overflowing: Plan = {
      ...plan,
      participants: {
        ...plan.participants,
        foundation: Array.from({ length: 68 }, (_, index) =>
          foundationRef(transactionId(BigInt(index + 10)), "config", { kind: "forward", compensationId: null }),
        ),
      },
    };
    expect(() => deriveTerminalCompaction(overflowing, "finalized")).toThrow();
  });
});
