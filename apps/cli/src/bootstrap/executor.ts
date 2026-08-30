import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  admitBootstrapFoundationInitialJournal,
  bootstrapExternalShapeHash,
  bootstrapPayloadSourceIdentityHash,
  decodeCanonicalJson,
  deriveBootstrapCreationEvidencePaths,
  deriveBootstrapEnvelopePaths,
  deriveBootstrapPayloadEvidencePaths,
  encodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  inspectBootstrapClosure,
  ManifestStateParticipant,
  serializeConfig,
  validateBootstrapExternalShapeProjection,
  validateBootstrapJournal,
  validateBootstrapPlan,
  validateManifestStatePlan,
  validateManifestV2,
  validateJournal,
} from "@developer-os/core";
import type {
  BootstrapClosureV1,
  BootstrapClosureAdmissionContextV1,
  BootstrapInventoryV1,
  BootstrapExpectedPayloadRefV1,
  BootstrapExternalShapeProjectionV1,
  BootstrapPlanAdmissionContextV1,
  BootstrapPayloadEvidenceV1,
  BootstrapPayloadPlanV1,
  BootstrapPayloadSourceV1,
  BootstrapTempInventoryV1,
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
} from "@developer-os/core";

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

type FreshCompactionEntryV1 =
  | { readonly kind: "payload"; readonly ordinal: number }
  | { readonly kind: "creation"; readonly scope: "ordinary" | "launchability"; readonly ordinal: number }
  | { readonly kind: "foundation"; readonly ordinal: number }
  | { readonly kind: "staging"; readonly path: CanonicalAbsolutePathV1 }
  | { readonly kind: "journal" };

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
  { name: "during_compaction" },
] as const;

export const freshInitFineGrainedDeathPoints = [
  { name: "during_plan_temp" },
  { name: "after_plan_temp_sync" },
  { name: "after_plan_link" },
  { name: "after_plan_publication_parent_sync" },
  { name: "after_plan_temp_unlink" },
  { name: "after_plan_temp_parent_sync" },
  { name: "during_journal_temp" },
  { name: "after_journal_temp_sync" },
  { name: "after_journal_link" },
  { name: "after_journal_publication_parent_sync" },
  { name: "after_journal_temp_unlink" },
  { name: "after_journal_temp_parent_sync" },
  { name: "after_payload_create_intent" },
  { name: "after_payload_empty_create" },
  { name: "after_payload_writing_intent" },
  { name: "during_payload_write" },
  { name: "after_payload_file_sync" },
  { name: "after_payload_evidence" },
  { name: "after_global_lock_create" },
  { name: "before_global_lock_parent_sync" },
  { name: "after_global_lock_parent_sync" },
  { name: "after_directory_create" },
  { name: "before_directory_parent_sync" },
  { name: "after_directory_parent_sync" },
  { name: "after_file_link" },
  { name: "before_file_parent_sync" },
  { name: "after_file_parent_sync" },
  { name: "after_file_source_unlink" },
  { name: "after_file_source_parent_sync" },
  { name: "after_compensation_unlink" },
  { name: "before_compensation_unlink_parent_sync" },
  { name: "after_compensation_unlink_parent_sync" },
  { name: "after_compensation_rmdir" },
  { name: "before_compensation_rmdir_parent_sync" },
  { name: "after_compensation_rmdir_parent_sync" },
  { name: "after_bootstrap_lock_unlink" },
  { name: "after_bootstrap_lock_parent_sync" },
  { name: "after_journal_unlink" },
  { name: "after_journal_parent_sync" },
  { name: "after_plan_unlink" },
  { name: "after_plan_parent_sync" },
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
  readonly now: () => Date;
  readonly uuid?: () => string;
  readonly nonce?: () => Uint8Array;
  readonly trace?: (event: string) => void;
  readonly interrupt?: (point: FreshInitDeathPointV1) => void;
  readonly fail?: (point: FreshInitDeathPointV1) => void;
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

async function syncDirectoryIfPresent(path: string): Promise<void> {
  if (await lstatOptional(path) === null) return;
  await syncDirectory(path);
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
    const removed = await nodeFs.unlink(path).then(() => true).catch(() => false);
    if (removed) await syncDirectory(dirname(path));
    throw error;
  }
  await handle.close();
  await syncDirectory(dirname(path));
}

async function durableReplace(path: string, bytes: Uint8Array): Promise<void> {
  const match = /^(fresh-v2-init|manifest-migration)\.(fi_|mm_)([0-9a-f-]+)\.journal\.json$/u.exec(
    basename(path),
  );
  if (match === null) {
    throw new FreshBootstrapError(
      EXIT_CODES.securityRefusal,
      "bootstrap journal replacement path is not canonical",
    );
  }
  const [, operation, idPrefix, idSuffix] = match;
  if (operation === undefined || idPrefix === undefined || idSuffix === undefined) {
    throw new FreshBootstrapError(
      EXIT_CODES.securityRefusal,
      "bootstrap journal replacement path groups are incomplete",
    );
  }
  const temporary = join(
    dirname(path),
    `.${operation}.${idPrefix}${idSuffix}.${randomUUID()}.journal.json.tmp`,
  );
  await durableWriteNoReplace(temporary, bytes);
  await nodeFs.rename(temporary, path);
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

function foundationLockPath(participant: FoundationParticipantRefV2): string {
  return join(dirname(participant.initialJournal.finalPath), `.${participant.id}.lock`);
}

export class BootstrapExecutor {
  readonly #dependencies: BootstrapExecutorDependencies;
  readonly #heldLocks = new Map<string, HeldLifecycleLocks>();

  constructor(dependencies: BootstrapExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  private trace(event: string): void {
    this.#dependencies.trace?.(event);
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
    journal: FreshV2InitJournalV1,
  ): Promise<void> {
    const retained = this.#heldLocks.get(plan.id);
    if (retained?.bootstrap !== null && retained?.bootstrap !== undefined) return;
    const existed = await lstatOptional(plan.bootstrapIdentity.path);
    const bootstrap = await this.acquireLifecycleLock(plan.bootstrapIdentity.path);
    const journalEntry = this.compactionTable(plan).length - 1;
    const replacementAllowed =
      journal.phase === "compacting" &&
      journal.compactionNext === journalEntry &&
      journal.terminalOutcome !== null;
    if (
      !replacementAllowed &&
      (existed === null ||
        bootstrap.dev !== plan.bootstrapIdentity.dev ||
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
    return decodeCanonicalJson(await nodeFs.readFile(path), 1024) as unknown as CreatedPathEvidenceV1;
  }

  private async ensureGlobalLock(plan: FreshV2InitPlanV1, journal: FreshV2InitJournalV1): Promise<void> {
    const retained = this.#heldLocks.get(plan.id);
    if (retained?.global !== null && retained?.global !== undefined) return;
    const planned = plan.createdPaths[0];
    if (planned?.kind !== "global_lock") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock is not ordinal zero");
    }
    const global = await this.acquireLifecycleLock(planned.path);
    const evidence = await this.readCreationEvidence(plan, "ordinary", 0).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
      return null;
    });
    if (evidence === null) {
      const creationEntry = this.compactionTable(plan).findIndex((entry) =>
        entry.kind === "creation" && entry.scope === "ordinary" && entry.ordinal === 0,
      );
      if (
        journal.phase !== "compacting" || journal.terminalOutcome !== "finalized" ||
        journal.compactionNext === null || journal.compactionNext <= creationEntry
      ) {
        await global.handle.release().catch(() => undefined);
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "global lock creation evidence disappeared before compaction authorized it");
      }
      this.#heldLocks.set(plan.id, { bootstrap: retained?.bootstrap ?? null, global });
      this.trace("lock:global");
      return;
    }
    if (
      evidence.kind !== "global_lock" ||
      evidence.pathHash !== pathHash(planned.path) ||
      evidence.dev !== global.dev ||
      evidence.ino !== global.ino ||
      evidence.postimageHash !== EMPTY_HASH
    ) {
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

  private envelopeTemporaryPath(
    plan: FreshV2InitPlanV1,
    kind: "plan" | "journal",
  ): string {
    const uuid = (this.#dependencies.uuid ?? randomUUID)();
    return join(
      this.#dependencies.paths.stateDir,
      `.fresh-v2-init.${plan.id}.${uuid}.${kind}.json.tmp`,
    );
  }

  private async publishInitialEnvelope(
    plan: FreshV2InitPlanV1,
    kind: "plan" | "journal",
    bytes: Uint8Array,
  ): Promise<void> {
    const finalPath = kind === "plan" ? plan.planPath : plan.journalPath;
    const temporary = this.envelopeTemporaryPath(plan, kind);
    const handle = await nodeFs.open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const split = Math.floor(bytes.byteLength / 2);
      let offset = 0;
      while (offset < split) {
        const result = await handle.write(bytes, offset, split - offset, offset);
        if (result.bytesWritten < 1) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap envelope write made no progress");
        }
        offset += result.bytesWritten;
      }
      this.checkpoint(kind === "plan" ? "during_plan_temp" : "during_journal_temp");
      while (offset < bytes.byteLength) {
        const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesWritten < 1) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap envelope write made no progress");
        }
        offset += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryStats = await this.assertExactFile(temporary, {
      hash: lowerHash(bytes),
      bytes: bytes.byteLength,
      mode: 0o600,
    });
    this.checkpoint(kind === "plan" ? "after_plan_temp_sync" : "after_journal_temp_sync");
    if (await lstatOptional(finalPath) !== null) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap envelope final already exists");
    }
    await nodeFs.link(temporary, finalPath);
    this.checkpoint(kind === "plan" ? "after_plan_link" : "after_journal_link");
    await syncDirectory(dirname(finalPath));
    this.checkpoint(kind === "plan" ? "after_plan_publication_parent_sync" : "after_journal_publication_parent_sync");
    const finalStats = await nodeFs.lstat(finalPath);
    if (
      finalStats.dev !== temporaryStats.dev ||
      finalStats.ino !== temporaryStats.ino ||
      finalStats.nlink !== 2
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap envelope publication changed inode");
    }
    await nodeFs.unlink(temporary);
    this.checkpoint(kind === "plan" ? "after_plan_temp_unlink" : "after_journal_temp_unlink");
    await syncDirectory(dirname(temporary));
    this.checkpoint(kind === "plan" ? "after_plan_temp_parent_sync" : "after_journal_temp_parent_sync");
    await this.assertExactFile(finalPath, {
      hash: lowerHash(bytes),
      bytes: bytes.byteLength,
      mode: 0o600,
    });
  }

  async previewFreshInit(request: FreshInitRequestV1): Promise<FreshInitPreviewV1> {
    await this.cleanupGuardedPlanTemp();
    const existing = await this.existingPlan();
    if (existing !== null) {
      try {
        const closure = await this.inspectFreshClosure(existing);
        if (closure.state === "guarded_cleanable_plan_temp" || closure.state === "clear") {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh recovery plan disappeared during admission");
        }
        const admitted = closure.plan as FreshV2InitPlanV1;
        const source = admitted.payloads
          .map((row) => row.source)
          .find((candidate) => candidate.kind === "plan_derived" && candidate.role === "manifest_after");
        if (source?.kind !== "plan_derived") {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan has no retained manifest preview");
        }
        const manifest = source.value as unknown as InstallationManifestV2;
        const retainedRequest = this.requestFromPlan(admitted);
        return {
          schemaVersion: 2,
          productHome: this.#dependencies.paths.home,
          brainPath: retainedRequest.brainPath,
          created: manifest.artifacts.map((artifact) => artifact.path),
          unchanged: [],
        };
      } finally {
        await this.releaseLifecycleLocks(existing.id).catch(() => undefined);
      }
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

  async initializeFresh(request: FreshInitRequestV1): Promise<FreshInitOutcomeV1> {
    await this.cleanupGuardedPlanTemp();
    const existing = await this.existingPlan();
    if (existing !== null) {
      const closure = await this.inspectFreshClosure(existing);
      if (closure.state === "guarded_cleanable_plan_orphan") {
        const plan = closure.plan as FreshV2InitPlanV1;
        try {
          await nodeFs.unlink(plan.planPath);
          await syncDirectory(dirname(plan.planPath));
        } finally {
          await this.releaseLifecycleLocks(existing.id).catch(() => undefined);
        }
      } else if (
        closure.state === "recovery_required" ||
        closure.state === "plan_last_compaction" ||
        closure.state === "guarded_cleanable_journal_temp"
      ) {
        return this.executeClosure(closure);
      } else {
        await this.releaseLifecycleLocks(existing.id).catch(() => undefined);
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh closure is not executable");
      }
    }
    const plan = await this.planFreshInit(request);
    return this.executeFreshInit(plan);
  }

  private async cleanupGuardedPlanTemp(): Promise<void> {
    const state = await lstatOptional(this.#dependencies.paths.stateDir);
    if (state === null) return;
    const names = await nodeFs.readdir(this.#dependencies.paths.stateDir);
    const finals = names.filter((name) => /^fresh-v2-init\.fi_[0-9a-f-]+\.plan\.json$/u.test(name));
    const temps = names.filter((name) => /^\.fresh-v2-init\.fi_[0-9a-f-]+\.[0-9a-f-]+\.plan\.json\.tmp$/u.test(name));
    if (finals.length > 1) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "multiple fresh plans require recovery");
    }
    if (finals.length === 1) {
      const finalName = finals[0] as string;
      const id = /^fresh-v2-init\.(fi_[0-9a-f-]+)\.plan\.json$/u.exec(finalName)?.[1] as FreshV2InitIdV1 | undefined;
      if (id === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan name changed");
      const bootstrapPath = join(this.#dependencies.paths.stateDir, ".lifecycle-bootstrap.lock");
      const bootstrap = await this.acquireLifecycleLock(bootstrapPath);
      this.#heldLocks.set(id, { bootstrap, global: null });
      try {
        const normalize = async (finalPath: string, temporaryPath: string, maximum: number): Promise<void> => {
          const [finalStats, temporaryStats] = await Promise.all([
            lstatOptional(finalPath),
            nodeFs.lstat(temporaryPath),
          ]);
          if (
            !temporaryStats.isFile() || temporaryStats.isSymbolicLink() ||
            temporaryStats.uid !== uid() || mode(temporaryStats) !== 0o600 ||
            temporaryStats.size > maximum
          ) {
            this.trace(`inventory:prefix-shape:${String(temporaryStats.uid)}:${String(mode(temporaryStats))}:${String(temporaryStats.size)}:${String(temporaryStats.nlink)}`);
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap envelope prefix changed shape");
          }
          if (finalStats !== null) {
            if (
              finalStats.dev === temporaryStats.dev &&
              finalStats.ino === temporaryStats.ino &&
              finalStats.nlink === 2 &&
              temporaryStats.nlink === 2
            ) {
              await syncDirectory(this.#dependencies.paths.stateDir);
            } else if (temporaryPath.endsWith(".plan.json.tmp")) {
              throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan final and prefix are a third state");
            } else if (temporaryStats.nlink !== 1) {
              throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh journal prefix changed link count");
            }
          } else if (temporaryStats.nlink !== 1) {
            throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh envelope prefix changed link count");
          }
          await nodeFs.unlink(temporaryPath);
          await syncDirectory(this.#dependencies.paths.stateDir);
        };
        const planTemps = names.filter((name) => name.startsWith(`.fresh-v2-init.${id}.`) && name.endsWith(".plan.json.tmp"));
        const journalTemps = names.filter((name) => name.startsWith(`.fresh-v2-init.${id}.`) && name.endsWith(".journal.json.tmp"));
        if (planTemps.length > 1 || journalTemps.length > 1) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "multiple fresh envelope prefixes require recovery");
        }
        if (planTemps[0] !== undefined) {
          await normalize(
            join(this.#dependencies.paths.stateDir, finalName),
            join(this.#dependencies.paths.stateDir, planTemps[0]),
            MAX_PLAN_BYTES,
          );
        }
        if (journalTemps[0] !== undefined) {
          await normalize(
            join(this.#dependencies.paths.stateDir, `fresh-v2-init.${id}.journal.json`),
            join(this.#dependencies.paths.stateDir, journalTemps[0]),
            MAX_JOURNAL_BYTES,
          );
        }
      } finally {
        await this.releaseLifecycleLocks(id).catch(() => undefined);
      }
      return;
    }
    if (temps.length === 0) return;
    if (temps.length !== 1) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "multiple fresh plan prefixes require recovery");
    }
    const temporaryName = temps[0] as string;
    const match = /^\.fresh-v2-init\.(fi_[0-9a-f-]+)\.[0-9a-f-]+\.plan\.json\.tmp$/u.exec(temporaryName);
    const id = match?.[1] as FreshV2InitIdV1 | undefined;
    if (id === undefined) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan prefix name changed");
    }
    const bootstrapPath = join(this.#dependencies.paths.stateDir, ".lifecycle-bootstrap.lock");
    const bootstrap = await this.acquireLifecycleLock(bootstrapPath);
    this.#heldLocks.set(id, { bootstrap, global: null });
    try {
      const allowedState = new Set([".lifecycle-bootstrap.lock", temporaryName]);
      if (names.some((name) => !allowedState.has(name))) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan prefix has an unprojected sibling");
      }
      const homeNames = await nodeFs.readdir(this.#dependencies.paths.home);
      if (homeNames.length !== 1 || homeNames[0] !== "state") {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh plan prefix changed the pre-intent home");
      }
      const temporary = join(this.#dependencies.paths.stateDir, temporaryName);
      const stats = await nodeFs.lstat(temporary);
      if (
        !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() ||
        stats.nlink !== 1 || mode(stats) !== 0o600 || stats.size > MAX_PLAN_BYTES
      ) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "fresh plan prefix changed shape");
      }
      await nodeFs.unlink(temporary);
      await syncDirectory(this.#dependencies.paths.stateDir);
    } finally {
      await this.releaseLifecycleLocks(id).catch(() => undefined);
    }
  }

  async planFreshInit(request: FreshInitRequestV1): Promise<FreshV2InitPlanV1> {
    const packaged = await inspectPackagedRelease(this.#dependencies.packagedRelease);
    const preview = await this.previewNewFreshInit(request, packaged);
    const paths = this.#dependencies.paths;
    const uuid = (this.#dependencies.uuid ?? randomUUID)();
    const id = `fi_${uuid}` as FreshV2InitIdV1;
    const homeBefore = await lstatOptional(paths.home);
    if (homeBefore !== null) {
      if (!homeBefore.isDirectory() || homeBefore.isSymbolicLink()) {
        throw new FreshBootstrapError(EXIT_CODES.invalidInput, "product home is not a directory");
      }
      const entries = await nodeFs.readdir(paths.home);
      const stateBefore = await lstatOptional(paths.stateDir);
      const resumableSkeleton =
        entries.length === 1 &&
        entries[0] === "state" &&
        stateBefore !== null &&
        stateBefore.isDirectory() &&
        !stateBefore.isSymbolicLink() &&
        mode(stateBefore) === 0o700 &&
        (await nodeFs.readdir(paths.stateDir)).every((name) => name === ".lifecycle-bootstrap.lock");
      if (entries.length !== 0 && !resumableSkeleton) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "product home is not a fresh installation");
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
      const [homeStats, stateStats, lockStats] = await Promise.all([
        nodeFs.lstat(paths.home),
        nodeFs.lstat(paths.stateDir),
        nodeFs.lstat(bootstrapLock),
      ]);
      const externalShape = validateBootstrapExternalShapeProjection({
        entries: [
          this.externalShapeEntry("product_home", paths.home, homeStats),
          this.externalShapeEntry("state_directory", paths.stateDir, stateStats),
          this.externalShapeEntry("bootstrap_lock", bootstrapLock, lockStats),
        ],
      });
      this.trace("inventory:second");

      const brainStats = await lstatOptional(request.brainPath);
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
      });
      const admission = this.planAdmission(built.plan, packaged, externalShape);
      const admitted = validateBootstrapPlan(built.plan, admission) as FreshV2InitPlanV1;

      await this.publishInitialEnvelope(
        admitted,
        "plan",
        encoder.encode(encodeCanonicalJson(admitted as unknown as CanonicalJsonValue)),
      );
      this.trace("intent:plan");
      this.checkpoint("after_plan");
      const journal = this.initialJournal(admitted);
      await this.publishInitialEnvelope(
        admitted,
        "journal",
        encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)),
      );
      this.trace("intent:journal");
      this.checkpoint("after_journal");
      return admitted;
    } catch (error) {
      await this.releaseLifecycleLocks(id).catch(() => undefined);
      throw error;
    }
  }

  private async executeClosure(closure: BootstrapClosureV1): Promise<FreshInitOutcomeV1> {
    if (closure.state === "guarded_cleanable_journal_temp") {
      try {
        const stats = await nodeFs.lstat(closure.temporary.path);
        if (
          !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() || stats.nlink !== 1 ||
          String(stats.dev) !== closure.temporary.dev || String(stats.ino) !== closure.temporary.ino
        ) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "journal prefix changed after closure admission");
        }
        await nodeFs.unlink(closure.temporary.path);
        await syncDirectory(dirname(closure.temporary.path));
        if (closure.finalJournal === "absent") {
          const admittedPlan = closure.plan as FreshV2InitPlanV1;
          const journal = this.initialJournal(admittedPlan);
          await this.publishInitialEnvelope(
            admittedPlan,
            "journal",
            encoder.encode(encodeCanonicalJson(journal as unknown as CanonicalJsonValue)),
          );
        }
        return await this.executeFreshInit(closure.plan as FreshV2InitPlanV1);
      } catch (error) {
        await this.releaseLifecycleLocks(closure.plan.id).catch(() => undefined);
        throw error;
      }
    }
    if (closure.state === "plan_last_compaction") {
      const plan = closure.plan as FreshV2InitPlanV1;
      try {
        if (closure.terminalOutcome === "finalized") {
          await this.acquireTerminalGlobalLock(plan);
          const manifest = await this.readManifest(plan);
          await this.assertCompleteManifest(plan, manifest);
          const held = this.#heldLocks.get(plan.id)?.bootstrap;
          const bootstrapStats = await lstatOptional(plan.bootstrapIdentity.path);
          if (
            bootstrapStats !== null &&
            (held === null || held === undefined || held.dev !== String(bootstrapStats.dev) || held.ino !== String(bootstrapStats.ino))
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "terminal bootstrap lock changed identity");
          }
          if (bootstrapStats !== null) await nodeFs.unlink(plan.bootstrapIdentity.path);
          await syncDirectory(dirname(plan.bootstrapIdentity.path));
          await nodeFs.unlink(plan.planPath);
          await syncDirectory(dirname(plan.planPath));
          const request = this.requestFromPlan(plan);
          return {
            schemaVersion: 2,
            productHome: this.#dependencies.paths.home,
            brainPath: request.brainPath,
            created: manifest.artifacts.map((artifact) => artifact.path),
            unchanged: [],
            manifest,
            transactionId: plan.id,
          };
        }
        await nodeFs.unlink(plan.planPath);
        await syncDirectory(dirname(plan.planPath));
        const request = this.requestFromPlan(plan);
        await this.releaseLifecycleLocks(plan.id);
        const replacement = await this.planFreshInit(request);
        return await this.executeFreshInit(replacement);
      } finally {
        await this.releaseLifecycleLocks(plan.id).catch(() => undefined);
      }
    }
    if (closure.state !== "recovery_required" || closure.plan.operation !== "fresh_v2_init") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap closure is not resumable by fresh init");
    }
    const admitted = closure.plan;
    let journal = closure.journal as FreshV2InitJournalV1;
    try {
      await this.ensureBootstrapLock(admitted, journal);
      if (journal.nextCreatedPath > 0 && journal.terminalOutcome !== "rolled_back") {
        await this.ensureGlobalLock(admitted, journal);
      }
      const packaged = journal.nextPayload < admitted.payloads.length
        ? await inspectPackagedRelease(this.#dependencies.packagedRelease)
        : null;
      try {
        journal = await this.stagePayloads(admitted, journal, packaged);
        journal = await this.createOrdinary(admitted, journal);
        journal = await this.applyFoundation(admitted, journal);
        journal = await this.publishLaunchability(admitted, journal);
        journal = await this.publishManifest(admitted, journal);
        journal = await this.verify(admitted, journal);
        const manifest = await this.compact(admitted, journal);
        const request = this.requestFromPlan(admitted);
        const brainCreated = manifest.artifacts.some(
          (artifact) => artifact.path === request.brainPath,
        );
        return {
          schemaVersion: 2,
          productHome: this.#dependencies.paths.home,
          brainPath: request.brainPath,
          created: manifest.artifacts.map((artifact) => artifact.path),
          unchanged: brainCreated ? [] : [request.brainPath],
          manifest,
          transactionId: admitted.foundationParticipants.find((participant) => participant.role.kind === "forward")?.id ?? admitted.id,
        };
      } catch (error) {
        if (error instanceof FreshBootstrapInterruption) throw error;
        if (journal.manifestCursor < 2) {
          const latest = await this.readOrCreateJournal(admitted).catch(() => journal);
          await this.compensate(admitted, latest);
        }
        throw error;
      }
    } finally {
      await this.releaseLifecycleLocks(admitted.id).catch(() => undefined);
    }
  }

  async executeFreshInit(plan: FreshV2InitPlanV1): Promise<FreshInitOutcomeV1> {
    return this.executeClosure(await this.inspectFreshClosure(plan));
  }

  async recover(closure: BootstrapClosureV1): Promise<FreshInitOutcomeV1> {
    if (!("plan" in closure) || closure.plan.operation !== "fresh_v2_init") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap closure is not resumable by fresh init");
    }
    return this.executeFreshInit(closure.plan);
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
    readonly homeStats: Stats;
    readonly stateStats: Stats;
    readonly lockStats: Stats;
    readonly brainStats: Stats | null;
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

    const nonce = Buffer.from((this.#dependencies.nonce ?? (() => randomBytes(32)))()).toString("hex") as LowerHexSha256;
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
      ...ordinaryDirectories.map((path) => ({ kind: "directory" as const, path })),
      ...[...fileRefs].map(([path, payload]) => ({ kind: "file" as const, path, payload })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const preexisting = new Map<string, Stats>([
      [paths.home, input.homeStats],
      [paths.stateDir, input.stateStats],
      ...(input.brainStats === null ? [] : [[input.request.brainPath, input.brainStats] as const]),
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
      journalPath: envelope.journal,
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
    preexisting: ReadonlyMap<string, Stats>,
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

  private pathEvidence() {
    return {
      reopenCanonicalAbsolutePath: (path: string) => resolve(path),
      containsCanonicalPath: (root: string, candidate: string) =>
        candidate === root || candidate.startsWith(`${root}/`),
      hasFoldedAlias: () => false,
    };
  }

  private manifestAdmission(
    request: FreshInitRequestV1,
    packageRoot: string,
  ): ManifestAdmissionContextV1 {
    const productHome = this.#dependencies.paths.home;
    return {
      evidence: this.pathEvidence(),
      sourceRoot: packageRoot as CanonicalAbsolutePathV1,
      backupRoot: this.#dependencies.paths.backupsDir as CanonicalAbsolutePathV1,
      admitOwnerPath: (_owner, path) =>
        path === productHome ||
        path.startsWith(`${productHome}/`) ||
        path === request.brainPath ||
        path.startsWith(`${request.brainPath}/`)
          ? path
          : `${path}/outside-authority` as CanonicalAbsolutePathV1,
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
      evidence: this.pathEvidence(),
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
      evidence: this.pathEvidence(),
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

  private async walkProductHomeBounded(maximumEntries: number): Promise<readonly string[]> {
    const root = this.#dependencies.paths.home;
    const entries: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const names = await nodeFs.readdir(directory);
      names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      for (const name of names) {
        const path = join(directory, name);
        const stats = await nodeFs.lstat(path);
        if (stats.isSymbolicLink()) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap closure contains a symbolic link");
        }
        entries.push(path);
        if (entries.length > maximumEntries) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap closure exceeded its admitted entry bound");
        }
        if (stats.isDirectory()) await visit(path);
      }
    };
    await visit(root);
    return entries;
  }

  private closureAllowedPaths(plan: FreshV2InitPlanV1, observed: readonly string[]): ReadonlySet<string> {
    const home = this.#dependencies.paths.home;
    const allowed = new Set<string>();
    const add = (path: string): void => {
      if (path !== home && !path.startsWith(`${home}/`)) return;
      let cursor = path;
      while (cursor !== home) {
        allowed.add(cursor);
        cursor = dirname(cursor);
      }
    };
    add(plan.bootstrapIdentity.path);
    add(plan.planPath);
    add(plan.journalPath);
    add(this.#dependencies.paths.manifestFile);
    add(plan.manifest.tombstonePath);
    for (const row of plan.payloads) {
      add(row.ref.path);
      add(deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID()).evidence);
    }
    for (const [scope, paths] of [
      ["ordinary", plan.createdPaths],
      ["launchability", plan.launchabilityPaths],
    ] as const) {
      for (const [ordinal, planned] of paths.entries()) {
        add(planned.path);
        add(deriveBootstrapCreationEvidencePaths(
          home as CanonicalAbsolutePathV1,
          "fresh_v2_init",
          plan.id,
          scope,
          ordinal,
          randomUUID(),
        ).evidence);
      }
    }
    for (const participant of plan.foundationParticipants) {
      add(participant.initialJournal.finalPath);
      add(foundationLockPath(participant));
      add(join(this.#dependencies.paths.stagingDir, "transactions", participant.id));
      add(join(this.#dependencies.paths.backupsDir, "transactions"));
      add(join(this.#dependencies.paths.backupsDir, "transactions", participant.id));
      for (const [ordinal, mutation] of participant.mutations.entries()) {
        add(mutation.targetPath);
        if (mutation.stagedPath !== null) {
          add(mutation.stagedPath);
          add(`${mutation.stagedPath}.sha256`);
        }
        add(join(this.#dependencies.paths.backupsDir, "transactions", participant.id, `${String(ordinal)}.json`));
        add(join(this.#dependencies.paths.backupsDir, "transactions", participant.id, `${String(ordinal)}.json.sha256`));
      }
    }
    for (const path of observed) {
      const name = basename(path);
      if (
        dirname(path) === this.#dependencies.paths.stateDir &&
        (name.startsWith(`.fresh-v2-init.${plan.id}.`) &&
          (name.endsWith(".plan.json.tmp") || name.endsWith(".journal.json.tmp")))
      ) {
        add(path);
      }
    }
    return allowed;
  }

  private async fileObservation(path: string, maximumBytes: number): Promise<CanonicalJsonValue | null> {
    const stats = await lstatOptional(path);
    if (stats === null) return null;
    if (
      !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() ||
      stats.nlink < 1 || stats.nlink > 2 || mode(stats) !== 0o600 ||
      stats.size > maximumBytes
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap closure file changed shape");
    }
    const bytes = await nodeFs.readFile(path);
    return {
      path,
      dev: String(stats.dev),
      ino: String(stats.ino),
      nlink: stats.nlink,
      bytes: stats.size,
      sha256: lowerHash(bytes),
    };
  }

  private payloadCandidatePaths(
    plan: FreshV2InitPlanV1,
    row: BootstrapPayloadPlanV1,
  ): readonly string[] {
    return [
      row.ref.path,
      ...[...plan.createdPaths, ...plan.launchabilityPaths]
        .filter((planned) => planned.kind === "file" && sameValue(planned.payload, row.ref))
        .map((planned) => planned.path),
      ...plan.foundationParticipants
        .filter((participant) => sameValue(participant.initialJournal.staged, row.ref))
        .map((participant) => participant.initialJournal.finalPath),
      ...(plan.manifest.after.state === "present" && sameValue(plan.manifest.after.bytes, row.ref)
        ? [plan.manifest.manifestPath]
        : []),
    ];
  }

  private async admittedPayloadEvidenceSnapshot(
    plan: FreshV2InitPlanV1,
    row: BootstrapPayloadPlanV1,
    journal: FreshV2InitJournalV1,
  ): Promise<BootstrapPayloadEvidenceV1 | null> {
    const evidencePath = deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID()).evidence;
    if (await lstatOptional(evidencePath) === null) return null;
    const evidence = await this.readPayloadEvidence(row);
    const matching: Stats[] = [];
    for (const path of this.payloadCandidatePaths(plan, row)) {
      const stats = await lstatOptional(path);
      if (stats === null) continue;
      if (
        stats.isFile() && !stats.isSymbolicLink() && stats.uid === uid() &&
        (stats.nlink === 1 || stats.nlink === 2) && mode(stats) === row.ref.mode &&
        stats.size === row.ref.bytes && String(stats.dev) === evidence.dev &&
        String(stats.ino) === evidence.ino && lowerHash(await nodeFs.readFile(path)) === row.ref.hash
      ) matching.push(stats);
    }
    if (matching.length < 1 || matching.length > 2) {
      const evidenceMatchesRow =
        evidence.bootstrapId === plan.id && evidence.ordinal === row.ref.ordinal &&
        evidence.stagedPathHash === pathHash(row.ref.path) &&
        evidence.sourceIdentityHash === bootstrapPayloadSourceIdentityHash(row.source) &&
        evidence.bytes === row.ref.bytes && evidence.sha256 === row.ref.hash && evidence.mode === row.ref.mode;
      const consumedFoundationJournal =
        row.source.kind === "plan_derived" &&
        row.source.role === "foundation_initial_journal" &&
        journal.nextFoundationParticipant > 0;
      if (
        evidenceMatchesRow && (consumedFoundationJournal || journal.direction === "compensating")
      ) return evidence;
      this.trace(`inventory:payload-postimage:${String(row.ref.ordinal)}:${row.source.kind === "plan_derived" ? row.source.role : row.source.kind}:${String(matching.length)}`);
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload evidence has no exact inode-bound postimage");
    }
    this.assertPayloadEvidenceIdentity(plan, row, evidence, matching[0] as Stats);
    return evidence;
  }

  private async admittedCreationEvidenceSnapshot(
    plan: FreshV2InitPlanV1,
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
    journal: FreshV2InitJournalV1,
  ): Promise<CreatedPathEvidenceV1 | null> {
    const evidencePath = deriveBootstrapCreationEvidencePaths(
      this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      "fresh_v2_init",
      plan.id,
      scope,
      ordinal,
      randomUUID(),
    ).evidence;
    if (await lstatOptional(evidencePath) === null) return null;
    const evidence = await this.readCreationEvidence(plan, scope, ordinal);
    if (
      evidence.bootstrapId !== plan.id ||
      evidence.scope !== scope || evidence.ordinal !== ordinal ||
      evidence.pathHash !== pathHash(planned.path) || evidence.kind !== planned.kind
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence changed its admitted row");
    }
    const stats = await lstatOptional(planned.path);
    if (stats === null) {
      if (journal.direction !== "compensating" && journal.terminalOutcome !== "rolled_back") {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence lost its target inode");
      }
      return evidence;
    }
    if (
      stats.isSymbolicLink() || stats.uid !== uid() || String(stats.dev) !== evidence.dev ||
      String(stats.ino) !== evidence.ino ||
      (planned.kind === "directory"
        ? !stats.isDirectory() || mode(stats) !== 0o700 || evidence.postimageHash !== null
        : !stats.isFile() || mode(stats) !== (planned.kind === "global_lock" ? 0o600 : planned.payload.mode))
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence target changed identity");
    }
    const expectedPostimage = planned.kind === "directory"
      ? null
      : planned.kind === "global_lock"
        ? EMPTY_HASH
        : planned.payload.hash;
    if (evidence.postimageHash !== expectedPostimage) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence target changed postimage");
    }
    if (planned.kind === "file" && lowerHash(await nodeFs.readFile(planned.path)) !== planned.payload.hash) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation evidence target bytes changed");
    }
    return evidence;
  }

  private async inspectFreshClosure(
    rawPlan: FreshV2InitPlanV1,
  ): Promise<BootstrapClosureV1> {
    try {
      return await this.inspectFreshClosureHeld(rawPlan);
    } catch (error) {
      await this.releaseLifecycleLocks(rawPlan.id).catch(() => undefined);
      throw error;
    }
  }

  private async inspectFreshClosureHeld(
    rawPlan: FreshV2InitPlanV1,
  ): Promise<BootstrapClosureV1> {
    const plan = rawPlan;
    if (
      typeof plan.id !== "string" ||
      !/^fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(plan.id) ||
      plan.bootstrapIdentity.path !== join(this.#dependencies.paths.stateDir, ".lifecycle-bootstrap.lock")
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "fresh bootstrap plan identity changed before admission");
    }
    const bootstrapBefore = await lstatOptional(plan.bootstrapIdentity.path);
    const retained = this.#heldLocks.get(plan.id);
    const bootstrap = retained?.bootstrap ?? await this.acquireLifecycleLock(plan.bootstrapIdentity.path);
    this.#heldLocks.set(plan.id, { bootstrap, global: retained?.global ?? null });
    this.trace("lock:bootstrap");

    const journalBytes = await nodeFs.readFile(plan.journalPath).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    const journalValue = journalBytes === null ? null : decodeCanonicalJson(journalBytes, MAX_JOURNAL_BYTES);
    const preliminaryJournal = journalValue === null
      ? null
      : journalValue as unknown as FreshV2InitJournalV1;
    const bootstrapChanged = bootstrapBefore === null ||
      String(bootstrapBefore.dev) !== plan.bootstrapIdentity.dev ||
      String(bootstrapBefore.ino) !== plan.bootstrapIdentity.ino;
    const terminalReplacementAllowed = preliminaryJournal === null || (
      preliminaryJournal.phase === "compacting" &&
      preliminaryJournal.terminalOutcome !== null &&
      preliminaryJournal.compactionNext === this.compactionTable(plan).length - 1
    );
    if (bootstrapChanged && !terminalReplacementAllowed) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap recovery lock changed persisted identity");
    }
    const walked = await this.walkProductHomeBounded(Math.min(plan.maximumStagingEntries || 1_000_000, 1_000_000));
    const allowed = this.closureAllowedPaths(plan, walked);
    const unknown = walked.filter((path) => !allowed.has(path));
    if (unknown.length > 0) {
      this.trace(`inventory:unknown:${unknown.map((path) => path.slice(this.#dependencies.paths.home.length + 1)).join(",")}`);
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap closure contains an unprojected entry");
    }
    const persistedBootstrapPresent = bootstrapBefore !== null &&
      String(bootstrapBefore.dev) === plan.bootstrapIdentity.dev &&
      String(bootstrapBefore.ino) === plan.bootstrapIdentity.ino;
    if (preliminaryJournal === null && persistedBootstrapPresent) {
      const exactPreIntent = new Set([
        this.#dependencies.paths.stateDir,
        plan.bootstrapIdentity.path,
        plan.planPath,
      ]);
      if (walked.some((path) => !exactPreIntent.has(path))) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "plan orphan no longer matches its exact pre-intent shape");
      }
    }

    const planTemps = walked.filter((path) =>
      dirname(path) === this.#dependencies.paths.stateDir &&
      basename(path).startsWith(`.fresh-v2-init.${plan.id}.`) &&
      basename(path).endsWith(".plan.json.tmp"),
    );
    const journalTemps = walked.filter((path) =>
      dirname(path) === this.#dependencies.paths.stateDir &&
      basename(path).startsWith(`.fresh-v2-init.${plan.id}.`) &&
      basename(path).endsWith(".journal.json.tmp"),
    );
    const temporary = async (
      path: string,
      kind: "plan" | "journal",
    ): Promise<BootstrapTempInventoryV1> => {
      const stats = await nodeFs.lstat(path);
      if (
        !stats.isFile() || stats.isSymbolicLink() || stats.uid !== uid() ||
        stats.nlink !== 1 || mode(stats) !== 0o600 ||
        stats.size > (kind === "plan" ? MAX_PLAN_BYTES : MAX_JOURNAL_BYTES)
      ) {
        this.trace(`inventory:closure-prefix-shape:${kind}:${String(stats.uid)}:${String(mode(stats))}:${String(stats.size)}:${String(stats.nlink)}`);
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "bootstrap envelope prefix changed shape");
      }
      return {
        path: path as CanonicalAbsolutePathV1,
        prefixEvidenceId: `prefix-${lowerHash(`${path}:${String(stats.dev)}:${String(stats.ino)}:${String(stats.size)}`)}`,
        ownerUid: uid(),
        mode: 0o600 as const,
        nlink: 1 as const,
        bytes: stats.size,
        dev: String(stats.dev) as BootstrapTempInventoryV1["dev"],
        ino: String(stats.ino) as BootstrapTempInventoryV1["ino"],
      };
    };

    const payloadEvidence: BootstrapPayloadEvidenceV1[] = [];
    const creationEvidence: CreatedPathEvidenceV1[] = [];
    if (preliminaryJournal !== null) {
      for (const row of plan.payloads) {
        const evidence = await this.admittedPayloadEvidenceSnapshot(plan, row, preliminaryJournal);
        if (evidence !== null) payloadEvidence.push(evidence);
      }
      for (const [scope, paths] of [
        ["ordinary", plan.createdPaths],
        ["launchability", plan.launchabilityPaths],
      ] as const) {
        for (const [ordinal, planned] of paths.entries()) {
          const evidence = await this.admittedCreationEvidenceSnapshot(
            plan,
            planned,
            scope,
            ordinal,
            preliminaryJournal,
          );
          if (evidence !== null) creationEvidence.push(evidence);
        }
      }
    }

    const stagingEntries = [...plan.createdPaths, ...plan.launchabilityPaths]
      .map((planned) => planned.path)
      .filter((path) =>
        (path === this.#dependencies.paths.stagingDir || path.startsWith(`${this.#dependencies.paths.stagingDir}/`)) &&
        walked.includes(path),
      );
    const observedFoundationParticipants = preliminaryJournal === null
      ? []
      : preliminaryJournal.phase === "compacting" && preliminaryJournal.compactionNext !== null
        ? this.compactionTable(plan)
            .slice(preliminaryJournal.compactionNext)
            .filter((entry): entry is Extract<FreshCompactionEntryV1, { kind: "foundation" }> => entry.kind === "foundation")
            .map((entry) => plan.foundationParticipants[entry.ordinal])
            .filter((participant): participant is FoundationParticipantRefV2 => participant !== undefined)
        : [...plan.foundationParticipants];
    const foundationObservations = await Promise.all(observedFoundationParticipants.map(async (participant) => ({
          participantId: participant.id,
          journal: await this.fileObservation(participant.initialJournal.finalPath, participant.maximumJournalBytes),
          lock: await this.fileObservation(foundationLockPath(participant), 0),
        })));
    const manifestObservation = preliminaryJournal === null
      ? null
      : {
          participantId: plan.manifest.participantId,
          manifest: await this.fileObservation(plan.manifest.manifestPath, 64 * 1024 * 1024),
          tombstone: await this.fileObservation(plan.manifest.tombstonePath, 64 * 1024 * 1024),
        } as unknown as CanonicalJsonValue;
    if (preliminaryJournal !== null) {
      for (const observation of foundationObservations) {
        const journalObservation = (observation as unknown as { journal: { path: string } | null }).journal;
        if (journalObservation !== null) {
          const foundationJournal = validateJournal(JSON.parse(await nodeFs.readFile(journalObservation.path, "utf8")) as unknown);
          const participantId = (observation as unknown as { participantId: string }).participantId;
          const participant = plan.foundationParticipants.find((candidate) => candidate.id === participantId);
          const initialSource = plan.payloads
            .map((row) => row.source)
            .find((source) =>
              source.kind === "plan_derived" &&
              source.role === "foundation_initial_journal" &&
              typeof source.value === "object" && source.value !== null &&
              "id" in source.value && source.value.id === participantId);
          const initial = initialSource?.kind === "plan_derived"
            ? initialSource.value as unknown as { kind?: unknown; mutations?: unknown; createdAt?: unknown }
            : null;
          if (
            participant === undefined || initial === null || foundationJournal.id !== participantId ||
            !sameValue(foundationJournal.kind, initial.kind) ||
            !sameValue(foundationJournal.mutations, initial.mutations) ||
            foundationJournal.createdAt !== initial.createdAt
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation closure observation changed participant");
          }
        }
      }
    }
    const manifestStats = await lstatOptional(plan.manifest.manifestPath);
    if (
      manifestStats !== null &&
      lowerHash(await nodeFs.readFile(plan.manifest.manifestPath)) !== plan.v2ManifestHash
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest closure observation changed postimage");
    }
    if (await lstatOptional(plan.manifest.tombstonePath) !== null) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "fresh manifest closure retained an impossible tombstone");
    }
    const originalBootstrap = persistedBootstrapPresent;
    const terminalState = preliminaryJournal?.terminalOutcome === "finalized" ||
      (preliminaryJournal === null && !originalBootstrap && await lstatOptional(plan.manifest.manifestPath) !== null)
      ? { state: "postimage", manifest: manifestObservation }
      : preliminaryJournal?.terminalOutcome === "rolled_back" || (preliminaryJournal === null && !originalBootstrap)
        ? { state: "preimage", manifest: manifestObservation }
        : null;
    const preIntentObservation = preliminaryJournal === null && terminalState === null
      ? {
          proofId: `preintent-${plan.admittedExternalShapeHash}`,
          observation: {
            admittedExternalShapeHash: plan.admittedExternalShapeHash,
            bootstrapIdentity: plan.bootstrapIdentity,
          },
        }
      : null;
    const inventoryId = `fresh-closure-${lowerHash(encodeCanonicalJson({
      walked,
      payloadEvidence,
      creationEvidence,
      foundationObservations,
      manifestObservation,
      terminalState,
    } as unknown as CanonicalJsonValue))}`;
    const inventory: BootstrapInventoryV1 = {
      schemaVersion: 1,
      inventoryId,
      entryCount: walked.length,
      envelopes: [{
        operation: "fresh_v2_init",
        id: plan.id,
        plan,
        journal: journalValue,
        planTemps: await Promise.all(planTemps.map((path) => temporary(path, "plan"))),
        journalTemps: await Promise.all(journalTemps.map((path) => temporary(path, "journal"))),
        payloadEvidence,
        createdPathEvidence: creationEvidence,
        foundationStates: foundationObservations,
        manifestState: manifestObservation,
        terminalState,
        preIntentObservation,
        stagingEntries,
        unknownEntries: [],
      }],
      unknownEntries: [],
    };
    let inventoryAdmitted = false;
    const capturedPayload = new Map(payloadEvidence.map((value) => [value.ordinal, value]));
    const capturedCreations = new Map(creationEvidence.map((value) => [`${value.scope}:${String(value.ordinal)}`, value]));
    const capturedFoundation = new Map(foundationObservations.map((value) => [
      (value as unknown as { participantId: string }).participantId,
      value,
    ]));
    const context: BootstrapClosureAdmissionContextV1 = {
      admitGuardedInventory: (candidate) => {
        inventoryAdmitted = sameValue(candidate, inventory);
        return inventoryAdmitted ? inventoryId : "refused";
      },
      planAdmission: this.planAdmission(plan, null, null, () => inventoryAdmitted),
      admitPayloadEvidence: (value, ref) => {
        const captured = capturedPayload.get(ref.ordinal);
        if (!inventoryAdmitted || captured === undefined || !sameValue(value, captured)) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload closure evidence was not retained");
        }
        return structuredClone(captured);
      },
      admitCreatedPathEvidence: (value, _planned, scope, ordinal) => {
        const captured = capturedCreations.get(`${scope}:${String(ordinal)}`);
        if (!inventoryAdmitted || captured === undefined || !sameValue(value, captured)) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "creation closure evidence was not retained");
        }
        return structuredClone(captured);
      },
      admitFoundationState: (value, participant) =>
        inventoryAdmitted && sameValue(value, capturedFoundation.get(participant.id))
          ? participant.id
          : "refused",
      admitManifestState: (value, manifest) =>
        inventoryAdmitted && manifestObservation !== null && sameValue(value, manifestObservation)
          ? manifest.participantId
          : "refused",
      admitTerminalState: (value) => {
        if (!inventoryAdmitted || !sameValue(value, terminalState)) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "terminal closure observation was not retained");
        }
        return (value as { state: string }).state === "postimage" ? "postimage" : "preimage";
      },
      admitTemporaryPrefix: (value) => inventoryAdmitted ? value.prefixEvidenceId : "refused",
      admitPreIntentObservation: (value) =>
        inventoryAdmitted && preIntentObservation !== null && sameValue(value, preIntentObservation)
          ? value.proofId
          : "refused",
    };
    this.trace(`inventory:projection:${preliminaryJournal?.phase ?? "none"}:p${String(payloadEvidence.length)}:c${String(creationEvidence.length)}:f${String(foundationObservations.length)}:s${String(stagingEntries.length)}`);
    const closure = inspectBootstrapClosure(inventory, context);
    this.trace("inventory:closure-admitted");
    return closure;
  }

  private async existingPlan(): Promise<FreshV2InitPlanV1 | null> {
    const state = await lstatOptional(this.#dependencies.paths.stateDir);
    if (state === null) return null;
    const names = (await nodeFs.readdir(this.#dependencies.paths.stateDir))
      .filter((name) => /^fresh-v2-init\.fi_[0-9a-f-]+\.plan\.json$/u.test(name));
    if (names.length === 0) return null;
    if (names.length !== 1) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "multiple fresh bootstrap plans require recovery");
    }
    const path = join(this.#dependencies.paths.stateDir, names[0] as string);
    const value = decodeCanonicalJson(await nodeFs.readFile(path), MAX_PLAN_BYTES);
    if (
      typeof value !== "object" ||
      value === null ||
      !("operation" in value) ||
      value.operation !== "fresh_v2_init"
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap plan operation changed");
    }
    const plan = value as unknown as FreshV2InitPlanV1;
    return plan;
  }

  private initialJournal(plan: FreshV2InitPlanV1): FreshV2InitJournalV1 {
    const timestamp = this.#dependencies.now().toISOString() as FreshV2InitJournalV1["createdAt"];
    const journal: FreshV2InitJournalV1 = {
      schemaVersion: 1,
      id: plan.id,
      planHash: lowerHash(encodeCanonicalJson(plan as unknown as CanonicalJsonValue)),
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
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return validateBootstrapJournal(plan, journal) as FreshV2InitJournalV1;
  }

  private async readOrCreateJournal(plan: FreshV2InitPlanV1): Promise<FreshV2InitJournalV1> {
    const bytes = await nodeFs.readFile(plan.journalPath).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (bytes === null) {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        "bootstrap journal disappeared outside admitted plan-last compaction",
      );
    }
    return validateBootstrapJournal(
      plan,
      decodeCanonicalJson(bytes, MAX_JOURNAL_BYTES),
    ) as FreshV2InitJournalV1;
  }

  private async writeJournal(
    plan: FreshV2InitPlanV1,
    journal: FreshV2InitJournalV1,
    patch: Partial<FreshV2InitJournalV1>,
  ): Promise<FreshV2InitJournalV1> {
    const next = validateBootstrapJournal(plan, {
      ...journal,
      ...patch,
      updatedAt: this.#dependencies.now().toISOString(),
    }) as FreshV2InitJournalV1;
    await durableReplace(plan.journalPath, encoder.encode(encodeCanonicalJson(next as unknown as CanonicalJsonValue)));
    return next;
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
      await nodeFs.readFile(paths.evidence),
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
      } else if (stats.size !== 0) {
        await nodeFs.unlink(row.ref.path);
        await syncDirectory(dirname(row.ref.path));
        journal = await this.writeJournal(plan, journal, {
          payloadWriteState: { state: "create_intent", ordinal: row.ref.ordinal },
        });
        continue;
      } else {
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
        await nodeFs.link(planned.payload.path, planned.path);
        this.checkpoint("after_file_link");
        const linkedPayload = await this.assertExactFile(planned.payload.path, planned.payload, 2);
        const linkedTarget = await this.assertExactFile(planned.path, planned.payload, 2);
        if (
          linkedTarget.dev !== linkedPayload.dev ||
          linkedTarget.ino !== linkedPayload.ino ||
          payloadEvidence.dev !== String(linkedTarget.dev) ||
          payloadEvidence.ino !== String(linkedTarget.ino)
        ) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "created file did not retain evidenced payload inode");
        }
        this.checkpoint("before_file_parent_sync");
        await syncDirectory(dirname(planned.path));
        this.checkpoint("after_file_parent_sync");
        await nodeFs.unlink(planned.payload.path);
        this.checkpoint("after_file_source_unlink");
        await syncDirectory(dirname(planned.payload.path));
        this.checkpoint("after_file_source_parent_sync");
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
        const global = await this.acquireLifecycleLock(planned.path);
        if (global.dev !== String(stats.dev) || global.ino !== String(stats.ino)) {
          await global.handle.release().catch(() => undefined);
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "global lock changed during recovery acquisition");
        }
        this.#heldLocks.set(plan.id, { bootstrap: retained?.bootstrap ?? null, global });
        this.trace("lock:global");
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
        const target = await this.assertExactFile(planned.path, planned.payload, 2);
        const payload = await this.assertExactFile(planned.payload.path, planned.payload, 2);
        this.assertPayloadEvidenceIdentity(plan, row, payloadEvidence, payload);
        if (target.dev !== payload.dev || target.ino !== payload.ino) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "created file two-name state is not the evidenced inode");
        }
        this.checkpoint("before_file_parent_sync");
        await syncDirectory(dirname(planned.path));
        this.checkpoint("after_file_parent_sync");
        await nodeFs.unlink(planned.payload.path);
        this.checkpoint("after_file_source_unlink");
        await syncDirectory(dirname(planned.payload.path));
        this.checkpoint("after_file_source_parent_sync");
        stats = await this.assertExactFile(planned.path, planned.payload);
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
    const row = plan.payloads.find((payload) => sameValue(payload.ref, participant.initialJournal.staged));
    if (row === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation journal payload is unbound");
    const evidence = await this.readPayloadEvidence(row);
    const participantAdmissionId = `participant-${participant.id}`;
    const evidenceAdmissionId = `evidence-${participant.id}`;
    return admitBootstrapFoundationInitialJournal(participant, evidence, {
      participantAdmissionId,
      evidenceAdmissionId,
      ownerUid: uid(),
      admitParticipant: (candidate) => sameValue(candidate, participant) ? participantAdmissionId : "refused",
      admitEvidence: (candidate, candidateParticipant) =>
        sameValue(candidate, evidence) && sameValue(candidateParticipant, participant)
          ? evidenceAdmissionId
          : "refused",
    });
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
    await nodeFs.link(source, destination);
    await syncDirectory(dirname(destination));
    await nodeFs.unlink(source);
    await syncDirectory(dirname(source));
  }

  private async guardedUnlinkExact(
    path: CanonicalAbsolutePathV1,
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
    const stats = await this.assertExactFile(path, {
      hash: expected.hash,
      bytes: Number(expected.size),
      mode: expected.mode,
    });
    if (
      stats.uid !== expected.ownerUid ||
      stats.nlink !== expected.nlink ||
      String(stats.dev) !== expected.dev ||
      String(stats.ino) !== expected.ino
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "manifest unlink identity changed");
    }
    await nodeFs.unlink(path);
    await syncDirectory(dirname(path));
  }

  private async manifestParticipant(
    plan: FreshV2InitPlanV1,
  ): Promise<ManifestStateParticipant> {
    const request = this.requestFromPlan(plan);
    const after = plan.manifest.after;
    if (after.state !== "present" || after.bytes?.kind !== "bootstrap_expected") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "manifest after payload is absent");
    }
    const stats = await this.assertExactFile(after.bytes.path, after.bytes);
    const admission = {
      ...this.manifestPlanAdmission(plan),
      bootstrapPayloadIdentity: (ref: BootstrapExpectedPayloadRefV1) =>
        sameValue(ref, after.bytes)
          ? { dev: String(stats.dev), ino: String(stats.ino) } as NonNullable<ReturnType<NonNullable<ManifestStatePlanAdmissionContextV1["bootstrapPayloadIdentity"]>>>
          : null,
    };
    return new ManifestStateParticipant({
      fs: { lstat: nodeFs.lstat, open: nodeFs.open },
      guardedMoveNoReplace: (source, destination, expected) =>
        this.guardedMoveNoReplace(source, destination, expected),
      guardedUnlinkExact: (path, expected) =>
        this.guardedUnlinkExact(path, expected),
      admission,
      uid: uid(),
      manifestAdmission: this.manifestAdmission(request, this.packageRootFromPlan(plan)),
    });
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
      const participant = await this.manifestParticipant(plan);
      await participant.apply(plan.manifest);
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

  private async compact(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<InstallationManifestV2> {
    let journal = starting;
    const manifest = await this.readManifest(plan);
    if (journal.phase === "finalized") {
      journal = await this.writeJournal(plan, journal, {
        phase: "compacting",
        compactionNext: 0,
      });
      this.checkpoint("during_compaction");
    }
    if (journal.phase !== "compacting") {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "bootstrap did not reach terminal compaction");
    }
    await this.compactTerminal(plan, journal);
    await nodeFs.unlink(plan.planPath);
    this.checkpoint("after_plan_unlink");
    this.trace("compact:plan");
    await syncDirectory(this.#dependencies.paths.stateDir);
    this.checkpoint("after_plan_parent_sync");
    return manifest;
  }

  private async compensate(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<void> {
    if (starting.manifestCursor >= 2) return;
    let journal = starting;
    const payloadBase = 0;
    const ordinaryBase = plan.payloads.length;
    const foundationBase = ordinaryBase + plan.createdPaths.length;
    const launchabilityBase = foundationBase + 1;
    const manifestBase = launchabilityBase + plan.launchabilityPaths.length;
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
      if (cursor === manifestBase) {
        const participant = await this.manifestParticipant(plan);
        await participant.compensate(plan.manifest);
        this.trace("manifest:compensate");
      } else if (cursor >= launchabilityBase) {
        const ordinal = cursor - launchabilityBase;
        const planned = plan.launchabilityPaths[ordinal];
        if (planned === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "launchability compensation cursor escaped plan");
        }
        await this.removePlannedPath(plan, planned, "launchability", ordinal);
        await this.removeCreationEvidence(plan, "launchability", ordinal);
        this.trace(`compensate:path:launchability:${String(ordinal)}`);
      } else if (cursor === foundationBase) {
        const compensation = plan.foundationParticipants.find(
          (participant) => participant.role.kind === "compensation",
        );
        if (compensation === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation compensation participant is missing");
        }
        const admitted = await this.admittedFoundation(compensation, plan);
        await this.#dependencies.transactionExecutor.executeBootstrapFoundationParticipant(admitted);
        this.trace(`foundation:compensation:apply:${compensation.id}`);
      } else if (cursor >= ordinaryBase) {
        const ordinal = cursor - ordinaryBase;
        const planned = plan.createdPaths[ordinal];
        if (planned === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "ordinary compensation cursor escaped plan");
        }
        await this.removePlannedPath(plan, planned, "ordinary", ordinal);
        await this.removeCreationEvidence(plan, "ordinary", ordinal);
        this.trace(`compensate:path:ordinary:${String(ordinal)}`);
      } else if (cursor >= payloadBase) {
        const row = plan.payloads[cursor];
        if (row === undefined) {
          throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload compensation cursor escaped plan");
        }
        journal = await this.writeJournal(plan, journal, {
          payloadCleanupPart: "staged_file",
        });
        await nodeFs.unlink(row.ref.path).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
        await syncDirectory(dirname(row.ref.path));
        journal = await this.writeJournal(plan, journal, {
          payloadCleanupPart: "evidence",
        });
        const evidence = deriveBootstrapPayloadEvidencePaths(
          row.ref.path,
          randomUUID(),
        ).evidence;
        await nodeFs.unlink(evidence).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
        await syncDirectory(dirname(evidence));
      }
      journal = await this.writeJournal(plan, journal, {
        compensationNext: cursor - 1,
        payloadCleanupPart: null,
        payloadWriteState:
          journal.payloadWriteState.state !== "idle" && cursor < plan.payloads.length
            ? { state: "idle" }
            : journal.payloadWriteState,
      });
    }

    journal = await this.writeJournal(plan, journal, {
      phase: "rolled_back",
      terminalOutcome: "rolled_back",
    });
    await this.compactRollback(plan, journal);
  }

  private async removePlannedPath(
    plan: FreshV2InitPlanV1,
    planned: PlannedCreatedPathV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ): Promise<void> {
    const evidence = await this.readCreationEvidence(plan, scope, ordinal);
    const stats = await lstatOptional(planned.path);
    if (stats === null) {
      await syncDirectoryIfPresent(dirname(planned.path));
      return;
    }
    if (
      evidence.bootstrapId !== plan.id ||
      evidence.scope !== scope ||
      evidence.ordinal !== ordinal ||
      evidence.pathHash !== pathHash(planned.path) ||
      evidence.kind !== planned.kind ||
      evidence.dev !== String(stats.dev) ||
      evidence.ino !== String(stats.ino)
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "compensation target no longer matches creation evidence");
    }
    if (planned.kind === "directory") {
      if (!stats.isDirectory() || stats.isSymbolicLink() || mode(stats) !== 0o700 || evidence.postimageHash !== null) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "compensation directory changed postimage");
      }
      if (planned.path === join(this.#dependencies.paths.stateDir, "transactions")) {
        const allowed = new Set(plan.foundationParticipants.flatMap((participant) => [
          `${participant.id}.json`,
          `.${participant.id}.lock`,
        ]));
        const children = await nodeFs.readdir(planned.path);
        if (children.some((name) => !allowed.has(name))) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation journal directory contains a third state");
        }
        for (const name of children) {
          const child = join(planned.path, name);
          const childStats = await nodeFs.lstat(child);
          if (
            !childStats.isFile() || childStats.isSymbolicLink() || childStats.uid !== uid() ||
            childStats.nlink !== 1 || mode(childStats) !== 0o600
          ) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation journal residue changed shape");
          }
          await nodeFs.unlink(child);
          await syncDirectory(planned.path);
        }
      }
      if (planned.path === join(this.#dependencies.paths.stagingDir, "transactions")) {
        const allowed = new Set<string>(plan.foundationParticipants.map((participant) => participant.id));
        const children = await nodeFs.readdir(planned.path);
        if (children.some((name) => !allowed.has(name))) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation staging root contains a third state");
        }
        for (const name of children) {
          const child = join(planned.path, name);
          const childStats = await nodeFs.lstat(child);
          if (!childStats.isDirectory() || childStats.isSymbolicLink() || childStats.uid !== uid() || mode(childStats) !== 0o700) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation staging residue changed shape");
          }
          if ((await nodeFs.readdir(child)).length !== 0) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation staging residue is not empty");
          }
          await nodeFs.rmdir(child);
          await syncDirectory(planned.path);
        }
      }
      if (planned.path === this.#dependencies.paths.backupsDir) {
        const transactionRoot = join(planned.path, "transactions");
        const participants = new Map<string, FoundationParticipantRefV2>(
          plan.foundationParticipants.map((participant) => [participant.id, participant]),
        );
        const children = await nodeFs.readdir(transactionRoot);
        if (children.some((name) => !participants.has(name))) {
          throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation backup root contains a third state");
        }
        for (const name of children) {
          const participant = participants.get(name);
          if (participant === undefined) continue;
          const child = join(transactionRoot, name);
          const childStats = await nodeFs.lstat(child);
          if (!childStats.isDirectory() || childStats.isSymbolicLink() || childStats.uid !== uid() || mode(childStats) !== 0o700) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation backup residue changed shape");
          }
          const expectedFiles = new Set(participant.mutations.flatMap((_, index) => [
            `${String(index)}.json`,
            `${String(index)}.json.sha256`,
          ]));
          const files = await nodeFs.readdir(child);
          if (files.some((file) => !expectedFiles.has(file))) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation backup residue contains an unknown file");
          }
          for (const file of files) {
            const filePath = join(child, file);
            const fileStats = await nodeFs.lstat(filePath);
            if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.uid !== uid() || fileStats.nlink !== 1 || mode(fileStats) !== 0o600) {
              throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "Foundation backup evidence changed shape");
            }
            await nodeFs.unlink(filePath);
            await syncDirectory(child);
          }
          await nodeFs.rmdir(child);
          await syncDirectory(transactionRoot);
        }
        await nodeFs.rmdir(transactionRoot);
        await syncDirectory(planned.path);
      }
      await nodeFs.rmdir(planned.path);
      this.checkpoint("after_compensation_rmdir");
      this.checkpoint("before_compensation_rmdir_parent_sync");
      await syncDirectory(dirname(planned.path));
      this.checkpoint("after_compensation_rmdir_parent_sync");
      return;
    }
    if (planned.kind === "file") {
      await this.assertExactFile(planned.path, planned.payload);
      if (evidence.postimageHash !== planned.payload.hash) {
        throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "compensation file changed postimage");
      }
    } else if (
      !stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 ||
      stats.size !== 0 || mode(stats) !== 0o600 || evidence.postimageHash !== EMPTY_HASH
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "compensation global lock changed postimage");
    }
    await nodeFs.unlink(planned.path);
    this.checkpoint("after_compensation_unlink");
    this.checkpoint("before_compensation_unlink_parent_sync");
    await syncDirectory(dirname(planned.path));
    this.checkpoint("after_compensation_unlink_parent_sync");
  }

  private async removeCreationEvidence(
    plan: FreshV2InitPlanV1,
    scope: "ordinary" | "launchability",
    ordinal: number,
  ): Promise<void> {
    const evidence = deriveBootstrapCreationEvidencePaths(
      this.#dependencies.paths.home as CanonicalAbsolutePathV1,
      "fresh_v2_init",
      plan.id,
      scope,
      ordinal,
      randomUUID(),
    ).evidence;
    await nodeFs.unlink(evidence).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    await syncDirectory(dirname(evidence));
  }

  private async compactRollback(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<void> {
    const journal = await this.writeJournal(plan, starting, {
      phase: "compacting",
      compactionNext: 0,
    });
    await this.compactTerminal(plan, journal);
    await nodeFs.unlink(plan.planPath);
    this.checkpoint("after_plan_unlink");
    this.trace("compact:plan");
    await syncDirectory(this.#dependencies.paths.stateDir);
    this.checkpoint("after_plan_parent_sync");
  }

  private compactionTable(plan: FreshV2InitPlanV1): readonly FreshCompactionEntryV1[] {
    const productStagingRoot = dirname(dirname(plan.stagingRoot));
    const staging = [...plan.createdPaths, ...plan.launchabilityPaths]
      .map((planned) => planned.path)
      .filter((path) => path === productStagingRoot || path.startsWith(`${productStagingRoot}/`))
      .reverse()
      .map((path) => ({ kind: "staging" as const, path }));
    return [
      ...plan.payloads.map((_, ordinal) => ({ kind: "payload" as const, ordinal })),
      ...plan.createdPaths.map((_, ordinal) => ({
        kind: "creation" as const,
        scope: "ordinary" as const,
        ordinal,
      })),
      ...plan.launchabilityPaths.map((_, ordinal) => ({
        kind: "creation" as const,
        scope: "launchability" as const,
        ordinal,
      })),
      ...plan.foundationParticipants.map((_, ordinal) => ({ kind: "foundation" as const, ordinal })),
      ...staging,
      { kind: "journal" as const },
    ];
  }

  private async compactTerminal(
    plan: FreshV2InitPlanV1,
    starting: FreshV2InitJournalV1,
  ): Promise<void> {
    let journal = starting;
    const table = this.compactionTable(plan);
    while ((journal.compactionNext ?? -1) < table.length) {
      const cursor = journal.compactionNext;
      if (cursor === null) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal compaction cursor is absent");
      }
      const entry = table[cursor];
      if (entry === undefined) {
        throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal compaction cursor escaped its table");
      }
      await this.compactEntry(plan, entry);
      if (entry.kind === "journal") return;
      journal = await this.writeJournal(plan, journal, {
        compactionNext: cursor + 1,
      });
    }
  }

  private async compactEntry(
    plan: FreshV2InitPlanV1,
    entry: FreshCompactionEntryV1,
  ): Promise<void> {
    if (entry.kind === "payload") {
      const row = plan.payloads[entry.ordinal];
      if (row === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "payload compaction cursor escaped plan");
      for (const path of [
        row.ref.path,
        deriveBootstrapPayloadEvidencePaths(row.ref.path, randomUUID()).evidence,
      ]) {
        await nodeFs.unlink(path).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
        await syncDirectory(dirname(path));
      }
      return;
    }
    if (entry.kind === "creation") {
      await this.removeCreationEvidence(plan, entry.scope, entry.ordinal);
      return;
    }
    if (entry.kind === "foundation") {
      const participant = plan.foundationParticipants[entry.ordinal];
      if (participant === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "Foundation compaction cursor escaped plan");
      await nodeFs.unlink(participant.initialJournal.finalPath).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
      await syncDirectoryIfPresent(dirname(participant.initialJournal.finalPath));
      for (const mutation of participant.mutations) {
        if (mutation.stagedPath === null) continue;
        for (const path of [mutation.stagedPath, `${mutation.stagedPath}.sha256`]) {
          await nodeFs.unlink(path).catch((error: unknown) => {
            if (!isMissing(error)) throw error;
          });
          await syncDirectoryIfPresent(dirname(path));
        }
      }
      await nodeFs.rmdir(join(this.#dependencies.paths.stagingDir, "transactions", participant.id)).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
      await syncDirectoryIfPresent(join(this.#dependencies.paths.stagingDir, "transactions"));
      return;
    }
    if (entry.kind === "staging") {
      const planned = [...plan.createdPaths, ...plan.launchabilityPaths]
        .find((candidate) => candidate.path === entry.path);
      if (planned === undefined) throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "staging compaction path is unbound");
      if (planned.kind === "directory") {
        await nodeFs.rmdir(planned.path).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
      } else {
        await nodeFs.unlink(planned.path).catch((error: unknown) => {
          if (!isMissing(error)) throw error;
        });
      }
      await syncDirectoryIfPresent(dirname(planned.path));
      return;
    }
    const held = this.#heldLocks.get(plan.id)?.bootstrap;
    const bootstrapStats = await lstatOptional(plan.bootstrapIdentity.path);
    if (
      bootstrapStats !== null &&
      (held === null || held === undefined || held.dev !== String(bootstrapStats.dev) || held.ino !== String(bootstrapStats.ino))
    ) {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "terminal bootstrap lock changed identity");
    }
    if (bootstrapStats !== null) await nodeFs.unlink(plan.bootstrapIdentity.path);
    this.checkpoint("after_bootstrap_lock_unlink");
    await syncDirectory(dirname(plan.bootstrapIdentity.path));
    this.checkpoint("after_bootstrap_lock_parent_sync");
    this.trace("compact:bootstrap-lock");
    const journalBytes = await nodeFs.readFile(plan.journalPath);
    const terminalJournal = validateBootstrapJournal(
      plan,
      decodeCanonicalJson(journalBytes, MAX_JOURNAL_BYTES),
    ) as FreshV2InitJournalV1;
    if (
      terminalJournal.phase !== "compacting" ||
      terminalJournal.compactionNext !== this.compactionTable(plan).length - 1 ||
      terminalJournal.terminalOutcome === null
    ) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal journal cleanup state changed");
    }
    await nodeFs.unlink(plan.journalPath);
    this.checkpoint("after_journal_unlink");
    await syncDirectory(dirname(plan.journalPath));
    this.checkpoint("after_journal_parent_sync");
    this.trace("compact:journal");
  }
}
