import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import type { CliContext } from "../../context.js";
import { runBrain } from "../brain.js";
import { runInit } from "../init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runScheduledPulse } from "./pulse.js";

afterAll(removeCommandFixtures);

const START = Date.UTC(2026, 6, 30, 12, 0, 0);
const DAY = 86_400_000;

/** A real fresh V2 init (the slow part), optionally with the index built; the runner and clock are the caller's. */
async function installed(label: string, run: ProcessRunner["run"], clock: { at: number }, reindex: boolean): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true, runner: { run }, now: () => new Date(clock.at) });
  const init = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  if (!init.ok) throw new Error(`fixture init failed: ${JSON.stringify(init)}`);
  if (reindex) {
    const built = await runBrain(fixture.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
    if (!built.ok) throw new Error(`fixture reindex failed: ${JSON.stringify(built)}`);
  }
  return fixture;
}

async function pulse(fixture: CommandFixture, context: CliContext = fixture.context) {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("no lifecycle context");
  const lock = await lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")));
  const borrowed: HeldLifecycleStableLockV1 = { ...lock, release: () => Promise.resolve() };
  try {
    return await runScheduledPulse(context, borrowed);
  } finally {
    await lock.release();
  }
}

const slot = (fixture: CommandFixture, n: number): string => join(fixture.paths.stateDir, `pulse.${String(n)}.md`);
const dateOf = async (fixture: CommandFixture, n: number): Promise<string> =>
  ((await nodeFs.readFile(slot(fixture, n), "utf8")).match(/"date":"([^"]+)"/u) ?? [])[1] ?? "";

describe("brain-pulse", () => {
  it("notifies, rotates eight slots, and fails cleanly on a stale rotation, over one shared install", async () => {
    const calls: ProcessRequest[] = [];
    let spawnFails = false;
    const clock = { at: START };
    const fixture = await installed(
      "pulse-shared",
      (request): Promise<ProcessResult> => {
        if (spawnFails) return Promise.reject(new Error("no osascript"));
        calls.push(request);
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false });
      },
      clock,
      true,
    );
    calls.length = 0;

    // healthy: silent
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", reasonCode: "pulse_healthy" });
    expect(calls).toHaveLength(0);

    // attention: one osascript call carrying the verdict and the report path only
    clock.at = START + 30 * DAY; // the index is now older than 8 days
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", reasonCode: "pulse_attention", data: { verdict: "attention", notified: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: "/usr/bin/osascript", stdin: "", timeoutMs: 10_000, env: {} });
    expect(calls[0]?.args).toStrictEqual(["-e", `display notification "attention — ${slot(fixture, 0)}" with title "Developer OS"`]);

    // a notification that cannot be spawned never changes the outcome
    spawnFails = true;
    clock.at = START + 31 * DAY;
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", data: { notified: false } });

    // nine runs in all: slot 7 holds the second report and no ninth slot exists
    for (let day = 32; day <= 37; day += 1) {
      clock.at = START + day * DAY;
      expect(await pulse(fixture)).toMatchObject({ outcome: "success", data: { report: "state/pulse.0.md" } });
    }
    expect(await dateOf(fixture, 0)).toBe("2026-09-05");
    expect(await dateOf(fixture, 1)).toBe("2026-09-04");
    expect(await dateOf(fixture, 7)).toBe("2026-08-29");
    await expect(nodeFs.lstat(slot(fixture, 8))).rejects.toMatchObject({ code: "ENOENT" });

    // a slot edited between the read and the write: the precondition fails, the job ends handler_failed, nothing is written
    const real = fixture.context.executor;
    const racing: CliContext = {
      ...fixture.context,
      executor: {
        execute: async (plan) => {
          await nodeFs.appendFile(slot(fixture, 1), "edited\n");
          return real.execute(plan);
        },
        resume: (id) => real.resume(id),
        rollback: (id) => real.rollback(id),
      },
    };
    clock.at = START + 38 * DAY;
    expect(await pulse(fixture, racing)).toMatchObject({ outcome: "handler_failed", reasonCode: "pulse_rotation_failed" });
    expect(await dateOf(fixture, 0)).toBe("2026-09-05");

    // Ruling 33's other half: with an index present, drift is a lint error and the verdict is failure
    const catalog = join(fixture.paths.brain, "content", "_indexes", "catalog.md");
    await nodeFs.appendFile(catalog, "\nedited after the build\n");
    clock.at = START + 39 * DAY;
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", reasonCode: "pulse_failure" });
    const drifted = await nodeFs.readFile(slot(fixture, 0), "utf8");
    expect(drifted).toContain('"verdict":"failure"');
    expect(drifted).toContain("lint_errors");

    // security L1: a 70 KB generatedAt never reaches the report, so the next run can still read slot 0 and rotate
    const indexPath = join(fixture.paths.brain, "content", "_indexes", "index.json");
    const index = JSON.parse(await nodeFs.readFile(indexPath, "utf8")) as Record<string, unknown>;
    await nodeFs.writeFile(indexPath, JSON.stringify({ ...index, generatedAt: `2026-09-01 ${"x".repeat(70_000)}` }));
    for (const day of [40, 41]) {
      clock.at = START + day * DAY;
      expect(await pulse(fixture)).toMatchObject({ outcome: "success" });
    }
    expect(await dateOf(fixture, 0)).toBe("2026-09-09");
    expect(await dateOf(fixture, 1)).toBe("2026-09-08");
    const oversized = await nodeFs.readFile(slot(fixture, 0), "utf8");
    expect(oversized).toContain("- index generated: unreadable\n");
    expect(oversized.length).toBeLessThan(4_096);

    // a corrupt index.json is unreadable, not missing
    await nodeFs.writeFile(join(fixture.paths.brain, "content", "_indexes", "index.json"), "{ not json");
    clock.at = START + 42 * DAY;
    await pulse(fixture);
    const corrupt = await nodeFs.readFile(slot(fixture, 0), "utf8");
    expect(corrupt).toContain("index_unreadable");
    expect(corrupt).not.toContain("index_missing");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("needs attention, with no throw, when no index exists yet", async () => {
    const calls: ProcessRequest[] = [];
    const fixture = await installed(
      "pulse-no-index",
      (request): Promise<ProcessResult> => {
        calls.push(request);
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false });
      },
      { at: START },
      false, // fresh init builds no index
    );
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", reasonCode: "pulse_attention" });
    const report = await nodeFs.readFile(slot(fixture, 0), "utf8");
    expect(report).toContain('"verdict":"attention"');
    expect(report).toContain("index_missing");
    expect(report).not.toContain("lint_errors");
    expect(report).toContain("developer-os brain reindex");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
