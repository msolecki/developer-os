import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  constructionEvidenceBytes,
  constructionFileEvidence,
  createNodeLifecycleGuardedFileSystem,
  deriveCanonicalStatePayloadPath,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateConstructionEvidencePath,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  UpdateStepRejectedError,
  type CanonicalAbsolutePathV1,
  type CanonicalStateFilePlanV1,
  type CanonicalStatePostimageV1,
  type CanonicalStatePreimageV1,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type SafeReasonCodeV1,
  type TargetVerificationPlanV1,
  type UpdateConstructionPlanV1,
  type UpdateInitialJournalRefV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanonicalStateParticipant, constructionPayloadIdentity, runTargetVerifier, UpdateParticipantJournalStore, type CanonicalStateStepV1 } from "./state-participant.js";

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

async function identityOf(path: string): Promise<{ readonly dev: ReturnType<typeof parseUInt64Decimal>; readonly ino: ReturnType<typeof parseUInt64Decimal> }> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: parseUInt64Decimal(stats.dev.toString(10)), ino: parseUInt64Decimal(stats.ino.toString(10)) };
}

async function present(path: string, content: string): Promise<CanonicalStatePreimageV1> {
  return { state: "present", hash: sha(content), payload: null, ownerUid: uid as EffectiveUidV1, mode: 384, nlink: 1, size: encoder.encode(content).byteLength, ...(await identityOf(path)) };
}

/** A one-row construction plan: the postimage payload is construction file 0 (synthetic, not built). */
function constructionPlan(root: CanonicalAbsolutePathV1, after: Extract<CanonicalStatePostimageV1, { readonly state: "present" }>): UpdateConstructionPlanV1 {
  return {
    schemaVersion: 1,
    coordinatorId,
    stagingRoot: { path: root },
    files: [{ ordinal: 0, role: { kind: "payload", payloadKind: "state_after" }, path: after.payload.path, bytes: after.payload.bytes, sha256: after.payload.hash, mode: 384 }],
  } as unknown as UpdateConstructionPlanV1;
}

interface StateFixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
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
  let before: CanonicalStatePreimageV1 = { state: "absent" };
  let after: CanonicalStatePostimageV1 = { state: "absent" };
  if (options.before !== false) {
    await writeOwned(path, '{"record":"before"}\n');
    before = await present(path, '{"record":"before"}\n');
  }
  if (options.after !== false) {
    // The postimage is planned before its payload exists: no device/inode (D60).
    const content = '{"record":"after"}\n';
    after = { state: "present", hash: sha(content), payload: { kind: "update_expected", coordinatorId, ordinal: 0, path: payloadPath, hash: sha(content), bytes: encoder.encode(content).byteLength, mode: 384 }, ownerUid: uid as EffectiveUidV1, mode: 384, nlink: 1, size: encoder.encode(content).byteLength };
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
  const planHash = updateParticipantDocumentHash(kind, plan);
  const initial = encoder.encode(encodeCanonicalJson({ schemaVersion: 1, kind, id, coordinatorId, planHash, phase: "planned", nextTransition: 0, compensationNext: null, reservationReleased: null, createdAt: at, updatedAt: at }));
  const stagedPath = parseCanonicalAbsolutePathText(`${root}/update/initial-journals/${kind}/${id}.json`);
  await writeOwned(stagedPath, initial);
  const journal = { kind, id, planHash, finalPath: updateParticipantJournalPath(root, kind, id), stagedPath, stagedExpected: { constructionOrdinal: 1, hash: sha(initial), bytes: initial.byteLength, mode: 384 } } as UpdateInitialJournalRefV1;
  const construction = after.state === "present" ? constructionPlan(root, after) : null;
  if (after.state === "present" && construction !== null) {
    // Construction writes the payload after the plan and records its inode as evidence.
    await writeOwned(after.payload.path, '{"record":"after"}\n');
    const { dev, ino } = await identityOf(after.payload.path);
    await writeOwned(updateConstructionEvidencePath(root, 0), constructionEvidenceBytes(constructionFileEvidence(construction, 0, dev, ino)));
  }
  const fs = guardedFs();
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid: uid });
  const payloadIdentity = construction === null ? () => Promise.reject(new Error("no postimage")) : constructionPayloadIdentity(fs, uid, construction);
  const participant = new CanonicalStateParticipant({ fs, journals, effectiveUid: uid, now: () => new Date(at), validateBytes: (_role, bytes) => JSON.parse(new TextDecoder().decode(bytes)) as unknown, payloadIdentity });
  return { home, root, journals, participant, step: { plan, planRef: { kind, id, path: planPath, hash: planHash, bytes: updateParticipantDocumentBytes(plan).byteLength }, journal } };
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

  it("journals the empty reservation it releases and restores it, empty and 0600, on compensation (NEW-118 (2))", async () => {
    const { step, participant } = await stateFixture("rollback_record", { before: false });
    await nodeFs.writeFile(step.plan.path, "", { mode: 0o600 });
    const released = await identityOf(step.plan.path);
    await participant.releaseReservation(step);
    await participant.apply(step);
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ reservationReleased: released });
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
    await participant.compensate(step);
    const restored = await nodeFs.lstat(step.plan.path);
    expect([restored.size, restored.mode & 0o777]).toEqual([0, 0o600]);
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ phase: "rolled_back", reservationReleased: released });
  });

  it("finishes a release whose intent was journaled before the unlink, and restores it when compensated first (NEW-118 (2))", async () => {
    const resumed = await stateFixture("rollback_record", { before: false });
    await nodeFs.writeFile(resumed.step.plan.path, "", { mode: 0o600 });
    const journal = (await resumed.journals.open(resumed.step.journal)) as Record<string, unknown>;
    await resumed.journals.rewrite(resumed.step.journal.finalPath, { ...journal, reservationReleased: await identityOf(resumed.step.plan.path) });
    await resumed.participant.releaseReservation(resumed.step);
    await expect(resumed.participant.apply(resumed.step)).resolves.toEqual({ state: "verified" });
    expect(await read(resumed.step.plan.path)).toBe('{"record":"after"}\n');

    const compensated = await stateFixture("rollback_record", { before: false });
    await nodeFs.writeFile(compensated.step.plan.path, "", { mode: 0o600 });
    const intent = (await compensated.journals.open(compensated.step.journal)) as Record<string, unknown>;
    await compensated.journals.rewrite(compensated.step.journal.finalPath, { ...intent, reservationReleased: await identityOf(compensated.step.plan.path) });
    await expect(compensated.participant.compensate(compensated.step)).resolves.toEqual({ state: "compensated" });
    expect(await read(compensated.step.plan.path)).toBe("");
  });

  it("releases only the exact empty reservation: a non-empty or foreign inode is a third state (NEW-118 (2))", async () => {
    const { step, participant, journals } = await stateFixture("rollback_record", { before: false });
    await nodeFs.writeFile(step.plan.path, "x", { mode: 0o600 });
    await participant.releaseReservation(step);
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(JSON.parse((await read(step.journal.finalPath)) ?? "null")).toMatchObject({ reservationReleased: null });
    expect(await read(step.plan.path)).toBe("x");
    await nodeFs.rm(step.plan.path);
    await nodeFs.writeFile(step.plan.path, "", { mode: 0o600 });
    const journal = (await journals.open(step.journal)) as Record<string, unknown>;
    await journals.rewrite(step.journal.finalPath, { ...journal, reservationReleased: { dev: "1", ino: "1" } });
    await participant.releaseReservation(step);
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await read(step.plan.path)).toBe("");
  });

  it("does not unlink a recorded reservation inode that is no longer empty (NEW-118 (2))", async () => {
    const grown = await stateFixture("rollback_record", { before: false });
    await nodeFs.writeFile(grown.step.plan.path, "", { mode: 0o600 });
    const journal = (await grown.journals.open(grown.step.journal)) as Record<string, unknown>;
    await grown.journals.rewrite(grown.step.journal.finalPath, { ...journal, reservationReleased: await identityOf(grown.step.plan.path) });
    await nodeFs.writeFile(grown.step.plan.path, "x");
    await grown.participant.releaseReservation(grown.step);
    expect(await read(grown.step.plan.path)).toBe("x");

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

  it("fixes the plan bytes before the payload exists and takes the postimage inode from construction evidence", async () => {
    const { step, participant } = await stateFixture("active_release");
    expect(Object.keys(step.plan.after)).not.toContain("dev");
    expect(Object.keys(step.plan.after)).not.toContain("ino");
    expect(Object.keys(step.plan.before)).toEqual(expect.arrayContaining(["dev", "ino"]));
    expect(updateParticipantDocumentHash(step.planRef.kind, step.plan)).toBe(step.planRef.hash);
    await expect(participant.apply(step)).resolves.toEqual({ state: "verified" });
  });

  it("refuses a payload whose inode differs from its construction evidence as recovery-required", async () => {
    const { step, participant } = await stateFixture("active_release");
    const payload = (step.plan.after as Extract<CanonicalStatePostimageV1, { readonly state: "present" }>).payload.path;
    await nodeFs.rm(payload);
    await writeOwned(payload, '{"record":"after"}\n');
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await read(payload)).toBe('{"record":"after"}\n');
    expect(await read(step.plan.path)).toBeNull();
  });

  it("refuses a published postimage moved to another inode as recovery-required", async () => {
    const { step, participant } = await stateFixture("active_release");
    await participant.apply(step);
    await nodeFs.rm(step.plan.path);
    await writeOwned(step.plan.path, '{"record":"after"}\n');
    await expect(participant.compensate(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await read(step.plan.path)).toBe('{"record":"after"}\n');
  });

  it("refuses a postimage whose construction evidence is missing or not its row", async () => {
    const missing = await stateFixture("active_release");
    await nodeFs.rm(updateConstructionEvidencePath(missing.root, 0));
    await expect(missing.participant.apply(missing.step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    const tampered = await stateFixture("active_release");
    const evidence = updateConstructionEvidencePath(tampered.root, 0);
    const text = await nodeFs.readFile(evidence, "utf8");
    await nodeFs.writeFile(evidence, text.replace(/"ino":"(\d+)"/, (_match, value: string) => `"ino":"${(BigInt(value) + 1n).toString(10)}"`));
    await expect(tampered.participant.apply(tampered.step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);

    const other = await stateFixture("active_release");
    const after = other.step.plan.after as Extract<CanonicalStatePostimageV1, { readonly state: "present" }>;
    await expect(constructionPayloadIdentity(guardedFs(), uid, constructionPlan(other.root, after))({ ...after.payload, hash: sha("other") })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("lets a TypeError inside the journal validator propagate (exit 1) instead of refusing it as a third state (NEW-201)", async () => {
    const { step, participant, journals } = await stateFixture("active_release");
    const boom = (): never => {
      throw new TypeError("validator defect");
    };
    // `then` must stay readable or the mocked promise itself rejects before the validator runs.
    const hostile = new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : boom()), has: boom, ownKeys: boom, getPrototypeOf: boom, getOwnPropertyDescriptor: boom });
    vi.spyOn(journals, "open").mockResolvedValue(hostile);
    const failure = await participant.apply(step).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).not.toBeInstanceOf(LifecycleRecoveryRequiredError);
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
    await expect(runTargetVerifier(plan, { verify: () => Promise.resolve({ ...ok, exitCode: 1 }) })).rejects.toMatchObject({ name: "UpdateStepRejectedError", reason: "update_verifier_rejected" });
    await expect(runTargetVerifier(plan, { verify: () => Promise.resolve({ ...ok, migrationPostimagesHash: sha("other") }) })).rejects.toBeInstanceOf(UpdateStepRejectedError);
  });

  it("rejects without recovery-required so the coordinator compensates", async () => {
    const ok = { exitCode: 0, manifestHash: plan.manifestHash, ownerPostimagesHash: plan.ownerPostimagesHash, migrationPostimagesHash: plan.migrationPostimagesHash };
    const rejected = await runTargetVerifier(plan, { verify: () => Promise.resolve({ ...ok, manifestHash: sha("other") }) }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(UpdateStepRejectedError);
    expect(rejected).not.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("keeps a policy breach recovery-required and never spawns the verifier", async () => {
    let spawned = false;
    const verify = () => {
      spawned = true;
      return Promise.reject(new Error("unreachable"));
    };
    await expect(runTargetVerifier({ ...plan, readOnly: false } as unknown as TargetVerificationPlanV1, { verify })).rejects.toMatchObject({ name: "LifecycleRecoveryRequiredError", reason: "update_verifier_policy" });
    await expect(runTargetVerifier({ ...plan, processCount: 2 } as unknown as TargetVerificationPlanV1, { verify })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(spawned).toBe(false);
  });
});
