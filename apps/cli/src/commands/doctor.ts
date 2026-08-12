import { join } from "node:path";

import {
  containsPath,
  detectDrift,
  EXIT_CODES,
  failure,
  loadConfig,
  ManifestStateError,
  success,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  DriftFinding,
  ExitCode,
  InstallationManifestV1,
  RuntimePaths,
} from "@developer-os/core";
import { PLUGIN_INSTALL_SEGMENTS } from "@developer-os/adapter-claude";
import { PLUGIN_TREE_SEGMENTS } from "@developer-os/adapter-codex";
import { MacOsPlatformDiscoveryError } from "@developer-os/platform-macos";
import type { AgentDiscovery, AgentName } from "@developer-os/platform-macos";

import { reportClaudeCapabilities } from "./claude-capabilities.js";
import { reportCodexCapabilities } from "./codex-capabilities.js";
import { exitCodeOf, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";

const AGENT_NAMES: readonly AgentName[] = ["claude", "codex"];
const JOURNAL_ID = /^[A-Za-z0-9._-]+$/;

export interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
}

export interface DoctorReportV1 {
  readonly schemaVersion: 1;
  readonly checks: readonly DoctorCheck[];
}

export interface IncompleteTransaction {
  readonly id: string;
  readonly phase: string;
}

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

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

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

export class ConfigurationError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor() {
    super("the configuration file is not valid Developer OS configuration");
    this.name = "ConfigurationError";
  }
}

/**
 * Reads configuration through the protected-path policy rather than a bare
 * `readFile`. The policy canonicalizes first and opens the canonical path with
 * `O_NOFOLLOW` plus a `dev`/`ino` re-check, so what refuses a `config.toml`
 * symlinked at `~/.aws/credentials` is the protected-path denylist, not
 * `O_NOFOLLOW` — a symlink at an unprotected file is still followed and read.
 *
 * The parser's own message never escapes: `smol-toml` embeds three raw source
 * lines in `TomlError.message`, so propagating it would print the contents of
 * whatever file was read into `status`, `doctor`, and their JSON output.
 * Redaction is a heuristic and must not be the only thing standing there.
 */
export async function readConfigFile(
  context: CliContext,
  configFile: string,
): Promise<DeveloperOsConfigV1 | null> {
  /**
   * Absence is checked here rather than by catching: the guarded reader reports
   * a missing file as a security refusal, which is the right answer for a read
   * but the wrong one for "this machine has never been initialized".
   */
  try {
    await context.fs.lstat(configFile);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  const serialized = await context.guards.readText(configFile);

  try {
    return loadConfig(serialized);
  } catch {
    throw new ConfigurationError();
  }
}

/**
 * Enumerates journals the core store deliberately does not enumerate for itself:
 * `TransactionStore` addresses one transaction at a time. Reading is not
 * mutation, so `status` and `doctor` stay inspection-only.
 */
export async function listIncompleteTransactions(
  context: CliContext,
): Promise<readonly IncompleteTransaction[]> {
  const journalDir = join(context.paths.stateDir, "transactions");

  let entries: readonly string[];
  try {
    entries = await context.fs.readdir(journalDir);
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }

  const ids = entries
    .filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
    .map((entry) => entry.slice(0, -".json".length))
    .filter((id) => JOURNAL_ID.test(id))
    .sort();

  const incomplete: IncompleteTransaction[] = [];
  for (const id of ids) {
    const journal = await context.transactions.read(id);
    if (journal.phase !== "finalized" && journal.phase !== "rolled_back") {
      incomplete.push({ id, phase: journal.phase });
    }
  }
  return incomplete;
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

export async function discoverAgents(
  context: CliContext,
): Promise<readonly AgentDiscovery[]> {
  const discovered: AgentDiscovery[] = [];
  for (const name of AGENT_NAMES) {
    discovered.push(await context.platform.discoverExecutable(name));
  }
  return discovered;
}

function describeAgents(agents: readonly AgentDiscovery[]): string {
  return agents
    .map((agent) => `${agent.name}=${agent.installed ? "present" : "absent"}`)
    .join(" ");
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
async function checkClaudeCapabilities(context: CliContext): Promise<Finding> {
  // Discovery can refuse — `MacOsPlatformAdapter` rejects a `which` result it
  // cannot vouch for, and `checkAgents` already demotes that to a warning. A
  // refusal here is information about the environment, not a failure of this
  // report, so it degrades to "nothing to examine" rather than propagating.
  let executablePath: string | null = null;
  try {
    const agents = await discoverAgents(context);
    const claude = agents.find((agent) => agent.name === "claude");
    executablePath = claude?.installed === true ? claude.executablePath : null;
  } catch {
    executablePath = null;
  }
  const report = await reportClaudeCapabilities({
    executablePath,
    runner: context.runner,
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
 * path under the user's home. Spec §4 puts the tree at
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
async function checkCodexCapabilities(context: CliContext): Promise<Finding> {
  // Discovery can refuse — `MacOsPlatformAdapter` rejects a `which` result it
  // cannot vouch for, and `checkAgents` already demotes that to a warning. A
  // refusal here is information about the environment, not a failure of this
  // report, so it degrades to "nothing to examine" rather than propagating.
  //
  // The consequence is worth stating plainly: the catch above is bare, so
  // any discovery error — a refusal, an unsupported platform, a security
  // refusal from the process runner — is rendered as `codex=absent`, "we
  // could not ask" printed as "not installed", the same conflation
  // `unreadable` exists to prevent, one layer up. `checkAgents` in this file
  // splits those on purpose (a refusal demotes to `warn`, anything else is
  // `fail`), so the same failure can leave `agents` failing while
  // `codex-capabilities` still prints `pass … codex=absent`. This is a known
  // residual, not an oversight: both adapters carry it, they must stay
  // identical because DOS-P6 consumes both, and DOS-P6 owns closing it.
  let executablePath: string | null = null;
  try {
    const agents = await discoverAgents(context);
    const codex = agents.find((agent) => agent.name === "codex");
    executablePath = codex?.installed === true ? codex.executablePath : null;
  } catch {
    executablePath = null;
  }
  const report = await reportCodexCapabilities({
    executablePath,
    runner: context.runner,
    pluginRoot: join(context.paths.home, ...PLUGIN_TREE_SEGMENTS),
  });
  /**
   * `report.recovery` is carried on every branch unconditionally —
   * `codex-capabilities.ts` decided a *report* that omits it is not a
   * report. But this is the *message*, the line a human reads, and advice to
   * open a Codex session is not actionable on a machine that has no Codex to
   * open one in. Gated on `installed` rather than on a specific capability
   * reading `wrapper-required`: `doctor` never sets `probe: true` (see the
   * comment on `CodexCapabilityRequest.probe`), so every installed branch it
   * can reach — unreadable, not-probed — reports `captureVia: "wrapper"`
   * today, and the advice is actionable in both of them; only `absent` is
   * not. The probed branch can return `captureVia: "hook"`
   * (`codex-capabilities.ts` does when `session_end_capture === "yes"`), but
   * `doctor` never sets `probe: true`, so that branch is unreachable here.
   */
  const recovery = report.installed ? ` recovery="${report.recovery}"` : "";
  return pass(
    "codex-capabilities",
    `${report.summary} capture-via=${report.captureVia}${recovery}`,
    [],
  );
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

async function checkManifest(
  context: CliContext,
  paths: RuntimePaths,
): Promise<{ readonly finding: Finding; readonly manifest: InstallationManifestV1 | null }> {
  try {
    const manifest = await context.manifests.readOptional();
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
  const incomplete = await listIncompleteTransactions(context);
  const first = incomplete[0];
  if (first === undefined) {
    return pass("transactions", "no incomplete transactions", []);
  }

  return fail(
    "transactions",
    `transaction ${first.id} stopped at phase ${first.phase}`,
    [join(context.paths.stateDir, "transactions", `${first.id}.json`)],
    EXIT_CODES.recoveryRequired,
    `developer-os repair --resume ${first.id} | developer-os repair --rollback ${first.id}`,
  );
}

async function checkDrift(
  context: CliContext,
  manifest: InstallationManifestV1 | null,
  paths: RuntimePaths,
): Promise<Finding> {
  if (manifest === null) {
    return pass("drift", "no manifest to compare against", []);
  }
  const findings = await detectManagedDrift(context, manifest);
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
  try {
    const agents = await discoverAgents(context);
    return pass("agents", describeAgents(agents), []);
  } catch (error) {
    const message = context.guards.redactDiagnostic(
      error instanceof Error ? error.message : "agent discovery failed",
    );

    /**
     * Only the refusal is demoted. `discoverExecutable` can also raise an
     * unsupported platform, invalid input, or a security refusal from the
     * process runner, and flattening those into a warning would erase the one
     * signal that says a guard fired.
     */
    return error instanceof MacOsPlatformDiscoveryError
      ? warn("agents", message, [])
      : fail("agents", message, [], exitCodeOf(error));
  }
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
): Promise<readonly Finding[]> {
  const platform = await checkPlatform(context);

  let config: DeveloperOsConfigV1 | null = null;
  try {
    config = await readConfigFile(context, context.paths.configFile);
  } catch {
    config = null;
  }
  const paths = runtimePathsFor(context, config ?? undefined);

  /**
   * One read, threaded through. Reading the manifest a second time for the drift
   * check would let a manifest deleted between the two reads produce a passing
   * manifest check beside a drift check that had nothing to compare against.
   */
  let inspected: InstallationManifestV1 | null = null;
  const manifest = await guarded(
    context,
    "manifest",
    [paths.manifestFile],
    async () => {
      const checked = await checkManifest(context, paths);
      inspected = checked.manifest;
      return checked.finding;
    },
  );

  return [
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
    await guarded(context, "drift", [], () =>
      checkDrift(context, inspected, paths),
    ),
    await guarded(context, "brain", [paths.brain], () =>
      checkBrain(context, paths),
    ),
    await guarded(context, "agents", [], () => checkAgents(context)),
    await guarded(context, "claude-capabilities", [], () =>
      checkClaudeCapabilities(context),
    ),
    await guarded(context, "codex-capabilities", [], () =>
      checkCodexCapabilities(context),
    ),
  ];
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
): Promise<DoctorReportV1> {
  const findings = await collectFindings(context);
  return {
    schemaVersion: 1,
    checks: findings.map((finding) => finding.check),
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
): Promise<CliResult<DoctorReportV1>> {
  const findings = await collectFindings(context);
  const report: DoctorReportV1 = {
    schemaVersion: 1,
    checks: findings.map((finding) => finding.check),
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
