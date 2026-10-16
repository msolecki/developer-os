# developer-os

This repository is a Markdown-only Claude Code plugin: core rules, skills, agents and POSIX `sh` hooks under `plugin/`,
copyable project templates under `templates/`. No runtime and no build; see [README.md](README.md).
`CLAUDE.md` only imports this file, so this file is the authoritative source for every agent.

## Commands

- `bash scripts/check.sh`: the whole check, before every commit and in CI.
- `sh tests/check.test.sh`: after changing `scripts/check.sh` (the check runs it only in CI).
- `claude --plugin-dir plugin`: run the plugin from the working tree.

## Likely agent mistakes here

- Growing `plugin/rules/core.md` past 8192 bytes: it loads into every session. Evidence: D10, the Core-rules size stage. Current figures are in [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md).
- Lengthening skill descriptions past 12000 characters in total, or past the Codex budget of 8000 characters. Evidence: D10, D19, the Skill descriptions stage, `tests/install-codex.test.sh`.
- Making a hook deny instead of ask. Evidence: D6, `tests/guard.test.sh`.

## Invariants

- D2, hook scripts in POSIX `sh` without `jq` or network: Script tests stage.
- D6, hooks ask, never deny, and fail open: Script tests stage (`tests/guard.test.sh`).
- D9, action skills end with `## Stop point` and `## Never`: Skill sections stage.
- D10, the per-session budget: Core-rules size and Skill descriptions stages.
- D19, the Codex installer copies within its budget: Script tests stage (`tests/install-codex.test.sh`).

The records are in [docs/product/decisions.md](docs/product/decisions.md); the stages in [docs/development.md](docs/development.md#the-check).

Backlog: docs/plans/backlog.md, docs/plans/backlog-done.md

## Documentation

[docs/index.md](docs/index.md) routes a task to its doc; [docs/development.md](docs/development.md), [docs/product/decisions.md](docs/product/decisions.md), [CONTRIBUTING.md](CONTRIBUTING.md).
Behavior change = docs update in the same commit; the docs-sync skill reports drift.
