/**
 * Plan 1b Task 20: the opt-in surfaces through the CLI's own argv parser and dispatch, on a
 * real V2 home. The compiled binary cannot be handed a scripted Git runtime or launchd domain,
 * and on any host but the pinned one it would refuse both by design (Q5), so these drive
 * `run` in process with the fixture's composed context — the same seam `network.test.ts` uses.
 */
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import { REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import { run } from "@developer-os/cli/dist/main.js";

import { BASE_SCHEDULES, configureCommitter, createOptInHome, plistPath, readOrNull, writeNote } from "../helpers/opt-in-home.js";
import type { OptInHomeV1 } from "../helpers/opt-in-home.js";

afterAll(removeCommandFixtures);

interface OptInCliFixtureV1 {
  readonly home: OptInHomeV1;
  /** Every Git process tree the scripted runtime would have started. */
  readonly gitProcesses: readonly string[];
  /** Every `launchctl bootstrap`/`bootout` the injected domain received. */
  readonly launchdProcesses: readonly string[];
  /** Every network push attempted. */
  readonly networkRequests: readonly string[];
}

interface CliOutcomeV1 {
  readonly exitCode: number;
  readonly json: { readonly ok: boolean; readonly data?: unknown; readonly error?: { readonly kind: string } };
}

async function optInCliFixture(name: string): Promise<OptInCliFixtureV1> {
  const home = await createOptInHome(name);
  return {
    home,
    gitProcesses: home.runtime.spawns,
    launchdProcesses: home.launchd.events,
    networkRequests: home.runtime.networkCalls,
  };
}

async function runCliInTempHome(argv: readonly string[], fixture: OptInCliFixtureV1): Promise<CliOutcomeV1> {
  const { home } = fixture;
  const printed = home.io.out.length;
  const exitCode = await run([...argv, "--json"], home.io, () => home.context);
  const printedNow = home.io.out.slice(printed);
  expect(printedNow, `${argv.join(" ")} must print exactly one JSON document`).toHaveLength(1);
  const json = JSON.parse(printedNow[0] ?? "") as CliOutcomeV1["json"];
  return { exitCode, json };
}

describe("the opt-in surfaces through the CLI", () => {
  it(
    "keeps disabled opt-in surfaces inert end to end",
    async () => {
      const fixture = await optInCliFixture("e2e-opt-in-inert");
      const result = await runCliInTempHome(["status"], fixture);
      expect(result.exitCode).toBe(0);

      expect((await runCliInTempHome(["git", "status"], fixture)).exitCode).toBe(0);
      const sync = await runCliInTempHome(["git", "sync"], fixture);
      expect(sync.exitCode).toBe(EXIT_CODES.capabilityUnavailable);
      expect(sync.json.error?.kind).toBe("git_disabled");
      expect((await runCliInTempHome(["automation", "status"], fixture)).exitCode).toBe(0);
      const disable = await runCliInTempHome(["automation", "disable"], fixture);
      expect(disable.exitCode).toBe(EXIT_CODES.invalidInput);
      expect(disable.json.error?.kind).toBe("automation_already_disabled");

      expect(fixture.gitProcesses).toEqual([]);
      expect(fixture.launchdProcesses).toEqual([]);
      expect(fixture.networkRequests).toEqual([]);
      expect(await readOrNull(join(fixture.home.gitDirectory, "HEAD"))).toBeNull();
      expect(await nodeFs.readdir(join(fixture.home.userHome, "Library", "LaunchAgents"))).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "walks enable, sync, automation, disable and uninstall through argv, and every preview changes nothing",
    async () => {
      const fixture = await optInCliFixture("e2e-opt-in-chain");
      const { home } = fixture;
      const allocator = join(home.paths.stateDir, "lifecycle-id-allocator.json");

      const allocatorBefore = await nodeFs.readFile(allocator);
      expect((await runCliInTempHome(["git", "enable", "--remote", home.remote], fixture)).exitCode).toBe(0);
      expect(await nodeFs.readFile(allocator)).toStrictEqual(allocatorBefore);
      expect(await readOrNull(join(home.gitDirectory, "HEAD"))).toBeNull();
      expect((await runCliInTempHome(["git", "enable", "--remote", home.remote, "--apply"], fixture)).exitCode).toBe(0);

      await configureCommitter(home);
      await writeNote(home, "through-argv");
      expect((await runCliInTempHome(["git", "sync"], fixture)).exitCode).toBe(0);
      expect(fixture.gitProcesses).toHaveLength(1);
      expect(await readOrNull(join(home.remote, "refs", "heads", "main"))).toBe(await readOrNull(join(home.gitDirectory, "refs", "heads", "main")));

      const schedules = [...BASE_SCHEDULES, "git-sync=hourly@15"].flatMap((schedule) => ["--schedule", schedule]);
      expect((await runCliInTempHome(["automation", "enable", ...schedules], fixture)).exitCode).toBe(0);
      expect(fixture.launchdProcesses).toStrictEqual([]);
      expect(await readOrNull(plistPath(home, "git-sync"))).toBeNull();
      expect((await runCliInTempHome(["automation", "enable", ...schedules, "--apply"], fixture)).exitCode).toBe(0);
      expect(home.launchd.loaded.size).toBe(4);
      expect((await runCliInTempHome(["automation", "status"], fixture)).exitCode).toBe(0);

      expect((await runCliInTempHome(["automation", "disable", "--apply"], fixture)).exitCode).toBe(0);
      expect(home.launchd.loaded.size).toBe(0);
      expect((await runCliInTempHome(["git", "disable", "--apply"], fixture)).exitCode).toBe(0);
      const refs = await readOrNull(join(home.gitDirectory, "refs", "heads", "main"));

      expect((await runCliInTempHome(["uninstall", "--yes"], fixture)).exitCode).toBe(0);
      expect(await readOrNull(home.paths.manifestFile)).toBeNull();
      expect(await readOrNull(join(home.gitDirectory, "refs", "heads", "main"))).toBe(refs);
      expect(await readOrNull(join(home.paths.brain, "content", "DEV", "through-argv.md"))).not.toBeNull();
      expect(fixture.gitProcesses).toHaveLength(1);
      expect(fixture.networkRequests).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});
