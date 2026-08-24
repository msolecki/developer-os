import { compareCanonical } from "../discovery/index.js";
import { screenControlCharacters } from "../redact.js";
import type { IndexDocumentV1, IndexedNote } from "./build.js";

/** Brain architecture former §6: the map shows what changed lately, not the whole vault. */
export const RECENT_CHANGES_LIMIT = 15;

/**
 * Every interpolated value passes through here first, and it is a security
 * boundary rather than a formatting nicety.
 *
 * The product design spec's §14.1 classifies vault files as untrusted data. A
 * title or summary carrying a newline would start a fresh line in the artifact,
 * and a note could then write `generatedAt: <sentinel>` into the rendered
 * output — Brain architecture former §6.3's drift canonicalizer replaces only the *first*
 * occurrence, so the note would pin the sentinel and make every later edit
 * invisible to `index-drift`.
 *
 * U+2028 and U+2029 are included because they are line terminators to a
 * JavaScript reader even where they are not to a Markdown one, and the artifact
 * is read by both.
 */
const ENCODER = new TextEncoder();

/**
 * What a link destination percent-encodes. Three additions to the class the
 * screens use, each for its own reason, and the same U+200D exemption.
 *
 * **`%` itself, or the encoding is not reversible.** It is the escape character,
 * so leaving it out is not "one case missed" — it breaks the round trip for
 * ordinary paths while the exotic ones work. A note at `100%.md` produced a
 * destination `decodeURIComponent` throws on; `50%20off.md` decoded to
 * `50 off.md`, a different file; and `ev<U+202E>il.md` and the literal
 * `ev%E2%80%AEil.md` produced *the same* destination, so one row in the catalog
 * opened the other note. Encoded, `%` becomes `%25` and the map is injective
 * again, because `%` is then the only introducer and it escapes itself.
 *
 * **U+2028 and U+2029**, which are `\p{Zl}` and `\p{Zp}` and therefore in
 * neither `\p{Cc}` nor `\p{Cf}`. The deleted `oneLine` covered them and its
 * reason went with it: they are line terminators to a JavaScript reader even
 * where they are not to a Markdown one, and this artifact is read by both.
 * Without them a `\n` in a filename was encoded and a U+2028 was not.
 *
 * **The invariant is that the encoder never sees its own output.** Encoding and
 * the `\`/`<`/`>` escaping cannot feed each other — the encoder emits only `%`
 * and hex, the escaping emits only `\` — so their order does not matter. One
 * `.replace` is the simplest way to satisfy it, since a single pass does not
 * rescan what it wrote. Splitting the class into two passes is safe only if `%`
 * goes first; doing the controls first turns `over<U+202E>ridden.md` into
 * `over%25E2%2580%25AEridden.md`, which decodes to a path that does not exist.
 * Both variants were measured — the safe ordering survives the suite and the
 * unsafe one does not — so this paragraph is a description, not a hope.
 */
const DESTINATION_UNSAFE = /(?!\u200D)[\p{Cc}\p{Cf}\u2028\u2029%]/gu;

/**
 * `oneLine` used to live here and both its callers outgrew it. Display text now
 * goes through `screenControlCharacters`, which subsumes it — `\r` and `\n` are
 * C0 and become spaces, U+2028 and U+2029 fall to the whitespace collapse — and
 * a link destination percent-encodes instead, because turning a newline inside a
 * filename into a space produced a link to a different file.
 */

/**
 * Neutralises every construct that turns text into structure. `note.ts`
 * validates a tag or a summary for type and length only, so both are arbitrary
 * user strings that land in a file the user later opens in Obsidian:
 *
 * - `[` and `]` would otherwise let a tag render as a live clickable link to an
 *   attacker-chosen URL, in the user's own vault. That is the whole of the
 *   attack: the vault is shared, an agent writes a note, the link looks native.
 * - `<` would otherwise pass raw HTML through — `<img src=x onerror=…>`.
 * - A backtick would otherwise close a code span this renderer opened, or open
 *   one it did not.
 * - Backslash is escaped first, or every escape below could be re-opened by a
 *   value that legitimately ends in one.
 *
 * **And the screen from `../redact.js` runs first**, because escaping structure
 * is not the same as screening characters and this file had only the former.
 * A note titled with a trailing U+202E put a RIGHT-TO-LEFT OVERRIDE into
 * `catalog.md`, which reorders the rest of the line for everyone who opens the
 * vault in Obsidian — the same defect this product screens for at a terminal,
 * on the one surface that is not a terminal. It survived two review rounds as
 * "outside a redaction layer aimed at terminals and logs", which was true and
 * was the problem: an artifact the user opens is exactly where the rule should
 * have applied first.
 *
 * `linkTarget` deliberately does **not** get this treatment. A destination is a
 * path, and a path is an identifier that has to resolve to the note it names;
 * screening one produces a link to nothing.
 */
function inlineText(value: string): string {
  const escaped = screenControlCharacters(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("<", "\\<");
  return escapeLeadingBlock(escaped);
}

/**
 * The escapes above neutralise *inline* constructs. A value that reaches the
 * start of a line can still forge a *block*: `# Pwned` becomes a heading in the
 * user's vault map, `> x` a blockquote, `- x` a list, `1. x` an ordered list.
 *
 * The digit case escapes the delimiter rather than the digit, because a
 * backslash before a digit is a literal backslash in CommonMark, not an escape.
 * Every other character here is ASCII punctuation, where `\\x` is a valid escape
 * that renders as the bare character.
 */
const ORDERED_MARKER = /^(\d{1,9})([.)])/u;
const BLOCK_MARKER = /^[#>\-+*=~]/u;

function escapeLeadingBlock(value: string): string {
  const ordered = ORDERED_MARKER.exec(value);
  if (ordered !== null) {
    return `${ordered[1] ?? ""}\\${ordered[2] ?? ""}${value.slice(ordered[0].length)}`;
  }
  return BLOCK_MARKER.test(value) ? `\\${value}` : value;
}

/**
 * A cell may not contain an unescaped `|`: a folder named `A|B` or a tag `a|b`
 * would otherwise add a phantom column and silently corrupt every row below it.
 */
function cell(value: string): string {
  return inlineText(value).replaceAll("|", "\\|");
}

/**
 * Angle-bracket form, because a vault path may legally contain spaces and
 * parentheses and the bare form would end the destination at the first one.
 * `<` and `>` are legal in a macOS filename, so they are escaped rather than
 * assumed absent. Not `inlineText`: inside a destination, `[` and a backtick
 * are ordinary characters and escaping them would corrupt the path.
 *
 * **A control or format character is percent-encoded, not deleted and not
 * spaced.** This is the third position on a question the rest of the renderer
 * answers twice, and it exists because both of the other answers are wrong
 * here. Deleting the character yields a link to a file that does not exist —
 * macOS permits any byte but `/` and NUL in a filename, so `ev<U+202E>il.md`
 * is a path a note can really live at. Leaving it raw puts a RIGHT-TO-LEFT
 * OVERRIDE into `catalog.md`, which is the defect screening `inlineText` was
 * meant to close: the *link text* was screened while the *destination* on the
 * same line still reordered it. Percent-encoding is the mechanism a URI has
 * for exactly this — carrying a byte that cannot appear literally — and it is
 * how a path with spaces already survives.
 *
 * **Unverified against Obsidian.** CommonMark percent-decodes a destination,
 * and that is checked; whether Obsidian's resolver does the same for a local
 * vault path is not, because this repository has no Obsidian to ask. If it
 * turns out not to, the fallback is to refuse such a path at lint time rather
 * than to go back to emitting the raw byte. Recorded rather than assumed.
 *
 * U+200D stays literal, like everywhere else.
 *
 * `oneLine` is gone from this path deliberately: it turned a newline inside a
 * filename into a space, which silently produced a link to a different file.
 * Encoding preserves it.
 */
function percentEncode(character: string): string {
  return [...ENCODER.encode(character)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

function linkTarget(path: string): string {
  const escaped = path
    .replace(DESTINATION_UNSAFE, percentEncode)
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>");
  return `<${escaped}>`;
}

function link(note: IndexedNote): string {
  return `[${inlineText(note.title)}](${linkTarget(note.path)})`;
}

/**
 * `generatedAt` first, on its own line, per Brain architecture former §6.1(1) and because §6.3's
 * canonicalizer matches it anchored at a line start. Nothing else here is
 * time-derived.
 */
function frontmatter(index: IndexDocumentV1): string {
  return `---\ngeneratedAt: ${index.generatedAt}\nschemaVersion: ${String(index.schemaVersion)}\n---\n`;
}

/**
 * `updated ?? created` descending, then path ascending — both content, never
 * `mtime`. A renderer that sorted by filesystem time would produce a different
 * map on every fresh checkout of an unchanged vault.
 */
function byRecency(a: IndexedNote, b: IndexedNote): number {
  const left = a.updated ?? a.created;
  const right = b.updated ?? b.created;
  if (left !== right) return left < right ? 1 : -1;
  return compareCanonical(a.path, b.path);
}

/** A vault with one note should not read "1 notes". */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function renderVaultMap(index: IndexDocumentV1): string {
  const lines: string[] = [frontmatter(index), "# Vault map", ""];

  /**
   * Plain escaped text, not a code span, and `inlineText` rather than `cell`
   * because this line is prose and has no columns to protect.
   *
   * The span this replaces is the same defect the tag cloud below records: a
   * backslash is literal inside a code span, so `inlineText`'s `\`` does not
   * escape the backtick — it closes the span the renderer opened and hands the
   * rest of the line to Markdown. `pathSegmentSchema` accepts a backtick, and
   * the user writes `contentRoot` themselves in `config.toml`, so the value can
   * really carry one. The lesson was written one screen down and not applied
   * here.
   */
  lines.push(
    `${plural(index.notes.length, "note")} in ${plural(index.folders.length, "folder")} under ${inlineText(index.contentRoot)}.`,
    "",
    "## Folders",
    "",
    "| Folder | Notes | Types | Top tags |",
    "| --- | ---: | --- | --- |",
  );

  for (const folder of index.folders) {
    const types = folder.types
      .map((entry) => `${entry.type}(${String(entry.count)})`)
      .join(", ");
    lines.push(
      `| ${cell(folder.name)} | ${String(folder.noteCount)} | ${cell(types)} | ${cell(folder.topTags.join(", "))} |`,
    );
  }

  lines.push("", "## Tags", "");
  /**
   * Rendered as a list item so the line begins with bytes this renderer chose.
   * Removing the code span that used to wrap each tag was right — escapes do
   * not work inside one, so it could not be made safe against a backtick — but
   * the span was also guaranteeing a safe line *prefix*, and losing that let a
   * tag named `generatedAt:` put a second `^generatedAt:` line in the artifact,
   * which Brain architecture former §6.1(1) forbids outright. Both jobs have to be done.
   */
  lines.push(
    index.tags.length === 0
      ? "No tags."
      : index.tags
          /**
           * Plain escaped text rather than a code span. A tag containing a
           * backtick would close a span this renderer opened, and escapes do
           * not work inside one — so the span cannot be made safe, only removed.
           */
          .map((tag) => `${inlineText(tag.tag)} (${String(tag.count)})`)
          .join(" · ")
          .replace(/^/u, "- "),
  );

  lines.push("", "## Recent changes", "");
  const recent = [...index.notes].sort(byRecency).slice(0, RECENT_CHANGES_LIMIT);
  if (recent.length === 0) {
    lines.push("No notes.");
  } else {
    for (const note of recent) {
      lines.push(`- ${note.updated ?? note.created} — ${link(note)}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function catalogEntry(note: IndexedNote): string {
  const summary = inlineText(note.summary);
  return summary.length === 0
    ? `- ${link(note)}`
    : `- ${link(note)} — ${summary}`;
}

export function renderCatalog(index: IndexDocumentV1): string {
  const lines: string[] = [frontmatter(index), "# Catalog", ""];

  if (index.folders.length === 0 && index.notes.length === 0) {
    lines.push("No folders.");
  }

  const listed = new Set<string>();
  for (const folder of index.folders) {
    lines.push(`## ${cell(folder.name)}`, "");
    /**
     * `index.notes` is already totally ordered by path, and filtering preserves
     * order, so no second sort is needed — or possible to get wrong.
     */
    for (const note of index.notes) {
      if (note.topicFolder !== folder.name) continue;
      listed.add(note.path);
      lines.push(catalogEntry(note));
    }
    lines.push("");
  }

  /**
   * A note whose `topicFolder` has no entry in `index.folders` would otherwise
   * vanish from the human-facing view while sitting in the index — the reader
   * sees a shorter catalog and nothing says why. `buildIndex` derives folders
   * from the notes so it cannot happen through the pipeline, but this function
   * is exported and takes any document, including a hand-built or migrated one.
   */
  const unlisted = index.notes.filter((note) => !listed.has(note.path));
  if (unlisted.length > 0) {
    lines.push("## Notes with no folder section", "");
    for (const note of unlisted) lines.push(catalogEntry(note));
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
