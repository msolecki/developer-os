import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codexRegistrationProjectionHash,
  ownerCurrentPartitionHash,
  createNodeLifecycleGuardedFileSystem,
  deriveUpdatePayloadPath,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  ownerExternalEffectProcessPolicyHash,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseStableSemver,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  type AllocatedLifecycleIdV1,
  type CanonicalAbsolutePathV1,
  type CodexRegistrationProjectionV1,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type OwnerExternalEffectIdV1,
  type OwnerExternalEffectLiteralV1,
  type OwnerExternalEffectPlanV1,
  type OwnerUpdatePlanV1,
  type SafeReasonCodeV1,
  type UpdateFoundationParticipantRefV2,
  type UpdateInitialJournalRefV1,
  type UpdateLeafPlanKindV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { OwnerExternalEffectParticipant, type OwnerExternalEffectStepV1 } from "./external-effect.js";
import { OwnerUpdateParticipant, type OwnerUpdateStepV1, type UpdateFoundationPortV1 } from "./owner-participant.js";
import { UpdateParticipantJournalStore } from "./state-participant.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const nonce = "f".repeat(64);
const coordinatorId = `lc_${nonce}_1` as LifecycleCoordinatorIdV1;
const tx = (counter: number): AllocatedLifecycleIdV1<"tx"> => `tx_${nonce}_${String(counter)}` as AllocatedLifecycleIdV1<"tx">;
const effectId = `oe_${nonce}_9` as OwnerExternalEffectIdV1;
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const target = parseCanonicalAbsolutePathText("/synthetic/codex/plugin-root/skills/a.md");
const oldHash = sha("old a");
const newHash = sha("new a");

function artifact(installedHash: LowerHexSha256): ManagedArtifactV2 {
  return {
    owner: "codex",
    path: target,
    productVersion: parseStableSemver("1.1.0"),
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "skills/a.md" as ManagedArtifactV2["source"],
    mergeStrategy: "dedicated",
    verifiedAt: at,
    kind: "file",
    verification: { mode: "content", installedHash },
  };
}

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

/** Writes the immutable plan and its staged initial journal exactly as construction would. */
async function stage(root: CanonicalAbsolutePathV1, kind: UpdateLeafPlanKindV1 & UpdateInitialJournalRefV1["kind"], id: string, plan: unknown, initial: Record<string, unknown>) {
  const planPath = updateLeafPlanPath(root, kind, id);
  await writeOwned(planPath, updateParticipantDocumentBytes(plan));
  const planHash = updateParticipantDocumentHash(plan);
  const bytes = encoder.encode(encodeCanonicalJson({ ...initial, planHash, createdAt: at, updatedAt: at }));
  const stagedPath = parseCanonicalAbsolutePathText(`${root}/update/initial-journals/${kind}/${id}.json`);
  await writeOwned(stagedPath, bytes);
  return {
    planRef: { kind, id, path: planPath, hash: planHash, bytes: updateParticipantDocumentBytes(plan).byteLength },
    journal: { kind, id, planHash, finalPath: updateParticipantJournalPath(root, kind, id), stagedPath, stagedExpected: { constructionOrdinal: 0, hash: sha(bytes), bytes: bytes.byteLength, mode: 384 } } as UpdateInitialJournalRefV1,
  };
}

function ref(id: AllocatedLifecycleIdV1<"tx">, role: UpdateFoundationParticipantRefV2["role"]): UpdateFoundationParticipantRefV2 {
  const forward = role.kind === "forward";
  return {
    id,
    slot: forward ? "owner_forward_files" : "owner_inverse_files",
    role,
    mutations: [{ targetPath: target, operation: "replace", expectedBeforeHash: forward ? oldHash : newHash, contentHash: forward ? newHash : oldHash, contentSize: 5, stagedPath: parseCanonicalAbsolutePathText(`/synthetic/staged/${id}.bin`) }],
    maximumJournalBytes: 4096,
    planHash: sha(id),
    initialJournal: { finalPath: parseCanonicalAbsolutePathText(`/synthetic/state/transactions/${id}.json`), plannedBytesHash: sha(id), staged: { kind: "update_expected", coordinatorId, ordinal: 0, path: parseCanonicalAbsolutePathText(`/synthetic/staging/${id}.json`) as never, hash: sha(id), bytes: 10, mode: 0o600 } },
  };
}

const expected: CodexRegistrationProjectionV1 = { pluginId: parseSafeReasonCode("developer_os"), enabled: true, protocol: parsePositiveUInt32(1), version: parseSafeReasonCode("v1_1_0"), source: "managed_plugin_root" };
const proposed: CodexRegistrationProjectionV1 = { ...expected, version: parseSafeReasonCode("v1_2_0") };

interface OwnerFixture {
  readonly step: OwnerUpdateStepV1;
  readonly events: string[];
  readonly hashes: Map<string, LowerHexSha256 | null>;
  readonly foundationState: Map<string, "future" | "partial" | "committed" | "rolled_back">;
  readonly participant: OwnerUpdateParticipant;
}

async function fixture(options: { readonly effect?: boolean } = {}): Promise<OwnerFixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-owner-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  const withEffect = options.effect !== false;
  const events: string[] = [];
  const hashes = new Map<string, LowerHexSha256 | null>([[target, oldHash]]);
  const foundationState = new Map<string, "future" | "partial" | "committed" | "rolled_back">();
  const foundation = [ref(tx(1), { kind: "forward", compensationId: tx(2) }), ref(tx(2), { kind: "compensation", forwardId: tx(1) })];
  const policy = {
    kind: "codex_registration_refresh" as const,
    providerProtocol: parsePositiveUInt32(1),
    executable: "pinned_codex_cli" as const,
    executableIdentity: { ownerUid: uid as EffectiveUidV1, mode: 493 as const, nlink: 1 as const, bytes: 10, sha256: sha("codex"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") },
    argv: [{ kind: "literal" as const, value: "plugin" as OwnerExternalEffectLiteralV1 }, { kind: "token" as const, value: "plugin_id" as const }],
    cwd: "managed_plugin_root" as const,
    environment: [{ name: "HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }] as const,
    stdin: "closed" as const,
    network: false as const,
    model: false as const,
    stdoutBytes: 1024,
    stderrBytes: 1024,
    wallMilliseconds: 1000,
    idleMilliseconds: 1000,
    processCount: 1 as const,
  };
  const effectPlan: OwnerExternalEffectPlanV1 = {
    schemaVersion: 1, id: effectId, coordinatorId, kind: "codex_registration_refresh", owner: "codex", providerProtocol: parsePositiveUInt32(1), fileParticipantIds: [tx(1)],
    expectedStateHash: codexRegistrationProjectionHash(expected), proposedStateHash: codexRegistrationProjectionHash(proposed), processPolicy: policy, processPolicyHash: ownerExternalEffectProcessPolicyHash(policy),
    forwardPayloads: [], compensationPayloads: [], maximumPlanBytes: 65_536, maximumJournalBytes: 4096, maximumEvidenceBytes: 4096,
  };
  const effectStaged = await stage(root, "owner_external_effect", effectId, effectPlan, { schemaVersion: 1, id: effectId, coordinatorId, phase: "planned", direction: "forward", nextTransition: 0, evidenceHash: null });
  const effect: OwnerExternalEffectStepV1 = { plan: effectPlan, planRef: effectStaged.planRef as OwnerExternalEffectStepV1["planRef"], journal: effectStaged.journal };
  const ownerId = parseSafeReasonCode("owner_codex");
  const plan: OwnerUpdatePlanV1 = {
    schemaVersion: 1,
    id: ownerId,
    coordinatorId,
    owner: "codex",
    currentPartitionHash: ownerCurrentPartitionHash("codex", [artifact(oldHash)]),
    operations: [{
      operation: "replace", owner: "codex", targetPath: target,
      expectedBefore: { state: "file", mode: 384, hash: oldHash, bytes: 5, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("3") },
      afterArtifact: artifact(newHash),
      content: { kind: "update_expected", coordinatorId, ordinal: 0, path: deriveUpdatePayloadPath(home, coordinatorId as string as SafeReasonCodeV1, 0), bytes: 5, sha256: newHash, mode: 384 },
    }],
    foundation,
    externalEffects: withEffect ? [effect.planRef] : [],
    inverseOperationHash: sha("inverse"),
    maximumPlanBytes: 65_536,
  };
  const ownerStaged = await stage(root, "owner_update", ownerId, plan, { schemaVersion: 1, id: ownerId, coordinatorId, phase: "planned", nextForwardFoundation: 0, nextExternalEffect: 0, compensationNext: null, compactionNext: null });
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid: uid });
  let registration = expected;
  const effects = new OwnerExternalEffectParticipant({
    journals,
    stagingRoot: root,
    tokens: { managedPluginRoot: "/synthetic/codex/plugin-root", pluginId: "developer-os@developer-os", privateEffectTmp: "/synthetic/tmp", managedVendorHome: "/synthetic/codex/home" },
    observe: () => {
      events.push("codex_observe");
      return Promise.resolve(registration);
    },
    resolveExecutable: () => Promise.resolve("/synthetic/bin/codex"),
    run: () => {
      events.push("codex_refresh");
      registration = hashes.get(target) === newHash ? proposed : expected;
      return Promise.resolve({ exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() });
    },
    redact: (text) => text,
    now: () => new Date(at),
  });
  const port: UpdateFoundationPortV1 = {
    apply: (row) => {
      events.push(row.role.kind === "forward" ? "foundation" : "foundation_inverse");
      hashes.set(target, row.role.kind === "forward" ? newHash : oldHash);
      foundationState.set(row.id, "committed");
      return Promise.resolve();
    },
    observe: (row) => Promise.resolve(foundationState.get(row.id) ?? "future"),
    rollback: (row) => {
      events.push("foundation_rollback");
      hashes.set(target, oldHash);
      foundationState.set(row.id, "rolled_back");
      return Promise.resolve();
    },
    compact: (row) => {
      events.push(`compact:${row.id}`);
      return Promise.resolve();
    },
  };
  const participant = new OwnerUpdateParticipant({ journals, foundation: port, effects, hashTarget: (path) => Promise.resolve(hashes.get(path) ?? null), now: () => new Date(at) });
  return { step: { plan, planRef: ownerStaged.planRef as OwnerUpdateStepV1["planRef"], journal: ownerStaged.journal, effect: withEffect ? effect : null }, events, hashes, foundationState, participant };
}

describe("owner update participant", () => {
  it("applies owner Foundation rows before its one external effect", async () => {
    const { step, events, participant } = await fixture();
    await participant.apply(step);
    expect(events).toEqual(["foundation", "codex_observe", "codex_refresh", "codex_observe"]);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "verified", nextForwardFoundation: 1, nextExternalEffect: 1 });
  });

  it("verifies an owner without an effect after its files", async () => {
    const { step, events, participant } = await fixture({ effect: false });
    await participant.applyFiles(step);
    expect(events).toEqual(["foundation"]);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "verified" });
  });

  it("refuses a concurrent edit before any Foundation row", async () => {
    const { step, events, hashes, participant } = await fixture();
    hashes.set(target, sha("edited"));
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(events).toEqual([]);
  });

  it("restores files before compensating the effect", async () => {
    const { step, events, hashes, participant } = await fixture();
    await participant.apply(step);
    events.length = 0;
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(events[0]).toBe("foundation_inverse");
    expect(events).toContain("codex_refresh");
    expect(events.indexOf("foundation_inverse")).toBeLessThan(events.indexOf("codex_refresh"));
    expect(hashes.get(target)).toBe(oldHash);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "rolled_back", compensationNext: -1 });
  });

  it("rolls back a forward row that died before its cursor advanced", async () => {
    const { step, events, foundationState, participant } = await fixture();
    await expect(participant.applyEffects(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    foundationState.set(tx(1), "partial");
    await participant.compensate(step);
    expect(events).toContain("foundation_rollback");
    expect(events).not.toContain("foundation_inverse");
  });

  it("compacts every paired Foundation ref in ID order, then the journal and plan", async () => {
    const { step, events, participant } = await fixture();
    await participant.apply(step);
    await participant.finalize(step);
    events.length = 0;
    await participant.compact(step);
    expect(events).toEqual([`compact:${tx(1)}`, `compact:${tx(2)}`]);
    expect(await readJson(step.journal.finalPath)).toBeNull();
    expect(await readJson(step.planRef.path)).toBeNull();
  });
});
