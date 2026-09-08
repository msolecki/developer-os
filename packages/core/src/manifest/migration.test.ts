import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CanonicalAbsolutePathV1, CanonicalPathEvidenceV1 } from "../update/paths.js";
import type { LowerHexSha256, UInt64DecimalV1, UtcTimestampV1 } from "../update/scalars.js";
import {
  bootstrapExternalShapeHash,
  type BootstrapExternalShapeProjectionV1,
  type BootstrapPayloadSourceV1,
  type FoundationParticipantRefV2,
  type PersistedBootstrapLockIdentityV1,
  type PlannedCreatedPathV1,
} from "./bootstrap.js";
import type { ManifestMigrationIdV1 } from "./manifest-state.js";
import {
  ManifestMigrationNotFeasibleError,
  mapManifestV1ToV2,
  planManifestMigration,
  type ManifestMigrationPackagedReleaseV1,
  type ManifestMigrationReadRequestV1,
  type ManifestMigrationReadV1,
  type ManifestMigrationRequestV1,
} from "./migration.js";
import type {
  ArtifactOwner,
  ManagedArtifactV1,
  ManagedArtifactV2,
  ManifestAdmissionContextV1,
} from "./types.js";
import { ManifestV1NotMigratableError, validateMigratableManifestV1 } from "./v2.js";

const migrationId = "mm_123e4567-e89b-42d3-a456-426614174000" as ManifestMigrationIdV1;
const productHome = "/product" as CanonicalAbsolutePathV1;
const stateRoot = "/product/state" as CanonicalAbsolutePathV1;
const manifestPath = "/product/state/installation-manifest.json" as CanonicalAbsolutePathV1;
const backupRoot = "/product/backups" as CanonicalAbsolutePathV1;
const packageRoot = "/package" as CanonicalAbsolutePathV1;
const uid = 501;
const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as LowerHexSha256;
const plannedAt = "2026-09-08T00:00:00.000Z" as UtcTimestampV1;
const encoder = new TextEncoder();

const configBytes = encoder.encode("[core]\nbrainPath = \"/brain\"\n");
const schemaBytes = encoder.encode("{\"schema\":\"plan\"}\n");
const configBackupBytes = encoder.encode("[core]\nbrainPath = \"/legacy\"\n");

function hash(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture element is required");
  return value;
}

const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (path: string) => path,
  containsCanonicalPath: (root: string, candidate: string) => candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

const manifestAdmission: ManifestAdmissionContextV1 = {
  evidence,
  sourceRoot: packageRoot,
  backupRoot,
  admitOwnerPath: (_owner: ArtifactOwner, path: CanonicalAbsolutePathV1) => path,
};

function legacyArtifacts(): ManagedArtifactV1[] {
  return [
    {
      owner: "core",
      path: "/product/config.toml",
      kind: "file",
      productVersion: "0.9.0",
      existedBefore: true,
      beforeHash: hash(configBackupBytes),
      backupRelativePath: "config.toml",
      installedHash: hash(configBytes),
      source: "templates/config.toml",
      mergeStrategy: "semantic-toml",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      owner: "core",
      path: "/product/schemas",
      kind: "directory",
      productVersion: "0.9.0",
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: emptyHash,
      source: "templates/schemas",
      mergeStrategy: "dedicated",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      owner: "core",
      path: "/product/schemas/plan.schema.json",
      kind: "file",
      productVersion: "0.9.0",
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: hash(schemaBytes),
      source: "templates/schemas/plan.schema.json",
      mergeStrategy: "dedicated",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
}

function legacyBytes(artifacts: readonly ManagedArtifactV1[]): Uint8Array {
  return encoder.encode(`${JSON.stringify({
    schemaVersion: 1,
    productVersion: "0.9.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    artifacts,
  })}\n`);
}

function externalProjection(): BootstrapExternalShapeProjectionV1 {
  return {
    entries: [
      { role: "product_home", pathHash: hash(productHome), kind: "directory", ownerUid: uid, mode: 0o700, nlink: 4, size: "128", dev: "1", ino: "2" },
      { role: "state_directory", pathHash: hash(stateRoot), kind: "directory", ownerUid: uid, mode: 0o700, nlink: 2, size: "96", dev: "1", ino: "3" },
      { role: "bootstrap_lock", pathHash: hash("/product/state/.lifecycle-bootstrap.lock"), kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, size: "0", dev: "1", ino: "4" },
    ],
  } as unknown as BootstrapExternalShapeProjectionV1;
}

const bootstrapIdentity = {
  path: "/product/state/.lifecycle-bootstrap.lock" as CanonicalAbsolutePathV1,
  ownerUid: uid,
  mode: 0o600,
  nlink: 1,
  size: 0,
  dev: "1" as UInt64DecimalV1,
  ino: "4" as UInt64DecimalV1,
} satisfies PersistedBootstrapLockIdentityV1;

function packagedRelease(): ManifestMigrationPackagedReleaseV1 {
  const files = [
    { relativePath: "metadata/release-key-delegation.json", content: encoder.encode("delegation\n") },
    { relativePath: "metadata/release-index.json", content: encoder.encode("release index\n") },
    { relativePath: "metadata/bundle-manifest.json", content: encoder.encode("bundle manifest\n") },
    { relativePath: "bundle/bin/developer-os", content: encoder.encode("#!/bin/sh\nexit 0\n") },
  ] as const;
  return {
    packageRoot,
    packageRootDev: "9" as UInt64DecimalV1,
    packageRootIno: "10" as UInt64DecimalV1,
    packageInventoryHash: hash("package inventory"),
    retainedMetadata: {
      delegation: "metadata/release-key-delegation.json",
      releaseIndex: "metadata/release-index.json",
      bundleManifest: "metadata/bundle-manifest.json",
    },
    bundleRoot: "bundle",
    identity: {
      version: "1.0.0",
      releaseSequence: "1",
      releaseIdentityHash: hash("release identity"),
      delegationSequence: "1",
      delegationHash: hash("delegation"),
      delegatedReleaseKeyId: hash("delegated key"),
      releaseIndexSequence: "1",
      releaseIndexHash: hash("release index"),
      bundleManifestHash: hash("bundle manifest"),
      platform: "darwin",
      architecture: "arm64",
      launcherProtocol: 1,
      updateProtocol: 1,
    },
    files: files.map((file, ordinal) => ({
      relativePath: file.relativePath,
      bytes: file.content.byteLength,
      sha256: hash(file.content),
      mode: 0o600 as const,
      dev: "9" as UInt64DecimalV1,
      ino: String(100 + ordinal) as UInt64DecimalV1,
    })),
  };
}

interface Scenario {
  readonly request: ManifestMigrationRequestV1;
  readonly reads: () => number;
}

function scenario(
  override: (draft: {
    artifacts: ManagedArtifactV1[];
    manifestBytes: Uint8Array | null;
    foundationState: "complete" | "incomplete";
    productDirectories: CanonicalAbsolutePathV1[];
    productReservations: CanonicalAbsolutePathV1[];
    availableBytes: UInt64DecimalV1;
    managed: Map<string, ManifestMigrationReadV1>;
    backups: Map<string, ManifestMigrationReadV1>;
  }) => void = () => undefined,
): Scenario {
  const managed = new Map<string, ManifestMigrationReadV1>([
    ["/product/config.toml", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: configBytes.byteLength, sha256: hash(configBytes), dev: "1" as UInt64DecimalV1, ino: "20" as UInt64DecimalV1 }],
    ["/product/schemas", { kind: "directory", ownerUid: uid, dev: "1" as UInt64DecimalV1, ino: "21" as UInt64DecimalV1 }],
    ["/product/schemas/plan.schema.json", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: schemaBytes.byteLength, sha256: hash(schemaBytes), dev: "1" as UInt64DecimalV1, ino: "22" as UInt64DecimalV1 }],
  ]);
  const backups = new Map<string, ManifestMigrationReadV1>([
    ["/product/backups/config.toml", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: configBackupBytes.byteLength, sha256: hash(configBackupBytes), dev: "1" as UInt64DecimalV1, ino: "23" as UInt64DecimalV1 }],
  ]);
  const draft = {
    artifacts: legacyArtifacts(),
    manifestBytes: null as Uint8Array | null,
    foundationState: "complete" as "complete" | "incomplete",
    productDirectories: ["/product/logs", "/product/state/lifecycle-journals", "/product/state/rollback"] as CanonicalAbsolutePathV1[],
    productReservations: ["/product/state/update-rollback.json", "/product/state/update-executor.json"] as CanonicalAbsolutePathV1[],
    availableBytes: "1073741824" as UInt64DecimalV1,
    managed,
    backups,
  };
  override(draft);
  let reads = 0;
  const request: ManifestMigrationRequestV1 = {
    id: migrationId,
    admission: {
      evidence,
      productHome,
      stateRoot,
      productStagingRoot: "/product/staging" as CanonicalAbsolutePathV1,
      admitPayloadSource: (source: BootstrapPayloadSourceV1) => structuredClone(source),
      admitPlannedCreatedPath: (value: PlannedCreatedPathV1) => structuredClone(value),
      admitPreexistingParent: (value) => structuredClone(value),
      admitFoundationParticipant: (value: FoundationParticipantRefV2) => structuredClone(value),
      admitManifestParticipant: (value) => structuredClone(value),
      admitPlanDerivedValue: (_role, value) => structuredClone(value),
    },
    manifestAdmission,
    bootstrapIdentity,
    externalShape: externalProjection(),
    admittedPreexistingPaths: [],
    preexistingParents: [
      { path: productHome, dev: "1" as UInt64DecimalV1, ino: "2" as UInt64DecimalV1 },
      { path: stateRoot, dev: "1" as UInt64DecimalV1, ino: "3" as UInt64DecimalV1 },
    ],
    journalSlots: [
      { dev: "1" as UInt64DecimalV1, ino: "11" as UInt64DecimalV1 },
      { dev: "1" as UInt64DecimalV1, ino: "12" as UInt64DecimalV1 },
    ],
    manifestPath,
    manifestBytes: draft.manifestBytes ?? legacyBytes(draft.artifacts),
    manifestIdentity: { dev: "1" as UInt64DecimalV1, ino: "5" as UInt64DecimalV1 },
    foundationState: draft.foundationState,
    productDirectories: draft.productDirectories,
    productReservations: draft.productReservations,
    packaged: packagedRelease(),
    availableBytes: draft.availableBytes,
    nonce: hash("install nonce"),
    plannedAt,
    read: (input: ManifestMigrationReadRequestV1): Promise<ManifestMigrationReadV1> => {
      reads += 1;
      const table = input.authority === "managed" ? draft.managed : draft.backups;
      return Promise.resolve(table.get(input.path) ?? { kind: "unavailable" });
    },
  };
  return { request, reads: () => reads };
}

function migratable(artifacts: readonly ManagedArtifactV1[] = legacyArtifacts()) {
  return validateMigratableManifestV1(legacyBytes(artifacts), manifestAdmission);
}

function addition(
  path: string,
  verification: ManagedArtifactV2["verification"],
  kind: "file" | "directory" = "file",
): ManagedArtifactV2 {
  return {
    owner: "core",
    path: path as CanonicalAbsolutePathV1,
    productVersion: "1.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: "generated/directory",
    mergeStrategy: "dedicated",
    verifiedAt: plannedAt,
    kind,
    verification,
  } as ManagedArtifactV2;
}

const legacyPaths = new Set(legacyArtifacts().map((artifact) => artifact.path));

function projectHistoricalFields(manifest: {
  readonly installedAt: string;
  readonly artifacts: readonly {
    readonly owner: string;
    readonly path: string;
    readonly productVersion: string;
    readonly existedBefore: boolean;
    readonly beforeHash: string | null;
    readonly backupRelativePath: string | null;
    readonly source: string;
    readonly mergeStrategy: string;
    readonly verifiedAt: string;
  }[];
}): unknown {
  return {
    installedAt: manifest.installedAt,
    artifacts: manifest.artifacts
      .filter((artifact) => legacyPaths.has(artifact.path))
      .map((artifact) => ({
        owner: artifact.owner,
        path: artifact.path,
        productVersion: artifact.productVersion,
        existedBefore: artifact.existedBefore,
        beforeHash: artifact.beforeHash,
        backupRelativePath: artifact.backupRelativePath,
        source: artifact.source,
        mergeStrategy: artifact.mergeStrategy,
        verifiedAt: artifact.verifiedAt,
      })),
  };
}

describe("exact V1 to V2 artifact mapping", () => {
  const additions = [
    addition("/product/state/lifecycle-install-nonce", { mode: "content", installedHash: hash("nonce") }),
    addition("/product/state/lifecycle-id-allocator.json", { mode: "schema", schemaId: "lifecycle-id-allocator-v1", installedHash: hash("allocator") }),
  ];

  it("maps config alone to schema and copies every historical field", () => {
    const v1Fixture = migratable();
    const mapped = mapManifestV1ToV2(v1Fixture, additions);

    expect(mapped.artifacts.find((a) => a.path.endsWith("config.toml"))?.verification.mode).toBe("schema");
    expect(mapped.artifacts.filter((a) => a.verification.mode === "schema").map((a) => a.path)).toStrictEqual([
      "/product/config.toml",
      "/product/state/lifecycle-id-allocator.json",
    ]);
    expect(projectHistoricalFields(mapped)).toEqual(projectHistoricalFields(v1Fixture));
  });

  it("carries the schema id, product version, and legacy installed hash of every mapped row", () => {
    const mapped = mapManifestV1ToV2(migratable(), additions);
    expect(mapped.schemaVersion).toBe(2);
    expect(mapped.productVersion).toBe("1.0.0");
    expect(mapped.artifacts.length).toBeGreaterThan(0);
    expect(mapped.artifacts.map((artifact) => [artifact.path, artifact.kind, artifact.verification])).toStrictEqual([
      ["/product/config.toml", "file", { mode: "schema", schemaId: "developer-os-config-v1", installedHash: hash(configBytes) }],
      ["/product/schemas", "directory", { mode: "content" }],
      ["/product/schemas/plan.schema.json", "file", { mode: "content", installedHash: hash(schemaBytes) }],
      ["/product/state/lifecycle-id-allocator.json", "file", { mode: "schema", schemaId: "lifecycle-id-allocator-v1", installedHash: hash("allocator") }],
      ["/product/state/lifecycle-install-nonce", "file", { mode: "content", installedHash: hash("nonce") }],
    ]);
  });

  it.each([
    { name: "no addition at all", additions: [] as readonly ManagedArtifactV2[] },
    {
      name: "an addition that claims legacy restore evidence",
      additions: [{ ...additions[0], existedBefore: true, beforeHash: hash("before"), backupRelativePath: "nonce" } as ManagedArtifactV2],
    },
    {
      name: "additions that disagree about the product version",
      additions: [additions[0] as ManagedArtifactV2, { ...(additions[1] as ManagedArtifactV2), productVersion: "1.1.0" } as ManagedArtifactV2],
    },
    {
      name: "an addition that re-declares a mapped V1 path",
      additions: [addition("/product/config.toml", { mode: "content", installedHash: hash(configBytes) })],
    },
    {
      name: "an addition at the Spec 1 activation record",
      additions: [addition("/product/state/lifecycle-activation.json", { mode: "content", installedHash: hash("activation") })],
    },
  ])("refuses $name", (testCase) => {
    expect(() => mapManifestV1ToV2(migratable(), testCase.additions)).toThrow();
  });
});

describe("V1 migration admission refuses before any managed byte", () => {
  const nonMigratableFixtures = [
    {
      name: "a manifest whose bytes are not the legacy exact encoding",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.manifestBytes = encoder.encode(`${JSON.stringify({ schemaVersion: 1, productVersion: "0.9.0", installedAt: "2026-01-01T00:00:00.000Z", artifacts: draft.artifacts }, null, 1)}\n`);
      }),
    },
    {
      name: "a symlink artifact outside the migratable subset",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/link", kind: "symlink" });
      }),
    },
    {
      name: "a config-entry artifact outside the migratable subset",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/entry", kind: "config-entry" });
      }),
    },
    {
      name: "a directory that claims legacy restore evidence",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts[1] = { ...required(draft.artifacts[1]), existedBefore: true, beforeHash: hash("before"), backupRelativePath: "schemas" };
      }),
    },
    {
      name: "a created directory without the legacy empty-hash sentinel",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts[1] = { ...required(draft.artifacts[1]), installedHash: hash("not empty") };
      }),
    },
    {
      name: "an artifact source that escapes the vault-free relative grammar",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts[2] = { ...required(draft.artifacts[2]), source: "/absolute/source" };
      }),
    },
    {
      name: "a duplicate folded artifact path",
      error: ManifestV1NotMigratableError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/schemas/PLAN.SCHEMA.JSON" });
      }),
    },
    {
      name: "an incomplete Foundation transaction",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.foundationState = "incomplete";
      }),
    },
    {
      name: "a declared V1 claim on the V2-only allocator path",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/state/lifecycle-id-allocator.json" });
      }),
    },
    {
      name: "a declared V1 claim on the Spec 1 activation record",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/state/lifecycle-activation.json" });
      }),
    },
    {
      name: "a canonical V1 claim beneath the V2-only release root",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/releases/1.0.0/darwin-arm64/bin/developer-os" });
      }),
    },
    {
      name: "a V1 directory shared with a V2-only reserved directory",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[1]), path: "/product/state/lifecycle-journals" });
      }),
    },
    {
      name: "a V1 claim on the permanent global lifecycle lock",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.artifacts.push({ ...required(draft.artifacts[2]), path: "/product/state/.lifecycle.lock" });
      }),
    },
    {
      name: "insufficient aggregate product-home capacity",
      error: ManifestMigrationNotFeasibleError,
      arrange: () => scenario((draft) => {
        draft.availableBytes = "1024" as UInt64DecimalV1;
      }),
    },
  ] as const;

  it("enumerates a non-empty non-migratable set", () => {
    expect(nonMigratableFixtures.length).toBeGreaterThan(0);
  });

  it.each(nonMigratableFixtures)("refuses $name before managed bytes", async (fixture) => {
    const { request, reads } = fixture.arrange();
    await expect(planManifestMigration(request)).rejects.toThrow(fixture.error);
    expect(reads()).toBe(0);
  });
});

describe("V1 migration guarded authority reads", () => {
  const authorityFixtures = [
    {
      name: "managed bytes that drifted from the recorded installed hash",
      arrange: () => scenario((draft) => {
        draft.managed.set("/product/schemas/plan.schema.json", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: 3, sha256: hash("drifted"), dev: "1" as UInt64DecimalV1, ino: "22" as UInt64DecimalV1 });
      }),
    },
    {
      name: "a managed directory that became a regular file",
      arrange: () => scenario((draft) => {
        draft.managed.set("/product/schemas", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: 0, sha256: emptyHash, dev: "1" as UInt64DecimalV1, ino: "21" as UInt64DecimalV1 });
      }),
    },
    {
      name: "a managed artifact owned by another uid",
      arrange: () => scenario((draft) => {
        draft.managed.set("/product/config.toml", { kind: "regular_file", ownerUid: uid + 1, mode: 0o600, nlink: 1, bytes: configBytes.byteLength, sha256: hash(configBytes), dev: "1" as UInt64DecimalV1, ino: "20" as UInt64DecimalV1 });
      }),
    },
    {
      name: "a missing legacy backup for a restorable artifact",
      arrange: () => scenario((draft) => {
        draft.backups.clear();
      }),
    },
    {
      name: "a legacy backup whose bytes disagree with beforeHash",
      arrange: () => scenario((draft) => {
        draft.backups.set("/product/backups/config.toml", { kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, bytes: 4, sha256: hash("wrong"), dev: "1" as UInt64DecimalV1, ino: "23" as UInt64DecimalV1 });
      }),
    },
  ] as const;

  it("enumerates a non-empty authority-refusal set", () => {
    expect(authorityFixtures.length).toBeGreaterThan(0);
  });

  it.each(authorityFixtures)("refuses $name after the structural gate", async (fixture) => {
    const { request, reads } = fixture.arrange();
    await expect(planManifestMigration(request)).rejects.toThrow(ManifestMigrationNotFeasibleError);
    expect(reads()).toBeGreaterThan(0);
  });
});

describe("concrete migration plan derivation", () => {
  it("binds both manifest hashes, the migration shape domain, and the amended addition modes", async () => {
    const { request, reads } = scenario();
    const plan = await planManifestMigration(request);

    expect(plan.operation).toBe("v1_to_v2");
    expect(plan.id).toBe(migrationId);
    expect(plan.v1ManifestHash).toBe(hash(request.manifestBytes));
    expect(plan.paths).toStrictEqual({
      plan: `/product/state/manifest-migration.${migrationId}.plan.json`,
      stagingRoot: `/product/staging/manifest-migration/${migrationId}`,
    });
    expect(plan.admittedExternalShapeHash).toBe(
      bootstrapExternalShapeHash(request.externalShape, "v1_to_v2"),
    );
    expect(plan.admittedExternalShapeHash).not.toBe(
      bootstrapExternalShapeHash(request.externalShape, "fresh_v2_init"),
    );
    expect(reads()).toBe(4);

    const created = plan.createdPaths.map((row) => row.path);
    expect(required(plan.createdPaths[0]).kind).toBe("global_lock");
    expect(created).toContain("/product/state/lifecycle-install-nonce");
    expect(created).toContain("/product/state/lifecycle-id-allocator.json");
    expect(created).not.toContain("/product/state/lifecycle-activation.json");
    expect(plan.launchabilityPaths.length).toBeGreaterThanOrEqual(7);
    expect(plan.launchabilityPaths.map((row) => row.path)).toContain("/product/state/active-release.json");
    expect(plan.foundationParticipants.length).toBeGreaterThan(0);
    expect(plan.foundationParticipants.every((participant) => participant.slot === "v1_migration_artifacts")).toBe(true);
  });

  it("publishes a V2 manifest that keeps every V1 row and adds the nonce and allocator modes", async () => {
    const { request } = scenario();
    const plan = await planManifestMigration(request);
    const manifestSource = plan.payloads
      .map((row) => row.source)
      .find((source) => source.kind === "plan_derived" && source.role === "manifest_after");
    if (manifestSource?.kind !== "plan_derived") throw new Error("plan has no manifest payload");
    const published = manifestSource.value as unknown as {
      readonly artifacts: readonly ManagedArtifactV2[];
    };

    expect(plan.v2ManifestHash).toBe(required(plan.payloads.find((row) => row.source === manifestSource)).ref.hash);
    expect(published.artifacts.length).toBeGreaterThan(0);
    const byPath = new Map(published.artifacts.map((artifact) => [artifact.path, artifact] as const));
    expect(byPath.get("/product/config.toml" as CanonicalAbsolutePathV1)?.verification).toStrictEqual({
      mode: "schema",
      schemaId: "developer-os-config-v1",
      installedHash: hash(configBytes),
    });
    expect(byPath.get("/product/state/lifecycle-install-nonce" as CanonicalAbsolutePathV1)?.verification).toStrictEqual({
      mode: "content",
      installedHash: hash(`${request.nonce}\n`),
    });
    expect(byPath.get("/product/state/lifecycle-id-allocator.json" as CanonicalAbsolutePathV1)?.verification).toMatchObject({
      mode: "schema",
      schemaId: "lifecycle-id-allocator-v1",
    });
    expect(byPath.has("/product/state/lifecycle-activation.json" as CanonicalAbsolutePathV1)).toBe(false);
    expect(byPath.get("/product/state/update-rollback.json" as CanonicalAbsolutePathV1)?.verification).toStrictEqual({
      mode: "ephemeral",
    });
  });

  it("stages every managed regular file as a guarded V1 preimage under its own migration authority", async () => {
    const { request } = scenario();
    const plan = await planManifestMigration(request);
    const preimages = plan.payloads
      .map((row) => row.source)
      .filter((source) => source.kind === "guarded_migration_preimage");

    expect(preimages.length).toBeGreaterThan(0);
    expect(preimages.every((source) => source.authority.migrationId === migrationId)).toBe(true);
    expect(preimages.map((source) => source.path).toSorted()).toStrictEqual([
      "/product/config.toml",
      "/product/config.toml",
      "/product/schemas/plan.schema.json",
      "/product/schemas/plan.schema.json",
    ]);
  });
});
