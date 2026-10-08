/**
 * A16 §2 step 3: `developer-os-X.Y.Z-darwin-<arch>.tar.gz`, the keg root's contents as sorted ustar
 * members, owner 0:0, the tag commit's mtime, the keg's own 0755/0644 modes; gzip with no name and
 * a zero header mtime (Node's gzip writes neither), so a rebuild of the tag gives the same bytes.
 *
 * `node tests/dist/tools/release-tarball.js --pack <dir> --version <X.Y.Z> --mtime <s> --dest <dir>`
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import { parseStableSemver, sortUtf8 } from "@developer-os/core";

import { ustarHeader } from "./release-archive.js";
import type { UstarEntry } from "./release-archive.js";

const BLOCK = 512;
const MAX_MTIME = 8 ** 11 - 1;

interface Member extends UstarEntry {
  readonly bytes: Uint8Array;
}

async function memberOf(kegRoot: string, path: string): Promise<Member> {
  const stats = await lstat(path);
  const mode = stats.mode & 0o7777;
  const relativePath = relative(kegRoot, path);
  if (stats.isDirectory() && mode === 0o755) return { path: relativePath, kind: "directory", mode, bytes: new Uint8Array() };
  if (stats.isFile() && stats.nlink === 1 && (mode === 0o755 || mode === 0o644)) {
    return { path: relativePath, kind: "file", mode, bytes: new Uint8Array(await readFile(path)) };
  }
  throw new Error(`refusing to tar: ${relativePath} is not a 0755 directory or a single-link 0644/0755 file`);
}

export async function tarballOf(kegRoot: string, mtime: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(mtime) || mtime < 0 || mtime > MAX_MTIME) throw new Error(`refusing to tar: mtime ${String(mtime)} is not a whole number of seconds in the ustar range`);
  const members: Member[] = [];
  for (const entry of await readdir(kegRoot, { recursive: true, withFileTypes: true })) members.push(await memberOf(kegRoot, join(entry.parentPath, entry.name)));
  if (members.length === 0) throw new Error(`refusing to tar: ${kegRoot} is empty`);
  const parts: Uint8Array[] = [];
  for (const member of sortUtf8(members, (row) => row.path)) {
    parts.push(ustarHeader(member, member.bytes.byteLength, mtime), member.bytes, new Uint8Array((BLOCK - (member.bytes.byteLength % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  return new Uint8Array(gzipSync(Buffer.concat(parts), { level: 9 }));
}

export async function writeReleaseTarballs(options: { readonly packDir: string; readonly version: string; readonly mtime: number; readonly dest: string }): Promise<void> {
  let version: string;
  try {
    version = parseStableSemver(options.version);
  } catch (error) {
    throw new Error(`refusing to tar: version ${options.version} is not stable semver`, { cause: error });
  }
  try {
    await mkdir(options.dest, { mode: 0o755 });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "EEXIST") throw new Error(`refusing to tar: ${options.dest} already exists`, { cause: error });
    throw error;
  }
  const lines: string[] = [];
  for (const architecture of ["arm64", "x64"] as const) {
    const name = `developer-os-${version}-darwin-${architecture}.tar.gz`;
    const bytes = await tarballOf(join(options.packDir, `darwin-${architecture}`), options.mtime);
    await writeFile(join(options.dest, name), bytes, { flag: "wx", mode: 0o644 });
    lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
  }
  await writeFile(join(options.dest, "SHA256SUMS"), lines.join(""), { flag: "wx", mode: 0o644 });
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
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { pack: { type: "string" }, version: { type: "string" }, mtime: { type: "string" }, dest: { type: "string" } } });
  const { pack, version, mtime, dest } = values;
  if (pack === undefined || version === undefined || mtime === undefined || dest === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(mtime)) {
    throw new Error("usage: release-tarball.js --pack <dir> --version <X.Y.Z> --mtime <epoch seconds> --dest <dir>");
  }
  await writeReleaseTarballs({ packDir: pack, version, mtime: Number(mtime), dest });
}
