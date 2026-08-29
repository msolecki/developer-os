import { decodeTenDigitOrdinal, type SafeReasonCodeV1 } from "./scalars.js";

declare const canonicalAbsolutePathV1: unique symbol;
declare const exactProductStatePathV1: unique symbol;
declare const canonicalProductStatePathV1: unique symbol;
declare const vaultFreeRelativePathV1: unique symbol;
declare const ownerRelativePathV1: unique symbol;
declare const rollbackPayloadRelativePathV1: unique symbol;
declare const bootstrapPayloadPathV1: unique symbol;
declare const manifestPayloadPathV1: unique symbol;
declare const canonicalStatePayloadPathV1: unique symbol;
declare const foundationInitialJournalPayloadPathV1: unique symbol;
declare const updatePayloadPathV1: unique symbol;
declare const updateRecoveryExecutorStagedPathV1: unique symbol;

export type CanonicalAbsolutePathV1 = string & { readonly [canonicalAbsolutePathV1]: true };
export type ExactProductStatePathV1 = CanonicalAbsolutePathV1 & { readonly [exactProductStatePathV1]: true };
export type CanonicalProductStatePathV1 = CanonicalAbsolutePathV1 & { readonly [canonicalProductStatePathV1]: true };
export type VaultFreeRelativePathV1 = string & { readonly [vaultFreeRelativePathV1]: true };
export type BoundedArtifactSourceV1 = VaultFreeRelativePathV1;
export type OwnerRelativePathV1 = string & { readonly [ownerRelativePathV1]: true };
export type RollbackPayloadRelativePathV1 = string & { readonly [rollbackPayloadRelativePathV1]: true };
export type BootstrapPayloadPathV1 = CanonicalAbsolutePathV1 & { readonly [bootstrapPayloadPathV1]: true };
export type ManifestPayloadPathV1 = CanonicalAbsolutePathV1 & { readonly [manifestPayloadPathV1]: true };
export type CanonicalStatePayloadPathV1 = CanonicalAbsolutePathV1 & { readonly [canonicalStatePayloadPathV1]: true };
export type FoundationInitialJournalPayloadPathV1 = CanonicalAbsolutePathV1 & { readonly [foundationInitialJournalPayloadPathV1]: true };
export type UpdatePayloadPathV1 = CanonicalAbsolutePathV1 & { readonly [updatePayloadPathV1]: true };
export type UpdateRecoveryExecutorStagedPathV1 = CanonicalAbsolutePathV1 & { readonly [updateRecoveryExecutorStagedPathV1]: true };

/** Filesystem adapters supply this after guarded no-follow reopens. Core never resolves paths itself. */
export interface CanonicalPathEvidenceV1 {
  readonly reopenCanonicalAbsolutePath: (path: string) => string;
  readonly containsCanonicalPath: (root: string, candidate: string) => boolean;
  readonly hasFoldedAlias: (root: string, candidate: string) => boolean;
}

export type ExactProductStateRoleV1 = "lifecycle_plan" | "lifecycle_journal";

const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function assertNfcSafe(value: string, label: string): void {
  if (value.normalize("NFC") !== value) fail(`${label}: not NFC`);
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if ((codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f) || /\p{Cf}/u.test(character)) {
      fail(`${label}: control or format character`);
    }
  }
}

function assertCanonicalAbsolutePath(value: string): void {
  if (!value.startsWith("/") || value.startsWith("//") || value.endsWith("/") || value.includes("\\")) {
    fail("CanonicalAbsolutePathV1: not a canonical absolute POSIX path");
  }
  if (byteLength(value) < 1 || byteLength(value) > 4096) fail("CanonicalAbsolutePathV1: byte length");
  assertNfcSafe(value, "CanonicalAbsolutePathV1");
  for (const component of value.slice(1).split("/")) {
    if (component.length === 0 || component === "." || component === "..") fail("CanonicalAbsolutePathV1: component");
  }
}

export function admitCanonicalAbsolutePath(value: unknown, evidence: CanonicalPathEvidenceV1): CanonicalAbsolutePathV1 {
  if (typeof value !== "string") fail("CanonicalAbsolutePathV1");
  assertCanonicalAbsolutePath(value);
  if (evidence.reopenCanonicalAbsolutePath(value) !== value) fail("CanonicalAbsolutePathV1: unresolved or normalized");
  return value as CanonicalAbsolutePathV1;
}

function assertRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || byteLength(value) < 1 || byteLength(value) > 4096) fail(`${label}: byte length`);
  assertNfcSafe(value, label);
  if (value.startsWith("/") || value.includes("\\")) fail(`${label}: separator`);
  const components = value.split("/");
  if (components.length < 1 || components.length > 128) fail(`${label}: component count`);
  for (const component of components) {
    if (component.length === 0 || component === "." || component === ".." || byteLength(component) > 255) fail(`${label}: component`);
  }
  return value;
}

function admitRelativePath(
  value: unknown,
  root: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
  label: string,
): string {
  const relative = assertRelativePath(value, label);
  const candidate = `${root}/${relative}`;
  if (evidence.reopenCanonicalAbsolutePath(candidate) !== candidate || !evidence.containsCanonicalPath(root, candidate)) {
    fail(`${label}: not canonically contained`);
  }
  if (evidence.hasFoldedAlias(root, candidate)) fail(`${label}: folded alias`);
  return relative;
}

export function admitVaultFreeRelativePath(
  value: unknown,
  backupRoot: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
): VaultFreeRelativePathV1 {
  return admitRelativePath(value, backupRoot, evidence, "VaultFreeRelativePathV1") as VaultFreeRelativePathV1;
}

export function admitOwnerRelativePath(
  value: unknown,
  ownerRoot: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
): OwnerRelativePathV1 {
  return admitRelativePath(value, ownerRoot, evidence, "OwnerRelativePathV1") as OwnerRelativePathV1;
}

export function admitRollbackPayloadRelativePath(
  value: unknown,
  rollbackRoot: CanonicalAbsolutePathV1,
  evidence: CanonicalPathEvidenceV1,
): RollbackPayloadRelativePathV1 {
  const admitted = admitRelativePath(value, rollbackRoot, evidence, "RollbackPayloadRelativePathV1") as RollbackPayloadRelativePathV1;
  const blob = /^blobs\/([0-9]{10})\.bin$/.exec(admitted);
  const plan = /^plans\/([a-z][a-z0-9_]*)\/([a-z][a-z0-9_]*|migration_[a-z][a-z0-9-]*)\.plan\.json$/.test(admitted);
  if (blob !== null) decodeTenDigitOrdinal(blob[1]);
  else if (!plan) fail("RollbackPayloadRelativePathV1: not a role path");
  return admitted;
}

function derive(productHome: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  const path = `${productHome}/${relative}`;
  assertCanonicalAbsolutePath(path);
  return path as CanonicalAbsolutePathV1;
}

export function deriveExactProductStatePath(
  productHome: CanonicalAbsolutePathV1,
  role: ExactProductStateRoleV1,
  id: SafeReasonCodeV1,
): ExactProductStatePathV1 {
  const suffix = role === "lifecycle_plan" ? ".plan.json" : ".json";
  return derive(productHome, `state/lifecycle-journals/${id}${suffix}`) as ExactProductStatePathV1;
}

export function deriveBootstrapPayloadPath(
  productHome: CanonicalAbsolutePathV1,
  operation: "fresh_v2_init" | "manifest_migration",
  id: SafeReasonCodeV1,
  ordinal: number,
): BootstrapPayloadPathV1 {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 999_999) fail("bootstrap payload ordinal");
  const prefix = operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration";
  return derive(productHome, `state/.${prefix}.${id}.${ordinal.toString(10).padStart(10, "0")}.payload`) as BootstrapPayloadPathV1;
}

export function deriveManifestPayloadPath(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: SafeReasonCodeV1,
  participantId: SafeReasonCodeV1,
): ManifestPayloadPathV1 {
  return derive(productHome, `staging/lifecycle/${coordinatorId}/participants/manifest/${participantId}/after.json`) as ManifestPayloadPathV1;
}

export function deriveCanonicalStatePayloadPath(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: SafeReasonCodeV1,
  role: SafeReasonCodeV1,
  id: SafeReasonCodeV1,
): CanonicalStatePayloadPathV1 {
  return derive(productHome, `staging/lifecycle/${coordinatorId}/update/payloads/state/${role}/${id}.json`) as CanonicalStatePayloadPathV1;
}

export function deriveFoundationInitialJournalPayloadPath(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: SafeReasonCodeV1,
  transactionId: SafeReasonCodeV1,
): FoundationInitialJournalPayloadPathV1 {
  return derive(productHome, `staging/lifecycle/${coordinatorId}/participants/foundation/${transactionId}/initial-journal.json`) as FoundationInitialJournalPayloadPathV1;
}

export function deriveUpdatePayloadPath(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: SafeReasonCodeV1,
  ordinal: number,
): UpdatePayloadPathV1 {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 1_099_999) fail("update payload ordinal");
  return derive(productHome, `staging/lifecycle/${coordinatorId}/update/payloads/${ordinal.toString(10).padStart(10, "0")}.payload`) as UpdatePayloadPathV1;
}

export function deriveUpdateRecoveryExecutorStagedPath(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: SafeReasonCodeV1,
): UpdateRecoveryExecutorStagedPathV1 {
  return derive(productHome, `staging/lifecycle/${coordinatorId}/update/recovery-executor.json`) as UpdateRecoveryExecutorStagedPathV1;
}
