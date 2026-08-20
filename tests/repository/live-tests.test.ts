import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { scanRegions } from "../helpers/typescript-lexer.js";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * **A test commented out is a test deleted, and nothing else notices.**
 *
 * On 2026-08-18 an edit to a docblock in `packages/core/src/result.test.ts` dropped its
 * terminator. The comment swallowed the `it(...)` below it, the file still compiled,
 * `npm run check` was still green at 2121 passed — and the case that pinned `CliError.data`
 * surviving `formatJsonResult` had silently stopped existing. It was found by a
 * fresh-context review reading the file, which is not a mechanism.
 *
 * **The count is not the signal.** A suite that loses one case still reports a number that
 * went up that week for other reasons, so "2121 passed" told nobody anything. What is
 * checkable is the shape: a `describe`, `it` or `test` call has no business inside a block
 * comment, and a docblock that has swallowed one is the only way it gets there.
 *
 * **Deliberately commented-out tests are refused too**, which is the point rather than a
 * side effect: a case worth keeping is worth `it.skip`, which the runner counts and reports.
 * A case not worth keeping should be deleted, and git remembers it.
 */
/**
 * **Both kinds of comment**, and the first version read only block comments while claiming
 * to refuse deliberately commented-out tests — which is usually `//`, because that is what
 * every editor's toggle-comment produces.
 *
 * **Comments are found by a shared lexer rather than by a pattern this file invents.** The
 * first version was a regex and reported six offenders in files that had none: a scope glob
 * this repository uses everywhere contains a comment-opener inside a string literal, so the
 * pattern opened a comment there and ran to the next terminator, swallowing whatever real
 * `it(` lay between. A gate that cries wolf on six files is one somebody deletes.
 *
 * Three hand-written scanners followed, each fixing the last one's blindness and adding its
 * own: no regex state, then a flat template scan that inverted backtick parity on a nested
 * template, then a `//` inside an interpolation read as a regex. All of them are one shape
 * — a lexical question answered without a lexer — and the answer is
 * `tests/helpers/typescript-lexer.ts`, which asks the TypeScript compiler.
 */
function commentedTestCalls(source: string): readonly { line: number }[] {
  return scanRegions(source)
    .filter((region) => region.kind !== "string")
    .filter((region) => TEST_CALL.test(region.text))
    .map((region) => ({ line: region.line }));
}

/**
 * A call at the start of a line, allowing `it.each`, `describe.skip`, and every comment
 * prefix an editor's toggle produces: `//`, `////`, a docblock's asterisk, and the
 * single-line block form that JetBrains' *Comment with Block Comment* and VS Code's
 * `Shift+Alt+A` emit — an opener, the call, and a closer on one line. The last was missing
 * while this file's docblock claimed deliberate comment-outs were refused.
 *
 * **The argument has to look like a test's, and requiring that is not pedantry.** Sweeping
 * every comment in this repository finds **53** that already begin a line with a bare `it`,
 * `test` or `describe`; they survive only because the next character is not `(`. One review
 * could not reproduce that count and it was briefly retracted here; a later one reproduced it
 * exactly, so the number stands and the retraction was the error. It is a property of the
 * current corpus rather than a constant, and the claim that carries weight either way is that
 * the population is large and ordinary prose. A
 * docblock sentence reading `* it (the redactor) rejects …` would have reddened a clean
 * file — the failure this file's own prose calls the one that gets a gate deleted. Every
 * real form opens its arguments with a string, a template or an array: `it("…")`,
 * `it.each([…])`, `` test.each`…` ``.
 */
const TEST_CALL =
  /^\s*(?:\/\/+|\/?\*+)?\s*(?:it|test|describe)(?:\.[A-Za-z]+)*\s*(?:\(\s*["'`[]|`)/mu;

async function testFiles(): Promise<{
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
  const [tracked, untracked] = await Promise.all([
    list(["ls-files", "-z"]),
    list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return {
    root,
    paths: [...new Set([...tracked, ...untracked])]
      .filter((path) => path.endsWith(".test.ts"))
      .sort(),
  };
}

describe("no test case is hidden inside a comment", () => {
  it("finds none, across every test file in the repository", async () => {
    const { root, paths } = await testFiles();
    const offenders: string[] = [];

    for (const path of paths) {
      const source = await readFile(join(root, path), "utf8");
      for (const comment of commentedTestCalls(source)) {
        offenders.push(
          `${path}:${String(comment.line)} a comment contains a test call — an unclosed docblock, or a case that should be it.skip or deleted`,
        );
      }
    }

    /**
     * **A floor on the corpus, not merely on "did anything run".** 50 caught "enumerated
     * nothing" and nothing else — the tree could lose more than half its suites and stay
     * green. 110 sits under today's 122 — about a tenth of headroom, which is deliberately
     * tight: this floor exists to notice a deletion, and one loose enough never to fire is
     * the same decoration in a different place. It is expected to be raised when the corpus
     * grows, in the commit that grows it.
     */
    expect(paths.length, "enumerated too few test files").toBeGreaterThan(110);
    expect(offenders).toStrictEqual([]);
  });

  /**
   * The sweep passes because the tree is clean, which means it would also pass if the
   * pattern matched nothing. This is what makes it evidence — and the first case here is
   * the exact byte sequence that caused the defect.
   */
  it("detects a swallowed case when one exists", () => {
    const hidden = (source: string): boolean => commentedTestCalls(source).length > 0;

    expect(
      hidden('/**\n * A docblock whose author forgot the terminator.\n  it("a", () => {});\n */'),
    ).toBe(true);
    expect(hidden('/*\n  it.each([1])("old case", () => {});\n*/')).toBe(true);

    /**
     * **Prose that merely mentions the words is not a call**, and 53 comments in this
     * repository already start a line with one of them. The discriminator is the argument:
     * a test opens with a string, a template or an array.
     */
    expect(hidden("/**\n * it (the redactor) rejects a bad key.\n */")).toBe(false);
    expect(hidden("/**\n * describe.only(x) is banned here.\n */")).toBe(false);
    expect(hidden("/**\n * test(input) returns a value.\n */")).toBe(false);
    /** But every real form still is one. */
    expect(hidden('/* it.each([1])("x", () => {}); */')).toBe(true);
    expect(hidden("/* test.each`a`(\"x\", () => {}); */")).toBe(true);
    /** Prose that merely mentions the words is not a call. */
    expect(hidden("/**\n * The it() below asserts nothing; describe how it behaves.\n */")).toBe(
      false,
    );
    /**
     * **A glob in a string literal does not open a comment**, which the first version got
     * wrong on six real files.
     */
    expect(hidden('const scope = "content/**";\nit("a real case", () => {});')).toBe(false);
    /**
     * **A test call inside a string literal is not a commented-out test.** The filter that
     * excludes string regions was unpinned: replacing it with `() => true` left every case
     * green, because nothing in the tree happens to contain one.
     */
    expect(hidden('const sample = `\nit("not a real case", () => {});\n`;')).toBe(false);
    /** `//` is the half the first version could not see, and the commoner one. */
    expect(hidden('// it("an old case", () => {});')).toBe(true);
    /** Every other prefix an editor's toggle emits, including the one-line block form. */
    expect(hidden('//// it("an old case", () => {});')).toBe(true);
    expect(hidden('/* it("an old case", () => {}); */')).toBe(true);
    expect(hidden('/** it("an old case", () => {}); */')).toBe(true);
    /**
     * **A regex literal is not a string and not a comment.** Both of these desynced the
     * hand-written scanner — the first into string mode for the rest of the file, which is
     * a gate that has silently stopped looking.
     */
    expect(hidden('const q = /["\']/u;\n/**\n  it("swallowed", () => {});\n */')).toBe(true);
    expect(hidden('const r = /[/*]/u;\nit("a real case", () => {});')).toBe(false);
  });
});
