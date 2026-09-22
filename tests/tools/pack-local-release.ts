/**
 * Pack this checkout into an unsigned local release directory that
 * `developer-os init --local-release <dir>` admits (D47 Q1 option A).
 *
 * D53: the bundle is launchable. It carries every workspace runtime package as
 * `node_modules/@developer-os/<name>/` (its `package.json` and compiled `dist` JavaScript) and their
 * third-party runtime dependencies under `node_modules/<dep>/`, so `init` can point the product's
 * version-free entrypoint at `node_modules/@developer-os/cli/dist/bin.js`. Build first
 * (`npm run pack:local-release` does): the packer copies `dist`, it never compiles.
 *
 * Run it with `npm run pack:local-release -- <out-dir>`; the output directory
 * must not exist. It prints the directory's realpath, which is the spelling
 * admission requires.
 */
import { realpathSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import { writeUnsignedLocalRelease } from "@developer-os/cli/dist/update/local-release.js";
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

/** Every regular file under `base` that `include` keeps, as bundle files at `destination/…`, mode 0600. */
async function collectFiles(
  base: string,
  destination: string,
  include: (relativePath: string) => boolean,
): Promise<readonly ReleaseFileV1[]> {
  const files: ReleaseFileV1[] = [];
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const stats = await lstat(path);
    if (stats.isDirectory()) continue;
    if (!stats.isFile()) throw new Error(`refusing to pack a non-regular file: ${path}`);
    const relativePath = relative(base, path).split(sep).join("/");
    if (!include(relativePath)) continue;
    files.push({ relativePath: `${destination}/${relativePath}`, bytes: await readFile(path), mode: 0o600 });
  }
  return files;
}

/** Every regular file under `root/directory`, as bundle files at `directory/…`. */
export async function collectTree(root: string, directory: string): Promise<readonly ReleaseFileV1[]> {
  return collectFiles(join(root, directory), directory, () => true);
}

/** The workspace packages the CLI loads at runtime, by `@developer-os/<name>` → checkout directory. */
export const RUNTIME_PACKAGES: ReadonlyMap<string, string> = new Map([
  ["adapter-claude", "packages/adapter-claude"],
  ["adapter-codex", "packages/adapter-codex"],
  ["brain", "packages/brain"],
  ["cli", "apps/cli"],
  ["core", "packages/core"],
  ["platform-macos", "packages/platform-macos"],
  ["security", "packages/security"],
  ["workflow-schema", "packages/workflow-schema"],
]);

const WORKSPACE_SCOPE = "@developer-os/";

/**
 * A path under a workspace package's `dist`: compiled runtime only, so no declarations, source
 * maps, tests, or the `testing.js` helpers only tests import.
 */
export function isWorkspaceRuntimeFile(relativePath: string): boolean {
  return relativePath.endsWith(".js") && !relativePath.endsWith(".test.js") && basename(relativePath) !== "testing.js";
}

/**
 * What Node's `import` resolution can reach in a published dependency, plus its licence:
 * every `package.json` (nested ones select a subpath's module type), `.js`/`.mjs` files, and
 * `LICENSE*`. The store already holds only the files the package publishes; `.cjs` (the
 * `require` condition), declarations, maps and the `browser/` build are left out.
 */
export function isDependencyRuntimeFile(relativePath: string): boolean {
  const name = basename(relativePath);
  if (relativePath === name && /^licen[cs]e/iu.test(name)) return true;
  if (relativePath.startsWith("browser/")) return false;
  if (name === "package.json") return true;
  if (/\.d\.[cm]?ts$/u.test(name)) return false;
  return name.endsWith(".js") || name.endsWith(".mjs");
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function packageJson(directory: string): Promise<PackageJson> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as PackageJson;
}

/**
 * The workspace runtime packages and their third-party dependencies, as bundle files under
 * `node_modules/`. A dependency is resolved from the package that declares it, through its
 * realpath (pnpm links it), and must itself declare no dependencies: this tool resolves one
 * level, and a dependency that grew its own would otherwise ship broken.
 */
export async function collectRuntime(root: string): Promise<readonly ReleaseFileV1[]> {
  const files: ReleaseFileV1[] = [];
  const dependencies = new Map<string, string>();
  for (const [name, directory] of RUNTIME_PACKAGES) {
    const base = join(root, directory);
    const manifest = await packageJson(base);
    if (manifest.name !== `${WORKSPACE_SCOPE}${name}`) {
      throw new Error(`refusing to pack: ${directory}/package.json is not ${WORKSPACE_SCOPE}${name}`);
    }
    const destination = `node_modules/${WORKSPACE_SCOPE}${name}`;
    const runtime = await collectFiles(join(base, "dist"), `${destination}/dist`, isWorkspaceRuntimeFile);
    if (runtime.length === 0) throw new Error(`refusing to pack: ${directory}/dist holds no compiled runtime; build first`);
    files.push(
      { relativePath: `${destination}/package.json`, bytes: await readFile(join(base, "package.json")), mode: 0o600 },
      ...runtime,
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith(WORKSPACE_SCOPE)) continue;
      const real = realpathSync(join(base, "node_modules", dependency));
      const previous = dependencies.get(dependency);
      if (previous !== undefined && previous !== real) {
        throw new Error(`refusing to pack: ${dependency} resolves to two installations, ${previous} and ${real}`);
      }
      dependencies.set(dependency, real);
    }
  }
  for (const [dependency, real] of dependencies) {
    const manifest = await packageJson(real);
    if (manifest.name !== dependency) throw new Error(`refusing to pack: ${real} is not ${dependency}`);
    if (Object.keys(manifest.dependencies ?? {}).length > 0) {
      throw new Error(`refusing to pack: ${dependency} has runtime dependencies this tool does not resolve`);
    }
    files.push(...(await collectFiles(real, `node_modules/${dependency}`, isDependencyRuntimeFile)));
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
      ...(await collectRuntime(workingDirectory)),
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
