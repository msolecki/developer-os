import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { buildIndex, MAX_FRONTMATTER_CHARS } from "./build.js";
import type { IndexBuildRequest } from "./build.js";
import { serializeGraph, serializeIndex } from "./serialize.js";
import { fixtureRequest, reversedFixtureRequest } from "./testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

const FIXTURE_PATHS = [
  "content/DEV/caching.md",
  "content/DEV/testing.md",
  "content/INFRA/backups.md",
  "content/PROJECTS/orchard.md",
  "content/TOOLS/rowlease.md",
];

/** An in-memory vault, for the cases the committed fixture must not encode. */
function memoryRequest(
  files: Record<string, string>,
  now = FROZEN,
  overrides: Partial<IndexBuildRequest> = {},
): IndexBuildRequest {
  const tree = new Map<string, { name: string; dir: boolean }[]>();
  for (const vaultPath of Object.keys(files)) {
    const segments = vaultPath.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = `/vault${i === 0 ? "" : `/${segments.slice(0, i).join("/")}`}`;
      const entry = { name: segments[i] as string, dir: i < segments.length - 1 };
      const siblings = tree.get(parent) ?? [];
      if (!siblings.some((s) => s.name === entry.name)) siblings.push(entry);
      tree.set(parent, siblings);
    }
  }

  return {
    vaultRoot: "/vault",
    config: DEFAULT_BRAIN_CONFIG,
    reader: {
      readDir: (path: string) =>
        Promise.resolve(
          (tree.get(path) ?? []).map((e) => ({
            name: e.name,
            isDirectory: e.dir,
            isFile: !e.dir,
            isSymbolicLink: false,
          })),
        ),
    },
    readFile: (path: string) => {
      const key = path.replace("/vault/", "");
      const text = files[key];
      return text === undefined
        ? Promise.reject(new Error(`no such fixture file: ${key}`))
        : Promise.resolve(text);
    },
    assertReadable: () => Promise.resolve(),
    now: () => now,
    ...overrides,
  };
}

function note(fields: Record<string, string>, body = "Body text.\n"): string {
  const defaults: Record<string, string> = {
    schemaVersion: "1",
    title: "A note",
    type: "knowledge-note",
    created: "2026-01-01",
    tags: "[dev]",
    summary: "A summary.",
    stage: "established",
    author: "human",
    reviewed: "2026-01-01",
  };
  const merged = { ...defaults, ...fields };
  const lines = Object.entries(merged).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

describe("buildIndex determinism", () => {
  it("produces identical bytes on a second build with a frozen clock", async () => {
    const first = await buildIndex(fixtureRequest(FROZEN));
    const second = await buildIndex(fixtureRequest(FROZEN));
    expect(serializeIndex(second.index)).toBe(serializeIndex(first.index));
    expect(serializeGraph(second.graph)).toBe(serializeGraph(first.graph));
  });

  it("produces identical bytes under a reversed directory reader", async () => {
    const forward = await buildIndex(fixtureRequest(FROZEN));
    const reversed = await buildIndex(reversedFixtureRequest(FROZEN));
    expect(serializeIndex(reversed.index)).toBe(serializeIndex(forward.index));
    expect(serializeGraph(reversed.graph)).toBe(serializeGraph(forward.graph));
  });

  it("excludes every private folder from the index", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.index.notes.map((n) => n.path)).toEqual(FIXTURE_PATHS);
  });

  it("carries no excluded content anywhere in either artifact", async () => {
    /**
     * Path absence is the weaker assertion: it passes against a build that read
     * an excluded note and filed its text under a permitted path. The fixture's
     * excluded files all carry one sentence for exactly this check.
     */
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(serializeIndex(result.index)).not.toContain(
      "EXCLUDED-FROM-EVERY-INDEX",
    );
    expect(serializeGraph(result.graph)).not.toContain(
      "EXCLUDED-FROM-EVERY-INDEX",
    );
  });

  it("records an unresolved link as a finding and never as an edge", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.graph.edges.length).toBeGreaterThan(0);
    for (const edge of result.graph.edges) {
      expect(result.index.notes.some((n) => n.path === edge.target)).toBe(true);
    }
  });

  it("uses only the injected clock for generatedAt", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.index.generatedAt).toBe(FROZEN);
    expect(result.graph.generatedAt).toBe(FROZEN);

    const later = await buildIndex(fixtureRequest("2027-01-01T00:00:00.000Z"));
    /** Everything but that one field is identical across the two clocks. */
    expect(
      serializeIndex(later.index).replace(
        "2027-01-01T00:00:00.000Z",
        FROZEN,
      ),
    ).toBe(serializeIndex(result.index));
  });

  it("stores no floating-point number in either artifact", async () => {
    /** Brain architecture former §6.1(4): a float's formatting is a portability hazard. */
    const result = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [
      serializeIndex(result.index),
      serializeGraph(result.graph),
    ]) {
      expect(text).not.toMatch(/:\s-?\d+\.\d+/u);
      expect(text).not.toMatch(/:\s-?\d+e[+-]?\d+/iu);
    }
  });
});

describe("buildIndex content", () => {
  it("hashes each note and gives two different notes different hashes", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    const hashes = result.index.notes.map((n) => n.contentHash);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("gives two notes with identical bytes the same hash", async () => {
    const body = note({ title: "Same" }, "Identical bytes.\n");
    const result = await buildIndex(
      memoryRequest({ "content/DEV/a.md": body, "content/DEV/b.md": body }),
    );
    const [a, b] = result.index.notes;
    expect(a?.contentHash).toBe(b?.contentHash);
  });

  it("counts body terms and sorts them by term", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({}, "zebra alpha zebra Mango alpha zebra\n"),
      }),
    );
    expect(result.index.notes[0]?.terms).toEqual([
      { term: "alpha", count: 2 },
      { term: "mango", count: 1 },
      { term: "zebra", count: 3 },
    ]);
  });

  it("tokenizes the body only, never the frontmatter", async () => {
    /**
     * The frontmatter is indexed through its own typed fields. Folding it into
     * `terms` as well would double-count every title word and make `summary`
     * outrank `title` for a note whose summary repeats it.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note(
          { title: "Zzunique", summary: "Qqunique summary." },
          "Body only.\n",
        ),
      }),
    );
    const terms = result.index.notes[0]?.terms.map((t) => t.term) ?? [];
    expect(terms).toEqual(["body", "only"]);
  });

  it("normalizes updated and occurrences rather than emitting undefined", async () => {
    const result = await buildIndex(
      memoryRequest({ "content/DEV/a.md": note({}) }),
    );
    const indexed = result.index.notes[0];
    expect(indexed?.updated).toBeNull();
    expect(indexed?.occurrences).toBe(0);
    expect(indexed?.aliases).toEqual([]);
    expect(serializeIndex(result.index)).not.toContain("undefined");
  });

  it("rolls folders up in the configured topic order, not alphabetically", async () => {
    /**
     * `topicFolders` defaults to PROJECTS, TOOLS, DEV, INFRA, QA — deliberately
     * not sorted, so a rollup that sorted by name would look correct on any
     * alphabetical fixture and be wrong here.
     */
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.index.folders.map((f) => f.name)).toEqual([
      "PROJECTS",
      "TOOLS",
      "DEV",
      "INFRA",
    ]);
    const dev = result.index.folders.find((f) => f.name === "DEV");
    expect(dev?.noteCount).toBe(2);
    expect(dev?.types).toEqual([{ type: "knowledge-note", count: 2 }]);
  });

  it("rolls tags up with their paths, both sorted", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    const tags = result.index.tags;
    expect(tags.map((t) => t.tag)).toEqual([...tags.map((t) => t.tag)].sort());
    const dev = tags.find((t) => t.tag === "dev");
    expect(dev).toEqual({
      tag: "dev",
      count: 2,
      paths: ["content/DEV/caching.md", "content/DEV/testing.md"],
    });
  });

  it("resolves a wikilink by topic-folder suffix", async () => {
    const result = await buildIndex(fixtureRequest(FROZEN));
    expect(result.graph.edges).toContainEqual({
      source: "content/DEV/caching.md",
      target: "content/DEV/testing.md",
      text: "DEV/testing",
    });
    expect(result.unresolvedLinks).toEqual([]);
  });

  it("reports an unresolved wikilink without inventing an edge", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({}, "See [[DEV/absent]].\n"),
      }),
    );
    expect(result.graph.edges).toEqual([]);
    expect(result.unresolvedLinks).toEqual([
      { source: "content/DEV/a.md", text: "DEV/absent" },
    ]);
  });

  it("resolves an ambiguous link to the lowest path rather than at random", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/z.md": note({ title: "Shared" }, "x\n"),
        "content/DEV/a.md": note({ title: "Shared" }, "x\n"),
        "content/PROJECTS/p.md": note(
          { title: "Linker", tags: "[project]", type: "project-note" },
          "See [[Shared]].\n",
        ),
      }),
    );
    expect(result.graph.edges).toEqual([
      {
        source: "content/PROJECTS/p.md",
        target: "content/DEV/a.md",
        text: "Shared",
      },
    ]);
  });

  it("carries a parse failure as an issue instead of aborting the build", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/good.md": note({}),
        "content/DEV/bad.md": "no frontmatter at all\n",
      }),
    );
    expect(result.index.notes.map((n) => n.path)).toEqual([
      "content/DEV/good.md",
    ]);
    expect(result.parseIssues.map((p) => p.path)).toEqual([
      "content/DEV/bad.md",
    ]);
  });

  it("carries discovery's folder findings through to the build result", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({}),
        "content/Scratch/b.md": note({}),
      }),
    );
    expect(result.unclassifiedFolders).toEqual(["content/Scratch"]);
    expect(result.symlinkedFolders).toEqual([]);
  });
});

describe("buildIndex frontmatter bound", () => {
  it("refuses an oversized frontmatter instead of handing it to the parser", async () => {
    /**
     * `yaml` is quadratic in mapping size — 14 ms at 1,000 keys, 1.2 s at
     * 16,000, and no completion inside two minutes for a 700 KB block. Discovery
     * walks arbitrary user files, so an unbounded note hangs `brain reindex`
     * with no finding and no way to tell which file did it.
     */
    const huge = `k: v\n`.repeat(Math.ceil(MAX_FRONTMATTER_CHARS / 5) + 100);
    const parsed: string[] = [];

    const start = Date.now();
    const result = await buildIndex(
      memoryRequest(
        {
          "content/DEV/huge.md": `---\n${huge}---\n\nBody.\n`,
          "content/DEV/fine.md": note({}),
        },
        FROZEN,
        {
          readFile: (path: string) => {
            parsed.push(path);
            return Promise.resolve(
              path.endsWith("huge.md")
                ? `---\n${huge}---\n\nBody.\n`
                : note({}),
            );
          },
        },
      ),
    );
    const elapsed = Date.now() - start;

    expect(result.index.notes.map((n) => n.path)).toEqual([
      "content/DEV/fine.md",
    ]);
    expect(result.parseIssues).toContainEqual({
      path: "content/DEV/huge.md",
      issues: [
        expect.objectContaining({ code: "length", severity: "error" }),
      ],
    });
    /** The file is read; it is the parse that is skipped. */
    expect(parsed).toContain("/vault/content/DEV/huge.md");
    /**
     * Deliberately generous, and not the load-bearing assertion: the unbounded
     * path measures about 1.2 s at this size, so a timing bound alone would
     * pass with the check removed. The `code: "length"` assertion above is what
     * actually discriminates; this only catches a catastrophic regression.
     */
    expect(elapsed).toBeLessThan(5000);
  });

  it("accepts a large but bounded frontmatter", async () => {
    const keys = Array.from({ length: 200 }, (_, i) => `k${String(i)}: v${String(i)}`).join("\n");
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": `---\n${keys}\n${note({})
          .split("\n")
          .slice(1)
          .join("\n")}`,
      }),
    );
    expect(result.index.notes).toHaveLength(1);
  });

  it("does not mistake a short unterminated frontmatter for an oversized one", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": "---\ntitle: never closed\nbody text\n",
      }),
    );
    const codes = result.parseIssues[0]?.issues.map((i) => i.code) ?? [];
    expect(codes).not.toContain("length");
    expect(codes.length).toBeGreaterThan(0);
  });
});


describe("buildIndex ordering is byte order, not locale collation", () => {
  /**
   * The gate this task exists to defend is worthless if a forbidden comparator
   * passes it. Every assertion below is a pair: the array IS byte-sorted, AND a
   * locale sort of the same array would differ. Swap `compareCanonical` for
   * `localeCompare` in build.ts and each one fails.
   *
   * The committed fixture cannot carry this: it is pure ASCII, where byte order
   * and locale order coincide, and its longest ordered array has five elements.
   */
  const byteOrder = (a: string, b: string): number =>
    Buffer.compare(
      Buffer.from(a.normalize("NFC"), "utf8"),
      Buffer.from(b.normalize("NFC"), "utf8"),
    );
  const localeOrder = (a: string, b: string): number => a.localeCompare(b);

  function expectByteOrdered(values: readonly string[], least = 3): void {
    expect(values.length).toBeGreaterThanOrEqual(least);
    expect(values).toEqual([...values].sort(byteOrder));
    /** Discrimination: locale collation would produce a different sequence. */
    expect(values).not.toEqual([...values].sort(localeOrder));
  }

  const VAULT = {
    "content/DEV/Zebra.md": note(
      { title: "Zebra note", tags: "[Zebra, apple, \u00c4pfel]" },
      "Zebra apple \u00c4pfel \u00d6l\nSee [[DEV/apple]] and [[DEV/\u00c4pfel]].\n",
    ),
    "content/DEV/apple.md": note(
      { title: "apple note", tags: "[apple, \u00c4pfel]" },
      "apple \u00c4pfel\nSee [[DEV/Zebra]] and [[DEV/nowhere]].\n",
    ),
    "content/DEV/\u00c4pfel.md": note(
      { title: "\u00c4pfel note", tags: "[\u00c4pfel, \u00d6l]" },
      "\u00c4pfel \u00d6l\nSee [[DEV/absent]].\n",
    ),
  };

  it("orders note paths, tags, tag paths and terms by bytes", async () => {
    const result = await buildIndex(memoryRequest(VAULT));

    expectByteOrdered(result.index.notes.map((n) => n.path));
    expectByteOrdered(result.index.tags.map((t) => t.tag), 4);
    expectByteOrdered(
      result.index.tags.find((t) => t.tag === "\u00c4pfel")?.paths ?? [],
    );
    /** Terms of the first note: mixed ASCII and non-ASCII in one array. */
    expectByteOrdered(result.index.notes[0]?.terms.map((t) => t.term) ?? [], 5);
  });

  it("orders graph edges and unresolved links by bytes", async () => {
    const result = await buildIndex(memoryRequest(VAULT));

    expect(result.graph.edges.length).toBeGreaterThanOrEqual(3);
    expectByteOrdered(result.graph.edges.map((e) => e.source));
    expect(result.unresolvedLinks.length).toBeGreaterThanOrEqual(2);

    /**
     * The secondary key. Both edges leave the same source, so only
     * `compareCanonical(a.target, b.target)` orders them — and byte order puts
     * `apple` before `\u00c4pfel` while every locale collation does the reverse.
     */
    const fromZebra = result.graph.edges
      .filter((e) => e.source === "content/DEV/Zebra.md")
      .map((e) => e.target);
    expect(fromZebra).toEqual([
      "content/DEV/apple.md",
      "content/DEV/\u00c4pfel.md",
    ]);
    expect(result.unresolvedLinks.map((u) => u.source)).toEqual(
      [...result.unresolvedLinks.map((u) => u.source)].sort(byteOrder),
    );
  });

  it("orders topTags past the cap and by count before name", async () => {
    /** The committed fixture's largest folder has three tags; the cap is five. */
    const many = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({ tags: "[t1, t2, t3, t4, t5, t6, t7]" }),
        "content/DEV/b.md": note({ tags: "[t7]" }, "second\n"),
      }),
    );
    const dev = many.index.folders.find((f) => f.name === "DEV");
    expect(dev?.topTags).toEqual(["t7", "t1", "t2", "t3", "t4"]);
  });
});

describe("buildIndex link resolution", () => {
  it("resolves the bare basename Obsidian actually writes", async () => {
    /**
     * "Shortest path when possible" is Obsidian's stock setting, so a vault
     * authored there contains `[[caching]]`. Without this tier every such link
     * is a Brain architecture former §7 `links` error and `brain lint` fails on a supported vault.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/caching.md": note({ title: "Cache invalidation" }),
        "content/PROJECTS/p.md": note(
          { type: "project-note", tags: "[project]" },
          "See [[caching]].\n",
        ),
      }),
    );
    expect(result.unresolvedLinks).toEqual([]);
    expect(result.graph.edges).toContainEqual({
      source: "content/PROJECTS/p.md",
      target: "content/DEV/caching.md",
      text: "caching",
    });
  });

  it("resolves a link into a nested folder by its relative path", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/sub/deep.md": note({ title: "Deep" }),
        "content/DEV/a.md": note({}, "See [[DEV/sub/deep]].\n"),
      }),
    );
    expect(result.unresolvedLinks).toEqual([]);
    expect(result.graph.edges[0]?.target).toBe("content/DEV/sub/deep.md");
  });

  it("reports an ambiguous basename instead of silently picking one", async () => {
    /**
     * Two notes sharing a basename in different subfolders have different
     * titles, different hashes and no case-insensitive path collision, so none
     * of Brain architecture former §7's three `duplicates` findings fires. Without this the link
     * points at the wrong note and nothing says so.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/beta/shared.md": note({ title: "Beta shared" }),
        "content/DEV/alpha/shared.md": note({ title: "Alpha shared" }),
        "content/DEV/a.md": note({}, "See [[shared]].\n"),
      }),
    );
    expect(result.ambiguousLinks).toEqual([
      {
        source: "content/DEV/a.md",
        text: "shared",
        chosen: "content/DEV/alpha/shared.md",
        candidates: [
          "content/DEV/alpha/shared.md",
          "content/DEV/beta/shared.md",
        ],
      },
    ]);
    expect(result.graph.edges).toHaveLength(1);
  });

  it("ignores a wikilink inside a fenced block or inline code", async () => {
    /**
     * A note documenting wikilink syntax would otherwise emit an unresolved
     * link per example — an `error` under Brain architecture former §7. The product's own template
     * is such a note.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note(
          {},
          "Write `[[DEV/inline]]` like this:\n\n```markdown\n[[DEV/fenced]]\n```\n\nAnd [[DEV/real]] resolves.\n",
        ),
        "content/DEV/real.md": note({ title: "Real" }, "target\n"),
      }),
    );
    expect(result.unresolvedLinks).toEqual([]);
    expect(result.graph.edges).toEqual([
      {
        source: "content/DEV/a.md",
        target: "content/DEV/real.md",
        text: "DEV/real",
      },
    ]);
  });

  it("emits one edge for a target linked twice with the same text", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({}, "[[DEV/b]] and again [[DEV/b]].\n"),
        "content/DEV/b.md": note({ title: "B" }, "b\n"),
      }),
    );
    expect(result.graph.edges).toHaveLength(1);
  });
});

describe("buildIndex carries what lint needs", () => {
  it("keeps info issues from a note that parsed", async () => {
    /**
     * `parseNote` returns issues on its success branch too, and that is where
     * every `unknown-key` lives. Brain architecture former §7 requires it as a `frontmatter` info
     * finding, and Task 6's unterminated-frontmatter heuristic is defined as an
     * unknown key containing whitespace — both unreachable if these are dropped.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({ myCustomKey: "value" }),
      }),
    );
    expect(result.index.notes).toHaveLength(1);
    expect(result.parseIssues).toEqual([
      {
        path: "content/DEV/a.md",
        issues: [
          expect.objectContaining({ code: "unknown-key", severity: "info" }),
        ],
      },
    ]);
  });

  it("carries sources so the provenance class can check them", async () => {
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({ sources: "[https://example.invalid/a, DEV/b]" }),
      }),
    );
    expect(result.index.notes[0]?.sources).toEqual([
      "https://example.invalid/a",
      "DEV/b",
    ]);

    /** Deduped like tags and aliases: one source, one provenance finding. */
    const repeated = await buildIndex(
      memoryRequest({
        "content/DEV/b.md": note({ sources: "[DEV/x, DEV/x, DEV/y]" }),
      }),
    );
    expect(repeated.index.notes[0]?.sources).toEqual(["DEV/x", "DEV/y"]);
  });

  it("counts a tag once even when a note lists it twice", async () => {
    const result = await buildIndex(
      memoryRequest({ "content/DEV/a.md": note({ tags: "[dev, dev, ops]" }) }),
    );
    expect(result.index.notes[0]?.tags).toEqual(["dev", "ops"]);
    expect(result.index.tags.find((t) => t.tag === "dev")).toEqual({
      tag: "dev",
      count: 1,
      paths: ["content/DEV/a.md"],
    });
  });

  it("does not report an empty frontmatter above a large body as oversized", async () => {
    /**
     * The closing fence of an empty block sits at offset 0 of the searched
     * slice. A closing-fence pattern that requires a preceding newline misses
     * it and tells the user to shrink a block of zero length.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": `---\n---\n\n${"word ".repeat(20000)}\n`,
      }),
    );
    const codes = result.parseIssues[0]?.issues.map((i) => i.code) ?? [];
    expect(codes).not.toContain("length");
    expect(codes).toContain("missing");
  });
});


describe("buildIndex under a hostile reader", () => {
  /**
   * The reversed reader is what Brain architecture former §6.2 calls the assertion that catches "a
   * `Map` whose insertion order leaked into output" — and `resolveLink` reads
   * `candidates[0]` straight out of Map insertion order. The committed fixture
   * cannot pin that: it has one edge, no ambiguity and no parse issues. This
   * vault has all three, plus non-ASCII names and nesting.
   */
  function reversed(request: IndexBuildRequest): IndexBuildRequest {
    return {
      ...request,
      reader: {
        readDir: async (path: string) =>
          [...(await request.reader.readDir(path))].reverse(),
      },
    };
  }

  const HARD = {
    "content/DEV/\u00c4pfel.md": note(
      { title: "\u00c4pfel note", tags: "[\u00c4pfel, dev]" },
      "See [[shared]] and [[DEV/sub/nested]].\n",
    ),
    "content/DEV/apple.md": note({ title: "apple note" }, "See [[shared]].\n"),
    "content/DEV/sub/nested.md": note({ title: "Nested" }, "nested body\n"),
    "content/DEV/alpha/shared.md": note({ title: "Alpha shared" }, "a\n"),
    "content/DEV/beta/shared.md": note({ title: "Beta shared" }, "b\n"),
    "content/DEV/unknown.md": note({ someExtraKey: "v" }, "has an info issue\n"),
    "content/DEV/broken.md": "no frontmatter at all\n",
  };

  it("produces identical bytes and identical findings when every directory is reversed", async () => {
    const forward = await buildIndex(memoryRequest(HARD));
    const backward = await buildIndex(reversed(memoryRequest(HARD)));

    expect(serializeIndex(backward.index)).toBe(serializeIndex(forward.index));
    expect(serializeGraph(backward.graph)).toBe(serializeGraph(forward.graph));
    expect(backward.ambiguousLinks).toEqual(forward.ambiguousLinks);
    expect(backward.parseIssues).toEqual(forward.parseIssues);
    expect(backward.unresolvedLinks).toEqual(forward.unresolvedLinks);

    /** Non-empty, or the four assertions above compare nothing. */
    expect(forward.graph.edges.length).toBeGreaterThanOrEqual(3);
    expect(forward.ambiguousLinks.length).toBeGreaterThanOrEqual(2);
    expect(forward.parseIssues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildIndex case-insensitive fallback", () => {
  const VAULT = {
    "content/DEV/caching.md": note(
      { title: "Cache invalidation", aliases: "[cache busting]" },
      "target\n",
    ),
    "content/PROJECTS/p.md": note(
      { type: "project-note", tags: "[project]" },
      "[[Caching]] [[CACHING]] [[cache invalidation]] [[Cache Busting]]\n",
    ),
  };

  it("resolves a link whose case differs from the file, title or alias", async () => {
    /**
     * Obsidian's resolver is case-insensitive on macOS and Windows, so each of
     * these opens the note in the editor. Leaving them unresolved makes
     * `brain lint` error on links that demonstrably work.
     */
    const result = await buildIndex(memoryRequest(VAULT));
    expect(result.unresolvedLinks).toEqual([]);
    expect(result.graph.edges.map((e) => e.text).sort()).toEqual([
      "CACHING",
      "Cache Busting",
      "Caching",
      "cache invalidation",
    ]);
  });

  it("prefers an exact match over a case-folded one", async () => {
    /** Case-sensitive intent must not lose to a case-insensitive coincidence. */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({ title: "Report" }, "x\n"),
        "content/DEV/b.md": note({ title: "report" }, "y\n"),
        "content/DEV/c.md": note({}, "See [[report]].\n"),
      }),
    );
    expect(result.graph.edges[0]?.target).toBe("content/DEV/b.md");
    expect(result.ambiguousLinks).toEqual([]);
  });

  it("does not report a note as ambiguous with itself", async () => {
    /**
     * One note registers four spellings in the path tier and two of them can
     * fold together; without deduplication by identity it reports itself.
     */
    const result = await buildIndex(
      memoryRequest({
        "content/DEV/a.md": note({ title: "A" }, "x\n"),
        "content/DEV/b.md": note({}, "See [[content/DEV/a.md]] and [[DEV/A]].\n"),
      }),
    );
    expect(result.ambiguousLinks).toEqual([]);
    expect(result.graph.edges).toHaveLength(2);
  });
});
