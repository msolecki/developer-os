/**
 * The one predicate for "is this string safe to join onto a real path", used
 * by both the config loader (`loader.ts`'s `pathSegmentSchema`, over
 * `contentRoot`, `indexesDir` and every `topicFolders` entry) and
 * `packages/workflow-schema`'s `resolveScopeGlob`, which splices `contentRoot`
 * and `indexesDir` into a glob before a handler checks a real file against it.
 *
 * It used to be two implementations: `loader.ts` had its own inline
 * `pathSegmentSchema` refinement, and `workflow-schema`'s first cut of this
 * task re-derived the same rule from `BrainConfigV1`'s docblock rather than
 * from this code, landing three of its four clauses and inverting the
 * separator check into "single segment" without ever finding the metacharacter
 * gap below. Two guards over one value that disagree is not defense in depth —
 * it means neither one is the authority a reviewer can point at. This module
 * is now that authority; both call sites import it.
 *
 * **Glob metacharacters are refused here, not only where the value becomes a
 * glob.** A `contentRoot` of a single asterisk is a valid path segment by
 * every rule above — no separator, no traversal, not empty, no NUL — and
 * `loader.ts`'s schema accepted it before this clause existed. Once
 * `workflow-schema`'s `resolveScopeGlob` substitutes it as the leading
 * segment of a two-star vocabulary glob, the result is a two-segment glob
 * whose first segment is a bare wildcard: it matches every sibling of the
 * vault root, not only the vault, so a real glob matcher resolves it against
 * transaction staging, `.git`, and anything else next to the vault directory.
 * The config loader has no concept of a glob and never will, but the same
 * string this schema accepts is the string `resolveScopeGlob` later treats as
 * one — so the rule belongs at the value's only validation point, not at each
 * place that happens to build a glob from it today. `topicFolders` gets the
 * same protection for the same reason: it is validated by the identical
 * schema, and nothing pins it to staying glob-free forever either.
 */
const GLOB_METACHARACTERS = /[*?[\]{}()!]/u;

/**
 * `null` means valid; a non-null return is a human-readable reason, so a
 * caller that wants a message (`RangeError`, a zod issue) does not have to
 * invent one and a caller that only wants a boolean can compare to `null`.
 */
export function pathSegmentViolation(value: string): string | null {
  if (value.length === 0) return "must not be empty";
  if (value.includes("\0")) return "must not contain a NUL byte";
  if (value.includes("/") || value.includes("\\")) {
    return "must be a single path segment, not a path";
  }
  if (value === "." || value === "..") {
    return "must not be a relative-directory segment";
  }
  if (GLOB_METACHARACTERS.test(value)) {
    return "must not contain a glob metacharacter (* ? [ ] { } ( ) !)";
  }
  return null;
}

export function isValidPathSegment(value: string): boolean {
  return pathSegmentViolation(value) === null;
}
