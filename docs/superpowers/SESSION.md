# Session protocol

> **D36 (2026-09-20) — implementation-first until plan 1a closes.** For the remainder of
> `plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, a task runs its fast commands and
> `npm run lint`, is integrated immediately, and the next task starts. **No per-task fresh-context
> review, no per-task fix cycle, and no per-task push.** Commits are held locally. At plan close the
> founder runs the long checks by hand — `npm run check`, the deferred slow suites (D32), and one
> push to `development` so CI runs every job once — and one whole-plan review plus one fix round
> covers every task. This suspends §5 step 3 and §5 step 7 below, and `security.md`'s rule that a
> fresh agent reviews agent-generated code. Accepted risk: a defect in a consumed interface is found
> only after its consumers bound to it. Plan 1a's "Deferred fix list (D36)" under Task 25 collects
> what is owed. **This block expires when plan 1a closes**; delete it then and §5 returns as written.

Use this prompt in a fresh session:

```text
Continue Developer OS. Read docs/superpowers/SESSION.md and follow it exactly. Act as the
orchestrator of §4.1: dispatch every ready task of the NOW plan in parallel, integrate each reviewed
commit, and keep going wave after wave until the NOW entry closes or a stop condition hits.
```

## 1. Orient

Run:

```bash
git status --short
git log --oneline -5
gh pr list
```

If GitHub CLI configuration is unavailable, record that remote state is unverified; do not infer PR
or CI status.

Read, in order:

1. `docs/superpowers/ORDER.md` — the `NOW` entry is the only product entry to advance.
2. The complete active task or plan linked by that entry.
3. `docs/superpowers/BACKLOG.md` §7 — per-commit gates.
4. The architecture note for each subsystem the task touches.

Do not read inactive plans or reconstruct finished work from git history.

## 2. Verify `NOW`

- If the completion condition is already satisfied and committed, remove the entry, advance `NOW`,
  commit that bookkeeping, and continue with the new entry.
- If the tree contains unexplained changes, stop and ask before building on them.
- If the work is partial, resume from the first unchecked step after confirming earlier evidence.
- If a prerequisite is open, work on that prerequisite; do not execute a blocked implementation
  plan.

## 3. Select the required skill

| Work | Skill |
|---|---|
| Write or revise a product design | `superpowers:brainstorming` |
| Write an implementation plan | `superpowers:writing-plans` |
| Execute an approved plan | `superpowers:subagent-driven-development` or `superpowers:executing-plans` |
| Implement code | `superpowers:test-driven-development` |
| Diagnose a failure | `superpowers:systematic-debugging` |
| Claim completion | `superpowers:verification-before-completion` |

Announce the selected skill. If an approved plan and a generic skill differ on procedure, the plan
wins for this repository.

## 4. Execute one entry

One `ORDER.md` product entry per session.

- A step that asks for a failing test must first fail for the stated reason.
- Tests pin the approved contract, not incidental current behavior.
- Follow the plan's dependency order: a task starts only when every task on its `Consumes:` line is
  integrated on `development` (D33).
- A wrong or unsafe plan step is a stop condition. Report the contradiction and ask; do not silently
  substitute a different design.

### 4.1 Parallel execution (D33)

The session is the orchestrator. It writes no task code itself.

- **Ready set.** From the plan's wave table and `Consumes:` lines, list every task whose inputs are
  integrated. Start them together.
- **Implementer.** One fresh agent per task, in its own worktree outside the repository
  (`../developer-os.worktrees/<task>`, branch `task/<task>` from the current `development`). It
  follows the task's steps with `superpowers:test-driven-development`, runs the fast commands and
  `npm run lint` (D32), commits code and tests only, and reports the commit hash. It never edits
  `docs/superpowers/`, never pushes, never merges.
- **Reviewer.** Suspended by D36 for the rest of plan 1a; the whole-plan review at close replaces it.
  Outside D36: a different fresh agent per task that authored none of it, given the task text, the
  commit diff and review-only instructions. Accepted findings go back to the implementer as a
  failing regression test first. Review of one task overlaps implementation of the next.
- **Integration**, one task at a time, in dependency order: cherry-pick the reviewed commit onto
  `development` (no merge commit); resolve a shared export list by taking the union; rerun
  `npm run lint` and the task's fast commands on the integrated tree; tick the task's steps and
  rewrite the `ORDER.md` progress line; amend them into the integrated commit with exact-path
  staging; push per §5 step 7. Then remove the worktree and branch.
- **One real `init` at a time.** Implementers whose own cases run a real fresh V2 `init`
  (`*.v2.test.ts`, `executor.test.ts`, `tests/`) take turns: concurrent runs drove load to 47 and
  112–120 s cases to 300 s timeouts (`docs/architecture/foundation.md` §9).
- **Side tracks.** A row `ORDER.md` lists as startable without a product gate may run as an extra
  implementer when its files overlap no task in flight.
- **Stop the wave**, not only the task, when an integration conflict is more than a union of
  additions, when a reviewer finds a Critical issue in a consumed interface, or when CI turns red.

## 5. Close the loop

All of these are required:

1. Run the fast commands named by the active task, then `npm run lint`. Slow commands are deferred
   to plan close (decision D32, 2026-09-19): any `npm run test…` or `npm run check` script, and any
   run of `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security`
   or `tests/integration`. The cases the task itself adds or changes in those files still run, red
   then green, filtered with `-t`. Tick a deferred step "deferred to plan close (D32)".
2. Run `npm run check` only when the commit closes an implementation plan, or a roadmap phase that
   closes no plan (D17, narrowed by D32). The founder runs it by hand at plan close, together with
   the slow suites step 1 defers and the single push of step 7; the plan does not close until it is
   green. Under D36 this is the **only** point at which they run. A plan step that names `npm run check` for an ordinary task commit is
   satisfied by step 1 plus step 7.
3. **Suspended by D36 for the rest of plan 1a** — one whole-plan review at close replaces it, and
   the deferred fix list under Task 25 collects what is owed. Outside D36: obtain fresh-context
   review from an agent that did not author the code-producing task. For every accepted finding, add
   a failing regression test first, apply the smallest correction, rerun gates, and request another
   verdict.
4. Make checkboxes match evidence. Remove completed rows from `ORDER.md` and `BACKLOG.md`; delete a
   finished plan only after its surviving constraints are in canonical architecture/program docs.
5. Stage exact task-owned paths. Never use `git add -A`, `git add .`, or a wildcard.
6. Confirm the commit contains only intended paths.
7. **Under D36, do not push per task.** Hold every task commit locally and push once, at plan close,
   as a single run the founder triggers by hand. The rule below is what applies outside D36, and
   what returns when plan 1a closes. Push the commit to `development` so CI runs every job on it — but only when no run is in
   progress there, because `check.yml` cancels a superseded run and a full run takes ~4 h. If one is
   running, hold the commit and push it with the next once that run completes. Do not wait for
   green to start the next task, but check the latest completed run before every new commit: a red
   run stops new commits until it is fixed. Do not merge; the founder owns merging.

## 6. Report and stop

Report what changed, verification evidence, remaining blocker if any, and the new `NOW` action. Then
stop so the next entry begins with fresh context.

## Hard rules

- This repository is public. Do not add founder/client private content, credentials, or real private
  notes.
- Do not read `~/claude-shared`, `~/brain`, or `DEVELOPER_OS_SOURCE_*` during build work. Frozen
  admissible inputs live in `docs/migration/`. DOS-P8 is the only live-machine cutover task.
- Fixtures are synthetic unless an approved task explicitly requires a redacted real-vendor
  recording.
- Redact before truncating, hashing, logging, persistence, publication, or model input.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`.
- Every enumerating gate asserts a non-empty set per scope.
- Reviewer and author are different agents.
- Completed plans/specs are deleted after their surviving contract moves to the owning canonical
  document. Git history is the archive.
- Approved specs are not silently rewritten.

## Stop and ask

- L1 license approval or any legal question.
- Any live-machine change: agent config, launchd, a real Brain, or a real remote. The one
  exception is §5 step 7's push of a reviewed task commit to `development` (D17).
- Spending model credits for observational evidence.
- Spec approval.
- Merge to the default branch.
- A plan step that is impossible, unsafe, contradictory, or already implemented differently.
