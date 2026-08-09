import { compareCanonical } from "../discovery/index.js";
import type { IndexDocumentV1, IndexedNote } from "./build.js";

/** Spec §6: the map shows what changed lately, not the whole vault. */
export const RECENT_CHANGES_LIMIT = 15;

/**
 * Every interpolated value passes through here first, and it is a security
 * boundary rather than a formatting nicety.
 *
 * The product design spec's §14.1 classifies vault files as untrusted data. A
 * title or summary carrying a newline would start a fresh line in the artifact,
 * and a note could then write `generatedAt: <sentinel>` into the rendered
 * output — spec §6.3's drift canonicalizer replaces only the *first*
 * occurrence, so the note would pin the sentinel and make every later edit
 * invisible to `index-drift`.
 *
 * U+2028 and U+2029 are included because they are line terminators to a
 * JavaScript reader even where they are not to a Markdown one, and the artifact
 * is read by both.
 */
const LINE_BREAKS = /[\r\n\u2028\u2029]+/gu;

function oneLine(value: string): string {
  return value.replace(LINE_BREAKS, " ").trim();
}

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
 */
function inlineText(value: string): string {
  const escaped = oneLine(value)
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
 */
function linkTarget(path: string): string {
  const escaped = oneLine(path)
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>");
  return `<${escaped}>`;
}

function link(note: IndexedNote): string {
  return `[${inlineText(note.title)}](${linkTarget(note.path)})`;
}

/**
 * `generatedAt` first, on its own line, per spec §6.1(1) and because §6.3's
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

  lines.push(
    `${plural(index.notes.length, "note")} in ${plural(index.folders.length, "folder")} under \`${cell(index.contentRoot)}\`.`,
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
   * which spec §6.1(1) forbids outright. Both jobs have to be done.
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
