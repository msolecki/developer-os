import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, GIT_ENABLE_BRANCH_HISTORY_WARNING } from "@developer-os/core";

import { syntheticGitEnablePreview } from "../../lifecycle/testing.js";
import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import { renderGit, runGit } from "./index.js";
import type { GitCommandRequestV1 } from "./index.js";
import { scriptedEffectPorts, scriptedGitRuntime } from "./testing.js";

afterEach(removeCommandFixtures);

const HOME = "/synthetic-home" as Parameters<typeof syntheticGitEnablePreview>[0];

describe("renderGit", () => {
  it("prints a preview's plan, its branch-history warning, and that nothing changed", () => {
    const preview = syntheticGitEnablePreview(HOME);
    const lines = renderGit({ kind: "preview", command: "git_enable", preview, warning: GIT_ENABLE_BRANCH_HISTORY_WARNING });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain(preview.previewHash);
    expect(lines).toContain(GIT_ENABLE_BRANCH_HISTORY_WARNING);
    expect(lines.at(-1)).toContain("--apply");
  });

  it("prints one line for an applied plan and for a sync", () => {
    expect(renderGit({ kind: "applied", operation: "git_disable", transactionId: "lc_x_1", previewHash: "0".repeat(64) as never })).toEqual([
      "Git git_disable applied (lc_x_1).",
    ]);
    expect(renderGit({ kind: "sync", outcome: "no_changes", transactionId: "lc_x_2", headOid: "c".repeat(40) })).toEqual([
      `Git sync no_changes at ${"c".repeat(40)} (lc_x_2).`,
    ]);
  });

  it("prints every status field, never-synced included", () => {
    const lines = renderGit({
      kind: "status",
      enabled: false,
      activation: "absent",
      repositoryRoot: null,
      branch: null,
      remote: null,
      transport: null,
      scope: null,
      distribution: null,
      closure: "clear",
      lastSync: null,
    });
    expect(lines).toContain("last sync      never");
    expect(lines).toContain("distribution   -");
  });
});

describe("runGit before any installation", () => {
  it.each([
    { subcommand: "status" },
    { subcommand: "sync" },
    { subcommand: "disable", apply: true },
    { subcommand: "enable", remote: "/synthetic-remote.git", branch: null, apply: true },
  ] satisfies readonly GitCommandRequestV1[])("refuses $subcommand as invalid input and spawns no Git", async (request) => {
    const runtime = scriptedGitRuntime();
    const fixture = await createCommandFixture(`git-uninstalled-${request.subcommand}`, {
      effectPorts: scriptedEffectPorts(runtime, { on: false }),
    });
    const result = await runGit(fixture.context, request);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(runtime.spawns).toEqual([]);
    expect(runtime.networkCalls).toEqual([]);
    expect(fixture.stableLockEvents).toEqual([]);
  });
});
