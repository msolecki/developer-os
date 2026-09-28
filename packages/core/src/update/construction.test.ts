import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import type { AllocatedLifecycleIdV1, EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import {
  advanceConstructionJournal,
  buildConstructionPlan,
  constructionCompactionTarget,
  constructionDeletionAuthority,
  constructionEvidenceBytes,
  constructionFileEvidence,
  constructionPlanBytes,
  constructionPlanHash,
  initialConstructionJournal,
  payloadSourceProjectionHash,
  rollbackEntrySourceProjectionHash,
  rollbackSourceEntriesProjectionHash,
  updateConstructionEvidencePath,
  updateLeafPlanPath,
  updateRecoveryExecutorStagedPath,
  validateConstructionBijections,
  validateConstructionFileEvidence,
  validateConstructionJournal,
  type ImmutableUpdatePlanRefV1,
  type UpdateConstructionFileInputV1,
  type UpdateConstructionJournalV1,
  type UpdateConstructionPayloadSourceV1,
  type UpdateConstructionPlanInputV1,
  type UpdateConstructionPlanV1,
  type UpdateConstructionStepV1,
} from "./construction.js";
import { buildUpdateFoundationParticipantRef, updateFoundationStagedDigestBytes, type UpdatePayloadRefV1 } from "./migrations.js";
import { deriveCanonicalStatePayloadPath, deriveUpdatePayloadPath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type ExactProductStatePathV1 } from "./paths.js";
import type { PreparedUpdateCandidateV1, RollbackPayloadEntryV1, RollbackPayloadIdV1 } from "./preview.js";
import { parseLowerHexSha256, parseSafeReasonCode, parseUInt64Decimal, parseUtcTimestamp, type LowerHexSha256, type SafeReasonCodeV1 } from "./scalars.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const u64 = parseUInt64Decimal;
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const nonce = "a".repeat(64);
const coordinatorId = `lc_${nonce}_7` as LifecycleCoordinatorIdV1;
const manifestId = `mf_${nonce}_9`;
const home = parseCanonicalAbsolutePathText("/synthetic/home/.developer-os");
const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
const uid = 501 as EffectiveUidV1;
const path = (relative: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(`${root}/${relative}`);
const statePath = (name: string): ExactProductStatePathV1 => parseCanonicalAbsolutePathText(`${home}/state/lifecycle-journals/${name}`) as ExactProductStatePathV1;

function row(role: UpdateConstructionFileInputV1["role"], rowPath: CanonicalAbsolutePathV1, content: string): UpdateConstructionFileInputV1 {
  const bytes = encoder.encode(content);
  return { role, path: rowPath, bytes: bytes.byteLength, sha256: sha(bytes), mode: 384 };
}

function leaf(kind: ImmutableUpdatePlanRefV1["kind"], id: string, content: string): UpdateConstructionFileInputV1 {
  return row({ kind: "immutable_plan", planKind: kind, id: id as never }, updateLeafPlanPath(root, kind, id), content);
}

const manifestPlanBytes = `{"manifest":"plan"}\n`;
const manifestPlanRef: ImmutableUpdatePlanRefV1<"manifest_state"> = {
  kind: "manifest_state",
  id: manifestId as never,
  path: updateLeafPlanPath(root, "manifest_state", manifestId),
  hash: sha(manifestPlanBytes),
  bytes: encoder.encode(manifestPlanBytes).byteLength,
};
const manifestAfter = encodeCanonicalJson({ schemaVersion: 2, artifacts: [] });
const ownerBlob = encoder.encode("owner content v2\n");
const inverseBlob = encoder.encode("migration before bytes\n");
const inventory: readonly RollbackPayloadEntryV1[] = [
  { ordinal: 0, path: "blobs/0000000000.bin" as RollbackPayloadEntryV1["path"], role: "migration_preimage", bytes: inverseBlob.byteLength, sha256: sha(inverseBlob) },
];
const candidate = {
  materialization: {
    outputBlobs: [
      { ordinal: 0, bytes: ownerBlob.byteLength, sha256: sha(ownerBlob) },
      { ordinal: 1, bytes: inverseBlob.byteLength, sha256: sha(inverseBlob) },
    ],
    rollbackInventoryEntries: inventory,
  },
} as unknown as PreparedUpdateCandidateV1;

/** Rows in the exact §9.2 order: plans, source journal, payloads by source kind, target journal, records. */
function files(operation: "update_apply" | "update_rollback"): UpdateConstructionFileInputV1[] {
  const apply = operation === "update_apply";
  const manifestAfterSource: UpdateConstructionPayloadSourceV1 = { kind: "plan_derived", role: "manifest_after", plan: manifestPlanRef, value: manifestAfter, valueBytes: encoder.encode(manifestAfter).byteLength - 1 };
  const rows: UpdateConstructionFileInputV1[] = [
    leaf("update_execution", "execution", `{"execution":1}\n`),
    leaf("target_verification", "verification", `{"verification":1}\n`),
    leaf("terminal_retirement", "retirement", `{"retirement":1}\n`),
    leaf("manifest_state", manifestId, manifestPlanBytes),
  ];
  if (apply) {
    rows.push(leaf("rollback_payload_source", "rollback_source", `{"source":1}\n`));
    const sourceJournal = path("update/journals/rollback_payload_source/rollback_source.json");
    rows.push(row({ kind: "initial_journal", journalKind: "rollback_payload_source", id: parseSafeReasonCode("rollback_source"), finalPath: sourceJournal }, sourceJournal, `{"source_journal":0}\n`));
    const ordinal = rows.length;
    rows.push({ role: { kind: "payload", payloadKind: "owner_content", source: { kind: "planner_output", ordinal: 0 } }, path: path(`update/payloads/${ordinal.toString(10).padStart(10, "0")}.payload`), bytes: ownerBlob.byteLength, sha256: sha(ownerBlob), mode: 384 });
  }
  const afterBytes = encoder.encode(manifestAfter);
  rows.push({ role: { kind: "payload", payloadKind: "state_after", source: manifestAfterSource }, path: path(`participants/manifest/${manifestId}/after.json`), bytes: afterBytes.byteLength, sha256: sha(afterBytes), mode: 384 });
  rows.push(row({ kind: "initial_journal", journalKind: "manifest_state", id: manifestId as never, finalPath: path(`update/journals/manifest_state/${manifestId}.json`) }, path(`update/staged-journals/manifest_state/${manifestId}.json`), `{"manifest_journal":0}\n`));
  rows.push(row({ kind: "recovery_executor", state: "executing" }, updateRecoveryExecutorStagedPath(root, "executing"), `{"state":"executing"}\n`));
  rows.push(row({ kind: "recovery_executor", state: "terminal_cleanup" }, updateRecoveryExecutorStagedPath(root, "terminal_cleanup"), `{"state":"terminal_cleanup"}\n`));
  return rows;
}

function input(operation: "update_apply" | "update_rollback" = "update_apply"): UpdateConstructionPlanInputV1 {
  const apply = operation === "update_apply";
  return {
    coordinatorId,
    operation,
    executionBindingHash: sha("binding"),
    stagingRoot: { path: root, ownerUid: uid, mode: 448, dev: u64("16777220"), ino: u64("1152921500312571551") },
    files: files(operation),
    rollbackSource: apply
      ? { sourcePlanId: parseSafeReasonCode("rollback_source"), payloadId: `rb_${nonce}_3` as RollbackPayloadIdV1, rollbackBindingHash: sha("rollback-binding"), inventoryHash: sha("inventory"), sources: [{ kind: "planner_output", ordinal: 1 }] }
      : null,
    candidate: apply ? candidate : null,
    constructionJournalCreatedAt: at,
    outerJournalCreatedAt: at,
    outerPlanPath: statePath(`${coordinatorId}.plan.json`),
    outerJournalPath: statePath(`${coordinatorId}.json`),
  };
}

/** A structurally mutable copy for refusal cases. */
function mutable(plan: UpdateConstructionPlanV1): Record<string, never> & UpdateConstructionPlanV1 {
  return JSON.parse(JSON.stringify(plan)) as Record<string, never> & UpdateConstructionPlanV1;
}

function drive(plan: UpdateConstructionPlanV1, steps: readonly UpdateConstructionStepV1[], from: UpdateConstructionJournalV1 = initialConstructionJournal(plan)): UpdateConstructionJournalV1 {
  return steps.reduce((journal, step) => advanceConstructionJournal(plan, journal, step, at), from);
}

const identity = { dev: u64("16777220"), ino: u64("42") };
const directorySteps = (plan: UpdateConstructionPlanV1): UpdateConstructionStepV1[] =>
  plan.directories.flatMap(() => [{ kind: "directory_intent" }, { kind: "directory_created", ...identity }, { kind: "directory_complete" }] as UpdateConstructionStepV1[]);
const fileSteps: readonly UpdateConstructionStepV1[] = [
  { kind: "file_intent" },
  { kind: "file_created", ...identity },
  { kind: "evidence_intent" },
  { kind: "evidence_created", dev: identity.dev, ino: u64("43") },
  { kind: "file_complete" },
];

/** Every file row; the rollback-only frame is consumed right after the planner row that precedes it. */
function allFileSteps(plan: UpdateConstructionPlanV1): UpdateConstructionStepV1[] {
  return plan.files.flatMap((file) => {
    const planner = file.role.kind === "payload" && file.role.source.kind === "planner_output";
    return planner ? [...fileSteps, { kind: "source_consumer_complete" } as const] : [...fileSteps];
  });
}

function handedOff(plan: UpdateConstructionPlanV1): UpdateConstructionJournalV1 {
  return drive(plan, [
    ...directorySteps(plan),
    ...allFileSteps(plan),
    { kind: "sources_staging" },
    { kind: "files_ready" },
    { kind: "outer_intent", file: { path: plan.outerPlanPath, bytes: 10, sha256: sha("outer plan"), mode: 384 } },
    { kind: "outer_created", ...identity },
    { kind: "outer_complete" },
    { kind: "outer_intent", file: { path: plan.outerJournalPath, bytes: 10, sha256: sha("outer journal"), mode: 384 } },
    { kind: "outer_created", dev: identity.dev, ino: u64("44") },
    { kind: "outer_complete" },
  ]);
}

describe("update construction plan", () => {
  it("binds every expected ref to exactly one construction file", () => {
    const plan = buildConstructionPlan(input());
    expect(validateConstructionBijections(plan)).toBe(true);
    expect(plan.files.map((file) => file.ordinal)).toEqual(plan.files.map((_, index) => index));
    expect(plan.outputFrames).toEqual([
      { ordinal: 0, bytes: ownerBlob.byteLength, sha256: sha(ownerBlob), consumers: [{ kind: "construction_file", ordinal: 6 }] },
      { ordinal: 1, bytes: inverseBlob.byteLength, sha256: sha(inverseBlob), consumers: [{ kind: "rollback_source_entry", ordinal: 0 }] },
    ]);
  });

  it("builds a manual rollback without frames or a rollback source", () => {
    const plan = buildConstructionPlan(input("update_rollback"));
    expect(plan.outputFrames).toEqual([]);
    expect(plan.rollbackSource).toBeNull();
    expect(validateConstructionBijections(plan)).toBe(true);
  });

  it("derives parent-before-child directories with update first and the evidence directory present", () => {
    const plan = buildConstructionPlan(input());
    expect(plan.directories[0]?.path).toBe(path("update"));
    expect(plan.directories[0]?.parent).toEqual({ kind: "staging_root", path: root, dev: plan.stagingRoot.dev, ino: plan.stagingRoot.ino });
    const ordinals = new Map(plan.directories.map((directory) => [directory.path as string, directory.ordinal]));
    for (const directory of plan.directories.slice(1)) {
      if (directory.parent.kind === "created_directory") expect(directory.parent.ordinal).toBeLessThan(directory.ordinal);
      else expect(directory.parent.path).toBe(root);
    }
    expect(ordinals.has(path("update/construction/evidence"))).toBe(true);
    for (const file of plan.files) {
      const parent = file.path.slice(0, file.path.lastIndexOf("/"));
      if (file.parent.kind === "created_directory") expect(plan.directories[file.parent.ordinal]?.path).toBe(parent);
      else expect(parent).toBe(root);
    }
  });

  it("recomputes every source projection hash over its exact domain and no-LF bytes", () => {
    const plan = buildConstructionPlan(input());
    const noLf = (domain: string, value: unknown): LowerHexSha256 => sha(Buffer.concat([Buffer.from(`${domain}\0`, "ascii"), Buffer.from(encodeCanonicalJson(value as never).slice(0, -1), "utf8")]));
    for (const file of plan.files) {
      if (file.role.kind !== "payload") continue;
      expect(file.role.sourceProjectionHash).toBe(noLf(`developer-os/update-construction-payload-source/${file.role.source.kind}/v1`, file.role.source));
      expect(file.role.sourceProjectionHash).toBe(payloadSourceProjectionHash(file.role.source));
    }
    const source = plan.rollbackSource;
    if (source === null) throw new Error("apply plan has a rollback source");
    expect(source.entries[0]?.sourceProjectionHash).toBe(noLf("developer-os/update-rollback-entry-source/planner_output/v1", { kind: "planner_output", ordinal: 1 }));
    expect(source.entries[0]?.sourceProjectionHash).toBe(rollbackEntrySourceProjectionHash({ kind: "planner_output", ordinal: 1 }));
    expect(source.entriesProjectionHash).toBe(noLf("developer-os/update-rollback-source-entries/v1", { payloadId: source.payloadId, rollbackBindingHash: source.rollbackBindingHash, inventoryHash: source.inventoryHash, entries: source.entries }));
    expect(source.entriesProjectionHash).toBe(rollbackSourceEntriesProjectionHash(source));
  });

  it("hashes the construction plan over its domain plus canonical JSON and LF", () => {
    const plan = buildConstructionPlan(input());
    const bytes = constructionPlanBytes(plan);
    expect(bytes[bytes.byteLength - 1]).toBe(0x0a);
    expect(constructionPlanHash(plan)).toBe(sha(Buffer.concat([Buffer.from("developer-os/update-construction/v1\0", "ascii"), bytes])));
  });

  const refusals: readonly { readonly name: string; readonly change: (plan: Record<string, never> & UpdateConstructionPlanV1) => void }[] = [
    { name: "a duplicate file path", change: (plan) => { (plan.files[1] as { path: string }).path = (plan.files[0] as { path: string }).path; } },
    { name: "an unknown plan key", change: (plan) => { (plan as Record<string, unknown>).extra = 1; } },
    { name: "a missing file key", change: (plan) => { delete (plan.files[0] as Partial<{ mode: number }>).mode; } },
    { name: "a non-contiguous file ordinal", change: (plan) => { (plan.files[2] as { ordinal: number }).ordinal = 5; } },
    { name: "a row out of the exact file order", change: (plan) => { const files = plan.files as unknown as unknown[]; [files[5], files[6]] = [files[6], files[5]]; } },
    { name: "a directory before its parent", change: (plan) => { const directories = plan.directories as unknown as { ordinal: number }[]; [directories[1], directories[2]] = [directories[2] as { ordinal: number }, directories[1] as { ordinal: number }]; } },
    { name: "an update child that is not first", change: (plan) => { (plan.directories[0] as { path: string }).path = path("other"); } },
    { name: "a staging root outside this coordinator", change: (plan) => { (plan.stagingRoot as { path: string }).path = `${home}/staging/lifecycle/lc_${"b".repeat(64)}_1`; } },
    { name: "a staging root with a wider mode", change: (plan) => { (plan.stagingRoot as { mode: number }).mode = 493; } },
    { name: "a tampered payload projection hash", change: (plan) => { ((plan.files[6] as { role: { sourceProjectionHash: string } }).role).sourceProjectionHash = "0".repeat(64); } },
    { name: "a tampered rollback entries hash", change: (plan) => { (plan.rollbackSource as { entriesProjectionHash: string }).entriesProjectionHash = "0".repeat(64); } },
    { name: "a rollback source on a manual rollback", change: (plan) => { (plan as { operation: string }).operation = "update_rollback"; } },
    { name: "a planner row without its frame consumer", change: (plan) => { (plan.outputFrames[0] as unknown as { consumers: unknown[] }).consumers = [{ kind: "rollback_source_entry", ordinal: 0 }]; } },
    { name: "a frame whose hash differs from its row", change: (plan) => { (plan.outputFrames[0] as { sha256: string }).sha256 = sha("other"); } },
    { name: "a rollback entry consumed twice", change: (plan) => { (plan.outputFrames[1] as unknown as { consumers: unknown[] }).consumers.push({ kind: "rollback_source_entry", ordinal: 0 }); } },
    { name: "planner output for a state payload", change: (plan) => { ((plan.files[6] as { role: { payloadKind: string } }).role).payloadKind = "state_after"; } },
    { name: "a payload outside its derived path", change: (plan) => { (plan.files[6] as { path: string }).path = path("update/payloads/owner.payload"); } },
    { name: "a plan-derived value that is not canonical", change: (plan) => { const source = (plan.files[7] as { role: { source: { value: string } } }).role.source; source.value = `{ "schemaVersion": 2 }\n`; } },
    { name: "a journal without its immutable plan", change: (plan) => { ((plan.files[8] as { role: { id: string } }).role).id = `mf_${nonce}_10`; } },
    { name: "a source journal that moves", change: (plan) => { ((plan.files[5] as { role: { finalPath: string } }).role).finalPath = path("update/journals/elsewhere.json"); } },
    { name: "a recovery record off its derived path", change: (plan) => { (plan.files[9] as { path: string }).path = path("update/recovery-executor.json"); } },
    { name: "a missing terminal recovery record", change: (plan) => { (plan.files as unknown as unknown[]).pop(); } },
    { name: "a wrong evidence bound", change: (plan) => { (plan as { maximumEvidenceBytes: number }).maximumEvidenceBytes = 2048; } },
  ];

  it.each(refusals)("refuses $name", ({ change }) => {
    const plan = mutable(buildConstructionPlan(input()));
    change(plan);
    expect(() => validateConstructionBijections(plan)).toThrow();
  });

  it("refuses one guarded authority selecting two construction rows", () => {
    const base = input("update_rollback");
    const preimage = encoder.encode("owner before\n");
    const ownerPlanBytes = `{"owner":"plan"}\n`;
    const ownerPlan: ImmutableUpdatePlanRefV1<"owner_update"> = { kind: "owner_update", id: parseSafeReasonCode("claude"), path: updateLeafPlanPath(root, "owner_update", "claude"), hash: sha(ownerPlanBytes), bytes: encoder.encode(ownerPlanBytes).byteLength };
    const source: UpdateConstructionPayloadSourceV1 = { kind: "guarded_preimage", authority: { kind: "owner_operation_before", ownerPlan, operationOrdinal: 0 }, path: parseCanonicalAbsolutePathText("/synthetic/home/.claude/settings.json"), ownerUid: uid, mode: 384, nlink: 1, bytes: preimage.byteLength, sha256: sha(preimage), dev: identity.dev, ino: identity.ino };
    const rows = [...base.files];
    const payload = (ordinal: number): UpdateConstructionFileInputV1 => ({ role: { kind: "payload", payloadKind: "owner_content", source }, path: path(`update/payloads/${ordinal.toString(10).padStart(10, "0")}.payload`), bytes: preimage.byteLength, sha256: sha(preimage), mode: 384 });
    rows.splice(4, 0, leaf("owner_update", "claude", ownerPlanBytes));
    rows.splice(5, 0, payload(5), payload(6));
    expect(() => buildConstructionPlan({ ...base, files: rows })).toThrow(/authority selects two rows/u);
  });

  it("lists update/source and each planned source's parent as construction directories (P1)", () => {
    const base = input("update_rollback");
    const bundleJournal = path("update/journals/bundle_source_staging/bundle_source.json");
    const rows = [...base.files];
    rows.splice(4, 0, leaf("bundle_source_staging", "bundle_source", `{"bundle_source":1}\n`), row({ kind: "initial_journal", journalKind: "bundle_source_staging", id: parseSafeReasonCode("bundle_source"), finalPath: bundleJournal }, bundleJournal, `{"bundle_journal":0}\n`));
    const plan = buildConstructionPlan({ ...base, files: rows });
    expect(validateConstructionBijections(plan)).toBe(true);
    const ordinal = (relative: string): number => plan.directories.findIndex((directory) => directory.path === path(relative));
    expect(ordinal("update/source")).toBeGreaterThan(0);
    expect(ordinal("update/source/bundle")).toBeGreaterThan(ordinal("update/source"));
    expect(plan.directories[ordinal("update/source/bundle")]?.parent).toEqual({ kind: "created_directory", ordinal: ordinal("update/source") });
    expect(ordinal("update/source/rollback")).toBe(-1);

    const apply = buildConstructionPlan(input());
    expect(apply.directories.map((directory) => directory.path)).toContain(path("update/source/rollback"));
    expect(apply.directories.map((directory) => directory.path)).not.toContain(path("update/source/bundle"));
  });

  it("refuses update/source/bundle as an unused directory without its source plan row (P1)", () => {
    const plan = mutable(buildConstructionPlan(input("update_rollback")));
    const directories = plan.directories as unknown as Record<string, unknown>[];
    const at = directories.length;
    directories.push({ ordinal: at, path: path("update/source"), expectedBefore: "absent", ownerUid: uid, mode: 448, parent: { kind: "created_directory", ordinal: 0 } });
    directories.push({ ordinal: at + 1, path: path("update/source/bundle"), expectedBefore: "absent", ownerUid: uid, mode: 448, parent: { kind: "created_directory", ordinal: at } });
    expect(() => validateConstructionBijections(plan)).toThrow(/update\/source\/bundle without exactly its source plan row/u);
  });

  it("refuses an apply plan whose rollback source parent is missing (P1)", () => {
    const plan = mutable(buildConstructionPlan(input()));
    const directories = plan.directories as unknown as { path: string }[];
    const parent = directories.find((directory) => directory.path === path("update/source/rollback"));
    if (parent === undefined) throw new Error("apply plan lists update/source/rollback");
    parent.path = path("update/source/other");
    expect(() => validateConstructionBijections(plan)).toThrow(/update\/source\/rollback without exactly its source plan row/u);
  });

  it("refuses an output blob that no row or entry consumes", () => {
    const extra = { ...candidate, materialization: { ...candidate.materialization, outputBlobs: [...candidate.materialization.outputBlobs, { ordinal: 2, bytes: 1, sha256: sha("x") }] } } as PreparedUpdateCandidateV1;
    expect(() => buildConstructionPlan({ ...input(), candidate: extra })).toThrow(/no consumer/u);
  });
});

describe("update construction journal", () => {
  it("derives the initial journal from plan timestamps alone", () => {
    const plan = buildConstructionPlan(input());
    const journal = initialConstructionJournal(plan);
    expect(journal).toMatchObject({ phase: "planned", createdAt: at, updatedAt: at, constructionPlanHash: constructionPlanHash(plan), directoryIdentities: [] });
    expect(validateConstructionJournal(journal, plan)).toEqual(journal);
  });

  it("walks the linear table from planned through handoff and compaction", () => {
    const plan = buildConstructionPlan(input());
    const handed = handedOff(plan);
    expect(handed).toMatchObject({ phase: "handed_off", nextDirectory: plan.directories.length, nextFile: plan.files.length, nextOutputFrame: plan.outputFrames.length, nextOutputConsumer: 0 });
    expect(handed.directoryIdentities).toHaveLength(plan.directories.length);
    const steps = 1 + 2 * plan.files.length + plan.directories.length;
    const compacted = drive(plan, Array.from({ length: steps }, () => ({ kind: "compaction_step" }) as const), handed);
    expect(compacted).toMatchObject({ phase: "compacting", compactionNext: 2 * plan.files.length, compactionDirectoryNext: plan.directories.length });
    expect(() => advanceConstructionJournal(plan, compacted, { kind: "compaction_step" }, at)).toThrow();
  });

  it("keeps the frame cursor paired with the planner file cursor", () => {
    const plan = buildConstructionPlan(input());
    const beforeFrames = drive(plan, [...directorySteps(plan), ...fileSteps, ...fileSteps]);
    expect(beforeFrames.nextOutputFrame).toBe(0);
    const plannerDone = drive(plan, [...directorySteps(plan), ...allFileSteps(plan).slice(0, 7 * fileSteps.length)]);
    expect(plannerDone).toMatchObject({ nextFile: 7, nextOutputFrame: 1, nextOutputConsumer: 0 });
    expect(() => validateConstructionJournal({ ...plannerDone, nextOutputFrame: 0 }, plan)).toThrow(/frame cursor/u);
    // A later row may not complete while the rollback-only frame is still unconsumed.
    expect(() => drive(plan, [...fileSteps], plannerDone)).toThrow();
  });

  const leaps: readonly { readonly name: string; readonly step: UpdateConstructionStepV1 }[] = [
    { name: "a file intent before directories", step: { kind: "file_intent" } },
    { name: "a created directory without intent", step: { kind: "directory_created", ...identity } },
    { name: "outer publication before files", step: { kind: "outer_intent", file: { path: statePath(`${coordinatorId}.plan.json`), bytes: 1, sha256: sha("x"), mode: 384 } } },
    { name: "compaction before handoff", step: { kind: "compaction_step" } },
    { name: "a source consumer with no frame", step: { kind: "source_consumer_complete" } },
  ];

  it.each(leaps)("refuses $name", ({ step }) => {
    const plan = buildConstructionPlan(input());
    expect(() => advanceConstructionJournal(plan, initialConstructionJournal(plan), step, at)).toThrow();
  });

  it("refuses unknown keys, foreign plans, and cursors past their counts", () => {
    const plan = buildConstructionPlan(input());
    const journal = initialConstructionJournal(plan);
    expect(() => validateConstructionJournal({ ...journal, extra: 1 }, plan)).toThrow(/keys/u);
    expect(() => validateConstructionJournal({ ...journal, constructionPlanHash: sha("other") }, plan)).toThrow(/constructionPlanHash/u);
    expect(() => validateConstructionJournal({ ...journal, nextFile: plan.files.length + 1 }, plan)).toThrow(/nextFile/u);
    expect(() => validateConstructionJournal({ ...journal, createdAt: parseUtcTimestamp("2026-09-23T09:00:00.000Z") }, plan)).toThrow(/timestamps/u);
    expect(() => validateConstructionJournal({ ...journal, compensationNext: 0 }, plan)).toThrow(/phase/u);
  });

  it("compensates the in-flight row, then every completed row file-then-evidence, then directories in reverse", () => {
    const plan = buildConstructionPlan(input());
    const midFile = drive(plan, [...directorySteps(plan), ...fileSteps, { kind: "file_intent" }, { kind: "file_created", ...identity }]);
    let journal = advanceConstructionJournal(plan, midFile, { kind: "compensate" }, at);
    expect(journal).toMatchObject({ phase: "compensating", compensationNext: 1, compensationPart: "file", compensationDirectoryNext: null });
    const seen: string[] = [];
    while (journal.phase === "compensating") {
      seen.push(journal.compensationNext !== null && journal.compensationNext >= 0 ? `f${journal.compensationNext.toString(10)}:${String(journal.compensationPart)}` : `d${String(journal.compensationDirectoryNext)}`);
      journal = advanceConstructionJournal(plan, journal, { kind: "compensation_step" }, at);
    }
    const directories = Array.from({ length: plan.directories.length + 1 }, (_, index) => `d${(plan.directories.length - 1 - index).toString(10)}`);
    expect(seen).toEqual(["f1:file", "f1:evidence", "f0:file", "f0:evidence", ...directories]);
    expect(journal).toMatchObject({ phase: "rolled_back", compensationNext: -1, compensationPart: null, compensationDirectoryNext: -1 });
  });

  it("does not walk an unbound create intent and refuses compensation after handoff", () => {
    const plan = buildConstructionPlan(input());
    const intent = drive(plan, [{ kind: "directory_intent" }]);
    expect(advanceConstructionJournal(plan, intent, { kind: "compensate" }, at)).toMatchObject({ compensationNext: -1, compensationDirectoryNext: -1 });
    expect(() => advanceConstructionJournal(plan, handedOff(plan), { kind: "compensate" }, at)).toThrow();
  });

  it("maps compaction cursors to file then evidence in reverse ordinal order", () => {
    const plan = buildConstructionPlan(input());
    const last = plan.files.length - 1;
    expect(constructionCompactionTarget(plan, 0)).toEqual({ ordinal: last, part: "file" });
    expect(constructionCompactionTarget(plan, 1)).toEqual({ ordinal: last, part: "evidence" });
    expect(constructionCompactionTarget(plan, 2 * last + 1)).toEqual({ ordinal: 0, part: "evidence" });
    expect(() => constructionCompactionTarget(plan, 2 * plan.files.length)).toThrow();
  });

  it("assigns deletion authority to nested owners except the three read-only leaves", () => {
    const plan = buildConstructionPlan(input());
    const authorities = plan.files.map((file) => constructionDeletionAuthority(file));
    expect(authorities.slice(0, 3)).toEqual(["construction", "construction", "construction"]);
    expect(authorities.slice(3).every((authority) => authority === "nested")).toBe(true);
  });
});

describe("update construction evidence", () => {
  it("round-trips the one canonical evidence object at its derived path", () => {
    const plan = buildConstructionPlan(input());
    const evidence = constructionFileEvidence(plan, 3, identity.dev, identity.ino);
    const bytes = constructionEvidenceBytes(evidence);
    expect(bytes.byteLength).toBeLessThanOrEqual(plan.maximumEvidenceBytes);
    expect(validateConstructionFileEvidence(bytes, plan, 3)).toEqual(evidence);
    expect(evidence.pathHash).toBe(sha(plan.files[3]?.path ?? ""));
    expect(updateConstructionEvidencePath(root, 3)).toBe(path("update/construction/evidence/0000000003.json"));
  });

  it("refuses evidence for another row or with non-canonical bytes", () => {
    const plan = buildConstructionPlan(input());
    const bytes = constructionEvidenceBytes(constructionFileEvidence(plan, 3, identity.dev, identity.ino));
    expect(() => validateConstructionFileEvidence(bytes, plan, 4)).toThrow();
    const spaced = encoder.encode(`${new TextDecoder().decode(bytes).slice(0, -1)} \n`);
    expect(() => validateConstructionFileEvidence(spaced, plan, 3)).toThrow();
  });

  it("keeps plan-derived values as the exact canonical bytes the payload row materializes", () => {
    const plan = buildConstructionPlan(input());
    const row = plan.files.find((file) => file.role.kind === "payload" && file.role.source.kind === "plan_derived");
    if (row?.role.kind !== "payload" || row.role.source.kind !== "plan_derived") throw new Error("fixture has a plan-derived row");
    const value: string = row.role.source.value;
    expect(row.bytes).toBe(row.role.source.valueBytes + 1);
    expect(row.sha256).toBe(sha(value));
  });
});

describe("Foundation construction rows (Spec 2 §5.3, D60)", () => {
  const txId = `tx_${nonce}_12` as AllocatedLifecycleIdV1<"tx">;
  const content = encoder.encode("owner content v2\n");
  const payloadRef = (ordinal: number, bytes: Uint8Array): UpdatePayloadRefV1 => ({
    kind: "update_expected", coordinatorId, ordinal, path: deriveUpdatePayloadPath(home, coordinatorId as string as SafeReasonCodeV1, ordinal), bytes: bytes.byteLength, sha256: sha(bytes), mode: 384,
  });

  /** Inserts a sidecar row and the ref's V1 initial journal row before the manifest postimage. */
  function withFoundationRows(digestValue: string, journalValue?: (text: string) => string): UpdateConstructionPlanInputV1 {
    const base = input();
    const rows = [...base.files];
    const at0 = rows.findIndex((file) => file.role.kind === "payload" && file.role.payloadKind === "state_after");
    const digestOrdinal = at0;
    const { ref, initialJournalBytes } = buildUpdateFoundationParticipantRef({
      productHome: home, coordinatorId, id: txId, slot: "owner_forward_files", role: { kind: "forward", compensationId: null },
      mutations: [{ targetPath: parseCanonicalAbsolutePathText("/synthetic/home/.codex/a.md"), operation: "create", expectedBeforeHash: null, content: payloadRef(3, content), digest: payloadRef(digestOrdinal, updateFoundationStagedDigestBytes(sha(content))) }],
      journalOrdinal: at0 + 1, createdAt: at,
    });
    const text = new TextDecoder().decode(initialJournalBytes);
    const journalText = journalValue === undefined ? text : journalValue(text);
    const digestBytes = encoder.encode(digestValue);
    const journalBytes = encoder.encode(journalText);
    const digestRow: UpdateConstructionFileInputV1 = {
      role: { kind: "payload", payloadKind: "foundation_digest", source: { kind: "plan_derived", role: "foundation_staged_digest", contentHash: sha(content), value: digestValue, valueBytes: 64 } },
      path: path(`update/payloads/${digestOrdinal.toString(10).padStart(10, "0")}.payload`), bytes: digestBytes.byteLength, sha256: sha(digestBytes), mode: 384,
    };
    const journalRow: UpdateConstructionFileInputV1 = {
      role: { kind: "payload", payloadKind: "foundation_initial", source: { kind: "plan_derived", role: "foundation_initial_journal", participant: ref, foundationPlanHash: ref.planHash, plannedBytesHash: ref.initialJournal.plannedBytesHash, value: journalText, valueBytes: journalBytes.byteLength - 1 } },
      path: path(`participants/foundation/${txId}/initial-journal.json`), bytes: journalBytes.byteLength, sha256: sha(journalBytes), mode: 384,
    };
    rows.splice(at0, 0, digestRow, journalRow);
    return { ...base, files: rows };
  }

  it("admits the content-hash sidecar and the exact V1 planned journal bytes", () => {
    const plan = buildConstructionPlan(withFoundationRows(`${sha(content)}\n`));
    expect(validateConstructionBijections(plan)).toBe(true);
    const digest = plan.files.find((file) => file.role.kind === "payload" && file.role.payloadKind === "foundation_digest");
    expect(digest?.bytes).toBe(65);
    expect(digest === undefined ? "absent" : constructionDeletionAuthority(digest)).toBe("nested");
  });

  it.each([
    ["a sidecar of another hash", `${sha("other")}\n`],
    ["a sidecar without its LF", sha(content) as string],
    ["an uppercase sidecar", `${sha(content).toUpperCase()}\n`],
  ])("refuses %s", (_name, value) => {
    expect(() => buildConstructionPlan(withFoundationRows(value))).toThrow();
  });

  it("refuses a Foundation journal re-encoded as canonical JSON", () => {
    const canonicalText = (text: string): string => encodeCanonicalJson(JSON.parse(text) as never);
    expect(() => buildConstructionPlan(withFoundationRows(`${sha(content)}\n`, canonicalText))).toThrow();
  });
});

describe("signed metadata construction rows (Spec 2 P4, D72)", () => {
  const delegation = encodeCanonicalJson({ document: "delegation", sequence: "2" });
  const releaseIndex = encodeCanonicalJson({ document: "release_index", sequence: "2" });
  const bundleManifest = encodeCanonicalJson({ document: "bundle_manifest", entries: [] });
  const documents = [delegation, releaseIndex, bundleManifest];

  interface MetadataRowSpec {
    readonly metadata: number;
    readonly value: string;
    readonly payloadKind?: "state_after" | "owner_content";
    readonly rowContent?: string;
    readonly kind?: string;
  }

  function metadataRow(spec: MetadataRowSpec, index: number): UpdateConstructionFileInputV1 {
    const source = { kind: spec.kind ?? "plan_derived", role: "release_metadata_after", metadata: spec.metadata, value: spec.value, valueBytes: encoder.encode(spec.value).byteLength - 1 } as unknown as UpdateConstructionPayloadSourceV1;
    const rowPath = deriveCanonicalStatePayloadPath(home, coordinatorId as string as SafeReasonCodeV1, "release_metadata", parseSafeReasonCode(`release_metadata_${index.toString(10)}`));
    return row({ kind: "payload", payloadKind: spec.payloadKind ?? "state_after", source }, rowPath, spec.rowContent ?? spec.value);
  }

  /** Inserts the metadata rows before the manifest postimage, the other plan-derived `state_after` row. */
  function withMetadataRows(specs: readonly MetadataRowSpec[]): UpdateConstructionPlanInputV1 {
    const base = input();
    const rows = [...base.files];
    const at0 = rows.findIndex((file) => file.role.kind === "payload" && file.role.payloadKind === "state_after");
    rows.splice(at0, 0, ...specs.map(metadataRow));
    return { ...base, files: rows };
  }

  const all = documents.map((value, metadata) => ({ metadata, value }));

  it("admits the delegation, release index and bundle manifest as plan-derived state rows", () => {
    const plan = buildConstructionPlan(withMetadataRows(all));
    expect(validateConstructionBijections(plan)).toBe(true);
    const rows = plan.files.filter((file) => file.role.kind === "payload" && file.role.source.kind === "plan_derived" && file.role.source.role === "release_metadata_after");
    expect(rows.map((file) => file.sha256)).toEqual(documents.map((value) => sha(value)));
  });

  it("refuses a value whose hash does not match its row", () => {
    expect(() => buildConstructionPlan(withMetadataRows([{ metadata: 0, value: delegation, rowContent: releaseIndex }, { metadata: 1, value: releaseIndex }, { metadata: 2, value: bundleManifest }]))).toThrow(/differs from its row/);
  });

  it("refuses the role on a row that is not state_after", () => {
    expect(() => buildConstructionPlan(withMetadataRows([{ metadata: 0, value: delegation, payloadKind: "owner_content" }]))).toThrow(/owner_content/);
  });

  it.each([[3], [-1]])("refuses metadata ordinal %s", (metadata) => {
    expect(() => buildConstructionPlan(withMetadataRows([{ metadata, value: delegation }]))).toThrow(/metadata/);
  });

  it("refuses two rows bound to one metadata ordinal", () => {
    expect(() => buildConstructionPlan(withMetadataRows([{ metadata: 0, value: delegation }, { metadata: 0, value: releaseIndex }]))).toThrow(/an authority selects two rows/);
  });

  it("refuses a value that is not canonical JSON", () => {
    expect(() => buildConstructionPlan(withMetadataRows([{ metadata: 0, value: `{ "document": "delegation" }\n` }]))).toThrow(/canonical/);
  });

  it("fits a 16 MiB bundle manifest at the exact maximum", () => {
    const value = encodeCanonicalJson("m".repeat(16_777_216 - 3));
    expect(encoder.encode(value).byteLength).toBe(16_777_216);
    const plan = buildConstructionPlan(withMetadataRows([{ metadata: 0, value: delegation }, { metadata: 1, value: releaseIndex }, { metadata: 2, value }]));
    expect(validateConstructionBijections(plan)).toBe(true);
    expect(constructionPlanBytes(plan).byteLength).toBeLessThanOrEqual(plan.maximumPlanBytes);
  }, 60_000);

  it("refuses the withdrawn guarded_signed_metadata arm as unknown", () => {
    const plan = mutable(buildConstructionPlan(withMetadataRows(all)));
    const target = plan.files.find((file) => file.role.kind === "payload" && file.role.source.kind === "plan_derived" && file.role.source.role === "release_metadata_after");
    if (target?.role.kind !== "payload") throw new Error("fixture has a metadata row");
    const withdrawn = { kind: "guarded_signed_metadata", metadata: {}, role: "delegation", path: target.path, ownerUid: uid, mode: 384, nlink: 1, bytes: target.bytes, sha256: target.sha256, dev: identity.dev, ino: identity.ino } as unknown as UpdateConstructionPayloadSourceV1;
    (target.role as { source: UpdateConstructionPayloadSourceV1; sourceProjectionHash: LowerHexSha256 }).source = withdrawn;
    (target.role as { sourceProjectionHash: LowerHexSha256 }).sourceProjectionHash = payloadSourceProjectionHash(withdrawn);
    expect(() => validateConstructionBijections(plan)).toThrow(/\.kind/);
  });
});
