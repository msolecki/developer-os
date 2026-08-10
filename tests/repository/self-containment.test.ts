import { describe, expect, it } from "vitest";

import {
  ALLOWLIST,
  findViolations,
  isAllowed,
  isProbablyText,
} from "./self-containment.js";

describe("isAllowed", () => {
  it("permits the documents that exist to describe the boundary", () => {
    for (const path of [
      "docs/migration/baseline-capabilities.json",
      "docs/superpowers/plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md",
      "docs/superpowers/BACKLOG.md",
      "docs/superpowers/ORDER.md",
      "docs/superpowers/SESSION.md",
      "docs/superpowers/plans/2026-07-21-developer-os-program.md",
      "docs/superpowers/specs/2026-07-21-developer-os-design.md",
    ]) {
      expect(isAllowed(path), `${path} should be allowed`).toBe(true);
    }
  });

  it("refuses everything else, including plausible-looking neighbours", () => {
    for (const path of [
      "packages/core/src/config/paths.ts",
      "apps/cli/src/commands/init.ts",
      "tests/e2e/foundation.test.ts",
      "docs/architecture/foundation.md",
      "docs/superpowers/plans/2026-08-01-some-new-plan.md",
      "docs/superpowers/specs/2026-08-01-some-new-spec.md",
      "README.md",
    ]) {
      expect(isAllowed(path), `${path} should not be allowed`).toBe(false);
    }
  });

  /**
   * A prefix allowlist that forgot to anchor on the separator would accept
   * `docs/migration-notes.md` because it starts with `docs/migration`.
   */
  it("does not let a prefix match escape its directory", () => {
    expect(isAllowed("docs/migration-notes.md")).toBe(false);
    expect(isAllowed("docs/superpowers/plans/legacy-runtime-extra.md")).toBe(
      false,
    );
  });
});

describe("findViolations", () => {
  it("finds each forbidden reference with its line number", () => {
    const source = [
      "const a = 1;",
      'readFileSync("/Users/someone/claude-sh" + "ared/rules.md");',
      "const b = 2;",
      'const home = "~/brain/content";',
      "const c = process.env.DEVELOPER_OS_SOURCE_REPO;",
    ].join("\n");

    const found = findViolations("packages/core/src/thing.ts", source);

    expect(found.map((violation) => violation.line)).toStrictEqual([4, 5]);
    expect(found[0]?.match).toBe("~/brain");
    expect(found[1]?.match).toBe("DEVELOPER_OS_SOURCE_");
  });

  it("catches the legacy repository by name however it is addressed", () => {
    for (const line of [
      'import x from "~/claude-shared/rules/security.md";',
      "const p = '/Users/example/claude-shared';",
      "// see claude-shared for the original",
    ]) {
      expect(findViolations("apps/cli/src/x.ts", line)).toHaveLength(1);
    }
  });

  it("catches a home-relative vault path written the long way", () => {
    for (const line of [
      'const v = "$HOME/brain";',
      'const v = "${HOME}/brain/content";',
      'const v = "~/brain";',
    ]) {
      expect(findViolations("apps/cli/src/x.ts", line)).toHaveLength(1);
    }
  });

  /**
   * The product is full of the word "brain" — `brainPath`, `DeveloperBrain`,
   * `proposedBrainRoot`. A rule that fired on those would be turned off within
   * a day, which is the only way a lint rule truly fails.
   */
  it("ignores the product's own vocabulary", () => {
    for (const line of [
      'const brainPath = join(home, "DeveloperBrain");',
      "export function proposedBrainRoot(userHome: string): string {",
      "| `DEVELOPER_OS_BRAIN` | the vault the user named |",
      "the Brain is inspected, never repaired",
      "const DEVELOPER_OS_SOURCE = 1;",
    ]) {
      expect(findViolations("apps/cli/src/x.ts", line), line).toStrictEqual([]);
    }
  });

  it("reports every occurrence on one line, not just the first", () => {
    const found = findViolations(
      "apps/cli/src/x.ts",
      'copy("~/brain", "~/claude-shared");',
    );

    expect(found.map((violation) => violation.match)).toStrictEqual([
      "~/brain",
      "claude-shared",
    ]);
  });

  it("returns nothing for an allowlisted path even when it matches", () => {
    expect(
      findViolations("docs/superpowers/SESSION.md", "never read ~/brain"),
    ).toStrictEqual([]);
  });
});

describe("the allowlist itself", () => {
  it("names the checker's own sources, which necessarily contain the patterns", () => {
    expect(isAllowed("tests/repository/self-containment.ts")).toBe(true);
    expect(isAllowed("tests/repository/self-containment.test.ts")).toBe(true);
  });

  /**
   * Asserted exactly, not by length. Every entry is a permanent hole in the
   * rule, so widening it should be a line somebody has to write in a diff and
   * defend — not something a passing test count absorbs.
   */
  it("is exactly this, and grows only deliberately", () => {
    expect([...ALLOWLIST]).toStrictEqual([
      "docs/migration/",
      "docs/superpowers/plans/legacy-runtime/",
      "docs/superpowers/BACKLOG.md",
      "docs/superpowers/ORDER.md",
      "docs/superpowers/SESSION.md",
      "docs/superpowers/plans/2026-07-21-developer-os-program.md",
      "docs/superpowers/specs/2026-07-21-developer-os-design.md",
      "tests/repository/self-containment.ts",
      "tests/repository/self-containment.test.ts",
    ]);
  });

  it("does not exempt the module that decides what gets scanned", () => {
    expect(isAllowed("tests/repository/check.ts")).toBe(false);
  });
});

/**
 * The program plan and the design spec are allowed whole rather than only in
 * their cutover sections, because boundary prose runs through both. That is the
 * right call — a section-scoped rule would flag the single most load-bearing
 * statement of the boundary in the repository — but it leaves the two largest
 * *instruction* documents permanently unscanned, and they are what an agent
 * reads to decide what to do.
 *
 * A count baseline closes that without parsing headings: a new reference lands
 * as a failing test and has to be justified in the same diff. Foundation is
 * closed, so neither document is expected to move much; if one legitimately
 * gains or loses a mention, update the number here and say why in the commit.
 *
 * The program plan went 15 -> 12 on 2026-08-08, when its closed Tasks 0 and 1
 * were compressed to a status block and their step lists removed, then 12 -> 8
 * on 2026-08-10, when Track B closed: the cutover-preconditions pointer now
 * names `BACKLOG.md` §6 instead of a deleted checklist, and Task 8 no longer
 * says the legacy trees must be opened, because the reasons to open them are
 * discharged. Lowering an exact-equality baseline tightens this check rather
 * than relaxing it: those references are now *forbidden* to come back
 * unnoticed. Every survivor is boundary prose that has to be there — the
 * self-contained-execution constraint, and Task 8, which is the cutover itself.
 */
describe("references inside the wholly-allowed documents", () => {
  it("has not grown since the rule was written", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../", import.meta.url));

    const baseline: Readonly<Record<string, number>> = {
      "docs/superpowers/plans/2026-07-21-developer-os-program.md": 8,
      "docs/superpowers/specs/2026-07-21-developer-os-design.md": 12,
    };

    for (const [path, expected] of Object.entries(baseline)) {
      const content = await readFile(`${root}${path}`, "utf8");
      // Probed under a non-allowlisted name, so the rule reports rather than skips.
      const found = findViolations("probe.md", content);
      expect(found.length, `${path} changed its legacy-reference count`).toBe(
        expected,
      );
    }
  });
});

describe("isProbablyText", () => {
  it("accepts ordinary source, including every kind of whitespace", () => {
    expect(isProbablyText('const a = "x";\n\tif (a) {}\r\n')).toBe(true);
    expect(isProbablyText("")).toBe(true);
  });

  /**
   * The guard has to be a NUL test and nothing looser. An earlier draft tested
   * for a space, which would have skipped essentially every file in the
   * repository and made the whole rule pass by finding nothing.
   */
  it("rejects content carrying a NUL byte", () => {
    expect(isProbablyText(`PNG${String.fromCharCode(0)}\n`)).toBe(false);
  });
});
