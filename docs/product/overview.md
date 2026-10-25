---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-24
---

# Product overview

## The problem

An AI coding agent starts every session from zero. Decisions made last week, the reason one library
was rejected, the bug that took an afternoon: none of it survives the session unless someone writes
it down where the next session will look. At the same time, the agent's defaults are not the habits
of a careful engineer: it commits without running the right checks, claims "fixed" without
evidence, reviews its own code, installs dependencies unasked and forgets the user's language
after compaction.

## What developer-os is

A Claude Code plugin, installed from this repository as a plugin marketplace, that adds two things:

1. **Long-term memory in an Obsidian vault.** Seven `brain-*` skills let the agent search the vault
   before a task, capture decisions and lessons into the vault's `_inbox/` while it works, and help
   the user review, garden and consolidate what was captured. The vault is plain Markdown; the agent
   reads and writes it with its own file tools. The user approves everything that becomes knowledge.
2. **An engineering operating model.** Core rules loaded into every session, workflow skills
   (review, spec, audit, backlog, PR cycle, triage, deploy checklist, docs sync, session wrap-up),
   conventions skills, ten agents (nine specialists and a verifier), four output styles and a small Bash guard.

The plugin is Markdown and JSON plus four Python 3 hook scripts (standard library only). There is no server, database,
index, binary, background job or network call in the plugin itself.

## Who it is for

- The primary user is a developer working alone or in a small team on several client and product
  repositories with Claude Code, who wants decisions to outlive sessions and repositories.

## Product principles

1. **The human approves what becomes knowledge.** The agent creates notes only in `_inbox/` with
   `status: inbox`; it edits, moves or archives any other note only after the user names it.
2. **Archive, never delete.** Retired, merged and rejected notes move to `_archive/` with
   `status: archived`.
3. **Propose, then act on a named yes.** Every skill that changes files, git state or anything
   outside the machine stops at a defined point and asks; silence or "looks good" is not approval.
   Each action skill states its `## Stop point` and `## Never` sections, and `scripts/check.sh`
   fails without them.
4. **Evidence over declaration.** Findings carry a file and line, reviews rate on one P0–P3 scale,
   blocking findings go to a fresh verifier, and "works" needs test output.
5. **One fact in one place.** Code facts and plans stay in the repository; lessons that outlive a
   repository go to the vault; user preferences go to `~/.claude/CLAUDE.md`. Claude Code's auto memory is
   a second, unreviewed store, so the recommended setup turns it off and brain-import-memory moves
   what it holds into the vault (D24;
   [workflow.md, Where knowledge belongs](../workflow.md#where-knowledge-belongs)).
6. **Small fixed cost per session.** The core rules are capped at 8192 bytes and the skill
   descriptions at 12000 characters in total, because both load into every session.
7. **No runtime.** Anything that would need a process, a schedule or the network is either left to
   Claude Code itself (routines, the marketplace) or not built. Vault upkeep is not scheduled: a
   startup hook reminds you when it is due, and you run it (D22).

## Scope

In scope for the first release:

| Component | Count | Source |
|---|---|---|
| Brain skills | 8 | `plugin/skills/brain-*` |
| Engineering skills | 15 | `plugin/skills/` |
| Session skills | 2 (session-retro, skill-usage) | `plugin/skills/` |
| Conventions skills | 7 (`*-conventions`) | `plugin/skills/` |
| Agents | 10 | `plugin/agents/` |
| Output styles | 4 | `plugin/output-styles/` |
| Hooks | 5 (three on `SessionStart`, one on `Stop`, one on `PreToolUse` for Bash) | `plugin/hooks/hooks.json` |
| Core rules | 1 file | `plugin/rules/core.md` |
| Vault template | 1 | `plugin/vault-template/` |
| Project template | 1 | `templates/project/` (in the repository, not in the installed plugin) |
| Eval cases | one directory per case | `evals/` (in the repository, not in the installed plugin) |

The README lists every component by name ([What's inside](../../README.md#whats-inside)); the
[functional specification](functional-spec.md) gives each one's contract.

Out of scope, on purpose:

- A CLI, installer, updater, daemon, index or search engine ([decisions D1](decisions.md#d1-plugin-only)).
- Any automatic write to the vault outside `_inbox/`, and any automatic promotion of a note.
- Sending anything: no email, chat, issue or PR comment is posted by a skill on its own.
  `client-reply` drafts; `session-retro` prints a `gh issue create` command for the user to run.
- Codex or any agent other than Claude Code (removed 2026-10-24, [decisions D21](decisions.md#d21-claude-code-only)).
- Running evals in CI.

## How it is distributed

- Install: `/plugin marketplace add msolecki/developer-os`, then
  `/plugin install developer-os@developer-os`. The marketplace (`.claude-plugin/marketplace.json`)
  points at `./plugin`.
- The marketplace serves the repository's default branch, `main`, which moves only on a release.
- License: MIT. No paid tier, no telemetry.

## Status

Release 0.3.0; installs follow `main`, which moves only on a release. See [CHANGELOG.md](../../CHANGELOG.md) for what each
release changed.

## Primary risks

| Risk | Effect | Mitigation today |
|---|---|---|
| Rules and descriptions grow until they crowd the context | Every session pays for them | Byte and character caps in `scripts/check.sh` |
| A skill's description does not match how the user asks | The skill never fires | Trigger phrases in descriptions, `trigger-*` evals, the `skill-usage` report |
| An update changes the hooks, which run in every session | Unreviewed code runs in the user's shell | Hooks are short Python 3 scripts, standard library only, with tests; `SECURITY.md` asks users to review each update's diff |
| An unreviewed agent note is treated as fact | Wrong knowledge spreads | `status: inbox` until approved; brain-search marks inbox claims as unreviewed |
| Vault content reaches the model provider | Client context leaves the disk | Redaction in brain-capture; privacy rules in [workflow.md](../workflow.md#privacy) |
