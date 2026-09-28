import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeCanonicalJson, parseStableSemver } from "@developer-os/core";
import type { InstallationManifestV2 } from "@developer-os/core";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";
import { runUpdate } from "@developer-os/cli/dist/commands/update/index.js";
import type { UpdateInvocationV1 } from "@developer-os/cli/dist/commands/update/index.js";
import { exists, inventoryDigest, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import type { CliContext } from "@developer-os/cli/dist/context.js";
import type { UpdateCapacityObservationV1 } from "@developer-os/cli/dist/update/planning.js";
import { installUpdatableHome, SYNTHETIC_ARCHITECTURES } from "@developer-os/cli/dist/update/testing.js";
import type { SyntheticArchitectureV1, UpdatableHomeV1 } from "@developer-os/cli/dist/update/testing.js";

/**
 * Spec 2 §12's "complete lifecycle works" row on the synthetic release (D72 P7(f)): a real `init`
 * from the packaged release, then preview and apply, a second apply that retires the first
 * rollback set, rollback, reapply, and uninstall — for both `arm64` and `x64`. Every port but the
 * release world (FD 3 trust, transport, scratch, planner) is production, and `--apply` runs the
 * production ports with the packaged release as the fallback handoff. The Git and automation leg
 * joins with NEW-113; the real-release half waits for Task 11b and A16.
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

async function start(architecture: SyntheticArchitectureV1): Promise<Lifecycle> {
  const home = await installUpdatableHome(`e2e-release-update-${architecture}`, architecture);
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
    const verifier = world.releases.get("1.1.0")?.bundles.get(architecture)?.files.get("bin/verifier");
    expect(verifier).toBeDefined();
    expect(new Uint8Array(await nodeFs.readFile(join(bundleRoot(lifecycle, "1.1.0"), "bin", "verifier")))).toEqual(verifier);
    expect((await lifecycle.home.update().readHome()).rollback?.previous.version).toBe("1.0.0");

    // A second update retires the first rollback set with the release it retained.
    expect(await run(lifecycle, { kind: "update", version: null, apply: true, json: true })).toMatchObject({ outcome: "applied", active: { version: "1.2.0" } });
    expect(await exists(bundleRoot(lifecycle, "1.0.0"))).toBe(false);
    expect((await lifecycle.home.update().readHome()).rollback?.previous.version).toBe("1.1.0");

    // Rollback is local evidence only: no transport request, no planner run, trust unchanged.
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
    expect(await exists(bundleRoot(lifecycle, "1.2.0"))).toBe(false);
    expect((await lifecycle.home.update().readHome()).rollback).toBeNull();

    expect(await run(lifecycle, { kind: "update", version: null, apply: true, json: true })).toMatchObject({ outcome: "applied", active: { version: "1.2.0" } });
    expect(await activeVersion(lifecycle)).toBe("1.2.0");

    // Spec 2 §13.3 residual 9 (A8): no manifest this lifecycle published holds a symlink artifact.
    expect(lifecycle.manifests.length).toBeGreaterThan(0);
    for (const manifest of lifecycle.manifests) expect(manifest.artifacts.filter((row) => row.kind === "symlink")).toEqual([]);

    const requestsBeforeUninstall = world.requests.length;
    const removed = await runUninstall(fixture.context, ACCEPTED);
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    expect(world.requests).toHaveLength(requestsBeforeUninstall);
    expect(await nodeFs.readFile(join(fixture.paths.brain, BRAIN_NOTE), "utf8")).toBe(BRAIN_NOTE_BYTES);
    expect(await nodeFs.readFile(join(fixture.userHome, VENDOR_FILE), "utf8")).toBe(VENDOR_FILE_BYTES);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
    expect(await exists(join(fixture.paths.home, "releases"))).toBe(false);
    expect(await exists(join(fixture.paths.home, "rollback"))).toBe(false);
    await world.cleanup();
  }, LIFECYCLE_TIMEOUT_MS);
});
