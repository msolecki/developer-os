import { describe, expect, it } from "vitest";
import * as pkg from "./index.js";

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
});
