import { join } from "node:path";

import {
  EXIT_CODES,
  failure,
  success,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
} from "@developer-os/core";
import { BrainService, resolveBrainConfig } from "@developer-os/brain";
import type { LintFinding, RetrievalMatch } from "@developer-os/brain";

import { failureFrom, renderPath, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";
import { ConfigurationError, readConfigFile } from "./doctor.js";
import { dependenciesFor, writeIndexArtifacts } from "./reindex.js";

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

/**
 * Absence and corruption are different failures with different recoveries, so
 * `readConfigFile`'s `null`-versus-throw split is preserved rather than folded
 * into one message: a missing `config.toml` means "run `init`", but a present,
 * unparseable one means `init` will refuse on drift, which is the wrong answer
 * for that user. `ConfigurationError` itself is rethrown unmodified — its
 * message already quotes nothing, and it carries the same exit code this
 * function's own `notInitialized` refusal uses, so `failureFrom` renders it
 * correctly with no extra handling here.
 */
async function readConfig(context: CliContext): Promise<DeveloperOsConfigV1> {
  const notInitialized = new BrainRefusal(
    EXIT_CODES.invalidInput,
    "Developer OS is not initialized, so there is no Brain to work with",
    [context.paths.configFile],
    "developer-os init",
  );

  let config: DeveloperOsConfigV1 | null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw notInitialized;
  }

  if (config === null) throw notInitialized;
  return config;
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
   * Every step of the write — the directory, the ownership validation, the
   * transaction, the manifest record — lives in `reindex.ts`, because
   * `developer-os ingest` performs the identical sequence as the third of its
   * four transactions. What stays here is what differs: this command's
   * transaction kind and its own refusal class.
   */
  const transactionId = await writeIndexArtifacts(context, {
    vaultRoot,
    indexesDir,
    files: artifacts.files,
    kind: "brain-reindex",
    refuse: (message, paths) =>
      new BrainRefusal(EXIT_CODES.operationalFailure, message, paths),
  });

  return success({
    schemaVersion: 1,
    subcommand: "reindex",
    written,
    transactionId,
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
