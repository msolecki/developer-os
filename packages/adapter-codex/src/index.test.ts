import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./index.js";
import * as door from "./index.js";

describe("the package's public door", () => {
  it("exports exactly what spec §11 names, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "CODEX_CAPABILITY_KEYS",
        "CODEX_MINIMUM_VERSION",
        "CodexAdapter",
        "CodexRenderer",
        "MARKETPLACE_NAME",
        "MARKETPLACE_RELATIVE_PATH",
        "PLUGIN_NAME",
        "PLUGIN_TREE_SEGMENTS",
        "SHARED_WORKFLOW_ID",
        "buildPluginTree",
        "discoverCodex",
        "invocationFromAgentPrompt",
        "invokeCodex",
        "probeCodex",
        "proposeCodexInstall",
        "proposeCodexUninstall",
        "renderCodexInstallTree",
        "renderCodexPlugin",
        "renderMarketplace",
        "resolveCapabilities",
      ].sort(),
    );
  });

  it("binds the façade to the functions, so DOS-P6 consumes one object", () => {
    expect(CodexAdapter.vendor).toBe("codex");
    expect(typeof CodexAdapter.discover).toBe("function");
    expect(typeof CodexAdapter.capabilities).toBe("function");
    expect(typeof CodexAdapter.renderPlugin).toBe("function");
    expect(typeof CodexAdapter.proposeInstall).toBe("function");
    expect(typeof CodexAdapter.invoke).toBe("function");
  });

  /**
   * The test above is `typeof` checks, which stay green if a member is added
   * — exactly the widening the module-level door test above already refuses
   * to allow for `index.ts` itself. `CodexAdapter` is the same kind of door
   * and gets the same exact-list guard, plus the immutability the frozen
   * object promises but nothing else here checks.
   */
  it("binds exactly this member list on the façade, frozen", () => {
    expect(Object.keys(CodexAdapter).sort()).toEqual(
      [
        "vendor",
        "discover",
        "probe",
        "capabilities",
        "renderPlugin",
        "renderInstallTree",
        "proposeInstall",
        "proposeUninstall",
        "invoke",
      ].sort(),
    );
    expect(Object.isFrozen(CodexAdapter)).toBe(true);
  });

  /**
   * `renderPlugin` (plugin-root-relative) and `proposeInstall`
   * (marketplace-root-relative) are one root apart — see `compose.ts`'s
   * `renderCodexInstallTree` doc comment. Feeding one into the other directly
   * is the exact silent under-nesting that function exists to prevent;
   * `renderInstallTree` is the only façade member that re-roots first. This
   * guards the pairing, not just each member's presence.
   */
  it("renderInstallTree, not renderPlugin, is the correct feed for proposeInstall", () => {
    expect(CodexAdapter.renderInstallTree).not.toBe(CodexAdapter.renderPlugin);
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
   * Spec §1, asserted across the package rather than one file.
   *
   * The needle is assembled at runtime because this file is one of the files
   * scanned: written as a literal, the assertion matches its own source and the
   * test can never pass.
   */
  it("imports nothing from the Claude adapter, anywhere in the package", async () => {
    const forbidden = ["adapter", "claude"].join("-");
    const files = await readdir(new URL(".", import.meta.url), { recursive: true });
    const sources = files.filter((name) => name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      expect(source, name).not.toContain(forbidden);
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
    const forbidden = ["adapter", "claude"].join("-");
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
    expect(packageJson).not.toContain(forbidden);
    expect(tsconfig).not.toContain(forbidden);
  });
});
