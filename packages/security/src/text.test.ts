import { describe, expect, it } from "vitest";

import { isVisuallyBlank, perceptualKey } from "./text.js";

/**
 * Every invisible in this file is written as a `\uXXXX` escape.
 * `tests/repository/control-bytes.test.ts` refuses a literal one anywhere in the tree, and
 * a test about invisible characters that cannot be committed is a test nobody runs — an
 * escape is also legible to a reviewer where the character it stands for, by
 * construction, is not.
 */
describe("isVisuallyBlank", () => {
  it("accepts an ordinary title", () => {
    expect(isVisuallyBlank("Deploy keys")).toBe(false);
  });

  it("reports the empty string as blank", () => {
    expect(isVisuallyBlank("")).toBe(true);
  });

  /**
   * The class NEW-10 spelled out, one member per case. A predicate that merely screened
   * `\p{Cf}` let U+3164 HANGUL FILLER through — the character people actually use to make
   * an invisible name — while its message claimed "at least one visible character".
   */
  it.each([
    ["U+0020 space", " "],
    ["U+00A0 no-break space", "\u00A0"],
    ["U+200B zero width space", "\u200B"],
    ["U+00AD soft hyphen", "\u00AD"],
    ["U+3164 hangul filler", "\u3164"],
    ["U+2800 braille pattern blank", "\u2800"],
    ["U+FE0F variation selector", "\uFE0F"],
    ["U+034F combining grapheme joiner", "\u034F"],
    ["U+0301 combining acute alone", "\u0301"],
    ["a run of several", " \u200B\u3164\u00AD"],
  ])("reports %s as blank", (_name, value) => {
    expect(isVisuallyBlank(value)).toBe(true);
  });

  /**
   * The cost this predicate accepts, stated as a case so it is a decision rather than a
   * surprise: a title carrying a base character survives whatever invisibles surround it.
   */
  it.each([
    ["an accented letter", "é"],
    ["a decomposed accented letter", "e\u0301"],
    ["an emoji", "\u{1F600}"],
    ["a zero-width-joined sequence", "\u{1F468}\u200D\u{1F469}"],
    ["a letter wrapped in invisibles", "\u200Ba\u200B"],
  ])("does not report %s as blank", (_name, value) => {
    expect(isVisuallyBlank(value)).toBe(false);
  });
});

describe("perceptualKey", () => {
  /**
   * The defect this exists for. `lint.ts` keyed `duplicates` on the *screened* title, and
   * the screen deletes `\p{Cf}` only — so `Deploy keys` and `Deploy\u3164keys` produced
   * different keys and no duplicate was reported, while `catalog.md` showed two rows a
   * human reads as identical. That is precisely the failure NEW-6 was opened for, one
   * character class over (BACKLOG NEW-11).
   */
  it("groups two titles a reader cannot tell apart", () => {
    expect(perceptualKey("Deploy\u3164keys")).toBe(perceptualKey("Deploykeys"));
    expect(perceptualKey("Deploy\u200Bkeys")).toBe(perceptualKey("Deploykeys"));
    expect(perceptualKey("\u00ADDeploy keys")).toBe(perceptualKey("Deploy keys"));
  });

  /**
   * **No diacritic is removed, and this is the half that is not `isVisuallyBlank`.**
   * Removing the `\p{Mn}` and `\p{Me}` classes wholesale would group `Café` with `Cafe`
   * — two genuinely different titles in every language that uses a diacritic to
   * distinguish words, and the same corruption `screenControlCharacters` is forbidden to
   * introduce. Some marks *are* removed, because the default-ignorable set contains 263 of
   * them; the two cases at the end of this block assert which, so they are decisions
   * rather than surprises.
   */
  it("keeps a diacritic, because it distinguishes words", () => {
    expect(perceptualKey("Café")).not.toBe(perceptualKey("Cafe"));
  });

  it("folds a decomposed spelling onto its composed one", () => {
    expect(perceptualKey("Cafe\u0301")).toBe(perceptualKey("Café"));
  });

  /**
   * **U+200D ZWJ is exempt, and the first version of this key was not.** It is `Cf` and
   * default-ignorable, so it matched twice over and grouped a family emoji with three
   * separate people. Every other screen in this repository carves it out with its own
   * pinned test; this is that rule reached by the same argument.
   */
  it("keeps a zero-width joiner, so a family emoji is not three people", () => {
    expect(perceptualKey("Team \u{1F468}\u200D\u{1F469}\u200D\u{1F467}")).not.toBe(
      perceptualKey("Team \u{1F468}\u{1F469}\u{1F467}"),
    );
  });

  it("keeps a joiner inside a Devanagari half-form, which renders differently", () => {
    expect(perceptualKey("\u0915\u094D\u200D\u0937")).not.toBe(
      perceptualKey("\u0915\u094D\u0937"),
    );
  });

  /**
   * The consequences of removing the default-ignorable set that *are* accepted, asserted
   * so they are decisions rather than surprises a later reader has to rediscover.
   */
  it("groups an emoji with its text presentation, which differ only by U+FE0F", () => {
    expect(perceptualKey("\u2764\uFE0F")).toBe(perceptualKey("\u2764"));
  });

  it("groups across a combining grapheme joiner, which exists to block composition", () => {
    expect(perceptualKey("a\u034F\u0301")).toBe(perceptualKey("a\u0301"));
  });

  /** Whitespace stays: two titles differing by a real space are two titles. */
  it("keeps ordinary whitespace", () => {
    expect(perceptualKey("Deploy keys")).not.toBe(perceptualKey("Deploykeys"));
  });

  it("returns the input unchanged when it carries no invisibles", () => {
    expect(perceptualKey("Deploy keys")).toBe("Deploy keys");
  });

  /**
   * A title that is *only* invisibles keys to the empty string, so two of them group —
   * which is the NEW-10 behaviour this must not undo. `isVisuallyBlank` is what refuses
   * such a title in the first place; this only has to agree with it.
   */
  it("keys an entirely invisible title to the empty string", () => {
    expect(perceptualKey("\u200B\u3164")).toBe("");
  });
});
