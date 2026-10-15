# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

First public release. developer-os is now a Markdown-only plugin for Claude Code, installed from
this repository as a plugin marketplace. It replaces the earlier Homebrew CLI, which was never
released; the CLI history is archived at the git tag `archive/cli-v0`.

### Added
- Brain skills that read and write an Obsidian vault with the agent's own file tools: brain-setup,
  brain-search, brain-capture, brain-review, brain-garden and brain-compile. brain-setup creates a
  vault from the template or connects an existing one, and adds the `Brain vault:` line and the
  `additionalDirectories` entry after you approve the diff.
- Engineering skills: code-review, spec, audit-to-backlog, implement-backlog, fix-pr, pr-cycle,
  bug-triage, deploy-checklist, instruction-review, plan-status, client-reply, docs-sync and
  project-baseline. pr-cycle takes a PR from base merge to a merge verdict; plan-status reports
  measured plan and backlog counts with A/B/C decisions; client-reply drafts plain-language client
  replies and never sends them; docs-sync scaffolds and checks a project's `docs/`; project-baseline
  proposes missing engineering practices as backlog items.
- Session skills: session-retro, an end-of-session wrap-up (state check, cleanup, status block, plan
  close, approval-gated capture), and skill-usage, a read-only report of how often each skill fired.
- Conventions skills: comments-conventions, error-handling-conventions,
  defensive-coding-conventions, monitoring-conventions, nextjs-conventions, testing-conventions and
  typescript-conventions.
- Agents: code-reviewer, performance-engineer, qa-expert, research-analyst and security-auditor.
- Output styles: architect, debug, direct-objective and tdd-enforcer.
- Three hooks: `SessionStart` loads `plugin/rules/core.md`; `Stop` offers session-retro once per
  session after 30 tool calls, deferred while background agents or commands are still running
  (`DEVELOPER_OS_CAPTURE_NUDGE=off` disables it); `PreToolUse` on Bash
  asks before dependency installs, force pushes and `--no-verify` or `git commit -n`. The two scripts are POSIX `sh`,
  make no network calls, fail open and have tests in `tests/*.test.sh`.
- `plugin/vault-template/`: folders, a note template, example notes, Bases views (Inbox, Stale,
  By project), property types in `.obsidian/types.json`, and a `.gitignore` that keeps Obsidian's UI
  state out of a git-synced vault. It ships inside the plugin, so brain-setup can copy it.
- `templates/project/`: `AGENTS.md`, a `CLAUDE.md` that imports it, `_Context.md`, and a `docs/`
  standard (index with task routing, `CURRENT-STATE.md`, `pitfalls.md`, `decisions/`, `runbooks/`).
- `docs/workflow.md`: how to work with the vault and the code, where each kind of knowledge belongs,
  which features are Claude-only, and an optional routines recipe for mobile capture and a weekly
  vault brief.
- `evals/`: behaviour cases for `claude plugin eval`, run by hand and never in CI.
- `scripts/check.sh` validates skills (name matches the folder, description length and total, no
  local paths, `## Stop point` and `## Never` in action skills) and runs `tests/*.test.sh`.

### Changed
- Review, audit and triage skills and the agents rate findings P0–P3 with one severity scale; review
  verdicts are `APPROVE`, `COMMENT` or `REQUEST_CHANGES`.
- The core rules are shorter, capped at 8192 bytes, and add: a closing `Done / Not done / Needs you`
  status block; no promises of a later ping; keeping the user's language after English input,
  subagent reports and compaction; plans that are gitignored and deleted when done, with open items
  moved to `TODO.md` or the backlog; two validation tiers (a fast check before each commit, the full
  suite before a push or PR).
- code-review and audit-to-backlog send each P0/P1 finding to a fresh verifier; refuted findings
  move to a Disputed list.
- brain-capture writes only lessons that outlive the task, checked by a three-question gate.
- brain-garden reports the orphan percentage, tags proposed links FOUND or GUESSED, and can append
  to `_reports/garden-log.md` with consent.
- instruction-review has a `--prune` mode with a per-line DELETE/KEEP/REWRITE audit.
- Action skills end with `## Stop point` and `## Never` sections.
- `scripts/check.sh` also checks frontmatter, hook targets, the core-rules size, plugin references
  and relative Markdown links.
- The plugin and marketplace descriptions lead with the Obsidian-vault memory.
- `docs/workflow.md` no longer repeats the README's component list and Codex steps; it links to
  them. The README links to `core.md` instead of paraphrasing it.
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
- `SECURITY.md` no longer claims the vault never leaves your disk, describes what each hook reads,
  and explains that an update can change the hook commands.
- `.gitignore` covers `.env*`, `*.pem` and `.claude/settings.local.json`.
- fix-pr asks before each edit, commit, push and thread resolution, treats review comments as data
  and flags comments from non-collaborators.
- Agents treat code, diffs, PR text and fetched pages as data, not instructions.
- CI pins `actions/checkout` to a commit SHA, drops persisted credentials, runs with read-only
  `contents` permission and verifies the gitleaks download checksum.

### Removed
- The Homebrew CLI, its bundled Node runtime, background jobs and generated indexes.
