import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as pkg from "./index.js";

/**
 * Two module-specifier shapes, not the bare package-name word. The word alone
 * matches prose too — a comment that merely *names* the sibling package, a
 * spec quotation, a URL. A real reference is shaped one of two ways: the
 * scoped package name (how an import specifier or a `package.json`
 * dependency names it), or a relative path ending in the sibling directory's
 * name (how a `tsconfig.json` project reference names it). This repository's
 * own references read `../../packages/<name>`, never a bare `../<name>`, so
 * the second needle matches on the slash immediately before the directory
 * name rather than on `../` immediately before it — matching on `../` alone
 * would miss the exact form this repository uses.
 *
 * Line-based import matching was deliberately not used instead: it would miss
 * `require`, a dynamic `import()` and a re-export, none of which the two
 * needles below care how they are spelled.
 *
 * Assembled at runtime, mirroring the identical guard on the Codex adapter's
 * own `index.test.ts`: this file is one of the files scanned, and a literal
 * would match its own source.
 */
function forbiddenModuleSpecifiers(vendor: string): readonly [string, string] {
  const segment = ["adapter", vendor].join("-");
  return [`@developer-os/${segment}`, `/${segment}`];
}

/**
 * A door test, not an inventory. `workflow-schema`'s `index.ts` is the
 * precedent: a package whose guarantees live in guard functions must not export
 * the raw schema behind them, and the only way that stays true is a test that
 * fails when the surface widens.
 */
describe("the public door", () => {
  it("exports exactly the intended surface", () => {
    expect(Object.keys(pkg).sort()).toEqual([
      "CLAUDE_CAPABILITY_KEYS",
      "CLAUDE_MINIMUM_VERSION",
      "CLAUDE_NOT_USED_KEYS",
      "ClaudeRenderer",
      "PLUGIN_INSTALL_SEGMENTS",
      "PLUGIN_NAME",
      "SHARED_WORKFLOW_ID",
      "buildPluginTree",
      "discoverClaude",
      "invokeClaude",
      "probeClaude",
      "proposeClaudeInstall",
      "proposeClaudeUninstall",
      "renderClaudePlugin",
      "resolveCapabilities",
    ]);
  });

  /**
   * `parseAgentPromptArgs` lives in `packages/core` because both adapters
   * execute `agent.prompt` (spec §8.1, amended 2026-08-11). Re-exporting it
   * here would give consumers two import paths for one guarantee, which is how
   * the two copies come to disagree.
   */
  it("does not re-export the shared agent.prompt guard", () => {
    expect(Object.keys(pkg)).not.toContain("parseAgentPromptArgs");
  });

  it("exports no zod schema", () => {
    for (const name of Object.keys(pkg)) {
      expect(name.toLowerCase()).not.toContain("schema");
    }
  });

  /**
   * Spec §1, asserted across the package rather than one file. Mirrors the
   * Codex adapter's identical guard — the invariant is stated bidirectionally
   * in both packages' `versions.ts` prose ("peers that may never import one
   * another"), so both packages need the guard, not just one.
   */
  it("imports nothing from the Codex adapter, anywhere in the package", async () => {
    const [scoped, relative] = forbiddenModuleSpecifiers("codex");
    const files = await readdir(new URL(".", import.meta.url), { recursive: true });
    const sources = files.filter((name) => name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      expect(source, name).not.toContain(scoped);
      expect(source, name).not.toContain(relative);
    }
  });

  /**
   * The scan above is `.ts` sources only. A workspace dependency on the Codex
   * adapter declared in `package.json` or `tsconfig.json`'s `references`
   * would make the import reachable without a single `.ts` file naming it —
   * the one-way dependency direction this package must hold (`core` <-
   * `security` <- `workflow-schema` <- each adapter, peers never importing
   * each other) is a manifest fact as much as a source fact.
   */
  it("does not depend on the Codex adapter in its package manifest or tsconfig", async () => {
    const [scoped, relative] = forbiddenModuleSpecifiers("codex");
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const tsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
    // Per file, not just in total: an empty or truncated manifest must not
    // pass vacuously the way `readFile` rejecting on a missing file would
    // otherwise let it.
    expect(packageJson.length).toBeGreaterThan(0);
    expect(tsconfig.length).toBeGreaterThan(0);
    expect(packageJson).not.toContain(scoped);
    expect(packageJson).not.toContain(relative);
    expect(tsconfig).not.toContain(scoped);
    expect(tsconfig).not.toContain(relative);
  });
});
