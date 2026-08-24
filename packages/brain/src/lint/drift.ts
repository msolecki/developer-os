export const GENERATED_AT_SENTINEL = "1970-01-01T00:00:00.000Z";

const JSON_GENERATED_AT = /^(\s*"generatedAt":\s*)"[^"]*"/mu;
const MARKDOWN_GENERATED_AT = /^(generatedAt:\s*)\S+$/mu;

/**
 * Drift compares canonical form, not bytes. `generatedAt` moves on every build,
 * so a byte comparison would report drift one second after a clean reindex and
 * never stop — and a permanently-red check is one people learn to ignore.
 * Everything else is still compared byte for byte, which is why this replaces
 * the value textually instead of parsing and re-serializing: re-serializing
 * would mask a formatting difference that is real drift.
 *
 * Both patterns are non-global on purpose. Exactly one line per artifact may be
 * rewritten; a second `generatedAt:` line anywhere would mean untrusted note
 * content had reached the start of a line, which the renderer's escaping and
 * the serializer's fixed key order are what prevent.
 */
export function canonicalizeArtifact(text: string): string {
  return text
    .replace(JSON_GENERATED_AT, `$1"${GENERATED_AT_SENTINEL}"`)
    .replace(MARKDOWN_GENERATED_AT, `$1${GENERATED_AT_SENTINEL}`);
}

/**
 * The first line that differs, as a 1-based number, or `null` when the two are
 * identical. Brain architecture former §6.3: `index-drift` reports the artifact and the first
 * differing line, never a whole-file diff — a diff of a 5,000-line `index.json`
 * is not a message anybody reads, and it would echo note content into a
 * terminal and a log.
 *
 * One case reports a line past the end of both files: when the only difference
 * is a trailing newline, `"a\n"` against `"a"` returns 2 for a file an editor
 * shows as one line. That is deliberate — the alternative is reporting no
 * difference at all, and a stripped final newline is exactly what an editor or
 * a "fix end of files" hook does, so it must not lint clean.
 */
export function firstDifferingLine(
  expected: string,
  actual: string,
): number | null {
  if (expected === actual) return null;

  const left = expected.split("\n");
  const right = actual.split("\n");
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) return i + 1;
  }
  return shared + 1;
}
