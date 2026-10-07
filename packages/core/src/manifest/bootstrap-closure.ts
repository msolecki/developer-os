import { createHash } from "node:crypto";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { CanonicalAbsolutePathV1, CanonicalPathEvidenceV1 } from "../update/paths.js";
import type { LowerHexSha256 } from "../update/scalars.js";
import {
  BOOTSTRAP_MAX_JOURNAL_BYTES,
  BOOTSTRAP_MAX_PLAN_BYTES,
  deriveBootstrapEnvelopePaths,
  validateBootstrapJournal,
  validateBootstrapPlan,
} from "./bootstrap.js";
import type {
  BootstrapPlanAdmissionContextV1,
  FoundationParticipantRefV2,
  FreshV2InitPlanV1,
  PlannedCreatedPathV1,
} from "./bootstrap.js";
import { BOOTSTRAP_RETAINED_MAX_ENTRIES } from "./bootstrap-retention.js";
import type { BootstrapJournalSelectionV1 } from "./bootstrap-retention.js";
import { validateManifestStatePlan } from "./manifest-state.js";
import type { FreshV2InitIdV1, ManifestStatePlanAdmissionContextV1 } from "./manifest-state.js";

/**
 * The bootstrap envelope's closure admission, shared by the CLI's evidence report and the
 * launcher's bootstrap-closure reader (NEW-111). It performs no I/O: the caller reads the bytes
 * and supplies the canonical-path evidence its own process can produce.
 */

const MAX_CREATED_PATHS = 1_000_000;
const MAX_LAUNCHABILITY_PATHS = 200_006;
const MAX_FOUNDATION_PARTICIPANTS = 512;
const encoder = new TextEncoder();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedArray(value: unknown, minimum: number, maximum: number): readonly unknown[] | null {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum ? value : null;
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function lowerHash(value: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

function manifestPlanAdmission(
  plan: FreshV2InitPlanV1,
  productHome: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
): ManifestStatePlanAdmissionContextV1 {
  const forwardIds = plan.foundationParticipants
    .filter((participant) => participant.role.kind === "forward")
    .map((participant) => participant.id);
  return {
    evidence,
    productHome,
    manifestPath: `${productHome}/installation-manifest.json` as CanonicalAbsolutePathV1,
    foundationTransactionIds: forwardIds,
    externalEffects: [],
    admitParticipant: (envelope, participantId) =>
      envelope.kind === "fresh_v2_init" && envelope.id === plan.id && participantId === `mf_${plan.id}`
        ? participantId as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>
        : "mf_refused" as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>,
    admitExternalEffect: () => "refused",
    bootstrapPayloadIdentity: (ref) =>
      plan.payloads.some((row) => sameValue(row.ref, ref))
        ? { dev: "1", ino: "1" } as NonNullable<ReturnType<NonNullable<ManifestStatePlanAdmissionContextV1["bootstrapPayloadIdentity"]>>>
        : null,
  };
}

function planAdmission(
  plan: FreshV2InitPlanV1,
  productHome: CanonicalAbsolutePathV1,
  stateDirectory: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
): BootstrapPlanAdmissionContextV1 {
  return {
    evidence,
    productHome,
    stateRoot: stateDirectory,
    productStagingRoot: `${productHome}/staging` as CanonicalAbsolutePathV1,
    operation: "fresh_v2_init",
    id: plan.id,
    bootstrapIdentity: plan.bootstrapIdentity,
    externalShape: null,
    admitFreshRecoveryExternalShape: (hash, identity) =>
      hash === plan.admittedExternalShapeHash && sameValue(identity, plan.bootstrapIdentity) ? hash : "refused",
    admitPayloadSource: (source, ref) => {
      const found = plan.payloads.find((row) => sameValue(row.ref, ref) && sameValue(row.source, source));
      return structuredClone(found?.source ?? { kind: "constant_empty", role: "empty_reservation" });
    },
    admitPlannedCreatedPath: (candidate, scope, ordinal) => {
      const expected = scope === "ordinary" ? plan.createdPaths[ordinal] : plan.launchabilityPaths[ordinal];
      return structuredClone(expected !== undefined && sameValue(expected, candidate)
        ? expected
        : plan.createdPaths[0] as PlannedCreatedPathV1);
    },
    admitPreexistingParent: (candidate) => {
      const parents = [...plan.createdPaths, ...plan.launchabilityPaths]
        .map((planned) => planned.parent)
        .filter((parent) => parent.kind === "preexisting");
      const expected = parents.find((parent) => sameValue(parent, candidate));
      return structuredClone(expected ?? parents[0]) as ReturnType<BootstrapPlanAdmissionContextV1["admitPreexistingParent"]>;
    },
    admitFoundationParticipant: (candidate) => {
      const expected = plan.foundationParticipants.find((participant) => sameValue(participant, candidate));
      return structuredClone(expected ?? plan.foundationParticipants[0]) as FoundationParticipantRefV2;
    },
    admitManifestParticipant: (candidate) => validateManifestStatePlan(
      candidate,
      manifestPlanAdmission(plan, productHome, evidence),
    ),
    admitPlanDerivedValue: (role, value) => {
      const expected = plan.payloads.map((row) => row.source).find((source) =>
        source.kind === "plan_derived" && source.role === role && sameValue(source.value, value));
      return expected?.kind === "plan_derived" ? structuredClone(expected.value) : { refused: true };
    },
  };
}

/** The one structural/closure admission used by reporting, executor recovery and the launcher. */
export function admitBootstrapEvidencePlan(
  value: unknown,
  input: {
    readonly productHome: CanonicalAbsolutePathV1;
    readonly stateDirectory: CanonicalAbsolutePathV1;
    readonly expectedId: FreshV2InitIdV1;
  },
  evidence: CanonicalPathEvidenceV1,
): FreshV2InitPlanV1 {
  const candidate = record(value);
  const payloads = boundedArray(candidate?.payloads, 1, BOOTSTRAP_RETAINED_MAX_ENTRIES);
  const createdPaths = boundedArray(candidate?.createdPaths, 1, MAX_CREATED_PATHS);
  const participants = boundedArray(candidate?.foundationParticipants, 2, MAX_FOUNDATION_PARTICIPANTS);
  const launchabilityPaths = boundedArray(candidate?.launchabilityPaths, 7, MAX_LAUNCHABILITY_PATHS);
  const slots = boundedArray(candidate?.journalSlots, 2, 2);
  const envelope = deriveBootstrapEnvelopePaths(input.productHome, input.expectedId);
  if (
    candidate === null || candidate.schemaVersion !== 1 || candidate.operation !== "fresh_v2_init" ||
    candidate.id !== input.expectedId || candidate.planPath !== envelope.plan ||
    candidate.stagingRoot !== envelope.stagingRoot || candidate.maximumPlanBytes !== BOOTSTRAP_MAX_PLAN_BYTES ||
    candidate.maximumJournalBytes !== BOOTSTRAP_MAX_JOURNAL_BYTES || payloads === null || createdPaths === null ||
    participants === null || launchabilityPaths === null || slots === null ||
    slots.some((slot, ordinal) => record(slot)?.path !== envelope.journalSlots[ordinal]) ||
    record(candidate.bootstrapIdentity)?.path !== `${input.stateDirectory}/.lifecycle-bootstrap.lock`
  ) throw new Error("persisted bootstrap plan failed bounded structural admission");
  const freshCandidate = candidate as unknown as FreshV2InitPlanV1;
  return validateBootstrapPlan(
    freshCandidate,
    planAdmission(freshCandidate, input.productHome, input.stateDirectory, evidence),
  );
}

export function selectBootstrapEvidenceJournal(
  plan: FreshV2InitPlanV1,
  values: readonly [unknown, unknown],
): BootstrapJournalSelectionV1 | null {
  const admitted = values.flatMap((value) => {
    try {
      return [validateBootstrapJournal(plan, value)];
    } catch {
      return [];
    }
  });
  admitted.sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? 1 : -1);
  const current = admitted[0];
  if (current === undefined || current.slot !== Number(BigInt(current.sequence) % 2n)) return null;
  const previous = admitted[1];
  if (
    previous !== undefined &&
    (BigInt(previous.sequence) + 1n !== BigInt(current.sequence) ||
      current.previousJournalHash !== lowerHash(encoder.encode(encodeCanonicalJson(previous as unknown as CanonicalJsonValue))))
  ) return null;
  return { current, inactiveSlot: current.slot === 0 ? 1 : 0 };
}
