import ts from "typescript";

/**
 * **Lexical questions about TypeScript source, answered by the TypeScript compiler.**
 *
 * `live-tests.test.ts` needs to know where the comments are, so that no test call can hide
 * inside one. That is the only *gate* that calls this file — `failure-data-entry.test.ts` used this file
 * while it was matching text, and asks the parse tree directly now, which is what the last
 * review of it concluded a lexical helper was the wrong shape for.
 *
 * `codeWithoutLiterals` and `stringLiterals` have no caller outside `lexer-contract.test.ts`
 * and are kept deliberately: they are what a text-matching gate needs, and the alternative
 * is to delete them and hand-roll them again the next time one is written.
 *
 * **This was a hand-written scanner for four rounds of review, and it was wrong every
 * time.** A regex for comments, which opened one inside `"content/**"`. Four states with no
 * regex state, so `/["'`]/u` swallowed the rest of a file. Five states with a flat template
 * scan, which inverted backtick parity on a nested template and made fifty lines of a real
 * file invisible to both gates. Then, after that was fixed: a `//` inside `${…}` falling
 * into the regex branch, and a regex literal in statement position after `}` opening a
 * phantom comment that swallowed live code — a gate reporting a false offender on a clean
 * file, which is the failure that gets a gate deleted.
 *
 * **Five instances of one defect class is a signal about the approach, not the instances.**
 * The remaining surface was "all of JavaScript tokenization", the regression test for it was
 * itself half-blind, and each round added another paragraph arguing about which
 * approximations were acceptable — paragraphs that became their own defect source. The
 * compiler already does this exactly, ships in this repository's dependencies, and has no
 * approximations to argue about. Every question these gates ask is one `createSourceFile`
 * answers, so it answers them.
 *
 * **What is gone with the scanner:** `precededByValue` and its keyword list, the
 * interpolation depth stack, the escaped-newline line counting, the `Symbol.species` of
 * lexing edge cases — and `lexer-oracle.test.ts`, which existed to diff the scanner against
 * this and has nothing left to diff.
 */

export interface SourceRegion {
  readonly kind: "block-comment" | "line-comment" | "string";
  readonly text: string;
  /** 1-based line on which the region starts. */
  readonly line: number;
  /** Offset of the region's first character in the source. */
  readonly start: number;
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("gate.ts", source, ts.ScriptTarget.Latest, true);
}

/**
 * Every comment in the file, including ones attached to nothing.
 *
 * **Trivia is collected per token rather than per node**, because a comment before a
 * closing brace, inside an interpolation, or after the last statement belongs to no node's
 * leading trivia. `ts.forEachChild` walks nodes; this walks the token stream underneath it,
 * which is where the compiler actually records trivia — and it reaches the end-of-file
 * token, so a comment after the last statement needs no special case.
 */
function commentRanges(file: ts.SourceFile, source: string): readonly ts.CommentRange[] {
  const found = new Map<string, ts.CommentRange>();
  const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      found.set(`${String(range.pos)}:${String(range.end)}`, range);
    }
  };

  const visit = (node: ts.Node): void => {
    for (const child of node.getChildren(file)) {
      add(ts.getLeadingCommentRanges(source, child.pos));
      add(ts.getTrailingCommentRanges(source, child.end));
      visit(child);
    }
  };
  visit(file);

  return [...found.values()].sort((left, right) => left.pos - right.pos);
}

/**
 * Every string, template and regular-expression literal, as the parser sees them.
 *
 * A `TemplateExpression`'s head, middles and tail are separate literals with the
 * interpolations between them as ordinary expressions — which is the distinction four
 * hand-written versions failed to make, and which the parser makes for free.
 */
function literalNodes(file: ts.SourceFile): readonly ts.Node[] {
  const literals: ts.Node[] = [];
  /**
   * `forEachChild` alone: it already visits a `TemplateExpression`'s head and each
   * `TemplateSpan`'s literal, so a second pass over `getChildren` could not add a node it
   * missed — verified byte-identical over every tracked file — while forcing a full token
   * materialisation of the tree, which was two thirds of the walk's cost. (`getChildren`
   * *is* load-bearing in `commentRanges`, where the trivia hangs off tokens `forEachChild`
   * does not visit.)
   */
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isRegularExpressionLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      literals.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return literals;
}

/** Every comment and literal region, in source order. */
export function scanRegions(source: string): readonly SourceRegion[] {
  const file = parse(source);
  const regions: SourceRegion[] = [];

  for (const range of commentRanges(file, source)) {
    regions.push({
      kind:
        range.kind === ts.SyntaxKind.SingleLineCommentTrivia
          ? "line-comment"
          : "block-comment",
      text: source.slice(range.pos, range.end),
      line: file.getLineAndCharacterOfPosition(range.pos).line + 1,
      start: range.pos,
    });
  }

  for (const node of literalNodes(file)) {
    const start = node.getStart(file);
    regions.push({
      kind: "string",
      text: source.slice(start, node.getEnd()),
      line: file.getLineAndCharacterOfPosition(start).line + 1,
      start,
    });
  }

  return regions.sort((left, right) => left.start - right.start);
}

/**
 * The source with every comment blanked and every literal *body* blanked, offsets
 * preserved, so a caller can count brackets or search for an identifier without a `)`
 * inside `"sad :)"` or `/\)/u` closing its scan, and without the word `data:` inside a
 * message matching its pattern.
 *
 * **Regex literals are blanked too**, which the hand-written version could not do: it
 * consumed them without emitting a region, so their bytes survived and
 * `m.replace(/\)/u, "")` inside a `failure(` literal closed a caller's bracket count early.
 *
 * A text-matching caller that needs a quoted property key asks `stringLiterals` for it by
 * position, since that is a question about a literal rather than about the code around it.
 */
export function codeWithoutLiterals(source: string): string {
  const blanked = source.split("");
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < blanked.length; at += 1) {
      if (blanked[at] !== "\n") blanked[at] = " ";
    }
  };

  for (const region of scanRegions(source)) {
    const end = region.start + region.text.length;
    /**
     * A quoted or template literal keeps both delimiters, so a bracket count still sees
     * balanced quotes and a `${` boundary; a comment is blanked whole, delimiters and all,
     * because nothing about it is code.
     *
     * **A regular-expression literal does not keep both**, which a first version of this
     * paragraph got backwards in the other direction too. The blanked span is
     * `[start + 1, end - 1)`, and a regex's `end` is past its *flags* — so `/ab/` becomes
     * `/  /` and `/ab/u` becomes `/   u`, losing the closing slash and keeping the last
     * flag character. Measured rather than reasoned about, after the reasoning was wrong
     * twice. It is harmless for the one caller this file has, which reads only comments;
     * anything that re-lexes this string must lex the original instead.
     */
    if (region.kind === "string") blank(region.start + 1, end - 1);
    else blank(region.start, end);
  }
  return blanked.join("");
}

export interface StringLiteral {
  /** The literal's content, without its delimiters. */
  readonly value: string;
  /** Offset of the opening delimiter. */
  readonly start: number;
  /** Offset one past the closing delimiter. */
  readonly end: number;
}

/**
 * Every literal with its position, for callers that need the text rather than the shape.
 *
 * `value` is the parser's own cooked text where it has one, so `"data"` reads as `data` —
 * an escape a hand-rolled `slice(1, -1)` missed. **A regular-expression literal is the
 * exception**: its `text` is the whole `/…/flags`, delimiters included, because that is
 * what the parser stores and inventing a different convention for one node kind would be
 * the more surprising answer.
 */
export function stringLiterals(source: string): readonly StringLiteral[] {
  const file = parse(source);
  return literalNodes(file).map((node) => {
    const start = node.getStart(file);
    const end = node.getEnd();
    const cooked: unknown = (node as { text?: unknown }).text;
    return {
      value: typeof cooked === "string" ? cooked : source.slice(start + 1, end - 1),
      start,
      end,
    };
  });
}
