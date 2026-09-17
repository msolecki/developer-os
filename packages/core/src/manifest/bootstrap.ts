import { createHash } from "node:crypto";
import { dirname } from "node:path";

import { serializeConfig, type DeveloperOsConfigV1 } from "../config/index.js";
import {
  encodeCanonicalJson,
  type CanonicalJsonValue,
} from "../lifecycle/canonical-json.js";
import { EXIT_CODES } from "../result.js";
import {
  admitCanonicalAbsolutePath,
  admitVaultFreeRelativePath,
  deriveBootstrapPayloadPath,
  type BootstrapPayloadPathV1,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type ExactProductStatePathV1,
  type VaultFreeRelativePathV1,
} from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "../update/scalars.js";
import type {
  BootstrapExpectedPayloadRefV1,
  FreshV2InitIdV1,
  ManifestMigrationIdV1,
  ManifestStatePlanV1,
} from "./manifest-state.js";

const MAX_BOOTSTRAP_ORDINAL = 999_999;
const MAX_FOUNDATION_FORWARD_PARTICIPANTS = 256;
const MAX_FOUNDATION_PARTICIPANTS = 512;
const MAX_PLAN_BYTES = 268_435_456;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_STAGING_ENTRIES = 1_000_000;
const MAX_PAYLOAD_BYTES = 536_870_912;
const MAX_PLAN_DERIVED_VALUE_BYTES = 67_108_863;
const MAX_MIGRATION_PREIMAGE_BYTES = 67_108_864;
const MAX_CREATED_PATHS = 1_000_000;
const MAX_LAUNCHABILITY_PATHS = 200_006;
const MAX_COMPENSATION_NEXT = 2_200_264;
const MAX_RETENTION_NEXT = 2_200_526;
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_V4_RE = new RegExp(`^${UUID_V4}$`, "u");
const FRESH_ID_RE = new RegExp(`^fi_(${UUID_V4})$`, "u");
const MIGRATION_ID_RE = new RegExp(`^mm_(${UUID_V4})$`, "u");
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LowerHexSha256;
const encoder = new TextEncoder();

export class BootstrapStateError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor(message = "bootstrap state is malformed, unbound, or incomplete") {
    super(message);
    this.name = "BootstrapStateError";
  }
}

export type LifecycleInstallNonceV1 = LowerHexSha256;

export interface LifecycleIdAllocatorV1 {
  readonly schemaVersion: 1;
  readonly installNonce: LifecycleInstallNonceV1;
  readonly nextCounter: UInt64DecimalV1;
}

export interface LifecycleBootstrapLockV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly size: 0;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly createdByAttempt: boolean;
  readonly productHomeCreatedByAttempt: boolean;
  readonly stateDirectoryCreatedByAttempt: boolean;
}

export interface PersistedBootstrapLockIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly size: 0;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BootstrapExternalShapeEntryV1 {
  readonly role: "product_home" | "state_directory" | "bootstrap_lock";
  readonly pathHash: LowerHexSha256;
  readonly kind: "directory" | "regular_file";
  readonly ownerUid: number;
  readonly mode: 0o600 | 0o700;
  readonly nlink: number;
  readonly size: UInt64DecimalV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BootstrapExternalShapeProjectionV1 {
  readonly entries: readonly [
    BootstrapExternalShapeEntryV1,
    BootstrapExternalShapeEntryV1,
    BootstrapExternalShapeEntryV1,
  ];
}

export type BootstrapMigrationPreimageAuthorityV1 =
  | {
      readonly kind: "v1_manifest";
      readonly migrationId: ManifestMigrationIdV1;
      readonly v1ManifestHash: LowerHexSha256;
    }
  | {
      readonly kind: "v1_managed_artifact";
      readonly migrationId: ManifestMigrationIdV1;
      readonly artifactOrdinal: number;
      readonly installedHash: LowerHexSha256;
    }
  | {
      readonly kind: "v1_backup_artifact";
      readonly migrationId: ManifestMigrationIdV1;
      readonly artifactOrdinal: number;
      readonly beforeHash: LowerHexSha256;
    };

export type BootstrapPayloadSourceV1 =
  | {
      readonly kind: "guarded_package_file";
      readonly packageRoot: CanonicalAbsolutePathV1;
      readonly packageRootDev: UInt64DecimalV1;
      readonly packageRootIno: UInt64DecimalV1;
      readonly packageInventoryHash: LowerHexSha256;
      readonly relativePath: VaultFreeRelativePathV1;
      readonly sourceBytes: number;
      readonly sourceHash: LowerHexSha256;
      readonly sourceMode: 0o600 | 0o700;
      readonly sourceDev: UInt64DecimalV1;
      readonly sourceIno: UInt64DecimalV1;
    }
  | {
      readonly kind: "plan_derived";
      readonly role:
        | "manifest_after"
        | "foundation_initial_journal"
        | "foundation_config"
        | "foundation_staged_digest"
        | "lifecycle_nonce"
        | "lifecycle_allocator"
        | "active_release"
        | "release_trust";
      readonly value: CanonicalJsonValue;
      readonly valueBytes: number;
      readonly projectionHash: LowerHexSha256;
    }
  | {
      readonly kind: "guarded_migration_preimage";
      readonly authority: BootstrapMigrationPreimageAuthorityV1;
      readonly path: CanonicalAbsolutePathV1;
      readonly ownerUid: number;
      readonly mode: 0o600 | 0o700;
      readonly nlink: 1;
      readonly bytes: number;
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "constant_empty";
      readonly role: "empty_reservation";
    };

export interface BootstrapPayloadPlanV1 {
  readonly ref: BootstrapExpectedPayloadRefV1;
  readonly source: BootstrapPayloadSourceV1;
}

export interface BootstrapPayloadEvidenceV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: number;
  readonly stagedPathHash: LowerHexSha256;
  readonly sourceIdentityHash: LowerHexSha256;
  readonly bytes: number;
  readonly sha256: LowerHexSha256;
  readonly mode: 0o600 | 0o700;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type BootstrapPayloadWriteStateV1 =
  | { readonly state: "idle" }
  | { readonly state: "create_intent"; readonly ordinal: number }
  | {
      readonly state: "writing";
      readonly ordinal: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

export type BootstrapPlannedParentV1 =
  | {
      readonly kind: "preexisting";
      readonly path: CanonicalAbsolutePathV1;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "created_path";
      readonly scope: "ordinary" | "launchability";
      readonly ordinal: number;
    };

export type PlannedCreatedPathV1 =
  | {
      readonly kind: "directory";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: number;
      readonly mode: 0o700;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "remove_on_compensation";
    }
  | {
      readonly kind: "global_lock";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: number;
      readonly mode: 0o600;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "remove_on_compensation";
    }
  | {
      readonly kind: "file";
      readonly path: CanonicalAbsolutePathV1;
      readonly expectedBefore: "absent";
      readonly ownerUid: number;
      readonly payload: BootstrapExpectedPayloadRefV1;
      readonly parent: BootstrapPlannedParentV1;
      readonly cleanup: "remove_on_compensation";
    };

export interface CreatedPathEvidenceV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly scope: "ordinary" | "launchability";
  readonly ordinal: number;
  readonly pathHash: LowerHexSha256;
  readonly kind: "file" | "directory" | "global_lock";
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly postimageHash: LowerHexSha256 | null;
}

export interface FoundationMutationRefV1 {
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: LowerHexSha256 | null;
  readonly contentHash: LowerHexSha256 | null;
  readonly contentSize: number | null;
  readonly stagedPath: CanonicalAbsolutePathV1 | null;
  /** Required by the admitted V1 grammar; optional only for source compatibility with pre-Task-7 structural fixtures. */
  readonly content?: BootstrapExpectedPayloadRefV1 | null;
  /** Required by the admitted V1 grammar; optional only for source compatibility with pre-Task-7 structural fixtures. */
  readonly digest?: BootstrapExpectedPayloadRefV1 | null;
}

export type FoundationParticipantSlotV2 =
  | "fresh_init_artifacts"
  | "v1_migration_artifacts"
  | "owner_forward_files"
  | "owner_inverse_files"
  | "schema_forward"
  | "schema_inverse";

export type FoundationTransactionIdV2 =
  | `tx_fi_${string}_${string}_${"f" | "c"}`
  | `tx_mm_${string}_${string}_${"f" | "c"}`;

export interface FoundationParticipantRefV2 {
  readonly id: FoundationTransactionIdV2;
  readonly slot: FoundationParticipantSlotV2;
  readonly role:
    | { readonly kind: "forward"; readonly compensationId: FoundationTransactionIdV2 | null }
    | { readonly kind: "compensation"; readonly forwardId: FoundationTransactionIdV2 };
  readonly mutations: readonly FoundationMutationRefV1[];
  readonly maximumJournalBytes: number;
  readonly planHash: LowerHexSha256;
  readonly initialJournal: {
    readonly finalPath: CanonicalAbsolutePathV1;
    readonly plannedBytesHash: LowerHexSha256;
    readonly staged: BootstrapExpectedPayloadRefV1;
  };
}

interface BootstrapPlanCommonV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly v2ManifestHash: LowerHexSha256;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
  readonly maximumStagingEntries: number;
  readonly payloads: readonly BootstrapPayloadPlanV1[];
  readonly createdPaths: readonly PlannedCreatedPathV1[];
  readonly foundationParticipants: readonly FoundationParticipantRefV2[];
  readonly launchabilityPaths: readonly PlannedCreatedPathV1[];
  readonly manifest: ManifestStatePlanV1;
}

interface PersistedBootstrapJournalSlotIdentityV1 {
  readonly slot: 0 | 1;
  readonly path: ExactProductStatePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface FreshV2InitPlanV1 extends BootstrapPlanCommonV1 {
  readonly operation: "fresh_v2_init";
  readonly id: FreshV2InitIdV1;
  readonly admittedExternalShapeHash: LowerHexSha256;
  /**
   * Retained residue and reusable directories observed under the held lock
   * before this plan was published. Persisted because a later process that
   * resumes the plan has no memory of the preflight, and the post-plan shape
   * check needs the exact set of names that may legally exist beside it.
   */
  readonly admittedPreexistingPaths: readonly CanonicalAbsolutePathV1[];
  readonly planPath: ExactProductStatePathV1;
  readonly journalSlots: readonly [
    PersistedBootstrapJournalSlotIdentityV1,
    PersistedBootstrapJournalSlotIdentityV1,
  ];
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

export interface ManifestMigrationPathsV1 {
  readonly plan: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

export interface ManifestMigrationPlanV1 extends BootstrapPlanCommonV1 {
  readonly operation: "v1_to_v2";
  readonly id: ManifestMigrationIdV1;
  readonly v1ManifestHash: LowerHexSha256;
  readonly paths: ManifestMigrationPathsV1;
  readonly journalSlots: readonly [
    PersistedBootstrapJournalSlotIdentityV1,
    PersistedBootstrapJournalSlotIdentityV1,
  ];
}

export type BootstrapExecutionPlanV1 = FreshV2InitPlanV1 | ManifestMigrationPlanV1;

export type BootstrapJournalPhaseV1 =
  | "planned"
  | "payload_staging"
  | "creating"
  | "foundation_applying"
  | "launchability_publishing"
  | "manifest_publishing"
  | "verifying"
  | "compensating"
  | "finalized"
  | "rolled_back"
  | "retaining"
  | "retained";

export interface BootstrapRetentionTerminalPreimageV1 {
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly updatedAt: UtcTimestampV1;
}

interface BootstrapJournalCommonV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planHash: LowerHexSha256;
  readonly slot: 0 | 1;
  readonly sequence: UInt64DecimalV1;
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly phase: BootstrapJournalPhaseV1;
  readonly direction: "forward" | "compensating";
  readonly nextPayload: number;
  readonly payloadWriteState: BootstrapPayloadWriteStateV1;
  readonly nextCreatedPath: number;
  readonly nextFoundationParticipant: number;
  readonly nextLaunchabilityPath: number;
  readonly manifestCursor: number;
  readonly compensationNext: number | null;
  readonly payloadRetentionPart: "staged_file" | "evidence" | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly retentionNext: number | null;
  readonly retentionTerminalPreimage?: BootstrapRetentionTerminalPreimageV1;
  readonly createdAt: UtcTimestampV1;
  readonly updatedAt: UtcTimestampV1;
}

export interface FreshV2InitJournalV1 extends BootstrapJournalCommonV1 {
  readonly id: FreshV2InitIdV1;
}

export interface ManifestMigrationJournalV1 extends BootstrapJournalCommonV1 {
  readonly id: ManifestMigrationIdV1;
}

export interface BootstrapPlanAdmissionContextV1 {
  readonly evidence: CanonicalPathEvidenceV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly stateRoot: CanonicalAbsolutePathV1;
  readonly productStagingRoot: CanonicalAbsolutePathV1;
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly externalShape: BootstrapExternalShapeProjectionV1 | null;
  /**
   * Recovery-only authority issued after a bounded closure inventory proves the
   * immutable plan's exact forward prefix. Initial planning must supply the
   * complete observed projection instead.
   */
  readonly admitFreshRecoveryExternalShape?: (
    hash: LowerHexSha256,
    bootstrapIdentity: PersistedBootstrapLockIdentityV1,
  ) => string;
  readonly admitPayloadSource: (
    source: BootstrapPayloadSourceV1,
    ref: BootstrapExpectedPayloadRefV1,
  ) => BootstrapPayloadSourceV1;
  readonly admitPlannedCreatedPath: (
    value: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ) => PlannedCreatedPathV1;
  readonly admitPreexistingParent: (
    value: Extract<BootstrapPlannedParentV1, { readonly kind: "preexisting" }>,
  ) => Extract<BootstrapPlannedParentV1, { readonly kind: "preexisting" }>;
  readonly admitFoundationParticipant: (
    value: FoundationParticipantRefV2,
  ) => FoundationParticipantRefV2;
  readonly admitManifestParticipant: (value: ManifestStatePlanV1) => ManifestStatePlanV1;
  readonly admitPlanDerivedValue: (
    role: Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }>["role"],
    value: CanonicalJsonValue,
  ) => CanonicalJsonValue;
}

function refuse(message?: string): never {
  throw new BootstrapStateError(message);
}

function normalizeFailure(error: unknown): never {
  if (error instanceof BootstrapStateError) throw error;
  return refuse();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse();
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return refuse();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) return refuse();
  return value;
}

function uid(value: unknown): number {
  return integer(value, 0, Number.MAX_SAFE_INTEGER);
}

function uint64(value: unknown): UInt64DecimalV1 {
  try {
    return parseUInt64Decimal(value);
  } catch {
    return refuse();
  }
}

function sha256(value: unknown): LowerHexSha256 {
  try {
    return parseLowerHexSha256(value);
  } catch {
    return refuse();
  }
}

function timestamp(value: unknown): UtcTimestampV1 {
  try {
    return parseUtcTimestamp(value);
  } catch {
    return refuse();
  }
}

function rawHash(value: string | Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

function canonicalNoLf(value: CanonicalJsonValue): string {
  const encoded = encodeCanonicalJson(value);
  if (!encoded.endsWith("\n")) return refuse();
  return encoded.slice(0, -1);
}

function canonicalHash(domain: string, value: CanonicalJsonValue): LowerHexSha256 {
  return createHash("sha256")
    .update(domain)
    .update(canonicalNoLf(value))
    .digest("hex") as LowerHexSha256;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function retainedClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return refuse();
  }
}

function admitEqualValue<T>(value: T, callback: (candidate: T) => T): T {
  const snapshot = retainedClone(value);
  const admitted = callback(retainedClone(snapshot));
  if (!jsonEqual(admitted, snapshot)) return refuse();
  return snapshot;
}

function validateUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4_RE.test(value)) return refuse();
  return value;
}

function operationId(
  operation: "fresh_v2_init" | "v1_to_v2",
  value: unknown,
): FreshV2InitIdV1 | ManifestMigrationIdV1 {
  if (typeof value !== "string") return refuse();
  if (operation === "fresh_v2_init") {
    if (FRESH_ID_RE.exec(value) === null) return refuse();
    return value as FreshV2InitIdV1;
  }
  if (MIGRATION_ID_RE.exec(value) === null) return refuse();
  return value as ManifestMigrationIdV1;
}

function deriveAbsolute(productHome: CanonicalAbsolutePathV1, relative: string): CanonicalAbsolutePathV1 {
  return `${productHome}/${relative}` as CanonicalAbsolutePathV1;
}

export function validateBootstrapFoundationOrdinal(value: unknown):
  | { readonly ok: true; readonly ordinal: number }
  | { readonly ok: false } {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < MAX_FOUNDATION_FORWARD_PARTICIPANTS
    ? { ok: true, ordinal: value }
    : { ok: false };
}

export function deriveBootstrapEnvelopePaths(
  productHome: CanonicalAbsolutePathV1,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
): {
  readonly plan: ExactProductStatePathV1;
  readonly journalSlots: readonly [ExactProductStatePathV1, ExactProductStatePathV1];
  readonly stagingRoot: CanonicalAbsolutePathV1;
} {
  const admittedId = operationId(operation, id);
  const prefix = operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration";
  return {
    plan: deriveAbsolute(productHome, `state/${prefix}.${admittedId}.plan.json`) as ExactProductStatePathV1,
    journalSlots: [0, 1].map((slot) =>
      deriveAbsolute(productHome, `state/${prefix}.${admittedId}.journal.${String(slot)}.json`) as ExactProductStatePathV1,
    ) as unknown as readonly [ExactProductStatePathV1, ExactProductStatePathV1],
    stagingRoot: deriveAbsolute(productHome, `staging/${prefix}/${admittedId}`),
  };
}

export function deriveBootstrapPayloadEvidencePaths(
  payloadPath: BootstrapPayloadPathV1,
  temporaryUuid: string,
): { readonly evidence: CanonicalAbsolutePathV1; readonly temporary: CanonicalAbsolutePathV1 } {
  validateUuid(temporaryUuid);
  if (!payloadPath.endsWith(".payload")) return refuse();
  const evidence = `${payloadPath}.json` as CanonicalAbsolutePathV1;
  return { evidence, temporary: `${evidence}.${temporaryUuid}.tmp` as CanonicalAbsolutePathV1 };
}

export function deriveBootstrapCreationEvidencePaths(
  productHome: CanonicalAbsolutePathV1,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  scope: "ordinary" | "launchability",
  ordinal: number,
  temporaryUuid: string,
): { readonly evidence: CanonicalAbsolutePathV1; readonly temporary: CanonicalAbsolutePathV1 } {
  const admittedId = operationId(operation, id);
  integer(ordinal, 0, MAX_BOOTSTRAP_ORDINAL);
  validateUuid(temporaryUuid);
  const prefix = operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration";
  const evidence = deriveAbsolute(
    productHome,
    `state/.${prefix}.${admittedId}.${scope}.${String(ordinal).padStart(10, "0")}.creation.json`,
  );
  return { evidence, temporary: `${evidence}.${temporaryUuid}.tmp` as CanonicalAbsolutePathV1 };
}

export function validateBootstrapExternalShapeProjection(
  value: unknown,
): BootstrapExternalShapeProjectionV1 {
  try {
    const input = record(value);
    exact(input, ["entries"]);
    if (!Array.isArray(input.entries) || input.entries.length !== 3) return refuse();
    const expected = [
      { role: "product_home", kind: "directory", mode: 0o700 },
      { role: "state_directory", kind: "directory", mode: 0o700 },
      { role: "bootstrap_lock", kind: "regular_file", mode: 0o600 },
    ] as const;
    const entries = input.entries.map((candidate, index): BootstrapExternalShapeEntryV1 => {
      const row = record(candidate);
      exact(row, ["dev", "ino", "kind", "mode", "nlink", "ownerUid", "pathHash", "role", "size"]);
      const requirement = expected[index];
      if (
        requirement === undefined ||
        row.role !== requirement.role ||
        row.kind !== requirement.kind ||
        row.mode !== requirement.mode
      ) return refuse();
      const nlink = integer(row.nlink, 1, 4_294_967_295);
      const size = uint64(row.size);
      if (requirement.role === "bootstrap_lock" && (nlink !== 1 || size !== "0")) return refuse();
      return {
        role: requirement.role,
        pathHash: sha256(row.pathHash),
        kind: requirement.kind,
        ownerUid: uid(row.ownerUid),
        mode: requirement.mode,
        nlink,
        size,
        dev: uint64(row.dev),
        ino: uint64(row.ino),
      };
    });
    return structuredClone({ entries }) as unknown as BootstrapExternalShapeProjectionV1;
  } catch (error) {
    return normalizeFailure(error);
  }
}

export function bootstrapExternalShapeHash(
  projection: BootstrapExternalShapeProjectionV1,
): LowerHexSha256 {
  const admitted = validateBootstrapExternalShapeProjection(projection);
  return canonicalHash("developer-os/fresh-v2-external-shape/v1\0", admitted as unknown as CanonicalJsonValue);
}

export function bootstrapPayloadSourceIdentityHash(source: BootstrapPayloadSourceV1): LowerHexSha256 {
  return canonicalHash("developer-os/bootstrap-payload-source/v1\0", source);
}

export function validateBootstrapPayloadEvidence(
  value: unknown,
  ref: BootstrapExpectedPayloadRefV1,
  source: BootstrapPayloadSourceV1,
): BootstrapPayloadEvidenceV1 {
  try {
    const input = record(value);
    exact(input, [
      "bootstrapId",
      "bytes",
      "dev",
      "ino",
      "mode",
      "ordinal",
      "schemaVersion",
      "sha256",
      "sourceIdentityHash",
      "stagedPathHash",
    ]);
    if (
      input.schemaVersion !== 1 ||
      input.bootstrapId !== ref.bootstrapId ||
      input.ordinal !== ref.ordinal ||
      input.bytes !== ref.bytes ||
      input.sha256 !== ref.hash ||
      input.mode !== ref.mode ||
      input.stagedPathHash !== rawHash(ref.path) ||
      input.sourceIdentityHash !== bootstrapPayloadSourceIdentityHash(source)
    ) return refuse();
    return {
      schemaVersion: 1,
      bootstrapId: ref.bootstrapId,
      ordinal: integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL),
      stagedPathHash: sha256(input.stagedPathHash),
      sourceIdentityHash: sha256(input.sourceIdentityHash),
      bytes: integer(input.bytes, 0, MAX_PAYLOAD_BYTES),
      sha256: sha256(input.sha256),
      mode: input.mode === 0o600 || input.mode === 0o700 ? input.mode : refuse(),
      dev: uint64(input.dev),
      ino: uint64(input.ino),
    };
  } catch (error) {
    return normalizeFailure(error);
  }
}

export function validateCreatedPathEvidence(
  value: unknown,
  planned: PlannedCreatedPathV1,
  bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1,
  scope: "ordinary" | "launchability",
  ordinal: number,
): CreatedPathEvidenceV1 {
  try {
    const input = record(value);
    exact(input, [
      "bootstrapId",
      "dev",
      "ino",
      "kind",
      "ordinal",
      "pathHash",
      "postimageHash",
      "schemaVersion",
      "scope",
    ]);
    const expectedPostimage = planned.kind === "file"
      ? planned.payload.hash
      : planned.kind === "global_lock"
        ? EMPTY_SHA256
        : null;
    if (
      input.schemaVersion !== 1 ||
      input.bootstrapId !== bootstrapId ||
      input.scope !== scope ||
      input.ordinal !== ordinal ||
      input.pathHash !== rawHash(planned.path) ||
      input.kind !== planned.kind ||
      input.postimageHash !== expectedPostimage
    ) return refuse();
    return {
      schemaVersion: 1,
      bootstrapId,
      scope,
      ordinal: integer(ordinal, 0, MAX_BOOTSTRAP_ORDINAL),
      pathHash: sha256(input.pathHash),
      kind: planned.kind,
      dev: uint64(input.dev),
      ino: uint64(input.ino),
      postimageHash: input.postimageHash === null ? null : sha256(input.postimageHash),
    };
  } catch (error) {
    return normalizeFailure(error);
  }
}

function validatePayloadWriteState(
  value: unknown,
  nextPayload: number,
  payloadCount: number,
): BootstrapPayloadWriteStateV1 {
  const input = record(value);
  if (input.state === "idle") {
    exact(input, ["state"]);
    return { state: "idle" };
  }
  if (input.state === "create_intent") {
    exact(input, ["ordinal", "state"]);
    const ordinal = integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL);
    if (ordinal !== nextPayload || nextPayload >= payloadCount) return refuse();
    return { state: "create_intent", ordinal };
  }
  if (input.state === "writing") {
    exact(input, ["dev", "ino", "ordinal", "state"]);
    const ordinal = integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL);
    if (ordinal !== nextPayload || nextPayload >= payloadCount) return refuse();
    return { state: "writing", ordinal, dev: uint64(input.dev), ino: uint64(input.ino) };
  }
  return refuse();
}

/**
 * Keyed on the plan object, which is immutable once validated. Init validates a
 * journal on every write and each validation re-encoded the entire plan, so this
 * was the dominant cost of `developer-os init`. A plan that is not the same
 * object is hashed again, so nothing is trusted across identities.
 */
const planHashes = new WeakMap<object, LowerHexSha256>();

function planHash(plan: BootstrapExecutionPlanV1): LowerHexSha256 {
  const key = plan as unknown as object;
  const cached = planHashes.get(key);
  if (cached !== undefined) return cached;
  const computed = rawHash(encodeCanonicalJson(plan as unknown as CanonicalJsonValue));
  planHashes.set(key, computed);
  return computed;
}

function isCompleteBefore(
  journal: BootstrapJournalCommonV1,
  counts: { readonly payloads: number; readonly created: number; readonly foundation: number; readonly launchability: number },
  stage: "created" | "foundation" | "launchability" | "manifest",
): boolean {
  if (journal.nextPayload !== counts.payloads) return false;
  if (stage === "created") return true;
  if (journal.nextCreatedPath !== counts.created) return false;
  if (stage === "foundation") return true;
  if (journal.nextFoundationParticipant !== counts.foundation) return false;
  if (stage === "launchability") return true;
  return journal.nextLaunchabilityPath === counts.launchability;
}

function hasForwardPrefix(
  journal: BootstrapJournalCommonV1,
  counts: { readonly payloads: number; readonly created: number; readonly foundation: number; readonly launchability: number },
): boolean {
  if (journal.manifestCursor > 0) {
    return isCompleteBefore(journal, counts, "manifest");
  }
  if (journal.nextLaunchabilityPath > 0) {
    return isCompleteBefore(journal, counts, "launchability");
  }
  if (journal.nextFoundationParticipant > 0) {
    return isCompleteBefore(journal, counts, "foundation") && journal.nextLaunchabilityPath === 0;
  }
  if (journal.nextCreatedPath > 0) {
    return isCompleteBefore(journal, counts, "created") && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0;
  }
  return journal.nextPayload <= counts.payloads && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0;
}

function reachedReversibleStepCount(
  journal: BootstrapJournalCommonV1,
): number {
  return (
    journal.nextPayload +
    (journal.payloadWriteState.state === "idle" ? 0 : 1) +
    journal.nextCreatedPath +
    journal.nextFoundationParticipant +
    journal.nextLaunchabilityPath +
    Math.min(journal.manifestCursor, 1)
  );
}

function validateJournalTable(
  journal: BootstrapJournalCommonV1,
  counts: { readonly payloads: number; readonly created: number; readonly foundation: number; readonly launchability: number },
): void {
  const retentionPhase = journal.phase === "retaining" || journal.phase === "retained";
  if (retentionPhase !== (journal.retentionTerminalPreimage !== undefined)) refuse();
  const idle = journal.payloadWriteState.state === "idle";
  const noCompensation = journal.compensationNext === null && journal.payloadRetentionPart === null;
  const noTerminal = journal.terminalOutcome === null && journal.retentionNext === null;
  const allComplete =
    journal.nextPayload === counts.payloads &&
    journal.nextCreatedPath === counts.created &&
    journal.nextFoundationParticipant === counts.foundation &&
    journal.nextLaunchabilityPath === counts.launchability;

  switch (journal.phase) {
    case "planned":
      if (!(journal.direction === "forward" && journal.nextPayload === 0 && idle && journal.nextCreatedPath === 0 && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) refuse();
      return;
    case "payload_staging":
      if (!(journal.direction === "forward" && journal.nextCreatedPath === 0 && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) refuse();
      return;
    case "creating":
      if (!(journal.direction === "forward" && idle && journal.nextPayload === counts.payloads && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) refuse();
      return;
    case "foundation_applying":
      if (!(journal.direction === "forward" && idle && isCompleteBefore(journal, counts, "foundation") && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) refuse();
      return;
    case "launchability_publishing":
      if (!(journal.direction === "forward" && idle && isCompleteBefore(journal, counts, "launchability") && journal.manifestCursor === 0 && noCompensation && noTerminal)) refuse();
      return;
    case "manifest_publishing":
      if (!(journal.direction === "forward" && idle && isCompleteBefore(journal, counts, "manifest") && journal.manifestCursor <= 2 && noCompensation && noTerminal)) refuse();
      return;
    case "verifying":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor >= 2 && journal.manifestCursor <= 3 && noCompensation && noTerminal)) refuse();
      return;
    case "compensating":
      if (!(journal.direction === "compensating" && journal.manifestCursor < 2 && journal.compensationNext !== null && journal.compensationNext >= -1 && hasForwardPrefix(journal, counts) && journal.terminalOutcome === null && journal.retentionNext === null)) refuse();
      if (journal.compensationNext >= reachedReversibleStepCount(journal)) refuse();
      if (
        journal.payloadWriteState.state !== "idle" &&
        journal.compensationNext !== journal.nextPayload &&
        !(journal.payloadWriteState.state === "writing" && journal.compensationNext === -1)
      ) refuse();
      if (journal.payloadRetentionPart !== null && (journal.compensationNext < 0 || journal.compensationNext >= counts.payloads)) refuse();
      return;
    case "rolled_back":
      if (!(journal.direction === "compensating" && journal.payloadWriteState.state !== "create_intent" && journal.manifestCursor < 2 && journal.compensationNext === -1 && journal.payloadRetentionPart === null && journal.terminalOutcome === "rolled_back" && journal.retentionNext === null && hasForwardPrefix(journal, counts))) refuse();
      return;
    case "finalized":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor === 3 && noCompensation && journal.terminalOutcome === "finalized" && journal.retentionNext === null)) refuse();
      return;
    case "retaining":
    case "retained": {
      const terminalDirection = journal.terminalOutcome === "finalized" ? "forward" : "compensating";
      const retainedPayloadState = idle ||
        (journal.terminalOutcome === "rolled_back" && journal.payloadWriteState.state === "writing");
      if (!(retainedPayloadState && journal.direction === terminalDirection && journal.terminalOutcome !== null && journal.retentionNext !== null && journal.payloadRetentionPart === null)) refuse();
      if (journal.terminalOutcome === "finalized" && !(allComplete && journal.manifestCursor === 3 && journal.compensationNext === null)) refuse();
      if (journal.terminalOutcome === "rolled_back" && !(journal.manifestCursor < 2 && journal.compensationNext === -1 && hasForwardPrefix(journal, counts))) refuse();
      return;
    }
  }
}

export function validateBootstrapJournal(
  plan: BootstrapExecutionPlanV1,
  value: unknown,
): FreshV2InitJournalV1 | ManifestMigrationJournalV1 {
  try {
    const input = record(value);
    const retentionPhase = input.phase === "retaining" || input.phase === "retained";
    const journalKeys = [
      "compensationNext",
      "createdAt",
      "direction",
      "id",
      "manifestCursor",
      "nextCreatedPath",
      "nextFoundationParticipant",
      "nextLaunchabilityPath",
      "nextPayload",
      "payloadRetentionPart",
      "payloadWriteState",
      "phase",
      "planHash",
      "previousJournalHash",
      "retentionNext",
      "schemaVersion",
      "sequence",
      "slot",
      "terminalOutcome",
      "updatedAt",
    ] as const;
    exact(input, retentionPhase
      ? [...journalKeys, "retentionTerminalPreimage"]
      : journalKeys);
    if (input.schemaVersion !== 1 || input.id !== plan.id || input.planHash !== planHash(plan)) return refuse();
    const phases: readonly BootstrapJournalPhaseV1[] = ["planned", "payload_staging", "creating", "foundation_applying", "launchability_publishing", "manifest_publishing", "verifying", "compensating", "finalized", "rolled_back", "retaining", "retained"];
    if (typeof input.phase !== "string" || !phases.includes(input.phase as BootstrapJournalPhaseV1)) return refuse();
    if (input.direction !== "forward" && input.direction !== "compensating") return refuse();
    if (input.payloadRetentionPart !== null && input.payloadRetentionPart !== "staged_file" && input.payloadRetentionPart !== "evidence") return refuse();
    if (input.terminalOutcome !== null && input.terminalOutcome !== "finalized" && input.terminalOutcome !== "rolled_back") return refuse();
    if (input.slot !== 0 && input.slot !== 1) return refuse();
    const sequence = uint64(input.sequence);
    const previousJournalHash = input.previousJournalHash === null ? null : sha256(input.previousJournalHash);
    if ((sequence === "0") !== (previousJournalHash === null) || input.slot !== Number(BigInt(sequence) % 2n)) return refuse();
    const forwardCount = plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length;
    const nextPayload = integer(input.nextPayload, 0, Math.min(MAX_STAGING_ENTRIES, plan.payloads.length));
    const payloadWriteState = validatePayloadWriteState(input.payloadWriteState, nextPayload, plan.payloads.length);
    const retentionTerminalPreimage = retentionPhase
      ? (() => {
          const preimage = record(input.retentionTerminalPreimage);
          exact(preimage, ["previousJournalHash", "updatedAt"]);
          return {
            previousJournalHash: preimage.previousJournalHash === null
              ? null
              : sha256(preimage.previousJournalHash),
            updatedAt: timestamp(preimage.updatedAt),
          } satisfies BootstrapRetentionTerminalPreimageV1;
        })()
      : undefined;
    const journal: BootstrapJournalCommonV1 = {
      schemaVersion: 1,
      id: plan.id,
      planHash: sha256(input.planHash),
      slot: input.slot,
      sequence,
      previousJournalHash,
      phase: input.phase as BootstrapJournalPhaseV1,
      direction: input.direction,
      nextPayload,
      payloadWriteState,
      nextCreatedPath: integer(input.nextCreatedPath, 0, Math.min(MAX_CREATED_PATHS, plan.createdPaths.length)),
      nextFoundationParticipant: integer(input.nextFoundationParticipant, 0, Math.min(MAX_FOUNDATION_FORWARD_PARTICIPANTS, forwardCount)),
      nextLaunchabilityPath: integer(input.nextLaunchabilityPath, 0, Math.min(MAX_LAUNCHABILITY_PATHS, plan.launchabilityPaths.length)),
      manifestCursor: integer(input.manifestCursor, 0, 3),
      compensationNext: input.compensationNext === null ? null : integer(input.compensationNext, -1, MAX_COMPENSATION_NEXT),
      payloadRetentionPart: input.payloadRetentionPart,
      terminalOutcome: input.terminalOutcome,
      retentionNext:
        input.retentionNext === null
          ? null
          : integer(input.retentionNext, 0, MAX_RETENTION_NEXT),
      ...(retentionTerminalPreimage === undefined ? {} : { retentionTerminalPreimage }),
      createdAt: timestamp(input.createdAt),
      updatedAt: timestamp(input.updatedAt),
    };
    validateJournalTable(journal, { payloads: plan.payloads.length, created: plan.createdPaths.length, foundation: forwardCount, launchability: plan.launchabilityPaths.length });
    if (sequence === "0" && journal.phase !== "planned") return refuse();
    if (encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)).byteLength > plan.maximumJournalBytes) return refuse();
    return structuredClone(journal) as FreshV2InitJournalV1 | ManifestMigrationJournalV1;
  } catch (error) {
    return normalizeFailure(error);
  }
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
  }
  return a.length - b.length;
}

function validateBootstrapIdentity(
  value: unknown,
  context: BootstrapPlanAdmissionContextV1,
): PersistedBootstrapLockIdentityV1 {
  const input = record(value);
  exact(input, ["dev", "ino", "mode", "nlink", "ownerUid", "path", "size"]);
  const path = admitCanonicalAbsolutePath(input.path, context.evidence);
  const identity: PersistedBootstrapLockIdentityV1 = {
    path,
    ownerUid: uid(input.ownerUid),
    mode: input.mode === 0o600 ? 0o600 : refuse(),
    nlink: input.nlink === 1 ? 1 : refuse(),
    size: input.size === 0 ? 0 : refuse(),
    dev: uint64(input.dev),
    ino: uint64(input.ino),
  };
  if (identity.path !== `${context.stateRoot}/.lifecycle-bootstrap.lock` || !jsonEqual(identity, context.bootstrapIdentity)) return refuse();
  return identity;
}

function validateJournalSlots(
  value: unknown,
  expectedPaths: readonly [ExactProductStatePathV1, ExactProductStatePathV1],
  context: BootstrapPlanAdmissionContextV1,
): readonly [PersistedBootstrapJournalSlotIdentityV1, PersistedBootstrapJournalSlotIdentityV1] {
  if (!Array.isArray(value) || value.length !== 2) return refuse();
  const identities = new Set<string>();
  const slots = ([0, 1] as const).map((expectedSlot) => {
    const input = record(value[expectedSlot]);
    exact(input, ["dev", "ino", "mode", "nlink", "ownerUid", "path", "slot"]);
    const path = admitCanonicalAbsolutePath(input.path, context.evidence);
    const dev = uint64(input.dev);
    const ino = uint64(input.ino);
    if (
      input.slot !== expectedSlot ||
      path !== expectedPaths[expectedSlot] ||
      input.ownerUid !== context.bootstrapIdentity.ownerUid ||
      input.mode !== 0o600 ||
      input.nlink !== 1 ||
      identities.has(`${dev}:${ino}`)
    ) return refuse();
    identities.add(`${dev}:${ino}`);
    return {
      slot: expectedSlot,
      path: path as ExactProductStatePathV1,
      ownerUid: uid(input.ownerUid),
      mode: 0o600 as const,
      nlink: 1 as const,
      dev,
      ino,
    };
  });
  return slots as unknown as readonly [
    PersistedBootstrapJournalSlotIdentityV1,
    PersistedBootstrapJournalSlotIdentityV1,
  ];
}

function validatePayloadRef(
  value: unknown,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  productHome: CanonicalAbsolutePathV1,
): BootstrapExpectedPayloadRefV1 {
  const input = record(value);
  exact(input, ["bootstrapId", "bytes", "hash", "kind", "mode", "ordinal", "path"]);
  if (input.kind !== "bootstrap_expected" || input.bootstrapId !== id || (input.mode !== 0o600 && input.mode !== 0o700)) return refuse();
  const ordinal = integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL);
  const path = input.path;
  if (typeof path !== "string" || path !== deriveBootstrapPayloadPath(productHome, operation, id as never, ordinal)) return refuse();
  return {
    kind: "bootstrap_expected",
    bootstrapId: id,
    ordinal,
    path: path as BootstrapPayloadPathV1,
    hash: sha256(input.hash),
    bytes: integer(input.bytes, 0, MAX_PAYLOAD_BYTES),
    mode: input.mode,
  };
}

function validateMigrationAuthority(
  value: unknown,
  migrationId: ManifestMigrationIdV1,
  v1ManifestHash: LowerHexSha256,
): BootstrapMigrationPreimageAuthorityV1 {
  const input = record(value);
  if (input.kind === "v1_manifest") {
    exact(input, ["kind", "migrationId", "v1ManifestHash"]);
    if (input.migrationId !== migrationId || input.v1ManifestHash !== v1ManifestHash) return refuse();
    return { kind: "v1_manifest", migrationId, v1ManifestHash };
  }
  if (input.kind === "v1_managed_artifact") {
    exact(input, ["artifactOrdinal", "installedHash", "kind", "migrationId"]);
    if (input.migrationId !== migrationId) return refuse();
    return {
      kind: "v1_managed_artifact",
      migrationId,
      artifactOrdinal: integer(input.artifactOrdinal, 0, MAX_BOOTSTRAP_ORDINAL),
      installedHash: sha256(input.installedHash),
    };
  }
  if (input.kind === "v1_backup_artifact") {
    exact(input, ["artifactOrdinal", "beforeHash", "kind", "migrationId"]);
    if (input.migrationId !== migrationId) return refuse();
    return {
      kind: "v1_backup_artifact",
      migrationId,
      artifactOrdinal: integer(input.artifactOrdinal, 0, MAX_BOOTSTRAP_ORDINAL),
      beforeHash: sha256(input.beforeHash),
    };
  }
  return refuse();
}

function validateFoundationJournalValue(
  value: CanonicalJsonValue,
  participant: Pick<FoundationParticipantRefV2, "id" | "slot" | "mutations">,
): { readonly value: CanonicalJsonValue; readonly bytes: Uint8Array } {
  const input = record(value);
  exact(input, ["createdAt", "id", "kind", "mutations", "phase", "schemaVersion", "updatedAt"]);
  if (
    input.schemaVersion !== 1 ||
    input.id !== participant.id ||
    input.kind !== participant.slot ||
    input.phase !== "planned" ||
    input.createdAt !== input.updatedAt ||
    !Array.isArray(input.mutations) ||
    input.mutations.length !== participant.mutations.length
  ) return refuse();
  const createdAt = timestamp(input.createdAt);
  const mutations = input.mutations.map((candidate, index) => {
    const row = record(candidate);
    exact(row, ["expectedBeforeHash", "operation", "stagedRelativePath", "targetPath"]);
    const planned = participant.mutations[index];
    if (planned === undefined) return refuse();
    const expectedStaged = planned.operation === "remove" ? null : `${String(index)}.bin`;
    if (
      row.targetPath !== planned.targetPath ||
      row.operation !== planned.operation ||
      row.expectedBeforeHash !== planned.expectedBeforeHash ||
      row.stagedRelativePath !== expectedStaged
    ) return refuse();
    return {
      targetPath: planned.targetPath,
      operation: planned.operation,
      expectedBeforeHash: planned.expectedBeforeHash,
      stagedRelativePath: expectedStaged,
    };
  });
  const cloned = {
    schemaVersion: 1,
    id: participant.id,
    kind: participant.slot,
    phase: "planned",
    createdAt,
    updatedAt: createdAt,
    mutations,
  } as const;
  return { value: cloned, bytes: encoder.encode(`${JSON.stringify(cloned)}\n`) };
}

function foundationJournalUnbound(value: CanonicalJsonValue): {
  readonly value: CanonicalJsonValue;
  readonly bytes: Uint8Array;
} {
  const input = record(value);
  exact(input, ["createdAt", "id", "kind", "mutations", "phase", "schemaVersion", "updatedAt"]);
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    !/^[A-Za-z0-9._-]+$/u.test(input.id) ||
    typeof input.kind !== "string" ||
    input.kind.length < 1 ||
    input.phase !== "planned" ||
    input.createdAt !== input.updatedAt ||
    !Array.isArray(input.mutations) ||
    input.mutations.length < 1 ||
    input.mutations.length > 256
  ) return refuse();
  const createdAt = timestamp(input.createdAt);
  const targets = new Set<string>();
  const mutations = input.mutations.map((candidate, index) => {
    const row = record(candidate);
    exact(row, ["expectedBeforeHash", "operation", "stagedRelativePath", "targetPath"]);
    if (
      typeof row.targetPath !== "string" ||
      !row.targetPath.startsWith("/") ||
      targets.has(row.targetPath) ||
      (row.operation !== "create" && row.operation !== "replace" && row.operation !== "remove")
    ) return refuse();
    targets.add(row.targetPath);
    const expectedBeforeHash = row.expectedBeforeHash === null ? null : sha256(row.expectedBeforeHash);
    const stagedRelativePath = row.operation === "remove" ? null : `${String(index)}.bin`;
    if (
      row.stagedRelativePath !== stagedRelativePath ||
      (row.operation === "create" ? expectedBeforeHash !== null : expectedBeforeHash === null)
    ) return refuse();
    return { targetPath: row.targetPath, operation: row.operation, expectedBeforeHash, stagedRelativePath };
  });
  const clone = {
    schemaVersion: 1,
    id: input.id,
    kind: input.kind,
    phase: "planned",
    createdAt,
    updatedAt: createdAt,
    mutations,
  } as const;
  return {
    value: clone,
    bytes: encoder.encode(`${JSON.stringify(clone)}\n`),
  };
}

function validatePlanDerivedSource(
  input: Record<string, unknown>,
  ref: BootstrapExpectedPayloadRefV1,
  operation: "fresh_v2_init" | "v1_to_v2",
  context: BootstrapPlanAdmissionContextV1,
): Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }> {
  exact(input, ["kind", "projectionHash", "role", "value", "valueBytes"]);
  const roles = ["manifest_after", "foundation_initial_journal", "foundation_config", "foundation_staged_digest", "lifecycle_nonce", "lifecycle_allocator", "active_release", "release_trust"] as const;
  if (typeof input.role !== "string" || !roles.includes(input.role as (typeof roles)[number])) return refuse();
  const role = input.role as (typeof roles)[number];
  let value = input.value as CanonicalJsonValue;
  let payloadBytes: Uint8Array;
  if (role === "foundation_config") {
    if (operation !== "fresh_v2_init") return refuse();
    try {
      payloadBytes = encoder.encode(serializeConfig(value as unknown as DeveloperOsConfigV1));
    } catch {
      return refuse();
    }
  } else if (role === "foundation_staged_digest") {
    const contentHash = sha256(value);
    value = contentHash;
    payloadBytes = encoder.encode(`${contentHash}\n`);
  } else if (role === "lifecycle_nonce") {
    const nonce = sha256(value);
    value = nonce;
    payloadBytes = encoder.encode(`${nonce}\n`);
  } else if (role === "lifecycle_allocator") {
    const allocator = record(value);
    exact(allocator, ["installNonce", "nextCounter", "schemaVersion"]);
    if (allocator.schemaVersion !== 1 || allocator.nextCounter !== "0") return refuse();
    value = {
      schemaVersion: 1,
      installNonce: sha256(allocator.installNonce),
      nextCounter: parseUInt64Decimal(allocator.nextCounter),
    };
    payloadBytes = encoder.encode(encodeCanonicalJson(value));
  } else if (role === "foundation_initial_journal") {
    const journal = foundationJournalUnbound(value);
    value = journal.value;
    payloadBytes = journal.bytes;
  } else {
    try {
      payloadBytes = encoder.encode(encodeCanonicalJson(value));
    } catch {
      return refuse();
    }
  }
  const valueBytes = integer(input.valueBytes, 1, MAX_PLAN_DERIVED_VALUE_BYTES);
  if (valueBytes !== payloadBytes.byteLength - 1 || ref.bytes !== payloadBytes.byteLength || ref.hash !== rawHash(payloadBytes)) return refuse();
  const projectionHash = sha256(input.projectionHash);
  if (projectionHash !== canonicalHash(`developer-os/bootstrap-plan-derived/${role}/v1\0`, { role, value })) return refuse();
  const retainedValue = admitEqualValue(value, (candidate) =>
    context.admitPlanDerivedValue(role, candidate),
  );
  return { kind: "plan_derived", role, value: retainedValue, valueBytes, projectionHash };
}

function validateRequiredPlanDerivedSources(
  payloads: readonly BootstrapPayloadPlanV1[],
  foundationParticipants: readonly FoundationParticipantRefV2[],
  operation: "fresh_v2_init" | "v1_to_v2",
  productHome: CanonicalAbsolutePathV1,
): void {
  const sources = payloads
    .map((row) => row.source)
    .filter(
      (source): source is Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }> =>
        source.kind === "plan_derived",
    );
  const count = (role: Extract<BootstrapPayloadSourceV1, { readonly kind: "plan_derived" }>['role']): number =>
    sources.filter((source) => source.role === role).length;
  if (
    count("manifest_after") !== 1 ||
    count("lifecycle_nonce") !== 1 ||
    count("lifecycle_allocator") !== 1 ||
    count("active_release") !== 1 ||
    count("release_trust") !== 1 ||
    count("foundation_initial_journal") !== foundationParticipants.length ||
    count("foundation_config") !== (operation === "fresh_v2_init" ? 1 : 0) ||
    count("foundation_staged_digest") !== foundationParticipants.reduce(
      (total, participant) =>
        total + participant.mutations.filter((mutation) => mutation.operation !== "remove").length,
      0,
    )
  ) return refuse();
  const nonce = sources.find((source) => source.role === "lifecycle_nonce");
  const allocator = sources.find((source) => source.role === "lifecycle_allocator");
  if (
    nonce === undefined ||
    allocator === undefined ||
    typeof nonce.value !== "string" ||
    !jsonEqual(
      allocator.value,
      { schemaVersion: 1, installNonce: nonce.value, nextCounter: "0" },
    )
  ) return refuse();

  const payloadByPath = new Map(payloads.map((row) => [row.ref.path, row] as const));
  let configMutations = 0;
  for (const participant of foundationParticipants) {
    for (const mutation of participant.mutations) {
      if (mutation.operation === "remove") continue;
      if (mutation.content == null || mutation.digest == null || mutation.contentHash === null) return refuse();
      const content = payloadByPath.get(mutation.content.path);
      const digest = payloadByPath.get(mutation.digest.path);
      if (
        content === undefined ||
        digest === undefined ||
        !jsonEqual(content.ref, mutation.content) ||
        !jsonEqual(digest.ref, mutation.digest) ||
        digest.source.kind !== "plan_derived" ||
        digest.source.role !== "foundation_staged_digest" ||
        digest.source.value !== mutation.contentHash
      ) return refuse();
      if (operation === "fresh_v2_init") {
        const isConfig = mutation.targetPath === `${productHome}/config.toml`;
        if (isConfig) configMutations += 1;
        if (
          (isConfig && (content.source.kind !== "plan_derived" || content.source.role !== "foundation_config")) ||
          (!isConfig && content.source.kind !== "guarded_package_file")
        ) return refuse();
      } else if (content.source.kind !== "guarded_migration_preimage") return refuse();
    }
  }
  if (operation === "fresh_v2_init" && configMutations !== 1) return refuse();
}

function validatePayloadSource(
  value: unknown,
  ref: BootstrapExpectedPayloadRefV1,
  plan: { readonly operation: "fresh_v2_init" | "v1_to_v2"; readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1; readonly v1ManifestHash?: LowerHexSha256 },
  context: BootstrapPlanAdmissionContextV1,
): BootstrapPayloadSourceV1 {
  const input = record(value);
  let source: BootstrapPayloadSourceV1;
  if (input.kind === "guarded_package_file") {
    exact(input, ["kind", "packageInventoryHash", "packageRoot", "packageRootDev", "packageRootIno", "relativePath", "sourceBytes", "sourceDev", "sourceHash", "sourceIno", "sourceMode"]);
    const packageRoot = admitCanonicalAbsolutePath(input.packageRoot, context.evidence);
    const relativePath = admitVaultFreeRelativePath(input.relativePath, packageRoot, context.evidence);
    const sourceBytes = integer(input.sourceBytes, 0, MAX_PAYLOAD_BYTES);
    const sourceHash = sha256(input.sourceHash);
    const sourceMode = input.sourceMode === 0o600 || input.sourceMode === 0o700 ? input.sourceMode : refuse();
    if (sourceBytes !== ref.bytes || sourceHash !== ref.hash || sourceMode !== ref.mode) return refuse();
    source = {
      kind: "guarded_package_file",
      packageRoot,
      packageRootDev: uint64(input.packageRootDev),
      packageRootIno: uint64(input.packageRootIno),
      packageInventoryHash: sha256(input.packageInventoryHash),
      relativePath,
      sourceBytes,
      sourceHash,
      sourceMode,
      sourceDev: uint64(input.sourceDev),
      sourceIno: uint64(input.sourceIno),
    };
  } else if (input.kind === "plan_derived") {
    source = validatePlanDerivedSource(input, ref, plan.operation, context);
  } else if (input.kind === "guarded_migration_preimage") {
    exact(input, ["authority", "bytes", "dev", "ino", "kind", "mode", "nlink", "ownerUid", "path", "sha256"]);
    if (plan.operation !== "v1_to_v2" || plan.v1ManifestHash === undefined || input.nlink !== 1) return refuse();
    const bytes = integer(input.bytes, 0, MAX_MIGRATION_PREIMAGE_BYTES);
    const contentHash = sha256(input.sha256);
    const mode = input.mode === 0o600 || input.mode === 0o700 ? input.mode : refuse();
    if (bytes !== ref.bytes || contentHash !== ref.hash || mode !== ref.mode) return refuse();
    source = {
      kind: "guarded_migration_preimage",
      authority: validateMigrationAuthority(input.authority, plan.id as ManifestMigrationIdV1, plan.v1ManifestHash),
      path: admitCanonicalAbsolutePath(input.path, context.evidence),
      ownerUid: uid(input.ownerUid),
      mode,
      nlink: 1,
      bytes,
      sha256: contentHash,
      dev: uint64(input.dev),
      ino: uint64(input.ino),
    };
  } else if (input.kind === "constant_empty") {
    exact(input, ["kind", "role"]);
    if (input.role !== "empty_reservation" || ref.bytes !== 0 || ref.hash !== EMPTY_SHA256) return refuse();
    source = { kind: "constant_empty", role: "empty_reservation" };
  } else {
    return refuse();
  }
  return admitEqualValue(source, (candidate) =>
    context.admitPayloadSource(candidate, retainedClone(ref)),
  );
}

function validateParent(
  value: unknown,
  context: BootstrapPlanAdmissionContextV1,
): BootstrapPlannedParentV1 {
  const input = record(value);
  if (input.kind === "preexisting") {
    exact(input, ["dev", "ino", "kind", "path"]);
    const parent = {
      kind: "preexisting" as const,
      path: admitCanonicalAbsolutePath(input.path, context.evidence),
      dev: uint64(input.dev),
      ino: uint64(input.ino),
    };
    return admitEqualValue(parent, (candidate) =>
      context.admitPreexistingParent(candidate),
    );
  }
  if (input.kind === "created_path") {
    exact(input, ["kind", "ordinal", "scope"]);
    if (input.scope !== "ordinary" && input.scope !== "launchability") return refuse();
    return { kind: "created_path", scope: input.scope, ordinal: integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL) };
  }
  return refuse();
}

function validateCreatedPath(
  value: unknown,
  scope: "ordinary" | "launchability",
  ordinal: number,
  context: BootstrapPlanAdmissionContextV1,
  bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1,
  operation: "fresh_v2_init" | "v1_to_v2",
): PlannedCreatedPathV1 {
  const input = record(value);
  let planned: PlannedCreatedPathV1;
  if (input.kind === "directory") {
    exact(input, ["cleanup", "expectedBefore", "kind", "mode", "ownerUid", "parent", "path"]);
    if (input.expectedBefore !== "absent" || input.cleanup !== "remove_on_compensation" || input.mode !== 0o700) return refuse();
    planned = { kind: "directory", path: admitCanonicalAbsolutePath(input.path, context.evidence), expectedBefore: "absent", ownerUid: uid(input.ownerUid), mode: 0o700, parent: validateParent(input.parent, context), cleanup: "remove_on_compensation" };
  } else if (input.kind === "global_lock") {
    exact(input, ["cleanup", "expectedBefore", "kind", "mode", "ownerUid", "parent", "path"]);
    if (scope !== "ordinary" || ordinal !== 0 || input.expectedBefore !== "absent" || input.cleanup !== "remove_on_compensation" || input.mode !== 0o600) return refuse();
    planned = { kind: "global_lock", path: admitCanonicalAbsolutePath(input.path, context.evidence), expectedBefore: "absent", ownerUid: uid(input.ownerUid), mode: 0o600, parent: validateParent(input.parent, context), cleanup: "remove_on_compensation" };
  } else if (input.kind === "file") {
    exact(input, ["cleanup", "expectedBefore", "kind", "ownerUid", "parent", "path", "payload"]);
    if (input.expectedBefore !== "absent" || input.cleanup !== "remove_on_compensation") return refuse();
    planned = { kind: "file", path: admitCanonicalAbsolutePath(input.path, context.evidence), expectedBefore: "absent", ownerUid: uid(input.ownerUid), payload: validatePayloadRef(input.payload, operation, bootstrapId, context.productHome), parent: validateParent(input.parent, context), cleanup: "remove_on_compensation" };
  } else {
    return refuse();
  }
  if (planned.ownerUid !== context.bootstrapIdentity.ownerUid) return refuse();
  return admitEqualValue(planned, (candidate) =>
    context.admitPlannedCreatedPath(candidate, scope, ordinal),
  );
}

function validateParentOrder(
  paths: readonly PlannedCreatedPathV1[],
  launchability: readonly PlannedCreatedPathV1[],
): void {
  const resolve = (scope: "ordinary" | "launchability", ordinal: number): PlannedCreatedPathV1 | undefined =>
    scope === "ordinary" ? paths[ordinal] : launchability[ordinal];
  for (const [ordinal, planned] of paths.entries()) {
    if (ordinal <= 1) continue;
    if (compareUtf8((paths[ordinal - 1] as PlannedCreatedPathV1).path, planned.path) >= 0) return refuse();
  }
  for (const [ordinal, planned] of [...paths, ...launchability].entries()) {
    if (planned.parent.kind === "preexisting") {
      if (dirname(planned.path) !== planned.parent.path) return refuse();
      continue;
    }
    const parent = resolve(planned.parent.scope, planned.parent.ordinal);
    const localOrdinal = ordinal < paths.length ? ordinal : ordinal - paths.length;
    const parentIsEarlier = planned.parent.scope === "ordinary"
      ? planned.parent.ordinal < (ordinal < paths.length ? localOrdinal : paths.length)
      : ordinal >= paths.length && planned.parent.ordinal < localOrdinal;
    if (parent === undefined || !parentIsEarlier || dirname(planned.path) !== parent.path || parent.kind !== "directory") return refuse();
  }
}

function validateMutation(
  value: unknown,
  operation: "fresh_v2_init" | "v1_to_v2",
  bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1,
  context: BootstrapPlanAdmissionContextV1,
): FoundationMutationRefV1 {
  const input = record(value);
  exact(input, ["content", "contentHash", "contentSize", "digest", "expectedBeforeHash", "operation", "stagedPath", "targetPath"]);
  if (input.operation !== "create" && input.operation !== "replace" && input.operation !== "remove") return refuse();
  const targetPath = admitCanonicalAbsolutePath(input.targetPath, context.evidence);
  if (input.operation === "create") {
    if (input.expectedBeforeHash !== null || input.contentHash === null || input.contentSize === null || input.stagedPath === null || input.content === null || input.digest === null) return refuse();
    const contentHash = sha256(input.contentHash);
    const contentSize = integer(input.contentSize, 0, 16_777_216);
    const content = validatePayloadRef(input.content, operation, bootstrapId, context.productHome);
    const digest = validatePayloadRef(input.digest, operation, bootstrapId, context.productHome);
    if (content.hash !== contentHash || content.bytes !== contentSize || content.mode !== 0o600 || digest.mode !== 0o600 || content.path === digest.path) return refuse();
    return { targetPath, operation: "create", expectedBeforeHash: null, contentHash, contentSize, stagedPath: admitCanonicalAbsolutePath(input.stagedPath, context.evidence), content, digest };
  }
  if (input.operation === "remove") {
    if (input.expectedBeforeHash === null || input.contentHash !== null || input.contentSize !== null || input.stagedPath !== null || input.content !== null || input.digest !== null) return refuse();
    return { targetPath, operation: "remove", expectedBeforeHash: sha256(input.expectedBeforeHash), contentHash: null, contentSize: null, stagedPath: null, content: null, digest: null };
  }
  if (input.expectedBeforeHash === null || input.contentHash === null || input.contentSize === null || input.stagedPath === null || input.content === null || input.digest === null) return refuse();
  const contentHash = sha256(input.contentHash);
  const contentSize = integer(input.contentSize, 0, 16_777_216);
  const content = validatePayloadRef(input.content, operation, bootstrapId, context.productHome);
  const digest = validatePayloadRef(input.digest, operation, bootstrapId, context.productHome);
  if (content.hash !== contentHash || content.bytes !== contentSize || content.mode !== 0o600 || digest.mode !== 0o600 || content.path === digest.path) return refuse();
  return { targetPath, operation: "replace", expectedBeforeHash: sha256(input.expectedBeforeHash), contentHash, contentSize, stagedPath: admitCanonicalAbsolutePath(input.stagedPath, context.evidence), content, digest };
}

function validateFoundationParticipant(
  value: unknown,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  context: BootstrapPlanAdmissionContextV1,
): FoundationParticipantRefV2 {
  const input = record(value);
  exact(input, ["id", "initialJournal", "maximumJournalBytes", "mutations", "planHash", "role", "slot"]);
  if (typeof input.id !== "string" || !Array.isArray(input.mutations) || input.mutations.length < 1 || input.mutations.length > 256) return refuse();
  const expectedSlot = operation === "fresh_v2_init" ? "fresh_init_artifacts" : "v1_migration_artifacts";
  if (input.slot !== expectedSlot) return refuse();
  const roleInput = record(input.role);
  let role: FoundationParticipantRefV2["role"];
  if (roleInput.kind === "forward") {
    exact(roleInput, ["compensationId", "kind"]);
    if (typeof roleInput.compensationId !== "string") return refuse();
    role = { kind: "forward", compensationId: roleInput.compensationId as FoundationTransactionIdV2 };
  } else if (roleInput.kind === "compensation") {
    exact(roleInput, ["forwardId", "kind"]);
    if (typeof roleInput.forwardId !== "string") return refuse();
    role = { kind: "compensation", forwardId: roleInput.forwardId as FoundationTransactionIdV2 };
  } else return refuse();
  const initial = record(input.initialJournal);
  exact(initial, ["finalPath", "plannedBytesHash", "staged"]);
  const participantId = input.id as FoundationTransactionIdV2;
  const participant: FoundationParticipantRefV2 = {
    id: participantId,
    slot: expectedSlot,
    role,
    mutations: input.mutations.map((mutation) => validateMutation(mutation, operation, id, context)),
    maximumJournalBytes: integer(input.maximumJournalBytes, 1, MAX_JOURNAL_BYTES),
    planHash: sha256(input.planHash),
    initialJournal: {
      finalPath: admitCanonicalAbsolutePath(initial.finalPath, context.evidence),
      plannedBytesHash: sha256(initial.plannedBytesHash),
      staged: validatePayloadRef(initial.staged, operation, id, context.productHome),
    },
  };
  if (participant.initialJournal.finalPath !== `${context.stateRoot}/transactions/${participant.id}.json` || participant.initialJournal.staged.mode !== 0o600 || participant.initialJournal.staged.bytes < 1 || participant.initialJournal.staged.bytes > participant.maximumJournalBytes) return refuse();
  const staged = participant.initialJournal.staged;
  const stagedProjection = { kind: staged.kind, bootstrapId: staged.bootstrapId, ordinal: staged.ordinal, path: staged.path, bytes: staged.bytes, mode: staged.mode };
  const projection = {
    schemaVersion: 2,
    id: participant.id,
    slot: participant.slot,
    role: participant.role,
    mutations: participant.mutations,
    maximumJournalBytes: participant.maximumJournalBytes,
    initialJournal: { finalPath: participant.initialJournal.finalPath, staged: stagedProjection },
  };
  if (participant.planHash !== canonicalHash("developer-os/foundation-participant-plan/v2\0", projection as unknown as CanonicalJsonValue)) return refuse();
  return admitEqualValue(participant, (candidate) =>
    context.admitFoundationParticipant(candidate),
  );
}

function validateFoundationPairs(
  refs: readonly FoundationParticipantRefV2[],
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
): void {
  if (refs.length < 2 || refs.length > MAX_FOUNDATION_PARTICIPANTS || refs.length % 2 !== 0) return refuse();
  for (let index = 1; index < refs.length; index += 1) {
    if (compareUtf8((refs[index - 1] as FoundationParticipantRefV2).id, (refs[index] as FoundationParticipantRefV2).id) >= 0) return refuse();
  }
  const prefix = operation === "fresh_v2_init" ? "tx_fi" : "tx_mm";
  const uuid = String(id).slice(3);
  const forwardRefs = refs.filter((ref) => ref.role.kind === "forward");
  if (forwardRefs.length < 1 || forwardRefs.length > MAX_FOUNDATION_FORWARD_PARTICIPANTS || forwardRefs.length * 2 !== refs.length) return refuse();
  for (let ordinal = 0; ordinal < forwardRefs.length; ordinal += 1) {
    const encoded = String(ordinal).padStart(10, "0");
    const forwardId = `${prefix}_${uuid}_${encoded}_f`;
    const compensationId = `${prefix}_${uuid}_${encoded}_c`;
    const forward = refs.find((ref) => ref.id === forwardId);
    const compensation = refs.find((ref) => ref.id === compensationId);
    if (forward === undefined || compensation === undefined || forward.role.kind !== "forward" || compensation.role.kind !== "compensation" || forward.role.compensationId !== compensation.id || compensation.role.forwardId !== forward.id || forward.mutations.length !== compensation.mutations.length) return refuse();
    for (let mutationIndex = 0; mutationIndex < forward.mutations.length; mutationIndex += 1) {
      const original = forward.mutations[forward.mutations.length - 1 - mutationIndex];
      const inverse = compensation.mutations[mutationIndex];
      if (original === undefined || inverse === undefined || original.targetPath !== inverse.targetPath) return refuse();
      if (original.operation === "create") {
        if (inverse.operation !== "remove" || inverse.expectedBeforeHash !== original.contentHash || inverse.contentHash !== null || inverse.contentSize !== null || inverse.stagedPath !== null || inverse.content != null || inverse.digest != null) return refuse();
      } else if (original.operation === "remove") {
        if (inverse.operation !== "create" || inverse.expectedBeforeHash !== null || inverse.contentHash !== original.expectedBeforeHash || inverse.contentSize === null || inverse.stagedPath === null || inverse.content == null || inverse.digest == null) return refuse();
      } else if (inverse.operation !== "replace" || inverse.expectedBeforeHash !== original.contentHash || inverse.contentHash !== original.expectedBeforeHash || inverse.contentSize === null || inverse.stagedPath === null || inverse.content == null || inverse.digest == null) return refuse();
    }
  }
  const paths = forwardRefs.flatMap((ref) => ref.mutations.map((mutation) => mutation.targetPath));
  if (new Set(paths).size !== paths.length) return refuse();
  for (let index = 1; index < paths.length; index += 1) if (compareUtf8(paths[index - 1] as string, paths[index] as string) >= 0) return refuse();
}

function validateInitialJournals(
  refs: readonly FoundationParticipantRefV2[],
  payloads: readonly BootstrapPayloadPlanV1[],
): void {
  for (const participant of refs) {
    const payload = payloads.find((row) => row.ref.path === participant.initialJournal.staged.path);
    if (payload === undefined || !jsonEqual(payload.ref, participant.initialJournal.staged) || payload.source.kind !== "plan_derived" || payload.source.role !== "foundation_initial_journal") return refuse();
    const journal = validateFoundationJournalValue(payload.source.value, participant);
    if (journal.bytes.byteLength !== participant.initialJournal.staged.bytes || rawHash(journal.bytes) !== participant.initialJournal.plannedBytesHash || participant.initialJournal.plannedBytesHash !== participant.initialJournal.staged.hash) return refuse();
  }
}

function foundationBindingHash(ids: readonly string[]): LowerHexSha256 {
  return createHash("sha256").update("developer-os/manifest-foundation-bindings/v1\0").update(JSON.stringify(ids)).digest("hex") as LowerHexSha256;
}

function validateManifestBinding(
  value: ManifestStatePlanV1,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  v2ManifestHash: LowerHexSha256,
  refs: readonly FoundationParticipantRefV2[],
  context: BootstrapPlanAdmissionContextV1,
): ManifestStatePlanV1 {
  const retainedValue = admitEqualValue(value, (candidate) =>
    context.admitManifestParticipant(candidate),
  );
  const expectedKind = operation === "fresh_v2_init" ? "fresh_v2_init" : "v1_migration";
  if (retainedValue.participantId !== `mf_${id}` || retainedValue.envelope.kind !== expectedKind || retainedValue.envelope.id !== id || retainedValue.bindings.externalEffects.length !== 0 || retainedValue.after.state !== "present" || retainedValue.after.hash !== v2ManifestHash || retainedValue.after.bytes?.kind !== "bootstrap_expected" || retainedValue.after.bytes.bootstrapId !== id || retainedValue.after.bytes.hash !== v2ManifestHash) return refuse();
  const forwardIds = refs.filter((ref) => ref.role.kind === "forward").map((ref) => ref.id);
  if (retainedValue.bindings.foundationTransactions.count !== forwardIds.length || retainedValue.bindings.foundationTransactions.orderedIdsHash !== foundationBindingHash(forwardIds)) return refuse();
  return retainedValue;
}

function validateRefUseBijection(
  payloads: readonly BootstrapPayloadPlanV1[],
  created: readonly PlannedCreatedPathV1[],
  launchability: readonly PlannedCreatedPathV1[],
  foundation: readonly FoundationParticipantRefV2[],
  manifest: ManifestStatePlanV1,
): void {
  const payloadByPath = new Map(
    payloads.map((row) => [row.ref.path, row.ref] as const),
  );
  const uses = new Map<string, number>();
  const add = (ref: BootstrapExpectedPayloadRefV1): void => {
    const payloadRef = payloadByPath.get(ref.path);
    if (payloadRef === undefined || !jsonEqual(ref, payloadRef)) return refuse();
    uses.set(ref.path, (uses.get(ref.path) ?? 0) + 1);
  };
  const foundationStagedPaths = new Set<string>();
  for (const participant of foundation) {
    for (const mutation of participant.mutations) {
      if (mutation.operation === "remove" || mutation.stagedPath === null || mutation.content == null || mutation.digest == null) continue;
      foundationStagedPaths.add(mutation.stagedPath);
      foundationStagedPaths.add(`${mutation.stagedPath}.sha256`);
      add(mutation.content);
      add(mutation.digest);
    }
  }
  for (const planned of [...created, ...launchability]) {
    if (planned.kind === "file" && !foundationStagedPaths.has(planned.path)) add(planned.payload);
  }
  for (const participant of foundation) add(participant.initialJournal.staged);
  if (manifest.after.state === "present" && manifest.after.bytes?.kind === "bootstrap_expected") add(manifest.after.bytes);
  if (uses.size !== payloads.length) return refuse();
  for (const row of payloads) if (uses.get(row.ref.path) !== 1) return refuse();
}

function validateFoundationStaging(
  refs: readonly FoundationParticipantRefV2[],
  created: readonly PlannedCreatedPathV1[],
  payloads: readonly BootstrapPayloadPlanV1[],
  productHome: CanonicalAbsolutePathV1,
): void {
  for (const participant of refs) {
    for (const [index, mutation] of participant.mutations.entries()) {
      if (mutation.operation === "remove") continue;
      const expected = `${productHome}/staging/transactions/${participant.id}/${String(index)}.bin`;
      const stagedPath = mutation.stagedPath;
      if (stagedPath !== expected || mutation.content == null || mutation.digest == null || mutation.contentHash === null) return refuse();
      const planned = created.find((row) => row.path === stagedPath);
      const digestPlanned = created.find((row) => row.path === `${stagedPath}.sha256`);
      const digestPayload = payloads.find((row) => row.ref.path === mutation.digest?.path);
      if (
        planned?.kind !== "file" ||
        digestPlanned?.kind !== "file" ||
        !jsonEqual(planned.payload, mutation.content) ||
        !jsonEqual(digestPlanned.payload, mutation.digest) ||
        planned.payload.hash !== mutation.contentHash ||
        planned.payload.bytes !== mutation.contentSize ||
        digestPayload?.source.kind !== "plan_derived" ||
        digestPayload.source.role !== "foundation_staged_digest" ||
        digestPayload.source.value !== mutation.contentHash
      ) return refuse();
    }
  }
}

function stagingAggregate(
  payloads: number,
  created: number,
  launchability: number,
  foundation: number,
): number {
  return 2 * payloads + 3 * (created + launchability) + 5 + 2 * foundation;
}

/**
 * Ordered, deduplicated and confined to the product home. The set is replayed
 * by a later process to decide which names may legally exist beside the plan,
 * so an unbounded or unconfined list would widen that whitelist.
 */
function boundedPaths(value: unknown, context: BootstrapPlanAdmissionContextV1): readonly CanonicalAbsolutePathV1[] {
  if (!Array.isArray(value) || value.length > 4096) return refuse();
  const admitted = value.map((candidate) => {
    const path = admitCanonicalAbsolutePath(candidate, context.evidence);
    if (path !== context.productHome && !path.startsWith(`${context.productHome}/`)) return refuse();
    return path;
  });
  for (let index = 1; index < admitted.length; index += 1) {
    const previous = admitted[index - 1] as string;
    const current = admitted[index] as string;
    if (Buffer.compare(Buffer.from(previous), Buffer.from(current)) >= 0) return refuse();
  }
  return admitted;
}

export function validateBootstrapPlan(
  value: unknown,
  context: BootstrapPlanAdmissionContextV1,
): BootstrapExecutionPlanV1 {
  try {
    const input = record(value);
    if (input.operation !== "fresh_v2_init" && input.operation !== "v1_to_v2") return refuse();
    const operation = input.operation;
    const freshKeys = ["admittedExternalShapeHash", "admittedPreexistingPaths", "bootstrapIdentity", "createdPaths", "foundationParticipants", "id", "journalSlots", "launchabilityPaths", "manifest", "maximumJournalBytes", "maximumPlanBytes", "maximumStagingEntries", "operation", "payloads", "planPath", "schemaVersion", "stagingRoot", "v2ManifestHash"];
    const migrationKeys = ["bootstrapIdentity", "createdPaths", "foundationParticipants", "id", "journalSlots", "launchabilityPaths", "manifest", "maximumJournalBytes", "maximumPlanBytes", "maximumStagingEntries", "operation", "paths", "payloads", "schemaVersion", "v1ManifestHash", "v2ManifestHash"];
    exact(input, operation === "fresh_v2_init" ? freshKeys : migrationKeys);
    if (input.schemaVersion !== 1 || context.operation !== operation) return refuse();
    const id = operationId(operation, input.id);
    if (id !== context.id) return refuse();
    if (admitCanonicalAbsolutePath(context.productHome, context.evidence) !== context.productHome || context.stateRoot !== `${context.productHome}/state` || context.productStagingRoot !== `${context.productHome}/staging`) return refuse();
    const bootstrapIdentity = validateBootstrapIdentity(input.bootstrapIdentity, context);
    const paths = deriveBootstrapEnvelopePaths(context.productHome, operation, id);
    const journalSlots = validateJournalSlots(input.journalSlots, paths.journalSlots, context);
    let admittedPreexistingPaths: readonly CanonicalAbsolutePathV1[] = [];
    if (operation === "fresh_v2_init") {
      if (input.planPath !== paths.plan || input.stagingRoot !== paths.stagingRoot) return refuse();
      admittedPreexistingPaths = boundedPaths(input.admittedPreexistingPaths, context);
      if (context.externalShape === null) {
        const hash = sha256(input.admittedExternalShapeHash);
        if (
          context.admitFreshRecoveryExternalShape?.(
            hash,
            retainedClone(bootstrapIdentity),
          ) !== hash
        ) return refuse();
      } else {
        const external = validateBootstrapExternalShapeProjection(context.externalShape);
        const [home, state, lock] = external.entries;
        if (home.pathHash !== rawHash(context.productHome) || state.pathHash !== rawHash(context.stateRoot) || lock.pathHash !== rawHash(bootstrapIdentity.path) || home.ownerUid !== bootstrapIdentity.ownerUid || state.ownerUid !== bootstrapIdentity.ownerUid || lock.ownerUid !== bootstrapIdentity.ownerUid || lock.dev !== bootstrapIdentity.dev || lock.ino !== bootstrapIdentity.ino || input.admittedExternalShapeHash !== bootstrapExternalShapeHash(external)) return refuse();
      }
    } else {
      const migrationPaths = record(input.paths);
      exact(migrationPaths, ["plan", "stagingRoot"]);
      if (migrationPaths.plan !== paths.plan || migrationPaths.stagingRoot !== paths.stagingRoot || context.externalShape !== null) return refuse();
    }
    if (input.maximumPlanBytes !== MAX_PLAN_BYTES || input.maximumJournalBytes !== MAX_JOURNAL_BYTES) return refuse();
    const v1ManifestHash = operation === "v1_to_v2" ? sha256(input.v1ManifestHash) : undefined;
    const v2ManifestHash = sha256(input.v2ManifestHash);
    if (!Array.isArray(input.payloads) || input.payloads.length < 1 || input.payloads.length > MAX_STAGING_ENTRIES) return refuse();
    const payloads = input.payloads.map((candidate, ordinal): BootstrapPayloadPlanV1 => {
      const row = record(candidate);
      exact(row, ["ref", "source"]);
      const ref = validatePayloadRef(row.ref, operation, id, context.productHome);
      if (ref.ordinal !== ordinal) return refuse();
      const source = validatePayloadSource(row.source, ref, { operation, id, ...(v1ManifestHash === undefined ? {} : { v1ManifestHash }) }, context);
      return { ref, source };
    });
    if (new Set(payloads.map((row) => row.ref.path)).size !== payloads.length) return refuse();
    if (!Array.isArray(input.createdPaths) || input.createdPaths.length < 1 || input.createdPaths.length > MAX_CREATED_PATHS) return refuse();
    const createdPaths = input.createdPaths.map((candidate, ordinal) => validateCreatedPath(candidate, "ordinary", ordinal, context, id, operation));
    if (createdPaths[0]?.kind !== "global_lock" || createdPaths[0].path !== `${context.stateRoot}/.lifecycle.lock`) return refuse();
    if (!Array.isArray(input.launchabilityPaths) || input.launchabilityPaths.length < 7 || input.launchabilityPaths.length > MAX_LAUNCHABILITY_PATHS) return refuse();
    const launchabilityPaths = input.launchabilityPaths.map((candidate, ordinal) => validateCreatedPath(candidate, "launchability", ordinal, context, id, operation));
    if (new Set([...createdPaths, ...launchabilityPaths].map((row) => row.path)).size !== createdPaths.length + launchabilityPaths.length) return refuse();
    validateParentOrder(createdPaths, launchabilityPaths);
    if (!Array.isArray(input.foundationParticipants)) return refuse();
    const foundationParticipants = input.foundationParticipants.map((candidate) => validateFoundationParticipant(candidate, operation, id, context));
    validateFoundationPairs(foundationParticipants, operation, id);
    validateRequiredPlanDerivedSources(payloads, foundationParticipants, operation, context.productHome);
    validateInitialJournals(foundationParticipants, payloads);
    validateFoundationStaging(foundationParticipants, createdPaths, payloads, context.productHome);
    const manifest = validateManifestBinding(input.manifest as ManifestStatePlanV1, operation, id, v2ManifestHash, foundationParticipants, context);
    validateRefUseBijection(payloads, createdPaths, launchabilityPaths, foundationParticipants, manifest);
    const aggregate = stagingAggregate(payloads.length, createdPaths.length, launchabilityPaths.length, foundationParticipants.length);
    if (aggregate > MAX_STAGING_ENTRIES || input.maximumStagingEntries !== aggregate) return refuse();
    const common = { schemaVersion: 1 as const, id, v2ManifestHash, bootstrapIdentity, maximumPlanBytes: MAX_PLAN_BYTES, maximumJournalBytes: MAX_JOURNAL_BYTES, maximumStagingEntries: aggregate, payloads, createdPaths, foundationParticipants, launchabilityPaths, manifest };
    const plan: BootstrapExecutionPlanV1 = operation === "fresh_v2_init"
      ? { ...common, operation, id: id as FreshV2InitIdV1, admittedExternalShapeHash: sha256(input.admittedExternalShapeHash), admittedPreexistingPaths, planPath: paths.plan, journalSlots, stagingRoot: paths.stagingRoot }
      : { ...common, operation, id: id as ManifestMigrationIdV1, v1ManifestHash: v1ManifestHash as LowerHexSha256, paths: { plan: paths.plan, stagingRoot: paths.stagingRoot }, journalSlots };
    if (encoder.encode(encodeCanonicalJson(plan as unknown as CanonicalJsonValue)).byteLength > MAX_PLAN_BYTES) return refuse();
    return structuredClone(plan);
  } catch (error) {
    return normalizeFailure(error);
  }
}
