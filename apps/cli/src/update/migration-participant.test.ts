import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSchemaMigrationId,
  parseUtcTimestamp,
  TransactionPreconditionError,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  UpdateStepRejectedError,
  type AllocatedLifecycleIdV1,
  type CanonicalAbsolutePathV1,
  type CanonicalProductStatePathV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type SchemaMigrationPlanV1,
  type UpdateFoundationParticipantRefV2,
  type UpdateInitialJournalRefV1,
  type VaultRelativePathV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { SchemaMigrationParticipant, type SchemaMigrationStepV1 } from "./migration-participant.js";
import type { UpdateFoundationPortV1 } from "./owner-participant.js";
import { UpdateParticipantJournalStore } from "./state-participant.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const nonce = "a1".repeat(32);
const coordinatorId = `lc_${nonce}_2` as LifecycleCoordinatorIdV1;
const tx = (counter: number): AllocatedLifecycleIdV1<"tx"> => `tx_${nonce}_${String(counter)}` as AllocatedLifecycleIdV1<"tx">;
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const brainRoot = parseCanonicalAbsolutePathText("/synthetic/vault");
const configPath = parseCanonicalAbsolutePathText("/synthetic/product/state/config.json") as CanonicalProductStatePathV1;
const notePath = "notes/index.md" as VaultRelativePathV1;
const v1 = sha("config v1");
const v2 = sha("config v2");

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

async function writeOwned(path: string, content: Uint8Array): Promise<void> {
  await nodeFs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, content, { mode: 0o600 });
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await nodeFs.readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ref(id: AllocatedLifecycleIdV1<"tx">, role: UpdateFoundationParticipantRefV2["role"], target: CanonicalAbsolutePathV1): UpdateFoundationParticipantRefV2 {
  const forward = role.kind === "forward";
  return {
    id,
    slot: forward ? "schema_forward" : "schema_inverse",
    role,
    mutations: [{ targetPath: target, operation: "replace", expectedBeforeHash: forward ? v1 : v2, contentHash: forward ? v2 : v1, contentSize: 9, stagedPath: parseCanonicalAbsolutePathText(`/synthetic/staged/${id}.bin`), content: null, digest: null }],
    maximumJournalBytes: 4096,
    planHash: sha(id),
    initialJournal: { finalPath: parseCanonicalAbsolutePathText(`/synthetic/state/transactions/${id}.json`), plannedBytesHash: sha(id), staged: { kind: "update_expected", coordinatorId, ordinal: 0, path: parseCanonicalAbsolutePathText(`/synthetic/staging/${id}.json`) as never, hash: sha(id), bytes: 10, mode: 0o600 } },
  };
}

interface MigrationFixture {
  readonly step: SchemaMigrationStepV1;
  readonly events: string[];
  readonly hashes: Map<string, LowerHexSha256>;
  readonly foundationState: Map<string, "future" | "partial" | "committed" | "rolled_back">;
  readonly participant: SchemaMigrationParticipant;
  readonly journals: UpdateParticipantJournalStore;
}

async function fixture(domain: "product_state" | "brain"): Promise<MigrationFixture> {
  const home = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-migration-")));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  const absolute = domain === "brain" ? parseCanonicalAbsolutePathText(`${brainRoot}/${notePath}`) : configPath;
  const payload = (ordinal: number, hash: LowerHexSha256) => ({ kind: "update_expected" as const, coordinatorId, ordinal, path: parseCanonicalAbsolutePathText(`/synthetic/payloads/${String(ordinal)}.payload`) as never, bytes: 9, sha256: hash, mode: 384 as const });
  const plan: SchemaMigrationPlanV1 = {
    schemaVersion: 1,
    id: parseSchemaMigrationId(domain === "brain" ? "migration_brain-v2" : "migration_config-v2"),
    coordinatorId,
    domain,
    fromVersion: parsePositiveUInt32(1),
    toVersion: parsePositiveUInt32(2),
    mutations: [{ path: domain === "brain" ? notePath : configPath, beforeHash: v1, afterHash: v2, afterBlob: payload(1, v2), inverseBlob: payload(2, v1) }],
    foundation: [ref(tx(1), { kind: "forward", compensationId: tx(2) }, absolute), ref(tx(2), { kind: "compensation", forwardId: tx(1) }, absolute)],
    maximumPlanBytes: 65_536,
  };
  const planPath = updateLeafPlanPath(root, "schema_migration", plan.id);
  await writeOwned(planPath, updateParticipantDocumentBytes(plan));
  const planHash = updateParticipantDocumentHash("schema_migration", plan);
  const initial = encoder.encode(encodeCanonicalJson({ schemaVersion: 1, id: plan.id, coordinatorId, planHash, phase: "planned", nextForwardFoundation: 0, compensationNext: null, compactionNext: null, createdAt: at, updatedAt: at }));
  const stagedPath = parseCanonicalAbsolutePathText(`${root}/update/initial-journals/schema_migration/${plan.id}.json`);
  await writeOwned(stagedPath, initial);
  const journal = { kind: "schema_migration", id: plan.id, planHash, finalPath: updateParticipantJournalPath(root, "schema_migration", plan.id), stagedPath, stagedExpected: { constructionOrdinal: 0, hash: sha(initial), bytes: initial.byteLength, mode: 384 } } as UpdateInitialJournalRefV1;
  const events: string[] = [];
  const hashes = new Map<string, LowerHexSha256>([[absolute, v1]]);
  const foundationState = new Map<string, "future" | "partial" | "committed" | "rolled_back">();
  const port: UpdateFoundationPortV1 = {
    apply: (row) => {
      events.push(row.role.kind === "forward" ? "forward" : "inverse");
      hashes.set(absolute, row.role.kind === "forward" ? v2 : v1);
      foundationState.set(row.id, "committed");
      return Promise.resolve();
    },
    observe: (row) => Promise.resolve(foundationState.get(row.id) ?? "future"),
    rollback: (row) => {
      events.push("rollback");
      hashes.set(absolute, v1);
      foundationState.set(row.id, "rolled_back");
      return Promise.resolve();
    },
    compact: (row) => {
      events.push(`compact:${row.id}`);
      return Promise.resolve();
    },
  };
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid: uid });
  const participant = new SchemaMigrationParticipant({ journals, foundation: port, hashTarget: (path) => Promise.resolve(hashes.get(path) ?? null), brainRoot, now: () => new Date(at) });
  return { step: { plan, planRef: { kind: "schema_migration", id: plan.id, path: planPath, hash: planHash, bytes: updateParticipantDocumentBytes(plan).byteLength }, journal }, events, hashes, foundationState, participant, journals };
}

describe("schema migration participant", () => {
  it.each(["product_state", "brain"] as const)("applies and verifies a %s migration", async (domain) => {
    const { step, events, participant } = await fixture(domain);
    await expect(participant.apply(step)).resolves.toEqual({ state: "verified" });
    expect(events).toEqual(["forward"]);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "verified", nextForwardFoundation: 1 });
  });

  it("rejects a concurrent edit of a migration subject before any row, and compensates around it", async () => {
    const { step, events, hashes, participant } = await fixture("product_state");
    hashes.set(configPath, sha("edited"));
    await expect(participant.apply(step)).rejects.toMatchObject({ name: "UpdateStepRejectedError", reason: "update_migration_before_hash" });
    expect(events).toEqual([]);
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(events).toEqual([]);
    expect(hashes.get(configPath)).toBe(sha("edited"));
  });

  it.each(["rolled_back", "throws"] as const)("rejects a Foundation row that refused precondition drift (%s) and leaves the edit", async (drift) => {
    const { step, hashes, journals } = await fixture("product_state");
    const state = new Map<string, "future" | "partial" | "committed" | "rolled_back">();
    const events: string[] = [];
    const drifting = new SchemaMigrationParticipant({
      journals,
      foundation: {
        apply: (row) => {
          hashes.set(configPath, sha("edited"));
          if (drift === "throws") return Promise.reject(new TransactionPreconditionError());
          state.set(row.id, "rolled_back");
          return Promise.resolve();
        },
        observe: (row) => Promise.resolve(state.get(row.id) ?? "future"),
        rollback: () => {
          events.push("rollback");
          return Promise.resolve();
        },
        compact: () => Promise.resolve(),
      },
      hashTarget: (path) => Promise.resolve(hashes.get(path) ?? null),
      brainRoot,
      now: () => new Date(at),
    });
    const rejected = await drifting.apply(step).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(UpdateStepRejectedError);
    expect(rejected).toMatchObject({ reason: "update_foundation_rolled_back" });
    await expect(drifting.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(events).toEqual([]);
    expect(hashes.get(configPath)).toBe(sha("edited"));
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "rolled_back", compensationNext: -1 });
  });

  it("refuses an after state that is not the planned postimage", async () => {
    const { step } = await fixture("product_state");
    const broken = new SchemaMigrationParticipant({
      journals: new UpdateParticipantJournalStore({ fs: createNodeLifecycleGuardedFileSystem({ effectiveUid: uid, renameNoReplace: async ({ sourcePath, destinationPath }) => { await nodeFs.link(sourcePath, destinationPath); await nodeFs.unlink(sourcePath); } }), effectiveUid: uid }),
      foundation: { apply: () => Promise.resolve(), observe: () => Promise.resolve("committed"), rollback: () => Promise.resolve(), compact: () => Promise.resolve() },
      hashTarget: () => Promise.resolve(v1),
      brainRoot,
      now: () => new Date(at),
    });
    await expect(broken.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("walks the inverse through the paired ref and restores the before hash", async () => {
    const { step, events, hashes, participant } = await fixture("product_state");
    await participant.apply(step);
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(events).toEqual(["forward", "inverse"]);
    expect(hashes.get(configPath)).toBe(v1);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "rolled_back", compensationNext: -1 });
  });

  it("rolls back a partial forward row without its inverse", async () => {
    const { step, events, foundationState, participant, journals } = await fixture("product_state");
    await journals.open(step.journal);
    foundationState.set(tx(1), "partial");
    await participant.compensate(step);
    expect(events).toEqual(["rollback"]);
  });

  it("compacts refs in ID order, then the journal, then the plan", async () => {
    const { step, events, participant } = await fixture("brain");
    await participant.apply(step);
    await participant.finalize(step);
    events.length = 0;
    await participant.compact(step);
    expect(events).toEqual([`compact:${tx(1)}`, `compact:${tx(2)}`]);
    expect(await readJson(step.journal.finalPath)).toBeNull();
    expect(await readJson(step.planRef.path)).toBeNull();
  });
});
