import type { BrainConfigV1 } from "@developer-os/core";

import { compareCanonical, PRIVATE_FOLDERS } from "../discovery/index.js";
import { buildIndex, renderArtifacts } from "../indexes/index.js";
import type {
  IndexBuildRequest,
  IndexBuildResult,
  IndexedNote,
} from "../indexes/index.js";
import { screenAndCap, screenControlCharacters } from "../redact.js";
import { canonicalizeArtifact, firstDifferingLine } from "./drift.js";

export type LintClass =
  | "frontmatter"
  | "provenance"
  | "links"
  | "duplicates"
  | "staleness"
  | "index-drift";

export type LintSeverity = "error" | "warn" | "info";

export interface LintFinding {
  readonly class: LintClass;
  readonly severity: LintSeverity;
  readonly path: string;
  /**
   * The offending frontmatter key, **as rendered for display**: whitespace
   * collapsed and truncated like the message. It is not guaranteed to be the
   * exact bytes in the file, because on the unterminated-fence branch the "key"
   * is a line of body prose and findings are written to logs.
   */
  readonly key: string | null;
  readonly message: string;
  /**
   * A 1-based line in the file named by `path`, or `null` where the finding has
   * no position. It is on `LintFinding` rather than only on `NoteParseIssue`
   * because the CLI renders findings, not issues.
   *
   * **`path` names two kinds of file, so the frame has to be stated.** For a
   * note it is a line the author wrote, inside the frontmatter block: only parse
   * failures the YAML library located carry one, a duplicate `tags:` being the
   * case this exists for. For a generated artifact — `index-drift` — it is a
   * line in a file the user did not write, counted from the first byte of the
   * artifact rather than from any block inside it, and it is the first line that
   * differs from a fresh build. That one **may be one past the last line the
   * file has**, when the artifact on disk is a prefix of the fresh build: a
   * truncated `catalog.md` or a stripped final newline differs at a line that is
   * missing, and `drift.ts` reports the position rather than no difference at
   * all. A consumer that jumps to it must tolerate the end of the file.
   *
   * The two frames are deliberately one field. A consumer's question is "where
   * do I look", and the answer is a line number in the file it was handed; which
   * of the two produced it is already carried by `class`.
   */
  readonly line: number | null;
}

export interface LintResult {
  readonly findings: readonly LintFinding[];
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
}

export interface LintRequest {
  readonly build: IndexBuildRequest;
  /**
   * `null` for a missing artifact rather than a throw: "the index has never
   * been built" is an `index-drift` finding with recovery text, not a crash.
   */
  readonly readArtifact: (vaultPath: string) => Promise<string | null>;
  /**
   * `YYYY-MM-DD`, taken from the injected clock by the caller. Staleness is the
   * only class that needs the current date, and passing it explicitly keeps
   * `lintVault` a pure function of its arguments — a helper that reached for
   * `new Date()` would make findings depend on the day the suite ran.
   */
  readonly today: string;
}

/**
 * The same 64-character policy as `note.ts`'s `renderKey`, and for the same
 * reason its comment gives: "short enough that a prose line cannot fill a
 * terminal". Every value below is author-controlled and length-bounded by
 * nothing — a wikilink matches `[^\]|#[]+`, which includes newlines, and the
 * unterminated-fence heuristic's key *is by definition* a line of body prose.
 * Findings reach a terminal and a log, so they are redacted before they get
 * there, not after.
 */
const MAX_VALUE_IN_MESSAGE = 64;

/**
 * The screen and the bound both live in `../redact.js`; this names the bound.
 *
 * Grapheme clusters, not code units: `String#slice` can cut a surrogate pair in
 * half and put a lone surrogate into a log, where it round-trips to U+FFFD or
 * throws in a JSON writer.
 */
function renderValue(value: string): string {
  return screenAndCap(value, MAX_VALUE_IN_MESSAGE);
}

/** `LintFinding.key` is bounded on every branch, not only the prose one. */
function renderKeyField(key: string | null): string | null {
  return key === null ? null : renderValue(key);
}

function finding(
  cls: LintClass,
  severity: LintSeverity,
  path: string,
  key: string | null,
  message: string,
  line: number | null = null,
): LintFinding {
  return { class: cls, severity, path, key, message, line };
}

/* ---------------------------------------------------------------- frontmatter */

/** A reserved key never contains whitespace; a swallowed prose line always does. */
const WHITESPACE = /\s/u;

/**
 * Whitespace alone is not enough. Obsidian's Properties UI accepts arbitrary
 * property names, so `Due date:` is an ordinary note and firing on it would
 * train users to ignore this class — the same argument spec §7's amendment used
 * to justify the bare-basename link tier. A property name is a short label; a
 * swallowed prose line is a sentence. The length is the discriminator.
 */
const MIN_SWALLOWED_PROSE_LENGTH = 24;

function frontmatterFindings(
  build: IndexBuildResult,
  config: BrainConfigV1,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  for (const note of build.parseIssues) {
    for (const issue of note.issues) {
      /**
       * Carried from Task 2's review. An opening fence that is never closed
       * lets the next `---` in the body close it, so the paragraph above is
       * parsed as frontmatter and the indexed body silently loses it. The only
       * signal is an unknown key, and a key containing whitespace is a
       * near-certain sign — a heuristic, which is why it lives here and not in
       * the parser.
       */
      const key = issue.key ?? "";
      if (
        issue.code === "unknown-key" &&
        WHITESPACE.test(key) &&
        key.length > MIN_SWALLOWED_PROSE_LENGTH
      ) {
        findings.push(
          finding(
            "frontmatter",
            "warn",
            note.path,
            renderValue(key),
            `the frontmatter key "${renderValue(key)}" is a sentence rather than a label, which usually means an unterminated frontmatter fence swallowed a line of the body`,
          ),
        );
        continue;
      }
      findings.push(
        finding(
          "frontmatter",
          issue.severity,
          note.path,
          renderKeyField(issue.key),
          /**
           * Screened here as well as at its source. `note.ts` interpolates a
           * frontmatter key into this message and screens it as it does so, but
           * a finding is the seam where foreign text becomes something this
           * process prints — a message arriving unscreened from any future
           * producer must not be able to reach a terminal through this branch.
           * The screen is idempotent, so applying it twice costs a scan.
           */
          screenControlCharacters(issue.message),
          issue.line,
        ),
      );
    }
  }

  for (const folder of build.unclassifiedFolders) {
    findings.push(
      finding(
        "frontmatter",
        "warn",
        folder,
        null,
        `${folder} is not a configured topic folder and is not indexed; add it to topicFolders or topicAliases, or move its notes`,
      ),
    );
  }

  /**
   * Reported here rather than dropped. Discovery does not descend into a
   * symlinked topic folder, so its notes reach neither the index nor the
   * unclassified list — without this the user sees an empty folder in the
   * catalog and has nothing to search for.
   */
  for (const folder of build.symlinkedFolders) {
    findings.push(
      finding(
        "frontmatter",
        "warn",
        folder,
        null,
        `${folder} is a symlink and is not followed, so none of its notes are indexed`,
      ),
    );
  }

  /** Referenced so a config change cannot silently orphan this class. */
  void config;
  return findings;
}

/* ----------------------------------------------------------------- provenance */

/**
 * An allowlist, not a shape. `^[a-z][a-z0-9+.-]*://` is not "absolute URL", it
 * is "hierarchical URI with an authority": it rejects `mailto:` and `doi:`,
 * which are ordinary provenance for a knowledge note, while accepting
 * `javascript://` and `file:///etc/passwd`. Sources land in `index.json` and
 * are read by later subsystems, so the permissive direction is the dangerous one.
 */
const ALLOWED_SOURCE_SCHEMES: readonly string[] = Object.freeze([
  "http:",
  "https:",
  "mailto:",
  "doi:",
  "urn:",
  "isbn:",
]);

/**
 * The allowlist above is the *message*; these are the *check*, and both halves
 * are needed. Matching a scheme alone accepts `https:/example.invalid` — a
 * single-slash typo that is a routine mistake and that the previous `://`
 * pattern caught. Widening which schemes are legal must not stop verifying that
 * what follows one is a URL. A test asserts every listed scheme has a form that
 * passes, so the two cannot drift apart.
 */
const HIERARCHICAL_SOURCE = /^https?:\/\/[^\s/]+/iu;
const OPAQUE_SOURCE = /^(?:mailto|doi|urn|isbn):\S+/iu;

function hasAllowedScheme(source: string): boolean {
  return HIERARCHICAL_SOURCE.test(source) || OPAQUE_SOURCE.test(source);
}

function sourceResolves(
  source: string,
  byPath: ReadonlySet<string>,
  contentRoot: string,
): boolean {
  if (hasAllowedScheme(source)) return true;
  /**
   * Folded, because every path in `byPath` is. macOS hands back NFD when a
   * filename is pasted out of Finder, and an unfolded lookup turns a source
   * naming a real note into a spec §7 `error` that fails the gate.
   */
  const folded = source.normalize("NFC");
  const candidates = [
    folded,
    `${folded}.md`,
    `${contentRoot}/${folded}`,
    `${contentRoot}/${folded}.md`,
  ];
  return candidates.some((candidate) => byPath.has(candidate));
}

function provenanceFindings(
  build: IndexBuildResult,
  contentRoot: string,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const byPath = new Set(build.index.notes.map((note) => note.path));

  for (const note of build.index.notes) {
    if (note.author === "agent" && note.reviewed === null) {
      findings.push(
        finding(
          "provenance",
          "warn",
          note.path,
          "reviewed",
          "written by an agent and never reviewed by a human",
        ),
      );
    }

    for (const source of note.sources) {
      if (sourceResolves(source, byPath, contentRoot)) continue;
      findings.push(
        finding(
          "provenance",
          "error",
          note.path,
          "sources",
          /**
           * Checked against canonical notes only. A source naming a real file
           * inside an excluded folder therefore reads as unresolved, which is
           * the right answer: an excluded file is not citable evidence.
           */
          `the source "${renderValue(source)}" is neither a note in this vault nor a URL with an allowed scheme (${ALLOWED_SOURCE_SCHEMES.join(" ")})`,
        ),
      );
    }
  }

  return findings;
}

/* ---------------------------------------------------------------------- links */

const ESCAPES_VAULT = /(^\/)|(^\.\.\/)|(\/\.\.\/)|(^~)/u;

function linkFindings(
  build: IndexBuildResult,
  config: BrainConfigV1,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const excluded = new Set([...PRIVATE_FOLDERS, config.indexesDir]);
  /**
   * A note linking twice to the same missing target is one problem. Two
   * byte-identical findings are also two the sort comparator cannot separate.
   */
  const seen = new Set<string>();

  for (const unresolved of build.unresolvedLinks) {
    const seenKey = `unresolved\u0000${unresolved.source}\u0000${unresolved.text}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);

    if (ESCAPES_VAULT.test(unresolved.text)) {
      findings.push(
        finding(
          "links",
          "error",
          unresolved.source,
          null,
          `the link "${renderValue(unresolved.text)}" points outside the vault`,
        ),
      );
      continue;
    }

    /**
     * An excluded target is unresolvable for the same reason as a missing one —
     * it is never indexed — but the user's fix is completely different, so the
     * two must not read the same. One means "you have a typo", the other means
     * "you linked to a quarantined capture".
     */
    /**
     * Only a *non-final* segment can name a folder. Link text is very often a
     * title, and titles legitimately start with a dot — `[[.NET conventions]]`
     * is a typo to fix, not a link into an excluded tree, and telling the user
     * to look for an exclusion rule sends them the wrong way.
     */
    const segments = unresolved.text.split("/");
    /**
     * Two rules, two scopes. A private folder *name* is unambiguous wherever it
     * appears — no note is called `_raw`. A leading dot is not: link text is
     * very often a title, and `[[.NET conventions]]` is a typo to fix, not a
     * link into an excluded tree. So the dot rule applies only when the text is
     * path-shaped, which keeps `[[DEV/.env]]` classified correctly — spec §5
     * excludes any dot segment, file or not.
     */
    const segment =
      segments.find((part) => excluded.has(part)) ??
      (segments.length > 1
        ? segments.find((part) => part.startsWith("."))
        : undefined);
    if (segment !== undefined) {
      findings.push(
        finding(
          "links",
          "error",
          unresolved.source,
          null,
          `the link "${renderValue(unresolved.text)}" points into ${renderValue(segment)}, an excluded folder that is never indexed`,
        ),
      );
      continue;
    }

    findings.push(
      finding(
        "links",
        "error",
        unresolved.source,
        null,
        `the link "${renderValue(unresolved.text)}" resolves to no note`,
      ),
    );
  }

  for (const ambiguous of build.ambiguousLinks) {
    /** One finding per link, not per occurrence — as for unresolved links. */
    const ambiguousKey = `ambiguous\u0000${ambiguous.source}\u0000${ambiguous.text}`;
    if (seen.has(ambiguousKey)) continue;
    seen.add(ambiguousKey);

    findings.push(
      finding(
        "links",
        "warn",
        ambiguous.source,
        null,
        /**
         * `chosen` is the only value on this line not passed through
         * `renderValue`, and deliberately: **paths are exempt as a class**,
         * here and at `${folder}` above, because a path is an identifier the
         * user has to be able to act on — copy it, open it, pass it back to the
         * tool. Screening or capping one produces a string that names nothing.
         * They are screened and bounded at the terminal instead, by
         * `renderPath` in `apps/cli`, which is where a path stops being an
         * identifier and becomes output.
         *
         * An earlier version of this comment justified the exemption with spec
         * §14, which does not cover it: §14 gates on a *retrieval match*
         * resolving at its returned path, and on `finding.path`, not on a path
         * interpolated into prose that nothing parses back out. Recorded
         * because a wrong reason in a comment is worse than no reason — the
         * next reader applies it where it does not hold.
         */
        `the link "${renderValue(ambiguous.text)}" matches ${String(ambiguous.candidates.length)} notes and resolved to ${ambiguous.chosen}; spell it with a folder to say which you meant`,
      ),
    );
  }

  return findings;
}

/* ----------------------------------------------------------------- duplicates */

function groupBy(
  notes: readonly IndexedNote[],
  key: (note: IndexedNote) => string,
): Map<string, IndexedNote[]> {
  const groups = new Map<string, IndexedNote[]>();
  for (const note of notes) {
    const value = key(note);
    const existing = groups.get(value);
    if (existing === undefined) groups.set(value, [note]);
    else existing.push(note);
  }
  return groups;
}

const MAX_NAMED_SIBLINGS = 3;

function describeSiblings(
  group: readonly IndexedNote[],
  self: IndexedNote,
): string {
  /**
   * Identity, not path equality. Two notes whose names differ only in Unicode
   * normalization carry the *same* path string, so filtering by path removes
   * the twin along with self and the message reads "identical content to " with
   * nothing after it.
   */
  const others = group.filter((note) => note !== self);
  const named = others.slice(0, MAX_NAMED_SIBLINGS).map((note) => note.path);
  const rest = others.length - named.length;
  return rest > 0
    ? `${named.join(", ")} and ${String(rest)} more`
    : named.join(", ");
}

function duplicateFindings(build: IndexBuildResult): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const { notes } = build.index;

  /**
   * An `error`, while the other two duplicate findings are `warn`, and that is
   * intentional. Two notes with the same title are a curation question. Two
   * paths differing only in case are a data-loss question the moment the vault
   * is cloned onto a case-insensitive volume — one of them simply will not be
   * there.
   */
  for (const [, group] of groupBy(notes, (note) =>
    note.path.normalize("NFC").toLowerCase(),
  )) {
    if (group.length < 2) continue;
    /**
     * Two shapes reach this branch and they need different text. Discovery
     * NFC-folds `vaultPath`, so two files whose names differ only in Unicode
     * normalization arrive carrying the *same* path string — telling that user
     * to fix their casing names one path twice and describes a problem they do
     * not have. `discover.ts` delegates that case here by name.
     */
    const normalizationOnly = new Set(group.map((note) => note.path)).size === 1;
    for (const note of group) {
      findings.push(
        finding(
          "duplicates",
          "error",
          note.path,
          null,
          normalizationOnly
            ? `${String(group.length)} files share this vault path, differing only in Unicode normalization; rename all but one so each note has its own identity`
            : `this path differs from ${String(group.length - 1)} other only by case, and a case-insensitive volume cannot hold both`,
        ),
      );
    }
  }

  for (const [, group] of groupBy(
    notes,
    /**
     * Screened first, then NFC-folded like the path key two branches up.
     *
     * The screen is what makes this class agree with the artifact it is about.
     * `catalog.md` renders a *screened* title, so `Deploy keys` and
     * `Deploy<U+200B> keys` produce byte-identical rows — and grouping on the
     * raw bytes reported no duplicate at all, which left the vault showing what
     * reads as a duplicate while lint said there was none. A check about what a
     * human perceives as a duplicate has to run on the form the human was
     * shown. It collapses runs of whitespace for the same reason: the renderer
     * does, so two titles differing only by a second space are one row.
     *
     * The NFC fold stays, and stays second. Without it, two notes in one folder
     * titled the same word in different normalizations are not reported — two
     * lines apart, two different Unicode policies. Screening cannot replace it:
     * it removes invisibles, it does not compose. `trim()` is gone because
     * `screenControlCharacters` already trims.
     */
    (note) =>
      `${note.topicFolder}\u0000${screenControlCharacters(note.title).normalize("NFC").toLowerCase()}`,
  )) {
    if (group.length < 2) continue;
    for (const note of group) {
      findings.push(
        finding(
          "duplicates",
          "warn",
          note.path,
          "title",
          `this title is shared with ${String(group.length - 1)} other note in ${note.topicFolder}`,
        ),
      );
    }
  }

  for (const [, group] of groupBy(notes, (note) => note.contentHash)) {
    if (group.length < 2) continue;
    for (const note of group) {
      findings.push(
        finding(
          "duplicates",
          "warn",
          note.path,
          null,
          /** Named, but bounded: 40 byte-identical notes must not emit 40 KB. */
          `identical content to ${describeSiblings(group, note)}`,
        ),
      );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ staleness */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Both dates are `YYYY-MM-DD` and validated by `note.ts`, so parsing them as
 * UTC midnight is exact. Using local time would move the boundary by a day for
 * anyone east or west of UTC and make the same vault stale in one timezone and
 * fresh in another.
 */
function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

const EMERGING_OCCURRENCE_THRESHOLD = 3;

function stalenessFindings(
  build: IndexBuildResult,
  config: BrainConfigV1,
  today: string,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const limit = config.staleness.reviewAfterDays;

  for (const note of build.index.notes) {
    if (note.reviewed !== null && daysBetween(note.reviewed, today) > limit) {
      findings.push(
        finding(
          "staleness",
          "warn",
          note.path,
          "reviewed",
          `last reviewed ${String(daysBetween(note.reviewed, today))} days ago, over the ${String(limit)}-day threshold`,
        ),
      );
    }

    if (
      note.stage === "emerging" &&
      note.occurrences >= EMERGING_OCCURRENCE_THRESHOLD &&
      note.reviewed === null
    ) {
      findings.push(
        finding(
          "staleness",
          "warn",
          note.path,
          "stage",
          `still emerging after ${String(note.occurrences)} occurrences and never reviewed`,
        ),
      );
    }
  }

  return findings;
}

/* ---------------------------------------------------------------- index-drift */

async function driftFindings(
  request: LintRequest,
  build: IndexBuildResult,
): Promise<readonly LintFinding[]> {
  /** One renderer, shared with the test helper and with `BrainService`. */
  const expected = renderArtifacts(build, request.build.config);

  const findings: LintFinding[] = [];
  for (const [path, fresh] of Object.entries(expected)) {
    const onDisk = await request.readArtifact(path);
    if (onDisk === null) {
      findings.push(
        finding(
          "index-drift",
          "error",
          path,
          null,
          "this artifact has never been built; run developer-os brain reindex",
        ),
      );
      continue;
    }

    const line = firstDifferingLine(
      canonicalizeArtifact(fresh),
      canonicalizeArtifact(onDisk),
    );
    if (line === null) continue;

    /**
     * The line number, never the line. Spec §6.3 asks for the first differing
     * line, and echoing its content would put note text into a terminal and a
     * log — which the redaction rule exists to prevent.
     *
     * It goes in the field and not in the message. The prose form — "differs
     * from a fresh build at line 6" beside `line: null` — made one type carry
     * one concept in two conventions, and a `--json` consumer had to parse
     * English to recover a number the type already declares. The CLI renders
     * `path:line` from the field, so the human output loses nothing.
     */
    findings.push(
      finding(
        "index-drift",
        "error",
        path,
        null,
        "differs from a fresh build; run developer-os brain reindex",
        line,
      ),
    );
  }

  return findings;
}

/* ----------------------------------------------------------------------- main */

/**
 * Lints a build the caller already has.
 *
 * `lintVault` is the convenience wrapper, and the split exists because
 * `BrainService.status` needs both the findings and the build: with only the
 * wrapper it walked and parsed the whole vault twice for one command.
 *
 * The caller owes one thing the wrapper used to guarantee: `build` must have
 * been produced from `request.build`. Drift takes artifact paths from
 * `request.build.config` and content from `build`, so two different configs
 * would compare one vault's bytes against another's paths.
 */
export async function lintBuild(
  build: IndexBuildResult,
  request: LintRequest,
): Promise<LintResult> {
  const { config } = request.build;
  const contentRoot = config.contentRoot.normalize("NFC");

  const findings = [
    ...frontmatterFindings(build, config),
    ...provenanceFindings(build, contentRoot),
    ...linkFindings(build, config),
    ...duplicateFindings(build),
    ...stalenessFindings(build, config, request.today),
    ...(await driftFindings(request, build)),
  ].sort(
    (a, b) =>
      compareCanonical(a.path, b.path) ||
      compareCanonical(a.class, b.class) ||
      compareCanonical(a.message, b.message),
  );

  return {
    findings,
    errorCount: findings.filter((f) => f.severity === "error").length,
    warnCount: findings.filter((f) => f.severity === "warn").length,
    infoCount: findings.filter((f) => f.severity === "info").length,
  };
}

export async function lintVault(request: LintRequest): Promise<LintResult> {
  return lintBuild(await buildIndex(request.build), request);
}
