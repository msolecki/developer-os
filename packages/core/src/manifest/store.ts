import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { EXIT_CODES } from "../result.js";
import type {
  ArtifactKind,
  ArtifactOwner,
  InstallationManifest,
  InstallationManifestV1,
  InstallationManifestV2,
  ManifestAdmissionContextV1,
  ManagedArtifactV1,
  ManifestGuards,
  ManifestStoreDependencies,
  MergeStrategy,
} from "./types.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

const MANIFEST_KEYS = [
  "artifacts",
  "installedAt",
  "productVersion",
  "schemaVersion",
];

const ARTIFACT_KEYS = [
  "backupRelativePath",
  "beforeHash",
  "existedBefore",
  "installedHash",
  "kind",
  "mergeStrategy",
  "owner",
  "path",
  "productVersion",
  "source",
  "verifiedAt",
];

const OWNERS = new Set<ArtifactOwner>(["core", "claude", "codex", "macos"]);
const KINDS = new Set<ArtifactKind>([
  "file",
  "directory",
  "symlink",
  "config-entry",
]);
const MERGE_STRATEGIES = new Set<MergeStrategy>([
  "dedicated",
  "semantic-json",
  "semantic-toml",
]);

export class ManifestStateError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor(message = "installation manifest is malformed or incomplete") {
    super(message);
    this.name = "ManifestStateError";
  }
}

/**
 * A `config-entry` records a Developer OS block inside a file a vendor also
 * owns. Verifying one needs the semantic merge that arrives with the Claude and
 * Codex adapters, so Foundation cannot prove such an artifact is unchanged.
 * Accepting it would let `doctor` report a clean tree it never checked, so the
 * manifest refuses the kind until that capability exists.
 */
export class ManifestUnsupportedArtifactError extends ManifestStateError {
  constructor() {
    super("installation manifest declares an unverifiable artifact kind");
    this.name = "ManifestUnsupportedArtifactError";
  }
}

/**
 * Raised when no manifest exists yet. Carries the invalid-input code so a
 * caller can tell "never installed" apart from "installed and corrupted".
 */
export class ManifestMissingError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor() {
    super("installation manifest does not exist");
    this.name = "ManifestMissingError";
  }
}

export function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Case-folds a path the way a default macOS volume compares names. Resolve
 * first, then fold: folding a relative path would join it against an unfolded
 * cwd and silently fail to match. This is not HFS+'s full ignorable-code-point
 * table; only case and Unicode composition are folded.
 */
export function foldPath(value: string): string {
  return resolve(value).normalize("NFC").toLowerCase();
}

/**
 * Exact containment. Used to grant ownership, so it must never match more than
 * the caller wrote.
 */
export function containsPath(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

/**
 * Case-folded containment. Used to deny — macOS volumes are case-insensitive by
 * default, so `<home>/BACKUPS` and `<home>/backups` are one directory and an
 * exclusion compared exactly would not cover both.
 */
export function containsPathLoosely(root: string, candidate: string): boolean {
  const fromRoot = relative(foldPath(root), foldPath(candidate));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === keys[index])
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isManagedPath(value: unknown): value is string {
  return (
    isNonEmptyString(value) && isAbsolute(value) && !value.includes("\0")
  );
}

function isArtifact(value: unknown): value is ManagedArtifactV1 {
  if (!isObject(value) || !hasExactKeys(value, ARTIFACT_KEYS)) return false;
  if (
    !OWNERS.has(value.owner as ArtifactOwner) ||
    !KINDS.has(value.kind as ArtifactKind) ||
    !MERGE_STRATEGIES.has(value.mergeStrategy as MergeStrategy) ||
    !isManagedPath(value.path) ||
    !isNonEmptyString(value.productVersion) ||
    !isNonEmptyString(value.source) ||
    !isHash(value.installedHash) ||
    !isIsoDate(value.verifiedAt) ||
    typeof value.existedBefore !== "boolean"
  ) {
    return false;
  }

  return value.existedBefore
    ? isHash(value.beforeHash) && isNonEmptyString(value.backupRelativePath)
    : value.beforeHash === null && value.backupRelativePath === null;
}

function cloneArtifact(artifact: ManagedArtifactV1): ManagedArtifactV1 {
  return { ...artifact };
}

function cloneManifest(
  manifest: InstallationManifestV1,
): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: manifest.productVersion,
    installedAt: manifest.installedAt,
    artifacts: manifest.artifacts.map(cloneArtifact),
  };
}

export function validateManifest(value: unknown): InstallationManifestV1 {
  if (
    !isObject(value) ||
    !hasExactKeys(value, MANIFEST_KEYS) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.productVersion) ||
    !isIsoDate(value.installedAt) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new ManifestStateError();
  }

  const paths = new Set<string>();
  for (const candidate of value.artifacts) {
    if (!isArtifact(candidate) || paths.has(foldPath(candidate.path))) {
      throw new ManifestStateError();
    }
    if (candidate.kind === "config-entry") {
      throw new ManifestUnsupportedArtifactError();
    }
    paths.add(foldPath(candidate.path));
  }

  return cloneManifest(value as unknown as InstallationManifestV1);
}

async function syncDirectory(
  fs: ManifestStoreDependencies["fs"],
  path: string,
): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBounded(handle: Awaited<ReturnType<ManifestStoreDependencies["fs"]["open"]>>, size: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_MANIFEST_BYTES) throw new ManifestStateError();
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesRead < 1) throw new ManifestStateError();
    offset += result.bytesRead;
  }
  const extra = new Uint8Array(1);
  if ((await handle.read(extra, 0, 1, bytes.byteLength)).bytesRead !== 0) throw new ManifestStateError();
  return bytes;
}

export class ManifestStore {
  private readonly manifestFile: string;
  private readonly fs: ManifestStoreDependencies["fs"];
  private readonly guards: ManifestGuards;

  constructor(dependencies: ManifestStoreDependencies) {
    this.manifestFile = dependencies.manifestFile;
    this.fs = dependencies.fs;
    this.guards = dependencies.guards;
  }

  /**
   * Returns null when no manifest exists. A machine that has never run `init`
   * is not a machine needing transaction recovery, so the absent case must not
   * reach callers as code 6.
   */
  async readOptional(): Promise<InstallationManifestV1 | null>;
  async readOptional(context: ManifestAdmissionContextV1): Promise<InstallationManifest | null>;
  async readOptional(context?: ManifestAdmissionContextV1): Promise<InstallationManifest | null> {
    let canonical: string;
    try { canonical = await this.guards.assertReadable(this.manifestFile); }
    catch (error) {
      if (isMissing(error)) return null;
      throw new ManifestStateError();
    }
    let before;
    try {
      before = await this.fs.lstat(canonical);
    } catch (error) {
      if (isMissing(error)) return null;
      throw new ManifestStateError();
    }
    if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_MANIFEST_BYTES) throw new ManifestStateError();

    let bytes: Uint8Array;
    try {
      const handle = await this.fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || !Number.isSafeInteger(opened.size) || opened.size < 0 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.size > MAX_MANIFEST_BYTES) throw new ManifestStateError();
        bytes = await readBounded(handle, opened.size);
        const after = await handle.stat();
        if (bytes.byteLength > MAX_MANIFEST_BYTES || !after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.size !== bytes.byteLength) throw new ManifestStateError();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ManifestStateError) throw error;
      throw new ManifestStateError();
    }
    try {
      const { validateManifestBytes } = await import("./v2.js");
      return validateManifestBytes(bytes, context);
    } catch { throw new ManifestStateError(); }
  }

  async read(): Promise<InstallationManifestV1>;
  async read(context: ManifestAdmissionContextV1): Promise<InstallationManifest>;
  async read(context?: ManifestAdmissionContextV1): Promise<InstallationManifest> {
    const manifest = context === undefined ? await this.readOptional() : await this.readOptional(context);
    if (manifest === null) throw new ManifestMissingError();
    return manifest;
  }

  async writeV1(manifest: InstallationManifestV1): Promise<void> {
    const validated = validateManifest(manifest);
    const bytes = new TextEncoder().encode(`${JSON.stringify(validated)}\n`);
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new ManifestStateError();
    await this.writeBytes(bytes);
  }

  /** Compatibility alias for the installed V1 callers. */
  async write(manifest: InstallationManifestV1): Promise<void> { await this.writeV1(manifest); }

  async writeV2(manifest: InstallationManifestV2, context: ManifestAdmissionContextV1): Promise<void> {
    const [{ validateManifestV2 }, { encodeCanonicalJson }] = await Promise.all([
      import("./v2.js"),
      import("../lifecycle/canonical-json.js"),
    ]);
    const validated = validateManifestV2(manifest, context);
    await this.writeBytes(new TextEncoder().encode(encodeCanonicalJson(validated as never)));
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    const directory = dirname(this.manifestFile);
    await this.fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.installation-manifest.${randomUUID()}.json.tmp`);
    let renamed = false;

    try {
      const handle = await this.fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fs.rename(temporary, this.manifestFile);
      renamed = true;
      await syncDirectory(this.fs, directory);
    } catch (error) {
      if (!renamed) {
        try {
          await this.fs.unlink(temporary);
        } catch (cleanupError) {
          if (!isMissing(cleanupError)) throw new ManifestStateError();
        }
      }
      if (error instanceof ManifestStateError) throw error;
      throw new ManifestStateError();
    }
  }
}
