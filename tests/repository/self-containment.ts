/**
 * The self-containment rule, mechanically.
 *
 * Program Task 0 froze everything this build needs into `docs/migration/`. No
 * task may read the founder's legacy repositories, and a missing legacy fact is
 * a gap in the frozen material or in the design spec — never a reason to reach
 * for a real machine. That rule has been prose since 2026-07-21, and prose does
 * not stop a fixture builder from adding one convenient `readFile`.
 *
 * This is a lint rule, not a sandbox. It refuses the obvious spellings so that
 * crossing the boundary has to be deliberate and visible in a diff; it cannot
 * stop someone determined to obfuscate a path, and it is not trying to.
 */

export interface Violation {
  readonly path: string;
  readonly line: number;
  readonly match: string;
}

interface ForbiddenPattern {
  readonly label: string;
  readonly expression: RegExp;
}

/**
 * Deliberately narrow. The product's own vocabulary is full of the word
 * "brain" — `brainPath`, `DeveloperBrain`, `DEVELOPER_OS_BRAIN`,
 * `proposedBrainRoot` — so only a *home-relative* vault path counts. A rule that
 * fired on `brainPath` would be suppressed within a day, and a suppressed rule
 * enforces nothing.
 *
 * `DEVELOPER_OS_SOURCE_` keeps its trailing underscore for the same reason: the
 * retired variables were `DEVELOPER_OS_SOURCE_REPO` and
 * `DEVELOPER_OS_SOURCE_BRAIN`, and matching the bare prefix would catch
 * unrelated identifiers that merely start the same way.
 */
const FORBIDDEN: readonly ForbiddenPattern[] = [
  { label: "claude-shared", expression: /claude-shared/giu },
  /**
   * The tilde form is the one that appears in prose — and *only* in prose, since
   * `~` does not expand inside a JavaScript string, JSON, or most YAML. Catching
   * it alone would have meant catching the spelling nobody can actually use and
   * missing every spelling that works, which inverts the rule's purpose.
   */
  {
    label: "~/brain",
    expression: /(?:~|\$HOME|\$\{HOME\})\/+brain\b/giu,
  },
  /** The absolute form, which is what someone writes when `~` does not resolve. */
  {
    label: "/Users/…/brain",
    expression: /\/Users\/[^/\s"'`]+\/+brain\b/giu,
  },
  /**
   * And the form a program writes: the vault joined onto the user's home. Scoped
   * to a `brain` path segment in the vicinity of a home lookup, so the product's
   * own `brainPath`, `DeveloperBrain`, and `proposedBrainRoot` stay clear.
   */
  {
    label: "homedir() + brain",
    expression:
      /(?:homedir\(\)|userHome|\bhome\b)[^\n]{0,40}["'`]\/?brain["'`/]/giu,
  },
  { label: "DEVELOPER_OS_SOURCE_", expression: /DEVELOPER_OS_SOURCE_/giu },
];

/**
 * Every location allowed to name the legacy runtime. Each one is prose *about*
 * the boundary; anything outside is code or a fixture reaching for a real
 * machine, which is the case worth failing on.
 *
 * Two entries are here for reasons the backlog did not anticipate, and both are
 * recorded rather than quietly assumed:
 *
 * - `SESSION.md` states the rule itself, so the check would otherwise fail on
 *   the document that defines it.
 * - the program plan and the design spec were meant to be allowed only in their
 *   *cutover* sections. In practice both discuss the boundary throughout — scope,
 *   non-goals, migration sources, the vault the founder may keep using — so a
 *   section-scoped allowlist would flag legitimate prose and would depend on
 *   heading names nobody has agreed to freeze. They are allowed whole, and the
 *   narrower rule is left to review.
 */
export const ALLOWLIST: readonly string[] = [
  "docs/migration/",
  "docs/superpowers/plans/legacy-runtime/",
  "docs/superpowers/BACKLOG.md",
  "docs/superpowers/ORDER.md",
  "docs/superpowers/SESSION.md",
  "docs/superpowers/plans/2026-07-21-developer-os-program.md",
  "docs/superpowers/specs/2026-07-21-developer-os-design.md",
  /**
   * These two cannot express the rule without containing the strings it forbids.
   * `check.ts` is deliberately *not* here: it contains none of them, and
   * exempting the file that decides which files get scanned would be the worst
   * possible place to have a blind spot.
   *
   * Nothing pre-exempts a future `README.md` or `CLAUDE.md`. One quoting the rule
   * will fail lint, and adding it here should be a deliberate line in a diff
   * rather than a hole left open in advance.
   */
  "tests/repository/self-containment.ts",
  "tests/repository/self-containment.test.ts",
];

/**
 * Directory entries end in `/` and match by prefix; file entries match exactly.
 * The distinction matters: a bare prefix test would accept
 * `docs/migration-notes.md` because it starts with `docs/migration`.
 */
export function isAllowed(path: string): boolean {
  return ALLOWLIST.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );
}

export function findViolations(
  path: string,
  content: string,
): readonly Violation[] {
  if (isAllowed(path)) return [];

  const located: { readonly violation: Violation; readonly column: number }[] =
    [];

  content.split("\n").forEach((text, index) => {
    for (const pattern of FORBIDDEN) {
      // `matchAll` needs the global flag and a fresh cursor per line.
      pattern.expression.lastIndex = 0;
      for (const match of text.matchAll(pattern.expression)) {
        located.push({
          violation: { path, line: index + 1, match: pattern.label },
          column: match.index,
        });
      }
    }
  });

  /**
   * Sorted by position, not by pattern, so a line naming two of them reads left
   * to right — which is how the reader will scan for them in the file.
   */
  return located
    .sort(
      (left, right) =>
        left.violation.line - right.violation.line || left.column - right.column,
    )
    .map((entry) => entry.violation);
}

export function describeViolation(violation: Violation): string {
  return `${violation.path}:${String(violation.line)}: references ${violation.match}`;
}

/**
 * A NUL byte is the cheapest reliable signal that a file is not text, and a
 * binary file cannot carry a legible path for a human to have written. Escaped
 * rather than embedded literally: a raw NUL in a source file survives round
 * trips badly and is invisible in every editor.
 */
export function isProbablyText(content: string): boolean {
  return !content.includes("\0");
}
