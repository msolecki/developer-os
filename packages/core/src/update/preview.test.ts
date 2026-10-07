import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, hashCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { UpdateCapacityInsufficientError, type UpdateCapacityInputV1 } from "./capacity.js";
import {
  admitCanonicalAbsolutePath,
  admitRollbackPayloadRelativePath,
  parseCanonicalAbsolutePathText,
  parseVaultRelativePathText,
  type CanonicalPathEvidenceV1,
  type CanonicalProductStatePathV1,
} from "./paths.js";
import {
  buildPreparedUpdateCandidate,
  buildPreparedUpdateMaterialization,
  buildRollbackPreview,
  buildUpdatePreview,
  parseRollbackPayloadId,
  previewHash,
  type OwnerUpdatePreviewInputV1,
  type PlannerTranscriptIdentityV1,
  type PreparedUpdateMaterializationInputV1,
  type RollbackPayloadEntryV1,
  type RollbackPreviewInputV1,
  type SchemaMigrationPreviewV1,
  type UpdatePreviewInputV1,
} from "./preview.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, parsePositiveUInt32, parseSafeReasonCode, parseSchemaMigrationId, parseUInt64Decimal } from "./scalars.js";

const hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const sha = (value: string) => parseLowerHexSha256(hex(value));
const u = parseUInt64Decimal;
const p = parseCanonicalAbsolutePathText;
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};
const rollbackRoot = admitCanonicalAbsolutePath("/product/rollback/payload", evidence);
const payloadPath = (value: string) => admitRollbackPayloadRelativePath(value, rollbackRoot, evidence);
const payloadId = parseRollbackPayloadId(`rb_${hex("nonce")}_7`);

function release(version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: hex(`identity-${version}`),
    delegationSequence: "1", delegationHash: hex("delegation"), releaseIndexSequence: sequence, releaseIndexHash: hex(`index-${sequence}`),
    bundleManifestHash: hex(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
  }, evidence);
}

const bounds = {
  requestJsonBytes: 268_435_456, resultJsonBytes: 268_435_456, inputBlobCount: 1_000_000, outputBlobCount: 1_000_000,
  inputBlobBytes: 1_073_741_824, outputBlobBytes: 1_073_741_824, stdinWireBytes: 1_351_177_306, stdoutWireBytes: 1_351_177_306,
  stderrBytes: 1_048_576, residentBytes: 536_870_912, idleMilliseconds: 30_000, wallMilliseconds: 600_000, processCount: 1 as const,
};
const transcript: PlannerTranscriptIdentityV1 = {
  protocol: parsePositiveUInt32(1), bounds,
  requestHash: sha("request"), inputBlobsHash: sha("input-blobs"), resultHash: sha("result"), outputBlobsHash: sha("output-blobs"),
};

function owner(name: OwnerUpdatePreviewInputV1["owner"], root: string): OwnerUpdatePreviewInputV1 {
  const create = [p(`${root}/z-new`), p(`${root}/a-new`)];
  const replace = [p(`${root}/é-accent`), p(`${root}/B-upper`)];
  const remove = [p(`${root}/old`)];
  const unchanged = [p(`${root}/keep-2`), p(`${root}/keep-1`)];
  return { owner: name, paths: { create, replace, remove, unchanged }, externalEffects: 0 };
}

function migration(id: string, domain: SchemaMigrationPreviewV1["domain"], from: number, to: number, paths: readonly string[]): SchemaMigrationPreviewV1 {
  const parse = domain === "brain" ? parseVaultRelativePathText : parseCanonicalAbsolutePathText;
  return {
    id: parseSchemaMigrationId(id), domain, fromVersion: parsePositiveUInt32(from), toVersion: parsePositiveUInt32(to),
    affectedPaths: paths.map((path) => parse(path) as CanonicalProductStatePathV1),
  };
}

function capacity(operation: UpdateCapacityInputV1["operation"] = "update"): UpdateCapacityInputV1 {
  return {
    operation,
    components: [
      { kind: "active", bytes: u("100"), entries: u("10") },
      { kind: "transaction_staging", bytes: u("10"), entries: u("2") },
      { kind: "journals", bytes: u("0"), entries: u("1") },
    ],
    reservationGranularityBytes: u("4096"),
    availableBytes: u("1000000"),
    availableEntries: u("1000"),
  };
}

function updateInput(): UpdatePreviewInputV1 {
  return {
    current: release("1.0.0", "1"),
    target: release("2.0.0", "2"),
    metadata: { delegationSequence: u("1"), delegationHash: sha("delegation"), delegatedReleaseKeyId: sha("key"), releaseIndexSequence: u("2"), releaseIndexHash: sha("index-2") },
    packageSource: { kegPath: parseCanonicalAbsolutePathText("/prefix/Cellar/developer-os/2.0.0"), bundleManifestHash: sha("manifest-2.0.0") },
    owners: [owner("core", "/product/core"), owner("codex", "/home/.codex"), owner("claude", "/home/.claude")],
    migrations: [
      migration("migration_brain-v2", "brain", 1, 2, ["notes/b.md", "notes/a.md"]),
      migration("migration_state-v3", "product_state", 2, 3, ["/product/state/config.json"]),
      migration("migration_brain-v3", "brain", 2, 3, ["notes/a.md"]),
    ],
    planner: transcript,
    retainedRollback: { release: release("0.9.0", "0"), payload: { payloadId, entryCount: 2, aggregateBytes: 64 } },
    capacity: capacity(),
  };
}

function reverseOwner(input: OwnerUpdatePreviewInputV1): OwnerUpdatePreviewInputV1 {
  return {
    ...input,
    paths: {
      create: [...input.paths.create].reverse(),
      replace: [...input.paths.replace].reverse(),
      remove: [...input.paths.remove].reverse(),
      unchanged: [...input.paths.unchanged].reverse(),
    },
  };
}

function reverseInput(input: UpdatePreviewInputV1): UpdatePreviewInputV1 {
  return {
    ...input,
    owners: [...input.owners].reverse().map(reverseOwner),
    migrations: [...input.migrations].reverse().map((entry) => ({ ...entry, affectedPaths: [...entry.affectedPaths].reverse() })),
    capacity: { ...input.capacity, components: [...input.capacity.components].reverse() },
  };
}

function rollbackInput(): RollbackPreviewInputV1 {
  const input = updateInput();
  return {
    current: input.target,
    target: input.current,
    owners: input.owners,
    migrations: input.migrations,
    payload: { payloadId, entryCount: 2, aggregateBytes: 64 },
    capacity: capacity("rollback"),
  };
}

function materializationInput(): PreparedUpdateMaterializationInputV1 {
  const entries: RollbackPayloadEntryV1[] = [
    { ordinal: 0, path: payloadPath("blobs/0000000000.bin"), role: "owner_preimage", bytes: 10, sha256: sha("preimage") },
    { ordinal: 1, path: payloadPath("plans/owner_inverse/core.plan.json"), role: "inverse_plan_leaf", bytes: 20, sha256: sha("leaf-core") },
    { ordinal: 2, path: payloadPath("plans/schema_migration_inverse/migration_brain-v2.plan.json"), role: "inverse_plan_leaf", bytes: 30, sha256: sha("leaf-migration") },
  ];
  return {
    targetDraft: { owners: ["core"], version: "2.0.0" },
    concreteManifest: { artifacts: [], schemaVersion: 2 },
    outputBlobs: [{ ordinal: 0, bytes: 5, sha256: sha("blob-0") }, { ordinal: 1, bytes: 0, sha256: sha("") }],
    inverseLeaves: [
      { kind: "schema_migration_inverse", id: parseSchemaMigrationId("migration_brain-v2"), projection: { domain: "brain", fromVersion: 1, steps: ["inverse"] } },
      { kind: "owner_inverse", id: parseSafeReasonCode("core"), projection: { owner: "core", paths: ["/product/core/a-new"] } },
    ],
    inversePlan: { leaves: 2, operation: "update_inverse" },
    rollbackInventoryEntries: entries,
  };
}

function noLineFeedHash(domain: string, value: CanonicalJsonValue): string {
  return createHash("sha256").update(`${domain}\0`, "ascii").update(encodeCanonicalJson(value).slice(0, -1), "utf8").digest("hex");
}

describe("update preview", () => {
  it("renders identical previews under reversed provider input", () => {
    expect(buildUpdatePreview(updateInput())).toEqual(buildUpdatePreview(reverseInput(updateInput())));
    expect(encodeCanonicalJson(buildUpdatePreview(updateInput()) as never)).toBe(encodeCanonicalJson(buildUpdatePreview(reverseInput(updateInput())) as never));
  });

  it("partitions owner paths in canonical owner order, sorted by UTF-8 bytes, with counts equal to lengths", () => {
    const preview = buildUpdatePreview(updateInput());
    expect(preview.owners.map((entry) => entry.owner)).toEqual(["core", "claude", "codex"]);
    const core = preview.owners[0];
    expect(core?.paths).toEqual({
      create: ["/product/core/a-new", "/product/core/z-new"],
      replace: ["/product/core/B-upper", "/product/core/é-accent"],
      remove: ["/product/core/old"],
      unchanged: ["/product/core/keep-1", "/product/core/keep-2"],
    });
    expect(core?.counts).toEqual({ create: 2, replace: 2, remove: 1, unchanged: 2, externalEffects: 0 });
  });

  it("refuses overlapping (W2-BUNDLE-3), duplicate, or repeated owner paths", () => {
    const base = owner("core", "/product/core");
    const overlapping = { ...base, paths: { ...base.paths, unchanged: [...base.paths.unchanged, p("/product/core/old")] } };
    const repeated = { ...base, paths: { ...base.paths, remove: [p("/product/core/old"), p("/product/core/old")] } };
    for (const bad of [overlapping, repeated]) {
      expect(() => buildUpdatePreview({ ...updateInput(), owners: [bad] })).toThrow();
    }
    expect(() => buildUpdatePreview({ ...updateInput(), owners: [base, base] })).toThrow("duplicate owner");
    expect(() => buildUpdatePreview({ ...updateInput(), owners: [] })).toThrow();
  });

  it("orders migrations product_state first, as execution does (W2-BUNDLE-1), then by contiguous chain, with domain-appropriate affected paths", () => {
    const preview = buildUpdatePreview(updateInput());
    expect(preview.migrations.map((entry) => entry.id)).toEqual(["migration_state-v3", "migration_brain-v2", "migration_brain-v3"]);
    expect(preview.migrations[1]?.affectedPaths).toEqual(["notes/a.md", "notes/b.md"]);
    const bad = (entry: SchemaMigrationPreviewV1) => () => buildUpdatePreview({ ...updateInput(), migrations: [entry] });
    expect(bad({ ...migration("migration_brain-v2", "brain", 1, 2, ["notes/a.md"]), affectedPaths: [p("/vault/notes/a.md") as never] })).toThrow();
    expect(bad({ ...migration("migration_state-v3", "product_state", 2, 3, ["/product/state/x"]), affectedPaths: [parseVaultRelativePathText("state/x") as never] })).toThrow();
    expect(bad(migration("migration_brain-v2", "brain", 2, 2, ["notes/a.md"]))).toThrow("version order");
    expect(bad({ ...migration("migration_brain-v2", "brain", 1, 2, ["notes/a.md"]), affectedPaths: [] })).toThrow();
    const gap = [migration("migration_brain-v2", "brain", 1, 2, ["notes/a.md"]), migration("migration_brain-v4", "brain", 3, 4, ["notes/a.md"])];
    expect(() => buildUpdatePreview({ ...updateInput(), migrations: gap })).toThrow("not contiguous");
    const duplicate = [migration("migration_brain-v2", "brain", 1, 2, ["notes/a.md"]), migration("migration_brain-v2", "brain", 2, 3, ["notes/a.md"])];
    expect(() => buildUpdatePreview({ ...updateInput(), migrations: duplicate })).toThrow("duplicate id");
  });

  it("keeps exact branded paths in the canonical JSON and never a rendered projection", () => {
    const preview = buildUpdatePreview(updateInput());
    const canonical = encodeCanonicalJson(preview as never);
    expect(canonical).toContain('"/product/core/é-accent"');
    expect(Object.keys(preview).sort()).toEqual([
      "capacity", "current", "metadata", "migrations", "operation", "owners", "packageSource", "planner", "previewHash", "retainedRollback", "schemaVersion", "target",
    ]);
  });

  it("hashes the domain-separated canonical preview with its own hash omitted", () => {
    const preview = buildUpdatePreview(updateInput());
    const { previewHash: stored, ...rest } = preview;
    expect(stored).toBe(hashCanonicalJson("developer-os/update-preview/v1", rest as never));
    expect(stored).toBe(createHash("sha256").update("developer-os/update-preview/v1\0", "ascii").update(encodeCanonicalJson(rest as never), "utf8").digest("hex"));
    expect(previewHash({ ...preview, previewHash: sha("anything else") })).toBe(stored);
    const changed = updateInput();
    const moved = { ...changed, owners: [{ ...owner("core", "/product/core"), externalEffects: 1 as const }] };
    expect(buildUpdatePreview(moved).previewHash).not.toBe(buildUpdatePreview({ ...changed, owners: [owner("core", "/product/core")] }).previewHash);
  });

  it("publishes the planner protocol and bounds but no transcript hash", () => {
    const preview = buildUpdatePreview(updateInput());
    expect(Object.keys(preview.planner).sort()).toEqual(["bounds", "protocol"]);
    const canonical = encodeCanonicalJson(preview as never);
    for (const hidden of [transcript.requestHash, transcript.inputBlobsHash, transcript.resultHash, transcript.outputBlobsHash]) {
      expect(canonical).not.toContain(hidden);
    }
    expect(Object.keys(preview.retainedRollback?.payload ?? {}).sort()).toEqual(["aggregateBytes", "entryCount", "payloadId"]);
    expect(() => buildUpdatePreview({ ...updateInput(), planner: { ...transcript, bounds: { ...bounds, wallMilliseconds: 600_001 } } })).toThrow();
  });

  it("refuses an insufficient capacity before any preview exists", () => {
    expect(() => buildUpdatePreview({ ...updateInput(), capacity: { ...capacity(), availableEntries: u("12") } })).toThrow(UpdateCapacityInsufficientError);
    expect(buildUpdatePreview({ ...updateInput(), capacity: { ...capacity(), availableEntries: u("13"), availableBytes: u("4206") } }).capacity.fits).toBe(true);
    expect(() => buildUpdatePreview({ ...updateInput(), capacity: capacity("rollback") })).toThrow();
  });

  it("refuses a same-release update and a malformed packageSource", () => {
    const input = updateInput();
    expect(() => buildUpdatePreview({ ...input, target: input.current })).toThrow();
    expect(() => buildUpdatePreview({ ...input, packageSource: { ...input.packageSource, kegPath: "prefix/relative" as never } })).toThrow();
    expect(() => buildUpdatePreview({ ...input, packageSource: { ...input.packageSource, bundleManifestHash: "A".repeat(64) as never } })).toThrow();
  });

  it("names the keg as packageSource and has no download block: nothing is downloaded (D84 K4 F7)", () => {
    const preview = buildUpdatePreview(updateInput());
    expect(preview.packageSource).toStrictEqual({ kegPath: "/prefix/Cellar/developer-os/2.0.0", bundleManifestHash: sha("manifest-2.0.0") });
    expect("download" in preview).toBe(false);
  });
});

describe("rollback preview", () => {
  it("carries only the rollback fields and lists migrations in canonical chain order", () => {
    const preview = buildRollbackPreview(rollbackInput());
    expect(Object.keys(preview).sort()).toEqual([
      "consumesRollbackRecord", "current", "migrations", "operation", "owners", "payload", "previewHash", "schemaVersion", "target",
    ]);
    expect(preview.operation).toBe("rollback");
    expect(preview.consumesRollbackRecord).toBe(true);
    expect(preview.migrations.map((entry) => entry.id)).toEqual(["migration_state-v3", "migration_brain-v2", "migration_brain-v3"]);
    expect(preview.previewHash).toBe(previewHash(preview));
  });

  it("is deterministic under reversed input and refuses insufficient or update-shaped capacity", () => {
    const input = rollbackInput();
    const reversed = { ...input, owners: [...input.owners].reverse().map(reverseOwner), migrations: [...input.migrations].reverse() };
    expect(buildRollbackPreview(reversed)).toEqual(buildRollbackPreview(input));
    expect(() => buildRollbackPreview({ ...input, capacity: { ...capacity("rollback"), availableBytes: u("4205") } })).toThrow(UpdateCapacityInsufficientError);
    expect(() => buildRollbackPreview({ ...input, capacity: capacity("update") })).toThrow();
    expect(() => buildRollbackPreview({ ...input, payload: { ...input.payload, aggregateBytes: 2_147_483_649 } })).toThrow();
  });
});

describe("prepared update materialization", () => {
  it("recomputes every private hash with its domain over no-LF canonical bytes", () => {
    const input = materializationInput();
    const built = buildPreparedUpdateMaterialization(input);
    expect(built.targetDraftHash).toBe(noLineFeedHash("developer-os/prepared-target-draft/v1", input.targetDraft));
    expect(built.concreteManifestHash).toBe(noLineFeedHash("developer-os/prepared-concrete-manifest/v1", input.concreteManifest));
    expect(built.inversePlanProjectionHash).toBe(noLineFeedHash("developer-os/prepared-update-inverse/v1", input.inversePlan));
    expect(built.inversePlanProjection).toBe(encodeCanonicalJson(input.inversePlan));
    expect(built.inventoryEntriesHash).toBe(noLineFeedHash("developer-os/prepared-rollback-inventory-entries/v1", input.rollbackInventoryEntries as never));
    expect(built.inversePlanProjections.map((leaf) => leaf.kind)).toEqual(["owner_inverse", "schema_migration_inverse"]);
    const leaf = built.inversePlanProjections[0];
    expect(leaf?.projectionHash).toBe(noLineFeedHash("developer-os/prepared-inverse-leaf/v1", { owner: "core", paths: ["/product/core/a-new"] }));
    expect(leaf?.bytes).toBe(new TextEncoder().encode(leaf?.projection).byteLength);
    expect(built.aggregateBytes).toBe(60);
    const sizes = [input.targetDraft, input.concreteManifest, input.inversePlan, ...input.inverseLeaves.map((entry) => entry.projection)]
      .map((value) => new TextEncoder().encode(encodeCanonicalJson(value)).byteLength);
    expect(built.maximumCanonicalBytes).toBe(Math.max(...sizes));
  });

  it("orders owner leaves in canonical owner order, as the planner emits them and the rollback payload requires", () => {
    const input = materializationInput();
    const [preimage, , migration] = input.rollbackInventoryEntries as [RollbackPayloadEntryV1, RollbackPayloadEntryV1, RollbackPayloadEntryV1];
    const entries: RollbackPayloadEntryV1[] = [
      preimage,
      { ordinal: 1, path: payloadPath("plans/owner_inverse/owner_core.plan.json"), role: "inverse_plan_leaf", bytes: 20, sha256: sha("leaf-core") },
      { ordinal: 2, path: payloadPath("plans/owner_inverse/owner_codex.plan.json"), role: "inverse_plan_leaf", bytes: 40, sha256: sha("leaf-codex") },
      { ...migration, ordinal: 3 },
    ];
    const built = buildPreparedUpdateMaterialization({
      ...input,
      inverseLeaves: [
        { kind: "owner_inverse", id: parseSafeReasonCode("owner_codex"), projection: { owner: "codex", paths: ["/product/codex/a-new"] } },
        { kind: "owner_inverse", id: parseSafeReasonCode("owner_core"), projection: { owner: "core", paths: ["/product/core/a-new"] } },
        ...input.inverseLeaves.filter((leaf) => leaf.kind === "schema_migration_inverse"),
      ],
      rollbackInventoryEntries: entries,
    });
    /** By id, `owner_codex` sorts before `owner_core`; by OWNER_UPDATE_ORDER, core comes first. */
    expect(built.inversePlanProjections.map((leaf) => leaf.id)).toEqual(["owner_core", "owner_codex", "migration_brain-v2"]);
  });

  it("orders migration leaves in chain order, as the planner emits them and their inventory rows follow (NEW-135)", () => {
    const input = materializationInput();
    const [preimage, owner] = input.rollbackInventoryEntries as [RollbackPayloadEntryV1, RollbackPayloadEntryV1];
    /** Execution order: product_state before brain, then fromVersion; every ID sorts against it. */
    const chain = [
      { id: "migration_state-v2", domain: "product_state", fromVersion: 1, toVersion: 2 },
      { id: "migration_brain-z-first", domain: "brain", fromVersion: 1, toVersion: 2 },
      { id: "migration_brain-a-second", domain: "brain", fromVersion: 2, toVersion: 3 },
    ];
    const entries: RollbackPayloadEntryV1[] = [
      preimage,
      owner,
      ...chain.map((migration, index): RollbackPayloadEntryV1 => ({
        ordinal: index + 2,
        path: payloadPath(`plans/schema_migration_inverse/${migration.id}.plan.json`),
        role: "inverse_plan_leaf",
        bytes: 30,
        sha256: sha(`leaf-${migration.id}`),
      })),
    ];
    const built = buildPreparedUpdateMaterialization({
      ...input,
      inverseLeaves: [
        ...input.inverseLeaves.filter((leaf) => leaf.kind === "owner_inverse"),
        ...chain.map((migration) => ({ kind: "schema_migration_inverse" as const, id: parseSchemaMigrationId(migration.id), projection: { kind: "schema_migration_inverse", ...migration } })),
      ],
      rollbackInventoryEntries: entries,
    });
    /** `#rollbackSourceEntries` pairs these leaves with the inventory's leaf rows by position. */
    const leafRows = entries.filter((entry) => entry.role === "inverse_plan_leaf").map((entry) => entry.path);
    expect(built.inversePlanProjections.map((leaf) => leaf.id)).toEqual(["core", ...chain.map((migration) => migration.id)]);
    expect(built.inversePlanProjections.map((leaf) => payloadPath(`plans/${leaf.kind}/${leaf.id}.plan.json`))).toEqual(leafRows);
  });

  it("refuses non-contiguous rows, allocation-bound fields, and a broken leaf/inventory bijection", () => {
    const input = materializationInput();
    expect(() => buildPreparedUpdateMaterialization({ ...input, outputBlobs: [{ ordinal: 1, bytes: 0, sha256: sha("") }] })).toThrow("not contiguous");
    expect(() => buildPreparedUpdateMaterialization({ ...input, outputBlobs: [{ ordinal: 0, bytes: 16_777_217, sha256: sha("") }] })).toThrow();
    const [first, second, third] = input.rollbackInventoryEntries as [RollbackPayloadEntryV1, RollbackPayloadEntryV1, RollbackPayloadEntryV1];
    expect(() => buildPreparedUpdateMaterialization({ ...input, rollbackInventoryEntries: [second, first, third] })).toThrow("not contiguous");
    expect(() => buildPreparedUpdateMaterialization({ ...input, rollbackInventoryEntries: [first, second] })).toThrow("bijective");
    expect(() => buildPreparedUpdateMaterialization({ ...input, rollbackInventoryEntries: [{ ...first, path: payloadPath("blobs/0000000001.bin") }, second, third] })).toThrow("derived from its ordinal");
    expect(() => buildPreparedUpdateMaterialization({ ...input, rollbackInventoryEntries: [{ ...first, bytes: 16_777_217 }, second, third] })).toThrow();
    expect(() => buildPreparedUpdateMaterialization({ ...input, rollbackInventoryEntries: [] })).toThrow();
    const [leafA, leafB] = input.inverseLeaves as [PreparedUpdateMaterializationInputV1["inverseLeaves"][0], PreparedUpdateMaterializationInputV1["inverseLeaves"][0]];
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [leafA, { ...leafB, projection: { coordinatorId: "lc_x" } }] })).toThrow("allocation-bound");
    expect(() => buildPreparedUpdateMaterialization({ ...input, inversePlan: { nested: [{ rollbackBindingHash: hex("x") }] } })).toThrow("allocation-bound");
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [leafA, leafA, leafB] })).toThrow("duplicate id");
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [] })).toThrow();
    /** A leaf whose order key is missing is refused, never ranked by a default (NEW-135). */
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [leafA, { ...leafB, projection: { paths: [] } }] })).toThrow("PreparedInverseProjectionV1.projection");
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [{ ...leafA, projection: { domain: "elsewhere", fromVersion: 1 } }, leafB] })).toThrow("PreparedInverseProjectionV1.projection");
    expect(() => buildPreparedUpdateMaterialization({ ...input, inverseLeaves: [{ ...leafA, projection: { domain: "brain" } }, leafB] })).toThrow("PreparedInverseProjectionV1.projection");
  });
});

describe("prepared update candidate", () => {
  it("binds the public preview to the matching transcript and keeps private evidence out of the preview", () => {
    const preview = buildUpdatePreview(updateInput());
    const materialization = buildPreparedUpdateMaterialization(materializationInput());
    const candidate = buildPreparedUpdateCandidate({ preview, transcriptIdentity: transcript, materialization });
    expect(candidate.preview).toBe(preview);
    const canonical = encodeCanonicalJson(candidate.preview as never);
    for (const hidden of [materialization.targetDraftHash, materialization.inventoryEntriesHash, materialization.inversePlanProjectionHash]) {
      expect(canonical).not.toContain(hidden);
    }
    expect(() => buildPreparedUpdateCandidate({ preview, transcriptIdentity: { ...transcript, protocol: parsePositiveUInt32(2) }, materialization })).toThrow("differs");
    expect(() => buildPreparedUpdateCandidate({ preview: { ...preview, previewHash: sha("tampered") }, transcriptIdentity: transcript, materialization })).toThrow();
  });
});
