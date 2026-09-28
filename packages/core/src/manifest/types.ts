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
import type { InstructionCategoryV1, InstructionIdV1 } from "../instructions/bounds.js";
import type {
  BoundedArtifactSourceV1,
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  VaultFreeRelativePathV1,
} from "../update/paths.js";
import type {
  LowerHexSha256,
  StableSemverV1,
  UtcTimestampV1,
} from "../update/scalars.js";

export type ArtifactOwner = "core" | "claude" | "codex" | "macos";

export type ArtifactKind = "file" | "directory" | "symlink" | "config-entry";

export type MergeStrategy = "dedicated" | "semantic-json" | "semantic-toml" | "marked-block";

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

export type ManagedArtifactSchemaIdV1 =
  | "developer-os-config-v1"
  | "lifecycle-id-allocator-v1"
  | "active-release-record-v1"
  | "release-trust-state-v1"
  | "codex-registration-v1";

export interface ManagedArtifactCommonV2 {
  readonly owner: ArtifactOwner;
  readonly path: CanonicalAbsolutePathV1;
  readonly productVersion: StableSemverV1;
  readonly existedBefore: boolean;
  readonly beforeHash: LowerHexSha256 | null;
  readonly backupRelativePath: VaultFreeRelativePathV1 | null;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly verifiedAt: UtcTimestampV1;
}

export type ManagedArtifactV2 =
  | (ManagedArtifactCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "content"; readonly installedHash: LowerHexSha256 } })
  | (ManagedArtifactCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "schema"; readonly schemaId: ManagedArtifactSchemaIdV1; readonly installedHash: LowerHexSha256 } })
  | (ManagedArtifactCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "ephemeral" } })
  | (ManagedArtifactCommonV2 & { readonly kind: "directory"; readonly verification: { readonly mode: "content" } })
  | (ManagedArtifactCommonV2 & { readonly kind: "symlink"; readonly verification: { readonly mode: "content"; readonly installedHash: LowerHexSha256 } })
  | (ManagedArtifactCommonV2 & { readonly kind: "instruction"; readonly instruction: InstructionIdentityV1; readonly verification: { readonly mode: "content"; readonly installedHash: LowerHexSha256 } })
  | (ManagedArtifactCommonV2 & {
    readonly kind: "instruction";
    readonly instruction: InstructionIdentityV1 & { readonly category: "vendor-file"; readonly source: "default"; readonly members: readonly InstructionBlockMemberV1[] };
    readonly verification: { readonly mode: "block"; readonly blockHash: LowerHexSha256 };
  });

export interface InstructionIdentityV1 {
  readonly category: InstructionCategoryV1;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
}

export interface InstructionBlockMemberV1 {
  readonly category: Exclude<InstructionCategoryV1, "vendor-file">;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  /** Hash of the member's rendered bytes inside the block. */
  readonly sha256: LowerHexSha256;
}

export type OwnerPathArmV1 =
  | { readonly kind: "file" | "directory" | "symlink" }
  | { readonly kind: "instruction"; readonly mode: "content" | "block"; readonly category: InstructionCategoryV1 };

export interface InstallationManifestV2 {
  readonly schemaVersion: 2;
  readonly productVersion: StableSemverV1;
  readonly installedAt: UtcTimestampV1;
  readonly artifacts: readonly ManagedArtifactV2[];
}

export type InstallationManifest = InstallationManifestV1 | InstallationManifestV2;
export interface ManifestAdmissionContextV1 {
  readonly evidence: CanonicalPathEvidenceV1;
  readonly sourceRoot: CanonicalAbsolutePathV1;
  readonly backupRoot: CanonicalAbsolutePathV1;
  readonly admitOwnerPath: (
    owner: ArtifactOwner,
    path: CanonicalAbsolutePathV1,
    arm: OwnerPathArmV1,
  ) => CanonicalAbsolutePathV1;
}

export type DriftKind =
  | "missing"
  | "content_changed"
  | "type_changed"
  | "target_changed"
  | "schema_invalid"
  | "block_malformed";

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
  readonly guards: ManifestGuards;
}

export interface DriftRequest {
  readonly manifest: InstallationManifestV1;
  readonly fs: DriftFileSystem;
  readonly guards: ManifestGuards;
}

/** Strict schema validation belongs at the composition root: Core never imports owner schemas. */
export interface ManagedArtifactSchemaRegistry {
  validate(schemaId: ManagedArtifactSchemaIdV1, bytes: Uint8Array): void;
}

/** Owner runtime reservations have metadata rules distinct from content schemas. */
export interface ManagedArtifactEphemeralRegistryV1 {
  validate(
    owner: ArtifactOwner,
    observation: {
      readonly path: CanonicalAbsolutePathV1;
      readonly uid: number;
      readonly mode: number;
      readonly nlink: number;
    },
  ): void;
}

export interface DriftRequestV2 {
  readonly manifest: InstallationManifestV2;
  readonly fs: DriftFileSystem;
  readonly guards: ManifestGuards;
  readonly schemas: ManagedArtifactSchemaRegistry;
  readonly ephemerals: ManagedArtifactEphemeralRegistryV1;
}

export type ConflictEvidenceRequest =
  | {
    readonly artifact: ManagedArtifactV1;
    readonly backupsDir: string;
    readonly proposed: Uint8Array;
    readonly fs: DriftFileSystem;
    readonly guards: ManifestGuards;
    readonly redactDiagnostic: (text: string) => string;
  }
  | {
    readonly block: {
      readonly artifact: Extract<ManagedArtifactV2, { readonly kind: "instruction"; readonly verification: { readonly mode: "block" } }>;
      readonly fileBytes: Uint8Array;
      readonly proposedBlock: Uint8Array;
    };
    readonly fs: DriftFileSystem;
    readonly guards: ManifestGuards;
    readonly redactDiagnostic: (text: string) => string;
  };
