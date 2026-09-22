import { describe, expect, it } from "vitest";
import { loadRepositoryWorkflows } from "../claude/render-all.js";
import { renderAllForCodex } from "./render-all.js";

const isWorkflowSkill = (path: string): boolean =>
  path.startsWith("skills/developer-os-") && path.endsWith("/SKILL.md");

describe("Codex artifacts are byte-identical", () => {
  it("across two renders in one process", async () => {
    expect(await renderAllForCodex()).toEqual(await renderAllForCodex());
  });

  it("under a reversed directory reader", async () => {
    expect(await renderAllForCodex({ reverseDirectoryOrder: true })).toEqual(
      await renderAllForCodex(),
    );
  });

  it("renders every workflow, so byte-identity is not over an empty set", async () => {
    const workflows = await loadRepositoryWorkflows();
    expect(workflows.length).toBeGreaterThan(0);
    expect((await renderAllForCodex()).filter((a) => isWorkflowSkill(a.path))).toHaveLength(
      workflows.length,
    );
  });
});
