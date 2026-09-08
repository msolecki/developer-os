import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ManifestMigrationNotFeasibleError } from "@developer-os/core";
import type {
  BootstrapExternalShapeProjectionV1,
  CanonicalAbsolutePathV1,
  LowerHexSha256,
  ManifestMigrationIdV1,
  PersistedBootstrapLockIdentityV1,
  RuntimePaths,
  UInt64DecimalV1,
} from "@developer-os/core";

import { admitRootVerifiedPackagedRelease, inspectPackagedRelease } from "../update/packaged-release.js";
import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import { migrationReservedPaths, planV1ToV2Migration } from "./migration.js";

const migrationId = "mm_123e4567-e89b-42d3-a456-426614174000" as ManifestMigrationIdV1;
const encoder = new TextEncoder();
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

function digest(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function runtimePaths(home: string, brain: string): RuntimePaths {
  return {
    home,
    configFile: join(home, "config.toml"),
    manifestFile: join(home, "state", "installation-manifest.json"),
    stateDir: join(home, "state"),
    stagingDir: join(home, "staging"),
    backupsDir: join(home, "backups"),
    logsDir: join(home, "logs"),
    brain,
  };
}

const configBytes = encoder.encode("[core]\nbrainPath = \"/brain\"\n");
const schemaBytes = encoder.encode("{\"schema\":\"plan\"}\n");
const backupBytes = encoder.encode("[core]\nbrainPath = \"/legacy\"\n");

function legacyManifest(paths: RuntimePaths, extra: readonly Record<string, unknown>[] = []): Uint8Array {
  return encoder.encode(`${JSON.stringify({
    schemaVersion: 1,
    productVersion: "0.9.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    artifacts: [
      {
        owner: "core",
        path: paths.configFile,
        kind: "file",
        productVersion: "0.9.0",
        existedBefore: true,
        beforeHash: digest(backupBytes),
        backupRelativePath: "config.toml",
        installedHash: digest(configBytes),
        source: "templates/config.toml",
        mergeStrategy: "semantic-toml",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        owner: "core",
        path: join(paths.home, "schemas"),
        kind: "directory",
        productVersion: "0.9.0",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: digest(new Uint8Array()),
        source: "templates/schemas",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        owner: "core",
        path: join(paths.home, "schemas", "plan.schema.json"),
        kind: "file",
        productVersion: "0.9.0",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: digest(schemaBytes),
        source: "templates/schemas/plan.schema.json",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      ...extra,
    ],
  })}\n`);
}

async function packagedRelease(root: string): Promise<AdmittedPackagedReleaseV1> {
  const packageRoot = join(root, "packaged-release");
  const retained = {
    delegation: "metadata/release-key-delegation.json",
    releaseIndex: "metadata/release-index.json",
    bundleManifest: "metadata/bundle-manifest.json",
  } as const;
  const delegationBytes = encoder.encode("synthetic delegation\n");
  const indexBytes = encoder.encode("synthetic release index\n");
  const bundleManifestBytes = encoder.encode("synthetic bundle manifest\n");
  const files = [
    { relativePath: retained.delegation, bytes: delegationBytes },
    { relativePath: retained.releaseIndex, bytes: indexBytes },
    { relativePath: retained.bundleManifest, bytes: bundleManifestBytes },
    { relativePath: "bundle/bin/developer-os", bytes: encoder.encode("#!/bin/sh\nexit 0\n") },
  ] as const;
  for (const file of files) {
    const path = join(packageRoot, file.relativePath);
    await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, file.bytes, { mode: 0o600 });
  }
  return inspectPackagedRelease(await admitRootVerifiedPackagedRelease({
    packageRoot: await nodeFs.realpath(packageRoot),
    retainedMetadata: retained,
    bundleRoot: "bundle",
    identity: {
      version: "1.0.0",
      releaseSequence: "1",
      releaseIdentityHash: digest("synthetic release identity"),
      delegationSequence: "1",
      delegationHash: digest(delegationBytes),
      delegatedReleaseKeyId: digest("synthetic delegated release key"),
      releaseIndexSequence: "1",
      releaseIndexHash: digest(indexBytes),
      bundleManifestHash: digest(bundleManifestBytes),
      platform: "darwin",
      architecture: "arm64",
      launcherProtocol: 1,
      updateProtocol: 1,
    },
  }));
}

interface Installation {
  readonly paths: RuntimePaths;
  readonly packaged: AdmittedPackagedReleaseV1;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly externalShape: BootstrapExternalShapeProjectionV1;
  readonly journalSlots: readonly [
    { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 },
    { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 },
  ];
}

async function identity(path: string): Promise<{ readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }> {
  const stats = await nodeFs.lstat(path, { bigint: true });
  return { dev: String(stats.dev) as UInt64DecimalV1, ino: String(stats.ino) as UInt64DecimalV1 };
}

async function createInstallation(
  label: string,
  manifest: (paths: RuntimePaths) => Uint8Array = legacyManifest,
): Promise<Installation> {
  const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), `developer-os-migration-${label}-`)));
  roots.push(root);
  const paths = runtimePaths(join(root, "product"), join(root, "brain"));
  await nodeFs.mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(paths.backupsDir, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(join(paths.home, "schemas"), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(paths.configFile, configBytes, { mode: 0o600 });
  await nodeFs.writeFile(join(paths.home, "schemas", "plan.schema.json"), schemaBytes, { mode: 0o600 });
  await nodeFs.writeFile(join(paths.backupsDir, "config.toml"), backupBytes, { mode: 0o600 });
  await nodeFs.writeFile(paths.manifestFile, manifest(paths), { mode: 0o600 });

  const lockPath = join(paths.stateDir, ".lifecycle-bootstrap.lock");
  await nodeFs.writeFile(lockPath, new Uint8Array(), { mode: 0o600 });
  const slotPaths = [0, 1].map((slot) =>
    join(paths.stateDir, `manifest-migration.${migrationId}.journal.${String(slot)}.json`),
  );
  for (const slotPath of slotPaths) await nodeFs.writeFile(slotPath, new Uint8Array(), { mode: 0o600 });

  const home = await nodeFs.lstat(paths.home, { bigint: true });
  const state = await nodeFs.lstat(paths.stateDir, { bigint: true });
  const lock = await nodeFs.lstat(lockPath, { bigint: true });
  const uid = process.getuid?.() ?? 0;
  return {
    paths,
    packaged: await packagedRelease(root),
    bootstrapIdentity: {
      path: lockPath as CanonicalAbsolutePathV1,
      ownerUid: uid,
      mode: 0o600,
      nlink: 1,
      size: 0,
      dev: String(lock.dev) as UInt64DecimalV1,
      ino: String(lock.ino) as UInt64DecimalV1,
    },
    externalShape: {
      entries: [
        { role: "product_home", pathHash: digest(paths.home), kind: "directory", ownerUid: uid, mode: 0o700, nlink: Number(home.nlink), size: String(home.size), dev: String(home.dev), ino: String(home.ino) },
        { role: "state_directory", pathHash: digest(paths.stateDir), kind: "directory", ownerUid: uid, mode: 0o700, nlink: Number(state.nlink), size: String(state.size), dev: String(state.dev), ino: String(state.ino) },
        { role: "bootstrap_lock", pathHash: digest(lockPath), kind: "regular_file", ownerUid: uid, mode: 0o600, nlink: 1, size: "0", dev: String(lock.dev), ino: String(lock.ino) },
      ],
    } as unknown as BootstrapExternalShapeProjectionV1,
    journalSlots: [await identity(slotPaths[0] as string), await identity(slotPaths[1] as string)],
  };
}

function planRequest(installation: Installation) {
  return {
    id: migrationId,
    nonce: digest("synthetic install nonce"),
    bootstrapIdentity: installation.bootstrapIdentity,
    externalShape: installation.externalShape,
    journalSlots: installation.journalSlots,
    admittedPreexistingPaths: [] as readonly CanonicalAbsolutePathV1[],
  };
}

describe("V1 to V2 migration composition over a real installation", () => {
  it("reserves every V2-only product path the migration owns", async () => {
    const installation = await createInstallation("reserved");
    const reserved = migrationReservedPaths(installation.paths);

    expect(reserved.directories.length).toBeGreaterThan(0);
    expect(reserved.reservations.length).toBeGreaterThan(0);
    expect(reserved.reservations).toContain(join(installation.paths.stateDir, "update-executor.json"));
    expect(reserved.reservations).not.toContain(join(installation.paths.stateDir, "lifecycle-activation.json"));
    expect(reserved.directories).toContain(join(installation.paths.stateDir, "lifecycle-journals"));
  });

  it("derives a complete migration plan from the guarded V1 installation", async () => {
    const installation = await createInstallation("complete");
    const plan = await planV1ToV2Migration(
      { paths: installation.paths, packaged: installation.packaged, now: () => new Date("2026-09-08T00:00:00.000Z") },
      planRequest(installation),
    );

    expect(plan.operation).toBe("v1_to_v2");
    expect(plan.v1ManifestHash).toBe(digest(await nodeFs.readFile(installation.paths.manifestFile)));
    expect(plan.createdPaths.length).toBeGreaterThan(0);
    expect(plan.createdPaths.map((row) => row.path)).toContain(
      join(installation.paths.stateDir, "lifecycle-install-nonce"),
    );
    expect(plan.launchabilityPaths.length).toBeGreaterThanOrEqual(7);
    expect(plan.foundationParticipants.map((participant) => participant.id)).toStrictEqual([
      `tx_mm_${migrationId.slice(3)}_0000000000_c`,
      `tx_mm_${migrationId.slice(3)}_0000000000_f`,
    ]);
    expect(plan.createdPaths.map((row) => row.path)).toContain(installation.paths.logsDir);
    expect(plan.payloads.filter((row) => row.source.kind === "guarded_migration_preimage")).toHaveLength(4);
  });

  it("refuses a V1 installation that claims the Spec 1 activation record", async () => {
    const installation = await createInstallation("activation-collision", (paths) =>
      legacyManifest(paths, [{
        owner: "core",
        path: join(paths.stateDir, "lifecycle-activation.json"),
        kind: "file",
        productVersion: "0.9.0",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: digest(schemaBytes),
        source: "templates/schemas/plan.schema.json",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      }]),
    );

    await expect(planV1ToV2Migration(
      { paths: installation.paths, packaged: installation.packaged, now: () => new Date("2026-09-08T00:00:00.000Z") },
      planRequest(installation),
    )).rejects.toThrow(ManifestMigrationNotFeasibleError);
  });
});
