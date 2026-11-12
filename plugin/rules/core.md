# developer-os core rules

## Security and change constraints

- Change authentication or middleware only when the user asks for it explicitly; those paths gate access for every user.
- Ask before running a dependency install (`npm install`, `pip install`, `cargo add`, `npx -y`, and the like): it rewrites dependencies and the lockfile.
- Do not delete or skip tests to make a build pass; a green build without its tests proves nothing.

### Validation — two tiers

- Before each commit, run the fast check: lint, types, and the tests of the changed area. Run the full suite before a push or PR, or when a skill's gate requires it; never mid-task on your own. The project declares both in its agent instructions (`CLAUDE.md`/`AGENTS.md`); otherwise derive them from its package manifest or README/CONTRIBUTING/Makefile. If neither exists, say so and ask before committing.
- Before changing test config, coverage or CI gates, update the governing decision record in the same change.

### Subagents — verify their work

- Treat any authentication, 2FA, or security change from a subagent as unauthorized until reviewed. A subagent can add an environment-flag bypass that disables a second factor.
- After a subagent finishes, compare the working tree with the commit using `git status` and `git diff`; uncommitted subagent changes are yours to commit.
- A reviewer's finding is a hypothesis: read the code and the project's canonical helper or schema before fixing; a framework claim needs the framework's docs or source.
- Run the area's tests before applying a reviewer's fix; a red pinned test means it reverses a decision, so surface it.

### External repositories (clients and OSS) — first-session procedure

- Before the first session in an external repository, read its `.claude/settings.json`, `.claude/hooks/`, and `.mcp.json` (and the equivalents for any other agent). Its hooks run in your shell, and its MCP servers run once you approve them.
- Use a sandbox or a plan-only permission mode for the first session in an external repository. Inspect first, then grant permissions.
- Never copy configuration or hooks from an external repository into your user-level agent configuration (`~/.claude`) without reading every line.

## Workflow

- Stop when the fast check passes and you can give the closing status block (see Communication). A session that must end earlier stops at its last green commit, with the rest recorded in the plan.
- When a decision is open, ask with options A/B/C instead of assuming.
- Before changing over 50 lines of code, write a plan: one per task, in the project's git-ignored planning location (default `docs/plans/<YYYY-MM-DD-task>.md`) with the goal, decisions, and next action, updated after every stage. The active plan is the most recently updated plan there whose task is not done; specs go to `docs/specs/` or the project's spec location. After a context reset, resume with "continue from <plan path>". When the task is done, check that every step landed in committed code, then delete the plan; move unfinished items to the backlog (`Backlog:` paths, default `TODO.md`). A project may override this in its `AGENTS.md`.
- Every plan step states What (deliverable), Where (files), How (approach), and **Test** (verification). The system stays deployable after every step. Use S/M/L complexity instead of time estimates.
- A fresh subagent that did not inherit the author's context reviews agent-generated code; reviewer and author are different agents.
- An agent handoff (a handoff file or a subagent prompt) contains the objective, file paths, constraints, expected output format, and what is not started or not verified. Exclude debugging history, rejected approaches, and full conversation dumps.
- Before a large task, look for earlier decisions: when a vault is configured (the `brain_vault` option or a `Brain vault:` line), search the vault with the `brain-search` skill and read the selected note (otherwise skip this silently), then read the project's active plan. Search raw session transcripts only when the user asks.
- During compaction, preserve the modified-file list, the project's test commands, the current objective, and the user's language. Task state that must survive it lives in `docs/plans/.devos-state.md`, not only in chat.
- Show only failures from tests and builds, never a full passing log.
- Claims such as "works" or "fixed" require evidence: test output, command result, or screenshot. A declaration alone is not evidence. A new or changed gate or test counts only after you saw it fail: mutate with an edit, watch it go red, undo that edit (not with git, which discards other work).
- Before saying done, list the background shells and tasks you started and stop those no longer needed.
- Never promise to report back later ("I'll let you know"): you cannot act between turns. Run the work as a background task that notifies on completion, or give an ETA and what the user should check.
- If the user asks for the same thing three times, say so and propose a skill or hook.

### Parallel agents — one checkout each

- Run every parallel agent in its own git worktree (`git worktree add`, or the project's worktree script). Two sessions in one checkout corrupt each other's staging area, and a push from one restarts CI on the other's older state.
- Stage explicit paths, never `git add -A` or `git add .`; if a checkout is shared anyway, commit with `git commit -F <msg-file> -- <paths>`. Re-run `git status` right before the first edit.
- Two sessions share a checkout anyway: before a commit, a branch switch or an edit of a file the other may hold, tell that session (`ListAgents`, `SendMessage`) and wait for its answer before a commit or switch. If the message cannot be delivered: for an edit, check `git status` right before and after it and tell the user which session you could not reach; for a commit or switch, stop and ask the user.
- No `git stash` in a lane: worktrees share one stash; compare with `git show HEAD:<path>` instead.
- One orchestrator owns push and integrate. Lanes produce commits inside their worktree and stop there; they do not push, merge, or rebase shared branches.
- Before dispatching parallel agents, state which worktree each one gets. "Both in the main repository" is not a plan, it is the failure above.
- When the project provisions per-worktree resources (ports, a compose project name, an environment file), use those instead of the default ports, and release them with the project's cleanup command when the branch is done.
- After integrating lanes, run the repository-wide gate on the result. Resume an interrupted lane only through parallel-lanes' Resume mode; otherwise start a fresh, smaller one.

### Conventions skills

Stack- and file-specific conventions are the `*-conventions` skills. Do not copy them into these rules. A new lesson goes to the project's own instructions when it is stack- or file-specific, to the knowledge base (the `brain-capture` skill) when other projects can use it, and to these core rules only when it governs every kind of work.

## Communication

- Converse with the user in the user's preferred language, and keep it after English input, English subagent reports, and compaction. Write everything that lands in a repository in English unless the project says otherwise: code, identifiers, commit messages, documentation, rules, plans, and specifications. A project's explicit language requirement governs user-facing copy.
- Write client-facing text (emails, briefs, status updates) in plain business language: outcomes, dates, and decisions, no internal jargon or file paths.
- Be direct and honest: say "this will not work because X," not "you may want to consider."
- Lead with the substance and skip conversational filler ("great question," "I'd be happy to") anywhere in the reply.
- Structure problem-solving responses as Problem → Cause → Solution → Test.
- End a task with a status block, labels as written: **Done** (what changed, with evidence), **Not done** (what remains and why), **Needs you** (decisions or actions only the user can take). Write "none" for an empty part.
- When the user says "ASAP" or "quickly," use at most three sentences, only critical actions, and a one-line status block instead of the structures above.
- When required data is missing, say "I need X, Y, and Z" instead of guessing.

## Stack preferences

- Use the package manager the repository's lockfile declares; never mix managers in one repository.
- Follow the project's existing UI, backend, and database stack; introduce a new framework or service only with an explicit decision.

Override this section with your own defaults in your user-level `CLAUDE.md`.
