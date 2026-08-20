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

**`NOW` is A10, and A10 is held.** DOS-P6 cannot close until NEW-21 does, on the founder's decision
of 2026-08-15 recorded in the box below, and NEW-21 is blocked on an external usage limit expected to
reset on or after 2026-08-20. **A10 is not abandoned; it is waiting.**

**What is left of A10 is three unticked steps and nothing else.**
`plans/2026-07-21-developer-os-knowledge-pipeline.md` — nineteen tasks, **seventeen landed**
2026-08-13/14/15, their step lists deleted on closure and replaced by a table of what survives each.

- **Task 17, Step 3** — the Codex agent-detection row. Claude's landed 2026-08-15; Codex's account
  had exhausted its usage limit, so every `codex exec` ended `turn.failed` and no run reached a model
  response. The remainder is `BACKLOG.md` §1 **NEW-21**, which carries the full closing procedure
  because this plan is deleted when DOS-P6 closes.
- **Task 19, Steps 5 and 6** — closing the documents and running the gate. Both wait on Task 17: Step
  5 requires every `BACKLOG.md` §8 row to carry an outcome, and the Codex spec §14.1 row is discharged
  by Task 17 alone.

> **Asked and settled 2026-08-15: DOS-P6 holds.** The Checkpoint names three conditions — the five
> criteria of Step 2 with evidence in a commit, the independent security review returned and
> dispositioned, and CI green on that commit — and **none of them mentions Task 17**. All three are
> met, and `BACKLOG.md` §5 is empty, so that sub-item of Step 5 is discharged too. So closing DOS-P6
> and carrying Task 17's remainder as **NEW-21** was available, and was **put to the founder, who
> chose to hold** until NEW-21 closes on or after 2026-08-20. **Do not reopen this from the
> arithmetic** — a later session that rediscovers the checkpoint wording will find the same opening,
> and the answer to it is already given. A11 stays blocked meanwhile, deliberately.

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

- **The `codex exec --json` JSONL terminal-event rule ships provisional on the success path** — NEW-21.
- **`maxTurns` is bounded under Claude and silently dropped under Codex**, one shared schema with two
  behaviours. `codex-adapter.md` §11 is the full list with owners.

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
| A10 | DOS-P6 Knowledge pipeline — S / P / I | `plans/…-knowledge-pipeline.md`, three steps left | NEW-21 | L | program plan Task 6 checkpoint, after independent security review | **now** — held. `S` and `P` closed 2026-08-13; `I` is **17 of 19 tasks**, and the security review returned ready. Task 17 Step 3 and Task 19 Steps 5–6 remain |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write against A11's output — decided 2026-08-10 | A11, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A12 gets its own plan** — settled by the founder 2026-08-10, authored against A11's output and not
before it; `BACKLOG.md` §4 carries the reasoning and what it must contain. **A13's equivalent question
is open**: no dedicated plan is mandated, and DOS-P8's answer does not transfer, because DOS-P8 mutates
the founder's live machine while DOS-P9 publishes a release.

---

## Track R — repository defects

Not subsystem work and not on the product path. This track exists because `BACKLOG.md` §1 accumulates
defects that reviews find while doing something else, each with an owner named as "whoever next
touches it — DOS-P7 by default" — and DOS-P7 is two gates away. A row lands here when its fix is
already specified and takes no decision away from the founder; anything carrying an open question
stays in §1 until that question is answered.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| R2 | Ten decided defects — six `BACKLOG.md` §1 rows, three Foundation requests, one DOS-P7 gap | `plans/2026-08-17-repository-defects-r2.md`, eleven tasks | nothing | M | every closed row left §1, every amendment registered in §8, CI green on the commit | **done 2026-08-20** |

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
— R2 has closed all five it was opened for. **Four belong to somebody else:** **NEW-21** is the founder's and blocks
A10; **NEW-20** and **NEW-13** were registered as deliberately-not-fixed; **NEW-7** needs ten minutes
with a machine that has Obsidian rather than an agent. **Eighteen came out of R2's own reviews**, registered between 2026-08-17 and 2026-08-19 by the reviews that produced them. **NEW-27** and **NEW-28** came from NEW-12: a derived path that will wear a write scope's name, and
an interpolation in `ingest` that no longer has an end-to-end test because no production path can
reach it. **NEW-24**, **NEW-25** and **NEW-26** came from NEW-16: a common redaction pattern that
refuses every ingest and cannot be diagnosed without widening a persisted type; two partially
overlapping patterns that cannot both redact; and a vendor's stdout redacted with built-in classes
only, because the process runner is built before any configuration is read. **NEW-29** came from the
same review and is a gate-integrity item rather than a product one: a wall-clock assertion in the
standing suite that can redden an unrelated commit. **None is R2's to fix, and the count is the
honest cost of closing five rows — though NEW-22 closed leaving nothing at all, which is the
counter-example worth keeping in view** — a defect that closes cleanly and leaves nothing is rarer than
this queue used to imply. The six named above are the ones this section already knew — **NEW-27**, **NEW-28**, **NEW-24**, **NEW-25**, **NEW-26** and **NEW-29**, which it miscounted as eight. Twelve more have landed since: **NEW-30** and **NEW-31** from NEW-11, **NEW-32** and **NEW-33** from NEW-15, **NEW-34** from Foundation request 2, **NEW-35** from the review that verified NEW-15's closure, and **NEW-36**, **NEW-37**, **NEW-38** **NEW-39** from request 3, **NEW-40** from Task 8 and **NEW-41** from Task 9. 6 + 12 = 18, and 4 + 18 = 22 — matching `BACKLOG.md` §1, which holds the rows and therefore wins.

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
Starting them at A13 adds their full lead time to the release date for no reason.

| # | Entry | Owner | Gates | Done when | Status |
|---|---|---|---|---|---|
| L1 | Select an OSI-approved license and obtain qualified legal approval | Founder + counsel | A13, public visibility | approved text committed as `LICENSE` | open, startable now |
| L2 | Remote verification — destination remote, visibility, branch protections | Founder, outside this environment | A12, A13 | `remoteVerification` no longer `blocked_by_environment` | open, startable now |

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

**Five subsystems of eight are closed** — Foundation, DOS-P2, DOS-P3, DOS-P4, DOS-P5 — including both
of the ones that turn a canonical workflow into something an agent can load. Neither of them can
execute what it renders, which is the whole of what remains on the product path.

**Four milestones remain of the six this program counted**, each L: DOS-P6's implementation (its spec
and plan closed 2026-08-13), then DOS-P7's spec, plan and implementation. Then two entries that are
not subsystems — the cutover (A12) and the release (A13) — plus Track L's two, which are not
engineering work at all. **An implementation is done when its checkpoint holds with evidence in a
commit and CI is green on it, not when the tasks are ticked.**

**Twenty-eight plan steps are unticked**, and they are the whole of the written work:

| Plan | Task | Steps left |
|---|---|:---:|
| knowledge pipeline | 17 — one real run per vendor | 1 |
| knowledge pipeline | 19 — close the documents, run the gate | 2 |
| program | 7 — Git, automation, update, release lifecycle | 7 |
| program | 8 — founder shadow migration | 10 |
| program | 9 — public beta and v1 | 8 |

Program Task 6 shows one unticked box and it is **not** work: the hooks box was rewritten to record
that hooks are declined, and nothing shipped for it by design.

**`BACKLOG.md` §1 is twenty-two repository defects**, counted by listing the `### NEW-` headings on
2026-08-20. **None waits on R2**, which is closed: four belong to somebody else (NEW-21 the founder's,
NEW-20 and NEW-13 registered as deliberately not fixed, NEW-7 needing a machine with Obsidian) and
eighteen came out of R2's own reviews. That number is the honest cost of closing ten decided defects
with a fresh-context review on each, and it is the shape this queue should expect: a review that
finds nothing is rarer than one that finds a residual.

**Add six open decisions** that are not defect rows: the two Foundation founder questions, DOS-P9's
dedicated-plan question, and the three `BACKLOG.md` §8 amendments awaiting ratification — spec §8.2's
`[redaction]` schema, `foundation.md` §2's `CliError` slot, and knowledge-pipeline §5.5's
`accepted → rejected` row.

**Nothing on the *product path* is startable by an agent today**, and that is unchanged: A10 waits on
NEW-21, which waits on an external usage limit, and A11 waits on A10. **Track R is closed as of 2026-08-20.** R2 was its only entry, and its eleven tasks landed in four
commits — the three Foundation requests, the DOS-P7 gap, and the six §1 rows the decisions of
2026-08-17 unblocked. The four §1 rows that were never R2's still wait on the founder or on a
machine, and the eighteen its reviews raised are new work for whoever takes §1 next.
