import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  UpdateLifecycleCoordinator,
  assertUpdateCoordinatorDerivation,
  classifyLifecycleJournalClosureV2,
  createNodeLifecycleGuardedFileSystem,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUtcTimestamp,
  updateCoordinatorEnvelopePaths,
  updateCoordinatorOuterBytes,
  updateRecoveryExecutorRecordBytes,
  type CanonicalAbsolutePathV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleJournalClosureV2,
  type UpdateLifecycleOutcomeV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { UpdateCoordinatorJournalStore, UpdateStepDispatcher, type UpdateStepHandlerV1, type UpdateStepHandlersV1 } from "./coordinator.js";
import {
  UPDATE_RECOVERY_EXECUTOR_DEATH_POINTS,
  UpdateRecoveryExecutorFiles,
  readUpdateExecutorRecord,
  removeOrphanTerminalExecutorRecord,
  routeUpdateRecovery,
  type UpdateRecoveryExecutorDeathPointV1,
  type UpdateRecoveryRoutesV1,
} from "./recovery.js";
import { PLANNED_AT, SYNTHETIC_COORDINATOR_ID, SYNTHETIC_EVIDENCE, syntheticUpdateCoordinator, type SyntheticUpdateCoordinatorV1 } from "./testing.js";

const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const clock = () => parseUtcTimestamp("2026-09-23T12:00:05.000Z");

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

interface World {
  readonly home: CanonicalAbsolutePathV1;
  readonly synthetic: SyntheticUpdateCoordinatorV1;
  readonly finalPath: string;
  readonly initialStaged: string;
  readonly terminalStaged: string;
  readonly files: (interrupt?: (point: UpdateRecoveryExecutorDeathPointV1) => void) => UpdateRecoveryExecutorFiles;
}

/** A synthetic product home holding the V2 envelope and both construction-staged executor records. */
async function world(): Promise<World> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-update-recovery-"))));
  homes.push(home);
  const synthetic = syntheticUpdateCoordinator(home);
  const { recoveryExecutor } = synthetic.execution;
  await nodeFs.mkdir(`${home}/state/lifecycle-journals`, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(`${home}/state`, 0o700);
  await nodeFs.mkdir(recoveryExecutor.initialStaged.path.slice(0, recoveryExecutor.initialStaged.path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(recoveryExecutor.initialStaged.path, updateRecoveryExecutorRecordBytes(recoveryExecutor.initial), { mode: 0o600, flag: "wx" });
  await nodeFs.writeFile(recoveryExecutor.terminalStaged.path, updateRecoveryExecutorRecordBytes(recoveryExecutor.terminal), { mode: 0o600, flag: "wx" });
  const paths = updateCoordinatorEnvelopePaths(home, synthetic.plan.id);
  const outer = updateCoordinatorOuterBytes(synthetic.plan, PLANNED_AT);
  await nodeFs.writeFile(paths.plan, outer.plan, { mode: 0o600, flag: "wx" });
  await nodeFs.writeFile(paths.journal, outer.journal, { mode: 0o600, flag: "wx" });
  return {
    home,
    synthetic,
    finalPath: recoveryExecutor.finalPath,
    initialStaged: recoveryExecutor.initialStaged.path,
    terminalStaged: recoveryExecutor.terminalStaged.path,
    files: (interrupt) => new UpdateRecoveryExecutorFiles({ fs: guardedFs(), effectiveUid: uid, descriptor: recoveryExecutor, ...(interrupt === undefined ? {} : { interrupt }) }),
  };
}

function killAt(point: UpdateRecoveryExecutorDeathPointV1): (reached: UpdateRecoveryExecutorDeathPointV1) => void {
  return (reached) => {
    if (reached === point) throw new Killed(reached);
  };
}

describe("UpdateRecoveryExecutorFiles", () => {
  it("renames the initial stage no-replace and keeps the terminal stage bound", async () => {
    const { synthetic, files, finalPath, initialStaged, terminalStaged } = await world();
    await files().publishInitial(synthetic.plan);
    expect(await nodeFs.readFile(finalPath)).toEqual(Buffer.from(updateRecoveryExecutorRecordBytes(synthetic.execution.recoveryExecutor.initial)));
    expect(await exists(initialStaged)).toBe(false);
    expect(await exists(terminalStaged)).toBe(true);
    await files().publishInitial(synthetic.plan);
  });

  it("replaces the executing record with the terminal fallback record exactly once", async () => {
    const { synthetic, files, finalPath, terminalStaged } = await world();
    await files().publishInitial(synthetic.plan);
    await files().switchToFallback(synthetic.plan);
    expect(await nodeFs.readFile(finalPath)).toEqual(Buffer.from(updateRecoveryExecutorRecordBytes(synthetic.execution.recoveryExecutor.terminal)));
    expect(await exists(terminalStaged)).toBe(false);
    await files().switchToFallback(synthetic.plan);
    await files().removeRecord(synthetic.plan);
    expect(await exists(finalPath)).toBe(false);
  });

  it.each(UPDATE_RECOVERY_EXECUTOR_DEATH_POINTS)("resumes after death at %s", async (point) => {
    const { synthetic, files, finalPath } = await world();
    const run = async (interrupt?: (reached: UpdateRecoveryExecutorDeathPointV1) => void) => {
      await files(interrupt).publishInitial(synthetic.plan);
      await files(interrupt).switchToFallback(synthetic.plan);
      await files(interrupt).removeRecord(synthetic.plan);
    };
    await expect(run(killAt(point))).rejects.toBeInstanceOf(Killed);
    // §9.2: the unlink runs after the envelope is gone, so resume never re-publishes; with no final
    // record and no stage, publishInitial is an unadmitted state and rightly exit 6.
    if (point === "record_unlinked") await files().removeRecord(synthetic.plan);
    else await run();
    expect(await exists(finalPath)).toBe(false);
  });

  it("refuses to remove an executing record or to publish over a foreign one", async () => {
    const first = await world();
    await first.files().publishInitial(first.synthetic.plan);
    await expect(first.files().removeRecord(first.synthetic.plan)).rejects.toMatchObject({ code: 6 });

    const second = await world();
    await nodeFs.writeFile(second.finalPath, "{}\n", { mode: 0o600 });
    await expect(second.files().publishInitial(second.synthetic.plan)).rejects.toMatchObject({ code: 6 });
  });

  it("refuses a partial initial stage instead of renaming it", async () => {
    const { synthetic, files, initialStaged, finalPath } = await world();
    const bytes = await nodeFs.readFile(initialStaged);
    await nodeFs.writeFile(initialStaged, bytes.subarray(0, bytes.byteLength - 1));
    await expect(files().publishInitial(synthetic.plan)).rejects.toMatchObject({ code: 6 });
    expect(await exists(finalPath)).toBe(false);
  });

  it("refuses a plan that does not bind these two records", async () => {
    const { synthetic, files } = await world();
    const foreign = { ...synthetic.plan, recoveryExecutorTerminalHash: parseLowerHexSha256("0".repeat(64)) };
    await expect(files().publishInitial(foreign)).rejects.toMatchObject({ code: 6 });
  });
});

describe("the update_executor_cleanup suffix", () => {
  it("unlinks only a terminal_cleanup record for the named coordinator", async () => {
    const { home, synthetic, files, finalPath } = await world();
    await files().publishInitial(synthetic.plan);
    await expect(removeOrphanTerminalExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE, SYNTHETIC_COORDINATOR_ID)).rejects.toMatchObject({ code: 6 });
    await files().switchToFallback(synthetic.plan);
    const held = await readUpdateExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE);
    expect(held?.record.state).toBe("terminal_cleanup");
    await expect(removeOrphanTerminalExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE, `lc_${"c".repeat(64)}_6` as LifecycleCoordinatorIdV1)).rejects.toMatchObject({ code: 6 });
    await removeOrphanTerminalExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE, SYNTHETIC_COORDINATOR_ID);
    expect(await exists(finalPath)).toBe(false);
  });

  it("reads fresh init's empty reservation as no record", async () => {
    const { home, finalPath } = await world();
    await nodeFs.writeFile(finalPath, "", { mode: 0o600 });
    await expect(readUpdateExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE)).resolves.toBeNull();
    await removeOrphanTerminalExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE, SYNTHETIC_COORDINATOR_ID);
    expect(await exists(finalPath)).toBe(true);
  });

  it("treats malformed record bytes as exit 6, never as absence", async () => {
    const { home, finalPath } = await world();
    await nodeFs.writeFile(finalPath, "not json\n", { mode: 0o600 });
    await expect(readUpdateExecutorRecord(guardedFs(), home, uid, SYNTHETIC_EVIDENCE)).rejects.toMatchObject({ code: 6 });
  });
});

describe("routeUpdateRecovery", () => {
  function routes(calls: string[]): UpdateRecoveryRoutesV1 {
    return {
      coordinator: {
        recover: (id) => {
          calls.push(`recover:${id}`);
          return Promise.resolve({ kind: "finalized", id });
        },
      },
      envelope: {
        isEnvelopeSuffix: () => Promise.resolve(false),
        completeEnvelopeSuffix: (id) => {
          calls.push(`suffix:${id}`);
          return Promise.resolve();
        },
      },
      construction: {
        compensate: (closure) => {
          calls.push(`construction:${closure.construction.frontier}`);
          return Promise.resolve();
        },
      },
      executorCleanup: (id) => {
        calls.push(`executor:${id}`);
        return Promise.resolve();
      },
    };
  }

  it.each<[LifecycleJournalClosureV2, readonly string[]]>([
    [{ kind: "update_recovery", coordinatorId: SYNTHETIC_COORDINATOR_ID, operation: "update_apply", direction: "forward" }, [`recover:${SYNTHETIC_COORDINATOR_ID}`]],
    [{ kind: "update_construction_cleanup", coordinatorId: SYNTHETIC_COORDINATOR_ID, direction: "compensating", construction: { frontier: "plan_pending" } }, ["construction:plan_pending"]],
    [{ kind: "update_executor_cleanup", coordinatorId: SYNTHETIC_COORDINATOR_ID }, [`executor:${SYNTHETIC_COORDINATOR_ID}`]],
    [{ kind: "clear" }, []],
    [{ kind: "lifecycle_recovery_required" }, []],
  ])("routes %j with local authority only", async (closure, expected) => {
    const calls: string[] = [];
    await routeUpdateRecovery(closure, routes(calls));
    expect(calls).toEqual(expected);
  });

  it("finishes a plan-only envelope suffix and then the executor record", async () => {
    const calls: string[] = [];
    const suffix = { ...routes(calls), envelope: { ...routes(calls).envelope, isEnvelopeSuffix: () => Promise.resolve(true) } };
    const outcome = await routeUpdateRecovery({ kind: "update_recovery", coordinatorId: SYNTHETIC_COORDINATOR_ID, operation: "update_apply", direction: "forward" }, suffix);
    expect(outcome.kind).toBe("envelope_suffix");
    expect(calls).toEqual([`suffix:${SYNTHETIC_COORDINATOR_ID}`, `executor:${SYNTHETIC_COORDINATOR_ID}`]);
  });
});

describe("the composed V2 coordinator over a real product home", () => {
  function handler<TStep>(): UpdateStepHandlerV1<TStep> {
    return {
      apply: () => Promise.resolve({ state: "applied" }),
      observe: () => Promise.resolve({ state: "applied" }),
      compensate: () => Promise.resolve({ state: "compensated" }),
    };
  }

  function coordinator(target: World, network: { calls: number }, interrupt?: (point: UpdateRecoveryExecutorDeathPointV1) => void): UpdateLifecycleCoordinator {
    const steps: UpdateStepHandlersV1 = {
      bundle: handler(),
      owner_files: handler(),
      owner_external_effect: handler(),
      schema_migration: handler(),
      manifest: handler(),
      trust: handler(),
      rollback_payload: handler(),
      rollback_record: handler(),
      active: handler(),
      target_verifier: { ...handler(), apply: () => Promise.resolve({ state: "verified" }) },
    };
    const none = () => Promise.resolve();
    return new UpdateLifecycleCoordinator({
      store: new UpdateCoordinatorJournalStore({ fs: guardedFs(), productHome: target.home, effectiveUid: uid, uuid: () => "00000000-0000-4000-8000-000000000002" }),
      participants: new UpdateStepDispatcher(
        steps,
        { owner_update: none, schema_migration: none, owner_external_effect: none, state_participant: none, coordinator_staging: none },
        { leaves: () => Promise.resolve(2), retire: none },
      ),
      executor: target.files(interrupt),
      verifyPlan: (plan) => {
        assertUpdateCoordinatorDerivation(plan, target.synthetic.execution, target.synthetic.owners);
        return Promise.resolve();
      },
      requireLock: () => Promise.resolve(),
      clock,
      afterBoundary: () => {
        if (network.calls !== 0) throw new Error("recovery reached the network");
      },
    });
  }

  async function recover(target: World, network: { calls: number }): Promise<UpdateLifecycleOutcomeV1 | null> {
    const paths = updateCoordinatorEnvelopePaths(target.home, SYNTHETIC_COORDINATOR_ID);
    const held = await readUpdateExecutorRecord(guardedFs(), target.home, uid, SYNTHETIC_EVIDENCE);
    const hasPlan = await exists(paths.plan);
    const journal = hasPlan && (await exists(paths.journal));
    const closure = classifyLifecycleJournalClosureV2({
      v1: { kind: "clear" },
      malformed: false,
      updateCoordinators: hasPlan ? [{ id: SYNTHETIC_COORDINATOR_ID, operation: "update_apply", direction: "forward" }] : [],
      constructions: [],
      executorRecord: held === null ? null : { state: held.record.state, coordinatorId: held.record.coordinatorId },
    });
    const store = new UpdateCoordinatorJournalStore({ fs: guardedFs(), productHome: target.home, effectiveUid: uid, uuid: () => "00000000-0000-4000-8000-000000000003" });
    const routed = await routeUpdateRecovery(closure, {
      coordinator: { recover: (id) => coordinator(target, network).recover(id) },
      envelope: { isEnvelopeSuffix: () => Promise.resolve(hasPlan && !journal), completeEnvelopeSuffix: (id) => store.completeEnvelopeSuffix(id) },
      construction: { compensate: () => Promise.reject(new Error("no construction envelope")) },
      executorCleanup: (id) => removeOrphanTerminalExecutorRecord(guardedFs(), target.home, uid, SYNTHETIC_EVIDENCE, id),
    });
    return routed.kind === "coordinator" ? routed.outcome : null;
  }

  it("runs apply to finalized and leaves neither envelope nor executor record", async () => {
    const target = await world();
    const network = { calls: 0 };
    const outcome = await coordinator(target, network).execute(SYNTHETIC_COORDINATOR_ID);
    expect(outcome).toEqual({ kind: "finalized", id: SYNTHETIC_COORDINATOR_ID });
    expect(await exists(target.finalPath)).toBe(false);
    expect(await exists(updateCoordinatorEnvelopePaths(target.home, SYNTHETIC_COORDINATOR_ID).plan)).toBe(false);
  });

  it.each(UPDATE_RECOVERY_EXECUTOR_DEATH_POINTS)("recovers a death at %s with zero network or planner calls", async (point) => {
    const target = await world();
    const network = { calls: 0 };
    await expect(coordinator(target, network, killAt(point)).execute(SYNTHETIC_COORDINATOR_ID)).rejects.toBeInstanceOf(Killed);
    await recover(target, network);
    expect(network.calls).toBe(0);
    expect(await exists(target.finalPath)).toBe(false);
    expect(await exists(updateCoordinatorEnvelopePaths(target.home, SYNTHETIC_COORDINATOR_ID).journal)).toBe(false);
  });
});
