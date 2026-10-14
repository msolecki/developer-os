# developer-os

A Claude Code plugin for working with an AI coding agent and an Obsidian vault as its long-term
memory. Agent sessions forget everything between runs; developer-os gives the agent skills to search
your vault before it starts, capture decisions into an inbox while it works, and help you review and
tidy what was captured. You approve what becomes knowledge. The plugin is Markdown only: skills,
agents and rules, with no server, no database and no runtime to install. Codex support is best-effort.

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

## Codex (best-effort)

The repository ships `plugin/.codex-plugin/plugin.json`, which points at the same skills. Codex
loading is not tested on every release. For manual use, add the `Brain vault:` line to
`~/.codex/AGENTS.md` and see [docs/workflow.md](docs/workflow.md).

## What's inside

- **Brain skills:** brain-search, brain-capture, brain-review, brain-garden, brain-compile. They read
  and write the vault with the agent's own file tools.
- **Engineering skills:** code-review, spec, implementator, analizer, fix-pr, bug-triage,
  deploy-checklist, instruction-review.
- **Agents:** independent reviewers for code, security, performance, QA and research.
- **One `SessionStart` hook** that loads the core working rules from `plugin/rules/core.md`.

## Documentation

- [How to work: brain + code](docs/workflow.md): the workflow, the vault layout, privacy.
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
