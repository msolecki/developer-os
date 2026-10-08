import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  EXIT_CODES,
  PACKAGE_CHANNEL_LAYOUT,
  PACKAGE_CHANNEL_RELEASE_KEY_ID,
  PACKAGE_CHANNEL_SOURCE_TABLE,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  releaseIdentityHash,
  sortUtf8,
  UNSIGNED_LOCAL_RELEASE_KEY_ID,
  validateBundleManifest,
  validatePackageChannelDelegation,
  validateReleaseIndex,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, LowerHexSha256 } from "@developer-os/core";
import { assertTrustedDirectoryEntry } from "@developer-os/platform-macos";

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

export interface PackagedReleaseHandoffV1 {
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

export type PackagedReleaseTrustV1 = "unsigned-local" | "package-channel";

export const UNSIGNED_LOCAL_LAYOUT = Object.freeze({
  delegation: "metadata/release-key-delegation.json",
  releaseIndex: "metadata/release-index.json",
  bundleManifest: "metadata/bundle-manifest.json",
  bundleRoot: "bundle",
} as const);

export interface AdmittedPackagedReleaseV1 {
  readonly trust: PackagedReleaseTrustV1;
  readonly packageRoot: string;
  readonly packageRootDev: string;
  readonly packageRootIno: string;
  readonly packageInventoryHash: LowerHexSha256;
  readonly retainedMetadata: PackagedReleaseHandoffV1["retainedMetadata"];
  readonly bundleRoot: string;
  readonly identity: PackagedReleaseIdentityV1;
  readonly files: readonly AdmittedPackagedReleaseFileV1[];
  readonly readFile: (relativePath: string) => Promise<Uint8Array>;
}

export class PackagedReleaseError extends Error {
  constructor(
    readonly code:
      | typeof EXIT_CODES.capabilityUnavailable
      | typeof EXIT_CODES.securityRefusal
      | typeof EXIT_CODES.recoveryRequired,
    message: string,
  ) {
    super(message);
    this.name = "PackagedReleaseError";
  }
}

/** `owner_only` is the unsigned-local rule; `homebrew` is the keg's (D84 K2). */
type ModePolicy = "owner_only" | "homebrew";

/** A sealed row keeps the observed disk mode; `mode` is the class-mapped one consumers see. */
type SealedFileRow = AdmittedPackagedReleaseFileV1 & { readonly diskMode: number };

interface DirectorySnapshot {
  readonly relativePath: string;
  readonly mode: 0o700 | 0o755;
  readonly dev: string;
  readonly ino: string;
}

interface SealedPackagedRelease {
  readonly trust: PackagedReleaseTrustV1;
  readonly handoff: PackagedReleaseHandoffV1;
  readonly root: { readonly dev: string; readonly ino: string };
  readonly directories: readonly DirectorySnapshot[];
  readonly files: readonly SealedFileRow[];
  readonly inventoryHash: LowerHexSha256;
  /** Package-channel only: the prefix whose ancestor chain admission checked. */
  readonly ancestorPrefix: string | null;
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

function modeOf(stats: BigIntStats): number {
  return Number(stats.mode) & 0o777;
}

function ownerUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function policyOf(trust: PackagedReleaseTrustV1): ModePolicy {
  return trust === "package-channel" ? "homebrew" : "owner_only";
}

function ownedByTrustedUid(stats: BigIntStats, policy: ModePolicy): boolean {
  const uid = Number(stats.uid);
  return uid === ownerUid() || (policy === "homebrew" && uid === 0);
}

function assertRoot(stats: BigIntStats, policy: ModePolicy): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !ownedByTrustedUid(stats, policy) ||
    modeOf(stats) !== (policy === "homebrew" ? 0o755 : 0o700)
  ) {
    securityRefusal("packaged release root is not an owner-only guarded directory");
  }
}

function assertDirectory(stats: BigIntStats, policy: ModePolicy): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !ownedByTrustedUid(stats, policy) ||
    modeOf(stats) !== (policy === "homebrew" ? 0o755 : 0o700)
  ) {
    securityRefusal("packaged release directory changed identity or shape");
  }
}

/** Returns the observed disk mode after the policy admits it. */
function assertFile(stats: BigIntStats, policy: ModePolicy): number {
  const mode = modeOf(stats);
  const allowed = policy === "homebrew" ? mode === 0o644 || mode === 0o755 : mode === 0o600 || mode === 0o700;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    !ownedByTrustedUid(stats, policy) ||
    Number(stats.nlink) !== 1 ||
    !allowed ||
    stats.size < 0n ||
    stats.size > BigInt(MAX_FILE_BYTES)
  ) {
    return securityRefusal("packaged release file changed identity or shape");
  }
  return mode;
}

/** The permission class a consumer sees: executable or not (`0755`/`0700` vs `0644`/`0600`). */
function classMode(diskMode: number): 0o600 | 0o700 {
  return (diskMode & 0o100) !== 0 ? 0o700 : 0o600;
}

async function readGuardedFile(path: string, listed: BigIntStats, policy: ModePolicy): Promise<Uint8Array> {
  const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    const mode = assertFile(opened, policy);
    if (
      opened.dev !== listed.dev ||
      opened.ino !== listed.ino ||
      opened.size !== listed.size ||
      mode !== modeOf(listed)
    ) {
      securityRefusal("packaged release file was swapped while being read");
    }
    const bytes = await handle.readFile();
    const closed = await handle.stat({ bigint: true });
    const fresh = await nodeFs.lstat(path, { bigint: true });
    if (
      closed.dev !== opened.dev ||
      closed.ino !== opened.ino ||
      closed.size !== opened.size ||
      fresh.dev !== opened.dev ||
      fresh.ino !== opened.ino ||
      fresh.size !== opened.size ||
      bytes.byteLength !== Number(opened.size)
    ) {
      securityRefusal("packaged release file changed during guarded read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function inventory(packageRoot: string, policy: ModePolicy): Promise<{
  readonly root: { readonly dev: string; readonly ino: string };
  readonly directories: readonly DirectorySnapshot[];
  readonly files: readonly SealedFileRow[];
  readonly hash: LowerHexSha256;
}> {
  const canonicalRoot = resolve(packageRoot);
  if (canonicalRoot !== packageRoot || (await nodeFs.realpath(packageRoot)) !== packageRoot) {
    securityRefusal("packaged release root must already be canonical");
  }
  const rootStats = await nodeFs.lstat(packageRoot, { bigint: true });
  assertRoot(rootStats, policy);
  const directories: DirectorySnapshot[] = [];
  const files: SealedFileRow[] = [];
  const pending = [packageRoot];
  let count = 0;
  while (pending.length > 0) {
    const directory = pending.shift();
    if (directory === undefined) break;
    const entries = sortUtf8(await nodeFs.readdir(directory, { withFileTypes: true }), (entry) => entry.name);
    for (const entry of entries) {
      count += 1;
      if (count > MAX_PACKAGE_ENTRIES) securityRefusal("packaged release inventory is too large");
      const path = join(directory, entry.name);
      const relativePath = canonicalRelativePath(relative(packageRoot, path).split(sep).join("/"));
      const stats = await nodeFs.lstat(path, { bigint: true });
      if (entry.isDirectory()) {
        assertDirectory(stats, policy);
        directories.push({
          relativePath,
          mode: policy === "homebrew" ? 0o755 : 0o700,
          dev: stats.dev.toString(10),
          ino: stats.ino.toString(10),
        });
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) securityRefusal("packaged release inventory contains a non-file entry");
      const diskMode = assertFile(stats, policy);
      const bytes = await readGuardedFile(path, stats, policy);
      files.push({
        relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex") as LowerHexSha256,
        mode: classMode(diskMode),
        diskMode,
        dev: stats.dev.toString(10),
        ino: stats.ino.toString(10),
      });
    }
  }
  const orderedDirectories = sortUtf8(directories, (directory) => directory.relativePath);
  const orderedFiles = sortUtf8(files, (file) => file.relativePath);
  const hash = createHash("sha256")
    .update("developer-os/packaged-release-inventory/v1\0")
    .update(encodeCanonicalJson({ directories: orderedDirectories, files: orderedFiles.map((row) => ({ relativePath: row.relativePath, bytes: row.bytes, sha256: row.sha256, mode: row.mode, dev: row.dev, ino: row.ino })) } as never).slice(0, -1))
    .digest("hex") as LowerHexSha256;
  return {
    root: { dev: rootStats.dev.toString(10), ino: rootStats.ino.toString(10) },
    directories: orderedDirectories,
    files: orderedFiles,
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

function requiredFile<TFile extends AdmittedPackagedReleaseFileV1>(
  files: readonly TFile[],
  relativePath: string,
): TFile {
  const canonical = canonicalRelativePath(relativePath);
  const file = files.find((candidate) => candidate.relativePath === canonical);
  if (file === undefined) return securityRefusal("packaged release is missing a retained file");
  return file;
}

function validateSemanticBindings(
  handoff: PackagedReleaseHandoffV1,
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

async function assertSealedFileChain(
  snapshot: SealedPackagedRelease,
  expected: SealedFileRow,
  sealedDirectories: ReadonlyMap<string, DirectorySnapshot>,
): Promise<BigIntStats> {
  const policy = policyOf(snapshot.trust);
  const assertSealedDirectory = async (
    path: string,
    sealedIdentity: { readonly dev: string; readonly ino: string },
    root: boolean,
  ): Promise<void> => {
    const before = await nodeFs.lstat(path, { bigint: true });
    if (root) assertRoot(before, policy);
    else assertDirectory(before, policy);
    if (before.dev.toString(10) !== sealedIdentity.dev || before.ino.toString(10) !== sealedIdentity.ino) {
      securityRefusal("packaged release directory changed before payload staging");
    }
    const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (root) assertRoot(opened, policy);
      else assertDirectory(opened, policy);
      const fresh = await nodeFs.lstat(path, { bigint: true });
      if (
        opened.dev.toString(10) !== sealedIdentity.dev ||
        opened.ino.toString(10) !== sealedIdentity.ino ||
        fresh.dev !== opened.dev ||
        fresh.ino !== opened.ino
      ) {
        securityRefusal("packaged release directory changed during guarded reopen");
      }
    } finally {
      await handle.close();
    }
  };

  await assertSealedDirectory(snapshot.handoff.packageRoot, snapshot.root, true);

  const parts = expected.relativePath.split("/");
  let relativeParent = "";
  for (const part of parts.slice(0, -1)) {
    relativeParent = relativeParent.length === 0 ? part : `${relativeParent}/${part}`;
    const sealedDirectory = sealedDirectories.get(relativeParent);
    if (sealedDirectory === undefined) {
      securityRefusal("packaged release file escaped its sealed directory chain");
    }
    await assertSealedDirectory(
      join(snapshot.handoff.packageRoot, relativeParent),
      sealedDirectory,
      false,
    );
  }

  const stats = await nodeFs.lstat(
    join(snapshot.handoff.packageRoot, expected.relativePath),
    { bigint: true },
  );
  const observedMode = assertFile(stats, policy);
  if (
    stats.dev.toString(10) !== expected.dev ||
    stats.ino.toString(10) !== expected.ino ||
    Number(stats.size) !== expected.bytes ||
    observedMode !== expected.diskMode
  ) {
    securityRefusal("packaged release file no longer matches its sealed row");
  }
  return stats;
}

function seal(
  trust: PackagedReleaseTrustV1,
  handoff: PackagedReleaseHandoffV1,
  observed: Awaited<ReturnType<typeof inventory>>,
  ancestorPrefix: string | null = null,
): PackagedReleaseSourceV1 {
  const source: PackagedReleaseSourceV1 = Object.freeze({ kind: "packaged_release_source_v1" });
  sealed.set(source, {
    trust,
    handoff: structuredClone(handoff),
    root: observed.root,
    directories: structuredClone(observed.directories),
    files: structuredClone(observed.files),
    inventoryHash: observed.hash,
    ancestorPrefix,
  });
  return source;
}

type UnsignedDocument = Record<string, unknown>;

function unsignedDocument(bytes: Uint8Array, keys: readonly string[]): UnsignedDocument {
  let value: unknown;
  try {
    value = decodeCanonicalJson(bytes, 16 * 1024 * 1024);
  } catch {
    return securityRefusal("unsigned local release document is not canonical JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return securityRefusal("unsigned local release document is not an object");
  }
  const document = value as UnsignedDocument;
  const actual = Object.keys(document);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    document.schemaVersion !== 1 ||
    document.trust !== "unsigned-local"
  ) {
    return securityRefusal("unsigned local release document has an unexpected shape");
  }
  return document;
}

async function readListed(packageRoot: string, relativePath: string, policy: ModePolicy): Promise<Uint8Array> {
  const path = join(packageRoot, relativePath);
  return readGuardedFile(path, await nodeFs.lstat(path, { bigint: true }), policy);
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function admitUnsignedLocalPackagedRelease(
  packageRoot: string,
  productVersion: string,
): Promise<PackagedReleaseSourceV1> {
  const observed = await inventory(packageRoot, "owner_only");
  const layout = UNSIGNED_LOCAL_LAYOUT;
  requiredFile(observed.files, layout.delegation);
  requiredFile(observed.files, layout.releaseIndex);
  requiredFile(observed.files, layout.bundleManifest);
  const delegationBytes = await readListed(packageRoot, layout.delegation, "owner_only");
  const indexBytes = await readListed(packageRoot, layout.releaseIndex, "owner_only");
  const manifestBytes = await readListed(packageRoot, layout.bundleManifest, "owner_only");
  unsignedDocument(delegationBytes, ["schemaVersion", "trust"]);
  const index = unsignedDocument(indexBytes, ["releaseSequence", "schemaVersion", "trust", "version"]);
  const manifest = unsignedDocument(manifestBytes, ["files", "schemaVersion", "trust"]);
  if (typeof index.version !== "string" || typeof index.releaseSequence !== "string") {
    securityRefusal("unsigned local release index is malformed");
  }

  const bundlePrefix = `${layout.bundleRoot}/`;
  const expectedRows = observed.files
    .filter((file) => file.relativePath.startsWith(bundlePrefix))
    .map((file) => ({ bytes: file.bytes, path: file.relativePath.slice(bundlePrefix.length), sha256: file.sha256 }));
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== expectedRows.length ||
    manifest.files.some((row: unknown, position) => {
      const expected = expectedRows[position];
      if (expected === undefined || typeof row !== "object" || row === null || Array.isArray(row)) return true;
      const candidate = row as Record<string, unknown>;
      return (
        Object.keys(candidate).length !== 3 ||
        candidate.bytes !== expected.bytes ||
        candidate.path !== expected.path ||
        candidate.sha256 !== expected.sha256
      );
    })
  ) {
    securityRefusal("unsigned local bundle manifest does not match the bundle inventory");
  }

  const architecture = process.arch;
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new PackagedReleaseError(
      EXIT_CODES.capabilityUnavailable,
      "unsigned local release supports only darwin arm64 or x64",
    );
  }
  const handoff: PackagedReleaseHandoffV1 = {
    packageRoot,
    retainedMetadata: {
      delegation: layout.delegation,
      releaseIndex: layout.releaseIndex,
      bundleManifest: layout.bundleManifest,
    },
    bundleRoot: layout.bundleRoot,
    identity: {
      version: index.version,
      releaseSequence: index.releaseSequence,
      releaseIdentityHash: createHash("sha256")
        .update("developer-os:unsigned-local-release-identity:v1\0")
        .update(manifestBytes)
        .digest("hex"),
      delegationSequence: "1",
      delegationHash: sha256Hex(delegationBytes),
      delegatedReleaseKeyId: UNSIGNED_LOCAL_RELEASE_KEY_ID,
      releaseIndexSequence: "1",
      releaseIndexHash: sha256Hex(indexBytes),
      bundleManifestHash: sha256Hex(manifestBytes),
      platform: "darwin",
      architecture,
      launcherProtocol: 1,
      updateProtocol: 1,
    },
  };
  validateSemanticBindings(handoff, observed.files, observed.directories);
  if (index.version !== productVersion) {
    throw new PackagedReleaseError(EXIT_CODES.capabilityUnavailable, "release_mismatch");
  }
  return seal("unsigned-local", handoff, observed);
}

/**
 * Q1: every directory from the package root up to and including `prefix` passes the D83 (3)
 * rule `assertTrustedExecutable` applies (owned by the uid or root, never other-writable,
 * group-writable only when the uid owns it). Nothing above the prefix is inspected.
 */
async function assertAncestors(packageRoot: string, prefix: string): Promise<void> {
  if (!packageRoot.startsWith(`${prefix}/`)) securityRefusal("packaged release root is not inside the package prefix");
  for (let path = packageRoot; ; path = dirname(path)) {
    if (path === dirname(path) && path !== prefix) securityRefusal("package prefix is not an ancestor of the packaged release root");
    const stats = await nodeFs.lstat(path, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) securityRefusal("packaged release ancestor is not a plain directory");
    assertTrustedDirectoryEntry(path, { uid: Number(stats.uid), mode: modeOf(stats) }, ownerUid());
    if (path === prefix) return;
  }
}

function asRecoveryRequired(error: unknown): never {
  if (error instanceof PackagedReleaseError && error.code !== EXIT_CODES.securityRefusal) throw error;
  throw new PackagedReleaseError(
    EXIT_CODES.recoveryRequired,
    error instanceof Error ? error.message : "package-channel release admission failed",
  );
}

function decodeDocument(bytes: Uint8Array, limit: number): unknown {
  return decodeCanonicalJson(bytes, limit);
}

/**
 * D84 K2: admits a Homebrew keg's `libexec/fallback`. The identity comes from the one index
 * row, not from a signature: the package manager is the channel of trust. Every failure but
 * the F1 version split is exit 6.
 */
export async function admitPackageChannelRelease(
  packageRoot: string,
  options: { readonly prefix: string; readonly requireVersion: string | null; readonly architecture: "arm64" | "x64" },
): Promise<PackagedReleaseSourceV1> {
  try {
    await assertAncestors(packageRoot, options.prefix);
    const observed = await inventory(packageRoot, "homebrew");
    const layout = PACKAGE_CHANNEL_LAYOUT;
    const delegationBytes = await readListed(packageRoot, layout.delegation, "homebrew");
    const indexBytes = await readListed(packageRoot, layout.releaseIndex, "homebrew");
    const manifestBytes = await readListed(packageRoot, layout.bundleManifest, "homebrew");
    validatePackageChannelDelegation(decodeDocument(delegationBytes, 1024));
    const index = validateReleaseIndex(decodeDocument(indexBytes, 4 * 1024 * 1024));
    const manifest = validateBundleManifest(decodeDocument(manifestBytes, 16 * 1024 * 1024));
    const architecture = options.architecture;
    const row = index.releases[0];
    const reference = row?.bundles[architecture === "arm64" ? 0 : 1];
    if (
      index.releases.length !== 1 ||
      row === undefined ||
      reference === undefined ||
      manifest.version !== row.version ||
      manifest.releaseSequence !== row.releaseSequence ||
      manifest.architecture !== architecture ||
      reference.manifestSha256 !== sha256Hex(manifestBytes) ||
      reference.manifestBytes !== String(manifestBytes.byteLength)
    ) {
      return securityRefusal("package-channel metadata does not agree with the index row");
    }

    const bundlePrefix = `${layout.bundleRoot}/`;
    const bundleDirectories = observed.directories.filter((directory) => directory.relativePath.startsWith(bundlePrefix));
    const bundleFiles = observed.files.filter((file) => file.relativePath.startsWith(bundlePrefix));
    const directoryEntries = manifest.entries.filter((entry) => entry.kind === "directory");
    const fileEntries = manifest.entries.filter((entry) => entry.kind === "file");
    if (
      bundleDirectories.length !== directoryEntries.length ||
      bundleFiles.length !== fileEntries.length ||
      directoryEntries.some((entry) => !bundleDirectories.some((directory) => directory.relativePath === `${bundlePrefix}${entry.path}`)) ||
      fileEntries.some((entry) => {
        const file = bundleFiles.find((candidate) => candidate.relativePath === `${bundlePrefix}${entry.path}`);
        return (
          file === undefined ||
          String(file.bytes) !== entry.bytes ||
          file.sha256 !== entry.sha256 ||
          (file.diskMode & 0o100 ? 448 : 384) !== entry.mode
        );
      })
    ) {
      return securityRefusal("package-channel bundle inventory does not equal the bundle manifest");
    }

    const handoff: PackagedReleaseHandoffV1 = {
      packageRoot,
      retainedMetadata: { delegation: layout.delegation, releaseIndex: layout.releaseIndex, bundleManifest: layout.bundleManifest },
      bundleRoot: layout.bundleRoot,
      identity: {
        version: row.version,
        releaseSequence: row.releaseSequence,
        releaseIdentityHash: releaseIdentityHash(row, architecture),
        delegationSequence: "0",
        delegationHash: sha256Hex(delegationBytes),
        delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID,
        releaseIndexSequence: index.sequence,
        releaseIndexHash: sha256Hex(indexBytes),
        bundleManifestHash: sha256Hex(manifestBytes),
        platform: "darwin",
        architecture,
        launcherProtocol: manifest.launcherProtocol,
        updateProtocol: manifest.updateProtocol,
      },
    };
    validateSemanticBindings(handoff, observed.files, observed.directories);
    if (options.requireVersion !== null && row.version !== options.requireVersion) {
      throw new PackagedReleaseError(EXIT_CODES.capabilityUnavailable, "release_mismatch");
    }
    return seal("package-channel", handoff, observed, options.prefix);
  } catch (error) {
    return asRecoveryRequired(error);
  }
}

/**
 * D84 K4: resolves the table's `opt` link once, with no `brew` and no `PATH`. The link must
 * name `<prefix>/Cellar/developer-os/<stable-semver>` and that keg must already be canonical.
 */
export const PACKAGE_SOURCE_ABSENT = "update_package_source_absent";

/** True for the table path being absent (exit 4); `init` then reports no packaged handoff. */
export function isPackageSourceAbsent(error: unknown): boolean {
  return error instanceof PackagedReleaseError && error.code === EXIT_CODES.capabilityUnavailable && error.message === PACKAGE_SOURCE_ABSENT;
}

/** C2: a keg whose version differs from this build: on an installed home, `init` without `--adapters` treats it as no keg. */
export function isReleaseMismatch(error: unknown): boolean {
  return error instanceof PackagedReleaseError && error.code === EXIT_CODES.capabilityUnavailable && error.message === "release_mismatch";
}

/**
 * D84 K2: `init` admits the keg the fixed table names. An absent keg is not an error: `init` then
 * reports `unavailable_until_packaged_handoff` as before. C2: a keg of another version is no keg
 * either, but only for `init` without `--adapters` (`mismatchIsAbsentIn`, the product state
 * directory) on a home that already holds a V2 install, so a fresh or V1 home still refuses
 * `release_mismatch` instead of falling through to a V1 install. Any other refusal propagates (exit 6).
 */
export async function admitInitPackageChannelKeg(input: {
  readonly architecture: string;
  readonly requireVersion: string;
  readonly mismatchIsAbsentIn: string | null;
  readonly table?: typeof PACKAGE_CHANNEL_SOURCE_TABLE;
}): Promise<PackagedReleaseSourceV1 | null> {
  const { architecture } = input;
  if (architecture !== "arm64" && architecture !== "x64") return null;
  const table = input.table ?? PACKAGE_CHANNEL_SOURCE_TABLE;
  try {
    const { packageRoot } = await resolvePackageChannelSource(architecture, table);
    return await admitPackageChannelRelease(packageRoot, {
      prefix: table[architecture].prefix,
      requireVersion: input.requireVersion,
      architecture,
    });
  } catch (error) {
    if (isPackageSourceAbsent(error)) return null;
    if (isReleaseMismatch(error) && input.mismatchIsAbsentIn !== null && await holdsActiveRelease(input.mismatchIsAbsentIn)) return null;
    throw error;
  }
}

/** A regular `<stateDir>/active-release.json`, opened without following a link: the home holds a V2 install. */
async function holdsActiveRelease(stateDir: string): Promise<boolean> {
  let handle;
  try {
    handle = await nodeFs.open(join(stateDir, "active-release.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return false;
  }
  try {
    return (await handle.stat({ bigint: true })).isFile();
  } finally {
    await handle.close();
  }
}

export async function resolvePackageChannelSource(
  architecture: "arm64" | "x64",
  table: typeof PACKAGE_CHANNEL_SOURCE_TABLE = PACKAGE_CHANNEL_SOURCE_TABLE,
): Promise<{ readonly kegRoot: CanonicalAbsolutePathV1; readonly packageRoot: CanonicalAbsolutePathV1 }> {
  const entry = table[architecture];
  const lstatOrAbsent = async (path: string): Promise<BigIntStats> => {
    try {
      return await nodeFs.lstat(path, { bigint: true });
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "ENOENT") {
        throw new PackagedReleaseError(EXIT_CODES.capabilityUnavailable, PACKAGE_SOURCE_ABSENT);
      }
      throw error;
    }
  };
  try {
    const link = await lstatOrAbsent(entry.opt);
    if (!link.isSymbolicLink()) securityRefusal("the package source link is not a symbolic link");
    const kegRoot = resolve(dirname(entry.opt), await nodeFs.readlink(entry.opt));
    parseStableSemver(basename(kegRoot));
    if (dirname(kegRoot) !== `${entry.prefix}/Cellar/developer-os` || (await nodeFs.realpath(kegRoot)) !== kegRoot) {
      securityRefusal("the package source link leaves the package cellar");
    }
    const packageRoot = join(kegRoot, entry.fallback);
    await lstatOrAbsent(packageRoot);
    return { kegRoot: parseCanonicalAbsolutePathText(kegRoot), packageRoot: parseCanonicalAbsolutePathText(packageRoot) };
  } catch (error) {
    return asRecoveryRequired(error);
  }
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
      "this build has no packaged release handoff",
    );
  }
  if (snapshot.ancestorPrefix !== null) await assertAncestors(snapshot.handoff.packageRoot, snapshot.ancestorPrefix);
  const observed = await inventory(snapshot.handoff.packageRoot, policyOf(snapshot.trust));
  validateSemanticBindings(snapshot.handoff, observed.files, observed.directories);
  if (!sameInventory(snapshot, observed)) {
    securityRefusal("packaged release changed after admission");
  }
  const filesByPath = new Map(
    snapshot.files.map((file) => [file.relativePath, file] as const),
  );
  const directoriesByPath = new Map(
    snapshot.directories.map((directory) => [directory.relativePath, directory] as const),
  );
  const admitted: AdmittedPackagedReleaseV1 = {
    trust: snapshot.trust,
    packageRoot: snapshot.handoff.packageRoot,
    packageRootDev: snapshot.root.dev,
    packageRootIno: snapshot.root.ino,
    packageInventoryHash: snapshot.inventoryHash,
    retainedMetadata: structuredClone(snapshot.handoff.retainedMetadata),
    bundleRoot: snapshot.handoff.bundleRoot,
    identity: structuredClone(snapshot.handoff.identity),
    files: snapshot.files.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes, sha256: file.sha256, mode: file.mode, dev: file.dev, ino: file.ino })),
    readFile: async (relativePath: string): Promise<Uint8Array> => {
      const expected = filesByPath.get(relativePath);
      if (expected === undefined) {
        securityRefusal("packaged release read escaped its sealed inventory");
      }
      const path = join(snapshot.handoff.packageRoot, expected.relativePath);
      const stats = await assertSealedFileChain(snapshot, expected, directoriesByPath);
      const bytes = await readGuardedFile(path, stats, policyOf(snapshot.trust));
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (
        stats.dev.toString(10) !== expected.dev ||
        stats.ino.toString(10) !== expected.ino ||
        bytes.byteLength !== expected.bytes ||
        digest !== expected.sha256 ||
        modeOf(stats) !== expected.diskMode
      ) {
        securityRefusal("packaged release file no longer matches its sealed row");
      }
      return bytes;
    },
  };
  return Object.freeze(admitted);
}
