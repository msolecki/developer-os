import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  admitReleaseAgainstTrust,
  admitReleaseIdentity,
  advanceReleaseTrust,
  releaseIdentityHash,
  selectRelease,
  validateBundleManifest,
  validateOfflineReleaseTrust,
  validateReleaseIndex,
  validateReleaseTrustState,
  validateActiveReleaseRecord,
  validateReleaseIdentity,
  validateReleaseKeyDelegation,
  validateSignedReleaseDocument,
  signedReleaseDocumentSigningBytes,
  parseOfficialReleasePathPrefix,
  parseOfficialReleaseRelativePath,
  parseLowercaseAsciiDnsName,
  type ReleaseIdentityV1,
  type ReleaseMetadataIdentityV1,
} from "./release.js";
import { admitCanonicalAbsolutePath, type CanonicalPathEvidenceV1 } from "./paths.js";
import { parseLowerHexSha256, parseStableSemver } from "./scalars.js";

const hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const key = hex("key");
const hash = hex("bundle");
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

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
  it.each([
    ["version", (value: ReturnType<typeof entry>) => ({ ...value, version: "2.0.0" })],
    ["sequence", (value: ReturnType<typeof entry>) => ({ ...value, releaseSequence: "2" })],
    ["protocol", (value: ReturnType<typeof entry>) => ({ ...value, updateProtocol: 2 })],
    ["bundle hash", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], archiveSha256: hex("changed") }, value.bundles[1]] })],
  ])("changes identity hash when included %s changes", (_name, mutate) => { expect(releaseIdentityHash(mutate(entry()), "arm64")).not.toBe(releaseIdentityHash(entry(), "arm64")); });

  it("refuses release index replay, reordering, and incomplete architecture rows", () => {
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry(), entry()] })).toThrow();
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry("1.0.0", "2"), entry("2.0.0", "1")] })).toThrow();
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [{ ...entry(), bundles: [bundle("x64"), bundle("arm64")] }] })).toThrow();
  });

  it.each([
    ["archive zero", { archiveBytes: "0" }], ["archive over", { archiveBytes: "2147483649" }],
    ["manifest zero", { manifestBytes: "0" }], ["manifest over", { manifestBytes: "16777217" }],
  ])("refuses index bundle byte bound %s", (_name, mutation) => {
    const arm = { ...bundle("arm64"), ...mutation };
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [{ ...entry(), bundles: [arm, bundle("x64")] }] })).toThrow();
  });

  it("admits only the closed offline trust handoff", () => {
    const publicKey = Buffer.alloc(32, 1).toString("base64url");
    const input = {
      schemaVersion: 1,
      handoffProtocol: 1,
      onlineRootKeyId: hex(Buffer.alloc(32, 1)),
      acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: hex(Buffer.alloc(32, 1)), publicKey }],
      delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" },
      indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" },
      metadataRedirectOrigins: [{ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }],
    };
    const trusted = validateOfflineReleaseTrust(input);
    (input.delegationLocator as { assetName: string }).assetName = "release-index-v1.json";
    expect(trusted.delegationLocator.assetName).toBe("release-key-delegation-v1.json");
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
    } as unknown as ReleaseIdentityV1;
    expect(selectRelease(index, { version: parseStableSemver("2.0.0"), active })).toMatchObject({ outcome: "selected", selected: { entry: { version: "2.0.0" } } });
    expect(() => selectRelease(index, { version: parseStableSemver("1.0.0"), active: { ...active, releaseIdentityHash: parseLowerHexSha256(hex("rebound")) } })).toThrow();
  });

  it.each(["xn--bcher-kva.example", "127.0.0.1", "0x7f.1"]) ("refuses non-DNS hostname %s", (host) => {
    expect(() => validateOfflineReleaseTrust({
      schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId: hex(Buffer.alloc(32, 1)),
      acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: hex(Buffer.alloc(32, 1)), publicKey: Buffer.alloc(32, 1).toString("base64url") }],
      delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" },
      indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" },
      metadataRedirectOrigins: [{ scheme: "https", host, port: 443, pathPrefix: "/msolecki/developer-os/" }],
    })).toThrow();
  });

  it("binds a persisted identity to its exact derived root and verified release context", () => {
    const selected = selectRelease(validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] }), {
      version: parseStableSemver("2.0.0"), active: {
        version: parseStableSemver("1.0.0"), releaseSequence: "1", releaseIdentityHash: releaseIdentityHash(entry("1.0.0", "1"), "arm64"), delegationSequence: "1", delegationHash: parseLowerHexSha256(hash), releaseIndexSequence: "1", releaseIndexHash: parseLowerHexSha256(hash), bundleManifestHash: parseLowerHexSha256(hash), bundleRoot: admitCanonicalAbsolutePath("/product/releases/1.0.0/darwin-arm64", evidence), platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
      } as unknown as ReleaseIdentityV1,
    });
    if (selected.outcome !== "selected") throw new Error("expected selection");
    const manifest = validateBundleManifest({ schemaVersion: 1, version: "2.0.0", releaseSequence: "2", platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1, entrypoint: "bin/cli", runtimeEntrypoint: "bin/runtime", plannerEntrypoint: "bin/planner", verifierEntrypoint: "bin/verifier", entries: [{ path: "bin", kind: "directory", mode: 448 }, { path: "bin/cli", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/planner", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/runtime", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/verifier", kind: "file", mode: 448, bytes: "1", sha256: hash }] });
    const identity = { version: "2.0.0", releaseSequence: "2", releaseIdentityHash: selected.selected.releaseIdentityHash, delegationSequence: "2", delegationHash: hash, releaseIndexSequence: "2", releaseIndexHash: hash, bundleManifestHash: hash, bundleRoot: "/product/releases/2.0.0/darwin-arm64", platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1 };
    expect(admitReleaseIdentity(identity, evidence, { productHome: admitCanonicalAbsolutePath("/product", evidence), selected: selected.selected, metadata: { delegationSequence: "2", delegationHash: parseLowerHexSha256(hash), delegatedReleaseKeyId: parseLowerHexSha256(key), releaseIndexSequence: "2", releaseIndexHash: parseLowerHexSha256(hash) }, bundleManifest: manifest, bundleManifestHash: parseLowerHexSha256(hash) } as never)).toMatchObject({ version: "2.0.0" });
    expect(() => admitReleaseIdentity({ ...identity, bundleRoot: "/other/releases/2.0.0/darwin-arm64" }, evidence, {} as never)).toThrow();
  });

  it("permits lower trust observations only when an external guarded role names them", () => {
    const trust = validateReleaseTrustState({ schemaVersion: 1, highestDelegationSequence: "2", delegationHash: hash, delegatedReleaseKeyId: key, highestReleaseIndexSequence: "2", releaseIndexHash: hash, highestAcceptedReleaseSequence: "2", releaseIdentityHash: hash });
    const lower = { releaseSequence: "1", releaseIdentityHash: parseLowerHexSha256(hex("old")) } as never;
    expect(() => { admitReleaseAgainstTrust(trust, lower, "online_target"); }).toThrow();
    expect(() => { admitReleaseAgainstTrust(trust, lower, "guarded_active"); }).not.toThrow();
  });
  it.each(["guarded_active", "guarded_retained_rollback"] as const)("permits lower trust for %s", (role) => {
    const trust = validateReleaseTrustState({ schemaVersion: 1, highestDelegationSequence: "2", delegationHash: hash, delegatedReleaseKeyId: key, highestReleaseIndexSequence: "2", releaseIndexHash: hash, highestAcceptedReleaseSequence: "2", releaseIdentityHash: hash });
    expect(() => { admitReleaseAgainstTrust(trust, { releaseSequence: "1", releaseIdentityHash: parseLowerHexSha256(hex("old")) } as never, role); }).not.toThrow();
    expect(() => { admitReleaseAgainstTrust(trust, { releaseSequence: "3", releaseIdentityHash: parseLowerHexSha256(hex("new")) } as never, role); }).toThrow();
  });

  it.each([
    ["extra root", { schemaVersion: 1, kind: "index", signed: {}, signatures: [], extra: true }],
    ["wrong schema", { schemaVersion: 2, kind: "index", signed: {}, signatures: [] }],
    ["wrong kind", { schemaVersion: 1, kind: "delegation", signed: {}, signatures: [] }],
    ["two signatures", { schemaVersion: 1, kind: "index", signed: {}, signatures: [{ algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(64).toString("base64url") }, { algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(64).toString("base64url") }] }],
    ["63 byte signature", { schemaVersion: 1, kind: "index", signed: {}, signatures: [{ algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(63).toString("base64url") }] }],
    ["65 byte signature", { schemaVersion: 1, kind: "index", signed: {}, signatures: [{ algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(65).toString("base64url") }] }],
    ["padded signature", { schemaVersion: 1, kind: "index", signed: {}, signatures: [{ algorithm: "ed25519", keyId: hash, signature: `${Buffer.alloc(64).toString("base64url") }=` }] }],
  ])("refuses signed envelope %s", (_name, document) => {
    expect(() => validateSignedReleaseDocument(document, "index", (value) => value)).toThrow();
  });
  it("admits one exact 64-byte signature and signs only canonical no-LF content", () => {
    const document = { schemaVersion: 1, kind: "index", signed: { a: 1 }, signatures: [{ algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(64).toString("base64url") }] };
    expect(validateSignedReleaseDocument(document, "index", (value) => value).signatures).toHaveLength(1);
    expect(new TextDecoder().decode(signedReleaseDocumentSigningBytes("index", { a: 1 }))).toBe('developer-os/index/v1\0{"a":1}');
  });

  it.each([
    ["zero roots", []], ["reversed roots", [{ role: "retained_offline_previous", algorithm: "ed25519", keyId: hex(Buffer.alloc(32, 1)), publicKey: Buffer.alloc(32, 1).toString("base64url") }]],
  ])("refuses offline root cardinality/role %s", (_name, acceptedRoots) => {
    expect(() => validateOfflineReleaseTrust({ schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId: hex(Buffer.alloc(32, 1)), acceptedRoots, delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" }, indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" }, metadataRedirectOrigins: [{ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }] })).toThrow();
  });
  it("admits ordered current/previous root rotation and rejects duplicate root ids", () => {
    const first = Buffer.alloc(32, 1); const second = Buffer.alloc(32, 2);
    const roots = [
      { role: "online_current", algorithm: "ed25519", keyId: hex(first), publicKey: first.toString("base64url") },
      { role: "retained_offline_previous", algorithm: "ed25519", keyId: hex(second), publicKey: second.toString("base64url") },
    ];
    const handoff = { schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId: hex(first), acceptedRoots: roots, delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" }, indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" }, metadataRedirectOrigins: [{ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }] };
    expect(validateOfflineReleaseTrust(handoff).acceptedRoots).toHaveLength(2);
    expect(() => validateOfflineReleaseTrust({ ...handoff, acceptedRoots: [roots[0], { ...roots[1], keyId: hex(first) }] })).toThrow();
  });
  it.each([["no asset", []], ["five assets", Array.from({ length: 5 }, () => ({ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }))]])("refuses delegation asset cardinality %s", (_name, assetOrigins) => {
    const publicKey = Buffer.alloc(32, 3);
    expect(() => validateReleaseKeyDelegation({ sequence: "1", releaseKey: { algorithm: "ed25519", keyId: hex(publicKey), publicKey: publicKey.toString("base64url") }, metadataOrigins: [{ scheme: "https", host: "github.com", port: 443, pathPrefix: "/msolecki/developer-os/" }], assetOrigins })).toThrow();
  });

  it.each([
    ["trailing dot", "github.com."], ["wildcard", "*.example.com"], ["ipv6", "[::1]"],
  ])("refuses DNS grammar %s", (_name, host) => {
    expect(() => validateOfflineReleaseTrust({ schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId: hex(Buffer.alloc(32, 1)), acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: hex(Buffer.alloc(32, 1)), publicKey: Buffer.alloc(32, 1).toString("base64url") }], delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" }, indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" }, metadataRedirectOrigins: [{ scheme: "https", host, port: 443, pathPrefix: "/msolecki/developer-os/" }] })).toThrow();
  });

  it.each([
    ["empty release list", { sequence: "1", latestVersion: "1.0.0", releases: [] }],
    ["latest mismatch", { sequence: "1", latestVersion: "2.0.0", releases: [entry()] }],
    ["numeric semver reversal", { sequence: "1", latestVersion: "2.0.0", releases: [entry("10.0.0", "1"), entry("2.0.0", "2")] }],
    ["bundle extra key", { sequence: "1", latestVersion: "1.0.0", releases: [{ ...entry(), bundles: [{ ...bundle("arm64"), extra: true }, bundle("x64")] }] }],
  ])("refuses index cardinality/order/exact-key %s", (_name, index) => { expect(() => validateReleaseIndex(index)).toThrow(); });

  it.each([
    ["missing executable", (manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.filter((entry) => entry.path !== "bin/cli") })],
    ["non-executable entrypoint", (manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.map((entry) => entry.path === "bin/cli" ? { ...entry, mode: 384 } : entry) })],
    ["late parent", (manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: [...manifest.entries.slice(1), manifest.entries[0]] })],
    ["colon path", (manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.map((entry) => entry.path === "bin/cli" ? { ...entry, path: "bin/c:li" } : entry) })],
  ])("refuses bundle manifest %s", (_name, mutate) => { expect(() => validateBundleManifest(mutate(validManifest()))).toThrow(); });

  it.each([
    ["prefix 2049", `/${"a".repeat(2047)}/`], ["relative query", "a?b"], ["lower percent", "a%2f"], ["decoded slash", "a%2F"], ["decoded control", "a%00"],
  ])("refuses closed release prefix grammar %s", (_name, value) => { expect(() => parseOfficialReleasePathPrefix(value)).toThrow(); });
  it.each([["relative 2049", "a".repeat(2049)], ["fragment", "a#b"], ["dot", "."]])("refuses closed release relative grammar %s", (_name, value) => { expect(() => parseOfficialReleaseRelativePath(value)).toThrow(); });
  it.each([["prefix segment 129", `/${Array.from({ length: 129 }, () => "a").join("/")}/`], ["relative segment 129", Array.from({ length: 129 }, () => "a").join("/")], ["backslash", "a%5C"], ["dotdot", "%2E%2E"]])("refuses release path structural boundary %s", (_name, value) => { expect(() => parseOfficialReleasePathPrefix(`/${value}/`)).toThrow(); expect(() => parseOfficialReleaseRelativePath(value)).toThrow(); });

  it("admits 10,000 ordered releases and refuses the immediate 10,001st row", () => {
    const compact = (index: number) => ({ version: `0.0.${String(index)}`, releaseSequence: String(index), minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [
      { platform: "darwin", architecture: "arm64", archiveFormat: "zstd-ustar-v1", archivePath: "a.tar.zst", archiveBytes: "1", archiveSha256: hash, manifestPath: "m", manifestBytes: "1", manifestSha256: hash },
      { platform: "darwin", architecture: "x64", archiveFormat: "zstd-ustar-v1", archivePath: "a.tar.zst", archiveBytes: "1", archiveSha256: hash, manifestPath: "m", manifestBytes: "1", manifestSha256: hash },
    ] });
    const releases = Array.from({ length: 10_000 }, (_, index) => compact(index));
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "0.0.9999", releases })).toThrow("invalid ReleaseIndexV1 bytes");
    expect(() => validateReleaseIndex({ sequence: "1", latestVersion: "0.0.10000", releases: [...releases, compact(10_000)] })).toThrow("invalid ReleaseIndexV1.releases");
  });

  it("refuses the 200,001st bundle-manifest row before entry validation", () => {
    const manifest = validManifest();
    expect(() => validateBundleManifest({ ...manifest, entries: Array.from({ length: 200_001 }, () => manifest.entries[0]) })).toThrow("invalid ReleaseBundleManifestV1.entries");
  });

  it.each([
    ["version", (value: ReturnType<typeof entry>) => ({ ...value, version: "2.0.0" })],
    ["release sequence", (value: ReturnType<typeof entry>) => ({ ...value, releaseSequence: "2" })],
    ["minimum launcher protocol", (value: ReturnType<typeof entry>) => ({ ...value, minimumLauncherProtocol: 2 })],
    ["update protocol", (value: ReturnType<typeof entry>) => ({ ...value, updateProtocol: 2 })],
    ["archive path", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], archivePath: "other.tar.zst" }, value.bundles[1]] })],
    ["archive bytes", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], archiveBytes: "2" }, value.bundles[1]] })],
    ["archive hash", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], archiveSha256: hex("archive") }, value.bundles[1]] })],
    ["manifest path", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], manifestPath: "other.json" }, value.bundles[1]] })],
    ["manifest bytes", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], manifestBytes: "2" }, value.bundles[1]] })],
    ["manifest hash", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], manifestSha256: hex("manifest") }, value.bundles[1]] })],
  ])("changes the selected-arm64 identity hash when projection %s changes", (_name, mutate) => {
    expect(releaseIdentityHash(mutate(entry()), "arm64")).not.toBe(releaseIdentityHash(entry(), "arm64"));
  });
  it.each([
    ["platform", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], platform: "not-darwin" }, value.bundles[1]] })],
    ["architecture", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [value.bundles[0], { ...value.bundles[1], architecture: "arm64" }] })],
    ["archive format", (value: ReturnType<typeof entry>) => ({ ...value, bundles: [{ ...value.bundles[0], archiveFormat: "other" }, value.bundles[1]] })],
  ])("refuses an invalid selected bundle projection field %s", (_name, mutate) => {
    expect(() => releaseIdentityHash(mutate(entry()), "arm64")).toThrow();
  });

  it("uses the specified ASCII identity domain and canonical projection without its LF", () => {
    const expectedProjection = '{"bundle":{"architecture":"arm64","archiveBytes":"1","archiveFormat":"zstd-ustar-v1","archivePath":"bundles/arm64.tar.zst","archiveSha256":"' + hash + '","manifestBytes":"1","manifestPath":"bundles/arm64.manifest.json","manifestSha256":"' + hash + '","platform":"darwin"},"minimumLauncherProtocol":1,"releaseSequence":"1","updateProtocol":1,"version":"1.0.0"}';
    const expected = createHash("sha256").update("developer-os/release-identity/v1\0", "ascii").update(expectedProjection, "utf8").digest("hex");
    expect(releaseIdentityHash(entry(), "arm64")).toBe(expected);
    expect(releaseIdentityHash({ ...entry(), bundles: [entry().bundles[0], { ...entry().bundles[1], archiveSha256: hex("ignored") }] }, "arm64")).toBe(expected);
  });

  it("returns detached selection and active values", () => {
    const source = validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] });
    const active = identityFixture("1.0.0", "1");
    const result = selectRelease(source, { version: parseStableSemver("2.0.0"), active });
    if (result.outcome !== "selected") throw new Error("expected selected");
    const mutableSource = source as unknown as { releases: [{ bundles: [{ archivePath: string }] }, { bundles: [{ archivePath: string }] }] };
    mutableSource.releases[1].bundles[0].archivePath = "mutated.tar.zst";
    (active as { bundleRoot: string }).bundleRoot = "/mutated";
    expect(result.selected.bundle.archivePath).toBe("bundles/arm64.tar.zst");
    expect(selectRelease(validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry()] }), { version: parseStableSemver("1.0.0"), active: identityFixture() })).toMatchObject({ outcome: "up_to_date", active: { bundleRoot: "/product/releases/1.0.0/darwin-arm64" } });
  });

  it.each([
    [null, "2.0.0", "selected"],
    [parseStableSemver("2.0.0"), "2.0.0", "selected"],
    [parseStableSemver("1.0.0"), "1.0.0", "up_to_date"],
  ] as const)("selects %s as %s with outcome %s", (version, expected, outcome) => {
    const result = selectRelease(validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] }), { version, active: identityFixture() });
    expect(result.outcome).toBe(outcome);
    expect(result.outcome === "selected" ? result.selected.entry.version : result.active.version).toBe(expected);
  });

  it("refuses a present lower requested release", () => {
    expect(() => selectRelease(validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] }), { version: parseStableSemver("1.0.0"), active: identityFixture("2.0.0", "2") })).toThrow("release downgrade");
  });

  it.each(["localhost", "a".repeat(64), Array.from({ length: 128 }, () => "a").join("."), "127.0.0.1", "[::1]"])("refuses DNS boundary %s", (host) => {
    expect(() => parseLowercaseHost(host)).toThrow();
  });
  it("admits DNS 63-byte labels, 253-byte total, and 127 labels", () => {
    expect(parseLowercaseHost(`${"a".repeat(63)}.com`)).toBe(`${"a".repeat(63)}.com`);
    expect(parseLowercaseHost(`${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`)).toHaveLength(253);
    expect(parseLowercaseHost(Array.from({ length: 127 }, () => "a").join("."))).toHaveLength(253);
  });
  it("admits legal LDH names with a numeric final label", () => {
    expect(parseLowercaseHost("foo.123")).toBe("foo.123");
  });
  it.each(["127.0.0.1", "127.1", "0x7f.1", "0177.0.0.1", "2130706433"])("refuses alternate IPv4 spelling %s", (host) => {
    expect(() => parseLowercaseHost(host)).toThrow();
  });

  it("admits exact URL path bounds and refuses their first overages", () => {
    expect(parseOfficialReleasePathPrefix(`/${"a".repeat(2046)}/`)).toHaveLength(2048);
    expect(parseOfficialReleaseRelativePath("a".repeat(2048))).toHaveLength(2048);
    expect(() => parseOfficialReleasePathPrefix(`/${"a".repeat(2047)}/`)).toThrow();
    expect(() => parseOfficialReleaseRelativePath("a".repeat(2049))).toThrow();
  });

  it.each([
    ["wrong algorithm", { algorithm: "rsa" }],
    ["nested extra", { keyId: hash, extra: true }],
  ])("refuses signed document %s", (_name, mutation) => {
    const document = { schemaVersion: 1, kind: "index", signed: {}, signatures: [{ algorithm: "ed25519", keyId: hash, signature: Buffer.alloc(64).toString("base64url"), ...mutation }] };
    expect(() => validateSignedReleaseDocument(document, "index", (value) => value)).toThrow();
  });

  it.each([1, 4])("admits delegation with %i distinct asset origins", (count) => {
    const publicKey = Buffer.alloc(32, 8);
    expect(validateReleaseKeyDelegation({ sequence: "1", releaseKey: { algorithm: "ed25519", keyId: hex(publicKey), publicKey: publicKey.toString("base64url") }, metadataOrigins: [origin("metadata")], assetOrigins: Array.from({ length: count }, (_, index) => origin(`asset-${String(index)}`)) }).assetOrigins).toHaveLength(count);
  });
  it.each([
    ["metadata zero", []], ["metadata two", [origin("one"), origin("two")]], ["duplicate assets", [origin("same"), origin("same")]], ["key id mismatch", [origin("one")]],
  ])("refuses delegation %s", (_name, metadataOrigins) => {
    const publicKey = Buffer.alloc(32, 9);
    expect(() => validateReleaseKeyDelegation({ sequence: "1", releaseKey: { algorithm: "ed25519", keyId: _name === "key id mismatch" ? hash : hex(publicKey), publicKey: publicKey.toString("base64url") }, metadataOrigins: _name === "duplicate assets" || _name === "key id mismatch" ? [origin("metadata")] : metadataOrigins, assetOrigins: _name === "duplicate assets" ? metadataOrigins : [origin("asset")] })).toThrow();
  });

  it.each([
    ["missing", (role: string, manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.filter((entry) => entry.path !== role) })],
    ["directory", (role: string, manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.map((entry) => entry.path === role ? { path: role, kind: "directory", mode: 448 } : entry) })],
    ["0600", (role: string, manifest: ReturnType<typeof validManifest>) => ({ ...manifest, entries: manifest.entries.map((entry) => entry.path === role ? { ...entry, mode: 384 } : entry) })],
  ])("refuses each entrypoint when %s", (_case, mutate) => {
    for (const role of ["bin/cli", "bin/runtime", "bin/planner", "bin/verifier"]) expect(() => validateBundleManifest(mutate(role, validManifest()))).toThrow();
  });

  it.each([
    ["256-byte path", "a".repeat(256)], ["33 components", Array.from({ length: 33 }, () => "a").join("/")], ["101-byte component", `bin/${"a".repeat(101)}`], ["156-byte prefix", `${"a".repeat(78)}/${"b".repeat(77)}/c`], ["non-NFC", "bin/e\u0301"], ["control", "bin/a\u0001"], ["colon", "bin/a:b"], ["leading hyphen", "bin/-a"],
  ])("refuses BundleRelativePath %s", (_name, path) => {
    const manifest = validManifest();
    expect(() => validateBundleManifest({ ...manifest, entries: [...manifest.entries, { path, kind: "file", mode: 384, bytes: "1", sha256: hash }] })).toThrow();
  });

  it("refuses exact and folded duplicate inventory paths and unsigned UTF-8 order", () => {
    const manifest = validManifest();
    expect(() => validateBundleManifest({ ...manifest, entries: [...manifest.entries, { path: "bin/verifier", kind: "file", mode: 384, bytes: "1", sha256: hash }] })).toThrow();
    expect(() => validateBundleManifest({ ...manifest, entries: [...manifest.entries, { path: "bin/VERIFIER", kind: "file", mode: 384, bytes: "1", sha256: hash }] })).toThrow();
    expect(() => validateBundleManifest({ ...manifest, entries: [manifest.entries[0], { path: "bin/zz", kind: "file", mode: 384, bytes: "1", sha256: hash }, ...manifest.entries.slice(1)] })).toThrow();
  });

  it("enforces exact 512MiB files and 8GiB aggregate expansion", () => {
    const atFile = validManifest();
    atFile.entries = atFile.entries.map((item) => item.kind === "file" && item.path === "bin/cli" ? { ...item, bytes: "536870912" } : item);
    expect(validateBundleManifest(atFile)).toBeDefined();
    expect(() => validateBundleManifest({ ...atFile, entries: atFile.entries.map((item) => item.kind === "file" && item.path === "bin/cli" ? { ...item, bytes: "536870913" } : item) })).toThrow();
    const exactlyEightGiB = aggregateManifest(0);
    expect(validateBundleManifest(exactlyEightGiB)).toBeDefined();
    expect(() => validateBundleManifest(aggregateManifest(1))).toThrow();
  });

  it("validates active exact keys, timestamp, and canonical path independently", () => {
    const active = { schemaVersion: 1, ...identityFixture(), activatedAt: "2026-08-29T12:00:00.000Z" };
    expect(validateActiveReleaseRecord(active, evidence)).toMatchObject({ activatedAt: "2026-08-29T12:00:00.000Z" });
    expect(() => validateActiveReleaseRecord({ ...active, extra: true }, evidence)).toThrow();
    expect(() => validateActiveReleaseRecord({ ...active, activatedAt: "nope" }, evidence)).toThrow();
    expect(() => validateActiveReleaseRecord({ ...active, bundleRoot: "not-absolute" }, evidence)).toThrow();
  });

  it("admits a reordered, exact selected bundle through the complete identity context", () => {
    const fixture = identityAdmissionFixture();
    const reordered = { manifestSha256: fixture.selected.bundle.manifestSha256, manifestBytes: fixture.selected.bundle.manifestBytes, manifestPath: fixture.selected.bundle.manifestPath, archiveSha256: fixture.selected.bundle.archiveSha256, archiveBytes: fixture.selected.bundle.archiveBytes, archivePath: fixture.selected.bundle.archivePath, archiveFormat: fixture.selected.bundle.archiveFormat, architecture: fixture.selected.bundle.architecture, platform: fixture.selected.bundle.platform };
    expect(admitReleaseIdentity(fixture.identity, evidence, { ...fixture.context, selected: { ...fixture.selected, bundle: reordered } } as never)).toEqual(fixture.identity);
  });
  it("refuses a coherent identity/context manifest hash that differs from the selected bundle hash", () => {
    const fixture = identityAdmissionFixture();
    const coherentHash = parseLowerHexSha256(hex("coherent-manifest"));
    const identity = { ...fixture.identity, bundleManifestHash: coherentHash };
    const context = { ...fixture.context, bundleManifestHash: coherentHash };
    expect(() => admitReleaseIdentity(identity, evidence, context as never)).toThrow("ReleaseIdentityV1 context");
  });

  it("refuses a folded alias after its directory parent in unsigned UTF-8 order", () => {
    const manifest = validManifest();
    const foldedAlias = { path: "bin/Verifier", kind: "file", mode: 384, bytes: "1", sha256: hash };
    expect(() => validateBundleManifest({ ...manifest, entries: [manifest.entries[0], foldedAlias, ...manifest.entries.slice(1)] })).toThrow("entries order");
  });
  it("refuses an independently out-of-order inventory vector", () => {
    const manifest = validManifest();
    expect(() => validateBundleManifest({ ...manifest, entries: [manifest.entries[0], { path: "bin/zz", kind: "file", mode: 384, bytes: "1", sha256: hash }, ...manifest.entries.slice(1)] })).toThrow("entries order");
  });

  it.each(["delegation", "index", "release"] as const)("allows independent higher %s watermark advancement", (field) => {
    const current = trustFixture(); const accepted = acceptedFixture();
    if (field === "delegation") { accepted.delegationSequence = "2"; accepted.delegationHash = hex("d2"); accepted.delegatedReleaseKeyId = hex("k2"); }
    if (field === "index") { accepted.releaseIndexSequence = "2"; accepted.releaseIndexHash = hex("i2"); }
    if (field === "release") { accepted.releaseSequence = "2"; accepted.releaseIdentityHash = hex("r2"); }
    expect(advanceReleaseTrust(current, accepted as never)).toBeDefined();
  });
  it.each(["online_target", "guarded_active", "guarded_retained_rollback"] as const)("refuses equal release hash mismatch for %s", (role) => {
    expect(() => {
      admitReleaseAgainstTrust(trustFixture(), { releaseSequence: "1", releaseIdentityHash: hex("other") } as never, role);
    }).toThrow();
  });
  it.each([
    ["delegation hash", { delegationHash: hex("other") }],
    ["delegation key", { delegatedReleaseKeyId: hex("other") }],
    ["index hash", { releaseIndexHash: hex("other") }],
    ["release hash", { releaseIdentityHash: hex("other") }],
  ])("refuses equal %s watermark mismatch", (_name, mutation) => {
    expect(() => advanceReleaseTrust(trustFixture(), { ...acceptedFixture(), ...mutation } as never)).toThrow();
  });
  it.each([
    ["delegation", (accepted: ReturnType<typeof acceptedAtTwo>) => ({ ...accepted, delegationSequence: "1" }), "delegation replay"],
    ["index", (accepted: ReturnType<typeof acceptedAtTwo>) => ({ ...accepted, releaseIndexSequence: "1" }), "index replay"],
    ["release", (accepted: ReturnType<typeof acceptedAtTwo>) => ({ ...accepted, releaseSequence: "1" }), "release replay"],
  ])("refuses branch-valid lower %s watermark observations", (_name, mutate, expectedError) => {
    expect(() => advanceReleaseTrust(trustAtTwo(), mutate(acceptedAtTwo()) as never)).toThrow(expectedError);
  });
  it("keeps equal matching and independent higher trust observations valid", () => {
    expect(advanceReleaseTrust(trustAtTwo(), acceptedAtTwo() as never)).toEqual(trustAtTwo());
    expect(advanceReleaseTrust(trustAtTwo(), { ...acceptedAtTwo(), releaseIndexSequence: "3", releaseIndexHash: hex("i3") } as never)).toMatchObject({ highestReleaseIndexSequence: "3" });
  });

  it.each([
    ["three roots", (input: ReturnType<typeof offlineTrustFixture>) => ({ ...input, acceptedRoots: [...input.acceptedRoots, input.acceptedRoots[0]] })],
    ["mismatched online root key id", (input: ReturnType<typeof offlineTrustFixture>) => ({ ...input, onlineRootKeyId: hash })],
    ["mismatched locator pairing", (input: ReturnType<typeof offlineTrustFixture>) => ({ ...input, delegationLocator: { ...input.delegationLocator, assetName: "release-index-v1.json" } })],
  ])("refuses offline trust %s", (_name, mutate) => {
    expect(() => validateOfflineReleaseTrust(mutate(offlineTrustFixture()))).toThrow();
  });

  it("keeps offline trust byte limits conjunctive with its root and origin cardinalities", () => {
    const input = offlineTrustFixture();
    input.metadataRedirectOrigins = Array.from({ length: 5 }, (_, index) => ({ scheme: "https", host: `a${String(index)}.example`, port: 443, pathPrefix: `/${"a".repeat(2045)}/` }));
    expect(() => validateOfflineReleaseTrust(input)).toThrow("metadataRedirectOrigins");
  });

  it("enforces the bundle-manifest byte cap independently of its 200,000-row cardinality cap", () => {
    const manifest = validManifest();
    const longEntries = Array.from({ length: 80_000 }, (_, index) => ({ path: `bin/z${String(index).padStart(5, "0")}${"a".repeat(93)}`, kind: "file", mode: 384, bytes: "1", sha256: hash }));
    expect(() => validateBundleManifest({ ...manifest, entries: [...manifest.entries, ...longEntries] })).toThrow("ReleaseBundleManifestV1 bytes");
    expect(() => validateBundleManifest({ ...manifest, entries: Array.from({ length: 200_001 }, () => manifest.entries[0]) })).toThrow("ReleaseBundleManifestV1.entries");
  });

  it.each([
    ["metadata delegation sequence", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, metadata: { ...fixture.context.metadata, delegationSequence: "3" } })],
    ["metadata delegation hash", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, metadata: { ...fixture.context.metadata, delegationHash: hex("other") } })],
    ["metadata index sequence", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, metadata: { ...fixture.context.metadata, releaseIndexSequence: "3" } })],
    ["metadata index hash", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, metadata: { ...fixture.context.metadata, releaseIndexHash: hex("other") } })],
    ["selected version", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, selected: { ...fixture.selected, entry: { ...fixture.selected.entry, version: "3.0.0" } } })],
    ["selected minimum launcher protocol", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, selected: { ...fixture.selected, entry: { ...fixture.selected.entry, minimumLauncherProtocol: 2 } } })],
    ["selected manifest hash", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, selected: { ...fixture.selected, bundle: { ...fixture.selected.bundle, manifestSha256: hex("other") } } })],
    ["verified bundle manifest hash", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, bundleManifestHash: hex("other") })],
    ["manifest version", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, bundleManifest: { ...fixture.context.bundleManifest, version: "3.0.0" } })],
    ["manifest launcher protocol", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, bundleManifest: { ...fixture.context.bundleManifest, launcherProtocol: 2 } })],
    ["canonical root", (fixture: ReturnType<typeof identityAdmissionFixture>) => ({ ...fixture.context, productHome: "/other" })],
  ])("refuses identity admission when bound %s changes", (_name, mutate) => {
    const fixture = identityAdmissionFixture();
    expect(() => admitReleaseIdentity(fixture.identity, evidence, mutate(fixture) as never)).toThrow();
  });

  it("returns a detached admitted identity after context-bound validation", () => {
    const fixture = identityAdmissionFixture();
    const admitted = admitReleaseIdentity(fixture.identity, evidence, fixture.context as never);
    (fixture.identity as { bundleRoot: string }).bundleRoot = "/product/releases/mutated/darwin-arm64";
    expect(admitted.bundleRoot).toBe("/product/releases/2.0.0/darwin-arm64");
  });
  it("composes a validated active record through context-bound identity admission", () => {
    const fixture = identityAdmissionFixture();
    const active = validateActiveReleaseRecord({ schemaVersion: 1, ...fixture.identity, activatedAt: "2026-08-29T12:00:00.000Z" }, evidence);
    const identity = { version: active.version, releaseSequence: active.releaseSequence, releaseIdentityHash: active.releaseIdentityHash, delegationSequence: active.delegationSequence, delegationHash: active.delegationHash, releaseIndexSequence: active.releaseIndexSequence, releaseIndexHash: active.releaseIndexHash, bundleManifestHash: active.bundleManifestHash, bundleRoot: active.bundleRoot, platform: active.platform, architecture: active.architecture, launcherProtocol: active.launcherProtocol, updateProtocol: active.updateProtocol };
    expect(admitReleaseIdentity(identity, evidence, fixture.context as never)).toEqual(identity);
  });

  it.each([
    ["offline root", () => validateOfflineReleaseTrust({ ...offlineTrustFixture(), extra: true })],
    ["delegation root", () => validateReleaseKeyDelegation({ ...delegationFixture(), extra: true })],
    ["delegated key", () => validateReleaseKeyDelegation({ ...delegationFixture(), releaseKey: { ...delegationFixture().releaseKey, extra: true } })],
    ["index root", () => validateReleaseIndex({ ...validateReleaseIndex({ sequence: "1", latestVersion: "1.0.0", releases: [entry()] }), extra: true })],
    ["manifest row", () => validateBundleManifest({ ...validManifest(), entries: [{ ...validManifest().entries[0], extra: true }, ...validManifest().entries.slice(1)] })],
    ["trust root", () => validateReleaseTrustState({ ...trustFixture(), extra: true })],
    ["identity root", () => validateReleaseIdentity({ ...identityFixture(), extra: true }, evidence)],
  ])("refuses nested persisted schema extra key: %s", (_name, validate) => {
    expect(validate).toThrow();
  });
});

function validManifest() {
  return { schemaVersion: 1, version: "1.0.0", releaseSequence: "1", platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1, entrypoint: "bin/cli", runtimeEntrypoint: "bin/runtime", plannerEntrypoint: "bin/planner", verifierEntrypoint: "bin/verifier", entries: [{ path: "bin", kind: "directory", mode: 448 }, { path: "bin/cli", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/planner", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/runtime", kind: "file", mode: 448, bytes: "1", sha256: hash }, { path: "bin/verifier", kind: "file", mode: 448, bytes: "1", sha256: hash }] };
}

function parseLowercaseHost(host: string) { return parseLowercaseAsciiDnsName(host); }
function origin(host: string) { return { scheme: "https", host: `${host}.example`, port: 443, pathPrefix: "/releases/" }; }
function identityFixture(version = "1.0.0", sequence = "1") {
  return { version: parseStableSemver(version), releaseSequence: sequence, releaseIdentityHash: releaseIdentityHash(entry(version, sequence), "arm64"), delegationSequence: "1", delegationHash: parseLowerHexSha256(hash), releaseIndexSequence: "1", releaseIndexHash: parseLowerHexSha256(hash), bundleManifestHash: parseLowerHexSha256(hash), bundleRoot: admitCanonicalAbsolutePath(`/product/releases/${version}/darwin-arm64`, evidence), platform: "darwin" as const, architecture: "arm64" as const, launcherProtocol: 1, updateProtocol: 1 } as ReleaseIdentityV1;
}
function aggregateManifest(extra: 0 | 1) {
  const manifest = validManifest();
  const executableBytes = "536870912";
  const entries = manifest.entries.map((item) => item.kind === "file" ? { ...item, bytes: executableBytes } : item);
  for (let index = 0; index < 12; index += 1) entries.push({ path: `bin/z${String(index).padStart(2, "0")}`, kind: "file", mode: 384, bytes: executableBytes, sha256: hash });
  if (extra === 1) entries.push({ path: "bin/z12", kind: "file", mode: 384, bytes: "1", sha256: hash });
  return { ...manifest, entries };
}
function identityAdmissionFixture() {
  const selected = selectRelease(validateReleaseIndex({ sequence: "2", latestVersion: "2.0.0", releases: [entry("1.0.0", "1"), entry("2.0.0", "2")] }), { version: parseStableSemver("2.0.0"), active: identityFixture() });
  if (selected.outcome !== "selected") throw new Error("expected selected");
  const manifest = validateBundleManifest({ ...validManifest(), version: "2.0.0", releaseSequence: "2" });
  const manifestHash = parseLowerHexSha256(hash);
  const identity = { ...identityFixture("2.0.0", "2"), delegationSequence: "2", delegationHash: parseLowerHexSha256(hash), releaseIndexSequence: "2", releaseIndexHash: parseLowerHexSha256(hash), bundleManifestHash: manifestHash };
  return { identity, selected: selected.selected, context: { productHome: admitCanonicalAbsolutePath("/product", evidence), selected: selected.selected, metadata: { delegationSequence: "2", delegationHash: parseLowerHexSha256(hash), delegatedReleaseKeyId: parseLowerHexSha256(key), releaseIndexSequence: "2", releaseIndexHash: parseLowerHexSha256(hash) }, bundleManifest: manifest, bundleManifestHash: manifestHash } };
}
function trustFixture() { return validateReleaseTrustState({ schemaVersion: 1, highestDelegationSequence: "1", delegationHash: hash, delegatedReleaseKeyId: key, highestReleaseIndexSequence: "1", releaseIndexHash: hash, highestAcceptedReleaseSequence: "1", releaseIdentityHash: hash }); }
function acceptedFixture() { return { delegationSequence: "1", delegationHash: hash, delegatedReleaseKeyId: key, releaseIndexSequence: "1", releaseIndexHash: hash, releaseSequence: "1", releaseIdentityHash: hash }; }
function trustAtTwo() { return validateReleaseTrustState({ schemaVersion: 1, highestDelegationSequence: "2", delegationHash: hex("d2"), delegatedReleaseKeyId: hex("k2"), highestReleaseIndexSequence: "2", releaseIndexHash: hex("i2"), highestAcceptedReleaseSequence: "2", releaseIdentityHash: hex("r2") }); }
function acceptedAtTwo() { return { delegationSequence: "2", delegationHash: hex("d2"), delegatedReleaseKeyId: hex("k2"), releaseIndexSequence: "2", releaseIndexHash: hex("i2"), releaseSequence: "2", releaseIdentityHash: hex("r2") }; }
function offlineTrustFixture() {
  const publicKey = Buffer.alloc(32, 17);
  return { schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId: hex(publicKey), acceptedRoots: [{ role: "online_current", algorithm: "ed25519", keyId: hex(publicKey), publicKey: publicKey.toString("base64url") }], delegationLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-key-delegation-v1.json" }, indexLocator: { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: "release-index-v1.json" }, metadataRedirectOrigins: [origin("redirect")] };
}
function delegationFixture() {
  const publicKey = Buffer.alloc(32, 18);
  return { sequence: "1", releaseKey: { algorithm: "ed25519", keyId: hex(publicKey), publicKey: publicKey.toString("base64url") }, metadataOrigins: [origin("metadata")], assetOrigins: [origin("asset")] };
}
