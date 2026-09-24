/**
 * Spec 1 §4.3's exact synchronization scope. The canonical-note predicate is
 * the Brain's, reached through an injected enumerator because Core never
 * imports `packages/brain`; this module only guards what the enumerator
 * names: containment, nested repositories, links, owners, devices and the
 * 16-MiB per-file and 1-GiB aggregate snapshot bounds.
 */
import type { GitScopeSnapshotV1 } from "../config/lifecycle.js";
import {
  LifecycleRecoveryRequiredError,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "../lifecycle/guarded-fs.js";
import { EXIT_CODES, type Redactor } from "../result.js";
import {
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalAbsolutePathV1,
  type VaultRelativePathV1,
} from "../update/paths.js";
import { compareUnsignedUtf8 } from "./types.js";

export type GitPlanningRefusalReasonV1 =
  | "scope_outside_repository"
  | "nested_git_directory"
  | "symlink_in_scope"
  | "hard_link_in_scope"
  | "unsupported_scope_entry"
  | "scope_file_too_large"
  | "scope_aggregate_too_large"
  | "scope_secret"
  | "cross_device_git_state"
  | "scope_reconcile_required"
  | "repository_identity_changed"
  | "retained_identity_mismatch"
  | "remote_conflict"
  | "reconcile_push_pending"
  | "reconcile_local_history"
  | "dirty_index"
  | "history_operation_in_progress"
  | "unborn_branch_empty"
  | "concurrent_change"
  | "git_cardinality_exceeded"
  | "git_plan_too_large"
  | "git_object_parent_absent";

/**
 * A planning refusal: nothing was reserved, staged or written, so the reason
 * and the vault-relative path are the whole publishable finding. A secret
 * publishes its class and path, never the matched content.
 */
export class GitPlanningRefusalError extends Error {
  readonly code: typeof EXIT_CODES.securityRefusal | typeof EXIT_CODES.operationalFailure;
  readonly reason: GitPlanningRefusalReasonV1;
  readonly path: string | null;

  constructor(reason: GitPlanningRefusalReasonV1, path: string | null = null, options?: ErrorOptions) {
    super(`git planning refused: ${reason}${path === null ? "" : ` (${path})`}`, options);
    this.name = "GitPlanningRefusalError";
    this.reason = reason;
    this.path = path;
    this.code = reason === "scope_secret" ? EXIT_CODES.securityRefusal : EXIT_CODES.operationalFailure;
  }
}

export function refuseGitPlanning(reason: GitPlanningRefusalReasonV1, path: string | null = null): never {
  throw new GitPlanningRefusalError(reason, path);
}

export const GIT_SCOPE_BOUNDS = Object.freeze({
  fileMaxBytes: 16_777_216,
  aggregateMaxBytes: 1_073_741_824,
});

/** Spec §4.3's four index artifacts, the only non-note members of the universe. */
export const GIT_SCOPE_INDEX_ARTIFACTS: readonly string[] = Object.freeze([
  "index.json",
  "graph.json",
  "vault-map.md",
  "catalog.md",
]);

/** The Brain's public canonical-note contract, injected. */
export interface GitScopeEnumeratorV1 {
  /** Every current canonical note, vault-relative, under the configured topic folders. */
  canonicalNotes(scope: GitScopeSnapshotV1): Promise<readonly string[]>;
  /** The same predicate over a path that may no longer exist, for tracked deletions. */
  isCanonicalNote(scope: GitScopeSnapshotV1, path: string): boolean;
}

export interface GitScopeDependenciesV1 {
  readonly fs: Pick<LifecycleGuardedFileSystemV1, "lstat" | "readRegular">;
  readonly redact: Redactor;
  readonly effectiveUid: number;
  readonly enumerator: GitScopeEnumeratorV1;
}

export interface GitScopeFileV1 {
  readonly path: VaultRelativePathV1;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function child(parent: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${parent}/${relative}`);
}

export function gitScopeIndexArtifactPaths(scope: GitScopeSnapshotV1): readonly string[] {
  return GIT_SCOPE_INDEX_ARTIFACTS.map((name) => `${scope.contentRoot}/${scope.indexesDir}/${name}`);
}

export function isGitScopePath(enumerator: GitScopeEnumeratorV1, scope: GitScopeSnapshotV1, path: string): boolean {
  return gitScopeIndexArtifactPaths(scope).includes(path) || enumerator.isCanonicalNote(scope, path);
}

/**
 * Spec §4.4 types every scoped path as `VaultRelativePathV1`, which refuses
 * control characters and non-NFC text; the guarded port can address nothing
 * else, so such a name refuses here rather than failing mid-read.
 */
export function parseGitScopePath(path: string): VaultRelativePathV1 {
  try {
    return parseVaultRelativePathText(path);
  } catch {
    return refuseGitPlanning("unsupported_scope_entry", null);
  }
}

function admitScopePath(path: string, scope: GitScopeSnapshotV1): VaultRelativePathV1 {
  const parsed = parseGitScopePath(path);
  if (parsed.split("/").some((component) => component.toLowerCase() === ".git")) {
    refuseGitPlanning("nested_git_directory", parsed);
  }
  if (!parsed.startsWith(`${scope.contentRoot}/`)) refuseGitPlanning("scope_outside_repository", parsed);
  return parsed;
}

/**
 * Spec §4.1: every tracked root is vault-relative and may not leave the
 * repository through an existing link. A missing root is legal; it simply
 * contributes no path.
 */
export async function assertGitScopeRoots(
  dependencies: Pick<GitScopeDependenciesV1, "fs" | "effectiveUid">,
  scope: GitScopeSnapshotV1,
): Promise<void> {
  const roots = [
    scope.contentRoot,
    `${scope.contentRoot}/${scope.indexesDir}`,
    ...scope.topicFolders.map((folder) => `${scope.contentRoot}/${folder}`),
    ...Object.keys(scope.topicAliases).map((alias) => `${scope.contentRoot}/${alias}`),
  ];
  for (const root of roots) {
    const entry = await dependencies.fs.lstat(child(scope.brainPath, root));
    if (entry === null) continue;
    if (entry.kind === "symlink") refuseGitPlanning("scope_outside_repository", root);
    if (entry.kind !== "directory" || entry.ownerUid !== dependencies.effectiveUid) {
      refuseGitPlanning("unsupported_scope_entry", root);
    }
  }
}

/**
 * Spec §4.5: the repository and product staging must share a device, since
 * every later effect is a same-device no-replace rename.
 */
export async function assertGitSameDevice(
  fs: Pick<LifecycleGuardedFileSystemV1, "lstat">,
  productHome: CanonicalAbsolutePathV1,
  repositoryRoot: CanonicalAbsolutePathV1,
): Promise<void> {
  const home = await fs.lstat(productHome);
  const repository = await fs.lstat(repositoryRoot);
  if (home === null || repository === null || home.dev !== repository.dev) {
    refuseGitPlanning("cross_device_git_state");
  }
}

/** The enumerated notes plus the four artifacts, admitted, unique and in unsigned UTF-8 order. */
export async function enumerateGitScopePaths(
  enumerator: GitScopeEnumeratorV1,
  scope: GitScopeSnapshotV1,
): Promise<readonly VaultRelativePathV1[]> {
  const paths = [...(await enumerator.canonicalNotes(scope)), ...gitScopeIndexArtifactPaths(scope)].map((path) =>
    admitScopePath(path, scope),
  );
  const unique = [...new Set(paths)];
  if (unique.length !== paths.length) refuseGitPlanning("unsupported_scope_entry");
  return unique.sort(compareUnsignedUtf8);
}

class GuardedScopeWalker {
  readonly #dependencies: GitScopeDependenciesV1;
  readonly #root: CanonicalAbsolutePathV1;
  readonly #directories = new Map<string, boolean>();

  constructor(dependencies: GitScopeDependenciesV1, root: CanonicalAbsolutePathV1) {
    this.#dependencies = dependencies;
    this.#root = root;
  }

  /** False when the directory is absent; every present one is a real owned directory with no nested `.git`. */
  async #directory(relative: string): Promise<boolean> {
    const known = this.#directories.get(relative);
    if (known !== undefined) return known;
    const entry = await this.#dependencies.fs.lstat(child(this.#root, relative));
    const present = entry !== null;
    if (entry !== null) {
      if (entry.kind === "symlink") refuseGitPlanning("symlink_in_scope", relative);
      if (entry.kind !== "directory" || entry.ownerUid !== this.#dependencies.effectiveUid) {
        refuseGitPlanning("unsupported_scope_entry", relative);
      }
      if ((await this.#dependencies.fs.lstat(child(this.#root, `${relative}/.git`))) !== null) {
        refuseGitPlanning("nested_git_directory", relative);
      }
    }
    this.#directories.set(relative, present);
    return present;
  }

  async leaf(path: VaultRelativePathV1): Promise<LifecycleGuardedEntryV1 | null> {
    const components = path.split("/");
    for (let depth = 1; depth < components.length; depth += 1) {
      if (!(await this.#directory(components.slice(0, depth).join("/")))) return null;
    }
    const entry = await this.#dependencies.fs.lstat(child(this.#root, path));
    if (entry === null) return null;
    if (entry.kind === "symlink") refuseGitPlanning("symlink_in_scope", path);
    if (entry.kind !== "regular_file" || entry.ownerUid !== this.#dependencies.effectiveUid) {
      refuseGitPlanning("unsupported_scope_entry", path);
    }
    if (entry.nlink !== 1) refuseGitPlanning("hard_link_in_scope", path);
    return entry;
  }
}

/**
 * The Brain index's per-note SHA-256 `contentHash`: a digest is indistinguishable by content from
 * a hex-encoded key, so the redactor's high-entropy rule flags every one, and every reindexed Brain
 * refused `scope_secret`. Only this schema-known field of the generated index is masked, never
 * the file: every other byte is still scanned, and the notes it digests are scanned in their own
 * right. No other scope path ends in `index.json` — notes are Markdown.
 */
const INDEX_CONTENT_HASH = /"contentHash": "[0-9a-f]{64}"/gu;

async function readScanned(
  dependencies: GitScopeDependenciesV1,
  entry: LifecycleGuardedEntryV1,
  path: VaultRelativePathV1,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await dependencies.fs.readRegular(entry, GIT_SCOPE_BOUNDS.fileMaxBytes);
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) refuseGitPlanning("concurrent_change", path);
    throw error;
  }
  let text: string;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return refuseGitPlanning("unsupported_scope_entry", path);
  }
  const scanned = path.endsWith("/index.json") ? text.replace(INDEX_CONTENT_HASH, '"contentHash": ""') : text;
  if (dependencies.redact(scanned) !== scanned) refuseGitPlanning("scope_secret", path);
  return bytes;
}

/**
 * Spec §4.4 step 2: guarded, bounded reads into memory, each size refused
 * from the admitted lstat before a byte is read, then the secret scan on the
 * raw text before anything hashes it. An enumerated note that vanished is a
 * concurrent edit; an absent index artifact is simply not in the snapshot.
 */
export async function readGitScopeSnapshot(
  dependencies: GitScopeDependenciesV1,
  scope: GitScopeSnapshotV1,
  paths: readonly VaultRelativePathV1[],
): Promise<readonly GitScopeFileV1[]> {
  const walker = new GuardedScopeWalker(dependencies, scope.brainPath);
  const artifacts = new Set(gitScopeIndexArtifactPaths(scope));
  const entries: LifecycleGuardedEntryV1[] = [];
  const present: VaultRelativePathV1[] = [];
  let aggregate = 0n;
  for (const path of paths) {
    const entry = await walker.leaf(path);
    if (entry === null) {
      if (artifacts.has(path)) continue;
      refuseGitPlanning("concurrent_change", path);
    }
    const size = BigInt(entry.size);
    if (size > BigInt(GIT_SCOPE_BOUNDS.fileMaxBytes)) refuseGitPlanning("scope_file_too_large", path);
    aggregate += size;
    if (aggregate > BigInt(GIT_SCOPE_BOUNDS.aggregateMaxBytes)) refuseGitPlanning("scope_aggregate_too_large", path);
    entries.push(entry);
    present.push(path);
  }
  const files: GitScopeFileV1[] = [];
  for (const [index, entry] of entries.entries()) {
    const path = present[index] as VaultRelativePathV1;
    files.push({ path, bytes: await readScanned(dependencies, entry, path), executable: (entry.mode & 0o100) !== 0 });
  }
  return files;
}

/** A reconcile retirement's current local bytes, or null when the file is already gone. */
export async function readGitRetiringPath(
  dependencies: GitScopeDependenciesV1,
  root: CanonicalAbsolutePathV1,
  path: string,
): Promise<Uint8Array | null> {
  const relative = parseGitScopePath(path);
  const entry = await new GuardedScopeWalker(dependencies, root).leaf(relative);
  if (entry === null) return null;
  if (BigInt(entry.size) > BigInt(GIT_SCOPE_BOUNDS.fileMaxBytes)) refuseGitPlanning("scope_file_too_large", relative);
  return readScanned(dependencies, entry, relative);
}
