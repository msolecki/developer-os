import { hashBytes } from "@developer-os/core";
import type { BrainConfigV1 } from "@developer-os/core";

import {
  compareCanonical,
  compareRawBytes,
  discoverNotes,
} from "../discovery/index.js";
import type { DirectoryReader, DiscoveredNote } from "../discovery/index.js";
import { parseNote } from "../schema/note.js";
import type {
  NoteAuthor,
  NoteParseIssue,
  NoteStage,
  NoteType,
} from "../schema/note.js";
import { tokenize } from "./tokenize.js";

export interface IndexedTerm {
  readonly term: string;
  readonly count: number;
}

export interface IndexedNote {
  readonly path: string;
  readonly title: string;
  readonly type: NoteType;
  readonly topicFolder: string;
  /**
   * Deduplicated, in the author's order. Author order is content-derived and
   * therefore deterministic, which is the property spec §6.1(2) actually needs,
   * and it preserves the sequence the user chose to see their tags in. The
   * duplicates go because a note listing `dev` twice would otherwise count
   * twice in every rollup and score twice in retrieval.
   */
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly stage: NoteStage;
  readonly author: NoteAuthor;
  readonly reviewed: string | null;
  readonly occurrences: number;
  readonly created: string;
  readonly updated: string | null;
  /** Carried so lint can check each entry resolves; spec §7 `provenance`. */
  readonly sources: readonly string[];
  readonly contentHash: string;
  readonly terms: readonly IndexedTerm[];
}

export interface IndexedFolderType {
  readonly type: NoteType;
  readonly count: number;
}

export interface IndexedFolder {
  readonly name: string;
  readonly noteCount: number;
  readonly types: readonly IndexedFolderType[];
  readonly topTags: readonly string[];
}

export interface IndexedTag {
  readonly tag: string;
  readonly count: number;
  readonly paths: readonly string[];
}

export interface IndexDocumentV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly contentRoot: string;
  readonly notes: readonly IndexedNote[];
  readonly folders: readonly IndexedFolder[];
  readonly tags: readonly IndexedTag[];
}

export interface GraphNode {
  readonly path: string;
  readonly title: string;
  readonly topicFolder: string;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly text: string;
}

export interface GraphDocumentV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface UnresolvedLink {
  readonly source: string;
  readonly text: string;
}

/**
 * A link text that matched more than one note within one tier. Resolution still
 * takes the lowest path so the graph stays deterministic, but the user is told,
 * because none of spec §7's three `duplicates` findings covers this case: two
 * notes with different titles, different content hashes and no case-insensitive
 * path collision can still share a basename, and then a link points silently at
 * the wrong one.
 */
export interface AmbiguousLink {
  readonly source: string;
  readonly text: string;
  readonly chosen: string;
  readonly candidates: readonly string[];
}

export interface NoteIssues {
  readonly path: string;
  readonly issues: readonly NoteParseIssue[];
}

export interface IndexBuildResult {
  readonly index: IndexDocumentV1;
  readonly graph: GraphDocumentV1;
  readonly unresolvedLinks: readonly UnresolvedLink[];
  readonly ambiguousLinks: readonly AmbiguousLink[];
  /**
   * Every note that produced an issue, whether or not it parsed. A note that
   * failed carries at least one `error`; a note that parsed carries only
   * `info`, which is where `unknown-key` lives — and spec §7 requires that as a
   * `frontmatter` finding, so dropping the success branch would leave the class
   * unimplementable. Membership in `index.notes` distinguishes the two.
   */
  readonly parseIssues: readonly NoteIssues[];
  readonly unclassifiedFolders: readonly string[];
  readonly symlinkedFolders: readonly string[];
}

export interface IndexBuildRequest {
  /** Absolute — `discoverNotes` canonicalizes it and refuses a relative path. */
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly readFile: (path: string) => Promise<string>;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly now: () => string;
  /** Forwarded to discovery, so a wholly in-memory build touches no real path. */
  readonly canonicalize?: (path: string) => Promise<string>;
  /** Defaults to `MAX_FRONTMATTER_CHARS`. */
  readonly maxFrontmatterChars?: number;
}

/**
 * The bound that keeps `brain reindex` from hanging on a hostile note.
 *
 * `yaml` parsing is quadratic in mapping size: 14 ms at 1,000 frontmatter keys,
 * 1.2 s at 16,000, and no completion inside two minutes for a 700 KB block —
 * while the fence scan over the same input stays under 3 ms. Discovery walks
 * arbitrary user files, so without a bound one note stalls the whole command
 * with no output naming the file responsible.
 *
 * Counted in UTF-16 code units rather than bytes, and that is the safer of the
 * two. The cost is quadratic in the number of *mapping entries*, and an entry
 * costs at least five code units in any script, so bounding code units bounds
 * the key count regardless of language; bounding bytes would let a Latin-script
 * vault carry twice the keys of a Greek one under the same limit.
 */
export const MAX_FRONTMATTER_CHARS = 64 * 1024;

const OPENING_FENCE = /^\uFEFF?---[ \t]*\r?\n/u;
/**
 * The leading alternation is load-bearing. Requiring a newline before the
 * closing fence misses the empty block — `---\n---\n` — whose closing fence
 * sits at offset 0 of the searched slice, and `note.ts` deliberately accepts
 * that form. Without the `^` branch an empty frontmatter above a large body is
 * reported as oversized, telling the user to shrink a block of zero length.
 */
const CLOSING_FENCE = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/u;

/**
 * Measures the frontmatter *extent* without parsing it, so the decision to
 * parse is cheap. Deliberately not the parser's own regular expression: this
 * needs only to find where the block ends, and reusing the parser's tolerances
 * would invite someone to keep the two in sync for no benefit.
 *
 * Conservative in the one direction that matters. A note whose remainder is
 * already shorter than the bound cannot exceed it, so an unterminated but short
 * frontmatter is reported as malformed by the parser rather than misreported as
 * oversized here.
 */
export function frontmatterExceeds(source: string, maxChars: number): boolean {
  const opening = OPENING_FENCE.exec(source);
  if (opening === null) return false;

  const start = opening[0].length;
  if (source.length - start <= maxChars) return false;

  return CLOSING_FENCE.exec(source.slice(start, start + maxChars)) === null;
}

/**
 * Fenced blocks and inline spans are removed before links are extracted. A note
 * that documents wikilink syntax — a conventions note, a template guide, this
 * product's own template — would otherwise emit an unresolved link for every
 * example, and spec §7 makes that an `error` that fails `brain lint`.
 */
/**
 * The consequence to know about: an *unterminated* fence runs to end of input,
 * which is CommonMark-correct and is what `|$` encodes — so a stray triple
 * backtick deletes every link below it from the graph, with no finding. Spec
 * §6.4 says a graph with dangling half-edges is uncomputable; one silently
 * missing real edges is equally so, and this direction produces no signal at
 * all. Accepted because the alternative is a Markdown parser, but not silent.
 *
 * No `m` flag, deliberately. Under `m` the closing alternative's `$` matches
 * the end of *any* line, so the lazy body matches nothing and the block's
 * contents survive the strip — the bug this comment replaces. Without `m`, `$`
 * is end-of-input, which is the intended "unterminated fence runs to EOF".
 */
const FENCED_CODE =
  /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[^\n]*(?=\n|$)|$)/gu;
const INLINE_CODE = /`[^`\n]*`/gu;

/** `[` is excluded from the text, so `[[outer [[inner]]` cannot capture junk. */
const WIKILINK = /\[\[([^\]|#[]+)(?:[^\]]*)\]\]/gu;

export function extractLinks(body: string): readonly string[] {
  const prose = body.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
  return [...prose.matchAll(WIKILINK)]
    .map((match) => (match[1] ?? "").trim())
    .filter((text) => text.length > 0);
}

interface ParsedEntry {
  readonly note: IndexedNote;
  /**
   * Carried from the parse that produced `note`, not re-derived. `parseNote`
   * returns issues on its success branch too — that is where `unknown-key`
   * lives — and calling it a second time to collect them doubled the cost of
   * the one input `MAX_FRONTMATTER_CHARS` exists to bound: measured 216 ms for
   * a single parse of the largest accepted frontmatter, 435 ms for the build.
   */
  readonly issues: readonly NoteParseIssue[];
  /** Kept only until links are extracted; `IndexedNote` stores no note text. */
  readonly body: string;
  /**
   * The tie-break that makes the note order total. `IndexedNote.path` is
   * already NFC-folded by discovery, so two files whose names differ only in
   * normalization carry the *same* path string and no comparison over paths can
   * separate them. The unnormalized absolute path is the only field that can.
   */
  readonly absolutePath: string;
}

function compareEntries(a: ParsedEntry, b: ParsedEntry): number {
  return (
    compareCanonical(a.note.path, b.note.path) ||
    compareRawBytes(a.absolutePath, b.absolutePath)
  );
}

function countTerms(body: string): readonly IndexedTerm[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(body)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  /**
   * An array, not a record. An object's key order is an implementation detail
   * of whatever built it; an explicitly sorted array cannot drift, and this is
   * the one field that would otherwise leak insertion order into the bytes.
   */
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => compareCanonical(a.term, b.term));
}

function pushLookup(
  lookup: Map<string, IndexedNote[]>,
  key: string,
  note: IndexedNote,
): void {
  const existing = lookup.get(key);
  if (existing === undefined) lookup.set(key, [note]);
  else existing.push(note);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

function withoutExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -".md".length) : path;
}

/**
 * Five tiers, tried in order. The first three address one note by location; the
 * last two are human labels that notes may legitimately share.
 *
 * The `byBasename` tier exists because it is what Obsidian actually writes.
 * "Shortest path when possible" is its stock setting, so a vault authored there
 * contains `[[caching]]`, not `[[DEV/caching]]`. Without the tier every such
 * link is an unresolved-link `error` under spec §7 and `brain lint` fails on
 * exactly the vaults this product claims to support.
 */
interface LinkTier {
  readonly exact: Map<string, IndexedNote[]>;
  readonly folded: Map<string, IndexedNote[]>;
}

type Lookups = readonly LinkTier[];

/**
 * Case folding for the *fallback* pass only. Obsidian's resolver is
 * case-insensitive on macOS and Windows, so `[[Caching]]` opens `caching.md` in
 * the editor; without this, that link is a spec §7 `links` error and `brain
 * lint` fails on a vault that works. It is the same defect as a missing
 * bare-basename tier, at lower frequency.
 *
 * Not `foldPath` from core: that resolves against `cwd` first, which is right
 * for filesystem paths and wrong for a title or an alias.
 */
function fold(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function pushKey(tier: LinkTier, key: string, note: IndexedNote): void {
  pushLookup(tier.exact, key, note);
  pushLookup(tier.folded, fold(key), note);
}

function emptyTier(): LinkTier {
  return { exact: new Map(), folded: new Map() };
}

/**
 * Five tiers, tried in order, then the same five again folded. The first three
 * address one note by location; the last two are human labels that notes may
 * legitimately share. Exact always beats folded, so case-sensitive intent is
 * never overridden by a case-insensitive coincidence.
 *
 * The basename tier exists because it is what Obsidian actually writes:
 * "shortest path when possible" is its stock setting, so a vault authored there
 * contains `[[caching]]`, not `[[DEV/caching]]`. Without it every such link is
 * an unresolved-link `error` and `brain lint` fails on exactly the vaults this
 * product claims to support.
 */
function buildLookups(
  notes: readonly IndexedNote[],
  contentRoot: string,
): Lookups {
  const byPath = emptyTier();
  const bySuffix = emptyTier();
  const byBasename = emptyTier();
  const byTitle = emptyTier();
  const byAlias = emptyTier();

  const prefix = `${contentRoot}/`;
  for (const note of notes) {
    const relative = note.path.startsWith(prefix)
      ? note.path.slice(prefix.length)
      : note.path;

    /**
     * Four spellings of one address: with and without `contentRoot`, with and
     * without the extension. `DEV/sub/deep` has to resolve as surely as
     * `content/DEV/sub/deep.md` does, or a link into a nested folder is
     * unresolvable by any spelling a human would write.
     */
    for (const key of [
      note.path,
      withoutExtension(note.path),
      relative,
      withoutExtension(relative),
    ]) {
      pushKey(byPath, key, note);
    }

    pushKey(bySuffix, `${note.topicFolder}/${basename(note.path)}`, note);
    pushKey(byBasename, basename(note.path), note);
    pushKey(byTitle, note.title, note);
    for (const alias of note.aliases) pushKey(byAlias, alias, note);
  }

  return [byPath, bySuffix, byBasename, byTitle, byAlias];
}

interface Resolution {
  readonly note: IndexedNote;
  readonly candidates: readonly IndexedNote[];
}

function pick(candidates: readonly IndexedNote[] | undefined): Resolution | null {
  if (candidates === undefined) return null;
  /**
   * Deduplicated by identity: one note registers four spellings in the path
   * tier, and two of them can fold together, which would otherwise report the
   * note as ambiguous with itself.
   */
  const unique = [...new Set(candidates)];
  const chosen = unique[0];
  if (chosen === undefined) return null;
  /**
   * Lowest path wins, so the graph is deterministic. `unique` derives from
   * iterating `notes`, which is already totally ordered, so the first element
   * *is* the lowest. The caller reports any ambiguity rather than letting a
   * possibly-wrong target pass unmentioned.
   */
  return { note: chosen, candidates: unique };
}

function resolveLink(text: string, lookups: Lookups): Resolution | null {
  for (const tier of lookups) {
    const hit = pick(tier.exact.get(text));
    if (hit !== null) return hit;
  }

  const foldedText = fold(text);
  for (const tier of lookups) {
    const hit = pick(tier.folded.get(foldedText));
    if (hit !== null) return hit;
  }

  return null;
}

type EntryResult =
  | { readonly ok: true; readonly entry: ParsedEntry }
  | { readonly ok: false; readonly issues: readonly NoteParseIssue[] };

function toEntry(discovered: DiscoveredNote, source: string): EntryResult {
  const parsed = parseNote(source);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const front = parsed.note.frontmatter;
  const note: IndexedNote = {
    path: discovered.vaultPath,
    title: front.title,
    type: front.type,
    topicFolder: discovered.topicFolder,
    tags: [...new Set(front.tags)],
    /** Absent optionals become empty or null: `undefined` cannot be serialized. */
    aliases: front.aliases === undefined ? [] : [...new Set(front.aliases)],
    summary: front.summary,
    stage: front.stage,
    author: front.author,
    reviewed: front.reviewed,
    occurrences: front.occurrences ?? 0,
    created: front.created,
    updated: front.updated ?? null,
    sources: front.sources === undefined ? [] : [...new Set(front.sources)],
    /**
     * Hashed over the re-encoded string rather than the bytes on disk, because
     * `readFile` is injected and hands back text.
     *
     * The limitation that accepts: `readFile(path, "utf8")` maps every invalid
     * byte sequence to U+FFFD, so two notes differing only inside invalid UTF-8
     * hash identically and spec §7's `duplicates` class calls them one note.
     * Obsidian writes UTF-8, so the trigger is an imported Latin-1 file. Fixing
     * it properly means `readFile` returning bytes, which changes a contract
     * Tasks 8 and 9 are written against — recorded here rather than done.
     */
    contentHash: hashBytes(Buffer.from(source, "utf8")),
    terms: countTerms(parsed.note.body),
  };

  return {
    ok: true,
    entry: {
      note,
      issues: parsed.issues,
      body: parsed.note.body,
      absolutePath: discovered.absolutePath,
    },
  };
}

/** A rendering aid, not a retrieval input; retrieval reads `tags` directly. */
export const TOP_TAGS_PER_FOLDER = 5;

function rollUpFolders(
  notes: readonly IndexedNote[],
  config: BrainConfigV1,
): readonly IndexedFolder[] {
  const byFolder = new Map<string, IndexedNote[]>();
  for (const note of notes) {
    const existing = byFolder.get(note.topicFolder);
    if (existing === undefined) byFolder.set(note.topicFolder, [note]);
    else existing.push(note);
  }

  const folders = [...byFolder.entries()].map(([name, members]) => {
    const typeCounts = new Map<NoteType, number>();
    const tagCounts = new Map<string, number>();
    for (const note of members) {
      typeCounts.set(note.type, (typeCounts.get(note.type) ?? 0) + 1);
      for (const tag of note.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return {
      name,
      noteCount: members.length,
      types: [...typeCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => compareCanonical(a.type, b.type)),
      topTags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || compareCanonical(a[0], b[0]))
        .slice(0, TOP_TAGS_PER_FOLDER)
        .map(([tag]) => tag),
    };
  });

  /**
   * Configured order, then name. `topicFolders` defaults to PROJECTS, TOOLS,
   * DEV, INFRA, QA — deliberately not alphabetical, because it is the order the
   * user chose to see their vault in. A folder outside the configured list
   * cannot normally occur (alias resolution maps onto configured names), but
   * sorting it last by name keeps the order total if one ever does.
   */
  return folders.sort((a, b) => {
    const left = config.topicFolders.indexOf(a.name);
    const right = config.topicFolders.indexOf(b.name);
    if (left !== right) {
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    }
    return compareCanonical(a.name, b.name);
  });
}

function rollUpTags(notes: readonly IndexedNote[]): readonly IndexedTag[] {
  const byTag = new Map<string, string[]>();
  for (const note of notes) {
    for (const tag of note.tags) {
      const existing = byTag.get(tag);
      if (existing === undefined) byTag.set(tag, [note.path]);
      else existing.push(note.path);
    }
  }

  return [...byTag.entries()]
    .map(([tag, paths]) => ({
      tag,
      count: paths.length,
      paths: [...paths].sort(compareCanonical),
    }))
    .sort((a, b) => compareCanonical(a.tag, b.tag));
}

export async function buildIndex(
  request: IndexBuildRequest,
): Promise<IndexBuildResult> {
  const maxFrontmatterChars =
    request.maxFrontmatterChars ?? MAX_FRONTMATTER_CHARS;
  const contentRoot = request.config.contentRoot.normalize("NFC");

  const discovery = await discoverNotes({
    vaultRoot: request.vaultRoot,
    config: request.config,
    reader: request.reader,
    assertReadable: request.assertReadable,
    ...(request.canonicalize === undefined
      ? {}
      : { canonicalize: request.canonicalize }),
  });

  const entries: ParsedEntry[] = [];
  const parseIssues: NoteIssues[] = [];

  for (const discovered of discovery.notes) {
    const source = await request.readFile(discovered.absolutePath);

    if (frontmatterExceeds(source, maxFrontmatterChars)) {
      /**
       * Reported through the ordinary parse-issue channel, so it reaches the
       * `frontmatter` lint class with every other malformed-note finding rather
       * than needing a seventh class nobody wired up.
       */
      parseIssues.push({
        path: discovered.vaultPath,
        issues: [
          {
            key: null,
            code: "length",
            message: `the frontmatter block exceeds ${String(maxFrontmatterChars)} characters and was not parsed`,
            severity: "error",
          },
        ],
      });
      continue;
    }

    const result = toEntry(discovered, source);
    if (!result.ok) {
      parseIssues.push({ path: discovered.vaultPath, issues: result.issues });
      continue;
    }

    /**
     * A note can parse *and* carry issues — every `unknown-key` finding lives
     * on the success branch. Dropping them would make spec §7's `info` row and
     * Task 6's unterminated-frontmatter heuristic unreachable.
     */
    if (result.entry.issues.length > 0) {
      parseIssues.push({
        path: discovered.vaultPath,
        issues: result.entry.issues,
      });
    }

    entries.push(result.entry);
  }

  entries.sort(compareEntries);
  const notes = entries.map((entry) => entry.note);

  const lookups = buildLookups(notes, contentRoot);
  const edges: GraphEdge[] = [];
  const unresolvedLinks: UnresolvedLink[] = [];
  const ambiguousLinks: AmbiguousLink[] = [];
  const seenEdges = new Set<string>();

  for (const { note, body } of entries) {
    for (const text of extractLinks(body)) {
      const resolved = resolveLink(text, lookups);
      if (resolved === null) {
        unresolvedLinks.push({ source: note.path, text });
        continue;
      }

      if (resolved.candidates.length > 1) {
        ambiguousLinks.push({
          source: note.path,
          text,
          chosen: resolved.note.path,
          candidates: resolved.candidates.map((candidate) => candidate.path),
        });
      }

      /** A note linking twice to one target is one edge; edges are a set. */
      const key = `${note.path} ${resolved.note.path} ${text}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ source: note.path, target: resolved.note.path, text });
    }
  }

  const generatedAt = request.now();

  return {
    index: {
      schemaVersion: 1,
      generatedAt,
      contentRoot,
      notes,
      folders: rollUpFolders(notes, request.config),
      tags: rollUpTags(notes),
    },
    graph: {
      schemaVersion: 1,
      generatedAt,
      nodes: notes.map((note) => ({
        path: note.path,
        title: note.title,
        topicFolder: note.topicFolder,
      })),
      edges: edges.sort(
        (a, b) =>
          compareCanonical(a.source, b.source) ||
          compareCanonical(a.target, b.target) ||
          compareCanonical(a.text, b.text),
      ),
    },
    unresolvedLinks: unresolvedLinks.sort(
      (a, b) =>
        compareCanonical(a.source, b.source) || compareCanonical(a.text, b.text),
    ),
    ambiguousLinks: ambiguousLinks.sort(
      (a, b) =>
        compareCanonical(a.source, b.source) || compareCanonical(a.text, b.text),
    ),
    parseIssues: parseIssues.sort((a, b) => compareCanonical(a.path, b.path)),
    unclassifiedFolders: discovery.unclassifiedFolders,
    symlinkedFolders: discovery.symlinkedFolders,
  };
}
