# Workflow

- Create a plan before implementing changes larger than 50 lines of code.
- Stop only when the repository's declared validation passes (the commit ladder in the `security` rule; a declared per-commit lane counts) and you can provide a three-bullet summary of what changed.
- When you do not know, ask with options A/B/C instead of assuming.
- Keep one written plan per task in the repository's declared planning location (if the project declares none, `docs/plans/<YYYY-MM-DD-task>.md`) with the goal, decisions, and next action, updated after every stage; keep specifications next to it in the declared specification location. After a context reset, resume with "continue from <plan path>". End a session with a commit and an updated plan, never halfway through a change.
- Every plan step must state What (deliverable), Where (files), How (approach), and **Test** (verification). The system must remain deployable after every step. Use S/M/L complexity instead of time estimates.
- A FRESH subagent that did not inherit the author's context or assumptions must review agent-generated code. Reviewer and author must be different agents.
- An agent handoff (a handoff file or a subagent prompt) contains the objective, file paths, constraints, and expected output format. Exclude debugging history, rejected approaches, and full conversation dumps.
- Before a large task, look for earlier decisions instead of starting from zero: search the knowledge base first with the `developer-os-brain-search` skill, then read the project's active plan. Raw session transcripts are a last resort; search them only when the knowledge base has no answer.
- During compaction, ALWAYS preserve the modified-file list, project test commands, and current objective.
- Read the selected knowledge-base note before deriving an answer from scratch. Search through the index; never grep an entire knowledge tree.
- Show only failures from tests and builds, never a full passing log.
- Claims such as "works" or "fixed" require evidence: test output, command result, or screenshot. A declaration alone is not evidence.

## Parallel agents — one checkout each

- Run every parallel agent in its own git worktree (`git worktree add`, or the project's worktree script). Two sessions in one checkout corrupt each other's staging area, and a push from one restarts CI on the other's older state.
- One orchestrator owns push and integrate. Agents produce commits inside their worktree and stop there; they do not push, merge, or rebase shared branches.
- Before dispatching parallel agents, state which worktree each one gets. "Both in the main repository" is not a plan, it is the failure above.
- When the project provisions per-worktree resources (ports, a compose project name, an environment file), use those instead of the default ports, and release them with the project's cleanup command when the branch is done.

## Scoped rules

Stack- and file-scoped rules (`typescript`, `nextjs`, `error-handling`, `monitoring`, `comments`, `testing`, and `lessons-code`, the last one holding verified defect classes) load only for files that match their `paths:` globs. Do not copy their content back into this rule. A new lesson goes to a scoped rule when it is stack- or file-specific, to the knowledge base (the `developer-os-capture` skill) when it is project history, and to this rule only when it governs every kind of work.
