import { createHmac } from "node:crypto";
import { basename, join } from "node:path";
import { cwd as processCwd } from "node:process";

import {
  EXIT_CODES,
  hashBytes,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  InstallationManifestV1,
  RuntimePaths,
} from "@developer-os/core";
import { discoverClaude } from "@developer-os/adapter-claude";
import { discoverCodex } from "@developer-os/adapter-codex";
import {
  buildCapture,
  detectSourceAgent,
  parseCaptureFile,
  resolveBrainConfig,
} from "@developer-os/brain";
import type { CaptureStatus } from "@developer-os/brain";
import type { AgentName } from "@developer-os/platform-macos";
import { createRedactor } from "@developer-os/security";
import type { Redactor } from "@developer-os/security";
import type {
  CliInstallation,
  DiscoverCliDependencies,
} from "@developer-os/security";

import {
  failureFrom,
  loadOrCreateRedactionKey,
  resolveContainedRoot,
  runtimePathsFor,
} from "../context.js";
import type { CliContext, CliGuards } from "../context.js";
import { isDirectory, readConfigFile } from "./doctor.js";

/**
 * What `--json` publishes, and it publishes a **count**: a consumer learns that
 * four things were redacted and nothing about them. The findings themselves —
 * class and fingerprint — are persisted in the capture's own frontmatter, where
 * a human reviewing the observation can see them; putting them on a machine
 * channel too would widen the surface a redaction exists to narrow.
 */
export interface CaptureResultV1 {
  readonly schemaVersion: 1;
  readonly captureId: string;
  readonly path: string;
  readonly duplicate: boolean;
  readonly status: CaptureStatus;
  readonly redactionCount: number;
}

export interface CaptureOptions {
  /**
   * `--text`. **Absent means "read stdin"**, and present means stdin is never
   * read at all (spec §5.1 reads stdin only *when `--text` is absent*). An
   * empty string is present, and is refused as empty input rather than falling
   * through to a pipe.
   */
  readonly text?: string;
}

export interface CaptureDependencies {
  /**
   * The working directory the observation was made in. Injected rather than
   * read at the call site so a test can name one without `chdir`, which is
   * process-global and would leak between suites.
   */
  readonly cwd: () => string;
  /**
   * Which agent produced this capture, from the environment it ran in.
   *
   * Injected for the reason `matchObservedAgent` is tested against synthetic
   * rows one layer down: it lets the whole command — probe, envelope,
   * `captureMethod` — be exercised for a vendor whose row does not exist yet,
   * which since Task 17 (2026-08-15) means Codex, whose marker that task could
   * not observe. `AGENT_DETECTION_ROWS` now carries Claude's row, and the case
   * that drives detection through the real table rather than through this
   * parameter is the one that proves the two meet.
   */
  readonly detect: (
    env: Readonly<Record<string, string | undefined>>,
  ) => string;
}

const DEFAULT_DEPENDENCIES: CaptureDependencies = {
  cwd: () => processCwd(),
  detect: detectSourceAgent,
};

/**
 * The bound on one observation, in bytes, and a **refusal** past it rather than
 * a truncation: a silently shortened observation is a capture that lies about
 * what was observed. `cat huge.log | developer-os capture` is the accident this
 * stops. It is the same 64 KiB `MAX_FRONTMATTER_CHARS`
 * (`packages/brain/src/indexes/build.ts`) bounds a frontmatter block with, for
 * the same reason: an unbounded read of a user-supplied stream is a way to
 * exhaust this process's memory with no diagnostic.
 *
 * `bin.ts` stops *reading* here so a huge pipe cannot be buffered whole; the
 * refusal itself is this command's, because the channel does not decide what a
 * capture is.
 */
export const MAX_CAPTURE_INPUT_BYTES = 64 * 1024;

/**
 * Recorded when no detection row matched, when discovery could not answer, or
 * when the version probe did not return one. `packages/brain`'s own detection
 * uses the same word for the same reason: a guessed agent is worse than an
 * absent one, because it is a fact a later reader will trust.
 */
const UNKNOWN = "unknown";

/**
 * The slug's own sentinel, deliberately **not** `UNKNOWN`. A working directory
 * whose basename carries no letter or digit is a nameless directory, not a
 * failed detection, and writing `projectSlug: unknown` beside
 * `sourceAgent: unknown` would invite a reader to conclude that something went
 * wrong when nothing did.
 */
const UNNAMED_PROJECT = "unnamed";

/** Vault-relative, under the configured content root. Spec §3.4. */
const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;

/**
 * Long enough to stay human-readable, short enough that a pathological
 * directory name cannot dominate the frontmatter block a reviewer reads.
 */
const MAX_PROJECT_SLUG_LENGTH = 64;

/** The width every other 64-bit identifier in this subsystem already uses. */
const FINGERPRINT_LENGTH = 16;

const CAPTURE_SOURCE = "capture";

const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

const NOT_INITIALIZED = "developer-os init";

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class CaptureRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "CaptureRefusal";
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

/**
 * The version probe, one adapter per vendor. Both bind the same
 * `discoverCli` today, and naming them separately is what keeps this a
 * per-vendor mapping on the day one of them stops being that function.
 */
const VERSION_PROBES: Readonly<
  Record<AgentName, (dependencies: DiscoverCliDependencies) => Promise<CliInstallation | null>>
> = {
  claude: discoverClaude,
  codex: discoverCodex,
};

export interface SourceAgent {
  readonly sourceAgent: string;
  readonly sourceAgentVersion: string;
}

const UNKNOWN_SOURCE: SourceAgent = {
  sourceAgent: UNKNOWN,
  sourceAgentVersion: UNKNOWN,
};

function isAgentName(agent: string): agent is AgentName {
  return Object.hasOwn(VERSION_PROBES, agent);
}

/**
 * `sourceAgent` and `sourceAgentVersion`, together, because they are one fact:
 * spec §5.4 records that **a discovery failure records `"unknown"` for both
 * fields rather than failing the capture**. Losing a capture because a version
 * probe failed would be the wrong trade in every case, so nothing here throws.
 *
 * **This spawns the vendor binary once per capture** when — and only when — an
 * agent was detected. That is a session-level event rather than a hot path, and
 * it is stated here rather than left for a reader to discover. **Since Task 17
 * (2026-08-15) that is a live path rather than a dormant one:** a capture taken
 * inside a Claude Code session matches `AGENT_DETECTION_ROWS`'s one row and
 * spawns `claude --version`. A capture taken inside a Codex session still
 * matches nothing and still spawns nothing, because that vendor's row could not
 * be observed.
 *
 * **What it spawns is a PATH-resolved binary, and this command now pays the check
 * that makes it safe to.** `PlatformAdapter`'s own type says whoever executes a
 * discovered binary owes an owner and mode check first; no caller paid it until
 * 2026-08-17, and this command had joined the offenders on 2026-08-15 when the
 * Claude row made the path live. `CLAUDECODE` is trivially settable, so the
 * trigger was never a privilege an attacker had to earn.
 *
 * **The refusal is swallowed here and fatal in `ingest`, and the asymmetry is the
 * point.** Spec §5.4 records an agent this command cannot identify as `unknown`,
 * and a binary it will not execute is one it cannot identify — so the capture
 * still happens and the note is still written. `ingest` refuses outright because
 * it hands the binary the observation and read access to the whole vault; this
 * probe passes `--version` and nothing else, and losing the user's note over a
 * probe it declined to run would be the worse trade.
 *
 * **The user is told by `doctor`, not here, and that is a decision rather than an
 * omission.** `doctor` grades an untrusted binary at exit 5 and names it, so the surface
 * exists; a warning on every capture would fire on each one in a session for a condition
 * that does not change between them, which is how a warning on the most-run command
 * teaches people to skip warnings. The residual is real and recorded: a user who never
 * runs `doctor` never learns their `claude` is refused.
 *
 * Takes the agent name rather than reading the environment itself, so the rule
 * can be exercised for a vendor that is not in the table — a rule first run the
 * day someone adds a row is a rule nobody has ever seen work.
 */
export async function discoverSourceAgent(
  context: CliContext,
  agent: string,
): Promise<SourceAgent> {
  if (!isAgentName(agent)) return UNKNOWN_SOURCE;

  try {
    const discovery = await context.platform.discoverExecutable(agent);
    if (!discovery.installed || discovery.executablePath === null) {
      return UNKNOWN_SOURCE;
    }
    /**
     * **Inside this `try`, deliberately, and the difference from `ingest` is the point**
     * (BACKLOG NEW-15). Spec §5.4 says an agent this command cannot identify is recorded
     * as `unknown`, and a binary it will not execute is one it cannot identify — so the
     * refusal is swallowed by the `catch` below and the capture still happens. `ingest`
     * refuses outright because it hands the binary the observation; this only probes for a
     * version, and failing the whole capture over a `--version` it declined to run would
     * cost the user their note for nothing.
     */
    await context.platform.assertTrustedExecutable(discovery.executablePath);
    const installation = await VERSION_PROBES[agent]({
      runner: context.runner,
      executable: discovery.executablePath,
    });
    return installation === null
      ? UNKNOWN_SOURCE
      : { sourceAgent: agent, sourceAgentVersion: installation.version };
  } catch {
    return UNKNOWN_SOURCE;
  }
}

/**
 * Everything that is not a letter or a digit becomes one separator, in any
 * script: the slug is human-readable by design (design spec §13.1), so a
 * project named `Zeitplan Änderung` keeps its letters rather than being
 * transliterated into something its owner would not recognise.
 *
 * It can therefore carry a client name, which is acceptable because the vault
 * is local and private — and it is screened on the way into the envelope like
 * every other interpolated string in this product: `buildCapture` applies
 * `screenEnvelopeScalar` to it regardless of what arrives here.
 *
 * **The "letters, digits and hyphens" that the fold produces is true of the
 * characters it keeps and not quite true of the string it returns.** `slice`
 * counts UTF-16 code units, so a basename made of astral characters — emoji,
 * or any script above the BMP — can be cut between a surrogate pair and leave
 * a lone surrogate at the end. It is written to the vault as such: neither
 * this fold nor `screenControlCharacters` treats an unpaired surrogate as a
 * character to remove. Recorded rather than fixed here, deliberately: the
 * exposure predates this bound (the slice only moved when the trim order was
 * corrected), and grapheme-safe truncation is a decision for the whole branch
 * rather than for one command's slug.
 *
 * **Sliced before it is trimmed, not after.** Trimming first left the slice
 * free to cut through a separator run and end the slug on a hyphen, so a
 * basename over the bound produced `long-project-name-` — a trailing separator
 * that says a word was removed rather than that the name was too long. One
 * trim, after the cut, is correct in both directions.
 */
function slugify(value: string): string {
  const slug = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .slice(0, MAX_PROJECT_SLUG_LENGTH)
    .replace(/^-+|-+$/gu, "");

  return slug.length === 0 ? UNNAMED_PROJECT : slug;
}

/**
 * A fingerprint, never a path. The working directory can name a client, a
 * repository, and the user's own home; what a later reader needs is only
 * whether two captures came from the same place, which 64 bits of keyed hash
 * answers without disclosing where that place is.
 */
function fingerprintDirectory(canonical: string, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

async function readConfiguration(
  context: CliContext,
): Promise<DeveloperOsConfigV1> {
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) {
    throw new CaptureRefusal(
      EXIT_CODES.operationalFailure,
      "Developer OS is not initialized, so there is no vault to capture into",
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
    throw new CaptureRefusal(
      EXIT_CODES.operationalFailure,
      "the vault does not exist, so there is nowhere to quarantine an observation",
      [paths.brain],
      NOT_INITIALIZED,
    );
  }
  if (!directory) {
    throw new CaptureRefusal(
      EXIT_CODES.invalidInput,
      "the vault path exists and is not a directory",
      [paths.brain],
    );
  }
}

/**
 * The observation, from exactly one channel. **The length is measured and
 * nothing else**: the text is not logged, not hashed and not echoed into any
 * refusal below, so the "redact first" rule is not weakened by a bound that
 * runs before the redactor.
 */
async function resolveText(
  context: CliContext,
  options: CaptureOptions,
): Promise<string> {
  /** `??` short-circuits, which is what makes "`--text` wins" structural. */
  const supplied = options.text ?? (await context.io.readStdin());

  if (supplied === null) {
    throw new CaptureRefusal(
      EXIT_CODES.invalidInput,
      "a capture needs text: pass --text, or pipe the observation on stdin",
    );
  }
  /**
   * Whitespace only is empty input, refused here — before a redaction key is
   * loaded, so the commonest mistake never creates a secret on disk. It is not
   * the whole rule: `assertWritableContent` below refuses what the screen
   * leaves, which this check cannot see.
   */
  if (/^\s*$/u.test(supplied)) {
    throw new CaptureRefusal(
      EXIT_CODES.invalidInput,
      "a capture needs text, and the observation supplied was empty",
    );
  }
  if (new TextEncoder().encode(supplied).byteLength > MAX_CAPTURE_INPUT_BYTES) {
    throw new CaptureRefusal(
      EXIT_CODES.invalidInput,
      `an observation is at most ${String(MAX_CAPTURE_INPUT_BYTES)} bytes; this one is longer and is refused rather than shortened`,
    );
  }
  return supplied;
}

/**
 * The second half of the empty-input rule, over the body that would actually
 * be written.
 *
 * `resolveText` refuses whitespace, which is the case a user hits; this refuses
 * what the *screen* leaves, which it cannot. `buildCapture` deletes every
 * `\p{Cf}` bar the zero-width joiner, so an observation of nothing but
 * zero-width spaces is non-blank going in and empty coming out — a capture with
 * a well-defined id, a real transaction, and no observation in it.
 * `buildCapture`'s own docblock leaves that question here on purpose: "whether
 * that is worth writing is the caller's question, and `developer-os capture`
 * answers it before it gets here."
 */
function assertWritableContent(content: string): void {
  if (content.length === 0) {
    throw new CaptureRefusal(
      EXIT_CODES.invalidInput,
      "a capture needs text, and nothing visible survived screening the observation",
    );
  }
}

interface ExistingCapture {
  /**
   * Whether the file read back as a capture *of this id*. `parseCaptureFile`
   * is given the file name, and refuses a frontmatter `captureId` that does
   * not match it, so `parsed` already carries the id comparison the recovery
   * path in `runCapture` needs — it never has to re-derive one.
   */
  readonly parsed: boolean;
  readonly status: CaptureStatus;
  readonly warning: string | null;
  /**
   * The file's bytes, verbatim. The recovery path in `runCapture` compares
   * them against what this run rendered, which is the one question that
   * separates "another process wrote this" from "this process wrote it and
   * then failed".
   */
  readonly contents: string;
}

/**
 * The capture already at this path, or `null` when there is none.
 *
 * **A duplicate exits 0 and names the existing capture, whatever its status**
 * (spec §5.2): re-capturing something already rejected does not resurrect it,
 * and re-capturing something already ingested writes nothing and says where it
 * went. That is why the file is parsed rather than merely counted — the status
 * is the answer the user needs.
 *
 * A file that is here and is not a capture reports `failed`, which is exactly
 * what that status means (spec §5.5): a capture whose own envelope is
 * unreadable — a truncated write, or a hand edit that broke the frontmatter.
 * That is a status like any other, so §5.2's "exit 0, whatever its status"
 * still governs; the reason travels as a warning, because a user who has a
 * broken file under this id needs to be told which file and why, and a second
 * copy of the same observation is not something this command can write.
 *
 * Read through the protected-path policy, never a bare `readFile`: this is a
 * user file in a user-writable tree, and `readText` is the channel that opens
 * with `O_NOFOLLOW` and re-checks `dev`/`ino` after open.
 */
async function readExistingCapture(
  context: CliContext,
  target: string,
  fileName: string,
  redact: Redactor,
): Promise<ExistingCapture | null> {
  try {
    await context.fs.lstat(target);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  const text = await context.guards.readText(target);
  const outcome = parseCaptureFile(fileName, text, redact);

  return outcome.ok
    ? { parsed: true, status: outcome.envelope.status, warning: null, contents: text }
    : {
        parsed: false,
        status: "failed",
        warning: `the capture already at this path could not be read (${outcome.reason})`,
        contents: text,
      };
}

/**
 * `readExistingCapture` on the recovery path, where a second failure must never
 * replace the first. A read that itself refuses — a symlink now at the target,
 * a vanished directory — answers "no capture here", which rethrows the original
 * error rather than this one.
 */
async function readCaptureQuietly(
  context: CliContext,
  target: string,
  fileName: string,
  redact: Redactor,
): Promise<ExistingCapture | null> {
  try {
    return await readExistingCapture(context, target, fileName, redact);
  } catch {
    return null;
  }
}

/**
 * One `create` mutation, through Foundation's `TransactionExecutor`. A capture
 * is not a special case that may append directly, which is what makes "atomic
 * quarantine writes" true rather than aspirational.
 *
 * **What this does and does not give you, because spec §5.2 asks for more than
 * a transaction-mediated create can provide.** §5.2 wants a duplicate to be an
 * `O_EXCL` create that fails. It is not one, and saying otherwise here would be
 * the more dangerous of the two mistakes:
 *
 * - `TransactionExecutor.execute` **snapshots** each target and refuses a
 *   `create` whose target exists (`executor.ts:199-204`). A snapshot is a
 *   `stat`, not an exclusive create.
 * - The transaction lock is taken on a per-execution `generateId()`
 *   (`store.ts:195-207`), so two concurrent captures hold two different locks
 *   and exclude each other from nothing.
 * - `writeDurableFile` ends in an unconditional `rename` (`executor.ts:113-135`),
 *   which replaces rather than refuses.
 *
 * A genuine `O_EXCL` create of the final target is not available from here: it
 * would make the target exist, which the executor's own `create` precondition
 * then refuses, and writing through that handle instead would bypass the
 * transaction model outright. A separate lock file in the vault is the second
 * mechanism the plan warned against, and lock lifecycle is Foundation's design
 * rather than this command's.
 *
 * **What is left is a narrow window, and it is tolerable here for a reason
 * specific to captures — but it is not free, and what it costs is worth saying
 * exactly.** The plan-time snapshot and the apply-time re-check (which raises
 * `TransactionConflictError` on any hash change) leave a window in which two
 * processes can both decide the target is absent.
 *
 * `captureId` is the first 16 hex of `sha256` over the *redacted, normalized
 * content* and nothing else (`build.ts:176,209`), so two captures can only ever
 * collide when their **observations** are byte-identical: the losing write
 * replaces a file holding the same text. That much is idempotent — no
 * observation is lost and no vault state is corrupted.
 *
 * **The provenance is not.** The id hashes content alone, so the two runs need
 * not agree on anything else: the same text captured from two working
 * directories, or under two agents, is one id. The loser forfeits its
 * `createdAt`, `projectSlug`, `workingDirectoryFingerprint`, `sourceAgent` and
 * `sourceAgentVersion` to the winner's, and nothing records that a second run
 * happened. That is the accepted cost, and it is bounded to metadata about a
 * duplicate observation.
 *
 * The same window would be unacceptable for `review` or `ingest`, which write
 * *different* content to a shared path, and it is acceptable for this one.
 *
 * `readExistingCapture` is how a duplicate is *reported* at exit 0, and
 * `runCapture` re-reads it if this call fails, so the loser of a race still
 * reports the duplicate rather than an error nobody can act on.
 *
 * **Nothing is recorded in `installation-manifest.json`.** A capture is the
 * user's own content, editable in Obsidian by design (spec §3.4) — recording it
 * as a managed artifact would report every legitimate edit as drift, and would
 * make the next capture of the same text a refused `create` over an artifact
 * the product claims to own.
 */
async function writeCapture(
  context: CliContext,
  paths: RuntimePaths,
  quarantine: string,
  target: string,
  contents: string,
): Promise<void> {
  /**
   * The transaction stages beside its target, so the directory has to exist
   * first — the same reason `init` and `brain reindex` create theirs before
   * executing. It is normally there from `init`'s template; this is the path
   * that matters when a user deleted it. Guarded first, because the vault root
   * comes from a config-supplied `brainPath`.
   */
  await context.guards.transaction.assertTarget(quarantine);
  await context.fs.mkdir(quarantine, { recursive: true, mode: 0o700 });

  const content = new TextEncoder().encode(contents);
  const manifest = (await context.manifests.readOptional()) ?? EMPTY_MANIFEST;
  const validated = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      operations: [
        {
          targetPath: target,
          operation: "create",
          owner: "core",
          kind: "file",
          expectedBeforeHash: null,
          source: CAPTURE_SOURCE,
          mergeStrategy: "dedicated",
          proposedHash: hashBytes(content),
        },
      ],
    },
    {
      /**
       * Quarantine alone, with the product home excluded as the other
       * ownership universe: a symlink inside one resolving into the other is
       * what the exclusion refuses.
       */
      manifest,
      ownedRoots: [quarantine],
      excludedRoots: [paths.home],
      canonicalize: context.guards.canonicalize,
    },
  );

  const operation = validated.operations[0];
  if (operation === undefined) {
    throw new CaptureRefusal(
      EXIT_CODES.operationalFailure,
      "the validated change plan lost its only operation",
      [target],
    );
  }

  await context.executor.execute({
    kind: "capture",
    mutations: [
      {
        targetPath: operation.canonicalTargetPath,
        operation: "create",
        content,
      },
    ],
  });
}

/**
 * Diagnostics redacted with the key this command loaded, not with whatever the
 * context closed over. `init` records the rule this follows: redact with the
 * key you loaded, at the point you loaded it — a command that fingerprinted
 * captured content with the composition root's ephemeral key would persist
 * fingerprints nothing can ever be compared against.
 */
function guardsWith(guards: CliGuards, redact: Redactor): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redact(text).text,
  };
}

/**
 * `developer-os capture`, spec §5.1, in this order and no other:
 *
 * ```text
 * text → redact → normalize → deduplicationHash → captureId → envelope
 *      → transaction: plan → backup → stage → validate → apply → verify → finalize
 * ```
 *
 * The raw text exists only in memory. It is never written, never logged, never
 * hashed and never sent to a model — `buildCapture` owns that ordering, and
 * this command's only job around it is to supply the environment, the clock,
 * the working directory and the key that package must not touch, and then to
 * put the result on disk through a transaction.
 */
export async function runCapture(
  context: CliContext,
  options: CaptureOptions,
  dependencies: CaptureDependencies = DEFAULT_DEPENDENCIES,
): Promise<CliResult<CaptureResultV1>> {
  let guards = context.guards;

  try {
    const config = await readConfiguration(context);
    const paths = runtimePathsFor(context, config);
    await assertVaultPresent(context, paths);

    /** Before the key is loaded: an invalid invocation writes no secret. */
    const text = await resolveText(context, options);

    const key = loadOrCreateRedactionKey(paths.stateDir);
    /**
     * Built once, here, where the key and the configuration are both in scope for the
     * only time. **This is the seam spec §8.2's user-extensible class was missing** — the
     * parameter existed on `redactText` and no caller passed it, and the schema had no
     * table to read (BACKLOG NEW-16).
     *
     * Everything below takes the redactor rather than the key, so the key travels no
     * further than the fingerprint that genuinely needs it. A closure cannot be
     * interpolated into a diagnostic by accident (spec §8.4).
     */
    const redact = createRedactor(key, {
      userPatterns: config.redaction?.patterns ?? [],
    });
    guards = guardsWith(context.guards, redact);

    const workingDirectory = await context.guards.canonicalize(
      dependencies.cwd(),
    );
    const source = await discoverSourceAgent(
      context,
      dependencies.detect(context.env),
    );

    const built = buildCapture({
      text,
      ...source,
      /**
       * Tied to detection, because they are the same observation: an agent we
       * did not detect is not an agent we may credit with authorship. Spec
       * §3.1 makes capture content agent-authored by design, and the day a
       * detection row exists (Task 17) both fields start saying so together.
       */
      captureMethod: source.sourceAgent === UNKNOWN ? "manual" : "agent-authored",
      projectSlug: slugify(basename(workingDirectory)),
      workingDirectoryFingerprint: fingerprintDirectory(workingDirectory, key),
      createdAt: context.now().toISOString(),
      redact,
    });
    assertWritableContent(built.envelope.content);

    /**
     * **Before the directory is created, read, or written**, because every one
     * of those follows the link. `ingest` and `review` refuse a relocated
     * quarantine at exit 5; this command wrote into it happily, which is both a
     * silent exfiltration primitive — one redacted observation per capture, into
     * a directory an attacker chose — and an operational absurdity, since the
     * captures it files there are somewhere no later run will ever read.
     *
     * `validateChangePlan` does not stand in for this. It is handed `quarantine`
     * as an owned root below, and a **sideways** relocation is something that
     * validator permits *by design*: `assertUsableRoots` refuses a root that
     * grew authority or sits inside `excludedRoots`
     * (`packages/core/src/plans/validate.ts:199-206`), and its own comment names
     * `~/.claude -> ~/Dropbox/claude` as the legitimate relocation it must not
     * break (`:186-188`). Which root is legitimate is this command's question,
     * not that validator's.
     */
    const contentRoot = join(paths.brain, resolveBrainConfig(config).contentRoot);
    const quarantine = join(contentRoot, ...QUARANTINE_SEGMENTS);
    /**
     * **The answer is the check, and the canonical form is deliberately
     * discarded.** Every path this command goes on to use is the *declared* one,
     * for two reasons that both bite:
     *
     * - `validateChangePlan` canonicalizes the owned root it is given, and
     *   `assertUsableRoots` refuses a root that resolved to an **ancestor** of
     *   what was declared (`packages/core/src/plans/validate.ts:200-205`). That
     *   test compares the canonical form against the declared one, so handing it
     *   a path already canonicalized makes it compare a string with itself and it
     *   can never fire. `containsPath` here cannot stand in for it: it is
     *   same-or-descendant (`packages/core/src/manifest/store.ts:113`), so a
     *   quarantine pointing at the content root passes the containment question
     *   and is caught only by the ownership one.
     * - `CaptureResultV1.path` is a contract, printed and published in `--json`.
     *   On a vault reached through a symlink the canonical form names a location
     *   the user never configured.
     */
    await resolveContainedRoot(
      context,
      contentRoot,
      quarantine,
      "the quarantine directory resolves outside the content root",
      (message, paths_) =>
        new CaptureRefusal(
          EXIT_CODES.securityRefusal,
          message,
          paths_,
          "restore the quarantine directory inside the vault's content root; an observation is never written through a quarantine path that leaves it",
        ),
    );
    const target = join(quarantine, built.fileName);
    const redactionCount = built.envelope.redaction.length;

    const duplicate = (found: ExistingCapture): CliResult<CaptureResultV1> =>
      success(
        {
          schemaVersion: 1,
          captureId: built.envelope.captureId,
          path: target,
          duplicate: true,
          status: found.status,
          redactionCount,
        },
        found.warning === null ? [] : [found.warning],
      );

    const existing = await readExistingCapture(
      context,
      target,
      built.fileName,
      redact,
    );
    if (existing !== null) return duplicate(existing);

    try {
      await writeCapture(context, paths, quarantine, target, built.contents);
    } catch (error) {
      /**
       * The loser of the race `writeCapture`'s docblock describes. The write
       * failed; if what is now at the target is a parseable capture of this id
       * that **another run wrote**, the observation is recorded and this run is
       * a duplicate like any other, so it says so at exit 0 rather than
       * reporting a failure the user can neither act on nor distinguish from a
       * real one.
       *
       * **`raced.contents !== built.contents` is what makes "another run"
       * checkable, and it is not a nicety.** `applyMutation` renames the staged
       * bytes onto the target before the transaction finalizes
       * (`executor.ts:571-577`), and `execute` rolls nothing back on its own, so
       * a failure in the metadata write, in a later phase transition, or in the
       * journal write leaves *this run's own capture* at the target with an
       * unfinalized journal beside it. Without this comparison that state read
       * as `duplicate: true` at exit 0 — a command reporting success over a
       * transaction that did not finalize, hiding the very journal `repair`
       * exists for. A real winner rendered its own `createdAt` (and, per
       * `writeCapture`'s docblock, possibly its own `projectSlug`, fingerprint
       * and agent), so its bytes differ from ours; ours, byte for byte, is
       * ours.
       *
       * **This interprets no error and masks none.** It does not inspect the
       * thrown value at all — it asks the filesystem two questions with one
       * answer each, and rethrows the original error unless both say yes. A
       * refused guard, a full disk, an unreadable staging directory, an
       * interrupted apply: every one of them still surfaces as itself.
       */
      const raced = await readCaptureQuietly(context, target, built.fileName, redact);
      if (raced === null || !raced.parsed || raced.contents === built.contents) {
        throw error;
      }
      return duplicate(raced);
    }

    return success({
      schemaVersion: 1,
      captureId: built.envelope.captureId,
      path: target,
      duplicate: false,
      status: built.envelope.status,
      redactionCount,
    });
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof CaptureRefusal ? error.paths : [],
      error instanceof CaptureRefusal ? error.recovery : undefined,
    );
  }
}
