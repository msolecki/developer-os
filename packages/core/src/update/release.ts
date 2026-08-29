import { createHash } from "node:crypto";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { CanonicalAbsolutePathV1, CanonicalPathEvidenceV1 } from "./paths.js";
import {
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

export interface ReleaseTrustStateV1 {
  readonly schemaVersion: 1;
  readonly highestDelegationSequence: UInt64DecimalV1;
  readonly delegationHash: LowerHexSha256;
  readonly delegatedReleaseKeyId: LowerHexSha256;
  readonly highestReleaseIndexSequence: UInt64DecimalV1;
  readonly releaseIndexHash: LowerHexSha256;
  readonly highestAcceptedReleaseSequence: UInt64DecimalV1;
  readonly releaseIdentityHash: LowerHexSha256;
}

type UnknownRecord = Record<string, unknown>;
const textEncoder = new TextEncoder();
const maximumBundleFileBytes = 536_870_912n;
const maximumBundleBytes = 8_589_934_592n;

function invalid(label: string): never { throw new Error(`invalid ${label}`); }
function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(label);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) invalid(label);
  return value as UnknownRecord;
}
function exact(value: unknown, label: string, keys: readonly string[]): UnknownRecord {
  const input = record(value, label);
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(`${label}: keys`);
  return input;
}
function array(value: unknown, label: string, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(label);
  return value;
}
function string(value: unknown, label: string): string { if (typeof value !== "string") invalid(label); return value; }
function bytes(value: string): number { return textEncoder.encode(value).byteLength; }
function compareUtf8(left: string, right: string): number {
  const a = textEncoder.encode(left); const b = textEncoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) { const difference = (a[index] as number) - (b[index] as number); if (difference !== 0) return difference; }
  return a.length - b.length;
}
function compareUInt64(left: UInt64DecimalV1, right: UInt64DecimalV1): number { return BigInt(left) === BigInt(right) ? 0 : BigInt(left) < BigInt(right) ? -1 : 1; }
function compareSemver(left: StableSemverV1, right: StableSemverV1): number {
  const a = left.split(".").map(Number); const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) { const delta = (a[index] as number) - (b[index] as number); if (delta !== 0) return delta; }
  return 0;
}
function assertCanonicalSize(value: unknown, maximumBytes: number, label: string): void {
  if (textEncoder.encode(encodeCanonicalJson(value as CanonicalJsonValue)).byteLength > maximumBytes) invalid(label);
}
function parseBase64Url(value: unknown, label: string, length: number): Base64UrlNoPaddingV1 {
  const input = string(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(input)) invalid(label);
  const decoded = Buffer.from(input, "base64url");
  if (decoded.byteLength !== length || decoded.toString("base64url") !== input) invalid(label);
  return input as Base64UrlNoPaddingV1;
}
function publicKeyId(key: Base64UrlNoPaddingV1): LowerHexSha256 { return createHash("sha256").update(Buffer.from(key, "base64url")).digest("hex") as LowerHexSha256; }

export function parseLowercaseAsciiDnsName(value: unknown): LowercaseAsciiDnsNameV1 {
  const input = string(value, "LowercaseAsciiDnsNameV1");
  if (bytes(input) < 1 || bytes(input) > 253 || input === "localhost" || input.includes("%") || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(input)) invalid("LowercaseAsciiDnsNameV1");
  const labels = input.split(".");
  if (labels.length > 127 || labels.every((label) => /^[0-9]+$/.test(label)) || labels.some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))) invalid("LowercaseAsciiDnsNameV1");
  return input as LowercaseAsciiDnsNameV1;
}

function parseUrlSegments(value: unknown, label: string, prefix: boolean): string {
  const input = string(value, label);
  if (bytes(input) < 1 || bytes(input) > 2048 || /[?#\\]/.test(input) || (prefix && (!input.startsWith("/") || !input.endsWith("/"))) || (!prefix && (input.startsWith("/") || input.endsWith("/")))) invalid(label);
  const source = prefix ? input.slice(1, -1) : input;
  const segments = source.split("/");
  if (segments.length < 1 || segments.length > 128 || segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || !/^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/.test(segment))) invalid(label);
  for (const segment of segments) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { invalid(label); }
    if (decoded.length === 0 || decoded === "." || decoded === "..") invalid(label);
    for (const character of decoded) { const point = character.codePointAt(0) as number; if (character === "/" || character === "\\" || point === 0 || point <= 0x1f || (point >= 0x7f && point <= 0x9f)) invalid(label); }
  }
  return input;
}
export function parseOfficialReleasePathPrefix(value: unknown): OfficialReleasePathPrefixV1 { return parseUrlSegments(value, "OfficialReleasePathPrefixV1", true) as OfficialReleasePathPrefixV1; }
export function parseOfficialReleaseRelativePath(value: unknown): OfficialReleaseRelativePathV1 { return parseUrlSegments(value, "OfficialReleaseRelativePathV1", false) as OfficialReleaseRelativePathV1; }
export function validateOfficialReleaseOrigin(value: unknown): OfficialReleaseOriginV1 {
  const input = exact(value, "OfficialReleaseOriginV1", ["scheme", "host", "port", "pathPrefix"]);
  if (input.scheme !== "https" || input.port !== 443) invalid("OfficialReleaseOriginV1");
  return { scheme: "https", host: parseLowercaseAsciiDnsName(input.host), port: 443, pathPrefix: parseOfficialReleasePathPrefix(input.pathPrefix) };
}
export function validateFixedReleaseMetadataLocator(value: unknown): FixedReleaseMetadataLocatorV1 {
  const input = exact(value, "FixedReleaseMetadataLocatorV1", ["origin", "repositoryPath", "assetName"]);
  if (input.origin !== "https://github.com" || input.repositoryPath !== "/msolecki/developer-os/releases/latest/download/" || (input.assetName !== "release-key-delegation-v1.json" && input.assetName !== "release-index-v1.json")) invalid("FixedReleaseMetadataLocatorV1");
  return input as unknown as FixedReleaseMetadataLocatorV1;
}

function validateSignature(value: unknown): Ed25519SignatureV1 {
  const input = exact(value, "Ed25519SignatureV1", ["algorithm", "keyId", "signature"]);
  if (input.algorithm !== "ed25519") invalid("Ed25519SignatureV1");
  return { algorithm: "ed25519", keyId: parseLowerHexSha256(input.keyId), signature: parseBase64Url(input.signature, "Ed25519SignatureV1.signature", 64) };
}
export function validateSignedReleaseDocument<TKind extends string, TSigned>(value: unknown, kind: TKind, validateSigned: (value: unknown) => TSigned): SignedReleaseDocumentV1<TKind, TSigned> {
  const input = exact(value, "SignedReleaseDocumentV1", ["schemaVersion", "kind", "signed", "signatures"]);
  if (input.schemaVersion !== 1 || input.kind !== kind) invalid("SignedReleaseDocumentV1");
  const signatures = array(input.signatures, "SignedReleaseDocumentV1.signatures", 1, 1);
  return { schemaVersion: 1, kind, signed: validateSigned(input.signed), signatures: [validateSignature(signatures[0])] };
}
export function signedReleaseDocumentSigningBytes(kind: string, signed: CanonicalJsonValue): Uint8Array {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) invalid("signed document kind");
  const canonical = encodeCanonicalJson(signed);
  return textEncoder.encode(`developer-os/${kind}/v1\0${canonical.slice(0, -1)}`);
}

function validateRootKey(value: unknown): OfflineRootKeyV1 {
  const input = exact(value, "OfflineRootKeyV1", ["role", "algorithm", "keyId", "publicKey"]);
  if ((input.role !== "online_current" && input.role !== "retained_offline_previous") || input.algorithm !== "ed25519") invalid("OfflineRootKeyV1");
  const publicKey = parseBase64Url(input.publicKey, "OfflineRootKeyV1.publicKey", 32);
  const keyId = parseLowerHexSha256(input.keyId);
  if (publicKeyId(publicKey) !== keyId) invalid("OfflineRootKeyV1.keyId");
  return { role: input.role, algorithm: "ed25519", keyId, publicKey };
}
export function validateOfflineReleaseTrust(value: unknown): OfflineReleaseTrustV1 {
  const input = exact(value, "OfflineReleaseTrustV1", ["schemaVersion", "handoffProtocol", "onlineRootKeyId", "acceptedRoots", "delegationLocator", "indexLocator", "metadataRedirectOrigins"]);
  if (input.schemaVersion !== 1 || input.handoffProtocol !== 1) invalid("OfflineReleaseTrustV1");
  const roots = array(input.acceptedRoots, "OfflineReleaseTrustV1.acceptedRoots", 1, 2).map(validateRootKey);
  if (roots[0]?.role !== "online_current" || roots.filter((root) => root.role === "online_current").length !== 1 || new Set(roots.map((root) => root.keyId)).size !== roots.length || (roots.length === 2 && roots[1]?.role !== "retained_offline_previous")) invalid("OfflineReleaseTrustV1.acceptedRoots");
  const onlineRootKeyId = parseLowerHexSha256(input.onlineRootKeyId);
  if (roots[0].keyId !== onlineRootKeyId) invalid("OfflineReleaseTrustV1.onlineRootKeyId");
  const delegationLocator = validateFixedReleaseMetadataLocator(input.delegationLocator); const indexLocator = validateFixedReleaseMetadataLocator(input.indexLocator);
  if (delegationLocator.assetName !== "release-key-delegation-v1.json" || indexLocator.assetName !== "release-index-v1.json") invalid("OfflineReleaseTrustV1 locators");
  const metadataRedirectOrigins = array(input.metadataRedirectOrigins, "OfflineReleaseTrustV1.metadataRedirectOrigins", 1, 4).map(validateOfficialReleaseOrigin);
  const trusted = { schemaVersion: 1, handoffProtocol: 1, onlineRootKeyId, acceptedRoots: roots, delegationLocator, indexLocator, metadataRedirectOrigins } as const;
  assertCanonicalSize(trusted, 65_536, "OfflineReleaseTrustV1 bytes");
  return trusted;
}

export function validateReleaseKeyDelegation(value: unknown): ReleaseKeyDelegationV1 {
  const input = exact(value, "ReleaseKeyDelegationV1", ["sequence", "releaseKey", "metadataOrigins", "assetOrigins"]);
  const releaseKeyInput = exact(input.releaseKey, "DelegatedReleaseKeyV1", ["algorithm", "keyId", "publicKey"]);
  if (releaseKeyInput.algorithm !== "ed25519") invalid("DelegatedReleaseKeyV1");
  const publicKey = parseBase64Url(releaseKeyInput.publicKey, "DelegatedReleaseKeyV1.publicKey", 32); const keyId = parseLowerHexSha256(releaseKeyInput.keyId);
  if (publicKeyId(publicKey) !== keyId) invalid("DelegatedReleaseKeyV1.keyId");
  const metadataOrigins = array(input.metadataOrigins, "ReleaseKeyDelegationV1.metadataOrigins", 1, 1).map(validateOfficialReleaseOrigin);
  const assetOrigins = array(input.assetOrigins, "ReleaseKeyDelegationV1.assetOrigins", 1, 4).map(validateOfficialReleaseOrigin);
  const serializedOrigins = new Set(assetOrigins.map((origin) => JSON.stringify(origin)));
  if (serializedOrigins.size !== assetOrigins.length) invalid("ReleaseKeyDelegationV1.assetOrigins");
  const delegation = { sequence: parseUInt64Decimal(input.sequence), releaseKey: { algorithm: "ed25519" as const, keyId, publicKey }, metadataOrigins: [metadataOrigins[0] as OfficialReleaseOriginV1] as [OfficialReleaseOriginV1], assetOrigins };
  assertCanonicalSize(delegation, 65_536, "ReleaseKeyDelegationV1 bytes");
  return delegation;
}

function validateBundleReference<TArchitecture extends "arm64" | "x64">(value: unknown, architecture: TArchitecture): ReleaseBundleReferenceV1 & { readonly architecture: TArchitecture } {
  const input = exact(value, "ReleaseBundleReferenceV1", ["platform", "architecture", "archiveFormat", "archivePath", "archiveBytes", "archiveSha256", "manifestPath", "manifestBytes", "manifestSha256"]);
  if (input.platform !== "darwin" || input.architecture !== architecture || input.archiveFormat !== "zstd-ustar-v1") invalid("ReleaseBundleReferenceV1");
  const archivePath = parseOfficialReleaseRelativePath(input.archivePath); if (!archivePath.endsWith(".tar.zst")) invalid("ReleaseBundleReferenceV1.archivePath");
  return { platform: "darwin", architecture, archiveFormat: "zstd-ustar-v1", archivePath, archiveBytes: parseUInt64Decimal(input.archiveBytes), archiveSha256: parseLowerHexSha256(input.archiveSha256), manifestPath: parseOfficialReleaseRelativePath(input.manifestPath), manifestBytes: parseUInt64Decimal(input.manifestBytes), manifestSha256: parseLowerHexSha256(input.manifestSha256) };
}
function validateReleaseIndexEntry(value: unknown): ReleaseIndexEntryV1 {
  const input = exact(value, "ReleaseIndexEntryV1", ["version", "releaseSequence", "minimumLauncherProtocol", "updateProtocol", "bundles"]);
  const bundles = array(input.bundles, "ReleaseIndexEntryV1.bundles", 2, 2);
  return { version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), minimumLauncherProtocol: parsePositiveUInt32(input.minimumLauncherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol), bundles: [validateBundleReference(bundles[0], "arm64"), validateBundleReference(bundles[1], "x64")] };
}
export function validateReleaseIndex(value: unknown): ReleaseIndexV1 {
  const input = exact(value, "ReleaseIndexV1", ["sequence", "latestVersion", "releases"]);
  const releases = array(input.releases, "ReleaseIndexV1.releases", 1, 10_000).map(validateReleaseIndexEntry);
  for (let index = 1; index < releases.length; index += 1) {
    const previous = releases[index - 1] as ReleaseIndexEntryV1; const current = releases[index] as ReleaseIndexEntryV1;
    if (compareUInt64(previous.releaseSequence, current.releaseSequence) >= 0 || compareSemver(previous.version, current.version) >= 0) invalid("ReleaseIndexV1 order");
  }
  const latestVersion = parseStableSemver(input.latestVersion); if (latestVersion !== releases[releases.length - 1]?.version) invalid("ReleaseIndexV1.latestVersion");
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
  const canonical = encodeCanonicalJson(projection);
  return createHash("sha256").update("developer-os/release-identity/v1\0", "ascii").update(canonical.slice(0, -1), "utf8").digest("hex") as LowerHexSha256;
}

function hasControlOrFormat(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) as number;
    if ((point >= 0 && point <= 0x1f) || (point >= 0x7f && point <= 0x9f) || /\p{Cf}/u.test(character)) return true;
  }
  return false;
}
function parseBundleRelativePath(value: unknown): BundleRelativePathV1 {
  const input = string(value, "BundleRelativePathV1"); const total = bytes(input); const components = input.split("/");
  if (input.normalize("NFC") !== input || total < 1 || total > 255 || components.length < 1 || components.length > 32 || input.includes("\\") || input.startsWith("/") || components.some((part) => part.length === 0 || part === "." || part === ".." || bytes(part) > 100 || part.includes(":") || part.startsWith("-") || hasControlOrFormat(part))) invalid("BundleRelativePathV1");
  const name = components[components.length - 1] as string; const prefix = components.slice(0, -1).join("/");
  if (bytes(name) > 100 || (prefix.length > 0 && bytes(prefix) > 155)) invalid("BundleRelativePathV1");
  return input as BundleRelativePathV1;
}
function validateBundleEntry(value: unknown): ReleaseBundleEntryV1 {
  const input = record(value, "ReleaseBundleEntryV1");
  if (input.kind === "directory") { const directory = exact(input, "ReleaseBundleEntryV1.directory", ["path", "kind", "mode"]); if (directory.mode !== 448) invalid("ReleaseBundleEntryV1.directory"); return { path: parseBundleRelativePath(directory.path), kind: "directory", mode: 448 }; }
  if (input.kind === "file") { const file = exact(input, "ReleaseBundleEntryV1.file", ["path", "kind", "mode", "bytes", "sha256"]); if (file.mode !== 384 && file.mode !== 448) invalid("ReleaseBundleEntryV1.file"); const size = parseUInt64Decimal(file.bytes); if (BigInt(size) > maximumBundleFileBytes) invalid("ReleaseBundleEntryV1.file bytes"); return { path: parseBundleRelativePath(file.path), kind: "file", mode: file.mode, bytes: size, sha256: parseLowerHexSha256(file.sha256) }; }
  invalid("ReleaseBundleEntryV1.kind");
}
export function validateBundleManifest(value: unknown): ReleaseBundleManifestV1 {
  const input = exact(value, "ReleaseBundleManifestV1", ["schemaVersion", "version", "releaseSequence", "platform", "architecture", "launcherProtocol", "updateProtocol", "entrypoint", "runtimeEntrypoint", "plannerEntrypoint", "verifierEntrypoint", "entries"]);
  if (input.schemaVersion !== 1 || input.platform !== "darwin" || (input.architecture !== "arm64" && input.architecture !== "x64")) invalid("ReleaseBundleManifestV1");
  const architecture: "arm64" | "x64" = input.architecture === "arm64" ? "arm64" : "x64";
  const entries = array(input.entries, "ReleaseBundleManifestV1.entries", 1, 200_000).map(validateBundleEntry); let total = 0n; const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index] as ReleaseBundleEntryV1; const prior = entries[index - 1];
    if (seen.has(current.path) || seen.has(current.path.normalize("NFC").toLocaleLowerCase("en-US")) || (prior !== undefined && compareUtf8(prior.path, current.path) >= 0)) invalid("ReleaseBundleManifestV1.entries order");
    seen.add(current.path); seen.add(current.path.normalize("NFC").toLocaleLowerCase("en-US"));
    const parent = current.path.includes("/") ? current.path.slice(0, current.path.lastIndexOf("/")) : null;
    if (parent !== null && !entries.slice(0, index).some((entry) => entry.path === parent && entry.kind === "directory")) invalid("ReleaseBundleManifestV1.entries parents");
    if (current.kind === "file") { total += BigInt(current.bytes); if (total > maximumBundleBytes) invalid("ReleaseBundleManifestV1 aggregate bytes"); }
  }
  const entrypoint = parseBundleRelativePath(input.entrypoint); const runtimeEntrypoint = parseBundleRelativePath(input.runtimeEntrypoint); const plannerEntrypoint = parseBundleRelativePath(input.plannerEntrypoint); const verifierEntrypoint = parseBundleRelativePath(input.verifierEntrypoint);
  for (const path of [entrypoint, runtimeEntrypoint, plannerEntrypoint, verifierEntrypoint]) if (!entries.some((entry) => entry.path === path && entry.kind === "file" && entry.mode === 448)) invalid("ReleaseBundleManifestV1.entrypoint");
  const manifest = { schemaVersion: 1 as const, version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), platform: "darwin" as const, architecture, launcherProtocol: parsePositiveUInt32(input.launcherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol), entrypoint, runtimeEntrypoint, plannerEntrypoint, verifierEntrypoint, entries };
  assertCanonicalSize(manifest, 16 * 1024 * 1024, "ReleaseBundleManifestV1 bytes");
  return manifest;
}

function validateIdentity(value: unknown, evidence: CanonicalPathEvidenceV1): ReleaseIdentityV1 {
  const input = exact(value, "ReleaseIdentityV1", ["version", "releaseSequence", "releaseIdentityHash", "delegationSequence", "delegationHash", "releaseIndexSequence", "releaseIndexHash", "bundleManifestHash", "bundleRoot", "platform", "architecture", "launcherProtocol", "updateProtocol"]);
  if (input.platform !== "darwin" || (input.architecture !== "arm64" && input.architecture !== "x64")) invalid("ReleaseIdentityV1");
  const bundleRoot = string(input.bundleRoot, "ReleaseIdentityV1.bundleRoot");
  if (evidence.reopenCanonicalAbsolutePath(bundleRoot) !== bundleRoot) invalid("ReleaseIdentityV1.bundleRoot");
  return { version: parseStableSemver(input.version), releaseSequence: parseUInt64Decimal(input.releaseSequence), releaseIdentityHash: parseLowerHexSha256(input.releaseIdentityHash), delegationSequence: parseUInt64Decimal(input.delegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), releaseIndexSequence: parseUInt64Decimal(input.releaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash), bundleManifestHash: parseLowerHexSha256(input.bundleManifestHash), bundleRoot: bundleRoot as CanonicalAbsolutePathV1, platform: "darwin", architecture: input.architecture, launcherProtocol: parsePositiveUInt32(input.launcherProtocol), updateProtocol: parsePositiveUInt32(input.updateProtocol) };
}
export function validateReleaseIdentity(value: unknown, evidence: CanonicalPathEvidenceV1): ReleaseIdentityV1 { return validateIdentity(value, evidence); }
export function validateActiveReleaseRecord(value: unknown, evidence: CanonicalPathEvidenceV1): ActiveReleaseRecordV1 {
  const input = exact(value, "ActiveReleaseRecordV1", ["schemaVersion", "version", "releaseSequence", "releaseIdentityHash", "delegationSequence", "delegationHash", "releaseIndexSequence", "releaseIndexHash", "bundleManifestHash", "bundleRoot", "platform", "architecture", "launcherProtocol", "updateProtocol", "activatedAt"]);
  if (input.schemaVersion !== 1) invalid("ActiveReleaseRecordV1"); const identity = validateIdentity(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "schemaVersion" && key !== "activatedAt")), evidence);
  const active = { schemaVersion: 1 as const, ...identity, activatedAt: parseUtcTimestamp(input.activatedAt) };
  assertCanonicalSize(active, 16 * 1024, "ActiveReleaseRecordV1 bytes");
  return active;
}
export function validateReleaseTrustState(value: unknown): ReleaseTrustStateV1 {
  const input = exact(value, "ReleaseTrustStateV1", ["schemaVersion", "highestDelegationSequence", "delegationHash", "delegatedReleaseKeyId", "highestReleaseIndexSequence", "releaseIndexHash", "highestAcceptedReleaseSequence", "releaseIdentityHash"]);
  if (input.schemaVersion !== 1) invalid("ReleaseTrustStateV1");
  const trust = { schemaVersion: 1 as const, highestDelegationSequence: parseUInt64Decimal(input.highestDelegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), delegatedReleaseKeyId: parseLowerHexSha256(input.delegatedReleaseKeyId), highestReleaseIndexSequence: parseUInt64Decimal(input.highestReleaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash), highestAcceptedReleaseSequence: parseUInt64Decimal(input.highestAcceptedReleaseSequence), releaseIdentityHash: parseLowerHexSha256(input.releaseIdentityHash) };
  assertCanonicalSize(trust, 16 * 1024, "ReleaseTrustStateV1 bytes");
  return trust;
}
export function validateReleaseMetadataIdentity(value: unknown): ReleaseMetadataIdentityV1 {
  const input = exact(value, "ReleaseMetadataIdentityV1", ["delegationSequence", "delegationHash", "delegatedReleaseKeyId", "releaseIndexSequence", "releaseIndexHash"]);
  return { delegationSequence: parseUInt64Decimal(input.delegationSequence), delegationHash: parseLowerHexSha256(input.delegationHash), delegatedReleaseKeyId: parseLowerHexSha256(input.delegatedReleaseKeyId), releaseIndexSequence: parseUInt64Decimal(input.releaseIndexSequence), releaseIndexHash: parseLowerHexSha256(input.releaseIndexHash) };
}
function advance(sequence: UInt64DecimalV1, oldHash: LowerHexSha256, nextSequence: UInt64DecimalV1, nextHash: LowerHexSha256, label: string): [UInt64DecimalV1, LowerHexSha256] {
  const comparison = compareUInt64(nextSequence, sequence); if (comparison < 0 || (comparison === 0 && nextHash !== oldHash)) invalid(`ReleaseTrustStateV1 ${label} replay`); return comparison === 0 ? [sequence, oldHash] : [nextSequence, nextHash];
}
export function advanceReleaseTrust(current: ReleaseTrustStateV1, accepted: ReleaseMetadataIdentityV1 & Pick<ReleaseIdentityV1, "releaseSequence" | "releaseIdentityHash">): ReleaseTrustStateV1 {
  const trust = validateReleaseTrustState(current);
  const acceptedInput = exact(accepted, "accepted release observation", ["delegationSequence", "delegationHash", "delegatedReleaseKeyId", "releaseIndexSequence", "releaseIndexHash", "releaseSequence", "releaseIdentityHash"]);
  const metadata = validateReleaseMetadataIdentity({
    delegationSequence: acceptedInput.delegationSequence,
    delegationHash: acceptedInput.delegationHash,
    delegatedReleaseKeyId: acceptedInput.delegatedReleaseKeyId,
    releaseIndexSequence: acceptedInput.releaseIndexSequence,
    releaseIndexHash: acceptedInput.releaseIndexHash,
  });
  const releaseSequence = parseUInt64Decimal(acceptedInput.releaseSequence); const releaseIdentityHash = parseLowerHexSha256(acceptedInput.releaseIdentityHash);
  const [highestDelegationSequence, delegationHash] = advance(trust.highestDelegationSequence, trust.delegationHash, metadata.delegationSequence, metadata.delegationHash, "delegation");
  if (compareUInt64(metadata.delegationSequence, trust.highestDelegationSequence) === 0 && metadata.delegatedReleaseKeyId !== trust.delegatedReleaseKeyId) invalid("ReleaseTrustStateV1 delegation key replay");
  const [highestReleaseIndexSequence, releaseIndexHash] = advance(trust.highestReleaseIndexSequence, trust.releaseIndexHash, metadata.releaseIndexSequence, metadata.releaseIndexHash, "index");
  const [highestAcceptedReleaseSequence, nextReleaseIdentityHash] = advance(trust.highestAcceptedReleaseSequence, trust.releaseIdentityHash, releaseSequence, releaseIdentityHash, "release");
  return { schemaVersion: 1, highestDelegationSequence, delegationHash, delegatedReleaseKeyId: metadata.delegatedReleaseKeyId, highestReleaseIndexSequence, releaseIndexHash, highestAcceptedReleaseSequence, releaseIdentityHash: nextReleaseIdentityHash };
}

/** Selection is path-free; later update planning replaces this active-path placeholder with its guarded target bundle root. */
export function selectRelease(index: ReleaseIndexV1, request: { readonly version: StableSemverV1 | null; readonly active: ReleaseIdentityV1 }): { readonly outcome: "up_to_date"; readonly active: ReleaseIdentityV1 } | { readonly outcome: "selected"; readonly target: ReleaseIdentityV1 } {
  const trustedIndex = validateReleaseIndex(index); const desired = request.version === null ? trustedIndex.latestVersion : parseStableSemver(request.version); const active = request.active;
  const selected = trustedIndex.releases.find((entry) => entry.version === desired); if (selected === undefined) invalid("requested release");
  const comparison = compareSemver(selected.version, active.version); if (comparison < 0) invalid("release downgrade"); if (comparison === 0) return { outcome: "up_to_date", active };
  const bundle = selected.bundles[active.architecture === "arm64" ? 0 : 1];
  return { outcome: "selected", target: { version: selected.version, releaseSequence: selected.releaseSequence, releaseIdentityHash: releaseIdentityHash(selected, active.architecture), delegationSequence: active.delegationSequence, delegationHash: active.delegationHash, releaseIndexSequence: trustedIndex.sequence, releaseIndexHash: active.releaseIndexHash, bundleManifestHash: bundle.manifestSha256, bundleRoot: active.bundleRoot, platform: "darwin", architecture: active.architecture, launcherProtocol: selected.minimumLauncherProtocol, updateProtocol: selected.updateProtocol } };
}
