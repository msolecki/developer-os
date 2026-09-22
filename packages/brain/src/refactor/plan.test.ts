import { describe, expect, it } from "vitest";

import { MAX_REFACTOR_MUTATIONS, planRefactor } from "./plan.js";
import type { RefactorRequestV1 } from "./plan.js";
import { memoryInput, noteText } from "./testing.js";

const DONE = noteText({ title: "Done" });
const OTHER = noteText({ title: "Other" });

describe("planRefactor", () => {
  it("retires a note nobody links to or cites: remove + create under _graveyard, bytes unchanged", async () => {
    const input = memoryInput({ "PROJECTS/done.md": DONE, "DEV/other.md": OTHER });
    const plan = await planRefactor({ mode: "retire", note: "PROJECTS/done.md" }, input);
    expect(plan.mutations).toStrictEqual([
      { operation: "remove", path: "PROJECTS/done.md", content: null, before: DONE },
      { operation: "create", path: "_graveyard/PROJECTS/done.md", content: DONE, before: null },
    ]); // byte order: "P" (0x50) sorts before "_" (0x5F)
    expect(plan.rewrittenLinks).toBe(0);
  });

  it("refuses retire_has_referrers when another note links to it or lists it in sources", async () => {
    const others = [
      noteText({ title: "O", body: "[[PROJECTS/done]]" }),
      noteText({ title: "O", sources: ["PROJECTS/done.md"] }),
    ];
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      await expect(
        planRefactor(
          { mode: "retire", note: "PROJECTS/done.md" },
          memoryInput({ "PROJECTS/done.md": DONE, "DEV/o.md": other }),
        ),
      ).rejects.toMatchObject({ reason: "retire_has_referrers", paths: ["DEV/o.md"] });
    }
  });

  it("renames and rewrites only links that no longer resolve, keeping |display and #anchor", async () => {
    const input = memoryInput({
      "DEV/b.md": noteText({ title: "Bee" }),
      "DEV/a.md": noteText({ title: "A", body: "[[DEV/b#h|shown]] [[Bee]] `[[DEV/b]]`" }),
    });
    const plan = await planRefactor({ mode: "rename", note: "DEV/b.md", newName: "c.md" }, input);
    const a = plan.mutations.find((m) => m.path === "DEV/a.md");
    expect(a?.content).toContain("[[c#h|shown]] [[Bee]] `[[DEV/b]]`"); // title-tier and code-span untouched
    expect(plan.rewrittenLinks).toBe(1);
    expect(plan.mutations.map((m) => [m.operation, m.path])).toStrictEqual([
      ["replace", "DEV/a.md"],
      ["remove", "DEV/b.md"],
      ["create", "DEV/c.md"],
    ]);
  });

  it("writes the full path when the basename would be ambiguous after the move", async () => {
    const input = memoryInput({
      "DEV/x.md": noteText({ title: "X in dev" }),
      "TOOLS/x.md": noteText({ title: "X in tools" }),
      "DEV/a.md": noteText({ title: "A", body: "See [[DEV/x]]." }),
    });
    const plan = await planRefactor({ mode: "move", note: "DEV/x.md", folder: "INFRA" }, input);
    const a = plan.mutations.find((m) => m.path === "DEV/a.md");
    expect(a?.content).toContain("See [[INFRA/x]].");
    expect(plan.mutations.some((m) => m.operation === "create" && m.path === "INFRA/x.md")).toBe(true);
  });

  it("refuses a destination that exists", async () => {
    const input = memoryInput({
      "DEV/b.md": noteText({ title: "Bee" }),
      "DEV/c.md": noteText({ title: "Sea" }),
    });
    await expect(
      planRefactor({ mode: "rename", note: "DEV/b.md", newName: "c.md" }, input),
    ).rejects.toMatchObject({ reason: "refactor_destination_exists", paths: ["DEV/c.md"] });
  });

  it.each([
    ["a non-note", { mode: "rename", note: "DEV/missing.md", newName: "c.md" }],
    ["a slash in new-name", { mode: "rename", note: "DEV/b.md", newName: "x/c.md" }],
    ["an unknown folder", { mode: "move", note: "DEV/b.md", folder: "NOPE" }],
    ["a merge of a note into itself", { mode: "merge", source: "DEV/b.md", target: "DEV/b.md" }],
  ] as const)("refuses %s as brain_refactor_input_invalid", async (_label, request: RefactorRequestV1) => {
    const input = memoryInput({ "DEV/b.md": noteText({ title: "Bee" }) });
    await expect(planRefactor(request, input)).rejects.toMatchObject({
      reason: "brain_refactor_input_invalid",
    });
  });

  it("refuses refactor_postcondition_failed when the projection gains an error finding", async () => {
    // Sources are never rewritten (no frontmatter is edited), so the citation stops resolving.
    const input = memoryInput({
      "DEV/b.md": noteText({ title: "Bee" }),
      "DEV/a.md": noteText({ title: "A", sources: ["DEV/b.md"] }),
    });
    await expect(
      planRefactor({ mode: "rename", note: "DEV/b.md", newName: "c.md" }, input),
    ).rejects.toMatchObject({ reason: "refactor_postcondition_failed", paths: ["DEV/a.md"] });
  });

  it("refuses refactor_too_wide above 256 mutations before returning a plan", async () => {
    const notes: Record<string, string> = { "PROJECTS/done.md": DONE };
    for (let i = 0; i < MAX_REFACTOR_MUTATIONS; i += 1) {
      const id = String(i).padStart(3, "0");
      notes[`DEV/r${id}.md`] = noteText({ title: `R${id}`, body: "[[PROJECTS/done]]" });
    }
    // 256 referrers → 256 replace + remove + create = 258 mutations.
    await expect(
      planRefactor({ mode: "rename", note: "PROJECTS/done.md", newName: "next.md" }, memoryInput(notes)),
    ).rejects.toMatchObject({ reason: "refactor_too_wide" });
  });

  it("plans identically under a reversed directory reader", async () => {
    const notes = {
      "DEV/b.md": noteText({ title: "Bee" }),
      "DEV/a.md": noteText({ title: "A", body: "[[DEV/b]] and [[b|bee]]" }),
      "TOOLS/t.md": noteText({ title: "T", body: "[[DEV/b#x]]" }),
    };
    const request: RefactorRequestV1 = { mode: "move", note: "DEV/b.md", folder: "QA" };
    const forward = await planRefactor(request, memoryInput(notes));
    const reversed = await planRefactor(request, memoryInput(notes, { reversed: true }));
    expect(forward.mutations.length).toBeGreaterThan(0);
    expect(reversed).toStrictEqual(forward);
  });

  it("dispatches merge and split to their planners", async () => {
    const input = memoryInput({
      "DEV/b.md": noteText({ title: "Bee", body: "## H\n\nh" }),
      "DEV/c.md": OTHER,
    });
    const merge = await planRefactor({ mode: "merge", source: "DEV/b.md", target: "DEV/c.md" }, input);
    const split = await planRefactor({ mode: "split", note: "DEV/b.md", heading: "H" }, input);
    expect(merge.mode).toBe("merge");
    expect(split.mutations.some((m) => m.operation === "create" && m.path === "DEV/h.md")).toBe(true);
  });
});
