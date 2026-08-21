# Execution order

The queue. Work top to bottom. This file answers one question — *what do I do next* — and
nothing else; the detail behind each entry lives in `BACKLOG.md`.

> **Starting a session?** Read `SESSION.md` first. It is the procedure; this is the queue.

**How to use it**

1. Read `NOW` below. That is the only thing in progress.
2. Check the entry's **Needs** column. If it is not satisfied, you are on the wrong entry.
3. Do the work in the linked plan, not from this file. This file has no implementation
   detail on purpose.
4. When the entry's **Done when** is satisfied *and committed*, update its Status here in
   the same commit, and move `NOW` down.

**Status values:** `done` · `now` · `next` · `blocked` · `parallel` · `open`. A cell may add a
qualifier after an em dash — how far along, how long it has been open — because for the items
that have sat longest that is the most useful thing on the row.

**Closed entries are removed, not kept as rows.** Finished work leaves an architecture note and
a line in the table below; git history is the archive. A queue that lists what is done stops
answering the one question it exists for. **The same rule was applied to this file's own prose on
2026-08-17**: the narrative of work already closed — R1's account of what it fixed, the Critical
finding the security review caught, the flaky-test diagnosis whose fix has landed — was deleted
rather than kept as a retrospective. What survives below is what somebody still has to do, plus
the open questions and unowned residuals that outlive the work that found them.

**One rule that is not negotiable:** an entry is `done` only when its evidence is in a
commit. A green local tree is the state this repository was already in once, and it cost a
week of confusion.

---

## NOW

**`NOW` is A10, and one gate stands between it and closed.** The hold that blocked it — NEW-21, on an
external usage limit — was released on 2026-08-20 and the row closed on 2026-08-21. **Task 17 and Task
19 Step 5 have landed. What remains is Step 6, and Step 6 is not a session's to take**: it requires
CI green on the commit, which is the third of the three conditions the DOS-P6 checkpoint names, and
the only route to it is a pushed branch and a pull request. **The founder chose on 2026-08-21 to keep
the commits local**, as they had for Track R the day before.

**So A10 is finished in the sense that its work is done and its local gate is green, and not finished
in the sense its own checkpoint defines** — the same honest state R2's row carried, and stated the same
way rather than rounded up to `done`. Nineteen commits are unpushed. Whoever pushes them opens the
pull request and reads the run.

`plans/2026-07-21-developer-os-knowledge-pipeline.md` survives for exactly one unticked step. It is
**not** deleted, because a plan is deleted when its last step closes and Step 6 has not.

> **NEW-21 closed by falsifying two shipped things rather than by confirming one, and that is the
> reason this entry was worth holding.** Five `codex exec` invocations showed: that the JSONL
> terminal-event rule selected the wrong event — a successful turn ends on a `turn.completed` usage
> record, so `finalJsonlLine` returned vendor telemetry with `ok: true` on **every** successful Codex
> run, invisibly; that the vendor **refuses this product's own shipped output schema** with HTTP 400
> before any turn begins, so `ingest` could never have returned a proposal on that vendor at all; and
> that the 2026-08-15 reading of the event vocabulary was itself too strong. Every gate had been green
> over all three, because nothing in this repository had ever handed a real vendor a real call. **The
> founder's decision to hold rather than close carrying a residual is what put a real call in front of
> this code**, and closing DOS-P6 on the arithmetic would have shipped a subsystem whose central path
> had never worked.
>
> The detection row is `CODEX_THREAD_ID` on presence. **What NEW-21 leaves is six `BACKLOG.md` §1
> rows — NEW-42 through NEW-47 — and five of them came from two fresh-context reviews of its own diff
> rather than from the work.** Only NEW-42 is the work's own: no interactive vendor session has ever
> been observed, on either vendor. The reviews added NEW-43 (the Codex arm of the security suite had
> never executed, which is why its fake vendor was wrong for its whole four-day life without a red
> test — **closed 2026-08-21**, the day after it was raised, by one case with `claude: false`),
> NEW-44 (a nested session mis-attributes its capture, and no row order fixes it), NEW-45 (the
> replacement rule's "last agent message wins" is an inference), NEW-46 (the trust check covers half of
> what the prose claimed about the widened spawn trigger) and NEW-47 (whether a model-run command can
> write raw bytes into the stream this product parses, which decides NEW-45's tie-break).
>
> **The reviews also found things that were fixed rather than registered, and those are not rows** —
> the guard the fix turned on could be deleted with the whole suite green, the schema gate's new
> traversal had three branches its own test never drove, and that test was written so it could not
> fail for the reason it existed. Counting the review's findings as rows gives the wrong set.

> **Step 5 spent most of its effort on something it did not expect to.** Its job was to make every
> `BACKLOG.md` §8 row carry an outcome; **four of the six 2026-08-13 rows had never been
> cross-referenced into the documents they amend**, eight days after ratification. `SESSION.md`
> already names four earlier amendments that went four days the same way. So a reader of design spec
> §13.4, §17.5, workflow-compiler §6, or this file's own DOS-P7 uninstall gate was getting the
> superseded contract. All four now carry it, and §8 records what each one gained.

**Read the spec's §3 and then the plan's five decisions** before touching this subsystem. The one
that reshapes it is spec 3.1: capture content is **agent-authored**, because `capture`'s declared
`session_end` trigger cannot supply the `text` that same contract requires without reading
`transcript_path`, which this product refuses on both vendors. Consequences the founder accepted — no
hooks ship in v1, `developer-os run claude|codex` is never built, `wrapper-required` is replaced by
`not-used`, and **nothing automatic captures anything**.

**Read three documents before touching the code**, in this order:
`docs/architecture/knowledge-pipeline.md`, `docs/architecture/codex-adapter.md`, and
`docs/architecture/threat-model.md`. The first is what replaces the plan; the second carries the
two-adapter table; the third carries the trust boundaries and §10's residuals with owners.

**`.superpowers/sdd/preflight-findings.md` graded Tasks 17, 18 and 19 clean**, which is not the same
as needing no correction — it graded Task 14 clean too, and three things it does not say still had to
be written before dispatch. That file is local scratch and not repository state; if it is gone, the
scan is owed again.

---

## Open on the product path, and not owned by any queue entry

Everything in this section is unfinished. Nothing here is a record of work that closed.

### One Foundation question left, raised by DOS-P6

**The first three were R2's and are closed.** A command can supply a precondition
(`PlannedFileMutation.expectedBeforeHash`, R2 Task 8); a removed secret no longer survives in an
unpruned backup (R2 Task 6); and `CliError` carries a `data` slot only a redactor can fill (R2 Task
7). All three were decided on 2026-08-17 and landed between 2026-08-19 and 2026-08-20; what each one
cost is in its commit message, and the residuals each left are `BACKLOG.md` §1 rows.

What is left is **two open founder questions from Foundation itself**, neither blocking anything:
whether `SpawnLockfRunner` needs a watchdog around the non-blocking `lockf` call, and whether
`<state>/transactions/` accumulating one permanent `0600` lock file per transaction id is intended or
wants collection. `BACKLOG.md` §2 and `foundation-constraints.md` carry them.

### Two gate-integrity residuals, both unowned

**The test suite is one contended run from red.** `apps/cli/src/commands/doctor.test.ts:228` needs
3.19 s of a 20 s budget on an idle machine and went over it under load; the fix that shipped is
`fileParallelism: false` in `tests/vitest.config.ts`, which removes the starvation and costs about
60 s of wall clock. **The underlying fragility is unowned and stays that way**, and this is the second
gate-integrity item this program has paid for.

**A third occurrence, 2026-08-17, recorded because this section asks for occurrences.** One
`npm run check` during Track R Task 1b ended `1 failed | 1986 passed`, in a run whose test phase took
**959 s against roughly 850 s when green** — consistent with the starvation diagnosis above. It did
not reproduce across two subsequent full runs. **The failing test's identity was not captured**,
which is the useful lesson rather than the datum: the run was piped through `tail`, so the name
scrolled past. Whoever next meets this should keep the full log.

**One symptom is explicitly not covered by that diagnosis.** Two red runs also produced
`ENOTEMPTY: rmdir …/backups/transactions/tx_fixture_001` during that fixture's own cleanup, which is a
filesystem race in recursive removal rather than CPU starvation. Serializing may only have made it
rarer. It is unmeasured and possibly still live.

**One unexplained gate failure, 2026-08-15, recorded because it is unexplained.** A single
`npm run check` exited 1 after lint and all 1956 tests had passed, with `$ tsc -b` as the last output —
so the failure was in `pnpm build` or `git diff --check`, and the edits in that round were **markdown
only**. It did not reproduce across four `pnpm build` runs and two full `npm run check` runs. No
diagnosis, no owner, and deliberately not dressed up as one. Noted so that a second occurrence is a
pattern rather than a first.

### What DOS-P6 still hands forward

- **No interactive vendor session has ever been observed, on either vendor** — NEW-42. Both detection
  rows and the whole of what is known about the JSONL protocol come from the non-interactive form,
  and the interactive one is where a founder captures. It needs a human at a terminal.
- **The replacement parsing rule carries one inference of its own** — NEW-45. Every recording holds
  exactly one `agent_message`, so "the last one wins" is unobserved and is labelled as such at the
  seam rather than written as a fact.
- **A nested session mis-attributes its capture** — NEW-44, and no row order fixes it.
- ~~The Codex arm of the security suite has never executed~~ — **NEW-43, closed 2026-08-21.** One case
  with `claude: false` lands an in-scope note through the Codex arm before refusing a traversal in it,
  which is what proves the reply was *understood* rather than merely unparsed: a drifted dialect writes
  nothing, and a case that only checked nothing was written outside the vault would sleep through the
  bug the row was about. Listed struck through rather than deleted because it is the row that shows
  what a session can close unaided — three of the other five are the same way.
- **The widened spawn trigger is only half closed by the trust check** — NEW-46.
- **Whether a model-run command can write raw bytes into the stream this product parses is
  unexamined** — NEW-47, which decides NEW-45's tie-break and settles from vendor source without
  spending anything.
- **`maxTurns` is bounded under Claude and silently dropped under Codex**, one shared schema with two
  behaviours. `codex-adapter.md` §11 is the full list with owners.

**The terminal-event rule is no longer on this list**, and how it left is the more useful fact: it did
not get confirmed, it got falsified. NEW-21's real call showed `finalJsonlLine` returned a
`turn.completed` usage record as an `ok: true` payload on every successful Codex run, and a second
defect beside it — the vendor refusing this product's own output schema — meant `ingest` had never
been able to run on that vendor at all. **Both were shipped, gated green, and reviewed.** What found
them was one real call, which is the argument for every remaining item on this list that says
"unobserved".

---

## What is closed, and what each closure left behind

Read the right-hand column before touching the subsystem it names; these documents are the reason the
plans could be deleted.

| Closed | When | What survives it |
|---|---|---|
| Foundation | 2026-08-01 | `docs/architecture/foundation.md`, `…-constraints.md` — the CLI, transactions, the manifest, and two open founder questions. Gate evidence: `docs/releases/foundation-checkpoint.md` |
| A6 · DOS-P2 Brain engine | 2026-08-10 | `docs/architecture/brain.md`, and `specs/…-brain-engine-design.md` as the design of record |
| A7 · DOS-P3 Workflow compiler | 2026-08-10 | `docs/architecture/workflow-schema.md` — §7 records four canonical workflows that say less than the product spec does, §8 nine residuals |
| A8 · DOS-P4 Claude adapter | 2026-08-11 | `docs/architecture/claude-adapter.md` — why in-place discovery beat a marketplace copy, why no hooks ship, and twelve residuals |
| A9 · DOS-P5 Codex adapter | 2026-08-12 | `docs/architecture/codex-adapter.md` — why the install is a local marketplace, the four spec amendments the real binary forced, the two-adapter table DOS-P6 inherits, and twelve residuals. **Its checkpoint is half met and §10 says which half.** |
| Track B · legacy exit | 2026-08-10 | `BACKLOG.md` §6 — what a cutover still has to know, and one decision (EXIT-1) that is a conversation with the founder rather than a backlog item |
| Track R · repository defects (R1) | 2026-08-15 | three `BACKLOG.md` §1 rows closed with a regression test each — NEW-18, NEW-17, NEW-19. It also turned **NEW-15** from an implementation into a founder decision, and added **NEW-22**. Both are §1 rows |

---

## Track A — product

Strictly sequential. Subsystem rows carry three gates: **S** = spec approved through a
brainstorming cycle, **P** = implementation plan written, **I** = implemented, reviewed and
committed. All three belong to that row; do not start `I` before `P` is written, and do not start
`P` before `S` is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A10 | DOS-P6 Knowledge pipeline — S / P / I | `plans/…-knowledge-pipeline.md`, one step left | nothing | L | program plan Task 6 checkpoint, after independent security review | **now** — **work done 2026-08-21; CI gate unmet.** `S` and `P` closed 2026-08-13; `I` is **19 of 19 tasks** and Task 19 Step 5 has landed. Step 6 needs a pull request, which the founder was asked for on 2026-08-21, after a direct push was refused, and declined |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P10 Managed instruction artifacts — S / P / I | to write | A11 | L | thirty-eight instruction artifacts install, drift-check and uninstall under manifest ownership on both vendors | blocked |
| A13 | DOS-P11 Hooks — S / P / I | to write | A12 | L | a hook is observed firing in a test, and every shipped handler names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — S / P / I | to write | A13 | M | every legacy tooling script is a product verb or a recorded refusal | blocked |
| A15 | DOS-P8 Founder shadow migration | to write against A11–A14's output — decided 2026-08-10 | A14, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A16 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A15, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A15 gets its own plan** — settled by the founder 2026-08-10, authored against the lifecycle it cuts
over to and not before it; `BACKLOG.md` §4 carries the reasoning and what it must contain. That plan is
now owed against A11 **through A14**, because the cutover's scope changed on 2026-08-20 and a plan
written against A11 alone would rehearse a rollback for a third of the product. **A16's equivalent
question is open**: no dedicated plan is mandated, and DOS-P8's answer does not transfer, because
DOS-P8 mutates the founder's live machine while DOS-P9 publishes a release.

**A12, A13 and A14 were added on 2026-08-20, and the entries below them were renumbered.** The founder
ruled that the legacy shared runtime is retired **entirely** rather than partially, and the product as
scoped could not absorb it: a parity read found three whole layers with no owner in any document —
eleven event hooks, thirty-eight instruction artifacts, and nine repository tooling scripts. The
cutover cannot retire what the product never built, so the three subsystems sit ahead of it. **The
renumbering was chosen over appending A14–A16 out of order**: thirteen citations across three files is
a cheap edit, and a queue whose numbers do not imply sequence is a queue that has to be read twice.
`BACKLOG.md` §3 carries what each spec must decide.

**The founder also ruled the sequence strict** — A10 → A11 → A12 → A13 → A14 → A15 — rather than
running the three new entries as a parallel track. None of them needs DOS-P7: their renderers closed
with DOS-P4 and DOS-P5 and their artifact mechanism closed with Foundation, so all three are
technically startable the moment A10 is. The cost of the ruling was that nothing new started while A10
waited on NEW-21, and that was put to the founder before it was taken. **That cost expired on
2026-08-20** when NEW-21 closed; the sequencing ruling itself stands.

---

## Track R — repository defects

Not subsystem work and not on the product path. This track exists because `BACKLOG.md` §1 accumulates
defects that reviews find while doing something else, each with an owner named as "whoever next
touches it — DOS-P7 by default" — and DOS-P7 is two gates away. A row lands here when its fix is
already specified and takes no decision away from the founder; anything carrying an open question
stays in §1 until that question is answered.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| R2 | Ten decided defects — six `BACKLOG.md` §1 rows, three Foundation requests, one DOS-P7 gap | deleted on closure, as a finished plan is | nothing | M | every closed row left §1, every amendment registered in §8, CI green on the commit | **code done 2026-08-20; CI gate unmet** |

**The fifth gate is unmet, and the row says so rather than reading as complete.** R2's eleven tasks
landed in five commits with `npm run check` green on the last of them, and the founder chose on
2026-08-20 to leave them local. On 2026-08-21 they asked for everything to go to `development` without
creating a branch, **and the remote refused it**: a ruleset on that branch requires a pull request,
and a pull request needs a head branch, so "land this without creating a branch" is not something this
repository permits. Told that the only route was one temporary branch merged and deleted, **the
founder chose to leave everything local.** So the gate that exists precisely because a green local
gate missed three DOS-P2 defects still has not run, and the reason is now a decision that was made
with the constraint on the table rather than an option nobody had tested.

**Two things were learned by trying.** `check.yml` scoped its `push:` trigger to `feat/foundation`,
a branch that **no longer exists on the remote** — the rule kept anything from landing unchecked, but
that trigger had stopped naming anything, and it now names `development`. And the protection is a
**ruleset**, which `.../branches/development/protection` reports as 404 "not protected"; the endpoint
that answers is `.../rules/branches/development`. Reading the first one and believing it is what put a
false claim into three files for the length of one commit.

**R2 existed because the five decisions those rows were waiting on were taken on 2026-08-17.** Each had
sat as "open" while being unimplementable, which is the state this track exists to resolve rather than
accumulate. What was decided:

- **NEW-15** — resolve, then check: canonicalize the binary and check the **resolved** target and its
  ancestors, refuse an owner that is neither the user nor root, refuse other-writable with or without
  the sticky bit, and **allow group-writable when the directory's owner is the user** — which is what
  lets an ordinary Homebrew install pass where the withdrawn strict guard refused it.
- **NEW-22** — a symlinked content root is **supported**: the content root is canonicalized into the
  containment anchor instead of being measured against the vault root.
- **NEW-16** — user redaction patterns get a `config.toml` `[redaction]` table, and the `.strict()`
  schema amendment is registered rather than slipped in.
- **NEW-11** — an invisible tag is a **lint warning**. The note still indexes.
- **NEW-12's path half** — split by provenance: a path this product derived itself keeps the dash rule
  and loses the word list. Not closed by narrowing the pattern, which its row forbids.

Three Foundation requests and the `accepted → rejected` gap are in the same plan, decided the same
day, because they were unowned for the same reason: no entry on the product path reaches them.

**Twenty-two §1 rows were deliberately not in R2**, and the session that finished it did not sweep them up
— R2 has closed all five it was opened for. *(That twenty-two is a snapshot of 2026-08-20 before A10's
work landed; §1 holds twenty-seven now, and the live count is at the end of this file.)* **Four belonged
to somebody else:** **NEW-21** was the founder's and blocked A10 until it closed on 2026-08-20, leaving
**NEW-42**, which needs a human at an interactive vendor session; **NEW-20** and **NEW-13** were
registered as deliberately-not-fixed; **NEW-7** needs ten minutes with a machine that has Obsidian
rather than an agent. **Eighteen came out of R2's own reviews**, registered between 2026-08-17 and 2026-08-19 by the reviews that produced them. **NEW-27** and **NEW-28** came from NEW-12: a derived path that will wear a write scope's name, and
an interpolation in `ingest` that no longer has an end-to-end test because no production path can
reach it. **NEW-24**, **NEW-25** and **NEW-26** came from NEW-16: a common redaction pattern that
refuses every ingest and cannot be diagnosed without widening a persisted type; two partially
overlapping patterns that cannot both redact; and a vendor's stdout redacted with built-in classes
only, because the process runner is built before any configuration is read. **NEW-29** came from the
same review and is a gate-integrity item rather than a product one: a wall-clock assertion in the
standing suite that can redden an unrelated commit. **None is R2's to fix, and the count is the
honest cost of closing five rows — though NEW-22 closed leaving nothing at all, which is the
counter-example worth keeping in view** — a defect that closes cleanly and leaves nothing is rarer than
this queue used to imply. The six named above are the ones this section already knew — **NEW-27**, **NEW-28**, **NEW-24**, **NEW-25**, **NEW-26** and **NEW-29**, which it miscounted as eight. Twelve more have landed since: **NEW-30** and **NEW-31** from NEW-11, **NEW-32** and **NEW-33** from NEW-15, **NEW-34** from Foundation request 2, **NEW-35** from the review that verified NEW-15's closure, and **NEW-36**, **NEW-37**, **NEW-38** and **NEW-39** from request 3, **NEW-40** from Task 8 and **NEW-41** from Task 9. 6 + 12 = 18, and 4 + 18 = 22 — matching `BACKLOG.md` §1, which holds the rows and therefore wins.

**A third came from that review and is already closed — NEW-23, by Task 1b.** Over four hundred
`path:line` citations across the documents were maintained by hand, `npm run check` was green with
every one of them broken, and repairing two of them in Task 1 silently broke twelve more. The gate
reported twelve defects on its first run, then four more once its extractor was corrected to carry a
citation across lines — the form that an evidence table written as one file name and eight bare
ranges depends on, and that a per-line reader cannot see.

**§1 therefore holds twenty-two rows now R2 has closed, not nine**, and the arithmetic is worth stating because
it moves every time a task lands. It started at nine. NEW-12 closed and left two residuals; NEW-23
arrived from the same review and closed the same day; NEW-16 closed and left **three**; NEW-11 closed and left NEW-30 and NEW-31; NEW-22 closed and left nothing; NEW-15 closed and left NEW-32 and NEW-33; the review that closed it also observed NEW-29, a timing assertion that can redden an unrelated commit; Foundation request 2 left NEW-34; the review that verified NEW-15's closure left NEW-35, which is a residual that existed all along and was filed under the wrong row — the misattribution repeated here until a review caught it; and request 3 left NEW-36, NEW-37, NEW-38 and NEW-39. A row leaves §1
when its fix is **committed**, not when its question is answered, and all five R2 was opened for have now landed.

**NEW-15 is still the cautionary case, and a decided policy does not repeal the lesson.** It read like
an implementation for a day and cost a full task to discover it was not: the guard was built, tested,
and withdrawn before commit, because the policy that row implied refuses this product's own vendors —
`claude` and `codex` are both symlinks on the founder's machine and `/opt/homebrew/bin` is
group-writable, so the rule as written would have made `capture` record `unknown` forever and `ingest`
exit 5 on every run. What changed is that a policy now exists; the row did not become implementable by
being read again. **A row being open is not an invitation to implement it.** Read which group it is in
first.

---

## Track L — long lead time, start early

Both gate the last entry in Track A. Both depend on somebody who is not in this room.
Starting them at A16 adds their full lead time to the release date for no reason.

| # | Entry | Owner | Gates | Done when | Status |
|---|---|---|---|---|---|
| L1 | Select an OSI-approved license and obtain qualified legal approval | Founder + counsel | A16, public visibility | approved text committed as `LICENSE` | open, startable now |
| L2 | Remote verification — destination remote, visibility, branch protections | Founder, outside this environment | A15, A16 | `remoteVerification` no longer `blocked_by_environment` | open, startable now |

**L2 no longer blocks pushing.** The remote exists and CI runs on it, as of 2026-08-10; pushing a
topic branch and opening a pull request is routine. What L2 still gates is the cutover and the
public release — and merging remains the founder's, because the repository rule requiring a pull
request exists so a human sees it first.

---

## Where the detail lives

| You want | Read |
|---|---|
| how to run a session start to finish | `SESSION.md` |
| what to do next | this file |
| what a missing spec must decide, and what it produces | `BACKLOG.md` §3 |
| what the knowledge pipeline is, and why nothing captures automatically | `docs/architecture/knowledge-pipeline.md`, then the spec it points at |
| the three steps that close DOS-P6 | `plans/2026-07-21-developer-os-knowledge-pipeline.md` |
| what the Brain engine is, and its six residuals | `docs/architecture/brain.md` |
| what the workflow compiler is, what it deliberately cannot do, and the four workflows that say less than the product spec does | `docs/architecture/workflow-schema.md` |
| what the Claude adapter is, why it ships no hooks, and its twelve residuals | `docs/architecture/claude-adapter.md` |
| what the Codex adapter is, why the install is a local marketplace, and the two-adapter table DOS-P6 inherits | `docs/architecture/codex-adapter.md` |
| the consolidated trust boundaries, and the residuals with owners | `docs/architecture/threat-model.md` |
| what Foundation delivered, and what it deliberately cannot do | `docs/architecture/foundation.md` |
| the per-task Foundation constraints, and two open founder questions | `docs/architecture/foundation-constraints.md` |
| which repository directories do not exist yet | `BACKLOG.md` §5 — none do |
| what was frozen on the legacy runtime and why | `BACKLOG.md` §6 |
| the gates every commit must pass | `BACKLOG.md` §7 |
| the product design | `specs/2026-07-21-developer-os-design.md` |
| which approved documents have been amended since approval | `BACKLOG.md` §8 |
| why no task reads the founder's legacy runtime | `plans/…-program.md`, Global Constraints |

## Counting what is left

Counted 2026-08-17 by reading the files rather than by editing a number, which is the discipline the
DOS-P6 plan's Task 19 Step 5 imposes on the residual arithmetic, applied to the file that imposes it.

**Recounted 2026-08-20, and the denominator moved.** Three subsystems were added that day; nothing
reopened and nothing closed. Where this section said eight subsystems and six milestones, it now says
ten and seven, and the arithmetic below is derived from the Track A table rather than edited on top of
the old numbers.

**Five subsystems of ten are closed** — Foundation, DOS-P2, DOS-P3, DOS-P4, DOS-P5 — including both
of the ones that turn a canonical workflow into something an agent can load. Neither of them can
execute what it renders, which is the whole of what remains on the product path.

**Seven Track A entries remain.** DOS-P6's implementation, its spec and plan closed 2026-08-13. Then
DOS-P7, DOS-P10, DOS-P11 and DOS-P12 — spec, plan and implementation apiece, and **not one of those
four has a document of any kind yet**, which is eight documents owed before any of their code is
written. Then two entries that are not subsystems — the cutover (A15) and the release (A16) — plus
Track L's two, which are not engineering work at all. **An implementation is done when its checkpoint
holds with evidence in a commit and CI is green on it, not when the tasks are ticked.**

**Twenty-six plan steps are unticked**, and they are the whole of the written work. The figure has
moved twice in two days and both moves are recorded so the next recount has a baseline: **28** until
Task 17's last step closed on 2026-08-20, **27** until Task 19 Step 5 closed on 2026-08-21, **26**
now.

| Plan | Task | Steps left |
|---|---|:---:|
| knowledge pipeline | 19 — run the gate and open the pull request | 1 |
| program | 7 — Git, automation, update, release lifecycle | 7 |
| program | 8 — founder shadow migration | 10 |
| program | 9 — public beta and v1 | 8 |

**DOS-P10, DOS-P11 and DOS-P12 contribute no rows to that table, and their absence is not good news.**
A plan step can only be counted once a plan exists, and all three are at the stage before their spec.
The written work is twenty-six steps; the *unwritten* work is three spec cycles, three plans, and
three implementations, and it is the larger half. Do not read the table as the total.

Program Task 6 shows one unticked box and it is **not** work: the hooks box was rewritten to record
that hooks are declined, and nothing shipped for it by design.

**`BACKLOG.md` §1 is twenty-five open repository defects** — twenty-seven `### NEW-` headings on
2026-08-21, less the two closed that day, NEW-13 and NEW-43. **None waits on R2**, which is closed:
eighteen came out of R2's own reviews; three (NEW-44, NEW-46, NEW-47) out of the reviews of the NEW-21
diff and startable in a session; and four need somebody or something no session has — NEW-42 an
interactive vendor session, NEW-45 the founder's credits, NEW-20 registered as deliberately not fixed,
NEW-7 a machine with Obsidian. 18 + 3 + 4 = 25.

**NEW-21 left six rows and one has already gone.** NEW-43 closed the day after it was raised — but it
was **one of four** a session could have taken, not the only one: NEW-44, NEW-46 and NEW-47 are still
open, and NEW-47 needs no credits either. That is the shape this queue should keep expecting: reviews
add rows faster than work closes them, and the ones that close fastest are the ones nobody has to be
asked about. **Eighteen of the twenty-five are the honest cost of closing ten decided defects with a
fresh-context review on each**, and a review that finds nothing is rarer than one that finds a
residual.

**Add six open decisions** that are not defect rows: the two Foundation founder questions, DOS-P9's
dedicated-plan question, and the three `BACKLOG.md` §8 amendments awaiting ratification — spec §8.2's
`[redaction]` schema, `foundation.md` §2's `CliError` slot, and knowledge-pipeline §5.5's
`accepted → rejected` row.

**A10 became startable on 2026-08-20** and is the only thing on the product path that is: NEW-21
closed when the external usage limit reset, and Step 5 landed 2026-08-21, so what remains of A10 is
Task 19 Step 6 alone, which needs a pull request. A11 waits
on A10, and A12, A13 and A14 wait on A11 by the founder's sequencing ruling rather than by any
technical dependency. **Step 6 opens a pull request**, which is the founder's call rather than a
session's — see the `NOW` section.
**Track R is closed as of 2026-08-20.** R2 was its only entry, and its eleven tasks landed in four
commits — the three Foundation requests, the DOS-P7 gap, and the six §1 rows the decisions of
2026-08-17 unblocked. The four §1 rows that were never R2's still wait on the founder or on a
machine, and the eighteen its reviews raised are new work for whoever takes §1 next.
