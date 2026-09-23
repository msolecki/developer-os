/**
 * Spec 1 §4.1 and §4.4's guarded metadata admission for the source
 * repository. Every leaf is lstat-checked against its `GitMetadataBoundsV1`
 * cap before any byte is read, read through a no-follow descriptor, and
 * re-lstat-checked afterwards; the result is an immutable projection of
 * hashes and semantics, never a handle.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { ValidatedGitBranchV1 } from "../config/lifecycle.js";
import {
  LifecycleRecoveryRequiredError,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "../lifecycle/guarded-fs.js";
import { EXIT_CODES, type Redactor } from "../result.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, type LowerHexSha256 } from "../update/scalars.js";
import {
  GIT_METADATA_BOUNDS,
  GIT_ZERO_OID,
  parseFullBranchRef,
  parseLowerHexSha1,
  type FullBranchRefV1,
  type GitHeadStateV1,
  type GitIndexStateV1,
  type GitRefStateV1,
  type GitReflogStateV1,
  type GitSourceStateV1,
} from "./types.js";

export type GitMetadataRefusalReasonV1 =
  | "git_repository_absent"
  | "git_metadata_symlink"
  | "git_metadata_unsupported_type"
  | "git_metadata_owner"
  | "git_metadata_hard_link"
  | "git_metadata_too_large"
  | "git_metadata_identity_changed"
  | "git_config_secret"
  | "unsupported_repository_config"
  | "unsupported_repository_format"
  | "unsupported_repository_layout"
  | "unsupported_index_format"
  | "unsupported_ref_format"
  | "unsupported_reflog_layout"
  | "detached_head"
  | "branch_mismatch";

/**
 * A refusal before intent: nothing was reserved, copied or written, so the
 * reason is the whole publishable finding. A secret in the config publishes
 * only its class, never the matching value.
 */
export class GitMetadataRefusalError extends Error {
  readonly code: typeof EXIT_CODES.securityRefusal | typeof EXIT_CODES.operationalFailure;
  readonly reason: GitMetadataRefusalReasonV1;

  constructor(reason: GitMetadataRefusalReasonV1, options?: ErrorOptions) {
    super(`git metadata refused: ${reason}`, options);
    this.name = "GitMetadataRefusalError";
    this.reason = reason;
    this.code = reason === "git_config_secret" ? EXIT_CODES.securityRefusal : EXIT_CODES.operationalFailure;
  }
}

function refuse(reason: GitMetadataRefusalReasonV1, cause?: unknown): never {
  throw new GitMetadataRefusalError(reason, cause === undefined ? undefined : { cause });
}

export type GitMetadataStreamV1 = (
  entry: LifecycleGuardedEntryV1,
  maximumBytes: number,
) => AsyncIterable<Uint8Array>;

export interface GitMetadataDependencies {
  readonly fs: Pick<LifecycleGuardedFileSystemV1, "lstat" | "readRegular">;
  /** Streams an index or reflog without materializing it; see `createNodeGitMetadataStream`. */
  readonly streamRegular: GitMetadataStreamV1;
  readonly redact: Redactor;
  readonly effectiveUid: number;
}

export interface GitMetadataRequestV1 {
  /** The canonical vault root; its direct `.git` child is the only admitted Git directory. */
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  /** The recorded branch, or null while `git enable` adopts the attached one. */
  readonly branch: ValidatedGitBranchV1 | null;
}

const STREAM_CHUNK_BYTES = 1_048_576;
const SHA1_BYTES = 20;
const INDEX_HEADER_BYTES = 12;
const INDEX_ENTRY_FIXED_BYTES = 62;
const INDEX_NAME_LENGTH_MASK = 0x0fff;
const INDEX_FLAG_ASSUME_VALID = 0x8000;
const INDEX_FLAG_EXTENDED = 0x4000;
const INDEX_FLAG_STAGE = 0x3000;
const INDEX_REGULAR_MODE = 0o100644;
const INDEX_EXECUTABLE_MODE = 0o100755;
const INDEX_SYMLINK_MODE = 0o120000;
const LF = 0x0a;

/**
 * Presence alone refuses: each is a repository shape spec §4.1 excludes
 * (linked worktree, alternates, shallow or grafted history), and packed refs
 * are an unlisted ref representation, so a loose-ref read would misreport an
 * absent branch.
 */
const REFUSED_PRESENCE: readonly (readonly [string, GitMetadataRefusalReasonV1])[] = [
  ["commondir", "unsupported_repository_layout"],
  ["gitdir", "unsupported_repository_layout"],
  ["objects/info/alternates", "unsupported_repository_layout"],
  ["objects/info/http-alternates", "unsupported_repository_layout"],
  ["shallow", "unsupported_repository_layout"],
  ["info/grafts", "unsupported_repository_layout"],
  ["packed-refs", "unsupported_ref_format"],
];

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

function child(parent: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${parent}/${relative}`);
}

function admitDirectory(entry: LifecycleGuardedEntryV1, effectiveUid: number): void {
  if (entry.kind === "symlink") refuse("git_metadata_symlink");
  if (entry.kind !== "directory") refuse("git_metadata_unsupported_type");
  if (entry.ownerUid !== effectiveUid) refuse("git_metadata_owner");
}

function admitRegular(entry: LifecycleGuardedEntryV1, effectiveUid: number, maximumBytes: number): void {
  if (entry.kind === "symlink") refuse("git_metadata_symlink");
  if (entry.kind !== "regular_file") refuse("git_metadata_unsupported_type");
  if (entry.ownerUid !== effectiveUid) refuse("git_metadata_owner");
  if (entry.nlink !== 1) refuse("git_metadata_hard_link");
  if (BigInt(entry.size) > BigInt(maximumBytes)) refuse("git_metadata_too_large");
}

class GitMetadataReader {
  readonly #dependencies: GitMetadataDependencies;
  readonly #gitDirectory: CanonicalAbsolutePathV1;

  constructor(dependencies: GitMetadataDependencies, gitDirectory: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#gitDirectory = gitDirectory;
  }

  /** Every ancestor below `.git` must be a real owned directory; a missing one means an absent leaf. */
  async lstatLeaf(relative: string): Promise<LifecycleGuardedEntryV1 | null> {
    const components = relative.split("/");
    let path = this.#gitDirectory;
    for (const component of components.slice(0, -1)) {
      path = child(path, component);
      const ancestor = await this.#dependencies.fs.lstat(path);
      if (ancestor === null) return null;
      admitDirectory(ancestor, this.#dependencies.effectiveUid);
    }
    return this.#dependencies.fs.lstat(child(this.#gitDirectory, relative));
  }

  async #requireUnchanged(entry: LifecycleGuardedEntryV1): Promise<void> {
    if (!sameLifecycleGuardedIdentity(await this.#dependencies.fs.lstat(entry.path), entry)) {
      refuse("git_metadata_identity_changed");
    }
  }

  async readSmall(relative: string, maximumBytes: number): Promise<Uint8Array | null> {
    const entry = await this.lstatLeaf(relative);
    if (entry === null) return null;
    admitRegular(entry, this.#dependencies.effectiveUid, maximumBytes);
    let bytes: Uint8Array;
    try {
      bytes = await this.#dependencies.fs.readRegular(entry, maximumBytes);
    } catch (error) {
      if (error instanceof LifecycleRecoveryRequiredError) refuse("git_metadata_identity_changed", error);
      throw error;
    }
    await this.#requireUnchanged(entry);
    return bytes;
  }

  async stream<T>(
    relative: string,
    maximumBytes: number,
    consume: (entry: LifecycleGuardedEntryV1, chunks: AsyncIterable<Uint8Array>) => Promise<T>,
  ): Promise<T | null> {
    const entry = await this.lstatLeaf(relative);
    if (entry === null) return null;
    admitRegular(entry, this.#dependencies.effectiveUid, maximumBytes);
    const result = await consume(entry, this.#dependencies.streamRegular(entry, maximumBytes));
    await this.#requireUnchanged(entry);
    return result;
  }
}

interface GitConfigEntryV1 {
  readonly section: string;
  readonly subsection: string | null;
  readonly name: string;
  /** Null is Git's bare-key boolean `true`. */
  readonly value: string | null;
}

function isSpace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

/**
 * A strict reader for the one Git config dialect spec §4.1 admits as inert
 * planning data. It never follows includes; anything it cannot read exactly
 * (CR line endings, unknown escapes, unterminated quotes) refuses instead of
 * guessing what Git would have done.
 */
function parseGitConfig(text: string): readonly GitConfigEntryV1[] {
  const entries: GitConfigEntryV1[] = [];
  let index = 0;
  let section: string | null = null;
  let subsection: string | null = null;
  const bad: () => never = () => refuse("unsupported_repository_config");
  if (text.includes("\r") || text.includes("\0")) bad();

  const skipSpace = (): void => {
    while (isSpace(text[index])) index += 1;
  };
  const atLineEnd = (): boolean => index >= text.length || text[index] === "\n";
  const skipComment = (): void => {
    if (text[index] === "#" || text[index] === ";") {
      while (!atLineEnd()) index += 1;
    }
  };

  const parseValue = (): string => {
    let value = "";
    let pendingSpace = "";
    let quoted = false;
    for (;;) {
      const character = text[index];
      if (character === undefined || character === "\n") {
        if (quoted) bad();
        return value;
      }
      if (!quoted && (character === "#" || character === ";")) {
        skipComment();
        return value;
      }
      index += 1;
      if (!quoted && isSpace(character)) {
        if (value.length > 0) pendingSpace += character;
        continue;
      }
      value += pendingSpace;
      pendingSpace = "";
      if (character === '"') {
        quoted = !quoted;
        continue;
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      const escaped = text[index];
      index += 1;
      if (escaped === "\n") continue;
      if (escaped === "\\" || escaped === '"') value += escaped;
      else if (escaped === "n") value += "\n";
      else if (escaped === "t") value += "\t";
      else if (escaped === "b") value += "\b";
      else bad();
    }
  };

  const parseKey = (): void => {
    if (section === null) bad();
    const start = index;
    if (!/[A-Za-z]/.test(text[index] ?? "")) bad();
    while (/[A-Za-z0-9-]/.test(text[index] ?? "")) index += 1;
    const name = text.slice(start, index).toLowerCase();
    skipSpace();
    let value: string | null = null;
    if (text[index] === "=") {
      index += 1;
      skipSpace();
      value = parseValue();
    } else {
      skipComment();
    }
    if (!atLineEnd()) bad();
    entries.push({ section, subsection, name, value });
  };

  const parseHeader = (): void => {
    index += 1;
    const start = index;
    while (/[A-Za-z0-9.-]/.test(text[index] ?? "")) index += 1;
    const name = text.slice(start, index);
    if (name.length === 0) bad();
    if (text[index] === "]") {
      index += 1;
      const dot = name.indexOf(".");
      section = (dot < 0 ? name : name.slice(0, dot)).toLowerCase();
      subsection = dot < 0 ? null : name.slice(dot + 1).toLowerCase();
      if (section.length === 0 || subsection === "") bad();
      return;
    }
    if (!isSpace(text[index]) || name.includes(".")) bad();
    skipSpace();
    if (text[index] !== '"') bad();
    index += 1;
    let value = "";
    for (;;) {
      const character = text[index];
      index += 1;
      if (character === undefined || character === "\n") bad();
      if (character === '"') break;
      if (character === "\\") {
        const escaped = text[index];
        index += 1;
        if (escaped === undefined || escaped === "\n") bad();
        value += escaped;
        continue;
      }
      value += character;
    }
    if (text[index] !== "]") bad();
    index += 1;
    section = name.toLowerCase();
    subsection = value;
  };

  while (index < text.length) {
    skipSpace();
    if (text[index] === "[") {
      parseHeader();
      skipSpace();
    }
    skipComment();
    if (!atLineEnd()) parseKey();
    if (text[index] === "\n") index += 1;
  }
  return entries;
}

function gitBoolean(value: string | null): boolean {
  if (value === null) return true;
  const normalized = value.toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0", ""].includes(normalized)) return false;
  return refuse("unsupported_repository_config");
}

/**
 * Spec §4.1's closed version-1 allowlist, checked on the clean snapshot:
 * format 0, non-bare, no extensions, no worktree/sparse/split/promisor
 * configuration and no includes.
 */
function admitRepositoryConfig(entries: readonly GitConfigEntryV1[]): void {
  for (const entry of entries) {
    const key = `${entry.section}.${entry.name}`;
    if (entry.section === "include" || entry.section === "includeif") refuse("unsupported_repository_config");
    if (entry.section === "extensions") refuse("unsupported_repository_format");
    if (entry.subsection === null && key === "core.repositoryformatversion" && entry.value !== "0") {
      refuse("unsupported_repository_format");
    }
    if (entry.subsection === null && key === "core.bare" && gitBoolean(entry.value)) {
      refuse("unsupported_repository_layout");
    }
    if (entry.subsection === null && key === "core.worktree") refuse("unsupported_repository_layout");
    if (entry.subsection === null && key === "core.sparsecheckout" && gitBoolean(entry.value)) {
      refuse("unsupported_repository_format");
    }
    if (entry.subsection === null && key === "core.splitindex" && gitBoolean(entry.value)) {
      refuse("unsupported_index_format");
    }
    if (entry.subsection === null && key === "index.sparse" && gitBoolean(entry.value)) {
      refuse("unsupported_index_format");
    }
    if (entry.section === "remote" && (entry.name === "promisor" || entry.name === "partialclonefilter")) {
      refuse("unsupported_repository_format");
    }
  }
}

function parseHead(bytes: Uint8Array): GitHeadStateV1 {
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return refuse("unsupported_ref_format");
  }
  const bytesHash = sha256(bytes);
  if (text.startsWith("ref: ") && text.endsWith("\n")) {
    let value: FullBranchRefV1;
    try {
      value = parseFullBranchRef(text.slice("ref: ".length, -1));
    } catch {
      return refuse("unsupported_ref_format");
    }
    return { state: "present", bytesHash, semantic: { kind: "symbolic_ref", value } };
  }
  if (/^[0-9a-f]{40}\n$/.test(text) && text.slice(0, 40) !== GIT_ZERO_OID) {
    return { state: "present", bytesHash, semantic: { kind: "oid", value: parseLowerHexSha1(text.slice(0, 40)) } };
  }
  return refuse("unsupported_ref_format");
}

function parseLooseRef(bytes: Uint8Array): GitRefStateV1 {
  const text = String.fromCharCode(...bytes);
  if (!/^[0-9a-f]{40}\n$/.test(text) || text.slice(0, 40) === GIT_ZERO_OID) refuse("unsupported_ref_format");
  return { state: "present", oid: parseLowerHexSha1(text.slice(0, 40)), bytesHash: sha256(bytes) };
}

/**
 * Pull-based framing over a guarded stream whose exact length is known from
 * the admitted lstat. It hashes every byte as it arrives and keeps at most
 * one chunk plus the requested frame resident, so a 512-MiB index is never
 * materialized.
 */
class FramedStream {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #size: number;
  readonly #checksumEnd: number;
  readonly #sha256 = createHash("sha256");
  readonly #sha1 = createHash("sha1");
  #buffer = new Uint8Array(0);
  #offset = 0;
  #received = 0;
  #taken = 0;

  constructor(chunks: AsyncIterable<Uint8Array>, size: number, checksumBytes: number) {
    this.#iterator = chunks[Symbol.asyncIterator]();
    this.#size = size;
    this.#checksumEnd = size - checksumBytes;
  }

  get position(): number {
    return this.#taken;
  }

  async #pull(): Promise<boolean> {
    const next = await this.#iterator.next();
    if (next.done === true) return false;
    const chunk = next.value;
    const start = this.#received;
    this.#received += chunk.byteLength;
    if (this.#received > this.#size) refuse("git_metadata_identity_changed");
    this.#sha256.update(chunk);
    if (start < this.#checksumEnd) {
      this.#sha1.update(chunk.subarray(0, Math.min(chunk.byteLength, this.#checksumEnd - start)));
    }
    const remaining = this.#buffer.subarray(this.#offset);
    const joined = new Uint8Array(remaining.byteLength + chunk.byteLength);
    joined.set(remaining, 0);
    joined.set(chunk, remaining.byteLength);
    this.#buffer = joined;
    this.#offset = 0;
    return true;
  }

  async take(length: number, malformed: GitMetadataRefusalReasonV1): Promise<Uint8Array> {
    if (length < 0 || this.#taken + length > this.#size) refuse(malformed);
    while (this.#buffer.byteLength - this.#offset < length) {
      if (!(await this.#pull())) refuse("git_metadata_identity_changed");
    }
    const frame = this.#buffer.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    this.#taken += length;
    return frame;
  }

  async finish(): Promise<{ readonly sha256: LowerHexSha256; readonly checksum: Uint8Array }> {
    if (this.#taken !== this.#size || (await this.#pull())) refuse("git_metadata_identity_changed");
    await this.#iterator.return?.();
    return {
      sha256: parseLowerHexSha256(this.#sha256.digest("hex")),
      checksum: new Uint8Array(this.#sha1.digest()),
    };
  }

  async abandon(): Promise<void> {
    await this.#iterator.return?.();
  }
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function admitIndexEntryName(name: Uint8Array): void {
  if (name.byteLength === 0 || name.includes(0) || name[0] === 0x2f || name[name.byteLength - 1] === 0x2f) {
    refuse("unsupported_index_format");
  }
  const text = String.fromCharCode(...name.subarray(0, Math.min(name.byteLength, 4096)));
  for (const component of text.split("/")) {
    if (component === "" || component === "." || component === ".." || component.toLowerCase() === ".git") {
      refuse("unsupported_index_format");
    }
  }
}

/**
 * The `TREE` extension is a pre-order list of nodes: a NUL-terminated
 * component, an ASCII entry count (`-1` marks an invalidated node) and
 * subtree count, then an OID for a valid node. An explicit stack walks it so
 * nesting depth cannot exhaust the call stack.
 */
function admitTreeExtension(data: Uint8Array): void {
  const bad: () => never = () => refuse("unsupported_index_format");
  let position = 0;
  const pending: number[] = [1];
  let root = true;
  while (pending.length > 0) {
    const top = pending.length - 1;
    if (pending[top] === 0) {
      pending.pop();
      continue;
    }
    pending[top] = (pending[top] as number) - 1;
    const nul = data.indexOf(0, position);
    if (nul < 0) bad();
    const component = data.subarray(position, nul);
    if (root ? component.byteLength !== 0 : component.byteLength === 0 || component.includes(0x2f)) bad();
    root = false;
    const newline = data.indexOf(LF, nul + 1);
    if (newline < 0) bad();
    const match = /^(-1|0|[1-9][0-9]{0,9}) (0|[1-9][0-9]{0,9})$/.exec(
      String.fromCharCode(...data.subarray(nul + 1, newline)),
    );
    if (match === null) return bad();
    position = newline + 1;
    if (match[1] !== "-1") {
      if (position + SHA1_BYTES > data.byteLength) bad();
      position += SHA1_BYTES;
    }
    const subtrees = Number(match[2]);
    if (subtrees > 0) pending.push(subtrees);
  }
  if (position !== data.byteLength) bad();
}

/**
 * Spec §4.1: `DIRC` version 2, stage-zero entries only, neither assume-valid
 * nor extended flags, no sparse-directory or gitlink entry, strictly sorted
 * names, at most one structurally valid `TREE` extension, and a matching
 * SHA-1 trailer. Split index (`link`) and every other extension refuse.
 */
async function admitIndex(chunks: AsyncIterable<Uint8Array>, size: number): Promise<GitIndexStateV1> {
  const bad = "unsupported_index_format";
  if (size < INDEX_HEADER_BYTES + SHA1_BYTES) refuse(bad);
  const stream = new FramedStream(chunks, size, SHA1_BYTES);
  try {
    const header = await stream.take(INDEX_HEADER_BYTES, bad);
    if (String.fromCharCode(...header.subarray(0, 4)) !== "DIRC" || readUInt32(header, 4) !== 2) refuse(bad);
    const count = readUInt32(header, 8);
    let previous: Uint8Array | null = null;
    for (let entry = 0; entry < count; entry += 1) {
      const fixed = await stream.take(INDEX_ENTRY_FIXED_BYTES, bad);
      const mode = readUInt32(fixed, 24);
      const flags = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength).getUint16(60);
      if ((flags & (INDEX_FLAG_ASSUME_VALID | INDEX_FLAG_EXTENDED | INDEX_FLAG_STAGE)) !== 0) refuse(bad);
      if (mode !== INDEX_REGULAR_MODE && mode !== INDEX_EXECUTABLE_MODE && mode !== INDEX_SYMLINK_MODE) refuse(bad);
      const nameLength = flags & INDEX_NAME_LENGTH_MASK;
      if (nameLength === INDEX_NAME_LENGTH_MASK) refuse(bad);
      const name = await stream.take(nameLength, bad);
      admitIndexEntryName(name);
      const padding = await stream.take(8 - ((INDEX_ENTRY_FIXED_BYTES + nameLength) % 8), bad);
      if (padding.some((byte) => byte !== 0)) refuse(bad);
      if (previous !== null && compareBytes(previous, name) >= 0) refuse(bad);
      previous = name;
    }
    let tree = false;
    while (stream.position < size - SHA1_BYTES) {
      const extension = await stream.take(8, bad);
      if (String.fromCharCode(...extension.subarray(0, 4)) !== "TREE" || tree) refuse(bad);
      tree = true;
      const length = readUInt32(extension, 4);
      if (stream.position + length > size - SHA1_BYTES) refuse(bad);
      admitTreeExtension(await stream.take(length, bad));
    }
    const trailer = await stream.take(SHA1_BYTES, bad);
    const { sha256: bytesHash, checksum } = await stream.finish();
    if (compareBytes(trailer, checksum) !== 0) refuse(bad);
    return { state: "present", bytesHash };
  } catch (error) {
    await stream.abandon();
    throw error;
  }
}

/** Spec §2.4: a present log is copied later byte for byte, so it must be empty or LF-terminated. */
async function admitReflog(chunks: AsyncIterable<Uint8Array>, size: number): Promise<GitReflogStateV1> {
  const digest = createHash("sha256");
  let last: number | undefined;
  let received = 0;
  for await (const chunk of chunks) {
    received += chunk.byteLength;
    if (received > size) refuse("git_metadata_identity_changed");
    digest.update(chunk);
    if (chunk.byteLength > 0) last = chunk[chunk.byteLength - 1];
  }
  if (received !== size) refuse("git_metadata_identity_changed");
  if (size > 0 && last !== LF) refuse("unsupported_reflog_layout");
  return { state: "present", bytesHash: parseLowerHexSha256(digest.digest("hex")), size };
}

export async function inspectGitMetadata(
  dependencies: GitMetadataDependencies,
  request: GitMetadataRequestV1,
): Promise<GitSourceStateV1> {
  const bounds = GIT_METADATA_BOUNDS;
  const gitDirectory = child(request.repositoryRoot, ".git");
  const root = await dependencies.fs.lstat(gitDirectory);
  if (root === null) refuse("git_repository_absent");
  if (root.kind === "regular_file") refuse("unsupported_repository_layout");
  admitDirectory(root, dependencies.effectiveUid);
  const reader = new GitMetadataReader(dependencies, gitDirectory);

  for (const [relative, reason] of REFUSED_PRESENCE) {
    if ((await reader.lstatLeaf(relative)) !== null) refuse(reason);
  }

  const configBytes = await reader.readSmall("config", bounds.sourceConfigMaxBytes);
  if (configBytes === null) refuse("unsupported_repository_config");
  let configText: string;
  try {
    configText = strictUtf8.decode(configBytes);
  } catch {
    return refuse("unsupported_repository_config");
  }
  if (dependencies.redact(configText) !== configText) refuse("git_config_secret");
  admitRepositoryConfig(parseGitConfig(configText));
  const configHash = sha256(configBytes);

  const headBytes = await reader.readSmall("HEAD", bounds.sourceHeadMaxBytes);
  if (headBytes === null) refuse("unsupported_ref_format");
  const head = parseHead(headBytes);
  if (head.semantic.kind !== "symbolic_ref") refuse("detached_head");
  const branchRefName = head.semantic.value;
  if (request.branch !== null && branchRefName !== `refs/heads/${request.branch}`) refuse("branch_mismatch");

  const refBytes = await reader.readSmall(branchRefName, bounds.looseRefMaxBytes);
  const branchRef: GitRefStateV1 = refBytes === null ? { state: "absent" } : parseLooseRef(refBytes);

  const index =
    (await reader.stream("index", bounds.sourceIndexMaxBytes, (entry, chunks) =>
      admitIndex(chunks, Number(entry.size)),
    )) ?? ({ state: "absent" } as const);
  if (index.state === "absent" && branchRef.state === "present") refuse("unsupported_index_format");

  const reflog = async (relative: string, maximumBytes: number): Promise<GitReflogStateV1> =>
    (await reader.stream(relative, maximumBytes, (entry, chunks) => admitReflog(chunks, Number(entry.size)))) ?? {
      state: "absent",
    };
  const headReflog = await reflog("logs/HEAD", bounds.sourceHeadReflogMaxBytes);
  const branchReflog = await reflog(`logs/${branchRefName}`, bounds.sourceBranchReflogMaxBytes);

  return { configHash, index, head, headReflog, branchReflog, branchRef };
}

/**
 * The Node implementation of `GitMetadataDependencies.streamRegular`. It
 * opens with `O_NOFOLLOW`, binds the descriptor to the admitted entry's
 * `dev`/`ino`/owner/mode/link/size before the first read and again after the
 * last, counts every byte against the cap, and never reads past cap + 1.
 */
export function createNodeGitMetadataStream(): GitMetadataStreamV1 {
  async function sameAsEntry(handle: FileHandle, entry: LifecycleGuardedEntryV1): Promise<boolean> {
    const stats = await handle.stat({ bigint: true });
    return (
      stats.isFile() &&
      stats.dev.toString(10) === entry.dev &&
      stats.ino.toString(10) === entry.ino &&
      Number(stats.uid) === entry.ownerUid &&
      Number(stats.mode & 0o777n) === entry.mode &&
      Number(stats.nlink) === entry.nlink &&
      stats.size.toString(10) === entry.size
    );
  }

  return async function* streamRegular(entry, maximumBytes) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("maximumBytes must be a safe integer");
    if (BigInt(entry.size) > BigInt(maximumBytes)) refuse("git_metadata_too_large");
    let handle: FileHandle;
    try {
      handle = await nodeFs.open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      return refuse("git_metadata_identity_changed", error);
    }
    try {
      if (!(await sameAsEntry(handle, entry))) refuse("git_metadata_identity_changed");
      let total = 0;
      for (;;) {
        const chunk = new Uint8Array(Math.min(STREAM_CHUNK_BYTES, maximumBytes - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maximumBytes) refuse("git_metadata_too_large");
        yield chunk.subarray(0, bytesRead);
      }
      if (total.toString(10) !== entry.size || !(await sameAsEntry(handle, entry))) {
        refuse("git_metadata_identity_changed");
      }
    } finally {
      await handle.close();
    }
  };
}
