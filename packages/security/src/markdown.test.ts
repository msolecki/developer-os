import { describe, expect, it } from "vitest";
import { boundedProse, fenced, screenParagraphs } from "./markdown.js";

describe("screenParagraphs", () => {
  it("keeps the boundary an author wrote", () => {
    expect(screenParagraphs("one\n\ntwo")).toEqual(["one", "two"]);
  });

  it("splits before screening, because the two do not commute", () => {
    expect(screenParagraphs("one\n \t \ntwo")).toEqual(["one", "two"]);
    expect(screenParagraphs("one\r\n\r\ntwo")).toEqual(["one", "two"]);
  });

  it("does not split on a lone carriage return", () => {
    expect(screenParagraphs("one\r\rtwo")).toEqual(["one two"]);
  });

  it("drops a paragraph that screens to nothing", () => {
    expect(screenParagraphs("one\n\n\u200B\n\ntwo")).toEqual(["one", "two"]);
  });

  it("neutralizes every block construct a paragraph could open", () => {
    const forgeries: readonly (readonly [string, string])[] = [
      ["# heading", "\\# heading"],
      ["> quote", "\\> quote"],
      ["| a | b |", "\\| a | b |"],
      ["```", "\\```"],
      ["~~~", "\\~~~"],
      ["---", "\\---"],
      ["___", "\\___"],
      ["* bullet", "\\* bullet"],
      ["1. ordered", "1\\. ordered"],
      ["9) ordered", "9\\) ordered"],
      ["<script>x</script>", "\\<script>x</script>"],
    ];
    expect(forgeries.length).toBeGreaterThan(0);
    for (const [forged, neutralized] of forgeries) {
      expect(screenParagraphs(forged), forged).toEqual([neutralized]);
    }
  });

  it("leaves ordinary prose alone, so the escape is not a tax on every line", () => {
    expect(screenParagraphs("plain sentence.")).toEqual(["plain sentence."]);
  });
});

describe("boundedProse", () => {
  it("bounds the joined block, not each paragraph", () => {
    const five = Array.from({ length: 5 }, () => "x".repeat(4000)).join("\n\n");
    expect(boundedProse(five, 4096).length).toBeLessThanOrEqual(4097);
    expect(boundedProse(five, 4096)).toContain("…");
  });

  it("returns an empty string when everything screened away", () => {
    expect(boundedProse("\u200B \u00AD", 4096)).toBe("");
  });
});

describe("fenced", () => {
  it("opens with a run longer than the longest inside", () => {
    expect(fenced("```", "text")).toEqual(["````text", "```", "````"]);
  });

  it("uses three backticks when the payload has none", () => {
    expect(fenced("plain", "json")).toEqual(["```json", "plain", "```"]);
  });

  it("counts the longest run, not the first", () => {
    expect(fenced("` and ````", "text")[0]).toBe("`````text");
  });
});
