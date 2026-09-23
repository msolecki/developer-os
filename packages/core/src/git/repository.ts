/**
 * Spec 1 §4.1 and §4.4's pure repository arithmetic: loose-object bytes and
 * OIDs, bottom-up trees, the candidate index with its regenerated `TREE`
 * cache, commit bytes and the minimal enable-time `.git`. Nothing here
 * touches the filesystem or spawns Git; Security's quarantine later
 * recomputes the same OIDs with `git mktree -z` and `git commit-tree`.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import type { NormalizedRemoteUrlV1, ValidatedGitBranchV1 } from "../config/lifecycle.js";
import { hashCanonicalJson } from "../lifecycle/canonical-json.js";
import { parseLowerHexSha256, type LowerHexSha256 } from "../update/scalars.js";
import { GitMetadataRefusalError, parseGitConfig } from "./metadata.js";
import { GIT_METADATA_BOUNDS, compareUnsignedUtf8, parseLowerHexSha1, type LowerHexSha1 } from "./types.js";

export const GIT_EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904" as LowerHexSha1;
export const GIT_SYNC_COMMIT_MESSAGE = "chore(brain): sync" as const;
export const GIT_REMOTE_NAME = "developer-os";

/**
 * Spec §4.1 names these as in-progress history operations; any one of them
 * present under `.git` refuses sync, because recovery is user-owned.
 */
export const GIT_HISTORY_OPERATION_MARKERS: readonly string[] = Object.freeze([
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
]);

export type GitObjectTypeV1 = "blob" | "tree" | "commit";

export interface GitObjectV1 {
  readonly type: GitObjectTypeV1;
  readonly oid: LowerHexSha1;
  /** The uncompressed `<type> <size>\0<content>` bytes the OID hashes. */
  readonly raw: Uint8Array;
}

export interface GitCommitterV1 {
  readonly name: string;
  readonly email: string;
  readonly unixSeconds: number;
  readonly utcOffset: string;
}

/** One stage-zero index entry; `raw` is its exact on-disk bytes including NUL padding. */
export interface GitIndexEntryV1 {
  readonly name: Uint8Array;
  readonly mode: number;
  readonly oid: LowerHexSha1;
  readonly raw: Uint8Array;
}

export interface GitAdmittedIndexV1 {
  readonly entries: readonly GitIndexEntryV1[];
  readonly hasTreeCache: boolean;
}

export interface GitTreeNodeV1 {
  /** Slash-joined directory bytes relative to the worktree; the root is empty. */
  readonly directory: Uint8Array;
  readonly object: GitObjectV1;
  readonly entryCount: number;
  readonly subtrees: readonly { readonly name: Uint8Array; readonly node: GitTreeNodeV1 }[];
  /** Spec §7's NUL-delimited `git mktree -z` grammar for exactly this tree. */
  readonly mktreeInput: Uint8Array;
}

export interface GitInitialDirectoryEntryV1 {
  readonly relativePath: string;
  readonly kind: "directory" | "regular_file";
  readonly mode: number;
  readonly bytes: Uint8Array | null;
}

export interface GitInitialDirectoryPlanV1 {
  readonly entries: readonly GitInitialDirectoryEntryV1[];
  readonly treeHash: LowerHexSha256;
  readonly totalBytes: number;
}

const encoder = new TextEncoder();
const SHA1_BYTES = 20;
const INDEX_HEADER_BYTES = 12;
const INDEX_ENTRY_FIXED_BYTES = 62;
const INDEX_NAME_LENGTH_MASK = 0x0fff;
const SLASH = 0x2f;
const TREE_MODE = "40000";
const INITIAL_TREE_DOMAIN = "developer-os:git-initial-tree:v1";

function sha1Hex(bytes: Uint8Array): LowerHexSha1 {
  return parseLowerHexSha1(createHash("sha1").update(bytes).digest("hex"));
}

function sha256(bytes: Uint8Array): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex"));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function oidBytes(oid: LowerHexSha1): Uint8Array {
  return Uint8Array.from(Buffer.from(oid, "hex"));
}

function refuseIndex(): never {
  throw new GitMetadataRefusalError("unsupported_index_format");
}

export function gitObject(type: GitObjectTypeV1, content: Uint8Array): GitObjectV1 {
  const raw = concat([encoder.encode(`${type} ${content.byteLength.toString(10)}\0`), content]);
  return { type, oid: sha1Hex(raw), raw };
}

/** `objects/<2>/<38>`, relative to the Git directory. */
export function looseObjectRelativePath(oid: LowerHexSha1): string {
  return `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
}

/**
 * The staged postimage bytes of a loose object. Level 1 is Git's own
 * `core.looseCompression` default; the OID covers only the inflated bytes, so
 * the level decides the planned file hash, never object identity.
 */
export function looseObjectBytes(object: GitObjectV1): Uint8Array {
  return Uint8Array.from(deflateSync(object.raw, { level: 1 }));
}

/**
 * Framing over index bytes `inspectGitMetadata` already admitted and the
 * caller re-hashed against `GitIndexStateV1.bytesHash`; the checks here are
 * bounds, not a second format policy.
 */
export function parseAdmittedGitIndex(bytes: Uint8Array): GitAdmittedIndexV1 {
  if (bytes.byteLength < INDEX_HEADER_BYTES + SHA1_BYTES) refuseIndex();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(8);
  const end = bytes.byteLength - SHA1_BYTES;
  const entries: GitIndexEntryV1[] = [];
  let offset = INDEX_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset + INDEX_ENTRY_FIXED_BYTES > end) refuseIndex();
    const nameLength = view.getUint16(offset + 60) & INDEX_NAME_LENGTH_MASK;
    const length = INDEX_ENTRY_FIXED_BYTES + nameLength + (8 - ((INDEX_ENTRY_FIXED_BYTES + nameLength) % 8));
    if (offset + length > end) refuseIndex();
    entries.push({
      name: bytes.slice(offset + INDEX_ENTRY_FIXED_BYTES, offset + INDEX_ENTRY_FIXED_BYTES + nameLength),
      mode: view.getUint32(offset + 24),
      oid: parseLowerHexSha1(Buffer.from(bytes.subarray(offset + 40, offset + 60)).toString("hex")),
      raw: bytes.slice(offset, offset + length),
    });
    offset += length;
  }
  return { entries, hasTreeCache: offset < end };
}

/**
 * A new or replaced entry. Its stat fields are zero: Git then re-hashes the
 * worktree file on its next status instead of trusting stale stat data,
 * which is slower but never wrong.
 */
export function gitIndexEntry(name: Uint8Array, mode: number, oid: LowerHexSha1, size: number): GitIndexEntryV1 {
  if (name.byteLength === 0 || name.byteLength >= INDEX_NAME_LENGTH_MASK) refuseIndex();
  const length = INDEX_ENTRY_FIXED_BYTES + name.byteLength + (8 - ((INDEX_ENTRY_FIXED_BYTES + name.byteLength) % 8));
  const raw = new Uint8Array(length);
  const view = new DataView(raw.buffer);
  view.setUint32(24, mode);
  view.setUint32(36, size % 2 ** 32);
  raw.set(oidBytes(oid), 40);
  view.setUint16(60, name.byteLength);
  raw.set(name, INDEX_ENTRY_FIXED_BYTES);
  return { name: Uint8Array.from(name), mode, oid, raw };
}

function blobModeText(mode: number): string {
  if (mode === 0o100644 || mode === 0o100755 || mode === 0o120000) return mode.toString(8);
  return refuseIndex();
}

/** Git's tree order: a subtree sorts as if its name ended in `/`. */
function treeSortKey(name: Uint8Array, tree: boolean): Uint8Array {
  return tree ? concat([name, Uint8Array.of(SLASH)]) : name;
}

/** Git's cache-tree keeps subtrees ordered by name length first, then bytes. */
function cacheTreeOrder(left: Uint8Array, right: Uint8Array): number {
  return left.byteLength !== right.byteLength ? left.byteLength - right.byteLength : compareBytes(left, right);
}

/**
 * Builds every tree bottom-up from index-ordered entries. A name used as
 * both a file and a directory, or listed twice, refuses rather than letting
 * the candidate tree silently drop one side.
 */
export function buildGitTree(entries: readonly GitIndexEntryV1[]): GitTreeNodeV1 {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareBytes((entries[index - 1] as GitIndexEntryV1).name, (entries[index] as GitIndexEntryV1).name) >= 0) {
      refuseIndex();
    }
  }
  const build = (slice: readonly GitIndexEntryV1[], depth: number, directory: Uint8Array): GitTreeNodeV1 => {
    const items: { name: Uint8Array; tree: boolean; mode: string; oid: LowerHexSha1; typeName: string }[] = [];
    const subtrees: { name: Uint8Array; node: GitTreeNodeV1 }[] = [];
    let index = 0;
    while (index < slice.length) {
      const entry = slice[index] as GitIndexEntryV1;
      const rest = entry.name.subarray(depth);
      const slash = rest.indexOf(SLASH);
      if (slash < 0) {
        items.push({ name: rest, tree: false, mode: blobModeText(entry.mode), oid: entry.oid, typeName: "blob" });
        index += 1;
        continue;
      }
      const component = rest.subarray(0, slash);
      const prefix = entry.name.subarray(0, depth + slash + 1);
      let stop = index;
      while (
        stop < slice.length &&
        compareBytes((slice[stop] as GitIndexEntryV1).name.subarray(0, prefix.byteLength), prefix) === 0
      ) {
        stop += 1;
      }
      const childDirectory = entry.name.slice(0, depth + slash);
      const node = build(slice.slice(index, stop), depth + slash + 1, childDirectory);
      subtrees.push({ name: Uint8Array.from(component), node });
      items.push({ name: component, tree: true, mode: TREE_MODE, oid: node.object.oid, typeName: "tree" });
      index = stop;
    }
    items.sort((left, right) => compareBytes(treeSortKey(left.name, left.tree), treeSortKey(right.name, right.tree)));
    const names = new Set(items.map((item) => Buffer.from(item.name).toString("latin1")));
    if (names.size !== items.length) refuseIndex();
    const content = concat(
      items.flatMap((item) => [encoder.encode(`${item.mode} `), item.name, Uint8Array.of(0), oidBytes(item.oid)]),
    );
    const mktreeInput = concat(
      items.flatMap((item) => [
        encoder.encode(`${item.tree ? "040000" : item.mode} ${item.typeName} ${item.oid}\t`),
        item.name,
        Uint8Array.of(0),
      ]),
    );
    subtrees.sort((left, right) => cacheTreeOrder(left.name, right.name));
    return { directory, object: gitObject("tree", content), entryCount: slice.length, subtrees, mktreeInput };
  };
  return build(entries, 0, new Uint8Array(0));
}

/** Every node in pre-order, the order the `TREE` extension lists them in. */
export function gitTreeNodes(root: GitTreeNodeV1): readonly GitTreeNodeV1[] {
  const nodes: GitTreeNodeV1[] = [];
  const pending: GitTreeNodeV1[] = [root];
  while (pending.length > 0) {
    const node = pending.pop() as GitTreeNodeV1;
    nodes.push(node);
    for (let index = node.subtrees.length - 1; index >= 0; index -= 1) {
      pending.push((node.subtrees[index] as GitTreeNodeV1["subtrees"][number]).node);
    }
  }
  return nodes;
}

function treeCacheExtension(root: GitTreeNodeV1): Uint8Array {
  const parts: Uint8Array[] = [];
  const pending: { name: Uint8Array; node: GitTreeNodeV1 }[] = [{ name: new Uint8Array(0), node: root }];
  while (pending.length > 0) {
    const { name, node } = pending.pop() as { name: Uint8Array; node: GitTreeNodeV1 };
    parts.push(name, encoder.encode(`\0${node.entryCount.toString(10)} ${node.subtrees.length.toString(10)}\n`));
    parts.push(oidBytes(node.object.oid));
    for (let index = node.subtrees.length - 1; index >= 0; index -= 1) {
      pending.push(node.subtrees[index] as { name: Uint8Array; node: GitTreeNodeV1 });
    }
  }
  const data = concat(parts);
  const header = new Uint8Array(8);
  header.set(encoder.encode("TREE"), 0);
  new DataView(header.buffer).setUint32(4, data.byteLength);
  return concat([header, data]);
}

/**
 * Spec §4.1's candidate index: DIRC version 2, the given entries in index
 * order (unrelated ones are the original bytes), and a regenerated `TREE`
 * cache only when the real index carried one.
 */
export function gitIndexBytes(
  entries: readonly GitIndexEntryV1[],
  tree: GitTreeNodeV1 | null,
): Uint8Array {
  const header = new Uint8Array(INDEX_HEADER_BYTES);
  header.set(encoder.encode("DIRC"), 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, entries.length);
  const body = concat([header, ...entries.map((entry) => entry.raw), ...(tree === null ? [] : [treeCacheExtension(tree)])]);
  if (body.byteLength + SHA1_BYTES > GIT_METADATA_BOUNDS.sourceIndexMaxBytes) refuseIndex();
  return concat([body, Uint8Array.from(createHash("sha1").update(body).digest())]);
}

function signature(committer: GitCommitterV1): string {
  return `${committer.name} <${committer.email}> ${committer.unixSeconds.toString(10)} ${committer.utcOffset}`;
}

/** The exact commit object; author and committer are the same identity and instant. */
export function gitCommitObject(tree: LowerHexSha1, parent: LowerHexSha1 | null, committer: GitCommitterV1): GitObjectV1 {
  const person = signature(committer);
  const text =
    `tree ${tree}\n` +
    (parent === null ? "" : `parent ${parent}\n`) +
    `author ${person}\ncommitter ${person}\n\n${GIT_SYNC_COMMIT_MESSAGE}\n`;
  return gitObject("commit", encoder.encode(text));
}

/**
 * Renders a Git config string value in the one escape grammar
 * `parseGitConfig` reads back. Controls refuse instead of being escaped.
 */
function quoteGitConfigValue(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029) {
      throw new GitMetadataRefusalError("unsupported_repository_config");
    }
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function remoteSection(url: NormalizedRemoteUrlV1): string {
  return `[remote "${GIT_REMOTE_NAME}"]\n\turl = ${quoteGitConfigValue(url)}\n`;
}

export type GitRemoteStateV1 = { readonly state: "absent" } | { readonly state: "present"; readonly urls: readonly string[]; readonly pushUrls: number };

/** The fixed remote's URLs as written; normalization is the caller's comparison. */
export function gitRemoteState(configText: string): GitRemoteStateV1 {
  const entries = parseGitConfig(configText).filter(
    (entry) => entry.section === "remote" && entry.subsection === GIT_REMOTE_NAME,
  );
  if (entries.length === 0) return { state: "absent" };
  const urls = entries.filter((entry) => entry.name === "url").map((entry) => entry.value ?? "");
  const pushUrls = entries.filter((entry) => entry.name === "pushurl").length;
  return { state: "present", urls, pushUrls };
}

/** Adopt's only config change: the absent fixed remote, appended after the exact original bytes. */
export function appendGitRemoteSection(config: Uint8Array, url: NormalizedRemoteUrlV1): Uint8Array {
  const separator = config.byteLength === 0 || config[config.byteLength - 1] === 0x0a ? "" : "\n";
  const bytes = concat([config, encoder.encode(`${separator}${remoteSection(url)}`)]);
  if (bytes.byteLength > GIT_METADATA_BOUNDS.candidateConfigMaxBytes) {
    throw new GitMetadataRefusalError("git_metadata_too_large");
  }
  return bytes;
}

/**
 * Every path of the enable-only `.git`, which carries each directory a later
 * sync publishes into: the 256 loose-object fan-outs and the reflog parents.
 * The Git effect creates no parent directory, so a first sync into a tree
 * without them refused `git_effect_parent` (plan 1b Task 14 handoff).
 */
export function initialGitDirectoryPaths(branch: ValidatedGitBranchV1): readonly string[] {
  const branchParents = branch.split("/").slice(0, -1).map((_segment, index, all) => all.slice(0, index + 1).join("/"));
  return [
    "HEAD",
    "config",
    "objects",
    ...Array.from({ length: 256 }, (_unused, byte) => `objects/${byte.toString(16).padStart(2, "0")}`),
    "refs",
    "refs/heads",
    ...branchParents.map((parent) => `refs/heads/${parent}`),
    "logs",
    "logs/refs",
    "logs/refs/heads",
    ...branchParents.map((parent) => `logs/refs/heads/${parent}`),
  ].sort(compareUnsignedUtf8);
}

/**
 * The enable-only minimal `.git` (spec §4.1): no commit, no index, the
 * recorded branch unborn, and the fixed remote already present. Its hash
 * binds names, kinds, modes and content; inode identity is bound only once
 * the tree is published.
 */
export function planInitialGitDirectory(
  branch: ValidatedGitBranchV1,
  url: NormalizedRemoteUrlV1,
): GitInitialDirectoryPlanV1 {
  const config =
    "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n" +
    remoteSection(url);
  const files: Readonly<Record<string, Uint8Array>> = {
    HEAD: encoder.encode(`ref: refs/heads/${branch}\n`),
    config: encoder.encode(config),
  };
  const entries: GitInitialDirectoryEntryV1[] = initialGitDirectoryPaths(branch).map((relativePath) => {
    const bytes = files[relativePath];
    return bytes === undefined
      ? { relativePath, kind: "directory", mode: 0o755, bytes: null }
      : { relativePath, kind: "regular_file", mode: 0o644, bytes };
  });
  entries.sort((left, right) => compareUnsignedUtf8(left.relativePath, right.relativePath));
  const treeHash = hashCanonicalJson(
    INITIAL_TREE_DOMAIN,
    entries.map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      mode: entry.mode,
      hash: entry.bytes === null ? null : sha256(entry.bytes),
    })),
  );
  const totalBytes = entries.reduce((sum, entry) => sum + (entry.bytes?.byteLength ?? 0), 0);
  return { entries, treeHash, totalBytes };
}
