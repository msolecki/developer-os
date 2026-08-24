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
   * Claude architecture former §14.1: `name` is the only required manifest field, and unrecognized
   * fields are ignored at load. Claude architecture former §5.2 keeps the version floor low by
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

  /**
   * Claude architecture former §6, as corrected by DOS-P6 and `BACKLOG.md` §8.
   *
   * The tree declared three hooks whose commands lived under a `bin/` directory
   * no task creates, and `claude plugin validate` checks schema rather than
   * existence — so `plugin_hooks` could report `yes` over a dangling path. The
   * Capture hooks remain declined because a hook cannot supply faithful
   * agent-authored observation text without reading the vendor transcript field. An
   * executable bit is not required when a command hook names the installed
   * binary. DOS-P11 owns only the eleven non-capture hooks and must observe any
   * restored hook firing. This assertion makes restoration deliberate.
   */
  it("emits no hooks while capture hooks stay declined and DOS-P11 is unimplemented", () => {
    const paths = buildPluginTree(skills).map((artifact) => artifact.path);
    expect(paths).not.toContain("hooks/hooks.json");
    expect(paths.some((path) => path.startsWith("bin/"))).toBe(false);
  });

  it("emits no absolute machine path anywhere in the tree", () => {
    for (const artifact of buildPluginTree(skills)) {
      expect(artifact.contents).not.toMatch(/\/Users\/|\/home\//u);
    }
  });

  it("refuses to build a tree with no skills", () => {
    expect(() => buildPluginTree([])).toThrow(/no skills/u);
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

  it("emits exactly the skills plus the manifest", () => {
    expect(buildPluginTree(skills)).toHaveLength(skills.length + 1);
  });

  /**
   * A skill's path is built from the workflow's `id`, which comes from the YAML
   * rather than from the directory it sits in, and nothing cross-checks the
   * two. Two artifacts on one path is one file on disk and two entries in the
   * tree — and the drift gate compares unique paths against artifact count, so
   * the inflated total would mask an extra file. Found by fresh-context review,
   * 2026-08-11.
   */
  it("refuses two artifacts claiming one path", () => {
    expect(() =>
      buildPluginTree([
        { path: "skills/developer-os-capture/SKILL.md", contents: "a" },
        { path: "skills/developer-os-capture/SKILL.md", contents: "b" },
      ]),
    ).toThrow(/one path/u);
  });

  it("refuses a skill colliding with the manifest's own path", () => {
    expect(() =>
      buildPluginTree([
        { path: ".claude-plugin/plugin.json", contents: "{}" },
      ]),
    ).toThrow(/one path/u);
  });
});
