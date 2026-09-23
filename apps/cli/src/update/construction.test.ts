import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildConstructionPlan,
  constructionPlanHash,
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateConstructionEnvelopePaths,
  updateLeafPlanPath,
  updateRecoveryExecutorStagedPath,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type ExactProductStatePathV1,
  type ImmutableUpdatePlanRefV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type PreparedUpdateCandidateV1,
  type RollbackPayloadEntryV1,
  type RollbackPayloadIdV1,
  type SecretScreenedBlobV1,
  type UpdateConstructionClosureV1,
  type UpdateConstructionFileInputV1,
  type UpdateConstructionFilePlanV1,
  type UpdateConstructionPlanV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  UPDATE_CONSTRUCTION_STORE_DEATH_POINTS,
  UpdateConstructionStore,
  type UpdateConstructionSourcePortV1,
  type UpdateConstructionStoreDeathPointV1,
} from "./construction.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const nonce = "c".repeat(64);
const coordinatorId = `lc_${nonce}_11` as LifecycleCoordinatorIdV1;
const manifestId = `mf_${nonce}_12`;
const uid = process.getuid?.() ?? -1;
const ownerBlob = encoder.encode("synthetic owner content\n");
const inverseBlob = encoder.encode("synthetic migration before\n");
const outerBytes = { plan: encoder.encode(`{"outer":"plan"}\n`), journal: encoder.encode(`{"outer":"journal"}\n`) };
const homes: string[] = [];

class Killed extends Error {}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

interface Fixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly plan: UpdateConstructionPlanV1;
  readonly rowBytes: ReadonlyMap<number, Uint8Array>;
  readonly frames: readonly SecretScreenedBlobV1[];
  readonly nested: Set<number>;
}

/** A synthetic apply: three read-only leaves, a manifest leaf, a rollback source, one owner frame, one rollback-only frame. */
async function fixture(): Promise<Fixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-construction-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(`${home}/state/lifecycle-journals`, { recursive: true, mode: 0o700 });
  const rootStats = await nodeFs.lstat(root, { bigint: true });
  const path = (relative: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(`${root}/${relative}`);
  const contents: string[] = [];
  const row = (role: UpdateConstructionFileInputV1["role"], rowPath: CanonicalAbsolutePathV1, content: string): UpdateConstructionFileInputV1 => {
    contents.push(content);
    const bytes = encoder.encode(content);
    return { role, path: rowPath, bytes: bytes.byteLength, sha256: sha(bytes), mode: 384 };
  };
  const leaf = (kind: ImmutableUpdatePlanRefV1["kind"], id: string): UpdateConstructionFileInputV1 =>
    row({ kind: "immutable_plan", planKind: kind, id: id as never }, updateLeafPlanPath(root, kind, id), `{"leaf":"${kind}"}\n`);
  const manifestPlan: ImmutableUpdatePlanRefV1<"manifest_state"> = { kind: "manifest_state", id: manifestId as never, path: updateLeafPlanPath(root, "manifest_state", manifestId), hash: sha(`{"leaf":"manifest_state"}\n`), bytes: encoder.encode(`{"leaf":"manifest_state"}\n`).byteLength };
  const manifestAfter = encodeCanonicalJson({ schemaVersion: 2, synthetic: true });
  const afterBytes = encoder.encode(manifestAfter);
  const sourceJournal = path("update/journals/rollback_payload_source/rollback_source.json");
  const files: UpdateConstructionFileInputV1[] = [
    leaf("update_execution", "execution"),
    leaf("target_verification", "verification"),
    leaf("terminal_retirement", "retirement"),
    leaf("manifest_state", manifestId),
    leaf("rollback_payload_source", "rollback_source"),
    row({ kind: "initial_journal", journalKind: "rollback_payload_source", id: parseSafeReasonCode("rollback_source"), finalPath: sourceJournal }, sourceJournal, `{"source_journal":0}\n`),
  ];
  contents.push("");
  files.push({ role: { kind: "payload", payloadKind: "owner_content", source: { kind: "planner_output", ordinal: 0 } }, path: path("update/payloads/0000000006.payload"), bytes: ownerBlob.byteLength, sha256: sha(ownerBlob), mode: 384 });
  contents.push(manifestAfter);
  files.push({ role: { kind: "payload", payloadKind: "state_after", source: { kind: "plan_derived", role: "manifest_after", plan: manifestPlan, value: manifestAfter, valueBytes: afterBytes.byteLength - 1 } }, path: path(`participants/manifest/${manifestId}/after.json`), bytes: afterBytes.byteLength, sha256: sha(afterBytes), mode: 384 });
  files.push(row({ kind: "initial_journal", journalKind: "manifest_state", id: manifestId as never, finalPath: path(`update/journals/manifest_state/${manifestId}.json`) }, path(`update/staged-journals/manifest_state/${manifestId}.json`), `{"manifest_journal":0}\n`));
  files.push(row({ kind: "recovery_executor", state: "executing" }, updateRecoveryExecutorStagedPath(root, "executing"), `{"state":"executing"}\n`));
  files.push(row({ kind: "recovery_executor", state: "terminal_cleanup" }, updateRecoveryExecutorStagedPath(root, "terminal_cleanup"), `{"state":"terminal_cleanup"}\n`));
  const inventory: readonly RollbackPayloadEntryV1[] = [{ ordinal: 0, path: "blobs/0000000000.bin" as RollbackPayloadEntryV1["path"], role: "migration_preimage", bytes: inverseBlob.byteLength, sha256: sha(inverseBlob) }];
  const candidate = { materialization: { outputBlobs: [{ ordinal: 0, bytes: ownerBlob.byteLength, sha256: sha(ownerBlob) }, { ordinal: 1, bytes: inverseBlob.byteLength, sha256: sha(inverseBlob) }], rollbackInventoryEntries: inventory } } as unknown as PreparedUpdateCandidateV1;
  const plan = buildConstructionPlan({
    coordinatorId,
    operation: "update_apply",
    executionBindingHash: sha("synthetic binding"),
    stagingRoot: { path: root, ownerUid: uid as EffectiveUidV1, mode: 448, dev: parseUInt64Decimal(rootStats.dev.toString(10)), ino: parseUInt64Decimal(rootStats.ino.toString(10)) },
    files,
    rollbackSource: { sourcePlanId: parseSafeReasonCode("rollback_source"), payloadId: `rb_${nonce}_13` as RollbackPayloadIdV1, rollbackBindingHash: sha("synthetic rollback binding"), inventoryHash: sha("synthetic inventory"), sources: [{ kind: "planner_output", ordinal: 1 }] },
    candidate,
    constructionJournalCreatedAt: at,
    outerJournalCreatedAt: at,
    outerPlanPath: parseCanonicalAbsolutePathText(`${home}/state/lifecycle-journals/${coordinatorId}.plan.json`) as ExactProductStatePathV1,
    outerJournalPath: parseCanonicalAbsolutePathText(`${home}/state/lifecycle-journals/${coordinatorId}.json`) as ExactProductStatePathV1,
  });
  const rowBytes = new Map(contents.map((content, ordinal) => [ordinal, encoder.encode(content)]));
  const frames = [ownerBlob, inverseBlob].map((content, ordinal) => ({ ordinal, bytes: content.byteLength, sha256: sha(content), content }) as SecretScreenedBlobV1);
  return { home, root, plan, rowBytes, frames, nested: new Set() };
}

function sources(fixtureValue: Fixture, overrides: Partial<UpdateConstructionSourcePortV1> = {}): UpdateConstructionSourcePortV1 {
  return {
    readRow: (_plan, row) => Promise.resolve(fixtureValue.rowBytes.get(row.ordinal) ?? new Uint8Array()),
    prepareSources: () => Promise.resolve(),
    consumeRollbackEntry: () => Promise.resolve(),
    finishSources: () => Promise.resolve(),
    compensateSources: () => Promise.resolve(),
    nestedTerminal: (_plan, row) => Promise.resolve(fixtureValue.nested.has(row.ordinal)),
    ...overrides,
  };
}

function store(fixtureValue: Fixture, options: { readonly interrupt?: (point: UpdateConstructionStoreDeathPointV1) => void; readonly sources?: Partial<UpdateConstructionSourcePortV1>; readonly screen?: (bytes: Uint8Array) => void } = {}): UpdateConstructionStore {
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  return new UpdateConstructionStore({
    fs,
    effectiveUid: uid,
    now: () => new Date(at),
    screen: options.screen ?? (() => undefined),
    sources: sources(fixtureValue, options.sources),
    ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
  }, fixtureValue.root);
}

async function* stream(frames: readonly SecretScreenedBlobV1[]): AsyncGenerator<SecretScreenedBlobV1> {
  for (const frame of frames) yield await Promise.resolve(frame);
}

async function construct(fixtureValue: Fixture, target: UpdateConstructionStore): Promise<void> {
  await target.publish(fixtureValue.plan);
  await target.stageDirectories(fixtureValue.plan);
  await target.stageFiles(fixtureValue.plan, stream(fixtureValue.frames));
  await target.publishOuter(fixtureValue.plan, outerBytes);
}

function killAt(point: UpdateConstructionStoreDeathPointV1, occurrence = 1): (seen: UpdateConstructionStoreDeathPointV1) => void {
  let count = 0;
  return (seen) => {
    if (seen === point && ++count === occurrence) throw new Killed(point);
  };
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

/** Task 22's closure codec, reduced to the construction frontiers this envelope can leave. */
async function closureFor(fixtureValue: Fixture): Promise<UpdateConstructionClosureV1> {
  const paths = updateConstructionEnvelopePaths(fixtureValue.root);
  const operation = fixtureValue.plan.operation;
  const constructionPlanHashValue = constructionPlanHash(fixtureValue.plan);
  if (!(await exists(paths.plan))) return { coordinatorId, construction: { frontier: "plan_pending" } };
  if (await exists(paths.journal)) return { coordinatorId, construction: { frontier: "journal", operation, constructionPlanHash: constructionPlanHashValue } };
  return { coordinatorId, construction: { frontier: "journal_bootstrap", journal: (await exists(paths.journalPending)) ? "pending" : "absent", operation, constructionPlanHash: constructionPlanHashValue } };
}

async function assertNoTargetMutation(fixtureValue: Fixture): Promise<boolean> {
  const children = await nodeFs.readdir(fixtureValue.root);
  const outer = (await exists(fixtureValue.plan.outerPlanPath)) || (await exists(fixtureValue.plan.outerJournalPath));
  return children.length === 0 && !outer;
}

async function interruptConstruction(point: UpdateConstructionStoreDeathPointV1): Promise<{ readonly fixture: Fixture; readonly recover: () => Promise<void>; readonly assertNoTargetMutation: () => Promise<boolean> }> {
  const value = await fixture();
  await expect(construct(value, store(value, { interrupt: killAt(point) }))).rejects.toBeInstanceOf(Killed);
  return {
    fixture: value,
    recover: async () => store(value).recover(await closureFor(value)),
    assertNoTargetMutation: () => assertNoTargetMutation(value),
  };
}

const constructionDeathPoints = UPDATE_CONSTRUCTION_STORE_DEATH_POINTS
  .filter((point) => point !== "compensation_step" && point !== "compaction_step")
  .map((name) => ({ name }));

function journalOnDisk(fixtureValue: Fixture): { readonly phase: string; readonly fileWriteState: { readonly state: string; readonly ordinal: number } | null; readonly directoryWriteState: { readonly state: string } | null } {
  return JSON.parse(readFileSync(updateConstructionEnvelopePaths(fixtureValue.root).journal, "utf8")) as ReturnType<typeof journalOnDisk>;
}

describe("UpdateConstructionStore", () => {
  it("publishes the plan and journal, stages every row with evidence, and hands off", async () => {
    const value = await fixture();
    await construct(value, store(value));
    expect(journalOnDisk(value).phase).toBe("handed_off");
    for (const row of value.plan.files) {
      expect(await exists(row.path)).toBe(true);
      expect(await exists(`${value.root}/update/construction/evidence/${row.ordinal.toString(10).padStart(10, "0")}.json`)).toBe(true);
    }
    expect(new Uint8Array(await nodeFs.readFile(value.plan.outerPlanPath))).toEqual(outerBytes.plan);
    expect(new Uint8Array(await nodeFs.readFile(value.plan.outerJournalPath))).toEqual(outerBytes.journal);
    expect(await exists(updateConstructionEnvelopePaths(value.root).journalRewritePending)).toBe(false);
  });

  it("records each row's inode in its evidence and writes owner-only single-link files", async () => {
    const value = await fixture();
    await construct(value, store(value));
    for (const row of value.plan.files) {
      const stats = await nodeFs.lstat(row.path, { bigint: true });
      const evidence = JSON.parse(await nodeFs.readFile(`${value.root}/update/construction/evidence/${row.ordinal.toString(10).padStart(10, "0")}.json`, "utf8")) as { readonly dev: string; readonly ino: string; readonly sha256: string };
      expect(evidence).toMatchObject({ dev: stats.dev.toString(10), ino: stats.ino.toString(10), sha256: row.sha256 });
      expect(stats.mode & 0o777n).toBe(0o600n);
      expect(stats.nlink).toBe(1n);
    }
  });

  it.each(constructionDeathPoints)("compensates planlessly at $name", async ({ name }) => {
    const interrupted = await interruptConstruction(name);
    await interrupted.recover();
    expect(await interrupted.assertNoTargetMutation()).toBe(true);
  });

  it.each(constructionDeathPoints)("compensates at the last $name before handoff", async ({ name }) => {
    const value = await fixture();
    let total = 0;
    await construct(value, store(value, { interrupt: (point) => { if (point === name) total += 1; } }));
    await nodeFs.rm(value.home, { recursive: true, force: true });
    const fresh = await fixture();
    // The final journal rewrite is the handoff itself; the death before it is the latest pre-handoff state.
    const occurrence = name === "journal_rewritten" || name === "journal_rewrite_pending" ? total - 1 : total;
    await expect(construct(fresh, store(fresh, { interrupt: killAt(name, occurrence) }))).rejects.toBeInstanceOf(Killed);
    await store(fresh).recover(await closureFor(fresh));
    expect(await assertNoTargetMutation(fresh)).toBe(true);
  });

  it("never resumes a partial write after death: the partial row is removed, not completed", async () => {
    const interrupted = await interruptConstruction("file_written");
    const journal = journalOnDisk(interrupted.fixture);
    expect(journal.fileWriteState?.state).toBe("created");
    await interrupted.recover();
    expect(await interrupted.assertNoTargetMutation()).toBe(true);
  });

  it("resumes compensation after a death inside compensation", async () => {
    const value = await fixture();
    await expect(construct(value, store(value, { interrupt: killAt("evidence_written", 4) }))).rejects.toBeInstanceOf(Killed);
    await expect(store(value, { interrupt: killAt("compensation_step", 3) }).recover(await closureFor(value))).rejects.toBeInstanceOf(Killed);
    expect(journalOnDisk(value).phase).toBe("compensating");
    await store(value).recover(await closureFor(value));
    expect(await assertNoTargetMutation(value)).toBe(true);
  });

  it("binds an exact zero-byte file left at create intent before removing it", async () => {
    const value = await fixture();
    const interrupt = (point: UpdateConstructionStoreDeathPointV1): void => {
      if (point !== "journal_rewritten") return;
      const journal = journalOnDisk(value);
      if (journal.fileWriteState?.state === "create_intent" && journal.fileWriteState.ordinal === 2) {
        writeFileSync((value.plan.files[2] as UpdateConstructionFilePlanV1).path, "", { mode: 0o600, flag: "wx" });
        throw new Killed("after exclusive create");
      }
    };
    await expect(construct(value, store(value, { interrupt }))).rejects.toBeInstanceOf(Killed);
    await store(value).recover(await closureFor(value));
    expect(await assertNoTargetMutation(value)).toBe(true);
  });

  it("preserves an unbound nonempty path at create intent as recovery-required", async () => {
    const value = await fixture();
    const target = (value.plan.files[2] as UpdateConstructionFilePlanV1).path;
    const interrupt = (point: UpdateConstructionStoreDeathPointV1): void => {
      if (point !== "journal_rewritten") return;
      const journal = journalOnDisk(value);
      if (journal.fileWriteState?.state === "create_intent" && journal.fileWriteState.ordinal === 2) {
        writeFileSync(target, "foreign bytes", { mode: 0o600, flag: "wx" });
        throw new Killed("foreign writer");
      }
    };
    await expect(construct(value, store(value, { interrupt }))).rejects.toBeInstanceOf(Killed);
    await expect(store(value).recover(await closureFor(value))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await nodeFs.readFile(target, "utf8")).toBe("foreign bytes");
  });

  it("preserves a row whose inode was swapped after its evidence", async () => {
    const value = await fixture();
    await expect(construct(value, store(value, { interrupt: killAt("evidence_written", 2) }))).rejects.toBeInstanceOf(Killed);
    const swapped = (value.plan.files[0] as UpdateConstructionFilePlanV1).path;
    await nodeFs.rm(swapped);
    await nodeFs.writeFile(swapped, "{}\n", { mode: 0o600 });
    await expect(store(value).recover(await closureFor(value))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await nodeFs.readFile(swapped, "utf8")).toBe("{}\n");
  });

  it("refuses a lone plan temp beside any second child", async () => {
    const value = await fixture();
    await expect(construct(value, store(value, { interrupt: killAt("plan_pending_written") }))).rejects.toBeInstanceOf(Killed);
    await nodeFs.writeFile(`${value.root}/stray`, "x", { mode: 0o600 });
    await expect(store(value).recover(await closureFor(value))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(updateConstructionEnvelopePaths(value.root).planPending)).toBe(true);
  });

  it("refuses an initial-journal temp that is not a prefix of the derived journal", async () => {
    const value = await fixture();
    await expect(construct(value, store(value, { interrupt: killAt("journal_pending_written") }))).rejects.toBeInstanceOf(Killed);
    const pending = updateConstructionEnvelopePaths(value.root).journalPending;
    await nodeFs.writeFile(pending, `{"forged":true}\n`);
    await expect(store(value).recover(await closureFor(value))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(pending)).toBe(true);
  });

  it("refuses a closure whose plan hash differs from the reopened plan", async () => {
    const value = await fixture();
    await expect(construct(value, store(value, { interrupt: killAt("directory_made") }))).rejects.toBeInstanceOf(Killed);
    const closure: UpdateConstructionClosureV1 = { coordinatorId, construction: { frontier: "journal", operation: "update_apply", constructionPlanHash: sha("other plan") } };
    await expect(store(value).recover(closure)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses pre-handoff recovery once construction has handed off", async () => {
    const value = await fixture();
    await construct(value, store(value));
    await expect(store(value).recover(await closureFor(value))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(journalOnDisk(value).phase).toBe("handed_off");
  });

  it("refuses a changed source before creating its row", async () => {
    const value = await fixture();
    const target = store(value, { sources: { readRow: (_plan, row) => Promise.resolve(row.ordinal === 1 ? encoder.encode("changed\n") : (value.rowBytes.get(row.ordinal) ?? new Uint8Array())) } });
    await expect(construct(value, target)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists((value.plan.files[1] as UpdateConstructionFilePlanV1).path)).toBe(false);
    expect(journalOnDisk(value).fileWriteState).toBeNull();
  });

  it("screens every row and frame before byte zero", async () => {
    const value = await fixture();
    const screened: Uint8Array[] = [];
    await construct(value, store(value, { screen: (bytes) => { screened.push(bytes); } }));
    for (const frame of value.frames) expect(screened.some((bytes) => Buffer.compare(bytes, frame.content) === 0)).toBe(true);
    const refusing = await fixture();
    const secret = (bytes: Uint8Array): void => {
      if (Buffer.compare(bytes, ownerBlob) === 0) throw new Error("secret screen finding");
    };
    await expect(construct(refusing, store(refusing, { screen: secret }))).rejects.toThrow("secret screen finding");
    expect(await exists((refusing.plan.files[6] as UpdateConstructionFilePlanV1).path)).toBe(false);
  });

  it("refuses a frame that differs from its planned identity", async () => {
    const value = await fixture();
    const target = store(value);
    await target.publish(value.plan);
    await target.stageDirectories(value.plan);
    const forged = { ...value.frames[0], content: encoder.encode("forged owner content\n") } as SecretScreenedBlobV1;
    await expect(target.stageFiles(value.plan, stream([forged, value.frames[1] as SecretScreenedBlobV1]))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("streams one frame to every consumer before accepting the next", async () => {
    const value = await fixture();
    const consumed: number[] = [];
    await construct(value, store(value, { sources: { consumeRollbackEntry: (_plan, ordinal, frame) => { consumed.push(ordinal, frame.ordinal); return Promise.resolve(); } } }));
    expect(consumed).toEqual([0, 1]);
  });

  it("compacts terminal nested absence and construction leaves, then removes the envelope", async () => {
    const value = await fixture();
    const target = store(value);
    await construct(value, target);
    for (const row of value.plan.files.slice(3)) {
      await nodeFs.rm(row.path);
      value.nested.add(row.ordinal);
    }
    await target.compact(value.plan);
    await target.removeEnvelope(value.plan);
    expect(await nodeFs.readdir(value.root)).toEqual([]);
    for (const row of value.plan.files.slice(0, 3)) expect(await exists(row.path)).toBe(false);
  });

  it("refuses compaction of a delegated row that is still present or not terminal", async () => {
    const value = await fixture();
    const target = store(value);
    await construct(value, target);
    await expect(target.compact(value.plan)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists((value.plan.files[value.plan.files.length - 1] as UpdateConstructionFilePlanV1).path)).toBe(true);
  });

  it("resumes compaction after a death between a file and its evidence", async () => {
    const value = await fixture();
    await construct(value, store(value));
    for (const row of value.plan.files.slice(3)) {
      await nodeFs.rm(row.path);
      value.nested.add(row.ordinal);
    }
    const plannedFiles = value.plan.files.length;
    await expect(store(value, { interrupt: killAt("compaction_step", 2 * plannedFiles - 5) }).compact(value.plan)).rejects.toBeInstanceOf(Killed);
    const resumed = store(value);
    await resumed.compact(value.plan);
    await resumed.removeEnvelope(value.plan);
    expect(await nodeFs.readdir(value.root)).toEqual([]);
  });
});
