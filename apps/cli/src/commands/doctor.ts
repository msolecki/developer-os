import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import {
  containsPath,
  decodeCanonicalJson,
  detectDrift,
  EXIT_CODES,
  failure,
  hashBytes,
  hookCommandTail,
  inspectDrift,
  isUnsignedLocalTrust,
  ManifestStateError,
  parseLifecycleInstallNonce,
  success,
  validateActiveReleaseRecord,
  validateInstructionCatalog,
  validateReleaseTrustState,
} from "@developer-os/core";
import type {
  BootstrapEvidenceSummaryV1,
  CanonicalAbsolutePathV1,
  CliResult,
  DeveloperOsConfigV1,
  DriftFinding,
  ExitCode,
  InstallationManifest,
  InstallationManifestV1,
  InstallationManifestV2,
  InstructionCatalogRowV1,
  InstructionCategoryV1,
  InstructionIdV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  ManagedArtifactV2,
  ManifestAdmissionContextV1,
  RuntimePaths,
  TransactionJournalV1,
} from "@developer-os/core";
import { CLAUDE_HOOK_ROWS, CLAUDE_HOOKS_PATH, PLUGIN_INSTALL_SEGMENTS } from "@developer-os/adapter-claude";
import { MARKETPLACE_NAME, PLUGIN_NAME, PLUGIN_TREE_SEGMENTS } from "@developer-os/adapter-codex";
import { MacOsPlatformDiscoveryError } from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";
import { compareCodePoints } from "@developer-os/workflow-schema";

import { reportClaudeCapabilities } from "./claude-capabilities.js";
import { reportCodexCapabilities } from "./codex-capabilities.js";
import { readUntrustedText, UntrustedFileRefusal } from "./untrusted-file.js";
import { checkVendorConfig } from "./vendor-config.js";
import {
  exitCodeOf,
  REDACTION_KEY_BYTES,
  redactionKeyPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext } from "../context.js";
import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import { isMissingEntry, readConfigFile } from "../config-file.js";
import { readHookFiringObservations } from "../hooks/firing-records.js";
import {
  codexPluginTreeHash,
  inspectCodexRegistration,
  validateCodexRegistrationRecord,
} from "../instructions/codex-registration.js";
import type { CodexRegistrationRecordV1 } from "../instructions/codex-registration.js";
import { loadInstructionOverrides } from "../instructions/sources.js";
import { claudeInstructionPaths, codexInstructionPaths, resolveVendorHomes } from "../instructions/vendor-homes.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";
import { entrypointPath } from "../update/local-release.js";
import {
  createManagedArtifactEphemeralRegistry,
  createManagedArtifactSchemaRegistry,
} from "../lifecycle/schema-registry.js";

export { ConfigurationError, readConfigFile } from "../config-file.js";

const AGENT_NAMES: readonly AgentName[] = ["claude", "codex"];
const JOURNAL_ID = /^[A-Za-z0-9._-]+$/;

export interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
}

export interface InstructionStatusV1 {
  readonly owner: "claude" | "codex";
  readonly category: InstructionCategoryV1;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  readonly state: "installed" | "drifted" | "missing" | "emulated" | "unsupported-vendor";
  readonly paths: readonly string[];
}

export interface DoctorReportV1 {
  readonly schemaVersion: 1;
  readonly checks: readonly DoctorCheck[];
  readonly retainedBootstrapEvidence: readonly BootstrapEvidenceSummaryV1[];
  /** Sorted by `(owner, category, id)`; empty unless a V2 home selects a vendor. */
  readonly instructions: readonly InstructionStatusV1[];
}

export interface IncompleteTransaction {
  readonly id: string;
  readonly phase: string;
}

export interface RetainedBackup {
  readonly id: string;
  readonly phase: "finalized" | "rolled_back";
  readonly payload: string;
}

export interface DoctorOptions {
  /**
   * Whether to ask each agent CLI what it supports, rather than reporting every
   * probe-settled capability as `unknown`.
   *
   * **Opt-in, and that is a finding rather than a preference.** Claude's probe
   * is `claude plugin validate`, which writes `~/.claude.json` and a timestamped
   * backup under `~/.claude/backups/` (Claude architecture former §14.1, observed against a real
   * installation on 2026-08-11). `doctor` reports and never repairs, and
   * Foundation's end-to-end suite asserts it touches nothing outside the
   * product's own paths — probing by default broke that assertion, which is how
   * the side effect was found in the first place.
   */
  readonly probe: boolean;
}

/**
 * The default, named once. `runDoctor` and `runDoctorReport` both take these
 * options *optionally*, because `runDoctorReport` is `init`'s injected `verify`
 * dependency and is typed there as `(context) => Promise<DoctorReportV1>`: a
 * required parameter would put `init` in this flag's blast radius and let it
 * start writing to the user's Claude home as a side effect of verifying its own
 * install.
 */
const NO_PROBE: DoctorOptions = { probe: false };

/**
 * Said before the probe runs, on `stderr` — never `stdout`, which carries
 * `--json`, and never the result's warnings, which `main.ts` renders after the
 * command has already returned. A user who reads a mutation notice after the
 * mutation has been told, not warned. `context.ts`'s `EPHEMERAL_KEY_WARNING` is
 * the precedent for the channel.
 *
 * **It names Claude rather than the agents in general.** Codex's probe is
 * `codex plugin list --json`, a read-only structured query that writes nothing
 * (`codex-capabilities.ts`), so a notice covering both would be false about half
 * of it.
 */
const PROBE_MUTATION_WARNING =
  "warning: --probe runs Claude's capability probe, which writes ~/.claude.json and a timestamped backup under ~/.claude/backups/; no check changes anything else";

/**
 * A check plus the exit code it claims when it fails. The code is kept off
 * `DoctorCheck` because that shape is fixed by the Foundation plan and is what
 * `--json` publishes; the code only decides this process's exit status.
 */
interface Finding {
  readonly check: DoctorCheck;
  readonly code: ExitCode;
}

const EXIT_PRECEDENCE: readonly ExitCode[] = [
  EXIT_CODES.recoveryRequired,
  EXIT_CODES.securityRefusal,
  EXIT_CODES.capabilityUnavailable,
  EXIT_CODES.decisionRequired,
  EXIT_CODES.invalidInput,
  EXIT_CODES.operationalFailure,
];

/**
 * The one command that creates a redaction key. Written once so the four
 * remedies below cannot drift apart, or away from the command that has to
 * honour them.
 */
const REDACTION_KEY_RECOVERY = "developer-os init";

function pass(id: string, message: string, paths: readonly string[]): Finding {
  return {
    check: { id, status: "pass", message, paths },
    code: EXIT_CODES.success,
  };
}

/**
 * A check that could not answer, about something Foundation does not depend on.
 *
 * It is the `status`, not the code, that keeps it harmless: `doctorExitCode` and
 * `hasFailingCheck` both filter on `status === "fail"` before looking at
 * anything else, so a warning can neither decide the exit status nor supply a
 * recovery string. `code` is carried only to keep `Finding` one shape, and
 * `success` is the honest value for a finding that is not a failure — changing
 * it would not change any behaviour.
 */
function warn(id: string, message: string, paths: readonly string[]): Finding {
  return {
    check: { id, status: "warn", message, paths },
    code: EXIT_CODES.success,
  };
}

function fail(
  id: string,
  message: string,
  paths: readonly string[],
  code: ExitCode,
  recovery?: string,
): Finding {
  return {
    check: {
      id,
      status: "fail",
      message,
      paths,
      ...(recovery === undefined ? {} : { recovery }),
    },
    code,
  };
}

export async function isDirectory(
  context: CliContext,
  path: string,
): Promise<boolean | null> {
  try {
    const stats = await context.fs.lstat(path);
    return stats.isDirectory();
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
}

/**
 * Enumerates journals the core store deliberately does not enumerate for itself:
 * `TransactionStore` addresses one transaction at a time. Reading is not
 * mutation, so `status` and `doctor` stay inspection-only.
 */
async function listTransactionIds(
  context: CliContext,
): Promise<readonly string[]> {
  const journalDir = join(context.paths.stateDir, "transactions");

  let entries: readonly string[];
  try {
    entries = await context.fs.readdir(journalDir);
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
    .map((entry) => entry.slice(0, -".json".length))
    .filter((id) => JOURNAL_ID.test(id))
    .sort();
}

export async function listIncompleteTransactions(
  context: CliContext,
): Promise<readonly IncompleteTransaction[]> {
  return (await surveyTransactions(context, { retained: false })).incomplete;
}

interface TransactionSurvey {
  readonly incomplete: readonly IncompleteTransaction[];
  readonly retained: readonly RetainedBackup[];
}

/**
 * **One pass, because each journal read costs a subprocess.** `TransactionStore.read` runs
 * inside `withTransactionLock`, and the macOS lock provider spawns `/usr/bin/lockf` — so
 * `checkTransactions` calling the two public helpers in sequence doubled the spawns on the
 * check `init` runs as its verification step. `<state>/transactions/` accumulates one
 * journal per transaction permanently (the open founder question `ORDER.md` carries), so
 * the cost grows without bound while the directory does.
 *
 * **`want.retained` is why this is a parameter and not always-on.** `listIncompleteTransactions`
 * is called by `status` and by `init`'s pre-flight, and neither has ever touched `backupsDir`.
 * Reading it unconditionally widened their failure surface: `retainedPayload` rethrows any
 * `readdir` error that is not "missing", so a backup directory without the read bit would make
 * `status` throw where it used to report incomplete transactions. Only `doctor` asks about
 * retention, so only `doctor` pays for it — including the failure modes.
 */
async function surveyTransactions(
  context: CliContext,
  want: { readonly retained: boolean },
): Promise<TransactionSurvey> {
  const incomplete: IncompleteTransaction[] = [];
  const retained: RetainedBackup[] = [];

  for (const id of await listTransactionIds(context)) {
    const journal = await readSurveyedJournal(context, id);
    if (journal === null) continue;
    if (journal.phase !== "finalized" && journal.phase !== "rolled_back") {
      incomplete.push({ id, phase: journal.phase });
      continue;
    }
    if (!want.retained) continue;
    const leftover = await retainedPayload(context, id, journal);
    if (leftover !== null) retained.push(leftover);
  }

  return { incomplete, retained };
}

/**
 * Spec 1 §2.4's terminal Foundation compaction unlinks a journal under the global lock,
 * while this read-only survey is still holding a name from a listing taken before it.
 * `TransactionStore.read` reports a missing file and a malformed one through the same
 * `TransactionStateError`, so the absence is re-proved here instead of being reported as a
 * defect that no recovery command can resolve.
 */
async function readSurveyedJournal(
  context: CliContext,
  id: string,
): Promise<TransactionJournalV1 | null> {
  try {
    return await context.transactions.read(id);
  } catch (error) {
    try {
      await context.fs.stat(join(context.paths.stateDir, "transactions", `${id}.json`));
    } catch (absence) {
      if (isMissingEntry(absence)) return null;
    }
    throw error;
  }
}

/**
 * **Backup payloads that outlived the transaction that wrote them.**
 *
 * `TransactionExecutor.backUp` writes each target's pre-edit bytes raw, so a `review
 * --decision edit` that removes a pasted secret leaves a copy of it here. The executor
 * prunes them on the transition into `finalized` and into `rolled_back`, but two things can
 * leave one standing: a crash between the transition and the prune, and an `unlink` that
 * fails for a reason other than "already gone".
 *
 * **This check is what makes the second case visible, and it is the reason the executor is
 * allowed not to raise on it.** Raising out of `execute` would be worse than the leftover:
 * every one of its seven call sites reads a throw as "the transaction did not happen", so a
 * successful apply would be reported as a failure with the command's own bookkeeping
 * skipped (see `TransactionBackupRetentionError`). Reporting it here costs nothing and
 * catches the crash window too, which nothing detected before.
 *
 * **Terminal journals only.** A transaction still in flight is *supposed* to have its
 * payloads on disk — that is what a rollback restores from — and `listIncompleteTransactions`
 * already reports the transaction itself.
 */
export async function listRetainedBackups(
  context: CliContext,
): Promise<readonly RetainedBackup[]> {
  return (await surveyTransactions(context, { retained: true })).retained;
}

async function retainedPayload(
  context: CliContext,
  id: string,
  journal: TransactionJournalV1,
): Promise<RetainedBackup | null> {
  if (journal.phase !== "finalized" && journal.phase !== "rolled_back") return null;

  const directory = join(context.paths.backupsDir, "transactions", id);
  let entries: readonly string[];
  try {
    entries = await context.fs.readdir(directory);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  /**
   * **Exactly the names the prune removes, derived from the journal — not every `.bin`
   * in the directory.** The prune has no `readdir` and works from
   * `journal.mutations.entries()`, so a listing-driven check can report a file no
   * `repair` can clear: a stray `9999.bin` beside a fifteen-mutation journal made
   * `doctor` fail, `repair --resume` succeed, and `doctor` fail again forever (found by
   * fresh-context review, 2026-08-17). A report whose named remedy does not clear it is
   * worse than no report.
   *
   * `.bin.tmp` is included because `writeDurableFile` writes the payload there before
   * renaming, so it holds the same bytes; `<index>.json` and its `.sha256` are excluded
   * because the prune deliberately keeps them — they carry `{existed, mode, atimeMs,
   * mtimeMs}` and none of the bytes. A check that counted every file would fire on every
   * finalized transaction the product has ever run.
   */
  const swept = journal.mutations.flatMap((_mutation, index) => [
    `${String(index)}.bin`,
    `${String(index)}.bin.tmp`,
  ]);
  /**
   * **In the prune's own order, which is mutation order, not lexicographic.** `.sort()`
   * on the listing put `10.bin` ahead of `2.bin`, so a ten-mutation journal named a
   * payload the user would not have expected first. Cosmetic — the printed `repair`
   * clears all of them — but the message says "a backup payload", so it should be the
   * first one.
   */
  const payload = swept.find((name) => entries.includes(name));
  return payload === undefined
    ? null
    : { id, phase: journal.phase, payload: join(directory, payload) };
}

export async function detectManagedDrift(
  context: CliContext,
  manifest: InstallationManifestV1,
): Promise<readonly DriftFinding[]> {
  return detectDrift({
    manifest,
    fs: context.fs,
    guards: context.guards.manifest,
  });
}

/**
 * One agent's discovery, or the error that stopped it. A union rather than a
 * nullable field with a loose `error`, so no branch can read a discovery that
 * never happened.
 */
export type AgentOutcome =
  | { readonly name: AgentName; readonly discovery: AgentDiscovery }
  | {
      readonly name: AgentName;
      readonly discovery: null;
      readonly error: unknown;
    };

/**
 * Every agent asked, independently of every other.
 *
 * The loop this replaces pushed straight into an array and let the first raise
 * escape, so a refusing `claude` meant `codex` was **never asked** and was then
 * reported absent — one agent's failure printed as the other's absence. Asking
 * separately is the whole fix; the callers below decide what a raise means.
 */
export async function discoverEachAgent(
  context: CliContext,
): Promise<readonly AgentOutcome[]> {
  const outcomes: AgentOutcome[] = [];
  for (const name of AGENT_NAMES) {
    try {
      const discovery = await context.platform.discoverExecutable(name);
      /**
       * **`doctor` is the third executor, and it was the one missed** (BACKLOG NEW-15).
       * `--probe` hands this path to the capability probes, which spawn it — and one of
       * them runs `claude plugin validate`, which *mutates state* under the user's home.
       * A binary the platform will not vouch for must not reach that, and reporting it as
       * `present` while `ingest` exits 5 on the same file is the worst of both.
       *
       * **Recorded as a discovery failure rather than rethrown**, which is what this
       * function already does with every other refusal: both agents are still asked, the
       * outcome carries the reason, and `checkAgents` grades it. The binary exists; what
       * this product cannot do is vouch for it, and the error says so.
       */
      if (discovery.installed && discovery.executablePath !== null) {
        await context.platform.assertTrustedExecutable(discovery.executablePath);
      }
      outcomes.push({ name, discovery });
    } catch (error) {
      outcomes.push({ name, discovery: null, error });
    }
  }
  return outcomes;
}

/**
 * The discoveries, or the first error, rethrown.
 *
 * `status` takes this shape and reports agents as data, with a warning when
 * discovery fails; `doctor` needs the per-agent outcomes and reads
 * `discoverEachAgent` directly. Both agents are still asked before anything is
 * rethrown, which is the difference that matters — the raise is now a report
 * about one agent rather than a reason the next one goes unexamined.
 */
export async function discoverAgents(
  context: CliContext,
): Promise<readonly AgentDiscovery[]> {
  const discovered: AgentDiscovery[] = [];
  for (const outcome of await discoverEachAgent(context)) {
    if (outcome.discovery === null) throw outcome.error;
    discovered.push(outcome.discovery);
  }
  return discovered;
}

/** Narrows to the raised half of the union, so `error` is reachable. */
function raised(
  outcome: AgentOutcome,
): outcome is Extract<AgentOutcome, { readonly discovery: null }> {
  return outcome.discovery === null;
}

/**
 * **A discovery that raised reads `present`, never `absent`.**
 *
 * `MacOsPlatformAdapter` reports a binary it could not find as data — an
 * `AgentDiscovery` with `installed: false` — and raises only once it has
 * something it cannot vouch for: a `which` result it refuses, a call that did
 * not complete. None of those is "not installed", and printing them as absence
 * is the conflation `unreadable` exists to prevent, one layer down. The
 * capability check says `unreadable` about the same agent in the same report;
 * this line says which agent the pair is about, and `checkAgents` still grades
 * the raise itself and names it in the same message.
 */
function describeAgents(outcomes: readonly AgentOutcome[]): string {
  return outcomes
    .map((outcome) => {
      const installed =
        outcome.discovery === null || outcome.discovery.installed;
      return `${outcome.name}=${installed ? "present" : "absent"}`;
    })
    .join(" ");
}

/**
 * What one agent's discovery leaves for its capability report to say.
 *
 * Three outcomes, because there are three: a path to ask, nothing to ask, and
 * a discovery that raised. **The third one used to be folded into the second**
 * — the bare `catch` below passed `executablePath: null`, so any discovery
 * error, a refusal included, printed as `claude=absent`: "we could not ask"
 * rendered as "not installed", the same conflation `unreadable` exists to
 * prevent one layer up, and the exact residual `codex-adapter.md` §11.6 left
 * for DOS-P6 to close. `checkAgents` grades the raise itself, so nothing is
 * swallowed by threading it here — this check still reports and never fails.
 */
function capabilityInput(outcome: AgentOutcome | undefined): {
  readonly executablePath: string | null;
  readonly discoveryFailed: boolean;
} {
  if (outcome === undefined) {
    return { executablePath: null, discoveryFailed: false };
  }
  if (outcome.discovery === null) {
    return { executablePath: null, discoveryFailed: true };
  }
  return {
    executablePath: outcome.discovery.installed
      ? outcome.discovery.executablePath
      : null,
    discoveryFailed: false,
  };
}

/**
 * Product spec §11 asks `doctor` to print a capability matrix for the detected
 * environment. This is that check, and it is `pass` in every branch.
 *
 * It reports and never refuses — `workflow-schema.md` §7 records the
 * contradiction: the `doctor` *workflow* refuses when no installation is found,
 * while `shared` tells a user in exactly that state to run `developer-os
 * doctor`. Different objects, same name. A missing agent is information, not a
 * failure, which is also why `agents` is excluded from `INIT_OWNED_CHECKS`.
 */
async function checkClaudeCapabilities(
  context: CliContext,
  probe: boolean,
): Promise<Finding> {
  const outcome = (await discoverEachAgent(context)).find(
    (candidate) => candidate.name === "claude",
  );
  const report = await reportClaudeCapabilities({
    ...capabilityInput(outcome),
    runner: context.runner,
    probe,
    /**
     * The **user's** home, not the product's. This was
     * `join(paths.home, "plugins", "claude")` — `~/.developer-os/plugins/claude`,
     * a directory the installer never creates. Dead while `probe` defaults to
     * false, and the moment anyone set it, validate would have failed on a path
     * that never existed and reported `skills=wrapper-required` on a healthy
     * install. `PLUGIN_INSTALL_SEGMENTS` is where the real location is decided.
     * Found by fresh-context review, 2026-08-11.
     */
    pluginDirectory: join(context.userHome, ...PLUGIN_INSTALL_SEGMENTS),
  });
  return pass(
    "claude-capabilities",
    `${report.summary} capture-via=${report.captureVia}`,
    [],
  );
}

/**
 * Codex's half of the same check. Reports and never refuses, for the reason
 * `checkClaudeCapabilities` above records.
 *
 * **The plugin root is under the *product* home, not the user's home** — the
 * mirror image of the bug fixed above, where the product home was used for a
 * path under the user's home. Codex architecture former §4 puts the tree at
 * `<product-home>/codex/plugins/developer-os`, and `install.ts`'s
 * `marketplaceRoot` resolves the same `CODEX_ROOT_SEGMENT` against the
 * product home for the same reason — `PLUGIN_TREE_SEGMENTS`
 * (`packages/adapter-codex/src/plugin.ts`) already carries the full path from
 * that root to the plugin tree itself, so joining it onto anything but the
 * product home (`paths.home`, as every other check here reads it) would be
 * this task's namesake mistake in reverse.
 * `context.paths.home` is used rather than a `paths` argument because
 * `resolveRuntimePaths` computes `home` from the environment alone —
 * configuration can only move the vault path — so `context.paths.home` and a
 * freshly resolved value are always equal.
 */
export function codexPluginRoot(context: CliContext): string {
  return join(context.paths.home, ...PLUGIN_TREE_SEGMENTS);
}

async function checkCodexCapabilities(
  context: CliContext,
  probe: boolean,
): Promise<Finding> {
  const outcome = (await discoverEachAgent(context)).find(
    (candidate) => candidate.name === "codex",
  );
  const report = await reportCodexCapabilities({
    ...capabilityInput(outcome),
    runner: context.runner,
    probe,
    pluginRoot: codexPluginRoot(context),
  });
  /**
   * No `recovery=` any more. It named the one command that grants Codex's hook
   * trust gate, and knowledge-pipeline architecture note §2 ships no hooks, so the gate
   * opens onto nothing — advice to run `/hooks` for a hook that does not exist
   * is the same defect as a capability word naming a wrapper nobody can run.
   * Removed from the report itself rather than hidden here, so no reader of
   * either layer can act on it.
   */
  return pass(
    "codex-capabilities",
    `${report.summary} capture-via=${report.captureVia}`,
    [],
  );
}

export const CODEX_UNTRUSTED_HOOK_MESSAGE = "installed; not observed firing — approve it in Codex if you have not";
export const MAX_CLAUDE_SETTINGS_BYTES = 1_048_576;
const CODEX_EXTERNAL_HOOKS = "codex=unknown (config.toml is not read (codex-adapter.md §2.3))";
const HOUR_MS = 3_600_000;
/** Event names are keys of a user file; anything else is counted under `other` rather than echoed. */
const EVENT_NAME = /^[A-Za-z]{1,64}$/u;

interface InstalledClaudeHooks {
  readonly state: "not-installed" | "unknown" | "installed";
  readonly path: string | null;
  readonly missing: readonly string[];
  readonly conflicting: boolean;
  /** The prefix every product entry shares; `null` unless exactly one was found. */
  readonly executable: string | null;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function commandsOf(group: unknown): readonly string[] {
  return list(field(group, "hooks"))
    .map((hook) => field(hook, "command"))
    .filter((command): command is string => typeof command === "string");
}

async function readInstalledClaudeHooks(context: CliContext): Promise<InstalledClaudeHooks> {
  let path: string | null = null;
  try {
    path = join(await context.guards.canonicalize(context.userHome), ...PLUGIN_INSTALL_SEGMENTS, CLAUDE_HOOKS_PATH);
    let text: string;
    try {
      text = await readUntrustedText(context, path, MAX_CLAUDE_SETTINGS_BYTES);
    } catch (error) {
      if (error instanceof UntrustedFileRefusal && error.reason === "not_found") {
        return { state: "not-installed", path, missing: [], conflicting: false, executable: null };
      }
      throw error;
    }
    const hooks = field(JSON.parse(text) as unknown, "hooks");
    const missing: string[] = [];
    const prefixes = new Set<string>();
    for (const row of CLAUDE_HOOK_ROWS) {
      const suffix = ` ${hookCommandTail(row.verb, "claude").join(" ")}`;
      const commands = list(field(hooks, row.event))
        .filter((group) => (field(group, "matcher") ?? null) === row.matcher)
        .flatMap(commandsOf)
        .filter((command) => command.length > suffix.length && command.endsWith(suffix));
      if (commands.length === 0) missing.push(row.verb);
      for (const command of commands) prefixes.add(command.slice(0, -suffix.length));
    }
    const [executable] = prefixes;
    return {
      state: "installed",
      path,
      missing,
      conflicting: prefixes.size > 1,
      executable: prefixes.size === 1 && executable !== undefined ? executable : null,
    };
  } catch {
    return { state: "unknown", path, missing: [], conflicting: false, executable: null };
  }
}

async function checkProductHooks(
  context: CliContext,
  stateDirectory: string,
  installed: InstalledClaudeHooks,
): Promise<Finding> {
  const paths = installed.path === null ? [] : [installed.path];
  const codex = "codex=not-rendered";
  if (installed.state !== "installed") {
    return (installed.state === "unknown" ? warn : pass)("hooks", `claude=${installed.state}; ${codex}`, paths);
  }
  const lastSeen = new Map<string, number>();
  for (const record of (await readHookFiringObservations(stateDirectory, "claude")).records) {
    lastSeen.set(record.event, Date.parse(record.lastSeen));
  }
  const now = context.now().getTime();
  const ages = CLAUDE_HOOK_ROWS.filter((row) => !installed.missing.includes(row.verb)).map((row) => {
    const seen = lastSeen.get(row.event);
    return `${row.verb}=${seen === undefined ? "never" : `${String(Math.max(0, Math.floor((now - seen) / HOUR_MS)))}h`}`;
  });
  const parts = [
    "claude=installed",
    ...ages,
    ...(installed.missing.length === 0 ? [] : [`missing=${installed.missing.join(",")}`]),
    ...(installed.conflicting ? ["executable=inconsistent"] : []),
  ];
  const healthy = installed.missing.length === 0 && !installed.conflicting;
  return (healthy ? pass : warn)("hooks", `${parts.join(" ")}; ${codex}`, paths);
}

/** Spec §8.2 (Q2-A): structural only; no command string ever reaches the message. */
async function checkExternalHooks(context: CliContext, installed: InstalledClaudeHooks): Promise<Finding> {
  const id = "external-hooks";
  let path: string | null = null;
  try {
    path = join(await context.guards.canonicalize(context.userHome), ".claude", "settings.json");
    let text: string;
    try {
      text = await readUntrustedText(context, path, MAX_CLAUDE_SETTINGS_BYTES);
    } catch (error) {
      if (error instanceof UntrustedFileRefusal && error.reason === "not_found") {
        return pass(id, `claude=0; ${CODEX_EXTERNAL_HOOKS}`, [path]);
      }
      throw error;
    }
    const hooks = field(JSON.parse(text) as unknown, "hooks");
    const counts = new Map<string, number>();
    if (typeof hooks === "object" && hooks !== null && !Array.isArray(hooks)) {
      for (const event of Object.keys(hooks)) {
        const external = list(field(hooks, event))
          .flatMap(commandsOf)
          .filter((command) => installed.executable === null || !command.startsWith(`${installed.executable} `)).length;
        if (external === 0) continue;
        const name = EVENT_NAME.test(event) ? event : "other";
        counts.set(name, (counts.get(name) ?? 0) + external);
      }
    }
    if (counts.size === 0) return pass(id, `claude=0; ${CODEX_EXTERNAL_HOOKS}`, [path]);
    const report = [...counts]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([event, count]) => `${event} → ${String(count)}`)
      .join(", ");
    return warn(id, `claude: ${report}; ${CODEX_EXTERNAL_HOOKS}`, [path]);
  } catch {
    return warn(id, `claude=unknown; ${CODEX_EXTERNAL_HOOKS}`, path === null ? [] : [path]);
  }
}

async function hookFindings(context: CliContext, stateDirectory: string): Promise<readonly Finding[]> {
  const installed = await readInstalledClaudeHooks(context);
  return [
    await checkProductHooks(context, stateDirectory, installed),
    await checkExternalHooks(context, installed),
  ];
}

/** `hooks` and `external-hooks`, never `fail` and never init-owned (spec §8.2). */
export async function checkHooks(context: CliContext, stateDirectory: string): Promise<readonly DoctorCheck[]> {
  return (await hookFindings(context, stateDirectory)).map((finding) => finding.check);
}

async function checkPlatform(context: CliContext): Promise<Finding> {
  try {
    const facts = await context.platform.inspect();
    return pass(
      "platform",
      `macOS ${facts.release} on ${facts.architecture}`,
      [],
    );
  } catch (error) {
    return fail(
      "platform",
      context.guards.redactDiagnostic(
        error instanceof Error ? error.message : "platform inspection failed",
      ),
      [],
      EXIT_CODES.capabilityUnavailable,
    );
  }
}

/**
 * D53: how to run the product. Informational only; drift of the file itself is the `drift`
 * check's, and the product never writes shell startup files, so the alias is a suggestion.
 */
async function checkEntrypoint(context: CliContext, paths: RuntimePaths): Promise<Finding> {
  const path = entrypointPath(paths.home);
  let present = false;
  try {
    present = (await context.fs.lstat(path)).isFile();
  } catch {
    present = false;
  }
  return present
    ? pass(
        "entrypoint",
        `run Developer OS with: node ${path}; to shorten it, add alias developer-os='node ${path}' to your shell startup file yourself (Developer OS never edits it)`,
        [path],
      )
    : pass("entrypoint", "no entrypoint is installed; init --local-release <dir> writes one from a launchable local build", [path]);
}

async function checkProductHome(
  context: CliContext,
  paths: RuntimePaths,
): Promise<Finding> {
  const directory = await isDirectory(context, paths.home);
  if (directory === null) {
    return fail(
      "product-home",
      "the product state directory does not exist",
      [paths.home],
      EXIT_CODES.operationalFailure,
      "developer-os init",
    );
  }
  return directory
    ? pass("product-home", "product state directory is present", [paths.home])
    : fail(
        "product-home",
        "the product state path is not a directory",
        [paths.home],
        EXIT_CODES.invalidInput,
      );
}

async function checkConfiguration(
  context: CliContext,
  paths: RuntimePaths,
): Promise<Finding> {
  try {
    const config = await readConfigFile(context, paths.configFile);
    if (config === null) {
      return fail(
        "configuration",
        "no configuration file exists",
        [paths.configFile],
        EXIT_CODES.operationalFailure,
        "developer-os init",
      );
    }
    return pass("configuration", "configuration is valid", [paths.configFile]);
  } catch (error) {
    return fail(
      "configuration",
      context.guards.redactDiagnostic(
        error instanceof Error ? error.message : "configuration is unreadable",
      ),
      [paths.configFile],
      exitCodeOf(error),
    );
  }
}

/**
 * The authority `init` built the manifest with: the product home, the Brain and spec §2.2's vendor
 * paths. Built here rather than imported from `commands/uninstall.ts`, which imports this module.
 */
function manifestAdmission(paths: RuntimePaths, homes: VendorHomesV1): ManifestAdmissionContextV1 {
  const productHome = paths.home as CanonicalAbsolutePathV1;
  return {
    evidence: createCanonicalPathEvidence(),
    sourceRoot: productHome,
    backupRoot: paths.backupsDir as CanonicalAbsolutePathV1,
    admitOwnerPath: createOwnerPathAdmission({
      kind: "confined",
      roots: [productHome, paths.brain as CanonicalAbsolutePathV1],
      vendors: homes,
    }),
  };
}

async function checkManifest(
  context: CliContext,
  paths: RuntimePaths,
  homes: VendorHomesV1,
): Promise<{ readonly finding: Finding; readonly manifest: InstallationManifest | null }> {
  try {
    const manifest = await context.manifests.readOptional(manifestAdmission(paths, homes));
    if (manifest === null) {
      return {
        finding: fail(
          "manifest",
          "no installation manifest exists",
          [paths.manifestFile],
          EXIT_CODES.operationalFailure,
          "developer-os init",
        ),
        manifest: null,
      };
    }
    return {
      finding: pass(
        "manifest",
        `${String(manifest.artifacts.length)} managed artifacts`,
        [paths.manifestFile],
      ),
      manifest,
    };
  } catch (error) {
    return {
      finding: fail(
        "manifest",
        context.guards.redactDiagnostic(
          error instanceof Error ? error.message : "manifest is unreadable",
        ),
        [paths.manifestFile],
        error instanceof ManifestStateError
          ? EXIT_CODES.recoveryRequired
          : EXIT_CODES.operationalFailure,
      ),
      manifest: null,
    };
  }
}

async function checkTransactions(context: CliContext): Promise<Finding> {
  const { incomplete, retained } = await surveyTransactions(context, {
    retained: true,
  });
  const first = incomplete[0];
  if (first !== undefined) {
    return fail(
      "transactions",
      `transaction ${first.id} stopped at phase ${first.phase}`,
      [join(context.paths.stateDir, "transactions", `${first.id}.json`)],
      EXIT_CODES.recoveryRequired,
      `developer-os repair --resume ${first.id} | developer-os repair --rollback ${first.id}`,
    );
  }

  /**
   * **Reported under `transactions` rather than as a tenth check**, because it is the same
   * subject — a transaction not in a clean state — and the same remedy. A new check id
   * widens `DoctorReportV1`'s `checks` array, which `init` consumes as its verification
   * step and Foundation's e2e suite pins.
   *
   * Second, not first: an in-flight transaction is the more urgent finding and *should*
   * have its payloads on disk, so reporting a retained payload ahead of it would name a
   * symptom of the incomplete transaction as though it were a separate fault.
   */
  const leftover = retained[0];
  if (leftover !== undefined) {
    const action = leftover.phase === "finalized" ? "--resume" : "--rollback";
    return fail(
      "transactions",
      `transaction ${leftover.id} reached ${leftover.phase} with a backup payload still on disk`,
      [leftover.payload],
      EXIT_CODES.recoveryRequired,
      `developer-os repair ${action} ${leftover.id}`,
    );
  }

  return pass("transactions", "no incomplete transactions", []);
}

function reportDrift(
  findings: readonly DriftFinding[],
  paths: RuntimePaths,
): Finding {
  if (findings.length === 0) {
    return pass("drift", "every managed artifact matches its record", []);
  }
  /**
   * A generated Brain artifact gets its own recovery line, because the generic
   * one cannot fix it: `uninstall` preserves everything under the vault by
   * location and `init` does not rebuild an index, so "uninstall and initialize
   * again" is advice that provably loops. `brain reindex` is what regenerates
   * them, and it is the *only* thing that does.
   */
  const inVault = findings.some((finding) =>
    containsPath(paths.brain, finding.path),
  );

  return fail(
    "drift",
    `${String(findings.length)} managed artifacts differ from their record`,
    findings.map((finding) => finding.path),
    EXIT_CODES.decisionRequired,
    inVault
      ? "developer-os brain reindex for generated Brain artifacts; resolve anything else by hand"
      : "resolve each file by hand, or run developer-os uninstall and initialize again",
  );
}

async function checkBrain(
  context: CliContext,
  paths: RuntimePaths,
): Promise<Finding> {
  const directory = await isDirectory(context, paths.brain);
  if (directory === null) {
    return fail(
      "brain",
      "the Brain directory does not exist",
      [paths.brain],
      EXIT_CODES.operationalFailure,
      "developer-os init",
    );
  }
  return directory
    ? pass("brain", "Brain directory is present", [paths.brain])
    : fail(
        "brain",
        "the Brain path is not a directory",
        [paths.brain],
        EXIT_CODES.invalidInput,
      );
}

/**
 * Presence, type and mode only, never contents: `lstat` neither follows a
 * symlink nor discloses a byte of what the file holds, which is the whole point
 * of a check for a secret this product must be able to report on without
 * reading it (DOS-P6 Task 1).
 *
 * **Every state is a warning, and each one says which state it is.** This
 * check exists to be reachable: it grades exactly the outcomes
 * `readRedactionKey` returns `null` for, and until the composition root stopped
 * creating and stopped throwing, three of the four could not reach `doctor` at
 * all — a symlinked or truncated key failed *every* command, including this
 * one. A lost key degrades a diagnostic, never the knowledge: nothing is
 * encrypted with it, only fingerprints are derived from it, so none of this is
 * a failure and none of it earns a non-zero exit.
 *
 * `doctor` reports and never repairs, so the over-permissive case is a warning
 * too rather than a chmod. The next command that needs a durable key tightens
 * it, which is where a repair belongs.
 *
 * Every remedy below names `init`, and that has to stay true of `init`: these
 * messages were briefly false in both directions, because `runInit` returned
 * before it reached the key on a machine with nothing else to install. A
 * remedy nobody can follow is worse than no remedy — this check exits 0, so
 * nothing escalates when the user follows it and nothing happens.
 */
async function checkRedactionKey(
  context: CliContext,
  paths: RuntimePaths,
): Promise<Finding> {
  const file = redactionKeyPath(paths.stateDir);
  let stats;
  try {
    stats = await context.fs.lstat(file);
  } catch (error) {
    if (isMissingEntry(error)) {
      return warn(
        "redaction-key",
        `no redaction key exists yet; ${REDACTION_KEY_RECOVERY} creates one, and prior fingerprints will no longer be comparable to it`,
        [],
      );
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    return warn(
      "redaction-key",
      `the redaction key path is a symlink, which this product will not read; remove it and run ${REDACTION_KEY_RECOVERY}, and prior fingerprints will no longer be comparable`,
      [file],
    );
  }
  if (!stats.isFile()) {
    return warn(
      "redaction-key",
      `the redaction key path is not a regular file, which this product will not read; remove it and run ${REDACTION_KEY_RECOVERY}, and prior fingerprints will no longer be comparable`,
      [file],
    );
  }
  if (stats.size < REDACTION_KEY_BYTES) {
    return warn(
      "redaction-key",
      `the redaction key is too short to be a key; remove it and run ${REDACTION_KEY_RECOVERY}, and prior fingerprints will no longer be comparable`,
      [file],
    );
  }

  const mode = stats.mode & 0o777;
  const rendered = `present, 0${mode.toString(8).padStart(3, "0")}`;
  if (mode === 0o600) return pass("redaction-key", rendered, [file]);

  /**
   * Only the group and other bits make a mode *permissive*. `0400` and `0000`
   * are stricter than `0600`, not looser, and saying otherwise about `0000` is
   * the worst of the two: `readRedactionKey` cannot open it, so that run is on
   * an ephemeral key, while `lstat` needs no read permission at all and this
   * check reports the file as fine apart from being "more permissive".
   */
  const permissive = (mode & 0o077) !== 0;
  return warn(
    "redaction-key",
    permissive
      ? `${rendered}, which is more permissive than 0600; the next command that needs the key tightens it`
      : `${rendered}, which is not 0600`,
    [file],
  );
}

const MAX_RELEASE_TRUST_BYTES = 16 * 1024;

export const UNSIGNED_LOCAL_TRUST_WARNING =
  "installed from an unsigned local build; update and rollback refuse it";

/** Reports the D47 trust downgrade on every run; not init-owned, so it never undoes an install. */
async function checkReleaseTrust(paths: RuntimePaths): Promise<Finding> {
  const file = join(paths.stateDir, "release-trust.json");
  const bytes = await readBoundedFile(file, MAX_RELEASE_TRUST_BYTES, "the release trust state");
  if (bytes === null) return pass("release-trust", "no release trust state is recorded", []);
  const state = validateReleaseTrustState(decodeCanonicalJson(bytes, MAX_RELEASE_TRUST_BYTES));
  return isUnsignedLocalTrust(state)
    ? warn("release-trust", UNSIGNED_LOCAL_TRUST_WARNING, [file])
    : pass("release-trust", "signed release trust", [file]);
}

/** No-follow and bounded; `null` when the file is absent. */
async function readBoundedFile(path: string, maxBytes: number, label: string): Promise<Uint8Array | null> {
  let handle;
  try {
    handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

type Vendor = "claude" | "codex";
type InstructionState = InstructionStatusV1["state"];
type InstructionRow = Extract<ManagedArtifactV2, { readonly kind: "instruction" }>;
type BlockRow = Extract<InstructionRow, { readonly verification: { readonly mode: "block" } }>;

const VENDORS: readonly Vendor[] = ["claude", "codex"];
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_ACTIVE_RELEASE_BYTES = 16 * 1024;
const MAX_REGISTRATION_BYTES = 8 * 1024;
const MAX_TREE_FILE_BYTES = 16 * 1024 * 1024;
/** The block's id when no block row records one; the rows' own ids win (`v2-drift.test.ts`). */
const VENDOR_FILE_ID: Readonly<Record<Vendor, InstructionIdV1>> = {
  claude: "claude-md" as InstructionIdV1,
  codex: "agents-md" as InstructionIdV1,
};
const INSTRUCTION_RECOVERY =
  "re-run developer-os init; for an edited file or block, first move the edits into <product-home>/instructions/<vendor>/ and delete the whole block, both markers included";
const REGISTRATION_RECOVERY = "developer-os init";

function isVendor(owner: string): owner is Vendor {
  return owner === "claude" || owner === "codex";
}

function effectiveUid(): number {
  // No file is owned by uid -1, so a platform without `getuid` refuses every override read.
  return process.getuid?.() ?? -1;
}

async function readInstallNonce(paths: RuntimePaths): Promise<LifecycleInstallNonceV1 | null> {
  try {
    const bytes = await readBoundedFile(join(paths.stateDir, "lifecycle-install-nonce"), 65, "the lifecycle install nonce");
    return bytes === null ? null : parseLifecycleInstallNonce(bytes);
  } catch {
    return null;
  }
}

async function inspectV2Drift(
  context: CliContext,
  manifest: InstallationManifestV2,
  paths: RuntimePaths,
): Promise<readonly DriftFinding[]> {
  return inspectDrift({
    manifest,
    fs: context.fs,
    guards: context.guards.manifest,
    schemas: createManagedArtifactSchemaRegistry(await readInstallNonce(paths)),
    ephemerals: createManagedArtifactEphemeralRegistry(effectiveUid()),
  });
}

interface InstalledCatalog {
  readonly rows: readonly InstructionCatalogRowV1[];
  readonly workflowIds: ReadonlySet<string>;
}

/**
 * The catalog the active release installed, trusted only when its bytes hash to the manifest's
 * record for that exact path. A release without `instructions/` has no catalog row and no rows.
 */
async function readInstalledCatalog(
  paths: RuntimePaths,
  manifest: InstallationManifestV2,
): Promise<InstalledCatalog> {
  const activeBytes = await readBoundedFile(join(paths.stateDir, "active-release.json"), MAX_ACTIVE_RELEASE_BYTES, "the active release record");
  if (activeBytes === null) return { rows: [], workflowIds: new Set() };
  const { bundleRoot } = validateActiveReleaseRecord(
    decodeCanonicalJson(activeBytes, MAX_ACTIVE_RELEASE_BYTES),
    createCanonicalPathEvidence(),
  );
  const workflowPrefix = `${bundleRoot}/workflows/`;
  const workflowIds = new Set(
    manifest.artifacts
      .filter((artifact) => artifact.path.startsWith(workflowPrefix) && artifact.path.endsWith("/workflow.yaml"))
      .map((artifact) => artifact.path.slice(workflowPrefix.length, -"/workflow.yaml".length))
      .filter((id) => !id.includes("/")),
  );
  const catalogPath = join(bundleRoot, "instructions", "catalog.json");
  const row = manifest.artifacts.find((artifact) => artifact.path === catalogPath);
  if (row === undefined) return { rows: [], workflowIds };
  const bytes = await readBoundedFile(catalogPath, MAX_CATALOG_BYTES, "the installed instruction catalog");
  if (row.kind !== "file" || row.verification.mode !== "content" || bytes === null || hashBytes(bytes) !== row.verification.installedHash) {
    throw new Error("the installed instruction catalog does not match its manifest record");
  }
  const catalog = validateInstructionCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), workflowIds);
  return { rows: catalog.artifacts, workflowIds };
}

function key(category: InstructionCategoryV1, id: string): string {
  return `${category}/${id}`;
}

/** Any drifted row makes the artifact drifted; a missing piece makes it missing (spec §7). */
function stateOf(findings: readonly (DriftFinding | undefined)[], absent: boolean, installed: InstructionState): InstructionState {
  const present = findings.filter((finding): finding is DriftFinding => finding !== undefined);
  if (present.some((finding) => finding.kind !== "missing")) return "drifted";
  return absent || present.length > 0 ? "missing" : installed;
}

async function vendorInstructionStatuses(
  paths: RuntimePaths,
  vendor: Vendor,
  manifest: InstallationManifestV2,
  catalog: InstalledCatalog,
  findingAt: ReadonlyMap<string, DriftFinding>,
  homes: VendorHomesV1,
): Promise<readonly InstructionStatusV1[]> {
  const expected = new Map<string, { readonly category: InstructionCategoryV1; readonly id: InstructionIdV1; readonly source: "default" | "user" }>();
  for (const row of catalog.rows) {
    if (!row.vendors.includes(vendor)) continue;
    expected.set(key(row.category, row.id), { category: row.category, id: row.id, source: "default" });
  }
  const overrides = await loadInstructionOverrides({
    productHome: paths.home,
    vendor,
    effectiveUid: effectiveUid(),
    workflowIds: catalog.workflowIds,
  });
  for (const override of overrides) {
    expected.set(key(override.category, override.id), { category: override.category, id: override.id, source: "user" });
  }
  if (vendor === "claude") {
    for (const row of catalog.rows) {
      if (!row.thinCommand || !row.vendors.includes(vendor)) continue;
      const skill = expected.get(key("skill", row.id));
      expected.set(key("command", row.id), { category: "command", id: row.id, source: skill?.source ?? "default" });
    }
  }

  const rows = manifest.artifacts.filter(
    (artifact): artifact is InstructionRow => artifact.kind === "instruction" && artifact.owner === vendor,
  );
  const block = rows.find((artifact): artifact is BlockRow => artifact.verification.mode === "block");
  const contentRows = new Map<string, InstructionRow[]>();
  for (const row of rows) {
    if (row.verification.mode === "block") continue;
    const rowKey = key(row.instruction.category, row.instruction.id);
    contentRows.set(rowKey, [...(contentRows.get(rowKey) ?? []), row]);
  }
  const members = new Map((block?.instruction.members ?? []).map((member) => [key(member.category, member.id), member]));

  const keys = new Set([...expected.keys(), ...contentRows.keys(), ...members.keys()]);
  const statuses: InstructionStatusV1[] = [];
  const blockFinding = block === undefined ? undefined : findingAt.get(block.path);
  let membersExpected = false;
  for (const artifactKey of keys) {
    const want = expected.get(artifactKey);
    const recorded = contentRows.get(artifactKey) ?? [];
    const member = members.get(artifactKey);
    const identity = want ?? recorded[0]?.instruction ?? member;
    if (identity === undefined) continue;
    const { category, id } = identity;
    const source = recorded[0]?.instruction.source ?? member?.source ?? want?.source ?? "default";
    if (vendor === "codex" && category === "output-style") {
      statuses.push({ owner: vendor, category, id, source, state: "unsupported-vendor", paths: [] });
      continue;
    }
    const inBlock = category === "rule" || (vendor === "codex" && category === "scoped-rule");
    const hasFiles = !(vendor === "codex" && inBlock);
    membersExpected ||= inBlock;
    const absent = (hasFiles && recorded.length === 0) || (inBlock && member === undefined);
    const findings = [
      ...recorded.map((row) => findingAt.get(row.path)),
      ...(inBlock && member !== undefined ? [blockFinding] : []),
    ];
    const installed = vendor === "codex" && category === "scoped-rule" ? "emulated" : "installed";
    statuses.push({
      owner: vendor,
      category,
      id,
      source,
      state: stateOf(findings, absent, installed),
      paths: [...recorded.map((row) => row.path), ...(inBlock && block !== undefined ? [block.path] : [])],
    });
  }
  if (block !== undefined) {
    statuses.push({
      owner: vendor,
      category: "vendor-file",
      id: block.instruction.id,
      source: "default",
      state: stateOf([blockFinding], false, "installed"),
      paths: [block.path],
    });
  } else if (membersExpected) {
    const file = (vendor === "claude" ? claudeInstructionPaths(homes) : codexInstructionPaths(homes)).instructionFile;
    statuses.push({ owner: vendor, category: "vendor-file", id: VENDOR_FILE_ID[vendor], source: "default", state: "missing", paths: [file] });
  }
  return statuses;
}

function compareStatuses(left: InstructionStatusV1, right: InstructionStatusV1): number {
  return compareCodePoints(left.owner, right.owner)
    || compareCodePoints(left.category, right.category)
    || compareCodePoints(left.id, right.id);
}

function selectedVendors(config: DeveloperOsConfigV1 | null): readonly Vendor[] {
  return config === null ? [] : VENDORS.filter((vendor) => config.adapters[vendor]);
}

async function inspectInstructions(
  context: CliContext,
  paths: RuntimePaths,
  manifest: InstallationManifestV2,
  config: DeveloperOsConfigV1 | null,
  vendorFindings: readonly DriftFinding[],
  homes: VendorHomesV1,
): Promise<{ readonly finding: Finding; readonly statuses: readonly InstructionStatusV1[] }> {
  const vendors = selectedVendors(config);
  const catalog = vendors.length === 0 ? { rows: [], workflowIds: new Set<string>() } : await readInstalledCatalog(paths, manifest);
  const findingAt = new Map(vendorFindings.map((finding) => [finding.path, finding]));
  const statuses: InstructionStatusV1[] = [];
  for (const vendor of vendors) {
    statuses.push(...(await vendorInstructionStatuses(paths, vendor, manifest, catalog, findingAt, homes)));
  }
  statuses.sort(compareStatuses);

  const bad = statuses.filter((status) => status.state === "drifted" || status.state === "missing");
  // The registration record's drift reads as `stale` under `codex-registration`.
  const listed = new Set([...statuses.flatMap((status) => status.paths), codexInstructionPaths(homes).registrationFile]);
  // Vendor rows outside any artifact, e.g. the workflow skills in the Claude plugin tree.
  const unlisted = vendorFindings.filter((finding) => !listed.has(finding.path));
  if (bad.length > 0 || unlisted.length > 0) {
    const malformed = vendorFindings.some((finding) => finding.kind === "block_malformed");
    return {
      statuses,
      finding: fail(
        "instructions",
        [
          `${String(bad.length + unlisted.length)} instruction artifacts are drifted or missing`,
          ...(malformed ? ["block_malformed: a vendor instruction block has malformed markers"] : []),
        ].join("; "),
        [...new Set([...bad.flatMap((status) => status.paths), ...unlisted.map((finding) => finding.path)])],
        EXIT_CODES.decisionRequired,
        INSTRUCTION_RECOVERY,
      ),
    };
  }
  return { statuses, finding: instructionAdvisories(context, statuses, `${String(statuses.length)} instruction artifacts match their record`) };
}

/** Spec §2.2: a set `CLAUDE_CONFIG_DIR` is not followed, so the managed files are not what Claude reads. */
function instructionAdvisories(context: CliContext, statuses: readonly InstructionStatusV1[], passMessage: string): Finding {
  const unsupported = statuses.filter((status) => status.state === "unsupported-vendor");
  const warnings = [
    ...(unsupported.length > 0
      ? [`${String(unsupported.length)} instruction artifacts are unsupported by their vendor: ${unsupported.map((status) => `${status.owner} ${status.category}/${status.id}`).join(", ")}`]
      : []),
    ...(context.env.CLAUDE_CONFIG_DIR !== undefined && context.env.CLAUDE_CONFIG_DIR !== ""
      ? ["CLAUDE_CONFIG_DIR is set and not followed; Claude does not read the managed instruction files"]
      : []),
  ];
  return warnings.length > 0 ? warn("instructions", warnings.join("; "), []) : pass("instructions", passMessage, []);
}

function codexTreeFiles(manifest: InstallationManifestV2, pluginRoot: string): readonly { readonly path: string; readonly sha256: LowerHexSha256 }[] {
  return manifest.artifacts.flatMap((artifact) =>
    artifact.path.startsWith(`${pluginRoot}/`) && artifact.verification.mode === "content" && artifact.kind !== "directory"
      ? [{ path: artifact.path.slice(pluginRoot.length + 1), sha256: artifact.verification.installedHash }]
      : [],
  );
}

async function readRegistrationRecord(path: string): Promise<CodexRegistrationRecordV1 | null> {
  try {
    const bytes = await readBoundedFile(path, MAX_REGISTRATION_BYTES, "the codex registration record");
    return bytes === null ? null : validateCodexRegistrationRecord(bytes);
  } catch {
    return null;
  }
}

/**
 * `--probe` only. Codex loads skills from its cache copy, which `codex debug prompt-input` names
 * (`codex-adapter.md` §15); every tree file must hash equal under that root.
 */
async function isCacheStale(
  context: CliContext,
  codexExecutable: string,
  codexHome: string,
  files: readonly { readonly path: string; readonly sha256: string }[],
): Promise<boolean> {
  const result = await context.runner.run({
    executable: codexExecutable,
    args: ["debug", "prompt-input", "probe"],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 60_000,
    env: { CODEX_HOME: codexHome },
  });
  if (result.timedOut || result.exitCode !== 0) throw new Error("codex debug prompt-input failed");
  const cachePrefix = `${join(codexHome, "plugins", "cache", MARKETPLACE_NAME, PLUGIN_NAME)}/`;
  const at = result.stdout.indexOf(cachePrefix);
  if (at < 0) return true;
  const version = result.stdout.slice(at + cachePrefix.length).split("/")[0] ?? "";
  if (!/^[A-Za-z0-9._-]+$/u.test(version) || version === "." || version === "..") return true;
  const cacheRoot = join(cachePrefix, version);
  for (const file of files) {
    const bytes = await readBoundedFile(join(cacheRoot, file.path), MAX_TREE_FILE_BYTES, "a codex cache file");
    if (bytes === null || hashBytes(bytes) !== file.sha256) return true;
  }
  return false;
}

async function checkCodexRegistration(
  context: CliContext,
  manifest: InstallationManifest | null,
  config: DeveloperOsConfigV1 | null,
  homes: VendorHomesV1,
  probe: boolean,
): Promise<Finding> {
  if (manifest?.schemaVersion !== 2 || !selectedVendors(config).includes("codex")) {
    return pass("codex-registration", "codex is not selected", []);
  }
  const { pluginRoot, registrationFile } = codexInstructionPaths(homes);
  const files = codexTreeFiles(manifest, pluginRoot);
  if (files.length === 0) {
    return fail("codex-registration", "unregistered: no Codex plugin tree is installed", [pluginRoot], EXIT_CODES.operationalFailure, REGISTRATION_RECOVERY);
  }
  const outcome = (await discoverEachAgent(context)).find((candidate) => candidate.name === "codex");
  const executable = outcome?.discovery?.installed === true ? outcome.discovery.executablePath : null;
  if (executable === null) {
    return warn("codex-registration", "codex CLI absent; the registration was not inspected", []);
  }
  const state = await inspectCodexRegistration({
    runner: context.runner,
    codexExecutable: executable,
    codexHome: homes.codexHome,
    pluginRoot,
    record: await readRegistrationRecord(registrationFile),
    treeHash: codexPluginTreeHash(files),
  });
  if (state === "unregistered") {
    return fail("codex-registration", "unregistered: codex plugin list does not show the plugin enabled at its tree", [pluginRoot], EXIT_CODES.operationalFailure, REGISTRATION_RECOVERY);
  }
  if (state === "stale") {
    return fail("codex-registration", "stale: the plugin tree changed since its last registration", [registrationFile], EXIT_CODES.operationalFailure, REGISTRATION_RECOVERY);
  }
  if (probe && (await isCacheStale(context, executable, homes.codexHome, files))) {
    return fail("codex-registration", "cache-stale: Codex's cached copy differs from the plugin tree", [pluginRoot], EXIT_CODES.operationalFailure, REGISTRATION_RECOVERY);
  }
  return pass("codex-registration", "registered", [pluginRoot]);
}

/**
 * Discovery that refuses is a warning, never a failure.
 *
 * `MacOsPlatformAdapter` rejects a `which` result it cannot vouch for — most
 * often because the redactor rewrote a long, high-entropy path — and that
 * refusal is right: reporting it as installed would record an executable that
 * never existed. But Foundation installs no agent integration, so agent presence
 * is informational. Grading the refusal as a failure made `init` treat it as
 * failed post-install verification and revert a perfectly good install, which
 * meant nobody whose agent lived at such a path could install at all. `status`
 * has always degraded this to a warning; this is `doctor` agreeing with it.
 */
async function checkAgents(context: CliContext): Promise<Finding> {
  const outcomes = await discoverEachAgent(context);
  const failed = outcomes.filter(raised);
  const described = describeAgents(outcomes);
  if (failed.length === 0) return pass("agents", described, []);

  /**
   * The matrix **and** the diagnostics, not one or the other. This check used
   * to replace its whole message with the error, which is how a refusing
   * `claude` erased what was known about `codex` from the line a user reads.
   * Each failure is named with its agent, so two refusals for different
   * reasons cannot read as one.
   */
  const message = [
    described,
    ...failed.map(
      (outcome) =>
        `${outcome.name}: ${context.guards.redactDiagnostic(
          outcome.error instanceof Error
            ? outcome.error.message
            : "agent discovery failed",
        )}`,
    ),
  ].join("; ");

  /**
   * Only the refusal is demoted. `discoverExecutable` can also raise an
   * unsupported platform, invalid input, or a security refusal from the
   * process runner, and flattening those into a warning would erase the one
   * signal that says a guard fired. The exit code comes from the first
   * non-refusal, for the same reason: it is the error that earned the failure.
   */
  const graver = failed.find(
    (outcome) => !(outcome.error instanceof MacOsPlatformDiscoveryError),
  );
  return graver === undefined
    ? warn("agents", message, [])
    : fail("agents", message, [], exitCodeOf(graver.error));
}

/**
 * A check that throws must still produce a check. Doctor is the command run on
 * exactly the machines where reads fail — a corrupt journal, an unreadable
 * directory, a lock held by a concurrent run — and an escaping rejection there
 * becomes an unhandled top-level rejection that prints a stack trace with
 * absolute paths and no report at all.
 */
async function guarded(
  context: CliContext,
  id: string,
  paths: readonly string[],
  check: () => Promise<Finding>,
): Promise<Finding> {
  try {
    return await check();
  } catch (error) {
    return fail(
      id,
      context.guards.redactDiagnostic(
        error instanceof Error ? error.message : `${id} could not be checked`,
      ),
      paths,
      exitCodeOf(error),
    );
  }
}

async function collectFindings(
  context: CliContext,
  options: DoctorOptions,
): Promise<{
  readonly findings: readonly Finding[];
  readonly retainedBootstrapEvidence: readonly BootstrapEvidenceSummaryV1[];
  readonly instructions: readonly InstructionStatusV1[];
}> {
  /**
   * Emitted here, before the first check, and unconditionally on the flag
   * rather than on whether a Claude installation was discovered. Warning about
   * a mutation that then does not happen is noise a user forgives; staying
   * silent because discovery happened to fail is the failure this notice exists
   * to prevent, and it would make the warning depend on the order the checks
   * below run in.
   */
  if (options.probe) context.io.stderr(PROBE_MUTATION_WARNING);

  const platform = await checkPlatform(context);

  let config: DeveloperOsConfigV1 | null = null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch {
    config = null;
  }
  const paths = runtimePathsFor(context, config ?? undefined);
  const homes = resolveVendorHomes(context.env, context.userHome, paths.home);

  /**
   * One read, threaded through. Reading the manifest a second time for the drift
   * check would let a manifest deleted between the two reads produce a passing
   * manifest check beside a drift check that had nothing to compare against.
   */
  let inspected: InstallationManifest | null = null;
  const manifest = await guarded(
    context,
    "manifest",
    [paths.manifestFile],
    async () => {
      const checked = await checkManifest(context, paths, homes);
      inspected = checked.manifest;
      return checked.finding;
    },
  );

  /**
   * The inspector throws on a partial slot, on a foreign-uid entry whose
   * basename matches the namespace, and on the retention cap itself. Unguarded,
   * that became an unhandled rejection with a stack trace and no report at all,
   * which is the failure `guarded` exists to prevent.
   *
   * The cap case still degrades: the throw discards the ids the inspector had
   * already computed, so a user over the cap is told to archive without being
   * told what. Separating cap enforcement from inspection is NEW-56.
   */
  let evidenceIds: readonly BootstrapEvidenceSummaryV1[] = [];
  let evidenceFailure: Finding | null = null;
  try {
    const evidence = context.bootstrap?.state === "available"
      ? await context.bootstrap.inspectEvidence()
      : await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }));
    evidenceIds = evidence.report.ids;
  } catch (error) {
    evidenceFailure = fail(
      "bootstrap-evidence",
      context.guards.redactDiagnostic(
        error instanceof Error ? error.message : "bootstrap evidence could not be inspected",
      ),
      [],
      exitCodeOf(error),
    );
  }
  let vendorDrift: readonly DriftFinding[] | null = null;
  let instructions: readonly InstructionStatusV1[] = [];
  const evidenceFindings = evidenceFailure !== null ? [evidenceFailure] : evidenceIds.map((summary) => warn(
    `bootstrap-evidence:${summary.id}`,
    `${summary.operation} ${summary.status}; ${String(summary.entryCount)} entries; ${summary.regularFileBytes} regular-file bytes retained at ${summary.vaultPath}`,
    [summary.vaultPath],
  ));

  return { findings: [
    platform,
    await guarded(context, "product-home", [paths.home], () =>
      checkProductHome(context, paths),
    ),
    await guarded(context, "configuration", [paths.configFile], () =>
      checkConfiguration(context, paths),
    ),
    manifest,
    await guarded(context, "transactions", [], () =>
      checkTransactions(context),
    ),
    await guarded(context, "drift", [], async () => {
      const current = inspected;
      if (current === null) return pass("drift", "no manifest to compare against", []);
      if (current.schemaVersion === 1) return reportDrift(await detectManagedDrift(context, current), paths);
      const findings = await inspectV2Drift(context, current, paths);
      /** Vendor rows are reported by `instructions`, which is not init-owned: an edited block never reverts Foundation. */
      vendorDrift = findings.filter((finding) => isVendor(finding.owner));
      return reportDrift(findings.filter((finding) => !isVendor(finding.owner)), paths);
    }),
    await guarded(context, "brain", [paths.brain], () =>
      checkBrain(context, paths),
    ),
    await guarded(context, "redaction-key", [], () =>
      checkRedactionKey(context, paths),
    ),
    await guarded(context, "release-trust", [], () => checkReleaseTrust(paths)),
    // Not through `guarded`: an informational line, never a failure.
    await checkEntrypoint(context, paths),
    await guarded(context, "agents", [], () => checkAgents(context)),
    await guarded(context, "claude-capabilities", [], () =>
      checkClaudeCapabilities(context, options.probe),
    ),
    await guarded(context, "codex-capabilities", [], () =>
      checkCodexCapabilities(context, options.probe),
    ),
    // Not through `guarded`: both checks catch everything and never return "fail" (spec §8.2).
    ...await hookFindings(context, paths.stateDir),
    // Not through `guarded`: it turns a throw into "fail", which spec §8 forbids.
    { check: await checkVendorConfig(context), code: EXIT_CODES.success },
    await guarded(context, "instructions", [], async () => {
      const current = inspected;
      if (current?.schemaVersion !== 2) return instructionAdvisories(context, [], "no V2 installation to inspect");
      if (vendorDrift === null) throw new Error("managed drift could not be inspected");
      const inspection = await inspectInstructions(context, paths, current, config, vendorDrift, homes);
      instructions = inspection.statuses;
      return inspection.finding;
    }),
    await guarded(context, "codex-registration", [], () =>
      checkCodexRegistration(context, inspected, config, homes, options.probe),
    ),
    ...evidenceFindings,
  ], retainedBootstrapEvidence: evidenceIds, instructions };
}

/** Human output: one line per artifact (spec §7). */
export function describeInstructions(report: DoctorReportV1): readonly string[] {
  return report.instructions.map(
    (status) => `${status.owner} ${status.category}/${status.id}: ${status.source}, ${status.state}`,
  );
}

export function doctorExitCode(findings: readonly Finding[]): ExitCode {
  const codes = new Set(
    findings
      .filter((finding) => finding.check.status === "fail")
      .map((finding) => finding.code),
  );

  return (
    EXIT_PRECEDENCE.find((candidate) => codes.has(candidate)) ??
    EXIT_CODES.success
  );
}

export async function runDoctorReport(
  context: CliContext,
  options: DoctorOptions = NO_PROBE,
): Promise<DoctorReportV1> {
  const { findings, retainedBootstrapEvidence, instructions } = await collectFindings(context, options);
  return {
    schemaVersion: 1,
    checks: findings.map((finding) => finding.check),
    retainedBootstrapEvidence,
    instructions,
  };
}

export function hasFailingCheck(report: DoctorReportV1): boolean {
  return report.checks.some((check) => check.status === "fail");
}

/**
 * The checks `init` is answerable for, and the only ones that may undo it.
 *
 * `runInit` used to gate on the whole report, which meant any check failing for
 * a reason the install did not cause reverted a good install. That has now
 * happened twice: once with a stale journal from an unrelated interrupted run —
 * fixed by promoting the transaction check to a precondition — and once with
 * agent discovery refusing a path it could not vouch for. The pattern is the
 * bug, not either instance, so the gate is scoped rather than patched again.
 *
 * Excluded on purpose: `platform` and `transactions`, both already preconditions
 * checked before any mutation, and `agents`, which Foundation does not depend on
 * at all. Adding a check here is a deliberate statement that a failure of it
 * means the installation itself is broken.
 */
const INIT_OWNED_CHECKS: ReadonlySet<string> = new Set([
  "product-home",
  "configuration",
  "manifest",
  "drift",
  "brain",
]);

export function hasBlockingFailure(report: DoctorReportV1): boolean {
  return report.checks.some(
    (check) => check.status === "fail" && INIT_OWNED_CHECKS.has(check.id),
  );
}

/** Every non-blocking finding, phrased for the caller's warning channel. */
export function advisoryWarnings(report: DoctorReportV1): readonly string[] {
  return report.checks
    .filter(
      (check) =>
        check.status === "warn" ||
        (check.status === "fail" && !INIT_OWNED_CHECKS.has(check.id)),
    )
    .map((check) => `${check.id}: ${check.message}`);
}

/**
 * Doctor reports and never repairs, so a failing run is still a complete report:
 * the checks are returned as data and the exit code carries the severity.
 */
export async function runDoctor(
  context: CliContext,
  options: DoctorOptions = NO_PROBE,
): Promise<CliResult<DoctorReportV1>> {
  const { findings, retainedBootstrapEvidence, instructions } = await collectFindings(context, options);
  const report: DoctorReportV1 = {
    schemaVersion: 1,
    checks: findings.map((finding) => finding.check),
    retainedBootstrapEvidence,
    instructions,
  };
  const code = doctorExitCode(findings);

  if (code === EXIT_CODES.success) return success(report);

  const failing = findings.filter((finding) => finding.check.status === "fail");
  const failed = failing.map((finding) => finding.check);
  /**
   * The recovery command must come from the check that decided the exit code.
   * Taking the first available one tells a machine holding an unfinished
   * transaction to run `init`, which is the one thing it must not do.
   */
  const recovery = failing.find((finding) => finding.code === code)?.check
    .recovery;

  return failure(code, {
    kind: "doctor_failed",
    message: failed.map((check) => `${check.id}: ${check.message}`).join("; "),
    paths: failed.flatMap((check) => check.paths),
    ...(recovery === undefined ? {} : { recovery }),
  });
}
