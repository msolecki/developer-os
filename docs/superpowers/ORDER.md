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

**A8 and A9 — DOS-P4 Claude adapter and DOS-P5 Codex adapter.** Both are `‖`, both unblock
together now that DOS-P3's schemas are frozen, and both start at `S`: write the spec, get it
approved by the founder, then the plan, then the code. Neither is code work today.

**A8's spec was approved on 2026-08-11 and its plan was written the same day.** Both gates closed;
what remains of A8 is `I`, fourteen tasks, none started. Four decisions were taken by the founder
during the brainstorming cycle and are recorded in the spec rather than here: the
install is a skills-directory plugin discovered in place and writes **no** settings key; a
capability is `yes` only when a version floor permits it *and* a probe observes it; the `shared`
preamble is concatenated into each artifact rather than referenced from one; and **this repository
creates no `.claude/` directory in version 1**, which amends an approved Task 0 artifact and is
registered in `BACKLOG.md` §8 as pending.

**One thing that spec found is worth knowing before reading it.** A marketplace install copies a
plugin into a cache, so the manifest would hash a source Claude Code does not read — drift
detection blind by construction. In-place discovery makes the hashed bytes and the loaded bytes the
same bytes, which is why the mechanism changed mid-cycle.

**A7 closed on 2026-08-10.** All three gates. `packages/workflow-schema` ships the contract, the
closed effect vocabulary, the scope-equality rule, the overlay boundary, the loader and the drift
check; `workflows/` ships the six canonical workflows; `tests/fixtures/workflows/` holds the seven
negative fixtures and `tests/contracts/workflows/` the sixteen cases that drive them. What survives it is
`docs/architecture/workflow-schema.md` — read that before touching workflow code, and before
starting either adapter, because §7 and §8 are what DOS-P4 and DOS-P5 inherit. Its plan is
deleted and git history is the archive.

**Three things A7 settled that a reader of the spec alone would not know.** Spec §13's demand
that six workflows "render byte-identically" **cannot be met literally in DOS-P3**, which ships
no renderer by design — Task 11 proves what this package can prove and the architecture note
names DOS-P4/P5 as owing the rest. The display screen moved from `packages/brain` into
`@developer-os/security`, because two peer subsystems needed it. And four of the six workflows
say less than the product spec does; the founder ruled on 2026-08-10 that each is recorded with
an owner rather than closed, because every one needs a handler that does not exist yet.

**Nothing else is startable without the founder.** `BACKLOG.md` §1's repository defects
closed on 2026-08-10 — NEW-9 with CI (`c6d1ef1`), then NEW-5, NEW-8 and NEW-6, each a place
where two parts of this product disagreed with each other. **What is left of §1's repository
defects is NEW-7 and NEW-10** — the rest of §1 is EXIT-2, EXIT-4, L1 and L2, all below.
NEW-7 is not agent work: it needs ten minutes with a machine that has Obsidian, which is the
founder's. NEW-10 is XS and was found by the review that closed NEW-6.

**Track B closed the same day**, so the queue below is genuinely what remains: Track A, and
Track L waiting on the founder and their counsel.

**Closed, and not repeated below.** Foundation on 2026-08-01, A6/DOS-P2 on 2026-08-10. Both
plans are deleted and git history is the archive; what each proved is in its own checkpoint
document rather than retold here. What survives them:

| Read this | Before you |
|---|---|
| `docs/architecture/foundation.md`, `…-constraints.md` | touch the CLI, transactions, or the manifest |
| `docs/releases/foundation-checkpoint.md` | ask what Foundation's gate evidence was |
| `docs/architecture/brain.md` | touch Brain code |
| `docs/architecture/workflow-schema.md` | touch a workflow, a verb, or either adapter — §7 and §8 are what DOS-P4 and DOS-P5 inherit |
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
| A7 | DOS-P3 Workflow compiler — S / P / I | deleted; `docs/architecture/workflow-schema.md` is what it left | — | L | program plan Task 3 checkpoint: canonical workflows compile to abstract artifacts | **done** 2026-08-10 |
| A8 ‖ | DOS-P4 Claude adapter — S / P / I | `plans/2026-07-21-developer-os-claude-adapter.md`, 14 tasks | A7 | L | program plan Task 4 checkpoint: a Claude-only user completes the full synthetic workflow | **now** — `S` approved and `P` written 2026-08-11; `I` is 0/14 |
| A9 ‖ | DOS-P5 Codex adapter — S / P / I | to write | A7 | L | program plan Task 5 checkpoint: Claude-only, Codex-only and dual installs all work | **now** — starts at `S`, parallel with A8 |
| A10 | DOS-P6 Knowledge pipeline — S / P / I | to write | A8 **and** A9 | L | program plan Task 6 checkpoint, after independent security review | blocked |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | program plan Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write against A11's output — decided 2026-08-10 | A11, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A8 and A9 have no unmet Needs.** They are the `‖` pair, and they unblocked together when
A7 froze the schemas they both render from.

**No Track A entry is code work today.** Every remaining one begins with a document —
DOS-P4 through DOS-P7 each need an approved spec *and* an implementation plan before any
code, which is a Global Constraint of the program plan rather than a preference.

**A12 decision, settled 2026-08-10 by the founder: it gets its own plan.** The program plan
enumerates Task 8's ten steps inline and does not mandate one; the founder ruled that it gets
one anyway, because A12 is the only task that mutates the live machine and its rollback must
be rehearsed before cutover is declared complete. The plan is authored against A11's output,
not before it — writing it earlier would specify a cutover from a lifecycle that does not
exist yet. `BACKLOG.md` §4 carries what it must contain.

---

## Track B — legacy exit

**Closed on 2026-08-10. It no longer blocks A12.** Nothing further is planned, scheduled, or
in progress on `~/claude-shared` or `~/brain`; both are frozen artifacts running the founder's
machine until the DOS-P8 cutover retires them. The checklist that ran this track is deleted —
`BACKLOG.md` §6 carries what a cutover still needs to know, and git history is the archive.

| # | Entry | Closed how |
|---|---|---|
| B1 | EXIT-1 — rotate historical credential candidates | **declined by the founder**, not done and not deferred. `BACKLOG.md` §6 carries the decision and the reasons not to reopen it from a backlog |
| B2 | EXIT-2 — the non-npm commit-gate contradiction | fixed. The npm-only absolute is a fail-closed ladder: `package.json` scripts, else the repository's documented suite, else blocked |
| B3 | EXIT-3 — untracked entries | discharged. Three `.bak` files deleted as byte-identical to `ef4a972`, `docs/ROADMAP.md` committed. What remains untracked in the vault is one day of new captures awaiting the next scheduled run |
| B4 | EXIT-4 — the failing weekly job | **already fixed when it was checked.** The run of 2026-08-09 succeeded — hooks `PASS=49 FAIL=0`, 52 files committed and pushed, the whole backlog drained. The item was written on 2026-08-08 and the next scheduled Sunday proved the two fix commits that preceded it |

**What closing it cost, and it is worth knowing before the cutover.** B2's corrected rule
immediately blocked its own commit, because the declared suite it points at was failing on 173
findings — every one a raw capture in the language it was captured in, and no automation ran
the check, so the red had been invisible while the weekly job reported green. Two exclusions
settled it: `_raw` is out of scope, and quoted material — a fenced block, an inline code span,
a price in `zł` — is not prose. `BACKLOG.md` §6 has the detail.

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
| what the workflow compiler is, what it deliberately cannot do, and the four workflows that say less than the product spec does | `docs/architecture/workflow-schema.md` |
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

Foundation, DOS-P2 and DOS-P3 are closed. Four subsystems need a spec, a plan and an
implementation each — **twelve milestones left, and the next two are DOS-P4's and DOS-P5's
specs, which may be written in parallel**. Then cutover, then release.

**Track B is closed entirely** and Track L is still two items outside this room. `BACKLOG.md`
§1 is two repository-level defects, both XS, both with named owners, neither compounding.
