# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Roadmap Phase 1, ingest isolation, closed 2026-09-05 as `4fe131c..8e9381a` — nine tasks, each
reviewed by an agent that did not write it, plus a fresh whole-range review that returned NOT READY
on a Critical and READY after the fix wave. The plan was deleted at closure. NEW-58, NEW-47, NEW-44
and NEW-72 are closed; NEW-74 and NEW-75 are the residuals it opened.

The next action is **roadmap Phase 2 — bootstrap performance and the first push (NEW-53, NEW-52)**
(`docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md:109`). It now carries more
than performance, because this session ran the first `npm run check` in this program that reached
past `lint`, and it found two failures that predate Phase 1:

- `apps/cli/src/bootstrap/executor.test.ts`, "retains post-Foundation rollback targets and artifacts
  without invoking deletion authority", expects a resumed `init` after a rolled-back bootstrap to
  fail with `recoveryRequired`; it now succeeds. Reproduced identically at `06438e5` in a clean
  worktree, so Phase 1 did not cause it. It is the surface of `95c2d7e`, and a test pins the
  contract — so settle by analysis whether the resume rule is now too permissive or the contract
  moved and the test was left behind. Do not edit the assertion first.
- Eight retained-evidence cases in `main`, `bootstrap/report`, `commands/doctor` and
  `commands/uninstall` time out at 300 s under full-suite parallelism while each passes standalone
  in 95-115 s. They arrived with the Task 7 checkpoint (`3d686b4`, `4474885`, `a80cf34`) and have
  never passed in a completed full-suite run at any commit. The 95-115 s is NEW-53's slowness;
  the load sensitivity is NEW-29's.

**Phase 2 has no plan yet.** `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`
names `plans/<date>-developer-os-bootstrap-performance.md` as the document it expects. Write it with
`superpowers:writing-plans`, register it here and in `BACKLOG.md`, and obtain founder approval
before executing it.

Spec 1 is approved and its plan exists at `plans/2026-08-28-developer-os-opt-in-surfaces.md`, but
none of its 24 implementation tasks has started. Spec 2's 2026-08-29 baseline and 26-task plan exist
at `specs/2026-08-28-developer-os-release-update-design.md` and
`plans/2026-08-29-developer-os-release-update.md`; its Tasks 1–7 are complete and Tasks 8–26 remain.
Across the active implementation plans, 43 tasks remain untouched. Baseline Tasks 8–9 are roadmap
Phase 3 and stay behind Phase 2.

Open sequence inside A11:

1. Completed: Spec 2 for release metadata, dry-run update, managed-artifact upgrade, schema
   migration, and rollback.
2. Completed 2026-08-29: founder approval of the complete Spec 2 document.
3. Completed: Spec 2's implementation plan.
4. Completed 2026-08-29: Spec 2 Tasks 1–6.
5. Completed 2026-08-31: the Spec 2 §6 retained-bootstrap-evidence correction and its replacement
   Task 7 plan.
6. Closed 2026-09-04: NEW-53 no longer blocks replacement Task 6; it stays open as a performance
   question, and Phase 2 now owns it.
7. Completed 2026-09-04: the founder ruled Spec 2 §6.4, §6.1 and the `admittedPreexistingPaths`
   plan grammar, all recorded as dated amendments.
8. Completed 2026-09-04: the replacement Task 6 tree became the accepted Task 7 checkpoint,
   `050fc0d..c5022a7`.
9. Completed 2026-09-05: roadmap Phase 1, ingest isolation.
10. Now: roadmap Phase 2. Write and register its plan, then stop for founder approval.
11. Execute Spec 2 Tasks 8–9 for the complete `InstallationManifestV2` migration and V2 new-init
    handoff (roadmap Phase 3).
12. Execute the approved Spec 1 plan, split into 1a and 1b by NEW-67.
13. Finish the remaining Spec 2 implementation and close the Task 7 checkpoint.

Phase 2 onward is sequenced by
`plans/2026-09-04-developer-os-completion-roadmap.md` (11 open phases, 2 through 11 with a 5b, the
founder decisions of 2026-09-04, and the spec or plan each phase requires).
`docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7 Git, automation, update, release | nothing | full local lifecycle is ready for cutover | now |
| A12 | DOS-P10 Managed instruction artifacts — spec, plan, implementation | A11 | every artifact in `docs/migration/instruction-inventory.md` §1–§3, §6 installs, drift-checks, and uninstalls on both vendors | blocked |
| A12b | Brain workflows — spec, plan, implementation | A12 | every workflow and verb in the inventory §7 is proven on the synthetic vault | blocked |
| A13 | DOS-P11 Hooks — spec, plan, implementation | A12b | every hook in the inventory §4 plus session-start injection is observed firing and names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — spec, plan, implementation | A13 | all 14 scripts in the inventory §5 are product verbs or documented refusals | blocked |
| A15 | DOS-P8 Founder shadow migration — dedicated plan and execution | A14, L2 | rollback is exercised and one stable cycle completes | blocked |
| A16 | DOS-P9 Public beta and v1 | A15, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

- NEW-49 — expose decided captures through the agent-facing review workflow.
- NEW-46 — close the same-uid `PATH` spawn surface or design persisted executable identity.

Needs a human, a policy decision, or an external application:

- NEW-74 — decide whether Codex keeps its `-C <contentRoot>` read scope now that Claude has none.
- NEW-75 — decide whether ingest must own the `HOME` the vendor writes into, since an isolated run
  still writes `.claude.json`, a backup snapshot and session files despite `--no-session-persistence`.
- NEW-45 — observe whether a real Codex turn ever emits more than one `agent_message`, with one paid
  run. Narrowed 2026-09-05: NEW-47 is closed from source and corroborates the last-wins tie-break.
- NEW-42 — observe capture inside both vendors' interactive sessions.
- NEW-33 — decide whether root-owned, group-writable executable directories are acceptable.
- NEW-7 — verify percent-encoded local links in Obsidian.
- Foundation watchdog — decide whether `SpawnLockfRunner` needs one around non-blocking `lockf`.

The remaining open repository rows are NEW-20, NEW-24–NEW-29, NEW-31, NEW-32, and NEW-34–NEW-40.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant.

## Delivery evidence still owed

- GitHub CLI configuration became readable on 2026-09-03: `gh auth status`, `gh pr list`, and
  `gh run list` all succeed. The `baseline` ruleset on `development` carries only `deletion` and
  `non_fast_forward`, so neither a required status check nor a pull request gates a direct push —
  the `check.yml` comment now says so. L2 still owes release permissions.
- `development` holds 98 unpushed commits and CI has not run since 2026-08-28 (`d72287a`). Do not
  push until the four-job `check.yml` in the working tree is green on a probe branch (roadmap
  Phase 2).
- **The full local `check` was run to completion for the first time on 2026-09-05, and it is not
  green.** `lint` passes. `test:bootstrap` fails one case functionally, and `test:suite` fails one
  more; both predate roadmap Phase 1 and both are proven so — the first reproduces identically at
  `06438e5` in a clean worktree, and the second passes standalone at both commits and only times out
  under full-suite parallelism. Roadmap Phase 2 owns them and `NOW` names them. Measured on
  2026-09-05: `test:bootstrap` 10010 s for its second phase alone; `test:suite` roughly 54 minutes
  over 135 files and 4570 cases. The whole chain is therefore several hours, which is itself the
  argument for Phase 2's performance work.
- `test:suite` now also excludes the real-vendor ingest integration test, which runs in its own
  `test:vendor-ingest` step inside `check`. Measured: with that file inside the parallel suite, eight
  retained-evidence cases time out that otherwise pass; the file spawns the real vendor twice and
  holds each process about 15 s. Same pattern as `e2e/**`, per founder decision D10.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the load-sensitive and
  intermittent-test cleanup.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A15, A16 |

## Count

- Product sequence: 7 open entries, A11, A12, A12b, A13, A14, A15, A16.
- Program plan: baseline Tasks 8–9 contain 10 unchecked steps.
- Repository backlog: 43 open numbered rows, plus the Foundation watchdog decision.
- Active implementation plans: none for the current `NOW`. Roadmap Phase 2 needs
  `plans/<date>-developer-os-bootstrap-performance.md`, which does not exist yet. Spec 2 baseline
  Tasks 8–26 (19 tasks) and Spec 1 (24 tasks, to be split by NEW-67) — 43 untouched tasks — follow
  behind roadmap Phases 2 and 3, plus the completion roadmap's 11 open phases.
