import { describe, expect, it } from "vitest";

import { selectGardenTargets } from "./select.js";
import { gap, isolated, note } from "./testing.js";

describe("selectGardenTargets", () => {
  it("picks at most two gap tags with at least four notes and no compiled note, largest first", () => {
    const notes = [
      ...["a", "b", "c", "d", "e"].map((n) => note(`content/DEV/${n}.md`, { tags: ["testing"] })),
      ...["f", "g", "h", "i"].map((n) => note(`content/DEV/${n}.md`, { tags: ["git"] })),
      ...["j", "k", "l"].map((n) => note(`content/DEV/${n}.md`, { tags: ["tiny"] })),
      ...["m", "n", "o", "p"].map((n) => note(`content/DEV/${n}.md`, { tags: ["covered"] })),
      note("content/DEV/hub.md", { tags: ["covered"], type: "compiled-note" }),
      ...["q", "r", "s", "t", "u", "v"].map((n) => note(`content/DEV/${n}.md`, { tags: ["react"] })),
    ];
    const findings = ["testing", "git", "tiny", "covered", "react"].map((tag) => gap(tag));
    expect(selectGardenTargets({ notes, findings, pendingNotePaths: new Set() }).gaps.map((g) => g.tag)).toEqual(["react", "testing"]);
  });

  it("picks the five oldest isolated notes and skips ones a quarantined capture names", () => {
    const notes = Array.from({ length: 7 }, (_, i) => note(`content/DEV/n${String(i)}.md`, { created: `2026-0${String(i + 1)}-01` }));
    const findings = notes.map((n) => isolated(n.path));
    const targets = selectGardenTargets({ notes, findings, pendingNotePaths: new Set(["DEV/n0.md"]) });
    expect(targets.isolated).toEqual(["DEV/n1.md", "DEV/n2.md", "DEV/n3.md", "DEV/n4.md", "DEV/n5.md"]);
  });

  /**
   * Controller ruling 2: gaps are derived from `notes`; a lint `gap` finding only
   * filters, and only when its tag is recoverable from the message.
   */
  it("derives gaps from notes and uses gap findings only as a filter (ruling 2)", () => {
    const notes = [
      ...["a", "b", "c"].map((n) => note(`content/DEV/${n}.md`, { tags: ["three"] })),
      ...["d", "e", "f", "g", "h"].map((n) => note(`content/DEV/${n}.md`, { tags: ["unflagged"] })),
      ...["i", "j", "k", "l"].map((n) => note(`content/DEV/${n}.md`, { tags: ["flagged"] })),
    ];
    // lint's own threshold is 3, so it flags `three`; the gardener's is 4.
    const findings = [gap("three", 3), gap("flagged")];
    const targets = selectGardenTargets({ notes, findings, pendingNotePaths: new Set() });
    expect(targets.gaps).toEqual([
      { tag: "flagged", notePaths: ["DEV/i.md", "DEV/j.md", "DEV/k.md", "DEV/l.md"] },
    ]);
  });

  it("folds pending note paths before comparing them (Ruling 12)", () => {
    const notes = [note("content/DEV/n0.md"), note("content/DEV/n1.md", { created: "2026-02-01" })];
    const targets = selectGardenTargets({ notes, findings: notes.map((n) => isolated(n.path)), pendingNotePaths: new Set(["dev/N0.md"]) });
    expect(targets.isolated).toEqual(["DEV/n1.md"]);
  });
});
