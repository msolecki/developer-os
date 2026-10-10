import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES, hashBytes, parseCanonicalAbsolutePathText } from "@developer-os/core";
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
import { decodeManifestAnchor, manifestAnchorPath } from "./manifest-anchor.js";
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
import type { UninstallPayloadV1 } from "./uninstall-payloads.js";
import type {
  LifecycleUninstallRequestV1,
  UninstallBoundaryV1,
  UninstallHoldsV1,
} from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const PREVIEW = { dryRun: true, assumeYes: true } as const;

/**
 * NEW-210 (2026-10-10) grew the chain to seven kill points and two 17 MiB payloads per init. Its
 * first green isolated run took 500.98 s for the whole file. The six-point chain measured 1080.9 s
 * on 2026-09-21, and the whole-file spread (0.7%) scaled that to 1088.4 s. That figure, scaled to
 * seven points, is 1269.8 s and outweighs the new run, so it sets the budget:
 * ceil(1269.8 x 2 x 1.5) leaves a hosted runner at ~2x unable to trip it. It cannot take
 * `REAL_FILESYSTEM_TIMEOUT_MS`: either figure doubled exceeds that 900 s budget.
 */
const CHAIN_TIMEOUT_MS = 3_810_000;

const POINTS = [
  ["M(preserve_before) applied, cursor not advanced", "compensation"],
  ["M(commit_absence) durable", "force_forward"],
  ["K(delete) after one payload unlinked", "force_forward"],
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
      /** NEW-210: whether `payloads/<n>` holds each of the two large files, by ordinal. */
      readonly payloadStaged: readonly [boolean, boolean];
    }
  >
> = {
  "M(preserve_before) applied, cursor not advanced": {
    manifestTombstone: true,
    keyTombstone: true,
    nonce: true,
    allocator: true,
    payloadStaged: [true, true],
  },
  "M(commit_absence) durable": {
    manifestTombstone: true,
    keyTombstone: true,
    nonce: true,
    allocator: true,
    payloadStaged: [true, true],
  },
  /** `K(delete)` unlinks the payloads before the key, so the key tombstone outlives the first. */
  "K(delete) after one payload unlinked": {
    manifestTombstone: true,
    keyTombstone: true,
    nonce: true,
    allocator: true,
    payloadStaged: [false, true],
  },
  "M(finalize_tombstones) after one empty-directory removal": {
    manifestTombstone: true,
    keyTombstone: false,
    nonce: true,
    allocator: true,
    payloadStaged: [false, false],
  },
  "coordinator_envelope after nonce removal": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
    payloadStaged: [false, false],
  },
  "plan plus lock": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
    payloadStaged: [false, false],
  },
  "plan only": {
    manifestTombstone: false,
    keyTombstone: false,
    nonce: false,
    allocator: false,
    payloadStaged: [false, false],
  },
};

/**
 * NEW-210: two release files over `MAX_MUTATION_BYTES`, so a home initialized with these carries
 * two `K` payloads and a kill between them leaves one moved and one not.
 */
const LARGE_BYTES = 17 * 1024 * 1024;
const LARGE_OPTIONS: FixtureOptions = {
  extraBundleFiles: ["bin/large-a", "bin/large-b"].map((relativePath) => ({
    relativePath,
    bytes: new Uint8Array(LARGE_BYTES),
    mode: 0o700 as const,
  })),
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

function dieAtPayload(
  kind: "payload_staged" | "payload_deleted",
  ordinal: number,
): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== kind || boundary.ordinal !== ordinal) return;
    fired = true;
    throw new SyntheticDeath(`${kind} ${String(ordinal)}`);
  };
}

async function died(
  fixture: V2FixtureV1,
  afterBoundary: (boundary: UninstallBoundaryV1) => void,
): Promise<void> {
  const uninstaller = new LifecycleUninstaller({ afterBoundary });
  await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);
}

type UninstallAdaptersV1 = ReturnType<typeof createUninstallAdapters>;

/** One recovery-only pass over the fixture's coordinator, with `adapt` wrapped around its adapters. */
async function recoverUninstall(
  fixture: V2FixtureV1,
  adapt: (adapters: UninstallAdaptersV1) => UninstallAdaptersV1 = (adapters) => adapters,
): Promise<void> {
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
    const recovered = await lifecycle
      .recovery(key, adapt(adapters), residueFrom(evidence))
      .recover(global, { resumeUninstall: true });
    holds.global = recovered.global;
  } finally {
    await releaseUninstallHolds(holds);
  }
}

/**
 * `CliLifecycleContext.recovery` binds no `afterBoundary`, so the compaction boundaries
 * `compactTerminalCoordinator` publishes are unreachable from a hook. The adapters it calls are
 * this caller's own, and `removeEnvelopeLeaves` takes the nonce through
 * `controlFiles.removeNonce`, which is the last reachable point inside the envelope entry.
 */
async function dieInsideEnvelopeCompaction(fixture: V2FixtureV1): Promise<void> {
  await expect(
    recoverUninstall(fixture, (adapters) => ({
      ...adapters,
      controlFiles: {
        removeAllocator: (plan: LifecycleExecutionPlanV1, outcome: LifecycleTerminalOutcomeV1) =>
          adapters.controlFiles.removeAllocator(plan, outcome),
        removeNonce: async (plan: LifecycleExecutionPlanV1, outcome: LifecycleTerminalOutcomeV1) => {
          await adapters.controlFiles.removeNonce(plan, outcome);
          throw new SyntheticDeath("coordinator_envelope after nonce removal");
        },
      },
    })),
  ).rejects.toThrow(SyntheticDeath);
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
    case "K(delete) after one payload unlinked":
      await died(fixture, dieAtPayload("payload_deleted", 0));
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

function payloadsOf(fixture: V2FixtureV1): readonly UninstallPayloadV1[] {
  const payloads = currentPlan(fixture).participants.redactionKey?.payloads ?? [];
  if (payloads.length !== 2) throw new Error(`the uninstall plan carries ${String(payloads.length)} payloads, not 2`);
  return payloads;
}

async function observedMicrostate(
  fixture: V2FixtureV1,
): Promise<(typeof MICROSTATES)[KillPointV1]> {
  const leaves = manifestLeafOf(fixture);
  const [first, second] = payloadsOf(fixture);
  return {
    manifestTombstone: await exists(leaves.tombstonePath),
    keyTombstone: await exists(leaves.keyTombstonePath),
    nonce: await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce")),
    allocator: await exists(join(fixture.paths.stateDir, "lifecycle-id-allocator.json")),
    payloadStaged: [first !== undefined && (await exists(first.payloadPath)), second !== undefined && (await exists(second.payloadPath))],
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
    const fixture = await initializedV2Fixture("uninstall-recovery-chain", LARGE_OPTIONS);
    for (const [point, arm] of POINTS) {
      const sources = arm === "compensation" ? await largeSourceIdentities(fixture) : [];
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
        // Compensation renamed each payload's own inode back, mode included.
        expect(
          await Promise.all(sources.map(([path]) => identityOf(path))),
          `${point} restored payloads`,
        ).toStrictEqual(sources);
        // The resume restored the installation, so the anchor of its manifest stays (D54 finding 1).
        const anchor = decodeManifestAnchor(await nodeFs.readFile(manifestAnchorPath(fixture.paths.home)));
        expect(anchor?.manifestHash, `${point} anchor`).toBe(hashBytes(await nodeFs.readFile(fixture.paths.manifestFile)));
        expect(
          (await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok,
          `${point} then uninstall`,
        ).toBe(true);
      }
      const settled = fixture.rebuildContext();
      expect(await dispatchUninstall(settled, lifecycleOf(settled)), point).toStrictEqual({
        kind: "absent_manifest",
      });
      for (const payload of payloadsOf(fixture)) {
        expect(await exists(payload.sourcePath), `${point} ${payload.sourcePath}`).toBe(false);
        expect(await exists(dirname(payload.payloadPath)), `${point} payloads`).toBe(false);
      }
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
 * NEW-210: `K(stage)` runs before the point of no return, so a death inside it compensates. A hook
 * that throws there is caught as a step failure and compensated in process, which no real crash
 * does; from the moment it fires, every port call this run's participants make throws as well, so
 * the run stops touching the disk exactly where it died.
 */
async function diedInsideKStage(fixture: V2FixtureV1): Promise<void> {
  const request = await requestFor(fixture);
  let dead = false;
  const fs = new Proxy(request.lifecycle.fs, {
    get(target, property): unknown {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        if (dead) throw new SyntheticDeath(`fs.${String(property)} after the death`);
        return (value as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const uninstaller = new LifecycleUninstaller({
    afterBoundary: (boundary) => {
      if (dead || boundary.kind !== "payload_staged" || boundary.ordinal !== 0) return;
      dead = true;
      throw new SyntheticDeath("payload_staged 0");
    },
  });
  await expect(
    uninstaller.execute({ ...request, lifecycle: { ...request.lifecycle, fs } }),
  ).rejects.toThrow(SyntheticDeath);
}

type IdentityV1 = readonly [path: string, dev: string, ino: string, mode: number];

async function identityOf(path: string): Promise<IdentityV1> {
  const stat = await nodeFs.lstat(path, { bigint: true });
  return [path, String(stat.dev), String(stat.ino), Number(stat.mode & 0o777n)];
}

/** What the plan recorded for `payload` when it was admitted at its source. */
function identityAt(path: string, payload: UninstallPayloadV1): IdentityV1 {
  return [path, payload.dev, payload.ino, payload.mode];
}

/** The two large release files at their sources, read from the admitted manifest before any kill. */
async function largeSourceIdentities(fixture: V2FixtureV1): Promise<readonly IdentityV1[]> {
  const admitted = (await requestFor(fixture)).admitted;
  const paths = (admitted?.manifest.artifacts ?? [])
    .map((artifact) => artifact.path as string)
    .filter((path) => /\/bin\/large-[ab]$/u.test(path))
    .sort();
  if (paths.length !== 2) throw new Error(`the manifest records ${String(paths.length)} large files, not 2`);
  return Promise.all(paths.map(identityOf));
}

describe("a death inside K(stage) with one of two payloads moved (NEW-210)", () => {
  it("compensates the moved payload and resumes the uninstall forward", async () => {
    const fixture = await initializedV2Fixture("uninstall-recovery-k-stage", LARGE_OPTIONS);
    await diedInsideKStage(fixture);
    const [first, second] = payloadsOf(fixture);
    if (first === undefined || second === undefined) throw new Error("unreachable");
    expect(await exists(first.sourcePath)).toBe(false);
    expect(await exists(first.payloadPath)).toBe(true);
    expect(await exists(second.sourcePath)).toBe(true);
    expect(await exists(second.payloadPath)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    const dispatched = fixture.rebuildContext();
    expect(await dispatchUninstall(dispatched, lifecycleOf(dispatched))).toMatchObject({
      kind: "v2_coordinator",
    });

    const published = fixture.publishedPlans.length;
    const resumed = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);

    /** The compensation renamed the moved inode back, so the next plan admitted the same identities. */
    expect(fixture.publishedPlans.length).toBe(published + 1);
    expect(payloadsOf(fixture).map((payload) => identityAt(payload.sourcePath, payload))).toStrictEqual([
      identityAt(first.sourcePath, first),
      identityAt(second.sourcePath, second),
    ]);
    const settled = fixture.rebuildContext();
    expect(await dispatchUninstall(settled, lifecycleOf(settled))).toStrictEqual({
      kind: "absent_manifest",
    });
    for (const payload of payloadsOf(fixture)) {
      expect(await exists(payload.sourcePath)).toBe(false);
      expect(await exists(dirname(payload.payloadPath))).toBe(false);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * The swap fails the second move, and compensation then refuses rather than restoring: it runs in
   * reverse, and an entry with nothing staged whose source is a foreign inode is indistinguishable
   * from a payload lost after its move, so it refuses before ordinal 0 is renamed back (the same
   * fail-closed rule as a payload absent at both names). Nothing is lost: ordinal 0 waits in
   * `payloads/0`, and once the original is back recovery restores both inodes.
   */
  it("fails the second move on a swapped identity, holds ordinal 0 in payloads/ behind exit 6, and restores every payload once the original is back", async () => {
    const fixture = await initializedV2Fixture("uninstall-recovery-k-stage-swap", LARGE_OPTIONS);
    let aside = "";
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: async (boundary) => {
        if (aside !== "" || boundary.kind !== "payload_staged" || boundary.ordinal !== 0) return;
        const second = payloadsOf(fixture)[1]?.sourcePath ?? "";
        aside = `${second}.aside`;
        await nodeFs.rename(second, aside);
        await nodeFs.writeFile(second, new Uint8Array(LARGE_BYTES), { mode: 0o700 });
      },
    });
    const [first, second] = await (async () => {
      await expect(uninstaller.execute(await requestFor(fixture))).rejects.toMatchObject({
        code: EXIT_CODES.recoveryRequired,
        reason: "uninstall_payload_identity",
      });
      return payloadsOf(fixture);
    })();
    if (first === undefined || second === undefined) throw new Error("unreachable");
    /** The compensation refused inside its first resolution, before the journal left the forward phase. */
    const journal = JSON.parse(await nodeFs.readFile(envelopeLeafPath(fixture, "journal"), "utf8")) as {
      readonly phase: string;
      readonly compensationNext: number | null;
    };
    expect([journal.phase, journal.compensationNext]).toStrictEqual(["participants_applying", null]);
    const held = async (): Promise<void> => {
      expect(await exists(first.sourcePath)).toBe(false);
      expect(await identityOf(first.payloadPath)).toStrictEqual(identityAt(first.payloadPath, first));
      expect(await exists(second.payloadPath)).toBe(false);
      expect(await identityOf(second.sourcePath)).not.toStrictEqual(identityAt(second.sourcePath, second));
    };
    await held();

    /** The refusal is the restore path's, so a second run refuses the same way and moves nothing. */
    const again = await runUninstall(fixture.rebuildContext(), ACCEPTED);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe(EXIT_CODES.recoveryRequired);
    await held();

    await nodeFs.rename(aside, second.sourcePath);
    await recoverUninstall(fixture);

    for (const payload of [first, second]) {
      expect(await identityOf(payload.sourcePath)).toStrictEqual(identityAt(payload.sourcePath, payload));
      expect(await exists(dirname(payload.payloadPath))).toBe(false);
    }
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
    const settled = fixture.rebuildContext();
    expect(await dispatchUninstall(settled, lifecycleOf(settled))).toStrictEqual({
      kind: "absent_manifest",
    });
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
