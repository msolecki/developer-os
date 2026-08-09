/**
 * Unicode-aware, so a Polish or Greek note tokenizes like an English one. A
 * `\w`-based split would treat every accented letter as a separator and shatter
 * `zażółć` into five tokens.
 */
const SEPARATOR = /[^\p{L}\p{N}]+/u;

/**
 * Stated non-goal: no stemming (spec §8). `cache` does not match `caching`.
 * Every stemmer worth having is either a large dependency or a rule set wrong
 * often enough to make results unexplainable, and tags and aliases are the
 * documented mitigation.
 */
export function tokenize(text: string): readonly string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(SEPARATOR)
    .filter((token) => token.length > 0);
}
