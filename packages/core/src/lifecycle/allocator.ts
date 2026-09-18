/**
 * Spec 1 §2.4's install-scoped ID allocation: a separate bounded state
 * transition performed before any plan or staging publication. Reservation
 * guarded-opens the nonce and the allocator, requires §2.1's content/hash/schema
 * agreement, reserves one contiguous counter block for the complete operation,
 * makes the new counter durable, and only then exposes the reserved IDs. §7
 * pins what a crash may leave: blocks advance before publication, gaps are
 * legal, counters and nonces never rewind, and a collected ID never reappears.
 */
import { createHash } from "node:crypto";

import type { LifecycleIdAllocatorV1, LifecycleInstallNonceV1 } from "../manifest/bootstrap.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseUInt64Decimal } from "../update/scalars.js";
import {
  refuseLifecycleRecovery,
  sameLifecycleGuardedIdentity,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
} from "./guarded-fs.js";
import { UINT64_MAX, allocatedCounterOf } from "./ids.js";
import { LifecycleLockShapeError, type HeldLifecycleStableLockV1 } from "./locks.js";
import {
  encodeLifecycleIdAllocator,
  parseLifecycleIdAllocator,
  parseLifecycleInstallNonce,
} from "./records.js";

export interface LifecycleAllocatorStateV1 {
  readonly nonce: LifecycleInstallNonceV1;
  readonly nonceEntry: LifecycleGuardedEntryV1;
  readonly allocator: LifecycleIdAllocatorV1;
  readonly allocatorEntry: LifecycleGuardedEntryV1;
  /**
   * §2.4 requires the state directory identity to be unchanged throughout
   * recovery, and `syncDirectory` takes a reopened entry: the identity the
   * inspection observed has to travel with the record rather than be re-derived
   * by the caller that is supposed to be checking it against this one.
   */
  readonly stateEntry: LifecycleGuardedEntryV1;
  /** Exactly one cleanable pre-rename temp, or null. */
  readonly temp: LifecycleGuardedEntryV1 | null;
}

export type LifecycleAllocatorBoundaryV1 =
  | "temp_created"
  | "temp_written"
  | "temp_synced"
  | "old_rechecked"
  | "renamed"
  | "state_synced";

export interface LifecycleIdBlockV1 {
  readonly nonce: LifecycleInstallNonceV1;
  readonly firstCounter: bigint;
  readonly size: number;
}

const NONCE_LEAF = "lifecycle-install-nonce";
const ALLOCATOR_LEAF = "lifecycle-id-allocator.json";
const LOCK_LEAF = ".lifecycle.lock";
const TEMP_PREFIX = ".lifecycle-id-allocator.";
const TEMP_SUFFIX = ".json.tmp";
const NONCE_FILE_BYTES = 65;
const MAX_ALLOCATOR_BYTES = 1_024;
const LOWERCASE_V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const encoder = new TextEncoder();

function leafPath(stateDirectory: CanonicalAbsolutePathV1, leaf: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(`${stateDirectory}/${leaf}`);
}

function allocatorDigest(allocator: LifecycleIdAllocatorV1): string {
  return createHash("sha256")
    .update(encoder.encode(encodeLifecycleIdAllocator(allocator)))
    .digest("hex");
}

/** §2.4: every command that can create a lifecycle ID holds the exact global mutation lock. */
function requireGlobalLock(
  held: HeldLifecycleStableLockV1,
  stateDirectory: CanonicalAbsolutePathV1,
): void {
  if (held.path !== leafPath(stateDirectory, LOCK_LEAF)) {
    throw new LifecycleLockShapeError(held.path);
  }
}

function ownedControlFile(
  entry: LifecycleGuardedEntryV1 | null,
  effectiveUid: number,
  maximumBytes: number,
): entry is LifecycleGuardedEntryV1 {
  return entry !== null && entry.kind === "regular_file" && entry.ownerUid === effectiveUid &&
    entry.mode === 0o600 && entry.nlink === 1 && BigInt(entry.size) <= BigInt(maximumBytes);
}

async function readControlFile(
  fs: LifecycleGuardedFileSystemV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
  reason: string,
): Promise<{ readonly entry: LifecycleGuardedEntryV1; readonly bytes: Uint8Array }> {
  const entry = await fs.lstat(path);
  if (!ownedControlFile(entry, effectiveUid, maximumBytes)) refuseLifecycleRecovery(reason, path);
  return { entry, bytes: await fs.readRegular(entry, maximumBytes) };
}

/**
 * The product owns the whole `.lifecycle-id-allocator.` namespace inside
 * `state`, so a near-miss name there is not an unknown child: §2.4 calls a wrong
 * name recovery-required and preserved, alongside a wrong type, owner, mode,
 * link count or size.
 */
async function findTemp(
  fs: LifecycleGuardedFileSystemV1,
  stateEntry: LifecycleGuardedEntryV1,
  effectiveUid: number,
): Promise<LifecycleGuardedEntryV1 | null> {
  const candidates: string[] = [];
  for await (const name of fs.names(stateEntry)) {
    if (name.startsWith(TEMP_PREFIX)) candidates.push(name);
  }
  if (candidates.length > 1) {
    refuseLifecycleRecovery(
      "lifecycle_allocator_temp_count",
      ...candidates.map((name) => `${stateEntry.path}/${name}`),
    );
  }
  const [name] = candidates;
  if (name === undefined) return null;
  const path = leafPath(stateEntry.path, name);
  if (
    name.length <= TEMP_PREFIX.length + TEMP_SUFFIX.length ||
    !name.endsWith(TEMP_SUFFIX) ||
    !LOWERCASE_V4_UUID.test(name.slice(TEMP_PREFIX.length, name.length - TEMP_SUFFIX.length))
  ) {
    refuseLifecycleRecovery("lifecycle_allocator_temp_name", path);
  }
  const entry = await fs.lstat(path);
  if (!ownedControlFile(entry, effectiveUid, MAX_ALLOCATOR_BYTES)) {
    refuseLifecycleRecovery("lifecycle_allocator_temp_shape", path);
  }
  return entry;
}

/**
 * A legacy `tx_<lowercase-v4-uuid>` ID carries no counter and no epoch nonce, so
 * it cannot constrain the allocator and is refused through the typed class
 * rather than through `allocatedCounterOf`'s untyped grammar error: Task 11's
 * ledger inventory enumerates surviving legacy journals from the filesystem, and
 * an untyped throw there would escape the recovery-required envelope.
 */
function allocatedCounter(id: string, path: CanonicalAbsolutePathV1): bigint {
  try {
    return allocatedCounterOf(id);
  } catch {
    return refuseLifecycleRecovery("lifecycle_allocated_id_grammar", path);
  }
}

/**
 * §7: counters and nonces never rewind and a collected ID never reappears, so
 * every caller states the allocated IDs that survive — `[]` only when it has
 * positively established that none do. The durable counter must be strictly
 * above every one of them.
 */
function requireCounterCoversAllocatedIds(
  allocator: LifecycleIdAllocatorV1,
  allocatedIds: readonly string[],
  path: CanonicalAbsolutePathV1,
): void {
  const next = BigInt(allocator.nextCounter);
  for (const id of allocatedIds) {
    const counter = allocatedCounter(id, path);
    if (id.split("_")[1] !== allocator.installNonce) {
      refuseLifecycleRecovery("lifecycle_allocated_id_nonce", path);
    }
    if (counter >= next) refuseLifecycleRecovery("lifecycle_allocator_counter_rewind", path);
  }
}

export async function inspectLifecycleAllocator(
  fs: LifecycleGuardedFileSystemV1,
  stateDirectory: CanonicalAbsolutePathV1,
  effectiveUid: number,
  allocatedIds: readonly string[],
): Promise<LifecycleAllocatorStateV1> {
  const stateEntry = await fs.lstat(stateDirectory);
  if (
    stateEntry === null ||
    stateEntry.kind !== "directory" ||
    stateEntry.ownerUid !== effectiveUid ||
    stateEntry.mode !== 0o700
  ) {
    refuseLifecycleRecovery("lifecycle_state_directory_shape", stateDirectory);
  }

  const noncePath = leafPath(stateDirectory, NONCE_LEAF);
  const nonceFile = await readControlFile(
    fs,
    noncePath,
    effectiveUid,
    NONCE_FILE_BYTES,
    "lifecycle_install_nonce_shape",
  );
  if (nonceFile.entry.size !== String(NONCE_FILE_BYTES)) {
    refuseLifecycleRecovery("lifecycle_install_nonce_shape", noncePath);
  }
  let nonce: LifecycleInstallNonceV1;
  try {
    nonce = parseLifecycleInstallNonce(nonceFile.bytes);
  } catch {
    return refuseLifecycleRecovery("lifecycle_install_nonce_bytes", noncePath);
  }

  const allocatorPath = leafPath(stateDirectory, ALLOCATOR_LEAF);
  const allocatorFile = await readControlFile(
    fs,
    allocatorPath,
    effectiveUid,
    MAX_ALLOCATOR_BYTES,
    "lifecycle_id_allocator_shape",
  );
  let allocator: LifecycleIdAllocatorV1;
  try {
    allocator = parseLifecycleIdAllocator(allocatorFile.bytes, nonce);
  } catch {
    return refuseLifecycleRecovery("lifecycle_id_allocator_bytes", allocatorPath);
  }
  requireCounterCoversAllocatedIds(allocator, allocatedIds, allocatorPath);

  return {
    nonce,
    nonceEntry: nonceFile.entry,
    allocator,
    allocatorEntry: allocatorFile.entry,
    stateEntry,
    temp: await findTemp(fs, stateEntry, effectiveUid),
  };
}

/**
 * §2.4: the reopened final allocator has to keep the same device, inode and
 * hash identity throughout recovery, so the hash is recomputed against the
 * canonical preimage rather than trusted from the earlier read.
 */
async function requireUnchangedAuthority(
  fs: LifecycleGuardedFileSystemV1,
  observed: LifecycleAllocatorStateV1,
  expected: LifecycleAllocatorStateV1,
): Promise<void> {
  if (
    !sameLifecycleGuardedIdentity(observed.stateEntry, expected.stateEntry) ||
    !sameLifecycleGuardedIdentity(observed.nonceEntry, expected.nonceEntry) ||
    !sameLifecycleGuardedIdentity(observed.allocatorEntry, expected.allocatorEntry) ||
    observed.nonce !== expected.nonce ||
    observed.allocator.nextCounter !== expected.allocator.nextCounter
  ) {
    refuseLifecycleRecovery("lifecycle_allocator_identity_changed", expected.allocatorEntry.path);
  }
  const digest = await fs.hashRegular(observed.allocatorEntry, BigInt(MAX_ALLOCATOR_BYTES));
  if (digest !== allocatorDigest(expected.allocator)) {
    refuseLifecycleRecovery("lifecycle_allocator_identity_changed", expected.allocatorEntry.path);
  }
}

export async function cleanLifecycleAllocatorTemp(
  fs: LifecycleGuardedFileSystemV1,
  state: LifecycleAllocatorStateV1,
  held: HeldLifecycleStableLockV1,
  allocatedIds: readonly string[],
): Promise<LifecycleAllocatorStateV1> {
  requireGlobalLock(held, state.stateEntry.path);
  if (state.temp === null) return state;

  const effectiveUid = state.stateEntry.ownerUid;
  const before = await inspectLifecycleAllocator(fs, state.stateEntry.path, effectiveUid, allocatedIds);
  await requireUnchangedAuthority(fs, before, state);
  if (before.temp === null || !sameLifecycleGuardedIdentity(before.temp, state.temp)) {
    refuseLifecycleRecovery("lifecycle_allocator_identity_changed", state.temp.path);
  }

  await fs.unlinkExact(before.temp);
  await fs.syncDirectory(before.stateEntry);

  const after = await inspectLifecycleAllocator(fs, state.stateEntry.path, effectiveUid, allocatedIds);
  await requireUnchangedAuthority(fs, after, state);
  if (after.temp !== null) {
    refuseLifecycleRecovery("lifecycle_allocator_identity_changed", after.temp.path);
  }
  return after;
}

export async function reserveLifecycleIdBlock(
  dependencies: {
    readonly fs: LifecycleGuardedFileSystemV1;
    readonly stateDirectory: CanonicalAbsolutePathV1;
    readonly effectiveUid: number;
    readonly uuid: () => string;
    readonly held: HeldLifecycleStableLockV1;
    /** §7 again: reservation may not issue a counter at or below a surviving allocated ID either. */
    readonly allocatedIds: readonly string[];
    readonly afterBoundary?: (boundary: LifecycleAllocatorBoundaryV1) => void | Promise<void>;
  },
  size: number,
): Promise<LifecycleIdBlockV1> {
  const { fs, stateDirectory, effectiveUid, held } = dependencies;
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error("invalid lifecycle ID block size");
  }
  requireGlobalLock(held, stateDirectory);

  const boundary = async (reached: LifecycleAllocatorBoundaryV1): Promise<void> => {
    await dependencies.afterBoundary?.(reached);
  };

  const state = await inspectLifecycleAllocator(
    fs,
    stateDirectory,
    effectiveUid,
    dependencies.allocatedIds,
  );
  if (state.temp !== null) {
    refuseLifecycleRecovery("lifecycle_allocator_temp_present", state.temp.path);
  }

  const first = BigInt(state.allocator.nextCounter);
  if (first === UINT64_MAX) {
    refuseLifecycleRecovery("lifecycle_allocator_exhausted", state.allocatorEntry.path);
  }
  const next = first + BigInt(size);
  if (next > UINT64_MAX) {
    refuseLifecycleRecovery("lifecycle_allocator_overflow", state.allocatorEntry.path);
  }

  const uuid = dependencies.uuid();
  if (!LOWERCASE_V4_UUID.test(uuid)) {
    throw new Error("invalid lifecycle allocator temp uuid");
  }
  const postimage: LifecycleIdAllocatorV1 = {
    schemaVersion: 1,
    installNonce: state.nonce,
    nextCounter: parseUInt64Decimal(next.toString(10)),
  };
  const temp = await fs.writeExclusive(
    leafPath(stateDirectory, `${TEMP_PREFIX}${uuid}${TEMP_SUFFIX}`),
    encoder.encode(encodeLifecycleIdAllocator(postimage)),
  );
  /**
   * `writeExclusive` is one indivisible `O_CREAT | O_EXCL` create, write and
   * `fsync`, so these three boundaries are three injection points over the same
   * durable state. §2.4 allows the temp to be empty, partial or complete
   * precisely because no ID is exposed before the rename, and the empty and
   * partial cases are reached by fixture rather than by injection.
   */
  await boundary("temp_created");
  await boundary("temp_written");
  await boundary("temp_synced");

  const reopened = await inspectLifecycleAllocator(
    fs,
    stateDirectory,
    effectiveUid,
    dependencies.allocatedIds,
  );
  await requireUnchangedAuthority(fs, reopened, state);
  if (reopened.temp === null || !sameLifecycleGuardedIdentity(reopened.temp, temp)) {
    refuseLifecycleRecovery("lifecycle_allocator_identity_changed", temp.path);
  }
  await boundary("old_rechecked");

  await fs.renameOver(temp, reopened.allocatorEntry);
  await boundary("renamed");

  await fs.syncDirectory(state.stateEntry);
  await boundary("state_synced");

  return { nonce: state.nonce, firstCounter: first, size };
}
