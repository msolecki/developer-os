# Developer OS — The Knowledge Pipeline

**Written 2026-08-15 by DOS-P6 Task 19; closed 2026-08-24.** This is the canonical
design and implementation record for the completed knowledge pipeline. Its completed plan and
specification were deleted at closure; git history is the archive.

`capture`, `review` and `ingest` are three CLI verbs over one data type. An observation an agent
wrote in its own words becomes a redacted file in quarantine, a human decides on it, a vendor model
proposes canonical notes from it, nine deterministic validators judge the proposal, and Developer OS
— never the model — writes the result. **This is the first subsystem in the program that executes a
workflow verb.** Everything before it emitted, validated or rendered.

**Every claim here points at code or at a named test case**, `path:line`, which is the standard
`threat-model.md` holds itself to. A new citation should prefer the anchor form — a backticked path, an em dash, a backticked identifier the file contains — which the citation gate checks by content; a line number is only bounds-checked, so it can silently drift onto unrelated code. Where a claim rests on something weaker, it says so in the
sentence rather than in a footnote. The threat model is the companion document: it owns the trust
boundaries and their mechanisms, and this note owns the shape of the pipeline and the decisions that
produced it.

---

## 1. What survives, in one table

| | Where |
|---|---|
| the three verbs | `apps/cli/src/commands/capture.ts`, `review.ts`, `ingest.ts` |
| `import`, the second entrance beside `capture` (A14) | `apps/cli/src/commands/import.ts`, over the quarantine seam `capture` shares (`apps/cli/src/commands/quarantine.ts`). It turns inbox, path and Claude memory files into quarantined captures through `buildCapture` unchanged, and never reviews, ingests or reindexes. `review` and `ingest` treat an imported capture like any other |
| the envelope, its statuses, and their transitions | `packages/brain/src/schema/capture.ts`, `packages/brain/src/capture/`, `packages/brain/src/review/` |
| the proposal, the nine validators, and the apply | `packages/brain/src/ingest/` |
| structured-result schemas | `packages/workflow-schema/src/vocabulary.ts`: every verb declaring `structured_result` gets one product-shipped JSON Schema; today that set is `ingest.stage` |
| the contracts the vendor trees render | `workflows/{capture,review,ingest,brain-search,shared}/workflow.yaml`, the `extends` pins and versions are in `workflows/*/workflow.yaml` (`grep -n '^version:' workflows/*/workflow.yaml`). On 2026-10-06: `capture`, `ingest` and `shared` at `2.0.0`, `review` at `2.1.0`, `brain-search` at `2.0.1`; the brain workflows (`brain-answer`, `brain-compile`, `brain-enhance`, `brain-report`) at `1.0.1` and `brain-garden` at `1.1.0`; `doctor` at `1.0.0`. The glob matches eleven files, not five |
| the closed verb-mapping defect | Before DOS-P6, three shipped skills in each vendor tree named commands with no handler. The effect vocabulary now binds each implemented verb to its command in `packages/workflow-schema/src/vocabulary.ts`; `workflow-schema.md` §§5, 7 records the compiler side |
| the security suites | `tests/security/`, eleven suites (the count is checked by `tests/repository/citations.test.ts`); 90 cases when last collected, on 2026-08-17 |
| the end-to-end run against the compiled binary | `tests/e2e/knowledge-lifecycle/lifecycle.test.ts` |
| trust boundaries and the mechanism enforcing each | `docs/architecture/threat-model.md` |

---

## 2. Capture content is agent-authored, and both automatic paths went with it

The canonical `capture` workflow declared two triggers — `manual` and `session_end` — and takes a
required `text` input, the observation itself. **A `session_end` hook cannot supply that text.** The
only session content either vendor hands a hook is `transcript_path`, and this product opens that
field on no code path (`tests/repository/transcript-path.test.ts`). So the observation has to come
from the agent, mid-session, at the point of insight: the rendered skill tells it to run
`developer-os capture` with its own summary.

**Hooks are therefore declined, not deferred.** *Amended 2026-09-22 (A13, D47): this holds only for the two capture hooks, `session_end_capture` and `pre_compact_backup`. The eight non-capture hook verbs ship in both vendor trees (`hooks.md` §3.1), and the not-used list is four keys (see "The capability vocabulary" below). The text that follows is the 2026-08-13 record.* Both adapter notes recorded the blocker
as a missing executable bit; that was wrong and is corrected here, because a
later reader would otherwise solve the wrong problem. A `"type": "command"` handler names a command
*string*, so naming the installed binary ships no script and needs no mode bit. What hooks lacked was
content to capture.

**What it cost, each item accepted by the founder on 2026-08-13:**

- **both unfireable triggers were dropped, and that is why five contracts changed version.**
  `workflows/capture/workflow.yaml` loses `session_end` and `workflows/shared/workflow.yaml` loses
  `session_start`; each now declares `triggers: [manual]` and nothing else
  (`workflows/capture/workflow.yaml:5-6`, `workflows/shared/workflow.yaml:5-6`), and a grep across
  `workflows/` and `plugins/` finds neither word. A step list and a scope set are the contract and
  `extends` pins `id@version` exactly, so a changed contract under an unchanged version is a workflow
  that means two different things at one name — **all five went to `2.0.0`**, three of them for
  reasons of their own: `ingest` gained a `reindex` step and wider write scopes, `brain-search`
  gained `brain.readNote` and a wider read scope, and `review` gained the `capture.edit` verb its
  `decision` input had been advertising. `workflow-schema.md` §7 recorded those two triggers as
  values that validate while the property they name is false; that paragraph's schema point still
  stands and no shipped contract exercises it any more;
- no hooks ship, in either vendor tree, in v1 (*reversed by A13 for the eight non-capture verbs; the capture hooks stay declined*);
- `developer-os run claude|codex` is never built;
- **nothing automatic captures anything.** If nobody runs the workflow, no knowledge is captured.
  This is the largest product narrowing in the program to date and it is deliberate.

**The capability vocabulary changed with the decision.** `wrapper-required` was removed rather than
kept beside a new value: it meant "we are not certain, and the wrapper produces the same capture
anyway", and the decision deletes the second half, leaving advice to run a command that will not
exist. `CAPABILITY_STATES` is `yes | unknown | not-used`
(`packages/core/src/capabilities/index.ts`), and, since A13, `session_end_capture`, `pre_compact_backup`, `subagents` and
`durable_project_guidance` resolve to **`not-used` before the version table or any observation is
consulted**, in both adapters (`CLAUDE_NOT_USED_KEYS`, `CODEX_NOT_USED_KEYS`). `plugin_hooks` and
`session_start_injection` left both lists with A13 and are observed through firing records
(`hooks.md` §3.6); on 2026-08-13 they were in the list with the other four. Removing a
key from either adapter's `NOT_USED` list requires, in the same change, the artifact it describes and
a test that observed it working — the rule that kept `plugin_hooks` from ever resolving to `yes` over
a file that does not exist. Parity between the two lists is asserted by
`apps/cli/src/adapter-capability-parity.test.ts`.

**`sourceAgent` records `"unknown"` until a real vendor run observes a row, and since 2026-08-20 both
vendors have one.** `AGENT_DETECTION_ROWS` (`packages/brain/src/capture/agent.ts`) carries
`CLAUDECODE=1`, observed 2026-08-15 on Claude Code 2.1.233, and `CODEX_THREAD_ID` **on presence**,
observed 2026-08-20 on `codex-cli 0.147.0`. Both were taken with every `CLAUDE*`, `CODEX*` and
`ANTHROPIC*` variable stripped from the parent, so neither marker can be one leaking in from the
session that ran the experiment — the first attempt at the Claude row inherited them and was
discarded for exactly that reason.

**Codex's row was absent for five days rather than guessed**, because the account's usage limit was
exhausted on 2026-08-15 and every `codex exec` ended `turn.failed` before a shell command could report
an environment. Every capture written inside a Codex session in that window records
`sourceAgent: "unknown"` and `sourceAgentVersion: "unknown"`. **Those captures are correct and are
never rewritten.** A guessed row would have been exactly the undocumented capability assumption this
subsystem treats as a release blocker.

**Which of four observed variables became the row is the part worth carrying.** A shell command inside
`codex exec` saw `CODEX_CI=1`, `CODEX_SANDBOX=seatbelt`, `CODEX_SANDBOX_NETWORK_DISABLED=1` and
`CODEX_THREAD_ID=<uuid>`, identically under both sandbox modes. The two `SANDBOX` names describe the
sandbox rather than the vendor — absent under `danger-full-access`, platform-valued — and `CODEX_CI`
reads as a marker of non-interactive `exec`. The thread id is per-session, so the row matches on
presence and is the first real row to drive that branch of `matchObservedAgent`.

**What neither row covers is the interactive session**, and that is the limit of both. Claude's was
taken through `claude -p`, Codex's through `codex exec`; the TUI, where a founder actually captures,
has never been observed on either vendor. A row that does not hold there records `"unknown"`, which is
the safe direction. Registered in `BACKLOG.md` §1.

The rule that reads the table is still tested against synthetic rows, so it is not a rule whose first
run is the day someone adds one, and two cases now drive detection through the **real** table end to
end — one per vendor. Without them the observations would live in unit tests with nothing proving the
command consumes them.

---

## 3. The capture path, and the one ordering that is absolute

```text
text → redact → normalize → deduplicationHash → captureId → envelope + body
```

`buildCapture` (`packages/brain/src/capture/build.ts:209`) runs that order and no other, over
`redactAndNormalize` (`:174`). **The raw text exists only in memory**: it is never written, never
logged, never hashed and never reaches a model. The hash is taken over the *redacted, normalized*
content, so two texts differing only by a secret produce one capture — a consequence rather than an
accident, since the observation is the same observation and nothing of the second secret survives the
duplicate.

The envelope persists **class and fingerprint only**, never a value and never enough of one to
reconstruct it (`packages/brain/src/schema/capture.ts:47-50`). The findings are rebuilt at that
boundary rather than passed through, so a widened `RedactionFinding` upstream cannot carry a secret's
location into a persisted envelope without someone deciding to.

**A capture is not a managed artifact.** `writeQuarantineCapture`, which `capture` and `import`
share, records nothing in `installation-manifest.json` (`apps/cli/src/commands/quarantine.ts:257-262`): a capture is the user's own
content, hand-editable in Obsidian by design, so recording it would report every legitimate edit as
drift and would make the next capture of the same text a refused `create` over a file the product
claims to own. The write still goes through `validateChangePlan` with quarantine as the sole owned
root and the product home as the excluded one (`:307-308`), which is what refuses a symlink inside one
resolving into the other.

**A duplicate is reported at exit 0 and writes nothing** (`apps/cli/src/commands/capture.test.ts:370`), including when this
run loses the race to write it (`:436`) and when the existing file cannot be parsed (`:404`). It is
**not** an `O_EXCL` create, and cannot be: no transaction-mediated write can
deliver that precondition. The optional caller-supplied precondition Foundation gained on 2026-08-20
(§10.2 below) does not change that: `capture` supplies none and wants none, because the residual is
benign when the id is the content hash.

**`captureMethod` has four values** (`CaptureBuildRequest`): `agent-authored` and `manual` from
`capture`, chosen by whether a detection row matched, and `import` and `import-claude-memory` from
`import`, by source. `import` sets `sourceAgent` and `sourceAgentVersion` to `"unknown"`, because
the source file's author was not observed. It fingerprints the source root, or the vendor's
project-directory name for memory, and puts no path in the envelope.

**Import captures are not manifest rows either.** `import` writes one Foundation `create`
transaction per new capture with the same shape and roots as `capture`, and records nothing in
`installation-manifest.json`, for the same reason. The source file is never moved or removed, so
the capture id, a content hash, is the cursor: a rerun over an unchanged source is a duplicate at
exit 0.

### 3.1 `import`: sources, batches and refusals (A14)

All in `apps/cli/src/commands/import.ts` — `runImport` unless named.

- **Sources.** Bare `import` drains `<content>/_raw/inbox`. `import <path>` takes a file or a
  directory inside the inbox, or outside both the vault and the product home: overlap with the
  product home refuses `import_source_in_product_home` (5), a vault path outside the inbox
  `import_source_in_vault` (2), a protected root `import_source_protected` (5), a missing one
  `import_source_not_found` (2). `--claude-memory` reads `claude-adapter.md` §15's layout; with a
  `<path>` it is a usage error, exit 2. Inbox and quarantine are each proven inside the content root
  (`import_root_not_contained`, 5). No configuration or no vault refuses `not_initialized` (1); a
  vault path that is not a directory, `vault_not_directory` (2).
- **Walk.** Depth-first with `lstat`, never following a link, and finished before any file is read,
  so a bound refusal writes nothing. Names beginning `.` are skipped silently. `.md`, `.markdown`
  and `.txt` are accepted; any other entry is `skipped` `unsupported_type` and leaves the exit code
  alone; a link is the per-file `import_source_symlink`. Order is the NFC source-relative path
  compared as UTF-8 bytes. More than `IMPORT_MAX_ENTRIES_WALKED` (10,000) entries, `IMPORT_MAX_DEPTH`
  (16) levels or `IMPORT_MAX_MEMORY_PROJECTS` (1,000) memory project directories refuses
  `import_enumeration_limit` (2).
- **Batches.** `IMPORT_MAX_FILES_PER_RUN` (1,000), narrowed by `--limit`, counts only new captures.
  Duplicates are counted in `duplicateCount` and not listed; accepted non-duplicate files beyond the
  cap are `remaining`, exit 0. A rerun over the inbox therefore advances.
- **Per file** (`processCandidates`). Read through `readUntrustedText` at `MAX_CAPTURE_INPUT_BYTES`
  (64 KiB). A refusal (`import_source_protected` and `_symlink` 5, `_not_found` 2, `_too_large`,
  `_not_text` and `_empty` 1; a non-regular file reads as `_not_text`) leaves the file untouched and
  the run continues. Rows name the redacted source-relative path, never content. The run exits with
  the most severe per-file code (`foundation.md` §6), the whole `ImportResultV1` riding on
  `CliError.data` (§10.2 item 4).
- **Run stop.** Any other failure mid-run, a mutation-gate refusal included, ends the run with its
  own code; finalized files stay, and the unprocessed ones are counted in `remaining`.
- **Dry run.** Writes nothing: no key, no directory, no transaction. Without an existing key it
  detects no duplicates and reports every accepted file `would_import` with `captureId: null`.
- **An edited source is new content**, so it becomes a new capture; review is the filter.

---

## 4. Review, and where a hand edit is brought back under the guarantees

`applyReviewDecision` (`packages/brain/src/review/decide.ts:121`) is a status change and nothing else.
Which statuses each decision is legal from is a table, `LEGAL_FROM` (`:81-86`), checked at `:125`;
`accept → accepted`,
`reject → rejected`, and **`edit` maps back to the status it came from** (`:95-99`), because no status
means "edited" — `CAPTURE_STATUSES` is frozen at six members and recording an edit would mean adding
a seventh to say what the file's own mtime already says.

**The content transition an edit really is happens in the parser.** `parseCaptureFile`
(`packages/brain/src/capture/parse.ts:163-167`) recomputes exactly three fields — `content`,
`deduplicationHash` and `redaction` — and preserves everything else. A hand edit is legitimate, and it
is how a secret gets pasted into a vault file, so the body is **re-redacted on the way in** rather
than trusted until ingest.

**The id is assigned once and never recomputed** (`packages/brain/src/capture/parse.ts:22-26`, amended by the founder
2026-08-13). Under recomputation every content-changing edit would refuse, and the secret the user
pasted would stay in the file — the one outcome `capture.edit` exists to prevent. `review` gained
that verb in DOS-P6: the workflow's `decision` input offered `edit` while its only mutating verb was
`capture.setStatus`, and a verb nothing declares closes nothing.

**No capture is ever deleted** — not on reject, not on ingest, not on uninstall
(`uninstall.test.ts`, the case asserting quarantine is untouched).

---

## 5. Ingest is four transactions per capture, plus a compensating fifth

**The retired design's headline sentence — "one capture, one agent call, one transaction" — is false
and cannot be made true.** This section is the surviving correction.

```text
accepted capture
  → status → staging                          (ingest-stage)
  → prompt from envelope.content, marked as DATA
  → adapter.invoke(read-only sandbox, zero write scopes)
  → IngestProposal, parsed
  → the nine deterministic validators
  → one create per proposed note              (ingest-apply)
  → brain reindex                             (ingest-reindex)
  → status → ingested                         (ingest-ingested)
```

The five kinds are `apps/cli/src/commands/ingest.ts:274-280`; the ladder is documented at `:1539-1552`
and the reasons at `:257-273`. **Two independent reasons no two of them merge:**

1. **`BrainService.reindex()` reads the vault** (`packages/brain/src/service.ts:226`), so it cannot
   run until the apply has finalized — and it has no write channel at all, by design, so the CLI
   stages its bytes through the executor exactly as `brain reindex` does
   (`apps/cli/src/commands/ingest.ts:1417-1452`).
2. **`validateChangePlan` grants ownership from the manifest**, where the four index artifacts *are*
   owned — recorded as rows under a V1 manifest (`apps/cli/src/commands/reindex.ts:356-379`), adopted
   from disk under a V2 one, for which `recordArtifacts` returns early — and a capture deliberately
   **is not** (`apps/cli/src/commands/quarantine.ts:257-262`). One transaction cannot hold both regimes.

A third reason applies to the first pair alone: the status must be durable *before* the apply, or a
crash cannot be told from a run that never started.

**The residual, accepted rather than closed.** A crash between the apply and the last transaction
leaves a capture at `staging` with its notes already in the vault. It is **inert**: `selectCaptures`
selects only captures whose status is `accepted` (`ingest.ts:663`), so the next run cannot
double-apply. It is visible, and a hand edit of the status is what moves it — which is what
`PARTLY_APPLIED_RECOVERY` (`ingest.ts:314-315`) tells the user, in those words and no others: **the
`repair` half of that advice is a different constant.** `INCOMPLETE_TRANSACTION_RECOVERY`
(`:336-337`) is appended unconditionally by `refusedRecovery` (`:389`), so the two arrive together in
the output while neither line alone says both. **No arrangement of these transactions removes that
window**, because no two of them can share one.

**The model gets zero declared write scopes**, and each vendor's sandbox follows from that
count rather than from an argument: `invokeCodex` derives `-s read-only` from `writeScopes.length === 0`
(`packages/adapter-codex/src/invoke.ts:310`), and the Claude side now passes no tools at all —
`--tools ""` rather than a read-only allow-list (`packages/adapter-claude/src/invoke.ts:122`; the
reasoning is at `apps/cli/src/commands/ingest.ts:1032-1035`). The alternative, a staging-only write scope, was rejected:
under it "the model cannot write outside staging" is a property our validators must prove after the
fact, and every file in staging becomes attacker-influenced content we must treat as hostile on
read-back. Under this design it is a property the vendor's own permission system enforced **before the
model ran**.

**One asymmetry a reader will otherwise assume away.** `--output-schema` reaches Codex only;
`invokeClaude` has no such flag, so on that vendor the schema is described in the prompt and enforced
by `parseIngestProposal` afterwards (`ingest.ts:1084-1093`, `:1683`).

**A note capture skips the model.** It is applied verbatim, with no vendor call, as one `create` or
one `replace` bound to its capture-time hash; `brain.md` §6.13 has the contract.

### 5.1 A hand edit while the agent runs refuses the ingest (D83 (2), NEW-40)

The agent call is the widest read-to-write window the product has — minutes, not milliseconds —
and the user may be editing the vault in Obsidian during it. **The user's edit wins, the ingest
writes nothing, and the user reruns it.**

- **What is bound, and when.** For a plain capture, after the staging write and before the call,
  `snapshotBeforeCall` records the identity (`dev`, `ino`) and SHA-256 of every file the ingest
  will write: the capture, bound to the exact bytes the staging write put down, and the four index
  artifacts `ingest-reindex` replaces. `index.json` is bound to the bytes the prompt's excerpt was
  parsed from (`readIndexExcerpt`), not to a second read; the run re-reads that excerpt before each
  capture whose index bytes moved, so one edit refuses one capture, not every later one. A missing
  file is recorded as absent. The proposal's destinations are unknown until the call returns, so
  the content root's names are listed instead. Timestamps are never compared.
- **The check.** `assertVaultUnchanged` runs after validation and before `applyNotes`, so before
  any note, directory, index or status lands. Any bound file whose identity or bytes differ, that
  appeared or that disappeared, and any proposed destination whose presence differs from the
  listing — a file created there, or a note the user deleted that a `create` would bring back —
  refuses the capture with exit 3 and reason `vault_changed_during_ingest`. A destination
  that already existed before the call keeps the create-only refusal. **An edit to a note this
  run will not write is not guarded** and does not refuse.
- **What is left.** No note and no index is written. If the user left the capture alone, the
  compensating write puts it back to `accepted` and the recovery reads
  `the capture is accepted again: rerun developer-os ingest`. If the user edited the capture, the
  compensating write is refused too, so the edit stays as the user wrote it, at `status: staging`;
  the recovery tells them to set it back to `accepted`, then `rerun developer-os ingest`. If the
  user deleted the capture, `leftAt` is `absent` and the recovery says there is nothing to rerun.
  The capture never leaves quarantine.
- **The two later capture writes** (`ingest-ingested` and `ingest-rollback`) carry the staged
  bytes' digest as `expectedBeforeHash`, which narrows the milliseconds between the check and each
  write to the executor's own gap between its plan-phase comparison and the rename — a
  pre-existing residual of every bound write. An edit landing after the apply is refused rather
  than overwritten, and the capture is reported `staging` with its notes named, under the
  partly-applied recovery; that refusal is never `untouched`, which only the stage write's
  plan-phase refusal can mean. A note capture makes
  no vendor call and is guarded by `note_changed_since_capture` instead (`brain.md` §6.13).

### 5.2 Selection order across runs (NEW-141, 2026-10-06)

Inside one run every selected capture is attempted once, so a refusal blocks nothing behind it
(NEW-116). Across runs, `state/ingest-attempts.json` counts, per accepted capture, the runs that
selected it and saw it refused. `selectCaptures` orders the accepted set by that count, fewest
first, then by `captureId`, and only then applies `--limit`. A capture that keeps refusing
therefore moves behind every untried one, and comes back to the head once nothing untried is left;
with no refusal on record the order is `captureId`, as before.

- **What it holds.** `{"attempts":{"<captureId>":n},"schemaVersion":1}` in canonical JSON: ids
  and counts, never a path, message or model output. An ingested capture leaves the record, and
  so does an id no longer accepted, so it is bounded by the quarantine. Zero bytes is the empty
  record.
- **Where it lives.** Fresh `init` reserves it as an empty regular-file `ephemeral` artifact, like
  `state/update-executor.json` (`runtimeReservationPaths` in `apps/cli/src/bootstrap/executor.ts`).
  It is not in admission's required set (`LIFECYCLE_RESERVATION_ROWS`), so an installation made
  before it is still admitted; ingest there finds no file, **never creates one** (an unmanifested
  file under `state/` would block uninstall's empty-directory removal), and keeps `captureId`
  order. **The attempt order therefore reaches only a home `init`ed after this change.** An older
  installation keeps `captureId` order until it is reinstalled; `update` does not add the file, so
  the fix is not delivered there.
- **What `--json` shows.** `data.order` is the attempt order this run used; `data.captures` stays
  sorted by `captureId`.
- **Its size.** The encoded record is capped at `MAX_INGEST_ATTEMPTS_BYTES` (1 MiB); past it, the
  captures with the most refusals are kept and the rest sort as untried.
- **How it is written.** Once per run, after the capture loop, as one `ingest-attempts`
  transaction bound to the bytes read before selection, and only when they change. A concurrent
  run's record is refused rather than overwritten. An unreadable record, or a write that fails,
  prints a `warning:` line on stderr and changes neither the run's outcome nor its exit code: the
  order is advisory.

---

## 6. The status ladder, and why a refusal never produces `failed`

`CAPTURE_STATUSES` is frozen, in order, and gains no seventh member
(`packages/brain/src/schema/capture.ts:24-31`):

```text
quarantined → accepted → staging → ingested
            ↘ rejected
     failed  (the envelope itself is unreadable — nothing else)
```

**`failed` describes a capture whose own envelope cannot be read, and nothing else.** It has exactly
two producers: `selectCaptures`, when `parseCaptureFile` refuses a file
(`apps/cli/src/commands/ingest.ts:655-661`), and the duplicate path in `capture`
(`apps/cli/src/commands/quarantine.ts:176-182`). **A validator refusal leaves the capture `accepted` and
retryable**, and a review refusal writes nothing at all (`decide.ts:125-127`).

Collapsing the two would make a transient model failure look like data loss: the capture is fine and
the proposal was not. That distinction is what `ingest`'s four recovery strings are for — `untouched`,
`staging` with notes, `staging` without them, and `ingested`-under-a-failure-exit — assembled from the
states a run actually left rather than printed in full every time (`refusedRecovery` in `ingest.ts`).
Two more lines key on a refusal's `reason` rather than its state: `note_changed_since_capture`
(`brain.md` §6.13) and `vault_changed_during_ingest` (§5.1), which replaces the `staging`-without-notes
line for a capture the user edited during the call.

**Evidence:** `apps/cli/src/commands/ingest.test.ts:441` (the ladder itself), `:466` (rollback to
`accepted`, never to `failed`), `:560` and `:597` (no rollback once notes landed), `:903` (the status
is read from disk rather than inferred), and every case in `tests/security/interruption.test.ts`,
whose `expectedStatus` is derived per transaction kind and phase rather than assumed uniform.

---

## 7. The nine validators, and where each is enforced

`VALIDATOR_IDS` is frozen at nine (`packages/brain/src/ingest/validate.ts:33-43`) and typed as a union
rather than as `string`, so a typo — `write-scopes` for `write-scope` — cannot compile, never fire, and
still pass the exhaustiveness test because the typo went into the expectation too.

| Validator | Enforced at | What it refuses |
|---|---|---|
| `schema-and-frontmatter` | `packages/brain/src/ingest/validate.ts:339` | a note the canonical schema does not accept |
| `source-and-provenance` | `:402` | a note whose `sourceCaptureId` is not the capture being ingested |
| `link-and-graph` | `:989` | links the lint build grades as broken |
| `duplicate-detection` | `:1011` | a proposal colliding with a note already in the vault |
| `confidence-and-lifecycle` | `:446` | `established` without a `reviewed` date, `deprecated` without `updated` |
| `secret-scan` | `:505` | a secret the model handed back |
| `deterministic-reindex` | `:1024` | a proposal whose projection does not rebuild deterministically |
| `generated-output-consistency` | `:760` | a write into the generated indexes directory |
| `write-scope` | `:619` | a path outside the declared, resolved write scopes, or whose first segment is not a configured topic folder or an alias resolving to one (`content/DEV/x.md` is refused) |

`validateProposal` (`:892`) runs them, is total and side-effect-free, and a finding names the class and
the file **never the value** (`:67-72`) — the report is written and logged, and the proposal is model
output that has just read material an attacker may have written.

**Two of the nine refuse at exit 5 rather than exit 1**: `secret-scan` and `write-scope`
(`ingest.ts:282-291`). The shipped contract names exit 5 for write-scope; extending it to the secret scan is this
subsystem's reading and is stated rather than buried — a secret coming back from a model and a path
trying to leave the vault are the same kind of event, and different in kind from a model that got a
frontmatter key wrong.

**`confidence-and-lifecycle`'s rule is defensible but invented.** The spec names the validator and
says "required frontmatter for the note's declared stage is absent" without saying which frontmatter.
The registered narrowing, ratified as shipped, and its cost of reversal are §8 of
`git show d72287a^:docs/superpowers/BACKLOG.md`.

For a replacing note capture, `duplicate-detection` ignores the destination itself and
`source-and-provenance` also requires the replaced note's `created` (`brain.md` §6.13).

---

## 8. Two configuration decisions a later reader will trip over

### 8.1 The redaction key

`CaptureEnvelopeV1.redaction[].fingerprint` is persisted in every capture, and the HMAC key used to be
generated with `randomBytes()` **per process**. Left alone, the same secret would fingerprint
differently on every invocation: the field would populate, look correct, and mean nothing.

**The key is durable, and the load has two doors, not one:**

- `readRedactionKey` (`apps/cli/src/context.ts:680`) is the **composition root's** door. It never
  creates, never throws and never repairs, returning `null` for absent, unreadable, symlinked,
  wrong-typed or too-short — every state `doctor` must be able to *report*, which it cannot do if
  building the context already threw. The root warns and falls back to an ephemeral key
  (`:743-745`), so diagnostics are still redacted on a machine that has never been initialized.
- `loadOrCreateRedactionKey` (`:659`) is the **point-of-use** door, called by `init` (`init.ts:350`,
  `:975`, `:1026`, `:1061`) and by `capture`, `review` and `ingest` at their own points of use, and
  by `import` except under `--dry-run`. `import --dry-run`, `project init` and `project check` never
  create it: they read it with `readRedactionKey` and fall back to an ephemeral key. It creates
  when absent,
  refuses a symlink or a non-regular file, and tightens an over-permissive mode. Both doors open with
  `O_NOFOLLOW | O_NONBLOCK`: without the second, a FIFO planted at that path blocks the CLI forever,
  because the file-type guard is downstream of the open.

Both are **synchronous**, and that is forced: `main.ts` builds the context before dispatch and
`CliGuards.redactDiagnostic` is a synchronous `(text: string) => string`.

**The key is deliberately not a managed artifact.** It is absent from `installation-manifest.json`, so
it is never hashed into a drift report and never printed by a diagnostic that enumerates manifest
contents. Losing it makes old fingerprints incomparable; it never makes a capture unreadable, because
nothing is encrypted with it.

**And that produces one deliberate exception to a gate this subsystem does not own.** `BACKLOG.md`
§7's DOS-P7 gate reads "uninstall removes only manifest-owned artifacts", and `uninstall` removes the
key (`apps/cli/src/commands/uninstall.ts:536-544`) — by the exact path `redactionKeyPath` computes,
never by pattern and never by walking the state directory, so the exception cannot widen. It runs
**before** `revertArtifacts` (`:931`), so the state directory can be removed when it is otherwise
empty. An absent manifest no longer returns early past it: that branch hands off to
`runAbsentManifestUninstall`, which deletes an orphaned key on its own guarded path
(`deleteOrphanedKey`, `apps/cli/src/lifecycle/absent-manifest-uninstall.ts:176-179`), so an install
that failed and reverted still leaves no secret nothing would ever clean up. **Leaving a secret behind
after the product is gone is worse than losing fingerprint comparability.** DOS-P7 inherits this as a
known exception rather than reading its own gate as violated; the row is §8 of
`git show d72287a^:docs/superpowers/BACKLOG.md`.

`doctor` reports presence, type and mode with `lstat` and never a byte of the contents, warns for each
of the four unusable states by name, and repairs nothing (`apps/cli/src/commands/doctor.ts:1156,1158-1188`).

### 8.2 Scope globs resolve at the handler boundary, and the contract keeps canonical names

`EFFECT_VOCABULARY` had `content/` and `_indexes` hardcoded, and this is the first subsystem that
resolves one against a real filesystem. Templating the globs inside the YAML contract was rejected: it
invents a substitution syntax in the workflow schema, needs a validator for it, and puts a
configuration value inside a document whose whole purpose is to be comparable across installs.

**Taken instead:** the contract keeps canonical vault-relative names, and `resolveScopeGlob`
(`packages/workflow-schema/src/vocabulary.ts:297-311`) rewrites the leading `content` segment to
`config.contentRoot` and an immediately-following `_indexes` segment to `config.indexesDir`. Both
substitutions are **pinned to a position** — `content` at index 0 only, `_indexes` at index 1 only and
only when index 0 was `content` — so a vault folder literally named `content` nested under `staging/`
cannot be corrupted, and every root is glob-escaped and NFC-normalized before it is spliced in.
`ingest` resolves its declared scopes through it once per invocation (`ingest.ts:2330-2331`), against
`INGEST_DECLARED_WRITE_SCOPES` (`:215-218`), which `ingest.test.ts` pins against
`workflows/ingest/workflow.yaml` so a contract edit that does not update the constant goes red. The
compiler's declared-versus-derived arithmetic is untouched, so the equality rule stays the checked
arithmetic it was designed to be.

**The display gap this leaves, stated more precisely than the decision that took it.** A user whose
`contentRoot` is not `content` has a checked-in contract that names `content/**` and
`content/_indexes/**` (`workflows/ingest/workflow.yaml:15-21`) while the handler enforces their own
root. It is a gap in a document about the *shape* of a workflow, not in enforcement — the enforcement
is the `write-scope` validator, which resolves. **The rendered skill is not affected**, and the
decision's own wording implied it was: `plugins/*/skills/developer-os-ingest/SKILL.md` prints no globs
at all, only "the scopes this workflow declares".

---

## 9. What the independent security review caught

**Run 2026-08-14/15**, by an agent that authored no task in the plan, against the file list of
Tasks 1–18 — **one Critical, two Important and five Minor.** Every accepted finding was fixed with a
regression test watched fail first, across four fix rounds and four independent verdicts (`455ae1d`,
`2ae7de0`, `1886d5f`, `b49d33a`, `7ae7d15`, `d6bb382`, `4d693bf`). The final verdict is ready for the
checkpoint.

**It is recorded here because it is the strongest argument in this repository for the gate that
produced it.** Both of the findings below survived the task's own tests, its per-task fresh-context
review, eight security suites and a green CI.

**The Critical was two mistakes that composed into an escalation.**

The first: `writeScope` subtracted the private folders from the path the model **wrote** while its
neighbour checked containment on the path that string **resolves to**. Two routes exploited the
difference — a case-insensitive volume, on which `_RAW/quarantine/x.md` canonicalizes into the real
`_raw/quarantine`, and a symlink inside the vault whose destination is a private folder. Either one
puts a model-written note into `content/_raw/quarantine/`.

The second: that directory is where the next `ingest` looks for captures. `parseNote` grades an
unknown frontmatter key at `info` (`packages/brain/src/schema/note.ts:362-371`) and `parseCaptureFile`
never recomputes the id, so **one document can satisfy both the note parser and the capture parser** —
and the model's own output re-enters the pipeline as an `accepted` capture, with the human review step
skipped.

The fix gives the destination the canonical twin `generatedOutputConsistency` already had:
`privateRootsCanonical` is measured with `containsPathLoosely` because this branch **denies** rather
than grants, and the destination's own segments are folded and checked too, because neither subsumes
the other (`packages/brain/src/ingest/validate.ts:714-767`, with the reasoning at `:584-598`).
Evidence: `packages/brain/src/ingest/validate.test.ts:872` — "refuses a path whose case differs from the private folder it
resolves into" — and `:882`, the in-vault symlink.

**Its twin closed `BACKLOG.md` §1 NEW-14.** `resolveCapturePath` compared the canonical quarantine
root and the canonical target **against each other, never against the content root**, so a quarantine
directory replaced by a symlink carried its own containment check with it. `capture` — the command
that *writes* the observation — had no such check at all. All three commands now prove the quarantine
root inside the configured content root once per run through one shared implementation
(`apps/cli/src/context.ts:348-361`), each injecting its own refusal so the exit code and recovery text
stay its own. The security suite's parked `it.fails` has been an ordinary passing case since
2026-08-15, and it went red the day the guard changed, exactly as the parking intended.

**Three more accepted findings, in one line each — and the first of them is only half closed.**
`agent.prompt`'s argument screen refused any capture containing `permission`, `danger` or `bypass` on
both vendors forever, under advice to run `ingest` again — reachable and severe only once Task 13 gave
that function a production caller. **Both halves are now fixed and NEW-12 is closed** (§10.1 below):
the prompt goes through `screenProseArgument` since 2026-08-15, and since 2026-08-17 `workingRoot` and
`outputSchemaPath` go through `screenDerivedPathArgument`, because this product assembles them rather
than receiving them — so a vault whose path contains one of those words ingests. An apply that wrote
and then failed to verify rolled the capture back to `accepted` with its notes on disk, which the next
run refuses permanently. And interruption coverage reached two of five transaction kinds; it now
reaches all five.

**Two findings were registered rather than fixed** — `BACKLOG.md` §1 **NEW-19** and **NEW-20**, both in §10 below. **Both have since closed** (NEW-19 on 2026-08-15, NEW-20 on 2026-09-28).
in §10 below with their owners.

---

## 10. The residuals this subsystem leaves, each with an owner

### 10.1 Registered in `BACKLOG.md` §1

| | Owner | Shape |
|---|---|---|
| **NEW-21** — one successful `codex exec` completion is still owed | the founder, because it spends their credits | **closed 2026-08-20**, S. The usage limit reset and five invocations were made with the production argv, all four recordings committed. It closed by falsifying two shipped things: the terminal-event rule — a successful turn ends on a `turn.completed` usage record, so `finalJsonlLine` returned telemetry as an `ok: true` payload and is replaced by `finalAgentMessage` — and the shipped output schema, refused with HTTP 400 for a `schemaVersion` carrying no `type` keyword, which means **`ingest` could never have run on this vendor**. It also observed the Codex detection row, `CODEX_THREAD_ID` on presence. **Residual: only `codex exec` has ever been observed, on either vendor**; the interactive TUI has not, and that bears on the detection rows and on the parsing rule alike |
| **NEW-36** — a redacted payload's paths are renormalized and its keys rewritten | **closed 2026-09-28** for paths and key names | M. `createRedactor`'s redactor takes a `RedactionScope` per call (`text`, `value`, `path`, `name`); every scope but `text` returns the caller's bytes when nothing matched, so a clean NFD path in `data` stays NFD. `redactPayload` redacts a key in the `name` scope, which drops `user-pattern` and keeps every provider, credential and `high-entropy` class, so `patterns = ["captureId"]` no longer rewrites the schema. **Residual:** a product-owned *enum value* (`leftAt`, `reason`, `agent`) is a string leaf the walk cannot tell from caller text, so a pattern equal to one still redacts it; closing that needs a schema-aware walk. No payload today has data-derived keys, so every key is treated as product-owned |
| **NEW-37** — a numeric leaf of that payload is outside the redactor's reach | **closed 2026-09-28** by contract | S. A `number` leaf is published as the number it is, always: the JSON type must not depend on `[redaction] patterns`, and no built-in class can match a finite number's decimal text. A caller-derived identifier goes into a payload as a string, where every class applies |
| **NEW-20** — `capture` proves its quarantine root, then follows the declared path again | **closed 2026-09-28** | XS, security. `capture` reads and writes through the canonical quarantine `resolveQuarantine` now returns, and keeps the declared path for `CaptureResultV1.path` and `validateChangePlan`'s owned root, so a retarget after the proof is refused at exit 5. `import` still re-follows its declared quarantine. `threat-model.md` §5.2 describes it |
| **NEW-19** — `reindex` builds its owned root textually, as `capture` used to | **closed 2026-08-15** by Track R entry R1 | XS, security. `reindex` calls `resolveContainedRoot` (`apps/cli/src/commands/reindex.ts:429`) rather than joining the path textually, so a `content/_indexes` replaced by a link out of the vault is refused instead of written through. Regression tests: `tests/security/symlink-escape.test.ts:369,410` |
| **NEW-15** — nothing that executes a discovered binary pays the check its own type demands | **closed 2026-08-17** by Track R entry R2 | S, security. `assertTrustedExecutable` canonicalizes, refuses a non-regular-file target, and walks three ancestor chains refusing an owner that is neither the current uid nor root, any other-writable directory, and a group-writable one the current uid does not own. All three executors call it — `apps/cli/src/commands/capture.ts:263`, `apps/cli/src/commands/doctor.ts:439`, `apps/cli/src/commands/ingest.ts:544`. **Three residuals stay open**: NEW-32 (a middle symlink hop, a working bypass), ACL blindness, and NEW-35 (check-then-use); NEW-33 is a false refusal awaiting the founder |
| **NEW-16** — user-configured redaction patterns are unreachable | **closed 2026-08-17** by Track R entry R2 | S. `configSchema` carries an optional `[redaction]` table (`packages/core/src/config/loader.ts:208`) and the three redacting commands bind the user's patterns through `createRedactor` at their composition roots. `tests/repository/redactor-entry.test.ts` refuses a new call site that reaches for `redactText` directly. Residuals NEW-25 and NEW-26 are fixed, and NEW-24 closed 2026-09-28 under D73: a `user-pattern` finding persists its row index and an over-broad row is flagged by match density (`threat-model.md` §5.7) |
| **NEW-17** — `brain` is the one command whose config parse failure is not content-free | **closed**, removed from `BACKLOG.md` §1 | XS, security. `readConfig` now routes through `readConfigFile` (`apps/cli/src/commands/brain.ts:117`) and rethrows `ConfigurationError` unmodified, so no command parses configuration outside the wrapper |
| **NEW-18** — `assertSafeCommand`'s four NUL branches have no test anywhere | **closed 2026-08-15** by Track R entry R1 | XS. One case per `containsNul` site — executable, working directory, any argument, stdin (`packages/security/src/process.test.ts:101,111,119,127`) |
| **NEW-12** — the argv screen's word list also screens a value nobody chose | **closed 2026-08-17** by Track R entry R2 | XS, security-adjacent. Closed in two halves and **not** by narrowing the pattern, which the row forbade: the prose half on 2026-08-15 (`screenProseArgument` for the prompt), the path half on 2026-08-17 (`screenDerivedPathArgument` for `workingRoot` and `outputSchemaPath`, which this product assembles). The word list is byte-identical and each of its three alternatives is now guarded by a sample that isolates it. **Two residuals:** `ingest` can no longer produce a screening refusal at all, so `invokeVendor`'s refusal-detail interpolation is unreachable in production and uncovered end-to-end; and the first caller to pass a real write scope will hand a derived path to the screen that still carries the word list, re-creating the defect one field over |
| **NEW-11** — the invisible-title rule stops at `title` | **closed 2026-08-17** by Track R entry R2 | S. `tags` and `summary` now carry NEW-10's predicate as a **lint warning** — the note still indexes — and `duplicates` keys on a perceptual grouping key rather than on that boolean. `isBlank` moved to `packages/security/src/text.ts` rather than being copied. **Two residual rows, plus accepted consequences** — **NEW-30 closed 2026-08-21**, leaving one: NEW-30 (`aliases` was the fourth field with the same gap; the rule now lives beside the other two in `lint.ts`) and NEW-31 (a stray U+200D still hides a duplicate, because the joiner is deliberately exempt; closed 2026-09-28 under D73 as a `frontmatter` warning on the title). The accepted consequences — an emoji grouping with its text presentation, and two others — are enumerated in `text.ts` rather than carried as rows |
| **NEW-13** — two artifact roots share one type | DOS-P6 Task 4's nominal brands | **closed 2026-08-21.** The brands shipped with Task 4 and the `@ts-expect-error` case pins them (`packages/adapter-codex/src/install.test.ts:193`); the row went on reading `Status: open` for nine days, and this note recorded the discrepancy rather than letting it pass. Task 19 Step 5 closed it. If a row and the tree ever disagree again, the tree is the answer |

### 10.2 The four Foundation changes that survived DOS-P6

**No DOS-P6 task extends `packages/core/src/transactions/` or `packages/core/src/result.ts`**, which
is where every one of these lands. Two tasks did reach `packages/core` — Task 3 owns
`packages/core/src/capabilities/index.ts` and Task 4 owns `packages/core/src/agent-prompt/index.ts`,
both in the plan's own file-structure table — so the reason none of these was done here is that they
are executor and result-type changes nobody's file list named, not that the package was untouchable.
Their implementations and this architecture note are the surviving record; `ORDER.md` now contains
unfinished work only. **All four are closed**: Track R entry R2 built them between 2026-08-17 and
2026-08-20, and each item below records what it closed rather than what is still owed.

1. **and 2. An optional caller-supplied precondition on `PlannedFileMutation` — closed 2026-08-20**
   (`packages/core/src/transactions/types.ts:83`, enforced at
   `packages/core/src/transactions/executor.ts:1609-1614`). `review --decision edit` now hands the
   executor the digest of the bytes it read; `capture` still supplies none. Before it, the executor computed
   `expectedBeforeHash` from the snapshot it took when `execute()` ran, so a command could not
   supply one. That cost `capture` the `O_EXCL` create spec §5.2 describes — tolerable there, since
   the id is the content hash and colliding captures are byte-identical — and it cost
   `review --decision edit` a read-to-execute window in which **the discarded content was the user's
   own hand edit**. **Counted as two of the four and raised as one
   pair**, because a session that fixes one and not the other has fixed neither.
3. **Prune the transaction backup — closed 2026-08-17.**
   `review --decision edit` removes a secret from a vault file and `TransactionExecutor.backUp` wrote
   the pre-edit file raw to `~/.developer-os/backups/transactions/<id>/0.bin`, where nothing removed
   it: the user was told the secret was gone and a copy survived. `pruneBackups` now unlinks every
   payload — `<index>.bin` and the `<index>.bin.tmp` `writeDurableFile` renames from — at both
   terminal transitions and both terminal early-returns, so a crash between a transition and its
   prune is swept by the next `repair`. `tests/security/sentinel.test.ts` sweeps that directory as
   its own artifact rather than routing around it, and `doctor`'s `transactions` check reports a
   payload that outlived its transaction.
4. **A `data` slot on `CliError`, or a partial-success arm on `CliResult` — closed 2026-08-20 as
   `CliError.data?: RedactedPayload`, minted only by `redactPayload`**
   (`packages/core/src/result.ts:579-632`). Before it, `ingest` processed a batch and
   contained each capture's refusal to that capture; when any refused, the run ended on the failure
   arm and the per-capture outcomes shipped as lines inside the error message — the precedent
   `brain lint` had set under the identical constraint — so a consumer parsed prose where it should
   have read fields. The slot is additive: absent when unset, so no earlier `--json` document changed.

**One repository item sits beside these and is not one of them, because its measured fix is already
applied.** `apps/cli/src/commands/doctor.test.ts:208` needed 3.19 s of a 20 s budget on an idle machine
and reddened in five of six full runs once the security suites joined it; `fileParallelism: false`
(`tests/vitest.config.ts:50`) made four of four runs green and dropped total test time from roughly
1000 s to 700 s. **What stays open is the fragility, not a change**: a case one contended run from red
is a gate one contended run from uninformative, and it is unowned. The `ENOTEMPTY` seen during fixture
cleanup in two of those runs is a separate filesystem race that serialization may only have made
rarer; it is unmeasured and possibly still live.

### 10.3 One product gap, and the obligation Task 17 leaves

**Closed 2026-08-20 by Track R entry R2 Task 9.** `applyReviewDecision` permitted a decision only
from `quarantined`, so nothing moved a capture from `accepted` to `rejected`: a user who accepted a
capture and changed their mind — or whose capture refused ingest deterministically — had only a hand
edit of the frontmatter, which is what both of `ingest`'s recovery strings told them to do. The
decision was the founder's on 2026-08-17, this note's §6 carries the amended table, and the table is now
`LEGAL_FROM` (`packages/brain/src/review/decide.ts:81-86`). Both recovery strings name the verb.

**What is still open is finding the capture.** `review`'s own listing shows `quarantined` only, so a
user who accepted and changed their mind can reach the new transition only if they already hold the
id — which the ingest-failure path prints beside the capture and the change-of-mind path does not.

**Task 17 — one real run per vendor — ran on 2026-08-15, and settled about half of what it owed.**
The founder authorised the spend. Claude answered; **Codex's account had exhausted its usage limit**,
so every `codex exec` ended `turn.failed` and no run reached a model response. What that run did and
did not settle:

| Obligation | State |
|---|---|
| `--json` really is JSONL, one JSON object per line | **confirmed**, four lines, none scalar or `null` |
| whether the stream carries a discriminating field worth filtering on | **confirmed: `type`**, on every line. Observed vocabulary `thread.started`, `turn.started`, `error`, `turn.failed` — *not* the `session.created` / `item.completed` / `turn.completed` the synthetic tests had guessed |
| whether a **successful** turn's terminal event is the final response | **answered 2026-08-20 by NEW-21: no.** A successful turn ends on a `turn.completed` usage record and the response is the `item.completed` before it, so `finalJsonlLine` was wrong rather than provisional and was replaced by `finalAgentMessage` |
| the Codex `AGENT_DETECTION_ROWS` row | **observed 2026-08-20**, `CODEX_THREAD_ID` on presence |
| the Claude `AGENT_DETECTION_ROWS` row | **observed**, `CLAUDECODE=1` |
| whether the vocabulary reading of 2026-08-15 held | **corrected 2026-08-20.** `item.completed` and `turn.completed` are real; only `session.created` is not. A failed turn was never a stream the other two could appear in |

Two findings the run produced that nobody had asked it for, both now pinned:

- **`codex exec` reads stdin when stdin is not a TTY**, printing `Reading additional input from
  stdin...` and blocking. The production call returns **with a result** — rather than after its
  timeout, which would still fire — only because `NodeProcessRunner` closes the pipe with
  `child.stdin.end(request.stdin)`. Undocumented by the vendor; the first attempt at the observation
  hung on it.
- **The failure path's terminal event is shaped like a result.** The last parsing line of the observed
  stream is `turn.failed`, so `finalJsonlLine` alone would hand a caller a vendor error as a payload.
  The `exitCode !== 0` check that runs before it is what prevents that. **The ordering was already
  guarded** by a synthetic non-zero-exit case; what this run adds is the first demonstration of the
  payload it keeps out.

The recording is `tests/fixtures/codex/observed-exec-stream.jsonl`, with `README.md` beside it stating
what was redacted. **NEW-21 closed on 2026-08-20** when the usage limit reset and five invocations were
made — the schema refusal, one per sandbox branch, and one testing `--output-last-message`. It closed by falsifying two shipped
things rather than by confirming one: the terminal-event rule, above, and the shipped output schema,
which the vendor refused with HTTP 400 before any turn began because `schemaVersion` carried no `type`
keyword. **`ingest` could never have returned a proposal on Codex**, and every gate was green over it,
because nothing in the repository had ever handed that file to the binary. The recordings are
`observed-exec-success-stream.jsonl` and `observed-exec-schema-refusal.jsonl`. Separately and untouched by this run: the Claude scoped-permission form
`claude-adapter.md` §14.3 names but does not specify is still unresolved; `ingest` has since
side-stepped it by passing no tools at all (`--tools ""`, `apps/cli/src/commands/ingest.ts:1032-1035`).

**Task 17's diff received its own security pass before `5c56892`.** The independent review that
covered Tasks 1–18 was therefore not used to waive review of its adapter stdout parsing and capture
detection changes.

### 10.4 Six carried-forward design residuals

**All six are stated here with their disposition.** This is the surviving record of what the
completed design left open.

| Residual | Disposition |
|---|---|
| 1. `buildConflictEvidence` still has no consumer | **closed by A12 (Amended 2026-09-26 (A12 §11, D47)).** The instruction attach and detach (`apps/cli/src/instructions/attach.ts`, `detach.ts`) call its block arm for a drifted instruction block: three hashes and a redacted two-way diff (`claude-adapter.md` §9.8, `codex-adapter.md` §11.9) |
| 2. the Codex supported floor is one observed version, not a range | **open.** Owner: DOS-P9 |
| 3. a re-rendered plugin tree may not be a re-loaded one — Codex resolves skills through a cache copy | **open.** Owner: DOS-P7, whose update lifecycle re-renders in place |
| 4. `NEW-11` and `NEW-12` are repository defects rather than pipeline ones, and are not taken here | **both left this subsystem and were decided elsewhere, which is what this row predicted.** `NEW-12` is **closed** — its prose half by Task 19's review on 2026-08-15, its path half by Track R entry R2 on 2026-08-17, and §10.1 carries the two residuals it left. `NEW-11` was decided by the founder on 2026-08-17 (an invisible tag is a lint warning) and is implemented by that same entry |
| 5. line-wrap drift wants a repository formatting decision, not a hand pass | **open and unowned.** No decision was taken here, and nothing in this subsystem's scope could take one — it is a repository-wide formatting question, and this is the only place it is written down outside the closed design |
| 6. automatic capture is not designed, only declined | **decided, not deferred**, and §2 above is the substance. If a future version wants it, the honest route is a documented, stable transcript contract with a regression fixture landing in the same change — the condition both adapter specs already set for lifting the refusal. Nothing in this subsystem weakened it |

---

## 11. What the evidence is worth

`tests/security/` holds **eleven suites**; at the 2026-08-17 collection it held nine suites and 90
cases, and **38 carried no watched-failure demonstration.** The split, its derivation, and the fact that the per-suite breakdown cannot be
re-derived from this repository are `docs/architecture/threat-model.md` §8 and `BACKLOG.md` §5. Do not
cite the directory as a whole as though every case in it were evidence; the threat model marks the
cases it relies on that are not.

**The checkpoint's five criteria, verified against the tree on 2026-08-15**, are the table under
Task 6's **Test** heading in `docs/superpowers/plans/2026-07-21-developer-os-program.md`, each with the
suite that was opened. One is weaker than its claim and says so there.

---

## 12. Where the rest lives

| For | Read |
|---|---|
| trust boundaries, what is untrusted, and the mechanism enforcing each | `docs/architecture/threat-model.md` |
| the three boundaries that do **not** hold, first thing | `threat-model.md` §1 |
| the vault, its two invariants, and the discovery rules a proposal is judged against | `docs/architecture/brain.md` |
| note captures (`capture --note`), verbatim ingest, `brain retire`/`brain refactor`: A12b's decisions and residuals | `brain.md` §6.13 |
| the workflow contract, `extends`, and the declared-versus-derived scope arithmetic | `docs/architecture/workflow-schema.md` |
| the capability model — two gates, three values, recorded twice on purpose | `claude-adapter.md` §3, `codex-adapter.md` §3 |
| per-vendor residuals with owners | `codex-adapter.md` §11, `claude-adapter.md` §9 |
| transactions, ownership, exit codes, and what Foundation deliberately cannot do | `docs/architecture/foundation.md`, `foundation-constraints.md` |

---

## 13. Complete former-section map for legacy source comments

The completed knowledge-pipeline design was deleted at closure. Its section numbers remain in source
comments written before 2026-08-24, so a bare `spec §…` or `design spec §…` **about the knowledge
lifecycle** resolves through this complete table, never to a deleted document. Route ambiguous
numbers by subject: **§8** is the surviving umbrella design only for the CLI contract or
mutating-command flags; retired §8/§8.1–§8.5 security seams or redaction resolve here. **§12** is
the surviving umbrella design only for Brain ordinary-Markdown compatibility; retired §12 amendments
resolve here. A bare lifecycle **§10** is the retired verified-surfaces section and resolves through
this map; only explicit product spec **§10** resolves to the surviving umbrella design. **§§13.1–13.5,
14.1–14.6, and 17.5**, and explicit product spec **§11**, resolve to
`docs/superpowers/specs/2026-07-21-developer-os-design.md`. All other knowledge-lifecycle references
matching a former section below resolve through this note.

| Former section | Surviving owner |
|---|---|
| §1 | this note §1 |
| §2 | this note §2; §5 for the no-write model boundary |
| §2.1 | this note §2; `docs/architecture/claude-adapter.md` §5; `docs/architecture/codex-adapter.md` §5 |
| §2.2 | this note §2; `docs/architecture/claude-adapter.md` §9; `docs/architecture/codex-adapter.md` §11 |
| §2.3 | this note §2 |
| §2.4 | this note §5; `docs/architecture/threat-model.md` §5.3 |
| §2.5 | this note §4 |
| §2.6 | this note §2 |
| §2.7 | `docs/architecture/threat-model.md` §7 |
| §2.8 | `docs/architecture/brain.md` §2 |
| §3 | this note §§2, 5, 8.1; `docs/architecture/claude-adapter.md` §3; `docs/architecture/codex-adapter.md` §3 |
| §3.1 | this note §2 |
| §3.2 | this note §2; `claude-adapter.md` §3; `codex-adapter.md` §3 |
| §3.3 | this note §5; `threat-model.md` §§5.3–5.5 |
| §3.4 | this note §§3–4; `foundation.md` §4 |
| §3.5 | this note §8.1; `threat-model.md` §5.8 |
| §4 | this note §1; `workflow-schema.md` §§5, 7 |
| §5 | this note §§3–4, 6 |
| §5.1 | this note §3 |
| §5.2 | this note §3; `foundation.md` §3 |
| §5.3 | this note §§3–4 |
| §5.4 | this note §§2, 10.3 |
| §5.5 | this note §6 |
| §5.6 | this note §4 |
| §6 | ingest — this note §§5, 7; `docs/architecture/threat-model.md` §§5.3–5.4 |
| §6.1 | this note §5 |
| §6.2 | this note §5; `threat-model.md` §5.3 |
| §6.3 | this note §7 |
| §6.4 | this note §7; `threat-model.md` §5.4 |
| §6.5 | this note §5; `brain.md` §6.3 |
| §6.6 | this note §1's structured-result-schemas row; `codex-adapter.md` §11 |
| §7 | this note §§8.2, 10; `docs/architecture/workflow-schema.md` §§7–8; `docs/architecture/claude-adapter.md` §3; `docs/architecture/codex-adapter.md` §3 |
| §7.1 | this note §8.2; `workflow-schema.md` §8.1 |
| §7.2 | `claude-adapter.md` §3; `codex-adapter.md` §3; this note §2 |
| §7.3 | `workflow-schema.md` §7 |
| §7.4 | this note §10.1; `claude-adapter.md` §9; `codex-adapter.md` §11 |
| §7.5 | this note §10; `BACKLOG.md` §1 |
| §8 | see the subject-routing rule above; lifecycle security/redaction is owned by former §§8.1–8.5 and `docs/architecture/threat-model.md` §§5.3, 5.7–5.8 |
| §8.1 | `threat-model.md` §5.7 |
| §8.2 | `threat-model.md` §5.7 (NEW-16, closed 2026-08-17) |
| §8.3 | `threat-model.md` §5.3 |
| §8.4 | this note §8.1; `threat-model.md` §5.8 |
| §8.5 | `threat-model.md` §§1–9 |
| §9 | testing/evidence — this note §§9, 11; `docs/architecture/threat-model.md` §8; `docs/superpowers/plans/2026-07-21-developer-os-program.md` Task 6 |
| §9.1 | `threat-model.md` §§5.7, 8; this note §11 |
| §9.2 | `threat-model.md` §§5.3–5.4, 8; this note §11 |
| §9.3 | `threat-model.md` §§5.4, 8; this note §11 |
| §9.4 | `threat-model.md` §§5.5, 8; this note §11 |
| §9.5 | `threat-model.md` §§5.10, 8; this note §11 |
| §9.6 | `threat-model.md` §§5.9, 8; this note §11 |
| §9.7 | this note §§1, 11; `docs/superpowers/plans/2026-07-21-developer-os-program.md` Task 6 |
| §9.8 | this note §9; `threat-model.md` §8 |
| §10 | verified vendor surfaces — this note §§10.3, 11; `docs/architecture/claude-adapter.md` §11; `docs/architecture/codex-adapter.md` §7 |
| §10.1 | `docs/architecture/claude-adapter.md` §11; `docs/architecture/codex-adapter.md` §7; this note §11; `docs/superpowers/plans/2026-07-21-developer-os-program.md` Task 6 |
| §10.2 | this note §10.3; `codex-adapter.md` §7 |
| §10.3 | this note §§2, 10.3 |
| §11 | this note §§1–8 for the capture/review/ingest interfaces, commands, handlers, redaction and persistent key; `docs/architecture/codex-adapter.md` §§7, 11 for schemas and invocation; `docs/architecture/claude-adapter.md` §§8, 11 for rendered handler commands and invocation; `docs/architecture/threat-model.md` for the interface boundaries |
| §12 | this note §§2, 4–8; §8 of `git show d72287a^:docs/superpowers/BACKLOG.md` |
| §13 | this note §10.4; `BACKLOG.md` §§1–3 |
