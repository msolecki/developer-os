import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeCanonicalJson,
  parseLowerHexSha256,
  parseUInt64Decimal,
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
  type UtcTimestampV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BootstrapJournalStore,
  type BootstrapJournalStoreCreateRequestV1,
  type BootstrapJournalStoreDeathPointV1,
  type BootstrapJournalStoreOpenRequestV1,
} from "./journal-store.js";

const fsFaults = vi.hoisted(() => ({
  closeFailurePath: null as string | null,
  syncFailurePath: null as string | null,
  syncFailuresRemaining: 0,
  writeMode: null as "short" | "zero" | null,
  writePath: null as string | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const path = String(args[0]);
      return new Proxy(handle, {
        get(target, property) {
          if (property === "close") {
            return async () => {
              await target.close();
              if (fsFaults.closeFailurePath === path) throw new Error("synthetic close failure");
            };
          }
          if (property === "sync") {
            return async () => {
              if (fsFaults.syncFailurePath === path && fsFaults.syncFailuresRemaining > 0) {
                fsFaults.syncFailuresRemaining -= 1;
                throw new Error("synthetic sync failure");
              }
              await target.sync();
            };
          }
          if (property === "write") {
            return async (
              buffer: Uint8Array,
              offset: number,
              length: number,
              position: number,
            ) => {
              if (fsFaults.writePath === path && fsFaults.writeMode === "zero") {
                return { bytesWritten: 0, buffer };
              }
              const admittedLength = fsFaults.writePath === path && fsFaults.writeMode === "short"
                ? Math.max(1, Math.floor(length / 2))
                : length;
              return target.write(buffer, offset, admittedLength, position);
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          if (typeof value !== "function") return value;
          return (...parameters: unknown[]): unknown => Reflect.apply(
            value as (...args: unknown[]) => unknown,
            target,
            parameters,
          );
        },
      });
    },
  };
});

const ID = "fi_6ba7b810-9dad-41d1-80b4-00c04fd430c8" as FreshV2InitIdV1;
const NOW = "2026-08-31T08:00:00.000Z";
const MAX_UINT64 = "18446744073709551615";
const encoder = new TextEncoder();

const canonicalPath = (value: string) => value as CanonicalAbsolutePathV1;
const exactPath = (value: string) => value as ExactProductStatePathV1;
const hashBytes = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(
  createHash("sha256").update(value).digest("hex"),
);
const canonicalBytes = (value: unknown): Uint8Array => encoder.encode(
  encodeCanonicalJson(value as CanonicalJsonValue),
);
const canonicalHash = (value: unknown): LowerHexSha256 => hashBytes(canonicalBytes(value));

class SyntheticDeath extends Error {
  constructor(readonly point: BootstrapJournalStoreDeathPointV1) {
    super(`synthetic death at ${point}`);
  }
}

interface Fixture {
  readonly root: string;
  readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly slotPaths: readonly [ExactProductStatePathV1, ExactProductStatePathV1];
  readonly planPath: ExactProductStatePathV1;
  readonly createRequest: BootstrapJournalStoreCreateRequestV1;
  readonly openRequest: BootstrapJournalStoreOpenRequestV1;
  readonly admissionCalls: { count: number };
}

const roots = new Set<string>();

function mode(stats: Stats): number {
  return stats.mode & 0o777;
}

function slotIdentity(
  slot: 0 | 1,
  path: ExactProductStatePathV1,
  stats: Stats,
): BootstrapJournalSlotIdentityV1 {
  return {
    slot,
    path,
    ownerUid: stats.uid,
    mode: 0o600,
    nlink: 1,
    dev: parseUInt64Decimal(String(stats.dev)),
    ino: parseUInt64Decimal(String(stats.ino)),
  };
}

function buildPlan(
  fixture: Pick<Fixture, "planPath">,
  slots: readonly [BootstrapJournalSlotIdentityV1, BootstrapJournalSlotIdentityV1],
  maximumJournalBytes = 1_048_576,
): BootstrapRetainedExecutionPlanV1 {
  return {
    schemaVersion: 1,
    operation: "fresh_v2_init",
    id: ID,
    planPath: fixture.planPath,
    maximumPlanBytes: 268_435_456,
    maximumJournalBytes,
    maximumStagingEntries: 0,
    journalSlots: slots,
    payloads: [],
    createdPaths: [],
    foundationParticipants: [],
    launchabilityPaths: [],
    synthetic: "content-free",
  } as unknown as BootstrapRetainedExecutionPlanV1;
}

function initialJournal(
  plan: BootstrapRetainedExecutionPlanV1,
  timestamp: UtcTimestampV1,
): BootstrapJournalRecordV1 {
  return {
    schemaVersion: 1,
    id: plan.id,
    planHash: canonicalHash(plan),
    slot: 0,
    sequence: parseUInt64Decimal("0"),
    previousJournalHash: null,
    phase: "planned",
    direction: "forward",
    nextPayload: 0,
    payloadWriteState: { state: "idle" },
    nextCreatedPath: 0,
    nextFoundationParticipant: 0,
    nextLaunchabilityPath: 0,
    manifestCursor: 0,
    compensationNext: null,
    payloadRetentionPart: null,
    terminalOutcome: null,
    retentionNext: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function parsedJournal(
  plan: BootstrapRetainedExecutionPlanV1,
  value: unknown,
  expectedSlot: 0 | 1,
): BootstrapJournalRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const journal = value as BootstrapJournalRecordV1;
  if (
    journal.id !== plan.id ||
    journal.planHash !== canonicalHash(plan) ||
    journal.slot !== expectedSlot ||
    journal.slot !== Number(BigInt(journal.sequence) % 2n) ||
    (journal.sequence === "0" && (
      journal.slot !== 0 ||
      journal.previousJournalHash !== null ||
      journal.phase !== "planned"
    )) ||
    (journal.sequence !== "0" && journal.previousJournalHash === null)
  ) throw new Error("synthetic slot validator refused the record");
  return journal;
}

function validateSlots(
  plan: BootstrapRetainedExecutionPlanV1,
  values: readonly [unknown, unknown],
): BootstrapJournalSelectionV1 {
  const slots = [parsedJournal(plan, values[0], 0), parsedJournal(plan, values[1], 1)] as const;
  const present = slots.filter((value): value is BootstrapJournalRecordV1 => value !== null);
  if (present.length === 0) throw new Error("no valid journal");
  if (present.length === 1) {
    const current = present[0] as BootstrapJournalRecordV1;
    return { current, inactiveSlot: current.slot === 0 ? 1 : 0 };
  }
  const first = present[0] as BootstrapJournalRecordV1;
  const second = present[1] as BootstrapJournalRecordV1;
  if (first.sequence === second.sequence) throw new Error("forked journal slots");
  const [current, next] = BigInt(first.sequence) < BigInt(second.sequence)
    ? [first, second]
    : [second, first];
  if (
    BigInt(next.sequence) !== BigInt(current.sequence) + 1n ||
    next.previousJournalHash !== canonicalHash(current)
  ) throw new Error("non-adjacent journal slots");
  return { current: next, inactiveSlot: current.slot };
}

function validatePlan(value: unknown): BootstrapRetainedExecutionPlanV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("synthetic plan validator refused non-object");
  }
  const plan = value as BootstrapRetainedExecutionPlanV1;
  if (
    plan.operation !== "fresh_v2_init" ||
    plan.id !== ID ||
    plan.journalSlots[0].slot !== 0 ||
    plan.journalSlots[1].slot !== 1
  ) throw new Error("synthetic plan validator refused the plan");
  return plan;
}

function nextJournal(
  store: BootstrapJournalStore,
  overrides: Partial<BootstrapJournalRecordV1> & { readonly padding?: string } = {},
): BootstrapJournalRecordV1 {
  const current = store.current();
  return {
    ...current,
    ...overrides,
    slot: current.slot === 0 ? 1 : 0,
    sequence: parseUInt64Decimal((BigInt(current.sequence) + 1n).toString()),
    previousJournalHash: canonicalHash(current),
    phase: "payload_staging",
    updatedAt: parseUtcTimestamp("2026-08-31T08:00:01.000Z"),
  };
}

async function createFixture(): Promise<Fixture> {
  const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-journal-store-"));
  roots.add(root);
  const stateDirectory = canonicalPath(join(root, "state"));
  await nodeFs.mkdir(stateDirectory, { mode: 0o700 });
  const planPath = exactPath(join(stateDirectory, `fresh-v2-init.${ID}.plan.json`));
  const slotPaths = [
    exactPath(join(stateDirectory, `fresh-v2-init.${ID}.journal.0.json`)),
    exactPath(join(stateDirectory, `fresh-v2-init.${ID}.journal.1.json`)),
  ] as const;
  const admissionCalls = { count: 0 };
  const fixture = { root, stateDirectory, planPath, slotPaths } as Pick<Fixture, "root" | "stateDirectory" | "planPath" | "slotPaths">;
  const common = {
    planPath,
    buildInitialJournal: initialJournal,
    validatePlan,
    validateSlots,
    now: () => new Date(NOW),
  };
  const createRequest: BootstrapJournalStoreCreateRequestV1 = {
    ...common,
    stateDirectory,
    slotPaths,
    buildPlan: (slots) => buildPlan(fixture, slots),
  };
  const openRequest: BootstrapJournalStoreOpenRequestV1 = {
    ...common,
    expectedOperation: "fresh_v2_init",
    expectedId: ID,
    admitInitialWrite: () => {
      admissionCalls.count += 1;
    },
  };
  return { ...fixture, createRequest, openRequest, admissionCalls };
}

async function inventory(fixture: Fixture): Promise<readonly unknown[]> {
  const names = (await nodeFs.readdir(fixture.stateDirectory)).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(fixture.stateDirectory, name);
    const stats = await nodeFs.lstat(path);
    return {
      name,
      dev: String(stats.dev),
      ino: String(stats.ino),
      mode: mode(stats),
      bytes: Buffer.from(await nodeFs.readFile(path)).toString("base64"),
    };
  }));
}

async function replacePath(path: string, contents: string): Promise<Uint8Array> {
  await nodeFs.rename(path, `${path}.original`);
  await nodeFs.writeFile(path, contents, { mode: 0o600, flag: "wx" });
  return nodeFs.readFile(path);
}

async function writeExactPrefix(path: string, bytes: Uint8Array, length: number): Promise<void> {
  const handle = await nodeFs.open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    await handle.truncate(0);
    if (length > 0) await handle.write(bytes, 0, length, 0);
    await handle.truncate(length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function prepareDurablePlan(
  fixture: Fixture,
  mutate: (plan: BootstrapRetainedExecutionPlanV1) => BootstrapRetainedExecutionPlanV1 = (plan) => plan,
): Promise<{ readonly plan: BootstrapRetainedExecutionPlanV1; readonly bytes: Uint8Array }> {
  const identities: BootstrapJournalSlotIdentityV1[] = [];
  for (const slot of [0, 1] as const) {
    const handle = await nodeFs.open(
      fixture.slotPaths[slot],
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.sync();
    await handle.close();
    identities.push(slotIdentity(slot, fixture.slotPaths[slot], await nodeFs.lstat(fixture.slotPaths[slot])));
  }
  const slots = identities as unknown as readonly [BootstrapJournalSlotIdentityV1, BootstrapJournalSlotIdentityV1];
  const plan = mutate(buildPlan(fixture, slots));
  const bytes = canonicalBytes(plan);
  await nodeFs.writeFile(fixture.planPath, bytes, { mode: 0o600, flag: "wx" });
  return { plan, bytes };
}

async function descriptorCount(): Promise<number> {
  return (await nodeFs.readdir("/dev/fd")).length;
}

afterEach(async () => {
  fsFaults.closeFailurePath = null;
  fsFaults.syncFailurePath = null;
  fsFaults.syncFailuresRemaining = 0;
  fsFaults.writeMode = null;
  fsFaults.writePath = null;
  await Promise.all([...roots].map(async (root) => {
    await nodeFs.rm(root, { recursive: true, force: true });
    roots.delete(root);
  }));
});

describe("BootstrapJournalStore creation and recovery", () => {
  it("publishes one immutable final-path plan and initializes only slot zero", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);

    expect(store.current()).toMatchObject({ slot: 0, sequence: "0", phase: "planned" });
    expect(await nodeFs.readFile(fixture.slotPaths[1])).toHaveLength(0);
    expect((await nodeFs.readdir(fixture.stateDirectory)).sort()).toEqual([
      `fresh-v2-init.${ID}.journal.0.json`,
      `fresh-v2-init.${ID}.journal.1.json`,
      `fresh-v2-init.${ID}.plan.json`,
    ]);
    expect(validatePlan(JSON.parse(JSON.stringify(store.plan)))).toBeDefined();
    await store.close();
  });

  it.each([
    "after_slot_0_create",
    "after_slot_0_sync",
    "after_slot_1_create",
    "after_slot_1_sync",
    "during_plan_write",
  ] as const)("preserves an unverified pre-plan death at %s", async (point) => {
    const fixture = await createFixture();
    await expect(BootstrapJournalStore.create({
      ...fixture.createRequest,
      interrupt: (observed) => {
        if (observed === point) throw new SyntheticDeath(observed);
      },
    })).rejects.toMatchObject({ point });
    const before = await inventory(fixture);

    await expect(BootstrapJournalStore.open(fixture.openRequest)).rejects.toBeDefined();
    expect(await inventory(fixture)).toEqual(before);
  });

  it.each([
    "after_plan_sync",
    "before_initial_slot_write",
    "during_initial_slot_write",
    "after_initial_slot_sync",
    "after_initial_state_sync",
  ] as const)("initializes only a durable identity-bound plan after death at %s", async (point) => {
    const fixture = await createFixture();
    await expect(BootstrapJournalStore.create({
      ...fixture.createRequest,
      interrupt: (observed) => {
        if (observed === point) throw new SyntheticDeath(observed);
      },
    })).rejects.toMatchObject({ point });
    const planBefore = await nodeFs.readFile(fixture.planPath);
    const identitiesBefore = await Promise.all(fixture.slotPaths.map(async (path) => {
      const stats = await nodeFs.lstat(path);
      return [String(stats.dev), String(stats.ino)] as const;
    }));

    const resumed = await BootstrapJournalStore.open(fixture.openRequest);
    expect(resumed.current()).toMatchObject({ slot: 0, sequence: "0" });
    expect(fixture.admissionCalls.count).toBe(
      point === "after_initial_slot_sync" || point === "after_initial_state_sync" ? 0 : 1,
    );
    expect(await nodeFs.readFile(fixture.planPath)).toEqual(planBefore);
    expect(await Promise.all(fixture.slotPaths.map(async (path) => {
      const stats = await nodeFs.lstat(path);
      return [String(stats.dev), String(stats.ino)] as const;
    }))).toEqual(identitiesBefore);
    await resumed.close();
  });

  it("recovers a partial initial slot with a newly admitted timestamp", async () => {
    const fixture = await createFixture();
    await expect(BootstrapJournalStore.create({
      ...fixture.createRequest,
      interrupt: (point) => {
        if (point === "during_initial_slot_write") throw new SyntheticDeath(point);
      },
    })).rejects.toMatchObject({ point: "during_initial_slot_write" });

    const resumed = await BootstrapJournalStore.open({
      ...fixture.openRequest,
      now: () => new Date("2026-08-31T09:00:00.000Z"),
    });

    expect(resumed.current()).toMatchObject({
      slot: 0,
      sequence: "0",
      createdAt: "2026-08-31T09:00:00.000Z",
      updatedAt: "2026-08-31T09:00:00.000Z",
    });
    await resumed.close();
  });

  it("refuses zero-byte and every byte-prefix partial final-path plan without mutation", async () => {
    const seed = await createFixture();
    const prepared = await prepareDurablePlan(seed);
    const planBytes = prepared.bytes;
    await nodeFs.rm(seed.root, { recursive: true, force: true });
    roots.delete(seed.root);
    const descriptorsBefore = await descriptorCount();

    for (let length = 0; length < planBytes.byteLength; length += 1) {
      const fixture = await createFixture();
      await prepareDurablePlan(fixture);
      await writeExactPrefix(fixture.planPath, planBytes, length);
      const before = await inventory(fixture);
      await expect(BootstrapJournalStore.open(fixture.openRequest)).rejects.toBeDefined();
      expect(await inventory(fixture)).toEqual(before);
      await nodeFs.rm(fixture.root, { recursive: true, force: true });
      roots.delete(fixture.root);
    }
    expect(await descriptorCount()).toBe(descriptorsBefore);
  }, 60_000);

  it.each([0, 1, 2] as const)("preserves pre-plan residue with %s occupied slot paths", async (occupied) => {
    const fixture = await createFixture();
    for (let slot = 0; slot < occupied; slot += 1) {
      await nodeFs.writeFile(fixture.slotPaths[slot] as string, `pre-plan-${String(slot)}`, {
        mode: 0o600,
        flag: "wx",
      });
    }
    const before = await Promise.all(fixture.slotPaths.slice(0, occupied).map((path) => nodeFs.readFile(path)));

    if (occupied === 0) {
      const store = await BootstrapJournalStore.create(fixture.createRequest);
      await store.close();
    } else {
      await expect(BootstrapJournalStore.create(fixture.createRequest)).rejects.toBeDefined();
    }
    expect(await Promise.all(fixture.slotPaths.slice(0, occupied).map((path) => nodeFs.readFile(path)))).toEqual(before);
  });

  it.each(["path", "order", "dev", "ino"] as const)("refuses a plan with wrong slot %s", async (mutation) => {
    const fixture = await createFixture();
    await prepareDurablePlan(fixture, (plan) => {
      const slots = plan.journalSlots.map((slot) => ({ ...slot })) as [BootstrapJournalSlotIdentityV1, BootstrapJournalSlotIdentityV1];
      if (mutation === "path") slots[0] = { ...slots[0], path: exactPath(`${slots[0].path}.wrong`) };
      if (mutation === "order") slots.reverse();
      if (mutation === "dev") slots[0] = { ...slots[0], dev: parseUInt64Decimal((BigInt(slots[0].dev) + 1n).toString()) };
      if (mutation === "ino") slots[1] = { ...slots[1], ino: parseUInt64Decimal((BigInt(slots[1].ino) + 1n).toString()) };
      return { ...plan, journalSlots: slots };
    });
    const before = await inventory(fixture);

    await expect(BootstrapJournalStore.open(fixture.openRequest)).rejects.toBeDefined();
    expect(await inventory(fixture)).toEqual(before);
  });

  it("calls the guarded admission before recovering a zero or partial initial slot", async () => {
    const fixture = await createFixture();
    const prepared = await prepareDurablePlan(fixture);
    const candidate = canonicalBytes(initialJournal(prepared.plan, parseUtcTimestamp(NOW)));
    await writeExactPrefix(fixture.slotPaths[0], candidate, candidate.byteLength - 1);
    const marker = join(fixture.stateDirectory, "post-plan-mutation");
    await nodeFs.writeFile(marker, "synthetic mutation", { mode: 0o600 });
    const before = await inventory(fixture);

    await expect(BootstrapJournalStore.open({
      ...fixture.openRequest,
      admitInitialWrite: () => {
        throw new Error("guarded post-plan inventory changed");
      },
    })).rejects.toThrow("guarded post-plan inventory changed");
    expect(await inventory(fixture)).toEqual(before);
  });

  it.each([
    ["operation", { expectedOperation: "v1_to_v2" as const }],
    ["id", { expectedId: "fi_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as FreshV2InitIdV1 }],
  ] as const)("refuses an unexpected plan %s without mutation", async (_name, override) => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    await store.close();
    const before = await inventory(fixture);

    await expect(BootstrapJournalStore.open({ ...fixture.openRequest, ...override })).rejects.toBeDefined();
    expect(await inventory(fixture)).toEqual(before);
  });

  it("refuses a validator-substituted plan without changing plan-bound residue", async () => {
    const fixture = await createFixture();
    await prepareDurablePlan(fixture);
    const before = await inventory(fixture);

    const result = await BootstrapJournalStore.open({
      ...fixture.openRequest,
      validatePlan: (value) => {
        const plan = validatePlan(value);
        return { ...plan, maximumJournalBytes: plan.maximumJournalBytes - 1 };
      },
    }).then(async (store) => {
      await store.close();
      return "opened" as const;
    }, () => "refused" as const);

    expect(result).toBe("refused");
    expect(await inventory(fixture)).toEqual(before);
  });
});

describe("BootstrapJournalStore descriptor-bound advancement", () => {
  it.each(["plan", "current", "inactive"] as const)("refuses a %s path replacement without writing the replacement", async (target) => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const path = target === "plan"
      ? fixture.planPath
      : fixture.slotPaths[target === "current" ? store.current().slot : (store.current().slot === 0 ? 1 : 0)];
    const replacement = await replacePath(path, `replacement-${target}`);
    const inactiveBefore = await nodeFs.readFile(fixture.slotPaths[1]);

    await expect(store.advance(nextJournal(store))).rejects.toBeDefined();
    expect(await nodeFs.readFile(path)).toEqual(replacement);
    if (target !== "inactive") expect(await nodeFs.readFile(fixture.slotPaths[1])).toEqual(inactiveBefore);
    await store.close();
  });

  it.each([0, "middle", "last-minus-one"] as const)("keeps the prior current authoritative beside a partial inactive write at %s", async (position) => {
    const fixture = await createFixture();
    const created = await BootstrapJournalStore.create(fixture.createRequest);
    const candidate = canonicalBytes(nextJournal(created));
    const length = position === 0 ? 0 : position === "middle" ? Math.floor(candidate.byteLength / 2) : candidate.byteLength - 1;
    await writeExactPrefix(fixture.slotPaths[1], candidate, length);
    await created.close();
    const before = await nodeFs.readFile(fixture.slotPaths[1]);

    const reopened = await BootstrapJournalStore.open(fixture.openRequest);
    expect(reopened.current()).toMatchObject({ slot: 0, sequence: "0" });
    expect(await nodeFs.readFile(fixture.slotPaths[1])).toEqual(before);
    await reopened.close();
  });

  it("advances only through an adjacent alternating raw-canonical hash successor", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const previous = store.current();
    const successor = nextJournal(store);

    await store.advance(successor);

    expect(store.current()).toEqual(successor);
    expect(validateSlots(store.plan, [previous, store.current()]).current).toEqual(successor);
    await store.close();
  });

  it("refuses two valid forked slots on open and preserves both", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const fork = {
      ...store.current(),
      slot: 1 as const,
      sequence: parseUInt64Decimal("3"),
      previousJournalHash: hashBytes("unrelated-fork-parent"),
    };
    const forkBytes = canonicalBytes(fork);
    await writeExactPrefix(fixture.slotPaths[1], forkBytes, forkBytes.byteLength);
    await store.close();
    const before = await inventory(fixture);

    await expect(BootstrapJournalStore.open(fixture.openRequest)).rejects.toBeDefined();
    expect(await inventory(fixture)).toEqual(before);
  });

  it.each(["sequence gap", "wrong-parent fork"] as const)(
    "refuses a live same-inode %s without truncating it",
    async (mutation) => {
      const fixture = await createFixture();
      const store = await BootstrapJournalStore.create(fixture.createRequest);
      const successor = nextJournal(store);
      const conflicting = mutation === "sequence gap"
        ? { ...successor, sequence: parseUInt64Decimal("3") }
        : { ...successor, previousJournalHash: hashBytes("unrelated-live-parent") };
      const conflictingBytes = canonicalBytes(conflicting);
      await writeExactPrefix(fixture.slotPaths[1], conflictingBytes, conflictingBytes.byteLength);
      const before = await inventory(fixture);

      await expect(store.advance(successor)).rejects.toBeDefined();

      expect(await inventory(fixture)).toEqual(before);
      expect(store.current()).toMatchObject({ slot: 0, sequence: "0" });
      await store.close();
    },
  );

  it("refuses sequence overflow before truncating the inactive slot", async () => {
    const fixture = await createFixture();
    const created = await BootstrapJournalStore.create(fixture.createRequest);
    const maximum = {
      ...created.current(),
      slot: 1 as const,
      sequence: parseUInt64Decimal(MAX_UINT64),
      previousJournalHash: hashBytes("maximum-predecessor"),
      phase: "payload_staging" as const,
    } as BootstrapJournalRecordV1;
    const maximumBytes = canonicalBytes(maximum);
    await writeExactPrefix(fixture.slotPaths[0], new Uint8Array(), 0);
    await writeExactPrefix(fixture.slotPaths[1], maximumBytes, maximumBytes.byteLength);
    await created.close();
    const store = await BootstrapJournalStore.open(fixture.openRequest);
    const before = await nodeFs.readFile(fixture.slotPaths[0]);

    await expect(store.advance({
      ...maximum,
      slot: 0,
      sequence: parseUInt64Decimal("0"),
      previousJournalHash: canonicalHash(maximum),
    })).rejects.toBeDefined();
    expect(await nodeFs.readFile(fixture.slotPaths[0])).toEqual(before);
    await store.close();
  });

  it("refuses the first canonical byte over maximumJournalBytes before truncation", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create({
      ...fixture.createRequest,
      buildPlan: (slots) => buildPlan(fixture, slots, 1_024),
    });
    try {
      const base = nextJournal(store, { padding: "" });
      const targetBytes = store.plan.maximumJournalBytes + 1;
      const baseBytes = canonicalBytes(base).byteLength;
      expect(baseBytes).toBeLessThan(targetBytes);
      const successor = {
        ...base,
        padding: "x".repeat(targetBytes - baseBytes),
      };
      expect(canonicalBytes(successor)).toHaveLength(targetBytes);
      const before = await nodeFs.readFile(fixture.slotPaths[1]);

      await expect(store.advance(successor)).rejects.toBeDefined();
      expect(await nodeFs.readFile(fixture.slotPaths[1])).toEqual(before);
    } finally {
      await store.close();
    }
  });

  it("completes bounded positional short writes", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const successor = nextJournal(store);
    fsFaults.writePath = fixture.slotPaths[1];
    fsFaults.writeMode = "short";

    await store.advance(successor);

    expect(store.current()).toEqual(successor);
    await store.close();
  });

  it("refuses a no-progress write without advancing memory authority", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const before = store.current();
    fsFaults.writePath = fixture.slotPaths[1];
    fsFaults.writeMode = "zero";

    await expect(store.advance(nextJournal(store))).rejects.toBeDefined();

    expect(store.current()).toEqual(before);
    await store.close();
  });

  it.each(["inode", "state"] as const)("does not advance memory authority after a %s sync failure", async (failure) => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const before = store.current();
    fsFaults.syncFailurePath = failure === "inode" ? fixture.slotPaths[1] : fixture.stateDirectory;
    fsFaults.syncFailuresRemaining = 1;

    await expect(store.advance(nextJournal(store))).rejects.toThrow("synthetic sync failure");

    expect(store.current()).toEqual(before);
    await store.close();
  });

  it("does not overwrite a durable successor when retrying after state sync failure", async () => {
    const fixture = await createFixture();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    const successor = nextJournal(store);
    fsFaults.syncFailurePath = fixture.stateDirectory;
    fsFaults.syncFailuresRemaining = 1;
    await expect(store.advance(successor)).rejects.toThrow("synthetic sync failure");
    const before = await inventory(fixture);
    const distinguishableRetry = {
      ...successor,
      updatedAt: parseUtcTimestamp("2026-08-31T08:00:02.000Z"),
    };

    await expect(store.advance(distinguishableRetry)).rejects.toBeDefined();

    expect(await inventory(fixture)).toEqual(before);
    expect(store.current()).toMatchObject({ slot: 0, sequence: "0" });
    await store.close();
  });

  it.each([
    "during_inactive_slot_write",
    "after_inactive_slot_sync",
    "after_state_sync",
  ] as const)("recovers the unique durable authority after death at %s", async (point) => {
    const fixture = await createFixture();
    const base = await BootstrapJournalStore.create(fixture.createRequest);
    await base.close();
    const store = await BootstrapJournalStore.open({
      ...fixture.openRequest,
      interrupt: (observed) => {
        if (observed === point) throw new SyntheticDeath(observed);
      },
    });
    const successor = nextJournal(store);
    await expect(store.advance(successor)).rejects.toMatchObject({ point });
    await store.close();

    const reopened = await BootstrapJournalStore.open(fixture.openRequest);
    expect(reopened.current()).toEqual(point === "during_inactive_slot_write" ? initialJournal(reopened.plan, parseUtcTimestamp(NOW)) : successor);
    await reopened.close();
  });

  it("reports a close failure, attempts every retained handle, and leaks no descriptors", async () => {
    const fixture = await createFixture();
    const before = await descriptorCount();
    const store = await BootstrapJournalStore.create(fixture.createRequest);
    fsFaults.closeFailurePath = fixture.slotPaths[0];

    await expect(store.close()).rejects.toThrow("synthetic close failure");
    expect(await descriptorCount()).toBe(before);
  });

  it("returns descriptor count to baseline after every pre-plan death", async () => {
    const fixture = await createFixture();
    const before = await descriptorCount();
    await expect(BootstrapJournalStore.create({
      ...fixture.createRequest,
      interrupt: (point) => {
        if (point === "during_plan_write") throw new SyntheticDeath(point);
      },
    })).rejects.toBeDefined();
    expect(await descriptorCount()).toBe(before);
  });
});
