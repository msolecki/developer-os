import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { serializeConfig } from "../config/index.js";
import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { CanonicalAbsolutePathV1, ExactProductStatePathV1 } from "../update/paths.js";
import { parseLowerHexSha256, parseUInt64Decimal, parseUtcTimestamp, type LowerHexSha256 } from "../update/scalars.js";
import {
  bootstrapExternalShapeHash,
  bootstrapPayloadSourceIdentityHash,
  validateBootstrapPlan,
  validateBootstrapPayloadEvidence,
  type BootstrapExternalShapeProjectionV1,
  type BootstrapPayloadEvidenceV1,
  type BootstrapPayloadSourceV1,
  type FoundationParticipantRefV2,
  type FreshV2InitPlanV1,
  type PlannedCreatedPathV1,
} from "./bootstrap.js";
import type { BootstrapExpectedPayloadRefV1, FreshV2InitIdV1 } from "./manifest-state.js";
import {
  BOOTSTRAP_RETAINED_MAX_ENTRIES,
  BOOTSTRAP_RETAINED_MAX_IDS,
  BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES,
  assertBootstrapRetentionCapacity,
  classifyBootstrapEvidence,
  deriveBootstrapRetentionLocations,
  deriveBootstrapRetentionTable,
  selectBootstrapJournal as selectRetentionJournal,
  validateBootstrapJournalSuccessor as validateRetentionJournalSuccessor,
  type BootstrapJournalRecordV1,
  type BootstrapJournalSelectionV1,
  type BootstrapRetainedExecutionPlanV1,
  type BootstrapRetentionEvidenceProjectionV1,
  type BootstrapRetentionDirectoryEntryV1,
  type BootstrapRetentionPostimageV1,
} from "./bootstrap-retention.js";

const ID = "fi_6ba7b810-9dad-41d1-80b4-00c04fd430c8" as FreshV2InitIdV1;
const CREATED_AT = parseUtcTimestamp("2026-08-31T08:00:00.000Z");
const UPDATED_AT = parseUtcTimestamp("2026-08-31T08:00:01.000Z");
const MAX_UINT64 = "18446744073709551615";

const path = (value: string): CanonicalAbsolutePathV1 => value as CanonicalAbsolutePathV1;
const exactPath = (value: string): ExactProductStatePathV1 => value as ExactProductStatePathV1;
const hash = (value: string) => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const canonicalHash = (value: unknown) => parseLowerHexSha256(
  createHash("sha256").update(encodeCanonicalJson(value as CanonicalJsonValue)).digest("hex"),
);

function domainHash(domain: string, value: unknown): LowerHexSha256 {
  const encoded = encodeCanonicalJson(value as CanonicalJsonValue);
  return parseLowerHexSha256(createHash("sha256").update(domain).update(encoded.slice(0, -1)).digest("hex"));
}

function validatorAdmittedPlanFixture(): {
  readonly plan: BootstrapRetainedExecutionPlanV1;
  readonly persistedPlan: FreshV2InitPlanV1;
  readonly admittedPersistedPlan: FreshV2InitPlanV1;
  readonly admissionContext: Parameters<typeof validateBootstrapPlan>[1];
} {
  const stateParent = { kind: "preexisting" as const, path: path("/product/state"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") };
  const transactionsParent = { kind: "preexisting" as const, path: path("/product/staging/transactions"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("20") };
  const forwardId = `tx_fi_${String(ID).slice(3)}_0000000000_f` as const;
  const compensationId = `tx_fi_${String(ID).slice(3)}_0000000000_c` as const;
  const configValue = {
    schemaVersion: 1,
    brainPath: "/synthetic/brain",
    adapters: { claude: true, codex: true },
    git: { enabled: false },
    automation: { enabled: false },
    telemetry: false,
  } as const;
  const configBytes = new TextEncoder().encode(serializeConfig(configValue));
  const configHash = parseLowerHexSha256(createHash("sha256").update(configBytes).digest("hex"));
  const digestBytes = new TextEncoder().encode(`${configHash}\n`);
  const manifestValue = { schemaVersion: 2, synthetic: "manifest" } as const;
  const nonceValue = hash("install-nonce");
  const allocatorValue = { schemaVersion: 1, installNonce: nonceValue, nextCounter: "0" } as const;
  const activeValue = { schemaVersion: 1, synthetic: "active-release" } as const;
  const trustValue = { schemaVersion: 1, synthetic: "release-trust" } as const;
  const forwardJournalValue = {
    schemaVersion: 1,
    id: forwardId,
    kind: "fresh_init_artifacts",
    phase: "planned",
    createdAt: "2026-08-31T08:00:00.000Z",
    updatedAt: "2026-08-31T08:00:00.000Z",
    mutations: [{
      targetPath: "/product/config.toml",
      operation: "create",
      expectedBeforeHash: null,
      stagedRelativePath: "0.bin",
    }],
  } as const;
  const compensationJournalValue = {
    schemaVersion: 1,
    id: compensationId,
    kind: "fresh_init_artifacts",
    phase: "planned",
    createdAt: "2026-08-31T08:00:00.000Z",
    updatedAt: "2026-08-31T08:00:00.000Z",
    mutations: [{
      targetPath: "/product/config.toml",
      operation: "remove",
      expectedBeforeHash: configHash,
      stagedRelativePath: null,
    }],
  } as const;
  const foundationBytes = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  const canonicalBytes = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value as CanonicalJsonValue));
  const ref = (ordinal: number, bytes: Uint8Array): BootstrapExpectedPayloadRefV1 => ({
    kind: "bootstrap_expected",
    bootstrapId: ID,
    ordinal,
    path: path(`/product/state/.fresh-v2-init.${ID}.${String(ordinal).padStart(10, "0")}.payload`) as BootstrapExpectedPayloadRefV1["path"],
    hash: parseLowerHexSha256(createHash("sha256").update(bytes).digest("hex")),
    bytes: bytes.byteLength,
    mode: 0o600,
  });
  const compensationRef = ref(0, foundationBytes(compensationJournalValue));
  const forwardRef = ref(1, foundationBytes(forwardJournalValue));
  const packageBytes = new TextEncoder().encode("synthetic package payload");
  const packageRef = ref(2, packageBytes);
  const configRef = ref(3, configBytes);
  const digestRef = ref(4, digestBytes);
  const manifestRef = ref(5, canonicalBytes(manifestValue));
  const nonceRef = ref(6, new TextEncoder().encode(`${nonceValue}\n`));
  const allocatorRef = ref(7, canonicalBytes(allocatorValue));
  const activeRef = ref(8, canonicalBytes(activeValue));
  const trustRef = ref(9, canonicalBytes(trustValue));
  const planDerived = (
    role: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>["role"],
    value: CanonicalJsonValue,
    bytes: Uint8Array,
  ): Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }> => ({
    kind: "plan_derived",
    role,
    value,
    valueBytes: bytes.byteLength - 1,
    projectionHash: domainHash(`developer-os/bootstrap-plan-derived/${role}/v1\0`, { role, value }),
  });
  const stagedPath = path(`/product/staging/transactions/${forwardId}/0.bin`);
  const forwardMutation = {
    targetPath: path("/product/config.toml"),
    operation: "create" as const,
    expectedBeforeHash: null,
    contentHash: configHash,
    contentSize: configBytes.byteLength,
    stagedPath,
    content: configRef,
    digest: digestRef,
  };
  const compensationMutation = {
    targetPath: path("/product/config.toml"),
    operation: "remove" as const,
    expectedBeforeHash: configHash,
    contentHash: null,
    contentSize: null,
    stagedPath: null,
    content: null,
    digest: null,
  };
  const participant = (
    id: typeof forwardId | typeof compensationId,
    role: FoundationParticipantRefV2["role"],
    mutation: typeof forwardMutation | typeof compensationMutation,
    staged: BootstrapExpectedPayloadRefV1,
  ): FoundationParticipantRefV2 => {
    const candidate: FoundationParticipantRefV2 = {
      id,
      slot: "fresh_init_artifacts",
      role,
      mutations: [mutation],
      maximumJournalBytes: 1_048_576,
      planHash: hash("placeholder"),
      initialJournal: {
        finalPath: path(`/product/state/transactions/${id}.json`),
        plannedBytesHash: staged.hash,
        staged,
      },
    };
    return {
      ...candidate,
      planHash: domainHash("developer-os/foundation-participant-plan/v2\0", {
        schemaVersion: 2,
        id: candidate.id,
        slot: candidate.slot,
        role: candidate.role,
        mutations: candidate.mutations,
        maximumJournalBytes: candidate.maximumJournalBytes,
        initialJournal: {
          finalPath: candidate.initialJournal.finalPath,
          staged: {
            kind: staged.kind,
            bootstrapId: staged.bootstrapId,
            ordinal: staged.ordinal,
            path: staged.path,
            bytes: staged.bytes,
            mode: staged.mode,
          },
        },
      }),
    };
  };
  const compensation = participant(
    compensationId,
    { kind: "compensation", forwardId },
    compensationMutation,
    compensationRef,
  );
  const forward = participant(
    forwardId,
    { kind: "forward", compensationId },
    forwardMutation,
    forwardRef,
  );
  const createdPaths: PlannedCreatedPathV1[] = [
    {
      kind: "global_lock", path: path("/product/state/.lifecycle.lock"), expectedBefore: "absent",
      ownerUid: 501, mode: 0o600, parent: stateParent, cleanup: "remove_on_compensation",
    },
    {
      kind: "directory", path: path(`/product/staging/fresh-v2-init/${ID}`), expectedBefore: "absent",
      ownerUid: 501, mode: 0o700,
      parent: {
        kind: "preexisting", path: path("/product/staging/fresh-v2-init"),
        dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("21"),
      },
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory", path: path(`/product/staging/transactions/${forwardId}`), expectedBefore: "absent",
      ownerUid: 501, mode: 0o700, parent: transactionsParent, cleanup: "remove_on_compensation",
    },
    {
      kind: "file", path: stagedPath, expectedBefore: "absent", ownerUid: 501, payload: configRef,
      parent: { kind: "created_path", scope: "ordinary", ordinal: 2 }, cleanup: "remove_on_compensation",
    },
    {
      kind: "file", path: path(`${stagedPath}.sha256`), expectedBefore: "absent", ownerUid: 501, payload: digestRef,
      parent: { kind: "created_path", scope: "ordinary", ordinal: 2 }, cleanup: "remove_on_compensation",
    },
  ];
  const launchabilityPaths: PlannedCreatedPathV1[] = [
    {
      kind: "directory", path: path("/product/releases"), expectedBefore: "absent", ownerUid: 501,
      mode: 0o700, parent: { kind: "preexisting", path: path("/product"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("1") }, cleanup: "remove_on_compensation",
    },
    {
      kind: "file", path: path("/product/releases/bundle.bin"), expectedBefore: "absent", ownerUid: 501,
      payload: packageRef, parent: { kind: "created_path", scope: "launchability", ordinal: 0 }, cleanup: "remove_on_compensation",
    },
    {
      kind: "directory", path: path("/product/state/lifecycle-journals"), expectedBefore: "absent", ownerUid: 501,
      mode: 0o700, parent: stateParent, cleanup: "remove_on_compensation",
    },
    ...[
      ["/product/state/lifecycle-install-nonce", nonceRef],
      ["/product/state/lifecycle-id-allocator.json", allocatorRef],
      ["/product/state/release-trust.json", trustRef],
      ["/product/state/active-release.json", activeRef],
    ].map(([target, payload]) => ({
      kind: "file" as const,
      path: path(target as string),
      expectedBefore: "absent" as const,
      ownerUid: 501,
      payload: payload as BootstrapExpectedPayloadRefV1,
      parent: stateParent,
      cleanup: "remove_on_compensation" as const,
    })),
  ];
  const manifest = {
    schemaVersion: 1 as const,
    participantId: `mf_${ID}` as never,
    envelope: { kind: "fresh_v2_init" as const, id: ID },
    bindings: {
      foundationTransactions: {
        count: 1,
        orderedIdsHash: parseLowerHexSha256(createHash("sha256")
          .update("developer-os/manifest-foundation-bindings/v1\0")
          .update(JSON.stringify([forwardId]))
          .digest("hex")),
      },
      externalEffects: [],
    },
    manifestPath: path("/product/state/installation-manifest.json"),
    tombstonePath: path(`/product/state/.installation-manifest.mf_${ID}.json.tombstone`),
    before: { state: "absent" as const },
    after: {
      state: "present" as const,
      hash: manifestRef.hash,
      bytes: manifestRef,
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      size: parseUInt64Decimal(String(manifestRef.bytes)),
      dev: null,
      ino: null,
    },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const externalShape = {
    entries: [
      { role: "product_home", pathHash: hash("/product"), kind: "directory", ownerUid: 501, mode: 0o700, nlink: 2, size: parseUInt64Decimal("64"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("1") },
      { role: "state_directory", pathHash: hash("/product/state"), kind: "directory", ownerUid: 501, mode: 0o700, nlink: 2, size: parseUInt64Decimal("96"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") },
      { role: "bootstrap_lock", pathHash: hash("/product/state/.lifecycle-bootstrap.lock"), kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 1, size: parseUInt64Decimal("0"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("10") },
    ],
  } as unknown as BootstrapExternalShapeProjectionV1;
  const payloads = [
    { ref: compensationRef, source: planDerived("foundation_initial_journal", compensationJournalValue, foundationBytes(compensationJournalValue)) },
    { ref: forwardRef, source: planDerived("foundation_initial_journal", forwardJournalValue, foundationBytes(forwardJournalValue)) },
    { ref: packageRef, source: { kind: "guarded_package_file" as const, packageRoot: path("/synthetic/package"), packageRootDev: parseUInt64Decimal("2"), packageRootIno: parseUInt64Decimal("1"), packageInventoryHash: hash("package-inventory"), relativePath: "bundle.bin" as never, sourceBytes: packageRef.bytes, sourceHash: packageRef.hash, sourceMode: 0o600 as const, sourceDev: parseUInt64Decimal("2"), sourceIno: parseUInt64Decimal("2") } },
    { ref: configRef, source: planDerived("foundation_config", configValue, configBytes) },
    { ref: digestRef, source: planDerived("foundation_staged_digest", configHash, digestBytes) },
    { ref: manifestRef, source: planDerived("manifest_after", manifestValue, canonicalBytes(manifestValue)) },
    { ref: nonceRef, source: planDerived("lifecycle_nonce", nonceValue, new TextEncoder().encode(`${nonceValue}\n`)) },
    { ref: allocatorRef, source: planDerived("lifecycle_allocator", allocatorValue, canonicalBytes(allocatorValue)) },
    { ref: activeRef, source: planDerived("active_release", activeValue, canonicalBytes(activeValue)) },
    { ref: trustRef, source: planDerived("release_trust", trustValue, canonicalBytes(trustValue)) },
  ];
  const persistedPlan: FreshV2InitPlanV1 = {
    schemaVersion: 1,
    operation: "fresh_v2_init",
    id: ID,
    admittedExternalShapeHash: bootstrapExternalShapeHash(externalShape),
    v2ManifestHash: manifestRef.hash,
    bootstrapIdentity: {
      path: path("/product/state/.lifecycle-bootstrap.lock"), ownerUid: 501, mode: 0o600,
      nlink: 1, size: 0, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("10"),
    },
    planPath: exactPath(`/product/state/fresh-v2-init.${ID}.plan.json`),
    journalSlots: [
      { slot: 0, path: exactPath(`/product/state/fresh-v2-init.${ID}.journal.0.json`), ownerUid: 501, mode: 0o600, nlink: 1, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("11") },
      { slot: 1, path: exactPath(`/product/state/fresh-v2-init.${ID}.journal.1.json`), ownerUid: 501, mode: 0o600, nlink: 1, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("12") },
    ],
    stagingRoot: path(`/product/staging/fresh-v2-init/${ID}`),
    maximumPlanBytes: 268_435_456,
    maximumJournalBytes: 1_048_576,
    maximumStagingEntries: 65,
    payloads,
    createdPaths,
    foundationParticipants: [compensation, forward],
    launchabilityPaths,
    manifest,
  };
  const evidence = {
    reopenCanonicalAbsolutePath: (candidate: string) => candidate,
    containsCanonicalPath: (root: string, candidate: string) => candidate.startsWith(`${root}/`),
    hasFoldedAlias: () => false,
  };
  const admissionContext: Parameters<typeof validateBootstrapPlan>[1] = {
    evidence,
    productHome: path("/product"),
    stateRoot: path("/product/state"),
    productStagingRoot: path("/product/staging"),
    operation: "fresh_v2_init",
    id: ID,
    bootstrapIdentity: persistedPlan.bootstrapIdentity,
    externalShape,
    admitPayloadSource: (source: BootstrapPayloadSourceV1) => structuredClone(source),
    admitPlannedCreatedPath: (value: PlannedCreatedPathV1) => structuredClone(value),
    admitPreexistingParent: (value) => structuredClone(value),
    admitFoundationParticipant: (value: FoundationParticipantRefV2) => structuredClone(value),
    admitManifestParticipant: () => structuredClone(manifest),
    admitPlanDerivedValue: (_role, value) => structuredClone(value),
  };
  const admittedPersistedPlan = validateBootstrapPlan(persistedPlan, admissionContext) as FreshV2InitPlanV1;
  return {
    persistedPlan,
    admittedPersistedPlan,
    admissionContext,
    plan: {
      ...admittedPersistedPlan,
    },
  };
}

const planFixture = validatorAdmittedPlanFixture();
const plan = planFixture.plan;

it("uses a validator-admitted content-free primary plan fixture", () => {
  expect(validateBootstrapPlan(planFixture.persistedPlan, planFixture.admissionContext)).toEqual(
    planFixture.admittedPersistedPlan,
  );
  expect(plan.createdPaths[0]?.kind).toBe("global_lock");
  expect(plan.foundationParticipants.map((participant) => participant.role.kind)).toEqual([
    "compensation",
    "forward",
  ]);
  expect(plan.launchabilityPaths).toHaveLength(7);
});

function selectBootstrapJournal(
  executionPlan: BootstrapRetainedExecutionPlanV1,
  slots: readonly [unknown, unknown],
) {
  return selectRetentionJournal(executionPlan, admittedEvidence(), slots);
}

function validateBootstrapJournalSuccessor(
  executionPlan: BootstrapRetainedExecutionPlanV1,
  current: BootstrapJournalRecordV1,
  next: BootstrapJournalRecordV1,
) {
  return validateRetentionJournalSuccessor(executionPlan, admittedEvidence(), current, next);
}

function journal(overrides: Partial<BootstrapJournalRecordV1> = {}): BootstrapJournalRecordV1 {
  return {
    schemaVersion: 1, id: ID, planHash: canonicalHash(plan), slot: 0,
    sequence: parseUInt64Decimal("0"), previousJournalHash: null, phase: "planned", direction: "forward",
    nextPayload: 0, payloadWriteState: { state: "idle" }, nextCreatedPath: 0,
    nextFoundationParticipant: 0, nextLaunchabilityPath: 0, manifestCursor: 0,
    compensationNext: null, payloadRetentionPart: null, terminalOutcome: null, retentionNext: null,
    createdAt: CREATED_AT, updatedAt: UPDATED_AT, ...overrides,
  };
}

function historicalJournal(overrides: Partial<BootstrapJournalRecordV1> = {}): BootstrapJournalRecordV1 {
  return journal({
    slot: 1,
    sequence: parseUInt64Decimal("1"),
    previousJournalHash: hash("sequence-zero"),
    ...overrides,
  });
}

function successor(current: BootstrapJournalRecordV1, overrides: Partial<BootstrapJournalRecordV1>): BootstrapJournalRecordV1 {
  return journal({
    ...current, ...overrides, slot: current.slot === 0 ? 1 : 0,
    sequence: parseUInt64Decimal((BigInt(current.sequence) + 1n).toString()),
    previousJournalHash: canonicalHash(current),
  });
}

function retentionTerminalPreimage(
  terminal: BootstrapJournalRecordV1,
): NonNullable<BootstrapJournalRecordV1["retentionTerminalPreimage"]> {
  return {
    previousJournalHash: terminal.previousJournalHash,
    updatedAt: terminal.updatedAt,
  };
}

function retainingSuccessor(
  terminal: BootstrapJournalRecordV1,
): BootstrapJournalRecordV1 {
  return successor(terminal, {
    phase: "retaining",
    retentionNext: 0,
    retentionTerminalPreimage: retentionTerminalPreimage(terminal),
  });
}

function phaseRecord(phase: BootstrapJournalRecordV1["phase"], overrides: Partial<BootstrapJournalRecordV1> = {}): BootstrapJournalRecordV1 {
  const complete = {
    nextPayload: plan.payloads.length,
    nextCreatedPath: plan.createdPaths.length,
    nextFoundationParticipant: plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length,
    nextLaunchabilityPath: plan.launchabilityPaths.length,
  };
  const values: Record<BootstrapJournalRecordV1["phase"], Partial<BootstrapJournalRecordV1>> = {
    planned: {}, payload_staging: {}, creating: { nextPayload: complete.nextPayload },
    foundation_applying: { nextPayload: complete.nextPayload, nextCreatedPath: complete.nextCreatedPath },
    launchability_publishing: {
      nextPayload: complete.nextPayload,
      nextCreatedPath: complete.nextCreatedPath,
      nextFoundationParticipant: complete.nextFoundationParticipant,
    },
    manifest_publishing: complete, verifying: { ...complete, manifestCursor: 2 },
    compensating: { direction: "compensating", nextPayload: 1, compensationNext: 0 },
    finalized: { ...complete, manifestCursor: 3, terminalOutcome: "finalized" },
    rolled_back: { direction: "compensating", nextPayload: 1, compensationNext: -1, terminalOutcome: "rolled_back" },
    retaining: {
      ...complete,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      retentionNext: 0,
      retentionTerminalPreimage: {
        previousJournalHash: hash("sequence-zero"),
        updatedAt: UPDATED_AT,
      },
    },
    retained: {
      ...complete,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      retentionNext: retentionEntryCount(),
      retentionTerminalPreimage: {
        previousJournalHash: hash("sequence-zero"),
        updatedAt: UPDATED_AT,
      },
    },
  };
  const value = { phase, ...values[phase], ...overrides };
  return phase === "planned" ? journal(value) : historicalJournal(value);
}

describe("retained bootstrap journal chains", () => {
  it("selects only one adjacent hash-bound journal successor", () => {
    const terminal = phaseRecord("finalized", {
      slot: 0,
      sequence: parseUInt64Decimal("36"),
      previousJournalHash: hash("journal-35"),
    });
    const current = phaseRecord("retaining", {
      slot: 0,
      sequence: parseUInt64Decimal("40"),
      previousJournalHash: hash("journal-39"),
      retentionNext: 3,
      retentionTerminalPreimage: retentionTerminalPreimage(terminal),
    });
    const next = successor(current, { retentionNext: 4 });
    expect(selectRetentionJournal(plan, admittedEvidence(terminal), [current, next])).toEqual({ current: next, inactiveSlot: 0 });
  });

  it.each([
    ["gap", "40", "43", 3, 4, true], ["fork", "40", "40", 3, 4, true],
    ["wrong predecessor", "40", "41", 3, 4, false], ["illegal cursor", "40", "41", 3, 5, true],
  ] as const)("refuses a %s journal chain", (_name, first, second, before, after, correctHash) => {
    const terminal = phaseRecord("finalized", {
      slot: 0,
      sequence: parseUInt64Decimal("36"),
      previousJournalHash: hash("journal-35"),
    });
    const current = phaseRecord("retaining", {
      slot: 0,
      sequence: parseUInt64Decimal(first),
      previousJournalHash: hash("earlier"),
      retentionNext: before,
      retentionTerminalPreimage: retentionTerminalPreimage(terminal),
    });
    const next = phaseRecord("retaining", {
      slot: 1,
      sequence: parseUInt64Decimal(second),
      previousJournalHash: correctHash ? canonicalHash(current) : hash("wrong"),
      retentionNext: after,
      retentionTerminalPreimage: retentionTerminalPreimage(terminal),
    });
    expect(() => selectRetentionJournal(plan, admittedEvidence(terminal), [current, next])).toThrow();
  });

  it("refuses a same-slot tuple and invalid slot identities", () => {
    expect(() => selectBootstrapJournal(plan, [journal({ slot: 1 }), null])).toThrow();
    const reversed = { ...plan, journalSlots: [plan.journalSlots[1], plan.journalSlots[0]] } as BootstrapRetainedExecutionPlanV1;
    expect(() => selectBootstrapJournal(reversed, [journal(), null])).toThrow();
  });

  it("accepts one current slot beside an empty or partial inactive observation", () => {
    const current = journal();
    expect(selectBootstrapJournal(plan, [current, null])).toEqual({ current, inactiveSlot: 1 });
    expect(selectBootstrapJournal(plan, [current, "partial canonical bytes"])).toEqual({ current, inactiveSlot: 1 });
    expect(() => selectBootstrapJournal(plan, [null, null])).toThrow();
  });

  it("selects a preterminal journal without fabricated terminal retention evidence", () => {
    const current = journal();
    const preterminalEvidence = {
      bootstrapId: ID,
      terminalJournal: null,
      payloadEvidence: [],
      createdPathEvidence: [],
      rows: [],
    } as unknown as BootstrapRetentionEvidenceProjectionV1;

    expect(selectRetentionJournal(plan, preterminalEvidence, [current, null])).toEqual({
      current,
      inactiveSlot: 1,
    });
  });

  it("validates a preterminal successor without fabricated terminal retention evidence", () => {
    const current = journal();
    const next = successor(current, { phase: "payload_staging" });
    const preterminalEvidence = {
      bootstrapId: ID,
      terminalJournal: null,
      payloadEvidence: [],
      createdPathEvidence: [],
      rows: [],
    } as unknown as BootstrapRetentionEvidenceProjectionV1;

    expect(validateRetentionJournalSuccessor(plan, preterminalEvidence, current, next)).toEqual(next);
  });

  it("refuses observations outside the two plan-bound journal slots", () => {
    expect(() => selectBootstrapJournal(
      plan,
      [journal(), null, journal()] as unknown as readonly [unknown, unknown],
    )).toThrow();
  });

  it("admits sequence zero and UInt64 maximum but refuses predecessor and overflow errors", () => {
    expect(selectBootstrapJournal(plan, [journal(), null]).current.sequence).toBe("0");
    expect(() => selectBootstrapJournal(plan, [journal({ previousJournalHash: hash("not-null") }), null])).toThrow();
    const maximum = historicalJournal({ sequence: parseUInt64Decimal(MAX_UINT64), previousJournalHash: hash("predecessor") });
    expect(selectBootstrapJournal(plan, [null, maximum]).current.sequence).toBe(MAX_UINT64);
    expect(() => validateBootstrapJournalSuccessor(plan, maximum, {
      ...maximum, slot: 0, sequence: "18446744073709551616" as BootstrapJournalRecordV1["sequence"], previousJournalHash: canonicalHash(maximum),
    })).toThrow();
  });

  it("refuses a terminal sequence-zero root instead of fabricating the initial planned authority", () => {
    expect(() => selectBootstrapJournal(plan, [phaseRecord("finalized", {
      slot: 0,
      sequence: parseUInt64Decimal("0"),
      previousJournalHash: null,
    }), null])).toThrow();
  });

  it("refuses a journal whose slot does not equal its sequence parity", () => {
    expect(() => selectBootstrapJournal(plan, [journal({
      sequence: parseUInt64Decimal("1"),
      previousJournalHash: hash("sequence-zero"),
    }), null])).toThrow();
  });

  it("hashes complete canonical predecessor bytes including LF", () => {
    const terminal = phaseRecord("finalized");
    const current = retainingSuccessor(terminal);
    const canonical = encodeCanonicalJson(current as unknown as CanonicalJsonValue);
    const withoutLf = parseLowerHexSha256(createHash("sha256").update(canonical.slice(0, -1)).digest("hex"));
    expect(validateRetentionJournalSuccessor(plan, admittedEvidence(terminal), current, successor(current, { retentionNext: 1 }))).toEqual(successor(current, { retentionNext: 1 }));
    expect(() => validateRetentionJournalSuccessor(plan, admittedEvidence(terminal), current, {
      ...successor(current, { retentionNext: 1 }), previousJournalHash: withoutLf,
    })).toThrow();
  });

  it("selects the exact first retained cursor pair after terminal bytes leave both slots", () => {
    const terminal = phaseRecord("finalized", {
      slot: 0,
      sequence: parseUInt64Decimal("36"),
      previousJournalHash: hash("journal-35"),
    });
    const retainingZero = retainingSuccessor(terminal);
    const retainingOne = successor(retainingZero, { retentionNext: 1 });
    const slots = retainingZero.slot === 0
      ? [retainingZero, retainingOne] as const
      : [retainingOne, retainingZero] as const;

    expect(selectRetentionJournal(plan, admittedEvidence(terminal), slots)).toEqual({
      current: retainingOne,
      inactiveSlot: retainingZero.slot,
    });
  });

  it("selects an exact singleton retaining cursor zero", () => {
    const terminal = phaseRecord("finalized");
    const retainingZero = retainingSuccessor(terminal);
    const slots = retainingZero.slot === 0
      ? [retainingZero, null] as const
      : [null, retainingZero] as const;

    expect(selectRetentionJournal(plan, admittedEvidence(terminal), slots)).toEqual({
      current: retainingZero,
      inactiveSlot: terminal.slot,
    });
  });

  it("refuses a first retained cursor pair forked from the terminal predecessor", () => {
    const terminal = phaseRecord("finalized", {
      slot: 0,
      sequence: parseUInt64Decimal("36"),
      previousJournalHash: hash("journal-35"),
    });
    const retainingZero = {
      ...retainingSuccessor(terminal),
      previousJournalHash: hash("forged-terminal-predecessor"),
    };
    const retainingOne = successor(retainingZero, { retentionNext: 1 });
    const slots = retainingZero.slot === 0
      ? [retainingZero, retainingOne] as const
      : [retainingOne, retainingZero] as const;

    expect(() => selectRetentionJournal(plan, admittedEvidence(terminal), slots)).toThrow();
  });

  it.each([
    ["planned", "payload_staging"], ["payload_staging", "creating"], ["creating", "foundation_applying"],
    ["foundation_applying", "launchability_publishing"], ["launchability_publishing", "manifest_publishing"],
    ["manifest_publishing", "verifying"], ["verifying", "finalized"], ["finalized", "retaining"], ["rolled_back", "retaining"],
  ] as const)("accepts the legal %s -> %s phase transition", (from, to) => {
    let current = phaseRecord(from);
    let next = phaseRecord(to);
    if (from === "payload_staging") current = phaseRecord(from, { nextPayload: plan.payloads.length });
    if (from === "creating") current = phaseRecord(from, { nextCreatedPath: plan.createdPaths.length });
    if (from === "foundation_applying") current = phaseRecord(from, {
      nextFoundationParticipant: plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length,
    });
    if (from === "launchability_publishing") current = phaseRecord(from, { nextLaunchabilityPath: plan.launchabilityPaths.length });
    if (from === "manifest_publishing") current = phaseRecord(from, { manifestCursor: 2 });
    if (from === "verifying") current = phaseRecord(from, { manifestCursor: 3 });
    if (from === "rolled_back") {
      next = retainingSuccessor(current);
    } else {
      next = successor(current, next);
    }
    const evidence = from === "rolled_back"
      ? admittedEvidence(current)
      : admittedEvidence();
    expect(validateRetentionJournalSuccessor(plan, evidence, current, next)).toEqual(next);
  });

  it("accepts compensation entry and terminalization", () => {
    const forward = phaseRecord("payload_staging", { nextPayload: 1 });
    const compensating = successor(forward, phaseRecord("compensating"));
    const staged = successor(compensating, { payloadRetentionPart: "staged_file" });
    const evidence = successor(staged, { payloadRetentionPart: "evidence" });
    const drained = successor(evidence, { compensationNext: -1, payloadRetentionPart: null });
    const rolledBack = successor(drained, phaseRecord("rolled_back"));
    expect(validateBootstrapJournalSuccessor(plan, forward, compensating)).toEqual(compensating);
    expect(validateBootstrapJournalSuccessor(plan, compensating, staged)).toEqual(staged);
    expect(validateBootstrapJournalSuccessor(plan, staged, evidence)).toEqual(evidence);
    expect(validateBootstrapJournalSuccessor(plan, evidence, drained)).toEqual(drained);
    expect(validateBootstrapJournalSuccessor(plan, drained, rolledBack)).toEqual(rolledBack);
  });

  it("retains an in-progress writing payload only through its exact identity stages", () => {
    const writingState = {
      state: "writing" as const,
      ordinal: 0,
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("30"),
    };
    const writing = phaseRecord("payload_staging", { nextPayload: 0, payloadWriteState: writingState });
    const compensating = successor(writing, phaseRecord("compensating", {
      nextPayload: 0,
      payloadWriteState: writingState,
      compensationNext: 0,
    }));
    const staged = successor(compensating, { payloadRetentionPart: "staged_file" });
    const evidence = successor(staged, { payloadRetentionPart: "evidence" });
    const drained = successor(evidence, {
      payloadRetentionPart: null,
      compensationNext: -1,
    });
    const rolledBack = successor(drained, { phase: "rolled_back", terminalOutcome: "rolled_back" });

    expect(validateBootstrapJournalSuccessor(plan, writing, compensating)).toEqual(compensating);
    expect(validateBootstrapJournalSuccessor(plan, compensating, staged)).toEqual(staged);
    expect(validateBootstrapJournalSuccessor(plan, staged, evidence)).toEqual(evidence);
    expect(validateBootstrapJournalSuccessor(plan, evidence, drained)).toEqual(drained);
    expect(validateBootstrapJournalSuccessor(plan, drained, rolledBack)).toEqual(rolledBack);

    const createIntent = phaseRecord("compensating", {
      nextPayload: 0,
      payloadWriteState: { state: "create_intent", ordinal: 0 },
      compensationNext: 0,
    });
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      createIntent,
      successor(createIntent, { payloadRetentionPart: "staged_file" }),
    )).toThrow();
  });

  it("clears a compensating create intent after an exact absent-path observation", () => {
    const createIntent = phaseRecord("compensating", {
      nextPayload: 0,
      payloadWriteState: { state: "create_intent", ordinal: 0 },
      compensationNext: 0,
    });
    const cleared = successor(createIntent, {
      payloadWriteState: { state: "idle" },
      compensationNext: -1,
    });

    expect(validateBootstrapJournalSuccessor(plan, createIntent, cleared)).toEqual(cleared);
  });

  it("binds a compensating create intent to the observed exact empty-path identity", () => {
    const createIntent = phaseRecord("compensating", {
      nextPayload: 0,
      payloadWriteState: { state: "create_intent", ordinal: 0 },
      compensationNext: 0,
    });
    const writing = successor(createIntent, {
      payloadWriteState: {
        state: "writing",
        ordinal: 0,
        dev: parseUInt64Decimal("1"),
        ino: parseUInt64Decimal("30"),
      },
    });

    expect(validateBootstrapJournalSuccessor(plan, createIntent, writing)).toEqual(writing);
  });

  it("refuses skipped, reversed, and cursor-moving payload retention substates", () => {
    const compensating = phaseRecord("compensating");
    const staged = successor(compensating, { payloadRetentionPart: "staged_file" });
    const evidence = successor(staged, { payloadRetentionPart: "evidence" });
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      compensating,
      successor(compensating, { payloadRetentionPart: "evidence" }),
    )).toThrow();
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      evidence,
      successor(evidence, { payloadRetentionPart: "staged_file" }),
    )).toThrow();
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      staged,
      successor(staged, { compensationNext: -1 }),
    )).toThrow();
  });

  it("checks retaining and retained cursor zero, last, and first-over", () => {
    const terminal = phaseRecord("finalized");
    const last = retentionEntryCount() - 1;
    const zero = retainingSuccessor(terminal);
    expect(validateRetentionJournalSuccessor(plan, admittedEvidence(terminal), zero, successor(zero, { retentionNext: 1 })).retentionNext).toBe(1);
    const lastSequence = BigInt(terminal.sequence) + BigInt(last) + 1n;
    const lastRetaining = phaseRecord("retaining", {
      slot: Number(lastSequence % 2n) as 0 | 1,
      sequence: parseUInt64Decimal(lastSequence.toString()),
      previousJournalHash: hash("last-retaining-predecessor"),
      retentionNext: last,
    });
    const retained = successor(lastRetaining, {
      phase: "retained", retentionNext: retentionEntryCount(),
    });
    expect(() => validateRetentionJournalSuccessor(plan, admittedEvidence(terminal), retained, retained)).toThrow();
    expect(validateRetentionJournalSuccessor(
      plan,
      admittedEvidence(terminal),
      lastRetaining,
      retained,
    ).retentionNext).toBe(retentionEntryCount());
    const retainedSlots = lastRetaining.slot === 0
      ? [lastRetaining, retained] as const
      : [retained, lastRetaining] as const;
    expect(selectRetentionJournal(plan, admittedEvidence(terminal), retainedSlots).current.retentionNext).toBe(retentionEntryCount());
    const firstOver = { ...retained, retentionNext: retentionEntryCount() + 1 };
    expect(() => selectRetentionJournal(plan, admittedEvidence(terminal), lastRetaining.slot === 0
      ? [lastRetaining, firstOver]
      : [firstOver, lastRetaining])).toThrow();
  });

  it("refuses retained before the derived retention table is complete", () => {
    expect(() => selectBootstrapJournal(
      plan,
      [null, phaseRecord("retained", { retentionNext: 0 })],
    )).toThrow();
  });

  it("refuses a retaining rollback journal whose outcome disagrees with the table's terminal journal", () => {
    const rollback = historicalJournal({
      phase: "rolled_back", direction: "compensating", nextPayload: 1, nextCreatedPath: 1,
      nextFoundationParticipant: 1, nextLaunchabilityPath: 0, manifestCursor: 0,
      compensationNext: -1, terminalOutcome: "rolled_back",
    });
    const current = retainingSuccessor(rollback);
    expect(() => selectRetentionJournal(plan, admittedEvidence(), [current, null])).toThrow();
  });

  it("refuses a retaining rollback journal with a different reached prefix from its terminal journal", () => {
    const base = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const ordinaryCreationEvidence = base.rows.find((row) =>
      row.role === "creation_evidence" && row.sourcePath.includes(".ordinary."),
    );
    if (ordinaryCreationEvidence === undefined) throw new Error("fixture requires ordinary creation evidence");
    const terminal = historicalJournal({
      phase: "rolled_back", direction: "compensating", nextPayload: 1, nextCreatedPath: 1,
      nextFoundationParticipant: 1, nextLaunchabilityPath: 0, manifestCursor: 0,
      compensationNext: -1, terminalOutcome: "rolled_back",
    });
    const evidence = {
      ...base,
      terminalJournal: terminal,
      createdPathEvidence: base.createdPathEvidence.filter((row) => row.value.scope === "ordinary"),
      rows: [
        ...base.rows.filter((row) =>
          row.role === "payload" ||
          row.role === "payload_evidence" ||
          row.role === "foundation_bootstrap" ||
          row.role === "staging_subtree" ||
          row.role === "bootstrap_lock",
        ),
        ordinaryCreationEvidence,
        {
          role: "compensation_target" as const,
          sourcePath: plan.createdPaths[0]?.path as CanonicalAbsolutePathV1,
          parent: parent(stagingRoot, "33"),
          postimage: tree("34"),
        },
      ],
    };
    const mismatchedTerminal = historicalJournal({
      phase: "rolled_back", direction: "compensating", nextPayload: 1, nextCreatedPath: 0,
      nextFoundationParticipant: 0, nextLaunchabilityPath: 0, manifestCursor: 0,
      compensationNext: -1, terminalOutcome: "rolled_back",
    });
    const current = retainingSuccessor(mismatchedTerminal);
    expect(() => selectRetentionJournal(plan, evidence, [current, null])).toThrow();
  });

  it.each([
    ["created timestamp", (current: BootstrapJournalRecordV1) => ({
      ...current,
      createdAt: parseUtcTimestamp("2026-08-31T07:59:59.000Z"),
    })],
    ["sequence and slot order", (current: BootstrapJournalRecordV1) => ({
      ...current,
      slot: 1 as const,
      sequence: parseUInt64Decimal("3"),
    })],
    ["terminal predecessor hash", (current: BootstrapJournalRecordV1) => ({
      ...current,
      previousJournalHash: hash("unrelated-terminal"),
    })],
    ["terminal preimage timestamp", (current: BootstrapJournalRecordV1) => ({
      ...current,
      retentionTerminalPreimage: {
        ...(current.retentionTerminalPreimage as NonNullable<BootstrapJournalRecordV1["retentionTerminalPreimage"]>),
        updatedAt: parseUtcTimestamp("2026-08-31T08:00:00.500Z"),
      },
    })],
    ["terminal preimage predecessor", (current: BootstrapJournalRecordV1) => ({
      ...current,
      retentionTerminalPreimage: {
        ...(current.retentionTerminalPreimage as NonNullable<BootstrapJournalRecordV1["retentionTerminalPreimage"]>),
        previousJournalHash: hash("unrelated-terminal-preimage"),
      },
    })],
  ] as const)("refuses retaining evidence with mismatched %s lineage", (_name, mutate) => {
    const terminal = phaseRecord("finalized");
    const retaining = mutate(retainingSuccessor(terminal));
    const slots = retaining.slot === 0
      ? [retaining, null] as const
      : [null, retaining] as const;

    expect(() => selectRetentionJournal(plan, admittedEvidence(terminal), slots)).toThrow();
  });

  it("refuses terminal preimage drift in a retaining successor", () => {
    const terminal = phaseRecord("finalized");
    const first = retainingSuccessor(terminal);
    const drifted = successor(first, {
      retentionNext: 1,
      retentionTerminalPreimage: {
        ...retentionTerminalPreimage(terminal),
        previousJournalHash: hash("drifted-terminal-preimage"),
      },
    });

    expect(() => validateRetentionJournalSuccessor(
      plan,
      admittedEvidence(terminal),
      first,
      drifted,
    )).toThrow();
  });

  it("refuses a later retaining record when its predecessor slot is unavailable", () => {
    const terminal = phaseRecord("finalized");
    const first = retainingSuccessor(terminal);
    const later = successor(first, { retentionNext: 1 });
    const slots = later.slot === 0
      ? [later, null] as const
      : [null, later] as const;

    expect(() => selectRetentionJournal(plan, admittedEvidence(terminal), slots)).toThrow();
  });

  it("refuses phase changes that skip a cursor or enter retention past zero", () => {
    const planned = phaseRecord("planned");
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      planned,
      successor(planned, phaseRecord("payload_staging", { nextPayload: 1 })),
    )).toThrow();

    const finalized = phaseRecord("finalized");
    expect(() => validateBootstrapJournalSuccessor(
      plan,
      finalized,
      successor(finalized, phaseRecord("retaining", { retentionNext: 1 })),
    )).toThrow();
  });
});

function parent(parentPath: string, ino: string) {
  return { path: path(parentPath), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal(ino) };
}

function regular(
  contents: string,
  ino: string,
  overrides: Partial<Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }>> = {},
): Extract<BootstrapRetentionPostimageV1, { kind: "regular_file" }> {
  return {
    kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 1,
    bytes: parseUInt64Decimal(String(Buffer.byteLength(contents))), sha256: hash(contents),
    dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal(ino), ...overrides,
  };
}

function tree(
  ino: string,
  overrides: Partial<Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>> = {},
): Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }> {
  return {
    kind: "directory_tree", ownerUid: 501, mode: 0o700, nlink: 2,
    treeHash: hash(`tree-${ino}`), entryCount: 3, regularFileBytes: parseUInt64Decimal("12"),
    dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal(ino), ...overrides,
  };
}

function syntheticDirectoryTree(rootPath: CanonicalAbsolutePathV1, baseIno = 601) {
  const entries = [
    {
      relativePath: "attempt",
      kind: "directory" as const,
      ownerUid: 501,
      mode: 0o700 as const,
      nlink: 2 as const,
      bytes: parseUInt64Decimal("0"),
      sha256: null,
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(String(baseIno)),
    },
    {
      relativePath: "attempt/a.json",
      kind: "regular_file" as const,
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      bytes: parseUInt64Decimal("4"),
      sha256: hash("aaaa"),
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(String(baseIno + 1)),
    },
    {
      relativePath: "attempt/b.json",
      kind: "regular_file" as const,
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      bytes: parseUInt64Decimal("8"),
      sha256: hash("bbbbbbbb"),
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(String(baseIno + 2)),
    },
  ];
  return {
    evidence: { rootPath, entries },
    postimage: tree("600", {
      treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", entries),
      entryCount: entries.length,
      regularFileBytes: parseUInt64Decimal("12"),
      entries,
    }),
  };
}

function emptyDirectoryTree(
  rootPath: CanonicalAbsolutePathV1,
  dev: ReturnType<typeof parseUInt64Decimal>,
  ino: ReturnType<typeof parseUInt64Decimal>,
) {
  const entries: readonly BootstrapRetentionDirectoryEntryV1[] = [];
  return {
    evidence: { rootPath, entries },
    postimage: tree(ino, {
      treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", entries),
      entryCount: 0,
      regularFileBytes: parseUInt64Decimal("0"),
      dev,
      ino,
      entries,
    }),
  };
}

function directoryTreeFromRows(
  rootPath: CanonicalAbsolutePathV1,
  nestedRows: readonly BootstrapRetentionEvidenceProjectionV1["rows"][number][],
) {
  const entries = nestedRows.map((row) => row.postimage.kind === "regular_file"
    ? {
        relativePath: row.sourcePath.slice(rootPath.length + 1),
        kind: "regular_file" as const,
        ownerUid: row.postimage.ownerUid,
        mode: row.postimage.mode,
        nlink: 1 as const,
        bytes: row.postimage.bytes,
        sha256: row.postimage.sha256,
        dev: row.postimage.dev,
        ino: row.postimage.ino,
      }
    : {
        relativePath: row.sourcePath.slice(rootPath.length + 1),
        kind: "directory" as const,
        ownerUid: row.postimage.ownerUid,
        mode: 0o700 as const,
        nlink: row.postimage.nlink,
        bytes: parseUInt64Decimal("0"),
        sha256: null,
        dev: row.postimage.dev,
        ino: row.postimage.ino,
      }).sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  const regularFileBytes = entries.reduce(
    (total, entry) => total + (entry.kind === "regular_file" ? BigInt(entry.bytes) : 0n),
    0n,
  );
  return {
    evidence: { rootPath, entries },
    aggregate: {
      treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", entries),
      entryCount: entries.length,
      regularFileBytes: parseUInt64Decimal(regularFileBytes.toString()),
    },
  };
}

function admittedEvidence(
  terminalJournal: BootstrapJournalRecordV1 = historicalJournal({
    phase: "finalized",
    nextPayload: plan.payloads.length,
    nextCreatedPath: plan.createdPaths.length,
    nextFoundationParticipant: 1,
    nextLaunchabilityPath: plan.launchabilityPaths.length,
    manifestCursor: 3,
    terminalOutcome: "finalized",
  }),
): BootstrapRetentionEvidenceProjectionV1 {
  const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
  const stagingOrdinal = plan.createdPaths.findIndex((planned) =>
    planned.kind === "directory" && planned.path === stagingRoot,
  );
  const stagingReached = plan.operation !== "fresh_v2_init" ||
    (stagingOrdinal >= 0 && stagingOrdinal < terminalJournal.nextCreatedPath);
  const directoryTrees: BootstrapRetentionEvidenceProjectionV1["directoryTrees"][number][] = [];
  const rows: BootstrapRetentionEvidenceProjectionV1["rows"][number][] = [];
  const payloadEvidence: Array<{
    readonly value: BootstrapPayloadEvidenceV1;
    readonly evidenceIdentity: {
      readonly ownerUid: number;
      readonly mode: 0o600;
      readonly nlink: 1;
      readonly dev: ReturnType<typeof parseUInt64Decimal>;
      readonly ino: ReturnType<typeof parseUInt64Decimal>;
    };
  }> = [];
  const createdPathEvidence: BootstrapRetentionEvidenceProjectionV1["createdPathEvidence"][number][] = [];
  for (const [ordinal, payload] of plan.payloads.slice(0, terminalJournal.nextPayload).entries()) {
    const payloadPostimage = regular("", String(100 + ordinal * 2), {
      bytes: parseUInt64Decimal(String(payload.ref.bytes)),
      sha256: payload.ref.hash,
      mode: payload.ref.mode,
    });
    const value = validateBootstrapPayloadEvidence({
      schemaVersion: 1,
      bootstrapId: ID,
      ordinal,
      stagedPathHash: hash(payload.ref.path),
      sourceIdentityHash: bootstrapPayloadSourceIdentityHash(payload.source),
      bytes: payload.ref.bytes,
      sha256: payload.ref.hash,
      mode: payload.ref.mode,
      dev: payloadPostimage.dev,
      ino: payloadPostimage.ino,
    }, payload.ref, payload.source);
    const evidenceIdentity = {
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(String(101 + ordinal * 2)),
    };
    const evidenceBytes = encodeCanonicalJson(value as unknown as CanonicalJsonValue);
    payloadEvidence.push({ value, evidenceIdentity });
    rows.push({
      role: "payload_evidence",
      sourcePath: path(`${payload.ref.path}.json`),
      parent: parent(dirname(payload.ref.path), "2"),
      postimage: regular("", String(101 + ordinal * 2), {
        bytes: parseUInt64Decimal(String(new TextEncoder().encode(evidenceBytes).byteLength)),
        sha256: hash(evidenceBytes),
      }),
    });
  }
  const addCreationEvidence = (
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
    identityOrdinal: number,
  ): void => {
    const evidencePath = path(`/product/state/.fresh-v2-init.${ID}.${scope}.${String(ordinal).padStart(10, "0")}.creation.json`);
    const origin = planned.kind === "file"
      ? payloadEvidence.find((candidate) => candidate.value.ordinal === planned.payload.ordinal)?.value
      : undefined;
    const targetIno = origin?.ino ?? parseUInt64Decimal(String(300 + identityOrdinal));
    const value = {
      schemaVersion: 1 as const,
      bootstrapId: ID,
      scope,
      ordinal,
      pathHash: hash(planned.path),
      kind: planned.kind,
      dev: origin?.dev ?? parseUInt64Decimal("1"),
      ino: targetIno,
      postimageHash: planned.kind === "file" ? planned.payload.hash : planned.kind === "global_lock" ? hash("") : null,
    };
    const evidenceIdentity = {
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal(String(400 + identityOrdinal)),
    };
    createdPathEvidence.push({ value, evidenceIdentity });
    const evidenceBytes = encodeCanonicalJson(value);
    rows.push({
      role: "creation_evidence",
      sourcePath: evidencePath,
      parent: parent(dirname(evidencePath), "2"),
      postimage: regular("", evidenceIdentity.ino, {
        bytes: parseUInt64Decimal(String(new TextEncoder().encode(evidenceBytes).byteLength)),
        sha256: hash(evidenceBytes),
        dev: evidenceIdentity.dev,
        ino: evidenceIdentity.ino,
      }),
    });
  };
  plan.createdPaths.slice(0, terminalJournal.nextCreatedPath)
    .forEach((planned, ordinal) => {
      addCreationEvidence(planned, "ordinary", ordinal, ordinal);
    });
  plan.launchabilityPaths.slice(0, terminalJournal.nextLaunchabilityPath).forEach((planned, ordinal) => {
    addCreationEvidence(planned, "launchability", ordinal, plan.createdPaths.length + ordinal);
  });
  const stagingPlanned = stagingOrdinal < 0 ? undefined : plan.createdPaths[stagingOrdinal];
  const stagingTargetEvidence = createdPathEvidence.find((entry) =>
    entry.value.scope === "ordinary" && entry.value.ordinal === stagingOrdinal,
  )?.value;
  const stagingTree = stagingReached && stagingPlanned?.kind === "directory" && stagingTargetEvidence !== undefined
    ? emptyDirectoryTree(stagingRoot, stagingTargetEvidence.dev, stagingTargetEvidence.ino)
    : null;
  if (stagingTree !== null) directoryTrees.push(stagingTree.evidence);
  const forwards = plan.foundationParticipants.filter((participant) => participant.role.kind === "forward");
  const forwardOrdinals = new Map(forwards.map((participant, ordinal) => [participant.id, ordinal]));
  const retainedParticipants = plan.foundationParticipants.filter((participant) => {
    const ordinal = participant.role.kind === "forward"
      ? forwardOrdinals.get(participant.id)
      : forwardOrdinals.get(participant.role.forwardId);
    return ordinal !== undefined &&
      ordinal < terminalJournal.nextFoundationParticipant &&
      (terminalJournal.terminalOutcome !== "finalized" || participant.role.kind === "forward");
  });
  const foundationEvidence: BootstrapRetentionEvidenceProjectionV1["foundationEvidence"][number][] = [];
  const foundationArtifacts = retainedParticipants.flatMap((participant) => [
    { sourcePath: participant.initialJournal.finalPath, payload: participant.initialJournal.staged, participant },
    ...participant.mutations.flatMap((mutation) => mutation.stagedPath === null || mutation.content == null || mutation.digest == null
      ? []
      : [
          {
            sourcePath: participant.role.kind === "forward"
              ? mutation.targetPath
              : mutation.stagedPath,
            payload: mutation.content,
            participant: null,
          },
          { sourcePath: path(`${mutation.stagedPath}.sha256`), payload: mutation.digest, participant: null },
        ]),
  ]);
  foundationArtifacts.forEach((artifact, ordinal) => {
    const origin = payloadEvidence.find((candidate) => candidate.value.ordinal === artifact.payload.ordinal)?.value;
    if (origin === undefined) throw new Error("fixture Foundation artifact requires payload evidence");
    let postimage = regular("", origin.ino, {
      bytes: parseUInt64Decimal(String(origin.bytes)), sha256: origin.sha256,
      mode: origin.mode, dev: origin.dev, ino: origin.ino,
    });
    if (artifact.participant !== null) {
      const source = plan.payloads[artifact.payload.ordinal]?.source;
      if (source?.kind !== "plan_derived") throw new Error("fixture Foundation journal requires plan-derived source");
      const initial = source.value as Record<string, unknown>;
      const terminalValue = {
        ...initial,
        phase: "finalized",
        updatedAt: initial.updatedAt,
      };
      const terminalBytes = `${JSON.stringify(terminalValue)}\n`;
      postimage = regular(terminalBytes, origin.ino, {
        dev: origin.dev,
        ino: origin.ino,
      });
      foundationEvidence.push({
        participantId: artifact.participant.id,
        value: terminalValue,
        postimage,
      });
    }
    rows.push({
      role: "foundation_bootstrap",
      sourcePath: artifact.sourcePath,
      parent: parent(dirname(artifact.sourcePath), String(50 + ordinal)),
      postimage,
    });
  });
  const foundationPayloads = new Set(foundationArtifacts.map((artifact) => artifact.payload.ordinal));
  const manifestPayload = plan.manifest.after.state === "present" && plan.manifest.after.bytes?.kind === "bootstrap_expected"
    ? plan.manifest.after.bytes.ordinal
    : null;
  for (const admitted of payloadEvidence) {
    const ordinal = admitted.value.ordinal;
    const plannedConsumer = [
      ...plan.createdPaths.slice(0, terminalJournal.nextCreatedPath),
      ...plan.launchabilityPaths.slice(0, terminalJournal.nextLaunchabilityPath),
    ].some((candidate) => candidate.kind === "file" && candidate.payload.ordinal === ordinal);
    if (
      foundationPayloads.has(ordinal) ||
      plannedConsumer ||
      (manifestPayload === ordinal && terminalJournal.manifestCursor >= 2)
    ) continue;
    const payload = plan.payloads[ordinal];
    if (payload === undefined) throw new Error("fixture payload evidence must bind a plan row");
    rows.push({
      role: "payload",
      sourcePath: payload.ref.path,
      parent: parent(dirname(payload.ref.path), "2"),
      postimage: regular("", admitted.value.ino, {
        bytes: parseUInt64Decimal(String(admitted.value.bytes)),
        sha256: admitted.value.sha256,
        mode: admitted.value.mode,
        dev: admitted.value.dev,
        ino: admitted.value.ino,
      }),
    });
  }
  if (terminalJournal.terminalOutcome === "rolled_back") {
    const reached = [
      ...plan.createdPaths.slice(0, terminalJournal.nextCreatedPath).map((planned, ordinal) => ({ planned, ordinal, scope: "ordinary" as const })),
      ...plan.launchabilityPaths.slice(0, terminalJournal.nextLaunchabilityPath).map((planned, ordinal) => ({ planned, ordinal, scope: "launchability" as const })),
    ];
    const filesBeforeDirectories = [...reached].sort((left, right) =>
      Number(left.planned.kind === "directory") - Number(right.planned.kind === "directory"),
    );
    for (const [index, candidate] of filesBeforeDirectories.entries()) {
      if (
        candidate.planned.kind === "global_lock" ||
        candidate.planned.path === stagingRoot ||
        foundationArtifacts.some((artifact) =>
          artifact.sourcePath === candidate.planned.path ||
          (candidate.planned.kind === "file" && artifact.payload.ordinal === candidate.planned.payload.ordinal),
        )
      ) continue;
      const targetEvidence = createdPathEvidence.find((entry) =>
        entry.value.scope === candidate.scope && entry.value.ordinal === candidate.ordinal,
      )?.value;
      if (targetEvidence === undefined) throw new Error("fixture compensation target requires creation evidence");
      const plannedParent = candidate.planned.parent;
      const parentIdentity = plannedParent.kind === "preexisting"
        ? parent(plannedParent.path, plannedParent.ino)
        : (() => {
            const parentEvidence = createdPathEvidence.find((entry) =>
              entry.value.scope === plannedParent.scope && entry.value.ordinal === plannedParent.ordinal,
            )?.value;
            const parentPlan = plannedParent.scope === "ordinary"
              ? plan.createdPaths[plannedParent.ordinal]
              : plan.launchabilityPaths[plannedParent.ordinal];
            if (parentEvidence === undefined || parentPlan === undefined) throw new Error("fixture nested target requires parent evidence");
            return parent(parentPlan.path, parentEvidence.ino);
      })();
      if (candidate.planned.kind === "directory") {
        const nestedRows = rows.filter((row) => row.sourcePath.startsWith(`${candidate.planned.path}/`));
        let projectedEvidence: BootstrapRetentionEvidenceProjectionV1["directoryTrees"][number];
        let directoryPostimage: Extract<BootstrapRetentionPostimageV1, { kind: "directory_tree" }>;
        if (nestedRows.length === 0) {
          const projected = syntheticDirectoryTree(candidate.planned.path, 1_000 + index * 10);
          projectedEvidence = projected.evidence;
          directoryPostimage = projected.postimage;
        } else {
          const projected = directoryTreeFromRows(candidate.planned.path, nestedRows);
          projectedEvidence = projected.evidence;
          directoryPostimage = tree(targetEvidence.ino, {
            ...projected.aggregate,
            entries: projected.evidence.entries,
          });
        }
        directoryTrees.push(projectedEvidence);
        rows.push({
          role: "compensation_target",
          sourcePath: candidate.planned.path,
          parent: parentIdentity,
          postimage: {
            ...directoryPostimage,
            dev: targetEvidence.dev,
            ino: targetEvidence.ino,
          },
        });
      } else {
        const plannedFile = candidate.planned;
        const origin = payloadEvidence.find((entry) => entry.value.ordinal === plannedFile.payload.ordinal)?.value;
        if (origin === undefined) throw new Error("fixture file target requires payload evidence");
        rows.push({
          role: "compensation_target",
          sourcePath: candidate.planned.path,
          parent: parentIdentity,
          postimage: regular("", origin.ino, {
            bytes: parseUInt64Decimal(String(origin.bytes)),
            sha256: origin.sha256,
            mode: origin.mode,
            dev: origin.dev,
            ino: origin.ino,
          }),
        });
      }
    }
  }
  if (stagingReached) {
    if (stagingPlanned?.kind !== "directory" || stagingTree === null) {
      throw new Error("fixture staging root requires exact creation evidence");
    }
    const stagingPlannedParent = stagingPlanned.parent;
    const stagingParent = stagingPlannedParent.kind === "preexisting"
      ? parent(stagingPlannedParent.path, stagingPlannedParent.ino)
      : (() => {
          const parentPlanned = stagingPlannedParent.scope === "ordinary"
            ? plan.createdPaths[stagingPlannedParent.ordinal]
            : plan.launchabilityPaths[stagingPlannedParent.ordinal];
          const parentEvidence = createdPathEvidence.find((entry) =>
            entry.value.scope === stagingPlannedParent.scope &&
            entry.value.ordinal === stagingPlannedParent.ordinal,
          )?.value;
          if (parentPlanned?.kind !== "directory" || parentEvidence === undefined) {
            throw new Error("fixture staging parent requires exact creation evidence");
          }
          return parent(parentPlanned.path, parentEvidence.ino);
        })();
    rows.push({ role: "staging_subtree", sourcePath: stagingRoot, parent: stagingParent, postimage: stagingTree.postimage });
  }
  rows.push({ role: "bootstrap_lock", sourcePath: plan.bootstrapIdentity.path, parent: parent(dirname(plan.bootstrapIdentity.path), "2"), postimage: regular("", "10") });
  return {
    bootstrapId: ID,
    payloadEvidence,
    interruptedPayload: null,
    terminalJournal,
    createdPathEvidence,
    foundationEvidence,
    directoryTrees,
    rows,
  };
}

/** Measured before the double-encode was removed: 1710 with it, 1074 without. */
const BASELINE_DERIVATION_ENCODES = 1200;

function retentionEntryCount(): number {
  return deriveBootstrapRetentionTable(plan, admittedEvidence()).length;
}

describe("retained bootstrap table derivation", () => {
  /**
   * A count, not an elapsed time. Each evidence row was canonically encoded
   * twice, once for its byte length and once for its hash, and init derives the
   * table repeatedly, so this was the largest remaining cost of `init`.
   */
  /**
   * One `developer-os init` derived this table 1,475 times from the same plan
   * and evidence, re-verifying every row each time.
   */
  it("catches a derivation recomputed for a plan and evidence it has already seen", () => {
    const evidence = admittedEvidence();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; only ever invoked with an explicit `this`
    const original = TextEncoder.prototype.encode;
    const measure = (): number => {
      let calls = 0;
      try {
        TextEncoder.prototype.encode = function encode(
          this: InstanceType<typeof TextEncoder>,
          input?: string,
        ) {
          calls += 1;
          return original.call(this, input);
        };
        deriveBootstrapRetentionTable(plan, evidence);
      } finally {
        TextEncoder.prototype.encode = original;
      }
      return calls;
    };

    const cold = measure();
    const warm = measure();

    expect(warm).toBeLessThan(cold);
  });

  it("catches a derivation that canonically encodes each evidence row twice", () => {
    const evidence = admittedEvidence();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored below; only ever invoked with an explicit `this`
    const original = TextEncoder.prototype.encode;
    let calls = 0;
    try {
      TextEncoder.prototype.encode = function encode(
        this: InstanceType<typeof TextEncoder>,
        input?: string,
      ) {
        calls += 1;
        return original.call(this, input);
      };
      deriveBootstrapRetentionTable(plan, evidence);
    } finally {
      TextEncoder.prototype.encode = original;
    }

    expect(calls).toBeLessThanOrEqual(BASELINE_DERIVATION_ENCODES);
  });

  it("derives exact restart locations from the terminal plan without observed pathname authority", () => {
    const evidence = admittedEvidence();
    const table = deriveBootstrapRetentionTable(plan, evidence);

    expect(deriveBootstrapRetentionLocations(plan, evidence.terminalJournal)).toEqual(
      table.map((entry) => ({
        ordinal: entry.ordinal,
        role: entry.role,
        sourcePath: entry.sourcePath,
        tombstonePath: entry.tombstonePath,
        collapsesDescendants: entry.postimage.kind === "directory_tree",
      })),
    );
  });

  it("refuses an invalid Foundation terminal value and a jointly forged successor inode", () => {
    const evidence = admittedEvidence();
    const admitted = evidence.foundationEvidence[0];
    if (admitted === undefined) throw new Error("fixture requires Foundation terminal evidence");
    const participant = plan.foundationParticipants.find((candidate) => candidate.id === admitted.participantId);
    if (participant === undefined) throw new Error("fixture Foundation participant is missing");

    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      foundationEvidence: evidence.foundationEvidence.map((candidate) =>
        candidate.participantId === admitted.participantId
          ? { ...candidate, value: { ...(candidate.value as Record<string, unknown>), phase: "verified" } }
          : candidate),
    })).toThrow();

    const forgedPostimage = { ...admitted.postimage, ino: parseUInt64Decimal("999999") };
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      foundationEvidence: evidence.foundationEvidence.map((candidate) =>
        candidate.participantId === admitted.participantId
          ? { ...candidate, postimage: forgedPostimage }
          : candidate),
      rows: evidence.rows.map((row) =>
        row.sourcePath === participant.initialJournal.finalPath
          ? { ...row, postimage: forgedPostimage }
          : row),
    })).toThrow();
  });

  it("admits an exact empty staging subtree while retaining its root row at a zero descendant cap", () => {
    const evidence = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const entries = [] as const;
    const admittedStaging = evidence.rows.find((row) => row.sourcePath === stagingRoot)?.postimage;
    if (admittedStaging?.kind !== "directory_tree") throw new Error("fixture requires admitted staging root");
    const emptyPostimage = {
      ...admittedStaging,
      treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", entries),
      entryCount: 0,
      regularFileBytes: parseUInt64Decimal("0"),
      entries,
    };
    const cappedPlan = {
      ...plan,
      maximumStagingEntries: 0,
    } as BootstrapRetainedExecutionPlanV1;
    const projection = {
      ...evidence,
      terminalJournal: {
        ...evidence.terminalJournal,
        planHash: canonicalHash(cappedPlan),
      },
      directoryTrees: evidence.directoryTrees.map((candidate) =>
        candidate.rootPath === stagingRoot ? { rootPath: stagingRoot, entries } : candidate),
      rows: evidence.rows.map((row) =>
        row.sourcePath === stagingRoot ? { ...row, postimage: emptyPostimage } : row),
    } as BootstrapRetentionEvidenceProjectionV1;

    const table = deriveBootstrapRetentionTable(cappedPlan, projection);

    expect(table.find((row) => row.sourcePath === stagingRoot)).toMatchObject({
      role: "staging_subtree",
      postimage: { entryCount: 0, regularFileBytes: "0", entries: [] },
    });
    expect(table.length).toBeGreaterThan(0);
  });

  it("reopens the selected rolled_back journal with the exact interrupted writing inode", () => {
    const interrupted = plan.payloads[1];
    if (interrupted === undefined) throw new Error("fixture requires an interrupted payload");
    const postimage = regular("partial", "199", {
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("199"),
      mode: interrupted.ref.mode,
    });
    const writeState = {
      state: "writing" as const,
      ordinal: 1,
      dev: postimage.dev,
      ino: postimage.ino,
    };
    const terminalJournal = historicalJournal({
      phase: "rolled_back",
      direction: "compensating",
      nextPayload: 1,
      payloadWriteState: writeState,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
    });
    const evidence = admittedEvidence(terminalJournal);
    const projection = {
      ...evidence,
      interruptedPayload: {
        writeState,
        postimage,
      },
      rows: [...evidence.rows, {
        role: "payload" as const,
        sourcePath: interrupted.ref.path,
        parent: parent(dirname(interrupted.ref.path), "2"),
        postimage,
      }],
    };

    const table = deriveBootstrapRetentionTable(
      plan,
      projection,
    );
    expect(table.find((row) => row.sourcePath === interrupted.ref.path)?.postimage).toEqual(postimage);
    const retaining = retainingSuccessor(terminalJournal);
    const slots = retaining.slot === 0
      ? [retaining, terminalJournal] as const
      : [terminalJournal, retaining] as const;
    expect(selectRetentionJournal(plan, projection, slots).current).toEqual(retaining);
    const forgedPostimage = { ...postimage, ino: parseUInt64Decimal("200") };
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...projection,
      interruptedPayload: {
        writeState: { ...writeState, ino: forgedPostimage.ino },
        postimage: forgedPostimage,
      },
      rows: projection.rows.map((row) => row.sourcePath === interrupted.ref.path
        ? { ...row, postimage: forgedPostimage }
        : row),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...projection,
      rows: projection.rows.map((row) => row.sourcePath === interrupted.ref.path
        ? { ...row, postimage: { ...row.postimage, ino: parseUInt64Decimal("200") } }
        : row),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...projection,
      rows: projection.rows.filter((row) => row.sourcePath !== interrupted.ref.path),
    })).toThrow();
  });

  it("binds creation authority to canonical evidence bytes and the evidence-file inode", () => {
    const evidence = admittedEvidence();
    const wrapped = evidence.createdPathEvidence;
    const rows = evidence.rows.map((row) => {
      if (row.role !== "creation_evidence") return row;
      const admitted = wrapped.find((candidate) => {
        const marker = `.${candidate.value.scope}.${String(candidate.value.ordinal).padStart(10, "0")}.creation.json`;
        return row.sourcePath.endsWith(marker);
      });
      if (admitted === undefined) throw new Error("fixture creation row requires admitted evidence");
      const bytes = encodeCanonicalJson(admitted.value as unknown as CanonicalJsonValue);
      return {
        ...row,
        postimage: regular("", admitted.evidenceIdentity.ino, {
          bytes: parseUInt64Decimal(String(new TextEncoder().encode(bytes).byteLength)),
          sha256: hash(bytes),
          dev: admitted.evidenceIdentity.dev,
          ino: admitted.evidenceIdentity.ino,
        }),
      };
    });
    const projection = {
      ...evidence,
      createdPathEvidence: wrapped,
      rows,
    };

    expect(() => deriveBootstrapRetentionTable(
      plan,
      projection,
    )).not.toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...projection,
      rows: rows.map((row) => row.role === "creation_evidence"
        ? { ...row, postimage: { ...row.postimage, sha256: hash("forged creation evidence") } }
        : row),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...projection,
      rows: rows.map((row) => row.role === "creation_evidence"
        ? { ...row, postimage: { ...row.postimage, ino: parseUInt64Decimal("999") } }
        : row),
    })).toThrow();
  });

  it("requires an exact directory descendant bijection and the plan-bound staging cap", () => {
    const evidence = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const admittedTree = evidence.directoryTrees.find((candidate) => candidate.rootPath === stagingRoot);
    if (admittedTree === undefined) throw new Error("fixture requires staging-tree evidence");
    const rows = evidence.rows.map((row) => row.sourcePath === stagingRoot
      ? { ...row, postimage: { ...row.postimage, entries: admittedTree.entries } }
      : row);
    const exactProjection = { ...evidence, rows };

    const table = deriveBootstrapRetentionTable(
      plan,
      exactProjection,
    );
    expect(table.find((row) => row.sourcePath === stagingRoot)?.postimage).toMatchObject({
      entries: admittedTree.entries,
    });

    const extraEntry = {
      relativePath: "unknown.bin",
      kind: "regular_file" as const,
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      bytes: parseUInt64Decimal("1"),
      sha256: hash("x"),
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("999"),
    };
    const observedEntries = [...admittedTree.entries, extraEntry]
      .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
    const observedAggregate = {
      treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", observedEntries),
      entryCount: observedEntries.length,
      regularFileBytes: parseUInt64Decimal((observedEntries.reduce(
        (total, candidate) => total + (candidate.kind === "regular_file" ? BigInt(candidate.bytes) : 0n),
        0n,
      )).toString()),
    };
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      directoryTrees: evidence.directoryTrees.map((candidate) => candidate.rootPath === stagingRoot
        ? { ...candidate, entries: observedEntries }
        : candidate),
      rows: evidence.rows.map((row) => row.sourcePath === stagingRoot
        ? { ...row, postimage: { ...row.postimage, ...observedAggregate } }
        : row),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...exactProjection,
      directoryTrees: evidence.directoryTrees.map((candidate) => candidate.rootPath === stagingRoot
        ? { ...candidate, entries: observedEntries }
        : candidate),
      rows: rows.map((row) => row.sourcePath === stagingRoot
        ? { ...row, postimage: { ...row.postimage, ...observedAggregate } }
        : row),
    })).toThrow();

    const cappedPlan = {
      ...plan,
      maximumStagingEntries: admittedTree.entries.length - 1,
    } as BootstrapRetainedExecutionPlanV1;
    expect(() => deriveBootstrapRetentionTable(cappedPlan, {
      ...exactProjection,
      terminalJournal: {
        ...evidence.terminalJournal,
        planHash: canonicalHash(cappedPlan),
      },
    } as unknown as BootstrapRetentionEvidenceProjectionV1)).toThrow();
  });

  it("binds an unconsumed payload row to its persisted payload-evidence inode", () => {
    const rollbackEvidence = admittedEvidence(historicalJournal({
      phase: "rolled_back",
      direction: "compensating",
      nextPayload: plan.payloads.length,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
    }));
    const firstPayloadPath = plan.payloads[0]?.ref.path;

    expect(() => deriveBootstrapRetentionTable(plan, {
      ...rollbackEvidence,
      rows: rollbackEvidence.rows.map((row) => row.sourcePath === firstPayloadPath
        ? { ...row, postimage: { ...row.postimage, ino: parseUInt64Decimal("999") } }
        : row),
    })).toThrow();
  });

  it.each(["canonical bytes", "inode"] as const)(
    "binds a payload-evidence row to its persisted %s",
    (mutation) => {
      const rollbackEvidence = admittedEvidence(historicalJournal({
        phase: "rolled_back",
        direction: "compensating",
        nextPayload: plan.payloads.length,
        compensationNext: -1,
        terminalOutcome: "rolled_back",
      }));
      const firstPayload = plan.payloads[0];
      if (firstPayload === undefined) throw new Error("fixture requires a payload");
      const firstEvidencePath = `${firstPayload.ref.path}.json`;

      expect(() => deriveBootstrapRetentionTable(plan, {
        ...rollbackEvidence,
        rows: rollbackEvidence.rows.map((row) => row.sourcePath === firstEvidencePath
          ? {
              ...row,
              postimage: mutation === "inode"
                ? { ...row.postimage, ino: parseUInt64Decimal("999") }
                : { ...row.postimage, sha256: hash("forged evidence bytes") },
            }
          : row),
      })).toThrow();
    },
  );

  it("does not retain a finalized payload after its planned-file consumer moved the inode", () => {
    const file = plan.launchabilityPaths.find((candidate) =>
      candidate.kind === "file" && candidate.path === "/product/releases/bundle.bin",
    );
    if (file?.kind !== "file") throw new Error("fixture requires a consumed package payload");

    const table = deriveBootstrapRetentionTable(plan, admittedEvidence());
    expect(table.some((row) => row.sourcePath === file.payload.path)).toBe(false);
    expect(table.some((row) => row.sourcePath === file.path)).toBe(false);
  });

  it("maps every finalized Foundation artifact to its originating persisted payload identity", () => {
    const evidence = admittedEvidence() as BootstrapRetentionEvidenceProjectionV1 & {
      readonly payloadEvidence: readonly {
        readonly value: BootstrapPayloadEvidenceV1;
        readonly evidenceIdentity: unknown;
      }[];
    };
    const forward = plan.foundationParticipants.find((participant) => participant.role.kind === "forward");
    if (forward === undefined) throw new Error("fixture requires a forward Foundation participant");
    const mappings = [
      [forward.initialJournal.finalPath, forward.initialJournal.staged],
      ...forward.mutations.flatMap((mutation) => mutation.stagedPath === null || mutation.content == null || mutation.digest == null
        ? []
        : [
            [mutation.targetPath, mutation.content] as const,
            [`${mutation.stagedPath}.sha256`, mutation.digest] as const,
          ]),
    ] as const;

    const table = deriveBootstrapRetentionTable(plan, evidence);
    for (const [sourcePath, payloadRef] of mappings) {
      const row = table.find((candidate) => candidate.sourcePath === sourcePath);
      const origin = evidence.payloadEvidence.find((candidate) => candidate.value.ordinal === payloadRef.ordinal)?.value;
      expect(row?.postimage).toMatchObject({ dev: origin?.dev, ino: origin?.ino });
      expect(table.some((candidate) => candidate.sourcePath === payloadRef.path)).toBe(false);
    }
  });

  it("does not retain a finalized manifest payload after publication consumes its inode", () => {
    const manifestRef = plan.manifest.after.state === "present" ? plan.manifest.after.bytes : null;
    if (manifestRef?.kind !== "bootstrap_expected") throw new Error("fixture requires a bootstrap manifest payload");

    const table = deriveBootstrapRetentionTable(plan, admittedEvidence());
    expect(table.some((row) => row.sourcePath === manifestRef.path)).toBe(false);
    expect(table.some((row) => row.sourcePath === plan.manifest.manifestPath)).toBe(false);
  });

  it("tracks reached rollback consumers without retaining their old payload locations", () => {
    const terminal = historicalJournal({
      phase: "rolled_back",
      direction: "compensating",
      nextPayload: plan.payloads.length,
      nextCreatedPath: plan.createdPaths.length,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 2,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
    });
    const evidence = admittedEvidence(terminal);
    const packageTarget = plan.launchabilityPaths[1];
    const forward = plan.foundationParticipants.find((participant) => participant.role.kind === "forward");
    if (packageTarget?.kind !== "file" || forward === undefined) throw new Error("fixture requires reached file and Foundation consumers");

    const duplicatePaths = evidence.rows
      .map((row) => row.sourcePath)
      .filter((sourcePath, index, paths) => paths.indexOf(sourcePath) !== index);
    expect(duplicatePaths).toEqual([]);

    const table = deriveBootstrapRetentionTable(plan, evidence);
    expect(table.some((row) => row.sourcePath === packageTarget.payload.path)).toBe(false);
    expect(table.some((row) => row.role === "compensation_target" && row.sourcePath === dirname(packageTarget.path))).toBe(true);
    expect(evidence.directoryTrees.find((treeEvidence) => treeEvidence.rootPath === dirname(packageTarget.path))?.entries)
      .toContainEqual(expect.objectContaining({ relativePath: basename(packageTarget.path), ino: evidence.payloadEvidence[2]?.value.ino }));
    expect(table.some((row) => row.sourcePath === forward.initialJournal.staged.path)).toBe(false);
    expect(table.some((row) => row.role === "foundation_bootstrap" && row.sourcePath === forward.initialJournal.finalPath)).toBe(true);
  });

  it("omits manifest bootstrap evidence when the preimage was absent", () => {
    const evidence = admittedEvidence();
    const withoutManifest = {
      ...evidence,
      rows: evidence.rows.filter((row) => row.role !== "manifest_bootstrap"),
    };

    expect(deriveBootstrapRetentionTable(plan, withoutManifest).some(
      (row) => row.role === "manifest_bootstrap",
    )).toBe(false);
  });

  it("binds a present manifest preimage to its complete persisted identity", () => {
    const before = {
      state: "present" as const,
      hash: hash("manifest-before"),
      bytes: null,
      ownerUid: 501,
      mode: 0o600 as const,
      nlink: 1 as const,
      size: parseUInt64Decimal("15"),
      dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("43"),
    };
    const presentPlan = {
      ...plan,
      manifest: { ...plan.manifest, before },
    } as BootstrapRetainedExecutionPlanV1;
    const base = admittedEvidence();
    const manifestRow = {
      role: "manifest_bootstrap" as const,
      sourcePath: presentPlan.manifest.tombstonePath,
      parent: parent(dirname(presentPlan.manifest.tombstonePath), "1"),
      postimage: regular("manifest-before", "43"),
    };
    const evidence = {
      ...base,
      terminalJournal: {
        ...base.terminalJournal,
        planHash: canonicalHash(presentPlan),
      } as BootstrapJournalRecordV1,
      rows: [...base.rows, manifestRow],
    };

    expect(deriveBootstrapRetentionTable(presentPlan, evidence).some(
      (row) => row.role === "manifest_bootstrap",
    )).toBe(true);
    expect(() => deriveBootstrapRetentionTable(presentPlan, {
      ...evidence,
      rows: evidence.rows.map((row) => row.role === "manifest_bootstrap"
        ? { ...row, postimage: { ...row.postimage, ino: parseUInt64Decimal("99") } }
        : row),
    })).toThrow();
  });

  it("derives same-parent deterministic tombstones and maximal directory roots", () => {
    const table = deriveBootstrapRetentionTable(plan, admittedEvidence());
    expect(table.map((row) => [dirname(row.sourcePath), dirname(row.tombstonePath)])).toEqual(
      table.map((row) => [dirname(row.sourcePath), dirname(row.sourcePath)]),
    );
    expect(table.map((row) => basename(row.tombstonePath))).toEqual(
      table.map((_, ordinal) => `.developer-os-retained.${plan.id}.${String(ordinal).padStart(10, "0")}.tombstone`),
    );
    expect(table.filter((row) => row.postimage.kind === "directory_tree")).toHaveLength(1);
    expect(table.some((row) => row.sourcePath.endsWith("/attempt"))).toBe(false);
  });

  it("refuses an unadmitted descendant instead of silently collapsing it", () => {
    const evidence = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const rows = [...evidence.rows, {
      role: "staging_subtree" as const, sourcePath: path(`${stagingRoot}/attempt/nested`),
      parent: parent(`${stagingRoot}/attempt`, "34"), postimage: tree("35"),
    }];
    expect(() => deriveBootstrapRetentionTable(plan, { ...evidence, rows })).toThrow();
  });

  it.each(["treeHash", "entryCount", "regularFileBytes"] as const)(
    "derives a staging directory's %s from its complete descendant projection",
    (field) => {
      const evidence = admittedEvidence();
      const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
      const entries = [
        {
          relativePath: "attempt",
          kind: "directory" as const,
          ownerUid: 501,
          mode: 0o700 as const,
          nlink: 2,
          bytes: parseUInt64Decimal("0"),
          sha256: null,
          dev: parseUInt64Decimal("1"),
          ino: parseUInt64Decimal("601"),
        },
        {
          relativePath: "attempt/a.json",
          kind: "regular_file" as const,
          ownerUid: 501,
          mode: 0o600 as const,
          nlink: 1,
          bytes: parseUInt64Decimal("4"),
          sha256: hash("aaaa"),
          dev: parseUInt64Decimal("1"),
          ino: parseUInt64Decimal("602"),
        },
        {
          relativePath: "attempt/b.json",
          kind: "regular_file" as const,
          ownerUid: 501,
          mode: 0o600 as const,
          nlink: 1,
          bytes: parseUInt64Decimal("8"),
          sha256: hash("bbbbbbbb"),
          dev: parseUInt64Decimal("1"),
          ino: parseUInt64Decimal("603"),
        },
      ];
      const derived = {
        treeHash: domainHash("developer-os/bootstrap-retained-tree/v1\0", entries),
        entryCount: entries.length,
        regularFileBytes: parseUInt64Decimal("12"),
      };
      const projection = {
        ...evidence,
        directoryTrees: [{ rootPath: stagingRoot, entries }],
        rows: evidence.rows.map((row) => row.sourcePath === stagingRoot
          ? { ...row, postimage: { ...row.postimage, ...derived } }
          : row),
      };
      const mutation = field === "treeHash"
        ? hash("caller-selected-tree")
        : field === "entryCount"
          ? 4
          : parseUInt64Decimal("13");

      expect(() => deriveBootstrapRetentionTable(plan, {
        ...projection,
        rows: projection.rows.map((row) => row.sourcePath === stagingRoot
          ? { ...row, postimage: { ...row.postimage, [field]: mutation } }
          : row),
      } as unknown as BootstrapRetentionEvidenceProjectionV1)).toThrow();
    },
  );

  it("requires one and only one complete projection for every maximal directory root", () => {
    const evidence = admittedEvidence();
    const extra = syntheticDirectoryTree(path("/product/staging/unadmitted"), 801).evidence;

    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      directoryTrees: [],
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      directoryTrees: [...evidence.directoryTrees, extra],
    })).toThrow();
  });

  it("refuses parent mismatch, duplicate sources, and caller-spelled destinations", () => {
    const evidence = admittedEvidence();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows: evidence.rows.map((row, index) => index === 0 ? { ...row, parent: parent("/wrong", "2") } : row),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence, rows: [...evidence.rows, evidence.rows[0] as typeof evidence.rows[number]],
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows: evidence.rows.map((row, index) => index === 0 ? { ...row, tombstonePath: path("/caller/selected.tombstone") } : row),
    })).toThrow();
  });

  it("refuses a source that collides with a derived destination", () => {
    const evidence = admittedEvidence();
    const collision = {
      role: "bootstrap_lock" as const,
      sourcePath: path(`/product/state/.developer-os-retained.${ID}.0000000000.tombstone`),
      parent: parent("/product/state", "2"), postimage: regular("", "90"),
    };
    expect(() => deriveBootstrapRetentionTable(plan, { ...evidence, rows: [collision, ...evidence.rows] })).toThrow();
  });

  it("refuses a Foundation row with equal bytes but a different admitted inode", () => {
    const evidence = admittedEvidence();
    const rows = evidence.rows.map((row) =>
      row.role === "foundation_bootstrap" && row.postimage.kind === "regular_file"
        ? { ...row, postimage: { ...row.postimage, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("99") } }
        : row,
    );
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows,
    })).toThrow();
  });

  it("refuses caller omission of applicable Foundation and creation-evidence rows", () => {
    const evidence = admittedEvidence();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows: evidence.rows.filter((row) => row.role !== "foundation_bootstrap"),
    })).toThrow();
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows: evidence.rows.filter((row) => row.role !== "creation_evidence"),
    })).toThrow();
  });

  it("refuses companion compensation artifacts in place of the completed forward participant", () => {
    const evidence = admittedEvidence();
    const forward = plan.foundationParticipants.find((participant) => participant.role.kind === "forward");
    const compensation = plan.foundationParticipants.find((participant) => participant.role.kind === "compensation");
    if (forward === undefined || compensation === undefined) throw new Error("fixture requires a Foundation pair");
    const rows = evidence.rows.map((row) => row.sourcePath === forward.initialJournal.finalPath
      ? {
          ...row,
          sourcePath: compensation.initialJournal.finalPath,
          parent: parent(dirname(compensation.initialJournal.finalPath), "40"),
        }
      : row);

    expect(() => deriveBootstrapRetentionTable(plan, { ...evidence, rows })).toThrow();
  });

  it("refuses a regular file in place of the retained staging subtree", () => {
    const evidence = admittedEvidence();
    const rows = evidence.rows.map((row) => row.role === "staging_subtree"
      ? { ...row, postimage: regular("not-a-tree", "33") }
      : row);
    expect(() => deriveBootstrapRetentionTable(plan, { ...evidence, rows })).toThrow();
  });

  it("refuses a created-path parent whose observed inode is not its earlier creation evidence", () => {
    const evidence = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const targetPath = path(`${stagingRoot}/attempt/active-release.json`);
    const launchabilityPath = plan.launchabilityPaths[0];
    if (launchabilityPath === undefined) throw new Error("fixture requires a launchability path");
    const nestedPlan = {
      ...plan,
      launchabilityPaths: [{
        ...launchabilityPath,
        path: targetPath,
        parent: { kind: "created_path" as const, scope: "ordinary" as const, ordinal: 0 },
      }],
    } as BootstrapRetainedExecutionPlanV1;
    const rows = [...evidence.rows, {
      role: "compensation_target" as const,
      sourcePath: targetPath,
      parent: parent(`${stagingRoot}/attempt`, "99"),
      postimage: regular("payload", "77"),
    }];
    expect(() => deriveBootstrapRetentionTable(nestedPlan, {
      ...evidence,
      rows,
      createdPathEvidence: [{
        schemaVersion: 1,
        bootstrapId: ID,
        scope: "ordinary",
        ordinal: 0,
        pathHash: hash(`${stagingRoot}/attempt`),
        kind: "directory",
        dev: parseUInt64Decimal("1"),
        ino: parseUInt64Decimal("34"),
        postimageHash: null,
      }],
    } as unknown as BootstrapRetentionEvidenceProjectionV1)).toThrow();
  });

  it("refuses compensation targets whose postimage identity differs from their admitted creation evidence", () => {
    const evidence = admittedEvidence();
    const stagingRoot = plan.operation === "fresh_v2_init" ? plan.stagingRoot : plan.paths.stagingRoot;
    const rollbackJournal = journal({
      phase: "rolled_back",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
    });
    const ordinaryCreationEvidence = evidence.rows.find((row) =>
      row.role === "creation_evidence" && row.sourcePath.includes(".ordinary."),
    );
    if (ordinaryCreationEvidence === undefined) throw new Error("fixture requires ordinary creation evidence row");
    const preexistingParentRows = [
      ...evidence.rows.filter((row) =>
        row.role === "payload" ||
        row.role === "payload_evidence" ||
        row.role === "staging_subtree" ||
        row.role === "bootstrap_lock",
      ),
      ordinaryCreationEvidence,
      {
        role: "compensation_target" as const,
        sourcePath: path(`${stagingRoot}/attempt`),
        parent: parent(stagingRoot, "33"),
        postimage: tree("99", { entryCount: 1, regularFileBytes: parseUInt64Decimal("0") }),
      },
    ];
    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      terminalJournal: rollbackJournal,
      createdPathEvidence: evidence.createdPathEvidence.filter((row) => row.value.scope === "ordinary"),
      rows: preexistingParentRows,
    })).toThrow();

    const targetPath = path(`${stagingRoot}/attempt/active-release.json`);
    const launchabilityPath = plan.launchabilityPaths[0];
    if (launchabilityPath === undefined) throw new Error("fixture requires a launchability path");
    const nestedPlan = {
      ...plan,
      launchabilityPaths: [{
        ...launchabilityPath,
        path: targetPath,
        parent: { kind: "created_path" as const, scope: "ordinary" as const, ordinal: 0 },
      }],
    } as BootstrapRetainedExecutionPlanV1;
    const nestedRows = [
      ...evidence.rows.filter((row) => row.role !== "manifest_bootstrap"),
      {
        role: "compensation_target" as const,
        sourcePath: path(`${stagingRoot}/attempt`),
        parent: parent(stagingRoot, "33"),
        postimage: tree("34", { entryCount: 1, regularFileBytes: parseUInt64Decimal("0") }),
      },
      {
        role: "compensation_target" as const,
        sourcePath: targetPath,
        parent: parent(`${stagingRoot}/attempt`, "34"),
        postimage: regular("payload", "99"),
      },
    ];
    expect(() => deriveBootstrapRetentionTable(nestedPlan, {
      ...evidence,
      terminalJournal: {
        ...rollbackJournal,
        planHash: canonicalHash(nestedPlan),
        nextFoundationParticipant: 1,
        nextLaunchabilityPath: 1,
      },
      rows: nestedRows,
      createdPathEvidence: evidence.createdPathEvidence.map((row) => row.value.scope === "launchability"
        ? { ...row, value: { ...row.value, pathHash: hash(targetPath), ino: parseUInt64Decimal("77") } }
        : row),
    })).toThrow();
  });

  it("rejects a supplied forbidden compensation row instead of silently filtering it", () => {
    const evidence = admittedEvidence();
    const forbidden = {
      role: "compensation_target" as const,
      sourcePath: plan.bootstrapIdentity.path,
      parent: parent(dirname(plan.bootstrapIdentity.path), "2"),
      postimage: regular("", "10"),
    };

    expect(() => deriveBootstrapRetentionTable(plan, {
      ...evidence,
      rows: [...evidence.rows, forbidden],
    })).toThrow();
  });

  it("never retains the permanent global lock as a rolled-back compensation target", () => {
    const globalLockPath = path("/product/state/.lifecycle.lock");
    const ordinaryPath = path("/product/state/attempt-created");
    const globalLockPlan = {
      ...plan,
      createdPaths: [
        {
          kind: "global_lock" as const,
          path: globalLockPath,
          expectedBefore: "absent" as const,
          ownerUid: 501,
          mode: 0o600 as const,
          parent: { kind: "preexisting" as const, path: path("/product/state"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") },
          cleanup: "remove_on_compensation" as const,
        },
        {
          kind: "directory" as const,
          path: ordinaryPath,
          expectedBefore: "absent" as const,
          ownerUid: 501,
          mode: 0o700 as const,
          parent: { kind: "preexisting" as const, path: path("/product/state"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") },
          cleanup: "remove_on_compensation" as const,
        },
      ],
    } as BootstrapRetainedExecutionPlanV1;
    const terminalJournal = historicalJournal({
      planHash: canonicalHash(globalLockPlan), phase: "rolled_back", direction: "compensating",
      nextPayload: plan.payloads.length, nextCreatedPath: 2, compensationNext: -1, terminalOutcome: "rolled_back",
    });
    const base = admittedEvidence(terminalJournal);
    const globalEvidencePath = path(`/product/state/.fresh-v2-init.${ID}.ordinary.0000000000.creation.json`);
    const ordinaryEvidencePath = path(`/product/state/.fresh-v2-init.${ID}.ordinary.0000000001.creation.json`);
    const ordinaryTree = emptyDirectoryTree(
      ordinaryPath,
      parseUInt64Decimal("1"),
      parseUInt64Decimal("56"),
    );
    const globalCreationValue = {
      schemaVersion: 1 as const, bootstrapId: ID, scope: "ordinary" as const, ordinal: 0,
      pathHash: hash(globalLockPath), kind: "global_lock" as const, dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("55"), postimageHash: hash(""),
    };
    const ordinaryCreationValue = {
      schemaVersion: 1 as const, bootstrapId: ID, scope: "ordinary" as const, ordinal: 1,
      pathHash: hash(ordinaryPath), kind: "directory" as const, dev: parseUInt64Decimal("1"),
      ino: parseUInt64Decimal("56"), postimageHash: null,
    };
    const creationIdentity = (ino: string) => ({
      ownerUid: 501, mode: 0o600 as const, nlink: 1 as const,
      dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal(ino),
    });
    const creationPostimage = (value: unknown, identity: ReturnType<typeof creationIdentity>) => {
      const bytes = encodeCanonicalJson(value as CanonicalJsonValue);
      return regular("", identity.ino, {
        bytes: parseUInt64Decimal(String(new TextEncoder().encode(bytes).byteLength)),
        sha256: hash(bytes), dev: identity.dev, ino: identity.ino,
      });
    };
    const globalCreationIdentity = creationIdentity("41");
    const ordinaryCreationIdentity = creationIdentity("42");
    const projection = {
      bootstrapId: ID,
      terminalJournal,
      payloadEvidence: base.payloadEvidence,
      interruptedPayload: null,
      createdPathEvidence: [
        { value: globalCreationValue, evidenceIdentity: globalCreationIdentity },
        { value: ordinaryCreationValue, evidenceIdentity: ordinaryCreationIdentity },
      ],
      foundationEvidence: base.foundationEvidence,
      directoryTrees: [ordinaryTree.evidence],
      rows: [
        ...base.rows.filter((row) =>
          row.role === "payload" ||
          row.role === "payload_evidence" ||
          row.role === "bootstrap_lock",
        ),
        { role: "creation_evidence", sourcePath: globalEvidencePath, parent: parent("/product/state", "2"), postimage: creationPostimage(globalCreationValue, globalCreationIdentity) },
        { role: "creation_evidence", sourcePath: ordinaryEvidencePath, parent: parent("/product/state", "2"), postimage: creationPostimage(ordinaryCreationValue, ordinaryCreationIdentity) },
        { role: "compensation_target", sourcePath: globalLockPath, parent: parent("/product/state", "2"), postimage: regular("", "55") },
        {
          role: "compensation_target",
          sourcePath: ordinaryPath,
          parent: parent("/product/state", "2"),
          postimage: ordinaryTree.postimage,
        },
      ],
    } as unknown as BootstrapRetentionEvidenceProjectionV1;

    expect(() => deriveBootstrapRetentionTable(globalLockPlan, projection)).toThrow();
    const admittedProjection = {
      ...projection,
      rows: projection.rows.filter((row) =>
        row.role !== "compensation_target" || row.sourcePath !== globalLockPath,
      ),
    };
    const table = deriveBootstrapRetentionTable(globalLockPlan, admittedProjection);

    expect(table.some((row) => row.role === "compensation_target" && row.sourcePath === globalLockPath)).toBe(false);
    expect(table.some((row) => row.role === "compensation_target" && row.sourcePath === ordinaryPath)).toBe(true);
    expect(() => deriveBootstrapRetentionTable(globalLockPlan, {
      ...admittedProjection,
      rows: admittedProjection.rows.map((row) => row.sourcePath === ordinaryPath
        ? { ...row, postimage: { ...row.postimage, treeHash: hash("caller-selected-planned-tree") } }
        : row),
    })).toThrow();
  });
});

const selection = (current: BootstrapJournalRecordV1): BootstrapJournalSelectionV1 => ({
  current, inactiveSlot: current.slot === 0 ? 1 : 0,
});

describe("retained bootstrap evidence classification", () => {
  const rows = deriveBootstrapRetentionTable(plan, admittedEvidence());
  const base = {
    id: ID,
    planPath: plan.operation === "fresh_v2_init" ? plan.planPath : plan.paths.plan,
    operation: "fresh_v2_init" as const,
    terminalOutcome: "finalized" as const,
    journal: selection(phaseRecord("retained")), expectedRows: rows,
    matchingRows: rows.length, alteredRows: 0, unboundEntries: 0,
    confinedToRetainedNamespace: true, entryCount: 17, regularFileBytes: parseUInt64Decimal("99"),
  };

  it.each([
    ["verified", base],
    ["incomplete", { ...base, journal: selection(phaseRecord("retaining")), matchingRows: 2 }],
    ["altered", { ...base, matchingRows: rows.length - 1, alteredRows: 1 }],
    ["unverified", { ...base, journal: null, terminalOutcome: null, matchingRows: 0 }],
  ] as const)("classifies %s metadata without carrying content", (status, input) => {
    const summary = classifyBootstrapEvidence({
      ...input,
      content: "synthetic retained secret",
    } as unknown as Parameters<typeof classifyBootstrapEvidence>[0]);
    expect(summary).toEqual({
      id: ID, status, operation: "fresh_v2_init",
      terminalOutcome: status === "unverified" ? null : "finalized",
      vaultPath: base.planPath, entryCount: 17, regularFileBytes: "99",
    });
    expect(JSON.stringify(summary)).not.toContain("synthetic retained secret");
  });

  it("refuses impossible observation counts instead of misclassifying them", () => {
    expect(() => classifyBootstrapEvidence({ ...base, matchingRows: rows.length + 1 })).toThrow();
    expect(() => classifyBootstrapEvidence({ ...base, matchingRows: 1, alteredRows: rows.length })).toThrow();
  });
});

describe("retained bootstrap aggregate capacity", () => {
  it.each([
    { ids: 0, entries: 0, bytes: "0" },
    { ids: BOOTSTRAP_RETAINED_MAX_IDS, entries: BOOTSTRAP_RETAINED_MAX_ENTRIES, bytes: BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES.toString() },
  ])("accepts zero and exact cap: $ids/$entries/$bytes", (value) => {
    const admitted = { ...value, bytes: parseUInt64Decimal(value.bytes) };
    expect(assertBootstrapRetentionCapacity(admitted)).toEqual(admitted);
  });

  it.each([
    { ids: 257, entries: 1, bytes: "1" },
    { ids: 1, entries: 1_000_001, bytes: "1" },
    { ids: 1, entries: 1, bytes: "12884901889" },
  ])("refuses first-over capacity before allocation: $ids/$entries/$bytes", (value) => {
    expect(() => assertBootstrapRetentionCapacity({ ...value, bytes: parseUInt64Decimal(value.bytes) })).toThrow();
  });

  it("refuses checked-sum overflow and non-integral counts", () => {
    expect(() => assertBootstrapRetentionCapacity({ ids: 1, entries: 1, bytes: "18446744073709551616" as ReturnType<typeof parseUInt64Decimal> })).toThrow();
    expect(() => assertBootstrapRetentionCapacity({ ids: 1.5, entries: 1, bytes: parseUInt64Decimal("1") })).toThrow();
  });
});
