import { beforeAll, describe, expect, it } from "vitest";

import { tokenize } from "../indexes/index.js";
import type { IndexDocumentV1, IndexedNote } from "../indexes/index.js";
import { NOTE_TYPES } from "../schema/note.js";
import { FIELD_WEIGHTS, FUNNEL_STAGES, search } from "./search.js";
import { indexFixture } from "./testing.js";

let index: IndexDocumentV1;
beforeAll(async () => {
  index = await indexFixture();
});

function indexedNote(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    path: "content/DEV/a.md",
    title: "A note",
    type: "knowledge-note",
    topicFolder: "DEV",
    tags: [],
    aliases: [],
    summary: "",
    stage: "established",
    author: "human",
    reviewed: null,
    occurrences: 0,
    created: "2026-01-01",
    updated: null,
    sources: [],
    contentHash: "0".repeat(64),
    terms: [],
    ...overrides,
  };
}

function documentOf(notes: readonly IndexedNote[]): IndexDocumentV1 {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-04T00:00:00.000Z",
    contentRoot: "content",
    notes,
    folders: [],
    tags: [],
  };
}

describe("search", () => {
  it("returns matches carrying a resolvable path", () => {
    const result = search(index, { text: "caching", maxCandidates: 10 });
    expect(result.kind).toBe("results");
    if (result.kind !== "results") return;
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(index.notes.some((note) => note.path === match.path)).toBe(true);
    }
  });

  it("returns no-candidates rather than falling back to full text", () => {
    /**
     * Spec §8: a silent full-text fallback would make the funnel decorative and
     * produce results nobody can explain the reachability of.
     */
    const result = search(index, { text: "zzzznotpresent", maxCandidates: 10 });
    expect(result.kind).toBe("no-candidates");
    if (result.kind !== "no-candidates") return;
    expect(result.tried).toEqual(["tag", "type", "folder", "title", "alias"]);
    expect(result.tried).toEqual(FUNNEL_STAGES);
  });

  it("returns no-candidates for an empty query", () => {
    const result = search(index, { text: "   ", maxCandidates: 10 });
    expect(result.kind).toBe("no-candidates");
  });

  it("weights a title hit above a body hit", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/body.md",
        title: "Unrelated",
        tags: ["widget"],
        terms: [{ term: "widget", count: 1 }],
      }),
      indexedNote({ path: "content/DEV/title.md", title: "Widget", tags: ["widget"] }),
    ]);
    const result = search(document, { text: "widget", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.path).toBe("content/DEV/title.md");
  });

  it("scores each field at exactly its stated weight", () => {
    /**
     * The weights are a stated contract, not a tuning knob: spec §8 fixes them
     * at title 4, alias 3, tag 3, summary 2, body 1.
     *
     * Reachability comes from the topic folder, which is a stage-1 access path
     * and carries no weight — so each note is a candidate for a reason that
     * cannot contaminate its score. Reaching them by tag instead would add 3 to
     * every row. A summary-only or body-only note is *not* reachable at all,
     * which is the funnel working: stage 1 is structural, and spec §8 refuses a
     * full-text fallback.
     */
    const document = documentOf([
      indexedNote({ path: "content/DEV/1-title.md", title: "dev" }),
      indexedNote({ path: "content/DEV/2-alias.md", title: "x", aliases: ["dev"] }),
      indexedNote({ path: "content/DEV/3-tag.md", title: "x", tags: ["dev"] }),
      indexedNote({ path: "content/DEV/4-summary.md", title: "x", summary: "dev" }),
      indexedNote({
        path: "content/DEV/5-body.md",
        title: "x",
        terms: [{ term: "dev", count: 1 }],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");

    const byPath = new Map(result.matches.map((m) => [m.path, m.score]));
    expect(byPath.get("content/DEV/1-title.md")).toBe(FIELD_WEIGHTS.title);
    expect(byPath.get("content/DEV/2-alias.md")).toBe(FIELD_WEIGHTS.alias);
    expect(byPath.get("content/DEV/3-tag.md")).toBe(FIELD_WEIGHTS.tag);
    expect(byPath.get("content/DEV/4-summary.md")).toBe(FIELD_WEIGHTS.summary);
    expect(byPath.get("content/DEV/5-body.md")).toBe(FIELD_WEIGHTS.body);
    expect(FIELD_WEIGHTS).toEqual({
      title: 4,
      alias: 3,
      tag: 3,
      summary: 2,
      body: 1,
    });
  });

  it("does not reach a note whose only hit is in its summary or body", () => {
    /**
     * The other half of the funnel, and the reason the weights test reaches by
     * folder. Stage 1 is structural; a note carrying the term only in prose is
     * not an access path, and inventing one would be the full-text fallback
     * spec §8 refuses.
     */
    const document = documentOf([
      indexedNote({ path: "content/QA/a.md", topicFolder: "QA", summary: "widget" }),
      indexedNote({
        path: "content/QA/b.md",
        topicFolder: "QA",
        terms: [{ term: "widget", count: 9 }],
      }),
    ]);
    expect(search(document, { text: "widget", maxCandidates: 10 }).kind).toBe(
      "no-candidates",
    );
  });

  it("counts every occurrence, not merely presence", () => {
    const document = documentOf([
      indexedNote({ path: "content/DEV/once.md", title: "widget", tags: ["seed"] }),
      indexedNote({
        path: "content/DEV/thrice.md",
        title: "widget widget widget",
        tags: ["seed"],
      }),
    ]);
    const result = search(document, { text: "widget", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.path).toBe("content/DEV/thrice.md");
    expect(result.matches[0]?.score).toBe(FIELD_WEIGHTS.title * 3);
  });

  it("breaks ties by path so ordering is total", () => {
    const document = documentOf([
      indexedNote({ path: "content/DEV/b.md", title: "tie", tags: ["tie"] }),
      indexedNote({ path: "content/DEV/a.md", title: "tie", tags: ["tie"] }),
    ]);
    const result = search(document, { text: "tie", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches.map((m) => m.path)).toEqual([
      "content/DEV/a.md",
      "content/DEV/b.md",
    ]);
    expect(result.matches[0]?.score).toBe(result.matches[1]?.score);
  });

  it("orders a tie by bytes, not by locale collation", () => {
    const document = documentOf([
      indexedNote({ path: "content/DEV/apple.md", title: "tie", tags: ["tie"] }),
      indexedNote({ path: "content/DEV/\u00c4pfel.md", title: "tie", tags: ["tie"] }),
      indexedNote({ path: "content/DEV/Zebra.md", title: "tie", tags: ["tie"] }),
    ]);
    const result = search(document, { text: "tie", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    const paths = result.matches.map((m) => m.path);
    expect(paths).toEqual([
      "content/DEV/Zebra.md",
      "content/DEV/apple.md",
      "content/DEV/\u00c4pfel.md",
    ]);
    expect(paths).not.toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  it("truncates at maxCandidates and says so", () => {
    const result = search(index, { text: "dev", maxCandidates: 1 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.considered).toBeGreaterThan(1);
    expect(result.selected).toBe(1);
  });

  it("does not claim truncation when nothing was dropped", () => {
    const result = search(index, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.truncated).toBe(false);
    expect(result.selected).toBe(result.matches.length);
    expect(result.considered).toBe(result.matches.length);
  });

  it("refuses a maxCandidates that is not a positive integer", () => {
    /**
     * Spec §8: the API has no implicit default, so a caller that forgets to
     * choose must not silently get one. Nonsense is a caller bug, not user
     * input — the CLI validates `--limit` before it reaches here.
     */
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => search(index, { text: "dev", maxCandidates: bad })).toThrow(
        RangeError,
      );
    }
  });

  it("never reads stage or reviewed, for score or for order", () => {
    /**
     * On the fixture, `caching` returns exactly one match — and that note is
     * already `established`, so the original version of this test compared a
     * one-element list against itself and could not have failed. Stage 8's
     * trust model is about *ordering*, so it takes at least two equal-scoring
     * candidates to observe.
     */
    const base = [
      indexedNote({ path: "content/DEV/a.md", title: "tie", tags: ["tie"] }),
      indexedNote({ path: "content/DEV/b.md", title: "tie", tags: ["tie"] }),
      indexedNote({ path: "content/DEV/c.md", title: "tie", tags: ["tie"] }),
    ];
    const plain = search(documentOf(base), { text: "tie", maxCandidates: 10 });

    /** The most trustworthy note is placed last, and must not move forward. */
    const graded = search(
      documentOf([
        { ...(base[0] as IndexedNote), stage: "deprecated", reviewed: null },
        { ...(base[1] as IndexedNote), stage: "emerging", reviewed: null },
        { ...(base[2] as IndexedNote), stage: "established", reviewed: "2026-08-01" },
      ]),
      { text: "tie", maxCandidates: 10 },
    );

    if (plain.kind !== "results" || graded.kind !== "results") {
      throw new Error("expected results");
    }
    expect(plain.matches).toHaveLength(3);
    expect(graded.matches.map((m) => m.path)).toEqual(
      plain.matches.map((m) => m.path),
    );
    expect(graded.matches.map((m) => m.score)).toEqual(
      plain.matches.map((m) => m.score),
    );
  });

  it("returns stage and reviewed on every match", () => {
    /**
     * Spec §8's trust model: the reader sees how trustworthy a note claims to
     * be and decides, instead of an unfalsifiable number quietly reordering.
     */
    const result = search(index, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    for (const match of result.matches) {
      expect(["emerging", "established", "deprecated"]).toContain(match.stage);
      expect(
        match.reviewed === null || /^\d{4}-\d{2}-\d{2}$/u.test(match.reviewed),
      ).toBe(true);
    }
  });

  it("stores no floating-point score", () => {
    const result = search(index, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    for (const match of result.matches) {
      expect(Number.isInteger(match.score)).toBe(true);
    }
  });

  it("intersects explicit filters with the funnel", () => {
    /**
     * `dev infra` reaches notes in both folders; the previous version used
     * `dev`, which reaches nothing in INFRA, so the filtered branch returned
     * `no-candidates` and the assertion body never ran. There is no `else`
     * here on purpose — an escape hatch is how that went unnoticed.
     */
    const unfiltered = search(index, { text: "dev infra", maxCandidates: 10 });
    if (unfiltered.kind !== "results") throw new Error("expected results");
    const all = unfiltered.matches.map((m) => m.path);
    expect(all.length).toBeGreaterThan(1);
    expect(all).toContain("content/INFRA/backups.md");

    const filtered = search(index, {
      text: "dev infra",
      filters: { folders: ["INFRA"] },
      maxCandidates: 10,
    });
    if (filtered.kind !== "results") throw new Error("expected results");
    expect(filtered.matches.map((m) => m.path)).toEqual([
      "content/INFRA/backups.md",
    ]);
    /** A filter narrows the funnel's output; it never reaches past it. */
    for (const path of filtered.matches.map((m) => m.path)) {
      expect(all).toContain(path);
    }
  });

  it("applies every filter dimension", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "widget",
        tags: ["widget", "keep"],
        type: "knowledge-note",
        stage: "established",
      }),
      indexedNote({
        path: "content/INFRA/b.md",
        title: "widget",
        tags: ["widget", "drop"],
        topicFolder: "INFRA",
        type: "compiled-note",
        stage: "emerging",
      }),
    ]);
    const only = (filters: Record<string, readonly string[]>) => {
      const r = search(document, { text: "widget", filters, maxCandidates: 10 });
      return r.kind === "results" ? r.matches.map((m) => m.path) : [];
    };
    expect(only({ tags: ["keep"] })).toEqual(["content/DEV/a.md"]);
    expect(only({ types: ["compiled-note"] })).toEqual(["content/INFRA/b.md"]);
    expect(only({ folders: ["DEV"] })).toEqual(["content/DEV/a.md"]);
    expect(only({ stages: ["emerging"] })).toEqual(["content/INFRA/b.md"]);
    /** Two dimensions intersect rather than union. */
    expect(only({ folders: ["DEV"], stages: ["emerging"] })).toEqual([]);
  });

  it("matches a type or folder the tokenizer would otherwise split", () => {
    /**
     * `knowledge-note` tokenizes to two tokens, neither of which equals it, so
     * a token-only funnel cannot match a type by name at all.
     */
    const byType = search(index, { text: "knowledge-note", maxCandidates: 10 });
    if (byType.kind !== "results") throw new Error("expected results");
    for (const match of byType.matches) {
      expect(match.path.startsWith("content/DEV/")).toBe(true);
    }

    const byFolder = search(index, { text: "INFRA", maxCandidates: 10 });
    if (byFolder.kind !== "results") throw new Error("expected results");
    expect(byFolder.matches.map((m) => m.path)).toEqual([
      "content/INFRA/backups.md",
    ]);
  });

  it("does not stem", () => {
    /**
     * Spec §8 states this as a non-goal, not an oversight. `cache` does not
     * reach a note titled `caching` by any path: it is not an exact term, and
     * it is not even a substring — the shared prefix is `cach`. A stemmer would
     * collapse the two and the reader could no longer tell which word the note
     * actually used. Tags and aliases are the documented mitigation.
     */
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", title: "caching" }),
    ]);
    expect(search(document, { text: "cache", maxCandidates: 10 }).kind).toBe(
      "no-candidates",
    );

    const exact = search(document, { text: "caching", maxCandidates: 10 });
    if (exact.kind !== "results") throw new Error("expected results");
    expect(exact.matches[0]?.score).toBe(FIELD_WEIGHTS.title);
  });

  it("reaches a note by a genuine substring of its title", () => {
    /**
     * The other side of the same rule, and why the case above is not evidence
     * that substring matching is absent: `invalid` is a real substring of
     * `Cache invalidation`, so it reaches the note — and scores zero, because
     * scoring is exact-term. Reachability and relevance are separate.
     */
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", title: "Cache invalidation" }),
    ]);
    const result = search(document, { text: "invalid", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.score).toBe(0);
    expect(result.matches[0]?.matched).toEqual([]);
  });

  it("ignores query case and normalization", () => {
    const lower = search(index, { text: "caching", maxCandidates: 10 });
    const upper = search(index, { text: "CACHING", maxCandidates: 10 });
    expect(upper).toEqual(lower);
  });

  it("reports which field matched which term", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "widget",
        tags: ["widget"],
        summary: "a widget summary",
      }),
    ]);
    const result = search(document, { text: "widget", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.matched).toEqual([
      { field: "summary", term: "widget" },
      { field: "tag", term: "widget" },
      { field: "title", term: "widget" },
    ]);
  });
});

describe("doors the funnel advertises", () => {
  it("reaches a note by an alias and by nothing else", () => {
    /** Deleting the alias branch entirely left the whole suite green. */
    const document = documentOf([
      indexedNote({
        path: "content/QA/a.md",
        topicFolder: "QA",
        title: "Unrelated",
        aliases: ["widget"],
      }),
    ]);
    const result = search(document, { text: "widget", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.score).toBe(FIELD_WEIGHTS.alias);
  });

  it("reaches a tag or folder spelled as a whole multi-word query", () => {
    /**
     * `INFRA` tokenizes to one token that already equals the folded folder, so
     * the fixture test passes through the token branch and never exercises the
     * whole-query door. A hyphenated tag does.
     */
    const document = documentOf([
      indexedNote({
        path: "content/QA/a.md",
        topicFolder: "QA",
        title: "Unrelated",
        tags: ["release-notes"],
      }),
      indexedNote({
        path: "content/CLIENT-WORK/b.md",
        topicFolder: "CLIENT-WORK",
        title: "Unrelated",
      }),
    ]);
    const byTag = search(document, { text: "release-notes", maxCandidates: 10 });
    if (byTag.kind !== "results") throw new Error("expected results");
    expect(byTag.matches.map((m) => m.path)).toEqual(["content/QA/a.md"]);

    /**
     * The folder half, which the tag case cannot stand in for: `client-work`
     * tokenizes to two tokens and neither equals the folded folder, so this
     * note is reachable only through the whole-query door.
     */
    const byFolder = search(document, { text: "client-work", maxCandidates: 10 });
    if (byFolder.kind !== "results") throw new Error("expected results");
    expect(byFolder.matches.map((m) => m.path)).toEqual([
      "content/CLIENT-WORK/b.md",
    ]);
  });

  it("folds case on the title, alias and tag doors", () => {
    /**
     * Nothing would have noticed if `search("caching")` stopped reaching a note
     * titled `Caching`.
     */
    const document = documentOf([
      indexedNote({ path: "content/QA/t.md", topicFolder: "QA", title: "Caching" }),
      indexedNote({
        path: "content/QA/a.md",
        topicFolder: "QA",
        title: "x",
        aliases: ["Caching"],
      }),
      indexedNote({
        path: "content/QA/g.md",
        topicFolder: "QA",
        title: "x",
        tags: ["Caching"],
      }),
    ]);
    const result = search(document, { text: "caching", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches).toHaveLength(3);
    for (const match of result.matches) expect(match.score).toBeGreaterThan(0);
  });

  it("counts occurrences in an alias, a summary and a body, not just a title", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/one.md",
        title: "x",
        summary: "dev",
        terms: [{ term: "dev", count: 1 }],
        aliases: ["dev"],
      }),
      indexedNote({
        path: "content/DEV/many.md",
        title: "x",
        summary: "dev dev dev",
        terms: [{ term: "dev", count: 5 }],
        aliases: ["dev dev"],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.path).toBe("content/DEV/many.md");
    expect(result.matches[0]?.score).toBe(
      FIELD_WEIGHTS.alias * 2 + FIELD_WEIGHTS.summary * 3 + FIELD_WEIGHTS.body * 5,
    );
    expect(result.matches[1]?.score).toBe(
      FIELD_WEIGHTS.alias + FIELD_WEIGHTS.summary + FIELD_WEIGHTS.body,
    );
  });

  it("lets the body count decide the order between two equally reachable notes", () => {
    /** The body weight is not dead: it is what separates two tagged notes. */
    const document = documentOf([
      indexedNote({ path: "content/DEV/quiet.md", title: "x", tags: ["dev"] }),
      indexedNote({
        path: "content/DEV/loud.md",
        title: "x",
        tags: ["dev"],
        terms: [{ term: "dev", count: 7 }],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches.map((m) => m.path)).toEqual([
      "content/DEV/loud.md",
      "content/DEV/quiet.md",
    ]);
  });
});

describe("the output contract Task 9 will print", () => {
  it("carries the note's own title and summary", () => {
    /** Swapping the two fields, or emitting the path as the title, was free. */
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "Cache invalidation",
        summary: "Invalidate on write.",
        tags: ["dev"],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.title).toBe("Cache invalidation");
    expect(result.matches[0]?.summary).toBe("Invalidate on write.");
  });

  it("strips control characters and collapses newlines out of both", () => {
    /**
     * `note.ts` validates a title as a non-empty string — no length bound, no
     * character screen — so an escape sequence or a carriage return survives
     * parsing, and a `\r` lets one result overwrite the row above it.
     */
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "red \u001b[31mALERT\u001b[0m\r\nsecond",
        summary: "line\nbreak",
        tags: ["dev"],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    const match = result.matches[0];
    // eslint-disable-next-line no-control-regex -- asserting their absence
    expect(match?.title).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/u);
    expect(match?.summary).toBe("line break");
    expect(match?.title).toContain("ALERT");
  });

  it("does not cap a summary, which the schema already bounds", () => {
    /**
     * `note.ts` caps `summary` at 400 characters, so only the character screen
     * is owed here. Capping it at the title's bound as well would silently
     * truncate a legitimate 360-character summary, and nothing noticed.
     */
    const summary = "s".repeat(360);
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", summary, tags: ["dev"] }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.summary).toBe(summary);
    expect(result.matches[0]?.summary).not.toContain("\u2026");
  });

  it("caps a title the schema does not bound", () => {
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", title: "t".repeat(50000), tags: ["dev"] }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    /**
     * Counted in graphemes, because that is the unit the cap uses. Measuring
     * `.length` passes here only because the input is ASCII — 201 emoji is
     * 1,001 code units and would fail an assertion that is otherwise correct.
     */
    const graphemes = [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(
        result.matches[0]?.title ?? "",
      ),
    ];
    expect(graphemes.length).toBeLessThanOrEqual(201);
    expect(result.matches[0]?.title).toContain("\u2026");
  });

  it("scores a repeated query word once", () => {
    /** No search box treats repetition as a weight. */
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", title: "widget", tags: ["seed"] }),
    ]);
    const once = search(document, { text: "widget", maxCandidates: 10 });
    const twice = search(document, { text: "widget widget", maxCandidates: 10 });
    if (once.kind !== "results" || twice.kind !== "results") {
      throw new Error("expected results");
    }
    expect(twice.matches[0]?.score).toBe(once.matches[0]?.score);
    expect(twice.matches[0]?.matched).toEqual(once.matches[0]?.matched);
  });

  it("orders matched by field before term", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "beta",
        tags: ["alpha"],
        summary: "beta",
      }),
    ]);
    const result = search(document, { text: "alpha beta", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.matched).toEqual([
      { field: "summary", term: "beta" },
      { field: "tag", term: "alpha" },
      { field: "title", term: "beta" },
    ]);
  });

  it("keeps two notes with one path in a stable, total order", () => {
    /**
     * The collision discovery documents: two files whose names differ only in
     * normalization carry the same NFC path, so no comparison over paths can
     * separate them.
     *
     * This pins the *direction* — same-path notes come back in input order —
     * not the mechanism. Nothing can pin the mechanism: the ordinal is the
     * input position, so removing it and leaning on sort stability gives the
     * identical answer. Reversing it does fail here.
     */
    const shared = "content/DEV/caf\u00e9.md";
    const document = documentOf([
      indexedNote({ path: shared, title: "first", tags: ["tie"] }),
      indexedNote({ path: shared, title: "second", tags: ["tie"] }),
    ]);
    const result = search(document, { text: "tie", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches.map((m) => m.title)).toEqual(["first", "second"]);
  });

  it("treats an empty filter array as no constraint", () => {
    /**
     * The obvious CLI shape is `filters: { tags: opts.tags ?? [] }`. If this
     * clause were ever removed as redundant, every CLI search would return
     * no-candidates.
     */
    const result = search(index, {
      text: "caching",
      filters: { tags: [], types: [], folders: [], stages: [] },
      maxCandidates: 10,
    });
    expect(result.kind).toBe("results");
  });

  it("exports a frozen funnel list and does not hand out a mutable one", () => {
    const result = search(index, { text: "zzzznotpresent", maxCandidates: 10 });
    if (result.kind !== "no-candidates") throw new Error("expected none");
    expect(Object.isFrozen(FUNNEL_STAGES)).toBe(true);
    expect(() => (result.tried as string[]).push("body")).toThrow();
  });
});

describe("premises the code depends on", () => {
  it("has no note type a tokenizer could reproduce", () => {
    /**
     * `isCandidate` matches a type only against the whole query, because every
     * `NoteType` is hyphenated and the tokenizer splits on the hyphen — a token
     * branch there would be unreachable. That is a property of `NOTE_TYPES`,
     * and prose asserting it is not a gate: an unhyphenated `moc` or `daily`
     * would silently lose the door. This fails the day one is added.
     */
    for (const type of NOTE_TYPES) {
      expect(tokenize(type)).not.toContain(type);
    }
  });

  it("returns no candidates for an empty query even against an empty tag", () => {
    /**
     * `note.ts` validates tags as strings with no emptiness check, so this
     * parses clean — and an unguarded whole-query door then matches `""`
     * exactly. The fixture-based empty-query test passes only because the
     * fixture has no such tag.
     */
    const document = documentOf([
      indexedNote({ path: "content/DEV/a.md", tags: ["", "dev"] }),
    ]);
    expect(search(document, { text: "", maxCandidates: 10 }).kind).toBe(
      "no-candidates",
    );
    expect(search(document, { text: "   ", maxCandidates: 10 }).kind).toBe(
      "no-candidates",
    );
    /** Still reachable by a real query. */
    expect(search(document, { text: "dev", maxCandidates: 10 }).kind).toBe(
      "results",
    );
  });

  it("collapses whitespace runs and trims the edges", () => {
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "   lots     of     space   ",
        tags: ["dev"],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.title).toBe("lots of space");
  });

  it("strips a bidi override and a zero-width space", () => {
    /**
     * U+202E reorders the rest of the printed line (Trojan Source,
     * CVE-2021-42574) and U+200B is invisible. `\s` matches neither, so the
     * whitespace collapse cannot reach them.
     */
    const document = documentOf([
      indexedNote({
        path: "content/DEV/a.md",
        title: "safe\u202Ereversed\u200Bhidden",
        tags: ["dev"],
      }),
    ]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.title).not.toMatch(/\p{Cf}/u);
  });

  it("leaves path byte-exact so a match still resolves", () => {
    /**
     * Spec §14 gates on every match resolving to a note that exists at the
     * returned path, so this is machine identity and screening it would break
     * the gate. The consequence is Task 9's: it must render the path.
     */
    const raw = "content/DEV/ev\u001b[31mil.md";
    const document = documentOf([indexedNote({ path: raw, tags: ["dev"] })]);
    const result = search(document, { text: "dev", maxCandidates: 10 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.matches[0]?.path).toBe(raw);
  });
});
