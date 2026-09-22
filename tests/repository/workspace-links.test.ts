import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);

/**
 * NEW-98: a linked worktree whose `tests/node_modules/@developer-os/*` links
 * resolved into another checkout ran that checkout's packages, not its own.
 * `npm run link:tests` repairs the links; this pins that they are repaired.
 */
describe("tests workspace links", () => {
  it("resolves every tests/node_modules/@developer-os link inside this checkout", async () => {
    const root = await realpath((await runProcess("git", ["rev-parse", "--show-toplevel"])).stdout.trim());
    const manifest = JSON.parse(await readFile(join(root, "tests/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const names = Object.keys(manifest.dependencies).filter((name) => name.startsWith("@developer-os/"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const resolved = await realpath(join(root, "tests/node_modules", name));
      expect(resolved.startsWith(`${root}${sep}`), name).toBe(true);
      const own = JSON.parse(await readFile(join(resolved, "package.json"), "utf8")) as { name: string };
      expect(own.name).toBe(name);
    }
  });
});
