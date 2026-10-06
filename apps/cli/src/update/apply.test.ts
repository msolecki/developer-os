import {
  assertUpdateCoordinatorDerivation,
  EXIT_CODES,
  initialUpdateCoordinatorJournal,
  LifecycleRecoveryRequiredError,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateCoordinatorOuterBytes,
} from "@developer-os/core";
import type {
  LifecycleIdPrefixV1,
  LifecycleJournalClosureV2,
  ReleaseIdentityV1,
  UpdateCapacityInputV1,
  UpdateConstructionJournalV1,
  UpdateConstructionPlanV1,
  UpdateCoordinatorBoundaryV1,
  UpdateCoordinatorParticipantsV1,
  UpdateLifecycleCoordinatorDependenciesV1,
  UpdateLifecycleCoordinatorJournalV2,
  UpdateLifecycleCoordinatorPlanV2,
  UpdateLifecycleCoordinatorStepV1,
  UpdateParticipantObservationV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { applyUpdate, recoverUpdate } from "./apply.js";
import { updateApplyPrefixes } from "./compose.js";
import type { UpdateApplyConstructionPortV1, UpdateApplyPortsV1 } from "./apply.js";
import type { CliUpdateContext } from "./context.js";
import { prepareUpdate, UpdatePlanningRefusal } from "./planning.js";
import type { PreparedUpdateApplyV1, UpdateHomeV1 } from "./planning.js";
import { createUpdateFixture, PLANNED_AT, sha256, SYNTHETIC_HOME, syntheticUpdateCoordinator } from "./testing.js";

class Killed extends Error {}

const synthetic = syntheticUpdateCoordinator(SYNTHETIC_HOME);
const COORDINATOR = synthetic.plan.id;

/** The durable world the fake ports mutate: what survives a simulated process death. */
interface ApplyWorldV1 {
  active: "current" | "target";
  trust: "held" | "advanced";
  construction: "absent" | "published" | "directories" | "files" | "handed_off";
  coordinator: { readonly plan: UpdateLifecycleCoordinatorPlanV2; readonly journal: UpdateLifecycleCoordinatorJournalV2 } | null;
  executor: "absent" | "executing" | "terminal_cleanup";
  allocatorReservations: number;
  allocatedPrefixes: readonly LifecycleIdPrefixV1[] | null;
  frames: number;
  retired: number;
  applied: UpdateLifecycleCoordinatorStepV1[];
  locked: boolean;
  dead: boolean;
  killed: boolean;
}

interface ApplyFixtureOptions {
  readonly verifier?: "pass" | "fail";
  readonly kill?: string;
  readonly thirdStateAt?: UpdateLifecycleCoordinatorStepV1["kind"];
  readonly overflow?: boolean;
  readonly home?: (home: UpdateHomeV1) => UpdateHomeV1;
  readonly secondPlanner?: CliUpdateContext["planner"];
  /** Closure V2 reports a third state (an orphan executor record, malformed V2 residue). */
  readonly thirdStateClosure?: boolean;
  /** Production's allocation with no launcher fallback handoff (D72 P7(d)). */
  readonly fallbackUnavailable?: boolean;
}

interface ApplyFixture {
  readonly update: CliUpdateContext;
  readonly prepared: PreparedUpdateApplyV1;
  readonly world: ApplyWorldV1;
  readonly events: string[];
  readonly previous: ReleaseIdentityV1;
  readonly target: ReleaseIdentityV1;
  readonly allocatorReservations: number;
  /** Transport requests made after the preview; revalidation must make none. */
  requestsAfterPreview(): readonly string[];
  activeIdentity(): Promise<ReleaseIdentityV1>;
  runAnyCommandToRecover(): Promise<void>;
  assertValidTerminalGeneration(): Promise<boolean>;
}

function boundaryName(boundary: UpdateCoordinatorBoundaryV1): string | null {
  if (boundary.kind === "journal_rewritten") return null;
  if (boundary.kind === "step_returned") return `step:${String(boundary.step)}:${boundary.direction}`;
  return boundary.kind;
}

function capacity(overflow: boolean): UpdateCapacityInputV1 {
  return {
    operation: "update",
    components: [{ kind: "journals", bytes: parseUInt64Decimal("1048576"), entries: parseUInt64Decimal("1") }],
    reservationGranularityBytes: parseUInt64Decimal("4096"),
    availableBytes: parseUInt64Decimal(overflow ? "1" : "1099511627776"),
    availableEntries: parseUInt64Decimal("10000000"),
  };
}

async function applyFixture(options: ApplyFixtureOptions = {}): Promise<ApplyFixture> {
  const base = createUpdateFixture();
  const world: ApplyWorldV1 = {
    active: "current",
    trust: "held",
    construction: "absent",
    coordinator: null,
    executor: "absent",
    allocatorReservations: 0,
    allocatedPrefixes: null,
    frames: 0,
    retired: 0,
    applied: [],
    locked: false,
    dead: false,
    killed: false,
  };
  const alive = (): void => {
    if (world.dead) throw new Killed("the process is dead");
  };
  /** Each durable effect is followed by its death point; the process dies there once. */
  const reached = (name: string): void => {
    base.events.push(name);
    if (name === options.kill && !world.killed) {
      world.killed = true;
      world.dead = true;
      throw new Killed(name);
    }
  };

  const participants: UpdateCoordinatorParticipantsV1 = {
    apply: (step) => {
      alive();
      if (step.kind === options.thirdStateAt) return Promise.reject(new LifecycleRecoveryRequiredError("update_state_third", []));
      world.applied.push(step);
      if (step.kind === "trust") world.trust = "advanced";
      if (step.kind === "active") world.active = "target";
      if (step.kind === "target_verifier") {
        if (options.verifier === "fail") return Promise.reject(new UpdatePlanningRefusal("update_verifier_rejected", EXIT_CODES.securityRefusal));
        return Promise.resolve({ state: "verified" });
      }
      return Promise.resolve({ state: "applied" });
    },
    observe: () => Promise.resolve({ state: "applied" }),
    compensate: (step): Promise<UpdateParticipantObservationV1> => {
      alive();
      if (step.kind === "active") world.active = "current";
      return Promise.resolve({ state: "compensated" });
    },
    compact: (entry) => {
      alive();
      if (entry.kind === "coordinator_staging") world.construction = "absent";
      return Promise.resolve();
    },
    retirementLeaves: () => Promise.resolve(2),
    retireLeaf: () => {
      alive();
      world.retired += 1;
      return Promise.resolve();
    },
  };

  const coordinator = (): UpdateLifecycleCoordinatorDependenciesV1 => ({
    store: {
      read: () => {
        alive();
        return world.coordinator === null ? Promise.reject(new LifecycleRecoveryRequiredError("update_coordinator_absent", [])) : Promise.resolve(world.coordinator);
      },
      rewrite: (plan, current, next) => {
        alive();
        if (world.coordinator?.journal !== current) return Promise.reject(new LifecycleRecoveryRequiredError("update_coordinator_journal_stale", []));
        world.coordinator = { plan, journal: next };
        return Promise.resolve();
      },
      removeEnvelope: () => {
        alive();
        world.coordinator = null;
        return Promise.resolve();
      },
      removeRewriteTemps: () => Promise.resolve(),
    },
    participants,
    executor: {
      publishInitial: () => {
        alive();
        world.executor = "executing";
        return Promise.resolve();
      },
      switchToFallback: () => {
        alive();
        world.executor = "terminal_cleanup";
        return Promise.resolve();
      },
      removeRecord: () => {
        alive();
        world.executor = "absent";
        return Promise.resolve();
      },
    },
    verifyPlan: (plan) => {
      assertUpdateCoordinatorDerivation(plan, synthetic.execution, synthetic.owners);
      return Promise.resolve();
    },
    requireLock: () => {
      alive();
      return world.locked ? Promise.resolve() : Promise.reject(new LifecycleRecoveryRequiredError("update_lock_not_held", []));
    },
    clock: () => PLANNED_AT,
    afterBoundary: (boundary) => {
      const name = boundaryName(boundary);
      if (name !== null) reached(name);
    },
  });

  const construction = (): UpdateApplyConstructionPortV1 => ({
    publish: () => {
      alive();
      world.construction = "published";
      reached("construction_published");
      return Promise.resolve({} as UpdateConstructionJournalV1);
    },
    stageDirectories: () => {
      alive();
      world.construction = "directories";
      reached("construction_directories");
      return Promise.resolve();
    },
    stageFiles: async (_plan, frames) => {
      alive();
      for await (const frame of frames) if (frame.sha256.length > 0) world.frames += 1;
      world.construction = "files";
      reached("construction_files");
    },
    publishOuter: () => {
      alive();
      world.construction = "handed_off";
      world.coordinator = { plan: synthetic.plan, journal: initialUpdateCoordinatorJournal(synthetic.plan, PLANNED_AT) };
      reached("construction_handed_off");
      return Promise.resolve();
    },
    recover: () => {
      alive();
      base.events.push("construction.compensated");
      world.construction = "absent";
      return Promise.resolve();
    },
  });

  const closure = (): Promise<LifecycleJournalClosureV2> => {
    alive();
    if (options.thirdStateClosure === true) return Promise.resolve({ kind: "lifecycle_recovery_required" });
    if (world.coordinator !== null) {
      return Promise.resolve({ kind: "update_recovery", coordinatorId: COORDINATOR, operation: "update_apply", direction: world.coordinator.journal.direction });
    }
    if (world.construction !== "absent") {
      return Promise.resolve({ kind: "update_construction_cleanup", coordinatorId: COORDINATOR, direction: "compensating", construction: { frontier: "journal", operation: "update_apply", constructionPlanHash: sha256("construction") } });
    }
    if (world.executor === "terminal_cleanup") return Promise.resolve({ kind: "update_executor_cleanup", coordinatorId: COORDINATOR });
    return Promise.resolve({ kind: "clear" });
  };

  const apply: UpdateApplyPortsV1 = {
    withGlobalLock: async (work) => {
      alive();
      world.locked = true;
      try {
        return await work();
      } finally {
        world.locked = false;
      }
    },
    closure,
    allocate: (prefixes) => {
      alive();
      if (options.fallbackUnavailable === true) return Promise.reject(new UpdatePlanningRefusal("update_fallback_unavailable", EXIT_CODES.capabilityUnavailable));
      world.allocatorReservations += 1;
      world.allocatedPrefixes = prefixes;
      base.events.push("allocate");
      return Promise.resolve(COORDINATOR);
    },
    compose: ({ coordinatorId }) => {
      base.events.push("compose");
      return Promise.resolve({
        construction: { coordinatorId, operation: "update_apply" } as UpdateConstructionPlanV1,
        outer: updateCoordinatorOuterBytes(synthetic.plan, PLANNED_AT),
        capacity: capacity(options.overflow === true),
      });
    },
    construction,
    coordinator,
    envelope: { isEnvelopeSuffix: () => Promise.resolve(false), completeEnvelopeSuffix: () => Promise.reject(new Error("unreachable")) },
    executorCleanup: () => {
      alive();
      world.executor = "absent";
      return Promise.resolve();
    },
  };

  const planning: CliUpdateContext = { ...base.update, apply };
  const planned = await prepareUpdate(planning, { version: null });
  if (planned.apply === null) throw new Error("expected a preview to apply");
  const prepared = planned.apply;
  const previewRequests = base.requests.length;
  const underLock: CliUpdateContext = {
    ...planning,
    readHome: () => Promise.resolve(options.home === undefined ? base.home : options.home(base.home)),
    planner: options.secondPlanner ?? planning.planner,
  };
  return {
    update: underLock,
    prepared,
    world,
    events: base.events,
    previous: prepared.inputs.current,
    target: prepared.inputs.target,
    get allocatorReservations() {
      return world.allocatorReservations;
    },
    requestsAfterPreview: () => base.requests.slice(previewRequests),
    activeIdentity: () => Promise.resolve(world.active === "target" ? prepared.inputs.target : prepared.inputs.current),
    runAnyCommandToRecover: async () => {
      world.dead = false;
      await recoverUpdate(underLock);
    },
    assertValidTerminalGeneration: () => Promise.resolve(
      !world.dead && !world.locked && world.coordinator === null && world.construction === "absent" && world.executor === "absent" &&
      (world.active === "current" || world.trust === "advanced"),
    ),
  };
}

async function interruptUpdateApply(point: { readonly name: string }): Promise<ApplyFixture> {
  const fixture = await applyFixture({ kill: point.name });
  await expect(applyUpdate(fixture.update, fixture.prepared)).rejects.toBeInstanceOf(Killed);
  return fixture;
}

/** Every durable boundary a clean apply crosses exactly once, construction first. */
const updateApplyDeathPoints: readonly { readonly name: string }[] = [
  "construction_published",
  "construction_directories",
  "construction_files",
  "construction_handed_off",
  "executor_published",
  ...synthetic.plan.steps.map((_step, index) => `step:${String(index)}:forward`),
  "executor_switched",
  "envelope_removed",
  "executor_removed",
].map((name) => ({ name }));

async function refusalOf(work: Promise<unknown>): Promise<UpdatePlanningRefusal> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("applyUpdate allocation (D72 P7(d)-(e))", () => {
  it("reserves one block holding exactly the prefixes the composition consumes, coordinator first", async () => {
    const fixture = await applyFixture();
    await applyUpdate(fixture.update, fixture.prepared);
    expect(fixture.world.allocatedPrefixes).toEqual(updateApplyPrefixes(fixture.prepared.materialized));
    expect(fixture.world.allocatedPrefixes?.[0]).toBe("lc");
    expect(fixture.allocatorReservations).toBe(1);
  });

  it("refuses exit 4 with no fallback handoff before composing or constructing anything", async () => {
    const fixture = await applyFixture({ fallbackUnavailable: true });
    const refusal = await refusalOf(applyUpdate(fixture.update, fixture.prepared));
    expect(refusal).toMatchObject({ reason: "update_fallback_unavailable", code: EXIT_CODES.capabilityUnavailable });
    expect(fixture.events).not.toContain("compose");
    expect(fixture.world.construction).toBe("absent");
    expect(fixture.world.coordinator).toBeNull();
    expect(fixture.events).toContain("scratch.cleanup");
  });
});

describe("applyUpdate revalidation", () => {
  it("reruns the planner under lock and refuses any transcript/preview change before allocation", async () => {
    const changedSecondPlannerRun = await applyFixture({ secondPlanner: createUpdateFixture({ reversedOperations: true }).update.planner });
    await expect(applyUpdate(changedSecondPlannerRun.update, changedSecondPlannerRun.prepared)).rejects.toThrow();
    expect(changedSecondPlannerRun.allocatorReservations).toBe(0);
    expect(changedSecondPlannerRun.world.construction).toBe("absent");
  });

  it("reruns the planner exactly once more, under the lock, over the same verified scratch", async () => {
    const fixture = await applyFixture();
    const before = fixture.events.filter((event) => event === "planner").length;
    await applyUpdate(fixture.update, fixture.prepared);
    expect(fixture.events.filter((event) => event === "planner").length).toBe(before + 1);
    expect(fixture.events.indexOf("allocate")).toBeGreaterThan(fixture.events.lastIndexOf("planner"));
    expect(fixture.requestsAfterPreview()).toStrictEqual([]);
  });

  it("refuses a guarded home that changed since the preview before any reservation", async () => {
    const fixture = await applyFixture({ home: (home) => ({ ...home, active: { ...home.active, activatedAt: parseUtcTimestamp("2026-09-24T00:00:00.000Z") } }) });
    const refusal = await refusalOf(applyUpdate(fixture.update, fixture.prepared));
    expect(refusal.reason).toBe("update_state_changed");
    expect(refusal.code).toBe(EXIT_CODES.operationalFailure);
    expect(fixture.allocatorReservations).toBe(0);
  });

  it("refuses a closure V2 third state under the lock before any reservation", async () => {
    const fixture = await applyFixture({ thirdStateClosure: true });
    const refusal = await refusalOf(applyUpdate(fixture.update, fixture.prepared));
    expect(refusal.reason).toBe("update_ledger_not_clear");
    expect(refusal.code).toBe(EXIT_CODES.recoveryRequired);
    expect(fixture.allocatorReservations).toBe(0);
    expect(fixture.world.construction).toBe("absent");
  });

  it("consumes only an allocator gap when the exact post-allocation projection overflows", async () => {
    const fixture = await applyFixture({ overflow: true });
    const refusal = await refusalOf(applyUpdate(fixture.update, fixture.prepared));
    expect(refusal.reason).toBe("update_capacity_insufficient_bytes");
    expect(fixture.allocatorReservations).toBe(1);
    expect(fixture.world.construction).toBe("absent");
    expect(fixture.events).not.toContain("construction_published");
    expect(fixture.events).toContain("scratch.cleanup");
  });
});

describe("applyUpdate forward execution", () => {
  it("hands construction off to the coordinator and applies every derived step in order", async () => {
    const fixture = await applyFixture();
    const result = await applyUpdate(fixture.update, fixture.prepared);

    expect(result).toStrictEqual({ schemaVersion: 1, outcome: "applied", active: fixture.target, rollbackAvailable: true });
    expect(fixture.world.applied).toStrictEqual(synthetic.plan.steps.filter((step) => step.kind !== "recovery_executor" && step.kind !== "terminal_retire"));
    expect(fixture.world.retired).toBe(2);
    expect(fixture.world.frames).toBe(fixture.prepared.materialized.run.outputBlobs.length);
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
    expect(await fixture.activeIdentity()).toEqual(fixture.target);
  });

  it("removes the scratch attempt once, after the sources are durable and before outer intent", async () => {
    const fixture = await applyFixture();
    await applyUpdate(fixture.update, fixture.prepared);
    const cleanup = fixture.events.indexOf("scratch.cleanup");
    expect(fixture.events.filter((event) => event === "scratch.cleanup")).toHaveLength(1);
    expect(cleanup).toBeGreaterThan(fixture.events.indexOf("construction_files"));
    expect(cleanup).toBeLessThan(fixture.events.indexOf("construction_handed_off"));
  });

  it("crosses the point of no return only at the verifier and then force-forwards retirement", async () => {
    const fixture = await applyFixture({ kill: "executor_switched" });
    await expect(applyUpdate(fixture.update, fixture.prepared)).rejects.toBeInstanceOf(Killed);
    expect(fixture.world.coordinator?.journal.pointOfNoReturnReached).toBe(true);
    await fixture.runAnyCommandToRecover();
    expect(await fixture.activeIdentity()).toEqual(fixture.target);
    expect(fixture.world.retired).toBe(2);
  });
});

describe("applyUpdate automatic rollback", () => {
  it("restores the old release when target verification fails", async () => {
    const failingVerifierFixture = await applyFixture({ verifier: "fail" });
    const previous = failingVerifierFixture.previous;
    const result = await applyUpdate(failingVerifierFixture.update, failingVerifierFixture.prepared);
    expect(result.outcome).toBe("rolled_back_automatically");
    expect(await failingVerifierFixture.activeIdentity()).toEqual(previous);
  });

  it("keeps the advanced trust high watermark after compensation and retires nothing", async () => {
    const fixture = await applyFixture({ verifier: "fail" });
    const result = await applyUpdate(fixture.update, fixture.prepared);
    if (result.outcome !== "rolled_back_automatically") throw new Error("expected an automatic rollback");
    expect(result.cause).toBe("update_verifier_rejected");
    expect(fixture.world.trust).toBe("advanced");
    expect(fixture.world.retired).toBe(0);
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
  });

  it("preserves a third state as recovery-required instead of compensating it", async () => {
    const fixture = await applyFixture({ thirdStateAt: "target_verifier" });
    await expect(applyUpdate(fixture.update, fixture.prepared)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(fixture.world.coordinator?.journal.direction).toBe("forward");
    expect(fixture.world.active).toBe("target");
  });
});

describe("applyUpdate death and recovery", () => {
  it.each(updateApplyDeathPoints)("recovers apply death at $name", async (point) => {
    const fixture = await interruptUpdateApply(point);
    await fixture.runAnyCommandToRecover();
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
  });

  it("compensates a construction that died before handoff back to the old release", async () => {
    const fixture = await interruptUpdateApply({ name: "construction_files" });
    await fixture.runAnyCommandToRecover();
    expect(fixture.events).toContain("construction.compensated");
    expect(await fixture.activeIdentity()).toEqual(fixture.previous);
    expect(fixture.world.trust).toBe("held");
  });

  it("resumes a handed-off coordinator forward rather than choosing rollback", async () => {
    const fixture = await interruptUpdateApply({ name: "construction_handed_off" });
    await fixture.runAnyCommandToRecover();
    expect(fixture.events).not.toContain("construction.compensated");
    expect(await fixture.activeIdentity()).toEqual(fixture.target);
  });

  it("refuses without apply ports before any port is reached", async () => {
    const fixture = await applyFixture();
    const refusal = await refusalOf(applyUpdate(createUpdateFixture().update, fixture.prepared));
    expect(refusal.reason).toBe("update_apply_unavailable");
    expect(refusal.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(fixture.allocatorReservations).toBe(0);
  });
});
