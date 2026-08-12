import { describe, expect, it } from "vitest";

import { capGraphemes, screenAndCap, screenControlCharacters } from "./screen.js";

/** The same segmenter the module uses, for tests that count clusters. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

describe("screenControlCharacters", () => {
  it("turns a structural control into a space, never into nothing", () => {
    /**
     * `\r` returns the cursor to column zero, so the value overwrites the row
     * printed above it. It becomes a space rather than disappearing: deleting
     * it would join the text on either side into one word and change what the
     * value says.
     */
    for (const hostile of ["a\rb", "a\u0000b", "a\u001Fb", "a\u009Fb"]) {
      expect(screenControlCharacters(hostile), JSON.stringify(hostile)).toBe("a b");
    }
  });

  it("deletes an invisible format character rather than spacing it", () => {
    /**
     * The opposite policy, for the opposite reason: these render as nothing, so
     * replacing one with a space invents a break the author never wrote —
     * `co\u00ADop` is one word and `co op` is two. U+202E is the one that
     * matters, reordering the rest of the printed line (CVE-2021-42574).
     */
    for (const hostile of ["a\u202Eb", "a\u200Bb", "a\u00ADb"]) {
      expect(screenControlCharacters(hostile), JSON.stringify(hostile)).toBe("ab");
    }
  });

  it("does not match a control character with the whitespace class", () => {
    /**
     * The reason `\s` is not enough, asserted rather than asserted-in-a-comment.
     * If someone simplifies the pattern to `\s+` this goes red.
     */
    expect(/\s/u.test("\u202E")).toBe(false);
    expect(/\s/u.test("\u200B")).toBe(false);
    expect(screenControlCharacters("\u202E")).toBe("");
  });

  it("leaves ordinary text alone, including non-Latin scripts", () => {
    expect(screenControlCharacters("zażółć gęślą jaźń")).toBe("zażółć gęślą jaźń");
    expect(screenControlCharacters("  spaced   out  ")).toBe("spaced out");
  });
});

describe("capGraphemes", () => {
  it("never splits a grapheme cluster", () => {
    /**
     * A family emoji is one grapheme built from seven code points and eleven
     * UTF-16 code units. `slice` would cut it into a lone surrogate, which a
     * JSON writer either mangles to U+FFFD or refuses.
     */
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const capped = capGraphemes(family.repeat(4), 2);
    expect(capped).toBe(`${family.repeat(2)}…`);
    /** No lone surrogate: a half-cut pair is exactly what `slice` would leave. */
    expect(capped.isWellFormed()).toBe(true);
  });

  it("adds an ellipsis only when it actually dropped something", () => {
    expect(capGraphemes("abc", 3)).toBe("abc");
    expect(capGraphemes("abcd", 3)).toBe("abc…");
  });

  it("counts graphemes, not code units", () => {
    /** Ten combining marks on one base letter are one grapheme, twenty-two code units. */
    const one = `e${"\u0301".repeat(10)}`;
    expect(one.length).toBeGreaterThan(10);
    expect(capGraphemes(one, 10)).toBe(one);
  });
});

describe("screenAndCap", () => {
  it("screens before it caps, so a control character cannot consume the budget", () => {
    /**
     * Order is the whole of this function. Capping first would count the eight
     * NULs against the bound and return a truncated `aaaa`; screening first
     * collapses them to one space and the real text survives.
     */
    const value = `aaaa${"\u0000".repeat(8)}bbbb`;
    expect(screenAndCap(value, 10)).toBe("aaaa bbbb");
  });
});

describe("what the screen must not destroy", () => {
  it("keeps a joined emoji whole", () => {
    /**
     * U+200D is a format character and the first version of this screen removed
     * it, turning one grapheme into three people separated by spaces. An emoji
     * in a note title is ordinary text, not an attack: a joiner cannot reorder,
     * hide or truncate a printed line.
     */
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(screenControlCharacters(family)).toBe(family);
    expect([...GRAPHEMES.segment(screenControlCharacters(family))]).toHaveLength(1);
  });

  it("still removes every other format character, joiner or not", () => {
    /** The exemption is one code point wide. U+200B is not U+200D. */
    expect(screenControlCharacters("a\u200Bb")).toBe("ab");
    expect(screenControlCharacters("a\u202Eb")).toBe("ab");
  });

  it("degrades a subdivision flag rather than corrupting it, by choice", () => {
    /**
     * The emoji tag block is invisible and not exempt, so a Scotland flag comes
     * back as the black flag it is built on. Pinned because it is a decision:
     * a visible, harmless loss is acceptable where splitting a cluster is not.
     */
    const scotland =
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(screenControlCharacters(scotland)).toBe("\u{1F3F4}");
  });
});

describe("capGraphemes at exactly the bound", () => {
  it("adds no ellipsis when the input ends on the bound", () => {
    /**
     * The defect this pins: the loop filling its budget was read as the input
     * being longer than the budget, so three emoji capped at three came back as
     * four characters claiming a truncation that never happened. ASCII returns
     * from the length fast path before reaching that branch, which is why the
     * first round of tests missed it and review did not.
     */
    const grin = "\u{1F600}";
    expect(capGraphemes(grin.repeat(3), 3)).toBe(grin.repeat(3));
    expect(capGraphemes(`${"a".repeat(199)}${grin}`, 200)).toBe(
      `${"a".repeat(199)}${grin}`,
    );
    expect(capGraphemes(grin.repeat(4), 3)).toBe(`${grin.repeat(3)}…`);
  });

  it("returns the same answer with or without the length fast path", () => {
    /**
     * The fast path is an optimisation and the comment says so. This is what
     * makes that claim checkable: the same inputs through a deliberately slow
     * reimplementation must agree, including the ones the fast path would have
     * short-circuited. An earlier version of the comment claimed the same thing
     * while the fast path was in fact hiding the defect above.
     */
    const slow = (value: string, max: number): string => {
      const kept: string[] = [];
      for (const { segment } of GRAPHEMES.segment(value)) {
        if (kept.length > max) break;
        kept.push(segment);
      }
      return kept.length <= max ? value : `${kept.slice(0, max).join("")}…`;
    };

    const grin = "\u{1F600}";
    const cases: readonly (readonly [string, number])[] = [
      ["", 5],
      ["abc", 3],
      ["abcd", 3],
      [grin.repeat(3), 3],
      [grin.repeat(4), 3],
      ["zażółć", 4],
      [`e${"\u0301".repeat(10)}`, 1],
    ];
    for (const [value, max] of cases) {
      expect(capGraphemes(value, max), JSON.stringify([value, max])).toBe(
        slow(value, max),
      );
    }
  });
});
