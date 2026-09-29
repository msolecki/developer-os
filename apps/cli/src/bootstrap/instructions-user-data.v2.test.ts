import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

interface PersistedFreshPlan {
  readonly admittedPreexistingPaths: readonly { readonly path: string; readonly dev: string; readonly ino: string }[];
  readonly createdPaths: readonly { readonly path: string }[];
}

const OVERRIDES = {
  "claude/rules/x.md": "# user rule\n",
  "codex/skills/y/SKILL.md": "---\nname: y\n---\nbody\n",
} as const;

async function plantOverrides(fixture: CommandFixture): Promise<string> {
  await nodeFs.mkdir(fixture.paths.home, { mode: 0o700 });
  await nodeFs.chmod(fixture.paths.home, 0o700);
  const root = join(fixture.paths.home, "instructions");
  for (const [relative, text] of Object.entries(OVERRIDES)) {
    await nodeFs.mkdir(join(root, relative, ".."), { recursive: true });
    await nodeFs.writeFile(join(root, relative), text);
  }
  return root;
}

async function onlyPlan(fixture: CommandFixture): Promise<PersistedFreshPlan> {
  const names = (await nodeFs.readdir(fixture.paths.stateDir)).filter((name) => name.endsWith(".plan.json"));
  expect(names).toHaveLength(1);
  return JSON.parse(
    await nodeFs.readFile(join(fixture.paths.stateDir, names[0] as string), "utf8"),
  ) as PersistedFreshPlan;
}

describe("the product home's instructions directory is user data (foundation.md §12.1)", () => {
  it("installs over a home holding only instructions/** and leaves those bytes untouched", async () => {
    const fixture = await createCommandFixture("bootstrap-instructions-user-data", { bootstrapAvailable: true });
    const root = await plantOverrides(fixture);
    const before = new Map<string, bigint>();
    for (const relative of Object.keys(OVERRIDES)) {
      before.set(relative, (await nodeFs.lstat(join(root, relative), { bigint: true })).ino);
    }
    const rootStats = await nodeFs.lstat(root, { bigint: true });

    const result = await runInit(fixture.context, ACCEPTED);

    if (!result.ok) throw new Error(result.error.message);
    const plan = await onlyPlan(fixture);
    /** Spec 2 P8 (NEW-86): the plan records the identity planning observed. */
    expect(plan.admittedPreexistingPaths).toStrictEqual([
      { path: root, dev: rootStats.dev.toString(10), ino: rootStats.ino.toString(10) },
    ]);
    expect(plan.createdPaths.filter((row) => row.path === root || row.path.startsWith(`${root}/`)))
      .toStrictEqual([]);
    expect(Object.keys(OVERRIDES).length).toBeGreaterThan(0);
    for (const [relative, text] of Object.entries(OVERRIDES)) {
      expect(await nodeFs.readFile(join(root, relative), "utf8"), relative).toBe(text);
      expect((await nodeFs.lstat(join(root, relative), { bigint: true })).ino, relative)
        .toBe(before.get(relative));
    }
    const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      artifacts: { path: string }[];
    };
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    expect(manifest.artifacts.filter((artifact) => artifact.path === root || artifact.path.startsWith(`${root}/`)))
      .toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an instructions entry that is a file, writing nothing", async () => {
    const fixture = await createCommandFixture("bootstrap-instructions-file", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.home, { mode: 0o700 });
    await nodeFs.chmod(fixture.paths.home, 0o700);
    await nodeFs.writeFile(join(fixture.paths.home, "instructions"), "not a directory\n");

    const result = await runInit(fixture.context, ACCEPTED);

    if (result.ok) throw new Error("init admitted an instructions file");
    expect(await nodeFs.readdir(fixture.paths.home)).toStrictEqual(["instructions"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a symlinked instructions directory, writing nothing", async () => {
    const fixture = await createCommandFixture("bootstrap-instructions-symlink", { bootstrapAvailable: true });
    await nodeFs.mkdir(fixture.paths.home, { mode: 0o700 });
    await nodeFs.chmod(fixture.paths.home, 0o700);
    const elsewhere = join(fixture.userHome, "elsewhere");
    await nodeFs.mkdir(elsewhere);
    await nodeFs.symlink(elsewhere, join(fixture.paths.home, "instructions"));

    const result = await runInit(fixture.context, ACCEPTED);

    if (result.ok) throw new Error("init admitted a symlinked instructions directory");
    expect(await nodeFs.readdir(fixture.paths.home)).toStrictEqual(["instructions"]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
