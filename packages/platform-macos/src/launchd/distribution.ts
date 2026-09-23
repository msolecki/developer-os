import { EXIT_CODES, type LowerHexSha256, type UtcTimestampV1 } from "@developer-os/core";

export type LaunchdOperatingSystemV1 = {
  readonly productName: "macOS";
  readonly productVersion: string;
  readonly buildVersion: string;
};

export type LaunchdExecutableIdentityV1 = {
  readonly path: "/bin/launchctl";
  readonly ownerUid: 0;
  readonly mode: 493;
  readonly size: number;
  readonly sha256: LowerHexSha256;
};

export type LaunchdEmptyDirectoryIdentityV1 = {
  readonly path: "/private/var/empty";
  readonly ownerUid: 0;
  readonly mode: 493;
};

/** Spec §5.3 (amended 2026-09-23, D59): `null` means uncertified, and every mutation refuses. */
export type LaunchdCertificationV1 = {
  readonly certifiedAt: UtcTimestampV1;
  readonly fixtureTranscriptSha256: LowerHexSha256;
} | null;

export type LaunchdDistributionRowV1 = {
  readonly previewTableId: `launchctl-macos-${string}-preview-v1`;
  readonly mutationTableId: `launchctl-macos-${string}-fd3-v1`;
  readonly operatingSystem: LaunchdOperatingSystemV1;
  readonly executable: LaunchdExecutableIdentityV1;
  readonly emptyDirectory: LaunchdEmptyDirectoryIdentityV1;
  readonly certification: LaunchdCertificationV1;
};

/**
 * The one supported launchctl row (NEW-84 re-pinning rule 1): measured read-only on 2026-09-23.
 * No other file restates these literals; re-pinning replaces this constant in one change, and the
 * change that certifies the row on a disposable host (plan 1b Task 19) fills `certification`.
 */
export const SUPPORTED_LAUNCHD_DISTRIBUTION: LaunchdDistributionRowV1 = Object.freeze({
  previewTableId: "launchctl-macos-26.6.2-25G83-preview-v1",
  mutationTableId: "launchctl-macos-26.6.2-25G83-fd3-v1",
  operatingSystem: Object.freeze({ productName: "macOS", productVersion: "26.6.2", buildVersion: "25G83" }),
  executable: Object.freeze({
    path: "/bin/launchctl",
    ownerUid: 0,
    mode: 493,
    size: 363488,
    sha256: "b4dbf509754d8e1117f7851baa93ede75bc75218c48d6ddf19fbb1505d261be7" as LowerHexSha256,
  }),
  emptyDirectory: Object.freeze({ path: "/private/var/empty", ownerUid: 0, mode: 493 }),
  certification: null,
});

/** A launchctl row this host does not match, or an uncertified row asked to mutate: a capability, not a verdict. */
export class LaunchdDistributionUnsupportedError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;
  readonly reason = "unsupported_launchd_distribution";

  constructor(detail: string, options?: ErrorOptions) {
    super(`unsupported_launchd_distribution: ${detail}`, options);
    this.name = "LaunchdDistributionUnsupportedError";
  }
}

/** What a guarded, no-follow inspection of `/bin/launchctl` and an injected `sw_vers` probe report. */
export interface ObservedLaunchdDistributionV1 {
  readonly operatingSystem: {
    readonly productName: string;
    readonly productVersion: string;
    readonly buildVersion: string;
  };
  readonly executable: {
    readonly path: string;
    readonly kind: "file" | "directory" | "symlink" | "other";
    readonly ownerUid: number;
    readonly mode: number;
    readonly size: number;
    readonly sha256: string;
  };
}

function unsupported(detail: string): never {
  throw new LaunchdDistributionUnsupportedError(detail);
}

/** Every field is compared; version text is never trusted on its own (spec §5.3). */
export function admitLaunchdDistribution(
  observed: ObservedLaunchdDistributionV1,
  row: LaunchdDistributionRowV1 = SUPPORTED_LAUNCHD_DISTRIBUTION,
): void {
  const os = observed.operatingSystem;
  if (os.productName !== row.operatingSystem.productName) unsupported("operating system product name");
  if (os.productVersion !== row.operatingSystem.productVersion) unsupported("operating system version");
  if (os.buildVersion !== row.operatingSystem.buildVersion) unsupported("operating system build");
  const executable = observed.executable;
  if (executable.path !== row.executable.path) unsupported("launchctl path");
  if (executable.kind !== "file") unsupported("launchctl is not a regular file");
  if (executable.ownerUid !== row.executable.ownerUid) unsupported("launchctl owner");
  if (executable.mode !== row.executable.mode) unsupported("launchctl mode");
  if (executable.size !== row.executable.size) unsupported("launchctl size");
  if (executable.sha256 !== row.executable.sha256) unsupported("launchctl hash");
}
