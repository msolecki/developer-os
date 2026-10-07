import { parseArgs } from "node:util";

import {
  EXIT_CODES,
  failure,
  publish,
  success,
} from "@developer-os/core";
import type { CliResult, ExitCode } from "@developer-os/core";
import { CAPTURE_STATUSES } from "@developer-os/brain";
import { parseScheduleFlag } from "@developer-os/platform-macos";
import type { RefactorRequestV1 } from "@developer-os/brain";

import { renderBrain, runBrain } from "./commands/brain.js";
import type { BrainOptions, BrainResultV1, BrainSubcommand } from "./commands/brain.js";
import {
  admitScheduledProductHome,
  parseScheduledInvocation,
  renderAutomation,
  runAutomation,
  runScheduledAutomation,
  scheduledExitCode,
} from "./commands/automation/index.js";
import type { AutomationCommandRequestV1, ScheduledInvocationV1 } from "./commands/automation/index.js";
import { runCapture } from "./commands/capture.js";
import type { CaptureResultV1 } from "./commands/capture.js";
import { renderConfigResult, runConfig } from "./commands/config.js";
import type { ConfigCommandRequestV1 } from "./commands/config.js";
import { describeInstructions, runDoctor } from "./commands/doctor.js";
import type { DoctorReportV1 } from "./commands/doctor.js";
import { renderGit, runGit } from "./commands/git/index.js";
import type { GitCommandRequestV1 } from "./commands/git/index.js";
import { renderImport, runImport } from "./commands/import.js";
import { renderIngest, runIngest } from "./commands/ingest.js";
import { runInit } from "./commands/init.js";
import type { InitResultV1 } from "./commands/init.js";
import { parseAdaptersFlag } from "./instructions/apply.js";
import { renderProjectCheck, runProjectCheck } from "./commands/project-check.js";
import { renderProjectInit, runProjectInit } from "./commands/project-init.js";
import { runRepair } from "./commands/repair.js";
import type { RepairResultV1 } from "./commands/repair.js";
import { runReview } from "./commands/review.js";
import type { ReviewResultV1 } from "./commands/review.js";
import { runStatus } from "./commands/status.js";
import type { StatusReportV1 } from "./commands/status.js";
import { runUninstall } from "./commands/uninstall.js";
import type { UninstallResultV1 } from "./commands/uninstall.js";
import { parseUpdateArgv, renderUpdate, runUpdate } from "./commands/update/index.js";
import type { UpdateInvocationV1 } from "./commands/update/index.js";
import { createBootstrapEvidenceInspectionRequest } from "./bootstrap/context.js";
import { assertOrdinaryCommandAdmitted, BootstrapRecoveryRequiredError, BootstrapRootInvalidError } from "./bootstrap/report.js";
import { exitCodeOf, failureFrom, PRODUCT_VERSION, renderPath } from "./context.js";
import type { CliContext } from "./context.js";
import type { CliIo } from "./io.js";
import { isHookInvocation } from "./hooks/argv.js";
import { runHookMode } from "./hooks/entry.js";
import type { HookEnvironment } from "./hooks/entry.js";

export type { CliIo } from "./io.js";

const USAGE = [
  "Usage: developer-os <command> [options]",
  "",
  "Commands:",
  "  init       install product state and a Brain skeleton",
  "  config     get one configuration key, or set one",
  "  brain      reindex | lint | search <query> | status | retire <note> | refactor --rename|--move|--merge|--split <a> <b>",
  "  search     alias for brain search <query>",
  "  capture    quarantine one observation, redacted before it is written",
  "  review     list quarantined captures, or decide on one",
  "  ingest     turn accepted captures into notes, one agent call each",
  "  import     turn inbox files, a path, or Claude memory into quarantined captures",
  "  project    init | check [<dir>]: write or check project instruction files",
  "  status     report the current installation without changing it",
  "  doctor     run every health check without repairing anything",
  "  repair     resume or roll back one incomplete transaction",
  "  uninstall  remove manifest-owned artifacts",
  "  update     [rollback]: preview a signed release update, or a rollback to the retained release",
  "  git        enable --remote <url> [--branch <name>] | disable | status | sync: opt-in Brain synchronization",
  "  automation enable --schedule <job>=<schedule>... | disable | status: opt-in scheduled jobs",
  "",
  "Options:",
  "  --dry-run        show the plan without changing anything (init, uninstall, import, project init, brain reindex, brain retire, brain refactor)",
  "  --yes            accept ordinary confirmations (init, uninstall)",
  "  --local-release <dir>  install from a package pack:local-release wrote; unsigned (init)",
  "  --adapters <a>   claude,codex, claude, codex or none: the vendors to install instructions for (init)",
  "  --json           emit one machine-readable line",
  "  --limit <n>      most matches to return (brain search), or captures to process (ingest, import)",
  "  --text <text>    the observation to capture; stdin when absent (capture)",
  "  --note <path>    the note a capture proposes to create or replace (capture)",
  "  --id <id>        the capture to decide on (review)",
  "  --decision <d>   accept, reject or edit (review)",
  "  --status <s>     which status to list; quarantined by default (review)",
  "  --claude-memory  import Claude Code auto-memory instead of a path (import)",
  "  --agent <name>   claude or codex; the first installed one by default (ingest)",
  "  --probe          probe each agent CLI; Claude's probe writes ~/.claude.json (doctor)",
  "  --resume <id>    finish an incomplete transaction (repair)",
  "  --rollback <id>  undo an incomplete transaction (repair)",
  "  --rename         rename <note> to <new-name> in its folder (brain refactor)",
  "  --move           move <note> into <topic-folder> (brain refactor)",
  "  --merge          fold <source> into <target> and retire <source> (brain refactor)",
  "  --split          move the section under <heading> of <note> into a new note (brain refactor)",
  "  --version        print the product version; with a value, the stable release to preview (update)",
  "  --apply          apply the previewed update or rollback (update), or the plan (git and automation enable, disable)",
  "  --remote <url>   the bare local repository, or HTTPS or SSH URL, Git pushes to (git enable)",
  "  --branch <name>  the branch to synchronize; the attached branch or main by default (git enable)",
  "  --schedule <job>=<schedule>  hourly@MM, daily@HH:MM or weekly@<day>,HH:MM; one per job (automation enable)",
  "  --garden-agent <claude|codex>  the agent brain-garden pins: claude only, codex is refused (no tool-free mode yet) (automation enable)",
].join("\n");

const OPTIONS = {
  "dry-run": { type: "boolean" },
  "claude-memory": { type: "boolean" },
  agent: { type: "string" },
  decision: { type: "string" },
  status: { type: "string" },
  id: { type: "string" },
  json: { type: "boolean" },
  yes: { type: "boolean" },
  limit: { type: "string" },
  probe: { type: "boolean" },
  resume: { type: "string" },
  rollback: { type: "string" },
  text: { type: "string" },
  note: { type: "string" },
  version: { type: "boolean" },
  "local-release": { type: "string" },
  adapters: { type: "string" },
  rename: { type: "boolean" },
  move: { type: "boolean" },
  merge: { type: "boolean" },
  split: { type: "boolean" },
  apply: { type: "boolean" },
  remote: { type: "string" },
  branch: { type: "string" },
  schedule: { type: "string", multiple: true },
  "garden-agent": { type: "string" },
} as const;

type OptionName = keyof typeof OPTIONS;

/**
 * Every name in `OPTIONS`, **derived rather than restated**.
 *
 * `suppliedOptions` filters this list, and the per-command allow-list is checked
 * against what it returns, so an option present in `OPTIONS` and missing here is
 * invisible to that check: `status --text hi` would parse and run, and strict
 * dispatch would be holed for every command rather than only the new one. It
 * was a hand-maintained copy, and three consecutive tasks — `text`, `agent`,
 * `probe` — each needed a correction telling them to update it. A list whose
 * type makes a *missing* entry perfectly legal is a defect that recurs by
 * design; the fix is to remove the second list, not to pin it a fourth time.
 *
 * **The cast is the safe direction.** `OptionName` *is* `keyof typeof OPTIONS`,
 * so `Object.keys(OPTIONS)` can only fail to be `OptionName[]` if `OPTIONS`
 * gains a key that is not one of its own keys — not a state the type system
 * permits. `Object.keys` preserves insertion order for string keys, so this is
 * the curated list exactly, and adding an option to `OPTIONS` now adds it here.
 */
const OPTION_NAMES = Object.keys(OPTIONS) as readonly OptionName[];

const COMMAND_OPTIONS: Readonly<Record<string, readonly OptionName[]>> = {
  brain: ["dry-run", "json", "limit", "rename", "move", "merge", "split"],
  search: ["json", "limit"],
  capture: ["text", "json", "note"],
  review: ["id", "decision", "status", "json"],
  ingest: ["limit", "json", "agent"],
  init: ["dry-run", "yes", "json", "local-release", "adapters"],
  config: ["json"],
  status: ["json"],
  doctor: ["json", "probe"],
  repair: ["resume", "rollback", "json"],
  uninstall: ["dry-run", "yes", "json"],
  import: ["claude-memory", "limit", "dry-run", "json"],
  project: ["dry-run", "json"],
  git: ["remote", "branch", "apply", "json"],
  automation: ["schedule", "garden-agent", "apply", "json"],
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
  config: { min: 1, max: 3 },
  brain: { min: 1, max: 3 },
  search: { min: 1, max: 1 },
  import: { min: 0, max: 1 },
  project: { min: 1, max: 2 },
  git: { min: 1, max: 1 },
  automation: { min: 1, max: 1 },
};

const BRAIN_SUBCOMMANDS: Readonly<
  Record<string, { readonly options: readonly OptionName[]; readonly positionals: number }>
> = {
  reindex: { options: ["dry-run", "json"], positionals: 0 },
  lint: { options: ["json"], positionals: 0 },
  search: { options: ["json", "limit"], positionals: 1 },
  status: { options: ["json"], positionals: 0 },
  retire: { options: ["dry-run", "json"], positionals: 1 },
  refactor: { options: ["dry-run", "json", "rename", "move", "merge", "split"], positionals: 2 },
};

const REFACTOR_MODES = ["rename", "move", "merge", "split"] as const;

const PROJECT_SUBCOMMANDS: Readonly<Record<string, readonly OptionName[]>> = {
  init: ["dry-run", "json"],
  check: ["json"],
};

const GIT_SUBCOMMANDS: Readonly<Record<string, readonly OptionName[]>> = {
  enable: ["remote", "branch", "apply", "json"],
  disable: ["apply", "json"],
  status: ["json"],
  sync: ["json"],
};

const AUTOMATION_SUBCOMMANDS: Readonly<Record<string, readonly OptionName[]>> = {
  enable: ["schedule", "garden-agent", "apply", "json"],
  disable: ["apply", "json"],
  status: ["json"],
};

/**
 * `scheduledProductHome` is present only for spec §5.3's hidden scheduled invocation: the
 * supplied, already-guarded product home is then the sole authority, and ambient `HOME`,
 * `DEVELOPER_OS_HOME` and `DEVELOPER_OS_BRAIN` are ignored.
 */
export type CliContextFactory = (
  io: CliIo,
  request: {
    readonly localRelease: string | null;
    /** D84 K2: `init` without `--local-release` admits the Homebrew keg from the fixed table. */
    readonly packageChannelInit: boolean;
    readonly scheduledProductHome?: string;
  },
) => CliContext | Promise<CliContext>;

type OptionValues = Partial<Record<OptionName, boolean | string | readonly string[]>>;

interface Invocation {
  readonly command: string;
  readonly values: OptionValues;
  readonly positionals: readonly string[];
  readonly limit: number | null;
  readonly update?: UpdateInvocationV1;
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

/** Exported for the workflow argv-template contract test (NEW-191); `null` is invalid input. */
export function parse(argv: readonly string[]): Invocation | null {
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
    const [name] = rest;
    if (name === undefined || !Object.hasOwn(BRAIN_SUBCOMMANDS, name)) {
      return null;
    }
    const subcommand = BRAIN_SUBCOMMANDS[name];
    if (subcommand === undefined) return null;
    if (rest.length - 1 !== subcommand.positionals) return null;
    if (!suppliedOptions(values).every((o) => subcommand.options.includes(o))) {
      return null;
    }
    if (name === "refactor" && REFACTOR_MODES.filter((mode) => values[mode] === true).length !== 1) {
      return null;
    }
  }

  /**
   * `config get` names at most one key and `config set` names exactly one key and one
   * value, so `config get a b` and `config set k` are refused at parse time rather than
   * inside the command, where the refusal would be indistinguishable from a broken home.
   */
  if (positional === "config") {
    const [operation] = rest;
    const arity =
      (operation === "get" && rest.length <= 2) || (operation === "set" && rest.length === 3);
    if (!arity) return null;
  }

  if (positional === "project") {
    const [name] = rest;
    if (name === undefined || !Object.hasOwn(PROJECT_SUBCOMMANDS, name)) return null;
    const allowedHere = PROJECT_SUBCOMMANDS[name];
    if (allowedHere === undefined || !suppliedOptions(values).every((o) => allowedHere.includes(o))) {
      return null;
    }
  }

  if (positional === "git") {
    const [name] = rest;
    if (name === undefined || !Object.hasOwn(GIT_SUBCOMMANDS, name)) return null;
    const allowedHere = GIT_SUBCOMMANDS[name];
    if (allowedHere === undefined || !suppliedOptions(values).every((o) => allowedHere.includes(o))) return null;
    if (name === "enable" && (typeof values.remote !== "string" || values.remote === "")) return null;
    if (values.branch === "") return null;
  }

  if (positional === "automation") {
    const [name] = rest;
    if (name === undefined || !Object.hasOwn(AUTOMATION_SUBCOMMANDS, name)) return null;
    const allowedHere = AUTOMATION_SUBCOMMANDS[name];
    if (allowedHere === undefined || !suppliedOptions(values).every((o) => allowedHere.includes(o))) return null;
    const schedules = scheduleFlags(values);
    const jobs = new Set<string>();
    for (const flag of schedules) {
      try {
        jobs.add(parseScheduleFlag(flag).job);
      } catch {
        return null;
      }
    }
    if (jobs.size !== schedules.length) return null;
    const gardenAgent = values["garden-agent"];
    if (gardenAgent !== undefined && gardenAgent !== "claude" && gardenAgent !== "codex") return null;
  }

  // `import_path_conflict` is a usage failure, like every other argv error.
  if (positional === "import" && values["claude-memory"] === true && rest.length > 0) return null;

  if (values["local-release"] === "") return null;
  if (typeof values.adapters === "string") {
    try {
      parseAdaptersFlag(values.adapters);
    } catch {
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
/**
 * **Told what was asked for, never sniffed from the rows.** A first version read
 * `result.captures[0]?.status`, which is correct only while every row shares a
 * status — and the *other* answer `BACKLOG.md` §1 NEW-41 left open is to widen
 * the listing so they do not. That version would then have labelled every row
 * with row zero's status, silently, which is the exact defect it was written to
 * fix. A fresh-context review caught it on 2026-08-21, one refactor from live.
 *
 * **It also broke the default it claimed not to touch:** with nothing to infer
 * from, a bare `review` on an empty queue said "no captures are at that status"
 * to a user who named none. The requested status is `null` on that path and the
 * two original strings are restored for it.
 *
 * The name echoed is the **frozen constant**, not the user's string — a lookup
 * rather than a second validation, so nothing user-typed reaches stdout here.
 */
export function renderReview(
  result: ReviewResultV1,
  requested: string | null,
): readonly string[] {
  if (result.reviewed > 0) {
    return result.captures.map(
      (capture) => `Reviewed ${capture.captureId}, now ${capture.status}.`,
    );
  }
  const listed = CAPTURE_STATUSES.find((status) => status === requested) ?? null;
  if (result.captures.length === 0) {
    return listed === null
      ? ["No captures are waiting for review."]
      : [`No captures are at ${listed}.`];
  }
  return [
    listed === null ? "Quarantined captures:" : `Captures at ${listed}:`,
    ...result.captures.map((capture) =>
      capture.note === null
        ? `  ${capture.captureId}`
        : `  ${capture.captureId}  ${capture.note.replaces ? "replaces" : "creates"} ${renderPath(capture.note.path)} (${String(capture.redactionCount)} redactions)`,
    ),
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
    `drift               ${report.driftCount === null ? "unknown" : String(report.driftCount)}`,
    `incomplete          ${report.incompleteTransactions === null ? "unknown" : report.incompleteTransactions.join(", ") || "none"}`,
    `agents              ${report.agents
      .map((agent) => `${agent.name}=${agent.installed ? "present" : "absent"}`)
      .join(" ")}`,
  ];
}

/** `foundation.md` §12.6: a non-passing `instructions` check is followed by one line per artifact (NEW-155). */
function renderDoctor(report: DoctorReportV1): readonly string[] {
  const instructionsPass = report.checks.some((check) => check.id === "instructions" && check.status === "pass");
  return [
    ...report.checks.map((check) => `[${check.status}] ${check.id}: ${renderPath(check.message)}`),
    ...(instructionsPass ? [] : describeInstructions(report).map((line) => `  ${renderPath(line)}`)),
  ];
}

/** A failing doctor carries its whole report as `error.data` (NEW-150); anything else renders nothing. */
function renderDoctorFailure(data: unknown): readonly string[] {
  const report = data as Partial<DoctorReportV1> | null;
  return typeof report === "object" && report !== null && Array.isArray(report.checks) && Array.isArray(report.instructions)
    ? renderDoctor(report as DoctorReportV1)
    : [];
}

function renderRepair(result: RepairResultV1): readonly string[] {
  return [`Transaction ${result.id} ${result.action} (${result.phase}).`];
}

function renderUninstall(result: UninstallResultV1): readonly string[] {
  const lines =
    result.removed.length === 0 && result.retainedBootstrapEvidence.length === 0
      ? ["Nothing owned by Developer OS remains."]
      : result.removed.length === 0 ? [] : [
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
  if (result.retainedBootstrapEvidence.length > 0) {
    lines.push(
      "Retained bootstrap evidence:",
      ...result.retainedBootstrapEvidence.map((summary) =>
        `  ${summary.operation} ${summary.status}: ${String(summary.entryCount)} entries, ${summary.regularFileBytes} regular-file bytes at ${renderPath(summary.vaultPath)}`),
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
  renderFailureData?: (data: unknown) => readonly string[],
): ExitCode {
  if (json) {
    // Not sanitized: `JSON.stringify` escapes `\p{Cc}`, and a machine consumer
    // needs the value as recorded. It does *not* escape `\p{Cf}`, so a bidi
    // override survives into a terminal that cats the JSON — accepted, because
    // mangling machine output to protect a human reading it raw is the worse
    // trade.
    /**
     * **One call, so the body and the status cannot disagree.** This read `result.code`
     * itself, which is a second read of a value `formatJsonResult` had already validated —
     * a `code` getter answering differently each time published one status and exited with
     * another. `publish` decides both.
     */
    const { text, code } = publish(result);
    io.stdout(text);
    return code;
  }

  /**
   * **The hardening above is `--json`'s only.** The human paths return
   * `result.code` raw and read `data`, `warnings` and `error` off the same object with no
   * containment, so every argument for `publish` applies to them verbatim. Nothing in this
   * repository reshapes a `CliResult`, so it is a gap in the defensive story rather than a
   * live defect — recorded because the asymmetry is otherwise invisible, and because a
   * reader who sees `publish` here may reasonably assume the whole function is covered.
   */

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
  /** A failure that carries its report prints it on stdout; stderr keeps the summary for stderr-only scripts. */
  const reportLines = result.error.data === undefined ? [] : (renderFailureData?.(result.error.data) ?? []);
  for (const line of reportLines) io.stdout(line);
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

function scheduleFlags(values: OptionValues): readonly string[] {
  const value = values.schedule;
  return Array.isArray(value) ? (value as readonly string[]) : [];
}

/** `parse` has already admitted the subcommand, its options and every `--schedule` grammar. */
function automationRequestFor(invocation: Invocation): AutomationCommandRequestV1 {
  const [subcommand] = invocation.positionals;
  const apply = invocation.values.apply === true;
  if (subcommand === "enable") {
    const gardenAgent = optionString(invocation.values["garden-agent"]);
    return {
      subcommand,
      schedules: scheduleFlags(invocation.values),
      gardenAgent: gardenAgent === "claude" || gardenAgent === "codex" ? gardenAgent : null,
      apply,
    };
  }
  return subcommand === "disable" ? { subcommand, apply } : { subcommand: "status" };
}

function optionString(value: boolean | string | readonly string[] | undefined): string | null {
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
): BrainOptions {
  const [first, second, third] = invocation.positionals;
  const alias = invocation.command === "search";
  const subcommand = alias ? "search" : ((first ?? "status") as BrainSubcommand);
  const refactor = refactorRequestFor(invocation.values, subcommand, second ?? "", third ?? "");
  return {
    subcommand,
    query: alias ? (first ?? null) : subcommand === "search" ? (second ?? null) : null,
    limit,
    dryRun: invocation.values["dry-run"] === true,
    ...(refactor === null ? {} : { refactor }),
  };
}

/** `parse` has already admitted the subcommand, its options and `--remote` for `enable`. */
function gitRequestFor(invocation: Invocation): GitCommandRequestV1 {
  const [subcommand] = invocation.positionals;
  const apply = invocation.values.apply === true;
  if (subcommand === "enable") {
    return {
      subcommand,
      remote: optionString(invocation.values.remote) ?? "",
      branch: optionString(invocation.values.branch),
      apply,
    };
  }
  if (subcommand === "disable") return { subcommand, apply };
  return subcommand === "sync" ? { subcommand } : { subcommand: "status" };
}

/** `parse` has already required exactly one mode flag for `refactor`. */
function refactorRequestFor(
  values: OptionValues,
  subcommand: BrainSubcommand,
  a: string,
  b: string,
): RefactorRequestV1 | null {
  if (subcommand === "retire") return { mode: "retire", note: a };
  if (subcommand !== "refactor") return null;
  if (values.rename === true) return { mode: "rename", note: a, newName: b };
  if (values.move === true) return { mode: "move", note: a, folder: b };
  if (values.merge === true) return { mode: "merge", source: a, target: b };
  return { mode: "split", note: a, heading: b };
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
    context = await createContext(io, {
      localRelease: optionString(invocation.values["local-release"]),
      packageChannelInit: invocation.command === "init" && invocation.values["local-release"] === undefined,
    });
  } catch (error) {
    return emit(io, contextFailure(error), json, () => []);
  }

  if (invocation.command !== "init") {
    try {
      await assertOrdinaryCommandAdmitted(createBootstrapEvidenceInspectionRequest({
        productHome: context.paths.home,
        stateDirectory: context.paths.stateDir,
        initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
      }));
    } catch (error) {
      /**
       * `BootstrapRootInvalidError` carries `paths` the same shape
       * `BootstrapRecoveryRequiredError` does, but no `recovery` — invalid
       * input names what is wrong rather than prescribing a fixed next
       * command, the way `init`'s own `InitRefusal` for the same condition
       * does not carry one either.
       */
      const paths =
        error instanceof BootstrapRecoveryRequiredError || error instanceof BootstrapRootInvalidError
          ? error.paths
          : [];
      const recovery = error instanceof BootstrapRecoveryRequiredError ? error.recovery : undefined;
      return emit(io, failureFrom(context, error, paths, recovery), json, () => []);
    }
  }

  switch (invocation.command) {
    case "init":
      return emit(
        io,
        await runInit(context, {
          dryRun,
          assumeYes,
          adapters: typeof invocation.values.adapters === "string"
            ? parseAdaptersFlag(invocation.values.adapters)
            : null,
        }),
        json,
        renderInit,
      );
    case "capture": {
      /**
       * Omitted rather than passed as `undefined`: `exactOptionalPropertyTypes`
       * distinguishes the two, and `runCapture` reads *absent* as "read stdin".
       */
      const text = optionString(invocation.values.text);
      const note = optionString(invocation.values.note);
      return emit(
        io,
        await runCapture(context, {
          ...(text === null ? {} : { text }),
          ...(note === null ? {} : { note }),
        }),
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
      const status = optionString(invocation.values.status);
      return emit(
        io,
        await runReview(context, {
          ...(id === null ? {} : { id }),
          ...(decision === null ? {} : { decision }),
          ...(status === null ? {} : { status }),
        }),
        json,
        (data) => renderReview(data, status),
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
        }),
        json,
        renderIngest,
      );
    }
    case "import": {
      const [path] = invocation.positionals;
      return emit(
        io,
        await runImport(context, {
          path: path ?? null,
          claudeMemory: invocation.values["claude-memory"] === true,
          limit: invocation.limit,
          dryRun,
        }),
        json,
        renderImport,
      );
    }
    case "project": {
      const [subcommand, dir] = invocation.positionals;
      return subcommand === "init"
        ? emit(io, await runProjectInit(context, { dir: dir ?? null, dryRun }), json, renderProjectInit)
        : emit(io, await runProjectCheck(context, { dir: dir ?? null }), json, renderProjectCheck);
    }
    case "config": {
      const [operation, key, value] = invocation.positionals;
      const request: ConfigCommandRequestV1 =
        operation === "set" && key !== undefined && value !== undefined
          ? { operation: "set", key, value }
          : { operation: "get", key: key ?? null };
      /**
       * Success prints the canonical JSON of the result in both modes, which is §2.2's
       * `config` contract rather than the standing success envelope; a refusal keeps that
       * envelope, so `--json` is honoured for the arm that carries an error.
       */
      const result = await runConfig(context, request);
      return emit(io, result, !result.ok && json, renderConfigResult);
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
        renderDoctorFailure,
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
    case "git":
      return emit(io, await runGit(context, gitRequestFor(invocation)), json, renderGit);
    case "automation":
      return emit(io, await runAutomation(context, automationRequestFor(invocation)), json, renderAutomation);
    case "update":
      return invocation.update === undefined
        ? emit(io, usageFailure(), json, () => [])
        : emit(io, await runUpdate(context, invocation.update), json, renderUpdate);
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
 * Spec §5.3's scheduled bootstrap: launchd sends both streams to the null sink, so the outcome
 * is the exit status alone, and the runner has released every lock before it returns.
 */
async function runScheduledMode(
  invocation: ScheduledInvocationV1,
  io: CliIo,
  createContext: CliContextFactory,
): Promise<number> {
  if (!(await admitScheduledProductHome(invocation.productHome, process.getuid?.() ?? -1))) {
    return EXIT_CODES.securityRefusal;
  }
  let context: CliContext;
  try {
    context = await createContext(io, { localRelease: null, packageChannelInit: false, scheduledProductHome: invocation.productHome });
  } catch (error) {
    return exitCodeOf(error);
  }
  return scheduledExitCode(await runScheduledAutomation(context, invocation));
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
  hookEnvironment?: HookEnvironment,
): Promise<number> {
  if (isHookInvocation(argv)) return runHookMode(argv, io, createContext, hookEnvironment);
  const scheduled = parseScheduledInvocation(argv);
  if (scheduled !== null) return runScheduledMode(scheduled, io, createContext);
  if (argv[0] === "update") {
    const update = parseUpdateArgv(argv);
    if (update === null) return emit(io, usageFailure(), argv.includes("--json"), () => []);
    return dispatch({ command: "update", values: { json: update.json }, positionals: [], limit: null, update }, io, createContext);
  }
  const invocation = parse(argv);
  if (invocation === null) {
    return emit(io, usageFailure(), argv.includes("--json"), () => []);
  }

  return dispatch(invocation, io, createContext);
}
