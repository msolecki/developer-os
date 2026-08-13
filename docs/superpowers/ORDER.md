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
answering the one question it exists for.

**One rule that is not negotiable:** an entry is `done` only when its evidence is in a
commit. A green local tree is the state this repository was already in once, and it cost a
week of confusion.

---

## NOW

**A10 — DOS-P6 Knowledge pipeline, at its `I` gate. Both documents exist: the spec was approved by
the founder on 2026-08-13 and its implementation plan was written the same day.**
`plans/2026-07-21-developer-os-knowledge-pipeline.md`, nineteen tasks, against
`specs/2026-07-21-developer-os-knowledge-pipeline-design.md`. Nothing else is in progress. DOS-P5
closed on 2026-08-12 and its plan is deleted; `docs/architecture/codex-adapter.md` is what replaced
it.

**Sessions execute that plan one task at a time**, under `superpowers:subagent-driven-development` —
a different agent implements and reviews each task, and a task is not done until its reviewer says
so. **Seven of the nineteen have landed** (Tasks 1–7, 2026-08-13); **the next session starts at Task
8**, the capture envelope and the pipeline that fills it in. **Task 17 stops and asks** — it spends
the founder's credits on a real model call, which is the only way the JSONL terminal-event rule gets
settled.

**Read `.superpowers/sdd/preflight-findings.md` before dispatching any task.** An adversarial scan
on 2026-08-13 found thirty-eight defects across Tasks 3–19, and twelve of the remaining tasks need a
plan edit before their brief is extracted. Tasks 14, 17, 18 and 19 are the ones it found clean.
That file is local scratch and not repository state; if it is gone, the scan is owed again.

**Read the spec's §3 and then the plan's five decisions.** The spec's five decisions each carry
their cost; the one that reshapes the subsystem is 3.1: capture content is **agent-authored**,
because `capture`'s declared `session_end` trigger cannot supply the `text` that same contract
requires without reading `transcript_path`, which this product refuses on both vendors. Consequences
the founder accepted — no hooks ship in v1, `developer-os run claude|codex` is never built,
`wrapper-required` is replaced by `not-used`, and **nothing automatic captures anything**. The
plan's five decisions are what it had to settle that the spec did not; four of them, and two more
its tasks raised, are ratified rows in `BACKLOG.md` §8 beside the spec's own six — twelve rows, all
ratified 2026-08-13, each leaving the table when the task named beside it lands.

**Read three documents before touching the code**, in this order:
`docs/architecture/codex-adapter.md`, `docs/architecture/claude-adapter.md`, and
`docs/architecture/brain.md`. DOS-P6 is the first subsystem that consumes *both* adapters, and the
two notes are written for exactly that reader.

**What DOS-P6 inherits, and it is the largest inheritance in the program.** Six of DOS-P4's twelve
residuals and seven of DOS-P5's twelve are its. The two that shape the spec rather than merely
appear in it:

- **The capture contract is the keystone.** It decides what a hook body does, which is what unblocks
  hooks, which is what makes a lifecycle capability observable, which is what turns
  `wrapper-required` into `yes`. Neither adapter ships `hooks/hooks.json` and both report
  `plugin_hooks` as `unknown`; restoring hooks needs the bodies, an executable-bit mechanism and a
  firing test, in one change, for both adapters at once.
- **`capture`, `ingest` and `review` name verbs with no handler anywhere in this product.** Three of
  the six shipped skills reference commands that do not exist, in both vendor trees. That is the
  half of Task 4's *and* Task 5's checkpoints that neither adapter could close, and it is the first
  thing DOS-P6 makes true.

**Also DOS-P6's, and easy to miss:** the entire two-gate capability machinery has no production
caller today — `doctor` never turns probing on — so DOS-P6 is the first to exercise it; the
`codex exec --json` JSONL terminal-event rule ships **provisional and unverified**, because settling
it needs a real model call the founder declined on 2026-08-12; and `maxTurns` is bounded under
Claude and silently dropped under Codex, one shared schema with two behaviours. `codex-adapter.md`
§11 is the full list with owners.

**What is closed, and what each closure left behind.** Read the right-hand column before touching
the subsystem it names; these documents are the reason the plans could be deleted.

| Closed | When | What survives it |
|---|---|---|
| Foundation | 2026-08-01 | `docs/architecture/foundation.md`, `…-constraints.md` — the CLI, transactions, the manifest, and two open founder questions. Gate evidence: `docs/releases/foundation-checkpoint.md` |
| A6 · DOS-P2 Brain engine | 2026-08-10 | `docs/architecture/brain.md`, and `specs/…-brain-engine-design.md` as the design of record |
| A7 · DOS-P3 Workflow compiler | 2026-08-10 | `docs/architecture/workflow-schema.md` — §7 records four canonical workflows that say less than the product spec does, §8 nine residuals |
| A8 · DOS-P4 Claude adapter | 2026-08-11 | `docs/architecture/claude-adapter.md` — why in-place discovery beat a marketplace copy, why no hooks ship, and twelve residuals, six of them DOS-P6's |
| A9 · DOS-P5 Codex adapter | 2026-08-12 | `docs/architecture/codex-adapter.md` — why the install is a local marketplace, the two roots that share one type, the four spec amendments the real binary forced, the two-adapter table DOS-P6 inherits, and twelve residuals, seven of them DOS-P6's. **Its checkpoint is half met and §10 says which half.** |
| Track B · legacy exit | 2026-08-10 | `BACKLOG.md` §6 — what a cutover still has to know, and one decision (EXIT-1) that is a conversation with the founder rather than a backlog item |

---

## Track A — product

Strictly sequential. Subsystem rows carry three gates: **S** = spec approved through a
brainstorming cycle, **P** = implementation plan written, **I** = implemented, reviewed and
committed. All three belong to that row; do not start `I` before `P` is written, and do not start
`P` before `S` is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A10 | DOS-P6 Knowledge pipeline — S / P / I | `plans/…-knowledge-pipeline.md`, nineteen tasks, written 2026-08-13 | — | L | program plan Task 6 checkpoint, after independent security review | **now** — `S` approved and `P` written 2026-08-13; `I` is **7 of 19**, next is Task 8 |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write against A11's output — decided 2026-08-10 | A11, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A10's dependencies are all discharged and both its gates are closed**, so nothing stands between it
and code. **A12 gets its own plan** — settled by the founder 2026-08-10, authored against A11's
output and not before it; `BACKLOG.md` §4 carries the reasoning and what it must contain.

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
| what the knowledge pipeline is, why nothing captures automatically, and the six documents it amends | `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — **approved 2026-08-13** |
| how it gets built, in nineteen tasks, and the five decisions the spec left to the plan | `plans/2026-07-21-developer-os-knowledge-pipeline.md` |
| what the Brain engine is, and its six residuals | `docs/architecture/brain.md` |
| what the workflow compiler is, what it deliberately cannot do, and the four workflows that say less than the product spec does | `docs/architecture/workflow-schema.md` |
| what the Claude adapter is, why it ships no hooks, and its twelve residuals | `docs/architecture/claude-adapter.md` |
| what the Codex adapter is, why the install is a local marketplace, and the two-adapter table DOS-P6 inherits | `docs/architecture/codex-adapter.md` |
| what Foundation delivered, and what it deliberately cannot do | `docs/architecture/foundation.md` |
| the per-task Foundation constraints, and two open founder questions | `docs/architecture/foundation-constraints.md` |
| the Foundation gate evidence, as it stood on 2026-08-01 | `docs/releases/foundation-checkpoint.md` |
| which repository directories do not exist yet | `BACKLOG.md` §5 |
| what was frozen on the legacy runtime and why | `BACKLOG.md` §6 |
| the gates every commit must pass | `BACKLOG.md` §7 |
| the product design | `specs/2026-07-21-developer-os-design.md` |
| which approved documents have been amended since approval | `BACKLOG.md` §8 |
| why no task reads the founder's legacy runtime | `plans/…-program.md`, Global Constraints and Task 0 |

## Counting what is left

Foundation, DOS-P2, DOS-P3, DOS-P4 and DOS-P5 are closed — five subsystems of eight, and both of
the ones that turn a canonical workflow into something an agent can actually load. **Neither of them
can execute what it renders**, which is the whole of what remains on the product path.

**Six milestones were counted here**, each L: DOS-P6's spec, plan and implementation; DOS-P7's spec,
plan and implementation. Then two more entries that are not subsystems — the cutover (A12) and the
release (A13) — plus Track L's two items, which are not engineering work at all.

**Two of the six closed on 2026-08-13** — DOS-P6's spec, approved by the founder, and its
implementation plan, written against it the same day. **Four remain**: DOS-P6's implementation, then
DOS-P7's spec, plan and implementation. An implementation is done when its checkpoint holds with
evidence in a commit and CI is green on it, not when the tasks are ticked.

`BACKLOG.md` §1 is four repository defects: NEW-7, which needs ten minutes with a machine that has
Obsidian rather than an agent; NEW-11, which is the same invisible-character rule that closed
NEW-10 applied to `tags`, `summary` and the duplicates key; NEW-12, where the argv screen's word
list is applied to free-form prose that only the positional half of the screen protects; and
NEW-13, where two artifact roots share one type and the wrong one installs cleanly rather than
refusing — **NEW-13 is DOS-P6's Task 4** and closes there.
