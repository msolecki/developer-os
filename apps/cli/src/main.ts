import { parseArgs } from "node:util";

import {
  EXIT_CODES,
  failure,
  formatJsonResult,
  success,
} from "@developer-os/core";
import type { CliResult, ExitCode } from "@developer-os/core";

import { renderBrain, runBrain } from "./commands/brain.js";
import type { BrainResultV1, BrainSubcommand } from "./commands/brain.js";
import { runCapture } from "./commands/capture.js";
import type { CaptureResultV1 } from "./commands/capture.js";
import { runDoctor } from "./commands/doctor.js";
import type { DoctorReportV1 } from "./commands/doctor.js";
import { renderIngest, runIngest } from "./commands/ingest.js";
import { runInit } from "./commands/init.js";
import type { InitResultV1 } from "./commands/init.js";
import { runRepair } from "./commands/repair.js";
import type { RepairResultV1 } from "./commands/repair.js";
import { runReview } from "./commands/review.js";
import type { ReviewResultV1 } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import type { StatusReportV1 } from "./commands/status.js";
import { runUninstall } from "./commands/uninstall.js";
import type { UninstallResultV1 } from "./commands/uninstall.js";
import { exitCodeOf, PRODUCT_VERSION, renderPath } from "./context.js";
import type { CliContext } from "./context.js";
import type { CliIo } from "./io.js";

export type { CliIo } from "./io.js";

const USAGE = [
  "Usage: developer-os <command> [options]",
  "",
  "Commands:",
  "  init       install product state and a Brain skeleton",
  "  brain      reindex | lint | search <query> | status",
  "  search     alias for brain search <query>",
  "  capture    quarantine one observation, redacted before it is written",
  "  review     list quarantined captures, or decide on one",
  "  ingest     turn accepted captures into notes, one agent call each",
  "  status     report the current installation without changing it",
  "  doctor     run every health check without repairing anything",
  "  repair     resume or roll back one incomplete transaction",
  "  uninstall  remove manifest-owned artifacts",
  "",
  "Options:",
  "  --dry-run        show the plan without changing anything (init, uninstall)",
  "  --yes            accept ordinary confirmations (init, uninstall; ingest never asks)",
  "  --json           emit one machine-readable line",
  "  --limit <n>      most matches to return (brain search), or captures to process (ingest)",
  "  --text <text>    the observation to capture; stdin when absent (capture)",
  "  --id <id>        the capture to decide on (review)",
  "  --decision <d>   accept, reject or edit (review)",
  "  --agent <name>   claude or codex; the first installed one by default (ingest)",
  "  --probe          probe each agent CLI; Claude's probe writes ~/.claude.json (doctor)",
  "  --resume <id>    finish an incomplete transaction (repair)",
  "  --rollback <id>  undo an incomplete transaction (repair)",
  "  --version        print the product version",
].join("\n");

const OPTIONS = {
  "dry-run": { type: "boolean" },
  agent: { type: "string" },
  decision: { type: "string" },
  id: { type: "string" },
  json: { type: "boolean" },
  yes: { type: "boolean" },
  limit: { type: "string" },
  probe: { type: "boolean" },
  resume: { type: "string" },
  rollback: { type: "string" },
  text: { type: "string" },
  version: { type: "boolean" },
} as const;

type OptionName = keyof typeof OPTIONS;

/**
 * Every name in `OPTIONS`, and the two lists must not drift apart:
 * `suppliedOptions` filters *this* list, and the per-command allow-list is
 * checked against what it returns. An option present in `OPTIONS` and absent
 * here is invisible to that check, so `status --text hi` would parse and run —
 * strict dispatch silently holed for every command, not only the new one.
 */
const OPTION_NAMES: readonly OptionName[] = [
  "dry-run",
  "agent",
  "decision",
  "id",
  "json",
  "yes",
  "limit",
  "probe",
  "resume",
  "rollback",
  "text",
  "version",
];

const COMMAND_OPTIONS: Readonly<Record<string, readonly OptionName[]>> = {
  brain: ["dry-run", "json", "limit"],
  search: ["json", "limit"],
  capture: ["text", "json"],
  review: ["id", "decision", "json"],
  ingest: ["limit", "json", "yes", "agent"],
  init: ["dry-run", "yes", "json"],
  status: ["json"],
  doctor: ["json", "probe"],
  repair: ["resume", "rollback", "json"],
  uninstall: ["dry-run", "yes", "json"],
};

/**
 * How many positionals each command takes. `parse` used to reject more than one
 * outright; widening that to a per-command range keeps it exactly as strict —
 * every command still declares its own arity, and anything outside it is
 * invalid input rather than a best guess.
 */
const COMMAND_POSITIONALS: Readonly<
  Record<string, { readonly min: number; readonly max: number }>
> = {
  init: { min: 0, max: 0 },
  capture: { min: 0, max: 0 },
  review: { min: 0, max: 0 },
  ingest: { min: 0, max: 0 },
  status: { min: 0, max: 0 },
  doctor: { min: 0, max: 0 },
  repair: { min: 0, max: 0 },
  uninstall: { min: 0, max: 0 },
  brain: { min: 1, max: 2 },
  search: { min: 1, max: 1 },
};

const BRAIN_SUBCOMMANDS: Readonly<
  Record<string, { readonly options: readonly OptionName[]; readonly query: boolean }>
> = {
  reindex: { options: ["dry-run", "json"], query: false },
  lint: { options: ["json"], query: false },
  search: { options: ["json", "limit"], query: true },
  status: { options: ["json"], query: false },
};

export type CliContextFactory = (io: CliIo) => CliContext;

type OptionValues = Partial<Record<OptionName, boolean | string>>;

interface Invocation {
  readonly command: string;
  readonly values: OptionValues;
  readonly positionals: readonly string[];
  readonly limit: number | null;
}

/**
 * `--limit` is a positive integer or it is invalid input, and it is decided
 * during parsing rather than in the command. `search` throws a `RangeError`
 * for a non-positive integer, and a stack trace is not a CLI error message —
 * but more than that, deciding it later means the refusal happens *after* a
 * context is built, which makes "invalid argument" indistinguishable from
 * "your environment is broken".
 */
function parseLimit(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  if (!/^\d+$/u.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function usageFailure(): CliResult<never> {
  return failure(EXIT_CODES.invalidInput, {
    kind: "invalid_input",
    message: USAGE,
    paths: [],
  });
}

function suppliedOptions(values: OptionValues): readonly OptionName[] {
  return OPTION_NAMES.filter((name) => values[name] !== undefined);
}

function parse(argv: readonly string[]): Invocation | null {
  let positionals: readonly string[];
  let values: OptionValues;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = parsed.positionals;
    values = parsed.values;
  } catch {
    return null;
  }

  const [positional] = positionals;
  if (positional === undefined) {
    return values.version === true &&
      suppliedOptions(values).every(
        (name) => name === "version" || name === "json",
      )
      ? { command: "--version", values, positionals: [], limit: null }
      : null;
  }

  /**
   * `Object.hasOwn`, because a plain object literal inherits `toString`,
   * `constructor`, and friends: `COMMAND_OPTIONS["toString"]` is a function, not
   * `undefined`, so an unknown command named after a prototype member would pass
   * the lookup and then crash on `allowed.includes`.
   */
  if (!Object.hasOwn(COMMAND_OPTIONS, positional)) return null;
  const allowed = COMMAND_OPTIONS[positional];
  if (allowed === undefined || values.version === true) return null;
  if (!suppliedOptions(values).every((name) => allowed.includes(name))) {
    return null;
  }

  const arity = Object.hasOwn(COMMAND_POSITIONALS, positional)
    ? COMMAND_POSITIONALS[positional]
    : undefined;
  if (arity === undefined) return null;
  const rest = positionals.slice(1);
  if (rest.length < arity.min || rest.length > arity.max) return null;

  /**
   * A `brain` subcommand declares its own options and whether it takes a query,
   * so `brain lint --limit 5` and `brain search --dry-run` are refused at parse
   * time rather than ignored later. `Object.hasOwn` for the same reason the
   * command lookup uses it: a subcommand named after a prototype member would
   * otherwise resolve to a function.
   */
  if (positional === "brain") {
    const [name, query] = rest;
    if (name === undefined || !Object.hasOwn(BRAIN_SUBCOMMANDS, name)) {
      return null;
    }
    const subcommand = BRAIN_SUBCOMMANDS[name];
    if (subcommand === undefined) return null;
    if (subcommand.query !== (query !== undefined)) return null;
    if (!suppliedOptions(values).every((o) => subcommand.options.includes(o))) {
      return null;
    }
  }

  const limit = parseLimit(optionString(values.limit));
  if (limit === "invalid") return null;

  return { command: positional, values, positionals: rest, limit };
}

function renderBrainResult(result: BrainResultV1): readonly string[] {
  return renderBrain(result);
}

function renderInit(result: InitResultV1): readonly string[] {
  if (result.created.length === 0) {
    return [
      `Developer OS is already initialized at ${renderPath(result.productHome)}.`,
    ];
  }
  return [
    result.transactionId === null
      ? "Developer OS would create:"
      : "Developer OS created:",
    ...result.created.map((path) => `  ${renderPath(path)}`),
  ];
}

/**
 * A duplicate says so and names the status it already holds, because that is
 * the whole answer: re-capturing something already rejected does not resurrect
 * it, and the user needs to see which decision stands.
 */
function renderCapture(result: CaptureResultV1): readonly string[] {
  return [
    result.duplicate
      ? `Already captured, at status ${result.status}:`
      : "Captured:",
    `  ${renderPath(result.path)}`,
    `redactions          ${String(result.redactionCount)}`,
  ];
}

/**
 * A listing names the ids a decision can be taken on; a decision names what it
 * moved. Neither prints the observation: the capture is Markdown in the user's
 * own vault, and a reviewer reads it there rather than through a terminal that
 * would have to re-screen every line of it.
 */
function renderReview(result: ReviewResultV1): readonly string[] {
  if (result.reviewed > 0) {
    return result.captures.map(
      (capture) => `Reviewed ${capture.captureId}, now ${capture.status}.`,
    );
  }
  if (result.captures.length === 0) {
    return ["No captures are waiting for review."];
  }
  return [
    "Quarantined captures:",
    ...result.captures.map((capture) => `  ${capture.captureId}`),
  ];
}

function renderStatus(report: StatusReportV1): readonly string[] {
  return [
    `product home        ${renderPath(report.productHome)}`,
    `brain               ${renderPath(report.brainPath)}${report.brainPresent ? "" : " (missing)"}`,
    `installed           ${report.installed ? "yes" : "no"}`,
    `product version     ${renderPath(report.productVersion ?? "-")}`,
    `configuration       ${report.configPresent ? "present" : "absent"}`,
    `managed artifacts   ${String(report.managedArtifacts)}`,
    `drift               ${String(report.driftCount)}`,
    `incomplete          ${report.incompleteTransactions.join(", ") || "none"}`,
    `agents              ${report.agents
      .map((agent) => `${agent.name}=${agent.installed ? "present" : "absent"}`)
      .join(" ")}`,
  ];
}

function renderDoctor(report: DoctorReportV1): readonly string[] {
  return report.checks.map(
    (check) => `[${check.status}] ${check.id}: ${renderPath(check.message)}`,
  );
}

function renderRepair(result: RepairResultV1): readonly string[] {
  return [`Transaction ${result.id} ${result.action} (${result.phase}).`];
}

function renderUninstall(result: UninstallResultV1): readonly string[] {
  const lines =
    result.removed.length === 0
      ? ["Nothing owned by Developer OS remains."]
      : [
          "Developer OS removed:",
          ...result.removed.map((path) => `  ${renderPath(path)}`),
        ];

  if (result.restored.length > 0) {
    lines.push(
      "Restored to their pre-install contents:",
      ...result.restored.map((path) => `  ${renderPath(path)}`),
    );
  }
  if (result.preserved.length > 0) {
    lines.push(
      "Preserved:",
      ...result.preserved.map((path) => `  ${renderPath(path)}`),
    );
  }
  return lines;
}

function writeLines(write: (line: string) => void, text: string): void {
  for (const line of text.split("\n")) write(renderPath(line));
}

function emit<T>(
  io: CliIo,
  result: CliResult<T>,
  json: boolean,
  render: (data: T) => readonly string[],
): ExitCode {
  if (json) {
    // Not sanitized: `JSON.stringify` escapes `\p{Cc}`, and a machine consumer
    // needs the value as recorded. It does *not* escape `\p{Cf}`, so a bidi
    // override survives into a terminal that cats the JSON — accepted, because
    // mangling machine output to protect a human reading it raw is the worse
    // trade.
    io.stdout(formatJsonResult(result));
    return result.code;
  }

  if (result.ok) {
    for (const line of render(result.data)) io.stdout(line);
    for (const warning of result.warnings) {
      io.stderr(`warning: ${renderPath(warning)}`);
    }
    return result.code;
  }

  /**
   * Sanitize per line, never per message. `renderPath` replaces every `\p{Cc}`,
   * and `\n` is one — rendering a whole message through it collapses the usage
   * block, the CLI's primary help surface, into a single line of replacement
   * characters.
   */
  writeLines(io.stderr, result.error.message);
  for (const path of result.error.paths) io.stderr(`  ${renderPath(path)}`);
  if (result.error.recovery !== undefined) {
    writeLines(io.stderr, `Recovery: ${result.error.recovery}`);
  }
  return result.code;
}

function contextFailure(error: unknown): CliResult<never> {
  const code = exitCodeOf(error);

  return failure(code === EXIT_CODES.operationalFailure ? EXIT_CODES.invalidInput : code, {
    kind: "invalid_input",
    message:
      error instanceof Error
        ? error.message
        : "the environment could not be resolved",
    paths: [],
  });
}

function optionString(value: boolean | string | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * `developer-os search <query>` is normalized into the same invocation
 * `brain search <query>` produces, so exactly one code path runs and the alias
 * cannot drift from the command it aliases.
 */
function brainOptionsFor(
  invocation: Invocation,
  limit: number | null,
): { subcommand: BrainSubcommand; query: string | null; limit: number | null; dryRun: boolean } {
  const [first, second] = invocation.positionals;
  const alias = invocation.command === "search";
  return {
    subcommand: alias ? "search" : ((first ?? "status") as BrainSubcommand),
    query: alias ? (first ?? null) : (second ?? null),
    limit,
    dryRun: invocation.values["dry-run"] === true,
  };
}

async function dispatch(
  invocation: Invocation,
  io: CliIo,
  createContext: CliContextFactory,
): Promise<ExitCode> {
  const json = invocation.values.json === true;
  const dryRun = invocation.values["dry-run"] === true;
  const assumeYes = invocation.values.yes === true;

  if (invocation.command === "--version") {
    return emit(io, success({ version: PRODUCT_VERSION }), json, () => [
      `developer-os ${PRODUCT_VERSION}`,
    ]);
  }

  /**
   * Building the context resolves runtime paths, which throws on a malformed
   * `DEVELOPER_OS_HOME`. That is invalid input, not an internal failure: without
   * this, `run` rejects and breaks its own `Promise<ExitCode>` contract, and the
   * user sees a generic failure instead of the environment variable at fault.
   */
  let context: CliContext;
  try {
    context = createContext(io);
  } catch (error) {
    return emit(io, contextFailure(error), json, () => []);
  }

  switch (invocation.command) {
    case "init":
      return emit(
        io,
        await runInit(context, { dryRun, assumeYes }),
        json,
        renderInit,
      );
    case "capture": {
      /**
       * Omitted rather than passed as `undefined`: `exactOptionalPropertyTypes`
       * distinguishes the two, and `runCapture` reads *absent* as "read stdin".
       */
      const text = optionString(invocation.values.text);
      return emit(
        io,
        await runCapture(context, text === null ? {} : { text }),
        json,
        renderCapture,
      );
    }
    case "review": {
      /**
       * Omitted rather than passed as `undefined`: `exactOptionalPropertyTypes`
       * distinguishes the two, and `runReview` reads *both* absent as "list".
       */
      const id = optionString(invocation.values.id);
      const decision = optionString(invocation.values.decision);
      return emit(
        io,
        await runReview(context, {
          ...(id === null ? {} : { id }),
          ...(decision === null ? {} : { decision }),
        }),
        json,
        renderReview,
      );
    }
    case "ingest": {
      /**
       * `limit` and `agent` are omitted rather than passed as `undefined`:
       * `exactOptionalPropertyTypes` distinguishes the two, and `runIngest`
       * reads *absent* as "every accepted capture" and "the first installed
       * vendor" respectively.
       */
      const agent = optionString(invocation.values.agent);
      return emit(
        io,
        await runIngest(context, {
          ...(invocation.limit === null ? {} : { limit: invocation.limit }),
          ...(agent === null ? {} : { agent }),
          assumeYes,
        }),
        json,
        renderIngest,
      );
    }
    case "status":
      return emit(io, await runStatus(context), json, renderStatus);
    case "doctor":
      return emit(
        io,
        await runDoctor(context, {
          probe: invocation.values.probe === true,
        }),
        json,
        renderDoctor,
      );
    case "repair":
      return emit(
        io,
        await runRepair(context, {
          resume: optionString(invocation.values.resume),
          rollback: optionString(invocation.values.rollback),
        }),
        json,
        renderRepair,
      );
    case "uninstall":
      return emit(
        io,
        await runUninstall(context, { dryRun, assumeYes }),
        json,
        renderUninstall,
      );
    case "brain":
    case "search":
      return emit(
        io,
        await runBrain(context, brainOptionsFor(invocation, invocation.limit)),
        json,
        renderBrainResult,
      );
    default:
      return emit(io, usageFailure(), json, () => []);
  }
}

/**
 * Dispatch is strict on purpose: an unknown command, an unknown option, or an
 * option a command does not accept is invalid input, never a best guess at what
 * the caller meant.
 */
export async function run(
  argv: readonly string[],
  io: CliIo,
  createContext: CliContextFactory,
): Promise<ExitCode> {
  const invocation = parse(argv);
  if (invocation === null) {
    return emit(io, usageFailure(), argv.includes("--json"), () => []);
  }

  return dispatch(invocation, io, createContext);
}
