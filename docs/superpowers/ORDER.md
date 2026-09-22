# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle, pre-cutover part.** Plan 1a
(`plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, roadmap Phase 4) closed 2026-09-22 as
`43c6876..082e098` — `config get|set`, the V2 mutation gate, and drained coordinator/absent-manifest
uninstall shipped; constraints recorded in `docs/architecture/foundation.md` §10,
`foundation-constraints.md` and `threat-model.md` §5.13. Task 24 (uninstall → `init` round-trip and
kill-matrix coverage) was carved out to post-A16 hardening (D42); its full spec stays in the plan
file, tracked as `BACKLOG.md` NEW-100. The next action is Phase 4b: Spec 2
(`plans/2026-08-29-developer-os-release-update.md`) Tasks 10–11, plus the production wiring step that
removes the bootstrap pin at `apps/cli/src/context.ts:790` (Task 11b) — launcher and offline trust —
with NEW-79, NEW-81 and NEW-85 settled first.

Phase 4b progress: Task 10 (`1e214ce`) and Task 11 (`3f640b3`) committed; NEW-85 decided (D45, no code
yet); NEW-79 in flight; ready next: NEW-81 (after NEW-79 closes, same file), Task 11b (blocked on the
founder's signing-key answer only at the point the pin is actually removed).

Spec 2: Tasks 1–7 and 9 complete, Task 8 withdrawn (D18), Tasks 10–26 remain. The 2026-08-28 Spec 1
plan stays as plan 1b's source; its Tasks 1–7, 21 and 23 were executed via plan 1a.

Open sequence (D16, daily use before completeness):

1. Now: Phase 4b — Spec 2 Tasks 10–11 plus Task 11b's pin removal, NEW-79/81/85 first.
2. A12 → A12b → A13 → A14, then the founder cutover A15.
3. After the cutover: A11b (Spec 2 Tasks 12–26, then Spec 1b), then A16.

Per D17, D32 and D33 a task commit runs its fast commands and `npm run lint`, gets fresh-context
review, and is pushed to `development` so CI runs every job on it; independent tasks run in parallel
and one orchestrator integrates. Plan 1a's D36 per-task exemption expired with it and does not carry
into Phase 4b.

The parent document is `plans/2026-07-21-developer-os-program.md`, which is live rather than
superseded: its 23 open items are DOS-P7's remainder (A11b and plan 1b), the DOS-P8 cutover (A15)
and DOS-P9's release gates (A16, L1). It closes with A16 and with nothing earlier.

Phase 4b onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (9 open phases,
4b through 11 with a 5b, the founder decisions D1–D42, and the spec or plan each phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7, pre-cutover part (D16): Spec 2 Tasks 10–11 (Task 9 closed 2026-09-17; Spec 1a closed 2026-09-22) | nothing | a fresh production `init` runs V2 through the launcher; `config get\|set`, coordinator recovery and drained uninstall ship | now |
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

`BACKLOG.md` §1 holds 57 open numbered rows.
Owners: NEW-79, NEW-81, NEW-85 and NEW-86 are owned by Phase 4b; NEW-82 by plan 1a; NEW-84 by Phase 9;
NEW-87 travels with whichever row each mis-aimed citation belongs to; NEW-88 and NEW-89 by plan 1a Tasks 16 and 22; NEW-91 by plan 1a Task 16; NEW-90 and NEW-92 by Phase 4b; NEW-97 by Phase 4b and NEW-98 by A14, both opened by plan 1a Task 22; NEW-99 is owned by plan 1a Task 23b (D38); NEW-100 by a later sharding of `test:lifecycle` (D39).
They are not ordered ahead of A11 unless the touched subsystem makes one relevant; D33 lets a
startable row run beside a wave when its files overlap no task in flight.

## Delivery evidence still owed

- L2 still owes release permissions. **Remote rules changed since last verified (found 2026-09-22,
  plan 1a closure):** the `baseline` ruleset on `development` now also carries a `pull_request` rule
  (`gh api repos/msolecki/developer-os/rules/branches/development`), 0 required approvals but PRs
  mandatory — a direct `git push origin development` is rejected with `GH013`. D12's "pushed directly
  to development, nothing gates the push" no longer holds; `SESSION.md` §5 step 7's push rule needs a
  founder decision on whether it opens a PR (as plan 1a's closure did, `#14`) or the founder pushes
  with bypass permissions. `gh` access itself is verified working (`gh api`/`gh pr create` succeeded
  once network-sandboxed calls were run unsandboxed; `gh run list`/`gh pr list` failed on a sandboxed
  TLS proxy error that was the sandbox, not GitHub).
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
- Implementation tasks: plan 1a closed (Task 24 deferred to post-A16, NEW-100), Spec 2
  Tasks 10–26 (17), plan 1b 15 (the 2026-08-28 plan's remaining tasks, not yet rewritten): 32. Before
  the cutover: Spec 2 Tasks 10–11, 2 tasks. After it: Spec 2 Tasks 12–26 and plan 1b, 30 tasks.
- Phases 5, 5b, 6 and 7 have no spec yet; A15 and A16 each still need their dedicated plan.
- Repository backlog: 57 open numbered rows, plus the Foundation watchdog decision.
