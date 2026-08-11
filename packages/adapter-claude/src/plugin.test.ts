import { describe, expect, it } from "vitest";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { buildPluginTree, PLUGIN_NAME } from "./plugin.js";

const skills: readonly RenderedArtifact[] = [
  { path: "skills/developer-os-capture/SKILL.md", contents: "# capture\n" },
  { path: "skills/developer-os-shared/SKILL.md", contents: "# shared\n" },
];

function find(
  tree: readonly RenderedArtifact[],
  path: string,
): RenderedArtifact {
  const found = tree.find((artifact) => artifact.path === path);
  if (found === undefined) throw new Error(`missing artifact: ${path}`);
  return found;
}

describe("buildPluginTree", () => {
  /**
   * Spec §14.1: `name` is the only required manifest field, and unrecognized
   * fields are ignored at load. Spec §5.2 keeps the version floor low by
   * depending on none of `displayName` (2.1.143), `defaultEnabled` (2.1.154) or
   * `metadata` (2.1.222) — so the minimal manifest is the mechanism, and this
   * test is what stops a later convenience field raising the floor unnoticed.
   */
  it("emits a manifest carrying only the required field", () => {
    const manifest = find(
      buildPluginTree(skills),
      ".claude-plugin/plugin.json",
    );
    expect(JSON.parse(manifest.contents)).toEqual({ name: PLUGIN_NAME });
  });

  it("emits hooks for exactly the three declared events", () => {
    const hooks = find(buildPluginTree(skills), "hooks/hooks.json");
    const parsed = JSON.parse(hooks.contents) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(parsed.hooks).sort()).toEqual([
      "PreCompact",
      "SessionEnd",
      "SessionStart",
    ]);
  });

  it("uses only command handlers, which are the only kind that run", () => {
    const hooks = find(buildPluginTree(skills), "hooks/hooks.json");
    const types = [...hooks.contents.matchAll(/"type":\s*"([a-z_]+)"/gu)].map(
      (match) => match[1],
    );
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["command"]));
  });

  /**
   * A public repository must never carry an absolute machine path, and a hook
   * command is the one place a generated artifact would naturally want one.
   */
  it("addresses every hook command through CLAUDE_PLUGIN_ROOT", () => {
    const hooks = find(buildPluginTree(skills), "hooks/hooks.json");
    expect(hooks.contents).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(hooks.contents).not.toMatch(/"command":\s*"\//u);
    expect(hooks.contents).not.toMatch(/\/Users\/|\/home\//u);
  });

  it("carries every skill through unchanged", () => {
    const tree = buildPluginTree(skills);
    for (const skill of skills) expect(tree).toContainEqual(skill);
  });

  it("orders paths identically whatever order the skills arrive in", () => {
    const forward = buildPluginTree(skills).map((a) => a.path);
    const reversed = buildPluginTree([...skills].reverse()).map((a) => a.path);
    expect(reversed).toEqual(forward);
  });

  /**
   * By code point, which is UTF-8 byte order — not the default `<`, which
   * compares UTF-16 code units and puts every code point at or above U+10000
   * below U+E000–U+FFFF. Deterministic inside Node either way; wrong the moment
   * a consumer in another language orders the same set.
   */
  it("orders by code point rather than by UTF-16 code unit", () => {
    const tree = buildPluginTree([
      { path: "skills/\u{10400}/SKILL.md", contents: "a" },
      { path: "skills/\uE000/SKILL.md", contents: "b" },
    ]);
    const paths = tree.map((a) => a.path);
    expect(paths.indexOf("skills/\uE000/SKILL.md")).toBeLessThan(
      paths.indexOf("skills/\u{10400}/SKILL.md"),
    );
  });

  it("emits a non-empty tree, so a scan of it cannot pass by scanning nothing", () => {
    expect(buildPluginTree(skills).length).toBeGreaterThan(0);
  });

  it("emits exactly the skills plus the manifest and the hooks", () => {
    expect(buildPluginTree(skills)).toHaveLength(skills.length + 2);
  });
});
