/**
 * A16 §2 step 4: unpack a release tarball into a scratch prefix, run the production K2 keg admission
 * on its `libexec/fallback`, and require a copy with one flipped bundle byte to refuse with exit 6.
 *
 * `node tests/dist/tools/verify-release-tarball.js --tarball <path> --version <X.Y.Z> --architecture <arm64|x64>`
 */
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

import { EXIT_CODES, MAXIMUM_BUNDLE_AGGREGATE_BYTES, MAXIMUM_BUNDLE_ENTRIES, MAXIMUM_BUNDLE_FILE_BYTES } from "@developer-os/core";
import { admitPackageChannelRelease, inspectPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { releaseSequenceOf } from "./release-metadata.js";

type Architecture = "arm64" | "x64";
const FLIPPED_FILE = "libexec/fallback/bundle/bin/planner.mjs";

interface Member {
  readonly path: string;
  readonly directory: boolean;
  readonly mode: number;
  readonly bytes: Uint8Array;
}

const BLOCK = 512;
/** The keg carries the bundle plus a few launcher and metadata files; each entry costs a header and up to a block of padding. */
const KEG_EXTRA_ENTRIES = 1024;
interface Limits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxOutputBytes: number;
}
const DEFAULT_LIMITS: Limits = {
  maxEntries: MAXIMUM_BUNDLE_ENTRIES + KEG_EXTRA_ENTRIES,
  maxEntryBytes: MAXIMUM_BUNDLE_FILE_BYTES,
  maxOutputBytes: MAXIMUM_BUNDLE_AGGREGATE_BYTES + (MAXIMUM_BUNDLE_ENTRIES + KEG_EXTRA_ENTRIES) * 2 * BLOCK + 2 * BLOCK,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function field(block: Uint8Array, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return decoder.decode(end < 0 ? raw : raw.subarray(0, end));
}

/** Node-only ustar reader: regular files and directories under `bin` or `libexec`, safe relative paths, each path once. */
function membersOf(tarball: Uint8Array, limits: Limits): Member[] {
  let data: Uint8Array;
  try {
    data = gunzipSync(tarball, { maxOutputLength: limits.maxOutputBytes });
  } catch (error) {
    throw new Error(`refusing the release: the tarball is not a gzip that unpacks within ${String(limits.maxOutputBytes)} bytes (it exceeds the bundle bound or is corrupt)`, { cause: error });
  }
  const members: Member[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    if (offset + BLOCK > data.byteLength) throw new Error("refusing the release: the tar archive is truncated or lacks its terminating blocks");
    const block = data.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    if (members.length >= limits.maxEntries) throw new Error(`refusing the release: more than ${String(limits.maxEntries)} entries`);
    if (field(block, 257, 5) !== "ustar") throw new Error("refusing the release: a tar header lacks the ustar magic");
    let sum = 0;
    for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (block[index] as number);
    if (sum !== Number.parseInt(field(block, 148, 8).trim(), 8)) throw new Error("refusing the release: a tar header checksum does not match");
    const type = String.fromCharCode(block[156] as number);
    if (type !== "0" && type !== "\0" && type !== "5") throw new Error(`refusing the release: entry type ${JSON.stringify(type)} (a symlink or special file) is not allowed`);
    const prefix = field(block, 345, 155);
    const path = prefix === "" ? field(block, 0, 100) : `${prefix}/${field(block, 0, 100)}`;
    const segments = path.split("/");
    if (path.startsWith("/") || Array.from(encoder.encode(path)).some((byte) => byte === 0x5c || byte < 0x20 || byte === 0x7f) || segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error(`refusing the release: unsafe path ${JSON.stringify(path)}`);
    const directory = type === "5";
    if ((segments[0] !== "bin" && segments[0] !== "libexec") || (segments.length === 1 && !directory)) throw new Error(`refusing the release: ${path} is outside the top level of exactly bin and libexec`);
    if (seen.has(path)) throw new Error(`refusing the release: ${path} appears twice`);
    seen.add(path);
    const size = directory ? 0 : Number.parseInt(field(block, 124, 12).trim(), 8);
    const start = offset + BLOCK;
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxEntryBytes) throw new Error(`refusing the release: ${path} exceeds the entry bytes bound or has an invalid size`);
    if (start + size > data.byteLength) throw new Error(`refusing the release: the tar archive is truncated inside ${path}`);
    members.push({ path, directory, mode: Number.parseInt(field(block, 100, 8).trim(), 8) & 0o777, bytes: data.subarray(start, start + size) });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (offset + 2 * BLOCK !== data.byteLength || !data.subarray(offset, offset + 2 * BLOCK).every((byte) => byte === 0)) {
    throw new Error("refusing the release: the tar archive must end with exactly two zero terminating blocks");
  }
  if (members.length === 0) throw new Error("refusing the release: the tarball has no members");
  return members;
}

async function extract(members: readonly Member[], into: string): Promise<string> {
  await mkdir(into, { mode: 0o755 });
  await chmod(into, 0o755);
  for (const member of members) {
    const target = join(into, member.path);
    if (member.directory) {
      await mkdir(target, { recursive: true, mode: 0o755 });
    } else {
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, member.bytes, { flag: "wx" });
    }
    await chmod(target, member.mode);
  }
  return into;
}

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

async function admit(prefix: string, version: string, architecture: Architecture): Promise<void> {
  if ((await modeOf(join(prefix, "bin", "developer-os"))) !== 0o755 || (await modeOf(join(prefix, "libexec", "launcher.mjs"))) !== 0o644) {
    throw new Error("refusing the release: the launcher files do not carry modes 0755 and 0644");
  }
  const { identity } = await admitPackageChannelRelease(join(prefix, "libexec", "fallback"), { prefix, requireVersion: version, architecture })
    .then(inspectPackagedRelease)
    .catch((error: unknown) => {
      throw new Error(`refusing the release: K2 admission failed for ${architecture}`, { cause: error });
    });
  const expected = releaseSequenceOf(version);
  if (identity.releaseSequence !== expected || identity.releaseIndexSequence !== expected) {
    throw new Error(`refusing the release: the tarball stamps sequence ${identity.releaseSequence}/${identity.releaseIndexSequence}, not ${version}'s ${expected}`);
  }
}

export async function verifyReleaseTarball(options: { readonly tarball: string; readonly version: string; readonly architecture: Architecture; readonly limits?: Partial<Limits> }): Promise<void> {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "developer-os-verify-")));
  try {
    await chmod(scratch, 0o755);
    const members = membersOf(await readFile(options.tarball), { ...DEFAULT_LIMITS, ...options.limits });
    await admit(await extract(members, join(scratch, "intact")), options.version, options.architecture);
    const flipped = await extract(members, join(scratch, "flipped"));
    const target = join(flipped, FLIPPED_FILE);
    const bytes = await readFile(target);
    bytes[0] = (bytes[0] as number) ^ 0x01;
    await writeFile(target, bytes);
    const refusal = await admit(flipped, options.version, options.architecture).then(
      () => null,
      (error: unknown) => (error as { readonly cause?: { readonly code?: unknown } }).cause?.code,
    );
    if (refusal !== EXIT_CODES.recoveryRequired) throw new Error(`refusing the release: a copy with one flipped byte in ${FLIPPED_FILE} was not refused with exit 6`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
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
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { tarball: { type: "string" }, version: { type: "string" }, architecture: { type: "string" } } });
  const { tarball, version, architecture } = values;
  if (tarball === undefined || version === undefined || (architecture !== "arm64" && architecture !== "x64")) {
    throw new Error("usage: verify-release-tarball.js --tarball <path> --version <X.Y.Z> --architecture <arm64|x64>");
  }
  await verifyReleaseTarball({ tarball, version, architecture });
  stdout.write(`verified ${basename(tarball)}\n`);
}
