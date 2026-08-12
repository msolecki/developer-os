import { describe, expect, it } from "vitest";
import {
  buildPluginTree,
  PLUGIN_NAME,
  PLUGIN_TREE_PREFIX,
  PLUGIN_TREE_SEGMENTS,
} from "./plugin.js";

const skills = [
  { path: "skills/developer-os-shared/SKILL.md", contents: "shared\n" },
  { path: "skills/developer-os-capture/SKILL.md", contents: "capture\n" },
];

describe("buildPluginTree", () => {
  it("emits the manifest beside the skills", () => {
    const paths = buildPluginTree(skills).map((artifact) => artifact.path);
    expect(paths).toContain(".codex-plugin/plugin.json");
    expect(paths).toHaveLength(skills.length + 1);
  });

  it("installs to <product-home>/codex/plugins/developer-os", () => {
    expect([...PLUGIN_TREE_SEGMENTS]).toEqual(["codex", "plugins", PLUGIN_NAME]);
  });

  it("derives the marketplace-root-relative plugin prefix from PLUGIN_TREE_SEGMENTS, not a literal", () => {
    expect(PLUGIN_TREE_PREFIX).toBe("plugins/developer-os");
    expect(PLUGIN_TREE_PREFIX).toBe(PLUGIN_TREE_SEGMENTS.slice(1).join("/"));
  });

  it("emits a manifest with exactly the fields spec §14.4 names and no others", () => {
    const manifest = buildPluginTree(skills).find((a) => a.path === ".codex-plugin/plugin.json");
    const parsed = JSON.parse(manifest?.contents ?? "{}") as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["description", "name", "skills", "version"]);
    expect(parsed.name).toBe(PLUGIN_NAME);
    expect(parsed.skills).toBe("skills");
  });

  it("orders by code point, so a reversed reader produces the same bytes", () => {
    const forward = buildPluginTree(skills).map((a) => a.path);
    const reversed = buildPluginTree([...skills].reverse()).map((a) => a.path);
    expect(reversed).toEqual(forward);
  });

  it("refuses an empty skill list", () => {
    expect(() => buildPluginTree([])).toThrow(/no skills/u);
  });

  it("refuses two artifacts claiming one path", () => {
    expect(() =>
      buildPluginTree([
        { path: "skills/developer-os-capture/SKILL.md", contents: "a" },
        { path: "skills/developer-os-capture/SKILL.md", contents: "b" },
      ]),
    ).toThrow(/one path/u);
  });

  it("ships no hooks file, no AGENTS.md, and no absolute path", () => {
    const tree = buildPluginTree(skills);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.map((a) => a.path)).not.toContain("hooks/hooks.json");
    for (const artifact of tree) {
      expect(artifact.path).not.toContain("AGENTS");
      expect(artifact.contents).not.toMatch(/\/Users\/|\/home\//u);
    }
  });
});
