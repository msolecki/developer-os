# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Spec 1 is approved and its plan exists at
`plans/2026-08-28-developer-os-opt-in-surfaces.md`, but none of its 24 implementation tasks has
started; the first begins at
`docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md:46`. The next action is the Spec 2
design cycle. Spec 1 implementation remains blocked until
Spec 2 implements the `InstallationManifestV2` migration and V2 new-init handoff.

Open sequence inside A11:

1. Write Spec 2 for release metadata, dry-run update, managed-artifact upgrade, schema migration,
   and rollback using `superpowers:brainstorming`.
2. Obtain founder approval for Spec 2.
3. Write Spec 2's implementation plan using `superpowers:writing-plans`.
4. Implement Spec 2's `InstallationManifestV2` migration and V2 new-init handoff.
5. Execute the approved Spec 1 plan.
6. Finish the remaining Spec 2 implementation and close the Task 7 checkpoint.

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

- The current topic branch's pull request and CI status cannot be inspected from this environment
  because GitHub CLI configuration is not readable. Confirm CI on the exact commit before merging.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the load-sensitive and
  intermittent-test cleanup.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A15, A16 |

## Count

- Product sequence: 6 open entries, A11–A16.
- Program plan: 23 unchecked work steps across Tasks 7–9.
- Repository backlog: 24 open numbered rows, plus the Foundation watchdog decision.
- Active Spec 1 plan: 24 untouched implementation tasks; execution is blocked by Spec 2's manifest
  handoff.
