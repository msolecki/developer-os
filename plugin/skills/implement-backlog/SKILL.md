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
- Take only ready items: open (`- [ ]`), every `Blocked by` ID checked or in the done file, and no `Owner` other than this run's own worktree. A blocked item waits even at higher priority; take its blocker instead when that is ready.
- List the batch items that touch authentication or security boundaries and ask once, up front, whether to include them.
- If `feature_list.json` exists, change only its `passes` field, and only after end-to-end verification.

## Delegate

- Delegate in parallel only independent tasks with disjoint files. Each delegate gets its own git worktree and commits there; you integrate their commits and commit the result. Otherwise run tasks sequentially.
- Before dispatching an item, write `Owner: <worktree path> (<YYYY-MM-DD>)` under it in the backlog. Never dispatch an item that already has another owner.
- Size the brief by the item's `Size`:
  - S: the objective, the item's `Where`, its `Check`, and the report contract;
  - M: also its `Done when` and the files the delegate must not touch;
  - L: the delegate writes a plan only and stops with `REVIEW`; you approve the plan before it writes code.
- Every brief ends with the final-status contract: the report's first line is `DONE` (with the `Check` command and its result), `REVIEW`, `BLOCKED` (with `Unblock owner: user | orchestrator | <item ID>`) or `CONTINUING`. Transient failures (network, timeout, a flaky test) are retried at most twice; failures only a person can fix (authentication, quota, a missing secret, an unclear spec) are `BLOCKED` at once.
- While any delegate runs, you only integrate commits, resolve conflicts, dispatch reviews, run the batch validation, and update the plan and the state card. You do not implement backlog items yourself.

## Read the reports

1. Read the first line of each report. Without a final status, send it back once; a second miss counts as `BLOCKED`, `Unblock owner: orchestrator`.
2. `DONE`: run the item's `Check` yourself before integrating.
3. `REVIEW`: approve or reject the plan, then dispatch the item again.
4. `BLOCKED`: with `Unblock owner: user`, stop that item and list it under Needs you; otherwise unblock it or move on.
5. `CONTINUING`: dispatch the same item again with what resumes it.

## Implement and validate

- Run the item's `Check` after every item and report the command and its result. If a `Done when` is wrong, stop and propose an `Amended` line to the user; never edit or delete it.
- Run the full build, type check, tests, and lint for the batch. Show only failures.
- Classify test failures before editing. Fix source code when a test reveals a real defect; change assertions only for an explicitly changed contract.
- Stop after three failed repair cycles, preserve a deployable state, update the plan, and report concrete options.

Keep the task state in `<planning location>/.devos-state.md` (default `docs/plans/.devos-state.md`, git-ignored with the plans): overwrite it at every stage change, so the `SessionStart` hook can show it after a compaction. At most 15 lines:

```
Plan: docs/plans/2026-10-15-checkout-retry.md
Item: CART-12 (in progress)
Agents: .worktrees/cart-13 → CART-13, .worktrees/cart-14 → CART-14
Unverified: <claims without evidence yet>
Next: <one line>
```

## Review and record

- Get a review from `developer-os:code-reviewer`. Fix P0/P1 findings; add P2/P3 to the backlog.
- Check completed items (`- [x]`), move them to the done file with their `Check` result, and update the project's active plan.
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
- Edit or delete a `Done when`, or take an item another worktree owns.
- Implement a backlog item yourself while a delegate is running.
