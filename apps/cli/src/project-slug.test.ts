import { describe, expect, it } from "vitest";

import { slugify } from "./project-slug.js";

describe("slugify", () => {
  it.each([
    ["प्रोजेक्ट", "प्रोजेक्ट"],
    ["İstanbul", "i̇stanbul"],
    ["Zeitplan Änderung", "zeitplan-änderung"],
    ["--Sample  Project--", "sample-project"],
    ["!!!", "unnamed"],
  ])("keeps combining marks inside a word: %s -> %s (AUD-052)", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates by code point, never leaving a lone surrogate (AUD-053)", () => {
    const astral = "\u{1D49C}";
    const slug = slugify(`${"a".repeat(63)}${astral}b`);

    expect(slug).toBe(`${"a".repeat(63)}${astral}`);
    expect(slug.isWellFormed()).toBe(true);
  });
});
