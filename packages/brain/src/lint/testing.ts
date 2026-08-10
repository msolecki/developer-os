import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BrainConfigV1 } from "@developer-os/core";

import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import type { IndexBuildRequest, IndexBuildResult } from "../indexes/index.js";
import { buildIndex, renderArtifacts } from "../indexes/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import type { LintRequest } from "./lint.js";

const FIXTURES = fileURLToPath(
  new URL("../../../../tests/fixtures/brain", import.meta.url),
);

/**
 * The four artifacts a clean reindex produces. A thin alias now: `lint`, this
 * helper and `BrainService.reindex` all call one `renderArtifacts`, so the
 * claim that they agree is structural rather than a promise in a comment.
 */
export function writtenArtifacts(
  build: IndexBuildResult,
  config: BrainConfigV1 = DEFAULT_BRAIN_CONFIG,
): Readonly<Record<string, string>> {
  return renderArtifacts(build, config);
}

function readerFor(): DirectoryReader {
  return {
    async readDir(path: string): Promise<readonly DirectoryEntry[]> {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
      }));
    },
  };
}

export function buildRequestForFixture(
  name: string,
  now: string,
  config: BrainConfigV1 = DEFAULT_BRAIN_CONFIG,
): IndexBuildRequest {
  const root = join(FIXTURES, name);
  return {
    vaultRoot: root,
    config,
    reader: readerFor(),
    readFile: (path: string) => readFile(path, "utf8"),
    assertReadable: () => Promise.resolve(),
    now: () => now,
  };
}

/**
 * Artifacts come from the supplied map rather than disk, so a test can corrupt
 * one byte without writing into a committed fixture.
 */
export function lintRequestFor(
  files: Record<string, string>,
  today: string,
  build: IndexBuildRequest,
): LintRequest {
  return {
    build,
    readArtifact: (vaultPath: string) =>
      Promise.resolve(Object.hasOwn(files, vaultPath) ? files[vaultPath] ?? null : null),
    today,
  };
}

/**
 * The whole loop for one fixture: build it, render what a clean reindex would
 * have written, and lint that. `today` is explicit and has no default — the
 * staleness class is the only one that needs the current date, and a helper
 * that reached for `new Date()` would make three of five fixture notes go stale
 * on a particular Tuesday and nobody would know why.
 */
export async function lintRequestForFixture(
  name: string,
  today: string,
  buildClock = "2026-08-04T00:00:00.000Z",
): Promise<LintRequest> {
  const build = buildRequestForFixture(name, buildClock);
  const result = await buildIndex(build);
  return lintRequestFor(writtenArtifacts(result), today, build);
}
