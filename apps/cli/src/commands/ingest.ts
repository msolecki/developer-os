import { dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  success,
  TransactionConflictError,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  PlannedFileMutation,
  RuntimePaths,
} from "@developer-os/core";
import { DEFAULT_MAX_TURNS, invokeClaude } from "@developer-os/adapter-claude";
import { invokeCodex } from "@developer-os/adapter-codex";
import {
  BrainService,
  buildIngestPrompt,
  MAX_PROPOSED_PATH_CHARS,
  parseCaptureFile,
  parseIngestProposal,
  planIngestApply,
  renderCaptureFile,
  resolveBrainConfig,
  validateProposal,
} from "@developer-os/brain";
import type {
  BrainConfigV1,
  CaptureEnvelopeV1,
  CaptureStatus,
  IngestValidationFinding,
  PlannedNoteWriteV1,
  ValidatorId,
} from "@developer-os/brain";
import type { AgentName } from "@developer-os/platform-macos";
import { redactText, screenAndCap } from "@developer-os/security";
import { resolveScopeGlob } from "@developer-os/workflow-schema";

import {
  exitCodeOf,
  failureFrom,
  loadOrCreateRedactionKey,
  renderPath,
  resolveQuarantineRoot,
  runtimePathsFor,
} from "../context.js";
import type { CliContext, CliGuards } from "../context.js";
import { isDirectory, readConfigFile } from "./doctor.js";
import { outputSchemaPath } from "./output-schemas.js";
import { dependenciesFor, writeIndexArtifacts } from "./reindex.js";

/**
 * What `--json` publishes per capture: an id, the status it now holds, and the
 * content-root-relative paths this capture's proposal wrote. Never the note
 * bodies and never the observation — a machine consumer learns what moved and
 * where, and reads the notes in the vault like anybody else.
 */
export interface IngestedCaptureV1 {
  readonly captureId: string;
  readonly status: CaptureStatus;
  readonly notes: readonly string[];
}

/**
 * One capture this invocation could not finish, and why.
 *
 * It is reported in the failure's **message** rather than in a `data` field
 * because `CliResult` carries no data on a failure — `brain lint` records the
 * same constraint and answers it the same way. Closing that properly is a
 * Foundation change to `CliError`, not this command's to make.
 */
interface RefusedCaptureV1 {
  readonly captureId: string;
  readonly code: FailureExitCode;
  readonly message: string;
  readonly paths: readonly string[];
  /**
   * **This capture's own recovery, not the run's.** Almost every refusal on this
   * path carries advice that is specific to the capture it is about — repair
   * this file's frontmatter, move the note already at this path, resolve this
   * transaction with `repair` — and collapsing them into one run-level string
   * makes every one of them unreachable at runtime. `reportLines` prints it
   * beside the capture's own line so the advice lands next to what it is about.
   *
   * `null` where the failure was not an `IngestRefusal` and carried none.
   */
  readonly recovery: string | null;
  /**
   * The notes already written when the failure landed — empty unless the apply
   * transaction wrote them, in which case the capture is at `staging` with these
   * files in the vault. It is a different event from a refusal that wrote
   * nothing and it is labelled differently, because a user reading the line has
   * to know their vault changed.
   */
  readonly appliedNotes: readonly string[];
  /**
   * Where this capture's **own file** was left — **read back from disk**, not
   * derived from how far the run got.
   *
   * Neither `appliedNotes` nor the transaction that threw answers this. A
   * rollback that itself fails leaves the capture at `staging` with nothing
   * applied, and telling that user their capture "is still accepted, so the next
   * run tries it again" sends them to a run that will never select it. And when
   * the *fourth* transaction writes `ingested` and then fails to verify, the
   * notes are applied and no rollback runs — an inference from those two facts
   * says `staging` while the bytes on disk say `ingested`.
   */
  readonly leftAt: "untouched" | "staging" | "ingested";
}

type CaptureOutcome =
  | { readonly ok: true; readonly capture: IngestedCaptureV1 }
  | { readonly ok: false; readonly refusal: RefusedCaptureV1 };

export interface IngestResultV1 {
  readonly schemaVersion: 1;
  /**
   * The vendor that produced every proposal in this run, so a run is
   * attributable without re-deriving which agent was installed at the time.
   */
  readonly agent: AgentName;
  /** The captures this invocation selected, in `captureId` order. */
  readonly order: readonly string[];
  /**
   * One entry per capture this invocation reported on: the selected ones, plus
   * any whose own envelope could not be read. Unreadable captures are not
   * *processed*, so they are absent from `order` and present here.
   */
  readonly captures: readonly IngestedCaptureV1[];
  /** The subset of `captures` that reached `ingested`. */
  readonly applied: readonly IngestedCaptureV1[];
}

export interface IngestOptions {
  /** `--limit`. Absent means every accepted capture. */
  readonly limit?: number;
  /** `--agent`. Absent means the first installed vendor in `VENDOR_ORDER`. */
  readonly agent?: string;
  /**
   * `--yes`. Accepted and inert: **`ingest` never asks a question.** The human
   * gate for a capture is `review --decision accept`, already taken per capture
   * before this command can see it, and a second confirmation would re-ask a
   * question the user has already answered — which is why `capture` and
   * `review` prompt for nothing either. The flag is accepted so that a script
   * driving the whole pipeline non-interactively passes one vocabulary to every
   * verb rather than discovering that one of the three refuses it.
   */
  readonly assumeYes?: boolean;
}

/**
 * The `ingest` workflow's **declared, unresolved** write scopes, compiled in.
 *
 * Not the *resolved* set, because resolution is per-install: `resolveScopeGlob`
 * splices this vault's `contentRoot` and `indexesDir` into each glob, so nothing
 * about the resolved strings is knowable at build time. What is fixed between
 * releases is this list, and `ingest.test.ts` pins it against
 * `workflows/ingest/workflow.yaml` so a contract edit that does not update the
 * constant goes red. Resolution happens once per invocation, at the call site,
 * against the same `resolveBrainConfig(config)` every other Brain consumer uses.
 *
 * Reading the contract at runtime was rejected: it would make the workflow a
 * managed artifact this command depends on, which buys a runtime read for a new
 * manifest entry and a new drift surface.
 */
export const INGEST_DECLARED_WRITE_SCOPES = [
  "content/**",
  "content/_indexes/**",
] as const;

/**
 * Tried in this order when `--agent` is absent. A fixed order with no override
 * would make a second vendor reachable only by uninstalling the first, which is
 * not a thing to ask of anyone's machine — hence the flag.
 */
const VENDOR_ORDER: readonly AgentName[] = ["claude", "codex"];

/**
 * The Claude side of "zero declared write scopes" (spec §6.1): read tools only,
 * and **no write tool** — no `Write`, no `Edit`, no `Bash`, no `Task`. That is
 * what makes "the model cannot write" a property the vendor's own permission
 * system enforced before the model ran, rather than one our validators must
 * prove afterwards.
 *
 * Bare tool names rather than path-scoped permission rules, deliberately. The
 * read scope this command declares is a glob, and neither adapter's invocation
 * type carries a read-scope field at all: Codex expresses the read side as a
 * working root plus `-s read-only`, and Claude's `--allowedTools` takes
 * permission-rule syntax whose scoped form `claude-adapter.md` §14.3 names but
 * does not specify. Spec §10 is normative for external surfaces and an
 * implementation may not depend on one it does not carry, so the scoped form is
 * left to Task 17, which is the task that spends a real run against each vendor.
 */
const CLAUDE_READ_ONLY_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/**
 * The verb whose JSON Schema `init` installs, and therefore the only value
 * `--output-schema` may be pointed at. `outputSchemaPath` is the one function
 * that names it, because `init` writing the file and this command naming it are
 * the two halves that must not drift.
 */
const INGEST_VERB = "ingest.stage";

/**
 * One model call per capture. Longer than the adapters' own 30 s probe default
 * because this call reads a vault and writes a proposal rather than printing a
 * version, and bounded at all because an unbounded agent invocation is a run
 * whose cost is decided by the model.
 */
const INGEST_TIMEOUT_MS = 120_000;

/**
 * Required by the shared `CliInstallation` shape and read by neither
 * `invokeClaude` nor `invokeCodex`, both of which use `executable` alone. No
 * `--version` probe is spawned to fill it in: this command already knows the
 * executable from `discoverExecutable`, and spending a process to learn a string
 * nothing reads would be a probe in all but name.
 */
const UNKNOWN_VERSION = "unknown";

/** Vault-relative, under the configured content root. Spec §3.4. */
const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;

const CAPTURE_FILE_SUFFIX = ".md";

/**
 * The four transactions one capture produces, plus the compensating fifth.
 *
 * **They cannot be one transaction**, and the correction is the point: the
 * ladder mutates two different ownership regimes and the executor's lock is
 * per-execution. The status must be durable *before* the apply, or a crash
 * cannot be told from a run that never started; `BrainService.reindex()` reads
 * the vault, so it cannot run until the apply has finalized; and `ingested` may
 * not be claimed before the note is findable.
 *
 * **The residual, stated rather than closed:** a crash between `apply` and
 * `ingested` leaves a capture at `staging` with its notes already written.
 * `staging` is not `accepted`, so the next run does not select it and cannot
 * double-apply — it is visible and inert, and `developer-os repair` plus a hand
 * edit of the status is what moves it. No arrangement of these removes that
 * window, because no two of them can share a transaction.
 */
const TRANSACTION_KINDS = {
  stage: "ingest-stage",
  apply: "ingest-apply",
  reindex: "ingest-reindex",
  ingested: "ingest-ingested",
  rollback: "ingest-rollback",
} as const;

/**
 * The two validators whose refusal is a **security refusal** rather than an
 * operational one. Spec §6.4 names exit 5 for write-scope; extending it to the
 * secret scan is this plan's reading and is stated rather than buried — a secret
 * coming back from a model and a path trying to leave the vault are the same
 * kind of event, and different in kind from a model that got a frontmatter key
 * wrong. Collapsing all three either way would make every model mistake read as
 * an attempted escape, or every escape read as a mistake.
 */
const SECURITY_VALIDATORS: readonly ValidatorId[] = ["secret-scan", "write-scope"];

const NOT_INITIALIZED = "developer-os init";

const RETRY_LATER =
  "run developer-os ingest again; the capture is unchanged and still accepted";

/**
 * One line per state a refused capture can be left in. An earlier version was a
 * single constant carrying all of them; `refusedRecovery` below picks the ones
 * this run actually produced.
 */
const UNTOUCHED_RECOVERY =
  "a capture reported as refused wrote nothing and its status is unchanged, so the next run tries it again while it is accepted; to stop retrying one, set its status back to quarantined by hand and then developer-os review --id <id> --decision reject";

const PARTLY_APPLIED_RECOVERY =
  "a capture reported as partly applied is at staging with the notes named on its line already in the vault, and ingest never selects staging: read those notes, then set the status by hand — ingested if they are what you wanted, or accepted after removing them to try the capture again";

/**
 * The third state, and the one the two lines above between them described
 * wrongly: a capture whose status reached `staging` and whose notes never
 * landed. It is reached when the rollback itself fails, and it is the state a
 * run killed after `ingest-stage` finalizes leaves behind — `staging` with an
 * empty vault, which "wrote nothing and is still accepted" and "the notes named
 * on its line are already in the vault" are both false of.
 */
const STRANDED_RECOVERY =
  "a capture reported as left at staging wrote no notes and did not get its status back, and ingest never selects staging: set its status back to accepted by hand to try it again";

/**
 * The fourth state, which is a *success* wearing a failure's exit code: the
 * ladder completed and something after the last write threw. Nothing needs
 * doing to the capture, and saying otherwise would send a user to undo work
 * they wanted.
 */
const INGESTED_RECOVERY =
  "a capture reported as applied and ingested has its notes in the vault and its status at ingested, so there is nothing to redo for it: the failure printed beside its line happened after the work was finished";

const INCOMPLETE_TRANSACTION_RECOVERY =
  "if developer-os status reports an incomplete transaction, resolve it with developer-os repair first";

/**
 * The run-level escape, **assembled from the states this run actually left**
 * rather than listed in full every time.
 *
 * An earlier version was a constant carrying every line, so at least one
 * sentence in it was false on every run — and the one a user most needs is the
 * one about the state their capture is really in. Each line is emitted only if
 * some refusal in this run is in the state it describes.
 *
 * The `reject` half of the first line names the full escape rather than the
 * `review` command alone: a capture is only rejectable from `quarantined`
 * (`applyReviewDecision`'s own table), so the status has to go back by hand
 * first, and naming only the second half would send a user to a command that
 * refuses.
 *
 * Per-capture advice is printed beside each capture by `reportLines`; this is
 * what applies to the run.
 */
function refusedRecovery(refused: readonly RefusedCaptureV1[]): string {
  const lines: string[] = [];
  if (refused.some((refusal) => refusal.leftAt === "untouched")) {
    lines.push(UNTOUCHED_RECOVERY);
  }
  /**
   * `leftAt` as well as the notes, because a capture whose notes landed **and**
   * whose status then reached `ingested` satisfies the first half. Gating on the
   * notes alone emits this line beside `INGESTED_RECOVERY`, telling the same
   * user to undo work that finished.
   */
  if (
    refused.some(
      (refusal) => refusal.appliedNotes.length > 0 && refusal.leftAt !== "ingested",
    )
  ) {
    lines.push(PARTLY_APPLIED_RECOVERY);
  }
  if (
    refused.some(
      (refusal) => refusal.leftAt === "staging" && refusal.appliedNotes.length === 0,
    )
  ) {
    lines.push(STRANDED_RECOVERY);
  }
  if (refused.some((refusal) => refusal.leftAt === "ingested")) {
    lines.push(INGESTED_RECOVERY);
  }
  lines.push(INCOMPLETE_TRANSACTION_RECOVERY);
  return lines.join("\n");
}

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class IngestRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "IngestRefusal";
  }
}

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/* --------------------------------------------------------- what to work on */

function resolveAgent(options: IngestOptions): AgentName | null {
  const { agent } = options;
  if (agent === undefined) return null;
  if (!(VENDOR_ORDER as readonly string[]).includes(agent)) {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      `an agent is one of ${VENDOR_ORDER.join(", ")}`,
    );
  }
  return agent as AgentName;
}

async function readConfiguration(
  context: CliContext,
): Promise<DeveloperOsConfigV1> {
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) {
    throw new IngestRefusal(
      EXIT_CODES.operationalFailure,
      "Developer OS is not initialized, so there is no vault to ingest into",
      [context.paths.configFile],
      NOT_INITIALIZED,
    );
  }
  return config;
}

async function assertVaultPresent(
  context: CliContext,
  paths: RuntimePaths,
): Promise<void> {
  const directory = await isDirectory(context, paths.brain);
  if (directory === null) {
    throw new IngestRefusal(
      EXIT_CODES.operationalFailure,
      "the vault does not exist, so there are no captures to ingest",
      [paths.brain],
      NOT_INITIALIZED,
    );
  }
  if (!directory) {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      "the vault path exists and is not a directory",
      [paths.brain],
    );
  }
}

interface Vendor {
  readonly name: AgentName;
  readonly executable: string;
}

/**
 * The first installed vendor in `VENDOR_ORDER`, or the one `--agent` named.
 *
 * **This does not probe.** Probing is opt-in and its first production caller is
 * elsewhere; making the central path spend a process to learn what the two-gate
 * table already claims would be the expensive half of a capability check for
 * none of its value. A vendor that then returns something `parseIngestProposal`
 * refuses surfaces as `malformed-output`, which is where a missing structured
 * result actually shows up.
 *
 * A discovery that *refuses* — the adapter declines to vouch for a path it
 * resolved — is treated as "not this one" rather than as a run-ending error, so
 * a hostile `claude` on `PATH` does not also cost the user their `codex`. With
 * one vendor named explicitly there is nothing to fall through to, and the
 * refusal is the exit-4 message below.
 */
async function selectVendor(
  context: CliContext,
  requested: AgentName | null,
): Promise<Vendor> {
  const candidates = requested === null ? VENDOR_ORDER : [requested];

  for (const name of candidates) {
    let executable: string | null = null;
    try {
      const discovery = await context.platform.discoverExecutable(name);
      executable = discovery.installed ? discovery.executablePath : null;
    } catch {
      executable = null;
    }
    if (executable !== null) return { name, executable };
  }

  throw new IngestRefusal(
    EXIT_CODES.capabilityUnavailable,
    requested === null
      ? "ingest needs an agent CLI and neither claude nor codex is installed"
      : `ingest was asked for ${requested} and it is not installed`,
    [],
    "install one of the agent CLIs, then developer-os doctor to confirm it is found",
  );
}

/**
 * The capture files in quarantine, by name, sorted — which is `captureId` order,
 * because the id **is** the file name. Two runs over the same set therefore do
 * the same work in the same sequence.
 */
async function captureFileNames(
  context: CliContext,
  quarantine: string,
): Promise<readonly string[]> {
  try {
    const entries = await context.fs.readdir(quarantine, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(CAPTURE_FILE_SUFFIX))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }
}

interface Selection {
  /** File names, in `captureId` order, bounded by `--limit`. */
  readonly accepted: readonly string[];
  /** Captures whose own envelope could not be read, reported and not processed. */
  readonly unreadable: readonly IngestedCaptureV1[];
  readonly warnings: readonly string[];
}

/**
 * Every accepted capture, in id order, plus the ones nothing can be done with.
 *
 * **A capture this cannot parse is `failed`** (spec §5.5) — a truncated write,
 * or a hand edit that broke the frontmatter — and it is reported rather than
 * repaired: nothing is written to a file whose envelope this product cannot
 * read, because the only honest repair is the user opening it. `failed` is
 * therefore derived and never persisted, which is also how `capture` and
 * `review` report it.
 *
 * **`--limit` bounds the accepted set only.** An unreadable capture costs no
 * agent call and no transaction, so hiding one behind a limit would mean a user
 * with three broken files and `--limit 1` is told about one of them per run.
 */
async function selectCaptures(
  context: CliContext,
  quarantine: string,
  key: Uint8Array,
  limit: number | null,
): Promise<Selection> {
  const accepted: string[] = [];
  const unreadable: IngestedCaptureV1[] = [];
  const warnings: string[] = [];

  for (const fileName of await captureFileNames(context, quarantine)) {
    const text = await context.guards.readText(join(quarantine, fileName));
    const outcome = parseCaptureFile(fileName, text, (value) =>
      redactText(value, key),
    );
    if (!outcome.ok) {
      const captureId = fileName.slice(0, -CAPTURE_FILE_SUFFIX.length);
      unreadable.push({ captureId, status: "failed", notes: [] });
      warnings.push(
        `${fileName} is not a readable capture (${outcome.reason}), so it is failed rather than waiting to be ingested`,
      );
      continue;
    }
    if (outcome.envelope.status !== "accepted") continue;
    if (limit !== null && accepted.length >= limit) continue;
    accepted.push(fileName);
  }

  return { accepted, unreadable, warnings };
}

/* ------------------------------------------------------- reading and writing */

/**
 * The capture's own path, canonicalized and proven to still be inside
 * quarantine — `review.ts` records the argument in full. The file name comes
 * from a directory listing here rather than from `--id`, so the shape check that
 * makes the path unbuildable is upstream; this is the check that makes a
 * *symlinked* component resolving out of the vault unusable.
 *
 * **`quarantine` is the canonical root `resolveQuarantineRoot` returned**, which
 * is what makes this containment check absolute rather than relative to whatever
 * the quarantine path happens to resolve to today.
 */
async function resolveCapturePath(
  context: CliContext,
  quarantine: string,
  fileName: string,
): Promise<string> {
  const target = join(quarantine, fileName);
  await context.guards.transaction.assertTarget(target);

  const canonicalTarget = await context.guards.canonicalize(target);
  if (!containsPath(quarantine, canonicalTarget)) {
    throw new IngestRefusal(
      EXIT_CODES.securityRefusal,
      "the capture resolves outside the quarantine directory",
      [target],
    );
  }
  return canonicalTarget;
}

/**
 * One `replace` mutation against a capture file, through Foundation's
 * `TransactionExecutor`.
 *
 * **`validateChangePlan` is deliberately absent**, for the reason `review.ts`
 * records: that layer decides ownership from the manifest, and a capture is
 * absent from it by design — it is the user's own content, editable in Obsidian,
 * so recording it as a managed artifact would report every legitimate edit as
 * drift. `resolveCapturePath` stands in for it, which is a narrower constraint
 * than ownership rather than the same one.
 *
 * **The lost-update window is the one `review.ts` describes and it is not
 * closed here.** Each capture is read as late as possible — immediately before
 * the transaction that moves it — which narrows the window to in-process work
 * and cannot remove it. `docs/superpowers/ORDER.md` carries the Foundation
 * change (a caller-supplied precondition on `PlannedFileMutation`) that would.
 */
async function writeCaptureFile(
  context: CliContext,
  kind: string,
  target: string,
  contents: string,
): Promise<void> {
  try {
    await context.executor.execute({
      kind,
      mutations: [
        {
          targetPath: target,
          operation: "replace",
          content: new TextEncoder().encode(contents),
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof TransactionConflictError)) throw error;
    throw new IngestRefusal(
      exitCodeOf(error),
      "the capture changed on disk while this ingest was running, so its status did not move",
      [target],
      "if developer-os status reports an incomplete transaction, resolve it with developer-os repair first; otherwise run developer-os ingest again, which reads the newer file",
    );
  }
}

/* ---------------------------------------------------------- the agent call */

interface AgentOutcome {
  readonly payload: unknown;
}

/**
 * The bridge between one prompt and two vendors that share **neither an
 * invocation type nor a result type**.
 *
 * It lives here rather than in a shared package because it is two vendors, two
 * shapes and one narrow function: inventing a common adapter interface in
 * `packages/core` would be a Foundation change made in passing, and the two
 * adapters are peers under `workflow-schema` rather than implementations of an
 * interface either of them declares.
 *
 * **Zero write scopes, and each sandbox follows from that count rather than
 * from an argument.** `invokeCodex` derives `-s read-only` from
 * `writeScopes.length === 0`; the Claude side passes `CLAUDE_READ_ONLY_TOOLS`,
 * which carries no write tool. Neither invocation type has a *read* scope
 * field, so the read side is each vendor's own vocabulary: Codex gets the
 * content root as its working root, and Claude gets the tool list. The resolved
 * `content/**` glob this workflow declares is what Developer OS states it
 * reads, not a string either CLI accepts.
 *
 * **`outputSchemaPath` reaches Codex only.** `invokeClaude` has no
 * `--output-schema` flag, so on that vendor the schema is described in the
 * prompt and enforced by `parseIngestProposal` afterwards rather than by the
 * CLI. The asymmetry is the adapters', not this command's, and it is stated
 * here because a reader will otherwise assume both calls are constrained the
 * same way.
 */
async function invokeVendor(
  context: CliContext,
  vendor: Vendor,
  prompt: string,
  workingRoot: string,
  schemaPath: string,
): Promise<AgentOutcome> {
  const installation = { executable: vendor.executable, version: UNKNOWN_VERSION };
  const dependencies = { runner: context.runner };

  const result =
    vendor.name === "claude"
      ? await invokeClaude(
          installation,
          {
            prompt,
            maxTurns: DEFAULT_MAX_TURNS,
            allowedTools: CLAUDE_READ_ONLY_TOOLS,
            timeoutMs: INGEST_TIMEOUT_MS,
          },
          dependencies,
        )
      : await invokeCodex(
          installation,
          {
            prompt,
            workingRoot,
            writeScopes: [],
            outputSchemaPath: schemaPath,
            timeoutMs: INGEST_TIMEOUT_MS,
          },
          dependencies,
        );

  if (result.ok) return { payload: result.payload };

  /**
   * Each failure keeps its own identity, because they mean different things to
   * a user: a timeout is retryable, a refusal is a bug in what this command
   * built, a non-zero exit is the vendor's own complaint. None of them is a
   * reason to touch the capture, which stays `accepted`.
   *
   * **A refusal carries its own detail**, which the adapters supply and this
   * used to drop. `refused` is the one reason whose name says nothing about
   * what went wrong — the adapters return it for a prompt, a write scope, a
   * working root, an output schema path and a turn bound — and a user told only
   * that the run "did not return a usable proposal (refused)" learns nothing
   * and retries forever. The detail names the **field**, never the value:
   * `screenValueArgument` composes its message from the caller's own field
   * label, so nothing model-chosen is interpolated here.
   */
  const detail = result.reason === "refused" ? `: ${result.detail}` : "";
  throw new IngestRefusal(
    EXIT_CODES.operationalFailure,
    `the ${vendor.name} agent did not return a usable proposal (${result.reason}${detail})`,
    [],
    RETRY_LATER,
  );
}

/* ----------------------------------------------------------- the validators */

/**
 * Where a validation finding becomes a string this process prints — on stderr
 * and, more importantly, in the `--json` payload.
 *
 * **The path is screened here and nowhere upstream**, and both halves of that
 * are deliberate. `packages/brain` keeps a finding's path byte-exact and
 * delegates screening to the terminal (`docs/architecture/brain.md` §5), which
 * is right there: a path is an identifier a user has to be able to act on.
 * `--json` is the channel that has no terminal behind it — `emit` deliberately
 * does not pass it through `renderPath`, and `JSON.stringify` escapes `\p{Cc}`
 * but not `\p{Cf}`, so a bidi override in a model-chosen path would survive into
 * anything that cats the output. `screenAndCap` closes that, at the one seam
 * where a finding stops being data and becomes a message.
 *
 * `finding.message` is screened by the validators already and is not screened
 * twice; the bound is `MAX_PROPOSED_PATH_CHARS`, the same one the proposal
 * parser refuses a longer path with.
 */
export function renderValidationFinding(finding: IngestValidationFinding): string {
  const where =
    finding.path === null
      ? ""
      : ` ${screenAndCap(finding.path, MAX_PROPOSED_PATH_CHARS)}`;
  return `${finding.validator}${where}: ${finding.message}`;
}

function refusalFrom(
  findings: readonly IngestValidationFinding[],
  captureId: string,
): IngestRefusal {
  const security = findings.some((finding) =>
    SECURITY_VALIDATORS.includes(finding.validator),
  );
  const paths = [
    ...new Set(
      findings.flatMap((finding) =>
        finding.path === null
          ? []
          : [screenAndCap(finding.path, MAX_PROPOSED_PATH_CHARS)],
      ),
    ),
  ];

  return new IngestRefusal(
    security ? EXIT_CODES.securityRefusal : EXIT_CODES.operationalFailure,
    [
      `the proposal for capture ${captureId} was refused by ${String(findings.length)} validator finding${findings.length === 1 ? "" : "s"}`,
      ...findings.map((finding) => `  ${renderValidationFinding(finding)}`),
    ].join("\n"),
    paths,
    RETRY_LATER,
  );
}

/**
 * The capture's status **as the file now holds it**, or `null` when that cannot
 * be read.
 *
 * Called once, on the failure path, so the report can say where the capture was
 * left without inferring it from which transaction threw. `parseCaptureFile`
 * rather than a status-line regular expression, because this file is the thing
 * whose parse decides `failed` everywhere else in this command and a second,
 * looser reader is a second answer to one question.
 */
async function statusOnDisk(
  context: CliContext,
  path: string,
  fileName: string,
  key: Uint8Array,
): Promise<CaptureStatus | null> {
  try {
    const parsed = parseCaptureFile(
      fileName,
      await context.guards.readText(path),
      (value) => redactText(value, key),
    );
    return parsed.ok ? parsed.envelope.status : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------- applying and reindexing */

/**
 * What the apply transaction left on disk, and whether it finished.
 *
 * **Returned rather than thrown**, because the caller has two questions with
 * different answers: *what happened* is `reason`, which is what the user is told
 * and what decides the exit code, and *what is on disk* is `notes`, which
 * decides whether the capture may be rolled back to `accepted`. A failure that
 * wrote nothing still throws — there is nothing to report about it that the
 * error itself does not carry.
 */
type ApplyOutcome =
  | { readonly ok: true; readonly notes: readonly string[] }
  | { readonly ok: false; readonly notes: readonly string[]; readonly reason: unknown };

async function exists(context: CliContext, path: string): Promise<boolean> {
  try {
    await context.fs.lstat(path);
    return true;
  } catch (error) {
    if (isMissingEntry(error)) return false;
    throw error;
  }
}

/**
 * Transaction 2: one `create` per proposed note.
 *
 * **`create`, never `replace`.** A proposal names notes the vault would *gain*;
 * a path that already holds a note is refused here rather than overwritten,
 * because the model's job is to propose knowledge and not to edit the user's
 * existing notes. The refusal is raised before the transaction so the user meets
 * a sentence about their own vault rather than a `TransactionPlanError`.
 *
 * **No `validateChangePlan`**, for the reason a capture skips it: a note is the
 * user's own content, edited in Obsidian by design, so recording one as a
 * managed artifact would report every legitimate edit as drift and would make a
 * later ingest a refused `create` over an artifact the product claims to own.
 * What stands in its place is the write-scope validator, which canonicalized
 * every one of these paths and proved the *destination* is inside the content
 * root — a narrower constraint than ownership, and the one that matters for a
 * path a model chose.
 */
async function applyNotes(
  context: CliContext,
  contentRoot: string,
  writes: readonly PlannedNoteWriteV1[],
): Promise<ApplyOutcome> {
  const mutations: PlannedFileMutation[] = [];
  /** Each mutation's canonical target beside the note name it was planned for. */
  const planned: { readonly path: string; readonly target: string }[] = [];

  for (const write of writes) {
    const target = join(contentRoot, write.path);
    await context.guards.transaction.assertTarget(target);
    /**
     * The executor stages into a temporary file beside its target, so the
     * directory has to exist first — the same reason `init`, `capture` and
     * `brain reindex` create theirs before executing. A proposal may name a
     * topic folder the vault does not have yet, which is inside `content/**`
     * and is a legitimate thing for it to name.
     *
     * A refusal below therefore leaves an empty directory behind, because a
     * directory is not a transaction mutation and nothing rolls it back. That
     * is the same residual `brain reindex` leaves when it creates the indexes
     * directory and then refuses; an empty folder in the vault is visible,
     * inert, and the user's to remove.
     */
    await context.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });

    const canonical = await context.guards.canonicalize(target);
    if (await exists(context, canonical)) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        "the proposal names a path that already holds a file; ingest creates notes and never replaces one",
        [screenAndCap(write.path, MAX_PROPOSED_PATH_CHARS)],
        "ingest will refuse this capture again until something changes: move or delete the existing note if the proposal should replace it, or set the capture's status back to quarantined by hand and then developer-os review --id <id> --decision reject",
      );
    }

    mutations.push({
      targetPath: canonical,
      operation: "create",
      content: write.bytes,
    });
    planned.push({ path: write.path, target: canonical });
  }

  /**
   * **A throw out of `execute` does not mean "wrote nothing".** `apply()` writes
   * every mutation and transitions the journal to `applied` before
   * `verifyDesired` runs, and that verify raises `TransactionConflictError`
   * (`packages/core/src/transactions/executor.ts:586-611`) with the files
   * already on disk; a crash lands in the same place. Reporting "nothing was
   * written" there rolls the capture back to `accepted`, and the next run then
   * meets its own output at a path `create` refuses — permanently, under advice
   * promising a retry.
   *
   * **Which notes landed is asked of the filesystem rather than inferred from
   * the journal**, because the journal is not in hand: `execute` throws instead
   * of returning it, and its id is not recoverable from the error. The question
   * "is this path occupied" is also the exact question the next run will ask, so
   * an answer taken from the disk cannot disagree with it — where a phase read
   * from the journal could, if a later phase had removed what an earlier one
   * wrote. An empty answer leaves `applied` unset and the capture retryable,
   * which is the pre-transaction state and the correct one.
   */
  try {
    await context.executor.execute({
      kind: TRANSACTION_KINDS.apply,
      mutations,
    });
  } catch (error) {
    const landed: string[] = [];
    for (const entry of planned) {
      if (await exists(context, entry.target)) landed.push(entry.path);
    }
    if (landed.length === 0) throw error;
    return { ok: false, notes: landed, reason: error };
  }

  return { ok: true, notes: writes.map((write) => write.path) };
}

/**
 * Transaction 3: `brain reindex`'s path, not a second one.
 *
 * `BrainService.reindex()` returns bytes and **cannot write** — its absence of a
 * write channel is the design — so the CLI stages those bytes through the
 * executor exactly as `brain reindex` does. It runs after the apply has
 * finalized, because it reads the vault it is indexing.
 */
async function reindexVault(
  context: CliContext,
  config: DeveloperOsConfigV1,
  paths: RuntimePaths,
  brainConfig: BrainConfigV1,
): Promise<void> {
  const service = new BrainService(
    dependenciesFor(context, paths.brain, config),
  );

  await writeIndexArtifacts(context, {
    vaultRoot: paths.brain,
    indexesDir: join(brainConfig.contentRoot, brainConfig.indexesDir),
    files: (await service.reindex()).files,
    kind: TRANSACTION_KINDS.reindex,
    refuse: (message, paths_) =>
      new IngestRefusal(EXIT_CODES.operationalFailure, message, paths_),
  });
}

/**
 * Where the capture was left, **read first and inferred only if the read
 * fails**.
 *
 * The three statuses this maps from are the only ones a failed run can leave:
 * the capture's own file is written by exactly two transactions here and put
 * back by a third. Anything else — `quarantined`, or an `accepted` that a
 * rollback restored — means the file holds what it held before this run, which
 * is what `untouched` says.
 *
 * The fallback exists because the file may be unreadable at exactly the moment
 * this asks; it is the inference the read replaces, and it is wrong in the one
 * case the read was added for, so it is a last resort rather than a shortcut.
 */
async function leftAtOf(
  context: CliContext,
  key: Uint8Array,
  fileName: string,
  capturePath: string | null,
  progress: { readonly movedToStaging: boolean; readonly rolledBack: boolean },
): Promise<RefusedCaptureV1["leftAt"]> {
  const status =
    capturePath === null
      ? null
      : await statusOnDisk(context, capturePath, fileName, key);

  if (status === "ingested") return "ingested";
  if (status === "staging") return "staging";
  if (status !== null) return "untouched";
  return progress.movedToStaging && !progress.rolledBack ? "staging" : "untouched";
}

/* ------------------------------------------------------------ one capture */

interface IngestEnvironment {
  readonly config: DeveloperOsConfigV1;
  readonly paths: RuntimePaths;
  readonly brainConfig: BrainConfigV1;
  readonly quarantine: string;
  readonly contentRoot: string;
  readonly key: Uint8Array;
  readonly vendor: Vendor;
  readonly ingestContract: readonly string[];
}

/**
 * One capture, one agent call, four transactions.
 *
 * ```text
 * accepted capture
 *   → status → staging                                  (ingest-stage)
 *   → prompt from envelope.content, marked as DATA
 *   → adapter.invoke(read-only sandbox, zero write scopes)
 *   → IngestProposal, parsed
 *   → the nine deterministic validators
 *   → one create per proposed note                      (ingest-apply)
 *   → brain reindex                                     (ingest-reindex)
 *   → status → ingested                                 (ingest-ingested)
 * ```
 *
 * **Nothing that fails here produces `failed`**, and which of the other two it
 * leaves depends on whether the notes landed. `failed` describes a capture whose
 * own envelope is unreadable, and collapsing it with a refusal would make a
 * transient model failure look like data loss — the capture is fine and the
 * proposal was not.
 *
 * - **While no note of this proposal exists on disk**, the capture is rolled
 *   back to `accepted` and the next run tries it again.
 * - **Once any of them does** — which is from the moment `ingest-apply` writes
 *   its mutations, *before* it verifies them and well before it finalizes — the
 *   capture stays at `staging`, which `selectCaptures` never selects.
 *   `accepted` would be a lie there — a second run would meet this run's own
 *   output and refuse — so the capture is left in the state that is true, is
 *   reported as *partly applied*, and waits for a person. `applyNotes` decides
 *   this by asking the filesystem which of its targets exist, because a throw
 *   out of `execute` says nothing about how far it got.
 * - **A rollback that itself fails** leaves the capture at `staging` with
 *   nothing applied. It is a third state, labelled and given its own recovery
 *   line rather than folded into either of the two above.
 *
 * **The apply and the reindex are skipped when the proposal proposes nothing.**
 * An empty `notes` array is a correct answer — it means this capture is not
 * worth a note — and there is then nothing to create and nothing new to index.
 * The capture still reaches `ingested`, because it has been through the
 * pipeline and there is no other status for "considered and left alone".
 */
async function ingestOne(
  context: CliContext,
  environment: IngestEnvironment,
  fileName: string,
): Promise<CaptureOutcome> {
  const { brainConfig, key, paths, quarantine, vendor } = environment;
  const captureId = fileName.slice(0, -CAPTURE_FILE_SUFFIX.length);

  /**
   * **This function answers rather than throws**, so one capture's failure is
   * contained where it happened rather than at a loop that cannot tell how far
   * the capture got. The two hoisted values are what the catch needs and cannot
   * have until the file has been located and read; a failure before either is
   * assigned has nothing to roll back.
   */
  let capturePath: string | null = null;
  let staged: CaptureEnvelopeV1 | null = null;
  /** Non-null once `ingest-apply` finalized, holding the notes it wrote. */
  let applied: readonly string[] | null = null;

  try {
    const path = await resolveCapturePath(context, quarantine, fileName);
    capturePath = path;

    const text = await context.guards.readText(path);
    const parsed = parseCaptureFile(fileName, text, (value) =>
      redactText(value, key),
    );
    if (!parsed.ok) {
      throw new IngestRefusal(
        EXIT_CODES.invalidInput,
        `the capture at ${fileName} could not be read (${parsed.reason})`,
        [path],
        "open the file and repair its frontmatter; nothing is written to a capture this command cannot read",
      );
    }
    const envelope = parsed.envelope;
    if (envelope.status !== "accepted") {
      throw new IngestRefusal(
        EXIT_CODES.invalidInput,
        `this capture is at status ${envelope.status}, which ingest does not move`,
        [path],
        "set the file's status back to accepted by hand if it should be ingested again",
      );
    }
    staged = envelope;

    /** Transaction 1. Durable before the apply, or a crash is indistinguishable
     * from a run that never started. */
    await writeCaptureFile(
      context,
      TRANSACTION_KINDS.stage,
      path,
      renderCaptureFile({ ...envelope, status: "staging" }),
    );

    const outcome = await invokeVendor(
      context,
      vendor,
      buildIngestPrompt(envelope, { config: brainConfig }),
      environment.contentRoot,
      outputSchemaPath(paths.home, INGEST_VERB),
    );

    const proposal = parseIngestProposal(outcome.payload);
    if (!proposal.ok) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        `the ${vendor.name} agent returned a proposal this product refuses (${proposal.reason})`,
        [],
        RETRY_LATER,
      );
    }

    const validation = await validateProposal(proposal.proposal, {
      captureId: envelope.captureId,
      ingestContract: environment.ingestContract,
      redact: (value: string) => redactText(value, key),
      brain: dependenciesFor(context, paths.brain, environment.config),
    });
    if (!validation.ok) throw refusalFrom(validation.findings, envelope.captureId);

    const plan = planIngestApply(proposal.proposal);
    if (!plan.ok) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        `the proposal for capture ${envelope.captureId} names one file twice (${plan.reason})`,
        [],
        RETRY_LATER,
      );
    }

    const written = plan.writes.map((write) => write.path);
    if (plan.writes.length > 0) {
      /**
       * **`applied` is assigned before the failure is raised, not after the
       * call returns.** The version this replaces assigned it on the line after
       * `applyNotes` — which can only run when nothing threw, and a transaction
       * that wrote its notes and then failed to verify throws with the notes on
       * disk. The capture then went back to `accepted` beside its own output,
       * and every later run refused it.
       */
      const outcome = await applyNotes(context, environment.contentRoot, plan.writes);
      applied = outcome.notes.length === 0 ? null : outcome.notes;
      if (!outcome.ok) throw outcome.reason;
      await reindexVault(context, environment.config, paths, brainConfig);
    }

    await writeCaptureFile(
      context,
      TRANSACTION_KINDS.ingested,
      path,
      renderCaptureFile({ ...envelope, status: "ingested" }),
    );

    return {
      ok: true,
      capture: {
        captureId: envelope.captureId,
        status: "ingested",
        notes: written,
      },
    };
  } catch (error) {
    /**
     * **Rolled back only while a retry could still succeed**, which is up to
     * the moment the notes land. `accepted` means "ingest may run this again",
     * and once `ingest-apply` has finalized that is no longer true: the notes
     * are on disk, and a second run would meet its own output and refuse. A
     * capture left at `staging` says what is actually the case — considered,
     * partly applied, and waiting for a person — which is exactly the inert
     * residual `TRANSACTION_KINDS` describes, reached here by a caught failure
     * rather than by a crash. `reportLines` labels it as such, and
     * `refusedRecovery` emits the line for the state this capture is really in.
     */
    let rolledBack = false;
    if (applied === null && capturePath !== null && staged !== null) {
      try {
        await writeCaptureFile(
          context,
          TRANSACTION_KINDS.rollback,
          capturePath,
          renderCaptureFile(staged),
        );
        rolledBack = true;
      } catch {
        /**
         * The refusal that got us here is the one worth reporting, and a second
         * failure must not replace it. What is left is a capture at `staging`
         * with nothing applied — reported as such rather than as untouched,
         * because the two need different advice.
         */
      }
    }

    return {
      ok: false,
      refusal: {
        captureId,
        code: exitCodeOf(error),
        message:
          error instanceof Error ? error.message : "an unexpected failure occurred",
        paths: error instanceof IngestRefusal ? error.paths : [],
        recovery:
          error instanceof IngestRefusal ? (error.recovery ?? null) : null,
        appliedNotes: applied ?? [],
        leftAt: await leftAtOf(context, key, fileName, capturePath, {
          movedToStaging: capturePath !== null && staged !== null,
          rolledBack,
        }),
      },
    };
  }
}

/* -------------------------------------------------------------------- entry */

/**
 * Diagnostics redacted with the key this command loaded, not with whatever the
 * context closed over — `init` records the rule, and `capture` and `review`
 * follow it at the same point.
 */
function guardsWith(guards: CliGuards, key: Uint8Array): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redactText(text, key).text,
  };
}

function compareIds(left: IngestedCaptureV1, right: IngestedCaptureV1): number {
  return left.captureId < right.captureId ? -1 : 1;
}

/**
 * **The numerically highest exit code among the refusals, not the first one in
 * order** — the exit table is ordered by how much the caller has to care, so
 * `securityRefusal` (5) outranks `capabilityUnavailable` (4), which outranks
 * `decisionRequired` (3), `invalidInput` (2) and `operationalFailure` (1), and
 * `recoveryRequired` (6) outranks all of them because it is the state that
 * blocks every later run. Taking the first would let a security refusal on a
 * capture that happens to sort last be masked by an operational one that sorts
 * first, which is the whole reason this is not `refused[0].code`.
 */
function severestOf(refused: readonly RefusedCaptureV1[]): FailureExitCode {
  return refused.reduce<FailureExitCode>(
    (worst, refusal) => (refusal.code > worst ? refusal.code : worst),
    EXIT_CODES.operationalFailure,
  );
}

interface RunReport {
  readonly order: readonly string[];
  readonly ingested: readonly IngestedCaptureV1[];
  readonly refused: readonly RefusedCaptureV1[];
  /** What `selectCaptures` could not read at all, and why. */
  readonly warnings: readonly string[];
}

function screenNotes(notes: readonly string[]): string {
  return notes
    .map((note) => screenAndCap(note, MAX_PROPOSED_PATH_CHARS))
    .join(" ");
}

/**
 * The whole run, one capture per entry, in the order it was processed — what a
 * machine consumer needs in order to learn what moved when the result cannot
 * carry data. Every capture the invocation touched appears exactly once, so
 * "A ingested and B refused" is readable rather than inferable from B's error
 * alone.
 *
 * **Five outcomes, five labels, because they are five different events.** A
 * capture that ingested; one that refused and wrote nothing, which is unchanged
 * and will be tried again; one that was *partly applied* — its notes are in the
 * vault and it is parked at `staging`, which no later run selects; one *left at
 * staging* with nothing applied, which a failed rollback leaves and which no
 * later run selects either; and one *applied and ingested*, where the ladder
 * finished and something after the last write threw. Labelling any of the last
 * three as merely "refused" would tell a user their vault was untouched when it
 * was not, or that a retry is coming when it is not.
 *
 * **Each capture's own recovery is printed beside it.** Nearly every refusal on
 * this path carries advice specific to the capture — repair *this* frontmatter,
 * move the note already at *this* path — and an earlier version dropped all of
 * them for one run-level string, which made every one unreachable at runtime.
 *
 * **The captures nothing could be done with are carried too.** They cost no
 * agent call and no transaction, so they never enter `order`; before this they
 * rode only on the success path's warnings and vanished the moment any other
 * capture refused, which is precisely the run where a user is already looking.
 */
function reportLines(report: RunReport): readonly string[] {
  const { ingested, order, refused, warnings } = report;
  const byId = new Map(ingested.map((capture) => [capture.captureId, capture]));
  const refusalById = new Map(
    refused.map((refusal) => [refusal.captureId, refusal]),
  );

  const lines = [
    `ingest could not finish ${String(refused.length)} of ${String(order.length)} capture${order.length === 1 ? "" : "s"}; ${String(ingested.length)} reached ingested`,
  ];

  for (const captureId of order) {
    const done = byId.get(captureId);
    if (done !== undefined) {
      const notes = screenNotes(done.notes);
      lines.push(`  ${captureId} ingested${notes === "" ? "" : ` ${notes}`}`);
      continue;
    }

    const refusal = refusalById.get(captureId);
    if (refusal === undefined) continue;
    const partly = refusal.appliedNotes.length > 0;
    /**
     * Three labels, and the third is the one a rollback that itself failed
     * leaves: `staging` with nothing applied. Calling that "refused" would tell
     * a user the next run will try it again, and `selectCaptures` never selects
     * `staging`.
     */
    const label =
      refusal.leftAt === "ingested"
        ? "applied and ingested"
        : partly
          ? "partly applied, left at staging"
          : refusal.leftAt === "staging"
            ? "refused, left at staging"
            : "refused";
    lines.push(`  ${captureId} ${label} (exit ${String(refusal.code)})`);
    if (partly) {
      lines.push(
        `    these notes are already in the vault: ${screenNotes(refusal.appliedNotes)}`,
      );
    }
    for (const line of refusal.message.split("\n")) lines.push(`    ${line}`);
    if (refusal.recovery !== null) {
      for (const line of `recovery: ${refusal.recovery}`.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }

  if (warnings.length > 0) {
    lines.push(
      `${String(warnings.length)} capture${warnings.length === 1 ? "" : "s"} in quarantine could not be read at all:`,
    );
    for (const warning of warnings) lines.push(`  ${warning}`);
  }

  return lines;
}

/**
 * `developer-os ingest`, spec §6.
 *
 * ```text
 * developer-os ingest                      every accepted capture, in captureId order
 * developer-os ingest --limit 1            the first one only
 * developer-os ingest --agent codex        through a named vendor
 * ```
 *
 * **One capture, one agent call, four transactions.** Failure isolates to a
 * single capture rather than poisoning a batch, and that is containment rather
 * than a stop: the failure is recorded against its own capture and every
 * remaining capture is still attempted. The prompt stays bounded by one envelope
 * rather than by however many captures the user accepted.
 *
 * **A capture that could not finish is left in one of three states, and the
 * report distinguishes all three.** One whose notes never landed is rolled back
 * to `accepted` and is retried by the next run; one whose notes are on disk
 * keeps them and stays at `staging`, which `selectCaptures` never selects, so it
 * waits for a person rather than for another run; and one whose rollback itself
 * failed is at `staging` with nothing applied. Promising a retry for all three
 * would misdescribe exactly the cases a user most needs guidance on, which is
 * why `refusedRecovery` emits only the lines this run's outcomes earn.
 *
 * **The run's exit code is the severest refusal, and its message is the whole
 * run** — one line per selected capture, ingested or refused. `CliResult`
 * carries no data on a failure, so a mixed batch that reported only the first
 * error would leave a caller unable to learn that anything was written at all.
 *
 * **The model writes nothing.** It is invoked with zero declared write scopes,
 * inside its vendor's own read-only sandbox, and returns a proposal that nine
 * deterministic validators stand between and the vault. Developer OS performs
 * every write, through `TransactionExecutor`.
 */
export async function runIngest(
  context: CliContext,
  options: IngestOptions,
): Promise<CliResult<IngestResultV1>> {
  let guards = context.guards;

  try {
    /** Before the vault is touched and before a key exists on disk. */
    const requested = resolveAgent(options);
    const limit = options.limit ?? null;

    const config = await readConfiguration(context);
    const paths = runtimePathsFor(context, config);
    await assertVaultPresent(context, paths);

    /**
     * Before the key is loaded, so a machine with no agent CLI writes no
     * secret merely by being asked to ingest.
     */
    const vendor = await selectVendor(context, requested);

    const brainConfig = resolveBrainConfig(config);
    const contentRoot = join(paths.brain, brainConfig.contentRoot);
    const quarantine = await resolveQuarantineRoot(
      context,
      contentRoot,
      join(contentRoot, ...QUARANTINE_SEGMENTS),
      (message, paths_) =>
        new IngestRefusal(
          EXIT_CODES.securityRefusal,
          message,
          paths_,
          "restore the quarantine directory inside the vault's content root; nothing is read or written through a quarantine path that leaves it",
        ),
    );

    const key = loadOrCreateRedactionKey(paths.stateDir);
    guards = guardsWith(context.guards, key);

    const selection = await selectCaptures(context, quarantine, key, limit);
    const environment: IngestEnvironment = {
      config,
      paths,
      brainConfig,
      quarantine,
      contentRoot,
      key,
      vendor,
      /**
       * Resolved once per invocation, here, because resolution is per-install:
       * the declared globs are constants and the strings they become depend on
       * this vault's `config.toml`.
       */
      ingestContract: INGEST_DECLARED_WRITE_SCOPES.map((glob) =>
        resolveScopeGlob(glob, brainConfig),
      ),
    };

    /**
     * **Contained per capture**, which is what "failure isolates to a single
     * capture instead of poisoning a batch" has to mean if it means anything.
     * An uncontained throw would let one capture whose proposal refuses
     * deterministically — a path that already holds a note is the plausible
     * one — sort first again on every later run and block every capture behind
     * it forever, with `--limit` bounding the same blocked head of the same
     * list. Everything is attempted; the refusals are collected and reported
     * together.
     *
     * Every error is contained, not only an `IngestRefusal`: a capture whose
     * own read hit `EACCES` is exactly as much "one capture's problem" as a
     * refused proposal, and it keeps its own exit code through `exitCodeOf`.
     * The containment itself is in `ingestOne`, which answers rather than
     * throws — it is the only place that knows how far the capture got, and
     * therefore the only place that can say whether its notes landed.
     */
    const ingested: IngestedCaptureV1[] = [];
    const refused: RefusedCaptureV1[] = [];
    const order: string[] = [];

    for (const fileName of selection.accepted) {
      order.push(fileName.slice(0, -CAPTURE_FILE_SUFFIX.length));
      const outcome = await ingestOne(context, environment, fileName);
      if (outcome.ok) ingested.push(outcome.capture);
      else refused.push(outcome.refusal);
    }

    const captures = [...ingested, ...selection.unreadable].sort(compareIds);
    if (refused.length > 0) {
      /**
       * Thrown rather than returned, so it takes the redacting path below —
       * `brain lint` does the same, and for the same reason its own docblock
       * gives: `CliResult` cannot carry data on a failure, so a command whose
       * whole job is to say what happened has to say it in the message.
       */
      throw new IngestRefusal(
        severestOf(refused),
        reportLines({
          order,
          ingested,
          refused,
          warnings: selection.warnings,
        }).join("\n"),
        [...new Set(refused.flatMap((refusal) => refusal.paths))],
        refusedRecovery(refused),
      );
    }

    return success(
      {
        schemaVersion: 1,
        agent: vendor.name,
        order,
        captures,
        applied: captures.filter((capture) => capture.status === "ingested"),
      },
      selection.warnings,
    );
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof IngestRefusal ? error.paths : [],
      error instanceof IngestRefusal ? error.recovery : undefined,
    );
  }
}

/**
 * Human-facing rendering. Every path goes through `renderPath` first, which is
 * the terminal half of the screening `renderValidationFinding` does for the
 * machine half.
 */
export function renderIngest(result: IngestResultV1): readonly string[] {
  if (result.captures.length === 0) {
    return ["No captures are waiting to be ingested."];
  }

  return [
    `Ingested ${String(result.applied.length)} capture${result.applied.length === 1 ? "" : "s"} through ${result.agent}:`,
    ...result.captures.map(
      (capture) =>
        /**
         * The id through `renderPath` too, not only the notes. Every id that
         * came through `parseCaptureFile` is provably sixteen hex characters,
         * but an **unreadable** capture's id is sliced out of a file name that
         * nothing checked (`selectCaptures`), so this is the one value on this
         * line that can carry a byte a human never chose.
         */
        `  ${renderPath(capture.captureId)}  ${capture.status}${
          capture.notes.length === 0
            ? ""
            : `  ${capture.notes.map(renderPath).join(" ")}`
        }`,
    ),
  ];
}
