import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, ManifestMigrationNotFeasibleError } from "@developer-os/core";
import type {
  BootstrapExternalShapeProjectionV1,
  CanonicalAbsolutePathV1,
  LowerHexSha256,
  ManifestMigrationIdV1,
  PersistedBootstrapLockIdentityV1,
  RuntimePaths,
  UInt64DecimalV1,
} from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { admitRootVerifiedPackagedRelease, inspectPackagedRelease } from "../update/packaged-release.js";
import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import { planV1ToV2Migration } from "./migration.js";
import { v2OnlyProductPaths } from "./reservations.js";

const migrationId = "mm_123e4567-e89b-42d3-a456-426614174000" as ManifestMigrationIdV1;
const encoder = new TextEncoder();
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
  await removeCommandFixtures();
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
  return migrationEnvelope(root, paths);
}

async function migrationEnvelope(root: string, paths: RuntimePaths): Promise<Installation> {
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

const PLANNED_AT = () => new Date("2026-09-08T00:00:00.000Z");

function foundationJournal(id: string, phase: string): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    id,
    kind: "init",
    phase,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mutations: [],
  })}\n`;
}

async function writeTransactionEntries(
  installation: Installation,
  entries: Readonly<Record<string, string>>,
): Promise<string> {
  const root = join(installation.paths.stateDir, "transactions");
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(entries)) {
    await nodeFs.writeFile(join(root, name), content, { mode: 0o600 });
  }
  return root;
}

function planInstallation(installation: Installation) {
  return planV1ToV2Migration(
    { paths: installation.paths, packaged: installation.packaged, now: PLANNED_AT },
    planRequest(installation),
  );
}

describe("V1 Foundation transaction admission", () => {
  it("admits terminal Foundation journals beside the lock files their transactions leave", async () => {
    const installation = await createInstallation("foundation-locks");
    await writeTransactionEntries(installation, {
      "tx_fixture_001.json": foundationJournal("tx_fixture_001", "finalized"),
      ".tx_fixture_001.lock": "",
      "tx_fixture_002.json": foundationJournal("tx_fixture_002", "rolled_back"),
      ".tx_fixture_002.lock": "",
    });

    await expect(planInstallation(installation)).resolves.toMatchObject({ operation: "v1_to_v2" });
  });

  const refusedFoundationEntries = [
    { name: "a journal stopped before a terminal phase", entries: { "tx_a.json": foundationJournal("tx_a", "applied"), ".tx_a.lock": "" } },
    { name: "a malformed journal that carries a terminal phase", entries: { "tx_a.json": `${JSON.stringify({ phase: "finalized" })}\n` } },
    { name: "a terminal journal whose id disagrees with its name", entries: { "tx_a.json": foundationJournal("tx_b", "finalized") } },
    { name: "a lock file without its journal", entries: { "tx_a.json": foundationJournal("tx_a", "finalized"), ".tx_b.lock": "" } },
    { name: "a temporary journal write left behind", entries: { "tx_a.json": foundationJournal("tx_a", "finalized"), ".tx_a.0f1e.json.tmp": "" } },
    { name: "an unknown entry", entries: { "notes.txt": "" } },
  ] as const;

  it("enumerates a non-empty refused Foundation entry set", () => {
    expect(refusedFoundationEntries.length).toBeGreaterThan(0);
  });

  it.each(refusedFoundationEntries)("refuses $name as an incomplete Foundation transaction", async ({ entries }) => {
    const installation = await createInstallation("foundation-refused");
    await writeTransactionEntries(installation, entries);

    await expect(planInstallation(installation)).rejects.toThrow(ManifestMigrationNotFeasibleError);
  });

  it("refuses a symlinked Foundation journal through the guarded read", async () => {
    const installation = await createInstallation("foundation-symlink");
    const root = await writeTransactionEntries(installation, {});
    const target = join(installation.paths.home, "elsewhere.json");
    await nodeFs.writeFile(target, foundationJournal("tx_a", "finalized"), { mode: 0o600 });
    await nodeFs.symlink(target, join(root, "tx_a.json"));

    await expect(planInstallation(installation)).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("refuses a Foundation journal above the journal byte bound before decoding it", async () => {
    const installation = await createInstallation("foundation-oversize");
    const journal = foundationJournal("tx_a", "finalized");
    await writeTransactionEntries(installation, {
      "tx_a.json": `${journal.slice(0, -1)}${" ".repeat(1_048_576)}\n`,
    });

    await expect(planInstallation(installation)).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });
});

describe("V1 to V2 migration composition over a real installation", () => {
  it("admits the installation the shipped V1 init leaves behind", async () => {
    const fixture = await createCommandFixture("migration-shipped-v1", { bootstrapProductionLocks: true });
    const initialized = await runInit(fixture.context, { dryRun: false, assumeYes: true });
    expect(initialized.ok && initialized.data.schemaVersion).toBe(1);

    const transactionEntries = await nodeFs.readdir(join(fixture.paths.stateDir, "transactions"));
    expect(transactionEntries.filter((name) => /^\..+\.lock$/u.test(name)).length).toBeGreaterThan(0);
    expect(transactionEntries.filter((name) => name.endsWith(".json")).length).toBeGreaterThan(0);
    const v1 = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
      readonly schemaVersion: number;
      readonly artifacts: readonly { readonly path: string }[];
    };
    expect(v1.schemaVersion).toBe(1);
    expect(v1.artifacts.map((artifact) => artifact.path)).toContain(fixture.paths.stagingDir);

    const installation = await migrationEnvelope(fixture.root, fixture.paths);
    const plan = await planV1ToV2Migration(
      { paths: installation.paths, packaged: installation.packaged, now: PLANNED_AT },
      planRequest(installation),
    );

    expect(plan.operation).toBe("v1_to_v2");
    expect(plan.v1ManifestHash).toBe(digest(await nodeFs.readFile(fixture.paths.manifestFile)));
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reserves exactly the V2-only product directories and runtime reservations", () => {
    const paths = runtimePaths("/product", "/brain");
    const reserved = v2OnlyProductPaths(paths);

    expect(reserved.directories.length).toBeGreaterThan(0);
    expect(reserved.reservations.length).toBeGreaterThan(0);
    expect(reserved.directories).toStrictEqual([
      "/product/state/lifecycle-journals",
      "/product/state/git-effect-journals",
      "/product/state/launchd-effect-journals",
      "/product/state/rollback",
    ]);
    expect(reserved.reservations).toStrictEqual([
      "/product/state/git-sync.json",
      "/product/state/uninstalling.json",
      "/product/state/update-rollback.json",
      "/product/state/update-executor.json",
      ...["brain-reindex", "brain-lint", "doctor", "git-sync"].flatMap((job) => [
        `/product/state/automation-${job}.json`,
        `/product/state/.automation-${job}.lock`,
        ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((slot) => `/product/logs/automation-${job}.${slot}.json`),
      ]),
    ]);
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

  const v2OnlyLeaves = [
    {
      name: "a file at the Spec 1 activation record",
      arrange: (paths: RuntimePaths) => nodeFs.writeFile(join(paths.stateDir, "lifecycle-activation.json"), "{}\n", { mode: 0o600 }),
    },
    {
      name: "an owner-only directory at the V2-only rollback root",
      arrange: (paths: RuntimePaths) => nodeFs.mkdir(join(paths.stateDir, "rollback"), { mode: 0o700 }),
    },
    {
      name: "a dangling symlink at the V2-only release root",
      arrange: (paths: RuntimePaths) => nodeFs.symlink(join(paths.home, "missing"), join(paths.home, "releases")),
    },
    {
      name: "an empty file at a V2-only automation log reservation",
      arrange: async (paths: RuntimePaths) => {
        await nodeFs.mkdir(paths.logsDir, { mode: 0o700 });
        await nodeFs.writeFile(join(paths.logsDir, "automation-doctor.0.json"), "", { mode: 0o600 });
      },
    },
  ] as const;

  it("enumerates a non-empty V2-only leaf set", () => {
    expect(v2OnlyLeaves.length).toBeGreaterThan(0);
  });

  it.each(v2OnlyLeaves)("refuses $name instead of adopting it", async ({ arrange }) => {
    const installation = await createInstallation("v2-only-leaf");
    await arrange(installation.paths);

    await expect(planInstallation(installation)).rejects.toThrow(ManifestMigrationNotFeasibleError);
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
