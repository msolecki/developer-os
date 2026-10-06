import { createHash } from "node:crypto";

import { compareUtf8, decodeCanonicalJson, encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { BrainConfigV1, DeveloperOsConfigV1 } from "../config/types.js";
import type { ArtifactOwner, ManagedArtifactSchemaIdV1, ManagedArtifactV2, MergeStrategy } from "../manifest/types.js";
import type { UpdateCapacityInputV1 } from "./capacity.js";
import { parseCanonicalAbsolutePathText, parseVaultRelativePathText, type BoundedArtifactSourceV1, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1, type OwnerRelativePathV1, type VaultRelativePathV1 } from "./paths.js";
import {
  buildPreparedUpdateCandidate,
  buildPreparedUpdateMaterialization,
  buildUpdatePreview,
  type OwnerUpdatePreviewInputV1,
  type PlannerTranscriptIdentityV1,
  type PlannerWireBoundsV1,
  type PreparedInverseLeafInputV1,
  type PreparedUpdateCandidateV1,
  type RollbackPayloadEntryV1,
  type SchemaMigrationPreviewV1,
  type UpdateDownloadPreviewV1,
  type UpdatePlanPreviewV1,
} from "./preview.js";
import { orderMigrationChain } from "./migration-planning.js";
import { parseBundleRelativePath, validateReleaseIdentity, type BundleRelativePathV1, type ReleaseIdentityV1, type ReleaseMetadataIdentityV1 } from "./release.js";
import {
  decodeTenDigitOrdinal,
  encodeTenDigitOrdinal,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSchemaMigrationId,
  parseStableSemver,
  parseUtcTimestamp,
  type LowerHexSha256,
  type PositiveUInt32V1,
  type SchemaMigrationIdV1,
  type StableSemverV1,
  type TenDigitZeroPaddedOrdinalV1,
  type UtcTimestampV1,
} from "./scalars.js";

declare const secretScreenedBlobV1: unique symbol;

/** Spec 2 §8.2. `artifact_` plus a ten-digit ordinal below the request's artifact count. */
export type PlannerPathTokenV1 = `artifact_${TenDigitZeroPaddedOrdinalV1}`;

export type PlannerPathRefV1 =
  | { readonly kind: "installed"; readonly token: PlannerPathTokenV1 }
  | { readonly kind: "target_bundle"; readonly path: BundleRelativePathV1 }
  | { readonly kind: "owner_relative"; readonly owner: ArtifactOwner; readonly path: OwnerRelativePathV1 };

export interface PlannerInputBlobRefV1 {
  readonly stream: "input";
  readonly ordinal: number;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
}

/** Hashless: only the current process screens and hashes what the target emitted. */
export interface PlannerOutputBlobRefV1 {
  readonly stream: "output";
  readonly ordinal: number;
  readonly bytes: number;
}

export type PlannerObservedStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "directory"; readonly mode: 448 }
  | { readonly state: "content"; readonly mode: 384 | 448; readonly bytes: number; readonly sha256: LowerHexSha256; readonly blob: PlannerInputBlobRefV1 | null }
  | { readonly state: "symlink"; readonly targetBytes: number; readonly targetHash: LowerHexSha256 }
  | { readonly state: "ephemeral_present"; readonly mode: 384 };

export interface PlannerArtifactInputV1 {
  readonly token: PlannerPathTokenV1;
  readonly owner: ArtifactOwner;
  readonly kind: ManagedArtifactV2["kind"];
  readonly verification: ManagedArtifactV2["verification"];
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly observed: PlannerObservedStateV1;
}

export interface PlannerBrainEntryV1 {
  readonly path: VaultRelativePathV1;
  readonly mode: 384;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly blob: PlannerInputBlobRefV1;
}

export interface PlannerBrainSnapshotV1 {
  readonly schemaVersion: 1;
  readonly root: "brain_root";
  readonly folderPolicyVersion: PositiveUInt32V1;
  readonly entries: readonly PlannerBrainEntryV1[];
  readonly aggregateBytes: number;
}

export interface PlannerManifestArtifactV1 {
  readonly token: PlannerPathTokenV1;
  readonly owner: ArtifactOwner;
  readonly kind: ManagedArtifactV2["kind"];
  readonly verification: ManagedArtifactV2["verification"];
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
  readonly currentHash: LowerHexSha256 | null;
}

export interface PlannerManifestSnapshotV1 {
  readonly schemaVersion: 1;
  readonly productVersion: StableSemverV1;
  readonly installedAt: UtcTimestampV1;
  readonly artifacts: readonly PlannerManifestArtifactV1[];
}

export interface PlannerConfigProjectionV1 {
  readonly schemaVersion: 1;
  readonly brainRoot: "brain_root";
  readonly adapters: DeveloperOsConfigV1["adapters"];
  readonly git: DeveloperOsConfigV1["git"];
  readonly automation: DeveloperOsConfigV1["automation"];
  readonly brain: BrainConfigV1 | null;
  readonly redactionPatternsCount: number;
  readonly telemetry: false;
}

export interface UpdatePlannerRequestV1 {
  readonly schemaVersion: 1;
  readonly protocol: PositiveUInt32V1;
  readonly plannedAt: UtcTimestampV1;
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly currentRelease: ReleaseIdentityV1;
  readonly targetRelease: ReleaseIdentityV1;
  readonly manifest: PlannerManifestSnapshotV1;
  readonly config: PlannerConfigProjectionV1;
  readonly installedOwners: readonly ArtifactOwner[];
  readonly artifactInputs: readonly PlannerArtifactInputV1[];
  readonly brain: PlannerBrainSnapshotV1;
}

export type PlannerContentRefV1 =
  | { readonly kind: "target_bundle"; readonly path: BundleRelativePathV1; readonly bytes: number; readonly sha256: LowerHexSha256 }
  | { readonly kind: "output_blob"; readonly blob: PlannerOutputBlobRefV1 };

type InstalledTargetV1 = { readonly kind: "installed"; readonly token: PlannerPathTokenV1 };

export type PlannerChangePlanOperationV1 =
  | { readonly operation: "keep"; readonly target: InstalledTargetV1; readonly expectedHash: LowerHexSha256 | null }
  | { readonly operation: "remove"; readonly target: InstalledTargetV1; readonly expectedHash: LowerHexSha256 | null }
  | { readonly operation: "replace"; readonly target: InstalledTargetV1; readonly expectedHash: LowerHexSha256 | null; readonly content: PlannerContentRefV1 }
  | { readonly operation: "create"; readonly target: Extract<PlannerPathRefV1, { readonly kind: "owner_relative" }>; readonly content: PlannerContentRefV1 };

export interface OwnerExternalEffectDraftV1 {
  readonly kind: "codex_registration_refresh";
  readonly owner: "codex";
  readonly artifactTokens: readonly PlannerPathTokenV1[];
}

export interface OwnerUpdateDraftV1 {
  readonly owner: ArtifactOwner;
  readonly currentArtifacts: readonly PlannerPathTokenV1[];
  readonly proposedOperations: readonly PlannerChangePlanOperationV1[];
  readonly externalEffects: readonly OwnerExternalEffectDraftV1[];
}

export interface SchemaMigrationMutationDraftV1 {
  readonly path:
    | { readonly domain: "brain"; readonly path: VaultRelativePathV1 }
    | { readonly domain: "product_state"; readonly token: PlannerPathTokenV1 };
  readonly beforeHash: LowerHexSha256;
  readonly afterBlob: PlannerOutputBlobRefV1;
  readonly inverseBlob: PlannerOutputBlobRefV1;
}

export interface SchemaMigrationDraftV1 {
  readonly id: SchemaMigrationIdV1;
  readonly domain: "brain" | "product_state";
  readonly fromVersion: PositiveUInt32V1;
  readonly toVersion: PositiveUInt32V1;
  readonly mutations: readonly SchemaMigrationMutationDraftV1[];
}

export type PlannerInstalledContentDraftV1 = InstalledTargetV1 | PlannerContentRefV1;

interface PlannerManagedArtifactDraftCommonV2 {
  readonly owner: ArtifactOwner;
  readonly path: PlannerPathRefV1;
  readonly productVersion: StableSemverV1;
  readonly source: BoundedArtifactSourceV1;
  readonly mergeStrategy: MergeStrategy;
}

export type PlannerManagedArtifactDraftV2 =
  | (PlannerManagedArtifactDraftCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "content"; readonly installed: PlannerInstalledContentDraftV1 } })
  | (PlannerManagedArtifactDraftCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "schema"; readonly schemaId: ManagedArtifactSchemaIdV1; readonly installed: PlannerInstalledContentDraftV1 } })
  | (PlannerManagedArtifactDraftCommonV2 & { readonly kind: "file"; readonly verification: { readonly mode: "ephemeral" } })
  | (PlannerManagedArtifactDraftCommonV2 & { readonly kind: "directory"; readonly verification: { readonly mode: "content" } })
  | (PlannerManagedArtifactDraftCommonV2 & { readonly kind: "symlink"; readonly verification: { readonly mode: "content"; readonly installed: InstalledTargetV1 } });

export interface PlannerInstallationManifestDraftV2 {
  readonly schemaVersion: 2;
  readonly productVersion: StableSemverV1;
  readonly artifacts: readonly PlannerManagedArtifactDraftV2[];
}

export interface TargetUpdateDraftV1 {
  readonly schemaVersion: 1;
  readonly protocol: PositiveUInt32V1;
  readonly currentRelease: ReleaseIdentityV1;
  readonly targetRelease: ReleaseIdentityV1;
  readonly ownerPlans: readonly OwnerUpdateDraftV1[];
  readonly migrations: readonly SchemaMigrationDraftV1[];
  readonly expectedManifest: PlannerInstallationManifestDraftV2;
}

/** The ordinal and length every draft reference names, in the contiguous order the frames must arrive. */
export interface PlannerOutputBlobExpectationV1 {
  readonly ordinal: number;
  readonly bytes: number;
}

export interface AdmittedTargetUpdateDraftV1 {
  readonly draft: TargetUpdateDraftV1;
  readonly outputBlobs: readonly PlannerOutputBlobExpectationV1[];
}

/**
 * One complete output frame after the Security secret screen, hashed by the current process.
 * Only Security's supervisor mints the brand; Core consumers accept nothing unscreened.
 */
export type SecretScreenedBlobV1 = {
  readonly ordinal: number;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly content: Uint8Array;
} & { readonly [secretScreenedBlobV1]: true };

export type PlannerWireDirectionV1 = "input" | "output";

export type PlannerWireFrameV1 =
  | { readonly kind: "json"; readonly payload: Uint8Array }
  | { readonly kind: "blob"; readonly ordinal: number; readonly payload: Uint8Array }
  | { readonly kind: "end" };

/** The protocol this release speaks; a newer target protocol refuses before execution. */
export const PLANNER_PROTOCOL_V1 = 1 as PositiveUInt32V1;

/** Spec 2 §8.2: the fixed protocol ceilings, not target-selected budgets. */
export const PLANNER_WIRE_BOUNDS_V1: PlannerWireBoundsV1 = Object.freeze({
  requestJsonBytes: 268_435_456,
  resultJsonBytes: 268_435_456,
  inputBlobCount: 1_000_000,
  outputBlobCount: 1_000_000,
  inputBlobBytes: 1_073_741_824,
  outputBlobBytes: 1_073_741_824,
  stdinWireBytes: 1_351_177_306,
  stdoutWireBytes: 1_351_177_306,
  stderrBytes: 1_048_576,
  residentBytes: 536_870_912,
  idleMilliseconds: 30_000,
  wallMilliseconds: 600_000,
  processCount: 1,
});

const PLANNER_WIRE_MAGIC = new TextEncoder().encode("DOSUPD1\n");

const FRAME_KINDS = {
  input: { json: 0x01, blob: 0x02, end: 0x03 },
  output: { json: 0x11, blob: 0x12, end: 0x13 },
} as const;
const HEADER_BYTES = 9;
const MAX_BLOB_BYTES = 16_777_216;
const MAX_OBSERVED_BYTES = 536_870_912;
const MAX_ARTIFACTS = 1_000_000;
const MAX_TOKEN_ORDINAL = 999_999;
const OWNER_ORDER: readonly ArtifactOwner[] = ["core", "claude", "codex", "macos"];
const MERGE_STRATEGIES: readonly MergeStrategy[] = ["dedicated", "semantic-json", "semantic-toml", "marked-block"];
const SCHEMA_IDS: readonly ManagedArtifactSchemaIdV1[] = ["developer-os-config-v1", "lifecycle-id-allocator-v1", "active-release-record-v1", "release-trust-state-v1", "codex-registration-v1"];
const ARTIFACT_KINDS: readonly ManagedArtifactV2["kind"][] = ["file", "directory", "symlink", "instruction"];
const PATH_REF_ORDER: readonly PlannerPathRefV1["kind"][] = ["installed", "target_bundle", "owner_relative"];
const encoder = new TextEncoder();

/**
 * The planner protocol carries no filesystem authority, so release identities are checked
 * against their grammar only; the current process admits them against guarded reopens.
 */
const GRAMMAR_ONLY_EVIDENCE: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path) => path,
  containsCanonicalPath: () => true,
  hasFoldedAlias: () => false,
};

type UnknownRecord = Record<string, unknown>;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) fail(label);
  return value as UnknownRecord;
}

function exact(value: unknown, label: string, keys: readonly string[]): UnknownRecord {
  const input = record(value, label);
  const actual = Object.keys(input);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(`${label}: keys`);
  return input;
}

function array(value: unknown, label: string, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label}: count`);
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function oneOf<T>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) fail(label);
  return value as T;
}

function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function sha256Hex(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

export function plannerPathToken(ordinal: number): PlannerPathTokenV1 {
  return `artifact_${encodeTenDigitOrdinal(integer(ordinal, 0, MAX_TOKEN_ORDINAL, "PlannerPathTokenV1"))}`;
}

/** Decodes a token and requires it to name one of the request's `count` artifacts. */
export function parsePlannerPathToken(value: unknown, count: number): { readonly token: PlannerPathTokenV1; readonly ordinal: number } {
  if (typeof value !== "string" || !value.startsWith("artifact_")) fail("PlannerPathTokenV1");
  const ordinal = decodeTenDigitOrdinal(value.slice("artifact_".length));
  if (ordinal > MAX_TOKEN_ORDINAL || ordinal >= count) fail("PlannerPathTokenV1: outside the request");
  return { token: value as PlannerPathTokenV1, ordinal };
}

/** Spec 2 §8.3: owner-relative paths share the V2 source grammar and are rooted only by the current executor. */
function parseOwnerRelativePath(value: unknown): OwnerRelativePathV1 {
  return parseVaultRelativePathText(value) as string as OwnerRelativePathV1;
}

function parseInputBlobRef(value: unknown, label: string): PlannerInputBlobRefV1 {
  const input = exact(value, label, ["stream", "ordinal", "bytes", "sha256"]);
  if (input.stream !== "input") fail(`${label}.stream`);
  return {
    stream: "input",
    ordinal: integer(input.ordinal, 0, MAX_TOKEN_ORDINAL, `${label}.ordinal`),
    bytes: integer(input.bytes, 0, MAX_BLOB_BYTES, `${label}.bytes`),
    sha256: parseLowerHexSha256(input.sha256),
  };
}

function parseOutputBlobRef(value: unknown, label: string): PlannerOutputBlobRefV1 {
  const input = exact(value, label, ["stream", "ordinal", "bytes"]);
  if (input.stream !== "output") fail(`${label}.stream`);
  return {
    stream: "output",
    ordinal: integer(input.ordinal, 0, MAX_TOKEN_ORDINAL, `${label}.ordinal`),
    bytes: integer(input.bytes, 0, MAX_BLOB_BYTES, `${label}.bytes`),
  };
}

function parseReleaseIdentity(value: unknown): ReleaseIdentityV1 {
  return validateReleaseIdentity(value, GRAMMAR_ONLY_EVIDENCE);
}

/** The manifest evidence columns every artifact input repeats from its manifest row. */
function parseArtifactColumns(input: UnknownRecord, label: string): Omit<PlannerManifestArtifactV1, "token" | "currentHash"> {
  const verification = record(input.verification, `${label}.verification`);
  oneOf(verification.mode, ["content", "schema", "ephemeral", "block"], `${label}.verification.mode`);
  return {
    owner: oneOf(input.owner, OWNER_ORDER, `${label}.owner`),
    kind: oneOf(input.kind, ARTIFACT_KINDS, `${label}.kind`),
    verification: verification as unknown as ManagedArtifactV2["verification"],
    productVersion: parseStableSemver(input.productVersion),
    source: parseVaultRelativePathText(input.source) as string as BoundedArtifactSourceV1,
    mergeStrategy: oneOf(input.mergeStrategy, MERGE_STRATEGIES, `${label}.mergeStrategy`),
  };
}

function parseManifestSnapshot(value: unknown): PlannerManifestSnapshotV1 {
  const input = exact(value, "PlannerManifestSnapshotV1", ["schemaVersion", "productVersion", "installedAt", "artifacts"]);
  if (input.schemaVersion !== 1) fail("PlannerManifestSnapshotV1.schemaVersion");
  const rows = array(input.artifacts, "PlannerManifestSnapshotV1.artifacts", 1, MAX_ARTIFACTS);
  const artifacts = rows.map((row, index): PlannerManifestArtifactV1 => {
    const label = "PlannerManifestArtifactV1";
    const artifact = exact(row, label, ["token", "owner", "kind", "verification", "productVersion", "source", "mergeStrategy", "currentHash"]);
    if (parsePlannerPathToken(artifact.token, rows.length).ordinal !== index) fail(`${label}.token: not in token order`);
    return {
      token: artifact.token as PlannerPathTokenV1,
      ...parseArtifactColumns(artifact, label),
      currentHash: artifact.currentHash === null ? null : parseLowerHexSha256(artifact.currentHash),
    };
  });
  return { schemaVersion: 1, productVersion: parseStableSemver(input.productVersion), installedAt: parseUtcTimestamp(input.installedAt), artifacts };
}

/** Spec 2 §8.2's legality table: each observed arm belongs to exactly one guarded kind/verification. */
function parseObserved(value: unknown, row: PlannerManifestArtifactV1): PlannerObservedStateV1 {
  const label = "PlannerArtifactInputV1.observed";
  const input = record(value, label);
  const mode = row.verification.mode;
  switch (input.state) {
    case "absent":
      exact(input, label, ["state"]);
      if (row.kind !== "file" || mode !== "ephemeral") fail(`${label}: absent is only a clean ephemeral reservation`);
      return { state: "absent" };
    case "directory":
      exact(input, label, ["state", "mode"]);
      if (row.kind !== "directory" || mode !== "content" || input.mode !== 448) fail(`${label}: directory`);
      return { state: "directory", mode: 448 };
    case "ephemeral_present":
      exact(input, label, ["state", "mode"]);
      if (row.kind !== "file" || mode !== "ephemeral" || input.mode !== 384) fail(`${label}: ephemeral`);
      return { state: "ephemeral_present", mode: 384 };
    case "symlink":
      exact(input, label, ["state", "targetBytes", "targetHash"]);
      if (row.kind !== "symlink" || mode !== "content") fail(`${label}: symlink`);
      return { state: "symlink", targetBytes: integer(input.targetBytes, 0, 4_096, `${label}.targetBytes`), targetHash: parseLowerHexSha256(input.targetHash) };
    case "content": {
      exact(input, label, ["state", "mode", "bytes", "sha256", "blob"]);
      const regular = (row.kind === "file" && (mode === "content" || mode === "schema")) || (row.kind === "instruction" && (mode === "content" || mode === "block"));
      if (!regular) fail(`${label}: content`);
      const fileMode = oneOf(input.mode, [384, 448] as const, `${label}.mode`);
      const sha256 = parseLowerHexSha256(input.sha256);
      if (input.blob === null) {
        return { state: "content", mode: fileMode, bytes: integer(input.bytes, 0, MAX_OBSERVED_BYTES, `${label}.bytes`), sha256, blob: null };
      }
      const bytes = integer(input.bytes, 0, MAX_BLOB_BYTES, `${label}.bytes`);
      const blob = parseInputBlobRef(input.blob, `${label}.blob`);
      if (blob.bytes !== bytes || blob.sha256 !== sha256) fail(`${label}.blob: differs from the observed content`);
      return { state: "content", mode: fileMode, bytes, sha256, blob };
    }
    default:
      return fail(`${label}.state`);
  }
}

function parseConfigProjection(value: unknown): PlannerConfigProjectionV1 {
  const label = "PlannerConfigProjectionV1";
  const input = exact(value, label, ["schemaVersion", "brainRoot", "adapters", "git", "automation", "brain", "redactionPatternsCount", "telemetry"]);
  if (input.schemaVersion !== 1 || input.brainRoot !== "brain_root" || input.telemetry !== false) fail(label);
  const adapters = exact(input.adapters, `${label}.adapters`, ["claude", "codex"]);
  if (typeof adapters.claude !== "boolean" || typeof adapters.codex !== "boolean") fail(`${label}.adapters`);
  for (const section of ["git", "automation"] as const) {
    const sectionValue = record(input[section], `${label}.${section}`);
    const keys = Object.keys(sectionValue);
    if (typeof sectionValue.enabled !== "boolean" || keys.some((key) => key !== "enabled" && key !== "lifecycle")) fail(`${label}.${section}`);
    if ("lifecycle" in sectionValue) record(sectionValue.lifecycle, `${label}.${section}.lifecycle`);
  }
  if (input.brain !== null) {
    exact(input.brain, `${label}.brain`, ["schemaVersion", "contentRoot", "topicFolders", "topicAliases", "indexesDir", "retrieval", "staleness"]);
  }
  integer(input.redactionPatternsCount, 0, 64, `${label}.redactionPatternsCount`);
  // Canonical-encodable end to end, so no non-JSON value reaches the wire.
  canonical(input);
  return input as unknown as PlannerConfigProjectionV1;
}

function parseBrainSnapshot(value: unknown): PlannerBrainSnapshotV1 {
  const label = "PlannerBrainSnapshotV1";
  const input = exact(value, label, ["schemaVersion", "root", "folderPolicyVersion", "entries", "aggregateBytes"]);
  if (input.schemaVersion !== 1 || input.root !== "brain_root") fail(label);
  let aggregateBytes = 0;
  let prior: string | undefined;
  const entries = array(input.entries, `${label}.entries`, 0, MAX_ARTIFACTS).map((row): PlannerBrainEntryV1 => {
    const entry = exact(row, "PlannerBrainEntryV1", ["path", "mode", "bytes", "sha256", "blob"]);
    const path = parseVaultRelativePathText(entry.path);
    if (prior !== undefined && compareUtf8(prior, path) >= 0) fail("PlannerBrainEntryV1.path: not unique and sorted");
    prior = path;
    if (entry.mode !== 384) fail("PlannerBrainEntryV1.mode");
    const bytes = integer(entry.bytes, 0, MAX_BLOB_BYTES, "PlannerBrainEntryV1.bytes");
    const sha256 = parseLowerHexSha256(entry.sha256);
    const blob = parseInputBlobRef(entry.blob, "PlannerBrainEntryV1.blob");
    if (blob.bytes !== bytes || blob.sha256 !== sha256) fail("PlannerBrainEntryV1.blob: differs from the entry");
    aggregateBytes += bytes;
    if (aggregateBytes > 1_073_741_824) fail(`${label}.aggregateBytes`);
    return { path, mode: 384, bytes, sha256, blob };
  });
  if (input.aggregateBytes !== aggregateBytes) fail(`${label}.aggregateBytes: not the checked entry sum`);
  return { schemaVersion: 1, root: "brain_root", folderPolicyVersion: parsePositiveUInt32(input.folderPolicyVersion), entries, aggregateBytes };
}

/**
 * The input blob references a request implies, in frame order: artifact inputs in token order,
 * then Brain entries in path order. The ordinals must be exactly that contiguous sequence.
 */
export function plannerInputBlobRefs(request: UpdatePlannerRequestV1): readonly PlannerInputBlobRefV1[] {
  const refs: PlannerInputBlobRefV1[] = [];
  for (const input of request.artifactInputs) if (input.observed.state === "content" && input.observed.blob !== null) refs.push(input.observed.blob);
  for (const entry of request.brain.entries) refs.push(entry.blob);
  return refs;
}

/** Validates a complete request with exact keys, token order, legality, and contiguous input blob references. */
export function validateUpdatePlannerRequest(value: unknown): UpdatePlannerRequestV1 {
  const label = "UpdatePlannerRequestV1";
  const input = exact(value, label, ["schemaVersion", "protocol", "plannedAt", "platform", "architecture", "currentRelease", "targetRelease", "manifest", "config", "installedOwners", "artifactInputs", "brain"]);
  if (input.schemaVersion !== 1 || input.platform !== "darwin") fail(label);
  const architecture = oneOf(input.architecture, ["arm64", "x64"] as const, `${label}.architecture`);
  const currentRelease = parseReleaseIdentity(input.currentRelease);
  const targetRelease = parseReleaseIdentity(input.targetRelease);
  if (currentRelease.architecture !== architecture || targetRelease.architecture !== architecture) fail(`${label}: architecture`);
  if (currentRelease.releaseIdentityHash === targetRelease.releaseIdentityHash) fail(`${label}: current and target are the same release`);
  const manifest = parseManifestSnapshot(input.manifest);

  const owners = array(input.installedOwners, `${label}.installedOwners`, 1, 16).map((owner) => oneOf(owner, OWNER_ORDER, `${label}.installedOwners`));
  for (let index = 1; index < owners.length; index += 1) {
    if (OWNER_ORDER.indexOf(owners[index - 1] as ArtifactOwner) >= OWNER_ORDER.indexOf(owners[index] as ArtifactOwner)) fail(`${label}.installedOwners: not unique and ordered`);
  }
  const manifestOwners = new Set(manifest.artifacts.map((row) => row.owner));
  if (manifestOwners.size !== owners.length || owners.some((owner) => !manifestOwners.has(owner))) fail(`${label}.installedOwners: not the manifest's owner set`);

  const rows = array(input.artifactInputs, `${label}.artifactInputs`, 1, MAX_ARTIFACTS);
  if (rows.length !== manifest.artifacts.length) fail(`${label}.artifactInputs: not the complete manifest projection`);
  const artifactInputs = rows.map((row, index): PlannerArtifactInputV1 => {
    const artifact = exact(row, "PlannerArtifactInputV1", ["token", "owner", "kind", "verification", "productVersion", "source", "mergeStrategy", "observed"]);
    const manifestRow = manifest.artifacts[index] as PlannerManifestArtifactV1;
    if (artifact.token !== manifestRow.token) fail("PlannerArtifactInputV1.token: not in token order");
    const columns = parseArtifactColumns(artifact, "PlannerArtifactInputV1");
    const expected = { owner: manifestRow.owner, kind: manifestRow.kind, verification: manifestRow.verification, productVersion: manifestRow.productVersion, source: manifestRow.source, mergeStrategy: manifestRow.mergeStrategy };
    if (!same(columns, expected)) fail("PlannerArtifactInputV1: differs from its manifest row");
    return { token: manifestRow.token, ...columns, observed: parseObserved(artifact.observed, manifestRow) };
  });

  const request: UpdatePlannerRequestV1 = {
    schemaVersion: 1,
    protocol: parsePositiveUInt32(input.protocol),
    plannedAt: parseUtcTimestamp(input.plannedAt),
    platform: "darwin",
    architecture,
    currentRelease,
    targetRelease,
    manifest,
    config: parseConfigProjection(input.config),
    installedOwners: owners,
    artifactInputs,
    brain: parseBrainSnapshot(input.brain),
  };
  const refs = plannerInputBlobRefs(request);
  if (refs.length > PLANNER_WIRE_BOUNDS_V1.inputBlobCount) fail(`${label}: input blob count`);
  let total = 0;
  refs.forEach((ref, ordinal) => {
    if (ref.ordinal !== ordinal) fail(`${label}: input blob ordinals are not contiguous in frame order`);
    total += ref.bytes;
  });
  if (total > PLANNER_WIRE_BOUNDS_V1.inputBlobBytes) fail(`${label}: input blob bytes`);
  if (!same(request, value)) fail(`${label}: not exact`);
  return request;
}

function parseContentRef(value: unknown, label: string, outputs: Map<number, number>): PlannerContentRefV1 {
  const input = record(value, label);
  if (input.kind === "target_bundle") {
    exact(input, label, ["kind", "path", "bytes", "sha256"]);
    return { kind: "target_bundle", path: parseBundleRelativePath(input.path), bytes: integer(input.bytes, 0, MAX_OBSERVED_BYTES, `${label}.bytes`), sha256: parseLowerHexSha256(input.sha256) };
  }
  if (input.kind === "output_blob") {
    exact(input, label, ["kind", "blob"]);
    return { kind: "output_blob", blob: useOutput(parseOutputBlobRef(input.blob, `${label}.blob`), outputs) };
  }
  return fail(`${label}.kind`);
}

function useOutput(ref: PlannerOutputBlobRefV1, outputs: Map<number, number>): PlannerOutputBlobRefV1 {
  const prior = outputs.get(ref.ordinal);
  if (prior !== undefined && prior !== ref.bytes) fail("PlannerOutputBlobRefV1: one ordinal with two lengths");
  outputs.set(ref.ordinal, ref.bytes);
  return ref;
}

interface DraftContext {
  readonly request: UpdatePlannerRequestV1;
  readonly count: number;
  readonly outputs: Map<number, number>;
}

function installedToken(value: unknown, label: string, context: DraftContext): PlannerArtifactInputV1 {
  const input = exact(value, label, ["kind", "token"]);
  if (input.kind !== "installed") fail(`${label}.kind`);
  return context.request.artifactInputs[parsePlannerPathToken(input.token, context.count).ordinal] as PlannerArtifactInputV1;
}

/** Blob-less content is complete-partition evidence only: it may never be changed, migrated, or reused. */
function isNullBlob(artifact: PlannerArtifactInputV1): boolean {
  return artifact.observed.state === "content" && artifact.observed.blob === null;
}

function parseOwnerPlan(value: unknown, owner: ArtifactOwner, context: DraftContext, keptOrUntouched: Set<string>): OwnerUpdateDraftV1 {
  const label = "OwnerUpdateDraftV1";
  const input = exact(value, label, ["owner", "currentArtifacts", "proposedOperations", "externalEffects"]);
  if (input.owner !== owner) fail(`${label}.owner: not the installed owner order`);
  const partition = context.request.artifactInputs.filter((artifact) => artifact.owner === owner).map((artifact) => artifact.token);
  if (!same(input.currentArtifacts, partition)) fail(`${label}.currentArtifacts: not the owner's complete partition`);

  const touched = new Set<string>();
  const created = new Set<string>();
  const operations = array(input.proposedOperations, `${label}.proposedOperations`, 0, MAX_ARTIFACTS).map((row): PlannerChangePlanOperationV1 => {
    const opLabel = "PlannerChangePlanOperationV1";
    const operation = record(row, opLabel);
    if (operation.operation === "create") {
      exact(operation, opLabel, ["operation", "target", "content"]);
      const target = exact(operation.target, `${opLabel}.target`, ["kind", "owner", "path"]);
      if (target.kind !== "owner_relative" || target.owner !== owner) fail(`${opLabel}.target: create names another owner or an installed token`);
      const path = parseOwnerRelativePath(target.path);
      const folded = path.normalize("NFC").toLowerCase();
      if (created.has(folded)) fail(`${opLabel}.target: duplicate create`);
      created.add(folded);
      return { operation: "create", target: { kind: "owner_relative", owner, path }, content: parseContentRef(operation.content, `${opLabel}.content`, context.outputs) };
    }
    const kind = oneOf(operation.operation, ["keep", "remove", "replace"] as const, `${opLabel}.operation`);
    exact(operation, opLabel, kind === "replace" ? ["operation", "target", "expectedHash", "content"] : ["operation", "target", "expectedHash"]);
    const artifact = installedToken(operation.target, `${opLabel}.target`, context);
    if (artifact.owner !== owner) fail(`${opLabel}.target: another owner's token`);
    if (touched.has(artifact.token)) fail(`${opLabel}.target: repeated token`);
    touched.add(artifact.token);
    const current = context.request.manifest.artifacts[decodeTenDigitOrdinal(artifact.token.slice("artifact_".length))] as PlannerManifestArtifactV1;
    const expectedHash = operation.expectedHash === null ? null : parseLowerHexSha256(operation.expectedHash);
    if (expectedHash !== current.currentHash) fail(`${opLabel}.expectedHash: differs from the manifest`);
    const target: InstalledTargetV1 = { kind: "installed", token: artifact.token };
    if (kind === "keep") {
      keptOrUntouched.add(artifact.token);
      return { operation: "keep", target, expectedHash };
    }
    if (isNullBlob(artifact)) fail(`${opLabel}: a blob-less artifact may only be kept`);
    if (kind === "remove") return { operation: "remove", target, expectedHash };
    if (artifact.observed.state !== "content") fail(`${opLabel}: only regular content may be replaced`);
    return { operation: "replace", target, expectedHash, content: parseContentRef(operation.content, `${opLabel}.content`, context.outputs) };
  });
  for (const token of partition) if (!touched.has(token)) keptOrUntouched.add(token);

  const effects = array(input.externalEffects, `${label}.externalEffects`, 0, 1).map((row): OwnerExternalEffectDraftV1 => {
    const effect = exact(row, "OwnerExternalEffectDraftV1", ["kind", "owner", "artifactTokens"]);
    if (effect.kind !== "codex_registration_refresh" || effect.owner !== "codex" || owner !== "codex") fail("OwnerExternalEffectDraftV1: not the closed Codex refresh");
    const tokens = array(effect.artifactTokens, "OwnerExternalEffectDraftV1.artifactTokens", 1, MAX_ARTIFACTS).map((token) => parsePlannerPathToken(token, context.count));
    for (let index = 0; index < tokens.length; index += 1) {
      const current = tokens[index] as { readonly token: PlannerPathTokenV1; readonly ordinal: number };
      if (index > 0 && (tokens[index - 1] as { readonly ordinal: number }).ordinal >= current.ordinal) fail("OwnerExternalEffectDraftV1.artifactTokens: not unique and ordered");
      if ((context.request.artifactInputs[current.ordinal] as PlannerArtifactInputV1).owner !== "codex") fail("OwnerExternalEffectDraftV1.artifactTokens: outside the Codex partition");
    }
    return { kind: "codex_registration_refresh", owner: "codex", artifactTokens: tokens.map((token) => token.token) };
  });
  return { owner, currentArtifacts: partition, proposedOperations: operations, externalEffects: effects };
}

function parseMigrations(value: unknown, context: DraftContext, keptOrUntouched: ReadonlySet<string>): SchemaMigrationDraftV1[] {
  const label = "SchemaMigrationDraftV1";
  const ids = new Set<string>();
  const chains = new Map<string, number>();
  const brain = new Map(context.request.brain.entries.map((entry) => [entry.path as string, entry]));
  const firstSeen = new Set<string>();
  const domains = new Map<string, string>();
  const migrations = array(value, "TargetUpdateDraftV1.migrations", 0, 10_000).map((row): SchemaMigrationDraftV1 => {
    const input = exact(row, label, ["id", "domain", "fromVersion", "toVersion", "mutations"]);
    const id = parseSchemaMigrationId(input.id);
    if (ids.has(id)) fail(`${label}.id: duplicate`);
    ids.add(id);
    const domain = oneOf(input.domain, ["brain", "product_state"] as const, `${label}.domain`);
    const fromVersion = parsePositiveUInt32(input.fromVersion);
    const toVersion = parsePositiveUInt32(input.toVersion);
    if (fromVersion >= toVersion) fail(`${label}: version order`);
    const chainEnd = chains.get(domain);
    if (chainEnd !== undefined && chainEnd !== fromVersion) fail(`${label}: chain is not contiguous`);
    chains.set(domain, toVersion);
    const paths = new Set<string>();
    const mutations = array(input.mutations, `${label}.mutations`, 1, 100_000).map((mutationRow): SchemaMigrationMutationDraftV1 => {
      const mutation = exact(mutationRow, "SchemaMigrationMutationDraftV1", ["path", "beforeHash", "afterBlob", "inverseBlob"]);
      const pathInput = record(mutation.path, "SchemaMigrationMutationDraftV1.path");
      if (pathInput.domain !== domain) fail("SchemaMigrationMutationDraftV1.path: domain differs from its migration");
      const beforeHash = parseLowerHexSha256(mutation.beforeHash);
      let key: string;
      let path: SchemaMigrationMutationDraftV1["path"];
      let snapshotHash: LowerHexSha256 | null;
      if (domain === "brain") {
        exact(pathInput, "SchemaMigrationMutationDraftV1.path", ["domain", "path"]);
        const entry = brain.get(parseVaultRelativePathText(pathInput.path));
        if (entry === undefined) fail("SchemaMigrationMutationDraftV1.path: not in the admitted Brain snapshot");
        path = { domain: "brain", path: entry.path };
        key = `brain:${entry.path}`;
        snapshotHash = entry.sha256;
      } else {
        exact(pathInput, "SchemaMigrationMutationDraftV1.path", ["domain", "token"]);
        const { token, ordinal } = parsePlannerPathToken(pathInput.token, context.count);
        const artifact = context.request.artifactInputs[ordinal] as PlannerArtifactInputV1;
        if (artifact.kind !== "file" || artifact.verification.mode !== "schema" || artifact.observed.state !== "content" || artifact.observed.blob === null) {
          fail("SchemaMigrationMutationDraftV1.path: not a manifest-owned schema artifact with content");
        }
        if (!keptOrUntouched.has(token)) fail("SchemaMigrationMutationDraftV1.path: its owner operation is not a byte-identical keep");
        path = { domain: "product_state", token };
        key = `product_state:${token}`;
        snapshotHash = artifact.observed.sha256;
      }
      if (paths.has(key)) fail("SchemaMigrationMutationDraftV1.path: repeated within one migration");
      paths.add(key);
      const priorDomain = domains.get(key);
      if (priorDomain !== undefined && priorDomain !== domain) fail("SchemaMigrationMutationDraftV1.path: cross-domain reuse");
      domains.set(key, domain);
      // A later chain step starts from its predecessor's after state, which only the current process can hash.
      if (!firstSeen.has(key) && beforeHash !== snapshotHash) fail("SchemaMigrationMutationDraftV1.beforeHash: differs from the snapshot");
      firstSeen.add(key);
      return {
        path,
        beforeHash,
        afterBlob: useOutput(parseOutputBlobRef(mutation.afterBlob, "SchemaMigrationMutationDraftV1.afterBlob"), context.outputs),
        inverseBlob: useOutput(parseOutputBlobRef(mutation.inverseBlob, "SchemaMigrationMutationDraftV1.inverseBlob"), context.outputs),
      };
    });
    return { id, domain, fromVersion, toVersion, mutations };
  });
  // Composition, the inverse inventory, and rollback all walk the draft's order: admit only the canonical one.
  if (orderMigrationChain(migrations).some((row, index) => row.id !== migrations[index]?.id)) fail("TargetUpdateDraftV1.migrations: planner output is not in canonical chain order");
  return migrations;
}

function comparePathRefs(left: PlannerPathRefV1, right: PlannerPathRefV1): number {
  const kind = PATH_REF_ORDER.indexOf(left.kind) - PATH_REF_ORDER.indexOf(right.kind);
  if (kind !== 0) return kind;
  if (left.kind === "installed" && right.kind === "installed") return compareUtf8(left.token, right.token);
  if (left.kind === "target_bundle" && right.kind === "target_bundle") return compareUtf8(left.path, right.path);
  if (left.kind === "owner_relative" && right.kind === "owner_relative") {
    return OWNER_ORDER.indexOf(left.owner) - OWNER_ORDER.indexOf(right.owner) || compareUtf8(left.path, right.path);
  }
  return 0;
}

function compareDraftArtifacts(left: PlannerManagedArtifactDraftV2, right: PlannerManagedArtifactDraftV2): number {
  return comparePathRefs(left.path, right.path)
    || OWNER_ORDER.indexOf(left.owner) - OWNER_ORDER.indexOf(right.owner)
    || compareUtf8(left.kind, right.kind)
    || compareUtf8(left.verification.mode, right.verification.mode);
}

function parseExpectedManifest(value: unknown, context: DraftContext): PlannerInstallationManifestDraftV2 {
  const label = "PlannerInstallationManifestDraftV2";
  const input = exact(value, label, ["schemaVersion", "productVersion", "artifacts"]);
  if (input.schemaVersion !== 2) fail(`${label}.schemaVersion`);
  const productVersion = parseStableSemver(input.productVersion);
  if (productVersion !== context.request.targetRelease.version) fail(`${label}.productVersion: not the target release`);
  const artifacts = array(input.artifacts, `${label}.artifacts`, 1, MAX_ARTIFACTS).map((row): PlannerManagedArtifactDraftV2 => {
    const rowLabel = "PlannerManagedArtifactDraftV2";
    // The four installation-history keys are illegal: the target cannot invent or erase history.
    const artifact = exact(row, rowLabel, ["owner", "path", "productVersion", "source", "mergeStrategy", "kind", "verification"]);
    const owner = oneOf(artifact.owner, OWNER_ORDER, `${rowLabel}.owner`);
    const pathInput = record(artifact.path, `${rowLabel}.path`);
    let path: PlannerPathRefV1;
    let installedPath: PlannerArtifactInputV1 | null = null;
    if (pathInput.kind === "installed") {
      installedPath = installedToken(pathInput, `${rowLabel}.path`, context);
      if (installedPath.owner !== owner) fail(`${rowLabel}.path: another owner's token`);
      path = { kind: "installed", token: installedPath.token };
    } else if (pathInput.kind === "target_bundle") {
      exact(pathInput, `${rowLabel}.path`, ["kind", "path"]);
      path = { kind: "target_bundle", path: parseBundleRelativePath(pathInput.path) };
    } else {
      exact(pathInput, `${rowLabel}.path`, ["kind", "owner", "path"]);
      if (pathInput.kind !== "owner_relative" || pathInput.owner !== owner) fail(`${rowLabel}.path`);
      path = { kind: "owner_relative", owner, path: parseOwnerRelativePath(pathInput.path) };
    }
    const common = {
      owner,
      path,
      productVersion: parseStableSemver(artifact.productVersion),
      source: parseVaultRelativePathText(artifact.source) as string as BoundedArtifactSourceV1,
      mergeStrategy: oneOf(artifact.mergeStrategy, MERGE_STRATEGIES, `${rowLabel}.mergeStrategy`),
    };
    const installedContent = (content: unknown): PlannerInstalledContentDraftV1 => {
      const contentInput = record(content, `${rowLabel}.verification.installed`);
      if (contentInput.kind !== "installed") return parseContentRef(contentInput, `${rowLabel}.verification.installed`, context.outputs);
      const source = installedToken(contentInput, `${rowLabel}.verification.installed`, context);
      if (isNullBlob(source) && (installedPath === null || installedPath.token !== source.token)) fail(`${rowLabel}: a blob-less artifact may only be kept in place`);
      return { kind: "installed", token: source.token };
    };
    const verification = record(artifact.verification, `${rowLabel}.verification`);
    if (artifact.kind === "file" && verification.mode === "content") {
      exact(verification, `${rowLabel}.verification`, ["mode", "installed"]);
      return { ...common, kind: "file", verification: { mode: "content", installed: installedContent(verification.installed) } };
    }
    if (artifact.kind === "file" && verification.mode === "schema") {
      exact(verification, `${rowLabel}.verification`, ["mode", "schemaId", "installed"]);
      return { ...common, kind: "file", verification: { mode: "schema", schemaId: oneOf(verification.schemaId, SCHEMA_IDS, `${rowLabel}.verification.schemaId`), installed: installedContent(verification.installed) } };
    }
    if (artifact.kind === "file" && verification.mode === "ephemeral") {
      exact(verification, `${rowLabel}.verification`, ["mode"]);
      return { ...common, kind: "file", verification: { mode: "ephemeral" } };
    }
    if (artifact.kind === "directory" && verification.mode === "content") {
      exact(verification, `${rowLabel}.verification`, ["mode"]);
      return { ...common, kind: "directory", verification: { mode: "content" } };
    }
    if (artifact.kind === "symlink" && verification.mode === "content") {
      exact(verification, `${rowLabel}.verification`, ["mode", "installed"]);
      const source = installedToken(verification.installed, `${rowLabel}.verification.installed`, context);
      if (source.observed.state !== "symlink") fail(`${rowLabel}.verification.installed: not an installed symlink`);
      return { ...common, kind: "symlink", verification: { mode: "content", installed: { kind: "installed", token: source.token } } };
    }
    return fail(`${rowLabel}.kind`);
  });
  for (let index = 1; index < artifacts.length; index += 1) {
    if (compareDraftArtifacts(artifacts[index - 1] as PlannerManagedArtifactDraftV2, artifacts[index] as PlannerManagedArtifactDraftV2) >= 0) {
      fail(`${label}.artifacts: not in root-free canonical order`);
    }
  }
  return { schemaVersion: 2, productVersion, artifacts };
}

/**
 * Admits a target draft against the request it answers. The target may name only request
 * tokens, snapshot Brain paths, target-bundle entries, or hashless output refs; every output
 * ordinal must be referenced with one length, and together they must be contiguous from zero.
 */
export function admitTargetUpdateDraft(value: unknown, request: UpdatePlannerRequestV1): AdmittedTargetUpdateDraftV1 {
  const label = "TargetUpdateDraftV1";
  const input = exact(value, label, ["schemaVersion", "protocol", "currentRelease", "targetRelease", "ownerPlans", "migrations", "expectedManifest"]);
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  if (parsePositiveUInt32(input.protocol) !== request.protocol) fail(`${label}.protocol: differs from the request`);
  if (!same(input.currentRelease, request.currentRelease) || !same(input.targetRelease, request.targetRelease)) fail(`${label}: release identity differs from the request`);
  const context: DraftContext = { request, count: request.artifactInputs.length, outputs: new Map() };
  const plans = array(input.ownerPlans, `${label}.ownerPlans`, 1, 16);
  if (plans.length !== request.installedOwners.length) fail(`${label}.ownerPlans: not one per installed owner`);
  const kept = new Set<string>();
  const ownerPlans = plans.map((plan, index) => parseOwnerPlan(plan, request.installedOwners[index] as ArtifactOwner, context, kept));
  for (const plan of ownerPlans) {
    if (plan.proposedOperations.length === 0 && plan.externalEffects.length > 0) fail(`${label}.ownerPlans: an external effect without operations`);
  }
  const migrations = parseMigrations(input.migrations, context, kept);
  const expectedManifest = parseExpectedManifest(input.expectedManifest, context);

  const outputBlobs = [...context.outputs.entries()].sort(([left], [right]) => left - right).map(([ordinal, bytes], index): PlannerOutputBlobExpectationV1 => {
    if (ordinal !== index) fail(`${label}: output blob ordinals are not contiguous`);
    return { ordinal, bytes };
  });
  if (outputBlobs.length > PLANNER_WIRE_BOUNDS_V1.outputBlobCount) fail(`${label}: output blob count`);
  if (outputBlobs.reduce((total, blob) => total + blob.bytes, 0) > PLANNER_WIRE_BOUNDS_V1.outputBlobBytes) fail(`${label}: output blob bytes`);
  const draft: TargetUpdateDraftV1 = { schemaVersion: 1, protocol: request.protocol, currentRelease: request.currentRelease, targetRelease: request.targetRelease, ownerPlans, migrations, expectedManifest };
  if (!same(draft, value)) fail(`${label}: not exact`);
  return { draft, outputBlobs };
}

/** The frame payload: canonical JSON without its trailing LF, the same bytes the transcript hashes. */
export function plannerJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonical(value).slice(0, -1));
}

/** Decodes a JSON frame payload, which must already be byte-for-byte canonical. */
export function decodePlannerJson(payload: Uint8Array, maximumBytes: number): CanonicalJsonValue {
  const withLineFeed = new Uint8Array(payload.byteLength + 1);
  withLineFeed.set(payload);
  withLineFeed[payload.byteLength] = 0x0a;
  return decodeCanonicalJson(withLineFeed, maximumBytes + 1);
}

/** `requestHash`/`resultHash`: the domain, NUL, then the exact no-LF canonical payload. */
export function plannerJsonHash(direction: PlannerWireDirectionV1, payload: Uint8Array): LowerHexSha256 {
  const domain = direction === "input" ? "developer-os/update-planner-request/v1" : "developer-os/update-planner-result/v1";
  return createHash("sha256").update(`${domain}\0`, "ascii").update(payload).digest("hex") as LowerHexSha256;
}

function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

/**
 * `inputBlobsHash`/`outputBlobsHash`, fed one contiguous blob at a time: the domain, NUL, the
 * u64 count, then per blob its u64 ordinal, u64 length, raw SHA-256, and exact bytes. The count
 * leads, so it is fixed before the first blob; an empty set still hashes the zero count.
 */
export class PlannerBlobSetHasher {
  readonly #hash = createHash("sha256");
  readonly #count: number;
  #next = 0;

  constructor(direction: PlannerWireDirectionV1, count: number) {
    this.#count = integer(count, 0, MAX_ARTIFACTS, "PlannerBlobSetHasher.count");
    this.#hash.update(`developer-os/update-planner-${direction}-blobs/v1\0`, "ascii").update(uint64(count));
  }

  /** `sha256` is the current process's own content hash, computed after the secret screen. */
  add(ordinal: number, content: Uint8Array, sha256: LowerHexSha256): void {
    if (ordinal !== this.#next || ordinal >= this.#count) fail("PlannerBlobSetHasher: ordinal is not the next contiguous blob");
    this.#next += 1;
    this.#hash.update(uint64(ordinal)).update(uint64(content.byteLength)).update(Buffer.from(sha256, "hex")).update(content);
  }

  digest(): LowerHexSha256 {
    if (this.#next !== this.#count) fail("PlannerBlobSetHasher: blob set is incomplete");
    return this.#hash.digest("hex") as LowerHexSha256;
  }
}

export function plannerBlobSetHash(direction: PlannerWireDirectionV1, blobs: readonly Uint8Array[]): LowerHexSha256 {
  const hasher = new PlannerBlobSetHasher(direction, blobs.length);
  blobs.forEach((blob, ordinal) => {
    hasher.add(ordinal, blob, sha256Hex(blob));
  });
  return hasher.digest();
}

function limits(direction: PlannerWireDirectionV1, bounds: PlannerWireBoundsV1): { readonly json: number; readonly count: number; readonly blobBytes: number; readonly wire: number } {
  return direction === "input"
    ? { json: bounds.requestJsonBytes, count: bounds.inputBlobCount, blobBytes: bounds.inputBlobBytes, wire: bounds.stdinWireBytes }
    : { json: bounds.resultJsonBytes, count: bounds.outputBlobCount, blobBytes: bounds.outputBlobBytes, wire: bounds.stdoutWireBytes };
}

function header(kind: number, length: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes[0] = kind;
  new DataView(bytes.buffer).setBigUint64(1, BigInt(length));
  return bytes;
}

/**
 * Emits one direction's closed grammar: magic, one JSON frame, contiguous blob frames, one empty
 * end frame. The first byte, count, or frame beyond a bound throws before that frame is returned.
 */
export class PlannerWireEncoder {
  readonly #kinds: (typeof FRAME_KINDS)[PlannerWireDirectionV1];
  readonly #limits: ReturnType<typeof limits>;
  #state: "magic" | "json" | "blobs" | "ended" = "magic";
  #wire = 0;
  #blobs = 0;
  #blobBytes = 0;

  constructor(direction: PlannerWireDirectionV1, bounds: PlannerWireBoundsV1 = PLANNER_WIRE_BOUNDS_V1) {
    this.#kinds = FRAME_KINDS[direction];
    this.#limits = limits(direction, bounds);
  }

  #emit(bytes: Uint8Array): Uint8Array {
    if (this.#wire + bytes.byteLength > this.#limits.wire) fail("PlannerWireEncoder: wire bytes");
    this.#wire += bytes.byteLength;
    return bytes;
  }

  magic(): Uint8Array {
    if (this.#state !== "magic") fail("PlannerWireEncoder: order");
    this.#state = "json";
    return this.#emit(PLANNER_WIRE_MAGIC.slice());
  }

  /** Returns the header; the caller writes `payload` itself so large frames are never copied. */
  json(payload: Uint8Array): Uint8Array {
    if (this.#state !== "json") fail("PlannerWireEncoder: order");
    if (payload.byteLength < 1 || payload.byteLength > this.#limits.json) fail("PlannerWireEncoder: JSON frame bytes");
    this.#state = "blobs";
    return this.#account(payload, header(this.#kinds.json, payload.byteLength));
  }

  blob(payload: Uint8Array): Uint8Array {
    if (this.#state !== "blobs") fail("PlannerWireEncoder: order");
    if (payload.byteLength > MAX_BLOB_BYTES) fail("PlannerWireEncoder: blob frame bytes");
    if (this.#blobs + 1 > this.#limits.count) fail("PlannerWireEncoder: blob count");
    if (this.#blobBytes + payload.byteLength > this.#limits.blobBytes) fail("PlannerWireEncoder: blob bytes");
    const frameHeader = this.#account(payload, header(this.#kinds.blob, payload.byteLength));
    this.#blobs += 1;
    this.#blobBytes += payload.byteLength;
    return frameHeader;
  }

  end(): Uint8Array {
    if (this.#state !== "blobs") fail("PlannerWireEncoder: order");
    this.#state = "ended";
    return this.#emit(header(this.#kinds.end, 0));
  }

  #account(payload: Uint8Array, frameHeader: Uint8Array): Uint8Array {
    if (this.#wire + frameHeader.byteLength + payload.byteLength > this.#limits.wire) fail("PlannerWireEncoder: wire bytes");
    this.#wire += frameHeader.byteLength + payload.byteLength;
    return frameHeader;
  }
}

/**
 * Parses one direction incrementally. A declared length is checked against every remaining cap
 * before any payload buffer is allocated, so a hostile header never sizes memory.
 */
export class PlannerWireDecoder {
  readonly #kinds: (typeof FRAME_KINDS)[PlannerWireDirectionV1];
  readonly #limits: ReturnType<typeof limits>;
  #state: "magic" | "json" | "blobs" | "ended" = "magic";
  #pending: Uint8Array = new Uint8Array(0);
  #frame: { readonly kind: number; readonly payload: Uint8Array; filled: number } | null = null;
  #wire = 0;
  #blobs = 0;
  #blobBytes = 0;

  constructor(direction: PlannerWireDirectionV1, bounds: PlannerWireBoundsV1 = PLANNER_WIRE_BOUNDS_V1) {
    this.#kinds = FRAME_KINDS[direction];
    this.#limits = limits(direction, bounds);
  }

  get ended(): boolean {
    return this.#state === "ended";
  }

  push(chunk: Uint8Array): PlannerWireFrameV1[] {
    this.#wire += chunk.byteLength;
    if (this.#wire > this.#limits.wire) fail("PlannerWireDecoder: wire bytes");
    const frames: PlannerWireFrameV1[] = [];
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.#state === "ended") fail("PlannerWireDecoder: trailing bytes");
      if (this.#frame !== null) {
        const take = Math.min(this.#frame.payload.byteLength - this.#frame.filled, chunk.byteLength - offset);
        this.#frame.payload.set(chunk.subarray(offset, offset + take), this.#frame.filled);
        this.#frame.filled += take;
        offset += take;
        if (this.#frame.filled === this.#frame.payload.byteLength) frames.push(this.#complete());
        continue;
      }
      const need = this.#state === "magic" ? PLANNER_WIRE_MAGIC.byteLength : HEADER_BYTES;
      const take = Math.min(need - this.#pending.byteLength, chunk.byteLength - offset);
      this.#pending = concat([this.#pending, chunk.subarray(offset, offset + take)]);
      offset += take;
      if (this.#pending.byteLength < need) continue;
      const bytes = this.#pending;
      this.#pending = new Uint8Array(0);
      if (this.#state === "magic") {
        if (bytes.some((byte, index) => byte !== PLANNER_WIRE_MAGIC[index])) fail("PlannerWireDecoder: magic");
        this.#state = "json";
        continue;
      }
      const frame = this.#open(bytes);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  }

  /** Refuses a stream that stopped before its end frame. */
  finish(): void {
    if (this.#state !== "ended" || this.#pending.byteLength > 0 || this.#frame !== null) fail("PlannerWireDecoder: truncated");
  }

  #open(bytes: Uint8Array): PlannerWireFrameV1 | null {
    const kind = bytes[0] as number;
    const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(1);
    if (kind === this.#kinds.json) {
      if (this.#state !== "json") fail("PlannerWireDecoder: frame order");
      if (declared < 1n || declared > BigInt(this.#limits.json)) fail("PlannerWireDecoder: JSON frame bytes");
    } else if (kind === this.#kinds.blob) {
      if (this.#state !== "blobs") fail("PlannerWireDecoder: frame order");
      if (declared > BigInt(MAX_BLOB_BYTES)) fail("PlannerWireDecoder: blob frame bytes");
      if (this.#blobs + 1 > this.#limits.count) fail("PlannerWireDecoder: blob count");
      if (this.#blobBytes + Number(declared) > this.#limits.blobBytes) fail("PlannerWireDecoder: blob bytes");
    } else if (kind === this.#kinds.end) {
      if (this.#state !== "blobs") fail("PlannerWireDecoder: frame order");
      if (declared !== 0n) fail("PlannerWireDecoder: end frame has a payload");
      this.#state = "ended";
      return { kind: "end" };
    } else {
      fail("PlannerWireDecoder: unknown frame kind");
    }
    this.#frame = { kind, payload: new Uint8Array(Number(declared)), filled: 0 };
    return this.#frame.payload.byteLength === 0 ? this.#complete() : null;
  }

  #complete(): PlannerWireFrameV1 {
    const frame = this.#frame as { readonly kind: number; readonly payload: Uint8Array };
    this.#frame = null;
    if (frame.kind === this.#kinds.json) {
      this.#state = "blobs";
      return { kind: "json", payload: frame.payload };
    }
    const ordinal = this.#blobs;
    this.#blobs += 1;
    this.#blobBytes += frame.payload.byteLength;
    return { kind: "blob", ordinal, payload: frame.payload };
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function encodeDirection(direction: PlannerWireDirectionV1, json: Uint8Array, blobs: readonly Uint8Array[]): Uint8Array {
  const wire = new PlannerWireEncoder(direction);
  const parts = [wire.magic(), wire.json(json), json];
  for (const blob of blobs) parts.push(wire.blob(blob), blob);
  parts.push(wire.end());
  return concat(parts);
}

function decodeDirection(direction: PlannerWireDirectionV1, bytes: Uint8Array): { readonly json: Uint8Array; readonly blobs: Uint8Array[] } {
  const wire = new PlannerWireDecoder(direction);
  let json: Uint8Array | null = null;
  const blobs: Uint8Array[] = [];
  for (const frame of wire.push(bytes)) {
    if (frame.kind === "json") json = frame.payload;
    else if (frame.kind === "blob") blobs.push(frame.payload);
  }
  wire.finish();
  return { json: json as Uint8Array, blobs };
}

/** Requires each blob to equal the ordinal, length, and hash its request reference implies. */
function checkInputBlobs(request: UpdatePlannerRequestV1, blobs: readonly Uint8Array[]): void {
  const refs = plannerInputBlobRefs(request);
  if (refs.length !== blobs.length) fail("planner input: blob count differs from the request");
  refs.forEach((ref, ordinal) => {
    const blob = blobs[ordinal] as Uint8Array;
    if (blob.byteLength !== ref.bytes || sha256Hex(blob) !== ref.sha256) fail("planner input: blob differs from its reference");
  });
}

/** The whole stdin transcript in one buffer: for tests and the target side's small helpers. */
export function encodePlannerInput(request: UpdatePlannerRequestV1, blobs: readonly Uint8Array[]): Uint8Array {
  const validated = validateUpdatePlannerRequest(request);
  checkInputBlobs(validated, blobs);
  return encodeDirection("input", plannerJsonBytes(validated), blobs);
}

export function decodePlannerInput(bytes: Uint8Array): { readonly request: UpdatePlannerRequestV1; readonly blobs: readonly Uint8Array[] } {
  const { json, blobs } = decodeDirection("input", bytes);
  const request = validateUpdatePlannerRequest(decodePlannerJson(json, PLANNER_WIRE_BOUNDS_V1.requestJsonBytes));
  checkInputBlobs(request, blobs);
  return { request, blobs };
}

/** What the target planner writes to stdout; the draft is admitted against its request first. */
export function encodePlannerOutput(request: UpdatePlannerRequestV1, draft: TargetUpdateDraftV1, blobs: readonly Uint8Array[]): Uint8Array {
  const admitted = admitTargetUpdateDraft(draft, request);
  if (admitted.outputBlobs.length !== blobs.length || admitted.outputBlobs.some((blob, ordinal) => blob.bytes !== (blobs[ordinal] as Uint8Array).byteLength)) {
    fail("planner output: blobs differ from the draft references");
  }
  return encodeDirection("output", plannerJsonBytes(admitted.draft), blobs);
}

export interface PlannerDraftMaterializationContextV1 {
  /** The current process's in-memory token map; it never crosses the wire. */
  readonly tokenPaths: ReadonlyMap<PlannerPathTokenV1, CanonicalAbsolutePathV1>;
  /** Each installed owner's closed root, used only to rehydrate owner-relative creates. */
  readonly ownerRoots: Readonly<Partial<Record<ArtifactOwner, CanonicalAbsolutePathV1>>>;
  readonly transcript: PlannerTranscriptIdentityV1;
  readonly metadata: ReleaseMetadataIdentityV1;
  readonly download: UpdateDownloadPreviewV1;
  readonly retainedRollback: UpdatePlanPreviewV1["retainedRollback"];
  readonly capacity: UpdateCapacityInputV1;
  /** Built by the owner and manifest tasks from the rehydrated draft; bound here by hash. */
  readonly concreteManifest: CanonicalJsonValue;
  readonly inverseLeaves: readonly PreparedInverseLeafInputV1[];
  readonly inversePlan: CanonicalJsonValue;
  readonly rollbackInventoryEntries: readonly RollbackPayloadEntryV1[];
}

function tokenPath(context: PlannerDraftMaterializationContextV1, token: PlannerPathTokenV1): CanonicalAbsolutePathV1 {
  const path = context.tokenPaths.get(token);
  if (path === undefined) fail("materializePlannerDraft: token has no current path");
  return path;
}

/**
 * Builds the in-memory prepared candidate from an admitted draft and its screened output frames.
 * The transcript must name this exact request, result, and output set; owner and migration
 * previews are rehydrated from the current process's own token map and owner roots.
 */
export function materializePlannerDraft(
  request: UpdatePlannerRequestV1,
  draft: TargetUpdateDraftV1,
  outputBlobs: readonly SecretScreenedBlobV1[],
  context: PlannerDraftMaterializationContextV1,
): PreparedUpdateCandidateV1 {
  const admitted = admitTargetUpdateDraft(draft, request);
  if (admitted.outputBlobs.length !== outputBlobs.length) fail("materializePlannerDraft: output blob count");
  const hasher = new PlannerBlobSetHasher("output", outputBlobs.length);
  outputBlobs.forEach((blob, ordinal) => {
    const expected = admitted.outputBlobs[ordinal] as PlannerOutputBlobExpectationV1;
    if (blob.ordinal !== ordinal || blob.bytes !== expected.bytes || blob.content.byteLength !== blob.bytes || sha256Hex(blob.content) !== blob.sha256) {
      fail("materializePlannerDraft: output blob differs from its reference");
    }
    hasher.add(ordinal, blob.content, blob.sha256);
  });
  const transcript = context.transcript;
  if (transcript.protocol !== request.protocol) fail("materializePlannerDraft: transcript protocol");
  if (transcript.requestHash !== plannerJsonHash("input", plannerJsonBytes(request))) fail("materializePlannerDraft: transcript request hash");
  if (transcript.resultHash !== plannerJsonHash("output", plannerJsonBytes(admitted.draft))) fail("materializePlannerDraft: transcript result hash");
  if (transcript.outputBlobsHash !== hasher.digest()) fail("materializePlannerDraft: transcript output blob hash");

  const owners = admitted.draft.ownerPlans.map((plan): OwnerUpdatePreviewInputV1 => {
    const paths = { create: [] as CanonicalAbsolutePathV1[], replace: [] as CanonicalAbsolutePathV1[], remove: [] as CanonicalAbsolutePathV1[], unchanged: [] as CanonicalAbsolutePathV1[] };
    const changed = new Set<string>();
    for (const operation of plan.proposedOperations) {
      if (operation.operation === "create") {
        const root = context.ownerRoots[plan.owner];
        if (root === undefined) fail("materializePlannerDraft: owner has no root");
        paths.create.push(parseCanonicalAbsolutePathText(`${root}/${operation.target.path}`));
        continue;
      }
      changed.add(operation.target.token);
      const path = tokenPath(context, operation.target.token);
      if (operation.operation === "keep") paths.unchanged.push(path);
      else paths[operation.operation].push(path);
    }
    for (const token of plan.currentArtifacts) if (!changed.has(token)) paths.unchanged.push(tokenPath(context, token));
    return { owner: plan.owner, partition: [...paths.create, ...paths.replace, ...paths.remove, ...paths.unchanged], paths, externalEffects: plan.externalEffects.length as 0 | 1 };
  });
  const migrations = admitted.draft.migrations.map((migration): SchemaMigrationPreviewV1 => ({
    id: migration.id,
    domain: migration.domain,
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    affectedPaths: migration.mutations.map((mutation) =>
      mutation.path.domain === "brain" ? mutation.path.path : tokenPath(context, mutation.path.token) as SchemaMigrationPreviewV1["affectedPaths"][number]),
  }));

  const preview = buildUpdatePreview({
    current: request.currentRelease,
    target: request.targetRelease,
    metadata: context.metadata,
    download: context.download,
    owners,
    migrations,
    planner: transcript,
    retainedRollback: context.retainedRollback,
    capacity: context.capacity,
  });
  const materialization = buildPreparedUpdateMaterialization({
    targetDraft: admitted.draft as unknown as CanonicalJsonValue,
    concreteManifest: context.concreteManifest,
    outputBlobs: outputBlobs.map((blob) => ({ ordinal: blob.ordinal, bytes: blob.bytes, sha256: blob.sha256 })),
    inverseLeaves: context.inverseLeaves,
    inversePlan: context.inversePlan,
    rollbackInventoryEntries: context.rollbackInventoryEntries,
  });
  return buildPreparedUpdateCandidate({ preview, transcriptIdentity: transcript, materialization });
}
