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
const MAX_COMPACTION_NEXT = 2_200_526;
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

export interface FreshV2InitPlanV1 extends BootstrapPlanCommonV1 {
  readonly operation: "fresh_v2_init";
  readonly id: FreshV2InitIdV1;
  readonly admittedExternalShapeHash: LowerHexSha256;
  readonly planPath: ExactProductStatePathV1;
  readonly journalPath: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

export interface ManifestMigrationPathsV1 {
  readonly plan: ExactProductStatePathV1;
  readonly journal: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
}

export interface ManifestMigrationPlanV1 extends BootstrapPlanCommonV1 {
  readonly operation: "v1_to_v2";
  readonly id: ManifestMigrationIdV1;
  readonly v1ManifestHash: LowerHexSha256;
  readonly paths: ManifestMigrationPathsV1;
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
  | "compacting";

interface BootstrapJournalCommonV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planHash: LowerHexSha256;
  readonly phase: BootstrapJournalPhaseV1;
  readonly direction: "forward" | "compensating";
  readonly nextPayload: number;
  readonly payloadWriteState: BootstrapPayloadWriteStateV1;
  readonly nextCreatedPath: number;
  readonly nextFoundationParticipant: number;
  readonly nextLaunchabilityPath: number;
  readonly manifestCursor: number;
  readonly compensationNext: number | null;
  readonly payloadCleanupPart: "staged_file" | "evidence" | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly compactionNext: number | null;
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

export interface BootstrapTempInventoryV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly prefixEvidenceId: string;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly bytes: number;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface BootstrapPreIntentObservationV1 {
  readonly proofId: string;
  readonly observation: unknown;
}

export interface BootstrapEnvelopeInventoryV1 {
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly plan: unknown;
  readonly journal: unknown;
  readonly planTemps: readonly BootstrapTempInventoryV1[];
  readonly journalTemps: readonly BootstrapTempInventoryV1[];
  readonly payloadEvidence: readonly unknown[];
  readonly createdPathEvidence: readonly unknown[];
  readonly foundationStates: readonly unknown[];
  readonly manifestState: unknown;
  readonly terminalState: unknown;
  readonly preIntentObservation: BootstrapPreIntentObservationV1 | null;
  readonly stagingEntries: readonly CanonicalAbsolutePathV1[];
  readonly unknownEntries: readonly CanonicalAbsolutePathV1[];
}

export interface BootstrapInventoryV1 {
  readonly schemaVersion: 1;
  readonly inventoryId: string;
  readonly entryCount: number;
  readonly envelopes: readonly BootstrapEnvelopeInventoryV1[];
  readonly unknownEntries: readonly CanonicalAbsolutePathV1[];
}

export interface BootstrapClosureAdmissionContextV1 {
  readonly admitGuardedInventory: (inventory: BootstrapInventoryV1) => string;
  readonly planAdmission: BootstrapPlanAdmissionContextV1;
  readonly admitPayloadEvidence: (
    value: unknown,
    ref: BootstrapExpectedPayloadRefV1,
    source: BootstrapPayloadSourceV1,
  ) => BootstrapPayloadEvidenceV1;
  readonly admitCreatedPathEvidence: (
    value: unknown,
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ) => CreatedPathEvidenceV1;
  readonly admitFoundationState: (
    value: unknown,
    participant: FoundationParticipantRefV2,
    expectation: "phase_bound" | "terminal",
  ) => string;
  readonly admitManifestState: (value: unknown, manifest: ManifestStatePlanV1) => string;
  readonly admitTerminalState: (value: unknown, plan: BootstrapExecutionPlanV1) => "preimage" | "postimage";
  readonly admitTemporaryPrefix: (
    value: BootstrapTempInventoryV1,
    kind: "plan" | "journal",
    operation: "fresh_v2_init" | "v1_to_v2",
    id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  ) => string;
  readonly admitPreIntentObservation: (
    value: BootstrapPreIntentObservationV1,
    operation: "fresh_v2_init" | "v1_to_v2",
    id: FreshV2InitIdV1 | ManifestMigrationIdV1,
    plan: BootstrapExecutionPlanV1 | null,
  ) => string;
}

export type BootstrapClosureV1 =
  | { readonly state: "clear" }
  | {
      readonly state: "guarded_cleanable_plan_temp";
      readonly operation: "fresh_v2_init" | "v1_to_v2";
      readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
      readonly temporary: BootstrapTempInventoryV1;
    }
  | {
      readonly state: "guarded_cleanable_plan_orphan";
      readonly plan: BootstrapExecutionPlanV1;
    }
  | {
      readonly state: "guarded_cleanable_journal_temp";
      readonly finalJournal: "absent";
      readonly plan: BootstrapExecutionPlanV1;
      readonly temporary: BootstrapTempInventoryV1;
    }
  | {
      readonly state: "guarded_cleanable_journal_temp";
      readonly finalJournal: "present";
      readonly plan: BootstrapExecutionPlanV1;
      readonly journal: FreshV2InitJournalV1 | ManifestMigrationJournalV1;
      readonly temporary: BootstrapTempInventoryV1;
    }
  | {
      readonly state: "recovery_required";
      readonly plan: BootstrapExecutionPlanV1;
      readonly journal: FreshV2InitJournalV1 | ManifestMigrationJournalV1;
    }
  | {
      readonly state: "plan_last_compaction";
      readonly plan: BootstrapExecutionPlanV1;
      readonly terminalOutcome: "finalized" | "rolled_back";
    };

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
  readonly journal: ExactProductStatePathV1;
  readonly stagingRoot: CanonicalAbsolutePathV1;
} {
  const admittedId = operationId(operation, id);
  const prefix = operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration";
  return {
    plan: deriveAbsolute(productHome, `state/${prefix}.${admittedId}.plan.json`) as ExactProductStatePathV1,
    journal: deriveAbsolute(productHome, `state/${prefix}.${admittedId}.journal.json`) as ExactProductStatePathV1,
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

function planHash(plan: BootstrapExecutionPlanV1): LowerHexSha256 {
  return rawHash(encodeCanonicalJson(plan as unknown as CanonicalJsonValue));
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
  const idle = journal.payloadWriteState.state === "idle";
  const noCompensation = journal.compensationNext === null && journal.payloadCleanupPart === null;
  const noTerminal = journal.terminalOutcome === null && journal.compactionNext === null;
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
      if (!(journal.direction === "compensating" && journal.manifestCursor < 2 && journal.compensationNext !== null && journal.compensationNext >= -1 && hasForwardPrefix(journal, counts) && journal.terminalOutcome === null && journal.compactionNext === null)) refuse();
      if (journal.compensationNext >= reachedReversibleStepCount(journal)) refuse();
      if (journal.payloadWriteState.state !== "idle" && journal.compensationNext !== journal.nextPayload) refuse();
      if (journal.payloadCleanupPart !== null && (journal.compensationNext < 0 || journal.compensationNext >= counts.payloads)) refuse();
      return;
    case "rolled_back":
      if (!(journal.direction === "compensating" && idle && journal.manifestCursor < 2 && journal.compensationNext === -1 && journal.payloadCleanupPart === null && journal.terminalOutcome === "rolled_back" && journal.compactionNext === null && hasForwardPrefix(journal, counts))) refuse();
      return;
    case "finalized":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor === 3 && noCompensation && journal.terminalOutcome === "finalized" && journal.compactionNext === null)) refuse();
      return;
    case "compacting": {
      const terminalDirection = journal.terminalOutcome === "finalized" ? "forward" : "compensating";
      if (!(idle && journal.direction === terminalDirection && journal.terminalOutcome !== null && journal.compactionNext !== null && journal.payloadCleanupPart === null)) refuse();
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
    exact(input, [
      "compactionNext",
      "compensationNext",
      "createdAt",
      "direction",
      "id",
      "manifestCursor",
      "nextCreatedPath",
      "nextFoundationParticipant",
      "nextLaunchabilityPath",
      "nextPayload",
      "payloadCleanupPart",
      "payloadWriteState",
      "phase",
      "planHash",
      "schemaVersion",
      "terminalOutcome",
      "updatedAt",
    ]);
    if (input.schemaVersion !== 1 || input.id !== plan.id || input.planHash !== planHash(plan)) return refuse();
    const phases: readonly BootstrapJournalPhaseV1[] = ["planned", "payload_staging", "creating", "foundation_applying", "launchability_publishing", "manifest_publishing", "verifying", "compensating", "finalized", "rolled_back", "compacting"];
    if (typeof input.phase !== "string" || !phases.includes(input.phase as BootstrapJournalPhaseV1)) return refuse();
    if (input.direction !== "forward" && input.direction !== "compensating") return refuse();
    if (input.payloadCleanupPart !== null && input.payloadCleanupPart !== "staged_file" && input.payloadCleanupPart !== "evidence") return refuse();
    if (input.terminalOutcome !== null && input.terminalOutcome !== "finalized" && input.terminalOutcome !== "rolled_back") return refuse();
    const forwardCount = plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length;
    const nextPayload = integer(input.nextPayload, 0, Math.min(MAX_STAGING_ENTRIES, plan.payloads.length));
    const payloadWriteState = validatePayloadWriteState(input.payloadWriteState, nextPayload, plan.payloads.length);
    const journal: BootstrapJournalCommonV1 = {
      schemaVersion: 1,
      id: plan.id,
      planHash: sha256(input.planHash),
      phase: input.phase as BootstrapJournalPhaseV1,
      direction: input.direction,
      nextPayload,
      payloadWriteState,
      nextCreatedPath: integer(input.nextCreatedPath, 0, Math.min(MAX_CREATED_PATHS, plan.createdPaths.length)),
      nextFoundationParticipant: integer(input.nextFoundationParticipant, 0, Math.min(MAX_FOUNDATION_FORWARD_PARTICIPANTS, forwardCount)),
      nextLaunchabilityPath: integer(input.nextLaunchabilityPath, 0, Math.min(MAX_LAUNCHABILITY_PATHS, plan.launchabilityPaths.length)),
      manifestCursor: integer(input.manifestCursor, 0, 3),
      compensationNext: input.compensationNext === null ? null : integer(input.compensationNext, -1, MAX_COMPENSATION_NEXT),
      payloadCleanupPart: input.payloadCleanupPart,
      terminalOutcome: input.terminalOutcome,
      compactionNext:
        input.compactionNext === null
          ? null
          : integer(input.compactionNext, 0, MAX_COMPACTION_NEXT),
      createdAt: timestamp(input.createdAt),
      updatedAt: timestamp(input.updatedAt),
    };
    validateJournalTable(journal, { payloads: plan.payloads.length, created: plan.createdPaths.length, foundation: forwardCount, launchability: plan.launchabilityPaths.length });
    if (journal.phase === "compacting") {
      const outcome = journal.terminalOutcome;
      const cursor = journal.compactionNext;
      if (
        outcome === null ||
        cursor === null ||
        cursor >= bootstrapCompactionTable(plan).length
      ) return refuse();
    }
    if (encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)).byteLength > plan.maximumJournalBytes) return refuse();
    return structuredClone(journal) as FreshV2InitJournalV1 | ManifestMigrationJournalV1;
  } catch (error) {
    return normalizeFailure(error);
  }
}

function validateTemporaryInventory(
  value: unknown,
  kind: "plan" | "journal",
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  context: BootstrapClosureAdmissionContextV1,
): BootstrapTempInventoryV1 {
  const input = record(value);
  exact(input, [
    "bytes",
    "dev",
    "ino",
    "mode",
    "nlink",
    "ownerUid",
    "path",
    "prefixEvidenceId",
  ]);
  const uuid = validateUuid(
    typeof input.path === "string"
      ? new RegExp(
          `^${context.planAdmission.stateRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/\\.${operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration"}\\.${String(id).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.(${UUID_V4})\\.${kind}\\.json\\.tmp$`,
          "u",
        ).exec(input.path)?.[1]
      : undefined,
  );
  const expectedPath = `${context.planAdmission.stateRoot}/.${operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration"}.${id}.${uuid}.${kind}.json.tmp`;
  const path = admitCanonicalAbsolutePath(input.path, context.planAdmission.evidence);
  const maximumBytes = kind === "plan" ? MAX_PLAN_BYTES : MAX_JOURNAL_BYTES;
  if (
    path !== expectedPath ||
    typeof input.prefixEvidenceId !== "string" ||
    input.prefixEvidenceId.length < 1 ||
    encoder.encode(input.prefixEvidenceId).byteLength > 256 ||
    input.ownerUid !== context.planAdmission.bootstrapIdentity.ownerUid ||
    input.mode !== 0o600 ||
    input.nlink !== 1
  ) return refuse();
  const temporary: BootstrapTempInventoryV1 = {
    path,
    prefixEvidenceId: input.prefixEvidenceId,
    ownerUid: uid(input.ownerUid),
    mode: 0o600,
    nlink: 1,
    bytes: integer(input.bytes, 0, maximumBytes),
    dev: uint64(input.dev),
    ino: uint64(input.ino),
  };
  const snapshot = retainedClone(temporary);
  const expectedProofId = snapshot.prefixEvidenceId;
  if (
    context.admitTemporaryPrefix(retainedClone(snapshot), kind, operation, id) !==
    expectedProofId
  ) return refuse();
  return snapshot;
}

function validatePreIntentObservation(
  value: unknown,
  operation: "fresh_v2_init" | "v1_to_v2",
  id: FreshV2InitIdV1 | ManifestMigrationIdV1,
  plan: BootstrapExecutionPlanV1 | null,
  context: BootstrapClosureAdmissionContextV1,
): BootstrapPreIntentObservationV1 {
  const input = record(value);
  exact(input, ["observation", "proofId"]);
  if (
    typeof input.proofId !== "string" ||
    input.proofId.length < 1 ||
    encoder.encode(input.proofId).byteLength > 256
  ) return refuse();
  const snapshot: BootstrapPreIntentObservationV1 = {
    proofId: input.proofId,
    observation: retainedClone(input.observation),
  };
  const expectedProofId = snapshot.proofId;
  const admitted = context.admitPreIntentObservation(
    retainedClone(snapshot),
    operation,
    id,
    plan === null ? null : retainedClone(plan),
  );
  if (admitted !== expectedProofId) return refuse();
  return snapshot;
}

function validateInventoryShape(inventory: BootstrapInventoryV1): void {
  const input = record(inventory);
  exact(input, ["entryCount", "envelopes", "inventoryId", "schemaVersion", "unknownEntries"]);
  if (input.schemaVersion !== 1 || typeof input.inventoryId !== "string" || input.inventoryId.length < 1) refuse();
  integer(input.entryCount, 0, MAX_STAGING_ENTRIES);
  if (!Array.isArray(input.envelopes) || input.envelopes.length > 1 || !Array.isArray(input.unknownEntries)) refuse();
  if (inventory.unknownEntries.length !== 0) refuse();
  const firstEnvelope = inventory.envelopes[0];
  if (firstEnvelope !== undefined) {
    const envelope = record(firstEnvelope);
    exact(envelope, [
      "createdPathEvidence",
      "foundationStates",
      "id",
      "journal",
      "journalTemps",
      "manifestState",
      "operation",
      "payloadEvidence",
      "plan",
      "planTemps",
      "preIntentObservation",
      "stagingEntries",
      "terminalState",
      "unknownEntries",
    ]);
  }
}

function closureEvidenceCounts(
  plan: BootstrapExecutionPlanV1,
  journal: FreshV2InitJournalV1 | ManifestMigrationJournalV1,
): { readonly payload: number; readonly ordinary: number; readonly launchability: number } {
  if (journal.phase === "compensating" || journal.phase === "rolled_back") {
    const remaining = (journal.compensationNext ?? -1) + 1;
    return {
      payload: Math.min(journal.nextPayload, Math.max(0, remaining)),
      ordinary: Math.min(
        journal.nextCreatedPath,
        Math.max(0, remaining - plan.payloads.length),
      ),
      launchability: Math.min(
        journal.nextLaunchabilityPath,
        Math.max(
          0,
          remaining -
            plan.payloads.length -
            plan.createdPaths.length -
            plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length,
        ),
      ),
    };
  }
  if (journal.phase === "compacting" && journal.terminalOutcome === "rolled_back") {
    return { payload: 0, ordinary: 0, launchability: 0 };
  }
  return {
    payload: journal.nextPayload,
    ordinary: journal.nextCreatedPath,
    launchability: journal.nextLaunchabilityPath,
  };
}

type BootstrapCompactionEntryV1 =
  | { readonly kind: "payload"; readonly ordinal: number }
  | {
      readonly kind: "creation";
      readonly scope: "ordinary" | "launchability";
      readonly ordinal: number;
    }
  | { readonly kind: "foundation"; readonly ordinal: number }
  | { readonly kind: "staging"; readonly path: CanonicalAbsolutePathV1 }
  | { readonly kind: "journal" };

interface BootstrapClosureEvidenceProjectionV1 {
  readonly payloadOrdinals: readonly number[];
  readonly creations: readonly {
    readonly scope: "ordinary" | "launchability";
    readonly ordinal: number;
  }[];
  readonly foundationOrdinals: readonly number[];
  readonly foundationExpectation: "phase_bound" | "terminal";
  readonly stagingEntries: readonly CanonicalAbsolutePathV1[];
}

function productStagingRootOf(plan: BootstrapExecutionPlanV1): CanonicalAbsolutePathV1 {
  const envelopeRoot =
    plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
  return dirname(dirname(envelopeRoot)) as CanonicalAbsolutePathV1;
}

function plannedStagingEntries(
  plan: BootstrapExecutionPlanV1,
  productStagingRoot = productStagingRootOf(plan),
): readonly CanonicalAbsolutePathV1[] {
  return [...plan.createdPaths, ...plan.launchabilityPaths]
    .map((planned) => planned.path)
    .filter(
      (path) =>
        typeof path === "string" &&
        (path === productStagingRoot ||
          path.startsWith(`${productStagingRoot}/`)),
    );
}

function bootstrapCompactionTable(
  plan: BootstrapExecutionPlanV1,
): readonly BootstrapCompactionEntryV1[] {
  const foundation = plan.foundationParticipants.map((_, ordinal) => ({
    kind: "foundation" as const,
    ordinal,
  }));
  return [
    ...plan.payloads.map((_, ordinal) => ({ kind: "payload" as const, ordinal })),
    ...plan.createdPaths.map((_, ordinal) => ({
      kind: "creation" as const,
      scope: "ordinary" as const,
      ordinal,
    })),
    ...plan.launchabilityPaths.map((_, ordinal) => ({
      kind: "creation" as const,
      scope: "launchability" as const,
      ordinal,
    })),
    ...foundation,
    ...[...plannedStagingEntries(plan)].reverse().map((path) => ({
      kind: "staging" as const,
      path,
    })),
    { kind: "journal" as const },
  ];
}

function projectionFromCompactionSuffix(
  plan: BootstrapExecutionPlanV1,
  entries: readonly BootstrapCompactionEntryV1[],
  terminalOutcome: "finalized" | "rolled_back",
): BootstrapClosureEvidenceProjectionV1 | null {
  if (!entries.some((entry) => entry.kind === "journal")) return null;
  const terminalEntries =
    terminalOutcome === "finalized"
      ? entries
      : entries.filter(
          (entry) =>
            entry.kind === "foundation" || entry.kind === "journal",
        );
  const staging = new Set(
    terminalEntries
      .filter((entry) => entry.kind === "staging")
      .map((entry) => entry.path),
  );
  return {
    payloadOrdinals: terminalEntries
      .filter((entry) => entry.kind === "payload")
      .map((entry) => entry.ordinal),
    creations: terminalEntries
      .filter((entry) => entry.kind === "creation")
      .map((entry) => ({ scope: entry.scope, ordinal: entry.ordinal })),
    foundationOrdinals: terminalEntries
      .filter((entry) => entry.kind === "foundation")
      .map((entry) => entry.ordinal),
    foundationExpectation: "terminal",
    stagingEntries: plannedStagingEntries(plan).filter((path) => staging.has(path)),
  };
}

function closureEvidenceProjections(
  plan: BootstrapExecutionPlanV1,
  journal: FreshV2InitJournalV1 | ManifestMigrationJournalV1,
  productStagingRoot: CanonicalAbsolutePathV1,
): readonly BootstrapClosureEvidenceProjectionV1[] {
  if (journal.phase === "compacting") {
    const cursor = journal.compactionNext;
    const outcome = journal.terminalOutcome;
    if (cursor === null || outcome === null) return refuse();
    const table = bootstrapCompactionTable(plan);
    if (table[cursor] === undefined) return refuse();
    const candidates = [
      projectionFromCompactionSuffix(plan, table.slice(cursor), outcome),
      projectionFromCompactionSuffix(plan, table.slice(cursor + 1), outcome),
    ].filter(
      (projection): projection is BootstrapClosureEvidenceProjectionV1 =>
        projection !== null,
    );
    return candidates.filter(
      (candidate, index) =>
        !candidates
          .slice(0, index)
          .some((earlier) => jsonEqual(earlier, candidate)),
    );
  }
  const counts = closureEvidenceCounts(plan, journal);
  const projection = (candidate: typeof counts): BootstrapClosureEvidenceProjectionV1 => ({
      payloadOrdinals: Array.from({ length: candidate.payload }, (_, ordinal) => ordinal),
      creations: [
        ...Array.from({ length: candidate.ordinary }, (_, ordinal) => ({
          scope: "ordinary" as const,
          ordinal,
        })),
        ...Array.from({ length: candidate.launchability }, (_, ordinal) => ({
          scope: "launchability" as const,
          ordinal,
        })),
      ],
      foundationOrdinals: plan.foundationParticipants.map((_, ordinal) => ordinal),
      foundationExpectation: "phase_bound",
      stagingEntries: [
        ...plan.createdPaths.slice(0, candidate.ordinary),
        ...plan.launchabilityPaths.slice(0, candidate.launchability),
      ]
        .map((planned) => planned.path)
        .filter(
          (path) =>
            path === productStagingRoot ||
            path.startsWith(`${productStagingRoot}/`),
        ),
    });
  const candidates = [projection(counts)];
  if (
    journal.phase === "payload_staging" &&
    journal.payloadWriteState.state === "writing" &&
    journal.payloadWriteState.ordinal === journal.nextPayload &&
    journal.nextPayload < plan.payloads.length
  ) {
    candidates.push(projection({ ...counts, payload: counts.payload + 1 }));
  }
  if (journal.phase === "creating" && journal.nextCreatedPath < plan.createdPaths.length) {
    candidates.push(projection({ ...counts, ordinary: counts.ordinary + 1 }));
  }
  if (
    journal.phase === "launchability_publishing" &&
    journal.nextLaunchabilityPath < plan.launchabilityPaths.length
  ) {
    candidates.push(projection({ ...counts, launchability: counts.launchability + 1 }));
  }
  return candidates;
}

export function inspectBootstrapClosure(
  inventory: BootstrapInventoryV1,
  context: BootstrapClosureAdmissionContextV1,
): BootstrapClosureV1 {
  try {
    const retainedInventory = retainedClone(inventory);
    validateInventoryShape(retainedInventory);
    const expectedInventoryId = retainedInventory.inventoryId;
    if (
      context.admitGuardedInventory(retainedClone(retainedInventory)) !==
      expectedInventoryId
    ) return refuse();
    inventory = retainedInventory;
    if (inventory.envelopes.length === 0) {
      if (inventory.entryCount !== 0) return refuse();
      return { state: "clear" };
    }

    const envelope = inventory.envelopes[0];
    if (envelope === undefined || envelope.operation !== context.planAdmission.operation || envelope.id !== context.planAdmission.id) return refuse();
    operationId(envelope.operation, envelope.id);
    if (
      !Array.isArray(envelope.unknownEntries) ||
      !Array.isArray(envelope.planTemps) ||
      !Array.isArray(envelope.journalTemps) ||
      !Array.isArray(envelope.payloadEvidence) ||
      !Array.isArray(envelope.createdPathEvidence) ||
      !Array.isArray(envelope.foundationStates) ||
      !Array.isArray(envelope.stagingEntries) ||
      envelope.unknownEntries.length !== 0 ||
      envelope.planTemps.length > 1 ||
      envelope.journalTemps.length > 1 ||
      envelope.payloadEvidence.length > MAX_STAGING_ENTRIES ||
      envelope.createdPathEvidence.length > MAX_STAGING_ENTRIES ||
      envelope.foundationStates.length > MAX_FOUNDATION_PARTICIPANTS
    ) return refuse();
    if (envelope.journal !== null && envelope.plan === null) return refuse();

    if (envelope.plan === null) {
      if (
        envelope.journal !== null ||
        envelope.planTemps.length !== 1 ||
        envelope.journalTemps.length !== 0 ||
        envelope.payloadEvidence.length !== 0 ||
        envelope.createdPathEvidence.length !== 0 ||
        envelope.foundationStates.length !== 0 ||
        envelope.manifestState !== null ||
        envelope.terminalState !== null ||
        envelope.preIntentObservation === null ||
        envelope.stagingEntries.length !== 0
      ) return refuse();
      validatePreIntentObservation(
        envelope.preIntentObservation,
        envelope.operation,
        envelope.id,
        null,
        context,
      );
      const temporary = validateTemporaryInventory(
        envelope.planTemps[0],
        "plan",
        envelope.operation,
        envelope.id,
        context,
      );
      return { state: "guarded_cleanable_plan_temp", operation: envelope.operation, id: envelope.id, temporary: structuredClone(temporary) };
    }

    const plan = validateBootstrapPlan(envelope.plan, context.planAdmission);
    if (plan.operation !== envelope.operation || plan.id !== envelope.id) return refuse();
    if (envelope.planTemps.length !== 0) return refuse();

    if (envelope.journal === null) {
      if (envelope.payloadEvidence.length !== 0 || envelope.createdPathEvidence.length !== 0 || envelope.foundationStates.length !== 0 || envelope.manifestState !== null || envelope.stagingEntries.length !== 0) return refuse();
      if (envelope.journalTemps.length === 1) {
        if (envelope.terminalState !== null || envelope.preIntentObservation === null) return refuse();
        validatePreIntentObservation(
          envelope.preIntentObservation,
          envelope.operation,
          envelope.id,
          plan,
          context,
        );
        const temporary = validateTemporaryInventory(
          envelope.journalTemps[0],
          "journal",
          envelope.operation,
          envelope.id,
          context,
        );
        return {
          state: "guarded_cleanable_journal_temp",
          finalJournal: "absent",
          plan,
          temporary,
        };
      }
      if (envelope.terminalState === null) {
        if (envelope.preIntentObservation === null) return refuse();
        validatePreIntentObservation(
          envelope.preIntentObservation,
          envelope.operation,
          envelope.id,
          plan,
          context,
        );
        return { state: "guarded_cleanable_plan_orphan", plan };
      }
      if (envelope.preIntentObservation !== null) return refuse();
      const terminalSnapshot = retainedClone(envelope.terminalState);
      const terminal = context.admitTerminalState(
        retainedClone(terminalSnapshot),
        retainedClone(plan),
      );
      return { state: "plan_last_compaction", plan, terminalOutcome: terminal === "postimage" ? "finalized" : "rolled_back" };
    }

    if (envelope.preIntentObservation !== null) return refuse();

    const journal = validateBootstrapJournal(plan, envelope.journal);
    if (journal.terminalOutcome === null) {
      if (envelope.terminalState !== null) return refuse();
    } else {
      if (envelope.terminalState === null) return refuse();
      const terminalSnapshot = retainedClone(envelope.terminalState);
      const observedTerminal = context.admitTerminalState(
        retainedClone(terminalSnapshot),
        retainedClone(plan),
      );
      const expectedTerminal =
        journal.terminalOutcome === "finalized" ? "postimage" : "preimage";
      if (observedTerminal !== expectedTerminal) return refuse();
    }
    const journalTemporary = envelope.journalTemps.length === 1
      ? validateTemporaryInventory(
        envelope.journalTemps[0],
        "journal",
        envelope.operation,
        envelope.id,
        context,
      )
      : null;
    if (journal.phase === "planned" && envelope.stagingEntries.length !== 0) return refuse();
    const projections = closureEvidenceProjections(
      plan,
      journal,
      context.planAdmission.productStagingRoot,
    );
    const matchingProjections = projections.filter(
      (projection) =>
        envelope.payloadEvidence.length === projection.payloadOrdinals.length &&
        envelope.createdPathEvidence.length === projection.creations.length &&
        envelope.foundationStates.length === projection.foundationOrdinals.length &&
        jsonEqual(envelope.stagingEntries, projection.stagingEntries),
    );
    if (matchingProjections.length !== 1) return refuse();
    const projection = matchingProjections[0];
    if (projection === undefined) return refuse();
    for (let index = 0; index < envelope.payloadEvidence.length; index += 1) {
      const ordinal = projection.payloadOrdinals[index];
      if (ordinal === undefined) return refuse();
      const row = plan.payloads[ordinal];
      if (row === undefined) return refuse();
      const evidenceValue: unknown = envelope.payloadEvidence[index];
      const evidenceSnapshot: unknown = retainedClone(evidenceValue);
      const admitted = context.admitPayloadEvidence(
        retainedClone(evidenceSnapshot),
        retainedClone(row.ref),
        retainedClone(row.source),
      );
      if (!jsonEqual(admitted, evidenceSnapshot)) return refuse();
      validateBootstrapPayloadEvidence(evidenceSnapshot, row.ref, row.source);
    }
    for (let index = 0; index < projection.creations.length; index += 1) {
      const creation = projection.creations[index];
      if (creation === undefined) return refuse();
      const planned =
        creation.scope === "ordinary"
          ? plan.createdPaths[creation.ordinal]
          : plan.launchabilityPaths[creation.ordinal];
      if (planned === undefined) return refuse();
      const evidenceValue: unknown = envelope.createdPathEvidence[index];
      const evidenceSnapshot: unknown = retainedClone(evidenceValue);
      const admitted = context.admitCreatedPathEvidence(
        retainedClone(evidenceSnapshot),
        retainedClone(planned),
        creation.scope,
        creation.ordinal,
      );
      if (!jsonEqual(admitted, evidenceSnapshot)) return refuse();
      validateCreatedPathEvidence(
        evidenceSnapshot,
        planned,
        plan.id,
        creation.scope,
        creation.ordinal,
      );
    }
    for (let index = 0; index < projection.foundationOrdinals.length; index += 1) {
      const ordinal = projection.foundationOrdinals[index];
      if (ordinal === undefined) return refuse();
      const participant = plan.foundationParticipants[ordinal];
      if (participant === undefined) return refuse();
      const expectedParticipantId = participant.id;
      if (
        context.admitFoundationState(
          retainedClone(envelope.foundationStates[index]),
          retainedClone(participant),
          projection.foundationExpectation,
        ) !== expectedParticipantId
      ) return refuse();
    }
    const expectedManifestId = plan.manifest.participantId;
    if (
      envelope.manifestState === null ||
      context.admitManifestState(
        retainedClone(envelope.manifestState),
        retainedClone(plan.manifest),
      ) !== expectedManifestId
    ) return refuse();
    return journalTemporary === null
      ? { state: "recovery_required", plan, journal }
      : {
          state: "guarded_cleanable_journal_temp",
          finalJournal: "present",
          plan,
          journal,
          temporary: journalTemporary,
        };
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

export function validateBootstrapPlan(
  value: unknown,
  context: BootstrapPlanAdmissionContextV1,
): BootstrapExecutionPlanV1 {
  try {
    const input = record(value);
    if (input.operation !== "fresh_v2_init" && input.operation !== "v1_to_v2") return refuse();
    const operation = input.operation;
    const freshKeys = ["admittedExternalShapeHash", "bootstrapIdentity", "createdPaths", "foundationParticipants", "id", "journalPath", "launchabilityPaths", "manifest", "maximumJournalBytes", "maximumPlanBytes", "maximumStagingEntries", "operation", "payloads", "planPath", "schemaVersion", "stagingRoot", "v2ManifestHash"];
    const migrationKeys = ["bootstrapIdentity", "createdPaths", "foundationParticipants", "id", "launchabilityPaths", "manifest", "maximumJournalBytes", "maximumPlanBytes", "maximumStagingEntries", "operation", "paths", "payloads", "schemaVersion", "v1ManifestHash", "v2ManifestHash"];
    exact(input, operation === "fresh_v2_init" ? freshKeys : migrationKeys);
    if (input.schemaVersion !== 1 || context.operation !== operation) return refuse();
    const id = operationId(operation, input.id);
    if (id !== context.id) return refuse();
    if (admitCanonicalAbsolutePath(context.productHome, context.evidence) !== context.productHome || context.stateRoot !== `${context.productHome}/state` || context.productStagingRoot !== `${context.productHome}/staging`) return refuse();
    const bootstrapIdentity = validateBootstrapIdentity(input.bootstrapIdentity, context);
    const paths = deriveBootstrapEnvelopePaths(context.productHome, operation, id);
    if (operation === "fresh_v2_init") {
      if (input.planPath !== paths.plan || input.journalPath !== paths.journal || input.stagingRoot !== paths.stagingRoot) return refuse();
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
      exact(migrationPaths, ["journal", "plan", "stagingRoot"]);
      if (migrationPaths.plan !== paths.plan || migrationPaths.journal !== paths.journal || migrationPaths.stagingRoot !== paths.stagingRoot || context.externalShape !== null) return refuse();
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
      ? { ...common, operation, id: id as FreshV2InitIdV1, admittedExternalShapeHash: sha256(input.admittedExternalShapeHash), planPath: paths.plan, journalPath: paths.journal, stagingRoot: paths.stagingRoot }
      : { ...common, operation, id: id as ManifestMigrationIdV1, v1ManifestHash: v1ManifestHash as LowerHexSha256, paths };
    if (encoder.encode(encodeCanonicalJson(plan as unknown as CanonicalJsonValue)).byteLength > MAX_PLAN_BYTES) return refuse();
    return structuredClone(plan);
  } catch (error) {
    return normalizeFailure(error);
  }
}
