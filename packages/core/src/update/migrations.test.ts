import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AllocatedLifecycleIdV1 } from "../lifecycle/ids.js";
import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import {
  materializeSchemaMigration,
  materializeSchemaMigrations,
  orderMigrationChain,
  planSchemaMigrations,
  projectRetainedSchemaMigrationInverse,
  schemaMigrationInitialState,
  schemaMigrationPlanHash,
  selectMigrationChain,
  buildUpdateFoundationParticipantRef,
  updateFoundationParticipantPlanHash,
  updateFoundationStagedDigestBytes,
  updateFoundationStagedPath,
  validateSchemaMigrationExecutionJournal,
  validateSchemaMigrationRegistry,
  type MigrationMaterializationContextV1,
  type SchemaMigrationPlanV1,
  type SchemaMigrationProviderV1,
  type SchemaMigrationRegistryV1,
  type SchemaMigrationSubjectV1,
  type UpdateFoundationMutationRefV1,
  type UpdateFoundationParticipantRefV2,
  type UpdatePayloadRefV1,
} from "./migrations.js";
import {
  deriveFoundationInitialJournalPayloadPath,
  deriveUpdatePayloadPath,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalPathEvidenceV1,
  type CanonicalProductStatePathV1,
  type VaultRelativePathV1,
} from "./paths.js";
import {
  plannerPathToken,
  validateUpdatePlannerRequest,
  type OwnerUpdateDraftV1,
  type PlannerPathTokenV1,
  type SchemaMigrationDraftV1,
  type SecretScreenedBlobV1,
} from "./planner.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, parsePositiveUInt32, parseSchemaMigrationId, type LowerHexSha256, type SafeReasonCodeV1, type UtcTimestampV1 } from "./scalars.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const v = parsePositiveUInt32;
const id = parseSchemaMigrationId;
const t = (ordinal: number): PlannerPathTokenV1 => plannerPathToken(ordinal);
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

const productHome = parseCanonicalAbsolutePathText("/product");
const brainRoot = parseCanonicalAbsolutePathText("/vault");
const nonce = "a".repeat(64);
const coordinatorId = `lc_${nonce}_7` as LifecycleCoordinatorIdV1;
const tx = (counter: number): AllocatedLifecycleIdV1<"tx"> => `tx_${nonce}_${String(counter)}` as AllocatedLifecycleIdV1<"tx">;
const configPath = "/product/state/config.json" as CanonicalProductStatePathV1;

const configV1 = bytes('{"schemaVersion":1}\n');
const configV2 = bytes('{"schemaVersion":2}\n');
const configV3 = bytes('{"schemaVersion":3}\n');
const skillV1 = bytes("codex skill v1\n");
const noteV1 = bytes("# Note\n\nsynthetic vault text\n");
const noteV2 = bytes("# Note v2\n");

function release(version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
    delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
    bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
  }, evidence);
}

const blobRef = (ordinal: number, content: Uint8Array) => ({ stream: "input", ordinal, bytes: content.byteLength, sha256: sha(content) });

function request() {
  const schema = { mode: "schema", schemaId: "developer-os-config-v1", installedHash: sha(configV1) };
  const content = { mode: "content", installedHash: sha(skillV1) };
  const rows = [
    { token: t(0), owner: "core", kind: "file", verification: schema, productVersion: "1.0.0", source: "state/config.json", mergeStrategy: "dedicated", currentHash: sha(configV1) },
    { token: t(1), owner: "codex", kind: "file", verification: content, productVersion: "1.0.0", source: "codex/skill.md", mergeStrategy: "dedicated", currentHash: sha(skillV1) },
  ];
  const input = (row: Record<string, unknown>, observed: object) => {
    const columns: Record<string, unknown> = { ...row, observed };
    delete columns.currentHash;
    return columns;
  };
  return validateUpdatePlannerRequest({
    schemaVersion: 1, protocol: 1, plannedAt: "2026-09-23T08:00:00.000Z", platform: "darwin", architecture: "arm64",
    currentRelease: release("1.0.0", "1"), targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: rows },
    config: { schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: true }, git: { enabled: false }, automation: { enabled: false }, brain: null, redactionPatternsCount: 0, telemetry: false },
    installedOwners: ["core", "codex"],
    artifactInputs: [
      input(rows[0] as Record<string, unknown>, { state: "content", mode: 384, bytes: configV1.byteLength, sha256: sha(configV1), blob: blobRef(0, configV1) }),
      input(rows[1] as Record<string, unknown>, { state: "content", mode: 384, bytes: skillV1.byteLength, sha256: sha(skillV1), blob: blobRef(1, skillV1) }),
    ],
    brain: {
      schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: noteV1.byteLength,
      entries: [{ path: "content/notes/a.md", mode: 384, bytes: noteV1.byteLength, sha256: sha(noteV1), blob: blobRef(2, noteV1) }],
    },
  });
}

function ownerPlans(configOperation: "keep" | "untouched" | "replace" = "untouched"): OwnerUpdateDraftV1[] {
  const target = { kind: "installed", token: t(0) } as const;
  const coreOperations = configOperation === "keep"
    ? [{ operation: "keep", target, expectedHash: sha(configV1) } as const]
    : configOperation === "replace"
      ? [{ operation: "replace", target, expectedHash: sha(configV1), content: { kind: "output_blob", blob: { stream: "output", ordinal: 0, bytes: 1 } } } as const]
      : [];
  return [
    { owner: "core", currentArtifacts: [t(0)], proposedOperations: coreOperations, externalEffects: [] },
    { owner: "codex", currentArtifacts: [t(1)], proposedOperations: [], externalEffects: [] },
  ];
}

const productPath = { domain: "product_state", token: t(0) } as const;
const brainPath = { domain: "brain", path: "content/notes/a.md" as VaultRelativePathV1 } as const;
const productKey = `product_state:${t(0)}`;
const brainKey = "brain:content/notes/a.md";

function row(name: string, domain: "product_state" | "brain", from: number, to: number) {
  return { id: id(`migration_${name}`), domain, fromVersion: v(from), toVersion: v(to) };
}

function provider(name: string, domain: "product_state" | "brain", from: number, to: number, plan: SchemaMigrationProviderV1["plan"]): SchemaMigrationProviderV1 {
  return { ...row(name, domain, from, to), plan };
}

const rewrite = (after: Uint8Array): SchemaMigrationProviderV1["plan"] => (subjects) => subjects.slice(0, 1).map((subject) => ({ path: subject.path, content: after }));

describe("orderMigrationChain", () => {
  const validDrafts = [row("notes-v2", "brain", 1, 2), row("config-v3", "product_state", 2, 3), row("config-v2", "product_state", 1, 2)];

  it("orders product-state before Brain and requires contiguous chains", () => {
    expect(orderMigrationChain(validDrafts).map((entry) => entry.domain)).toEqual(["product_state", "product_state", "brain"]);
    expect(orderMigrationChain(validDrafts).map((entry) => entry.id)).toEqual(["migration_config-v2", "migration_config-v3", "migration_notes-v2"]);
    const missingMiddleStep = [row("config-v2", "product_state", 1, 2), row("config-v4", "product_state", 3, 4)];
    expect(() => orderMigrationChain(missingMiddleStep)).toThrow(/contiguous/);
  });

  it("accepts the empty chain", () => {
    expect(orderMigrationChain([])).toEqual([]);
  });

  it.each([
    ["a repeated ID", [row("config-v2", "product_state", 1, 2), row("config-v2", "brain", 1, 2)]],
    ["a non-increasing step", [row("config-v2", "product_state", 2, 2)]],
    ["a downgrade step", [row("config-v1", "product_state", 2, 1)]],
    ["two steps from one version", [row("config-v2", "product_state", 1, 2), row("config-v2b", "product_state", 1, 3)]],
    ["an unknown domain", [{ ...row("config-v2", "product_state", 1, 2), domain: "vendor" as "brain" }]],
    ["an ID outside the grammar", [{ ...row("config-v2", "product_state", 1, 2), id: "config-v2" as SchemaMigrationDraftV1["id"] }]],
  ])("refuses %s", (_name, rows) => {
    expect(() => orderMigrationChain(rows)).toThrow();
  });

  it("anchors each domain's chain at its current version", () => {
    expect(orderMigrationChain([row("notes-v3", "brain", 2, 3)], { brain: v(2) })).toHaveLength(1);
    expect(() => orderMigrationChain([row("notes-v3", "brain", 2, 3)], { brain: v(1) })).toThrow(/current version/);
  });
});

describe("migration registry", () => {
  const configStep = provider("config-v2", "product_state", 1, 2, rewrite(configV2));
  const configStep3 = provider("config-v3", "product_state", 2, 3, rewrite(configV3));
  const registry: SchemaMigrationRegistryV1 = { productState: [configStep, configStep3], brain: [] };

  it("validates domain filing, chain order, and global ID uniqueness", () => {
    expect(validateSchemaMigrationRegistry(registry)).toBe(registry);
    expect(() => validateSchemaMigrationRegistry({ productState: [configStep3, configStep], brain: [] })).toThrow(/chain order/);
    expect(() => validateSchemaMigrationRegistry({ productState: [], brain: [configStep] })).toThrow(/another domain/);
    const sameId = provider("config-v2", "brain", 1, 2, rewrite(noteV2));
    expect(() => validateSchemaMigrationRegistry({ productState: [configStep], brain: [sameId] })).toThrow(/duplicate/);
  });

  it("selects empty, single, and multi-step chains and refuses a gap or downgrade", () => {
    expect(selectMigrationChain([], { from: v(1), to: v(1) })).toEqual([]);
    expect(selectMigrationChain(registry.productState, { from: v(1), to: v(2) })).toEqual([configStep]);
    expect(selectMigrationChain(registry.productState, { from: v(1), to: v(3) })).toEqual([configStep, configStep3]);
    expect(() => selectMigrationChain(registry.productState, { from: v(1), to: v(4) })).toThrow(/incompatible/);
    expect(() => selectMigrationChain([configStep3], { from: v(1), to: v(3) })).toThrow(/incompatible/);
    expect(() => selectMigrationChain(registry.productState, { from: v(3), to: v(1) })).toThrow(/downgrade/);
  });

  it("an empty registry cannot plan an update that needs a schema step", () => {
    const empty: SchemaMigrationRegistryV1 = { productState: [], brain: [] };
    const subjects = { product_state: [], brain: [] };
    expect(planSchemaMigrations({ registry: empty, versions: { product_state: { from: v(1), to: v(1) }, brain: { from: v(1), to: v(1) } }, subjects, firstOutputOrdinal: 0 })).toEqual({ drafts: [], outputBlobs: [] });
    expect(() => planSchemaMigrations({ registry: empty, versions: { product_state: { from: v(1), to: v(2) }, brain: { from: v(1), to: v(1) } }, subjects, firstOutputOrdinal: 0 })).toThrow(/incompatible/);
  });
});

describe("planSchemaMigrations", () => {
  const subjects = (): Record<"product_state" | "brain", SchemaMigrationSubjectV1[]> => ({
    product_state: [{ path: productPath, content: configV1 }],
    brain: [{ path: brainPath, content: noteV1 }],
  });
  const registry: SchemaMigrationRegistryV1 = {
    productState: [provider("config-v2", "product_state", 1, 2, rewrite(configV2)), provider("config-v3", "product_state", 2, 3, rewrite(configV3))],
    brain: [provider("notes-v2", "brain", 1, 2, rewrite(noteV2))],
  };
  const versions = { product_state: { from: v(1), to: v(3) }, brain: { from: v(1), to: v(2) } };

  it("plans a multi-step chain whose inverses are the exact before bytes", () => {
    const planned = planSchemaMigrations({ registry, versions, subjects: subjects(), firstOutputOrdinal: 4 });
    expect(planned.drafts.map((draft) => draft.id)).toEqual(["migration_config-v2", "migration_config-v3", "migration_notes-v2"]);
    const [first, second, third] = planned.drafts as [SchemaMigrationDraftV1, SchemaMigrationDraftV1, SchemaMigrationDraftV1];
    expect(first.mutations).toEqual([{ path: productPath, beforeHash: sha(configV1), afterBlob: { stream: "output", ordinal: 4, bytes: configV2.byteLength }, inverseBlob: { stream: "output", ordinal: 5, bytes: configV1.byteLength } }]);
    expect(second.mutations[0]?.beforeHash).toBe(sha(configV2));
    expect(third.mutations[0]?.path).toEqual(brainPath);
    expect(planned.outputBlobs).toEqual([configV2, configV1, configV3, configV2, noteV2, noteV1]);
  });

  it("stays root-free: drafts carry tokens and vault-relative paths only", () => {
    const planned = planSchemaMigrations({ registry, versions, subjects: subjects(), firstOutputOrdinal: 0 });
    const text = JSON.stringify(planned.drafts);
    expect(text).not.toContain("/product");
    expect(text).not.toContain("/vault");
    expect(text).not.toContain("synthetic vault text");
  });

  it.each([
    ["a new target artifact", (): SchemaMigrationSubjectV1[] => [{ path: { domain: "product_state", token: t(9) }, content: configV2 }]],
    ["a cross-domain subject", (): SchemaMigrationSubjectV1[] => [{ path: brainPath, content: noteV2 }]],
    ["a repeated subject", (): SchemaMigrationSubjectV1[] => [{ path: productPath, content: configV2 }, { path: productPath, content: configV3 }]],
    ["a mutation that changes nothing", (): SchemaMigrationSubjectV1[] => [{ path: productPath, content: configV1 }]],
    ["no mutation at all", (): SchemaMigrationSubjectV1[] => []],
  ])("refuses a provider that returns %s", (_name, result) => {
    const bad: SchemaMigrationRegistryV1 = { productState: [provider("config-v2", "product_state", 1, 2, result)], brain: [] };
    expect(() => planSchemaMigrations({ registry: bad, versions: { product_state: { from: v(1), to: v(2) }, brain: { from: v(1), to: v(1) } }, subjects: subjects(), firstOutputOrdinal: 0 })).toThrow();
  });

  it("refuses an after blob above the 16-MiB mutation bound", () => {
    const huge: SchemaMigrationRegistryV1 = { productState: [provider("config-v2", "product_state", 1, 2, rewrite(new Uint8Array(16_777_217)))], brain: [] };
    expect(() => planSchemaMigrations({ registry: huge, versions: { product_state: { from: v(1), to: v(2) }, brain: { from: v(1), to: v(1) } }, subjects: subjects(), firstOutputOrdinal: 0 })).toThrow(/after bytes/);
  });
});

describe("schemaMigrationInitialState", () => {
  it("admits kept or untouched schema files with bytes and every Brain snapshot entry", () => {
    const state = schemaMigrationInitialState(request(), ownerPlans("keep"));
    expect([...state.entries()]).toEqual([[productKey, sha(configV1)], [brainKey, sha(noteV1)]]);
    expect(schemaMigrationInitialState(request(), ownerPlans("untouched")).has(productKey)).toBe(true);
  });

  it("excludes a schema file whose owner operation changes it, and every content-mode file", () => {
    const state = schemaMigrationInitialState(request(), ownerPlans("replace"));
    expect(state.has(productKey)).toBe(false);
    expect(state.has(`product_state:${t(1)}`)).toBe(false);
  });
});

function payload(ordinal: number, content: Uint8Array): UpdatePayloadRefV1 {
  return {
    kind: "update_expected", coordinatorId, ordinal,
    path: deriveUpdatePayloadPath(productHome, coordinatorId as string as SafeReasonCodeV1, ordinal),
    bytes: content.byteLength, sha256: sha(content), mode: 384,
  };
}

function screened(blobs: readonly Uint8Array[]): SecretScreenedBlobV1[] {
  return blobs.map((content, ordinal) => ({ ordinal, bytes: content.byteLength, sha256: sha(content), content }) as SecretScreenedBlobV1);
}

function foundationRef(counter: number, role: UpdateFoundationParticipantRefV2["role"], mutations: readonly UpdateFoundationMutationRefV1[]): UpdateFoundationParticipantRefV2 {
  const refId = tx(counter);
  const journalHash = sha(`initial journal ${String(counter)}`);
  const unsigned: Omit<UpdateFoundationParticipantRefV2, "planHash"> = {
    id: refId,
    slot: "schema_forward",
    role,
    mutations,
    maximumJournalBytes: 1_048_576,
    initialJournal: {
      finalPath: `${productHome}/state/transactions/${refId}.json` as CanonicalAbsolutePathV1,
      plannedBytesHash: journalHash,
      staged: {
        kind: "update_expected", coordinatorId, ordinal: 100 + counter,
        path: deriveFoundationInitialJournalPayloadPath(productHome, coordinatorId as string as SafeReasonCodeV1, refId as string as SafeReasonCodeV1),
        hash: journalHash, bytes: 512, mode: 0o600,
      },
    },
  };
  return { ...unsigned, planHash: updateFoundationParticipantPlanHash(unsigned) };
}

/** Spec 2 §5.3 (D60): the standard staged blob, the content payload, and its own sidecar payload. */
function staged(counter: number, content: Uint8Array, contentOrdinal: number): Pick<UpdateFoundationMutationRefV1, "stagedPath" | "content" | "digest"> {
  return {
    stagedPath: updateFoundationStagedPath(productHome, tx(counter), 0),
    content: payload(contentOrdinal, content),
    digest: payload(50 + contentOrdinal, updateFoundationStagedDigestBytes(sha(content))),
  };
}

function foundationPair(forwardCounter: number, target: string, before: Uint8Array, after: Uint8Array, afterOrdinal: number, inverseOrdinal: number): UpdateFoundationParticipantRefV2[] {
  const targetPath = target as CanonicalAbsolutePathV1;
  const forward: UpdateFoundationMutationRefV1 = { targetPath, operation: "replace", expectedBeforeHash: sha(before), contentHash: sha(after), contentSize: after.byteLength, ...staged(forwardCounter, after, afterOrdinal) };
  const compensation: UpdateFoundationMutationRefV1 = { targetPath, operation: "replace", expectedBeforeHash: sha(after), contentHash: sha(before), contentSize: before.byteLength, ...staged(forwardCounter + 1, before, inverseOrdinal) };
  return [
    foundationRef(forwardCounter, { kind: "forward", compensationId: tx(forwardCounter + 1) }, [forward]),
    foundationRef(forwardCounter + 1, { kind: "compensation", forwardId: tx(forwardCounter) }, [compensation]),
  ];
}

const outputBlobs = [configV2, configV1, noteV2, noteV1];
const configDraft: SchemaMigrationDraftV1 = {
  ...row("config-v2", "product_state", 1, 2),
  mutations: [{ path: productPath, beforeHash: sha(configV1), afterBlob: { stream: "output", ordinal: 0, bytes: configV2.byteLength }, inverseBlob: { stream: "output", ordinal: 1, bytes: configV1.byteLength } }],
};
const brainDraft: SchemaMigrationDraftV1 = {
  ...row("notes-v2", "brain", 1, 2),
  mutations: [{ path: brainPath, beforeHash: sha(noteV1), afterBlob: { stream: "output", ordinal: 2, bytes: noteV2.byteLength }, inverseBlob: { stream: "output", ordinal: 3, bytes: noteV1.byteLength } }],
};

function context(overrides: Partial<MigrationMaterializationContextV1> = {}): MigrationMaterializationContextV1 {
  return {
    coordinatorId,
    productHome,
    brainRoot,
    tokenPaths: new Map([[t(0), configPath]]),
    state: schemaMigrationInitialState(request(), ownerPlans()),
    outputBlobs: screened(outputBlobs),
    payloads: new Map(outputBlobs.map((content, ordinal) => [ordinal, payload(ordinal, content)])),
    foundation: foundationPair(10, configPath, configV1, configV2, 0, 1),
    ...overrides,
  };
}

function materializeMigration(draft: SchemaMigrationDraftV1 = configDraft, overrides: Partial<MigrationMaterializationContextV1> = {}) {
  return materializeSchemaMigration(draft, context(overrides));
}

describe("materializeSchemaMigration", () => {
  it("proves every inverse restores the exact before bytes", () => {
    const validDraft = configDraft;
    expect(materializeMigration(validDraft).inverseVerified).toBe(true);
  });

  it("rehydrates a product token to its schema path and binds both staged payloads", () => {
    const { plan, state } = materializeMigration();
    expect(plan.mutations).toEqual([{ path: configPath, beforeHash: sha(configV1), afterHash: sha(configV2), afterBlob: payload(0, configV2), inverseBlob: payload(1, configV1) }]);
    expect(plan.coordinatorId).toBe(coordinatorId);
    expect(plan.maximumPlanBytes).toBe(16_777_216);
    expect(state.get(productKey)).toBe(sha(configV2));
  });

  it("keeps a Brain mutation vault-relative while binding its Foundation target under the Brain root", () => {
    const { plan } = materializeMigration(brainDraft, { foundation: foundationPair(20, "/vault/content/notes/a.md", noteV1, noteV2, 2, 3) });
    expect(plan.mutations[0]?.path).toBe("content/notes/a.md");
  });

  it("persists no migration bytes and no planner-stream ordinal", () => {
    const { plan } = materializeMigration(brainDraft, { foundation: foundationPair(20, "/vault/content/notes/a.md", noteV1, noteV2, 2, 3) });
    const text = JSON.stringify(plan);
    expect(text).not.toContain("synthetic vault text");
    expect(text).not.toContain("Note v2");
    expect(text).not.toContain('"stream"');
  });

  it.each([
    ["an unknown token", { ...configDraft, mutations: [{ ...configDraft.mutations[0], path: { domain: "product_state", token: t(5) } }] }],
    ["a replaced product token", configDraft, { state: schemaMigrationInitialState(request(), ownerPlans("replace")) }],
    ["a Brain path absent from the snapshot", { ...brainDraft, mutations: [{ ...brainDraft.mutations[0], path: { domain: "brain", path: "content/notes/b.md" } }] }],
    ["a cross-domain mutation", { ...brainDraft, mutations: [configDraft.mutations[0]] }],
    ["a repeated path", { ...configDraft, mutations: [configDraft.mutations[0], configDraft.mutations[0]] }],
    ["a stale before hash", { ...configDraft, mutations: [{ ...configDraft.mutations[0], beforeHash: sha("other") }] }],
    ["an inverse that does not restore the before bytes", { ...configDraft, mutations: [{ ...configDraft.mutations[0], inverseBlob: { stream: "output", ordinal: 2, bytes: noteV2.byteLength } }] }],
    ["a blob length that differs from its frame", { ...configDraft, mutations: [{ ...configDraft.mutations[0], afterBlob: { stream: "output", ordinal: 0, bytes: 1 } }] }],
    ["an unscreened blob ordinal", { ...configDraft, mutations: [{ ...configDraft.mutations[0], afterBlob: { stream: "output", ordinal: 9, bytes: configV2.byteLength } }] }],
    ["an empty mutation set", { ...configDraft, mutations: [] }],
    ["a non-increasing version step", { ...configDraft, toVersion: v(1) }],
  ] as [string, SchemaMigrationDraftV1, Partial<MigrationMaterializationContextV1>?][])("refuses %s", (_name, draft, overrides) => {
    expect(() => materializeMigration(draft, overrides)).toThrow();
  });

  it("refuses a blob whose content no longer matches its screened hash", () => {
    const blobs = screened(outputBlobs);
    const tampered = [{ ...blobs[0], content: bytes('{"schemaVersion":9}\n') } as SecretScreenedBlobV1, ...blobs.slice(1)];
    expect(() => materializeMigration(configDraft, { outputBlobs: tampered })).toThrow(/screened frame/);
  });

  it.each([
    ["another coordinator's payload", { ...payload(0, configV2), coordinatorId: `lc_${nonce}_8` as LifecycleCoordinatorIdV1 }],
    ["a payload outside the derived path", { ...payload(0, configV2), path: "/product/staging/other.payload" as UpdatePayloadRefV1["path"] }],
    ["a payload with another hash", { ...payload(0, configV2), sha256: sha("other") }],
    ["an executable payload mode", { ...payload(0, configV2), mode: 448 as const }],
  ])("refuses %s", (_name, ref) => {
    const payloads = new Map(context().payloads);
    payloads.set(0, ref);
    expect(() => materializeMigration(configDraft, { payloads })).toThrow(/UpdatePayloadRefV1/);
  });

  describe("Foundation binding", () => {
    const pair = (): UpdateFoundationParticipantRefV2[] => foundationPair(10, configPath, configV1, configV2, 0, 1);
    const resign = (ref: UpdateFoundationParticipantRefV2): UpdateFoundationParticipantRefV2 => ({ ...ref, planHash: updateFoundationParticipantPlanHash(ref) });

    it.each([
      ["no refs", (): UpdateFoundationParticipantRefV2[] => []],
      ["an unpaired forward ref", (): UpdateFoundationParticipantRefV2[] => pair().slice(0, 1)],
      ["refs out of ID order", (): UpdateFoundationParticipantRefV2[] => pair().reverse()],
      ["the inverse slot", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, slot: "schema_inverse" }))],
      ["a tampered plan hash", (): UpdateFoundationParticipantRefV2[] => [{ ...pair()[0] as UpdateFoundationParticipantRefV2, planHash: sha("tampered") }, pair()[1] as UpdateFoundationParticipantRefV2]],
      ["a forward ref that does not match the plan", (): UpdateFoundationParticipantRefV2[] => foundationPair(10, configPath, configV1, configV3, 0, 1)],
      ["a compensation that does not reverse its forward", (): UpdateFoundationParticipantRefV2[] => {
        const [forward, compensation] = pair() as [UpdateFoundationParticipantRefV2, UpdateFoundationParticipantRefV2];
        return [forward, resign({ ...compensation, mutations: forward.mutations })];
      }],
      ["a ref with no mutations", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: [] }))],
      ["a ref above 256 mutations", (): UpdateFoundationParticipantRefV2[] => {
        const [forward, compensation] = pair() as [UpdateFoundationParticipantRefV2, UpdateFoundationParticipantRefV2];
        return [resign({ ...forward, mutations: Array.from({ length: 257 }, () => forward.mutations[0] as UpdateFoundationMutationRefV1) }), compensation];
      }],
      ["a journal above its participant bound", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, maximumJournalBytes: 1_048_577 }))],
      ["a staged journal of another coordinator", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, initialJournal: { ...ref.initialJournal, staged: { ...ref.initialJournal.staged, coordinatorId: `lc_${nonce}_8` as LifecycleCoordinatorIdV1 } } }))],
      ["a final journal path outside state/transactions", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, initialJournal: { ...ref.initialJournal, finalPath: "/product/state/other.json" as CanonicalAbsolutePathV1 } }))],
      ["a planned journal hash unequal to its staged hash", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, initialJournal: { ...ref.initialJournal, plannedBytesHash: sha("other") } }))],
      ["a mutation staged at its payload path instead of the standard path", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, stagedPath: mutation.content?.path ?? null })) }))],
      ["a mutation staged under another transaction", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, stagedPath: updateFoundationStagedPath(productHome, tx(99), 0) })) }))],
      ["a mutation with no content row", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, content: null })) }))],
      ["a mutation with no digest row", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, digest: null })) }))],
      ["a sidecar of another hash", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, digest: payload(60, updateFoundationStagedDigestBytes(sha("other"))) })) }))],
      ["content and digest sharing one payload", (): UpdateFoundationParticipantRefV2[] => pair().map((ref) => resign({ ...ref, mutations: ref.mutations.map((mutation) => ({ ...mutation, digest: mutation.content === null ? null : { ...mutation.content, bytes: 65, sha256: sha(updateFoundationStagedDigestBytes(mutation.contentHash as LowerHexSha256)) } })) }))],
      ["a forward ref staging other content than the plan", (): UpdateFoundationParticipantRefV2[] => {
        const [forward, compensation] = pair() as [UpdateFoundationParticipantRefV2, UpdateFoundationParticipantRefV2];
        return [resign({ ...forward, mutations: forward.mutations.map((mutation) => ({ ...mutation, content: payload(7, configV2), digest: payload(57, updateFoundationStagedDigestBytes(sha(configV2))) })) }), compensation];
      }],
    ])("refuses %s", (_name, foundation) => {
      expect(() => materializeMigration(configDraft, { foundation: foundation() })).toThrow(/foundation|Foundation/);
    });
  });
});

describe("materializeSchemaMigrations", () => {
  const chainBlobs = [configV2, configV1, configV3, configV2];
  const secondStep: SchemaMigrationDraftV1 = {
    ...row("config-v3", "product_state", 2, 3),
    mutations: [{ path: productPath, beforeHash: sha(configV2), afterBlob: { stream: "output", ordinal: 2, bytes: configV3.byteLength }, inverseBlob: { stream: "output", ordinal: 3, bytes: configV2.byteLength } }],
  };
  const chainContext = (foundation: Map<SchemaMigrationDraftV1["id"], UpdateFoundationParticipantRefV2[]>) =>
    ({ ...context({ outputBlobs: screened(chainBlobs), payloads: new Map(chainBlobs.map((content, ordinal) => [ordinal, payload(ordinal, content)])) }), foundation });

  it("starts each later step from its predecessor's after state", () => {
    const foundation = new Map([
      [configDraft.id, foundationPair(10, configPath, configV1, configV2, 0, 1)],
      [secondStep.id, foundationPair(12, configPath, configV2, configV3, 2, 3)],
    ]);
    const plans = materializeSchemaMigrations([configDraft, secondStep], chainContext(foundation));
    expect(plans.map((entry) => entry.plan.mutations[0]?.beforeHash)).toEqual([sha(configV1), sha(configV2)]);
    expect(plans.map((entry) => entry.inverseVerified)).toEqual([true, true]);
  });

  it("refuses drafts out of execution order and a migration without refs", () => {
    const foundation = new Map([[configDraft.id, foundationPair(10, configPath, configV1, configV2, 0, 1)]]);
    expect(() => materializeSchemaMigrations([secondStep, configDraft], chainContext(foundation))).toThrow(/execution order/);
    expect(() => materializeSchemaMigrations([configDraft, secondStep], chainContext(foundation))).toThrow(/without refs/);
  });

  it("refuses one path reached through both domains", () => {
    const aliased = "/vault/content/notes/a.md" as CanonicalProductStatePathV1;
    const blobs = [configV2, configV1, noteV2, noteV1];
    const base = context({ tokenPaths: new Map([[t(0), aliased]]), outputBlobs: screened(blobs), payloads: new Map(blobs.map((content, ordinal) => [ordinal, payload(ordinal, content)])) });
    const foundation = new Map([
      [configDraft.id, foundationPair(10, aliased, configV1, configV2, 0, 1)],
      [brainDraft.id, foundationPair(12, aliased, noteV1, noteV2, 2, 3)],
    ]);
    expect(() => materializeSchemaMigrations([configDraft, brainDraft], { ...base, foundation })).toThrow(/cross-domain/);
  });
});

describe("retained inverse projection", () => {
  it("expects the after hash and restores the exact before bytes from the rollback payload", () => {
    const { plan } = materializeMigration();
    const rollbackBindingHash = sha("rollback binding");
    const retained = projectRetainedSchemaMigrationInverse(plan, { rollbackBindingHash, firstBlobOrdinal: 3 });
    expect(retained).toEqual({
      schemaVersion: 1,
      kind: "schema_migration_inverse",
      id: plan.id,
      rollbackBindingHash,
      sourceMigrationPlanHash: schemaMigrationPlanHash(plan),
      domain: "product_state",
      fromVersion: 1,
      toVersion: 2,
      mutations: [{ path: configPath, expectedCurrentHash: sha(configV2), restoreHash: sha(configV1), restoreBlob: { path: "blobs/0000000003.bin", bytes: configV1.byteLength, sha256: sha(configV1) } }],
      maximumPlanBytes: 16_777_216,
    });
  });

  it("refuses a blob ordinal past the rollback payload bound", () => {
    const { plan } = materializeMigration();
    expect(() => projectRetainedSchemaMigrationInverse(plan, { rollbackBindingHash: sha("binding"), firstBlobOrdinal: 1_000_000 })).toThrow();
  });
});

describe("validateSchemaMigrationExecutionJournal", () => {
  const plan = (): SchemaMigrationPlanV1 => materializeMigration().plan;
  const journal = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    schemaVersion: 1, id: plan().id, coordinatorId, planHash: schemaMigrationPlanHash(plan()), phase: "planned",
    nextForwardFoundation: 0, compensationNext: null, compactionNext: null,
    createdAt: "2026-09-23T08:00:00.000Z", updatedAt: "2026-09-23T08:00:00.000Z", ...overrides,
  });

  it.each([
    ["planned", {}],
    ["applying", { phase: "applying", nextForwardFoundation: 1 }],
    ["verified", { phase: "verified", nextForwardFoundation: 1 }],
    ["compensating", { phase: "compensating", nextForwardFoundation: 1, compensationNext: 0 }],
    ["rolled back", { phase: "rolled_back", nextForwardFoundation: 1, compensationNext: -1 }],
    ["compacting", { phase: "compacting", nextForwardFoundation: 1, compactionNext: 2 }],
  ])("admits a %s journal", (_name, overrides) => {
    expect(validateSchemaMigrationExecutionJournal(journal(overrides), plan()).phase).toBe(journal(overrides).phase);
  });

  it.each([
    ["an extra key", { bytes: "private" }],
    ["another plan hash", { planHash: sha("other") }],
    ["another coordinator", { coordinatorId: `lc_${nonce}_8` }],
    ["an unknown phase", { phase: "done" }],
    ["a forward cursor past the plan", { phase: "applying", nextForwardFoundation: 2 }],
    ["a planned journal with an advanced cursor", { nextForwardFoundation: 1 }],
    ["verified before every forward ref", { phase: "verified" }],
    ["a compensation cursor outside compensation", { phase: "applying", compensationNext: 0 }],
    ["a compaction cursor past both halves", { phase: "compacting", compactionNext: 3 }],
    ["an update before creation", { updatedAt: "2026-09-22T08:00:00.000Z" }],
  ])("refuses %s", (_name, overrides) => {
    expect(() => validateSchemaMigrationExecutionJournal(journal(overrides), plan())).toThrow();
  });
});

describe("buildUpdateFoundationParticipantRef", () => {
  const at = "2026-09-23T10:00:00.000Z" as UtcTimestampV1;
  const build = (counter: number, role: UpdateFoundationParticipantRefV2["role"], before: Uint8Array, after: Uint8Array, contentOrdinal: number) =>
    buildUpdateFoundationParticipantRef({
      productHome,
      coordinatorId,
      id: tx(counter),
      slot: "schema_forward",
      role,
      mutations: [{ targetPath: configPath, operation: "replace", expectedBeforeHash: sha(before), content: payload(contentOrdinal, after), digest: payload(50 + contentOrdinal, updateFoundationStagedDigestBytes(sha(after))) }],
      journalOrdinal: 100 + counter,
      createdAt: at,
    });

  it("stages at the standard path and hashes the exact planned journal bytes", () => {
    const { ref, initialJournalBytes } = build(10, { kind: "forward", compensationId: tx(11) }, configV1, configV2, 0);
    expect(ref.mutations[0]?.stagedPath).toBe(`${productHome}/staging/transactions/${tx(10)}/0.bin`);
    expect(ref.initialJournal.plannedBytesHash).toBe(sha(initialJournalBytes));
    expect(ref.initialJournal.staged).toMatchObject({ kind: "update_expected", coordinatorId, ordinal: 110, hash: sha(initialJournalBytes), bytes: initialJournalBytes.byteLength, mode: 0o600 });
    expect(JSON.parse(new TextDecoder().decode(initialJournalBytes))).toEqual({
      schemaVersion: 1, id: tx(10), kind: "schema_forward", phase: "planned", createdAt: at, updatedAt: at,
      mutations: [{ targetPath: configPath, operation: "replace", expectedBeforeHash: sha(configV1), stagedRelativePath: "0.bin" }],
    });
    expect(ref.planHash).toBe(updateFoundationParticipantPlanHash(ref));
  });

  it("builds a pair that the schema migration binding admits", () => {
    const forward = build(10, { kind: "forward", compensationId: tx(11) }, configV1, configV2, 0).ref;
    const compensation = build(11, { kind: "compensation", forwardId: tx(10) }, configV2, configV1, 1).ref;
    expect(materializeMigration(configDraft, { foundation: [forward, compensation] }).inverseVerified).toBe(true);
  });

  it("refuses a digest row that is not the content hash sidecar", () => {
    expect(() => buildUpdateFoundationParticipantRef({
      productHome, coordinatorId, id: tx(10), slot: "schema_forward", role: { kind: "forward", compensationId: tx(11) },
      mutations: [{ targetPath: configPath, operation: "replace", expectedBeforeHash: sha(configV1), content: payload(0, configV2), digest: payload(50, configV2) }],
      journalOrdinal: 110, createdAt: at,
    })).toThrow(/digest/);
  });
});
