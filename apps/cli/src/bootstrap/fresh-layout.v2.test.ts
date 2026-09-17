import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "../commands/init.js";
import { createCommandFixture, inventory, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { inspectPackagedRelease } from "../update/packaged-release.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

type JsonRecord = Record<string, unknown>;

interface ManifestArtifactRow {
  readonly path: string;
  readonly kind: string;
  readonly verification: { readonly mode: string };
}

/**
 * A copy of `executor.test.ts`'s helper rather than a shared import: that file
 * is a test file, so importing it here would run its whole suite in this job.
 */
async function persistedPlan(fixture: CommandFixture): Promise<{
  readonly path: string;
  readonly value: JsonRecord;
}> {
  const candidates: Array<{ readonly path: string; readonly value: JsonRecord }> = [];
  for (const name of await nodeFs.readdir(fixture.paths.stateDir)) {
    if (!name.endsWith(".plan.json")) continue;
    const path = join(fixture.paths.stateDir, name);
    try {
      const value = JSON.parse(await nodeFs.readFile(path, "utf8")) as JsonRecord;
      if (value.operation === "fresh_v2_init" && typeof value.id === "string") {
        candidates.push({ path, value });
      }
    } catch {
      // An immutable-plan boundary death leaves an inert, noncanonical prefix.
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`fixture has ${String(candidates.length)} durable bootstrap plans`);
  }
  return candidates[0] as { readonly path: string; readonly value: JsonRecord };
}

function effectiveUid(): number {
  if (process.getuid === undefined) throw new Error("UID inspection unavailable in test");
  return process.getuid();
}

describe("fresh V2 init layout", () => {
  it("creates exactly the fresh plan path set Spec 2 §3.2 and Spec 1 §2.1 reserve", async () => {
    const fixture = await createCommandFixture("bootstrap-exact-created-set", { bootstrapAvailable: true });
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
    const { identity } = await inspectPackagedRelease(bootstrap.packagedRelease);

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
    const plan = (await persistedPlan(fixture)).value;
    const created = [plan.createdPaths, plan.launchabilityPaths]
      .flatMap((rows) => rows as Array<{ readonly path: string }>)
      .map((row) => row.path);
    const childrenOf = (root: string): readonly string[] => created.filter((path) => dirname(path) === root).toSorted();
    const jobs = ["brain-reindex", "brain-lint", "doctor", "git-sync"];
    const state = fixture.paths.stateDir;
    const metadata = join(state, "release-metadata");
    const expectedState = [
      ".lifecycle.lock", "lifecycle-install-nonce", "lifecycle-id-allocator.json", "git-sync.json",
      "uninstalling.json", "update-rollback.json", "update-executor.json", "transactions",
      "lifecycle-journals", "git-effect-journals", "launchd-effect-journals", "release-metadata",
      "active-release.json", "release-trust.json",
      ...jobs.flatMap((job) => [`automation-${job}.status.json`, `.automation-${job}.lock`]),
    ].map((name) => join(state, name)).toSorted();
    const expectedLogs = jobs
      .flatMap((job) => Array.from({ length: 10 }, (_, slot) => `automation-${job}.${String(slot)}.json`))
      .map((name) => join(fixture.paths.logsDir, name)).toSorted();
    const expectedHome = ["backups", "logs", "releases", "rollback", "schemas", "staging"]
      .map((name) => join(fixture.paths.home, name)).toSorted();
    const expectedMetadata = {
      [join(metadata, "delegations")]: [join(metadata, "delegations", `${identity.delegationHash}.json`)],
      [join(metadata, "indexes")]: [join(metadata, "indexes", `${identity.releaseIndexHash}.json`)],
      [join(metadata, "bundles")]: [join(metadata, "bundles", `${identity.bundleManifestHash}.json`)],
    };

    for (const expected of [expectedState, expectedLogs, expectedHome]) expect(expected.length).toBeGreaterThan(0);
    expect(childrenOf(state)).toStrictEqual(expectedState);
    expect(childrenOf(fixture.paths.logsDir)).toStrictEqual(expectedLogs);
    expect(childrenOf(fixture.paths.home)).toStrictEqual(expectedHome);
    expect(childrenOf(metadata)).toStrictEqual(Object.keys(expectedMetadata).toSorted());
    for (const [directory, files] of Object.entries(expectedMetadata)) expect(childrenOf(directory)).toStrictEqual(files);
    expect(childrenOf(join(fixture.paths.home, "rollback"))).toStrictEqual([]);
    expect(created.filter((path) => path.startsWith(join(fixture.paths.home, "releases", "metadata")))).toStrictEqual([]);

    for (const path of Object.values(expectedMetadata).flat()) {
      const bytes = await nodeFs.readFile(path);
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(basename(path, ".json"));
    }

    const rollbackRoot = join(fixture.paths.home, "rollback");
    const rollbackStats = await nodeFs.lstat(rollbackRoot);
    expect([rollbackStats.isDirectory(), rollbackStats.mode & 0o777, rollbackStats.uid])
      .toStrictEqual([true, 0o700, effectiveUid()]);
    expect(await nodeFs.readdir(rollbackRoot)).toStrictEqual([]);
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      readonly artifacts: readonly ManifestArtifactRow[];
    };
    expect(manifest.artifacts.find((row) => row.path === rollbackRoot))
      .toMatchObject({ kind: "directory", verification: { mode: "content" } });

    const tree = await inventory(fixture.paths.home);
    const withdrawnNames = new Set(jobs.map((job) => `automation-${job}.json`));
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.filter((relative) =>
      relative === join("state", "rollback") || withdrawnNames.has(basename(relative)),
    )).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
