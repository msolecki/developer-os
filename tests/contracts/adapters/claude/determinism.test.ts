import { describe, expect, it } from "vitest";
import { renderAllForClaude } from "./render-all.js";

/**
 * `docs/architecture/workflow-schema.md` §6 records that DOS-P3 could prove only
 * that a renderer's *inputs* are byte-identical, because it ships no renderer,
 * and names DOS-P4 and DOS-P5 as owing the byte-identity of real vendor
 * artifacts. This is DOS-P4 paying that debt — over the six real workflows and
 * the real renderer, not a stub.
 */
describe("Claude artifacts are byte-identical", () => {
  it("across two renders in one process", async () => {
    expect(await renderAllForClaude()).toEqual(await renderAllForClaude());
  });

  it("under a reversed directory reader", async () => {
    const forward = await renderAllForClaude();
    const reversed = await renderAllForClaude({ reverseDirectoryOrder: true });
    expect(reversed).toEqual(forward);
  });

  /**
   * Serialised rather than joined with a separator. The first version used a
   * literal NUL as that separator, and `tests/repository/control-bytes.test.ts`
   * failed the build on it — that gate exists because this repository already
   * shipped a NUL used as a map-key separator, and it caught the same mistake
   * a second time, here.
   */
  it("byte for byte, not merely structurally", async () => {
    const forward = await renderAllForClaude();
    const reversed = await renderAllForClaude({ reverseDirectoryOrder: true });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("renders all six workflows, so byte-identity is not over an empty set", async () => {
    const skills = (await renderAllForClaude()).filter((artifact) =>
      artifact.path.endsWith("SKILL.md"),
    );
    expect(skills).toHaveLength(6);
  });
});
