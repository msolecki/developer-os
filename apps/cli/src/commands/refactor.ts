import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  success,
  TransactionPlanError,
  TransactionPreconditionError,
} from "@developer-os/core";
import type { CliResult, ExitCode, PlannedFileMutation } from "@developer-os/core";
import {
  anyAgentMarker,
  BrainService,
  planRefactor,
  RefactorRefusal,
  resolveBrainConfig,
} from "@developer-os/brain";
import type {
  RefactorPlanV1,
  RefactorRefusalCodeV1,
  RefactorRequestV1,
} from "@developer-os/brain";

import { failureFrom, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";
import { readConfig } from "./brain.js";
import { dependenciesFor, writeIndexArtifacts } from "./reindex.js";

export interface BrainRefactorResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "retire" | "refactor";
  readonly mode: "retire" | "rename" | "move" | "merge" | "split";
  /** `null` under `--dry-run`. */
  readonly transactionId: string | null;
  readonly mutations: readonly {
    readonly operation: "create" | "replace" | "remove";
    /** Content-root-relative, byte-exact; screened only at the terminal. */
    readonly path: string;
  }[];
  readonly rewrittenLinks: number;
}

export interface RefactorOptions {
  readonly subcommand: "retire" | "refactor";
  readonly request: RefactorRequestV1;
  readonly dryRun: boolean;
}

const KINDS = {
  retire: "brain-retire",
  refactor: "brain-refactor",
  reindex: "brain-refactor-reindex",
} as const;

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

type CommandReason =
  | RefactorRefusalCodeV1
  | "brain_refactor_in_agent_session"
  | "brain_refactor_path_refused"
  | "note_changed_since_read"
  | "refactor_reindex_failed";

const PLANNER_EXIT_CODES: Readonly<Record<RefactorRefusalCodeV1, FailureExitCode>> = {
  brain_refactor_input_invalid: EXIT_CODES.invalidInput,
  refactor_destination_exists: EXIT_CODES.decisionRequired,
  retire_has_referrers: EXIT_CODES.decisionRequired,
  refactor_postcondition_failed: EXIT_CODES.operationalFailure,
  refactor_too_wide: EXIT_CODES.operationalFailure,
};

class BrainRefactorRefusal extends Error {
  constructor(
    readonly reason: CommandReason,
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    // failureFrom publishes kindOf(name), so the name is what yields the reason code.
    this.name = `${reason
      .split("_")
      .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
      .join("")}Error`;
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

function pathRefused(path: string, why: string): BrainRefactorRefusal {
  return new BrainRefactorRefusal(
    "brain_refactor_path_refused",
    EXIT_CODES.securityRefusal,
    `${path} ${why}; nothing was written`,
    [path],
  );
}

/**
 * Spec §6.2's containment, stated directly: no component below the content
 * root is a symlink, the path canonicalizes inside a configured topic folder
 * (or `_graveyard/` for retire and merge), and a `create` target is absent.
 * Returns the canonical absolute target.
 */
async function containedTarget(
  context: CliContext,
  contentRoot: string,
  topicFolders: readonly string[],
  mode: RefactorPlanV1["mode"],
  operation: "create" | "replace" | "remove",
  path: string,
): Promise<string> {
  const segments = path.split("/");
  let exists = true;
  for (let i = 1; i <= segments.length && exists; i += 1) {
    try {
      const stats = await context.fs.lstat(join(contentRoot, ...segments.slice(0, i)));
      if (stats.isSymbolicLink()) throw pathRefused(path, "passes through a symbolic link");
    } catch (error) {
      if (!isMissing(error)) throw error;
      exists = false;
    }
  }

  const graveyard =
    (mode === "retire" || mode === "merge") && path.startsWith("_graveyard/")
      ? ["_graveyard"]
      : [];
  const canonical = await context.guards.canonicalize(join(contentRoot, path));
  let inside = false;
  for (const folder of [...topicFolders, ...graveyard]) {
    if (containsPath(await context.guards.canonicalize(join(contentRoot, folder)), canonical)) {
      inside = true;
      break;
    }
  }
  if (!inside) throw pathRefused(path, "is outside every configured topic folder");

  if (operation === "create" && exists) {
    throw new BrainRefactorRefusal(
      "refactor_destination_exists",
      EXIT_CODES.decisionRequired,
      `${path} already exists; nothing was written`,
      [path],
    );
  }
  return canonical;
}

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export async function runRefactor(
  context: CliContext,
  options: RefactorOptions,
): Promise<CliResult<BrainRefactorResultV1>> {
  try {
    if (!options.dryRun && anyAgentMarker(context.env)) {
      throw new BrainRefactorRefusal(
        "brain_refactor_in_agent_session",
        EXIT_CODES.securityRefusal,
        `brain ${options.subcommand} changes notes and is not applied inside an agent session; --dry-run is allowed`,
        [],
        "run the printed command yourself in a terminal outside the agent session",
      );
    }

    const config = await readConfig(context);
    const paths = runtimePathsFor(context, config);
    const brainConfig = resolveBrainConfig(config);
    const deps = dependenciesFor(context, paths.brain, config);
    const contentRoot = join(paths.brain, brainConfig.contentRoot);

    let plan: RefactorPlanV1;
    try {
      plan = await planRefactor(options.request, {
        build: {
          vaultRoot: deps.vaultRoot,
          config: deps.config,
          reader: deps.reader,
          readFile: deps.readFile,
          assertReadable: deps.assertReadable,
          now: () => deps.now().toISOString(),
        },
        today: context.now().toISOString().slice(0, "YYYY-MM-DD".length),
      });
    } catch (error) {
      if (!(error instanceof RefactorRefusal)) throw error;
      throw new BrainRefactorRefusal(
        error.reason,
        PLANNER_EXIT_CODES[error.reason],
        error.message,
        error.paths,
        error.reason === "retire_has_referrers"
          ? `developer-os brain refactor --merge ${options.request.mode === "retire" ? options.request.note : "<note>"} <target>`
          : undefined,
      );
    }

    const targets: string[] = [];
    for (const mutation of plan.mutations) {
      targets.push(
        await containedTarget(
          context,
          contentRoot,
          brainConfig.topicFolders,
          plan.mode,
          mutation.operation,
          mutation.path,
        ),
      );
    }

    const result = (transactionId: string | null): BrainRefactorResultV1 => ({
      schemaVersion: 1,
      subcommand: options.subcommand,
      mode: plan.mode,
      transactionId,
      mutations: plan.mutations.map(({ operation, path }) => ({ operation, path })),
      rewrittenLinks: plan.rewrittenLinks,
    });
    if (options.dryRun) return success(result(null));

    const mutations: PlannedFileMutation[] = [];
    for (const [index, mutation] of plan.mutations.entries()) {
      const target = targets[index] as string;
      if (mutation.operation === "create") {
        await context.guards.transaction.assertTarget(target);
        await context.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
        mutations.push({
          targetPath: target,
          operation: "create",
          content: Buffer.from(mutation.content ?? "", "utf8"),
        });
        continue;
      }
      mutations.push({
        targetPath: target,
        operation: mutation.operation,
        content: mutation.content === null ? null : Buffer.from(mutation.content, "utf8"),
        expectedBeforeHash: sha256(mutation.before ?? ""),
      });
    }

    let transactionId: string;
    try {
      transactionId = (
        await context.executor.execute({ kind: KINDS[options.subcommand], mutations })
      ).id;
    } catch (error) {
      if (!(error instanceof TransactionPreconditionError || error instanceof TransactionPlanError)) {
        throw error;
      }
      throw new BrainRefactorRefusal(
        "note_changed_since_read",
        EXIT_CODES.decisionRequired,
        "a note changed after it was read; nothing was written",
        plan.mutations.map((mutation) => mutation.path),
        `developer-os brain ${options.subcommand} again against the current notes`,
      );
    }

    try {
      await writeIndexArtifacts(context, {
        vaultRoot: paths.brain,
        paths,
        contentRoot: brainConfig.contentRoot,
        indexesDir: join(brainConfig.contentRoot, brainConfig.indexesDir),
        files: (await new BrainService(deps).reindex()).files,
        kind: KINDS.reindex,
        refuse: (message) => new Error(message),
        refuseIndexEscape: (message) => new Error(message),
      });
    } catch (error) {
      throw new BrainRefactorRefusal(
        "refactor_reindex_failed",
        EXIT_CODES.operationalFailure,
        `the ${options.subcommand} was applied in transaction ${transactionId}, but the index was not rebuilt: ${error instanceof Error ? error.message : String(error)}`,
        [],
        "developer-os brain reindex",
      );
    }

    return success(result(transactionId));
  } catch (error) {
    /** `readConfig`'s `BrainRefusal` carries `paths` and `recovery` the same way this file's refusals do. */
    const carried = error as { readonly paths?: unknown; readonly recovery?: unknown } | null;
    return failureFrom(
      context,
      error,
      Array.isArray(carried?.paths) ? (carried.paths as readonly string[]) : [],
      typeof carried?.recovery === "string" ? carried.recovery : undefined,
    );
  }
}
