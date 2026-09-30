import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { cwd as processCwd } from "node:process";

import { containsPath, EXIT_CODES, parseCanonicalAbsolutePathText, success } from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  RuntimePaths,
} from "@developer-os/core";
import { discoverClaude } from "@developer-os/adapter-claude";
import { discoverCodex } from "@developer-os/adapter-codex";
import {
  BrainService,
  buildCapture,
  detectSourceAgent,
  isUnsafeProposedNotePath,
  MAX_PROPOSED_NOTE_CHARS,
  parseNote,
  PRIVATE_FOLDERS,
  resolveBrainConfig,
  topicOfFolder,
} from "@developer-os/brain";
import type { BrainConfigV1, CaptureNoteTargetV1, CaptureStatus } from "@developer-os/brain";
import type { AgentName } from "@developer-os/platform-macos";
import { createRedactor } from "@developer-os/security";
import type { RedactionScope, Redactor } from "@developer-os/security";
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
import {
  PROBE_FILE_SYSTEM,
  pinProbeExecutable,
  recheckProbeExecutable,
} from "../pinned-executable.js";
import type { ProbeFileSystemV1 } from "../pinned-executable.js";
import { slugify } from "../project-slug.js";
import {
  fingerprintDirectory,
  readCaptureQuietly,
  readExistingCapture,
  resolveQuarantine,
  writeQuarantineCapture,
} from "./quarantine.js";
import type { ExistingCapture } from "./quarantine.js";
import { dependenciesFor } from "./reindex.js";

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
  /** The note a `--note` capture proposes; `null` for a plain capture. */
  readonly note: CaptureNoteTargetV1 | null;
}

export interface CaptureOptions {
  /**
   * `--text`. **Absent means "read stdin"**, and present means stdin is never
   * read at all (spec §5.1 reads stdin only *when `--text` is absent*). An
   * empty string is present, and is refused as empty input rather than falling
   * through to a pipe.
   */
  readonly text?: string;
  /** `--note <path>`, content-root-relative: the note this capture creates or replaces. */
  readonly note?: string;
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
   * `captureMethod` — be exercised for a vendor whose row does not exist, which
   * since 2026-08-20 is no vendor this product ships for. Both rows are
   * observed, and the two cases that drive detection through the real table
   * rather than through this parameter — one per vendor — are what prove the
   * table and the command meet.
   */
  readonly detect: (
    env: Readonly<Record<string, string | undefined>>,
  ) => string;
  /** The host the version probe's executable is admitted and rechecked against; absent means the real one. */
  readonly executables?: ProbeFileSystemV1;
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

/** Published as `capture_note_invalid` through `failureFrom`'s class-name kind. */
class CaptureNoteInvalidError extends CaptureRefusal {
  constructor(message: string, paths: readonly string[] = []) {
    super(EXIT_CODES.invalidInput, message, paths);
    this.name = "CaptureNoteInvalidError";
  }
}

/** Published as `capture_note_path_refused`. */
class CaptureNotePathRefusedError extends CaptureRefusal {
  constructor(message: string, paths: readonly string[] = []) {
    super(EXIT_CODES.securityRefusal, message, paths);
    this.name = "CaptureNotePathRefusedError";
  }
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
 * it is stated here rather than left for a reader to discover. **Since
 * 2026-08-20 it is live for both vendors:** a capture inside a Claude Code
 * session matches `CLAUDECODE` and spawns `claude --version`, and one inside a
 * Codex session matches `CODEX_THREAD_ID` and spawns `codex --version`. Between
 * 2026-08-15 and that date only the first was live, because NEW-21 had not
 * observed the second.
 *
 * **What it spawns is the PATH-selected binary's real path, pinned and rechecked
 * (BACKLOG NEW-46).** `CLAUDECODE` is trivially settable, so the trigger was never a
 * privilege an attacker had to earn. The selection is resolved once through
 * `admitOwnedExecutable` (D72 Q2-A's ownership and ancestor rule), pinned by
 * `{dev, ino, mode, size, ctimeNs}` rather than a hash so a vendor binary over the 64 MiB
 * `inspectSystemPath` limit is never read (D73 addendum), and re-resolved inside the runner immediately before the
 * spawn: a swap or in-place rewrite in between changes `ctime` and records `unknown`.
 * A binary the same uid planted in a directory only that uid can write still passes;
 * `threat-model.md` §5.11 records that residual.
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
  executables: ProbeFileSystemV1 = PROBE_FILE_SYSTEM,
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
    const pinned = await pinProbeExecutable(
      parseCanonicalAbsolutePathText(discovery.executablePath),
      executables,
    );
    const installation = await VERSION_PROBES[agent]({
      runner: {
        run: async (request) => {
          await recheckProbeExecutable(pinned, executables);
          return context.runner.run(request);
        },
      },
      executable: pinned.canonicalPath,
    });
    return installation === null
      ? UNKNOWN_SOURCE
      : { sourceAgent: agent, sourceAgentVersion: installation.version };
  } catch {
    return UNKNOWN_SOURCE;
  }
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

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * The string half of `--note`'s containment: inside a configured topic folder or a folder
 * `topicAliases` maps to one, resolved as the indexer does (NEW-128), and no segment
 * a dot-folder, a private folder or the indexes directory. `ingest` asks it again of the
 * envelope, which a person can edit between capture and ingest.
 */
export function isTopicNotePath(notePath: string, brainConfig: BrainConfigV1): boolean {
  const segments = notePath.split("/");
  const [topicFolder] = segments;
  const forbidden = new Set(
    [...PRIVATE_FOLDERS, brainConfig.indexesDir].map((name) =>
      name.normalize("NFC").toLowerCase(),
    ),
  );
  return (
    topicFolder !== undefined &&
    segments.length >= 2 &&
    topicOfFolder(topicFolder, brainConfig) !== null &&
    !segments.some(
      (segment) =>
        segment.startsWith(".") ||
        forbidden.has(segment.normalize("NFC").toLowerCase()),
    )
  );
}

/**
 * `--note <path>`, `brain.md` §6.13 (`capture --note`): the destination proven inside a
 * topic folder, and bound to the SHA-256 of its bytes when it exists. Runs
 * before the redaction key is loaded, so a refused path writes nothing at all.
 *
 * **The symlink walk starts at the topic folder, not at the content root**: a
 * content root reached through a link is a supported install (NEW-22), and
 * refusing it here would refuse every note capture on such a vault.
 */
async function resolveNoteTarget(
  context: CliContext,
  config: DeveloperOsConfigV1,
  paths: RuntimePaths,
  notePath: string,
): Promise<CaptureNoteTargetV1> {
  if (isUnsafeProposedNotePath(notePath)) {
    throw new CaptureNoteInvalidError(
      "--note must be a content-root-relative .md path with no empty, . or .. segment, no backslash, no single quote and no control character",
    );
  }

  const brainConfig = resolveBrainConfig(config);
  const segments = notePath.split("/");
  const [topicFolder = ""] = segments;
  if (!isTopicNotePath(notePath, brainConfig)) {
    throw new CaptureNotePathRefusedError(
      `--note must name a note inside a configured topic folder (${brainConfig.topicFolders.join(", ")}), outside every private folder and the indexes directory`,
    );
  }

  const topicRoot = join(paths.brain, brainConfig.contentRoot, topicFolder);
  const destination = join(topicRoot, ...segments.slice(1));

  let current = topicRoot;
  let leaf: Awaited<ReturnType<CliContext["fs"]["lstat"]>> | null = null;
  for (const [index, segment] of ["", ...segments.slice(1)].entries()) {
    if (index > 0) current = join(current, segment);
    let stats: Awaited<ReturnType<CliContext["fs"]["lstat"]>>;
    try {
      stats = await context.fs.lstat(current);
    } catch (error) {
      if (isMissingEntry(error)) break;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new CaptureNotePathRefusedError(
        "--note reaches its destination through a symbolic link",
        [current],
      );
    }
    if (current === destination) {
      leaf = stats;
    } else if (!stats.isDirectory()) {
      throw new CaptureNoteInvalidError(
        "--note names a path under something that is not a directory",
        [current],
      );
    }
  }

  const canonicalTopic = await context.guards.canonicalize(topicRoot);
  if (!containsPath(canonicalTopic, await context.guards.canonicalize(destination))) {
    throw new CaptureNotePathRefusedError(
      "--note resolves outside its topic folder",
      [destination],
    );
  }

  if (leaf === null) return { path: notePath, beforeSha256: null };

  const vaultPath = `${brainConfig.contentRoot}/${notePath}`.normalize("NFC");
  const indexed =
    leaf.isFile() &&
    (
      await new BrainService(
        dependenciesFor(context, paths.brain, config),
      ).reindex()
    ).build.index.notes.some((note) => note.path === vaultPath);
  if (!indexed) {
    throw new CaptureNoteInvalidError(
      "--note names an existing file that is not a canonical note",
      [destination],
    );
  }

  /** Hashed from the bytes, not the decoded text: the executor's precondition hashes bytes. */
  const beforeSha256 = await context.guards.readText(destination, async (handle) =>
    createHash("sha256").update(await handle.readFile()).digest("hex"),
  );
  return { path: notePath, beforeSha256 };
}

/**
 * `brain.md` §6.13 (`capture --note`) and its bound: the normalized capture must be a
 * whole, parseable note.
 */
function assertNoteContent(content: string): void {
  const note = `${content}\n`;
  if (note.length > MAX_PROPOSED_NOTE_CHARS) {
    throw new CaptureNoteInvalidError(
      `a note capture is at most ${String(MAX_PROPOSED_NOTE_CHARS)} characters; this one is longer`,
    );
  }
  const parsed = parseNote(note);
  const first = parsed.issues.find((issue) => issue.severity === "error");
  if (!parsed.ok || first !== undefined) {
    // Key (already screened by the parser), class and line only: the issue's
    // message can quote capture text, which is redacted only later.
    const where =
      first === undefined
        ? ""
        : `: ${first.key ?? "frontmatter"} (${first.code})${first.line === null ? "" : ` at line ${String(first.line)}`}`;
    throw new CaptureNoteInvalidError(
      `a note capture must be a complete note whose frontmatter parses with no error${where}`,
    );
  }
}

/** By index, never by value: the pattern is usually a client name (NEW-24, D73). */
export function overBroadWarnings(indexes: readonly number[]): readonly string[] {
  return indexes.map(
    (index) =>
      `[redaction] patterns[${String(index)}] in config.toml matches so much of this capture that it is over-broad; narrow it if that was not intended`,
  );
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
    redactDiagnostic: (text: string, scope?: RedactionScope): string =>
      redact(text, scope).text,
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
    const note =
      options.note === undefined
        ? undefined
        : await resolveNoteTarget(context, config, paths, options.note);

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
      dependencies.executables,
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
      ...(note === undefined ? {} : { note }),
    });
    assertWritableContent(built.envelope.content);
    if (note !== undefined) assertNoteContent(built.envelope.content);

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
    const { quarantine, canonicalQuarantine } = await resolveQuarantine(
      context,
      config,
      paths,
      (message, paths_) =>
        new CaptureRefusal(
          EXIT_CODES.securityRefusal,
          message,
          paths_,
          "restore the quarantine directory inside the vault's content root; an observation is never written through a quarantine path that leaves it",
        ),
    );
    /**
     * `target` is only ever reported; `canonicalTarget` is only ever touched
     * (NEW-20). The file name is joined onto the canonical root rather than the
     * whole path canonicalized, so `readText`'s `O_NOFOLLOW` still sees the leaf.
     */
    const target = join(quarantine, built.fileName);
    const canonicalTarget = join(canonicalQuarantine, built.fileName);
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
          note: found.note,
        },
        [
          ...(found.warning === null ? [] : [found.warning]),
          ...overBroadWarnings(built.overBroadPatterns),
        ],
      );

    const existing = await readExistingCapture(
      context,
      canonicalTarget,
      built.fileName,
      redact,
    );
    if (existing !== null) return duplicate(existing);

    try {
      await writeQuarantineCapture(
        context,
        paths,
        quarantine,
        canonicalTarget,
        built.contents,
        "capture",
      );
    } catch (error) {
      /**
       * The loser of the race `writeQuarantineCapture`'s docblock describes. The write
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
       * `writeQuarantineCapture`'s docblock, possibly its own `projectSlug`, fingerprint
       * and agent), so its bytes differ from ours; ours, byte for byte, is
       * ours.
       *
       * **This interprets no error and masks none.** It does not inspect the
       * thrown value at all — it asks the filesystem two questions with one
       * answer each, and rethrows the original error unless both say yes. A
       * refused guard, a full disk, an unreadable staging directory, an
       * interrupted apply: every one of them still surfaces as itself.
       */
      const raced = await readCaptureQuietly(context, canonicalTarget, built.fileName, redact);
      if (raced === null || !raced.parsed || raced.contents === built.contents) {
        throw error;
      }
      return duplicate(raced);
    }

    return success(
      {
        schemaVersion: 1,
        captureId: built.envelope.captureId,
        path: target,
        duplicate: false,
        status: built.envelope.status,
        redactionCount,
        note: built.envelope.note,
      },
      overBroadWarnings(built.overBroadPatterns),
    );
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof CaptureRefusal ? error.paths : [],
      error instanceof CaptureRefusal ? error.recovery : undefined,
    );
  }
}
