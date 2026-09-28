import { randomBytes } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import { cwd as processCwd } from "node:process";

import { CLAUDE_MEMORY_LAYOUT } from "@developer-os/adapter-claude";
import type { ClaudeMemoryLayoutV1 } from "@developer-os/adapter-claude";
import { containsPath, EXIT_CODES, success } from "@developer-os/core";
import type { CliResult, ExitCode, RuntimePaths } from "@developer-os/core";
import { buildCapture } from "@developer-os/brain";
import type { CaptureBuildResult } from "@developer-os/brain";
import { createRedactor, SecurityRefusalError } from "@developer-os/security";
import type { Redactor } from "@developer-os/security";

import {
  failureFrom,
  loadOrCreateRedactionKey,
  readRedactionKey,
  renderPath,
  resolveContainedRoot,
  runtimePathsFor,
} from "../context.js";
import type { CliContext } from "../context.js";
import { MAX_CAPTURE_INPUT_BYTES } from "./capture.js";
import { isDirectory, readConfigFile } from "./doctor.js";
import {
  fingerprintDirectory,
  INBOX_SEGMENTS,
  readCaptureQuietly,
  readExistingCapture,
  resolveQuarantine,
  writeQuarantineCapture,
} from "./quarantine.js";
import { readUntrustedText, UntrustedFileRefusal } from "./untrusted-file.js";

export const IMPORT_MAX_ENTRIES_WALKED = 10_000;
/** Path segments below the root: `a/b.md` is depth 2. */
export const IMPORT_MAX_DEPTH = 16;
export const IMPORT_MAX_FILES_PER_RUN = 1_000;
export const IMPORT_MAX_MEMORY_PROJECTS = 1_000;

export interface ImportFileResultV1 {
  readonly path: string; // source-relative, redacted
  readonly outcome: "imported" | "skipped" | "refused" | "would_import";
  readonly captureId: string | null;
  readonly reason: string | null; // spec §5.6 reason, or "unsupported_type"
  readonly redactionCount: number;
}

export interface ImportResultV1 {
  readonly schemaVersion: 1;
  readonly source: "inbox" | "path" | "claude-memory";
  readonly dryRun: boolean;
  readonly files: readonly ImportFileResultV1[];
  readonly duplicateCount: number;
  readonly remaining: number;
}

export interface ImportOptions {
  readonly path: string | null;
  readonly claudeMemory: boolean;
  readonly limit: number | null;
  readonly dryRun: boolean;
}

export interface ImportDependencies {
  readonly cwd: () => string;
  readonly memoryLayout: ClaudeMemoryLayoutV1 | null;
}

const DEFAULT_DEPENDENCIES: ImportDependencies = {
  cwd: () => processCwd(),
  memoryLayout: CLAUDE_MEMORY_LAYOUT,
};

/** One accepted file, before it is read. `relative` is NFC, POSIX-separated. */
export interface ImportCandidate {
  readonly relative: string;
  readonly absolute: string;
  readonly fingerprintSource: string; // what fingerprintDirectory keys for workingDirectoryFingerprint
}

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

const ACCEPTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/** Spec §5.6, per-file rows. The run's code is the most severe of these. */
const FILE_REFUSAL_CODES: Readonly<Record<string, FailureExitCode>> = {
  import_source_protected: EXIT_CODES.securityRefusal,
  import_source_symlink: EXIT_CODES.securityRefusal,
  import_source_not_found: EXIT_CODES.invalidInput,
  import_source_too_large: EXIT_CODES.operationalFailure,
  import_source_not_text: EXIT_CODES.operationalFailure,
  import_source_empty: EXIT_CODES.operationalFailure,
};

const NOT_INITIALIZED = "developer-os init";

/** A run-level refusal (spec §5.6). The name is the published `kind`. */
export class ImportRunRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = reason;
  }
}

/** The per-file refusals of one run, reported together. */
class ImportRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportRefusal";
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

function compareRelative(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function row(
  path: string,
  outcome: ImportFileResultV1["outcome"],
  reason: string | null = null,
  captureId: string | null = null,
  redactionCount = 0,
): ImportFileResultV1 {
  return { path, outcome, captureId, reason, redactionCount };
}

function recoveryOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "recovery" in error) {
    return typeof error.recovery === "string" ? error.recovery : undefined;
  }
  return undefined;
}

interface Walked {
  readonly candidates: ImportCandidate[];
  /** Raw relative paths; `processCandidates` redacts every row it publishes. */
  readonly presets: ImportFileResultV1[];
}

function classify(
  stats: { isFile(): boolean; isSymbolicLink(): boolean },
  relative: string,
  absolute: string,
  root: string,
  walked: Walked,
): void {
  if (stats.isSymbolicLink()) {
    walked.presets.push(row(relative, "refused", "import_source_symlink"));
  } else if (stats.isFile() && ACCEPTED_EXTENSIONS.has(extname(relative).toLowerCase())) {
    walked.candidates.push({ relative, absolute, fingerprintSource: root });
  } else {
    // FIFOs, sockets and devices land here too, and are never opened.
    walked.presets.push(row(relative, "skipped", "unsupported_type"));
  }
}

/**
 * Depth-first with `lstat`, never following a link. Runs to completion before
 * anything is read or written, so a bound refusal writes nothing.
 */
async function walk(context: CliContext, root: string): Promise<Walked> {
  const walked: Walked = { candidates: [], presets: [] };

  let rootStats;
  try {
    rootStats = await context.fs.lstat(root, { bigint: true });
  } catch (error) {
    if (isMissingEntry(error)) {
      throw new ImportRunRefusal(
        "import_source_not_found",
        EXIT_CODES.invalidInput,
        "the import source does not exist",
        [root],
      );
    }
    throw error;
  }
  if (!rootStats.isDirectory()) {
    classify(rootStats, basename(root).normalize("NFC"), root, root, walked);
    return walked;
  }

  const limit = (): ImportRunRefusal =>
    new ImportRunRefusal(
      "import_enumeration_limit",
      EXIT_CODES.invalidInput,
      `an import walks at most ${String(IMPORT_MAX_ENTRIES_WALKED)} entries, ${String(IMPORT_MAX_DEPTH)} levels deep; this source is larger and nothing was imported`,
      [root],
    );

  let seen = 0;
  const stack: { readonly directory: string; readonly segments: readonly string[] }[] = [
    { directory: root, segments: [] },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const name of await context.fs.readdir(next.directory)) {
      seen += 1;
      if (seen > IMPORT_MAX_ENTRIES_WALKED) throw limit();
      if (name.startsWith(".")) continue;
      const segments = [...next.segments, name.normalize("NFC")];
      if (segments.length > IMPORT_MAX_DEPTH) throw limit();

      const absolute = join(next.directory, name);
      const stats = await context.fs.lstat(absolute, { bigint: true });
      if (stats.isDirectory()) {
        stack.push({ directory: absolute, segments });
      } else {
        classify(stats, segments.join("/"), absolute, root, walked);
      }
    }
  }

  walked.candidates.sort((left, right) => compareRelative(left.relative, right.relative));
  walked.presets.sort((left, right) => compareRelative(left.path, right.path));
  return walked;
}

const enumerationLimit = (root: string): ImportRunRefusal =>
  new ImportRunRefusal(
    "import_enumeration_limit",
    EXIT_CODES.invalidInput,
    `an import walks at most ${String(IMPORT_MAX_ENTRIES_WALKED)} entries and ${String(IMPORT_MAX_MEMORY_PROJECTS)} memory project directories; this source is larger and nothing was imported`,
    [root],
  );

/**
 * Spec §5.5: list `<vendor-home>/projects` and each project's memory
 * directory, nothing else. A project directory holds session transcripts,
 * so it is never listed itself.
 */
export async function enumerateClaudeMemory(
  context: CliContext,
  layout: ClaudeMemoryLayoutV1,
  key: Uint8Array,
): Promise<{ readonly candidates: ImportCandidate[]; readonly preset: ImportFileResultV1[] }> {
  const vendorHome = await context.guards.canonicalize(join(context.userHome, ".claude"));
  const projects = join(vendorHome, layout.projectsDirectory);
  const notFound = (): ImportRunRefusal =>
    new ImportRunRefusal(
      "import_source_not_found",
      EXIT_CODES.invalidInput,
      "the Claude Code projects directory does not exist",
      [projects],
    );
  try {
    if (!(await context.fs.lstat(projects, { bigint: true })).isDirectory()) throw notFound();
  } catch (error) {
    if (isMissingEntry(error)) throw notFound();
    throw error;
  }

  const names = await context.fs.readdir(projects);
  if (names.length > IMPORT_MAX_MEMORY_PROJECTS) throw enumerationLimit(projects);
  let seen = names.length;

  const candidates: ImportCandidate[] = [];
  const preset: ImportFileResultV1[] = [];
  for (const name of names) {
    const memory = join(projects, name, layout.memoryDirectory);
    let stats;
    try {
      // A linked project directory would lead the memory lstat out of the vendor home.
      if (!(await context.fs.lstat(join(projects, name), { bigint: true })).isDirectory()) continue;
      stats = await context.fs.lstat(memory, { bigint: true });
    } catch (error) {
      if (isMissingEntry(error)) continue;
      throw error;
    }
    if (!stats.isDirectory()) continue;

    const files = await context.fs.readdir(memory);
    seen += files.length;
    if (seen > IMPORT_MAX_ENTRIES_WALKED) throw enumerationLimit(projects);
    const project = fingerprintDirectory(name, key);
    for (const file of files) {
      if (!file.endsWith(layout.extension) || file === layout.indexFileName) continue;
      const absolute = join(memory, file);
      const relative = `${project}/${file.normalize("NFC")}`;
      const entry = await context.fs.lstat(absolute, { bigint: true });
      if (entry.isSymbolicLink()) preset.push(row(relative, "refused", "import_source_symlink"));
      else if (entry.isFile()) candidates.push({ relative, absolute, fingerprintSource: name });
    }
  }

  candidates.sort((left, right) => compareRelative(left.relative, right.relative));
  preset.sort((left, right) => compareRelative(left.path, right.path));
  return { candidates, preset };
}

type Prepared =
  | { readonly refused: string }
  | { readonly built: CaptureBuildResult };

/**
 * The shared per-file loop: read → build → duplicate → write, with the cap,
 * `remaining` and run-stop rules (plan Scope decisions 8 and 9).
 *
 * `preset` rows carry **raw** relative paths, like `candidates`; every
 * published row path is redacted here, once.
 */
export async function processCandidates(input: {
  readonly context: CliContext;
  readonly candidates: readonly ImportCandidate[];
  readonly preset: readonly ImportFileResultV1[]; // skips and symlink refusals found by the walk
  readonly captureMethod: "import" | "import-claude-memory";
  readonly projectSlug: "inbox" | "import" | "claude-memory";
  readonly source: ImportResultV1["source"];
  readonly quarantine: string; // declared: only `validateChangePlan`'s owned root
  readonly canonicalQuarantine: string; // what the containment proof held for: every read and write (NEW-20)
  readonly paths: RuntimePaths;
  readonly key: Uint8Array;
  readonly keyDurable: boolean; // false: dry run on an ephemeral key → no duplicate detection
  readonly redact: Redactor;
  readonly cap: number;
  readonly dryRun: boolean;
}): Promise<CliResult<ImportResultV1>> {
  const { context, candidates, redact } = input;
  const rows: ImportFileResultV1[] = [...input.preset];
  let duplicateCount = 0;
  let remaining = 0;
  let newCount = 0;

  const prepare = async (candidate: ImportCandidate): Promise<Prepared> => {
    let text: string;
    try {
      text = await readUntrustedText(context, candidate.absolute, MAX_CAPTURE_INPUT_BYTES);
    } catch (error) {
      if (!(error instanceof UntrustedFileRefusal)) throw error;
      return {
        refused:
          error.reason === "not_regular" ? "import_source_not_text" : `import_source_${error.reason}`,
      };
    }
    if (/^\s*$/u.test(text)) return { refused: "import_source_empty" };
    const built = buildCapture({
      text,
      sourceAgent: "unknown",
      sourceAgentVersion: "unknown",
      captureMethod: input.captureMethod,
      projectSlug: input.projectSlug,
      workingDirectoryFingerprint: fingerprintDirectory(candidate.fingerprintSource, input.key),
      createdAt: context.now().toISOString(),
      redact,
    });
    return built.envelope.content.length === 0 ? { refused: "import_source_empty" } : { built };
  };

  const isDuplicate = async (built: CaptureBuildResult): Promise<boolean> =>
    input.keyDurable &&
    (await readExistingCapture(
      context,
      join(input.canonicalQuarantine, built.fileName),
      built.fileName,
      redact,
    )) !== null;

  const result = (): ImportResultV1 => ({
    schemaVersion: 1,
    source: input.source,
    dryRun: input.dryRun,
    files: rows
      .sort((left, right) => compareRelative(left.path, right.path))
      .map((file) => ({ ...file, path: redact(file.path).text })),
    duplicateCount,
    remaining,
  });

  let index = 0;
  try {
    for (; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate === undefined) break;

      if (newCount >= input.cap) {
        // Probe only: a file whose read would refuse still counts, because it is not a duplicate.
        if (!input.keyDurable) {
          remaining += 1;
          continue;
        }
        const probed = await prepare(candidate);
        if ("refused" in probed || !(await isDuplicate(probed.built))) remaining += 1;
        else duplicateCount += 1;
        continue;
      }

      const prepared = await prepare(candidate);
      if ("refused" in prepared) {
        rows.push(row(candidate.relative, "refused", prepared.refused));
        continue;
      }
      const { built } = prepared;
      if (await isDuplicate(built)) {
        duplicateCount += 1;
        continue;
      }
      const redactionCount = built.envelope.redaction.length;

      if (input.dryRun) {
        newCount += 1;
        rows.push(
          row(
            candidate.relative,
            "would_import",
            null,
            input.keyDurable ? built.envelope.captureId : null,
            redactionCount,
          ),
        );
        continue;
      }

      const target = join(input.canonicalQuarantine, built.fileName);
      try {
        await writeQuarantineCapture(
          context,
          input.paths,
          input.quarantine,
          target,
          built.contents,
          "import",
        );
      } catch (error) {
        // `capture`'s race rule: another run's identical observation is a duplicate.
        const raced = await readCaptureQuietly(context, target, built.fileName, redact);
        if (raced === null || !raced.parsed || raced.contents === built.contents) throw error;
        duplicateCount += 1;
        continue;
      }
      newCount += 1;
      rows.push(
        row(candidate.relative, "imported", null, built.envelope.captureId, redactionCount),
      );
    }
  } catch (error) {
    remaining += candidates.length - index;
    return failureFrom({ guards: context.guards }, error, [], recoveryOf(error), result());
  }

  const refused = rows.filter((file) => file.outcome === "refused");
  if (refused.length === 0) return success(result());

  // Exit codes 1..6 rank by severity in numeric order (spec §4.1).
  const code = Math.max(
    ...refused.map(
      (file) => FILE_REFUSAL_CODES[file.reason ?? ""] ?? EXIT_CODES.operationalFailure,
    ),
  ) as FailureExitCode;
  return failureFrom(
    { guards: context.guards },
    new ImportRefusal(
      code,
      `import refused ${String(refused.length)} file(s); every other file was processed`,
    ),
    [],
    undefined,
    result(),
  );
}

/**
 * `developer-os import [<path>]`, spec §5 under Q5 A: sources are read and
 * never moved, and every new capture is one Foundation transaction.
 */
export async function runImport(
  context: CliContext,
  options: ImportOptions,
  dependencies: ImportDependencies = DEFAULT_DEPENDENCIES,
): Promise<CliResult<ImportResultV1>> {
  let guards = context.guards;

  try {
    // Before any filesystem call: an unobserved vendor layout reads nothing at all.
    const layout = dependencies.memoryLayout;
    if (options.claudeMemory && layout === null) {
      throw new ImportRunRefusal(
        "claude_memory_layout_unobserved",
        EXIT_CODES.capabilityUnavailable,
        "the Claude Code memory layout has not been observed for this product; nothing was read",
      );
    }
    // Spec §5.5: the variable is not followed, so the memory under it would be missed silently.
    if (options.claudeMemory && context.env.CLAUDE_CONFIG_DIR !== undefined && context.env.CLAUDE_CONFIG_DIR !== "") {
      throw new ImportRunRefusal(
        "claude_config_dir_not_followed",
        EXIT_CODES.capabilityUnavailable,
        "CLAUDE_CONFIG_DIR is set and not followed, so Claude's memory is not under the vendor home; nothing was read",
      );
    }
    const config = await readConfigFile(context, context.paths.configFile);
    if (config === null) {
      throw new ImportRunRefusal(
        "not_initialized",
        EXIT_CODES.operationalFailure,
        "Developer OS is not initialized, so there is no vault to import into",
        [context.paths.configFile],
        NOT_INITIALIZED,
      );
    }
    const paths = runtimePathsFor(context, config);
    const vault = await isDirectory(context, paths.brain);
    if (vault === null) {
      throw new ImportRunRefusal(
        "not_initialized",
        EXIT_CODES.operationalFailure,
        "the vault does not exist, so there is nowhere to quarantine an import",
        [paths.brain],
        NOT_INITIALIZED,
      );
    }
    if (!vault) {
      throw new ImportRunRefusal(
        "vault_not_directory",
        EXIT_CODES.invalidInput,
        "the vault path exists and is not a directory",
        [paths.brain],
      );
    }

    const notContained = (message: string, refused: readonly string[]): Error =>
      new ImportRunRefusal(
        "import_root_not_contained",
        EXIT_CODES.securityRefusal,
        message,
        refused,
        "restore the directory inside the vault's content root; an import never reads from or writes through a path that leaves it",
      );
    const { contentRoot, quarantine, canonicalQuarantine } = await resolveQuarantine(
      context,
      config,
      paths,
      notContained,
    );
    const inbox = await resolveContainedRoot(
      context,
      contentRoot,
      join(contentRoot, ...INBOX_SEGMENTS),
      "the inbox directory resolves outside the content root",
      notContained,
    );

    const existingKey = options.dryRun ? readRedactionKey(paths.stateDir) : null;
    const loadKey = (): Uint8Array =>
      options.dryRun ? (existingKey ?? randomBytes(32)) : loadOrCreateRedactionKey(paths.stateDir);
    const bind = (key: Uint8Array): Redactor => {
      const redact = createRedactor(key, { userPatterns: config.redaction?.patterns ?? [] });
      guards = { ...context.guards, redactDiagnostic: (text: string) => redact(text).text };
      return redact;
    };
    const common = {
      quarantine,
      canonicalQuarantine,
      paths,
      keyDurable: !options.dryRun || existingKey !== null,
      cap: Math.min(options.limit ?? IMPORT_MAX_FILES_PER_RUN, IMPORT_MAX_FILES_PER_RUN),
      dryRun: options.dryRun,
    };

    if (options.claudeMemory && layout !== null) {
      // The key comes first here: every candidate's path is keyed by its project directory.
      const key = loadKey();
      const redact = bind(key);
      const { candidates, preset } = await enumerateClaudeMemory(context, layout, key);
      return await processCandidates({
        ...common,
        context: { ...context, guards },
        candidates,
        preset,
        captureMethod: "import-claude-memory",
        projectSlug: "claude-memory",
        source: "claude-memory",
        key,
        redact,
      });
    }

    let root = inbox;
    let source: ImportResultV1["source"] = "inbox";
    let projectSlug: "inbox" | "import" = "inbox";
    if (options.path !== null) {
      // Absolute against the injected cwd first: the policy resolves a relative path against the user home.
      const canonical = await context.guards.canonicalize(
        resolve(dependencies.cwd(), options.path),
      );
      try {
        await context.fs.lstat(canonical, { bigint: true });
      } catch (error) {
        if (!isMissingEntry(error)) throw error;
        throw new ImportRunRefusal(
          "import_source_not_found",
          EXIT_CODES.invalidInput,
          "the import source does not exist",
          [canonical],
        );
      }
      const home = await context.guards.canonicalize(paths.home);
      const brain = await context.guards.canonicalize(paths.brain);
      // Both directions: an ancestor would walk into the product home or the vault.
      if (containsPath(home, canonical) || containsPath(canonical, home)) {
        throw new ImportRunRefusal(
          "import_source_in_product_home",
          EXIT_CODES.securityRefusal,
          "the import source overlaps the Developer OS home, which is never imported",
          [canonical],
        );
      }
      const inInbox = containsPath(inbox, canonical);
      if ((containsPath(brain, canonical) || containsPath(canonical, brain)) && !inInbox) {
        throw new ImportRunRefusal(
          "import_source_in_vault",
          EXIT_CODES.invalidInput,
          "the import source overlaps the vault outside its inbox",
          [canonical],
          "move the files into the vault's _raw/inbox, or import them from outside the vault",
        );
      }
      root = canonical;
      source = "path";
      projectSlug = inInbox ? "inbox" : "import";
    }

    // Before the first listing, so a protected directory's entry names are never read.
    try {
      await context.guards.manifest.assertReadable(root);
    } catch (error) {
      if (!(error instanceof SecurityRefusalError)) throw error;
      throw new ImportRunRefusal(
        "import_source_protected",
        EXIT_CODES.securityRefusal,
        "the import source is a protected path and was not read",
        [root],
      );
    }
    const walked = await walk(context, root);

    const key = loadKey();
    const redact = bind(key);

    return await processCandidates({
      ...common,
      context: { ...context, guards },
      candidates: walked.candidates,
      preset: walked.presets,
      captureMethod: "import",
      projectSlug,
      source,
      key,
      redact,
    });
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof ImportRunRefusal ? error.paths : [],
      error instanceof ImportRunRefusal ? error.recovery : undefined,
    );
  }
}

export function renderImport(result: ImportResultV1): readonly string[] {
  const imported = result.files.filter((file) => file.outcome === "imported").length;
  return [
    ...result.files.map(
      (file) =>
        `  ${file.outcome} ${renderPath(file.path)}${file.reason === null ? "" : ` (${renderPath(file.reason)})`}`,
    ),
    `imported ${String(imported)}, duplicates ${String(result.duplicateCount)}, remaining ${String(result.remaining)}`,
  ];
}
