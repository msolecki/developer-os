import { describe, expect, it } from "vitest";

import { compareCanonical } from "../discovery/index.js";
import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import { buildIndex } from "../indexes/index.js";
import type { IndexBuildRequest } from "../indexes/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { canonicalizeArtifact, GENERATED_AT_SENTINEL } from "./drift.js";
import { artifactPaths } from "../indexes/index.js";
import { lintBuild, lintVault } from "./lint.js";
import type { LintFinding } from "./lint.js";
import {
  buildRequestForFixture,
  lintRequestFor,
  lintRequestForFixture,
  writtenArtifacts,
} from "./testing.js";

const BUILD_CLOCK = "2026-08-04T00:00:00.000Z";
/**
 * Explicit, never derived from the host clock. Two of `legacy-shape`'s notes
 * were reviewed 2026-02-11, which is 174 days before this date and 180 days
 * before 2026-08-10 — so a real clock would silently change how many staleness
 * findings this suite sees, depending on the day it runs.
 */
const TODAY = "2026-08-04";

const PATHS = artifactPaths(DEFAULT_BRAIN_CONFIG);

function of(result: { readonly findings: readonly LintFinding[] }, cls: string) {
  return result.findings.filter((finding) => finding.class === cls);
}

/**
 * `expect.stringContaining` is typed `any`, which defeats the repository's
 * no-unsafe-assignment rule at every call site. One narrowing shim keeps the
 * assertions readable and the rule enforced everywhere else.
 */
function containing(text: string): string {
  return expect.stringContaining(text) as string;
}

/** An in-memory vault, for shapes a real filesystem cannot hold. */
function memoryBuild(files: Record<string, string>): IndexBuildRequest {
  const tree = new Map<string, { name: string; dir: boolean }[]>();
  for (const vaultPath of Object.keys(files)) {
    const segments = vaultPath.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = `/vault${i === 0 ? "" : `/${segments.slice(0, i).join("/")}`}`;
      const siblings = tree.get(parent) ?? [];
      const name = segments[i] as string;
      if (!siblings.some((entry) => entry.name === name)) {
        siblings.push({ name, dir: i < segments.length - 1 });
      }
      tree.set(parent, siblings);
    }
  }

  const reader: DirectoryReader = {
    readDir: (path: string): Promise<readonly DirectoryEntry[]> =>
      Promise.resolve(
        (tree.get(path) ?? []).map((entry) => ({
          name: entry.name,
          isDirectory: entry.dir,
          isFile: !entry.dir,
          isSymbolicLink: false,
        })),
      ),
  };

  return {
    vaultRoot: "/vault",
    config: DEFAULT_BRAIN_CONFIG,
    reader,
    readFile: (path: string) => {
      const text = files[path.replace("/vault/", "")];
      return text === undefined
        ? Promise.reject(new Error(`no fixture: ${path}`))
        : Promise.resolve(text);
    },
    assertReadable: () => Promise.resolve(),
    canonicalize: (path: string) => Promise.resolve(path),
    now: () => BUILD_CLOCK,
  };
}

function note(fields: Record<string, string>, body = "Body.\n"): string {
  const merged: Record<string, string> = {
    schemaVersion: "1",
    title: "A note",
    type: "knowledge-note",
    created: "2026-01-01",
    tags: "[dev]",
    summary: "A summary.",
    stage: "established",
    author: "human",
    reviewed: "2026-01-01",
    ...fields,
  };
  return `---\n${Object.entries(merged)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}`;
}

async function lintMemory(
  files: Record<string, string>,
  today = TODAY,
): Promise<Awaited<ReturnType<typeof lintVault>>> {
  const build = memoryBuild(files);
  const result = await buildIndex(build);
  return lintVault(lintRequestFor(writtenArtifacts(result), today, build));
}

describe("index-drift", () => {
  it("reports no drift after a clean reindex even when the clock has moved", async () => {
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const written = writtenArtifacts(built);
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", "2026-09-01T12:34:56.000Z")),
    );
    expect(of(result, "index-drift")).toEqual([]);
  });

  it("reports drift when a written artifact differs in anything but generatedAt", async () => {
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const written = { ...writtenArtifacts(built) };
    written[PATHS.index] = (written[PATHS.index] ?? "").replace(
      "Cache invalidation on write",
      "Cache invalidation on read",
    );
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", BUILD_CLOCK)),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ class: "index-drift", severity: "error", path: PATHS.index }),
    );
  });

  it("reports drift in a rendered view, not only in the JSON", async () => {
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const written = { ...writtenArtifacts(built) };
    written[PATHS.catalog] = `${written[PATHS.catalog] ?? ""}- injected\n`;
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", BUILD_CLOCK)),
    );
    expect(of(result, "index-drift").map((f) => f.path)).toEqual([PATHS.catalog]);
  });

  it("names the first differing line rather than dumping a diff", async () => {
    /** Spec §6.3. A whole-file diff echoes note content into a terminal and a log. */
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const written = { ...writtenArtifacts(built) };
    written[PATHS.vaultMap] = (written[PATHS.vaultMap] ?? "").replace(
      "# Vault map",
      "# Vault MAP",
    );
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", BUILD_CLOCK)),
    );
    /**
     * The number goes in the field, and the message says nothing about a line.
     * `frontmatter` findings have always used the structured field; drift wrote
     * "at line 6" into `message` and left `line` null, so a `--json` consumer
     * had to parse English to recover a number the type already declares.
     */
    const finding = of(result, "index-drift")[0];
    expect(finding?.line).toBe(6);
    expect(finding?.message).not.toMatch(/\bline\b/iu);
    expect(finding?.message).not.toContain("Vault MAP");
  });

  it("reports a missing artifact as an error", async () => {
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    /** Rebuilt without the key rather than deleted: a dynamic delete is banned. */
    const written = Object.fromEntries(
      Object.entries(writtenArtifacts(built)).filter(
        ([path]) => path !== PATHS.graph,
      ),
    );
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", BUILD_CLOCK)),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "index-drift",
        severity: "error",
        path: PATHS.graph,
        message: containing("has never been built"),
        /** A file that does not exist has no line to name. */
        line: null,
      }),
    );
  });
});

describe("canonicalizeArtifact", () => {
  it("replaces exactly one occurrence per artifact", async () => {
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    for (const text of Object.values(writtenArtifacts(built))) {
      const canonical = canonicalizeArtifact(text);
      expect(canonical.split(GENERATED_AT_SENTINEL)).toHaveLength(2);
      expect(canonical).not.toContain(BUILD_CLOCK);
    }
  });

  it("cannot rewrite a note body that contains the literal text", () => {
    /**
     * A note whose body reads `generatedAt: something` must not have that line
     * rewritten — the canonical form would then hide a real edit. The Markdown
     * pattern is anchored and non-global, and the renderer's escaping keeps
     * note content off the start of a line, so only line 2 can ever match.
     */
    const artifact = [
      "---",
      `generatedAt: ${BUILD_CLOCK}`,
      "schemaVersion: 1",
      "---",
      "",
      "- a note mentioning generatedAt: 2020-01-01 mid-line",
      "",
    ].join("\n");
    const canonical = canonicalizeArtifact(artifact);
    expect(canonical).toContain("generatedAt: 2020-01-01 mid-line");
    expect(canonical.split(GENERATED_AT_SENTINEL)).toHaveLength(2);
  });
});

describe("frontmatter", () => {
  it("reports missing keys, a bad enum, a bad date and an oversized summary as errors", async () => {
    const request = await lintRequestForFixture("malformed/frontmatter-errors", TODAY);
    const result = await lintVault(request);
    const codes = of(result, "frontmatter").filter((f) => f.severity === "error");

    expect(codes.map((f) => f.path)).toContain("content/DEV/missing.md");
    expect(codes.map((f) => f.path)).toContain("content/DEV/bad-enum.md");
    expect(codes.map((f) => f.path)).toContain("content/DEV/bad-date.md");
    expect(codes.map((f) => f.path)).toContain("content/DEV/long-summary.md");
  });

  it("reports an unknown key at info, not as a failure", async () => {
    const request = await lintRequestForFixture("malformed/frontmatter-errors", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "frontmatter",
        severity: "info",
        path: "content/DEV/unknown-key.md",
        key: "someExtraKey",
      }),
    );
  });

  it("warns when a swallowed prose line becomes a frontmatter key", async () => {
    /**
     * Carried from Task 2's review. An opening fence that is never closed has
     * the next `---` in the body treated as the closing one, so the paragraph
     * above it is parsed as frontmatter and the indexed body silently loses it.
     * The only signal is an unknown key. It is a heuristic, which is why it
     * lives here and not in the parser.
     */
    const request = await lintRequestForFixture("malformed/unterminated", TODAY);
    const result = await lintVault(request);
    const found = of(result, "frontmatter").find((f) => f.severity === "warn");

    expect(found?.path).toBe("content/DEV/a.md");
    expect(found?.message).toContain("unterminated");

    /**
     * Bounded. The key here *is* a line of body prose, so this is the one
     * message guaranteed to carry note content into a terminal and a log —
     * `note.ts` truncates at 64 for exactly this reason and re-interpolating
     * the raw key would undo that guard.
     */
    expect(found?.message).toContain("\u2026");
    expect(found?.message).not.toContain("parses as frontmatter");
    expect(found?.message.length).toBeLessThan(250);
    expect((found?.key ?? "").length).toBeLessThanOrEqual(65);
  });

  it("does not warn on an ordinary Obsidian property name", async () => {
    /**
     * Obsidian's Properties UI accepts arbitrary property names, so `Due date`
     * is a stock note. Whitespace alone would fire on it, and a class that
     * fires on ordinary output is a class users learn to ignore — the same
     * argument spec §7's amendment used for the bare-basename link tier.
     */
    const result = await lintMemory({
      "content/DEV/a.md": note({ "Due date": "2026-09-01", Status: "in review" }),
    });
    const warns = of(result, "frontmatter").filter((f) => f.severity === "warn");
    expect(warns).toEqual([]);
    /** Still reported, just at info, which is what an unknown key is. */
    expect(
      of(result, "frontmatter").filter((f) => f.severity === "info"),
    ).toHaveLength(2);
  });

  it("reports an unclassified folder at warn", async () => {
    const request = await lintRequestForFixture("malformed/unclassified-folder", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "frontmatter",
        severity: "warn",
        path: "content/Scratch",
        message: containing("not a configured topic folder"),
      }),
    );
  });
});

describe("provenance", () => {
  it("reports an agent-authored note with no review at warn", async () => {
    const request = await lintRequestForFixture("legacy-shape", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "provenance",
        severity: "warn",
        path: "content/PROJECTS/orchard.md",
        key: "reviewed",
      }),
    );
  });

  it("reports a source that is neither a resolvable note nor an absolute URL", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({
        sources: "[https://example.invalid/x, DEV/present, DEV/absent]",
      }),
      "content/DEV/present.md": note({ title: "Present" }),
    });
    const findings = of(result, "provenance").filter((f) => f.severity === "error");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("DEV/absent");
  });
});

describe("links", () => {
  it("reports an unresolved wikilink as an error naming the source", async () => {
    const request = await lintRequestForFixture("malformed/broken-link", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "links",
        severity: "error",
        path: "content/DEV/caching.md",
        message: containing("DEV/absent"),
      }),
    );
  });

  it("reports a link into an excluded folder as an error", async () => {
    const request = await lintRequestForFixture("malformed/link-into-raw", TODAY);
    const result = await lintVault(request);
    const finding = of(result, "links")[0];
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("_raw");
    expect(finding?.message).toContain("excluded");

    /**
     * The target exists on disk and carries the fixture marker. Nothing it
     * contains may reach a finding — the link is named by its text, never by
     * anything read out of the excluded file.
     */
    for (const f of result.findings) {
      expect(f.message).not.toContain("EXCLUDED-FROM-EVERY-INDEX");
    }
  });

  it("reports a link that escapes the vault as an error", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({}, "See [[../../etc/passwd]].\n"),
    });
    const finding = of(result, "links")[0];
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("outside the vault");
  });

  it("reports an ambiguous link at warn, naming what it chose", async () => {
    const result = await lintMemory({
      "content/DEV/alpha/shared.md": note({ title: "Alpha shared" }),
      "content/DEV/beta/shared.md": note({ title: "Beta shared" }),
      "content/DEV/a.md": note({}, "See [[shared]].\n"),
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "links",
        severity: "warn",
        path: "content/DEV/a.md",
        message: containing("content/DEV/alpha/shared.md"),
      }),
    );
  });
});

describe("duplicates", () => {
  it("reports a case-insensitive path collision as an error", async () => {
    /**
     * Built in memory because it cannot exist on disk here: a default macOS
     * volume is case-insensitive, so `Caching.md` and `caching.md` are one
     * file and the fixture directory the plan asks for is unwritable. The
     * collision is real on a case-sensitive volume and on a Linux CI checkout,
     * which is exactly when a clone silently loses one of the two notes.
     */
    const result = await lintMemory({
      "content/DEV/Caching.md": note({ title: "Upper" }),
      "content/DEV/caching.md": note({ title: "Lower" }),
    });
    const errors = of(result, "duplicates").filter((f) => f.severity === "error");
    expect(errors.map((f) => f.path).sort()).toEqual([
      "content/DEV/Caching.md",
      "content/DEV/caching.md",
    ]);
  });

  it("reports a duplicate title within one topic folder at warn", async () => {
    const request = await lintRequestForFixture("malformed/duplicate-title", TODAY);
    const result = await lintVault(request);
    const found = of(result, "duplicates").filter((f) => f.severity === "warn");
    expect(found.map((f) => f.path).sort()).toEqual([
      "content/DEV/one.md",
      "content/DEV/two.md",
    ]);
  });

  it("does not report the same title in two different topic folders", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ title: "Shared" }, "one\n"),
      "content/INFRA/b.md": note({ title: "Shared" }, "two\n"),
    });
    expect(
      of(result, "duplicates").filter((f) => f.message.includes("title")),
    ).toEqual([]);
  });

  it("reports two titles that differ only by an invisible character", async () => {
    /**
     * NEW-6. Written as an escape, never as the character: a literal ZWSP in a
     * source file is invisible in every diff, and `tests/repository` fails the
     * build over one.
     */
    const result = await lintMemory({
      "content/DEV/a.md": note({ title: "Deploy keys" }, "one\n"),
      "content/DEV/b.md": note({ title: "Deploy\u200B keys" }, "two\n"),
    });
    const titles = of(result, "duplicates").filter((f) => f.key === "title");
    expect(titles.map((f) => f.path).sort()).toEqual([
      "content/DEV/a.md",
      "content/DEV/b.md",
    ]);
  });

  it("groups on the form the catalog shows, not on the bytes on disk", async () => {
    /**
     * The seam this class is about. `catalog.md` renders the *screened* title,
     * so these two notes produce byte-identical rows; a check about what a
     * human perceives as a duplicate has to run on the same form the human was
     * shown, or the artifact and the report disagree in front of them.
     */
    const files = {
      "content/DEV/a.md": note({ title: "Deploy keys" }, "one\n"),
      "content/DEV/b.md": note({ title: "Deploy\u200B keys" }, "two\n"),
    };
    const build = memoryBuild(files);
    const catalog = writtenArtifacts(await buildIndex(build))[PATHS.catalog] ?? "";
    expect(catalog.split("[Deploy keys]")).toHaveLength(3);
    expect(catalog).not.toContain("\u200B");

    const result = await lintMemory(files);
    expect(of(result, "duplicates").filter((f) => f.key === "title")).toHaveLength(2);
  });

  /**
   * **This case changed when NEW-10 closed, and the change is the point.**
   *
   * It used to assert that two titles made only of invisible characters key to
   * the same empty string and are reported as duplicates of each other — the
   * screened-key rule working, since `catalog.md` rendered both rows with empty
   * link text and they *were* the same row to anyone opening the vault. The
   * reason such notes could reach the `duplicates` class at all was the gap
   * recorded as NEW-10: `String#trim` removes neither U+200B nor U+00AD, so
   * `note.ts` accepted the title.
   *
   * `note.ts` now refuses it, which is the fix that class of note needed —
   * the value should never have been accepted, and the class that reported it
   * was right. So the pin moves rather than disappears: such a note is a
   * `frontmatter` error, and nothing downstream has to represent an empty row.
   */
  it("refuses a title that screens to nothing before duplicates ever sees it", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ title: "\u200B" }, "one\n"),
      "content/DEV/b.md": note({ title: "\u00AD" }, "two\n"),
    });
    expect(of(result, "frontmatter").filter((f) => f.key === "title")).toHaveLength(2);
    expect(of(result, "duplicates").filter((f) => f.key === "title")).toHaveLength(0);
  });

  it("reports an identical content hash at warn", async () => {
    const request = await lintRequestForFixture("malformed/duplicate-content", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "duplicates",
        severity: "warn",
        message: containing("identical content"),
      }),
    );
  });
});

describe("staleness", () => {
  it("reports a review older than the threshold at warn", async () => {
    const request = await lintRequestForFixture("legacy-shape", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "staleness",
        severity: "warn",
        path: "content/INFRA/backups.md",
      }),
    );
  });

  it("does not report a review inside the threshold", async () => {
    /**
     * 174 days before `TODAY`, against a 180-day default. The boundary matters:
     * an off-by-one here makes two of five fixture notes stale and every count
     * in this suite move.
     */
    const request = await lintRequestForFixture("legacy-shape", TODAY);
    const result = await lintVault(request);
    const paths = of(result, "staleness").map((f) => f.path);
    expect(paths).not.toContain("content/DEV/caching.md");
    expect(paths).not.toContain("content/DEV/testing.md");
  });

  it("treats a review exactly at the threshold as fresh, one day past it as stale", async () => {
    /**
     * Spec §7 says "older than", so the boundary day itself is not stale.
     * `>=` instead of `>` passes every other test in this file: no fixture sits
     * on the boundary, and an off-by-one here quietly ages every vault by a day.
     * 2026-02-05 is exactly 180 days before TODAY; 2026-02-04 is 181.
     */
    const onBoundary = await lintMemory({
      "content/DEV/a.md": note({ reviewed: "2026-02-05" }),
    });
    expect(of(onBoundary, "staleness")).toEqual([]);

    const pastIt = await lintMemory({
      "content/DEV/a.md": note({ reviewed: "2026-02-04" }),
    });
    expect(of(pastIt, "staleness")).toHaveLength(1);
    expect(of(pastIt, "staleness")[0]?.message).toContain("181 days");
  });

  it("reports the stale fixture's old review, and only that note", async () => {
    const result = await lintVault(
      await lintRequestForFixture("malformed/stale", TODAY),
    );
    const byReview = of(result, "staleness").filter((f) => f.key === "reviewed");
    expect(byReview.map((f) => f.path)).toEqual(["content/DEV/old-review.md"]);
    /** One concern per fixture: no provenance finding rides along. */
    expect(of(result, "provenance")).toEqual([]);
  });

  it("reports an emerging note with occurrences at or above three and no review", async () => {
    const request = await lintRequestForFixture("malformed/stale", TODAY);
    const result = await lintVault(request);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        class: "staleness",
        severity: "warn",
        path: "content/DEV/emerging.md",
        message: containing("emerging"),
      }),
    );
  });

  it("honours a configured reviewAfterDays instead of the default", async () => {
    const build = memoryBuild({
      "content/DEV/a.md": note({ reviewed: "2026-07-01" }),
    });
    const config = {
      ...DEFAULT_BRAIN_CONFIG,
      staleness: { reviewAfterDays: 10 },
    };
    const tight = { ...build, config };
    const result = await buildIndex(tight);
    const linted = await lintVault(
      lintRequestFor(writtenArtifacts(result, config), TODAY, tight),
    );
    expect(of(linted, "staleness")).toHaveLength(1);
  });
});

describe("LintResult", () => {
  it("counts an error only when one is present", async () => {
    const clean = await lintVault(await lintRequestForFixture("legacy-shape", TODAY));
    expect(clean.errorCount).toBe(0);
    expect(clean.warnCount).toBeGreaterThan(0);

    const broken = await lintVault(
      await lintRequestForFixture("malformed/broken-link", TODAY),
    );
    expect(broken.errorCount).toBeGreaterThan(0);
  });

  it("counts match the findings they summarise", async () => {
    const result = await lintVault(
      await lintRequestForFixture("malformed/frontmatter-errors", TODAY),
    );
    const count = (severity: string) =>
      result.findings.filter((f) => f.severity === severity).length;
    expect(result.errorCount).toBe(count("error"));
    expect(result.warnCount).toBe(count("warn"));
    expect(result.infoCount).toBe(count("info"));
    expect(result.errorCount + result.warnCount + result.infoCount).toBe(
      result.findings.length,
    );
  });

  it("orders findings by path, then class, then message", async () => {
    /**
     * `legacy-shape`, not a single-class fixture. Findings are produced class by
     * class, so on a fixture whose findings share one class the unsorted order
     * already equals the sorted one and removing the sort changes nothing. Here
     * the two orders genuinely differ: provenance and staleness interleave
     * across two paths.
     */
    const result = await lintVault(await lintRequestForFixture("legacy-shape", TODAY));
    const keys = result.findings.map((f) => `${f.path} ${f.class} ${f.message}`);

    /**
     * Sorted with the production comparator, not `Array#sort`'s UTF-16 default.
     * The two disagree above the BMP, so the default oracle pins the wrong
     * contract and would break the day a fixture path gains an emoji.
     */
    expect(keys).toEqual([...keys].sort(compareCanonical));
    expect(new Set(result.findings.map((f) => f.class)).size).toBeGreaterThan(1);
    expect(new Set(result.findings.map((f) => f.path)).size).toBeGreaterThan(1);
    /** Production order would be provenance-first; path order puts INFRA first. */
    expect(result.findings[0]?.path).toBe("content/INFRA/backups.md");
  });

  it("is identical under a reversed directory reader", async () => {
    const forward = await lintVault(
      await lintRequestForFixture("malformed/frontmatter-errors", TODAY),
    );
    const base = buildRequestForFixture("malformed/frontmatter-errors", BUILD_CLOCK);
    const reversedBuild: IndexBuildRequest = {
      ...base,
      reader: {
        readDir: async (path: string) => [...(await base.reader.readDir(path))].reverse(),
      },
    };
    const built = await buildIndex(reversedBuild);
    const backward = await lintVault(
      lintRequestFor(writtenArtifacts(built), TODAY, reversedBuild),
    );
    expect(backward.findings).toEqual(forward.findings);
  });
});


describe("branches the first review found free to delete", () => {
  it("reports a symlinked topic folder, the only signal that one vanished", async () => {
    /**
     * Discovery does not descend into a symlinked topic folder, so its notes
     * reach neither the index nor the unclassified list. Without this finding
     * the user sees an empty folder in the catalog and has nothing to search
     * for. Deleting the loop left all thirty tests green.
     */
    const build = memoryBuild({
      "content/DEV/a.md": note({}),
      "content/INFRA/b.md": note({ title: "B" }),
    });
    const linked: IndexBuildRequest = {
      ...build,
      reader: {
        readDir: async (path: string) =>
          (await build.reader.readDir(path)).map((entry) =>
            path === "/vault/content" && entry.name === "INFRA"
              ? { ...entry, isDirectory: false, isSymbolicLink: true }
              : entry,
          ),
      },
    };
    const result = await buildIndex(linked);
    const linted = await lintVault(
      lintRequestFor(writtenArtifacts(result), TODAY, linked),
    );
    expect(linted.findings).toContainEqual(
      expect.objectContaining({
        class: "frontmatter",
        severity: "warn",
        path: "content/INFRA",
        message: containing("symlink"),
      }),
    );
  });

  it("reports drift when an artifact differs only by its trailing newline", async () => {
    /**
     * The tail branch of `firstDifferingLine`, which no drift test reached: the
     * in-loop cases all return earlier. A "fix end of files" hook or an editor
     * strips that newline, and with the branch removed `brain lint` reports
     * clean while `brain reindex` would rewrite the file.
     */
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const written = { ...writtenArtifacts(built) };
    written[PATHS.catalog] = (written[PATHS.catalog] ?? "").replace(/\n$/u, "");
    const result = await lintVault(
      lintRequestFor(written, TODAY, buildRequestForFixture("legacy-shape", BUILD_CLOCK)),
    );
    expect(of(result, "index-drift").map((f) => f.path)).toEqual([PATHS.catalog]);
  });

  it("reports an absolute or home-relative link as escaping the vault", async () => {
    for (const text of ["/etc/passwd", "~/secrets", "../../etc/passwd"]) {
      const result = await lintMemory({
        "content/DEV/a.md": note({}, `See [[${text}]].\n`),
      });
      expect(of(result, "links")[0]?.message).toContain("outside the vault");
    }
  });

  it("resolves a source spelled with or without contentRoot and extension", async () => {
    for (const source of [
      "DEV/present",
      "DEV/present.md",
      "content/DEV/present",
      "content/DEV/present.md",
    ]) {
      const result = await lintMemory({
        "content/DEV/a.md": note({ sources: `[${source}]` }),
        "content/DEV/present.md": note({ title: "Present" }),
      });
      expect(of(result, "provenance").filter((f) => f.severity === "error")).toEqual([]);
    }
  });

  it("reports an oversized frontmatter through the frontmatter class", async () => {
    const huge = "k: v\n".repeat(20000);
    const result = await lintMemory({
      "content/DEV/huge.md": `---\n${huge}---\n\nBody.\n`,
      "content/DEV/fine.md": note({ title: "Fine" }),
    });
    expect(of(result, "frontmatter")).toContainEqual(
      expect.objectContaining({
        class: "frontmatter",
        severity: "error",
        path: "content/DEV/huge.md",
        message: containing("exceeds"),
      }),
    );
  });

  it("reports a wrong-typed frontmatter value as an error", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ tags: "notanarray" }),
    });
    expect(of(result, "frontmatter")).toContainEqual(
      expect.objectContaining({ severity: "error", key: "tags" }),
    );
  });
});

describe("shapes that must not be silently clean", () => {
  it("distinguishes a normalization collision from a case collision", async () => {
    /**
     * Discovery NFC-folds vault paths, so two files differing only in
     * normalization carry the *same* path string. Telling that user to fix
     * their casing names one path twice and describes a problem they do not
     * have.
     */
    const nfd = "caf\u0065\u0301.md";
    const nfc = "caf\u00e9.md";
    const collision = await lintMemory({
      [`content/DEV/${nfd}`]: note({ title: "One" }),
      [`content/DEV/${nfc}`]: note({ title: "Two" }),
    });
    const errors = of(collision, "duplicates").filter((f) => f.severity === "error");
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toContain("Unicode normalization");
    expect(errors[0]?.message).not.toContain("by case");
  });

  it("does not blame an excluded folder for a title that starts with a dot", async () => {
    /** `[[.NET conventions]]` is a typo, not a link into an excluded tree. */
    const result = await lintMemory({
      "content/DEV/a.md": note({}, "See [[.NET conventions]].\n"),
    });
    const finding = of(result, "links")[0];
    expect(finding?.message).toContain("resolves to no note");
    expect(finding?.message).not.toContain("excluded");
  });

  it("emits one finding for a target linked twice from one note", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({}, "[[absent]] and again [[absent]].\n"),
    });
    expect(of(result, "links")).toHaveLength(1);
  });

  it("accepts mailto and doi sources and refuses javascript and file", async () => {
    const good = await lintMemory({
      "content/DEV/a.md": note({ sources: "[mailto:x@example.invalid, doi:10.1000/xyz]" }),
    });
    expect(of(good, "provenance").filter((f) => f.severity === "error")).toEqual([]);

    for (const bad of ["javascript://%0aalert(1)", "file:///etc/passwd"]) {
      const result = await lintMemory({
        "content/DEV/a.md": note({ sources: `["${bad}"]` }),
      });
      expect(of(result, "provenance").filter((f) => f.severity === "error")).toHaveLength(1);
    }
  });

  it("resolves a source spelled in NFD against an NFC path", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ sources: "[DEV/caf\u0065\u0301]" }),
      "content/DEV/caf\u00e9.md": note({ title: "Cafe" }),
    });
    expect(of(result, "provenance").filter((f) => f.severity === "error")).toEqual([]);
  });

  it("bounds a very long link text in the message it prints", async () => {
    const long = "x".repeat(600);
    const result = await lintMemory({
      "content/DEV/a.md": note({}, `See [[${long}]].\n`),
    });
    const message = of(result, "links")[0]?.message ?? "";
    expect(message.length).toBeLessThan(140);
    expect(message).toContain("\u2026");
  });

  it("reports nothing on an empty vault, and says so deliberately", async () => {
    /**
     * The literal case of "a gate that can pass by scanning nothing". A vault
     * with no notes lints clean, and its artifacts match an empty build, so
     * drift is clean too. That is the correct contract — `brain status` is
     * where an empty vault is surfaced — but it has to be pinned, or a lint
     * that silently stopped scanning would look identical.
     */
    const result = await lintMemory({});
    expect(result.findings).toEqual([]);
    expect(result.errorCount).toBe(0);

    /** Non-empty proof that the same helper does find things. */
    const populated = await lintMemory({
      "content/DEV/a.md": note({}, "See [[absent]].\n"),
    });
    expect(populated.errorCount).toBeGreaterThan(0);
  });
});


describe("bounds that were free to remove", () => {
  it("folds normalization when grouping duplicate titles", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ title: "caf\u0065\u0301 notes" }, "one\n"),
      "content/DEV/b.md": note({ title: "caf\u00e9 notes" }, "two\n"),
    });
    const titles = of(result, "duplicates").filter((f) => f.key === "title");
    expect(titles.map((f) => f.path).sort()).toEqual([
      "content/DEV/a.md",
      "content/DEV/b.md",
    ]);
  });

  it("names at most three siblings when many notes share one hash", async () => {
    /** Forty byte-identical notes must not produce forty kilobytes of message. */
    const body = note({ title: "Cloned" }, "identical\n");
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) {
      files[`content/DEV/c${String(i).padStart(2, "0")}.md`] = body;
    }
    const result = await lintMemory(files);
    const hashFindings = of(result, "duplicates").filter((f) => f.key === null);

    expect(hashFindings).toHaveLength(12);
    for (const f of hashFindings) {
      expect(f.message).toContain("and 8 more");
      expect(f.message.length).toBeLessThan(200);
    }
  });
});


describe("the second review's findings", () => {
  it("rejects a malformed URL even when its scheme is allowed", async () => {
    /**
     * Widening *which* schemes are legal must not stop checking that what
     * follows one is a URL. `https:/example.invalid` — a single slash — is a
     * routine typo, and provenance caught it before the allowlist landed.
     */
    for (const bad of [
      "https:/example.invalid/paper",
      "https:",
      "http:notaurl",
      "doi:",
      "urn:",
      "isbn:",
    ]) {
      const result = await lintMemory({
        /** Quoted: `[https:]` is a YAML mapping, not a one-element list. */
        "content/DEV/a.md": note({ sources: `["${bad}"]` }),
      });
      expect(
        of(result, "provenance").filter((f) => f.severity === "error"),
        `"${bad}" should have been refused`,
      ).toHaveLength(1);
    }
  });

  it("accepts a well-formed example of every scheme it advertises", async () => {
    /** So the message's list and the patterns that enforce it cannot drift. */
    for (const good of [
      "http://example.invalid/a",
      "https://example.invalid/a",
      "mailto:someone@example.invalid",
      "doi:10.1000/xyz123",
      "urn:isbn:0451450523",
      "isbn:0451450523",
    ]) {
      const result = await lintMemory({
        "content/DEV/a.md": note({ sources: `["${good}"]` }),
      });
      expect(
        of(result, "provenance").filter((f) => f.severity === "error"),
      ).toEqual([]);
    }
  });

  it("names the twin when two notes share a path and their bytes", async () => {
    /**
     * Filtering the sibling list by path removes the twin along with self when
     * both carry the same NFC path, and the message reads "identical content
     * to " with nothing after it.
     */
    const body = note({ title: "Cloned" }, "identical\n");
    const result = await lintMemory({
      "content/DEV/caf\u0065\u0301.md": body,
      "content/DEV/caf\u00e9.md": body,
    });
    /** The hash rows: warn (unlike the collision error) and keyless (unlike title). */
    const hashFindings = of(result, "duplicates").filter(
      (f) => f.severity === "warn" && f.key === null,
    );
    expect(hashFindings.length).toBeGreaterThan(0);
    for (const f of hashFindings) {
      expect(f.message).not.toMatch(/identical content to\s*$/u);
      expect(f.message).toContain("content/DEV/caf");
    }
  });

  it("pins the length that decides prose from a property name", async () => {
    /**
     * The constant is the whole of the Obsidian fix, and any value between 8
     * and 90 kept the other two tests green. 24 does not warn; 25 does.
     */
    const twentyFour = "abcd efghij klmnop qrstu";
    const twentyFive = "abcde efghij klmnop qrstu";
    expect(twentyFour).toHaveLength(24);
    expect(twentyFive).toHaveLength(25);

    const short = await lintMemory({
      "content/DEV/a.md": note({ [twentyFour]: "v" }),
    });
    expect(of(short, "frontmatter").filter((f) => f.severity === "warn")).toEqual([]);

    const long = await lintMemory({
      "content/DEV/a.md": note({ [twentyFive]: "v" }),
    });
    expect(
      of(long, "frontmatter").filter((f) => f.severity === "warn"),
    ).toHaveLength(1);
  });

  it("emits one finding for an ambiguous link repeated in a note", async () => {
    const result = await lintMemory({
      "content/DEV/alpha/shared.md": note({ title: "Alpha shared" }),
      "content/DEV/beta/shared.md": note({ title: "Beta shared" }),
      "content/DEV/a.md": note({}, "See [[shared]] and again [[shared]].\n"),
    });
    expect(of(result, "links")).toHaveLength(1);
  });

  it("never splits a surrogate pair when truncating", async () => {
    /**
     * A lone surrogate in a message that is written to a log either round-trips
     * to U+FFFD or throws in a JSON writer. `String#slice` counts UTF-16 code
     * units and will cut one in half.
     */
    const emoji = "\u{1F600}";
    const long = `${"x".repeat(63)}${emoji}${"y".repeat(600)}`;
    const result = await lintMemory({
      "content/DEV/a.md": note({}, `See [[${long}]].\n`),
    });
    const message = of(result, "links")[0]?.message ?? "";
    expect(message).toContain(emoji);
    expect(Buffer.from(message, "utf8").toString("utf8")).toBe(message);
    expect(message).not.toContain("\uFFFD");
  });

  it("bounds the key field on the ordinary unknown-key branch too", async () => {
    /**
     * The heuristic branch was bounded and the branch most notes take was not,
     * so the field meant one thing on one path and another on the other.
     */
    const longKey = "k".repeat(300);
    const result = await lintMemory({
      "content/DEV/a.md": note({ [longKey]: "v" }),
    });
    const info = of(result, "frontmatter").find((f) => f.severity === "info");
    expect(info).toBeDefined();
    expect((info?.key ?? "").length).toBeLessThanOrEqual(65);
  });

  it("bounds the value at every site that interpolates one", async () => {
    /**
     * Six sites call `renderValue`; two were covered, and dropping the call at
     * any of the other four kept the suite green. This walks all of them.
     */
    const long = "z".repeat(600);
    const cases: readonly { files: Record<string, string>; cls: string }[] = [
      {
        files: { "content/DEV/a.md": note({ sources: `[${long}]` }) },
        cls: "provenance",
      },
      {
        files: { "content/DEV/a.md": note({}, `See [[../${long}]].\n`) },
        cls: "links",
      },
      {
        files: { "content/DEV/a.md": note({}, `See [[_raw/${long}]].\n`) },
        cls: "links",
      },
      {
        files: { "content/DEV/a.md": note({}, `See [[${long}]].\n`) },
        cls: "links",
      },
    ];

    for (const { files, cls } of cases) {
      const result = await lintMemory(files);
      const message = of(result, cls)[0]?.message ?? "";
      expect(message).not.toBe("");
      expect(message).toContain("\u2026");
      expect(message).not.toContain("z".repeat(70));
    }
  });

  it("classifies a dotted path segment as excluded but a dotted title as a typo", async () => {
    const dottedPath = await lintMemory({
      "content/DEV/a.md": note({}, "See [[DEV/.env]].\n"),
    });
    expect(of(dottedPath, "links")[0]?.message).toContain("excluded");

    const dottedTitle = await lintMemory({
      "content/DEV/a.md": note({}, "See [[.NET conventions]].\n"),
    });
    expect(of(dottedTitle, "links")[0]?.message).toContain("resolves to no note");

    const bareFolder = await lintMemory({
      "content/DEV/a.md": note({}, "See [[_raw]].\n"),
    });
    expect(of(bareFolder, "links")[0]?.message).toContain("excluded");
  });
});

describe("a finding carries the line a parse failure happened on", () => {
  it("puts a duplicate key's file line on the frontmatter finding", async () => {
    /**
     * The load-bearing half of NEW-3: `LintFinding.line` exists because the CLI
     * renders findings, not issues, and nothing asserted the carry. Setting it
     * to `null` in `frontmatterFindings` left the whole suite green.
     */
    const result = await lintMemory({
      "content/DEV/a.md": [
        "---",
        "schemaVersion: 1",
        "title: a",
        "title: b",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    });
    const malformed = of(result, "frontmatter").find(
      (f) => f.path === "content/DEV/a.md",
    );
    expect(malformed?.severity).toBe("error");
    /** File line of the duplicate, not the offset into the frontmatter slice. */
    expect(malformed?.line).toBe(4);
  });

  it("leaves line null on findings that have no position", async () => {
    const result = await lintMemory({
      "content/DEV/a.md": note({ someUnknownKey: "v" }),
    });
    for (const f of result.findings) expect(f.line).toBeNull();
  });
});

describe("a parse issue's message crossing into a finding", () => {
  it("is screened at the seam, not only at its producer", async () => {
    /**
     * `note.ts` screens the key it interpolates, so today every message
     * arriving here is already clean and removing this screen breaks nothing —
     * which is exactly why it needs its own test. A finding is where foreign
     * text becomes something this process prints; a future producer of a
     * `NoteParseIssue` must not be able to reach a terminal through this branch
     * by forgetting what `note.ts` remembered.
     */
    const request = await lintRequestForFixture("legacy-shape", TODAY, BUILD_CLOCK);
    const built = await buildIndex(buildRequestForFixture("legacy-shape", BUILD_CLOCK));
    const hostile = "harmless\u202E\rsuffix";

    const result = await lintBuild(
      {
        ...built,
        parseIssues: [
          {
            path: "DEV/example.md",
            issues: [
              {
                key: null,
                code: "malformed" as const,
                message: hostile,
                severity: "error" as const,
                line: 2,
              },
            ],
          },
        ],
      },
      request,
    );

    const printed = result.findings.map((finding) => finding.message).join("");
    expect(printed).toContain("harmless suffix");
    expect(printed).not.toContain("\u202E");
    expect(printed).not.toContain("\r");
  });
});

describe("the artifacts a human opens", () => {
  it("carry no character that can reorder or overwrite a line", async () => {
    /**
     * `catalog.md` and `vault-map.md` are written into the user's vault and
     * opened in Obsidian. Escaping Markdown structure is not the same as
     * screening characters, and this renderer had only the first: a title
     * ending in U+202E put a RIGHT-TO-LEFT OVERRIDE straight into the file,
     * reordering the rest of the line for every reader.
     *
     * The paired assertion matters as much: the joined emoji must survive, or
     * the screen is trading one corruption for another.
     */
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const note = [
      "---",
      "schemaVersion: 1",
      `title: "Deploy ${family} keys\u202E"`,
      "type: knowledge-note",
      "created: 2026-08-04",
      "tags: [dev]",
      `summary: "sum\u200Bmary\u0007here"`,
      "stage: emerging",
      "author: agent",
      "reviewed: null",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    /**
     * The path is hostile too, and that is the point. An earlier version of
     * this test made the same universal claim over a fixture living at a clean
     * path, so it passed while the property was false: the link *text* was
     * screened and the *destination* on the same line still carried the raw
     * override. A universal assertion over a non-adversarial input is not a
     * test, and this is the third time that shape got through in this task.
     */
    const built = await buildIndex(
      memoryBuild({ [`content/DEV/ho\u202Estile.md`]: note }),
    );
    const artifacts = writtenArtifacts(built);

    for (const [path, text] of Object.entries(artifacts)) {
      if (!path.endsWith(".md")) continue;
      expect(text, path).not.toContain("\u202E");
      expect(text, path).not.toContain("\u200B");
      expect(text, path).not.toContain("\u0007");
    }

    const catalog = artifacts[PATHS.catalog] ?? "";
    expect(catalog).toContain(family);
    expect(catalog).toContain("Deploy");
  });

  it("emits destinations that round-trip and never collide", async () => {
    /**
     * The contract is resolution, not literal bytes, and it is a *property*
     * rather than a case: decode any destination and get back exactly the path
     * it came from, and no two distinct paths ever produce the same
     * destination. macOS permits any byte but `/` and NUL in a filename, so all
     * of these are paths a note can really live at.
     *
     * Written this way because a single fixture kept passing while the property
     * was false. The first version used one path with no `%` in it — and `%` is
     * the escape character, so `100%.md` produced a destination that throws on
     * decode, `50%20off.md` decoded to a different file, and a path containing
     * a literal `%E2%80%AE` collided with one containing a real U+202E. The
     * exotic inputs worked and the ordinary one did not.
     */
    const names = [
      "plain",
      "100%",
      "50%20off",
      `pre%E2%80%AEencoded`,
      `over\u202Eridden`,
      `zero\u200Bwidth`,
      `line\u2028separator`,
      `para\u2029separator`,
      `bell\u0007`,
      `astral\u{E0067}`,
      `joined\u{1F468}\u200D\u{1F469}`,
      "back\\slash",
      "a<b",
      "a>b",
    ];
    const note = (title: string): string =>
      [
        "---",
        "schemaVersion: 1",
        `title: ${title}`,
        "type: knowledge-note",
        "created: 2026-08-04",
        "tags: [dev]",
        "summary: A summary.",
        "stage: emerging",
        "author: agent",
        "reviewed: null",
        "---",
        "",
        "Body.",
        "",
      ].join("\n");

    const files: Record<string, string> = {};
    for (const [index, name] of names.entries()) {
      files[`content/DEV/${name}.md`] = note(`Note ${String(index)}`);
    }

    const built = await buildIndex(memoryBuild(files));
    const catalog = writtenArtifacts(built)[PATHS.catalog] ?? "";
    /**
     * `linkTarget` emits **two** layers — percent-encoding, then Markdown
     * backslash escaping of `\`, `<` and `>` — so reading it back needs both
     * inverses, in that order, exactly as a CommonMark consumer does — and the
     * extractor forbids a bare `<` inside the destination for the same reason
     * CommonMark does, so a missing escape shows up as a link that does not
     * parse rather than as one this test quietly tolerates. An
     * earlier version of this test applied only `decodeURIComponent`, which
     * meant the escaping layer had no round-trip coverage at all. That
     * asymmetry is how the unencoded `%` survived: half of this function was
     * pinned by a property and half by nothing.
     */
    const destinations = [
      ...catalog.matchAll(/\]\(<((?:\\.|[^<>\\])*)>\)/gu),
    ].map((match) => match[1] ?? "");

    const resolve = (destination: string): string =>
      decodeURIComponent(destination.replace(/\\(.)/gu, "$1"));

    expect(destinations).toHaveLength(names.length);

    /** Every destination leads back to the file it names. */
    for (const destination of destinations) {
      expect(() => resolve(destination), destination).not.toThrow();
      expect(Object.keys(files)).toContain(resolve(destination));
    }

    /** And distinct notes never share one. */
    expect(new Set(destinations).size).toBe(names.length);

    /** And none of them carries a character that reorders the line it sits on. */
    for (const destination of destinations) {
      expect(destination, destination).not.toMatch(
        /(?!\u200D)[\p{Cc}\p{Cf}\u2028\u2029]/u,
      );
    }
  });

  it("leaves a joiner in a destination alone, like everywhere else", async () => {
    /** One exemption, applied in every place that touches vault text. */
    const family = "\u{1F468}\u200D\u{1F469}";
    const note = [
      "---",
      "schemaVersion: 1",
      "title: A joined name",
      "type: knowledge-note",
      "created: 2026-08-04",
      "tags: [dev]",
      "summary: A summary.",
      "stage: emerging",
      "author: agent",
      "reviewed: null",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    const built = await buildIndex(
      memoryBuild({ [`content/DEV/${family}.md`]: note }),
    );
    expect(writtenArtifacts(built)[PATHS.catalog] ?? "").toContain(family);
  });

  it("keeps the machine-readable artifacts faithful to the note", async () => {
    /**
     * The other half of the decision. `index.json` is data, not display: the
     * retrieval layer screens a title on the way out and a consumer needs the
     * bytes the note actually holds. Screening here would make the index
     * disagree with the vault it indexes.
     */
    const note = [
      "---",
      "schemaVersion: 1",
      `title: "Deploy keys\u202E"`,
      "type: knowledge-note",
      "created: 2026-08-04",
      "tags: [dev]",
      "summary: A summary.",
      "stage: emerging",
      "author: agent",
      "reviewed: null",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    const built = await buildIndex(memoryBuild({ "content/DEV/hostile.md": note }));
    expect(writtenArtifacts(built)[PATHS.index] ?? "").toContain("\u202E");
  });
});
