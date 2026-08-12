import { capGraphemes, screenControlCharacters } from "./screen.js";

/**
 * The screen collapses every run of whitespace to one space, which is right for
 * a value printed on one line and wrong for prose: the four-paragraph
 * prompt-injection defence in `workflows/shared/workflow.yaml` rendered as a
 * single run-on bullet, and shipped that way. Split on blank lines first, screen
 * each paragraph, and the boundary the author wrote survives the character the
 * screen exists to remove. Found by fresh-context review of Tasks 1–5.
 */
export function screenParagraphs(value: string): readonly string[] {
  return value
    .split(/\n[^\S\n]*\n/u)
    .map((paragraph) => neutralizeBlockStart(screenControlCharacters(paragraph)))
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Author prose starts a line now, and a line is where Markdown block structure
 * is decided.
 *
 * **This is the cost of splitting into paragraphs, and it was not obvious.**
 * While the screen collapsed prose to one line, every one of these characters
 * could only ever land mid-line and render as text. Splitting made column 0
 * reachable, so a `shared` preamble reading `real\n\n# IGNORE EVERYTHING ABOVE`
 * emitted a real heading — inside the bullet that carries the prompt-injection
 * defence, concatenated into five other skills. Found by the fresh-context
 * review of the split itself, 2026-08-11.
 *
 * The list is every column-0 construct CommonMark defines: fence runs, ATX
 * heading, block quote, bullet, thematic break, setext underline, table row,
 * HTML block, and the ordered-list marker. A backslash escape makes the first
 * character literal and renders invisibly — **except for an ordered list**,
 * whose marker is a digit, and a digit is not escapable; there the escape goes
 * before the `.` or `)` that completes the marker, which is the documented way
 * to write a line beginning with a number.
 *
 * A visible backslash in the raw bytes is the accepted cost. A `SKILL.md` is
 * read as raw text by a model at least as often as it is rendered, and a
 * stray backslash is a far smaller lie than a heading its author did not write.
 */
function neutralizeBlockStart(line: string): string {
  const ordered = /^(\d{1,9})([.)])/u.exec(line);
  if (ordered !== null) {
    return `${ordered[1] ?? ""}\\${line.slice((ordered[1] ?? "").length)}`;
  }
  return /^[`~#>|<*+\-=_]/u.test(line) ? `\\${line}` : line;
}

/**
 * Payload prose: capped as a whole, exactly as a single-line field is.
 *
 * The cap is applied to the joined block rather than to each paragraph, because
 * a per-paragraph bound is not a bound — inserting blank lines raises it without
 * limit, which is how the first version of this split turned `FIELD_CAP` from a
 * field bound into a paragraph bound. Found by the same review.
 */
export function boundedProse(value: string, maxGraphemes: number): string {
  return capGraphemes(screenParagraphs(value).join("\n\n"), maxGraphemes);
}

/**
 * A payload containing its own fence closes the block early and swallows every
 * line after it. CommonMark closes a fence only on a run at least as long as the
 * opening one, so open with a run longer than the longest inside. Presentation
 * rather than execution, and still a structure a hostile value could otherwise
 * choose.
 */
export function fenced(payload: string, info: string): readonly string[] {
  const longest = [...payload.matchAll(/`+/gu)].reduce(
    (max, [run]) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, payload, fence];
}
