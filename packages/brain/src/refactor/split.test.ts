import { describe, expect, it } from "vitest";

import { planRefactor } from "./plan.js";
import { splitSlug } from "./split.js";
import { memoryInput, noteText } from "./testing.js";

/** 600 characters, but the slug is "a": only an explicit bound refuses it (spec §6.1). */
const LONG_HEADING = `a${"!".repeat(599)}`;
const PARENT_BODY = "\n## Intro\n\ni\n\n## Deep Dive\n\nd\n\n### Sub\n\ns\n\n## Next\n\nn\n";

describe("planSplit", () => {
  it("moves the section to <dir>/<slug>.md with fresh frontmatter and leaves See [[slug]].", async () => {
    const plan = await planRefactor(
      { mode: "split", note: "DEV/p.md", heading: "Deep Dive" },
      memoryInput(
        {
          "DEV/p.md": noteText({ title: "Parent", tags: ["x"], type: "knowledge-note", body: PARENT_BODY }),
          "DEV/r.md": noteText({ title: "R", body: "[[DEV/p#Deep Dive|see]] [[DEV/p#Intro]]" }),
        },
        { today: "2026-09-22" },
      ),
    );
    const child = plan.mutations.find((m) => m.path === "DEV/deep-dive.md");
    expect(child?.content).toMatch(/^---\nschemaVersion: 1\ntitle: Deep Dive\ntype: knowledge-note\n/u);
    expect(child?.content).toContain("created: 2026-09-22");
    expect(child?.content).toContain("stage: emerging");
    expect(child?.content).toContain("reviewed: null");
    expect(child?.content).toContain("summary: Split from Parent.");
    expect(child?.content).toContain("## Deep Dive\n\nd\n\n### Sub\n\ns\n");
    const parent = plan.mutations.find((m) => m.path === "DEV/p.md")?.content;
    expect(parent).toContain("i\n\nSee [[deep-dive]].\n\n## Next\n\nn\n");
    expect(parent).not.toContain("### Sub");
    const referrer = plan.mutations.find((m) => m.path === "DEV/r.md")?.content;
    expect(referrer).toContain("[[deep-dive|see]] [[DEV/p#Intro]]");
    expect(plan.rewrittenLinks).toBe(1);
  });

  const cases = [
    ["absent", "## Other\n\no", "Deep Dive", "brain_refactor_input_invalid"],
    ["ambiguous: two ## Deep Dive", "## Deep Dive\n\na\n\n## Deep Dive\n\nb", "Deep Dive", "brain_refactor_input_invalid"],
    ["a level-1 heading", "# Deep Dive\n\na", "Deep Dive", "brain_refactor_input_invalid"],
    ["a heading inside fenced code", "```\n## Deep Dive\n```", "Deep Dive", "brain_refactor_input_invalid"],
    ["an empty slug: ## ---", "## ---\n\na", "---", "brain_refactor_input_invalid"],
    ["an occupied slug path", "## Deep Dive\n\na", "Deep Dive", "refactor_destination_exists"],
    ["a heading over 512 characters whose slug is short", `## ${LONG_HEADING}\n\na`, LONG_HEADING, "brain_refactor_input_invalid"],
  ] as const;
  it.each(cases)("refuses %s", async (_label, body, heading, reason) => {
    expect(cases.length).toBeGreaterThan(0);
    const input = memoryInput({
      "DEV/p.md": noteText({ title: "Parent", body }),
      "DEV/deep-dive.md": noteText({ title: "Taken" }),
    });
    await expect(planRefactor({ mode: "split", note: "DEV/p.md", heading }, input)).rejects.toMatchObject({
      reason,
    });
  });

  it("slugs NFC lower-case with runs of non-alphanumerics collapsed and trimmed", () => {
    expect(splitSlug("  Deep -- Dive! ")).toBe("deep-dive");
    expect(splitSlug("Zéro Łódź 2")).toBe("zéro-łódź-2");
    expect(splitSlug("---")).toBe("");
  });
});
