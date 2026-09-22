import { readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { BrainRefactorResultV1 } from "@developer-os/cli/dist/commands/refactor.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";

import { runJson } from "../helpers/run-cli.js";
import {
  addedPaths,
  changedPaths,
  createTempHome,
  inventory,
  isInside,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { TempHome } from "../helpers/temp-home.js";

/**
 * Spec §7.4, the refactor half: `brain retire` and `brain refactor` refuse a
 * symlinked topic folder, an agent session and an occupied destination, and write
 * nothing when they do. Every case runs the compiled binary under a temporary HOME
 * and asserts the exact exit code and kind: on the base commit both verbs are
 * unknown commands (usage, exit 2), and a `not.toBe(success)` would pass there.
 */

const REFERRER = "DEV/example-knowledge-note.md";
const LINKED = "TOOLS/example-reference-note.md";
const ISOLATED = "INFRA/example-compiled-note.md";

const OCCUPANT = [
  "---",
  "schemaVersion: 1",
  "title: Occupant",
  "type: knowledge-note",
  "created: 2026-09-22",
  "tags: [tools]",
  "summary: Occupant is what this note records.",
  "stage: emerging",
  "author: human",
  "reviewed: null",
  "---",
  "",
  "A note already standing where the rename would land.",
  "",
].join("\n");

const sandboxes: TempHome[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const sandbox = sandboxes.pop();
    if (sandbox !== undefined) await removeTempHome(sandbox);
  }
});

async function installedHome(): Promise<TempHome> {
  const sandbox = await createTempHome();
  sandboxes.push(sandbox);
  const installed = await runJson<InitResultV1>(sandbox, ["init", "--yes", "--json"]);
  expect(installed.exitCode, installed.stderr).toBe(EXIT_CODES.success);
  return sandbox;
}

function vaultPath(sandbox: TempHome, notePath: string): string {
  return join(sandbox.brain, "content", ...notePath.split("/"));
}

/** Locks, journals and logs under the product home; the vault must stay byte-identical. */
function isVolatile(sandbox: TempHome, path: string): boolean {
  return isInside(sandbox.productHome, path);
}

async function assertNothingWritten(
  sandbox: TempHome,
  before: Awaited<ReturnType<typeof inventory>>,
): Promise<void> {
  const after = await inventory(sandbox.root);
  expect(addedPaths(before, after).filter((p) => !isVolatile(sandbox, p))).toStrictEqual([]);
  expect(changedPaths(before, after).filter((p) => !isVolatile(sandbox, p))).toStrictEqual([]);
}

describe("a brain refactor through a symlinked topic folder", () => {
  /**
   * Two targets, because they fail at different gates. A link resolving inside the
   * vault root is skipped by discovery, so the plan is built and the refactor's own
   * containment refuses the destination. A link resolving outside the vault is
   * refused by discovery itself, before any plan exists — `SecurityRefusalError`,
   * which publishes as `security_refusal`. Both are exit 5 and write nothing.
   */
  it.each([
    ["inside the vault root, outside content/", "brain", "brain_refactor_path_refused"],
    ["outside the vault", "root", "security_refusal"],
  ] as const)(
    "refuses --move into TOOLS linked %s with exit 5 %s and changes nothing",
    async (_where, base, kind) => {
      const sandbox = await installedHome();
      const elsewhere = join(base === "brain" ? sandbox.brain : sandbox.root, "tools-elsewhere");
      await rename(join(sandbox.brain, "content", "TOOLS"), elsewhere);
      await symlink(elsewhere, join(sandbox.brain, "content", "TOOLS"), "dir");
      const moved = await readdir(elsewhere);
      expect(moved.length).toBeGreaterThan(0);
      const before = await inventory(sandbox.root);

      const run = await runJson<BrainRefactorResultV1>(sandbox, [
        "brain",
        "refactor",
        "--move",
        REFERRER,
        "TOOLS",
        "--json",
      ]);

      expect([run.exitCode, !run.result.ok && run.result.error.kind], run.stderr).toStrictEqual([
        EXIT_CODES.securityRefusal,
        kind,
      ]);
      await assertNothingWritten(sandbox, before);
      expect(await readdir(elsewhere)).toStrictEqual(moved);
    },
  );
});

describe("an applied brain retire inside an agent session", () => {
  it("refuses with exit 5 brain_refactor_in_agent_session under CLAUDECODE=1 and changes nothing", async () => {
    const sandbox = await installedHome();
    const before = await inventory(sandbox.root);

    const run = await runJson<BrainRefactorResultV1>(
      sandbox,
      ["brain", "retire", ISOLATED, "--json"],
      { env: { CLAUDECODE: "1" } },
    );

    expect([run.exitCode, !run.result.ok && run.result.error.kind], run.stderr).toStrictEqual([
      EXIT_CODES.securityRefusal,
      "brain_refactor_in_agent_session",
    ]);
    await assertNothingWritten(sandbox, before);
  });
});

describe("a brain refactor --rename onto an occupied path", () => {
  it("refuses with exit 3 refactor_destination_exists and changes nothing", async () => {
    const sandbox = await installedHome();
    await writeFile(vaultPath(sandbox, "TOOLS/occupant.md"), OCCUPANT, { flag: "wx", mode: 0o600 });
    const before = await inventory(sandbox.root);

    const run = await runJson<BrainRefactorResultV1>(sandbox, [
      "brain",
      "refactor",
      "--rename",
      LINKED,
      "occupant.md",
      "--json",
    ]);

    expect([run.exitCode, !run.result.ok && run.result.error.kind], run.stderr).toStrictEqual([
      EXIT_CODES.decisionRequired,
      "refactor_destination_exists",
    ]);
    await assertNothingWritten(sandbox, before);
  });
});
