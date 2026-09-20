/**
 * Spec 1 §8.1's CLI-owned execution-plan codec. Scope decisions 1 and 2 keep Git, launchd and
 * push typed but unreachable in plan 1a, so every leaf and every step those arms need refuses
 * here rather than becoming durable bytes no 1a code path can execute.
 */
import {
  EXIT_CODES,
  SCHEDULED_JOB_IDS,
  createLifecycleCodecs,
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseManifestParticipantId,
  validateManifestStatePlan,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleCodecContextV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorPlanCoreV1,
  LifecycleLeafCodecsV1,
  LifecycleValueCodec,
  LifecycleVariantFactsV1,
  LowerHexSha256,
  ManifestStatePlanAdmissionContextV1,
  ManifestStatePlanV1,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createRedactionKeyStatePlanCodec } from "./redaction-key.js";
import type { RedactionKeyStatePlanV1 } from "./redaction-key.js";

export class LifecycleUnsupportedLeafError extends Error {
  readonly code: typeof EXIT_CODES.capabilityUnavailable = EXIT_CODES.capabilityUnavailable;
  readonly reason = "unsupported_until_plan_1b" as const;
  readonly arm: string;

  constructor(arm: string) {
    super(`the ${arm} lifecycle arm is unsupported until plan 1b`);
    this.name = "LifecycleUnsupportedLeafError";
    this.arm = arm;
  }
}

export type LifecycleExecutionPlanV1 = LifecycleCoordinatorPlanCoreV1<
  ManifestStatePlanV1,
  never,
  RedactionKeyStatePlanV1,
  never
>;

const UNSUPPORTED_STEP_KINDS: readonly LifecycleExecutionPlanV1["steps"][number]["kind"][] = [
  "source_git_effect",
  "destination_git_effect",
  "launchd_before_files",
  "launchd_after_files",
  "network_push",
];

function unsupported<T>(arm: string): LifecycleValueCodec<T> {
  return {
    validate(): never {
      throw new LifecycleUnsupportedLeafError(arm);
    },
    encode(): never {
      throw new LifecycleUnsupportedLeafError(arm);
    },
  };
}

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
 * back off that bound shape rather than off a separately stored choice. Plan 1a admits only
 * the launchd-free uninstall, because every arm the `P` variant needs refuses above.
 */
export function lifecycleVariantFacts(plan: LifecycleExecutionPlanV1): LifecycleVariantFactsV1 {
  return {
    gitSync: null,
    automationReconcile: null,
    uninstallLaunchdEvidence: plan.operation === "uninstall" ? false : null,
  };
}

export function lifecyclePushPlanHash(plan: LifecycleExecutionPlanV1): null {
  return plan.push;
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

function manifestAdmissionFor(
  plan: LifecycleExecutionPlanV1,
  context: LifecycleCodecContextV1,
): ManifestStatePlanAdmissionContextV1 {
  const forwardIds = plan.steps
    .filter((step) => step.kind === "foundation")
    .map((step) => step.participantId as string);
  return {
    evidence: createCanonicalPathEvidence(),
    productHome: context.productHome,
    manifestPath: plan.authority.manifestPath,
    foundationTransactionIds: forwardIds,
    externalEffects: [],
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
    admitExternalEffect: () => "refused",
  };
}

function refuseUnsupportedArms(plan: LifecycleExecutionPlanV1): void {
  if (plan.operation !== "uninstall") throw new LifecycleUnsupportedLeafError(plan.operation);
  for (const [arm, reference] of [
    ["sourceGitEffect", plan.participants.sourceGitEffect],
    ["destinationGitEffect", plan.participants.destinationGitEffect],
    ["launchdBeforeFiles", plan.participants.launchdBeforeFiles],
    ["launchdAfterFiles", plan.participants.launchdAfterFiles],
  ] as const) {
    if (reference !== null) throw new LifecycleUnsupportedLeafError(arm);
  }
  for (const step of plan.steps) {
    if (UNSUPPORTED_STEP_KINDS.includes(step.kind)) {
      throw new LifecycleUnsupportedLeafError(step.kind);
    }
  }
}

export function createLifecycleExecutionCodecs(context: LifecycleCodecContextV1): {
  readonly executionPlan: LifecycleValueCodec<LifecycleExecutionPlanV1>;
  readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
} {
  const leaves: LifecycleLeafCodecsV1<
    ManifestStatePlanV1,
    never,
    RedactionKeyStatePlanV1,
    never,
    never,
    never,
    never
  > = {
    manifest: structuralManifestLeaf,
    launchd: unsupported<never>("launchd"),
    redactionKey: createRedactionKeyStatePlanCodec(context),
    push: unsupported<never>("push"),
    pushPlanHash: () => {
      throw new LifecycleUnsupportedLeafError("push");
    },
    projection: unsupported<never>("preview projection"),
    gitPreview: unsupported<never>("Git preview"),
    launchdPreview: unsupported<never>("launchd preview"),
    projectionSubsystem: () => {
      throw new LifecycleUnsupportedLeafError("preview projection");
    },
    launchdPreviewTableHashes: () => {
      throw new LifecycleUnsupportedLeafError("launchd preview");
    },
  };
  const core = createLifecycleCodecs(leaves, context);
  return {
    executionPlan: {
      validate(value: unknown): LifecycleExecutionPlanV1 {
        const plan = core.executionPlan.validate(value);
        refuseUnsupportedArms(plan);
        const manifest = plan.participants.manifest;
        if (manifest === null) return plan;
        return {
          ...plan,
          participants: {
            ...plan.participants,
            manifest: validateManifestStatePlan(manifest, manifestAdmissionFor(plan, context)),
          },
        };
      },
      encode: (plan) => core.executionPlan.encode(plan),
    },
    coordinatorJournal: core.coordinatorJournal,
  };
}

export function createLifecycleExecutionPlanCodec(
  context: LifecycleCodecContextV1,
): LifecycleValueCodec<LifecycleExecutionPlanV1> {
  return createLifecycleExecutionCodecs(context).executionPlan;
}
