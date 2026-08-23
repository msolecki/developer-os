import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  success,
  TransactionConflictError,
  TransactionPreconditionError,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  RuntimePaths,
} from "@developer-os/core";
import {
  applyReviewDecision,
  CAPTURE_STATUSES,
  decisionsFrom,
  isReviewDecision,
  parseCaptureFile,
  renderCaptureFile,
  resolveBrainConfig,
  REVIEW_DECISIONS,
} from "@developer-os/brain";
import type { CaptureStatus, ReviewDecision } from "@developer-os/brain";
import { createRedactor } from "@developer-os/security";
import type { Redactor } from "@developer-os/security";

import {
  exitCodeOf,
  failureFrom,
  loadOrCreateRedactionKey,
  resolveContainedRoot,
  runtimePathsFor,
} from "../context.js";
import type { CliContext, CliGuards } from "../context.js";
import { isDirectory, readConfigFile } from "./doctor.js";

/**
 * What `--json` publishes: an id and a status per capture, and nothing of the
 * observation itself. A reviewer reads the content in their own vault, in
 * Obsidian or any editor; putting it on a machine channel would copy an
 * unreviewed observation — the thing most likely to still hold something its
 * author did not mean to share — out of the one place it is meant to live.
 */
export interface ReviewedCaptureV1 {
  readonly captureId: string;
  readonly status: CaptureStatus;
}

export interface ReviewResultV1 {
  readonly schemaVersion: 1;
  readonly captures: readonly ReviewedCaptureV1[];
  /**
   * How many captures this invocation decided on: `0` for a listing, `1` for a
   * decision. `review` takes one `--id`, so it is never more.
   */
  readonly reviewed: number;
}

export interface ReviewOptions {
  /** `--id`. Absent means "list"; present without `--decision` is refused. */
  readonly id?: string;
  /** `--decision`. Absent means "list"; present without `--id` is refused. */
  readonly decision?: string;
  /**
   * `--status`. Which status the listing shows; absent means `quarantined`.
   *
   * **It exists because the transition spec §5.5 added had no route to it**
   * (`BACKLOG.md` §1 NEW-41). `accepted → rejected` is taken by
   * `review --id <id> --decision reject`, and its headline case is a user who
   * accepted a capture and changed their mind — who could not find the id,
   * because the listing showed `quarantined` alone. They had the verb and no way
   * to reach it.
   *
   * **The default is unchanged rather than widened**, which is the narrower of
   * the two answers the row left open: a bare `review` is still the pending
   * queue, so nothing that reads it starts seeing decided captures.
   *
   * **A display decision was taken anyway**, and an earlier version of this
   * paragraph denied it. The listing has to say what it is showing, so
   * `renderReview` names the requested status in both its heading and its empty
   * line. What widening would additionally require is a listing that says which
   * status each *row* is — that one is still untaken.
   */
  readonly status?: string;
}

/** Vault-relative, under the configured content root. Spec §3.4. */
const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;

const CAPTURE_FILE_SUFFIX = ".md";

/**
 * What `buildCapture` writes and what `parseCaptureFile` compares a filename
 * against: the first 16 characters of a lowercase hex digest. `--id` is checked
 * against it **before** it is joined to a path, because the id is the only
 * user-supplied component of the file this command opens and writes.
 */
const CAPTURE_ID = /^[0-9a-f]{16}$/u;

const REVIEW_TRANSACTION = "review";

const NOT_INITIALIZED = "developer-os init";

const RESTORE_THE_ID =
  "restore the captureId in the file's frontmatter to match its filename, or reject the capture and take a fresh one";

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class ReviewRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "ReviewRefusal";
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

interface ReviewTarget {
  readonly id: string;
  readonly decision: ReviewDecision;
}

/**
 * The invocation, decided before anything is read and before a key is loaded,
 * so an invalid one touches no vault and creates no secret.
 *
 * `null` is a listing. **`--decision` without `--id` is invalid input, not
 * "apply to all"** (spec §5.6): a verb that silently accepted every quarantined
 * capture because the user forgot an argument would be the most expensive
 * possible reading of a typo. The mirror case is refused for the same reason
 * rather than guessed at — `--id` alone names a capture and no decision about
 * it, and this command does not invent one.
 */
function resolveTarget(options: ReviewOptions): ReviewTarget | null {
  const { id, decision } = options;
  if (id === undefined && decision === undefined) return null;

  if (decision === undefined) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      "--id names one capture and no decision about it; pass --decision as well",
      [],
      `developer-os review --id <id> --decision ${REVIEW_DECISIONS.join("|")}`,
    );
  }
  if (id === undefined) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      "--decision applies to one capture; pass --id to name it. developer-os review, with no arguments, lists what is waiting",
    );
  }
  if (!isReviewDecision(decision)) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      `a decision is one of ${REVIEW_DECISIONS.join(", ")}`,
    );
  }
  if (!CAPTURE_ID.test(id)) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      "a capture id is 16 lowercase hexadecimal characters, which is the name of its file",
    );
  }
  return { id, decision };
}

async function readConfiguration(
  context: CliContext,
): Promise<DeveloperOsConfigV1> {
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) {
    throw new ReviewRefusal(
      EXIT_CODES.operationalFailure,
      "Developer OS is not initialized, so there is no vault to review",
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
    throw new ReviewRefusal(
      EXIT_CODES.operationalFailure,
      "the vault does not exist, so there are no captures to review",
      [paths.brain],
      NOT_INITIALIZED,
    );
  }
  if (!directory) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      "the vault path exists and is not a directory",
      [paths.brain],
    );
  }
}

/**
 * The capture files in quarantine, by name, sorted. An absent directory is an
 * empty review rather than a failure: `init` creates it, and a user who removed
 * it has no captures waiting, which is an answer rather than an error.
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

interface Listing {
  readonly captures: readonly ReviewedCaptureV1[];
  readonly warnings: readonly string[];
}

/**
 * Which status a listing shows, defaulting to `quarantined`.
 *
 * **Validated against `CAPTURE_STATUSES` rather than against a list written
 * here**, so a seventh status cannot become listable by being added in one place
 * and unlistable by being forgotten in another. An unknown value is a refusal
 * naming what is legal — the alternative, silently listing nothing, is
 * indistinguishable from an empty vault.
 */
function listedStatus(options: ReviewOptions): CaptureStatus {
  const requested = options.status;
  if (requested === undefined) return "quarantined";
  if (options.id !== undefined || options.decision !== undefined) {
    /**
     * **A flag that does nothing is refused rather than ignored**, which is the
     * convention `resolveTarget` already sets for `--id` without `--decision`.
     * `--status` selects what a *listing* shows; a decision names one capture by
     * id, so the two together describe two different commands. Accepting it
     * silently would also leave the value unvalidated, since the decision path
     * never reaches the listing.
     */
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      "--status chooses what a listing shows and means nothing beside --id or --decision",
      [],
      "developer-os review --status <status>, or developer-os review --id <id> --decision <d>",
    );
  }
  const known = CAPTURE_STATUSES.find((status) => status === requested);
  if (known === undefined) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      `${requested} is not a capture status, so there is nothing to list under it`,
      [],
      `developer-os review --status ${CAPTURE_STATUSES.join("|")}`,
    );
  }
  return known;
}

/**
 * Every capture at one status, in id order, and nothing else.
 *
 * **A capture this cannot parse is `failed`** (spec §5.5) — a truncated write,
 * or a hand edit that broke the frontmatter — and it is reported as a warning
 * rather than as a row, whatever status was asked for: the parse failed, so
 * there is no status to compare. It is warned about rather than passed over in
 * silence, because a user with a broken file in their vault needs to be told
 * which file and why, and nothing else this command could do for it would be
 * safe. The reason travels; the file's contents never do.
 *
 * **`--status failed` therefore lists nothing and warns about everything**, which
 * is not a gap: `failed` is a description of a file this command could not read,
 * not a value it ever finds in one it could.
 *
 * A read that *refuses* — a symlink where a capture should be, a path the
 * protected-path policy will not open — is left to propagate. Reporting a
 * security refusal as a line in a listing would file it where nobody looks.
 */
async function listByStatus(
  context: CliContext,
  quarantine: string,
  redact: Redactor,
  status: CaptureStatus,
): Promise<Listing> {
  const captures: ReviewedCaptureV1[] = [];
  const warnings: string[] = [];

  for (const fileName of await captureFileNames(context, quarantine)) {
    const text = await context.guards.readText(join(quarantine, fileName));
    const outcome = parseCaptureFile(fileName, text, redact);
    if (!outcome.ok) {
      warnings.push(
        `${fileName} is not a readable capture (${outcome.reason}), so it is failed rather than waiting for review`,
      );
      continue;
    }
    if (outcome.envelope.status !== status) continue;
    captures.push({
      captureId: outcome.envelope.captureId,
      status: outcome.envelope.status,
    });
  }

  return { captures, warnings };
}

/**
 * The capture's own path, canonicalized and proven to still be inside
 * quarantine.
 *
 * The id is already known to be 16 hex characters, so this cannot be reached by
 * a traversal in the argument; what it does catch is a *symlinked* component
 * resolving out of the vault — a directory the user replaced, or a quarantine
 * path reached through one. Two independent checks over one value, deliberately:
 * the shape check makes the path unbuildable and this one makes the resolved
 * path unusable, and a mistake in either alone is not enough.
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
    throw new ReviewRefusal(
      EXIT_CODES.securityRefusal,
      "the capture resolves outside the quarantine directory",
      [target],
    );
  }
  return canonicalTarget;
}

async function readCapture(
  context: CliContext,
  target: string,
  id: string,
  /**
   * Called with the file's own bytes during the same open, so a caller can hash what it read
   * rather than a re-encode of what it decoded. Decoding is lossy and re-encoding does not
   * recover the original, which made the first precondition refuse for ever on any capture
   * holding a byte that is not valid UTF-8.
   */
  observe?: (bytes: Uint8Array) => void,
): Promise<string> {
  try {
    await context.fs.lstat(target);
  } catch (error) {
    if (!isMissingEntry(error)) throw error;
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      `no capture is filed under ${id}`,
      [target],
      "developer-os review lists the captures waiting for a decision",
    );
  }
  return context.guards.readText(target, async (handle) => {
    const bytes = await handle.readFile();
    observe?.(bytes);
    return bytes.toString("utf8");
  });
}

/**
 * One `replace` mutation, through Foundation's `TransactionExecutor`. A review
 * is not a special case that may rewrite a vault file directly, which is what
 * makes "atomic quarantine writes" true rather than aspirational.
 *
 * **`validateChangePlan` is not on this path, and its absence is a decision.**
 * That layer decides ownership from the manifest, and a capture is deliberately
 * absent from it: a capture is the user's own content, editable in Obsidian by
 * design (spec §3.4), so recording it as a managed artifact would report every
 * legitimate edit as drift. What stands in for it is `resolveCapturePath` — the
 * writable-path guard plus a canonical containment check against the quarantine
 * directory — which is a narrower constraint than ownership, though not the
 * same one.
 *
 * **There was a lost-update window between the read and this call, and on this
 * path it was not benign.** This command reads the file, re-redacts, re-hashes
 * and renders, and only then asks for the write; a hand edit landing in between
 * was overwritten by content derived from the older read. What was lost is the
 * user's own hand edit — silently, by the verb whose whole purpose is to bring
 * a hand edit back under the product's guarantees. Unlike `capture`'s residual
 * race, that is not idempotent: a capture collision writes the same observation
 * twice because the id is the content hash, while here the two writers hold
 * different content. **That window is closed as of 2026-08-20**, by the Foundation change
 * Track R entry R2 Task 8 built: `PlannedFileMutation.expectedBeforeHash` lets this
 * command hand the executor the digest of the bytes it read, and the executor refuses in the
 * plan phase rather than snapshotting whatever is there when `execute()` runs. Reading as
 * late as possible still narrows it; it is no longer the only defence.
 *
 * **A conflict is translated rather than leaked, and keeps the class's own exit
 * code.** When the executor finds the file changed under it, it refuses — the
 * good outcome, and the user meets it as a sentence about their own capture
 * rather than as a class name. `exitCodeOf` propagates the code
 * `TransactionConflictError` declares rather than this command choosing one: a
 * command inventing its own code for a shared error class is how a stable exit
 * table stops being one.
 *
 * **The message promises nothing about the file**, because the refusal can
 * arrive from before or after the bytes were written and cannot tell which. All
 * it claims is that the decision did not complete. **The recovery is ordered**:
 * `repair` first, because a second review moves the file the incomplete
 * transaction is still holding.
 *
 * The conflict behaviour itself — where it is raised, and in which phases — is
 * defined in `packages/core/src/transactions/executor.ts` and is not restated
 * here.
 */
async function writeCapture(
  context: CliContext,
  target: string,
  contents: string,
  asRead: string,
): Promise<void> {
  try {
    await context.executor.execute({
      kind: REVIEW_TRANSACTION,
      mutations: [
        {
          targetPath: target,
          operation: "replace",
          content: new TextEncoder().encode(contents),
          /**
           * **The bytes this command actually read**, so the executor refuses rather than
           * overwriting a change it never saw. It snapshots the target when `execute()`
           * runs, and everything between the read at `decide` and that snapshot was
           * invisible — which on this path is the user's own hand edit, discarded by the one
           * verb that exists to bring a hand edit under this product's guarantees.
           *
           * **The bytes, never a re-encode of the text.** The first version hashed
           * `encode(readText(...))` and argued that a capture which did not round-trip would
           * already have been refused as unreadable. That is false: `parseCaptureFile`
           * validates frontmatter and hands the body through as text. Node's `utf8` decode is
           * lossy — one cp1252 byte becomes U+FFFD, and `0x93` re-encodes to `EF BF BD` — so
           * a capture holding a single such byte hashed to something the file never held and
           * refused *every* time, permanently, with a message saying it had changed on disk
           * and a recovery that could never work. It fired on hand-edited files, which is the
           * population this verb exists for.
           */
          expectedBeforeHash: asRead,
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof TransactionConflictError)) throw error;
    /**
     * **A precondition refusal can promise what the general one cannot.** It is raised in the
     * plan phase, before anything is staged, so the file on disk is exactly the one the user
     * edited and no `repair` is pending. The other conflict sites may arrive after the
     * bytes may have been written and cannot say either thing — which is why the message
     * below promises nothing about the file.
     *
     * This is the whole reason the executor raises a subclass rather than reusing the base
     * class: the most useful sentence available to a user who has just hand-edited a capture
     * is that their edit survived.
     */
    if (error instanceof TransactionPreconditionError) {
      throw new ReviewRefusal(
        exitCodeOf(error),
        "the capture changed on disk before this review wrote to it, so nothing was written and your edit is intact",
        [target],
        "run the same review again, which reads the newer file",
      );
    }
    throw new ReviewRefusal(
      exitCodeOf(error),
      "the capture changed on disk while this review was running, so the decision did not complete",
      [target],
      "if developer-os status reports an incomplete transaction, resolve it with developer-os repair first; otherwise run the same review again, which reads the newer file",
    );
  }
}

/**
 * **Where a hand edit should actually put each status, when no verb can move it.** The
 * fallback named `quarantined` for all four, and for `staging` that is wrong in a way that
 * costs the user their capture: setting it to `quarantined`, then `accept`, makes `ingest`
 * re-run and meet its own notes at a path `create` refuses — permanently stuck, having done
 * exactly what the product said.
 *
 * **`staging` is two states and this table cannot tell them apart, so it names both.** A
 * capture that was *partly applied* has notes in the vault already; one *left at staging*
 * wrote none. `ingest` distinguishes them because it knows what it did, and says so in two
 * separate strings — go to `ingested`, or to `accepted` **after removing the notes**, versus
 * simply back to `accepted`. `review` arrives later with only a status to go on, and
 * `developer-os status` cannot close the gap: it reports incomplete *transactions*, and a
 * partly-applied capture's transaction finalized. A first version of this entry gave the
 * stranded advice to both, which is the partly-applied stranding again — reintroduced by the
 * fix for it, because the prose beside it reasoned about the wrong sub-state.
 *
 * `rejected` goes back to `quarantined`, because the user is undoing a decision. `failed` is
 * a status only a hand edit can put in a file — `selectCaptures` derives it and never
 * persists it — so the capture in front of the user parsed cleanly and wants the same target.
 */
const HAND_EDIT_TARGET: Readonly<Record<CaptureStatus, string>> = Object.freeze({
  quarantined:
    "set the file's status back to quarantined by hand if the decision should be taken again",
  accepted:
    "set the file's status back to quarantined by hand if the decision should be taken again",
  rejected:
    "set the file's status back to quarantined by hand if this capture should be decided again",
  staging:
    "ingest left this capture at staging and never selects it again: read the run's own report for the notes it names — if any landed, set the status to ingested to keep them or remove them and set accepted to retry; if none did, set accepted",
  ingested:
    "this capture is already in the vault; edit or remove the note it produced rather than the capture",
  failed:
    "failed is a status only a hand edit writes, and this file parsed cleanly: set its status back to quarantined by hand to decide it again",
});

/**
 * One capture, one decision, spec §5.6:
 *
 * ```text
 * read → redact → normalize → deduplicationHash → status → render
 *      → through one transaction
 * ```
 *
 * **Every decision re-redacts, not only `edit`.** `parseCaptureFile` recomputes
 * `content`, `deduplicationHash` and `redaction` on the way in, and this
 * command writes what it read back rather than patching a status line in place,
 * so a secret pasted into a capture is removed by whichever decision reaches it
 * first. `edit` is the decision that exists *for* that; `accept` and `reject`
 * get it because the rule is "redact before persisting", not "redact when
 * asked".
 *
 * **The secret leaves the machine too, since 2026-08-17.** A transaction backs
 * its target up before it writes, and this paragraph used to record that nothing
 * pruned those backups: a copy of the pre-edit file, pasted secret and all,
 * survived under the product's own state directory. `TransactionExecutor` now
 * prunes every payload at both terminal phases. Re-measured the same way the
 * original claim was — a fixture root swept after an edit — and the token is in
 * **no** file there. That measurement is
 * `tests/security/backup-prune.test.ts`, and naming it matters: this paragraph
 * first credited `tests/security/sentinel.test.ts`, which samples from inside
 * `afterPhase` and so passes with the prune disabled entirely (BACKLOG,
 * Foundation request 2).
 *
 * **`captureId` is never recomputed** (spec §5.3, amended by the founder on
 * 2026-08-13), so the file keeps its name and an edit rewrites it in place.
 * `id-mismatch` keeps the narrower job it was really for: a frontmatter id that
 * disagrees with the filename, from a rename or a hand-edited id field.
 *
 * **Every refusal raised in this function leaves the capture exactly as it
 * was.** Nothing is written before the decision is legal and the envelope has
 * parsed, and no decision removes a source file — spec §5.6's own validator,
 * and the reason a `remove` mutation appears nowhere in this command. The one
 * refusal that cannot make that promise is `writeCapture`'s transaction
 * conflict, and it says so where it is raised.
 */
async function decideOne(
  context: CliContext,
  quarantine: string,
  redact: Redactor,
  target: ReviewTarget,
): Promise<ReviewedCaptureV1> {
  const fileName = `${target.id}${CAPTURE_FILE_SUFFIX}`;
  const path = await resolveCapturePath(context, quarantine, fileName);

  /**
   * Read as late as possible: everything above is independent of the file. The digest is
   * taken from the same read, off the bytes rather than the decoded text — see the
   * precondition passed to `writeCapture`.
   */
  let asRead = "";
  const text = await readCapture(context, path, target.id, (bytes) => {
    asRead = createHash("sha256").update(bytes).digest("hex");
  });
  const parsed = parseCaptureFile(fileName, text, redact);
  if (!parsed.ok) {
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      `the capture at ${fileName} could not be read (${parsed.reason})`,
      [path],
      parsed.reason === "id-mismatch"
        ? RESTORE_THE_ID
        : "open the file and repair its frontmatter; nothing is written to a capture this command cannot read",
    );
  }

  const outcome = applyReviewDecision(parsed.envelope, target.decision);
  if (!outcome.ok) {
    /**
     * **Name what is available from here, rather than recommending a hand edit.** The message
     * said "no review decision moves" this status, which stopped being true when `reject`
     * gained its `accepted` row — and the recovery told the user to edit their own
     * frontmatter, which is the advice this product spent a task removing from `ingest`. If
     * some decision is legal from where the capture actually is, say so; the hand edit is the
     * last resort and only when there is genuinely nothing else.
     */
    const available = decisionsFrom(parsed.envelope.status);
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      available.length === 0
        ? `this capture is at status ${parsed.envelope.status}, which no review decision moves`
        : `this capture is at status ${parsed.envelope.status}, which --decision ${target.decision} does not move`,
      [path],
      available.length === 0
        ? HAND_EDIT_TARGET[parsed.envelope.status]
        : `from ${parsed.envelope.status} this capture takes ${available.map((decision) => `--decision ${decision}`).join(" or ")}`,
    );
  }

  await writeCapture(
    context,
    path,
    renderCaptureFile(outcome.envelope),
    asRead,
  );
  return {
    captureId: outcome.envelope.captureId,
    status: outcome.envelope.status,
  };
}

/**
 * Diagnostics redacted with the key this command loaded, not with whatever the
 * context closed over. `init` records the rule: redact with the key you loaded,
 * at the point you loaded it — a command that fingerprinted vault content with
 * the composition root's ephemeral key would persist fingerprints nothing can
 * ever be compared against.
 */
function guardsWith(guards: CliGuards, redact: Redactor): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redact(text).text,
  };
}

/**
 * `developer-os review`, spec §5.6.
 *
 * ```text
 * developer-os review                                  list quarantined captures
 * developer-os review --status <status>                list captures at that status
 * developer-os review --id <id> --decision accept      status → accepted
 * developer-os review --id <id> --decision reject      status → rejected
 * developer-os review --id <id> --decision edit        re-read, re-redact, re-hash
 * ```
 *
 * **Listing changes no capture**, and no decision deletes a source. The command
 * never opens an editor: the capture is Markdown in the user's own vault, and
 * spawning `$EDITOR` would add an interactive escape hatch to a command that
 * must stay `--json`- and `--yes`-driveable.
 *
 * **A listing is not read-only in the strict sense, and saying so plainly is
 * the honest half of that claim.** Parsing a capture re-redacts it, so every
 * path here loads the durable key through `loadOrCreateRedactionKey`, which
 * creates one when `init`'s is missing. `readRedactionKey` is the read-only
 * door and it cannot serve this path: it answers `null` for a missing key, and
 * a listing that cannot parse a capture has nothing to list. Creating the
 * product's own key is what `capture` and `ingest` do at the same point, and
 * the alternative — refusing to list until the key is restored — is the larger
 * surprise. Nothing in the vault is written either way.
 */
export async function runReview(
  context: CliContext,
  options: ReviewOptions,
): Promise<CliResult<ReviewResultV1>> {
  let guards = context.guards;

  try {
    /** Before the vault is touched and before a key exists on disk. */
    const target = resolveTarget(options);
    /**
     * **Beside `resolveTarget` for the reason its comment gives, not near its
     * use.** A first version validated the status where the listing needed it,
     * four lines below `loadOrCreateRedactionKey` — so a mistyped `--status` on
     * an uninstalled machine was answered "Developer OS is not initialized", and
     * on an installed one **wrote a durable secret to disk** before refusing.
     * The docblock claimed "refused before anything is read" from that position,
     * which a fresh-context review caught on 2026-08-21.
     */
    const status = listedStatus(options);

    const config = await readConfiguration(context);
    const paths = runtimePathsFor(context, config);
    await assertVaultPresent(context, paths);
    const contentRoot = join(paths.brain, resolveBrainConfig(config).contentRoot);
    const quarantine = await resolveContainedRoot(
      context,
      contentRoot,
      join(contentRoot, ...QUARANTINE_SEGMENTS),
      "the quarantine directory resolves outside the content root",
      (message, paths_) =>
        new ReviewRefusal(EXIT_CODES.securityRefusal, message, paths_),
    );

    const key = loadOrCreateRedactionKey(paths.stateDir);
    /**
     * Built once, where the key and the configuration are both in scope. Spec §8.2's
     * user-extensible patterns reach the re-redaction an `edit` performs through here —
     * which matters most in this command, since `review --decision edit` exists to remove
     * a secret a user pasted in by hand (BACKLOG NEW-16).
     */
    const redact = createRedactor(key, {
      userPatterns: config.redaction?.patterns ?? [],
    });
    guards = guardsWith(context.guards, redact);

    if (target === null) {
      const listing = await listByStatus(context, quarantine, redact, status);
      return success(
        { schemaVersion: 1, captures: listing.captures, reviewed: 0 },
        listing.warnings,
      );
    }

    const reviewed = await decideOne(context, quarantine, redact, target);
    return success({ schemaVersion: 1, captures: [reviewed], reviewed: 1 });
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof ReviewRefusal ? error.paths : [],
      error instanceof ReviewRefusal ? error.recovery : undefined,
    );
  }
}
