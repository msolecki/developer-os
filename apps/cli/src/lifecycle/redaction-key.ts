/**
 * Spec 1 §6's redaction-key arm: `state/redaction.key` is opaque — its bytes are never read,
 * hashed or journaled, so the plan binds only the leaf's observed identity and the tombstone
 * the coordinator will retain it under.
 */
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";

import {
  LifecycleRecoveryRequiredError,
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLifecycleCoordinatorId,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  EffectiveUidV1,
  LifecycleCodecContextV1,
  LifecycleCoordinatorIdV1,
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleValueCodec,
  UInt64DecimalV1,
} from "@developer-os/core";
import { isMissingEntry } from "../config-file.js";

const SOURCE_LEAF = "redaction.key";
const SECRET_MODE = 0o600;
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 1_048_576;

const PLAN_KEYS = ["schemaVersion", "coordinatorId", "sourcePath", "tombstonePath", "before"];
const ABSENT_KEYS = ["state"];
const PRESENT_KEYS = ["state", "kind", "ownerUid", "mode", "nlink", "size", "dev", "ino"];

export type SecretOpaqueFileStateV1 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly kind: "regular_file";
      readonly ownerUid: EffectiveUidV1;
      readonly mode: 384;
      readonly nlink: 1;
      readonly size: number;
      readonly dev: UInt64DecimalV1;
      readonly ino: UInt64DecimalV1;
    };

export interface RedactionKeyStatePlanV1 {
  readonly schemaVersion: 1;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1;
  readonly before: SecretOpaqueFileStateV1;
}

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

/**
 * `LifecycleCodecContextV1` carries no effective uid, so the recorded owner is admitted by
 * range here and compared against the live uid by the participant that opens the key.
 */
function recordedOwnerUid(value: unknown): EffectiveUidV1 {
  if (typeof value !== "number") fail("SecretOpaqueFileStateV1: ownerUid");
  return parseEffectiveUid(value, value);
}

export function redactionKeySourcePath(
  stateDirectory: CanonicalAbsolutePathV1,
): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stateDirectory}/${SOURCE_LEAF}`);
}

export function redactionKeyTombstonePath(
  stateDirectory: CanonicalAbsolutePathV1,
  coordinatorId: LifecycleCoordinatorIdV1,
): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stateDirectory}/.redaction.key.${coordinatorId}.tombstone`);
}

function planJson(plan: RedactionKeyStatePlanV1): CanonicalJsonValue {
  return {
    schemaVersion: plan.schemaVersion,
    coordinatorId: plan.coordinatorId,
    sourcePath: plan.sourcePath,
    tombstonePath: plan.tombstonePath,
    before: plan.before as unknown as CanonicalJsonValue,
  };
}

function validateBefore(value: unknown): SecretOpaqueFileStateV1 {
  const label = "SecretOpaqueFileStateV1";
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  if ((value as Readonly<Record<string, unknown>>).state === "absent") {
    exact(value, ABSENT_KEYS, label);
    return { state: "absent" };
  }
  const input = exact(value, PRESENT_KEYS, label);
  if (input.state !== "present" || input.kind !== "regular_file") fail(`${label}: state`);
  if (input.mode !== SECRET_MODE || input.nlink !== 1) fail(`${label}: identity`);
  if (
    typeof input.size !== "number" ||
    !Number.isSafeInteger(input.size) ||
    input.size < MINIMUM_SECRET_BYTES ||
    input.size > MAXIMUM_SECRET_BYTES
  ) {
    fail(`${label}: size`);
  }
  return {
    state: "present",
    kind: "regular_file",
    ownerUid: recordedOwnerUid(input.ownerUid),
    mode: SECRET_MODE,
    nlink: 1,
    size: input.size,
    dev: parseUInt64Decimal(input.dev),
    ino: parseUInt64Decimal(input.ino),
  };
}

export function createRedactionKeyStatePlanCodec(
  context: LifecycleCodecContextV1,
): LifecycleValueCodec<RedactionKeyStatePlanV1> {
  const stateDirectory = parseCanonicalAbsolutePathText(`${context.productHome}/state`);
  return {
    validate(value: unknown): RedactionKeyStatePlanV1 {
      const label = "RedactionKeyStatePlanV1";
      const input = exact(value, PLAN_KEYS, label);
      if (input.schemaVersion !== 1) fail(`${label}: schemaVersion`);
      const coordinatorId = parseLifecycleCoordinatorId(input.coordinatorId, context.nonce);
      if (input.sourcePath !== redactionKeySourcePath(stateDirectory)) fail(`${label}: sourcePath`);
      if (input.tombstonePath !== redactionKeyTombstonePath(stateDirectory, coordinatorId)) {
        fail(`${label}: tombstonePath`);
      }
      return {
        schemaVersion: 1,
        coordinatorId,
        sourcePath: redactionKeySourcePath(stateDirectory),
        tombstonePath: redactionKeyTombstonePath(stateDirectory, coordinatorId),
        before: validateBefore(input.before),
      };
    },
    encode: (plan) => encodeCanonicalJson(planJson(plan)),
  };
}

/**
 * `O_NONBLOCK` because `open(O_RDONLY)` on a FIFO blocks until a writer appears and the
 * regular-file guard is downstream of the open, so without it anyone who can write to
 * `state` hangs the CLI forever. `bigint: true` because an APFS inode exceeds 2^53 and a
 * rounded `ino` makes two distinct files compare equal.
 */
const SECRET_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function refuseSecret(reason: string, path: CanonicalAbsolutePathV1): never {
  throw new LifecycleRecoveryRequiredError(reason, [path]);
}

function admitSecretShape(
  path: CanonicalAbsolutePathV1,
  stats: BigIntStats,
  effectiveUid: number,
): void {
  if (stats.isSymbolicLink() || !stats.isFile()) refuseSecret("redaction_key_kind", path);
  if (Number(stats.uid) !== effectiveUid) refuseSecret("redaction_key_owner", path);
  if (Number(stats.mode & 0o777n) !== SECRET_MODE) refuseSecret("redaction_key_mode", path);
  if (Number(stats.nlink) !== 1) refuseSecret("redaction_key_link", path);
  if (stats.size < BigInt(MINIMUM_SECRET_BYTES) || stats.size > BigInt(MAXIMUM_SECRET_BYTES)) {
    refuseSecret("redaction_key_size", path);
  }
}

export async function observeSecretOpaqueKey(
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<SecretOpaqueFileStateV1> {
  let handle;
  try {
    handle = await open(path, SECRET_OPEN_FLAGS);
  } catch (error) {
    if (isMissingEntry(error)) return { state: "absent" };
    return refuseSecret("redaction_key_open", path);
  }
  try {
    const stats = await handle.stat({ bigint: true });
    admitSecretShape(path, stats, effectiveUid);
    return {
      state: "present",
      kind: "regular_file",
      ownerUid: parseEffectiveUid(Number(stats.uid), effectiveUid),
      mode: SECRET_MODE,
      nlink: 1,
      size: Number(stats.size),
      dev: parseUInt64Decimal(stats.dev.toString(10)),
      ino: parseUInt64Decimal(stats.ino.toString(10)),
    };
  } finally {
    await handle.close();
  }
}

/**
 * The recheck the observation cannot carry: `observeSecretOpaqueKey` fstats a descriptor,
 * this lstats the pathname, and `unlink` resolves it once more. macOS offers no unlink by
 * descriptor for a regular file, so the last window stays open (§8.3 residual 8) and the
 * comparison only narrows it.
 */
export async function unlinkSecretOpaqueKey(
  path: CanonicalAbsolutePathV1,
  expected: Extract<SecretOpaqueFileStateV1, { state: "present" }>,
): Promise<void> {
  let stats: BigIntStats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissingEntry(error)) return refuseSecret("redaction_key_vanished", path);
    throw error;
  }
  admitSecretShape(path, stats, expected.ownerUid);
  if (
    stats.dev.toString(10) !== expected.dev ||
    stats.ino.toString(10) !== expected.ino ||
    stats.size !== BigInt(expected.size)
  ) {
    refuseSecret("redaction_key_identity", path);
  }
  await unlink(path);
}

/**
 * §6's `K` arm. Every transition moves or removes the leaf by its recorded identity and never
 * opens it for content: `stage` puts the source under the coordinator's tombstone name,
 * `delete` unlinks that exact inode, `restore` puts it back. No byte of the secret reaches
 * this module.
 */
export type RedactionKeyStateV1 = "before" | "staged" | "deleted";

const TOMBSTONE_PREFIX = ".redaction.key.";
const TOMBSTONE_SUFFIX = ".tombstone";

/** identity-free stat: the guarded port takes a path and nothing else, and returns an already-exact decimal identity. */
function guardedEntry(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<LifecycleGuardedEntryV1 | null> {
  return fs.lstat(path);
}

/**
 * Identity without `nlink`: between the `link` and the `unlink` below the key is reachable
 * under both names and its link count is two, which is the one legal moment where the settled
 * shape does not hold.
 */
function sameSecretInode(
  entry: LifecycleGuardedEntryV1,
  before: Extract<SecretOpaqueFileStateV1, { state: "present" }>,
): boolean {
  return (
    entry.kind === "regular_file" &&
    entry.ownerUid === before.ownerUid &&
    entry.mode === SECRET_MODE &&
    entry.dev === before.dev &&
    entry.ino === before.ino &&
    BigInt(entry.size) === BigInt(before.size)
  );
}

function sameSecretIdentity(
  entry: LifecycleGuardedEntryV1,
  before: Extract<SecretOpaqueFileStateV1, { state: "present" }>,
): boolean {
  return sameSecretInode(entry, before) && entry.nlink === 1;
}

function presentBefore(
  plan: RedactionKeyStatePlanV1,
): Extract<SecretOpaqueFileStateV1, { state: "present" }> | null {
  return plan.before.state === "present" ? plan.before : null;
}

async function syncParent(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
): Promise<void> {
  const parent = await guardedEntry(
    fs,
    parseCanonicalAbsolutePathText(path.slice(0, path.lastIndexOf("/"))),
  );
  if (parent === null) refuseSecret("redaction_key_parent", path);
  await fs.syncDirectory(parent);
}

/**
 * `link` then `unlink`, never a rename: the guarded port's `renameNoReplace` hashes its source
 * to bind the postimage, and §6 forbids ever reading, hashing or journaling this file. `link`
 * is the only primitive here that refuses an existing destination (`EEXIST`) without opening
 * either name for content. A death between the two leaves one inode under both names, which
 * `observeRedactionKeyState` reads as `before` and this function finishes on the next pass.
 */
async function moveSecretByIdentity(
  fs: LifecycleGuardedFileSystemV1,
  source: CanonicalAbsolutePathV1,
  destination: CanonicalAbsolutePathV1,
  before: Extract<SecretOpaqueFileStateV1, { state: "present" }>,
): Promise<void> {
  const existing = await guardedEntry(fs, destination);
  if (existing === null) {
    const live = await guardedEntry(fs, source);
    if (live === null || !sameSecretIdentity(live, before)) {
      refuseSecret("redaction_key_identity", source);
    }
    await link(source, destination);
  } else if (!sameSecretInode(existing, before)) {
    refuseSecret("redaction_key_identity", destination);
  }
  const live = await guardedEntry(fs, source);
  if (live !== null) {
    if (!sameSecretInode(live, before)) refuseSecret("redaction_key_identity", source);
    await unlink(source);
  }
  await syncParent(fs, source);
  await syncParent(fs, destination);
}

export async function observeRedactionKeyState(
  fs: LifecycleGuardedFileSystemV1,
  plan: RedactionKeyStatePlanV1,
): Promise<RedactionKeyStateV1> {
  const before = presentBefore(plan);
  const source = await guardedEntry(fs, plan.sourcePath);
  const tombstone = await guardedEntry(fs, plan.tombstonePath);
  if (before === null) {
    if (source === null && tombstone === null) return "deleted";
    return refuseSecret("redaction_key_state", plan.sourcePath);
  }
  if (source === null && tombstone === null) return "deleted";
  if (source === null) {
    if (tombstone !== null && sameSecretIdentity(tombstone, before)) return "staged";
    return refuseSecret("redaction_key_state", plan.tombstonePath);
  }
  if (tombstone === null) {
    if (sameSecretIdentity(source, before)) return "before";
    return refuseSecret("redaction_key_state", plan.sourcePath);
  }
  if (sameSecretInode(source, before) && sameSecretInode(tombstone, before)) return "before";
  return refuseSecret("redaction_key_state", plan.sourcePath);
}

export async function stageRedactionKey(
  fs: LifecycleGuardedFileSystemV1,
  plan: RedactionKeyStatePlanV1,
): Promise<void> {
  const before = presentBefore(plan);
  if (before === null) return;
  await moveSecretByIdentity(fs, plan.sourcePath, plan.tombstonePath, before);
}

export async function restoreRedactionKey(
  fs: LifecycleGuardedFileSystemV1,
  plan: RedactionKeyStatePlanV1,
): Promise<void> {
  const before = presentBefore(plan);
  if (before === null) return;
  if ((await guardedEntry(fs, plan.tombstonePath)) === null) return;
  await moveSecretByIdentity(fs, plan.tombstonePath, plan.sourcePath, before);
}

export async function deleteRedactionKey(
  fs: LifecycleGuardedFileSystemV1,
  plan: RedactionKeyStatePlanV1,
): Promise<void> {
  const before = presentBefore(plan);
  if (before === null) return;
  const tombstone = await guardedEntry(fs, plan.tombstonePath);
  if (tombstone === null) return;
  if (!sameSecretIdentity(tombstone, before)) {
    refuseSecret("redaction_key_identity", plan.tombstonePath);
  }
  await fs.unlinkExact(tombstone);
  await syncParent(fs, plan.tombstonePath);
}

/**
 * A tombstone under any coordinator's name is an unfinished key transition this run cannot
 * authenticate — its inode belongs to a plan whose bytes are gone — so planning refuses rather
 * than staging a second one beside it.
 */
export async function assertNoRedactionKeyTombstone(
  fs: LifecycleGuardedFileSystemV1,
  stateDirectory: CanonicalAbsolutePathV1,
): Promise<void> {
  const directory = await guardedEntry(fs, stateDirectory);
  if (directory === null || directory.kind !== "directory") return;
  for await (const name of fs.names(directory)) {
    if (!name.startsWith(TOMBSTONE_PREFIX) || !name.endsWith(TOMBSTONE_SUFFIX)) continue;
    refuseSecret(
      "redaction_key_tombstone_present",
      parseCanonicalAbsolutePathText(`${stateDirectory}/${name}`),
    );
  }
}
