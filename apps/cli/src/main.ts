import { parseArgs } from "node:util";

import {
  EXIT_CODES,
  failure,
  formatJsonResult,
  success,
} from "@developer-os/core";
import type { CliResult, ExitCode } from "@developer-os/core";

import { runDoctor } from "./commands/doctor.js";
import type { DoctorReportV1 } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import type { InitResultV1 } from "./commands/init.js";
import { runRepair } from "./commands/repair.js";
import type { RepairResultV1 } from "./commands/repair.js";
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
  "  status     report the current installation without changing it",
  "  doctor     run every health check without repairing anything",
  "  repair     resume or roll back one incomplete transaction",
  "  uninstall  remove manifest-owned artifacts",
  "",
  "Options:",
  "  --dry-run        show the plan without changing anything (init, uninstall)",
  "  --yes            accept ordinary confirmations (init, uninstall)",
  "  --json           emit one machine-readable line",
  "  --resume <id>    finish an incomplete transaction (repair)",
  "  --rollback <id>  undo an incomplete transaction (repair)",
  "  --version        print the product version",
].join("\n");

const OPTIONS = {
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  yes: { type: "boolean" },
  resume: { type: "string" },
  rollback: { type: "string" },
  version: { type: "boolean" },
} as const;

type OptionName = keyof typeof OPTIONS;

const OPTION_NAMES: readonly OptionName[] = [
  "dry-run",
  "json",
  "yes",
  "resume",
  "rollback",
  "version",
];

const COMMAND_OPTIONS: Readonly<Record<string, readonly OptionName[]>> = {
  init: ["dry-run", "yes", "json"],
  status: ["json"],
  doctor: ["json"],
  repair: ["resume", "rollback", "json"],
  uninstall: ["dry-run", "yes", "json"],
};

export type CliContextFactory = (io: CliIo) => CliContext;

type OptionValues = Partial<Record<OptionName, boolean | string>>;

interface Invocation {
  readonly command: string;
  readonly values: OptionValues;
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

  if (positionals.length > 1) return null;

  const [positional] = positionals;
  if (positional === undefined) {
    return values.version === true &&
      suppliedOptions(values).every(
        (name) => name === "version" || name === "json",
      )
      ? { command: "--version", values }
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

  return { command: positional, values };
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
    case "status":
      return emit(io, await runStatus(context), json, renderStatus);
    case "doctor":
      return emit(io, await runDoctor(context), json, renderDoctor);
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
