import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));

/** Every source file `entry` loads at startup: relative static imports and re-exports, followed transitively. */
function staticClosure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [join(SOURCE_ROOT, entry)];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^(?:import|export) (?!type )(?:[^;]*? from )?"(\.[^"]+)";$/gmsu)) {
      const target = join(dirname(file), (match[1] ?? "").replace(/\.js$/u, ".ts"));
      if (existsSync(target)) pending.push(target);
    }
  }
  return new Set([...seen].map((file) => relative(SOURCE_ROOT, file)));
}

/**
 * AUD-088: a hook firing runs inside its vendor's budget, and every module `bin.ts` loads
 * statically, directly or through another module, loads before the hook dispatches.
 */
describe("bin.ts", () => {
  it("loads no command graph a hook firing does not run, directly or transitively", () => {
    const closure = staticClosure("bin.ts");

    expect(closure).toContain("hooks/entry.ts");
    expect(closure).toContain("context.ts");
    for (const commandGraph of ["main.ts", "commands/capture.ts", "commands/automation/index.ts"]) {
      expect(closure).not.toContain(commandGraph);
    }
  });
});
