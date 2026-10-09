import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeCanonicalJson, EXIT_CODES, parseStableSemver } from "@developer-os/core";
import type { InstallationManifestV2 } from "@developer-os/core";
import { runDoctorReport } from "@developer-os/cli/dist/commands/doctor.js";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";
import { runUpdate } from "@developer-os/cli/dist/commands/update/index.js";
import type { UpdateInvocationV1 } from "@developer-os/cli/dist/commands/update/index.js";
import { exists, inventoryDigest, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import type { CliContext } from "@developer-os/cli/dist/context.js";
import type { UpdateCapacityObservationV1 } from "@developer-os/cli/dist/update/planning.js";
import { installUpdatableHome, SYNTHETIC_ARCHITECTURES } from "@developer-os/cli/dist/update/testing.js";
import type { SyntheticArchitectureV1, UpdatableHomeV1 } from "@developer-os/cli/dist/update/testing.js";

/**
 * Spec 2 §12's "complete lifecycle works" row on the synthetic release (D72 P7(f), D84 K6): a real
 * `init` from the prefix's first keg, then preview and apply, a `brew upgrade` and a second apply
 * that retires the first rollback set, rollback, reapply, and uninstall — for both `arm64` and
 * `x64`. The update source is a real keg under a fixture prefix, resolved and admitted by the
 * production code through the fixed-path seam; only the planner is the world's. `--apply` runs the
 * production ports with the fallback handoff bound from the admitted keg (K3). Every successful
 * apply and rollback refreshes the attached Claude and Codex workflows from the newly active
 * release (K8): 1.2.0 changes the triage skill, a rollback restores it, and the plugin hooks stay
 * byte-identical across every swap (C3). The Git and automation leg
 * joins with NEW-113; the real-release half waits for A16.
 */

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const LIFECYCLE_TIMEOUT_MS = 900_000;
const BRAIN_NOTE = "notes/kept-through-the-lifecycle.md";
const BRAIN_NOTE_BYTES = "# Kept\n\nThe product comes and goes; this note stays.\n";
const VENDOR_FILE = ".codex/unrelated-vendor-state.toml";
const VENDOR_FILE_BYTES = "model = \"unrelated\"\n";
const PINNED_CAPACITY = {
  availableBytes: "1099511627776",
  availableEntries: "10000000",
  reservationGranularityBytes: "4096",
} as unknown as UpdateCapacityObservationV1;

afterEach(removeCommandFixtures);

interface Lifecycle {
  readonly home: UpdatableHomeV1;
  readonly context: CliContext;
  readonly manifests: InstallationManifestV2[];
}

async function manifestOf(home: UpdatableHomeV1): Promise<InstallationManifestV2> {
  return decodeCanonicalJson(await nodeFs.readFile(home.fixture.paths.manifestFile), 1 << 26) as unknown as InstallationManifestV2;
}

async function run(lifecycle: Lifecycle, invocation: UpdateInvocationV1): Promise<unknown> {
  const result = await runUpdate(lifecycle.context, invocation);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  lifecycle.manifests.push(await manifestOf(lifecycle.home));
  return result.data;
}

async function start(architecture: SyntheticArchitectureV1, label = "lifecycle"): Promise<Lifecycle> {
  const home = await installUpdatableHome(`e2e-release-update-${label}-${architecture}`, architecture, { instructions: true });
  const { paths, userHome } = home.fixture;
  await nodeFs.mkdir(join(paths.brain, "notes"), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(join(paths.brain, BRAIN_NOTE), BRAIN_NOTE_BYTES, { mode: 0o600 });
  await nodeFs.mkdir(join(userHome, ".codex"), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(join(userHome, VENDOR_FILE), VENDOR_FILE_BYTES, { mode: 0o600 });
  return { home, context: { ...home.fixture.context, update: home.update() }, manifests: [await manifestOf(home)] };
}

function bundleRoot(lifecycle: Lifecycle, version: string): string {
  return join(lifecycle.home.fixture.paths.home, "releases", version, `darwin-${lifecycle.home.world.architecture}`);
}

async function activeVersion(lifecycle: Lifecycle): Promise<string> {
  return (await lifecycle.home.update().readHome()).active.version;
}

const ENTRY = "bin/cli";

/**
 * C1: after every successful command each instruction row carries the active release's stamp, which
 * the refresh writes, for Claude and Codex alike (each owner's set non-empty).
 */
function instructionPaths(manifest: InstallationManifestV2): readonly string[] {
  for (const owner of ["claude", "codex"]) expect(manifest.artifacts.filter((row) => row.kind === "instruction" && row.owner === owner).length).toBeGreaterThan(0);
  return manifest.artifacts.flatMap((row) => {
    if (row.kind !== "instruction") return [];
    expect(row.productVersion).toBe(manifest.productVersion);
    return [row.path];
  });
}

/** The triage skill the refresh re-renders from the active release, and the plugin hooks that must survive every swap. */
async function rendered(lifecycle: Lifecycle): Promise<{ readonly skill: string; readonly hooks: string }> {
  const rows = (await manifestOf(lifecycle.home)).artifacts;
  const skill = rows.find((row) => row.kind === "instruction" && row.owner === "claude" && row.path.endsWith("/SKILL.md"));
  const hooks = rows.find((row) => row.owner === "claude" && row.path.endsWith("/hooks/hooks.json"));
  if (skill === undefined || hooks === undefined) throw new Error("the home has no rendered triage skill or hooks");
  return { skill: await nodeFs.readFile(skill.path, "utf8"), hooks: await nodeFs.readFile(hooks.path, "utf8") };
}

/** D54: the re-anchored manifest keeps doctor from refusing an updated or rolled-back home; it may warn, never fail. */
async function expectDoctorAdmits(lifecycle: Lifecycle): Promise<void> {
  const report = await runDoctorReport(lifecycle.home.fixture.context);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.filter((finding) => finding.status === "fail")).toEqual([]);
}

/** C3: the hooks' Node, through the fixture table's fixed `opt` link. */
function optNode(lifecycle: Lifecycle): string {
  return join(lifecycle.home.world.prefix, "opt", "developer-os", "libexec", "fallback", "bundle", "bin", "runtime");
}

/** The hooks name the opt Node, and it runs whichever keg `world.install` linked. */
function expectHooksRun(lifecycle: Lifecycle, hooks: string): void {
  expect(hooks).toContain(`${optNode(lifecycle)} ${join(lifecycle.home.fixture.paths.home, "bin", "developer-os.mjs")} `);
  expect(spawnSync(optNode(lifecycle), ["-e", "process.exit(0)"]).status).toBe(0);
}

/** NEW-163 B: the CLI the entrypoint script would load, resolved the way the script does (active record, then its retained manifest). */
async function entrypointTarget(lifecycle: Lifecycle): Promise<string> {
  const { stateDir } = lifecycle.home.fixture.paths;
  const active = JSON.parse(await nodeFs.readFile(join(stateDir, "active-release.json"), "utf8")) as { bundleRoot: string; bundleManifestHash: string };
  const manifest = JSON.parse(await nodeFs.readFile(join(stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`), "utf8")) as { entrypoint?: string };
  return join(active.bundleRoot, manifest.entrypoint ?? "node_modules/@developer-os/cli/dist/bin.js");
}

async function expectEntrypointFollowsActive(lifecycle: Lifecycle): Promise<void> {
  const target = await entrypointTarget(lifecycle);
  expect(target).toBe(`${(await lifecycle.home.update().readHome()).active.bundleRoot}/${ENTRY}`);
  // The real script (owner, mode and hash checks included) loads a stub CLI at that target; the published bytes are restored.
  const original = await nodeFs.readFile(target);
  await nodeFs.writeFile(target, `process.stdout.write(${JSON.stringify(`marker:${target}\n`)});\n`);
  try {
    // Production runs the script on the keg's own Node, so `process.arch` is the release's architecture
    // (an x64 keg's Node runs under Rosetta). The host Node stands in for it here, so the harness
    // reports the world's architecture, the way the fixture's platform does for the launcher and the refresh.
    const arch = `data:text/javascript,Object.defineProperty(process,"arch",{value:${JSON.stringify(lifecycle.home.world.architecture)}})`;
    const result = spawnSync(process.execPath, ["--import", arch, join(lifecycle.home.fixture.paths.home, "bin", "developer-os.mjs"), "--version"], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`marker:${target}\n`);
  } finally {
    await nodeFs.writeFile(target, original);
  }
}

describe("the synthetic release lifecycle (Spec 2 §12, D72 P7(f))", () => {
  it.each(SYNTHETIC_ARCHITECTURES)("installs, previews, applies, rolls back, reapplies and uninstalls on %s", async (architecture) => {
    const lifecycle = await start(architecture);
    const { world, fixture, installed } = lifecycle.home;
    expect(installed.architecture).toBe(architecture);
    expect(installed.bundleRoot).toBe(bundleRoot(lifecycle, "1.0.0"));

    // Two previews of the same update are byte-identical and write nothing. The free space the
    // preview reports is pinned: a real disk's changes between the two calls is not the product's.
    const before = await inventoryDigest(fixture.root);
    const pinned = { ...lifecycle, context: { ...lifecycle.context, update: { ...lifecycle.home.update(), capacity: () => Promise.resolve(PINNED_CAPACITY) } } };
    const preview = { kind: "update", version: parseStableSemver("1.1.0"), apply: false, json: true } as const;
    const first = await run(pinned, preview);
    const second = await run(pinned, preview);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(await inventoryDigest(fixture.root)).toEqual(before);

    const applied = await run(lifecycle, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });
    expect(applied).toMatchObject({ outcome: "applied", rollbackAvailable: true, active: { version: "1.1.0", architecture, bundleRoot: bundleRoot(lifecycle, "1.1.0") } });
    const attached = instructionPaths(lifecycle.manifests[0] as InstallationManifestV2);
    expect(instructionPaths(await manifestOf(lifecycle.home))).toStrictEqual(attached);
    const at110 = await rendered(lifecycle);
    expect(at110.skill).toContain("\nTriage.\n");
    expectHooksRun(lifecycle, at110.hooks);
    await expectDoctorAdmits(lifecycle);
    const verifier = world.releases.get("1.1.0")?.bundles.get(architecture)?.files.get("bin/verifier");
    expect(verifier).toBeDefined();
    expect(new Uint8Array(await nodeFs.readFile(join(bundleRoot(lifecycle, "1.1.0"), "bin", "verifier")))).toEqual(verifier);
    expect((await lifecycle.home.update().readHome()).rollback?.previous.version).toBe("1.0.0");
    await expectEntrypointFollowsActive(lifecycle);

    // `brew upgrade` lands 1.2.0's keg; a second update retires the first rollback set with the release it retained.
    await world.install("1.2.0");
    expect(await run(lifecycle, { kind: "update", version: null, apply: true, json: true })).toMatchObject({ outcome: "applied", active: { version: "1.2.0" } });
    const at120 = await rendered(lifecycle);
    expect(at120.skill).toContain("Triage, then reproduce.");
    expect(at120.hooks).toBe(at110.hooks);
    expectHooksRun(lifecycle, at120.hooks);
    expect(await exists(bundleRoot(lifecycle, "1.0.0"))).toBe(false);
    expect((await lifecycle.home.update().readHome()).rollback?.previous.version).toBe("1.1.0");
    await expectEntrypointFollowsActive(lifecycle);

    // Rollback is local evidence only: no `readPackageSource` call, no planner run, trust unchanged.
    const trustFile = join(fixture.paths.stateDir, "release-trust.json");
    const trust = await nodeFs.readFile(trustFile);
    const requests = world.requests.length;
    const plannerRuns = world.plannerRuns.length;
    const rollbackPreview = await run(lifecycle, { kind: "rollback", apply: false, json: true });
    expect(rollbackPreview).toMatchObject({ outcome: "rollback_preview", plan: { current: { version: "1.2.0" }, target: { version: "1.1.0" } } });
    expect(await run(lifecycle, { kind: "rollback", apply: true, json: true })).toMatchObject({ outcome: "rolled_back", rollbackAvailable: false, active: { version: "1.1.0" } });
    expect(world.requests).toHaveLength(requests);
    expect(world.plannerRuns).toHaveLength(plannerRuns);
    expect(await nodeFs.readFile(trustFile)).toEqual(trust);
    expect(instructionPaths(await manifestOf(lifecycle.home))).toStrictEqual(attached);
    expect(await exists(bundleRoot(lifecycle, "1.2.0"))).toBe(false);
    expect(await rendered(lifecycle)).toStrictEqual(at110);
    expectHooksRun(lifecycle, at110.hooks);
    await expectDoctorAdmits(lifecycle);
    expect((await lifecycle.home.update().readHome()).rollback).toBeNull();
    await expectEntrypointFollowsActive(lifecycle);

    expect(await run(lifecycle, { kind: "update", version: null, apply: true, json: true })).toMatchObject({ outcome: "applied", active: { version: "1.2.0" } });
    expect(await activeVersion(lifecycle)).toBe("1.2.0");
    expect(await rendered(lifecycle)).toStrictEqual(at120);
    await expectEntrypointFollowsActive(lifecycle);

    // Spec 2 §13.3 residual 9 (A8): no manifest this lifecycle published holds a symlink artifact,
    // and every one carries the attached instruction rows at its own release's stamp (C1, K8).
    expect(lifecycle.manifests.length).toBeGreaterThan(0);
    for (const manifest of lifecycle.manifests) {
      expect(manifest.artifacts.filter((row) => row.kind === "symlink")).toEqual([]);
      expect(instructionPaths(manifest)).toStrictEqual(attached);
    }

    const requestsBeforeUninstall = world.requests.length;
    const removed = await runUninstall(fixture.context, ACCEPTED);
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    expect(world.requests).toHaveLength(requestsBeforeUninstall);
    expect(await nodeFs.readFile(join(fixture.paths.brain, BRAIN_NOTE), "utf8")).toBe(BRAIN_NOTE_BYTES);
    expect(await nodeFs.readFile(join(fixture.userHome, VENDOR_FILE), "utf8")).toBe(VENDOR_FILE_BYTES);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(join(fixture.paths.home, "releases"))).toBe(false);
    expect(await exists(join(fixture.paths.home, "rollback"))).toBe(false);
  }, LIFECYCLE_TIMEOUT_MS);

  // Review Focus 2: `brew cleanup` deletes the keg; the active and the rollback release live in `releases/<version>` alone.
  it.each(SYNTHETIC_ARCHITECTURES)("(d) rolls back after the keg is removed (brew cleanup) on %s", async (architecture) => {
    const lifecycle = await start(architecture, "cleanup");
    const attached = instructionPaths(lifecycle.manifests[0] as InstallationManifestV2);
    await run(lifecycle, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: false });
    await nodeFs.rm(lifecycle.home.world.prefix, { recursive: true, force: true });
    const requests = lifecycle.home.world.requests.length;
    // A fresh process: no keg was read in it, so `--apply` composes with the active release's fallback handoff.
    const fresh = { ...lifecycle, context: { ...lifecycle.home.fixture.context, update: lifecycle.home.update() } };
    await run(fresh, { kind: "rollback", apply: true, json: false });
    // F4's first rollback: back onto the release `init` copied from the (now deleted) first keg.
    expect(await activeVersion(lifecycle)).toBe("1.0.0");
    expect((await manifestOf(lifecycle.home)).productVersion).toBe("1.0.0");
    expect(lifecycle.home.world.requests).toHaveLength(requests);
    expect(instructionPaths(await manifestOf(lifecycle.home))).toStrictEqual(attached);
    // With no keg the hooks' Node is gone (the accepted residual); the skill is 1.0.0's again and the hooks still name the opt path.
    const restored = await rendered(lifecycle);
    expect(restored.skill).toContain("\nTriage.\n");
    expect(restored.hooks).toContain(optNode(lifecycle));
    await expectEntrypointFollowsActive(lifecycle);
  }, LIFECYCLE_TIMEOUT_MS);

  // Review Focus 4: the swap stands, the update exits with the refresh's code, and doctor warns until a refresh succeeds.
  it.each(SYNTHETIC_ARCHITECTURES)("(e) keeps the swap and exits with the refresh's code when the refresh refuses (K8) on %s", async (architecture) => {
    const lifecycle = await start(architecture, "refresh-refused");
    // An override skill with no SKILL.md: user data the update admits, which §12.1 refuses at render (exit 2).
    const override = join(lifecycle.home.fixture.paths.home, "instructions", "claude", "skills", "broken");
    await nodeFs.mkdir(override, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(join(override, "notes.md"), "no SKILL.md here\n", { mode: 0o600 });

    const result = await runUpdate(lifecycle.context, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: true });

    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.invalidInput, error: { kind: "workflows_not_refreshed", message: "workflows not refreshed: run developer-os init" } });
    expect(await activeVersion(lifecycle)).toBe("1.1.0");
    const rows = (await manifestOf(lifecycle.home)).artifacts.filter((row) => row.kind === "instruction");
    for (const owner of ["claude", "codex"]) expect(rows.filter((row) => row.owner === owner).length).toBeGreaterThan(0);
    expect(rows.every((row) => row.productVersion === "1.0.0")).toBe(true);
    await nodeFs.rm(override, { recursive: true });
    const instructions = (await runDoctorReport(lifecycle.home.fixture.context)).checks.find((finding) => finding.id === "instructions");
    expect(instructions).toMatchObject({ status: "warn", message: expect.stringContaining("workflows not refreshed") as unknown });

    expect(await lifecycle.home.update().refresh?.()).toBe(EXIT_CODES.success);
    expect((await manifestOf(lifecycle.home)).artifacts.filter((row) => row.kind === "instruction").every((row) => row.productVersion === "1.1.0")).toBe(true);
  }, LIFECYCLE_TIMEOUT_MS);
});
