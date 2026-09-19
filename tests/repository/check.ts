#!/usr/bin/env node

/**
 * Fails the lint gate on any reference to the founder's legacy runtime outside
 * the documents that exist to describe it, and on any filesystem identity
 * rendered through a JavaScript number. See `self-containment.ts` for the first
 * rule and why each of its allowlist entries is there.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { codeWithoutLiterals } from "../helpers/typescript-lexer.js";

import {
  describeViolation,
  findViolations,
  isProbablyText,
} from "./self-containment.js";
import type { Violation } from "./self-containment.js";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

async function git(
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await runProcess("git", [...args], {
    cwd,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return stdout;
}

/**
 * Asked of `git` rather than derived from this module's own location. The
 * previous version counted directories up from `tests/dist/repository/`, which
 * silently retargeted a parent directory whenever the build layout moved — and
 * a root one level too high still looks like a valid repository.
 */
async function repositoryRoot(): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
}

/**
 * Tracked files, plus untracked ones that `.gitignore` does not exclude.
 *
 * Tracked alone was wrong in the one case that matters: `git ls-files` reads the
 * index, so a newly written file is invisible until it is staged — and the
 * workflow runs lint *before* `git add`, which is exactly when a new violating
 * file exists and has never been staged. Including `--others
 * --exclude-standard` keeps the `.gitignore` agreement that made `git` the right
 * enumerator while closing that window.
 */
async function candidateFiles(root: string): Promise<readonly string[]> {
  const [tracked, untracked] = await Promise.all([
    git(["ls-files", "-z"], root),
    git(["ls-files", "--others", "--exclude-standard", "-z"], root),
  ]);

  return [
    ...new Set(
      `${tracked}${untracked}`.split("\0").filter((path) => path.length > 0),
    ),
  ].sort();
}

/**
 * Spec 1 §2.4: JavaScript safe integers are not a filesystem-identity encoding.
 * `lstat` without `{ bigint: true }` hands back `ino` as a number, and an APFS
 * inode exceeds 2^53 — `/tmp` measured 1152921500312571551 on 2026-09-18, where
 * the spacing between representable numbers is 128 — so rendering one through
 * `String(...)` collapses up to 128 distinct inodes onto one recorded identity.
 * Every identity is read from `{ bigint: true }` stats and rendered with
 * `.toString(10)`, which is exact at every magnitude.
 *
 * The spelling is banned rather than the lossy call, because `String(x.ino)`
 * reads identically whether `x` is `Stats` or `BigIntStats`: a reader cannot
 * tell a correct site from a broken one, and both encodings coexisted in shipped
 * code until D31 (2026-09-18).
 */
const IDENTITY_RENDERING = /\bString\(\s*[A-Za-z_$][A-Za-z0-9_$.?[\]]*\.(?:ino|dev)\s*\)/gu;

/**
 * No file is exempt, including the approved encoder in
 * `packages/core/src/lifecycle/guarded-fs.ts`: it renders through
 * `.toString(10)` and so has nothing to exempt, and the file that defines the
 * encoding is the worst possible place for this rule to be blind.
 *
 * Comments and literal bodies are blanked first, so prose quoting the banned
 * spelling — including this file's own rule — is not an offender.
 */
function findIdentityRenderings(
  path: string,
  content: string,
): readonly Violation[] {
  if (!path.endsWith(".ts")) return [];
  if (!content.includes("String(")) return [];

  const violations: Violation[] = [];
  codeWithoutLiterals(content)
    .split("\n")
    .forEach((text, index) => {
      IDENTITY_RENDERING.lastIndex = 0;
      for (const match of text.matchAll(IDENTITY_RENDERING)) {
        violations.push({ path, line: index + 1, match: match[0] });
      }
    });
  return violations;
}

/**
 * The companion the rule above needs, because a spelling is not the defect.
 * A call that keeps a number-valued stat and writes `stats.ino.toString(10)`
 * loses exactly as much, compiles clean, and reads identically to the approved
 * encoder — which is the idiom a reader will copy. `` `${stats.ino}` `` and
 * `const { ino } = stats` are the same class. Requiring the option at the call
 * makes a number-valued identity *unreachable* instead of merely unspelled, so
 * all four shapes close without parsing expressions.
 *
 * Scope: a module whose *code* names `dev` or `ino`, excluding test files. A
 * module that names neither cannot record an identity, and requiring the option
 * there would mean ~100 exemptions for `isFile()`, `mode` and `mtime` reads. The
 * bare identifier rather than `.dev`/`.ino` is what admits the destructured
 * form, and the scope is read from the blanked code so that the dozen modules
 * which only *discuss* `dev`/`ino` in a comment stay out of it. Test files are
 * excluded because they stat for existence and mode far more often than for
 * identity; they are held instead by the rendering rule and by the requirement
 * that a test's expected identity come from the production recording rather
 * than from its own `lstat`.
 *
 * Residual: a module that stats and hands the whole `Stats` object to an
 * identity recorder elsewhere names neither `dev` nor `ino` itself, so this
 * scope misses it. Closed today only because every identity-consuming helper
 * (`apps/cli/src/bootstrap/context.ts`, `journal-store.ts`, `retention.ts`)
 * declares `BigIntStats`, so `tsc` rejects a number-valued stat at the call
 * site; a future helper typed `Stats` would reopen it.
 */
const STAT_CALL = /\.(?:lstat|fstat|stat)\(/gu;

const IDENTITY_FIELD = /\b(?:dev|ino)\b/u;

/** A forwarded options argument, which carries whatever the caller asked for. */
const FORWARDED_OPTIONS = /\b(?:options|parameters)\b/u;

/**
 * The lifecycle guarded port's `lstat` takes a path and nothing else, and
 * returns an already-exact decimal identity, so these two callers cannot pass
 * the option and have nothing to gain from it.
 */
const STAT_OPTION_EXEMPT: readonly string[] = [
  "packages/core/src/lifecycle/testing.ts",
  "packages/core/src/lifecycle/allocator.ts",
];

/**
 * A single call may opt out where the option would change what it reads: on
 * `BigIntStats` the time fields are whole milliseconds, so a call that wants
 * `mtimeMs`'s fraction has to stay on `Stats`. The marker carries its reason at
 * the call rather than in a table here, because a table of `path:line` entries
 * goes stale on the first edit above it.
 */
const IDENTITY_FREE_MARKER = "identity-free stat:";

/** The argument text of a call whose `(` is at `open`, or null when unbalanced. */
function callArguments(code: string, open: number): string | null {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === "(") depth += 1;
    else if (code[at] === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, at);
    }
  }
  return null;
}

function findNumberValuedStats(
  path: string,
  content: string,
): readonly Violation[] {
  if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
  if (STAT_OPTION_EXEMPT.includes(path)) return [];

  const code = codeWithoutLiterals(content);
  if (!IDENTITY_FIELD.test(code)) return [];

  const lines = content.split("\n");
  const violations: Violation[] = [];
  STAT_CALL.lastIndex = 0;
  for (const match of code.matchAll(STAT_CALL)) {
    const args = callArguments(code, match.index + match[0].length - 1);
    if (args === null) continue;
    if (args.includes("bigint") || FORWARDED_OPTIONS.test(args)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    const marked = lines
      .slice(Math.max(0, line - 8), line)
      .some((text) => text.includes(IDENTITY_FREE_MARKER));
    if (marked) continue;
    violations.push({
      path,
      line,
      match: `${match[0]}${args.trim()})`,
    });
  }
  return violations;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "EISDIR")
  );
}

async function main(): Promise<number> {
  let root: string;
  let files: readonly string[];
  try {
    root = await repositoryRoot();
    files = await candidateFiles(root);
  } catch {
    process.stderr.write(
      "self-containment: could not list repository files; is this a git checkout?\n",
    );
    return 1;
  }

  const violations: Violation[] = [];
  const renderings: Violation[] = [];
  const numberValued: Violation[] = [];
  const unreadable: string[] = [];

  for (const path of files) {
    let content: string;
    try {
      /**
       * `join`, never a `file://` URL. Splicing a path into a URL string made
       * `#` and `?` truncate it, `%NN` decode, and `\` normalise — so a file
       * named `issue#12.ts` was skipped, and a checkout under a directory
       * containing `#` skipped *every* file and still exited 0.
       */
      content = await readFile(join(root, path), "utf8");
    } catch (error) {
      /**
       * Deleted from the working tree but still indexed, or a directory entry
       * from a submodule. Anything else is a file this rule was supposed to read
       * and could not, which must fail rather than pass quietly.
       */
      if (isMissing(error)) continue;
      unreadable.push(path);
      continue;
    }
    if (!isProbablyText(content)) continue;
    violations.push(...findViolations(path, content));
    renderings.push(...findIdentityRenderings(path, content));
    numberValued.push(...findNumberValuedStats(path, content));
  }

  if (unreadable.length > 0) {
    process.stderr.write(
      `self-containment: ${String(unreadable.length)} file(s) could not be read, so the rule could not be applied to them\n`,
    );
    for (const path of unreadable) process.stderr.write(`  ${path}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `self-containment: ${String(violations.length)} reference(s) to the legacy runtime outside the allowed documents\n`,
    );
    for (const violation of violations) {
      process.stderr.write(`  ${describeViolation(violation)}\n`);
    }
    process.stderr.write(
      "\nProgram Task 0 froze what the build needs into docs/migration/.\n" +
        "A missing legacy fact is a gap there or in the design spec, not a reason to read a real machine.\n",
    );
  }

  if (renderings.length > 0) {
    process.stderr.write(
      `identity-encoding: ${String(renderings.length)} filesystem identity/identities rendered through a JavaScript number\n`,
    );
    for (const rendering of renderings) {
      process.stderr.write(
        `  ${rendering.path}:${String(rendering.line)}: ${rendering.match}\n`,
      );
    }
    process.stderr.write(
      "\nRead the stats with { bigint: true } and render the field with .toString(10).\n" +
        "An APFS inode exceeds 2^53, so a number-valued ino collapses up to 128 distinct inodes onto one identity.\n",
    );
  }

  if (numberValued.length > 0) {
    process.stderr.write(
      `identity-encoding: ${String(numberValued.length)} stat call(s) in identity-recording modules return number-valued fields\n`,
    );
    for (const call of numberValued) {
      process.stderr.write(`  ${call.path}:${String(call.line)}: ${call.match}\n`);
    }
    process.stderr.write(
      "\nPass { bigint: true }. A module that records or compares dev/ino may not read a stat that cannot represent one.\n",
    );
  }

  return violations.length > 0 ||
    renderings.length > 0 ||
    numberValued.length > 0 ||
    unreadable.length > 0
    ? 1
    : 0;
}

process.exitCode = await main();
