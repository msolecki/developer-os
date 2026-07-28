import type {
  ArtifactKind,
  ArtifactOwner,
  InstallationManifestV1,
  MergeStrategy,
} from "../manifest/index.js";

export type ChangeOperationKind = "create" | "replace" | "remove";

export interface ChangePlanOperationV1 {
  readonly targetPath: string;
  readonly operation: ChangeOperationKind;
  readonly owner: ArtifactOwner;
  readonly kind: ArtifactKind;
  readonly expectedBeforeHash: string | null;
  readonly source: string;
  readonly mergeStrategy: MergeStrategy;
  readonly proposedHash: string | null;
}

/**
 * What `validateChangePlan` returns. `canonicalTargetPath` is required, not
 * optional: ownership was decided on that path, so it is the path a caller must
 * mutate. An optional field would invite `op.canonicalTargetPath ?? op.targetPath`
 * at the call site, which approves one path and acts on another.
 */
export interface ValidatedChangePlanOperationV1 extends ChangePlanOperationV1 {
  readonly canonicalTargetPath: string;
}

export interface ChangePlanV1 {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly operations: readonly ValidatedChangePlanOperationV1[];
}

export interface ChangePlanContext {
  readonly manifest: InstallationManifestV1;
  readonly ownedRoots: readonly string[];
  readonly excludedRoots: readonly string[];
  /**
   * Resolves a path to its canonical form, **resolving the final component too
   * when it exists** and falling back to the longest existing ancestor when it
   * does not — that is, `canonicalizePlannedPath`. Full resolution is required:
   * an ancestors-only implementation makes the widening check in
   * `assertUsableRoots` inert and refuses every legitimately relocated root.
   * Note this is the opposite of `ManifestGuards.assertReadable`, which must be
   * ancestors-only; do not share one implementation between them.
   *
   * Injected because `packages/core` must not depend on `packages/security`.
   * Without it, root matching is pure string math and a symlink planted inside
   * an owned root escapes every excluded root.
   */
  canonicalize(path: string): Promise<string>;
}

export type ChangePlanRefusalReason =
  | "malformed"
  | "duplicate_target"
  | "outside_owned_roots"
  | "excluded_root"
  | "unmanaged_target"
  | "already_owned"
  | "ownership_mismatch"
  | "hash_expectation";
