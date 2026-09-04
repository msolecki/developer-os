# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Spec 2's Task 7 checkpoint is accepted. The six-task replacement plan
`plans/2026-08-31-developer-os-retained-bootstrap-evidence.md` is complete, committed as
`050fc0d..c5022a7`, and each of its tasks was reviewed by an agent that did not author it; a
whole-range fresh review returned `READY` after one Critical fix.

The next action is roadmap Phase 1 — isolate the ingest invocation on both vendors (NEW-58)
(`docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md:41`). It comes before every
other A11 task because it is a security defect in shipped code: an ingest run loads the user's own
permission settings, hooks and MCP servers, and on Codex persists a thread in the user's history.
Phase 1 also closes NEW-44. **The plan it requires,
`plans/<date>-developer-os-ingest-isolation.md`, does not exist and must be written first**, through
`superpowers:brainstorming` → `superpowers:writing-plans`, as `SESSION.md` requires.

Spec 1 is approved and its plan exists at `plans/2026-08-28-developer-os-opt-in-surfaces.md`, but
none of its 24 implementation tasks has started. Spec 2's 2026-08-29 baseline and 26-task plan exist
at `specs/2026-08-28-developer-os-release-update-design.md` and
`plans/2026-08-29-developer-os-release-update.md`; its Tasks 1–7 are complete and Tasks 8–26 remain.
Across the active implementation plans, 43 tasks remain untouched. Baseline Tasks 8–9 are roadmap
Phase 3 and stay behind Phases 1 and 2.

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
7. Completed 2026-09-04: the founder ruled Spec 2 §6.4 (forward-participant content is never a
   retention row, every outcome), §6.1 (global-lock admission after a crash that lost its creation
   evidence) and the `admittedPreexistingPaths` plan grammar. All three are recorded as dated
   amendments.
8. Completed 2026-09-04: the uncommitted replacement Task 6 tree became the accepted Task 7
   checkpoint, `050fc0d..c5022a7` — spec amendments, global-lock admission after a crash, one
   retention derivation that never retains forward content, the gate blockers, the review residuals,
   and the retained-evidence reports. Fresh review `READY`; the closure plan was deleted at closure.
9. Now: roadmap Phase 1, ingest isolation (NEW-58, NEW-44). Write
   `plans/<date>-developer-os-ingest-isolation.md` first; it does not exist.
10. Roadmap Phase 2: bootstrap performance and the first push (NEW-53, NEW-52).
11. Execute Spec 2 Tasks 8–9 for the complete `InstallationManifestV2` migration and V2 new-init
    handoff (roadmap Phase 3).
12. Execute the approved Spec 1 plan, split into 1a and 1b by NEW-67.
13. Finish the remaining Spec 2 implementation and close the Task 7 checkpoint.

Phase 1 onward is sequenced by
`plans/2026-09-04-developer-os-completion-roadmap.md` (12 open phases, 1 through 11 with a 5b, the
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

- NEW-58 — isolate the ingest invocation on both vendors; this is the current `NOW` (roadmap
  Phase 1).
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
  the `check.yml` comment now says so. L2 still owes release permissions.
- `development` holds 72 unpushed commits and CI has not run since 2026-08-28 (`d72287a`), when
  the whole check took three and a half minutes. Do not push until the four-job `check.yml` in the
  working tree is green on a probe branch (roadmap Phase 2): the `suite` job must build `dist`
  before it runs, and `test:suite` must exclude `e2e/**`. Measured 2026-09-04: `npm run test:suite`
  alone took 41 minutes and failed two gates, control bytes and citations; both are fixed
  (`ed158c2`, `c5022a7`). The local `check` gate now runs `lint`, `test:bootstrap`, `test:suite`,
  `test:e2e`, the build and `git diff --check`, so `e2e/**` is covered locally as well as by its
  own CI job. The full `check` timing after the Task 6 checkpoint is still unmeasured.
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
- Repository backlog: 44 open numbered rows, plus the Foundation watchdog decision.
- Active implementation plans: Spec 2 baseline Tasks 8–26 (19 tasks) and Spec 1 (24 tasks, to be
  split by NEW-67) — 43 untouched tasks — plus the completion roadmap's 12 open phases. Spec 1
  remains blocked until roadmap Phases 1–3 pass.
- `plans/2026-08-31-developer-os-retained-bootstrap-evidence.md` is complete, six of six tasks, and
  carries no unchecked step. Roadmap Phase 1 requires
  `plans/<date>-developer-os-ingest-isolation.md`, which has not been written.