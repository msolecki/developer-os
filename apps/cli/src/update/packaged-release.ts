import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { encodeCanonicalJson, EXIT_CODES } from "@developer-os/core";
import type { LowerHexSha256 } from "@developer-os/core";

const encoder = new TextEncoder();
const MAX_PACKAGE_ENTRIES = 200_000;
const MAX_FILE_BYTES = 536_870_912;

export interface PackagedReleaseIdentityV1 {
  readonly version: string;
  readonly releaseSequence: string;
  readonly releaseIdentityHash: string;
  readonly delegationSequence: string;
  readonly delegationHash: string;
  readonly delegatedReleaseKeyId: string;
  readonly releaseIndexSequence: string;
  readonly releaseIndexHash: string;
  readonly bundleManifestHash: string;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: number;
  readonly updateProtocol: number;
}

export interface RootVerifiedPackagedReleaseV1 {
  readonly packageRoot: string;
  readonly retainedMetadata: {
    readonly delegation: string;
    readonly releaseIndex: string;
    readonly bundleManifest: string;
  };
  readonly bundleRoot: string;
  readonly identity: PackagedReleaseIdentityV1;
}

export interface PackagedReleaseSourceV1 {
  readonly kind: "packaged_release_source_v1";
}

export interface AdmittedPackagedReleaseFileV1 {
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 0o600 | 0o700;
  readonly dev: string;
  readonly ino: string;
}

export interface AdmittedPackagedReleaseV1 {
  readonly packageRoot: string;
  readonly packageRootDev: string;
  readonly packageRootIno: string;
  readonly packageInventoryHash: LowerHexSha256;
  readonly retainedMetadata: RootVerifiedPackagedReleaseV1["retainedMetadata"];
  readonly bundleRoot: string;
  readonly identity: PackagedReleaseIdentityV1;
  readonly files: readonly AdmittedPackagedReleaseFileV1[];
  readonly readFile: (relativePath: string) => Promise<Uint8Array>;
}

class PackagedReleaseError extends Error {
  constructor(
    readonly code: typeof EXIT_CODES.capabilityUnavailable | typeof EXIT_CODES.securityRefusal,
    message: string,
  ) {
    super(message);
    this.name = "PackagedReleaseError";
  }
}

interface DirectorySnapshot {
  readonly relativePath: string;
  readonly mode: 0o700;
  readonly dev: string;
  readonly ino: string;
}

interface SealedPackagedRelease {
  readonly handoff: RootVerifiedPackagedReleaseV1;
  readonly root: { readonly dev: string; readonly ino: string };
  readonly directories: readonly DirectorySnapshot[];
  readonly files: readonly AdmittedPackagedReleaseFileV1[];
  readonly inventoryHash: LowerHexSha256;
}

const sealed = new WeakMap<PackagedReleaseSourceV1, SealedPackagedRelease | null>();

function securityRefusal(message: string): never {
  throw new PackagedReleaseError(EXIT_CODES.securityRefusal, message);
}

function canonicalRelativePath(value: string): string {
  if (
    value.length < 1 ||
    value.length > 4096 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part.length < 1 || part === "." || part === "..") ||
    encoder.encode(value).some((byte) => byte === 0)
  ) {
    return securityRefusal("packaged release contains a non-canonical relative path");
  }
  return value;
}

function modeOf(stats: Stats): number {
  return stats.mode & 0o777;
}

function ownerUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function assertRoot(stats: Stats): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== ownerUid() ||
    modeOf(stats) !== 0o700
  ) {
    securityRefusal("packaged release root is not an owner-only guarded directory");
  }
}

function assertDirectory(stats: Stats): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== ownerUid() ||
    modeOf(stats) !== 0o700
  ) {
    securityRefusal("packaged release directory changed identity or shape");
  }
}

function assertFile(stats: Stats): 0o600 | 0o700 {
  const mode = modeOf(stats);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== ownerUid() ||
    stats.nlink !== 1 ||
    (mode !== 0o600 && mode !== 0o700) ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 0 ||
    stats.size > MAX_FILE_BYTES
  ) {
    return securityRefusal("packaged release file changed identity or shape");
  }
  return mode;
}

async function readGuardedFile(path: string, listed: Stats): Promise<Uint8Array> {
  const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const mode = assertFile(opened);
    if (
      opened.dev !== listed.dev ||
      opened.ino !== listed.ino ||
      opened.size !== listed.size ||
      mode !== modeOf(listed)
    ) {
      securityRefusal("packaged release file was swapped while being read");
    }
    const bytes = await handle.readFile();
    const closed = await handle.stat();
    const fresh = await nodeFs.lstat(path);
    if (
      closed.dev !== opened.dev ||
      closed.ino !== opened.ino ||
      closed.size !== opened.size ||
      fresh.dev !== opened.dev ||
      fresh.ino !== opened.ino ||
      fresh.size !== opened.size ||
      bytes.byteLength !== opened.size
    ) {
      securityRefusal("packaged release file changed during guarded read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function inventory(packageRoot: string): Promise<{
  readonly root: { readonly dev: string; readonly ino: string };
  readonly directories: readonly DirectorySnapshot[];
  readonly files: readonly AdmittedPackagedReleaseFileV1[];
  readonly hash: LowerHexSha256;
}> {
  const canonicalRoot = resolve(packageRoot);
  if (canonicalRoot !== packageRoot || (await nodeFs.realpath(packageRoot)) !== packageRoot) {
    securityRefusal("packaged release root must already be canonical");
  }
  const rootStats = await nodeFs.lstat(packageRoot);
  assertRoot(rootStats);
  const directories: DirectorySnapshot[] = [];
  const files: AdmittedPackagedReleaseFileV1[] = [];
  const pending = [packageRoot];
  let count = 0;
  while (pending.length > 0) {
    const directory = pending.shift();
    if (directory === undefined) break;
    const entries = await nodeFs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      count += 1;
      if (count > MAX_PACKAGE_ENTRIES) securityRefusal("packaged release inventory is too large");
      const path = join(directory, entry.name);
      const relativePath = canonicalRelativePath(relative(packageRoot, path).split(sep).join("/"));
      const stats = await nodeFs.lstat(path);
      if (entry.isDirectory()) {
        assertDirectory(stats);
        directories.push({
          relativePath,
          mode: 0o700,
          dev: String(stats.dev),
          ino: String(stats.ino),
        });
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) securityRefusal("packaged release inventory contains a non-file entry");
      const mode = assertFile(stats);
      const bytes = await readGuardedFile(path, stats);
      files.push({
        relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex") as LowerHexSha256,
        mode,
        dev: String(stats.dev),
        ino: String(stats.ino),
      });
    }
  }
  directories.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
  files.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
  const hash = createHash("sha256")
    .update("developer-os/packaged-release-inventory/v1\0")
    .update(encodeCanonicalJson({ directories, files } as never).slice(0, -1))
    .digest("hex") as LowerHexSha256;
  return {
    root: { dev: String(rootStats.dev), ino: String(rootStats.ino) },
    directories,
    files,
    hash,
  };
}

function validateIdentity(value: PackagedReleaseIdentityV1): void {
  const hash = /^[0-9a-f]{64}$/u;
  const uint = /^(?:0|[1-9][0-9]*)$/u;
  const platform: string = value.platform;
  const architecture: string = value.architecture;
  if (
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(value.version) ||
    !uint.test(value.releaseSequence) ||
    !uint.test(value.delegationSequence) ||
    !uint.test(value.releaseIndexSequence) ||
    !hash.test(value.releaseIdentityHash) ||
    !hash.test(value.delegationHash) ||
    !hash.test(value.delegatedReleaseKeyId) ||
    !hash.test(value.releaseIndexHash) ||
    !hash.test(value.bundleManifestHash) ||
    platform !== "darwin" ||
    (architecture !== "arm64" && architecture !== "x64") ||
    !Number.isSafeInteger(value.launcherProtocol) ||
    value.launcherProtocol < 1 ||
    !Number.isSafeInteger(value.updateProtocol) ||
    value.updateProtocol < 1
  ) {
    securityRefusal("packaged release identity is malformed");
  }
}

function requiredFile(
  files: readonly AdmittedPackagedReleaseFileV1[],
  relativePath: string,
): AdmittedPackagedReleaseFileV1 {
  const canonical = canonicalRelativePath(relativePath);
  const file = files.find((candidate) => candidate.relativePath === canonical);
  if (file === undefined) return securityRefusal("packaged release is missing a retained file");
  return file;
}

function validateSemanticBindings(
  handoff: RootVerifiedPackagedReleaseV1,
  files: readonly AdmittedPackagedReleaseFileV1[],
  directories: readonly DirectorySnapshot[],
): void {
  validateIdentity(handoff.identity);
  const delegation = requiredFile(files, handoff.retainedMetadata.delegation);
  const index = requiredFile(files, handoff.retainedMetadata.releaseIndex);
  const bundleManifest = requiredFile(files, handoff.retainedMetadata.bundleManifest);
  const bundleRoot = canonicalRelativePath(handoff.bundleRoot);
  if (
    delegation.sha256 !== handoff.identity.delegationHash ||
    index.sha256 !== handoff.identity.releaseIndexHash ||
    bundleManifest.sha256 !== handoff.identity.bundleManifestHash ||
    !directories.some((directory) => directory.relativePath === bundleRoot) ||
    !files.some((file) => file.relativePath.startsWith(`${bundleRoot}/`))
  ) {
    securityRefusal("packaged release retained metadata or bundle binding changed");
  }
}

function sameInventory(left: SealedPackagedRelease, right: Awaited<ReturnType<typeof inventory>>): boolean {
  return (
    left.root.dev === right.root.dev &&
    left.root.ino === right.root.ino &&
    left.inventoryHash === right.hash &&
    JSON.stringify(left.directories) === JSON.stringify(right.directories) &&
    JSON.stringify(left.files) === JSON.stringify(right.files)
  );
}

export async function admitRootVerifiedPackagedRelease(
  handoff: RootVerifiedPackagedReleaseV1,
): Promise<PackagedReleaseSourceV1> {
  const observed = await inventory(handoff.packageRoot);
  validateSemanticBindings(handoff, observed.files, observed.directories);
  const source: PackagedReleaseSourceV1 = Object.freeze({ kind: "packaged_release_source_v1" });
  sealed.set(source, {
    handoff: structuredClone(handoff),
    root: observed.root,
    directories: structuredClone(observed.directories),
    files: structuredClone(observed.files),
    inventoryHash: observed.hash,
  });
  return source;
}

export function unavailablePackagedReleaseSource(): PackagedReleaseSourceV1 {
  const source: PackagedReleaseSourceV1 = Object.freeze({ kind: "packaged_release_source_v1" });
  sealed.set(source, null);
  return source;
}

export async function inspectPackagedRelease(
  source: PackagedReleaseSourceV1 | undefined,
): Promise<AdmittedPackagedReleaseV1> {
  const snapshot = source === undefined ? undefined : sealed.get(source);
  if (snapshot === undefined || snapshot === null) {
    throw new PackagedReleaseError(
      EXIT_CODES.capabilityUnavailable,
      "this build has no root-verified packaged release handoff",
    );
  }
  const observed = await inventory(snapshot.handoff.packageRoot);
  validateSemanticBindings(snapshot.handoff, observed.files, observed.directories);
  if (!sameInventory(snapshot, observed)) {
    securityRefusal("packaged release changed after root-verified admission");
  }
  const admitted: AdmittedPackagedReleaseV1 = {
    packageRoot: snapshot.handoff.packageRoot,
    packageRootDev: snapshot.root.dev,
    packageRootIno: snapshot.root.ino,
    packageInventoryHash: snapshot.inventoryHash,
    retainedMetadata: structuredClone(snapshot.handoff.retainedMetadata),
    bundleRoot: snapshot.handoff.bundleRoot,
    identity: structuredClone(snapshot.handoff.identity),
    files: structuredClone(snapshot.files),
    readFile: async (relativePath: string): Promise<Uint8Array> => {
      const fresh = await inventory(snapshot.handoff.packageRoot);
      if (!sameInventory(snapshot, fresh)) {
        securityRefusal("packaged release changed before payload staging");
      }
      const expected = requiredFile(snapshot.files, relativePath);
      const path = join(snapshot.handoff.packageRoot, expected.relativePath);
      const stats = await nodeFs.lstat(path);
      const bytes = await readGuardedFile(path, stats);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (
        stats.dev.toString() !== expected.dev ||
        stats.ino.toString() !== expected.ino ||
        bytes.byteLength !== expected.bytes ||
        digest !== expected.sha256 ||
        modeOf(stats) !== expected.mode
      ) {
        securityRefusal("packaged release file no longer matches its sealed row");
      }
      return bytes;
    },
  };
  return Object.freeze(admitted);
}
