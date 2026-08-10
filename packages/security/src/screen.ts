/**
 * The one place vault text is made safe to print.
 *
 * Three call sites needed this policy — `lint/lint.ts` for a finding's message,
 * `retrieval/search.ts` for a match's title and summary, and `schema/note.ts`
 * for a frontmatter key echoed back at its author. The first two each carried
 * their own copy, and `search.ts` recorded the rule that made this module:
 * *if a third site needs this, the three should become one helper rather than a
 * third copy.* A screen that exists three times is a screen that will be
 * corrected twice.
 *
 * The reason it is needed at all is that `note.ts` validates a title, a key and
 * a summary as *strings*, with no length bound and no character screen. Every
 * one of them is author-controlled and every one reaches a terminal, a log, or
 * a JSON consumer.
 */

/**
 * Two classes, two policies, because they fail differently.
 *
 * **C0, DEL and C1 become a space.** These are structural: `\r` returns the cursor to
 * column zero so a value overwrites the row above it, and an ANSI escape begins
 * `\u001B[`. Deleting them would silently join the text on either side into one
 * word, which changes what the value says.
 *
 * **Format characters are deleted.** They are invisible, so replacing one with a
 * space invents a visible artifact: a soft hyphen inside `co\u00ADop` is a hint
 * about where the word may break, and screening it to `co op` splits a word that
 * was never split. The one that matters is U+202E RIGHT-TO-LEFT OVERRIDE, which
 * reorders the remainder of a printed line (Trojan Source, CVE-2021-42574).
 * Neither class is matched by `\s`, so the whitespace collapse below cannot
 * reach them.
 *
 * **U+200D ZERO WIDTH JOINER is exempt from both.** It is a format character
 * that is *part of a grapheme cluster* rather than an attack on one: removing it
 * turns a family emoji into three separate people and a note title into
 * something its author did not write. It cannot reorder, hide or truncate a
 * line, which is what the rest of the class is here for. This was found by
 * review after the first version shredded every joined emoji it saw.
 *
 * The emoji tag block U+E0020–U+E007F is *not* exempt, and that is a considered
 * limit rather than an oversight: those characters are invisible on their own,
 * and stripping them degrades a subdivision flag to the black flag it is built
 * on — a visible, harmless loss, unlike splitting a cluster into pieces. A test
 * pins that behaviour so the next reader knows it was chosen.
 *
 * Both patterns are written as escapes, never as the characters themselves. A
 * literal control byte in a source file is invisible in every diff and every
 * review, and `tests/repository/control-bytes.test.ts` now fails the build over
 * one.
 */
/**
 * The lint rule below exists to catch a control character written into a
 * pattern by accident. Here the pattern is what finds them.
 */
// eslint-disable-next-line no-control-regex
const STRUCTURAL_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/gu;
const INVISIBLE_FORMAT = /(?!\u200D)\p{Cf}/gu;

/**
 * Segmented rather than sliced so a cap cannot split a grapheme cluster and
 * emit a lone surrogate or an orphaned combining mark.
 *
 * The locale is pinned to `en` and never taken from the environment. Grapheme
 * segmentation is locale-independent by specification, but the *implementation*
 * is not versionless: two machines on different ICU versions should not
 * disagree about the tail of a truncated message.
 */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Structural controls to a space, invisible format characters away, then collapse. */
export function screenControlCharacters(value: string): string {
  return value
    .replace(STRUCTURAL_CONTROLS, " ")
    .replace(INVISIBLE_FORMAT, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Cap at `maxGraphemes`, appending an ellipsis only when something was dropped.
 *
 * One segment past the bound is collected so that "the budget filled" can be
 * told apart from "the input ended". Testing `kept.length < maxGraphemes` was
 * the first version and it appended an ellipsis to any value whose grapheme
 * count landed *exactly* on the bound while its UTF-16 length exceeded it — so
 * three emoji capped at three came back as four characters claiming truncation
 * that never happened. ASCII never reaches that branch, which is why the first
 * round of tests missed it.
 *
 * The `length` fast path is exact rather than approximate: a string's UTF-16
 * length is never below its grapheme count, so `length <= max` proves the cap
 * cannot bite. It is an optimisation and nothing more — deleting it changes no
 * output, which is a claim a test pins.
 */
export function capGraphemes(value: string, maxGraphemes: number): string {
  if (value.length <= maxGraphemes) return value;

  const kept: string[] = [];
  for (const { segment } of GRAPHEMES.segment(value)) {
    if (kept.length > maxGraphemes) break;
    kept.push(segment);
  }
  return kept.length <= maxGraphemes
    ? value
    : `${kept.slice(0, maxGraphemes).join("")}…`;
}

/** Screen first, then cap — the order matters when a control character sits inside the bound. */
export function screenAndCap(value: string, maxGraphemes: number): string {
  return capGraphemes(screenControlCharacters(value), maxGraphemes);
}
