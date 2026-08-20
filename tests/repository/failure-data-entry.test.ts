import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * **The type is what keeps `CliError.data` redacted; this sweeps the one hole a type cannot
 * close.**
 *
 * The slot is `RedactedPayload`, branded with a `unique symbol` that only
 * `packages/core/src/result.ts` can name, so `redactPayload` is its only producer and every
 * other way of writing the field is a compile error. That replaced a sweep which tried to
 * enumerate the syntax instead — and was falsified in five consecutive review rounds, by
 * four evasions, then seven, then a conditional spread, then five inline shapes, then five
 * more — never trending to zero. `CliResult` is a plain structural union, so the set of shapes
 * that can produce a failure arm is unbounded and no enumeration finishes.
 *
 * **What a brand cannot stop is a cast**, and that is what this sweeps for: `as
 * RedactedPayload`, or the `as unknown as` that reaches it the long way, anywhere outside
 * the module that defines the brand and the one that redacts. A cast is a single greppable
 * construct written on purpose, which is the shape a sweep is actually good at — unlike a
 * grammar, which is the shape it kept losing to.
 *
 * `tests/repository/redactor-entry.test.ts` is the precedent for the sweep half: one entry
 * point, enforced by a scan rather than by a convention.
 */
const SCOPES = [
  "apps/cli/src",
  "packages/adapter-claude/src",
  "packages/adapter-codex/src",
  "packages/brain/src",
  "packages/core/src",
  "packages/platform-macos/src",
  "packages/security/src",
  "packages/workflow-schema/src",
] as const;

/**
 * **Three entries, and each is reachable — which the previous allowlist was not.**
 *
 * `result.ts` declares the brand and performs the cast inside `redactPayload`; that is what
 * a producer *is*. `context.ts` calls it, and is the only place a redactor is in scope to
 * bind — `failureFrom` is where every command's diagnostic already passes through
 * `redactDiagnostic`, so it is where the payload passes through it too.
 *
 * The gate reports each file when its entry is removed, so all three are load-bearing
 * rather than sentences carried forward. The list this replaces held two entries, **neither** of
 * which was ever reached, and one of them switched the gate off inside the redaction module
 * — which is why "verified by emptying it" is now part of the procedure rather than a claim.
 */
const ALLOWED = [
  /** Where the brand is declared and the walk performed; `redactPayload` is the cast. */
  "packages/core/src/result.ts",
  /** The composition root, and the one place a redactor is in scope to bind. */
  "apps/cli/src/context.ts",
  /**
   * The package's public surface, which has to re-export the producer for the composition
   * root to import it. Re-exporting is otherwise the finding, because it widens where a
   * payload can be minted — that is how a review laundered the producer through a barrel.
   */
  "packages/core/src/index.ts",
] as const;

/** Tests may write whatever they like; this gate is about production wiring. */
const TEST_FILE = /\.test\.ts$/u;

/**
 * **Two constructs, both greppable, both deliberate: minting a payload, and forging one.**
 *
 * The type stops every *shape* — a raw object on a literal, hand-built, spread, IIFE'd,
 * bound to an identifier — because obtaining a `RedactedPayload` requires running the walk.
 * What a type cannot stop is a caller who runs the walk somewhere it should not be run, or
 * who asserts the brand without running it at all. Those are the two this sweeps.
 *
 * **`redactPayload` outside the composition root** is the first, and it is the hole that
 * made the brand's first version *weaker* than the sweep it replaced: the producer was a
 * bare cast on the public surface, so `data: redactPayload(secret)` compiled, linted and
 * swept clean while publishing a raw token. It takes a redactor now, but a caller can still
 * supply an identity function, so where it is called still matters.
 *
 * **A cast onto the brand** is the second. `as RedactedPayload`, `<RedactedPayload>x`, and
 * the `as unknown as` form a developer reaches for when the direct cast errors.
 *
 * **What this cannot see, measured:** the brand referred to through a type alias, a
 * `NonNullable<CliError["data"]>`, or a `ReturnType<typeof redactPayload>`. Resolving those
 * needs a type checker rather than a parse, and each is a second construct written to reach
 * a name the direct spelling already offers. Qualified (`core.RedactedPayload`) and aliased
 * (`import type { RedactedPayload as RP }`) forms *are* covered, because those are what a
 * namespace import and an ordinary rename produce.
 *
 * **And one thing is stopped by something outside this design, written down rather than
 * counted as covered:** `data: Object.freeze(JSON.parse(text))` typechecks into the branded
 * slot with no cast, no brand name and no producer call, because `any` is assignable to
 * anything. What refuses it is `@typescript-eslint/no-unsafe-assignment` from
 * `strictTypeChecked` — one `eslint-disable-next-line` away, with nothing else looking. The
 * value is still dropped at `failure`, where membership refuses it, so this is about the
 * account the design gives of itself rather than a live leak.
 *
 * **This sweep is belt-and-braces and should be read that way.** What holds the property is
 * `packages/core/src/result.ts`: membership at the publishing seam, membership for the
 * payload, and both arms frozen. Every round of review is the argument — each one
 * that answered a route by adding a *predicate* beside an identity check had that predicate
 * falsified in the next.
 */
function forgesRedactedPayload(source: string): boolean {
  const file = ts.createSourceFile("gate.ts", source, ts.ScriptTarget.Latest, true);
  const brandNames = new Set<string>(["RedactedPayload"]);
  const producerNames = new Set<string>(["redactPayload"]);

  /**
   * **Renames, from imports *and* exports.** A review reached the producer through
   * `export { redactPayload as reshape }` in one file and `import { reshape }` in another —
   * the rename map read import declarations only, so the alias never entered the set.
   */
  const collectRenames = (
    bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined,
  ): void => {
    if (bindings === undefined) return;
    if (!ts.isNamedImports(bindings) && !ts.isNamedExports(bindings)) return;
    for (const element of bindings.elements) {
      const original = element.propertyName?.text;
      if (original === "RedactedPayload") brandNames.add(element.name.text);
      if (original === "redactPayload") producerNames.add(element.name.text);
    }
  };

  /** The producer's name, however this file came to spell it. */
  const calleeName = (expression: ts.Expression): string | undefined => {
    /** `(redactPayload)(…)` is the same call, wearing parentheses. */
    let callee = expression;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    if (ts.isNonNullExpression(callee)) callee = callee.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    /**
     * **`core["redactPayload"]` is the same reach, spelled with a bracket** — the family
     * this closed two rounds ago for `core.redactPayload`, and `dot-notation` is in
     * `stylisticTypeChecked` rather than the config this repository runs, so nothing else
     * objects to it.
     */
    if (
      ts.isElementAccessExpression(callee) &&
      ts.isStringLiteralLike(callee.argumentExpression)
    ) {
      return callee.argumentExpression.text;
    }
    return undefined;
  };

  /**
   * **Re-exporting the producer is itself the finding**, not merely a rename to track. A
   * file that widens `redactPayload`'s reach has extended the set of places a payload can
   * be minted, and it does so without calling anything — which is how a review laundered it
   * through a barrel: `export { redactPayload as reshape }` in one file, `import { reshape }`
   * in another, both green.
   */
  let reExportsProducer = false;

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectRenames(statement.importClause?.namedBindings);
    }
    /**
     * `export const mint = redactPayload` widens its reach as surely as a re-export clause,
     * and neither this file nor the importing one caught it.
     */
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
    ) {
      for (const declaration of statement.declarationList.declarations) {
        const named =
          declaration.initializer === undefined
            ? undefined
            : calleeName(declaration.initializer);
        if (named !== undefined && producerNames.has(named)) reExportsProducer = true;
      }
    }
    /** `export default redactPayload` widens its reach exactly as a named re-export does. */
    if (ts.isExportAssignment(statement)) {
      const named = calleeName(statement.expression);
      if (named !== undefined && producerNames.has(named)) reExportsProducer = true;
    }
    if (ts.isExportDeclaration(statement)) {
      collectRenames(statement.exportClause);
      const clause = statement.exportClause;
      /**
       * **`export * from "@developer-os/core"` re-exports the producer with no clause at
       * all**, which is how the barrel-laundering came back after the named form closed.
       */
      if (clause === undefined && statement.moduleSpecifier !== undefined) {
        reExportsProducer = true;
      }
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const original = element.propertyName?.text ?? element.name.text;
          if (original === "redactPayload") reExportsProducer = true;
        }
      }
    }
  }
  if (reExportsProducer) return true;

  const namesBrand = (type: ts.TypeNode): boolean => {
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName;
      const leaf = ts.isQualifiedName(name) ? name.right.text : name.text;
      if (brandNames.has(leaf)) return true;
    }
    /**
     * **Every child, not only the ones that are type nodes.** `x as { data: RedactedPayload }`
     * hid the brand because a `TypeLiteralNode`'s children are `PropertySignature`s, which
     * are not type nodes — so the recursion stopped one level above the name it was looking
     * for, while `Record<string, RedactedPayload>` was caught.
     */
    let nested = false;
    ts.forEachChild(type, (child) => {
      if (ts.isTypeNode(child)) {
        if (namesBrand(child)) nested = true;
        return;
      }
      ts.forEachChild(child, (grandchild) => {
        if (ts.isTypeNode(grandchild) && namesBrand(grandchild)) nested = true;
      });
    });
    return nested;
  };


  /**
   * **A variable bound to the producer is the producer.** `const mint = core.redactPayload`
   * then `mint(r, s)` reached it past a check that read only the callee's own name.
   */
  const collectAliases = (node: ts.Node): void => {
    /** `mint = core.redactPayload` as an assignment, not a declaration. */
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const source = calleeName(node.right);
      if (source !== undefined && producerNames.has(source)) {
        producerNames.add(node.left.text);
      }
    }
    /** `const o = { mint: redactPayload }` then `o.mint(…)`. */
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const source = calleeName(node.initializer);
      if (source !== undefined && producerNames.has(source)) {
        producerNames.add(node.name.text);
      }
    }
    /** `const [mint] = [core.redactPayload]` — an array pattern is a binding too. */
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const [index, element] of node.name.elements.entries()) {
        const source = node.initializer.elements[index];
        const named = source === undefined ? undefined : calleeName(source);
        if (
          named !== undefined &&
          producerNames.has(named) &&
          ts.isBindingElement(element) &&
          ts.isIdentifier(element.name)
        ) {
          producerNames.add(element.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const source = calleeName(node.initializer);
      if (source !== undefined && producerNames.has(source) && ts.isIdentifier(node.name)) {
        producerNames.add(node.name.text);
      }
      /**
       * **`const { redactPayload: mint } = core` is the same rename, one syntax over** —
       * which is how the previous version was defeated after it closed the `const mint =
       * core.redactPayload` form.
       */
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const original = element.propertyName;
          const named =
            original !== undefined && ts.isIdentifier(original)
              ? original.text
              : ts.isIdentifier(element.name)
                ? element.name.text
                : undefined;
          if (named !== undefined && producerNames.has(named) && ts.isIdentifier(element.name)) {
            producerNames.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(file);

  /**
   * **Argument position, not "the parent is a call".** The exemption exists for
   * `handler(argument as never)`, the standard escape for calling a union of signatures —
   * and keying it on the parent's kind flagged `new Wrapper(x as never)`, a spread
   * `f(...(x as never))`, and a tagged template, none of which is different in kind.
   */
  const inArgumentPosition = (node: ts.Node): boolean => {
    /** Parentheses sit between an assertion and whatever it is an argument to. */
    let current: ts.Node = node;
    while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
    const parent = current.parent;
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      return parent.arguments?.includes(current as ts.Expression) ?? false;
    }
    /**
     * A spread or a template span, only where it is *itself* an argument — the previous
     * version exempted both unconditionally, so `[...(x as never)]` in an array literal was
     * exempt though it is not an argument position, which is what this function is named
     * for.
     */
    if (ts.isSpreadElement(parent)) return inArgumentPosition(parent);
    /**
     * A template span reaches its call through the template expression, so a tagged
     * template is argument position and a bare one is not.
     */
    if (ts.isTemplateSpan(parent)) {
      return ts.isTaggedTemplateExpression(parent.parent.parent);
    }
    return false;
  };

  const isNever = (type: ts.TypeNode): boolean => {
    let current = type;
    while (ts.isParenthesizedTypeNode(current)) current = current.type;
    return current.kind === ts.SyntaxKind.NeverKeyword;
  };

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (namesBrand(node.type)) found = true;
      /**
       * **`as never` reaches any slot without naming what it becomes** — `never` is
       * assignable to everything, so it is the one assertion that obtains the brand while
       * mentioning neither the brand nor the producer.
       *
       * **Banning the token outright failed a correct build**: `handler(argument as never)`
       * is the standard escape for calling a union of signatures, and the offender message
       * then advised routing an unrelated call through `failureFrom`. Nonsense advice on
       * clean code is what gets a gate deleted.
       *
       * **Narrowing it to `data:` reopened the route**, though, and by a one-token edit in
       * two directions: `const data = SECRET as never` hoists it out of the property, and
       * `data: (SECRET as never)` wraps it in parentheses. The axis was wrong — it narrowed
       * by syntactic position rather than by what the assertion is for. The rule is now the
       * complement of the false positive: an `as never` that is **not** a call argument has
       * no legitimate use, and every real one this repository has is exactly that.
       */
      /**
       * **`as (never)` is a `ParenthesizedType`, not a `NeverKeyword`** — one pair of
       * parentheses, and the rule that was rewritten to be "the complement of the false
       * positive" never fired at all. The type side has to unwrap exactly as the expression
       * side does.
       */
      if (isNever(node.type) && !inArgumentPosition(node)) found = true;
    }

    /**
     * **A type predicate or an `asserts` signature obtains the brand with no cast at all.**
     * `function isRedacted(v: unknown): v is RedactedPayload` narrows a raw value into the
     * slot, and a previous version of this gate had a `toBe(false)` case licensing exactly
     * that on the grounds that "naming the type is not asserting it". Naming it in a
     * *predicate* is asserting it.
     */
    if (ts.isTypePredicateNode(node) && node.type !== undefined && namesBrand(node.type)) {
      found = true;
    }

    /**
     * **An annotation naming the brand is an assertion too**, and it was the form left open
     * when the cast forms closed: `const revive: (t: string) => RedactedPayload = JSON.parse`
     * launders `any` into the slot without a cast expression anywhere. Receiving one as a
     * *parameter* is not minting it, which is why only declarations and return types count.
     */
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        /**
         * **The other two ways to write a return type**, left open when the first closed:
         * `const revive = (t: string): RedactedPayload => JSON.parse(t)` and the same as a
         * method. Closing one spelling and not its neighbour is the pattern the brand
         * existed to end.
         */
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isPropertyDeclaration(node)) &&
      node.type !== undefined &&
      namesBrand(node.type)
    ) {
      found = true;
    }

    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== undefined && producerNames.has(name)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

async function sourceFiles(): Promise<{
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
      .filter((path) => path.endsWith(".ts"))
      .sort(),
  };
}

describe("nothing forges a RedactedPayload", () => {
  it("finds no cast onto the brand outside the module that defines it", async () => {
    const { root, paths } = await sourceFiles();
    const offenders: string[] = [];
    const scanned = new Map<string, number>();

    for (const path of paths) {
      const scope = SCOPES.find((candidate) => path.startsWith(candidate));
      if (scope === undefined || TEST_FILE.test(path)) continue;
      scanned.set(scope, (scanned.get(scope) ?? 0) + 1);
      if ((ALLOWED as readonly string[]).includes(path)) continue;

      const source = await readFile(join(root, path), "utf8");
      if (forgesRedactedPayload(source)) {
        offenders.push(
          `${path} mints or forges a RedactedPayload; pass the value to failureFrom instead, which is where the redactor is bound`,
        );
      }
    }

    /** Per scope, so a sweep that enumerated nothing cannot pass. */
    for (const scope of SCOPES) {
      expect(scanned.get(scope) ?? 0, `${scope} enumerated no files`).toBeGreaterThan(0);
    }
    expect(offenders).toStrictEqual([]);
  });

  /**
   * **A package added tomorrow is in scope or the gate says so.**
   *
   * `SCOPES` is a hand-written snapshot, and the per-scope floor only catches a scope that
   * is renamed or emptied — a new `packages/rag/src` would simply never match `SCOPES.find`
   * and nothing would notice, while the docblock above claims "every package that can reach
   * `failure`". `failure` is exported from `@developer-os/core`, so that claim has to be
   * kept true by something rather than asserted.
   */
  it("has a scope for every workspace source directory", async () => {
    const { paths } = await sourceFiles();
    /**
     * Derived from the file list rather than from a `git ls-files` glob: a recursive glob
     * under `src` misses a package whose sources are flat, which is five of the seven here.
     */
    const directories = new Set(
      paths
        .filter((path) => /^(?:apps|packages)\/[^/]+\/src\//u.test(path))
        .map((path) => path.split("/").slice(0, 3).join("/")),
    );

    expect([...directories].sort()).toStrictEqual([...SCOPES].sort());
  });

  /**
   * The sweep above passes because the tree is clean, which means it would also pass if the
   * detector matched nothing. This is what makes it evidence.
   */
  it("detects a minted or forged payload when one exists", () => {
    /** Minting: calling the producer outside the composition root. */
    expect(forgesRedactedPayload("const d = redactPayload((t) => t, secret);")).toBe(true);
    expect(forgesRedactedPayload("const d = core.redactPayload(redact, secret);")).toBe(true);
    expect(
      forgesRedactedPayload(
        'import { redactPayload as mint } from "@developer-os/core";\nconst d = mint(r, s);',
      ),
    ).toBe(true);

    /** Forging: asserting the brand without running the walk. */
    expect(forgesRedactedPayload("const d = payload as RedactedPayload;")).toBe(true);
    expect(forgesRedactedPayload("const d = payload as unknown as RedactedPayload;")).toBe(
      true,
    );
    expect(forgesRedactedPayload("const d = <RedactedPayload>x;")).toBe(true);
    expect(forgesRedactedPayload("const d = x as Record<string, RedactedPayload>;")).toBe(
      true,
    );
    /** Through a namespace, and through an ordinary rename — both are covered. */
    expect(
      forgesRedactedPayload(
        'import type * as core from "@developer-os/core";\nconst d = x as core.RedactedPayload;',
      ),
    ).toBe(true);
    expect(
      forgesRedactedPayload(
        'import type { RedactedPayload as RP } from "@developer-os/core";\nconst d = x as RP;',
      ),
    ).toBe(true);

    /**
     * **Five constructs a review reached the brand with after the first version of this
     * gate**, each compiling, linting and sweeping clean while publishing a raw token.
     * Every one obtains the brand without redacting, which is the only thing that matters.
     */
    expect(forgesRedactedPayload("return failure(c, { kind, data: secret as never });")).toBe(
      true,
    );
    expect(
      forgesRedactedPayload("function isRedacted(v: unknown): v is RedactedPayload { … }"),
    ).toBe(true);
    expect(
      forgesRedactedPayload(
        "function assertRedacted(v: unknown): asserts v is RedactedPayload { … }",
      ),
    ).toBe(true);
    expect(
      forgesRedactedPayload("const mint = core.redactPayload;\nconst d = mint((t) => t, s);"),
    ).toBe(true);
    expect(
      forgesRedactedPayload('export { redactPayload as reshape } from "@developer-os/core";'),
    ).toBe(true);
    expect(
      forgesRedactedPayload(
        'import { reshape } from "./barrel.js";\nconst d = reshape((t) => t, s);',
      ),
    ).toBe(false);

    /**
     * **The two one-token edits that reopened `as never`** after it was narrowed to the
     * `data` property, and the two return-type spellings left open beside the one closed.
     */
    expect(forgesRedactedPayload("const data = SECRET as never;")).toBe(true);
    expect(
      forgesRedactedPayload("return failure(2, { kind, data: (SECRET as never) });"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("const revive = (t: string): RedactedPayload => JSON.parse(t);"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("class M { make(t: string): RedactedPayload { return p; } }"),
    ).toBe(true);

    /** An exported binding of the producer, and the brand inside an object type literal. */
    expect(forgesRedactedPayload("export const mint = redactPayload;")).toBe(true);
    expect(forgesRedactedPayload("const d = x as { data: RedactedPayload };")).toBe(true);

    /** Four alias forms a review reached the producer through after the first two closed. */
    expect(
      forgesRedactedPayload("let mint;\nmint = core.redactPayload;\nmint(r, s);"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("const [mint] = [core.redactPayload];\nmint(r, s);"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("const o = { mint: redactPayload };\no.mint(r, s);"),
    ).toBe(true);
    expect(forgesRedactedPayload("export default redactPayload;")).toBe(true);

    /** One pair of parentheses, on the type side and on the callee. */
    expect(
      forgesRedactedPayload("return failure(2, { kind, data: s as (never) });"),
    ).toBe(true);
    expect(forgesRedactedPayload("const d = (redactPayload)((t) => t, s);")).toBe(true);
    /** And a spread that is not an argument is not exempt. */
    expect(forgesRedactedPayload("const xs = [...(x as never)];")).toBe(true);

    /** Element access, and the fifth return-type spelling left open beside four closed. */
    expect(
      forgesRedactedPayload('const d = core["redactPayload"]((t) => t, s);'),
    ).toBe(true);
    expect(
      forgesRedactedPayload('const mint = core["redactPayload"];\nconst d = mint(r, s);'),
    ).toBe(true);
    expect(
      forgesRedactedPayload("class M { get p(): RedactedPayload { return q; } }"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("function f(): RedactedPayload { return q; }"),
    ).toBe(true);
    expect(
      forgesRedactedPayload("const f = function (): RedactedPayload { return q; };"),
    ).toBe(true);
    expect(forgesRedactedPayload("class M { p: RedactedPayload = q; }")).toBe(true);

    /** And the shapes the `as never` exemption must still cover, past its first axis. */
    expect(forgesRedactedPayload("const w = new Wrapper(x as never);")).toBe(false);
    expect(forgesRedactedPayload("handler(...(x as never));")).toBe(false);
    expect(forgesRedactedPayload("tag`${x as never}`;")).toBe(false);

    /** The two renames and the annotation a later review reached the producer through. */
    expect(
      forgesRedactedPayload("const { redactPayload: mint } = core;\nconst d = mint(r, s);"),
    ).toBe(true);
    expect(forgesRedactedPayload('export * from "@developer-os/core";')).toBe(true);
    expect(
      forgesRedactedPayload("const revive: (t: string) => RedactedPayload = JSON.parse;"),
    ).toBe(true);

    /**
     * **Two shapes the broadened rules must not fail a correct build on**, both found by a
     * review after the rules were called sufficient.
     */
    expect(
      forgesRedactedPayload("return handler(argument as never);"),
    ).toBe(false);
    expect(
      forgesRedactedPayload("function use(d: RedactedPayload): void { publish(d); }"),
    ).toBe(false);

    /** Naming the type is not asserting it, and receiving one is not minting it. */
    expect(
      forgesRedactedPayload('import type { RedactedPayload } from "@developer-os/core";'),
    ).toBe(false);
    expect(
      forgesRedactedPayload("function f(d: RedactedPayload): void { use(d); }"),
    ).toBe(false);
    expect(forgesRedactedPayload("return failure(c, { kind, message });")).toBe(false);
    /**
     * **A raw `data` on a literal needs no sweep at all**, which is what branding the slot
     * bought: it is a compile error in every shape five rounds of sweeping chased —
     * shorthand, `as CliError`, an IIFE, `Object.assign` onto a literal, a hand-built
     * `{ ok: false, error }` arm — for one reason instead of a rule each.
     */
    expect(forgesRedactedPayload("return failure(c, { kind, data: secret });")).toBe(false);

    /**
     * **The measured residuals**, pinned so a later reader knows they were tested rather
     * than overlooked. Each needs a second construct to reach a name the direct spelling
     * already offers, and closing one is a visible change to this list.
     */
    expect(forgesRedactedPayload("type P = RedactedPayload;\nconst d = x as P;")).toBe(false);
    expect(forgesRedactedPayload('const d = x as NonNullable<CliError["data"]>;')).toBe(
      false,
    );
    expect(forgesRedactedPayload("const d = x as ReturnType<typeof redactPayload>;")).toBe(
      false,
    );
  });
});
