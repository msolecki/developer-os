import { join } from "node:path";

import { containsPath, EXIT_CODES, success } from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  RuntimePaths,
} from "@developer-os/core";
import {
  applyReviewDecision,
  isReviewDecision,
  parseCaptureFile,
  renderCaptureFile,
  resolveBrainConfig,
  REVIEW_DECISIONS,
} from "@developer-os/brain";
import type { CaptureStatus, ReviewDecision } from "@developer-os/brain";
import { redactText } from "@developer-os/security";

import {
  failureFrom,
  loadOrCreateRedactionKey,
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
 * Every quarantined capture, in id order, and nothing else.
 *
 * **A capture this cannot parse is `failed`** (spec §5.5) — a truncated write,
 * or a hand edit that broke the frontmatter — and `failed` is not
 * `quarantined`, so it is not listed. It is warned about rather than passed
 * over in silence: a user with a broken file in their vault needs to be told
 * which file and why, and nothing else this command could do for it would be
 * safe. The reason travels; the file's contents never do.
 *
 * A read that *refuses* — a symlink where a capture should be, a path the
 * protected-path policy will not open — is left to propagate. Reporting a
 * security refusal as a line in a listing would file it where nobody looks.
 */
async function listQuarantined(
  context: CliContext,
  quarantine: string,
  key: Uint8Array,
): Promise<Listing> {
  const captures: ReviewedCaptureV1[] = [];
  const warnings: string[] = [];

  for (const fileName of await captureFileNames(context, quarantine)) {
    const text = await context.guards.readText(join(quarantine, fileName));
    const outcome = parseCaptureFile(fileName, text, (value) =>
      redactText(value, key),
    );
    if (!outcome.ok) {
      warnings.push(
        `${fileName} is not a readable capture (${outcome.reason}), so it is failed rather than waiting for review`,
      );
      continue;
    }
    if (outcome.envelope.status !== "quarantined") continue;
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
 */
async function resolveCapturePath(
  context: CliContext,
  quarantine: string,
  fileName: string,
): Promise<string> {
  const target = join(quarantine, fileName);
  await context.guards.transaction.assertTarget(target);

  const canonicalQuarantine = await context.guards.canonicalize(quarantine);
  const canonicalTarget = await context.guards.canonicalize(target);
  if (!containsPath(canonicalQuarantine, canonicalTarget)) {
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
  return context.guards.readText(target);
}

/**
 * One `replace` mutation, through Foundation's `TransactionExecutor`. A review
 * is not a special case that may rewrite a vault file directly, which is what
 * makes "atomic quarantine writes" true rather than aspirational.
 *
 * **`validateChangePlan` is not on this path, and its absence is a decision.**
 * A change plan's `replace` requires the target to be a managed artifact and
 * refuses `unmanaged_target` otherwise (`plans/validate.ts`), and a capture is
 * deliberately absent from `installation-manifest.json`: it is the user's own
 * content, editable in Obsidian by design (spec §3.4), so recording it as a
 * managed artifact would report every legitimate edit as drift. The ownership
 * checks a change plan would have run are replaced here by
 * `resolveCapturePath` — the writable-path guard, plus a canonical containment
 * check against the quarantine directory — and by the executor's own
 * `assertTarget` and snapshot.
 *
 * **There is a lost-update window between the read and this call, and on this
 * path it is not benign.** `PlannedFileMutation` is `{targetPath, operation,
 * content}` (`transactions/types.ts`): a caller cannot supply a precondition.
 * The executor computes `expectedBeforeHash` from the snapshot it takes when
 * `execute()` runs and re-checks it at apply, so its protection begins at
 * `execute()` and not at the read. This command reads the file, re-redacts,
 * re-hashes and renders first; a hand edit landing in that window is picked up
 * by the executor's own snapshot, hashed as if it were the expected state, and
 * then overwritten by content derived from the older read.
 *
 * What is lost is exactly the user's own hand edit — silently, by the verb
 * whose whole purpose is to bring a hand edit back under the product's
 * guarantees. Unlike `capture`'s residual race, that is not idempotent: a
 * capture collision writes the same observation twice because the id is the
 * content hash, while here the two writers hold different content.
 *
 * The window is narrowed to in-process work by reading as late as possible, and
 * it cannot be closed from here: an optional caller-supplied precondition on
 * `PlannedFileMutation` is a Foundation change, and it is raised to the founder
 * in `docs/superpowers/ORDER.md` together with `capture`'s `O_EXCL` request,
 * because both have that one cause.
 */
async function writeCapture(
  context: CliContext,
  target: string,
  contents: string,
): Promise<void> {
  await context.executor.execute({
    kind: REVIEW_TRANSACTION,
    mutations: [
      {
        targetPath: target,
        operation: "replace",
        content: new TextEncoder().encode(contents),
      },
    ],
  });
}

/**
 * One capture, one decision, spec §5.6:
 *
 * ```text
 * read → redact → normalize → deduplicationHash → status → render
 *      → transaction: plan → backup → stage → validate → apply → verify → finalize
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
 * **The secret leaves the vault; it does not leave the machine.** The
 * transaction backs the target up before it applies, and nothing removes a
 * backup after `finalize` (`transactions/executor.ts`), so the pre-edit file —
 * pasted secret and all — remains at
 * `~/.developer-os/backups/transactions/<id>/0.bin`, mode `0600`, under the
 * product's own state directory. Measured rather than assumed: sweeping a
 * fixture root after an edit finds the token in exactly that one file and
 * nowhere in the vault. It is inherent to a backup that must be able to restore
 * the previous content, so no ordering inside this command can avoid it; only a
 * backup lifecycle in Foundation can, and that is not this task's to write.
 *
 * **`captureId` is never recomputed** (spec §5.3, amended by the founder on
 * 2026-08-13), so the file keeps its name and an edit rewrites it in place.
 * `id-mismatch` keeps the narrower job it was really for: a frontmatter id that
 * disagrees with the filename, from a rename or a hand-edited id field.
 *
 * **A refusal leaves the capture exactly as it was.** Nothing here is written
 * before the decision is legal and the envelope has parsed, and no decision
 * removes a source file — spec §5.6's own validator, and the reason a
 * `remove` mutation appears nowhere in this command.
 */
async function decideOne(
  context: CliContext,
  quarantine: string,
  key: Uint8Array,
  target: ReviewTarget,
): Promise<ReviewedCaptureV1> {
  const fileName = `${target.id}${CAPTURE_FILE_SUFFIX}`;
  const path = await resolveCapturePath(context, quarantine, fileName);

  /** Read as late as possible: everything above is independent of the file. */
  const text = await readCapture(context, path, target.id);
  const parsed = parseCaptureFile(fileName, text, (value) =>
    redactText(value, key),
  );
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
    throw new ReviewRefusal(
      EXIT_CODES.invalidInput,
      `this capture is at status ${parsed.envelope.status}, which no review decision moves`,
      [path],
      "set the file's status back to quarantined by hand if the decision should be taken again",
    );
  }

  await writeCapture(context, path, renderCaptureFile(outcome.envelope));
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
function guardsWith(guards: CliGuards, key: Uint8Array): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redactText(text, key).text,
  };
}

/**
 * `developer-os review`, spec §5.6.
 *
 * ```text
 * developer-os review                                  list quarantined captures
 * developer-os review --id <id> --decision accept      status → accepted
 * developer-os review --id <id> --decision reject      status → rejected
 * developer-os review --id <id> --decision edit        re-read, re-redact, re-hash
 * ```
 *
 * **Listing changes nothing**, and no decision deletes a source. The command
 * never opens an editor: the capture is Markdown in the user's own vault, and
 * spawning `$EDITOR` would add an interactive escape hatch to a command that
 * must stay `--json`- and `--yes`-driveable.
 */
export async function runReview(
  context: CliContext,
  options: ReviewOptions,
): Promise<CliResult<ReviewResultV1>> {
  let guards = context.guards;

  try {
    /** Before the vault is touched and before a key exists on disk. */
    const target = resolveTarget(options);

    const config = await readConfiguration(context);
    const paths = runtimePathsFor(context, config);
    await assertVaultPresent(context, paths);
    const quarantine = join(
      paths.brain,
      resolveBrainConfig(config).contentRoot,
      ...QUARANTINE_SEGMENTS,
    );

    const key = loadOrCreateRedactionKey(paths.stateDir);
    guards = guardsWith(context.guards, key);

    if (target === null) {
      const listing = await listQuarantined(context, quarantine, key);
      return success(
        { schemaVersion: 1, captures: listing.captures, reviewed: 0 },
        listing.warnings,
      );
    }

    const reviewed = await decideOne(context, quarantine, key, target);
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
