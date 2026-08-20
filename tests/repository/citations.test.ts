import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * **What this gate buys, stated narrowly, because the gap is the interesting part.**
 * It resolves and bounds-checks: a cited file must exist, a bare basename must name
 * exactly one file, and a cited range must lie inside it. **It cannot check that the
 * cited lines mean what the sentence claims.** `threat-model.md` once cited the right
 * file and the wrong function — in bounds, and this gate would pass it forever. A green
 * run here says the citations resolve, never that the evidence is sound; that stays a
 * review question (BACKLOG NEW-23, closed by this file).
 *
 * **Why it exists.** The architecture notes declare their own standard —
 * `knowledge-pipeline.md`'s preamble says "every claim here points at code or at a named
 * test case, `path:line`". 411 citations were maintained by hand and `npm run
 * check` was green with every one of them broken. Eleven lines added to one docblock
 * moved twelve citations in two documents.
 *
 * **The repair method, carried here because the row that held it is deleted and this is
 * the file its reader lands on.** When this gate goes red after a code edit, do **not**
 * compute the shift arithmetically from a diff — that failed three times in one day, once
 * writing a placeholder string into two security-invariant evidence cells. Instead:
 *
 * 1. Map HEAD line → current line by diffing file *contents*, and accept a new address
 *    only when the cited lines are byte-equal to what HEAD held.
 * 2. **Byte-equality proves nothing where the cited content is not unique.** Count
 *    occurrences in HEAD; more than one is ambiguous and needs position or a human. A
 *    length heuristic is the wrong proxy — the live case was a 23-character line of
 *    ordinary code appearing twice in one file and cited at both sites.
 * 3. **Verify forward and unpaired.** A checker that pairs each old citation with its new
 *    counterpart goes blind wherever a group changed size — one citation split in two, a
 *    row added — which is exactly where the editing was heaviest.
 * 4. **Remap last, immediately before staging.** A correct tool run made before the final
 *    edit is indistinguishable from a broken one.
 */

/**
 * **Recorded baselines, per document, replacing a single global floor.** A global total
 * has two faults this repository would have paid for. It is satisfied by whichever
 * document happens to be largest, so `BACKLOG.md` — where every open defect carries its
 * evidence — could drop to zero silently. And it is calibrated against a corpus that
 * *includes a file this plan schedules for deletion*: Task 10 removes the R2 plan and its
 * fifty-one citations, which would have turned a 380 floor red on the commit that
 * correctly closes R2, under a message blaming extraction.
 *
 * Each entry is a floor below the count measured on 2026-08-17 — threat-model 241,
 * knowledge-pipeline 81, BACKLOG 19, ORDER 4, foundation-constraints 4, workflow-schema 4,
 * program plan 11. **A floor detects loss and never staleness upward**: if a document
 * grows and a later change breaks most of its new citations, a floor set against the old
 * count stays green. The measured numbers are written here so that drift is visible to a
 * reader; re-record them when a document grows materially.
 *
 * **Which documents are listed is a measured fact, not the preamble's claim.** The
 * `path:line` standard is declared exactly twice in this repository, by two documents
 * about themselves — `knowledge-pipeline.md` and `threat-model.md`. Four of the eight
 * architecture notes (`brain.md`, `claude-adapter.md`, `codex-adapter.md`,
 * `foundation.md`) contain **no line citation at all**; they cite files without lines.
 * They are absent here because they never adopted the form, not because they lapsed from
 * it — and `EXPECTED_WITHOUT_LINES` below keeps that statement honest instead of leaving
 * it as prose that can quietly go stale.
 */
const BASELINES: ReadonlyMap<string, number> = new Map([
  ["docs/architecture/threat-model.md", 190],
  ["docs/architecture/knowledge-pipeline.md", 70],
  ["docs/architecture/foundation-constraints.md", 3],
  ["docs/architecture/workflow-schema.md", 3],
  ["docs/superpowers/BACKLOG.md", 8],
  /**
   * **Lowered from 2 to 1 on 2026-08-20, when R2 closed.** A floor exists to catch citations
   * being lost silently, and this one caught exactly that — the second citation lived in the
   * "Four Foundation requests" section, which Task 10 removed because all three of R2's are
   * closed. A section that is deleted takes its citations with it, so the floor moves down
   * with it rather than the deletion being worked around.
   */
  ["docs/superpowers/ORDER.md", 1],
  ["docs/superpowers/plans/2026-07-21-developer-os-program.md", 8],
]);

/**
 * **`plans/2026-08-17-repository-defects-r2.md` was unfloored on purpose and is now deleted**,
 * by its own Task 10 — a baseline on a file scheduled for deletion is the moving target this
 * map replaced. The note stays because the *reason* outlives the file: a plan is deleted when
 * it closes, so a floor is worth writing only for the plans that survive their own execution.
 * `specs/…knowledge-pipeline-design.md` carries a single citation, which is below any floor
 * worth writing.
 */

/** Notes that cite files without line numbers. Asserted, so the claim cannot rot. */
const EXPECTED_WITHOUT_LINES = [
  "docs/architecture/brain.md",
  "docs/architecture/claude-adapter.md",
  "docs/architecture/codex-adapter.md",
  "docs/architecture/foundation.md",
] as const;

interface Citation {
  readonly named: string;
  readonly hasDirectory: boolean;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly raw: string;
}

/**
 * A repository-rooted path with any extension, not only `.ts`. Citations name
 * `workflow.yaml` contracts and `BACKLOG.md` sections as often as they name source, and
 * an extractor restricted to TypeScript rendered one whole standard-bearing document
 * invisible while reporting success.
 */
const FULL = /(?:apps|packages|tests|workflows|docs)\/[\w./-]+\.[A-Za-z]+:(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)*)/gu;
/** A backticked filename with no directory. */
const BARE = /`([\w.-]+\.[A-Za-z]+):(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)*)`/gu;
/** A backticked range with no filename, continuing from the previous citation. */
const CONTINUATION = /`:(\d+)(?:-(\d+))?((?:,\d+(?:-\d+)?)*)`/gu;
/**
 * A backticked filename carrying **no** line number. It names a different file than the
 * one being carried, so it **clears** the carrier rather than becoming it.
 *
 * **Fail-safe by choice, and the choice cost real coverage.** A document that writes
 * `` `ingest.ts` `` and then `` `:456-461` `` means line 456 of `ingest.ts`, and treating
 * the mention as a carrier would extract it. But a bare filename in backticks is also how
 * these documents refer to a file in passing — `SESSION.md`, `BACKLOG.md` — and a
 * carrier set from one of those attributes a later range to a file nobody cited. **A
 * wrong attribution is worse than a miss**: it produces a confident green over a citation
 * pointing at the wrong file, which is the exact failure this gate exists to end.
 * Clearing means such a range is skipped, and the document is expected to write the path.
 */
const BARE_MENTION = /`([\w.-]+\.[A-Za-z]+)`/gu;
/** A fence opener or closer. Citations inside a fence are specimens, not evidence. */
const FENCE = /^\s*(?:```|~~~)/u;
/** A heading ends a continuation's reach: a new section is a new context. */
const HEADING = /^\s{0,3}#{1,6}\s/u;

function spans(
  first: string,
  firstEnd: string | undefined,
  tail: string | undefined,
): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [
    [Number(first), firstEnd === undefined ? Number(first) : Number(firstEnd)],
  ];
  for (const extra of (tail ?? "").split(",")) {
    if (extra.length === 0) continue;
    const parts = extra.split("-");
    out.push([Number(parts[0]), Number(parts[parts.length - 1])]);
  }
  return out;
}

/**
 * **A continuation carries across lines, and getting that wrong silently dropped 51 of
 * the 117 real ones.** The documents use markdown tables where the first row names the
 * file and the following eight rows carry only `` `:365` ``, `` `:929` `` and so on — a
 * per-line reset makes an entire evidence table invisible while the sweep reports
 * success. It resets at a **heading**, because a new section is a new context, and at every
 * **fence**, because a carrier that survives a sixty-line code block resolved a range onto
 * the wrong file — in bounds, and green.
 *
 * **A placeholder must not extract**, so a document may describe the forms this gate
 * parses without tripping the gate that parses it: every pattern requires digits, so a
 * non-numeric placeholder matches nothing and no exemption marker has to be remembered.
 */
export function extractCitations(
  text: string,
  /**
   * **Required, deliberately.** As an optional parameter its omission silently disabled
   * the clearing rule — and most callers omit it, so the *never-clear* path would be the
   * one the tests exercised while the sweep was the only caller passing a real set. A
   * refactor that dropped the argument would restore every misattribution with the suite
   * still green.
   */
  knownBasenames: ReadonlySet<string>,
): readonly Citation[] {
  const found: Citation[] = [];
  interface Carrier {
    readonly named: string;
    readonly hasDirectory: boolean;
  }
  let previous: Carrier | null = null;
  let fenced = false;

  for (const [index, line] of text.split("\n").entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      /**
       * **A carrier does not survive a code block.** Without this, a file named before a
       * sixty-line fence still carried seventy lines later into the next paragraph — and
       * did, resolving a range meant for `ingest.ts` onto `capture.ts`, in bounds, green.
       * Every legitimate carry in the architecture notes is eleven lines or fewer and
       * crosses no fence, so this costs them nothing.
       */
      previous = null;
      continue;
    }
    if (fenced) continue;
    if (HEADING.test(line)) {
      previous = null;
      continue;
    }

    const number = index + 1;
    interface Hit {
      readonly at: number;
      readonly named: string | null;
      readonly hasDirectory: boolean;
      readonly raw: string;
      readonly ranges: readonly (readonly [number, number])[];
    }
    const hits: Hit[] = [];

    for (const match of line.matchAll(FULL)) {
      const raw = match[0];
      hits.push({
        at: match.index,
        named: raw.slice(0, raw.indexOf(":")),
        hasDirectory: true,
        raw,
        ranges: spans(match[1] ?? "", match[2], match[3]),
      });
    }
    for (const match of line.matchAll(BARE)) {
      hits.push({
        at: match.index,
        named: match[1] ?? "",
        hasDirectory: false,
        raw: match[0],
        ranges: spans(match[2] ?? "", match[3], match[4]),
      });
    }
    for (const match of line.matchAll(CONTINUATION)) {
      hits.push({
        at: match.index,
        named: null,
        hasDirectory: false,
        raw: match[0],
        ranges: spans(match[1] ?? "", match[2], match[3]),
      });
    }
    for (const match of line.matchAll(BARE_MENTION)) {
      /**
       * **Only a token that names a real file clears.** Unfiltered, this pattern fires
       * 794 times across these documents and 343 of those name nothing in the repository
       * — `agent.prompt`, `turn.failed`, `capture.setStatus`, `JSON.stringify`, `it.each`.
       * Clearing on those cost three live citations in `threat-model.md`'s Credentials
       * row, where `it.each` sits between a file and the ranges that belong to it.
       */
      /**
       * **A latent hole, recorded rather than closed.** The set is `git ls-files`, so a
       * generated artifact the product writes — `config.toml`, `index.json`,
       * `installation-manifest.json`, `catalog.md`, `graph.json` — is not in it and does
       * not clear. No document places one before a continuation today, and every live
       * carry was traced. If one ever does, union those names in here.
       */
      if (!knownBasenames.has(match[1] ?? "")) continue;
      hits.push({
        at: match.index,
        named: null,
        hasDirectory: false,
        raw: match[0],
        ranges: [],
      });
    }

    hits.sort((a, b) => a.at - b.at);

    for (const hit of hits) {
      /** A file named without a line clears the carrier; see `BARE_MENTION`. */
      if (hit.named === null && hit.ranges.length === 0) {
        previous = null;
        continue;
      }
      const carrier: Carrier | null =
        hit.named === null
          ? previous
          : { named: hit.named, hasDirectory: hit.hasDirectory };
      /** A continuation with nothing to continue from is prose, not a citation. */
      if (carrier === null) continue;
      if (hit.named !== null) previous = carrier;

      for (const [start, end] of hit.ranges) {
        found.push({
          named: carrier.named,
          hasDirectory: carrier.hasDirectory,
          start,
          end,
          line: number,
          raw: hit.raw,
        });
      }
    }
  }

  return found;
}

export type Resolution =
  | { readonly kind: "resolved"; readonly path: string }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

/**
 * **Fail-closed on an ambiguous basename, which is the point rather than a limitation.**
 * Eight of nineteen bare basenames cited here name more than one file: `types.ts` matches
 * five, and `invoke.ts` matches two — one per vendor adapter — so a guess sends a reader
 * to the wrong vendor's code. Refusing makes the author write the directory.
 */
export function resolveSource(
  citation: Citation,
  files: readonly string[],
): Resolution {
  if (citation.hasDirectory) {
    return files.includes(citation.named)
      ? { kind: "resolved", path: citation.named }
      : { kind: "missing" };
  }
  const candidates = files.filter((file) => basename(file) === citation.named);
  if (candidates.length === 0) return { kind: "missing" };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "resolved", path: candidates[0] ?? "" };
}

/**
 * **Extracted so it can be tested, because the sweep passing proves nothing about it.**
 * Of the three refusal classes this gate implements, `missing` and `ambiguous` fire on
 * real data; bounds does not, and an untested predicate inlined in a green sweep is a
 * check nothing in the repository demonstrates works.
 *
 * `lineCount` counts **lines**, not `split("\n")` segments: a file ending in a newline
 * yields one empty trailing segment, and counting it let a citation one past the end pass.
 */
export function outOfRange(
  citation: Pick<Citation, "start" | "end">,
  lineCount: number,
): boolean {
  return citation.start < 1 || citation.start > citation.end || citation.end > lineCount;
}

export function lineCount(contents: string): number {
  if (contents.length === 0) return 0;
  return contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);
}

async function repository(): Promise<{
  readonly root: string;
  readonly files: readonly string[];
  readonly docs: readonly string[];
}> {
  const { stdout: top } = await runProcess("git", ["rev-parse", "--show-toplevel"]);
  const root = top.trim();
  const { stdout } = await runProcess("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const all = stdout.split("\0").filter((path) => path.length > 0);
  return {
    root,
    files: all,
    docs: all.filter((path) => path.startsWith("docs/") && path.endsWith(".md")),
  };
}

describe("every documented citation resolves", () => {
  it("resolves and bounds-checks every citation in every document", async () => {
    const { root, files, docs } = await repository();
    const lengths = new Map<string, number>();
    const perDocument = new Map<string, number>();
    const broken: string[] = [];

    const knownBasenames = new Set(files.map((file) => basename(file)));
    for (const doc of docs) {
      const citations = extractCitations(
        await readFile(join(root, doc), "utf8"),
        knownBasenames,
      );
      perDocument.set(doc, citations.length);
      for (const citation of citations) {
        const where = `${doc}:${String(citation.line)} ${citation.raw}`;
        const resolution = resolveSource(citation, files);

        if (resolution.kind === "missing") {
          broken.push(`${where} names no file in the repository`);
          continue;
        }
        if (resolution.kind === "ambiguous") {
          broken.push(
            `${where} names ${String(resolution.candidates.length)} files — write the directory: ${resolution.candidates.join(", ")}`,
          );
          continue;
        }

        let length = lengths.get(resolution.path);
        if (length === undefined) {
          length = lineCount(await readFile(join(root, resolution.path), "utf8"));
          lengths.set(resolution.path, length);
        }
        if (outOfRange(citation, length)) {
          broken.push(
            `${where} is out of range: ${resolution.path} has ${String(length)} lines`,
          );
        }
      }
    }

    /**
     * **Per document, and each against its own recorded baseline.** A gate that sweeps a
     * set must assert the set is non-empty per scope, not in total — this repository has
     * shipped two checks that could pass over nothing, the self-containment enumerator
     * which skipped every path containing `#` and exited 0, and the network-capability
     * scan which never noticed a whole package was missing from its list.
     */
    for (const [doc, floor] of BASELINES) {
      expect(
        perDocument.get(doc) ?? 0,
        `${doc} carries fewer citations than its recorded baseline`,
      ).toBeGreaterThanOrEqual(floor);
    }

    /**
     * The other half of the same claim: these four are listed as citing files without
     * lines, and that statement is asserted rather than trusted. If one gains a
     * `path:line` citation it belongs in `BASELINES` and this goes red to say so.
     */
    for (const doc of EXPECTED_WITHOUT_LINES) {
      /**
       * Existence first. `perDocument.get(doc) ?? 0` is `0` for a document that was never
       * enumerated, so without this the assertion whose job is to keep a claim honest
       * passes green over a file that has been renamed or deleted — while the renamed
       * file goes unfloored. `BASELINES` does not have this hole; this closes the
       * asymmetry.
       */
      expect(perDocument.has(doc), `${doc} is no longer in docs/`).toBe(true);
      expect(
        perDocument.get(doc) ?? 0,
        `${doc} now carries citations and needs a baseline`,
      ).toBe(0);
    }

    expect(broken).toStrictEqual([]);
  });
});

/**
 * The sweep above passes because the citations resolve, which means it would also pass if
 * the extractor found nothing and the bounds predicate were inverted. These cases are
 * what make it evidence — the discipline `control-bytes.test.ts` applies to its own
 * pattern, applied here.
 */
describe("the extractor and the predicate this gate is built on", () => {
  const files = [
    "apps/cli/src/commands/ingest.ts",
    "packages/adapter-claude/src/invoke.ts",
    "packages/adapter-codex/src/invoke.ts",
    "packages/core/src/config/types.ts",
    "packages/platform-macos/src/types.ts",
    "workflows/capture/workflow.yaml",
  ];
  /**
   * Clearing is not what these cases are about, and an empty set says so at the call site
   * rather than leaving a reader to wonder whether the omission was deliberate.
   */
  const NO_KNOWN_FILES: ReadonlySet<string> = new Set();
  const first = (text: string): Citation => {
    const [citation] = extractCitations(text, NO_KNOWN_FILES);
    expect(citation, `nothing extracted from ${text}`).toBeDefined();
    return citation as Citation;
  };

  it("finds a full path citation with a range", () => {
    expect(extractCitations("see `packages/adapter-codex/src/invoke.ts:136-143` here", NO_KNOWN_FILES)).toMatchObject(
      [{ named: "packages/adapter-codex/src/invoke.ts", start: 136, end: 143 }],
    );
  });

  it("finds a citation into a file that is not TypeScript", () => {
    expect(first("`workflows/capture/workflow.yaml:5-6`")).toMatchObject({
      named: "workflows/capture/workflow.yaml",
      start: 5,
      end: 6,
    });
  });

  it("expands a comma list into one citation per span", () => {
    expect(extractCitations("`apps/cli/src/commands/ingest.ts:531,814,1095-1099`", NO_KNOWN_FILES)).toMatchObject(
      [
        { start: 531, end: 531 },
        { start: 814, end: 814 },
        { start: 1095, end: 1099 },
      ],
    );
  });

  /**
   * The case that made the first version of this gate decoration: a nine-row evidence
   * table names its file once and continues for eight more lines. A per-line reset made
   * all eight invisible while the sweep reported success.
   */
  it("carries a continuation across lines, which is how the evidence tables are written", () => {
    const found = extractCitations(
      [
        "| a | `packages/adapter-codex/src/invoke.ts:337` | refuses |",
        "| b | `:365` | refuses |",
        "| c | `:407` | refuses |",
      ].join("\n"),
      NO_KNOWN_FILES,
    );
    expect(found).toHaveLength(3);
    expect(found.map((c) => c.named)).toStrictEqual([
      "packages/adapter-codex/src/invoke.ts",
      "packages/adapter-codex/src/invoke.ts",
      "packages/adapter-codex/src/invoke.ts",
    ]);
  });

  it("stops carrying at a heading, because a new section is a new context", () => {
    expect(
      extractCitations(
        ["`apps/cli/src/commands/ingest.ts:245`", "", "## Next", "", "`:999`"].join("\n"),
        NO_KNOWN_FILES,
      ),
    ).toHaveLength(1);
  });

  it("continues from a bare basename, not only from a full path", () => {
    const found = extractCitations(
      "`apps/cli/src/commands/ingest.ts:245`; `types.ts:531`, `:814`",
      NO_KNOWN_FILES,
    );
    expect(found).toHaveLength(3);
    expect(found[2]).toMatchObject({ named: "types.ts", hasDirectory: false, start: 814 });
  });

  it("ignores a continuation with nothing to continue from, because that is prose", () => {
    expect(extractCitations("the ladder is at `:1020-1033`", NO_KNOWN_FILES)).toStrictEqual([]);
  });

  /**
   * NEW-23 required this before the gate shipped: the document specifying a parser must
   * not contain strings that parser accepts. The Task 1b section of the R2 plan shows
   * every form inside fences, and without this the gate bounds-checks its own examples.
   */
  it("does not extract from a fenced block, because a specimen is not evidence", () => {
    expect(
      extractCitations(
        ["```ts", "`packages/core/src/config/types.ts:99999`", "```"].join("\n"),
        NO_KNOWN_FILES,
      ),
    ).toStrictEqual([]);
  });

  it("does not extract a placeholder, so a document may describe the form it specifies", () => {
    expect(extractCitations("a basename looks like `types.ts:<line>`", NO_KNOWN_FILES)).toStrictEqual([]);
    expect(extractCitations("a continuation looks like `:<start>-<end>`", NO_KNOWN_FILES)).toStrictEqual([]);
  });

  it("extracts a basename containing more than one dot", () => {
    expect(first("`validate.test.ts:817`")).toMatchObject({
      named: "validate.test.ts",
      hasDirectory: false,
      start: 817,
    });
  });

  /**
   * A carrier must not survive a code block. Without this a file named before a fence
   * carried seventy lines past it and resolved a later range onto the wrong file — in
   * bounds, so the sweep stayed green.
   */
  it("stops carrying across a fenced block", () => {
    expect(
      extractCitations(
        [
          "`apps/cli/src/commands/ingest.ts:245`",
          "```ts",
          "const x = 1;",
          "```",
          "and then `:459`",
        ].join("\n"),
        NO_KNOWN_FILES,
      ),
    ).toHaveLength(1);
  });

  /**
   * The clearing rule, which had no test when it shipped: deleting the whole
   * `BARE_MENTION` loop left every case green.
   */
  it("clears the carrier on a mention that names a real file", () => {
    const known = new Set(["ingest.ts", "capture.ts"]);
    expect(
      extractCitations("`apps/cli/src/commands/ingest.ts:245`; see `capture.ts` then `:459`", known),
    ).toHaveLength(1);
  });

  it("does not clear on a dotted token that names no file, which is most of them", () => {
    const known = new Set(["ingest.ts"]);
    const found = extractCitations(
      "`apps/cli/src/commands/ingest.ts:245`; `it.each` covers `:459`",
      known,
    );
    expect(found).toHaveLength(2);
    expect(found[1]).toMatchObject({ named: "apps/cli/src/commands/ingest.ts", start: 459 });
  });

  it("treats an empty file as having no lines a citation can name", () => {
    expect(lineCount("")).toBe(0);
    expect(outOfRange({ start: 1, end: 1 }, lineCount(""))).toBe(true);
  });

  it("refuses a bare basename that names more than one file", () => {
    expect(resolveSource(first("`types.ts:87`"), files)).toMatchObject({
      kind: "ambiguous",
      candidates: [
        "packages/core/src/config/types.ts",
        "packages/platform-macos/src/types.ts",
      ],
    });
  });

  it("accepts a bare basename that names exactly one file", () => {
    expect(resolveSource(first("`ingest.ts:531`"), files)).toStrictEqual({
      kind: "resolved",
      path: "apps/cli/src/commands/ingest.ts",
    });
  });

  it("reports a path that names no file at all", () => {
    expect(resolveSource(first("`packages/security/src/gone.ts:12`"), files)).toStrictEqual({
      kind: "missing",
    });
  });

  /**
   * The predicate the whole gate exists for, and the one that never fires on a clean
   * tree. Without these the sweep is green whether or not it can refuse anything.
   */
  it("refuses a range past the end of the file", () => {
    expect(outOfRange({ start: 10, end: 261 }, 260)).toBe(true);
    expect(outOfRange({ start: 261, end: 261 }, 260)).toBe(true);
  });

  it("accepts a range that ends exactly on the last line", () => {
    expect(outOfRange({ start: 1, end: 260 }, 260)).toBe(false);
  });

  it("refuses a line number below one, and an inverted range", () => {
    expect(outOfRange({ start: 0, end: 5 }, 260)).toBe(true);
    expect(outOfRange({ start: 9, end: 4 }, 260)).toBe(true);
  });

  /**
   * A file ending in a newline splits into one more segment than it has lines. Counting
   * the empty tail let a citation one past the end resolve as in bounds.
   */
  it("counts lines, not split segments, for a file ending in a newline", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
    expect(outOfRange({ start: 3, end: 3 }, lineCount("a\nb\n"))).toBe(true);
  });
});
