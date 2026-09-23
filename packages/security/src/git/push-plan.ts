/**
 * Spec 1 §4.4's `PersistedGitPushPlanV1`: the retry-persisted subset of a
 * sync plan. It binds Security hashes (distribution, process table, shadow
 * templates), so it lives here rather than in Core. `processTableHash` is
 * shape-checked only: a plan persisted before a re-pin must reach the §4.4
 * step-1 recheck and refuse `unsupported_git_distribution` there, not die
 * here as a malformed record.
 */
import {
  encodeCanonicalJson,
  GIT_REMOTE_NAME,
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseFullBranchRef,
  parseGitEffectId,
  parseLowerHexSha1,
  parseLowerHexSha256,
  parseNormalizedRemoteUrl,
  validateGitHeadState,
  validateGitRefState,
  validateGitReflogState,
  validateGitSourceState,
  validateGitSyncPlanCore,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonV1,
  type CanonicalJsonValue,
  type FullBranchRefV1,
  type GitEffectIdV1,
  type GitHeadStateV1,
  type GitRefStateV1,
  type GitReflogStateV1,
  type GitSourceStateV1,
  type GitSyncPlanCoreV1,
  type LifecycleHashedValueCodec,
  type LowerHexSha1,
  type LowerHexSha256,
  type NormalizedRemoteUrlV1,
} from "@developer-os/core";

import { SUPPORTED_GIT_DISTRIBUTION_ID } from "./process-table.js";

const PUSH_PLAN_DOMAIN = "developer-os:git-push-plan:v1";

export type PersistedGitPushDestinationV1 =
  | { readonly transport: "https" | "ssh"; readonly effectivePushUrl: NormalizedRemoteUrlV1 }
  | {
      readonly transport: "local";
      readonly effectivePushUrl: NormalizedRemoteUrlV1;
      readonly repositoryRoot: CanonicalAbsolutePathV1;
      readonly configHash: LowerHexSha256;
      readonly head: GitHeadStateV1;
      readonly targetRef: GitRefStateV1;
      readonly targetReflog: GitReflogStateV1;
      readonly destinationShadowConfigTemplateHash: LowerHexSha256;
      readonly destinationGitEffect: { readonly id: GitEffectIdV1; readonly planHash: LowerHexSha256 };
    };

export interface PersistedGitPushPlanV1 {
  readonly schemaVersion: 1;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branchRef: FullBranchRefV1;
  readonly commitOid: LowerHexSha1;
  readonly remoteName: "developer-os";
  readonly sourceShadowConfigTemplateHash: LowerHexSha256;
  readonly destination: PersistedGitPushDestinationV1;
  readonly sourceBefore: GitSourceStateV1;
  readonly sourceAfter: GitSourceStateV1;
  readonly distributionId: typeof SUPPORTED_GIT_DISTRIBUTION_ID;
  readonly processTableHash: LowerHexSha256;
}

export type GitSyncPlanV1 = GitSyncPlanCoreV1<PersistedGitPushPlanV1>;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) fail(`${label}: keys`);
  return input;
}

const LOCAL_DESTINATION_KEYS = [
  "transport",
  "effectivePushUrl",
  "repositoryRoot",
  "configHash",
  "head",
  "targetRef",
  "targetReflog",
  "destinationShadowConfigTemplateHash",
  "destinationGitEffect",
];

function validateDestination(value: unknown): PersistedGitPushDestinationV1 {
  const label = "PersistedGitPushPlanV1.destination";
  if (typeof value !== "object" || value === null) fail(label);
  const transport = (value as { readonly transport?: unknown }).transport;
  if (transport === "https" || transport === "ssh") {
    const input = exact(value, ["transport", "effectivePushUrl"], label);
    return { transport, effectivePushUrl: parseNormalizedRemoteUrl(input.effectivePushUrl, transport) };
  }
  if (transport !== "local") fail(`${label}.transport`);
  const input = exact(value, LOCAL_DESTINATION_KEYS, label);
  const effect = exact(input.destinationGitEffect, ["id", "planHash"], `${label}.destinationGitEffect`);
  return {
    transport,
    effectivePushUrl: parseNormalizedRemoteUrl(input.effectivePushUrl, "local"),
    repositoryRoot: parseCanonicalAbsolutePathText(input.repositoryRoot),
    configHash: parseLowerHexSha256(input.configHash),
    head: validateGitHeadState(input.head),
    targetRef: validateGitRefState(input.targetRef),
    targetReflog: validateGitReflogState(input.targetReflog),
    destinationShadowConfigTemplateHash: parseLowerHexSha256(input.destinationShadowConfigTemplateHash),
    destinationGitEffect: { id: parseGitEffectId(effect.id), planHash: parseLowerHexSha256(effect.planHash) },
  };
}

const PUSH_PLAN_KEYS = [
  "schemaVersion",
  "repositoryRoot",
  "branchRef",
  "commitOid",
  "remoteName",
  "sourceShadowConfigTemplateHash",
  "destination",
  "sourceBefore",
  "sourceAfter",
  "distributionId",
  "processTableHash",
];

export function validatePersistedGitPushPlan(value: unknown): PersistedGitPushPlanV1 {
  const label = "PersistedGitPushPlanV1";
  const input = exact(value, PUSH_PLAN_KEYS, label);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  if (input.remoteName !== GIT_REMOTE_NAME) fail(`${label}.remoteName`);
  if (input.distributionId !== SUPPORTED_GIT_DISTRIBUTION_ID) fail(`${label}.distributionId`);
  const branchRef = parseFullBranchRef(input.branchRef);
  const commitOid = parseLowerHexSha1(input.commitOid);
  const sourceBefore = validateGitSourceState(input.sourceBefore);
  const sourceAfter = validateGitSourceState(input.sourceAfter);
  if (sourceAfter.branchRef.state !== "present" || sourceAfter.branchRef.oid !== commitOid) fail(`${label}.sourceAfter.branchRef`);
  const head = sourceAfter.head.semantic;
  if (head.kind !== "symbolic_ref" || head.value !== branchRef) fail(`${label}.sourceAfter.head`);
  const destination = validateDestination(input.destination);
  if (destination.transport === "local" && destination.repositoryRoot === input.repositoryRoot) fail(`${label}.destination.repositoryRoot`);
  return {
    schemaVersion: 1,
    repositoryRoot: parseCanonicalAbsolutePathText(input.repositoryRoot),
    branchRef,
    commitOid,
    remoteName: GIT_REMOTE_NAME,
    sourceShadowConfigTemplateHash: parseLowerHexSha256(input.sourceShadowConfigTemplateHash),
    destination,
    sourceBefore,
    sourceAfter,
    distributionId: SUPPORTED_GIT_DISTRIBUTION_ID,
    processTableHash: parseLowerHexSha256(input.processTableHash),
  };
}

export const PERSISTED_GIT_PUSH_PLAN_CODEC: LifecycleHashedValueCodec<PersistedGitPushPlanV1> = Object.freeze({
  validate: validatePersistedGitPushPlan,
  encode: (plan: PersistedGitPushPlanV1): CanonicalJsonV1 => encodeCanonicalJson(plan as unknown as CanonicalJsonValue),
  hash: (plan: PersistedGitPushPlanV1): LowerHexSha256 => hashCanonicalJson(PUSH_PLAN_DOMAIN, plan as unknown as CanonicalJsonValue),
});

export function validateGitSyncPlan(value: unknown): GitSyncPlanV1 {
  return validateGitSyncPlanCore(value, PERSISTED_GIT_PUSH_PLAN_CODEC);
}
