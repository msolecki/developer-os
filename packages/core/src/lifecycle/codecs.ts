import { Buffer } from "node:buffer";

import type { FoundationMutationRefV1, LifecycleInstallNonceV1 } from "../manifest/bootstrap.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  hashCanonicalJson,
  type CanonicalJsonV1,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type GitEffectIdV1,
  type LaunchdEffectIdV1,
} from "./ids.js";
import {
  FOUNDATION_MUTATION_OPERATIONS,
  FOUNDATION_PARTICIPANT_SLOTS,
  FOUNDATION_STAGED_JOURNAL_MODE,
  LIFECYCLE_COORDINATOR_OPERATIONS,
  LIFECYCLE_COORDINATOR_PHASES,
  LIFECYCLE_HASH_DOMAINS,
  LIFECYCLE_MANIFEST_STEP_TRANSITIONS,
  LIFECYCLE_PLAN_BOUNDS,
  LIFECYCLE_PREVIEW_COMMANDS,
  LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_ROLES,
  LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS,
  LIFECYCLE_TERMINAL_OUTCOMES,
  type FoundationParticipantRefV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
  type LifecycleEffectRefV1,
  type LifecyclePlanPreviewCoreV1,
  type LifecyclePreviewFileChangeV1,
  type LifecyclePreviewFileStateV1,
  type LifecycleSubsystemV1,
} from "./types.js";

export interface LifecycleValueCodec<T> {
  validate(value: unknown): T;
  encode(value: T): CanonicalJsonV1;
}

/**
 * A plan's domain-separated digest must be taken over the same bytes `encode` produces, so it
 * belongs to the codec that holds the leaves rather than to a free function that can only see a
 * leaf's raw value.
 */
export interface LifecycleHashedValueCodec<T> extends LifecycleValueCodec<T> {
  hash(value: T): LowerHexSha256;
}

export interface LifecycleLeafCodecsV1<
  TManifest,
  TLaunchd,
  TRedactionKey,
  TPush,
  TProjection,
  TGitPreview,
  TLaunchdPreview,
> {
  readonly manifest: LifecycleValueCodec<TManifest>;
  readonly launchd: LifecycleValueCodec<TLaunchd>;
  readonly redactionKey: LifecycleValueCodec<TRedactionKey>;
  readonly push: LifecycleValueCodec<TPush>;
  readonly pushPlanHash: (push: TPush) => LowerHexSha256;
  readonly projection: LifecycleValueCodec<TProjection>;
  readonly gitPreview: LifecycleValueCodec<TGitPreview>;
  readonly launchdPreview: LifecycleValueCodec<TLaunchdPreview>;
  readonly projectionSubsystem: (projection: TProjection) => LifecycleSubsystemV1;
  readonly launchdPreviewTableHashes: (preview: TLaunchdPreview) => {
    readonly observation: LowerHexSha256;
    readonly mutationTemplate: LowerHexSha256;
  };
}

export interface LifecycleCodecContextV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly nonce: LifecycleInstallNonceV1;
}

interface Bounds {
  readonly minimum: number;
  readonly maximum: number;
}

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

function literal<T extends string>(value: unknown, table: readonly T[], label: string): T {
  if (typeof value !== "string" || !table.includes(value as T)) fail(label);
  return value as T;
}

function integer(value: unknown, bounds: Bounds, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < bounds.minimum || value > bounds.maximum) {
    fail(label);
  }
  return value;
}

function list(value: unknown, bounds: Bounds, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(label);
  const array = value as readonly unknown[];
  if (array.length < bounds.minimum || array.length > bounds.maximum) fail(`${label}: length`);
  return array;
}

function requireNull(value: unknown, label: string): null {
  if (value !== null) fail(label);
  return null;
}

function nullableHash(value: unknown): LowerHexSha256 | null {
  return value === null ? null : parseLowerHexSha256(value);
}

function nullablePath(value: unknown): CanonicalAbsolutePathV1 | null {
  return value === null ? null : parseCanonicalAbsolutePathText(value);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const common = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (leftBytes[index] as number) - (rightBytes[index] as number);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function requireSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1] as string, values[index] as string) >= 0) fail(`${label}: order`);
  }
}

function json(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

const MUTATION_KEYS = [
  "targetPath",
  "operation",
  "expectedBeforeHash",
  "contentHash",
  "contentSize",
  "stagedPath",
];
const ROLE_FORWARD_KEYS = ["kind", "compensationId"];
const ROLE_COMPENSATION_KEYS = ["kind", "forwardId"];
const STAGED_IDENTITY_KEYS = ["hash", "size", "mode", "dev", "ino"];
const INITIAL_JOURNAL_KEYS = ["finalPath", "plannedBytesHash", "stagedPath", "stagedIdentity"];
const PARTICIPANT_REF_KEYS = [
  "id",
  "slot",
  "role",
  "mutations",
  "maximumJournalBytes",
  "planHash",
  "initialJournal",
];
const EFFECT_REF_KEYS = ["id", "planHash"];
const PLAN_KEYS = [
  "schemaVersion",
  "id",
  "previewHash",
  "operation",
  "maximumJournalBytes",
  "authority",
  "participants",
  "push",
  "steps",
];
const PLAN_AUTHORITY_KEYS = [
  "productHome",
  "configPath",
  "activationPath",
  "manifestPath",
  "repositoryRoot",
  "plistPaths",
];
const PLAN_PARTICIPANT_KEYS = [
  "foundation",
  "manifest",
  "sourceGitEffect",
  "destinationGitEffect",
  "launchdBeforeFiles",
  "launchdAfterFiles",
  "launchd",
  "redactionKey",
];
const JOURNAL_KEYS = [
  "schemaVersion",
  "id",
  "operation",
  "phase",
  "planHash",
  "pushPlanHash",
  "nextStep",
  "compensationNext",
  "compactionNext",
  "terminalOutcome",
  "createdAt",
  "updatedAt",
];
const PREVIEW_KEYS = [
  "schemaVersion",
  "previewHash",
  "command",
  "executionOperation",
  "normalizedProjection",
  "authority",
  "processTableTemplateHashes",
  "files",
  "git",
  "launchd",
];
const PREVIEW_AUTHORITY_KEYS = ["productHome", "configPath", "activationPath", "manifestPath"];
const PREVIEW_TABLE_HASH_KEYS = ["git", "launchd"];
const PREVIEW_LAUNCHD_TABLE_HASH_KEYS = ["observation", "mutationTemplate"];
const PREVIEW_FILE_KEYS = ["role", "targetPath", "operation", "before", "after"];
const STEP_KEYS: Readonly<Record<LifecycleCoordinatorStepV1["kind"], readonly string[]>> = {
  foundation: ["kind", "slot", "participantId"],
  manifest: ["kind", "transition"],
  source_git_effect: ["kind", "participantId"],
  destination_git_effect: ["kind", "participantId", "pushPlanHash"],
  launchd_before_files: ["kind", "participantId"],
  launchd_after_files: ["kind", "participantId"],
  redaction_key: ["kind", "transition"],
  network_push: ["kind", "pushPlanHash"],
  drain_runners: ["kind"],
};

function parseMutationRef(
  value: unknown,
  participantId: string,
  index: number,
  productHome: CanonicalAbsolutePathV1,
): FoundationMutationRefV1 {
  const label = "FoundationMutationRefV1";
  const input = exact(value, MUTATION_KEYS, label);
  const operation = literal(input.operation, FOUNDATION_MUTATION_OPERATIONS, `${label}: operation`);
  const targetPath = parseCanonicalAbsolutePathText(input.targetPath);
  if (operation === "remove") {
    return {
      targetPath,
      operation,
      expectedBeforeHash: parseLowerHexSha256(input.expectedBeforeHash),
      contentHash: requireNull(input.contentHash, `${label}: contentHash`),
      contentSize: requireNull(input.contentSize, `${label}: contentSize`),
      stagedPath: requireNull(input.stagedPath, `${label}: stagedPath`),
    };
  }
  const derived = `${productHome}/staging/transactions/${participantId}/${index.toString(10)}.bin`;
  if (input.stagedPath !== derived) fail(`${label}: stagedPath`);
  return {
    targetPath,
    operation,
    expectedBeforeHash:
      operation === "create"
        ? requireNull(input.expectedBeforeHash, `${label}: expectedBeforeHash`)
        : parseLowerHexSha256(input.expectedBeforeHash),
    contentHash: parseLowerHexSha256(input.contentHash),
    contentSize: integer(input.contentSize, LIFECYCLE_PLAN_BOUNDS.mutationContentSize, `${label}: contentSize`),
    stagedPath: parseCanonicalAbsolutePathText(derived),
  };
}

function parseParticipantRole(
  value: unknown,
  nonce: LifecycleInstallNonceV1,
): FoundationParticipantRefV1["role"] {
  const label = "FoundationParticipantRefV1: role";
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (kind === "forward") {
    const input = exact(value, ROLE_FORWARD_KEYS, label);
    return {
      kind: "forward",
      compensationId:
        input.compensationId === null ? null : parseAllocatedLifecycleId("tx", input.compensationId, nonce),
    };
  }
  if (kind === "compensation") {
    const input = exact(value, ROLE_COMPENSATION_KEYS, label);
    return { kind: "compensation", forwardId: parseAllocatedLifecycleId("tx", input.forwardId, nonce) };
  }
  fail(label);
}

function parseInitialJournal(
  value: unknown,
  participantId: string,
  coordinatorId: LifecycleCoordinatorIdV1,
  productHome: CanonicalAbsolutePathV1,
): FoundationParticipantRefV1["initialJournal"] {
  const label = "FoundationParticipantRefV1: initialJournal";
  const input = exact(value, INITIAL_JOURNAL_KEYS, label);
  if (input.finalPath !== `${productHome}/state/transactions/${participantId}.json`) fail(`${label}: finalPath`);
  if (
    input.stagedPath !==
    `${productHome}/staging/lifecycle/${coordinatorId}/foundation/${participantId}/journal.json`
  ) {
    fail(`${label}: stagedPath`);
  }
  const identity = exact(input.stagedIdentity, STAGED_IDENTITY_KEYS, `${label}: stagedIdentity`);
  if (identity.mode !== FOUNDATION_STAGED_JOURNAL_MODE) fail(`${label}: stagedIdentity mode`);
  return {
    finalPath: parseCanonicalAbsolutePathText(input.finalPath),
    plannedBytesHash: parseLowerHexSha256(input.plannedBytesHash),
    stagedPath: parseCanonicalAbsolutePathText(input.stagedPath),
    stagedIdentity: {
      hash: parseLowerHexSha256(identity.hash),
      size: integer(identity.size, LIFECYCLE_PLAN_BOUNDS.stagedJournalBytes, `${label}: stagedIdentity size`),
      mode: FOUNDATION_STAGED_JOURNAL_MODE,
      dev: parseUInt64Decimal(identity.dev),
      ino: parseUInt64Decimal(identity.ino),
    },
  };
}

export function foundationParticipantPlanHash(
  ref: Omit<FoundationParticipantRefV1, "id" | "planHash">,
): LowerHexSha256 {
  return hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.foundationParticipantPlan, {
    slot: ref.slot,
    role: json(ref.role),
    mutations: json(ref.mutations),
    maximumJournalBytes: ref.maximumJournalBytes,
    initialJournal: json(ref.initialJournal),
  });
}

export function validateFoundationParticipantRef(
  value: unknown,
  context: LifecycleCodecContextV1,
  coordinatorId: LifecycleCoordinatorIdV1,
): FoundationParticipantRefV1 {
  const label = "FoundationParticipantRefV1";
  const input = exact(value, PARTICIPANT_REF_KEYS, label);
  const id = parseAllocatedLifecycleId("tx", input.id, context.nonce);
  const core = {
    slot: literal(input.slot, FOUNDATION_PARTICIPANT_SLOTS, `${label}: slot`),
    role: parseParticipantRole(input.role, context.nonce),
    mutations: list(input.mutations, LIFECYCLE_PLAN_BOUNDS.mutationsPerRef, `${label}: mutations`).map(
      (mutation, index) => parseMutationRef(mutation, id, index, context.productHome),
    ),
    maximumJournalBytes: integer(
      input.maximumJournalBytes,
      LIFECYCLE_PLAN_BOUNDS.journalBytes,
      `${label}: maximumJournalBytes`,
    ),
    initialJournal: parseInitialJournal(input.initialJournal, id, coordinatorId, context.productHome),
  };
  const planHash = parseLowerHexSha256(input.planHash);
  if (planHash !== foundationParticipantPlanHash(core)) fail(`${label}: planHash`);
  return { id, ...core, planHash };
}

export function validateFoundationParticipantPair(
  forward: FoundationParticipantRefV1,
  compensation: FoundationParticipantRefV1,
): void {
  const label = "FoundationParticipantRefV1: pair";
  if (forward.role.kind !== "forward") fail(`${label}: forward role`);
  if (compensation.role.kind !== "compensation") fail(`${label}: compensation role`);
  if (forward.role.compensationId !== compensation.id) fail(`${label}: compensationId`);
  if (compensation.role.forwardId !== forward.id) fail(`${label}: forwardId`);
  if (forward.slot !== compensation.slot) fail(`${label}: slot`);
  if (forward.mutations.length !== compensation.mutations.length) fail(`${label}: mutation count`);
  const count = forward.mutations.length;
  for (const [index, inverse] of compensation.mutations.entries()) {
    const source = forward.mutations[count - 1 - index];
    if (source === undefined) fail(`${label}: mutation count`);
    if (inverse.targetPath !== source.targetPath) fail(`${label}: targetPath`);
    if (source.operation === "create") {
      if (inverse.operation !== "remove" || inverse.expectedBeforeHash !== source.contentHash) {
        fail(`${label}: inverse of create`);
      }
    } else if (source.operation === "remove") {
      if (inverse.operation !== "create" || inverse.contentHash !== source.expectedBeforeHash) {
        fail(`${label}: inverse of remove`);
      }
    } else if (
      inverse.operation !== "replace" ||
      inverse.expectedBeforeHash !== source.contentHash ||
      inverse.contentHash !== source.expectedBeforeHash
    ) {
      fail(`${label}: inverse of replace`);
    }
  }
}

function parseGitEffectRef(
  value: unknown,
  nonce: LifecycleInstallNonceV1,
  label: string,
): LifecycleEffectRefV1<GitEffectIdV1> {
  const input = exact(value, EFFECT_REF_KEYS, label);
  return {
    id: parseAllocatedLifecycleId("ge", input.id, nonce),
    planHash: parseLowerHexSha256(input.planHash),
  };
}

function parseLaunchdEffectRef(
  value: unknown,
  nonce: LifecycleInstallNonceV1,
  label: string,
): LifecycleEffectRefV1<LaunchdEffectIdV1> {
  const input = exact(value, EFFECT_REF_KEYS, label);
  return {
    id: parseAllocatedLifecycleId("le", input.id, nonce),
    planHash: parseLowerHexSha256(input.planHash),
  };
}

function parseStep(value: unknown, nonce: LifecycleInstallNonceV1): LifecycleCoordinatorStepV1 {
  const label = "LifecycleCoordinatorStepV1";
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const kind = (value as Readonly<Record<string, unknown>>).kind;
  if (typeof kind !== "string" || !Object.hasOwn(STEP_KEYS, kind)) fail(`${label}: kind`);
  const step = kind as LifecycleCoordinatorStepV1["kind"];
  const input = exact(value, STEP_KEYS[step], label);
  switch (step) {
    case "foundation":
      return {
        kind: "foundation",
        slot: literal(input.slot, FOUNDATION_PARTICIPANT_SLOTS, `${label}: slot`),
        participantId: parseAllocatedLifecycleId("tx", input.participantId, nonce),
      };
    case "manifest":
      return {
        kind: "manifest",
        transition: literal(input.transition, LIFECYCLE_MANIFEST_STEP_TRANSITIONS, `${label}: transition`),
      };
    case "source_git_effect":
      return { kind: "source_git_effect", participantId: parseAllocatedLifecycleId("ge", input.participantId, nonce) };
    case "destination_git_effect":
      return {
        kind: "destination_git_effect",
        participantId: parseAllocatedLifecycleId("ge", input.participantId, nonce),
        pushPlanHash: parseLowerHexSha256(input.pushPlanHash),
      };
    case "launchd_before_files":
      return {
        kind: "launchd_before_files",
        participantId: parseAllocatedLifecycleId("le", input.participantId, nonce),
      };
    case "launchd_after_files":
      return {
        kind: "launchd_after_files",
        participantId: parseAllocatedLifecycleId("le", input.participantId, nonce),
      };
    case "redaction_key":
      return {
        kind: "redaction_key",
        transition: literal(input.transition, LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS, `${label}: transition`),
      };
    case "network_push":
      return { kind: "network_push", pushPlanHash: parseLowerHexSha256(input.pushPlanHash) };
    case "drain_runners":
      return { kind: "drain_runners" };
  }
}

function countSteps(steps: readonly LifecycleCoordinatorStepV1[], kind: LifecycleCoordinatorStepV1["kind"]): number {
  return steps.filter((step) => step.kind === kind).length;
}

function bindEffectArm(
  steps: readonly LifecycleCoordinatorStepV1[],
  kind: "source_git_effect" | "destination_git_effect" | "launchd_before_files" | "launchd_after_files",
  arm: LifecycleEffectRefV1<string> | null,
): void {
  const matching = steps.filter((step) => step.kind === kind);
  if (matching.length !== (arm === null ? 0 : 1)) fail(`LifecycleCoordinatorPlanV1: ${kind} arm`);
  const step = matching[0];
  if (arm !== null && step !== undefined && "participantId" in step && step.participantId !== arm.id) {
    fail(`LifecycleCoordinatorPlanV1: ${kind} identity`);
  }
}

function bindSteps(
  steps: readonly LifecycleCoordinatorStepV1[],
  foundation: readonly FoundationParticipantRefV1[],
  hasManifest: boolean,
  hasRedactionKey: boolean,
  pushPlanHash: LowerHexSha256 | null,
): void {
  const label = "LifecycleCoordinatorPlanV1";
  const seen = new Set<string>();
  for (const step of steps) {
    const encoded = encodeCanonicalJson(json(step));
    if (seen.has(encoded)) fail(`${label}: duplicate step`);
    seen.add(encoded);
  }
  const byId = new Map(foundation.map((ref) => [ref.id as string, ref]));
  const consumed = new Set<string>();
  for (const step of steps) {
    if (step.kind !== "foundation") continue;
    const ref = byId.get(step.participantId);
    if (ref === undefined) fail(`${label}: step names an absent Foundation reference`);
    if (ref.role.kind !== "forward") fail(`${label}: step names a compensation reference`);
    if (ref.slot !== step.slot) fail(`${label}: step slot`);
    if (consumed.has(step.participantId)) fail(`${label}: duplicate Foundation step`);
    consumed.add(step.participantId);
  }
  for (const ref of foundation) {
    if (ref.role.kind === "forward") {
      if (!consumed.has(ref.id)) fail(`${label}: unused Foundation reference`);
      if (ref.role.compensationId !== null && !byId.has(ref.role.compensationId)) {
        fail(`${label}: absent compensation reference`);
      }
      continue;
    }
    const forward = byId.get(ref.role.forwardId);
    if (forward === undefined) fail(`${label}: absent forward reference`);
    validateFoundationParticipantPair(forward, ref);
  }
  if ((countSteps(steps, "manifest") > 0) !== hasManifest) fail(`${label}: manifest arm`);
  if ((countSteps(steps, "redaction_key") > 0) !== hasRedactionKey) fail(`${label}: redaction key arm`);
  const pushSteps = steps.filter(
    (step) => step.kind === "network_push" || step.kind === "destination_git_effect",
  );
  if ((pushSteps.length > 0) !== (pushPlanHash !== null)) fail(`${label}: push arm`);
  for (const step of pushSteps) {
    if ("pushPlanHash" in step && step.pushPlanHash !== pushPlanHash) fail(`${label}: pushPlanHash`);
  }
}

function parsePreviewFileState(value: unknown, label: string): LifecyclePreviewFileStateV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const state = (value as Readonly<Record<string, unknown>>).state;
  if (state === "absent") {
    exact(value, ["state"], label);
    return { state: "absent" };
  }
  if (state === "present") {
    const input = exact(value, ["state", "hash", "size"], label);
    return {
      state: "present",
      hash: parseLowerHexSha256(input.hash),
      size: integer(input.size, LIFECYCLE_PLAN_BOUNDS.previewFileSize, `${label}: size`),
    };
  }
  fail(label);
}

function parsePreviewFileChange(value: unknown): LifecyclePreviewFileChangeV1 {
  const label = "LifecyclePreviewFileChangeV1";
  const input = exact(value, PREVIEW_FILE_KEYS, label);
  return {
    role: literal(input.role, LIFECYCLE_PREVIEW_FILE_ROLES, `${label}: role`),
    targetPath: parseCanonicalAbsolutePathText(input.targetPath),
    operation: literal(input.operation, LIFECYCLE_PREVIEW_FILE_OPERATIONS, `${label}: operation`),
    before: parsePreviewFileState(input.before, `${label}: before`),
    after: parsePreviewFileState(input.after, `${label}: after`),
  };
}

function parsePreviewFileChanges(value: unknown, label: string): readonly LifecyclePreviewFileChangeV1[] {
  const changes = list(value, LIFECYCLE_PLAN_BOUNDS.previewFiles, `${label}: files`).map((entry) =>
    parsePreviewFileChange(entry),
  );
  const seen = new Set<string>();
  for (const change of changes) {
    const key = `${change.role}\u0000${change.targetPath}`;
    if (seen.has(key)) fail(`${label}: files duplicate role and target path`);
    seen.add(key);
  }
  return changes;
}

function previewDigest(preview: Readonly<Record<string, unknown>>): LowerHexSha256 {
  const hashed: Record<string, CanonicalJsonValue> = {};
  for (const [key, value] of Object.entries(preview)) {
    if (key !== "previewHash") hashed[key] = json(value);
  }
  return hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.preview, hashed);
}

export function lifecyclePreviewHash(
  preview: LifecyclePlanPreviewCoreV1<unknown, unknown, unknown>,
): LowerHexSha256 {
  return previewDigest(preview as unknown as Readonly<Record<string, unknown>>);
}

export function createLifecycleCodecs<
  TManifest,
  TLaunchd,
  TRedactionKey,
  TPush,
  TProjection,
  TGitPreview,
  TLaunchdPreview,
>(
  leaves: LifecycleLeafCodecsV1<
    TManifest,
    TLaunchd,
    TRedactionKey,
    TPush,
    TProjection,
    TGitPreview,
    TLaunchdPreview
  >,
  context: LifecycleCodecContextV1,
): {
  readonly executionPlan: LifecycleHashedValueCodec<
    LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush>
  >;
  readonly preview: LifecycleValueCodec<
    LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview>
  >;
  readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
} {
  type Plan = LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush>;
  type Preview = LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview>;

  function leafJson<T>(codec: LifecycleValueCodec<T>, value: T | null): CanonicalJsonValue {
    if (value === null) return null;
    return decodeCanonicalJson(encoder.encode(codec.encode(value)), LIFECYCLE_PLAN_BOUNDS.planBytes.maximum);
  }

  function planJson(plan: Plan): CanonicalJsonValue {
    return {
      schemaVersion: plan.schemaVersion,
      id: plan.id,
      previewHash: plan.previewHash,
      operation: plan.operation,
      maximumJournalBytes: plan.maximumJournalBytes,
      authority: json(plan.authority),
      participants: {
        foundation: json(plan.participants.foundation),
        manifest: leafJson(leaves.manifest, plan.participants.manifest),
        sourceGitEffect: json(plan.participants.sourceGitEffect),
        destinationGitEffect: json(plan.participants.destinationGitEffect),
        launchdBeforeFiles: json(plan.participants.launchdBeforeFiles),
        launchdAfterFiles: json(plan.participants.launchdAfterFiles),
        launchd: leafJson(leaves.launchd, plan.participants.launchd),
        redactionKey: leafJson(leaves.redactionKey, plan.participants.redactionKey),
      },
      push: leafJson(leaves.push, plan.push),
      steps: json(plan.steps),
    };
  }

  function previewJson(preview: Preview): Readonly<Record<string, CanonicalJsonValue>> {
    return {
      schemaVersion: preview.schemaVersion,
      previewHash: preview.previewHash,
      command: preview.command,
      executionOperation: preview.executionOperation,
      normalizedProjection: leafJson(leaves.projection, preview.normalizedProjection),
      authority: json(preview.authority),
      processTableTemplateHashes: json(preview.processTableTemplateHashes),
      files: json(preview.files),
      git: leafJson(leaves.gitPreview, preview.git),
      launchd: leafJson(leaves.launchdPreview, preview.launchd),
    };
  }

  function bounded(encoded: CanonicalJsonV1, bounds: Bounds, label: string): CanonicalJsonV1 {
    if (Buffer.byteLength(encoded, "utf8") > bounds.maximum) {
      fail(`${label}: over ${bounds.maximum.toString(10)} bytes`);
    }
    return encoded;
  }

  function validatePlan(value: unknown): Plan {
    const label = "LifecycleCoordinatorPlanV1";
    const input = exact(value, PLAN_KEYS, label);
    if (input.schemaVersion !== 1) fail(`${label}: schemaVersion`);
    const id = parseLifecycleCoordinatorId(input.id, context.nonce);
    const operation = literal(input.operation, LIFECYCLE_COORDINATOR_OPERATIONS, `${label}: operation`);
    const previewHash = nullableHash(input.previewHash);
    if (previewHash !== null && (operation === "git_sync" || operation === "uninstall")) {
      fail(`${label}: previewHash`);
    }
    const authorityInput = exact(input.authority, PLAN_AUTHORITY_KEYS, `${label}: authority`);
    if (authorityInput.productHome !== context.productHome) fail(`${label}: authority productHome`);
    const plistPaths = list(
      authorityInput.plistPaths,
      LIFECYCLE_PLAN_BOUNDS.plistPaths,
      `${label}: plistPaths`,
    ).map((entry) => parseCanonicalAbsolutePathText(entry));
    requireSortedUnique(plistPaths, `${label}: plistPaths`);
    const participantsInput = exact(input.participants, PLAN_PARTICIPANT_KEYS, `${label}: participants`);
    const foundation = list(
      participantsInput.foundation,
      LIFECYCLE_PLAN_BOUNDS.foundationRefs,
      `${label}: foundation`,
    ).map((entry) => validateFoundationParticipantRef(entry, context, id));
    requireSortedUnique(
      foundation.map((ref) => ref.id as string),
      `${label}: foundation`,
    );
    const participants = {
      foundation,
      manifest: participantsInput.manifest === null ? null : leaves.manifest.validate(participantsInput.manifest),
      sourceGitEffect:
        participantsInput.sourceGitEffect === null
          ? null
          : parseGitEffectRef(participantsInput.sourceGitEffect, context.nonce, `${label}: sourceGitEffect`),
      destinationGitEffect:
        participantsInput.destinationGitEffect === null
          ? null
          : parseGitEffectRef(
              participantsInput.destinationGitEffect,
              context.nonce,
              `${label}: destinationGitEffect`,
            ),
      launchdBeforeFiles:
        participantsInput.launchdBeforeFiles === null
          ? null
          : parseLaunchdEffectRef(
              participantsInput.launchdBeforeFiles,
              context.nonce,
              `${label}: launchdBeforeFiles`,
            ),
      launchdAfterFiles:
        participantsInput.launchdAfterFiles === null
          ? null
          : parseLaunchdEffectRef(
              participantsInput.launchdAfterFiles,
              context.nonce,
              `${label}: launchdAfterFiles`,
            ),
      launchd: participantsInput.launchd === null ? null : leaves.launchd.validate(participantsInput.launchd),
      redactionKey:
        participantsInput.redactionKey === null ? null : leaves.redactionKey.validate(participantsInput.redactionKey),
    };
    const push = input.push === null ? null : leaves.push.validate(input.push);
    const steps = list(input.steps, LIFECYCLE_PLAN_BOUNDS.steps, `${label}: steps`).map((entry) =>
      parseStep(entry, context.nonce),
    );
    bindEffectArm(steps, "source_git_effect", participants.sourceGitEffect);
    bindEffectArm(steps, "destination_git_effect", participants.destinationGitEffect);
    bindEffectArm(steps, "launchd_before_files", participants.launchdBeforeFiles);
    bindEffectArm(steps, "launchd_after_files", participants.launchdAfterFiles);
    bindSteps(
      steps,
      foundation,
      participants.manifest !== null,
      participants.redactionKey !== null,
      push === null ? null : leaves.pushPlanHash(push),
    );
    return {
      schemaVersion: 1,
      id,
      previewHash,
      operation,
      maximumJournalBytes: integer(
        input.maximumJournalBytes,
        LIFECYCLE_PLAN_BOUNDS.journalBytes,
        `${label}: maximumJournalBytes`,
      ),
      authority: {
        productHome: context.productHome,
        configPath: parseCanonicalAbsolutePathText(authorityInput.configPath),
        activationPath: parseCanonicalAbsolutePathText(authorityInput.activationPath),
        manifestPath: parseCanonicalAbsolutePathText(authorityInput.manifestPath),
        repositoryRoot: nullablePath(authorityInput.repositoryRoot),
        plistPaths,
      },
      participants,
      push,
      steps,
    };
  }

  function validatePreview(value: unknown): Preview {
    const label = "LifecyclePlanPreviewV1";
    const input = exact(value, PREVIEW_KEYS, label);
    if (input.schemaVersion !== 1) fail(`${label}: schemaVersion`);
    const authorityInput = exact(input.authority, PREVIEW_AUTHORITY_KEYS, `${label}: authority`);
    if (authorityInput.productHome !== context.productHome) fail(`${label}: authority productHome`);
    const hashesInput = exact(
      input.processTableTemplateHashes,
      PREVIEW_TABLE_HASH_KEYS,
      `${label}: processTableTemplateHashes`,
    );
    const launchdHashesInput =
      hashesInput.launchd === null
        ? null
        : exact(hashesInput.launchd, PREVIEW_LAUNCHD_TABLE_HASH_KEYS, `${label}: processTableTemplateHashes`);
    const normalizedProjection = leaves.projection.validate(input.normalizedProjection);
    const subsystem = leaves.projectionSubsystem(normalizedProjection);
    const command = literal(input.command, LIFECYCLE_PREVIEW_COMMANDS, `${label}: command`);
    const executionOperation = literal(
      input.executionOperation,
      LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS,
      `${label}: executionOperation`,
    );
    const prefix = subsystem === "git" ? "git_" : "automation_";
    if (!command.startsWith(prefix) || !executionOperation.startsWith(prefix)) fail(`${label}: subsystem`);
    const git = input.git === null ? null : leaves.gitPreview.validate(input.git);
    const launchd = input.launchd === null ? null : leaves.launchdPreview.validate(input.launchd);
    const gitTableHash = nullableHash(hashesInput.git);
    if (subsystem === "git") {
      if (git === null || launchd !== null || gitTableHash === null || launchdHashesInput !== null) {
        fail(`${label}: Git preview arms`);
      }
    } else {
      if (git !== null || launchd === null || gitTableHash !== null || launchdHashesInput === null) {
        fail(`${label}: automation preview arms`);
      }
      const nested = leaves.launchdPreviewTableHashes(launchd);
      if (
        launchdHashesInput.observation !== nested.observation ||
        launchdHashesInput.mutationTemplate !== nested.mutationTemplate
      ) {
        fail(`${label}: launchd table hashes`);
      }
    }
    const preview: Preview = {
      schemaVersion: 1,
      previewHash: parseLowerHexSha256(input.previewHash),
      command,
      executionOperation,
      normalizedProjection,
      authority: {
        productHome: context.productHome,
        configPath: parseCanonicalAbsolutePathText(authorityInput.configPath),
        activationPath: parseCanonicalAbsolutePathText(authorityInput.activationPath),
        manifestPath: parseCanonicalAbsolutePathText(authorityInput.manifestPath),
      },
      processTableTemplateHashes: {
        git: gitTableHash,
        launchd:
          launchdHashesInput === null
            ? null
            : {
                observation: parseLowerHexSha256(launchdHashesInput.observation),
                mutationTemplate: parseLowerHexSha256(launchdHashesInput.mutationTemplate),
              },
      },
      files: parsePreviewFileChanges(input.files, label),
      git,
      launchd,
    };
    if (preview.previewHash !== previewDigest(previewJson(preview))) fail(`${label}: previewHash`);
    return preview;
  }

  function validateJournal(value: unknown): LifecycleCoordinatorJournalV1 {
    const label = "LifecycleCoordinatorJournalV1";
    const input = exact(value, JOURNAL_KEYS, label);
    if (input.schemaVersion !== 1) fail(`${label}: schemaVersion`);
    const phase = literal(input.phase, LIFECYCLE_COORDINATOR_PHASES, `${label}: phase`);
    const compacting = phase === "compacting";
    const compensating = phase === "compensating" || phase === "rolled_back";
    if (compacting !== (input.compactionNext !== null)) fail(`${label}: compactionNext`);
    if (compacting !== (input.terminalOutcome !== null)) fail(`${label}: terminalOutcome`);
    if (compensating !== (input.compensationNext !== null)) fail(`${label}: compensationNext`);
    return {
      schemaVersion: 1,
      id: parseLifecycleCoordinatorId(input.id, context.nonce),
      operation: literal(input.operation, LIFECYCLE_COORDINATOR_OPERATIONS, `${label}: operation`),
      phase,
      planHash: parseLowerHexSha256(input.planHash),
      pushPlanHash: nullableHash(input.pushPlanHash),
      nextStep: integer(input.nextStep, LIFECYCLE_PLAN_BOUNDS.nextStep, `${label}: nextStep`),
      compensationNext: compensating
        ? integer(input.compensationNext, LIFECYCLE_PLAN_BOUNDS.compensationNext, `${label}: compensationNext`)
        : null,
      compactionNext: compacting
        ? integer(input.compactionNext, LIFECYCLE_PLAN_BOUNDS.compactionNext, `${label}: compactionNext`)
        : null,
      terminalOutcome: compacting
        ? literal(input.terminalOutcome, LIFECYCLE_TERMINAL_OUTCOMES, `${label}: terminalOutcome`)
        : null,
      createdAt: parseUtcTimestamp(input.createdAt),
      updatedAt: parseUtcTimestamp(input.updatedAt),
    };
  }

  return {
    executionPlan: {
      validate: validatePlan,
      encode: (plan) =>
        bounded(encodeCanonicalJson(planJson(plan)), LIFECYCLE_PLAN_BOUNDS.planBytes, "LifecycleCoordinatorPlanV1"),
      hash: (plan) => hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.coordinatorPlan, planJson(plan)),
    },
    preview: {
      validate: validatePreview,
      encode: (preview) => encodeCanonicalJson(previewJson(preview)),
    },
    coordinatorJournal: {
      validate: validateJournal,
      encode: (journal) =>
        bounded(
          encodeCanonicalJson(json(journal)),
          LIFECYCLE_PLAN_BOUNDS.journalBytes,
          "LifecycleCoordinatorJournalV1",
        ),
    },
  };
}
