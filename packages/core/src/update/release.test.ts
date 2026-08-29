import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  advanceReleaseTrust,
  releaseIdentityHash,
  selectRelease,
  validateBundleManifest,
  validateOfflineReleaseTrust,
  validateReleaseIndex,
  validateReleaseTrustState,
  type ReleaseIdentityV1,
  type ReleaseMetadataIdentityV1,
} from "./release.js";
import { parseStableSemver } from "./scalars.js";

const hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const key = hex("key");
const hash = hex("bundle");

function bundle(architecture: "arm64" | "x64") {
  return {
    platform: "darwin",
    architecture,
    archiveFormat: "zstd-ustar-v1",
    archivePath: `bundles/${architecture}.tar.zst`,
    archiveBytes: "1",
    archiveSha256: hash,
    manifestPath: `bundles/${architecture}.manifest.json`,
    manifestBytes: "1",
    manifestSha256: hash,
  };
}

function entry(version = "1.0.0", sequence = "1") {
  return {
    version,
    releaseSequence: sequence,
    minimumLauncherProtocol: 1,
    updateProtocol: 1,
    bundles: [bundle("arm64"), bundle("x64")],
  };
}

describe("release schemas", () => {
  it("binds a release identity to the architecture bundle but not index sequence", () => {
    const repeated = entry();
    expect(releaseIdentityHash(entry(), "arm64")).toBe(releaseIdentityHash(repeated, "arm64"));
    expect(releaseIdentityHash(entry(), "arm64")).not.toBe(releaseIdentityHash(entry(), "x64"));
  });

  it("refuses release index replay, reordering, and incomplete architecture rows", () => {
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry(), entry()] })).toThrow();
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry("1.0.0", "2"), entry("2.0.0", "1")] })).toThrow();
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [{ ...entry(), bundles: [bundle("x64"), bundle("arm64")] }] })).toThrow();
  });

  it("admits only the closed offline trust handoff", () => {
    const publicKey = Buffer.alloc(32, 1).toString("base64url");
    expect(validateOfflineReleaseTrust({
      schemaVersion: 1,
      handoffProtocol: 1,
      onlineRootKeyId: hex(Buffer.alloc(32, 1)),
      acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: hex(Buffer.alloc(32, 1)), publicKey }],
      delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" },
      indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" },
      metadataRedirectOrigins: [{ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }],
    })).toMatchObject({ handoffProtocol: 1 });
  });

  it("refuses release trust replay and accepts a higher immutable observation", () => {
    const current = validateReleaseTrustState({
      schemaVersion: 1,
      highestDelegationSequence: "1",
      delegationHash: hash,
      delegatedReleaseKeyId: key,
      highestReleaseIndexSequence: "1",
      releaseIndexHash: hash,
      highestAcceptedReleaseSequence: "1",
      releaseIdentityHash: hash,
    });
    const accepted = {
      delegationSequence: "2",
      delegationHash: hex("delegation-2"),
      delegatedReleaseKeyId: key,
      releaseIndexSequence: "2",
      releaseIndexHash: hex("index-2"),
      releaseSequence: "2",
      releaseIdentityHash: hex("release-2"),
    } as unknown as ReleaseMetadataIdentityV1 & Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">;
    expect(advanceReleaseTrust(current, accepted)).toMatchObject({ highestAcceptedReleaseSequence: "2" });
    expect(() => advanceReleaseTrust(current, { ...accepted, delegationSequence: "1" } as unknown as typeof accepted)).toThrow();
    expect(() => advanceReleaseTrust(current, { ...accepted, releaseSequence: "1" } as unknown as typeof accepted)).toThrow();
  });

  it("requires a sorted inventory with all entrypoints as executable files", () => {
    const manifest = {
      schemaVersion: 1,
      version: "1.0.0",
      releaseSequence: "1",
      platform: "darwin",
      architecture: "arm64",
      launcherProtocol: 1,
      updateProtocol: 1,
      entrypoint: "bin/cli",
      runtimeEntrypoint: "bin/runtime",
      plannerEntrypoint: "bin/planner",
      verifierEntrypoint: "bin/verifier",
      entries: [
        { path: "bin", kind: "directory", mode: 448 },
        { path: "bin/cli", kind: "file", mode: 448, bytes: "1", sha256: hash },
        { path: "bin/planner", kind: "file", mode: 448, bytes: "1", sha256: hash },
        { path: "bin/runtime", kind: "file", mode: 448, bytes: "1", sha256: hash },
        { path: "bin/verifier", kind: "file", mode: 448, bytes: "1", sha256: hash },
      ],
    };
    expect(validateBundleManifest(manifest)).toEqual(manifest);
    expect(() => validateBundleManifest({ ...manifest, entries: manifest.entries.slice(1) })).toThrow();
  });

  it("selects an exact newer requested version and rejects an untrusted downgrade", () => {
    const index = validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] });
    const active = {
      version: parseStableSemver("1.0.0"), releaseSequence: "1", releaseIdentityHash: releaseIdentityHash(entry("1.0.0", "1"), "arm64"),
      delegationSequence: "1", delegationHash: hash, releaseIndexSequence: "1", releaseIndexHash: hash, bundleManifestHash: hash,
      bundleRoot: "/product/releases/1.0.0/darwin-arm64", platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
    } as never;
    expect(selectRelease(index, { version: parseStableSemver("2.0.0"), active })).toMatchObject({ outcome: "selected" });
    expect(() => selectRelease(index, { version: parseStableSemver("0.9.0"), active })).toThrow();
  });
});
