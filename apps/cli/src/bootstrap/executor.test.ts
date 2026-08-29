import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventory,
  removeCommandFixtures,
} from "../commands/testing.js";
import { BootstrapExecutor, freshInitDeathPoints } from "./executor.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
/** Real fsync/rename death tests measure ~7s isolated and >20s under the full parallel gate. */
const REAL_FILESYSTEM_TIMEOUT_MS = 60_000;

describe("BootstrapExecutor fresh V2 initialization", () => {
  it("creates a complete V2 handoff without network, Git, launchd, vendor, or model calls", async () => {
    const fixture = await createCommandFixture("bootstrap-complete", {
      bootstrapAvailable: true,
    });
    const bootstrap = fixture.context.bootstrap;
    expect(bootstrap?.state).toBe("available");
    if (bootstrap?.state !== "available") return;
    expect(bootstrap.executor).toBeInstanceOf(BootstrapExecutor);

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schemaVersion).toBe(2);
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      schemaVersion: number;
      artifacts: Array<{ path: string }>;
    };
    expect(manifest.schemaVersion).toBe(2);
    const paths = manifest.artifacts.map((artifact) => artifact.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(expect.arrayContaining([
      fixture.paths.configFile,
      join(fixture.paths.stateDir, "active-release.json"),
      join(fixture.paths.stateDir, "release-trust.json"),
      join(fixture.paths.stateDir, "lifecycle-install-nonce"),
      join(fixture.paths.stateDir, "lifecycle-id-allocator.json"),
      join(fixture.paths.stateDir, "update-rollback.json"),
      join(fixture.paths.stateDir, "update-executor.json"),
    ]));
    expect(paths).not.toContain(join(fixture.paths.stateDir, "redaction.key"));
    expect(await exists(fixture.paths.stagingDir)).toBe(false);
    expect(fixture.releaseRequests).toStrictEqual([]);
    expect(fixture.vendorProcesses).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps a fresh dry-run byte inert while returning the complete V2 preview", async () => {
    const fixture = await createCommandFixture("bootstrap-dry-run", {
      bootstrapAvailable: true,
    });
    const before = await inventory(fixture.root);

    const result = await runInit(fixture.context, { dryRun: true, assumeYes: true });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.schemaVersion).toBe(2);
    expect(result.ok && result.data.created).toContain(
      join(fixture.paths.stateDir, "active-release.json"),
    );
    expect(await inventory(fixture.root)).toStrictEqual(before);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it("records bootstrap/global lock order, evidence-before-create, Foundation pairs, active-last, manifest PONR, and plan-last compaction", async () => {
    const fixture = await createCommandFixture("bootstrap-order", {
      bootstrapAvailable: true,
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    const trace = fixture.bootstrapTrace;
    const index = (prefix: string): number => trace.findIndex((row) => row.startsWith(prefix));
    expect(index("lock:bootstrap")).toBeLessThan(index("inventory:second"));
    expect(index("inventory:second")).toBeLessThan(index("intent:plan"));
    expect(index("intent:journal")).toBeLessThan(index("payload:evidence:"));
    expect(index("payload:evidence:")).toBeLessThan(index("create:global_lock"));
    expect(index("foundation:compensation:")).toBeLessThan(index("foundation:forward:"));
    expect(index("launchability:trust")).toBeLessThan(index("launchability:active"));
    expect(index("launchability:active")).toBeLessThan(index("manifest:publish"));
    expect(index("manifest:publish")).toBeLessThan(index("verify:v2"));
    expect(index("compact:bootstrap-lock")).toBeLessThan(index("compact:journal"));
    expect(trace.at(-2)).toBe("compact:journal");
    expect(trace.at(-1)).toBe("compact:plan");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(freshInitDeathPoints)("recovers a crash at $name", async ({ name }) => {
    const fixture = await createCommandFixture(`bootstrap-death-${name}`, {
      bootstrapAvailable: true,
      bootstrapInterruptAfter: name,
    });
    const interrupted = await runInit(fixture.context, ACCEPTED);
    expect(interrupted.ok).toBe(false);
    expect(!interrupted.ok && interrupted.code).toBe(EXIT_CODES.recoveryRequired);

    fixture.disableBootstrapInterrupt();
    const resumed = await runInit(fixture.context, ACCEPTED);
    expect(resumed.ok).toBe(true);
    expect(resumed.ok && resumed.data.schemaVersion).toBe(2);
    expect(JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8"))).toMatchObject({
      schemaVersion: 2,
    });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("compensates in reverse order when a pre-manifest failure follows Foundation", async () => {
    const fixture = await createCommandFixture("bootstrap-compensation", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_foundation",
    });

    const result = await runInit(fixture.context, ACCEPTED);

    expect(result.ok).toBe(false);
    const compensated = fixture.bootstrapTrace.filter((row) =>
      row.startsWith("compensate:path:"),
    );
    expect(compensated.length).toBeGreaterThan(1);
    const ordinals = (scope: string): number[] => compensated
      .filter((row) => row.startsWith(`compensate:path:${scope}:`))
      .map((row) => Number(row.split(":").at(-1)));
    for (const scope of ["launchability", "ordinary"]) {
      const observed = ordinals(scope);
      expect(observed).toStrictEqual([...observed].sort((left, right) => right - left));
    }
    expect(await exists(fixture.paths.configFile)).toBe(false);
    expect(await exists(fixture.paths.manifestFile)).toBe(false);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("retains the fresh V1 compatibility arm when the bootstrap projection is absent", async () => {
    const fixture = await createCommandFixture("bootstrap-projection-missing");
    const result = await runInit({ ...fixture.context, bootstrap: undefined }, ACCEPTED);
    expect(result.ok && result.data.schemaVersion).toBe(1);
    expect(fixture.bootstrapTrace).toStrictEqual([]);
  });

  it("preserves a pre-existing Brain byte-for-byte", async () => {
    const fixture = await createCommandFixture("bootstrap-existing-brain", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true });
    const note = join(fixture.paths.brain, "mine.md");
    await nodeFs.writeFile(note, "mine\n");
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    expect(await nodeFs.readFile(note, "utf8")).toBe("mine\n");
    expect(await nodeFs.readdir(fixture.paths.brain)).toStrictEqual(["mine.md"]);
  });
});
