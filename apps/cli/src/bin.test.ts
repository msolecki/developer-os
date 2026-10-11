import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

/**
 * AUD-088: a hook firing runs inside its vendor's budget, and every module `bin.ts` imports
 * statically loads before the hook dispatches. The command graph loads only when it runs.
 */
describe("bin.ts", () => {
  it("statically imports no command graph a hook firing does not run", async () => {
    const source = await readFile(new URL("./bin.ts", import.meta.url), "utf8");
    const runtimeImports = [...source.matchAll(/^import (?!type )[^;]*? from "([^"]+)";$/gmsu)].map((match) => match[1]);

    expect(runtimeImports).toContain("./hooks/entry.js");
    for (const commandGraph of ["./main.js", "./commands/automation/index.js", "./commands/capture.js", "./update/packaged-release.js"]) {
      expect(runtimeImports).not.toContain(commandGraph);
    }
  });
});
