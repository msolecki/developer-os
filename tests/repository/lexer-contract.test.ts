import { describe, expect, it } from "vitest";

import {
  codeWithoutLiterals,
  scanRegions,
  stringLiterals,
} from "../helpers/typescript-lexer.js";

/**
 * **The shapes that defeated four hand-written scanners, kept as the contract.**
 *
 * `tests/helpers/typescript-lexer.ts` asks the TypeScript compiler now, so none of these
 * can regress by the mechanism that produced them — but they are the record of what the
 * gates standing on it have to survive, and the first thing to run if anyone is ever
 * tempted to hand-roll it again. Each line here cost a review round.
 *
 * There is no oracle test any more: the previous version diffed a hand-written scanner
 * against the compiler over every tracked file, and with the scanner gone it would be
 * diffing the compiler against itself.
 */
function commentTexts(source: string): readonly string[] {
  return scanRegions(source)
    .filter((region) => region.kind !== "string")
    .map((region) => region.text);
}

describe("the lexer survives every shape that broke a hand-written one", () => {
  it.each([
    /** A comment-opener inside a string literal is not a comment. */
    ["a glob in a string", 'const scope = "content/**";\n/** real */'],
    /** A regex holding quotes does not open a string. */
    ["quotes inside a regex", 'const q = /["\']/u;\n/** real */'],
    /** A regex holding a comment-opener does not open a comment. */
    ["a comment-opener inside a regex class", "const r = /[/*]/u;\n/** real */"],
    /** The same regex in statement position, where `/` follows `}`. */
    ["a regex after a block", 'function f() {}\n/["\']/u.test(s);\n/** real */'],
    ["a comment-opener in a regex after a block", "function f() {}\n/[/*]/u.test(s);\n/** real */"],
    /** Division after a value is not a regex. */
    ["division after a brace", "const x = {a:1}/2; /** real */"],
    ["division after a paren", "const x = (1+2)/2; /** real */"],
    ["division after an index", "const x = a[0]/2; /** real */"],
    /** A template nested inside an interpolation does not invert backtick parity. */
    ["a nested template", "const t = `a${fn(`b/${c}/d`)}e`;\n/** real */"],
    ["a backtick inside an interpolation", 'const t = `a${x("`")}b`;\n/** real */'],
  ])("finds the real comment past %s", (_name, source) => {
    expect(commentTexts(source)).toStrictEqual(["/** real */"]);
  });

  /**
   * **A comment inside `${…}` is a comment**, and the last hand-written version consumed a
   * `//` there as a regex — after which an apostrophe in the comment's prose opened a
   * string that ran to the next quote and both gates went blind for the rest of the file.
   */
  it("sees a line comment inside an interpolation, apostrophe and all", () => {
    const source = "const t = `a${ // don't\n  x}b`;\nconst s = 'ok';\n/** real */";

    expect(commentTexts(source)).toStrictEqual(["// don't", "/** real */"]);
  });

  /**
   * **A comment before a closing brace, which is where a case actually gets commented out.**
   *
   * `commentRanges` walks `getChildren` rather than `forEachChild` precisely for this: the
   * trivia hangs off tokens, and `forEachChild` does not visit tokens, so the last member of
   * a `describe` block commented out immediately before its `});` is invisible to it. That
   * choice was load-bearing and **nothing pinned it** — swapping the walk left every test in
   * this file green — while the neighbouring docblock argues for `forEachChild` on cost
   * grounds, which is an invitation to make exactly that change.
   */
  it.each([
    ["before a closing brace", 'function f() {\n  // it("x", () => {});\n}'],
    ["as the last member of a block", 'describe("s", () => {\n  it("a", () => {});\n  // it("b", () => {});\n});'],
    ["inside an empty block", 'function f() {\n  /* it("x", () => {}); */\n}'],
    ["before a class closing brace", 'class C {\n  m() {}\n  // it("x", () => {});\n}'],
  ])("finds a comment %s", (_name, source) => {
    expect(commentTexts(source)).toHaveLength(1);
  });

  /**
   * **A phantom comment is the direction that silently disables a gate.** A scanner that
   * *invents* one blanks live code in `failure-data-entry` and reddens a clean file in
   * `live-tests`, and the sweep that checked the old scanner only looked for comments it
   * had lost.
   */
  it("invents no comment where the source has none", () => {
    expect(commentTexts('const r = /[/*]/u;\nit("a real case", () => {});')).toStrictEqual(
      [],
    );
  });
});

describe("template literals", () => {
  /**
   * **Pinned because dropping `TemplateHead` from the literal walk left every other case
   * green.** A template's head, middles and tail are three separate literals to the parser,
   * and a caller blanking literals has to lose all three or none.
   */
  it("blanks every part of a template, not only its tail", () => {
    const blanked = codeWithoutLiterals("const t = `head${x}middle${y}tail`;");

    expect(blanked).not.toContain("head");
    expect(blanked).not.toContain("middle");
    expect(blanked).not.toContain("tail");
    /**
     * **The interpolated expressions stay, and so does every brace.** A `TemplateHead`'s
     * span ends with its `${`, so blanking `[start + 1, end - 1)` takes the `$` and leaves
     * the `{` — measured, not assumed. That is what a bracket-counting caller needs: the
     * `{` of every interpolation and the `}` that closes it both survive.
     */
    expect(blanked).toContain("{x}");
    expect(blanked).toContain("{y}");
    expect((blanked.match(/[{]/gu) ?? []).length).toBe(2);
    expect((blanked.match(/[}]/gu) ?? []).length).toBe(2);
  });
});

describe("codeWithoutLiterals", () => {
  /**
   * **Regex bodies are blanked too.** The hand-written version consumed a regex without
   * recording it, so its bytes survived — and `m.replace(/\)/u, "")` inside a `failure(`
   * literal closed a bracket-counting caller's scan early.
   */
  it("blanks a regex body, so a bracket inside one cannot mislead a count", () => {
    const source = 'const x = m.replace(/\\)/u, "");';
    const blanked = codeWithoutLiterals(source);

    expect(blanked).not.toContain("\\)");
    expect(blanked).toHaveLength(source.length);
    /**
     * **What a regex actually blanks to**, measured — because the docblock describing it
     * was wrong twice, in both directions. The span is `[start + 1, end - 1)` and a regex's
     * `end` is past its flags, so the closing slash goes and the last flag stays.
     */
    expect(codeWithoutLiterals("const a = /ab/;")).toBe("const a = /  /;");
    expect(codeWithoutLiterals("const a = /ab/u;")).toBe("const a = /   u;");
  });

  it("blanks a comment whole and a literal's body only", () => {
    const blanked = codeWithoutLiterals('/* gone */ const a = "body";');

    expect(blanked).not.toContain("gone");
    expect(blanked).not.toContain("body");
    /**
     * The delimiters stay and offsets are preserved, so a bracket count still sees a
     * balanced literal and a position from `stringLiterals` still lines up.
     */
    expect(blanked).toContain('"    "');
    expect(blanked).toHaveLength('/* gone */ const a = "body";'.length);
  });
});

describe("stringLiterals", () => {
  it("reports each literal's cooked value and position", () => {
    const [first] = stringLiterals('const a = "data";');

    expect(first?.value).toBe("data");
    expect(first?.start).toBe(10);
  });

  /** An escape is the parser's problem, and a `slice(1, -1)` got it wrong. */
  it("reads an escaped key as the character it denotes", () => {
    const [first] = stringLiterals('const a = "dat\\u0061";');

    expect(first?.value).toBe("data");
  });
});
