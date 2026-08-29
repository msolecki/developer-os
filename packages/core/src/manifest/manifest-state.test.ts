import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { admitCanonicalAbsolutePath, deriveBootstrapPayloadPath, deriveManifestPayloadPath } from "../update/paths.js";
import {
  ManifestStateParticipant,
  ManifestStateParticipantError,
  validateManifestStatePlan,
  type ManifestStatePlanAdmissionContextV1,
} from "./manifest-state.js";
import type { ManifestAdmissionContextV1 } from "./types.js";

const HASH = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const BEFORE = new TextEncoder().encode('{"schemaVersion":1,"productVersion":"1.0.0","installedAt":"2026-08-29T00:00:00.000Z","artifacts":[]}\n');
const HEX = "a".repeat(64);
const COORDINATOR_ID = `lc_${"b".repeat(61)}`;
const PARTICIPANT_ID = `mf_${"c".repeat(61)}`;

function statState(bytes: Uint8Array, stat: { dev: number; ino: number }, payload: unknown = null) {
  return {
    state: "present" as const,
    hash: HASH(bytes),
    bytes: payload,
    ownerUid: 501,
    mode: 0o600 as const,
    nlink: 1 as const,
    size: String(bytes.byteLength),
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

async function fixture(withBefore = true) {
  const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-manifest-state-"));
  const productHome = join(root, "product");
  const manifestPath = join(productHome, "state", "installation-manifest.json");
  const staging = join(productHome, "staging", "lifecycle", COORDINATOR_ID, "participants", "manifest", PARTICIPANT_ID);
  const payloadPath = join(staging, "after.json");
  const sourceRoot = join(root, "source");
  const backupRoot = join(root, "backup");
  await nodeFs.mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(staging, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const AFTER = new TextEncoder().encode(encodeCanonicalJson({
    schemaVersion: 2, productVersion: "1.0.1", installedAt: "2026-08-30T00:00:00.000Z",
    artifacts: [{ owner: "core", path: join(root, "managed"), kind: "file", productVersion: "1.0.1", existedBefore: false, beforeHash: null, backupRelativePath: null, source: "template.json", mergeStrategy: "dedicated", verifiedAt: "2026-08-30T00:00:00.000Z", verification: { mode: "ephemeral" } }],
  }));
  if (withBefore) await nodeFs.writeFile(manifestPath, BEFORE, { mode: 0o600 });
  await nodeFs.writeFile(payloadPath, AFTER, { mode: 0o600 });
  const before = withBefore ? statState(BEFORE, await nodeFs.lstat(manifestPath)) : { state: "absent" as const };
  const after = statState(AFTER, await nodeFs.lstat(payloadPath), {
    kind: "update_expected" as const,
    coordinatorId: COORDINATOR_ID,
    ordinal: 0,
    path: payloadPath,
    hash: HASH(AFTER),
    bytes: AFTER.byteLength,
    mode: 0o600 as const,
  });
  const plan = {
    schemaVersion: 1,
    participantId: PARTICIPANT_ID,
    envelope: { kind: "lifecycle" as const, id: COORDINATOR_ID },
    bindings: {
      foundationTransactions: { count: 0, orderedIdsHash: HASH(new TextEncoder().encode("developer-os/manifest-foundation-bindings/v1\0[]")) },
      externalEffects: [],
    },
    manifestPath,
    tombstonePath: join(dirname(manifestPath), `.installation-manifest.${PARTICIPANT_ID}.json.tombstone`),
    before,
    after,
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const evidence = {
    reopenCanonicalAbsolutePath: (path: string) => path,
    containsCanonicalPath: (base: string, candidate: string) => candidate === base || candidate.startsWith(`${base}/`),
    hasFoldedAlias: () => false,
  };
  const payloadStat = await nodeFs.lstat(payloadPath);
  const context: ManifestStatePlanAdmissionContextV1 = {
    evidence,
    productHome: admitCanonicalAbsolutePath(productHome, evidence),
    manifestPath: admitCanonicalAbsolutePath(manifestPath, evidence),
    foundationTransactionIds: [],
    externalEffects: [],
    admitParticipant: (envelope, participantId) => envelope && typeof envelope === "object" && (envelope as { kind?: unknown }).kind === "lifecycle" && (envelope as { id?: unknown }).id === COORDINATOR_ID && participantId === PARTICIPANT_ID ? { envelope: envelope as never, participantId: participantId as never } : (() => { throw new Error("invalid participant"); })(),
    admitExternalEffect: (value) => value as never,
    updatePayloadIdentity: (value) => value.path === payloadPath ? { dev: String(payloadStat.dev) as never, ino: String(payloadStat.ino) as never } : (() => { throw new Error("wrong payload"); })(),
  };
  const manifestAdmission: ManifestAdmissionContextV1 = {
    evidence,
    sourceRoot: admitCanonicalAbsolutePath(sourceRoot, evidence),
    backupRoot: admitCanonicalAbsolutePath(backupRoot, evidence),
    admitOwnerPath: (_owner, path) => path,
  };
  const guardedMoveNoReplace = async (source: string, destination: string, expected: { dev: string; ino: string }) => {
    const sourceStat = await nodeFs.lstat(source);
    await expect(nodeFs.lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    if (String(sourceStat.dev) !== expected.dev || String(sourceStat.ino) !== expected.ino) throw new Error("source changed");
    await nodeFs.rename(source, destination);
    return { sourceParentSynced: true as const, destinationParentSynced: true as const, sourceReopened: true as const, destinationReopened: true as const };
  };
  const guardedUnlinkExact = async (path: string, expected: { dev: string; ino: string }) => {
    const stat = await nodeFs.lstat(path);
    if (String(stat.dev) !== expected.dev || String(stat.ino) !== expected.ino) throw new Error("tombstone changed");
    await nodeFs.unlink(path);
    return { sourceParentSynced: true as const, destinationParentSynced: true as const, sourceReopened: true as const, destinationReopened: true as const };
  };
  const participant = new ManifestStateParticipant({ fs: nodeFs, guardedMoveNoReplace, guardedUnlinkExact, admission: context, uid: 501, manifestAdmission });
  return { root, plan, context, participant, manifestPath, payloadPath, tombstonePath: plan.tombstonePath, AFTER };
}

async function cleanup(root: string) { await nodeFs.rm(root, { recursive: true, force: true }); }

describe("ManifestStateParticipant", () => {
  it("moves the guarded preimage to its tombstone, publishes the exact V2 postimage, and compensates it back", async () => {
    const subject = await fixture();
    try {
      const plan = validateManifestStatePlan(subject.plan, subject.context);
      expect(plan.after.state).toBe("present");
      if (plan.after.state === "present") expect(plan.after.bytes?.path).toBe(deriveManifestPayloadPath(subject.context.productHome, COORDINATOR_ID as never, PARTICIPANT_ID as never));

      expect(await subject.participant.apply(plan)).toMatchObject({ state: "applied" });
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(subject.AFTER));
      expect(await nodeFs.readFile(subject.tombstonePath)).toEqual(Buffer.from(BEFORE));
      await expect(nodeFs.lstat(subject.payloadPath)).rejects.toMatchObject({ code: "ENOENT" });

      expect(await subject.participant.compensate(plan)).toMatchObject({ state: "compensated" });
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(BEFORE));
      expect(await nodeFs.readFile(subject.payloadPath)).toEqual(Buffer.from(subject.AFTER));
    } finally { await cleanup(subject.root); }
  });

  it("commits planned absence without creating a manifest and accepts explicit forward recovery", async () => {
    const subject = await fixture(false);
    try {
      await nodeFs.unlink(subject.payloadPath);
      const absentPlan = { ...subject.plan, after: { state: "absent" as const } };
      const plan = validateManifestStatePlan(absentPlan, subject.context);
      expect(await subject.participant.apply(plan)).toMatchObject({ state: "applied" });
      await expect(nodeFs.lstat(subject.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await subject.participant.compensate(plan)).toMatchObject({ state: "compensated" });
    } finally { await cleanup(subject.root); }
  });

  it("refuses a concurrent manifest replacement without deleting its evidence", async () => {
    const subject = await fixture();
    try {
      const plan = validateManifestStatePlan(subject.plan, subject.context);
      await nodeFs.unlink(subject.manifestPath);
      await nodeFs.writeFile(subject.manifestPath, BEFORE, { mode: 0o600 });
      await expect(subject.participant.apply(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(BEFORE));
      expect(await nodeFs.readFile(subject.payloadPath)).toEqual(Buffer.from(subject.AFTER));
    } finally { await cleanup(subject.root); }
  });

  it("requires derived paths and complete matching binding partitions", async () => {
    const subject = await fixture();
    try {
      expect(() => validateManifestStatePlan({ ...subject.plan, tombstonePath: subject.manifestPath }, subject.context)).toThrow(ManifestStateParticipantError);
      expect(() => validateManifestStatePlan({ ...subject.plan, bindings: { ...subject.plan.bindings, externalEffects: [{ kind: "git", id: "git_1", planHash: HEX }] } }, subject.context)).toThrow(ManifestStateParticipantError);
    } finally { await cleanup(subject.root); }
  });

  it("admits the bootstrap postimage only with null planned inode identity", async () => {
    const subject = await fixture();
    try {
      const bootstrapId = "fi_11111111-1111-4111-8111-111111111111";
      const participantId = `mf_${bootstrapId}`;
      const payloadPath = deriveBootstrapPayloadPath(subject.context.productHome, "fresh_v2_init", bootstrapId as never, 0);
      const after = {
        ...subject.plan.after,
        dev: null,
        ino: null,
        bytes: { kind: "bootstrap_expected" as const, bootstrapId, ordinal: 0, path: payloadPath, hash: subject.plan.after.hash, bytes: subject.AFTER.byteLength, mode: 0o600 as const },
      };
      const context = { ...subject.context, admitParticipant: (envelope: unknown, candidate: unknown) => candidate === participantId ? { envelope: envelope as never, participantId: candidate as never } : (() => { throw new Error("wrong bootstrap participant"); })() };
      const plan = { ...subject.plan, participantId, envelope: { kind: "fresh_v2_init" as const, id: bootstrapId }, tombstonePath: join(dirname(subject.manifestPath), `.installation-manifest.${participantId}.json.tombstone`), after };
      expect(validateManifestStatePlan(plan, context).after).toMatchObject({ state: "present", dev: null, ino: null });
      expect(() => validateManifestStatePlan({ ...plan, after: { ...after, dev: "1" } }, context)).toThrow(ManifestStateParticipantError);
    } finally { await cleanup(subject.root); }
  });

  it("uses an injected identity-guarded move instead of path link/unlink authority", async () => {
    const subject = await fixture();
    try {
      let guardedMoves = 0;
      const participant = new ManifestStateParticipant({ ...subject.participant.dependencies, guardedMoveNoReplace: async (...args) => { guardedMoves += 1; return subject.participant.dependencies.guardedMoveNoReplace(...args); } });
      await participant.apply(validateManifestStatePlan(subject.plan, subject.context));
      expect(guardedMoves).toBe(2);
    } finally { await cleanup(subject.root); }
  });

  it("rejects a V1 payload when it is observed as a postimage", async () => {
    const subject = await fixture();
    try {
      const candidate = { ...subject.plan, after: { ...subject.plan.after, hash: HASH(BEFORE), size: String(BEFORE.byteLength), bytes: { ...(subject.plan.after.bytes as object), hash: HASH(BEFORE), bytes: BEFORE.byteLength } } };
      await expect(subject.participant.apply(validateManifestStatePlan(candidate, subject.context))).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    } finally { await cleanup(subject.root); }
  });

  it.each(["a payload over the manifest cap", "a non-0600 payload", "a mismatched payload hash"])("refuses %s", async name => {
    const subject = await fixture();
    try {
      const bytes = subject.plan.after.bytes as Record<string, unknown>;
      const replacement = name === "a payload over the manifest cap" ? { ...bytes, bytes: 64 * 1024 * 1024 + 1 } : name === "a non-0600 payload" ? { ...bytes, mode: 0o700 } : { ...bytes, hash: HEX };
      expect(() => validateManifestStatePlan({ ...subject.plan, after: { ...subject.plan.after, bytes: replacement } }, subject.context)).toThrow(ManifestStateParticipantError);
    }
    finally { await cleanup(subject.root); }
  });

  it.each([
    { name: "missing payload", change: async (subject: Awaited<ReturnType<typeof fixture>>) => { await nodeFs.unlink(subject.payloadPath); } },
    { name: "changed payload inode", change: async (subject: Awaited<ReturnType<typeof fixture>>) => { await nodeFs.unlink(subject.payloadPath); await nodeFs.writeFile(subject.payloadPath, subject.AFTER, { mode: 0o600 }); } },
  ])("preserves evidence and refuses $name", async ({ change }) => {
    const subject = await fixture();
    try {
      await change(subject);
      await expect(subject.participant.apply(validateManifestStatePlan(subject.plan, subject.context))).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(BEFORE));
    } finally { await cleanup(subject.root); }
  });

  it("refuses a two-copy postimage and compacts only through guarded tombstone deletion", async () => {
    const subject = await fixture();
    try {
      const plan = validateManifestStatePlan(subject.plan, subject.context);
      await subject.participant.apply(plan);
      await nodeFs.writeFile(subject.payloadPath, subject.AFTER, { mode: 0o600 });
      await expect(subject.participant.observe(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
      await nodeFs.unlink(subject.payloadPath);
      let deleted = 0;
      const participant = new ManifestStateParticipant({ ...subject.participant.dependencies, guardedUnlinkExact: async (...args) => { deleted += 1; return subject.participant.dependencies.guardedUnlinkExact(...args); } });
      await participant.compact(plan);
      expect(deleted).toBe(1);
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(subject.AFTER));
    } finally { await cleanup(subject.root); }
  });

  it("inspects the lifecycle payload slot even for committed absence", async () => {
    const subject = await fixture(false);
    try {
      const plan = validateManifestStatePlan({ ...subject.plan, after: { state: "absent" as const } }, subject.context);
      await expect(subject.participant.observe(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    } finally { await cleanup(subject.root); }
  });

  it("rejects bootstrap committed absence and a present state over 64 MiB", async () => {
    const subject = await fixture();
    try {
      const bootstrapId = "fi_11111111-1111-4111-8111-111111111111";
      const bootstrap = { ...subject.plan, participantId: `mf_${bootstrapId}`, envelope: { kind: "fresh_v2_init" as const, id: bootstrapId }, tombstonePath: join(dirname(subject.manifestPath), `.installation-manifest.mf_${bootstrapId}.json.tombstone`), after: { state: "absent" as const } };
      const context = { ...subject.context, admitParticipant: (envelope: unknown, participantId: unknown) => ({ envelope: envelope as never, participantId: participantId as never }) };
      expect(() => validateManifestStatePlan(bootstrap, context)).toThrow(ManifestStateParticipantError);
      expect(() => validateManifestStatePlan({ ...subject.plan, before: { ...subject.plan.before, size: String(64 * 1024 * 1024 + 1) } }, subject.context)).toThrow(ManifestStateParticipantError);
    } finally { await cleanup(subject.root); }
  });

  it("refuses an authority that substitutes the participant ID", async () => {
    const subject = await fixture();
    try {
      const context = { ...subject.context, admitParticipant: (envelope: unknown) => ({ envelope: envelope as never, participantId: "mf_substituted" as never }) };
      expect(() => validateManifestStatePlan(subject.plan, context)).toThrow(ManifestStateParticipantError);
    } finally { await cleanup(subject.root); }
  });

  it("compensates from the preimage cursor without moving an absent manifest", async () => {
    const subject = await fixture();
    try {
      const plan = validateManifestStatePlan(subject.plan, subject.context);
      await subject.participant.dependencies.guardedMoveNoReplace(plan.manifestPath, plan.tombstonePath, subject.participant.dependencies.admission.updatePayloadIdentity === undefined ? {} as never : { hash: plan.before.state === "present" ? plan.before.hash : "" as never, ownerUid: 501, mode: 0o600, nlink: 1, size: plan.before.state === "present" ? plan.before.size : "" as never, dev: plan.before.state === "present" ? plan.before.dev as never : "" as never, ino: plan.before.state === "present" ? plan.before.ino as never : "" as never });
      await expect(subject.participant.compensate(plan)).resolves.toMatchObject({ state: "compensated" });
      expect(await nodeFs.readFile(subject.manifestPath)).toEqual(Buffer.from(BEFORE));
    } finally { await cleanup(subject.root); }
  });
});
