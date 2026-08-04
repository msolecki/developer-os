# Developer OS Brain Engine Design

**Date:** 2026-08-04

**Status:** Approved design; implementation plan pending

**Scope:** Program Task 2 (`DOS-P2`) — the vault schema, deterministic indexes, lint,
and index-first retrieval that let `developer-os` initialize, validate, index, and
search a Brain with no agent adapter present

**Consumes:** `DeveloperOsConfigV1`, `RuntimePaths`, `ChangePlanV1`, `TransactionStore`,
`CliResult`, `EXIT_CODES`, and the `packages/security` path and redaction primitives, all
frozen at Foundation Task 9 and listed in `docs/architecture/foundation.md` §2.

## Problem

Foundation installs and removes itself and deliberately owns no Brain content: `init`
creates a vault directory and one `.gitkeep`, writes no note, and never modifies a vault
that already exists. Everything that makes a vault a *Brain* — a schema worth validating,
indexes worth trusting, and retrieval that can name its sources — does not exist.

The value being ported is deterministic, not clever. A vault is ordinary Obsidian Markdown
that a user can open, edit, copy, or sync without this product; the engine's job is to make
that pile of Markdown answerable without ever becoming the thing that owns it.

Two failure modes shape every decision below. The first is an index that is *almost*
reproducible, which is worse than one that is obviously not, because drift detection built
on it reports noise until people stop reading it. The second is retrieval that returns a
plausible answer no one can trace to a file.

## Decision summary

| Question | Decision |
|---|---|
| CLI surface | a `brain` command group; `developer-os search` is an alias for `brain search` |
| Unknown frontmatter keys | known keys strictly typed; unknown keys preserved and reported at `info` |
| Index artifacts | `index.json` and `graph.json` are canonical; the two Markdown files are rendered views |
| Retrieval | structural funnel first, integer lexical scoring inside it, explicit `no-candidates` |
| Trust model | `stage` enum plus review provenance; no numeric confidence, and nothing unfalsifiable ranks |

---

## 1. Scope

**In scope.** Vault schema and folder policy; note discovery; deterministic index and graph
generation; the two rendered Markdown views; six lint classes; index-first retrieval; the
`brain` CLI group; the synthetic vault template; migration scaffolding and an adoption
report.

**Out of scope, and owned elsewhere.** Capture creation, redaction, quarantine, review,
staging, and the ingest transaction belong to `DOS-P6`. This subsystem defines
`CaptureEnvelopeV1` as a *type* with its six statuses and writes none of them; nothing in
`packages/brain` creates, transitions, or reads a capture in v1. Workflows are `DOS-P3`.
Agent invocation is `DOS-P4` and `DOS-P5`.

The split is deliberate. `DOS-P6` needs the envelope type to exist before it can be
hardened, and putting the type here — beside the note schema it eventually produces — keeps
one package owning the shape of everything that ends up in a vault. Putting the *transitions*
here would mean shipping a lifecycle with no security review, which is exactly what `DOS-P6`
exists to prevent.

## 2. Package boundaries

`@developer-os/brain` depends on `core` and `security`, and on nothing else in this
repository. It has no knowledge of an agent, a workflow, or a command.

| Path | Responsibility |
|---|---|
| `packages/brain/src/schema/` | `NoteFrontmatterV1`, `BrainConfigV1`, `CaptureEnvelopeV1`; parsing, the reserved vocabulary, unknown-key preservation |
| `packages/brain/src/discovery/` | folder policy and deny-by-default enumeration |
| `packages/brain/src/indexes/` | `IndexBuildResult`; building `index.json` and `graph.json`, rendering the two Markdown views |
| `packages/brain/src/lint/` | the six lint classes and `LintResult` |
| `packages/brain/src/retrieval/` | `RetrievalQuery`, `RetrievalResult`, the two-stage funnel and the scorer |
| `packages/brain/src/migrations/` | `BrainMigration`, the registry, and the adoption report |
| `packages/brain/src/service.ts` | `BrainService` — the only module the CLI imports |

`BrainService` is a facade over the six directories and the single seam the CLI is written
against. Commands construct nothing else; the composition root in `apps/cli/src/context.ts`
supplies it, exactly as it supplies every other Foundation dependency.

Every function in this package takes its clock, its filesystem, and its directory reader as
arguments. That is not stylistic: §6's determinism gate is only testable if the directory
reader can be replaced with one that returns entries in a hostile order.

## 3. Configuration

`BrainConfigV1` lives in an optional `[brain]` section of `~/.developer-os/config.toml`,
not in the vault. Design spec §7 forbids writing product manifests, logs, or installer
state into the Obsidian content tree, and a configuration file the product parses on every
command is product state.

```typescript
export interface BrainConfigV1 {
  readonly schemaVersion: 1;
  readonly contentRoot: string;                          // vault-relative, default "content"
  readonly topicFolders: readonly string[];              // scanned as canonical notes
  readonly topicAliases: Readonly<Record<string, string>>; // "PROJEKTY" -> "PROJECTS"
  readonly indexesDir: string;                           // vault-relative, default "_indexes"
  readonly retrieval: { readonly maxCandidates: number };  // default 10
  readonly staleness: { readonly reviewAfterDays: number }; // default 180
}
```

Defaults for a new vault: `topicFolders` is `["PROJECTS", "TOOLS", "DEV", "INFRA", "QA"]`
and `topicAliases` is empty. Aliases are configuration a user or a migration adds; they are
never a legacy lookup table compiled into the product.

**This extends a frozen interface, and the shape of the extension is load-bearing.**
`configSchema` in `packages/core/src/config/loader.ts` is `.strict()`, so an unknown
`[brain]` table is currently a parse error. Every config written to date lacks the section.
The field is therefore `.optional()` with a documented default, and `schemaVersion` stays
`1` — a required section, or a version bump, would make every existing installation fail to
load on upgrade. `serializeConfig` emits the section only when it differs from the default,
so `init` on a default vault produces a byte-identical config to the one Foundation writes
today.

## 4. Note contract

### 4.1 Identity

**A note's identity is its vault-relative path.** There is no `id` field. Two notes cannot
collide, because two files cannot occupy one path — with one exception that matters on the
only platform this product supports: APFS is case-insensitive by default, so `Caching.md`
and `caching.md` are one file on the founder's machine and two in a case-sensitive
checkout or a Git repository. That is a lint error (§7), not a silent overwrite.

### 4.2 Reserved vocabulary

```yaml
---
schemaVersion: 1                     # literal 1, required
title: Widget cache invalidation     # string, required, non-empty
type: knowledge-note                 # enum, required
created: 2026-08-04                  # YYYY-MM-DD, required
updated: 2026-08-04                  # YYYY-MM-DD, optional
tags: [dev, caching]                 # string[], required, may be empty
aliases: [cache busting]             # string[], optional
summary: One sentence.               # string, required, <= 400 characters
stage: emerging                      # emerging | established | deprecated, required
author: agent                        # agent | human, required
reviewed: null                       # YYYY-MM-DD or explicit null, required
occurrences: 3                       # integer >= 1, optional, default 1
sources: [DEV/caching.md]            # string[], optional, vault-relative or absolute URL
---
```

`type` is one of `knowledge-note`, `compiled-note`, `project-note`, `reference-note`.
`tags` and `aliases` keep Obsidian's native spelling and semantics deliberately; the engine
reads the same keys Obsidian does rather than shadowing them.

`reviewed` is required and may be `null`, rather than optional. An absent key and a
deliberate "nobody has reviewed this" are different facts, and the provenance lint in §7
depends on telling them apart.

### 4.3 Unknown keys

Keys outside the reserved vocabulary are **preserved byte-identically** on any rewrite and
reported by the `frontmatter` lint class at `info` severity. They are never an error.

This is a deliberate divergence from the rule `DOS-P3` applies to workflow contracts, where
unknown fields are rejected. The two cases are not alike: a workflow contract is an artifact
this product generates and owns end to end, while a vault is a user's own Markdown that
Obsidian, Dataview, Templater, and Bases all write frontmatter into. Rejecting unknown keys
would turn "install an Obsidian plugin" into "your vault is now red", and would quietly
retract design spec §12's promise that the vault works without Developer OS. Strictness is
kept where it protects us — on our own fields, whose types and enums are enforced exactly.

Preservation is a contract, not an intention: a note read and rewritten with no semantic
change must be byte-identical, including key order, comment placement, quoting style, and
block scalar form. The parse layer therefore retains the original frontmatter text and
patches it, rather than re-serializing a parsed object.

## 5. Folder policy — deny by default

Canonical notes are `<contentRoot>/<topicFolder>/**/*.md` for each configured topic folder,
after alias resolution.

Never scanned as canonical, at any depth: `_raw/` (and its `quarantine/`, `inbox/`,
`processed/` children), `_outputs/`, `_graveyard/`, `_indexes/`, `templates/`, `.obsidian/`,
and any path segment beginning with `.`.

**A folder under `contentRoot` that is neither a configured topic folder nor a known
private folder is not indexed**, and lint reports `unclassified-folder` at `warn`. The
alternative — scanning anything that is not explicitly excluded — means that the day a user
creates `content/Scratch/` their half-written notes enter the index, the catalog, and
session-start injection without anyone deciding that. Deny-by-default makes the failure
loud instead of silent, which is the only reason the lint class exists.

Exclusion is evaluated on the vault-relative path **before any file is opened**, so an
excluded tree costs no reads and cannot fail a parse. Every path is resolved through the
`packages/security` canonicalization used by Foundation, so a symlink out of the vault is
refused rather than followed.

`topicAliases` resolves at read time only: a vault containing `PROJEKTY/` with
`{ "PROJEKTY": "PROJECTS" }` configured is indexed as though its notes were in `PROJECTS`,
and the directory on disk is not touched. Migration never renames a folder automatically —
that rule comes from design spec §12 and is not this subsystem's to relax.

## 6. Indexes and the determinism contract

`brain reindex` performs one build and writes four artifacts into `<contentRoot>/<indexesDir>/`.

| Artifact | Role |
|---|---|
| `index.json` | canonical: every note's fields, content hash, and term counts; folder and tag rollups |
| `graph.json` | canonical: nodes and resolved wikilink edges |
| `vault-map.md` | rendered from the in-memory build result: folder table, tag cloud, recent changes |
| `catalog.md` | rendered from the same result: per-folder listing with summaries |

**The Markdown is never parsed back.** Retrieval, lint, and drift detection read
`index.json` and `graph.json` only. This is the whole reason for the split: the moment a
consumer parses a table out of `vault-map.md`, changing that table's layout becomes a
retrieval bug, and the human-facing view can no longer be improved without risk.

### 6.1 The contract

1. **Time enters through one door.** `generatedAt` is taken from the injected clock and is
   the only time-derived value in any artifact. It appears exactly once per artifact, at a
   fixed location — a top-level key in each JSON file, a frontmatter key in each Markdown
   file. No `mtime`, `ctime`, or wall-clock read occurs anywhere in the build; "recent
   changes" in `vault-map.md` is ordered by the `updated`/`created` frontmatter fields,
   which are content, not filesystem metadata.
2. **Every array has a stated total order**, sorted byte-wise over the NFC-normalized UTF-8
   encoding. Notes sort by path, tags by tag, folders by configured order then name, edges
   by `(source, target)`. `localeCompare` is forbidden: it is locale- and ICU-version-
   dependent, so two machines with the same input would disagree.
3. **Paths are vault-relative, POSIX-separated, and NFC-normalized.** macOS returns NFD
   from `readdir`, so a note named `zażółć.md` arrives with decomposed diacritics while the
   same file committed from a Linux CI checkout arrives composed. Without normalization the
   index differs across machines for a file nobody edited.
4. **No float is ever stored.** Scores are computed at query time and never persisted, so
   float formatting cannot enter an artifact. `occurrences` and every count are integers.
5. **Serialization is fixed:** two-space indent, LF endings, one trailing newline, keys
   emitted in declaration order.

### 6.2 How it is proved

Building twice and comparing bytes proves almost nothing — it re-runs the same directory
order, the same iteration order, and the same allocator behaviour. The gate is therefore:

- build twice with a frozen clock and assert all four artifacts are byte-identical; **and**
- build again with an injected directory reader that returns every entry in reverse order,
  and assert all four artifacts are byte-identical to the first build.

The second assertion is the one that catches an unsorted `Object.keys` iteration or a
`Map` whose insertion order leaked into output. It is cheap only because §2 requires the
directory reader to be injected.

### 6.3 Why drift is not a byte comparison

`generatedAt` moves on every build, so a naive byte comparison between a fresh in-memory
build and what is on disk would report drift one second after a clean `brain reindex` and
never stop. A permanently-red check is a check people learn to ignore, which is worse than
not having one.

Drift is therefore compared over the **canonical form** of each artifact: the artifact with
its single `generatedAt` value replaced by a fixed sentinel. Everything else — every note,
field, count, edge, and rendered line — is compared byte for byte. `index-drift` reports the
artifact and the first differing path or line, never a whole-file diff.

The determinism gate in §6.2 is the stricter of the two and stays a true byte comparison,
because a frozen clock makes `generatedAt` constant across the builds it compares.

### 6.4 Graph

Nodes are canonical notes. Edges are resolved `[[wikilink]]` references only, each carrying
its source path, target path, and the link text. **Unresolved links are not edges** — they
are `links` lint findings. A graph that silently contains dangling half-edges is a graph
nobody can compute over.

Tag co-membership is deliberately not an edge type. Every note sharing a common tag would
produce a quadratic edge set that carries no information the tag rollup in `index.json`
does not already carry.

## 7. Lint

Six classes, matching `BACKLOG.md` §3. Severities are `error`, `warn`, `info`; `brain lint`
exits 1 if any finding is an `error` and 0 otherwise. Every finding carries the
vault-relative path, and the frontmatter classes carry the offending key.

| Class | Findings |
|---|---|
| `frontmatter` | missing required key, wrong type, value outside an enum, malformed date, `summary` over 400 characters (`error`); unknown key (`info`) |
| `provenance` | `author: agent` with `reviewed: null` (`warn`); a `sources` entry that resolves to no file and is not an absolute URL (`error`) |
| `links` | wikilink resolving to nothing (`error`); link into an excluded folder (`error`); link escaping the vault (`error`) |
| `duplicates` | identical normalized title within one topic folder (`warn`); identical content hash anywhere (`warn`); case-insensitive path collision (`error`) |
| `staleness` | `reviewed` older than `staleness.reviewAfterDays` (`warn`); `stage: emerging` with `occurrences >= 3` and `reviewed: null` (`warn`) |
| `index-drift` | any of the four artifacts whose canonical form (§6.3) differs from a fresh in-memory build (`error`); an artifact missing entirely (`error`) |

`unclassified-folder` (§5) is reported by `discovery` through the `frontmatter` class's
result envelope at `warn`, so it surfaces in `brain lint` without a seventh class.

The case-insensitive collision being an `error` while the other duplicate findings are
`warn` is intentional. Two notes with the same title are a curation question. Two paths
that differ only in case are a data-loss question the moment the vault is cloned onto APFS.

## 8. Retrieval

```typescript
export interface RetrievalQuery {
  readonly text: string;
  readonly filters?: {
    readonly tags?: readonly string[];
    readonly types?: readonly string[];
    readonly folders?: readonly string[];
    readonly stages?: readonly string[];
  };
  readonly maxCandidates: number;   // explicit; the API has no implicit default
}

export interface RetrievalMatch {
  readonly path: string;            // vault-relative, always present
  readonly title: string;
  readonly summary: string;
  readonly stage: NoteStage;
  readonly reviewed: string | null;
  readonly score: number;           // integer
  readonly matched: readonly { readonly field: string; readonly term: string }[];
}

export type RetrievalResult =
  | { readonly kind: "results"; readonly matches: readonly RetrievalMatch[];
      readonly considered: number; readonly selected: number; readonly truncated: boolean }
  | { readonly kind: "no-candidates"; readonly tried: readonly string[] };
```

**Stage 1 — structure.** Narrow to notes matching any of: an exact tag, an exact type, a
configured folder, or a title or alias containing the query as a substring, intersected
with any explicit `filters`.

**Stage 2 — lexical.** Score the survivors with integer weighted term counts: title 4,
alias 3, tag 3, summary 2, body 1. Tokenization lowercases, normalizes to NFC, and splits
on Unicode non-alphanumerics. Ties break by path, so ordering is total. Sort, truncate to
`maxCandidates`, and set `truncated` when anything was dropped.

**An empty stage 1 returns `no-candidates`** naming every access path it tried. It does not
fall back to scoring the whole vault. Design spec §13.5 defines retrieval as a funnel —
map, then catalog section, then notes — and a silent full-text fallback would make the
funnel decorative while producing results nobody can explain the reachability of.

`maxCandidates` has no default at the API boundary. The CLI supplies
`retrieval.maxCandidates` from config; a caller that forgets to choose gets a type error
rather than a silent 10.

**Stated non-goal: no stemming.** `cache` does not match `caching`. Stemming is
language-specific, and every implementation worth having is either a large dependency or a
rule set that is wrong often enough to make results unexplainable. Tags and aliases are the
mitigation, and this limitation is documented for the user rather than half-solved.

`stage` and `reviewed` are returned on every match and affect no score. That is the point
of §4's trust model: the reader sees how trustworthy a note claims to be and decides,
instead of an unfalsifiable number quietly reordering the list.

## 9. Migration and adoption

```typescript
export interface BrainMigration {
  readonly from: number;
  readonly to: number;
  readonly describe: () => string;
  readonly plan: (vault: VaultSnapshot) => ChangePlanV1;
}
```

The v1 registry is **empty**: there is no schema version to migrate from yet, and an
untested migration path is worse than an absent one.

What does ship is **adoption**, and it is read-only. `brain status` against an existing
vault reports what would have to change for it to validate — missing required keys, folders
that are neither configured nor private, unresolved links — and changes nothing. A user
pointing Developer OS at a vault they already have gets a report, never a rewrite.

When migrations do exist, they emit a `ChangePlanV1` and execute through Foundation's
`TransactionStore`. The seven-phase pipeline in `docs/architecture/foundation.md` §3 is
inherited, not reimplemented; `packages/brain` contains no direct filesystem mutation of a
user's notes.

## 10. Template

`templates/brain/` holds the synthetic skeleton: the folder tree with `.gitkeep` files, a
minimal note template under `templates/`, and four wholly invented example notes spanning
the four `type` values, with invented tags and at least one resolving wikilink between
them.

It contains no founder name, client name, repository name, or copied third-party text.

`developer-os init` installs it as managed artifacts **only when `init` itself creates the
vault**. Foundation already distinguishes that case — §4 of `foundation.md` gives `init`'s
revert an ownership universe that includes a Brain it just created, while `uninstall`
refuses Brain artifacts by location. Template files therefore roll back cleanly with a
failed `init` and are preserved, never deleted, by `uninstall`. An existing vault is not
touched, which preserves Foundation's guarantee unchanged.

## 11. CLI surface

```text
developer-os brain reindex [--dry-run] [--json]
developer-os brain lint    [--json]
developer-os brain search <query> [--limit N] [--json]
developer-os brain status  [--json]

developer-os search <query>        # alias for `brain search`
```

`brain reindex` is the only mutating command; it writes exactly the four artifacts through a
Foundation transaction and supports `--dry-run` per design spec §8. The other three are
read-only.

Exit codes follow `foundation.md` §6 without extension: `1` for lint errors and failed
validation, `2` for an invalid query or malformed config, `5` for a security refusal from
the path guard, `6` for an incomplete transaction. Nothing here needs a new code.

**This amends design spec §8**, which lists a bare `search` and no vault validation or
index command, while Task 2's checkpoint requires all four verbs. One noun gathers every
vault operation, and `capture`, `review`, and `ingest` keep their §8 spelling because they
are lifecycle operations, not vault operations.

## 12. Produced interfaces

`BrainConfigV1`, `NoteFrontmatterV1`, `CaptureEnvelopeV1`, `IndexBuildResult`, `LintResult`,
`RetrievalQuery`, `RetrievalResult`, `BrainMigration`, `BrainService` — the nine named in
`BACKLOG.md` §3, all `schemaVersion: 1` where they are persisted.

## 13. Testing

**Contract tests** — `tests/contracts/brain/`:

- the frontmatter parse/reject table, one case per reserved key per failure mode, plus
  unknown-key preservation proved by a read-rewrite byte comparison;
- the determinism pair from §6.2, including the reversed-directory-reader build;
- one case per lint finding in §7's table, including a clean vault reindexed and then
  drift-checked with the clock advanced, which must report no drift (§6.3);
- the retrieval funnel: a stage-1 hit, a stage-1 miss returning `no-candidates`, a
  truncation case, and a tie broken by path.

**Fixtures** — `tests/fixtures/brain/`:

- `legacy-shape/` is the committed synthetic vault required by `BACKLOG.md` §3. It encodes
  only the shape recorded in `docs/migration/baseline-capabilities.json` — Obsidian
  Markdown, a vault map, a catalog, a graph, index-first retrieval — with invented notes,
  tags, and links. It is never generated from, compared against, or refreshed from a real
  vault. If it turns out to miss a shape the product must support, the plan extends the
  fixture and says so.
- malformed fixtures, one concern each: missing required key; malformed date; unresolved
  wikilink; duplicate title; NFD filename; case-collision pair; unclassified folder; a
  hand-drifted `index.json`.

**Note on the baseline.** `baseline-capabilities.json` records the vault's *capabilities* —
it does not record a single frontmatter field name. `NoteFrontmatterV1` above is therefore
a fresh design decision, not a migration fact, and the fixture's frontmatter is invented
rather than reconstructed. This is stated so no later reader mistakes §4 for something
recovered from a real vault.

**Integration** — `tests/integration/brain/` runs reindex → lint → search over
`legacy-shape/` and asserts every returned match resolves to a file that exists.

**End to end** — `tests/e2e/` gains the four `brain` commands against a temporary HOME,
asserting exit codes, `--json` shape, and that `--dry-run` writes nothing.

## 14. Gate

- Index rebuilds are byte-for-byte deterministic under a frozen clock, including under a
  reversed directory reader.
- `_raw`, `_outputs`, `_graveyard`, `_indexes`, `templates`, and `.obsidian` are never
  scanned as canonical notes, and an unconfigured folder is reported rather than indexed.
- Every retrieval match resolves to a canonical note that exists at the returned path.
- Topic aliases select the same notes as their canonical names without modifying any folder.
- Broken links, malformed frontmatter, case-colliding paths, unsupported schema versions,
  and stale generated indexes all fail with path-specific diagnostics.
- `npm run check` passes, and a fresh-context reviewer who did not write the code returns no
  unresolved P0 or P1.

## 15. Deviations from already-approved documents

Recorded here because each one changes a document that was approved before this spec existed.

1. **Design spec §8 gains the `brain` group** (§11). The checkpoint requires four verbs; §8
   supplies one.
2. **A sixth source directory.** The program plan's Task 2 file list names
   `{schema,indexes,lint,retrieval,migrations}`. Folder policy and enumeration are consumed
   by both `indexes/` and `lint/` and are not schema parsing, so `discovery/` is added rather
   than giving `schema/` two jobs.
3. **`DeveloperOsConfigV1` gains an optional `brain` section** (§3). It is a frozen
   Foundation interface; `foundation.md` §2 states that now — before a downstream consumer
   exists — is when such a change is cheapest. Optional-with-defaults and no version bump
   keep every existing installation loadable.
4. **`init` installs the Brain template** when, and only when, it creates the vault (§10).
   This extends a Foundation command instead of adding a `brain init`, and preserves
   Foundation's "never modify an existing vault" guarantee unchanged.

## 16. What this subsystem deliberately cannot do

- **No network, no embeddings.** Retrieval is lexical and local; Foundation's compiled-module
  network scan covers `packages/brain` on the same terms as everything else.
- **No capture, review, or ingest.** The envelope type exists; nothing writes one.
- **No agent.** Nothing in this package spawns a process.
- **No stemming, no fuzzy matching, no synonyms** (§8).
- **No automatic folder renames** — aliases resolve at read time, always.
- **No write from any `brain` command outside `<contentRoot>/<indexesDir>/`.** `brain
  reindex` writes four files and nothing else; `lint`, `search`, and `status` write nothing.
  `_raw`, `_outputs`, and `_graveyard` are read-excluded and write-excluded alike. The one
  write elsewhere in the vault is the template, and it belongs to `init` (§10), not to this
  package.
- **No mutation of an existing vault at install time.** Only a vault `init` created receives
  the template.
