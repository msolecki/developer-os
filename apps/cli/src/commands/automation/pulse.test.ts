import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { runBrain } from "../brain.js";
import { runInit } from "../init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runScheduledPulse } from "./pulse.js";

afterAll(removeCommandFixtures);

const START = Date.UTC(2026, 6, 30, 12, 0, 0);
const DAY = 86_400_000;

async function installed(label: string, calls: ProcessRequest[], clock: { at: number }, reindex = true, fail = false): Promise<CommandFixture> {
  const runner: ProcessRunner = {
    run(request): Promise<ProcessResult> {
      if (fail) return Promise.reject(new Error("no osascript"));
      calls.push(request);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false });
    },
  };
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true, runner, now: () => new Date(clock.at) });
  const init = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  if (!init.ok) throw new Error(`fixture init failed: ${JSON.stringify(init)}`);
  if (reindex) {
    const built = await runBrain(fixture.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
    if (!built.ok) throw new Error(`fixture reindex failed: ${JSON.stringify(built)}`);
  }
  calls.length = 0;
  return fixture;
}

async function pulse(fixture: CommandFixture) {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("no lifecycle context");
  const lock = await lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock")));
  const borrowed: HeldLifecycleStableLockV1 = { ...lock, release: () => Promise.resolve() };
  try {
    return await runScheduledPulse(fixture.context, borrowed);
  } finally {
    await lock.release();
  }
}

const slot = (fixture: CommandFixture, n: number): string => join(fixture.paths.stateDir, `pulse.${String(n)}.md`);

describe("brain-pulse", () => {
  it("rotates eight report slots and never creates a ninth", async () => {
    const calls: ProcessRequest[] = [];
    const clock = { at: START };
    const fixture = await installed("pulse-rotate", calls, clock);
    for (let day = 0; day < 9; day += 1) {
      clock.at = START + day * DAY;
      const result = await pulse(fixture);
      expect(result).toMatchObject({ outcome: "success", data: { report: "state/pulse.0.md" } });
    }
    const date = async (n: number): Promise<string> =>
      ((await nodeFs.readFile(slot(fixture, n), "utf8")).match(/"date":"([^"]+)"/u) ?? [])[1] ?? "";
    expect(await date(0)).toBe("2026-08-07");
    expect(await date(1)).toBe("2026-08-06");
    expect(await date(7)).toBe("2026-07-31");
    await expect(nodeFs.lstat(slot(fixture, 8))).rejects.toMatchObject({ code: "ENOENT" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("is silent on healthy and raises one osascript notification on attention, without vault content", async () => {
    const calls: ProcessRequest[] = [];
    const clock = { at: START };
    const fixture = await installed("pulse-notify", calls, clock);
    const first = await pulse(fixture);
    expect([first, await nodeFs.readFile(slot(fixture, 0), "utf8")]).toMatchObject([{ outcome: "success", reasonCode: "pulse_healthy" }, expect.any(String)]);
    expect(calls).toHaveLength(0);

    clock.at = START + 30 * DAY; // the index is now older than 8 days
    const result = await pulse(fixture);
    expect(result).toMatchObject({ outcome: "success", reasonCode: "pulse_attention", data: { verdict: "attention", notified: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: "/usr/bin/osascript", stdin: "", timeoutMs: 10_000, env: {} });
    expect(calls[0]?.args).toStrictEqual([
      "-e",
      `display notification "attention — ${slot(fixture, 0)}" with title "Developer OS"`,
    ]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("keeps its outcome when the notification cannot be spawned", async () => {
    const clock = { at: START };
    const fixture = await installed("pulse-notify-fail", [], clock, true, true);
    clock.at = START + 30 * DAY; // the index is now older than 8 days
    expect(await pulse(fixture)).toMatchObject({ outcome: "success", data: { notified: false } });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports, without throwing, when the index is missing", async () => {
    const fixture = await installed("pulse-no-index", [], { at: START }, false); // fresh init builds no index
    const result = await pulse(fixture);
    expect(result.outcome).toBe("success");
    expect(await nodeFs.readFile(slot(fixture, 0), "utf8")).toContain("index_missing");
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
