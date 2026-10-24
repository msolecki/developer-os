---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Glossary

| Term | Meaning |
|---|---|
| Action skill | Any skill that is not read-only. It must end with `## Stop point` and `## Never`, even when, like bug-triage, deploy-checklist and client-reply, it writes nothing itself. |
| Read-only skill | A skill exempt from the `## Stop point`/`## Never` check (`read_only` in `scripts/check.sh`): brain-search, code-review, plan-status, skill-usage and the `*-conventions` skills. It changes nothing and proposes no action. |
| Conventions skill | A `*-conventions` skill with stack- or file-specific rules, loaded only when its description matches the work. |
| Core rules | `plugin/rules/core.md`, printed into every session by the `SessionStart` hook. |
| Brain, vault | The user's Obsidian vault of Markdown notes, the agent's long-term memory. |
| `Brain vault:` line | `Brain vault: <absolute path>` in a `CLAUDE.md` or `AGENTS.md`; how skills find the vault. |
| Inbox note | A note an agent created in `_inbox/` with `status: inbox`; unreviewed, a draft rather than a fact. |
| Promote | Move an approved inbox note to a topic folder and set `status: active` (brain-review). |
| Archive | Move a note to `_archive/` with `status: archived`. The plugin's replacement for deletion. |
| Superseded note | A note replaced by a newer one: `status: superseded` and `superseded_by: "[[note]]"`, kept in its topic folder as history. |
| Compiled note | A brain-compile note synthesized from at least two active notes, with a `sources:` list and the `compiled` tag. |
| Stale note | An active note whose `updated` is more than 180 days old. |
| Orphan | A note outside `_inbox/` and `_archive/`, not superseded, that no wiki link targets. |
| FOUND / GUESSED | brain-garden's tag on a proposed link: stated in both notes, or inferred. "Apply all" covers only FOUND. |
| Vault project slug | The `project:` value for a repository's notes, recorded in its `_Context.md`. |
| P0–P3 | The single severity scale: P0 exploitable security defect, data loss or production down; P1 wrong behavior on a common path; P2 edge case or meaningful maintainability risk; P3 minor. |
| Verdict | `APPROVE`, `COMMENT` (an open question decides P0/P1) or `REQUEST_CHANGES` (an open P0/P1). |
| Fresh verifier | An agent that did not produce a P0/P1 finding and sees only the claim, asked to disprove it. Codex when installed, otherwise the read-only `verifier` agent, which is also the only choice for an untrusted head. |
| Disputed | A finding the verifier refuted; listed with evidence, does not block the verdict or enter the backlog. |
| Fast check | Lint, types and tests of the changed area, run before every commit. |
| Full suite | The project's complete validation, run once before a push or PR. |
| Status block | The closing **Done / Not done / Needs you** block the core rules require. |
| Backlog | The todo and done files named by the `Backlog:` line (default `TODO.md`, `TODO-done.md`), with P0–P3 sections and implementation sessions. |
| `BASE-NN` | A backlog item ID created by project-baseline. |
| Item ID | A backlog item's category prefix and number (`SEC-03`), unique across the todo and done files. |
| Done when | A backlog item's acceptance criterion; never edited, only amended by an appended dated line. |
| Check | A backlog item's command that fails while its `Done when` does not hold. |
| Owner | The worktree an item was dispatched to, with the date; written only by implement-backlog. |
| Ready / waiting / claimed / orphaned | An open backlog item's one bucket, checked orphaned, waiting, claimed, ready: no open blocker and no owner / an open `Blocked by` / an owner of 7 days or less / an owner older than 7 days. |
| Final status | The first line of every agent report: `DONE`, `REVIEW`, `BLOCKED` (with an unblock owner) or `CONTINUING`. |
| Evidence checked | The files read and commands run that a reviewer lists under an `APPROVE` with no P0–P2. |
| State card | The task state the `SessionStart` hook prints after a compaction, resume or fork, from `docs/plans/.devos-state.md` and git. |
| Surface | The public names in `plugin/SURFACE.txt`: skills, agents, output styles, hook events and scripts. |
| Active plan | The most recently updated plan in the planning location whose task is not done. |
| Nudge | The `Stop` hook's one-time request to run session-retro after 30 tool calls. |
| Routine | A Claude Code cloud session on a schedule or API trigger; used optionally for phone capture and a weekly vault brief. |
| Eval, Δ | A `claude plugin eval` case; Δ is the with-plugin score minus the baseline score. |
