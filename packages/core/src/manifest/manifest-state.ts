import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { EXIT_CODES } from "../result.js";
import {
  admitCanonicalAbsolutePath,
  deriveBootstrapPayloadPath,
  deriveManifestPayloadPath,
  type BootstrapPayloadPathV1,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type ManifestPayloadPathV1,
} from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "../update/scalars.js";
import type { ManifestAdmissionContextV1 } from "./types.js";
import { validateManifestBytes } from "./v2.js";

const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_PLAN_BYTES = 16_777_216;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_FOUNDATION_TRANSACTIONS = 1_000_000;
const MAX_BOOTSTRAP_ORDINAL = 999_999;
const MAX_UPDATE_ORDINAL = 1_099_999;
const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const FILE_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const encoder = new TextEncoder();

export type ManifestParticipantIdV1 = string & {
  readonly __manifestParticipantIdV1: unique symbol;
};
export type FreshV2InitIdV1 = string & {
  readonly __freshV2InitIdV1: unique symbol;
};
export type ManifestMigrationIdV1 = string & {
  readonly __manifestMigrationIdV1: unique symbol;
};
export type LifecycleCoordinatorIdV1 = string & {
  readonly __lifecycleCoordinatorIdV1: unique symbol;
};

export interface BootstrapExpectedPayloadRefV1 {
  readonly kind: "bootstrap_expected";
  readonly bootstrapId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly ordinal: number;
  readonly path: BootstrapPayloadPathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 0o600;
}

export interface UpdateExpectedPayloadRefV1 {
  readonly kind: "update_expected";
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly ordinal: number;
  readonly path: CanonicalAbsolutePathV1;
  readonly hash: LowerHexSha256;
  readonly bytes: number;
  readonly mode: 0o600;
}

export type ManifestPayloadRefV1 =
  | BootstrapExpectedPayloadRefV1
  | (UpdateExpectedPayloadRefV1 & { readonly path: ManifestPayloadPathV1 });

export type ManifestBytesStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly hash: LowerHexSha256;
      readonly bytes: ManifestPayloadRefV1 | null;
      readonly ownerUid: number;
      readonly mode: 0o600;
      readonly nlink: 1;
      readonly size: UInt64DecimalV1;
      readonly dev: UInt64DecimalV1 | null;
      readonly ino: UInt64DecimalV1 | null;
    };

export interface ManifestExternalEffectRefV1 {
  readonly kind: "codex_registration" | "git" | "launchd";
  readonly id: string;
  readonly planHash: LowerHexSha256;
}

export type ManifestEnvelopeV1 =
  | { readonly kind: "fresh_v2_init"; readonly id: FreshV2InitIdV1 }
  | { readonly kind: "v1_migration"; readonly id: ManifestMigrationIdV1 }
  | { readonly kind: "lifecycle"; readonly id: LifecycleCoordinatorIdV1 };

export interface ManifestStatePlanV1 {
  readonly schemaVersion: 1;
  readonly participantId: ManifestParticipantIdV1;
  readonly envelope: ManifestEnvelopeV1;
  readonly bindings: {
    readonly foundationTransactions: {
      readonly count: number;
      readonly orderedIdsHash: LowerHexSha256;
    };
    readonly externalEffects: readonly ManifestExternalEffectRefV1[];
  };
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: ManifestBytesStateV1;
  readonly after: ManifestBytesStateV1;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

export interface ManifestPayloadIdentityV1 {
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ManifestStatePlanAdmissionContextV1 {
  readonly evidence: CanonicalPathEvidenceV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly manifestPath: CanonicalAbsolutePathV1;
  readonly foundationTransactionIds: readonly string[];
  readonly externalEffects: readonly ManifestExternalEffectRefV1[];
  readonly admitParticipant: (
    envelope: ManifestEnvelopeV1,
    participantId: unknown,
  ) => ManifestParticipantIdV1;
  readonly admitExternalEffect: (value: ManifestExternalEffectRefV1) => string;
  readonly bootstrapPayloadIdentity?: (
    value: BootstrapExpectedPayloadRefV1,
  ) => ManifestPayloadIdentityV1 | null;
  readonly updatePayloadIdentity?: (
    value: UpdateExpectedPayloadRefV1,
  ) => ManifestPayloadIdentityV1;
}

export interface ManifestFileIdentityV1 {
  readonly hash: LowerHexSha256;
  readonly ownerUid: number;
  readonly mode: 0o600;
  readonly nlink: 1;
  readonly size: UInt64DecimalV1;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
}

export interface ManifestStateParticipantDependencies {
  readonly fs: {
    readonly lstat: (path: string) => Promise<Stats>;
    readonly open: (path: string, flags: number) => Promise<FileHandle>;
  };
  readonly guardedMoveNoReplace: (
    source: CanonicalAbsolutePathV1,
    destination: CanonicalAbsolutePathV1,
    expected: ManifestFileIdentityV1,
  ) => Promise<void>;
  readonly guardedUnlinkExact: (
    path: CanonicalAbsolutePathV1,
    expected: ManifestFileIdentityV1,
  ) => Promise<void>;
  readonly admission: ManifestStatePlanAdmissionContextV1;
  readonly uid: number;
  readonly manifestAdmission?: ManifestAdmissionContextV1;
}

export type ManifestParticipantObservationV1 = {
  readonly state: "before" | "preimage_preserved" | "applied" | "compensated";
};

export class ManifestStateParticipantError extends Error {
  readonly code = EXIT_CODES.recoveryRequired;

  constructor(message = "manifest direct-write state is malformed or conflicted") {
    super(message);
    this.name = "ManifestStateParticipantError";
  }
}

type PresentManifestState = Extract<ManifestBytesStateV1, { readonly state: "present" }>;
type PhysicalPathState = "missing" | "before" | "after" | "third";
type InventoryClassification =
  | "before"
  | "preimage_preserved"
  | "applied"
  | "compaction_pending"
  | "unlisted";

interface ManifestInventory {
  readonly manifest: PhysicalPathState;
  readonly tombstone: PhysicalPathState;
  readonly payload: PhysicalPathState;
}

interface ExpectedFileState {
  readonly label: "before" | "after";
  readonly state: PresentManifestState;
}

interface ValidatedPayload {
  readonly ref: ManifestPayloadRefV1;
  readonly identity: ManifestPayloadIdentityV1;
}

function refuse(): never {
  throw new ManifestStateParticipantError();
}

function normalizeFailure(error: unknown): never {
  if (error instanceof ManifestStateParticipantError) throw error;
  return refuse();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse();
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    refuse();
  }
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    refuse();
  }
  return value;
}

function lowerHexSha256(value: unknown): LowerHexSha256 {
  try {
    return parseLowerHexSha256(value);
  } catch {
    return refuse();
  }
}

function uint64(value: unknown): UInt64DecimalV1 {
  try {
    return parseUInt64Decimal(value);
  } catch {
    return refuse();
  }
}

function participantEnvelope(value: unknown): ManifestEnvelopeV1 {
  const input = record(value);
  requireExactKeys(input, ["id", "kind"]);
  if (typeof input.id !== "string") refuse();

  if (input.kind === "fresh_v2_init") {
    return { kind: input.kind, id: input.id as FreshV2InitIdV1 };
  }
  if (input.kind === "v1_migration") {
    return { kind: input.kind, id: input.id as ManifestMigrationIdV1 };
  }
  if (input.kind === "lifecycle") {
    return { kind: input.kind, id: input.id as LifecycleCoordinatorIdV1 };
  }
  return refuse();
}

function payloadIdentity(value: unknown): ManifestPayloadIdentityV1 {
  const input = record(value);
  requireExactKeys(input, ["dev", "ino"]);
  return { dev: uint64(input.dev), ino: uint64(input.ino) };
}

function validatePayloadRef(
  value: unknown,
  envelope: ManifestEnvelopeV1,
  participantId: ManifestParticipantIdV1,
  context: ManifestStatePlanAdmissionContextV1,
): ValidatedPayload {
  const input = record(value);

  if (input.kind === "update_expected") {
    requireExactKeys(input, ["bytes", "coordinatorId", "hash", "kind", "mode", "ordinal", "path"]);
    if (
      envelope.kind !== "lifecycle" ||
      input.coordinatorId !== envelope.id ||
      input.mode !== 0o600 ||
      context.updatePayloadIdentity === undefined
    ) {
      refuse();
    }
    const ref: UpdateExpectedPayloadRefV1 & { readonly path: ManifestPayloadPathV1 } = {
      kind: "update_expected",
      coordinatorId: input.coordinatorId as LifecycleCoordinatorIdV1,
      ordinal: integer(input.ordinal, 0, MAX_UPDATE_ORDINAL),
      path: admitCanonicalAbsolutePath(input.path, context.evidence) as ManifestPayloadPathV1,
      hash: lowerHexSha256(input.hash),
      bytes: integer(input.bytes, 0, MAX_MANIFEST_BYTES),
      mode: 0o600,
    };
    const expectedPath = deriveManifestPayloadPath(
      context.productHome,
      ref.coordinatorId as never,
      participantId as never,
    );
    if (ref.path !== expectedPath) refuse();
    return { ref, identity: payloadIdentity(context.updatePayloadIdentity(ref)) };
  }

  if (input.kind === "bootstrap_expected") {
    requireExactKeys(input, ["bootstrapId", "bytes", "hash", "kind", "mode", "ordinal", "path"]);
    if (
      envelope.kind === "lifecycle" ||
      input.bootstrapId !== envelope.id ||
      input.mode !== 0o600 ||
      context.bootstrapPayloadIdentity === undefined
    ) {
      refuse();
    }
    const ref: BootstrapExpectedPayloadRefV1 = {
      kind: "bootstrap_expected",
      bootstrapId: input.bootstrapId as FreshV2InitIdV1 | ManifestMigrationIdV1,
      ordinal: integer(input.ordinal, 0, MAX_BOOTSTRAP_ORDINAL),
      path: admitCanonicalAbsolutePath(input.path, context.evidence) as BootstrapPayloadPathV1,
      hash: lowerHexSha256(input.hash),
      bytes: integer(input.bytes, 0, MAX_MANIFEST_BYTES),
      mode: 0o600,
    };
    const operation = envelope.kind === "fresh_v2_init" ? "fresh_v2_init" : "v1_to_v2";
    const expectedPath = deriveBootstrapPayloadPath(
      context.productHome,
      operation,
      ref.bootstrapId as never,
      ref.ordinal,
    );
    if (ref.path !== expectedPath) refuse();
    const evidence = context.bootstrapPayloadIdentity(ref);
    if (evidence === null) refuse();
    return { ref, identity: payloadIdentity(evidence) };
  }

  return refuse();
}

function validateManifestBytesState(
  value: unknown,
  role: "before" | "after",
  envelope: ManifestEnvelopeV1,
  participantId: ManifestParticipantIdV1,
  context: ManifestStatePlanAdmissionContextV1,
): ManifestBytesStateV1 {
  const input = record(value);
  if (input.state === "absent") {
    requireExactKeys(input, ["state"]);
    return { state: "absent" };
  }

  requireExactKeys(input, ["bytes", "dev", "hash", "ino", "mode", "nlink", "ownerUid", "size", "state"]);
  if (input.state !== "present" || input.mode !== 0o600 || input.nlink !== 1) refuse();
  const ownerUid = integer(input.ownerUid, 0, Number.MAX_SAFE_INTEGER);
  const size = uint64(input.size);
  if (BigInt(size) > BigInt(MAX_MANIFEST_BYTES)) refuse();

  const bothIdentitiesNull = input.dev === null && input.ino === null;
  if ((input.dev === null) !== (input.ino === null)) refuse();
  if (role === "before" && (input.bytes !== null || bothIdentitiesNull)) refuse();
  if (
    role === "after" &&
    (input.bytes === null || (envelope.kind === "lifecycle" ? bothIdentitiesNull : !bothIdentitiesNull))
  ) {
    refuse();
  }

  const decodedPayload = input.bytes === null
    ? null
    : validatePayloadRef(input.bytes, envelope, participantId, context);
  const state: PresentManifestState = {
    state: "present",
    hash: lowerHexSha256(input.hash),
    bytes: decodedPayload?.ref ?? null,
    ownerUid,
    mode: 0o600,
    nlink: 1,
    size,
    dev: bothIdentitiesNull ? null : uint64(input.dev),
    ino: bothIdentitiesNull ? null : uint64(input.ino),
  };

  if (role === "after") {
    if (
      decodedPayload === null ||
      decodedPayload.ref.hash !== state.hash ||
      BigInt(decodedPayload.ref.bytes) !== BigInt(state.size)
    ) {
      refuse();
    }
    if (
      decodedPayload.ref.kind === "update_expected" &&
      (decodedPayload.identity.dev !== state.dev || decodedPayload.identity.ino !== state.ino)
    ) {
      refuse();
    }
  }

  return state;
}

function foundationBindingsHash(ids: readonly string[]): LowerHexSha256 {
  return createHash("sha256")
    .update("developer-os/manifest-foundation-bindings/v1\0")
    .update(JSON.stringify(ids))
    .digest("hex") as LowerHexSha256;
}

function validateFoundationBindings(
  value: unknown,
  context: ManifestStatePlanAdmissionContextV1,
): { readonly count: number; readonly orderedIdsHash: LowerHexSha256 } {
  const input = record(value);
  requireExactKeys(input, ["count", "orderedIdsHash"]);
  const count = integer(input.count, 0, MAX_FOUNDATION_TRANSACTIONS);
  const orderedIdsHash = lowerHexSha256(input.orderedIdsHash);
  if (
    context.foundationTransactionIds.length > MAX_FOUNDATION_TRANSACTIONS ||
    new Set(context.foundationTransactionIds).size !== context.foundationTransactionIds.length ||
    count !== context.foundationTransactionIds.length ||
    orderedIdsHash !== foundationBindingsHash(context.foundationTransactionIds)
  ) {
    refuse();
  }
  return { count, orderedIdsHash };
}

function externalEffectRef(value: unknown): ManifestExternalEffectRefV1 {
  const input = record(value);
  requireExactKeys(input, ["id", "kind", "planHash"]);
  if (
    (input.kind !== "codex_registration" && input.kind !== "git" && input.kind !== "launchd") ||
    typeof input.id !== "string"
  ) {
    refuse();
  }
  return {
    kind: input.kind,
    id: input.id,
    planHash: lowerHexSha256(input.planHash),
  };
}

function sameExternalEffect(
  left: ManifestExternalEffectRefV1,
  right: ManifestExternalEffectRefV1,
): boolean {
  return left.kind === right.kind && left.id === right.id && left.planHash === right.planHash;
}

function validateExternalEffects(
  value: unknown,
  envelope: ManifestEnvelopeV1,
  context: ManifestStatePlanAdmissionContextV1,
): readonly ManifestExternalEffectRefV1[] {
  if (!Array.isArray(value) || value.length > 1) refuse();
  if (envelope.kind !== "lifecycle" && value.length !== 0) refuse();
  const refs = value.map((item) => externalEffectRef(item));
  for (const ref of refs) {
    if (context.admitExternalEffect(ref) !== ref.id) refuse();
  }
  if (
    refs.length !== context.externalEffects.length ||
    refs.some((ref, index) => !sameExternalEffect(ref, context.externalEffects[index] as ManifestExternalEffectRefV1))
  ) {
    refuse();
  }
  return refs;
}

export function validateManifestStatePlan(
  value: unknown,
  context: ManifestStatePlanAdmissionContextV1,
): ManifestStatePlanV1 {
  try {
    const input = record(value);
    requireExactKeys(input, [
      "after",
      "before",
      "bindings",
      "envelope",
      "manifestPath",
      "maximumJournalBytes",
      "maximumPlanBytes",
      "participantId",
      "schemaVersion",
      "tombstonePath",
    ]);
    if (input.schemaVersion !== 1 || typeof input.participantId !== "string") refuse();

    const envelope = participantEnvelope(input.envelope);
    const participantId = context.admitParticipant(envelope, input.participantId);
    if (participantId !== input.participantId) refuse();

    const manifestPath = admitCanonicalAbsolutePath(input.manifestPath, context.evidence);
    if (manifestPath !== context.manifestPath) refuse();
    const tombstonePath = admitCanonicalAbsolutePath(input.tombstonePath, context.evidence);
    const expectedTombstone = join(
      dirname(manifestPath),
      `.installation-manifest.${participantId}.json.tombstone`,
    );
    if (tombstonePath !== expectedTombstone) refuse();

    const bindings = record(input.bindings);
    requireExactKeys(bindings, ["externalEffects", "foundationTransactions"]);
    const foundationTransactions = validateFoundationBindings(
      bindings.foundationTransactions,
      context,
    );
    const externalEffects = validateExternalEffects(bindings.externalEffects, envelope, context);
    const before = validateManifestBytesState(
      input.before,
      "before",
      envelope,
      participantId,
      context,
    );
    const after = validateManifestBytesState(
      input.after,
      "after",
      envelope,
      participantId,
      context,
    );
    if (envelope.kind !== "lifecycle" && after.state === "absent") refuse();

    const plan: ManifestStatePlanV1 = {
      schemaVersion: 1,
      participantId,
      envelope,
      bindings: { foundationTransactions, externalEffects },
      manifestPath,
      tombstonePath,
      before,
      after,
      maximumPlanBytes: integer(input.maximumPlanBytes, 1, MAX_PLAN_BYTES),
      maximumJournalBytes: integer(input.maximumJournalBytes, 1, MAX_JOURNAL_BYTES),
    };
    const persistedBytes = encoder.encode(encodeCanonicalJson(plan as never));
    if (persistedBytes.byteLength > plan.maximumPlanBytes) refuse();
    return structuredClone(plan);
  } catch (error) {
    return normalizeFailure(error);
  }
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR")
  );
}

function sameDescriptor(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function expectedSlot(state: ManifestBytesStateV1): PhysicalPathState {
  return state.state === "present" ? "before" : "missing";
}

function expectedAfterSlot(state: ManifestBytesStateV1): PhysicalPathState {
  return state.state === "present" ? "after" : "missing";
}

function inventoryEquals(left: ManifestInventory, right: ManifestInventory): boolean {
  return (
    left.manifest === right.manifest &&
    left.tombstone === right.tombstone &&
    left.payload === right.payload
  );
}

function beforeInventory(plan: ManifestStatePlanV1): ManifestInventory {
  return {
    manifest: expectedSlot(plan.before),
    tombstone: "missing",
    payload: expectedAfterSlot(plan.after),
  };
}

function preimageInventory(plan: ManifestStatePlanV1): ManifestInventory | null {
  if (plan.before.state !== "present") return null;
  return {
    manifest: "missing",
    tombstone: "before",
    payload: expectedAfterSlot(plan.after),
  };
}

function appliedInventory(plan: ManifestStatePlanV1): ManifestInventory {
  return {
    manifest: expectedAfterSlot(plan.after),
    tombstone: plan.before.state === "present" ? "before" : "missing",
    payload: "missing",
  };
}

function compactionPendingInventory(plan: ManifestStatePlanV1): ManifestInventory | null {
  if (plan.before.state !== "present") return null;
  return {
    manifest: expectedAfterSlot(plan.after),
    tombstone: "missing",
    payload: "missing",
  };
}

function classifyInventory(
  plan: ManifestStatePlanV1,
  inventory: ManifestInventory,
): InventoryClassification {
  if (inventoryEquals(inventory, beforeInventory(plan))) return "before";
  const preimage = preimageInventory(plan);
  if (preimage !== null && inventoryEquals(inventory, preimage)) return "preimage_preserved";
  if (inventoryEquals(inventory, appliedInventory(plan))) return "applied";
  const compactionPending = compactionPendingInventory(plan);
  if (compactionPending !== null && inventoryEquals(inventory, compactionPending)) {
    return "compaction_pending";
  }
  return "unlisted";
}

export class ManifestStateParticipant {
  constructor(readonly dependencies: ManifestStateParticipantDependencies) {}

  async observe(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    try {
      const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
      const classification = classifyInventory(admitted, await this.inventory(admitted));
      if (classification === "before") return { state: "before" };
      if (classification === "preimage_preserved") return { state: "preimage_preserved" };
      if (classification === "applied") return { state: "applied" };
      return refuse();
    } catch (error) {
      return normalizeFailure(error);
    }
  }

  async apply(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    try {
      const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
      const inventory = await this.inventory(admitted);
      let classification = classifyInventory(admitted, inventory);

      if (inventoryEquals(inventory, appliedInventory(admitted))) {
        await this.adoptAppliedTransition(admitted);
        await this.requireAppliedInventory(admitted);
        return { state: "applied" };
      }

      if (classification === "before") {
        if (admitted.before.state === "present") {
          await this.moveAndMakeDurable(
            admitted.manifestPath,
            admitted.tombstonePath,
            admitted.before,
          );
          await this.requirePreimageInventory(admitted);
          classification = "preimage_preserved";
        }
      } else if (classification === "preimage_preserved") {
        await this.adoptApplyPreimageTransition(admitted);
      } else {
        return refuse();
      }

      if (admitted.after.state === "present") {
        if (admitted.after.bytes === null) return refuse();
        await this.moveAndMakeDurable(
          admitted.after.bytes.path,
          admitted.manifestPath,
          admitted.after,
        );
        await this.requireAppliedInventory(admitted);
      } else if (classification === "preimage_preserved") {
        await this.requirePreimageInventory(admitted);
      } else {
        await this.requireBeforeInventory(admitted);
      }

      return { state: "applied" };
    } catch (error) {
      return normalizeFailure(error);
    }
  }

  async compensate(plan: ManifestStatePlanV1): Promise<ManifestParticipantObservationV1> {
    try {
      const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
      const inventory = await this.inventory(admitted);
      const classification = classifyInventory(admitted, inventory);

      if (classification === "before") {
        await this.adoptCompensatedTransition(admitted);
        await this.requireBeforeInventory(admitted);
        return { state: "compensated" };
      }

      if (classification === "preimage_preserved") {
        await this.adoptAmbiguousCompensationPreimageTransition(admitted);
        await this.restorePreimage(admitted);
        await this.requireBeforeInventory(admitted);
        return { state: "compensated" };
      }

      if (classification !== "applied") return refuse();
      await this.adoptAppliedTransition(admitted);

      if (admitted.after.state === "present") {
        if (admitted.after.bytes === null) return refuse();
        await this.moveAndMakeDurable(
          admitted.manifestPath,
          admitted.after.bytes.path,
          admitted.after,
        );
      }
      if (admitted.before.state === "present") await this.restorePreimage(admitted);
      await this.requireBeforeInventory(admitted);
      return { state: "compensated" };
    } catch (error) {
      return normalizeFailure(error);
    }
  }

  async compact(plan: ManifestStatePlanV1): Promise<void> {
    try {
      const admitted = validateManifestStatePlan(plan, this.dependencies.admission);
      const inventory = await this.inventory(admitted);
      const compactionPending = compactionPendingInventory(admitted);
      if (compactionPending !== null && inventoryEquals(inventory, compactionPending)) {
        await this.makeUnlinkDurable(admitted.tombstonePath);
        await this.requireCompactionPendingInventory(admitted);
        return;
      }

      if (!inventoryEquals(inventory, appliedInventory(admitted))) return refuse();
      await this.adoptAppliedTransition(admitted);
      await this.requireAppliedInventory(admitted);
      if (admitted.before.state === "absent") return;

      await this.unlinkAndMakeDurable(
        admitted.tombstonePath,
        this.fileIdentity(admitted.before),
      );
      await this.requireCompactionPendingInventory(admitted);
    } catch (error) {
      normalizeFailure(error);
    }
  }

  private async inventory(plan: ManifestStatePlanV1): Promise<ManifestInventory> {
    const manifestCandidates: ExpectedFileState[] = [];
    if (plan.before.state === "present") {
      manifestCandidates.push({ label: "before", state: plan.before });
    }
    if (plan.after.state === "present") {
      manifestCandidates.push({ label: "after", state: plan.after });
    }
    const tombstoneCandidates: ExpectedFileState[] = plan.before.state === "present"
      ? [{ label: "before", state: plan.before }]
      : [];
    const payloadCandidates: ExpectedFileState[] = plan.after.state === "present"
      ? [{ label: "after", state: plan.after }]
      : [];
    const payloadPath = this.payloadPath(plan);

    const [manifest, tombstone, payload] = await Promise.all([
      this.inspectFile(plan.manifestPath, manifestCandidates),
      this.inspectFile(plan.tombstonePath, tombstoneCandidates),
      this.inspectFile(payloadPath, payloadCandidates),
    ]);
    return { manifest, tombstone, payload };
  }

  private payloadPath(plan: ManifestStatePlanV1): CanonicalAbsolutePathV1 {
    if (plan.after.state === "present" && plan.after.bytes !== null) {
      return plan.after.bytes.path;
    }
    if (plan.envelope.kind !== "lifecycle") return refuse();
    return deriveManifestPayloadPath(
      this.dependencies.admission.productHome,
      plan.envelope.id as never,
      plan.participantId as never,
    );
  }

  private async inspectFile(
    path: CanonicalAbsolutePathV1,
    candidates: readonly ExpectedFileState[],
  ): Promise<PhysicalPathState> {
    let listed: Stats;
    try {
      listed = await this.dependencies.fs.lstat(path);
    } catch (error) {
      return isMissingError(error) ? "missing" : "third";
    }
    if (!this.isGuardedRegularFile(listed)) return "third";

    let handle: FileHandle;
    try {
      handle = await this.dependencies.fs.open(path, FILE_OPEN_FLAGS);
    } catch {
      return "third";
    }

    try {
      const opened = await handle.stat();
      if (!this.isGuardedRegularFile(opened) || !sameDescriptor(listed, opened)) return "third";
      const bytes = await this.readBounded(handle, opened.size);
      const closed = await handle.stat();
      const fresh = await this.dependencies.fs.lstat(path);
      if (
        !this.isGuardedRegularFile(closed) ||
        !this.isGuardedRegularFile(fresh) ||
        !sameDescriptor(opened, closed) ||
        !sameDescriptor(opened, fresh)
      ) {
        return "third";
      }

      for (const candidate of candidates) {
        if (!this.matchesExpectedFile(candidate.state, bytes, fresh)) continue;
        try {
          const decoded = validateManifestBytes(bytes, this.dependencies.manifestAdmission);
          if (candidate.label === "after" && decoded.schemaVersion !== 2) return "third";
          return candidate.label;
        } catch {
          return "third";
        }
      }
      return "third";
    } catch {
      return "third";
    } finally {
      await handle.close();
    }
  }

  private isGuardedRegularFile(stat: Stats): boolean {
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === this.dependencies.uid &&
      (stat.mode & 0o777) === 0o600 &&
      stat.nlink === 1 &&
      Number.isSafeInteger(stat.size) &&
      stat.size >= 0 &&
      stat.size <= MAX_MANIFEST_BYTES
    );
  }

  private async readBounded(handle: FileHandle, size: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_MANIFEST_BYTES) return refuse();
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const result = await handle.read(bytes, offset, size - offset, offset);
      if (result.bytesRead < 1) return refuse();
      offset += result.bytesRead;
    }
    const overflow = new Uint8Array(1);
    if ((await handle.read(overflow, 0, 1, size)).bytesRead !== 0) return refuse();
    return bytes;
  }

  private matchesExpectedFile(
    state: PresentManifestState,
    bytes: Uint8Array,
    stat: Stats,
  ): boolean {
    let identity: ManifestFileIdentityV1;
    try {
      identity = this.fileIdentity(state);
    } catch {
      return false;
    }
    return (
      createHash("sha256").update(bytes).digest("hex") === identity.hash &&
      stat.uid === identity.ownerUid &&
      (stat.mode & 0o777) === identity.mode &&
      stat.nlink === identity.nlink &&
      String(stat.size) === identity.size &&
      String(stat.dev) === identity.dev &&
      String(stat.ino) === identity.ino
    );
  }

  private fileIdentity(state: PresentManifestState): ManifestFileIdentityV1 {
    let evidence: ManifestPayloadIdentityV1;
    if (state.dev !== null && state.ino !== null) {
      evidence = { dev: state.dev, ino: state.ino };
    } else {
      if (
        state.bytes?.kind !== "bootstrap_expected" ||
        this.dependencies.admission.bootstrapPayloadIdentity === undefined
      ) {
        return refuse();
      }
      const admitted = this.dependencies.admission.bootstrapPayloadIdentity(state.bytes);
      if (admitted === null) return refuse();
      evidence = payloadIdentity(admitted);
    }
    return {
      hash: state.hash,
      ownerUid: state.ownerUid,
      mode: state.mode,
      nlink: state.nlink,
      size: state.size,
      dev: evidence.dev,
      ino: evidence.ino,
    };
  }

  private async requireBeforeInventory(plan: ManifestStatePlanV1): Promise<void> {
    if (!inventoryEquals(await this.inventory(plan), beforeInventory(plan))) refuse();
  }

  private async requirePreimageInventory(plan: ManifestStatePlanV1): Promise<void> {
    const expected = preimageInventory(plan);
    if (expected === null || !inventoryEquals(await this.inventory(plan), expected)) refuse();
  }

  private async requireAppliedInventory(plan: ManifestStatePlanV1): Promise<void> {
    if (!inventoryEquals(await this.inventory(plan), appliedInventory(plan))) refuse();
  }

  private async requireCompactionPendingInventory(plan: ManifestStatePlanV1): Promise<void> {
    const expected = compactionPendingInventory(plan);
    if (expected === null || !inventoryEquals(await this.inventory(plan), expected)) refuse();
  }

  private async restorePreimage(plan: ManifestStatePlanV1): Promise<void> {
    if (plan.before.state !== "present") return refuse();
    await this.moveAndMakeDurable(plan.tombstonePath, plan.manifestPath, plan.before);
  }

  private async adoptApplyPreimageTransition(plan: ManifestStatePlanV1): Promise<void> {
    await this.makeMoveDurable(plan.manifestPath, plan.tombstonePath);
    await this.requirePreimageInventory(plan);
  }

  private async adoptAmbiguousCompensationPreimageTransition(
    plan: ManifestStatePlanV1,
  ): Promise<void> {
    // The bytes cannot distinguish apply's preimage move from compensation's
    // postimage-to-payload move, so adopt the union of both mutations' parents.
    await this.makeAffectedParentsDurable([
      plan.manifestPath,
      plan.tombstonePath,
      this.payloadPath(plan),
    ]);
    await this.requirePreimageInventory(plan);
  }

  private async adoptAppliedTransition(plan: ManifestStatePlanV1): Promise<void> {
    if (plan.after.state === "present") {
      if (plan.after.bytes === null) return refuse();
      await this.makeMoveDurable(plan.after.bytes.path, plan.manifestPath);
    } else if (plan.before.state === "present") {
      await this.makeMoveDurable(plan.manifestPath, plan.tombstonePath);
    }
  }

  private async adoptCompensatedTransition(plan: ManifestStatePlanV1): Promise<void> {
    if (plan.before.state === "present") {
      await this.makeMoveDurable(plan.tombstonePath, plan.manifestPath);
    } else if (plan.after.state === "present" && plan.after.bytes !== null) {
      await this.makeMoveDurable(plan.manifestPath, plan.after.bytes.path);
    }
  }

  private async moveAndMakeDurable(
    source: CanonicalAbsolutePathV1,
    destination: CanonicalAbsolutePathV1,
    expected: PresentManifestState,
  ): Promise<void> {
    await this.dependencies.guardedMoveNoReplace(
      source,
      destination,
      this.fileIdentity(expected),
    );
    await this.makeMoveDurable(source, destination);
  }

  private async unlinkAndMakeDurable(
    path: CanonicalAbsolutePathV1,
    expected: ManifestFileIdentityV1,
  ): Promise<void> {
    await this.dependencies.guardedUnlinkExact(path, expected);
    await this.makeUnlinkDurable(path);
  }

  private async makeMoveDurable(
    source: CanonicalAbsolutePathV1,
    destination: CanonicalAbsolutePathV1,
  ): Promise<void> {
    await this.makeAffectedParentsDurable([source, destination]);
  }

  private async makeAffectedParentsDurable(
    affectedPaths: readonly CanonicalAbsolutePathV1[],
  ): Promise<void> {
    const parents = affectedPaths.map((path) => dirname(path));
    const distinctParents = parents.filter((parent, index) => parents.indexOf(parent) === index);
    for (const parent of distinctParents) await this.syncAndReopenParent(parent);
  }

  private async makeUnlinkDurable(path: CanonicalAbsolutePathV1): Promise<void> {
    await this.syncAndReopenParent(dirname(path));
  }

  private async syncAndReopenParent(path: string): Promise<void> {
    const canonical = admitCanonicalAbsolutePath(path, this.dependencies.admission.evidence);
    const syncHandle = await this.dependencies.fs.open(canonical, DIRECTORY_OPEN_FLAGS);
    let synced: Stats;
    try {
      synced = await syncHandle.stat();
      if (!synced.isDirectory() || synced.isSymbolicLink()) return refuse();
      await syncHandle.sync();
    } finally {
      await syncHandle.close();
    }

    const reopenedHandle = await this.dependencies.fs.open(canonical, DIRECTORY_OPEN_FLAGS);
    try {
      const reopened = await reopenedHandle.stat();
      if (
        !reopened.isDirectory() ||
        reopened.isSymbolicLink() ||
        reopened.dev !== synced.dev ||
        reopened.ino !== synced.ino
      ) {
        return refuse();
      }
    } finally {
      await reopenedHandle.close();
    }

    const fresh = await this.dependencies.fs.lstat(canonical);
    if (
      !fresh.isDirectory() ||
      fresh.isSymbolicLink() ||
      fresh.dev !== synced.dev ||
      fresh.ino !== synced.ino ||
      this.dependencies.admission.evidence.reopenCanonicalAbsolutePath(canonical) !== canonical
    ) {
      return refuse();
    }
  }
}
