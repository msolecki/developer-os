import { join } from "node:path";

import {
  EXIT_CODES,
  failure,
  foldPath,
  hashBytes,
  loadConfig,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  InstallationManifestV1,
  ManagedArtifactV1,
  PlannedFileMutation,
} from "@developer-os/core";
import { BrainService, resolveBrainConfig } from "@developer-os/brain";
import type {
  BrainServiceDependencies,
  DirectoryEntry,
  LintFinding,
  RetrievalMatch,
} from "@developer-os/brain";

import { failureFrom, renderPath, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";

export interface BrainReindexResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "reindex";
  readonly written: readonly string[];
  /** `null` under `--dry-run`, matching the convention `InitResultV1` uses. */
  readonly transactionId: string | null;
}

export interface BrainLintResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "lint";
  readonly findings: readonly LintFinding[];
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
}

export interface BrainSearchResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "search";
  readonly matches: readonly RetrievalMatch[];
  readonly considered: number;
  readonly selected: number;
  readonly truncated: boolean;
  /**
   * The access paths the funnel tried, and non-`null` only when none of them
   * reached anything. Spec §8 requires a miss to say which doors were tried
   * rather than look like an empty result set.
   */
  readonly tried: readonly string[] | null;
}

export interface BrainStatusResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "status";
  readonly vaultRoot: string;
  readonly contentRoot: string;
  readonly noteCount: number;
  readonly topicFolders: readonly string[];
  readonly unclassifiedFolders: readonly string[];
  readonly indexPresent: boolean;
  readonly wouldChange: readonly LintFinding[];
}

export type BrainResultV1 =
  | BrainReindexResultV1
  | BrainLintResultV1
  | BrainSearchResultV1
  | BrainStatusResultV1;

export type BrainSubcommand = "reindex" | "lint" | "search" | "status";

export interface BrainOptions {
  readonly subcommand: BrainSubcommand;
  readonly query: string | null;
  readonly limit: number | null;
  readonly dryRun: boolean;
}

/** Enough to act on; a hundred-line failure is a wall nobody reads. */
const MAX_REPORTED_ERRORS = 20;

const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class BrainRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "BrainRefusal";
  }
}

async function readConfig(context: CliContext): Promise<DeveloperOsConfigV1> {
  let serialized: string;
  try {
    serialized = await context.guards.readText(context.paths.configFile);
  } catch {
    throw new BrainRefusal(
      EXIT_CODES.invalidInput,
      "Developer OS is not initialized, so there is no Brain to work with",
      [context.paths.configFile],
      "developer-os init",
    );
  }
  return loadConfig(serialized);
}

/**
 * Notes are read through the protected-path policy, not through the raw
 * filesystem. They are user files in a user-writable tree, and `readText` is
 * the channel that opens with `O_NOFOLLOW` and re-checks `dev`/`ino` after
 * open — the same guard configuration gets.
 */
function dependenciesFor(
  context: CliContext,
  vaultRoot: string,
  config: DeveloperOsConfigV1,
): BrainServiceDependencies {
  return {
    vaultRoot,
    config: resolveBrainConfig(config),
    reader: {
      readDir: async (path: string): Promise<readonly DirectoryEntry[]> => {
        const entries = await context.fs.readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
      },
    },
    readFile: (path: string) => context.guards.readText(path),
    assertReadable: async (path: string): Promise<void> => {
      await context.guards.manifest.assertReadable(path);
    },
    now: context.now,
  };
}

/**
 * The two-step shape `init` uses: validate ownership, then execute. The index
 * directory is the only root this command may write to, and the product home is
 * excluded as the other ownership universe — a symlink inside one resolving
 * into the other is what the exclusion refuses.
 */
async function stageArtifacts(
  context: CliContext,
  vaultRoot: string,
  files: Readonly<Record<string, string>>,
  indexesDir: string,
): Promise<{
  readonly mutations: readonly PlannedFileMutation[];
  readonly artifacts: readonly ManagedArtifactV1[];
}> {
  const encoder = new TextEncoder();
  const verifiedAt = context.now().toISOString();

  const planned = await Promise.all(
    Object.entries(files).map(async ([vaultPath, text]) => {
      /**
       * Canonical, once, and everything downstream keys off it.
       *
       * `recordArtifacts` stores `canonicalTargetPath`, so a reconciliation
       * that looked up the *declared* path missed every record whenever an
       * ancestor of the vault is a symlink — `/tmp`, `~/Dropbox`, `/Volumes`,
       * or a hand-set `brainPath`. It then adopted a second entry for the same
       * file, and `validateManifest` accepted it because it dedupes on the
       * literal string while `validateChangePlan` dedupes on the canonical one.
       * The corrupt manifest reached disk, and from then on both `reindex` and
       * `init` threw `ManifestStateError` with no way out but `uninstall`.
       */
      const targetPath = await context.guards.canonicalize(
        join(vaultRoot, vaultPath),
      );
      let onDisk: string | null = null;
      try {
        onDisk = hashBytes(
          encoder.encode(await context.guards.readText(targetPath)),
        );
      } catch {
        onDisk = null;
      }
      return {
        vaultPath,
        targetPath,
        content: encoder.encode(text),
        onDisk,
      };
    }),
  );

  /**
   * Reconcile the manifest with the disk *before* planning anything.
   *
   * `validateChangePlan` decides ownership from the manifest and
   * `TransactionExecutor` decides feasibility from the disk, and reindex is the
   * one command where those two routinely disagree through no fault of the
   * user. Three ordinary sequences produced a permanently wedged command:
   * deleting `_indexes/` to start fresh left the manifest claiming files that
   * are gone, so every later run planned a `replace` the executor refused; a
   * crash between the transaction and the recording left files nobody owned, so
   * every later run planned a `create` the executor refused; and
   * `uninstall` → `init` → `reindex` produced the second of those, because
   * uninstall deletes the manifest and deliberately preserves the vault.
   *
   * Both reconciliations move the manifest *towards* what is on disk, so a
   * crash part-way through leaves it more accurate than it was, not less.
   */
  const existing = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: verifiedAt,
  };
  const recorded = new Map(
    existing.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const adopted: ManagedArtifactV1[] = [];
  const forgotten = new Set<string>();
  for (const entry of planned) {
    const key = foldPath(entry.targetPath);
    const managed = recorded.get(key);
    if (entry.onDisk !== null && managed === undefined) {
      adopted.push({
        owner: "core",
        path: entry.targetPath,
        kind: "file",
        productVersion: context.productVersion,
        /**
         * `false`, and that is the honest value rather than a convenient one.
         * The manifest ties `existedBefore` to a backup it can restore — the
         * validator refuses `true` without a `backupRelativePath` — and
         * adoption takes no backup, because these four files are generated and
         * there is no prior version worth restoring. `uninstall` preserves them
         * by location regardless of what this says.
         */
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: entry.onDisk,
        source: entry.vaultPath,
        mergeStrategy: "dedicated",
        verifiedAt,
      });
    }
    if (entry.onDisk === null && managed !== undefined) forgotten.add(key);
  }

  /**
   * Reconciled in memory and never written here. `validateChangePlan` takes the
   * manifest as an argument, so adoption only has to exist for the length of
   * this call — and a staging step that persisted it would leave adopted vault
   * artifacts recorded in a real installation's manifest even when the plan was
   * then refused. `recordArtifacts` writes the real state after the transaction
   * succeeds, and because it replaces every entry for the paths it wrote, the
   * forgotten ones are dropped there too.
   */
  const manifest: InstallationManifestV1 = {
    ...existing,
    artifacts: [
      ...existing.artifacts.filter(
        (artifact) => !forgotten.has(foldPath(artifact.path)),
      ),
      ...adopted,
    ],
  };
  const owned = new Map(
    manifest.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const operations = planned.map((entry) => {
    const managed = owned.get(foldPath(entry.targetPath));
    return {
      ...entry,
      /**
       * From the disk, because the executor checks the disk. The manifest now
       * agrees with it after the reconciliation above, so the two cannot part
       * company here.
       */
      operation: entry.onDisk === null ? ("create" as const) : ("replace" as const),
      owner: "core" as const,
      kind: "file" as const,
      /**
       * The manifest's hash, which is what `validateChangePlan` compares
       * against — itself. That check is therefore not what stops a hand-edited
       * artifact being overwritten, and nothing here is: these four files are
       * generated, regenerating them is the whole point of the command, and
       * `brain lint`'s `index-drift` class is where a user is told they had
       * diverged.
       */
      expectedBeforeHash: managed?.installedHash ?? null,
      mergeStrategy: "dedicated" as const,
      proposedHash: hashBytes(entry.content),
    };
  });

  const validated = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      /** The plan carries hashes; the bytes travel separately to the executor. */
      operations: operations.map((operation) => ({
        targetPath: operation.targetPath,
        operation: operation.operation,
        owner: operation.owner,
        kind: operation.kind,
        expectedBeforeHash: operation.expectedBeforeHash,
        source: operation.vaultPath,
        mergeStrategy: operation.mergeStrategy,
        proposedHash: operation.proposedHash,
      })),
    },
    {
      manifest,
      /**
       * Narrower than it needs to be today, deliberately. Every path this
       * command plans is inside the index directory by construction, so
       * widening this root to the whole vault changes no observable behaviour
       * and no test can tell the difference. It is here to constrain the *next*
       * thing that writes through this function.
       */
      ownedRoots: [join(vaultRoot, indexesDir)],
      excludedRoots: [context.paths.home],
      canonicalize: context.guards.canonicalize,
    },
  );

  const contentByPath = new Map(
    operations.map((operation) => [operation.targetPath, operation]),
  );

  const mutations: PlannedFileMutation[] = [];
  const artifacts: ManagedArtifactV1[] = [];

  for (const operation of validated.operations) {
    const staged = contentByPath.get(operation.targetPath);
    if (staged === undefined) {
      throw new BrainRefusal(
        EXIT_CODES.operationalFailure,
        "the validated change plan lost its staged content",
        [operation.canonicalTargetPath],
      );
    }
    mutations.push({
      targetPath: operation.canonicalTargetPath,
      operation: operation.operation === "remove" ? "replace" : operation.operation,
      content: staged.content,
    });
    artifacts.push({
      owner: "core",
      path: operation.canonicalTargetPath,
      kind: "file",
      productVersion: context.productVersion,
      /** As above: no backup is taken for a generated artifact. */
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: operation.proposedHash ?? hashBytes(staged.content),
      source: operation.source,
      mergeStrategy: "dedicated",
      verifiedAt,
    });
  }

  return { mutations, artifacts };
}

/**
 * Records what was written, because ownership lives in the manifest: a second
 * reindex is a `replace`, and `validateChangePlan` refuses to replace an
 * artifact nobody owns. Recording them is also safe for `uninstall`, which
 * partitions artifacts by *location* before it plans anything and preserves
 * everything under the Brain path whatever the manifest says.
 */
async function recordArtifacts(
  context: CliContext,
  artifacts: readonly ManagedArtifactV1[],
): Promise<void> {
  const manifest = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: context.now().toISOString(),
  };

  const written = new Set(artifacts.map((artifact) => foldPath(artifact.path)));
  await context.manifests.write({
    ...manifest,
    artifacts: [
      ...manifest.artifacts.filter(
        (artifact) => !written.has(foldPath(artifact.path)),
      ),
      ...artifacts,
    ],
  });
}

async function runReindex(
  context: CliContext,
  service: BrainService,
  vaultRoot: string,
  indexesDir: string,
  dryRun: boolean,
): Promise<CliResult<BrainReindexResultV1>> {
  const artifacts = await service.reindex();
  const written = Object.keys(artifacts.files).sort();

  if (dryRun) {
    return success({
      schemaVersion: 1,
      subcommand: "reindex",
      written,
      transactionId: null,
    });
  }

  /**
   * The transaction stages into a temporary file beside its target, so the
   * directory has to exist first — the same reason `init` creates directories
   * before it executes. It is normally there from `init`'s template; this is
   * the path that matters when a user deleted it to start fresh.
   *
   * Not recorded as a managed artifact: `uninstall` preserves anything under
   * the vault by location, so recording a directory it will never remove buys
   * nothing and puts a user-visible folder into the drift report.
   */
  const indexDirectory = join(vaultRoot, indexesDir);
  /**
   * Through the same guard `init` applies before every directory it creates.
   * The path comes from a config-supplied `brainPath`, and `assertWritable` is
   * what refuses one that lands under `~/.ssh`, `~/.aws` or a `.env` segment.
   *
   * Defence in depth, and unreachable today: discovery's own `assertReadable`
   * refuses a protected vault before this line runs, so no test can show this
   * check firing. Kept because that ordering is a property of the current call
   * path, not a guarantee.
   */
  await context.guards.transaction.assertTarget(indexDirectory);
  await context.fs.mkdir(indexDirectory, { recursive: true, mode: 0o700 });

  const staged = await stageArtifacts(
    context,
    vaultRoot,
    artifacts.files,
    indexesDir,
  );
  const journal = await context.executor.execute({
    kind: "brain-reindex",
    mutations: staged.mutations,
  });
  await recordArtifacts(context, staged.artifacts);

  return success({
    schemaVersion: 1,
    subcommand: "reindex",
    written,
    transactionId: journal.id,
  });
}

async function runLint(
  service: BrainService,
): Promise<CliResult<BrainLintResultV1>> {
  const result = await service.lint();
  const data: BrainLintResultV1 = {
    schemaVersion: 1,
    subcommand: "lint",
    findings: result.findings,
    errorCount: result.errorCount,
    warnCount: result.warnCount,
    infoCount: result.infoCount,
  };

  if (result.errorCount === 0) {
    return success(
      data,
      result.findings
        .filter((finding) => finding.severity === "warn")
        .map((finding) => `${finding.path}: ${finding.message}`),
    );
  }

  /**
   * A failing lint carries its findings in the message, because `CliResult`
   * cannot carry data on a failure and this command exists to say what is
   * wrong. Exiting non-zero with nothing but a count would make every consumer
   * run the command twice — once for the code, once for `--json` — and the
   * second run would exit non-zero too.
   *
   * Bounded, and the messages are already redacted: `lint` truncates every
   * author-controlled value it interpolates at 64 graphemes.
   */
  const errors = result.findings.filter(
    (finding) => finding.severity === "error",
  );
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const lines = [
    `${String(result.errorCount)} error${result.errorCount === 1 ? "" : "s"} in the vault`,
    ...shown.map(
      (finding) =>
        `  ${finding.class} ${finding.path}${finding.line === null ? "" : `:${String(finding.line)}`} ${finding.message}`,
    ),
    ...(errors.length > shown.length
      ? [`  and ${String(errors.length - shown.length)} more`]
      : []),
  ];

  /** Thrown rather than returned, so it takes the redacting path in runBrain. */
  throw new BrainRefusal(
    EXIT_CODES.operationalFailure,
    lines.join("\n"),
    [...new Set(shown.map((finding) => finding.path))],
    "developer-os brain reindex, then fix each note the findings name",
  );
}

async function runSearch(
  service: BrainService,
  query: string,
  limit: number,
): Promise<CliResult<BrainSearchResultV1>> {
  /**
   * `search` throws `RangeError` for a `maxCandidates` that is not a positive
   * integer. `--limit` is validated before it reaches here, so this catch is
   * the backstop for the day a second caller forgets — a caller bug must not
   * surface as an unhandled rejection with a stack trace.
   */
  let outcome;
  try {
    outcome = await service.search({ text: query, maxCandidates: limit });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BrainRefusal(EXIT_CODES.invalidInput, error.message, []);
  }

  if (outcome.kind === "index-unavailable") {
    /**
     * The two reasons get different recovery text. "Missing" is an ordinary
     * first run; "unreadable" means there is a file there and it is wrong,
     * which is worth saying before telling someone to overwrite it.
     */
    throw new BrainRefusal(
      EXIT_CODES.invalidInput,
      outcome.message,
      [],
      outcome.reason === "missing"
        ? "developer-os brain reindex"
        : "inspect the index, then developer-os brain reindex to rebuild it",
    );
  }

  if (outcome.kind === "no-candidates") {
    return success({
      schemaVersion: 1,
      subcommand: "search",
      matches: [],
      considered: 0,
      selected: 0,
      truncated: false,
      tried: outcome.tried,
    });
  }

  return success({
    schemaVersion: 1,
    subcommand: "search",
    matches: outcome.matches,
    considered: outcome.considered,
    selected: outcome.selected,
    truncated: outcome.truncated,
    tried: null,
  });
}

async function runStatus(
  service: BrainService,
): Promise<CliResult<BrainStatusResultV1>> {
  const report = await service.status();
  return success({
    schemaVersion: 1,
    subcommand: "status",
    vaultRoot: report.vaultRoot,
    contentRoot: report.contentRoot,
    noteCount: report.noteCount,
    topicFolders: report.topicFolders,
    unclassifiedFolders: report.unclassifiedFolders,
    indexPresent: report.indexPresent,
    wouldChange: report.wouldChange,
  });
}

export async function runBrain(
  context: CliContext,
  options: BrainOptions,
): Promise<CliResult<BrainResultV1>> {
  try {
    const config = await readConfig(context);
    const paths = runtimePathsFor(context, config);
    const brainConfig = resolveBrainConfig(config);
    const service = new BrainService(
      dependenciesFor(context, paths.brain, config),
    );

    switch (options.subcommand) {
      case "reindex":
        return await runReindex(
          context,
          service,
          paths.brain,
          join(brainConfig.contentRoot, brainConfig.indexesDir),
          options.dryRun,
        );
      case "lint":
        return await runLint(service);
      case "search":
        return await runSearch(
          service,
          options.query ?? "",
          options.limit ?? brainConfig.retrieval.maxCandidates,
        );
      case "status":
        return await runStatus(service);
    }
  } catch (error) {
    if (error instanceof BrainRefusal) {
      /**
       * Redacted like every other failure this CLI emits. `init` gets this for
       * free by routing through `failureFrom`; building the result by hand here
       * skipped it, and lint findings interpolate note content.
       */
      return failure(error.code, {
        kind: "brain_refusal",
        message: context.guards.redactDiagnostic(error.message),
        paths: error.paths,
        ...(error.recovery === undefined
          ? {}
          : { recovery: context.guards.redactDiagnostic(error.recovery) }),
      });
    }
    return failureFrom(context, error);
  }
}

/** Human-facing rendering. Every path goes through `renderPath` first. */
export function renderBrain(result: BrainResultV1): readonly string[] {
  switch (result.subcommand) {
    case "reindex":
      return [
        result.transactionId === null
          ? "developer-os would write:"
          : "developer-os wrote:",
        ...result.written.map((path) => `  ${renderPath(path)}`),
      ];
    case "lint":
      return result.findings.length === 0
        ? ["No findings."]
        : result.findings.map(
            (finding) =>
              `[${finding.severity}] ${finding.class} ${renderPath(finding.path)}${
                finding.line === null ? "" : `:${String(finding.line)}`
              } ${renderPath(finding.message)}`,
          );
    case "search":
      if (result.tried !== null) {
        return [
          `Nothing reachable. Tried: ${result.tried.join(", ")}.`,
        ];
      }
      return [
        ...result.matches.map(
          (match) =>
            `${String(match.score).padStart(3, " ")}  ${renderPath(match.path)}  ${renderPath(match.title)}`,
        ),
        result.truncated
          ? `Showing ${String(result.selected)} of ${String(result.considered)}.`
          : `${String(result.selected)} match${result.selected === 1 ? "" : "es"}.`,
      ];
    case "status":
      return [
        `vault               ${renderPath(result.vaultRoot)}`,
        `content root        ${renderPath(result.contentRoot)}`,
        `notes               ${String(result.noteCount)}`,
        `topic folders       ${result.topicFolders.map(renderPath).join(" ")}`,
        `unclassified        ${result.unclassifiedFolders.map(renderPath).join(" ") || "none"}`,
        `index               ${result.indexPresent ? "present" : "not built"}`,
        `would change        ${String(result.wouldChange.length)}`,
      ];
  }
}
