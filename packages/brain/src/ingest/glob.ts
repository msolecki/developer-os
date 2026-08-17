/**
 * The glob matcher `write-scope` consults the `ingest` workflow's declared write
 * scopes with, extracted from `validate.ts` so it can be pinned directly rather
 * than only through the nine validators — every glob the validator suite feeds
 * it is `content/**`, `content/_indexes/**` or `content/QA/**`, which leaves the
 * escape branch and the star loop unexercised.
 *
 * **This is a second glob dialect and the divergence is deliberate.**
 * `resolveScopeGlob` escapes its output for picomatch, which reads `?`, `[…]`,
 * `{…}` and a leading `!` as operators; this matcher reads all four as ordinary
 * characters and implements only `*`, `**` and the backslash escape. That is
 * safe in the one direction that matters — a pattern this function
 * under-matches refuses paths a real glob would accept, never the reverse, and
 * this is a gate — and every glob it is fed today is built from the literals
 * `content` and `_indexes` plus an escaped configured root. `glob.test.ts` pins
 * the divergence so a future pattern using one of those operators fails a test
 * instead of quietly matching nothing.
 *
 * Not picomatch itself, because `packages/brain` ships with `yaml` as its only
 * third-party dependency and a glob library is a large surface to add for three
 * patterns.
 */

type GlobPart =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "star" };

/**
 * `\` escapes the next character to a literal, because `resolveScopeGlob`
 * escapes the ten glob metacharacters when it splices a configured root into a
 * vocabulary glob — a `contentRoot` of `!inbox` arrives here as `\!inbox` and
 * has to match the one directory it names. A root can never contain a backslash
 * itself: `pathSegmentViolation` refuses one unconditionally as a separator.
 */
function parseGlobSegment(segment: string): readonly GlobPart[] {
  const parts: GlobPart[] = [];
  let text = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "\\" && index + 1 < segment.length) {
      text += segment[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (character !== "*") {
      text += character ?? "";
      continue;
    }
    if (text.length > 0) {
      parts.push({ kind: "text", value: text });
      text = "";
    }
    if (parts[parts.length - 1]?.kind !== "star") parts.push({ kind: "star" });
  }
  if (text.length > 0) parts.push({ kind: "text", value: text });
  return parts;
}

/**
 * Memoized on the visited `(part, offset)` pairs rather than backtracked
 * freely. A glob is not user input here — it comes from this product's own
 * vocabulary — but a matcher whose cost is exponential in the number of stars
 * is a hazard nobody has to accept for twelve lines.
 */
function segmentMatches(parts: readonly GlobPart[], value: string): boolean {
  const visited = new Set<number>();
  const walk = (partIndex: number, offset: number): boolean => {
    const key = partIndex * (value.length + 1) + offset;
    if (visited.has(key)) return false;
    visited.add(key);

    const part = parts[partIndex];
    if (part === undefined) return offset === value.length;
    if (part.kind === "text") {
      return (
        value.startsWith(part.value, offset) &&
        walk(partIndex + 1, offset + part.value.length)
      );
    }
    for (let next = offset; next <= value.length; next += 1) {
      if (walk(partIndex + 1, next)) return true;
    }
    return false;
  };
  return walk(0, 0);
}

/**
 * `**` spans zero or more whole segments; `*` never crosses a `/`.
 *
 * A trailing `**` therefore matches the root itself — `content/**` matches
 * `content` — which is what a scope naming a directory means, and is why the
 * empty path is the one thing it does not match.
 */
export function globMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  const visited = new Set<number>();

  const walk = (patternIndex: number, pathIndex: number): boolean => {
    const key = patternIndex * (pathSegments.length + 1) + pathIndex;
    if (visited.has(key)) return false;
    visited.add(key);

    const segment = patternSegments[patternIndex];
    if (segment === undefined) return pathIndex === pathSegments.length;
    if (segment === "**") {
      for (let next = pathIndex; next <= pathSegments.length; next += 1) {
        if (walk(patternIndex + 1, next)) return true;
      }
      return false;
    }

    const value = pathSegments[pathIndex];
    if (value === undefined) return false;
    return (
      segmentMatches(parseGlobSegment(segment), value) &&
      walk(patternIndex + 1, pathIndex + 1)
    );
  };

  return walk(0, 0);
}
