import { describe, expect, it } from "vitest";

import { buildIndex } from "./build.js";
import type { IndexDocumentV1, IndexedNote } from "./build.js";
import {
  RECENT_CHANGES_LIMIT,
  renderCatalog,
  renderVaultMap,
} from "./render.js";
import { fixtureRequest, reversedFixtureRequest } from "./testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

function indexedNote(overrides: Partial<IndexedNote> = {}): IndexedNote {
  return {
    path: "content/DEV/a.md",
    title: "A note",
    type: "knowledge-note",
    topicFolder: "DEV",
    tags: ["dev"],
    aliases: [],
    summary: "A summary.",
    stage: "established",
    author: "human",
    reviewed: "2026-01-01",
    occurrences: 0,
    created: "2026-01-01",
    updated: null,
    sources: [],
    contentHash: "0".repeat(64),
    terms: [],
    ...overrides,
  };
}

/** Renderers take a document, so most cases need no vault at all. */
function documentWith(notes: readonly IndexedNote[]): IndexDocumentV1 {
  const folders = [...new Set(notes.map((note) => note.topicFolder))].map(
    (name) => ({
      name,
      noteCount: notes.filter((note) => note.topicFolder === name).length,
      types: [{ type: "knowledge-note" as const, count: 1 }],
      topTags: ["dev"],
    }),
  );
  return {
    schemaVersion: 1,
    generatedAt: FROZEN,
    contentRoot: "content",
    notes,
    folders,
    tags: [{ tag: "dev", count: notes.length, paths: notes.map((n) => n.path) }],
  };
}

const VAULT_MAP_GOLDEN = `---
generatedAt: 2026-08-04T00:00:00.000Z
schemaVersion: 1
---

# Vault map

5 notes in 4 folders under \`content\`.

## Folders

| Folder | Notes | Types | Top tags |
| --- | ---: | --- | --- |
| PROJECTS | 1 | project-note(1) | orchard, project |
| TOOLS | 1 | reference-note(1) | tools |
| DEV | 2 | knowledge-note(2) | dev, caching, testing |
| INFRA | 1 | compiled-note(1) | infra |

## Tags

- caching (1) · dev (2) · infra (1) · orchard (1) · project (1) · testing (1) · tools (1)

## Recent changes

- 2026-05-20 — [Rowlease CLI leasing model](<content/TOOLS/rowlease.md>)
- 2026-03-02 — [Orchard scheduling service](<content/PROJECTS/orchard.md>)
- 2026-02-11 — [Cache invalidation on write](<content/DEV/caching.md>)
- 2026-02-11 — [Tests that pin the invalidation contract](<content/DEV/testing.md>)
- 2025-03-02 — [Restore drills for object-store backups](<content/INFRA/backups.md>)
`;

const CATALOG_GOLDEN = `---
generatedAt: 2026-08-04T00:00:00.000Z
schemaVersion: 1
---

# Catalog

## PROJECTS

- [Orchard scheduling service](<content/PROJECTS/orchard.md>) — A scheduler that assigns pickers to rows and refuses double booking.

## TOOLS

- [Rowlease CLI leasing model](<content/TOOLS/rowlease.md>) — A lease expires on its own, so an abandoned hold never needs a human to release it.

## DEV

- [Cache invalidation on write](<content/DEV/caching.md>) — Invalidate the cache when a value is written, never when it is read.
- [Tests that pin the invalidation contract](<content/DEV/testing.md>) — A read-path test cannot prove a write-path guarantee; assert on the write.

## INFRA

- [Restore drills for object-store backups](<content/INFRA/backups.md>) — A backup nobody has restored is a hypothesis, so drill the restore on a schedule.
`;

describe("rendered views", () => {
  it("carries generatedAt in frontmatter exactly once", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [renderVaultMap(index), renderCatalog(index)]) {
      expect(text.match(/^generatedAt: /gmu)).toHaveLength(1);
      expect(text).toContain(`generatedAt: ${FROZEN}`);
      /** Spec §6.3 replaces this line to compare canonical form. */
      expect(text.startsWith("---\ngeneratedAt: ")).toBe(true);
    }
  });

  it("is byte-identical under a reversed directory reader", async () => {
    const forward = await buildIndex(fixtureRequest(FROZEN));
    const reversed = await buildIndex(reversedFixtureRequest(FROZEN));
    expect(renderVaultMap(reversed.index)).toBe(renderVaultMap(forward.index));
    expect(renderCatalog(reversed.index)).toBe(renderCatalog(forward.index));
  });

  it("ends with exactly one newline and contains no carriage return", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [renderVaultMap(index), renderCatalog(index)]) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });

  it("orders recent changes by frontmatter dates, never by mtime", async () => {
    /**
     * The fixture's five notes have distinct `updated` values except for one
     * deliberate tie, so this pins both the descending date order and the
     * path tie-break. `updated ?? created` is content; `mtime` is not, and a
     * renderer reading the filesystem would order these by checkout time.
     */
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    const map = renderVaultMap(index);
    const recent = map
      .slice(map.indexOf("## Recent changes"))
      .split("\n")
      .filter((line) => line.startsWith("- "));

    expect(recent.map((line) => /\((?:<)?([^>)]+)/u.exec(line)?.[1])).toEqual([
      "content/TOOLS/rowlease.md",
      "content/PROJECTS/orchard.md",
      "content/DEV/caching.md",
      "content/DEV/testing.md",
      "content/INFRA/backups.md",
    ]);
  });

  it("names no private folder and carries no excluded content", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [renderVaultMap(index), renderCatalog(index)]) {
      expect(text).not.toContain("_raw");
      expect(text).not.toContain("_graveyard");
      expect(text).not.toContain("EXCLUDED-FROM-EVERY-INDEX");
    }
  });

  it("lists one catalog section per folder, in the index's folder order", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    const headings = [...renderCatalog(index).matchAll(/^## (.+)$/gmu)].map(
      (m) => m[1],
    );
    /** Configured order, deliberately not alphabetical. */
    expect(headings).toEqual(["PROJECTS", "TOOLS", "DEV", "INFRA"]);
  });
});

describe("rendered views treat note content as untrusted", () => {
  it("keeps a pipe in a folder name or tag from adding a table column", () => {
    /**
     * Aimed where a pipe actually lands. Titles never reach a table cell — the
     * columns are folder name, note count, types and top tags — so a title-based
     * version of this test passes against a renderer that escapes nothing.
     */
    const doc = documentWith([indexedNote({ topicFolder: "A|B" })]);
    const hostile: IndexDocumentV1 = {
      ...doc,
      folders: [
        {
          name: "A|B",
          noteCount: 1,
          types: [{ type: "knowledge-note", count: 1 }],
          topTags: ["x|y", "p|q"],
        },
      ],
    };

    const rows = renderVaultMap(hostile)
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const columns = rows.map(
      (row) => row.replaceAll("\\|", "").split("|").length,
    );
    /** Every row has the header's column count; no phantom columns. */
    expect(new Set(columns).size).toBe(1);
    expect(renderVaultMap(hostile)).toContain("A\\|B");
  });

  it("cannot inject a second generatedAt line through a summary", () => {
    /**
     * The product design spec's §14.1 classifies vault files as untrusted
     * data (not the brain-engine spec, whose §14 is the gate). A summary carrying a
     * newline would otherwise start a fresh line in the artifact, and the drift
     * canonicalizer replaces only the first `generatedAt:` it finds — so a note
     * could pin the sentinel and make its own edits invisible to `index-drift`.
     */
    const hostile = indexedNote({
      summary: "harmless\ngeneratedAt: 1970-01-01T00:00:00.000Z\nmore",
      title: "also\nmultiline",
    });
    for (const text of [
      renderVaultMap(documentWith([hostile])),
      renderCatalog(documentWith([hostile])),
    ]) {
      expect(text.match(/^generatedAt: /gmu)).toHaveLength(1);
      expect(text).toContain(`generatedAt: ${FROZEN}`);
    }
  });

  it("escapes link syntax in a title and angle-wraps the path", () => {
    const catalog = renderCatalog(
      documentWith([
        indexedNote({
          title: "See [other](x)",
          path: "content/DEV/a note (draft).md",
        }),
      ]),
    );
    expect(catalog).toContain("\\[other\\]");
    expect(catalog).toContain("(<content/DEV/a note (draft).md>)");
  });

  it("renders an empty vault without crashing", () => {
    const empty = documentWith([]);
    for (const text of [renderVaultMap(empty), renderCatalog(empty)]) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.match(/^generatedAt: /gmu)).toHaveLength(1);
    }
  });
});

describe("recent changes", () => {
  it("keeps the most recent notes, not merely fifteen of them", () => {
    /**
     * Asserting only the length lets a renderer that slices before it sorts
     * pass: it shows the fifteen lowest-path notes, hiding every genuinely
     * recent one, and nothing goes red.
     */
    const many = Array.from({ length: RECENT_CHANGES_LIMIT + 7 }, (_, i) =>
      indexedNote({
        path: `content/DEV/n${String(i).padStart(3, "0")}.md`,
        updated: `2026-01-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const map = renderVaultMap(documentWith(many));
    const listed = map
      .slice(map.indexOf("## Recent changes"))
      .split("\n")
      .filter((line) => line.startsWith("- "));

    expect(listed).toHaveLength(RECENT_CHANGES_LIMIT);
    /** Newest first, and the cut falls at the 15th newest, not the 15th path. */
    expect(listed[0]).toContain("n021");
    expect(listed.at(-1)).toContain("n007");
    expect(map).not.toContain("n006");
  });

  it("cuts a boundary tie deterministically when more than fifteen share a date", () => {
    const tied = Array.from({ length: 20 }, (_, i) =>
      indexedNote({
        path: `content/DEV/t${String(i).padStart(2, "0")}.md`,
        updated: "2026-01-01",
      }),
    );
    const first = renderVaultMap(documentWith(tied));
    const shuffled = renderVaultMap(documentWith([...tied].reverse()));
    expect(shuffled).toBe(first);
    expect(first).toContain("t14.md");
    expect(first).not.toContain("t15.md");
  });

  it("breaks a date tie by byte order, not locale collation", () => {
    /**
     * Byte order puts `apple` before `Äpfel`; every locale collation reverses
     * them. Without this the tie-break passes against a `localeCompare`
     * implementation and the artifact differs between two machines.
     */
    const tied = [
      indexedNote({ path: "content/DEV/\u00c4pfel.md", updated: "2026-01-01" }),
      indexedNote({ path: "content/DEV/apple.md", updated: "2026-01-01" }),
      indexedNote({ path: "content/DEV/Zebra.md", updated: "2026-01-01" }),
    ];
    const map = renderVaultMap(documentWith(tied));
    const order = map
      .slice(map.indexOf("## Recent changes"))
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => /\(<([^>]+)>\)/u.exec(line)?.[1]);

    expect(order).toEqual([
      "content/DEV/Zebra.md",
      "content/DEV/apple.md",
      "content/DEV/\u00c4pfel.md",
    ]);
    expect(order).not.toEqual([...order].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("falls back to created when a note has never been updated", () => {
    const map = renderVaultMap(
      documentWith([
        indexedNote({ path: "content/DEV/old.md", created: "2020-01-01", updated: null }),
        indexedNote({ path: "content/DEV/new.md", created: "2026-06-01", updated: null }),
      ]),
    );
    expect(map.indexOf("content/DEV/new.md")).toBeLessThan(
      map.indexOf("content/DEV/old.md"),
    );
  });
});


describe("golden artifacts", () => {
  /**
   * The full bytes of both views over the committed fixture, and the only test
   * in this file that pins what Task 5 actually delivers.
   *
   * Every other assertion here checks a property — one newline at the end, one
   * `generatedAt`, no private folder named. A renderer that emitted an empty
   * table, dropped every summary, or stopped escaping pipes satisfies all of
   * them; four such mutants were built and all four passed before this existed.
   * A property test says the shape is not wrong. Only this says the output is
   * right.
   *
   * When it fails, read the diff before touching it: either the change was
   * intended and the golden is stale, or the artifact just changed under a user
   * who will see it in their vault. Regenerating without reading is how a
   * golden becomes a rubber stamp.
   */
  it("renders vault-map.md byte for byte", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    expect(renderVaultMap(index)).toBe(VAULT_MAP_GOLDEN);
  });

  it("renders catalog.md byte for byte", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    expect(renderCatalog(index)).toBe(CATALOG_GOLDEN);
  });
});


describe("untrusted tags and summaries cannot become structure", () => {
  /**
   * `note.ts` validates a tag and a summary for type and length only, so both
   * are arbitrary user strings that land in a file the user opens in Obsidian.
   * The attack is not corruption, it is a native-looking link in the user's own
   * vault: a shared vault, an agent-written note, a tag that renders clickable.
   */
  function withTag(tag: string): IndexDocumentV1 {
    const doc = documentWith([indexedNote()]);
    return {
      ...doc,
      folders: [
        {
          name: "DEV",
          noteCount: 1,
          types: [{ type: "knowledge-note", count: 1 }],
          topTags: [tag],
        },
      ],
      tags: [{ tag, count: 1, paths: ["content/DEV/a.md"] }],
    };
  }

  it("does not let a tag render as a clickable link", () => {
    const map = renderVaultMap(withTag("[click me](https://example.invalid)"));
    expect(map).not.toContain("[click me](https://example.invalid)");
    expect(map).toContain("\\[click me\\]");
  });

  it("does not let a tag inject raw HTML", () => {
    const map = renderVaultMap(withTag("<img src=x onerror=boom>"));
    const row = map.split("\n").find((line) => line.startsWith("| DEV ")) ?? "";

    expect(row).toContain("\\<img");
    /**
     * Scoped to the row: the recent-changes links legitimately use the
     * angle-bracket destination form, so a document-wide check for `<` would
     * fail on correct output. An escaped `\<` renders as a literal character,
     * so no tag can open an HTML element.
     */
    expect(row).not.toMatch(/(?<!\\)</u);
  });

  it("does not let a tag containing a backtick break out of its span", () => {
    /**
     * Escapes do not work inside a Markdown code span, so a span cannot be made
     * safe against a backtick — it can only be removed, which is why the tag
     * cloud renders plain escaped text.
     */
    const map = renderVaultMap(withTag("a`b"));
    const cloud = map.slice(map.indexOf("## Tags"), map.indexOf("## Recent"));
    expect(cloud).not.toMatch(/`[^`]*`/u);
  });

  it("does not let a summary render as a clickable link", () => {
    const catalog = renderCatalog(
      documentWith([
        indexedNote({ summary: "see [here](https://example.invalid)" }),
      ]),
    );
    expect(catalog).not.toContain("[here](https://example.invalid)");
    expect(catalog).toContain("\\[here\\]");
  });

  it("says so when there are no tags at all", () => {
    const doc = documentWith([indexedNote()]);
    const map = renderVaultMap({ ...doc, tags: [] });
    expect(map).toContain("No tags.");
  });

  it("files a note whose folder has no section rather than dropping it", () => {
    /**
     * Unreachable through `buildIndex`, which derives folders from the notes —
     * but `renderCatalog` is exported and takes any document, and a note that
     * silently disappears from the catalog is invisible by construction.
     */
    const doc = documentWith([indexedNote()]);
    const orphaned: IndexDocumentV1 = {
      ...doc,
      notes: [
        indexedNote({ path: "content/DEV/present.md" }),
        indexedNote({ path: "content/QA/missing.md", topicFolder: "QA" }),
      ],
      folders: [
        {
          name: "DEV",
          noteCount: 1,
          types: [{ type: "knowledge-note", count: 1 }],
          topTags: [],
        },
      ],
    };
    const catalog = renderCatalog(orphaned);
    expect(catalog).toContain("## Notes with no folder section");
    expect(catalog).toContain("content/QA/missing.md");
  });
});


describe("a tag cannot forge line or block structure", () => {
  /**
   * The tag cloud is the only line in either artifact whose content begins with
   * user bytes, which makes it the one place a line-anchored pattern can be
   * forged. Every case here failed at some point during review.
   */
  function withTags(...tags: readonly string[]): IndexDocumentV1 {
    const doc = documentWith([indexedNote()]);
    return {
      ...doc,
      tags: tags.map((tag) => ({
        tag,
        count: 1,
        paths: ["content/DEV/a.md"],
      })),
    };
  }

  it("cannot add a second generatedAt line by being named one", () => {
    /**
     * Spec §6.1(1): `generatedAt` appears exactly once per artifact, at a fixed
     * location. A tag named `generatedAt:` reaches the start of the tag line,
     * and §6.3's canonicalizer replaces only the first match.
     */
    const map = renderVaultMap(withTags("generatedAt:", "dev"));
    expect(map.match(/^generatedAt: /gmu)).toHaveLength(1);
    expect(map).toContain(`generatedAt: ${FROZEN}`);
  });

  it("cannot open a heading, blockquote or list", () => {
    for (const [tag, forbidden] of [
      ["## Recent changes", /^## Recent changes \(/mu],
      ["# Pwned", /^# Pwned/mu],
      ["> quoted", /^> quoted/mu],
      ["- listitem", /^- listitem/mu],
      ["1. ordered", /^1\. ordered/mu],
    ] as const) {
      expect(renderVaultMap(withTags(tag))).not.toMatch(forbidden);
    }
  });

  it("cannot open a fenced code block", () => {
    /**
     * An unescaped triple backtick would swallow `## Recent changes` and the
     * whole recent list into a code block. Two backticked tags, because one
     * cannot produce the pair a naive assertion looks for.
     */
    const map = renderVaultMap(withTags("```yaml", "a`b", "c`d"));
    expect(map).not.toMatch(/^```/mu);
    const cloud = map.slice(map.indexOf("## Tags"), map.indexOf("## Recent"));
    expect(cloud).toContain("\\`");
    expect(cloud).not.toMatch(/(?<!\\)`/u);
  });

  it("trims surrounding whitespace rather than emitting it", () => {
    /**
     * The list-item prefix already stops leading spaces opening an indented
     * code block, so that assertion no longer discriminates. What `trim` still
     * decides is the bytes: untrimmed padding lands in the artifact and two
     * vaults differing only in trailing spaces produce different files.
     */
    const map = renderVaultMap(withTags("    spaced   "));
    const line = map
      .split("\n")
      .find((candidate) => candidate.startsWith("- spaced"));
    expect(line).toBe("- spaced (1)");
  });
});

describe("escaping the reviewer's surviving mutants", () => {
  it("escapes an angle bracket in a link destination", () => {
    /**
     * `>` is legal in a macOS and Linux filename. Unescaped it closes the
     * angle-bracket destination early: the link truncates and the remainder
     * leaks into the catalog as literal text.
     */
    const catalog = renderCatalog(
      documentWith([indexedNote({ path: "content/DEV/a>b.md" })]),
    );
    expect(catalog).toContain("(<content/DEV/a\\>b.md>)");
    expect(catalog).not.toContain("(<content/DEV/a>b.md>)");
  });

  it("collapses every line terminator the m flag recognises", () => {
    /**
     * `\r`, U+2028 and U+2029 are line terminators to a JavaScript reader, and
     * §6.3's canonicalizer uses the `m` flag. Dropping any one of them from the
     * collapse recreates the duplicate-generatedAt hole through the summary.
     */
    for (const separator of ["\r", "\r\n", "\u2028", "\u2029"]) {
      const map = renderVaultMap(
        documentWith([
          indexedNote({
            summary: `harmless${separator}generatedAt: 1970-01-01T00:00:00.000Z`,
          }),
        ]),
      );
      const catalog = renderCatalog(
        documentWith([
          indexedNote({
            summary: `harmless${separator}generatedAt: 1970-01-01T00:00:00.000Z`,
          }),
        ]),
      );
      expect(map.match(/^generatedAt: /gmu)).toHaveLength(1);
      expect(catalog.match(/^generatedAt: /gmu)).toHaveLength(1);
    }
  });

  it("says 1 note in 1 folder, not 1 notes in 1 folders", () => {
    const map = renderVaultMap(documentWith([indexedNote()]));
    expect(map).toContain("1 note in 1 folder under");
    expect(map).not.toContain("1 notes");
  });
});
