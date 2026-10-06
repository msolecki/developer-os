import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { updateLeafPlanPath } from "./construction.js";
import { deriveUpdateSteps, type UpdateExecutionPlanV1, type UpdateStepOwnerV1 } from "./coordinator.js";
import { ownerExternalEffectProcessPolicyHash, type OwnerExternalEffectProcessPolicyV1 } from "./participants.js";
import { parseCanonicalAbsolutePathText } from "./paths.js";
import type { PreparedUpdateCandidateV1, RollbackPayloadEntryV1, RollbackPayloadIdV1 } from "./preview.js";
import type { ReleaseIdentityV1 } from "./release.js";
import {
  advanceRollbackPayloadPublicationJournal,
  advanceRollbackPayloadSourceJournal,
  bindRetainedInversePlan,
  buildRollbackPayload,
  buildRollbackPayloadSourceStagingPlan,
  initialRollbackPayloadPublicationJournal,
  initialRollbackPayloadSourceJournal,
  MAXIMUM_ROLLBACK_DOCUMENT_BYTES,
  retainedInversePlanHash,
  rollbackBindingHash,
  rollbackDocumentBytes,
  rollbackDocumentHash,
  rollbackPayloadRetirementLeaves,
  rollbackPayloadRetirementRef,
  rollbackPayloadSourceCompactionTarget,
  rollbackPayloadSourcePaths,
  rollbackPayloadSourceReadyEvidence,
  rollbackPayloadSourceReadyEvidenceBytes,
  rollbackPayloadSourceStagingPlanRef,
  rollbackPayloadStructures,
  rollbackStepListHash,
  validateBoundedUpdateInversePlan,
  validateRetainedOwnerInverseProjection,
  validateRetainedSchemaMigrationInverseProjection,
  validateRollbackBindingGraph,
  validateRollbackPayloadInventory,
  validateRollbackPayloadPublicationJournal,
  validateRollbackPayloadSourceJournal,
  validateRollbackPayloadSourceReadyEvidence,
  validateRollbackPayloadSourceStagingPlan,
  validateRollbackPayloadStatePlan,
  type PreparedRollbackPayloadV1,
  type RollbackPayloadIdentityV1,
  type RollbackPayloadPublicationJournalV1,
  type RollbackPayloadPublicationStepV1,
  type RollbackPayloadSourceStagingJournalV1,
  type RollbackPayloadSourceStagingPlanV1,
  type RollbackPayloadSourceStepV1,
  type RollbackPayloadStatePlanV1,
} from "./rollback.js";
import { parseLowerHexSha256, parseSafeReasonCode, parseUInt64Decimal, parseUtcTimestamp, type LowerHexSha256 } from "./scalars.js";

const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const canonical = (value: unknown): string => encodeCanonicalJson(value as CanonicalJsonValue);
const u64 = parseUInt64Decimal;
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const later = parseUtcTimestamp("2026-09-23T10:00:01.000Z");
const MiB = 1_048_576;
const coordinatorId = `lc_${"b".repeat(64)}_3` as LifecycleCoordinatorIdV1;
const home = parseCanonicalAbsolutePathText("/synthetic/home/.developer-os");
const stagingRoot = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
const payloadId = `rb_${"c".repeat(64)}_9` as RollbackPayloadIdV1;
const priorPayloadId = `rb_${"c".repeat(64)}_4` as RollbackPayloadIdV1;
const installed = { releaseIdentityHash: sha("installed release") } as ReleaseIdentityV1;
const previous = { releaseIdentityHash: sha("previous release") } as ReleaseIdentityV1;
const OLD = "old owner bytes\n";
const BEFORE = "brain note before migration\n";

const blob = (ordinal: number, content: string): { readonly path: string; readonly bytes: number; readonly sha256: LowerHexSha256 } => ({
  path: `blobs/${String(ordinal).padStart(10, "0")}.bin`,
  bytes: Buffer.byteLength(content),
  sha256: sha(content),
});
const fileState = (content: string, payload: unknown = null): Record<string, unknown> => ({ state: "file", mode: 384, bytes: Buffer.byteLength(content), sha256: sha(content), payload });
const restoreState = (ordinal: number, content: string): Record<string, unknown> => fileState(content, { chunks: [blob(ordinal, content)], aggregateBytes: Buffer.byteLength(content), sha256: sha(content) });

function ownerProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "owner_inverse",
    id: "owner_core",
    owner: "core",
    operations: [
      { path: "/synthetic/home/.developer-os/created.md", expectedCurrent: fileState("created by the update\n"), restore: { state: "absent" } },
      { path: "/synthetic/home/.developer-os/empty.md", expectedCurrent: fileState("now non-empty\n"), restore: fileState("", { chunks: [], aggregateBytes: 0, sha256: sha("") }) },
      { path: "/synthetic/home/.developer-os/replaced.md", expectedCurrent: fileState("new owner bytes\n"), restore: restoreState(0, OLD) },
    ],
    externalEffects: [],
    maximumPlanBytes: 16 * MiB,
    ...overrides,
  };
}

function migrationProjection(id: string, ordinal: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "schema_migration_inverse",
    id,
    domain: "brain",
    fromVersion: ordinal,
    toVersion: ordinal + 1,
    mutations: [{ path: `notes/n${String(ordinal)}.md`, expectedCurrentHash: sha(`after ${id}\n`), restoreHash: sha(BEFORE), restoreBlob: blob(ordinal, BEFORE) }],
    maximumPlanBytes: 16 * MiB,
    ...overrides,
  };
}

interface Leaf {
  readonly kind: "owner_inverse" | "schema_migration_inverse";
  readonly id: string;
  readonly projection: Record<string, unknown>;
}

const LEAVES: readonly Leaf[] = [
  { kind: "owner_inverse", id: "owner_core", projection: ownerProjection() },
  { kind: "schema_migration_inverse", id: "migration_note-links", projection: migrationProjection("migration_note-links", 1) },
];

/** Blob rows first (owner preimage, then migration preimage), then one leaf row per projection. */
function inventoryEntries(leaves: readonly Leaf[]): RollbackPayloadEntryV1[] {
  const entries: RollbackPayloadEntryV1[] = [
    { ordinal: 0, path: blob(0, OLD).path, role: "owner_preimage", bytes: Buffer.byteLength(OLD), sha256: sha(OLD) },
    { ordinal: 1, path: blob(1, BEFORE).path, role: "migration_preimage", bytes: Buffer.byteLength(BEFORE), sha256: sha(BEFORE) },
  ] as RollbackPayloadEntryV1[];
  for (const leaf of leaves) {
    const bytes = canonical(leaf.projection);
    entries.push({ ordinal: entries.length, path: `plans/${leaf.kind}/${leaf.id}.plan.json`, role: "inverse_plan_leaf", bytes: Buffer.byteLength(bytes), sha256: sha(bytes) } as RollbackPayloadEntryV1);
  }
  return entries;
}

/** Only the fields `buildRollbackPayload` reads; the rest of the candidate belongs to Task 14. */
function candidate(leaves: readonly Leaf[] = LEAVES, entries: readonly RollbackPayloadEntryV1[] = inventoryEntries(leaves)): PreparedUpdateCandidateV1 {
  return {
    schemaVersion: 1,
    preview: { current: previous, target: installed },
    materialization: {
      inversePlanProjections: leaves.map((leaf) => ({ kind: leaf.kind, id: leaf.id, projection: canonical(leaf.projection), projectionHash: sha(leaf.id), bytes: Buffer.byteLength(canonical(leaf.projection)) })),
      rollbackInventoryEntries: entries,
      aggregateBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  } as unknown as PreparedUpdateCandidateV1;
}

function allocation(overrides: Record<string, unknown> = {}): Parameters<typeof buildRollbackPayload>[1] {
  return {
    payloadId,
    executionBindingHash: sha("execution binding"),
    installed,
    previous,
    productHome: home,
    sourcePlanHashes: [sha("owner plan"), sha("migration plan")],
    exactStepListHash: rollbackStepListHash([{ participant: "bundle", transition: "verify_previous" }]),
    createdAt: at,
    ...overrides,
  };
}

const payload = (): PreparedRollbackPayloadV1 => buildRollbackPayload(candidate(), allocation());

/** Re-encodes every document so a mutation reaches the semantic check, not the byte check. */
function reencoded(value: PreparedRollbackPayloadV1): PreparedRollbackPayloadV1 {
  return {
    ...value,
    inversePlanBytes: new TextEncoder().encode(canonical(value.inversePlan)),
    inventoryBytes: new TextEncoder().encode(canonical(value.inventory)),
    recordBytes: new TextEncoder().encode(canonical(value.record)),
  };
}

function withInventory(value: PreparedRollbackPayloadV1, entries: readonly RollbackPayloadEntryV1[]): PreparedRollbackPayloadV1 {
  const inventory = { ...value.inventory, entries, aggregateBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) };
  return reencoded({ ...value, inventory });
}

const rollbackPayloadMutations: readonly { readonly name: string; readonly value: () => PreparedRollbackPayloadV1 }[] = [
  { name: "a record binding that is not the independent binding", value: () => reencoded({ ...payload(), record: { ...payload().record, rollbackBindingHash: sha("other binding") } }) },
  { name: "an inventory naming another payload", value: () => reencoded({ ...payload(), inventory: { ...payload().inventory, payloadId: priorPayloadId } }) },
  { name: "an inventory bound to another inverse plan", value: () => reencoded({ ...payload(), inventory: { ...payload().inventory, inversePlanHash: sha("other inverse") } }) },
  { name: "a record naming another inventory", value: () => reencoded({ ...payload(), record: { ...payload().record, payloadInventoryHash: sha("other inventory") } }) },
  { name: "document bytes that are not their value", value: () => ({ ...payload(), inventoryBytes: new TextEncoder().encode(`${canonical(payload().inventory)} `) }) },
  { name: "an inverse plan with swapped release identities", value: () => reencoded({ ...payload(), inversePlan: { ...payload().inversePlan, installedReleaseIdentityHash: previous.releaseIdentityHash, previousReleaseIdentityHash: installed.releaseIdentityHash } }) },
  {
    name: "a tampered retained hash",
    value: () => {
      const value = payload();
      const [owner] = value.inversePlan.ownerPlans;
      const ref = { ...(owner as NonNullable<typeof owner>), retainedHash: sha("tampered") };
      return reencoded({ ...value, inversePlan: { ...value.inversePlan, ownerPlans: [ref] }, leaves: [{ ...(value.leaves[0] as NonNullable<(typeof value.leaves)[0]>), ref }, ...value.leaves.slice(1)] });
    },
  },
  { name: "a leaf file that is not its inventory row", value: () => ({ ...payload(), leaves: payload().leaves.map((leaf, index) => (index === 0 ? { ...leaf, bytes: new TextEncoder().encode(`${new TextDecoder().decode(leaf.bytes)} `) } : leaf)) }) },
  { name: "a missing leaf file", value: () => ({ ...payload(), leaves: payload().leaves.slice(1) }) },
  { name: "an identity with another entry count", value: () => ({ ...payload(), identity: { ...payload().identity, entryCount: 3 } }) },
  { name: "a non-contiguous ordinal", value: () => withInventory(payload(), payload().inventory.entries.map((entry, index) => (index === 3 ? { ...entry, ordinal: 7 } : entry))) },
  { name: "a blob path not derived from its ordinal", value: () => withInventory(payload(), payload().inventory.entries.map((entry, index) => (index === 0 ? { ...entry, path: blob(5, OLD).path } as RollbackPayloadEntryV1 : entry))) },
  { name: "a blob with the wrong role", value: () => withInventory(payload(), payload().inventory.entries.map((entry, index) => (index === 1 ? { ...entry, role: "owner_preimage" } : entry))) },
  {
    name: "an unreferenced blob",
    value: () => {
      const entries = [...payload().inventory.entries];
      entries.push({ ordinal: entries.length, path: blob(entries.length, "extra").path, role: "owner_preimage", bytes: 5, sha256: sha("extra") } as RollbackPayloadEntryV1);
      return withInventory(payload(), entries);
    },
  },
];

describe("rollbackStepListHash pin (NEW-172)", () => {
  /**
   * `update --apply` retains this hash and `update rollback --apply` must reproduce it, possibly
   * from another release. A change to the §10.2 template or its encoding changes it: that is a
   * protocol change every retained rollback set would then refuse, so it must be deliberate.
   */
  it("pins the §10.2 template over two owners, one Codex effect and two migrations", () => {
    const owners: readonly UpdateStepOwnerV1[] = [
      { id: "owner_core", owner: "core", externalEffects: [] },
      { id: "owner_codex", owner: "codex", externalEffects: [{ id: `oe_${"c".repeat(64)}_9` }] },
    ] as unknown as readonly UpdateStepOwnerV1[];
    const execution = {
      operation: "update_rollback",
      owners: [{ id: "owner_core" }, { id: "owner_codex" }],
      migrations: [{ id: "migration_product-v2" }, { id: "migration_brain-v2" }],
    } as unknown as UpdateExecutionPlanV1;

    expect(rollbackStepListHash(deriveUpdateSteps(execution, owners))).toBe("0112c454cb050e0b1aa11ff2e9e8c33a4998f41cf7bcf6afd00990a0b4ab9a48");
  });
});

describe("rollback payload binding graph", () => {
  it("binds inverse plan, inventory, record, and manifest without a hash cycle", () => {
    const built = payload();
    expect(validateRollbackBindingGraph(built)).toBe(true);
    expect(built.record.inversePlanHash).toBe(rollbackDocumentHash(built.inversePlanBytes));
    expect(built.record.payloadInventoryHash).toBe(rollbackDocumentHash(built.inventoryBytes));
    const inverseText = new TextDecoder().decode(built.inversePlanBytes);
    expect(inverseText).not.toContain(built.record.payloadInventoryHash);
    expect(inverseText).not.toContain(rollbackDocumentHash(built.recordBytes));
    // A containing digest cannot move what it contains: a later record changes nothing below it.
    const rebuilt = buildRollbackPayload(candidate(), allocation({ createdAt: later }));
    expect(rebuilt.inversePlanBytes).toStrictEqual(built.inversePlanBytes);
    expect(rebuilt.inventoryBytes).toStrictEqual(built.inventoryBytes);
    expect(rebuilt.recordBytes).not.toStrictEqual(built.recordBytes);
    // The manifest partition is the payload's exact leaf set, not a hash of the record.
    expect(rollbackPayloadRetirementLeaves(built.identity, built.inventory)).toHaveLength(built.inventory.entries.length + 7);
  });

  it.each(rollbackPayloadMutations)("refuses $name", (mutation) => {
    expect(() => validateRollbackBindingGraph(mutation.value())).toThrow();
  });

  it("derives the independent rollback binding from the execution binding, payload, and both releases", () => {
    const built = payload();
    const binding = rollbackBindingHash({ executionBindingHash: sha("execution binding"), payloadId, installedReleaseIdentityHash: installed.releaseIdentityHash, previousReleaseIdentityHash: previous.releaseIdentityHash });
    for (const value of [built.record.rollbackBindingHash, built.inversePlan.rollbackBindingHash, built.inventory.rollbackBindingHash, built.identity.rollbackBindingHash]) expect(value).toBe(binding);
    expect(buildRollbackPayload(candidate(), allocation({ executionBindingHash: sha("other execution") })).identity.rollbackBindingHash).not.toBe(binding);
  });

  it("keeps each retained leaf byte-equal to its prepared projection and binds it through its ref", () => {
    const built = payload();
    built.leaves.forEach((leaf, index) => {
      expect(new TextDecoder().decode(leaf.bytes)).toBe(canonical((LEAVES[index] as Leaf).projection));
      const projection = leaf.ref.kind === "owner_inverse" ? validateRetainedOwnerInverseProjection((LEAVES[index] as Leaf).projection) : validateRetainedSchemaMigrationInverseProjection((LEAVES[index] as Leaf).projection);
      expect(leaf.ref.retainedHash).toBe(retainedInversePlanHash(bindRetainedInversePlan(projection, built.identity.rollbackBindingHash, leaf.ref.sourcePlanHash)));
    });
  });

  it("keeps migration inverse refs in chain order", () => {
    const leaves: readonly Leaf[] = [
      { kind: "owner_inverse", id: "owner_core", projection: ownerProjection() },
      { kind: "schema_migration_inverse", id: "migration_first", projection: migrationProjection("migration_first", 1) },
      { kind: "schema_migration_inverse", id: "migration_second", projection: migrationProjection("migration_second", 2, { mutations: [{ path: "notes/second.md", expectedCurrentHash: sha("after second\n"), restoreHash: sha("second\n"), restoreBlob: blob(2, "second\n") }] }) },
    ];
    const leafRow = (leaf: Leaf, ordinal: number): RollbackPayloadEntryV1 => {
      const bytes = canonical(leaf.projection);
      return { ordinal, path: `plans/${leaf.kind}/${leaf.id}.plan.json`, role: "inverse_plan_leaf", bytes: Buffer.byteLength(bytes), sha256: sha(bytes) } as RollbackPayloadEntryV1;
    };
    const entries: RollbackPayloadEntryV1[] = [
      ...inventoryEntries([]),
      { ordinal: 2, path: blob(2, "second\n").path, role: "migration_preimage", bytes: 7, sha256: sha("second\n") } as RollbackPayloadEntryV1,
      ...leaves.map((leaf, index) => leafRow(leaf, 3 + index)),
    ];
    const built = buildRollbackPayload(candidate(leaves, entries), allocation({ sourcePlanHashes: [sha("owner plan"), sha("first"), sha("second")] }));
    expect(built.inversePlan.migrationPlans.map((ref) => ref.id)).toStrictEqual(["migration_first", "migration_second"]);
  });

  it("refuses migration leaves outside chain order, as compose pairs them with inventory rows by position (NEW-135)", () => {
    const leaves: readonly Leaf[] = [
      { kind: "owner_inverse", id: "owner_core", projection: ownerProjection() },
      { kind: "schema_migration_inverse", id: "migration_second", projection: migrationProjection("migration_second", 2, { mutations: [{ path: "notes/second.md", expectedCurrentHash: sha("after second\n"), restoreHash: sha("second\n"), restoreBlob: blob(2, "second\n") }] }) },
      { kind: "schema_migration_inverse", id: "migration_first", projection: migrationProjection("migration_first", 1) },
    ];
    const entries: RollbackPayloadEntryV1[] = [
      ...inventoryEntries([]),
      { ordinal: 2, path: blob(2, "second\n").path, role: "migration_preimage", bytes: 7, sha256: sha("second\n") } as RollbackPayloadEntryV1,
      ...leaves.map((leaf, index): RollbackPayloadEntryV1 => {
        const bytes = canonical(leaf.projection);
        return { ordinal: 3 + index, path: `plans/${leaf.kind}/${leaf.id}.plan.json`, role: "inverse_plan_leaf", bytes: Buffer.byteLength(bytes), sha256: sha(bytes) } as RollbackPayloadEntryV1;
      }),
    ];
    expect(() => buildRollbackPayload(candidate(leaves, entries), allocation({ sourcePlanHashes: [sha("owner plan"), sha("second"), sha("first")] }))).toThrow("migrationPlans: not chain order");
  });
});

describe("retained inverse plans", () => {
  it("restores a zero-byte file from zero chunks and the empty hash", () => {
    expect(() => validateRetainedOwnerInverseProjection(ownerProjection())).not.toThrow();
    const nonEmptyChunk = ownerProjection({ operations: [{ path: "/synthetic/a", expectedCurrent: fileState("x"), restore: fileState("", { chunks: [blob(0, "")], aggregateBytes: 0, sha256: sha("") }) }] });
    expect(() => validateRetainedOwnerInverseProjection(nonEmptyChunk)).toThrow();
  });

  it("admits one chunk of exactly 16 MiB and refuses the first byte over", () => {
    const restore = (bytes: number): Record<string, unknown> => ({ state: "file", mode: 384, bytes, sha256: sha("big"), payload: { chunks: [{ path: blob(0, "").path, bytes, sha256: sha("big") }], aggregateBytes: bytes, sha256: sha("big") } });
    const restoring = (bytes: number): Record<string, unknown> => ownerProjection({ operations: [{ path: "/synthetic/a", expectedCurrent: { state: "absent" }, restore: restore(bytes) }] });
    expect(() => validateRetainedOwnerInverseProjection(restoring(16 * MiB))).not.toThrow();
    expect(() => validateRetainedOwnerInverseProjection(restoring(16 * MiB + 1))).toThrow();
  });

  it("refuses an operation whose restore equals its expected current state", () => {
    const same = ownerProjection({ operations: [{ path: "/synthetic/a", expectedCurrent: { state: "absent" }, restore: { state: "absent" } }] });
    const sameFile = ownerProjection({ operations: [{ path: "/synthetic/a", expectedCurrent: fileState(OLD), restore: restoreState(0, OLD) }] });
    expect(() => validateRetainedOwnerInverseProjection(same)).toThrow();
    expect(() => validateRetainedOwnerInverseProjection(sameFile)).toThrow();
  });

  it("refuses an expected-current payload and an out-of-order operation", () => {
    expect(() => validateRetainedOwnerInverseProjection(ownerProjection({ operations: [{ path: "/synthetic/a", expectedCurrent: restoreState(0, OLD), restore: { state: "absent" } }] }))).toThrow();
    const operations = (ownerProjection().operations as readonly unknown[]).slice().reverse();
    expect(() => validateRetainedOwnerInverseProjection(ownerProjection({ operations }))).toThrow();
  });

  it("carries the Codex effect inverse as state hashes and a hashed policy, never payloads", () => {
    const policy = {
      kind: "codex_registration_refresh",
      providerProtocol: 1,
      executable: "pinned_codex_cli",
      executableIdentity: { dev: "1", ino: "2", mode: 493, sha256: sha("codex") },
      argv: [{ kind: "literal", value: "plugin" }, { kind: "token", value: "plugin_id" }],
      cwd: "managed_plugin_root",
      environment: [{ name: "CODEX_HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }],
      stdin: "closed",
      network: false,
      model: false,
      stdoutBytes: 1024,
      stderrBytes: 1024,
      wallMilliseconds: 1000,
      idleMilliseconds: 1000,
      processCount: 1,
    } as unknown as OwnerExternalEffectProcessPolicyV1;
    const effect = { kind: "codex_registration_refresh", providerProtocol: 1, expectedCurrentStateHash: sha("refreshed"), restoreStateHash: sha("before"), restorePayloads: [], processPolicy: policy, processPolicyHash: ownerExternalEffectProcessPolicyHash(policy) };
    const codex = (overrides: Record<string, unknown>): Record<string, unknown> => ownerProjection({ id: "owner_codex", owner: "codex", externalEffects: [{ ...effect, ...overrides }] });
    expect(() => validateRetainedOwnerInverseProjection(codex({}))).not.toThrow();
    expect(() => validateRetainedOwnerInverseProjection(codex({ restorePayloads: [blob(0, OLD)] }))).toThrow();
    expect(() => validateRetainedOwnerInverseProjection(codex({ processPolicyHash: sha("other policy") }))).toThrow();
    expect(() => validateRetainedOwnerInverseProjection(ownerProjection({ externalEffects: [effect] }))).toThrow();
  });

  it("refuses a migration inverse whose blob does not restore its hash or repeats a path", () => {
    expect(() => validateRetainedSchemaMigrationInverseProjection(migrationProjection("migration_a", 1, { mutations: [{ path: "notes/a.md", expectedCurrentHash: sha("after"), restoreHash: sha("before"), restoreBlob: blob(1, "other") }] }))).toThrow();
    const mutation = (migrationProjection("migration_a", 1).mutations as readonly unknown[])[0];
    expect(() => validateRetainedSchemaMigrationInverseProjection(migrationProjection("migration_a", 1, { mutations: [mutation, mutation] }))).toThrow();
    expect(() => validateRetainedSchemaMigrationInverseProjection(migrationProjection("migration_a", 3, { toVersion: 3 }))).toThrow();
  });

  it("refuses an inverse plan whose ref path is not derived from its id", () => {
    const plan = payload().inversePlan;
    const [owner] = plan.ownerPlans;
    expect(() => validateBoundedUpdateInversePlan({ ...plan, ownerPlans: [{ ...(owner as NonNullable<typeof owner>), path: "plans/owner_inverse/other.plan.json" }] })).toThrow();
    expect(() => validateBoundedUpdateInversePlan({ ...plan, ownerPlans: [] })).toThrow();
  });
});

describe("rollback payload inventory bounds", () => {
  const inventory = (entries: readonly unknown[], aggregateBytes: number): Record<string, unknown> => ({ schemaVersion: 1, payloadId, rollbackBindingHash: sha("binding"), inversePlanHash: sha("inverse"), entries, aggregateBytes });
  const blobEntry = (ordinal: number, bytes: number): Record<string, unknown> => ({ ordinal, path: `blobs/${String(ordinal).padStart(10, "0")}.bin`, role: "owner_preimage", bytes, sha256: sha("x") });

  it("admits exactly 2 GiB of retained bytes and refuses the first byte over", () => {
    const full = Array.from({ length: 128 }, (_, ordinal) => blobEntry(ordinal, 16 * MiB));
    expect(() => validateRollbackPayloadInventory(inventory(full, 2_147_483_648))).not.toThrow();
    const over = [...full, blobEntry(128, 1)];
    expect(() => validateRollbackPayloadInventory(inventory(over, 2_147_483_649))).toThrow();
  });

  it("admits the byte-feasible maximum entry count and refuses the first entry over the 64-MiB cap (A6)", () => {
    // Derived, not declared: the declared 1,000,000 entries cannot fit a 64-MiB inventory.
    const empty = canonical(inventory([], 0)).length;
    let total = empty;
    let count = 0;
    for (;;) {
      const next = canonical(blobEntry(count, 0)).length - 1 + (count === 0 ? 0 : 1);
      if (total + next > MAXIMUM_ROLLBACK_DOCUMENT_BYTES) break;
      total += next;
      count += 1;
    }
    expect(count).toBeLessThan(1_000_000);
    const maximum = Array.from({ length: count }, (_, ordinal) => blobEntry(ordinal, 0));
    expect(() => validateRollbackPayloadInventory(inventory(maximum, 0))).not.toThrow();
    expect(() => validateRollbackPayloadInventory(inventory([...maximum, blobEntry(count, 0)], 0))).toThrow();
  }, 120_000);
});

describe("retirement inventory", () => {
  it("removes entries in reverse, then the inverse plan, the inventory, and the five directories deepest-first", () => {
    const built = payload();
    const leaves = rollbackPayloadRetirementLeaves(built.identity, built.inventory);
    const root = built.identity.root;
    expect(leaves.map((leaf) => leaf.path.slice(root.length))).toStrictEqual([
      ...[...built.inventory.entries].reverse().map((entry) => `/${entry.path}`),
      "/inverse-plan.json",
      "/inventory.json",
      "/blobs",
      "/plans/schema_migration_inverse",
      "/plans/owner_inverse",
      "/plans",
      "",
    ]);
    expect(rollbackPayloadRetirementRef(built.identity, built.inventory)).toStrictEqual({ kind: "rollback_payload", root, inventoryHash: built.identity.inventoryHash, leafCount: built.inventory.entries.length + 7 });
  });

  it("refuses an inventory that is not its identity's", () => {
    const built = payload();
    expect(() => rollbackPayloadRetirementLeaves({ ...built.identity, inventoryHash: sha("other") }, built.inventory)).toThrow();
  });
});

function sourcePlan(): RollbackPayloadSourceStagingPlanV1 {
  return buildRollbackPayloadSourceStagingPlan({
    id: parseSafeReasonCode("rollback_source"),
    coordinatorId,
    stagingRoot,
    payload: payload(),
    entriesProjectionHash: sha("entries projection"),
  });
}

function walkSource(plan: RollbackPayloadSourceStagingPlanV1, steps: readonly RollbackPayloadSourceStepV1[]): RollbackPayloadSourceStagingJournalV1 {
  return steps.reduce((journal, step) => advanceRollbackPayloadSourceJournal(plan, journal, step, later), initialRollbackPayloadSourceJournal(plan, at));
}

const identity = (value: number): { readonly dev: ReturnType<typeof u64>; readonly ino: ReturnType<typeof u64> } => ({ dev: u64("1"), ino: u64(String(value)) });

function sourceStepsThroughEntries(plan: RollbackPayloadSourceStagingPlanV1): RollbackPayloadSourceStepV1[] {
  const steps: RollbackPayloadSourceStepV1[] = [];
  for (let ordinal = 0; ordinal < 7; ordinal += 1) steps.push({ kind: "structure_intent" }, { kind: "structure_created", ...identity(100 + ordinal) }, { kind: "structure_complete" });
  for (let ordinal = 0; ordinal < 2; ordinal += 1) steps.push({ kind: "metadata_intent" }, { kind: "metadata_created", ...identity(200 + ordinal) }, { kind: "metadata_complete" });
  for (let ordinal = 0; ordinal < plan.entryCount; ordinal += 1) {
    steps.push({ kind: "entry_intent" }, { kind: "entry_created", ...identity(300 + ordinal) }, { kind: "evidence_intent" }, { kind: "evidence_created", ...identity(400 + ordinal) }, { kind: "entry_complete" });
  }
  return steps;
}

describe("rollback payload source staging", () => {
  it("derives the exact source paths and binds the two documents to the inverse plan and inventory", () => {
    const plan = sourcePlan();
    const paths = rollbackPayloadSourcePaths(stagingRoot, payloadId);
    expect(plan.sourceRoot).toBe(paths.sourceRoot);
    expect(paths.ready).toBe(`${stagingRoot}/update/source/rollback/${payloadId}.ready.json`);
    expect(plan.metadata.map((row) => [row.role, row.path.slice(plan.sourceRoot.length), row.sha256])).toStrictEqual([
      ["inverse_plan", "/inverse-plan.json", payload().identity.inversePlanHash],
      ["inventory", "/inventory.json", payload().identity.inventoryHash],
    ]);
    expect(() => buildRollbackPayloadSourceStagingPlan({ id: parseSafeReasonCode("rollback_source"), coordinatorId, stagingRoot: parseCanonicalAbsolutePathText("/elsewhere"), payload: payload(), entriesProjectionHash: sha("x") })).toThrow();
  });

  it("refuses the withdrawn parent identity fields as unknown keys (P1)", () => {
    expect(() => validateRollbackPayloadSourceStagingPlan({ ...sourcePlan(), sourceParentDev: u64("10") }, stagingRoot)).toThrow(/keys/u);
    expect(() => validateRollbackPayloadSourceStagingPlan({ ...sourcePlan(), sourceParentDev: u64("10"), sourceParentIno: u64("20") }, stagingRoot)).toThrow(/keys/u);
  });

  it("walks structures, metadata, entries, and ready in order, then compacts the exact flattened set", () => {
    const plan = sourcePlan();
    const staged = walkSource(plan, sourceStepsThroughEntries(plan));
    expect(staged.phase).toBe("payload_staging");
    expect(staged.structureIdentities.map((row) => row.role)).toStrictEqual(["source_envelope", "source_payload_root", "source_evidence_root", "plans_root", "owner_inverse_plans_root", "schema_migration_inverse_plans_root", "blobs_root"]);
    expect(staged.metadataIdentities.map((row) => row.role)).toStrictEqual(["inverse_plan", "inventory"]);
    const ready = [{ kind: "ready_intent" }, { kind: "ready_created", ...identity(500) }, { kind: "ready_complete" }] as const;
    const sourceReady = ready.reduce((journal, step) => advanceRollbackPayloadSourceJournal(plan, journal, step, later), staged);
    expect(sourceReady.phase).toBe("source_ready");
    const evidence = rollbackPayloadSourceReadyEvidence(plan, sourceReady, sha("evidence set"));
    expect(validateRollbackPayloadSourceReadyEvidence(rollbackPayloadSourceReadyEvidenceBytes(evidence), plan, sourceReady, sha("evidence set"))).toStrictEqual(evidence);
    expect(() => validateRollbackPayloadSourceReadyEvidence(rollbackPayloadSourceReadyEvidenceBytes(evidence), plan, sourceReady, sha("other set"))).toThrow();

    const last = 2 * plan.entryCount + 10;
    const targets = Array.from({ length: last }, (_, cursor) => rollbackPayloadSourceCompactionTarget(plan, cursor));
    expect(targets[0]).toStrictEqual({ kind: "ready" });
    expect(targets.slice(1, 3)).toStrictEqual([{ kind: "entry", ordinal: plan.entryCount - 1 }, { kind: "evidence", ordinal: plan.entryCount - 1 }]);
    expect(targets.slice(2 * plan.entryCount + 1, 2 * plan.entryCount + 3)).toStrictEqual([{ kind: "metadata", ordinal: 1 }, { kind: "metadata", ordinal: 0 }]);
    expect(targets.at(-1)).toStrictEqual({ kind: "structure", ordinal: 0 });
    let journal = advanceRollbackPayloadSourceJournal(plan, sourceReady, { kind: "compaction_step" }, later);
    for (let cursor = 0; cursor < last; cursor += 1) journal = advanceRollbackPayloadSourceJournal(plan, journal, { kind: "compaction_step" }, later);
    expect(journal.compactionNext).toBe(last);
    expect(() => advanceRollbackPayloadSourceJournal(plan, journal, { kind: "compaction_step" }, later)).toThrow();
  });

  it("refuses an entry before both documents and a ready before every entry", () => {
    const plan = sourcePlan();
    const structures = sourceStepsThroughEntries(plan).slice(0, 21);
    expect(() => walkSource(plan, [...structures, { kind: "entry_intent" }])).toThrow();
    const partial = sourceStepsThroughEntries(plan).slice(0, 21 + 6 + 5);
    expect(() => walkSource(plan, [...partial, { kind: "ready_intent" }])).toThrow();
  });

  it("compensates the reached prefix: entry then evidence in reverse, then metadata, then structures", () => {
    const plan = sourcePlan();
    const reached = walkSource(plan, [...sourceStepsThroughEntries(plan).slice(0, 21 + 6 + 5), { kind: "entry_intent" }, { kind: "entry_created", ...identity(900) }]);
    let journal = advanceRollbackPayloadSourceJournal(plan, reached, { kind: "compensate" }, later);
    const walk: string[] = [];
    while (journal.phase === "compensating") {
      if ((journal.compensationNext as number) >= 0) walk.push(`${journal.compensationPart as string}:${String(journal.compensationNext)}`);
      else if ((journal.compensationMetadataNext as number) >= 0) walk.push(`metadata:${String(journal.compensationMetadataNext)}`);
      else if ((journal.compensationStructureNext as number) >= 0) walk.push(`structure:${String(journal.compensationStructureNext)}`);
      journal = advanceRollbackPayloadSourceJournal(plan, journal, { kind: "compensation_step" }, later);
    }
    expect(journal.phase).toBe("rolled_back");
    expect(walk).toStrictEqual(["entry:1", "evidence:1", "entry:0", "evidence:0", "metadata:1", "metadata:0", ...[6, 5, 4, 3, 2, 1, 0].map((ordinal) => `structure:${String(ordinal)}`)]);
    expect(() => validateRollbackPayloadSourceJournal({ ...journal, compensationMetadataNext: 0 }, plan)).toThrow();
  });
});

function statePlan(overrides: Partial<Record<keyof RollbackPayloadStatePlanV1, unknown>> = {}): RollbackPayloadStatePlanV1 {
  const built = payload();
  return validateRollbackPayloadStatePlan({
    schemaVersion: 1,
    id: "rollback_payload",
    coordinatorId,
    retainedBefore: null,
    publish: built.identity,
    source: { stagingPlan: rollbackPayloadSourceStagingPlanRef(sourcePlan(), stagingRoot), readyEvidencePath: rollbackPayloadSourcePaths(stagingRoot, payloadId).ready },
    retainAfter: built.identity,
    retireAtTerminal: [],
    publicationInventoryHash: built.identity.inventoryHash,
    maximumPlanBytes: 16 * MiB,
    maximumJournalBytes: MiB,
    ...overrides,
  }, stagingRoot);
}

const retained: RollbackPayloadIdentityV1 = { ...payload().identity, payloadId: priorPayloadId, root: parseCanonicalAbsolutePathText(`${home}/rollback/${priorPayloadId}`) };

function verifyOnlyPlan(): RollbackPayloadStatePlanV1 {
  return statePlan({ retainedBefore: retained, publish: null, source: null, retainAfter: null, retireAtTerminal: [retained], publicationInventoryHash: null });
}

function walkPublication(plan: RollbackPayloadStatePlanV1, steps: readonly RollbackPayloadPublicationStepV1[]): RollbackPayloadPublicationJournalV1 {
  return steps.reduce((journal, step) => advanceRollbackPayloadPublicationJournal(plan, journal, step, later), initialRollbackPayloadPublicationJournal(plan, at));
}

function publicationSteps(plan: RollbackPayloadStatePlanV1): RollbackPayloadPublicationStepV1[] {
  const steps: RollbackPayloadPublicationStepV1[] = [];
  for (let ordinal = 0; ordinal < 5; ordinal += 1) steps.push({ kind: "structure_intent" }, { kind: "structure_created", ...identity(600 + ordinal) }, { kind: "structure_complete" });
  for (let ordinal = 0; ordinal < (plan.publish?.entryCount ?? 0); ordinal += 1) {
    steps.push({ kind: "entry_intent" }, { kind: "entry_created", ...identity(700 + ordinal) }, { kind: "evidence_intent" }, { kind: "evidence_created", ...identity(800 + ordinal) }, { kind: "entry_complete" });
  }
  for (let ordinal = 0; ordinal < 2; ordinal += 1) steps.push({ kind: "metadata_intent" }, { kind: "metadata_published", ...identity(900 + ordinal) }, { kind: "metadata_complete" });
  return steps;
}

describe("rollback payload publication", () => {
  it("publishes the five fixed structures, every entry, then the inverse plan and inventory", () => {
    const plan = statePlan();
    const journal = walkPublication(plan, publicationSteps(plan));
    expect(journal.phase).toBe("verified");
    expect(journal.structureIdentities.map((row) => [row.role, row.path])).toStrictEqual(rollbackPayloadStructures(payload().identity.root).map((row) => [row.role, row.path]));
    expect(journal.metadataIdentities.map((row) => row.ordinal)).toStrictEqual([0, 1]);
    let compacted = advanceRollbackPayloadPublicationJournal(plan, advanceRollbackPayloadPublicationJournal(plan, journal, { kind: "finalize" }, later), { kind: "compaction_step" }, later);
    for (let cursor = 0; cursor < (plan.publish?.entryCount ?? 0); cursor += 1) compacted = advanceRollbackPayloadPublicationJournal(plan, compacted, { kind: "compaction_step" }, later);
    expect(compacted.compactionNext).toBe(plan.publish?.entryCount);
    expect(() => advanceRollbackPayloadPublicationJournal(plan, compacted, { kind: "compaction_step" }, later)).toThrow();
  });

  it("refuses a published payload that is not the retained-after payload or whose source path moved", () => {
    expect(() => statePlan({ retainAfter: null })).toThrow();
    expect(() => statePlan({ publicationInventoryHash: sha("other") })).toThrow();
    expect(() => statePlan({ source: { stagingPlan: rollbackPayloadSourceStagingPlanRef(sourcePlan(), stagingRoot), readyEvidencePath: `${stagingRoot}/elsewhere.json` } })).toThrow();
    expect(() => statePlan({ retainedBefore: retained, retireAtTerminal: [] })).toThrow();
    expect(() => statePlan({ source: { stagingPlan: { ...rollbackPayloadSourceStagingPlanRef(sourcePlan(), stagingRoot), path: updateLeafPlanPath(stagingRoot, "bundle_source_staging", parseSafeReasonCode("rollback_source")) }, readyEvidencePath: rollbackPayloadSourcePaths(stagingRoot, payloadId).ready } })).toThrow();
  });

  it("compensates metadata, then entry evidence and entries, then structures in exact reverse", () => {
    const plan = statePlan();
    const steps = publicationSteps(plan);
    const reached = walkPublication(plan, [...steps.slice(0, -3), { kind: "metadata_intent" }, { kind: "metadata_published", ...identity(999) }]);
    let journal = advanceRollbackPayloadPublicationJournal(plan, reached, { kind: "compensate" }, later);
    const walk: string[] = [];
    while (journal.phase.startsWith("compensating_")) {
      if (journal.phase === "compensating_metadata" && (journal.compensationMetadataNext as number) >= 0) walk.push(`metadata:${String(journal.compensationMetadataNext)}`);
      if (journal.phase === "compensating_entries" && (journal.compensationNext as number) >= 0) walk.push(`${journal.compensationPart as string}:${String(journal.compensationNext)}`);
      if (journal.phase === "compensating_structure" && (journal.compensationStructureNext as number) >= 0) walk.push(`structure:${String(journal.compensationStructureNext)}`);
      journal = advanceRollbackPayloadPublicationJournal(plan, journal, { kind: "compensation_step" }, later);
    }
    expect(journal.phase).toBe("rolled_back");
    const entries = Array.from({ length: plan.publish?.entryCount ?? 0 }, (_, index) => (plan.publish?.entryCount ?? 0) - 1 - index).flatMap((ordinal) => [`entry:${String(ordinal)}`, `evidence:${String(ordinal)}`]);
    expect(walk).toStrictEqual(["metadata:1", "metadata:0", ...entries, "structure:4", "structure:3", "structure:2", "structure:1", "structure:0"]);
  });

  it("verifies a retained payload only through the explicit verify-only arm, with every forward cursor zero", () => {
    const plan = verifyOnlyPlan();
    expect(() => walkPublication(plan, [{ kind: "structure_intent" }])).toThrow();
    const verified = walkPublication(plan, [{ kind: "retained_verified" }]);
    expect(verified).toMatchObject({ phase: "verified", nextStructure: 0, nextEntry: 0, nextMetadata: 0, compensationNext: null });
    expect(walkPublication(plan, [{ kind: "compensate" }]).phase).toBe("rolled_back");
    const finalized = advanceRollbackPayloadPublicationJournal(plan, verified, { kind: "finalize" }, later);
    const compacting = advanceRollbackPayloadPublicationJournal(plan, finalized, { kind: "compaction_step" }, later);
    expect(compacting).toMatchObject({ phase: "compacting", compactionNext: 0 });
    expect(() => advanceRollbackPayloadPublicationJournal(plan, compacting, { kind: "compaction_step" }, later)).toThrow();
    expect(() => validateRollbackPayloadPublicationJournal({ ...verified, nextStructure: 1 }, plan)).toThrow();
  });

  it("refuses a verify-only plan that publishes, retains, or retires anything else", () => {
    expect(() => statePlan({ retainedBefore: retained, publish: null, source: null, retainAfter: retained, retireAtTerminal: [retained], publicationInventoryHash: null })).toThrow();
    expect(() => statePlan({ retainedBefore: null, publish: null, source: null, retainAfter: null, retireAtTerminal: [], publicationInventoryHash: null })).toThrow();
  });
});

describe("rollback documents", () => {
  it("encodes each document canonically with one LF under 64 MiB", () => {
    const built = payload();
    for (const value of [built.record, built.inversePlan, built.inventory]) {
      const bytes = rollbackDocumentBytes(value);
      expect(new TextDecoder().decode(bytes).endsWith("}\n")).toBe(true);
    }
  });
});
