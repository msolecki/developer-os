---
name: session-retro
description: Wrap up a session - check for uncommitted, unpushed or unmerged work, open PRs and running background tasks, propose cleanup, give a Done / Not done / Needs you status, update or close the plan, and propose at most a few lessons, rules or skill ideas to keep, applying only what the user approves. Use at the end of a session, when the Stop hook asks for it, or when the user says "podsumuj sesję", "czy wszystko zrobione", "posprzątaj", "kończymy". Unlike the built-in /recap one-line summary, it checks git state and routes lessons to their destination.
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
---

# Session retro

Work from the conversation in your context and from read-only commands. Never open session transcript files. Write nothing until the user approves a specific item.

## 1. State check

Run what applies; outside a git repository, skip the git lines and say so.

```bash
git status --porcelain
git log --oneline '@{u}..' 2>/dev/null || echo "no upstream"
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) && git branch --no-merged "$base"
gh pr list --author @me --state open 2>/dev/null
```

If `gh` is missing or unauthenticated, say the PR check was skipped. List background shells and agents you started this session that are still running (you know them from context).

## 2. Cleanup proposals

From `git worktree list`, `git branch --merged` and `git stash list`, propose removing worktrees and branches whose work is merged, and stashes this session created. Proposals only; show the exact commands.

## 3. Status block

```
Done: <what was finished and verified, with evidence>
Not done: <what remains, and why>
Needs you: <decisions, credentials, manual steps, approvals>
```

## 4. Findings

At most 3 items per heading; omit empty headings. Route each item by this table:

| What | Where |
|---|---|
| user preferences and style corrections | auto-memory or `~/.claude/CLAUDE.md` |
| lessons and decisions that apply beyond this project | vault, via brain-capture |
| facts about this project (commands, stack, conventions) | the project's `AGENTS.md`/`CLAUDE.md` or an ADR |

- **Lessons**: a decision or lesson that outlives the task, with its destination.
- **Rule candidates**: a correction the user made (e.g. "no, use pnpm"), as a minimal diff to the destination file in instruction-review style.
- **Plan update**: for the active plan (declared planning location, default `docs/plans/`). Finished: propose deleting it and `.devos-state.md` next to it, and moving open items to `TODO.md` or the backlog. Not finished: the new status line and a Next action ending with `Next session: 3 notes` (what to do first, what to avoid, what is still unverified).
- **developer-os feedback**: a skill, hook or rule of this plugin that misfired. Draft the issue title and body without client or project names, and the command for the user to run: `gh issue create --repo msolecki/developer-os --title "…" --body-file <file>`.
- **Skill / hook candidates**: a request the user made at least twice, in this session or across sessions you know of. Give a proposed name, the trigger phrases (including the user's Polish wording), and the type (skill or hook).

## 5. Apply

Ask which items to apply, by number. Apply only those: lessons through brain-capture, rule and plan changes as a shown diff, auto-memory as one fact per file.

## Stop point

Stops after the status block and findings with the question "Which items should I apply?". When started by the Stop hook, that question ends the turn; if nothing qualifies (clean git state, nothing running, no findings), it ends the turn with no output: no status block and no question. After the user answers, it applies the approved items and reports each file it changed.

## Never

- Open or search session transcript files.
- Write, edit or delete any file before the user approves that item.
- Commit, push, merge, or delete a branch, worktree or stash without explicit approval of that command.
- Run `gh issue create` or file anything outside the machine.
- Build a proposed skill or hook.
