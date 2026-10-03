import { EXIT_CODES, encodeCanonicalJson, type CanonicalJsonValue } from "@developer-os/core";
import {
  SystemExecutableRefusalError,
  admitPosixRootOwned,
  type AdmittedSystemExecutableV1,
  type SystemExecutableRowV1,
  type SystemPathInspectorV1,
} from "@developer-os/security";

import { DARWIN_SYSTEM_EXECUTABLES } from "../system-executables.js";

export type LaunchdOperatingSystemPolicyV1 = {
  readonly productName: "macOS";
  readonly minimumProductVersion: "26.6.2";
};

export type LaunchdExecutablePolicyV1 = {
  readonly path: "/bin/launchctl";
  readonly ownerUid: 0;
};

export type LaunchdEmptyDirectoryIdentityV1 = {
  readonly path: "/private/var/empty";
  readonly ownerUid: 0;
  readonly mode: 493;
};

/**
 * Spec §5.3 (amended 2026-09-28, D71): `/bin/launchctl` is the `darwin` `scheduler` row, admitted
 * by `posix_root_owned` and a macOS floor. No field names a build, a binary hash or a certificate.
 */
export type LaunchdDistributionPolicyV2 = {
  readonly previewTableId: "launchctl-macos-preview-v2";
  readonly mutationTableId: "launchctl-macos-path-v1";
  readonly operatingSystem: LaunchdOperatingSystemPolicyV1;
  readonly executable: LaunchdExecutablePolicyV1;
  readonly emptyDirectory: LaunchdEmptyDirectoryIdentityV1;
};

/** Per-apply evidence, never a cross-machine pin: `ProductBuildVersion` is recorded and never compared. */
export type LaunchctlIdentityV1 = {
  readonly file: AdmittedSystemExecutableV1;
  readonly productVersion: string;
  readonly buildVersion: string;
};

/** `sw_vers` values read through an injected probe, never a shell, and a no-follow path inspector. */
export interface LaunchdHostObserverV1 {
  operatingSystem(): Promise<{ productName: string; productVersion: string; buildVersion: string }>;
  inspect: SystemPathInspectorV1;
}

export const LAUNCHD_DISTRIBUTION_POLICY: LaunchdDistributionPolicyV2 = Object.freeze({
  previewTableId: "launchctl-macos-preview-v2",
  mutationTableId: "launchctl-macos-path-v1",
  operatingSystem: Object.freeze({ productName: "macOS", minimumProductVersion: "26.6.2" }),
  executable: Object.freeze({ path: "/bin/launchctl", ownerUid: 0 }),
  emptyDirectory: Object.freeze({ path: "/private/var/empty", ownerUid: 0, mode: 493 }),
});

/** A host below the floor, a launchctl that fails admission, or one that changed since admission. */
export class LaunchdDistributionUnsupportedError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;
  readonly reason = "unsupported_launchd_distribution";

  constructor(detail: string, options?: ErrorOptions) {
    super(`unsupported_launchd_distribution: ${detail}`, options);
    this.name = "LaunchdDistributionUnsupportedError";
  }
}

function unsupported(detail: string): never {
  throw new LaunchdDistributionUnsupportedError(detail);
}

/** Two or three canonical decimal integers; a missing patch reads as `0`. */
function macOsVersion(text: string): readonly [number, number, number] | null {
  const match = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:\.(0|[1-9]\d{0,3}))?$/u.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

const atLeast = (a: readonly number[], b: readonly number[]): boolean => {
  for (let index = 0; index < b.length; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  return true;
};

function schedulerRow(policy: LaunchdDistributionPolicyV2): SystemExecutableRowV1 {
  const row = DARWIN_SYSTEM_EXECUTABLES.find((candidate) => candidate.id === "scheduler");
  if (row?.path !== policy.executable.path) unsupported("no darwin scheduler row for the policy's launchctl path");
  return row;
}

/** Rules 1–2 of spec §5.3 (D71): the macOS floor, then `posix_root_owned` on `/bin/launchctl`. */
export async function admitLaunchdHost(
  host: LaunchdHostObserverV1,
  policy: LaunchdDistributionPolicyV2 = LAUNCHD_DISTRIBUTION_POLICY,
): Promise<LaunchctlIdentityV1> {
  const os = await host.operatingSystem();
  if (os.productName !== policy.operatingSystem.productName) unsupported("operating system product name");
  const version = macOsVersion(os.productVersion);
  const floor = macOsVersion(policy.operatingSystem.minimumProductVersion);
  if (version === null || floor === null || !atLeast(version, floor)) unsupported("operating system version is below the floor or malformed");
  let file: AdmittedSystemExecutableV1;
  try {
    file = await admitPosixRootOwned(schedulerRow(policy), host.inspect);
  } catch (error) {
    if (error instanceof SystemExecutableRefusalError) throw new LaunchdDistributionUnsupportedError(error.detail, { cause: error });
    throw error;
  }
  return Object.freeze({ file, productVersion: os.productVersion, buildVersion: os.buildVersion });
}

/** Re-admits and refuses any difference from the identity the table bound. */
export async function recheckLaunchdHost(host: LaunchdHostObserverV1, identity: LaunchctlIdentityV1): Promise<void> {
  const fresh = await admitLaunchdHost(host);
  if (encodeCanonicalJson(fresh as unknown as CanonicalJsonValue) !== encodeCanonicalJson(identity as unknown as CanonicalJsonValue)) {
    unsupported("launchctl or the operating system changed since admission");
  }
}
