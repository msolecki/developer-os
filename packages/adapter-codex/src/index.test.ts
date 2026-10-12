import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as door from "./index.js";

/**
 * Two module-specifier shapes, not the bare package-name word. The word alone
 * matches prose too — a comment that merely *names* the sibling package, a
 * spec quotation, a URL — and five such comments had to be reworded to
 * satisfy the earlier version of this check. A real reference is shaped one
 * of two ways: the scoped package name (how an import specifier or a
 * `package.json` dependency names it), or a relative path ending in the
 * sibling directory's name (how a `tsconfig.json` project reference names
 * it). This repository's own references read `../../packages/<name>`, never
 * a bare `../<name>`, so the second needle matches on the slash immediately
 * before the directory name rather than on `../` immediately before it —
 * matching on `../` alone would miss the exact form this repository uses.
 *
 * Line-based import matching was deliberately not used instead: it would miss
 * `require`, a dynamic `import()` and a re-export, none of which the two
 * needles below care how they are spelled.
 *
 * Assembled at runtime for the same reason the single needle used to be: this
 * file is one of the files scanned, and a literal would match its own source.
 */
function forbiddenModuleSpecifiers(vendor: string): readonly [string, string] {
  const segment = ["adapter", vendor].join("-");
  return [`@developer-os/${segment}`, `/${segment}`];
}

describe("the package's public door", () => {
  it("exports exactly what Codex architecture former §11 names, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "CODEX_CAPABILITY_KEYS",
        "CODEX_HOOKS_PATH",
        "CODEX_HOOK_ROWS",
        "CODEX_HOOK_TRUST_RESIDUE",
        "CODEX_HOOK_TRUST_STEP",
        "CODEX_MINIMUM_VERSION",
        "CODEX_NOT_USED_KEYS",
        "CODEX_ROOT_SEGMENT",
        "CodexRenderer",
        "InstructionBlockTooLargeError",
        "MARKETPLACE_NAME",
        "MARKETPLACE_RELATIVE_PATH",
        "PLUGIN_NAME",
        "PLUGIN_TREE_PREFIX",
        "PLUGIN_TREE_SEGMENTS",
        "SHARED_WORKFLOW_ID",
        "buildPluginTree",
        "codexOwnerUpdateProvider",
        "discoverCodex",
        "invocationFromAgentPrompt",
        "invokeCodex",
        "probeCodex",
        "proposeCodexInstall",
        "renderAgentToml",
        "renderCodexHooks",
        "renderCodexInstallTree",
        "renderCodexPlugin",
        "renderCodexVendorTree",
        "renderInstructionTree",
        "renderMarketplace",
        "resolveCapabilities",
        "withCodexHooks",
      ].sort(),
    );
  });

  /**
   * A guard, not a constant. `SHARED_WORKFLOW_ID` is re-exported deliberately —
   * it is a string, and a consumer that has it cannot get anything wrong with
   * it. The four below are guarantees, and a package that re-exports another
   * package's guard hands consumers two import paths for one rule. The last two
   * are Task 3.5's: one argv screen and one version comparison, or they are not
   * one.
   */
  it.each([
    "parseAgentPromptArgs",
    "compareCodePoints",
    "screenValueArgument",
    "compareVersions",
  ])("does not re-export %s, which belongs to another package", (name) => {
    expect(Object.keys(door)).not.toContain(name);
  });

  /**
   * Codex architecture former §1, asserted across the package rather than one file.
   */
  it("imports nothing from the Claude adapter, anywhere in the package", async () => {
    const [scoped, relative] = forbiddenModuleSpecifiers("claude");
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
   * The scan above is `.ts` sources only. A workspace dependency on the
   * Claude adapter declared in `package.json` or `tsconfig.json`'s
   * `references` would make the import reachable without a single `.ts` file
   * naming it — the one-way dependency direction this package must hold
   * (`core` <- `security` <- `workflow-schema` <- each adapter, peers never
   * importing each other) is a manifest fact as much as a source fact.
   */
  it("does not depend on the Claude adapter in its package manifest or tsconfig", async () => {
    const [scoped, relative] = forbiddenModuleSpecifiers("claude");
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
