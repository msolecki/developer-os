import { join } from "node:path";

import {
  EXIT_CODES,
  failure,
  foldPath,
  hashBytes,
  serializeConfig,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  InstallationManifestV1,
  ManagedArtifactV1,
  PlannedFileMutation,
  RuntimePaths,
  ValidatedChangePlanOperationV1,
} from "@developer-os/core";
import {
  assertDisjointPaths,
  canonicalizePlannedPath,
} from "@developer-os/security";

import {
  assertRootsAnchored,
  failureFrom,
  ownershipAnchorsFor,
  renderPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext } from "../context.js";
import {
  detectManagedDrift,
  hasFailingCheck,
  isDirectory,
  listIncompleteTransactions,
  readConfigFile,
  runDoctorReport,
} from "./doctor.js";
import type { DoctorReportV1 } from "./doctor.js";
import { removeManifestFile, revertArtifacts } from "./uninstall.js";

const BRAIN_KEEP_FILE = ".gitkeep";
const CONFIG_SOURCE = "generated/config.toml";
const BRAIN_KEEP_SOURCE = "generated/brain/.gitkeep";
const DIRECTORY_SOURCE = "generated/directory";

/**
 * `ManagedArtifactV1.installedHash` is required for every kind, but a directory
 * has no content and drift detection compares only its type. The empty digest is
 * a constant placeholder, never a claim about what the directory contains.
 */
const DIRECTORY_CONTENT_HASH = hashBytes(new Uint8Array());

const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

export interface InitResultV1 {
  readonly schemaVersion: 1;
  readonly productHome: string;
  readonly brainPath: string;
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
  readonly transactionId: string | null;
}

export interface InitOptions {
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
}

export interface InitDependencies {
  verify(context: CliContext): Promise<DoctorReportV1>;
}

const DEFAULT_DEPENDENCIES: InitDependencies = { verify: runDoctorReport };

interface DesiredFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly source: string;
}

interface InitPlan {
  readonly paths: RuntimePaths;
  readonly productDirectories: readonly string[];
  readonly missingProductDirectories: readonly string[];
  readonly brainDirectories: readonly string[];
  readonly productFiles: readonly DesiredFile[];
  readonly brainFiles: readonly DesiredFile[];
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
}

function productDirectoriesOf(paths: RuntimePaths): readonly string[] {
  return [
    paths.home,
    paths.stateDir,
    paths.stagingDir,
    paths.backupsDir,
    paths.logsDir,
  ];
}

function defaultConfig(brainPath: string): DeveloperOsConfigV1 {
  return {
    schemaVersion: 1,
    brainPath,
    adapters: { claude: false, codex: false },
    git: { enabled: false },
    automation: { enabled: false },
    telemetry: false,
  };
}

class InitRefusal extends Error {
  readonly code: Exclude<
    (typeof EXIT_CODES)[keyof typeof EXIT_CODES],
    typeof EXIT_CODES.success
  >;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(
    code: InitRefusal["code"],
    message: string,
    paths: readonly string[] = [],
    recovery?: string,
  ) {
    super(message);
    this.name = "InitRefusal";
    this.code = code;
    this.paths = paths;
    this.recovery = recovery;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "an unexpected failure";
}

async function assertUsableDirectory(
  context: CliContext,
  path: string,
  label: string,
): Promise<boolean> {
  const directory = await isDirectory(context, path);
  if (directory === false) {
    throw new InitRefusal(
      EXIT_CODES.invalidInput,
      `the ${label} path exists and is not a directory`,
      [path],
    );
  }
  return directory === true;
}

/**
 * The Brain is inspected, never repaired. An existing vault must be a readable
 * directory and is then left exactly as it is — Foundation writes a skeleton
 * only into a Brain it creates itself.
 */
async function inspectBrain(
  context: CliContext,
  brain: string,
): Promise<boolean> {
  const present = await assertUsableDirectory(context, brain, "Brain");
  if (!present) return false;

  try {
    await context.fs.readdir(brain);
  } catch (error) {
    throw new InitRefusal(
      EXIT_CODES.operationalFailure,
      context.guards.redactDiagnostic(
        error instanceof Error ? error.message : "the Brain is unreadable",
      ),
      [brain],
    );
  }
  return true;
}

async function buildPlan(context: CliContext): Promise<InitPlan> {
  const existingConfig = await readConfigFile(
    context,
    context.paths.configFile,
  );
  const paths = runtimePathsFor(context, existingConfig ?? undefined);

  await assertDisjointPaths([paths.home, paths.brain]);

  const productDirectories = productDirectoriesOf(paths);
  const missingProductDirectories: string[] = [];
  const created: string[] = [];
  const unchanged: string[] = [];

  for (const directory of productDirectories) {
    const present = await assertUsableDirectory(
      context,
      directory,
      "product state",
    );
    if (present) {
      unchanged.push(directory);
    } else {
      missingProductDirectories.push(directory);
      created.push(directory);
    }
  }

  const configuredBrain = existingConfig?.brainPath ?? paths.brain;
  const config = defaultConfig(configuredBrain);
  const configBytes = new TextEncoder().encode(serializeConfig(config));

  const productFiles: DesiredFile[] = [];
  if (existingConfig === null) {
    productFiles.push({
      path: paths.configFile,
      content: configBytes,
      source: CONFIG_SOURCE,
    });
    created.push(paths.configFile);
  } else {
    unchanged.push(paths.configFile);
  }

  const brainPresent = await inspectBrain(context, paths.brain);
  const brainDirectories = brainPresent ? [] : [paths.brain];
  const brainFiles: DesiredFile[] = [];
  if (brainPresent) {
    unchanged.push(paths.brain);
  } else {
    created.push(paths.brain);
    brainFiles.push({
      path: join(paths.brain, BRAIN_KEEP_FILE),
      content: new Uint8Array(),
      source: BRAIN_KEEP_SOURCE,
    });
    created.push(join(paths.brain, BRAIN_KEEP_FILE));
  }

  return {
    paths,
    productDirectories,
    missingProductDirectories,
    brainDirectories,
    productFiles,
    brainFiles,
    created,
    unchanged,
  };
}

/**
 * Machine health that has nothing to do with this install is a *precondition*,
 * not a postcondition. Left as a postcondition, an unrelated journal left by an
 * earlier interrupted run made `runDoctorReport` fail after a perfectly good
 * install, so `init` compensating-reverted its own work and could never succeed
 * on that machine. Refuse up front instead, with the code and the commands the
 * situation actually calls for.
 */
async function assertNoIncompleteTransaction(
  context: CliContext,
): Promise<void> {
  const incomplete = await listIncompleteTransactions(context);
  const first = incomplete[0];
  if (first === undefined) return;

  throw new InitRefusal(
    EXIT_CODES.recoveryRequired,
    `transaction ${first.id} stopped at phase ${first.phase}; finish it before initializing`,
    [join(context.paths.stateDir, "transactions", `${first.id}.json`)],
    `developer-os repair --resume ${first.id} | developer-os repair --rollback ${first.id}`,
  );
}

async function assertNoDrift(context: CliContext): Promise<void> {
  const manifest = await context.manifests.readOptional();
  if (manifest === null) return;

  const findings = await detectManagedDrift(context, manifest);
  if (findings.length === 0) return;

  throw new InitRefusal(
    EXIT_CODES.decisionRequired,
    "managed artifacts differ from their recorded state; resolve the drift before re-initializing",
    findings.map((finding) => finding.path),
  );
}

async function validateFiles(
  context: CliContext,
  manifest: InstallationManifestV1,
  files: readonly DesiredFile[],
  ownedRoots: readonly string[],
  excludedRoots: readonly string[],
): Promise<readonly ValidatedChangePlanOperationV1[]> {
  if (files.length === 0) return [];

  const plan = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      operations: files.map((file) => ({
        targetPath: file.path,
        operation: "create",
        owner: "core",
        kind: "file",
        expectedBeforeHash: null,
        source: file.source,
        mergeStrategy: "dedicated",
        proposedHash: hashBytes(file.content),
      })),
    },
    {
      manifest,
      ownedRoots,
      excludedRoots,
      canonicalize: context.guards.canonicalize,
    },
  );

  return plan.operations;
}

/**
 * The product home and the Brain are validated as two independent ownership
 * universes: each is the other's excluded root. One combined plan cannot express
 * that, because a root cannot be owned and excluded at once, and dropping the
 * exclusion is what lets a symlink inside the product home resolve into the
 * vault.
 */
async function validateOperations(
  context: CliContext,
  plan: InitPlan,
): Promise<readonly ValidatedChangePlanOperationV1[]> {
  const manifest = (await context.manifests.readOptional()) ?? EMPTY_MANIFEST;
  const { paths } = plan;

  const productOperations = await validateFiles(
    context,
    manifest,
    plan.productFiles,
    [paths.home],
    [paths.stateDir, paths.stagingDir, paths.backupsDir, paths.logsDir, paths.brain],
  );
  const brainOperations = await validateFiles(
    context,
    manifest,
    plan.brainFiles,
    [paths.brain],
    [paths.home],
  );

  return [...productOperations, ...brainOperations];
}

/**
 * Re-checked after the confirmation, not only while building the plan: the user
 * may take arbitrarily long to answer, and a directory that was absent when the
 * plan was computed must not have become a symlink by the time it is created.
 */
async function createDirectories(
  context: CliContext,
  plan: InitPlan,
): Promise<void> {
  for (const directory of plan.productDirectories) {
    await assertUsableDirectory(context, directory, "product state");
  }
  await assertUsableDirectory(context, plan.paths.brain, "Brain");

  for (const directory of [
    ...plan.missingProductDirectories,
    ...plan.brainDirectories,
  ]) {
    await context.guards.transaction.assertTarget(directory);
    await context.fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }

  /**
   * `mkdir`'s mode applies only to directories it actually creates, so a product
   * directory that already existed keeps whatever mode it had — including a
   * world-writable one. State, staging, and backups are owner-only by contract.
   */
  for (const directory of plan.productDirectories) {
    await context.fs.chmod(directory, 0o700);
  }
}

function mutationsFor(
  operations: readonly ValidatedChangePlanOperationV1[],
  files: readonly DesiredFile[],
): readonly PlannedFileMutation[] {
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));

  return operations.map((operation) => {
    const content = contentByPath.get(operation.targetPath);
    if (content === undefined) {
      throw new InitRefusal(
        EXIT_CODES.operationalFailure,
        "the validated change plan lost its staged content",
        [operation.canonicalTargetPath],
      );
    }
    return {
      targetPath: operation.canonicalTargetPath,
      operation: "create" as const,
      content,
    };
  });
}

async function recordArtifacts(
  context: CliContext,
  plan: InitPlan,
  operations: readonly ValidatedChangePlanOperationV1[],
): Promise<{
  readonly added: readonly ManagedArtifactV1[];
  readonly retained: readonly ManagedArtifactV1[];
}> {
  const verifiedAt = context.now().toISOString();

  const directoryArtifacts: ManagedArtifactV1[] = [];
  for (const directory of [
    ...plan.missingProductDirectories,
    ...plan.brainDirectories,
  ]) {
    directoryArtifacts.push({
      owner: "core",
      path: await canonicalizePlannedPath(directory),
      kind: "directory",
      productVersion: context.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: DIRECTORY_CONTENT_HASH,
      source: DIRECTORY_SOURCE,
      mergeStrategy: "dedicated",
      verifiedAt,
    });
  }

  const fileArtifacts: ManagedArtifactV1[] = operations.map((operation) => ({
    owner: "core" as const,
    path: operation.canonicalTargetPath,
    kind: "file" as const,
    productVersion: context.productVersion,
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    installedHash: operation.proposedHash ?? DIRECTORY_CONTENT_HASH,
    source: operation.source,
    mergeStrategy: "dedicated" as const,
    verifiedAt,
  }));

  const added = [...directoryArtifacts, ...fileArtifacts];
  /**
   * Folded, because `validateManifest` rejects duplicates by folded path. An
   * exact-string filter would keep a retained entry differing only in case and
   * then make the write fail on a case-insensitive volume.
   */
  const addedPaths = new Set(added.map((artifact) => foldPath(artifact.path)));
  const existing = (await context.manifests.readOptional())?.artifacts ?? [];
  const retained = existing.filter(
    (artifact) => !addedPaths.has(foldPath(artifact.path)),
  );

  await context.manifests.write({
    schemaVersion: 1,
    productVersion: context.productVersion,
    installedAt: verifiedAt,
    artifacts: [...retained, ...added],
  });

  return { added, retained };
}

/**
 * `execute` runs a transaction through to `finalized`, and a finalized
 * transaction cannot be rolled back — undoing it is a second, compensating
 * transaction over exactly the artifacts this run added. That is the same
 * operation uninstall performs, so it is the same code; the difference is that
 * init owns the Brain skeleton it just created and may remove it, while
 * uninstall excludes the Brain and never can.
 */
async function revert(
  context: CliContext,
  plan: InitPlan,
  added: readonly ManagedArtifactV1[],
  retained: readonly ManagedArtifactV1[],
): Promise<void> {
  await revertArtifacts(context, {
    kind: "init-revert",
    artifacts: added,
    ownedRoots: [plan.paths.home, ...plan.brainDirectories],
    excludedRoots: [plan.paths.backupsDir],
  });

  if (retained.length === 0) {
    await removeManifestFile(context);
    return;
  }

  await context.manifests.write({
    schemaVersion: 1,
    productVersion: context.productVersion,
    installedAt: context.now().toISOString(),
    artifacts: retained,
  });
}

function describePlan(plan: InitPlan): string {
  const lines = plan.created.map((path) => `  create ${renderPath(path)}`);
  return [
    "Developer OS will make the following changes:",
    ...lines,
    "Proceed?",
  ].join("\n");
}

export async function runInit(
  context: CliContext,
  options: InitOptions,
  dependencies: InitDependencies = DEFAULT_DEPENDENCIES,
): Promise<CliResult<InitResultV1>> {
  try {
    await context.platform.inspect();
    await assertNoIncompleteTransaction(context);
    await assertNoDrift(context);

    const plan = await buildPlan(context);
    const ownedRoots = [plan.paths.home, ...plan.brainDirectories];
    await assertRootsAnchored(ownershipAnchorsFor(context), ownedRoots);

    const settled: InitResultV1 = {
      schemaVersion: 1,
      productHome: plan.paths.home,
      brainPath: plan.paths.brain,
      created: plan.created,
      unchanged: plan.unchanged,
      transactionId: null,
    };

    if (options.dryRun || plan.created.length === 0) return success(settled);

    const operations = await validateOperations(context, plan);

    if (!options.assumeYes && !(await context.io.confirm(describePlan(plan)))) {
      return failure(EXIT_CODES.decisionRequired, {
        kind: "declined",
        message: "initialization was declined",
        paths: [],
      });
    }

    await createDirectories(context, plan);

    const journal = await context.executor.execute({
      kind: "init",
      mutations: mutationsFor(operations, [
        ...plan.productFiles,
        ...plan.brainFiles,
      ]),
    });

    const recorded = await recordArtifacts(context, plan, operations);
    try {
      const report = await dependencies.verify(context);
      if (hasFailingCheck(report)) {
        throw new InitRefusal(
          EXIT_CODES.operationalFailure,
          "post-install verification failed",
          [plan.paths.home],
        );
      }
    } catch (error) {
      /**
       * A revert that fails must not replace the failure that caused it. The
       * caller needs to know why the install was abandoned, and separately that
       * the machine was left mid-revert.
       */
      try {
        await revert(context, plan, recorded.added, recorded.retained);
      } catch (revertError) {
        throw new InitRefusal(
          EXIT_CODES.recoveryRequired,
          `${describeError(error)}; undoing it also failed: ${describeError(revertError)}`,
          [plan.paths.home],
          "developer-os doctor",
        );
      }
      throw error;
    }

    return success({ ...settled, transactionId: journal.id });
  } catch (error) {
    return failureFrom(
      context,
      error,
      error instanceof InitRefusal ? error.paths : [],
      error instanceof InitRefusal ? error.recovery : undefined,
    );
  }
}
