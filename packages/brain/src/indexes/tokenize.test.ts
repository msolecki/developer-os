import { describe, expect, it } from "vitest";

import { tokenize } from "./tokenize.js";

describe("tokenize", () => {
  it("splits on punctuation and whitespace and drops empties", () => {
    expect(tokenize("Cache  invalidation, on-write!")).toEqual([
      "cache",
      "invalidation",
      "on",
      "write",
    ]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   \n\t  ")).toEqual([]);
    expect(tokenize("---")).toEqual([]);
  });

  it("keeps a non-Latin word whole", () => {
    /**
     * The reason the separator is `\p{L}\p{N}` and not `\w`. Under `\w` every
     * accented letter is a separator, so this word becomes five tokens and no
     * search for it can ever match — silently, for every non-English vault.
     */
    expect(tokenize("za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144")).toEqual(["za\u017c\u00f3\u0142\u0107", "g\u0119\u015bl\u0105", "ja\u017a\u0144"]);
    expect(tokenize("\u0394\u03bf\u03ba\u03b9\u03bc\u03ae \u03ba\u03b5\u03b9\u03bc\u03ad\u03bd\u03bf\u03c5")).toEqual(["\u03b4\u03bf\u03ba\u03b9\u03bc\u03ae", "\u03ba\u03b5\u03b9\u03bc\u03ad\u03bd\u03bf\u03c5"]);
    expect(tokenize("\u65e5\u672c\u8a9e\u306e\u30ce\u30fc\u30c8")).toEqual(["\u65e5\u672c\u8a9e\u306e\u30ce\u30fc\u30c8"]);
  });

  it("keeps digits and mixed alphanumerics as single tokens", () => {
    expect(tokenize("ipv6 2026 v1.2")).toEqual(["ipv6", "2026", "v1", "2"]);
  });

  it("folds the two normalizations of one word to the same token", () => {
    /**
     * macOS hands back NFD from `readdir` and Linux typically NFC. Without the
     * fold, the same word in two checkouts produces two different index terms
     * and the determinism gate fails for a file nobody edited.
     */
    const nfd = "cafe\u0301";
    const nfc = "caf\u00e9";
    expect(nfd).not.toBe(nfc);
    expect(tokenize(nfd)).toEqual(tokenize(nfc));
    expect(tokenize(nfd)[0]).toBe(nfc.toLowerCase());
  });

  it("lowercases without depending on the host locale", () => {
    /**
     * `toLowerCase` is locale-independent; `toLocaleLowerCase` is not. Under a
     * Turkish locale the latter maps `I` to a dotless `ı`, so `INFRA` and
     * `infra` would stop matching on one developer's machine only.
     */
    expect(tokenize("INFRA Infra infra")).toEqual(["infra", "infra", "infra"]);
    expect(tokenize("I")).toEqual(["i"]);
  });

  it("counts every occurrence rather than deduplicating", () => {
    /** `build.ts` needs the repeats: term counts are the body score. */
    expect(tokenize("a b a")).toEqual(["a", "b", "a"]);
  });

  it("does not stem", () => {
    /** Spec §8 states this as a non-goal, not an oversight. */
    expect(tokenize("caching")).not.toEqual(tokenize("cache"));
  });
});
