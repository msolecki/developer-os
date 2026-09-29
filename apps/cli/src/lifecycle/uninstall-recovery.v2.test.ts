import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  LifecycleCoordinatorRecordV1,
  LifecycleCoordinatorStepV1,
  LifecycleCoordinatorStore,
  LifecycleTerminalOutcomeV1,
} from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import { runInit } from "../commands/init.js";
import { runRepair } from "../commands/repair.js";
import {
  createCommandFixture,
  exists,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture, FixtureOptions } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import type { CliContext } from "../context.js";
import { admitInstalledV2Home } from "./admission.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { coordinatorNonceOf, lifecycleHomeKeyFromAdmission, residueFrom } from "./context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "./context.js";
import {
  admitRecoveryOnlyUninstall,
  dispatchUninstall,
  selectUninstallCoordinator,
} from "./uninstall-recovery.js";
import {
  createUninstallAdapters,
  createUninstallParticipants,
  LifecycleUninstaller,
  releaseUninstallHolds,
} from "./uninstall.js";
import type {
  LifecycleUninstallRequestV1,
  UninstallBoundaryV1,
  UninstallHoldsV1,
} from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const PREVIEW = { dryRun: true, assumeYes: true } as const;

/**
 * The chained case measured 1080.9 s (2026-09-21) on the second of two green isolated runs,
 * whose whole-file figures were 1147.2 s and 1139.3 s. Only that run carried per-case timing,
 * so this is one observation where the rest of this job's figures are maxima of two or more;
 * it is scaled by the 0.7% whole-file spread to 1088.4 s rather than taken as measured, and
 * ceil(1088.4 x 2 x 1.5) leaves a hosted runner at ~2x unable to trip it. It cannot take
 * `REAL_FILESYSTEM_TIMEOUT_MS`: 1080.9 s doubled is more than twice that 900 s budget.
 */
const CHAIN_TIMEOUT_MS = 3_266_000;

const POINTS = [
  ["M(preserve_before) applied, cursor not advanced", "compensation"],
  ["M(commit_absence) durable", "force_forward"],
  ["M(finalize_tombstones) after one empty-directory removal", "force_forward"],
  ["coordinator_envelope after nonce removal", "force_forward"],
  ["plan plus lock", "envelope_suffix"],
  ["plan only", "envelope_suffix"],
] as const;

type KillPointV1 = (typeof POINTS)[number][0];

/**
 * The §2.1 microstate each kill point leaves on disk, asserted before the arm recovers. Every
 * leaf here is one a later step collects, so the table is the observable form of "present
 * exactly while the cursor precedes the step that removes it".
 */
const MICROSTATES: Readonly<
  Record<
    KillPointV1,
    {
      readonly manifestTombstone: boolean;
      readonly keyTombstone: boolean;
      readonly nonce: boolean;
      readonly allocator: boolean;
    }
  >
> = {
  "M(preserve_before) applied, cursor not advanced": {
    manifestTombstone: true,
    keyTombstone: true,
    nonce: true,
    allocator: true,
  },
  "M(commit_absence) durable": {
    manifestTombstone: true,
    keyTombstone: true,
    nonce: true,
    allocator: true,
  },
  "M(finalize_tombstones) after one empty-directory removal": {
    manifestTombstone: true,
    keyTombstone: false,
    nonce: true,
    allocator: true,
  },
  "coordinator_envelope after nonce removal": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
  },
  "plan plus lock": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
  },
  "plan only": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
  },
};

class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

afterAll(removeCommandFixtures);

interface V2FixtureV1 extends CommandFixture {
  readonly publishedPlans: readonly LifecycleExecutionPlanV1[];
}

function recordingStore(
  store: LifecycleCoordinatorStore<LifecycleExecutionPlanV1>,
  plans: LifecycleExecutionPlanV1[],
): LifecycleCoordinatorStore<LifecycleExecutionPlanV1> {
  return new Proxy(store, {
    get(target, property): unknown {
      if (property === "publish") {
        return async (plan: LifecycleExecutionPlanV1, global: HeldLifecycleStableLockV1) => {
          plans.push(plan);
          return target.publish(plan, global);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

/**
 * Duplicated from `apps/cli/src/lifecycle/uninstall.v2.test.ts` rather than shared: importing a
 * `.test.ts` re-collects its suites into this file, and every case there drives a real `init`.
 */
function instrument(context: CliContext, plans: LifecycleExecutionPlanV1[]): CliContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return {
    ...context,
    lifecycle: { ...lifecycle, store: (key) => recordingStore(lifecycle.store(key), plans) },
  };
}

async function initializedV2Fixture(
  name: string,
  options: FixtureOptions = {},
): Promise<V2FixtureV1> {
  const base = await createCommandFixture(name, { ...options, bootstrapAvailable: true });
  await nodeFs.mkdir(base.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(base.context, ACCEPTED);
  if (!initialized.ok) {
    throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  }
  const plans: LifecycleExecutionPlanV1[] = [];
  return {
    ...base,
    context: instrument(base.context, plans),
    rebuildContext: () => instrument(base.rebuildContext(), plans),
    get publishedPlans(): readonly LifecycleExecutionPlanV1[] {
      return plans;
    },
  };
}

function lifecycleOf(context: CliContext): CliLifecycleContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

function globalLockPath(fixture: CommandFixture): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock"));
}

function evidenceOf(fixture: CommandFixture): Promise<BootstrapEvidenceAdmissionV1> {
  return inspectBootstrapEvidenceAdmission(
    createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }),
  );
}

async function requestFor(fixture: V2FixtureV1): Promise<LifecycleUninstallRequestV1> {
  const context = fixture.rebuildContext();
  const lifecycle = lifecycleOf(context);
  const admitted = await admitInstalledV2Home({
    fs: lifecycle.fs,
    paths: context.paths,
    manifestAdmission: manifestAdmissionFor(context.paths, []),
    effectiveUid: lifecycle.effectiveUid,
  });
  return {
    context,
    lifecycle,
    key: lifecycleHomeKeyFromAdmission(admitted, context.paths),
    admitted,
    evidence: await evidenceOf(fixture),
    options: ACCEPTED,
  };
}

async function recoveryKeyOf(fixture: CommandFixture, context: CliContext): Promise<LifecycleHomeKeyV1> {
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const nonce = await coordinatorNonceOf(lifecycleOf(context).fs, productHome);
  if (nonce === null) throw new Error(`the ledger of ${fixture.paths.home} holds no lc_ leaf`);
  return { productHome, nonce };
}

function currentPlan(fixture: V2FixtureV1): LifecycleExecutionPlanV1 {
  const plan = fixture.publishedPlans.at(-1);
  if (plan === undefined) throw new Error("no uninstall plan has been published");
  return plan;
}

function manifestLeafOf(fixture: V2FixtureV1): {
  readonly tombstonePath: string;
  readonly keyTombstonePath: string;
} {
  const plan = currentPlan(fixture);
  const manifest = plan.participants.manifest;
  const key = plan.participants.redactionKey;
  if (manifest === null || key === null) throw new Error("the uninstall plan has no manifest arm");
  return { tombstonePath: manifest.tombstonePath, keyTombstonePath: key.tombstonePath };
}

type StepMatchV1 = (step: LifecycleCoordinatorStepV1 | undefined) => boolean;

function manifestStep(transition: string): StepMatchV1 {
  return (step) => step?.kind === "manifest" && step.transition === transition;
}

function stepOfKind(kind: LifecycleCoordinatorStepV1["kind"]): StepMatchV1 {
  return (step) => step?.kind === kind;
}

function dieAtStepReturn(
  match: StepMatchV1,
  planOf: () => LifecycleExecutionPlanV1,
): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== "participant_returned" || boundary.direction !== "forward") return;
    if (!match(planOf().steps[boundary.step])) return;
    fired = true;
    throw new SyntheticDeath(`step ${String(boundary.step)} applied`);
  };
}

/**
 * The journal rewrite that advances past a step is the durable record of that step, so a death
 * there is the one that leaves the step done and the cursor already past it.
 */
function dieAfterStepJournal(
  match: StepMatchV1,
  planOf: () => LifecycleExecutionPlanV1,
): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== "journal_rewritten") return;
    if (!match(planOf().steps[boundary.nextStep - 1])) return;
    fired = true;
    throw new SyntheticDeath(`step ${String(boundary.nextStep - 1)} durable`);
  };
}

function dieAtFirst(kind: UninstallBoundaryV1["kind"]): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== kind) return;
    fired = true;
    throw new SyntheticDeath(kind);
  };
}

async function died(
  fixture: V2FixtureV1,
  afterBoundary: (boundary: UninstallBoundaryV1) => void,
): Promise<void> {
  const uninstaller = new LifecycleUninstaller({ afterBoundary });
  await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);
}

/**
 * `CliLifecycleContext.recovery` binds no `afterBoundary`, so the compaction boundaries
 * `compactTerminalCoordinator` publishes are unreachable from a hook. The adapters it calls are
 * this caller's own, and `removeEnvelopeLeaves` takes the nonce through
 * `controlFiles.removeNonce`, which is the last reachable point inside the envelope entry.
 */
async function dieInsideEnvelopeCompaction(fixture: V2FixtureV1): Promise<void> {
  const context = fixture.rebuildContext();
  const lifecycle = lifecycleOf(context);
  const key = await recoveryKeyOf(fixture, context);
  const evidence = await evidenceOf(fixture);
  const request: LifecycleUninstallRequestV1 = {
    context,
    lifecycle,
    key,
    admitted: null,
    evidence,
    options: ACCEPTED,
  };
  const holds: UninstallHoldsV1 = {
    global: await lifecycle.locks.acquireExisting(globalLockPath(fixture)),
    leases: [],
  };
  try {
    const global = holds.global;
    if (global === null) throw new Error("unreachable");
    const adapters = createUninstallAdapters({
      request,
      ...createUninstallParticipants(request),
      holds,
    });
    const killing = {
      ...adapters,
      controlFiles: {
        removeAllocator: (plan: LifecycleExecutionPlanV1, outcome: LifecycleTerminalOutcomeV1) =>
          adapters.controlFiles.removeAllocator(plan, outcome),
        removeNonce: async (plan: LifecycleExecutionPlanV1, outcome: LifecycleTerminalOutcomeV1) => {
          await adapters.controlFiles.removeNonce(plan, outcome);
          throw new SyntheticDeath("coordinator_envelope after nonce removal");
        },
      },
    };
    await expect(
      lifecycle.recovery(key, killing, residueFrom(evidence)).recover(global, {
        resumeUninstall: true,
      }),
    ).rejects.toThrow(SyntheticDeath);
  } finally {
    await releaseUninstallHolds(holds);
  }
}

function envelopeLeafPath(fixture: V2FixtureV1, leaf: "journal" | "lock"): CanonicalAbsolutePathV1 {
  const id = currentPlan(fixture).id;
  const root = lifecycleOf(fixture.context).roots.coordinatorJournals;
  return parseCanonicalAbsolutePathText(
    join(root, leaf === "journal" ? `${id}.json` : `.${id}.lock`),
  );
}

/**
 * The command fixture composes `InProcessLockProvider`, which creates no file at all, so no
 * coordinator stable lock exists to distinguish §2.4's plan-plus-lock suffix from plan-only.
 * The leaf is planted in the exact shape the ledger admits — owner-only, zero-byte, one link —
 * which is what `MacOsTransactionLockProvider` leaves behind.
 */
async function materialiseEnvelopeLock(fixture: V2FixtureV1): Promise<void> {
  await nodeFs.writeFile(envelopeLeafPath(fixture, "lock"), "", { mode: 0o600 });
}

async function removeEnvelopeLeaf(fixture: V2FixtureV1, leaf: "journal" | "lock"): Promise<void> {
  const path = envelopeLeafPath(fixture, leaf);
  expect(await exists(path), `${leaf} of ${currentPlan(fixture).id}`).toBe(true);
  await nodeFs.unlink(path);
}

async function killUninstallAt(fixture: V2FixtureV1, point: KillPointV1): Promise<void> {
  const planOf = (): LifecycleExecutionPlanV1 => currentPlan(fixture);
  switch (point) {
    case "M(preserve_before) applied, cursor not advanced":
      await died(fixture, dieAtStepReturn(manifestStep("preserve_before"), planOf));
      return;
    case "M(commit_absence) durable":
      await died(fixture, dieAfterStepJournal(manifestStep("commit_absence"), planOf));
      return;
    case "M(finalize_tombstones) after one empty-directory removal":
      await died(fixture, dieAtFirst("empty_directory_removed"));
      return;
    default:
      await died(fixture, dieAfterStepJournal(manifestStep("finalize_tombstones"), planOf));
      await dieInsideEnvelopeCompaction(fixture);
      if (point === "plan plus lock" || point === "plan only") {
        await materialiseEnvelopeLock(fixture);
        await removeEnvelopeLeaf(fixture, "journal");
      }
      if (point === "plan only") await removeEnvelopeLeaf(fixture, "lock");
  }
}

async function observedMicrostate(
  fixture: V2FixtureV1,
): Promise<(typeof MICROSTATES)[KillPointV1]> {
  const leaves = manifestLeafOf(fixture);
  return {
    manifestTombstone: await exists(leaves.tombstonePath),
    keyTombstone: await exists(leaves.keyTombstonePath),
    nonce: await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce")),
    allocator: await exists(join(fixture.paths.stateDir, "lifecycle-id-allocator.json")),
  };
}

async function admissionRefusalOf(fixture: V2FixtureV1): Promise<unknown> {
  const context = fixture.rebuildContext();
  const lifecycle = lifecycleOf(context);
  const held = await lifecycle.locks.acquireExisting(globalLockPath(fixture));
  try {
    return await admitRecoveryOnlyUninstall(
      context,
      lifecycle,
      held,
      await evidenceOf(fixture),
    ).then(
      () => null,
      (error: unknown) => error,
    );
  } finally {
    await held.release();
  }
}

/** The tombstone is the preimage manifest, so copying it back is a genuine reappearance. */
async function refusesAReappearedManifest(fixture: V2FixtureV1): Promise<void> {
  const { tombstonePath } = manifestLeafOf(fixture);
  await nodeFs.copyFile(tombstonePath, fixture.paths.manifestFile);
  await nodeFs.chmod(fixture.paths.manifestFile, 0o600);

  expect(await admissionRefusalOf(fixture)).toMatchObject({ code: EXIT_CODES.recoveryRequired });

  expect(await exists(fixture.paths.manifestFile)).toBe(true);
  await nodeFs.unlink(fixture.paths.manifestFile);
}

async function refusesAnAllocatorWithoutItsNonce(fixture: V2FixtureV1): Promise<void> {
  const allocator = join(fixture.paths.stateDir, "lifecycle-id-allocator.json");
  await nodeFs.writeFile(allocator, "{}\n", { mode: 0o600 });

  expect(await admissionRefusalOf(fixture)).toMatchObject({ code: EXIT_CODES.recoveryRequired });

  await nodeFs.unlink(allocator);
}

describe("uninstall dispatch and the recovery-only arm", () => {
  it("admits the recovery-only arm at each kill point and resumes to an absent-manifest home", async () => {
    expect(POINTS.length).toBeGreaterThan(0);
    /**
     * One home for all six kill points, each cycle ending in the re-init the next one needs.
     * A9's round trip is therefore asserted six times over rather than once, and every arm's
     * residue is proven collected by the install that follows it. NEW-99 made exactly this
     * chain unreachable — each retained envelope reported the other's entries, so both dropped
     * out of `retainedEnvelopes` and the second `uninstall` refused exit 6 over Foundation
     * staging it could no longer attribute.
     */
    const fixture = await initializedV2Fixture("uninstall-recovery-chain");
    for (const [point, arm] of POINTS) {
      await killUninstallAt(fixture, point);
      const dispatched = fixture.rebuildContext();
      expect(
        await dispatchUninstall(dispatched, lifecycleOf(dispatched)),
        point,
      ).toMatchObject({ kind: "recovery_only", arm });
      expect(await observedMicrostate(fixture), point).toStrictEqual(MICROSTATES[point]);
      expect(await exists(fixture.paths.manifestFile), point).toBe(false);
      if (point === "M(commit_absence) durable") await refusesAReappearedManifest(fixture);
      if (point === "coordinator_envelope after nonce removal") {
        await refusesAnAllocatorWithoutItsNonce(fixture);
      }

      const previewed = await runUninstall(fixture.rebuildContext(), PREVIEW);
      expect(previewed.ok, `${point} dry run`).toBe(true);
      expect(await observedMicrostate(fixture), `${point} dry run`).toStrictEqual(
        MICROSTATES[point],
      );

      expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, point).toBe(true);
      if (arm === "compensation") {
        expect(
          (await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok,
          `${point} then uninstall`,
        ).toBe(true);
      }
      const settled = fixture.rebuildContext();
      expect(await dispatchUninstall(settled, lifecycleOf(settled)), point).toStrictEqual({
        kind: "absent_manifest",
      });
      expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok, `init after ${point}`).toBe(
        true,
      );
    }
  }, CHAIN_TIMEOUT_MS);

  it("dispatches one V2 home through its refusals, its preview and its absent-manifest arm", async () => {
    const fixture = await initializedV2Fixture("uninstall-dispatch-order", {
      interruptAfter: "applied",
      interruptKind: "capture",
    });
    const opening = fixture.rebuildContext();
    expect(await dispatchUninstall(opening, lifecycleOf(opening))).toMatchObject({
      kind: "v2_coordinator",
    });

    const lifecycle = lifecycleOf(fixture.context);
    const contended = await lifecycle.locks.acquireExisting(globalLockPath(fixture));
    try {
      expect(await runUninstall(fixture.rebuildContext(), ACCEPTED)).toMatchObject({
        ok: false,
        code: EXIT_CODES.recoveryRequired,
      });
    } finally {
      await contended.release();
    }
    expect(await exists(fixture.paths.manifestFile)).toBe(true);

    const previewed = await runUninstall(fixture.rebuildContext(), PREVIEW);
    expect(previewed.ok, JSON.stringify(previewed)).toBe(true);
    if (previewed.ok) expect(previewed.data.transactionId).toBeNull();
    expect(await exists(fixture.paths.manifestFile)).toBe(true);

    /** A non-terminal standalone Foundation journal is `repair`'s, never this coordinator's. */
    await expect(
      fixture.context.executor.execute({
        kind: "capture",
        mutations: [
          {
            targetPath: join(fixture.paths.home, "dispatch.probe.json"),
            operation: "create" as const,
            content: new TextEncoder().encode('{"probe":"dispatch"}\n'),
          },
        ],
      }),
    ).rejects.toThrow();
    const blocked = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    expect(blocked).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    const recovery = blocked.ok ? "" : (blocked.error.recovery ?? "");
    expect(recovery).toMatch(/developer-os repair --resume tx_[0-9a-f]{64}_[0-9]+/u);
    const resume = /--resume (tx_\S+)/u.exec(recovery)?.[1] ?? "";
    expect(
      await runRepair(fixture.rebuildContext(), { resume, rollback: null }),
    ).toMatchObject({ ok: true });

    /**
     * A V2 manifest with a non-terminal uninstall coordinator resumes it, never a second: §2.4
     * compensates every death before the point of no return under the next run's own lock, and
     * only then plans again, so the manifest is still the home's own at dispatch.
     */
    await died(fixture, dieAfterStepJournal(stepOfKind("drain_runners"), () => currentPlan(fixture)));
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    const resumed = fixture.rebuildContext();
    expect(await dispatchUninstall(resumed, lifecycleOf(resumed))).toMatchObject({
      kind: "v2_coordinator",
    });
    const published = fixture.publishedPlans.length;
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
    expect(fixture.publishedPlans.length).toBe(published + 1);

    const settled = fixture.rebuildContext();
    expect(await dispatchUninstall(settled, lifecycleOf(settled))).toStrictEqual({
      kind: "absent_manifest",
    });
    /** The probe this case planted to interrupt is scaffolding, not product residue. */
    await nodeFs.unlink(join(fixture.paths.home, "dispatch.probe.json"));
    /** §6: the absent-manifest arms never acquire the permanent global lock. */
    const events = fixture.stableLockEvents.length;
    const collected = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    expect(collected.ok, JSON.stringify(collected)).toBe(true);
    expect(fixture.stableLockEvents.slice(events)).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("dispatches a V1 manifest to the Foundation path", async () => {
    const fixture = await createCommandFixture("uninstall-dispatch-v1", {});
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      fixture.paths.manifestFile,
      `${JSON.stringify({
        schemaVersion: 1,
        productVersion: "0.0.0",
        installedAt: "2026-09-21T00:00:00.000Z",
        artifacts: [],
      })}\n`,
      { mode: 0o600 },
    );

    expect(
      await dispatchUninstall(fixture.context, lifecycleOf(fixture.context)),
    ).toStrictEqual({ kind: "v1_foundation" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

/**
 * In plan 1a the CLI plan codec admits no operation but `uninstall`, and every coordinator leaf
 * name binds to its own plan id in both directions, so neither a second uninstall envelope nor a
 * foreign coordinator is constructible on a real home. Both are pinned over synthetic records.
 */
describe("the recovery-only arm's coordinator selection", () => {
  const HOME = "/synthetic/home";

  function record(
    id: string,
    operation: string,
  ): LifecycleCoordinatorRecordV1<LifecycleExecutionPlanV1> {
    return {
      id,
      plan: { id, operation, authority: { productHome: HOME } },
      variant: "uninstall/present_manifest_without_launchd",
      journal: null,
      lock: null,
      state: "envelope_suffix_plan_only",
    } as unknown as LifecycleCoordinatorRecordV1<LifecycleExecutionPlanV1>;
  }

  it("admits exactly one uninstall coordinator and refuses every other population", () => {
    const sole = record("lc_a_0", "uninstall");
    expect(selectUninstallCoordinator([], HOME)).toBeNull();
    expect(selectUninstallCoordinator([sole], HOME)).toBe(sole);
    expect(() =>
      selectUninstallCoordinator([sole, record("lc_a_1", "uninstall")], HOME),
    ).toThrow(expect.objectContaining({ code: EXIT_CODES.recoveryRequired }));
    expect(() => selectUninstallCoordinator([record("lc_a_2", "update")], HOME)).toThrow(
      expect.objectContaining({ code: EXIT_CODES.recoveryRequired }),
    );
    expect(() =>
      selectUninstallCoordinator([sole, record("lc_a_3", "update")], HOME),
    ).toThrow(expect.objectContaining({ code: EXIT_CODES.recoveryRequired }));
  });
});

describe("the uninstall control-file adapter (NEW-97)", () => {
  it("keeps the marker, the nonce and the allocator on a rolled-back outcome with the manifest gone", async () => {
    const fixture = await initializedV2Fixture("uninstall-control-files-rolled-back");
    await died(fixture, dieAtStepReturn(manifestStep("preserve_before"), () => currentPlan(fixture)));
    /**
     * `preserve_before` has already moved the manifest to its tombstone, which the retired guard
     * read as a committed uninstall; the outcome alone decides now.
     */
    expect(await exists(fixture.paths.manifestFile)).toBe(false);

    const context = fixture.rebuildContext();
    const lifecycle = lifecycleOf(context);
    const request: LifecycleUninstallRequestV1 = {
      context,
      lifecycle,
      key: await recoveryKeyOf(fixture, context),
      admitted: null,
      evidence: await evidenceOf(fixture),
      options: ACCEPTED,
    };
    const holds: UninstallHoldsV1 = {
      global: await lifecycle.locks.acquireExisting(globalLockPath(fixture)),
      leases: [],
    };
    try {
      const adapters = createUninstallAdapters({
        request,
        ...createUninstallParticipants(request),
        holds,
      });
      await adapters.controlFiles.removeAllocator(currentPlan(fixture), "rolled_back");
      await adapters.controlFiles.removeNonce(currentPlan(fixture), "rolled_back");
    } finally {
      await releaseUninstallHolds(holds);
    }

    expect(await exists(join(fixture.paths.stateDir, "uninstalling.json"))).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce"))).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, "lifecycle-id-allocator.json"))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
