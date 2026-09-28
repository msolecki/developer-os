import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceUpdateCoordinatorJournal,
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  initialUpdateCoordinatorJournal,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseSafeReasonCode,
  parseUtcTimestamp,
  updateCoordinatorEnvelopePaths,
  updateCoordinatorOuterBytes,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type LifecycleGuardedFileSystemV1,
  type UpdateCompactionEntryV1,
  type UpdateLifecycleCoordinatorPlanV2,
  type UpdateLifecycleCoordinatorStepV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  UPDATE_COORDINATOR_STORE_DEATH_POINTS,
  UpdateCoordinatorJournalStore,
  UpdateStepDispatcher,
  type UpdateCoordinatorStoreDeathPointV1,
  type UpdateStepHandlerV1,
  type UpdateStepHandlersV1,
} from "./coordinator.js";
import { PLANNED_AT, SYNTHETIC_COORDINATOR_ID, syntheticUpdateCoordinator } from "./testing.js";

const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const clock = parseUtcTimestamp("2026-09-23T12:00:05.000Z");
const uuid = () => "00000000-0000-4000-8000-000000000001";

class Killed extends Error {}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

function guardedFs(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

interface Envelope {
  readonly home: CanonicalAbsolutePathV1;
  readonly plan: UpdateLifecycleCoordinatorPlanV2;
  readonly paths: ReturnType<typeof updateCoordinatorEnvelopePaths>;
  readonly store: (interrupt?: (point: UpdateCoordinatorStoreDeathPointV1) => void) => UpdateCoordinatorJournalStore;
}

async function envelope(): Promise<Envelope> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-update-coordinator-"))));
  homes.push(home);
  await nodeFs.mkdir(`${home}/state/lifecycle-journals`, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(`${home}/state`, 0o700);
  const { plan } = syntheticUpdateCoordinator(home);
  const paths = updateCoordinatorEnvelopePaths(home, plan.id);
  const outer = updateCoordinatorOuterBytes(plan, PLANNED_AT);
  await nodeFs.writeFile(paths.plan, outer.plan, { mode: 0o600, flag: "wx" });
  await nodeFs.writeFile(paths.journal, outer.journal, { mode: 0o600, flag: "wx" });
  return {
    home,
    plan,
    paths,
    store: (interrupt) => new UpdateCoordinatorJournalStore({ fs: guardedFs(), productHome: home, effectiveUid: uid, uuid, ...(interrupt === undefined ? {} : { interrupt }) }),
  };
}

describe("UpdateCoordinatorJournalStore", () => {
  it("reopens the exact V2 plan and initial journal the construction envelope published", async () => {
    const { plan, store } = await envelope();
    const read = await store().read(SYNTHETIC_COORDINATOR_ID);
    expect(read.plan).toEqual(plan);
    expect(read.journal).toEqual(initialUpdateCoordinatorJournal(plan, PLANNED_AT));
  });

  it("rewrites by temp plus rename-over and refuses a stale current journal", async () => {
    const { plan, store } = await envelope();
    const { journal } = await store().read(SYNTHETIC_COORDINATOR_ID);
    const started = advanceUpdateCoordinatorJournal(plan, journal, { kind: "start" }, clock);
    await store().rewrite(plan, journal, started);
    expect((await store().read(SYNTHETIC_COORDINATOR_ID)).journal).toEqual(started);
    await expect(store().rewrite(plan, journal, started)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("persists the compensation cause across a fresh read and refuses a journal without the key (P7(b))", async () => {
    const { plan, paths, store } = await envelope();
    const { journal } = await store().read(SYNTHETIC_COORDINATOR_ID);
    const started = advanceUpdateCoordinatorJournal(plan, journal, { kind: "start" }, clock);
    await store().rewrite(plan, journal, started);
    const compensating = advanceUpdateCoordinatorJournal(plan, started, { kind: "compensation_started", cause: parseSafeReasonCode("update_verifier_rejected") }, clock);
    await store().rewrite(plan, started, compensating);
    expect((await store().read(SYNTHETIC_COORDINATOR_ID)).journal).toMatchObject({ direction: "compensating", compensationCause: "update_verifier_rejected" });

    const legacy: Record<string, unknown> = { ...compensating };
    delete legacy.compensationCause;
    await nodeFs.writeFile(paths.journal, `${encodeCanonicalJson(legacy as CanonicalJsonValue).trimEnd()}\n`);
    await expect(store().read(SYNTHETIC_COORDINATOR_ID)).rejects.toMatchObject({ code: 6 });
  });

  it("keeps the old journal intact when killed after the rewrite temp", async () => {
    const { plan, paths, store } = await envelope();
    const before = await nodeFs.readFile(paths.journal);
    const { journal } = await store().read(SYNTHETIC_COORDINATOR_ID);
    const killer = store((point) => {
      if (point === "rewrite_temp_written") throw new Killed(point);
    });
    await expect(killer.rewrite(plan, journal, advanceUpdateCoordinatorJournal(plan, journal, { kind: "start" }, clock))).rejects.toBeInstanceOf(Killed);
    expect(await nodeFs.readFile(paths.journal)).toEqual(before);
  });

  it("refuses a V1 plan, a non-canonical journal, and a widened mode", async () => {
    const first = await envelope();
    await nodeFs.writeFile(first.paths.plan, `${encodeCanonicalJson({ schemaVersion: 1, id: SYNTHETIC_COORDINATOR_ID }).trimEnd()}\n`);
    await expect(first.store().read(SYNTHETIC_COORDINATOR_ID)).rejects.toMatchObject({ code: 6 });

    const second = await envelope();
    const journal = JSON.parse(await nodeFs.readFile(second.paths.journal, "utf8")) as unknown;
    await nodeFs.writeFile(second.paths.journal, `${JSON.stringify(journal, null, 2)}\n`);
    await expect(second.store().read(SYNTHETIC_COORDINATOR_ID)).rejects.toMatchObject({ code: 6 });

    const third = await envelope();
    await nodeFs.chmod(third.paths.journal, 0o644);
    await expect(third.store().read(SYNTHETIC_COORDINATOR_ID)).rejects.toMatchObject({ code: 6 });
  });

  it("removes the envelope journal, lock, then plan, and finishes a plan-only suffix", async () => {
    const { plan, paths, store } = await envelope();
    const { journal } = await store().read(SYNTHETIC_COORDINATOR_ID);
    await expect(store().removeEnvelope(plan, journal)).rejects.toMatchObject({ code: 6 });
    const compacting = { ...journal, phase: "compacting", direction: "forward", nextStep: plan.steps.length, pointOfNoReturnReached: true, terminalOutcome: "finalized", compactionNext: plan.compaction.entries.length - 1 } as const;
    const lock = `${paths.plan.slice(0, paths.plan.lastIndexOf("/"))}/.${plan.id}.lock`;
    await nodeFs.writeFile(lock, "", { mode: 0o600 });
    const killer = store((point) => {
      if (point === "envelope_journal_removed") throw new Killed(point);
    });
    await expect(killer.removeEnvelope(plan, compacting)).rejects.toBeInstanceOf(Killed);
    expect(await exists(paths.journal)).toBe(false);
    expect(await store().isEnvelopeSuffix(plan.id)).toBe(true);
    await store().completeEnvelopeSuffix(plan.id);
    expect(await exists(lock)).toBe(false);
    expect(await exists(paths.plan)).toBe(false);
    expect(UPDATE_COORDINATOR_STORE_DEATH_POINTS).toContain("envelope_plan_removed");
  });
});

describe("UpdateStepDispatcher", () => {
  function recordingHandler<TStep>(log: string[], label: string): UpdateStepHandlerV1<TStep> {
    return {
      apply: () => {
        log.push(`apply:${label}`);
        return Promise.resolve({ state: "applied" });
      },
      observe: () => Promise.resolve({ state: "applied" }),
      compensate: () => {
        log.push(`compensate:${label}`);
        return Promise.resolve({ state: "compensated" });
      },
    };
  }

  function dispatcher(log: string[]): UpdateStepDispatcher {
    const handlers: UpdateStepHandlersV1 = {
      bundle: recordingHandler(log, "bundle"),
      owner_files: recordingHandler(log, "owner_files"),
      owner_external_effect: recordingHandler(log, "owner_external_effect"),
      schema_migration: recordingHandler(log, "schema_migration"),
      manifest: recordingHandler(log, "manifest"),
      trust: recordingHandler(log, "trust"),
      rollback_payload: recordingHandler(log, "rollback_payload"),
      rollback_record: recordingHandler(log, "rollback_record"),
      active: recordingHandler(log, "active"),
      target_verifier: recordingHandler(log, "target_verifier"),
    };
    const compact = (entry: UpdateCompactionEntryV1) => {
      log.push(`compact:${entry.kind}`);
      return Promise.resolve();
    };
    return new UpdateStepDispatcher(
      handlers,
      { owner_update: compact, schema_migration: compact, owner_external_effect: compact, state_participant: compact, coordinator_staging: compact },
      { leaves: () => Promise.resolve(2), retire: (_step, ordinal) => { log.push(`retire:${String(ordinal)}`); return Promise.resolve(); } },
    );
  }

  it("routes every participant step to its own handler", async () => {
    const log: string[] = [];
    const { plan } = syntheticUpdateCoordinator(parseCanonicalAbsolutePathText("/synthetic/user/.developer-os"));
    const routed = plan.steps.filter((step) => step.kind !== "recovery_executor" && step.kind !== "terminal_retire");
    for (const step of routed) await dispatcher(log).apply(step);
    expect(log).toEqual(routed.map((step) => `apply:${step.kind}`));
  });

  it("leaves the executor switch, retirement cursor, and envelope to the engine", async () => {
    const log: string[] = [];
    const engine: readonly UpdateLifecycleCoordinatorStepV1[] = [
      { kind: "recovery_executor", transition: "switch_to_fallback" },
      { kind: "terminal_retire", set: "prior_rollback" },
    ];
    for (const step of engine) await expect(dispatcher(log).apply(step)).rejects.toMatchObject({ code: 6 });
    await expect(dispatcher(log).compact({ kind: "coordinator_envelope" })).rejects.toMatchObject({ code: 6 });
    await dispatcher(log).compact({ kind: "coordinator_staging" });
    expect(await dispatcher(log).retirementLeaves({ kind: "terminal_retire", set: "prior_rollback" })).toBe(2);
    expect(log).toEqual(["compact:coordinator_staging"]);
  });
});
