import { describe, expect, it } from "vitest";
import { MARKETPLACE_RELATIVE_PATH } from "@developer-os/adapter-codex";
import { detectWorkflowDrift } from "@developer-os/workflow-schema";
import {
  loadRepositoryInstructionDefaults,
  loadRepositoryWorkflows,
} from "../claude/render-all.js";
import { readGeneratedTree, renderAllForCodex } from "./render-all.js";

const isWorkflowSkill = (path: string): boolean =>
  path.startsWith("skills/developer-os-") && path.endsWith("/SKILL.md");
const isInstruction = (path: string): boolean =>
  !path.startsWith(".codex-plugin/") && !path.startsWith("skills/developer-os-");

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

  it("renders one skill per canonical workflow, plus the manifest and the instructions", async () => {
    const paths = (await renderAllForCodex()).map((a) => a.path);
    expect(paths.filter(isWorkflowSkill)).toHaveLength(11);
    expect(paths).toHaveLength(12 + paths.filter(isInstruction).length);
  });

  /**
   * Spec §3.1: the checked-in tree is the default render. Only skills live in the
   * plugin root (commands collapse to them); agent TOML and the `AGENTS.md` block
   * are written under the Codex home instead.
   */
  it("carries every plugin-root instruction the catalog lists, and nothing else", async () => {
    const catalog = await loadRepositoryInstructionDefaults(await loadRepositoryWorkflows());
    const wanted = catalog.artifacts
      .filter((row) => row.vendors.includes("codex") && row.category === "skill")
      .map((row) => `skills/${row.id}/SKILL.md`);
    const rendered = (await renderAllForCodex()).map((a) => a.path).filter(isInstruction);
    expect(rendered.length > 0).toBe(wanted.length > 0);
    for (const path of wanted) expect(rendered, path).toContain(path);
    const onDisk = [...(await readGeneratedTree()).keys()].filter(isInstruction);
    expect(onDisk.sort()).toEqual(rendered.sort());
  });

  it("is byte-identical under a reversed workflow and instruction reader", async () => {
    expect(JSON.stringify(await renderAllForCodex({ reverseDirectoryOrder: true }))).toBe(
      JSON.stringify(await renderAllForCodex()),
    );
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
      ([path]) => isWorkflowSkill(path) && !path.includes("developer-os-shared"),
    );
    expect(skills).toHaveLength(10);
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
