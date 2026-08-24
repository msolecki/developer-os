import { chmod, lstat, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTempHome,
  installFakeExecutable,
  inventory,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { TempHome } from "../helpers/temp-home.js";

let temporary: TempHome | null = null;

afterEach(async () => {
  if (temporary === null) return;
  await removeTempHome(temporary);
  temporary = null;
});

describe("temporary HOME inventory", () => {
  it("includes bytes written through the executable PATH directory", async () => {
    temporary = await createTempHome();
    await installFakeExecutable(temporary, "claude");

    const snapshot = await inventory(temporary.root);

    expect(snapshot.get(join(temporary.root, "bin"))).toBe("dir");
    expect(snapshot.get(join(temporary.root, "bin", "claude"))).toMatch(
      /^file:[a-f0-9]{64}$/u,
    );

    const root = temporary.root;
    const alias = temporary.binDir;
    const executableRoot = await realpath(alias);
    await removeTempHome(temporary);
    temporary = null;

    for (const path of new Set([root, alias, executableRoot])) {
      await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("refuses a tampered root when split cleanup is retried after a partial failure", async () => {
    temporary = await createTempHome();
    const home = temporary as TempHome & { root: string };
    const originalRoot = home.root;
    const aliasParent = dirname(home.binDir);

    /** Normal hosts use one repo-local root and have no split retry path. */
    if (aliasParent === originalRoot) return;

    const originalMode = (await stat(aliasParent)).mode & 0o777;
    const executableRoot = await realpath(home.binDir);
    const victim = await mkdtemp("/tmp/dos-cleanup-victim-");
    try {
      await chmod(aliasParent, 0o500);
      await expect(removeTempHome(home)).rejects.toBeInstanceOf(AggregateError);
      await chmod(aliasParent, originalMode);

      home.root = victim;
      await expect(removeTempHome(home)).rejects.toThrow(/roots or alias changed/u);
      await expect(lstat(victim)).resolves.toBeDefined();
    } finally {
      await chmod(aliasParent, originalMode);
      home.root = originalRoot;
      try {
        await removeTempHome(home);
        temporary = null;
        for (const path of [originalRoot, home.binDir, executableRoot]) {
          await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
        }
        await expect(lstat(victim)).resolves.toBeDefined();
      } finally {
        await rm(victim, { recursive: true, force: true });
      }
    }
  });
});
