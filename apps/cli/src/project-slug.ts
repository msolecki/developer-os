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
 * Everything that is not a letter or a digit becomes one separator, in any
 * script: the slug is human-readable by design (design spec §13.1), so a
 * project named `Zeitplan Änderung` keeps its letters rather than being
 * transliterated into something its owner would not recognise.
 *
 * It can therefore carry a client name, which is acceptable because the vault
 * is local and private — and it is screened on the way into the envelope like
 * every other interpolated string in this product: `buildCapture` applies
 * `screenEnvelopeScalar` to it regardless of what arrives here.
 *
 * **The "letters, digits and hyphens" that the fold produces is true of the
 * characters it keeps and not quite true of the string it returns.** `slice`
 * counts UTF-16 code units, so a basename made of astral characters — emoji,
 * or any script above the BMP — can be cut between a surrogate pair and leave
 * a lone surrogate at the end. It is written to the vault as such: neither
 * this fold nor `screenControlCharacters` treats an unpaired surrogate as a
 * character to remove. Recorded rather than fixed here, deliberately: the
 * exposure predates this bound (the slice only moved when the trim order was
 * corrected), and grapheme-safe truncation is a decision for the whole branch
 * rather than for one command's slug.
 *
 * **Sliced before it is trimmed, not after.** Trimming first left the slice
 * free to cut through a separator run and end the slug on a hyphen, so a
 * basename over the bound produced `long-project-name-` — a trailing separator
 * that says a word was removed rather than that the name was too long. One
 * trim, after the cut, is correct in both directions.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .slice(0, MAX_PROJECT_SLUG_LENGTH)
    .replace(/^-+|-+$/gu, "");

  return slug.length === 0 ? UNNAMED_PROJECT : slug;
}
