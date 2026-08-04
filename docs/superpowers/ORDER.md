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

**Status values:** `done` · `now` · `next` · `blocked` · `parallel`

**One rule that is not negotiable:** an entry is `done` only when its evidence is in a
commit. A green local tree is the state this repository was already in once, and it cost a
week of confusion.

---

## NOW

**A6 — DOS-P2 Brain engine. The S and P gates both closed on 2026-08-04**; **I** is
what is left. Execute `plans/2026-07-21-developer-os-brain-engine.md` — 10 tasks, each
ending in its own commit — under `superpowers:executing-plans`. The spec behind it is
`specs/2026-07-21-developer-os-brain-engine-design.md`; read its §15 first, because it
amends four documents that were approved before it existed.

**Nothing blocks execution.** The plan's one open decision — a YAML parser for frontmatter —
was settled on 2026-08-04: `yaml@2.8.1`, approved by the founder. Any *further* dependency
still needs approval before `pnpm add` runs. Detail is in `BACKLOG.md` §3.

A7 (DOS-P3, the workflow compiler) is startable in parallel and still has all three
gates open.

**Foundation closed on 2026-08-01** with A4, and **A5 closed the same day**. The
foundation plan was deleted per `SESSION.md`; what survives it is
`docs/architecture/foundation.md`, `docs/architecture/foundation-constraints.md`, and
`docs/releases/foundation-checkpoint.md`. Read the first before touching Foundation
code and the second before changing any behaviour it describes.

Every Track A entry from here begins with a document, not with code.

---

## Track A — product

Strictly sequential except where two rows are marked `‖`, which may run in parallel.

Subsystem rows carry three gates: **S** = spec approved through a brainstorming cycle,
**P** = implementation plan written, **I** = implemented, reviewed and committed. All three
belong to that row; do not start `I` before `P` is written, and do not start `P` before `S`
is approved.

| # | Entry | Plan | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| A0 | Kernel transaction lock — commit (`ACT-1`) | done; plan deleted, see `specs/…-kernel-transaction-lock-design.md` | — | S | 4 steps checked; `git status` clean; commit holds only Task 5 paths | done |
| A1 | Foundation Task 6 — owned artifacts and config drift | done; plan deleted | A0 | M | 5 steps; `InstallationManifestV1` and three-way drift evidence; commit | done |
| A2 | Foundation Task 7 — macOS platform boundary | done; plan deleted | A1 | S | 4 steps; `PlatformAdapter` facts and discovery; commit | done |
| A3 | Foundation Task 8 — no-agent CLI lifecycle | done; plan deleted | A2 | L | 7 steps; `init` `status` `doctor` `repair` `uninstall`; commit | done |
| A4 | Foundation Task 9 — temporary-HOME lifecycle | done; plan deleted, see `docs/architecture/foundation.md` | A3 | L | 7 steps and the Foundation completion gate; 31 e2e cases; evidence in `docs/releases/foundation-checkpoint.md` | done |
| A5 | ACT-4 — self-containment check in lint | `BACKLOG.md` §1 | A0 | S | `npm run lint` fails on any legacy path reference outside the allowlisted locations | done |
| A6 ‖ | DOS-P2 Brain engine — S / P / I | **S** and **P** done: `specs/…-brain-engine-design.md`, `plans/…-brain-engine.md` | A5 | L | Task 2 checkpoint: init, validate, index and search a synthetic vault with no adapter | **now** |
| A7 ‖ | DOS-P3 Workflow compiler — S / P / I | to write | A5 | L | Task 3 checkpoint: canonical workflows compile to abstract artifacts | parallel, startable now |
| A8 ‖ | DOS-P4 Claude adapter — S / P / I | to write | A7 | L | Task 4 checkpoint: Claude-only user completes the full synthetic workflow | blocked |
| A9 ‖ | DOS-P5 Codex adapter — S / P / I | to write | A7 | L | Task 5 checkpoint: Claude-only, Codex-only and dual installs all work | blocked |
| A10 | DOS-P6 Knowledge pipeline — S / P / I | to write | A8 **and** A9 | L | Task 6 checkpoint, after independent security review | blocked |
| A11 | DOS-P7 Git, automation, update, release — S / P / I | to write | A10 | L | Task 7 checkpoint: full local lifecycle ready for cutover | blocked |
| A12 | DOS-P8 Founder shadow migration | to write — see decision below | A11, **B1 B2 B3**, L2 | L | rollback exercised once; one complete stable cycle on the new runtime | blocked |
| A13 | DOS-P9 Public beta and v1 | `plans/…-program.md` Task 9 | A12, **L1**, **L2** | L | `v1.0.0` published and reproducible | blocked |

**A5 landed before A6, as required.** DOS-P2 is the first task that will be tempted to open a
real vault "just to check the shape", and prose does not stop that. `npm run lint` now does.

**A6/A7 parallelism** is open: Foundation's interfaces were frozen at A4 and are listed in
`docs/architecture/foundation.md` §2, and A5 has landed. Both still need a spec and a plan
before any code.

**A12 decision, unresolved.** The program plan enumerates Task 8's ten steps inline and
does not mandate a dedicated plan. Recommendation on record: write one anyway — it is the
only task that mutates the live machine, and its rollback must be rehearsed before cutover
is declared complete. Settle this before A11 finishes, not at A12.

---

## Track B — legacy exit

Runs in parallel with all of Track A. **Blocks only A12.** Closing all three ends work on
`~/claude-shared` and `~/brain` permanently.

| # | Entry | Owner | Needs | Size | Done when | Status |
|---|---|---|---|:---:|---|---|
| B1 | EXIT-1 — rotate four historical credential candidates | **Founder** | — | M | every candidate has a recorded provider-side verdict; no value written anywhere | parallel, **start now** |
| B2 | EXIT-2 — fix the non-npm commit-gate contradiction | Agent + Founder | — | S | a non-npm repository with a declared suite can be committed; npm projects unweakened | parallel |
| B3 | EXIT-3 — land or durably preserve the uncommitted trees | Agent + Founder | B2 | L | no uncommitted work of value remains, by commit or by an archive you accepted | blocked by B2 |

Detail: `plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`.

**B1 has been open since 2026-07-20.** It needs no repository and no Developer OS progress
— only console access. It is the single oldest item in this file and the only one with a
security consequence that exists whether or not this product ever ships.

**B2 is an afternoon.** It is one rules file, and it is why B3 has not moved: a compliant
agent currently cannot commit in either legacy repository.

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
| what Foundation delivered, and what it deliberately cannot do | `docs/architecture/foundation.md` |
| the per-task Foundation constraints, and two open founder questions | `docs/architecture/foundation-constraints.md` |
| the Foundation gate evidence | `docs/releases/foundation-checkpoint.md` |
| which repository directories do not exist yet | `BACKLOG.md` §5 |
| what was frozen on the legacy runtime and why | `BACKLOG.md` §6 |
| the gates every commit must pass | `BACKLOG.md` §7 |
| the product design | `specs/2026-07-21-developer-os-design.md` |
| why no task reads `~/brain` or `~/claude-shared` | `plans/…-program.md`, Global Constraints and Task 0 |

## Counting what is left

Foundation is closed. Six subsystems need a spec, a plan, and an implementation each —
eighteen documents-or-milestones that do not exist yet. Then cutover, then release. Track B is
three items; Track L is two.

No Track A entry can be acted on today without writing a document first: every remaining one
starts with a brainstorming cycle and a spec.
