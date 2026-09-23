import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { CODEX_HOOKS_PATH, withCodexHooks } from "./hooks.js";
import {
  buildPluginTree,
  PLUGIN_NAME,
  PLUGIN_TREE_PREFIX,
  PLUGIN_TREE_SEGMENTS,
} from "./plugin.js";
import type { MarketplaceRootArtifact } from "./plugin.js";

const EXE = { node: "/usr/local/bin/node", entrypoint: "/Users/synthetic/.developer-os/bin/developer-os" };

const rerooted = (tree: readonly RenderedArtifact[]): readonly MarketplaceRootArtifact[] =>
  tree.map((a) => ({ path: posix.join(PLUGIN_TREE_PREFIX, a.path), contents: a.contents }) as MarketplaceRootArtifact);

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

  it("emits a manifest with exactly the fields Codex architecture former §14.4 names and no others", () => {
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

  it("ships no hooks file, no manifest hooks key, no AGENTS.md, and no absolute path", () => {
    const tree = buildPluginTree(skills);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.map((a) => a.path)).not.toContain(CODEX_HOOKS_PATH);
    const manifest = tree.find((a) => a.path === ".codex-plugin/plugin.json");
    expect(JSON.parse(manifest?.contents ?? "{}")).not.toHaveProperty("hooks");
    for (const artifact of tree) {
      expect(artifact.path).not.toContain("AGENTS");
      expect(artifact.contents).not.toMatch(/\/Users\/|\/home\//u);
    }
  });

  it("puts hooks only in the install tree, referenced from the manifest", () => {
    const install = withCodexHooks(rerooted(buildPluginTree(skills)), EXE);
    const paths = install.map((a) => a.path);
    expect(paths).toContain(posix.join(PLUGIN_TREE_PREFIX, CODEX_HOOKS_PATH));
    const manifest = install.find((a) => a.path === posix.join(PLUGIN_TREE_PREFIX, ".codex-plugin/plugin.json"));
    expect(JSON.parse(manifest?.contents ?? "{}")).toMatchObject({ hooks: "./hooks/hooks.json", skills: "skills" });
    expect(paths).toStrictEqual([...paths].sort(compareCodePoints));
    expect(() => withCodexHooks(install, EXE)).toThrow(/already/u);
    expect(() => withCodexHooks([], EXE)).toThrow(/manifest/u);
  });
});
