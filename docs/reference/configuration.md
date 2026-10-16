---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-16
---

# Configuration reference

The plugin has no configuration file of its own. It is configured through lines and keys in files
the user already has, which the skills read. This page lists every one of them.

## User level

| Setting | Where | Read by | Written by |
|---|---|---|---|
| `Brain vault: <absolute path>` | `~/.claude/CLAUDE.md` (or a project's `CLAUDE.md`/`AGENTS.md`; `~/.codex/AGENTS.md` for Codex) | All brain skills; the core rule that runs brain-search before large tasks | brain-setup, after approval (Claude Code only; for Codex it prints the line) |
| Vault in `permissions.additionalDirectories` | `~/.claude/settings.json` | Claude Code, so the vault can be read from any project | brain-setup, after approval |
| `"outputStyle": "developer-os:<name>"` | Claude Code settings | Claude Code; a bare name silently falls back to the default style | The user |
| Rule overrides | `~/.claude/CLAUDE.md` | The model, alongside the core rules | The user |
| `DEVELOPER_OS_CAPTURE_NUDGE`, `DEVELOPER_OS_CAPTURE_NUDGE_MIN` | Shell environment | The `Stop` hook ([hooks.md](hooks.md#environment-variables)) | The user |
| `CODEX_SKILLS_DIR` | Shell environment | `scripts/install-codex.sh` (default `~/.agents/skills`) | The user |
| `CODEX_HOME` | Shell environment | `scripts/install-codex.sh`, which writes `$CODEX_HOME/AGENTS.md` (default `~/.codex`) | The user |

brain-setup, the brain skills' vault lookup and `scripts/install-codex.sh` resolve the config directory
as `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`; brain-setup edits files in place, so symlinked config files
stay symlinks.

## Project level

| Setting | Where | Read by | Default without it |
|---|---|---|---|
| `Backlog: <todo path>, <done path>` | Project `AGENTS.md` or `CLAUDE.md` | audit-to-backlog, implement-backlog, plan-status, project-baseline, spec, session-retro, the `SessionStart` hook (skips them as plans) | `TODO.md`, `TODO-done.md`; audit-to-backlog and project-baseline ask before creating them and write the line |
| Planning location | Project `AGENTS.md` or `CLAUDE.md` | Core rules, plan-status, spec, session-retro | `docs/plans/<YYYY-MM-DD-task>.md`, git-ignored |
| Specification location | Project `AGENTS.md` or `CLAUDE.md` | spec | spec proposes `docs/specs/` and asks |
| Fast check and full suite commands | Project `AGENTS.md` or `CLAUDE.md` | Core rules, pr-cycle, fix-pr, implement-backlog, deploy-checklist | Derived from the package manifest, README, CONTRIBUTING or Makefile; otherwise the agent asks before committing |
| `Vault project slug:` | `_Context.md` | brain-search and brain-capture, which read `_Context.md` at the repository root when the line is not in context | Empty `project:` |
| Docs root | `AGENTS.md` | docs-sync | `docs/` |
| Task state | `docs/plans/.devos-state.md` (fixed, even when the planning location is overridden) | The `SessionStart` hook after compaction | Written by implement-backlog, pr-cycle and audit-to-backlog; none |
| `TODO.md` item format | The backlog todo file | audit-to-backlog, project-baseline, implement-backlog, plan-status | `templates/project/TODO.md` shows it |
| `DESIGN.md` | Repository root, for projects with a UI | Agents doing UI work (the template `AGENTS.md` line), project-baseline, docs-sync | project-baseline proposes it as a backlog item |

## Vault

| Item | Meaning |
|---|---|
| `_inbox/` | The only folder agents create notes in |
| `_archive/` | Retired notes, `status: archived` |
| `_views/*.base` | Obsidian Bases views: Inbox, Stale (active, `updated` older than 180 days), By project |
| `_reports/garden-log.md` | One line per brain-garden run, appended with consent |
| `templates/note.md` | The note template (`status: active` for notes the user writes) |
| `.obsidian/types.json` | Property types: `created`, `updated` as date, `tags` as tags, `sources` as multitext |

Note frontmatter, folders and the four body headings: [workflow.md, Vault layout](../workflow.md#vault-layout).

## Codex

No manifest. `scripts/install-codex.sh` (run by hand, `--dry-run` first) writes a Codex copy of each skill
to `${CODEX_SKILLS_DIR:-~/.agents/skills}` with a `.developer-os-codex` marker, and puts the core rules and
the `Brain vault:` line between `developer-os-core` markers in `${CODEX_HOME:-~/.codex}/AGENTS.md`
([README](../../README.md#codex-installer-best-effort)).
