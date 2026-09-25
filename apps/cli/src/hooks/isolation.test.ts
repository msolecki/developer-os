import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "entry.ts");
/**
 * `import type` is erased under `verbatimModuleSyntax`, so it loads nothing at runtime and is not an edge.
 * The alternatives: `import … from` / `export … from`, a side-effect `import "x"`, and a dynamic `import("x")`.
 */
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)(?!\s+type\b)\b[^'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

async function graph(): Promise<{ files: Set<string>; bare: Set<string> }> {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [ENTRY];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of specifiers(source)) {
      if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      else bare.add(specifier);
    }
  }
  return { files, bare };
}

function specifiers(source: string): readonly string[] {
  return [...source.matchAll(SPECIFIER)].flatMap((match) => (match.slice(1) as (string | undefined)[]).flatMap((s) => s ?? []));
}

it("sees every runtime import form and skips type-only imports", () => {
  const source = [
    'import { a } from "./static.js";',
    'export * from "./reexport.js";',
    'import "./side-effect.js";',
    'const late = await import("./dynamic.js");',
    'import type { T } from "./type-only.js";',
  ].join("\n");
  expect(specifiers(source)).toStrictEqual(["./static.js", "./reexport.js", "./side-effect.js", "./dynamic.js"]);
});

it("reaches no adapter package and no invocation module from the hook entry", async () => {
  const { files, bare } = await graph();
  expect(files.size).toBeGreaterThan(1);
  expect([...files].some((f) => f.endsWith("/hooks/registry.ts"))).toBe(true);
  expect([...bare].filter((s) => s.startsWith("@developer-os/adapter-"))).toStrictEqual([]);
  expect([...files].filter((f) => /\/invoke\.ts$/u.test(f))).toStrictEqual([]);
});
