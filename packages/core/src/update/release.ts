import { createHash } from "node:crypto";

import { compareUtf8, encodeCanonicalJson, hashCanonicalJsonNoLf, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { EXIT_CODES } from "../result.js";
import { admitCanonicalAbsolutePath, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1 } from "./paths.js";
import {
  exact,
  fail,
  list,
  record,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseStableSemver,
  parseUInt64Decimal,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type StableSemverV1,
  type UInt64DecimalV1,
  type UtcTimestampV1,
  parseUtcTimestamp,
} from "./scalars.js";

declare const base64UrlNoPaddingV1: unique symbol;
declare const lowercaseAsciiDnsNameV1: unique symbol;
declare const officialReleasePathPrefixV1: unique symbol;
declare const officialReleaseRelativePathV1: unique symbol;
declare const bundleRelativePathV1: unique symbol;

export type Base64UrlNoPaddingV1 = string & { readonly [base64UrlNoPaddingV1]: true };
export type LowercaseAsciiDnsNameV1 = string & { readonly [lowercaseAsciiDnsNameV1]: true };
export type OfficialReleasePathPrefixV1 = string & { readonly [officialReleasePathPrefixV1]: true };
export type OfficialReleaseRelativePathV1 = string & { readonly [officialReleaseRelativePathV1]: true };
export type BundleRelativePathV1 = string & { readonly [bundleRelativePathV1]: true };

export interface Ed25519SignatureV1 {
  readonly algorithm: "ed25519";
  readonly keyId: LowerHexSha256;
  readonly signature: Base64UrlNoPaddingV1;
}

export interface SignedReleaseDocumentV1<TKind extends string, TSigned> {
  readonly schemaVersion: 1;
  readonly kind: TKind;
  readonly signed: TSigned;
  readonly signatures: readonly [Ed25519SignatureV1];
}

export interface OfficialReleaseOriginV1 {
  readonly scheme: "https";
  readonly host: LowercaseAsciiDnsNameV1;
  readonly port: 443;
  readonly pathPrefix: OfficialReleasePathPrefixV1;
}

export type OfficialReleaseAssetOriginV1 = OfficialReleaseOriginV1;

export interface FixedReleaseMetadataLocatorV1 {
  readonly origin: "https://github.com";
  readonly repositoryPath: "/msolecki/developer-os/releases/latest/download/";
  readonly assetName: "release-key-delegation-v1.json" | "release-index-v1.json";
}

export interface OfflineRootKeyV1 {
  readonly role: "online_current" | "retained_offline_previous";
  readonly algorithm: "ed25519";
  readonly keyId: LowerHexSha256;
  readonly publicKey: Base64UrlNoPaddingV1;
}

export interface OfflineReleaseTrustV1 {
  readonly schemaVersion: 1;
  readonly handoffProtocol: 1;
  readonly onlineRootKeyId: LowerHexSha256;
  readonly acceptedRoots: readonly OfflineRootKeyV1[];
  readonly delegationLocator: FixedReleaseMetadataLocatorV1;
  readonly indexLocator: FixedReleaseMetadataLocatorV1;
  readonly metadataRedirectOrigins: readonly OfficialReleaseAssetOriginV1[];
}

export interface DelegatedReleaseKeyV1 {
  readonly algorithm: "ed25519";
  readonly keyId: LowerHexSha256;
  readonly publicKey: Base64UrlNoPaddingV1;
}

export interface ReleaseKeyDelegationV1 {
  readonly sequence: UInt64DecimalV1;
  readonly releaseKey: DelegatedReleaseKeyV1;
  readonly metadataOrigins: readonly [OfficialReleaseOriginV1];
  readonly assetOrigins: readonly OfficialReleaseAssetOriginV1[];
}

export interface ReleaseBundleReferenceV1 {
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly archiveFormat: "zstd-ustar-v1";
  readonly archivePath: OfficialReleaseRelativePathV1;
  readonly archiveBytes: UInt64DecimalV1;
  readonly archiveSha256: LowerHexSha256;
  readonly manifestPath: OfficialReleaseRelativePathV1;
  readonly manifestBytes: UInt64DecimalV1;
  readonly manifestSha256: LowerHexSha256;
}

export interface ReleaseIndexEntryV1 {
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly minimumLauncherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
  readonly bundles: readonly [ReleaseBundleReferenceV1 & { readonly architecture: "arm64" }, ReleaseBundleReferenceV1 & { readonly architecture: "x64" }];
}

export interface ReleaseIndexV1 {
  readonly sequence: UInt64DecimalV1;
  readonly latestVersion: StableSemverV1;
  readonly releases: readonly ReleaseIndexEntryV1[];
}

export type ReleaseBundleEntryV1 =
  | { readonly path: BundleRelativePathV1; readonly kind: "directory"; readonly mode: 448 }
  | { readonly path: BundleRelativePathV1; readonly kind: "file"; readonly mode: 384 | 448; readonly bytes: UInt64DecimalV1; readonly sha256: LowerHexSha256 };

export interface ReleaseBundleManifestV1 {
  readonly schemaVersion: 1;
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
  readonly entrypoint: BundleRelativePathV1;
  readonly runtimeEntrypoint: BundleRelativePathV1;
  readonly plannerEntrypoint: BundleRelativePathV1;
  readonly verifierEntrypoint: BundleRelativePathV1;
  readonly entries: readonly ReleaseBundleEntryV1[];
}

export interface ReleaseIdentityV1 {
  readonly version: StableSemverV1;
  readonly releaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
  readonly delegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly releaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly bundleManifestHash: LowerHexSha256;
  readonly bundleRoot: CanonicalAbsolutePathV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly launcherProtocol: PositiveUInt32V1;
  readonly updateProtocol: PositiveUInt32V1;
}
export interface SelectedReleaseV1 {
  readonly entry: ReleaseIndexEntryV1;
  readonly bundle: ReleaseBundleReferenceV1;
  readonly releaseIdentityHash: LowerHexSha256;
}
export interface ReleaseIdentityAdmissionContextV1 {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly selected: SelectedReleaseV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly bundleManifest: ReleaseBundleManifestV1;
  readonly bundleManifestHash: LowerHexSha256;
}

export interface ReleaseMetadataIdentityV1 {
  readonly delegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly delegatedReleaseKeyId: LowerHexSha256;
  readonly releaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
}

export interface ActiveReleaseRecordV1 extends ReleaseIdentityV1 {
  readonly schemaVersion: 1;
  readonly activatedAt: UtcTimestampV1;
}

export interface SignedReleaseTrustStateV1 {
  readonly schemaVersion: 1;
  readonly highestDelegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly delegatedReleaseKeyId: LowerHexSha256;
  readonly highestReleaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly highestAcceptedReleaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
}
export type UnsignedLocalReleaseTrustStateV1 = SignedReleaseTrustStateV1 & { readonly trust: "unsigned-local" };
export type PackageChannelReleaseTrustStateV1 = SignedReleaseTrustStateV1 & { readonly trust: "package-channel" };
export type ReleaseTrustStateV1 = SignedReleaseTrustStateV1 | UnsignedLocalReleaseTrustStateV1 | PackageChannelReleaseTrustStateV1;

export const UNSIGNED_LOCAL_RELEASE_KEY_ID = createHash("sha256").update("developer-os:unsigned-local-release-key:v1", "ascii").digest("hex") as LowerHexSha256;

export const PACKAGE_CHANNEL_RELEASE_KEY_ID = createHash("sha256").update("developer-os:package-channel-release-key:v1", "ascii").digest("hex") as LowerHexSha256;
/** The package-channel keg layout (D84 K4); the paths equal the unsigned-local layout. */
export const PACKAGE_CHANNEL_LAYOUT = Object.freeze({
  delegation: "metadata/release-key-delegation.json",
  releaseIndex: "metadata/release-index.json",
  bundleManifest: "metadata/bundle-manifest.json",
  bundleRoot: "bundle",
} as const);
/** The fixed keg locator table: the only place the CLI finds the Homebrew keg. */
export const PACKAGE_CHANNEL_SOURCE_TABLE = Object.freeze({
  arm64: Object.freeze({ prefix: "/opt/homebrew" as CanonicalAbsolutePathV1, opt: "/opt/homebrew/opt/developer-os" as CanonicalAbsolutePathV1, fallback: "libexec/fallback" as const }),
  x64: Object.freeze({ prefix: "/usr/local" as CanonicalAbsolutePathV1, opt: "/usr/local/opt/developer-os" as CanonicalAbsolutePathV1, fallback: "libexec/fallback" as const }),
}) as Readonly<Record<"arm64" | "x64", { readonly prefix: CanonicalAbsolutePathV1; readonly opt: CanonicalAbsolutePathV1; readonly fallback: "libexec/fallback" }>>;
export const PACKAGE_CHANNEL_DELEGATION_BYTES: Uint8Array = new TextEncoder().encode(encodeCanonicalJson({ schemaVersion: 1, trust: "package-channel" }));
export function validatePackageChannelDelegation(value: unknown): void {
  const input = exact(value, ["schemaVersion", "trust"], "PackageChannelDelegationV1");
  if (input.schemaVersion !== 1 || input.trust !== "package-channel") fail("PackageChannelDelegationV1");
}

export class ReleaseUnsignedLocalError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;
  readonly reason = "release_unsigned_local" as const;
  constructor() {
    super("release_unsigned_local: an unsigned local build is never an update source or rollback target");
    this.name = "ReleaseUnsignedLocalError";
  }
}

export function isUnsignedLocalTrust(state: ReleaseTrustStateV1): state is UnsignedLocalReleaseTrustStateV1 {
  return "trust" in state && state.trust === "unsigned-local";
}
export function isPackageChannelTrust(state: ReleaseTrustStateV1): state is PackageChannelReleaseTrustStateV1 {
  return "trust" in state && state.trust === "package-channel";
}
const textEncoder = new TextEncoder();
/** A signed bundle's bounds: entries, bytes per file, and aggregate file bytes (Spec 2 §3). */
export const MAXIMUM_BUNDLE_ENTRIES = 200_000;
export const MAXIMUM_BUNDLE_FILE_BYTES = 536_870_912;
export const MAXIMUM_BUNDLE_AGGREGATE_BYTES = 8_589_934_592;

function string(value: unknown, label: string): string { if (typeof value !== "string") fail(label); return value; }
function bytes(value: string): number { return textEncoder.encode(value).byteLength; }
function compareUInt64(left: UInt64DecimalV1, right: UInt64DecimalV1): number { return BigInt(left) === BigInt(right) ? 0 : BigInt(left) < BigInt(right) ? -1 : 1; }
function compareSemver(left: StableSemverV1, right: StableSemverV1): number {
  const a = left.split(".").map(Number); const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) { const delta = (a[index] as number) - (b[index] as number); if (delta !== 0) return delta; }
  return 0;
}
function assertCanonicalSize(value: unknown, maximumBytes: number, label: string): void {
  if (textEncoder.encode(encodeCanonicalJson(value as CanonicalJsonValue)).byteLength > maximumBytes) fail(label);
}
function parseBase64Url(value: unknown, label: string, length: number): Base64UrlNoPaddingV1 {
  const input = string(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(input)) fail(label);
  const decoded = Buffer.from(input, "base64url");
  if (decoded.byteLength !== length || decoded.toString("base64url") !== input) fail(label);
  return input as Base64UrlNoPaddingV1;
}
function publicKeyId(key: Base64UrlNoPaddingV1): LowerHexSha256 { return createHash("sha256").update(Buffer.from(key, "base64url")).digest("hex") as LowerHexSha256; }
function parseIpv4Number(value: string): bigint | null {
  if (value === "0x") return 0n;
  if (/^0x[0-9a-f]+$/.test(value)) return BigInt(value);
  if (/^0[0-7]+$/.test(value) && value.length > 1) return BigInt(`0o${value.slice(1)}`);
  if (/^(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return null;
}
function isIpv4Literal(value: string): boolean {
  const labels = value.split(".");
  if (labels.length < 1 || labels.length > 4) return false;
  const numbers = labels.map(parseIpv4Number);
  if (numbers.some((number) => number === null)) return false;
  const numeric = numbers as bigint[];
  if (numeric.slice(0, -1).some((number) => number > 255n)) return false;
  const finalMaximum = (1n << BigInt(8 * (5 - numeric.length))) - 1n;
  return (numeric[numeric.length - 1] as bigint) <= finalMaximum;
}

export function parseLowercaseAsciiDnsName(value: unknown): LowercaseAsciiDnsNameV1 {
  const input = string(value, "LowercaseAsciiDnsNameV1");
  if (bytes(input) < 1 || bytes(input) > 253 || input === "localhost" || input.includes("%") || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(input)) fail("LowercaseAsciiDnsNameV1");
  const labels = input.split(".");
  if (labels.length > 127 || input.startsWith("xn--") || labels.some((label) => label.startsWith("xn--") || label.length > 63 || label.startsWith("-") || label.endsWith("-")) || isIpv4Literal(input)) fail("LowercaseAsciiDnsNameV1");
  return input as LowercaseAsciiDnsNameV1;
}

function parseUrlSegments(value: unknown, label: string, prefix: boolean): string {
  const input = string(value, label);
  if (bytes(input) < 1 || bytes(input) > 2048 || /[?#\\]/.test(input) || (prefix && (!input.startsWith("/") || !input.endsWith("/"))) || (!prefix && (input.startsWith("/") || input.endsWith("/")))) fail(label);
  const source = prefix ? input.slice(1, -1) : input;
  const segments = source.split("/");
  if (segments.length < 1 || segments.length > 128 || segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || !/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/.test(segment))) fail(label);
  for (const segment of segments) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { fail(label); }
    if (decoded.length === 0 || decoded === "." || decoded === "..") fail(label);
    for (const character of decoded) { const point = character.codePointAt(0) as number; if (character === "/" || character === "\\" || point === 0 || point <= 0x1f || (point >= 0x7f && point <= 0x9f)) fail(label); }
  }
  return input;
}
export function parseOfficialReleasePathPrefix(value: unknown): OfficialReleasePathPrefixV1 { return parseUrlSegments(value, "OfficialReleasePathPrefixV1", true) as OfficialReleasePathPrefixV1; }
export function parseOfficialReleaseRelativePath(value: unknown): OfficialReleaseRelativePathV1 { return parseUrlSegments(value, "OfficialReleaseRelativePathV1", false) as OfficialReleaseRelativePathV1; }
export function validateOfficialReleaseOrigin(value: unknown): OfficialReleaseOriginV1 {
  const input = exact(value, ["scheme", "host", "port", "pathPrefix"], "OfficialReleaseOriginV1");
  if (input.scheme !== "https" || input.port !== 443) fail("OfficialReleaseOriginV1");
  return { scheme: "https", host: parseLowercaseAsciiDnsName(input.host), port: 443, pathPrefix: parseOfficialReleasePathPrefix(input.pathPrefix) };
}
export function validateFixedReleaseMetadataLocator(value: unknown): FixedReleaseMetadataLocatorV1 {
  const input = exact(value, ["origin", "repositoryPath", "assetName"], "FixedReleaseMetadataLocatorV1");
  if (input.origin !== "https://github.com" || input.repositoryPath !== "/msolecki/developer-os/releases/latest/download/" || (input.assetName !== "release-key-delegation-v1.json" && input.assetName !== "release-index-v1.json")) fail("FixedReleaseMetadataLocatorV1");
  return { origin: "https://github.com", repositoryPath: "/msolecki/developer-os/releases/latest/download/", assetName: input.assetName };
}

function validateSignature(value: unknown): Ed25519SignatureV1 {
  const input = exact(value, ["algorithm", "keyId", "signature"], "Ed25519SignatureV1");
  if (input.algorithm !== "ed25519") fail("Ed25519SignatureV1");
  return { algorithm: "ed25519", keyId: parseLowerHexSha256(input.keyId), signature: parseBase64Url(input.signature, "Ed25519SignatureV1.signature", 64) };
}
export function validateSignedReleaseDocument<TKind extends string, TSigned>(value: unknown, kind: TKind, validateSigned: (value: unknown) => TSigned): SignedReleaseDocumentV1<TKind, TSigned> {
  const input = exact(value, ["schemaVersion", "kind", "signed", "signatures"], "SignedReleaseDocumentV1");
  if (input.schemaVersion !== 1 || input.kind !== kind) fail("SignedReleaseDocumentV1");
  const signatures = list(input.signatures, 1, 1, "SignedReleaseDocumentV1.signatures");
  return { schemaVersion: 1, kind, signed: validateSigned(input.signed), signatures: [validateSignature(signatures[0])] };
}
export function signedReleaseDocumentSigningBytes(kind: string, signed: CanonicalJsonValue): Uint8Array {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) fail("signed document kind");
  const canonical = encodeCanonicalJson(signed);
  return textEncoder.encode(`developer-os/${kind}/v1\0${canonical.slice(0, -1)}`);
}

function validateRootKey(value: unknown): OfflineRootKeyV1 {
  const input = exact(value, ["role", "algorithm", "keyId", "publicKey"], "OfflineRootKeyV1");
  if ((input.role !== "online_current" && input.role !== "retained_offline_previous") || input.algorithm !== "ed25519") fail("OfflineRootKeyV1");
  const publicKey = parseBase64Url(input.publicKey, "OfflineRootKeyV1.publicKey", 32);
  const keyId = parseLowerHexSha256(input.keyId);
  if (publicKeyId(publicKey) !== keyId) fail("OfflineRootKeyV1.keyId");
  return { role: input.role, algorithm: "ed25519", keyId, publicKey };
}
export function validateOfflineReleaseTrust(value: unknown): OfflineReleaseTrustV1 {
  const input = exact(value, ["schemaVersion", "handoffProtocol", "onlineRootKeyId", "acceptedRoots", "delegationLocator", "indexLocator", "metadataRedirectOrigins"], "OfflineReleaseTrustV1");
  if (input.schemaVersion !== 1 || input.handoffProtocol !== 1) fail("OfflineReleaseTrustV1");
  const roots = list(input.acceptedRoots, 1, 2, "OfflineReleaseTrustV1.acceptedRoots").map(validateRootKey);
  if (roots[0]?.role !== "online_current" || roots.filter((root) => root.role === "online_current").length !== 1 || new Set(roots.map((root) => root.keyId)).size !== roots.length || (roots.length === 2 && roots[1]?.role !== "retained_offline_previous")) fail("OfflineReleaseTrustV1.acceptedRoots");
  const onlineRootKeyId = parseLowerHexSha256(input.onlineRootKeyId);
  if (roots[0].keyId !== onlineRootKeyId) fail("OfflineReleaseTrustV1.onlineRootKeyId");
  const delegationLocator = validateFixedReleaseMetadataLocator(input.delegationLocator); const indexLocator = validateFixedReleaseMetadataLocator(input.indexLocator);
  if (delegationLocator.assetName !== "release-key-delegation-v1.json" || indexLocator.assetName !== "release-index-v1.json") fail("OfflineReleaseTrustV1 locators");
  const metadataRedirectOrigins = list(input.metadataRedirectOrigins, 1, 4, "OfflineReleaseTrustV1.metadataRedirectOrigins").map(validateOfficialReleaseOrigin);
  const trusted = { schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId, acceptedRoots: roots, delegationLocator, indexLocator, metadataRedirectOrigins } as const;
  assertCanonicalSize(trusted, 65_536, "OfflineReleaseTrustV1 bytes");
  return trusted;
}

export function validateReleaseKeyDelegation(value: unknown): ReleaseKeyDelegationV1 {
  const input = exact(value, ["sequence", "releaseKey", "metadataOrigins", "assetOrigins"], "ReleaseKeyDelegationV1");
  const releaseKeyInput = exact(input.releaseKey, ["algorithm", "keyId", "publicKey"], "DelegatedReleaseKeyV1");
  if (releaseKeyInput.algorithm !== "ed25519") fail("DelegatedReleaseKeyV1");
  const publicKey = parseBase64Url(releaseKeyInput.publicKey, "DelegatedReleaseKeyV1.publicKey", 32); const keyId = parseLowerHexSha256(releaseKeyInput.keyId);
  if (publicKeyId(publicKey) !== keyId) fail("DelegatedReleaseKeyV1.keyId");
  const metadataOrigins = list(input.metadataOrigins, 1, 1, "ReleaseKeyDelegationV1.metadataOrigins").map(validateOfficialReleaseOrigin);
  const assetOrigins = list(input.assetOrigins, 1, 4, "ReleaseKeyDelegationV1.assetOrigins").map(validateOfficialReleaseOrigin);
  const serializedOrigins = new Set(assetOrigins.map((origin) => JSON.stringify(origin)));
  if (serializedOrigins.size !== assetOrigins.length) fail("ReleaseKeyDelegationV1.assetOrigins");
  const delegation = { sequence: parseUInt64Decimal(input.sequence), releaseKey: { algorithm: "ed25519" as const, keyId, publicKey }, metadataOrigins: [metadataOrigins[0] as OfficialReleaseOriginV1] as [OfficialReleaseOriginV1], assetOrigins };
  assertCanonicalSize(delegation, 65_536, "ReleaseKeyDelegationV1 bytes");
  return delegation;
}

function validateBundleReference<TArchitecture extends "arm64" | "x64">(value: unknown, architecture: TArchitecture): ReleaseBundleReferenceV1 & { readonly architecture: TArchitecture } {
  const input = exact(value, ["platform", "architecture", "archiveFormat", "archivePath", "archiveBytes", "archiveSha256", "manifestPath", "manifestBytes", "manifestSha256"], "ReleaseBundleReferenceV1");
  if (input.platform !== "darwin" || input.architecture !== architecture || input.archiveFormat !== "zstd-ustar-v1") fail("ReleaseBundleReferenceV1");
  const archivePath = parseOfficialReleaseRelativePath(input.archivePath); if (!archivePath.endsWith(".tar.zst")) fail("ReleaseBundleReferenceV1.archivePath");
  const archiveBytes = parseUInt64Decimal(input.archiveBytes); const manifestBytes = parseUInt64Decimal(input.manifestBytes);
  if (BigInt(archiveBytes) < 1n || BigInt(archiveBytes) > 2_147_483_648n || BigInt(manifestBytes) < 1n || BigInt(manifestBytes) > 16_777_216n) fail("ReleaseBundleReferenceV1 bytes");
  return { platform: "darwin", architecture, archiveFormat: "zstd-ustar-v1", archivePath, archiveBytes, archiveSha256: parseLowerHexSha256(input.archiveSha256), manifestPath: parseOfficialReleaseRelativePath(input.manifestPath), manifestBytes, manifestSha256: parseLowerHexSha256(input.manifestSha256) };
}
export function validateReleaseIndexEntry(value: unknown): ReleaseIndexEntryV1 {
  const input = exact(value, ["version", "releaseSequence", "minimumLauncherProtocol", "updateProtocol", "bundles"], "ReleaseIndexEntryV1");
  const bundles = list(input.bundles, 2, 2, "ReleaseIndexEntryV1.bundles");
  return { version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), minimumLauncherProtocol: parsePositiveUInt32(input.minimumLauncherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol), bundles: [validateBundleReference(bundles[0], "arm64"), validateBundleReference(bundles[1], "x64")] };
}
export function validateReleaseIndex(value: unknown): ReleaseIndexV1 {
  const input = exact(value, ["sequence", "latestVersion", "releases"], "ReleaseIndexV1");
  const releases = list(input.releases, 1, 10_000, "ReleaseIndexV1.releases").map(validateReleaseIndexEntry);
  for (let index = 1; index < releases.length; index += 1) {
    const previous = releases[index - 1] as ReleaseIndexEntryV1; const current = releases[index] as ReleaseIndexEntryV1;
    if (compareUInt64(previous.releaseSequence, current.releaseSequence) >= 0 || compareSemver(previous.version, current.version) >= 0) fail("ReleaseIndexV1 order");
  }
  const latestVersion = parseStableSemver(input.latestVersion); if (latestVersion !== releases[releases.length - 1]?.version) fail("ReleaseIndexV1.latestVersion");
  const index = { sequence: parseUInt64Decimal(input.sequence), latestVersion, releases };
  assertCanonicalSize(index, 4 * 1024 * 1024, "ReleaseIndexV1 bytes");
  return index;
}

export function releaseIdentityHash(entry: unknown, architecture: "arm64" | "x64"): LowerHexSha256 {
  const validated = validateReleaseIndexEntry(entry); const bundle = validated.bundles[architecture === "arm64" ? 0 : 1];
  const projection: CanonicalJsonValue = {
    version: validated.version,
    releaseSequence: validated.releaseSequence,
    minimumLauncherProtocol: validated.minimumLauncherProtocol,
    updateProtocol: validated.updateProtocol,
    bundle: {
      platform: bundle.platform,
      architecture: bundle.architecture,
      archiveFormat: bundle.archiveFormat,
      archivePath: bundle.archivePath,
      archiveBytes: bundle.archiveBytes,
      archiveSha256: bundle.archiveSha256,
      manifestPath: bundle.manifestPath,
      manifestBytes: bundle.manifestBytes,
      manifestSha256: bundle.manifestSha256,
    },
  };
  return hashCanonicalJsonNoLf("developer-os/release-identity/v1", projection);
}

function hasControlOrFormat(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) as number;
    if ((point >= 0 && point <= 0x1f) || (point >= 0x7f && point <= 0x9f) || /\p{Cf}/u.test(character)) return true;
  }
  return false;
}
export function parseBundleRelativePath(value: unknown): BundleRelativePathV1 {
  const input = string(value, "BundleRelativePathV1"); const total = bytes(input); const components = input.split("/");
  if (input.normalize("NFC") !== input || total < 1 || total > 255 || components.length < 1 || components.length > 32 || input.includes("\\") || input.startsWith("/") || components.some((part) => part.length === 0 || part === "." || part === ".." || bytes(part) > 100 || part.includes(":") || part.startsWith("-") || hasControlOrFormat(part))) fail("BundleRelativePathV1");
  const name = components[components.length - 1] as string; const prefix = components.slice(0, -1).join("/");
  if (bytes(name) > 100 || (prefix.length > 0 && bytes(prefix) > 155)) fail("BundleRelativePathV1");
  return input as BundleRelativePathV1;
}
function validateBundleEntry(value: unknown): ReleaseBundleEntryV1 {
  const input = record(value, "ReleaseBundleEntryV1");
  if (input.kind === "directory") { const directory = exact(input, ["path", "kind", "mode"], "ReleaseBundleEntryV1.directory"); if (directory.mode !== 448) fail("ReleaseBundleEntryV1.directory"); return { path: parseBundleRelativePath(directory.path), kind: "directory", mode: 448 }; }
  if (input.kind === "file") { const file = exact(input, ["path", "kind", "mode", "bytes", "sha256"], "ReleaseBundleEntryV1.file"); if (file.mode !== 384 && file.mode !== 448) fail("ReleaseBundleEntryV1.file"); const size = parseUInt64Decimal(file.bytes); if (BigInt(size) > BigInt(MAXIMUM_BUNDLE_FILE_BYTES)) fail("ReleaseBundleEntryV1.file bytes"); return { path: parseBundleRelativePath(file.path), kind: "file", mode: file.mode, bytes: size, sha256: parseLowerHexSha256(file.sha256) }; }
  fail("ReleaseBundleEntryV1.kind");
}
/** The one bundle-entry validator: sorted, unique (exact and folded), parent-before-child, bounded per file and in aggregate. */
export function validateBundleEntries(value: unknown, label = "ReleaseBundleManifestV1.entries"): readonly ReleaseBundleEntryV1[] {
  const entries = list(value, 1, MAXIMUM_BUNDLE_ENTRIES, label).map(validateBundleEntry); let total = 0n; const seen = new Set<string>(); const directories = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index] as ReleaseBundleEntryV1; const prior = entries[index - 1];
    if (seen.has(current.path) || seen.has(current.path.normalize("NFC").toLocaleLowerCase("en-US")) || (prior !== undefined && compareUtf8(prior.path, current.path) >= 0)) fail(`${label} order`);
    seen.add(current.path); seen.add(current.path.normalize("NFC").toLocaleLowerCase("en-US"));
    const parent = current.path.includes("/") ? current.path.slice(0, current.path.lastIndexOf("/")) : null;
    if (parent !== null && !directories.has(parent)) fail(`${label} parents`);
    if (current.kind === "directory") directories.add(current.path);
    if (current.kind === "file") { total += BigInt(current.bytes); if (total > BigInt(MAXIMUM_BUNDLE_AGGREGATE_BYTES)) fail(`${label} aggregate bytes`); }
  }
  return entries;
}
export function validateBundleManifest(value: unknown): ReleaseBundleManifestV1 {
  const input = exact(value, ["schemaVersion", "version", "releaseSequence", "platform", "architecture", "launcherProtocol", "updateProtocol", "entrypoint", "runtimeEntrypoint", "plannerEntrypoint", "verifierEntrypoint", "entries"], "ReleaseBundleManifestV1");
  if (input.schemaVersion !== 1 || input.platform !== "darwin" || (input.architecture !== "arm64" && input.architecture !== "x64")) fail("ReleaseBundleManifestV1");
  const architecture: "arm64" | "x64" = input.architecture === "arm64" ? "arm64" : "x64";
  const entries = validateBundleEntries(input.entries);
  const entrypoint = parseBundleRelativePath(input.entrypoint); const runtimeEntrypoint = parseBundleRelativePath(input.runtimeEntrypoint); const plannerEntrypoint = parseBundleRelativePath(input.plannerEntrypoint); const verifierEntrypoint = parseBundleRelativePath(input.verifierEntrypoint);
  for (const path of [entrypoint, runtimeEntrypoint, plannerEntrypoint, verifierEntrypoint]) if (!entries.some((entry) => entry.path === path && entry.kind === "file" && entry.mode === 448)) fail("ReleaseBundleManifestV1.entrypoint");
  const manifest = { schemaVersion: 1 as const, version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), platform: "darwin" as const, architecture, launcherProtocol: parsePositiveUInt32(input.launcherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol), entrypoint, runtimeEntrypoint, plannerEntrypoint, verifierEntrypoint, entries };
  assertCanonicalSize(manifest, 16 * 1024 * 1024, "ReleaseBundleManifestV1 bytes");
  return manifest;
}

function validateIdentity(value: unknown, evidence: CanonicalPathEvidenceV1): ReleaseIdentityV1 {
  const input = exact(value, ["version", "releaseSequence", "releaseIdentityHash", "delegationSequence", "delegationHash", "releaseIndexSequence", "releaseIndexHash", "bundleManifestHash", "bundleRoot", "platform", "architecture", "launcherProtocol", "updateProtocol"], "ReleaseIdentityV1");
  if (input.platform !== "darwin" || (input.architecture !== "arm64" && input.architecture !== "x64")) fail("ReleaseIdentityV1");
  const bundleRoot = admitCanonicalAbsolutePath(string(input.bundleRoot, "ReleaseIdentityV1.bundleRoot"), evidence);
  return { version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), releaseIdentityHash: parseLowerHexSha256(input.releaseIdentityHash), delegationSequence: parseUInt64Decimal(input.delegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), releaseIndexSequence: parseUInt64Decimal(input.releaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash), bundleManifestHash: parseLowerHexSha256(input.bundleManifestHash), bundleRoot, platform: "darwin", architecture: input.architecture, launcherProtocol: parsePositiveUInt32(input.launcherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol) };
}
export function validateReleaseIdentity(value: unknown, evidence: CanonicalPathEvidenceV1): ReleaseIdentityV1 { return validateIdentity(value, evidence); }
export function admitReleaseIdentity(value: unknown, evidence: CanonicalPathEvidenceV1, context: ReleaseIdentityAdmissionContextV1): ReleaseIdentityV1 {
  const identity = validateIdentity(value, evidence);
  const selected = context.selected;
  const entry = validateReleaseIndexEntry(selected.entry);
  const architecture = selected.bundle.architecture;
  const expectedBundle = entry.bundles[architecture === "arm64" ? 0 : 1];
  const selectedBundle = validateBundleReference(selected.bundle, architecture);
  const manifest = validateBundleManifest(context.bundleManifest);
  const metadata = validateReleaseMetadataIdentity(context.metadata);
  const productHome = admitCanonicalAbsolutePath(context.productHome, evidence);
  const expectedRoot = `${productHome}/releases/${entry.version}/darwin-${architecture}`;
  if (identity.bundleRoot !== expectedRoot || identity.version !== entry.version || identity.releaseSequence !== entry.releaseSequence || identity.releaseIdentityHash !== releaseIdentityHash(entry, architecture) || selected.releaseIdentityHash !== identity.releaseIdentityHash || selectedBundle.archivePath !== expectedBundle.archivePath || selectedBundle.archiveBytes !== expectedBundle.archiveBytes || selectedBundle.archiveSha256 !== expectedBundle.archiveSha256 || selectedBundle.manifestPath !== expectedBundle.manifestPath || selectedBundle.manifestBytes !== expectedBundle.manifestBytes || selectedBundle.manifestSha256 !== expectedBundle.manifestSha256 || identity.delegationSequence !== metadata.delegationSequence || identity.delegationHash !== metadata.delegationHash || identity.releaseIndexSequence !== metadata.releaseIndexSequence || identity.releaseIndexHash !== metadata.releaseIndexHash || identity.bundleManifestHash !== context.bundleManifestHash || context.bundleManifestHash !== expectedBundle.manifestSha256 || manifest.version !== entry.version || manifest.releaseSequence !== entry.releaseSequence || manifest.architecture !== architecture || identity.architecture !== architecture || identity.launcherProtocol !== manifest.launcherProtocol || identity.updateProtocol !== entry.updateProtocol || manifest.updateProtocol !== entry.updateProtocol) fail("ReleaseIdentityV1 context");
  return { ...identity };
}
export function validateActiveReleaseRecord(value: unknown, evidence: CanonicalPathEvidenceV1): ActiveReleaseRecordV1 {
  const input = exact(value, ["schemaVersion", "version", "releaseSequence", "releaseIdentityHash", "delegationSequence", "delegationHash", "releaseIndexSequence", "releaseIndexHash", "bundleManifestHash", "bundleRoot", "platform", "architecture", "launcherProtocol", "updateProtocol", "activatedAt"], "ActiveReleaseRecordV1");
  if (input.schemaVersion !== 1) fail("ActiveReleaseRecordV1"); const identity = validateIdentity(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "schemaVersion" && key !== "activatedAt")), evidence);
  const active = { schemaVersion: 1 as const, ...identity, activatedAt: parseUtcTimestamp(input.activatedAt) };
  assertCanonicalSize(active, 16 * 1024, "ActiveReleaseRecordV1 bytes");
  return active;
}
const signedTrustKeys = ["schemaVersion", "highestDelegationSequence", "delegationHash", "delegatedReleaseKeyId", "highestReleaseIndexSequence", "releaseIndexHash", "highestAcceptedReleaseSequence", "releaseIdentityHash"] as const;
export function validateReleaseTrustState(value: unknown): ReleaseTrustStateV1 {
  const hasTrust = Object.hasOwn(record(value, "ReleaseTrustStateV1"), "trust");
  const input = exact(value, hasTrust ? [...signedTrustKeys, "trust"] : signedTrustKeys, "ReleaseTrustStateV1");
  if (input.schemaVersion !== 1 || (hasTrust && input.trust !== "unsigned-local" && input.trust !== "package-channel")) fail("ReleaseTrustStateV1");
  const signed = { schemaVersion: 1 as const, highestDelegationSequence: parseUInt64Decimal(input.highestDelegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), delegatedReleaseKeyId: parseLowerHexSha256(input.delegatedReleaseKeyId), highestReleaseIndexSequence: parseUInt64Decimal(input.highestReleaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash), highestAcceptedReleaseSequence: parseUInt64Decimal(input.highestAcceptedReleaseSequence), releaseIdentityHash: parseLowerHexSha256(input.releaseIdentityHash) };
  const trust: ReleaseTrustStateV1 = hasTrust ? { ...signed, trust: input.trust as "unsigned-local" | "package-channel" } : signed;
  assertCanonicalSize(trust, 16 * 1024, "ReleaseTrustStateV1 bytes");
  return trust;
}
export function validateReleaseMetadataIdentity(value: unknown): ReleaseMetadataIdentityV1 {
  const input = exact(value, ["delegationSequence", "delegationHash", "delegatedReleaseKeyId", "releaseIndexSequence", "releaseIndexHash"], "ReleaseMetadataIdentityV1");
  return { delegationSequence: parseUInt64Decimal(input.delegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), delegatedReleaseKeyId: parseLowerHexSha256(input.delegatedReleaseKeyId), releaseIndexSequence: parseUInt64Decimal(input.releaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash) };
}
function advance(sequence: UInt64DecimalV1, oldHash: LowerHexSha256, nextSequence: UInt64DecimalV1, nextHash: LowerHexSha256, label: string): [UInt64DecimalV1, LowerHexSha256] {
  const comparison = compareUInt64(nextSequence, sequence); if (comparison < 0 || (comparison === 0 && nextHash !== oldHash)) fail(`ReleaseTrustStateV1 ${label} replay`); return comparison === 0 ? [sequence, oldHash] : [nextSequence, nextHash];
}
export function advanceReleaseTrust(current: ReleaseTrustStateV1, accepted: ReleaseMetadataIdentityV1 & Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">): ReleaseTrustStateV1 {
  const trust = validateReleaseTrustState(current);
  if (isUnsignedLocalTrust(trust)) throw new ReleaseUnsignedLocalError();
  const acceptedInput = exact(accepted, ["delegationSequence", "delegationHash", "delegatedReleaseKeyId", "releaseIndexSequence", "releaseIndexHash", "releaseSequence", "releaseIdentityHash"], "accepted release observation");
  const metadata = validateReleaseMetadataIdentity({
    delegationSequence: acceptedInput.delegationSequence,
    delegationHash: acceptedInput.delegationHash,
    delegatedReleaseKeyId: acceptedInput.delegatedReleaseKeyId,
    releaseIndexSequence: acceptedInput.releaseIndexSequence,
    releaseIndexHash: acceptedInput.releaseIndexHash,
  });
  const releaseSequence = parseUInt64Decimal(acceptedInput.releaseSequence); const releaseIdentityHash = parseLowerHexSha256(acceptedInput.releaseIdentityHash);
  const [highestDelegationSequence, delegationHash] = advance(trust.highestDelegationSequence, trust.delegationHash, metadata.delegationSequence, metadata.delegationHash, "delegation");
  if (compareUInt64(metadata.delegationSequence, trust.highestDelegationSequence) === 0 && metadata.delegatedReleaseKeyId !== trust.delegatedReleaseKeyId) fail("ReleaseTrustStateV1 delegation key replay");
  const [highestReleaseIndexSequence, releaseIndexHash] = advance(trust.highestReleaseIndexSequence, trust.releaseIndexHash, metadata.releaseIndexSequence, metadata.releaseIndexHash, "index");
  const [highestAcceptedReleaseSequence, nextReleaseIdentityHash] = advance(trust.highestAcceptedReleaseSequence, trust.releaseIdentityHash, releaseSequence, releaseIdentityHash, "release");
  const advanced = { schemaVersion: 1 as const, highestDelegationSequence, delegationHash, delegatedReleaseKeyId: metadata.delegatedReleaseKeyId, highestReleaseIndexSequence, releaseIndexHash, highestAcceptedReleaseSequence, releaseIdentityHash: nextReleaseIdentityHash };
  return isPackageChannelTrust(trust) ? { ...advanced, trust: "package-channel" } : advanced;
}
export function admitReleaseAgainstTrust(trust: ReleaseTrustStateV1, release: Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">, role: "online_target" | "guarded_active" | "guarded_retained_rollback"): void {
  const state = validateReleaseTrustState(trust);
  if (isUnsignedLocalTrust(state) && role !== "guarded_active") throw new ReleaseUnsignedLocalError();
  const sequence = parseUInt64Decimal(release.releaseSequence); const hash = parseLowerHexSha256(release.releaseIdentityHash); const comparison = compareUInt64(sequence, state.highestAcceptedReleaseSequence);
  if (comparison === 0 && hash !== state.releaseIdentityHash) fail("ReleaseTrustStateV1 release replay");
  if (comparison < 0 && role === "online_target") fail("ReleaseTrustStateV1 online downgrade");
  if (comparison > 0 && role !== "online_target") fail("ReleaseTrustStateV1 guarded advance");
}

export function selectRelease(index: ReleaseIndexV1, request: { readonly version: StableSemverV1 | null; readonly active: ReleaseIdentityV1 }): { readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 } | { readonly outcome: "selected"; readonly selected: SelectedReleaseV1 } {
  const trustedIndex = validateReleaseIndex(index); const desired = request.version === null ? trustedIndex.latestVersion : parseStableSemver(request.version); const active = request.active;
  const selected = trustedIndex.releases.find((entry) => entry.version === desired); if (selected === undefined) fail("requested release");
  const comparison = compareSemver(selected.version, active.version); if (comparison < 0) fail("release downgrade");
  const bundle = selected.bundles[active.architecture === "arm64" ? 0 : 1];
  const identityHash = releaseIdentityHash(selected, active.architecture);
  if (comparison === 0) { if (selected.releaseSequence !== active.releaseSequence || identityHash !== active.releaseIdentityHash) fail("active release identity rebound"); return { outcome: "up_to_date", active: { ...active } }; }
  return { outcome: "selected", selected: { entry: { ...selected, bundles: [{ ...selected.bundles[0] }, { ...selected.bundles[1] }] }, bundle: { ...bundle }, releaseIdentityHash: identityHash } };
}
