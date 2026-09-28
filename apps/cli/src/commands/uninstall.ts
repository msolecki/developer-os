import { isAbsolute, join } from "node:path";

import {
  CODEX_INGEST_HOME_REPAIR,
  containsPath,
  containsPathLoosely,
  detectDrift,
  EXIT_CODES,
  failure,
  hashBytes,
  LifecycleRecoveryRefusalError,
  LifecycleRecoveryRequiredError,
  ManifestUnsupportedArtifactError,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type {
  BootstrapEvidenceSummaryV1,
  CanonicalAbsolutePathV1,
  CliResult,
  DriftFinding,
  InstallationManifest,
  ManagedArtifactV1,
  ManagedArtifactV2,
  ManagedArtifactSchemaIdV1,
  InstallationManifestV1,
  PlannedFileMutation,
  RuntimePaths,
} from "@developer-os/core";

import {
  failureFrom,
  redactionKeyPath,
  renderPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext } from "../context.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission, preservedRetentionRoots } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import {
  ABSENT_MANIFEST_ARCHIVE_RECOVERY,
  runAbsentManifestUninstall,
} from "../lifecycle/absent-manifest-uninstall.js";
import type { AdmittedV2HomeV1 } from "../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission } from "../lifecycle/context.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { createManagedArtifactSchemaRegistry } from "../lifecycle/schema-registry.js";
import { CodexRegistrationFailedError } from "../instructions/codex-registration.js";
import { InstructionRefusal } from "../instructions/detach.js";
import { manifestAdmissionFor } from "../lifecycle/manifest-admission.js";
import { LifecycleMutationRefusal } from "../lifecycle/mutation-gate.js";
import { detachVendorInstructions, LifecycleUninstaller, planUninstallDetach } from "../lifecycle/uninstall.js";
import type { LifecycleUninstallRequestV1 } from "../lifecycle/uninstall.js";
import { dispatchUninstall, recoverUninstall } from "../lifecycle/uninstall-recovery.js";
import { readConfigFile } from "./doctor.js";

export interface UninstallResultV1 {
  readonly schemaVersion: 1;
  readonly removed: readonly string[];
  readonly restored: readonly string[];
  readonly preserved: readonly string[];
  readonly retainedBootstrapEvidence: readonly BootstrapEvidenceSummaryV1[];
  readonly transactionId: string | null;
}

export interface UninstallOptions {
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
}

export interface RevertRequest {
  readonly kind: string;
  readonly artifacts: readonly ManagedArtifactV1[];
  readonly ownedRoots: readonly string[];
  readonly excludedRoots: readonly string[];
}

export interface RevertOutcome {
  readonly removed: readonly string[];
  readonly restored: readonly string[];
  readonly preserved: readonly string[];
  readonly transactionId: string | null;
}

export class UninstallRefusal extends Error {
  readonly code: typeof EXIT_CODES.decisionRequired | typeof EXIT_CODES.recoveryRequired;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(
    code: UninstallRefusal["code"],
    message: string,
    paths: readonly string[],
    recovery?: string,
  ) {
    super(message);
    this.name = "UninstallRefusal";
    this.code = code;
    this.paths = paths;
    this.recovery = recovery;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isNotEmpty(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "EEXIST")
  );
}

interface ResolvedArtifact {
  readonly artifact: ManagedArtifactV1;
  readonly canonicalPath: string;
}

interface ResolvedRoots {
  readonly declaredOwned: readonly string[];
  readonly canonicalOwned: readonly string[];
  readonly declaredExcluded: readonly string[];
  readonly canonicalExcluded: readonly string[];
}

export async function resolveRoots(
  context: CliContext,
  request: RevertRequest,
): Promise<ResolvedRoots> {
  return {
    declaredOwned: request.ownedRoots,
    canonicalOwned: await Promise.all(
      request.ownedRoots.map((root) => context.guards.canonicalize(root)),
    ),
    declaredExcluded: request.excludedRoots,
    canonicalExcluded: await Promise.all(
      request.excludedRoots.map((root) => context.guards.canonicalize(root)),
    ),
  };
}

/**
 * Ownership is decided by location, never by the manifest alone — and by
 * location *after* canonicalization, for every artifact kind. Files reach
 * `validateChangePlan`, which canonicalizes for itself; directories do not,
 * because the transaction executor only moves files. A lexical check alone
 * therefore let a manifest naming `<product home>/link/x`, where `link` is a
 * symlink to the Brain, drive `rmdir` into the vault. Declared *and* canonical
 * must both be inside an owned root and outside every excluded one.
 */
function isRemovableAt(
  declaredPath: string,
  canonicalPath: string,
  roots: ResolvedRoots,
): boolean {
  const insideOwned =
    roots.declaredOwned.some((root) => containsPath(root, declaredPath)) &&
    roots.canonicalOwned.some((root) => containsPath(root, canonicalPath));
  const insideExcluded =
    roots.declaredExcluded.some((root) =>
      containsPathLoosely(root, declaredPath) || containsPathLoosely(declaredPath, root),
    ) ||
    roots.canonicalExcluded.some((root) =>
      containsPathLoosely(root, canonicalPath) || containsPathLoosely(canonicalPath, root),
    );

  return insideOwned && !insideExcluded;
}

export async function partitionArtifacts(
  context: CliContext,
  request: RevertRequest,
  roots: ResolvedRoots,
): Promise<{
  readonly removable: readonly ResolvedArtifact[];
  readonly preserved: readonly string[];
}> {
  const removable: ResolvedArtifact[] = [];
  const preserved: string[] = [];

  for (const artifact of request.artifacts) {
    let canonicalPath: string;
    try {
      canonicalPath = await context.guards.canonicalize(artifact.path);
    } catch {
      preserved.push(artifact.path);
      continue;
    }
    if (isRemovableAt(artifact.path, canonicalPath, roots)) {
      removable.push({ artifact, canonicalPath });
    } else {
      preserved.push(artifact.path);
    }
  }

  return { removable, preserved };
}

function driftByPath(
  findings: readonly DriftFinding[],
): ReadonlyMap<string, DriftFinding> {
  return new Map(findings.map((finding) => [finding.path, finding]));
}

async function readBackup(
  context: CliContext,
  artifact: ManagedArtifactV1,
  backupsDir: string,
): Promise<Uint8Array> {
  if (artifact.backupRelativePath === null || artifact.beforeHash === null) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "a shared artifact records no usable backup",
      [artifact.path],
    );
  }

  const relative = artifact.backupRelativePath;
  if (
    relative.length === 0 ||
    isAbsolute(relative) ||
    relative.split(/[\\/]/u).includes("..")
  ) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "a recorded backup path is not a safe relative path",
      [artifact.path],
    );
  }

  const backupPath = join(backupsDir, relative);
  const canonical = await context.guards.manifest.assertReadable(backupPath);
  if (!containsPath(backupsDir, canonical)) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "a recorded backup resolves outside the backups directory",
      [artifact.path],
    );
  }

  /**
   * `assertReadable` leaves the final component unresolved on purpose, so the
   * leaf may still be a symlink pointing anywhere. Every other read in the
   * product refuses that; this one must too.
   */
  const stats = await context.fs.lstat(canonical);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "a recorded backup is not a regular file",
      [artifact.path],
    );
  }

  const bytes = await context.fs.readFile(canonical);
  if (hashBytes(bytes) !== artifact.beforeHash) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "a recorded backup no longer matches its pre-install hash",
      [artifact.path],
    );
  }
  return bytes;
}

interface RevertOperation {
  readonly targetPath: string;
  readonly operation: "replace" | "remove";
  readonly owner: ManagedArtifactV1["owner"];
  readonly kind: ManagedArtifactV1["kind"];
  readonly expectedBeforeHash: string;
  readonly source: string;
  readonly mergeStrategy: ManagedArtifactV1["mergeStrategy"];
  readonly proposedHash: string | null;
}

interface PlannedRevert {
  readonly operations: readonly RevertOperation[];
  readonly contents: ReadonlyMap<string, Uint8Array>;
  readonly removed: readonly string[];
  readonly restored: readonly string[];
}

export async function planRevert(
  context: CliContext,
  files: readonly ManagedArtifactV1[],
  drift: ReadonlyMap<string, DriftFinding>,
  backupsDir: string,
): Promise<PlannedRevert> {
  const operations: RevertOperation[] = [];
  const contents = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const restored: string[] = [];

  for (const artifact of files) {
    /**
     * Already gone. Nothing to remove and nothing to refuse — this is the state
     * a run interrupted between the transaction and the manifest write leaves
     * behind, and reporting it as removed would claim work this run did not do.
     */
    if (drift.get(artifact.path)?.kind === "missing") continue;

    if (artifact.existedBefore) {
      const bytes = await readBackup(context, artifact, backupsDir);
      operations.push({
        targetPath: artifact.path,
        operation: "replace",
        owner: artifact.owner,
        kind: artifact.kind,
        expectedBeforeHash: artifact.installedHash,
        source: artifact.backupRelativePath ?? artifact.source,
        mergeStrategy: artifact.mergeStrategy,
        proposedHash: hashBytes(bytes),
      });
      contents.set(artifact.path, bytes);
      restored.push(artifact.path);
      continue;
    }

    operations.push({
      targetPath: artifact.path,
      operation: "remove",
      owner: artifact.owner,
      kind: artifact.kind,
      expectedBeforeHash: artifact.installedHash,
      source: "",
      mergeStrategy: artifact.mergeStrategy,
      proposedHash: null,
    });
    removed.push(artifact.path);
  }

  return { operations, contents, removed, restored };
}

/**
 * Removes directories the product created, deepest first, and only while they
 * are empty. `rmdir` rather than a recursive remove is the whole safety
 * argument: a directory that still holds transaction backups, logs, or anything
 * a user put there refuses to go and is reported as preserved.
 */
export async function removeDirectories(
  context: CliContext,
  directories: readonly ResolvedArtifact[],
): Promise<{ readonly removed: readonly string[]; readonly preserved: readonly string[] }> {
  const removed: string[] = [];
  const preserved: string[] = [];
  const ordered = [...directories].sort(
    (left, right) => right.canonicalPath.length - left.canonicalPath.length,
  );

  for (const entry of ordered) {
    try {
      await context.guards.transaction.assertTarget(entry.canonicalPath);

      /**
       * Ownership was decided before the transaction ran, and the transaction
       * takes hundreds of milliseconds of fsyncs — an attacker watching for the
       * journal file has a deterministic window in which to turn an ancestor
       * into a symlink. Re-resolving here and refusing on any disagreement
       * collapses that window to the gap between this call and `rmdir`, which
       * cannot be closed without `unlinkat` on a directory descriptor.
       */
      const fresh = await context.guards.canonicalize(entry.artifact.path);
      if (fresh !== entry.canonicalPath) {
        preserved.push(entry.artifact.path);
        continue;
      }

      const stats = await context.fs.lstat(entry.canonicalPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        preserved.push(entry.artifact.path);
        continue;
      }
      await context.fs.rmdir(entry.canonicalPath);
      removed.push(entry.artifact.path);
    } catch (error) {
      if (isMissing(error)) continue;
      if (isNotEmpty(error)) {
        preserved.push(entry.artifact.path);
        continue;
      }
      throw error;
    }
  }

  return { removed, preserved };
}

/**
 * Resolves ownership and refuses on drift. Both the preview and the real run go
 * through it, so `--dry-run` can never advertise a removal the real run would
 * refuse.
 */
export async function planUninstall(
  context: CliContext,
  request: RevertRequest,
): Promise<{
  readonly removable: readonly ResolvedArtifact[];
  readonly preserved: readonly string[];
  readonly drift: ReadonlyMap<string, DriftFinding>;
}> {
  const roots = await resolveRoots(context, request);
  const { removable, preserved } = await partitionArtifacts(
    context,
    request,
    roots,
  );

  const drift = driftByPath(
    await detectDrift({
      manifest: {
        schemaVersion: 1,
        productVersion: context.productVersion,
        installedAt: context.now().toISOString(),
        artifacts: removable.map((entry) => entry.artifact),
      },
      fs: context.fs,
      guards: context.guards.manifest,
    }),
  );

  const edited = [...drift.values()].filter(
    (finding) => finding.kind !== "missing",
  );
  if (edited.length > 0) {
    throw new UninstallRefusal(
      EXIT_CODES.decisionRequired,
      "managed artifacts were modified after installation; resolve them before removing",
      edited.map((finding) => finding.path),
    );
  }

  return { removable, preserved, drift };
}

export async function revertArtifacts(
  context: CliContext,
  request: RevertRequest,
): Promise<RevertOutcome> {
  const { removable, preserved, drift } = await planUninstall(context, request);

  const files = removable
    .filter((entry) => entry.artifact.kind !== "directory")
    .map((entry) => entry.artifact);
  /**
   * A directory that is already absent has nothing to remove. Skipping it is
   * correct on its own, and it also removes the precondition for the escape:
   * a manifest may name a directory that does not exist yet, whose canonical
   * form is therefore its own declared path, so nothing resolves it into the
   * Brain until an attacker plants the ancestor mid-run.
   */
  const directories = removable.filter(
    (entry) =>
      entry.artifact.kind === "directory" &&
      drift.get(entry.artifact.path)?.kind !== "missing",
  );

  const planned = await planRevert(
    context,
    files,
    drift,
    context.paths.backupsDir,
  );

  let transactionId: string | null = null;
  if (planned.operations.length > 0) {
    const validated = await validateChangePlan(
      {
        schemaVersion: 1,
        productVersion: context.productVersion,
        operations: planned.operations,
      },
      {
        manifest: { artifacts: request.artifacts },
        ownedRoots: request.ownedRoots,
        excludedRoots: request.excludedRoots,
        canonicalize: context.guards.canonicalize,
      },
    );

    const mutations: PlannedFileMutation[] = validated.operations.map(
      (operation) => ({
        targetPath: operation.canonicalTargetPath,
        operation: operation.operation === "remove" ? "remove" : "replace",
        content:
          operation.operation === "remove"
            ? null
            : (planned.contents.get(operation.targetPath) ?? null),
      }),
    );

    const journal = await context.executor.execute({
      kind: request.kind,
      mutations,
    });
    transactionId = journal.id;
  }

  const directoryOutcome = await removeDirectories(context, directories);

  return {
    removed: [...planned.removed, ...directoryOutcome.removed],
    restored: planned.restored,
    preserved: [...preserved, ...directoryOutcome.preserved],
    transactionId,
  };
}

export async function removeManifestFile(context: CliContext): Promise<void> {
  try {
    await context.fs.unlink(context.paths.manifestFile);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/**
 * The one path `uninstall` removes that the manifest never named — the
 * redaction key is deliberately not a managed artifact (see
 * `loadOrCreateRedactionKey` in `../context.js`), so `revertArtifacts` above
 * has no record of it and would leave it behind forever otherwise. Removed by
 * the exact path `redactionKeyPath` computes, never by pattern or by walking
 * `stateDir`, so this exception cannot widen into "and anything else that
 * happens to live next to it". Missing is success: nothing this product ever
 * shipped guarantees the key exists before `init` completes.
 */
export async function removeRedactionKeyFile(
  context: CliContext,
): Promise<void> {
  try {
    await context.fs.unlink(redactionKeyPath(context.paths.stateDir));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function describePlan(removable: readonly string[]): string {
  return [
    "Developer OS will remove the following managed artifacts:",
    ...removable.map((path) => `  ${renderPath(path)}`),
    "The Brain, backups, and unrelated files are preserved. Proceed?",
  ].join("\n");
}

/**
 * An `ephemeral` V2 artifact carries no hash at all — its content is expected
 * to vary after install, which is exactly why V2's own drift inspection
 * (`inspectV2Artifact`, `packages/core/src/manifest/drift.ts:243`) never
 * compares one by content. The V1 shape this file's machinery still needs
 * has no such mode and always hash-compares, so downcasting with a fixed
 * empty-content hash reintroduces that comparison by accident: a lock
 * residue or reservation file that legitimately holds bytes at uninstall
 * time no longer matches, and `planUninstall` refuses removal as if the
 * artifact had been edited since install. Recording the hash of what the
 * file holds *right now* keeps the V1 comparison a no-op, which is what V2
 * already decided for this artifact.
 */
async function currentContent(
  context: CliContext,
  path: string,
): Promise<Uint8Array | null> {
  try {
    const canonical = await context.guards.manifest.assertReadable(path);
    const stats = await context.fs.lstat(canonical);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
    return await context.fs.readFile(canonical);
  } catch {
    return null;
  }
}

async function currentContentHash(
  context: CliContext,
  path: string,
): Promise<string> {
  return hashBytes((await currentContent(context, path)) ?? new Uint8Array());
}

/**
 * A `schema` row is the same case one step removed: V2 validates it against its schema and
 * never compares its hash, because `config set` and the instruction attach and detach rewrite
 * `config.toml` in place. The recorded hash made every uninstall after such a write refuse
 * exit 3. A record that still validates takes its current hash; one that no longer does keeps
 * the recorded hash, so it refuses exactly as V2 drift reports `schema_invalid`.
 */
async function schemaRowHash(
  context: CliContext,
  path: string,
  schemaId: ManagedArtifactSchemaIdV1,
  installedHash: string,
): Promise<string> {
  const bytes = await currentContent(context, path);
  if (bytes === null) return installedHash;
  try {
    createManagedArtifactSchemaRegistry(null).validate(schemaId, bytes);
    return hashBytes(bytes);
  } catch {
    return installedHash;
  }
}

export async function downcastArtifactV2(
  context: CliContext,
  artifact: ManagedArtifactV2,
): Promise<ManagedArtifactV1> {
  // Block rows leave the manifest through the detach step before the drained uninstall (spec §6.3).
  if (artifact.verification.mode === "block") throw new ManifestUnsupportedArtifactError();
  const installedHash = artifact.kind === "directory"
    ? hashBytes(new Uint8Array())
    : artifact.verification.mode === "ephemeral"
      ? await currentContentHash(context, artifact.path)
      : artifact.verification.mode === "schema"
        ? await schemaRowHash(context, artifact.path, artifact.verification.schemaId, artifact.verification.installedHash)
        : artifact.verification.installedHash;
  return {
    owner: artifact.owner,
    path: artifact.path,
    kind: artifact.kind === "instruction" ? "file" : artifact.kind,
    productVersion: artifact.productVersion,
    existedBefore: artifact.existedBefore,
    installedHash,
    beforeHash: artifact.beforeHash,
    backupRelativePath: artifact.backupRelativePath,
    source: artifact.source,
    mergeStrategy: artifact.mergeStrategy,
    verifiedAt: artifact.verifiedAt,
  };
}

/**
 * `admitOwnerPath` refusing an artifact and a genuinely malformed document
 * both surface from `readOptional` as the same generic
 * `ManifestStateError("installation manifest is malformed or incomplete")`,
 * exit 6, no paths, no recovery text — the store collapses every cause into
 * that one shape (`packages/core/src/manifest/store.ts:303-306`,
 * `packages/core/src/manifest/v2.ts:104-105`). A user who legitimately moved
 * their Brain gets that message with nothing pointing at the cause and no way
 * out, indistinguishable from a corrupted file. `refusedOwnerPaths` is the
 * one artifact this run actually saw and rejected (`.map`'s admission check
 * throws on the first mismatch, so at most one is ever recorded — and by
 * construction it is the shortest, since every other Brain-owned artifact's
 * path is that root plus a suffix): naming it, and the Brain the
 * configuration currently points at, is the whole diagnosis and the whole fix.
 */
export function relocatedBrainRefusal(
  recordedPath: string,
  configuredBrain: string,
): UninstallRefusal {
  return new UninstallRefusal(
    EXIT_CODES.recoveryRequired,
    "the installation manifest records a managed artifact outside the product home and the configured Brain — the Brain path likely changed since install",
    [recordedPath, configuredBrain],
    `the manifest records it under ${recordedPath}; the configured Brain is ${configuredBrain}. Point the configuration's brainPath back at ${recordedPath}, or move the Brain back there, then retry uninstall`,
  );
}

/**
 * NEW-59: every V2 manifest used to reach a hand-rolled fallback read because
 * `readOptional()` was called with no admission context, and
 * `validateManifestBytes` refuses every `schemaVersion === 2` document
 * without one (`packages/core/src/manifest/v2.ts:104`). A genuine V1
 * manifest never hit that refusal — `validateManifestBytes` resolves schema
 * 1 before the context is even consulted — so once V2 is admitted correctly
 * there is no remaining failure this function should swallow. A symlink at
 * the manifest path or a device/inode race on reopen still propagates and
 * refuses the run, rather than being silently re-read through a weaker path
 * with no genuine caller left to justify it — but a refused owner path is
 * distinguished from those and given the recovery text above.
 */
async function readUninstallManifest(
  context: CliContext,
  paths: RuntimePaths,
): Promise<InstallationManifestV1 | null> {
  const refusedOwnerPaths: string[] = [];
  let manifest: InstallationManifest | null;
  try {
    manifest = await context.manifests.readOptional(
      manifestAdmissionFor(paths, refusedOwnerPaths, resolveVendorHomes(context.env, context.userHome, paths.home)),
    );
  } catch (error) {
    const recordedPath = refusedOwnerPaths[0];
    if (recordedPath === undefined) throw error;
    throw relocatedBrainRefusal(recordedPath, paths.brain);
  }
  if (manifest === null || manifest.schemaVersion === 1) return manifest;
  return {
    schemaVersion: 1,
    productVersion: manifest.productVersion,
    installedAt: manifest.installedAt,
    artifacts: await Promise.all(
      manifest.artifacts.map((artifact) => downcastArtifactV2(context, artifact)),
    ),
  };
}

/**
 * Before the evidence inventory: `inventoryExactNamespaces` throws an
 * unclassified error the moment one of its roots is a symlink rather than
 * refusing it through `UninstallRefusal`.
 */
async function assertHomeShape(context: CliContext): Promise<void> {
  let stats;
  try {
    stats = await context.fs.lstat(context.paths.home);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "the product home exists and is not a directory",
      [context.paths.home],
      `replace ${context.paths.home} with a real directory before uninstall can proceed`,
    );
  }
}

/**
 * The configuration authority every arm of `uninstall` reads its paths under. A drifted or
 * corrupted configuration must not block removal, and must not widen it either: `ownedRoots`
 * stays the product home alone wherever this is used.
 */
export async function uninstallRuntimePaths(context: CliContext): Promise<RuntimePaths> {
  let config = null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch {
    config = null;
  }
  return runtimePathsFor(context, config ?? undefined);
}

/**
 * Spec 1 §6 on an admitted V2 home: one lifecycle coordinator replaces the V1 revert, so the
 * run leaves the A12 bookkeeping set and retained bootstrap evidence and nothing else. The home
 * is admitted by `dispatchUninstall`, which owns the relocated-Brain diagnosis; the
 * coordinator's own manifest arm is deliberately unconfined (I2).
 *
 * A12 spec §6.3: vendor rows leave first, through the instruction detach, and the drained
 * uninstall then runs unchanged over a home re-admitted after it. The dry run and the prompt
 * preview the coordinator over the manifest the detach would leave, so neither detaches.
 */
export async function runCoordinatorUninstall(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  admitted: AdmittedV2HomeV1,
  evidence: BootstrapEvidenceAdmissionV1,
  options: UninstallOptions,
): Promise<CliResult<UninstallResultV1>> {
  const paths = await uninstallRuntimePaths(context);
  const detach = await planUninstallDetach(context, lifecycle);
  const request = (home: AdmittedV2HomeV1): LifecycleUninstallRequestV1 => ({
    context,
    lifecycle,
    key: lifecycleHomeKeyFromAdmission(home, paths),
    admitted: home,
    evidence,
    options,
  });
  const uninstaller = new LifecycleUninstaller();

  /**
   * `execute` plans again under its own lock, so the preview here is only what the two paths
   * that never reach it need: the dry run's report and the confirmation prompt's list.
   */
  if (options.dryRun || !options.assumeYes) {
    const detached = detach?.plan.kind === "transaction" ? detach.plan : null;
    const lockPath = join(paths.stateDir, ".lifecycle.lock") as CanonicalAbsolutePathV1;
    const held = await lifecycle.locks.acquireExisting(lockPath);
    let preview;
    try {
      preview = await uninstaller.preview(
        request(detached === null ? admitted : { ...admitted, manifest: detached.manifest }),
        held,
      );
    } finally {
      await held.release();
    }
    const removable = [...(detached?.removed ?? []), ...preview.removable];
    if (options.dryRun) {
      return success({
        schemaVersion: 1,
        removed: removable,
        restored: [],
        preserved: [...new Set([...(detached?.preserved ?? []), ...preview.preserved])],
        retainedBootstrapEvidence: evidence.report.ids,
        transactionId: null,
      });
    }
    if (!(await context.io.confirm(describePlan(removable)))) {
      return failure(EXIT_CODES.decisionRequired, {
        kind: "declined",
        message: "uninstall was declined",
        paths: [],
      });
    }
  }

  if (detach === null) return success(await uninstaller.execute(request(admitted)));
  const detached = await detachVendorInstructions(context, lifecycle);
  const readmitted = await dispatchUninstall(context, lifecycle, evidence);
  if (readmitted.kind !== "v2_coordinator") {
    throw new UninstallRefusal(
      EXIT_CODES.recoveryRequired,
      "the installation manifest changed shape during the instruction detach",
      [paths.manifestFile],
      "developer-os doctor",
    );
  }
  const outcome = await uninstaller.execute(request(readmitted.admitted));
  return success(
    {
      ...outcome,
      removed: [...detached.removed, ...outcome.removed],
      preserved: [...new Set([...detached.preserved, ...outcome.preserved])],
    },
    detached.warnings,
  );
}

export async function runUninstall(
  context: CliContext,
  options: UninstallOptions,
): Promise<CliResult<UninstallResultV1>> {
  try {
    await assertHomeShape(context);
    const evidence = context.bootstrap?.state === "available"
      ? await context.bootstrap.inspectEvidence()
      : await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }));
    /**
     * §6's dispatch order — V1 manifest, V2 manifest, §2.1's recovery-only arm, then the
     * absent-manifest shapes. It reads the manifest under the same product-home-or-Brain
     * authority `ownedRoots` and `excludedRoots` build below, which is config-dependent: a
     * custom `brainPath` moves it.
     */
    const lifecycle = context.lifecycle;
    if (lifecycle !== undefined) {
      const dispatch = await dispatchUninstall(context, lifecycle, evidence);
      if (dispatch.kind === "v2_coordinator" || dispatch.kind === "recovery_only") {
        return await recoverUninstall(context, lifecycle, dispatch, options, evidence);
      }
      if (dispatch.kind === "absent_manifest") {
        const outcome = await runAbsentManifestUninstall({ context, lifecycle, options, evidence });
        return success({
          schemaVersion: 1,
          removed: outcome.removed,
          restored: outcome.restored,
          preserved: outcome.preserved,
          retainedBootstrapEvidence: outcome.retainedBootstrapEvidence,
          transactionId: outcome.transactionId,
        });
      }
    }

    const paths = await uninstallRuntimePaths(context);
    const manifest = await readUninstallManifest(context, paths);
    if (manifest === null) {
      if (lifecycle === undefined) {
        throw new UninstallRefusal(
          EXIT_CODES.recoveryRequired,
          "this product home cannot be inspected for removal without a manifest",
          [context.paths.home],
          ABSENT_MANIFEST_ARCHIVE_RECOVERY,
        );
      }
      const outcome = await runAbsentManifestUninstall({ context, lifecycle, options, evidence });
      return success({
        schemaVersion: 1,
        removed: outcome.removed,
        restored: outcome.restored,
        preserved: outcome.preserved,
        retainedBootstrapEvidence: outcome.retainedBootstrapEvidence,
        transactionId: outcome.transactionId,
      });
    }

    const request: RevertRequest = {
      kind: "uninstall",
      artifacts: manifest.artifacts,
      ownedRoots: [paths.home],
      excludedRoots: [paths.brain, ...evidence.retainedRoots],
    };

    const preview = await planUninstall(context, request);

    if (options.dryRun) {
      return success({
        schemaVersion: 1,
        removed: preview.removable.map((entry) => entry.artifact.path),
        restored: [],
        preserved: [...new Set([...preview.preserved, ...preservedRetentionRoots(evidence)])],
        retainedBootstrapEvidence: evidence.report.ids,
        transactionId: null,
      });
    }

    if (
      !options.assumeYes &&
      !(await context.io.confirm(
        describePlan(preview.removable.map((entry) => entry.artifact.path)),
      ))
    ) {
      return failure(EXIT_CODES.decisionRequired, {
        kind: "declined",
        message: "uninstall was declined",
        paths: [],
      });
    }

    /**
     * **Before `revertArtifacts`**, so `rmdir(stateDir)` can succeed when the
     * directory is otherwise empty. The reverse order leaves a state directory
     * holding one secret and nothing else, which `rmdir` refuses — and then the
     * key is removed anyway, so the directory survives for no reason at all.
     */
    await removeRedactionKeyFile(context);
    const outcome = await revertArtifacts(context, request);
    await removeManifestFile(context);

    return success({
      schemaVersion: 1,
      ...outcome,
      preserved: [...new Set([...outcome.preserved, ...preservedRetentionRoots(evidence)])],
      retainedBootstrapEvidence: evidence.report.ids,
    });
  } catch (error) {
    /**
     * `LifecycleRecoveryRefusalError` carries §2.4's way out as a literal command line, which a
     * `SafeReasonCodeV1` cannot hold — a non-terminal standalone Foundation journal is resolved
     * by `repair`, and dropping the field would leave the user the reason and no instruction.
     */
    const refusal =
      error instanceof UninstallRefusal ||
      error instanceof LifecycleRecoveryRefusalError ||
      error instanceof LifecycleMutationRefusal ||
      error instanceof InstructionRefusal
        ? error
        : null;
    const codexIngestHome =
      error instanceof LifecycleRecoveryRequiredError && error.reason === "codex_ingest_home_shape" ? error : null;
    if (codexIngestHome !== null) return failureFrom(context, error, codexIngestHome.paths, CODEX_INGEST_HOME_REPAIR);
    const paths = refusal?.paths ?? (error instanceof CodexRegistrationFailedError ? error.paths : []);
    const evidence = error instanceof InstructionRefusal && error.evidence !== null ? { evidence: error.evidence } : undefined;
    return failureFrom(context, error, paths, refusal?.recovery, evidence);
  }
}
