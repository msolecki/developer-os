# Developer OS — The Knowledge Pipeline

**Written 2026-08-15 by DOS-P6 Task 19**, as the document that replaces
`plans/2026-07-21-developer-os-knowledge-pipeline.md` when that plan is deleted. The plan's design of
record is `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md`, approved by
the founder on 2026-08-13; this note is what points at it.

`capture`, `review` and `ingest` are three CLI verbs over one data type. An observation an agent
wrote in its own words becomes a redacted file in quarantine, a human decides on it, a vendor model
proposes canonical notes from it, nine deterministic validators judge the proposal, and Developer OS
— never the model — writes the result. **This is the first subsystem in the program that executes a
workflow verb.** Everything before it emitted, validated or rendered.

**Every claim here points at code or at a named test case**, `path:line`, which is the standard
`threat-model.md` holds itself to. Where a claim rests on something weaker, it says so in the
sentence rather than in a footnote. The threat model is the companion document: it owns the trust
boundaries and their mechanisms, and this note owns the shape of the pipeline and the decisions that
produced it.

---

## 1. What survives, in one table

| | Where |
|---|---|
| the three verbs | `apps/cli/src/commands/capture.ts`, `review.ts`, `ingest.ts` |
| the envelope, its statuses, and their transitions | `packages/brain/src/schema/capture.ts`, `packages/brain/src/capture/`, `packages/brain/src/review/` |
| the proposal, the nine validators, and the apply | `packages/brain/src/ingest/` |
| the contracts the vendor trees render | `workflows/{capture,review,ingest,brain-search,shared}/workflow.yaml`, all five at `2.0.0`. That glob matches **six** files: `workflows/doctor/workflow.yaml` is unchanged at `1.0.0` |
| the security suites | `tests/security/`, eight suites, 85 cases |
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

**Hooks are therefore declined, not deferred** (spec §3.1). Both adapter notes recorded the blocker
as a missing executable bit; that was wrong and is corrected here as well as in the spec, because a
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
- no hooks ship, in either vendor tree, in v1;
- `developer-os run claude|codex` is never built;
- **nothing automatic captures anything.** If nobody runs the workflow, no knowledge is captured.
  This is the largest product narrowing in the program to date and it is deliberate.

**The capability vocabulary changed with the decision.** `wrapper-required` was removed rather than
kept beside a new value: it meant "we are not certain, and the wrapper produces the same capture
anyway", and the decision deletes the second half, leaving advice to run a command that will not
exist. `CAPABILITY_STATES` is `yes | unknown | not-used`
(`packages/core/src/capabilities/index.ts`), and `plugin_hooks`, `session_start_injection`,
`session_end_capture`, `pre_compact_backup`, `subagents` and `durable_project_guidance` resolve to
**`not-used` before the version table or any observation is consulted**, in both adapters. Removing a
key from either adapter's `NOT_USED` list requires, in the same change, the artifact it describes and
a test that observed it working — the rule that kept `plugin_hooks` from ever resolving to `yes` over
a file that does not exist. Parity between the two lists is asserted by
`apps/cli/src/adapter-capability-parity.test.ts`.

**`sourceAgent` records `"unknown"` until a real vendor run observes a row, and after Task 17 that is
still true of exactly one vendor.** `AGENT_DETECTION_ROWS` carries **one** row
(`packages/brain/src/capture/agent.ts`): `CLAUDECODE=1`, observed 2026-08-15 on Claude Code 2.1.233
with every vendor variable stripped from the parent environment, so the marker could not be one
leaking in from the session that ran the experiment — the first attempt inherited them and was
discarded for exactly that reason. **Codex's row is absent**, because the account's usage limit was
exhausted and every `codex exec` ended `turn.failed` before a shell command could report an
environment.

The rule that reads the table is still tested against synthetic rows, so it is not a rule whose first
run is the day someone adds one, and one case now drives detection through the **real** table end to
end — without it the observation would live in a unit test with nothing proving the command consumes
it. Every capture written inside a Codex session until that row lands records `sourceAgent: "unknown"`
and `sourceAgentVersion: "unknown"`. **Those captures are correct and are never rewritten.** A guessed
row would be exactly the undocumented capability assumption the design spec names as a release
blocker, which is why the absent row was left absent. Owner: `BACKLOG.md` §1 **NEW-21**.

---

## 3. The capture path, and the one ordering that is absolute

```text
text → redact → normalize → deduplicationHash → captureId → envelope + body
```

`buildCapture` (`packages/brain/src/capture/build.ts:202`) runs that order and no other, over
`redactAndNormalize` (`:167`). **The raw text exists only in memory**: it is never written, never
logged, never hashed and never reaches a model. The hash is taken over the *redacted, normalized*
content, so two texts differing only by a secret produce one capture — a consequence rather than an
accident, since the observation is the same observation and nothing of the second secret survives the
duplicate.

The envelope persists **class and fingerprint only**, never a value and never enough of one to
reconstruct it (`packages/brain/src/schema/capture.ts:47-50`). The findings are rebuilt at that
boundary rather than passed through, so a widened `RedactionFinding` upstream cannot carry a secret's
location into a persisted envelope without someone deciding to.

**A capture is not a managed artifact.** `writeCapture` records nothing in
`installation-manifest.json` (`apps/cli/src/commands/capture.ts:530-534`): a capture is the user's own
content, hand-editable in Obsidian by design, so recording it would report every legitimate edit as
drift and would make the next capture of the same text a refused `create` over a file the product
claims to own. The write still goes through `validateChangePlan` with quarantine as the sole owned
root and the product home as the excluded one (`:579-580`), which is what refuses a symlink inside one
resolving into the other.

**A duplicate is reported at exit 0 and writes nothing** (`apps/cli/src/commands/capture.test.ts:256`), including when this
run loses the race to write it (`:322`) and when the existing file cannot be parsed (`:290`). It is
**not** the `O_EXCL` create spec §5.2 describes, and cannot be: no transaction-mediated write can
deliver that precondition. `ORDER.md` carries the Foundation change that would close it — §10.2 below.

---

## 4. Review, and where a hand edit is brought back under the guarantees

`applyReviewDecision` (`packages/brain/src/review/decide.ts:71`) is a status change and nothing else.
The only status a decision is legal from is `quarantined` (`:36`); `accept → accepted`,
`reject → rejected`, and **`edit` maps back to the status it came from** (`:45-50`), because no status
means "edited" — `CAPTURE_STATUSES` is frozen at six members and recording an edit would mean adding
a seventh to say what the file's own mtime already says.

**The content transition an edit really is happens in the parser.** `parseCaptureFile`
(`packages/brain/src/capture/parse.ts:123-127`) recomputes exactly three fields — `content`,
`deduplicationHash` and `redaction` — and preserves everything else. A hand edit is legitimate, and it
is how a secret gets pasted into a vault file, so the body is **re-redacted on the way in** rather
than trusted until ingest.

**The id is assigned once and never recomputed** (`packages/brain/src/capture/parse.ts:17-21`, amended by the founder
2026-08-13). Under recomputation every content-changing edit would refuse, and the secret the user
pasted would stay in the file — the one outcome `capture.edit` exists to prevent. `review` gained
that verb in DOS-P6: the workflow's `decision` input offered `edit` while its only mutating verb was
`capture.setStatus`, and a verb nothing declares closes nothing.

**No capture is ever deleted** — not on reject, not on ingest, not on uninstall
(`uninstall.test.ts`, the case asserting quarantine is untouched).

---

## 5. Ingest is four transactions per capture, plus a compensating fifth

**Spec §6.1's headline sentence — "one capture, one agent call, one transaction" — is false and
cannot be made true.** It is the correction this subsystem owes its own design of record.

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

The five kinds are `apps/cli/src/commands/ingest.ts:245-251`; the ladder is documented at `:1020-1033`
and the reasons at `:228-243`. **Two independent reasons no two of them merge:**

1. **`BrainService.reindex()` reads the vault** (`packages/brain/src/service.ts:220`), so it cannot
   run until the apply has finalized — and it has no write channel at all, by design, so the CLI
   stages its bytes through the executor exactly as `brain reindex` does
   (`apps/cli/src/commands/ingest.ts:947-973`).
2. **`validateChangePlan` grants ownership from the manifest**, where the four index artifacts *are*
   recorded (`apps/cli/src/commands/reindex.ts:156-165`) and a capture deliberately **is not**
   (`apps/cli/src/commands/capture.ts:530-534`). One transaction cannot hold both regimes.

A third reason applies to the first pair alone: the status must be durable *before* the apply, or a
crash cannot be told from a run that never started.

**The residual, accepted rather than closed.** A crash between the apply and the last transaction
leaves a capture at `staging` with its notes already in the vault. It is **inert**: `selectCaptures`
selects only captures whose status is `accepted` (`ingest.ts:541`), so the next run cannot
double-apply. It is visible, and a hand edit of the status is what moves it — which is what
`PARTLY_APPLIED_RECOVERY` (`ingest.ts:277-278`) tells the user, in those words and no others: **the
`repair` half of that advice is a different constant.** `INCOMPLETE_TRANSACTION_RECOVERY`
(`:300-301`) is appended unconditionally by `refusedRecovery` (`:349`), so the two arrive together in
the output while neither line alone says both. **No arrangement of these transactions removes that
window**, because no two of them can share one.

**The model gets zero declared write scopes** (spec §3.3), and each vendor's sandbox follows from that
count rather than from an argument: `invokeCodex` derives `-s read-only` from `writeScopes.length === 0`,
and the Claude side passes a tool list carrying no write tool — no `Write`, no `Edit`, no `Bash`, no
`Task` (`ingest.ts:180-196`, `:658-690`). The alternative, a staging-only write scope, was rejected:
under it "the model cannot write outside staging" is a property our validators must prove after the
fact, and every file in staging becomes attacker-influenced content we must treat as hostile on
read-back. Under this design it is a property the vendor's own permission system enforced **before the
model ran**.

**One asymmetry a reader will otherwise assume away.** `--output-schema` reaches Codex only;
`invokeClaude` has no such flag, so on that vendor the schema is described in the prompt and enforced
by `parseIngestProposal` afterwards (`ingest.ts:651-656`).

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
(`apps/cli/src/commands/ingest.ts:533-539`), and the duplicate path in `capture`
(`apps/cli/src/commands/capture.ts:452`). **A validator refusal leaves the capture `accepted` and
retryable**, and a review refusal writes nothing at all (`decide.ts:67-69`).

Collapsing the two would make a transient model failure look like data loss: the capture is fine and
the proposal was not. That distinction is what `ingest`'s four recovery strings are for — `untouched`,
`staging` with notes, `staging` without them, and `ingested`-under-a-failure-exit — assembled from the
states a run actually left rather than printed in full every time (`ingest.ts:321-350`).

**Evidence:** `apps/cli/src/commands/ingest.test.ts:385` (the ladder itself), `:478` (rollback to
`accepted`, never to `failed`), `:505` and `:589` (no rollback once notes landed), `:664` (the status
is read from disk rather than inferred), and every case in `tests/security/interruption.test.ts`,
whose `expectedStatus` is derived per transaction kind and phase rather than assumed uniform.

---

## 7. The nine validators, and where each is enforced

`VALIDATOR_IDS` is frozen at nine (`packages/brain/src/ingest/validate.ts:33-43`) and typed as a union
rather than as `string`, so a typo — `write-scopes` for `write-scope` — cannot compile, never fire, and
still pass the exhaustiveness test because the typo went into the expectation too.

| Validator | Enforced at | What it refuses |
|---|---|---|
| `schema-and-frontmatter` | `packages/brain/src/ingest/validate.ts:337` | a note the canonical schema does not accept |
| `source-and-provenance` | `:365` | a note whose `sourceCaptureId` is not the capture being ingested |
| `link-and-graph` | `:929` | links the lint build grades as broken |
| `duplicate-detection` | `:951` | a proposal colliding with a note already in the vault |
| `confidence-and-lifecycle` | `:407` | `established` without a `reviewed` date, `deprecated` without `updated` |
| `secret-scan` | `:466` | a secret the model handed back |
| `deterministic-reindex` | `:964` | a proposal whose projection does not rebuild deterministically |
| `generated-output-consistency` | `:700` | a write into the generated indexes directory |
| `write-scope` | `:559` | a path outside the declared, resolved write scopes |

`validateProposal` (`:832`) runs them, is total and side-effect-free, and a finding names the class and
the file **never the value** (`:67-72`) — the report is written and logged, and the proposal is model
output that has just read material an attacker may have written.

**Two of the nine refuse at exit 5 rather than exit 1**: `secret-scan` and `write-scope`
(`ingest.ts:253-262`). Spec §6.4 names exit 5 for write-scope; extending it to the secret scan is this
subsystem's reading and is stated rather than buried — a secret coming back from a model and a path
trying to leave the vault are the same kind of event, and different in kind from a model that got a
frontmatter key wrong.

**`confidence-and-lifecycle`'s rule is defensible but invented.** The spec names the validator and
says "required frontmatter for the note's declared stage is absent" without saying which frontmatter.
The registered narrowing and its cost of reversal are `BACKLOG.md` §8.

---

## 8. Two configuration decisions a later reader will trip over

### 8.1 The redaction key

`CaptureEnvelopeV1.redaction[].fingerprint` is persisted in every capture, and the HMAC key used to be
generated with `randomBytes()` **per process**. Left alone, the same secret would fingerprint
differently on every invocation: the field would populate, look correct, and mean nothing.

**The key is durable, and the load has two doors, not one:**

- `readRedactionKey` (`apps/cli/src/context.ts:589`) is the **composition root's** door. It never
  creates, never throws and never repairs, returning `null` for absent, unreadable, symlinked,
  wrong-typed or too-short — every state `doctor` must be able to *report*, which it cannot do if
  building the context already threw. The root warns and falls back to an ephemeral key
  (`:650`), so diagnostics are still redacted on a machine that has never been initialized.
- `loadOrCreateRedactionKey` (`:568`) is the **point-of-use** door, called by `init` (`init.ts:695`,
  `:730`) and by `capture`, `review` and `ingest` at their own points of use. It creates when absent,
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
key (`apps/cli/src/commands/uninstall.ts:509-515`) — by the exact path `redactionKeyPath` computes,
never by pattern and never by walking the state directory, so the exception cannot widen. It runs
**above** the early return for an absent manifest (`:542`), or an install that failed and reverted
would leave an orphaned secret nothing would ever clean up; and **before** `revertArtifacts`
(`:601`), so the state directory can be removed when it is otherwise empty. **Leaving a secret behind
after the product is gone is worse than losing fingerprint comparability.** DOS-P7 inherits this as a
known exception rather than reading its own gate as violated; the row is `BACKLOG.md` §8.

`doctor` reports presence, type and mode with `lstat` and never a byte of the contents, warns for each
of the four unusable states by name, and repairs nothing (`apps/cli/src/commands/doctor.ts:676-700`).

### 8.2 Scope globs resolve at the handler boundary, and the contract keeps canonical names

`EFFECT_VOCABULARY` had `content/` and `_indexes` hardcoded, and this is the first subsystem that
resolves one against a real filesystem. Templating the globs inside the YAML contract was rejected: it
invents a substitution syntax in the workflow schema, needs a validator for it, and puts a
configuration value inside a document whose whole purpose is to be comparable across installs.

**Taken instead:** the contract keeps canonical vault-relative names, and `resolveScopeGlob`
(`packages/workflow-schema/src/vocabulary.ts:291-304`) rewrites the leading `content` segment to
`config.contentRoot` and an immediately-following `_indexes` segment to `config.indexesDir`. Both
substitutions are **pinned to a position** — `content` at index 0 only, `_indexes` at index 1 only and
only when index 0 was `content` — so a vault folder literally named `content` nested under `staging/`
cannot be corrupted, and every root is glob-escaped and NFC-normalized before it is spliced in.
`ingest` resolves its declared scopes through it once per invocation (`ingest.ts:1460`), against
`INGEST_DECLARED_WRITE_SCOPES` (`:168-171`), which `ingest.test.ts` pins against
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
unknown frontmatter key at `info` (`packages/brain/src/schema/note.ts:399-407`) and `parseCaptureFile`
never recomputes the id, so **one document can satisfy both the note parser and the capture parser** —
and the model's own output re-enters the pipeline as an `accepted` capture, with the human review step
skipped.

The fix gives the destination the canonical twin `generatedOutputConsistency` already had:
`privateRootsCanonical` is measured with `containsPathLoosely` because this branch **denies** rather
than grants, and the destination's own segments are folded and checked too, because neither subsumes
the other (`packages/brain/src/ingest/validate.ts:641-690`, with the reasoning at `:524-534`).
Evidence: `packages/brain/src/ingest/validate.test.ts:817` — "refuses a path whose case differs from the private folder it
resolves into" — and `:827`, the in-vault symlink.

**Its twin closed `BACKLOG.md` §1 NEW-14.** `resolveCapturePath` compared the canonical quarantine
root and the canonical target **against each other, never against the content root**, so a quarantine
directory replaced by a symlink carried its own containment check with it. `capture` — the command
that *writes* the observation — had no such check at all. All three commands now prove the quarantine
root inside the configured content root once per run through one shared implementation
(`apps/cli/src/context.ts:263-305`), each injecting its own refusal so the exit code and recovery text
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

**Two findings were registered rather than fixed** — `BACKLOG.md` §1 **NEW-19** and **NEW-20**, both
in §10 below with their owners.

---

## 10. The residuals this subsystem leaves, each with an owner

### 10.1 Registered in `BACKLOG.md` §1

| | Owner | Shape |
|---|---|---|
| **NEW-21** — one successful `codex exec` completion is still owed | the founder, because it spends their credits | S. Task 17 ran on 2026-08-15 and the account's usage limit was exhausted, so it settled the JSONL framing and the discriminating `type` field and **not** the terminal-event rule, and observed no Codex environment. One run closes both halves; until it lands, `finalJsonlLine` stays provisional and every capture taken inside a Codex session records `sourceAgent: "unknown"` |
| **NEW-20** — `capture` proves its quarantine root, then follows the declared path again | DOS-P7 by default | XS, security, **theoretical**: it needs a won race and is not a regression. The declared path is the contract — it is what `CaptureResultV1.path` publishes — so closing the window means the two paths disagreeing inside one function. `threat-model.md` §5.2 describes it |
| **NEW-19** — `reindex` builds its owned root textually, as `capture` used to | DOS-P7 by default | XS, security. Replace `content/_indexes` with a link out of the vault and the four generated artifacts are written there: vault metadata disclosure, not capture text. **Traced by reading, not driven** — no test exists, so it is not demonstrated the way `tests/security/symlink-escape.test.ts` demonstrates the other two. The fix already exists one directory over (`apps/cli/src/context.ts:263-305`) |
| **NEW-15** — nothing that executes a discovered binary pays the check its own type demands | DOS-P7 by default | S, security. `packages/platform-macos/src/types.ts:13-18` states that whoever executes a discovered binary owes an owner and mode check; `ingest` spawns `discovery.executablePath` with no `stat`, no uid and no mode comparison. **`capture` joined it on 2026-08-15**, when Task 17's Claude row made `discoverSourceAgent`'s probe path live — narrower there, since a `--version` probe is handed no observation and no vault path, but unchecked on the same terms and on a far more frequently run command. Not privilege escalation — it hands that binary the captured observations and read access to the whole vault on the strength of a name match |
| **NEW-16** — spec §8.2's user-configured redaction patterns are unreachable | DOS-P7 | S. `redactText`'s `userPatterns` parameter has no production caller, and `configSchema` is `.strict()` with no redaction table, so there is no key a user could set even if one existed. **Nothing regressed; it was specified and never wired** |
| **NEW-17** — `brain` is the one command whose config parse failure is not content-free | DOS-P7 | XS, security. Seven of eight commands route through `readConfigFile`; `brain` does not, and smol-toml puts three raw source lines into the message the heuristic redactor then has to catch alone |
| **NEW-18** — `assertSafeCommand`'s four NUL branches have no test anywhere | whoever next touches `packages/security/src/process.ts` | XS. **The guard is correct; only the evidence is missing** |
| **NEW-12** — the argv screen's word list also screens a value nobody chose | **closed 2026-08-17** by Track R entry R2 | XS, security-adjacent. Closed in two halves and **not** by narrowing the pattern, which the row forbade: the prose half on 2026-08-15 (`screenProseArgument` for the prompt), the path half on 2026-08-17 (`screenDerivedPathArgument` for `workingRoot` and `outputSchemaPath`, which this product assembles). The word list is byte-identical and each of its three alternatives is now guarded by a sample that isolates it. **Two residuals:** `ingest` can no longer produce a screening refusal at all, so `invokeVendor`'s refusal-detail interpolation is unreachable in production and uncovered end-to-end; and the first caller to pass a real write scope will hand a derived path to the screen that still carries the word list, re-creating the defect one field over |
| **NEW-11** — the invisible-title rule stops at `title` | **closed 2026-08-17** by Track R entry R2 | S. `tags` and `summary` now carry NEW-10's predicate as a **lint warning** — the note still indexes — and `duplicates` keys on a perceptual grouping key rather than on that boolean. `isBlank` moved to `packages/security/src/text.ts` rather than being copied. **Two residual rows, plus accepted consequences:** NEW-30 (`aliases` is the fourth field with the same gap) and NEW-31 (a stray U+200D still hides a duplicate, because the joiner is deliberately exempt). The accepted consequences — an emoji grouping with its text presentation, and two others — are enumerated in `text.ts` rather than carried as rows |
| **NEW-13** — two artifact roots share one type | DOS-P6 Task 4's nominal brands | **the brands shipped and the `@ts-expect-error` case pins them**, but `BACKLOG.md:265` still reads `Status: open` — Step 5 of this plan's Task 19 is what closes the row. If those two ever disagree, the tree is the answer |

### 10.2 The four Foundation requests `ORDER.md` carries

**No DOS-P6 task extends `packages/core/src/transactions/` or `packages/core/src/result.ts`**, which
is where every one of these lands. Two tasks did reach `packages/core` — Task 3 owns
`packages/core/src/capabilities/index.ts` and Task 4 owns `packages/core/src/agent-prompt/index.ts`,
both in the plan's own file-structure table — so the reason none of these was done here is that they
are executor and result-type changes nobody's file list named, not that the package was untouchable.
They are stated in `ORDER.md` in full; the arithmetic is what matters here.

1. **and 2. An optional caller-supplied precondition on `PlannedFileMutation`**
   (`ORDER.md:139-155`). The executor computes `expectedBeforeHash` from the snapshot it takes when
   `execute()` runs, so a command cannot supply one. It costs `capture` the `O_EXCL` create spec §5.2
   describes — tolerable there, since the id is the content hash and colliding captures are
   byte-identical — and it costs `review --decision edit` a read-to-execute window in which **the
   discarded content is the user's own hand edit**. **Counted as two of the four and raised as one
   pair**, because a session that fixes one and not the other has fixed neither.
3. **Prune the transaction backup on `finalize`** (`ORDER.md:157`, "a third Foundation request").
   `review --decision edit` removes a secret from a vault file and `TransactionExecutor.backUp` writes
   the pre-edit file raw to `~/.developer-os/backups/transactions/<id>/0.bin`, where nothing removes
   it. `rollbackLocked` throws on a finalized journal, so after `finalize` those are dead bytes.
   **The user is told the secret is gone and a copy survives.** This is why
   `tests/security/sentinel.test.ts` does not sweep that directory: the suite would be right and would
   go red for something nobody in DOS-P6 could fix.
4. **A `data` slot on `CliError`, or a partial-success arm on `CliResult`** (`ORDER.md:185`, "a fourth
   Foundation request, and it is the cheapest of the four"). `ingest` processes a batch and contains
   each capture's refusal to that capture; when any refuses, the run ends on the failure arm and the
   per-capture outcomes ship as lines inside the error message — the precedent `brain lint` already
   set under the identical constraint. A consumer parses prose where it should read fields. It changes
   no existing caller, because nothing populates a field that does not exist yet.

**One repository item sits beside these and is not one of them, because its measured fix is already
applied.** `apps/cli/src/commands/doctor.test.ts:195` needs 3.19 s of a 20 s budget on an idle machine
and reddened in five of six full runs once the security suites joined it; `fileParallelism: false`
(`tests/vitest.config.ts:50`) made four of four runs green and dropped total test time from roughly
1000 s to 700 s. **What stays open is the fragility, not a change**: a case one contended run from red
is a gate one contended run from uninformative, and it is unowned. The `ENOTEMPTY` seen during fixture
cleanup in two of those runs is a separate filesystem race that serialization may only have made
rarer; it is unmeasured and possibly still live.

### 10.3 One product gap, and the obligation Task 17 leaves

**`applyReviewDecision` permits a decision only from `quarantined`, so nothing moves a capture from
`accepted` to `rejected`** (`packages/brain/src/review/decide.ts:36`). A user who accepts a capture and
changes their mind — or whose capture refuses ingest deterministically — has only a hand edit of the
frontmatter, which is what both of `ingest`'s recovery strings tell them to do. Adding the transition
is a decision about spec §5.5's table, not a bug fix. **Owner: DOS-P7.**

**Task 17 — one real run per vendor — ran on 2026-08-15, and settled about half of what it owed.**
The founder authorised the spend. Claude answered; **Codex's account had exhausted its usage limit**,
so every `codex exec` ended `turn.failed` and no run reached a model response. What that run did and
did not settle:

| Obligation | State |
|---|---|
| `--json` really is JSONL, one JSON object per line | **confirmed**, four lines, none scalar or `null` |
| whether the stream carries a discriminating field worth filtering on | **confirmed: `type`**, on every line. Observed vocabulary `thread.started`, `turn.started`, `error`, `turn.failed` — *not* the `session.created` / `item.completed` / `turn.completed` the synthetic tests had guessed |
| whether a **successful** turn's terminal event is the final response | **still open.** A failed turn cannot answer it, so `finalJsonlLine` stays provisional and its docblock says so |
| the Codex `AGENT_DETECTION_ROWS` row | **still open**, and absent rather than guessed |
| the Claude `AGENT_DETECTION_ROWS` row | **observed**, `CLAUDECODE=1` |

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
what was redacted. **What remains open is `BACKLOG.md` §1 NEW-21**, and one successful `codex exec`
completion closes all of it. Separately and untouched by this run: the Claude scoped-permission form
`claude-adapter.md` §14.3 names but does not specify is still unresolved, which is why `ingest` passes
bare tool names (`apps/cli/src/commands/ingest.ts:187-194`).

**Task 17's diff needs its own security pass.** The independent review covered Tasks 1–18 only, and
this diff changes an adapter's stdout-parsing documentation and a detection table on the capture path
— the two places a vendor's real output first meets this product.

### 10.4 Open items the design of record did not close

**Spec §13 has six, not three**, and all six are stated here with their disposition, because that
section is the last word on what the approved design left open.

| Spec §13 | Disposition |
|---|---|
| 1. `buildConflictEvidence` still has no consumer | **open.** Both adapters declined the design it was built for; it waits for the first subsystem with a real three-way merge, which is not this one |
| 2. the Codex supported floor is one observed version, not a range | **open.** Owner: DOS-P9 |
| 3. a re-rendered plugin tree may not be a re-loaded one — Codex resolves skills through a cache copy | **open.** Owner: DOS-P7, whose update lifecycle re-renders in place |
| 4. `NEW-11` and `NEW-12` are repository defects rather than pipeline ones, and are not taken here | **both left this subsystem and were decided elsewhere, which is what this row predicted.** `NEW-12` is **closed** — its prose half by Task 19's review on 2026-08-15, its path half by Track R entry R2 on 2026-08-17, and §10.1 carries the two residuals it left. `NEW-11` was decided by the founder on 2026-08-17 (an invisible tag is a lint warning) and is implemented by that same entry |
| 5. line-wrap drift wants a repository formatting decision, not a hand pass | **open and unowned.** No decision was taken here, and nothing in this subsystem's scope could take one — it is a repository-wide formatting question, and this is the only place it is written down outside the spec |
| 6. automatic capture is not designed, only declined | **decided, not deferred**, and §2 above is the substance. If a future version wants it, the honest route is a documented, stable transcript contract with a regression fixture landing in the same change — the condition both adapter specs already set for lifting the refusal. Nothing in this subsystem weakened it |

---

## 11. What the evidence is worth

`tests/security/` holds **eight suites and 85 cases**, and **38 of them carry no watched-failure
demonstration.** The split, its derivation, and the fact that the per-suite breakdown cannot be
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
| the workflow contract, `extends`, and the declared-versus-derived scope arithmetic | `docs/architecture/workflow-schema.md` |
| the capability model — two gates, three values, recorded twice on purpose | `claude-adapter.md` §3, `codex-adapter.md` §3 |
| per-vendor residuals with owners | `codex-adapter.md` §11, `claude-adapter.md` §9 |
| transactions, ownership, exit codes, and what Foundation deliberately cannot do | `docs/architecture/foundation.md`, `foundation-constraints.md` |
| the design as approved, before implementation corrected §6.1 and §9 | `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md` |
