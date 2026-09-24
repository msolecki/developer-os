import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type { TransactionPhase } from "../transactions/types.js";
import {
  advanceConstructionJournal,
  buildConstructionPlan,
  constructionJournalBytes,
  constructionPlanBytes,
  constructionPlanHash,
  initialConstructionJournal,
  updateLeafPlanPath,
  updateRecoveryExecutorStagedPath,
  type ImmutableUpdatePlanRefV1,
  type UpdateConstructionFileInputV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionPayloadSourceV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionStepV1,
  type UpdateLeafPlanKindV1,
} from "../update/construction.js";
import {
  advanceUpdateCoordinatorJournal,
  buildUpdateCoordinatorPlan,
  initialUpdateCoordinatorJournal,
  updateCoordinatorJournalBytes,
  updateCoordinatorPlanBytes,
  updateCoordinatorStagingRoot,
  updateExecutionBindingHash,
  updateRecoveryExecutorRecordBytes,
  updateRecoveryExecutorRecordHash,
  type UpdateCoordinatorJournalEventV1,
  type UpdateExecutionPlanV1,
  type UpdateFallbackHandoffV1,
  type UpdateLifecycleCoordinatorJournalV2,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateOperationV1,
  type UpdateRecoveryExecutorRecordV1,
  type UpdateStepOwnerV1,
} from "../update/coordinator.js";
import { deriveUpdateExecutorRecordPath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1, type ExactProductStatePathV1 } from "../update/paths.js";
import { PLANNER_PROTOCOL_V1, PLANNER_WIRE_BOUNDS_V1 } from "../update/planner.js";
import { parseRollbackPayloadId, type PlannerTranscriptIdentityV1 } from "../update/preview.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "../update/release.js";
import { parseLowerHexSha256, parsePositiveUInt32, parseUInt64Decimal, parseUtcTimestamp, type LowerHexSha256 } from "../update/scalars.js";
import { encodeCanonicalJson } from "./canonical-json.js";
import { createLifecycleCodecs } from "./codecs.js";
import { deriveLifecycleLedgerRoots } from "./foundation-ledger.js";
import type { LifecycleGuardedFileSystemV1 } from "./guarded-fs.js";
import type { EffectiveUidV1 } from "./ids.js";
import { inspectLifecycleLedger, type LifecycleLedgerDependenciesV1 } from "./ledger.js";
import { inspectLifecycleLedgerV2, type LifecycleLedgerV2DependenciesV1, type LifecycleLedgerV2SnapshotV1 } from "./ledger-v2.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import {
  LEAVES,
  LIFECYCLE_HOME_DIRECTORIES,
  NO_RESIDUE,
  UID,
  UNINSTALL_FACTS,
  createInMemoryLifecycleGuardedFileSystem,
  type SyntheticPlan,
} from "./testing.js";

const encoder = new TextEncoder();
const NONCE = parseLowerHexSha256("c".repeat(64));
const HOME = parseCanonicalAbsolutePathText("/synthetic/home/.developer-os");
const ROOTS = deriveLifecycleLedgerRoots(HOME);
const CODECS = createLifecycleCodecs(LEAVES, { productHome: HOME, nonce: NONCE });
const FIRST = `lc_${NONCE}_5` as LifecycleCoordinatorIdV1;
const SECOND = `lc_${NONCE}_6` as LifecycleCoordinatorIdV1;
const TRANSACTION = `tx_${NONCE}_12`;
const createdAt = parseUtcTimestamp("2026-09-23T12:00:00.000Z");
const later = parseUtcTimestamp("2026-09-23T12:00:05.000Z");
const hex = (seed: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(seed).digest("hex"));
const sha = (bytes: Uint8Array): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path) => path,
  containsCanonicalPath: (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}/`),
  hasFoldedAlias: () => false,
};
const fallback: UpdateFallbackHandoffV1 = { bundleManifestHash: hex("fallback-manifest"), launcherProtocol: parsePositiveUInt32(1), updateProtocol: parsePositiveUInt32(1) };
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
    bundleRoot: `${HOME}/releases/${version}/darwin-arm64`,
    platform: "darwin",
    architecture: "arm64",
    launcherProtocol: 1,
    updateProtocol: 1,
  }, evidence);
}

const current = release("1.0.0", "1");
const target = release("1.1.0", "2");

function ref<TKind extends UpdateLeafPlanKindV1>(id: LifecycleCoordinatorIdV1, kind: TKind, leaf: string): ImmutableUpdatePlanRefV1<TKind> {
  const root = updateCoordinatorStagingRoot(HOME, id);
  return { kind, id: leaf, path: updateLeafPlanPath(root, kind, leaf), hash: hex(`${kind}/${leaf}`), bytes: 128 } as ImmutableUpdatePlanRefV1<TKind>;
}

function records(id: LifecycleCoordinatorIdV1, operation: UpdateOperationV1): { readonly initial: UpdateRecoveryExecutorRecordV1; readonly terminal: UpdateRecoveryExecutorRecordV1 } {
  const executionBindingHash = updateExecutionBindingHash({ coordinatorId: id, operation, previewHash: hex("preview"), current, target });
  const common = { schemaVersion: 1, coordinatorId: id, operation, executionBindingHash, createdAt } as const;
  return {
    initial: { ...common, state: "executing", executor: { kind: "release_bundle", release: current } },
    terminal: { ...common, state: "terminal_cleanup", executor: { kind: "package_fallback", ...fallback } },
  };
}

function execution(id: LifecycleCoordinatorIdV1, operation: UpdateOperationV1): UpdateExecutionPlanV1 {
  const root = updateCoordinatorStagingRoot(HOME, id);
  const { initial, terminal } = records(id, operation);
  const staged = (record: UpdateRecoveryExecutorRecordV1, ordinal: number) => ({
    constructionOrdinal: ordinal,
    path: updateRecoveryExecutorStagedPath(root, record.state) as UpdateExecutionPlanV1["recoveryExecutor"]["initialStaged"]["path"],
    bytes: updateRecoveryExecutorRecordBytes(record).byteLength,
    hash: updateRecoveryExecutorRecordHash(record),
    mode: 384 as const,
  });
  return {
    schemaVersion: 1,
    coordinatorId: id,
    operation,
    previewHash: hex("preview"),
    executionBindingHash: initial.executionBindingHash,
    maximumPlanBytes: 16_777_216,
    current,
    target,
    metadata: { delegationSequence: current.delegationSequence, delegationHash: current.delegationHash, delegatedReleaseKeyId: hex("release-key"), releaseIndexSequence: target.releaseIndexSequence, releaseIndexHash: target.releaseIndexHash },
    planner: operation === "update_apply" ? planner : null,
    bundle: ref(id, "bundle_publication", "bundle"),
    owners: [ref(id, "owner_update", "owner_core"), ref(id, "owner_update", "owner_codex")],
    migrations: [ref(id, "schema_migration", "migration_product-v2"), ref(id, "schema_migration", "migration_brain-v2")],
    manifest: { transitional: ref(id, "manifest_state", `mf_${NONCE}_7`), terminal: ref(id, "manifest_state", `mf_${NONCE}_8`) },
    trust: operation === "update_apply" ? ref(id, "release_trust_state", "trust") : null,
    active: ref(id, "active_release_state", "active"),
    rollback: ref(id, "rollback_record_state", "rollback_record"),
    rollbackPayload: ref(id, "rollback_payload_state", "rollback_payload"),
    initialParticipantJournals: [{
      kind: "bundle_publication",
      id: ref(id, "bundle_publication", "bundle").id,
      planHash: hex("bundle_publication/bundle"),
      finalPath: parseCanonicalAbsolutePathText(`${root}/update/journals/bundle_publication/bundle.json`),
      stagedPath: parseCanonicalAbsolutePathText(`${root}/update/initial-journals/bundle_publication/bundle.json`),
      stagedExpected: { constructionOrdinal: 9, hash: hex("initial-journal"), bytes: 256, mode: 384 },
    }],
    recoveryExecutor: {
      finalPath: deriveUpdateExecutorRecordPath(HOME),
      initial,
      initialStaged: staged(initial, 10),
      terminal,
      terminalStaged: staged(terminal, 11),
      maximumRecordBytes: 16_384,
    },
    verification: ref(id, "target_verification", "verification"),
    retirement: ref(id, "terminal_retirement", "retirement"),
  };
}

function outerPlan(id: LifecycleCoordinatorIdV1 = FIRST, operation: UpdateOperationV1 = "update_apply"): UpdateLifecycleCoordinatorPlanV2 {
  const owners: readonly UpdateStepOwnerV1[] = [
    { id: ref(id, "owner_update", "owner_core").id, owner: "core", externalEffects: [] },
    { id: ref(id, "owner_update", "owner_codex").id, owner: "codex", externalEffects: [{ id: ref(id, "owner_external_effect", `oe_${NONCE}_9`).id }] },
  ];
  return buildUpdateCoordinatorPlan({
    execution: execution(id, operation),
    executionRef: ref(id, "update_execution", "execution"),
    construction: { path: parseCanonicalAbsolutePathText(`${updateCoordinatorStagingRoot(HOME, id)}/update-construction.plan.json`), hash: hex("construction"), bytes: 4096 },
    owners,
    retainPayloadId: operation === "update_apply" ? parseRollbackPayloadId(`rb_${NONCE}_10`) : null,
  });
}

function walk(plan: UpdateLifecycleCoordinatorPlanV2, events: readonly UpdateCoordinatorJournalEventV1[]): UpdateLifecycleCoordinatorJournalV2 {
  return events.reduce((journal, event) => advanceUpdateCoordinatorJournal(plan, journal, event, later), initialUpdateCoordinatorJournal(plan, createdAt));
}

function upTo(index: number): UpdateCoordinatorJournalEventV1[] {
  return [{ kind: "start" }, ...Array.from({ length: index }, (): UpdateCoordinatorJournalEventV1 => ({ kind: "step_completed" }))];
}

function activeIndex(plan: UpdateLifecycleCoordinatorPlanV2): number {
  return plan.steps.findIndex((step) => step.kind === "active");
}

function compensating(plan: UpdateLifecycleCoordinatorPlanV2): UpdateLifecycleCoordinatorJournalV2 {
  return advanceUpdateCoordinatorJournal(plan, walk(plan, upTo(activeIndex(plan))), { kind: "compensation_started" }, later);
}

function rolledBack(plan: UpdateLifecycleCoordinatorPlanV2): UpdateLifecycleCoordinatorJournalV2 {
  let journal = compensating(plan);
  while (journal.compensationNext !== null && journal.compensationNext >= 0) {
    journal = advanceUpdateCoordinatorJournal(plan, journal, { kind: "compensation_step_completed" }, later);
  }
  return advanceUpdateCoordinatorJournal(plan, journal, { kind: "rolled_back" }, later);
}

/** The smallest valid construction plan: a manual rollback, which carries no planner candidate. */
function constructionPlan(id: LifecycleCoordinatorIdV1 = FIRST): UpdateConstructionPlanV1 {
  const root = updateCoordinatorStagingRoot(HOME, id);
  const at = (relative: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(`${root}/${relative}`);
  const statePath = (name: string): ExactProductStatePathV1 => parseCanonicalAbsolutePathText(`${HOME}/state/lifecycle-journals/${name}`) as ExactProductStatePathV1;
  const row = (role: UpdateConstructionFileInputV1["role"], path: CanonicalAbsolutePathV1, content: string): UpdateConstructionFileInputV1 => {
    const bytes = encoder.encode(content);
    return { role, path, bytes: bytes.byteLength, sha256: sha(bytes), mode: 384 };
  };
  const leaf = (kind: ImmutableUpdatePlanRefV1["kind"], leafId: string, content: string): UpdateConstructionFileInputV1 =>
    row({ kind: "immutable_plan", planKind: kind, id: leafId as never }, updateLeafPlanPath(root, kind, leafId), content);
  const manifestId = `mf_${NONCE}_9`;
  const manifestPlanBytes = `{"manifest":"plan"}\n`;
  const manifestPlanRef: ImmutableUpdatePlanRefV1<"manifest_state"> = {
    kind: "manifest_state",
    id: manifestId as never,
    path: updateLeafPlanPath(root, "manifest_state", manifestId),
    hash: sha(encoder.encode(manifestPlanBytes)),
    bytes: encoder.encode(manifestPlanBytes).byteLength,
  };
  const manifestAfter = encodeCanonicalJson({ schemaVersion: 2, artifacts: [] });
  const afterBytes = encoder.encode(manifestAfter);
  const manifestAfterSource: UpdateConstructionPayloadSourceV1 = { kind: "plan_derived", role: "manifest_after", plan: manifestPlanRef, value: manifestAfter, valueBytes: afterBytes.byteLength - 1 };
  return buildConstructionPlan({
    coordinatorId: id,
    operation: "update_rollback",
    executionBindingHash: hex("binding"),
    stagingRoot: { path: root, ownerUid: UID as EffectiveUidV1, mode: 448, dev: parseUInt64Decimal("16777220"), ino: parseUInt64Decimal("1152921500312571551") },
    files: [
      leaf("update_execution", "execution", `{"execution":1}\n`),
      leaf("target_verification", "verification", `{"verification":1}\n`),
      leaf("terminal_retirement", "retirement", `{"retirement":1}\n`),
      leaf("manifest_state", manifestId, manifestPlanBytes),
      { role: { kind: "payload", payloadKind: "state_after", source: manifestAfterSource }, path: at(`participants/manifest/${manifestId}/after.json`), bytes: afterBytes.byteLength, sha256: sha(afterBytes), mode: 384 },
      row({ kind: "initial_journal", journalKind: "manifest_state", id: manifestId as never, finalPath: at(`update/journals/manifest_state/${manifestId}.json`) }, at(`update/staged-journals/manifest_state/${manifestId}.json`), `{"manifest_journal":0}\n`),
      row({ kind: "recovery_executor", state: "executing" }, updateRecoveryExecutorStagedPath(root, "executing"), `{"state":"executing"}\n`),
      row({ kind: "recovery_executor", state: "terminal_cleanup" }, updateRecoveryExecutorStagedPath(root, "terminal_cleanup"), `{"state":"terminal_cleanup"}\n`),
    ],
    rollbackSource: null,
    candidate: null,
    constructionJournalCreatedAt: createdAt,
    outerJournalCreatedAt: createdAt,
    outerPlanPath: statePath(`${id}.plan.json`),
    outerJournalPath: statePath(`${id}.json`),
  });
}

function handedOff(plan: UpdateConstructionPlanV1): UpdateConstructionJournalV1 {
  const identity = { dev: parseUInt64Decimal("16777220"), ino: parseUInt64Decimal("42") };
  const steps: UpdateConstructionStepV1[] = [
    ...plan.directories.flatMap((): UpdateConstructionStepV1[] => [{ kind: "directory_intent" }, { kind: "directory_created", ...identity }, { kind: "directory_complete" }]),
    ...plan.files.flatMap((): UpdateConstructionStepV1[] => [
      { kind: "file_intent" },
      { kind: "file_created", ...identity },
      { kind: "evidence_intent" },
      { kind: "evidence_created", dev: identity.dev, ino: parseUInt64Decimal("43") },
      { kind: "file_complete" },
    ]),
    { kind: "sources_staging" },
    { kind: "files_ready" },
    { kind: "outer_intent", file: { path: plan.outerPlanPath, bytes: 10, sha256: hex("outer plan"), mode: 384 } },
    { kind: "outer_created", ...identity },
    { kind: "outer_complete" },
    { kind: "outer_intent", file: { path: plan.outerJournalPath, bytes: 10, sha256: hex("outer journal"), mode: 384 } },
    { kind: "outer_created", dev: identity.dev, ino: parseUInt64Decimal("44") },
    { kind: "outer_complete" },
  ];
  return steps.reduce((journal, step) => advanceConstructionJournal(plan, journal, step, createdAt), initialConstructionJournal(plan));
}

interface HomeV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
}

function at(relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${HOME}/${relative}`);
}

async function write(home: HomeV1, relative: string, bytes: string | Uint8Array): Promise<void> {
  await home.fs.writeExclusive(at(relative), typeof bytes === "string" ? encoder.encode(bytes) : bytes);
}

async function mkdirs(home: HomeV1, relative: string): Promise<void> {
  const parts = relative.split("/");
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const path = at(parts.slice(0, depth).join("/"));
    if ((await home.fs.lstat(path)) === null) await home.fs.mkdirExclusive(path);
  }
}

/** Removes a file, or a directory tree children first. */
async function remove(home: HomeV1, relative: string): Promise<void> {
  const entry = await home.fs.lstat(at(relative));
  if (entry === null) return;
  if (entry.kind === "directory") {
    const names: string[] = [];
    for await (const name of home.fs.names(entry)) names.push(name);
    for (const name of names) await remove(home, `${relative}/${name}`);
    await home.fs.rmdirExactEmpty(entry);
    return;
  }
  await home.fs.unlinkExact(entry);
}

async function newHome(): Promise<HomeV1> {
  const home: HomeV1 = { fs: createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: HOME }) };
  for (const relative of LIFECYCLE_HOME_DIRECTORIES) await mkdirs(home, relative);
  await write(home, "state/lifecycle-install-nonce", `${NONCE}\n`);
  await write(home, "state/lifecycle-id-allocator.json", encodeLifecycleIdAllocator({ schemaVersion: 1, installNonce: NONCE, nextCounter: parseUInt64Decimal("100") }));
  return home;
}

function v1Dependencies(home: HomeV1): LifecycleLedgerDependenciesV1<SyntheticPlan> {
  return {
    fs: home.fs,
    effectiveUid: UID,
    executionPlanCodec: CODECS.executionPlan,
    coordinatorJournalCodec: CODECS.coordinatorJournal,
    variantFacts: () => UNINSTALL_FACTS,
    pushPlanHash: () => null,
    gitEffectPlanCodec: null,
    launchdEffectPlanCodec: null,
    residue: NO_RESIDUE,
    manifestBeforeHash: () => null,
    leasePaths: () => [],
  };
}

function dependencies(home: HomeV1): LifecycleLedgerV2DependenciesV1<SyntheticPlan> {
  return { ...v1Dependencies(home), evidence };
}

function inspect(home: HomeV1): Promise<LifecycleLedgerV2SnapshotV1<SyntheticPlan>> {
  return inspectLifecycleLedgerV2(dependencies(home), ROOTS);
}

async function plantEnvelope(
  home: HomeV1,
  plan: UpdateLifecycleCoordinatorPlanV2,
  journal: UpdateLifecycleCoordinatorJournalV2 | null,
): Promise<void> {
  await write(home, `state/lifecycle-journals/${plan.id}.plan.json`, updateCoordinatorPlanBytes(plan));
  if (journal !== null) await write(home, `state/lifecycle-journals/${plan.id}.json`, updateCoordinatorJournalBytes(plan, journal));
}

async function plantFoundationJournal(home: HomeV1, id: string, phase: TransactionPhase): Promise<void> {
  await write(home, `state/transactions/${id}.json`, encodeFoundationJournalJsonV1({
    schemaVersion: 1,
    id,
    kind: "lifecycle_participant",
    phase,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T12:00:01.000Z",
    mutations: [{ targetPath: `${HOME}/state/synthetic-target.json`, operation: "create", expectedBeforeHash: null, stagedRelativePath: "0.bin" }],
  }));
}

async function plantExecutorRecord(home: HomeV1, state: "executing" | "terminal_cleanup", id: LifecycleCoordinatorIdV1 = FIRST): Promise<void> {
  const { initial, terminal } = records(id, "update_apply");
  await write(home, "state/update-executor.json", updateRecoveryExecutorRecordBytes(state === "executing" ? initial : terminal));
}

const REQUIRED = { kind: "lifecycle_recovery_required" } as const;

describe("closure V2 over update coordinators", () => {
  it("yields update_recovery forward for a mid-flight apply and hides its staging and Foundation participant from V1", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, walk(plan, upTo(1)));
    await mkdirs(home, `staging/lifecycle/${FIRST}/update/plans`);
    await mkdirs(home, `staging/lifecycle/${FIRST}/participants/foundation/${TRANSACTION}`);
    await plantFoundationJournal(home, TRANSACTION, "finalized");

    const inspected = await inspect(home);

    expect(inspected.closure).toStrictEqual({ kind: "update_recovery", coordinatorId: FIRST, operation: "update_apply", direction: "forward" });
    expect(inspected.snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(inspected.snapshot.findings).toStrictEqual([]);
    expect(inspected.snapshot.coordinators).toStrictEqual([]);
    expect(inspected.snapshot.standaloneTerminalFoundation).toStrictEqual([]);
    expect(inspected.snapshot.standaloneNonTerminalFoundation).toStrictEqual([]);
  });

  it("yields update_recovery compensating for an apply walking its reverse list", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, compensating(plan));
    await mkdirs(home, `staging/lifecycle/${FIRST}/update`);

    expect((await inspect(home)).closure).toStrictEqual({ kind: "update_recovery", coordinatorId: FIRST, operation: "update_apply", direction: "compensating" });
  });

  it("names a manual rollback's operation", async () => {
    const home = await newHome();
    const plan = outerPlan(FIRST, "update_rollback");
    await plantEnvelope(home, plan, walk(plan, upTo(0)));

    expect((await inspect(home)).closure).toMatchObject({ kind: "update_recovery", operation: "update_rollback" });
  });

  it("keeps a terminal coordinator non-clear until it compacts, then reads clear", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, rolledBack(plan));
    await mkdirs(home, `staging/lifecycle/${FIRST}/update/plans`);
    await plantExecutorRecord(home, "terminal_cleanup");

    expect((await inspect(home)).closure).toStrictEqual({ kind: "update_recovery", coordinatorId: FIRST, operation: "update_apply", direction: "compensating" });

    await remove(home, `staging/lifecycle/${FIRST}`);
    await remove(home, `state/lifecycle-journals/${FIRST}.json`);
    expect((await inspect(home)).closure).toStrictEqual({ kind: "update_recovery", coordinatorId: FIRST, operation: "update_apply", direction: "forward" });

    await remove(home, `state/lifecycle-journals/${FIRST}.plan.json`);
    expect((await inspect(home)).closure).toStrictEqual({ kind: "update_executor_cleanup", coordinatorId: FIRST });

    await remove(home, "state/update-executor.json");
    expect((await inspect(home)).closure).toStrictEqual({ kind: "clear" });
  });

  it("admits the plan-plus-lock envelope suffix", async () => {
    const home = await newHome();
    await plantEnvelope(home, outerPlan(), null);
    await write(home, `state/lifecycle-journals/.${FIRST}.lock`, new Uint8Array(0));

    expect((await inspect(home)).closure).toMatchObject({ kind: "update_recovery", coordinatorId: FIRST });
  });

  it("refuses two update coordinators as recovery-required", async () => {
    const home = await newHome();
    const first = outerPlan(FIRST);
    const second = outerPlan(SECOND);
    await plantEnvelope(home, first, walk(first, upTo(1)));
    await plantEnvelope(home, second, walk(second, upTo(1)));

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses an update coordinator beside a non-clear V1 ledger", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, walk(plan, upTo(1)));
    await plantFoundationJournal(home, TRANSACTION, "applied");

    const inspected = await inspect(home);
    expect(inspected.observation.v1.kind).not.toBe("clear");
    expect(inspected.closure).toStrictEqual(REQUIRED);
  });

  it.each([
    ["an unknown staging root child", `staging/lifecycle/${FIRST}/unknown`],
    ["an unknown update child", `staging/lifecycle/${FIRST}/update/unknown`],
    ["an unknown participants child", `staging/lifecycle/${FIRST}/participants/launchd`],
  ])("refuses %s as recovery-required", async (_label, child) => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, walk(plan, upTo(1)));
    await mkdirs(home, `staging/lifecycle/${FIRST}/update`);
    await mkdirs(home, child.slice(0, child.lastIndexOf("/")));
    await home.fs.mkdirExclusive(at(child));

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses a Foundation directory that is not an allocated transaction ID", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, walk(plan, upTo(1)));
    await mkdirs(home, `staging/lifecycle/${FIRST}/participants/foundation/not-a-transaction`);

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses a journal that is not its plan's own canonical journal", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, null);
    await write(home, `state/lifecycle-journals/${FIRST}.json`, encodeCanonicalJson({ schemaVersion: 2 }));

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses a journal-less plan whose staging root still exists", async () => {
    const home = await newHome();
    await plantEnvelope(home, outerPlan(), null);
    await mkdirs(home, `staging/lifecycle/${FIRST}/update`);

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });
});

describe("closure V2 over construction envelopes", () => {
  const root = `staging/lifecycle/${FIRST}`;

  it("yields plan_pending for the lone root temp without parsing it", async () => {
    const home = await newHome();
    await mkdirs(home, root);
    await write(home, `${root}/update-construction.plan.pending`, `{"schemaVer`);

    expect((await inspect(home)).closure).toStrictEqual({ kind: "update_construction_cleanup", coordinatorId: FIRST, direction: "compensating", construction: { frontier: "plan_pending" } });
  });

  it.each([
    ["absent", [] as readonly string[]],
    ["pending", ["update-construction.journal.pending"]],
  ] as const)("yields journal_bootstrap with the initial journal %s", async (journal, extra) => {
    const home = await newHome();
    const plan = constructionPlan();
    await mkdirs(home, root);
    await write(home, `${root}/update-construction.plan.json`, constructionPlanBytes(plan));
    for (const name of extra) await write(home, `${root}/${name}`, `{"sch`);

    expect((await inspect(home)).closure).toStrictEqual({
      kind: "update_construction_cleanup",
      coordinatorId: FIRST,
      direction: "compensating",
      construction: { frontier: "journal_bootstrap", journal, operation: "update_rollback", constructionPlanHash: constructionPlanHash(plan) },
    });
  });

  it("yields the journal frontier for a pre-handoff journal, owning a partial outer plan it recorded", async () => {
    const home = await newHome();
    const plan = constructionPlan();
    await mkdirs(home, `${root}/update/plans`);
    await write(home, `${root}/update-construction.plan.json`, constructionPlanBytes(plan));
    await write(home, `${root}/update-construction.journal.json`, constructionJournalBytes(initialConstructionJournal(plan)));
    await write(home, `state/lifecycle-journals/${FIRST}.plan.json`, `{"schemaVersion":2,`);

    const inspected = await inspect(home);

    expect(inspected.closure).toStrictEqual({
      kind: "update_construction_cleanup",
      coordinatorId: FIRST,
      direction: "compensating",
      construction: { frontier: "journal", operation: "update_rollback", constructionPlanHash: constructionPlanHash(plan) },
    });
    expect(inspected.snapshot.findings).toStrictEqual([]);
  });

  it("refuses a bootstrap frontier beside an outer envelope leaf", async () => {
    const home = await newHome();
    await mkdirs(home, root);
    await write(home, `${root}/update-construction.plan.json`, constructionPlanBytes(constructionPlan()));
    await write(home, `state/lifecycle-journals/${FIRST}.plan.json`, `{"schemaVersion":2,`);

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses a handed-off construction journal with no outer journal", async () => {
    const home = await newHome();
    const plan = constructionPlan();
    await mkdirs(home, root);
    await write(home, `${root}/update-construction.plan.json`, constructionPlanBytes(plan));
    await write(home, `${root}/update-construction.journal.json`, constructionJournalBytes(handedOff(plan)));

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses two construction envelopes, a construction beside a coordinator, and two pending siblings", async () => {
    const twice = await newHome();
    for (const id of [FIRST, SECOND]) {
      await mkdirs(twice, `staging/lifecycle/${id}`);
      await write(twice, `staging/lifecycle/${id}/update-construction.plan.pending`, "{");
    }
    expect((await inspect(twice)).closure).toStrictEqual(REQUIRED);

    const beside = await newHome();
    const plan = outerPlan(SECOND);
    await plantEnvelope(beside, plan, walk(plan, upTo(1)));
    await mkdirs(beside, root);
    await write(beside, `${root}/update-construction.plan.pending`, "{");
    expect((await inspect(beside)).closure).toStrictEqual(REQUIRED);

    const pending = await newHome();
    await mkdirs(pending, root);
    await write(pending, `${root}/update-construction.plan.json`, constructionPlanBytes(constructionPlan()));
    await write(pending, `${root}/update-construction.journal.pending`, "{");
    await write(pending, `${root}/update-construction.journal.rewrite.pending`, "{");
    expect((await inspect(pending)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses a construction plan that is not canonical or names another coordinator", async () => {
    const home = await newHome();
    await mkdirs(home, root);
    await write(home, `${root}/update-construction.plan.json`, constructionPlanBytes(constructionPlan(SECOND)));

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);

    const partial = await newHome();
    await mkdirs(partial, root);
    await write(partial, `${root}/update-construction.plan.json`, `{"schemaVersion":1}\n`);
    expect((await inspect(partial)).closure).toStrictEqual(REQUIRED);
  });
});

describe("closure V2 over the recovery-executor record", () => {
  it("yields update_executor_cleanup for a lone terminal_cleanup record", async () => {
    const home = await newHome();
    await plantExecutorRecord(home, "terminal_cleanup");

    const inspected = await inspect(home);
    expect(inspected.snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(inspected.closure).toStrictEqual({ kind: "update_executor_cleanup", coordinatorId: FIRST });
  });

  it("refuses an orphan executing record, a malformed record, and a record naming another coordinator", async () => {
    const orphan = await newHome();
    await plantExecutorRecord(orphan, "executing");
    expect((await inspect(orphan)).closure).toStrictEqual(REQUIRED);

    const malformed = await newHome();
    await write(malformed, "state/update-executor.json", `{"schemaVersion":1}\n`);
    expect((await inspect(malformed)).closure).toStrictEqual(REQUIRED);

    const foreign = await newHome();
    const plan = outerPlan();
    await plantEnvelope(foreign, plan, walk(plan, upTo(1)));
    await plantExecutorRecord(foreign, "executing", SECOND);
    expect((await inspect(foreign)).closure).toStrictEqual(REQUIRED);
  });

  it("refuses an executing coordinator whose executor record is only fresh init's empty reservation", async () => {
    const home = await newHome();
    const plan = outerPlan();
    await plantEnvelope(home, plan, walk(plan, upTo(1)));
    await mkdirs(home, `staging/lifecycle/${FIRST}/update`);
    await write(home, "state/update-executor.json", "");

    expect((await inspect(home)).closure).toStrictEqual(REQUIRED);
  });
});

describe("closure V2 over a V1-only ledger", () => {
  it.each([
    ["an empty home", async (): Promise<void> => {}],
    ["a standalone terminal Foundation journal", async (home: HomeV1) => plantFoundationJournal(home, TRANSACTION, "finalized")],
    ["a standalone non-terminal Foundation journal", async (home: HomeV1) => plantFoundationJournal(home, TRANSACTION, "applied")],
    ["a malformed coordinator-root leaf", async (home: HomeV1) => write(home, "state/lifecycle-journals/synthetic-orphan.json", "{}\n")],
    ["a V1 staging root", async (home: HomeV1) => mkdirs(home, `staging/lifecycle/${FIRST}/foundation`)],
    ["fresh init's empty executor-record reservation", async (home: HomeV1) => write(home, "state/update-executor.json", "")],
  ])("returns exactly today's V1 snapshot and closure for %s", async (_label, plant) => {
    const home = await newHome();
    await plant(home);

    const inspected = await inspect(home);
    const today = await inspectLifecycleLedger(v1Dependencies(home), ROOTS);

    expect(inspected.snapshot).toStrictEqual(today);
    expect(inspected.closure).toStrictEqual(today.closure);
    expect(inspected.observation).toMatchObject({ malformed: false, updateCoordinators: [], constructions: [], executorRecord: null });
  });
});
