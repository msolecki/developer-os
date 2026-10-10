/**
 * The slug's own sentinel, deliberately **not** `UNKNOWN`. A working directory
 * whose basename carries no letter or digit is a nameless directory, not a
 * failed detection, and writing `projectSlug: unknown` beside
 * `sourceAgent: unknown` would invite a reader to conclude that something went
 * wrong when nothing did.
 */
const UNNAMED_PROJECT = "unnamed";

/**
 * Long enough to stay human-readable, short enough that a pathological
 * directory name cannot dominate the frontmatter block a reviewer reads.
 */
const MAX_PROJECT_SLUG_LENGTH = 64;

/**
 * Everything that is not a letter, a digit or a combining mark becomes one separator, in any
 * script: the slug is human-readable by design (design spec §13.1), so a
 * project named `Zeitplan Änderung` keeps its letters rather than being
 * transliterated into something its owner would not recognise.
 *
 * It can therefore carry a client name, which is acceptable because the vault
 * is local and private — and it is screened on the way into the envelope like
 * every other interpolated string in this product: `buildCapture` applies
 * `screenEnvelopeScalar` to it regardless of what arrives here.
 *
 * **Combining marks belong to the word they sit in** (AUD-052): a vowel sign
 * or tone mark is `\p{M}`, not `\p{L}`, and treating it as a separator split
 * `प्रोजेक्ट` into `प-र-ज-क-ट`. Lowercased before NFC, because `toLowerCase` can
 * itself emit a combining mark (`İ` becomes `i` plus U+0307).
 *
 * **The bound counts code points, not UTF-16 units** (AUD-053), so an astral
 * character at the boundary is kept or dropped whole and never leaves a lone
 * surrogate in the frontmatter. Grapheme-safe truncation is still a decision
 * for the whole branch, not for one command's slug.
 *
 * **Sliced before it is trimmed, not after.** Trimming first left the slice
 * free to cut through a separator run and end the slug on a hyphen, so a
 * basename over the bound produced `long-project-name-` — a trailing separator
 * that says a word was removed rather than that the name was too long. One
 * trim, after the cut, is correct in both directions.
 */
export function slugify(value: string): string {
  const folded = value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-");
  const slug = Array.from(folded)
    .slice(0, MAX_PROJECT_SLUG_LENGTH)
    .join("")
    .replace(/^-+|-+$/gu, "");

  return slug.length === 0 ? UNNAMED_PROJECT : slug;
}
