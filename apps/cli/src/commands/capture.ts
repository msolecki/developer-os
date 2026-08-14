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
import { redactText } from "@developer-os/security";
import type {
  CliInstallation,
  DiscoverCliDependencies,
} from "@developer-os/security";

import {
  failureFrom,
  loadOrCreateRedactionKey,
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
   * rows one layer down: `AGENT_DETECTION_ROWS` is empty by decision until
   * Task 17 observes a real vendor, so a detection that is only ever reached
   * through the real table can never be seen to *succeed*. With this, the
   * whole command — probe, envelope, `captureMethod` — is exercisable in the
   * state Task 17 will put it in, rather than only in today's.
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
 * it is stated here rather than left for a reader to discover. Today no
 * environment matches a detection row (`AGENT_DETECTION_ROWS` is empty by
 * decision until Task 17 observes one), so today nothing is spawned at all.
 *
 * Takes the agent name rather than reading the environment itself, so the rule
 * can be exercised while that table is empty — a rule first run the day someone
 * adds a row is a rule nobody has ever seen work.
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
 * every other interpolated string in this product (`buildCapture` applies
 * `screenEnvelopeScalar`; this function can only ever hand it letters, digits
 * and hyphens).
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
  key: Uint8Array,
): Promise<ExistingCapture | null> {
  try {
    await context.fs.lstat(target);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  const text = await context.guards.readText(target);
  const outcome = parseCaptureFile(fileName, text, (value) =>
    redactText(value, key),
  );

  return outcome.ok
    ? { parsed: true, status: outcome.envelope.status, warning: null }
    : {
        parsed: false,
        status: "failed",
        warning: `the capture already at this path could not be read (${outcome.reason})`,
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
  key: Uint8Array,
): Promise<ExistingCapture | null> {
  try {
    return await readExistingCapture(context, target, fileName, key);
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
 * specific to captures.** The plan-time snapshot and the apply-time re-check
 * (which raises `TransactionConflictError` on any hash change) leave a window
 * in which two processes can both decide the target is absent. `captureId` is
 * the first 16 hex of `sha256` over the *redacted, normalized content*, so two
 * captures can only ever collide when their content is byte-identical: the
 * losing write replaces a file with the same observation in it. The race is
 * idempotent — no observation is lost, no vault state is corrupted, and the
 * only visible difference is which run's `createdAt` survives. That is why the
 * same window would be unacceptable for `review` or `ingest`, which write
 * *different* content to a shared path, and is acceptable for this one.
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
function guardsWith(guards: CliGuards, key: Uint8Array): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redactText(text, key).text,
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
    guards = guardsWith(context.guards, key);

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
      redact: (value: string) => redactText(value, key),
    });
    assertWritableContent(built.envelope.content);

    const quarantine = join(
      paths.brain,
      resolveBrainConfig(config).contentRoot,
      ...QUARANTINE_SEGMENTS,
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
      key,
    );
    if (existing !== null) return duplicate(existing);

    try {
      await writeCapture(context, paths, quarantine, target, built.contents);
    } catch (error) {
      /**
       * The loser of the race `writeCapture`'s docblock describes. The write
       * failed; if what is now at the target is a *parseable capture of this
       * id*, the observation is recorded and this run is a duplicate like any
       * other, so it says so at exit 0 rather than reporting a failure the
       * user can neither act on nor distinguish from a real one.
       *
       * **This interprets no error and masks none.** It does not inspect the
       * thrown value at all — it asks the filesystem a question with one
       * answer, and rethrows the original error unless that answer is yes. A
       * refused guard, a full disk, an unreadable staging directory: every one
       * of them still surfaces as itself, because none of them leaves a
       * parseable capture behind.
       */
      const raced = await readCaptureQuietly(context, target, built.fileName, key);
      if (raced === null || !raced.parsed) throw error;
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
