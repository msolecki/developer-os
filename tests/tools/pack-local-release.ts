/**
 * Pack this checkout into an unsigned local release directory that
 * `developer-os init --local-release <dir>` admits (D47 Q1 option A).
 *
 * Run it with `npm run pack:local-release -- <out-dir>`; the output directory
 * must not exist. It prints the directory's realpath, which is the spelling
 * admission requires.
 */
import { realpathSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import {
  LOCAL_BUNDLE_BIN,
  writeUnsignedLocalRelease,
} from "@developer-os/cli/dist/update/local-release.js";
import type { ReleaseFileV1 } from "@developer-os/cli/dist/update/local-release.js";

/** `tests/dist/tools/pack-local-release.js` → the checkout that contains it. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Copied from `render-claude.ts`: every source path below is relative to the working directory. */
export function assertRepositoryRoot(workingDirectory: string, repositoryRoot: string): void {
  if (resolve(workingDirectory) !== resolve(repositoryRoot)) {
    throw new Error(
      `refusing to pack: this tool reads workflows/ and instructions/ relative to the working directory, which is ${workingDirectory} rather than the checkout it belongs to, ${repositoryRoot}`,
    );
  }
}

/** Every regular file under `root/directory`, as bundle files at `directory/…`. */
export async function collectTree(root: string, directory: string): Promise<readonly ReleaseFileV1[]> {
  const base = join(root, directory);
  const files: ReleaseFileV1[] = [];
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const stats = await lstat(path);
    if (stats.isDirectory()) continue;
    if (!stats.isFile()) throw new Error(`refusing to pack a non-regular file: ${path}`);
    files.push({
      relativePath: [directory, ...relative(base, path).split(sep)].join("/"),
      bytes: await readFile(path),
      mode: 0o600,
    });
  }
  return files;
}

export async function pack(outDir: string, options: {
  readonly workingDirectory?: string;
  readonly repositoryRoot?: string;
} = {}): Promise<string> {
  const workingDirectory = options.workingDirectory ?? cwd();
  assertRepositoryRoot(workingDirectory, options.repositoryRoot ?? REPOSITORY_ROOT);
  return writeUnsignedLocalRelease({
    outDir: resolve(workingDirectory, outDir),
    version: PRODUCT_VERSION,
    bundleFiles: [
      LOCAL_BUNDLE_BIN,
      ...(await collectTree(workingDirectory, "workflows")),
      ...(await collectTree(workingDirectory, "instructions")),
    ],
  });
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const outDir = argv[2];
  if (outDir === undefined || outDir.length === 0 || argv.length > 3) {
    throw new Error("usage: npm run pack:local-release -- <out-dir>");
  }
  stdout.write(`${await pack(outDir)}\n`);
}
