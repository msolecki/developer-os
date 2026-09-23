import { randomUUID } from "node:crypto";
import { close, fstat, fstatSync, read } from "node:fs";
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

import {
  createOwnerUpdateRegistry,
  decodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  keepOwnerUpdateProvider,
  OWNER_UPDATE_ORDER,
  ownerContentDependencies,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseUInt64Decimal,
  plannerPathToken,
  validateActiveReleaseRecord,
  validateManifestV2,
  validateReleaseTrustState,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type {
  ArtifactOwner,
  CanonicalAbsolutePathV1,
  CanonicalPathEvidenceV1,
  DeveloperOsConfigV1,
  ExitCode,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  OfflineReleaseTrustV1,
  PlannerArtifactInputV1,
  PlannerBrainEntryV1,
  PlannerInputBlobRefV1,
  PlannerManifestArtifactV1,
  PlannerManifestSnapshotV1,
  PlannerObservedStateV1,
  PlannerPathTokenV1,
  ReleaseBundleReferenceV1,
  ReleaseIdentityV1,
  RollbackPayloadEntryV1,
  UtcTimestampV1,
} from "@developer-os/core";
import { claudeOwnerUpdateProvider } from "@developer-os/adapter-claude";
import { codexOwnerUpdateProvider } from "@developer-os/adapter-codex";
import { isBrainMigrationPath } from "@developer-os/brain";
import {
  createRedactor,
  FixedReleaseTransport,
  nodeReleaseExchange,
  readOfflineReleaseTrustFd,
  ReleasePlanningScratchStore,
  sampleNodePlannerProcess,
  spawnNodePlannerChild,
  TargetPlannerSupervisor,
} from "@developer-os/security";
import type {
  BoundedReleaseResponseV1,
  ReleaseBodySink,
  ReleasePlanningAttemptIdV1,
  ReleasePlanningScratchRequestV1,
  ReleaseTransportRequestV1,
  TargetPlannerRunRequestV1,
  TargetPlannerRunResultV1,
  VerifiedScratchBundleV1,
} from "@developer-os/security";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { inspectV2Drift } from "../commands/doctor.js";
import { readConfigFile } from "../config-file.js";
import { readRedactionKey } from "../context.js";
import type { CliContext } from "../context.js";
import { readNoFollow } from "../instructions/apply.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { admitInstalledV2Home } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../lifecycle/context.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { gateManifestAdmission } from "../lifecycle/mutation-gate.js";
import {
  MAXIMUM_ROLLBACK_RECORD_BYTES,
  parseMigrationInverseLeaf,
  parseOwnerInverseLeaf,
  UpdatePlanningRefusal,
  validateRollbackRecord,
} from "./planning.js";
import type {
  MigrationInverseLeafV1,
  OwnerInverseLeafV1,
  RetainedRollbackEvidenceV1,
  RollbackRecordV1,
  UpdateCapacityObservationV1,
  UpdateHomeV1,
  UpdatePlannerSnapshotV1,
} from "./planning.js";

/** One attempt's fixed-origin transport; its wall budget is shared with the planner. */
export interface UpdateTransportV1 {
  get(request: ReleaseTransportRequestV1): Promise<BoundedReleaseResponseV1>;
  remainingMilliseconds(): number;
}

export interface UpdateScratchAttemptV1 {
  download(fetch: (sink: ReleaseBodySink) => Promise<BoundedReleaseResponseV1>): Promise<void>;
  extract(bundle: ReleaseBundleReferenceV1): Promise<VerifiedScratchBundleV1>;
  cleanup(): Promise<void>;
}

export interface UpdateScratchV1 {
  create(request: ReleasePlanningScratchRequestV1): Promise<UpdateScratchAttemptV1>;
  listRecoverableAttempts(): Promise<readonly ReleasePlanningAttemptIdV1[]>;
  recoverCleanup(id: ReleasePlanningAttemptIdV1): Promise<void>;
}

/**
 * Every port the plan-only commands use. Production binds them here; a test replaces any of them,
 * so the orchestration in `planning.ts` is exercised without a network, a launcher, or a planner.
 */
export interface CliUpdateContext {
  readonly productHome: CanonicalAbsolutePathV1;
  readonly pathEvidence: CanonicalPathEvidenceV1;
  readonly clock: () => UtcTimestampV1;
  /** Read-only: admitted V2 manifest, zero drift, clear ledger, active/trust/rollback records. */
  readonly readHome: () => Promise<UpdateHomeV1>;
  /** The launcher's FD 3 handoff. `update` only; rollback never reads it. */
  readonly readOfflineTrust: () => Promise<OfflineReleaseTrustV1>;
  readonly createTransport: (trust: OfflineReleaseTrustV1) => UpdateTransportV1;
  readonly scratch: UpdateScratchV1;
  readonly snapshot: (
    home: UpdateHomeV1,
    releases: { readonly current: ReleaseIdentityV1; readonly target: ReleaseIdentityV1; readonly plannedAt: UtcTimestampV1 },
  ) => Promise<UpdatePlannerSnapshotV1>;
  readonly planner: { run(request: TargetPlannerRunRequestV1): Promise<TargetPlannerRunResultV1> };
  /** Hash-checked retained payload plus the current-postimage check; refuses a post-update edit. */
  readonly readRollbackEvidence: (home: UpdateHomeV1, record: RollbackRecordV1) => Promise<RetainedRollbackEvidenceV1>;
  readonly capacity: () => Promise<UpdateCapacityObservationV1>;
  readonly admitManifest: (value: unknown) => InstallationManifestV2;
}

const MAX_RELEASE_RECORD_BYTES = 16 * 1024;
const MAX_BLOB_BYTES = 16_777_216;
const MAX_BRAIN_BYTES = 1_073_741_824;
const TRUST_DESCRIPTOR = 3;

function refuse(reason: string, code: Exclude<ExitCode, 0>, paths: readonly string[] = [], recovery?: string): never {
  throw new UpdatePlanningRefusal(reason, code, paths, recovery);
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function lifecycleOf(context: CliContext): CliLifecycleContext {
  return context.lifecycle ?? refuse("update_lifecycle_unavailable", EXIT_CODES.capabilityUnavailable, [context.paths.home]);
}

/** A malformed local record is recovery-required (Spec 2 §11), never a guess. */
async function readRecord<T>(path: string, maximumBytes: number, reason: string, validate: (value: unknown) => T): Promise<T | null> {
  const bytes = await readNoFollow(path);
  if (bytes === null) return null;
  try {
    if (bytes.byteLength > maximumBytes) throw new Error("oversized");
    return validate(decodeCanonicalJson(bytes, maximumBytes));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
    return refuse(reason, EXIT_CODES.recoveryRequired, [path], "developer-os doctor");
  }
}

async function readHome(context: CliContext): Promise<UpdateHomeV1> {
  const lifecycle = lifecycleOf(context);
  const { paths } = context;
  const admitted = await admitInstalledV2Home({
    fs: lifecycle.fs,
    paths,
    manifestAdmission: gateManifestAdmission(context),
    effectiveUid: lifecycle.effectiveUid,
  });
  // Every owner, vendors included: a user-edited vendor file is a decision, not a planner refusal.
  const drift = await inspectV2Drift(context, admitted.manifest, paths);
  if (drift.length > 0) refuse("update_managed_drift", EXIT_CODES.decisionRequired, drift.map((finding) => finding.path), "developer-os doctor");

  const residue = residueFrom(
    await inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: paths.home,
        stateDirectory: paths.stateDir,
        initialRoots: [paths.home, paths.stateDir, context.userHome],
      }),
    ),
  );
  const ledger = await lifecycle.inspectLedger(lifecycleHomeKeyFromAdmission(admitted, paths), residue);
  if (ledger.closure.kind !== "clear") refuse("update_lifecycle_not_clear", EXIT_CODES.recoveryRequired, [paths.home], "developer-os doctor");

  const evidence = createCanonicalPathEvidence();
  const activePath = join(paths.stateDir, "active-release.json");
  const trustPath = join(paths.stateDir, "release-trust.json");
  const active = await readRecord(activePath, MAX_RELEASE_RECORD_BYTES, "update_active_release_invalid", (value) => validateActiveReleaseRecord(value, evidence))
    ?? refuse("update_active_release_absent", EXIT_CODES.recoveryRequired, [activePath], "developer-os doctor");
  const trust = await readRecord(trustPath, MAX_RELEASE_RECORD_BYTES, "update_release_trust_invalid", validateReleaseTrustState)
    ?? refuse("update_release_trust_absent", EXIT_CODES.recoveryRequired, [trustPath], "developer-os doctor");
  const rollback = await readRecord(join(paths.stateDir, "update-rollback.json"), MAXIMUM_ROLLBACK_RECORD_BYTES, "update_rollback_record_invalid", (value) =>
    validateRollbackRecord(value, evidence));
  return { manifest: admitted.manifest, active, trust, rollback };
}

/** Only the Claude and Codex providers read bytes; core and macOS rows are keep-only on the current side. */
const CURRENT_OWNER_REGISTRY = createOwnerUpdateRegistry([
  keepOwnerUpdateProvider("core"),
  claudeOwnerUpdateProvider,
  codexOwnerUpdateProvider,
  keepOwnerUpdateProvider("macos"),
]);

function currentHashOf(row: ManagedArtifactV2): LowerHexSha256 | null {
  const verification: ManagedArtifactV2["verification"] = row.verification;
  if ("installedHash" in verification) return verification.installedHash;
  return "blockHash" in verification ? verification.blockHash : null;
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await nodeFs.lstat(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

/** Spec 2 §8.2's legality table, observed after the zero-drift gate; a disagreement is drift. */
async function observe(
  row: ManagedArtifactV2,
  withBlob: boolean,
  blobs: Uint8Array[],
): Promise<PlannerObservedStateV1> {
  const drifted = (): never => refuse("update_managed_drift", EXIT_CODES.decisionRequired, [row.path], "developer-os doctor");
  const stat = await lstatOrNull(row.path);
  if (row.kind === "file" && row.verification.mode === "ephemeral") {
    return stat === null ? { state: "absent" } : { state: "ephemeral_present", mode: 384 };
  }
  if (row.kind === "directory") return stat?.isDirectory() === true ? { state: "directory", mode: 448 } : drifted();
  if (row.kind === "symlink") {
    if (stat?.isSymbolicLink() !== true) return drifted();
    const target = await nodeFs.readlink(row.path, { encoding: "buffer" });
    return { state: "symlink", targetBytes: target.byteLength, targetHash: hashBytes(target) as LowerHexSha256 };
  }
  const bytes = stat?.isFile() === true ? await readNoFollow(row.path) : null;
  if (bytes === null || stat === null) return drifted();
  const sha256 = hashBytes(bytes) as LowerHexSha256;
  const mode = (stat.mode & 0o777) === 0o700 ? 448 : 384;
  if (!withBlob) return { state: "content", mode, bytes: bytes.byteLength, sha256, blob: null };
  if (bytes.byteLength > MAX_BLOB_BYTES) refuse("update_owner_file_oversized", EXIT_CODES.capabilityUnavailable, [row.path]);
  const blob: PlannerInputBlobRefV1 = { stream: "input", ordinal: blobs.length, bytes: bytes.byteLength, sha256 };
  blobs.push(bytes);
  return { state: "content", mode, bytes: bytes.byteLength, sha256, blob };
}

/**
 * The Brain migration inputs: regular files the Brain folder policy admits, sorted by unsigned
 * UTF-8 path. No configured Brain section means no Brain planning and no bytes sent.
 */
async function brainEntries(context: CliContext, config: DeveloperOsConfigV1, blobs: Uint8Array[]): Promise<readonly PlannerBrainEntryV1[]> {
  const brain = config.brain;
  if (brain === undefined) return [];
  const base = join(context.paths.brain, brain.contentRoot);
  const found = await nodeFs.readdir(base, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return [];
    throw error;
  });
  const candidates = found
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name);
      return { absolute, path: relative(context.paths.brain, absolute).split(sep).join("/").normalize("NFC") };
    })
    .filter((entry) => isBrainMigrationPath(entry.path, brain))
    .sort((left, right) => compareBytes(left.path, right.path));
  const entries: PlannerBrainEntryV1[] = [];
  let aggregate = 0;
  for (const candidate of candidates) {
    const bytes = await readNoFollow(candidate.absolute);
    if (bytes === null) continue;
    aggregate += bytes.byteLength;
    if (bytes.byteLength > MAX_BLOB_BYTES || aggregate > MAX_BRAIN_BYTES) refuse("update_brain_snapshot_oversized", EXIT_CODES.capabilityUnavailable);
    const sha256 = hashBytes(bytes) as LowerHexSha256;
    entries.push({
      path: candidate.path as PlannerBrainEntryV1["path"],
      mode: 384,
      bytes: bytes.byteLength,
      sha256,
      blob: { stream: "input", ordinal: blobs.length, bytes: bytes.byteLength, sha256 },
    });
    blobs.push(bytes);
  }
  return entries;
}

function ownerRoots(context: CliContext): Readonly<Partial<Record<ArtifactOwner, CanonicalAbsolutePathV1>>> {
  const vendors = resolveVendorHomes(context.env, context.userHome, context.paths.home);
  return {
    core: parseCanonicalAbsolutePathText(context.paths.home),
    claude: parseCanonicalAbsolutePathText(join(vendors.userHome, ".claude")),
    codex: parseCanonicalAbsolutePathText(vendors.codexHome),
  };
}

/**
 * Spec 2 §8.2: tokens in canonical owner/path order, the token map kept in memory, a blob only
 * where the installed owner's provider declared a content dependency, Brain root and redaction
 * literals replaced by a token and a count.
 */
async function snapshot(
  context: CliContext,
  home: UpdateHomeV1,
  releases: { readonly current: ReleaseIdentityV1; readonly target: ReleaseIdentityV1; readonly plannedAt: UtcTimestampV1 },
): Promise<UpdatePlannerSnapshotV1> {
  const config = await readConfigFile(context, context.paths.configFile)
    ?? refuse("update_config_absent", EXIT_CODES.recoveryRequired, [context.paths.configFile], "developer-os doctor");
  const rows = [...home.manifest.artifacts].sort((left, right) =>
    OWNER_UPDATE_ORDER.indexOf(left.owner) - OWNER_UPDATE_ORDER.indexOf(right.owner) || compareBytes(left.path, right.path));
  const tokenPaths = new Map<PlannerPathTokenV1, CanonicalAbsolutePathV1>();
  const artifacts = rows.map((row, ordinal): PlannerManifestArtifactV1 => {
    const token = plannerPathToken(ordinal);
    tokenPaths.set(token, row.path);
    return {
      token,
      owner: row.owner,
      kind: row.kind,
      verification: row.verification,
      productVersion: row.productVersion,
      source: row.source,
      mergeStrategy: row.mergeStrategy,
      currentHash: currentHashOf(row),
    };
  });
  const manifest: PlannerManifestSnapshotV1 = {
    schemaVersion: 1,
    productVersion: home.manifest.productVersion,
    installedAt: home.manifest.installedAt,
    artifacts,
  };
  const dependencies = new Set<string>(ownerContentDependencies(CURRENT_OWNER_REGISTRY, manifest));
  const blobs: Uint8Array[] = [];
  const artifactInputs: PlannerArtifactInputV1[] = [];
  for (const [ordinal, row] of rows.entries()) {
    const { token, owner, kind, verification, productVersion, source, mergeStrategy } = artifacts[ordinal] as PlannerManifestArtifactV1;
    const observed = await observe(row, dependencies.has(token), blobs);
    artifactInputs.push({ token, owner, kind, verification, productVersion, source, mergeStrategy, observed });
  }
  const entries = await brainEntries(context, config, blobs);
  const request = validateUpdatePlannerRequest({
    schemaVersion: 1,
    protocol: releases.target.updateProtocol,
    plannedAt: releases.plannedAt,
    platform: "darwin",
    architecture: releases.current.architecture,
    currentRelease: releases.current,
    targetRelease: releases.target,
    manifest,
    config: {
      schemaVersion: 1,
      brainRoot: "brain_root",
      adapters: config.adapters,
      git: config.git,
      automation: config.automation,
      brain: config.brain ?? null,
      redactionPatternsCount: config.redaction?.patterns.length ?? 0,
      telemetry: false,
    },
    installedOwners: OWNER_UPDATE_ORDER.filter((owner) => rows.some((row) => row.owner === owner)),
    artifactInputs,
    brain: {
      schemaVersion: 1,
      root: "brain_root",
      folderPolicyVersion: parsePositiveUInt32(config.brain?.schemaVersion ?? 1),
      entries,
      aggregateBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
  });
  return { request, inputBlobs: blobs, tokenPaths, ownerRoots: ownerRoots(context) };
}

function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid retained rollback object");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("invalid retained rollback keys");
  return value as Record<string, unknown>;
}

async function currentHash(path: string): Promise<LowerHexSha256 | null> {
  const bytes = await readNoFollow(path);
  return bytes === null ? null : hashBytes(bytes) as LowerHexSha256;
}

/**
 * Spec 2 §10.1–10.2, read-only. Every retained file reopens and matches its recorded hash; each
 * inverse leaf's expected current state must equal what is on disk now, or the user edited after
 * the update and rollback refuses rather than merging.
 */
async function readRollbackEvidence(context: CliContext, record: RollbackRecordV1): Promise<RetainedRollbackEvidenceV1> {
  const root = join(context.paths.home, "rollback", record.payloadId);
  const missing = (path: string): never => refuse("update_rollback_evidence_invalid", EXIT_CODES.recoveryRequired, [path], "developer-os doctor");
  const read = async (path: string, hash: LowerHexSha256 | null): Promise<Uint8Array> => {
    const bytes = await readNoFollow(path);
    if (bytes === null || (hash !== null && hashBytes(bytes) !== hash)) return missing(path);
    return bytes;
  };
  const parse = <T>(path: string, work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) throw error;
      return missing(path);
    }
  };

  const inventoryPath = join(root, "inventory.json");
  const inventoryBytes = await read(inventoryPath, record.payloadInventoryHash);
  await read(join(root, "inverse-plan.json"), record.inversePlanHash);
  const inventory = parse(inventoryPath, () => {
    const input = exactKeys(decodeCanonicalJson(inventoryBytes, MAXIMUM_ROLLBACK_RECORD_BYTES), ["schemaVersion", "payloadId", "rollbackBindingHash", "inversePlanHash", "entries", "aggregateBytes"]);
    if (input.schemaVersion !== 1 || input.payloadId !== record.payloadId || input.rollbackBindingHash !== record.rollbackBindingHash || input.inversePlanHash !== record.inversePlanHash || !Array.isArray(input.entries)) {
      throw new Error("invalid RollbackPayloadInventoryV1");
    }
    const entries = (input.entries as unknown[]).map((row, ordinal): RollbackPayloadEntryV1 => {
      const entry = exactKeys(row, ["ordinal", "path", "role", "bytes", "sha256"]);
      if (entry.ordinal !== ordinal || typeof entry.path !== "string" || typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes)) throw new Error("invalid RollbackPayloadEntryV1");
      return { ordinal, path: entry.path as RollbackPayloadEntryV1["path"], role: entry.role as RollbackPayloadEntryV1["role"], bytes: entry.bytes, sha256: parseLowerHexSha256(entry.sha256) };
    });
    if (entries.reduce((sum, entry) => sum + entry.bytes, 0) !== input.aggregateBytes) throw new Error("invalid RollbackPayloadInventoryV1.aggregateBytes");
    return { entries, aggregateBytes: input.aggregateBytes };
  });

  const owners: OwnerInverseLeafV1[] = [];
  const migrations: MigrationInverseLeafV1[] = [];
  for (const entry of inventory.entries) {
    const path = join(root, entry.path);
    const bytes = await read(path, entry.sha256);
    if (bytes.byteLength !== entry.bytes) missing(path);
    if (entry.role !== "inverse_plan_leaf") continue;
    parse(path, () => {
      // The retained leaf is the prepared projection plus the one binding it gained at allocation.
      const decoded = decodeCanonicalJson(bytes, MAXIMUM_ROLLBACK_RECORD_BYTES);
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("invalid retained leaf");
      const { rollbackBindingHash, ...projection } = decoded as Record<string, unknown>;
      if (rollbackBindingHash !== record.rollbackBindingHash) throw new Error("invalid retained leaf binding");
      if (entry.path.startsWith("plans/owner_inverse/")) owners.push(parseOwnerInverseLeaf(projection));
      else if (entry.path.startsWith("plans/schema_migration_inverse/")) migrations.push(parseMigrationInverseLeaf(projection));
      else throw new Error("invalid retained leaf path");
    });
  }
  if (owners.length < 1) missing(root);
  if ((await lstatOrNull(record.previous.bundleRoot))?.isDirectory() !== true) missing(record.previous.bundleRoot);

  const edited = (path: string): never => refuse("update_rollback_post_update_edit", EXIT_CODES.decisionRequired, [path]);
  for (const owner of owners) {
    for (const action of owner.actions) if ((await currentHash(action.path)) !== action.expectedCurrentHash) edited(action.path);
  }
  for (const migration of migrations) {
    for (const mutation of migration.mutations) {
      const path = migration.domain === "brain" ? join(context.paths.brain, mutation.path) : mutation.path;
      if ((await currentHash(path)) !== mutation.expectedCurrentHash) edited(path);
    }
  }
  return {
    payload: { payloadId: record.payloadId, entryCount: inventory.entries.length, aggregateBytes: inventory.aggregateBytes },
    owners,
    migrations,
  };
}

function setTimer(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(timer);
  };
}

const fstatAsync = promisify(fstat);
const readAsync = promisify(read);
const closeAsync = promisify(close);

/** The CLI side of the launcher's FD 3 pipe; every admission rule lives in Security. */
function readOfflineTrust(): Promise<OfflineReleaseTrustV1> {
  return readOfflineReleaseTrustFd(TRUST_DESCRIPTOR, {
    parentProcessId: () => process.ppid,
    // `readdir` lists the descriptor it scanned with; it is closed by now, so only live ones survive.
    openDescriptors: async () => (await nodeFs.readdir("/dev/fd")).map(Number).filter((descriptor) => {
      if (!Number.isSafeInteger(descriptor)) return false;
      try {
        fstatSync(descriptor);
        return true;
      } catch {
        return false;
      }
    }),
    fstat: async (descriptor) => ({ isFIFO: (await fstatAsync(descriptor)).isFIFO() }),
    read: async (descriptor, maximumBytes) => {
      const buffer = Buffer.alloc(maximumBytes);
      const { bytesRead } = await readAsync(descriptor, buffer, 0, maximumBytes, null);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    },
    close: (descriptor) => closeAsync(descriptor),
  });
}

function scratchPort(context: CliContext): UpdateScratchV1 {
  let store: Promise<ReleasePlanningScratchStore> | null = null;
  const bound = (): Promise<ReleasePlanningScratchStore> => {
    store ??= (async () => {
      const lifecycle = lifecycleOf(context);
      return new ReleasePlanningScratchStore({
        fs: lifecycle.fs,
        systemTemp: parseCanonicalAbsolutePathText(await nodeFs.realpath(tmpdir())),
        effectiveUid: lifecycle.effectiveUid,
        uuid: randomUUID,
        clock: () => lifecycle.clock(),
      });
    })();
    return store;
  };
  return {
    create: async (request) => (await bound()).create(request),
    listRecoverableAttempts: async () => (await bound()).listRecoverableAttempts(),
    recoverCleanup: async (id) => (await bound()).recoverCleanup(id),
  };
}

/** The user-bound redactor, patterns included: any finding in a frame refuses. */
async function runPlanner(context: CliContext, request: TargetPlannerRunRequestV1): Promise<TargetPlannerRunResultV1> {
  const key = readRedactionKey(context.paths.stateDir)
    ?? refuse("update_redaction_key_absent", EXIT_CODES.recoveryRequired, [context.paths.stateDir], "developer-os doctor");
  const config = await readConfigFile(context, context.paths.configFile);
  const supervisor = new TargetPlannerSupervisor({
    spawn: spawnNodePlannerChild,
    now: () => performance.now(),
    setTimer,
    sample: sampleNodePlannerProcess,
    redactor: createRedactor(key, { userPatterns: config?.redaction?.patterns ?? [] }),
  });
  return supervisor.run(request);
}

async function observeCapacity(context: CliContext): Promise<UpdateCapacityObservationV1> {
  const stats = await nodeFs.statfs(context.paths.home, { bigint: true });
  return {
    availableBytes: parseUInt64Decimal((stats.bavail * stats.bsize).toString(10)),
    availableEntries: parseUInt64Decimal(stats.ffree.toString(10)),
    reservationGranularityBytes: parseUInt64Decimal(stats.bsize.toString(10)),
  };
}

export function createCliUpdateContext(context: CliContext): CliUpdateContext {
  return {
    productHome: parseCanonicalAbsolutePathText(context.paths.home),
    pathEvidence: createCanonicalPathEvidence(),
    clock: () => lifecycleOf(context).clock(),
    readHome: () => readHome(context),
    readOfflineTrust,
    createTransport: (trust) => new FixedReleaseTransport({ trust, exchange: nodeReleaseExchange, now: () => performance.now(), setTimer }),
    scratch: scratchPort(context),
    snapshot: (home, releases) => snapshot(context, home, releases),
    planner: { run: (request) => runPlanner(context, request) },
    readRollbackEvidence: (_home, record) => readRollbackEvidence(context, record),
    capacity: () => observeCapacity(context),
    admitManifest: (value) => validateManifestV2(value, gateManifestAdmission(context)),
  };
}
