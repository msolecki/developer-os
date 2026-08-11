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

**A9 — DOS-P5 Codex adapter, at its `P` gate.** The founder approved the spec on 2026-08-11, so
the next thing anyone writes is `plans/2026-07-21-developer-os-codex-adapter.md`. Use
`superpowers:writing-plans`. No code before that plan exists — a Global Constraint of the program
plan, not a preference.

**Read three documents before writing it**, in this order: the approved spec, whose §14 is
normative and whose §12 is the table DOS-P6 inherits; `docs/architecture/claude-adapter.md`,
because three of its residuals come due the moment a second adapter exists — the duplicated
code-point sort, the missing `ClaudeAdapter` façade, and `detectWorkflowDrift` reporting drift in
only one direction; and `docs/architecture/workflow-schema.md` §7 and §8, which both adapters
inherit.

**Two things the Codex spec settled that a reader of DOS-P4 would guess wrong.** Codex has no
in-place plugin discovery, so the install is a **local marketplace** — which does resolve to real
on-disk paths — registered and installed by `codex plugin` itself, because the vendor's tool should
own the vendor's config rather than a hand-rolled TOML merge. And **`AGENTS.override.md` is never
written at any scope**: in global scope Codex reads it *instead of* `AGENTS.md`, so creating one
would silently suppress the user's own instructions.

**What is closed, and what each closure left behind.** Read the right-hand column before touching
the subsystem it names; these documents are the reason the plans could be deleted.

| Closed | When | What survives it |
|---|---|---|
| Foundation | 2026-08-01 | `docs/architecture/foundation.md`, `…-constraints.md` — the CLI, transactions, the manifest, and two open founder questions. Gate evidence: `docs/releases/foundation-checkpoint.md` |
| A6 · DOS-P2 Brain engine | 2026-08-10 | `docs/architecture/brain.md`, and `specs/…-brain-engine-design.md` as the design of record |
| A7 · DOS-P3 Workflow compiler | 2026-08-10 | `docs/architecture/workflow-schema.md` — §7 records four canonical workflows that say less than the product spec does, §8 nine residuals |
| A8 · DOS-P4 Claude adapter | 2026-08-11 | `docs/architecture/claude-adapter.md` — why in-place discovery beat a marketplace copy, why no hooks ship, and twelve residuals, six of them DOS-P6's |
| Track B · legacy exit | 2026-08-10 | `BACKLOG.md` §6 — what a cutover still has to know, and one decision (EXIT-1) that is a conversation with the founder rather than a backlog item |

---

## Track A — product

Strictly sequential. Subsystem rows carry three gates: **S** = spec approved through a
brainstorming cycle, **P** = implementation plan written, **I** = implemented, reviewed and
committed. All three belong to that row; do not start `I` before `P` is written, and do not start
`P` before `S` is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A9 | DOS-P5 Codex adapter — S / P / I | `plans/…-codex-adapter.md` — **to write** | — | L | program plan Task 5 checkpoint: Claude-only, Codex-only and dual installs all work | **now** — `S` approved 2026-08-11; `P` is the next document |
| A10 | DOS-P6 Knowledge pipeline — S / P / I | to write | A9 | L | program plan Task 6 checkpoint, after independent security review | blocked |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write against A11's output — decided 2026-08-10 | A11, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A10 needed both adapters and now needs only A9.** DOS-P4 closed on 2026-08-11, and it hands
DOS-P6 six of the twelve residuals in `claude-adapter.md` §9 — the hooks restoration, the
`developer-os run claude` wrapper, and the four capture and ingest verbs that have no handler
anywhere in this product. Until those land, three of the six shipped skills name a command that
does not exist.

**A12 decision, settled 2026-08-10 by the founder: it gets its own plan.** The program plan
enumerates Task 8's ten steps inline and mandates neither a spec nor a plan; the founder ruled that
it gets one anyway, because A12 is the only task that mutates the live machine and its rollback
must be rehearsed before cutover is declared complete. Authored against A11's output, not before
it — a cutover plan written ahead of the lifecycle it cuts over to would specify commands that do
not exist. `BACKLOG.md` §4 carries what it must contain.

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
| what the Brain engine is, and its six residuals | `docs/architecture/brain.md` |
| what the workflow compiler is, what it deliberately cannot do, and the four workflows that say less than the product spec does | `docs/architecture/workflow-schema.md` |
| what the Claude adapter is, why it ships no hooks, and its twelve residuals | `docs/architecture/claude-adapter.md` |
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

Foundation, DOS-P2, DOS-P3 and DOS-P4 are closed — four subsystems of eight, and the two that
turn a canonical workflow into something an agent can actually load.

**Eight milestones remain**, each L: DOS-P5's plan and implementation; DOS-P6's spec, plan and
implementation; DOS-P7's spec, plan and implementation. Then two more entries that are not
subsystems — the cutover (A12) and the release (A13) — plus Track L's two items, which are not
engineering work at all.

`BACKLOG.md` §1 is one XS repository defect, NEW-7, and it needs ten minutes with a machine that
has Obsidian rather than an agent.
