---
name: fix-pr
description: Address every unresolved pull-request review thread, validate each correction, and, after the user confirms, push the branch and resolve handled threads. Use when the user asks to fix PR comments or invokes the fix-pr workflow.
argument-hint: "[PR number]"
---

# Fix PR review feedback

1. Read the current PR comments and query unresolved `reviewThreads` (`isResolved: false`) with `gh`.
2. For each unresolved thread, read the referenced code. Either implement the correction, or leave the code unchanged and note a concrete justification. Run the narrowest relevant test after each fix.
3. Run the project's build, lint, and test commands; fix any failure before going further.
4. Show the user a summary of changes: each thread with its action (fixed, or disputed with the reason) and the reply you intend to post. Ask before continuing.
5. Commit following the repository's commit-message convention (read recent `git log` and any contributing guide). Ask before pushing the PR branch.
6. After the push, ask before resolving threads. Reply in each thread with one sentence (what changed, or the justification), and resolve only the fixed threads the user approved; leave disputed threads unresolved for the reviewer.
7. Report each comment with its final action.

Do not skip comments. Ask before changing behavior when a comment is ambiguous.
