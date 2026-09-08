# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Roadmap Phase 2 closed 2026-09-07/08 as `632f220..446148b`, ten tasks. Its plan is deleted; the
surviving constraints are in `docs/architecture/foundation.md` §4 (the shared admission module) and
§9 (measured cost, and the corrected reason for it). NEW-51, NEW-59 and NEW-52 are closed, NEW-53 is
rewritten to the encoder cost it actually leaves, and NEW-29 is narrowed rather than closed —
decision D13 closed it on the eight retained-evidence timeouts, which never reproduced, but the row
is the class of elapsed-time assertions and another member of it failed on CI the same week.

**The accumulated commits are pushed and CI is green on all five jobs for the first time in this
program**: run 34157609332 on `446148b`. It took five runs, and four of the five failures were
things a green local gate cannot see. `bootstrap-executor` had no `Build` step; `suite` carried a
40- then 75-minute bound derived from the most favourable local measurement, against a hosted runner
measured at ~1.9-2x this laptop; and two test budgets were arithmetically wrong. The fifth was a
**shipped product defect**: `RENAME_FLAGS` was `0x34`, an undefined `0x20` bit on top of
`RENAME_EXCL | RENAME_NOFOLLOW_ANY`, which Darwin 25.6.0 ignores and Darwin 24.6.0 rejects — so
every retained rename failed on macOS 15, on the real CLI path. Nothing local could have found it.
The corrected constant and the measurement that settled it are at
`packages/platform-macos/src/retained-rename.ts:50`.

**The next action is roadmap Phase 3 — Spec 2 Tasks 8–9, the `InstallationManifestV2` migration and
the V2 new-init handoff** (`plans/2026-09-04-developer-os-completion-roadmap.md`). **It does not
open with code.** Phase 3's own first line requires amending Spec 2 §6.2/§6.3 and the baseline plan
text for NEW-68 — `admittedExternalShapeHash` for the migration plan, and the mode of the reserved
lifecycle-activation path. An approved spec is not rewritten silently, so that amendment is a
founder stop condition and comes before any task in `plans/2026-08-29-developer-os-release-update.md`.

Spec 1 is approved and its plan exists at `plans/2026-08-28-developer-os-opt-in-surfaces.md`, with
none of its 24 implementation tasks started. Spec 2's Tasks 1–7 are complete and Tasks 8–26 remain.

Open sequence inside A11:

1. Now: amend Spec 2 §6.2/§6.3 for NEW-68, then stop for founder approval.
2. Execute Spec 2 Tasks 8–9 — the complete `InstallationManifestV2` migration and the V2 new-init
   handoff (roadmap Phase 3).
3. Execute the approved Spec 1 plan, split into 1a and 1b by NEW-67.
4. Finish the remaining Spec 2 implementation and close the Task 7 checkpoint.

Phase 3 onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (10 open phases,
3 through 11 with a 5b, the founder decisions of 2026-09-04 and 2026-09-07, and the spec or plan each
phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

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

- NEW-75 — supply each vendor's credential path separately, then prove it with one real
  authenticated `ingest` per vendor. Narrowed 2026-09-07 by D15: admitting `HOME` is refused,
  because the resolution that strews the files is the one that finds the credentials.
- NEW-45 — observe whether a real Codex turn ever emits more than one `agent_message`, with one paid
  run. Narrowed 2026-09-05: NEW-47 is closed from source and corroborates the last-wins tie-break.
- NEW-42 — observe capture inside both vendors' interactive sessions.
- NEW-33 — decide whether root-owned, group-writable executable directories are acceptable.
- NEW-7 — verify percent-encoded local links in Obsidian.
- Foundation watchdog — decide whether `SpawnLockfRunner` needs one around non-blocking `lockf`.

The remaining open repository rows are NEW-20, NEW-24–NEW-29, NEW-31, NEW-32, NEW-34–NEW-40, and
NEW-76.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant.

## Delivery evidence still owed

- L2 still owes release permissions. Everything else it covered is now evidenced: `gh auth status`,
  `gh pr list` and `gh run list` succeed, and the `baseline` ruleset on `development` carries only
  `deletion` and `non_fast_forward`, so neither a status check nor a pull request gates a direct
  push. That was verified by pushing, not inferred.
- **The first push landed 2026-09-07: `d72287a..446148b`, closing a backlog of 125 unpushed commits
  and a CI gap since 2026-08-28.** Per decision D12 it went directly to `development` rather than
  through a probe branch.
- **CI is green on all five jobs**, run 34157609332 on `446148b`: `lint` 0.8 min, `vendor-ingest`
  0.5 min, `e2e` 6.8 min, `suite` 66.8 min (135 files, 4,587 passed), `bootstrap-executor` — the
  job that had never once executed before this week, since `check.yml` had a single `check` job at
  `d72287a`.
- **The local `check` is green and takes about three hours**, measured 2026-09-07 at 11:05:48→14:01:54:
  `EXIT=0`, 4,723 tests. `test:bootstrap` 122.6 min, `test:suite` 46.3 min under load, `test:e2e`
  274.89 s, `test:vendor-ingest` 30.27 s.
- **A green local `check` is not evidence about CI, and this is now recorded rather than learned
  again.** The local chain begins with `lint`, which is `tsc -b`, so every `dist` exists before any
  test runs; CI splits into five jobs with no shared filesystem. And the development laptop runs a
  newer Darwin than the runner, which is how an undefined `renameatx_np` flag bit shipped. Both
  instances are in `BACKLOG.md` §5.
- CI job budgets are 20/330/150/40/15 minutes and are sized from a **measured** ~1.9-2x hosted-runner
  ratio, not a guess; two of them were killed by bounds derived from the most favourable local
  number before that ratio was measured. They are bounds that let the gate report, not targets —
  NEW-53's residual owns making them unnecessary.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the remaining elapsed-time
  assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A15, A16 |

## Count

- Product sequence: 7 open entries, A11, A12, A12b, A13, A14, A15, A16.
- Program plan: baseline Tasks 8–9 contain 10 unchecked steps.
- Repository backlog: 41 open numbered rows, plus the Foundation watchdog decision.
- Active implementation plans: none for the current phase. Roadmap Phase 3 opens with a **spec
  amendment** (Spec 2 §6.2/§6.3 for NEW-68), which is a founder stop, and only then Spec 2 baseline
  Tasks 8–26 (19 tasks) in `plans/2026-08-29-developer-os-release-update.md`. Spec 1 (24 tasks, to be
  split by NEW-67) follows. 43 untouched tasks across the two, behind the completion roadmap's 10
  open phases.
