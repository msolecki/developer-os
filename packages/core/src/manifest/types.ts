import type {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  unlink,
} from "node:fs/promises";

export type ArtifactOwner = "core" | "claude" | "codex" | "macos";

export type ArtifactKind = "file" | "directory" | "symlink" | "config-entry";

export type MergeStrategy = "dedicated" | "semantic-json" | "semantic-toml";

export interface ManagedArtifactV1 {
  readonly owner: ArtifactOwner;
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly productVersion: string;
  readonly existedBefore: boolean;
  readonly beforeHash: string | null;
  readonly backupRelativePath: string | null;
  readonly installedHash: string;
  readonly source: string;
  readonly mergeStrategy: MergeStrategy;
  readonly verifiedAt: string;
}

export interface InstallationManifestV1 {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly installedAt: string;
  readonly artifacts: readonly ManagedArtifactV1[];
}

export type DriftKind =
  | "missing"
  | "content_changed"
  | "type_changed"
  | "target_changed";

export interface DriftFinding {
  readonly path: string;
  readonly owner: ArtifactOwner;
  readonly kind: DriftKind;
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
}

export interface ConflictEvidence {
  readonly path: string;
  readonly baselineBackupRelativePath: string | null;
  readonly baselineHash: string | null;
  readonly currentHash: string | null;
  readonly proposedHash: string;
  readonly diff: string;
}

export interface ManifestFileSystem {
  readonly chmod: typeof chmod;
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly open: typeof open;
  readonly readFile: typeof readFile;
  readonly rename: typeof rename;
  readonly unlink: typeof unlink;
}

export interface DriftFileSystem {
  readonly lstat: typeof lstat;
  readonly open: typeof open;
  readonly readFile: typeof readFile;
  readonly readlink: typeof readlink;
}

/**
 * Injected because `packages/core` must not depend on `packages/security`. The
 * composition root supplies the concrete policy, exactly as it does for
 * `TransactionGuards`. Drift inspection and conflict evidence read user files
 * and render them into diagnostics, so every read passes this first.
 */
export interface ManifestGuards {
  /**
   * Refuses paths the policy protects and returns the path with **every
   * ancestor canonicalized and the final component preserved verbatim** —
   * `join(realpath(dirname(path)), basename(path))`.
   *
   * Both halves matter. Canonicalizing ancestors closes the hole `O_NOFOLLOW`
   * cannot: it constrains only the final component, so reading the caller's raw
   * path would still traverse a symlink at any intermediate component after the
   * guard passed. Preserving the final component keeps the `lstat` check in this
   * module meaningful — a full `realpath` would resolve the leaf too, so a
   * managed file swapped for a symlink would be silently read through, and a
   * managed `kind: "symlink"` artifact would resolve to its target and be
   * reported as `type_changed` forever.
   */
  assertReadable(path: string): Promise<string>;
}

export interface ManifestStoreDependencies {
  readonly manifestFile: string;
  readonly fs: ManifestFileSystem;
}

export interface DriftRequest {
  readonly manifest: InstallationManifestV1;
  readonly fs: DriftFileSystem;
  readonly guards: ManifestGuards;
}

export interface ConflictEvidenceRequest {
  readonly artifact: ManagedArtifactV1;
  readonly backupsDir: string;
  readonly proposed: Uint8Array;
  readonly fs: DriftFileSystem;
  readonly guards: ManifestGuards;
  readonly redactDiagnostic: (text: string) => string;
}
