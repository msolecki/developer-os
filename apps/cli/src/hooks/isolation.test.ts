import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "entry.ts");
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']/gu;

async function graph(): Promise<{ files: Set<string>; bare: Set<string> }> {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [ENTRY];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      else bare.add(specifier);
    }
  }
  return { files, bare };
}

it("reaches no adapter package and no invocation module from the hook entry", async () => {
  const { files, bare } = await graph();
  expect(files.size).toBeGreaterThan(1);
  expect([...files].some((f) => f.endsWith("/hooks/registry.ts"))).toBe(true);
  expect([...bare].filter((s) => s.startsWith("@developer-os/adapter-"))).toStrictEqual([]);
  expect([...files].filter((f) => /\/invoke\.ts$/u.test(f))).toStrictEqual([]);
});
