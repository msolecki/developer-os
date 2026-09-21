# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle, pre-cutover part.** The next action is
to execute plan 1a (`plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, roadmap Phase 4) wave by
wave, as `SESSION.md` §4.1 orchestrates it (D33).

Plan 1a progress: committed 1–23; in flight none; **ready next 24 (wave 9) — BLOCKED by NEW-99**, a pre-existing defect that makes the second `uninstall` after a reinstall refuse exit 6, which is exactly Task 24's headline case. The fix is in `apps/cli/src/bootstrap/report.ts`, behind the 330-minute `bootstrap-executor` gate D32 defers — the same shape D37 refused to ship unrun, so the founder owns where it lands. D36: implementation-first — no per-task review, commits held locally, one review plus `npm run check` plus one push at plan close, run by hand.

Spec 2 (`plans/2026-08-29-developer-os-release-update.md`): Tasks 1–7 and 9 complete, Task 8
withdrawn (D18), Tasks 10–26 remain. The 2026-08-28 Spec 1 plan stays as plan 1b's source.

Open sequence (D16, daily use before completeness):

1. Now: execute plan 1a (Phase 4).
2. Spec 2 Tasks 10–11 plus the production wiring step that removes the bootstrap pin at
   `apps/cli/src/context.ts:765` — launcher and offline trust — with NEW-79, NEW-81 and NEW-85
   first (Phase 4b).
3. A12 → A12b → A13 → A14, then the founder cutover A15.
4. After the cutover: A11b (Spec 2 Tasks 12–26, then Spec 1b), then A16.

Per D17, D32 and D33 a task commit runs its fast commands and `npm run lint`; independent tasks run
in parallel and one orchestrator integrates. **D36 (2026-09-20) supersedes the per-task review and
per-task push for the rest of plan 1a**: no fresh-context review per task, commits held locally, and
one whole-plan review plus one push plus `npm run check` at plan close (`SESSION.md` §4.1, §5).

The parent document is `plans/2026-07-21-developer-os-program.md`, which is live rather than
superseded: its 23 open items are DOS-P7's remainder (A11b and plan 1b), the DOS-P8 cutover (A15)
and DOS-P9's release gates (A16, L1). It closes with A16 and with nothing earlier.

Phase 4 onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (10 open phases,
4 through 11 with a 4b and a 5b, the founder decisions D1–D37, and the spec or plan each phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7, pre-cutover part (D16): Spec 1a, Spec 2 Tasks 10–11 (Task 9 closed 2026-09-17) | nothing | a fresh production `init` runs V2 through the launcher; `config get\|set`, coordinator recovery and drained uninstall ship | now |
| A12 | DOS-P10 Managed instruction artifacts — spec, plan, implementation | A11 | every artifact in `docs/migration/instruction-inventory.md` §1–§3, §6 installs, drift-checks, and uninstalls on both vendors | blocked |
| A12b | Brain workflows — spec, plan, implementation | A12 | every workflow and verb in the inventory §7 is proven on the synthetic vault | blocked |
| A13 | DOS-P11 Hooks — spec, plan, implementation | A12b | every hook in the inventory §4 plus session-start injection is observed firing and names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — spec, plan, implementation | A13 | all 14 scripts in the inventory §5 are product verbs or documented refusals | blocked |
| A15 | DOS-P8 Founder shadow migration — dedicated plan and execution | A14 | rollback to the legacy runtime is exercised and one stable cycle completes | blocked |
| A11b | DOS-P7 remainder (D16): Spec 2 Tasks 12–26 (update, rollback), then Spec 1b (git, launchd) | A15 | `update`, `update rollback`, `git` and `automation` proven on a disposable install, then on the founder machine | blocked |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

- NEW-49 — expose decided captures through the agent-facing review workflow.
- NEW-46 — close the same-uid `PATH` spawn surface or design persisted executable identity.

Needs a human, a policy decision, or an external application:

- NEW-75 — supply each vendor's credential path separately, then prove it with one real
  authenticated `ingest` per vendor. Narrowed 2026-09-07 by D15: admitting `HOME` is refused,
  because the resolution that strews the files is the one that finds the credentials.
- NEW-45 — observe whether a real Codex turn ever emits more than one `agent_message`, with one paid
  run. Narrowed 2026-09-05: NEW-47 is closed from source and corroborates the last-wins tie-break.
- NEW-42 — observe capture inside both vendors' interactive sessions.
- NEW-33 — decide whether root-owned, group-writable executable directories are acceptable.
- NEW-7 — verify percent-encoded local links in Obsidian.
- Foundation watchdog — decide whether `SpawnLockfRunner` needs one around non-blocking `lockf`.

`BACKLOG.md` §1 holds 58 open numbered rows.
Owners: NEW-79, NEW-81, NEW-85 and NEW-86 are owned by Phase 4b; NEW-82 by plan 1a; NEW-84 by Phase 9;
NEW-87 travels with whichever row each mis-aimed citation belongs to; NEW-88 and NEW-89 by plan 1a Tasks 16 and 22; NEW-91 by plan 1a Task 16; NEW-90 and NEW-92 by Phase 4b; NEW-97 by Phase 4b and NEW-98 by A14, both opened by plan 1a Task 22; NEW-99 blocks plan 1a Task 24 and needs a founder decision.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant; D33 lets a
startable row run beside a wave when its files overlap no task in flight.

## Delivery evidence still owed

- L2 still owes release permissions. Remote rules, `gh` access and direct pushes to `development` are
  verified: the `baseline` ruleset carries only `deletion` and `non_fast_forward`.
- Measured gate and CI costs, and why the CI budgets are what they are, live in
  `docs/architecture/foundation.md` §9. That a green local `check` is not evidence about CI lives in
  `BACKLOG.md` §5. Retain the complete log of any full-suite failure; NEW-29 owns the remaining
  elapsed-time assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 8 open entries, A11, A12, A12b, A13, A14, A15, A11b, A16.
- Implementation tasks: plan 1a 2 remaining (24–25, and 24 is blocked by NEW-99), Spec 2 Tasks
  10–26 (17), plan 1b 15 (the 2026-08-28 plan's remaining tasks, not yet rewritten): 34. Before the
  cutover: plan 1a and Spec 2 Tasks 10–11, 4 tasks. After it: Spec 2 Tasks 12–26 and plan 1b, 30 tasks.
- Phases 5, 5b, 6 and 7 have no spec yet; A15 and A16 each still need their dedicated plan.
- Repository backlog: 58 open numbered rows, plus the Foundation watchdog decision.
