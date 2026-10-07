import type {
  CanonicalAbsolutePathV1,
  LifecycleGuardedEntryV1,
  LowerHexSha256,
  ReleaseBundleManifestV1,
} from "@developer-os/core";

/** Darwin-only, `arm64`/`x64`-only: the two facts the launcher ever routes on. */
export interface LauncherPlatformIdentityV1 {
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
}

/**
 * The guarded read-only subset of `LifecycleGuardedFileSystemV1` bundle
 * admission needs. Narrowed deliberately: a type that cannot express
 * `writeExclusive`/`renameOver`/etc. is the cheapest proof this admission
 * never mutates, while staying structurally satisfiable by the real
 * `createNodeLifecycleGuardedFileSystem` output.
 */
export interface LauncherGuardedReaderV1 {
  lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null>;
  readRegular(entry: LifecycleGuardedEntryV1, maximumBytes: number): Promise<Uint8Array>;
  hashRegular(entry: LifecycleGuardedEntryV1, maximumBytes: bigint): Promise<LowerHexSha256>;
  names(directory: LifecycleGuardedEntryV1): AsyncIterable<string>;
}

/**
 * A release bundle whose on-disk tree has been walked, matched exactly
 * against its manifest (owner/mode/size/hash, non-empty inventory, no
 * unknown children), and whose entrypoints were resolved to absolute,
 * guarded paths. `runtimeEntrypoint`/`entrypoint` are ready for a
 * shell-free `execve`-style invocation: never resolved through `PATH`.
 */
export interface AdmittedReleaseBundleV1 {
  readonly platform: LauncherPlatformIdentityV1;
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly manifest: ReleaseBundleManifestV1;
  readonly runtimeEntrypoint: CanonicalAbsolutePathV1;
  readonly entrypoint: CanonicalAbsolutePathV1;
}

/**
 * `exact`: every member's mode equals its manifest entry and the uid owns it (a product-home release).
 * `homebrew`: directories `0755`, files `0755` or `0644` by the entry's permission class, owned by the
 * uid or root (the package-channel keg, D84 K2/K3).
 */
export type LauncherBundleModesV1 = "exact" | "homebrew";

export interface LauncherBundleAdmissionRequestV1 {
  readonly platform: LauncherPlatformIdentityV1;
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly manifest: ReleaseBundleManifestV1;
  readonly effectiveUid: number;
  readonly modes: LauncherBundleModesV1;
  readonly fs: LauncherGuardedReaderV1;
}
