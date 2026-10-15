---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Development guide

How to change the plugin, check it and ship it. The rules for contributions are in
[CONTRIBUTING.md](../CONTRIBUTING.md); this page explains the mechanics behind them.

## Setup

Prerequisites on `PATH`: `claude` (Claude Code), `jq`, `gitleaks`, `rsync`, `ruby` (for its YAML
parser), `rg` for the skills' own commands. No install step and no build.

Run the plugin from the working tree without installing it:

```sh
claude --plugin-dir plugin
```

Test a brain skill against a scratch vault, never a real one: `cp -R plugin/vault-template "$(mktemp -d)/vault"`
and point a `Brain vault:` line in that directory's `CLAUDE.md` at it.

## The check

`scripts/check.sh` runs before every commit and in CI. It fails on the first error. Stages, in order:

| Stage | Fails when |
|---|---|
| JSON | Any `*.json` does not parse (`jq empty`) |
| Frontmatter | Frontmatter in `plugin/`, `templates/`, `evals/` or `docs/` Markdown does not parse; a `docs/*.md` lacks `status` (`current`, `draft`, `deprecated`), `owner` or a `last-verified` date; a skill, agent or output style lacks `name`/`description` or its `name` differs from the folder or file name |
| Skill fields | A skill lacks `license` or `compatibility`, or its name does not match `^[a-z0-9-]{1,64}$` |
| Skill descriptions | A description is outside 80–1024 characters, or all together exceed 12000 |
| Skill sections | An action skill lacks `## Stop point` or `## Never` (exempt: `brain-search`, `code-review`, `plan-status`, `skill-usage`, `*-conventions`) |
| Local paths | A file under `plugin/skills/` contains `/Users/`, `/home/`, `~/www` or `.claude2` |
| YAML | A `*.base` or `evals/*.yaml` file does not parse |
| Hook targets | A `${CLAUDE_PLUGIN_ROOT}/…` path in `hooks.json` does not exist |
| Surface | `plugin/SURFACE.txt` differs from the skills, agents, output styles, hook events and hook scripts on disk |
| Counts | A count written as digits in the README, `docs/` or `evals/README.md` ("N skills", "N eval cases") differs from the disk |
| Core-rules size | `plugin/rules/core.md` exceeds 8192 bytes |
| References | A `developer-os:<name>` string in `plugin/`, `docs/`, `templates/` or `README.md` names no skill, agent or output style |
| Links | A relative Markdown link outside `plugin/skills/` (and outside fenced or inline code) does not resolve |
| Hook tests | Any `tests/*.test.sh` exits non-zero |
| Plugin validation | `claude plugin validate .` or `claude plugin validate plugin` fails |
| Secrets | `gitleaks dir` finds a secret in tracked or untracked-not-ignored files |

The file set is tracked plus untracked-not-ignored files, so a new doc is checked before it is
committed.

## CI

`.github/workflows/check.yml` runs `scripts/check.sh` on pushes to `development` and `main` and on
every pull request. Before the check it runs agnix (`agent-sh/agnix`, pinned to the v0.57.0 commit,
`--strict`, target `claude-code`), a static lint of skills, hooks and manifests configured in
`.agnix.toml`; every rule disabled there carries its reason. It pins `actions/checkout` to a commit SHA, does not persist credentials, has
read-only `contents` permission, installs `@anthropic-ai/claude-code@2.1.300` and a gitleaks
release verified by SHA-256.

## Hook tests

`tests/guard.test.sh` feeds command fixtures to `guard.sh` and expects `ask` or silence;
`tests/capture-nudge.test.sh` builds synthetic transcripts and checks the exit code and message.
After changing a hook, run its test from the repository root, for example `sh tests/guard.test.sh`,
and add a fixture for the case you changed.

## Evals

Behavior checks with `claude plugin eval`, run by hand before a release or after changing a tested
skill, never in CI: [evals/README.md](../evals/README.md). A case must fail when the skill breaks;
the README lists the mutation checks that prove it.

## Adding or changing a skill

1. `plugin/skills/<name>/SKILL.md` with `name: <name>` and a `description` that says what it does
   and when to use it, including the Polish phrases the user would type. Keep within the
   description budget; `scripts/check.sh` prints the total when it fails.
2. If it can write, send or change git state, end with `## Stop point` and `## Never`. If it is
   read-only and should be exempt, add it to `read_only` in `scripts/check.sh`.
3. Use synthetic examples only; no local paths, client names or real vault notes.
4. Reference other parts as `developer-os:<name>`; the check resolves them.
5. A brain skill copies the shared "Locate the vault" paragraph verbatim.
6. Add an eval case when the skill has a behavior worth protecting (a gate, a refusal, a trigger).
7. Add the name to `plugin/SURFACE.txt` (the check prints the line), and update the README component list,
   `CHANGELOG.md`, and [product/functional-spec.md](product/functional-spec.md). Counts written as digits are
   checked; fix any the check reports.

Changing `plugin/rules/core.md`: it has 44 bytes of headroom under the cap. Every added line must
replace or shorten another; run `instruction-review --prune` on it inside this repository.

## Branches and releases

- `development` is the default branch and what the marketplace installs. Work lands there through
  pull requests; the repository disallows merge commits.
- `main` is not kept in step with `development` and is not a release channel today.
- `plugin/.claude-plugin/plugin.json` carries the version (0.1.0). `CHANGELOG.md` follows Keep a
  Changelog; 0.1.0 is still "Unreleased" and no release tag exists yet.
- There is no release automation. A release procedure (tag, version bump, changelog date, what users
  pin) is an open decision; see [CURRENT-STATE.md](CURRENT-STATE.md).

## Plans

`docs/plans/` is git-ignored. Plans for this repository live there while a task runs and are deleted
when it is done, per the core rules.
