import { decodeCanonicalJson, encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { admitCanonicalAbsolutePath, admitVaultFreeRelativePath, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseStableSemver, parseUtcTimestamp } from "../update/scalars.js";
import { ManifestStateError, validateManifest } from "./store.js";
import type { ArtifactOwner, InstallationManifest, InstallationManifestV1, InstallationManifestV2, ManagedArtifactSchemaIdV1, ManagedArtifactV2, MergeStrategy, MigratableInstallationManifestV1 } from "./types.js";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACTS = 1_000_000;
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const owners = new Set<ArtifactOwner>(["core", "claude", "codex", "macos"]);
const mergeStrategies = new Set<MergeStrategy>(["dedicated", "semantic-json", "semantic-toml"]);
const schemas = new Set<ManagedArtifactSchemaIdV1>(["developer-os-config-v1", "lifecycle-id-allocator-v1", "active-release-record-v1", "release-trust-state-v1"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function invalid(): never { throw new ManifestStateError(); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]): void { const actual = Object.keys(value).sort(); const wanted = [...keys].sort(); if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) invalid(); }
function call<T>(fn: () => T): T { try { return fn(); } catch { return invalid(); } }
function bytes(value: string): number { return encoder.encode(value).byteLength; }
function unsafeCharacter(value: string): boolean { for (const character of value) { const point = character.codePointAt(0) as number; if (point <= 0x1f || (point >= 0x7f && point <= 0x9f) || /\p{Cf}/u.test(character)) return true; } return false; }
function relative(value: unknown): string {
  if (typeof value !== "string" || bytes(value) < 1 || bytes(value) > 4096 || value.normalize("NFC") !== value || value.startsWith("/") || value.includes("\\")) invalid();
  const parts = value.split("/");
  if (parts.length > 128 || parts.some((part) => bytes(part) < 1 || bytes(part) > 255 || part === "." || part === ".." || unsafeCharacter(part))) invalid();
  return value;
}
function common(value: Record<string, unknown>, evidence: CanonicalPathEvidenceV1): Omit<ManagedArtifactV2, "kind" | "verification"> {
  exact(value, ["backupRelativePath", "beforeHash", "existedBefore", "kind", "mergeStrategy", "owner", "path", "productVersion", "source", "verifiedAt", "verification"]);
  if (!owners.has(value.owner as ArtifactOwner) || !mergeStrategies.has(value.mergeStrategy as MergeStrategy) || typeof value.existedBefore !== "boolean") invalid();
  const path = call(() => admitCanonicalAbsolutePath(value.path, evidence));
  const productVersion = call(() => parseStableSemver(value.productVersion));
  const verifiedAt = call(() => parseUtcTimestamp(value.verifiedAt));
  const source = relative(value.source) as ManagedArtifactV2["source"];
  const beforeHash = value.beforeHash === null ? null : call(() => parseLowerHexSha256(value.beforeHash));
  const backupRelativePath = value.backupRelativePath === null ? null : relative(value.backupRelativePath) as ManagedArtifactV2["backupRelativePath"];
  return { owner: value.owner as ArtifactOwner, path, productVersion, existedBefore: value.existedBefore, beforeHash, backupRelativePath, source, mergeStrategy: value.mergeStrategy as MergeStrategy, verifiedAt };
}
function restore(base: ReturnType<typeof common>, allowed: boolean): void {
  if (!allowed && (base.existedBefore || base.beforeHash !== null || base.backupRelativePath !== null)) invalid();
  if (allowed && ((base.existedBefore && (base.beforeHash === null || base.backupRelativePath === null)) || (!base.existedBefore && (base.beforeHash !== null || base.backupRelativePath !== null)))) invalid();
}
function artifact(value: unknown, evidence: CanonicalPathEvidenceV1): ManagedArtifactV2 {
  const input = object(value); const base = common(input, evidence); const verification = object(input.verification);
  if (input.kind === "file" && verification.mode === "content") { exact(verification, ["installedHash", "mode"]); restore(base, true); return { ...base, kind: "file", verification: { mode: "content", installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  if (input.kind === "file" && verification.mode === "schema") { exact(verification, ["installedHash", "mode", "schemaId"]); restore(base, true); if (!schemas.has(verification.schemaId as ManagedArtifactSchemaIdV1)) invalid(); return { ...base, kind: "file", verification: { mode: "schema", schemaId: verification.schemaId as ManagedArtifactSchemaIdV1, installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  if (input.kind === "file" && verification.mode === "ephemeral") { exact(verification, ["mode"]); restore(base, false); return { ...base, kind: "file", verification: { mode: "ephemeral" } }; }
  if (input.kind === "directory" && verification.mode === "content") { exact(verification, ["mode"]); restore(base, false); return { ...base, kind: "directory", verification: { mode: "content" } }; }
  if (input.kind === "symlink" && verification.mode === "content") { exact(verification, ["installedHash", "mode"]); restore(base, false); return { ...base, kind: "symlink", verification: { mode: "content", installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  return invalid();
}
function compare(left: string, right: string): number { const a = encoder.encode(left); const b = encoder.encode(right); for (let i = 0; i < Math.min(a.length, b.length); i += 1) { if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number); } return a.length - b.length; }
function mode(value: ManagedArtifactV2): string { return value.verification.mode; }
function validateInventory(artifacts: readonly ManagedArtifactV2[]): void { const paths = new Set<string>(); let previous: ManagedArtifactV2 | undefined; for (const value of artifacts) { const folded = value.path.normalize("NFC").toLowerCase(); if (paths.has(folded)) invalid(); paths.add(folded); if (previous !== undefined) { const order = compare(previous.path, value.path) || compare(previous.owner, value.owner) || compare(previous.kind, value.kind) || compare(mode(previous), mode(value)); if (order >= 0) invalid(); } previous = value; } }

function whitespace(byte: number | undefined): boolean { return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d; }
function skipWhitespace(bytes: Uint8Array, index: number): number { while (whitespace(bytes[index])) index += 1; return index; }
function skipString(bytes: Uint8Array, index: number): number { if (bytes[index] !== 0x22) invalid(); index += 1; while (index < bytes.length) { const byte = bytes[index] as number; index += 1; if (byte === 0x22) return index; if (byte <= 0x1f) invalid(); if (byte === 0x5c) { const escape = bytes[index] as number; index += 1; if (escape === 0x75) { for (let digit = 0; digit < 4; digit += 1) { const hex = bytes[index] as number; if (!((hex >= 0x30 && hex <= 0x39) || (hex >= 0x41 && hex <= 0x46) || (hex >= 0x61 && hex <= 0x66))) invalid(); index += 1; } } else if (!(escape === 0x22 || escape === 0x5c || escape === 0x2f || escape === 0x62 || escape === 0x66 || escape === 0x6e || escape === 0x72 || escape === 0x74)) invalid(); } } return invalid(); }
function skipValue(bytes: Uint8Array, index: number): number { index = skipWhitespace(bytes, index); const first = bytes[index]; if (first === 0x22) return skipString(bytes, index); if (first === 0x7b || first === 0x5b) { const close = first === 0x7b ? 0x7d : 0x5d; index += 1; for (;;) { index = skipWhitespace(bytes, index); if (bytes[index] === close) return index + 1; if (first === 0x7b) { index = skipString(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] !== 0x3a) invalid(); index += 1; } index = skipValue(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] === close) return index + 1; if (bytes[index] !== 0x2c) invalid(); index += 1; } } while (index < bytes.length && !whitespace(bytes[index]) && bytes[index] !== 0x2c && bytes[index] !== 0x5d && bytes[index] !== 0x7d) index += 1; return index; }
function isArtifactsKey(bytes: Uint8Array, start: number, end: number): boolean { const artifactKey = [0x22, 0x61, 0x72, 0x74, 0x69, 0x66, 0x61, 0x63, 0x74, 0x73, 0x22]; return end - start === artifactKey.length && artifactKey.every((byte, index) => bytes[start + index] === byte); }
/** Counts the raw top-level artifacts array without materializing values. The canonical decoder remains the authority for JSON semantics. */
function countArtifactsBeforeDecode(bytes: Uint8Array): void { try { let index = skipWhitespace(bytes, 0); if (bytes[index] !== 0x7b) invalid(); index += 1; let found = false; for (;;) { index = skipWhitespace(bytes, index); if (bytes[index] === 0x7d) break; const start = index; const end = skipString(bytes, index); const artifacts = isArtifactsKey(bytes, start, end); index = skipWhitespace(bytes, end); if (bytes[index] !== 0x3a) invalid(); index = skipWhitespace(bytes, index + 1); if (artifacts) { if (found || bytes[index] !== 0x5b) invalid(); found = true; index += 1; index = skipWhitespace(bytes, index); let count = 0; if (bytes[index] !== 0x5d) for (;;) { index = skipValue(bytes, index); count += 1; if (count > MAX_ARTIFACTS) invalid(); index = skipWhitespace(bytes, index); if (bytes[index] === 0x5d) break; if (bytes[index] !== 0x2c) invalid(); index += 1; } index += 1; } else index = skipValue(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] === 0x7d) break; if (bytes[index] !== 0x2c) invalid(); index += 1; } if (!found) invalid(); } catch (error) { if (error instanceof ManifestStateError) throw error; invalid(); } }

export function validateManifestV2(value: unknown, evidence: CanonicalPathEvidenceV1): InstallationManifestV2 {
  const input = object(value); exact(input, ["artifacts", "installedAt", "productVersion", "schemaVersion"]); if (input.schemaVersion !== 2 || !Array.isArray(input.artifacts) || input.artifacts.length < 1 || input.artifacts.length > MAX_ARTIFACTS) invalid();
  if (bytes(call(() => encodeCanonicalJson(input as never))) > MAX_BYTES) invalid();
  const manifest = { schemaVersion: 2 as const, productVersion: call(() => parseStableSemver(input.productVersion)), installedAt: call(() => parseUtcTimestamp(input.installedAt)), artifacts: input.artifacts.map((entry) => artifact(entry, evidence)) };
  validateInventory(manifest.artifacts); return manifest;
}

export function validateManifestV1(value: unknown): InstallationManifestV1 { return validateManifest(value); }

function legacyBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid(); let text: string; try { text = decoder.decode(bytes); } catch { return invalid(); }
  if (!text.endsWith("\n") || text.endsWith("\n\n")) invalid(); let value: unknown; try { value = JSON.parse(text.slice(0, -1)); } catch { return invalid(); }
  const validated = validateManifestV1(value); const roundTrip = `${JSON.stringify(validated)}\n`; const canonical = encoder.encode(roundTrip); if (canonical.byteLength !== bytes.byteLength || canonical.some((byte, index) => byte !== bytes[index])) invalid(); return value;
}

export function validateMigratableManifestV1(bytes: Uint8Array, evidence: CanonicalPathEvidenceV1, backupRoot: CanonicalAbsolutePathV1): MigratableInstallationManifestV1 {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid(); countArtifactsBeforeDecode(bytes);
  const raw = legacyBytes(bytes); const manifest = validateManifestV1(raw); if (manifest.artifacts.length < 1 || manifest.artifacts.length > MAX_ARTIFACTS) invalid(); call(() => parseStableSemver(manifest.productVersion)); call(() => parseUtcTimestamp(manifest.installedAt));
  const paths = new Set<string>();
  for (const item of manifest.artifacts) {
    call(() => admitCanonicalAbsolutePath(item.path, evidence)); call(() => parseStableSemver(item.productVersion)); call(() => parseUtcTimestamp(item.verifiedAt)); call(() => parseLowerHexSha256(item.installedHash)); relative(item.source);
    const folded = item.path.normalize("NFC").toLowerCase(); if (paths.has(folded) || item.kind === "symlink" || item.kind === "config-entry") invalid(); paths.add(folded);
    if (item.existedBefore) { if (item.kind !== "file") invalid(); call(() => parseLowerHexSha256(item.beforeHash)); call(() => admitVaultFreeRelativePath(item.backupRelativePath, backupRoot, evidence)); }
    else if (item.beforeHash !== null || item.backupRelativePath !== null || (item.kind === "directory" && item.installedHash !== EMPTY_HASH)) invalid();
  }
  return structuredClone(manifest) as MigratableInstallationManifestV1;
}

export function validateManifestBytes(bytes: Uint8Array, evidence: CanonicalPathEvidenceV1): InstallationManifest {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid();
  countArtifactsBeforeDecode(bytes);
  let text: string; try { text = decoder.decode(bytes); } catch { return invalid(); }
  let candidate: unknown; try { candidate = JSON.parse(text); } catch { return invalid(); }
  if (object(candidate).schemaVersion === 1) { legacyBytes(bytes); return validateManifestV1(candidate); }
  try { return validateManifestV2(decodeCanonicalJson(bytes, MAX_BYTES), evidence); } catch { return invalid(); }
}
