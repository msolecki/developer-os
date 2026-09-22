---
name: implementator
description: Implement evidence-backed TODO.md items in small batches, validate every item and the full batch, obtain fresh independent review, update the backlog and plan, and commit only green work. Use when the user invokes implementator or asks to execute a TODO.md audit backlog.
argument-hint: "[category | task ID | --batch N]"
---

# Implement the audit backlog

## Initialize

- Read `TODO.md`, `TODO-done.md`, the project's active plan, and recent history.
- Detect the repository's real validation commands and require a green baseline build.
- Select the highest-priority related tasks; default five and maximum ten.
- If `feature_list.json` exists, change only its `passes` field, and only after end-to-end verification.

## Implement and validate

- Delegate only independent tasks with disjoint files; give each agent one exact item, allowed paths, constraints, and validation.
- Handle dependent tasks sequentially.
- Run the narrowest relevant validation after every item.
- Never modify authentication or security boundaries without explicit authorization.
- Run the full build, type check, tests, and lint for the batch.
- Classify test failures before editing. Fix source code when a test reveals a real defect; change assertions only for an explicitly changed contract.
- Stop after three failed repair cycles, preserve a deployable state, update the plan, and report concrete options.
- Never delete or skip tests to make validation pass, never force-push, and never leave the tree broken (stash if needed).

## Review and record

- Use a fresh reviewer with no inherited author context. Fix CRITICAL/HIGH findings; add lower findings to `TODO.md`.
- Move completed items to `TODO-done.md` and update the project's active plan.
- Stage only batch-owned files and commit only after all validation and review pass.
- Report evidence, review additions, and the next batch.
