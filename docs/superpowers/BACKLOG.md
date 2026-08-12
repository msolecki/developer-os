# Developer OS — Outstanding Work Backlog

> **Starting a session? `SESSION.md`. Looking for what to do next? `ORDER.md`.**
> Three files, one job each: `SESSION.md` is the procedure, `ORDER.md` is the queue, and
> this one is the reference — what each outstanding document must contain and why it
> exists.

Single index of everything that still has to be done, for this product and for the
founder's legacy runtime. Consolidated on 2026-07-27 from the founder's two legacy
repositories; neither of those holds plans, specs, or open roadmap items any more.

**Reconciled against the code and against both legacy trees on 2026-08-08.** Finished work
was removed rather than ticked: what stays is what somebody still has to do, plus the
constraints and lessons that outlive the work that produced them. Two findings from that
pass are open items — §1 — and the legacy checklist gained one and shed most of another, §6.
Anything deleted is in git history; where a deletion carried something durable, the
replacement text says where it went.

**Rules for this file**

- Order lives in `ORDER.md` and detail lives here. When they disagree about sequence,
  `ORDER.md` wins; when they disagree about content, this file wins. Never copy a
  requirement into `ORDER.md` — link to the section instead.
- Every new plan or spec is registered here in the same change that creates it, and gets a
  row in `ORDER.md` in that same change.
- Status values: `done`, `in progress`, `open`, `blocked`, `decision required`.
- A step is `done` only when its own evidence exists. A passing local tree is not
  evidence; a commit is.
- **`plans/` holds only unfinished work.** When a plan's last step is done, delete the file
  in the same commit that closes it, after carrying any evidence a later step still needs
  into the document that needs it. Git history is the archive — do not keep a `completed/`
  or `archive/` directory.
- **A spec outlives its plan.** While a subsystem is unfinished its spec is the reference
  for review and drift checks. After it ships, the spec is retained only while another
  document still points at it as the design of record — the kernel-lock spec is the one
  case (§8) — and its status line must then say so, in the past tense.
  **One spec is exempt because the rule's unit does not fit it.** The product design spec
  specifies eight subsystems at once, so no single status line could be truthful: Foundation
  has shipped, DOS-P2 is in progress, DOS-P3 through DOS-P9 are unbuilt. It carries per-section
  markers instead — §8, §9.1 and §9.3 each say what actually shipped — which is finer
  granularity than this rule asks for. Do not give it a global past-tense status line, and do
  not treat it as a deletion candidate while any subsystem it specifies is unbuilt.
- **Four deleted plans and two stripped ones, all in git history.** Deleted whole: the
  brain/claude-shared English migration (`28a0ddc`), the kernel transaction lock (`cf70342^`),
  Foundation (`c4f883f^`), and the DOS-P3 workflow compiler (`a47e965`). A deleting commit does
  not contain the file it deleted, which is what the `^` suffixes mean; `a47e965` is written
  without one because it is already the last commit that *contains* the plan. Stripped in part: the program plan's Tasks 0–1 and the Brain plan's Tasks 1–2, both
  recoverable at `9f82901`, which is the commit that added the superseding notes rather than
  one that removed anything.
- `docs/superpowers/plans/legacy-runtime/` is publication-excluded and, since 2026-08-10,
  **empty** — its one document closed and was deleted. The exclusion stands for anything
  written there again.

---

## 0. Status at a glance

Open work only. Program Tasks 0 to 3 are closed and are not rows here.

| Area | Where | What is left |
|---|---|---|
| Program (umbrella) | 1 plan | Tasks 4–9 open; Tasks 0–3 closed and not rows here |
| DOS-P5 … DOS-P7 | DOS-P5 is **3/18 implemented**; DOS-P6 and DOS-P7 have no documents yet | 2 specs, 2 plans, 3 implementations |
| DOS-P8 cutover, DOS-P9 release | program plan Tasks 8–9 | every artifact; one open decision each |
| Repository-level | §1 | NEW-7 (XS, needs a machine with Obsidian), NEW-11 (S, the invisible-title rule stops at `title`) and NEW-12 (S, the argv screen's word list also screens free-form prose) |
| Repository infrastructure | §5 | two directories a later subsystem still owes; `packages/adapter-claude/`, `plugins/claude/` and `tests/integration/` landed with DOS-P4 on 2026-08-11 |
| Legacy runtime | §6 | **nothing** — closed 2026-08-10, checklist deleted; §6 is what a cutover still needs to know |
| Outside this room | `ORDER.md` Track L | license approval, remote verification |

**Foundation, DOS-P2 and DOS-P3 are closed.** None is a row above. What each left behind is
`docs/architecture/foundation.md`, `docs/architecture/brain.md` and
`docs/architecture/workflow-schema.md`, plus §2 here for Foundation's open questions; their plans
are deleted and git history is the archive. DOS-P3's note is the one to read before either
adapter — its §7 records four canonical workflows that say less than the product spec does, each
with an owner, and its §8 records nine residuals — two of them explicitly the adapters',
the rest unowned until somebody needs them.

**This repository is public, deliberately, as of 2026-08-10.** It was pushed to
`github.com/msolecki/developer-os` and the founder confirmed the visibility after being shown
what §6 discloses. Two consequences worth knowing before writing anything here:

- **`docs/superpowers/plans/legacy-runtime/` was published** for the days it existed alongside
  a remote, despite its own header calling it publication-excluded. Deleting it on 2026-08-10
  does not un-publish it — git history is public too — which is why §6 now states what that
  document disclosed rather than relying on the file being gone.
- **The self-containment lint does not guard this.** It allowlists that directory by design —
  it exists to stop an agent *reading* the founder's machine, not to stop the repository
  *publishing* what was already written down. Nothing was bypassed; there was never a check
  here. If publication control is ever wanted, it is a new rule, not a fix to that one.

**Self-containment.** No Developer OS task reads the founder's legacy runtime. Program
Task 0 froze everything the build needs into `docs/migration/`, and since 2026-08-01
`npm run lint` fails on any reference to those paths outside a named allowlist — over
tracked *and* untracked files. The only remaining contact with the legacy machine is the
exit checklist in §6 and the read-only cutover in DOS-P8, both of which operate on the
founder's machine as user data, not as source material.

---

## 1. Open right now

Everything in this section is genuinely open. Nothing here is bookkeeping, and nothing
closed stays here — NEW-1 through NEW-6, NEW-8 and NEW-9 were removed on 2026-08-10 when
they closed, and NEW-10 on 2026-08-11. What a closed item leaves behind is a row in §8, a clause in a spec, or a test;
if it left nothing, it was not worth recording. Git history is the archive.

### NEW-11 — the invisible-title rule stops at the title

- **Status:** open, found 2026-08-11 by the review that closed NEW-10 · **Owner:** the next task
  touching `packages/brain/src/indexes/render.ts` or `packages/brain/src/lint/lint.ts` — DOS-P6 by
  default · **Size:** S
- NEW-10 gave `title` a predicate that means *at least one visible character*. **Two neighbours
  did not get it**, and both surface the way NEW-10 did — a rendered row that says nothing:
  - **`tags`** is validated as a string array and nothing more, so `tags: [""]` and
    `tags: ["\u200B"]` both pass. The tag cloud then renders `-  (3)` — two spaces, a count
    attached to no label — and the folder table's "Top tags" cell gets an empty entry between
    commas.
  - **`summary`** is type-and-length only. `summary: "\u3164"` renders `- [Title](<path>) — ㅤ`,
    a dangling em-dash. Cosmetic, unlike the tag case.
- **The `duplicates` key has the older, narrower definition.** `lint.ts` keys on the *screened*
  title, and the screen deletes `\p{Cf}` only — so `Deploy keys` and `Deploy\u3164keys` produce
  different keys and no duplicate is reported, while `catalog.md` shows two rows a human reads as
  identical. That is precisely the failure NEW-6 was opened for, one character class over.
- **It is two fixes, not one, and the reviewer's correction is worth carrying.** `tags` and
  `summary` want the *boolean* NEW-10 already wrote — move `isBlank` out of `note.ts` to
  `packages/security` when that second call site appears, rather than copying it, which is the rule
  that module's own header states. The duplicates key wants something `isBlank` cannot give: a
  **perceptual grouping key**, a third function returning a string with invisibles removed and
  marks untouched. Anyone who starts by reaching for `isBlank` there has started wrong.
- **Do not fix either by widening the display screen.** `screenControlCharacters` must not delete
  non-spacing marks: it would corrupt every accented and every Indic title it touches.
- **A cheap interim exists for the half that is user-visible.** A `frontmatter`-class lint finding
  for a blank tag needs no renderer change and no new module, and it does not prejudge the policy
  question the full fix has to answer — whether an invisible tag is an error, a warning, or
  silently dropped at index time.

### NEW-12 — the argv screen's word list also screens free-form prose

- **Status:** open, found 2026-08-12 by the fresh-context review of DOS-P5 Task 3.5 · **Owner:**
  whichever subsystem first gives `agent.prompt` a production caller — DOS-P6 by default ·
  **Size:** S
- `screenValueArgument` in `packages/security/src/cli.ts` applies **two** rules to every value
  reaching a vendor CLI: a *positional* one (nothing may begin with `-`, so it cannot be reread as
  an option) and a *nominal* one (nothing may match `/permission|danger|bypass/iu`). Both are
  applied to `invocation.prompt`, which is free-form prose written by a workflow author.
- **Only the positional rule is load-bearing for a prompt.** Prose cannot be reinterpreted as a
  CLI option, so the word list buys nothing there while refusing legitimate text — a prompt asking
  a model to "check for dangerous patterns" is refused, and the workflow's failure is a `refused`
  with a message about permission surfaces.
- **Not a regression and not reachable today.** The narrower `/permission|dangerous/iu` that
  shipped with DOS-P4 refused that same sentence, and `invokeClaude` has no production caller —
  only tests construct an invocation. Task 3.5 widened the pattern to `danger`, which enlarges the
  false-positive surface without changing the shape of the problem.
- **The fix is to split the screen by position, not to narrow the pattern.** An argument that
  *becomes* a flag if it looks like one (a tool name, a directory, a sandbox mode) needs both
  rules; a terminal prose argument needs the dash rule alone. Narrowing the word list instead
  would weaken the values that do need it, which is the direction DOS-P5 Task 12 exists to
  prevent.

### NEW-7 — a link destination's percent-encoding is unverified against Obsidian

- **Status:** open, needs a machine with Obsidian · **Owner:** the founder, or DOS-P6 ·
  **Size:** XS to check, S if it fails
- `linkTarget` percent-encodes a control or format character in a vault path so that
  `catalog.md` carries no raw override while the link still resolves. CommonMark
  percent-decodes a destination and that half is checked. **Whether Obsidian's resolver does
  the same for a local vault path is not**, because this repository has no Obsidian to ask.
- Only a path containing such a character is affected, which is pathological and rare — but
  note the stakes moved when the encoding went in. Before it, a control character in a path
  produced a link that resolved and merely looked wrong; now correctness depends on the
  consumer decoding. If Obsidian does not decode, such a link is **broken** where it
  previously worked. The fallback is then to refuse the path at lint time — *not* to go back
  to emitting the raw byte, which is the defect that motivated the encoding.
- **`%` is encoded too**, which is what makes the mapping reversible, and it is why this is
  worth ten minutes with any Markdown preview rather than being left indefinitely: `%` in a
  filename is ordinary where U+202E is not, so the encoder now touches common paths.
- Recorded rather than assumed, and stated at the call site too.

### L1, L2 — outside this environment

An OSI-approved license reviewed by qualified counsel, and remote verification. Both are
recorded in `ORDER.md` Track L, both gate public release, and both depend on somebody who
is not in this room. Neither is engineering work.

---

## 2. Foundation — what it left open

**Foundation closed on 2026-08-01** and its gate evidence is not repeated here; it is in
`docs/releases/foundation-checkpoint.md`, dated. This section holds only the three things it
left behind that are still somebody's decision or somebody's work.

Read these instead of this section for anything else:

| Document | What it holds |
|---|---|
| `docs/architecture/foundation.md` | what the layer is, its boundaries, the mutation pipeline, exit codes, what it deliberately cannot do, and nine known residuals |
| `docs/architecture/foundation-constraints.md` | the verbatim per-task constraints, including **two open founder questions** under Task 5 |
| `docs/releases/foundation-checkpoint.md` | the gate evidence, dated 2026-08-01 — a historical record, not a live status page |

**The two open founder questions are still open.** Whether `SpawnLockfRunner` needs a
watchdog around the non-blocking `lockf` call, and whether `<state>/transactions/`
accumulating one permanent `0600` lock file per transaction id is intended or wants
collection. Neither blocks anything; both are decisions nobody has made.

**One thing Foundation built and nothing consumes.** `buildConflictEvidence` and its
unified-diff machinery in `packages/core/src/manifest/drift.ts` are implemented and
unit-tested, and no command calls them. That is deliberate — the first consumer is the
semantic config merge in DOS-P4/DOS-P5 — but a later reader should not mistake unused for
untested, or unused for dead.

**That sentence is amended, by the Claude adapter spec approved 2026-08-11** (§8). Its §4.3
dissolves DOS-P4's half of the merge rather than answering it: a skills-directory plugin writes no
foreign config file, so DOS-P4 has nothing to three-way merge and leaves `buildConflictEvidence`
uncalled. DOS-P5 may still need it — Codex's documented surface includes `AGENTS.md`, which is
shared in a way `~/.claude/skills/developer-os/` is not.

**Residual 9 is owed by DOS-P7**, and it is the one residual that makes a shipped feature
unusable rather than merely rough: configuration cannot be changed after `init`. Detail with
that subsystem in §3.

---

## 3. Missing specs and plans

**Four documents left.** DOS-P6 and DOS-P7 need a spec and a plan each. DOS-P5 needs neither — its
spec was approved and its plan written on 2026-08-11, so what remains of it is the code.
DOS-P4 is closed and is not listed here any more: its spec is retained at
`specs/2026-07-21-developer-os-claude-adapter-design.md` because
`docs/architecture/claude-adapter.md` names it as the design of record; its plan is deleted,
recoverable at `17968cb`. **Read the architecture note before either remaining adapter task** —
its §4 records why in-place discovery beat a marketplace copy, and its §9 the twelve residuals
DOS-P4 leaves behind, six of them DOS-P6's.
DOS-P3 is closed and is not listed here any more: its spec is retained at
`specs/2026-07-21-developer-os-workflow-compiler-design.md` because
`docs/architecture/workflow-schema.md` names it as the design of record; its plan is deleted,
recoverable at `a47e965`.
Each subsystem after Foundation requires an approved spec **and** an implementation plan
before any code work — this is a Global Constraint of the program plan, not a preference.
Every spec starts with a brainstorming/approval cycle, and approval is the founder's.

DOS-P2 is not listed here any more. Its spec is retained at
`specs/2026-07-21-developer-os-brain-engine-design.md` because `docs/architecture/brain.md`
names it as the design of record; its plan is deleted, recoverable at `81e7e7d`.

### DOS-P5 — Codex adapter

- **Spec:** `specs/2026-07-21-developer-os-codex-adapter-design.md` — **approved by the founder
  2026-08-11.** It settles the install shape (a local marketplace registered and installed by
  Codex's own CLI, which never edits `~/.codex/config.toml`), capture against the hook trust gate,
  the `AGENTS.md` decision, and the transcript refusal. Its §14 is normative — an implementation may
  not depend on a Codex surface not listed there. §12 is the table DOS-P6 inherits; §15 carries five
  items it does not close
- **Plan:** `plans/2026-07-21-developer-os-codex-adapter.md` — written 2026-08-11, eighteen tasks,
  **3/18 done on 2026-08-12**, resume at Task 4. Tasks 1 to 3 closed four residuals
  `claude-adapter.md` §9 assigned to "the point where a second adapter exists"; their step lists
  are deleted and the plan carries what they produced. Both decisions they raised are ratified
  and discharged in §8 of this file
- **Program task:** 5 · **Complexity:** L · **Blocked by:** nothing
- **Produces:** `CodexAdapter`, `CodexCapabilities`, `CodexInvocation`, `plugins/codex/`,
  managed hook plans, structured agent-run results.
- **Gate:** direct and wrapper capability matrices are tested separately; a missing
  capture hook is classified `wrapper-required`, never a false `yes`.
- **Absorbs:** legacy follow-up Step 8 (`Add stable Codex learning capture`), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.
- **Read `docs/architecture/claude-adapter.md` before writing the plan.** The two adapters are
  consumed by one subsystem, and three of its residuals come due the moment a second one exists:
  the duplicated code-point sort (§9.5), the absent `ClaudeAdapter` façade (§9.6), and
  `detectWorkflowDrift` reporting only in one direction, which the Codex drift gate will also have
  to compensate for.
- **There is no legacy Codex implementation to compare against.** The founder's legacy runtime
  removed its Codex parity layer on 2026-07-27, after `baseline-capabilities.json` froze that
  surface on 2026-07-21. The frozen record is the only admissible statement about it, and the plan
  must not schedule an observation of something that no longer exists.

### DOS-P6 — Knowledge pipeline hardening

- **Spec:** `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-knowledge-pipeline.md` — missing
- **Program task:** 6 · **Complexity:** L · **Blocked by:** DOS-P4 **and** DOS-P5
- **The spec must decide:** exact capture fields, lifecycle transitions, retention
  behavior and redaction classes; atomic quarantine writes with post-redaction
  deduplication; accept/edit/reject review with no automatic deletion; the contract that
  marks all source material as untrusted data and restricts agents to staging-only writes.
- **Required tests:** sentinel secret, prompt injection, symlink escape, multiline
  command, malformed manifest, interruption at every phase.
- **Produces:** complete `CaptureEnvelopeV1` transitions, `ReviewDecision`,
  `IngestProposal`, `IngestValidationResult`, `ApplyResult`, recovery commands. DOS-P2
  defines the envelope as a type and writes none of them.
- **Gate:** the same secret sentinel is absent from capture, logs, hashes, model input,
  staging, reports and canonical notes; model output cannot widen write scope; failure
  leaves the capture retryable and never marks it ingested. Independent security review
  is required before the checkpoint.
- **Absorbs:** legacy follow-up Steps 5, 7, 9 and 12, frozen on the legacy runtime
  2026-07-27 and rebuilt here instead.

### DOS-P7 — Git, automation, update and release lifecycle

- **Spec:** `specs/2026-07-21-developer-os-lifecycle-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-lifecycle.md` — missing
- **Program task:** 7 · **Complexity:** L · **Blocked by:** DOS-P6
- **The spec must decide:** Git initialization, existing-remote connection, scoped
  staging, commit, push and every error state; the exact `launchd` jobs, schedules, logs,
  lock ownership and opt-in boundaries; signed/checksummed release metadata; dry-run
  updates; schema-migration staging and rollback.
- **Produces:** `GitSyncConfigV1`, `AutomationConfigV1`, `LaunchdPlan`, `UpdatePlan`,
  `SchemaMigrationPlan`, verified uninstall/rollback results.
- **Gate:** a Git-disabled and automation-disabled install performs no related process or
  network call; push failure never records a successful sync; update refuses drift;
  uninstall removes only manifest-owned artifacts.
- **Absorbs:** legacy follow-up Step 6 (real-Git integration coverage), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.
- **Must also close Foundation residual 9.** Configuration cannot be changed after `init`:
  `config.toml` is a hash-tracked managed artifact and no command edits it, so changing
  `git.enabled` or `automation.enabled` today means hand-editing a file that then drifts
  the manifest and makes `init`, `doctor` and `uninstall` all refuse. A lifecycle task that
  ships opt-in commands without a way to record the opt-in ships a dead end. Detail in
  `docs/architecture/foundation-constraints.md`, "Found after Foundation closed".

---

## 4. Program tasks 8 and 9 — artifacts, and one open decision

### DOS-P8 — Founder shadow migration

- **Status:** open · **Blocked by:** DOS-P7, and by all four Track B items
- **Artifacts required (none exist):** `docs/migration/founder-cutover.md`,
  `founder-baseline-results.json`, `founder-shadow-results.json`,
  `founder-cutover-manifest.json`.
- **Decided 2026-08-10 by the founder: author a dedicated plan.** The program plan enumerates
  ten steps inline and mandates neither a spec nor a plan; the ruling is that this task gets a
  plan regardless, because it is the only one that mutates the founder's live machine and its
  rollback must be rehearsed before cutover is declared complete. **Written against A11's
  output, not before it** — a cutover plan authored ahead of the lifecycle it cuts over to
  would specify commands that do not exist. No spec is required; the program verification
  matrix and the hard invariants below are the contract it plans against.
- **Hard invariants:** the founder's vault is not moved; legacy recovery data is not
  deleted; two copies of a mutating hook are never enabled at once; legacy hooks and jobs
  are disabled only after new evidence passes, and are never deleted.

### DOS-P9 — Public beta and v1

- **Status:** blocked · **Blocked by:** DOS-P8
- **Artifacts required (none exist):** `README.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, approved `LICENSE`, `docs/install/`, `docs/tutorials/`,
  `docs/troubleshooting/`, `docs/privacy.md`,
  `.github/workflows/{ci,release}.yml`, Homebrew formula source, macOS Apple Silicon and
  Intel packaging configuration. `docs/releases/` already exists — this task adds release
  notes to it rather than creating it.
- **Owes the pre-publication secret re-scan** recorded as a gate in §7. The repository now
  carries legacy machine detail it did not carry when Program Task 0 produced its evidence,
  so Task 0's clean result does not transfer.
- **Decision required, and it is no longer "the same as DOS-P8".** No dedicated plan is
  mandated here either, but DOS-P8's version of this question was settled on 2026-08-10 in
  favour of writing one, on a reason that does not apply to DOS-P9: DOS-P8 mutates the
  founder's live machine and DOS-P9 publishes a release. The program verification matrix is
  probably sufficient here; confirm before starting rather than inheriting DOS-P8's answer.
- **Two external blockers that are not engineering work:** L1 license and L2 remote
  verification, both in `ORDER.md` Track L.

---

## 5. Missing repository infrastructure

Named in the program file map, not yet created. Each is created by its first owning
subproject; listed here so nothing is discovered late.

| Path | First owner | Status |
|---|---|---|
| `tests/fixtures/workflows/` | DOS-P3 | **created 2026-08-10** — the seven synthetic negative fixtures, one change from the base each |
| `tests/contracts/` | Foundation onward | **created 2026-08-10** by DOS-P3 — `workflows/{canonical,negative,determinism}.test.ts`, 16 cases. DOS-P2 had put its contract cases beside the code they pin instead |
| `tests/fixtures/` | Foundation onward | **created 2026-08-08** |
| `tests/fixtures/brain/legacy-shape/` | DOS-P2 Task 3 | **created 2026-08-08**, plus eight one-concern `malformed/` fixtures for lint |
| `tests/integration/` | Foundation onward | **created 2026-08-11** by DOS-P4 — `claude/plugin-loads.test.ts`, six cases against a real installation in a disposable `HOME`, skipped where no agent exists. DOS-P2's reindex/lint/search integration still runs in `tests/e2e/brain.test.ts` against the compiled binary, which is the stronger of the two |
| `tests/e2e/` | Foundation Task 9 | **created 2026-08-01** — `pnpm test:e2e` runs 45 cases across `foundation.test.ts` and `brain.test.ts` |
| `tests/security/` | DOS-P6 | missing |
| `docs/architecture/` | Foundation Task 9, then per subsystem | **created 2026-08-01** — Foundation boundaries and constraints done, Brain and the workflow schema done; threat model and capability model still owed by later subsystems |
| `docs/releases/` | DOS-P7 | **created 2026-08-01** by Foundation Task 9, ahead of its named owner |
| `packages/brain/` | DOS-P2 | **complete 2026-08-10** — `schema/`, `discovery/`, `indexes/`, `lint/`, `retrieval/`, `migrations/`, `service.ts`, and `redact.ts` as a re-export of the screen that moved to `packages/security` in DOS-P3 |
| `packages/workflow-schema/` | DOS-P3 | **complete 2026-08-10** — `parse`, `contract`, `vocabulary`, `derive`, `validate`, `overlay`, `load`, `drift` |
| `packages/adapter-claude/`, `plugins/claude/` | DOS-P4 | **complete 2026-08-11** — `discover`, `versions`, `probe`, `capabilities`, `render`, `plugin`, `compose`, `install`, `invoke`, and the six generated skills. `tests/tools/render-claude.ts` regenerates the tree; `docs/architecture/claude-adapter.md` is what replaced its plan |
| `packages/adapter-codex/`, `plugins/codex/` | DOS-P5 | missing |
| `templates/brain/` | DOS-P2 | **created 2026-08-10** — the vault skeleton `init` installs, embedded in `apps/cli/src/commands/brain-template.ts` so a shipped binary carries it, with a test that fails if the two drift |
| `workflows/` | DOS-P3 | **created 2026-08-10** — the six canonical workflows |
| `.github/workflows/` | nobody owed it — **that was the finding** | **created and verified green 2026-08-10** — `check.yml`, run `31377323072` on `macos-15`, both gate steps executed. The program file map never named it, so no subsystem owed it and it was nobody's job for twenty days |

**`tests/repository/` gained a second rule on 2026-08-10.** Beside the self-containment
enumerator there is now `control-bytes.test.ts`, which fails the build on a literal control
character in any tracked or untracked text file. It exists because this repository shipped two
— a NUL used as a map-key separator, and a ZERO WIDTH JOINER holding a comment's syntax
together — both invisible in every diff that carried them, both found by accident. It found
the second one within a minute of being written.

**Two directories exist that the program file map never named:** `tests/helpers/` (the
temporary HOME, the hash inventory, the process runner) and `tests/repository/` (the
self-containment rule, its allowlist, and the git-driven enumerator that `npm run lint`
runs). Both are Foundation output and both are now rows in
`docs/architecture/foundation.md` §1 — `tests/repository/` was added there on 2026-08-08,
having previously been documented only in `docs/releases/foundation-checkpoint.md` and in its
own source. Recorded here because §5 is read as the complete inventory of what does and does
not exist, and a map with a gap invites a second copy.

---

## 6. Legacy runtime — closed 2026-08-10

**The exit checklist is discharged and its plan is deleted**, per the rule that `plans/` holds
only unfinished work; recover it at `72f9c58` if the reasoning is ever needed. Nothing is
planned, scheduled, or in progress on `~/claude-shared` or `~/brain`. Both are frozen artifacts
running the founder's machine until the DOS-P8 cutover retires them, and **Track B no longer
gates A12.**

This section is no longer a worklist. It is what a cutover still has to know.

### What was decided, and must not be reopened by accident

**EXIT-1 — historical credential rotation — was declined by the founder on 2026-08-10.** Not
done, not deferred; decided against, in the same conversation that established this repository
is public and that this section therefore describes the unrotated candidate set to anyone who
reads it. Four things bound that decision:

- **No credential value is written anywhere in this repository.** What is public is the
  *status* of the candidates, not the candidates.
- **The obligation does not expire.** The original reasoning — that this is the one item whose
  consequence exists whether or not this product ever ships — was weighed and set aside, not
  shown to be wrong.
- **Nothing downstream depends on it.** It gated no sequence, and A12 never needed it.
- **Reopening it is a conversation with the founder**, never a task picked up from a backlog.

**The candidate set is a floor, not a total.** A 2026-07-19 triage recorded four rotation
candidates; a second scan on 2026-07-27 reported matches across six repositories; no
provider-side verdict was ever recorded for any of them. That second scan was produced by a
scanner with two known gaps — linked worktrees are skipped, and results truncate at twenty
matches without reporting how many were omitted. If a scan is ever the deciding evidence for a
rotation verdict, fix exactly those two gaps first. The founder's 2026-07-21 waiver scoped
*this product's* release gate; a waiver does not revoke a key.

### What changed on the founder's machine, and why a cutover cares

- **The global commit gate is no longer npm-only** (EXIT-2). It is a fail-closed ladder:
  `package.json` scripts, else the repository's documented suite, else the commit is blocked.
  Missing validation metadata stays a blocker. DOS-P8 inherits a machine where a compliant
  agent can commit in a non-npm repository, which was impossible for nineteen days.
- **The English guard stopped counting quoted material as prose** (also EXIT-2, and the reason
  it took a day rather than an afternoon). The corrected commit gate immediately blocked its own
  commit: the declared suite was failing on 173 findings, every one a raw capture in the
  language it was captured in — and *no automation ran the check*, so the red was invisible
  while the weekly job reported green. `content/_raw/**` is now out of scope, and a fenced
  block, an inline code span and a price in `zł` are verbatim contexts rather than prose. Six
  tests pin it, four of them negative.
- **Both trees are clean** (EXIT-3). Three `.bak.20260727-210611` files were deleted after being
  proved byte-identical to `ef4a972`; `docs/ROADMAP.md` was committed as the tombstone it had
  become. What remains untracked in the vault is one day of new captures awaiting the next
  scheduled run — user data, not work at risk.
- **The weekly job was not broken** (EXIT-4). It was recorded as failing on 2026-08-08 and the
  very next scheduled run, 2026-08-09, succeeded: hooks `PASS=49 FAIL=0`, plugin version
  consistent, 52 files committed and pushed, the entire capture backlog drained. The two fix
  commits that preceded the report had worked and nobody had waited for a Sunday to find out.
  **The lesson is the one this product exists for**: a job that reports only into a log nobody
  reads is indistinguishable from a job that is broken, in both directions.

**A live constraint DOS-P8 must not break.** The weekly job's preflight refuses pre-existing
changes under `content`, `AGENTS.md` or `README.md`. Any cutover step that edits the vault and
leaves the edit uncommitted will abort the next run — which is precisely how the 2026-08-02
failure in that log happened.

### The ten frozen items

Frozen 2026-07-27 as *will not do there*, each rebuilt as a Developer OS feature on synthetic
fixtures. The per-subsystem mapping is in §3, on the subsystem that absorbs each one — DOS-P5
takes Step 8, DOS-P6 takes Steps 5, 7, 9 and 12, DOS-P7 takes Step 6 — rather than duplicated
here, because two copies of a mapping is how they come to disagree. Full original text in
`28a0ddc`.

### Still on the machine, and not this repository's business

Several agent-written proposals await the founder's review inside the vault. They are private
Brain content, they are not repository inputs, and their paths are deliberately not recorded
here now that this repository is public.

## 7. Standing gates

Copied here so they are visible without opening the program plan.

| Gate | Evidence | Blocks |
|---|---|---|
| Repository validation | `npm run check` (`lint && test && build && git diff --check`), where `lint` is `tsc -b`, `eslint`, and the self-containment enumerator | every commit |
| Fresh-context review | a reviewing agent that is not the author, per code-producing task | every commit |
| Exact-path staging | never `git add -A`; stage only task-owned paths | every commit |
| Generated artifacts | clean regeneration diff | adapter commits, release |
| Security suites | sentinel, path, prompt injection, transaction, network | DOS-P6 onward |
| Publication secret re-scan | candidate-only scan over the whole tree, including the publication-excluded legacy paths this repository has carried since 2026-07-27 | public visibility |
| Agent compatibility | disposable real-agent matrix | DOS-P8, release |
| Migration | shadow comparison plus an exercised rollback | public beta |
| License | OSI-approved text reviewed by qualified counsel | public visibility |
| Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

---

## 8. Amendments to approved documents

An approved document is not silently rewritten. When a later approved document changes an
earlier one, the change is recorded in the amending document and cross-referenced from the
amended one; only code and status lines are edited in place. This section is the index — read
it before trusting any approved document, because it is the only place that says whether the
one in front of you is still current.

**Nothing is owed.** Both rows that stood here — the `brain` CLI group and `init`
installing the template — shipped with DOS-P2 Tasks 9 and 10 and are in the table below, and
DOS-P3's two amendments landed with it on 2026-08-10.

**One thing that is deliberately *not* a row here**, because §8 is amendments to approved
documents and this was the reverse. DOS-P3's first draft invented `session_start_hook` and
`session_end_hook` for what product spec §11 already called `session_start_injection` and
`session_end_capture`; the **code** was corrected to match the spec on 2026-08-10, so §11 is
current and untouched. Recorded here only so the next reader does not go looking for an
amendment that would say otherwise.

**Nothing is pending.** The five amendments that stood here were resolved on 2026-08-11: the
founder ratified all three implementer decisions taken while closing DOS-P4, and approved
`specs/…-codex-adapter-design.md`, which discharged the two that rode on it. Every row is in the
table below, each carrying the outcome rather than the question.

**Nothing is pending.** The two amendments DOS-P5's plan raised were ratified by the founder on
2026-08-12; the third — DOS-P5's plan amending *itself* with a Task 3.5 — was decided the same day,
before the task it precedes was dispatched; and the fourth, Task 11's install root, was decided the
same day on a contradiction the task's own implementer surfaced. All four are in the table below,
each carrying its outcome rather than its question.

**Twice now, DOS-P5's plan has disagreed with itself rather than with a spec**, and both times the
task under way found it. That is the shape to expect from a plan this long: the contradiction is
between an early task's mandated test code and a later task's prose about what consumes it.

**Discharged. Listed because the amended document is still read, not because there is work
left:**

| Amended | By | What changed | Where it landed |
|---|---|---|---|
| `plans/…-codex-adapter.md` Task 11, approved 2026-08-11 | Task 11, as built — the plan contradicting itself | **both Codex install proposals root at `<home>/codex`, the marketplace root, not at the plugin tree.** Task 11's step-2 tests rooted every operation at `<home>/codex/plugins/developer-os` while Task 13 emits the tree *plus* the marketplace descriptor relative to `<product-home>/codex` and says Task 11 consumes it. The consequence was concrete rather than cosmetic: nothing proposed writing the descriptor, so `registration[0]` would have run `codex plugin marketplace add` against a directory containing no `marketplace.json`. The old root is a *descendant* of the new one, so the wrong root does not refuse — it double-nests and applies cleanly | **decided by the founder 2026-08-12.** Code, `c67afba`, which also pinned `proposedHash` to the artifact's contents, added `registrationPhase` so the caller reads the CLI-step ordering rather than remembering it, and gave uninstall the same containment check as install. The plan's Task 11 carries the dated amendment |
| `plans/…-codex-adapter.md`, approved 2026-08-11 | a pre-flight scan of the plan against its own Global Constraint 1, before Task 4 | **a Task 3.5 is inserted, and Tasks 4, 5, 12 and 13 shrink.** The plan told four tasks to copy some ninety lines of vendor-neutral logic — `resolveExecutable`, the whole never-throw `discoverX` (argv `["--version"]` on both sides, so byte-identical apart from two type names), `compareVersions`, `tablePermits`'s body, `screenValueArgument` and `parsePayload` — while Global Constraint 1 says anything both adapters need moves to `core`, `security` or `workflow-schema`. Two copies were load-bearing: `compareVersions` returns `null` rather than `NaN` **because a review caught it failing open on 2026-08-11**, and the two argv screens had already diverged in the plan — shipped Claude tests `/permission\|dangerous/iu`, so it does **not** catch `danger-full-access`, which is precisely what Task 12 specified `/permission\|danger\|bypass/iu` to catch | **decided by the founder 2026-08-12**, before Task 4 was dispatched. The plan carries decision 3 and the Task 3.5 step list; `packages/core/src/versions/` and `packages/security/src/cli.ts` are where it lands |
| `specs/…-codex-adapter-design.md` §5.3, approved 2026-08-11 | DOS-P5's plan | **neither adapter ships `hooks/hooks.json`; DOS-P6 restores hooks for both, in one change.** A `"type": "command"` handler names something executable, and the only command we could name without shipping a script we cannot mark executable is the `developer-os` binary, whose capture entrypoint is DOS-P6's. A hook firing into a missing command errors at the end of every session. `plugin_hooks` reports `unknown` throughout, which §15.1 already prescribes | **ratified by the founder 2026-08-12.** It puts both adapters in one state rather than two coincidences |
| `docs/architecture/workflow-schema.md` §2.2 and §6 | DOS-P5's plan, Task 3 | **the vendor-neutral skill body moves into `packages/workflow-schema`.** Codex's required frontmatter is `name` and `description` — exactly Claude's — and both write `skills/developer-os-<id>/SKILL.md`, so a second renderer written the obvious way is a byte-for-byte copy: some four hundred lines and twenty tests duplicated across packages that may not import each other. `WorkflowRenderer` stays an interface and each adapter still implements it; what moves is the half that comes from one contract and renders identically for every vendor | **ratified by the founder 2026-08-12.** The note is amended by the task that makes the move, and the existing drift gate is the evidence: `plugins/claude/` must not change by a byte |
| `specs/…-codex-adapter-design.md` §6.2 and `specs/…-claude-adapter-design.md` §7.2 | the skill-body move, ratified by the founder 2026-08-12 (`workflow-schema.md` §8.7's own amendment) | **the screen seam both specs named moved into `renderSkillBody`.** Each said a vendor renderer screens `recovery.resume` "at the render seam"; the seam is the compiler's now, not either adapter's — `ClaudeRenderer.render` never touches `recovery.resume`, and a vendor renderer's own screening narrows to the field it renders itself: `description`, in the frontmatter | each spec carries a dated in-place amendment above the section it supersedes; the Codex plan's Global Constraints line is corrected in place, being a live document |
| `specs/…-claude-adapter-design.md` §6, approved 2026-08-11 | DOS-P4, as shipped | **`hooks/hooks.json` is not shipped.** A `type: "command"` hook needs an executable file and nothing in the pipeline can express an executable bit — `RenderedArtifact` is `{path, contents}`, `ManagedArtifactV1` has `kind: "file"` and no mode — so the claim could never have been true, while §6.1 already reported all three lifecycle capabilities as `wrapper-required`. Restoring it needs the hook bodies, an executable-bit mechanism and a firing test, **in one change. Owner: DOS-P6** | **ratified by the founder 2026-08-11.** The spec carries a dated in-place amendment above the section it supersedes; `claude-adapter.md` §5 is the record |
| `specs/…-claude-adapter-design.md` §5.4, approved 2026-08-11 | DOS-P4, as shipped | **the probe settles `skills` only, and only over a directory observed to contain a `SKILL.md`.** One `claude plugin validate` exit code covers a whole directory, so reading it as an observation of a particular artifact granted `plugin_hooks=yes` and `subagents=yes` over a tree containing neither, and `skills=yes` over one containing no skill. Restoring a key to that probe means shipping the artifact it names in the same change | **ratified by the founder 2026-08-11.** The spec carries a dated in-place amendment above the superseded table |
| DOS-P4's plan, Task 10 — deleted with the plan | DOS-P4, as shipped | **no `developer-os workflow render` verb; regeneration is `npm run render:claude`.** A shipped verb writing `./plugins/claude` into whatever directory a user stands in contradicts spec §10's one-directory rule and writes outside the manifest and outside a transaction; `plugins/claude/` exists only in a source checkout. The composition stays in the package, so the regenerator and the drift check call one function | **ratified by the founder 2026-08-11.** `docs/architecture/claude-adapter.md` §7 is the record |
| §2 of this file, a second time | the Codex adapter spec §4.3, **approved 2026-08-11** | `buildConflictEvidence` has **no consumer in either adapter**. DOS-P4 §4.3 dissolved its half; DOS-P5 §4.3 dissolves the other by delegating the config write to `codex plugin add`. It was built for a design both adapters declined. Whether it is retained, taken up by DOS-P7, or deleted belongs to the first subsystem with a real three-way merge | §2 above carries the note; the decision itself is still owed by that subsystem |
| `specs/…-claude-adapter-design.md` §8.1, approved 2026-08-11 | the Codex adapter spec §7.3, **approved 2026-08-11** | the `agent.prompt` `with` schema lives in `packages/core`, not in `packages/adapter-claude`, so **both** adapters import one schema. Two adapters with two argument schemas for one verb is a workflow that validates against one vendor and not the other | code, DOS-P4 Task 6 (`d8afcca`) |
| Program plan Task 4's checkpoint, and two of its eight boxes | DOS-P4, as closed | **the checkpoint is half met, and the other half is DOS-P6's.** Six skills load in a real installation; `capture`, `ingest` and `review` name verbs with no handler anywhere in this product. Lifecycle injection and `developer-os run claude` stay unticked with inline notes naming DOS-P6, rather than ticked to make the task look closed | the program plan, and `claude-adapter.md` §8 |
| `docs/migration/exclusion-policy.md` — an approved Task 0 artifact | the Claude adapter spec §12, approved 2026-08-11 | gains "Paths this repository does not create": this repository creates no `.claude/` in v1. Adapter output lives in `plugins/claude/` and installs to the user's `~/.claude/skills/`, so no generated artifact wants a home here | the policy carries the decision and a cross-reference to the spec's §12 |
| `docs/migration/exclusion-policy.md` §"Remote and release gates" | the founder's ruling of 2026-08-11 | the clause forbidding fetch, push and pull requests was conditional on remote verification being `blocked_by_environment`. **That condition ended on 2026-08-10** — the remote exists and CI runs on it — so the clause bound nothing while still reading as an absolute prohibition. Corrected to state the condition in the past tense and to name L2 as what remains | the policy, in place, as a status correction |
| §2 of this file, and product spec §9.3's deferral | the Claude adapter spec §4.3, approved 2026-08-11 | DOS-P4 is **not** the first consumer of `buildConflictEvidence` after all. A skills-directory plugin writes no foreign config file, so DOS-P4 has nothing to three-way merge. Conflict evidence is still produced for the plugin directory's own managed files; whether DOS-P5 needs the three-way form is DOS-P5's decision, and `AGENTS.md` is shared in a way `~/.claude/skills/developer-os/` is not | §2 above carries the amendment note |
| `specs/…-workflow-compiler-design.md` §4, "semantic version" | DOS-P3, as shipped | narrowed to `MAJOR.MINOR.PATCH` with no leading zero: pre-release and build metadata are refused, because `extends` pins `id@version` exactly and comparing `1.2.3-rc.1` against `1.2.3` there means nothing | code, DOS-P3 Task 3; recorded in `docs/architecture/workflow-schema.md` §2.5, and the spec carries a dated in-place amendment |
| `specs/…-workflow-compiler-design.md` §13, byte-identical rendering | DOS-P3, and the fact that §14 makes `WorkflowRenderer` an interface | the requirement that six workflows "render byte-identically" **cannot be met in DOS-P3**, which ships no renderer. Task 11 proves the inputs are byte-identical across two loads and a reversed directory reader; the byte-identity of real vendor artifacts is owed by DOS-P4 and DOS-P5 | `docs/architecture/workflow-schema.md` §6, which is where the hand-off is recorded so it cannot be lost with the plan |
| `DeveloperOsConfigV1`, frozen at `foundation.md` §2 | brain-engine spec §3, §15.3 | gains an **optional** `brain` section; `configSchema` stays `.strict()` and `schemaVersion` stays 1, so every existing installation still loads | code, `4cd7224`; cross-referenced in `foundation.md` §2 |
| brain-engine spec §2 placement table | the brain plan, and the shipped code | `BrainConfigV1`'s type and schema live in `packages/core`, not `packages/brain` | code, `4cd7224`; the spec table carries a dated in-place correction |
| `specs/…-brain-engine-design.md` §7 lint table | the brain plan's Task 4, as shipped | the `links` class gains a `warn` row for a link text matching more than one note, and §7 records the five-tier resolution ladder plus its case-folded fallback | code, this task; the spec carries a dated in-place amendment marked as shipped |
| `specs/…-brain-engine-design.md` §8 retrieval | the brain plan's Tasks 7 and 9, as shipped | a multi-word query is an OR over its tokens; `considered`/`selected` are defined; `--limit` supplies `maxCandidates` | code, Tasks 7 and 9; the spec carries a dated in-place amendment marked as shipped |
| `specs/…-brain-engine-design.md` §4.4 parser contract | DOS-P2 Task 10, as shipped | gains clause 5: frontmatter carries no explicitly tagged node, and one is refused. Adopted rather than deferred **because the premise for deferring it was measured false** — `yaml@2.8.1` resolves `!!binary` to a `Buffer`, `!!timestamp` to a `Date` and `!!set` to an object, on the core schema | code, Task 10; the spec carries a dated in-place amendment |
| `specs/…-design.md` input list | Track B closing, 2026-08-10 | "Cutover preconditions" named the legacy exit checklist, which closed and was deleted. §6 of this file is the record in its place | the spec carries a dated in-place correction beneath the line, which is left standing rather than rewritten |
| `specs/…-brain-engine-design.md` §7 `duplicates` row | NEW-6, as shipped 2026-08-10 | "identical normalized title" now normalizes the **screened** title, not the bytes on disk, so the class agrees with the `catalog.md` rows §6 Task 10 changed. Path comparison stays unscreened, for the reason a link destination is not screened either | code, this change; the spec carries a dated in-place amendment marked as shipped |
| `specs/…-brain-engine-design.md` §6 rendered views | DOS-P2 Task 10, as shipped | display text in `catalog.md` and `vault-map.md` is screened for control and format characters, not only escaped for Markdown structure. A link destination is **not** screened, because a path has to resolve to the note it names | code, Task 10; the renderer states both halves at the seam |
| program plan Task 2 file list | brain-engine spec §15.2 | `discovery/` is a sixth source directory, because folder policy is consumed by both `indexes/` and `lint/` and is not schema parsing | the program plan's file list, and the brain plan |
| `specs/…-design.md` §8 CLI contract | brain-engine spec §11, §15.1 | a `brain reindex\|lint\|search\|status` group is added; `search` becomes an alias for `brain search` | code, DOS-P2 Task 9 (`8c9f4f6`); cross-referenced in §8 of that spec |
| Foundation's "never modify an existing vault" | brain-engine spec §10, §15.4 | `init` installs `templates/brain/` when, and only when, it creates the vault, which keeps the guarantee intact | code, DOS-P2 Task 10 |
| `specs/…-design.md` §8 flags | Foundation, `foundation.md` §7 | `--verbose` is not implemented and dispatch is strict, so it exits 2; `repair` takes `--resume`/`--rollback` rather than `--dry-run`/`--yes` | cross-referenced in §8 of that spec |
| `specs/…-design.md` §9.1 `init` | Foundation | `init` prompts for neither adapters nor vault path, and its post-install gate is the five checks in `INIT_OWNED_CHECKS`, not the whole `doctor` report | cross-referenced in §9.1 |
| `specs/…-design.md` §9.3 conflict evidence | Foundation Task 6 | the three-way *diff* is deferred to DOS-P4/P5; Foundation shipped three recorded hashes and a current-versus-proposed diff | cross-referenced in §9.3, with the reasoning in `foundation-constraints.md` Task 6 |
| `specs/…-kernel-transaction-lock-design.md` | its own implementation, committed 2026-07-27 | the spec describes shipped code, so its status line says so in the past tense | **This is the one spec retained after its subsystem shipped**, because `foundation-constraints.md` points at it as the design of record for `packages/platform-macos/src/transaction-lock.ts`. Delete it only when nothing points at it |

---

## Appendix — outstanding outside this repository

Not Developer OS work; recorded so it is not lost. `dev/active/` and `.claude/plans/` were
deprecated on 2026-07-18 in favour of `docs/superpowers/plans/`, to be migrated
opportunistically.

**As of 2026-08-08, 25 files remain on the deprecated paths across seven repositories**
(down from 28 on 2026-07-27). One repository completed its migration in the interval and
one gained a `docs/superpowers/` tree without moving its plans yet; the user-level
directory grew.

Do not maintain the per-repository table that used to sit here. It went stale within days,
it named absolute machine paths in a repository that is meant to become public, and it
cannot be right for longer than the next session — recompute it when the migration is
actually the work in hand, rather than reading a frozen count.

The founder's two legacy repositories are not on this list: both were confirmed clean of
`.claude/plans/`, `dev/active/`, and `docs/superpowers/` on 2026-07-27, and the 2026-08-08
re-verification found no change.
