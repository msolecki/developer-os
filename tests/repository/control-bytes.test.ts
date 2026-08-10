import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * A literal control byte in a source file is invisible in a diff, in a review,
 * and in a terminal. This repository has shipped one twice: a NUL used as a
 * group-key separator in `lint.ts`, and a character class in `redact.ts` typed
 * as the characters it was meant to match instead of as escapes. Both times it
 * was caught by accident.
 *
 * The rule is not "no control characters in the product" — it is "none written
 * literally into source". `\u0000` as six ASCII characters is reviewable;
 * the byte is not.
 */
const TEXT_EXTENSIONS: readonly string[] = [
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".toml", ".yaml", ".yml",
];

/**
 * `\n` and `\t` are how text files are shaped. Everything else in C0, DEL, the
 * C1 range, and `\p{Cf}` — which carries U+202E RIGHT-TO-LEFT OVERRIDE, the
 * Trojan Source character (CVE-2021-42574), and U+200B ZERO WIDTH SPACE — is a
 * byte a human reading the file cannot see.
 */
// eslint-disable-next-line no-control-regex -- the pattern is what finds them
const FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}]/u;

/**
 * Declared without `g` and given it here. A `g`-flagged regex carries a mutable
 * `lastIndex`, so a shared one makes `.test()` answer differently depending on
 * what was tested before it — the kind of bug a gate cannot afford.
 */
function everyOccurrence(): RegExp {
  return new RegExp(FORBIDDEN.source, "gu");
}

async function repositoryFiles(): Promise<{
  readonly root: string;
  readonly paths: readonly string[];
}> {
  const { stdout: top } = await runProcess("git", ["rev-parse", "--show-toplevel"]);
  const root = top.trim();
  const list = async (args: readonly string[]): Promise<readonly string[]> => {
    const { stdout } = await runProcess("git", [...args], {
      cwd: root,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout.split("\0").filter((path) => path.length > 0);
  };

  /**
   * Untracked-but-not-ignored as well as tracked, for the same reason
   * `check.ts` includes them: the gate runs before `git add`, which is exactly
   * when a newly written offending file exists and has never been staged.
   */
  const [tracked, untracked] = await Promise.all([
    list(["ls-files", "-z"]),
    list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return { root, paths: [...new Set([...tracked, ...untracked])].sort() };
}

describe("source files carry no literal control characters", () => {
  it("scans every text file in the repository and finds none", async () => {
    const { root, paths } = await repositoryFiles();
    const scanned: string[] = [];
    const offenders: string[] = [];
    const unreadable: string[] = [];

    for (const path of paths) {
      /** Lower-cased: `README.MD` and `Foo.TS` are the same files to this rule. */
      const extension = extname(path).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(extension)) continue;
      let content: string;
      try {
        content = await readFile(join(root, path), "utf8");
      } catch (error: unknown) {
        /**
         * Indexed but deleted from the working tree, or a submodule directory
         * entry — nothing to read, and not this rule's business.
         *
         * Anything else is a file the rule was supposed to read and could not,
         * which must fail. `check.ts` already had this exact distinction and
         * this gate's first version did not: it caught every error and
         * `continue`d, so an unreadable file passed silently.
         */
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : null;
        if (code === "ENOENT" || code === "EISDIR") continue;
        unreadable.push(path);
        continue;
      }
      scanned.push(extension);

      const hits = [...content.matchAll(everyOccurrence())];
      if (hits.length === 0) continue;
      const line = content.slice(0, hits[0]?.index ?? 0).split("\n").length;
      const code = (hits[0]?.[0] ?? "").codePointAt(0) ?? 0;
      offenders.push(
        `${path}:${String(line)} holds U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
      );
    }

    /**
     * A sweep that scans nothing passes, so the floors are part of the gate.
     * They are stated per extension rather than as one total: a global count
     * is satisfied by whichever extension happens to be numerous, so dropping
     * `.ts` from the list could still clear a total floor on the strength of
     * the Markdown alone. These are the two that carry the product.
     */
    const counts = new Map<string, number>();
    for (const extension of scanned) {
      counts.set(extension, (counts.get(extension) ?? 0) + 1);
    }
    expect(counts.get(".ts") ?? 0).toBeGreaterThan(50);
    expect(counts.get(".md") ?? 0).toBeGreaterThan(20);
    expect(counts.get(".json") ?? 0).toBeGreaterThan(5);

    expect(unreadable).toStrictEqual([]);
    expect(offenders).toStrictEqual([]);
  });
});

describe("the pattern this gate is built on", () => {
  /**
   * The sweep above passes because the repository is clean, which means it
   * would pass just as happily with a pattern that finds almost nothing —
   * narrowing `FORBIDDEN` to NUL alone leaves the whole suite green, since no
   * file here carries U+202E. So the pattern is tested against synthetic
   * strings, the way `self-containment.ts` tests its own rule.
   */
  it("finds every class of invisible character it claims to", () => {
    const caught = (value: string): boolean => FORBIDDEN.test(value);

    expect(caught("a\u0000b")).toBe(true);
    expect(caught("a\u0001b")).toBe(true);
    expect(caught("a\u001Bb")).toBe(true);
    expect(caught("a\u007Fb")).toBe(true);
    expect(caught("a\u0085b")).toBe(true);
    expect(caught("a\u009Fb")).toBe(true);
    expect(caught("a\u202Eb")).toBe(true);
    expect(caught("a\u200Bb")).toBe(true);
    expect(caught("a\u200Db")).toBe(true);
    expect(caught("a\uFEFFb")).toBe(true);
  });

  it("leaves the two characters a text file is made of", () => {
    /**
     * `\n` and `\t` are exempt or the rule refuses every file in the
     * repository. `\r` is not: a CRLF checkout would fail this gate, which is
     * the correct answer on a repository that stores LF.
     */
    expect(FORBIDDEN.test("a\nb\tc")).toBe(false);
    expect(FORBIDDEN.test("a\rb")).toBe(true);
    expect(FORBIDDEN.test("zażółć gęślą jaźń")).toBe(false);
    expect(FORBIDDEN.test("emoji 🏴 and 😀")).toBe(false);
  });
});
