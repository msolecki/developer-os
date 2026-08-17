import { describe, expect, it } from "vitest";

import { globMatches } from "./glob.js";

describe("globMatches", () => {
  it("matches the resolved scope globs the ingest contract actually declares", () => {
    for (const path of ["content/a.md", "content/DEV/a.md", "content/DEV/sub/a.md"]) {
      expect(globMatches("content/**", path), path).toBe(true);
    }
    expect(globMatches("content/_indexes/**", "content/_indexes/index.json")).toBe(true);
  });

  it("does not match a sibling whose name merely starts with the pattern's", () => {
    /** `content` is a prefix of `contents`, and a substring match would let it through. */
    expect(globMatches("content/**", "contents/a.md")).toBe(false);
    expect(globMatches("content/**", "notes/a.md")).toBe(false);
  });

  it("refuses a path outside a narrowed scope", () => {
    expect(globMatches("content/QA/**", "content/QA/a.md")).toBe(true);
    expect(globMatches("content/QA/**", "content/DEV/a.md")).toBe(false);
  });

  it("reads a backslash as an escape, which is how a configured root arrives", () => {
    /**
     * `resolveScopeGlob` escapes the ten glob metacharacters when it splices a
     * `BrainConfigV1.contentRoot` into a vocabulary glob, so a vault whose
     * content root is `!inbox` hands this function `\!inbox/**`. Without the
     * escape branch that pattern matches nothing and the gate refuses every
     * note in a perfectly ordinary vault.
     */
    expect(globMatches("\\!inbox/**", "!inbox/a.md")).toBe(true);
    expect(globMatches("\\!inbox/**", "inbox/a.md")).toBe(false);
    expect(globMatches("\\*literal/**", "*literal/a.md")).toBe(true);
    expect(globMatches("\\*literal/**", "anything/a.md")).toBe(false);
  });

  it("matches `*` within one segment and never across a separator", () => {
    expect(globMatches("content/*.md", "content/a.md")).toBe(true);
    expect(globMatches("content/*.md", "content/DEV/a.md")).toBe(false);
    expect(globMatches("content/DE*/a.md", "content/DEV/a.md")).toBe(true);
    expect(globMatches("content/DE*/a.md", "content/QA/a.md")).toBe(false);
    /** A run of stars inside a segment is one star, not a segment-spanning `**`. */
    expect(globMatches("content/a**b/x.md", "content/aQQb/x.md")).toBe(true);
    expect(globMatches("content/a**b/x.md", "content/a/Q/b/x.md")).toBe(false);
  });

  it("spans zero or more segments for a `**` that is not the last one", () => {
    for (const path of ["content/a.md", "content/DEV/a.md", "content/DEV/sub/a.md"]) {
      expect(globMatches("content/**/a.md", path), path).toBe(true);
    }
    expect(globMatches("content/**/a.md", "content/DEV/b.md")).toBe(false);
    expect(globMatches("**/a.md", "a.md")).toBe(true);
  });

  it("treats every picomatch operator except `*` and `**` as a literal", () => {
    /**
     * **A second glob dialect, stated rather than discovered.** `resolveScopeGlob`
     * escapes its output for picomatch, which reads `?`, `[…]`, `{…}` and a
     * leading `!` as operators; this matcher reads all four as ordinary
     * characters. The divergence is safe in the only direction that matters — a
     * pattern this function under-matches refuses paths a real glob would
     * accept, never the reverse — and every glob it is fed today is built from
     * `content`, `_indexes` and an escaped configured root. Pinned so a future
     * pattern using one of these is a failing test rather than a silent
     * mismatch.
     */
    expect(globMatches("content/a?.md", "content/ab.md")).toBe(false);
    expect(globMatches("content/a?.md", "content/a?.md")).toBe(true);
    expect(globMatches("content/[ab].md", "content/a.md")).toBe(false);
    expect(globMatches("content/[ab].md", "content/[ab].md")).toBe(true);
    expect(globMatches("content/{a,b}.md", "content/a.md")).toBe(false);
    expect(globMatches("!content/**", "content/a.md")).toBe(false);
    expect(globMatches("!content/**", "!content/a.md")).toBe(true);
  });

  it("terminates on a pattern with many stars and no match", () => {
    /**
     * The matcher memoizes visited `(part, offset)` pairs rather than
     * backtracking freely, so a pattern a naive matcher explores exponentially
     * costs a polynomial number of states here. A hang is the failure this
     * pins; the assertion is that it answers at all.
     */
    /**
     * `*a*a*…` with twelve `a`s needs twelve of them, so a segment carrying
     * eleven is the case that makes the search explore every split and still
     * answer no — the shape a naive matcher hangs on.
     */
    const pattern = `content/*${"a*".repeat(12)}/x.md`;
    expect(globMatches(pattern, `content/${"a".repeat(12)}z/x.md`)).toBe(true);
    expect(globMatches(pattern, `content/${"a".repeat(11)}z/x.md`)).toBe(false);
    expect(globMatches("**/**/**/**/**/x.md", "content/DEV/sub/deep/y.md")).toBe(false);
  });

  it("matches the root itself for a trailing `**`, and nothing above it", () => {
    expect(globMatches("content/**", "content")).toBe(true);
    expect(globMatches("content/**", "")).toBe(false);
  });
});
