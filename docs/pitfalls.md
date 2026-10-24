---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-16
---

# Pitfalls

Deliberate settings in this repository that look like defects. Changing one breaks the plugin or a
promise it makes.

## Hooks fail open

- **Where:** `plugin/hooks/guard.py`, `plugin/hooks/capture-nudge.py`, `plugin/hooks/state-card.py`
- **Looks like:** a guard that silently lets through anything it cannot parse.
- **Why it is deliberate:** the hooks run in every session of every user; a parse bug must never
  block work. The guard is a reminder, not a security boundary ([decisions D6](product/decisions.md#d6-hooks-ask-never-deny-and-fail-open)).
- **Breaks if changed:** a malformed hook input or an unexpected exception blocks every Bash call.

## The guard strips quotes before matching

- **Where:** `plugin/hooks/guard.py`, the `view` step
- **Looks like:** a false positive when a commit message mentions `pnpm add`.
- **Why it is deliberate:** without it, `sh -c "pnpm add zod"` would pass. An extra prompt costs one
  click; a missed install rewrites the lockfile.
- **Breaks if changed:** installs wrapped in `sh -c` or `bash -lc` slip through.

## `core.md` is at its size cap

- **Where:** `plugin/rules/core.md` (just under its 8192-byte cap, enforced by `scripts/check.sh`)
- **Looks like:** an arbitrary limit blocking a useful rule.
- **Why it is deliberate:** the file loads into every session; the cap keeps the fixed cost bounded
  and, with the state card, under the 10,000-character hook output limit.
- **Breaks if changed:** raising the cap without a matching cut grows every session's context.

## Templates and evals are outside `plugin/`

- **Where:** `templates/project/`, `evals/`
- **Looks like:** files missing from the installed plugin; docs-sync says it scaffolds "from this
  list" instead of copying files.
- **Why it is deliberate:** the marketplace installs only `plugin/`; evals must not ship, and
  `claude plugin eval` needs `--eval-dir` inside its target, which is the repository root.
- **Breaks if changed:** moving evals into `plugin/` ships them to every user.

## Output styles need the plugin prefix

- **Where:** Claude Code settings, `outputStyle`
- **Looks like:** `"outputStyle": "architect"` should work.
- **Why it is deliberate:** plugin styles are namespaced; the bare name silently falls back to the
  default style.
- **Breaks if changed:** nothing in this repository; documentation that drops the prefix misleads.

## brain-setup resolves the template path itself

- **Where:** `plugin/skills/brain-setup/SKILL.md`, the "Template" paragraph
- **Looks like:** a needless fallback to `../../vault-template`.
- **Why it is deliberate:** `${CLAUDE_PLUGIN_ROOT}` may be substituted in the skill text, but it is
  not set in the Bash environment, so commands must use an absolute path.
- **Breaks if changed:** `cp -R "$CLAUDE_PLUGIN_ROOT/vault-template/."` copies from `/vault-template`.

## Eval fixtures switch off the global excludes file

- **Where:** `evals/fixtures/backlog.sh`
- **Looks like:** an unneeded `core.excludesFile /dev/null`.
- **Why it is deliberate:** a host's global excludes may ignore `TODO.md`; the backlog would then never
  be committed and the case would test nothing.
- **Breaks if changed:** backlog evals pass or fail depending on the machine.

## The root `.gitignore` negates `templates/project/TODO.md`

- **Where:** `.gitignore` (`!/templates/project/TODO.md`)
- **Looks like:** a redundant line; nothing in the repository ignores `TODO.md`.
- **Why it is deliberate:** a global excludes file (for example `~/.gitignore_global` with `TODO.md`)
  also hid `templates/project/TODO.md`, so the template file was referenced by the docs but never
  committed. The negation overrides the global pattern for this one path.
- **Breaks if changed:** on a machine with that global pattern, a change to the template `TODO.md`
  is silently left out of commits.

## Evals are not in CI

- **Where:** `.github/workflows/check.yml`, `evals/README.md`
- **Looks like:** missing test coverage in CI.
- **Why it is deliberate:** every case runs two agent sessions (with and without the plugin) per run, all on real plan usage
  ([decisions D13](product/decisions.md#d13-evals-run-by-hand-never-in-ci)).
- **Breaks if changed:** every push spends plan usage and CI needs credentials.

## skill-usage reads transcripts; session-retro must not

- **Where:** `plugin/skills/skill-usage/SKILL.md`, `plugin/skills/session-retro/SKILL.md`
- **Looks like:** a contradiction between two skills.
- **Why it is deliberate:** skill-usage is invoked by the user, counts one fixed pattern with
  `--no-filename`, and prints no content. session-retro runs on a hook nudge and works from the
  conversation in context.
- **Breaks if changed:** session-retro reading transcripts would pull other projects' content into
  the session unasked.
