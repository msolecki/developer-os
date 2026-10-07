/**
 * D84 K2, D96 Q2: pack this checkout's committed state into one Homebrew keg tree per architecture,
 * plus each bundle's real zstd-ustar archive and manifest, which the index row describes.
 *
 * `npm run pack:release -- --out <dir> --version <x.y.z> --release-sequence <n> --index-sequence <n>
 * --node-arm64 <path> --node-arm64-sha256 <hex> --node-arm64-version <24.x.y> --node-x64 <path>
 * --node-x64-sha256 <hex> --node-x64-version <24.x.y> [--allow-dirty]`
 *
 * The Node runtimes are inputs, each pinned by SHA-256 and an exact `24.x.y` version
 * (`--node-<arch>-version`): the packer never downloads anything (A16's CI fetches them). Each
 * binary must match its pin and be a Mach-O of its architecture; only the host-architecture one is
 * run, and it must report its pinned version. The output directory must not exist, and the CLI
 * refuses a dirty checkout unless `--allow-dirty`.
 *
 * Runner contract: any macOS runner, either architecture, packs both kegs. Same inputs, same bytes:
 * every esbuild output, archive and tree is a function of the commit, the version, the sequences
 * and the two binaries, and of the packer's own Node version, because the archives are compressed
 * by that Node's bundled zstd; pin the runner's Node to reproduce an archive byte for byte.
 *
 * <out>/darwin-<arch>/bin/developer-os            0755, the shell launcher Homebrew links
 * <out>/darwin-<arch>/libexec/launcher.mjs        0644, the bundled stable launcher
 * <out>/darwin-<arch>/libexec/fallback/…          `writePackageChannelRelease`'s keg
 * <out>/archives/<version>/darwin-<arch>.tar.zst  the bundle's archive
 * <out>/archives/<version>/darwin-<arch>.manifest.json
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { encodeCanonicalJson, PACKAGE_CHANNEL_SOURCE_TABLE, parseStableSemver, parseUInt64Decimal, sortUtf8, validateBundleManifest } from "@developer-os/core";
import type { CanonicalJsonValue, ReleaseBundleEntryV1, ReleaseBundleManifestV1 } from "@developer-os/core";
import { LOCAL_BUNDLE_CLI_ENTRY, writePackageChannelRelease } from "@developer-os/cli/dist/update/local-release.js";
import type { ReleaseFileV1 } from "@developer-os/cli/dist/update/local-release.js";

import { bundleModule, CLI_ENTRY, collectTree, licensesOf, THIRD_PARTY_LICENSES } from "./pack-local-release.js";
import { archiveOf } from "./release-archive.js";

type Architecture = "arm64" | "x64";
const ARCHITECTURES: readonly Architecture[] = ["arm64", "x64"];

export interface NodeBinary {
  readonly path: string;
  readonly sha256: string;
  /** The exact Node version the pin was copied for, `24.x.y`. */
  readonly version: string;
}

/**
 * The CLI packs committed state only: `collectTree` already refuses dirty `workflows/` and
 * `instructions/`, and this refuses any other uncommitted change that would reach a bundle.
 */
export function assertCleanCheckout(root: string, allowDirty: boolean): void {
  if (allowDirty) return;
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0) {
    throw new Error("refusing to pack: the checkout has uncommitted changes (pass --allow-dirty to pack anyway)");
  }
}

/** Mach-O 64-bit magic and `cputype` (little-endian bytes 0–3 and 4–7). */
const MACH_O_64_MAGIC = 0xfeedfacf;
const CPU_TYPE: Readonly<Record<Architecture, number>> = { arm64: 0x0100000c, x64: 0x01000007 };

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The verified bytes of a Node runtime. The pin is checked before anything else, and the bundle
 * carries these bytes, not a second read. Only the slot whose architecture is the host's runs
 * (`--version`, bounded at 10 s, must equal the pinned version): a single-architecture runner
 * cannot execute the other slot, so its SHA-256 pin, copied from nodejs.org's SHASUMS256.txt for
 * that exact version, is its integrity authority. `skipCpuCheck` is test-only: the CLI never sets it.
 */
export async function assertNodeBinary(binary: NodeBinary, architecture: Architecture, options: { readonly skipCpuCheck?: boolean } = {}): Promise<Uint8Array> {
  let major: string | undefined;
  try {
    major = parseStableSemver(binary.version).split(".")[0];
  } catch {
    // Reported below.
  }
  if (major !== "24") throw new Error(`refusing to pack: ${binary.path} is pinned as ${binary.version}, which is not a stable Node 24 version`);
  const bytes = new Uint8Array(await readFile(binary.path));
  if (sha256(bytes) !== binary.sha256.toLowerCase()) throw new Error(`refusing to pack: ${binary.path} does not match its pinned SHA-256`);
  if (options.skipCpuCheck !== true) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 8 || view.getUint32(0, true) !== MACH_O_64_MAGIC || view.getUint32(4, true) !== CPU_TYPE[architecture]) {
      throw new Error(`refusing to pack: ${binary.path} is not a Mach-O binary of the ${architecture} architecture`);
    }
  }
  if (architecture !== process.arch) return bytes;
  let reported: string;
  try {
    ({ stdout: reported } = await promisify(execFile)(binary.path, ["--version"], { encoding: "utf8", env: {}, timeout: 10_000 }));
  } catch (error) {
    throw new Error(`refusing to pack: ${binary.path} --version failed or exceeded 10 s`, { cause: error });
  }
  if (reported !== `v${binary.version}\n`) throw new Error(`refusing to pack: ${binary.path} reports ${reported.trim()}, not its pinned v${binary.version}`);
  return bytes;
}

function positiveUInt64(value: string, label: string): string {
  try {
    if (BigInt(parseUInt64Decimal(value)) > 0n) return value;
  } catch {
    // Reported below.
  }
  throw new Error(`refusing to pack: ${label} ${value} is not a positive UInt64 decimal`);
}

function stableSemver(value: string): string {
  try {
    return parseStableSemver(value);
  } catch {
    throw new Error(`refusing to pack: version ${value} is not stable semver`);
  }
}

/** Asked of git, so the source and the compiled `tests/dist/tools/` copy agree. */
function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
}

async function writeExact(path: string, bytes: Uint8Array, mode: number): Promise<void> {
  await writeFile(path, bytes, { mode, flag: "wx" });
  await chmod(path, mode);
}

async function mkdirExact(path: string): Promise<void> {
  await mkdir(path, { mode: 0o755 });
  await chmod(path, 0o755);
}

/** Every file, plus every parent directory as a 448 entry, in byte order (parents first). */
function manifestEntries(files: readonly ReleaseFileV1[]): readonly ReleaseBundleEntryV1[] {
  const directories = new Set<string>();
  for (const file of files) {
    for (let at = file.relativePath.indexOf("/"); at !== -1; at = file.relativePath.indexOf("/", at + 1)) directories.add(file.relativePath.slice(0, at));
  }
  const entries = [
    ...[...directories].map((path) => ({ path, kind: "directory", mode: 448 })),
    ...files.map((file) => ({ path: file.relativePath, kind: "file", mode: file.mode === 0o700 ? 448 : 384, bytes: String(file.bytes.byteLength), sha256: sha256(file.bytes) })),
  ];
  return sortUtf8(entries, (entry) => entry.path) as unknown as readonly ReleaseBundleEntryV1[];
}

export async function pack(options: {
  readonly outDir: string;
  readonly version: string;
  readonly releaseSequence: string;
  readonly indexSequence: string;
  readonly node: Readonly<Record<Architecture, NodeBinary>>;
  readonly skipCpuCheck?: boolean;
}): Promise<Readonly<Record<Architecture, string>>> {
  const version = stableSemver(options.version);
  const releaseSequence = positiveUInt64(options.releaseSequence, "releaseSequence");
  const indexSequence = positiveUInt64(options.indexSequence, "indexSequence");
  const runtimes = {
    arm64: await assertNodeBinary(options.node.arm64, "arm64", options),
    x64: await assertNodeBinary(options.node.x64, "x64", options),
  };
  const out = resolve(options.outDir);
  try {
    await mkdir(out, { mode: 0o755 });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "EEXIST") throw new Error(`refusing to pack: the output directory ${out} already exists`);
    throw error;
  }
  await chmod(out, 0o755);
  const outRoot = await realpath(out);

  const root = repositoryRoot();
  const define = { __DEVELOPER_OS_RELEASE_VERSION__: JSON.stringify(version) };
  const cli = await bundleModule(root, CLI_ENTRY, define);
  const planner = await bundleModule(root, "apps/cli/dist/update/release-planner-main.js", define);
  const verifier = await bundleModule(root, "apps/cli/dist/update/release-verifier-main.js", define);
  const launcher = await bundleModule(root, "apps/launcher/dist/main.js", define);
  const packages = new Set([cli, planner, verifier, launcher].flatMap((module) => [...module.packages]));
  const shared: readonly ReleaseFileV1[] = [
    { relativePath: LOCAL_BUNDLE_CLI_ENTRY, bytes: encoder.encode(cli.text), mode: 0o700 },
    { relativePath: "bin/planner.mjs", bytes: encoder.encode(planner.text), mode: 0o700 },
    { relativePath: "bin/verifier.mjs", bytes: encoder.encode(verifier.text), mode: 0o700 },
    { relativePath: THIRD_PARTY_LICENSES, bytes: await licensesOf(root, packages), mode: 0o600 },
    ...(await collectTree(root, "workflows")),
    ...(await collectTree(root, "instructions")),
  ];

  const bundles = new Map<Architecture, { readonly files: readonly ReleaseFileV1[]; readonly manifest: ReleaseBundleManifestV1; readonly reference: CanonicalJsonValue }>();
  const archives = join(outRoot, "archives", version);
  await mkdirExact(join(outRoot, "archives"));
  await mkdirExact(archives);
  for (const architecture of ARCHITECTURES) {
    const files = [...shared, { relativePath: "bin/node", bytes: runtimes[architecture], mode: 0o700 as const }];
    const manifest = validateBundleManifest({
      schemaVersion: 1,
      version,
      releaseSequence,
      platform: "darwin",
      architecture,
      launcherProtocol: 1,
      updateProtocol: 1,
      entrypoint: LOCAL_BUNDLE_CLI_ENTRY,
      runtimeEntrypoint: "bin/node",
      plannerEntrypoint: "bin/planner.mjs",
      verifierEntrypoint: "bin/verifier.mjs",
      entries: manifestEntries(files),
    });
    const manifestBytes = encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));
    const archive = archiveOf(manifest.entries, new Map(files.map((file) => [file.relativePath, file.bytes])));
    const name = `darwin-${architecture}`;
    await writeExact(join(archives, `${name}.tar.zst`), archive, 0o644);
    await writeExact(join(archives, `${name}.manifest.json`), manifestBytes, 0o644);
    bundles.set(architecture, {
      files,
      manifest,
      reference: {
        platform: "darwin",
        architecture,
        archiveFormat: "zstd-ustar-v1",
        archivePath: `archives/${version}/${name}.tar.zst`,
        archiveBytes: String(archive.byteLength),
        archiveSha256: sha256(archive),
        manifestPath: `archives/${version}/${name}.manifest.json`,
        manifestBytes: String(manifestBytes.byteLength),
        manifestSha256: sha256(manifestBytes),
      },
    });
  }
  const bundleOf = (architecture: Architecture): NonNullable<ReturnType<typeof bundles.get>> => {
    const bundle = bundles.get(architecture);
    if (bundle === undefined) throw new Error(`refusing to pack: no ${architecture} bundle`);
    return bundle;
  };
  const index: CanonicalJsonValue = {
    sequence: indexSequence,
    latestVersion: version,
    releases: [{ version, releaseSequence, minimumLauncherProtocol: 1, updateProtocol: 1, bundles: ARCHITECTURES.map((architecture) => bundleOf(architecture).reference) }],
  };

  const kegs = {} as Record<Architecture, string>;
  for (const architecture of ARCHITECTURES) {
    const keg = join(outRoot, `darwin-${architecture}`);
    const opt = PACKAGE_CHANNEL_SOURCE_TABLE[architecture].opt;
    await mkdirExact(keg);
    await mkdirExact(join(keg, "bin"));
    await mkdirExact(join(keg, "libexec"));
    await writeExact(join(keg, "bin", "developer-os"), encoder.encode(`#!/bin/sh\nexec "${opt}/libexec/fallback/bundle/bin/node" "${opt}/libexec/launcher.mjs" "$@"\n`), 0o755);
    await writeExact(join(keg, "libexec", "launcher.mjs"), encoder.encode(launcher.text), 0o644);
    const bundle = bundleOf(architecture);
    await writePackageChannelRelease({ outDir: join(keg, "libexec", "fallback"), index, manifest: bundle.manifest, bundleFiles: bundle.files });
    kegs[architecture] = keg;
  }
  return kegs;
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
  const { values } = parseArgs({
    args: argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: {
      ...Object.fromEntries(
        ["out", "version", "release-sequence", "index-sequence", ...ARCHITECTURES.flatMap((architecture) => [`node-${architecture}`, `node-${architecture}-sha256`, `node-${architecture}-version`])].map((name) => [name, { type: "string" as const }]),
      ),
      "allow-dirty": { type: "boolean" as const },
    },
  });
  const required = (name: string): string => {
    const value = (values as Readonly<Record<string, string | boolean | undefined>>)[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("usage: npm run pack:release -- --out <dir> --version <x.y.z> --release-sequence <n> --index-sequence <n> --node-arm64 <path> --node-arm64-sha256 <hex> --node-arm64-version <24.x.y> --node-x64 <path> --node-x64-sha256 <hex> --node-x64-version <24.x.y> [--allow-dirty]");
    }
    return value;
  };
  assertCleanCheckout(repositoryRoot(), values["allow-dirty"] === true);
  const kegs = await pack({
    outDir: required("out"),
    version: required("version"),
    releaseSequence: required("release-sequence"),
    indexSequence: required("index-sequence"),
    node: {
      arm64: { path: required("node-arm64"), sha256: required("node-arm64-sha256"), version: required("node-arm64-version") },
      x64: { path: required("node-x64"), sha256: required("node-x64-sha256"), version: required("node-x64-version") },
    },
  });
  stdout.write(`${kegs.arm64}\n${kegs.x64}\n`);
}
