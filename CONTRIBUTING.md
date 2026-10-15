# Contributing

The plugin is Markdown and JSON plus two POSIX `sh` hook scripts. There is no build step and no runtime.

## Check

Run before every commit:

```sh
scripts/check.sh
```

It parses every JSON file and every YAML frontmatter and `.base` file, requires `status`, `owner` and
`last-verified` frontmatter in every `docs/*.md`, validates skills (name
matches the folder, description 80–1024 characters and at most 12000 in total, no local paths such
as `/Users/`, `## Stop point` and `## Never` in action skills), caps `plugin/rules/core.md` at 8192
bytes, runs every `tests/*.test.sh`, validates the plugin and the marketplace, and scans tracked
files for secrets. CI runs the same script.

Hook tests live in `tests/*.test.sh` and run with `sh`; after changing a hook script, run its test
directly from the repository root, for example `sh tests/guard.test.sh` or
`sh tests/capture-nudge.test.sh`.

Prerequisites on `PATH`:

- `claude` (Claude Code)
- `jq`
- `gitleaks`
- `rsync`
- `ruby` (for its bundled YAML parser)

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
