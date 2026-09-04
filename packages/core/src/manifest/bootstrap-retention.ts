import { createHash } from "node:crypto";
import { dirname } from "node:path";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { CanonicalAbsolutePathV1, ExactProductStatePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type UInt64DecimalV1,
  type UtcTimestampV1,
} from "../update/scalars.js";
import type {
  BootstrapPayloadEvidenceV1,
  BootstrapPayloadWriteStateV1,
  BootstrapRetentionTerminalPreimageV1,
  CreatedPathEvidenceV1,
  FreshV2InitPlanV1,
  ManifestMigrationPlanV1,
  PlannedCreatedPathV1,
} from "./bootstrap.js";
import { BootstrapStateError, validateBootstrapPayloadEvidence } from "./bootstrap.js";
import type { FreshV2InitIdV1, ManifestMigrationIdV1 } from "./manifest-state.js";

export const BOOTSTRAP_RETAINED_MAX_IDS = 256;
export const BOOTSTRAP_RETAINED_MAX_ENTRIES = 1_000_000;
export const BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES = 12_884_901_888n;

const MAX_RETENTION_NEXT = 2_200_526;
const MAX_FOUNDATION_FORWARD_PARTICIPANTS = 256;
const MAX_MANIFEST_CURSOR = 3;
const MAX_COMPENSATION_NEXT = 2_200_264;
const MAX_ORDINAL = 999_999;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LowerHexSha256;
const encoder = new TextEncoder();

export interface BootstrapJournalSlotIdentityV1 {
  readonly slot: 0 | 1;
  readonly path: ExactProductStatePathV1;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

type FreshV2InitRetainedPlanV1 = FreshV2InitPlanV1;

type ManifestMigrationRetainedPlanV1 = ManifestMigrationPlanV1;

export type BootstrapRetainedExecutionPlanV1 =
  | FreshV2InitRetainedPlanV1
  | ManifestMigrationRetainedPlanV1;

export type BootstrapRetainedJournalPhaseV1 =
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

export interface BootstrapJournalRecordV1 {
  readonly schemaVersion: 1;
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planHash: LowerHexSha256;
  readonly slot: 0 | 1;
  readonly sequence: UInt64DecimalV1;
  readonly previousJournalHash: LowerHexSha256 | null;
  readonly phase: BootstrapRetainedJournalPhaseV1;
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

export interface BootstrapRetentionParentIdentityV1 {
  readonly path: CanonicalAbsolutePathV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export type BootstrapRetentionPostimageV1 =
  | {
      readonly kind: "regular_file";
      readonly ownerUid: number;
      readonly mode: 0o600 | 0o700;
      readonly nlink: 1;
      readonly bytes: UInt64DecimalV1;
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly kind: "directory_tree";
      readonly ownerUid: number;
      readonly mode: 0o700;
      readonly nlink: number;
      readonly treeHash: LowerHexSha256;
      readonly entryCount: number;
      readonly regularFileBytes: UInt64DecimalV1;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
      /** Present on every derived table row; optional only on the admitted pre-derivation projection. */
      readonly entries?: readonly BootstrapRetentionDirectoryEntryV1[];
    };

export interface BootstrapPayloadRetentionEvidenceV1 {
  readonly value: BootstrapPayloadEvidenceV1;
  readonly evidenceIdentity: {
    readonly ownerUid: number;
    readonly mode: 0o600;
    readonly nlink: 1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
}

export interface BootstrapInterruptedPayloadRetentionEvidenceV1 {
  readonly writeState: Extract<BootstrapPayloadWriteStateV1, { state: "writing" }>;
  readonly postimage: Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>;
}

export interface BootstrapCreatedPathRetentionEvidenceV1 {
  readonly value: CreatedPathEvidenceV1;
  readonly evidenceIdentity: {
    readonly ownerUid: number;
    readonly mode: 0o600;
    readonly nlink: 1;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  };
}

export interface BootstrapFoundationTerminalJournalEvidenceV1 {
  readonly participantId: string;
  readonly value: unknown;
  readonly postimage: Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>;
}

export type BootstrapRetentionDirectoryEntryV1 =
  | {
      readonly relativePath: string;
      readonly kind: "regular_file";
      readonly ownerUid: number;
      readonly mode: 0o600 | 0o700;
      readonly nlink: 1;
      readonly bytes: UInt64DecimalV1;
      readonly sha256: LowerHexSha256;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    }
  | {
      readonly relativePath: string;
      readonly kind: "directory";
      readonly ownerUid: number;
      readonly mode: 0o700;
      readonly nlink: number;
      readonly bytes: UInt64DecimalV1;
      readonly sha256: null;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

export interface BootstrapRetentionDirectoryTreeEvidenceV1 {
  readonly rootPath: CanonicalAbsolutePathV1;
  readonly entries: readonly BootstrapRetentionDirectoryEntryV1[];
}

export interface BootstrapRetentionEvidenceProjectionV1 {
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  /** Present only once retention starts; fixes the plan-derived retention prefix. */
  readonly terminalJournal: BootstrapJournalRecordV1 | null;
  /** Admitted persisted payload values and evidence-file identities; this pure projection does not widen bootstrap codecs. */
  readonly payloadEvidence: readonly BootstrapPayloadRetentionEvidenceV1[];
  /** Exact identity/content projection of a durable `writing` inode carried through terminal rollback. */
  readonly interruptedPayload: BootstrapInterruptedPayloadRetentionEvidenceV1 | null;
  /** Admitted persisted creation identities; this pure projection does not widen bootstrap codecs. */
  readonly createdPathEvidence: readonly BootstrapCreatedPathRetentionEvidenceV1[];
  /** Legal terminal Foundation journal bytes retained on the original outer payload inode. */
  readonly foundationEvidence: readonly BootstrapFoundationTerminalJournalEvidenceV1[];
  /** Complete descendant projections for every directory-tree row. */
  readonly directoryTrees: readonly BootstrapRetentionDirectoryTreeEvidenceV1[];
  readonly rows: readonly {
    readonly role:
      | "payload"
      | "payload_evidence"
      | "creation_evidence"
      | "foundation_bootstrap"
      | "manifest_bootstrap"
      | "staging_subtree"
      | "compensation_target"
      | "bootstrap_lock";
    readonly sourcePath: CanonicalAbsolutePathV1;
    readonly parent: BootstrapRetentionParentIdentityV1;
    readonly postimage: BootstrapRetentionPostimageV1;
  }[];
}

type BootstrapRetentionRoleV1 = BootstrapRetentionEvidenceProjectionV1["rows"][number]["role"];

/** Plan-derived logical locations used only to reopen a partially retained table. */
export interface BootstrapRetentionLocationV1 {
  readonly ordinal: number;
  readonly role: BootstrapRetentionRoleV1;
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly collapsesDescendants: boolean;
}

export interface BootstrapRetentionEntryV1 {
  readonly schemaVersion: 1;
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: number;
  readonly role: BootstrapRetentionRoleV1;
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly parent: BootstrapRetentionParentIdentityV1;
  readonly postimage: BootstrapRetentionPostimageV1;
}

export interface BootstrapJournalSelectionV1 {
  readonly current: BootstrapJournalRecordV1;
  readonly inactiveSlot: 0 | 1;
}

export interface BootstrapEvidenceSummaryV1 {
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly status: "verified" | "incomplete" | "altered" | "unverified";
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  readonly vaultPath: CanonicalAbsolutePathV1;
  readonly entryCount: number;
  readonly regularFileBytes: UInt64DecimalV1;
}

export interface SameParentRenameNoReplaceV1 {
  readonly entry: BootstrapRetentionEntryV1;
}

export interface BootstrapEvidenceClassificationInputV1 {
  readonly id: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly planPath: CanonicalAbsolutePathV1;
  readonly operation: "fresh_v2_init" | "v1_to_v2";
  readonly journal: BootstrapJournalSelectionV1 | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null;
  /**
   * Only the count is read. Callers derive expectations as retention locations
   * before a table exists, so naming both arms keeps the caller honest instead
   * of forcing an `as never` that reaches the slot without naming anything.
   */
  readonly expectedRows: readonly (BootstrapRetentionEntryV1 | BootstrapRetentionLocationV1)[];
  readonly matchingRows: number;
  readonly alteredRows: number;
  readonly unboundEntries: number;
  readonly confinedToRetainedNamespace: boolean;
  readonly entryCount: number;
  readonly regularFileBytes: UInt64DecimalV1;
}

export interface BootstrapRetentionCapacityV1 {
  readonly ids: number;
  readonly entries: number;
  readonly bytes: UInt64DecimalV1;
}

function refuse(message = "retained bootstrap state is malformed or unbound"): never {
  throw new BootstrapStateError(message);
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
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum || value > maximum) return refuse();
  return value;
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

function rawCanonicalHash(value: unknown): LowerHexSha256 {
  try {
    return createHash("sha256")
      .update(encodeCanonicalJson(value as CanonicalJsonValue))
      .digest("hex") as LowerHexSha256;
  } catch {
    return refuse();
  }
}

/**
 * For callers that already hold the canonical text. Verifying an evidence row
 * needs both its byte length and its hash, and encoding the value twice to get
 * them was the largest remaining cost of `developer-os init`.
 */
/**
 * Keyed on the plan object, which is immutable once admitted. Every journal
 * record carries the plan hash, and re-deriving it per record was 60,947,939 of
 * the 91,052,556 key encodes one `developer-os init` performed. A different plan
 * object hashes again, so nothing is trusted across identities.
 */
const retainedPlanHashes = new WeakMap<object, LowerHexSha256>();

function retainedPlanHash(plan: BootstrapRetainedExecutionPlanV1): LowerHexSha256 {
  const key = plan as unknown as object;
  const cached = retainedPlanHashes.get(key);
  if (cached !== undefined) return cached;
  const computed = rawCanonicalHash(plan);
  retainedPlanHashes.set(key, computed);
  return computed;
}

function hashCanonicalText(text: string): LowerHexSha256 {
  return createHash("sha256").update(text).digest("hex") as LowerHexSha256;
}

function rawPathHash(value: CanonicalAbsolutePathV1): LowerHexSha256 {
  return createHash("sha256").update(value).digest("hex") as LowerHexSha256;
}

function canonicalPath(value: unknown): CanonicalAbsolutePathV1 {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.endsWith("/") || value.includes("\\")) return refuse();
  if (encoder.encode(value).byteLength > 4096 || value.normalize("NFC") !== value) return refuse();
  const parts = value.slice(1).split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === ".." || encoder.encode(part).byteLength > 255)) return refuse();
  for (const character of value) {
    const point = character.codePointAt(0) as number;
    if ((point <= 0x1f) || (point >= 0x7f && point <= 0x9f) || /\p{Cf}/u.test(character)) return refuse();
  }
  return value as CanonicalAbsolutePathV1;
}

function validateSlotPlan(plan: BootstrapRetainedExecutionPlanV1): void {
  const slots: unknown = plan.journalSlots;
  if (!Array.isArray(slots) || slots.length !== 2) return refuse();
  const identities = new Set<string>();
  const paths = new Set<string>();
  for (const expectedSlot of [0, 1] as const) {
    const value = record(slots[expectedSlot]);
    exact(value, ["dev", "ino", "mode", "nlink", "ownerUid", "path", "slot"]);
    if (value.slot !== expectedSlot || value.mode !== 0o600 || value.nlink !== 1) return refuse();
    integer(value.ownerUid, 0, Number.MAX_SAFE_INTEGER);
    const admittedPath = canonicalPath(value.path);
    const dev = uint64(value.dev);
    const ino = uint64(value.ino);
    const key = `${dev}:${ino}`;
    if (identities.has(key) || paths.has(admittedPath)) return refuse();
    identities.add(key);
    paths.add(admittedPath);
  }
}

function validatePayloadWriteState(value: unknown, nextPayload: number, count: number): BootstrapPayloadWriteStateV1 {
  const input = record(value);
  if (input.state === "idle") {
    exact(input, ["state"]);
    return { state: "idle" };
  }
  if (input.state === "create_intent") {
    exact(input, ["ordinal", "state"]);
    const ordinal = integer(input.ordinal, 0, MAX_ORDINAL);
    if (ordinal !== nextPayload || ordinal >= count) return refuse();
    return { state: "create_intent", ordinal };
  }
  if (input.state === "writing") {
    exact(input, ["dev", "ino", "ordinal", "state"]);
    const ordinal = integer(input.ordinal, 0, MAX_ORDINAL);
    if (ordinal !== nextPayload || ordinal >= count) return refuse();
    return { state: "writing", ordinal, dev: uint64(input.dev), ino: uint64(input.ino) };
  }
  return refuse();
}

interface Counts {
  readonly payloads: number;
  readonly created: number;
  readonly foundation: number;
  readonly launchability: number;
}

function counts(plan: BootstrapRetainedExecutionPlanV1): Counts {
  return {
    payloads: plan.payloads.length,
    created: plan.createdPaths.length,
    foundation: plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length,
    launchability: plan.launchabilityPaths.length,
  };
}

function hasForwardPrefix(journal: BootstrapJournalRecordV1, value: Counts): boolean {
  if (journal.manifestCursor > 0) return journal.nextPayload === value.payloads && journal.nextCreatedPath === value.created && journal.nextFoundationParticipant === value.foundation && journal.nextLaunchabilityPath === value.launchability;
  if (journal.nextLaunchabilityPath > 0) return journal.nextPayload === value.payloads && journal.nextCreatedPath === value.created && journal.nextFoundationParticipant === value.foundation;
  if (journal.nextFoundationParticipant > 0) return journal.nextPayload === value.payloads && journal.nextCreatedPath === value.created && journal.nextLaunchabilityPath === 0;
  if (journal.nextCreatedPath > 0) return journal.nextPayload === value.payloads && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0;
  return journal.nextPayload <= value.payloads && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0;
}

function reachedReversibleSteps(journal: BootstrapJournalRecordV1): number {
  return journal.nextPayload + (journal.payloadWriteState.state === "idle" ? 0 : 1) + journal.nextCreatedPath + journal.nextFoundationParticipant + journal.nextLaunchabilityPath + Math.min(journal.manifestCursor, 1);
}

function retentionEligiblePayload(journal: BootstrapJournalRecordV1, cursor: number, value: Counts): boolean {
  return cursor >= 0 && cursor < value.payloads && (
    cursor < journal.nextPayload ||
    (cursor === journal.nextPayload && journal.payloadWriteState.state === "writing" && journal.payloadWriteState.ordinal === cursor)
  );
}

const JOURNAL_KEYS = [
  "compensationNext", "createdAt", "direction", "id", "manifestCursor", "nextCreatedPath",
  "nextFoundationParticipant", "nextLaunchabilityPath", "nextPayload", "payloadRetentionPart",
  "payloadWriteState", "phase", "planHash", "previousJournalHash", "retentionNext", "schemaVersion",
  "sequence", "slot", "terminalOutcome", "updatedAt",
] as const;

const JOURNAL_PHASES: readonly BootstrapRetainedJournalPhaseV1[] = [
  "planned", "payload_staging", "creating", "foundation_applying", "launchability_publishing",
  "manifest_publishing", "verifying", "compensating", "finalized", "rolled_back", "retaining", "retained",
];

function validateJournalState(
  journal: BootstrapJournalRecordV1,
  value: Counts,
  retentionEntries: number,
): void {
  const retentionPhase = journal.phase === "retaining" || journal.phase === "retained";
  if (retentionPhase !== (journal.retentionTerminalPreimage !== undefined)) return refuse();
  const idle = journal.payloadWriteState.state === "idle";
  const noCompensation = journal.compensationNext === null && journal.payloadRetentionPart === null;
  const noTerminal = journal.terminalOutcome === null && journal.retentionNext === null;
  const payloadComplete = journal.nextPayload === value.payloads;
  const createdComplete = payloadComplete && journal.nextCreatedPath === value.created;
  const foundationComplete = createdComplete && journal.nextFoundationParticipant === value.foundation;
  const allComplete = foundationComplete && journal.nextLaunchabilityPath === value.launchability;

  switch (journal.phase) {
    case "planned":
      if (!(journal.direction === "forward" && journal.nextPayload === 0 && idle && journal.nextCreatedPath === 0 && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) return refuse();
      return;
    case "payload_staging":
      if (!(journal.direction === "forward" && journal.nextCreatedPath === 0 && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) return refuse();
      return;
    case "creating":
      if (!(journal.direction === "forward" && idle && payloadComplete && journal.nextFoundationParticipant === 0 && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) return refuse();
      return;
    case "foundation_applying":
      if (!(journal.direction === "forward" && idle && createdComplete && journal.nextLaunchabilityPath === 0 && journal.manifestCursor === 0 && noCompensation && noTerminal)) return refuse();
      return;
    case "launchability_publishing":
      if (!(journal.direction === "forward" && idle && foundationComplete && journal.manifestCursor === 0 && noCompensation && noTerminal)) return refuse();
      return;
    case "manifest_publishing":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor <= 2 && noCompensation && noTerminal)) return refuse();
      return;
    case "verifying":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor >= 2 && journal.manifestCursor <= 3 && noCompensation && noTerminal)) return refuse();
      return;
    case "compensating":
      if (!(journal.direction === "compensating" && journal.manifestCursor < 2 && journal.compensationNext !== null && journal.compensationNext >= -1 && journal.compensationNext < reachedReversibleSteps(journal) && hasForwardPrefix(journal, value) && journal.terminalOutcome === null && journal.retentionNext === null)) return refuse();
      if (
        journal.payloadWriteState.state !== "idle" &&
        journal.compensationNext !== journal.nextPayload &&
        !(journal.payloadWriteState.state === "writing" && journal.compensationNext === -1)
      ) return refuse();
      if (
        journal.payloadRetentionPart !== null &&
        !retentionEligiblePayload(journal, journal.compensationNext, value)
      ) return refuse();
      return;
    case "rolled_back":
      if (!(journal.direction === "compensating" && journal.payloadWriteState.state !== "create_intent" && journal.manifestCursor < 2 && journal.compensationNext === -1 && journal.payloadRetentionPart === null && journal.terminalOutcome === "rolled_back" && journal.retentionNext === null && hasForwardPrefix(journal, value))) return refuse();
      return;
    case "finalized":
      if (!(journal.direction === "forward" && idle && allComplete && journal.manifestCursor === 3 && noCompensation && journal.terminalOutcome === "finalized" && journal.retentionNext === null)) return refuse();
      return;
    case "retaining":
    case "retained": {
      const terminalDirection = journal.terminalOutcome === "finalized" ? "forward" : "compensating";
      const retainedPayloadState = idle ||
        (journal.terminalOutcome === "rolled_back" && journal.payloadWriteState.state === "writing");
      if (!(retainedPayloadState && journal.direction === terminalDirection && journal.terminalOutcome !== null && journal.retentionNext !== null && journal.payloadRetentionPart === null)) return refuse();
      if (journal.terminalOutcome === "finalized" && !(allComplete && journal.manifestCursor === 3 && journal.compensationNext === null)) return refuse();
      if (journal.terminalOutcome === "rolled_back" && !(journal.manifestCursor < 2 && journal.compensationNext === -1 && hasForwardPrefix(journal, value))) return refuse();
      if (journal.phase === "retaining" && journal.retentionNext >= retentionEntries) return refuse();
      if (journal.phase === "retained" && journal.retentionNext !== retentionEntries) return refuse();
      return;
    }
  }
}

function validateJournalRecord(
  plan: BootstrapRetainedExecutionPlanV1,
  retentionEntries: number,
  value: unknown,
): BootstrapJournalRecordV1 {
  const input = record(value);
  const retentionPhase = input.phase === "retaining" || input.phase === "retained";
  exact(input, retentionPhase
    ? [...JOURNAL_KEYS, "retentionTerminalPreimage"]
    : JOURNAL_KEYS);
  if (input.schemaVersion !== 1 || input.id !== plan.id || input.planHash !== retainedPlanHash(plan)) return refuse();
  if (input.slot !== 0 && input.slot !== 1) return refuse();
  if (typeof input.phase !== "string" || !JOURNAL_PHASES.includes(input.phase as BootstrapRetainedJournalPhaseV1)) return refuse();
  if (input.direction !== "forward" && input.direction !== "compensating") return refuse();
  if (input.payloadRetentionPart !== null && input.payloadRetentionPart !== "staged_file" && input.payloadRetentionPart !== "evidence") return refuse();
  if (input.terminalOutcome !== null && input.terminalOutcome !== "finalized" && input.terminalOutcome !== "rolled_back") return refuse();

  const valueCounts = counts(plan);
  const nextPayload = integer(input.nextPayload, 0, valueCounts.payloads);
  const sequence = uint64(input.sequence);
  const previousJournalHash = input.previousJournalHash === null ? null : sha256(input.previousJournalHash);
  if (
    (sequence === "0") !== (previousJournalHash === null) ||
    input.slot !== Number(BigInt(sequence) % 2n)
  ) return refuse();
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
  const journal: BootstrapJournalRecordV1 = {
    schemaVersion: 1,
    id: plan.id,
    planHash: sha256(input.planHash),
    slot: input.slot,
    sequence,
    previousJournalHash,
    phase: input.phase as BootstrapRetainedJournalPhaseV1,
    direction: input.direction,
    nextPayload,
    payloadWriteState: validatePayloadWriteState(input.payloadWriteState, nextPayload, valueCounts.payloads),
    nextCreatedPath: integer(input.nextCreatedPath, 0, valueCounts.created),
    nextFoundationParticipant: integer(input.nextFoundationParticipant, 0, Math.min(MAX_FOUNDATION_FORWARD_PARTICIPANTS, valueCounts.foundation)),
    nextLaunchabilityPath: integer(input.nextLaunchabilityPath, 0, valueCounts.launchability),
    manifestCursor: integer(input.manifestCursor, 0, MAX_MANIFEST_CURSOR),
    compensationNext: input.compensationNext === null ? null : integer(input.compensationNext, -1, MAX_COMPENSATION_NEXT),
    payloadRetentionPart: input.payloadRetentionPart,
    terminalOutcome: input.terminalOutcome,
    retentionNext: input.retentionNext === null ? null : integer(input.retentionNext, 0, MAX_RETENTION_NEXT),
    ...(retentionTerminalPreimage === undefined ? {} : { retentionTerminalPreimage }),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
  };
  validateJournalState(journal, valueCounts, retentionEntries);
  if (sequence === "0" && journal.phase !== "planned") return refuse();
  if (encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)).byteLength > plan.maximumJournalBytes) return refuse();
  return structuredClone(journal);
}

const STATE_KEYS = [
  "phase", "direction", "nextPayload", "payloadWriteState", "nextCreatedPath",
  "nextFoundationParticipant", "nextLaunchabilityPath", "manifestCursor", "compensationNext",
  "payloadRetentionPart", "terminalOutcome", "retentionNext", "retentionTerminalPreimage",
] as const;

function sameValue(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

function changedStateKeys(current: BootstrapJournalRecordV1, successor: BootstrapJournalRecordV1): readonly string[] {
  return STATE_KEYS.filter((key) => {
    const currentValue = key === "retentionTerminalPreimage"
      ? current.retentionTerminalPreimage ?? null
      : current[key];
    const successorValue = key === "retentionTerminalPreimage"
      ? successor.retentionTerminalPreimage ?? null
      : successor[key];
    return !sameValue(currentValue, successorValue);
  });
}

const FORWARD_PHASE_TRANSITIONS = new Set([
  "planned:payload_staging",
  "payload_staging:creating",
  "creating:foundation_applying",
  "foundation_applying:launchability_publishing",
  "launchability_publishing:manifest_publishing",
  "manifest_publishing:verifying",
  "verifying:finalized",
  "finalized:retaining",
  "rolled_back:retaining",
  "retaining:retained",
]);

function isLegalSamePhaseTransition(
  current: BootstrapJournalRecordV1,
  next: BootstrapJournalRecordV1,
  value: Counts,
): boolean {
  const changed = changedStateKeys(current, next);
  if (changed.length === 0) return false;
  if (current.phase === "retaining") return changed.length === 1 && changed[0] === "retentionNext" && next.retentionNext === (current.retentionNext as number) + 1;
  if (current.phase === "payload_staging") {
    if (changed.length === 1 && changed[0] === "payloadWriteState") {
      return (current.payloadWriteState.state === "idle" && next.payloadWriteState.state === "create_intent") ||
        (current.payloadWriteState.state === "create_intent" && next.payloadWriteState.state === "writing");
    }
    return changed.length === 2 && changed.includes("nextPayload") && changed.includes("payloadWriteState") &&
      current.payloadWriteState.state === "writing" && next.payloadWriteState.state === "idle" && next.nextPayload === current.nextPayload + 1;
  }
  const cursorByPhase: Partial<Record<BootstrapRetainedJournalPhaseV1, keyof BootstrapJournalRecordV1>> = {
    creating: "nextCreatedPath",
    foundation_applying: "nextFoundationParticipant",
    launchability_publishing: "nextLaunchabilityPath",
    manifest_publishing: "manifestCursor",
    verifying: "manifestCursor",
  };
  const cursor = cursorByPhase[current.phase];
  if (cursor !== undefined && changed.length === 1 && changed[0] === cursor) {
    return typeof current[cursor] === "number" && next[cursor] === current[cursor] + 1;
  }
  if (current.phase === "compensating") {
    const cursor = current.compensationNext as number;
    if (
      current.payloadWriteState.state === "create_intent" &&
      current.payloadWriteState.ordinal === current.nextPayload &&
      cursor === current.nextPayload &&
      current.payloadRetentionPart === null &&
      next.payloadRetentionPart === null
    ) {
      if (next.payloadWriteState.state === "writing") {
        return changed.length === 1 && changed[0] === "payloadWriteState" &&
          next.payloadWriteState.ordinal === cursor && next.compensationNext === cursor;
      }
      return next.payloadWriteState.state === "idle" &&
        sameValue(changed, ["payloadWriteState", "compensationNext"]) &&
        next.compensationNext === cursor - 1;
    }
    const eligiblePayload = retentionEligiblePayload(current, cursor, value);
    if (!eligiblePayload) {
      return current.payloadRetentionPart === null && next.payloadRetentionPart === null &&
        changed.length === 1 && changed[0] === "compensationNext" && next.compensationNext === cursor - 1;
    }
    if (current.payloadRetentionPart === null) {
      return changed.length === 1 && changed[0] === "payloadRetentionPart" &&
        next.payloadRetentionPart === "staged_file" && next.compensationNext === cursor;
    }
    if (current.payloadRetentionPart === "staged_file") {
      return changed.length === 1 && changed[0] === "payloadRetentionPart" &&
        next.payloadRetentionPart === "evidence" && next.compensationNext === cursor;
    }
    const inProgressWriting = cursor === current.nextPayload && current.payloadWriteState.state === "writing";
    const expectedChanged = ["compensationNext", "payloadRetentionPart"];
    return sameValue(changed, expectedChanged) &&
      next.payloadRetentionPart === null &&
      next.compensationNext === cursor - 1 &&
      (!inProgressWriting || sameValue(next.payloadWriteState, current.payloadWriteState));
  }
  return false;
}

function isLegalPhaseTransition(
  current: BootstrapJournalRecordV1,
  next: BootstrapJournalRecordV1,
  retentionEntries: number,
): boolean {
  const pair = `${current.phase}:${next.phase}`;
  if (FORWARD_PHASE_TRANSITIONS.has(pair)) {
    const changed = changedStateKeys(current, next);
    if (pair === "verifying:finalized") {
      return sameValue(changed, ["phase", "terminalOutcome"]);
    }
    if (pair === "finalized:retaining" || pair === "rolled_back:retaining") {
      return sameValue(changed, ["phase", "retentionNext", "retentionTerminalPreimage"]) &&
        next.retentionNext === 0 &&
        sameValue(next.retentionTerminalPreimage, {
          previousJournalHash: current.previousJournalHash,
          updatedAt: current.updatedAt,
        });
    }
    if (pair === "retaining:retained") {
      return sameValue(changed, ["phase", "retentionNext"]) &&
        current.retentionNext === retentionEntries - 1 && next.retentionNext === retentionEntries;
    }
    return sameValue(changed, ["phase"]);
  }
  if (next.phase === "compensating" && current.direction === "forward" && current.manifestCursor < 2) {
    return sameValue(changedStateKeys(current, next), ["phase", "direction", "compensationNext"]) &&
      next.compensationNext === reachedReversibleSteps(current) - 1;
  }
  if (current.phase === "compensating" && next.phase === "rolled_back") {
    return current.compensationNext === -1 && sameValue(changedStateKeys(current, next), ["phase", "terminalOutcome"]);
  }
  return false;
}

function validateBootstrapJournalSuccessorPair(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  currentValue: BootstrapJournalRecordV1,
  successorValue: BootstrapJournalRecordV1,
): BootstrapJournalRecordV1 {
  validateSlotPlan(plan);
  const retentionEntries = needsRetentionTable(currentValue) || needsRetentionTable(successorValue)
    ? deriveBootstrapRetentionTable(plan, evidence).length
    : 0;
  const current = validateJournalRecord(plan, retentionEntries, currentValue);
  const successor = validateJournalRecord(plan, retentionEntries, successorValue);
  validateRetentionTerminalBinding(plan, evidence, current);
  validateRetentionTerminalBinding(plan, evidence, successor);
  if (current.sequence === MAX_UINT64.toString() || BigInt(successor.sequence) !== BigInt(current.sequence) + 1n) return refuse();
  if (successor.slot === current.slot || successor.previousJournalHash !== rawCanonicalHash(current)) return refuse();
  if (successor.createdAt !== current.createdAt || Date.parse(successor.updatedAt) < Date.parse(current.updatedAt)) return refuse();
  if (successor.phase === current.phase ? !isLegalSamePhaseTransition(current, successor, counts(plan)) : !isLegalPhaseTransition(current, successor, retentionEntries)) return refuse();
  return successor;
}

export function validateBootstrapJournalSuccessor(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  currentValue: BootstrapJournalRecordV1,
  successorValue: BootstrapJournalRecordV1,
): BootstrapJournalRecordV1 {
  return validateBootstrapJournalSuccessorPair(
    plan,
    evidence,
    currentValue,
    successorValue,
  );
}

export function selectBootstrapJournal(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  slots: readonly [unknown, unknown],
): BootstrapJournalSelectionV1 {
  validateSlotPlan(plan);
  const observedSlots: unknown = slots;
  if (!Array.isArray(observedSlots) || observedSlots.length !== 2) return refuse();
  const retentionEntries = observedSlots.some(needsRetentionTable)
    ? deriveBootstrapRetentionTable(plan, evidence).length
    : 0;
  const parsed: Array<BootstrapJournalRecordV1 | null> = [null, null];
  for (const slot of [0, 1] as const) {
    const candidate: unknown = observedSlots[slot];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const journal = validateJournalRecord(plan, retentionEntries, candidate);
    if (journal.slot !== slot) return refuse();
    parsed[slot] = journal;
  }
  const present = parsed.filter((value): value is BootstrapJournalRecordV1 => value !== null);
  if (present.length === 0) return refuse();
  if (present.length === 1) {
    const current = present[0] as BootstrapJournalRecordV1;
    if (
      current.phase === "retained" ||
      (current.phase === "retaining" && current.retentionNext !== 0)
    ) return refuse();
    validateRetentionTerminalBinding(plan, evidence, current);
    return { current, inactiveSlot: current.slot === 0 ? 1 : 0 };
  }
  const first = present[0] as BootstrapJournalRecordV1;
  const second = present[1] as BootstrapJournalRecordV1;
  if (first.sequence === second.sequence) return refuse();
  const [current, successor] = BigInt(first.sequence) < BigInt(second.sequence) ? [first, second] : [second, first];
  const selected = validateBootstrapJournalSuccessorPair(
    plan,
    evidence,
    current,
    successor,
  );
  validateRetentionTerminalBinding(plan, evidence, selected);
  return { current: selected, inactiveSlot: selected.slot === 0 ? 1 : 0 };
}

const ROLE_ORDER: Readonly<Record<BootstrapRetentionRoleV1, number>> = {
  payload: 0,
  payload_evidence: 1,
  creation_evidence: 2,
  foundation_bootstrap: 3,
  manifest_bootstrap: 4,
  staging_subtree: 5,
  compensation_target: 6,
  bootstrap_lock: 7,
};

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const common = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < common; index += 1) {
    const difference = (leftBytes[index] as number) - (rightBytes[index] as number);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function canonicalRelativePath(value: unknown, rootPath: CanonicalAbsolutePathV1): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\")
  ) return refuse();
  canonicalPath(`${rootPath}/${value}`);
  return value;
}

function retainedTreeHash(entries: readonly BootstrapRetentionDirectoryEntryV1[]): LowerHexSha256 {
  const encoded = encodeCanonicalJson(entries);
  return createHash("sha256")
    .update("developer-os/bootstrap-retained-tree/v1\0")
    .update(encoded.slice(0, -1))
    .digest("hex") as LowerHexSha256;
}

function validateDirectoryTreeEvidence(value: unknown): BootstrapRetentionDirectoryTreeEvidenceV1 {
  const input = record(value);
  exact(input, ["entries", "rootPath"]);
  const rootPath = canonicalPath(input.rootPath);
  if (!Array.isArray(input.entries) || input.entries.length > BOOTSTRAP_RETAINED_MAX_ENTRIES) return refuse();
  const entries = input.entries.map((candidate) => {
    const entry = record(candidate);
    exact(entry, ["bytes", "dev", "ino", "kind", "mode", "nlink", "ownerUid", "relativePath", "sha256"]);
    const relativePath = canonicalRelativePath(entry.relativePath, rootPath);
    const common = {
      relativePath,
      ownerUid: integer(entry.ownerUid, 0, Number.MAX_SAFE_INTEGER),
      bytes: uint64(entry.bytes),
      dev: uint64(entry.dev),
      ino: uint64(entry.ino),
    };
    if (entry.kind === "regular_file") {
      const mode = entry.mode;
      if ((mode !== 0o600 && mode !== 0o700) || entry.nlink !== 1) return refuse();
      return {
        ...common,
        kind: "regular_file" as const,
        mode: mode === 0o600 ? 0o600 as const : 0o700 as const,
        nlink: 1 as const,
        sha256: sha256(entry.sha256),
      };
    }
    if (entry.kind === "directory") {
      if (entry.mode !== 0o700 || entry.sha256 !== null) return refuse();
      return {
        ...common,
        kind: "directory" as const,
        mode: 0o700 as const,
        nlink: integer(entry.nlink, 1, 4_294_967_295),
        sha256: null,
      };
    }
    return refuse();
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (compareUtf8((entries[index - 1] as BootstrapRetentionDirectoryEntryV1).relativePath, (entries[index] as BootstrapRetentionDirectoryEntryV1).relativePath) >= 0) return refuse();
  }
  const identities = new Set<string>();
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  for (const entry of entries) {
    const identity = `${entry.dev}:${entry.ino}`;
    if (identities.has(identity)) return refuse();
    identities.add(identity);
    const parentPath = dirname(entry.relativePath);
    if (parentPath !== "." && byPath.get(parentPath)?.kind !== "directory") return refuse();
  }
  return { rootPath, entries };
}

function validateParent(value: unknown, sourcePath: CanonicalAbsolutePathV1): BootstrapRetentionParentIdentityV1 {
  const input = record(value);
  exact(input, ["dev", "ino", "path"]);
  const parent = { path: canonicalPath(input.path), dev: uint64(input.dev), ino: uint64(input.ino) };
  if (parent.path !== dirname(sourcePath)) return refuse();
  return parent;
}

function validatePostimage(
  value: unknown,
  rootPath?: CanonicalAbsolutePathV1,
): BootstrapRetentionPostimageV1 {
  const input = record(value);
  if (input.kind === "regular_file") {
    exact(input, ["bytes", "dev", "ino", "kind", "mode", "nlink", "ownerUid", "sha256"]);
    if ((input.mode !== 0o600 && input.mode !== 0o700) || input.nlink !== 1) return refuse();
    return {
      kind: "regular_file",
      ownerUid: integer(input.ownerUid, 0, Number.MAX_SAFE_INTEGER),
      mode: input.mode,
      nlink: 1,
      bytes: uint64(input.bytes),
      sha256: sha256(input.sha256),
      dev: uint64(input.dev),
      ino: uint64(input.ino),
    };
  }
  if (input.kind === "directory_tree") {
    const hasEntries = Object.hasOwn(input, "entries");
    exact(input, hasEntries
      ? ["dev", "entries", "entryCount", "ino", "kind", "mode", "nlink", "ownerUid", "regularFileBytes", "treeHash"]
      : ["dev", "entryCount", "ino", "kind", "mode", "nlink", "ownerUid", "regularFileBytes", "treeHash"]);
    if (input.mode !== 0o700) return refuse();
    const postimage: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }> = {
      kind: "directory_tree",
      ownerUid: integer(input.ownerUid, 0, Number.MAX_SAFE_INTEGER),
      mode: 0o700,
      nlink: integer(input.nlink, 1, 4_294_967_295),
      treeHash: sha256(input.treeHash),
      entryCount: integer(input.entryCount, 0, BOOTSTRAP_RETAINED_MAX_ENTRIES),
      regularFileBytes: uint64(input.regularFileBytes),
      dev: uint64(input.dev),
      ino: uint64(input.ino),
    };
    if (!hasEntries) return postimage;
    if (rootPath === undefined) return refuse();
    const tree = validateDirectoryTreeEvidence({ rootPath, entries: input.entries });
    const regularFileBytes = tree.entries.reduce(
      (total, entry) => total + (entry.kind === "regular_file" ? BigInt(entry.bytes) : 0n),
      0n,
    );
    if (
      postimage.treeHash !== retainedTreeHash(tree.entries) ||
      postimage.entryCount !== tree.entries.length ||
      postimage.regularFileBytes !== regularFileBytes.toString()
    ) return refuse();
    return { ...postimage, entries: tree.entries };
  }
  return refuse();
}

function planRoot(plan: BootstrapRetainedExecutionPlanV1): CanonicalAbsolutePathV1 {
  const planPath = plan.operation === "fresh_v2_init" ? plan.planPath : plan.paths.plan;
  return dirname(dirname(planPath)) as CanonicalAbsolutePathV1;
}

function stagingRoot(plan: BootstrapRetainedExecutionPlanV1): CanonicalAbsolutePathV1 {
  return plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
}

function creationEvidencePath(
  plan: BootstrapRetainedExecutionPlanV1,
  scope: "ordinary" | "launchability",
  ordinal: number,
): CanonicalAbsolutePathV1 {
  const prefix = plan.operation === "fresh_v2_init" ? "fresh-v2-init" : "manifest-migration";
  return `${planRoot(plan)}/state/.${prefix}.${plan.id}.${scope}.${String(ordinal).padStart(10, "0")}.creation.json` as CanonicalAbsolutePathV1;
}

interface Authority {
  readonly role: BootstrapRetentionRoleV1;
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly planned?: PlannedCreatedPathV1;
  readonly scope?: "ordinary" | "launchability";
  readonly ordinal?: number;
  readonly payloadOrdinal?: number;
  readonly payloadPostimage?: true;
  readonly foundationOrdinal?: number;
  readonly foundationKind?: "forward" | "compensation";
  readonly foundationJournal?: true;
  readonly bytes?: number;
  readonly hash?: LowerHexSha256;
  readonly mode?: 0o600 | 0o700;
  readonly interruptedPostimage?: Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>;
}

function forwardFoundationOrdinals(
  plan: BootstrapRetainedExecutionPlanV1,
): ReadonlyMap<string, number> {
  const forwards = plan.foundationParticipants.filter((participant) => participant.role.kind === "forward");
  return new Map(forwards.map((participant, ordinal) => [participant.id, ordinal]));
}

function foundationOrdinal(
  participant: BootstrapRetainedExecutionPlanV1["foundationParticipants"][number],
  ordinals: ReadonlyMap<string, number>,
): number {
  const ordinal = participant.role.kind === "forward"
    ? ordinals.get(participant.id)
    : ordinals.get(participant.role.forwardId);
  if (ordinal === undefined) return refuse();
  return ordinal;
}

interface FoundationAuthorityBookkeeping {
  readonly rows: readonly Authority[];
  readonly consumedPayloadOrdinals: ReadonlySet<number>;
  readonly consumedPaths: ReadonlySet<string>;
}

function foundationAuthorities(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
): FoundationAuthorityBookkeeping {
  const rows: Authority[] = [];
  const consumedPayloadOrdinals = new Set<number>();
  const consumedPaths = new Set<string>();
  const ordinals = forwardFoundationOrdinals(plan);
  for (const participant of plan.foundationParticipants) {
    const ordinal = foundationOrdinal(participant, ordinals);
    if (
      ordinal >= journal.nextFoundationParticipant ||
      (journal.terminalOutcome === "finalized" && participant.role.kind !== "forward")
    ) continue;
    const initial = participant.initialJournal.staged;
    rows.push({
      role: "foundation_bootstrap",
      sourcePath: participant.initialJournal.finalPath,
      payloadOrdinal: initial.ordinal,
      foundationOrdinal: ordinal,
      foundationKind: participant.role.kind,
      foundationJournal: true,
      bytes: initial.bytes,
      hash: initial.hash,
      mode: initial.mode,
    });
    consumedPaths.add(participant.initialJournal.finalPath);
    for (const mutation of participant.mutations) {
      if (mutation.stagedPath === null || mutation.content == null || mutation.digest == null) continue;
      consumedPayloadOrdinals.add(mutation.content.ordinal);
      consumedPayloadOrdinals.add(mutation.digest.ordinal);
      consumedPaths.add(mutation.targetPath);
      consumedPaths.add(mutation.stagedPath);
      // Spec 2 §6.4 (Amended 2026-09-04): forward content is never a row, any outcome.
      if (participant.role.kind === "compensation") {
        rows.push({
          role: "foundation_bootstrap",
          sourcePath: mutation.stagedPath,
          payloadOrdinal: mutation.content.ordinal,
          payloadPostimage: true,
          foundationOrdinal: ordinal,
          foundationKind: participant.role.kind,
          bytes: mutation.content.bytes,
          hash: mutation.content.hash,
          mode: mutation.content.mode,
        });
      }
      rows.push({
        role: "foundation_bootstrap",
        sourcePath: `${mutation.stagedPath}.sha256` as CanonicalAbsolutePathV1,
        payloadOrdinal: mutation.digest.ordinal,
        payloadPostimage: true,
        foundationOrdinal: ordinal,
        foundationKind: participant.role.kind,
        bytes: mutation.digest.bytes,
        hash: mutation.digest.hash,
        mode: mutation.digest.mode,
      });
      consumedPaths.add(`${mutation.stagedPath}.sha256`);
    }
  }
  return { rows, consumedPayloadOrdinals, consumedPaths };
}

function plannedConsumer(
  plan: BootstrapRetainedExecutionPlanV1,
  payloadOrdinal: number,
): { readonly planned: PlannedCreatedPathV1; readonly scope: "ordinary" | "launchability"; readonly ordinal: number } | null {
  for (const [ordinal, planned] of plan.createdPaths.entries()) {
    if (planned.kind === "file" && planned.payload.ordinal === payloadOrdinal) {
      return { planned, scope: "ordinary", ordinal };
    }
  }
  for (const [ordinal, planned] of plan.launchabilityPaths.entries()) {
    if (planned.kind === "file" && planned.payload.ordinal === payloadOrdinal) {
      return { planned, scope: "launchability", ordinal };
    }
  }
  return null;
}

function plannedConsumerReached(
  consumer: NonNullable<ReturnType<typeof plannedConsumer>>,
  journal: BootstrapJournalRecordV1,
): boolean {
  return consumer.ordinal < (consumer.scope === "ordinary"
    ? journal.nextCreatedPath
    : journal.nextLaunchabilityPath);
}

function manifestPayloadOrdinal(plan: BootstrapRetainedExecutionPlanV1): number | null {
  const after = plan.manifest.after;
  return after.state === "present" && after.bytes?.kind === "bootstrap_expected"
    ? after.bytes.ordinal
    : null;
}

function forbiddenCompensationTargets(plan: BootstrapRetainedExecutionPlanV1): ReadonlySet<CanonicalAbsolutePathV1> {
  const planPath = plan.operation === "fresh_v2_init" ? plan.planPath : plan.paths.plan;
  return new Set([
    plan.bootstrapIdentity.path,
    plan.manifest.manifestPath,
    plan.manifest.tombstonePath,
    planPath,
    stagingRoot(plan),
    ...plan.journalSlots.map((slot) => slot.path),
    ...plan.createdPaths.filter((planned) => planned.kind === "global_lock").map((planned) => planned.path),
    ...plan.launchabilityPaths.filter((planned) => planned.kind === "global_lock").map((planned) => planned.path),
  ]);
}

function isForbiddenCompensationTarget(
  plan: BootstrapRetainedExecutionPlanV1,
  planned: PlannedCreatedPathV1,
): boolean {
  return planned.kind === "global_lock" || forbiddenCompensationTargets(plan).has(planned.path);
}

function authorities(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
  interruptedPayload: BootstrapInterruptedPayloadRetentionEvidenceV1 | null,
): readonly Authority[] {
  const result: Authority[] = [];
  const foundation = foundationAuthorities(plan, journal);
  const retainedFoundation = foundation.rows;
  const retainedFoundationPaths = foundation.consumedPaths;
  const retainedFoundationPayloads = foundation.consumedPayloadOrdinals;
  const foundationByPayload = new Map(retainedFoundation.map((authority) => [authority.payloadOrdinal as number, authority]));
  for (let ordinal = 0; ordinal < journal.nextPayload; ordinal += 1) {
    const payload = plan.payloads[ordinal];
    if (payload === undefined) return refuse();
    result.push({
      role: "payload_evidence",
      sourcePath: `${payload.ref.path}.json` as CanonicalAbsolutePathV1,
      payloadOrdinal: ordinal,
      mode: 0o600,
    });
    if (foundationByPayload.has(ordinal) || retainedFoundationPayloads.has(ordinal)) continue;
    const consumer = plannedConsumer(plan, ordinal);
    if (consumer !== null && plannedConsumerReached(consumer, journal)) continue;
    if (manifestPayloadOrdinal(plan) === ordinal && journal.manifestCursor >= 2) continue;
    result.push({
      role: "payload",
      sourcePath: payload.ref.path,
      payloadOrdinal: ordinal,
      payloadPostimage: true,
      bytes: payload.ref.bytes,
      hash: payload.ref.hash,
      mode: payload.ref.mode,
    });
  }
  if (interruptedPayload !== null) {
    const payload = plan.payloads[interruptedPayload.writeState.ordinal];
    if (payload === undefined) return refuse();
    result.push({
      role: "payload",
      sourcePath: payload.ref.path,
      payloadOrdinal: interruptedPayload.writeState.ordinal,
      payloadPostimage: true,
      interruptedPostimage: interruptedPayload.postimage,
    });
  }
  for (const [ordinal, planned] of plan.createdPaths.entries()) {
    if (ordinal >= journal.nextCreatedPath) continue;
    result.push({ role: "creation_evidence", sourcePath: creationEvidencePath(plan, "ordinary", ordinal), scope: "ordinary", ordinal, mode: 0o600 });
    if (
      journal.terminalOutcome === "rolled_back" &&
      !isForbiddenCompensationTarget(plan, planned) &&
      !retainedFoundationPaths.has(planned.path) &&
      !(planned.kind === "file" && retainedFoundationPayloads.has(planned.payload.ordinal))
    ) {
      result.push({ role: "compensation_target", sourcePath: planned.path, planned, scope: "ordinary", ordinal });
    }
  }
  for (const [ordinal, planned] of plan.launchabilityPaths.entries()) {
    if (ordinal >= journal.nextLaunchabilityPath) continue;
    result.push({ role: "creation_evidence", sourcePath: creationEvidencePath(plan, "launchability", ordinal), scope: "launchability", ordinal, mode: 0o600 });
    if (
      journal.terminalOutcome === "rolled_back" &&
      !isForbiddenCompensationTarget(plan, planned) &&
      !retainedFoundationPaths.has(planned.path) &&
      !(planned.kind === "file" && retainedFoundationPayloads.has(planned.payload.ordinal))
    ) {
      result.push({ role: "compensation_target", sourcePath: planned.path, planned, scope: "launchability", ordinal });
    }
  }
  result.push(...retainedFoundation);
  if (journal.terminalOutcome === "finalized" && plan.manifest.before.state === "present") {
    result.push({ role: "manifest_bootstrap", sourcePath: plan.manifest.tombstonePath, mode: 0o600 });
  }
  const retainedStagingRoot = stagingRoot(plan);
  const stagingOrdinal = plan.createdPaths.findIndex((planned) =>
    planned.kind === "directory" && planned.path === retainedStagingRoot,
  );
  if (
    plan.operation !== "fresh_v2_init" ||
    (stagingOrdinal >= 0 && stagingOrdinal < journal.nextCreatedPath)
  ) {
    const planned = stagingOrdinal < 0 ? undefined : plan.createdPaths[stagingOrdinal];
    result.push({
      role: "staging_subtree",
      sourcePath: retainedStagingRoot,
      ...(planned === undefined
        ? {}
        : { planned, scope: "ordinary" as const, ordinal: stagingOrdinal }),
    });
  }
  result.push({ role: "bootstrap_lock", sourcePath: plan.bootstrapIdentity.path, bytes: 0, hash: createHash("sha256").update("").digest("hex") as LowerHexSha256, mode: 0o600 });
  return result;
}

export function deriveBootstrapRetentionLocations(
  plan: BootstrapRetainedExecutionPlanV1,
  terminalValue: unknown,
): readonly BootstrapRetentionLocationV1[] {
  const journal = terminalRetentionJournal(plan, terminalValue);
  const listed = [...authorities(plan, journal, null)];
  if (journal.payloadWriteState.state === "writing") {
    const payload = plan.payloads[journal.payloadWriteState.ordinal];
    if (payload === undefined || journal.payloadWriteState.ordinal !== journal.nextPayload) return refuse();
    listed.push({
      role: "payload",
      sourcePath: payload.ref.path,
      payloadOrdinal: journal.payloadWriteState.ordinal,
    });
  }
  const directoryRoots = listed
    .filter((authority) =>
      authority.role === "staging_subtree" || authority.planned?.kind === "directory",
    )
    .sort((left, right) =>
      left.sourcePath.length - right.sourcePath.length || compareUtf8(left.sourcePath, right.sourcePath),
    );
  const maximalRoots = directoryRoots.filter((row, index) =>
    !directoryRoots.slice(0, index).some((ancestor) =>
      row.sourcePath.startsWith(`${ancestor.sourcePath}/`),
    ),
  );
  const collapsed = listed.filter((row) =>
    !maximalRoots.some((root) =>
      row.sourcePath !== root.sourcePath && row.sourcePath.startsWith(`${root.sourcePath}/`),
    ),
  );
  collapsed.sort((left, right) =>
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || compareUtf8(left.sourcePath, right.sourcePath),
  );
  return collapsed.map((row, ordinal) => ({
    ordinal,
    role: row.role,
    sourcePath: row.sourcePath,
    tombstonePath: `${dirname(row.sourcePath)}/.developer-os-retained.${plan.id}.${String(ordinal).padStart(10, "0")}.tombstone` as CanonicalAbsolutePathV1,
    collapsesDescendants: maximalRoots.some((root) => root.sourcePath === row.sourcePath),
  }));
}

function terminalRetentionJournal(
  plan: BootstrapRetainedExecutionPlanV1,
  value: unknown,
): BootstrapJournalRecordV1 {
  const journal = validateJournalRecord(plan, 0, value);
  if (journal.phase !== "finalized" && journal.phase !== "rolled_back") return refuse();
  return journal;
}

function reconstructRetentionTerminal(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
): BootstrapJournalRecordV1 {
  if (
    (journal.phase !== "retaining" && journal.phase !== "retained") ||
    journal.retentionNext === null ||
    journal.terminalOutcome === null ||
    journal.retentionTerminalPreimage === undefined
  ) return refuse();
  const sequenceOffset = BigInt(journal.retentionNext) + 1n;
  const terminalSequence = BigInt(journal.sequence) - sequenceOffset;
  if (terminalSequence < 0n) return refuse();
  const { retentionTerminalPreimage, ...terminalPrefix } = journal;
  return terminalRetentionJournal(plan, {
    ...terminalPrefix,
    slot: Number(terminalSequence % 2n) as 0 | 1,
    sequence: parseUInt64Decimal(terminalSequence.toString()),
    previousJournalHash: retentionTerminalPreimage.previousJournalHash,
    phase: journal.terminalOutcome === "finalized" ? "finalized" : "rolled_back",
    retentionNext: null,
    updatedAt: retentionTerminalPreimage.updatedAt,
  });
}

const RETENTION_TERMINAL_PREFIX_KEYS = [
  "direction",
  "terminalOutcome",
  "nextPayload",
  "payloadWriteState",
  "nextCreatedPath",
  "nextFoundationParticipant",
  "nextLaunchabilityPath",
  "manifestCursor",
  "compensationNext",
  "payloadRetentionPart",
] as const;

function validateRetentionTerminalBinding(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
  journal: BootstrapJournalRecordV1,
): void {
  if (journal.phase !== "retaining" && journal.phase !== "retained") return;
  if (evidence.terminalJournal === null) return refuse();
  const terminal = terminalRetentionJournal(plan, evidence.terminalJournal);
  const reconstructedTerminal = reconstructRetentionTerminal(plan, journal);
  if (!sameValue(reconstructedTerminal, terminal)) return refuse();
  for (const key of RETENTION_TERMINAL_PREFIX_KEYS) {
    if (!sameValue(journal[key], reconstructedTerminal[key])) return refuse();
  }
  const retentionNext = journal.retentionNext as number;
  const sequenceOffset = BigInt(retentionNext) + 1n;
  const terminalSequence = BigInt(reconstructedTerminal.sequence);
  if (
    terminalSequence + sequenceOffset > MAX_UINT64 ||
    BigInt(journal.sequence) !== terminalSequence + sequenceOffset ||
    journal.slot !== ((reconstructedTerminal.slot + Number(sequenceOffset % 2n)) % 2) ||
    journal.createdAt !== reconstructedTerminal.createdAt ||
    Date.parse(journal.updatedAt) < Date.parse(reconstructedTerminal.updatedAt)
  ) return refuse();
  if (
    sequenceOffset === 1n &&
    journal.previousJournalHash !== rawCanonicalHash(reconstructedTerminal)
  ) return refuse();
}

function needsRetentionTable(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const phase = (value as Record<string, unknown>).phase;
  return phase === "retaining" || phase === "retained";
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function authorityKey(authority: Pick<Authority, "role" | "sourcePath">): string {
  return `${authority.role}:${authority.sourcePath}`;
}

function plannedCreatedPath(
  plan: BootstrapRetainedExecutionPlanV1,
  scope: "ordinary" | "launchability",
  ordinal: number,
): PlannedCreatedPathV1 {
  const paths = scope === "ordinary" ? plan.createdPaths : plan.launchabilityPaths;
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= paths.length) return refuse();
  return paths[ordinal] as PlannedCreatedPathV1;
}

function createdPathOrder(
  plan: BootstrapRetainedExecutionPlanV1,
  scope: "ordinary" | "launchability",
  ordinal: number,
): number {
  return scope === "ordinary" ? ordinal : plan.createdPaths.length + ordinal;
}

function validateCreatedPathEvidence(
  plan: BootstrapRetainedExecutionPlanV1,
  value: unknown,
): CreatedPathEvidenceV1 {
  const input = record(value);
  exact(input, ["bootstrapId", "dev", "ino", "kind", "ordinal", "pathHash", "postimageHash", "schemaVersion", "scope"]);
  if (input.schemaVersion !== 1 || input.bootstrapId !== plan.id || (input.scope !== "ordinary" && input.scope !== "launchability")) return refuse();
  const ordinal = integer(input.ordinal, 0, MAX_ORDINAL);
  const planned = plannedCreatedPath(plan, input.scope, ordinal);
  const expectedPostimage = planned.kind === "file"
    ? planned.payload.hash
    : planned.kind === "global_lock"
      ? EMPTY_SHA256
      : null;
  if (input.pathHash !== rawPathHash(planned.path) || input.kind !== planned.kind || input.postimageHash !== expectedPostimage) return refuse();
  return {
    schemaVersion: 1,
    bootstrapId: plan.id,
    scope: input.scope,
    ordinal,
    pathHash: sha256(input.pathHash),
    kind: planned.kind,
    dev: uint64(input.dev),
    ino: uint64(input.ino),
    postimageHash: input.postimageHash === null ? null : sha256(input.postimageHash),
  };
}

function validateCreatedPathRetentionEvidence(
  plan: BootstrapRetainedExecutionPlanV1,
  value: unknown,
): BootstrapCreatedPathRetentionEvidenceV1 {
  const input = record(value);
  exact(input, ["evidenceIdentity", "value"]);
  const admitted = validateCreatedPathEvidence(plan, input.value);
  const identity = record(input.evidenceIdentity);
  exact(identity, ["dev", "ino", "mode", "nlink", "ownerUid"]);
  if (
    identity.ownerUid !== plan.bootstrapIdentity.ownerUid ||
    identity.mode !== 0o600 ||
    identity.nlink !== 1
  ) return refuse();
  return {
    value: admitted,
    evidenceIdentity: {
      ownerUid: integer(identity.ownerUid, 0, Number.MAX_SAFE_INTEGER),
      mode: 0o600,
      nlink: 1,
      dev: uint64(identity.dev),
      ino: uint64(identity.ino),
    },
  };
}

function validatePayloadRetentionEvidence(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
  value: unknown,
): readonly BootstrapPayloadRetentionEvidenceV1[] {
  if (!Array.isArray(value)) return refuse();
  const result = value.map((candidate) => {
    const input = record(candidate);
    exact(input, ["evidenceIdentity", "value"]);
    const evidenceValue = record(input.value);
    const ordinal = integer(evidenceValue.ordinal, 0, MAX_ORDINAL);
    const payload = plan.payloads[ordinal];
    if (payload === undefined) return refuse();
    const admitted = validateBootstrapPayloadEvidence(evidenceValue, payload.ref, payload.source);
    const identity = record(input.evidenceIdentity);
    exact(identity, ["dev", "ino", "mode", "nlink", "ownerUid"]);
    if (
      identity.ownerUid !== plan.bootstrapIdentity.ownerUid ||
      identity.mode !== 0o600 ||
      identity.nlink !== 1
    ) return refuse();
    return {
      value: admitted,
      evidenceIdentity: {
        ownerUid: integer(identity.ownerUid, 0, Number.MAX_SAFE_INTEGER),
        mode: 0o600 as const,
        nlink: 1 as const,
        dev: uint64(identity.dev),
        ino: uint64(identity.ino),
      },
    };
  });
  const ordinals = new Set(result.map((candidate) => candidate.value.ordinal));
  if (ordinals.size !== result.length || result.length !== journal.nextPayload) return refuse();
  for (let ordinal = 0; ordinal < journal.nextPayload; ordinal += 1) {
    if (!ordinals.has(ordinal)) return refuse();
  }
  return result;
}

function validateInterruptedPayloadRetentionEvidence(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
  value: unknown,
): BootstrapInterruptedPayloadRetentionEvidenceV1 | null {
  if (value === null) {
    if (journal.payloadWriteState.state === "writing") return refuse();
    return null;
  }
  if (
    journal.terminalOutcome !== "rolled_back" ||
    journal.payloadWriteState.state !== "writing"
  ) return refuse();
  const input = record(value);
  exact(input, ["postimage", "writeState"]);
  const writeState = record(input.writeState);
  exact(writeState, ["dev", "ino", "ordinal", "state"]);
  const ordinal = integer(writeState.ordinal, 0, MAX_ORDINAL);
  const payload = plan.payloads[ordinal];
  if (
    writeState.state !== "writing" ||
    ordinal !== journal.nextPayload ||
    !sameValue(writeState, journal.payloadWriteState) ||
    payload === undefined
  ) return refuse();
  const postimage = validatePostimage(input.postimage);
  const dev = uint64(writeState.dev);
  const ino = uint64(writeState.ino);
  if (
    postimage.kind !== "regular_file" ||
    postimage.ownerUid !== plan.bootstrapIdentity.ownerUid ||
    postimage.mode !== payload.ref.mode ||
    postimage.dev !== dev ||
    postimage.ino !== ino ||
    BigInt(postimage.bytes) > BigInt(payload.ref.bytes)
  ) return refuse();
  return {
    writeState: { state: "writing", ordinal, dev, ino },
    postimage,
  };
}

function payloadRetentionEvidence(
  evidence: readonly BootstrapPayloadRetentionEvidenceV1[],
  ordinal: number,
): BootstrapPayloadRetentionEvidenceV1 {
  const admitted = evidence.find((candidate) => candidate.value.ordinal === ordinal);
  if (admitted === undefined) return refuse();
  return admitted;
}

function validateFoundationTerminalEvidence(
  plan: BootstrapRetainedExecutionPlanV1,
  journal: BootstrapJournalRecordV1,
  payloadEvidence: readonly BootstrapPayloadRetentionEvidenceV1[],
  value: unknown,
): ReadonlyMap<string, BootstrapFoundationTerminalJournalEvidenceV1> {
  if (!Array.isArray(value)) return refuse();
  const applicable = foundationAuthorities(plan, journal).rows
    .filter((authority) => authority.foundationJournal === true);
  const expected = new Map(applicable.map((authority) => [
    `${authority.foundationKind as string}:${String(authority.foundationOrdinal)}`,
    authority,
  ]));
  if (value.length !== expected.size) return refuse();
  const result = new Map<string, BootstrapFoundationTerminalJournalEvidenceV1>();
  for (const candidate of value) {
    const input = record(candidate);
    exact(input, ["participantId", "postimage", "value"]);
    if (typeof input.participantId !== "string") return refuse();
    const participant = plan.foundationParticipants.find((row) => row.id === input.participantId);
    if (participant === undefined) return refuse();
    const ordinal = foundationOrdinal(participant, forwardFoundationOrdinals(plan));
    const key = `${participant.role.kind}:${String(ordinal)}`;
    if (!expected.has(key) || result.has(key)) return refuse();
    const initialPayload = plan.payloads[participant.initialJournal.staged.ordinal];
    if (
      initialPayload?.source.kind !== "plan_derived" ||
      initialPayload.source.role !== "foundation_initial_journal"
    ) return refuse();
    const initial = record(initialPayload.source.value);
    const terminal = record(input.value);
    const journalKeys = ["createdAt", "id", "kind", "mutations", "phase", "schemaVersion", "updatedAt"] as const;
    exact(initial, journalKeys);
    exact(terminal, journalKeys);
    if (
      initial.schemaVersion !== 1 ||
      terminal.schemaVersion !== 1 ||
      initial.id !== participant.id ||
      terminal.id !== participant.id ||
      initial.kind !== participant.slot ||
      terminal.kind !== participant.slot ||
      initial.phase !== "planned" ||
      terminal.phase !== "finalized" ||
      typeof initial.createdAt !== "string" ||
      terminal.createdAt !== initial.createdAt ||
      typeof terminal.updatedAt !== "string" ||
      Date.parse(terminal.updatedAt) < Date.parse(initial.createdAt) ||
      !Array.isArray(initial.mutations) ||
      !Array.isArray(terminal.mutations) ||
      initial.mutations.length !== participant.mutations.length ||
      terminal.mutations.length !== participant.mutations.length
    ) return refuse();
    timestamp(initial.createdAt);
    timestamp(terminal.updatedAt);
    const normalizedMutations = participant.mutations.map((mutation, index) => ({
      targetPath: mutation.targetPath,
      operation: mutation.operation,
      expectedBeforeHash: mutation.expectedBeforeHash,
      stagedRelativePath: mutation.operation === "remove" ? null : `${String(index)}.bin`,
    }));
    if (!sameValue(initial.mutations, normalizedMutations) || !sameValue(terminal.mutations, normalizedMutations)) {
      return refuse();
    }
    const normalized = {
      schemaVersion: 1,
      id: participant.id,
      kind: participant.slot,
      phase: "finalized",
      createdAt: initial.createdAt,
      updatedAt: terminal.updatedAt,
      mutations: normalizedMutations,
    };
    if (!sameValue(terminal, normalized)) return refuse();
    const postimage = validatePostimage(input.postimage);
    const origin = payloadRetentionEvidence(payloadEvidence, participant.initialJournal.staged.ordinal).value;
    const wireBytes = encoder.encode(`${JSON.stringify(normalized)}\n`);
    if (
      postimage.kind !== "regular_file" ||
      postimage.ownerUid !== plan.bootstrapIdentity.ownerUid ||
      postimage.mode !== 0o600 ||
      postimage.dev !== origin.dev ||
      postimage.ino !== origin.ino ||
      postimage.bytes !== String(wireBytes.byteLength) ||
      postimage.sha256 !== createHash("sha256").update(wireBytes).digest("hex")
    ) return refuse();
    result.set(key, {
      participantId: participant.id,
      value: structuredClone(normalized),
      postimage,
    });
  }
  return result;
}

function verifyAuthority(
  plan: BootstrapRetainedExecutionPlanV1,
  authority: Authority,
  row: { readonly role: BootstrapRetentionRoleV1; readonly sourcePath: CanonicalAbsolutePathV1; readonly parent: BootstrapRetentionParentIdentityV1; readonly postimage: BootstrapRetentionPostimageV1 },
  payloadEvidence: readonly BootstrapPayloadRetentionEvidenceV1[],
  createdPathEvidence: readonly BootstrapCreatedPathRetentionEvidenceV1[],
  foundationEvidence: ReadonlyMap<string, BootstrapFoundationTerminalJournalEvidenceV1>,
): void {
  if (authority.foundationJournal === true) {
    const admitted = authority.foundationKind === undefined || authority.foundationOrdinal === undefined
      ? undefined
      : foundationEvidence.get(`${authority.foundationKind}:${String(authority.foundationOrdinal)}`);
    if (admitted === undefined || !sameValue(row.postimage, admitted.postimage)) return refuse();
    return;
  }
  if (authority.interruptedPostimage !== undefined) {
    if (!sameValue(row.postimage, authority.interruptedPostimage)) return refuse();
    return;
  }
  if (authority.planned !== undefined) {
    const planned = authority.planned;
    if (authority.scope === undefined || authority.ordinal === undefined) return refuse();
    const targetEvidence = createdPathEvidence.find((candidate) =>
      candidate.value.scope === authority.scope && candidate.value.ordinal === authority.ordinal,
    )?.value;
    if (
      targetEvidence === undefined ||
      row.postimage.dev !== targetEvidence.dev ||
      row.postimage.ino !== targetEvidence.ino
    ) return refuse();
    if (planned.parent.kind === "preexisting") {
      if (planned.parent.path !== row.parent.path || planned.parent.dev !== row.parent.dev || planned.parent.ino !== row.parent.ino) return refuse();
    } else {
      const parentScope = planned.parent.scope;
      const parentOrdinal = planned.parent.ordinal;
      const parentPlanned = plannedCreatedPath(plan, parentScope, parentOrdinal);
      const parentEvidence = createdPathEvidence.find((candidate) =>
        candidate.value.scope === parentScope && candidate.value.ordinal === parentOrdinal,
      )?.value;
      if (
        parentPlanned.kind !== "directory" ||
        createdPathOrder(plan, parentScope, parentOrdinal) >= createdPathOrder(plan, authority.scope, authority.ordinal) ||
        parentPlanned.path !== row.parent.path ||
        dirname(row.sourcePath) !== parentPlanned.path ||
        parentEvidence === undefined ||
        parentEvidence.dev !== row.parent.dev ||
        parentEvidence.ino !== row.parent.ino
      ) return refuse();
    }
    if (planned.kind === "directory") {
      if (row.postimage.kind !== "directory_tree" || row.postimage.ownerUid !== planned.ownerUid) return refuse();
    } else {
      if (row.postimage.kind !== "regular_file" || row.postimage.ownerUid !== planned.ownerUid || row.postimage.mode !== (planned.kind === "global_lock" ? 0o600 : planned.payload.mode)) return refuse();
      if (planned.kind === "global_lock" && (row.postimage.bytes !== "0" || row.postimage.sha256 !== createHash("sha256").update("").digest("hex"))) return refuse();
      if (planned.kind === "file") {
        const origin = payloadRetentionEvidence(payloadEvidence, planned.payload.ordinal).value;
        if (
          row.postimage.bytes !== String(planned.payload.bytes) ||
          row.postimage.sha256 !== planned.payload.hash ||
          row.postimage.dev !== origin.dev ||
          row.postimage.ino !== origin.ino ||
          targetEvidence.dev !== origin.dev ||
          targetEvidence.ino !== origin.ino
        ) return refuse();
      }
    }
  }
  if (row.postimage.kind === "regular_file") {
    if (authority.bytes !== undefined && row.postimage.bytes !== String(authority.bytes)) return refuse();
    if (authority.hash !== undefined && row.postimage.sha256 !== authority.hash) return refuse();
    if (authority.mode !== undefined && row.postimage.mode !== authority.mode) return refuse();
  } else if (authority.bytes !== undefined || authority.hash !== undefined || authority.mode === 0o600) {
    return refuse();
  }
  if (authority.payloadPostimage === true) {
    if (authority.payloadOrdinal === undefined || row.postimage.kind !== "regular_file") return refuse();
    const origin = payloadRetentionEvidence(payloadEvidence, authority.payloadOrdinal).value;
    if (row.postimage.dev !== origin.dev || row.postimage.ino !== origin.ino) return refuse();
  }
  if (row.role === "bootstrap_lock") {
    if (row.postimage.kind !== "regular_file" || row.postimage.dev !== plan.bootstrapIdentity.dev || row.postimage.ino !== plan.bootstrapIdentity.ino || row.postimage.ownerUid !== plan.bootstrapIdentity.ownerUid) return refuse();
  }
  if (row.role === "staging_subtree" && row.postimage.kind !== "directory_tree") return refuse();
  if (row.role === "manifest_bootstrap") {
    const before = plan.manifest.before;
    if (
      before.state !== "present" ||
      before.dev === null ||
      before.ino === null ||
      row.postimage.kind !== "regular_file" ||
      row.postimage.ownerUid !== before.ownerUid ||
      row.postimage.mode !== before.mode ||
      row.postimage.bytes !== before.size ||
      row.postimage.sha256 !== before.hash ||
      row.postimage.dev !== before.dev ||
      row.postimage.ino !== before.ino
    ) return refuse();
  }
  if (row.role === "payload" || row.role === "foundation_bootstrap") {
    if (authority.payloadOrdinal === undefined || row.postimage.kind !== "regular_file") return refuse();
    const admitted = payloadRetentionEvidence(payloadEvidence, authority.payloadOrdinal).value;
    if (
      row.postimage.ownerUid !== plan.bootstrapIdentity.ownerUid ||
      row.postimage.mode !== admitted.mode ||
      row.postimage.bytes !== String(admitted.bytes) ||
      row.postimage.sha256 !== admitted.sha256 ||
      row.postimage.dev !== admitted.dev ||
      row.postimage.ino !== admitted.ino
    ) return refuse();
  }
  if (row.role === "payload_evidence") {
    if (authority.payloadOrdinal === undefined || row.postimage.kind !== "regular_file") return refuse();
    const admitted = payloadRetentionEvidence(payloadEvidence, authority.payloadOrdinal);
    const canonicalText = encodeCanonicalJson(admitted.value as unknown as CanonicalJsonValue);
    if (
      row.postimage.ownerUid !== admitted.evidenceIdentity.ownerUid ||
      row.postimage.mode !== admitted.evidenceIdentity.mode ||
      row.postimage.bytes !== String(encoder.encode(canonicalText).byteLength) ||
      row.postimage.sha256 !== hashCanonicalText(canonicalText) ||
      row.postimage.dev !== admitted.evidenceIdentity.dev ||
      row.postimage.ino !== admitted.evidenceIdentity.ino
    ) return refuse();
  }
  if (row.role === "creation_evidence") {
    if (authority.scope === undefined || authority.ordinal === undefined || row.postimage.kind !== "regular_file") return refuse();
    const admitted = createdPathEvidence.find((candidate) =>
      candidate.value.scope === authority.scope && candidate.value.ordinal === authority.ordinal,
    );
    if (admitted === undefined) return refuse();
    const canonicalText = encodeCanonicalJson(admitted.value as unknown as CanonicalJsonValue);
    const canonicalBytes = encoder.encode(canonicalText);
    if (
      row.postimage.ownerUid !== admitted.evidenceIdentity.ownerUid ||
      row.postimage.mode !== admitted.evidenceIdentity.mode ||
      row.postimage.bytes !== String(canonicalBytes.byteLength) ||
      row.postimage.sha256 !== hashCanonicalText(canonicalText) ||
      row.postimage.dev !== admitted.evidenceIdentity.dev ||
      row.postimage.ino !== admitted.evidenceIdentity.ino
    ) return refuse();
  }
}

function sameDirectoryEntryPostimage(
  entry: BootstrapRetentionDirectoryEntryV1,
  postimage: BootstrapRetentionPostimageV1,
): boolean {
  if (entry.kind === "regular_file") {
    return postimage.kind === "regular_file" &&
      postimage.ownerUid === entry.ownerUid &&
      postimage.mode === entry.mode &&
      postimage.bytes === entry.bytes &&
      postimage.sha256 === entry.sha256 &&
      postimage.dev === entry.dev &&
      postimage.ino === entry.ino;
  }
  return postimage.kind === "directory_tree" &&
    postimage.ownerUid === entry.ownerUid &&
    postimage.nlink === entry.nlink &&
    postimage.dev === entry.dev &&
    postimage.ino === entry.ino;
}

function verifyDirectoryTrees(
  rows: readonly {
    readonly role: BootstrapRetentionRoleV1;
    readonly sourcePath: CanonicalAbsolutePathV1;
    readonly parent: BootstrapRetentionParentIdentityV1;
    readonly postimage: BootstrapRetentionPostimageV1;
  }[],
  maximalRoots: readonly (typeof rows)[number][],
  value: unknown,
): readonly BootstrapRetentionDirectoryTreeEvidenceV1[] {
  if (!Array.isArray(value)) return refuse();
  const trees = value.map(validateDirectoryTreeEvidence);
  if (new Set(trees.map((tree) => tree.rootPath)).size !== trees.length) return refuse();
  if (!sameStringSet(
    new Set(trees.map((tree) => tree.rootPath)),
    new Set(maximalRoots.map((root) => root.sourcePath)),
  )) return refuse();
  for (const root of maximalRoots) {
    if (root.postimage.kind !== "directory_tree") return refuse();
    const tree = trees.find((candidate) => candidate.rootPath === root.sourcePath);
    if (tree === undefined) return refuse();
    let regularFileBytes = 0n;
    for (const entry of tree.entries) {
      if (entry.kind === "regular_file") {
        regularFileBytes += BigInt(entry.bytes);
        if (regularFileBytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) return refuse();
      }
    }
    if (
      root.postimage.treeHash !== retainedTreeHash(tree.entries) ||
      root.postimage.entryCount !== tree.entries.length ||
      root.postimage.regularFileBytes !== regularFileBytes.toString() ||
      root.postimage.entries === undefined ||
      !sameValue(root.postimage.entries, tree.entries)
    ) return refuse();
    for (const row of rows) {
      if (row.sourcePath === root.sourcePath || !row.sourcePath.startsWith(`${root.sourcePath}/`)) continue;
      const relativePath = row.sourcePath.slice(root.sourcePath.length + 1);
      const entry = tree.entries.find((candidate) => candidate.relativePath === relativePath);
      if (entry === undefined || !sameDirectoryEntryPostimage(entry, row.postimage)) return refuse();
    }
    for (const entry of tree.entries) {
      const sourcePath = `${root.sourcePath}/${entry.relativePath}`;
      const row = rows.find((candidate) => candidate.sourcePath === sourcePath);
      if (row === undefined || !sameDirectoryEntryPostimage(entry, row.postimage)) return refuse();
    }
  }
  return trees;
}

/**
 * Keyed on both argument identities, which are immutable once admitted. The
 * derivation is pure, and one `developer-os init` asked for the same table 1,475
 * times while validating journals, re-verifying every evidence row each time. A
 * different plan or evidence object derives again, so nothing is shared across
 * identities and a refusal is never cached.
 */
const retentionTables = new WeakMap<object, WeakMap<object, readonly BootstrapRetentionEntryV1[]>>();

export function deriveBootstrapRetentionTable(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
): readonly BootstrapRetentionEntryV1[] {
  const planKey = plan as unknown as object;
  const evidenceKey = evidence as unknown as object;
  const cached = retentionTables.get(planKey)?.get(evidenceKey);
  if (cached !== undefined) return cached;
  const derived = deriveBootstrapRetentionTableUncached(plan, evidence);
  let perPlan = retentionTables.get(planKey);
  if (perPlan === undefined) {
    perPlan = new WeakMap<object, readonly BootstrapRetentionEntryV1[]>();
    retentionTables.set(planKey, perPlan);
  }
  perPlan.set(evidenceKey, derived);
  return derived;
}

function deriveBootstrapRetentionTableUncached(
  plan: BootstrapRetainedExecutionPlanV1,
  evidence: BootstrapRetentionEvidenceProjectionV1,
): readonly BootstrapRetentionEntryV1[] {
  if (
    evidence.bootstrapId !== plan.id ||
    evidence.terminalJournal === null ||
    !Array.isArray(evidence.rows) ||
    !Array.isArray(evidence.payloadEvidence) ||
    !(evidence.interruptedPayload === null || typeof evidence.interruptedPayload === "object") ||
    !Array.isArray(evidence.createdPathEvidence) ||
    !Array.isArray(evidence.foundationEvidence) ||
    !Array.isArray(evidence.directoryTrees)
  ) return refuse();
  const terminalJournal = terminalRetentionJournal(plan, evidence.terminalJournal);
  const interruptedPayload = validateInterruptedPayloadRetentionEvidence(
    plan,
    terminalJournal,
    evidence.interruptedPayload,
  );
  const applicableAuthorities = authorities(plan, terminalJournal, interruptedPayload);
  const expectedAuthorityKeys = new Set(applicableAuthorities.map(authorityKey));
  if (expectedAuthorityKeys.size !== applicableAuthorities.length) return refuse();
  const payloadEvidence = validatePayloadRetentionEvidence(plan, terminalJournal, evidence.payloadEvidence);
  const foundationEvidence = validateFoundationTerminalEvidence(
    plan,
    terminalJournal,
    payloadEvidence,
    evidence.foundationEvidence,
  );
  const createdPathEvidence = evidence.createdPathEvidence.map((value) => validateCreatedPathRetentionEvidence(plan, value));
  if (new Set(createdPathEvidence.map((row) => `${row.value.scope}:${String(row.value.ordinal)}`)).size !== createdPathEvidence.length) return refuse();
  const expectedCreatedEvidence = new Set(applicableAuthorities
    .filter((authority) => authority.role === "creation_evidence")
    .map((authority) => `${authority.scope as string}:${String(authority.ordinal)}`));
  if (
    !sameStringSet(new Set(createdPathEvidence.map((row) => `${row.value.scope}:${String(row.value.ordinal)}`)), expectedCreatedEvidence)
  ) return refuse();
  const roles = Object.keys(ROLE_ORDER);
  const rows = evidence.rows.map((candidate) => {
    const input = record(candidate);
    exact(input, ["parent", "postimage", "role", "sourcePath"]);
    if (typeof input.role !== "string" || !roles.includes(input.role)) return refuse();
    const sourcePath = canonicalPath(input.sourcePath);
    return {
      role: input.role as BootstrapRetentionRoleV1,
      sourcePath,
      parent: validateParent(input.parent, sourcePath),
      postimage: validatePostimage(input.postimage, sourcePath),
    };
  });
  if (new Set(rows.map((row) => row.sourcePath)).size !== rows.length) return refuse();
  if (!sameStringSet(new Set(rows.map(authorityKey)), expectedAuthorityKeys)) return refuse();
  for (const row of rows) {
    const authority = applicableAuthorities.find((candidate) => authorityKey(candidate) === authorityKey(row));
    if (authority === undefined) return refuse();
    verifyAuthority(plan, authority, row, payloadEvidence, createdPathEvidence, foundationEvidence);
  }

  const directoryRoots = rows
    .filter((row) => row.postimage.kind === "directory_tree")
    .sort((left, right) => left.sourcePath.length - right.sourcePath.length || compareUtf8(left.sourcePath, right.sourcePath));
  const maximalRoots = directoryRoots.filter((row, index) =>
    !directoryRoots.slice(0, index).some((ancestor) => row.sourcePath.startsWith(`${ancestor.sourcePath}/`)),
  );
  const directoryTrees = verifyDirectoryTrees(rows, maximalRoots, evidence.directoryTrees);
  const collapsed = rows.filter((row) =>
    !maximalRoots.some((root) => row.sourcePath !== root.sourcePath && row.sourcePath.startsWith(`${root.sourcePath}/`)),
  );

  const identities = new Set<string>();
  for (const tree of directoryTrees) {
    for (const entry of tree.entries) {
      const identity = `${entry.dev}:${entry.ino}`;
      if (identities.has(identity)) return refuse();
      identities.add(identity);
    }
  }
  for (const row of collapsed) {
    const identity = `${row.postimage.dev}:${row.postimage.ino}`;
    if (identities.has(identity)) return refuse();
    identities.add(identity);
  }

  collapsed.sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || compareUtf8(left.sourcePath, right.sourcePath));
  const table = collapsed.map((row, ordinal): BootstrapRetentionEntryV1 => {
    let postimage = row.postimage;
    if (postimage.kind === "directory_tree") {
      const tree = directoryTrees.find((candidate) => candidate.rootPath === row.sourcePath);
      if (tree === undefined) return refuse();
      postimage = { ...postimage, entries: tree.entries };
    }
    return {
      schemaVersion: 1,
      bootstrapId: plan.id,
      ordinal,
      role: row.role,
      sourcePath: row.sourcePath,
      tombstonePath: `${dirname(row.sourcePath)}/.developer-os-retained.${plan.id}.${String(ordinal).padStart(10, "0")}.tombstone` as CanonicalAbsolutePathV1,
      parent: row.parent,
      postimage,
    };
  });
  const sources = new Set(table.map((row) => row.sourcePath));
  const destinations = new Set<string>();
  for (const row of table) {
    if (destinations.has(row.tombstonePath) || sources.has(row.tombstonePath)) return refuse();
    destinations.add(row.tombstonePath);
  }
  const descendantCount = directoryTrees.reduce((total, tree) => total + tree.entries.length, 0);
  const maximumStagingEntries = integer(
    plan.maximumStagingEntries,
    0,
    BOOTSTRAP_RETAINED_MAX_ENTRIES,
  );
  if (descendantCount > maximumStagingEntries) return refuse();
  let regularFileBytes = 0n;
  for (const row of table) {
    regularFileBytes += BigInt(row.postimage.kind === "regular_file"
      ? row.postimage.bytes
      : row.postimage.regularFileBytes);
    if (regularFileBytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) return refuse();
  }
  assertBootstrapRetentionCapacity({
    ids: 1,
    entries: table.length + descendantCount,
    bytes: regularFileBytes.toString() as UInt64DecimalV1,
  });
  return structuredClone(table);
}

export function classifyBootstrapEvidence(input: BootstrapEvidenceClassificationInputV1): BootstrapEvidenceSummaryV1 {
  canonicalPath(input.planPath);
  if (!Array.isArray(input.expectedRows)) return refuse();
  const expected = input.expectedRows.length;
  const matching = integer(input.matchingRows, 0, expected);
  const altered = integer(input.alteredRows, 0, expected);
  integer(input.unboundEntries, 0, BOOTSTRAP_RETAINED_MAX_ENTRIES);
  const entryCount = integer(input.entryCount, 0, BOOTSTRAP_RETAINED_MAX_ENTRIES);
  const regularFileBytes = uint64(input.regularFileBytes);
  if (matching + altered > expected || typeof input.confinedToRetainedNamespace !== "boolean") return refuse();

  let status: BootstrapEvidenceSummaryV1["status"];
  let terminalOutcome: BootstrapEvidenceSummaryV1["terminalOutcome"] = null;
  const current = input.journal?.current;
  if (current === undefined || current.id !== input.id) {
    status = "unverified";
  } else {
    terminalOutcome = current.terminalOutcome;
    if (terminalOutcome !== input.terminalOutcome) return refuse();
    if (current.phase !== "retained") {
      status = "incomplete";
    } else if (matching === expected && altered === 0 && input.unboundEntries === 0 && input.confinedToRetainedNamespace) {
      status = "verified";
    } else {
      status = "altered";
    }
  }
  return {
    id: input.id,
    status,
    operation: input.operation,
    terminalOutcome,
    vaultPath: input.planPath,
    entryCount,
    regularFileBytes,
  };
}

export function assertBootstrapRetentionCapacity(value: BootstrapRetentionCapacityV1): BootstrapRetentionCapacityV1 {
  const ids = integer(value.ids, 0, BOOTSTRAP_RETAINED_MAX_IDS);
  const entries = integer(value.entries, 0, BOOTSTRAP_RETAINED_MAX_ENTRIES);
  const bytes = uint64(value.bytes);
  const parsedBytes = BigInt(bytes);
  if (parsedBytes > MAX_UINT64 || parsedBytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) return refuse("retained bootstrap aggregate capacity exceeded");
  return { ids, entries, bytes };
}
