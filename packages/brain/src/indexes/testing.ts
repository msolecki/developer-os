import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import type { IndexBuildRequest } from "./build.js";

/**
 * Absolute, and deliberately not a repository-relative string. `discoverNotes`
 * canonicalizes the content root on every call and `canonicalizePlannedPath`
 * refuses a relative path outright, so a relative fixture root would fail
 * closed rather than resolve against whatever `cwd` the runner happened to use.
 *
 * The `../../../../` holds for both `src/indexes/` and the compiled
 * `dist/indexes/`, which sit at the same depth below the repository root.
 */
export const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../../tests/fixtures/brain/legacy-shape", import.meta.url),
);

const realReader: DirectoryReader = {
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

/**
 * Reverses every result array. This is the reader that makes the determinism
 * gate mean something: building twice through the same reader re-runs the same
 * directory order and proves almost nothing (spec §6.2).
 */
const reversedReader: DirectoryReader = {
  async readDir(path: string): Promise<readonly DirectoryEntry[]> {
    return [...(await realReader.readDir(path))].reverse();
  },
};

function requestWith(reader: DirectoryReader, now: string): IndexBuildRequest {
  return {
    vaultRoot: FIXTURE_ROOT,
    config: DEFAULT_BRAIN_CONFIG,
    reader,
    readFile: (path: string) => readFile(path, "utf8"),
    assertReadable: () => Promise.resolve(),
    now: () => now,
  };
}

export function fixtureRequest(now: string): IndexBuildRequest {
  return requestWith(realReader, now);
}

export function reversedFixtureRequest(now: string): IndexBuildRequest {
  return requestWith(reversedReader, now);
}
