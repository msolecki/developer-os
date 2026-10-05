# The Brain engine

What `@developer-os/brain` is, what it deliberately cannot do, and what it left open.
Written when DOS-P2 closed on 2026-08-10; the implementation plan was deleted in the same
commit, per `SESSION.md`. This note absorbed the surviving design record on 2026-08-24, when the
completed subsystem spec was deleted; recover the approved baseline from git history if needed.

Read this before changing Brain code or behaviour.

## 1. What it is

A workspace package that turns a directory of Obsidian-compatible Markdown into a
deterministic index, a graph, two rendered views, a lint report, and a search — with no
agent adapter present and no network call.

| Directory | Responsibility |
|---|---|
| `src/schema/` | `NoteFrontmatterV1`, strict parse, reserved vocabulary, byte-identical rewrite; `CaptureEnvelopeV1` as a type only; brain config defaults |
| `src/discovery/` | deny-by-default enumeration, folder policy, symlink refusal |
| `src/indexes/` | `index.json`, `graph.json`, and the two Markdown views; one `renderArtifacts` produces all four |
| `src/lint/` | the six classes below, and canonical-form drift |
| `src/retrieval/` | the two-stage funnel and its integer scorer |
| `src/migrations/` | `BrainMigration` and a deliberately empty registry |
| `src/redact.ts` | a re-export of the screen, which moved to `@developer-os/security` in DOS-P3 Task 1 once a second package needed it. Delete it when the last brain call site imports `security` directly |
| `src/service.ts` | `BrainService`, the only module the CLI imports |

## 2. What it cannot do, on purpose

**It never writes.** `BrainServiceDependencies` has no write channel, so "reindex does not
mutate a user's notes" is a sentence the type refuses to express rather than a promise the
implementation keeps. `reindex` returns bytes; `apps/cli` stages them through Foundation's
`TransactionExecutor`.

**It never reaches the network.** Enforced by the capability scan in
`tests/e2e/foundation.test.ts`, which enumerates every workspace under `apps/` and
`packages/` rather than a hardcoded list — the list is what let this package ship unscanned
for three days (`BACKLOG.md` NEW-1, closed 2026-08-10).

**It resolves no YAML tag.** Frontmatter carrying an explicitly tagged node is refused, and
*any* tag counts. This was nearly deferred on the recorded premise that `yaml@2.8.1` does not
construct values from tags; probing the library disproved it — `!!binary` yields a `Buffer`,
`!!timestamp` a `Date`, `!!set` an object, on the core schema. An allowlist of harmless tags
was the first draft and is the wrong shape: it makes the rule *which tags construct values*,
which the library decides, instead of *frontmatter carries no tags*, which this product does.
The parser contract rejects every explicit YAML tag, including tags from the core schema.

**It does not stem.** `cache` does not reach a note titled `caching`; tags and aliases are
the documented mitigation.

**It writes no capture.** `CaptureEnvelopeV1` is a type and a status list. DOS-P6 owns the
lifecycle, and a test asserts this module's runtime surface stays one constant.

## 3. Facts that outlive the plan

1. **`yaml` parsing is quadratic in mapping size** — 14 ms at 1,000 frontmatter keys, 1.2 s
   at 16,000, no completion inside two minutes for a 700 KB block, while the fence scan stays
   under 3 ms. `MAX_FRONTMATTER_CHARS` in `indexes/build.ts` is the bound, counted in UTF-16
   code units because the cost is quadratic in *entries* and an entry costs at least five
   code units in any script.
2. **`yaml@2.8.1` resolves the YAML 1.2 core schema, and that is why it was chosen.** A tag
   spelled `no` stays the string `"no"`. Under a YAML 1.1 parser the note silently loses a
   tag and gains a boolean nothing downstream expects. Any replacement must also bound alias
   expansion and refuse a duplicate mapping key. Stated at the import site in
   `schema/note.ts` and pinned by its tests.
3. **`NoteFrontmatterV1` is a design decision, not a migration fact.**
   `docs/migration/baseline-capabilities.json` froze the vault's *capabilities* and nothing
   about note schema, so the fixture's frontmatter is invented rather than recovered.
4. **The fixtures are never generated from, compared against, or refreshed from a real
   vault.** If one misses a shape the product must support, extend it and say so in the
   commit. `tests/fixtures/brain/README.md` carries the rule.
5. **Every screen of vault text is one function**, now `packages/security/src/screen.ts` and
   reached here through the `redact.ts` re-export. It began as three copies —
   lint's finding message, search's title and summary, and the parser's echoed-back key —
   and the third copy is what merged them; the fourth site, in `workflow-schema`, is what
   moved it out of this package, since the two are peers and neither may depend on the
   other. A screen that exists three times is a screen that
   will be corrected twice. `\p{Cf}` is the half most easily left out and the half that
   matters: it carries U+202E, which reorders a printed line, and `\s` does not match it.
6. **Control characters are written as escapes, never as bytes.** This repository shipped a
   literal NUL as a map-key separator and a literal U+200D holding a comment's syntax
   together, both invisible in every diff that carried them. `tests/repository/control-bytes.test.ts`
   is the gate; it found the second one within a minute of existing.
7. **`BrainConfigV1`'s type and schema live in `packages/core`**, not here.
   `DeveloperOsConfigV1` must reference the type, and `core` importing from `brain` while
   `brain` imports from `core` is a cycle. This package owns the defaults and resolution and
   re-exports the type.

### The eight lint classes

Severities are `error`, `warn`, `info`; `brain lint` exits 1 if any finding is an `error` and
0 otherwise. Every finding carries the vault-relative path. Frontmatter findings carry the
offending key when one exists; folder-level findings such as `unclassified-folder` and a skipped
symlink carry `key: null`.

| Class | Findings |
|---|---|
| `frontmatter` | missing required key, wrong type, value outside an enum, malformed date, `summary` over 400 characters (`error`); unknown key (`info`); a key whose value swallowed the prose that followed it, a `tag`, `summary` or `alias` with no visible character, a `title` carrying U+200D between characters that do not join (outside an emoji ZWJ sequence and with no Arabic-family or Indic neighbour), and a symlinked folder that is not followed (`warn`) |
| `provenance` | `author: agent` with `reviewed: null` (`warn`); a `sources` entry that resolves to no file and is not an allowed absolute URI (`http:`, `https:`, `mailto:`, `doi:`, `urn:` or `isbn:`) (`error`) |
| `links` | wikilink resolving to nothing, into an excluded folder, or outside the vault (`error`); link text matching more than one note (`warn`) |
| `duplicates` | identical screened, normalized title within one topic folder (`warn`); identical content hash anywhere (`warn`); case-insensitive path collision (`error`) |
| `staleness` | `reviewed` older than `staleness.reviewAfterDays` (`warn`); `stage: emerging` with `occurrences >= 3` and `reviewed: null` (`warn`) |
| `index-drift` | any of the four artifacts whose canonical form differs from a fresh in-memory build, or an artifact missing entirely (`error`) |
| `isolated` | a canonical note that is neither the source nor the target of any `graph.json` edge, self-edges excluded (`info`) |
| `gap` | an index tag carried by at least three canonical notes, none of them of type `compiled-note`; `path` is the lowest such note, `key` `tags` (`info`) |

`unclassified-folder` is reported by discovery through the `frontmatter` class's result envelope at
`warn`, so it surfaces in `brain lint` without a ninth class. The six `frontmatter` warnings are
enumerated because the completed spec had drifted from the implementation and the since-closed `BACKLOG.md` NEW-48
found the omission; moving the current inventory here closes that documentation-only row.

## 4. Known residuals

Each is a deliberate limitation with a named owner, not an oversight.

| # | What | Where it bites | Owed by |
|---|---|---|---|
| 1 | `contentHash` hashes the decoded string, not the bytes on disk | two notes differing only inside invalid UTF-8 hash identically and `duplicates` calls them one note; the trigger is an imported Latin-1 file | fixing it means `readFile` returning bytes, a contract change |
| 2 | `indexesDir`, and equally any `PRIVATE_FOLDERS` name, silently shadows a configured topic folder | a whole topic folder vanishes from the index with no warning | `brainSchema` for the `indexesDir` half; `resolveBrainConfig` for the other, because `core` may not import `brain` |
| 3 | `readArtifact` reports an unreadable artifact as a missing one | `EACCES` on `_indexes/` tells the user to reindex, which then also fails | the CLI, which owns the real filesystem |
| 4 | a symlinked topic folder is reported but never followed | `symlinkedFolders` says so; nothing indexes its notes | by design; revisit only with a reason |
| 5 | `reindex` does not call `assertRootsAnchored` where `init` does | a hand-edited `brainPath` outside the home is refused by one and accepted by the other | DOS-P7 lifecycle, or the next task touching `brain.ts` |
| 6 | `brain reindex --dry-run` validates nothing | it cannot fail where the real run fails, and a real run reconciles the manifest where a dry run does not | as above |

One open decision remains in `BACKLOG.md` §1. **NEW-7**: a link destination's
percent-encoding is verified against CommonMark and not against Obsidian, because there is
no Obsidian here to ask.

Three closed on 2026-08-10 and are recorded here because this section named them as current.
**NEW-6**: `duplicates` now groups titles on the screened form, so a title differing only by
a zero-width space is the duplicate the catalog already rendered it as — the lint table above
carries the current contract. **NEW-5**: `index-drift` carries its line in `LintFinding.line` like every other
class, and no longer in prose. **NEW-8**: `contentRoot` is no longer wrapped in a code span a
backtick in the value could close. NEW-4 closed when explicit YAML tags became a parser refusal.

## 5. The two invariants worth defending

**Determinism.** Rebuilds are byte-identical under a frozen clock *and* under a reversed
directory reader. Every array has a stated total order, sorted byte-wise over NFC UTF-8;
`localeCompare` is forbidden because it is locale- and ICU-version-dependent. The reversed
reader is the assertion that catches an unsorted iteration or a `Map` whose insertion order
leaked, and it is only cheap because the directory reader is injected.

**Untrusted input.** Vault files are user data. Every value this package interpolates into a
message or a rendered artifact is screened for control and format characters and bounded
before it reaches a terminal, a log, or a file the user opens — including the case that
motivated it, a title carrying `\r` that lets one result overwrite the row above it.

Two exemptions, and both are load-bearing. **Paths are byte-exact**, everywhere: a path is an
identifier the user has to be able to act on, and `catalog.md`'s link destinations have to
resolve to the notes they name. They are screened at the terminal instead, by `renderPath`.
**U+200D is preserved**, in the Brain *and* in the CLI, because a joiner is part of a grapheme
cluster rather than an attack on one — the two layers held opposite policies for one review
round and the output was worse than before either existed. `tests/e2e/brain.test.ts` crosses
that seam so a future divergence fails instead of merely looking wrong.

The escaping in `indexes/render.ts` is a *different* rule from the screening, and having only
the first is how a RIGHT-TO-LEFT OVERRIDE reached `catalog.md`: escaping stops text becoming
Markdown structure, screening stops characters reordering a line. Both now run, in that
order. `index.json` and `graph.json` are deliberately unscreened — they are data, the
retrieval layer screens on the way out, and an index that disagrees with the vault it indexes
is worse than one that is faithful.

## 6. Normative contracts absorbed from the completed design

These contracts remain authoritative after deletion of the completed Brain design spec. Source
comments written before 2026-08-24 may call them “Spec §3” through “Spec §14”; the former-section
map at §6.7 resolves those references without making git history the only source of truth.

### 6.1 Note identity, schema and preservation

A note's identity is its vault-relative POSIX path. Case-insensitive path collisions are lint
errors because one note on a case-insensitive vault can become two in a case-sensitive checkout.

The v1 frontmatter vocabulary is normative:

- `schemaVersion: 1`; non-empty `title`; `type` in `knowledge-note`, `compiled-note`,
  `project-note`, `reference-note`; `created` and optional `updated` as `YYYY-MM-DD`;
- required `tags: string[]`, optional `aliases: string[]`, required `summary` of at most 400
  characters, and `stage` in `emerging`, `established`, `deprecated`;
- `author` in `agent`, `human`; required `reviewed` as `YYYY-MM-DD` or explicit `null`;
  optional integer `occurrences >= 1` defaulting to 1; optional `sources: string[]`, each a
  vault-relative path or an allowed absolute URI.

Unknown keys are allowed, reported at `info`, and preserved byte-identically on any rewrite.
Preservation includes key order, comments, quoting and block-scalar form: the parser retains the
original frontmatter and patches it rather than serializing the parsed object. Parsing uses the
YAML 1.2 core schema, refuses duplicate keys and every explicit YAML tag, and keeps alias expansion
bounded at 100. A replacement parser must preserve all four properties and their regression tests.

### 6.2 Deny-by-default folder policy

Canonical notes are `<contentRoot>/<topicFolder>/**/*.md` for configured topic folders after
read-time alias resolution. At every depth, `_raw`, `_outputs`, `_graveyard`, `_indexes`,
`templates`, `.obsidian`, and any dot-prefixed path segment are private and never canonical.
An unconfigured, non-private folder under `contentRoot` is not indexed and produces the
`unclassified-folder` warning.

Exclusion is evaluated before opening a file. Paths pass through the shared security
canonicalization, and a symlink escaping the vault is refused rather than followed. `topicAliases`
changes only the logical read-time folder; it never renames a directory or mutates the vault.

### 6.3 Canonical data and rendered artifacts

One reindex build produces four artifacts: canonical machine data in `index.json` and `graph.json`,
and human views in `vault-map.md` and `catalog.md`. Retrieval, lint and drift read the JSON data;
Markdown is never parsed back into the model.

Time enters only through the injected `generatedAt`. Arrays have an explicit byte-wise total order
over NFC UTF-8, paths are vault-relative POSIX and NFC, persisted numeric values are integers, and
serialization is fixed to two-space indent, LF and one trailing newline. Determinism is proved with
a frozen clock both twice normally and once with a reversed directory reader.

Drift compares canonical form, replacing only `generatedAt` with a sentinel, and reports the first
differing path or line rather than a whole-file diff. The graph contains canonical notes and
resolved wikilink edges only; unresolved links are lint findings and tag co-membership is not an
edge type.

### 6.4 Lint

The table in §3 is the current eight-class inventory and the source of truth for severity and exit
behaviour. It includes the folder-level warning carried through the `frontmatter` result envelope
without inventing a ninth class.

### 6.5 Retrieval

Retrieval is a two-stage funnel. Structure first narrows by exact tag, type, configured folder, or
query-token occurrence in title or alias, intersected with explicit filters. Lexical scoring then
uses integer weights: title 4, alias 3, tag 3, summary 2, body 1. Tokens are NFC-lowercased and split
on Unicode non-alphanumerics; ties break by path.

There is no full-vault fallback and no implicit candidate limit. An empty first stage returns
`no-candidates` with the attempted access paths; callers must supply positive `maxCandidates`.
`stage` and `reviewed` are returned as trust metadata but do not change score. There is no stemming.

### 6.6 Migration and adoption

`BrainMigration` remains the migration interface and the v1 registry is deliberately empty.
Adoption is read-only: status reports required changes but rewrites nothing. A future migration
must emit a Foundation `ChangePlanV1` and execute through the transaction store; Brain never grows
a direct filesystem mutation path for user notes.

### 6.7 Former spec section map and release gate

| Former design section | Authority retained here |
|---|---|
| §1 | §1 and §2 |
| §2 | §1 and §2 |
| §3 | §6.8 |
| §4 | §6.1 and §6.9 |
| §5 | §6.2 |
| §6 | §5 and §6.3 |
| §7 | §3 and §6.4 |
| §8 | §6.5 |
| §9 | §6.6 |
| §10 | §6.10 |
| §11 | §6.11 |
| §12 | §6.12 |
| §13 | §6.12 |
| §14 | the deterministic, deny-by-default, no-network and transaction-boundary gates in §2, §5 and §6 |
| §15 | §3 and §4 |
| §16 | §2 |

The subsystem gate remains: the synthetic vault reindexes deterministically under reversed reads,
lint refuses errors, retrieval stays inside the explicit funnel, and no Brain package code reaches
the network or mutates a user's notes directly.

### 6.8 Brain configuration

`BrainConfigV1` is the optional `[brain]` section of product config, never vault state. Its
normative fields are `schemaVersion: 1`, vault-relative `contentRoot` (default `content`), ordered
`topicFolders` (default `PROJECTS`, `TOOLS`, `DEV`, `INFRA`, `QA`), `topicAliases` (default empty),
vault-relative `indexesDir` (default `_indexes`), positive `retrieval.maxCandidates` (default 10),
and positive `staleness.reviewAfterDays` (default 180).

The type and zod schema live in `packages/core`; Brain owns defaults and resolution and re-exports
the type, avoiding a core↔Brain dependency cycle. The surrounding config schema remains strict,
but `[brain]` is optional and does not bump config `schemaVersion`. Serialization emits it when the
key is present, including an explicit default-valued section, and preserves an older config that
never carried the key byte-identically.

### 6.9 Parser execution contract

The note parser uses `parseAllDocuments`, not `parseDocument`, because an explicit document end may
otherwise hide a second document. `logLevel` stays silent and the implementation reads
`document.errors` itself so author text never escapes to stderr. `maxAliasCount: 100` is pinned at
conversion, duplicate keys remain errors, and the parser walks the document to refuse every
explicit tag before converting it. Malformed input is a finding, never an uncaught library error.

### 6.10 Template, init and uninstall

`templates/brain/` is wholly synthetic: the folder skeleton, a minimal note template and four
invented notes spanning the four note types, with no founder, client, repository or third-party
content. `developer-os init` installs these as managed artifacts only when init creates the vault.
A failed init can roll them back; uninstall preserves every Brain artifact by location, and init
does not touch an existing vault.

### 6.11 CLI and exit codes

The surface is `developer-os brain reindex [--dry-run] [--json]`, `brain lint [--json]`,
`brain search <query> [--limit N] [--json]`, `brain status [--json]`, plus `developer-os search` as
the search alias. Reindex is the only mutating command and stages exactly the four §6.3 artifacts
through a Foundation transaction; dry-run writes nothing. Lint, search and status are read-only.

It also carries `brain retire <note> [--dry-run] [--json]` and `brain refactor --rename <note>
<new-name> | --move <note> <topic-folder> | --merge <source> <target> | --split <note> <heading>`,
each with `[--dry-run] [--json]` and no `--yes`; `<heading>` is one ATX heading of level 2–6, at
most 512 characters. Both mutate through the §6.13 contracts and dispatch after
`assertOrdinaryCommandAdmitted`.

Brain adds no exit class: `1` is validation or lint error, `2` malformed config or invalid query,
`5` a path-security refusal, and `6` incomplete transaction/recovery required. `brain retire` and
`brain refactor` also use Foundation's `3` for their conflicts: an occupied destination
(`refactor_destination_exists`), a note still referred to (`retire_has_referrers`), and a note
changed between planning and apply (`note_changed_since_read`).

### 6.12 Produced interfaces and gates

The produced interfaces are `BrainConfigV1`, `NoteFrontmatterV1`, `CaptureEnvelopeV1`,
`IndexBuildResult`, `LintResult`, `RetrievalQuery`, `RetrievalResult`, `BrainMigration` and
`BrainService`, with `schemaVersion: 1` wherever persisted.

Contract tests cover every frontmatter failure, unknown-key byte preservation, reversed-reader
determinism, every lint finding, canonical drift and the retrieval funnel. Fixtures are synthetic
and never refreshed from a real vault. Integration runs reindex → lint → search and resolves every
match to a fixture file; end-to-end cases cover all four CLI verbs, JSON output, exit codes and a
write-free dry run.

### 6.13 Brain workflows, note captures and the refactor verbs (A12b)

Recorded 2026-09-26 from the A12b plan (`plans/2026-09-22-developer-os-brain-workflows.md`, closed and
deleted 2026-09-26; `git show d7043d5:` holds it) and its spec, approved by D47 and deleted on
2026-09-29 (`git show 343f8453:docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`).
The contracts below are what survived the spec; the numbered decisions are where the plan chose
where the spec was silent or conflicted with the code; the residuals are the ones the spec accepted.

**Contracts.**

- **Three mutation paths, and nothing else writes the vault.** P1: a plain capture, written by the
  ingest model, `create` only. P2: a note capture, applied verbatim with no vendor call, as `create`
  or as a `replace` bound to its capture-time hash. P3: `brain retire` and `brain refactor`, run by
  the person and planned deterministically. `brain-answer` and `brain-report` use P1 only when
  `file-back` is true; `brain-compile` and `brain-enhance` use P2; `brain-garden` uses P2 and prints
  P3 commands with `--dry-run` only. The one verb A12b added is `capture.writeNote`
  (`workflow-schema.md` §5).
- **`capture --note <path>`** (`apps/cli/src/commands/capture.ts`). `<path>` is content-root-relative
  and obeys `ProposedNote.path`'s rules (`isUnsafeProposedNotePath`). Before anything is written the
  destination is proven inside a configured topic folder, outside every `PRIVATE_FOLDERS` segment and
  the indexes directory, and not reached through a symlink; the redacted, normalized text plus one
  `\n` parses with no `error` issue and is at most `MAX_PROPOSED_NOTE_CHARS`; an existing destination
  must be a canonical note, and the SHA-256 hex of its bytes is recorded as `beforeSha256`, else
  `null`.
- **`CaptureEnvelopeV1.note`** is `{ path, beforeSha256 } | null`, additive under
  `schemaVersion: 1`. `renderCaptureFile` emits it only when non-null, so a plain capture renders
  byte-identically; `parseCaptureFile` reads absent as `null` and refuses as `unparseable` anything
  but exactly those two keys, a valid path, and 64 lowercase hex or `null`. It is preserved, never
  recomputed, including by `review --decision edit`, and it is outside the deduplication hash (R3).
  A binary without the field plans a `create` and meets the occupied-path refusal, so it fails
  closed. `review` rows carry `note: { path, replaces } | null`, and the human line reads
  `creates <path>` or `replaces <path>`.
- **Verbatim ingest** (`apps/cli/src/commands/ingest.ts`). A note capture's proposal is its content
  plus `\n`, built without a vendor; vendor resolution and the exit-4 refusal apply only to a batch
  holding a plain capture. The redaction key is still loaded, or created, before selection
  (`loadOrCreateRedactionKey`), so a note-only batch can create `state/redaction.key` (D62). Before
  validation the destination must still hash to `beforeSha256`, or still be absent when that is
  `null`. Otherwise, and on a `TransactionPreconditionError` at apply, the capture is refused with
  exit 3 and reason `note_changed_since_capture` and stays `accepted`. The recovery is
  `review --decision reject` and then rerunning the workflow, never rerunning `ingest`. The nine
  validators judge a projection in which the destination is replaced, not added: for a replacing
  capture `duplicate-detection` ignores the destination itself and `source-and-provenance` requires
  the same `created`. The apply is the usual ladder with one `replace` carrying
  `expectedBeforeHash = beforeSha256`, or one `create`.
- **Ingest ignores `isolated` and `gap` by construction**: the validators that read lint filter on
  `provenance`, `links` and `duplicates` by name (`packages/brain/src/ingest/validate.test.ts`).
- **Refactor algorithm** (`packages/brain/src/refactor/`, `apps/cli/src/commands/refactor.ts`).
  Build the vault in memory; plan as a pure, reversed-reader-deterministic function; check the
  post-conditions below on the projection; refuse above `MAX_REFACTOR_MUTATIONS` (256, the
  executor's participant bound) before any ID is allocated; stop under `--dry-run`. Otherwise run
  one transaction (`brain-retire` or `brain-refactor`), each `replace` and `remove` carrying the hash
  of the bytes read, then `brain-refactor-reindex`. A crash between the two leaves `index-drift`,
  which `brain reindex` clears. A destination canonicalizes inside a configured topic folder (or
  `_graveyard/` for retire and merge), passes no symlink, and a `create` target must be absent. A
  note that is not valid UTF-8 refuses as `brain_refactor_input_invalid`.
- **Modes.** `retire`: remove, then create `_graveyard/<note>` with the bytes unchanged; refused
  while anything links to or cites the note. `--rename`/`--move`: remove, then create at the new path
  with the bytes unchanged. `--merge`: the target's header stays byte-exact, and its body gains
  `\n\n## <source title>\n\n<source body, trimmed>\n`; the source goes to `_graveyard/`. `--split`:
  the section, from its heading to the next heading of equal or higher level, becomes `<slug>.md`,
  and the parent keeps `See [[<slug>]].` in its place. **No existing frontmatter is ever edited.**
  The split child is rendered fresh: the heading as `title`, the parent's `type`, `tags` and
  `author`, `created` today, `stage: emerging`, `reviewed: null`, `summary` "Split from <parent
  title>.". `<slug>` is the heading NFC-lowercased with each non-alphanumeric run turned into `-`;
  empty or occupied refuses.
- **Link rewriting.** Only occurrences `extractLinks` counts. A link whose old resolution was the
  moved note is rewritten only if its text no longer resolves to the new target, so title- and
  alias-tier links stay untouched. The new text is the target's basename without `.md` when that
  resolves uniquely, else its content-root path without `.md`. `#anchor` and `|display` are kept,
  except the split anchor, which is dropped. Headers are never edited.
- **Post-conditions**, all refusing `refactor_postcondition_failed`: every created or replaced note
  parses; no `error` lint finding is new, compared on (class, mapped path, key) with `index-drift`
  excluded; the graph's edge multiset, self-edges dropped, equals the mapped pre-state's, plus the
  parent→child edge of a split.
- **Agent sessions.** An applied `retire` or `refactor` refuses with exit 5
  `brain_refactor_in_agent_session` when any `AGENT_DETECTION_ROWS` marker is set
  (`anyAgentMarker`), before config is read; `--dry-run` is always allowed. In-process tests inject
  that environment and never read `process.env`.
- **Result and refusals.** `--json` returns `BrainRefactorResultV1` (`transactionId` `null` under
  `--dry-run`). Exit 2: usage (zero or two mode flags) and `brain_refactor_input_invalid`. Exit 3:
  the three conflicts in §6.11. Exit 1: `refactor_postcondition_failed`, `refactor_too_wide`, and
  `refactor_reindex_failed` (applied, index not rebuilt; recovery `brain reindex`). Exit 5:
  `brain_refactor_path_refused`, `brain_refactor_in_agent_session`. Exit 6: incomplete transaction.

**Implementation decisions.**

1. **The garden fixture is planted per test.** `templates/brain` is what `init` ships to every user,
   and `apps/cli/src/commands/brain-template.test.ts` pins it byte for byte, so it is not extended.
   The e2e tests create the three-note tag after `init`, inside their own temporary vault.
2. **`capture --note` refusal codes** (the spec names none). `capture_note_invalid`, exit 2: a bad
   path string, a note that does not parse, a note over 64 KiB, or a destination that exists but is
   not a canonical note. `capture_note_path_refused`, exit 5: a destination outside a configured topic
   folder, under a private folder or the indexes directory, or reached through a symlink
   (`apps/cli/src/commands/capture.ts`).
3. **`note_changed_since_capture` is carried in a `reason` field**, typed
   `"note_changed_since_capture" | "vault_changed_during_ingest" | null` (the second added by
   D83 (2), NEW-40, `knowledge-pipeline.md` §5.1), on each per-capture refusal (`RefusedCaptureV1` and the
   `refused[]` entries of `RunReportV1`, `apps/cli/src/commands/ingest.ts`), beside the numeric
   `code`. The change is additive.
4. **`IngestResultV1.agent` and `RunReportV1.agent` are `AgentName | null`**: `null` when every
   selected capture is a note capture, so no vendor was resolved. Additive for readers that already
   branch on the value.
5. **`brain refactor` mode flags are boolean options.** As string options `parseArgs` would consume
   the note path as the flag's value. Zero mode flags, or two, is a parse refusal (usage,
   `invalid_input`, exit 2); every other input fault is `brain_refactor_input_invalid`, exit 2
   (`apps/cli/src/commands/refactor.ts`).
6. **The second transaction of `brain retire` and `brain refactor` is `brain-refactor-reindex`**, the
   same kind for both verbs; the spec names only the first transaction's kind.
7. **`review` rows carry `redactionCount`**, because the human line prints that count. Additive.
8. **`brain-garden`'s prose names `brain refactor` and `brain retire`**, which landed after the
   workflows; nothing was released between the two (D47).
9. **The real-vendor test is handed an API key.** A disposable `HOME` carries no Claude credentials,
   so `npm run test:vendor-brain` (`tests/integration/brain-workflows/claude.test.ts`) runs only when
   `claude` and a credential are present: `DEVELOPER_OS_VENDOR_BRAIN_OAUTH_TOKEN`, a `claude
   setup-token` subscription token passed as `CLAUDE_CODE_OAUTH_TOKEN` (D66, 2026-09-26), or
   `DEVELOPER_OS_VENDOR_BRAIN_API_KEY`, passed as `ANTHROPIC_API_KEY`. It is excluded from `test:suite` and is not part
   of `check`. Confirmed by the founder with the OAuth change (D66).
10. **A note another note cites in `sources` cannot be renamed, moved or merged.** No frontmatter is
    ever edited, so the referrer's `sources` entry would stop resolving; that is a new `provenance`
    error, and the refactor's post-condition refuses it with `refactor_postcondition_failed`. It is
    fail-closed and goes beyond residual R6 below.

**Accepted residuals.**

| # | Residual | Disposition |
|---|---|---|
| R1 | In an interactive session the vendor's own tools can still write the vault; the declared scope and the skill text are instructions, not enforcement | A13's `guard path` is the only mechanism that could deny it; recommended to A13, not decided by A12b |
| R2 | `brain-enhance` binds the note's hash at **capture** time, not at the agent's read: an edit made between the agent's read and its `capture` is overwritten by a revision that never saw it | accepted; the person reviewing the capture sees the full note. Closing it needs `--note-sha256` from the agent |
| R3 | The deduplication hash is content-only, so two note captures with identical text and different destinations are one capture. Likewise a `--note` capture whose normalized text equals an existing plain capture returns `duplicate: true` with that capture's id and keeps that capture's envelope | accepted; the second is reported as a duplicate at exit 0 |
| R4 | The agent-session detection that keeps `brain retire` and `brain refactor` person-run (the agent-session contract above) is environment-based and advisory against an adversary who strips it | accepted; it targets planted instructions in ordinary sessions |
| R5 | `brain-garden`'s `limit`, one-capture-per-note and "never apply" are prose | backstopped by review of every capture and by the agent-session refusal; a second capture against one note fails its precondition at ingest with the reject-and-rerun recovery |
| R6 | `--merge` does not union the source's `tags`/`aliases` into the target's frontmatter | follows from "no frontmatter patcher"; links by the source's title are still rewritten |
| R7 | Obsidian renders a note capture's inner frontmatter as body text inside quarantine | cosmetic |
| R8 | A replacing note capture normalizes and redacts the **whole** note: line endings, normalization form, stripped control and format characters, trimmed trailing whitespace, and any high-entropy run of 40+ characters redacted | accepted as the price of "the reviewed bytes are the written bytes"; `review` shows the redaction count. Narrowing it needs a redactor that takes the class set to apply, the same change NEW-36 asks for |

### 6.14 The Brain across update and rollback (Spec 2)

Added 2026-09-28 by NEW-110 Task 12 (D72); `foundation.md` §11 has the update contract.

- **An update never reads the Brain root by name.** The target planner sees a bounded Brain snapshot
  of Brain-relative paths, sizes and hashes under the token `brain_root`; a note's bytes cross only
  when a declared Brain schema migration admits that note as an input blob. Neither the absolute root
  nor a literal redaction pattern crosses (`tests/security/sentinel.test.ts`, `a planted sentinel,
  through update and rollback`).
- **Brain schema migrations** are token-only planners (`packages/brain/src/migrations/update/plan.ts`)
  inside the same compiled planner graph the lint gate checks. Their mutations pass folder-policy
  admission, form contiguous version chains, and retain a byte-exact inverse in the rollback payload,
  so `update rollback` restores a migrated note from its retained blob.
- **Preview and rollback write nothing to the Brain**, and uninstall after any update, rollback or
  reapply leaves every Brain note byte-identical (`tests/e2e/release-update.test.ts`).

### 6.15 The scheduled gardener writes only captures (NEW-134)

Added 2026-10-01. The optional `brain-garden` automation job selects up to two `gap` tags (≥ 4 notes,
no `compiled-note`, none pending) and up to five oldest `isolated` notes, asks one isolated vendor
agent for proposals, and writes the accepted ones as note captures; `review` and `ingest` stay the only
way into the vault (D47, D77). A `related` proposal adds only a trailing `## Related` list of 2–5
wikilinks and sets `updated` and `reviewed: null`, so a human note that gains agent links needs review
again. A hub is a `compiled-note` of plain prose and wikilinks that resolve by vault-relative path or a
unique file name. The rules and their tests: `threat-model.md` §5.17 and
`packages/brain/src/garden/`.

