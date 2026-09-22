import { decodeCanonicalJson, encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { admitCanonicalAbsolutePath, admitVaultFreeRelativePath } from "../update/paths.js";
import { parseLowerHexSha256, parseStableSemver, parseUtcTimestamp } from "../update/scalars.js";
import { ManifestStateError, validateManifest } from "./store.js";
import { parseInstructionId } from "../instructions/bounds.js";
import type { InstructionCategoryV1, InstructionIdV1 } from "../instructions/bounds.js";
import type { ArtifactOwner, InstallationManifest, InstallationManifestV1, InstallationManifestV2, InstructionBlockMemberV1, InstructionIdentityV1, ManifestAdmissionContextV1, ManagedArtifactSchemaIdV1, ManagedArtifactV2, MergeStrategy, MigratableInstallationManifestV1, OwnerPathArmV1 } from "./types.js";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACTS = 1_000_000;
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const owners = new Set<ArtifactOwner>(["core", "claude", "codex", "macos"]);
const mergeStrategies = new Set<MergeStrategy>(["dedicated", "semantic-json", "semantic-toml", "marked-block"]);
const schemas = new Set<ManagedArtifactSchemaIdV1>(["developer-os-config-v1", "lifecycle-id-allocator-v1", "active-release-record-v1", "release-trust-state-v1", "codex-registration-v1"]);
const categories = new Set<InstructionCategoryV1>(["rule", "scoped-rule", "output-style", "agent", "skill", "command", "vendor-file"]);
const MAX_BLOCK_MEMBERS = 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function invalid(): never { throw new ManifestStateError(); }
export class ManifestV1NotMigratableError extends ManifestStateError {
  readonly reason = "manifest_v1_not_migratable" as const;
  constructor() { super("V1 installation manifest is not migratable"); this.name = "ManifestV1NotMigratableError"; }
}
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]): void { const actual = Object.keys(value).sort(); const wanted = [...keys].sort(); if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) invalid(); }
function call<T>(fn: () => T): T { try { return fn(); } catch { return invalid(); } }
function bytes(value: string): number { return encoder.encode(value).byteLength; }
type CommonV2 = Omit<ManagedArtifactV2, "kind" | "verification" | "instruction">;
const COMMON_KEYS = ["backupRelativePath", "beforeHash", "existedBefore", "kind", "mergeStrategy", "owner", "path", "productVersion", "source", "verifiedAt", "verification"];
function ownerPathArm(value: Record<string, unknown>): OwnerPathArmV1 {
  if (value.kind === "file" || value.kind === "directory" || value.kind === "symlink") return { kind: value.kind };
  if (value.kind !== "instruction") return invalid();
  const verification = object(value.verification); const instruction = object(value.instruction);
  if ((verification.mode !== "content" && verification.mode !== "block") || !categories.has(instruction.category as InstructionCategoryV1)) invalid();
  return { kind: "instruction", mode: verification.mode, category: instruction.category as InstructionCategoryV1 };
}
function common(value: Record<string, unknown>, context: ManifestAdmissionContextV1, arm: OwnerPathArmV1): CommonV2 {
  exact(value, arm.kind === "instruction" ? [...COMMON_KEYS, "instruction"] : COMMON_KEYS);
  if (!owners.has(value.owner as ArtifactOwner) || !mergeStrategies.has(value.mergeStrategy as MergeStrategy) || typeof value.existedBefore !== "boolean") invalid();
  const owner = value.owner as ArtifactOwner;
  const path = call(() => {
    const canonical = admitCanonicalAbsolutePath(value.path, context.evidence);
    if (context.admitOwnerPath(owner, canonical, arm) !== canonical) invalid();
    return canonical;
  });
  const productVersion = call(() => parseStableSemver(value.productVersion));
  const verifiedAt = call(() => parseUtcTimestamp(value.verifiedAt));
  const source = call(() => admitVaultFreeRelativePath(value.source, context.sourceRoot, context.evidence));
  const beforeHash = value.beforeHash === null ? null : call(() => parseLowerHexSha256(value.beforeHash));
  const backupRelativePath = value.backupRelativePath === null ? null : call(() => admitVaultFreeRelativePath(value.backupRelativePath, context.backupRoot, context.evidence));
  return { owner, path, productVersion, existedBefore: value.existedBefore, beforeHash, backupRelativePath, source, mergeStrategy: value.mergeStrategy as MergeStrategy, verifiedAt };
}
function restore(base: CommonV2, allowed: boolean): void {
  if (!allowed && (base.existedBefore || base.beforeHash !== null || base.backupRelativePath !== null)) invalid();
  if (allowed && ((base.existedBefore && (base.beforeHash === null || base.backupRelativePath === null)) || (!base.existedBefore && (base.beforeHash !== null || base.backupRelativePath !== null)))) invalid();
}
function instructionId(value: unknown): InstructionIdV1 { if (typeof value !== "string") invalid(); return call(() => parseInstructionId(value)); }
function instructionSource(value: unknown): "default" | "user" { if (value !== "default" && value !== "user") invalid(); return value; }
function member(value: unknown): InstructionBlockMemberV1 {
  const input = object(value); exact(input, ["category", "id", "sha256", "source"]);
  if (input.category === "vendor-file" || !categories.has(input.category as InstructionCategoryV1)) invalid();
  return { category: input.category as InstructionBlockMemberV1["category"], id: instructionId(input.id), source: instructionSource(input.source), sha256: call(() => parseLowerHexSha256(input.sha256)) };
}
function instructionArtifact(input: Record<string, unknown>, base: CommonV2, verification: Record<string, unknown>): ManagedArtifactV2 {
  const identity = object(input.instruction);
  if (verification.mode === "content") {
    exact(verification, ["installedHash", "mode"]); exact(identity, ["category", "id", "source"]); restore(base, false);
    if (base.mergeStrategy !== "dedicated") invalid();
    const instruction: InstructionIdentityV1 = { category: identity.category as InstructionCategoryV1, id: instructionId(identity.id), source: instructionSource(identity.source) };
    return { ...base, kind: "instruction", instruction, verification: { mode: "content", installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } };
  }
  exact(verification, ["blockHash", "mode"]); exact(identity, ["category", "id", "members", "source"]); restore(base, true);
  if (base.mergeStrategy !== "marked-block" || (base.owner !== "claude" && base.owner !== "codex") || identity.category !== "vendor-file" || identity.source !== "default") invalid();
  if (!Array.isArray(identity.members) || identity.members.length < 1 || identity.members.length > MAX_BLOCK_MEMBERS) invalid();
  const members = identity.members.map(member);
  for (let i = 1; i < members.length; i += 1) { const a = members[i - 1] as InstructionBlockMemberV1; const b = members[i] as InstructionBlockMemberV1; if ((compare(a.category, b.category) || compare(a.id, b.id)) >= 0) invalid(); }
  return { ...base, kind: "instruction", instruction: { category: "vendor-file", id: instructionId(identity.id), source: "default", members }, verification: { mode: "block", blockHash: call(() => parseLowerHexSha256(verification.blockHash)) } };
}
function artifact(value: unknown, context: ManifestAdmissionContextV1): ManagedArtifactV2 {
  const input = object(value); const arm = ownerPathArm(input); const base = common(input, context, arm); const verification = object(input.verification);
  if (arm.kind === "instruction") return instructionArtifact(input, base, verification);
  if (base.mergeStrategy === "marked-block") invalid();
  if (input.kind === "file" && verification.mode === "content") { exact(verification, ["installedHash", "mode"]); restore(base, true); return { ...base, kind: "file", verification: { mode: "content", installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  if (input.kind === "file" && verification.mode === "schema") { exact(verification, ["installedHash", "mode", "schemaId"]); restore(base, true); if (!schemas.has(verification.schemaId as ManagedArtifactSchemaIdV1)) invalid(); return { ...base, kind: "file", verification: { mode: "schema", schemaId: verification.schemaId as ManagedArtifactSchemaIdV1, installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  if (input.kind === "file" && verification.mode === "ephemeral") { exact(verification, ["mode"]); restore(base, false); return { ...base, kind: "file", verification: { mode: "ephemeral" } }; }
  if (input.kind === "directory" && verification.mode === "content") { exact(verification, ["mode"]); restore(base, false); return { ...base, kind: "directory", verification: { mode: "content" } }; }
  if (input.kind === "symlink" && verification.mode === "content") { exact(verification, ["installedHash", "mode"]); restore(base, false); return { ...base, kind: "symlink", verification: { mode: "content", installedHash: call(() => parseLowerHexSha256(verification.installedHash)) } }; }
  return invalid();
}
function compare(left: string, right: string): number { const a = encoder.encode(left); const b = encoder.encode(right); for (let i = 0; i < Math.min(a.length, b.length); i += 1) { if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number); } return a.length - b.length; }
function mode(value: ManagedArtifactV2): string { return value.verification.mode; }
function validateInventory(artifacts: readonly ManagedArtifactV2[]): void { const paths = new Set<string>(); const blockOwners = new Set<ArtifactOwner>(); let previous: ManagedArtifactV2 | undefined; for (const value of artifacts) { if (value.verification.mode === "block") { if (blockOwners.has(value.owner)) invalid(); blockOwners.add(value.owner); } const folded = value.path.normalize("NFC").toLowerCase(); if (paths.has(folded)) invalid(); paths.add(folded); if (previous !== undefined) { const order = compare(previous.path, value.path) || compare(previous.owner, value.owner) || compare(previous.kind, value.kind) || compare(mode(previous), mode(value)); if (order >= 0) invalid(); } previous = value; } }

function whitespace(byte: number | undefined): boolean { return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d; }
function skipWhitespace(bytes: Uint8Array, index: number): number { while (whitespace(bytes[index])) index += 1; return index; }
function skipString(bytes: Uint8Array, index: number): number { if (bytes[index] !== 0x22) invalid(); index += 1; while (index < bytes.length) { const byte = bytes[index] as number; index += 1; if (byte === 0x22) return index; if (byte <= 0x1f) invalid(); if (byte === 0x5c) { const escape = bytes[index] as number; index += 1; if (escape === 0x75) { for (let digit = 0; digit < 4; digit += 1) { const hex = bytes[index] as number; if (!((hex >= 0x30 && hex <= 0x39) || (hex >= 0x41 && hex <= 0x46) || (hex >= 0x61 && hex <= 0x66))) invalid(); index += 1; } } else if (!(escape === 0x22 || escape === 0x5c || escape === 0x2f || escape === 0x62 || escape === 0x66 || escape === 0x6e || escape === 0x72 || escape === 0x74)) invalid(); } } return invalid(); }
function skipValue(bytes: Uint8Array, index: number): number { index = skipWhitespace(bytes, index); const first = bytes[index]; if (first === 0x22) return skipString(bytes, index); if (first === 0x7b || first === 0x5b) { const close = first === 0x7b ? 0x7d : 0x5d; index += 1; for (;;) { index = skipWhitespace(bytes, index); if (bytes[index] === close) return index + 1; if (first === 0x7b) { index = skipString(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] !== 0x3a) invalid(); index += 1; } index = skipValue(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] === close) return index + 1; if (bytes[index] !== 0x2c) invalid(); index += 1; } } while (index < bytes.length && !whitespace(bytes[index]) && bytes[index] !== 0x2c && bytes[index] !== 0x5d && bytes[index] !== 0x7d) index += 1; return index; }
function isArtifactsKey(bytes: Uint8Array, start: number, end: number): boolean { const artifactKey = [0x22, 0x61, 0x72, 0x74, 0x69, 0x66, 0x61, 0x63, 0x74, 0x73, 0x22]; return end - start === artifactKey.length && artifactKey.every((byte, index) => bytes[start + index] === byte); }
/** Counts the raw top-level artifacts array without materializing values. The canonical decoder remains the authority for JSON semantics. */
function countArtifactsBeforeDecode(bytes: Uint8Array): void { try { let index = skipWhitespace(bytes, 0); if (bytes[index] !== 0x7b) invalid(); index += 1; let found = false; for (;;) { index = skipWhitespace(bytes, index); if (bytes[index] === 0x7d) break; const start = index; const end = skipString(bytes, index); const artifacts = isArtifactsKey(bytes, start, end); index = skipWhitespace(bytes, end); if (bytes[index] !== 0x3a) invalid(); index = skipWhitespace(bytes, index + 1); if (artifacts) { if (found || bytes[index] !== 0x5b) invalid(); found = true; index += 1; index = skipWhitespace(bytes, index); let count = 0; if (bytes[index] !== 0x5d) for (;;) { index = skipValue(bytes, index); count += 1; if (count > MAX_ARTIFACTS) invalid(); index = skipWhitespace(bytes, index); if (bytes[index] === 0x5d) break; if (bytes[index] !== 0x2c) invalid(); index += 1; } index += 1; } else index = skipValue(bytes, index); index = skipWhitespace(bytes, index); if (bytes[index] === 0x7d) break; if (bytes[index] !== 0x2c) invalid(); index += 1; } if (!found) invalid(); } catch (error) { if (error instanceof ManifestStateError) throw error; invalid(); } }

export function validateManifestV2(value: unknown, context: ManifestAdmissionContextV1): InstallationManifestV2 {
  const input = object(value); exact(input, ["artifacts", "installedAt", "productVersion", "schemaVersion"]); if (input.schemaVersion !== 2 || !Array.isArray(input.artifacts) || input.artifacts.length < 1 || input.artifacts.length > MAX_ARTIFACTS) invalid();
  if (bytes(call(() => encodeCanonicalJson(input as never))) > MAX_BYTES) invalid();
  const manifest = { schemaVersion: 2 as const, productVersion: call(() => parseStableSemver(input.productVersion)), installedAt: call(() => parseUtcTimestamp(input.installedAt)), artifacts: input.artifacts.map((entry) => artifact(entry, context)) };
  validateInventory(manifest.artifacts); return manifest;
}

export function validateManifestV1(value: unknown): InstallationManifestV1 { return validateManifest(value); }

function legacyBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid(); let text: string; try { text = decoder.decode(bytes); } catch { return invalid(); }
  if (!text.endsWith("\n") || text.endsWith("\n\n")) invalid(); let value: unknown; try { value = JSON.parse(text.slice(0, -1)); } catch { return invalid(); }
  const validated = validateManifestV1(value); const roundTrip = `${JSON.stringify(validated)}\n`; const canonical = encoder.encode(roundTrip); if (canonical.byteLength !== bytes.byteLength || canonical.some((byte, index) => byte !== bytes[index])) invalid(); return value;
}

export function validateMigratableManifestV1(bytes: Uint8Array, context: ManifestAdmissionContextV1): MigratableInstallationManifestV1 {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid(); countArtifactsBeforeDecode(bytes);
    const raw = legacyBytes(bytes); const manifest = validateManifestV1(raw); if (manifest.artifacts.length < 1 || manifest.artifacts.length > MAX_ARTIFACTS) invalid(); call(() => parseStableSemver(manifest.productVersion)); call(() => parseUtcTimestamp(manifest.installedAt));
    const paths = new Set<string>();
    for (const item of manifest.artifacts) {
      const owner = item.owner; const kind = item.kind;
      if (kind !== "file" && kind !== "directory") invalid();
      const path = call(() => { const canonical = admitCanonicalAbsolutePath(item.path, context.evidence); if (context.admitOwnerPath(owner, canonical, { kind }) !== canonical) invalid(); return canonical; });
      call(() => parseStableSemver(item.productVersion)); call(() => parseUtcTimestamp(item.verifiedAt)); call(() => parseLowerHexSha256(item.installedHash)); call(() => admitVaultFreeRelativePath(item.source, context.sourceRoot, context.evidence));
      const folded = path.normalize("NFC").toLowerCase(); if (paths.has(folded)) invalid(); paths.add(folded);
      if (item.existedBefore) { if (item.kind !== "file") invalid(); call(() => parseLowerHexSha256(item.beforeHash)); call(() => admitVaultFreeRelativePath(item.backupRelativePath, context.backupRoot, context.evidence)); }
      else if (item.beforeHash !== null || item.backupRelativePath !== null || (item.kind === "directory" && item.installedHash !== EMPTY_HASH)) invalid();
    }
    return structuredClone(manifest) as MigratableInstallationManifestV1;
  } catch { throw new ManifestV1NotMigratableError(); }
}

export function validateManifestBytes(bytes: Uint8Array, context?: ManifestAdmissionContextV1): InstallationManifest {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) invalid();
  countArtifactsBeforeDecode(bytes);
  let text: string; try { text = decoder.decode(bytes); } catch { return invalid(); }
  let candidate: unknown; try { candidate = JSON.parse(text); } catch { return invalid(); }
  if (object(candidate).schemaVersion === 1) { legacyBytes(bytes); return validateManifestV1(candidate); }
  if (object(candidate).schemaVersion !== 2 || context === undefined) invalid();
  try { return validateManifestV2(decodeCanonicalJson(bytes, MAX_BYTES), context); } catch { return invalid(); }
}
