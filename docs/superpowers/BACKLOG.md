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
  document still points at it as the design of record — §3's table is the current list, plus
  the kernel-lock spec in §8 — and its status line must then say so, in the past tense.
  **One spec is exempt because the rule's unit does not fit it.** The product design spec
  specifies eight subsystems at once, so no single status line could be truthful: Foundation
  and DOS-P2 through DOS-P5 have shipped, DOS-P6 through DOS-P9 are unbuilt. It carries per-section
  markers instead — §8, §9.1 and §9.3 each say what actually shipped — which is finer
  granularity than this rule asks for. Do not give it a global past-tense status line, and do
  not treat it as a deletion candidate while any subsystem it specifies is unbuilt.
- **Every plan this program has finished is deleted, and all of them are in git history.** The
  four subsystem plans are in §3's table with their recovery commits; the other three are the
  brain/claude-shared English migration (`28a0ddc`), the kernel transaction lock (`cf70342^`) and
  Foundation (`c4f883f^`). A deleting commit does not contain the file it deleted, which is what
  the `^` suffixes mean; a commit written without one is already the last that *contains* the
  plan. Stripped in part rather than deleted: the program plan's Tasks 0–1 and the Brain plan's
  Tasks 1–2, both recoverable at `9f82901`, which is the commit that added the superseding notes
  rather than one that removed anything.
- `docs/superpowers/plans/legacy-runtime/` is publication-excluded and, since 2026-08-10,
  **empty** — its one document closed and was deleted. The exclusion stands for anything
  written there again.

---

## 0. Status at a glance

Open work only. Program Tasks 0 to 5 are closed and are not rows here.

| Area | Where | What is left |
|---|---|---|
| Program (umbrella) | 1 plan | Tasks 6–9 open; Tasks 0–5 closed and not rows here |
| DOS-P6 | spec approved and plan written, both 2026-08-13 | the implementation — nineteen tasks, none started |
| DOS-P7 | no document yet | 1 spec, 1 plan, 1 implementation |
| DOS-P8 cutover, DOS-P9 release | program plan Tasks 8–9 | every artifact; one open decision each |
| Repository-level | §1 | NEW-7 (XS, needs a machine with Obsidian), NEW-11 (S, the invisible-title rule stops at `title`), NEW-12 (S, the argv screen's word list also screens free-form prose) and NEW-13 (S, two artifact roots share one type) |
| Repository infrastructure | §5 | two things a later subsystem still owes, both DOS-P6's — `tests/security/`, and a consolidated threat model |
| Legacy runtime | §6 | **nothing** — closed 2026-08-10, checklist deleted; §6 is what a cutover still needs to know |
| Outside this room | `ORDER.md` Track L | license approval, remote verification |

**Foundation, DOS-P2, DOS-P3, DOS-P4 and DOS-P5 are closed.** None is a row above. What each left
behind is `docs/architecture/foundation.md`, `brain.md`, `workflow-schema.md`, `claude-adapter.md`
and `codex-adapter.md`, plus §2 here for Foundation's open questions; every one of those plans is
deleted and git history is the archive. **Both adapter notes are written for DOS-P6**, the one
subsystem that consumes both — `codex-adapter.md` §9 carries the two-adapter table, and its §11 and
`claude-adapter.md` §9 carry twenty-four residuals between them, thirteen of them DOS-P6's.
DOS-P3's note is still the one to read before touching the compiler: its §7 records four canonical workflows that say less than the product
spec does, each with an owner, and its §8 records nine residuals.

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

### NEW-13 — two artifact roots share one type, and only prose separates them

- **Status:** open, found 2026-08-12 by the fresh-context review of DOS-P5 Task 13 · **Owner:**
  DOS-P6, as the first consumer of `CodexAdapter` · **Size:** S
- `RenderedArtifact` is `{ path, contents }` for artifacts relative to **two different roots**.
  `renderCodexPlugin` returns paths relative to the plugin root — `.codex-plugin/plugin.json`,
  `skills/…` — and that is what `plugins/codex/` checks in. `proposeCodexInstall` resolves against
  the **marketplace root**, `<home>/codex`, because that is where `codex plugin marketplace add`
  points and where the descriptor lives. `renderCodexInstallTree` is the bridge that re-roots one
  into the other.
- **The two are structurally identical and semantically incompatible, and the plugin root is a
  *descendant* of the marketplace root — so the wrong one does not refuse.**
  `CodexAdapter.proposeInstall(CodexAdapter.renderPlugin(contracts), context)` type-checks, passes
  containment, installs one level too shallow at `<home>/codex/.codex-plugin/…`, and applies
  cleanly. Both members sit adjacent on the same frozen façade.
- **This exact class of mistake has already been made twice in this subsystem**, in both directions:
  the install proposal was first rooted at the plugin tree, so the descriptor was never proposed at
  all; correcting that then left `buildPluginTree`'s output under-nesting until `PLUGIN_TREE_PREFIX`
  was derived. Neither was caught by containment, because containment is not the guard here.
- **The fix is nominal, not documentary:** brand the two array shapes as distinct opaque types, so
  `proposeInstall` structurally refuses a plugin-root tree. Today the only thing between them is a
  docblock and a test asserting the two façade bindings are not the same function — which stays
  green under the misuse it describes.

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

**Two documents left, both DOS-P7's.** DOS-P6's spec was approved by the founder on 2026-08-13 and
its implementation plan was written the same day. Nothing else on the product path is missing a
document.

Each subsystem after Foundation requires an approved spec **and** an implementation plan
before any code work — this is a Global Constraint of the program plan, not a preference.
Every spec starts with a brainstorming/approval cycle, and approval is the founder's.

**The four closed subsystems are not rows here.** Each kept its spec, because an architecture note
names it as the design of record, and each deleted its plan:

| Closed | Spec retained | Named as design of record by | Plan recoverable at |
|---|---|---|---|
| DOS-P2 | `specs/…-brain-engine-design.md` | `docs/architecture/brain.md` | `81e7e7d` |
| DOS-P3 | `specs/…-workflow-compiler-design.md` | `docs/architecture/workflow-schema.md` | `a47e965` |
| DOS-P4 | `specs/…-claude-adapter-design.md` | `docs/architecture/claude-adapter.md` | `17968cb` |
| DOS-P5 | `specs/…-codex-adapter-design.md` | `docs/architecture/codex-adapter.md` | the commit that closed DOS-P5 |

**Read both adapter notes before starting DOS-P6** — between them they record why in-place discovery
beat a marketplace copy on one vendor and a local marketplace won on the other, the two-adapter
table DOS-P6 designs against, and thirteen residuals it inherits. And read §8 before trusting the
Codex spec: its §14, the section it declares normative, was amended four times on 2026-08-12 by
first contact with a real binary.

### DOS-P6 — Knowledge pipeline hardening

- **Spec:** `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — **approved by the founder
  2026-08-13.** Read its §3 first: five decisions, each with what it costs. The one that reshapes
  the subsystem is 3.1 — capture content is **agent-authored**, because the `session_end` trigger
  the canonical workflow declares cannot supply the `text` that same contract requires without
  reading `transcript_path`, which this product refuses on both vendors. So no hooks ship,
  `developer-os run claude|codex` is never built, and **nothing automatic captures anything**. §12
  lists the six documents it amends; §8 carries them as ratified.
- **Plan:** `plans/2026-07-21-developer-os-knowledge-pipeline.md` — **written 2026-08-13**,
  nineteen tasks. It takes five decisions the spec did not; six rows in §8 carry them, all ratified
  2026-08-13. **Task 17 stops
  and asks**: it is the real model call §10.2 says this subsystem can no longer avoid.
- **Program task:** 6 · **Complexity:** L · **Blocked by:** nothing — DOS-P4 closed 2026-08-11 and
  DOS-P5 on 2026-08-12
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
- **Inherits thirteen of the two adapters' twenty-four residuals** — `docs/architecture/claude-adapter.md` §9
  and `docs/architecture/codex-adapter.md` §11, each with this subsystem named as owner. Four of
  them belong in the spec rather than in the implementation: the **capture contract**, which is what
  unblocks hooks for both adapters in one change (neither ships `hooks/hooks.json`, and both report
  `plugin_hooks` as `unknown`); the **provisional JSONL terminal-event rule**, unverified because
  settling it needs a real model call the founder declined on 2026-08-12; **`maxTurns`**, bounded
  under Claude and silently dropped under Codex from one shared `agent.prompt` schema; and the fact
  that the **two-gate capability machinery has no production caller today**, so DOS-P6 is the first
  to exercise it.

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
- **Must also decide how a managed artifact changes across product versions**, raised by DOS-P6
  Task 11's review on 2026-08-14 and ruled out of that task's scope. `init` plans an artifact only
  when it is absent: the config file (`init.ts:276`), the Brain skeleton (`:290`) and the vault
  (`:307`) all take the same `isFile` → `unchanged` branch, and the docblock at `:284` states the
  intent. So an installation upgraded across a version that changes the shipped bytes keeps the old
  file indefinitely, and `assertNoDrift` cannot notice, because the content still matches the hash
  the manifest recorded. **Task 11 made this concrete rather than theoretical**: the output schema
  it installs is the file a vendor CLI is pointed at with `--output-schema`, so a stale copy is a
  model refused against a bound the product no longer ships. The repository copy is protected by a
  parity test; nothing protects the installed one. The fix is an `update` operation carrying
  `expectedBeforeHash` — which the change-plan validator already supports — and it is this entry's
  because `update` is what this entry is.
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

Named in the program file map and still missing. A row leaves this section when the directory
exists, because the section's job is to stop something being discovered late — the tree is the
inventory of what was built, and the architecture notes say what is in it.

| Path | First owner | Status |
|---|---|---|
| `tests/security/` | DOS-P6 | missing — sentinel secret, prompt injection, symlink escape, multiline command, malformed manifest, interruption |
| a consolidated threat model under `docs/architecture/` | DOS-P6 at the earliest | missing — the **capability model** is deliberately recorded twice instead, once per adapter (`claude-adapter.md` §3, `codex-adapter.md` §3), which is where it belongs while the two vocabularies are asserted identical |

Everything else the file map names exists, most recently `packages/adapter-codex/` and
`plugins/codex/` on 2026-08-12. Two rows left something durable behind as they closed:

- **`tests/contracts/` holds only DOS-P3's cases.** DOS-P2 put its contract cases beside the code
  they pin instead, which is why that directory looks thinner than the file map implies.
- **`.github/workflows/` was owed by nobody, and that was the finding.** The program file map never
  named it, so no subsystem owed it and this repository ran without CI for twenty days. Created and
  verified green on 2026-08-10.

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

**The knowledge-pipeline spec's six were ratified on 2026-08-13**, in the same conversation that
approved the spec. They are listed below with their outcome rather than their question, and each is
discharged by the DOS-P6 task named beside it — a row leaves this table when the amended document
carries the cross-reference, not when the decision is taken.

| Amended | Outcome, ratified 2026-08-13 | Discharged by |
|---|---|---|
| product design spec §11 | there is neither a lifecycle hook nor a `developer-os run claude\|codex` wrapper. `CapabilityState` **replaces** `wrapper-required` with `not-used`, and six of the nine keys resolve to it | DOS-P6 Task 3 |
| product design spec §14.3 | "user-configured patterns" narrowed to literal case-insensitive substrings — a user-supplied regex over capture text is a ReDoS surface and this codebase bounds no expression anywhere | DOS-P6 Task 2 |
| `specs/…-claude-adapter-design.md` §6.1 | hooks **declined**, not deferred; the three lifecycle keys report `not-used` | DOS-P6 Task 3 |
| `specs/…-codex-adapter-design.md` §5.3 | the same, in one decision covering both adapters. **This supersedes the ratified amendment below**, which deferred hooks to DOS-P6 rather than closing them | DOS-P6 Task 3 |
| `specs/…-codex-adapter-design.md` §14.1 | the JSONL terminal-event rule promoted from provisional to observed, dated, with the shape seen — ingest forces the real `codex exec` call that DOS-P5 could not justify | DOS-P6 Task 17 |
| `specs/…-workflow-compiler-design.md` §6 | scope globs stop being literals, which `workflow-schema.md` §8.1 made due at the first handler that resolves one. **Narrowed by the plan** — see the ratified row below | DOS-P6 Task 6 |

**Six were ratified by the founder on 2026-08-13**, in the same session that approved the spec and
received the plan. Every one is the implementation plan's rather than the spec's: they ride on
`plans/2026-07-21-developer-os-knowledge-pipeline.md`, whose "Five decisions this plan takes"
section is the authoritative statement for the first four, and Tasks 12 and 15 for the last two.
Each amends an approved document, which is why they are here rather than only in the plan. **A row
leaves this table when the amended document carries the cross-reference**, not when the decision was
taken — so all six stay until the task named beside them lands.

**Two rows exist because a fresh-context review found them missing on 2026-08-13**, before this plan
was committed: the narrowing of design spec §13.4's "staged result", and the narrowing of §17.5's
security cases to spec §9's six suites. Both were decisions the plan was taking silently, and both
were put to the founder with the other four.

| Amended | Outcome, ratified 2026-08-13 | Discharged by |
|---|---|---|
| the knowledge-pipeline spec §12 | **five** canonical workflows go to `2.0.0`, not two. `ingest` gains a step and widens its write scopes, `brain-search` gains one and widens its read scopes, and `review` gains the `capture.edit` step its `decision` input already advertises — with its scopes unchanged, which is what makes it easy to miss. A step list and a scope set are the contract, and `extends` pins `id@version` exactly | 7 |
| `specs/…-workflow-compiler-design.md` §6, again | the globs resolve at the **handler boundary** through `resolveScopeGlob(glob, config)`; the contract keeps canonical names. Templating them inside the YAML was rejected: it invents a substitution syntax in the workflow schema and puts a configuration value in the one document meant to be comparable across installs. Leaves a display gap — a skill shows `content/**` while the handler enforces the user's own root | 6 |
| **program plan Task 6**, third box | "Restore `hooks/hooks.json` for both adapters in one change" cannot be ticked — spec §3.1 declines hooks and corrects the stated blocker: a `"type": "command"` handler needs no executable bit, and what hooks lacked was content to capture. **Spec §12 omits the program plan from its amendment list; that gap was found while writing the plan.** The box is rewritten to record the decline, not ticked | 19 |
| **§7 of this file**, the DOS-P7 gate "uninstall removes only manifest-owned artifacts" | one named exception: the redaction key, which spec §3.5 keeps out of the manifest and spec §8.4 requires `uninstall` to remove. Making it a hash-exempt manifest artifact was rejected — it would put the key's path in a file every enumerating diagnostic reads. The exception is one path wide and asserted by test | 1 |
| product design spec §13.4, "the staged result" | the `deterministic reindex` validator runs over an **in-memory projection** of vault plus proposal, not over a staging directory. §13.4 and the knowledge-pipeline spec's own §6.3 preamble contradict each other — nothing is staged at the point the preamble names — and staging first would make every file in staging attacker-influenced content the validators must re-read as hostile | 12 |
| product design spec §17.5, and the knowledge-pipeline spec §9 | §9 narrows §17.5's security cases to six suites and drops two the standing gate in §7 of this file still requires from DOS-P6 onward: a **network** suite, and **concurrent user edits**. The plan ships eight suites rather than six and registers the narrowing rather than inheriting it | 15 |

**Two rows are awaiting ratification and are the only unratified rows in this section.** Both were
raised by DOS-P6 during implementation rather than planning, which is why neither is in a table
above.

| Amended | Outcome, **awaiting the founder** | Raised by |
|---|---|---|
| the knowledge-pipeline spec §6.1, "one capture, one agent call, **one transaction**" | the last third is false and cannot be made true. The ladder performs four mutations and **the executor's lock is per-execution**, so it ships as **four transactions per capture** — `ingest-stage` (the capture file, `accepted → staging`), `ingest-apply` (the proposed notes), `ingest-reindex` (the index artifacts), `ingest-ingested` (the capture file, `staging → ingested`) — plus a compensating `ingest-rollback` on failure. Two independent reasons no two of them merge: `BrainService.reindex()` **reads the vault**, so it cannot run until the apply has finalized; and `validateChangePlan` grants ownership from the manifest, where the index artifacts are recorded and a capture is deliberately absent (spec §3.4 keeps a capture hand-editable in Obsidian). **The residual, accepted rather than closed:** a crash between the apply and the last transaction leaves a capture at `staging` with its notes already applied — inert, because the next run selects only `accepted` captures and cannot double-apply, and recoverable by `repair` plus a hand edit. **Cost of overturning:** there is no cheaper arrangement to overturn it to; the alternative is a Foundation change letting one execution span a read of what it just wrote | DOS-P6 Task 13, plan correction 4 |
| the knowledge-pipeline spec §6.3, `confidence and lifecycle` | the spec names the validator and says "required frontmatter for the note's declared stage is absent" — **it never says which frontmatter**. Shipped rule: `established` requires `reviewed` to be a date, `deprecated` requires `updated` to be present, `emerging` requires nothing extra. It is **defensible but invented**: nothing in the tree enforced either before this task. It is grounded in a contradiction the product already flags — `lint.ts:285-294` grades an agent-authored, never-reviewed note as `provenance` at severity **warn**, so ingest turns only the narrower `established`-while-never-reviewed claim into a refusal. **The broad reading was checked and rejected**: refusing every `author: agent` + `reviewed: null` note would refuse every proposal this pipeline can produce. **Cost of overturning:** two `if`s at `validate.ts:474-491`; this validator writes no data, so nothing has to be migrated | DOS-P6 Task 12, `validate.ts` |

**One row is the founder correcting the spec after a pre-flight scan**, and it is the most
consequential amendment DOS-P6 has taken:

| Amended | By | What changed |
|---|---|---|
| `specs/…-knowledge-pipeline-design.md` §5.3 and §5.6 | an adversarial pre-flight scan of Tasks 3–19, **settled by the founder 2026-08-13** | **`captureId` becomes immutable** — assigned once at capture time, never recomputed. As written, §5.3 recomputed it on every hand edit and §5.6 refused on a mismatch; since the id is `H(redacted content)`, *any* content-changing edit changed it, so **every** edit refused and the pasted secret stayed in the vault file. The verb decision 1 bumped `review` to `2.0.0` for could never do the one thing it exists for, and Task 8's parse-level assertion would have looked clean because a refusal object carries no content. Now `deduplicationHash` tracks content, `edit` re-redacts and rewrites in place, and the mismatch refusal keeps the job it was really for: a renamed file or a hand-edited id field. **Cost accepted:** two captures whose text converges after an edit can both exist |

**One row is the plan correcting itself**, which is the shape the DOS-P5 note below warns to expect:

| Amended | By | What changed |
|---|---|---|
| `plans/…-knowledge-pipeline.md` Task 1, Step 3 | the fresh-context review of Task 1's first implementation, **settled by the founder 2026-08-13** | the instruction "`createProductionContext` replaces `randomBytes(…)` with `loadOrCreateRedactionKey(paths.stateDir)`" was **wrong, not merely awkward**. Context is built before dispatch for every command, so a create-if-missing load there made `doctor`, `status` and both `--dry-run` commands write a new secret — against Foundation's "`doctor` reports rather than repairs", which that plan's own Global Constraints carry. Three consequences followed: `uninstall` removed the key and the next command put it back permanently, because `runUninstall` early-returns on an absent manifest; a symlinked or truncated key failed **every** command including the diagnostic that would have reported it; and a FIFO at that path hung the CLI forever, since `open(O_RDONLY)` blocks before the file-type guard runs. **The load splits in two** — a read-only, never-create, never-throw `readRedactionKey` at the composition root, and the create-capable `loadOrCreateRedactionKey` at each command's own point of use |

**Two approved architecture notes are corrected by this work, and the correction is the spec's
rather than the plan's**, recorded here because §8 is where a reader of either note learns its
status:

| Amended | By | What changed |
|---|---|---|
| `docs/architecture/claude-adapter.md` §5 and `docs/architecture/codex-adapter.md` §5 | the knowledge-pipeline spec §3.1, approved 2026-08-13 | both state that restoring hooks needs "the hook bodies, a mechanism for marking a generated artifact executable, and a test that observes a hook firing". **The middle requirement was never needed** — a `"type": "command"` handler names a command string, so nothing executable ships. What hooks lacked was content to capture. Hooks are now **declined**, not owed |
| `docs/architecture/workflow-schema.md` §7 and §8.1 | the same spec, and this plan's decision 2 | three of §7's four recorded gaps close here — the `review` workflow's missing `capture.edit`, `ingest` stopping at apply, and `brain-search` never reading a note. §8.1's glob residual is discharged in the narrower `resolveScopeGlob` form rather than by templating the contract |

**Two canonical workflows change by the spec's own decision, and that is a contract change rather
than an amendment:** `workflows/capture/workflow.yaml` drops `session_end` and
`workflows/shared/workflow.yaml` drops `session_start` — both name triggers nothing can fire.
**Three more change by the plan's**, which is the first ratified row above: `ingest`, `brain-search`
and `review`. All five go to `2.0.0`.

**Every amendment raised through DOS-P5 was ratified** by the founder on or before 2026-08-12, and
every row in the table below carries its outcome rather than its question.

**One thing that is deliberately *not* a row here**, because §8 is amendments to approved
documents and this was the reverse. DOS-P3's first draft invented `session_start_hook` and
`session_end_hook` for what product spec §11 already called `session_start_injection` and
`session_end_capture`; the **code** was corrected to match the spec on 2026-08-10, so §11 is
current and untouched. Recorded here only so the next reader does not go looking for an
amendment that would say otherwise.

**Rows amending a deleted plan are removed once that plan is gone**, since a document nobody can
open cannot mislead anyone; where such an amendment settled something about the *product* rather
than about the plan, it lives in the architecture note that replaced the plan. **Two of DOS-P5's
four amendments were its plan disagreeing with itself**, both found by the task under way — the
shape to expect from a plan of nineteen tasks is a contradiction between an early task's mandated
test code and a later task's prose about what consumes it. Worth knowing while writing the next
two plans.

**Discharged. Listed because the amended document is still read, not because there is work
left:**

| Amended | By | What changed | Where it landed |
|---|---|---|---|
| `specs/…-codex-adapter-design.md` §4.1, §4.2, §14.4 and §15.2 — **the section that spec declares normative** | DOS-P5 Task 17, 2026-08-12, first contact with a real `codex-cli 0.147.0` | **four corrections, three of which stopped the install completing at all.** `source.path` in the marketplace document must be `./`-prefixed and marketplace-root-relative — an absolute one does not error, it is **silently dropped** from `plugin list --json` and `plugin add` then reports the plugin not found; `plugin marketplace add` takes exactly one positional, the source path, and reads the name from the document itself; `plugin remove` requires the qualified `<plugin>@<marketplace>` form; and `plugin list --json` returns `{installed, available}` with `enabled` and a **nested** `source.path`, not the guessed `{plugins:[…]}` — against which the probe would have reported `skills: unavailable` on every real installation forever. §15.2 also raises `CODEX_MINIMUM_VERSION` to `0.147.0`, **one observed version and not a range** | the spec carries all four as dated in-place amendments, and 1–3 were corrected in production code (`marketplace.ts`, `install.ts`) rather than only documented. `docs/architecture/codex-adapter.md` §7 is the summary |
| `specs/…-codex-adapter-design.md` §5.3, approved 2026-08-11 | DOS-P5's plan | **neither adapter ships `hooks/hooks.json`; DOS-P6 restores hooks for both, in one change.** A `"type": "command"` handler names something executable, and the only command we could name without shipping a script we cannot mark executable is the `developer-os` binary, whose capture entrypoint is DOS-P6's. A hook firing into a missing command errors at the end of every session. `plugin_hooks` reports `unknown` throughout, which §15.1 already prescribes | **ratified by the founder 2026-08-12.** It puts both adapters in one state rather than two coincidences |
| `docs/architecture/workflow-schema.md` §2.2 and §6 | DOS-P5's plan, Task 3 | **the vendor-neutral skill body moves into `packages/workflow-schema`.** Codex's required frontmatter is `name` and `description` — exactly Claude's — and both write `skills/developer-os-<id>/SKILL.md`, so a second renderer written the obvious way is a byte-for-byte copy: some four hundred lines and twenty tests duplicated across packages that may not import each other. `WorkflowRenderer` stays an interface and each adapter still implements it; what moves is the half that comes from one contract and renders identically for every vendor | **ratified by the founder 2026-08-12.** The note is amended by the task that makes the move, and the existing drift gate is the evidence: `plugins/claude/` must not change by a byte |
| `specs/…-codex-adapter-design.md` §6.2 and `specs/…-claude-adapter-design.md` §7.2 | the skill-body move, ratified by the founder 2026-08-12 (`workflow-schema.md` §8.7's own amendment) | **the screen seam both specs named moved into `renderSkillBody`.** Each said a vendor renderer screens `recovery.resume` "at the render seam"; the seam is the compiler's now, not either adapter's — `ClaudeRenderer.render` never touches `recovery.resume`, and a vendor renderer's own screening narrows to the field it renders itself: `description`, in the frontmatter | each spec carries a dated in-place amendment above the section it supersedes; the Codex plan's Global Constraints line is corrected in place, being a live document |
| `specs/…-claude-adapter-design.md` §6, approved 2026-08-11 | DOS-P4, as shipped | **`hooks/hooks.json` is not shipped.** A `type: "command"` hook needs an executable file and nothing in the pipeline can express an executable bit — `RenderedArtifact` is `{path, contents}`, `ManagedArtifactV1` has `kind: "file"` and no mode — so the claim could never have been true, while §6.1 already reported all three lifecycle capabilities as `wrapper-required`. Restoring it needs the hook bodies, an executable-bit mechanism and a firing test, **in one change. Owner: DOS-P6** | **ratified by the founder 2026-08-11.** The spec carries a dated in-place amendment above the section it supersedes; `claude-adapter.md` §5 is the record |
| `specs/…-claude-adapter-design.md` §5.4, approved 2026-08-11 | DOS-P4, as shipped | **the probe settles `skills` only, and only over a directory observed to contain a `SKILL.md`.** One `claude plugin validate` exit code covers a whole directory, so reading it as an observation of a particular artifact granted `plugin_hooks=yes` and `subagents=yes` over a tree containing neither, and `skills=yes` over one containing no skill. Restoring a key to that probe means shipping the artifact it names in the same change | **ratified by the founder 2026-08-11.** The spec carries a dated in-place amendment above the superseded table |
| §2 of this file, a second time | the Codex adapter spec §4.3, **approved 2026-08-11** | `buildConflictEvidence` has **no consumer in either adapter**. DOS-P4 §4.3 dissolved its half; DOS-P5 §4.3 dissolves the other by delegating the config write to `codex plugin add`. It was built for a design both adapters declined. Whether it is retained, taken up by DOS-P7, or deleted belongs to the first subsystem with a real three-way merge | §2 above carries the note; the decision itself is still owed by that subsystem |
| `specs/…-claude-adapter-design.md` §8.1, approved 2026-08-11 | the Codex adapter spec §7.3, **approved 2026-08-11** | the `agent.prompt` `with` schema lives in `packages/core`, not in `packages/adapter-claude`, so **both** adapters import one schema. Two adapters with two argument schemas for one verb is a workflow that validates against one vendor and not the other | code, DOS-P4 Task 6 (`d8afcca`) |
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
