import { compareCanonical } from "../discovery/index.js";
import { capGraphemes, screenControlCharacters } from "../redact.js";
import { tokenize } from "../indexes/index.js";
import type { IndexDocumentV1, IndexedNote } from "../indexes/index.js";
import type { NoteStage } from "../schema/note.js";

export interface RetrievalQuery {
  readonly text: string;
  readonly filters?: {
    readonly tags?: readonly string[];
    readonly types?: readonly string[];
    readonly folders?: readonly string[];
    readonly stages?: readonly string[];
  };
  /**
   * Explicit; the API has no implicit default. A caller that forgets to choose
   * gets a type error rather than a silent 10.
   */
  readonly maxCandidates: number;
}

export interface RetrievalFieldMatch {
  readonly field: string;
  readonly term: string;
}

export interface RetrievalMatch {
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly stage: NoteStage;
  readonly reviewed: string | null;
  /** Integer. No float is ever stored, and none is ever compared. */
  readonly score: number;
  readonly matched: readonly RetrievalFieldMatch[];
}

export type RetrievalResult =
  | {
      readonly kind: "results";
      readonly matches: readonly RetrievalMatch[];
      readonly considered: number;
      readonly selected: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "no-candidates"; readonly tried: readonly string[] };

/**
 * Spec §8. Integers, so no float ever enters an ordering comparison — two
 * machines that disagree in the last bit of a float would disagree about which
 * note came first.
 */
export const FIELD_WEIGHTS = {
  title: 4,
  alias: 3,
  tag: 3,
  summary: 2,
  body: 1,
} as const;

/**
 * The structural access paths stage 1 tries, in order, and the list returned
 * when none of them reaches anything. Naming them is the point: a user who gets
 * nothing back learns which doors were tried, rather than being handed results
 * from a full-text fallback whose reachability nobody can explain.
 */
export const FUNNEL_STAGES: readonly string[] = Object.freeze([
  "tag",
  "type",
  "folder",
  "title",
  "alias",
]);

/**
 * A match's `title` and `summary` are printed to a terminal and written to a
 * log by the CLI, and both are author-controlled: `note.ts` validates `title`
 * as a string with at least one visible character, with no length bound and no
 * character screen, so a 50,000 character title parses clean, as does one
 * carrying `\r` or an ANSI escape.
 *
 * The screen itself is `../redact.js`. What differs here is which half applies:
 * lint caps at 64 because its values are incidental diagnostics, while here the
 * text *is* the payload, so a summary is screened and not capped and only the
 * title — the one field the schema does not bound — is capped. It happens at
 * this layer rather than in the CLI so a JSON-log consumer cannot skip it.
 *
 * `matched` and `score` are computed from the *raw* title, before this cap, so
 * a capped row can name a `title` match on a word the shown title no longer
 * contains. That is the right trade — scoring the truncated text would make
 * relevance depend on a display bound — but it means a caller must not present
 * the title as the evidence for `matched`. A `body` match already names a term
 * the row never shows. (Deleted by the refactor that made this module share one
 * screen, and restored after review: the behaviour never changed, only the
 * record of why it must not.)
 */
const MAX_TITLE_GRAPHEMES = 200;

function displayText(value: string, maxGraphemes?: number): string {
  const clean = screenControlCharacters(value);
  /** `undefined` means "screen it, do not cap it" — a summary is already bounded by its schema. */
  return maxGraphemes === undefined ? clean : capGraphemes(clean, maxGraphemes);
}

function fold(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function foldAll(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((values ?? []).map(fold));
}

/**
 * Stage 1 — structure. A note survives when the query reaches it through any
 * declared access path, and is then intersected with the explicit filters.
 *
 * The whole folded query is tested alongside its tokens for the exact fields.
 * Tokenizing splits on every non-alphanumeric, so `knowledge-note` becomes two
 * tokens and neither equals the type — a token-only funnel cannot match a type
 * by its own name, which is the one spelling a user is most likely to type.
 */
function isCandidate(
  note: IndexedNote,
  whole: string,
  tokens: readonly string[],
): boolean {
  /**
   * An empty query reaches nothing. `note.ts` validates tags as strings with no
   * emptiness check, so `tags: ["", "dev"]` parses clean — and then `whole` of
   * `""` matches that tag exactly and the note comes back at score 0. The
   * empty-query test passed only because the fixture happens to have no such
   * tag, which is a property of a fixture rather than of the contract.
   */
  if (whole === "" && tokens.length === 0) return false;

  const tags = new Set(note.tags.map(fold));
  if (tags.has(whole) || tokens.some((token) => tags.has(token))) return true;

  /**
   * Whole query only, and that is not an oversight. Every `NoteType` is
   * hyphenated — `knowledge-note`, `compiled-note`, `project-note`,
   * `reference-note` — and the tokenizer splits on the hyphen, so no token can
   * ever equal a type and a token branch here would be dead code. This is the
   * door the whole-query test exists for.
   */
  if (fold(note.type) === whole) return true;

  const folder = fold(note.topicFolder);
  if (folder === whole || tokens.includes(folder)) return true;

  const title = fold(note.title);
  if (tokens.some((token) => title.includes(token))) return true;

  const aliases = note.aliases.map(fold);
  return tokens.some((token) =>
    aliases.some((alias) => alias.includes(token)),
  );
}

function passesFilters(note: IndexedNote, query: RetrievalQuery): boolean {
  const filters = query.filters;
  if (filters === undefined) return true;

  /**
   * Each supplied dimension must match; dimensions intersect rather than union.
   * An absent dimension constrains nothing — `{}` is not "match nothing".
   */
  const dimensions: readonly (readonly [
    readonly string[] | undefined,
    readonly string[],
  ])[] = [
    [filters.tags, note.tags],
    [filters.types, [note.type]],
    [filters.folders, [note.topicFolder]],
    [filters.stages, [note.stage]],
  ];

  return dimensions.every(([wanted, actual]) => {
    if (wanted === undefined || wanted.length === 0) return true;
    const allowed = foldAll(wanted);
    return actual.some((value) => allowed.has(fold(value)));
  });
}

interface Scored {
  readonly match: RetrievalMatch;
  /** Position in `index.notes`, which is already a total order. */
  readonly ordinal: number;
}

/**
 * Stage 2 — lexical. Integer weighted term counts over the fields the note
 * carries. `stage` and `reviewed` are returned and never read: spec §8's trust
 * model puts the judgement in front of the reader rather than folding it into
 * an unfalsifiable number that quietly reorders the list.
 */
function scoreNote(
  note: IndexedNote,
  tokens: readonly string[],
  ordinal: number,
): Scored {
  const titleTokens = tokenize(note.title);
  const summaryTokens = tokenize(note.summary);
  const aliasTokens = note.aliases.flatMap((alias) => tokenize(alias));
  const tags = note.tags.map(fold);
  const bodyCounts = new Map(note.terms.map((term) => [term.term, term.count]));

  let score = 0;
  const matched: RetrievalFieldMatch[] = [];

  const add = (field: string, term: string, hits: number, weight: number) => {
    if (hits === 0) return;
    score += hits * weight;
    matched.push({ field, term });
  };

  for (const token of tokens) {
    const count = (values: readonly string[]) =>
      values.filter((value) => value === token).length;

    add("title", token, count(titleTokens), FIELD_WEIGHTS.title);
    add("alias", token, count(aliasTokens), FIELD_WEIGHTS.alias);
    add("tag", token, count(tags), FIELD_WEIGHTS.tag);
    add("summary", token, count(summaryTokens), FIELD_WEIGHTS.summary);
    add("body", token, bodyCounts.get(token) ?? 0, FIELD_WEIGHTS.body);
  }

  return {
    ordinal,
    match: {
      /**
       * **Not** screened, unlike the two fields below, and that asymmetry is
       * deliberate: spec §14 gates on "every retrieval match resolves to a
       * canonical note that exists at the returned path", so this is machine
       * identity and must stay byte-exact. Discovery validates nothing about
       * filename characters, so a file really can be named with an ESC in it.
       *
       * The consequence belongs to whoever prints a match: **the CLI must pass
       * `path` through `renderPath` before it reaches a terminal.** Reading a
       * module that screens two of three printed fields and concluding the row
       * is safe to print is the mistake this comment exists to prevent.
       */
      path: note.path,
      title: displayText(note.title, MAX_TITLE_GRAPHEMES),
      /** The schema bounds `summary` at 400; only the character screen is owed. */
      summary: displayText(note.summary),
      stage: note.stage,
      reviewed: note.reviewed,
      score,
      matched: matched.sort(
        (a, b) =>
          compareCanonical(a.field, b.field) || compareCanonical(a.term, b.term),
      ),
    },
  };
}

export function search(
  index: IndexDocumentV1,
  query: RetrievalQuery,
): RetrievalResult {
  if (!Number.isInteger(query.maxCandidates) || query.maxCandidates < 1) {
    throw new RangeError(
      `maxCandidates must be a positive integer, received ${String(query.maxCandidates)}`,
    );
  }

  /**
   * Deduplicated. Iterating the raw token list scores a repeated query word
   * twice — `widget widget` scored 8 against a title worth 4 — and pushed the
   * same `field`/`term` row into `matched` twice, which Task 9 prints. No
   * search box treats repetition as a weight, and it also made the `matched`
   * comparator non-total by allowing two elements that compare equal.
   */
  const tokens = [...new Set(tokenize(query.text))];
  const whole = fold(query.text.trim());

  /**
   * The ordinal is taken here, from the position in `index.notes`. Looking it
   * up later with `indexOf` was both quadratic and quietly fragile: it matches
   * by reference, so the first step that copies a note before scoring — the
   * text sanitising above would have been exactly that — turns every ordinal
   * into `-1` and collapses the tie-break to a constant, with no test failing.
   */
  const candidates = index.notes
    .map((note, ordinal) => ({ note, ordinal }))
    .filter(
      ({ note }) =>
        isCandidate(note, whole, tokens) && passesFilters(note, query),
    );

  if (candidates.length === 0) {
    return { kind: "no-candidates", tried: FUNNEL_STAGES };
  }

  const scored = candidates
    .map(({ note, ordinal }) => scoreNote(note, tokens, ordinal))
    .sort(
      (a, b) =>
        b.match.score - a.match.score ||
        compareCanonical(a.match.path, b.match.path) ||
        /**
         * The last resort, for two notes carrying the *same* NFC path — the
         * normalization collision `discover.ts` documents, where no comparison
         * over paths can separate them.
         *
         * It is not independently observable, and saying so is the honest
         * version: the ordinal is the input position, so this produces exactly
         * what `Array#sort`'s guaranteed stability would. It is written out
         * because a comparator that returns 0 and relies on an ambient language
         * guarantee is one refactor away from a `Map` or a `Set` that does not
         * have one, and this file's ordering is a stated contract.
         */
        a.ordinal - b.ordinal,
    );

  const matches = scored
    .slice(0, query.maxCandidates)
    .map((entry) => entry.match);

  return {
    kind: "results",
    matches,
    considered: scored.length,
    selected: matches.length,
    truncated: scored.length > matches.length,
  };
}
