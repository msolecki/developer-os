# The Brain engine

What `@developer-os/brain` is, what it deliberately cannot do, and what it left open.
Written when DOS-P2 closed on 2026-08-10; the implementation plan was deleted in the same
commit, per `SESSION.md`. The design of record is
`docs/superpowers/specs/2026-07-21-developer-os-brain-engine-design.md`.

Read this before changing Brain code. Read the spec before changing Brain *behaviour*.

## 1. What it is

A workspace package that turns a directory of Obsidian-compatible Markdown into a
deterministic index, a graph, two rendered views, a lint report, and a search — with no
agent adapter present and no network call.

| Directory | Responsibility |
|---|---|
| `src/schema/` | `NoteFrontmatterV1`, strict parse, reserved vocabulary, byte-identical rewrite; `CaptureEnvelopeV1` as a type only; brain config defaults |
| `src/discovery/` | deny-by-default enumeration, folder policy, symlink refusal |
| `src/indexes/` | `index.json`, `graph.json`, and the two Markdown views; one `renderArtifacts` produces all four |
| `src/lint/` | the six classes of spec §7, and canonical-form drift |
| `src/retrieval/` | the two-stage funnel and its integer scorer |
| `src/migrations/` | `BrainMigration` and a deliberately empty registry |
| `src/redact.ts` | the one screen and the one bound applied to any vault text this package prints |
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
Design spec §4.4 clause 5.

**It does not stem.** `cache` does not reach a note titled `caching`; tags and aliases are
the documented mitigation. Spec §8 states this as a non-goal.

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
   `schema/note.ts` and in spec §4.4.
3. **`NoteFrontmatterV1` is a design decision, not a migration fact.**
   `docs/migration/baseline-capabilities.json` froze the vault's *capabilities* and nothing
   about note schema, so the fixture's frontmatter is invented rather than recovered.
4. **The fixtures are never generated from, compared against, or refreshed from a real
   vault.** If one misses a shape the product must support, extend it and say so in the
   commit. `tests/fixtures/brain/README.md` carries the rule.
5. **Every screen of vault text is one function, in `redact.ts`.** It began as three copies —
   lint's finding message, search's title and summary, and the parser's echoed-back key —
   and the third copy is what merged them. A screen that exists three times is a screen that
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

Three open decisions remain in `BACKLOG.md` §1. **NEW-6**: `duplicates` groups titles on
unscreened bytes while the catalog now renders the screened form, so two titles differing
only by a zero-width space render identically and are reported as no duplicate. **NEW-7**:
a link destination's percent-encoding is verified against CommonMark and not against
Obsidian, because there is no Obsidian here to ask. **NEW-5**: `LintFinding` reports a line two ways —
a structured field for frontmatter findings, and prose inside the message for `index-drift`.
NEW-4 closed on 2026-08-10 as design spec §4.4 clause 5.

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
