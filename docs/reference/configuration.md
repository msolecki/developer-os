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
| `Brain vault: <absolute path>` | `~/.claude/CLAUDE.md` (or a project's `CLAUDE.md`/`AGENTS.md`) | All brain skills; the core rule that runs brain-search before large tasks; the notices hook, from the user-level file only | brain-setup, after approval |
| Vault in `permissions.additionalDirectories` | `~/.claude/settings.json` | Claude Code, so the vault can be read from any project | brain-setup, after approval |
| `"autoMemoryEnabled": false` (recommended, D24) | `~/.claude/settings.json`; `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the environment wins over it | Claude Code: no auto-memory files are created or loaded; existing ones stay on disk | brain-setup or brain-import-memory, after a separate yes; the `/memory` toggle writes the same key |
| Auto-memory folder | `~/.claude/projects/<project>/memory/`, or `autoMemoryDirectory` | brain-import-memory, which never edits or deletes it | Claude Code, while auto memory is on |
| `"outputStyle": "developer-os:<name>"` | Claude Code settings | Claude Code; a bare name silently falls back to the default style | The user |
| Rule overrides | `~/.claude/CLAUDE.md` | The model, alongside the core rules | The user |
| `DEVELOPER_OS_CAPTURE_NUDGE`, `DEVELOPER_OS_CAPTURE_NUDGE_MIN` | Shell environment | The `Stop` hook ([hooks.md](hooks.md#environment-variables)) | The user |
| `DEVELOPER_OS_NOTICES` | Shell environment | The `SessionStart` notices hook; `off` disables the version and upkeep notices ([hooks.md](hooks.md#sessionstart-on-startup--noticespy)) | The user |

brain-setup and the brain skills' vault lookup resolve the config directory
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
| `_reports/garden-log.md` | One line per brain-garden run, appended with consent; the notices hook reads its last line |
| `templates/note.md` | The note template (`status: active` for notes the user writes) |
| `.obsidian/types.json` | Property types: `created`, `updated` as date, `tags` as tags, `sources` as multitext |

Note frontmatter, folders and the four body headings: [workflow.md, Vault layout](../workflow.md#vault-layout).
