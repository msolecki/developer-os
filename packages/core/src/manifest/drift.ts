import type { BigIntStats } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { extractInstructionBlock } from "./instruction-block.js";
import { hashStableRegularFile, readStableRegularFile } from "./fs-read.js";
import { MAXIMUM_BUNDLE_FILE_BYTES } from "../update/release.js";
import {
  containsPath,
  hashBytes,
  isMissing,
  ManifestStateError,
  ManifestUnsupportedArtifactError,
} from "./store.js";
import type {
  ConflictEvidence,
  ConflictEvidenceRequest,
  DriftFileSystem,
  DriftFinding,
  DriftRequest,
  DriftRequestV2,
  ManagedArtifactV1,
  ManagedArtifactV2,
  ManifestGuards,
} from "./types.js";

const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 1000;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;
/**
 * A release bundle file, or a rollback payload's copy of one, may be as large as the release format
 * admits: the bundled Node runtime alone is over 100 MiB. Only those rows get the bundle's per-file
 * bound; every other row (instruction, schema, vendor and configuration files, and uninstall's V1
 * downcast of them) keeps the 8 MiB read bound. Init records a bundle file as `bundle/<path>`, an
 * update as `generated/release/<path>`, and a retained rollback file as `generated/rollback`.
 * V1 drift (uninstall's preview) streams the hash (NEW-210).
 * ponytail: V2's content read is still whole-file; stream it too if doctor's peak memory starts to matter.
 */
const MAX_RELEASE_FILE_BYTES = MAXIMUM_BUNDLE_FILE_BYTES;
function readBoundFor(source: string): number {
  return source.startsWith("bundle/") || source.startsWith("generated/release/") || source === "generated/rollback"
    ? MAX_RELEASE_FILE_BYTES
    : MAX_READ_BYTES;
}
const MAX_LINK_TARGET_BYTES = 4096;
const BINARY_NOTICE = "[binary content omitted]";
const OVERSIZED_NOTICE = "[content too large to diff]";

/**
 * Every filesystem error other than a missing path becomes a constant error.
 * Node's errors carry the absolute path in `message` and `path`, and a string
 * `code` that would collide with the numeric exit codes callers match on.
 */
function rethrowRedacted(error: unknown): never {
  if (error instanceof ManifestStateError) throw error;
  throw new ManifestStateError();
}

/**
 * Reads a regular file through the canonical path the guard returned, so no
 * component is a symlink, then re-checks after open that the descriptor is the
 * same inode that was inspected. Mirrors the pattern in the transaction
 * executor.
 */
async function guardedRead<T>(
  fs: DriftFileSystem,
  guards: ManifestGuards,
  path: string,
  maxBytes: number,
  reader: (fs: DriftFileSystem, canonical: string, stats: BigIntStats, maxBytes: number) => Promise<T>,
): Promise<T | null> {
  let canonical: string;
  try { canonical = await guards.assertReadable(path); } catch { throw new ManifestStateError(); }

  let stats;
  try {
    stats = await fs.lstat(canonical, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    rethrowRedacted(error);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) throw new ManifestStateError();
  if (stats.size > maxBytes) throw new ManifestStateError();

  try {
    return await reader(fs, canonical, stats, maxBytes);
  } catch (error) {
    if (isMissing(error)) return null;
    rethrowRedacted(error);
  }
}

function readGuardedFile(fs: DriftFileSystem, guards: ManifestGuards, path: string): Promise<Uint8Array | null> {
  return guardedRead(fs, guards, path, MAX_READ_BYTES, readStableRegularFile);
}

function hashGuardedFile(fs: DriftFileSystem, guards: ManifestGuards, path: string, maxBytes: number): Promise<string | null> {
  return guardedRead(fs, guards, path, maxBytes, hashStableRegularFile);
}

function finding(
  artifact: ManagedArtifactV1,
  kind: DriftFinding["kind"],
  actualHash: string | null,
): DriftFinding {
  return {
    path: artifact.path,
    owner: artifact.owner,
    kind,
    expectedHash: artifact.installedHash,
    actualHash,
  };
}

async function inspectArtifact(
  artifact: ManagedArtifactV1,
  fs: DriftFileSystem,
  guards: ManifestGuards,
): Promise<DriftFinding | null> {
  if (artifact.kind === "config-entry") {
    throw new ManifestUnsupportedArtifactError();
  }
  const canonical = await guards.assertReadable(artifact.path);

  let stats;
  try {
    stats = await fs.lstat(canonical, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return finding(artifact, "missing", null);
    rethrowRedacted(error);
  }

  if (artifact.kind === "directory") {
    return stats.isDirectory() ? null : finding(artifact, "type_changed", null);
  }

  if (artifact.kind === "symlink") {
    if (!stats.isSymbolicLink()) return finding(artifact, "type_changed", null);
    let target: string;
    try {
      target = await fs.readlink(canonical);
    } catch (error) {
      rethrowRedacted(error);
    }
    const actualHash = hashBytes(new TextEncoder().encode(target));
    return actualHash === artifact.installedHash
      ? null
      : finding(artifact, "target_changed", actualHash);
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    return finding(artifact, "type_changed", null);
  }

  const actualHash = await hashGuardedFile(fs, guards, artifact.path, readBoundFor(artifact.source));
  if (actualHash === null) return finding(artifact, "missing", null);
  return actualHash === artifact.installedHash
    ? null
    : finding(artifact, "content_changed", actualHash);
}

export async function detectDrift(
  request: DriftRequest,
): Promise<readonly DriftFinding[]> {
  const findings: DriftFinding[] = [];
  for (const artifact of request.manifest.artifacts) {
    const result = await inspectArtifact(artifact, request.fs, request.guards);
    if (result !== null) findings.push(result);
  }
  return findings;
}

function v2Finding(
  artifact: ManagedArtifactV2,
  kind: DriftFinding["kind"],
  actualHash: string | null,
): DriftFinding {
  const expectedHash = kind === "schema_invalid" || artifact.kind === "directory" || artifact.verification.mode === "ephemeral"
    ? null
    : artifact.verification.mode === "block" ? artifact.verification.blockHash : artifact.verification.installedHash;
  return { path: artifact.path, owner: artifact.owner, kind, expectedHash, actualHash };
}

async function guardedV2Path(
  artifact: ManagedArtifactV2,
  request: DriftRequestV2,
): Promise<{ readonly canonical: string; readonly stats: BigIntStats } | null> {
  let canonical: string;
  try { canonical = await request.guards.assertReadable(artifact.path); } catch { throw new ManifestStateError(); }
  if (canonical !== artifact.path) throw new ManifestStateError();
  try { return { canonical: artifact.path, stats: await request.fs.lstat(artifact.path, { bigint: true }) }; }
  catch (error) { if (isMissing(error)) return null; throw new ManifestStateError(); }
}

async function readV2File(
  request: DriftRequestV2,
  canonical: string,
  before: BigIntStats,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (before.isSymbolicLink() || !before.isFile()) return null;
  if (before.size < 0n || before.size > BigInt(maxBytes)) throw new ManifestStateError();
  try { return await readStableRegularFile(request.fs, canonical, before, maxBytes); }
  catch (error) { if (isMissing(error)) return null; rethrowRedacted(error); }
}

async function inspectV2Artifact(artifact: ManagedArtifactV2, request: DriftRequestV2): Promise<DriftFinding | null> {
  const observed = await guardedV2Path(artifact, request);
  if (observed === null) return artifact.verification.mode === "ephemeral" ? null : v2Finding(artifact, "missing", null);
  const { canonical, stats } = observed;
  if (artifact.kind === "directory") return stats.isDirectory() ? null : v2Finding(artifact, "type_changed", null);
  if (artifact.kind === "symlink") {
    if (!stats.isSymbolicLink()) return v2Finding(artifact, "type_changed", null);
    let target: string;
    try { target = await request.fs.readlink(canonical); } catch { throw new ManifestStateError(); }
    let after;
    try { after = await request.fs.lstat(canonical, { bigint: true }); } catch { throw new ManifestStateError(); }
    if (!after.isSymbolicLink() || after.dev !== stats.dev || after.ino !== stats.ino) throw new ManifestStateError();
    const targetBytes = new TextEncoder().encode(target);
    if (targetBytes.byteLength > MAX_LINK_TARGET_BYTES) throw new ManifestStateError();
    const actualHash = hashBytes(targetBytes);
    return actualHash === artifact.verification.installedHash ? null : v2Finding(artifact, "target_changed", actualHash);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return v2Finding(artifact, "type_changed", null);
  if (artifact.verification.mode === "ephemeral") {
    try {
      if (typeof stats.uid !== "bigint" || typeof stats.mode !== "bigint" || typeof stats.nlink !== "bigint") throw new ManifestStateError();
      request.ephemerals.validate(artifact.owner, {
        path: artifact.path,
        uid: Number(stats.uid),
        mode: Number(stats.mode) & 0o777,
        nlink: Number(stats.nlink),
      });
      return null;
    } catch { return v2Finding(artifact, "schema_invalid", null); }
  }
  const bytes = await readV2File(request, canonical, stats, artifact.kind === "file" && artifact.verification.mode === "content" ? readBoundFor(artifact.source) : MAX_READ_BYTES);
  if (bytes === null) return v2Finding(artifact, "missing", null);
  if (artifact.verification.mode === "schema") {
    try { request.schemas.validate(artifact.verification.schemaId, bytes); return null; }
    catch { return v2Finding(artifact, "schema_invalid", null); }
  }
  if (artifact.verification.mode === "block") {
    const extraction = extractInstructionBlock(bytes);
    if (extraction.kind === "absent") return v2Finding(artifact, "missing", null);
    if (extraction.kind === "malformed") return v2Finding(artifact, "block_malformed", null);
    const blockHash = hashBytes(extraction.block);
    return blockHash === artifact.verification.blockHash ? null : v2Finding(artifact, "content_changed", blockHash);
  }
  const actualHash = hashBytes(bytes);
  return actualHash === artifact.verification.installedHash ? null : v2Finding(artifact, "content_changed", actualHash);
}

export async function inspectDrift(request: DriftRequestV2): Promise<readonly DriftFinding[]> {
  const findings: DriftFinding[] = [];
  for (const artifact of request.manifest.artifacts) {
    const result = await inspectV2Artifact(artifact, request);
    if (result !== null) findings.push(result);
  }
  return findings;
}

interface DiffEntry {
  readonly tag: " " | "-" | "+";
  readonly text: string;
  readonly beforeLine: number;
  readonly afterLine: number;
}

function splitLines(text: string): readonly string[] {
  return text.length === 0 ? [] : text.split("\n");
}

function commonSubsequence(
  before: readonly string[],
  after: readonly string[],
): Int32Array {
  const width = after.length + 1;
  const lengths = new Int32Array((before.length + 1) * width);
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      lengths[row * width + column] =
        before[row] === after[column]
          ? (lengths[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(
              lengths[(row + 1) * width + column] ?? 0,
              lengths[row * width + column + 1] ?? 0,
            );
    }
  }
  return lengths;
}

function diffLines(
  before: readonly string[],
  after: readonly string[],
): readonly DiffEntry[] {
  const width = after.length + 1;
  const lengths = commonSubsequence(before, after);
  const entries: DiffEntry[] = [];
  let row = 0;
  let column = 0;

  const push = (tag: DiffEntry["tag"], text: string): void => {
    entries.push({ tag, text, beforeLine: row + 1, afterLine: column + 1 });
  };

  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      push(" ", before[row] ?? "");
      row += 1;
      column += 1;
    } else if (
      (lengths[(row + 1) * width + column] ?? 0) >=
      (lengths[row * width + column + 1] ?? 0)
    ) {
      push("-", before[row] ?? "");
      row += 1;
    } else {
      push("+", after[column] ?? "");
      column += 1;
    }
  }
  while (row < before.length) {
    push("-", before[row] ?? "");
    row += 1;
  }
  while (column < after.length) {
    push("+", after[column] ?? "");
    column += 1;
  }
  return entries;
}

function selectHunkIndexes(entries: readonly DiffEntry[]): readonly number[] {
  const keep = new Set<number>();
  entries.forEach((entry, index) => {
    if (entry.tag === " ") return;
    for (
      let offset = index - DIFF_CONTEXT_LINES;
      offset <= index + DIFF_CONTEXT_LINES;
      offset += 1
    ) {
      if (offset >= 0 && offset < entries.length) keep.add(offset);
    }
  });
  return [...keep].sort((left, right) => left - right);
}

function renderHunk(hunk: readonly DiffEntry[]): readonly string[] {
  const first = hunk[0];
  if (first === undefined) return [];
  const beforeCount = hunk.filter((entry) => entry.tag !== "+").length;
  const afterCount = hunk.filter((entry) => entry.tag !== "-").length;
  const beforeStart = beforeCount === 0 ? 0 : first.beforeLine;
  const afterStart = afterCount === 0 ? 0 : first.afterLine;

  return [
    `@@ -${String(beforeStart)},${String(beforeCount)} +${String(afterStart)},${String(afterCount)} @@`,
    ...hunk.map((entry) => `${entry.tag}${entry.text}`),
  ];
}

function renderUnifiedDiff(entries: readonly DiffEntry[]): string {
  const indexes = selectHunkIndexes(entries);
  const lines: string[] = [];
  let hunk: DiffEntry[] = [];
  let previous = -1;

  for (const index of indexes) {
    if (previous !== -1 && index > previous + 1) {
      lines.push(...renderHunk(hunk));
      hunk = [];
    }
    const entry = entries[index];
    if (entry !== undefined) hunk.push(entry);
    previous = index;
  }
  lines.push(...renderHunk(hunk));
  return lines.join("\n");
}

function decode(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  return new TextDecoder().decode(bytes);
}

function unifiedDiffBody(current: Uint8Array, proposed: Uint8Array): string {
  if (current.length > MAX_DIFF_BYTES || proposed.length > MAX_DIFF_BYTES) {
    return OVERSIZED_NOTICE;
  }
  const currentText = decode(current);
  const proposedText = decode(proposed);
  if (currentText === null || proposedText === null) return BINARY_NOTICE;

  const before = splitLines(currentText);
  const after = splitLines(proposedText);
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return OVERSIZED_NOTICE;
  }
  return renderUnifiedDiff(diffLines(before, after));
}

function resolveBackupPath(backupsDir: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes("..")
  ) {
    throw new ManifestStateError();
  }
  const resolved = resolve(backupsDir, relativePath);
  if (!containsPath(backupsDir, resolved)) throw new ManifestStateError();
  return resolved;
}

export async function buildConflictEvidence(
  request: ConflictEvidenceRequest,
): Promise<ConflictEvidence> {
  if ("block" in request) {
    const { artifact, fileBytes, proposedBlock } = request.block;
    const extraction = extractInstructionBlock(fileBytes);
    if (extraction.kind !== "present") throw new ManifestStateError();
    return {
      path: artifact.path,
      baselineBackupRelativePath: artifact.backupRelativePath,
      baselineHash: artifact.verification.blockHash,
      currentHash: hashBytes(extraction.block),
      proposedHash: hashBytes(proposedBlock),
      diff: request.redactDiagnostic(unifiedDiffBody(extraction.block, proposedBlock)),
    };
  }
  const { artifact, backupsDir, proposed, fs, guards, redactDiagnostic } = request;

  let baselineHash: string | null = null;
  if (artifact.backupRelativePath !== null) {
    const backupPath = resolveBackupPath(backupsDir, artifact.backupRelativePath);
    // Lexical containment above only rejects `..`; a symlinked directory inside
    // the backups root would still escape it, and a forged manifest chooses
    // this string. Re-check on the canonical paths before reading.
    const [canonicalRoot, canonicalBackup] = await Promise.all([
      guards.assertReadable(backupsDir),
      guards.assertReadable(backupPath),
    ]);
    if (!containsPath(canonicalRoot, canonicalBackup)) {
      throw new ManifestStateError();
    }
    const baseline = await readGuardedFile(fs, guards, canonicalBackup);
    if (baseline === null) throw new ManifestStateError();
    baselineHash = hashBytes(baseline);
  }

  const current = await readGuardedFile(fs, guards, artifact.path);

  return {
    path: artifact.path,
    baselineBackupRelativePath: artifact.backupRelativePath,
    baselineHash,
    currentHash: current === null ? null : hashBytes(current),
    proposedHash: hashBytes(proposed),
    diff: redactDiagnostic(
      unifiedDiffBody(current ?? new Uint8Array(), proposed),
    ),
  };
}
