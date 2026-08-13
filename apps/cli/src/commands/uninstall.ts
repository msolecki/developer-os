import { isAbsolute, join } from "node:path";

import {
  containsPath,
  containsPathLoosely,
  detectDrift,
  EXIT_CODES,
  failure,
  hashBytes,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type {
  CliResult,
  DriftFinding,
  ManagedArtifactV1,
  PlannedFileMutation,
} from "@developer-os/core";

import {
  failureFrom,
  redactionKeyPath,
  renderPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext } from "../context.js";
import { readConfigFile } from "./doctor.js";

export interface UninstallResultV1 {
  readonly schemaVersion: 1;
  readonly removed: readonly string[];
  readonly restored: readonly string[];
  readonly preserved: readonly string[];
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

  constructor(
    code: UninstallRefusal["code"],
    message: string,
    paths: readonly string[],
  ) {
    super(message);
    this.name = "UninstallRefusal";
    this.code = code;
    this.paths = paths;
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

async function resolveRoots(
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
      containsPathLoosely(root, declaredPath),
    ) ||
    roots.canonicalExcluded.some((root) =>
      containsPathLoosely(root, canonicalPath),
    );

  return insideOwned && !insideExcluded;
}

async function partitionArtifacts(
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

async function planRevert(
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
async function removeDirectories(
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
        manifest: {
          schemaVersion: 1,
          productVersion: context.productVersion,
          installedAt: context.now().toISOString(),
          artifacts: request.artifacts,
        },
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

function describePlan(removable: readonly ResolvedArtifact[]): string {
  return [
    "Developer OS will remove the following managed artifacts:",
    ...removable.map((entry) => `  ${renderPath(entry.artifact.path)}`),
    "The Brain, backups, and unrelated files are preserved. Proceed?",
  ].join("\n");
}

export async function runUninstall(
  context: CliContext,
  options: UninstallOptions,
): Promise<CliResult<UninstallResultV1>> {
  try {
    const manifest = await context.manifests.readOptional();
    if (manifest === null) {
      return success({
        schemaVersion: 1,
        removed: [],
        restored: [],
        preserved: [],
        transactionId: null,
      });
    }

    /**
     * A drifted or corrupted configuration must not block removal, and must not
     * widen it either: `ownedRoots` is the product home alone, so an artifact
     * outside it is preserved whatever the Brain path turns out to be. The
     * exclusion below is defence in depth on top of that.
     */
    let config = null;
    try {
      config = await readConfigFile(context, context.paths.configFile);
    } catch {
      config = null;
    }
    const paths = runtimePathsFor(context, config ?? undefined);
    const request: RevertRequest = {
      kind: "uninstall",
      artifacts: manifest.artifacts,
      ownedRoots: [paths.home],
      excludedRoots: [paths.brain],
    };

    const preview = await planUninstall(context, request);

    if (options.dryRun) {
      return success({
        schemaVersion: 1,
        removed: preview.removable.map((entry) => entry.artifact.path),
        restored: [],
        preserved: [...preview.preserved],
        transactionId: null,
      });
    }

    if (
      !options.assumeYes &&
      !(await context.io.confirm(describePlan(preview.removable)))
    ) {
      return failure(EXIT_CODES.decisionRequired, {
        kind: "declined",
        message: "uninstall was declined",
        paths: [],
      });
    }

    const outcome = await revertArtifacts(context, request);
    await removeManifestFile(context);
    await removeRedactionKeyFile(context);

    return success({ schemaVersion: 1, ...outcome });
  } catch (error) {
    return failureFrom(
      context,
      error,
      error instanceof UninstallRefusal ? error.paths : [],
    );
  }
}
