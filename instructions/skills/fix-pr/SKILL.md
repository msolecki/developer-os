---
name: fix-pr
description: Address every unresolved pull-request review thread, validate each correction, resolve handled threads, and push the reviewed branch. Use when the user asks to fix PR comments or invokes the fix-pr workflow.
argument-hint: "[PR number]"
---

# Fix PR review feedback

1. Read the current PR comments and query unresolved `reviewThreads` (`isResolved: false`) with `gh`.
2. For each unresolved thread, read the referenced code. Either implement the correction and reply in the thread with one sentence stating what changed, or leave the code unchanged, reply with a concrete justification, and leave the thread unresolved for the reviewer. Run the narrowest relevant test after each fix, then resolve the fixed thread.
3. Run the project's build, lint, and test commands; fix any failure before pushing.
4. Commit with `fix: address PR review feedback` and push the PR branch.
5. Report each comment with its action (fixed, or disputed with the reason).

Do not skip comments. Ask before changing behavior when a comment is ambiguous.
