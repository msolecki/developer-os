import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_INGEST_HOME_REPAIR,
  decodeCanonicalJson,
  EXIT_CODES,
  MANIFEST_ANCHOR_RELATIVE_PATH,
  SCHEDULED_JOB_IDS,
  encodeCanonicalJson,
  lifecycleBookkeepingPaths,
  lifecycleReservationOrder,
  parseCanonicalAbsolutePathText,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleCoordinatorStore,
} from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { runDoctor } from "../commands/doctor.js";
import { runInit } from "../commands/init.js";
import { runStatus } from "../commands/status.js";
import {
  createCommandFixture,
  exists,
  inventory,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture, FixtureOptions } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import type { CliContext } from "../context.js";
import { admitInstalledV2Home } from "./admission.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import { lifecycleVariantFacts } from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { coordinatorNonceOf, lifecycleHomeKeyFromAdmission, residueFrom } from "./context.js";
import type { CliLifecycleContext, LifecycleHomeKeyV1 } from "./context.js";
import { redactionKeyTombstonePath } from "./redaction-key.js";
import {
  chunkUninstallArtifacts,
  createUninstallAdapters,
  createUninstallParticipants,
  LifecycleUninstaller,
  MAX_UNINSTALL_ARTIFACTS,
  releaseUninstallHolds,
  UninstallCapacityError,
} from "./uninstall.js";
import type {
  LifecycleUninstallRequestV1,
  UninstallBoundaryV1,
  UninstallHoldsV1,
} from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const COORDINATOR_ID = /^lc_[0-9a-f]{64}_[0-9]+$/u;

const keyReads = vi.hoisted(() => ({ path: null as string | null, count: 0 }));

/**
 * `importOriginal` partial rather than a hand-written stub: the whole fresh-`init` and
 * coordinator graph runs through this module, so an exhaustive replacement would be a latent
 * break on the next export Node adds.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const target: unknown = args[0];
      if (keyReads.path !== null && target === keyReads.path) { keyReads.count += 1; }
      return actual.readFile(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const target: unknown = args[0];
      if (keyReads.path === null || target !== keyReads.path) return handle;
      return new Proxy(handle, {
        get(inner, property, receiver): unknown {
          if (property === "read" || property === "readv" || property === "readFile") {
            return (...call: unknown[]): unknown => {
              keyReads.count += 1;
              const member = Reflect.get(inner, property) as (...rest: unknown[]) => unknown;
              return member.apply(inner, call);
            };
          }
          const value: unknown = Reflect.get(inner, property, receiver);
          return typeof value === "function" ? (value as () => unknown).bind(inner) : value;
        },
      });
    },
  };
});

class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

afterEach(async () => {
  keyReads.path = null;
  await removeCommandFixtures();
});

interface FixtureStateV1 {
  readonly publishedPlans: LifecycleExecutionPlanV1[];
  readonly clock: { nowMs: number } | null;
}

interface V2FixtureV1 extends CommandFixture {
  readonly publishedPlans: readonly LifecycleExecutionPlanV1[];
  readonly reservedIds: readonly string[];
  readonly reservedPrefixes: readonly string[];
  readonly boundaries: UninstallBoundaryV1[];
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
 * The lifecycle context is rebuilt per call so the fake drain clock and the plan recorder
 * survive `rebuildContext()`; the uninstaller reads `nowMs`/`sleepMs` off the request's
 * lifecycle on every call, which is what makes the substitution reach the lease drain.
 */
function instrument(context: CliContext, state: FixtureStateV1): CliContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  const clock = state.clock;
  const instrumented: CliLifecycleContext = {
    ...lifecycle,
    ...(clock === null
      ? {}
      : {
          nowMs: () => clock.nowMs,
          /**
           * A minute per retry rather than the requested 250 ms: the provider spawns one
           * `lockf` per attempt, so honouring the real interval would cost 2400 processes to
           * reach one ten-minute deadline. Only the deadline's arrival is under test.
           */
          sleepMs: () => {
            clock.nowMs += 60_000;
            return Promise.resolve();
          },
        }),
    store: (key) => recordingStore(lifecycle.store(key), state.publishedPlans),
  };
  return { ...context, lifecycle: instrumented };
}

/**
 * D28's block of six, read back in reservation order: `lc`, each step's forward then its
 * compensation, then `mf`. The plan persists `participants.foundation` in UTF-8 id order, so
 * the reservation order is recovered from the steps rather than from the array.
 */
function reservedIdsOf(plan: LifecycleExecutionPlanV1 | undefined): readonly string[] {
  if (plan === undefined) return [];
  const byId = new Map(plan.participants.foundation.map((ref) => [ref.id as string, ref]));
  const ids: string[] = [plan.id];
  for (const step of plan.steps) {
    if (step.kind !== "foundation") continue;
    const ref = byId.get(step.participantId);
    if (ref === undefined || ref.role.kind !== "forward") continue;
    ids.push(ref.id);
    if (ref.role.compensationId !== null) ids.push(ref.role.compensationId);
  }
  const manifest = plan.participants.manifest;
  if (manifest !== null) ids.push(manifest.participantId);
  return ids;
}

async function initializedV2Fixture(
  name: string,
  options: FixtureOptions & { readonly lifecycleClock?: "fake" } = {},
): Promise<V2FixtureV1> {
  const { lifecycleClock, ...rest } = options;
  const base = await createCommandFixture(name, { ...rest, bootstrapAvailable: true });
  await nodeFs.mkdir(base.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(base.context, ACCEPTED);
  if (!initialized.ok) {
    throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  }
  const state: FixtureStateV1 = {
    publishedPlans: [],
    clock: lifecycleClock === "fake" ? { nowMs: 1_000 } : null,
  };
  const boundaries: UninstallBoundaryV1[] = [];
  return {
    ...base,
    context: instrument(base.context, state),
    rebuildContext: () => instrument(base.rebuildContext(), state),
    boundaries,
    get publishedPlans() {
      return state.publishedPlans;
    },
    get reservedIds(): readonly string[] {
      return reservedIdsOf(state.publishedPlans.at(-1));
    },
    get reservedPrefixes(): readonly string[] {
      return reservedIdsOf(state.publishedPlans.at(-1)).map((id) => id.slice(0, id.indexOf("_")));
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

async function evidenceOf(fixture: CommandFixture) {
  return inspectBootstrapEvidenceAdmission(
    createBootstrapEvidenceInspectionRequest({
      productHome: fixture.paths.home,
      stateDirectory: fixture.paths.stateDir,
      initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
    }),
  );
}

async function admittedOf(fixture: CommandFixture): Promise<AdmittedV2HomeV1> {
  const lifecycle = lifecycleOf(fixture.context);
  return admitInstalledV2Home({
    fs: lifecycle.fs,
    paths: fixture.paths,
    manifestAdmission: manifestAdmissionFor(fixture.paths, []),
    effectiveUid: lifecycle.effectiveUid,
  });
}

async function requestFor(fixture: V2FixtureV1): Promise<LifecycleUninstallRequestV1> {
  const admitted = await admittedOf(fixture);
  return {
    context: fixture.context,
    lifecycle: lifecycleOf(fixture.context),
    key: lifecycleHomeKeyFromAdmission(admitted, fixture.paths),
    admitted,
    evidence: await evidenceOf(fixture),
    options: ACCEPTED,
  };
}

async function allocatorCounter(fixture: CommandFixture): Promise<bigint> {
  const value = JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-id-allocator.json"), "utf8"),
  ) as { readonly nextCounter: string };
  return BigInt(value.nextCounter);
}

async function productHomeResidue(fixture: CommandFixture): Promise<readonly string[]> {
  const relative = await inventory(fixture.paths.home);
  return [...relative].map((entry) => join(fixture.paths.home, entry)).sort();
}

/**
 * A12's closed set, every retained bootstrap-evidence path, the directories that exist only to
 * hold one, and `state` itself — which no rule projects away. Nothing else may survive. The
 * manifest anchor is the one member uninstall removes (D54 review, finding 1).
 */
async function bookkeepingSetAndRetainedEvidence(
  fixture: CommandFixture,
): Promise<readonly string[]> {
  const evidence = await evidenceOf(fixture);
  const home = fixture.paths.home;
  const expected = new Set<string>([
    ...[...lifecycleBookkeepingPaths(home)].filter((path) => path !== join(home, MANIFEST_ANCHOR_RELATIVE_PATH)),
    ...evidence.retainedPaths,
    fixture.paths.stateDir,
  ]);
  for (const path of evidence.retainedPaths) {
    let ancestor = join(path, "..");
    while (ancestor.startsWith(`${home}/`)) {
      expected.add(ancestor);
      ancestor = join(ancestor, "..");
    }
  }
  const leaf = join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock");
  if (await exists(leaf)) expected.add(leaf);
  return [...expected].filter((path) => path !== home).sort();
}

function dieAtFirst(kind: UninstallBoundaryV1["kind"]): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== kind) return;
    fired = true;
    throw new SyntheticDeath(kind);
  };
}

/**
 * The journal rewrite that advances past `stepKind` is the durable record of that step, so a
 * death there is the one that leaves the step done and the cursor already past it.
 */
function dieAfterJournalRewriteAt(
  stepKind: LifecycleExecutionPlanV1["steps"][number]["kind"],
  plansOf: () => readonly LifecycleExecutionPlanV1[],
): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== "journal_rewritten") return;
    const plan = plansOf().at(-1);
    if (plan === undefined) return;
    if (plan.steps[boundary.nextStep - 1]?.kind !== stepKind) return;
    fired = true;
    throw new SyntheticDeath(stepKind);
  };
}

async function recoverUninstall(
  fixture: V2FixtureV1,
  options: { readonly context?: CliContext } = {},
) {
  const context = options.context ?? fixture.context;
  const lifecycle = lifecycleOf(context);
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const nonce = await coordinatorNonceOf(lifecycle.fs, productHome);
  if (nonce === null) throw new Error("the ledger holds no lc_ leaf to recover from");
  const key: LifecycleHomeKeyV1 = { productHome, nonce };
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
    const adapters = createUninstallAdapters({
      request,
      ...createUninstallParticipants(request),
      afterBoundary: (boundary) => {
        fixture.boundaries.push(boundary);
      },
      holds,
    });
    const global = holds.global;
    if (global === null) throw new Error("unreachable");
    const recovered = await lifecycle
      .recovery(key, adapters, residueFrom(evidence))
      .recover(global, { resumeUninstall: true });
    holds.global = recovered.global;
    return recovered;
  } finally {
    await releaseUninstallHolds(holds);
  }
}

function manifestTombstoneOf(fixture: V2FixtureV1): string {
  const plan = fixture.publishedPlans.at(-1);
  const manifest = plan?.participants.manifest;
  if (manifest === undefined || manifest === null) throw new Error("no published manifest plan");
  return manifest.tombstonePath;
}

async function plant(path: string, content: string): Promise<void> {
  await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, content, { mode: 0o600 });
}

async function plantAutomationLifecycleRecord(fixture: CommandFixture): Promise<void> {
  const text = await nodeFs.readFile(fixture.paths.configFile, "utf8");
  const schedules = SCHEDULED_JOB_IDS.slice(0, 3)
    .map(
      (job, index) =>
        `[[automation.lifecycle.schedules]]\njob = "${job}"\nschedule = { cadence = "daily", hour = ${String(index + 3)}, minute = 0 }\n`,
    )
    .join("\n");
  await nodeFs.writeFile(
    fixture.paths.configFile,
    `${text}\n[automation.lifecycle]\nschemaVersion = 1\n\n${schedules}`,
    { mode: 0o600 },
  );
}

async function plantActiveAutomationActivation(fixture: CommandFixture): Promise<void> {
  await nodeFs.writeFile(
    join(fixture.paths.stateDir, "lifecycle-activation.json"),
    encodeCanonicalJson({
      schemaVersion: 1,
      automation: { state: "active", configHash: "c".repeat(64) },
      git: { state: "inactive" },
    }),
    { mode: 0o600 },
  );
}

describe("V2 uninstall through the lifecycle coordinator", () => {
  it("uninstalls through one without-launchd coordinator and leaves exactly the bookkeeping set and retained evidence", async () => {
    const fixture = await initializedV2Fixture("uninstall-coordinator");
    const retained = await fixture.bootstrapEvidenceIdentities();
    expect(retained.length).toBeGreaterThan(0);
    const expectedResidue = await bookkeepingSetAndRetainedEvidence(fixture);
    keyReads.path = join(fixture.paths.stateDir, "redaction.key");
    expect((await nodeFs.lstat(keyReads.path)).isFile()).toBe(true);
    keyReads.count = 0;
    await evidenceOf(fixture);
    expect(keyReads.count).toBe(0);

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    expect(result.ok).toBe(true);
    expect(result.data.transactionId).toMatch(COORDINATOR_ID);
    const plan = fixture.publishedPlans.at(-1);
    expect(plan?.steps.map((step) => step.kind)).toStrictEqual([
      "foundation",
      "drain_runners",
      "foundation",
      "redaction_key",
      "manifest",
      "manifest",
      "redaction_key",
      "manifest",
    ]);
    expect(plan?.authority.plistPaths).toStrictEqual([]);
    expect(plan?.previewHash).toBeNull();
    expect(plan?.participants.launchd).toBeNull();
    expect(plan?.participants.launchdBeforeFiles).toBeNull();
    expect(plan?.participants.launchdAfterFiles).toBeNull();
    expect(fixture.reservedPrefixes).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "mf"]);
    const counters = fixture.reservedIds.map((id) => BigInt(id.slice(id.lastIndexOf("_") + 1)));
    const first = counters[0] ?? -1n;
    expect(counters).toStrictEqual([0n, 1n, 2n, 3n, 4n, 5n].map((offset) => first + offset));
    const artifactStep = plan?.steps[2];
    const artifacts = plan?.participants.foundation.find(
      (ref) => artifactStep?.kind === "foundation" && ref.id === artifactStep.participantId,
    );
    const targets = (artifacts?.mutations ?? []).map((mutation) => mutation.targetPath as string);
    expect(targets.slice(0, SCHEDULED_JOB_IDS.length)).toStrictEqual(
      SCHEDULED_JOB_IDS.map((job) => join(fixture.paths.stateDir, `.automation-${job}.lock`)),
    );
    const rest = targets.slice(SCHEDULED_JOB_IDS.length);
    expect([...rest].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))))
      .toStrictEqual(rest);
    expect(targets).not.toContain(join(fixture.paths.stateDir, "uninstalling.json"));
    expect(targets).not.toContain(join(fixture.paths.stateDir, "lifecycle-install-nonce"));
    expect(targets).not.toContain(join(fixture.paths.stateDir, "lifecycle-id-allocator.json"));
    expect(targets).not.toContain(fixture.paths.manifestFile);
    expect(targets.some((target) => target.startsWith(`${fixture.paths.brain}/`))).toBe(false);
    expect(keyReads.count).toBe(0);
    expect(fixture.vendorProcesses).toStrictEqual([]);
    expect(await fixture.bootstrapEvidenceIdentities()).toStrictEqual(retained);
    expect(await productHomeResidue(fixture)).toStrictEqual(expectedResidue);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("removes every pulse report slot and the brain-garden and brain-pulse status, lock and log files once they hold runs (NEW-134)", async () => {
    const fixture = await initializedV2Fixture("uninstall-new-134-runtime");
    const jobs = ["brain-garden", "brain-pulse"] as const;
    const written = [
      ...Array.from({ length: 8 }, (_unused, slot) => join(fixture.paths.stateDir, `pulse.${String(slot)}.md`)),
      ...jobs.flatMap((job) => [
        join(fixture.paths.stateDir, `automation-${job}.status.json`),
        ...Array.from({ length: 10 }, (_unused, slot) => join(fixture.paths.home, "logs", `automation-${job}.${String(slot)}.json`)),
      ]),
    ];
    const leases = jobs.map((job) => join(fixture.paths.stateDir, `.automation-${job}.lock`));
    for (const path of written) {
      expect(await exists(path), path).toBe(true);
      await nodeFs.writeFile(path, "a recorded run\n", { mode: 0o600 });
    }
    for (const path of leases) expect(await exists(path), path).toBe(true);

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    for (const path of [...written, ...leases]) expect(await exists(path), path).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports as removed only what the run removed: not a kept directory nor a row already gone (W2-UNINST-3)", async () => {
    const fixture = await initializedV2Fixture("uninstall-removed-report");
    const logs = join(fixture.paths.home, "logs");
    await nodeFs.writeFile(join(logs, "mine.txt"), "the user's own file\n", { mode: 0o600 });
    const gone = join(fixture.paths.stateDir, "automation-brain-pulse.status.json");
    expect(await exists(gone)).toBe(true);
    await nodeFs.rm(gone);
    const status = join(fixture.paths.stateDir, "automation-brain-garden.status.json");

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    expect(result.data.preserved).toContain(logs);
    expect(result.data.removed).not.toContain(logs);
    expect(result.data.removed).not.toContain(gone);
    expect(result.data.removed).toContain(status);
    expect(result.data.removed).toContain(fixture.paths.manifestFile);
    expect(result.data.removed).toContain(join(fixture.paths.stateDir, ".automation-doctor.lock"));
    for (const path of result.data.removed) expect(await exists(path), path).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["an automation lifecycle record in the configuration", plantAutomationLifecycleRecord],
    ["an active automation arm in the activation record", plantActiveAutomationActivation],
  ])("uninstalls the P variant selected by %s, with no generated label to unload (plan 1b Task 18)", async (_label, planter) => {
    const fixture = await initializedV2Fixture("uninstall-p-variant");
    await planter(fixture);

    const result = await runUninstall(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(`${String(result.code)} ${result.error.kind}: ${result.error.message}`);
    const plan = fixture.publishedPlans.at(-1);
    if (plan === undefined) throw new Error("no published plan");
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest");
    expect(plan.steps.map((step) => step.kind).slice(0, 3)).toStrictEqual([
      "foundation",
      "launchd_before_files",
      "drain_runners",
    ]);
    expect(plan.participants.launchd?.entries).toStrictEqual([]);
    expect(plan.authority.plistPaths).toStrictEqual([]);
    expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "le", "mf"]);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(fixture.paths.brain)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("re-derives the empty-directory list from the tombstone after a death between an rmdir and the tombstone deletion (D25)", async () => {
    const fixture = await initializedV2Fixture("uninstall-directory-crash");
    await plant(join(fixture.paths.logsDir, "unrelated.txt"), "synthetic");
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: dieAtFirst("empty_directory_removed"),
    });

    await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);
    expect(await exists(manifestTombstoneOf(fixture))).toBe(true);

    await recoverUninstall(fixture);

    expect(await exists(manifestTombstoneOf(fixture))).toBe(false);
    expect(await exists(join(fixture.paths.home, "rollback"))).toBe(false);
    expect(await exists(fixture.paths.logsDir)).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce"))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * NEW-160/NEW-170: past `M(commit_absence)` the manifest is gone, so `doctor` used to say `init`
   * (which refuses the coordinator journal) or `repair` (which the gate refuses), and `status`
   * said nothing. Both now name the coordinator and the marker, and their recovery works.
   */
  it("names an uninstall killed past commit_absence in doctor and status, and their recovery reaches a clean home (NEW-160, NEW-170)", async () => {
    const fixture = await initializedV2Fixture("uninstall-surveyed-after-commit-absence");
    const expectedResidue = await bookkeepingSetAndRetainedEvidence(fixture);
    const uninstaller = new LifecycleUninstaller({ afterBoundary: dieAtFirst("empty_directory_removed") });
    await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);

    const doctor = await runDoctor(fixture.context);
    expect(doctor.ok).toBe(false);
    if (doctor.ok) return;
    expect(doctor.code).toBe(EXIT_CODES.recoveryRequired);
    expect(doctor.error.recovery).toBe("developer-os uninstall");
    expect(doctor.error.message).toMatch(/lifecycle: an interrupted uninstall left its marker behind; uninstall coordinator lc_[0-9a-f]{64}_[0-9]+ is unfinished or still running/u);
    expect(doctor.error.message).not.toContain("transactions:");

    const status = await runStatus(fixture.context);
    if (!status.ok) throw new Error(`${String(status.code)} ${status.error.kind}: ${status.error.message}`);
    expect(status.warnings.join("\n")).toContain(`${join(fixture.paths.stateDir, "uninstalling.json")}; recovery: developer-os uninstall`);
    expect(status.warnings.join("\n")).toMatch(/uninstall coordinator lc_[0-9a-f]{64}_[0-9]+ is unfinished or still running \(active\): .*lifecycle-journals.*; recovery: developer-os uninstall/u);

    const resumed = await runUninstall(fixture.context, ACCEPTED);
    if (!resumed.ok) throw new Error(`${String(resumed.code)} ${resumed.error.kind}: ${resumed.error.message}`);
    expect(await productHomeResidue(fixture)).toStrictEqual(expectedResidue);
    const after = await runStatus(fixture.context);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.warnings.join("\n")).not.toContain("recovery: developer-os uninstall");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * §2.4 compensates every death before the point of no return, so a resumed coordinator never
   * re-enters `F(uninstall_artifacts)` — the re-drain is the *next* `uninstall`, which
   * compensates the dead one under the global lock and then plans and drains again.
   */
  it("re-drains after a death that followed R and removes each lease only while its descriptor is held", async () => {
    const fixture = await initializedV2Fixture("uninstall-death-after-drain");
    const died = new LifecycleUninstaller({
      afterBoundary: dieAfterJournalRewriteAt("drain_runners", () => fixture.publishedPlans),
    });
    await expect(died.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);

    const resumed = new LifecycleUninstaller({
      afterBoundary: (boundary) => {
        fixture.boundaries.push(boundary);
      },
    });
    await resumed.execute(await requestFor(fixture));

    const locks = fixture.stableLockEvents;
    for (const job of SCHEDULED_JOB_IDS) {
      const lease = join(fixture.paths.stateDir, `.automation-${job}.lock`);
      const removedAt = fixture.boundaries.findLastIndex(
        (boundary) => boundary.kind === "lease_path_removed" && boundary.job === job,
      );
      expect(removedAt, `no lease_path_removed for ${job}`).toBeGreaterThanOrEqual(0);
      expect(locks.lastIndexOf(`acquire ${lease}`)).toBeLessThan(
        locks.lastIndexOf(`release ${lease}`),
      );
      expect(await exists(lease)).toBe(false);
    }
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses at the drain deadline with the marker durable, the global lock released and every lease released", async () => {
    const fixture = await initializedV2Fixture("uninstall-drain-deadline", {
      lifecycleClock: "fake",
    });
    const lifecycle = lifecycleOf(fixture.context);
    const markerPath = join(fixture.paths.stateDir, "uninstalling.json");
    const leasePathOf = (job: string): CanonicalAbsolutePathV1 =>
      parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, `.automation-${job}.lock`));
    /** The last lease in reconciliation order, so the three before it are really acquired. */
    const contested = SCHEDULED_JOB_IDS[3];
    const held = await lifecycle.locks.acquireExisting(leasePathOf(contested));
    let markerDuringDrain = "";
    try {
      const uninstaller = new LifecycleUninstaller({
        afterBoundary: async () => {
          const observed = await nodeFs.readFile(markerPath, "utf8").catch(() => "");
          if (observed.length > 0) markerDuringDrain = observed;
        },
      });

      const refusal: unknown = await uninstaller
        .execute(await requestFor(fixture))
        .then(() => null, (error: unknown) => error);

      expect(refusal).toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect(markerDuringDrain).toContain('"coordinatorId":"lc_');
      const lockPath = globalLockPath(fixture);
      const events = fixture.stableLockEvents;
      expect(events, events.join(" | ")).toContain(`release ${lockPath}`);
      /** The global lock is gone before any lease is taken: §5.4's no-inversion rule. */
      expect(events.indexOf(`release ${lockPath}`)).toBeLessThan(
        events.findIndex((event) => event.includes(".automation-") && event.startsWith("acquire ")) + events.length,
      );
      for (const job of SCHEDULED_JOB_IDS) {
        if (job === contested) continue;
        const reacquired = await lifecycle.locks.acquireExisting(leasePathOf(job));
        await reacquired.release();
      }
      const reacquiredGlobal = await lifecycle.locks.acquireExisting(lockPath);
      await reacquiredGlobal.release();
      expect(await exists(fixture.paths.manifestFile)).toBe(true);
      expect(await nodeFs.readFile(markerPath, "utf8")).toBe("");
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compensates a death at the manifest preimage move back to a byte-identical installation", async () => {
    const fixture = await initializedV2Fixture("uninstall-preserve-death");
    const request = await requestFor(fixture);
    /**
     * Every manifest file row but the allocator, whose counter this run's own reservation
     * advanced: §2.4 never rewinds it, so a compensated uninstall restores the installation
     * without restoring the one value that records the IDs it consumed.
     */
    const allocator = join(fixture.paths.stateDir, "lifecycle-id-allocator.json");
    const rows = (request.admitted?.manifest.artifacts ?? [])
      .filter((artifact) => artifact.kind !== "directory")
      .map((artifact) => artifact.path as string)
      .filter((path) => path !== allocator)
      .sort();
    expect(rows.length).toBeGreaterThan(0);
    const before = await digestsOf(rows);
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: dieAfterJournalRewriteAt("manifest", () => fixture.publishedPlans),
    });

    await expect(uninstaller.execute(request)).rejects.toThrow(SyntheticDeath);
    await recoverUninstall(fixture);

    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect(await exists(join(fixture.paths.stateDir, "redaction.key"))).toBe(true);
    for (const job of SCHEDULED_JOB_IDS) {
      expect(await exists(join(fixture.paths.stateDir, `.automation-${job}.lock`))).toBe(true);
    }
    expect(await digestsOf(rows)).toStrictEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("recovers a custom-Brain install through a context that resolves the default Brain (I2)", async () => {
    const custom = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-brain-")));
    const fixture = await initializedV2Fixture("uninstall-custom-brain", {
      env: { DEVELOPER_OS_BRAIN: custom },
    });
    const brainBefore = (await inventory(custom)).length;
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: dieAtFirst("empty_directory_removed"),
    });
    await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);

    const second = await createCommandFixture("uninstall-custom-brain-recovery", {
      root: fixture.root,
      bootstrapAvailable: true,
    });

    await recoverUninstall(fixture, { context: second.context });

    expect(await exists(manifestTombstoneOf(fixture))).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect((await inventory(custom)).length).toBe(brainBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("V2 uninstall and the state/hooks reserved runtime path (Spec 1 §6, amended 2026-09-22)", () => {
  const RECORDS = ["claude.PreToolUse.json", "codex.session_start.json", "claude.Stop.json.tmp-0123456789abcdef"];

  /** Fresh `init` creates the directory (Task 11); the fixture plants what a hook would have written. */
  async function plantHooks(fixture: CommandFixture): Promise<string> {
    const hooks = join(fixture.paths.stateDir, "hooks");
    await nodeFs.mkdir(hooks, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(hooks, 0o700);
    for (const name of RECORDS) await nodeFs.writeFile(join(hooks, name), "{}\n", { mode: 0o600 });
    return hooks;
  }

  /** One log for the guarded port's removals and the coordinator's boundaries, so their order is observable. */
  function recordingRequest(
    request: LifecycleUninstallRequestV1,
    log: string[],
  ): LifecycleUninstallRequestV1 {
    const fs = request.lifecycle.fs;
    return {
      ...request,
      lifecycle: {
        ...request.lifecycle,
        fs: {
          ...fs,
          unlinkExact: async (entry) => {
            log.push(`unlink ${entry.path}`);
            await fs.unlinkExact(entry);
          },
          rmdirExactEmpty: async (entry) => {
            log.push(`rmdir ${entry.path}`);
            await fs.rmdirExactEmpty(entry);
          },
        },
      },
    };
  }

  it("removes state/hooks after every artifact removal and before the nonce", async () => {
    const fixture = await initializedV2Fixture("uninstall-hooks-order");
    const hooks = await plantHooks(fixture);
    const log: string[] = [];
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: (boundary) => {
        log.push(`boundary ${boundary.kind}`);
      },
    });

    const result = await uninstaller.execute(recordingRequest(await requestFor(fixture), log));

    expect(result.removed).toContain(hooks);
    expect(await exists(hooks)).toBe(false);
    const hookEntries = log
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.endsWith(` ${hooks}`) || line.includes(` ${hooks}/`));
    expect(hookEntries.map(({ line }) => line).sort()).toStrictEqual(
      [...RECORDS.map((name) => `unlink ${join(hooks, name)}`), `rmdir ${hooks}`].sort(),
    );
    expect(hookEntries.at(-1)?.line).toBe(`rmdir ${hooks}`);
    const firstHook = hookEntries[0]?.index ?? -1;
    const leases = log.flatMap((line, index) => (line === "boundary lease_path_removed" ? [index] : []));
    expect(leases.length).toBeGreaterThan(0);
    expect(Math.max(...leases)).toBeLessThan(firstHook);
    const tombstone = log.indexOf(`unlink ${manifestTombstoneOf(fixture)}`);
    expect(tombstone).toBeGreaterThanOrEqual(0);
    expect(tombstone).toBeLessThan(firstHook);
    const nonce = log.indexOf(`unlink ${join(fixture.paths.stateDir, "lifecycle-install-nonce")}`);
    expect(nonce).toBeGreaterThan(hookEntries.at(-1)?.index ?? Number.MAX_SAFE_INTEGER);
    expect(await productHomeResidue(fixture)).toStrictEqual(await bookkeepingSetAndRetainedEvidence(fixture));
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("finishes removing state/hooks on the resumed run after a death partway through it", async () => {
    const fixture = await initializedV2Fixture("uninstall-hooks-resume");
    const hooks = await plantHooks(fixture);
    const request = await requestFor(fixture);
    const fs = request.lifecycle.fs;
    let fired = false;
    const dying: LifecycleUninstallRequestV1 = {
      ...request,
      lifecycle: {
        ...request.lifecycle,
        fs: {
          ...fs,
          unlinkExact: async (entry) => {
            await fs.unlinkExact(entry);
            if (fired || !entry.path.startsWith(`${hooks}/`)) return;
            fired = true;
            throw new SyntheticDeath("hook record unlink");
          },
        },
      },
    };

    await expect(new LifecycleUninstaller().execute(dying)).rejects.toThrow(/synthetic death/u);
    expect(fired).toBe(true);
    expect(await exists(hooks)).toBe(true);
    await recoverUninstall(fixture);

    expect(await exists(hooks)).toBe(false);
    expect(await exists(join(fixture.paths.stateDir, "lifecycle-install-nonce"))).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a malformed state/hooks in planning, before it allocates", async () => {
    const fixture = await initializedV2Fixture("uninstall-hooks-malformed");
    const hooks = await plantHooks(fixture);
    await nodeFs.writeFile(join(hooks, "notes.txt"), "foreign\n", { mode: 0o600 });
    const before = await allocatorCounter(fixture);

    await expect(new LifecycleUninstaller().execute(await requestFor(fixture))).rejects.toMatchObject({
      reason: "hook_records_shape",
      paths: [join(hooks, "notes.txt")],
    });

    expect(await allocatorCounter(fixture)).toBe(before);
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect(await exists(join(hooks, "notes.txt"))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("leaves state/hooks in place when the uninstall compensates", async () => {
    const fixture = await initializedV2Fixture("uninstall-hooks-compensated");
    const hooks = await plantHooks(fixture);
    const uninstaller = new LifecycleUninstaller({
      afterBoundary: dieAfterJournalRewriteAt("manifest", () => fixture.publishedPlans),
    });

    await expect(uninstaller.execute(await requestFor(fixture))).rejects.toThrow(SyntheticDeath);
    await recoverUninstall(fixture);

    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect((await nodeFs.readdir(hooks)).sort()).toStrictEqual([...RECORDS].sort());
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("V2 uninstall and D52's state/codex-ingest-home", () => {
  /** What `ingest` leaves at rest: the directory and one link to a credential outside the product home. */
  async function plantCodexIngestHome(fixture: CommandFixture, link: "symlink" | "regular"): Promise<{
    readonly home: string;
    readonly credential: string;
  }> {
    const credential = join(fixture.userHome, ".codex", "auth.json");
    await nodeFs.mkdir(join(fixture.userHome, ".codex"), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(credential, '{"synthetic":true}\n', { mode: 0o600 });
    const home = join(fixture.paths.stateDir, "codex-ingest-home");
    await nodeFs.mkdir(home, { mode: 0o700 });
    await nodeFs.chmod(home, 0o700);
    if (link === "symlink") await nodeFs.symlink(credential, join(home, "auth.json"));
    else await nodeFs.writeFile(join(home, "auth.json"), "rotated\n", { mode: 0o600 });
    return { home, credential };
  }

  it("removes the directory and its link, leaving the linked credential byte-identical", async () => {
    const fixture = await initializedV2Fixture("uninstall-codex-ingest-home");
    const { home, credential } = await plantCodexIngestHome(fixture, "symlink");

    const result = await new LifecycleUninstaller().execute(await requestFor(fixture));

    expect(result.removed).toContain(home);
    expect(await exists(home)).toBe(false);
    expect(await nodeFs.readFile(credential, "utf8")).toBe('{"synthetic":true}\n');
    expect(await productHomeResidue(fixture)).toStrictEqual(await bookkeepingSetAndRetainedEvidence(fixture));
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a regular auth.json in planning, before it allocates, and deletes nothing", async () => {
    const fixture = await initializedV2Fixture("uninstall-codex-ingest-home-regular");
    const { home } = await plantCodexIngestHome(fixture, "regular");
    const before = await allocatorCounter(fixture);

    await expect(new LifecycleUninstaller().execute(await requestFor(fixture))).rejects.toMatchObject({
      reason: "codex_ingest_home_shape",
      paths: [join(home, "auth.json")],
    });

    expect(await allocatorCounter(fixture)).toBe(before);
    expect(await nodeFs.readFile(join(home, "auth.json"), "utf8")).toBe("rotated\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("names the repair when an interrupted ingest left a run directory", async () => {
    const fixture = await initializedV2Fixture("uninstall-codex-ingest-home-abandoned-run");
    const abandoned = join(fixture.paths.stateDir, "codex-ingest-home", "run-a1b2c3");
    await nodeFs.mkdir(abandoned, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(join(abandoned, ".."), 0o700);

    const result = await runUninstall(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("codex_ingest_home_shape");
    expect(result.error.paths).toStrictEqual([abandoned]);
    expect(result.error.recovery).toBe(CODEX_INGEST_HOME_REPAIR);
    expect(await exists(abandoned)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

async function digestsOf(paths: readonly string[]): Promise<readonly string[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        return `${path}\0${createHash("sha256").update(await nodeFs.readFile(path)).digest("hex")}`;
      } catch {
        return `${path}\0absent`;
      }
    }),
  );
}

describe("V2 uninstall planning refusals", () => {
  async function syntheticFixture(
    name: string,
  ): Promise<{ readonly fixture: CommandFixture; readonly global: HeldLifecycleStableLockV1 }> {
    const fixture = await createCommandFixture(name, { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(fixture.paths.home, 0o700);
    await nodeFs.chmod(fixture.paths.stateDir, 0o700);
    return {
      fixture,
      global: {
        path: globalLockPath(fixture),
        dev: "1" as never,
        ino: "1" as never,
        release: () => Promise.resolve(),
      },
    };
  }

  function syntheticManifest(
    fixture: CommandFixture,
    artifacts: readonly { readonly path: string; readonly hash: string }[],
  ): InstallationManifestV2 {
    return {
      schemaVersion: 2,
      productVersion: "0.0.0",
      installedAt: "2026-09-21T00:00:00.000Z",
      artifacts: artifacts.map((entry) => ({
        owner: "core",
        path: entry.path,
        kind: "file",
        productVersion: "0.0.0",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        source: "generated/synthetic",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-09-21T00:00:00.000Z",
        verification: { mode: "content", installedHash: entry.hash },
      })),
    } as unknown as InstallationManifestV2;
  }

  async function syntheticRequest(
    fixture: CommandFixture,
    manifest: InstallationManifestV2,
  ): Promise<LifecycleUninstallRequestV1> {
    return {
      context: fixture.context,
      lifecycle: lifecycleOf(fixture.context),
      key: {
        productHome: parseCanonicalAbsolutePathText(fixture.paths.home),
        nonce: "a".repeat(64) as never,
      },
      admitted: { manifest } as unknown as AdmittedV2HomeV1,
      evidence: await evidenceOf(fixture),
      options: ACCEPTED,
    };
  }

  /** `count` content rows under one synthetic directory, returned in unsigned UTF-8 path order. */
  async function plantSyntheticArtifacts(
    fixture: CommandFixture,
    count: number,
  ): Promise<readonly { readonly path: string; readonly hash: string }[]> {
    const directory = join(fixture.paths.home, "synthetic");
    await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
    const artifacts: { readonly path: string; readonly hash: string }[] = [];
    for (let index = 0; index < count; index += 1) {
      const path = join(directory, `${String(index)}.json`);
      const content = `{"row":${String(index)}}\n`;
      await nodeFs.writeFile(path, content, { mode: 0o600 });
      artifacts.push({ path, hash: createHash("sha256").update(content).digest("hex") });
    }
    return artifacts.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  }

  it("refuses more than 7,936 artifact mutations before it allocates (D26, D45)", async () => {
    const { fixture, global } = await syntheticFixture("uninstall-capacity");
    expect(MAX_UNINSTALL_ARTIFACTS).toBe(7_936);
    const artifacts = await plantSyntheticArtifacts(fixture, MAX_UNINSTALL_ARTIFACTS + 1);
    const request = await syntheticRequest(fixture, syntheticManifest(fixture, artifacts));

    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toThrow(
      UninstallCapacityError,
    );
    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toMatchObject({
      code: EXIT_CODES.capabilityUnavailable,
      reason: "uninstall_artifact_capacity_exceeded",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /**
   * D45 end to end through planning: the builder's reservation block, step run and per-step
   * mutation lists for each chunk boundary, measured on the conservative pass's own shape.
   */
  it.each([
    [0, [1]],
    [1, [1]],
    [256, [256]],
    [257, [256, 1]],
    [MAX_UNINSTALL_ARTIFACTS, Array.from({ length: 31 }, () => 256)],
  ])("plans %i artifacts as consecutive F(uninstall_artifacts) steps of %j mutations", async (count, sizes) => {
    const { fixture, global } = await syntheticFixture(`uninstall-chunks-${String(count)}`);
    const artifacts = await plantSyntheticArtifacts(fixture, count);
    await plant(join(fixture.paths.stateDir, "uninstalling.json"), "");
    await plant(fixture.paths.manifestFile, "{}\n");
    const request = await syntheticRequest(fixture, syntheticManifest(fixture, artifacts));

    const preview = await new LifecycleUninstaller().preview(request, global);
    const slotCount = preview.builder.slotCount;
    expect(slotCount).toBe(4 + 2 * sizes.length);
    const ids = Array.from({ length: slotCount }, (_unused, index) => `tx_${"f".repeat(64)}_${String(index)}`);
    const { plan } = preview.builder.build(ids);

    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe(preview.variant);
    expect(lifecycleReservationOrder(plan)).toHaveLength(slotCount);
    expect(plan.participants.manifest?.participantId).toBe(ids.at(-1));
    const byId = new Map(plan.participants.foundation.map((ref) => [ref.id as string, ref]));
    const artifactRefs = plan.steps.flatMap((step) =>
      step.kind === "foundation" && step.slot === "uninstall_artifacts" ? [byId.get(step.participantId)] : [],
    );
    expect(artifactRefs.map((ref) => ref?.mutations.length)).toStrictEqual(sizes);
    expect(artifactRefs.map((ref) => ref?.id)).toStrictEqual(
      sizes.map((_size, index) => ids[3 + 2 * index]),
    );
    for (const ref of artifactRefs) {
      const compensationId = ref?.role.kind === "forward" ? ref.role.compensationId : null;
      expect(compensationId === null ? undefined : byId.get(compensationId)?.mutations.length).toBe(
        ref?.mutations.length,
      );
    }
    expect(plan.participants.manifest?.bindings.foundationTransactions.count).toBe(1 + sizes.length);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a plist row that is not §6's exact macos content row, before it allocates", async () => {
    const { fixture, global } = await syntheticFixture("uninstall-plist-row");
    const plist = join(
      fixture.userHome,
      "Library",
      "LaunchAgents",
      `com.developer-os.${SCHEDULED_JOB_IDS[0]}.plist`,
    );
    await plant(plist, "<plist/>\n");
    const request = await syntheticRequest(
      fixture,
      syntheticManifest(fixture, [
        { path: plist, hash: createHash("sha256").update("<plist/>\n").digest("hex") },
      ]),
    );

    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "uninstall_plist_row",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a directory at the activation record as recovery-required, never absent", async () => {
    const { fixture, global } = await syntheticFixture("uninstall-activation-directory");
    await nodeFs.mkdir(join(fixture.paths.stateDir, "lifecycle-activation.json"), { mode: 0o700 });
    const request = await syntheticRequest(fixture, syntheticManifest(fixture, []));

    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "activation_record_invalid",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a pre-existing redaction key tombstone", async () => {
    const { fixture, global } = await syntheticFixture("uninstall-key-tombstone");
    const stateDirectory = parseCanonicalAbsolutePathText(fixture.paths.stateDir);
    await plant(
      redactionKeyTombstonePath(
        stateDirectory,
        `lc_${"b".repeat(64)}_7` as never,
      ),
      "stale\n",
    );
    const request = await syntheticRequest(fixture, syntheticManifest(fixture, []));

    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "redaction_key_tombstone_present",
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an edited content artifact before it allocates", async () => {
    const { fixture, global } = await syntheticFixture("uninstall-edited-artifact");
    const path = join(fixture.paths.home, "edited.json");
    await plant(path, "edited\n");
    const request = await syntheticRequest(
      fixture,
      syntheticManifest(fixture, [
        { path, hash: createHash("sha256").update("original\n").digest("hex") },
      ]),
    );

    await expect(new LifecycleUninstaller().preview(request, global)).rejects.toMatchObject({
      code: EXIT_CODES.decisionRequired,
      paths: [path],
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("V2 uninstall and a manifest committed after admission (NEW-175)", () => {
  it("refuses before it reserves an id when the live manifest is not the admitted one", async () => {
    const fixture = await initializedV2Fixture("uninstall-stale-admitted-manifest");
    const request = await requestFor(fixture);
    const added = join(fixture.paths.home, "added-after-admission.json");
    await plant(added, "added\n");
    const manifest = decodeCanonicalJson(await nodeFs.readFile(fixture.paths.manifestFile), 64 * 1024 * 1024) as unknown as {
      readonly artifacts: readonly {
        readonly path: string;
        readonly kind: string;
        readonly owner: string;
        readonly verification: { readonly mode: string };
      }[];
    };
    const template = manifest.artifacts.find(
      (row) => row.kind === "file" && row.owner === "core" && row.verification.mode === "content",
    );
    if (template === undefined) throw new Error("the install recorded no core content row");
    const hash = createHash("sha256").update("added\n").digest("hex");
    const row = { ...template, path: added, verification: { ...template.verification, installedHash: hash } };
    const artifacts = [...manifest.artifacts, row].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    await nodeFs.writeFile(fixture.paths.manifestFile, encodeCanonicalJson({ ...manifest, artifacts }));
    expect((await admittedOf(fixture)).manifest.artifacts.some((artifact) => artifact.path === added)).toBe(true);
    const counter = await allocatorCounter(fixture);

    await expect(new LifecycleUninstaller().execute(request)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      recovery: "developer-os uninstall",
    });

    expect(await allocatorCounter(fixture)).toBe(counter);
    expect(await exists(fixture.paths.manifestFile)).toBe(true);
    expect(await exists(added)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("chunking artifact removals into F(uninstall_artifacts) steps (D45)", () => {
  const rows = (count: number): readonly number[] => Array.from({ length: count }, (_unused, index) => index);

  it.each([
    [0, [0]],
    [1, [1]],
    [255, [255]],
    [256, [256]],
    [257, [256, 1]],
    [512, [256, 256]],
    [513, [256, 256, 1]],
    [7_935, [...Array.from({ length: 30 }, () => 256), 255]],
    [7_936, Array.from({ length: 31 }, () => 256)],
  ])("splits %i removals into steps of %j", (count, sizes) => {
    const chunks = chunkUninstallArtifacts(rows(count), "/product");

    expect(chunks.map((chunk) => chunk.length)).toStrictEqual(sizes);
    expect(chunks.flat()).toStrictEqual(rows(count));
  });

  it("keeps the leading rows — the registry's runner leases — in the first step", () => {
    const chunks = chunkUninstallArtifacts(rows(600), "/product");

    expect(chunks[0]?.slice(0, SCHEDULED_JOB_IDS.length)).toStrictEqual(SCHEDULED_JOB_IDS.map((_, index) => index));
  });

  it.each([7_937, 10_000])("refuses %i removals with D26's capacity verdict", (count) => {
    expect(() => chunkUninstallArtifacts(rows(count), "/product")).toThrow(UninstallCapacityError);
    try {
      chunkUninstallArtifacts(rows(count), "/product");
    } catch (error) {
      expect(error).toMatchObject({
        code: EXIT_CODES.capabilityUnavailable,
        reason: "uninstall_artifact_capacity_exceeded",
        paths: ["/product"],
      });
    }
  });
});
