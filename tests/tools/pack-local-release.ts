/**
 * Pack this checkout into an unsigned local release directory that
 * `developer-os init --local-release <dir>` admits (D47 Q1 option A).
 *
 * D55: the bundle is launchable and small. `esbuild` bundles the compiled CLI entry
 * (`apps/cli/dist/bin.js`) with every workspace package and third-party dependency into the one
 * module the product's version-free entrypoint imports, `node_modules/@developer-os/cli/dist/bin.js`
 * (D53), next to `THIRD-PARTY-LICENSES` with the licence of every bundled third-party package.
 * Build first (`npm run pack:local-release` does): the packer bundles `dist`, it never compiles.
 *
 * Run it with `npm run pack:local-release -- <out-dir>`; the output directory
 * must not exist. It prints the directory's realpath, which is the spelling
 * admission requires.
 */
import { execFile, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import { LOCAL_BUNDLE_CLI_ENTRY, writeUnsignedLocalRelease } from "@developer-os/cli/dist/update/local-release.js";
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

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Every committed file under `root/directory`, as bundle files at `directory/…`, mode 0600. Git,
 * not the working tree, names them and supplies their bytes: an ignored `.DS_Store`, an untracked
 * draft, or an edit `skip-worktree` hides from `status` is never packed, and a visible uncommitted
 * edit refuses, so the release is the checkout's committed state.
 */
export async function collectTree(root: string, directory: string): Promise<readonly ReleaseFileV1[]> {
  if (git(root, ["status", "--porcelain", "--untracked-files=no", "--", directory]).length > 0) {
    throw new Error(`refusing to pack: ${directory}/ has uncommitted changes`);
  }
  const files: ReleaseFileV1[] = [];
  for (const line of git(root, ["ls-tree", "-r", "-z", "HEAD", "--", directory]).split("\0").filter((row) => row.length > 0)) {
    const [mode, type, object] = line.slice(0, line.indexOf("\t")).split(" ");
    const relativePath = line.slice(line.indexOf("\t") + 1);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755") || object === undefined) {
      throw new Error(`refusing to pack a non-regular file: ${relativePath}`);
    }
    const { stdout: bytes } = await promisify(execFile)("git", ["cat-file", "blob", object], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    files.push({ relativePath, bytes, mode: 0o600 });
  }
  return files;
}

/** The compiled CLI entry `esbuild` starts from, relative to the checkout. */
export const CLI_ENTRY = "apps/cli/dist/bin.js";

/** Where the licences of the bundled third-party packages land in the bundle. */
export const THIRD_PARTY_LICENSES = "THIRD-PARTY-LICENSES";

/**
 * The installed package directory of a bundled input under `node_modules/`, or `undefined` for a
 * workspace file (esbuild follows pnpm's links to realpaths, so workspace inputs never pass
 * through `node_modules/`).
 */
export function thirdPartyPackageDirectory(input: string): string | undefined {
  const marker = "node_modules/";
  const at = input.lastIndexOf(marker);
  if (at === -1) return undefined;
  const segments = input.slice(at + marker.length).split("/");
  const length = segments[0]?.startsWith("@") === true ? 2 : 1;
  return input.slice(0, at + marker.length) + segments.slice(0, length).join("/");
}

/**
 * The spelling of a bundled input that does not depend on where the checkout or its pnpm store
 * lives (NEW-107). esbuild names every module in the bundle by its realpath relative to the
 * checkout, and a worktree whose `node_modules` links into another checkout's store would embed
 * that checkout's location; a store path is cut back to its `node_modules/…` tail. Anything else
 * outside the checkout refuses: it would be another checkout's code.
 */
export function checkoutIndependentInput(input: string): string {
  const path = /(?:^|\/)(node_modules\/.*)$/u.exec(input)?.[1] ?? input;
  if (path.startsWith("../") || isAbsolute(path)) throw new Error(`refusing to pack: bundled input ${input} lies outside the checkout`);
  return path;
}

async function license(root: string, directory: string): Promise<string> {
  const base = join(root, directory);
  const manifest = JSON.parse(await readFile(join(base, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
  const names = (await readdir(base)).filter((name) => /^licen[cs]e/iu.test(name)).sort();
  const first = names[0];
  if (first === undefined) throw new Error(`refusing to pack: bundled package ${directory} ships no LICENSE file`);
  const text = (await readFile(join(base, first), "utf8")).trimEnd();
  return `${String(manifest.name)}@${String(manifest.version)}\n${"-".repeat(72)}\n${text}\n`;
}

/**
 * The CLI as one ESM module at {@link LOCAL_BUNDLE_CLI_ENTRY} plus {@link THIRD_PARTY_LICENSES}.
 * Only Node builtins stay external (`platform: "node"`); no minification or source map, names
 * kept, and every path esbuild writes is relative to the checkout with store paths cut by
 * {@link checkoutIndependentInput}, so two checkouts of one commit bundle to the same bytes.
 */
export async function bundleCli(root: string): Promise<readonly ReleaseFileV1[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [CLI_ENTRY],
    outfile: join(root, "bundle", LOCAL_BUNDLE_CLI_ENTRY),
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node24",
    keepNames: true,
    minify: false,
    sourcemap: false,
    // `yaml` resolves to its CommonJS build under the `node` condition and requires Node builtins;
    // an ESM bundle has no `require` unless one is made.
    banner: { js: 'import { createRequire as __developerOsCreateRequire } from "node:module";\nconst require = __developerOsCreateRequire(import.meta.url);' },
    logLevel: "silent",
  });
  const [output, ...rest] = result.outputFiles;
  if (output === undefined || rest.length > 0) throw new Error("refusing to pack: esbuild did not emit exactly one module");
  const packages = new Set<string>();
  const prefixes = new Set<string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    const directory = thirdPartyPackageDirectory(input);
    if (directory !== undefined) packages.add(directory);
    const path = checkoutIndependentInput(input);
    if (path !== input) prefixes.add(input.slice(0, input.length - path.length));
  }
  let text = output.text;
  // Longest first: a shorter prefix can be the tail of a longer one.
  for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) text = text.replaceAll(`${prefix}node_modules/`, "node_modules/");
  const licenses = await Promise.all([...packages].map((directory) => license(root, directory)));
  return [
    { relativePath: LOCAL_BUNDLE_CLI_ENTRY, bytes: new TextEncoder().encode(text), mode: 0o600 },
    { relativePath: THIRD_PARTY_LICENSES, bytes: new TextEncoder().encode(licenses.sort().join("\n")), mode: 0o600 },
  ];
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
      ...(await bundleCli(workingDirectory)),
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
