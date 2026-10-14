# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

First public release. developer-os is now a Markdown-only plugin for Claude Code, installed from
this repository as a plugin marketplace. It replaces the earlier Homebrew CLI, which was never
released; the CLI history is archived at the git tag `archive/cli-v0`.

### Added
- Brain skills that read and write an Obsidian vault with the agent's own file tools: brain-search,
  brain-capture, brain-review, brain-garden and brain-compile.
- Engineering skills: code-review, spec, audit-to-backlog, implement-backlog, fix-pr, bug-triage,
  deploy-checklist and instruction-review.
- Conventions skills: comments-conventions, error-handling-conventions,
  defensive-coding-conventions, monitoring-conventions, nextjs-conventions, testing-conventions and
  typescript-conventions.
- Agents: code-reviewer, performance-engineer, qa-expert, research-analyst and security-auditor.
- Output styles: architect, debug, direct-objective and tdd-enforcer.
- A `SessionStart` hook that loads `plugin/rules/core.md`.
- `vault-template/`: folders, a note template, example notes, Bases views (Inbox, Stale,
  By project) and property types in `.obsidian/types.json`.
- `templates/project/`: `AGENTS.md`, a `CLAUDE.md` that imports it, and `_Context.md`.
- `docs/workflow.md`: how to work with the vault and the code.

### Changed
- The plugin and marketplace descriptions lead with the Obsidian-vault memory.
- `docs/workflow.md` no longer repeats the README's component list and Codex steps; it links to
  them. The README links to `core.md` instead of paraphrasing it.
- Plans live in the repository's planning location; committing them is each project's choice.
- `templates/project/AGENTS.md` names the core rules as the source of shared rules and shows an
  optional `Backlog:` line.

### Fixed
- The docs say the agent creates notes only in `_inbox/` and edits or moves other notes only after
  approval; brain-garden reports inbox notes older than 7 days.
- The docs cover the compiled-note `sources:` list, the quoted `summary` and the template's default
  `status: active`.
- Codex setup uses `~/.agents/skills/` (older Codex versions read `~/.codex/skills/`).
- The README lists fork among the `SessionStart` triggers.

### Security
- `SECURITY.md` no longer claims the vault never leaves your disk, and explains that an update can
  change the `SessionStart` hook command.
- `.gitignore` covers `.env*`, `*.pem` and `.claude/settings.local.json`.

### Removed
- The Homebrew CLI, its bundled Node runtime, background jobs and generated indexes.
