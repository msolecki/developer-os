# developer-os

A Claude Code plugin for working with an AI coding agent and an Obsidian vault as its long-term
memory. Agent sessions forget everything between runs; developer-os gives the agent skills to search
your vault before it starts, capture decisions into an inbox while it works, and help you review and
tidy what was captured. You approve what becomes knowledge. The plugin is Markdown (skills,
agents, output styles and rules) plus three small Python 3 hook scripts (standard library only), with no server, no database and
nothing to install beyond `python3`. Codex
support is manual and best-effort.

## Install (Claude Code)

```
/plugin marketplace add msolecki/developer-os
/plugin install developer-os@developer-os
```

The marketplace serves `main`, which moves only on a release; `claude plugin update
developer-os@developer-os` installs the next one. Releases are listed in [CHANGELOG.md](CHANGELOG.md).
Auto-update is off for this marketplace unless you turn it on under `/plugin` → Marketplaces. To hold
one release, add the marketplace at its tag: `/plugin marketplace add msolecki/developer-os#v0.2.4`.

## Requirements

- Claude Code on macOS or Linux, with Python 3.8+ on `PATH` for the hooks.
- ripgrep (`rg`): the brain skills search the vault with it.
- `jq`: brain-setup edits `settings.json` with it; without it, it shows the key to add by hand.
- GitHub CLI (`gh`): for fix-pr, pr-cycle and the open-PR check in session-retro.
- Obsidian 1.9.10 or later for the vault's Bases views. The vault itself is plain Markdown, and the
  engineering skills work without one.

## Set up the vault

Run the `brain-setup` skill in Claude Code: it copies [`plugin/vault-template/`](plugin/vault-template/)
(or connects an existing vault), shows the two config edits as a diff and applies them after you
approve. The two edits are one line in `~/.claude/CLAUDE.md`:

```
Brain vault: /absolute/path/to/your/vault
```

and the vault path in `permissions.additionalDirectories` in `~/.claude/settings.json`, so Claude Code
may read and write it from any project. Then open the vault folder in Obsidian ("Open folder as
vault") and enable the **Bases** and **Templates** core plugins, with `templates` as the Templates
folder.

For project repositories, start from the files in [`templates/project/`](templates/project/). The
marketplace install keeps a copy on disk; `-n` skips files the project already has, so merge those
by hand:

```sh
cp -Rn ~/.claude/plugins/marketplaces/developer-os/templates/project/. /path/to/project/
```

They include a `docs/` skeleton; run the docs-sync skill to fill and check it. The
full setup, with Obsidian settings and a first test, is in [docs/workflow.md](docs/workflow.md#setup-in-5-minutes).

## What the hooks do

The plugin has 4 hooks. On every `SessionStart` (startup, resume, `/clear`, compaction and fork), in
every project, it prints [`plugin/rules/core.md`](plugin/rules/core.md) with `cat`; the output becomes
session context. After a compaction, a resume or a fork inside a git repository, a second `SessionStart` hook,
[`plugin/hooks/state-card.py`](plugin/hooks/state-card.py), adds a state card of at most 1 KB: the branch, a
`Newest plan:` line, `docs/plans/.devos-state.md` (the task state that implement-backlog, pr-cycle
and audit-to-backlog keep there; hidden once it is older than 7 days), then up to 10 worktrees. A
longer card is cut at a whole line and ends with a cut marker. Installing the plugin therefore changes how the agent behaves everywhere, not only
when you call a skill; read [`core.md`](plugin/rules/core.md) for the rules themselves.

To turn it off, disable the plugin (`/plugin`, then disable developer-os). To keep the plugin but
change a rule, override it explicitly in your user-level `~/.claude/CLAUDE.md` (for example, "Ignore
the developer-os rule on plan files"); that file loads alongside the core rules in every session.

A `Stop` hook ([`plugin/hooks/capture-nudge.py`](plugin/hooks/capture-nudge.py)) counts tool calls
in the session transcript and reads only background-task and Monitor ids, output-file paths and
Monitor start times from it, never message content. Once per session, after 30 tool calls, and not
while a background agent, command or Monitor it can see is still running, it asks the agent to run the session-retro skill, which proposes a wrap-up and applies only what you
approve. Set `DEVELOPER_OS_CAPTURE_NUDGE=off` to turn it off, or `DEVELOPER_OS_CAPTURE_NUDGE_MIN=<n>`
to change the threshold.

A `PreToolUse` hook on Bash ([`plugin/hooks/guard.py`](plugin/hooks/guard.py)) asks for confirmation
(it never blocks) before a dependency install, update or removal with a package argument
(`npm|pnpm|yarn|bun install|add|i|update|remove <pkg>`, an alias such as `npm in`, `npm un` or `bun a`,
`update --latest`, or the binary by full path), a `git push` with `--force`, `-f`, a `+refspec` or
`-c remote.<name>.push=+…` (even next to `--force-with-lease`; a lone `--force-with-lease` passes; git
also by full path), and a hook bypass: `--no-verify` or a prefix of it such as `--no-veri`,
`git commit -n`, `HUSKY=0`, `LEFTHOOK=0`, `SKIP=<hook>` or `core.hooksPath` in any form. `$IFS`,
`${X:-word}` and `$'\x66'` escapes are expanded before the scan. In `claude -p` an ask resolves to a denial.

The three scripts are Python 3 (3.8+, standard library only), make no network calls and fail open: on input they cannot parse
or any error they exit silently and the normal permission flow applies. They need `python3` on `PATH`;
without it the core rules still load and the other hooks do not run.

## What's inside

- **Brain skills:** brain-setup, brain-search, brain-capture, brain-review, brain-garden,
  brain-compile. They read and write the vault with the agent's own file tools.
- **Engineering skills:** code-review, spec, audit-to-backlog, implement-backlog, fix-pr, pr-cycle,
  bug-triage, deploy-checklist, instruction-review (add `--prune` for a periodic cut), plan-status,
  client-reply, docs-sync, project-baseline.
- **Session skills:** session-retro (end-of-session wrap-up: state check, cleanup proposals,
  Done / Not done / Needs you, plan update or close, approval-gated capture) and skill-usage
  (read-only report of how often each developer-os skill fired locally, with
  keep/merge/rewrite-description/remove suggestions).
- **Conventions skills** (load only when relevant): comments-conventions,
  error-handling-conventions, defensive-coding-conventions, monitoring-conventions,
  nextjs-conventions, testing-conventions, typescript-conventions.
- **Built-in overlaps:** `/code-review`, `/security-review`, `/recap`, `/insights`, `/goal`,
  `/skill-doctor` and `/doctor` cover similar ground; [when to use which](docs/workflow.md#built-in-commands-with-similar-names).
- **Agents:** code-reviewer, performance-engineer, qa-expert, research-analyst, security-auditor, verifier.
- **Output styles:** architect, debug, direct-objective, tdd-enforcer. Select one with
  `/output-style`, or set `"outputStyle": "developer-os:architect"` in settings (the plugin prefix is required).
- **Four hooks on three events:** `SessionStart` loads `plugin/rules/core.md` (plus a state card after compaction, resume or fork), `Stop` suggests a session wrap-up
  once per long session, `PreToolUse` asks before installs, force pushes and hook bypasses (see above).
- **Evals:** behavior checks for the brain skills, code-review, session-retro and the skill
  triggers in [`evals/`](evals/README.md), run by hand with `claude plugin eval`. Not part of the
  plugin payload.

## Codex (installer, best-effort)

There is no Codex manifest. From a clone of this repository (or the marketplace copy in
`~/.claude/plugins/marketplaces/developer-os`), run:

```sh
scripts/install-codex.sh --dry-run   # show what would change
scripts/install-codex.sh             # install or update
```

- It writes a Codex copy of every skill to `~/.agents/skills/<name>` (set `CODEX_SKILLS_DIR` for
  another location, such as `~/.codex/skills/` on older Codex versions). Each copy keeps only `name`
  and a short description (the first sentence and the quoted trigger phrases, or the "Use when"
  sentence when there are none), so all of them fit Codex's 8000-character skill list, and has its
  Claude-only references rewritten. A skill `description` must be one plain line; the installer
  refuses any other form before it writes anything.
- It puts `plugin/rules/core.md` and your `Brain vault:` line (`--vault <path>`, else the line already in the
  block, else `~/.claude/CLAUDE.md`; pass `--vault` again to change it) between `developer-os-core` markers in `~/.codex/AGENTS.md` (`$CODEX_HOME/AGENTS.md`
  when `CODEX_HOME` is set; `--project <dir>` for a project's `AGENTS.md`). Text outside the markers
  stays; a changed file is backed up first.
- Run it again after each plugin update. An untouched copy of a skill the plugin no longer has, made from this checkout, is removed. `--uninstall` removes only what it installed;
  `--project <dir> --uninstall` removes only that project's block and keeps the skills. A skill
  directory it did not create, including an older hand-made symlink into another clone, is skipped
  and reported; remove it first to let the installer manage it.

This setup is not tested on releases. The hooks, agents and output styles have no Codex equivalent;
see [Claude-only features](docs/workflow.md#claude-only-features).

## Documentation

- [Landing page](https://msolecki.github.io/developer-os/): the public documentation site ([source](site/index.html)), published to GitHub Pages by `.github/workflows/pages.yml`.
- [Documentation index](docs/index.md): product overview, functional specification, decisions,
  architecture, hooks and configuration reference, development guide, pitfalls, glossary.
- [How to work: brain + code](docs/workflow.md): the workflow, the vault layout, privacy.
- [Away from the desk](docs/workflow.md#away-from-the-desk-optional): capture from your phone and a
  weekly vault brief with Claude Code routines.
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
