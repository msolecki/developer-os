import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createNodeLifecycleGuardedFileSystem,
  deriveCanonicalStatePayloadPath,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  type CanonicalAbsolutePathV1,
  type CanonicalStateFilePlanV1,
  type CanonicalStateFileStateV1,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type TargetVerificationPlanV1,
  type UpdateInitialJournalRefV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { CanonicalStateParticipant, runTargetVerifier, UpdateParticipantJournalStore, type CanonicalStateStepV1 } from "./state-participant.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const coordinatorId = `lc_${"d".repeat(64)}_4` as LifecycleCoordinatorIdV1;
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

function guardedFs() {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

async function writeOwned(path: string, content: string | Uint8Array): Promise<void> {
  await nodeFs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, content, { mode: 0o600 });
}

async function present(path: string, content: string): Promise<CanonicalStateFileStateV1> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { state: "present", hash: sha(content), payload: null, ownerUid: uid as EffectiveUidV1, mode: 384, nlink: 1, size: encoder.encode(content).byteLength, dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) };
}

interface StateFixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly step: CanonicalStateStepV1;
  readonly participant: CanonicalStateParticipant;
  readonly journals: UpdateParticipantJournalStore;
}

async function stateFixture(role: "release_trust" | "active_release" | "rollback_record", options: { readonly before?: boolean; readonly after?: boolean } = {}): Promise<StateFixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-state-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(`${home}/state`, { recursive: true, mode: 0o700 });
  const id = parseSafeReasonCode(`state_${role}`);
  const path = parseCanonicalAbsolutePathText(`${home}/state/${role}.json`);
  const payloadPath = deriveCanonicalStatePayloadPath(home, coordinatorId as string as SafeReasonCodeV1, role, id);
  let before: CanonicalStateFileStateV1 = { state: "absent" };
  let after: CanonicalStateFileStateV1 = { state: "absent" };
  if (options.before !== false) {
    await writeOwned(path, '{"record":"before"}\n');
    before = await present(path, '{"record":"before"}\n');
  }
  if (options.after !== false) {
    await writeOwned(payloadPath, '{"record":"after"}\n');
    const stats = await present(payloadPath, '{"record":"after"}\n');
    after = { ...stats, payload: { kind: "update_expected", coordinatorId, ordinal: 3, path: payloadPath, hash: sha('{"record":"after"}\n'), bytes: encoder.encode('{"record":"after"}\n').byteLength, mode: 384 } } as CanonicalStateFileStateV1;
  }
  const plan: CanonicalStateFilePlanV1 = {
    schemaVersion: 1,
    id,
    coordinatorId,
    role,
    path,
    tombstonePath: parseCanonicalAbsolutePathText(`${home}/state/.${role}.tombstone.json`),
    before,
    after,
    reversal: role === "release_trust" ? "monotonic_no_reverse" : "reversible",
    maximumPlanBytes: 65_536,
    maximumJournalBytes: 4096,
  };
  const kind = role === "release_trust" ? "release_trust_state" : role === "active_release" ? "active_release_state" : "rollback_record_state";
  const planPath = updateLeafPlanPath(root, kind, id);
  await writeOwned(planPath, updateParticipantDocumentBytes(plan));
  const planHash = updateParticipantDocumentHash(plan);
  const initial = encoder.encode(encodeCanonicalJson({ schemaVersion: 1, kind, id, coordinatorId, planHash, phase: "planned", nextTransition: 0, compensationNext: null, createdAt: at, updatedAt: at }));
  const stagedPath = parseCanonicalAbsolutePathText(`${root}/update/initial-journals/${kind}/${id}.json`);
  await writeOwned(stagedPath, initial);
  const journal = { kind, id, planHash, finalPath: updateParticipantJournalPath(root, kind, id), stagedPath, stagedExpected: { constructionOrdinal: 1, hash: sha(initial), bytes: initial.byteLength, mode: 384 } } as UpdateInitialJournalRefV1;
  const fs = guardedFs();
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid: uid });
  const participant = new CanonicalStateParticipant({ fs, journals, effectiveUid: uid, now: () => new Date(at), validateBytes: (_role, bytes) => JSON.parse(new TextDecoder().decode(bytes)) as unknown });
  return { home, journals, participant, step: { plan, planRef: { kind, id, path: planPath, hash: planHash, bytes: updateParticipantDocumentBytes(plan).byteLength }, journal } };
}

async function read(path: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

describe("canonical state participant", () => {
  it("preserves the preimage, publishes the payload no-replace, and verifies", async () => {
    const { step, participant } = await stateFixture("active_release");
    await expect(participant.apply(step)).resolves.toEqual({ state: "verified" });
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
    expect(await read(step.plan.tombstonePath)).toBe('{"record":"before"}\n');
    expect(await read(step.journal.stagedPath)).toBeNull();
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ phase: "verified", nextTransition: 3 });
  });

  it("reverses active before the verifier point", async () => {
    const { step, participant } = await stateFixture("active_release");
    await participant.apply(step);
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(await read(step.plan.path)).toBe('{"record":"before"}\n');
    expect(await read(step.plan.tombstonePath)).toBeNull();
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ phase: "rolled_back", compensationNext: -1 });
  });

  it("never reverses trust", async () => {
    const { step, participant } = await stateFixture("release_trust");
    await participant.apply(step);
    await expect(participant.compensate(step)).resolves.toEqual({ state: "not_reversed" });
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
  });

  it("adopts a preimage move that died before its journal rewrite", async () => {
    const { step, participant } = await stateFixture("active_release");
    await nodeFs.rename(step.plan.path, step.plan.tombstonePath);
    await expect(participant.apply(step)).resolves.toEqual({ state: "verified" });
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
  });

  it("compensates a publish that died before its journal rewrite", async () => {
    const { step, participant, journals } = await stateFixture("active_release");
    const journal = (await journals.open(step.journal)) as Record<string, unknown>;
    await nodeFs.rename(step.plan.path, step.plan.tombstonePath);
    await journals.rewrite(step.journal.finalPath, { ...journal, phase: "preimage_preserved", nextTransition: 1 });
    await nodeFs.rename((step.plan.after as { readonly payload: { readonly path: string } }).payload.path, step.plan.path);
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(await read(step.plan.path)).toBe('{"record":"before"}\n');
  });

  it("preserves a third state as recovery-required", async () => {
    const { step, participant } = await stateFixture("active_release");
    await nodeFs.writeFile(step.plan.path, '{"record":"edited"}\n');
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await read(step.plan.path)).toBe('{"record":"edited"}\n');
  });

  it("creates an absent record and compensates back to absent", async () => {
    const { step, participant } = await stateFixture("rollback_record", { before: false });
    await participant.apply(step);
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
    await participant.compensate(step);
    expect(await read(step.plan.path)).toBeNull();
  });

  it("verifies a retained record without changing it", async () => {
    const { step, participant } = await stateFixture("rollback_record", { after: false });
    await expect(participant.verifyRetained(step)).resolves.toEqual({ state: "verified" });
    expect(await read(step.plan.path)).toBe('{"record":"before"}\n');
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ phase: "verified", nextTransition: 0 });
  });

  it("finalizes the tombstone and compacts journal then plan", async () => {
    const { step, participant } = await stateFixture("active_release");
    await participant.apply(step);
    await participant.finalize(step);
    expect(await read(step.plan.tombstonePath)).toBeNull();
    await participant.compact(step);
    expect(await read(step.journal.finalPath)).toBeNull();
    expect(await read(step.planRef.path)).toBeNull();
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
  });

  it("refuses a journal present at both staged and final paths", async () => {
    const { step, journals } = await stateFixture("active_release");
    await nodeFs.mkdir(step.journal.finalPath.slice(0, step.journal.finalPath.lastIndexOf("/")), { recursive: true, mode: 0o700 });
    await nodeFs.copyFile(step.journal.stagedPath, step.journal.finalPath);
    await expect(journals.open(step.journal)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});

describe("target verifier", () => {
  const plan = {
    schemaVersion: 1,
    id: parseSafeReasonCode("target_verification"),
    coordinatorId,
    manifestHash: sha("manifest"),
    ownerPostimagesHash: sha("owners"),
    migrationPostimagesHash: sha("migrations"),
    processCount: 1,
    readOnly: true,
  } as unknown as TargetVerificationPlanV1;

  it("crosses only on an exact successful observation", async () => {
    const ok = { exitCode: 0, manifestHash: plan.manifestHash, ownerPostimagesHash: plan.ownerPostimagesHash, migrationPostimagesHash: plan.migrationPostimagesHash };
    await expect(runTargetVerifier(plan, { verify: () => Promise.resolve(ok) })).resolves.toEqual({ state: "verified" });
    await expect(runTargetVerifier(plan, { verify: () => Promise.resolve({ ...ok, exitCode: 1 }) })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await expect(runTargetVerifier(plan, { verify: () => Promise.resolve({ ...ok, migrationPostimagesHash: sha("other") }) })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});
