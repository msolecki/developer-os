import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText, parseUInt64Decimal, SCHEDULED_JOB_IDS } from "@developer-os/core";
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";
import { LAUNCHD_JOBS, launchdJob } from "@developer-os/platform-macos";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";

import { invokeAgentOnce, invokeIsolatedCodex } from "../ingest.js";
import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { createProductionScheduledHandlers } from "./handlers.js";
import { withScheduledJob } from "./scheduled-scope.js";

afterEach(removeCommandFixtures);

describe("the production scheduled handlers", () => {
  it("cover exactly the closed six-job registry, of which only brain-garden may spawn a vendor", () => {
    expect([...SCHEDULED_JOB_IDS]).toStrictEqual(["brain-reindex", "brain-lint", "doctor", "git-sync", "brain-garden", "brain-pulse"]);
    expect(LAUNCHD_JOBS.map((job) => job.id)).toStrictEqual([...SCHEDULED_JOB_IDS]);
    expect(SCHEDULED_JOB_IDS.filter((job) => launchdJob(job).maySpawnVendor)).toStrictEqual(["brain-garden"]);
  });

  it("refuse an agent call from a scheduled job that may not spawn a vendor, spawning nothing", async () => {
    const { fixture, calls } = await vendorGuardFixture("vendor-guard-refused");
    for (const job of SCHEDULED_JOB_IDS.filter((id) => !launchdJob(id).maySpawnVendor)) {
      await expect(withScheduledJob(job, () => invokeAgentOnce(fixture.context, VENDOR, "p", "garden.proposals", 1_000))).rejects.toMatchObject({
        reason: "vendor_spawn_forbidden",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("refuse a direct Codex door call from a job that may not spawn a vendor, spawning nothing", async () => {
    const { fixture, calls } = await vendorGuardFixture("vendor-guard-codex-door");
    const invocation = { prompt: "p", workingRoot: fixture.paths.stateDir, writeScopes: [], outputSchemaPath: "/synthetic/schema.json", timeoutMs: 1_000 };
    await expect(
      withScheduledJob("brain-lint", () => invokeIsolatedCodex(fixture.context, { executable: "/synthetic/bin/codex", version: "0.0.0" }, invocation, { runner: fixture.context.runner })),
    ).rejects.toMatchObject({ reason: "vendor_spawn_forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("refuse any schema but garden.proposals inside a scheduled run, even brain-garden's", async () => {
    const { fixture, calls } = await vendorGuardFixture("vendor-guard-schema");
    await expect(withScheduledJob("brain-garden", () => invokeAgentOnce(fixture.context, VENDOR, "p", "ingest.stage", 1_000))).rejects.toMatchObject({
      reason: "vendor_spawn_forbidden",
    });
    expect(calls).toHaveLength(0);
  });

  it("let brain-garden and a manual call reach the vendor", async () => {
    const { fixture, calls } = await vendorGuardFixture("vendor-guard-allowed");
    const once = (): ReturnType<typeof invokeAgentOnce> => invokeAgentOnce(fixture.context, VENDOR, "p", "garden.proposals", 1_000);
    expect(await withScheduledJob("brain-garden", once)).toStrictEqual({ ok: false, reason: "timeout" });
    expect(await once()).toStrictEqual({ ok: false, reason: "timeout" });
    expect(calls).toHaveLength(2);
  });

  it("dispatch brain-garden and brain-pulse to their own handlers", async () => {
    const fixture = await createCommandFixture("scheduled-garden-pulse");
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
    const handlers = createProductionScheduledHandlers(fixture.context, lifecycle);

    /** On an uninitialized home each handler's own first read answers; neither is the Task 1 placeholder. */
    const pulse = await handlers.run("brain-pulse", heldLock(fixture)).catch((error: unknown) => error);
    const garden = await handlers.run("brain-garden", heldLock(fixture)).catch((error: unknown) => error);

    expect(pulse).toMatchObject({ name: "BrainRefusal", message: expect.stringMatching(/not initialized/u) as unknown });
    expect(garden).toMatchObject({ outcome: "handler_refused", reasonCode: "lifecycle_mutation_home_not_v2" });
  });

  it("run git-sync through the Git sync, reporting a refusal by its own safe reason and releasing nothing", async () => {
    const fixture = await createCommandFixture("scheduled-git-sync");
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
    const releases: string[] = [];
    const held = heldLock(fixture, releases);

    const result = await createProductionScheduledHandlers(fixture.context, lifecycle).run("git-sync", held);

    expect(result).toMatchObject({ outcome: "handler_refused", reasonCode: "manifest_absent" });
    expect(releases).toStrictEqual([]);
  });
});

const VENDOR = { name: "claude", executable: "/synthetic/bin/claude" } as const;

function heldLock(fixture: CommandFixture, releases: string[] = []): HeldLifecycleStableLockV1 {
  return {
    path: parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal("1"),
    release: () => {
      releases.push("released");
      return Promise.resolve();
    },
  };
}

/** A runner that records every spawn and answers each one as a timeout. */
async function vendorGuardFixture(name: string): Promise<{ readonly fixture: CommandFixture; readonly calls: readonly unknown[] }> {
  const calls: unknown[] = [];
  const runner: ProcessRunner = {
    run: (...args): Promise<ProcessResult> => {
      calls.push(args);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM", timedOut: true });
    },
  };
  const fixture = await createCommandFixture(name, { runner });
  return { fixture, calls };
}
