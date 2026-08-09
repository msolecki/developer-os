import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BrainConfigV1 } from "@developer-os/core";

import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import type { IndexBuildRequest, IndexBuildResult } from "../indexes/index.js";
import {
  buildIndex,
  renderCatalog,
  renderVaultMap,
  serializeGraph,
  serializeIndex,
} from "../indexes/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { artifactPaths } from "./lint.js";
import type { LintRequest } from "./lint.js";

const FIXTURES = fileURLToPath(
  new URL("../../../../tests/fixtures/brain", import.meta.url),
);

/**
 * The four artifacts a clean reindex produces, built once so no test asserts
 * drift against bytes a real reindex would never have written.
 *
 * This is the *second* copy of that rendering — `lint.ts` has the first, and
 * Task 8's `BrainService.reindex` will be the third. Nothing enforces that they
 * agree, so do not read this as a promise that they do; collapsing all three
 * into one `renderArtifacts(build, config)` is Task 8's first step.
 */
export function writtenArtifacts(
  build: IndexBuildResult,
  config: BrainConfigV1 = DEFAULT_BRAIN_CONFIG,
): Record<string, string> {
  const paths = artifactPaths(config);
  return {
    [paths.index]: serializeIndex(build.index),
    [paths.graph]: serializeGraph(build.graph),
    [paths.vaultMap]: renderVaultMap(build.index),
    [paths.catalog]: renderCatalog(build.index),
  };
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
