# Contributing

The plugin is Markdown and JSON plus five Python 3 hook scripts (standard library only). There is no build step and no runtime.

## Check

Run before every commit:

```sh
scripts/check.sh
```

It is a bash script: run it directly or with `bash`, not `sh`.

It parses every JSON file, every `.base` and `evals/*.yaml` file and the frontmatter of Markdown in `plugin/`, `templates/`, `evals/` and `docs/`, checks the eval cases, requires `status`, `owner` and
`last-verified` frontmatter in every `docs/*.md`, validates skills (name
matches the folder, description 80–1024 characters and at most 12000 in total, `## Stop point` and
`## Never` in action skills), rejects local paths such as `/Users/` anywhere in `plugin/` and `site/`, caps
`plugin/rules/core.md` at 8900 bytes, runs every `tests/*.test.sh` (`tests/check.test.sh` only when `CI` is set), validates the plugin and the
marketplace with `--strict`, and scans tracked and untracked, not ignored files for secrets. The full
list of stages is in [docs/development.md](docs/development.md#the-check). CI runs the same script.

Hook tests live in `tests/*.test.sh` and run with `sh` (they call `python3`); after changing a hook script, run its test
directly from the repository root, for example `sh tests/guard.test.sh`,
`sh tests/capture-nudge.test.sh`, `sh tests/notices.test.sh`, `sh tests/repeat-failure.test.sh` or `sh tests/state-card.test.sh`.

Prerequisites on `PATH`:

- `claude` (Claude Code)
- `python3` (3.8+)
- `jq`
- `gitleaks`
- `rsync`
- `ruby` (for its bundled YAML parser)
- `perl` and `shasum` (for `tests/check.test.sh`)
- `rg` (for `tests/skill-usage.test.sh`; it skips locally without it and fails in CI)

## Skill evals

`evals/` holds behavior checks for the skills, run with `claude plugin eval`; see
[evals/README.md](evals/README.md) for the command and the cases. Each run spends real plan usage:
run it by hand before a release or after changing a tested skill, never in CI.

## Rules

- Use synthetic examples only. Never commit a real vault note, a client name or a credential.
- A skill does one job, says when to use it in its `description`, and fits on one screen where possible.
- Every skill ends with `## Stop point` (where it stops, what it returns) and `## Never` (forbidden
  side effects), except the read-only ones in the `read_only` list in `scripts/check.sh` and the
  `*-conventions` skills; `scripts/check.sh` fails otherwise.
- This repository keeps its plans local: `docs/plans/` is gitignored.
- Test a changed skill by running it: `claude --plugin-dir plugin`, then invoke it on a scratch vault.
