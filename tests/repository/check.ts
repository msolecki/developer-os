#!/usr/bin/env node

/**
 * Fails the lint gate on any reference to the founder's legacy runtime outside
 * the documents that exist to describe it. See `self-containment.ts` for the
 * rule and why each allowlist entry is there.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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

  return violations.length > 0 || unreadable.length > 0 ? 1 : 0;
}

process.exitCode = await main();
