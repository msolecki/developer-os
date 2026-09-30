import type { CanonicalAbsolutePathV1, LowerHexSha256, UInt64DecimalV1 } from "@developer-os/core";
import type { SystemPathObservationV1 } from "@developer-os/security";

import type { LaunchctlIdentityV1, LaunchdHostObserverV1 } from "./distribution.js";

type PresentObservation = Exclude<SystemPathObservationV1, { readonly kind: "absent" }>;

const directory = (ino: string): PresentObservation => ({ kind: "directory", ownerUid: 0, mode: 0o755, dev: "16777232", ino, size: 64, sha256: null });

const LAUNCHCTL: PresentObservation = { kind: "file", ownerUid: 0, mode: 0o755, dev: "16777232", ino: "4096", size: 300000, sha256: "b".repeat(64) };

export interface HostWithOptions {
  readonly productName?: string;
  readonly productVersion?: string;
  readonly buildVersion?: string;
  /** Per-path overrides merged onto root-owned 0755 `/`, `/bin` and a root-owned 0755 `/bin/launchctl`. */
  readonly paths?: Readonly<Record<string, Partial<PresentObservation>>>;
}

/** An admitted macOS 26.6.2 / 25G83 host unless an option overrides it; an unlisted path is absent. */
export function hostWith(options: HostWithOptions = {}): LaunchdHostObserverV1 {
  const base: Record<string, PresentObservation> = { "/": directory("2"), "/bin": directory("3"), "/bin/launchctl": LAUNCHCTL };
  for (const [path, change] of Object.entries(options.paths ?? {})) base[path] = { ...(base[path] ?? LAUNCHCTL), ...change };
  return {
    operatingSystem: () =>
      Promise.resolve({
        productName: options.productName ?? "macOS",
        productVersion: options.productVersion ?? "26.6.2",
        buildVersion: options.buildVersion ?? "25G83",
      }),
    inspect: (path) => Promise.resolve(base[path] ?? { kind: "absent" }),
  };
}

/** Exactly what `admitLaunchdHost(hostWith())` returns. */
export const LAUNCHCTL_IDENTITY: LaunchctlIdentityV1 = {
  file: {
    platform: "darwin",
    id: "scheduler",
    canonicalPath: "/bin/launchctl" as CanonicalAbsolutePathV1,
    dev: "16777232" as UInt64DecimalV1,
    ino: "4096" as UInt64DecimalV1,
    size: 300000,
    sha256: "b".repeat(64) as LowerHexSha256,
  },
  productVersion: "26.6.2",
  buildVersion: "25G83",
};
