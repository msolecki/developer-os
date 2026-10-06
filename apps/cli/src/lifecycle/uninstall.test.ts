import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  lifecycleReservationOrder,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type {
  HeldLifecycleStableLockV1,
  InstallationManifestV2,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ScheduledJobIdV1,
} from "@developer-os/core";
import { LaunchdObserver, launchdEffectPlan, parseGeneratedLabel } from "@developer-os/platform-macos";
import type { GeneratedLaunchdLabelV1, LaunchdHostObserverV1 } from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { createCommandFixture, inventoryDigest, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import type { LifecycleEffectPortsV1 } from "./adapters.js";
import type { AdmittedV2HomeV1 } from "./admission.js";
import { createLifecycleExecutionPlanCodec, lifecycleVariantFacts, uninstallLeasePaths } from "./codecs.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import type { CliLifecycleContext } from "./context.js";
import { hostWith, scriptedLaunchd, syntheticInstalledPlist, syntheticUninstall } from "./testing.js";
import type { SyntheticInstalledPlistV1 } from "./testing.js";
import { LifecycleUninstaller } from "./uninstall.js";
import type { LifecycleUninstallRequestV1 } from "./uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const DOCTOR: ScheduledJobIdV1 = "doctor";
const UID = process.getuid?.() ?? 0;

afterEach(removeCommandFixtures);

interface SyntheticUninstallHomeV1 {
  readonly fixture: CommandFixture;
  readonly plist: SyntheticInstalledPlistV1 | null;
  readonly global: HeldLifecycleStableLockV1;
  request(launchd: LifecycleEffectPortsV1["launchd"] | null): Promise<LifecycleUninstallRequestV1>;
}

function sha256(bytes: string): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

async function plant(path: string, content: string): Promise<void> {
  await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, content, { mode: 0o600 });
}

function manifestRow(owner: "core" | "macos", path: string, content: string): InstallationManifestV2["artifacts"][number] {
  return {
    owner,
    path,
    kind: "file",
    productVersion: "0.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "generated/synthetic",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-09-23T00:00:00.000Z",
    verification: { mode: "content", installedHash: sha256(content) },
  } as unknown as InstallationManifestV2["artifacts"][number];
}

/**
 * A planted, un-`init`ed home whose synthetic manifest owns `config.toml` and — with
 * `withLaunchd` — `doctor`'s installed plist, so planning reaches `P` without a real install.
 */
async function syntheticUninstallHome(options: { readonly withLaunchd: boolean }): Promise<SyntheticUninstallHomeV1> {
  const fixture = await createCommandFixture(`uninstall-p-${String(options.withLaunchd)}`, { bootstrapAvailable: true });
  await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(fixture.paths.home, 0o700);
  await nodeFs.chmod(fixture.paths.stateDir, 0o700);
  const config = "schemaVersion = 1\n";
  await plant(fixture.paths.configFile, config);
  await plant(join(fixture.paths.stateDir, "uninstalling.json"), "");
  await plant(fixture.paths.manifestFile, "{}\n");
  // Every installed home holds the runner leases `drain_runners` locks; planning refuses one that is gone (W2-UNINST-2).
  for (const lease of uninstallLeasePaths(parseCanonicalAbsolutePathText(fixture.paths.home))) await plant(lease, "");
  const plist = options.withLaunchd
    ? syntheticInstalledPlist({ userHome: fixture.userHome, productHome: fixture.paths.home, uid: UID, job: DOCTOR })
    : null;
  if (plist !== null) await plant(plist.path, plist.bytes);
  const manifest = {
    schemaVersion: 2,
    productVersion: "0.0.0",
    installedAt: "2026-09-23T00:00:00.000Z",
    artifacts: [
      manifestRow("core", fixture.paths.configFile, config),
      ...(plist === null ? [] : [manifestRow("macos", plist.path, plist.bytes)]),
    ],
  } as unknown as InstallationManifestV2;
  const lifecycle = lifecycleOf(fixture);
  return {
    fixture,
    plist,
    global: {
      path: parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")),
      dev: "1" as never,
      ino: "1" as never,
      release: () => Promise.resolve(),
    },
    request: async (launchd) => ({
      context: fixture.context,
      lifecycle: launchd === null ? lifecycle : { ...lifecycle, effectPorts: () => ({ ...lifecycle.effectPorts(), launchd }) },
      key: {
        productHome: parseCanonicalAbsolutePathText(fixture.paths.home),
        nonce: "a".repeat(64) as LifecycleInstallNonceV1,
      },
      admitted: { manifest } as unknown as AdmittedV2HomeV1,
      evidence: await inspectBootstrapEvidenceAdmission(
        createBootstrapEvidenceInspectionRequest({
          productHome: fixture.paths.home,
          stateDirectory: fixture.paths.stateDir,
          initialRoots: [fixture.paths.home, fixture.paths.stateDir, fixture.userHome],
        }),
      ),
      options: ACCEPTED,
    }),
  };
}

/** The conservative pass's own shape: `tx_` placeholders except `P`'s `le` slot. */
function placeholderIds(slotCount: number, withLaunchd: boolean): readonly string[] {
  return Array.from({ length: slotCount }, (_unused, index) =>
    `${withLaunchd && index === slotCount - 2 ? "le" : "tx"}_${"f".repeat(64)}_${String(index)}`,
  );
}

function launchdLeaf(plan: LifecycleExecutionPlanV1): NonNullable<LifecycleExecutionPlanV1["participants"]["launchd"]> {
  const launchd = plan.participants.launchd;
  if (launchd === null) throw new Error("the plan carries no launchd leaf");
  return launchd;
}

/** A real observer on a host below the macOS floor, recording every spawn it is asked for. */
function belowFloorObserver(spawned: string[]): LifecycleEffectPortsV1["launchd"]["observer"] {
  return new LaunchdObserver({
    runner: {
      beginPhase: (id, milliseconds) => ({ id, deadlineAtMs: milliseconds, remainingMilliseconds: () => milliseconds }),
      run: (request) => {
        spawned.push(request.argv.join(" "));
        return Promise.reject(new Error("a drifted host spawned launchctl"));
      },
    },
    effectiveUid: () => UID,
    consoleUserUid: () => Promise.resolve(UID),
    host: hostWith({ productVersion: "26.6.1" }),
    inspectEmptyDirectory: () =>
      Promise.resolve({ kind: "directory" as const, ownerUid: 0, mode: 493, dev: "1", ino: "1", entryCount: 0 }),
  });
}

/** `doctor`'s plist installed and its label loaded in a scripted domain whose process tables admit `host`. */
async function presentManifestWithLoadedLabel(options: { readonly host: LaunchdHostObserverV1 }) {
  const home = await syntheticUninstallHome({ withLaunchd: true });
  const plist = home.plist;
  if (plist === null) throw new Error("the home installs a plist");
  const launchd = scriptedLaunchd({ clock: lifecycleOf(home.fixture).clock, host: options.host });
  launchd.loaded.set(DOCTOR, plist.label);
  const request = await home.request(launchd.ports);
  return { home, plist, launchd, run: () => new LifecycleUninstaller().preview(request, home.global) };
}

describe("uninstall/present_manifest (P)", () => {
  it("derives P when the manifest owns a plist and unloads before removing it", async () => {
    const home = await syntheticUninstallHome({ withLaunchd: true });
    const plist = home.plist;
    if (plist === null) throw new Error("the home installs a plist");
    const launchd = scriptedLaunchd({ clock: lifecycleOf(home.fixture).clock });
    launchd.loaded.set(DOCTOR, plist.label);

    const preview = await new LifecycleUninstaller().preview(await home.request(launchd.ports), home.global);

    expect(preview.variant).toBe("uninstall/present_manifest");
    expect(preview.removable).toContain(plist.path);
    expect(preview.preserved).not.toContain(plist.path);
    expect(preview.builder.slotCount).toBe(7);
    const { plan } = preview.builder.build(placeholderIds(preview.builder.slotCount, true));
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest");
    expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "le", "mf"]);
    expect(plan.steps.map((step) => step.kind)).toStrictEqual([
      "foundation",
      "launchd_before_files",
      "drain_runners",
      "foundation",
      "redaction_key",
      "manifest",
      "manifest",
      "redaction_key",
      "manifest",
    ]);
    expect(plan.authority.plistPaths).toStrictEqual([plist.path]);
    const leaf = launchdLeaf(plan);
    expect(leaf.entries.map((entry) => [entry.job, entry.operation])).toStrictEqual([[DOCTOR, "remove"]]);
    expect(leaf.entries[0]?.bootstrapPlists.before?.path).toBe(plist.path);
    expect(launchdEffectPlan(leaf, "before_files")?.transitions.map((transition) => [transition.label, transition.after.state]))
      .toStrictEqual([[plist.label, "unloaded"]]);
    const artifactStep = plan.steps[3];
    const artifacts = plan.participants.foundation.find(
      (ref) => artifactStep?.kind === "foundation" && ref.id === artifactStep.participantId,
    );
    expect(artifacts?.mutations.map((mutation) => [mutation.targetPath, mutation.operation])).toContainEqual([plist.path, "remove"]);
    expect(leaf.plistFiles.map((binding) => binding.participantId)).toStrictEqual([artifacts?.id]);
    expect(launchd.events).toStrictEqual([]);
  });

  it("keeps the without-launchd variant byte-identical to plan 1a", async () => {
    const home = await syntheticUninstallHome({ withLaunchd: false });

    const preview = await new LifecycleUninstaller().preview(await home.request(null), home.global);

    expect(preview.variant).toBe("uninstall/present_manifest_without_launchd");
    expect(preview.builder.slotCount).toBe(6);
    const { plan } = preview.builder.build(placeholderIds(preview.builder.slotCount, false));
    expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest_without_launchd");
    expect(plan.steps.map((step) => step.kind)).not.toContain("launchd_before_files");
    expect(plan.authority.plistPaths).toStrictEqual([]);
    expect(plan.participants.launchd).toBeNull();
    expect(plan.participants.launchdBeforeFiles).toBeNull();
  });

  it("refuses before any mutation when the observation's host is below the macOS floor", async () => {
    const home = await syntheticUninstallHome({ withLaunchd: true });
    const plist = home.plist;
    if (plist === null) throw new Error("the home installs a plist");
    const spawned: string[] = [];
    const launchd = scriptedLaunchd({ clock: lifecycleOf(home.fixture).clock });
    const request = await home.request({ ...launchd.ports, observer: belowFloorObserver(spawned) });
    const before = await inventoryDigest(home.fixture.userHome);

    const refusal: unknown = await new LifecycleUninstaller().preview(request, home.global).then(() => null, (error: unknown) => error);

    expect(String(refusal)).toContain("unsupported_launchd_distribution");
    expect(refusal).toMatchObject({ code: EXIT_CODES.capabilityUnavailable, name: "Unsupported_launchd_distributionError" });
    expect(String(refusal)).toContain(`launchctl bootout gui/${String(UID)}/${plist.label}`);
    expect(spawned).toStrictEqual([]);
    expect(await inventoryDigest(home.fixture.userHome)).toStrictEqual(before);
  });

  it("unloads a loaded label on an admitted host without certification", async () => {
    const { plist, run } = await presentManifestWithLoadedLabel({ host: hostWith() });
    const preview = await run();
    const { plan } = preview.builder.build(placeholderIds(preview.builder.slotCount, true));
    expect(launchdEffectPlan(launchdLeaf(plan), "before_files")?.transitions.map((transition) => [transition.label, transition.after.state]))
      .toStrictEqual([[plist.label, "unloaded"]]);
  });

  it("admits a later macOS and another launchctl binary, and never compares the build", async () => {
    const host = hostWith({ productVersion: "27.0", buildVersion: "26A1", paths: { "/bin/launchctl": { sha256: "c".repeat(64), size: 400000 } } });
    const { run } = await presentManifestWithLoadedLabel({ host });
    await expect(run()).resolves.toMatchObject({ variant: "uninstall/present_manifest" });
  });

  it("names the manual bootout for every label on a host below the floor", async () => {
    const { home, plist, run } = await presentManifestWithLoadedLabel({ host: hostWith({ productVersion: "26.5" }) });
    const before = await inventoryDigest(home.fixture.userHome);
    await expect(run()).rejects.toMatchObject({ reason: "unsupported_launchd_distribution", code: EXIT_CODES.capabilityUnavailable });
    await expect(run()).rejects.toThrow(/launchctl bootout gui\/\d+\//u);
    await expect(run()).rejects.toThrow(`launchctl bootout gui/${String(UID)}/${plist.label}`);
    expect(await inventoryDigest(home.fixture.userHome)).toStrictEqual(before);
  });

  it("refuses a loaded generation whose label is not the retained plist's", async () => {
    const home = await syntheticUninstallHome({ withLaunchd: true });
    const plist = home.plist;
    if (plist === null) throw new Error("the home installs a plist");
    const launchd = scriptedLaunchd({ clock: lifecycleOf(home.fixture).clock });
    const foreign = `${plist.label}0` as GeneratedLaunchdLabelV1;
    const observer: LifecycleEffectPortsV1["launchd"]["observer"] = {
      observe: () =>
        Promise.resolve({
          kind: "observed",
          jobs: [{ job: DOCTOR, state: { kind: "exact_old", label: foreign, generation: parseGeneratedLabel(plist.label).generation } }],
        }),
    } as unknown as LifecycleEffectPortsV1["launchd"]["observer"];

    await expect(
      new LifecycleUninstaller().preview(await home.request({ ...launchd.ports, observer }), home.global),
    ).rejects.toMatchObject({ reason: "launchd_live_state_third_state" });
  });

  it("refuses an edited installed plist as a decision, before it plans", async () => {
    const home = await syntheticUninstallHome({ withLaunchd: true });
    const plist = home.plist;
    if (plist === null) throw new Error("the home installs a plist");
    await nodeFs.writeFile(plist.path, `${plist.bytes}\n`, { mode: 0o600 });
    const launchd = scriptedLaunchd({ clock: lifecycleOf(home.fixture).clock });

    await expect(new LifecycleUninstaller().preview(await home.request(launchd.ports), home.global)).rejects.toMatchObject({
      code: EXIT_CODES.decisionRequired,
    });
  });

  it("admits the synthetic P plan through the CLI codec with `le` before `mf`", () => {
    const productHome = parseCanonicalAbsolutePathText("/product");
    const nonce = parseLowerHexSha256("7a".repeat(32));
    const synthetic = syntheticUninstall(productHome, nonce, 1n, undefined, { withLaunchd: true });
    const codec = createLifecycleExecutionPlanCodec({ productHome, nonce });

    expect(codec.validate(JSON.parse(codec.encode(synthetic.plan)) as unknown)).toStrictEqual(synthetic.plan);
    expect(validateLifecyclePlanGrammar(synthetic.plan, lifecycleVariantFacts(synthetic.plan))).toBe("uninstall/present_manifest");
    expect(lifecycleReservationOrder(synthetic.plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "le", "mf"]);
    expect(synthetic.plan.steps[synthetic.artifactsStep]).toMatchObject({ kind: "foundation", slot: "uninstall_artifacts" });
    expect(synthetic.plan.steps[synthetic.commitAbsenceStep]).toMatchObject({ kind: "manifest", transition: "commit_absence" });
  });
});
