import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * Both adapter notes assert that no code path opens the field Codex ships in
 * every hook payload — the one whose value points at the running session's
 * transcript. Until now that claim was backed by a grep a reviewer ran once;
 * a grep nobody reruns is a convention, not a gate. This test is the gate: it
 * fails if that field's name appears anywhere under the four directories the
 * product's own code lives in.
 *
 * The needle is assembled at runtime rather than written as a literal, the
 * way the peer-import scan in each adapter's `index.test.ts` builds its own
 * forbidden module specifiers — this file is itself one of the files
 * scanned, and a literal would match its own source.
 */
const FIELD_NAME = ["transcript", "path"].join("_");

/**
 * Docs are deliberately excluded. `docs/architecture/codex-adapter.md` names
 * this field in prose to describe the refusal; scanning docs would fail on
 * the sentence that states the rule. The reviewer's own grep was scoped the
 * same way.
 */
const SCANNED_ROOTS: readonly string[] = ["apps/", "packages/", "tests/", "workflows/"];

function isProbablyText(content: string): boolean {
  return !content.includes("\0");
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
   * Untracked-but-not-ignored as well as tracked, matching every other
   * repository gate: the check must catch a violation before it is staged,
   * not only after.
   */
  const [tracked, untracked] = await Promise.all([
    list(["ls-files", "-z"]),
    list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);

  const all = [...new Set([...tracked, ...untracked])].sort();
  return {
    root,
    paths: all.filter((path) => SCANNED_ROOTS.some((prefix) => path.startsWith(prefix))),
  };
}

describe("the transcript-path refusal", () => {
  it("is named nowhere under apps/, packages/, tests/ or workflows/", async () => {
    const { root, paths } = await repositoryFiles();
    const scanned: string[] = [];
    const offenders: string[] = [];
    const unreadable: string[] = [];

    for (const path of paths) {
      let content: string;
      try {
        content = await readFile(join(root, path), "utf8");
      } catch (error: unknown) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : null;
        if (code === "ENOENT" || code === "EISDIR") continue;
        unreadable.push(path);
        continue;
      }
      if (!isProbablyText(content)) continue;
      scanned.push(path);
      if (content.includes(FIELD_NAME)) offenders.push(path);
    }

    /**
     * A sweep that scans nothing passes. `apps/`, `packages/`, `tests/` and
     * `workflows/` carry well over a hundred tracked files between them, so
     * this floor catches an enumerator that silently returns an empty list —
     * the same failure mode `control-bytes.test.ts` guards against per
     * extension.
     */
    expect(scanned.length).toBeGreaterThan(100);
    expect(unreadable).toStrictEqual([]);
    expect(offenders).toStrictEqual([]);
  });
});
