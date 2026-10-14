# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - Unreleased

First public release. developer-os is now a Markdown-only plugin for Claude Code, installed from
this repository as a plugin marketplace. It replaces the earlier Homebrew CLI, which was never
released; its history is archived at the git tag `archive/cli-v0`.

### Added
- Brain skills that read and write an Obsidian vault with the agent's own file tools: brain-search,
  brain-capture, brain-review, brain-garden and brain-compile.
- Engineering skills: code-review, spec, implementator, analizer, fix-pr, bug-triage,
  deploy-checklist and instruction-review.
- Agents for code review, security, performance, QA and research.
- A `SessionStart` hook that loads `plugin/rules/core.md`.
- `vault-template/`: folders, a note template, example notes and Bases views (Inbox, Stale,
  By project).
- `docs/workflow.md`: how to work with the vault and the code.
- Best-effort Codex manifest at `plugin/.codex-plugin/plugin.json`.

### Removed
- The Homebrew CLI, its bundled Node runtime, background jobs and generated indexes.
