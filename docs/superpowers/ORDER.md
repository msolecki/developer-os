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

**One rule that is not negotiable:** an entry is `done` only when its evidence is in a
commit. A green local tree is the state this repository was already in once, and it cost a
week of confusion.

---

## NOW

**A7 — DOS-P3 Workflow compiler. `S` closed on 2026-08-10**: the founder walked §15, ruled
every decision — six as drafted, the `scheduled` trigger reversed into a refusal — and
approved `specs/2026-07-21-developer-os-workflow-compiler-design.md`. That document is now
the design of record.

**`P` is the entry.** The next session writes
`plans/2026-07-21-developer-os-workflow-compiler.md` with `superpowers:writing-plans`, and
writes no code: the plan before the implementation is a Global Constraint of the program
plan, not a preference. `BACKLOG.md` §3 lists what the plan must cover and what DOS-P3
produces.

**Nothing else is startable without the founder.** `BACKLOG.md` §1's repository defects
closed on 2026-08-10 — NEW-9 with CI (`c6d1ef1`), then NEW-5, NEW-8 and NEW-6, each a place
where two parts of this product disagreed with each other. **What is left of §1's repository
defects is NEW-7 and NEW-10** — the rest of §1 is EXIT-2, EXIT-4, L1 and L2, all below.
NEW-7 is not agent work: it needs ten minutes with a machine that has Obsidian, which is the
founder's. NEW-10 is XS and was found by the review that closed NEW-6.

So the queue below is genuinely what remains. A7 is now agent work again; Track L still waits
on the founder and their counsel.

**Closed, and not repeated below.** Foundation on 2026-08-01, A6/DOS-P2 on 2026-08-10. Both
plans are deleted and git history is the archive; what each proved is in its own checkpoint
document rather than retold here. What survives them:

| Read this | Before you |
|---|---|
| `docs/architecture/foundation.md`, `…-constraints.md` | touch the CLI, transactions, or the manifest |
| `docs/releases/foundation-checkpoint.md` | ask what Foundation's gate evidence was |
| `docs/architecture/brain.md` | touch Brain code |
| `specs/2026-07-21-developer-os-brain-engine-design.md` | change Brain *behaviour* |
| `BACKLOG.md` §2 | assume Foundation left nothing open — it left two founder questions, one unconsumed interface, and one residual owed by A11 |

---

## Track A — product

Strictly sequential except where two rows are marked `‖`, which may run in parallel.

Subsystem rows carry three gates: **S** = spec approved through a brainstorming cycle,
**P** = implementation plan written, **I** = implemented, reviewed and committed. All three
belong to that row; do not start `I` before `P` is written, and do not start `P` before `S`
is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A7 | DOS-P3 Workflow compiler — S / P / I | spec approved 2026-08-10; plan to write | — | L | program plan Task 3 checkpoint: canonical workflows compile to abstract artifacts | **now** — **S closed**; `P` is the entry, `I` blocked on it |
| A8 ‖ | DOS-P4 Claude adapter — S / P / I | to write | A7 | L | program plan Task 4 checkpoint: a Claude-only user completes the full synthetic workflow | blocked |
| A9 ‖ | DOS-P5 Codex adapter — S / P / I | to write | A7 | L | program plan Task 5 checkpoint: Claude-only, Codex-only and dual installs all work | blocked |
| A10 | DOS-P6 Knowledge pipeline — S / P / I | to write | A8 **and** A9 | L | program plan Task 6 checkpoint, after independent security review | blocked |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write against A11's output — decided 2026-08-10 | A11, **B2 B3 B4**, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A7 has no unmet Needs**, and it is no longer parallel with anything: A6 closed, so the
`‖` pairing is gone.

**No Track A entry is code work today.** Every remaining one begins with a document —
DOS-P3 through DOS-P7 each need an approved spec *and* an implementation plan before any
code, which is a Global Constraint of the program plan rather than a preference.

**A12 decision, settled 2026-08-10 by the founder: it gets its own plan.** The program plan
enumerates Task 8's ten steps inline and does not mandate one; the founder ruled that it gets
one anyway, because A12 is the only task that mutates the live machine and its rollback must
be rehearsed before cutover is declared complete. The plan is authored against A11's output,
not before it — writing it earlier would specify a cutover from a lifecycle that does not
exist yet. `BACKLOG.md` §4 carries what it must contain.

---

## Track B — legacy exit

Runs in parallel with all of Track A. **Blocks only A12.** Closing the remaining three ends
work on the founder's legacy runtime permanently; B1 is closed as declined.

**Re-verified 2026-08-08 by read-only inspection**, which is one of the two sanctioned
reasons to look at those trees at all (`BACKLOG.md` §6). Two items moved a long way; one did
not move at all; one is new.

| # | Entry | Owner | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| B1 | EXIT-1 — rotate historical credential candidates | **Founder** | — | M | — | **closed 2026-08-10 — declined by the founder**, not deferred. `BACKLOG.md` §6 carries the decision. Do not reopen it from a backlog; it is a conversation |
| B2 | EXIT-2 — fix the non-npm commit-gate contradiction | Agent + Founder | — | S | a non-npm repository with a declared suite can be committed; npm projects unweakened | **start now** — unchanged since 2026-07-20 |
| B3 | EXIT-3 — land or durably preserve the remaining untracked entries | Agent + Founder | B2 | **S** | both trees hold no untracked work of value, by commit or by an archive the founder accepted | parallel — mostly discharged |
| B4 | EXIT-4 — stop or fix the failing legacy weekly job | Agent + Founder | — | S | the job succeeds, or is disabled with the founder's agreement and its backlog drained | **new 2026-08-08** |

Detail: `plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`.

**B1 is the oldest item in this file and the only one with a security consequence that
exists whether or not this product ever ships.** It needs no repository and no Developer OS
progress — only console access. The recorded verdict is still "four real rotation candidates
remain", and a second scan on 2026-07-27 widened the candidate set to six repositories
without changing any verdict.

**B2 is an afternoon and it has not been touched.** The rule still reads as an npm-only
absolute, verbatim, which is why B3 could not be closed by a compliant agent.

**B3 shrank from L to S.** The 136-entry dirty tree the plan was written against no longer
exists: the completed English migration was committed, and both repositories are now in sync
with their remotes. What is left is four untracked entries in one tree — three automation
backup files and one roadmap document whose content is already fully represented in
`BACKLOG.md` — and an untracked capture inbox in the other, which is user data awaiting the
ingest that B4 has blocked. Confirm the counts before acting; do not assume these numbers
either.

**B4 is new and nobody recorded it.** The legacy weekly job has not succeeded since
2026-07-27; two fix commits landed and neither worked. It is why the capture inbox is
backing up, and it contradicts this plan's own definition of done, which requires that
nothing remain scheduled or in progress on either repository.

---

## Track L — long lead time, start early

Both gate the last entry in Track A. Both depend on somebody who is not in this room.
Starting them at A13 adds their full lead time to the release date for no reason.

| # | Entry | Owner | Gates | Done when | Status |
|---|---|---|---|---|---|
| L1 | Select an OSI-approved license and obtain qualified legal approval | Founder + counsel | A13, public visibility | approved text committed as `LICENSE` | open, startable now |
| L2 | Remote verification — destination remote, visibility, branch protections | Founder, outside this environment | A12, A13, any push | `remoteVerification` no longer `blocked_by_environment` | open, startable now |

Until L2 clears: no fetch, no push, no pull request, no public release. Recording an origin
is not verification.

---

## Where the detail lives

| You want | Read |
|---|---|
| how to run a session start to finish | `SESSION.md` |
| what to do next | this file |
| what a missing spec must decide, and what it produces | `BACKLOG.md` §3 |
| what the Brain engine is, and its six residuals | `docs/architecture/brain.md` |
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

Foundation and DOS-P2 are closed. Five subsystems need a spec, a plan, and an
implementation each — **fifteen milestones, none of which exist yet**. Then cutover, then
release. Track B is three items — B1 closed as declined — and Track L is two. `BACKLOG.md`
§1 is four repository-level defects, all XS to S, all with named owners, none compounding.
