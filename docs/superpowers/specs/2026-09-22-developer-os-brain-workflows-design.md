# Developer OS — Brain Workflows Design (A12b)

**Approved 2026-09-22 by the founder (D47).** Every open question is answered with its recommended
option, except A12 Q1: there is no production for now — the product runs from a local, unsigned build
on the founder's machine only; no release, signing or public install path is built until the founder
reopens it. Wherever this spec names the launcher or a packaged release as the install source, read
"the local build" (A12 Q1 option A, `trust: "unsigned-local"`, local only).

**Status: draft, 2026-09-22, awaiting founder approval.** Roadmap Phase 5b (`ORDER.md` A12b), scope
`docs/migration/instruction-inventory.md` §7, founder decision D11. Installation of the rendered
skills depends on the A12 spec (draft); nothing here assumes more of it than the roadmap's Phase 5
text. No implementation plan exists yet; §9 fixes the sequence one must follow.

**The rule this document implements (roadmap Phase 5b):** the agent never writes to the vault
directly; every mutation is a capture through the validators and a transaction. §2 turns that into
three closed mutation paths, and every other section hangs off one of them.

---

## Open questions for founder approval

Each has a recommendation; the rest of this document is written as if every recommendation is
accepted, and marks the sections an answer other than the recommendation would change.

### Q1. How does an agent-drafted note reach the vault — above all, how does `brain-enhance` change a note that already exists? (§3)

Ingest is create-only today (`threat-model.md` §5.4, "A proposal cannot overwrite the user's own
note"), so no shipped path can revise an existing note, and the ingest model — not the person who
reviewed the capture — writes the bytes that land.

- **A. Note captures with verbatim ingest (recommended).** `capture --note <path>` quarantines a
  complete note plus its destination and, when the destination exists, the SHA-256 of its current
  bytes. `ingest` applies such a capture **without calling a model**: the bytes the person reviewed
  in quarantine are the bytes the nine validators judge and the transaction writes, as `create`, or
  as `replace` bound to that hash through the executor's existing `expectedBeforeHash`. Plain
  captures stay model-ingested and create-only, unchanged. **Cost:** the whole note passes through
  capture's redact-and-normalize, including parts the agent never touched — CRLF becomes LF, NFD
  becomes NFC, control and format characters other than `\n`, `\t` and U+200D are removed, trailing
  whitespace is trimmed, and any high-entropy run of 40 or more characters (a full commit SHA, a
  hash) becomes `[REDACTED:high-entropy]`. What lands is still exactly what the person reviewed, and
  `review` shows the redaction count, but an enhanced note can lose such strings (§8 R8).
- **B. Targeted captures, model-ingested.** Same capture field, but the ingest model rewrites the
  note from the capture text. The person approves text and a model writes bytes nobody reviewed; a
  replace driven by model output is the exact boundary §5.4 exists to deny.
- **C. No replace at all.** `brain-enhance` creates a new note beside the old one, and the person
  retires the old one by hand. Nothing is ever revised in place; links into the old note keep
  pointing at it until `brain refactor --merge`.

### Q2. The roadmap's lint class names versus the six shipped classes (§5)

The roadmap asks for `stale`, `isolated`, `dead-link`, `duplicate`, `gap`. Three of them already
ship under other names (`brain.md` §3): `staleness`, `links`, `duplicates`. `LintClass` is published
on `brain lint --json`.

- **A. Map, and add two (recommended).** `stale`→`staleness`, `dead-link`→`links`,
  `duplicate`→`duplicates` are satisfied by the shipped classes; only `isolated` and `gap` are new.
  Additive to the `--json` contract.
- **B. Rename the three shipped classes** to the roadmap spellings. Breaks every `--json` consumer and
  every test pinning a class name, for no behavioural gain.
- **C. Add all five as new classes.** Three would duplicate shipped findings under a second name.

### Q3. May an agent apply `brain retire` / `brain refactor`? (§6.7)

Both are deterministic and transactional, so an applied run is "the product writing", not the agent.
But the likeliest trigger for an unwanted run is an instruction planted in a note the agent just read.

- **A. Dry-run anywhere, apply refused inside an agent session (recommended).** An applied run exits 5
  when any `AGENT_DETECTION_ROWS` marker is present; the rendered `brain-garden` skill prints
  `--dry-run` commands for the person. Covers `retire` and `refactor` only — `ingest` is run in-session
  by its own skill and is unaffected.
- **B. Allow agents to apply.** Simplest; the transaction and the post-conditions of §6.5 are the
  only guard.
- **C. Keep the verbs out of every skill** and do not restrict them. The agent can still find and run
  them.

### Q4. Where does a `brain-report` go? (§4.2)

The legacy `output` skill wrote into the vault; the skeleton ships an empty `_outputs/`.

- **A. Session output only; `file-back` turns it into a plain capture (recommended).** No new write
  path, no new folder policy. `_outputs/` stays unused by the product.
- **B. A product verb writes `_outputs/<slug>.md`** through a transaction. A fourth mutation path and a
  private-folder write exception, for a document the person can save themselves.
- **C. Report as a note capture** into a topic folder. Reports then become canonical notes and are
  indexed, linted and searched like knowledge, which they are not.

**Decided here unless you say otherwise** (each is the YAGNI default, stated so it can be overridden):
the real-vendor gate runs on Claude through `--plugin-dir` (§7.3); `retire`/`refactor` take
`--dry-run` and `--json` and no `--yes`, following `brain reindex` rather than design spec §8's
"every mutating command" sentence (§6.1); the `gap` threshold is a constant 3, not configuration
(§5.3).

---

## 1. Scope and invariants

### 1.1 Coverage of inventory §7

Every one of the 18 legacy skills is covered or carries a recorded disposition. At this phase's
close, §7's status column is updated to match this table.

| Legacy skill | Target | Disposition |
|---|---|---|
| `reindex` | `developer-os brain reindex` | shipped, unchanged |
| `lint` | `developer-os brain lint` | shipped; gains two classes (§5) |
| `ingest` (inbox files) | `developer-os import` → quarantine → `ingest` | A14, not here |
| `ingest` (YouTube) | — | refused (inventory §7), unchanged |
| `qa` (`--file-back`) | workflow `brain-answer`, input `file-back` | this spec §4 |
| `compile` | workflow `brain-compile` | this spec §4 |
| `enhance` | workflow `brain-enhance` | this spec §4, needs §3 |
| `curate` | lint `staleness` + `isolated` → `brain-garden` → `brain retire` | this spec §§4–6 |
| `gaps` | lint `gap` → `brain-garden` / `brain-compile` | this spec §§4–5 |
| lint classes for staleness | `staleness` (shipped), `isolated`, `gap` | this spec §5 |
| `garden` | workflow `brain-garden` | this spec §4 |
| `refactor` | verb `brain refactor --rename\|--move\|--merge\|--split` | this spec §6 |
| `output` | workflow `brain-report` | this spec §4 (Q4) |
| `onboard` | `init` template | shipped, unchanged |
| `research`, `research-deep`, `research-add-fields`, `research-add-items`, `research-report`, `excalidraw-diagram` | skills | A12, not here |

The vault-level instruction files and the vault `SessionStart` hook (inventory §7, last paragraph)
belong to A12 and A13.

### 1.2 Invariants

- **I1. The agent's declared write scope is quarantine and nothing else.** Every new workflow declares
  `write: [content/_raw/quarantine/**]`, derived from `capture.write` or the one new verb
  `capture.writeNote` (§3.5); no other verb is added to `EFFECT_VOCABULARY`.
- **I2. A model never writes bytes that replace a note.** Plain captures stay create-only
  (`apps/cli/src/commands/ingest.ts:1096`). Only a verbatim note capture (§3) replaces, and its bytes
  are the ones a person accepted.
- **I3. Every vault mutation is a Foundation transaction through `context.executor`**, the gated
  `CliTransactionExecutor` (`apps/cli/src/context.ts:164`, `lifecycle/mutation-gate.ts`), and every
  `replace` or `remove` of a note carries the `expectedBeforeHash` its caller read
  (`packages/core/src/transactions/types.ts:62-83`).
- **I4. Brain still never writes.** New planning code in `packages/brain` returns bytes and mutation
  lists; `apps/cli` executes them (`brain.md` §2).
- **I5. The nine validators stay nine.** `VALIDATOR_IDS` is not extended; §3.4 folds its checks into
  existing validators.
- **I6. Determinism.** Every plan in §6 is a pure function of the vault bytes, the arguments and the
  injected date, ordered with `compareCanonical` then `compareRawBytes` like `planIngestApply`.

---

## 2. The three mutation paths

| Path | Who writes the bytes | Human gate | Validators | Transaction |
|---|---|---|---|---|
| **P1. Plain capture → model ingest** (shipped) | the ingest model, from capture text | `review` accepts the capture | the nine | `create` only |
| **P2. Note capture → verbatim ingest** (new, §3) | the agent in session drafted them; a person reviewed them in quarantine | `review` accepts the capture | the nine, §3.4 | `create`, or `replace` bound to the capture-time hash |
| **P3. `brain retire` / `brain refactor`** (new, §6) | the product, deterministically, from the person's arguments | the person runs it (Q3) | §6.5 post-conditions | `create`/`replace`/`remove` with preconditions |

Nothing else mutates the vault. `brain-answer` and `brain-report` use P1 when `file-back` is true;
`brain-compile` and `brain-enhance` use P2; `brain-garden` uses P2 and prints P3 commands.

---

## 3. Note captures (Q1-A)

### 3.1 `developer-os capture --note <path>`

`<path>` is relative to the content root, POSIX, byte-exact, and obeys `ProposedNote.path`'s string
rules (`packages/brain/src/ingest/proposal.ts:129-136`: ends `.md`, ≤512 chars, no `\`, no control or
format character, no empty, `.` or `..` segment). The capture text (from `--text` or stdin, as today)
is the complete note.

`capture --note` additionally, before anything is written:

1. resolves `<contentRoot>/<path>` with the same containment `capture` already proves for quarantine
   (`apps/cli/src/context.ts:263-305`) and refuses a destination whose canonical form is outside a
   configured topic folder, inside any `PRIVATE_FOLDERS` segment or the indexes directory, or reached
   through a symlink (`brain.md` §6.2);
2. runs the ordinary redact → normalize pipeline (`capture/build.ts:167`), then `parseNote` over the
   normalized content followed by one `\n`, and refuses unless it parses with no `error` issue;
3. if the destination exists, requires it to be a regular file that discovery classifies as a
   canonical note, and records `beforeSha256` = SHA-256 hex of its bytes (the executor's encoding,
   `packages/core/src/transactions/executor.ts:228`); if it does not exist, `beforeSha256` is `null`.

Bounds: the normalized note is at most `MAX_PROPOSED_NOTE_CHARS` (64 KiB), the same bound a model
proposal has.

### 3.2 Envelope field

`CaptureEnvelopeV1` gains `note: { path: string; beforeSha256: string | null } | null`, additive,
`schemaVersion` unchanged:

- `renderCaptureFile` emits a `note:` mapping only when non-null, so every existing capture renders
  byte-identically;
- `parseCaptureFile` reads absent as `null`; present, it must be a mapping of exactly those two keys,
  `path` passing §3.1's string rules and `beforeSha256` 64 lowercase hex or `null`, else `unparseable`;
  it is preserved, never recomputed, like `captureId`;
- an older binary ignores the key (`parse.ts` reads named fields only), plans a `create`, and meets
  the occupied-path refusal — it fails closed.

The deduplication hash stays content-only; §8 R3 records the consequence.

### 3.3 Review

`review`'s listing rows gain `note: { path, replaces: boolean } | null` in `--json`, and the human line
reads `creates <path>` or `replaces <path>` followed by the capture's redaction count, so a person
accepting a capture sees which note it changes and whether redaction rewrote any of it. Decisions are unchanged; `edit` re-redacts the body and preserves `note`.

### 3.4 Verbatim ingest

`selectCaptures` is unchanged. A selected capture with `note !== null`:

- **makes no vendor call.** Its proposal is built deterministically:
  `{ schemaVersion: 1, notes: [{ path: note.path, contents: content + "\n", sourceCaptureId: captureId }] }`.
  Vendor resolution, and the exit-4 capability refusal, apply only when the batch holds a plain capture;
- **checks its precondition before validating.** When `beforeSha256` is non-null and the destination's
  current bytes hash differently (or it is gone), or when it is `null` and the destination is now
  occupied, the capture is refused with exit 3 `note_changed_since_capture`, stays `accepted`, and the
  recovery is `developer-os review --id <id> --decision reject`, then run the workflow again against the
  current note. "Run ingest again" is never offered: it would fail identically forever;
- **runs the nine validators** over a projection in which the destination is *replaced* rather than
  added. Two validators change, and only for a replacing note capture:
  - `duplicate-detection` exempts the destination path itself (still refusing a title or content-hash
    collision with any *other* note);
  - `source-and-provenance` additionally requires the replacement to keep the destination's `created`
    value;
- **applies** in the existing ladder (`ingest.ts:275-281`): `ingest-stage`, then `ingest-apply` with
  one `replace` carrying `expectedBeforeHash = beforeSha256` (or one `create`), then `ingest-reindex`,
  then `ingest-ingested`. A `TransactionPreconditionError` at apply maps to the same
  `note_changed_since_capture` refusal.

### 3.5 The `capture.writeNote` verb

`capture --note` reads the destination (§3.1 steps 1 and 3), so it cannot share `capture.write`'s
footprint (`read: []`) without under-declaring, and widening `capture.write` would change the
`capture` workflow's derived scopes and force its version bump. One verb is added instead:

```ts
"capture.writeNote": { read: ["content/**"], write: QUARANTINE, staging: false, capability: null,
  owner: "A12b", implemented: true, command: "developer-os capture --note" },
```

Because `command` names `--note`, every rendered step using it prints `developer-os capture --note`,
so the skill tells the agent which form to run. `packages/workflow-schema/src/vocabulary.test.ts`'s
pins and `workflow-schema.md` §5's verb count ("fifteen") are updated with it.

### 3.6 Amended documents

`knowledge-pipeline.md` §§3, 5, 7 and `threat-model.md` §5.4 are amended at this phase's close. The
§5.4 row becomes: *a model proposal cannot overwrite a note (P1 stays `create`; the
`malformed-manifest.test.ts` case stays green); only a verbatim note capture can replace, only the note
it named at capture time, only while that note still hashes to the value recorded then, and only with
bytes a person accepted.*

---

## 4. The five workflows

### 4.1 Common contract

- Layout `workflows/<id>/workflow.yaml` with `id` equal to the directory (`workflow-schema.md` §10.2);
  the roadmap's `workflows/*.yaml` names the same files.
- `schemaVersion: 1`, `version: 1.0.0`, `triggers: [manual]`, `capabilities: []`.
- `scopes: { read: [content/**, content/_indexes/**], write: [content/_raw/quarantine/**] }` — equal to
  the derived footprints of `brain.readIndex`, `brain.search`, `brain.readNote`, `brain.lint`,
  `capture.write` and `capture.writeNote`.
- The capture text goes on stdin through a quoted heredoc that starts with `developer-os`
  (`developer-os capture --note <path> <<'NOTE'`), never through a pipe, so a vendor permission of
  the form `Bash(developer-os:*)` admits it and shell metacharacters in the note are inert.
- Refusals from the closed `when` set only: `vault-missing` 1, `index-missing` 2, `input-invalid` 2,
  `scope-violation` 5.
- Steps carry no condition field. An effect step renders unconditionally, so an optional write is
  preceded by a prose gate step ("run the next step only when `file-back` is true").
- Input keys are slugs: `file-back`, not `fileBack`.

All five contracts are in Appendix A. **Each was loaded through the built compiler
(`packages/workflow-schema/dist`, `loadWorkflow`) on 2026-09-22 and returned a contract with zero
findings, with `capture.write` standing in for `capture.writeNote`**, which does not exist yet. The
substitution cannot hide a scope mismatch: the new verb's only extra footprint, `read: content/**`, is
already in every declared read set.

### 4.2 Per workflow

| Workflow | Inputs | Output | Effect steps | Writes |
|---|---|---|---|---|
| `brain-answer` | `question` (req.), `file-back` | `answer` | readIndex, search, readNote, capture.write | one plain capture, only with `file-back` (P1) |
| `brain-compile` | `topic` (req.) | `path` | readIndex, search, readNote, capture.writeNote | one note capture, new destination (P2 create) |
| `brain-enhance` | `note` (req., path) | `path` | readNote, readIndex, search, readNote, capture.writeNote | one note capture naming `note` (P2 replace) |
| `brain-garden` | `limit` (default 5) | `proposals` | lint, readIndex, readNote, capture.writeNote | ≤`limit` note captures, one per note; P3 commands printed with `--dry-run` only |
| `brain-report` | `subject` (req.), `file-back` | `report` | readIndex, lint, search, readNote, capture.write | one plain capture, only with `file-back` (P1, Q4-A) |

`brain-answer` and `brain-report` differ in shape, not mechanism: an answer is scoped to one question
and says "the vault does not say" when it does not; a report is a four-section document on a subject
that includes the lint state of the notes it read.

### 4.3 Rendering and installation

`npm run render:claude` and `npm run render:codex` emit `developer-os-brain-{answer,compile,enhance,
garden,report}/SKILL.md` into `plugins/claude/skills/` and `plugins/codex/skills/`; the checked-in
trees are regenerated in the same commit and the existing drift check covers them. Installation into a
user's vendor configuration is A12's (NEW-60 wiring, NEW-61 Codex re-registration); this phase ships
the rendered trees and nothing that installs them.

### 4.4 Amended repository invariant

`tests/contracts/workflows/canonical.test.ts` pins six workflows (`toHaveLength(6)`, `EXPECTED`) and
"keeps every vault write inside capture, review and ingest, and expresses each in verbs only". The
count becomes 11. The invariant is replaced by a stronger and more precise one: **only `ingest`
declares a write scope outside `content/_raw/quarantine/**`, and it is expressed in effect verbs
only.** A workflow whose writes are quarantine-only may carry prose, because prose writes nothing and
its only write is `capture.write`. `workflow-schema.md` §1 ("the six canonical workflows") is amended.

---

## 5. Lint classes (Q2-A)

### 5.1 Mapping

| Roadmap class | Shipped as | Change |
|---|---|---|
| `stale` | `staleness` | none |
| `dead-link` | `links` | none |
| `duplicate` | `duplicates` | none |
| `isolated` | — | new, §5.2 |
| `gap` | — | new, §5.3 |

`LintClass` gains `"isolated" | "gap"` (`packages/brain/src/lint/lint.ts:14`). Both are severity
`info`, so `brain lint`'s exit behaviour is unchanged. `brain.md` §3 ("the six lint classes") and §6.4
("without inventing a seventh class") are amended to eight.

**Ingest is unaffected by construction:** the three validators that read lint filter on an explicit
class (`provenance`, `links`, `duplicates` — `packages/brain/src/ingest/validate.ts:401,967,980`). A
test pins that a projection carrying only `isolated` and `gap` findings passes all nine.

### 5.2 `isolated`

One finding per canonical note that is neither the source nor the target of any `graph.json` edge,
self-edges excluded. `path` is the note, `key` `null`, `line` `null`, message "no link to or from this
note".

### 5.3 `gap`

One finding per index tag carried by at least `GAP_MIN_NOTES = 3` canonical notes, none of them of type
`compiled-note`. `path` is the lowest such note in canonical order, `key` `"tags"`, `line` `null`,
message "<n> notes share the tag <screened tag> and no compiled note covers it". The tag passes
`screenAndCap` like every interpolated vault string (`brain.md` §5).

---

## 6. `brain retire` and `brain refactor`

### 6.1 Grammar and parser changes

```text
developer-os brain retire <note> [--dry-run] [--json]
developer-os brain refactor --rename <note> <new-name> [--dry-run] [--json]
developer-os brain refactor --move   <note> <topic-folder> [--dry-run] [--json]
developer-os brain refactor --merge  <source> <target> [--dry-run] [--json]
developer-os brain refactor --split  <note> <heading> [--dry-run] [--json]
```

`<note>`, `<source>`, `<target>` are canonical notes named relative to the content root, byte-exact.
`<new-name>` is one segment ending `.md` passing §3.1's string rules. `<topic-folder>` is a configured
topic folder's directory name. `<heading>` is the exact text of one ATX heading (levels 2–6), at most
512 characters.

`apps/cli/src/main.ts`: `BRAIN_SUBCOMMANDS` replaces `query: boolean` with a positional count
(`reindex` 0, `lint` 0, `search` 1, `status` 0, `retire` 1, `refactor` 2) and declares per-subcommand
options (`retire`: `dry-run`, `json`; `refactor`: `dry-run`, `json`, `rename`, `move`, `merge`,
`split`); `COMMAND_OPTIONS.brain` gains the four mode flags; exactly one mode flag is required for
`refactor`, else the parse refuses (exit 2). `capture` gains the `note` option. The help text gains
both verbs and `--note`. Both verbs dispatch after `assertOrdinaryCommandAdmitted` like every
non-`init` command (`apps/cli/src/main.ts:531-533`); a test pins it.

### 6.2 Algorithm, common to every mode

1. Read the vault through discovery and build it in memory (`BrainService`, no index file needed).
2. Plan: a pure function in `packages/brain` returning the mutation list and the rewritten bytes (I4).
3. Project the plan onto the in-memory vault and check §6.5. Any failure: nothing written.
4. Refuse before allocation if the plan exceeds §6.6's bound.
5. Under `--dry-run`, stop and report the plan.
6. Otherwise execute one transaction (kind `brain-retire` or `brain-refactor`) through
   `context.executor`: `create` for each new path; `replace` and `remove` each carrying the
   `expectedBeforeHash` of the bytes read in step 1.
7. Rebuild the index in a second transaction through `writeIndexArtifacts` (`commands/reindex.ts`),
   exactly as `ingest-reindex` does and for the same reason: notes are not manifest-owned and the index
   artifacts are (`knowledge-pipeline.md` §5). A crash between 6 and 7 leaves an `index-drift` finding
   whose recovery is `developer-os brain reindex`.

Destination containment is stated directly rather than borrowed from ingest's `writeScope`, which
subtracts every private folder: a destination must canonicalize inside `<contentRoot>/<topicFolder>/`
for a configured topic folder, or inside `<contentRoot>/_graveyard/` for `retire` and `merge`, must not
pass through a symlink, and must not exist (`create`).

### 6.3 Modes

| Mode | Mutations | Body / frontmatter |
|---|---|---|
| `retire <note>` | `remove <note>`, `create _graveyard/<note>` | bytes unchanged. Refused when any other note links to `<note>` or lists it in `sources` |
| `--rename <note> <new-name>` | `remove <note>`, `create <dir>/<new-name>`, `replace` each referrer | moved bytes unchanged; referrers' links rewritten (§6.4) |
| `--move <note> <folder>` | `remove <note>`, `create <folder>/<basename>`, `replace` each referrer | as rename |
| `--merge <source> <target>` | `replace <target>`, `remove <source>`, `create _graveyard/<source>`, `replace` each referrer | target's header byte-exact; body gains `\n\n## <source title>\n\n<source body, trimmed>\n`; links to `<source>` retarget to `<target>` |
| `--split <note> <heading>` | `replace <note>`, `create <dir>/<slug>.md`, `replace` each referrer | the section (heading line to the line before the next heading of equal or higher level, or end) moves to the new note; it is replaced in the parent by `See [[<slug>]].`; links `[[<note>#<heading>]]` retarget to the new note without the anchor |

**No existing frontmatter is ever edited** — the product has no byte-preserving frontmatter patcher,
and none is added. The one note created with new frontmatter is a `--split` child, rendered fresh:
`schemaVersion: 1`, `title` = heading text, the parent's `type`, `tags` and `author`, `created` = today,
`stage: emerging`, `reviewed: null`, `summary` = `Split from <parent title>.` capped at 400 characters.
`<slug>` is the heading NFC-lowercased with every run of non-alphanumerics replaced by `-` and `-`
trimmed; empty or occupied refuses.

### 6.4 Link rewriting

An occurrence is a `[[text…]]` match that `extractLinks` counts (outside fenced and inline code,
`packages/brain/src/indexes/build.ts:221-233`). An occurrence whose old resolution is the moved note
`P` is rewritten **only if its text no longer resolves to the intended new target `T` in the projected
vault**, which keeps title- and alias-tier links untouched. The new text is `T`'s basename without
`.md` when that resolves uniquely to `T`, otherwise `T`'s content-root-relative path without `.md`.
Everything after the text inside the brackets (`#anchor`, `|display`) is preserved, except the
`--split` anchor, which is dropped. Only note bodies are edited; each header is kept byte-exact.

### 6.5 Post-conditions

Checked on the projection before anything is written:

1. every created or replaced note parses with no `error` issue;
2. the projection's lint has no `error` finding absent from the pre-state's, compared on
   (class, mapped path, key), with `index-drift` excluded;
3. the projection's graph edges, as a multiset of (source, target) with self-edges dropped, equal the
   pre-state's under the path map of §6.3 — plus the parent→child edge a `--split` adds.

Failure is exit 1 `refactor_postcondition_failed`, naming the first differing edge or finding.

### 6.6 Bounds

A plan holds at most 256 mutations, the executor's participant bound
(`packages/core/src/transactions/executor.ts:1095-1096`, and `:512` for lifecycle references) — not
Spec 1's `F(uninstall_artifacts)` capacity (NEW-85). Above it: exit 1 `refactor_too_wide`, refused
before any ID is allocated.

### 6.7 Agent sessions (Q3-A)

An applied `retire` or `refactor` refuses with exit 5 `brain_refactor_in_agent_session` when **any**
row of `AGENT_DETECTION_ROWS` (`packages/brain/src/capture/agent.ts`) matches the environment —
any-match, not `matchObservedAgent`'s single-match rule, so a nested session is refused rather than
read as unknown. `--dry-run` is always allowed. Recovery: run the printed command yourself in a
terminal outside the agent session.

### 6.8 Result

`BrainResultV1` gains one arm:

```ts
interface BrainRefactorResultV1 {
  readonly schemaVersion: 1;
  readonly subcommand: "retire" | "refactor";
  readonly mode: "retire" | "rename" | "move" | "merge" | "split";
  readonly transactionId: string | null; // null under --dry-run
  readonly mutations: readonly {
    readonly operation: "create" | "replace" | "remove";
    readonly path: string; // content-root-relative, byte-exact, screened only at the terminal
  }[];
  readonly rewrittenLinks: number;
}
```

### 6.9 Refusals

| Exit | Code | When |
|---:|---|---|
| 2 | `brain_refactor_input_invalid` | not a canonical note, bad name or folder, heading absent or ambiguous, `merge` of a note into itself, zero or two mode flags |
| 3 | `refactor_destination_exists` | a destination or `_graveyard` path is occupied |
| 3 | `retire_has_referrers` | `retire` of a note something links to or cites; the referrers are listed and the recovery names `brain refactor --merge` |
| 3 | `note_changed_since_read` | a precondition failed at apply; nothing was written |
| 1 | `refactor_postcondition_failed` | §6.5 |
| 1 | `refactor_too_wide` | §6.6 |
| 5 | `brain_refactor_path_refused` | a destination escapes containment or passes a symlink |
| 5 | `brain_refactor_in_agent_session` | §6.7 |
| 6 | existing | an incomplete transaction must be repaired first |

`brain.md` §6.11 ("Brain adds no exit class: 1, 2, 5, 6") is amended to add Foundation's 3 for these
conflicts.

---

## 7. Verification gates

### 7.1 Unit and contract

- `packages/brain`: `isolated` and `gap` findings, ordering and screening; the "ingest ignores both
  classes" pin (§5.1); each refactor mode's planner over synthetic vaults, including the untouched
  title-tier link, preserved `|display`, code-fenced links left alone, and each §6.5 failure; the
  planners are deterministic under a reversed directory reader.
- Capture: `note` round-trips through render/parse; an absent key renders byte-identically to today;
  every malformed `note` shape refuses `unparseable`.
- Ingest: a note capture never invokes the vendor (the planted fake exits 97 if executed,
  `tests/helpers/temp-home.ts:366`); `duplicate-detection` and `source-and-provenance` behave per §3.4.
- `tests/contracts/workflows/canonical.test.ts`: 11 workflows, §4.4's invariant; render drift for both
  trees.
- CLI parser: every §6.1 grammar case and refusal.
- **Agent markers in the test environment.** The suite may itself run inside Claude Code, where
  `CLAUDECODE=1` is inherited. Compiled-binary cases are safe because `tests/helpers/run-cli.ts`
  gives the child no inherited environment (`:47-51`); in-process command tests must inject the
  environment §6.7 reads, as `capture`'s agent detection already does, and never read
  `process.env`. The §6.7 cases set a marker explicitly; every applied-refactor case sets none.

### 7.2 End to end with a fake vendor — one per workflow

`tests/e2e/brain-workflows/<id>.test.ts`, against the compiled binary on the synthetic vault
(`templates/brain`, extended where a workflow needs a finding: an isolated note and a three-note tag
for `brain-garden`). Each test plays the agent: it runs, in step order, the `developer-os` commands the
**rendered** `SKILL.md` names (read from the generated file, so a skill naming the wrong command fails),
supplying canned prose output. It then drives the result to the vault: `review --decision accept`,
`ingest`, and asserts the note, its bytes and a lint with no `error`. Plain-capture paths use the
existing fake Codex executable and canned proposal (`tests/e2e/knowledge-lifecycle/lifecycle.test.ts`);
note-capture paths plant a vendor that must never run. Every test asserts with the temp-home
`inventory`/`addedPaths` diff that the workflow step itself added nothing outside quarantine.

### 7.3 Real vendor, once per workflow

`tests/integration/brain-workflows/claude.test.ts`, skipped when `claude` is absent (as
`tests/integration/claude/plugin-loads.test.ts`), run by a new `npm run test:vendor-brain` and excluded
from `test:suite` like `test:vendor-ingest`. One run per workflow:
`claude --plugin-dir plugins/claude -p "<invoke developer-os-brain-…>" --output-format json`, with the
built `developer-os` on `PATH` and tools limited to `Read` and `Bash(developer-os:*)`, against a
disposable home with the synthetic vault. Asserted: the output names a synthetic note path; the
inventory diff shows nothing but, where the workflow writes, one new file under `_raw/quarantine/`.
This proves the skill loads and drives the CLI on a real vendor; with write tools withheld it does not
prove the agent would refrain from writing if it had them (§8 R1).

**Each real run spends the founder's credits and is a founder stop condition** (D15 precedent). Codex
is not required by the gate: its plugin loading waits on A12's re-registration (NEW-61).

Results are recorded as rows in `docs/releases/compatibility-matrix.md` — created by this phase if
absent; DOS-P8 owns the rest of the matrix — one row per workflow: workflow and version, vendor and
version, date, commit, result, and the command run.

### 7.4 Security

Added to `tests/security/`, each watched failing first: a note capture aimed at `_raw/`, `_indexes/`,
`../`, a case-folded `_RAW/` and an in-vault symlink (refused, nothing written); a note capture carrying
the sentinel secret (redacted in the applied note, absent from every report); a replace whose target
changed after capture (exit 3, bytes intact, capture `accepted`); `malformed-manifest.test.ts`'s
replace refusal still green for plain captures; `retire`/`refactor` through a symlinked topic folder
(exit 5); applied refactor inside a detected agent session (exit 5, nothing written); and the
`brain-refactor` transaction kind added to `tests/security/interruption.test.ts`'s phase sweep.

### 7.5 Phase gate

Roadmap Phase 5b's gate, made concrete: every §7.2 test green; one §7.3 row per workflow with result
`pass` on Claude; `npm run check` green at plan close (D32).

---

## 8. Residuals

| # | Residual | Disposition |
|---|---|---|
| R1 | In an interactive session the vendor's own tools can still write the vault; the declared scope and the skill text are instructions, not enforcement | A13's `guard path` is the only mechanism that could deny it; recommended to A13, not decided here |
| R2 | `brain-enhance` binds the note's hash at **capture** time, not at the agent's read: an edit made between the agent's read and its `capture` is overwritten by a revision that never saw it | accepted; the person reviewing the capture sees the full note. Closing it needs `--note-sha256` from the agent |
| R3 | The deduplication hash is content-only, so two note captures with identical text and different destinations are one capture | accepted; the second is reported as a duplicate at exit 0, as today |
| R4 | §6.7's detection is environment-based and advisory against an adversary who strips it | accepted; it targets planted instructions in ordinary sessions |
| R5 | `brain-garden`'s `limit`, one-capture-per-note and "never apply" are prose | backstopped by review of every capture and by §6.7; a second capture against one note fails its precondition at ingest with the reject-and-rerun recovery |
| R6 | `--merge` does not union the source's `tags`/`aliases` into the target's frontmatter | follows from "no frontmatter patcher"; links by the source's title are still rewritten |
| R7 | Obsidian renders a note capture's inner frontmatter as body text inside quarantine | cosmetic |
| R8 | A replacing note capture normalizes and redacts the **whole** note (Q1-A's cost): line endings, normalization form, stripped control and format characters, trimmed trailing whitespace, and any high-entropy run of 40+ characters redacted | accepted as the price of "the reviewed bytes are the written bytes"; `review` shows the redaction count. Narrowing it needs a redactor that takes the class set to apply — the same change NEW-36 asks for |

---

## 9. Produced interfaces and sequence

**Produced:** the five workflow contracts and their rendered skills; the verb `capture.writeNote`;
`CaptureEnvelopeV1.note`;
`capture --note`; verbatim ingest; `LintClass` `isolated`, `gap`; `brain retire`, `brain refactor`,
`BrainRefactorResultV1`; `npm run test:vendor-brain`; `docs/releases/compatibility-matrix.md` rows.

**Sequence** (each step deployable; S/M/L):

1. **S** — lint classes (§5).
2. **L** — note captures and verbatim ingest (§3), with §7.4's capture and ingest cases.
3. **L** — `brain retire`/`refactor` (§6), with its security and interruption cases.
4. **M** — the five workflows, rendering, §4.4's invariant (§4); needs 2.
5. **M** — the five fake-vendor e2e tests (§7.2); needs 1–4.
6. **S** — real-vendor runs and matrix rows (§7.3); founder stop condition. Uses `--plugin-dir`, so it
   does not wait for A12's installation.

Documents amended at close: `brain.md` §§3, 6.4, 6.11; `knowledge-pipeline.md` §§1, 3, 5, 7;
`threat-model.md` §5.4; `workflow-schema.md` §1; `instruction-inventory.md` §7 statuses; the roadmap's
Phase 5b checkboxes.

---

## Appendix A. Workflow contracts

Normative. Validated with zero findings by `loadWorkflow` from the built `packages/workflow-schema` on
2026-09-22, with `capture.write` standing in for `capture.writeNote` (§4.1).

### A.1 `workflows/brain-answer/workflow.yaml`

```yaml
schemaVersion: 1
id: brain-answer
version: 1.0.0
description: Answer a question from the vault alone, naming a note path for every claim, and optionally file the answer back as a capture for review.
triggers:
  - manual
inputs:
  question:
    type: string
    required: true
    description: The question to answer from the vault.
  file-back:
    type: boolean
    required: false
    description: When true, quarantine the answer as one capture for review. False when absent.
output:
  answer:
    type: string
    required: true
    description: The answer, with a vault-relative source path for every claim.
capabilities: []
scopes:
  read:
    - content/**
    - content/_indexes/**
  write:
    - content/_raw/quarantine/**
refusals:
  - when: vault-missing
    exit: 1
    message: No vault was found. Run developer-os init first.
  - when: index-missing
    exit: 2
    message: The vault index has not been built. Run developer-os brain reindex first.
  - when: input-invalid
    exit: 2
    message: A question is required and must not be empty.
  - when: scope-violation
    exit: 5
    message: This workflow reads the vault and writes nothing but one capture, through developer-os capture.
steps:
  - id: load-index
    do: brain.readIndex
  - id: rank
    do: brain.search
    with:
      query: $input.question
  - id: read-notes
    do: brain.readNote
  - id: answer
    prose: |
      Answer only from the notes you read. Name the vault-relative source path
      for every claim. Where the notes do not answer the question, say that the
      vault does not say, and stop; never fill the gap from general knowledge.
  - id: file-back-gate
    prose: |
      Run the next step only when file-back is true. Otherwise the workflow ends
      here and writes nothing. When it runs, pass the answer with its source
      paths on stdin through a quoted heredoc:
      developer-os capture <<'CAPTURE' ... CAPTURE
  - id: file-back
    do: capture.write
validators:
  - every claim in the answer names a vault-relative source path
  - nothing is written except at most one capture, through developer-os capture, and only when file-back is true
recovery:
  leaves: at most one quarantined capture
  resume: developer-os review
```

### A.2 `workflows/brain-compile/workflow.yaml`

```yaml
schemaVersion: 1
id: brain-compile
version: 1.0.0
description: Synthesise one compiled note from the notes on a topic and quarantine it as a note capture; nothing reaches the vault until review and ingest.
triggers:
  - manual
inputs:
  topic:
    type: string
    required: true
    description: A tag or a query naming what to compile.
output:
  path:
    type: path
    required: true
    description: The quarantine path of the note capture.
capabilities: []
scopes:
  read:
    - content/**
    - content/_indexes/**
  write:
    - content/_raw/quarantine/**
refusals:
  - when: vault-missing
    exit: 1
    message: No vault was found. Run developer-os init first.
  - when: index-missing
    exit: 2
    message: The vault index has not been built. Run developer-os brain reindex first.
  - when: input-invalid
    exit: 2
    message: A topic is required, and a compiled note needs at least two source notes.
  - when: scope-violation
    exit: 5
    message: This workflow reads the vault and writes nothing but one capture, through developer-os capture.
steps:
  - id: load-index
    do: brain.readIndex
  - id: rank
    do: brain.search
    with:
      query: $input.topic
  - id: read-notes
    do: brain.readNote
  - id: draft
    prose: |
      Write one complete note: frontmatter, then body. The frontmatter has
      schemaVersion 1, type compiled-note, stage emerging, author agent,
      reviewed null, today's date as created, tags that include the topic, a
      summary of at most 400 characters, and sources listing every note path
      you read. The body synthesises those notes and links each one with a
      wikilink. Choose a destination path relative to the content root, inside
      a configured topic folder, that no note occupies yet. Stop with the
      input-invalid refusal when fewer than two notes were read. Then pass the
      note to the next step on stdin through a quoted heredoc:
      developer-os capture --note <path> <<'NOTE' ... NOTE
  - id: capture
    do: capture.writeNote
validators:
  - the capture was written with --note naming a destination no note occupies
  - every source the draft names is a note that was read
recovery:
  leaves: at most one quarantined note capture
  resume: developer-os review
```

### A.3 `workflows/brain-enhance/workflow.yaml`

```yaml
schemaVersion: 1
id: brain-enhance
version: 1.0.0
description: Propose a revision of one existing note as a note capture bound to the note's current bytes; the note changes only after review and ingest, and only if nobody edited it meanwhile.
triggers:
  - manual
inputs:
  note:
    type: path
    required: true
    description: The note to revise, relative to the content root.
output:
  path:
    type: path
    required: true
    description: The quarantine path of the note capture.
capabilities: []
scopes:
  read:
    - content/**
    - content/_indexes/**
  write:
    - content/_raw/quarantine/**
refusals:
  - when: vault-missing
    exit: 1
    message: No vault was found. Run developer-os init first.
  - when: index-missing
    exit: 2
    message: The vault index has not been built. Run developer-os brain reindex first.
  - when: input-invalid
    exit: 2
    message: The note must be an existing canonical note, named relative to the content root.
  - when: scope-violation
    exit: 5
    message: This workflow reads the vault and writes nothing but one capture, through developer-os capture.
steps:
  - id: read-target
    do: brain.readNote
  - id: load-index
    do: brain.readIndex
  - id: related
    prose: |
      Search once with the note's title and once with each of its tags, and
      read the matches that are not the note itself.
  - id: rank
    do: brain.search
  - id: read-related
    do: brain.readNote
  - id: draft
    prose: |
      Write the whole revised note, frontmatter and body. Keep every frontmatter
      key you do not mean to change exactly as it is, created included, and set
      updated to today's date. Improve the summary, tags, aliases and links to
      the related notes you read; do not invent facts no note states. Then
      pass the whole note to the next step, with --note naming the note being
      revised, on stdin through a quoted heredoc:
      developer-os capture --note <note> <<'NOTE' ... NOTE
  - id: capture
    do: capture.writeNote
validators:
  - the capture was written with --note naming the note being revised
  - the revision keeps the note's created date
recovery:
  leaves: at most one quarantined note capture
  resume: developer-os review
```

### A.4 `workflows/brain-garden/workflow.yaml`

```yaml
schemaVersion: 1
id: brain-garden
version: 1.0.0
description: Turn brain lint findings into proposals - note captures for content fixes, printed dry-run commands for structural ones - and never change the vault directly.
triggers:
  - manual
inputs:
  limit:
    type: integer
    required: false
    description: The most captures to propose in one run. 5 when absent.
output:
  proposals:
    type: string
    required: true
    description: Every capture path written and every command printed, one per line.
capabilities: []
scopes:
  read:
    - content/**
    - content/_indexes/**
  write:
    - content/_raw/quarantine/**
refusals:
  - when: vault-missing
    exit: 1
    message: No vault was found. Run developer-os init first.
  - when: index-missing
    exit: 2
    message: The vault index has not been built. Run developer-os brain reindex first.
  - when: input-invalid
    exit: 2
    message: A limit must be a positive integer.
  - when: scope-violation
    exit: 5
    message: This workflow writes nothing but captures, through developer-os capture.
steps:
  - id: lint
    do: brain.lint
  - id: load-index
    do: brain.readIndex
  - id: read-notes
    do: brain.readNote
  - id: triage
    prose: |
      Read the findings from developer-os brain lint --json. For a staleness,
      provenance or isolated finding on one note, write the whole revised note:
      keep every frontmatter key you do not mean to change, created included,
      set updated to today, and add links to related notes you read. For a gap
      finding, write one new note of type compiled-note on that tag, with
      sources listing the notes it draws on, at a path no note occupies. Pass
      each note to the next step with --note naming its path, on stdin through
      a quoted heredoc: developer-os capture --note <path> <<'NOTE' ... NOTE.
      Propose at most limit captures, and at most one per note. For a
      duplicates finding, do not capture anything: print the developer-os brain
      refactor --merge or brain retire command with --dry-run for the person
      to run, and never run either without --dry-run.
  - id: propose
    do: capture.writeNote
validators:
  - no more captures than limit, and at most one per note
  - every structural proposal is printed with --dry-run and never applied
recovery:
  leaves: up to limit quarantined note captures
  resume: developer-os review
```

### A.5 `workflows/brain-report/workflow.yaml`

```yaml
schemaVersion: 1
id: brain-report
version: 1.0.0
description: Write a report for a person on one subject from the vault and its lint state, citing a note path for every claim, and optionally file it back as a capture.
triggers:
  - manual
inputs:
  subject:
    type: string
    required: true
    description: What the report is about - a query, a tag, or a topic folder.
  file-back:
    type: boolean
    required: false
    description: When true, quarantine the report as one capture for review. False when absent.
output:
  report:
    type: string
    required: true
    description: The report, with a vault-relative source path for every claim.
capabilities: []
scopes:
  read:
    - content/**
    - content/_indexes/**
  write:
    - content/_raw/quarantine/**
refusals:
  - when: vault-missing
    exit: 1
    message: No vault was found. Run developer-os init first.
  - when: index-missing
    exit: 2
    message: The vault index has not been built. Run developer-os brain reindex first.
  - when: input-invalid
    exit: 2
    message: A subject is required and must not be empty.
  - when: scope-violation
    exit: 5
    message: This workflow reads the vault and writes nothing but one capture, through developer-os capture.
steps:
  - id: load-index
    do: brain.readIndex
  - id: lint
    do: brain.lint
  - id: rank
    do: brain.search
    with:
      query: $input.subject
  - id: read-notes
    do: brain.readNote
  - id: report
    prose: |
      Write the report in four sections: what the vault knows, with a source
      path for every claim; open questions it does not answer; lint findings
      on the notes you read; and notes worth revising, each named by path.
      Never state what no note says.
  - id: file-back-gate
    prose: |
      Run the next step only when file-back is true. Otherwise the workflow ends
      here and writes nothing. When it runs, pass the report on stdin through
      a quoted heredoc: developer-os capture <<'CAPTURE' ... CAPTURE
  - id: file-back
    do: capture.write
validators:
  - every claim in the report names a vault-relative source path
  - nothing is written except at most one capture, through developer-os capture, and only when file-back is true
recovery:
  leaves: at most one quarantined capture
  resume: developer-os review
```

