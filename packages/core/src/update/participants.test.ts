import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AllocatedLifecycleIdV1, EffectiveUidV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import type { ManagedArtifactV2 } from "../manifest/types.js";
import { updateLeafPlanHash } from "./bundle-participant.js";
import type { ImmutableUpdatePlanRefV1, OwnerExternalEffectIdV1 } from "./construction.js";
import { updateFoundationStagedPath, type SchemaMigrationPlanV1, type UpdateFoundationMutationRefV1, type UpdateFoundationParticipantRefV2, type UpdatePayloadRefV1 } from "./migrations.js";
import {
  codexRegistrationProjectionHash,
  compensateParticipants,
  migrationPostimagesHash,
  ownerCurrentPartitionHash,
  ownerExternalEffectProcessPolicyHash,
  ownerInverseOperationHash,
  ownerPostimagesHash,
  updateCompensationSteps,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  validateCanonicalStateFilePlan,
  validateOwnerExternalEffectEvidence,
  validateOwnerExternalEffectJournal,
  validateOwnerExternalEffectPlan,
  validateOwnerUpdateJournal,
  validateOwnerUpdatePlan,
  validateStateParticipantJournal,
  validateTargetVerificationPlan,
  type CanonicalStateFilePlanV1,
  type CodexRegistrationProjectionV1,
  type OwnerExternalEffectPlanV1,
  type OwnerExternalEffectProcessPolicyV1,
  type OwnerUpdatePlanV1,
  type PersistedOwnerChangeOperationV1,
  type UpdateLifecycleCoordinatorStepV1,
} from "./participants.js";
import type { ReleaseIdentityV1 } from "./release.js";
import { deriveCanonicalStatePayloadPath, deriveFoundationInitialJournalPayloadPath, deriveUpdatePayloadPath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "./paths.js";
import {
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseSchemaMigrationId,
  parseStableSemver,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
  type SafeReasonCodeV1,
} from "./scalars.js";

const sha = (value: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const clone = <T>(value: T): T => structuredClone(value);
const productHome = parseCanonicalAbsolutePathText("/product");
const nonce = "b".repeat(64);
const coordinatorId = `lc_${nonce}_3` as LifecycleCoordinatorIdV1;
const coordinator = coordinatorId as string as SafeReasonCodeV1;
const tx = (counter: number): AllocatedLifecycleIdV1<"tx"> => `tx_${nonce}_${String(counter)}` as AllocatedLifecycleIdV1<"tx">;
const effectId = `oe_${nonce}_9` as OwnerExternalEffectIdV1;
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const dev = parseUInt64Decimal("7");
const ino = (value: number) => parseUInt64Decimal(String(value));
const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);

const root = path("/home/.codex/plugins/developer-os");
const kept = path(`${root}/skills`);
const replaced = path(`${root}/skills/a.md`);
const created = path(`${root}/skills/b.md`);

function artifact(target: CanonicalAbsolutePathV1, kind: "file" | "directory", hash: LowerHexSha256 | null): ManagedArtifactV2 {
  const common = {
    owner: "codex" as const,
    path: target,
    productVersion: parseStableSemver("1.1.0"),
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: target.slice(root.length + 1) as ManagedArtifactV2["source"],
    mergeStrategy: "dedicated" as const,
    verifiedAt: at,
  };
  return kind === "directory" ? { ...common, kind: "directory", verification: { mode: "content" } } : { ...common, kind: "file", verification: { mode: "content", installedHash: hash ?? sha("") } };
}

function payload(ordinal: number, content: string): UpdatePayloadRefV1 {
  return { kind: "update_expected", coordinatorId, ordinal, path: deriveUpdatePayloadPath(productHome, coordinator, ordinal), bytes: content.length, sha256: sha(content), mode: 384 };
}

const currentPartition = [artifact(kept, "directory", null), artifact(replaced, "file", sha("old a"))];

const operations: PersistedOwnerChangeOperationV1[] = [
  { operation: "keep", owner: "codex", targetPath: kept, expectedBefore: { state: "directory", mode: 448, dev, ino: ino(1) }, afterArtifact: artifact(kept, "directory", null), content: null },
  { operation: "replace", owner: "codex", targetPath: replaced, expectedBefore: { state: "file", mode: 384, hash: sha("old a"), bytes: 5, dev, ino: ino(2) }, afterArtifact: artifact(replaced, "file", sha("new a")), content: payload(0, "new a") },
  { operation: "create", owner: "codex", targetPath: created, expectedBefore: { state: "absent" }, afterArtifact: artifact(created, "file", sha("new b")), content: payload(1, "new b") },
];

/** Spec 2 §5.3 (D60): the standard staged path, the operation's content payload, and its sidecar row. */
function mutation(target: CanonicalAbsolutePathV1, operation: "create" | "replace", before: LowerHexSha256 | null, after: string, index: number, contentOrdinal: number): UpdateFoundationMutationRefV1 {
  return {
    targetPath: target, operation, expectedBeforeHash: before, contentHash: sha(after), contentSize: after.length,
    stagedPath: updateFoundationStagedPath(productHome, tx(1), index),
    content: payload(contentOrdinal, after),
    digest: payload(10 + contentOrdinal, `${sha(after)}\n`),
  };
}

function foundationRef(id: AllocatedLifecycleIdV1<"tx">, role: UpdateFoundationParticipantRefV2["role"], mutations: readonly UpdateFoundationMutationRefV1[]): UpdateFoundationParticipantRefV2 {
  return {
    id,
    slot: role.kind === "forward" ? "owner_forward_files" : "owner_inverse_files",
    role,
    mutations,
    maximumJournalBytes: 4096,
    planHash: sha(`plan-${id}`),
    initialJournal: { finalPath: path(`/product/state/transactions/${id}.json`), plannedBytesHash: sha(id), staged: { kind: "update_expected", coordinatorId, ordinal: 5, path: deriveFoundationInitialJournalPayloadPath(productHome, coordinator, id as string as SafeReasonCodeV1), hash: sha(id), bytes: 10, mode: 0o600 } },
  };
}

const foundation = [
  foundationRef(tx(1), { kind: "forward", compensationId: tx(2) }, [mutation(replaced, "replace", sha("old a"), "new a", 0, 0), mutation(created, "create", null, "new b", 1, 1)]),
  foundationRef(tx(2), { kind: "compensation", forwardId: tx(1) }, []),
];

const policy: OwnerExternalEffectProcessPolicyV1 = {
  kind: "codex_registration_refresh",
  providerProtocol: parsePositiveUInt32(1),
  executable: "pinned_codex_cli",
  executableIdentity: { dev, ino: ino(40), mode: 0o755, sha256: sha("codex binary") },
  argv: [
    { kind: "literal", value: "plugin" as never },
    { kind: "literal", value: "add" as never },
    { kind: "token", value: "plugin_id" },
    { kind: "literal", value: "--json" as never },
  ],
  cwd: "managed_plugin_root",
  environment: [{ name: "CODEX_HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }],
  stdin: "closed",
  network: false,
  model: false,
  stdoutBytes: 65_536,
  stderrBytes: 65_536,
  wallMilliseconds: 60_000,
  idleMilliseconds: 10_000,
  processCount: 1,
};

const expectedProjection: CodexRegistrationProjectionV1 = { pluginId: parseSafeReasonCode("developer_os"), enabled: true, protocol: parsePositiveUInt32(1), version: parseSafeReasonCode("v1_1_0"), source: "managed_plugin_root" };
const proposedProjection: CodexRegistrationProjectionV1 = { ...expectedProjection, version: parseSafeReasonCode("v1_2_0") };

function buildEffect(): OwnerExternalEffectPlanV1 {
  return {
    schemaVersion: 1,
    id: effectId,
    coordinatorId,
    kind: "codex_registration_refresh",
    owner: "codex",
    providerProtocol: parsePositiveUInt32(1),
    fileParticipantIds: [tx(1)],
    expectedStateHash: codexRegistrationProjectionHash(expectedProjection),
    proposedStateHash: codexRegistrationProjectionHash(proposedProjection),
    processPolicy: policy,
    processPolicyHash: ownerExternalEffectProcessPolicyHash(policy),
    forwardPayloads: [],
    compensationPayloads: [],
    maximumPlanBytes: 65_536,
    maximumJournalBytes: 4096,
    maximumEvidenceBytes: 4096,
  };
}

function effectRef(effect: OwnerExternalEffectPlanV1): ImmutableUpdatePlanRefV1<"owner_external_effect"> {
  return { kind: "owner_external_effect", id: effect.id, path: path(`/product/staging/lifecycle/${coordinatorId}/update/plans/owner_external_effect/${effect.id}.plan.json`), hash: updateParticipantDocumentHash("owner_external_effect", effect), bytes: 100 };
}

function buildOwner(overrides: Partial<OwnerUpdatePlanV1> = {}): OwnerUpdatePlanV1 {
  return {
    schemaVersion: 1,
    id: parseSafeReasonCode("owner_codex"),
    coordinatorId,
    owner: "codex",
    currentPartitionHash: ownerCurrentPartitionHash("codex", currentPartition),
    operations,
    foundation,
    externalEffects: [effectRef(buildEffect())],
    inverseOperationHash: sha("inverse"),
    maximumPlanBytes: 1_048_576,
    ...overrides,
  };
}

const context = { productHome, currentPartition };

describe("owner update plans", () => {
  it("admits a replace, a create below a kept directory, and one Codex effect", () => {
    expect(validateOwnerUpdatePlan(buildOwner(), context).operations).toHaveLength(3);
  });

  it.each([
    ["a create below a missing parent", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [plan.operations[0], plan.operations[1], { ...plan.operations[2], targetPath: path(`${root}/other/b.md`), afterArtifact: artifact(path(`${root}/other/b.md`), "file", sha("new b")) }] })],
    ["a directory replace", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [{ ...plan.operations[0], operation: "replace" as const }, plan.operations[1], plan.operations[2]] })],
    ["a keep carrying content", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [{ ...plan.operations[0], content: payload(3, "x") }, plan.operations[1], plan.operations[2]] })],
    ["a remove with an after artifact", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [plan.operations[0], { ...plan.operations[1], operation: "remove" as const, content: null }, plan.operations[2]] })],
    ["a create over an installed path", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [plan.operations[0], plan.operations[1], { ...plan.operations[2], targetPath: replaced }] })],
    ["a missing current artifact", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [plan.operations[0], plan.operations[2]] })],
    ["a replace over 16 MiB", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [plan.operations[0], { ...plan.operations[1], expectedBefore: { state: "file" as const, mode: 384 as const, hash: sha("old a"), bytes: 16_777_217, dev, ino: ino(2) } }, plan.operations[2]] })],
    ["a second effect", (plan: OwnerUpdatePlanV1) => ({ ...plan, externalEffects: [...plan.externalEffects, ...plan.externalEffects] })],
    ["a non-Codex effect", (plan: OwnerUpdatePlanV1) => ({ ...plan, owner: "claude" as const })],
    ["an unpaired Foundation ref", (plan: OwnerUpdatePlanV1) => ({ ...plan, foundation: plan.foundation.slice(0, 1) })],
    ["a schema-slot Foundation ref", (plan: OwnerUpdatePlanV1) => ({ ...plan, foundation: plan.foundation.map((ref) => ({ ...ref, slot: "schema_forward" as const })) })],
    ["a Foundation mutation staged at its payload path", (plan: OwnerUpdatePlanV1) => ({ ...plan, foundation: plan.foundation.map((ref) => ({ ...ref, mutations: ref.mutations.map((row) => ({ ...row, stagedPath: row.content?.path ?? null })) })) })],
    ["a Foundation mutation without its sidecar row", (plan: OwnerUpdatePlanV1) => ({ ...plan, foundation: plan.foundation.map((ref) => ({ ...ref, mutations: ref.mutations.map((row) => ({ ...row, digest: null })) })) })],
    ["a Foundation mutation staging other content than its operation", (plan: OwnerUpdatePlanV1) => ({ ...plan, foundation: plan.foundation.map((ref) => ({ ...ref, mutations: ref.mutations.map((row) => ({ ...row, content: payload(7, "new a"), digest: payload(17, `${sha("new a")}\n`) })) })) })],
    ["a stale partition hash", (plan: OwnerUpdatePlanV1) => ({ ...plan, currentPartitionHash: sha("stale") })],
    ["out-of-order operations", (plan: OwnerUpdatePlanV1) => ({ ...plan, operations: [...plan.operations].reverse() })],
  ])("refuses %s", (_name, mutate) => {
    expect(() => validateOwnerUpdatePlan(mutate(clone(buildOwner())), context)).toThrow();
  });

  describe("an ephemeral reservation (D72 P5)", () => {
    const reservation = path(`${root}/state.json`);
    const ephemeral = { ...artifact(reservation, "file", null), verification: { mode: "ephemeral" } } as ManagedArtifactV2;
    const present = { state: "ephemeral_present" as const, mode: 384 as const, dev, ino: ino(3) };

    function withReservation(row: Partial<PersistedOwnerChangeOperationV1>, installed: ManagedArtifactV2 = ephemeral): () => OwnerUpdatePlanV1 {
      const partition = [...currentPartition, installed];
      const operation: PersistedOwnerChangeOperationV1 = { operation: "keep", owner: "codex", targetPath: reservation, expectedBefore: { state: "absent" }, afterArtifact: installed, content: null, ...row };
      const plan = buildOwner({ operations: [...operations, operation], currentPartitionHash: ownerCurrentPartitionHash("codex", partition) });
      return () => validateOwnerUpdatePlan(plan, { productHome, currentPartition: partition });
    }

    it("keeps over an absent reservation", () => {
      expect(withReservation({})().operations).toHaveLength(4);
    });

    it("keeps over an ephemeral_present reservation without reading its bytes", () => {
      expect(withReservation({ expectedBefore: present })().operations[3]?.expectedBefore).toEqual(present);
    });

    it("refuses an ephemeral replace", () => {
      expect(withReservation({ operation: "replace", expectedBefore: present, content: payload(2, "x") })).toThrow(/an ephemeral reservation only keeps/u);
    });

    it("refuses an ephemeral keep over a hashed file before", () => {
      expect(withReservation({ expectedBefore: { state: "file", mode: 384, hash: sha("s"), bytes: 1, dev, ino: ino(3) } })).toThrow(/an ephemeral keep over a hashed before/u);
    });

    it("refuses a file keep over absent", () => {
      const file = artifact(reservation, "file", sha("s"));
      expect(withReservation({ afterArtifact: file }, file)).toThrow(/keep is not byte-identical/u);
    });

    it("refuses ephemeral_present before a non-ephemeral artifact", () => {
      const file = artifact(reservation, "file", sha("s"));
      expect(withReservation({ expectedBefore: present, afterArtifact: file }, file)).toThrow(/an ephemeral reservation only keeps/u);
    });

    it("refuses ephemeral_present as a postimage", () => {
      expect(withReservation({ expectedBefore: present, afterArtifact: present as never })).toThrow();
    });

    it("refuses an ephemeral_present state that carries a hash", () => {
      expect(withReservation({ expectedBefore: { ...present, hash: sha("s") } as never })).toThrow(/expectedBefore: keys/u);
    });
  });

  it("binds the owner journal cursors to their phase", () => {
    const plan = buildOwner();
    const base = { schemaVersion: 1, id: plan.id, coordinatorId, planHash: updateParticipantDocumentHash("owner_update", plan), nextForwardFoundation: 0, nextExternalEffect: 0, compensationNext: null, compactionNext: null, createdAt: at, updatedAt: at };
    expect(validateOwnerUpdateJournal({ ...base, phase: "planned" }, plan).phase).toBe("planned");
    expect(validateOwnerUpdateJournal({ ...base, phase: "effects_applying", nextForwardFoundation: 1 }, plan).phase).toBe("effects_applying");
    expect(validateOwnerUpdateJournal({ ...base, phase: "verified", nextForwardFoundation: 1, nextExternalEffect: 1 }, plan).phase).toBe("verified");
    expect(() => validateOwnerUpdateJournal({ ...base, phase: "effects_applying" }, plan)).toThrow();
    expect(() => validateOwnerUpdateJournal({ ...base, phase: "verified", nextForwardFoundation: 1 }, plan)).toThrow();
    expect(() => validateOwnerUpdateJournal({ ...base, phase: "compensating", compensationNext: 0 }, plan)).toThrow();
    expect(() => validateOwnerUpdateJournal({ ...base, phase: "planned", planHash: sha("other") }, plan)).toThrow();
    expect(() => validateOwnerUpdateJournal({ ...base, phase: "planned", extra: 1 }, plan)).toThrow();
  });
});

describe("owner external effects", () => {
  it("admits the closed Codex refresh and binds its policy digest", () => {
    expect(validateOwnerExternalEffectPlan(buildEffect(), buildOwner()).processPolicyHash).toBe(ownerExternalEffectProcessPolicyHash(policy));
  });

  it.each([0o700, 0o755, 0o555, 0o500])("admits the executable mode %o (D72 Q2-A)", (mode) => {
    expect(() => ownerExternalEffectProcessPolicyHash({ ...policy, executableIdentity: { ...policy.executableIdentity, mode } })).not.toThrow();
  });

  it.each<[string, unknown]>([
    ["HOME instead of CODEX_HOME", { environment: [{ name: "HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }] }],
    ["TMPDIR before CODEX_HOME", { environment: [{ name: "TMPDIR", value: "private_effect_tmp" }, { name: "CODEX_HOME", value: "managed_vendor_home" }] }],
    ["a group-writable executable", { executableIdentity: { ...policy.executableIdentity, mode: 0o775 } }],
    ["an other-writable executable", { executableIdentity: { ...policy.executableIdentity, mode: 0o757 } }],
    ["an executable without the owner-execute bit", { executableIdentity: { ...policy.executableIdentity, mode: 0o644 } }],
    ["a setuid executable", { executableIdentity: { ...policy.executableIdentity, mode: 0o4755 } }],
    ["a negative mode", { executableIdentity: { ...policy.executableIdentity, mode: -1 } }],
    ["the withdrawn link count", { executableIdentity: { ...policy.executableIdentity, nlink: 1 } }],
    ["the withdrawn owner", { executableIdentity: { ...policy.executableIdentity, ownerUid: 501 } }],
    ["a missing digest", { executableIdentity: { dev, ino: ino(40), mode: 0o755 } }],
  ])("refuses a policy with %s (D72 Q2-A)", (_name, patch) => {
    expect(() => ownerExternalEffectProcessPolicyHash({ ...policy, ...(patch as object) })).toThrow();
  });

  it.each([
    ["an extra environment entry", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, environment: [...effect.processPolicy.environment, { name: "PATH", value: "managed_vendor_home" }] } })],
    ["reordered environment", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, environment: [...effect.processPolicy.environment].reverse() } })],
    ["network authority", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, network: true } })],
    ["model authority", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, model: true } })],
    ["open stdin", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, stdin: "pipe" } })],
    ["a second process", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, processCount: 2 } })],
    ["an unknown argv token", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, argv: [{ kind: "token", value: "vendor_home" }] } })],
    ["a control byte literal", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, argv: [{ kind: "literal", value: "plug\nin" }] } })],
    ["a wall deadline over two minutes", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicy: { ...effect.processPolicy, wallMilliseconds: 120_001 } })],
    ["a stale policy digest", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, processPolicyHash: sha("stale") })],
    ["a forward payload", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, forwardPayloads: [payload(9, "x")] })],
    ["file IDs that are not the forward refs", (effect: OwnerExternalEffectPlanV1) => ({ ...effect, fileParticipantIds: [tx(2)] })],
  ])("refuses %s", (_name, mutate) => {
    const effect = mutate(clone(buildEffect())) as OwnerExternalEffectPlanV1;
    expect(() => validateOwnerExternalEffectPlan(effect, buildOwner({ externalEffects: [effectRef(effect)] }))).toThrow();
  });

  it("hashes only the tokenized registration projection", () => {
    expect(codexRegistrationProjectionHash(expectedProjection)).not.toBe(codexRegistrationProjectionHash(proposedProjection));
    expect(() => codexRegistrationProjectionHash({ ...expectedProjection, path: "/home/.codex" } as unknown as CodexRegistrationProjectionV1)).toThrow();
    expect(() => codexRegistrationProjectionHash({ ...expectedProjection, source: "raw" } as unknown as CodexRegistrationProjectionV1)).toThrow();
  });

  it("binds evidence to observed phases", () => {
    const effect = buildEffect();
    const base = { schemaVersion: 1, id: effectId, coordinatorId, planHash: updateParticipantDocumentHash("owner_external_effect", effect), createdAt: at, updatedAt: at };
    expect(validateOwnerExternalEffectJournal({ ...base, phase: "forward_intent", direction: "forward", nextTransition: 0, evidenceHash: null }, effect).phase).toBe("forward_intent");
    expect(validateOwnerExternalEffectJournal({ ...base, phase: "forward_observed", direction: "forward", nextTransition: 1, evidenceHash: sha("e") }, effect).phase).toBe("forward_observed");
    expect(() => validateOwnerExternalEffectJournal({ ...base, phase: "forward_observed", direction: "forward", nextTransition: 1, evidenceHash: null }, effect)).toThrow();
    expect(() => validateOwnerExternalEffectJournal({ ...base, phase: "compensation_observed", direction: "forward", nextTransition: 2, evidenceHash: sha("e") }, effect)).toThrow();
  });
});

describe("canonical state files", () => {
  function statePlan(role: CanonicalStateFilePlanV1["role"], overrides: Partial<CanonicalStateFilePlanV1> = {}): CanonicalStateFilePlanV1 {
    const id = parseSafeReasonCode(`state_${role}`);
    return {
      schemaVersion: 1,
      id,
      coordinatorId,
      role,
      path: path(`/product/state/${role}.json`),
      tombstonePath: path(`/product/state/.${role}.tombstone.json`),
      before: { state: "present", hash: sha("before"), payload: null, ownerUid: 501 as EffectiveUidV1, mode: 384, nlink: 1, size: 6, dev, ino: ino(10) },
      after: { state: "present", hash: sha("after"), payload: { kind: "update_expected", coordinatorId, ordinal: 4, path: deriveCanonicalStatePayloadPath(productHome, coordinator, role, id), hash: sha("after"), bytes: 5, mode: 384 }, ownerUid: 501 as EffectiveUidV1, mode: 384, nlink: 1, size: 5 },
      reversal: role === "release_trust" ? "monotonic_no_reverse" : "reversible",
      maximumPlanBytes: 65_536,
      maximumJournalBytes: 4096,
      ...overrides,
    };
  }

  it("admits trust as monotonic and active as reversible", () => {
    expect(validateCanonicalStateFilePlan(statePlan("release_trust"), productHome).reversal).toBe("monotonic_no_reverse");
    expect(validateCanonicalStateFilePlan(statePlan("active_release"), productHome).reversal).toBe("reversible");
  });

  it.each([
    ["reversible trust", statePlan("release_trust", { reversal: "reversible" })],
    ["monotonic active", statePlan("active_release", { reversal: "monotonic_no_reverse" })],
    ["absent trust after", statePlan("release_trust", { after: { state: "absent" } })],
    ["absent to absent", statePlan("active_release", { before: { state: "absent" }, after: { state: "absent" } })],
    ["a preimage with a payload", statePlan("active_release", { before: { ...statePlan("active_release").after, dev, ino: ino(11) } as never })],
    ["a postimage without a payload", statePlan("active_release", { after: { ...statePlan("active_release").before } as never })],
    ["a postimage with a planned device/inode", statePlan("active_release", { after: { ...statePlan("active_release").after, dev, ino: ino(11) } as never })],
    ["a preimage without a device/inode", statePlan("active_release", { before: { state: "present", hash: sha("before"), payload: null, ownerUid: 501 as EffectiveUidV1, mode: 384, nlink: 1, size: 6 } as never })],
    ["a payload of another role", statePlan("active_release", { after: statePlan("rollback_record").after })],
    ["a non-sibling tombstone", statePlan("active_release", { tombstonePath: path("/product/other/.t.json") })],
  ])("refuses %s", (_name, plan) => {
    expect(() => validateCanonicalStateFilePlan(plan, productHome)).toThrow();
  });

  it("fixes the plan bytes before the payload exists: only the preimage carries a device/inode", () => {
    const plan = validateCanonicalStateFilePlan(statePlan("active_release"), productHome);
    expect(Object.keys(plan.after).sort()).toEqual(["hash", "mode", "nlink", "ownerUid", "payload", "size", "state"]);
    expect(Object.keys(plan.before)).toEqual(expect.arrayContaining(["dev", "ino"]));
    expect(updateParticipantDocumentHash("active_release_state", plan)).toBe(updateParticipantDocumentHash("active_release_state", statePlan("active_release")));
  });

  it("accepts only the linear transition prefix", () => {
    const plan = statePlan("active_release");
    const base = { schemaVersion: 1, kind: "active_release_state", id: plan.id, coordinatorId, planHash: updateParticipantDocumentHash("active_release_state", plan), createdAt: at, updatedAt: at };
    expect(validateStateParticipantJournal({ ...base, phase: "published", nextTransition: 2, compensationNext: null }, "active_release_state", plan, base.planHash).phase).toBe("published");
    expect(validateStateParticipantJournal({ ...base, phase: "compensating", nextTransition: 2, compensationNext: 1 }, "active_release_state", plan, base.planHash).phase).toBe("compensating");
    expect(() => validateStateParticipantJournal({ ...base, phase: "published", nextTransition: 1, compensationNext: null }, "active_release_state", plan, base.planHash)).toThrow();
    expect(() => validateStateParticipantJournal({ ...base, kind: "release_trust_state", phase: "planned", nextTransition: 0, compensationNext: null }, "active_release_state", plan, base.planHash)).toThrow();
    expect(validateStateParticipantJournal({ ...base, phase: "verified", nextTransition: 0, compensationNext: null }, "active_release_state", { ...plan, retainedVerification: true }, base.planHash).phase).toBe("verified");
  });
});

describe("participant compensation order", () => {
  const steps: UpdateLifecycleCoordinatorStepV1[] = [
    { kind: "bundle", action: "publish_target" },
    { kind: "owner_files", owner: "codex", direction: "forward" },
    { kind: "owner_external_effect", owner: "codex", direction: "forward" },
    { kind: "rollback_payload", transition: "publish_proposed" },
    { kind: "manifest", transition: "preserve_before" },
    { kind: "manifest", transition: "publish_transitional" },
    { kind: "trust", transition: "publish_monotonic" },
    { kind: "rollback_record", transition: "publish_proposed" },
    { kind: "active", transition: "publish_target" },
    { kind: "target_verifier", release: "target" },
  ];

  it("never reverses trust but reverses active before the verifier point", async () => {
    const events: string[] = [];
    await compensateParticipants({ steps, nextStep: 9, pointOfNoReturnReached: false }, {
      compensate: async (step) => {
        await Promise.resolve();
        events.push(step.kind === "active" ? "active_restore" : step.kind === "trust" ? "trust_restore" : step.kind);
        return { state: "compensated" };
      },
    });
    expect(events).toContain("active_restore");
    expect(events).not.toContain("trust_restore");
    expect(events[0]).toBe("target_verifier");
    expect(events.at(-1)).toBe("bundle");
  });

  it("refuses compensation after the point of no return", () => {
    expect(() => updateCompensationSteps({ steps, nextStep: 9, pointOfNoReturnReached: true })).toThrow();
  });
});

describe("leaf plan ref hashes (D72 P7(a))", () => {
  const plainSha256 = (plan: unknown): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(updateParticipantDocumentBytes(plan)).digest("hex"));

  it("hashes in the developer-os/update-leaf/<kind>/v1 domain over the persisted bytes", () => {
    const owner = buildOwner();
    expect(updateParticipantDocumentHash("owner_update", owner)).toBe(updateLeafPlanHash("owner_update", updateParticipantDocumentBytes(owner)));
    expect(updateParticipantDocumentHash("owner_update", owner)).not.toBe(plainSha256(owner));
    expect(updateParticipantDocumentHash("owner_update", owner)).not.toBe(updateParticipantDocumentHash("schema_migration", owner));
  });

  it("admits a domain-hashed effect ref and refuses a plain SHA-256 one", () => {
    const effect = buildEffect();
    expect(validateOwnerExternalEffectPlan(effect, buildOwner()).id).toBe(effect.id);
    const plain = buildOwner({ externalEffects: [{ ...effectRef(effect), hash: plainSha256(effect) }] });
    expect(() => validateOwnerExternalEffectPlan(effect, plain)).toThrow(/differs from the owner plan's ref/u);
  });

  it("refuses a journal or evidence bound by a plain SHA-256 plan hash", () => {
    const owner = buildOwner();
    const effect = buildEffect();
    const ownerJournal = { schemaVersion: 1, id: owner.id, coordinatorId, planHash: plainSha256(owner), phase: "planned", nextForwardFoundation: 0, nextExternalEffect: 0, compensationNext: null, compactionNext: null, createdAt: at, updatedAt: at };
    expect(() => validateOwnerUpdateJournal(ownerJournal, owner)).toThrow(/planHash/u);
    const effectJournal = { schemaVersion: 1, id: effectId, coordinatorId, planHash: plainSha256(effect), phase: "planned", direction: "forward", nextTransition: 0, evidenceHash: null, createdAt: at, updatedAt: at };
    expect(() => validateOwnerExternalEffectJournal(effectJournal, effect)).toThrow(/planHash/u);
    const evidence = { schemaVersion: 1, id: effectId, coordinatorId, planHash: plainSha256(effect), direction: "forward", observedStateHash: effect.proposedStateHash, processPolicyHash: effect.processPolicyHash, exitCode: 0, redactedStdoutHash: sha(""), redactedStderrHash: sha(""), completedAt: at };
    expect(() => validateOwnerExternalEffectEvidence(evidence, effect, "forward", effect.proposedStateHash)).toThrow(/not this plan's evidence/u);
    expect(validateOwnerExternalEffectEvidence({ ...evidence, planHash: updateParticipantDocumentHash("owner_external_effect", effect) }, effect, "forward", effect.proposedStateHash).id).toBe(effectId);
  });

  it("refuses a plain SHA-256 owner ref in the owner postimage digest", () => {
    const owner = buildOwner();
    const row = { ref: { kind: "owner_update" as const, id: owner.id, path: path("/product/p/owner.plan.json"), hash: plainSha256(owner), bytes: 10 }, plan: owner, effects: [{ ref: owner.externalEffects[0] as ImmutableUpdatePlanRefV1<"owner_external_effect">, plan: buildEffect() }] };
    expect(() => ownerPostimagesHash([row])).toThrow(/a ref that is not its plan/u);
  });
});

describe("recovery digests", () => {
  const owner = buildOwner();
  const effect = buildEffect();
  const ownerRow = { ref: { kind: "owner_update" as const, id: owner.id, path: path("/product/p/owner.plan.json"), hash: updateParticipantDocumentHash("owner_update", owner), bytes: 10 }, plan: owner, effects: [{ ref: owner.externalEffects[0] as ImmutableUpdatePlanRefV1<"owner_external_effect">, plan: effect }] };
  const migration: SchemaMigrationPlanV1 = {
    schemaVersion: 1,
    id: parseSchemaMigrationId("migration_config-v2"),
    coordinatorId,
    domain: "product_state",
    fromVersion: parsePositiveUInt32(1),
    toVersion: parsePositiveUInt32(2),
    mutations: [{ path: path("/product/state/config.json") as never, beforeHash: sha("c1"), afterHash: sha("c2"), afterBlob: payload(6, "c2"), inverseBlob: payload(7, "c1") }],
    foundation: [],
    maximumPlanBytes: 65_536,
  };
  const migrationRow = { ref: { kind: "schema_migration" as const, id: migration.id, path: path("/product/p/m.plan.json"), hash: updateParticipantDocumentHash("schema_migration", migration), bytes: 10 }, plan: migration };

  it("hashes the empty migration set as the canonical empty array", () => {
    expect(migrationPostimagesHash([])).toBe(parseLowerHexSha256(createHash("sha256").update("developer-os/update-migration-postimages/v1\0[]").digest("hex")));
  });

  it.each([
    ["an omitted owner row", () => ownerPostimagesHash([])],
    ["a mutated owner operation", () => ownerPostimagesHash([{ ...ownerRow, plan: { ...owner, operations: owner.operations.slice(1) } }])],
    ["an omitted effect", () => ownerPostimagesHash([{ ...ownerRow, effects: [] }])],
    ["a duplicated migration", () => migrationPostimagesHash([migrationRow, migrationRow])],
    ["a mutated migration", () => migrationPostimagesHash([{ ...migrationRow, plan: { ...migration, toVersion: parsePositiveUInt32(3) } }])],
  ])("changes or refuses on %s", (_name, compute) => {
    const baseline = [ownerPostimagesHash([ownerRow]), migrationPostimagesHash([migrationRow])];
    let result: string | null = null;
    try {
      result = compute();
    } catch {
      result = null;
    }
    expect(baseline).not.toContain(result);
  });

  it("refuses reordered owner rows", () => {
    const claude = { ...ownerRow, plan: { ...owner, owner: "claude" as const } };
    expect(() => ownerPostimagesHash([ownerRow, claude])).toThrow();
  });

  it("keeps a containing digest out of its own projection", () => {
    const projection = { owner: "codex" as const, operations: [{ path: replaced }], externalEffects: [] };
    const withContaining = { ...projection, rollbackBindingHash: sha("binding"), sourceOwnerPlanHash: sha("source") };
    expect(ownerInverseOperationHash(withContaining)).toBe(ownerInverseOperationHash(projection));
    expect(ownerInverseOperationHash({ ...projection, operations: [] })).not.toBe(ownerInverseOperationHash(projection));
    expect(ownerCurrentPartitionHash("codex", [...currentPartition].reverse())).not.toBe(ownerCurrentPartitionHash("codex", currentPartition));
    expect(() => ownerCurrentPartitionHash("claude", currentPartition)).toThrow();
  });

  it.each([
    ["a writable verifier", { readOnly: false }],
    ["a second process", { processCount: 2 }],
    ["a wall deadline over five minutes", { wallMilliseconds: 300_001 }],
    ["a stale owner postimage digest", { ownerPostimagesHash: sha("stale") }],
    ["a stale migration postimage digest", { migrationPostimagesHash: sha("stale") }],
    ["another manifest", { manifestHash: sha("other") }],
  ])("admits only the read-only verifier table, refusing %s", (_name, override) => {
    const release = { version: "1.2.0", releaseSequence: "2" } as unknown as ReleaseIdentityV1;
    const context = { release, manifestHash: sha("manifest"), owners: [ownerRow], migrations: [migrationRow] };
    const plan = {
      schemaVersion: 1, id: parseSafeReasonCode("target_verification"), coordinatorId, release, verifierEntrypoint: "bin/verify.js",
      manifestHash: sha("manifest"), ownerPostimagesHash: ownerPostimagesHash([ownerRow]), migrationPostimagesHash: migrationPostimagesHash([migrationRow]),
      inputBytes: 1024, stdoutBytes: 1024, stderrBytes: 0, idleMilliseconds: 1000, wallMilliseconds: 1000, processCount: 1, readOnly: true,
    };
    expect(validateTargetVerificationPlan(plan, context).readOnly).toBe(true);
    expect(() => validateTargetVerificationPlan({ ...plan, ...override }, context)).toThrow();
  });
});
