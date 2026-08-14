import { isAbsolute, join, relative, sep, win32 } from "node:path";

import { containsPath } from "@developer-os/core";
import type { BrainConfigV1 } from "@developer-os/core";
import {
  canonicalizePlannedPath,
  screenControlCharacters,
} from "@developer-os/security";
import type { RedactionResult } from "@developer-os/security";

import { compareCanonical, PRIVATE_FOLDERS } from "../discovery/index.js";
import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import type { IndexBuildRequest } from "../indexes/index.js";
import { canonicalizeArtifact, lintBuild } from "../lint/index.js";
import type { LintFinding, LintResult } from "../lint/index.js";
import { parseNote } from "../schema/note.js";
import type { NoteParseResult } from "../schema/note.js";
import { BrainService } from "../service.js";
import type { BrainArtifacts, BrainServiceDependencies } from "../service.js";
import type { IngestProposal, ProposedNote } from "./proposal.js";

/**
 * Spec §6.3's nine, in the order the table states them and the order they run
 * in. **All nine run on every call** and the result carries every finding: a
 * model that produced one bad path probably produced others, and a caller
 * fixing them one exit code at a time is a caller we made do nine round trips.
 *
 * Frozen for the same reason `PRIVATE_FOLDERS` is — `readonly` is erased at
 * runtime, and this list is what a caller enumerates to prove the gate is
 * whole.
 */
export const VALIDATOR_IDS = Object.freeze([
  "schema-and-frontmatter",
  "source-and-provenance",
  "link-and-graph",
  "duplicate-detection",
  "confidence-and-lifecycle",
  "secret-scan",
  "deterministic-reindex",
  "generated-output-consistency",
  "write-scope",
] as const);

/**
 * Narrower than the `string` the plan's interface block declared, and
 * deliberately. A free-form `validator` field lets a typo — `write-scopes` for
 * `write-scope` — compile, never fire, and pass the exhaustiveness test only
 * because the typo also went into the expectation. Every consumer that reads
 * the field as a string still compiles against the union.
 */
export type ValidatorId = (typeof VALIDATOR_IDS)[number];

export interface IngestValidationFinding {
  readonly validator: ValidatorId;
  /**
   * The proposed note's path, content-root-relative and **byte for byte** — or
   * a generated artifact's vault path, for the one validator that is about the
   * index rather than about a note. `null` where the finding is about the
   * proposal as a whole.
   *
   * Unscreened, like every other path in this package: a path is an identifier
   * the user has to be able to act on, and it is screened at the terminal
   * instead (`docs/architecture/brain.md` §5).
   */
  readonly path: string | null;
  /**
   * **Names the class and the file, never the value.** A validation report is
   * written and logged, and the proposal is model output that has just read
   * captured material an attacker may have written. Nothing model-chosen is
   * interpolated here except through a screen.
   */
  readonly message: string;
}

export interface IngestValidationResult {
  readonly ok: boolean;
  readonly findings: readonly IngestValidationFinding[];
}

export interface IngestValidationContext {
  /**
   * The capture this proposal was produced from. `source-and-provenance`
   * compares each note's `sourceCaptureId` against it — a stronger check than
   * any format rule, and the reason `parseIngestProposal` deliberately does not
   * try to answer provenance beyond presence.
   */
  readonly captureId: string;
  /**
   * The `ingest` workflow's declared **write** scopes, already resolved against
   * this install's Brain configuration by the caller and handed over as plain
   * strings. `packages/brain` depends on `core` and `security` only, so neither
   * `WorkflowContractV1` nor `resolveScopeGlob` is reachable from here and
   * nothing in this package sources them at runtime.
   *
   * **They are the upper bound, not the check.** The declared set describes
   * what Developer OS writes across the whole workflow —
   * `content/_indexes/**` is in it because the `reindex` step writes it — while
   * this validator constrains what *the model may propose*, which excludes
   * generated outputs and private folders. The narrowing is subtraction, and
   * `_indexes/index.json` is inside the declared scopes and still refused.
   *
   * This is the write-side twin of the read-side distinction recorded in
   * `./index.ts`: a declared footprint is not a permission set.
   */
  readonly ingestContract: readonly string[];
  /** The install's redaction pass, injected exactly as `buildCapture` takes it. */
  readonly redact: (text: string) => RedactionResult;
  /**
   * How the current vault is read. The projection every content-aware
   * validator runs over is built by overlaying the proposed notes onto these,
   * which is why nothing here needs a staging directory and why a fake reader
   * is enough to exercise the whole gate.
   */
  readonly brain: BrainServiceDependencies;
}

function finding(
  validator: ValidatorId,
  path: string | null,
  message: string,
): IngestValidationFinding {
  return { validator, path, message };
}

/* -------------------------------------------------------------- path shapes */

/**
 * The properties of the *string* that make a path unusable before any
 * filesystem is consulted: absolute in either convention, traversing, empty,
 * or separated by a backslash.
 *
 * `parseIngestProposal` refuses all of these too, and that is not a reason to
 * drop them. This function is total over any `IngestProposal` a caller hands
 * it, including one built in a test or by a future code path that did not go
 * through the parser, and a canonicalizer fed `../../etc/passwd` would happily
 * resolve it rather than refuse it.
 */
function unsafeRelativePath(path: string): boolean {
  if (path.length === 0) return true;
  if (isAbsolute(path) || win32.isAbsolute(path)) return true;
  if (path.includes("\\")) return true;
  return path
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

/* ------------------------------------------------------------ glob matching */

type GlobPart =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "star" };

/**
 * `\` escapes the next character to a literal, because `resolveScopeGlob`
 * escapes the ten glob metacharacters when it splices a configured root into a
 * vocabulary glob — a `contentRoot` of `!inbox` arrives here as `\!inbox` and
 * has to match the one directory it names.
 */
function parseGlobSegment(segment: string): readonly GlobPart[] {
  const parts: GlobPart[] = [];
  let text = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "\\" && index + 1 < segment.length) {
      text += segment[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (character !== "*") {
      text += character ?? "";
      continue;
    }
    if (text.length > 0) {
      parts.push({ kind: "text", value: text });
      text = "";
    }
    if (parts[parts.length - 1]?.kind !== "star") parts.push({ kind: "star" });
  }
  if (text.length > 0) parts.push({ kind: "text", value: text });
  return parts;
}

/**
 * Memoized on the visited `(part, offset)` pairs rather than backtracked
 * freely. A glob is not user input here — it comes from this product's own
 * vocabulary — but a matcher whose cost is exponential in the number of stars
 * is a hazard nobody has to accept for twelve lines.
 */
function segmentMatches(parts: readonly GlobPart[], value: string): boolean {
  const visited = new Set<number>();
  const walk = (partIndex: number, offset: number): boolean => {
    const key = partIndex * (value.length + 1) + offset;
    if (visited.has(key)) return false;
    visited.add(key);

    const part = parts[partIndex];
    if (part === undefined) return offset === value.length;
    if (part.kind === "text") {
      return (
        value.startsWith(part.value, offset) &&
        walk(partIndex + 1, offset + part.value.length)
      );
    }
    for (let next = offset; next <= value.length; next += 1) {
      if (walk(partIndex + 1, next)) return true;
    }
    return false;
  };
  return walk(0, 0);
}

/** `**` spans whole segments; `*` never crosses a `/`. */
function globMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  const visited = new Set<number>();

  const walk = (patternIndex: number, pathIndex: number): boolean => {
    const key = patternIndex * (pathSegments.length + 1) + pathIndex;
    if (visited.has(key)) return false;
    visited.add(key);

    const segment = patternSegments[patternIndex];
    if (segment === undefined) return pathIndex === pathSegments.length;
    if (segment === "**") {
      for (let next = pathIndex; next <= pathSegments.length; next += 1) {
        if (walk(patternIndex + 1, next)) return true;
      }
      return false;
    }

    const value = pathSegments[pathIndex];
    if (value === undefined) return false;
    return (
      segmentMatches(parseGlobSegment(segment), value) &&
      walk(patternIndex + 1, pathIndex + 1)
    );
  };

  return walk(0, 0);
}

/* ---------------------------------------------------------- the projection */

/**
 * The vault as it would be **if this proposal were applied**, assembled in
 * memory: the injected reader and `readFile`, with the proposed notes laid over
 * them.
 *
 * Spec §6.3's preamble says every validator runs "before a single byte reaches
 * staging", while its `deterministic reindex` row says "the index built from
 * the staged result". Both cannot hold — at the point the preamble names, no
 * staging directory exists — and this plan takes the preamble. Nothing is
 * staged to check it, and the property under test is identical either way,
 * because `BrainService.reindex()` returns bytes and reads a `DirectoryReader`
 * rather than a filesystem.
 *
 * What the projection does **not** cover, so nobody has to derive it: it proves
 * the builder is deterministic over the intended bytes, not that the bytes
 * written to staging equal them. The transaction's own `verify` phase covers
 * that, which is why nothing is lost by validating before staging.
 */
function projectionOf(
  deps: BrainServiceDependencies,
  virtual: ReadonlyMap<string, string>,
  reversed: boolean,
): BrainServiceDependencies {
  const entriesUnder = (directory: string): readonly DirectoryEntry[] => {
    const entries = new Map<string, DirectoryEntry>();
    for (const absolute of virtual.keys()) {
      const fromDirectory = relative(directory, absolute);
      if (
        fromDirectory === "" ||
        fromDirectory.startsWith("..") ||
        isAbsolute(fromDirectory)
      ) {
        continue;
      }
      const first = fromDirectory.split(sep)[0];
      if (first === undefined || entries.has(first)) continue;
      const isFile = fromDirectory === first;
      entries.set(first, {
        name: first,
        isDirectory: !isFile,
        isFile,
        isSymbolicLink: false,
      });
    }
    return [...entries.values()];
  };

  const reader: DirectoryReader = {
    async readDir(path: string): Promise<readonly DirectoryEntry[]> {
      const projected = entriesUnder(path);
      let existing: readonly DirectoryEntry[];
      try {
        existing = await deps.reader.readDir(path);
      } catch (error: unknown) {
        /**
         * A proposal may name a folder the vault does not have yet, and the
         * only entry under it is virtual. Swallowing the error unconditionally
         * would instead turn an unreadable *real* directory into an empty one
         * and silently index a vault that is missing notes.
         */
        if (projected.length === 0) throw error;
        existing = [];
      }

      const names = new Set(existing.map((entry) => entry.name));
      const merged = [
        ...existing,
        ...projected.filter((entry) => !names.has(entry.name)),
      ];
      return reversed ? [...merged].reverse() : merged;
    },
  };

  return {
    vaultRoot: deps.vaultRoot,
    config: deps.config,
    reader,
    readFile: (path: string): Promise<string> => {
      const contents = virtual.get(path);
      return contents === undefined
        ? deps.readFile(path)
        : Promise.resolve(contents);
    },
    assertReadable: (path: string): Promise<void> =>
      virtual.has(path) ? Promise.resolve() : deps.assertReadable(path),
    ...(deps.canonicalize === undefined
      ? {}
      : { canonicalize: deps.canonicalize }),
    now: deps.now,
  };
}

/**
 * The same translation `BrainService.buildRequest` performs, which is private
 * to that class. `lintBuild` takes the request form and `reindex` takes the
 * dependency form, and both must describe the *same* projection — drift
 * between them would lint one vault's bytes against another's paths, which
 * `lintBuild`'s own docblock names as the caller's obligation.
 */
function buildRequestOf(deps: BrainServiceDependencies): IndexBuildRequest {
  return {
    vaultRoot: deps.vaultRoot,
    config: deps.config,
    reader: deps.reader,
    readFile: deps.readFile,
    assertReadable: deps.assertReadable,
    ...(deps.canonicalize === undefined
      ? {}
      : { canonicalize: deps.canonicalize }),
    now: () => deps.now().toISOString(),
  };
}

interface Projection {
  readonly forward: BrainArtifacts;
  readonly rebuilt: BrainArtifacts;
  readonly lint: LintResult;
}

async function buildProjection(
  context: IngestValidationContext,
  virtual: ReadonlyMap<string, string>,
): Promise<Projection> {
  const forwardDeps = projectionOf(context.brain, virtual, false);
  const forward = await new BrainService(forwardDeps).reindex();

  /**
   * The rebuild runs through a **reversed** directory reader, which is
   * `docs/architecture/brain.md` §5's determinism invariant stated in full:
   * byte-identical under a frozen clock *and* under a reversed reader. A second
   * build through the same reader re-runs the same directory order and proves
   * almost nothing — it cannot catch an unsorted iteration or a `Map` whose
   * insertion order leaked, which are the regressions this validator exists to
   * catch at ingest time over content the fixture suite has never seen.
   */
  const rebuilt = await new BrainService(
    projectionOf(context.brain, virtual, true),
  ).reindex();

  const lint = await lintBuild(forward.build, {
    build: buildRequestOf(forwardDeps),
    /**
     * Drift is not this gate's business: `index-drift` compares the artifacts
     * on disk against a fresh build, and at this point nothing has been
     * written. Answering `null` reports all four as never built, and those
     * findings are dropped by class below.
     */
    readArtifact: () => Promise.resolve(null),
    today: context.brain.now().toISOString().slice(0, "YYYY-MM-DD".length),
  });

  return { forward, rebuilt, lint };
}

/* -------------------------------------------------------------- validators */

function schemaAndFrontmatter(
  notes: readonly ProposedNote[],
  parsed: ReadonlyMap<ProposedNote, NoteParseResult>,
): readonly IngestValidationFinding[] {
  const findings: IngestValidationFinding[] = [];
  for (const note of notes) {
    const result = parsed.get(note);
    if (result === undefined || result.ok) continue;
    for (const issue of result.issues) {
      if (issue.severity !== "error") continue;
      /**
       * Screened here as well as at its source, for the reason `lint.ts` gives
       * at the same seam: a finding is where foreign text becomes something
       * this process prints, and a message arriving unscreened from any future
       * producer must not reach a terminal through this branch.
       */
      findings.push(
        finding(
          "schema-and-frontmatter",
          note.path,
          screenControlCharacters(issue.message),
        ),
      );
    }
  }
  return findings;
}

function sourceAndProvenance(
  notes: readonly ProposedNote[],
  captureId: string,
): readonly IngestValidationFinding[] {
  return notes
    .filter((note) => note.sourceCaptureId !== captureId)
    .map((note) =>
      finding(
        "source-and-provenance",
        note.path,
        /** Neither id is echoed: one is model-chosen and the report is logged. */
        "this note does not name the capture it came from",
      ),
    );
}

function confidenceAndLifecycle(
  notes: readonly ProposedNote[],
  parsed: ReadonlyMap<ProposedNote, NoteParseResult>,
): readonly IngestValidationFinding[] {
  const findings: IngestValidationFinding[] = [];
  for (const note of notes) {
    const result = parsed.get(note);
    if (result === undefined || !result.ok) continue;
    const front = result.note.frontmatter;

    /**
     * `NoteFrontmatterV1` requires the same keys whatever the stage, so "the
     * frontmatter a stage requires" is a policy this validator states rather
     * than one the schema already carries. Two rules, each closing a claim the
     * frontmatter would otherwise contradict:
     *
     * - `established` with `reviewed: null` says "this is settled knowledge"
     *   and "nobody has read this" in the same block. Spec §4.2 makes
     *   `reviewed: null` an explicit *deliberate* "nobody has reviewed this",
     *   not an absent key, which is exactly what makes the pair a contradiction
     *   rather than an omission — and a model must not promote its own proposal
     *   past the review the user is about to perform.
     * - `deprecated` with no `updated` retires a note without recording when.
     *   Nothing else in the vocabulary carries that date, and `created` is the
     *   wrong one.
     *
     * `emerging` requires nothing beyond the schema, because it is the stage a
     * new proposal belongs in.
     */
    if (front.stage === "established" && front.reviewed === null) {
      findings.push(
        finding(
          "confidence-and-lifecycle",
          note.path,
          "stage established requires a reviewed date; a proposal may not record settled knowledge and an unread note in the same frontmatter",
        ),
      );
    }
    if (front.stage === "deprecated" && front.updated === undefined) {
      findings.push(
        finding(
          "confidence-and-lifecycle",
          note.path,
          "stage deprecated requires updated, which is the only key that records when the note's standing changed",
        ),
      );
    }
  }
  return findings;
}

function secretScan(
  notes: readonly ProposedNote[],
  redact: (text: string) => RedactionResult,
): readonly IngestValidationFinding[] {
  const findings: IngestValidationFinding[] = [];
  for (const note of notes) {
    const classes = new Set<string>();
    /**
     * The path and the provenance id as well as the body. "The redaction pass
     * finds anything in the proposal" is the rule, and a model that puts a
     * token in a filename has put it somewhere the vault will keep it.
     */
    for (const value of [note.path, note.contents, note.sourceCaptureId]) {
      for (const found of redact(value).findings) classes.add(found.class);
    }
    if (classes.size === 0) continue;

    /**
     * The class names, which are this product's own constants, and the file.
     * Never the value, never the redacted text, never the fingerprint — a
     * validation report is written and logged.
     */
    findings.push(
      finding(
        "secret-scan",
        note.path,
        `the redaction pass found ${[...classes].sort(compareCanonical).join(", ")} in this note`,
      ),
    );
  }
  return findings;
}

/* ------------------------------------------------- write scope and its twin */

interface ResolvedNote {
  readonly note: ProposedNote;
  readonly segments: readonly string[];
  readonly unsafe: boolean;
  /** `null` when the path is unsafe or the canonicalizer refused it. */
  readonly canonical: string | null;
}

function excludedSegment(
  segments: readonly string[],
  config: BrainConfigV1,
): boolean {
  const indexesDir = config.indexesDir.normalize("NFC");
  return segments.some((raw) => {
    const segment = raw.normalize("NFC");
    return (
      segment.startsWith(".") ||
      segment === indexesDir ||
      PRIVATE_FOLDERS.includes(segment)
    );
  });
}

function writeScope(
  resolved: readonly ResolvedNote[],
  context: IngestValidationContext,
  contentRootCanonical: string | null,
): readonly IngestValidationFinding[] {
  const findings: IngestValidationFinding[] = [];
  const { config } = context.brain;
  const contentRoot = config.contentRoot.normalize("NFC");

  for (const entry of resolved) {
    const { note } = entry;

    if (entry.unsafe) {
      findings.push(
        finding(
          "write-scope",
          note.path,
          "this path is absolute, empty, or traverses upward; a proposed note is named relative to the content root",
        ),
      );
      continue;
    }

    /**
     * The declared scopes are consulted first and are the **upper bound**: a
     * path outside them is refused whatever else is true of it. Narrowing the
     * contract therefore changes the answer for a path nothing else about has
     * changed, which is the only way to tell a real check from a hardcoded root.
     */
    const vaultRelative = `${contentRoot}/${note.path}`.normalize("NFC");
    if (
      !context.ingestContract.some((glob) => globMatches(glob, vaultRelative))
    ) {
      findings.push(
        finding(
          "write-scope",
          note.path,
          "this path falls outside the write scopes the ingest workflow declares",
        ),
      );
      continue;
    }

    /**
     * Then the subtraction. `content/_indexes/**` is inside the declared set —
     * the `reindex` step is why it is declared at all — and a *proposal* may
     * write neither it nor a private folder nor a dot-segment discovery would
     * never index.
     */
    if (excludedSegment(entry.segments, config)) {
      findings.push(
        finding(
          "write-scope",
          note.path,
          "this path names a private folder, the indexes directory, or a dot-segment, none of which a proposal may write",
        ),
      );
      continue;
    }

    /**
     * The destination, not the written path, because a symlink is exactly the
     * thing that makes those differ. A check on the written path is the bug
     * this branch exists to prevent.
     */
    if (
      contentRootCanonical === null ||
      entry.canonical === null ||
      !containsPath(contentRootCanonical, entry.canonical)
    ) {
      findings.push(
        finding(
          "write-scope",
          note.path,
          "this path resolves outside the content root once symlinks are followed",
        ),
      );
    }
  }

  return findings;
}

function generatedOutputConsistency(
  resolved: readonly ResolvedNote[],
  config: BrainConfigV1,
  indexesRootCanonical: string | null,
): readonly IngestValidationFinding[] {
  const indexesDir = config.indexesDir.normalize("NFC");
  const findings: IngestValidationFinding[] = [];

  for (const entry of resolved) {
    const named = entry.segments.some(
      (segment) => segment.normalize("NFC") === indexesDir,
    );
    /**
     * The resolved destination too, so a link named innocently but pointing at
     * the indexes directory is refused on the same terms as a path that spells
     * it out. `reindex` owns those four artifacts; a proposal that writes one
     * makes the index disagree with the vault it indexes.
     */
    const resolves =
      indexesRootCanonical !== null &&
      entry.canonical !== null &&
      containsPath(indexesRootCanonical, entry.canonical);

    if (!named && !resolves) continue;
    findings.push(
      finding(
        "generated-output-consistency",
        entry.note.path,
        "this path targets a generated artifact under the indexes directory, which reindex owns",
      ),
    );
  }

  return findings;
}

/* ------------------------------------------------------------------- entry */

/**
 * `null` rather than a throw, because `validateProposal` is **total**: a
 * canonicalizer that refuses is an answer, and the write-scope branch reads a
 * missing canonical form as "resolves outside the content root".
 */
async function canonicalizeOrNull(
  canonicalize: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    return await canonicalize(path);
  } catch {
    return null;
  }
}

async function resolveNotes(
  notes: readonly ProposedNote[],
  context: IngestValidationContext,
  canonicalize: (path: string) => Promise<string>,
): Promise<readonly ResolvedNote[]> {
  const { vaultRoot, config } = context.brain;
  const resolved: ResolvedNote[] = [];

  for (const note of notes) {
    const unsafe = unsafeRelativePath(note.path);
    resolved.push({
      note,
      segments: unsafe ? [] : note.path.split("/"),
      unsafe,
      canonical: unsafe
        ? null
        : await canonicalizeOrNull(
            canonicalize,
            join(vaultRoot, config.contentRoot, note.path),
          ),
    });
  }

  return resolved;
}

/**
 * Every proposed note that is safe to lay over the vault, keyed by the absolute
 * path discovery will build for it.
 *
 * A path that traverses or is absolute is left out on purpose: projecting one
 * would ask the index builder to read a file outside the vault, which is the
 * opposite of what a gate does. Those notes are refused by `write-scope`
 * anyway, and the remaining validators then report on a projection that is a
 * real vault rather than an impossible one.
 */
function virtualNotes(
  resolved: readonly ResolvedNote[],
  context: IngestValidationContext,
): ReadonlyMap<string, string> {
  const { vaultRoot, config } = context.brain;
  const virtual = new Map<string, string>();
  for (const entry of resolved) {
    if (entry.unsafe) continue;
    virtual.set(
      join(vaultRoot, config.contentRoot, entry.note.path),
      entry.note.contents,
    );
  }
  return virtual;
}

/**
 * The gate between a model's proposal and the user's vault.
 *
 * **Total and side-effect-free** — not pure, because canonicalization resolves
 * real symlinks against a real filesystem, which is the whole point of the
 * destination check. Nothing here writes, stages, or mutates: every filesystem
 * mutation follows `plan → backup → stage → validate → apply → verify →
 * finalize`, and this runs before any of it.
 *
 * **A failure at any validator leaves the capture `accepted` and retryable,
 * never `ingested`.** `failed` describes a capture whose own envelope is
 * unreadable, and nothing here can produce one.
 */
export async function validateProposal(
  proposal: IngestProposal,
  context: IngestValidationContext,
): Promise<IngestValidationResult> {
  const { config, vaultRoot } = context.brain;
  const canonicalize = context.brain.canonicalize ?? canonicalizePlannedPath;
  const notes = proposal.notes;

  const parsed = new Map<ProposedNote, NoteParseResult>();
  for (const note of notes) parsed.set(note, parseNote(note.contents));

  const resolved = await resolveNotes(notes, context, canonicalize);
  const contentRootCanonical = await canonicalizeOrNull(
    canonicalize,
    join(vaultRoot, config.contentRoot),
  );
  const indexesRootCanonical = await canonicalizeOrNull(
    canonicalize,
    join(vaultRoot, config.contentRoot, config.indexesDir),
  );

  let projection: Projection | null = null;
  try {
    projection = await buildProjection(context, virtualNotes(resolved, context));
  } catch {
    /**
     * A vault that cannot be walked with this proposal applied cannot be
     * certified, and the three validators that read the projection each say so
     * rather than passing silently. Discovery refuses an escaping symlink by
     * throwing, so this is a reachable state and not a defensive branch.
     */
    projection = null;
  }

  const contentRoot = config.contentRoot.normalize("NFC");
  const proposedByVaultPath = new Map<string, string>();
  for (const note of notes) {
    proposedByVaultPath.set(
      `${contentRoot}/${note.path}`.normalize("NFC"),
      note.path,
    );
  }

  const findings: IngestValidationFinding[] = [
    ...schemaAndFrontmatter(notes, parsed),
    ...sourceAndProvenance(notes, context.captureId),
    ...linkAndGraph(projection, proposedByVaultPath),
    ...duplicateDetection(projection, proposedByVaultPath),
    ...confidenceAndLifecycle(notes, parsed),
    ...secretScan(notes, context.redact),
    ...deterministicReindex(projection),
    ...generatedOutputConsistency(resolved, config, indexesRootCanonical),
    ...writeScope(resolved, context, contentRootCanonical),
  ];

  return { ok: findings.length === 0, findings };
}

/**
 * Every lint finding of one class that names a note **this proposal** would
 * write. An existing pair of duplicates in the user's vault is their curation
 * question and not a reason to refuse a proposal that has nothing to do with
 * it; the messages come from `lint.ts`, already screened and already bounded.
 */
function fromLint(
  projection: Projection | null,
  proposedByVaultPath: ReadonlyMap<string, string>,
  validator: ValidatorId,
  keep: (entry: LintFinding) => boolean,
  unavailable: string,
): readonly IngestValidationFinding[] {
  if (projection === null) return [finding(validator, null, unavailable)];
  return projection.lint.findings
    .filter(keep)
    .flatMap((entry) => {
      const path = proposedByVaultPath.get(entry.path.normalize("NFC"));
      return path === undefined ? [] : [finding(validator, path, entry.message)];
    });
}

function linkAndGraph(
  projection: Projection | null,
  proposedByVaultPath: ReadonlyMap<string, string>,
): readonly IngestValidationFinding[] {
  /**
   * The unresolved half of spec §6.3's row, and only that half. **The graph
   * builder rejects no cycle** — two notes that reference each other are the
   * ordinary shape of a knowledge vault, and `buildIndex` builds that graph
   * without complaint — so "a proposed link would create a cycle the graph
   * builder rejects" names a refusal this package has no counterpart for.
   * Inventing one here would be a policy the spec did not state and the builder
   * does not hold; it is recorded rather than fabricated.
   */
  return fromLint(
    projection,
    proposedByVaultPath,
    "link-and-graph",
    (entry) => entry.class === "links" && entry.severity === "error",
    "the vault with this proposal applied could not be indexed, so its links could not be resolved",
  );
}

function duplicateDetection(
  projection: Projection | null,
  proposedByVaultPath: ReadonlyMap<string, string>,
): readonly IngestValidationFinding[] {
  return fromLint(
    projection,
    proposedByVaultPath,
    "duplicate-detection",
    (entry) => entry.class === "duplicates",
    "the vault with this proposal applied could not be indexed, so duplicates could not be detected",
  );
}

function deterministicReindex(projection: Projection | null): readonly IngestValidationFinding[] {
  if (projection === null) {
    return [
      finding(
        "deterministic-reindex",
        null,
        "the vault with this proposal applied could not be indexed, so a rebuild could not be compared",
      ),
    ];
  }

  const findings: IngestValidationFinding[] = [];
  const first = projection.forward.files;
  const second = projection.rebuilt.files;

  for (const path of [...new Set([...Object.keys(first), ...Object.keys(second)])].sort(
    compareCanonical,
  )) {
    const left = first[path];
    const right = second[path];
    /**
     * `generatedAt` is neutralized on both sides, exactly as `index-drift`
     * does it: the clock moves between two builds and a byte comparison would
     * report a difference that is not one. Everything else is compared byte for
     * byte, which is why the value is replaced textually rather than by
     * re-serializing — re-serializing would mask a real formatting difference.
     */
    if (
      left !== undefined &&
      right !== undefined &&
      canonicalizeArtifact(left) === canonicalizeArtifact(right)
    ) {
      continue;
    }
    findings.push(
      finding(
        "deterministic-reindex",
        path,
        "the index built from this proposal is not byte-identical to a rebuild of the same projection",
      ),
    );
  }

  return findings;
}
