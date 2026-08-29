import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import type { CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { LowerHexSha256 } from "../update/scalars.js";
import {
  BootstrapStateError,
  bootstrapExternalShapeHash,
  bootstrapPayloadSourceIdentityHash,
  deriveBootstrapCreationEvidencePaths,
  deriveBootstrapEnvelopePaths,
  deriveBootstrapPayloadEvidencePaths,
  inspectBootstrapClosure,
  validateBootstrapExternalShapeProjection,
  validateBootstrapFoundationOrdinal,
  validateBootstrapJournal,
  validateBootstrapPlan,
  validateBootstrapPayloadEvidence,
  validateCreatedPathEvidence,
  type BootstrapClosureAdmissionContextV1,
  type BootstrapExecutionPlanV1,
  type BootstrapExternalShapeProjectionV1,
  type BootstrapInventoryV1,
  type BootstrapPayloadSourceV1,
  type FoundationParticipantRefV2,
  type PlannedCreatedPathV1,
  type FreshV2InitJournalV1,
  type FreshV2InitPlanV1,
  type ManifestMigrationPlanV1,
} from "./bootstrap.js";
import type {
  BootstrapExpectedPayloadRefV1,
  FreshV2InitIdV1,
  ManifestMigrationIdV1,
} from "./manifest-state.js";

const freshId = "fi_123e4567-e89b-42d3-a456-426614174000" as FreshV2InitIdV1;
const productHome = "/product" as CanonicalAbsolutePathV1;
const hashA = "a".repeat(64) as LowerHexSha256;
const hashB = "b".repeat(64) as LowerHexSha256;
const hashC = "c".repeat(64) as LowerHexSha256;
const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LowerHexSha256;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture element is required");
  return value;
}

function externalProjection(): BootstrapExternalShapeProjectionV1 {
  return {
    entries: [
      {
        role: "product_home",
        pathHash: hashA,
        kind: "directory",
        ownerUid: 501,
        mode: 0o700,
        nlink: 2,
        size: "64",
        dev: "1",
        ino: "2",
      },
      {
        role: "state_directory",
        pathHash: hashB,
        kind: "directory",
        ownerUid: 501,
        mode: 0o700,
        nlink: 2,
        size: "96",
        dev: "1",
        ino: "3",
      },
      {
        role: "bootstrap_lock",
        pathHash: hashC,
        kind: "regular_file",
        ownerUid: 501,
        mode: 0o600,
        nlink: 1,
        size: "0",
        dev: "1",
        ino: "4",
      },
    ],
  } as unknown as BootstrapExternalShapeProjectionV1;
}

describe("bootstrap deterministic names and external-shape authority", () => {
  it.each([
    [0, true],
    [255, true],
    [256, false],
    [-1, false],
    [0.5, false],
  ] as const)(
    "catches an ordinal validator that accepts the wrong Foundation pair boundary %s",
    (ordinal, accepted) => {
      expect(validateBootstrapFoundationOrdinal(ordinal).ok).toBe(accepted);
    },
  );

  it("catches a prefix or envelope-kind branch that derives caller-selected bootstrap paths", () => {
    expect(deriveBootstrapEnvelopePaths(productHome, "fresh_v2_init", freshId)).toEqual({
      plan: "/product/state/fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.plan.json",
      journal: "/product/state/fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.journal.json",
      stagingRoot: "/product/staging/fresh-v2-init/fi_123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("catches payload-evidence or temp suffixes that are not derived from the exact staged payload", () => {
    expect(
      deriveBootstrapPayloadEvidencePaths(
        "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.0000000000.payload" as never,
        "123e4567-e89b-42d3-a456-426614174001",
      ),
    ).toEqual({
      evidence: "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.0000000000.payload.json",
      temporary: "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.0000000000.payload.json.123e4567-e89b-42d3-a456-426614174001.tmp",
    });
  });

  it("catches creation evidence that drops the envelope prefix, scope, or ten-digit ordinal", () => {
    expect(
      deriveBootstrapCreationEvidencePaths(
        productHome,
        "fresh_v2_init",
        freshId,
        "launchability",
        7,
        "123e4567-e89b-42d3-a456-426614174001",
      ),
    ).toEqual({
      evidence: "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.launchability.0000000007.creation.json",
      temporary: "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.launchability.0000000007.creation.json.123e4567-e89b-42d3-a456-426614174001.tmp",
    });
  });

  it("catches an external-shape hash that changes the domain, row order, or no-LF encoding", () => {
    const projection = validateBootstrapExternalShapeProjection(externalProjection());
    expect(bootstrapExternalShapeHash(projection)).toBe(
      "e81597290bb9e5d971bc51d750795bdebc6b76a4fd9efdb74e6b39afb0a8ed38",
    );
  });

  it.each([
    {
      name: "an extra projection row bypasses the exact three-row tuple",
      mutate(value: Record<string, unknown>) {
        (value.entries as unknown[]).push(structuredClone((value.entries as unknown[])[2]));
      },
    },
    {
      name: "a swapped role bypasses the fixed product/state/lock order",
      mutate(value: Record<string, unknown>) {
        required((value.entries as Array<Record<string, unknown>>)[0]).role = "state_directory";
      },
    },
    {
      name: "a lock directory bypasses the regular-file branch",
      mutate(value: Record<string, unknown>) {
        required((value.entries as Array<Record<string, unknown>>)[2]).kind = "directory";
      },
    },
    {
      name: "a 0700 lock bypasses the owner-only file mode",
      mutate(value: Record<string, unknown>) {
        required((value.entries as Array<Record<string, unknown>>)[2]).mode = 0o700;
      },
    },
    {
      name: "an unknown nested key widens a filesystem authority row",
      mutate(value: Record<string, unknown>) {
        required((value.entries as Array<Record<string, unknown>>)[1]).createdByAttempt = true;
      },
    },
  ])("refuses $name", (testCase) => {
    const candidate = structuredClone(externalProjection()) as unknown as Record<string, unknown>;
    testCase.mutate(candidate);
    expect(() => validateBootstrapExternalShapeProjection(candidate)).toThrow(BootstrapStateError);
  });
});

function emptySource(): BootstrapPayloadSourceV1 {
  return { kind: "constant_empty", role: "empty_reservation" };
}

function emptyPayloadRef(): BootstrapExpectedPayloadRefV1 {
  return {
    kind: "bootstrap_expected",
    bootstrapId: freshId,
    ordinal: 0,
    path: "/product/state/.fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.0000000000.payload" as never,
    hash: emptyHash,
    bytes: 0,
    mode: 0o600,
  };
}

describe("bootstrap payload and creation evidence", () => {
  it("catches a source-identity digest that changes the exact arm or domain separator", () => {
    expect(bootstrapPayloadSourceIdentityHash(emptySource())).toBe(
      "cecd42bf2ecf2da701d30d97c2a534c59c71a3ac491c5f1920cb65ff512acaab",
    );
  });

  it("retains independently bound staged inode evidence instead of branding a path string", () => {
    const evidence = {
      schemaVersion: 1,
      bootstrapId: freshId,
      ordinal: 0,
      stagedPathHash: "b5bc39d40cb672d520cf6b4b27a7fef9d3b101b763e8fef201f1b1105348c6a5",
      sourceIdentityHash: "cecd42bf2ecf2da701d30d97c2a534c59c71a3ac491c5f1920cb65ff512acaab",
      bytes: 0,
      sha256: emptyHash,
      mode: 0o600,
      dev: "7",
      ino: "11",
    };
    expect(validateBootstrapPayloadEvidence(evidence, emptyPayloadRef(), emptySource())).toEqual(evidence);
  });

  it.each([
    ["a reused ordinal", "ordinal", 1],
    ["a different staged inode path", "stagedPathHash", hashA],
    ["a different source arm", "sourceIdentityHash", hashB],
    ["a truncated byte count", "bytes", 1],
    ["a content substitution", "sha256", hashC],
    ["a mode substitution", "mode", 0o700],
    ["an over-uint64 device", "dev", "18446744073709551616"],
  ] as const)("refuses evidence with %s", (_name, key, replacement) => {
    const evidence: Record<string, unknown> = {
      schemaVersion: 1,
      bootstrapId: freshId,
      ordinal: 0,
      stagedPathHash: "b5bc39d40cb672d520cf6b4b27a7fef9d3b101b763e8fef201f1b1105348c6a5",
      sourceIdentityHash: "cecd42bf2ecf2da701d30d97c2a534c59c71a3ac491c5f1920cb65ff512acaab",
      bytes: 0,
      sha256: emptyHash,
      mode: 0o600,
      dev: "7",
      ino: "11",
    };
    evidence[key] = replacement;
    expect(() => validateBootstrapPayloadEvidence(evidence, emptyPayloadRef(), emptySource())).toThrow(
      BootstrapStateError,
    );
  });

  it("binds file creation evidence to the planned path, payload postimage, scope, and ordinal", () => {
    const planned = {
      kind: "file",
      path: "/product/state/empty-reservation" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: emptyPayloadRef(),
      parent: { kind: "preexisting", path: "/product/state", dev: "1", ino: "3" },
      cleanup: "remove_on_compensation",
    } as const;
    const evidence = {
      schemaVersion: 1,
      bootstrapId: freshId,
      scope: "ordinary",
      ordinal: 0,
      pathHash: "e8c7d414fe0ff9b8fb85bd662bc1a281f8228ee3dc76ac52407dc88c65036caf",
      kind: "file",
      dev: "7",
      ino: "11",
      postimageHash: emptyHash,
    };
    expect(validateCreatedPathEvidence(evidence, planned as unknown as PlannedCreatedPathV1, freshId, "ordinary", 0)).toEqual(evidence);
  });

  it("refuses the first byte beyond the independent 512-MiB payload-evidence ceiling", () => {
    const ref = {
      ...emptyPayloadRef(),
      hash: hashA,
      bytes: 536_870_913,
    };
    const source = {
      kind: "guarded_package_file",
      packageRoot: "/package",
      packageRootDev: "8",
      packageRootIno: "9",
      packageInventoryHash: hashB,
      relativePath: "oversized.bin",
      sourceBytes: 536_870_913,
      sourceHash: hashA,
      sourceMode: 0o600,
      sourceDev: "8",
      sourceIno: "10",
    } as unknown as BootstrapPayloadSourceV1;
    expect(() => validateBootstrapPayloadEvidence({
      schemaVersion: 1,
      bootstrapId: freshId,
      ordinal: 0,
      stagedPathHash: "b5bc39d40cb672d520cf6b4b27a7fef9d3b101b763e8fef201f1b1105348c6a5",
      sourceIdentityHash: "37b78dc16cc47e2638a16baf016fe27ff41ad36044e2e4074bc8c88327952199",
      bytes: 536_870_913,
      sha256: hashA,
      mode: 0o600,
      dev: "7",
      ino: "11",
    }, ref, source)).toThrow(BootstrapStateError);
  });

  it("refuses the first ordinal beyond the independent creation-evidence ceiling", () => {
    const planned = {
      kind: "directory",
      path: "/product/state/too-many" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: { kind: "preexisting", path: "/product/state", dev: "1", ino: "3" },
      cleanup: "remove_on_compensation",
    } as const;
    expect(() => validateCreatedPathEvidence({
      schemaVersion: 1,
      bootstrapId: freshId,
      scope: "ordinary",
      ordinal: 1_000_000,
      pathHash: createHash("sha256").update(planned.path).digest("hex"),
      kind: "directory",
      dev: "7",
      ino: "11",
      postimageHash: null,
    }, planned as never, freshId, "ordinary", 1_000_000)).toThrow(BootstrapStateError);
  });
});

const compensationId = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_c";
const forwardId = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_f";
const compensationJournalHash = "012b39a7bd2ad74a52faeaa6be4d5c3c473fba659e38e4962bb35d7ddb9cfe55" as LowerHexSha256;
const forwardJournalHash = "7f8df08f88eaa9d4eddcc4dc78b954505d471c5b12449fa108ea4b70944e9c3e" as LowerHexSha256;
const manifestPayloadHash = "33b40975be5962d2fa7979b78ebf70b4fd662ec8382b1039f0a7e47acd4e914d" as LowerHexSha256;
const noncePayloadHash = "4635042acefc14343e21753cde7f1465c323970e205d422248232ff8e2a0fad2" as LowerHexSha256;
const allocatorPayloadHash = "30d0167472cb1c3d44bb1e24996fad87a49aac78d30ef59f497e590fce1c3816" as LowerHexSha256;
const activePayloadHash = "ca3d0accd7c0003cf4986f3def19413cadec29087c1285f5f250ce8a9e0680ac" as LowerHexSha256;
const trustPayloadHash = "9a4b51195d32b291c5b7a171a7103b0bf83d449ecce3c2d1dbf82e47fb505288" as LowerHexSha256;

function compensationJournalValue() {
  return {
    schemaVersion: 1,
    id: compensationId,
    kind: "fresh_init_artifacts",
    phase: "planned",
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    mutations: [
      {
        targetPath: "/product/legacy.txt",
        operation: "create",
        expectedBeforeHash: null,
        stagedRelativePath: "0.bin",
      },
    ],
  } as const;
}

function forwardJournalValue() {
  return {
    schemaVersion: 1,
    id: forwardId,
    kind: "fresh_init_artifacts",
    phase: "planned",
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    mutations: [
      {
        targetPath: "/product/legacy.txt",
        operation: "remove",
        expectedBeforeHash: hashA,
        stagedRelativePath: null,
      },
    ],
  } as const;
}

function bootstrapRef(ordinal: number, hash: LowerHexSha256, bytes: number): BootstrapExpectedPayloadRefV1 {
  return {
    kind: "bootstrap_expected",
    bootstrapId: freshId,
    ordinal,
    path: `/product/state/.fresh-v2-init.${freshId}.${String(ordinal).padStart(10, "0")}.payload` as never,
    hash,
    bytes,
    mode: 0o600,
  };
}

function fullPlanFixture() {
  const compensationRef = bootstrapRef(0, compensationJournalHash, 336);
  const forwardRef = bootstrapRef(1, forwardJournalHash, 395);
  const packageRef = bootstrapRef(2, hashA, 1);
  const manifestRef = bootstrapRef(3, manifestPayloadHash, 379);
  const nonceRef = bootstrapRef(4, noncePayloadHash, 65);
  const allocatorRef = bootstrapRef(5, allocatorPayloadHash, 120);
  const activeRef = bootstrapRef(6, activePayloadHash, 635);
  const trustRef = bootstrapRef(7, trustPayloadHash, 473);
  const compensationSource = {
    kind: "plan_derived",
    role: "foundation_initial_journal",
    value: compensationJournalValue(),
    valueBytes: 335,
    projectionHash: "d4b50ceee3efa65e3120ac2086cd5e3bcad80b66955ebd88156d65529f76ee96",
  } as const;
  const forwardSource = {
    kind: "plan_derived",
    role: "foundation_initial_journal",
    value: forwardJournalValue(),
    valueBytes: 394,
    projectionHash: "48f8d4863f857d7fac752dd891cc16b8dffaf917483b7025ef3ce3ccc93dcc6e",
  } as const;
  const packageSource = {
    kind: "guarded_package_file",
    packageRoot: "/package" as CanonicalAbsolutePathV1,
    packageRootDev: "8",
    packageRootIno: "9",
    packageInventoryHash: hashB,
    relativePath: "legacy.txt" as never,
    sourceBytes: 1,
    sourceHash: hashA,
    sourceMode: 0o600,
    sourceDev: "8",
    sourceIno: "10",
  } as const;
  const manifestValue = {
    schemaVersion: 2,
    productVersion: "1.0.0",
    installedAt: "2026-08-29T12:00:00.000Z",
    artifacts: [
      {
        owner: "core",
        path: "/product/releases",
        productVersion: "1.0.0",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        source: "bundle-root",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-08-29T12:00:00.000Z",
        kind: "directory",
        verification: { mode: "content" },
      },
    ],
  } as const;
  const manifestSource = {
    kind: "plan_derived",
    role: "manifest_after",
    value: manifestValue,
    valueBytes: 378,
    projectionHash: "91f3edfa1019506a5982c05aa0382f68149e8dd6c8c19948a1cd6c48f2d12b8c",
  } as const;
  const nonceSource = {
    kind: "plan_derived",
    role: "lifecycle_nonce",
    value: hashC,
    valueBytes: 64,
    projectionHash: "78d7752d0785e9a35303a4f5730330315fdda43a14b329d11429a206fd170e68",
  } as const;
  const allocatorSource = {
    kind: "plan_derived",
    role: "lifecycle_allocator",
    value: { schemaVersion: 1, installNonce: hashC, nextCounter: "0" },
    valueBytes: 119,
    projectionHash: "2641c1a08df07789e8329b7339a908e1ea05f462a5fa34dd9528cbd3b0fcff68",
  } as const;
  const activeSource = {
    kind: "plan_derived",
    role: "active_release",
    value: {
      schemaVersion: 1,
      version: "1.0.0",
      releaseSequence: "3",
      releaseIdentityHash: emptyHash,
      delegationSequence: "1",
      delegationHash: hashA,
      releaseIndexSequence: "2",
      releaseIndexHash: hashC,
      bundleManifestHash: hashB,
      bundleRoot: "/product/releases/1.0.0/darwin-arm64",
      platform: "darwin",
      architecture: "arm64",
      launcherProtocol: 1,
      updateProtocol: 1,
      activatedAt: "2026-08-29T12:00:00.000Z",
    },
    valueBytes: 634,
    projectionHash: "a348abdb6a434b395e3ee899bb95512ffe3c853f0c23ff80fccad77c2a71ba8f",
  } as const;
  const trustSource = {
    kind: "plan_derived",
    role: "release_trust",
    value: {
      schemaVersion: 1,
      highestDelegationSequence: "1",
      delegationHash: hashA,
      delegatedReleaseKeyId: hashB,
      highestReleaseIndexSequence: "2",
      releaseIndexHash: hashC,
      highestAcceptedReleaseSequence: "3",
      releaseIdentityHash: emptyHash,
    },
    valueBytes: 472,
    projectionHash: "cfc26134f42de5756dc088a4bfd5e905b10119f1552115c765780a204cf6c497",
  } as const;

  const compensation: FoundationParticipantRefV2 = {
    id: compensationId,
    slot: "fresh_init_artifacts",
    role: { kind: "compensation", forwardId: forwardId as never },
    mutations: [
      {
        targetPath: "/product/legacy.txt" as CanonicalAbsolutePathV1,
        operation: "create",
        expectedBeforeHash: null,
        contentHash: hashA,
        contentSize: 1,
        stagedPath: `/product/staging/transactions/${compensationId}/0.bin` as CanonicalAbsolutePathV1,
      },
    ],
    maximumJournalBytes: 1_048_576,
    planHash: "36eb97a3fdc22dd9f534ee786a5cde7f2a025c8b4f2dba280027102686d4716a" as LowerHexSha256,
    initialJournal: {
      finalPath: `/product/state/transactions/${compensationId}.json` as CanonicalAbsolutePathV1,
      plannedBytesHash: compensationJournalHash,
      staged: compensationRef,
    },
  };
  const forward: FoundationParticipantRefV2 = {
    id: forwardId,
    slot: "fresh_init_artifacts",
    role: { kind: "forward", compensationId: compensationId as never },
    mutations: [
      {
        targetPath: "/product/legacy.txt" as CanonicalAbsolutePathV1,
        operation: "remove",
        expectedBeforeHash: hashA,
        contentHash: null,
        contentSize: null,
        stagedPath: null,
      },
    ],
    maximumJournalBytes: 1_048_576,
    planHash: "32861037c4d21ee50ff3ed5287767e43e06f7718795f359906a958cbb49ec17f" as LowerHexSha256,
    initialJournal: {
      finalPath: `/product/state/transactions/${forwardId}.json` as CanonicalAbsolutePathV1,
      plannedBytesHash: forwardJournalHash,
      staged: forwardRef,
    },
  };

  const preexisting = (path: string, dev: string, ino: string) => ({
    kind: "preexisting" as const,
    path: path as CanonicalAbsolutePathV1,
    dev,
    ino,
  });
  const created = (ordinal: number) => ({ kind: "created_path" as const, scope: "ordinary" as const, ordinal });
  const createdPaths: PlannedCreatedPathV1[] = [
    {
      kind: "global_lock",
      path: "/product/state/.lifecycle.lock" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o600,
      parent: preexisting("/product/state", "1", "3") as never,
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: "/product/releases" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: preexisting("/product", "1", "2") as never,
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: "/product/staging" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: preexisting("/product", "1", "2") as never,
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: "/product/staging/fresh-v2-init" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: created(2),
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: `/product/staging/fresh-v2-init/${freshId}` as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: created(3),
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: "/product/staging/transactions" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: created(2),
      cleanup: "remove_on_compensation",
    },
    {
      kind: "directory",
      path: `/product/staging/transactions/${compensationId}` as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      mode: 0o700,
      parent: created(5),
      cleanup: "remove_on_compensation",
    },
    {
      kind: "file",
      path: `/product/staging/transactions/${compensationId}/0.bin` as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: packageRef,
      parent: created(6),
      cleanup: "remove_on_compensation",
    },
    {
      kind: "file",
      path: "/product/state/lifecycle-id-allocator.json" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: allocatorRef,
      parent: preexisting("/product/state", "1", "3") as never,
      cleanup: "remove_on_compensation",
    },
    {
      kind: "file",
      path: "/product/state/lifecycle-install-nonce" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: nonceRef,
      parent: preexisting("/product/state", "1", "3") as never,
      cleanup: "remove_on_compensation",
    },
  ];
  const launchabilityPaths: PlannedCreatedPathV1[] = Array.from({ length: 5 }, (_, ordinal) => ({
    kind: "directory" as const,
    path: `/product/releases/${String(ordinal)}` as CanonicalAbsolutePathV1,
    expectedBefore: "absent" as const,
    ownerUid: 501,
    mode: 0o700 as const,
    parent: created(1),
    cleanup: "remove_on_compensation" as const,
  }));
  launchabilityPaths.push(
    {
      kind: "file",
      path: "/product/state/release-trust.json" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: trustRef,
      parent: preexisting("/product/state", "1", "3") as never,
      cleanup: "remove_on_compensation",
    },
    {
      kind: "file",
      path: "/product/state/active-release.json" as CanonicalAbsolutePathV1,
      expectedBefore: "absent",
      ownerUid: 501,
      payload: activeRef,
      parent: preexisting("/product/state", "1", "3") as never,
      cleanup: "remove_on_compensation",
    },
  );
  const manifest = {
    schemaVersion: 1,
    participantId: `mf_${freshId}`,
    envelope: { kind: "fresh_v2_init", id: freshId },
    bindings: {
      foundationTransactions: {
        count: 1,
        orderedIdsHash: "9f893436c357d2f333d2fdf31227d8fc1e7fb82483c241f95a89fefc67a43906",
      },
      externalEffects: [],
    },
    manifestPath: "/product/state/installation-manifest.json",
    tombstonePath: `/product/state/.installation-manifest.mf_${freshId}.json.tombstone`,
    before: { state: "absent" },
    after: {
      state: "present",
      hash: manifestPayloadHash,
      bytes: manifestRef,
      ownerUid: 501,
      mode: 0o600,
      nlink: 1,
      size: "379",
      dev: null,
      ino: null,
    },
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  } as const;
  const externalShape = {
    entries: [
      { role: "product_home", pathHash: "7adda4af8b5bd4c3aaf73053b9ce178dfcd0647dffe3cdf70abd65b133d52293", kind: "directory", ownerUid: 501, mode: 0o700, nlink: 2, size: "64", dev: "1", ino: "2" },
      { role: "state_directory", pathHash: "6b008999a21b745d30db63a6e60e7c214343331d3d85be0397ad3bf095c31ec4", kind: "directory", ownerUid: 501, mode: 0o700, nlink: 2, size: "96", dev: "1", ino: "3" },
      { role: "bootstrap_lock", pathHash: "e256b3d72a9e420339b90e25e0eadef770a70a3300d0da1d251a46fba5c5eebd", kind: "regular_file", ownerUid: 501, mode: 0o600, nlink: 1, size: "0", dev: "1", ino: "4" },
    ],
  } as unknown as BootstrapExternalShapeProjectionV1;
  const plan: FreshV2InitPlanV1 = {
    schemaVersion: 1,
    operation: "fresh_v2_init",
    id: freshId,
    admittedExternalShapeHash: "2061e8dbdf8a71cc29673a6a7a767f5a8a65665c266b2bd1cd4ddd95369f8c40" as LowerHexSha256,
    v2ManifestHash: manifestPayloadHash,
    bootstrapIdentity: {
      path: "/product/state/.lifecycle-bootstrap.lock" as CanonicalAbsolutePathV1,
      ownerUid: 501,
      mode: 0o600,
      nlink: 1,
      size: 0,
      dev: "1" as never,
      ino: "4" as never,
    },
    planPath: `/product/state/fresh-v2-init.${freshId}.plan.json` as never,
    journalPath: `/product/state/fresh-v2-init.${freshId}.journal.json` as never,
    stagingRoot: `/product/staging/fresh-v2-init/${freshId}` as CanonicalAbsolutePathV1,
    maximumPlanBytes: 268_435_456,
    maximumJournalBytes: 1_048_576,
    maximumStagingEntries: 76,
    payloads: [
      { ref: compensationRef, source: compensationSource as unknown as BootstrapPayloadSourceV1 },
      { ref: forwardRef, source: forwardSource as unknown as BootstrapPayloadSourceV1 },
      { ref: packageRef, source: packageSource as unknown as BootstrapPayloadSourceV1 },
      { ref: manifestRef, source: manifestSource as unknown as BootstrapPayloadSourceV1 },
      { ref: nonceRef, source: nonceSource as unknown as BootstrapPayloadSourceV1 },
      { ref: allocatorRef, source: allocatorSource as unknown as BootstrapPayloadSourceV1 },
      { ref: activeRef, source: activeSource as unknown as BootstrapPayloadSourceV1 },
      { ref: trustRef, source: trustSource as unknown as BootstrapPayloadSourceV1 },
    ],
    createdPaths,
    foundationParticipants: [compensation, forward],
    launchabilityPaths,
    manifest: manifest as never,
  };
  const evidence = {
    reopenCanonicalAbsolutePath: (path: string) => path,
    containsCanonicalPath: (root: string, candidate: string) => candidate.startsWith(`${root}/`),
    hasFoldedAlias: () => false,
  };
  const context = {
    evidence,
    productHome,
    stateRoot: "/product/state" as CanonicalAbsolutePathV1,
    productStagingRoot: "/product/staging" as CanonicalAbsolutePathV1,
    operation: "fresh_v2_init" as const,
    id: freshId,
    bootstrapIdentity: plan.bootstrapIdentity,
    externalShape,
    admitPayloadSource: (source: BootstrapPayloadSourceV1) => structuredClone(source),
    admitPlannedCreatedPath: (value: PlannedCreatedPathV1) => structuredClone(value),
    admitPreexistingParent: (value: Extract<PlannedCreatedPathV1["parent"], { readonly kind: "preexisting" }>) => structuredClone(value),
    admitFoundationParticipant: (value: FoundationParticipantRefV2) => structuredClone(value),
    admitManifestParticipant: () => structuredClone(manifest) as never,
    admitPlanDerivedValue: (_role: string, value: unknown) => structuredClone(value) as never,
  };
  return { plan, context, compensationSource, forwardSource, packageSource, manifestSource };
}

const migrationId = "mm_123e4567-e89b-42d3-a456-426614174000" as ManifestMigrationIdV1;

function canonicalDomainHash(domain: string, value: unknown): string {
  const encoded = encodeCanonicalJson(value as never);
  return createHash("sha256")
    .update(domain)
    .update(encoded.slice(0, -1))
    .digest("hex");
}

function migrationPlanFixture(): {
  readonly plan: ManifestMigrationPlanV1;
  readonly context: ReturnType<typeof fullPlanFixture>["context"];
} {
  const fresh = fullPlanFixture();
  const candidate = JSON.parse(
    JSON.stringify(fresh.plan)
      .replaceAll(freshId, migrationId)
      .replaceAll("fresh-v2-init", "manifest-migration")
      .replaceAll("fresh_init_artifacts", "v1_migration_artifacts"),
  ) as Record<string, unknown>;
  candidate.operation = "v1_to_v2";
  candidate.v1ManifestHash = hashA;
  candidate.paths = {
    plan: `/product/state/manifest-migration.${migrationId}.plan.json`,
    journal: `/product/state/manifest-migration.${migrationId}.journal.json`,
    stagingRoot: `/product/staging/manifest-migration/${migrationId}`,
  };
  delete candidate.admittedExternalShapeHash;
  delete candidate.planPath;
  delete candidate.journalPath;
  delete candidate.stagingRoot;

  const payloads = candidate.payloads as Array<{
    ref: Record<string, unknown>;
    source: Record<string, unknown>;
  }>;
  required(payloads[2]).source = {
    kind: "guarded_migration_preimage",
    authority: {
      kind: "v1_manifest",
      migrationId,
      v1ManifestHash: hashA,
    },
    path: "/product/state/installation-manifest.json",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    bytes: 1,
    sha256: hashA,
    dev: "1",
    ino: "30",
  };
  const participants = candidate.foundationParticipants as Array<{
    id: string;
    role: { kind: string; compensationId?: string; forwardId?: string };
    slot: string;
    mutations: unknown[];
    maximumJournalBytes: number;
    planHash: string;
    initialJournal: {
      finalPath: string;
      plannedBytesHash: string;
      staged: Record<string, unknown>;
    };
  }>;
  for (const participant of participants) {
    const ordinal = Number(participant.initialJournal.staged.ordinal);
    const row = required(payloads[ordinal]);
    const bytes = new TextEncoder().encode(`${JSON.stringify(row.source.value)}\n`);
    const journalHash = createHash("sha256").update(bytes).digest("hex");
    row.ref.hash = journalHash;
    row.ref.bytes = bytes.byteLength;
    row.source.valueBytes = bytes.byteLength - 1;
    row.source.projectionHash = canonicalDomainHash(
      "developer-os/bootstrap-plan-derived/foundation_initial_journal/v1\0",
      { role: "foundation_initial_journal", value: row.source.value },
    );
    participant.initialJournal.plannedBytesHash = journalHash;
    participant.initialJournal.staged.hash = journalHash;
    participant.initialJournal.staged.bytes = bytes.byteLength;
    const staged = participant.initialJournal.staged;
    participant.planHash = canonicalDomainHash(
      "developer-os/foundation-participant-plan/v2\0",
      {
        schemaVersion: 2,
        id: participant.id,
        slot: participant.slot,
        role: participant.role,
        mutations: participant.mutations,
        maximumJournalBytes: participant.maximumJournalBytes,
        initialJournal: {
          finalPath: participant.initialJournal.finalPath,
          staged: {
            kind: staged.kind,
            bootstrapId: staged.bootstrapId,
            ordinal: staged.ordinal,
            path: staged.path,
            bytes: staged.bytes,
            mode: staged.mode,
          },
        },
      },
    );
  }
  const manifest = candidate.manifest as never as {
    envelope: { kind: string; id: string };
    bindings: { foundationTransactions: { count: number; orderedIdsHash: string } };
  };
  manifest.envelope = { kind: "v1_migration", id: migrationId };
  const forwardIds = participants
    .filter((participant) => participant.role.kind === "forward")
    .map((participant) => participant.id);
  manifest.bindings.foundationTransactions = {
    count: forwardIds.length,
    orderedIdsHash: createHash("sha256")
      .update("developer-os/manifest-foundation-bindings/v1\0")
      .update(JSON.stringify(forwardIds))
      .digest("hex"),
  };

  const plan = candidate as unknown as ManifestMigrationPlanV1;
  const context = {
    ...fresh.context,
    operation: "v1_to_v2" as const,
    id: migrationId,
    externalShape: null,
    admitManifestParticipant: () => structuredClone(plan.manifest),
  } as unknown as ReturnType<typeof fullPlanFixture>["context"];
  return { plan, context };
}

describe("immutable bootstrap plan exact grammar", () => {
  it("admits one complete context-bound plan and retains every supplied field", () => {
    const fixture = fullPlanFixture();
    expect(validateBootstrapPlan(fixture.plan, fixture.context)).toEqual(fixture.plan);
    expect(
      createHash("sha256")
        .update(encodeCanonicalJson(fixture.plan as never))
        .digest("hex"),
    ).toBe("c3eb0826ecc678a1715d634628d8c453967333d8a6b448f227dcb90306cece17");
  });

  it("pins every admitted plan-derived role and guarded-package source to its independent source-identity digest", () => {
    const fixture = fullPlanFixture();
    expect(
      fixture.plan.payloads.map((row) => bootstrapPayloadSourceIdentityHash(row.source)),
    ).toStrictEqual([
      "13e23bf4614d389742666ec6ccb663f1c34a42d3254286e080a5c84fdbd2cc0a",
      "114ec9fc9a4bc675f943fe3535ce73f1fbbf5cf4d639cdd43daa71fd8e04286a",
      "c49b8099913bae81d3d08b65e18809de9c5a935e4881c54866955139a9bb35c2",
      "1984f60e07135df8cfbf4ceec34da80473cce0a7314f5a4a27c8533f64b9f084",
      "2180dc076301664f018df4aa75f44b64c62202954852741cd9321714d17c26d9",
      "e610cdbb85e8121b186bee38b89a61e65387df7692aad9177ec45b6dd4aef0bf",
      "e16c7411ffd8d02ccf410a54fedcde40fa46185099af895667d3db0f37d54832",
      "ddccb359d9b963399eed2f137b6eb26d6bf4b78f84b0d0b6827ae069520a31ca",
    ]);
  });

  it.each([
    {
      name: "payload cardinality reaches 1,000,001",
      mutate(plan: Record<string, unknown>) {
        plan.payloads = new Array(1_000_001);
      },
    },
    {
      name: "ordinary creation cardinality reaches 1,000,001",
      mutate(plan: Record<string, unknown>) {
        plan.createdPaths = new Array(1_000_001);
      },
    },
    {
      name: "launchability cardinality reaches 200,007",
      mutate(plan: Record<string, unknown>) {
        plan.launchabilityPaths = new Array(200_007);
      },
    },
    {
      name: "Foundation reference cardinality reaches 513",
      mutate(plan: Record<string, unknown>) {
        plan.foundationParticipants = new Array(513);
      },
    },
  ])("refuses when the independent $name first-over bound is reached", (testCase) => {
    const fixture = fullPlanFixture();
    const candidate = structuredClone(fixture.plan) as unknown as Record<string, unknown>;
    testCase.mutate(candidate);
    expect(() => validateBootstrapPlan(candidate, fixture.context)).toThrow(BootstrapStateError);
  });

  it.each([
    {
      name: "an unknown outer key widens the immutable document",
      mutate(plan: Record<string, unknown>) { plan.createdByAttempt = true; },
    },
    {
      name: "a caller-selected final plan path escapes derivation",
      mutate(plan: Record<string, unknown>) { plan.planPath = "/product/state/attacker.plan.json"; },
    },
    {
      name: "a caller-selected staging root escapes derivation",
      mutate(plan: Record<string, unknown>) { plan.stagingRoot = "/product/staging/attacker"; },
    },
    {
      name: "a first payload ordinal is noncontiguous",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ ref: Record<string, unknown> }>;
        required(payloads[0]).ref.ordinal = 1;
      },
    },
    {
      name: "a payload path is selected independently of its envelope and ordinal",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ ref: Record<string, unknown> }>;
        required(payloads[1]).ref.path = "/product/state/attacker.payload";
      },
    },
    {
      name: "a 0700 payload is substituted into the 0600 Foundation journal consumer",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ ref: Record<string, unknown> }>;
        required(payloads[0]).ref.mode = 0o700;
      },
    },
    {
      name: "a plan-derived projection hash omits the role domain",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ source: Record<string, unknown> }>;
        required(payloads[0]).source.projectionHash = hashA;
      },
    },
    {
      name: "a guarded source byte count disagrees with its payload ref",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ source: Record<string, unknown> }>;
        required(payloads[2]).source.sourceBytes = 2;
      },
    },
    {
      name: "a payload row is reused by both a created file and manifest postimage",
      mutate(plan: Record<string, unknown>) {
        const payloads = plan.payloads as Array<{ ref: unknown }>;
        const manifest = plan.manifest as { after: { bytes: unknown } };
        manifest.after.bytes = structuredClone(required(payloads[2]).ref);
      },
    },
    {
      name: "an unconsumed payload row survives the one-use bijection",
      mutate(plan: Record<string, unknown>) {
        const created = plan.createdPaths as Array<Record<string, unknown>>;
        created.pop();
      },
    },
    {
      name: "a Foundation pair skips deterministic ordinal zero",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<Record<string, unknown>>;
        required(refs[0]).id = compensationId.replace("0000000000", "0000000001");
      },
    },
    {
      name: "a Foundation forward ref points at the wrong compensation ID",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<{ role: Record<string, unknown> }>;
        required(refs[1]).role.compensationId = forwardId;
      },
    },
    {
      name: "a Foundation inverse forgets to reverse the forward operation",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<{ mutations: Array<Record<string, unknown>> }>;
        required(required(refs[0]).mutations[0]).operation = "remove";
      },
    },
    {
      name: "a Foundation plan hash reuses the Spec 1 digest",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<Record<string, unknown>>;
        required(refs[1]).planHash = hashA;
      },
    },
    {
      name: "a Foundation initial journal publishes to a caller-selected final path",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<{ initialJournal: Record<string, unknown> }>;
        required(refs[0]).initialJournal.finalPath = "/product/state/transactions/attacker.json";
      },
    },
    {
      name: "a Foundation planned-journal hash disagrees with exact JSON.stringify bytes",
      mutate(plan: Record<string, unknown>) {
        const refs = plan.foundationParticipants as Array<{ initialJournal: Record<string, unknown> }>;
        required(refs[0]).initialJournal.plannedBytesHash = hashA;
      },
    },
    {
      name: "ordinary creation no longer starts with the exact permanent global lock",
      mutate(plan: Record<string, unknown>) {
        const created = plan.createdPaths as unknown[];
        [created[0], created[1]] = [created[1], created[0]];
      },
    },
    {
      name: "a child names a parent created after it",
      mutate(plan: Record<string, unknown>) {
        const created = plan.createdPaths as Array<{ parent: Record<string, unknown> }>;
        required(created[4]).parent.ordinal = 5;
      },
    },
    {
      name: "a created parent is not the adjacent lexical parent",
      mutate(plan: Record<string, unknown>) {
        const created = plan.createdPaths as Array<{ parent: Record<string, unknown> }>;
        required(created[7]).parent.ordinal = 5;
      },
    },
    {
      name: "launchability drops below its seven-path minimum",
      mutate(plan: Record<string, unknown>) {
        (plan.launchabilityPaths as unknown[]).pop();
      },
    },
    {
      name: "the staging aggregate undercounts one reachable entry",
      mutate(plan: Record<string, unknown>) { plan.maximumStagingEntries = 75; },
    },
    {
      name: "the manifest envelope points at a different bootstrap ID",
      mutate(plan: Record<string, unknown>) {
        const manifest = plan.manifest as { envelope: Record<string, unknown> };
        manifest.envelope.id = "fi_123e4567-e89b-42d3-a456-426614174099";
      },
    },
    {
      name: "the manifest after hash disagrees with v2ManifestHash",
      mutate(plan: Record<string, unknown>) { plan.v2ManifestHash = hashA; },
    },
    {
      name: "a bootstrap manifest introduces an external effect",
      mutate(plan: Record<string, unknown>) {
        const manifest = plan.manifest as { bindings: { externalEffects: unknown[] } };
        manifest.bindings.externalEffects.push({ kind: "git", id: "git_1", planHash: hashA });
      },
    },
  ])("refuses when $name", (testCase) => {
    const fixture = fullPlanFixture();
    const candidate = structuredClone(fixture.plan) as unknown as Record<string, unknown>;
    testCase.mutate(candidate);
    expect(() => validateBootstrapPlan(candidate, fixture.context)).toThrow(BootstrapStateError);
  });

  it.each([
    {
      name: "payload source callback substitutes a different admitted arm",
      patch: { admitPayloadSource: () => emptySource() },
    },
    {
      name: "created-path callback substitutes a different authority row",
      patch: { admitPlannedCreatedPath: () => required(fullPlanFixture().plan.createdPaths[0]) },
    },
    {
      name: "Foundation callback substitutes its paired participant",
      patch: { admitFoundationParticipant: () => required(fullPlanFixture().plan.foundationParticipants[1]) },
    },
    {
      name: "manifest callback substitutes a different participant ID",
      patch: { admitManifestParticipant: (value: Record<string, unknown>) => ({ ...value, participantId: "mf_attacker" }) },
    },
    {
      name: "plan-derived callback substitutes the complete value",
      patch: { admitPlanDerivedValue: () => ({ schemaVersion: 999 }) },
    },
  ])("refuses when $name", ({ patch }) => {
    const fixture = fullPlanFixture();
    expect(() => validateBootstrapPlan(fixture.plan, { ...fixture.context, ...patch } as never)).toThrow(
      BootstrapStateError,
    );
  });

  it.each([
    {
      name: "the initial allocator names a different lifecycle nonce",
      value: { schemaVersion: 1, installNonce: hashB, nextCounter: "0" },
      valueBytes: 119,
      bytes: 120,
      hash: "2e4d5f4f41627f3c9fea91f91cb2ea892c89eede5f4b03e7b8dba63f612b22a3",
      projectionHash: "ff9bedb75dcd2fdf9f65c28065e37955b90013793d0e5db24935bbf01a8143be",
    },
    {
      name: "the initial allocator starts after counter zero",
      value: { schemaVersion: 1, installNonce: hashC, nextCounter: "1" },
      valueBytes: 119,
      bytes: 120,
      hash: "bd2538be5ca3fc656860ef5748d618da86288053312ea53cc2386f52f1067cee",
      projectionHash: "0b7b4202382a64cb316fc41a9184430871d23a5c5f2a9a97b8f7a20b1d282140",
    },
    {
      name: "the allocator counter uses a non-canonical uint64 spelling",
      value: { schemaVersion: 1, installNonce: hashC, nextCounter: "00" },
      valueBytes: 120,
      bytes: 121,
      hash: "85743743c3f37f3e3779170868ed54d1347c58a21a46c6dd8126341666c4bcff",
      projectionHash: "1f78ee579912a8224bbaef14ac17a4ee3466415f74a291e7f300ad03a18ed661",
    },
    {
      name: "an unknown allocator key widens the lifecycle epoch schema",
      value: { schemaVersion: 1, installNonce: hashC, nextCounter: "0", extra: true },
      valueBytes: 132,
      bytes: 133,
      hash: "f9301cfe26d65508873fb4fdb4788785bd7166fff984aea844b67438cf0bacb7",
      projectionHash: "48bf0aa7cad9da543ea856cf53499cd9a4744b3452851d5911daf1f9c0958d2c",
    },
  ])("refuses when $name", ({ value, valueBytes, bytes, hash, projectionHash }) => {
    const fixture = fullPlanFixture();
    const plan = structuredClone(fixture.plan) as never as {
      payloads: Array<{
        ref: { hash: string; bytes: number };
        source: { value: unknown; valueBytes: number; projectionHash: string };
      }>;
      createdPaths: Array<{ payload?: { hash: string; bytes: number } }>;
    };
    const allocator = required(plan.payloads[5]);
    allocator.ref.hash = hash;
    allocator.ref.bytes = bytes;
    allocator.source.value = value;
    allocator.source.valueBytes = valueBytes;
    allocator.source.projectionHash = projectionHash;
    required(plan.createdPaths[8]).payload = allocator.ref;
    expect(() => validateBootstrapPlan(plan, fixture.context)).toThrow(BootstrapStateError);
  });
});

describe("migration-only bootstrap grammar", () => {
  it("admits the complete v1_to_v2 arm with literal derived envelope paths and guarded V1 preimage authority", () => {
    const fixture = migrationPlanFixture();
    expect(validateBootstrapPlan(fixture.plan, fixture.context as never)).toEqual(fixture.plan);
    expect(fixture.plan.paths).toStrictEqual({
      plan: "/product/state/manifest-migration.mm_123e4567-e89b-42d3-a456-426614174000.plan.json",
      journal: "/product/state/manifest-migration.mm_123e4567-e89b-42d3-a456-426614174000.journal.json",
      stagingRoot: "/product/staging/manifest-migration/mm_123e4567-e89b-42d3-a456-426614174000",
    });
    expect(fixture.plan.payloads[2]?.source).toMatchObject({
      kind: "guarded_migration_preimage",
      authority: {
        kind: "v1_manifest",
        migrationId,
        v1ManifestHash: hashA,
      },
      path: "/product/state/installation-manifest.json",
      bytes: 1,
      sha256: hashA,
    });
    expect(
      bootstrapPayloadSourceIdentityHash(required(fixture.plan.payloads[2]).source),
    ).toBe("7c3509b4e184545fd160d17b9c6b5a37ee1355a5947740b6598089c05e895a08");
    expect(
      createHash("sha256")
        .update(encodeCanonicalJson(fixture.plan as never))
        .digest("hex"),
    ).toBe("1945b2fdf0432ddbeefef851c67acae48533b4ffbe7cfe76440fb91df518cd67");
  });

  it.each([
    {
      name: "a fresh envelope smuggles the migration-preimage source arm",
      arrange() {
        const fixture = fullPlanFixture();
        const candidate = structuredClone(fixture.plan) as never as { payloads: Array<{ source: unknown }> };
        required(candidate.payloads[2]).source = required(migrationPlanFixture().plan.payloads[2]).source;
        return { plan: candidate, context: fixture.context };
      },
    },
    {
      name: "the migration authority names a different immutable V1 manifest hash",
      arrange() {
        const fixture = migrationPlanFixture();
        const candidate = structuredClone(fixture.plan) as never as {
          payloads: Array<{ source: { authority?: { v1ManifestHash: string } } }>;
        };
        const source = required(candidate.payloads[2]).source;
        const authority = required(source.authority);
        authority.v1ManifestHash = hashB;
        return { plan: candidate, context: fixture.context };
      },
    },
    {
      name: "a caller-selected migration final path bypasses envelope derivation",
      arrange() {
        const fixture = migrationPlanFixture();
        const candidate = structuredClone(fixture.plan) as never as { paths: { plan: string } };
        candidate.paths.plan = "/product/state/attacker.plan.json";
        return { plan: candidate, context: fixture.context };
      },
    },
  ])("refuses when $name", (testCase) => {
    const { plan, context } = testCase.arrange();
    expect(() => validateBootstrapPlan(plan, context as never)).toThrow(BootstrapStateError);
  });
});

/*
 * This plan is already admitted for journal tests. Its nested participants are deliberately
 * opaque because validateBootstrapJournal consumes, rather than re-mints, plan authority.
 * The literal plan hash below was hand-derived from this fixed JSON fixture; no bootstrap
 * production helper computes the expectation.
 */
function admittedJournalPlan(): FreshV2InitPlanV1 {
  return {
    schemaVersion: 1,
    operation: "fresh_v2_init",
    id: freshId,
    admittedExternalShapeHash: hashA,
    v2ManifestHash: hashB,
    bootstrapIdentity: {
      path: "/product/state/.lifecycle-bootstrap.lock" as CanonicalAbsolutePathV1,
      ownerUid: 501,
      mode: 0o600,
      nlink: 1,
      size: 0,
      dev: "1" as never,
      ino: "4" as never,
    },
    planPath: "/product/state/fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.plan.json" as never,
    journalPath: "/product/state/fresh-v2-init.fi_123e4567-e89b-42d3-a456-426614174000.journal.json" as never,
    stagingRoot: "/product/staging/fresh-v2-init/fi_123e4567-e89b-42d3-a456-426614174000" as CanonicalAbsolutePathV1,
    maximumPlanBytes: 268_435_456,
    maximumJournalBytes: 1_048_576,
    maximumStagingEntries: 31,
    payloads: [{ ref: emptyPayloadRef(), source: emptySource() }],
    createdPaths: [{ role: "opaque-created" } as never],
    foundationParticipants: [
      { role: { kind: "forward", compensationId: "opaque-c" } } as never,
      { role: { kind: "compensation", forwardId: "opaque-f" } } as never,
    ],
    launchabilityPaths: Array.from({ length: 7 }, (_, ordinal) => ({ ordinal }) as never),
    manifest: { participantId: "opaque-manifest" } as never,
  };
}

const admittedPlanHash = "297a5eaa021f76581f190915247d89c1e78028696f192236a2ae47ca14fca4e1" as LowerHexSha256;

function journal(overrides: Partial<FreshV2InitJournalV1> = {}): FreshV2InitJournalV1 {
  return {
    schemaVersion: 1,
    id: freshId,
    planHash: admittedPlanHash,
    phase: "planned",
    direction: "forward",
    nextPayload: 0,
    payloadWriteState: { state: "idle" },
    nextCreatedPath: 0,
    nextFoundationParticipant: 0,
    nextLaunchabilityPath: 0,
    manifestCursor: 0,
    compensationNext: null,
    payloadCleanupPart: null,
    terminalOutcome: null,
    compactionNext: null,
    createdAt: "2026-08-29T12:00:00.000Z" as never,
    updatedAt: "2026-08-29T12:00:00.000Z" as never,
    ...overrides,
  };
}

const legalForwardJournalRows: readonly [string, Partial<FreshV2InitJournalV1>][] = [
  ["planned owns no cursor", {}],
  [
    "payload_staging owns the exact create-intent ordinal without advancing evidence",
    { phase: "payload_staging", payloadWriteState: { state: "create_intent", ordinal: 0 } },
  ],
  [
    "payload_staging owns the exact writing inode without advancing evidence",
    { phase: "payload_staging", payloadWriteState: { state: "writing", ordinal: 0, dev: "8" as never, ino: "9" as never } },
  ],
  ["payload_staging owns only nextPayload", { phase: "payload_staging", nextPayload: 1 }],
  ["creating owns only nextCreatedPath", { phase: "creating", nextPayload: 1, nextCreatedPath: 1 }],
  [
    "foundation_applying owns only the forward-role cursor",
    { phase: "foundation_applying", nextPayload: 1, nextCreatedPath: 1, nextFoundationParticipant: 1 },
  ],
  [
    "launchability_publishing owns only its fixed suffix cursor",
    {
      phase: "launchability_publishing",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
    },
  ],
  [
    "manifest_publishing reaches the durable point of no return",
    {
      phase: "manifest_publishing",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 2,
    },
  ],
  [
    "verifying owns the post-publication manifest cursor",
    {
      phase: "verifying",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
    },
  ],
  [
    "finalized closes every forward cursor",
    {
      phase: "finalized",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
      terminalOutcome: "finalized",
    },
  ],
  [
    "compensating starts at the highest reached ordinary-create step",
    {
      phase: "compensating",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: 1,
    },
  ],
  [
    "compensating owns the partial payload inode and its staged-file subcursor",
    {
      phase: "compensating",
      direction: "compensating",
      payloadWriteState: { state: "writing", ordinal: 0, dev: "8" as never, ino: "9" as never },
      compensationNext: 0,
      payloadCleanupPart: "staged_file",
    },
  ],
  [
    "rolled_back closes compensation at minus one before the point of no return",
    {
      phase: "rolled_back",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
    },
  ],
  [
    "finalized compaction starts from the complete force-forward cursor",
    {
      phase: "compacting",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      compactionNext: 0,
    },
  ],
  [
    "rolled-back compaction retains the compensating direction and closed reverse cursor",
    {
      phase: "compacting",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: -1,
      terminalOutcome: "rolled_back",
      compactionNext: 0,
    },
  ],
];

const illegalCursorRows: readonly [string, Partial<FreshV2InitJournalV1>][] = [
  ["planned advances payload without owning it", { nextPayload: 1 }],
  ["payload_staging advances an ordinary create", { phase: "payload_staging", nextCreatedPath: 1 }],
  ["creating begins before all payload evidence", { phase: "creating", nextCreatedPath: 1 }],
  [
    "foundation starts before the complete ordinary prefix",
    { phase: "foundation_applying", nextPayload: 1, nextFoundationParticipant: 1 },
  ],
  [
    "launchability starts before all forward Foundation refs",
    { phase: "launchability_publishing", nextPayload: 1, nextCreatedPath: 1, nextLaunchabilityPath: 1 },
  ],
  [
    "manifest publication starts before the fixed launchability suffix",
    {
      phase: "manifest_publishing",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 6,
      manifestCursor: 1,
    },
  ],
  [
    "compensation crosses manifest publication",
    {
      phase: "compensating",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 2,
      compensationNext: 0,
    },
  ],
  ["a first-over payload cursor is accepted", { phase: "payload_staging", nextPayload: 2 }],
  [
    "a first-over forward Foundation cursor counts compensation refs",
    { phase: "foundation_applying", nextPayload: 1, nextCreatedPath: 1, nextFoundationParticipant: 2 },
  ],
  [
    "a first-over launchability cursor is accepted",
    {
      phase: "launchability_publishing",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 8,
    },
  ],
  [
    "a terminal outcome appears before a terminal phase",
    { phase: "verifying", terminalOutcome: "finalized" },
  ],
  ["a compaction cursor appears outside compacting", { compactionNext: 0 }],
  [
    "compensation starts beyond the greatest reached reversible step",
    {
      phase: "compensating",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: 2,
    },
  ],
  [
    "payload cleanup is attached to an ordinary-create compensation step",
    {
      phase: "compensating",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      compensationNext: 1,
      payloadCleanupPart: "evidence",
    },
  ],
  [
    "compensation resumes after the manifest point of no return",
    {
      phase: "compensating",
      direction: "compensating",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 2,
      compensationNext: 10,
    },
  ],
  [
    "compaction advances one beyond its plan-derived exact cleanup table",
    {
      phase: "compacting",
      nextPayload: 1,
      nextCreatedPath: 1,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      compactionNext: 20,
    },
  ],
];

describe("bootstrap journal phase-owned cursor table", () => {
  it.each(legalForwardJournalRows)("admits %s", (_name, overrides) => {
    expect(() => validateBootstrapJournal(admittedJournalPlan(), journal(overrides))).not.toThrow();
  });

  it.each(illegalCursorRows)("refuses when %s", (_name, overrides) => {
    expect(() => validateBootstrapJournal(admittedJournalPlan(), journal(overrides))).toThrow(
      BootstrapStateError,
    );
  });
});

function clearInventory(): BootstrapInventoryV1 {
  return {
    schemaVersion: 1,
    inventoryId: "guarded-inventory-1",
    entryCount: 0,
    envelopes: [],
    unknownEntries: [],
  };
}

function closureContext(): BootstrapClosureAdmissionContextV1 {
  return {
    admitGuardedInventory: (inventory) => inventory.inventoryId,
    planAdmission: { inventoryId: "unused-by-clear-inventory" } as never,
    admitPayloadEvidence: () => {
      throw new Error("no payload evidence in a clear inventory");
    },
    admitCreatedPathEvidence: () => {
      throw new Error("no creation evidence in a clear inventory");
    },
    admitFoundationState: () => {
      throw new Error("no Foundation state in a clear inventory");
    },
    admitManifestState: () => {
      throw new Error("no manifest state in a clear inventory");
    },
    admitTerminalState: () => {
      throw new Error("no terminal state in a clear inventory");
    },
    admitTemporaryPrefix: () => {
      throw new Error("no temp in a clear inventory");
    },
  };
}

function planTemporary(overrides: Record<string, unknown> = {}) {
  return {
    path: `/product/state/.fresh-v2-init.${freshId}.123e4567-e89b-42d3-a456-426614174099.plan.json.tmp`,
    prefixEvidenceId: "plan-prefix-evidence-1",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    bytes: 128,
    dev: "1",
    ino: "20",
    ...overrides,
  };
}

function journalTemporary(overrides: Record<string, unknown> = {}) {
  return {
    path: `/product/state/.fresh-v2-init.${freshId}.123e4567-e89b-42d3-a456-426614174098.journal.json.tmp`,
    prefixEvidenceId: "journal-prefix-evidence-1",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    bytes: 128,
    dev: "1",
    ino: "21",
    ...overrides,
  };
}

function planTempInventory(temporary = planTemporary()): BootstrapInventoryV1 {
  return {
    schemaVersion: 1,
    inventoryId: "guarded-plan-temp-inventory",
    entryCount: 1,
    envelopes: [
      {
        operation: "fresh_v2_init",
        id: freshId,
        plan: null,
        journal: null,
        planTemps: [temporary as never],
        journalTemps: [],
        payloadEvidence: [],
        createdPathEvidence: [],
        foundationStates: [],
        manifestState: null,
        terminalState: null,
        stagingEntries: [],
        unknownEntries: [],
      },
    ],
    unknownEntries: [],
  };
}

function fullClosureContext(): BootstrapClosureAdmissionContextV1 {
  const fixture = fullPlanFixture();
  return {
    admitGuardedInventory: (inventory) => inventory.inventoryId,
    planAdmission: fixture.context,
    admitPayloadEvidence: (value) => structuredClone(value) as never,
    admitCreatedPathEvidence: (value) => structuredClone(value) as never,
    admitFoundationState: (_value, participant) => participant.id,
    admitManifestState: (_value, manifest) => manifest.participantId,
    admitTerminalState: (value) => value === "terminal-postimage" ? "postimage" : "preimage",
    admitTemporaryPrefix: (value) => (value as never as { prefixEvidenceId: string }).prefixEvidenceId,
  };
}

function fullPlanJournal(
  overrides: Partial<FreshV2InitJournalV1> = {},
): FreshV2InitJournalV1 {
  return {
    schemaVersion: 1,
    id: freshId,
    planHash: "c3eb0826ecc678a1715d634628d8c453967333d8a6b448f227dcb90306cece17" as LowerHexSha256,
    phase: "planned",
    direction: "forward",
    nextPayload: 0,
    payloadWriteState: { state: "idle" },
    nextCreatedPath: 0,
    nextFoundationParticipant: 0,
    nextLaunchabilityPath: 0,
    manifestCursor: 0,
    compensationNext: null,
    payloadCleanupPart: null,
    terminalOutcome: null,
    compactionNext: null,
    createdAt: "2026-08-29T12:00:00.000Z" as never,
    updatedAt: "2026-08-29T12:00:00.000Z" as never,
    ...overrides,
  };
}

function plannedRecoveryInventory(): BootstrapInventoryV1 {
  const fixture = fullPlanFixture();
  return {
    schemaVersion: 1,
    inventoryId: "guarded-planned-recovery",
    entryCount: 2,
    envelopes: [
      {
        operation: "fresh_v2_init",
        id: freshId,
        plan: fixture.plan,
        journal: fullPlanJournal(),
        planTemps: [],
        journalTemps: [],
        payloadEvidence: [],
        createdPathEvidence: [],
        foundationStates: fixture.plan.foundationParticipants.map((participant) => ({
          observedParticipantId: participant.id,
          state: "absent",
        })),
        manifestState: { observedParticipantId: fixture.plan.manifest.participantId, state: "preimage" },
        terminalState: null,
        stagingEntries: [],
        unknownEntries: [],
      },
    ],
    unknownEntries: [],
  };
}

const fullSourceIdentityHashes = [
  "13e23bf4614d389742666ec6ccb663f1c34a42d3254286e080a5c84fdbd2cc0a",
  "114ec9fc9a4bc675f943fe3535ce73f1fbbf5cf4d639cdd43daa71fd8e04286a",
  "c49b8099913bae81d3d08b65e18809de9c5a935e4881c54866955139a9bb35c2",
  "1984f60e07135df8cfbf4ceec34da80473cce0a7314f5a4a27c8533f64b9f084",
  "2180dc076301664f018df4aa75f44b64c62202954852741cd9321714d17c26d9",
  "e610cdbb85e8121b186bee38b89a61e65387df7692aad9177ec45b6dd4aef0bf",
  "e16c7411ffd8d02ccf410a54fedcde40fa46185099af895667d3db0f37d54832",
  "ddccb359d9b963399eed2f137b6eb26d6bf4b78f84b0d0b6827ae069520a31ca",
] as const;

function fullPayloadEvidence(count: number): unknown[] {
  const plan = fullPlanFixture().plan;
  return plan.payloads.slice(0, count).map((row, ordinal) => ({
    schemaVersion: 1,
    bootstrapId: freshId,
    ordinal,
    stagedPathHash: createHash("sha256").update(row.ref.path).digest("hex"),
    sourceIdentityHash: fullSourceIdentityHashes[ordinal],
    bytes: row.ref.bytes,
    sha256: row.ref.hash,
    mode: row.ref.mode,
    dev: "1",
    ino: String(100 + ordinal),
  }));
}

function fullCreationEvidence(ordinary: number, launchability: number): unknown[] {
  const plan = fullPlanFixture().plan;
  const evidence = (
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ) => ({
    schemaVersion: 1,
    bootstrapId: freshId,
    scope,
    ordinal,
    pathHash: createHash("sha256").update(planned.path).digest("hex"),
    kind: planned.kind,
    dev: "1",
    ino: String(scope === "ordinary" ? 200 + ordinal : 400 + ordinal),
    postimageHash:
      planned.kind === "file"
        ? planned.payload.hash
        : planned.kind === "global_lock"
          ? emptyHash
          : null,
  });
  return [
    ...plan.createdPaths.slice(0, ordinary).map((planned, ordinal) =>
      evidence(planned, "ordinary", ordinal),
    ),
    ...plan.launchabilityPaths.slice(0, launchability).map((planned, ordinal) =>
      evidence(planned, "launchability", ordinal),
    ),
  ];
}

function recoveryInventoryFor(
  journalValue: FreshV2InitJournalV1,
  evidenceCounts: { readonly payload: number; readonly ordinary: number; readonly launchability: number },
): BootstrapInventoryV1 {
  const fixture = fullPlanFixture();
  const stagingEntries = [
    ...fixture.plan.createdPaths.slice(0, evidenceCounts.ordinary),
    ...fixture.plan.launchabilityPaths.slice(0, evidenceCounts.launchability),
  ]
    .map((planned) => planned.path)
    .filter((path) => path === "/product/staging" || path.startsWith("/product/staging/"));
  const payloadEvidence = fullPayloadEvidence(evidenceCounts.payload);
  const createdPathEvidence = fullCreationEvidence(
    evidenceCounts.ordinary,
    evidenceCounts.launchability,
  );
  return {
    schemaVersion: 1,
    inventoryId: `guarded-${journalValue.phase}-recovery`,
    entryCount: 2 + payloadEvidence.length + createdPathEvidence.length + stagingEntries.length,
    envelopes: [
      {
        operation: "fresh_v2_init",
        id: freshId,
        plan: fixture.plan,
        journal: journalValue,
        planTemps: [],
        journalTemps: [],
        payloadEvidence,
        createdPathEvidence,
        foundationStates: fixture.plan.foundationParticipants.map((participant) => ({
          observedParticipantId: participant.id,
          state: "context-bound",
        })),
        manifestState: { observedParticipantId: fixture.plan.manifest.participantId, state: "context-bound" },
        terminalState:
          journalValue.terminalOutcome === "finalized"
            ? "terminal-postimage"
            : journalValue.terminalOutcome === "rolled_back"
              ? "terminal-preimage"
              : null,
        stagingEntries,
        unknownEntries: [],
      },
    ],
    unknownEntries: [],
  };
}

const bootstrapCursorMutations: readonly {
  readonly name: string;
  readonly inventory: BootstrapInventoryV1;
  readonly context: BootstrapClosureAdmissionContextV1;
}[] = [
  {
    name: "an inventory callback returns a different opaque evidence ID",
    inventory: clearInventory(),
    context: { ...closureContext(), admitGuardedInventory: () => "different-inventory" },
  },
  {
    name: "the bounded walk reports its first-over entry count",
    inventory: { ...clearInventory(), entryCount: 1_000_001 },
    context: closureContext(),
  },
  {
    name: "an unknown guarded child is treated as clean residue",
    inventory: { ...clearInventory(), entryCount: 1, unknownEntries: ["/product/state/unknown" as CanonicalAbsolutePathV1] },
    context: closureContext(),
  },
  {
    name: "two bootstrap IDs survive the one-ID grammar",
    inventory: {
      ...clearInventory(),
      envelopes: [
        { operation: "fresh_v2_init", id: freshId, plan: null, journal: null, planTemps: [], journalTemps: [], payloadEvidence: [], createdPathEvidence: [], foundationStates: [], manifestState: null, terminalState: null, stagingEntries: [], unknownEntries: [] },
        { operation: "fresh_v2_init", id: "fi_123e4567-e89b-42d3-a456-426614174002" as FreshV2InitIdV1, plan: null, journal: null, planTemps: [], journalTemps: [], payloadEvidence: [], createdPathEvidence: [], foundationStates: [], manifestState: null, terminalState: null, stagingEntries: [], unknownEntries: [] },
      ],
    },
    context: closureContext(),
  },
  {
    name: "a journal survives without its immutable plan",
    inventory: {
      ...clearInventory(),
      envelopes: [
        {
          operation: "fresh_v2_init",
          id: freshId,
          plan: null,
          journal: journal(),
          planTemps: [],
          journalTemps: [],
          payloadEvidence: [],
          createdPathEvidence: [],
          foundationStates: [],
          manifestState: null,
          terminalState: null,
          stagingEntries: [],
          unknownEntries: [],
        },
      ],
    },
    context: closureContext(),
  },
];

describe("bootstrap guarded closure", () => {
  it("admits the empty bounded guarded inventory as clear", () => {
    expect(inspectBootstrapClosure(clearInventory(), closureContext())).toEqual({ state: "clear" });
  });

  it("admits only the exact context-bound plan prefix temp as guarded-cleanable residue", () => {
    expect(inspectBootstrapClosure(planTempInventory(), fullClosureContext())).toEqual({
      state: "guarded_cleanable_plan_temp",
      operation: "fresh_v2_init",
      id: freshId,
      temporary: planTemporary(),
    });
  });

  it.each([
    {
      name: "a caller-selected plan-temp path bypasses the derived envelope prefix",
      temporary: planTemporary({ path: "/product/state/.attacker.plan.json.tmp" }),
    },
    {
      name: "a 0700 temp bypasses the owner-only 0600 file grammar",
      temporary: planTemporary({ mode: 0o700 }),
    },
    {
      name: "a foreign temp owner bypasses the bootstrap identity",
      temporary: planTemporary({ ownerUid: 502 }),
    },
    {
      name: "a hard-linked temp bypasses the single-link identity",
      temporary: planTemporary({ nlink: 2 }),
    },
    {
      name: "a first-over plan prefix bypasses the independent 256-MiB bound",
      temporary: planTemporary({ bytes: 268_435_457 }),
    },
    {
      name: "an unknown temp field widens the guarded inventory schema",
      temporary: planTemporary({ cleanable: true }),
    },
  ])("refuses when $name", ({ temporary }) => {
    expect(() => inspectBootstrapClosure(planTempInventory(temporary), fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it("refuses when the prefix callback returns a different opaque evidence ID", () => {
    expect(() => inspectBootstrapClosure(planTempInventory(), {
      ...fullClosureContext(),
      admitTemporaryPrefix: () => "different-prefix-evidence",
    })).toThrow(BootstrapStateError);
  });

  it("admits a plan with no journal or mutation evidence as the guarded-cleanable pre-intent orphan", () => {
    const fixture = fullPlanFixture();
    const inventory = plannedRecoveryInventory();
    const envelope = inventory.envelopes[0] as never as {
      journal: unknown;
      foundationStates: unknown[];
      manifestState: unknown;
    };
    envelope.journal = null;
    envelope.foundationStates = [];
    envelope.manifestState = null;
    (inventory as never as { entryCount: number }).entryCount = 1;
    expect(inspectBootstrapClosure(inventory, fullClosureContext())).toEqual({
      state: "guarded_cleanable_plan_orphan",
      plan: fixture.plan,
    });
  });

  it.each([
    ["postimage", "terminal-postimage", "finalized"],
    ["preimage", "terminal-preimage", "rolled_back"],
  ] as const)(
    "admits the %s terminal projection only as plan-last compaction",
    (_projection, terminalState, terminalOutcome) => {
      const fixture = fullPlanFixture();
      const inventory = plannedRecoveryInventory();
      const envelope = inventory.envelopes[0] as never as {
        journal: unknown;
        foundationStates: unknown[];
        manifestState: unknown;
        terminalState: unknown;
      };
      envelope.journal = null;
      envelope.foundationStates = [];
      envelope.manifestState = null;
      envelope.terminalState = terminalState;
      (inventory as never as { entryCount: number }).entryCount = 2;
      expect(inspectBootstrapClosure(inventory, fullClosureContext())).toEqual({
        state: "plan_last_compaction",
        plan: fixture.plan,
        terminalOutcome,
      });
    },
  );

  it("admits a plan plus exact journal-prefix temp and no final journal as a two-step guarded cleanup", () => {
    const inventory = plannedRecoveryInventory();
    const envelope = inventory.envelopes[0] as never as {
      journal: unknown;
      journalTemps: unknown[];
      foundationStates: unknown[];
      manifestState: unknown;
    };
    envelope.journal = null;
    envelope.journalTemps = [journalTemporary()];
    envelope.foundationStates = [];
    envelope.manifestState = null;
    (inventory as never as { entryCount: number }).entryCount = 2;
    expect(inspectBootstrapClosure(inventory, fullClosureContext())).toMatchObject({
      state: "guarded_cleanable_journal_temp",
      finalJournal: "absent",
      temporary: journalTemporary(),
    });
  });

  it("admits an exact post-intent journal rewrite temp only beside its valid final journal", () => {
    const inventory = plannedRecoveryInventory();
    (inventory.envelopes[0] as never as { journalTemps: unknown[] }).journalTemps = [
      journalTemporary(),
    ];
    (inventory as never as { entryCount: number }).entryCount = 3;
    expect(inspectBootstrapClosure(inventory, fullClosureContext())).toMatchObject({
      state: "guarded_cleanable_journal_temp",
      finalJournal: "present",
      temporary: journalTemporary(),
      journal: { phase: "planned" },
    });
  });

  it("refuses a first-over journal prefix independently of the larger plan-prefix bound", () => {
    const inventory = plannedRecoveryInventory();
    (inventory.envelopes[0] as never as { journalTemps: unknown[] }).journalTemps = [
      journalTemporary({ bytes: 1_048_577 }),
    ];
    expect(() => inspectBootstrapClosure(inventory, fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it("admits a complete guarded planned-phase inventory as recovery-required", () => {
    expect(inspectBootstrapClosure(plannedRecoveryInventory(), fullClosureContext())).toMatchObject({
      state: "recovery_required",
      plan: { operation: "fresh_v2_init", id: freshId },
      journal: { phase: "planned", nextPayload: 0 },
    });
  });

  it("refuses a terminal projection attached before the journal reaches a terminal outcome", () => {
    const inventory = plannedRecoveryInventory();
    (inventory.envelopes[0] as never as { terminalState: unknown }).terminalState =
      "terminal-postimage";
    expect(() => inspectBootstrapClosure(inventory, fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it("refuses finalized compaction with no context-bound postimage terminal projection", () => {
    const journalValue = fullPlanJournal({
      phase: "compacting",
      nextPayload: 8,
      nextCreatedPath: 10,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      compactionNext: 0,
    });
    const inventory = recoveryInventoryFor(journalValue, {
      payload: 8,
      ordinary: 10,
      launchability: 7,
    });
    (inventory.envelopes[0] as never as { terminalState: unknown }).terminalState = null;
    expect(() => inspectBootstrapClosure(inventory, fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it.each([
    {
      name: "payload evidence is the exact completed ordinal prefix",
      journal: fullPlanJournal({ phase: "payload_staging", nextPayload: 3 }),
      counts: { payload: 3, ordinary: 0, launchability: 0 },
    },
    {
      name: "ordinary creation evidence is the exact completed path prefix",
      journal: fullPlanJournal({ phase: "creating", nextPayload: 8, nextCreatedPath: 4 }),
      counts: { payload: 8, ordinary: 4, launchability: 0 },
    },
    {
      name: "Foundation execution retains every prior payload and ordinary identity",
      journal: fullPlanJournal({
        phase: "foundation_applying",
        nextPayload: 8,
        nextCreatedPath: 10,
        nextFoundationParticipant: 1,
      }),
      counts: { payload: 8, ordinary: 10, launchability: 0 },
    },
    {
      name: "launchability evidence appends its own scoped ordinal prefix",
      journal: fullPlanJournal({
        phase: "launchability_publishing",
        nextPayload: 8,
        nextCreatedPath: 10,
        nextFoundationParticipant: 1,
        nextLaunchabilityPath: 4,
      }),
      counts: { payload: 8, ordinary: 10, launchability: 4 },
    },
    {
      name: "manifest point-of-no-return state retains the complete reversible evidence set",
      journal: fullPlanJournal({
        phase: "manifest_publishing",
        nextPayload: 8,
        nextCreatedPath: 10,
        nextFoundationParticipant: 1,
        nextLaunchabilityPath: 7,
        manifestCursor: 2,
      }),
      counts: { payload: 8, ordinary: 10, launchability: 7 },
    },
    {
      name: "compensation retains only evidence at or below its reverse cursor",
      journal: fullPlanJournal({
        phase: "compensating",
        direction: "compensating",
        nextPayload: 8,
        nextCreatedPath: 10,
        compensationNext: 11,
      }),
      counts: { payload: 8, ordinary: 4, launchability: 0 },
    },
    {
      name: "rolled-back closure has removed every payload and creation authority",
      journal: fullPlanJournal({
        phase: "rolled_back",
        direction: "compensating",
        nextPayload: 8,
        nextCreatedPath: 10,
        compensationNext: -1,
        terminalOutcome: "rolled_back",
      }),
      counts: { payload: 0, ordinary: 0, launchability: 0 },
    },
  ])("admits $name", ({ journal: journalValue, counts }) => {
    expect(
      inspectBootstrapClosure(
        recoveryInventoryFor(journalValue, counts),
        fullClosureContext(),
      ),
    ).toMatchObject({ state: "recovery_required", journal: journalValue });
  });

  it.each([
    {
      name: "finalized compaction begins with the complete terminal evidence partition",
      journal: fullPlanJournal({
        phase: "compacting",
        nextPayload: 8,
        nextCreatedPath: 10,
        nextFoundationParticipant: 1,
        nextLaunchabilityPath: 7,
        manifestCursor: 3,
        terminalOutcome: "finalized",
        compactionNext: 0,
      }),
      counts: { payload: 8, ordinary: 10, launchability: 7 },
    },
    {
      name: "rolled-back compaction begins after reverse cleanup removed payload and creation evidence",
      journal: fullPlanJournal({
        phase: "compacting",
        direction: "compensating",
        nextPayload: 8,
        nextCreatedPath: 10,
        compensationNext: -1,
        terminalOutcome: "rolled_back",
        compactionNext: 0,
      }),
      counts: { payload: 0, ordinary: 0, launchability: 0 },
    },
  ])("admits $name", ({ journal: journalValue, counts }) => {
    expect(
      inspectBootstrapClosure(
        recoveryInventoryFor(journalValue, counts),
        fullClosureContext(),
      ),
    ).toMatchObject({
      state: "recovery_required",
      journal: { phase: "compacting", compactionNext: 0 },
    });
  });

  it("refuses finalized compaction that deletes one payload authority before cursor zero advances", () => {
    const journalValue = fullPlanJournal({
      phase: "compacting",
      nextPayload: 8,
      nextCreatedPath: 10,
      nextFoundationParticipant: 1,
      nextLaunchabilityPath: 7,
      manifestCursor: 3,
      terminalOutcome: "finalized",
      compactionNext: 0,
    });
    const inventory = recoveryInventoryFor(journalValue, {
      payload: 8,
      ordinary: 10,
      launchability: 7,
    });
    (inventory.envelopes[0] as never as { payloadEvidence: unknown[] }).payloadEvidence.pop();
    expect(() => inspectBootstrapClosure(inventory, fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it.each([
    {
      name: "a missing completed payload evidence row creates a non-prefix hole",
      mutate(inventory: BootstrapInventoryV1) {
        (inventory.envelopes[0] as never as { payloadEvidence: unknown[] }).payloadEvidence.pop();
      },
    },
    {
      name: "an extra future creation evidence row advances authority before its cursor",
      mutate(inventory: BootstrapInventoryV1) {
        (inventory.envelopes[0] as never as { createdPathEvidence: unknown[] }).createdPathEvidence.push(
          fullCreationEvidence(2, 0)[1],
        );
      },
    },
    {
      name: "a substituted payload inode fails the context-bound evidence callback",
      mutate(inventory: BootstrapInventoryV1) {
        const rows = (inventory.envelopes[0] as never as { payloadEvidence: Array<{ ino: string }> }).payloadEvidence;
        required(rows[0]).ino = "999";
      },
      context: {
        ...fullClosureContext(),
        admitPayloadEvidence: (value: unknown) => ({ ...(value as object), ino: "100" }) as never,
      },
    },
    {
      name: "a staging inventory omits one reached product-staging path",
      mutate(inventory: BootstrapInventoryV1) {
        (inventory.envelopes[0] as never as { stagingEntries: string[] }).stagingEntries.pop();
      },
    },
  ])("refuses when $name", (testCase) => {
    const journalValue = fullPlanJournal({ phase: "creating", nextPayload: 8, nextCreatedPath: 4 });
    const inventory = recoveryInventoryFor(journalValue, {
      payload: 8,
      ordinary: 4,
      launchability: 0,
    });
    testCase.mutate(inventory);
    expect(() => inspectBootstrapClosure(inventory, testCase.context ?? fullClosureContext())).toThrow(
      BootstrapStateError,
    );
  });

  it.each([
    {
      name: "a missing future Foundation absence observation hides one participant branch",
      mutate(inventory: BootstrapInventoryV1) {
        (inventory.envelopes[0] as never as { foundationStates: unknown[] }).foundationStates.pop();
      },
      context: fullClosureContext(),
    },
    {
      name: "a Foundation callback substitutes a different opaque participant ID",
      mutate() {},
      context: { ...fullClosureContext(), admitFoundationState: () => "tx_attacker" },
    },
    {
      name: "a manifest callback substitutes a different opaque participant ID",
      mutate() {},
      context: { ...fullClosureContext(), admitManifestState: () => "mf_attacker" },
    },
    {
      name: "an unbound staging child survives at the planned cursor as a third state",
      mutate(inventory: BootstrapInventoryV1) {
        (inventory.envelopes[0] as never as { stagingEntries: string[] }).stagingEntries.push(
          "/product/staging/fresh-v2-init/unbound",
        );
      },
      context: fullClosureContext(),
    },
  ])("refuses when $name", (testCase) => {
    const inventory = plannedRecoveryInventory();
    testCase.mutate(inventory);
    expect(() => inspectBootstrapClosure(inventory, testCase.context)).toThrow(BootstrapStateError);
  });

  it.each(bootstrapCursorMutations)("refuses $name", ({ inventory, context }) => {
    expect(() => inspectBootstrapClosure(inventory, context)).toThrow(BootstrapStateError);
  });
});

// Compile-time assertion: the journal codec consumes either already-admitted bootstrap plan arm.
const _journalPlanDoor: BootstrapExecutionPlanV1 = admittedJournalPlan();
void _journalPlanDoor;
