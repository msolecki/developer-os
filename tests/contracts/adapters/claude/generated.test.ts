import { describe, expect, it } from "vitest";
import { detectWorkflowDrift } from "@developer-os/workflow-schema";
import { readGeneratedTree, renderAllForClaude } from "./render-all.js";

/**
 * Product spec §10: generated artifacts are reproducible, CI regenerates them
 * and fails if the checked-in output differs. This is that gate.
 */
describe("plugins/claude is a clean regeneration", () => {
  it("matches a fresh render byte for byte", async () => {
    const expected = await renderAllForClaude();
    const onDisk = await readGeneratedTree();
    expect(detectWorkflowDrift(expected, onDisk)).toEqual([]);
    /**
     * `detectWorkflowDrift` iterates `expected` only, so an **extra** file on
     * disk produces no finding. Set equality lives here, in the same case as
     * the drift assertion, rather than resting on a count in a different `it`
     * that a later edit could weaken without anyone noticing which guarantee
     * they were deleting. Restoring `plugins/claude/hooks/hooks.json` by hand
     * fails this line. Found by fresh-context review, 2026-08-11.
     */
    expect([...onDisk.keys()].sort()).toEqual(
      expected.map((artifact) => artifact.path).sort(),
    );
  });

  /**
   * A gate that can pass by scanning nothing is not a gate, and this repository
   * has shipped two that could. Both sides are asserted non-empty, and the
   * counts are asserted against the six canonical workflows rather than against
   * whatever happens to be there.
   */
  it("scans a non-empty set on both sides", async () => {
    const expected = await renderAllForClaude();
    const onDisk = await readGeneratedTree();
    expect(expected.length).toBeGreaterThan(0);
    expect(onDisk.size).toBe(expected.length);
  });

  it("renders one skill per canonical workflow, plus the manifest", async () => {
    const expected = await renderAllForClaude();
    const skills = expected.filter((artifact) =>
      artifact.path.endsWith("SKILL.md"),
    );
    expect(skills).toHaveLength(6);
    expect(expected).toHaveLength(skills.length + 1);
  });

  it("contains no absolute machine path", async () => {
    for (const [path, contents] of await readGeneratedTree()) {
      expect(contents, `${path} must carry no machine path`).not.toMatch(
        /\/Users\/|\/home\//u,
      );
    }
  });

  /**
   * Claude architecture former §7.1: the preamble carrying the prompt-injection defence is
   * concatenated into every other artifact, so it is physically present rather
   * than referenced. This asserts it over the real workflows, not a fixture.
   */
  it("carries the shared preamble in every non-shared skill", async () => {
    const onDisk = await readGeneratedTree();
    const skills = [...onDisk.entries()].filter(
      ([path]) =>
        path.endsWith("SKILL.md") && !path.includes("developer-os-shared"),
    );
    expect(skills).toHaveLength(5);
    for (const [path, contents] of skills) {
      expect(contents, `${path} must carry the preamble`).toContain(
        "preamble from shared",
      );
    }
  });

  /**
   * Asserted over the **renderer** as well as the tree. Read from disk alone,
   * this case would keep passing if hooks emission were restored and the tree
   * simply not regenerated — it would be testing the artifact rather than the
   * decision, and only the drift case would go red.
   */
  it("ships no hooks, matching the amendment to Claude architecture former §6", async () => {
    for (const paths of [
      [...(await readGeneratedTree()).keys()],
      (await renderAllForClaude()).map((artifact) => artifact.path),
    ]) {
      expect(paths).not.toContain("hooks/hooks.json");
      expect(paths.some((path) => path.startsWith("bin/"))).toBe(false);
    }
  });

  it("carries a source marker in every skill", async () => {
    for (const [path, contents] of await readGeneratedTree()) {
      if (!path.endsWith("SKILL.md")) continue;
      expect(contents, `${path} must be marked generated`).toContain(
        "Do not edit.",
      );
    }
  });
});
