/**
 * `yaml@2.8.1`, and the **version family is a requirement, not an implementation
 * detail**: it resolves the YAML 1.2 core schema, so a tag spelled `no` stays the
 * string `"no"`. A YAML 1.1 parser — which is what "just swap the YAML library"
 * usually lands on — yields `false` instead, and `on`, `off` and `18:30` go the
 * same way. The user silently loses a tag and gains a value no lint class
 * expects. Any replacement must resolve the 1.2 core schema, must bound alias
 * expansion (see `maxAliasCount` below), and must report a duplicate mapping key
 * as an error rather than resolving it last-one-wins — that one rides on this
 * library's `uniqueKeys` default, which the call below does not pin (BACKLOG.md
 * NEW-2). The duplicate-key case in `note.test.ts` is what stands there, and it
 * pins a contract: a new parser that fails it is the wrong parser, not a test to
 * loosen. Design spec §4.4 states all four clauses.
 */
import { parseAllDocuments } from "yaml";

export type NoteType =
  | "knowledge-note"
  | "compiled-note"
  | "project-note"
  | "reference-note";
export type NoteStage = "emerging" | "established" | "deprecated";
export type NoteAuthor = "agent" | "human";

export const NOTE_TYPES: readonly NoteType[] = [
  "knowledge-note",
  "compiled-note",
  "project-note",
  "reference-note",
];
export const NOTE_STAGES: readonly NoteStage[] = [
  "emerging",
  "established",
  "deprecated",
];
export const NOTE_AUTHORS: readonly NoteAuthor[] = ["agent", "human"];

/**
 * `satisfies` ties this to the interface: an entry that is not a field of
 * `NoteFrontmatterV1` no longer compiles. Completeness in the other direction —
 * a field missing from this list, which would silently reclassify a reserved key
 * as unknown — is pinned by the "every optional reserved key" test.
 */
export const RESERVED_KEYS = [
  "schemaVersion",
  "title",
  "type",
  "created",
  "updated",
  "tags",
  "aliases",
  "summary",
  "stage",
  "author",
  "reviewed",
  "occurrences",
  "sources",
] as const satisfies readonly (keyof NoteFrontmatterV1)[];

export const MAX_SUMMARY_LENGTH = 400;

export interface NoteFrontmatterV1 {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly type: NoteType;
  readonly created: string;
  readonly updated?: string;
  readonly tags: readonly string[];
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly stage: NoteStage;
  readonly author: NoteAuthor;
  readonly reviewed: string | null;
  readonly occurrences?: number;
  readonly sources?: readonly string[];
}

export type NoteIssueCode =
  | "missing"
  | "type"
  | "enum"
  | "date"
  | "length"
  | "unknown-key"
  | "malformed";

export interface NoteParseIssue {
  readonly key: string | null;
  readonly code: NoteIssueCode;
  readonly message: string;
  readonly severity: "error" | "info";
  /**
   * 1-based line **in the file**, or `null` where there is no position — every
   * validation issue, and any YAML failure the library did not locate. Only
   * `malformed` issues ever carry one.
   */
  readonly line: number | null;
}

export interface ParsedNote {
  readonly frontmatter: NoteFrontmatterV1;
  readonly unknownKeys: readonly string[];
  readonly frontmatterText: string;
  /**
   * Everything before the body, verbatim — opening fence, frontmatter, closing
   * fence, a BOM if there was one, and whichever line endings the file used.
   * Retaining it rather than rebuilding it is what makes `header + body` equal
   * the source *by construction* for every input the regex accepts.
   */
  readonly header: string;
  readonly body: string;
}

export type NoteParseResult =
  | {
      readonly ok: true;
      readonly note: ParsedNote;
      readonly issues: readonly NoteParseIssue[];
    }
  | { readonly ok: false; readonly issues: readonly NoteParseIssue[] };

/**
 * Lazy, so the *first* `---` on its own line closes the block: a body may
 * legitimately contain a horizontal rule, and a greedy match would swallow it
 * and everything above it into the frontmatter.
 *
 * Four tolerances, each for a file a user really writes: a leading BOM, which
 * `readFile(…, "utf8")` does not strip, so a PowerShell-authored note would
 * otherwise be reported as having no frontmatter at all; trailing spaces on
 * either fence, which the common Markdown frontmatter parsers accept; a closing
 * fence at end of file with no newline after it; and a wholly empty block,
 * which is an empty mapping rather than a missing one.
 *
 * The empty block is expressed by making the content group *and its trailing
 * newline* optional together. Making only the newline optional looks equivalent
 * and is not: it lets the fence match mid-line, so a value ending in three
 * dashes would close the block and every key below it would be silently
 * reclassified as body. A reviewer proposed that shorter form; this is why it
 * was declined.
 */
const FRONTMATTER =
  /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Exported so a test can assert it, because neither option is observable from
 * the parser's behaviour: `uniqueKeys` already defaults to `true`, so removing
 * it changes nothing today and everything the day the library's default moves.
 * That is exactly why it is pinned, and pinning something no behaviour can
 * detect is worth nothing unless something fails when it disappears.
 *
 * `uniqueKeys` — a parser that resolves duplicates last-one-wins hands the
 * validator only the surviving value, so a note carrying `schemaVersion: 1` and
 * later `schemaVersion: 999`, or two `tags` lists, validates against a value its
 * author never wrote. The bytes survive; only the checking goes blind. Obsidian
 * users do produce duplicate keys.
 *
 * `logLevel` — see the call site: the default prints warnings *with the
 * offending source line* to stderr, past every redaction seam.
 */
export const FRONTMATTER_PARSE_OPTIONS = Object.freeze({
  logLevel: "silent",
  uniqueKeys: true,
} as const);

/** Long enough to identify a key, short enough that a prose line cannot fill a terminal. */
const MAX_KEY_IN_MESSAGE = 64;

function renderKey(key: string): string {
  return key.length > MAX_KEY_IN_MESSAGE
    ? `${key.slice(0, MAX_KEY_IN_MESSAGE)}…`
    : key;
}

function issue(
  key: string | null,
  code: NoteIssueCode,
  message: string,
  line: number | null = null,
): NoteParseIssue {
  return { key, code, message, severity: "error", line };
}

/**
 * The line a YAML failure happened on, and **nothing else from the error**.
 *
 * `err.linePos` and `err.pos` are numbers. `err.message` and `err.source` are
 * not: both embed the offending input verbatim — a duplicate-key error reads
 * `Map keys must be unique at line 2, column 1:\n\ntitle: a\ntitle: b` — so
 * reading either would carry note content into every message, log and terminal
 * downstream. That is the redaction rule, and this is the seam it applies at.
 *
 * Duck-typed rather than `instanceof YAMLParseError`, because the shape is what
 * matters and an `instanceof` across a bundled copy of the library silently
 * fails closed to `null`, which looks identical to "no position available".
 */
/**
 * The opening fence is exactly one line — the regex consumes `---` plus its
 * newline, and a BOM sits on that same line — so the slice the parser sees
 * starts at file line 2.
 */
const FRONTMATTER_LINE_OFFSET = 1;

function positionOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { linePos } = error as { linePos?: readonly { line?: number }[] };
  const line = linePos?.[0]?.line;
  /**
   * Offset into the file. `yaml` numbers lines within the string it was handed,
   * which is `frontmatterText` — a slice starting below the opening fence. The
   * number travels on a finding next to a vault `path`, and every consumer of a
   * path-and-line pair reads it as file-relative: a terminal printing
   * `note.md:3`, an editor jump, a CI annotation. Reported unadjusted, a failure
   * on the first frontmatter line comes out as line 1, which is the fence — a
   * line that by construction cannot contain the error.
   */
  return typeof line === "number" && Number.isInteger(line) && line > 0
    ? line + FRONTMATTER_LINE_OFFSET
    : null;
}

function isMember<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (values as readonly string[]).includes(value)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The round-trip check is not redundant with the pattern: `2026-02-30` matches
 * the regular expression and `Date` silently rolls it over to March 2nd, so
 * without this an impossible date parses and every ordering built on it is off
 * by a day.
 */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

interface ValidationOutcome {
  readonly frontmatter: NoteFrontmatterV1 | null;
  readonly issues: readonly NoteParseIssue[];
  readonly unknownKeys: readonly string[];
}

function validate(raw: Record<string, unknown>): ValidationOutcome {
  const issues: NoteParseIssue[] = [];
  const reserved: readonly string[] = RESERVED_KEYS;
  const unknownKeys = Object.keys(raw)
    .filter((key) => !reserved.includes(key))
    .sort();

  for (const key of unknownKeys) {
    issues.push({
      key,
      code: "unknown-key",
      /** No position: the key is known, the block it sits in parsed cleanly. */
      line: null,
      message: `${renderKey(key)} is not a Developer OS key; it is preserved and ignored`,
      severity: "info",
    });
  }

  const required = (key: string): unknown => {
    if (!Object.hasOwn(raw, key)) {
      issues.push(issue(key, "missing", `${key} is required`));
      return undefined;
    }
    return raw[key];
  };

  const schemaVersion = required("schemaVersion");
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    issues.push(issue("schemaVersion", "type", "schemaVersion must be the literal 1"));
  }

  const title = required("title");
  if (
    title !== undefined &&
    (typeof title !== "string" || title.trim().length === 0)
  ) {
    issues.push(issue("title", "type", "title must be a non-empty string"));
  }

  const type = required("type");
  if (type !== undefined && !isMember(NOTE_TYPES, type)) {
    issues.push(issue("type", "enum", `type must be one of ${NOTE_TYPES.join(", ")}`));
  }

  const created = required("created");
  if (created !== undefined && !isIsoDate(created)) {
    issues.push(issue("created", "date", "created must be a real YYYY-MM-DD date"));
  }

  if (Object.hasOwn(raw, "updated") && !isIsoDate(raw.updated)) {
    issues.push(issue("updated", "date", "updated must be a real YYYY-MM-DD date"));
  }

  const tags = required("tags");
  if (tags !== undefined && !isStringArray(tags)) {
    issues.push(issue("tags", "type", "tags must be an array of strings"));
  }

  if (Object.hasOwn(raw, "aliases") && !isStringArray(raw.aliases)) {
    issues.push(issue("aliases", "type", "aliases must be an array of strings"));
  }

  const summary = required("summary");
  if (summary !== undefined) {
    if (typeof summary !== "string") {
      issues.push(issue("summary", "type", "summary must be a string"));
    } else if (summary.length > MAX_SUMMARY_LENGTH) {
      issues.push(
        issue(
          "summary",
          "length",
          `summary must be at most ${String(MAX_SUMMARY_LENGTH)} characters`,
        ),
      );
    }
  }

  const stage = required("stage");
  if (stage !== undefined && !isMember(NOTE_STAGES, stage)) {
    issues.push(issue("stage", "enum", `stage must be one of ${NOTE_STAGES.join(", ")}`));
  }

  const author = required("author");
  if (author !== undefined && !isMember(NOTE_AUTHORS, author)) {
    issues.push(
      issue("author", "enum", `author must be one of ${NOTE_AUTHORS.join(", ")}`),
    );
  }

  if (!Object.hasOwn(raw, "reviewed")) {
    issues.push(
      issue("reviewed", "missing", "reviewed is required; use null when unreviewed"),
    );
  } else if (raw.reviewed !== null && !isIsoDate(raw.reviewed)) {
    issues.push(
      issue("reviewed", "date", "reviewed must be null or a real YYYY-MM-DD date"),
    );
  }

  if (Object.hasOwn(raw, "occurrences")) {
    const value = raw.occurrences;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      issues.push(
        issue("occurrences", "type", "occurrences must be an integer of at least 1"),
      );
    }
  }

  if (Object.hasOwn(raw, "sources") && !isStringArray(raw.sources)) {
    issues.push(issue("sources", "type", "sources must be an array of strings"));
  }

  if (issues.some((candidate) => candidate.severity === "error")) {
    return { frontmatter: null, issues, unknownKeys };
  }

  return {
    frontmatter: {
      schemaVersion: 1,
      title: raw.title as string,
      type: raw.type as NoteType,
      created: raw.created as string,
      ...(Object.hasOwn(raw, "updated") ? { updated: raw.updated as string } : {}),
      tags: raw.tags as readonly string[],
      ...(Object.hasOwn(raw, "aliases")
        ? { aliases: raw.aliases as readonly string[] }
        : {}),
      summary: raw.summary as string,
      stage: raw.stage as NoteStage,
      author: raw.author as NoteAuthor,
      reviewed: raw.reviewed as string | null,
      ...(Object.hasOwn(raw, "occurrences")
        ? { occurrences: raw.occurrences as number }
        : {}),
      ...(Object.hasOwn(raw, "sources")
        ? { sources: raw.sources as readonly string[] }
        : {}),
    },
    issues,
    unknownKeys,
  };
}

export function parseNote(source: string): NoteParseResult {
  const match = FRONTMATTER.exec(source);
  if (match === null) {
    return {
      ok: false,
      issues: [issue(null, "malformed", "the note has no frontmatter block")],
    };
  }

  const frontmatterText = match[1] ?? "";
  const body = match[2] ?? "";
  const header = source.slice(0, source.length - body.length);

  let raw: unknown;
  try {
    /**
     * `parseAllDocuments` with `logLevel: "silent"`, and errors inspected by hand.
     * Both halves are load-bearing and they pull against each other:
     *
     * - The default log level prints warnings — an unresolved `!!tag`, a
     *   stringified collection key — to stderr *with the offending source line*,
     *   which would spray note content past every redaction seam the moment
     *   `brain lint` walks a vault.
     * - But `parse()` decides whether to *throw* on a syntax error by checking
     *   that same log level, so silencing it turns malformed YAML into a partial
     *   value instead of a refusal. A test caught exactly that: `a: [1, 2` began
     *   parsing as a mapping rather than failing.
     *
     * Reading the errors directly gets the refusal without the channel that leaks.
     *
     * `parseAllDocuments`, not `parseDocument`: a `...` end marker inside the
     * block starts a second YAML document, which `parseDocument` returns with
     * *no error* while silently discarding everything after it. A note could
     * therefore carry a second frontmatter block that the validator never saw —
     * an unsupported `schemaVersion`, an unvalidated date, and unknown keys that
     * were never reported. The bytes survived; only the checks were blind.
     */
    const documents = parseAllDocuments(frontmatterText, FRONTMATTER_PARSE_OPTIONS);
    const document = documents[0];

    if (documents.length > 1 || (document?.errors.length ?? 0) > 0) {
      return {
        ok: false,
        issues: [
          issue(
            null,
            "malformed",
            "the frontmatter is not valid YAML",
            positionOf(document?.errors[0]),
          ),
        ],
      };
    }

    /**
     * `maxAliasCount` is the library's own default, pinned explicitly so a future
     * change to that default cannot quietly remove the only resource-exhaustion
     * bound in this parser. An alias bomb makes `toJS` throw, which the surrounding
     * `catch` turns into a refusal.
     */
    raw =
      document === undefined
        ? null
        : (document.toJS({ maxAliasCount: 100 }) as unknown);
  } catch (error: unknown) {
    return {
      ok: false,
      issues: [
        issue(null, "malformed", "the frontmatter is not valid YAML", positionOf(error)),
      ],
    };
  }

  /**
   * An empty block is an empty mapping, not a malformed one. Reporting the nine
   * keys it is missing tells the user what to write; "not a mapping" does not.
   */
  const mapping = raw === null || raw === undefined ? {} : raw;

  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    return {
      ok: false,
      issues: [issue(null, "malformed", "the frontmatter is not a mapping")],
    };
  }

  const validated = validate(mapping as Record<string, unknown>);
  if (validated.frontmatter === null) {
    return { ok: false, issues: validated.issues };
  }

  return {
    ok: true,
    note: {
      frontmatter: validated.frontmatter,
      unknownKeys: validated.unknownKeys,
      frontmatterText,
      header,
      body,
    },
    issues: validated.issues,
  };
}

/**
 * Concatenates the two raw slices the parser kept, so the output equals the
 * input for every note that parsed — line endings, BOM, fence whitespace and
 * all. Nothing is re-serialized from the parsed object, which is the only way
 * key order, comments, quoting style and unknown keys survive a read-write
 * cycle: design spec §12 promises the vault stays ordinary Markdown a user owns.
 *
 * The parameter is narrowed to the two fields actually read. Accepting a whole
 * `ParsedNote` invited a caller to edit `frontmatter` and expect the change to
 * come out the other side, which it never would — a silently lost write.
 * Editing frontmatter needs a patch function, and it belongs to the task that
 * first needs one.
 */
export function renderNote(note: Pick<ParsedNote, "header" | "body">): string {
  return `${note.header}${note.body}`;
}
