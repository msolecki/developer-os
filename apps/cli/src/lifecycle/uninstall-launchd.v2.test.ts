import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, hashBytes, lifecycleReservationOrder, parseCanonicalAbsolutePathText, validateLifecyclePlanGrammar } from "@developer-os/core";
import type {
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleCoordinatorStore,
  ScheduledJobIdV1,
} from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { runInit } from "../commands/init.js";
import { UninstallRefusal } from "../commands/uninstall.js";
import { createCommandFixture, exists, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import { admitInstalledV2Home } from "./admission.js";
import { lifecycleVariantFacts } from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { coordinatorNonceOf, lifecycleHomeKeyFromAdmission, residueFrom } from "./context.js";
import type { CliLifecycleContext } from "./context.js";
import { scriptedLaunchd, syntheticInstalledPlist } from "./testing.js";
import type { ScriptedLaunchdV1, SyntheticInstalledPlistV1 } from "./testing.js";
import {
  createUninstallAdapters,
  createUninstallParticipants,
  LifecycleUninstaller,
  releaseUninstallHolds,
} from "./uninstall.js";
import type { LifecycleUninstallRequestV1, UninstallBoundaryV1, UninstallHoldsV1 } from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const DOCTOR: ScheduledJobIdV1 = "doctor";
const UID = process.getuid?.() ?? 0;

class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

afterEach(removeCommandFixtures);

/**
 * One real V2 home with `doctor` installed the way plan 1b Task 17's `automation enable` leaves
 * it — a private canonical plist under the user's LaunchAgents, its `macos` content row and a
 * loaded generated label — in an injected launchd domain. Task 17 lands after this task, so the
 * installation is planted rather than enabled, and the row is added to the admitted manifest
 * rather than published: confined admission does not yet grant §6's external plist rows.
 */
interface LaunchdHomeV1 {
  readonly fixture: CommandFixture;
  readonly plist: SyntheticInstalledPlistV1;
  readonly launchd: ScriptedLaunchdV1;
  readonly lifecycle: CliLifecycleContext;
  readonly plans: LifecycleExecutionPlanV1[];
  readonly gitHead: string;
  request(): Promise<LifecycleUninstallRequestV1>;
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

async function launchdHome(
  name: string,
  beforeBootout?: (label: string) => void | Promise<void>,
  launchctl?: "scripted",
  legacy = false,
): Promise<LaunchdHomeV1> {
  const fixture = await createCommandFixture(name, { bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, ACCEPTED);
  if (!initialized.ok) throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  const gitHead = join(fixture.paths.brain, ".git", "HEAD");
  await nodeFs.mkdir(join(fixture.paths.brain, ".git"), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(gitHead, "ref: refs/heads/main\n", { mode: 0o600 });

  const plist = syntheticInstalledPlist({ userHome: fixture.userHome, productHome: fixture.paths.home, uid: UID, job: DOCTOR, legacy });
  await nodeFs.mkdir(join(plist.path, ".."), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(plist.path, plist.bytes, { mode: 0o600 });

  const base = fixture.context.lifecycle;
  if (base === undefined) throw new Error("the fixture composed no lifecycle context");
  const launchd = scriptedLaunchd({
    clock: base.clock,
    ...(beforeBootout === undefined ? {} : { beforeBootout }),
    ...(launchctl === undefined ? {} : { launchctl }),
  });
  launchd.loaded.set(DOCTOR, plist.label);
  const plans: LifecycleExecutionPlanV1[] = [];
  const ports = { ...base.effectPorts(), launchd: launchd.ports };
  const lifecycle: CliLifecycleContext = {
    ...base,
    effectPorts: () => ports,
    store: (key) => recordingStore(base.store(key), plans),
  };
  const row = {
    owner: "macos",
    path: plist.path,
    kind: "file",
    productVersion: "0.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "generated/launchd",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-09-23T00:00:00.000Z",
    verification: { mode: "content", installedHash: hashBytes(new TextEncoder().encode(plist.bytes)) },
  } as unknown as InstallationManifestV2["artifacts"][number];

  return {
    fixture,
    plist,
    launchd,
    lifecycle,
    plans,
    gitHead,
    request: async () => {
      const admitted = await admitInstalledV2Home({
        fs: lifecycle.fs,
        paths: fixture.paths,
        manifestAdmission: manifestAdmissionFor(fixture.paths, []),
        effectiveUid: lifecycle.effectiveUid,
      });
      return {
        context: fixture.context,
        lifecycle,
        key: lifecycleHomeKeyFromAdmission(admitted, fixture.paths),
        admitted: { ...admitted, manifest: { ...admitted.manifest, artifacts: [...admitted.manifest.artifacts, row] } },
        evidence: await evidenceOf(fixture),
        options: ACCEPTED,
      };
    },
  };
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

/** The journal rewrite that advances past `stepKind` is the durable record of that step. */
function dieAfterJournalRewriteAt(
  stepKind: LifecycleExecutionPlanV1["steps"][number]["kind"],
  plansOf: () => readonly LifecycleExecutionPlanV1[],
): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== "journal_rewritten") return;
    if (plansOf().at(-1)?.steps[boundary.nextStep - 1]?.kind !== stepKind) return;
    fired = true;
    throw new SyntheticDeath(stepKind);
  };
}

/** Dies on the journal rewrite past the first `foundation` step that follows `P`: the plist is already removed. */
function dieAfterPlistRemoval(plansOf: () => readonly LifecycleExecutionPlanV1[]): (boundary: UninstallBoundaryV1) => void {
  let fired = false;
  return (boundary) => {
    if (fired || boundary.kind !== "journal_rewritten") return;
    const steps = plansOf().at(-1)?.steps ?? [];
    const p = steps.findIndex((step) => step.kind === "launchd_before_files");
    const done = boundary.nextStep - 1;
    if (p < 0 || done <= p || steps[done]?.kind !== "foundation") return;
    fired = true;
    throw new SyntheticDeath("foundation after P");
  };
}

async function recoverUninstall(home: LaunchdHomeV1): Promise<void> {
  const { fixture, lifecycle } = home;
  const productHome = parseCanonicalAbsolutePathText(fixture.paths.home);
  const nonce = await coordinatorNonceOf(lifecycle.fs, productHome);
  if (nonce === null) throw new Error("the ledger holds no lc_ leaf to recover from");
  const evidence = await evidenceOf(fixture);
  const request: LifecycleUninstallRequestV1 = {
    context: fixture.context,
    lifecycle,
    key: { productHome, nonce },
    admitted: null,
    evidence,
    options: ACCEPTED,
  };
  const holds: UninstallHoldsV1 = {
    global: await lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock"))),
    leases: [],
  };
  try {
    const adapters = createUninstallAdapters({ request, ...createUninstallParticipants(request), holds });
    const global = holds.global;
    if (global === null) throw new Error("unreachable");
    const recovered = await lifecycle.recovery(request.key, adapters, residueFrom(evidence)).recover(global, { resumeUninstall: true });
    holds.global = recovered.global;
  } finally {
    await releaseUninstallHolds(holds);
  }
}

async function allocatorCounter(fixture: CommandFixture): Promise<string> {
  const value = JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, "lifecycle-id-allocator.json"), "utf8"),
  ) as { readonly nextCounter: string };
  return value.nextCounter;
}

describe("uninstall/present_manifest planning refusals before any ID is reserved", () => {
  async function refusalOf(home: LaunchdHomeV1): Promise<unknown> {
    return new LifecycleUninstaller().execute(await home.request()).then(() => null, (error: unknown) => error);
  }

  it("refuses a missing config.toml as decision-required, naming it (W2-UNINST-5)", async () => {
    const home = await launchdHome("uninstall-launchd-no-config");
    await nodeFs.rm(home.fixture.paths.configFile);
    const counter = await allocatorCounter(home.fixture);

    const refusal = await refusalOf(home);

    expect(refusal).toBeInstanceOf(UninstallRefusal);
    expect(refusal).toMatchObject({ code: EXIT_CODES.decisionRequired, paths: [home.fixture.paths.configFile] });
    expect(home.plans).toStrictEqual([]);
    expect(home.launchd.events).toStrictEqual([]);
    expect(await allocatorCounter(home.fixture)).toBe(counter);
    expect(await exists(home.plist.path)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a missing runner lease with its re-create step, before the marker and the bootout (W2-UNINST-2)", async () => {
    const home = await launchdHome("uninstall-launchd-no-lease");
    const lease = join(home.fixture.paths.stateDir, ".automation-doctor.lock");
    await nodeFs.rm(lease);
    const counter = await allocatorCounter(home.fixture);

    const refusal = await refusalOf(home);

    expect(refusal).toBeInstanceOf(UninstallRefusal);
    expect(refusal).toMatchObject({ code: EXIT_CODES.recoveryRequired, paths: [lease] });
    expect((refusal as UninstallRefusal).recovery).toContain(lease);
    expect(home.plans).toStrictEqual([]);
    expect(home.launchd.events).toStrictEqual([]);
    expect(home.launchd.loaded.size).toBe(1);
    expect(await allocatorCounter(home.fixture)).toBe(counter);
    expect(await nodeFs.readdir(join(home.fixture.paths.stagingDir, "lifecycle"))).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("uninstall/present_manifest with an installed launchd job (plan 1b Task 18)", () => {
  it("unloads the installed label before its plist is removed and preserves the Brain and its .git", async () => {
    const marker: string[] = [];
    const plistPresentAtBootout: boolean[] = [];
    let home: LaunchdHomeV1 | null = null;
    home = await launchdHome("uninstall-launchd", async () => {
      if (home === null) return;
      plistPresentAtBootout.push(await exists(home.plist.path));
      marker.push(await nodeFs.readFile(join(home.fixture.paths.stateDir, "uninstalling.json"), "utf8"));
    });

    await new LifecycleUninstaller().execute(await home.request());

    const plan = home.plans.at(-1);
    if (plan === undefined) throw new Error("no published plan");
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest");
    expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "le", "mf"]);
    expect(plan.authority.plistPaths).toStrictEqual([home.plist.path]);
    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`]);
    expect(plistPresentAtBootout).toStrictEqual([true]);
    expect(marker[0]).toContain(`"coordinatorId":"${plan.id}"`);
    expect(home.launchd.loaded.size).toBe(0);
    expect(await exists(home.plist.path)).toBe(false);
    expect(await exists(home.fixture.paths.manifestFile)).toBe(false);
    expect(await nodeFs.readFile(home.gitHead, "utf8")).toBe("ref: refs/heads/main\n");
    expect(await nodeFs.readdir(join(home.fixture.paths.stateDir, "launchd-effect-journals"))).toStrictEqual([]);
    expect(await nodeFs.readdir(join(home.fixture.paths.stagingDir, "lifecycle"))).toStrictEqual([]);
    expect(await exists(join(home.fixture.paths.stateDir, ".lifecycle.lock"))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("removes a pre-NEW-144 nine-argument plist and unloads its label", async () => {
    const home = await launchdHome("uninstall-launchd-legacy", undefined, "scripted", true);
    expect(home.plist.bytes).not.toContain("<string>/usr/local/bin/node</string>");

    await new LifecycleUninstaller().execute(await home.request());

    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`]);
    expect(home.launchd.loaded.size).toBe(0);
    expect(await exists(home.plist.path)).toBe(false);
    expect(await exists(home.fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compensates a death before P without touching the loaded label", async () => {
    const home = await launchdHome("uninstall-launchd-before-p");
    const died = new LifecycleUninstaller({ afterBoundary: dieAfterJournalRewriteAt("foundation", () => home.plans) });

    await expect(died.execute(await home.request())).rejects.toThrow(SyntheticDeath);
    await recoverUninstall(home);

    expect(home.launchd.events).toStrictEqual([]);
    expect(home.launchd.loaded.get(DOCTOR)).toBe(home.plist.label);
    expect(await nodeFs.readFile(home.plist.path, "utf8")).toBe(home.plist.bytes);
    expect(await exists(home.fixture.paths.manifestFile)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compensates a death after P by re-bootstrapping the label from its retained plist", async () => {
    const home = await launchdHome("uninstall-launchd-after-p");
    const died = new LifecycleUninstaller({ afterBoundary: dieAfterJournalRewriteAt("launchd_before_files", () => home.plans) });

    await expect(died.execute(await home.request())).rejects.toThrow(SyntheticDeath);
    expect(home.launchd.loaded.has(DOCTOR)).toBe(false);
    await recoverUninstall(home);

    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`, `bootstrap ${home.plist.label}`]);
    expect(home.launchd.loaded.get(DOCTOR)).toBe(home.plist.label);
    expect(await nodeFs.readFile(home.plist.path, "utf8")).toBe(home.plist.bytes);
    expect(await exists(home.fixture.paths.manifestFile)).toBe(true);
    expect(await nodeFs.readdir(join(home.fixture.paths.stateDir, "launchd-effect-journals"))).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("recovers a death after the plist was removed by re-bootstrapping it by path from the re-created inode (NEW-138, D82)", async () => {
    const home = await launchdHome("uninstall-launchd-after-removal", undefined, "scripted");
    const before = await nodeFs.stat(home.plist.path);
    const died = new LifecycleUninstaller({ afterBoundary: dieAfterPlistRemoval(() => home.plans) });

    await expect(died.execute(await home.request())).rejects.toThrow(SyntheticDeath);
    expect(await exists(home.plist.path)).toBe(false);
    await recoverUninstall(home);

    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`, `bootstrap ${home.plist.label}`]);
    expect(home.launchd.loaded.get(DOCTOR)).toBe(home.plist.label);
    expect(await nodeFs.readFile(home.plist.path, "utf8")).toBe(home.plist.bytes);
    expect((await nodeFs.stat(home.plist.path)).ino).not.toBe(before.ino);
    expect(await exists(home.fixture.paths.manifestFile)).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  /** Dies after the plist was removed, then dies again after the compensating bootstrap loaded the label. */
  async function diedBetweenBootstrapAndPostCheck(name: string): Promise<LaunchdHomeV1> {
    const home = await launchdHome(name, undefined, "scripted");
    const died = new LifecycleUninstaller({ afterBoundary: dieAfterPlistRemoval(() => home.plans) });
    await expect(died.execute(await home.request())).rejects.toThrow(SyntheticDeath);
    home.launchd.faults.dieAfterBootstrap = true;
    await expect(recoverUninstall(home)).rejects.toThrow(/before the post-check/u);
    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`, `bootstrap ${home.plist.label}`]);
    expect(home.launchd.loaded.get(DOCTOR)).toBe(home.plist.label);
    expect(home.launchd.prints).toStrictEqual([]);
    return home;
  }

  it("verifies a label left loaded by a death before its post-check when recovery resumes (NEW-138 round 3)", async () => {
    const home = await diedBetweenBootstrapAndPostCheck("uninstall-launchd-resume-verify");
    await recoverUninstall(home);

    expect(home.launchd.prints).toStrictEqual([`gui/${String(UID)}/${home.plist.label}`]);
    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`, `bootstrap ${home.plist.label}`]);
    expect(home.launchd.loaded.get(DOCTOR)).toBe(home.plist.label);
    expect(await nodeFs.readFile(home.plist.path, "utf8")).toBe(home.plist.bytes);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("boots out a label left loaded by a death before its post-check when its plist was swapped meanwhile (NEW-138 round 3)", async () => {
    const home = await diedBetweenBootstrapAndPostCheck("uninstall-launchd-resume-swapped");
    const forged = Buffer.from(home.plist.bytes);
    forged[forged.byteLength - 2] = 0x58;
    await nodeFs.writeFile(`${home.plist.path}.swap`, forged, { mode: 0o600 });
    await nodeFs.rename(`${home.plist.path}.swap`, home.plist.path);

    await expect(recoverUninstall(home)).rejects.toMatchObject({ reason: "launchd_bootstrap_plist_changed" });

    expect(home.launchd.events).toStrictEqual([`bootout ${home.plist.label}`, `bootstrap ${home.plist.label}`, `bootout ${home.plist.label}`]);
    expect(home.launchd.loaded.has(DOCTOR)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
