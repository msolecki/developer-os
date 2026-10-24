---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-24
---

# developer-os — documentation index

developer-os is a Markdown-only Claude Code plugin. These documents describe the plugin as it is in
this repository.

Each row routes a task to the one document to read first. Documents link to the source file that
owns a behavior (a `SKILL.md`, a hook script, `scripts/check.sh`) instead of restating it; when a
document and the source disagree, the source wins and the document is a defect.

| Task | Read first |
|---|---|
| Understand what developer-os is, for whom, and what it deliberately does not do | [product/overview.md](product/overview.md) |
| Know what each skill, agent, hook and output style does, and what it never does without approval | [product/functional-spec.md](product/functional-spec.md) |
| Know why something is the way it is | [product/decisions.md](product/decisions.md) |
| Understand how the plugin loads into a session and where data flows | [architecture/overview.md](architecture/overview.md) |
| Know what each skill checks and how, or where to start in a new repository | [reference/skills.md](reference/skills.md) |
| Look up a hook's input, output, exit code or environment variable | [reference/hooks.md](reference/hooks.md) |
| Look up a setting, a line the skills read, or a path they write | [reference/configuration.md](reference/configuration.md) |
| Install and use it day to day with an Obsidian vault | [workflow.md](workflow.md) (the README has the short install) |
| Change the plugin, run the checks, run the evals, release | [development.md](development.md) |
| A setting or pattern in this repository looks wrong | [pitfalls.md](pitfalls.md) |
| Decode a term such as "action skill", "fresh verifier" or "inbox note" | [glossary.md](glossary.md) |

Outside `docs/`: [README](../README.md) (install, component list),
[CONTRIBUTING](../CONTRIBUTING.md), [SECURITY](../SECURITY.md), [CHANGELOG](../CHANGELOG.md),
[evals/README.md](../evals/README.md).

## Document rules

- Technical documentation is in English. Every document under `docs/` starts with the frontmatter
  above: `status` (`current`, `draft` or `deprecated`), `owner`, and `last-verified`, the day it was
  checked against the code.
- Cite files and section headings, not line numbers; line numbers move with every edit.
- Plans live in `docs/plans/`, which is git-ignored, and are deleted when the task is done.
- `scripts/check.sh` enforces this frontmatter, and checks every relative link in these files and every `developer-os:<name>`
  reference, so a renamed skill or moved file fails the check.
