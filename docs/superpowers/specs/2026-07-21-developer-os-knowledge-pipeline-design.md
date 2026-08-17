# Developer OS — Knowledge Pipeline Design

**Status: approved by the founder 2026-08-13**, the day it was written, for `ORDER.md` entry A10,
program plan Task 6, DOS-P6. Its implementation plan is
`plans/2026-07-21-developer-os-knowledge-pipeline.md`, written against this document the same day;
code comes after that plan, which is a Global Constraint of the program plan rather than a
preference. **Approving this document was the founder's and was not delegable** — an agent that
judges its own spec ready has removed the only gate in the program a machine cannot check.

**The plan takes five decisions this document did not, and its tasks raised two more.** Six of those
seven are registered in `BACKLOG.md` §8 and were ratified by the founder on 2026-08-13 — the seventh is
carved out below: **five** canonical workflows change version
rather than the two §12 names, because `review` must also declare the `capture.edit` step §5.6
creates; §7.1's globs resolve at the handler boundary rather than becoming template syntax in the
contract; the program plan's Task 6 hook box — which §12 omits from its amendment list — is
rewritten to record the decline rather than ticked; `uninstall` gets one named exception to
`BACKLOG.md` §7's manifest-only rule, for the key §3.5 keeps out of the manifest; §6.3's
`deterministic reindex` runs over an in-memory projection, because this document's own preamble and
its table disagree about whether anything is staged when it runs; and §9's six suites become eight,
because `BACKLOG.md` §7 requires a network suite this document does not name.

**A sixth thing this document is missing, recorded rather than routed around:** §10.3's requirement
that an unobserved vendor records `"unknown"` means every capture written before the plan's Task 17
carries `sourceAgent: "unknown"`. That is this document's rule rather than an amendment to it, so it
has no §8 row — but it is a cost, and the plan states it where a reader will meet it.

**Design inputs, all inside this repository:** the product design spec §11, §13, §14, §15 and §17;
`docs/architecture/claude-adapter.md` and `docs/architecture/codex-adapter.md`, which between them
name this subsystem as owner of thirteen residuals; `docs/architecture/brain.md`, which froze
`CaptureEnvelopeV1` as a type and wrote none of them; `docs/architecture/workflow-schema.md`, whose
§5 lists six unimplemented verbs as this subsystem's and whose §8.1 makes the scope globs due here;
and `docs/architecture/foundation.md` for the mutation pipeline, the manifest and the transaction
model. Nothing outside this repository was read, per the program's Global Constraints.

**§10 is normative for external surfaces.** Every claim about a vendor CLI's observed behaviour
lives there with the observation that produced it. An implementation may not depend on a surface
§10 does not carry.

**This spec amends six approved documents.** They are listed in §12 and each is registered in
`BACKLOG.md` §8 in the same commit that lands this file. An approved document is not silently
rewritten.

---

## 1. What this subsystem is

The knowledge lifecycle, end to end, as three CLI verbs over one data type:

```text
the agent decides something is worth keeping
  → developer-os capture --text "…"       → quarantine (Markdown + envelope)
  → developer-os review  --decision …     → accepted | rejected | edited
  → developer-os ingest                   → agent proposes → validators → transaction → vault
  → developer-os brain reindex            → retrievable in a later session
```

It is the first subsystem in this program that **executes** a workflow verb. Every subsystem before
it emitted, validated or rendered; none of them ran anything. That is why it inherits so much: an
adapter that renders a skill naming `developer-os capture` cannot make that command exist, and both
adapters shipped saying so.

It closes the half of program Tasks 4 and 5 that neither could close. Three of the six shipped
skills — in both vendor trees — name verbs with no handler anywhere in this product. After this
subsystem, they name commands that run.

## 2. What it does not do, on purpose

1. **It ships no hooks, and this closes that question rather than deferring it again.** See §3.1.
   `hooks/hooks.json` is not emitted by either adapter in v1, and the decision is now **declined**
   rather than owed.
2. **There is no `developer-os run claude|codex` wrapper.** See §3.1. The verb is not built, and the
   capability model stops telling users to use it.
3. **It never opens `transcript_path`.** The refusal stands on both vendors, unchanged, and
   `tests/repository/transcript-path.test.ts` continues to enforce it. This spec does not lift it
   and does not weaken the conditions under which a future spec could.
4. **The model writes nothing.** During ingest proposal generation the agent is invoked with zero
   declared write scopes. Developer OS writes staging itself. See §6.
5. **It deletes no capture, ever.** Not on reject, not on ingest, not on uninstall. Retention is a
   separate manual decision by the user, per design spec §13.3.
6. **It performs no automatic capture.** Nothing fires on session start, session end or compaction.
   A capture happens because an agent or a person ran a command.
7. **It sends nothing to a network.** The only outbound process is the vendor's own agent CLI,
   invoked through `packages/security`'s runner during ingest, which the user asked for.
8. **It does not stem, rank or re-summarise the vault.** Retrieval remains `packages/brain`'s, and
   this subsystem's only change there is §7.3.

## 3. The decisions this spec makes

Each was put to the founder on 2026-08-13 and each is recorded here with what it costs, because a
decision recorded without its cost reads as a free choice to whoever inherits it.

### 3.1 Capture content is agent-authored, and that removes both automatic paths

**The contradiction that forced it.** The canonical `capture` workflow declares two triggers,
`manual` and `session_end`, and takes a required `text` input — the observation itself. A
`session_end` hook cannot supply that text. The only session content a hook receives on either
vendor is `transcript_path`, and this product refuses to open that field on any code path.

So the hook body was never blocked on an executable bit. `docs/architecture/claude-adapter.md` §5
and `docs/architecture/codex-adapter.md` §5 both say restoring hooks needs "the hook bodies, a
mechanism for marking a generated artifact executable, and a test that observes a hook firing." The
middle requirement is **not actually needed** — a `"type": "command"` handler names a command
string, so naming the installed `developer-os` binary ships no script and needs no mode bit. What
hooks lacked was content to capture. That correction is recorded here because both notes state the
blocker as the executable bit, and a later reader would otherwise solve the wrong problem.

**The decision.** Capture content comes from the agent, mid-session, at the point of insight. The
rendered skill instructs it to run `developer-os capture` with its own summary — which is exactly
what the approved contract's required `text` input already describes.

**What it costs, and the founder accepted each item:**

- `session_end` leaves `workflows/capture/workflow.yaml`; `session_start` leaves
  `workflows/shared/workflow.yaml`. Both name triggers nothing can fire, and
  `docs/architecture/workflow-schema.md` §7 already recorded that as a value passing validation
  while the property it names is false — the same shape as the refused `scheduled` trigger.
- No hooks ship, in either vendor tree, in v1.
- `developer-os run claude|codex` is never built.
- **Nothing automatic captures anything.** If the founder does not run the workflow, no knowledge
  is captured. This is the largest product narrowing in the program to date and it is deliberate.

### 3.2 `wrapper-required` is replaced by `not-used`

With no hooks and no wrapper, six of the nine capability keys describe surfaces this product will
never touch, and the word the model used for uncertainty names a command that will not exist.

| Key | Before | After |
|---|---|---|
| `skills` | probe-settled | unchanged, and the only probe-settled key |
| `non_interactive_run`, `structured_result` | `wrapper-required` | `yes` when observed, `unknown` when not — genuinely used, by `agent.prompt` and ingest |
| `plugin_hooks` | `unknown`, via `UNSETTLED` | `not-used` |
| `session_start_injection`, `session_end_capture`, `pre_compact_backup` | `wrapper-required` | `not-used` |
| `subagents`, `durable_project_guidance` | `wrapper-required` | `not-used` |

**`wrapper-required` is removed rather than kept beside the new value, and that is the correction
this section exists to make.** It meant "we are not certain, and the wrapper produces the same
capture anyway." Decision 3.1 deletes the second half, so the word would survive as advice to run a
command that does not exist — a value that validates while the property it names is false, which is
the shape this codebase refuses everywhere else (the `scheduled` trigger, §7.4's `maxTurns`).
Uncertainty degrades to `unknown` instead, which is what it always meant on its own.

`CAPABILITY_STATES` therefore stays at three members: **`yes`, `unknown`, `not-used`**.

The model's founding principle is unchanged: different facts get different words. `unknown` means
"we could not ask" and is never `no`, because only one of those justifies telling a user their
install lacks a feature. "We do not use this surface" is a third distinct fact and earns its own word
for the same reason. `codex-adapter.md` §11.5 anticipated this, assigning DOS-P6 the two keys for
which `wrapper-required` was already the wrong word, "together with whatever third value the model
needs".

**Mechanically it is small.** `CAPABILITY_STATES` in `packages/core/src/capabilities/index.ts`
substitutes one member; each adapter's `UNSETTLED` list is renamed to `NOT_USED`, extended to six
keys, and resolves to `not-used` before the table or the observation is consulted — which is what
`UNSETTLED` already did, with an honest word. The remaining `wrapper-required` branch in each
`resolveCapabilities` becomes `unknown`. The parity test in
`apps/cli/src/adapter-capability-parity.test.ts` continues to assert the two key lists are identical
and gains the same assertion over the two `NOT_USED` lists.

**One consequence to carry into the plan.** `reportCodexCapabilities` today attaches the `/hooks`
trust-recovery string on every branch, so a report can never omit it (`codex-adapter.md` §5). With
no hooks shipped, that advice is removed rather than reworded, and its test with it.

**Removing a key from `NOT_USED` requires, in the same change, the artifact it describes and a test
that observed it working.** That rule is inherited verbatim from `UNSETTLED` and is the reason
`plugin_hooks` never resolved to `yes` over a file that does not exist.

### 3.3 The ingest agent gets no write access at all

The agent is invoked with zero declared write scopes and returns a structured change manifest, which
Developer OS validates and then writes into staging itself.

The alternative — granting the agent a staging-only write scope, which is the literal reading of
design spec §13.4 — was rejected. Under it, "the model cannot write outside staging" is a property
our validators must prove after the fact, and every file in staging becomes attacker-influenced
content we must treat as hostile on read-back. Under this design it is a property the vendor's own
sandbox enforced before the model ran, and §13.4's sentence is still satisfied: the manifest still
lands in the transaction staging directory, written by the party that owns that directory.

Three existing artifacts already assumed it. The canonical `ingest` workflow declares
`capabilities: [structured_result]`; `ingest.stage` deliberately contributes nothing to a derived
write scope because staging is Foundation's, not the vault's; and `codex-adapter.md` §11.13 leaves
this subsystem owing one `--output-schema` file per verb, which is meaningless unless the proposal
*is* the structured result.

### 3.4 A capture is one Markdown file with the envelope in frontmatter

`content/_raw/quarantine/<captureId>.md`. Envelope fields as YAML frontmatter, redacted content as
the body.

It need not satisfy `NoteFrontmatterV1`: `_raw` is a member of `PRIVATE_FOLDERS`, a frozen list in
`packages/brain/src/discovery/discover.ts` whose docblock records that one mutation of it "would
silently re-admit quarantined captures to the index." Quarantine is inside the vault and outside
both the index and the lint, which is what design spec §13.5 requires.

**The founder can read and edit a capture in Obsidian without the CLI**, which is what makes §13.3's
"edit" decision cheap. The cost is that the file is user-editable, so §5.3 states exactly which
fields survive a hand edit and which are recomputed, and the edit path redacts as hard as the
capture path.

The rejected alternatives: JSON (unreadable in the vault the user opens daily, and the CLI becomes
the only door), and splitting the envelope into the product home (one record across two roots, so
every status change becomes a two-file transaction that can half-fail — the exact class of bug the
transaction model exists to prevent, reintroduced by the storage layout).

### 3.5 The redaction fingerprint key becomes persistent, and is the product's first secret at rest

**This was a latent defect, not a preference.** `CaptureEnvelopeV1.redaction[].fingerprint` is
persisted in every capture. Fingerprints are HMAC-SHA256 and `createProductionContext` generates the
key with `randomBytes()` **per process** (`apps/cli/src/context.ts:400`). The key was introduced for
transaction diagnostics, where non-reversibility within a single run is all that is required, and
nothing persisted a fingerprint until now. Left alone, the same secret would fingerprint differently
on every invocation: the field would populate, look correct, and mean nothing.

`~/.developer-os/state/redaction.key`, 32 bytes, mode `0600`, generated once at `init`.

**It is deliberately not a managed artifact.** Keeping it out of `installation-manifest.json` means
it is never hashed into a drift report, never named in `doctor` output, and never reachable by a
diagnostic that prints manifest contents. §8.4 carries the full handling rule, including uninstall,
backup and Git.

**Losing the key makes old fingerprints incomparable, never captures unreadable.** Content is not
encrypted with it; only fingerprints are derived from it. A lost key degrades a diagnostic, not the
knowledge.

## 4. The verb-to-command mapping, and why three skills named commands that did not exist

The rendered skill today prints:

````text
### write

Effect: `capture.write`

```json
{"text":"$input.text"}
```
````

It never names a command, because nothing in the pipeline maps a verb to an invocation.
`EFFECT_VOCABULARY` carries a read/write footprint per verb and nothing else. That absence — not
prose drift — is why `claude-adapter.md` §8 and `codex-adapter.md` §10 both record three of six
skills referencing commands that do not exist.

**`EFFECT_VOCABULARY` gains a handler command per verb, as metadata.** `packages/workflow-schema`
still executes nothing: a command name is a declaration, not a handler, and §2.1 of
`docs/architecture/workflow-schema.md` — "it emits and never executes" — is unchanged. What changes
is that `renderSkillBody` can render an invocation the agent can actually run, byte-identically for
both vendors, because the mapping is vendor-neutral.

**The gap becomes structural.** A verb without a command is a missing field in a table the type
system checks, not a sentence somebody forgot to update. `packages/workflow-schema`'s existing test
pinning the list of unimplemented verbs is extended to assert that every verb with a handler has a
command and every verb without one raises its `info` finding — so closing a verb forces a return to
that table, which is the property the original test was built for.

Six verbs gain commands here: `capture.write`, `capture.list`, `capture.setStatus`, `capture.edit`
(new, §5.3), `ingest.stage`, `ingest.validate`, `ingest.apply`. `agent.prompt` remains the adapters'.

## 5. Capture

### 5.1 The pipeline

```text
--text, or stdin when --text is absent
  → redact                    ← before truncation, persistence, logging, hashing or model input
  → normalize                 ← NFC; control and format characters screened
  → deduplicationHash = sha256(redacted, normalized content)
  → captureId         = first 16 hex characters of that hash
  → envelope + Markdown body
  → transaction: plan → backup → stage → validate → apply → verify → finalize
```

Redaction first is design spec §13.2 and it is absolute. The raw text exists only in memory, is
never written, never logged, never hashed, and never reaches a model.

**The write is a transaction like every other filesystem mutation in this product.** A capture is
not a special case that may append directly; it goes through Foundation's `TransactionExecutor`,
which is what makes "atomic quarantine writes" true rather than aspirational, and what makes §9.6's
interruption suite meaningful.

### 5.2 The id is derived from the hash, and duplicate detection is a filesystem property

`captureId` is the first 16 hex characters of `deduplicationHash`, so the filename **is** the
deduplication key. A duplicate is an `O_EXCL` create that fails — not a directory scan that two
concurrent captures can race each other through.

**The cost, stated plainly:** filenames do not sort by date. `createdAt` is in frontmatter and
Obsidian sorts by modification time, so this is a browsing inconvenience rather than a loss.

**A duplicate exits 0 and names the existing capture, whatever its status.** Re-capturing something
already rejected does not resurrect it; the user's decision stands until the user changes it.
Re-capturing something already ingested writes nothing and says where it went.

### 5.3 Envelope fields — where each comes from, and which survive a hand edit

> **Amended 2026-08-13 by the founder, on a pre-flight scan of the implementation plan.** The
> `captureId` row below and its closing paragraph say the id is **recomputed** on a hand edit and a
> mismatch is a refusal. Taken together with §5.6 that makes `capture.edit` impossible: the id is
> `H(redacted content)`, so *any* content-changing edit changes it, so every edit refuses — and the
> secret the user pasted stays in the vault file, which is the one outcome the verb exists to
> prevent.
>
> **`captureId` is now immutable.** It is assigned once, at capture time, and never recomputed.
> `deduplicationHash` still tracks content, so `edit` re-redacts and rewrites in place, the filename
> stays valid, and no refusal fires. The mismatch refusal keeps the job it was really for: the
> frontmatter `captureId` not matching the filename — a rename, or a hand-edited id field.
>
> **The cost, accepted:** two captures whose text converges after an edit can both exist. `BACKLOG.md`
> §8 carries the row. The `deduplicationHash` row is unchanged, and so is the rule that `content`,
> `deduplicationHash` and `redaction` are recomputed rather than trusted.

`CaptureEnvelopeV1` is frozen in `packages/brain/src/schema/capture.ts` and this subsystem fills it
in rather than redesigning it.

| Field | Source | On hand edit |
|---|---|---|
| `schemaVersion` | constant `1` | must remain `1`; anything else refuses the file |
| `captureId` | first 16 hex of `deduplicationHash` | recomputed; a mismatch is a refusal, not a rename |
| `sourceAgent` | environment detection, §5.4 | preserved |
| `sourceAgentVersion` | the adapter's `discoverX` at capture time | preserved |
| `captureMethod` | `"agent-authored"` or `"manual"` | preserved |
| `sourceSessionId` | `null` unless the adapter exposes one stably; today, always `null` | preserved |
| `projectSlug` | slug of the working directory's basename, screened | preserved |
| `workingDirectoryFingerprint` | HMAC of the canonicalized working directory | preserved |
| `createdAt` | capture time, UTC, ISO 8601 | preserved |
| `content` | the Markdown body, redacted and normalized | **re-redacted and re-normalized** |
| `deduplicationHash` | sha256 of `content` | **recomputed** |
| `status` | §5.5 | honoured if it is a legal status, refused otherwise |
| `redaction` | findings from the redaction pass | **recomputed** |

**A hand edit is legitimate, and it is how a secret gets pasted in.** That is why `content`,
`deduplicationHash` and `redaction` are recomputed rather than trusted, and why the recomputation
happens on the review path (§5.6) rather than being deferred to ingest. A capture whose recomputed
`captureId` no longer matches its filename is refused with the mismatch named — it is not silently
renamed, because a rename would make one capture look like two.

`projectSlug` is human-readable by design (design spec §13.1) and can therefore carry a client name.
The vault is local and private, so this is acceptable, but the value is screened before it is
written like every other interpolated string in this product.

### 5.4 `sourceAgent` is detected, never assumed

**The skill body is byte-identical across both vendors** — `renderSkillBody`, shared since
2026-08-12 — so the command the agent is told to run cannot carry `--agent claude` on one tree and
`--agent codex` on the other. Baking the vendor into the body would break the shared-body property
whose proof is that `npm run render:claude` leaves `plugins/claude/` unchanged.

Detection is therefore from the environment, against a table §10.3 carries with the observation
behind each entry. **Anything unrecognised records `"unknown"`.** A guessed agent is worse than an
absent one: it is a fact a later reader will trust.

`sourceAgentVersion` comes from the adapter's own `discoverX` at capture time, which means
**`capture` spawns the vendor binary once per capture**. This is stated rather than left as a
surprise: it is a session-level event rather than a hot path, `discoverX` never throws, and a
discovery failure records `"unknown"` for both fields rather than failing the capture. Losing a
capture because a version probe failed would be the wrong trade in every case.

### 5.5 Statuses and transitions

`CAPTURE_STATUSES` is frozen, in order, with a test pinning that order:
`quarantined → accepted → rejected → staging → ingested → failed`.

| From | To | By |
|---|---|---|
| — | `quarantined` | `capture` |
| `quarantined` | `accepted` | `review --decision accept` |
| `quarantined` | `rejected` | `review --decision reject` |
| `quarantined` | `quarantined` | `review --decision edit` — content changes, status does not |
| `accepted` | `staging` | `ingest`, on entering the transaction |
| `staging` | `ingested` | `ingest`, only after `finalize` |
| `staging` | `accepted` | rollback or resume-to-abandon; the capture is retryable |
| any | `failed` | the envelope itself cannot be parsed or validated — the capture file is broken |

**`failed` is not what an ingest refusal produces, and the distinction is load-bearing.** Every
validator refusal in §6.3 leaves the capture `accepted` and retryable, because the capture is fine
and the proposal was not. `failed` describes a capture whose *own* envelope is unreadable — a
truncated write, a hand edit that broke the frontmatter — which no retry can fix without the user
looking at the file. Collapsing the two would make a transient model failure look like data loss.

**`rejected` is terminal for automation and not for the user.** Nothing transitions out of it
automatically; the user may edit the file's status by hand, which the review path re-validates.

**No status means "edited".** Design spec §13.1's list has none, and adding one would put a
seventh member into a frozen ordered list to record something the file's own mtime already says.
`review --decision edit` is a content transition, not a status transition — which is precisely why
`capture.edit` is a separate verb from `capture.setStatus` (§5.6).

### 5.6 Review

> **Amended 2026-08-13 by the founder**, with §5.3. The clause below — "refuses if the recomputed
> `captureId` no longer matches the filename" — is replaced: the id is not recomputed, so an edit
> that changes content **succeeds** and rewrites the file in place with the re-redacted body,
> recomputed `deduplicationHash` and recomputed `redaction`. The refusal remains for a frontmatter
> `captureId` that does not match the filename. Everything else in this section stands, including
> the refusal to spawn `$EDITOR`.

```text
developer-os review                                  list quarantined captures
developer-os review --id <id> --decision accept      status → accepted
developer-os review --id <id> --decision reject      status → rejected, source untouched
developer-os review --id <id> --decision edit        re-read, re-redact, re-hash, record
```

**`edit` re-validates; it does not open an editor.** The capture is Markdown in the user's own
vault, edited in Obsidian or any editor. `--decision edit` is the verb that brings a hand edit back
under the product's guarantees: it re-reads the file, **re-redacts it**, recomputes
`deduplicationHash` and `redaction`, and refuses if the recomputed `captureId` no longer matches the
filename. Spawning `$EDITOR` was rejected — it adds an interactive escape hatch to a command that
must remain `--json`- and `--yes`-driveable, for no capability the file itself lacks.

`capture.edit` is the verb `docs/architecture/workflow-schema.md` §7 records the `review` workflow
as advertising and lacking: its `decision` input offers `edit` while its only mutating verb is
`capture.setStatus`. It derives the same `content/_raw/quarantine/**` read and write scopes, so the
workflow's declared scopes are unchanged and the equality rule still holds.

**No decision deletes a source.** The `review` workflow's own validator says so, and §9.1's suite
asserts it against every decision.

## 6. Ingest

### 6.1 One capture, one agent call, one transaction

Failure isolates to a single capture instead of poisoning a batch, and the prompt stays bounded by
one envelope rather than by however many the user accepted. `--limit` bounds how many captures one
invocation processes; the default is all accepted ones, processed in `captureId` order so two runs
over the same set do the same work in the same sequence.

```text
accepted capture
  → prompt: envelope.content, marked as DATA and never as instruction
  → adapter.invoke(scopes {read: [vault], write: []}, outputSchema: <verb>.schema.json)
        Codex: -s read-only, derived from the zero write-scope count
        Claude: no write tool in --allowedTools
  → IngestProposal, validated against the schema
  → the nine deterministic validators of §6.3
  → Developer OS writes staging
  → transaction: plan → backup → stage → validate → apply → verify → finalize
  → brain reindex
  → status → ingested
```

### 6.2 Model input is redacted by construction

The prompt is built from `envelope.content`, which is the post-redaction field. **There is no code
path from raw capture text to a model**, because raw text is never persisted and the envelope is the
only thing ingest reads. The sentinel gate's "absent from model input" clause is therefore met
structurally rather than by a second redaction pass that could be forgotten.

The agent has read-only access to the vault, which may contain secrets the user wrote into their own
notes. Redacting the user's canonical content is not this product's business; catching it on the way
back **is**, which is what §6.3's secret scan is for.

### 6.3 The nine validators

Design spec §13.4, each run on the proposal before a single byte reaches staging:

| Validator | Refuses when |
|---|---|
| schema and frontmatter | the proposal or any note it proposes fails `NoteFrontmatterV1` |
| source and provenance | a proposed note does not name the capture it came from |
| link and graph | a wiki-link resolves to nothing, or a proposed link would create a cycle the graph builder rejects |
| duplicate detection | the proposed note duplicates an existing one under `packages/brain`'s own duplicate rule |
| confidence and lifecycle policy | required frontmatter for the note's declared stage is absent |
| **secret scan** | the redaction pass finds anything in the proposal |
| deterministic reindex | the index built from the staged result is not byte-identical to a rebuild |
| generated-output consistency | a proposed write targets a generated artifact under the indexes directory |
| **write-scope enforcement** | §6.4 |

**A failure at any validator leaves the capture `accepted`, never `ingested`, and always retryable.**
That is the gate's own wording and §9.6 asserts it by interruption as well as by refusal.

### 6.4 Write-scope enforcement — how model output cannot widen scope

Every path in the proposal is canonicalized through Foundation and refused if it:

- resolves outside the vault's `content/` root;
- names a member of `PRIVATE_FOLDERS` or the configured indexes directory;
- traverses (`..`) at any segment;
- resolves through a symlink to a destination outside the vault — the check is on the resolved
  destination, not on the written path, because a symlink is exactly the thing that makes those
  differ;
- falls outside the `ingest` workflow's own declared write scopes.

A proposal violating any of these exits 5 and the capture stays `accepted`. The model's output is a
proposal, never proof of safety, and this is where design spec §14.1's sentence becomes code.

### 6.5 Ingest ends with a reindex

`docs/architecture/workflow-schema.md` §7 records that the `ingest` workflow stops at apply, so a
note is ingested and `brain search` cannot find it until somebody runs `brain reindex`. The step is
added, `brain.reindex` already exists and is implemented, and the workflow's declared write scopes
widen to include the indexes directory — which the equality rule then requires, so the widening is
checked arithmetic rather than a judgement.

### 6.6 The output schema files

`codex-adapter.md` §11.13: nothing writes the file `outputSchemaPath` points at, because
`invokeCodex` only screens the path and forwards it into argv. **One JSON Schema file per
agent-invoking verb** ships with the product and is written to the product home at `init`, so a
caller never points the vendor CLI at a missing file — which would surface as the CLI's own non-zero
exit rather than as `malformed-output`, and would be diagnosed as the wrong failure.

## 7. What else this subsystem is due

### 7.1 The scope globs stop being literals

`docs/architecture/workflow-schema.md` §8.1: `EFFECT_VOCABULARY`'s globs hardcode `content/` and
`_indexes`, while `BrainConfigV1.contentRoot` and `indexesDir` are configuration. The recorded
acceptance condition is "the first time a handler or adapter resolves one of these globs against a
real filesystem" — this subsystem is that first time, so it is due here rather than deferred again.

The globs are derived from the resolved Brain configuration, and the workflow-compiler spec §6 is
amended with them (§12).

### 7.2 Probing becomes opt-in, and the two-gate machinery gets its first caller

`codex-adapter.md` §11.4: the whole two-gate capability model has no production caller, because
`doctor` never turns probing on. `doctor --probe` is that caller.

**It is opt-in rather than default, and the reason is that the Claude probe mutates the home it
inspects.** `claude plugin validate` writes `~/.claude.json` and a timestamped backup
(`claude-adapter.md` §9.4, observed 2026-08-11). A default-on probe would make `doctor` a silently
mutating command, which contradicts Foundation's rule that `doctor` reports rather than repairs.
Without `--probe`, `skills` reports `unknown`, which is exactly what "we did not ask" means. With
`--probe`, the command states before it runs that it will write to the Claude home.

### 7.3 `brain-search` reads notes

`workflow-schema.md` §7: the workflow reads `content/_indexes/**` only and never `brain.readNote`,
so it summarises from index metadata while design spec §13.5 specifies
`vault-map → catalog section → selected notes → sourced answer`. The `brain.readNote` step is added
and the declared read scopes widen to the content root. Read-only either way; this is completeness.

### 7.4 `maxTurns` is refused rather than implemented

`codex-adapter.md` §7 and §11.3: one shared `agent.prompt` schema, two behaviours, one of them
silent — `invokeClaude` bounds it and refuses anything out of range, `CodexInvocation` has no such
field, so a workflow setting it gets a turn limit on one vendor and none on the other with no
diagnostic.

**`parseAgentPromptArgs` refuses `maxTurns`**, with an error naming whoever implements a turn bound
on both vendors. This is the repository's own precedent: the `scheduled` trigger is refused with an
error naming DOS-P7 because "a value that validates while the property it names is false" is what
this codebase refuses. No canonical workflow sets `maxTurns`, so nothing regresses. Implementing it
under Codex was rejected as inventing a bound the vendor does not document.

### 7.5 Three small correctness fixes this subsystem owns

- **Two artifact roots share one type** (`codex-adapter.md` §11.1, `BACKLOG.md` §1 NEW-13).
  `RenderedArtifact` is `{path, contents}` for paths relative to the plugin root *and* the
  marketplace root; the plugin root is a descendant of the marketplace root, so a wrongly-rooted tree
  applies cleanly instead of refusing. The durable fix is nominal: brand the two array shapes as
  distinct opaque types so `proposeCodexInstall` structurally refuses a plugin-root tree. Due here
  because this subsystem is the first consumer of `CodexAdapter`.
- **`doctor` renders any discovery error as `absent`** (`codex-adapter.md` §11.6) — "we could not
  ask" printed as "not installed", the same conflation `unreadable` exists to prevent, one layer up,
  duplicated in two functions that must change together. Both are fixed in one change.
- **The `allUnknown` unsound cast, in two copies** (`codex-adapter.md` §11.7).
  `Record<string, CapabilityState>`'s index signature satisfies the named-property type, so a
  renamed or dropped capability key is not a compile error. Fixed in both adapters, and the fix must
  make a dropped key fail to compile — a test that merely checks the current keys would restate the
  bug.

## 8. Security seams

### 8.1 Redaction classes

Five exist in `packages/security/src/redaction.ts`: `private-key`, `env-secret`, `bearer-token`,
`provider-token`, `high-entropy`. Design spec §14.3 requires four more:

| Class | Covers |
|---|---|
| `certificate` | PEM certificate blocks, which the private-key pattern does not match |
| `credential-store` | `~/.aws/credentials`, `.netrc` and `.npmrc` value shapes |
| `service-credential` | AWS `AKIA`/`ASIA`, Google `AIza`, Stripe `sk_live`/`rk_live`, JWT triplets |
| `user-pattern` | §8.2 |

The existing overlap-resolution and HMAC-fingerprint machinery is unchanged; these are additional
candidate producers feeding the same pipeline.

### 8.2 User-configured patterns are literal substrings, not regexes

**This narrows design spec §14.3 and the narrowing is deliberate.** §14.3 says "user-configured
patterns". A user-supplied regular expression compiled and run over capture text is a ReDoS surface,
and this codebase has no expression timeout anywhere to bound it — a pathological pattern would hang
the capture, which is the one operation that must not fail quietly.

User patterns are therefore **literal, case-insensitive substrings**, matched with `indexOf`
semantics over the NFC-normalized text. This covers the actual use — a client name, an internal
hostname, a project codename — and cannot backtrack. Patterns live in `config.toml` and are
themselves screened before use.

### 8.3 Captured material is data, and the defence is already shipped

The `shared` preamble carries the whole prompt-injection defence and is **concatenated** into every
skill rather than referenced, by the founder's decision of 2026-08-11, so no load order or user
setting can remove it. This subsystem adds nothing to that text. What it adds is the enforcement
behind it: §6.4's write-scope check is what makes "never widen file access beyond the scopes this
workflow declares" a refusal rather than a request.

### 8.4 The redaction key

- Generated at `init`, 32 bytes from `randomBytes`, written mode `0600`, at
  `~/.developer-os/state/redaction.key`.
- **Not a managed artifact**: absent from `installation-manifest.json`, so it is never hashed into a
  drift report and never printed by a diagnostic that enumerates manifest contents.
- **Never backed up** into `backups/`, **never staged** by any Git operation, **never logged**, and
  **never** included in `--json` output.
- `uninstall` removes it, because leaving a secret behind after the product is gone is worse than
  losing fingerprint comparability.
- `doctor` reports whether it exists and its mode, never its contents.
- A missing key regenerates on next use with a warning that prior fingerprints are no longer
  comparable. It does not fail the command: content is not derived from the key, so a lost key
  degrades a diagnostic rather than the knowledge.

### 8.5 The consolidated threat model

`docs/architecture/threat-model.md`, the second thing `BACKLOG.md` §5 records this subsystem as
owing. It consolidates what is today spread across two adapter notes, the Brain note and the
Foundation constraints: the trust boundaries, what is untrusted and why, and which mechanism
enforces each boundary. The capability model stays recorded per adapter, where
`codex-adapter.md` §3 says it belongs while the two vocabularies are asserted identical.

## 9. Testing

`tests/security/` is created here — the directory `BACKLOG.md` §5 has recorded as missing since the
program file map was written, with DOS-P6 as its first owner.

**Every suite must be watched fail before it is believed.** A gate nobody has seen go red is a gate
about a false property, and this repository has shipped two of them.

### 9.1 Sentinel

One planted secret, traced through every artifact it could reach: the capture file, the logs, the
`--json` output, the deduplication hash, the model input, the staging directory, every validator
report, and the canonical note. **Absent from all eight**, per the gate in `BACKLOG.md` §3 and
design spec §17.5's release blocker.

The suite asserts per artifact, not in total. A single assertion over a concatenation of all eight
would pass while seven were empty — the same shape as the gates `SESSION.md` records as already
violated twice.

### 9.2 Prompt injection

A capture whose text instructs the model to write outside scope, follow a URL, or widen access. The
proposal either refuses or stays in scope; the instruction is never executed. Fixtures are synthetic
and include the forged-heading and fence-escape shapes `src/skill.test.ts` already covers for
rendering, now carried through an actual invocation.

### 9.3 Symlink escape

A proposal whose path resolves through a symlink out of `content/`. Exit 5, capture stays
`accepted`, nothing written. Asserted on the **resolved destination**, because a check on the
written path is the bug this suite exists to catch.

### 9.4 Multiline command

`curl … |⏎sh` in captured text reaches no command position. The normalize-newlines guard already
exists; this asserts it on the capture path rather than assuming it, which is the distinction
`SEC-100` was about.

### 9.5 Malformed manifest

Forged and stale installation manifests refuse rather than apply, on every path this subsystem adds.

### 9.6 Interruption at every phase

`SIGKILL` at each of `plan`, `backup`, `stage`, `validate`, `apply`, `verify` and `finalize`, for
both the capture write and the ingest apply. Every one leaves the capture retryable, none leaves it
`ingested`, and `doctor` returns exit 6 with the `repair --resume` and `repair --rollback` commands
for the incomplete transaction.

### 9.7 End-to-end

`tests/e2e/knowledge-lifecycle/`: capture, review, ingest and retrieve, against the compiled binary
in a disposable home, with a synthetic vault. The retrieval assertion is that a note ingested in one
invocation is returned by `brain search` in the next — which is what design spec §20's acceptance
criteria 5 through 8 actually ask for, in one run.

### 9.8 Independent security review

**Required before the checkpoint**, per `BACKLOG.md` §3's gate. A reviewing agent that is not the
author and did not write the code, given the constraints, the file list, and instructions to review
only. This is the gate the two adapters' reviews caught real defects at, and this subsystem has a
larger blast radius than either.

## 10. Verified surfaces

Normative. An implementation may not depend on a surface this section does not carry.

### 10.1 What is already verified, and where

The vendor CLI surfaces this subsystem invokes are carried by the two adapter specs, both approved:
`specs/…-claude-adapter-design.md` §14 and `specs/…-codex-adapter-design.md` §14, the latter as
amended four times on 2026-08-12 by first contact with `codex-cli 0.147.0`. This spec adds no new
vendor surface: ingest invokes `agent.prompt` through the adapters' existing `invoke` modules.

### 10.2 What this subsystem must verify, and it requires spending money

**The JSONL terminal-event rule ships provisional and unverified** (`codex-adapter.md` §7, §11.2).

> **Amended 2026-08-15 by Task 17.** The call below was made and this paragraph's premise has moved:
> the framing and the discriminating `type` field are **settled**, and the terminal-event rule is
> **not**, because the account's usage limit was exhausted before any run reached a model response.
> The obligation this section states is therefore half discharged; what is still owed is one
> successful `codex exec` completion — `BACKLOG.md` §1 **NEW-21** — and
> `specs/…-codex-adapter-design.md` §14.1 carries the observed shape. Read the paragraph below as the
> statement of why the call had to be made rather than as the current state.

`codex exec --json` streams events as JSONL while `--output-schema` constrains only the final
response, so stdout is reduced to the last line that parses as a non-null JSON object. Settling it
needs a real `codex exec` call, which invokes a model on the founder's credentials and costs money —
**declined by the founder on 2026-08-12** for DOS-P5, with Task 17 scoped to offline plugin
management instead.

**Under this design that call is no longer avoidable.** Ingest *is* a real model call on both
vendors; the central path of this subsystem cannot be exercised without one. So this subsystem
either spends the credits or ships its main path untested against a live binary. The founder
accepted this on 2026-08-13 when approving the scope boundary.

The obligation is precise: capture raw stdout from one real run, record whether the final response
really is the last parsing line and whether it carries a discriminating field worth filtering on,
amend Codex spec §14.1 with the observed shape, dated, and correct the docblock. **Do not quietly
promote the rule to verified.**

### 10.3 Agent detection

The environment table §5.4 relies on is established by observation during implementation, one row
per vendor, each recorded here with what was observed and when. **Until a row is observed, its
vendor is not in the table and detection records `"unknown"`** — a guessed row is exactly the kind of
undocumented capability assumption design spec §20 names as a release blocker.

**Observed by Task 17 on 2026-08-15 — one row, not two.**

| Vendor | Variable | Value | Observed on | Observed in |
|---|---|---|---|---|
| `claude` | `CLAUDECODE` | `1` | 2026-08-15 | Claude Code 2.1.233 on macOS, `claude -p --output-format json`, with **every** `CLAUDE*`, `CODEX*` and `ANTHROPIC*` variable stripped from the parent environment |

**Codex has no row, and the table above is the whole table** — the rule immediately above it is that
an unobserved vendor is *not in the table*, so listing it as a row marked "not observed" would
contradict the rule in the act of stating it. The account's usage limit was exhausted on 2026-08-15
and every `codex exec` ended `turn.failed` before a shell command could report an environment.

**Why the Claude row was taken twice.** The first attempt ran `claude -p` from inside a Claude Code
session and inherited that session's variables, so it could not distinguish a marker the vendor sets
from one leaking in from the parent. It was discarded and re-run with the parent stripped, which is
what the "Observed in" column records. A marker that only ever appears in an inherited environment
would detect the *session that ran the experiment*, not the vendor.

**Codex's row is absent rather than guessed**, per the rule above, and the cost is stated rather than
discovered later: every capture written inside a Codex session until that row lands records
`sourceAgent: "unknown"`. Those captures are correct and are never rewritten. Registered as
`BACKLOG.md` §1 **NEW-21**, together with the half of `codex-adapter-design.md` §14.1 the same
blocked run left open.

## 11. Produced interfaces

| Interface | Where |
|---|---|
| `CaptureEnvelopeV1` transitions and persistence | `packages/brain/src/capture/` |
| `ReviewDecision` | `packages/brain/src/review/` |
| `IngestProposal`, `IngestValidationResult`, `ApplyResult` | `packages/brain/src/ingest/` |
| `capture`, `review`, `ingest` commands | `apps/cli/src/commands/` |
| the four new redaction classes and user patterns | `packages/security/src/redaction.ts` |
| the persistent redaction key | `apps/cli/src/context.ts`, `init` |
| `not-used` capability state | `packages/core/src/capabilities/`, both adapters |
| verb handler commands | `packages/workflow-schema/src/vocabulary.ts` |
| one `--output-schema` file per agent-invoking verb | shipped, written to the product home at `init` |
| `docs/architecture/threat-model.md` | consolidated threat model |

## 12. Amendments to approved documents

Each is registered in `BACKLOG.md` §8 in the commit that lands this file, and cross-referenced from
the document it amends. An approved document is not silently rewritten.

| Document | What changes |
|---|---|
| product design spec §11 | "Automatic capture may use a documented lifecycle hook or the controlled `developer-os run claude|codex` wrapper" and "`doctor` reports that wrapper use is required" — there is neither a hook nor a wrapper. `CapabilityState` **replaces** `wrapper-required` with `not-used`, and six of the nine keys resolve to it |
| product design spec §14.3 | "user-configured patterns" narrowed to literal case-insensitive substrings, for the ReDoS reason in §8.2 |
| `specs/…-claude-adapter-design.md` §6.1 | hooks **declined**, not deferred; the three lifecycle keys report `not-used` rather than `wrapper-required` |
| `specs/…-codex-adapter-design.md` §5.3 | the same, for the same reason, in one decision covering both adapters |
| `specs/…-codex-adapter-design.md` §14.1 | the JSONL terminal-event rule promoted from provisional to observed, dated, with the shape that was seen |
| `specs/…-workflow-compiler-design.md` §6 | scope globs derived from `BrainConfigV1` rather than written as literals |

**Two canonical workflows change**, which is a contract change rather than an amendment to prose:
`workflows/capture/workflow.yaml` drops `session_end` and `workflows/shared/workflow.yaml` drops
`session_start`; both go to `2.0.0`; both vendor trees regenerate and the drift gates prove it.

## 13. Open items this spec does not close

1. **`buildConflictEvidence` still has no consumer.** Both adapters declined the design it was built
   for. Owner remains the first subsystem with a real three-way merge, which is not this one.
2. **The Codex supported floor is one observed version, not a range.** Owner: DOS-P9.
3. **A re-rendered plugin tree may not be a re-loaded one** — Codex resolves skills through a cache
   copy. Owner: DOS-P7, whose update lifecycle re-renders in place.
4. **`NEW-11` and `NEW-12`** are repository defects rather than pipeline ones and are not taken here.
5. **Line-wrap drift** wants a repository formatting decision, not a hand pass.
6. **Automatic capture is not designed, only declined.** If a future version wants it, the honest
   route is a documented, stable transcript contract with a regression fixture landing in the same
   change — the condition both adapter specs already set for lifting the refusal. Nothing in this
   spec weakens that condition.
