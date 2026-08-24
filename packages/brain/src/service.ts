import { join } from "node:path";

import type { BrainConfigV1 } from "@developer-os/core";

import type { DirectoryReader } from "./discovery/index.js";
import { artifactPaths, buildIndex, renderArtifacts } from "./indexes/index.js";
import type {
  IndexBuildRequest,
  IndexBuildResult,
  IndexDocumentV1,
} from "./indexes/index.js";
import { lintBuild, lintVault } from "./lint/index.js";
import type { LintFinding, LintRequest, LintResult } from "./lint/index.js";
import { search } from "./retrieval/index.js";
import { NOTE_STAGES } from "./schema/note.js";
import type { RetrievalQuery, RetrievalResult } from "./retrieval/index.js";

export interface BrainArtifacts {
  /** Vault-relative path to bytes. Nothing here has been written anywhere. */
  readonly files: Readonly<Record<string, string>>;
  readonly build: IndexBuildResult;
}

/**
 * Everything the Brain is allowed to touch, and **no write channel**.
 *
 * That absence is the design. "`reindex` does not write" is not a promise the
 * implementation keeps; it is a sentence this type makes unsayable, which is
 * what keeps the "no direct filesystem mutation of a user's notes" constraint
 * mechanical rather than aspirational. The CLI stages the returned bytes
 * through Foundation's `TransactionExecutor`.
 */
export interface BrainServiceDependencies {
  readonly vaultRoot: string;
  readonly config: BrainConfigV1;
  readonly reader: DirectoryReader;
  readonly readFile: (path: string) => Promise<string>;
  readonly assertReadable: (path: string) => Promise<void>;
  readonly canonicalize?: (path: string) => Promise<string>;
  readonly now: () => Date;
}

export interface BrainStatusReportV1 {
  readonly schemaVersion: 1;
  readonly vaultRoot: string;
  readonly contentRoot: string;
  readonly noteCount: number;
  readonly topicFolders: readonly string[];
  readonly unclassifiedFolders: readonly string[];
  readonly indexPresent: boolean;
  /** Adoption findings: what would have to change for this vault to validate. */
  readonly wouldChange: readonly LintFinding[];
}

/**
 * A third outcome beside Brain architecture former §8's two, and deliberately not folded into
 * `RetrievalResult`.
 *
 * "The index is not built" and "no note matches" are different answers to
 * different questions, and returning `no-candidates` for both would teach the
 * user to disbelieve the genuine miss. `RetrievalResult` is Brain architecture former §8's shape and
 * belongs to the pure function; this variant belongs to the facade that has to
 * touch a filesystem. Throwing was the alternative and is wrong: a vault nobody
 * has indexed yet is an expected state, not a defect.
 */
export interface BrainIndexUnavailable {
  readonly kind: "index-unavailable";
  /**
   * Discriminated, so the CLI does not have to match on English. "missing"
   * means reindex; "unreadable" means the file is there and wrong, which is a
   * different conversation to have with a user about their vault.
   */
  readonly reason: "missing" | "unreadable";
  readonly message: string;
}

export type BrainSearchOutcome = RetrievalResult | BrainIndexUnavailable;

/**
 * Adoption is about whether the vault *validates*, not whether it is tidy.
 *
 * Stated as an allow-list, because writing it as a subtraction let two classes
 * through by omission. Brain architecture former §9 names three examples — missing required keys,
 * folders that are neither configured nor private, unresolved links — and the
 * rule that covers all three is: **every error except `index-drift`, plus
 * `frontmatter` at warn**, which is where the unclassified-folder finding lives.
 *
 * What that deliberately leaves out, and why each one is housekeeping rather
 * than shape:
 *
 * - `staleness` — a review from two years ago is a valid note.
 * - `provenance` at warn — so is one an agent wrote and nobody has read.
 * - `duplicates` at warn — Brain architecture former §7 says it outright: "Two notes with the same
 *   title are a curation question." (The case-collision row is an `error` and
 *   is included, which is the same spec sentence's other half: "a data-loss
 *   question the moment the vault is cloned".)
 * - `links` at warn — an ambiguous link resolves, deterministically. Nothing
 *   has to change for the vault to validate.
 * - `index-drift` — on a vault nobody has indexed yet *every* artifact is
 *   missing, and `indexPresent` is the field that says so. Folding four
 *   missing-artifact errors in here would tell someone with a flawless vault
 *   that four things are wrong with their notes.
 */
function isAdoptionFinding(finding: LintFinding): boolean {
  if (finding.class === "index-drift") return false;
  if (finding.severity === "error") return true;
  return finding.class === "frontmatter" && finding.severity === "warn";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** `stage` reaches `--json` as a `NoteStage`; a free-form string must not. */
function isNoteStage(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (NOTE_STAGES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of an index read off disk, because it is a file in the
 * user's vault that a text editor can reach. Retrieval reads `path`, `title`,
 * `summary`, `stage`, `reviewed`, `tags`, `aliases`, `type`, `topicFolder` and
 * `terms`, so those are what is checked — a half-valid document would otherwise
 * produce matches with `undefined` fields and a `--json` consumer downstream.
 *
 * This is not the full schema: `lint` rebuilds the index from the notes and
 * compares, which is the check that catches a *plausible* but wrong index. This
 * only has to stop a corrupt one being searched.
 */
function parseIndexDocument(text: string): IndexDocumentV1 | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;
  if (raw["schemaVersion"] !== 1) return null;
  if (typeof raw["contentRoot"] !== "string") return null;
  if (typeof raw["generatedAt"] !== "string") return null;

  const notes = raw["notes"];
  if (!Array.isArray(notes)) return null;

  const stringFields = ["path", "title", "summary", "type", "topicFolder"];
  for (const note of notes as unknown[]) {
    if (!isRecord(note)) return null;
    if (stringFields.some((field) => typeof note[field] !== "string")) return null;

    const reviewed = note["reviewed"];
    if (reviewed !== null && typeof reviewed !== "string") return null;
    if (!isNoteStage(note["stage"])) return null;

    /**
     * Elements, not just containers. `Array.isArray` alone let
     * `tags: [123]` through, and `search` then called `.normalize()` on a
     * number — an unhandled `TypeError` and a stack trace where the whole
     * point of this function is to return `index-unavailable`. A
     * `terms` entry with a string `count` was worse: it coerced silently
     * into the score arithmetic and changed the ranking.
     */
    if (!isStringArray(note["tags"]) || !isStringArray(note["aliases"])) {
      return null;
    }
    const terms = note["terms"];
    if (!Array.isArray(terms)) return null;
    for (const term of terms as unknown[]) {
      if (!isRecord(term)) return null;
      if (typeof term["term"] !== "string") return null;
      if (!Number.isInteger(term["count"])) return null;
    }
  }

  return raw as unknown as IndexDocumentV1;
}

export class BrainService {
  constructor(private readonly deps: BrainServiceDependencies) {}

  private buildRequest(): IndexBuildRequest {
    const { deps } = this;
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

  /**
   * `null` for an artifact that is not there. It conflates "missing" with
   * "unreadable" — a directory in its place, or a permission error — because
   * the injected `readFile` has one failure channel. The consequence is that an
   * unreadable `_indexes/` reports as drift rather than as a permission
   * problem; the CLI, which owns the real filesystem, is where that distinction
   * can be made.
   */
  private async readArtifact(vaultPath: string): Promise<string | null> {
    try {
      return await this.deps.readFile(join(this.deps.vaultRoot, vaultPath));
    } catch {
      return null;
    }
  }

  /** Builds, then renders. Returns bytes; writes nothing, and cannot. */
  async reindex(): Promise<BrainArtifacts> {
    const build = await buildIndex(this.buildRequest());
    return { files: renderArtifacts(build, this.deps.config), build };
  }

  private lintRequest(): LintRequest {
    return {
      build: this.buildRequest(),
      readArtifact: (vaultPath: string) => this.readArtifact(vaultPath),
      today: this.deps.now().toISOString().slice(0, "YYYY-MM-DD".length),
    };
  }

  async lint(): Promise<LintResult> {
    return lintVault(this.lintRequest());
  }

  /**
   * Index-first, per design spec §13.5: this reads one file and never opens a
   * note. Rebuilding here would make every search cost a full vault walk and
   * would quietly hide the fact that the index was stale.
   */
  /**
   * Throws `RangeError` when `maxCandidates` is not a positive integer. That is
   * a caller bug rather than a vault state, so it is not a variant of the
   * union — but it is a fourth thing that can come out of this method, and Task
   * 9 needs a `try`/`catch` mapping it to the invalid-input exit code.
   */
  async search(query: RetrievalQuery): Promise<BrainSearchOutcome> {
    const path = artifactPaths(this.deps.config).index;
    const text = await this.readArtifact(path);
    if (text === null) {
      return {
        kind: "index-unavailable",
        reason: "missing",
        message: `${path} is missing; run developer-os brain reindex`,
      };
    }

    const index = parseIndexDocument(text);
    if (index === null) {
      return {
        kind: "index-unavailable",
        reason: "unreadable",
        message: `${path} is not a readable index; run developer-os brain reindex`,
      };
    }

    return search(index, query);
  }

  /** Discovery counts plus the adoption findings, changing nothing. */
  async status(): Promise<BrainStatusReportV1> {
    /**
     * One build, shared. Calling `lint()` and then building again walked and
     * parsed the whole vault twice for a single `brain status`.
     */
    const build = await buildIndex(this.buildRequest());

    /**
     * One read per artifact for the whole call. Drift reads all four and
     * `indexPresent` needs one of them; without the memo the index was read
     * twice and the two reads were not guaranteed to agree.
     */
    const cache = new Map<string, string | null>();
    const readOnce = async (vaultPath: string): Promise<string | null> => {
      if (!cache.has(vaultPath)) {
        cache.set(vaultPath, await this.readArtifact(vaultPath));
      }
      return cache.get(vaultPath) ?? null;
    };

    const linted = await lintBuild(build, {
      ...this.lintRequest(),
      readArtifact: readOnce,
    });
    const indexPresent =
      (await readOnce(artifactPaths(this.deps.config).index)) !== null;

    return {
      schemaVersion: 1,
      vaultRoot: this.deps.vaultRoot,
      contentRoot: this.deps.config.contentRoot.normalize("NFC"),
      noteCount: build.index.notes.length,
      topicFolders: [...this.deps.config.topicFolders],
      unclassifiedFolders: build.unclassifiedFolders,
      indexPresent,
      wouldChange: linted.findings.filter(isAdoptionFinding),
    };
  }
}
