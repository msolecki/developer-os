import { describe, expect, it } from "vitest";
import { renderAllForCodex } from "./render-all.js";

describe("Codex artifacts are byte-identical", () => {
  it("across two renders in one process", async () => {
    expect(await renderAllForCodex()).toEqual(await renderAllForCodex());
  });

  it("under a reversed directory reader", async () => {
    expect(await renderAllForCodex({ reverseDirectoryOrder: true })).toEqual(
      await renderAllForCodex(),
    );
  });

  it("renders all six workflows, so byte-identity is not over an empty set", async () => {
    expect((await renderAllForCodex()).filter((a) => a.path.endsWith("SKILL.md"))).toHaveLength(6);
  });
});
