import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SHARDS = ["uninstall", "core", "rest"] as const;

/** Positional `vitest run` filters, i.e. every argument that is not an option or an option's value. */
function includes(command: string): readonly string[] {
  return command.replace(/^vitest run /u, "").split(" ").filter((arg) => arg.endsWith(".v2.test.ts"));
}

function excludes(command: string): readonly string[] {
  return [...command.matchAll(/--exclude '\*\*\/([^']+)'/gu)].map((match) => match[1] ?? "");
}

async function v2Files(): Promise<readonly string[]> {
  const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "*.v2.test.ts"], { cwd: ROOT });
  return stdout.split("\0").filter((path) => path.length > 0);
}

/**
 * **The three `test:lifecycle:*` shards partition the `*.v2.test.ts` files** (AUD-083). `rest`
 * excludes the files the other two name, so a renamed include file silently moves to `rest`, and
 * `check.yml`'s per-shard file counts — and the budget derived from them — go stale unnoticed.
 */
describe("the lifecycle shards partition the V2 test files", () => {
  it("names every include file once, excludes exactly those from rest, and matches check.yml's counts", async () => {
    const scripts = (JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;
    const all = await v2Files();
    expect(all.length, "no *.v2.test.ts file found").toBeGreaterThan(10);

    const matching = (filter: string): readonly string[] => all.filter((path) => path.endsWith(`/${filter}`));
    const named = [...includes(scripts["test:lifecycle:uninstall"] ?? ""), ...includes(scripts["test:lifecycle:core"] ?? "")];
    expect(named.filter((filter) => matching(filter).length !== 1), "an include filter matches no file or several").toStrictEqual([]);
    expect(new Set(named).size, "a file is named by both shards").toBe(named.length);

    const rest = scripts["test:lifecycle:rest"] ?? "";
    expect(includes(rest)).toStrictEqual([".v2.test.ts"]);
    expect([...excludes(rest)].sort()).toStrictEqual([...named].sort());

    const counts = {
      uninstall: includes(scripts["test:lifecycle:uninstall"] ?? "").length,
      core: includes(scripts["test:lifecycle:core"] ?? "").length,
      rest: all.length - named.length,
    };
    const workflow = await readFile(join(ROOT, ".github/workflows/check.yml"), "utf8");
    const documented = Object.fromEntries(SHARDS.map((shard) => {
      const match = new RegExp(`\\(\`npm run test:lifecycle:${shard}\`, (\\d+) files,`, "u").exec(workflow);
      return [shard, Number(match?.[1])];
    }));
    expect(documented).toStrictEqual(counts);
  });
});
