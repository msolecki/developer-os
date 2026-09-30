import {
  assertUpdateCoordinatorDerivation,
  encodeCanonicalJson,
  EXIT_CODES,
  initialUpdateCoordinatorJournal,
  LifecycleRecoveryRequiredError,
  parseUInt64Decimal,
  updateCoordinatorOuterBytes,
} from "@developer-os/core";
import type {
  LifecycleJournalClosureV2,
  ReleaseIdentityV1,
  RollbackPayloadIdV1,
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
  UpdateRollbackPreviewV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { recoverUpdate } from "./apply.js";
import type { UpdateApplyConstructionPortV1, UpdateApplyPortsV1 } from "./apply.js";
import type { CliUpdateContext } from "./context.js";
import { planRollback, UpdatePlanningRefusal } from "./planning.js";
import type { UpdateHomeV1 } from "./planning.js";
import { applyRollback } from "./rollback-apply.js";
import { createUpdateFixture, FILE_A_PATH, FILE_B_PATH, PLANNED_AT, sha256, SYNTHETIC_HOME, syntheticUpdateCoordinator } from "./testing.js";

class Killed extends Error {}

const synthetic = syntheticUpdateCoordinator(SYNTHETIC_HOME, "update_rollback");
const COORDINATOR = synthetic.plan.id;
const RETIREMENT_LEAVES = 3;
const VERIFIER_STEP = synthetic.plan.steps.findIndex((step) => step.kind === "target_verifier");

/** The durable world the fake ports mutate: what survives a simulated process death. */
interface RollbackWorldV1 {
  active: "current" | "previous";
  trustWrites: number;
  construction: "absent" | "published" | "directories" | "files" | "handed_off";
  coordinator: { readonly plan: UpdateLifecycleCoordinatorPlanV2; readonly journal: UpdateLifecycleCoordinatorJournalV2 } | null;
  executor: "absent" | "executing" | "terminal_cleanup";
  allocatorReservations: number;
  frames: number;
  consumed: number[];
  applied: UpdateLifecycleCoordinatorStepV1[];
  locked: boolean;
  dead: boolean;
  killed: boolean;
}

interface RollbackFixtureOptions {
  readonly verifier?: "pass" | "fail";
  readonly kill?: string;
  readonly thirdStateAt?: UpdateLifecycleCoordinatorStepV1["kind"];
  readonly overflow?: boolean;
  readonly residue?: boolean;
  readonly composedOperation?: UpdateConstructionPlanV1["operation"];
  readonly home?: (home: UpdateHomeV1) => UpdateHomeV1;
  /** A post-preview edit or drift the under-lock evidence read reports. */
  readonly edit?: UpdatePlanningRefusal;
}

interface RollbackFixture {
  readonly update: CliUpdateContext;
  readonly preview: UpdateRollbackPreviewV1;
  readonly world: RollbackWorldV1;
  readonly events: string[];
  readonly requests: string[];
  readonly allocatorReservations: number;
  identity(which: "current" | "previous"): ReleaseIdentityV1;
  activeIdentity(): Promise<ReleaseIdentityV1>;
  recoverWithoutNetwork(): Promise<void>;
  assertValidTerminalGeneration(): Promise<boolean>;
}

function boundaryName(boundary: UpdateCoordinatorBoundaryV1): string | null {
  if (boundary.kind === "journal_rewritten") return null;
  if (boundary.kind === "step_returned") return `step:${String(boundary.step)}:${boundary.direction}`;
  return boundary.kind;
}

/** The composer's exact components; availability is zero, so only the caller's under-lock observation can admit it. */
function capacity(overflow: boolean): UpdateCapacityInputV1 {
  return {
    operation: "rollback",
    components: [{ kind: "journals", bytes: parseUInt64Decimal(overflow ? "2199023255552" : "1048576"), entries: parseUInt64Decimal("1") }],
    reservationGranularityBytes: parseUInt64Decimal("1"),
    availableBytes: parseUInt64Decimal("0"),
    availableEntries: parseUInt64Decimal("0"),
  };
}

async function rollbackFixture(options: RollbackFixtureOptions = {}): Promise<RollbackFixture> {
  const base = createUpdateFixture({ active: "1.1.0", rollbackPrevious: "1.0.0" });
  const world: RollbackWorldV1 = {
    active: "current",
    trustWrites: 0,
    construction: options.residue === true ? "published" : "absent",
    coordinator: null,
    executor: "absent",
    allocatorReservations: 0,
    frames: 0,
    consumed: [],
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
      base.events.push(`apply:${encodeCanonicalJson(step)}`);
      if (step.kind === "trust") world.trustWrites += 1;
      if (step.kind === "active") world.active = "previous";
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
    retirementLeaves: () => Promise.resolve(RETIREMENT_LEAVES),
    retireLeaf: (_step, ordinal) => {
      alive();
      world.consumed.push(ordinal);
      base.events.push(`retire:${String(ordinal)}`);
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
    if (world.coordinator !== null) {
      return Promise.resolve({ kind: "update_recovery", coordinatorId: COORDINATOR, operation: "update_rollback", direction: world.coordinator.journal.direction });
    }
    if (world.construction !== "absent") {
      return Promise.resolve({ kind: "update_construction_cleanup", coordinatorId: COORDINATOR, direction: "compensating", construction: { frontier: "journal", operation: "update_rollback", constructionPlanHash: sha256("construction") } });
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
    allocate: () => {
      alive();
      world.allocatorReservations += 1;
      base.events.push("allocate");
      return Promise.resolve(COORDINATOR);
    },
    compose: () => Promise.reject(new Error("rollback reached the update derivation")),
    composeRollback: ({ coordinatorId }) => {
      base.events.push("compose");
      return Promise.resolve({
        construction: { coordinatorId, operation: options.composedOperation ?? "update_rollback", rollbackSource: null, outputFrames: [] } as unknown as UpdateConstructionPlanV1,
        outer: updateCoordinatorOuterBytes(synthetic.plan, PLANNED_AT),
        capacity: capacity(options.overflow === true),
      });
    },
    construction,
    coordinator,
    envelope: { isEnvelopeSuffix: () => Promise.resolve(false), completeEnvelopeSuffix: () => Promise.resolve() },
    executorCleanup: () => {
      alive();
      world.executor = "absent";
      return Promise.resolve();
    },
  };

  const planning: CliUpdateContext = { ...base.update, apply };
  const preview = await planRollback(planning);
  const edit = options.edit;
  const underLock: CliUpdateContext = {
    ...planning,
    readHome: () => Promise.resolve(options.home === undefined ? base.home : options.home(base.home)),
    readRollbackEvidence: edit === undefined ? planning.readRollbackEvidence : () => Promise.reject(edit),
  };
  const identity = (which: "current" | "previous"): ReleaseIdentityV1 => (which === "previous" ? preview.target : preview.current);
  return {
    update: underLock,
    preview,
    world,
    events: base.events,
    requests: base.requests,
    get allocatorReservations() {
      return world.allocatorReservations;
    },
    identity,
    activeIdentity: () => Promise.resolve(identity(world.active)),
    recoverWithoutNetwork: async () => {
      world.dead = false;
      await recoverUpdate(underLock);
    },
    assertValidTerminalGeneration: () => Promise.resolve(
      !world.dead && !world.locked && world.coordinator === null && world.construction === "absent" && world.executor === "absent" && world.trustWrites === 0,
    ),
  };
}

async function interruptRollback(point: { readonly name: string }): Promise<RollbackFixture> {
  const fixture = await rollbackFixture({ kill: point.name });
  await expect(applyRollback(fixture.update, fixture.preview)).rejects.toBeInstanceOf(Killed);
  return fixture;
}

/**
 * Every durable boundary a clean rollback crosses exactly once. Construction death compensates
 * to the rejected current release; after handoff recovery only resumes the journal forward.
 */
const rollbackApplyDeathPoints: readonly { readonly name: string; readonly expectedActive: "current" | "previous" }[] = [
  ...["construction_published", "construction_directories", "construction_files"].map((name) => ({ name, expectedActive: "current" as const })),
  ...[
    "construction_handed_off",
    "executor_published",
    ...synthetic.plan.steps.map((_step, index) => `step:${String(index)}:forward`),
    "executor_switched",
    "envelope_removed",
    "executor_removed",
  ].map((name) => ({ name, expectedActive: "previous" as const })),
];

const postUpdateEdits: readonly { readonly name: string; readonly refusal: UpdatePlanningRefusal }[] = [
  { name: "an edited managed owner file", refusal: new UpdatePlanningRefusal("update_rollback_post_update_edit", EXIT_CODES.decisionRequired, [FILE_A_PATH]) },
  { name: "a removed managed owner file", refusal: new UpdatePlanningRefusal("update_rollback_post_update_edit", EXIT_CODES.decisionRequired, [FILE_B_PATH]) },
  { name: "a drifted migrated Brain path", refusal: new UpdatePlanningRefusal("update_rollback_migration_postimage_changed", EXIT_CODES.decisionRequired, [FILE_A_PATH]) },
  { name: "a changed Codex registration", refusal: new UpdatePlanningRefusal("update_rollback_external_effect_changed", EXIT_CODES.decisionRequired) },
];

async function refusalOf(work: Promise<unknown>): Promise<UpdatePlanningRefusal> {
  try {
    await work;
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function stepIndex(events: readonly string[], step: UpdateLifecycleCoordinatorStepV1): number {
  const index = events.indexOf(`apply:${encodeCanonicalJson(step)}`);
  expect(index).toBeGreaterThan(-1);
  return index;
}

describe("applyRollback revalidation", () => {
  it.each(postUpdateEdits)("refuses $name before allocation", async (edit) => {
    const fixture = await rollbackFixture({ edit: edit.refusal });
    await expect(applyRollback(fixture.update, fixture.preview)).rejects.toMatchObject({ code: EXIT_CODES.decisionRequired });
    expect(fixture.allocatorReservations).toBe(0);
    expect(fixture.world.construction).toBe("absent");
  });

  it("refuses retained evidence that changed since the preview before any reservation", async () => {
    const other = `rb_${sha256("other synthetic nonce")}_7` as RollbackPayloadIdV1;
    const fixture = await rollbackFixture({ home: (home) => (home.rollback === null ? home : { ...home, rollback: { ...home.rollback, payloadId: other } }) });
    const refusal = await refusalOf(applyRollback(fixture.update, fixture.preview));
    expect(refusal.reason).toBe("update_plan_changed");
    expect(refusal.code).toBe(EXIT_CODES.operationalFailure);
    expect(fixture.allocatorReservations).toBe(0);
  });

  it("refuses a ledger that is not clear under the lock", async () => {
    const fixture = await rollbackFixture({ residue: true });
    const refusal = await refusalOf(applyRollback(fixture.update, fixture.preview));
    expect(refusal.reason).toBe("update_ledger_not_clear");
    expect(refusal.code).toBe(EXIT_CODES.recoveryRequired);
    expect(fixture.allocatorReservations).toBe(0);
  });

  it("reads only local evidence: no transport, trust handoff, scratch, or planner", async () => {
    const fixture = await rollbackFixture();
    await applyRollback(fixture.update, fixture.preview);
    expect(fixture.requests).toStrictEqual([]);
    expect(fixture.events.filter((event) => event === "planner" || event === "trust" || event === "transport" || event.startsWith("scratch."))).toStrictEqual([]);
    expect(fixture.world.frames).toBe(0);
  });

  it("consumes only an allocator gap when the exact post-allocation projection overflows", async () => {
    const fixture = await rollbackFixture({ overflow: true });
    const refusal = await refusalOf(applyRollback(fixture.update, fixture.preview));
    expect(refusal.reason).toBe("update_capacity_insufficient_bytes");
    expect(fixture.allocatorReservations).toBe(1);
    expect(fixture.world.construction).toBe("absent");
  });

  it("refuses a composition for another operation before staging", async () => {
    const fixture = await rollbackFixture({ composedOperation: "update_apply" });
    const refusal = await refusalOf(applyRollback(fixture.update, fixture.preview));
    expect(refusal.reason).toBe("update_composition_identity");
    expect(fixture.world.construction).toBe("absent");
  });

  it("refuses without a rollback derivation before any port is reached", async () => {
    const fixture = await rollbackFixture();
    const apply = fixture.update.apply;
    if (apply === undefined) throw new Error("expected apply ports");
    const withoutRollback: UpdateApplyPortsV1 = { ...apply };
    delete (withoutRollback as { composeRollback?: unknown }).composeRollback;
    const refusal = await refusalOf(applyRollback({ ...fixture.update, apply: withoutRollback }, fixture.preview));
    expect(refusal.reason).toBe("update_apply_unavailable");
    expect(refusal.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(fixture.allocatorReservations).toBe(0);
  });
});

describe("applyRollback execution", () => {
  it("runs the exact rollback steps and returns the previous release with no rollback left", async () => {
    const fixture = await rollbackFixture();
    const result = await applyRollback(fixture.update, fixture.preview);

    expect(result).toStrictEqual({ schemaVersion: 1, outcome: "rolled_back", active: fixture.preview.target, rollbackAvailable: false });
    expect(fixture.world.applied).toStrictEqual(synthetic.plan.steps.filter((step) => step.kind !== "recovery_executor" && step.kind !== "terminal_retire"));
    expect(fixture.world.consumed).toStrictEqual([0, 1, 2]);
    expect(await fixture.activeIdentity()).toEqual(fixture.identity("previous"));
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
  });

  it("verifies the previous bundle, then the retained payload immediately before the record", () => {
    expect(synthetic.plan.steps.slice(0, 3)).toStrictEqual([
      { kind: "bundle", action: "verify_previous" },
      { kind: "rollback_payload", transition: "verify_retained" },
      { kind: "rollback_record", transition: "verify_retained" },
    ]);
  });

  it("reverses migrations, then effects, then owner files before the transitional manifest", () => {
    const kinds = synthetic.plan.steps.map((step) => step.kind);
    const lastMigration = kinds.lastIndexOf("schema_migration");
    expect(kinds.indexOf("owner_external_effect")).toBeGreaterThan(lastMigration);
    expect(kinds.indexOf("owner_files")).toBeGreaterThan(kinds.lastIndexOf("owner_external_effect"));
    expect(synthetic.plan.steps.filter((step) => step.kind === "schema_migration").map((step) => step.id)).toStrictEqual([...synthetic.execution.migrations.map((ref) => ref.id)].reverse());
    expect(synthetic.plan.steps.filter((step) => step.kind === "owner_files").map((step) => step.owner)).toStrictEqual(["codex", "core"]);
    expect(synthetic.plan.steps.slice(kinds.lastIndexOf("owner_files") + 1, kinds.lastIndexOf("owner_files") + 3)).toStrictEqual([
      { kind: "manifest", transition: "preserve_before" },
      { kind: "manifest", transition: "publish_transitional" },
    ]);
  });

  it("never writes trust: the rollback plan has no trust step and the high watermarks stay", async () => {
    const fixture = await rollbackFixture();
    await applyRollback(fixture.update, fixture.preview);
    expect(synthetic.plan.steps.some((step) => step.kind === "trust")).toBe(false);
    expect(synthetic.execution.trust).toBeNull();
    expect(fixture.world.trustWrites).toBe(0);
  });

  it("consumes the record, payload, and rejected bundle only after the previous verifier and fallback routing", async () => {
    const fixture = await rollbackFixture();
    await applyRollback(fixture.update, fixture.preview);
    const verifier = synthetic.plan.steps[VERIFIER_STEP] as UpdateLifecycleCoordinatorStepV1;
    const firstRetire = fixture.events.indexOf("retire:0");
    expect(stepIndex(fixture.events, verifier)).toBeGreaterThan(stepIndex(fixture.events, { kind: "active", transition: "publish_previous" }));
    expect(firstRetire).toBeGreaterThan(fixture.events.indexOf(`step:${String(VERIFIER_STEP)}:forward`));
    expect(firstRetire).toBeGreaterThan(fixture.events.indexOf("executor_switched"));
    expect(stepIndex(fixture.events, { kind: "manifest", transition: "publish_terminal" })).toBeGreaterThan(fixture.events.indexOf(`retire:${String(RETIREMENT_LEAVES - 1)}`));
    expect(stepIndex(fixture.events, { kind: "manifest", transition: "finalize_tombstones" })).toBeGreaterThan(stepIndex(fixture.events, { kind: "manifest", transition: "publish_terminal" }));
  });

  it("stages no source envelope and hands the construction to the coordinator after the reservation", async () => {
    const fixture = await rollbackFixture();
    await applyRollback(fixture.update, fixture.preview);
    const events = fixture.events;
    expect(events.indexOf("allocate")).toBeGreaterThan(events.lastIndexOf("rollback.evidence"));
    expect(events.indexOf("compose")).toBeGreaterThan(events.indexOf("allocate"));
    expect(events.indexOf("construction_handed_off")).toBeGreaterThan(events.indexOf("construction_files"));
    expect(events.indexOf("executor_published")).toBeGreaterThan(events.indexOf("construction_handed_off"));
    expect(fixture.world.frames).toBe(0);
  });

  it("crosses the point of no return only at the previous verifier and then force-forwards retirement", async () => {
    const fixture = await rollbackFixture({ kill: "executor_switched" });
    await expect(applyRollback(fixture.update, fixture.preview)).rejects.toBeInstanceOf(Killed);
    expect(fixture.world.coordinator?.journal.pointOfNoReturnReached).toBe(true);
    await fixture.recoverWithoutNetwork();
    expect(await fixture.activeIdentity()).toEqual(fixture.identity("previous"));
    expect(fixture.world.consumed).toStrictEqual([0, 1, 2]);
  });
});

describe("applyRollback compensation", () => {
  it("compensates to the rejected current release when the previous verifier fails", async () => {
    const fixture = await rollbackFixture({ verifier: "fail" });
    const result = await applyRollback(fixture.update, fixture.preview);

    expect(result).toStrictEqual({ schemaVersion: 1, outcome: "rollback_compensated", active: fixture.preview.current, cause: "update_verifier_rejected" });
    expect(await fixture.activeIdentity()).toEqual(fixture.identity("current"));
    expect(fixture.world.consumed).toStrictEqual([]);
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
  });

  it("preserves a third state as recovery-required instead of compensating it", async () => {
    const fixture = await rollbackFixture({ thirdStateAt: "owner_files" });
    await expect(applyRollback(fixture.update, fixture.preview)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(fixture.world.coordinator?.journal.direction).toBe("forward");
    expect(fixture.world.active).toBe("current");
    expect(fixture.world.consumed).toStrictEqual([]);
  });
});

describe("applyRollback death and recovery", () => {
  it.each(rollbackApplyDeathPoints)("recovers rollback death at $name", async (point) => {
    const fixture = await interruptRollback(point);
    const requests = fixture.requests.length;
    await fixture.recoverWithoutNetwork();
    expect(await fixture.activeIdentity()).toEqual(fixture.identity(point.expectedActive));
    expect(await fixture.assertValidTerminalGeneration()).toBe(true);
    expect(fixture.requests).toHaveLength(requests);
  });

  it("compensates a construction that died before handoff and keeps the retained rollback", async () => {
    const fixture = await interruptRollback({ name: "construction_directories" });
    await fixture.recoverWithoutNetwork();
    expect(fixture.events).toContain("construction.compensated");
    expect(fixture.world.consumed).toStrictEqual([]);
  });

  it("resumes a handed-off rollback forward rather than choosing compensation", async () => {
    const fixture = await interruptRollback({ name: "construction_handed_off" });
    await fixture.recoverWithoutNetwork();
    expect(fixture.events).not.toContain("construction.compensated");
    expect(fixture.world.consumed).toStrictEqual([0, 1, 2]);
  });
});
