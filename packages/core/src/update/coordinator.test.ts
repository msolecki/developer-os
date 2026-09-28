import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { LifecycleRecoveryRequiredError } from "../lifecycle/guarded-fs.js";
import { classifyLifecycleJournalClosureV2 } from "../lifecycle/recovery.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { updateLeafPlanPath, updateRecoveryExecutorStagedPath, type ImmutableUpdatePlanRefV1, type UpdateLeafPlanKindV1 } from "./construction.js";
import {
  MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES,
  MAXIMUM_UPDATE_COMPACTION_ENTRIES,
  MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES,
  MAXIMUM_UPDATE_COORDINATOR_STEPS,
  MAXIMUM_UPDATE_RETIREMENT_LEAVES,
  UpdateLifecycleCoordinator,
  advanceUpdateCoordinatorJournal,
  assertUpdateCoordinatorDerivation,
  buildUpdateCoordinatorPlan,
  deriveUpdateCompactionEntries,
  deriveUpdateSteps,
  initialUpdateCoordinatorJournal,
  readLifecycleExecutionPlanV2,
  updateCompensationCursor,
  updateCoordinatorJournalBytes,
  updateCoordinatorOuterBytes,
  updateCoordinatorPlanBytes,
  updateCoordinatorPlanHash,
  updateCoordinatorStagingRoot,
  updateExecutionBindingHash,
  updateRecoveryExecutorRecordBytes,
  updateRecoveryExecutorRecordHash,
  updateStepPhase,
  validateUpdateCoordinatorJournal,
  validateUpdateCoordinatorPlan,
  validateUpdateExecutionPlan,
  validateUpdateRecoveryExecutorRecord,
  type UpdateCoordinatorBoundaryV1,
  type UpdateCoordinatorJournalEventV1,
  type UpdateExecutionPlanV1,
  type UpdateFallbackHandoffV1,
  type UpdateLifecycleCoordinatorJournalV2,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateLifecycleOutcomeV1,
  type UpdateOperationV1,
  type UpdateRecoveryExecutorRecordV1,
  type UpdateStepOwnerV1,
} from "./coordinator.js";
import { UpdateStepRejectedError, type UpdateCompactionEntryV1, type UpdateLifecycleCoordinatorStepV1, type UpdateParticipantObservationV1 } from "./participants.js";
import { deriveUpdateExecutorRecordPath, parseCanonicalAbsolutePathText, type CanonicalPathEvidenceV1 } from "./paths.js";
import { PLANNER_PROTOCOL_V1, PLANNER_WIRE_BOUNDS_V1 } from "./planner.js";
import type { PlannerTranscriptIdentityV1 } from "./preview.js";
import { parseRollbackPayloadId } from "./preview.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, parsePositiveUInt32, parseSafeReasonCode, parseUtcTimestamp, type LowerHexSha256 } from "./scalars.js";

const nonce = "c".repeat(64);
const coordinatorId = `lc_${nonce}_5` as LifecycleCoordinatorIdV1;
const home = parseCanonicalAbsolutePathText("/synthetic/home/.developer-os");
const root = updateCoordinatorStagingRoot(home, coordinatorId);
const createdAt = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const clock = () => parseUtcTimestamp("2026-09-23T12:00:05.000Z");
const hex = (seed: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(seed).digest("hex"));
const clone = <T>(value: T): T => structuredClone(value);
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path) => path,
  containsCanonicalPath: (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}/`),
  hasFoldedAlias: () => false,
};
const fallback: UpdateFallbackHandoffV1 = { bundleManifestHash: hex("fallback-manifest"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };
const effectId = `oe_${nonce}_9`;
const planner: PlannerTranscriptIdentityV1 = { protocol: PLANNER_PROTOCOL_V1, bounds: PLANNER_WIRE_BOUNDS_V1, requestHash: hex("request"), inputBlobsHash: hex("input-blobs"), resultHash: hex("result"), outputBlobsHash: hex("output-blobs") };

function release(version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version,
    releaseSequence: sequence,
    releaseIdentityHash: hex(`identity-${version}`),
    delegationSequence: "1",
    delegationHash: hex("delegation"),
    releaseIndexSequence: sequence,
    releaseIndexHash: hex(`index-${version}`),
    bundleManifestHash: hex(`manifest-${version}`),
    bundleRoot: `${home}/releases/${version}/darwin-arm64`,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
  }, evidence);
}

const current = release("1.0.0", "1");
const target = release("1.1.0", "2");

function ref<TKind extends UpdateLeafPlanKindV1>(kind: TKind, id: string): ImmutableUpdatePlanRefV1<TKind> {
  return { kind, id, path: updateLeafPlanPath(root, kind, id), hash: hex(`${kind}/${id}`), bytes: 128 } as ImmutableUpdatePlanRefV1<TKind>;
}

const owners: readonly UpdateStepOwnerV1[] = [
  { id: ref("owner_update", "owner_core").id, owner: "core", externalEffects: [] },
  { id: ref("owner_update", "owner_codex").id, owner: "codex", externalEffects: [{ id: ref("owner_external_effect", effectId).id }] },
];

function records(operation: UpdateOperationV1): { readonly initial: UpdateRecoveryExecutorRecordV1; readonly terminal: UpdateRecoveryExecutorRecordV1 } {
  const executionBindingHash = updateExecutionBindingHash({ coordinatorId, operation, previewHash: hex("preview"), current, target });
  const common = { schemaVersion: 1, coordinatorId, operation, executionBindingHash, createdAt } as const;
  return {
    initial: { ...common, state: "executing", executor: { kind: "release_bundle", release: current } },
    terminal: { ...common, state: "terminal_cleanup", executor: { kind: "package_fallback", ...fallback } },
  };
}

function execution(operation: UpdateOperationV1 = "update_apply"): UpdateExecutionPlanV1 {
  const { initial, terminal } = records(operation);
  const staged = (record: UpdateRecoveryExecutorRecordV1, ordinal: number) => ({
    constructionOrdinal: ordinal,
    path: updateRecoveryExecutorStagedPath(root, record.state) as UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]["path"],
    bytes: updateRecoveryExecutorRecordBytes(record).byteLength,
    hash: updateRecoveryExecutorRecordHash(record),
    mode: 384 as const,
  });
  return {
    schemaVersion: 1,
    coordinatorId,
    operation,
    previewHash: hex("preview"),
    executionBindingHash: initial.executionBindingHash,
    maximumPlanBytes: 16_777_216,
    current,
    target,
    metadata: { delegationSequence: current.delegationSequence, delegationHash: current.delegationHash, delegatedReleaseKeyId: hex("release-key"), releaseIndexSequence: target.releaseIndexSequence, releaseIndexHash: target.releaseIndexHash },
    planner: operation === "update_apply" ? planner : null,
    bundle: ref("bundle_publication", "bundle"),
    owners: [ref("owner_update", "owner_core"), ref("owner_update", "owner_codex")],
    migrations: [ref("schema_migration", "migration_product-v2"), ref("schema_migration", "migration_brain-v2")],
    manifest: { transitional: ref("manifest_state", `mf_${nonce}_6`), terminal: ref("manifest_state", `mf_${nonce}_7`) },
    trust: operation === "update_apply" ? ref("release_trust_state", "trust") : null,
    active: ref("active_release_state", "active"),
    rollback: ref("rollback_record_state", "rollback_record"),
    rollbackPayload: ref("rollback_payload_state", "rollback_payload"),
    initialParticipantJournals: [{
      kind: "bundle_publication",
      id: ref("bundle_publication", "bundle").id,
      planHash: hex("bundle_publication/bundle"),
      finalPath: parseCanonicalAbsolutePathText(`${root}/update/journals/bundle_publication/bundle.json`),
      stagedPath: parseCanonicalAbsolutePathText(`${root}/update/initial-journals/bundle_publication/bundle.json`),
      stagedExpected: { constructionOrdinal: 9, hash: hex("initial-journal"), bytes: 256, mode: 384 },
    }],
    recoveryExecutor: {
      finalPath: deriveUpdateExecutorRecordPath(home),
      initial,
      initialStaged: staged(initial, 10),
      terminal,
      terminalStaged: staged(terminal, 11),
      maximumRecordBytes: 16_384,
    },
    verification: ref("target_verification", "verification"),
    retirement: ref("terminal_retirement", "retirement"),
  };
}

const context = { productHome: home, evidence, fallback };

function plan(operation: UpdateOperationV1 = "update_apply"): UpdateLifecycleCoordinatorPlanV2 {
  return buildUpdateCoordinatorPlan({
    execution: execution(operation),
    executionRef: ref("update_execution", "execution"),
    construction: { path: parseCanonicalAbsolutePathText(`${root}/update-construction.plan.json`), hash: hex("construction"), bytes: 4096 },
    owners,
    retainPayloadId: operation === "update_apply" ? parseRollbackPayloadId(`rb_${nonce}_8`) : null,
  });
}

const expectedUpdateSteps: readonly UpdateLifecycleCoordinatorStepV1[] = [
  { kind: "bundle", action: "publish_target" },
  { kind: "owner_files", owner: "core", direction: "forward" },
  { kind: "owner_files", owner: "codex", direction: "forward" },
  { kind: "owner_external_effect", owner: "codex", direction: "forward" },
  { kind: "schema_migration", id: "migration_product-v2" as never, direction: "forward" },
  { kind: "schema_migration", id: "migration_brain-v2" as never, direction: "forward" },
  { kind: "rollback_payload", transition: "publish_proposed" },
  { kind: "manifest", transition: "preserve_before" },
  { kind: "manifest", transition: "publish_transitional" },
  { kind: "trust", transition: "publish_monotonic" },
  { kind: "rollback_record", transition: "publish_proposed" },
  { kind: "active", transition: "publish_target" },
  { kind: "target_verifier", release: "target" },
  { kind: "recovery_executor", transition: "switch_to_fallback" },
  { kind: "terminal_retire", set: "prior_rollback" },
  { kind: "manifest", transition: "publish_terminal" },
  { kind: "manifest", transition: "finalize_tombstones" },
];

const expectedRollbackSteps: readonly UpdateLifecycleCoordinatorStepV1[] = [
  { kind: "bundle", action: "verify_previous" },
  { kind: "rollback_payload", transition: "verify_retained" },
  { kind: "rollback_record", transition: "verify_retained" },
  { kind: "schema_migration", id: "migration_brain-v2" as never, direction: "inverse" },
  { kind: "schema_migration", id: "migration_product-v2" as never, direction: "inverse" },
  { kind: "owner_external_effect", owner: "codex", direction: "inverse" },
  { kind: "owner_files", owner: "codex", direction: "inverse" },
  { kind: "owner_files", owner: "core", direction: "inverse" },
  { kind: "manifest", transition: "preserve_before" },
  { kind: "manifest", transition: "publish_transitional" },
  { kind: "active", transition: "publish_previous" },
  { kind: "target_verifier", release: "previous" },
  { kind: "recovery_executor", transition: "switch_to_fallback" },
  { kind: "terminal_retire", set: "consumed_rollback_and_rejected_release" },
  { kind: "manifest", transition: "publish_terminal" },
  { kind: "manifest", transition: "finalize_tombstones" },
];

describe("update step derivation", () => {
  it("derives the update step list byte-for-byte", () => {
    expect(encodeCanonicalJson(deriveUpdateSteps(execution(), owners) as unknown as CanonicalJsonValue)).toBe(encodeCanonicalJson(expectedUpdateSteps as unknown as CanonicalJsonValue));
  });

  it("derives the manual rollback step list with no trust step", () => {
    const steps = deriveUpdateSteps(execution("update_rollback"), owners);
    expect(steps).toEqual(expectedRollbackSteps);
    expect(steps.some((step) => step.kind === "trust")).toBe(false);
  });

  it("refuses a missing, extra, or reordered owner set", () => {
    expect(() => deriveUpdateSteps(execution(), owners.slice(0, 1))).toThrow();
    expect(() => deriveUpdateSteps(execution(), [...owners].reverse().map((owner, index) => ({ ...owner, id: (owners[index] as UpdateStepOwnerV1).id })))).toThrow();
    expect(() => deriveUpdateSteps({ ...execution(), owners: [...execution().owners].reverse() }, owners)).toThrow();
  });

  it("orders terminal compaction owners, migrations, effects, state participants, staging, envelope", () => {
    const apply = execution();
    const entries = deriveUpdateCompactionEntries(apply, owners);
    expect(entries.map((entry) => entry.kind === "state_participant" ? `${entry.participant}:${entry.plan.id}` : entry.kind)).toEqual([
      "owner_update",
      "owner_update",
      "schema_migration",
      "schema_migration",
      "owner_external_effect",
      "bundle:bundle",
      "rollback_payload:rollback_payload",
      `manifest:mf_${nonce}_6`,
      "trust:trust",
      "rollback_record:rollback_record",
      "active:active",
      `manifest:mf_${nonce}_7`,
      "coordinator_staging",
      "coordinator_envelope",
    ]);
    const rollback = deriveUpdateCompactionEntries(execution("update_rollback"), owners);
    expect(rollback.filter((entry) => entry.kind === "state_participant" && entry.participant === "rollback_payload")).toHaveLength(1);
    expect(rollback.some((entry) => entry.kind === "state_participant" && entry.participant === "trust")).toBe(false);
  });

  it("derives phase from the current step and omits trust from the reverse list", () => {
    expect(expectedUpdateSteps.map(updateStepPhase)).toEqual([
      ...Array<string>(11).fill("participants_applying"),
      "active_publishing",
      "verifying",
      "terminal_finalizing",
      "terminal_finalizing",
      "terminal_finalizing",
      "terminal_finalizing",
    ]);
    const trust = expectedUpdateSteps.findIndex((step) => step.kind === "trust");
    expect(updateCompensationCursor(expectedUpdateSteps, trust)).toBe(trust - 1);
    expect(updateCompensationCursor(expectedUpdateSteps, -1)).toBe(-1);
  });
});

describe("UpdateExecutionPlanV1", () => {
  it("round-trips the exact leaf and recomputes its binding", () => {
    for (const operation of ["update_apply", "update_rollback"] as const) {
      const value = execution(operation);
      expect(validateUpdateExecutionPlan(clone(value), context)).toEqual(value);
    }
  });

  it.each([
    ["trust on rollback", (value: UpdateExecutionPlanV1) => ({ ...value, operation: "update_rollback" })],
    ["planner on rollback", (value: UpdateExecutionPlanV1) => ({ ...execution("update_rollback"), planner: value.planner })],
    ["planner extra key", (value: UpdateExecutionPlanV1) => ({ ...value, planner: { ...planner, extra: true } })],
    ["planner bounds key", (value: UpdateExecutionPlanV1) => ({ ...value, planner: { ...planner, bounds: { ...planner.bounds, extra: 1 } } })],
    ["binding hash", (value: UpdateExecutionPlanV1) => ({ ...value, executionBindingHash: hex("other") })],
    ["duplicate leaf ref", (value: UpdateExecutionPlanV1) => ({ ...value, owners: [value.owners[0], value.owners[0]] })],
    ["ref path", (value: UpdateExecutionPlanV1) => ({ ...value, bundle: { ...value.bundle, path: `${root}/other.plan.json` } })],
    ["extra key", (value: UpdateExecutionPlanV1) => ({ ...value, extra: true })],
    ["initial not current", (value: UpdateExecutionPlanV1) => ({ ...value, recoveryExecutor: { ...value.recoveryExecutor, initial: { ...value.recoveryExecutor.initial, executor: { kind: "release_bundle", release: target } } } })],
    ["terminal not the handoff fallback", (value: UpdateExecutionPlanV1) => ({ ...value, recoveryExecutor: { ...value.recoveryExecutor, terminal: { ...value.recoveryExecutor.terminal, executor: { ...fallback, kind: "package_fallback", bundleManifestHash: hex("elsewhere") } } } })],
    ["staged order", (value: UpdateExecutionPlanV1) => ({ ...value, recoveryExecutor: { ...value.recoveryExecutor, terminalStaged: { ...value.recoveryExecutor.terminalStaged, constructionOrdinal: 12 } } })],
    ["final path", (value: UpdateExecutionPlanV1) => ({ ...value, recoveryExecutor: { ...value.recoveryExecutor, finalPath: `${home}/state/other.json` } })],
  ])("refuses %s", (_name, mutate) => {
    expect(() => validateUpdateExecutionPlan(mutate(execution()), context)).toThrow();
  });

  it("keeps the two recovery records distinct and state-bound", () => {
    const { initial, terminal } = records("update_apply");
    expect(validateUpdateRecoveryExecutorRecord(clone(initial), evidence)).toEqual(initial);
    expect(validateUpdateRecoveryExecutorRecord(clone(terminal), evidence)).toEqual(terminal);
    expect(() => validateUpdateRecoveryExecutorRecord({ ...initial, state: "terminal_cleanup" }, evidence)).toThrow();
    expect(() => validateUpdateRecoveryExecutorRecord({ ...terminal, state: "executing" }, evidence)).toThrow();
    expect(updateRecoveryExecutorRecordHash(initial)).not.toBe(updateRecoveryExecutorRecordHash(terminal));
  });
});

describe("UpdateLifecycleCoordinatorPlanV2", () => {
  it("round-trips its exact bytes and binds its derivation", () => {
    const built = plan();
    expect(validateUpdateCoordinatorPlan(JSON.parse(JSON.stringify(built)), home)).toEqual(built);
    expect(built.maximumPlanBytes).toBe(updateCoordinatorPlanBytes(built).byteLength);
    expect(() => { assertUpdateCoordinatorDerivation(built, execution(), owners); }).not.toThrow();
    expect(() => { assertUpdateCoordinatorDerivation({ ...built, steps: [...built.steps].reverse() }, execution(), owners); }).toThrow();
    expect(() => validateUpdateCoordinatorPlan({ ...built, schemaVersion: 1 }, home)).toThrow();
    expect(() => validateUpdateCoordinatorPlan({ ...built, maximumJournalBytes: built.maximumJournalBytes + 1 }, home)).toThrow();
  });

  it("dispatches V1 and V2 strictly under the shared 16 MiB cap", () => {
    let v1Calls = 0;
    const v1 = (value: unknown) => {
      v1Calls += 1;
      return value;
    };
    const built = plan();
    const v2 = readLifecycleExecutionPlanV2(updateCoordinatorPlanBytes(built), { v1, productHome: home });
    expect(v2.schemaVersion).toBe(2);
    expect(v1Calls).toBe(0);
    const legacy = new TextEncoder().encode(encodeCanonicalJson({ schemaVersion: 1, id: coordinatorId }));
    expect(readLifecycleExecutionPlanV2(legacy, { v1, productHome: home }).schemaVersion).toBe(1);
    expect(v1Calls).toBe(1);
    const unknown = new TextEncoder().encode(encodeCanonicalJson({ schemaVersion: 3 }));
    expect(() => readLifecycleExecutionPlanV2(unknown, { v1, productHome: home })).toThrow();
    const oversized = new Uint8Array(MAXIMUM_LIFECYCLE_EXECUTION_PLAN_BYTES + 1);
    expect(() => readLifecycleExecutionPlanV2(oversized, { v1, productHome: home })).toThrow();
    const nonCanonical = new TextEncoder().encode(JSON.stringify({ schemaVersion: 2 }, null, 1));
    expect(() => readLifecycleExecutionPlanV2(nonCanonical, { v1, productHome: home })).toThrow();
    expect(v1Calls).toBe(1);
  });

  it("derives the outer plan and initial journal bytes the construction envelope publishes", () => {
    const built = plan();
    const outer = updateCoordinatorOuterBytes(built, createdAt);
    expect(outer.plan).toEqual(updateCoordinatorPlanBytes(built));
    const journal = JSON.parse(new TextDecoder().decode(outer.journal)) as unknown;
    expect(validateUpdateCoordinatorJournal(journal, built, updateCoordinatorPlanHash(built))).toEqual(initialUpdateCoordinatorJournal(built, createdAt));
  });
});

function walk(built: UpdateLifecycleCoordinatorPlanV2, events: readonly UpdateCoordinatorJournalEventV1[]): UpdateLifecycleCoordinatorJournalV2 {
  return events.reduce((journal, event) => advanceUpdateCoordinatorJournal(built, journal, event, clock()), initialUpdateCoordinatorJournal(built, createdAt));
}

describe("UpdateLifecycleCoordinatorJournalV2", () => {
  const built = plan();
  const verifier = built.steps.findIndex((step) => step.kind === "target_verifier");
  const retire = built.steps.findIndex((step) => step.kind === "terminal_retire");
  const upTo = (index: number): UpdateCoordinatorJournalEventV1[] => [{ kind: "start" }, ...Array.from({ length: index }, (): UpdateCoordinatorJournalEventV1 => ({ kind: "step_completed" }))];
  const active = built.steps.findIndex((step) => step.kind === "active");
  const cause = parseSafeReasonCode("update_verifier_rejected");
  const compensationStarted: UpdateCoordinatorJournalEventV1 = { kind: "compensation_started", cause };

  it("admits only the verifier's durable success as the point of no return", () => {
    expect(() => walk(built, [...upTo(verifier), { kind: "step_completed" }])).toThrow();
    const crossed = walk(built, [...upTo(verifier), { kind: "point_of_no_return" }]);
    expect(crossed.phase).toBe("verifying");
    expect(crossed.pointOfNoReturnReached).toBe(true);
    expect(() => advanceUpdateCoordinatorJournal(built, crossed, compensationStarted, clock())).toThrow();
  });

  it("bounds retirement to terminal_retire and compaction to compacting", () => {
    const atRetire = walk(built, [...upTo(verifier), { kind: "point_of_no_return" }, ...Array.from({ length: retire - verifier }, (): UpdateCoordinatorJournalEventV1 => ({ kind: "step_completed" }))]);
    expect(atRetire.phase).toBe("terminal_finalizing");
    const started = advanceUpdateCoordinatorJournal(built, atRetire, { kind: "retirement_started" }, clock());
    const one = advanceUpdateCoordinatorJournal(built, started, { kind: "retirement_leaf", maximumLeaves: 1 }, clock());
    expect(one.retirementNext).toBe(1);
    expect(() => advanceUpdateCoordinatorJournal(built, one, { kind: "retirement_leaf", maximumLeaves: 1 }, clock())).toThrow();
    expect(() => validateUpdateCoordinatorJournal({ ...atRetire, retirementNext: null, compactionNext: 0 }, built, atRetire.planHash)).toThrow();
    expect(() => validateUpdateCoordinatorJournal({ ...walk(built, upTo(1)), retirementNext: 0 }, built, atRetire.planHash)).toThrow();
  });

  it("walks the reached reverse list and terminalizes as rolled back", () => {
    let journal = advanceUpdateCoordinatorJournal(built, walk(built, upTo(active)), compensationStarted, clock());
    const visited: number[] = [];
    while (journal.compensationNext !== null && journal.compensationNext >= 0) {
      visited.push(journal.compensationNext);
      journal = advanceUpdateCoordinatorJournal(built, journal, { kind: "compensation_step_completed" }, clock());
    }
    expect(visited.map((index) => (built.steps[index] as UpdateLifecycleCoordinatorStepV1).kind)).not.toContain("trust");
    expect(visited[0]).toBe(active);
    journal = advanceUpdateCoordinatorJournal(built, journal, { kind: "rolled_back" }, clock());
    expect(journal).toMatchObject({ phase: "rolled_back", terminalOutcome: "rolled_back", compensationNext: -1, compensationCause: cause });
  });

  it("keeps the compensation cause null while forward and writes it with compensation_started (P7(b))", () => {
    const forward = walk(built, upTo(active));
    expect(forward.compensationCause).toBeNull();
    const compensating = advanceUpdateCoordinatorJournal(built, forward, compensationStarted, clock());
    expect(compensating).toMatchObject({ direction: "compensating", phase: "compensating", compensationCause: cause });
    expect(validateUpdateCoordinatorJournal(JSON.parse(encodeCanonicalJson(compensating as unknown as CanonicalJsonValue)), built, compensating.planHash)).toEqual(compensating);
    const crossed = advanceUpdateCoordinatorJournal(built, walk(built, [...upTo(verifier), { kind: "point_of_no_return" }]), { kind: "step_completed" }, clock());
    expect(crossed.compensationCause).toBeNull();
  });

  it("refuses a compensating journal without a cause and a forward journal with one", () => {
    const forward = walk(built, upTo(active));
    const compensating = advanceUpdateCoordinatorJournal(built, forward, compensationStarted, clock());
    let rolledBack = compensating;
    while (rolledBack.compensationNext !== null && rolledBack.compensationNext >= 0) rolledBack = advanceUpdateCoordinatorJournal(built, rolledBack, { kind: "compensation_step_completed" }, clock());
    rolledBack = advanceUpdateCoordinatorJournal(built, rolledBack, { kind: "rolled_back" }, clock());
    const compactingRolledBack = advanceUpdateCoordinatorJournal(built, rolledBack, { kind: "compaction_started" }, clock());
    for (const broken of [
      { ...compensating, compensationCause: null },
      { ...rolledBack, compensationCause: null },
      { ...compactingRolledBack, compensationCause: null },
      { ...forward, compensationCause: cause },
      { ...compensating, compensationCause: "Not-Safe" },
      { ...compensating, compensationCause: "x".repeat(65) },
    ]) {
      expect(() => validateUpdateCoordinatorJournal(broken, built, forward.planHash)).toThrow();
    }
    const legacy: Record<string, unknown> = { ...compensating };
    delete legacy.compensationCause;
    expect(() => validateUpdateCoordinatorJournal(legacy, built, forward.planHash)).toThrow();
  });

  it("keeps the journal at its widest values within the 1 MiB bound", () => {
    const widest = {
      ...walk(built, upTo(active)),
      phase: "terminal_finalizing",
      direction: "compensating",
      nextStep: MAXIMUM_UPDATE_COORDINATOR_STEPS,
      compensationNext: MAXIMUM_UPDATE_COORDINATOR_STEPS - 1,
      pointOfNoReturnReached: false,
      terminalOutcome: "rolled_back",
      compensationCause: "a".repeat(64),
      retirementNext: MAXIMUM_UPDATE_RETIREMENT_LEAVES,
      compactionNext: MAXIMUM_UPDATE_COMPACTION_ENTRIES,
    } as const;
    const bytes = new TextEncoder().encode(`${encodeCanonicalJson(widest)}\n`);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES);
    expect(built.maximumJournalBytes).toBe(MAXIMUM_UPDATE_COORDINATOR_JOURNAL_BYTES);
    expect(updateCoordinatorJournalBytes(built, advanceUpdateCoordinatorJournal(built, walk(built, upTo(active)), { kind: "compensation_started", cause: parseSafeReasonCode("a".repeat(64)) }, clock())).byteLength).toBeLessThan(bytes.byteLength);
  });

  it("refuses mismatched identities, leaps, and unused non-null cursors", () => {
    const journal = initialUpdateCoordinatorJournal(built, createdAt);
    for (const broken of [
      { ...journal, planHash: hex("other") },
      { ...journal, nextStep: 3 },
      { ...journal, compensationNext: 0 },
      { ...journal, terminalOutcome: "finalized" },
      { ...journal, pointOfNoReturnReached: true },
      { ...journal, updatedAt: "2026-09-22T00:00:00.000Z" },
      { ...journal, extra: 1 },
    ]) {
      expect(() => validateUpdateCoordinatorJournal(broken, built, journal.planHash)).toThrow();
    }
  });
});

class Killed extends Error {}

interface EngineFixture {
  readonly recoverWithoutNetwork: () => Promise<UpdateLifecycleOutcomeV1 | null>;
  readonly assertExpectedTerminal: () => Promise<boolean>;
  readonly firstRun: {
    readonly error: unknown;
    readonly outcome: UpdateLifecycleOutcomeV1 | null;
    readonly compensated: number;
    readonly compensatedSteps: readonly number[];
    readonly journal: UpdateLifecycleCoordinatorJournalV2 | null;
  };
}

interface DeathPoint {
  readonly name: string;
  readonly matches: (boundary: UpdateCoordinatorBoundaryV1, built: UpdateLifecycleCoordinatorPlanV2) => boolean;
}

const stepIndex = (built: UpdateLifecycleCoordinatorPlanV2, predicate: (step: UpdateLifecycleCoordinatorStepV1) => boolean) => built.steps.findIndex(predicate);

const updateCoordinatorDeathPoints: readonly DeathPoint[] = [
  { name: "initial executor rename", matches: (boundary) => boundary.kind === "executor_published" },
  { name: "first step returned", matches: (boundary) => boundary.kind === "step_returned" && boundary.step === 0 },
  { name: "active published", matches: (boundary, built) => boundary.kind === "step_returned" && boundary.step === stepIndex(built, (step) => step.kind === "active") },
  { name: "point of no return journaled", matches: (boundary) => boundary.kind === "journal_rewritten" && boundary.journal.pointOfNoReturnReached && boundary.journal.phase === "verifying" },
  { name: "terminal executor replacement", matches: (boundary) => boundary.kind === "executor_switched" },
  { name: "retirement leaf", matches: (boundary) => boundary.kind === "journal_rewritten" && boundary.journal.retirementNext === 2 },
  { name: "terminal manifest", matches: (boundary, built) => boundary.kind === "step_returned" && boundary.step === stepIndex(built, (step) => step.kind === "manifest" && step.transition === "publish_terminal") },
  { name: "compaction entry", matches: (boundary) => boundary.kind === "journal_rewritten" && boundary.journal.compactionNext === 3 },
  { name: "envelope removal", matches: (boundary) => boundary.kind === "envelope_removed" },
  { name: "final executor unlink", matches: (boundary) => boundary.kind === "executor_removed" },
];

const compensationDeathPoints: readonly DeathPoint[] = [
  { name: "compensation started", matches: (boundary) => boundary.kind === "journal_rewritten" && boundary.journal.phase === "compensating" },
  { name: "compensation step returned", matches: (boundary) => boundary.kind === "step_returned" && boundary.direction === "compensating" },
  { name: "rolled back terminalization", matches: (boundary) => boundary.kind === "journal_rewritten" && boundary.journal.phase === "rolled_back" },
  { name: "rolled back executor replacement", matches: (boundary) => boundary.kind === "executor_switched" },
];

/**
 * An in-memory world: one plan/journal envelope, an executor record state, and a participant log.
 * It exposes no transport or planner at all, so recovery cannot reach either.
 */
async function interruptUpdateCoordinator(
  point: DeathPoint | null,
  failAt: UpdateLifecycleCoordinatorStepV1["kind"] | null = null,
  failWith: () => Promise<UpdateParticipantObservationV1> = () => Promise.reject(Object.assign(new Error("semantic failure"), { reason: "synthetic_step_failed" })),
): Promise<EngineFixture> {
  const built = plan();
  let journal: UpdateLifecycleCoordinatorJournalV2 | null = initialUpdateCoordinatorJournal(built, createdAt);
  let executor: "absent" | "initial" | "terminal" = "absent";
  const applied: number[] = [];
  const compensated: number[] = [];
  const compacted: UpdateCompactionEntryV1[] = [];
  let retired = 0;
  let armed = point;
  let failing = failAt;
  const indexOf = (step: UpdateLifecycleCoordinatorStepV1) => built.steps.findIndex((candidate) => encodeCanonicalJson(candidate) === encodeCanonicalJson(step));
  const observed = (state: UpdateParticipantObservationV1["state"]): Promise<UpdateParticipantObservationV1> => Promise.resolve({ state });
  const coordinator = () => new UpdateLifecycleCoordinator({
    store: {
      read: () => journal === null ? Promise.reject(new LifecycleRecoveryRequiredError("update_coordinator_absent", [])) : Promise.resolve({ plan: built, journal }),
      rewrite: (_plan, current, next) => {
        if (journal === null || encodeCanonicalJson(journal as unknown as CanonicalJsonValue) !== encodeCanonicalJson(current as unknown as CanonicalJsonValue)) return Promise.reject(new Error("stale"));
        journal = next;
        return Promise.resolve();
      },
      removeEnvelope: () => {
        journal = null;
        return Promise.resolve();
      },
    },
    participants: {
      apply: (step) => {
        if (step.kind === failing) {
          failing = null;
          return failWith();
        }
        applied.push(indexOf(step));
        return observed(step.kind === "target_verifier" ? "verified" : "applied");
      },
      observe: () => observed("applied"),
      compensate: (step) => {
        compensated.push(indexOf(step));
        return observed("compensated");
      },
      compact: (entry) => {
        compacted.push(entry);
        return Promise.resolve();
      },
      retirementLeaves: () => Promise.resolve(3),
      retireLeaf: (_step, ordinal) => {
        if (failing === "terminal_retire" && ordinal === 1) {
          failing = null;
          return Promise.reject(new Error("synthetic retirement failure"));
        }
        if (ordinal !== retired && ordinal !== retired - 1) return Promise.reject(new Error("retirement leap"));
        retired = ordinal + 1;
        return Promise.resolve();
      },
    },
    executor: {
      publishInitial: () => {
        if (executor === "absent") executor = "initial";
        return Promise.resolve();
      },
      switchToFallback: () => {
        if (executor === "absent") return Promise.reject(new LifecycleRecoveryRequiredError("update_executor_record_missing", []));
        executor = "terminal";
        return Promise.resolve();
      },
      removeRecord: () => {
        if (executor === "initial") return Promise.reject(new LifecycleRecoveryRequiredError("update_executor_record_not_terminal", []));
        executor = "absent";
        return Promise.resolve();
      },
    },
    verifyPlan: (candidate) => {
      assertUpdateCoordinatorDerivation(candidate, execution(), owners);
      return Promise.resolve();
    },
    requireLock: () => Promise.resolve(),
    clock,
    afterBoundary: (boundary) => {
      if (armed?.matches(boundary, built) === true) {
        armed = null;
        throw new Killed("killed");
      }
    },
  });

  let error: unknown = null;
  let outcome: UpdateLifecycleOutcomeV1 | null = null;
  try {
    outcome = await coordinator().execute(coordinatorId);
  } catch (caught) {
    error = caught;
  }
  const firstRun = { error, outcome, compensated: compensated.length, compensatedSteps: [...compensated], journal };

  const expectRolledBack = failAt !== null && failAt !== "terminal_retire";
  return {
    firstRun,
    recoverWithoutNetwork: async () => {
      const closure = classifyLifecycleJournalClosureV2({
        v1: { kind: "clear" },
        malformed: false,
        updateCoordinators: journal === null ? [] : [{ id: coordinatorId, operation: built.operation, direction: journal.direction }],
        constructions: [],
        executorRecord: executor === "absent" ? null : { state: executor === "initial" ? "executing" : "terminal_cleanup", coordinatorId },
      });
      switch (closure.kind) {
        case "update_recovery":
          return coordinator().recover(coordinatorId);
        case "update_executor_cleanup":
          executor = "absent";
          return null;
        case "clear":
          return null;
        default:
          throw new Error(`unexpected closure ${closure.kind}`);
      }
    },
    assertExpectedTerminal: () => {
      if (journal !== null || executor !== "absent") return Promise.resolve(false);
      if (expectRolledBack) {
        const trust = stepIndex(built, (step) => step.kind === "trust");
        return Promise.resolve(!compensated.includes(trust) && compensated.length > 0 && compacted.at(-1)?.kind === "coordinator_staging");
      }
      const verifier = stepIndex(built, (step) => step.kind === "target_verifier");
      return Promise.resolve(compensated.length === 0 && applied.includes(verifier) && retired === 3 && compacted.at(-1)?.kind === "coordinator_staging");
    },
  };
}

describe("UpdateLifecycleCoordinator", () => {
  it("runs a fresh apply to its finalized terminal", async () => {
    const fixture = await interruptUpdateCoordinator(null);
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it.each(updateCoordinatorDeathPoints)("recovers $name in the persisted direction", async (point) => {
    const fixture = await interruptUpdateCoordinator(point);
    await fixture.recoverWithoutNetwork();
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it("compensates a pre-activation failure without reversing trust", async () => {
    const fixture = await interruptUpdateCoordinator(null, "active");
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it.each(compensationDeathPoints)("recovers $name in the compensating direction", async (point) => {
    const fixture = await interruptUpdateCoordinator(point, "active");
    const outcome = await fixture.recoverWithoutNetwork();
    expect(outcome === null || outcome.kind === "rolled_back").toBe(true);
    if (outcome !== null) expect(outcome).toEqual({ kind: "rolled_back", id: coordinatorId, cause: "synthetic_step_failed" });
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it.each(compensationDeathPoints)("resumes a verifier rejection killed at $name with the persisted cause (Review Focus 4)", async (point) => {
    const fixture = await interruptUpdateCoordinator(point, "target_verifier", () => Promise.reject(new UpdateStepRejectedError("update_verifier_rejected", [])));
    expect(fixture.firstRun.error).toBeInstanceOf(Killed);
    expect(fixture.firstRun.journal?.compensationCause).toBe("update_verifier_rejected");
    expect(await fixture.recoverWithoutNetwork()).toEqual({ kind: "rolled_back", id: coordinatorId, cause: "update_verifier_rejected" });
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it("compensates a rejected target verifier back to the old active release without reversing trust", async () => {
    const built = plan();
    const fixture = await interruptUpdateCoordinator(null, "target_verifier", () => Promise.reject(new UpdateStepRejectedError("update_verifier_rejected", [])));
    expect(fixture.firstRun.error).toBeNull();
    expect(fixture.firstRun.outcome).toEqual({ kind: "rolled_back", id: coordinatorId, cause: "update_verifier_rejected" });
    expect(fixture.firstRun.compensatedSteps).toContain(stepIndex(built, (step) => step.kind === "active"));
    expect(fixture.firstRun.compensatedSteps).not.toContain(stepIndex(built, (step) => step.kind === "trust"));
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it("keeps a verifier policy breach recovery-required instead of compensating", async () => {
    const fixture = await interruptUpdateCoordinator(null, "target_verifier", () => Promise.reject(new LifecycleRecoveryRequiredError("update_verifier_policy", [])));
    expect(fixture.firstRun.error).toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(fixture.firstRun.compensated).toBe(0);
    expect(fixture.firstRun.journal).toMatchObject({ direction: "forward", phase: "verifying", pointOfNoReturnReached: false });
  });

  it("treats a verifier that does not observe verified as a rejection", async () => {
    const fixture = await interruptUpdateCoordinator(null, "target_verifier", () => Promise.resolve({ state: "applied" }));
    expect(fixture.firstRun.outcome).toEqual({ kind: "rolled_back", id: coordinatorId, cause: "update_verifier_not_verified" });
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it("compensates a pre-point-of-no-return step observed back at its preimage", async () => {
    const fixture = await interruptUpdateCoordinator(null, "owner_files", () => Promise.resolve({ state: "compensated" }));
    expect(fixture.firstRun.outcome).toEqual({ kind: "rolled_back", id: coordinatorId, cause: "update_step_not_applied" });
    expect(fixture.firstRun.compensatedSteps.length).toBeGreaterThan(0);
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });

  it("keeps an apply observation that is no preimage recovery-required", async () => {
    const fixture = await interruptUpdateCoordinator(null, "owner_files", () => Promise.resolve({ state: "not_reversed" }));
    expect(fixture.firstRun.error).toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(fixture.firstRun.compensated).toBe(0);
  });

  it("force-forwards a failure after the point of no return instead of compensating", async () => {
    const fixture = await interruptUpdateCoordinator(null, "terminal_retire");
    expect(fixture.firstRun.error).toBeInstanceOf(Error);
    expect(fixture.firstRun.compensated).toBe(0);
    expect(fixture.firstRun.journal).toMatchObject({ direction: "forward", pointOfNoReturnReached: true, phase: "terminal_finalizing" });
    await fixture.recoverWithoutNetwork();
    expect(await fixture.assertExpectedTerminal()).toBe(true);
  });
});
