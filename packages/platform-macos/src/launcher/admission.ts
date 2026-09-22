import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, ReleaseBundleEntryV1 } from "@developer-os/core";

import type {
  AdmittedReleaseBundleV1,
  LauncherBundleAdmissionRequestV1,
  LauncherGuardedReaderV1,
  LauncherPlatformIdentityV1,
} from "./types.js";

/** Unsupported platform or architecture: a capability the host does not have, never a security verdict. */
export class LauncherPlatformUnsupportedError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;

  constructor(message: string) {
    super(message);
    this.name = "LauncherPlatformUnsupportedError";
  }
}

/**
 * A present bundle that failed guarded admission: missing member, owner/mode/size/hash
 * mismatch, unknown child, or any other structural drift from its manifest. Never a
 * silent fallback — spec 3.1: "it never silently falls back over a present but invalid
 * active record."
 */
export class LauncherBundleRecoveryRequiredError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor(message: string) {
    super(message);
    this.name = "LauncherBundleRecoveryRequiredError";
  }
}

function refuseBundle(message: string): never {
  throw new LauncherBundleRecoveryRequiredError(message);
}

/** Spec 2 §1's per-file expansion bound, reused here as the guarded-hash ceiling for a bundle member. */
const MAX_BUNDLE_FILE_BYTES = 536_870_912n;

export function admitLauncherPlatformIdentity(facts: {
  readonly platform: string;
  readonly architecture: string;
}): LauncherPlatformIdentityV1 {
  if (facts.platform !== "darwin") {
    throw new LauncherPlatformUnsupportedError(
      `Developer OS launcher supports macOS only; this host reports ${facts.platform}`,
    );
  }
  if (facts.architecture !== "arm64" && facts.architecture !== "x64") {
    throw new LauncherPlatformUnsupportedError(
      `Developer OS launcher supports arm64 and x64 only; this host reports ${facts.architecture}`,
    );
  }
  return { platform: "darwin", architecture: facts.architecture };
}

function bundleMemberPath(bundleRoot: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${bundleRoot}/${relative}`);
}

/**
 * Guarded, read-only admission of one release bundle's on-disk tree against its
 * (already core-validated) manifest. Owns platform/architecture identity and
 * launcher/bundle executable admission only — never release selection, per
 * Spec 2 §2's package-direction table.
 */
export class LauncherBundleAdmission {
  async admit(request: LauncherBundleAdmissionRequestV1): Promise<AdmittedReleaseBundleV1> {
    const { platform, bundleRoot, manifest, fs, effectiveUid } = request;

    if (manifest.architecture !== platform.architecture) {
      throw new LauncherPlatformUnsupportedError(
        "The release bundle manifest does not match the running platform or architecture",
      );
    }
    if (manifest.entries.length === 0) {
      refuseBundle("The release bundle manifest declares no entries");
    }

    const rootEntry = await fs.lstat(bundleRoot);
    if (rootEntry === null || rootEntry.kind !== "directory" || rootEntry.ownerUid !== effectiveUid) {
      refuseBundle(`The release bundle root is missing or untrusted: ${bundleRoot}`);
    }

    const declared = new Set(manifest.entries.map((entry) => entry.path as string));
    const observed = new Set<string>();
    await this.#walk(fs, bundleRoot, "", observed);
    if (observed.size !== declared.size || [...declared].some((path) => !observed.has(path))) {
      refuseBundle(`The release bundle tree does not exactly match its manifest inventory: ${bundleRoot}`);
    }

    for (const entryDecl of manifest.entries) {
      await this.#admitMember(fs, bundleRoot, entryDecl, effectiveUid);
    }

    return {
      platform,
      bundleRoot,
      manifest,
      runtimeEntrypoint: bundleMemberPath(bundleRoot, manifest.runtimeEntrypoint),
      entrypoint: bundleMemberPath(bundleRoot, manifest.entrypoint),
    };
  }

  async #admitMember(
    fs: LauncherGuardedReaderV1,
    bundleRoot: CanonicalAbsolutePathV1,
    entryDecl: ReleaseBundleEntryV1,
    effectiveUid: number,
  ): Promise<void> {
    const path = bundleMemberPath(bundleRoot, entryDecl.path);
    const guarded = await fs.lstat(path);
    if (guarded === null || guarded.ownerUid !== effectiveUid) {
      refuseBundle(`An untrusted or missing bundle member was found: ${path}`);
    }
    if (entryDecl.kind === "directory") {
      if (guarded.kind !== "directory" || guarded.mode !== entryDecl.mode) {
        refuseBundle(`A bundle directory does not match its manifest entry: ${path}`);
      }
      return;
    }
    if (guarded.kind !== "regular_file" || guarded.mode !== entryDecl.mode || guarded.size !== entryDecl.bytes) {
      refuseBundle(`A bundle file does not match its manifest entry: ${path}`);
    }
    const sha256 = await fs.hashRegular(guarded, MAX_BUNDLE_FILE_BYTES);
    if (sha256 !== entryDecl.sha256) {
      refuseBundle(`A bundle file's content does not match its manifest hash: ${path}`);
    }
  }

  async #walk(
    fs: LauncherGuardedReaderV1,
    bundleRoot: CanonicalAbsolutePathV1,
    prefix: string,
    observed: Set<string>,
  ): Promise<void> {
    const directoryPath = prefix.length === 0 ? bundleRoot : bundleMemberPath(bundleRoot, prefix);
    const directoryEntry = await fs.lstat(directoryPath);
    if (directoryEntry === null || directoryEntry.kind !== "directory") {
      refuseBundle(`A declared bundle directory is missing: ${directoryPath}`);
    }
    for await (const name of fs.names(directoryEntry)) {
      const relative = prefix.length === 0 ? name : `${prefix}/${name}`;
      const childPath = bundleMemberPath(bundleRoot, relative);
      const child = await fs.lstat(childPath);
      if (child === null) {
        refuseBundle(`A bundle member vanished during inventory: ${childPath}`);
      }
      if (child.kind === "directory") {
        observed.add(relative);
        await this.#walk(fs, bundleRoot, relative, observed);
      } else if (child.kind === "regular_file") {
        observed.add(relative);
      } else {
        refuseBundle(`An unknown bundle member kind was found: ${childPath}`);
      }
    }
  }
}
