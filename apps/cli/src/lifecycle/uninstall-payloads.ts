/**
 * NEW-210: Spec 1 §2.4's `K` arm carries every removable product-home file larger than
 * `MAX_MUTATION_BYTES` as a payload. Such a file is never read into memory or copied into a
 * journal: `stage` renames it, by its recorded identity, into
 * `staging/lifecycle/<coordinator>/payloads/<ordinal>`, `restore` renames the same inode back
 * and `delete` unlinks it after `M(commit_absence)`.
 */
import {
  LIFECYCLE_UNINSTALL_ARTIFACT_STEPS,
  LifecycleRecoveryRequiredError,
  MAXIMUM_BUNDLE_FILE_BYTES,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LowerHexSha256,
  UInt64DecimalV1,
} from "@developer-os/core";

/** §2.4's `FoundationParticipantRefV1.mutations[1..256]`, per `F(uninstall_artifacts)` step. */
export const MAX_ARTIFACTS_PER_STEP = 256;
/** D45: 31 steps of 256, the 7,936-mutation ceiling. */
export const MAX_UNINSTALL_ARTIFACTS = MAX_ARTIFACTS_PER_STEP * LIFECYCLE_UNINSTALL_ARTIFACT_STEPS.maximum;
/** The largest file `F(uninstall_artifacts)` journals by content; anything larger is a payload. */
export const MAX_MUTATION_BYTES = 16_777_216;

const PAYLOAD_KEYS = ["sourcePath", "payloadPath", "mode", "size", "dev", "ino", "sha256"];

export interface UninstallPayloadV1 {
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly payloadPath: CanonicalAbsolutePathV1;
  readonly mode: 384 | 448;
  readonly size: number;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
  readonly sha256: LowerHexSha256;
}

export type UninstallPayloadStateV1 = "before" | "staged" | "deleted";

/** Task 4 widens `UninstallBoundaryV1` with this. */
export interface UninstallPayloadBoundaryV1 {
  readonly kind: "payload_staged" | "payload_deleted";
  readonly ordinal: number;
}

export type UninstallPayloadBoundaryHook = (boundary: UninstallPayloadBoundaryV1) => void | Promise<void>;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function refuse(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

export function uninstallPayloadPath(
  productHome: string,
  coordinatorId: string,
  ordinal: number,
): CanonicalAbsolutePathV1 {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) fail("UninstallPayloadV1: ordinal");
  return parseCanonicalAbsolutePathText(
    `${productHome}/staging/lifecycle/${coordinatorId}/payloads/${String(ordinal)}`,
  );
}

function validatePayload(
  value: unknown,
  productHome: string,
  coordinatorId: string,
  ordinal: number,
): UninstallPayloadV1 {
  const label = "UninstallPayloadV1";
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== PAYLOAD_KEYS.length || PAYLOAD_KEYS.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  const sourcePath = parseCanonicalAbsolutePathText(input.sourcePath);
  if (!sourcePath.startsWith(`${productHome}/`)) fail(`${label}: sourcePath`);
  const top = sourcePath.slice(productHome.length + 1).split("/")[0];
  if (top === "staging" || top === "state") fail(`${label}: sourcePath`);
  const payloadPath = uninstallPayloadPath(productHome, coordinatorId, ordinal);
  if (input.payloadPath !== payloadPath) fail(`${label}: payloadPath`);
  if (input.mode !== 384 && input.mode !== 448) fail(`${label}: mode`);
  if (
    typeof input.size !== "number" ||
    !Number.isSafeInteger(input.size) ||
    input.size <= MAX_MUTATION_BYTES ||
    input.size > MAXIMUM_BUNDLE_FILE_BYTES
  ) {
    fail(`${label}: size`);
  }
  return {
    sourcePath,
    payloadPath,
    mode: input.mode,
    size: input.size,
    dev: parseUInt64Decimal(input.dev),
    ino: parseUInt64Decimal(input.ino),
    sha256: parseLowerHexSha256(input.sha256),
  };
}

/** The codec half: `payloadPath` is recomputed from the coordinator and the ordinal, never trusted. */
export function validateUninstallPayloads(
  value: unknown,
  productHome: string,
  coordinatorId: string,
): readonly UninstallPayloadV1[] {
  if (!Array.isArray(value) || value.length > MAX_UNINSTALL_ARTIFACTS) fail("UninstallPayloadV1[]");
  const payloads = value.map((entry, ordinal) => validatePayload(entry, productHome, coordinatorId, ordinal));
  if (new Set(payloads.map((payload) => payload.sourcePath)).size !== payloads.length) {
    fail("UninstallPayloadV1[]: duplicate sourcePath");
  }
  return payloads;
}

function sameIdentity(entry: LifecycleGuardedEntryV1 | null, uid: number, payload: UninstallPayloadV1): boolean {
  return (
    entry !== null &&
    entry.kind === "regular_file" &&
    entry.ownerUid === uid &&
    entry.mode === payload.mode &&
    entry.nlink === 1 &&
    entry.size === String(payload.size) &&
    entry.dev === payload.dev &&
    entry.ino === payload.ino
  );
}

async function syncParent(fs: LifecycleGuardedFileSystemV1, path: CanonicalAbsolutePathV1): Promise<void> {
  const parentPath = parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/")));
  const parent = await fs.lstat(parentPath);
  if (parent === null || parent.kind !== "directory") refuse("uninstall_payload_parent", parentPath);
  await fs.syncDirectory(parent);
}

async function observeOne(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  payload: UninstallPayloadV1,
): Promise<UninstallPayloadStateV1> {
  const source = await fs.lstat(payload.sourcePath);
  const staged = await fs.lstat(payload.payloadPath);
  if (source === null && staged === null) return "deleted";
  if (staged === null && sameIdentity(source, uid, payload)) return "before";
  if (source === null && sameIdentity(staged, uid, payload)) return "staged";
  return refuse("uninstall_payload_state", payload.sourcePath, payload.payloadPath);
}

/**
 * A mixture of `before` and `staged` is an interrupted `stage` (compensation restores it), of
 * `staged` and `deleted` an interrupted `delete` (resumed forward). `before` beside `deleted`
 * has no transition that produces it. An empty list is `deleted`: nothing is left to move.
 */
export async function observePayloads(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  payloads: readonly UninstallPayloadV1[],
): Promise<UninstallPayloadStateV1> {
  const states = new Set<UninstallPayloadStateV1>();
  for (const payload of payloads) states.add(await observeOne(fs, uid, payload));
  if (states.has("before") && states.has("deleted")) {
    refuse("uninstall_payload_state", ...payloads.map((payload) => payload.sourcePath));
  }
  if (states.has("before")) return "before";
  if (states.has("staged")) return "staged";
  return "deleted";
}

async function payloadDirectory(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  coordinatorStaging: CanonicalAbsolutePathV1,
): Promise<void> {
  const path = parseCanonicalAbsolutePathText(`${coordinatorStaging}/payloads`);
  const existing = await fs.lstat(path);
  if (existing === null) {
    await fs.mkdirExclusive(path);
    await syncParent(fs, path);
    return;
  }
  if (existing.kind !== "directory" || existing.ownerUid !== uid || existing.mode !== 0o700) {
    refuse("uninstall_payload_parent", path);
  }
}

export async function stagePayloads(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  coordinatorStaging: CanonicalAbsolutePathV1,
  payloads: readonly UninstallPayloadV1[],
  boundary?: UninstallPayloadBoundaryHook,
): Promise<void> {
  if (payloads.length === 0) return;
  for (const payload of payloads) {
    if (!payload.payloadPath.startsWith(`${coordinatorStaging}/payloads/`)) {
      refuse("uninstall_payload_identity", payload.payloadPath);
    }
  }
  await payloadDirectory(fs, uid, coordinatorStaging);
  for (const [ordinal, payload] of payloads.entries()) {
    const source = await fs.lstat(payload.sourcePath);
    const staged = await fs.lstat(payload.payloadPath);
    if (source === null && sameIdentity(staged, uid, payload)) continue;
    if (staged !== null || source === null || !sameIdentity(source, uid, payload)) {
      refuse("uninstall_payload_identity", payload.sourcePath, payload.payloadPath);
    }
    if ((await fs.hashRegular(source, BigInt(MAXIMUM_BUNDLE_FILE_BYTES))) !== payload.sha256) {
      refuse("uninstall_payload_hash", payload.sourcePath);
    }
    await fs.renameNoReplace(source, payload.payloadPath);
    await syncParent(fs, payload.sourcePath);
    await syncParent(fs, payload.payloadPath);
    await boundary?.({ kind: "payload_staged", ordinal });
  }
}

/** Reverse order; an entry whose source is back (or was never moved) is already restored. */
export async function restorePayloads(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  payloads: readonly UninstallPayloadV1[],
): Promise<void> {
  for (const payload of [...payloads].reverse()) {
    const source = await fs.lstat(payload.sourcePath);
    const staged = await fs.lstat(payload.payloadPath);
    if (staged === null && sameIdentity(source, uid, payload)) continue;
    if (source !== null || staged === null || !sameIdentity(staged, uid, payload)) {
      refuse("uninstall_payload_identity", payload.sourcePath, payload.payloadPath);
    }
    await fs.renameNoReplace(staged, payload.sourcePath);
    await syncParent(fs, payload.payloadPath);
    await syncParent(fs, payload.sourcePath);
  }
}

export async function deletePayloads(
  fs: LifecycleGuardedFileSystemV1,
  uid: number,
  payloads: readonly UninstallPayloadV1[],
  boundary?: UninstallPayloadBoundaryHook,
): Promise<void> {
  for (const [ordinal, payload] of payloads.entries()) {
    const source = await fs.lstat(payload.sourcePath);
    const staged = await fs.lstat(payload.payloadPath);
    if (source === null && staged === null) continue;
    if (source !== null || staged === null || !sameIdentity(staged, uid, payload)) {
      refuse("uninstall_payload_identity", payload.sourcePath, payload.payloadPath);
    }
    await fs.unlinkExact(staged);
    await syncParent(fs, payload.payloadPath);
    await boundary?.({ kind: "payload_deleted", ordinal });
  }
}
