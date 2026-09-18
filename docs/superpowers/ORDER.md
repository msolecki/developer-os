# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

**Roadmap Phase 3 closed on 2026-09-17** (`810d342..43c30e4`): `init` refuses a V1 manifest once the
packaged capability exists, ordinary commands refuse during non-terminal bootstrap state, and the
strict V2 handoff admission exists. The V1→V2 migration was withdrawn (D18) and reverted. `npm run
check` passed on `43c30e4`. The final review's findings are NEW-79 to NEW-83 and additions to NEW-67;
founder decisions D19 and D20 settled the two that needed one.

**The NEW-67 amendment to Spec 1 is approved and applied** (2026-09-17, every recommended option;
founder decisions D21–D23), with a companion Spec 2 §6.1/§6.4 amendment. NEW-67 is closed; its
`launchctl` clause moved to NEW-84.

**Plan 1a is written:** `plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, 25 tasks — Spec 1 plan
Tasks 1–7, 21 and 23 rewritten against Spec 1 as amended, carrying the code obligations listed under
roadmap Phase 4. Its blocking questions were answered by founder decisions D24–D29 (2026-09-17) and
applied to Spec 1 as A14–A16: a closed `uninstall/present_manifest_without_launchd` variant (D24), empty
directories removed before the manifest tombstone (D25), the uninstall capacity refusal with the decision
deferred to Phase 4b as NEW-85 (D26), §6 applied literally to V1 residue (D27), the `mf` ID reserved last
(D28), NEW-80 pulled into plan 1a Task 1 (D29), and the shape-admitted bookkeeping identity deferred to
Phase 4b as NEW-86 (D30). **The next action is to execute plan 1a.**

Plan 1a progress: Tasks 1–8 of 25 committed; next is Task 9 (A stable lock provider that never
creates, with bounded lease acquisition).

The 2026-08-28 Spec 1 plan (`plans/2026-08-28-developer-os-opt-in-surfaces.md`) stays as plan 1b's
source. Spec 2's Tasks 1–7 and 9 are complete, Task 8 is withdrawn, and Tasks 10–26 remain.

Open sequence (D16, daily use before completeness):

1. Now: execute plan 1a (Phase 4).
2. Spec 2 Tasks 10–11 plus the production wiring step that removes the bootstrap pin at
   `apps/cli/src/context.ts:765` — launcher and offline trust — with NEW-79, NEW-81 and NEW-85
   first (Phase 4b).
3. A12 → A12b → A13 → A14, then the founder cutover A15.
4. After the cutover: A11b (Spec 2 Tasks 12–26, then Spec 1b), then A16.

Per decision D17 an ordinary task commit runs its focused commands, `npm run lint` and fresh review,
and is pushed when no CI run is in progress; `npm run check` runs locally at phase or plan close
(`SESSION.md` §5). That rule is unchanged by plan 1a, which adds one CI job for its real-V2-home test
files in its Task 1.

Phase 4 onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (10 open phases,
4 through 11 with a 4b and a 5b, the founder decisions of 2026-09-04, 2026-09-07, 2026-09-16 and
2026-09-17, and the spec or plan each phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

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

The remaining open repository rows are NEW-20, NEW-24–NEW-29, NEW-31, NEW-32, NEW-34–NEW-40,
NEW-76, NEW-78, NEW-79, NEW-81, NEW-82 and NEW-84–NEW-87.
Owners: NEW-79, NEW-81, NEW-85 and NEW-86 are owned by Phase 4b; NEW-82 by plan 1a; NEW-84 by Phase 9;
NEW-87 travels with whichever row each mis-aimed citation belongs to.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant.

## Delivery evidence still owed

- L2 still owes release permissions. Everything else it covered is now evidenced: `gh auth status`,
  `gh pr list` and `gh run list` succeed, and the `baseline` ruleset on `development` carries only
  `deletion` and `non_fast_forward`, so neither a status check nor a pull request gates a direct
  push. That was verified by pushing, not inferred.
- **The first push landed 2026-09-07: `d72287a..446148b`, closing a backlog of 125 unpushed commits
  and a CI gap since 2026-08-28.** Per decision D12 it went directly to `development` rather than
  through a probe branch.
- **CI is green on all five jobs, twice consecutively** — run 34157609332 on `446148b` and run
  34172016048 on `88d56a2`. The first run's figures: `lint` 0.8 min, `vendor-ingest` 0.5 min, `e2e`
  6.8 min, `suite` 66.8 min (135 files, 4,587 passed), `bootstrap-executor` — the job that had never
  once executed before this week, since `check.yml` had a single `check` job at `d72287a`.
- **The local `check` is green and takes about three hours**, measured 2026-09-07 at 11:05:48→14:01:54:
  `EXIT=0`, 4,723 tests. `test:bootstrap` 122.6 min, `test:suite` 46.3 min under load, `test:e2e`
  274.89 s, `test:vendor-ingest` 30.27 s.
- **A green local `check` is not evidence about CI, and this is now recorded rather than learned
  again.** The local chain begins with `lint`, which is `tsc -b`, so every `dist` exists before any
  test runs; CI splits into six jobs with no shared filesystem. And the development laptop runs a
  newer Darwin than the runner, which is how an undefined `renameatx_np` flag bit shipped. Both
  instances are in `BACKLOG.md` §5.
- CI job budgets are 20/330/150/20/40/15 minutes and are sized from a **measured** ~1.9-2x hosted-runner
  ratio, not a guess; two of them were killed by bounds derived from the most favourable local
  number before that ratio was measured. They are bounds that let the gate report, not targets —
  NEW-53's residual owns making them unnecessary.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the remaining elapsed-time
  assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 8 open entries, A11, A12, A12b, A13, A14, A15, A11b, A16.
- Release plan: Tasks 10–26 open; Tasks 1–7 and 9 closed, Task 8 withdrawn.
- Repository backlog: 46 open numbered rows, plus the Foundation watchdog decision.
- Implementation plans: Spec 2 baseline Tasks 10–26 (17 tasks), plan 1a (25 tasks) and plan 1b (the
  2026-08-28 plan's remaining 15 tasks, not yet rewritten): 57 tasks. Before the cutover: plan 1a
  (25 tasks) and Tasks 10–11 — 27 tasks. After it: Tasks 12–26 and plan 1b (15 tasks) — 30 tasks. Phases 5, 5b, 6 and 7 have no spec yet.
