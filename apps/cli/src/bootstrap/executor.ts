import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  admitBootstrapFoundationInitialJournal,
  bootstrapExternalShapeHash,
  bootstrapPayloadSourceIdentityHash,
  decodeCanonicalJson,
  deriveBootstrapCreationEvidencePaths,
  deriveBootstrapEnvelopePaths,
  deriveBootstrapPayloadEvidencePaths,
  deriveBootstrapRetentionLocations,
  deriveBootstrapRetentionTable,
  encodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  serializeConfig,
  selectBootstrapJournal,
  validateBootstrapExternalShapeProjection,
  validateBootstrapJournal,
  validateBootstrapPlan,
  validateManifestStatePlan,
  validateManifestV2,
  validateJournal,
} from "@developer-os/core";
import type {
  BootstrapExpectedPayloadRefV1,
  BootstrapExternalShapeProjectionV1,
  BootstrapPlanAdmissionContextV1,
  BootstrapPayloadEvidenceV1,
  BootstrapPayloadPlanV1,
  BootstrapPayloadSourceV1,
  BootstrapRetentionEvidenceProjectionV1,
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  CreatedPathEvidenceV1,
  DeveloperOsConfigV1,
  FoundationMutationRefV1,
  FoundationParticipantRefV2,
  FreshV2InitIdV1,
  FreshV2InitJournalV1,
  FreshV2InitPlanV1,
  InstallationManifestV2,
  LowerHexSha256,
  ManifestAdmissionContextV1,
  ManifestStatePlanAdmissionContextV1,
  ManifestStatePlanV1,
  PlannedCreatedPathV1,
  RuntimePaths,
  TransactionExecutor,
  TransactionLockHandle,
  TransactionLockProvider,
  UInt64DecimalV1,
} from "@developer-os/core";
import type { RenameNoReplace, RenameSameParentNoReplace } from "@developer-os/platform-macos";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "./admission.js";
import { BootstrapJournalStore } from "./journal-store.js";
import {
  BootstrapRetainer,
  projectBootstrapRetentionPostimage,
  retainBootstrapEnvelope,
} from "./retention.js";
import { createBootstrapEvidenceInspectionRequest } from "./context.js";
import {
  admitBootstrapEvidencePlan,
  assertCombinedBootstrapCapacity,
  buildBootstrapRetentionEvidence,
  inspectBootstrapEvidenceAdmission,
} from "./report.js";
import type { BootstrapEvidenceAdmissionV1, BootstrapEvidenceReportV1 } from "./report.js";

import { BRAIN_TEMPLATE, BRAIN_TEMPLATE_DIRECTORIES } from "../commands/brain-template.js";
import {
  OUTPUT_SCHEMAS,
  outputSchemaFileName,
} from "../commands/output-schemas.js";
import type {
  AdmittedPackagedReleaseFileV1,
  AdmittedPackagedReleaseV1,
  PackagedReleaseSourceV1,
} from "../update/packaged-release.js";
import { inspectPackagedRelease } from "../update/packaged-release.js";

const encoder = new TextEncoder();
const EMPTY_HASH = hashBytes(new Uint8Array()) as LowerHexSha256;
const MAX_PLAN_BYTES = 268_435_456;
const MAX_JOURNAL_BYTES = 1_048_576;

export const freshInitDeathPoints = [
  { name: "after_plan" },
  { name: "after_journal" },
  { name: "after_first_payload" },
  { name: "after_payloads" },
  { name: "after_global_lock" },
  { name: "after_created_paths" },
  { name: "after_foundation" },
  { name: "after_trust" },
  { name: "after_active" },
  { name: "after_manifest_preserve" },
  { name: "after_manifest_publish" },
  { name: "after_verify" },
  { name: "during_retention" },
] as const;

export const freshInitFineGrainedDeathPoints = [
  { name: "after_slot_0_create" },
  { name: "after_slot_0_sync" },
  { name: "after_slot_1_create" },
  { name: "after_slot_1_sync" },
  { name: "during_plan_write" },
  { name: "after_plan_sync" },
  { name: "before_initial_slot_write" },
  { name: "during_initial_slot_write" },
  { name: "after_initial_slot_sync" },
  { name: "after_initial_state_sync" },
  { name: "during_inactive_slot_write" },
  { name: "after_inactive_slot_sync" },
  { name: "after_state_sync" },
  { name: "after_payload_create_intent" },
  { name: "after_payload_empty_create" },
  { name: "after_payload_writing_intent" },
  { name: "during_payload_write" },
  { name: "after_payload_file_sync" },
  { name: "after_payload_evidence" },
  { name: "before_payload_evidence_open" },
  { name: "before_creation_evidence_open" },
  { name: "after_global_lock_create" },
  { name: "before_global_lock_parent_sync" },
  { name: "after_global_lock_parent_sync" },
  { name: "after_creation_evidence" },
  { name: "after_directory_create" },
  { name: "before_directory_parent_sync" },
  { name: "after_directory_parent_sync" },
  { name: "before_forward_rename" },
  { name: "after_forward_rename" },
  { name: "before_rename" },
  { name: "after_rename" },
  { name: "after_projection" },
  { name: "before_parent_sync" },
  { name: "after_parent_sync" },
  { name: "before_journal_advance" },
  { name: "after_journal_advance" },
  { name: "before_lock_release" },
  { name: "after_lock_release" },
  { name: "after_rolled_back" },
] as const;

export type FreshInitDeathPointV1 =
  | (typeof freshInitDeathPoints)[number]["name"]
  | (typeof freshInitFineGrainedDeathPoints)[number]["name"];
export interface FreshInitRequestV1 {
  readonly config: DeveloperOsConfigV1;
  readonly brainPath: string;
}

export interface FreshInitPreviewV1 {
  readonly schemaVersion: 2;
  readonly productHome: string;
  readonly brainPath: string;
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
}

export interface FreshInitOutcomeV1 extends FreshInitPreviewV1 {
  readonly manifest: InstallationManifestV2;
  readonly transactionId: string;
}

export interface BootstrapExecutorDependencies {
  readonly paths: RuntimePaths;
  readonly userHome: string;
  readonly packagedRelease: PackagedReleaseSourceV1;
  readonly transactionExecutor: TransactionExecutor;
  readonly lockProvider: TransactionLockProvider;
  readonly renameNoReplace: RenameNoReplace;
  readonly renameSameParentNoReplace: RenameSameParentNoReplace;
  readonly now: () => Date;
  readonly uuid?: () => string;
  readonly nonce?: () => Uint8Array;
  readonly trace?: (event: string) => void;
  readonly interrupt?: (point: FreshInitDeathPointV1) => void;
  readonly fail?: (point: FreshInitDeathPointV1) => void;
  readonly inspectEvidence?: (() => Promise<BootstrapEvidenceAdmissionV1>) | undefined;
}

class FreshBootstrapError extends Error {
  constructor(
    readonly code: typeof EXIT_CODES.recoveryRequired | typeof EXIT_CODES.securityRefusal | typeof EXIT_CODES.invalidInput,
    message: string,
  ) {
    super(message);
    this.name = "FreshBootstrapError";
  }
}

class FreshBootstrapInterruption extends FreshBootstrapError {
  constructor(point: FreshInitDeathPointV1) {
    super(EXIT_CODES.recoveryRequired, `synthetic bootstrap interruption at ${point}`);
    this.name = "FreshBootstrapInterruption";
  }
}

interface HeldLifecycleLocks {
  bootstrap: { readonly handle: TransactionLockHandle; readonly dev: string; readonly ino: string } | null;
  global: { readonly handle: TransactionLockHandle; readonly dev: string; readonly ino: string } | null;
}

interface PlanIdentityStats {
  readonly dev: string | number | bigint;
  readonly ino: string | number | bigint;
}

function lowerHash(bytes: Uint8Array | string): LowerHexSha256 {
  return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256;
}

function canonicalHash(domain: string, value: unknown): LowerHexSha256 {
  return createHash("sha256")
    .update(domain)
    .update(encodeCanonicalJson(value as CanonicalJsonValue).slice(0, -1))
    .digest("hex") as LowerHexSha256;
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return encodeCanonicalJson(left as CanonicalJsonValue) ===
      encodeCanonicalJson(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function retainedChildNames(root: string, paths: readonly string[]): readonly string[] {
  const prefix = `${root}/`;
  return [...new Set(paths.flatMap((path) => {
    if (!path.startsWith(prefix)) return [];
    const child = path.slice(prefix.length).split("/")[0];
    return child === undefined || child.length === 0 ? [] : [child];
  }))];
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "ENOTDIR")
  );
}

async function lstatOptional(path: string): Promise<Stats | null> {
  try {
    return await nodeFs.lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function uid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function mode(stats: Stats): number {
  return stats.mode & 0o777;
}

function pathHash(path: string): LowerHexSha256 {
  return lowerHash(path);
}

async function syncDirectory(path: string): Promise<void> {
  const before = await nodeFs.lstat(path);
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== uid()) {
    throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `bootstrap parent changed shape: ${path}`);
  }
  const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `bootstrap parent changed identity: ${path}`);
    }
    await handle.sync();
    const fresh = await nodeFs.lstat(path);
    if (fresh.dev !== before.dev || fresh.ino !== before.ino) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `bootstrap parent changed during sync: ${path}`);
    }
  } finally {
    await handle.close();
  }
}

function matchesGlobalLockCreationEvidence(
  path: string,
  evidence: CreatedPathEvidenceV1,
  identity: { readonly dev: string; readonly ino: string },
): boolean {
  return evidence.kind === "global_lock" &&
    evidence.pathHash === pathHash(path) &&
    evidence.dev === identity.dev &&
    evidence.ino === identity.ino &&
    evidence.postimageHash === EMPTY_HASH;
}

async function durableWriteNoReplace(path: string, bytes: Uint8Array, fileMode = 0o600): Promise<void> {
  const handle = await nodeFs.open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    fileMode,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  await handle.close();
  await syncDirectory(dirname(path));
}

function derivedPayloadBytes(source: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>): Uint8Array {
  switch (source.role) {
    case "foundation_config":
      return encoder.encode(serializeConfig(source.value as unknown as DeveloperOsConfigV1));
    case "foundation_staged_digest":
    case "lifecycle_nonce":
      if (typeof source.value !== "string") {
        throw new FreshBootstrapError(
          EXIT_CODES.securityRefusal,
          "bootstrap scalar payload is not a retained string",
        );
      }
      return encoder.encode(`${source.value}\n`);
    case "foundation_initial_journal":
      return encoder.encode(`${JSON.stringify(source.value)}\n`);
    default:
      return encoder.encode(encodeCanonicalJson(source.value));
  }
}

function plannedSource(
  role: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>["role"],
  value: CanonicalJsonValue,
): { readonly source: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>; readonly bytes: Uint8Array } {
  const provisional = {
    kind: "plan_derived" as const,
    role,
    value,
    valueBytes: 1,
    projectionHash: canonicalHash(
      `developer-os/bootstrap-plan-derived/${role}/v1\0`,
      { role, value },
    ),
  };
  const bytes = derivedPayloadBytes(provisional);
  return {
    source: { ...provisional, valueBytes: bytes.byteLength - 1 },
    bytes,
  };
}

function packageSource(
  packaged: AdmittedPackagedReleaseV1,
  file: AdmittedPackagedReleaseFileV1,
): Extract<BootstrapPayloadSourceV1, { kind: "guarded_package_file" }> {
  return {
    kind: "guarded_package_file",
    packageRoot: packaged.packageRoot as CanonicalAbsolutePathV1,
    packageRootDev: packaged.packageRootDev,
    packageRootIno: packaged.packageRootIno,
    packageInventoryHash: packaged.packageInventoryHash,
    relativePath: file.relativePath,
    sourceBytes: file.bytes,
    sourceHash: file.sha256,
    sourceMode: file.mode,
    sourceDev: file.dev,
    sourceIno: file.ino,
  } as unknown as Extract<BootstrapPayloadSourceV1, { kind: "guarded_package_file" }>;
}

function requiredPackageFile(
  packaged: AdmittedPackagedReleaseV1,
  relativePath: string,
): AdmittedPackagedReleaseFileV1 {
  const file = packaged.files.find((candidate) => candidate.relativePath === relativePath);
  if (file === undefined) {
    throw new FreshBootstrapError(
      EXIT_CODES.securityRefusal,
      `root-verified package is missing ${relativePath}`,
    );
  }
  return file;
}

function parentCreated(scope: "ordinary" | "launchability", ordinal: number) {
  return { kind: "created_path" as const, scope, ordinal };
}

export class BootstrapExecutor {
  readonly #dependencies: BootstrapExecutorDependencies;
  readonly #heldLocks = new Map<string, HeldLifecycleLocks>();
  readonly #journalStores = new Map<string, BootstrapJournalStore>();
  readonly #retentionEvidence = new Map<string, BootstrapRetentionEvidenceProjectionV1>();
  readonly #preflightEvidence = new Map<string, BootstrapEvidenceAdmissionV1>();
  readonly #preflightReusableDirectories = new Map<string, readonly string[]>();

  constructor(dependencies: BootstrapExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  private trace(event: string): void {
    this.#dependencies.trace?.(event);
  }

  private inspectEvidence(): Promise<BootstrapEvidenceAdmissionV1> {
    return this.#dependencies.inspectEvidence?.() ?? inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: this.#dependencies.paths.home,
        stateDirectory: this.#dependencies.paths.stateDir,
        initialRoots: [
          this.#dependencies.paths.home,
          this.#dependencies.paths.stateDir,
          this.#dependencies.userHome,
        ],
      }),
    );
  }

  private interrupt(point: FreshInitDeathPointV1): void {
    try {
      this.#dependencies.interrupt?.(point);
    } catch (error) {
      if (error instanceof FreshBootstrapInterruption) throw error;
      throw new FreshBootstrapInterruption(point);
    }
  }

  private checkpoint(point: FreshInitDeathPointV1): void {
    this.interrupt(point);
    this.#dependencies.fail?.(point);
  }

  private async acquireLifecycleLock(path: string): Promise<{
    readonly handle: TransactionLockHandle;
    readonly dev: string;
    readonly ino: string;
  }> {
    let handle: TransactionLockHandle;
    try {
      const candidate: unknown = await this.#dependencies.lockProvider.acquire(path);
      if (typeof candidate !== "object" || candidate === null || !("release" in candidate) || typeof candidate.release !== "function") {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "a lifecycle lock handle is invalid");
      }
      handle = candidate as TransactionLockHandle;
    } catch {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "a lifecycle bootstrap lock is unavailable");
    }
    try {
      const stats = await nodeFs.lstat(path);
      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.uid !== uid() ||
        stats.nlink !== 1 ||
        stats.size !== 0 ||
        mode(stats) !== 0o600
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "a held lifecycle lock changed shape");
      }
      return { handle, dev: String(stats.dev), ino: String(stats.ino) };
    } catch (error) {
      await handle.release().catch(() => undefined);
      throw error;
    }
  }

  private async acquireIdentityCheckedGlobalLock(
    plan: FreshV2InitPlanV1,
    planned: PlannedCreatedPathV1,
    stats: Stats,
    bootstrap: NonNullable<HeldLifecycleLocks["bootstrap"]>,
  ): Promise<void> {
    const global = await this.acquireLifecycleLock(planned.path);
    if (global.dev !== String(stats.dev) || global.ino !== String(stats.ino)) {
      await global.handle.release().catch(() => undefined);
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock changed during recovery acquisition");
    }
    this.#heldLocks.set(plan.id, { bootstrap, global });
    this.trace("lock:global");
  }

  private async releaseLifecycleLocks(id: string): Promise<void> {
    const held = this.#heldLocks.get(id);
    if (held === undefined) return;
    this.#heldLocks.delete(id);
    let failure: unknown;
    for (const lock of [held.global, held.bootstrap]) {
      if (lock === null) continue;
      try {
        await lock.handle.release();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "a lifecycle lock could not be released");
    }
  }

  private async ensureBootstrapLock(
    plan: FreshV2InitPlanV1,
    journal: FreshV2InitJournalV1 | null,
  ): Promise<void> {
    const retained = this.#heldLocks.get(plan.id);
    if (retained?.bootstrap !== null && retained?.bootstrap !== undefined) return;
    let lockPath = plan.bootstrapIdentity.path;
    let existed = await lstatOptional(lockPath);
    if (existed === null && journal?.phase === "retaining") {
      const terminal = this.terminalJournal(journal);
      const location = terminal === null
        ? undefined
        : deriveBootstrapRetentionLocations(plan, terminal).find((candidate) =>
            candidate.role === "bootstrap_lock",
          );
      if (location !== undefined) {
        lockPath = location.tombstonePath;
        existed = await lstatOptional(lockPath);
      }
    }
    if (existed === null) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap lock identity disappeared during recovery");
    }
    const bootstrap = await this.acquireLifecycleLock(lockPath);
    if (
      (bootstrap.dev !== plan.bootstrapIdentity.dev ||
        bootstrap.ino !== plan.bootstrapIdentity.ino)
    ) {
      await bootstrap.handle.release().catch(() => undefined);
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap lock identity changed during recovery");
    }
    this.#heldLocks.set(plan.id, { bootstrap, global: retained?.global ?? null });
    this.trace("lock:bootstrap");
  }

  private async readCreationEvidence(
    plan: FreshV2InitPlanV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ): Promise<CreatedPathEvidenceV1> {
    const path = deriveBootstrapCreationEvidencePaths(
      this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      "fresh_v2_init",
      plan.id,
      scope,
      ordinal,
      randomUUID(),
    ).evidence;
    const bytes = await this.guardReadOwnedFile(
      path,
      1024,
      [1],
      "before_creation_evidence_open",
    );
    return decodeCanonicalJson(bytes, 1024) as unknown as CreatedPathEvidenceV1;
  }

  private async ensureGlobalLock(plan: FreshV2InitPlanV1): Promise<void> {
    const retained = this.#heldLocks.get(plan.id);
    if (retained?.global !== null && retained?.global !== undefined) return;
    const planned = plan.createdPaths[0];
    if (planned?.kind !== "global_lock") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock is not ordinal zero");
    }
    const global = await this.acquireLifecycleLock(planned.path);
    const retainedEvidence = this.#retentionEvidence.get(plan.id)?.createdPathEvidence.find((candidate) =>
      candidate.value.scope === "ordinary" && candidate.value.ordinal === 0,
    )?.value;
    const evidence = retainedEvidence ?? await this.readCreationEvidence(plan, "ordinary", 0).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
      return null;
    });
    if (evidence === null) {
      await global.handle.release().catch(() => undefined);
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock creation evidence disappeared");
    }
    if (!matchesGlobalLockCreationEvidence(planned.path, evidence, global)) {
      await global.handle.release().catch(() => undefined);
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock no longer matches creation evidence");
    }
    this.#heldLocks.set(plan.id, { bootstrap: retained?.bootstrap ?? null, global });
    this.trace("lock:global");
  }

  private async acquireTerminalGlobalLock(plan: FreshV2InitPlanV1): Promise<void> {
    const retained = this.#heldLocks.get(plan.id);
    if (retained?.global !== null && retained?.global !== undefined) return;
    const planned = plan.createdPaths[0];
    if (planned?.kind !== "global_lock") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal global lock is not ordinal zero");
    }
    const stats = await nodeFs.lstat(planned.path);
    if (
      !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() ||
      stats.nlink !== 1 || stats.size !== 0 || mode(stats) !== 0o600
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "terminal global lock changed shape");
    }
    const global = await this.acquireLifecycleLock(planned.path);
    if (global.dev !== String(stats.dev) || global.ino !== String(stats.ino)) {
      await global.handle.release().catch(() => undefined);
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "terminal global lock changed identity");
    }
    this.#heldLocks.set(plan.id, { bootstrap: retained?.bootstrap ?? null, global });
    this.trace("lock:global");
  }

  async previewFreshInit(
    request: FreshInitRequestV1,
    evidence: BootstrapEvidenceAdmissionV1,
  ): Promise<FreshInitPreviewV1> {
    const existing = evidence.active?.plan ?? null;
    if (existing !== null) {
        const source = existing.payloads
          .map((row) => row.source)
          .find((candidate) => candidate.kind === "plan_derived" && candidate.role === "manifest_after");
        if (source?.kind !== "plan_derived") {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan has no retained manifest preview");
        }
        const manifest = source.value as unknown as InstallationManifestV2;
        const retainedRequest = this.requestFromPlan(existing);
        return {
          schemaVersion: 2,
          productHome: this.#dependencies.paths.home,
          brainPath: retainedRequest.brainPath,
          created: manifest.artifacts.map((artifact) => artifact.path),
          unchanged: [],
        };
    }
    const packaged = await inspectPackagedRelease(this.#dependencies.packagedRelease);
    return this.previewNewFreshInit(request, packaged);
  }

  private async previewNewFreshInit(
    request: FreshInitRequestV1,
    packaged: AdmittedPackagedReleaseV1,
  ): Promise<FreshInitPreviewV1> {
    const brain = await lstatOptional(request.brainPath);
    if (brain !== null && (!brain.isDirectory() || brain.isSymbolicLink())) {
      throw new FreshBootstrapError(EXIT_CODES.invalidInput, "the Brain path is not a directory");
    }
    const created = this.previewPaths(request, packaged, brain === null);
    return {
      schemaVersion: 2,
      productHome: this.#dependencies.paths.home,
      brainPath: request.brainPath,
      created,
      unchanged: brain === null ? [] : [request.brainPath],
    };
  }

  async initializeFresh(
    request: FreshInitRequestV1,
    evidence: BootstrapEvidenceAdmissionV1,
  ): Promise<FreshInitOutcomeV1> {
    const existing = evidence.active?.plan ?? null;
    if (existing !== null) return this.executeFreshInit(existing);
    const plan = await this.planFreshInit(request, evidence);
    return this.executeFreshInit(plan);
  }

  private initialJournalForTimestamp(
    plan: FreshV2InitPlanV1,
    timestamp: FreshV2InitJournalV1["createdAt"],
  ): FreshV2InitJournalV1 {
    return validateBootstrapJournal(plan, {
      schemaVersion: 1,
      id: plan.id,
      planHash: lowerHash(encodeCanonicalJson(plan as unknown as CanonicalJsonValue)),
      slot: 0,
      sequence: "0",
      previousJournalHash: null,
      phase: "planned",
      direction: "forward",
      nextPayload: 0,
      payloadWriteState: { state: "idle" },
      nextCreatedPath: 0,
      nextFoundationParticipant: 0,
      nextLaunchabilityPath: 0,
      manifestCursor: 0,
      compensationNext: null,
      payloadRetentionPart: null,
      terminalOutcome: null,
      retentionNext: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }) as FreshV2InitJournalV1;
  }

  private emptyRetentionEvidence(
    id: FreshV2InitIdV1,
  ): BootstrapRetentionEvidenceProjectionV1 {
    return {
      bootstrapId: id,
      terminalJournal: null,
      payloadEvidence: [],
      interruptedPayload: null,
      createdPathEvidence: [],
      foundationEvidence: [],
      directoryTrees: [],
      rows: [],
    };
  }

  private terminalJournal(
    current: FreshV2InitJournalV1,
  ): FreshV2InitJournalV1 | null {
    if (current.phase === "finalized" || current.phase === "rolled_back") return current;
    if (
      (current.phase !== "retaining" && current.phase !== "retained") ||
      current.retentionNext === null ||
      current.terminalOutcome === null ||
      current.retentionTerminalPreimage === undefined
    ) return null;
    const terminalSequence = BigInt(current.sequence) - BigInt(current.retentionNext) - 1n;
    if (terminalSequence < 1n) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "retention lost its terminal journal sequence");
    }
    const { retentionTerminalPreimage, ...terminalPrefix } = current;
    return {
      ...terminalPrefix,
      slot: Number(terminalSequence % 2n) as 0 | 1,
      sequence: terminalSequence.toString() as UInt64DecimalV1,
      previousJournalHash: retentionTerminalPreimage.previousJournalHash,
      phase: current.terminalOutcome === "finalized" ? "finalized" : "rolled_back",
      retentionNext: null,
      updatedAt: retentionTerminalPreimage.updatedAt,
    };
  }

  private async preliminaryJournal(
    plan: FreshV2InitPlanV1,
  ): Promise<{
    readonly current: FreshV2InitJournalV1;
    readonly candidates: readonly FreshV2InitJournalV1[];
  } | null> {
    const candidates: FreshV2InitJournalV1[] = [];
    for (const slot of plan.journalSlots) {
      const before = await nodeFs.lstat(slot.path);
      if (
        !before.isFile() || before.isSymbolicLink() || before.uid !== uid() ||
        before.nlink !== slot.nlink || mode(before) !== slot.mode ||
        String(before.dev) !== slot.dev || String(before.ino) !== slot.ino
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap journal slot changed identity");
      }
      const bytes = await this.guardReadOwnedFile(slot.path, plan.maximumJournalBytes, [slot.nlink]);
      const after = await nodeFs.lstat(slot.path);
      if (String(after.dev) !== slot.dev || String(after.ino) !== slot.ino) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap journal slot changed during preliminary read");
      }
      if (bytes.byteLength === 0) continue;
      try {
        candidates.push(validateBootstrapJournal(
          plan,
          decodeCanonicalJson(bytes, plan.maximumJournalBytes),
        ) as FreshV2InitJournalV1);
      } catch {
        // The store alone classifies a partial initial write after its exact
        // plan/state/slot authority is reopened and rechecked.
      }
    }
    candidates.sort((left, right) =>
      BigInt(left.sequence) < BigInt(right.sequence) ? 1 : -1,
    );
    const current = candidates[0];
    return current === undefined ? null : { current, candidates };
  }

  private async storeFor(plan: FreshV2InitPlanV1): Promise<BootstrapJournalStore> {
    const retained = this.#journalStores.get(plan.id);
    if (retained !== undefined) return retained;
    const preliminary = await this.preliminaryJournal(plan);
    if (preliminary === null) {
      await this.ensureBootstrapLock(plan, null);
    } else {
      const terminal = this.terminalJournal(preliminary.current);
      if (terminal !== null) {
        this.#retentionEvidence.set(plan.id, await this.buildRetentionEvidence(plan, terminal));
      }
    }
    const store = await BootstrapJournalStore.open({
      planPath: plan.planPath,
      expectedOperation: "fresh_v2_init",
      expectedId: plan.id,
      validatePlan: (value) => this.admitPersistedPlanStructure(value, plan.id),
      validateSlots: (candidate, slots) => selectBootstrapJournal(
        candidate,
        this.#retentionEvidence.get(plan.id) ?? this.emptyRetentionEvidence(plan.id),
        slots,
      ),
      buildInitialJournal: (candidate, timestamp) =>
        this.initialJournalForTimestamp(candidate as FreshV2InitPlanV1, timestamp),
      admitInitialWrite: (candidate) =>
        this.admitPostPlanInitialWrite(candidate as FreshV2InitPlanV1),
      now: this.#dependencies.now,
      interrupt: (point) => {
        this.checkpoint(point);
      },
    });
    this.#journalStores.set(plan.id, store);
    return store;
  }
  private async inspectExactPreIntentShape(
    bootstrapLock: string,
    held: { readonly dev: string; readonly ino: string },
    admitted: BootstrapEvidenceAdmissionV1,
    reusableDirectories: readonly string[],
  ): Promise<{
    readonly homeStats: Stats;
    readonly stateStats: Stats;
    readonly lockStats: Stats;
  }> {
    const paths = this.#dependencies.paths;
    const retainedHomeNames = retainedChildNames(paths.home, [
      ...admitted.retainedPaths,
      ...reusableDirectories,
    ]);
    const retainedStateNames = retainedChildNames(paths.stateDir, [
      ...admitted.retainedPaths,
      ...reusableDirectories,
    ]);
    const [homeStats, stateStats, lockStats, homeNames, stateNames] = await Promise.all([
      nodeFs.lstat(paths.home),
      nodeFs.lstat(paths.stateDir),
      nodeFs.lstat(bootstrapLock),
      nodeFs.readdir(paths.home),
      nodeFs.readdir(paths.stateDir),
    ]);
    homeNames.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    stateNames.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const expectedHomeNames = [...new Set([basename(paths.stateDir), ...retainedHomeNames])]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const reusableGlobalLock = admitted.reusableGlobalLock;
    const reusableGlobalStats = reusableGlobalLock === null
      ? null
      : await lstatOptional(reusableGlobalLock.path);
    if (
      reusableGlobalLock !== null &&
      (reusableGlobalStats === null || !reusableGlobalStats.isFile() || reusableGlobalStats.isSymbolicLink() ||
        reusableGlobalStats.uid !== uid() || mode(reusableGlobalStats) !== 0o600 ||
        reusableGlobalStats.nlink !== 1 || reusableGlobalStats.size !== 0 ||
        String(reusableGlobalStats.dev) !== reusableGlobalLock.dev ||
        String(reusableGlobalStats.ino) !== reusableGlobalLock.ino)
    ) throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "retained global lock authority changed before publication");
    const reusableGlobalName = reusableGlobalLock === null ? [] : [basename(reusableGlobalLock.path)];
    const expectedStateNames = [...new Set([basename(bootstrapLock), ...reusableGlobalName, ...retainedStateNames])]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (
      !homeStats.isDirectory() || homeStats.isSymbolicLink() || homeStats.uid !== uid() || mode(homeStats) !== 0o700 ||
      !stateStats.isDirectory() || stateStats.isSymbolicLink() || stateStats.uid !== uid() || mode(stateStats) !== 0o700 ||
      !lockStats.isFile() || lockStats.isSymbolicLink() || lockStats.uid !== uid() || mode(lockStats) !== 0o600 ||
      lockStats.nlink !== 1 || lockStats.size !== 0 ||
      String(lockStats.dev) !== held.dev || String(lockStats.ino) !== held.ino ||
      !sameValue(homeNames, expectedHomeNames) ||
      !sameValue(stateNames, expectedStateNames)
    ) {
      throw new FreshBootstrapError(
        EXIT_CODES.securityRefusal,
        "fresh bootstrap second inventory is not the exact held pre-intent shape",
      );
    }
    return { homeStats, stateStats, lockStats };
  }

  private async admitPostPlanInitialWrite(plan: FreshV2InitPlanV1): Promise<void> {
    const paths = this.#dependencies.paths;
    const held = this.#heldLocks.get(plan.id)?.bootstrap;
    const plannedRows = [...plan.createdPaths, ...plan.launchabilityPaths];
    const parentIdentity = (path: string): { readonly dev: string; readonly ino: string } => {
      const matches = plannedRows
        .map((planned) => planned.parent)
        .filter((parent) => parent.kind === "preexisting" && parent.path === path);
      const first = matches[0];
      if (
        first?.kind !== "preexisting" ||
        matches.some((candidate) =>
          candidate.kind !== "preexisting" ||
          candidate.dev !== first.dev || candidate.ino !== first.ino)
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "post-plan inventory has no exact parent authority");
      }
      return { dev: first.dev, ino: first.ino };
    };
    const expectedHome = parentIdentity(paths.home);
    const expectedState = parentIdentity(paths.stateDir);
    /**
     * Read from the plan, not from this process's memory. The plan is written
     * before any mutation and its hash is chained into every journal slot, so
     * a process that resumes after a crash replays the same admitted set the
     * planning process observed under the lock.
     */
    const retainedHomeNames = retainedChildNames(paths.home, plan.admittedPreexistingPaths);
    const retainedStateNames = retainedChildNames(paths.stateDir, plan.admittedPreexistingPaths);
    const [homeStats, stateStats, lockStats, homeNames, stateNames] = await Promise.all([
      nodeFs.lstat(paths.home),
      nodeFs.lstat(paths.stateDir),
      nodeFs.lstat(plan.bootstrapIdentity.path),
      nodeFs.readdir(paths.home),
      nodeFs.readdir(paths.stateDir),
    ]);
    homeNames.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    stateNames.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const lifecycleLock = join(paths.stateDir, ".lifecycle.lock");
    const lifecycleLockStats = await lstatOptional(lifecycleLock);
    const lifecycleLockName = lifecycleLockStats === null ? [] : [basename(lifecycleLock)];
    if (
      lifecycleLockStats !== null &&
      (!lifecycleLockStats.isFile() || lifecycleLockStats.isSymbolicLink() ||
        lifecycleLockStats.uid !== uid() || mode(lifecycleLockStats) !== 0o600 ||
        lifecycleLockStats.nlink !== 1 || lifecycleLockStats.size !== 0)
    ) throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "lifecycle lock residue changed shape");
    const expectedStateNames = [...new Set([
      basename(plan.bootstrapIdentity.path),
      ...lifecycleLockName,
      basename(plan.planPath),
      ...plan.journalSlots.map((slot) => basename(slot.path)),
      ...retainedStateNames,
    ])].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const expectedHomeNames = [...new Set([basename(paths.stateDir), ...retainedHomeNames])]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (
      held === null || held === undefined ||
      !homeStats.isDirectory() || homeStats.isSymbolicLink() ||
      homeStats.uid !== uid() || mode(homeStats) !== 0o700 ||
      String(homeStats.dev) !== expectedHome.dev || String(homeStats.ino) !== expectedHome.ino ||
      !stateStats.isDirectory() || stateStats.isSymbolicLink() ||
      stateStats.uid !== uid() || mode(stateStats) !== 0o700 ||
      String(stateStats.dev) !== expectedState.dev || String(stateStats.ino) !== expectedState.ino ||
      !lockStats.isFile() || lockStats.isSymbolicLink() ||
      lockStats.uid !== uid() || mode(lockStats) !== 0o600 ||
      lockStats.nlink !== 1 || lockStats.size !== 0 ||
      String(lockStats.dev) !== plan.bootstrapIdentity.dev ||
      String(lockStats.ino) !== plan.bootstrapIdentity.ino ||
      held.dev !== plan.bootstrapIdentity.dev || held.ino !== plan.bootstrapIdentity.ino ||
      !sameValue(homeNames, expectedHomeNames) ||
      !sameValue(stateNames, expectedStateNames)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "post-plan inventory changed before initial journal write");
    }
  }

  /**
   * Pure worst-case projection for one new envelope. It deliberately builds
   * the same plan graph as publication, with fixed-width worst-case inode
   * identities and nonce bytes, before a UUID or product path is allocated.
   */
  private async projectFreshInitEnvelope(
    request: FreshInitRequestV1,
    packaged: AdmittedPackagedReleaseV1,
    preview: FreshInitPreviewV1,
    brainStats: Stats | null,
    reusableDirectories: ReadonlyMap<string, Stats>,
    retainedPaths: readonly CanonicalAbsolutePathV1[],
  ): Promise<BootstrapEvidenceReportV1["aggregate"]> {
    const maximumIdentity = "18446744073709551615";
    const id = "fi_00000000-0000-4000-8000-000000000000" as FreshV2InitIdV1;
    const projectedIdentity: PlanIdentityStats = { dev: maximumIdentity, ino: maximumIdentity };
    const externalShape = validateBootstrapExternalShapeProjection({
      entries: [
        {
          role: "product_home",
          pathHash: pathHash(this.#dependencies.paths.home),
          kind: "directory",
          ownerUid: uid(),
          mode: 0o700,
          nlink: 1,
          size: "0",
          dev: maximumIdentity,
          ino: maximumIdentity,
        },
        {
          role: "state_directory",
          pathHash: pathHash(this.#dependencies.paths.stateDir),
          kind: "directory",
          ownerUid: uid(),
          mode: 0o700,
          nlink: 1,
          size: "0",
          dev: maximumIdentity,
          ino: maximumIdentity,
        },
        {
          role: "bootstrap_lock",
          pathHash: pathHash(join(this.#dependencies.paths.stateDir, ".lifecycle-bootstrap.lock")),
          kind: "regular_file",
          ownerUid: uid(),
          mode: 0o600,
          nlink: 1,
          size: "0",
          dev: maximumIdentity,
          ino: maximumIdentity,
        },
      ],
    });
    const built = await this.buildPlan({
      id,
      request,
      packaged,
      preview,
      externalShape,
      homeStats: projectedIdentity,
      stateStats: projectedIdentity,
      lockStats: projectedIdentity,
      brainStats: brainStats === null ? null : projectedIdentity,
      preexistingDirectories: new Map(
        [...reusableDirectories.keys()].map((path) => [path, projectedIdentity]),
      ),
      retainedPaths,
      nonce: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as LowerHexSha256,
    });
    const plan = {
      ...built.plan,
      journalSlots: built.plan.journalSlots.map((slot) => ({
        ...slot,
        dev: maximumIdentity,
        ino: maximumIdentity,
      })) as unknown as FreshV2InitPlanV1["journalSlots"],
    };
    const planBytes = encoder.encode(encodeCanonicalJson(plan as unknown as CanonicalJsonValue)).byteLength;
    const payloadEvidenceBytes = plan.payloads.reduce((total, row) => total + encoder.encode(encodeCanonicalJson({
      schemaVersion: 1,
      bootstrapId: plan.id,
      ordinal: row.ref.ordinal,
      stagedPathHash: pathHash(row.ref.path),
      sourceIdentityHash: bootstrapPayloadSourceIdentityHash(row.source),
      bytes: row.ref.bytes,
      sha256: row.ref.hash,
      mode: row.ref.mode,
      dev: maximumIdentity,
      ino: maximumIdentity,
    })).byteLength, 0);
    const creationEvidenceBytes = ([
      ...plan.createdPaths.map((planned, ordinal) => ({ planned, ordinal, scope: "ordinary" as const })),
      ...plan.launchabilityPaths.map((planned, ordinal) => ({ planned, ordinal, scope: "launchability" as const })),
    ]).reduce((total, row) => total + encoder.encode(encodeCanonicalJson({
      schemaVersion: 1,
      bootstrapId: plan.id,
      scope: row.scope,
      ordinal: row.ordinal,
      pathHash: pathHash(row.planned.path),
      kind: row.planned.kind,
      dev: maximumIdentity,
      ino: maximumIdentity,
      postimageHash: row.planned.kind === "file"
        ? row.planned.payload.hash
        : row.planned.kind === "global_lock" ? EMPTY_HASH : null,
    })).byteLength, 0);
    const retentionEntries = plan.maximumStagingEntries + 3;
    const maximumSequence = (
      3 * plan.payloads.length +
      plan.createdPaths.length +
      plan.foundationParticipants.length +
      plan.launchabilityPaths.length +
      retentionEntries + 16
    ).toString();
    const timestamp = this.#dependencies.now().toISOString() as FreshV2InitJournalV1["createdAt"];
    const journalBytes = encoder.encode(encodeCanonicalJson({
      ...this.initialJournalForTimestamp(plan, timestamp),
      slot: Number(BigInt(maximumSequence) % 2n),
      sequence: maximumSequence,
      previousJournalHash: "f".repeat(64),
      phase: "retained",
      direction: "forward",
      nextPayload: plan.payloads.length,
      payloadWriteState: { state: "idle" },
      nextCreatedPath: plan.createdPaths.length,
      nextFoundationParticipant: plan.foundationParticipants.filter((participant) => participant.role.kind === "forward").length,
      nextLaunchabilityPath: plan.launchabilityPaths.length,
      manifestCursor: 3,
      compensationNext: null,
      payloadRetentionPart: null,
      terminalOutcome: "finalized",
      retentionNext: retentionEntries,
      retentionTerminalPreimage: {
        previousJournalHash: "f".repeat(64),
        updatedAt: timestamp,
      },
    })).byteLength;
    const payloadBytes = plan.payloads.reduce((total, row) => total + BigInt(row.ref.bytes), 0n);
    const regularFileBytes = BigInt(planBytes) + BigInt(2 * journalBytes) + payloadBytes +
      BigInt(payloadEvidenceBytes) + BigInt(creationEvidenceBytes);
    return {
      idCount: 1,
      entryCount: retentionEntries,
      regularFileBytes: regularFileBytes.toString() as UInt64DecimalV1,
    };
  }

  async projectFreshInitRetentionCapacity(
    request: FreshInitRequestV1,
  ): Promise<BootstrapEvidenceReportV1["aggregate"]> {
    const packaged = await inspectPackagedRelease(this.#dependencies.packagedRelease);
    const preview = await this.previewNewFreshInit(request, packaged);
    const brainStats = await lstatOptional(request.brainPath);
    const evidence = await this.inspectEvidence();
    const reusableDirectories = await this.inspectReusableFreshDirectories(evidence);
    return this.projectFreshInitEnvelope(
      request,
      packaged,
      preview,
      brainStats,
      reusableDirectories,
      evidence.retainedPaths,
    );
  }

  private reusableFreshDirectoryCandidates(): readonly string[] {
    const paths = this.#dependencies.paths;
    return [
      paths.backupsDir,
      paths.logsDir,
      join(paths.home, "schemas"),
      paths.stagingDir,
      join(paths.stagingDir, "fresh-v2-init"),
      join(paths.stagingDir, "transactions"),
      join(paths.stateDir, "transactions"),
      join(paths.stateDir, "lifecycle-journals"),
      join(paths.stateDir, "git-effect-journals"),
      join(paths.stateDir, "launchd-effect-journals"),
      join(paths.stateDir, "rollback"),
    ];
  }

  private async inspectReusableFreshDirectories(
    admitted: BootstrapEvidenceAdmissionV1,
  ): Promise<ReadonlyMap<string, Stats>> {
    const result = new Map<string, Stats>();
    for (const path of this.reusableFreshDirectoryCandidates()) {
      const stats = await lstatOptional(path);
      if (stats === null) continue;
      const allowed = path === this.#dependencies.paths.backupsDir || admitted.retainedPaths.some((retained) =>
        retained.startsWith(`${path}/`),
      );
      if (
        !allowed || !stats.isDirectory() || stats.isSymbolicLink() ||
        stats.uid !== uid() || mode(stats) !== 0o700
      ) {
        throw new FreshBootstrapError(
          EXIT_CODES.recoveryRequired,
          `product home contains an unbound reusable directory: ${path}`,
        );
      }
      result.set(path, stats);
    }
    return result;
  }

  private sameReusableDirectoryObservation(
    before: ReadonlyMap<string, Stats>,
    after: ReadonlyMap<string, Stats>,
  ): boolean {
    return sameValue(
      [...before].map(([path, stats]) => ({ path, dev: String(stats.dev), ino: String(stats.ino) })),
      [...after].map(([path, stats]) => ({ path, dev: String(stats.dev), ino: String(stats.ino) })),
    );
  }

  async planFreshInit(
    request: FreshInitRequestV1,
    evidence: BootstrapEvidenceAdmissionV1,
  ): Promise<FreshV2InitPlanV1> {
    const packaged = await inspectPackagedRelease(this.#dependencies.packagedRelease);
    const preview = await this.previewNewFreshInit(request, packaged);
    const brainObservation = await lstatOptional(request.brainPath);
    const evidenceBefore = evidence;
    if (evidenceBefore.blocksNewIntent) {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "retained bootstrap evidence requires manual archive before a new bootstrap intent",
      );
    }
    const reusableBefore = await this.inspectReusableFreshDirectories(evidenceBefore);
    const projectedEnvelope = await this.projectFreshInitEnvelope(
      request,
      packaged,
      preview,
      brainObservation,
      reusableBefore,
      evidenceBefore.retainedPaths,
    );
    try {
      assertCombinedBootstrapCapacity(evidenceBefore.report.aggregate, projectedEnvelope);
    } catch {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "retained bootstrap capacity would be exceeded; manual archive is required before retry",
      );
    }
    const paths = this.#dependencies.paths;
    const [preexistingBootstrapLock, preexistingGlobalLock] = await Promise.all([
      lstatOptional(join(paths.stateDir, ".lifecycle-bootstrap.lock")),
      lstatOptional(join(paths.stateDir, ".lifecycle.lock")),
    ]);
    const reusableGlobalLock = evidenceBefore.reusableGlobalLock;
    const exactReusableGlobalLock = preexistingGlobalLock !== null && reusableGlobalLock !== null &&
      preexistingGlobalLock.isFile() && !preexistingGlobalLock.isSymbolicLink() &&
      preexistingGlobalLock.uid === uid() && mode(preexistingGlobalLock) === 0o600 &&
      preexistingGlobalLock.nlink === 1 && preexistingGlobalLock.size === 0 &&
      String(preexistingGlobalLock.dev) === reusableGlobalLock.dev &&
      String(preexistingGlobalLock.ino) === reusableGlobalLock.ino;
    /**
     * Shape, not presence. Retention never unlinks, so a well-formed bootstrap
     * lock outlives every envelope it belonged to; refusing on its existence
     * made the first interrupted init permanent. Spec 2 blocks only *live*
     * residue, and liveness is what `acquireLifecycleLock` below decides.
     */
    const exactReusableBootstrapLock = preexistingBootstrapLock !== null &&
      preexistingBootstrapLock.isFile() && !preexistingBootstrapLock.isSymbolicLink() &&
      preexistingBootstrapLock.uid === uid() && mode(preexistingBootstrapLock) === 0o600 &&
      preexistingBootstrapLock.nlink === 1 && preexistingBootstrapLock.size === 0;
    if (
      (preexistingBootstrapLock !== null && !exactReusableBootstrapLock) ||
      (preexistingGlobalLock !== null && !exactReusableGlobalLock)
    ) {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "live lifecycle lock residue requires recovery before a new bootstrap intent",
      );
    }
    const uuid = (this.#dependencies.uuid ?? randomUUID)();
    const id = `fi_${uuid}` as FreshV2InitIdV1;
    this.#preflightEvidence.set(id, evidenceBefore);
    this.#preflightReusableDirectories.set(id, [...reusableBefore.keys()]);
    const homeBefore = await lstatOptional(paths.home);
    if (homeBefore !== null) {
      if (!homeBefore.isDirectory() || homeBefore.isSymbolicLink()) {
        throw new FreshBootstrapError(EXIT_CODES.invalidInput, "product home is not a directory");
      }
      const entries = await nodeFs.readdir(paths.home);
      const stateBefore = await lstatOptional(paths.stateDir);
      const stateNames = stateBefore === null ? [] : await nodeFs.readdir(paths.stateDir);
      const retainedHomeNames = retainedChildNames(paths.home, [
        ...evidenceBefore.retainedPaths,
        ...reusableBefore.keys(),
      ]);
      const retainedStateNames = retainedChildNames(paths.stateDir, [
        ...evidenceBefore.retainedPaths,
        ...reusableBefore.keys(),
      ]);
      const resumableSkeleton =
        entries.every((name) => name === "state" || retainedHomeNames.includes(name)) &&
        stateBefore !== null &&
        stateBefore.isDirectory() &&
        !stateBefore.isSymbolicLink() &&
        mode(stateBefore) === 0o700 &&
        stateNames.every((name) =>
          retainedStateNames.includes(name) ||
          (exactReusableGlobalLock && name === ".lifecycle.lock") ||
          (exactReusableBootstrapLock && name === ".lifecycle-bootstrap.lock")
        );
      if (entries.length !== 0 && !resumableSkeleton) {
        const unboundHome = entries.filter((name) => name !== "state" && !retainedHomeNames.includes(name)).length;
        const unboundState = stateNames.filter((name) =>
          !retainedStateNames.includes(name) &&
          !(exactReusableGlobalLock && name === ".lifecycle.lock") &&
          !(exactReusableBootstrapLock && name === ".lifecycle-bootstrap.lock")
        ).length;
        throw new FreshBootstrapError(
          EXIT_CODES.recoveryRequired,
          `product home is not a fresh installation (${String(unboundHome)} unbound home entries; ${String(unboundState)} unbound state entries)`,
        );
      }
    } else {
      await nodeFs.mkdir(paths.home, { mode: 0o700 });
      await syncDirectory(dirname(paths.home));
    }
    if (await lstatOptional(paths.stateDir) === null) {
      await nodeFs.mkdir(paths.stateDir, { mode: 0o700 });
      await syncDirectory(dirname(paths.stateDir));
    }
    const bootstrapLock = join(paths.stateDir, ".lifecycle-bootstrap.lock");
    const heldBootstrap = await this.acquireLifecycleLock(bootstrapLock);
    this.#heldLocks.set(id, { bootstrap: heldBootstrap, global: null });

    try {
      this.trace("lock:bootstrap");
      const { homeStats, stateStats, lockStats } = await this.inspectExactPreIntentShape(
        bootstrapLock,
        heldBootstrap,
        evidenceBefore,
        [...reusableBefore.keys()],
      );
      const externalShape = validateBootstrapExternalShapeProjection({
        entries: [
          this.externalShapeEntry("product_home", paths.home, homeStats),
          this.externalShapeEntry("state_directory", paths.stateDir, stateStats),
          this.externalShapeEntry("bootstrap_lock", bootstrapLock, lockStats),
        ],
      });
      this.trace("inventory:second");

      const envelope = deriveBootstrapEnvelopePaths(
        paths.home as CanonicalAbsolutePathV1,
        "fresh_v2_init",
        id,
      );
      let authorityPlan: FreshV2InitPlanV1 | null = null;
      const emptyEvidence = (): BootstrapRetentionEvidenceProjectionV1 => ({
        bootstrapId: id,
        terminalJournal: null,
        payloadEvidence: [],
        interruptedPayload: null,
        createdPathEvidence: [],
        foundationEvidence: [],
        directoryTrees: [],
        rows: [],
      });
      // Re-inspects rather than reusing evidenceBefore: this is the read that
      // must observe whatever changed on disk while the bootstrap lock was
      // being acquired above, which the fingerprint comparison below depends on.
      const evidenceAfterLock = await this.inspectEvidence();
      if (
        evidenceAfterLock.fingerprint !== evidenceBefore.fingerprint ||
        evidenceAfterLock.blocksNewIntent !== evidenceBefore.blocksNewIntent
      ) {
        throw new FreshBootstrapError(
          EXIT_CODES.securityRefusal,
          "retained bootstrap evidence changed between preflight and plan publication",
        );
      }
      const brainStats = await lstatOptional(request.brainPath);
      const reusableAfter = await this.inspectReusableFreshDirectories(evidenceAfterLock);
      const sameBrain = (brainObservation === null) === (brainStats === null) && (
        brainObservation === null || brainStats === null ||
        (brainObservation.dev === brainStats.dev && brainObservation.ino === brainStats.ino)
      );
      const projectedAfterLock = await this.projectFreshInitEnvelope(
        request,
        packaged,
        preview,
        brainStats,
        reusableAfter,
        evidenceAfterLock.retainedPaths,
      );
      if (
        !sameBrain || !this.sameReusableDirectoryObservation(reusableBefore, reusableAfter) ||
        !sameValue(projectedEnvelope, projectedAfterLock)
      ) {
        throw new FreshBootstrapError(
          EXIT_CODES.securityRefusal,
          "fresh bootstrap plan projection changed between preflight and publication",
        );
      }
      try {
        assertCombinedBootstrapCapacity(evidenceAfterLock.report.aggregate, projectedAfterLock);
      } catch {
        throw new FreshBootstrapError(
          EXIT_CODES.recoveryRequired,
          "retained bootstrap capacity changed; manual archive is required before retry",
        );
      }
      const built = await this.buildPlan({
        id,
        request,
        packaged,
        preview,
        externalShape,
        homeStats,
        stateStats,
        lockStats,
        brainStats,
        preexistingDirectories: reusableAfter,
        retainedPaths: evidenceAfterLock.retainedPaths,
        nonce: Buffer.from((this.#dependencies.nonce ?? (() => randomBytes(32)))()).toString("hex") as LowerHexSha256,
      });
      const store = await BootstrapJournalStore.create({
        stateDirectory: paths.stateDir as CanonicalAbsolutePathV1,
        slotPaths: envelope.journalSlots,
        planPath: envelope.plan,
        buildPlan: (slots) => {
          authorityPlan = { ...built.plan, journalSlots: slots };
          return authorityPlan;
        },
        buildInitialJournal: (candidate, timestamp) =>
          this.initialJournalForTimestamp(candidate as FreshV2InitPlanV1, timestamp),
        validatePlan: (value) => {
          if (authorityPlan === null) {
            throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap plan authority was not constructed");
          }
          return validateBootstrapPlan(
            value,
            this.planAdmission(authorityPlan, packaged, externalShape),
          );
        },
        validateSlots: (candidate, slots) =>
          selectBootstrapJournal(
            candidate,
            this.#retentionEvidence.get(id) ?? emptyEvidence(),
            slots,
          ),
        now: this.#dependencies.now,
        interrupt: (point) => {
          this.checkpoint(point);
          if (point === "after_plan_sync") this.checkpoint("after_plan");
          if (point === "after_initial_state_sync") this.checkpoint("after_journal");
        },
      });
      const admitted = store.plan as FreshV2InitPlanV1;
      this.#journalStores.set(id, store);
      this.#preflightEvidence.delete(id);
      this.#preflightReusableDirectories.delete(id);
      this.trace("intent:plan");
      this.trace("intent:journal");
      return admitted;
    } catch (error) {
      this.#preflightEvidence.delete(id);
      this.#preflightReusableDirectories.delete(id);
      await this.releaseLifecycleLocks(id).catch(() => undefined);
      throw error;
    }
  }

  async executeFreshInit(plan: FreshV2InitPlanV1): Promise<FreshInitOutcomeV1> {
    const store = await this.storeFor(plan);
    let journal = store.current() as FreshV2InitJournalV1;
    try {
      if (journal.phase === "retained") {
        if (journal.terminalOutcome !== "finalized") {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "the retained bootstrap rolled back");
        }
        return await this.completedOutcome(plan);
      }
      await this.ensureBootstrapLock(plan, journal);
      if (journal.nextCreatedPath > 0) await this.ensureGlobalLock(plan);
      if (journal.phase === "rolled_back" || journal.phase === "retaining") {
        await this.retainTerminal(plan, store, journal);
        if (journal.terminalOutcome === "rolled_back") {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "the retained bootstrap rolled back");
        }
        return await this.completedOutcome(plan);
      }
      const packaged = journal.nextPayload < plan.payloads.length
        ? await inspectPackagedRelease(this.#dependencies.packagedRelease)
        : null;
      try {
        journal = await this.stagePayloads(plan, journal, packaged);
        journal = await this.createOrdinary(plan, journal);
        journal = await this.applyFoundation(plan, journal);
        journal = await this.publishLaunchability(plan, journal);
        journal = await this.publishManifest(plan, journal);
        journal = await this.verify(plan, journal);
        await this.retainTerminal(plan, store, journal);
        return await this.completedOutcome(plan);
      } catch (error) {
        if (error instanceof FreshBootstrapInterruption) throw error;
        const latest = store.current() as FreshV2InitJournalV1;
        if (latest.manifestCursor < 2 && latest.terminalOutcome === null) {
          await this.compensate(plan, latest);
          await this.retainTerminal(
            plan,
            store,
            store.current() as FreshV2InitJournalV1,
          );
        }
        throw error;
      }
    } finally {
      const latest = this.#journalStores.get(plan.id)?.current() as FreshV2InitJournalV1 | undefined;
      if (latest?.phase !== "retained") {
        await this.releaseLifecycleLocks(plan.id).catch(() => undefined);
      }
    }
  }

  async recover(input: { readonly plan: FreshV2InitPlanV1 }): Promise<FreshInitOutcomeV1> {
    return this.executeFreshInit(input.plan);
  }

  async close(): Promise<void> {
    for (const id of [...this.#heldLocks.keys()]) {
      await this.releaseLifecycleLocks(id).catch(() => undefined);
    }
    const stores = [...this.#journalStores.values()];
    this.#journalStores.clear();
    this.#retentionEvidence.clear();
    this.#preflightEvidence.clear();
    this.#preflightReusableDirectories.clear();
    for (const store of stores) await store.close();
  }

  private async completedOutcome(plan: FreshV2InitPlanV1): Promise<FreshInitOutcomeV1> {
    const manifest = await this.readManifest(plan);
    const request = this.requestFromPlan(plan);
    const brainCreated = manifest.artifacts.some((artifact) => artifact.path === request.brainPath);
    return {
      schemaVersion: 2,
      productHome: this.#dependencies.paths.home,
      brainPath: request.brainPath,
      created: manifest.artifacts.map((artifact) => artifact.path),
      unchanged: brainCreated ? [] : [request.brainPath],
      manifest,
      transactionId: plan.foundationParticipants.find((participant) => participant.role.kind === "forward")?.id ?? plan.id,
    };
  }

  private previewPaths(
    request: FreshInitRequestV1,
    packaged: AdmittedPackagedReleaseV1,
    createBrain: boolean,
  ): readonly string[] {
    const paths = this.#dependencies.paths;
    const runtimeFiles = this.runtimeReservationPaths();
    const bundleBase = this.bundleDestination(packaged);
    const packageFiles = packaged.files
      .filter((file) => file.relativePath.startsWith(`${packaged.bundleRoot}/`))
      .map((file) => join(bundleBase, file.relativePath.slice(packaged.bundleRoot.length + 1)));
    const brainFiles = createBrain
      ? BRAIN_TEMPLATE.map((file) => join(request.brainPath, file.path))
      : [];
    return [...new Set([
      paths.home,
      paths.stateDir,
      paths.stagingDir,
      paths.backupsDir,
      paths.logsDir,
      join(paths.home, "schemas"),
      request.config.brainPath,
      request.config.brainPath === request.brainPath ? request.brainPath : request.config.brainPath,
      paths.configFile,
      ...OUTPUT_SCHEMAS.map((schema) => join(paths.home, "schemas", outputSchemaFileName(schema.verb))),
      ...brainFiles,
      ...packageFiles,
      ...runtimeFiles,
      join(paths.stateDir, "release-trust.json"),
      join(paths.stateDir, "active-release.json"),
      paths.manifestFile,
    ])].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  }

  private runtimeReservationPaths(): readonly string[] {
    const { stateDir, logsDir } = this.#dependencies.paths;
    const jobs = ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const;
    return [
      join(stateDir, ".lifecycle.lock"),
      join(stateDir, "lifecycle-install-nonce"),
      join(stateDir, "lifecycle-id-allocator.json"),
      join(stateDir, "git-sync.json"),
      join(stateDir, "uninstalling.json"),
      join(stateDir, "update-rollback.json"),
      join(stateDir, "update-executor.json"),
      ...jobs.flatMap((job) => [
        join(stateDir, `automation-${job}.json`),
        join(stateDir, `.automation-${job}.lock`),
        ...Array.from({ length: 10 }, (_, ordinal) =>
          join(logsDir, `automation-${job}.${String(ordinal)}.json`),
        ),
      ]),
    ];
  }

  private externalShapeEntry(
    role: "product_home" | "state_directory" | "bootstrap_lock",
    path: string,
    stats: Stats,
  ) {
    const expectedDirectory = role !== "bootstrap_lock";
    if (
      stats.uid !== uid() ||
      stats.isSymbolicLink() ||
      (expectedDirectory ? !stats.isDirectory() || mode(stats) !== 0o700 : !stats.isFile() || mode(stats) !== 0o600 || stats.nlink !== 1 || stats.size !== 0)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "fresh bootstrap prerequisite changed shape");
    }
    return {
      role,
      pathHash: pathHash(path),
      kind: expectedDirectory ? "directory" as const : "regular_file" as const,
      ownerUid: uid(),
      mode: expectedDirectory ? 0o700 as const : 0o600 as const,
      nlink: stats.nlink,
      size: String(stats.size),
      dev: String(stats.dev),
      ino: String(stats.ino),
    };
  }

  private bundleDestination(packaged: AdmittedPackagedReleaseV1): string {
    return join(
      this.#dependencies.paths.home,
      "releases",
      packaged.identity.version,
      `${packaged.identity.platform}-${packaged.identity.architecture}`,
    );
  }

  private async buildPlan(input: {
    readonly id: FreshV2InitIdV1;
    readonly request: FreshInitRequestV1;
    readonly packaged: AdmittedPackagedReleaseV1;
    readonly preview: FreshInitPreviewV1;
    readonly externalShape: BootstrapExternalShapeProjectionV1;
    readonly homeStats: PlanIdentityStats;
    readonly stateStats: PlanIdentityStats;
    readonly lockStats: PlanIdentityStats;
    readonly brainStats: PlanIdentityStats | null;
    readonly preexistingDirectories: ReadonlyMap<string, PlanIdentityStats>;
    readonly retainedPaths: readonly CanonicalAbsolutePathV1[];
    readonly nonce: LowerHexSha256;
  }): Promise<{ readonly plan: FreshV2InitPlanV1 }> {
    const paths = this.#dependencies.paths;
    const uuid = String(input.id).slice(3);
    const compensationId = `tx_fi_${uuid}_0000000000_c` as const;
    const forwardId = `tx_fi_${uuid}_0000000000_f` as const;
    const payloads: BootstrapPayloadPlanV1[] = [];
    const addPayload = (source: BootstrapPayloadSourceV1, bytes: Uint8Array): BootstrapExpectedPayloadRefV1 => {
      const ordinal = payloads.length;
      const ref: BootstrapExpectedPayloadRefV1 = {
        kind: "bootstrap_expected",
        bootstrapId: input.id,
        ordinal,
        path: join(paths.stateDir, `.fresh-v2-init.${input.id}.${String(ordinal).padStart(10, "0")}.payload`) as BootstrapExpectedPayloadRefV1["path"],
        hash: lowerHash(bytes),
        bytes: bytes.byteLength,
        mode: source.kind === "guarded_package_file" ? source.sourceMode : 0o600,
      };
      payloads.push({ ref, source });
      return ref;
    };
    const addDerived = (
      role: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>["role"],
      value: CanonicalJsonValue,
    ): BootstrapExpectedPayloadRefV1 => {
      const derived = plannedSource(role, value);
      return addPayload(derived.source, derived.bytes);
    };
    const addPackage = (relativePath: string): BootstrapExpectedPayloadRefV1 => {
      const file = requiredPackageFile(input.packaged, relativePath);
      const source = packageSource(input.packaged, file);
      const ordinal = payloads.length;
      const ref: BootstrapExpectedPayloadRefV1 = {
        kind: "bootstrap_expected",
        bootstrapId: input.id,
        ordinal,
        path: join(paths.stateDir, `.fresh-v2-init.${input.id}.${String(ordinal).padStart(10, "0")}.payload`) as BootstrapExpectedPayloadRefV1["path"],
        hash: file.sha256,
        bytes: file.bytes,
        mode: file.mode,
      };
      payloads.push({ ref, source });
      return ref;
    };

    const mutationSpecs: Array<{
      readonly targetPath: string;
      readonly source:
        | { readonly kind: "config"; readonly value: DeveloperOsConfigV1 }
        | { readonly kind: "package"; readonly relativePath: string };
    }> = [
      { targetPath: paths.configFile, source: { kind: "config" as const, value: input.request.config } },
      ...OUTPUT_SCHEMAS.map((schema) => ({
        targetPath: join(paths.home, "schemas", outputSchemaFileName(schema.verb)),
        source: { kind: "package" as const, relativePath: `templates/schemas/${outputSchemaFileName(schema.verb)}` },
      })),
      ...(input.brainStats === null
        ? BRAIN_TEMPLATE.map((file) => ({
            targetPath: join(input.request.brainPath, file.path),
            source: { kind: "package" as const, relativePath: `templates/brain/${file.path}` },
          }))
        : []),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.targetPath), Buffer.from(right.targetPath)));

    const forwardMutations: FoundationMutationRefV1[] = [];
    for (const [ordinal, spec] of mutationSpecs.entries()) {
      let content: BootstrapExpectedPayloadRefV1;
      if (spec.source.kind === "config") {
        content = addDerived("foundation_config", spec.source.value as unknown as CanonicalJsonValue);
      } else {
        content = addPackage(spec.source.relativePath);
      }
      const digest = addDerived("foundation_staged_digest", content.hash);
      forwardMutations.push({
        targetPath: spec.targetPath as CanonicalAbsolutePathV1,
        operation: "create",
        expectedBeforeHash: null,
        contentHash: content.hash,
        contentSize: content.bytes,
        stagedPath: join(paths.stagingDir, "transactions", forwardId, `${String(ordinal)}.bin`) as CanonicalAbsolutePathV1,
        content,
        digest,
      });
    }
    const compensationMutations: FoundationMutationRefV1[] = [...forwardMutations]
      .reverse()
      .map((mutation) => ({
        targetPath: mutation.targetPath,
        operation: "remove" as const,
        expectedBeforeHash: mutation.contentHash,
        contentHash: null,
        contentSize: null,
        stagedPath: null,
        content: null,
        digest: null,
      }));
    const createdAt = this.#dependencies.now().toISOString();
    const journalValue = (
      participantId: string,
      mutations: readonly FoundationMutationRefV1[],
    ): CanonicalJsonValue => ({
      schemaVersion: 1,
      id: participantId,
      kind: "fresh_init_artifacts",
      phase: "planned",
      createdAt,
      updatedAt: createdAt,
      mutations: mutations.map((mutation, ordinal) => ({
        targetPath: mutation.targetPath,
        operation: mutation.operation,
        expectedBeforeHash: mutation.expectedBeforeHash,
        stagedRelativePath: mutation.operation === "remove" ? null : `${String(ordinal)}.bin`,
      })),
    });
    const compensationJournal = addDerived(
      "foundation_initial_journal",
      journalValue(compensationId, compensationMutations),
    );
    const forwardJournal = addDerived(
      "foundation_initial_journal",
      journalValue(forwardId, forwardMutations),
    );
    const participant = (
      participantId: typeof compensationId | typeof forwardId,
      role: FoundationParticipantRefV2["role"],
      mutations: readonly FoundationMutationRefV1[],
      staged: BootstrapExpectedPayloadRefV1,
    ): FoundationParticipantRefV2 => {
      const base = {
        id: participantId,
        slot: "fresh_init_artifacts" as const,
        role,
        mutations,
        maximumJournalBytes: MAX_JOURNAL_BYTES,
        initialJournal: {
          finalPath: join(paths.stateDir, "transactions", `${participantId}.json`) as CanonicalAbsolutePathV1,
          plannedBytesHash: staged.hash,
          staged,
        },
      };
      const stagedProjection = {
        kind: staged.kind,
        bootstrapId: staged.bootstrapId,
        ordinal: staged.ordinal,
        path: staged.path,
        bytes: staged.bytes,
        mode: staged.mode,
      };
      return {
        ...base,
        planHash: canonicalHash("developer-os/foundation-participant-plan/v2\0", {
          schemaVersion: 2,
          id: base.id,
          slot: base.slot,
          role: base.role,
          mutations: base.mutations,
          maximumJournalBytes: base.maximumJournalBytes,
          initialJournal: { finalPath: base.initialJournal.finalPath, staged: stagedProjection },
        }),
      };
    };
    const compensation = participant(
      compensationId,
      { kind: "compensation", forwardId },
      compensationMutations,
      compensationJournal,
    );
    const forward = participant(
      forwardId,
      { kind: "forward", compensationId },
      forwardMutations,
      forwardJournal,
    );

    const nonce = input.nonce;
    const nonceRef = addDerived("lifecycle_nonce", nonce);
    const allocatorRef = addDerived("lifecycle_allocator", {
      schemaVersion: 1,
      installNonce: nonce,
      nextCounter: "0",
    });

    const fileRefs = new Map<string, BootstrapExpectedPayloadRefV1>();
    fileRefs.set(join(paths.stateDir, "lifecycle-install-nonce"), nonceRef);
    fileRefs.set(join(paths.stateDir, "lifecycle-id-allocator.json"), allocatorRef);
    for (const mutation of forwardMutations) {
      if (mutation.stagedPath !== null && mutation.content != null && mutation.digest != null) {
        fileRefs.set(mutation.stagedPath, mutation.content);
        fileRefs.set(`${mutation.stagedPath}.sha256`, mutation.digest);
      }
    }
    for (const reservation of this.runtimeReservationPaths().filter((path) =>
      path !== join(paths.stateDir, ".lifecycle.lock") &&
      path !== join(paths.stateDir, "lifecycle-install-nonce") &&
      path !== join(paths.stateDir, "lifecycle-id-allocator.json"))) {
      fileRefs.set(reservation, addPayload(
        { kind: "constant_empty", role: "empty_reservation" },
        new Uint8Array(),
      ));
    }

    const ordinaryDirectories = [
      paths.backupsDir,
      paths.logsDir,
      join(paths.home, "schemas"),
      paths.stagingDir,
      join(paths.stagingDir, "fresh-v2-init"),
      join(paths.stagingDir, "fresh-v2-init", input.id),
      join(paths.stagingDir, "transactions"),
      join(paths.stagingDir, "transactions", forwardId),
      join(paths.stateDir, "transactions"),
      join(paths.stateDir, "lifecycle-journals"),
      join(paths.stateDir, "git-effect-journals"),
      join(paths.stateDir, "launchd-effect-journals"),
      join(paths.stateDir, "rollback"),
      ...(input.brainStats === null
        ? [input.request.brainPath, ...BRAIN_TEMPLATE_DIRECTORIES.map((path) => join(input.request.brainPath, path))]
        : []),
    ];
    const rowSpecs = [
      ...ordinaryDirectories
        .filter((path) => !input.preexistingDirectories.has(path))
        .map((path) => ({ kind: "directory" as const, path })),
      ...[...fileRefs].map(([path, payload]) => ({ kind: "file" as const, path, payload })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const preexisting = new Map<string, PlanIdentityStats>([
      [paths.home, input.homeStats],
      [paths.stateDir, input.stateStats],
      ...(input.brainStats === null ? [] : [[input.request.brainPath, input.brainStats] as const]),
      ...input.preexistingDirectories,
      [this.#dependencies.userHome, await nodeFs.lstat(this.#dependencies.userHome)],
    ]);
    const ordinaryPathOrdinal = new Map(rowSpecs.map((row, ordinal) => [row.path, ordinal + 1] as const));
    const parentFor = (path: string) => {
      const parentPath = dirname(path);
      const createdOrdinal = ordinaryPathOrdinal.get(parentPath);
      if (createdOrdinal !== undefined) return parentCreated("ordinary", createdOrdinal);
      const stats = preexisting.get(parentPath);
      if (stats === undefined) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `unbound bootstrap parent ${parentPath}`);
      }
      return {
        kind: "preexisting" as const,
        path: parentPath as CanonicalAbsolutePathV1,
        dev: String(stats.dev) as Extract<PlannedCreatedPathV1["parent"], { kind: "preexisting" }>["dev"],
        ino: String(stats.ino) as Extract<PlannedCreatedPathV1["parent"], { kind: "preexisting" }>["ino"],
      };
    };
    const createdPaths: PlannedCreatedPathV1[] = [
      {
        kind: "global_lock",
        path: join(paths.stateDir, ".lifecycle.lock") as CanonicalAbsolutePathV1,
        expectedBefore: "absent",
        ownerUid: uid(),
        mode: 0o600,
        parent: parentFor(join(paths.stateDir, ".lifecycle.lock")),
        cleanup: "remove_on_compensation",
      },
      ...rowSpecs.map((row): PlannedCreatedPathV1 => row.kind === "directory"
        ? {
            kind: "directory",
            path: row.path as CanonicalAbsolutePathV1,
            expectedBefore: "absent",
            ownerUid: uid(),
            mode: 0o700,
            parent: parentFor(row.path),
            cleanup: "remove_on_compensation",
          }
        : {
            kind: "file",
            path: row.path as CanonicalAbsolutePathV1,
            expectedBefore: "absent",
            ownerUid: uid(),
            payload: row.payload,
            parent: parentFor(row.path),
            cleanup: "remove_on_compensation",
          }),
    ];

    const launch = this.buildLaunchability(input.packaged, addPackage, addDerived, createdPaths, preexisting, createdAt);
    const manifest = this.buildManifest(
      input,
      createdPaths,
      launch.paths,
      forwardMutations,
      payloads,
      createdAt,
    );
    const manifestBytes = encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue));
    const manifestRef = addDerived("manifest_after", manifest as unknown as CanonicalJsonValue);
    if (manifestRef.hash !== lowerHash(manifestBytes)) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest payload derivation changed");
    }
    const foundationHash = createHash("sha256")
      .update("developer-os/manifest-foundation-bindings/v1\0")
      .update(JSON.stringify([forwardId]))
      .digest("hex") as LowerHexSha256;
    const manifestState = {
      schemaVersion: 1,
      participantId: `mf_${input.id}`,
      envelope: { kind: "fresh_v2_init", id: input.id },
      bindings: {
        foundationTransactions: { count: 1, orderedIdsHash: foundationHash },
        externalEffects: [],
      },
      manifestPath: paths.manifestFile,
      tombstonePath: join(
        dirname(paths.manifestFile),
        `.installation-manifest.mf_${input.id}.json.tombstone`,
      ),
      before: { state: "absent" },
      after: {
        state: "present",
        hash: manifestRef.hash,
        bytes: manifestRef,
        ownerUid: uid(),
        mode: 0o600,
        nlink: 1,
        size: String(manifestRef.bytes),
        dev: null,
        ino: null,
      },
      maximumPlanBytes: 16_777_216,
      maximumJournalBytes: MAX_JOURNAL_BYTES,
    } as unknown as ManifestStatePlanV1;

    const envelope = deriveBootstrapEnvelopePaths(paths.home as CanonicalAbsolutePathV1, "fresh_v2_init", input.id);
    const maximumStagingEntries =
      2 * payloads.length +
      3 * (createdPaths.length + launch.paths.length) +
      5 +
      2 * 2;
    const plan: FreshV2InitPlanV1 = {
      schemaVersion: 1,
      operation: "fresh_v2_init",
      id: input.id,
      admittedExternalShapeHash: bootstrapExternalShapeHash(input.externalShape),
      admittedPreexistingPaths: [...new Set<string>([
        ...input.retainedPaths,
        ...input.preexistingDirectories.keys(),
      ])]
        .filter((path) => path === paths.home || path.startsWith(`${paths.home}/`))
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map((path) => path as CanonicalAbsolutePathV1),
      v2ManifestHash: manifestRef.hash,
      bootstrapIdentity: {
        path: join(paths.stateDir, ".lifecycle-bootstrap.lock") as CanonicalAbsolutePathV1,
        ownerUid: uid(),
        mode: 0o600,
        nlink: 1,
        size: 0,
        dev: String(input.lockStats.dev) as FreshV2InitPlanV1["bootstrapIdentity"]["dev"],
        ino: String(input.lockStats.ino) as FreshV2InitPlanV1["bootstrapIdentity"]["ino"],
      },
      planPath: envelope.plan,
      journalSlots: [
        { slot: 0, path: envelope.journalSlots[0], ownerUid: uid(), mode: 0o600, nlink: 1, dev: "0" as UInt64DecimalV1, ino: "0" as UInt64DecimalV1 },
        { slot: 1, path: envelope.journalSlots[1], ownerUid: uid(), mode: 0o600, nlink: 1, dev: "0" as UInt64DecimalV1, ino: "1" as UInt64DecimalV1 },
      ],
      stagingRoot: envelope.stagingRoot,
      maximumPlanBytes: MAX_PLAN_BYTES,
      maximumJournalBytes: MAX_JOURNAL_BYTES,
      maximumStagingEntries,
      payloads,
      createdPaths,
      foundationParticipants: [compensation, forward],
      launchabilityPaths: launch.paths,
      manifest: manifestState,
    };
    return { plan };
  }

  private buildLaunchability(
    packaged: AdmittedPackagedReleaseV1,
    addPackage: (relativePath: string) => BootstrapExpectedPayloadRefV1,
    addDerived: (
      role: Extract<BootstrapPayloadSourceV1, { kind: "plan_derived" }>["role"],
      value: CanonicalJsonValue,
    ) => BootstrapExpectedPayloadRefV1,
    createdPaths: readonly PlannedCreatedPathV1[],
    preexisting: ReadonlyMap<string, PlanIdentityStats>,
    activatedAt: string,
  ): { readonly paths: readonly PlannedCreatedPathV1[] } {
    const paths = this.#dependencies.paths;
    const releaseRoot = join(paths.home, "releases");
    const versionRoot = join(releaseRoot, packaged.identity.version);
    const bundleRoot = this.bundleDestination(packaged);
    const bundleFiles = packaged.files
      .filter((file) => file.relativePath.startsWith(`${packaged.bundleRoot}/`))
      .sort((left, right) => Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)));
    if (bundleFiles.length < 1) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "packaged release bundle inventory is empty");
    }
    const inferredDirectories = new Set<string>();
    for (const file of bundleFiles) {
      const relativePath = file.relativePath.slice(packaged.bundleRoot.length + 1);
      let parent = dirname(relativePath);
      while (parent !== ".") {
        inferredDirectories.add(join(bundleRoot, parent));
        parent = dirname(parent);
      }
    }
    const metadataRoot = join(releaseRoot, "metadata");
    const directoryPaths = [
      releaseRoot,
      versionRoot,
      bundleRoot,
      ...[...inferredDirectories].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
      metadataRoot,
    ];
    const specs: Array<
      | { readonly kind: "directory"; readonly path: string }
      | { readonly kind: "file"; readonly path: string; readonly payload: BootstrapExpectedPayloadRefV1 }
    > = directoryPaths.map((path) => ({ kind: "directory", path }));
    for (const file of bundleFiles) {
      specs.push({
        kind: "file",
        path: join(bundleRoot, file.relativePath.slice(packaged.bundleRoot.length + 1)),
        payload: addPackage(file.relativePath),
      });
    }
    const metadata = [
      packaged.retainedMetadata.delegation,
      packaged.retainedMetadata.releaseIndex,
      packaged.retainedMetadata.bundleManifest,
    ];
    for (const relativePath of metadata) {
      specs.push({
        kind: "file",
        path: join(metadataRoot, relativePath.split("/").at(-1) ?? relativePath),
        payload: addPackage(relativePath),
      });
    }
    const trustValue = {
      schemaVersion: 1,
      highestDelegationSequence: packaged.identity.delegationSequence,
      delegationHash: packaged.identity.delegationHash,
      delegatedReleaseKeyId: packaged.identity.delegatedReleaseKeyId,
      highestReleaseIndexSequence: packaged.identity.releaseIndexSequence,
      releaseIndexHash: packaged.identity.releaseIndexHash,
      highestAcceptedReleaseSequence: packaged.identity.releaseSequence,
      releaseIdentityHash: packaged.identity.releaseIdentityHash,
    } as const;
    const activeValue = {
      schemaVersion: 1,
      version: packaged.identity.version,
      releaseSequence: packaged.identity.releaseSequence,
      releaseIdentityHash: packaged.identity.releaseIdentityHash,
      delegationSequence: packaged.identity.delegationSequence,
      delegationHash: packaged.identity.delegationHash,
      releaseIndexSequence: packaged.identity.releaseIndexSequence,
      releaseIndexHash: packaged.identity.releaseIndexHash,
      bundleManifestHash: packaged.identity.bundleManifestHash,
      bundleRoot,
      platform: packaged.identity.platform,
      architecture: packaged.identity.architecture,
      launcherProtocol: packaged.identity.launcherProtocol,
      updateProtocol: packaged.identity.updateProtocol,
      activatedAt,
    } as const;
    specs.push({
      kind: "file",
      path: join(paths.stateDir, "release-trust.json"),
      payload: addDerived("release_trust", trustValue),
    });
    specs.push({
      kind: "file",
      path: join(paths.stateDir, "active-release.json"),
      payload: addDerived("active_release", activeValue),
    });

    const launchOrdinals = new Map(specs.map((spec, ordinal) => [spec.path, ordinal] as const));
    const ordinaryOrdinals = new Map<string, number>(
      createdPaths.map((planned, ordinal) => [planned.path, ordinal] as const),
    );
    const parentFor = (path: string, ordinal: number) => {
      const parentPath = dirname(path);
      const launchOrdinal = launchOrdinals.get(parentPath);
      if (launchOrdinal !== undefined && launchOrdinal < ordinal) {
        return parentCreated("launchability", launchOrdinal);
      }
      const ordinaryOrdinal = ordinaryOrdinals.get(parentPath);
      if (ordinaryOrdinal !== undefined) return parentCreated("ordinary", ordinaryOrdinal);
      const stats = preexisting.get(parentPath);
      if (stats === undefined) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `unbound launchability parent ${parentPath}`);
      }
      return {
        kind: "preexisting" as const,
        path: parentPath as CanonicalAbsolutePathV1,
        dev: String(stats.dev) as Extract<PlannedCreatedPathV1["parent"], { kind: "preexisting" }>["dev"],
        ino: String(stats.ino) as Extract<PlannedCreatedPathV1["parent"], { kind: "preexisting" }>["ino"],
      };
    };
    return {
      paths: specs.map((spec, ordinal): PlannedCreatedPathV1 => spec.kind === "directory"
        ? {
            kind: "directory",
            path: spec.path as CanonicalAbsolutePathV1,
            expectedBefore: "absent",
            ownerUid: uid(),
            mode: 0o700,
            parent: parentFor(spec.path, ordinal),
            cleanup: "remove_on_compensation",
          }
        : {
            kind: "file",
            path: spec.path as CanonicalAbsolutePathV1,
            expectedBefore: "absent",
            ownerUid: uid(),
            payload: spec.payload,
            parent: parentFor(spec.path, ordinal),
            cleanup: "remove_on_compensation",
          }),
    };
  }

  private buildManifest(
    input: {
      readonly request: FreshInitRequestV1;
      readonly packaged: AdmittedPackagedReleaseV1;
    },
    created: readonly PlannedCreatedPathV1[],
    launchability: readonly PlannedCreatedPathV1[],
    foundation: readonly FoundationMutationRefV1[],
    payloads: readonly BootstrapPayloadPlanV1[],
    installedAt: string,
  ): InstallationManifestV2 {
    const paths = this.#dependencies.paths;
    const sourceByPayload = new Map(payloads.map((row) => [row.ref.path, row.source] as const));
    const payloadForPath = new Map<string, BootstrapExpectedPayloadRefV1>();
    for (const planned of [...created, ...launchability]) {
      if (planned.kind === "file") payloadForPath.set(planned.path, planned.payload);
    }
    for (const mutation of foundation) {
      if (mutation.content != null) payloadForPath.set(mutation.targetPath, mutation.content);
    }
    const includedPaths = [
      paths.home,
      paths.stateDir,
      ...created
        .filter((planned) => !planned.path.startsWith(`${paths.stagingDir}/`) && planned.path !== paths.stagingDir)
        .map((planned) => planned.path),
      ...launchability.map((planned) => planned.path),
      ...foundation.map((mutation) => mutation.targetPath),
    ];
    const kindByPath = new Map<string, "directory" | "file">([
      [paths.home, "directory"],
      [paths.stateDir, "directory"],
      ...created.map((planned) => [planned.path, planned.kind === "directory" ? "directory" : "file"] as const),
      ...launchability.map((planned) => [planned.path, planned.kind === "directory" ? "directory" : "file"] as const),
      ...foundation.map((mutation) => [mutation.targetPath, "file"] as const),
    ]);
    const artifactRows = [...new Set(includedPaths)].map((path) => {
      const kind = kindByPath.get(path);
      if (kind === undefined) throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest path kind is unbound");
      const base = {
        owner: "core" as const,
        path: path as CanonicalAbsolutePathV1,
        productVersion: input.packaged.identity.version,
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        source: "generated/directory",
        mergeStrategy: "dedicated" as const,
        verifiedAt: installedAt,
      };
      if (kind === "directory") {
        return { ...base, kind: "directory" as const, verification: { mode: "content" as const } };
      }
      if (path === join(paths.stateDir, ".lifecycle.lock")) {
        return {
          ...base,
          source: "generated/global-lock",
          kind: "file" as const,
          verification: { mode: "ephemeral" as const },
        };
      }
      const ref = payloadForPath.get(path);
      if (ref === undefined) throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `manifest payload missing for ${path}`);
      const source = sourceByPayload.get(ref.path);
      if (source === undefined) throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest source is unbound");
      const sourceName = source.kind === "guarded_package_file"
        ? source.relativePath
        : source.kind === "constant_empty"
          ? `generated/reservations/${createHash("sha256").update(path).digest("hex")}`
          : source.kind === "plan_derived"
            ? `generated/${source.role}`
            : "generated/migration-preimage";
      if (source.kind === "constant_empty") {
        return {
          ...base,
          source: sourceName,
          kind: "file" as const,
          verification: { mode: "ephemeral" as const },
        };
      }
      const schemaId = path === paths.configFile
        ? "developer-os-config-v1"
        : path === join(paths.stateDir, "lifecycle-id-allocator.json")
          ? "lifecycle-id-allocator-v1"
          : path === join(paths.stateDir, "active-release.json")
            ? "active-release-record-v1"
            : path === join(paths.stateDir, "release-trust.json")
              ? "release-trust-state-v1"
              : null;
      return schemaId === null
        ? {
            ...base,
            source: sourceName,
            kind: "file" as const,
            verification: { mode: "content" as const, installedHash: ref.hash },
          }
        : {
            ...base,
            source: sourceName,
            kind: "file" as const,
            verification: { mode: "schema" as const, schemaId, installedHash: ref.hash },
          };
    });
    artifactRows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const manifest = {
      schemaVersion: 2 as const,
      productVersion: input.packaged.identity.version,
      installedAt,
      artifacts: artifactRows,
    } as unknown as InstallationManifestV2;
    return validateManifestV2(manifest, this.manifestAdmission(input.request, input.packaged.packageRoot));
  }

  /**
   * The live request names both roots this bootstrap run may own: the
   * product home it is installing into and the Brain the request declares
   * (`FreshInitRequestV1.brainPath`). Confining against them here is real
   * confinement, not a placeholder — unlike `report.ts`'s `exactV2Handoff`,
   * which inspects a retained plan with no live request in scope.
   */
  private manifestAdmission(
    request: FreshInitRequestV1,
    packageRoot: string,
  ): ManifestAdmissionContextV1 {
    const productHome = this.#dependencies.paths.home as CanonicalAbsolutePathV1;
    return {
      evidence: createCanonicalPathEvidence(),
      sourceRoot: packageRoot as CanonicalAbsolutePathV1,
      backupRoot: this.#dependencies.paths.backupsDir as CanonicalAbsolutePathV1,
      admitOwnerPath: createOwnerPathAdmission({
        kind: "confined",
        roots: [productHome, request.brainPath as CanonicalAbsolutePathV1],
      }),
    };
  }

  private packageRootFromPlan(plan: FreshV2InitPlanV1): string {
    const source = plan.payloads
      .map((row) => row.source)
      .find((candidate) => candidate.kind === "guarded_package_file");
    if (source?.kind !== "guarded_package_file") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan has no guarded package root");
    }
    return source.packageRoot;
  }

  private manifestPlanAdmission(
    plan: FreshV2InitPlanV1,
  ): ManifestStatePlanAdmissionContextV1 {
    const forwardIds = plan.foundationParticipants
      .filter((participant) => participant.role.kind === "forward")
      .map((participant) => participant.id);
    return {
      evidence: createCanonicalPathEvidence(),
      productHome: this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      manifestPath: this.#dependencies.paths.manifestFile as CanonicalAbsolutePathV1,
      foundationTransactionIds: forwardIds,
      externalEffects: [],
      admitParticipant: (envelope, participantId) =>
        envelope.kind === "fresh_v2_init" &&
        envelope.id === plan.id &&
        participantId === `mf_${plan.id}`
          ? participantId as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>
          : "mf_refused" as ReturnType<ManifestStatePlanAdmissionContextV1["admitParticipant"]>,
      admitExternalEffect: () => "refused",
      bootstrapPayloadIdentity: (ref) =>
        plan.payloads.some((row) => sameValue(row.ref, ref))
          ? { dev: "1", ino: "1" } as NonNullable<ReturnType<NonNullable<ManifestStatePlanAdmissionContextV1["bootstrapPayloadIdentity"]>>>
          : null,
    };
  }

  private planAdmission(
    plan: FreshV2InitPlanV1,
    packaged: AdmittedPackagedReleaseV1 | null,
    externalShape: BootstrapExternalShapeProjectionV1 | null,
    recoveryAuthority: (() => boolean) | null = null,
  ) {
    const findPayload = (source: BootstrapPayloadSourceV1, ref: BootstrapExpectedPayloadRefV1) =>
      plan.payloads.find((row) => sameValue(row.ref, ref) && sameValue(row.source, source));
    return {
      evidence: createCanonicalPathEvidence(),
      productHome: this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      stateRoot: this.#dependencies.paths.stateDir as CanonicalAbsolutePathV1,
      productStagingRoot: this.#dependencies.paths.stagingDir as CanonicalAbsolutePathV1,
      operation: "fresh_v2_init" as const,
      id: plan.id,
      bootstrapIdentity: plan.bootstrapIdentity,
      externalShape,
      admitFreshRecoveryExternalShape: (
        hash: LowerHexSha256,
        identity: FreshV2InitPlanV1["bootstrapIdentity"],
      ) =>
        externalShape === null &&
        recoveryAuthority?.() === true &&
        hash === plan.admittedExternalShapeHash &&
        sameValue(identity, plan.bootstrapIdentity)
          ? hash
          : "refused",
      admitPayloadSource: (source: BootstrapPayloadSourceV1, ref: BootstrapExpectedPayloadRefV1) => {
        const row = findPayload(source, ref);
        if (row === undefined) return { kind: "constant_empty", role: "empty_reservation" } as const;
        if (source.kind === "guarded_package_file" && packaged !== null) {
          const file = packaged.files.find((candidate) => candidate.relativePath === source.relativePath);
          if (
            file === undefined ||
            source.packageRoot !== packaged.packageRoot ||
            source.packageRootDev !== packaged.packageRootDev ||
            source.packageRootIno !== packaged.packageRootIno ||
            source.packageInventoryHash !== packaged.packageInventoryHash ||
            source.sourceDev !== file.dev ||
            source.sourceIno !== file.ino ||
            source.sourceHash !== file.sha256 ||
            source.sourceBytes !== file.bytes ||
            source.sourceMode !== file.mode
          ) return { kind: "constant_empty", role: "empty_reservation" } as const;
        }
        return structuredClone(row.source);
      },
      admitPlannedCreatedPath: (
        candidate: PlannedCreatedPathV1,
        scope: "ordinary" | "launchability",
        ordinal: number,
      ) => {
        const expected = scope === "ordinary" ? plan.createdPaths[ordinal] : plan.launchabilityPaths[ordinal];
        return expected !== undefined && sameValue(expected, candidate)
          ? structuredClone(expected)
          : structuredClone(plan.createdPaths[0] as PlannedCreatedPathV1);
      },
      admitPreexistingParent: (candidate: unknown) => {
        const parents = [...plan.createdPaths, ...plan.launchabilityPaths]
          .map((planned) => planned.parent)
          .filter((parent) => parent.kind === "preexisting");
        const expected = parents.find((parent) => sameValue(parent, candidate));
        return structuredClone(expected ?? parents[0]) as ReturnType<BootstrapPlanAdmissionContextV1["admitPreexistingParent"]>;
      },
      admitFoundationParticipant: (candidate: FoundationParticipantRefV2) => {
        const expected = plan.foundationParticipants.find((participant) => sameValue(participant, candidate));
        return structuredClone(expected ?? plan.foundationParticipants[0]) as FoundationParticipantRefV2;
      },
      admitManifestParticipant: (candidate: ManifestStatePlanV1) =>
        validateManifestStatePlan(
          candidate,
          this.manifestPlanAdmission(plan),
        ),
      admitPlanDerivedValue: (role: string, value: unknown) => {
        const expected = plan.payloads
          .map((row) => row.source)
          .find((source) =>
            source.kind === "plan_derived" &&
            source.role === role &&
            sameValue(source.value, value));
        return expected?.kind === "plan_derived"
          ? structuredClone(expected.value)
          : { refused: true };
      },
    };
  }

  private requestFromPlan(plan: FreshV2InitPlanV1): FreshInitRequestV1 {
    const source = plan.payloads
      .map((row) => row.source)
      .find((candidate) => candidate.kind === "plan_derived" && candidate.role === "foundation_config");
    if (source?.kind !== "plan_derived") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan has no retained config");
    }
    const config = structuredClone(source.value) as unknown as DeveloperOsConfigV1;
    return { config, brainPath: config.brainPath };
  }

  private admitPersistedPlanStructure(
    value: unknown,
    id: FreshV2InitIdV1,
  ): FreshV2InitPlanV1 {
    try {
      return admitBootstrapEvidencePlan(value, {
        productHome: this.#dependencies.paths.home as CanonicalAbsolutePathV1,
        stateDirectory: this.#dependencies.paths.stateDir as CanonicalAbsolutePathV1,
        expectedId: id,
      });
    } catch {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "persisted bootstrap plan failed structural grammar admission");
    }
  }

  private async readOrCreateJournal(plan: FreshV2InitPlanV1): Promise<FreshV2InitJournalV1> {
    return (await this.storeFor(plan)).current() as FreshV2InitJournalV1;
  }

  private async writeJournal(
    plan: FreshV2InitPlanV1,
    journal: FreshV2InitJournalV1,
    patch: Partial<FreshV2InitJournalV1>,
  ): Promise<FreshV2InitJournalV1> {
    const store = await this.storeFor(plan);
    const current = store.current() as FreshV2InitJournalV1;
    if (!sameValue(current, journal)) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap journal cursor changed before advance");
    }
    const sequence = BigInt(current.sequence) + 1n;
    const next = validateBootstrapJournal(plan, {
      ...current,
      ...patch,
      slot: current.slot === 0 ? 1 : 0,
      sequence: sequence.toString(),
      previousJournalHash: lowerHash(
        encoder.encode(encodeCanonicalJson(current as unknown as CanonicalJsonValue)),
      ),
      updatedAt: this.#dependencies.now().toISOString(),
    }) as FreshV2InitJournalV1;
    await store.advance(next);
    return store.current() as FreshV2InitJournalV1;
  }
  private assertPublicPayload(bytes: Uint8Array): void {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(text) ||
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u.test(text) ||
      /\bAKIA[0-9A-Z]{16}\b/u.test(text)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "packaged release payload contains private material");
    }
  }

  private async sourceBytes(
    row: BootstrapPayloadPlanV1,
    packaged: AdmittedPackagedReleaseV1 | null,
  ): Promise<Uint8Array> {
    if (row.source.kind === "guarded_package_file") {
      if (packaged === null) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "packaged source was consulted after payload staging");
      }
      return packaged.readFile(row.source.relativePath);
    }
    if (row.source.kind === "plan_derived") return derivedPayloadBytes(row.source);
    if (row.source.kind === "constant_empty") return new Uint8Array();
    throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "fresh init cannot consume migration preimages");
  }

  private async guardReadOwnedFile(
    path: string,
    maximumBytes: number,
    allowedLinks: readonly number[],
    point?: FreshInitDeathPointV1,
  ): Promise<Uint8Array> {
    const before = await nodeFs.lstat(path);
    const exactShape = (stats: Stats): boolean =>
      stats.isFile() && !stats.isSymbolicLink() && stats.uid === uid() &&
      mode(stats) === 0o600 && allowedLinks.includes(stats.nlink) &&
      stats.size >= 0 && stats.size <= maximumBytes;
    if (!exactShape(before)) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `guarded bootstrap envelope changed shape: ${path}`);
    }
    if (point !== undefined) this.checkpoint(point);
    const handle = await nodeFs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (!exactShape(opened) || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `guarded bootstrap envelope changed during open: ${path}`);
      }
      const bytes = await handle.readFile();
      const after = await nodeFs.lstat(path);
      if (
        !exactShape(after) || after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== bytes.byteLength
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `guarded bootstrap envelope changed during read: ${path}`);
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  private async assertExactFile(
    path: string,
    expected: { readonly hash: string; readonly bytes: number; readonly mode: number },
    expectedNlink = 1,
  ): Promise<Stats> {
    const stats = await nodeFs.lstat(path);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== uid() ||
      stats.nlink !== expectedNlink ||
      mode(stats) !== expected.mode ||
      stats.size !== expected.bytes
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `bootstrap file changed shape: ${path}`);
    }
    const handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const bytes = await handle.readFile();
      const fresh = await nodeFs.lstat(path);
      if (
        opened.dev !== stats.dev ||
        opened.ino !== stats.ino ||
        fresh.dev !== stats.dev ||
        fresh.ino !== stats.ino ||
        bytes.byteLength !== expected.bytes ||
        lowerHash(bytes) !== expected.hash
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, `bootstrap file changed bytes: ${path}`);
      }
      return fresh;
    } finally {
      await handle.close();
    }
  }

  private async writePayloadEvidence(
    plan: FreshV2InitPlanV1,
    row: BootstrapPayloadPlanV1,
    stats: Stats,
  ): Promise<BootstrapPayloadEvidenceV1> {
    const evidence: BootstrapPayloadEvidenceV1 = {
      schemaVersion: 1,
      bootstrapId: plan.id,
      ordinal: row.ref.ordinal,
      stagedPathHash: pathHash(row.ref.path),
      sourceIdentityHash: bootstrapPayloadSourceIdentityHash(row.source),
      bytes: row.ref.bytes,
      sha256: row.ref.hash,
      mode: row.ref.mode,
      dev: String(stats.dev) as BootstrapPayloadEvidenceV1["dev"],
      ino: String(stats.ino) as BootstrapPayloadEvidenceV1["ino"],
    };
    const paths = deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID());
    const existing = await lstatOptional(paths.evidence);
    if (existing === null) {
      await durableWriteNoReplace(paths.evidence, encoder.encode(encodeCanonicalJson(evidence as unknown as CanonicalJsonValue)));
    }
    return evidence;
  }

  private async readPayloadEvidence(
    row: BootstrapPayloadPlanV1,
  ): Promise<BootstrapPayloadEvidenceV1> {
    const paths = deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID());
    return decodeCanonicalJson(
      await this.guardReadOwnedFile(
        paths.evidence,
        1024,
        [1],
        "before_payload_evidence_open",
      ),
      1024,
    ) as unknown as BootstrapPayloadEvidenceV1;
  }

  private assertPayloadEvidenceIdentity(
    plan: FreshV2InitPlanV1,
    row: BootstrapPayloadPlanV1,
    evidence: BootstrapPayloadEvidenceV1,
    stats: Stats,
  ): void {
    if (
      evidence.bootstrapId !== plan.id ||
      evidence.ordinal !== row.ref.ordinal ||
      evidence.stagedPathHash !== pathHash(row.ref.path) ||
      evidence.sourceIdentityHash !== bootstrapPayloadSourceIdentityHash(row.source) ||
      evidence.bytes !== row.ref.bytes ||
      evidence.sha256 !== row.ref.hash ||
      evidence.mode !== row.ref.mode ||
      evidence.dev !== String(stats.dev) ||
      evidence.ino !== String(stats.ino)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload evidence changed identity");
    }
  }

  private async assertPlannedParent(
    plan: FreshV2InitPlanV1,
    planned: PlannedCreatedPathV1,
  ): Promise<void> {
    const parent = planned.parent;
    const path = dirname(planned.path);
    const stats = await nodeFs.lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== uid() || mode(stats) !== 0o700) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "planned parent changed shape");
    }
    if (parent.kind === "preexisting") {
      if (
        parent.path !== path ||
        parent.dev !== String(stats.dev) ||
        parent.ino !== String(stats.ino)
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "preexisting parent changed identity");
      }
      return;
    }
    const evidence = await this.readCreationEvidence(
      plan,
      parent.scope,
      parent.ordinal,
    );
    if (
      evidence.pathHash !== pathHash(path) ||
      evidence.kind !== "directory" ||
      evidence.dev !== String(stats.dev) ||
      evidence.ino !== String(stats.ino)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "created parent changed identity");
    }
  }

  private async exactRenameParent(path: string): Promise<{
    readonly path: CanonicalAbsolutePathV1;
    readonly ownerUid: number;
    readonly mode: 0o700;
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  }> {
    const stats = await nodeFs.lstat(path);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.uid !== uid() ||
      mode(stats) !== 0o700
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "publication parent changed shape");
    }
    return {
      path: path as CanonicalAbsolutePathV1,
      ownerUid: uid(),
      mode: 0o700,
      dev: String(stats.dev) as UInt64DecimalV1,
      ino: String(stats.ino) as UInt64DecimalV1,
    };
  }

  private async stagePayloads(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
    packaged: AdmittedPackagedReleaseV1 | null,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "planned" && journal.phase !== "payload_staging") return journal;
    if (journal.phase === "planned") {
      journal = await this.writeJournal(plan, journal, { phase: "payload_staging" });
    }
    while (journal.nextPayload < plan.payloads.length) {
      const row = plan.payloads[journal.nextPayload];
      if (row === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload cursor escaped plan");
      const bytes = await this.sourceBytes(row, packaged);
      this.assertPublicPayload(bytes);
      if (bytes.byteLength !== row.ref.bytes || lowerHash(bytes) !== row.ref.hash) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap source no longer matches its admitted ref");
      }
      let stats = await lstatOptional(row.ref.path);
      if (journal.payloadWriteState.state === "idle") {
        if (stats !== null) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "an unbound payload inode exists before create intent");
        }
        journal = await this.writeJournal(plan, journal, {
          payloadWriteState: { state: "create_intent", ordinal: row.ref.ordinal },
        });
        this.checkpoint("after_payload_create_intent");
      }
      if (journal.payloadWriteState.state === "create_intent") {
        stats = await lstatOptional(row.ref.path);
        if (stats === null) {
          const empty = await nodeFs.open(
            row.ref.path,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            row.ref.mode,
          );
          await empty.close();
          await syncDirectory(dirname(row.ref.path));
          stats = await nodeFs.lstat(row.ref.path);
          this.checkpoint("after_payload_empty_create");
        }
        if (
          !stats.isFile() ||
          stats.isSymbolicLink() ||
          stats.uid !== uid() ||
          stats.nlink !== 1 ||
          stats.size !== 0 ||
          mode(stats) !== row.ref.mode
        ) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload create intent found a nonempty or changed inode");
        }
        journal = await this.writeJournal(plan, journal, {
          payloadWriteState: {
            state: "writing",
            ordinal: row.ref.ordinal,
            dev: String(stats.dev) as Extract<FreshV2InitJournalV1["payloadWriteState"], { state: "writing" }>["dev"],
            ino: String(stats.ino) as Extract<FreshV2InitJournalV1["payloadWriteState"], { state: "writing" }>["ino"],
          },
        });
        this.checkpoint("after_payload_writing_intent");
      }
      if (journal.payloadWriteState.state !== "writing") {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload write state did not become writing");
      }
      stats = await nodeFs.lstat(row.ref.path);
      if (
        journal.payloadWriteState.ordinal !== row.ref.ordinal ||
        journal.payloadWriteState.dev !== String(stats.dev) ||
        journal.payloadWriteState.ino !== String(stats.ino)
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload writing inode changed identity");
      }
      const evidencePath = deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID()).evidence;
      if (await lstatOptional(evidencePath) !== null) {
        stats = await this.assertExactFile(row.ref.path, row.ref);
        const evidence = await this.readPayloadEvidence(row);
        this.assertPayloadEvidenceIdentity(plan, row, evidence, stats);
      } else {
        if (stats.size !== 0) {
          const partial = await nodeFs.open(
            row.ref.path,
            constants.O_WRONLY | constants.O_NOFOLLOW,
          );
          try {
            const opened = await partial.stat();
            if (
              String(opened.dev) !== journal.payloadWriteState.dev ||
              String(opened.ino) !== journal.payloadWriteState.ino
            ) {
              throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "partial payload identity changed before restart");
            }
            await partial.truncate(0);
            await partial.sync();
          } finally {
            await partial.close();
          }
          stats = await nodeFs.lstat(row.ref.path);
        }
        const handle = await nodeFs.open(
          row.ref.path,
          constants.O_WRONLY | constants.O_NOFOLLOW,
        );
        try {
          const opened = await handle.stat();
          if (
            String(opened.dev) !== journal.payloadWriteState.dev ||
            String(opened.ino) !== journal.payloadWriteState.ino ||
            opened.size !== 0
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload inode changed before byte zero");
          }
          const split = Math.floor(bytes.byteLength / 2);
          let offset = 0;
          while (offset < split) {
            const result = await handle.write(bytes, offset, split - offset, offset);
            if (result.bytesWritten < 1) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload write made no progress");
            offset += result.bytesWritten;
          }
          this.checkpoint("during_payload_write");
          while (offset < bytes.byteLength) {
            const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
            if (result.bytesWritten < 1) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload write made no progress");
            offset += result.bytesWritten;
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.checkpoint("after_payload_file_sync");
        stats = await this.assertExactFile(row.ref.path, row.ref);
        if (
          journal.payloadWriteState.dev !== String(stats.dev) ||
          journal.payloadWriteState.ino !== String(stats.ino)
        ) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload inode changed after sync");
        }
      }
      await this.writePayloadEvidence(plan, row, stats);
      this.trace(`payload:evidence:${String(row.ref.ordinal)}`);
      this.checkpoint("after_payload_evidence");
      journal = await this.writeJournal(plan, journal, {
        nextPayload: row.ref.ordinal + 1,
        payloadWriteState: { state: "idle" },
      });
      if (row.ref.ordinal === 0) this.checkpoint("after_first_payload");
    }
    this.checkpoint("after_payloads");
    return this.writeJournal(plan, journal, { phase: "creating" });
  }

  private async createPlannedPath(
    plan: FreshV2InitPlanV1,
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ): Promise<CreatedPathEvidenceV1> {
    await this.assertPlannedParent(plan, planned);
    let stats = await lstatOptional(planned.path);
    if (stats === null) {
      if (planned.kind === "directory") {
        await nodeFs.mkdir(planned.path, { mode: 0o700 });
        this.checkpoint("after_directory_create");
        this.checkpoint("before_directory_parent_sync");
        await syncDirectory(dirname(planned.path));
        this.checkpoint("after_directory_parent_sync");
      } else if (planned.kind === "global_lock") {
        const retained = this.#heldLocks.get(plan.id);
        const global = await this.acquireLifecycleLock(planned.path);
        this.#heldLocks.set(plan.id, { bootstrap: retained?.bootstrap ?? null, global });
        this.trace("lock:global");
        this.checkpoint("after_global_lock_create");
        this.checkpoint("before_global_lock_parent_sync");
        await syncDirectory(dirname(planned.path));
        this.checkpoint("after_global_lock_parent_sync");
      } else {
        const row = plan.payloads.find((candidate) => sameValue(candidate.ref, planned.payload));
        if (row === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "created file payload is unbound");
        }
        const payloadStats = await this.assertExactFile(planned.payload.path, planned.payload);
        const payloadEvidence = await this.readPayloadEvidence(row);
        this.assertPayloadEvidenceIdentity(plan, row, payloadEvidence, payloadStats);
        this.checkpoint("before_forward_rename");
        await this.#dependencies.renameNoReplace({
          sourcePath: planned.payload.path,
          destinationPath: planned.path,
          sourceParent: await this.exactRenameParent(dirname(planned.payload.path)),
          destinationParent: await this.exactRenameParent(dirname(planned.path)),
          postimage: {
            kind: "regular_file",
            ownerUid: uid(),
            mode: planned.payload.mode,
            nlink: 1,
            bytes: String(planned.payload.bytes) as UInt64DecimalV1,
            sha256: planned.payload.hash,
            dev: payloadEvidence.dev,
            ino: payloadEvidence.ino,
          },
        });
        this.checkpoint("after_forward_rename");
      }
      stats = await nodeFs.lstat(planned.path);
    } else if (planned.kind === "global_lock") {
      if (
        !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() ||
        stats.nlink !== 1 || stats.size !== 0 || mode(stats) !== 0o600
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock recovery found a changed inode");
      }
      const retained = this.#heldLocks.get(plan.id);
      if (retained?.global === null || retained?.global === undefined) {
        if (retained?.bootstrap === null || retained?.bootstrap === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock recovery requires the held bootstrap lock");
        }
        const evidencePath = deriveBootstrapCreationEvidencePaths(
          this.#dependencies.paths.home as CanonicalAbsolutePathV1,
          "fresh_v2_init",
          plan.id,
          scope,
          ordinal,
          randomUUID(),
        ).evidence;
        const evidenceStats = await lstatOptional(evidencePath);
        if (evidenceStats === null) {
          // Spec 2 §6.1 (Amended 2026-09-04): shape already verified above, evidence never
          // became durable, bootstrap lock held — admit and let the caller record evidence.
          await this.acquireIdentityCheckedGlobalLock(plan, planned, stats, retained.bootstrap);
        } else {
          const identity = { dev: String(stats.dev), ino: String(stats.ino) };
          // A death between the creation-evidence write and the journal advance leaves
          // matching evidence at cursor zero; refusing it stranded that evidence
          // untombstoned and made the next intent permanently unrunnable.
          const observed = await this.readCreationEvidence(plan, scope, ordinal);
          if (!matchesGlobalLockCreationEvidence(planned.path, observed, identity)) {
            // Re-inspects rather than reusing the plan-time evidence: this is
            // resuming a run whose global lock predates this call, so it must
            // observe whatever the current admission considers reusable right
            // now, not what an earlier read in this process saw.
            const reusable = (await this.inspectEvidence()).reusableGlobalLock;
            if (
              reusable === null || reusable.path !== planned.path ||
              reusable.dev !== identity.dev || reusable.ino !== identity.ino
            ) {
              throw new FreshBootstrapError(
                EXIT_CODES.recoveryRequired,
                "existing global lock escaped admitted rolled-back evidence",
              );
            }
          }
          await this.acquireIdentityCheckedGlobalLock(plan, planned, stats, retained.bootstrap);
        }
      } else if (retained.global.dev !== String(stats.dev) || retained.global.ino !== String(stats.ino)) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "held global lock changed during recovery");
      }
    } else if (planned.kind === "file") {
      const row = plan.payloads.find((candidate) => sameValue(candidate.ref, planned.payload));
      if (row === undefined) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "created file payload is unbound");
      }
      const payloadEvidence = await this.readPayloadEvidence(row);
      const payloadStats = await lstatOptional(planned.payload.path);
      if (payloadStats === null) {
        stats = await this.assertExactFile(planned.path, planned.payload);
        this.assertPayloadEvidenceIdentity(plan, row, payloadEvidence, stats);
      } else {
        this.assertPayloadEvidenceIdentity(plan, row, payloadEvidence, payloadStats);
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "publication has both source and destination names");
      }
    }
    await this.assertPlannedParent(plan, planned);
    if (
      stats.uid !== uid() ||
      stats.isSymbolicLink() ||
      (planned.kind === "directory"
        ? !stats.isDirectory() || mode(stats) !== 0o700
        : !stats.isFile() || stats.nlink !== 1 || mode(stats) !== (planned.kind === "global_lock" ? 0o600 : planned.payload.mode))
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "created bootstrap path changed identity");
    }
    if (planned.kind === "file") await this.assertExactFile(planned.path, planned.payload);
    const evidence: CreatedPathEvidenceV1 = {
      schemaVersion: 1,
      bootstrapId: plan.id,
      scope,
      ordinal,
      pathHash: pathHash(planned.path),
      kind: planned.kind,
      dev: String(stats.dev) as CreatedPathEvidenceV1["dev"],
      ino: String(stats.ino) as CreatedPathEvidenceV1["ino"],
      postimageHash: planned.kind === "file" ? planned.payload.hash : planned.kind === "global_lock" ? EMPTY_HASH : null,
    };
    const evidencePath = deriveBootstrapCreationEvidencePaths(
      this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      "fresh_v2_init",
      plan.id,
      scope,
      ordinal,
      randomUUID(),
    ).evidence;
    const existingEvidence = await lstatOptional(evidencePath);
    if (existingEvidence === null) {
      await durableWriteNoReplace(evidencePath, encoder.encode(encodeCanonicalJson(evidence as unknown as CanonicalJsonValue)));
    } else {
      const observed = await this.readCreationEvidence(plan, scope, ordinal);
      if (!sameValue(observed, evidence)) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence changed identity");
      }
    }
    this.checkpoint("after_creation_evidence");
    return evidence;
  }

  private async createOrdinary(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "creating") return journal;
    while (journal.nextCreatedPath < plan.createdPaths.length) {
      const ordinal = journal.nextCreatedPath;
      const planned = plan.createdPaths[ordinal];
      if (planned === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "creation cursor escaped plan");
      await this.createPlannedPath(plan, planned, "ordinary", ordinal);
      this.trace(planned.kind === "global_lock" ? "create:global_lock" : `create:ordinary:${String(ordinal)}`);
      journal = await this.writeJournal(plan, journal, { nextCreatedPath: ordinal + 1 });
      if (ordinal === 0) this.checkpoint("after_global_lock");
    }
    this.checkpoint("after_created_paths");
    return this.writeJournal(plan, journal, { phase: "foundation_applying" });
  }

  private async admittedFoundation(
    participant: FoundationParticipantRefV2,
    plan: FreshV2InitPlanV1,
  ) {
    // Re-inspects rather than reusing an earlier snapshot: the check below
    // compares only `active?.plan.id`, so it rules out the on-disk evidence
    // now naming a different plan (or none) as active — not created-path or
    // lock drift, which this call does not detect.
    const evidenceAdmission = await this.inspectEvidence();
    if (evidenceAdmission.active?.plan.id !== plan.id) {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "Foundation bootstrap evidence no longer selects the executing plan",
      );
    }
    const row = plan.payloads.find((payload) => sameValue(payload.ref, participant.initialJournal.staged));
    if (row === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation journal payload is unbound");
    const evidence = await this.readPayloadEvidence(row);
    if (row.source.kind !== "plan_derived" || row.source.role !== "foundation_initial_journal") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation initial journal source is not persisted in the plan");
    }
    const initialJournal = validateJournal(row.source.value);
    const sourceParent = await this.foundationPublicationParent(
      plan,
      dirname(participant.initialJournal.staged.path) as CanonicalAbsolutePathV1,
      evidenceAdmission,
    );
    const destinationParent = await this.foundationPublicationParent(
      plan,
      dirname(participant.initialJournal.finalPath) as CanonicalAbsolutePathV1,
      evidenceAdmission,
    );
    const mutationPublications = participant.role.kind === "forward"
      ? await Promise.all(participant.mutations.map(async (mutation) => {
          if (
            mutation.operation !== "create" ||
            mutation.expectedBeforeHash !== null ||
            mutation.stagedPath === null ||
            mutation.content == null
          ) {
            throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation bootstrap mutation is not an exact create");
          }
          const sourceOrdinal = plan.createdPaths.findIndex((candidate) =>
            candidate.kind === "file" && candidate.path === mutation.stagedPath,
          );
          const sourcePlan = plan.createdPaths[sourceOrdinal];
          const payload = plan.payloads.find((candidate) => sameValue(candidate.ref, mutation.content));
          if (sourcePlan?.kind !== "file" || payload === undefined) {
            throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation mutation source escaped the immutable plan");
          }
          const [creationEvidence, payloadEvidence, sourceParent, destinationParent] = await Promise.all([
            this.readCreationEvidence(plan, "ordinary", sourceOrdinal),
            this.readPayloadEvidence(payload),
            this.foundationPublicationParent(
              plan,
              dirname(mutation.stagedPath) as CanonicalAbsolutePathV1,
              evidenceAdmission,
            ),
            this.foundationPublicationParent(
              plan,
              dirname(mutation.targetPath) as CanonicalAbsolutePathV1,
              evidenceAdmission,
            ),
          ]);
          if (
            creationEvidence.kind !== "file" ||
            creationEvidence.pathHash !== pathHash(mutation.stagedPath) ||
            creationEvidence.dev !== payloadEvidence.dev ||
            creationEvidence.ino !== payloadEvidence.ino ||
            creationEvidence.postimageHash !== mutation.content.hash ||
            mutation.contentHash !== mutation.content.hash ||
            mutation.contentSize !== mutation.content.bytes ||
            mutation.content.mode !== 0o600
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation mutation source changed persisted identity");
          }
          return {
            sourcePath: mutation.stagedPath,
            destinationPath: mutation.targetPath,
            sourceParent,
            destinationParent,
            postimage: {
              kind: "regular_file" as const,
              ownerUid: uid(),
              mode: 0o600 as const,
              nlink: 1 as const,
              bytes: String(mutation.content.bytes) as UInt64DecimalV1,
              sha256: mutation.content.hash,
              dev: payloadEvidence.dev,
              ino: payloadEvidence.ino,
            },
          };
        }))
      : [];
    const participantAdmissionId = `participant-${participant.id}`;
    const evidenceAdmissionId = `evidence-${participant.id}`;
    const mutationPublicationsAdmissionId = `mutation-publications-${participant.id}`;
    return admitBootstrapFoundationInitialJournal(participant, evidence, {
      participantAdmissionId,
      evidenceAdmissionId,
      mutationPublicationsAdmissionId,
      ownerUid: uid(),
      sourceParent,
      destinationParent,
      mutationPublications,
      initialJournal,
      admitParticipant: (candidate) => sameValue(candidate, participant) ? participantAdmissionId : "refused",
      admitEvidence: (candidate, candidateParticipant) =>
        sameValue(candidate, evidence) && sameValue(candidateParticipant, participant)
          ? evidenceAdmissionId
          : "refused",
      admitMutationPublications: (candidate, candidateParticipant) =>
        sameValue(candidate, mutationPublications) && sameValue(candidateParticipant, participant)
          ? mutationPublicationsAdmissionId
          : "refused",
    });
  }

  private async foundationPublicationParent(
    plan: FreshV2InitPlanV1,
    path: CanonicalAbsolutePathV1,
    evidenceAdmission: BootstrapEvidenceAdmissionV1,
  ) {
    const createdOrdinal = plan.createdPaths.findIndex((candidate) =>
      candidate.kind === "directory" && candidate.path === path,
    );
    if (createdOrdinal >= 0) {
      const evidence = await this.readCreationEvidence(plan, "ordinary", createdOrdinal);
      if (
        evidence.kind !== "directory" ||
        evidence.pathHash !== pathHash(path)
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation publication parent changed persisted evidence");
      }
      return {
        path,
        ownerUid: uid(),
        mode: 0o700 as const,
        dev: evidence.dev,
        ino: evidence.ino,
      };
    }
    const preexisting = [...plan.createdPaths, ...plan.launchabilityPaths]
      .map((candidate) => candidate.parent)
      .filter((candidate) => candidate.kind === "preexisting" && candidate.path === path);
    const first = preexisting[0];
    if (first?.kind === "preexisting") {
      if (preexisting.some((candidate) =>
        candidate.kind !== "preexisting" ||
        candidate.dev !== first.dev ||
        candidate.ino !== first.ino)
      ) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation publication parent has conflicting plan authority");
      }
      return {
        path,
        ownerUid: uid(),
        mode: 0o700 as const,
        dev: first.dev,
        ino: first.ino,
      };
    }
    const retained = evidenceAdmission.retainedParentAuthorities.find((candidate) => candidate.path === path);
    const stats = await lstatOptional(path);
    if (
      retained === undefined || stats === null || !stats.isDirectory() || stats.isSymbolicLink() ||
      stats.uid !== uid() || mode(stats) !== 0o700 ||
      String(stats.dev) !== retained.dev || String(stats.ino) !== retained.ino
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation publication parent escaped admitted retained evidence");
    }
    return {
      path,
      ownerUid: uid(),
      mode: 0o700 as const,
      dev: retained.dev,
      ino: retained.ino,
    };
  }

  private async applyFoundation(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "foundation_applying") return journal;
    if (journal.nextFoundationParticipant === 0) {
      const compensation = plan.foundationParticipants.find((participant) => participant.role.kind === "compensation");
      const forward = plan.foundationParticipants.find((participant) => participant.role.kind === "forward");
      if (compensation === undefined || forward === undefined) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation pair is incomplete");
      }
      this.trace(`foundation:compensation:${compensation.id}`);
      const admitted = await this.admittedFoundation(forward, plan);
      await this.#dependencies.transactionExecutor.executeBootstrapFoundationParticipant(admitted);
      this.trace(`foundation:forward:${forward.id}`);
      journal = await this.writeJournal(plan, journal, { nextFoundationParticipant: 1 });
      this.checkpoint("after_foundation");
    }
    return this.writeJournal(plan, journal, { phase: "launchability_publishing" });
  }

  private async publishLaunchability(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "launchability_publishing") return journal;
    while (journal.nextLaunchabilityPath < plan.launchabilityPaths.length) {
      const ordinal = journal.nextLaunchabilityPath;
      const planned = plan.launchabilityPaths[ordinal];
      if (planned === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "launchability cursor escaped plan");
      await this.createPlannedPath(plan, planned, "launchability", ordinal);
      let deathPoint: "after_trust" | "after_active" | null = null;
      if (planned.path.endsWith("/release-trust.json")) {
        this.trace("launchability:trust");
        deathPoint = "after_trust";
      } else if (planned.path.endsWith("/active-release.json")) {
        this.trace("launchability:active");
        deathPoint = "after_active";
      } else {
        this.trace(`create:launchability:${String(ordinal)}`);
      }
      journal = await this.writeJournal(plan, journal, { nextLaunchabilityPath: ordinal + 1 });
      if (deathPoint !== null) this.checkpoint(deathPoint);
    }
    return this.writeJournal(plan, journal, { phase: "manifest_publishing" });
  }

  private async guardedMoveNoReplace(
    source: CanonicalAbsolutePathV1,
    destination: CanonicalAbsolutePathV1,
    expected: {
      readonly hash: LowerHexSha256;
      readonly ownerUid: number;
      readonly mode: 0o600;
      readonly nlink: 1;
      readonly size: string;
      readonly dev: string;
      readonly ino: string;
    },
  ): Promise<void> {
    const stats = await this.assertExactFile(source, {
      hash: expected.hash,
      bytes: Number(expected.size),
      mode: expected.mode,
    });
    if (
      stats.uid !== expected.ownerUid ||
      stats.nlink !== expected.nlink ||
      String(stats.dev) !== expected.dev ||
      String(stats.ino) !== expected.ino ||
      await lstatOptional(destination) !== null
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest move identity changed");
    }
    await this.#dependencies.renameNoReplace({
      sourcePath: source,
      destinationPath: destination,
      sourceParent: await this.exactRenameParent(dirname(source)),
      destinationParent: await this.exactRenameParent(dirname(destination)),
      postimage: {
        kind: "regular_file",
        ownerUid: expected.ownerUid,
        mode: expected.mode,
        nlink: 1,
        bytes: expected.size as UInt64DecimalV1,
        sha256: expected.hash,
        dev: expected.dev as UInt64DecimalV1,
        ino: expected.ino as UInt64DecimalV1,
      },
    });
  }

  private async applyManifestPublication(plan: FreshV2InitPlanV1): Promise<void> {
    const after = plan.manifest.after;
    if (
      after.state !== "present" ||
      after.bytes?.kind !== "bootstrap_expected" ||
      after.bytes.mode !== 0o600
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "manifest after payload is absent");
    }
    if (plan.manifest.before.state !== "absent") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh manifest preimage is not absent");
    }
    const payload = plan.payloads.find((candidate) => sameValue(candidate.ref, after.bytes));
    if (payload === undefined) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "manifest payload evidence is unbound");
    }
    const evidence = await this.readPayloadEvidence(payload);
    const [source, destination, tombstone] = await Promise.all([
      lstatOptional(after.bytes.path),
      lstatOptional(plan.manifest.manifestPath),
      lstatOptional(plan.manifest.tombstonePath),
    ]);
    if (tombstone !== null || (source === null) === (destination === null)) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "manifest publication is in a third state");
    }
    if (source !== null) {
      const admitted = await this.assertExactFile(after.bytes.path, after.bytes);
      this.assertPayloadEvidenceIdentity(plan, payload, evidence, admitted);
      await this.guardedMoveNoReplace(after.bytes.path, plan.manifest.manifestPath, {
        hash: after.bytes.hash,
        ownerUid: uid(),
        mode: after.bytes.mode,
        nlink: 1,
        size: String(after.bytes.bytes),
        dev: evidence.dev,
        ino: evidence.ino,
      });
    }
    const published = await this.assertExactFile(plan.manifest.manifestPath, after.bytes);
    this.assertPayloadEvidenceIdentity(plan, payload, evidence, published);
    await syncDirectory(dirname(after.bytes.path));
    if (dirname(after.bytes.path) !== dirname(plan.manifest.manifestPath)) {
      await syncDirectory(dirname(plan.manifest.manifestPath));
    }
  }

  private async publishManifest(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "manifest_publishing") return journal;
    if (journal.manifestCursor === 0) {
      journal = await this.writeJournal(plan, journal, { manifestCursor: 1 });
      this.trace("manifest:preserve");
      this.checkpoint("after_manifest_preserve");
    }
    if (journal.manifestCursor === 1) {
      await this.applyManifestPublication(plan);
      journal = await this.writeJournal(plan, journal, { manifestCursor: 2 });
      this.trace("manifest:publish");
      this.checkpoint("after_manifest_publish");
    }
    return this.writeJournal(plan, journal, { phase: "verifying" });
  }

  private async readManifest(plan: FreshV2InitPlanV1): Promise<InstallationManifestV2> {
    const request = this.requestFromPlan(plan);
    const bytes = await nodeFs.readFile(this.#dependencies.paths.manifestFile);
    const value = decodeCanonicalJson(bytes, 64 * 1024 * 1024);
    return validateManifestV2(value, this.manifestAdmission(request, this.packageRootFromPlan(plan)));
  }

  private async assertCompleteManifest(
    plan: FreshV2InitPlanV1,
    manifest: InstallationManifestV2,
  ): Promise<void> {
    for (const artifact of manifest.artifacts) {
      const stats = await nodeFs.lstat(artifact.path);
      if (stats.uid !== uid() || stats.isSymbolicLink()) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "V2 artifact changed ownership or type");
      }
      if (artifact.kind === "directory") {
        if (!stats.isDirectory() || mode(stats) !== 0o700) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "V2 directory handoff is incomplete");
        }
        continue;
      }
      const planned = [...plan.createdPaths, ...plan.launchabilityPaths]
        .find((candidate) => candidate.path === artifact.path);
      const expectedMode = planned?.kind === "file" ? planned.payload.mode : 0o600;
      if (!stats.isFile() || stats.nlink !== 1 || mode(stats) !== expectedMode) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "V2 file handoff is incomplete");
      }
      if (
        artifact.verification.mode !== "ephemeral" &&
        lowerHash(await nodeFs.readFile(artifact.path)) !== artifact.verification.installedHash
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "V2 file handoff hash changed");
      }
    }
  }

  private async verify(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<FreshV2InitJournalV1> {
    let journal = starting;
    if (journal.phase !== "verifying") return journal;
    const manifest = await this.readManifest(plan);
    await this.assertCompleteManifest(plan, manifest);
    this.trace("verify:v2");
    if (journal.manifestCursor === 2) {
      journal = await this.writeJournal(plan, journal, { manifestCursor: 3 });
    }
    this.checkpoint("after_verify");
    return this.writeJournal(plan, journal, {
      phase: "finalized",
      terminalOutcome: "finalized",
    });
  }

  private async compensate(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<void> {
    if (starting.manifestCursor >= 2) return;
    let journal = starting;
    const ordinaryBase = plan.payloads.length;
    const foundationBase = ordinaryBase + plan.createdPaths.length;
    const reached =
      journal.nextPayload +
      (journal.payloadWriteState.state === "idle" ? 0 : 1) +
      journal.nextCreatedPath +
      journal.nextFoundationParticipant +
      journal.nextLaunchabilityPath +
      Math.min(journal.manifestCursor, 1);

    if (journal.phase !== "compensating") {
      journal = await this.writeJournal(plan, journal, {
        phase: "compensating",
        direction: "compensating",
        compensationNext: reached - 1,
      });
    }
    while ((journal.compensationNext ?? -1) >= 0) {
      const cursor = journal.compensationNext as number;
      if (cursor === foundationBase) {
        const compensation = plan.foundationParticipants.find(
          (participant) => participant.role.kind === "compensation",
        );
        if (compensation === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation compensation participant is missing");
        }
        const admitted = await this.admittedFoundation(compensation, plan);
        await this.#dependencies.transactionExecutor.executeBootstrapFoundationParticipant(admitted);
        this.trace(`foundation:compensation:apply:${compensation.id}`);
      } else if (cursor < ordinaryBase) {
        const row = plan.payloads[cursor];
        if (row === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload retention cursor escaped plan");
        }
        journal = await this.writeJournal(plan, journal, {
          payloadRetentionPart: "staged_file",
        });
        const reachedFoundation = plan.foundationParticipants.find((participant) => {
          const forwardId = participant.role.kind === "forward"
            ? participant.id
            : participant.role.forwardId;
          const ordinal = plan.foundationParticipants
            .filter((candidate) => candidate.role.kind === "forward")
            .findIndex((candidate) => candidate.id === forwardId);
          return ordinal >= 0 && ordinal < journal.nextFoundationParticipant && (
            participant.initialJournal.staged.ordinal === cursor ||
            participant.mutations.some((mutation) =>
              mutation.content?.ordinal === cursor || mutation.digest?.ordinal === cursor)
          );
        });
        const foundationMutation = reachedFoundation?.mutations.find((mutation) =>
          mutation.content?.ordinal === cursor || mutation.digest?.ordinal === cursor,
        );
        const reachedConsumer = [
          ...plan.createdPaths.slice(0, journal.nextCreatedPath),
          ...plan.launchabilityPaths.slice(0, journal.nextLaunchabilityPath),
        ].find((candidate) => candidate.kind === "file" && candidate.payload.ordinal === cursor);
        const retainedPath = reachedFoundation?.initialJournal.staged.ordinal === cursor
          ? reachedFoundation.initialJournal.finalPath
          : foundationMutation?.content?.ordinal === cursor && reachedFoundation?.role.kind === "forward"
            ? foundationMutation.targetPath
            : foundationMutation?.digest?.ordinal === cursor && foundationMutation.stagedPath !== null
              ? `${foundationMutation.stagedPath}.sha256` as CanonicalAbsolutePathV1
              : reachedConsumer?.path ?? row.ref.path;
        const payload = await projectBootstrapRetentionPostimage(retainedPath);
        const writing = journal.payloadWriteState;
        if (writing.state === "writing" && writing.ordinal === cursor) {
          if (
            payload?.kind !== "regular_file" ||
            payload.dev !== writing.dev ||
            payload.ino !== writing.ino ||
            BigInt(payload.bytes) > BigInt(row.ref.bytes)
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "interrupted payload changed persisted identity");
          }
        } else {
          const evidence = await this.readPayloadEvidence(row);
          if (
            payload?.kind !== "regular_file" ||
            payload.dev !== evidence.dev ||
            payload.ino !== evidence.ino
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload changed persisted evidence identity");
          }
        }
        journal = await this.writeJournal(plan, journal, {
          payloadRetentionPart: "evidence",
        });
      }
      journal = await this.writeJournal(plan, journal, {
        compensationNext: cursor - 1,
        payloadRetentionPart: null,
      });
    }
    await this.writeJournal(plan, journal, {
      phase: "rolled_back",
      terminalOutcome: "rolled_back",
    });
    this.checkpoint("after_rolled_back");
  }

  private async buildRetentionEvidence(
    plan: FreshV2InitPlanV1,
    terminal: FreshV2InitJournalV1,
  ): Promise<BootstrapRetentionEvidenceProjectionV1> {
    return buildBootstrapRetentionEvidence(
      createBootstrapEvidenceInspectionRequest({
        productHome: this.#dependencies.paths.home,
        stateDirectory: this.#dependencies.paths.stateDir,
        initialRoots: [
          this.#dependencies.paths.home,
          this.#dependencies.paths.stateDir,
          this.#dependencies.userHome,
        ],
      }),
      plan,
      terminal,
    );
  }
  private async retainTerminal(
    plan: FreshV2InitPlanV1,
    store: BootstrapJournalStore,
    current: FreshV2InitJournalV1,
  ): Promise<void> {
    const terminal = this.terminalJournal(current);
    if (terminal === null) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap retention has no terminal state");
    }
    const evidence = this.#retentionEvidence.get(plan.id) ??
      await this.buildRetentionEvidence(plan, terminal);
    this.#retentionEvidence.set(plan.id, evidence);
    let table: readonly ReturnType<typeof deriveBootstrapRetentionTable>[number][];
    try {
      table = deriveBootstrapRetentionTable(plan, evidence);
    } catch {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "retention table derivation failed",
      );
    }
    const held = this.#heldLocks.get(plan.id);
    const globalReached = terminal.nextCreatedPath > 0;
    if (
      held?.bootstrap === null ||
      held?.bootstrap === undefined ||
      globalReached !== (held.global !== null)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal retention lock reachability is unbound");
    }
    this.checkpoint("during_retention");
    const retainer = new BootstrapRetainer({
      renameSameParentNoReplace: this.#dependencies.renameSameParentNoReplace,
      syncDirectory: (path) => syncDirectory(path),
      projectPostimage: projectBootstrapRetentionPostimage,
      interrupt: (point) => {
        this.checkpoint(point);
      },
    });
    await retainBootstrapEnvelope(table, store, retainer, {
      bootstrap: held.bootstrap.handle,
      global: held.global?.handle ?? null,
    });
    this.#heldLocks.delete(plan.id);
  }
}
