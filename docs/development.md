---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-16
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
| Frontmatter | Frontmatter in `plugin/`, `templates/`, `evals/` or `docs/` Markdown does not parse; a `docs/*.md` lacks `status` (`current`, `draft`, `deprecated`), `owner` or a `last-verified` date; a skill, agent or output style lacks `name`/`description` or its `name` differs from the folder or file name; a line inside the frontmatter of an `evals/` file contains `---` (the eval loader ends frontmatter there) |
| Skill fields | A skill lacks `license` or `compatibility`, or its name does not match `^[a-z0-9-]{1,64}$` |
| Skill descriptions | A description is outside 80–1024 characters, or all together exceed 12000 |
| Skill sections | An action skill lacks `## Stop point` or `## Never` (exempt: `brain-search`, `code-review`, `plan-status`, `skill-usage`, `*-conventions`) |
| Vault paragraph | The first paragraph under `## 1. Locate the vault` in `brain-capture`, `brain-compile`, `brain-garden` or `brain-review` differs from `brain-search`'s |
| Local paths | A file under `plugin/` or `site/` contains `/Users/`, `/home/`, `~/www` or `.claude2` |
| YAML | A `*.base` or `evals/*.yaml` file does not parse |
| Hook targets | A `${CLAUDE_PLUGIN_ROOT}/…` path in `hooks.json` does not exist |
| Agents | An agent lacks `## Final status` or one of `DONE`, `REVIEW`, `BLOCKED`, `CONTINUING` |
| Surface | `plugin/SURFACE.txt` differs from the skills, agents, output styles, hook events and hook scripts on disk |
| Stale names | A skill, agent or output-style name removed from `plugin/SURFACE.txt` in the uncommitted diff still appears as a bare word (the prefixed form fails in References) in `plugin/`, `templates/` or `README.md`; the check runs before the rename is committed |
| Counts | A count written as digits in the README, `docs/`, `evals/README.md`, the `[Unreleased]` section of `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` or a page under `site/` ("N skills", "N eval cases"; not "N cases of") differs from the disk |
| Core-rules size | `plugin/rules/core.md` exceeds 8192 bytes, or the state-card cap in `session-start.sh` no longer fits under the 10,000-character hook output limit |
| References | A `developer-os:<name>` string in `plugin/` (Markdown and hook scripts), `docs/`, `templates/`, `evals/`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` or `SECURITY.md` names no skill, agent or output style |
| Links | A relative Markdown link outside fenced or inline code does not resolve from its own file, or its `#fragment` matches no GitHub heading slug in the target Markdown file (letters of any script, link text only, `-1`, `-2` for repeated headings) |
| Site | A doc, root document, skill, agent or output style has no page under `site/` that names it in a `dos-source` meta; a page's hash differs from its source's; a relative `href` or `src` in `site/`, or a page in `NAV` in `site/assets/site.js`, does not resolve or names no `id` in the target page. It reports every failure at once |
| Script tests | Any `tests/*.test.sh` exits non-zero; `tests/check.test.sh` runs only when `CI` is set |
| Plugin validation | `claude plugin validate . --strict` or `claude plugin validate plugin --strict` fails on an error or on any warning (such as an unknown manifest key) other than a missing plugin `version`; the `Found N warnings` count must match the tolerated lines |
| Secrets | `gitleaks dir` finds a secret in tracked or untracked-not-ignored files |

The file set is tracked plus untracked-not-ignored files, so a new doc is checked before it is
committed.

## CI

`.github/workflows/check.yml` runs `scripts/check.sh` on pushes to `development` and `main` and on
every pull request. Before the check it runs agnix (`agent-sh/agnix` v0.57.0, the release binary pinned by its
SHA-256, `--strict`, target `claude-code`), a static lint of skills, hooks and manifests configured in
`.agnix.toml`; every rule disabled there carries its reason. It pins `actions/checkout` to a commit SHA, does not persist credentials, has
read-only `contents` permission, installs `@anthropic-ai/claude-code@2.1.300` (with `--ignore-scripts`, then only its own `install.cjs`, which links the native binary, then `claude --version`) and a gitleaks
release verified by SHA-256, and, on a pull request, `gitleaks git` over the PR's commits, so a secret added and
removed inside one PR still fails. The same step fails a PR that changes `.gitleaks.toml` or
`.gitleaksignore` or adds a `gitleaks:allow` marker; the workflow file itself comes from the PR, so
only a branch ruleset that requires review of `.github/` stops a PR that edits the step away.

## The site

`site/` is the public documentation site, hand-written HTML with no build:

- `index.html`, the landing page;
- `docs/`, one page per `docs/*.md` at the same path, plus `readme.html`, `changelog.html`,
  `contributing.html` and `security.html` for the root documents;
- `skills/`, an index and one page per skill; `agents.html` and `output-styles.html`;
- `assets/site.css` and `assets/site.js` (the sidebar order in `NAV`, on-page contents, copy buttons).

Each page that restates a source carries `<meta name="dos-source" content="<source>@<hash>">`: the
first 12 hex digits of the source's SHA-256 with any `last-verified:` line removed, so re-verifying a
doc changes nothing. After you change a doc, a root document, a skill, an agent or an output style,
the Site stage names the page to refresh: update its text, then its hash
(`sed '/^last-verified: /d' <source> | shasum -a 256 | cut -c1-12`). A new doc or skill needs a new
page, and a new doc an entry in `NAV`. The landing page and the skills index restate many sources
and carry no hash; update them by hand when the hooks, rules or skills they describe change.
`CURRENT-STATE.md` and `CHANGELOG.md` change on most pull requests, so their pages usually do too.

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on a push to `development` that
changes it, or by hand. The repository's Pages source must be "GitHub Actions".

## Script tests

`tests/session-start.test.sh` runs the SessionStart hook in a temporary git repository and checks
that the rules come first, the card appears only after `compact`/`resume`, and the card is cut to its
cap; `tests/guard.test.sh` feeds command fixtures to `guard.sh` and expects `ask` or silence;
`tests/capture-nudge.test.sh` builds synthetic transcripts and checks the exit code and message;
`tests/check.test.sh` breaks a copy of the repository once per stage it covers and expects that
stage's message; it runs the whole check about twenty times (around 40 s), so `scripts/check.sh` runs it
only when `CI` is set (GitHub Actions sets it): after changing `scripts/check.sh`, run `sh tests/check.test.sh` yourself;
`tests/install-codex.test.sh` runs the Codex installer against a temporary `HOME` (dry run,
idempotent second run, kept user text, unbalanced markers, foreign skills, uninstall, the Codex
budget of 8000 characters, counted in bytes); `tests/skill-usage.test.sh` runs the counting block from the skill-usage skill against synthetic
transcripts (a model call, the same call repeated with its uuid, a typed command, a quoted pattern)
and expects one count per message; it prints SKIP when `rg` is missing.
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
4. Reference other parts as `developer-os:<name>`; the check resolves them. A bare name in `plugin/` is
   checked only during a rename: the Stale names stage fails, before the rename is committed, on any
   name removed from `SURFACE.txt`.
5. A brain skill starts with the shared vault lookup: the check compares the first paragraph under
   `## 1. Locate the vault` across the five brain skills that have it, so change all five together.
6. Add an eval case when the skill has a behavior worth protecting (a gate, a refusal, a trigger).
7. Add the name to `plugin/SURFACE.txt` (the check prints the line), and update the README component list,
   `CHANGELOG.md`, and [product/functional-spec.md](product/functional-spec.md). Counts written as digits are
   checked; fix any the check reports.

Changing `plugin/rules/core.md`: it sits just under the 8192-byte cap (`wc -c < plugin/rules/core.md`).
Every added line must replace or shorten another; run `instruction-review --prune` on it inside this repository.

## Codex installer

`scripts/install-codex.sh` is not part of the plugin; users run it from a clone. After changing a skill
in a way that adds a Claude-only reference (a new `${CLAUDE_*}` variable, a new agent dispatch), check
that the rewrite in the script still covers it: `sh tests/install-codex.test.sh` greps the copies.
A skill `description` must be one plain line: no `>` or `|` block scalar, no quotes, no continuation
line; the script refuses any other form.

## Branches and releases

- `development` is the default branch and what the marketplace installs. Work lands there through
  pull requests; the repository disallows merge commits.
- `main` is not kept in step with `development` and is not a release channel today.
- `plugin/.claude-plugin/plugin.json` carries no `version` (decided 2026-10-15): an install tracks the
  latest `development` commit. A user pins a version by marketplace ref or tag:
  `/plugin marketplace add msolecki/developer-os#<ref>`.
- `CHANGELOG.md` follows Keep a Changelog; no release tag exists yet. There is no release automation,
  and the release procedure (tags, changelog date) is an open decision; see
  [CURRENT-STATE.md](CURRENT-STATE.md).

## Plans

`docs/plans/` is git-ignored. Plans for this repository live there while a task runs and are deleted
when it is done, per the core rules.
