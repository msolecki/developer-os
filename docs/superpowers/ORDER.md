# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Spec 1 is approved and its plan exists at
`plans/2026-08-28-developer-os-opt-in-surfaces.md`, but none of its 24 implementation tasks has
started. Spec 2's 2026-08-29 baseline and 26-task plan exist at
`specs/2026-08-28-developer-os-release-update-design.md` and
`plans/2026-08-29-developer-os-release-update.md`. Tasks 1–6 are complete. Task 7's implementation
passed local gates but fresh review rejected its deletion-based bootstrap closure. The founder
approved the complete retained-evidence correction and durable slot-identity addendum on 2026-08-31.
Its six-task replacement plan is
`plans/2026-08-31-developer-os-retained-bootstrap-evidence.md`; replacement Tasks 1–5 are complete,
so 1 task and 6 unchecked steps remain. The next action is
replacement Task 6, adding reports, reinstall bounds, inertness, and checkpoint evidence
(docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md:851). Across the active
implementation plans, 44 tasks remain untouched. Baseline Task 8 remains blocked until all six
replacement tasks pass fresh review.

Open sequence inside A11:

1. Completed: write Spec 2 for release metadata, dry-run update, managed-artifact upgrade, schema
   migration, and rollback using `superpowers:brainstorming`.
2. Completed 2026-08-29: obtain founder approval for the complete Spec 2 document.
3. Completed: write Spec 2's implementation plan using `superpowers:writing-plans`.
4. Completed 2026-08-29: Spec 2 Tasks 1–6 established the codecs, release/manifest schemas,
   V2 drift/store dispatch, Foundation participant, and bootstrap-schema prerequisites.
5. Completed 2026-08-31: approve the written Spec 2 §6 retained-bootstrap-evidence correction and
   durable slot-identity addendum, then write the focused replacement Task 7 plan.
6. Closed 2026-09-04: NEW-53 no longer blocks replacement Task 6. `init` fell to roughly 101s and
   the e2e test now passes at 299.5s against its 600000ms timeout. NEW-53 stays open only as a
   performance question.
7. Now: founder decision on Spec 2 §6.4. The 2026-09-04 fresh review rejected replacement Task 6,
   and the blocker is a data-destroying defect on the success path: a successful `init` renames 14
   of its own 105 manifest artifacts to tombstones — `config.toml`, one schema, and twelve files
   inside the user's Brain — then exits 0 claiming all 105 installed. `bootstrap-retention.ts:1060`
   makes a forward Foundation participant's installed target a retention row, which §6.4 line 1601
   forbids; but §6.4 does not say what replaces it, and the two readings that follow from the text
   both refuse against the real filesystem. NEW-55 carries the reproduction, the cause, and the
   exact question to answer. Do not resume Task 6 implementation before it is answered.
8. Execute Spec 2 Tasks 8–9 for the complete `InstallationManifestV2` migration and V2 new-init
   handoff.
9. Execute the approved Spec 1 plan.
10. Finish the remaining Spec 2 implementation and close the Task 7 checkpoint.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7 Git, automation, update, release | nothing | full local lifecycle is ready for cutover | now |
| A12 | DOS-P10 Managed instruction artifacts — spec, plan, implementation | A11 | all 38 artifacts install, drift-check, and uninstall on both vendors | blocked |
| A13 | DOS-P11 Hooks — spec, plan, implementation | A12 | every supported hook is observed firing and names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — spec, plan, implementation | A13 | all nine scripts are product verbs or documented refusals | blocked |
| A15 | DOS-P8 Founder shadow migration — dedicated plan and execution | A14, L2 | rollback is exercised and one stable cycle completes | blocked |
| A16 | DOS-P9 Public beta and v1 | A15, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

- NEW-49 — expose decided captures through the agent-facing review workflow.
- NEW-47 — verify from Codex source whether model-run commands can write raw JSONL bytes.
- NEW-46 — close the same-uid `PATH` spawn surface or design persisted executable identity.
- NEW-44 — resolve nested-session vendor attribution.

Needs a human, a policy decision, or an external application:

- NEW-45 — observe multiple Codex `agent_message` events with one paid real run; pair with NEW-47.
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
  the comment in `check.yml` asserting a pull-request rule is stale. L2 still owes release
  permissions.
- `development` holds 46 unpushed commits and CI has not run since 2026-08-28 (`d72287a`). Do not
  push until NEW-52 closes. Measured 2026-09-04: `npm run check` was still inside the second of its
  three `vitest` invocations when it was killed at 29 minutes, so the suite does not fit
  `check.yml`'s `timeout-minutes: 30`. NEW-53 lowered `init` to roughly 101s but did not close this.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the load-sensitive and
  intermittent-test cleanup.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A15, A16 |

## Count

- Product sequence: 6 open entries, A11–A16.
- Program plan: replacement Task 7 contains 6 unchecked work steps across 1 unfinished task;
  baseline Tasks 8–9 contain 10.
- Repository backlog: 31 open numbered rows, plus the Foundation watchdog decision.
- Active implementation plans: 44 untouched tasks — 1 in replacement Task 7, 19 remaining in Spec
  2, and 24 in Spec 1. Spec 1 remains blocked until replacement Task 7 and baseline Tasks 8–9 pass.
