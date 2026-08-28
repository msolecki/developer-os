# Session protocol

Use this prompt in a fresh session:

```text
Continue Developer OS. Read docs/superpowers/SESSION.md and follow it exactly.
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
3. `docs/superpowers/BACKLOG.md` §6 — per-commit gates.
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
- Follow plan order; later tasks may consume interfaces established by earlier tasks.
- A wrong or unsafe plan step is a stop condition. Report the contradiction and ask; do not silently
  substitute a different design.

## 5. Close the loop

All of these are required:

1. Run the focused commands named by the active task.
2. Run `npm run check`.
3. Obtain fresh-context review from an agent that did not author the code-producing task. For every
   accepted finding, add a failing regression test first, apply the smallest correction, rerun gates,
   and request another verdict.
4. Make checkboxes match evidence. Remove completed rows from `ORDER.md` and `BACKLOG.md`; delete a
   finished plan only after its surviving constraints are in canonical architecture/program docs.
5. Stage exact task-owned paths. Never use `git add -A`, `git add .`, or a wildcard.
6. Confirm the commit contains only intended paths.
7. Confirm CI is green on the exact commit before merge. Do not merge; the founder owns merging.

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
- Any live-machine change: agent config, launchd, a real Brain, or a real remote.
- Spending model credits for observational evidence.
- Spec approval.
- Merge to the default branch.
- A plan step that is impossible, unsafe, contradictory, or already implemented differently.
