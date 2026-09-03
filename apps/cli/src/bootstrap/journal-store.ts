import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname } from "node:path";

import {
  decodeCanonicalJson,
  encodeCanonicalJson,
  parseUtcTimestamp,
  type BootstrapJournalRecordV1,
  type BootstrapJournalSelectionV1,
  type BootstrapJournalSlotIdentityV1,
  type BootstrapRetainedExecutionPlanV1,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type ExactProductStatePathV1,
  type FreshV2InitIdV1,
  type LowerHexSha256,
  type ManifestMigrationIdV1,
  type UtcTimestampV1,
} from "@developer-os/core";

import type { FileHandle } from "node:fs/promises";

const MAX_PLAN_BYTES = 268_435_456;
const MAX_JOURNAL_BYTES = 1_048_576;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const UINT64 = /^(?:0|[1-9][0-9]*)$/u;
const encoder = new TextEncoder();

class BootstrapJournalStoreError extends Error {
  constructor(message = "bootstrap journal store refused unbound or incomplete state") {
    super(message);
    this.name = "BootstrapJournalStoreError";
  }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface RetainedHandles {
  readonly state: FileHandle;
  readonly plan: FileHandle;
  readonly slots: readonly [FileHandle, FileHandle];
}

interface StoreIdentities {
  readonly state: FileIdentity;
  readonly plan: FileIdentity;
  readonly slots: readonly [FileIdentity, FileIdentity];
}

interface StoreCallbacks {
  readonly validateSlots: (
    plan: BootstrapRetainedExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
  readonly interrupt: ((point: BootstrapJournalStoreDeathPointV1) => void) | undefined;
}

function fail(message?: string): never {
  throw new BootstrapJournalStoreError(message);
}

function currentUid(): number {
  const value = process.getuid?.();
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}

function fileMode(stats: BigIntStats): bigint {
  return stats.mode & 0o777n;
}

function identity(stats: Pick<BigIntStats, "dev" | "ino">): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(stats: Pick<BigIntStats, "dev" | "ino">, expected: FileIdentity): boolean {
  return stats.dev === expected.dev && stats.ino === expected.ino;
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function encoded(value: unknown): Uint8Array {
  return encoder.encode(encodeCanonicalJson(value as CanonicalJsonValue));
}

function rawHash(bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function uint64(value: unknown): bigint {
  if (typeof value !== "string" || !UINT64.test(value)) return fail();
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64) return fail();
  return parsed;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new BootstrapJournalStoreError();
}

async function closeAll(handles: readonly (FileHandle | undefined)[]): Promise<Error | undefined> {
  let firstFailure: Error | undefined;
  for (const handle of handles) {
    if (handle === undefined) continue;
    try {
      await handle.close();
    } catch (error) {
      firstFailure ??= asError(error);
    }
  }
  return firstFailure;
}

function exactRegularFile(
  stats: BigIntStats,
  expected: FileIdentity,
  ownerUid: number,
  maximumBytes: number,
): boolean {
  return (
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    sameIdentity(stats, expected) &&
    stats.uid === BigInt(ownerUid) &&
    fileMode(stats) === 0o600n &&
    stats.nlink === 1n &&
    stats.size >= 0n &&
    stats.size <= BigInt(maximumBytes)
  );
}

async function assertBoundRegularFile(
  path: string,
  handle: FileHandle,
  expected: FileIdentity,
  ownerUid: number,
  maximumBytes: number,
): Promise<BigIntStats> {
  const descriptor = await handle.stat({ bigint: true });
  const linked = await nodeFs.lstat(path, { bigint: true });
  if (
    !exactRegularFile(descriptor, expected, ownerUid, maximumBytes) ||
    !exactRegularFile(linked, expected, ownerUid, maximumBytes) ||
    descriptor.size !== linked.size
  ) return fail();
  return descriptor;
}

async function openBoundRegularFile(
  path: string,
  flags: number,
  ownerUid: number,
  maximumBytes: number,
): Promise<{ readonly handle: FileHandle; readonly identity: FileIdentity }> {
  const before = await nodeFs.lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== BigInt(ownerUid) ||
    fileMode(before) !== 0o600n ||
    before.nlink !== 1n ||
    before.size < 0n ||
    before.size > BigInt(maximumBytes)
  ) return fail();
  const handle = await nodeFs.open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const expected = identity(before);
    await assertBoundRegularFile(path, handle, expected, ownerUid, maximumBytes);
    return { handle, identity: expected };
  } catch (error) {
    await closeAll([handle]);
    throw error;
  }
}

async function openStateDirectory(
  path: string,
  ownerUid: number,
): Promise<{ readonly handle: FileHandle; readonly identity: FileIdentity }> {
  const before = await nodeFs.lstat(path, { bigint: true });
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== BigInt(ownerUid) ||
    fileMode(before) !== 0o700n
  ) return fail();
  const handle = await nodeFs.open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const descriptor = await handle.stat({ bigint: true });
    const after = await nodeFs.lstat(path, { bigint: true });
    const expected = identity(before);
    if (
      !descriptor.isDirectory() ||
      !after.isDirectory() ||
      !sameIdentity(descriptor, expected) ||
      !sameIdentity(after, expected) ||
      descriptor.uid !== BigInt(ownerUid) ||
      after.uid !== BigInt(ownerUid) ||
      fileMode(descriptor) !== 0o700n ||
      fileMode(after) !== 0o700n
    ) return fail();
    return { handle, identity: expected };
  } catch (error) {
    await closeAll([handle]);
    throw error;
  }
}

async function assertStateDirectory(
  path: string,
  handle: FileHandle,
  expected: FileIdentity,
  ownerUid: number,
): Promise<void> {
  const descriptor = await handle.stat({ bigint: true });
  const linked = await nodeFs.lstat(path, { bigint: true });
  if (
    !descriptor.isDirectory() ||
    !linked.isDirectory() ||
    descriptor.isSymbolicLink() ||
    linked.isSymbolicLink() ||
    !sameIdentity(descriptor, expected) ||
    !sameIdentity(linked, expected) ||
    descriptor.uid !== BigInt(ownerUid) ||
    linked.uid !== BigInt(ownerUid) ||
    fileMode(descriptor) !== 0o700n ||
    fileMode(linked) !== 0o700n
  ) return fail();
}

async function syncStateDirectory(
  path: string,
  handle: FileHandle,
  expected: FileIdentity,
  ownerUid: number,
): Promise<void> {
  await assertStateDirectory(path, handle, expected, ownerUid);
  await handle.sync();
  await assertStateDirectory(path, handle, expected, ownerUid);
}

async function readBounded(
  path: string,
  handle: FileHandle,
  expected: FileIdentity,
  ownerUid: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  const before = await assertBoundRegularFile(path, handle, expected, ownerUid, maximumBytes);
  const size = Number(before.size);
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead < 1 || result.bytesRead > size - offset) return fail();
    offset += result.bytesRead;
  }
  const after = await assertBoundRegularFile(path, handle, expected, ownerUid, maximumBytes);
  if (after.size !== before.size) return fail();
  return bytes;
}

function decodeExactCanonical(bytes: Uint8Array, maximumBytes: number): unknown {
  const value = decodeCanonicalJson(bytes, maximumBytes);
  if (!exactBytes(bytes, encoded(value))) return fail();
  return value;
}

function decodeObserved(bytes: Uint8Array, maximumBytes: number): unknown {
  if (bytes.byteLength === 0) return null;
  try {
    return decodeExactCanonical(bytes, maximumBytes);
  } catch {
    return null;
  }
}

function validatePlanContract(
  plan: BootstrapRetainedExecutionPlanV1,
  planPath: ExactProductStatePathV1,
  slotPaths?: readonly [ExactProductStatePathV1, ExactProductStatePathV1],
): void {
  if (
    planPathOf(plan) !== planPath ||
    plan.journalSlots[0].slot !== 0 ||
    plan.journalSlots[1].slot !== 1 ||
    dirname(planPath) !== dirname(plan.journalSlots[0].path) ||
    dirname(planPath) !== dirname(plan.journalSlots[1].path) ||
    plan.journalSlots[0].path === plan.journalSlots[1].path ||
    !Number.isSafeInteger(plan.maximumPlanBytes) ||
    plan.maximumPlanBytes < 1 ||
    plan.maximumPlanBytes > MAX_PLAN_BYTES ||
    !Number.isSafeInteger(plan.maximumJournalBytes) ||
    plan.maximumJournalBytes < 1 ||
    plan.maximumJournalBytes > MAX_JOURNAL_BYTES ||
    (slotPaths !== undefined && (
      plan.journalSlots[0].path !== slotPaths[0] ||
      plan.journalSlots[1].path !== slotPaths[1]
    ))
  ) return fail();
}

function planPathOf(plan: BootstrapRetainedExecutionPlanV1): ExactProductStatePathV1 {
  return plan.operation === "fresh_v2_init" ? plan.planPath : plan.paths.plan;
}

function slotIdentityFromStats(
  slot: 0 | 1,
  path: ExactProductStatePathV1,
  stats: BigIntStats,
): BootstrapJournalSlotIdentityV1 {
  const uid = Number(stats.uid);
  if (!Number.isSafeInteger(uid)) return fail();
  return {
    slot,
    path,
    ownerUid: uid,
    mode: 0o600,
    nlink: 1,
    dev: stats.dev.toString() as BootstrapJournalSlotIdentityV1["dev"],
    ino: stats.ino.toString() as BootstrapJournalSlotIdentityV1["ino"],
  };
}

function validateSlotIdentities(
  plan: BootstrapRetainedExecutionPlanV1,
  identities: readonly [FileIdentity, FileIdentity],
  ownerUid: number,
): void {
  for (const slot of [0, 1] as const) {
    const expected = plan.journalSlots[slot];
    if (
      expected.ownerUid !== ownerUid ||
      expected.dev !== identities[slot].dev.toString() ||
      expected.ino !== identities[slot].ino.toString()
    ) return fail();
  }
}

function validateInitialSelection(
  plan: BootstrapRetainedExecutionPlanV1,
  initial: BootstrapJournalRecordV1,
  validateSlots: StoreCallbacks["validateSlots"],
): BootstrapJournalRecordV1 {
  const bytes = encoded(initial);
  if (
    bytes.byteLength > plan.maximumJournalBytes ||
    initial.slot !== 0 ||
    initial.sequence !== "0" ||
    initial.previousJournalHash !== null ||
    initial.phase !== "planned"
  ) return fail();
  const selection = validateSlots(plan, [initial, null]);
  if (
    selection.inactiveSlot !== 1 ||
    !exactBytes(encoded(selection.current), bytes)
  ) return fail();
  return selection.current;
}

async function createEmptySlot(
  path: ExactProductStatePathV1,
  ownerUid: number,
): Promise<{ readonly handle: FileHandle; readonly identity: FileIdentity; readonly stats: BigIntStats }> {
  const handle = await nodeFs.open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stats = await handle.stat({ bigint: true });
    const expected = identity(stats);
    if (!exactRegularFile(stats, expected, ownerUid, 0) || stats.size !== 0n) return fail();
    await assertBoundRegularFile(path, handle, expected, ownerUid, 0);
    return { handle, identity: expected, stats };
  } catch (error) {
    await closeAll([handle]);
    throw error;
  }
}

async function writeLoop(
  handle: FileHandle,
  bytes: Uint8Array,
  start: number,
  end: number,
): Promise<void> {
  let offset = start;
  while (offset < end) {
    const result = await handle.write(bytes, offset, end - offset, offset);
    if (result.bytesWritten < 1 || result.bytesWritten > end - offset) return fail();
    offset += result.bytesWritten;
  }
}

async function reopenAndValidate(
  path: string,
  expected: FileIdentity,
  ownerUid: number,
  maximumBytes: number,
  expectedBytes: Uint8Array,
): Promise<unknown> {
  const reopened = await openBoundRegularFile(
    path,
    constants.O_RDONLY,
    ownerUid,
    maximumBytes,
  );
  let value: unknown;
  let readFailure: Error | undefined;
  try {
    if (!sameIdentity(expected, reopened.identity)) return fail();
    const bytes = await readBounded(path, reopened.handle, expected, ownerUid, maximumBytes);
    if (!exactBytes(bytes, expectedBytes)) return fail();
    value = decodeExactCanonical(bytes, maximumBytes);
  } catch (error) {
    readFailure = asError(error);
  }
  const closeFailure = await closeAll([reopened.handle]);
  if (readFailure !== undefined) throw readFailure;
  if (closeFailure !== undefined) throw closeFailure;
  return value;
}

async function writeCanonicalInPlace(
  path: string,
  handle: FileHandle,
  expected: FileIdentity,
  ownerUid: number,
  maximumBytes: number,
  bytes: Uint8Array,
  interrupt: StoreCallbacks["interrupt"],
  duringPoint: BootstrapJournalStoreDeathPointV1,
): Promise<unknown> {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) return fail();
  await assertBoundRegularFile(path, handle, expected, ownerUid, maximumBytes);
  await handle.truncate(0);
  const split = Math.max(1, Math.floor(bytes.byteLength / 2));
  await writeLoop(handle, bytes, 0, split);
  interrupt?.(duringPoint);
  await writeLoop(handle, bytes, split, bytes.byteLength);
  await handle.truncate(bytes.byteLength);
  await handle.sync();
  await assertBoundRegularFile(path, handle, expected, ownerUid, maximumBytes);
  return reopenAndValidate(path, expected, ownerUid, maximumBytes, bytes);
}

function timestamp(now: () => Date): UtcTimestampV1 {
  try {
    return parseUtcTimestamp(now().toISOString());
  } catch {
    return fail();
  }
}

function assertSelection(
  selection: BootstrapJournalSelectionV1,
  observed: readonly [unknown, unknown],
): void {
  const candidateSlot: unknown = selection.current.slot;
  if (candidateSlot !== 0 && candidateSlot !== 1) return fail();
  const slot = candidateSlot;
  if (
    selection.inactiveSlot !== (slot === 0 ? 1 : 0) ||
    observed[slot] === null ||
    !exactBytes(encoded(selection.current), encoded(observed[slot])) ||
    Number(uint64(selection.current.sequence) % 2n) !== slot
  ) return fail();
}

function assertSuccessor(
  current: BootstrapJournalRecordV1,
  successor: BootstrapJournalRecordV1,
  inactiveSlot: 0 | 1,
): void {
  const currentSequence = uint64(current.sequence);
  const successorSequence = uint64(successor.sequence);
  const currentBytes = encoded(current);
  if (
    currentSequence === MAX_UINT64 ||
    successorSequence !== currentSequence + 1n ||
    successor.slot !== inactiveSlot ||
    successor.slot === current.slot ||
    Number(successorSequence % 2n) !== successor.slot ||
    successor.previousJournalHash !== rawHash(currentBytes) ||
    successor.createdAt !== current.createdAt ||
    Date.parse(successor.updatedAt) < Date.parse(current.updatedAt)
  ) return fail();
}

function exactSlotTuple(
  current: BootstrapJournalRecordV1,
  successor: BootstrapJournalRecordV1,
): readonly [BootstrapJournalRecordV1, BootstrapJournalRecordV1] {
  return current.slot === 0 ? [current, successor] : [successor, current];
}

export interface BootstrapJournalStoreOpenRequestV1 {
  readonly planPath: ExactProductStatePathV1;
  readonly expectedOperation: "fresh_v2_init" | "v1_to_v2";
  readonly expectedId: FreshV2InitIdV1 | ManifestMigrationIdV1;
  readonly validatePlan: (value: unknown) => BootstrapRetainedExecutionPlanV1;
  readonly validateSlots: (
    plan: BootstrapRetainedExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
  readonly buildInitialJournal: (
    plan: BootstrapRetainedExecutionPlanV1,
    timestamp: UtcTimestampV1,
  ) => BootstrapJournalRecordV1;
  readonly admitInitialWrite: (
    plan: BootstrapRetainedExecutionPlanV1,
  ) => void | Promise<void>;
  readonly now: () => Date;
  readonly interrupt?: (point: BootstrapJournalStoreDeathPointV1) => void;
}

export interface BootstrapJournalStoreCreateRequestV1 {
  readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly slotPaths: readonly [ExactProductStatePathV1, ExactProductStatePathV1];
  readonly planPath: ExactProductStatePathV1;
  readonly buildPlan: (
    slots: readonly [BootstrapJournalSlotIdentityV1, BootstrapJournalSlotIdentityV1],
  ) => BootstrapRetainedExecutionPlanV1;
  readonly buildInitialJournal: (
    plan: BootstrapRetainedExecutionPlanV1,
    timestamp: UtcTimestampV1,
  ) => BootstrapJournalRecordV1;
  readonly validatePlan: (value: unknown) => BootstrapRetainedExecutionPlanV1;
  readonly validateSlots: (
    plan: BootstrapRetainedExecutionPlanV1,
    slots: readonly [unknown, unknown],
  ) => BootstrapJournalSelectionV1;
  readonly now: () => Date;
  readonly interrupt?: (point: BootstrapJournalStoreDeathPointV1) => void;
}

export type BootstrapJournalStoreDeathPointV1 =
  | "after_slot_0_create"
  | "after_slot_0_sync"
  | "after_slot_1_create"
  | "after_slot_1_sync"
  | "during_plan_write"
  | "after_plan_sync"
  | "before_initial_slot_write"
  | "during_initial_slot_write"
  | "after_initial_slot_sync"
  | "after_initial_state_sync"
  | "during_inactive_slot_write"
  | "after_inactive_slot_sync"
  | "after_state_sync";

export class BootstrapJournalStore {
  readonly plan: BootstrapRetainedExecutionPlanV1;
  readonly #ownerUid: number;
  readonly #stateDirectory: CanonicalAbsolutePathV1;
  readonly #planPath: ExactProductStatePathV1;
  readonly #planBytes: Uint8Array;
  readonly #handles: RetainedHandles;
  readonly #identities: StoreIdentities;
  readonly #callbacks: StoreCallbacks;
  #selection: BootstrapJournalSelectionV1;
  #closed = false;

  private constructor(input: {
    readonly plan: BootstrapRetainedExecutionPlanV1;
    readonly ownerUid: number;
    readonly stateDirectory: CanonicalAbsolutePathV1;
    readonly planPath: ExactProductStatePathV1;
    readonly planBytes: Uint8Array;
    readonly handles: RetainedHandles;
    readonly identities: StoreIdentities;
    readonly callbacks: StoreCallbacks;
    readonly selection: BootstrapJournalSelectionV1;
  }) {
    this.plan = deepFreeze(structuredClone(input.plan));
    this.#ownerUid = input.ownerUid;
    this.#stateDirectory = input.stateDirectory;
    this.#planPath = input.planPath;
    this.#planBytes = input.planBytes.slice();
    this.#handles = input.handles;
    this.#identities = input.identities;
    this.#callbacks = input.callbacks;
    this.#selection = structuredClone(input.selection);
  }

  static async create(request: BootstrapJournalStoreCreateRequestV1): Promise<BootstrapJournalStore> {
    const ownerUid = currentUid();
    let state: Awaited<ReturnType<typeof openStateDirectory>> | undefined;
    let slot0: Awaited<ReturnType<typeof createEmptySlot>> | undefined;
    let slot1: Awaited<ReturnType<typeof createEmptySlot>> | undefined;
    let planHandle: FileHandle | undefined;
    let planIdentity: FileIdentity | undefined;
    try {
      if (
        dirname(request.planPath) !== request.stateDirectory ||
        dirname(request.slotPaths[0]) !== request.stateDirectory ||
        dirname(request.slotPaths[1]) !== request.stateDirectory ||
        request.planPath === request.slotPaths[0] ||
        request.planPath === request.slotPaths[1] ||
        request.slotPaths[0] === request.slotPaths[1]
      ) return fail();
      state = await openStateDirectory(request.stateDirectory, ownerUid);

      slot0 = await createEmptySlot(request.slotPaths[0], ownerUid);
      request.interrupt?.("after_slot_0_create");
      await slot0.handle.sync();
      await assertBoundRegularFile(request.slotPaths[0], slot0.handle, slot0.identity, ownerUid, 0);
      request.interrupt?.("after_slot_0_sync");

      slot1 = await createEmptySlot(request.slotPaths[1], ownerUid);
      request.interrupt?.("after_slot_1_create");
      await slot1.handle.sync();
      await assertBoundRegularFile(request.slotPaths[1], slot1.handle, slot1.identity, ownerUid, 0);
      request.interrupt?.("after_slot_1_sync");
      await syncStateDirectory(request.stateDirectory, state.handle, state.identity, ownerUid);

      const slotIdentities = [
        slotIdentityFromStats(0, request.slotPaths[0], slot0.stats),
        slotIdentityFromStats(1, request.slotPaths[1], slot1.stats),
      ] as const;
      const plan = request.validatePlan(request.buildPlan(slotIdentities));
      validatePlanContract(plan, request.planPath, request.slotPaths);
      validateSlotIdentities(plan, [slot0.identity, slot1.identity], ownerUid);
      const planBytes = encoded(plan);
      if (planBytes.byteLength > plan.maximumPlanBytes) return fail();

      planHandle = await nodeFs.open(
        request.planPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      const planStats = await planHandle.stat({ bigint: true });
      planIdentity = identity(planStats);
      if (!exactRegularFile(planStats, planIdentity, ownerUid, plan.maximumPlanBytes)) return fail();
      await assertBoundRegularFile(
        request.planPath,
        planHandle,
        planIdentity,
        ownerUid,
        plan.maximumPlanBytes,
      );
      const persistedPlanValue = await writeCanonicalInPlace(
        request.planPath,
        planHandle,
        planIdentity,
        ownerUid,
        plan.maximumPlanBytes,
        planBytes,
        request.interrupt,
        "during_plan_write",
      );
      const persistedPlan = request.validatePlan(persistedPlanValue);
      validatePlanContract(persistedPlan, request.planPath, request.slotPaths);
      validateSlotIdentities(persistedPlan, [slot0.identity, slot1.identity], ownerUid);
      if (!exactBytes(encoded(persistedPlan), planBytes)) return fail();
      await syncStateDirectory(request.stateDirectory, state.handle, state.identity, ownerUid);
      request.interrupt?.("after_plan_sync");

      const initial = validateInitialSelection(
        persistedPlan,
        request.buildInitialJournal(persistedPlan, timestamp(request.now)),
        request.validateSlots,
      );
      const initialBytes = encoded(initial);
      request.interrupt?.("before_initial_slot_write");
      const persistedInitial = await writeCanonicalInPlace(
        request.slotPaths[0],
        slot0.handle,
        slot0.identity,
        ownerUid,
        persistedPlan.maximumJournalBytes,
        initialBytes,
        request.interrupt,
        "during_initial_slot_write",
      );
      const observed = [persistedInitial, null] as const;
      const selection = request.validateSlots(persistedPlan, observed);
      assertSelection(selection, observed);
      request.interrupt?.("after_initial_slot_sync");
      await syncStateDirectory(request.stateDirectory, state.handle, state.identity, ownerUid);
      request.interrupt?.("after_initial_state_sync");

      return new BootstrapJournalStore({
        plan: persistedPlan,
        ownerUid,
        stateDirectory: request.stateDirectory,
        planPath: request.planPath,
        planBytes,
        handles: { state: state.handle, plan: planHandle, slots: [slot0.handle, slot1.handle] },
        identities: {
          state: state.identity,
          plan: planIdentity,
          slots: [slot0.identity, slot1.identity],
        },
        callbacks: { validateSlots: request.validateSlots, interrupt: request.interrupt },
        selection,
      });
    } catch (error) {
      await closeAll([planHandle, slot1?.handle, slot0?.handle, state?.handle]);
      throw error;
    }
  }

  static async open(request: BootstrapJournalStoreOpenRequestV1): Promise<BootstrapJournalStore> {
    const ownerUid = currentUid();
    const stateDirectory = dirname(request.planPath) as CanonicalAbsolutePathV1;
    let state: Awaited<ReturnType<typeof openStateDirectory>> | undefined;
    let planFile: Awaited<ReturnType<typeof openBoundRegularFile>> | undefined;
    let slot0: Awaited<ReturnType<typeof openBoundRegularFile>> | undefined;
    let slot1: Awaited<ReturnType<typeof openBoundRegularFile>> | undefined;
    try {
      state = await openStateDirectory(stateDirectory, ownerUid);
      planFile = await openBoundRegularFile(
        request.planPath,
        constants.O_RDWR,
        ownerUid,
        MAX_PLAN_BYTES,
      );
      const planBytes = await readBounded(
        request.planPath,
        planFile.handle,
        planFile.identity,
        ownerUid,
        MAX_PLAN_BYTES,
      );
      const plan = request.validatePlan(decodeExactCanonical(planBytes, MAX_PLAN_BYTES));
      if (!exactBytes(encoded(plan), planBytes)) return fail();
      validatePlanContract(plan, request.planPath);
      if (plan.operation !== request.expectedOperation || plan.id !== request.expectedId) return fail();
      if (planBytes.byteLength > plan.maximumPlanBytes) return fail();

      slot0 = await openBoundRegularFile(
        plan.journalSlots[0].path,
        constants.O_RDWR,
        ownerUid,
        plan.maximumJournalBytes,
      );
      slot1 = await openBoundRegularFile(
        plan.journalSlots[1].path,
        constants.O_RDWR,
        ownerUid,
        plan.maximumJournalBytes,
      );
      validateSlotIdentities(plan, [slot0.identity, slot1.identity], ownerUid);
      const raw: [Uint8Array, Uint8Array] = await Promise.all([
        readBounded(plan.journalSlots[0].path, slot0.handle, slot0.identity, ownerUid, plan.maximumJournalBytes),
        readBounded(plan.journalSlots[1].path, slot1.handle, slot1.identity, ownerUid, plan.maximumJournalBytes),
      ]);
      const observed = [
        decodeObserved(raw[0], plan.maximumJournalBytes),
        decodeObserved(raw[1], plan.maximumJournalBytes),
      ] as const;

      let selection: BootstrapJournalSelectionV1;
      try {
        selection = request.validateSlots(plan, observed);
        assertSelection(selection, observed);
      } catch (selectionError) {
        const initial = validateInitialSelection(
          plan,
          request.buildInitialJournal(plan, timestamp(request.now)),
          request.validateSlots,
        );
        const initialBytes = encoded(initial);
        if (raw[1].byteLength !== 0 || observed[0] !== null || observed[1] !== null) {
          throw asError(selectionError);
        }
        await assertBoundRegularFile(request.planPath, planFile.handle, planFile.identity, ownerUid, plan.maximumPlanBytes);
        await assertStateDirectory(stateDirectory, state.handle, state.identity, ownerUid);
        await assertBoundRegularFile(plan.journalSlots[0].path, slot0.handle, slot0.identity, ownerUid, plan.maximumJournalBytes);
        await assertBoundRegularFile(plan.journalSlots[1].path, slot1.handle, slot1.identity, ownerUid, plan.maximumJournalBytes);
        await request.admitInitialWrite(plan);
        request.interrupt?.("before_initial_slot_write");
        const persistedInitial = await writeCanonicalInPlace(
          plan.journalSlots[0].path,
          slot0.handle,
          slot0.identity,
          ownerUid,
          plan.maximumJournalBytes,
          initialBytes,
          request.interrupt,
          "during_initial_slot_write",
        );
        const initialized = [persistedInitial, null] as const;
        selection = request.validateSlots(plan, initialized);
        assertSelection(selection, initialized);
        request.interrupt?.("after_initial_slot_sync");
        await syncStateDirectory(stateDirectory, state.handle, state.identity, ownerUid);
        request.interrupt?.("after_initial_state_sync");
      }

      return new BootstrapJournalStore({
        plan,
        ownerUid,
        stateDirectory,
        planPath: request.planPath,
        planBytes,
        handles: { state: state.handle, plan: planFile.handle, slots: [slot0.handle, slot1.handle] },
        identities: {
          state: state.identity,
          plan: planFile.identity,
          slots: [slot0.identity, slot1.identity],
        },
        callbacks: { validateSlots: request.validateSlots, interrupt: request.interrupt },
        selection,
      });
    } catch (error) {
      await closeAll([slot1?.handle, slot0?.handle, planFile?.handle, state?.handle]);
      throw error;
    }
  }

  current(): BootstrapJournalRecordV1 {
    if (this.#closed) return fail("bootstrap journal store is closed");
    return structuredClone(this.#selection.current);
  }

  async advance(successor: BootstrapJournalRecordV1): Promise<void> {
    if (this.#closed) return fail("bootstrap journal store is closed");
    await this.#assertAuthority();
    const current = this.#selection.current;
    assertSuccessor(current, successor, this.#selection.inactiveSlot);
    const successorBytes = encoded(successor);
    if (successorBytes.byteLength > this.plan.maximumJournalBytes) return fail();
    const tuple = exactSlotTuple(current, successor);
    const selection = this.#callbacks.validateSlots(this.plan, tuple);
    assertSelection(selection, tuple);
    if (
      !exactBytes(encoded(selection.current), successorBytes) ||
      selection.inactiveSlot !== current.slot
    ) return fail();

    const inactive = this.#selection.inactiveSlot;
    const persisted = await writeCanonicalInPlace(
      this.plan.journalSlots[inactive].path,
      this.#handles.slots[inactive],
      this.#identities.slots[inactive],
      this.#ownerUid,
      this.plan.maximumJournalBytes,
      successorBytes,
      this.#callbacks.interrupt,
      "during_inactive_slot_write",
    );
    const persistedTuple = current.slot === 0
      ? [current, persisted] as const
      : [persisted, current] as const;
    const persistedSelection = this.#callbacks.validateSlots(this.plan, persistedTuple);
    assertSelection(persistedSelection, persistedTuple);
    if (!exactBytes(encoded(persistedSelection.current), successorBytes)) return fail();
    this.#callbacks.interrupt?.("after_inactive_slot_sync");
    await syncStateDirectory(
      this.#stateDirectory,
      this.#handles.state,
      this.#identities.state,
      this.#ownerUid,
    );
    this.#callbacks.interrupt?.("after_state_sync");
    this.#selection = structuredClone(persistedSelection);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const failure = await closeAll([
      this.#handles.slots[0],
      this.#handles.slots[1],
      this.#handles.plan,
      this.#handles.state,
    ]);
    if (failure !== undefined) throw failure;
  }

  async #assertAuthority(): Promise<void> {
    await assertStateDirectory(
      this.#stateDirectory,
      this.#handles.state,
      this.#identities.state,
      this.#ownerUid,
    );
    const planBytes = await readBounded(
      this.#planPath,
      this.#handles.plan,
      this.#identities.plan,
      this.#ownerUid,
      this.plan.maximumPlanBytes,
    );
    if (!exactBytes(planBytes, this.#planBytes)) return fail();
    const persistedPlan = decodeExactCanonical(planBytes, this.plan.maximumPlanBytes);
    if (!exactBytes(encoded(persistedPlan), encoded(this.plan))) return fail();
    const raw = await Promise.all(([0, 1] as const).map((slot) => readBounded(
      this.plan.journalSlots[slot].path,
      this.#handles.slots[slot],
      this.#identities.slots[slot],
      this.#ownerUid,
      this.plan.maximumJournalBytes,
    ))) as [Uint8Array, Uint8Array];
    const observed = [
      decodeObserved(raw[0], this.plan.maximumJournalBytes),
      decodeObserved(raw[1], this.plan.maximumJournalBytes),
    ] as const;
    const selection = this.#callbacks.validateSlots(this.plan, observed);
    assertSelection(selection, observed);
    if (
      selection.inactiveSlot !== this.#selection.inactiveSlot ||
      !exactBytes(encoded(selection.current), encoded(this.#selection.current))
    ) return fail();
  }
}
