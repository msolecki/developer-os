import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import {
  EXIT_CODES,
  planManifestMigration,
  validateManifestStatePlan,
} from "@developer-os/core";
import type {
  BootstrapExternalShapeProjectionV1,
  BootstrapPayloadSourceV1,
  CanonicalAbsolutePathV1,
  LowerHexSha256,
  ManifestMigrationIdV1,
  ManifestMigrationIdentityV1,
  ManifestMigrationParentV1,
  ManifestMigrationPlanV1,
  ManifestMigrationReadRequestV1,
  ManifestMigrationReadV1,
  ManifestStatePlanAdmissionContextV1,
  ManifestStatePlanV1,
  PersistedBootstrapLockIdentityV1,
  RuntimePaths,
  UInt64DecimalV1,
  UtcTimestampV1,
} from "@developer-os/core";

import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import { createCanonicalPathEvidence, createOwnerPathAdmission } from "./admission.js";

const MAX_MANIFEST_BYTES = 67_108_864;
const MAX_PREIMAGE_BYTES = 67_108_864;
const AUTOMATION_JOBS = ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const;
const AUTOMATION_LOG_SLOTS = 10;
const TERMINAL_TRANSACTION_PHASES = new Set(["finalized", "rolled_back"]);

class ManifestMigrationCompositionError extends Error {
  constructor(
    readonly code: typeof EXIT_CODES.recoveryRequired | typeof EXIT_CODES.securityRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ManifestMigrationCompositionError";
  }
}

export interface ManifestMigrationCompositionV1 {
  readonly paths: RuntimePaths;
  readonly packaged: AdmittedPackagedReleaseV1;
  readonly now: () => Date;
}

export interface ManifestMigrationEnvelopeRequestV1 {
  readonly id: ManifestMigrationIdV1;
  readonly nonce: LowerHexSha256;
  readonly bootstrapIdentity: PersistedBootstrapLockIdentityV1;
  readonly externalShape: BootstrapExternalShapeProjectionV1;
  readonly journalSlots: readonly [ManifestMigrationIdentityV1, ManifestMigrationIdentityV1];
  readonly admittedPreexistingPaths: readonly CanonicalAbsolutePathV1[];
}

/**
 * The product-owned paths a V2 installation reserves and a V1 installation may
 * not already claim. The Spec 1 activation record is deliberately absent: only
 * lifecycle apply creates it, so Core reserves it against collision and no
 * composition may schedule it for creation.
 */
export function migrationReservedPaths(paths: RuntimePaths): {
  readonly directories: readonly string[];
  readonly reservations: readonly string[];
} {
  return {
    directories: [
      join(paths.stateDir, "lifecycle-journals"),
      join(paths.stateDir, "git-effect-journals"),
      join(paths.stateDir, "launchd-effect-journals"),
      join(paths.stateDir, "rollback"),
    ],
    reservations: [
      join(paths.stateDir, "git-sync.json"),
      join(paths.stateDir, "uninstalling.json"),
      join(paths.stateDir, "update-rollback.json"),
      join(paths.stateDir, "update-executor.json"),
      ...AUTOMATION_JOBS.flatMap((job) => [
        join(paths.stateDir, `automation-${job}.json`),
        join(paths.stateDir, `.automation-${job}.lock`),
        ...Array.from({ length: AUTOMATION_LOG_SLOTS }, (_, ordinal) =>
          join(paths.logsDir, `automation-${job}.${String(ordinal)}.json`),
        ),
      ]),
    ],
  };
}

function uid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function fileMode(stats: Stats): number {
  return stats.mode & 0o777;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function lstatOptional(path: string): Promise<Stats | null> {
  try {
    return await nodeFs.lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function identityOf(stats: Stats): ManifestMigrationIdentityV1 {
  return { dev: String(stats.dev) as UInt64DecimalV1, ino: String(stats.ino) as UInt64DecimalV1 };
}

async function guardReadOwnedFile(path: string, maximumBytes: number): Promise<{
  readonly bytes: Uint8Array;
  readonly stats: Stats;
}> {
  const before = await nodeFs.lstat(path);
  const exactShape = (stats: Stats): boolean =>
    stats.isFile() && !stats.isSymbolicLink() && stats.uid === uid() &&
    stats.nlink === 1 && stats.size >= 0 && stats.size <= maximumBytes;
  if (!exactShape(before)) {
    throw new ManifestMigrationCompositionError(EXIT_CODES.securityRefusal, `guarded migration authority changed shape: ${path}`);
  }
  const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (!exactShape(opened) || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new ManifestMigrationCompositionError(EXIT_CODES.securityRefusal, `guarded migration authority changed during open: ${path}`);
    }
    const bytes = await handle.readFile();
    const after = await nodeFs.lstat(path);
    if (!exactShape(after) || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== bytes.byteLength) {
      throw new ManifestMigrationCompositionError(EXIT_CODES.securityRefusal, `guarded migration authority changed during read: ${path}`);
    }
    return { bytes, stats: after };
  } finally {
    await handle.close();
  }
}

async function foundationState(stateDir: string): Promise<"complete" | "incomplete"> {
  const root = join(stateDir, "transactions");
  let names: readonly string[];
  try {
    names = await nodeFs.readdir(root);
  } catch (error) {
    if (isMissing(error)) return "complete";
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) return "incomplete";
    let phase: unknown;
    try {
      phase = (JSON.parse(await nodeFs.readFile(join(root, name), "utf8")) as { phase?: unknown }).phase;
    } catch {
      return "incomplete";
    }
    if (typeof phase !== "string" || !TERMINAL_TRANSACTION_PHASES.has(phase)) return "incomplete";
  }
  return "complete";
}

async function observeDirectories(
  candidates: readonly string[],
): Promise<readonly ManifestMigrationParentV1[]> {
  const parents: ManifestMigrationParentV1[] = [];
  for (const path of [...new Set(candidates)]) {
    const stats = await lstatOptional(path);
    if (stats === null) continue;
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== uid()) {
      throw new ManifestMigrationCompositionError(EXIT_CODES.securityRefusal, `migration parent is not an owned directory: ${path}`);
    }
    parents.push({ path: path as CanonicalAbsolutePathV1, ...identityOf(stats) });
  }
  return parents;
}

async function readAuthority(input: ManifestMigrationReadRequestV1): Promise<ManifestMigrationReadV1> {
  const stats = await lstatOptional(input.path);
  if (stats === null || stats.isSymbolicLink()) return { kind: "unavailable" };
  if (stats.isDirectory()) return { kind: "directory", ownerUid: stats.uid, ...identityOf(stats) };
  if (!stats.isFile()) return { kind: "unavailable" };
  const mode = fileMode(stats);
  if (mode !== 0o600 && mode !== 0o700) return { kind: "unavailable" };
  const observed = await guardReadOwnedFile(input.path, MAX_PREIMAGE_BYTES);
  return {
    kind: "regular_file",
    ownerUid: observed.stats.uid,
    mode: mode === 0o600 ? 0o600 : 0o700,
    nlink: 1,
    bytes: observed.bytes.byteLength,
    sha256: createHash("sha256").update(observed.bytes).digest("hex") as LowerHexSha256,
    ...identityOf(observed.stats),
  };
}

async function availableBytes(home: string): Promise<UInt64DecimalV1> {
  const stats = await nodeFs.statfs(home, { bigint: true });
  return String(stats.bavail * stats.bsize) as UInt64DecimalV1;
}

function manifestPlanAdmission(
  paths: RuntimePaths,
  id: ManifestMigrationIdV1,
  candidate: ManifestStatePlanV1,
): ManifestStatePlanAdmissionContextV1 {
  const uuid = String(id).slice(3);
  const count = candidate.bindings.foundationTransactions.count;
  return {
    evidence: createCanonicalPathEvidence(),
    productHome: paths.home as CanonicalAbsolutePathV1,
    manifestPath: paths.manifestFile as CanonicalAbsolutePathV1,
    foundationTransactionIds: Array.from({ length: count }, (_, ordinal) =>
      `tx_mm_${uuid}_${String(ordinal).padStart(10, "0")}_f`,
    ),
    externalEffects: [],
    admitParticipant: (envelope, participantId) =>
      envelope.kind === "v1_migration" && envelope.id === id && participantId === `mf_${id}`
        ? participantId as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>
        : "mf_refused" as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>,
    admitExternalEffect: () => "refused",
    bootstrapPayloadIdentity: () => ({ dev: "1" as UInt64DecimalV1, ino: "1" as UInt64DecimalV1 }),
  };
}

export async function planV1ToV2Migration(
  composition: ManifestMigrationCompositionV1,
  request: ManifestMigrationEnvelopeRequestV1,
): Promise<ManifestMigrationPlanV1> {
  const { paths, packaged } = composition;
  const reserved = migrationReservedPaths(paths);
  const manifest = await guardReadOwnedFile(paths.manifestFile, MAX_MANIFEST_BYTES);
  const stagingRoot = paths.stagingDir;
  const parents = await observeDirectories([
    paths.home,
    paths.stateDir,
    paths.logsDir,
    paths.backupsDir,
    stagingRoot,
    join(stagingRoot, "manifest-migration"),
    join(stagingRoot, "transactions"),
    join(stagingRoot, "manifest-migration", request.id),
    join(paths.stateDir, "transactions"),
    ...reserved.directories,
  ]);
  const present = new Set(parents.map((parent) => parent.path as string));
  const plannedAt = composition.now().toISOString();

  return planManifestMigration({
    id: request.id,
    admission: {
      evidence: createCanonicalPathEvidence(),
      productHome: paths.home as CanonicalAbsolutePathV1,
      stateRoot: paths.stateDir as CanonicalAbsolutePathV1,
      productStagingRoot: stagingRoot as CanonicalAbsolutePathV1,
      admitPayloadSource: (source: BootstrapPayloadSourceV1) => {
        if (source.kind !== "guarded_package_file") return structuredClone(source);
        const file = packaged.files.find((candidate) => candidate.relativePath === source.relativePath);
        return file !== undefined &&
          source.packageRoot === packaged.packageRoot &&
          source.packageRootDev === packaged.packageRootDev &&
          source.packageRootIno === packaged.packageRootIno &&
          source.packageInventoryHash === packaged.packageInventoryHash &&
          source.sourceDev === file.dev &&
          source.sourceIno === file.ino &&
          source.sourceHash === file.sha256 &&
          source.sourceBytes === file.bytes &&
          source.sourceMode === file.mode
          ? structuredClone(source)
          : { kind: "constant_empty", role: "empty_reservation" };
      },
      admitPlannedCreatedPath: (candidate) => structuredClone(candidate),
      admitPreexistingParent: (candidate) => {
        const observed = parents.find((parent) =>
          parent.path === candidate.path && parent.dev === candidate.dev && parent.ino === candidate.ino,
        );
        return observed === undefined
          ? { kind: "preexisting", path: candidate.path, dev: "0" as UInt64DecimalV1, ino: "0" as UInt64DecimalV1 }
          : { kind: "preexisting", path: observed.path, dev: observed.dev, ino: observed.ino };
      },
      admitFoundationParticipant: (candidate) => structuredClone(candidate),
      admitManifestParticipant: (candidate) =>
        validateManifestStatePlan(candidate, manifestPlanAdmission(paths, request.id, candidate)),
      admitPlanDerivedValue: (_role, value) => structuredClone(value),
    },
    manifestAdmission: {
      evidence: createCanonicalPathEvidence(),
      sourceRoot: packaged.packageRoot as CanonicalAbsolutePathV1,
      backupRoot: paths.backupsDir as CanonicalAbsolutePathV1,
      admitOwnerPath: createOwnerPathAdmission({
        kind: "confined",
        roots: [paths.home as CanonicalAbsolutePathV1, paths.brain as CanonicalAbsolutePathV1],
      }),
    },
    bootstrapIdentity: request.bootstrapIdentity,
    externalShape: request.externalShape,
    admittedPreexistingPaths: request.admittedPreexistingPaths,
    preexistingParents: parents,
    journalSlots: request.journalSlots,
    manifestPath: paths.manifestFile as CanonicalAbsolutePathV1,
    manifestBytes: manifest.bytes,
    manifestIdentity: identityOf(manifest.stats),
    foundationState: await foundationState(paths.stateDir),
    productDirectories: [
      ...reserved.directories,
      ...(present.has(paths.logsDir) ? [] : [paths.logsDir]),
    ] as CanonicalAbsolutePathV1[],
    productReservations: reserved.reservations as CanonicalAbsolutePathV1[],
    packaged: {
      packageRoot: packaged.packageRoot as CanonicalAbsolutePathV1,
      packageRootDev: packaged.packageRootDev as UInt64DecimalV1,
      packageRootIno: packaged.packageRootIno as UInt64DecimalV1,
      packageInventoryHash: packaged.packageInventoryHash,
      retainedMetadata: packaged.retainedMetadata,
      bundleRoot: packaged.bundleRoot,
      identity: packaged.identity,
      files: packaged.files.map((file) => ({
        relativePath: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256,
        mode: file.mode,
        dev: file.dev as UInt64DecimalV1,
        ino: file.ino as UInt64DecimalV1,
      })),
    },
    availableBytes: await availableBytes(paths.home),
    nonce: request.nonce,
    plannedAt: plannedAt as UtcTimestampV1,
    read: readAuthority,
  });
}
