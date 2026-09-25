import { describe, expect, it } from "vitest";

import { planRefactor } from "./plan.js";
import { memoryInput, noteText } from "./testing.js";

const T_BODY = "\nT body";
const T_TEXT = noteText({ title: "Target", body: "T body" });
const T_HEADER = T_TEXT.slice(0, T_TEXT.length - `${T_BODY}\n`.length);

describe("planMerge", () => {
  it("appends the source body under its title, keeps the target header byte-exact, graveyards the source and retargets links", async () => {
    const S_TEXT = noteText({ title: "Source", body: "\nS body\n\n" });
    const plan = await planRefactor(
      { mode: "merge", source: "DEV/s.md", target: "DEV/t.md" },
      memoryInput({
        "DEV/s.md": S_TEXT,
        "DEV/t.md": T_TEXT,
        "DEV/r.md": noteText({ title: "R", body: "[[DEV/s]]" }),
      }),
    );
    const target = plan.mutations.find((m) => m.path === "DEV/t.md");
    expect(target?.content).toBe(`${T_HEADER}${T_BODY}\n\n## Source\n\nS body\n`);
    expect(target?.before).toBe(T_TEXT);
    expect(plan.mutations.map((m) => [m.operation, m.path])).toStrictEqual([
      ["replace", "DEV/r.md"],
      ["remove", "DEV/s.md"],
      ["replace", "DEV/t.md"],
      ["create", "_graveyard/DEV/s.md"],
    ]);
    expect(plan.mutations.find((m) => m.path === "_graveyard/DEV/s.md")?.content).toBe(S_TEXT);
    expect(plan.mutations.find((m) => m.path === "DEV/r.md")?.content).toContain("[[t]]");
    expect(plan.rewrittenLinks).toBe(1);
  });

  it("merges a pair that links each other: the collapsed link becomes a self-edge, not a lost link", async () => {
    const plan = await planRefactor(
      { mode: "merge", source: "DEV/s.md", target: "DEV/t.md" },
      memoryInput({
        "DEV/s.md": noteText({ title: "Source", body: "see [[t]]" }),
        "DEV/t.md": noteText({ title: "Target", body: "see [[s]]" }),
      }),
    );
    expect(plan.mutations.map((m) => [m.operation, m.path])).toContainEqual(["remove", "DEV/s.md"]);
  });

  it("merges a source that links its target", async () => {
    const plan = await planRefactor(
      { mode: "merge", source: "DEV/s.md", target: "DEV/t.md" },
      memoryInput({
        "DEV/s.md": noteText({ title: "Source", body: "see [[t]]" }),
        "DEV/t.md": T_TEXT,
      }),
    );
    expect(plan.mutations.map((m) => [m.operation, m.path])).toContainEqual(["remove", "DEV/s.md"]);
  });

  it("refuses merging a note into itself as brain_refactor_input_invalid", async () => {
    await expect(
      planRefactor(
        { mode: "merge", source: "DEV/t.md", target: "DEV/t.md" },
        memoryInput({ "DEV/t.md": T_TEXT }),
      ),
    ).rejects.toMatchObject({ reason: "brain_refactor_input_invalid" });
  });
});
