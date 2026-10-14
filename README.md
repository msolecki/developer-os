# developer-os

A Claude Code plugin for working with an AI coding agent and an Obsidian vault as its long-term
memory. Agent sessions forget everything between runs; developer-os gives the agent skills to search
your vault before it starts, capture decisions into an inbox while it works, and help you review and
tidy what was captured. You approve what becomes knowledge. The plugin is Markdown only: skills,
agents, output styles and rules, with no server, no database and no runtime to install. Codex
support is manual and best-effort.

## Install (Claude Code)

```
/plugin marketplace add msolecki/developer-os
/plugin install developer-os@developer-os
```

## Set up the vault

Copy [`vault-template/`](vault-template/) as your Obsidian vault (or merge it into an existing one) and
follow [`vault-template/README.md`](vault-template/README.md). The key step is one line in
`~/.claude/CLAUDE.md`:

```
Brain vault: /absolute/path/to/your/vault
```

and the vault path in `permissions.additionalDirectories` in `~/.claude/settings.json`, so Claude Code
may read and write it from any project.

For project repositories, start from the files in [`templates/project/`](templates/project/).

## What the SessionStart hook does

The plugin has one hook. On every `SessionStart` (startup, resume, `/clear` and compaction), in every
project, it runs `cat` on [`plugin/rules/core.md`](plugin/rules/core.md) and the output becomes
session context. That file (~8 KB) holds the core working rules, so installing the plugin changes how
the agent behaves everywhere, not only when you call a skill. Among other things, the agent will:

- ask before running a dependency install, and never delete or skip tests to make a build pass;
- run the repository's declared validation before it commits, and refuse to commit when none exists;
- write a plan before changes larger than about 50 lines, and keep it in the repository;
- change authentication or middleware only when you ask for it explicitly;
- search the vault with brain-search before a large task;
- back claims such as "fixed" with evidence, and have a fresh subagent review agent-written code;
- answer directly, in your language, and write repository content in English.

Read the file for the full list. To turn it off, disable the plugin (`/plugin`, then disable
developer-os). To keep the plugin but change a rule, override it explicitly in your user-level
`~/.claude/CLAUDE.md` (for example, "Ignore the developer-os rule on plan files; I do not keep
plans"); that file loads alongside the core rules in every session.

## What's inside

- **Brain skills:** brain-search, brain-capture, brain-review, brain-garden, brain-compile. They read
  and write the vault with the agent's own file tools.
- **Engineering skills:** code-review, spec, audit-to-backlog, implement-backlog, fix-pr,
  bug-triage, deploy-checklist, instruction-review.
- **Conventions skills** (load only when relevant): comments-conventions,
  error-handling-conventions, defensive-coding-conventions, monitoring-conventions,
  nextjs-conventions, testing-conventions, typescript-conventions.
- **Agents:** code-reviewer, performance-engineer, qa-expert, research-analyst, security-auditor.
- **Output styles:** architect, debug, direct-objective, tdd-enforcer.
- **One `SessionStart` hook** that loads `plugin/rules/core.md` (see above).

## Codex (manual, best-effort)

There is no Codex manifest. The skills need only file read, write and search tools, so you can use
them by hand:

1. Symlink or copy each directory in `plugin/skills/` into `~/.codex/skills/`.
2. Paste the content of `plugin/rules/core.md` into `~/.codex/AGENTS.md`.
3. Add the `Brain vault: /absolute/path/to/your/vault` line to `~/.codex/AGENTS.md`.

This setup is not tested on releases.

## Documentation

- [How to work: brain + code](docs/workflow.md): the workflow, the vault layout, privacy.
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
