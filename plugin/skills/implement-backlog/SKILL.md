---
name: implement-backlog
description: Implement evidence-backed backlog items in small batches, validate every item and the full batch, get an independent review, update the backlog and plan, and commit only green work. Use when the user invokes implement-backlog or asks to execute an audit backlog, for example "napraw wszystko wieloma agentami", "zrealizuj backlog", "wdróż poprawki z audytu".
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
argument-hint: "[category | task ID | --batch N]"
---

# Implement backlog

## Initialize

- Find the backlog paths: a `Backlog: <todo path>, <done path>` line in the project's `AGENTS.md` or `CLAUDE.md`, otherwise `TODO.md` and `TODO-done.md`. Read them, the project's active plan, and recent history.
- Detect the repository's real validation commands and run them. If the baseline is red, stop, report the failures, and ask how to proceed.
- Default batch: the next implementation session listed in the backlog. Without one, select the highest-priority related tasks; default five, maximum ten.
- List the batch items that touch authentication or security boundaries and ask once, up front, whether to include them.
- If `feature_list.json` exists, change only its `passes` field, and only after end-to-end verification.

## Implement and validate

- Delegate in parallel only independent tasks with disjoint files. Each delegate gets its own git worktree, one exact item, allowed paths, constraints, and validation, and commits there; you integrate their commits and commit the result. Otherwise run tasks sequentially.
- Run the narrowest relevant validation after every item.
- Run the full build, type check, tests, and lint for the batch. Show only failures.
- Classify test failures before editing. Fix source code when a test reveals a real defect; change assertions only for an explicitly changed contract.
- Stop after three failed repair cycles, preserve a deployable state, update the plan, and report concrete options.

## Review and record

- Get a review from `developer-os:code-reviewer`. Fix P0/P1 findings; add P2/P3 to the backlog.
- Move completed items to the done file and update the project's active plan.
- Stage only batch-owned files and commit only after all validation and review pass.
- Report evidence, review additions, and the next batch.

## Stop point

Stop after the batch is committed locally, or earlier at a red baseline or after three failed repair cycles. Return the validation evidence, review additions, and the next batch.

## Never

- Push or force-push, merge or rebase a shared branch, or open a PR.
- Include authentication or security items the user did not approve up front.
- Delete or skip tests, or change assertions for a contract that did not change.
- Commit red work or files outside the batch.
- Change any `feature_list.json` field other than `passes`.
