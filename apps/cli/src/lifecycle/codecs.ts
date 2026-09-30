/**
 * Spec 1 §8.1's CLI-owned execution-plan codec: the composition root that binds the kernel's typed
 * leaves to the Git, launchd and push codecs their owning packages validate.
 */
import {
  EXIT_CODES,
  GIT_PLAN_PREVIEW_CODEC,
  SCHEDULED_JOB_IDS,
  createLifecycleCodecs,
  encodeCanonicalJson,
  parseAutomationConfig,
  parseCanonicalAbsolutePathText,
  parseGitSyncConfig,
  parseLowerHexSha256,
  parseManifestParticipantId,
  validateManifestStatePlan,
} from "@developer-os/core";
import type {
  AutomationConfigV1,
  CanonicalAbsolutePathV1,
  GitPlanPreviewV1,
  GitSyncConfigV1,
  LifecycleCodecContextV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorPlanCoreV1,
  LifecycleInstallNonceV1,
  LifecycleLeafCodecsV1,
  LifecyclePlanPreviewCoreV1,
  LifecycleValueCodec,
  LifecycleVariantFactsV1,
  LowerHexSha256,
  ManifestStatePlanAdmissionContextV1,
  ManifestStatePlanV1,
} from "@developer-os/core";
import {
  LAUNCHD_PLAN_CODEC,
  LAUNCHD_PLAN_PREVIEW_CODEC,
  assertLaunchdPlanBindings,
  launchdPlanVariant,
} from "@developer-os/platform-macos";
import type { LaunchdPlanPreviewV1, LaunchdPlanV1 } from "@developer-os/platform-macos";
import { PERSISTED_GIT_PUSH_PLAN_CODEC } from "@developer-os/security";
import type { PersistedGitPushPlanV1 } from "@developer-os/security";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createRedactionKeyStatePlanCodec } from "./redaction-key.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

/**
 * `failureFrom` publishes `kindOf(name)`, and the published contract for every 1b-deferred
 * arm is its `reason`, so the name is spelled to make the two equal — see
 * `uninstall.ts`'s `refuseUnsupportedUntilPlan1b` for the same rule.
 */
export class LifecycleUnsupportedLeafError extends Error {
  readonly code: typeof EXIT_CODES.capabilityUnavailable = EXIT_CODES.capabilityUnavailable;
  readonly reason = "unsupported_until_plan_1b" as const;
  readonly arm: string;

  constructor(arm: string) {
    super(`the ${arm} lifecycle arm is unsupported until plan 1b`);
    this.name = "Unsupported_until_plan_1bError";
    this.arm = arm;
  }
}

export type LifecycleExecutionPlanV1 = LifecycleCoordinatorPlanCoreV1<
  ManifestStatePlanV1,
  LaunchdPlanV1,
  RedactionKeyStatePlanV1,
  PersistedGitPushPlanV1
>;

export type LifecycleNormalizedProjectionV1 =
  | { readonly subsystem: "git"; readonly enabledAfter: boolean; readonly lifecycle: GitSyncConfigV1 | null }
  | { readonly subsystem: "automation"; readonly enabledAfter: boolean; readonly lifecycle: AutomationConfigV1 | null };

export type LifecyclePlanPreviewV1 = LifecyclePlanPreviewCoreV1<
  LifecycleNormalizedProjectionV1,
  GitPlanPreviewV1,
  LaunchdPlanPreviewV1
>;

/**
 * What the lifecycle services need to know about a home. It never requires an admitted
 * manifest: recovery after `M(preserve_before)` runs with the manifest gone, and after the
 * uninstall control-file steps with the nonce gone.
 */
export interface LifecycleHomeKeyV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly nonce: LifecycleInstallNonceV1;
}

const COORDINATOR_ID_GRAMMAR = /^lc_([0-9a-f]{64})_(?:0|[1-9][0-9]*)$/u;

/** Parses the nonce out of `lc_<nonce>_<counter>`; refuses any other grammar. */
export function lifecycleHomeKeyFromCoordinatorId(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: string,
): LifecycleHomeKeyV1 {
  const match = COORDINATOR_ID_GRAMMAR.exec(coordinatorId);
  if (match === null) throw new Error("invalid LifecycleCoordinatorIdV1");
  return { productHome, nonce: parseLowerHexSha256(match[1]) };
}

const PROJECTION_KEYS = ["enabledAfter", "lifecycle", "subsystem"];

const projectionLeaf: LifecycleValueCodec<LifecycleNormalizedProjectionV1> = {
  validate(value: unknown): LifecycleNormalizedProjectionV1 {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("invalid LifecycleNormalizedProjectionV1");
    }
    const input = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(input).sort();
    if (keys.length !== PROJECTION_KEYS.length || keys.some((key, index) => key !== PROJECTION_KEYS[index])) {
      throw new Error("invalid LifecycleNormalizedProjectionV1: keys");
    }
    if (typeof input.enabledAfter !== "boolean") throw new Error("invalid LifecycleNormalizedProjectionV1: enabledAfter");
    const enabledAfter = input.enabledAfter;
    if (input.subsystem === "git") {
      return {
        subsystem: "git",
        enabledAfter,
        lifecycle: input.lifecycle === null ? null : parseGitSyncConfig(input.lifecycle),
      };
    }
    if (input.subsystem === "automation") {
      return {
        subsystem: "automation",
        enabledAfter,
        lifecycle: input.lifecycle === null ? null : parseAutomationConfig(input.lifecycle),
      };
    }
    throw new Error("invalid LifecycleNormalizedProjectionV1: subsystem");
  },
  encode: (value) => encodeCanonicalJson(value as never),
};

/** Pass one: structure only. The binding to the validated core is pass two, which owns every rule. */
const structuralManifestLeaf: LifecycleValueCodec<ManifestStatePlanV1> = {
  validate(value: unknown): ManifestStatePlanV1 {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("invalid ManifestStatePlanV1");
    }
    return value as ManifestStatePlanV1;
  },
  encode: (value) => encodeCanonicalJson(value as never),
};

/**
 * A14: planning derives the evidence from the observed manifest, configuration and activation
 * record, and the plan hash binds the resulting shape — so a persisted plan's variant is read
 * back off that bound shape rather than off a separately stored choice. The grammar ties the push
 * leaf to `N`/`D` and the launchd leaf to the four launchd variants, so each fact reads one leaf.
 */
export function lifecycleVariantFacts(plan: LifecycleExecutionPlanV1): LifecycleVariantFactsV1 {
  const launchd = plan.participants.launchd;
  let automationReconcile: LifecycleVariantFactsV1["automationReconcile"] = null;
  if (plan.operation === "automation_reconcile") {
    automationReconcile =
      launchd !== null && launchdPlanVariant(launchd) === "automation_reconcile/live_only" ? "live_only" : "files";
  }
  return {
    gitSync:
      plan.operation === "git_sync"
        ? {
            newCommit: plan.participants.sourceGitEffect !== null,
            transport: plan.push?.destination.transport === "local" ? "local" : "network",
            noChanges: plan.push === null,
          }
        : null,
    automationReconcile,
    uninstallLaunchdEvidence: plan.operation === "uninstall" ? launchd !== null : null,
  };
}

export function lifecyclePushPlanHash(plan: LifecycleExecutionPlanV1): LowerHexSha256 | null {
  return plan.push === null ? null : PERSISTED_GIT_PUSH_PLAN_CODEC.hash(plan.push);
}

export function uninstallLeasePaths(
  productHome: CanonicalAbsolutePathV1,
): readonly CanonicalAbsolutePathV1[] {
  return SCHEDULED_JOB_IDS.map((job) =>
    parseCanonicalAbsolutePathText(`${productHome}/state/.automation-${job}.lock`),
  );
}

export function manifestBeforeHashOf(plan: LifecycleExecutionPlanV1): LowerHexSha256 | null {
  const before = plan.participants.manifest?.before;
  return before !== undefined && before.state === "present" ? before.hash : null;
}

type ManifestExternalEffectV1 = ManifestStatePlanV1["bindings"]["externalEffects"][number];

/** The plan's own journaled effects, the only external effects its manifest participant may name. */
function planExternalEffects(plan: LifecycleExecutionPlanV1): readonly ManifestExternalEffectV1[] {
  const { sourceGitEffect, destinationGitEffect, launchdBeforeFiles, launchdAfterFiles } = plan.participants;
  return [
    ...[sourceGitEffect, destinationGitEffect].flatMap((ref) =>
      ref === null ? [] : [{ kind: "git" as const, id: ref.id, planHash: ref.planHash }],
    ),
    ...[launchdBeforeFiles, launchdAfterFiles].flatMap((ref) =>
      ref === null ? [] : [{ kind: "launchd" as const, id: ref.id, planHash: ref.planHash }],
    ),
  ];
}

function sameExternalEffect(left: ManifestExternalEffectV1, right: unknown): boolean {
  if (typeof right !== "object" || right === null) return false;
  const candidate = right as Readonly<Record<string, unknown>>;
  return candidate.kind === left.kind && candidate.id === left.id && candidate.planHash === left.planHash;
}

export function lifecycleManifestPlanAdmission(
  plan: LifecycleExecutionPlanV1,
  manifest: ManifestStatePlanV1,
  context: LifecycleCodecContextV1,
): ManifestStatePlanAdmissionContextV1 {
  const forwardIds = plan.steps
    .filter((step) => step.kind === "foundation")
    .map((step) => step.participantId as string);
  const owned = planExternalEffects(plan);
  // The structural leaf has not proved `bindings` or `after` yet: pass two is what refuses their shape.
  const raw = manifest as {
    readonly bindings?: { readonly externalEffects?: unknown };
    readonly after?: { readonly dev?: unknown; readonly ino?: unknown };
  };
  const listed: readonly unknown[] = Array.isArray(raw.bindings?.externalEffects) ? raw.bindings.externalEffects : [];
  return {
    evidence: createCanonicalPathEvidence(),
    productHome: context.productHome,
    manifestPath: plan.authority.manifestPath,
    foundationTransactionIds: forwardIds,
    externalEffects: listed.flatMap((entry) => owned.filter((effect) => sameExternalEffect(effect, entry))),
    admitParticipant: (envelope, participantId) => {
      const refused = "mf_refused" as ReturnType<
        ManifestStatePlanAdmissionContextV1["admitParticipant"]
      >;
      if (envelope.kind !== "lifecycle" || envelope.id !== plan.id) return refused;
      try {
        return parseManifestParticipantId(participantId, context.nonce);
      } catch {
        return refused;
      }
    },
    admitExternalEffect: (ref) => (owned.some((effect) => sameExternalEffect(effect, ref)) ? ref.id : "refused"),
    lifecycleIdentity: "inline",
    /**
     * The staged postimage's identity is the one the plan hash binds; the participant's guarded
     * move re-proves it against the inode before the payload is published.
     */
    updatePayloadIdentity: () =>
      ({ dev: raw.after?.dev, ino: raw.after?.ino }) as ReturnType<
        NonNullable<ManifestStatePlanAdmissionContextV1["updatePayloadIdentity"]>
      >,
  };
}

export function createLifecycleExecutionCodecs(context: LifecycleCodecContextV1): {
  readonly executionPlan: LifecycleValueCodec<LifecycleExecutionPlanV1>;
  readonly preview: LifecycleValueCodec<LifecyclePlanPreviewV1>;
  readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
} {
  const leaves: LifecycleLeafCodecsV1<
    ManifestStatePlanV1,
    LaunchdPlanV1,
    RedactionKeyStatePlanV1,
    PersistedGitPushPlanV1,
    LifecycleNormalizedProjectionV1,
    GitPlanPreviewV1,
    LaunchdPlanPreviewV1
  > = {
    manifest: structuralManifestLeaf,
    launchd: LAUNCHD_PLAN_CODEC,
    redactionKey: createRedactionKeyStatePlanCodec(context),
    push: PERSISTED_GIT_PUSH_PLAN_CODEC,
    pushPlanHash: (push) => PERSISTED_GIT_PUSH_PLAN_CODEC.hash(push),
    projection: projectionLeaf,
    gitPreview: GIT_PLAN_PREVIEW_CODEC,
    launchdPreview: LAUNCHD_PLAN_PREVIEW_CODEC,
    projectionSubsystem: (projection) => projection.subsystem,
    launchdPreviewTableHashes: (preview) => ({
      observation: preview.observationProcessTableHash,
      mutationTemplate: preview.mutationProcessTableTemplateHash,
    }),
  };
  const core = createLifecycleCodecs(leaves, context);
  return {
    executionPlan: {
      validate(value: unknown): LifecycleExecutionPlanV1 {
        const plan = core.executionPlan.validate(value);
        if (plan.participants.launchd !== null) assertLaunchdPlanBindings(plan.participants.launchd, plan);
        const manifest = plan.participants.manifest;
        if (manifest === null) return plan;
        return {
          ...plan,
          participants: {
            ...plan.participants,
            manifest: validateManifestStatePlan(manifest, lifecycleManifestPlanAdmission(plan, manifest, context)),
          },
        };
      },
      encode: (plan) => core.executionPlan.encode(plan),
    },
    preview: core.preview,
    coordinatorJournal: core.coordinatorJournal,
  };
}

export function createLifecycleExecutionPlanCodec(
  context: LifecycleCodecContextV1,
): LifecycleValueCodec<LifecycleExecutionPlanV1> {
  return createLifecycleExecutionCodecs(context).executionPlan;
}
