/**
 * The one predicate for "is this string safe to join onto a real path", used
 * by both the config loader (`loader.ts`'s `pathSegmentSchema`, over
 * `contentRoot`, `indexesDir`, every `topicFolders` entry, and every
 * `topicAliases` key and value) and `packages/workflow-schema`'s
 * `resolveScopeGlob`, which splices `contentRoot` and `indexesDir` into a
 * glob before a handler checks a real file against it.
 *
 * It used to be two implementations: `loader.ts` had its own inline
 * `pathSegmentSchema` refinement, and `workflow-schema`'s first cut of this
 * task re-derived the same rule from `BrainConfigV1`'s docblock rather than
 * from this code, landing three of its four clauses and inverting the
 * separator check into "single segment" without ever finding a genuine gap:
 * a bare glob metacharacter was a valid segment by every rule here and still
 * widened a glob it was later spliced into unescaped. Two guards over one
 * value that disagree is not defense in depth — it means neither one is the
 * authority a reviewer can point at. This module is now that authority; both
 * call sites import it.
 *
 * **Glob metacharacters are deliberately not refused here.** A prior version
 * of this file added a clause rejecting `* ? [ ] { } ( ) !` at this layer,
 * on the theory that the rule belongs at the value's one validation point.
 * Run against every real caller, that clause refuses ordinary directory
 * names: `!inbox` (the standard convention for sorting a folder to the top
 * of an alphabetical listing), `PROJECTS (2024)`, `[archive]`,
 * `notes{drafts}`. This schema governs `topicFolders` and `topicAliases`,
 * not only the two roots that end up in a glob, so the refusal was total —
 * `configSchema.parse` throws inside `loadConfig` for any vault already
 * using one of those names, the CLI cannot start, and `serializeConfig`
 * throws on the same value, so the file cannot be rewritten to fix it either.
 * A value is not unsafe for being *named* with a glob metacharacter; it is
 * unsafe only once it is spliced **unescaped** into a pattern. That splice
 * happens in exactly one place — `resolveScopeGlob`, over exactly the two
 * fields that ever become a glob — so that is where the metacharacter is
 * escaped, the same way a value going into a shell command or a SQL string
 * is escaped at the boundary rather than forbidden as a name everywhere it
 * might ever be typed.
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
  return null;
}
