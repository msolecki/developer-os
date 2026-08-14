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
}

const DEFAULT_DEPENDENCIES: CaptureDependencies = { cwd: () => processCwd() };

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
 */
function slugify(value: string): string {
  const slug = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug.length === 0 ? UNKNOWN : slug.slice(0, MAX_PROJECT_SLUG_LENGTH);
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
    ? { status: outcome.envelope.status, warning: null }
    : {
        status: "failed",
        warning: `the capture already at this path could not be read (${outcome.reason})`,
      };
}

/**
 * One `create` mutation, through Foundation's `TransactionExecutor`. A capture
 * is not a special case that may append directly, which is what makes "atomic
 * quarantine writes" true rather than aspirational.
 *
 * **The `O_EXCL` semantics spec §5.2 requires are the executor's own**: it
 * snapshots each target under the transaction lock and refuses a `create` whose
 * target already exists (`packages/core/src/transactions/executor.ts`), so the
 * duplicate check needs no second mechanism beside it. `readExistingCapture` is
 * how a duplicate is *reported* at exit 0, not how it is prevented; a file that
 * appears between that read and this write surfaces as a refused transaction
 * rather than as a silent overwrite.
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
      detectSourceAgent(context.env),
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

    const existing = await readExistingCapture(
      context,
      target,
      built.fileName,
      key,
    );
    if (existing !== null) {
      return success(
        {
          schemaVersion: 1,
          captureId: built.envelope.captureId,
          path: target,
          duplicate: true,
          status: existing.status,
          redactionCount,
        },
        existing.warning === null ? [] : [existing.warning],
      );
    }

    await writeCapture(context, paths, quarantine, target, built.contents);

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
