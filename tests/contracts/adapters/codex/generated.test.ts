import { describe, expect, it } from "vitest";
import { MARKETPLACE_RELATIVE_PATH } from "@developer-os/adapter-codex";
import { detectWorkflowDrift } from "@developer-os/workflow-schema";
import { readGeneratedTree, renderAllForCodex } from "./render-all.js";

describe("plugins/codex is a clean regeneration", () => {
  it("matches a fresh render byte for byte, and carries nothing extra", async () => {
    const expected = await renderAllForCodex();
    const onDisk = await readGeneratedTree();
    expect(detectWorkflowDrift(expected, onDisk)).toEqual([]);
    // `detectWorkflowDrift` iterates `expected` only, so an extra file on disk
    // produces no finding. Set equality lives here, in the same case.
    expect([...onDisk.keys()].sort()).toEqual(expected.map((a) => a.path).sort());
  });

  it("scans a non-empty set on both sides", async () => {
    const expected = await renderAllForCodex();
    expect(expected.length).toBeGreaterThan(0);
    expect((await readGeneratedTree()).size).toBe(expected.length);
  });

  it("renders one skill per canonical workflow, plus the manifest", async () => {
    const expected = await renderAllForCodex();
    expect(expected.filter((a) => a.path.endsWith("SKILL.md"))).toHaveLength(6);
    expect(expected).toHaveLength(7);
  });

  it("contains no absolute machine path", async () => {
    const onDisk = await readGeneratedTree();
    expect(onDisk.size).toBeGreaterThan(0);
    for (const [path, contents] of onDisk) {
      expect(contents, path).not.toMatch(/\/Users\/|\/home\//u);
    }
  });

  it("carries the shared preamble in every non-shared skill", async () => {
    const skills = [...(await readGeneratedTree()).entries()].filter(
      ([path]) => path.endsWith("SKILL.md") && !path.includes("developer-os-shared"),
    );
    expect(skills).toHaveLength(5);
    for (const [path, contents] of skills) {
      expect(contents, path).toContain("preamble from shared");
    }
  });

  it("ships no marketplace descriptor, which belongs at the marketplace root, not the plugin root", async () => {
    expect([...(await readGeneratedTree()).keys()]).not.toContain(
      MARKETPLACE_RELATIVE_PATH,
    );
  });
});
