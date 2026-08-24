import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  success,
  TransactionConflictError,
  TransactionPlanError,
  TransactionPreconditionError,
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
import { createRedactor } from "@developer-os/security";
import type { Redactor } from "@developer-os/security";
import { resolveScopeGlob } from "@developer-os/workflow-schema";

import {
  exitCodeOf,
  failureFrom,
  loadOrCreateRedactionKey,
  renderPath,
  resolveContainedRoot,
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
 * **Where a refused capture's *file* was left — not what status it holds.**
 *
 * Two of the three names collide with `CaptureStatus` members and mean something different
 * here, which is why the set is named and frozen rather than written inline: `"staging"` is
 * a capture whose notes may be on disk and which `selectCaptures` never selects, so it
 * waits for a person; `"ingested"` is one whose notes landed *and* whose status reached
 * `ingested` before something later failed.
 *
 * **`"untouched"` is everything else, and it is wider than "will be retried".** `leftAtOf`
 * returns it for *any* on-disk status that is neither of the other two — an `accepted` a
 * rollback restored, which the next run does retry, but also `quarantined`, `rejected` and
 * `failed`, which it does not. A first version of this docblock narrowed it to the retried
 * case; the name means "not left at staging and not left ingested", which is what the
 * run-level recovery in `refusedRecovery` is written against.
 *
 * Published on `CliError.data`, so it is a contract. The array is exported and pinned by
 * `ingest.test.ts` rather than left as a bare union, so a fourth member cannot be added to
 * the type without something failing.
 */
export const CAPTURE_LEFT_AT = Object.freeze([
  "untouched",
  "staging",
  "ingested",
] as const);

export type CaptureLeftAt = (typeof CAPTURE_LEFT_AT)[number];

/**
 * One capture this invocation could not finish, and why.
 *
 * It is reported in **both** the failure's message and its `data` field. It was the
 * message alone until 2026-08-19, because `CliResult` carried no data on a failure —
 * `brain lint` recorded the same constraint and answered it the same way. The Foundation
 * change that constraint asked for landed as Foundation request 3, so `reportFields` now
 * publishes this shape verbatim and the message keeps the prose.
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
   * transaction can prove it wrote them. An empty list does not prove nothing
   * landed: after a post-plan failure a target may be unreadable, replaced or
   * removed before attribution. In that indeterminate case `leftAt` remains
   * `staging` so the command never promises a retry it cannot prove safe.
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
  readonly leftAt: CaptureLeftAt;
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
  "a capture reported as refused wrote nothing and its status is unchanged, so the next run tries it again while it is accepted; to stop retrying one, developer-os review --id <id> --decision reject";

const PARTLY_APPLIED_RECOVERY =
  "a capture reported as partly applied is at staging with the notes named on its line already in the vault, and ingest never selects staging: read those notes, then set the status by hand — ingested if they are what you wanted, or accepted after removing them to try the capture again";

/**
 * The third state: `staging` with no note this process can safely attribute.
 * That includes a failed rollback before apply, but also a post-plan failure
 * whose target became unreadable, was replaced, or disappeared before the
 * attribution scan. Empty attribution is therefore not evidence of an empty
 * vault and must never promise a blind retry.
 */
const STRANDED_RECOVERY =
  "a capture reported as left at staging has an indeterminate apply: no notes could be attributed safely, but that does not prove the apply wrote nothing, and ingest never selects staging: inspect the proposed target paths and any incomplete transaction, then remove any conflicting target before setting its status back to accepted by hand";

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
 * The `reject` half of the first line names the `review` command alone, and used to name a
 * hand edit before it: a capture was rejectable only from `quarantined`, so the status had to
 * go back by hand first. Spec §5.5 gained `accepted → rejected` on 2026-08-20, and every
 * capture these lines describe is at `accepted` — so the verb now works from where the
 * capture actually is, and telling a user to edit their own frontmatter first would send them
 * the long way round. `applyReviewDecision`'s table is still the authority; the table changed.
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
    /**
     * **The same run the message describes, as fields.** Carried on the error rather than
     * assembled at the catch, because only the throw site holds the per-capture outcomes —
     * and it is `undefined` for every other refusal on this path, which is why the slot is
     * optional rather than an empty report (BACKLOG, Foundation request 3).
     *
     * It is not redacted here. `failureFrom` redacts every string leaf of it, for the same
     * reason it has always redacted `message`.
     */
    readonly data?: RunReportV1,
  ) {
    super(message);
    this.name = "IngestRefusal";
  }
}

/**
 * A refusal raised in the transaction's **plan phase**, before any byte moved. The
 * compensating path checks for it by class: nothing was written, so rolling back would write
 * a stale copy over whatever is on disk — which on this path is the hand edit the refusal had
 * just protected.
 *
 * It is a class and not a flag on the message because the message carries the model's own
 * proposed path, and a proposal that spelled the marker phrase made a post-write refusal read
 * as a pre-write one.
 */
class IngestPreconditionRefusal extends IngestRefusal {
  constructor(
    code: FailureExitCode,
    message: string,
    paths: readonly string[] = [],
    recovery?: string,
  ) {
    super(code, message, paths, recovery);
    this.name = "IngestPreconditionRefusal";
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
 * A discovery that *fails* — the adapter cannot find one, or `which` returns a
 * path it will not report — is treated as "not this one" rather than as a
 * run-ending error, so a missing `claude` does not also cost the user their
 * `codex`. With one vendor named explicitly there is nothing to fall through
 * to, and that case is the exit-4 message below.
 *
 * **A binary the adapter will not vouch for is the opposite, and ends the run
 * at exit 5.** This paragraph said the reverse until 2026-08-17, when the check
 * `types.ts` demands was finally paid: `assertTrustedExecutable` is called
 * *outside* the `catch`, deliberately, because inside it a refusal would be
 * swallowed into "not installed" and fall through to the other vendor — which
 * is the reverse of refusing. This command hands the binary the user's captured
 * observation and read access to the whole vault (BACKLOG NEW-15).
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
    if (executable === null) continue;

    /**
     * **Outside the `catch` above, deliberately** (BACKLOG NEW-15). That `catch` maps any
     * throw to "not installed", so a refusal raised inside it would become a silent
     * fall-through to the other vendor — the opposite of refusing. This command's contract
     * is to refuse: it hands the binary the user's captured observations and read access
     * to the whole vault, on the strength of a name match, so an untrusted one stops the
     * run rather than degrading it.
     */
    await context.platform.assertTrustedExecutable(executable);
    return { name, executable };
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
  redact: Redactor,
  limit: number | null,
): Promise<Selection> {
  const accepted: string[] = [];
  const unreadable: IngestedCaptureV1[] = [];
  const warnings: string[] = [];

  for (const fileName of await captureFileNames(context, quarantine)) {
    const text = await context.guards.readText(join(quarantine, fileName));
    const outcome = parseCaptureFile(fileName, text, redact);
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
 * **`quarantine` is the canonical root `resolveContainedRoot` returned**, which
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
 * **The lost-update window is the one `review.ts` describes, and the *first* of the three
 * writes each capture takes now closes it** — the staging write supplies the digest of the
 * bytes this run read, so a hand edit landing between that read and the transaction is
 * refused rather than overwritten. It is the first write **per capture**, not per run:
 * `ingestOne` runs once for each, so a three-capture run has three such writes.
 *
 * **The two later writes still overwrite, and the widest window in this command is one of
 * them.** The `ingested` write re-renders the pre-agent envelope over the whole file after
 * the vendor call — the longest read-to-write gap the product has, minutes rather than
 * milliseconds — and a hand edit made during it is discarded silently. An earlier version of
 * this paragraph called that structurally impossible to pin because "there is no caller read"
 * — which is wrong: this run holds the exact bytes it wrote at staging and could pin their
 * digest. Whether to is a decision, and it is registered as **NEW-40** rather than described
 * as closed.
 */
async function writeCaptureFile(
  context: CliContext,
  kind: string,
  target: string,
  contents: string,
  /**
   * The digest of the bytes this run read, when it has one. The first write of a run does —
   * it reads the capture immediately above — and the later ones do not: they follow a write
   * this run itself made, so there is no caller read to pin, and the executor's own snapshot
   * is the right precondition for them.
   */
  expectedBeforeHash?: string,
): Promise<void> {
  try {
    await context.executor.execute({
      kind,
      mutations: [
        {
          targetPath: target,
          operation: "replace",
          content: new TextEncoder().encode(contents),
          ...(expectedBeforeHash === undefined ? {} : { expectedBeforeHash }),
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof TransactionConflictError)) throw error;
    /**
     * **A precondition refusal says more, because it can.** It is raised in the plan phase,
     * so nothing was written and the file the user is looking at is the one they edited. The
     * other conflict sites cannot promise that — there are seven, and which one ran is not
     * something this catch can tell — which is why the general message
     * below says nothing about the file's contents.
     */
    if (error instanceof TransactionPreconditionError) {
      throw new IngestPreconditionRefusal(
        exitCodeOf(error),
        "the capture changed on disk before ingest moved it, so nothing was written and your edit is intact",
        [target],
        "run developer-os ingest again, which reads the newer file",
      );
    }
    throw new IngestRefusal(
      exitCodeOf(error),
      "the capture changed on disk while this ingest was running, so its status did not move",
      [target],
      "if developer-os status reports an incomplete transaction, resolve it with developer-os repair first; otherwise run developer-os ingest again, which reads the newer file",
    );
  }
}

/**
 * Whether a refusal came from the plan phase, where nothing has been written yet.
 *
 * **Carried as a class, because the first version matched on the message text** — and that
 * message interpolates the model's proposed note path. A proposal naming
 * `before ingest moved it.md` made a refusal raised *after* the staging bytes landed look
 * like one raised before them, so the rollback was skipped and the capture stranded at
 * `staging`, which `selectCaptures` never selects again. The steering string arrives through
 * the capture body and the prompt: the untrusted path this command's threat model is written
 * against. Control flow must not be decidable by anything a model can spell.
 */
function isPreconditionRefusal(error: unknown): boolean {
  return error instanceof IngestPreconditionRefusal;
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
   * and retries forever. The detail names the **field**, never the value: each
   * screen composes its message from the caller's own field label, so nothing
   * model-chosen is interpolated here.
   *
   * **As of 2026-08-17 this branch is unreachable from `ingest`, and it is kept
   * as defence in depth rather than because a user can meet it.** Closing
   * BACKLOG NEW-12 left no argument on this path that a screen can refuse, and
   * the disposal has to cover every source listed below, not the three it once named:
   *
   * - the **prompt** is prefixed with a Markdown heading, so the dash rule
   *   cannot fire on it;
   * - the **working root** and the **output schema path** are assembled from
   *   validated absolute paths and now take the derived screen;
   * - the **write scope** list is empty, because spec §3.3 grants the agent
   *   zero declared write scopes;
   * - the **turn bound** is `DEFAULT_MAX_TURNS`, a compile-time constant well
   *   inside the 1–50 window `invokeClaude` enforces, so it cannot be refused
   *   by a value this command chooses;
   * - the **tool list** is `CLAUDE_READ_ONLY_TOOLS`, which `invokeClaude` screens
   *   per entry — measured, each of `Read`, `Grep` and `Glob` passes. It is a
   *   fifth source and an earlier version of this list said "all four", having
   *   been corrected once already for the same class of omission.
   *
   * The user described above no longer exists — but the first caller to pass a
   * real write scope brings them back, so the interpolation stays. **Nothing
   * covers it end-to-end any more**, which is recorded at the inverted case in
   * `ingest.test.ts` and as a BACKLOG §1 row.
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
      : ` ${renderPath(finding.path)}`;
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
          : [finding.path],
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
  redact: Redactor,
): Promise<CaptureStatus | null> {
  try {
    const parsed = parseCaptureFile(
      fileName,
      await context.guards.readText(path),
      redact,
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
 * and what decides the exit code, and *what can be attributed* is `notes`.
 * Every post-plan failure is returned, including an empty attribution: once
 * execution began, an unreadable, replaced or removed target makes absence of
 * matching bytes inconclusive. Only `TransactionPlanError` proves the apply
 * never began and still throws directly.
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
  /** Each mutation's canonical target and desired digest beside its note name. */
  const planned: {
    readonly path: string;
    readonly target: string;
    readonly expectedHash: string;
  }[] = [];

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
        [write.path],
        "ingest will refuse this capture again until something changes: move or delete the existing note if the proposal should replace it, or developer-os review --id <id> --decision reject",
      );
    }

    mutations.push({
      targetPath: canonical,
      operation: "create",
      content: write.bytes,
    });
    planned.push({
      path: write.path,
      target: canonical,
      expectedHash: createHash("sha256").update(write.bytes).digest("hex"),
    });
  }

  /**
   * **A throw out of `execute` does not mean "wrote nothing".** `apply()` writes
   * every mutation and transitions the journal to `applied` before
   * `verifyDesired` runs, and that verify raises `TransactionConflictError`
   * (`packages/core/src/transactions/executor.ts:835-853`) with the files
   * already on disk; a crash lands in the same place. Reporting "nothing was
   * written" there rolls the capture back to `accepted`, and the next run then
   * meets its own output at a path `create` refuses — permanently, under advice
   * promising a retry.
   *
   * **Which notes landed is asked of the filesystem rather than inferred from
   * the journal**, because the journal is not in hand: `execute` throws instead
   * of returning it, and its id is not recoverable from the error. Existence is
   * not provenance: another writer can occupy a planned target in either race
   * window. A target counts only when a guarded read hashes to the desired bytes
   * retained beside it. A mismatch, missing target or failed read is not proof
   * that nothing landed — another writer may have replaced or removed bytes
   * after apply. `TransactionPlanError` is stronger still: it is raised
   * before the executor applies any mutation, so none of its targets belong to
   * this ingest even when one now exists. Every other failure returns an answer,
   * including an empty one, so the caller preserves `staging` when provenance is
   * indeterminate.
   */
  try {
    await context.executor.execute({
      kind: TRANSACTION_KINDS.apply,
      mutations,
    });
  } catch (error) {
    if (error instanceof TransactionPlanError) throw error;
    const landed: string[] = [];
    for (const entry of planned) {
      let observedHash: string;
      try {
        observedHash = await context.guards.readText(entry.target, async (handle) => {
          const bytes = await handle.readFile();
          return createHash("sha256").update(bytes).digest("hex");
        });
      } catch {
        continue;
      }
      if (observedHash === entry.expectedHash) landed.push(entry.path);
    }
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
    contentRoot: brainConfig.contentRoot,
    indexesDir: join(brainConfig.contentRoot, brainConfig.indexesDir),
    files: (await service.reindex()).files,
    kind: TRANSACTION_KINDS.reindex,
    refuse: (message, paths_) =>
      new IngestRefusal(EXIT_CODES.operationalFailure, message, paths_),
    refuseIndexEscape: (message, paths_) =>
      new IngestRefusal(
        EXIT_CODES.securityRefusal,
        message,
        paths_,
        "restore the index directory inside the vault's content root; nothing is read or written through an index path that leaves it",
      ),
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
  redact: Redactor,
  fileName: string,
  capturePath: string | null,
  progress: { readonly movedToStaging: boolean; readonly rolledBack: boolean },
): Promise<RefusedCaptureV1["leftAt"]> {
  const status =
    capturePath === null
      ? null
      : await statusOnDisk(context, capturePath, fileName, redact);

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
  /**
   * Built once at the command entry, where the key and the configuration are both in
   * scope. Carried on the environment rather than rebuilt per capture so spec §8.2's
   * user patterns cannot reach one code path and miss another (BACKLOG NEW-16).
   */
  readonly redact: Redactor;
  readonly quarantine: string;
  readonly contentRoot: string;
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
 * **Nothing that fails here produces `failed`.** `failed` describes a capture
 * whose own envelope is unreadable, and collapsing it with a refusal would make
 * a transient model failure look like data loss — the capture is fine and the
 * proposal was not.
 *
 * - **A failure proved to precede apply execution** — including a
 *   `TransactionPlanError` — rolls the capture back to `accepted`; no target
 *   from this proposal could have changed, so the next run is safe.
 * - **Every other throw from apply execution** leaves the capture at `staging`,
 *   which `selectCaptures` never selects. Matching target bytes are reported as
 *   applied notes, but an empty attribution is not proof of an empty vault: a
 *   target may have become unreadable, been replaced or disappeared after a
 *   mutation. Preserving `staging` never promises an automatic retry the caller
 *   cannot prove safe.
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
  const { brainConfig, paths, quarantine, redact, vendor } = environment;
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
  /**
   * Null means apply execution never began and rollback is still safe. Non-null
   * means apply either succeeded or failed after planning began; the empty list
   * is the indeterminate failure sentinel that blocks an unsafe rollback when
   * no target bytes could be attributed.
   */
  let applied: readonly string[] | null = null;

  try {
    const path = await resolveCapturePath(context, quarantine, fileName);
    capturePath = path;

    let asRead = "";
    const text = await context.guards.readText(path, async (handle) => {
      const bytes = await handle.readFile();
      asRead = createHash("sha256").update(bytes).digest("hex");
      return bytes.toString("utf8");
    });
    const parsed = parseCaptureFile(fileName, text, redact);
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
      asRead,
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
      redact,
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
      if (!outcome.ok) {
        /** Empty is still non-null: attribution failed after planning began. */
        applied = outcome.notes;
        throw outcome.reason;
      }
      applied = outcome.notes.length === 0 ? null : outcome.notes;
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
    /**
     * **A precondition refusal is not compensated, because nothing was written.** `staged` is
     * set before the staging transaction — it has to be, since an interruption *after* the
     * bytes land still needs rolling back — so it cannot distinguish a write that never
     * happened. `TransactionPreconditionError` can: it is raised in the plan phase, before
     * anything is staged. Without this the rollback wrote the pre-read envelope over exactly
     * the hand edit the refusal had just protected, two lines after protecting it.
     */
    const untouched = isPreconditionRefusal(error);
    if (!untouched && applied === null && capturePath !== null && staged !== null) {
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
        leftAt: await leftAtOf(context, redact, fileName, capturePath, {
          /**
       * `untouched` here for the same reason the rollback takes it: a plan-phase refusal
       * moved nothing, so reporting `staging` would print recovery telling the user to set a
       * status back by hand for a file this run never wrote. `leftAtOf` reads the status from
       * disk and falls back to this only when the file is unparseable — which a hand edit
       * that breaks frontmatter *and* lands in the window is, so the two conditions meet.
       */
      movedToStaging: !untouched && capturePath !== null && staged !== null,
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
function guardsWith(guards: CliGuards, redact: Redactor): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redact(text).text,
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

/**
 * **Rendered for a terminal, not repaired.** This used `screenAndCap`, which collapses
 * `/\s+/` and trims — so the human half of a refusal named `DEV/two spaces.md` for a file on
 * disk called `DEV/two  spaces.md`, and the partly-applied line said that path was "already
 * in the vault". `renderPath` is the boundary this repository already nominates for paths:
 * it substitutes the characters that reorder a line and truncates, and it leaves whitespace
 * alone. The rule is `threat-model.md`'s — byte-exact everywhere, screened at the terminal —
 * and a collapse is neither.
 */
function screenNotes(notes: readonly string[]): string {
  return notes.map((note) => renderPath(note)).join(" ");
}

/**
 * **What `reportLines` says, as fields a consumer can read.**
 *
 * The prose and the fields are built from the same `RunReport` and neither is derived from
 * the other: parsing the lines back would make the message a wire format, and the message
 * exists to be read by a person. Both are emitted; they are two renderings of one run.
 *
 * **Every capture in `order` appears in exactly one of `ingested` or `refused`**, which is
 * the property the message has always had and the one a script most needs.
 *
 * **`unreadable` is structured, and it was prose for one review round.** These are the
 * captures whose own envelope could not be read, so they cost no agent call and never enter
 * `order`. The first version published `RunReport.warnings` — English sentences — which
 * reproduced, inside the new contract, the exact defect the contract exists to close. The
 * same captures are already structured as `selection.unreadable` and in scope at the throw
 * site; that is what is published now. Same element type as `IngestResultV1.captures`, not
 * the same set — the success arm folds unreadable captures in with the ingested ones and
 * this keeps them apart, because on a failing run which is which is the question.
 *
 * **Every field here is published byte-exact**, including an unreadable capture's
 * `captureId`, which is the one that can carry a byte a human never chose. Screening it and
 * the note paths was tried and reverted: the screen used collapses whitespace, so it
 * corrupted ordinary filenames while the success arm published the same values raw. The rule
 * is `threat-model.md`'s — byte-exact everywhere, rendered at the terminal — and `screened`
 * below carries the account of what that leaves open.
 *
 * **`agent` and `status` are carried for the same reason the success arm carries them.**
 * A run that failed is no less in need of attribution than one that succeeded, and the
 * first version dropped both — which would have made the two arms disagree about what a
 * capture is.
 *
 * `schemaVersion` and `export` because this is published in `--json`: a `schemaVersion: 1`
 * on a shape no consumer can name is not a contract, and the success arm's
 * `IngestResultV1` is exported and imported by name from outside this package.
 */
export interface RunReportV1 {
  readonly schemaVersion: 1;
  readonly agent: AgentName;
  readonly order: readonly string[];
  readonly ingested: readonly IngestedCaptureV1[];
  readonly refused: readonly {
    readonly captureId: string;
    readonly code: FailureExitCode;
    readonly leftAt: CaptureLeftAt;
    readonly message: string;
    readonly recovery: string | null;
    readonly appliedNotes: readonly string[];
  }[];
  readonly unreadable: readonly IngestedCaptureV1[];
}

/**
 * **The `captureId` of an unreadable capture is the value here that can carry a byte a
 * human never chose**, and it is published byte-exact — deliberately, after a screen was
 * tried here and reverted.
 *
 * `renderIngest` puts it through `renderPath` for the *terminal*, because every id that came
 * through `parseCaptureFile` is provably sixteen hex characters while an unreadable
 * capture's is sliced out of a file name nothing checked. The `--json` half got
 * `screenAndCap` to match, and that was wrong twice: `screenAndCap` collapses whitespace, so
 * it renamed ordinary files; and it closed nothing, because the *success* arm published the
 * same filename raw throughout. `threat-model.md`'s rule is byte-exact everywhere, rendered
 * at the terminal, and the residue — `JSON.stringify` escaping `\p{Cc}` and not `\p{Cf}` —
 * is NEW-38.
 *
 * **Note paths are not screened, and screening them was the defect.** A proposed path
 * carrying `\p{Cc}` or `\p{Cf}`, or exceeding the cap, is refused by `proposal.ts` before it
 * can become a note — so the screen closed nothing, and what it did do was collapse `/\s+/`
 * and trim, publishing `DEV/two spaces.md` for a vault file called `DEV/two  spaces.md`.
 * Two successive versions of this paragraph argued it was belt-and-braces from the half that
 * was redundant, and never addressed the half that fired.
 *
 * What makes `reportLines` and `reportFields` two renderings of one run is that they carry
 * the same bytes, not that they apply the same transformation: the message renders through
 * `renderPath` because a terminal must not be reorderable, and the report carries the path a
 * consumer has to open.
 *
 * `redactDeep` is not a substitute for either: it redacts secrets, not format characters.
 *
 * **What is still unscreened, so a green gate is not over-read.** `selection.warnings` are
 * English sentences that embed the raw quarantine file name, and they ship verbatim in
 * `reportLines`' message *and* on the success arm's `warnings`; `RunReportV1.refused[]`
 * carries `message` and `recovery` as the refusal produced them. None of those is a *new*
 * exposure — every one of them already reached the user through the failure message this
 * field sits beside — but the enumeration is the point: a first version of this paragraph
 * named only the warnings and read as exhaustive. `RunReportV1` publishes `unreadable`
 * structurally rather than repeating the warning sentences, which narrows the exposure
 * without closing it.
 *
 * **Every field is copied and published as it stands; nothing here transforms a value.**
 * Two helpers used to — `screened` on the capture ids and `carriedNotes` on the note paths —
 * and both are gone, along with the `screenAndCap` import this command no longer has. They
 * ran `screenAndCap`, which strips `\p{Cc}`/`\p{Cf}`, **collapses `/\s+/` and trims**. The
 * strip was redundant: `proposal.ts` refuses those characters in a note path, and the
 * *success* arm published the same capture ids raw the whole time, so the screen closed
 * nothing it was added to close. The collapse was destructive: `cap  two.md` published as
 * `cap two`, `DEV/two  spaces.md` as `DEV/two spaces.md` — names of files that do not exist.
 *
 * Three successive reviews each removed it from one rendering and left another, so for a
 * while the corrupted one was in turn `data`, then the terminal, then `error.paths`. The rule
 * that ends it is `threat-model.md`'s and predates all of this: **paths are byte-exact
 * everywhere and rendered at the terminal instead**, through `renderPath`, which substitutes
 * reordering characters without touching whitespace. Redaction is the one transformation that
 * still applies to every published field, and `failureFrom` is where it happens.
 */
function reportFields(
  report: RunReport,
  agent: AgentName,
  unreadable: readonly IngestedCaptureV1[],
): RunReportV1 {
  return {
    schemaVersion: 1,
    agent,
    order: report.order,
    ingested: [...report.ingested],
    refused: report.refused.map((refusal) => ({
      captureId: refusal.captureId,
      code: refusal.code,
      leftAt: refusal.leftAt,
      message: refusal.message,
      recovery: refusal.recovery,
      appliedNotes: [...refusal.appliedNotes],
    })),
    unreadable: [...unreadable],
  };
}

/**
 * The whole run, one capture per entry, in the order it was processed — what a
 * person needs in order to read what moved. Every capture the invocation
 * touched appears exactly once, so
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
 * run** — one line per selected capture, ingested or refused. A mixed batch that reported
 * only the first error would leave a caller unable to learn that anything was written at
 * all.
 *
 * **Since 2026-08-19 the same run is also published as fields**, on `CliError.data`
 * (Foundation request 3). The message used to be the only channel because `CliResult`
 * carried no data on a failure, so a consumer parsed prose; both are emitted now, built
 * from one `RunReport` and neither derived from the other — the message is what a person
 * reads, the fields are what a script reads, and parsing the message back would make it a
 * wire format it was never designed to be.
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
    const quarantine = await resolveContainedRoot(
      context,
      contentRoot,
      join(contentRoot, ...QUARANTINE_SEGMENTS),
      "the quarantine directory resolves outside the content root",
      (message, paths_) =>
        new IngestRefusal(
          EXIT_CODES.securityRefusal,
          message,
          paths_,
          "restore the quarantine directory inside the vault's content root; nothing is read or written through a quarantine path that leaves it",
        ),
    );

    const key = loadOrCreateRedactionKey(paths.stateDir);
    /**
     * Built once, where the key and the configuration are both in scope, and carried on
     * the environment below. Spec §8.2's user patterns must reach the *prompt* above all:
     * `buildIngestPrompt` puts a capture body in front of a vendor model, and a client
     * name no generic class catches is exactly what this table exists to keep out of it
     * (BACKLOG NEW-16).
     */
    const redact = createRedactor(key, {
      userPatterns: config.redaction?.patterns ?? [],
    });
    guards = guardsWith(context.guards, redact);

    const selection = await selectCaptures(context, quarantine, redact, limit);
    const environment: IngestEnvironment = {
      config,
      paths,
      brainConfig,
      quarantine,
      contentRoot,
      redact,
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
       * Thrown rather than returned, so it takes the redacting path below — which is
       * now also what redacts `data`'s string leaves, so the structured half gets the
       * guarantee the message always had without this site having to remember it.
       */
      const report: RunReport = {
        order,
        ingested,
        refused,
        warnings: selection.warnings,
      };
      throw new IngestRefusal(
        severestOf(refused),
        reportLines(report).join("\n"),
        [...new Set(refused.flatMap((refusal) => refusal.paths))],
        refusedRecovery(refused),
        reportFields(report, vendor.name, selection.unreadable),
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
      error instanceof IngestRefusal ? error.data : undefined,
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
