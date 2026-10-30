# developer-os

<a href="https://www.producthunt.com/products/developer-os-2?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-developer-os-2" target="_blank" rel="noopener noreferrer"><img alt="Developer OS - Long-term memory and engineering rules for Claude Code | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1286380&amp;theme=light&amp;t=1792582595920"></a>


A Claude Code plugin for working with an AI coding agent and an Obsidian vault as its long-term
memory. Agent sessions forget everything between runs; developer-os gives the agent skills to search
your vault before it starts, capture decisions into an inbox while it works, and help you review and
tidy what was captured. You approve what becomes knowledge. The plugin is Markdown (skills,
agents, output styles and rules) plus three small Python 3 hook scripts (standard library only), with no server, no database and
nothing to install beyond `python3`.

## Install (Claude Code)

```
/plugin marketplace add msolecki/developer-os
/plugin install developer-os@developer-os
```

The marketplace serves `main`, which moves only on a release; `claude plugin update
developer-os@developer-os` installs the next one. Releases are listed in [CHANGELOG.md](CHANGELOG.md).
Auto-update is off for this marketplace unless you turn it on under `/plugin` → Marketplaces. To hold
one release, add the marketplace at its tag: `/plugin marketplace add msolecki/developer-os#v0.2.6`.

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
may read and write it from any project. It also asks, separately, whether to set
`"autoMemoryEnabled": false`: recommended, because Claude Code's auto memory is a second, unreviewed
store per project that drifts from the vault. If you already have auto memory, run the
`brain-import-memory` skill in each project to move it into the vault; the memory files are not
touched. The full recommended configuration is in
[docs/workflow.md](docs/workflow.md#recommended-configuration). Then open the vault folder in Obsidian ("Open folder as
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

The plugin has 5 hooks. On every `SessionStart` (startup, resume, `/clear`, compaction and fork), in
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

On a new session (`startup`), [`plugin/hooks/notices.py`](plugin/hooks/notices.py) shows you up to
three one-line notices: after an install or update, the version and a link to the
[changelog](https://msolecki.github.io/developer-os/docs/changelog.html); when inbox notes are older
than 7 days, a brain-review reminder (at most weekly); when brain-garden has not run for 30 days, a
garden reminder (at most monthly). Vault upkeep never runs on its own: the hook only reminds. It reads
the vault path from your user-level `CLAUDE.md` only and prints counts, never note names. Set
`DEVELOPER_OS_NOTICES=off` to turn it off.

A `Stop` hook ([`plugin/hooks/capture-nudge.py`](plugin/hooks/capture-nudge.py)) counts tool calls
in the session transcript and reads only background-task and Monitor ids, output-file paths and
Monitor start times from it, never message content. Once per session, after 30 tool calls, and not
while a background agent, command or Monitor it can see is still running, it asks the agent to run the session-retro skill, which proposes a wrap-up and applies only what you
approve. Set `DEVELOPER_OS_CAPTURE_NUDGE=off` to turn it off, or `DEVELOPER_OS_CAPTURE_NUDGE_MIN=<n>`
to change the threshold.

A `PreToolUse` hook on Bash, Edit and Write ([`plugin/hooks/guard.py`](plugin/hooks/guard.py)) asks for confirmation
(it never blocks) before a dependency install, update or removal with a package argument
(`npm|pnpm|yarn|bun install|add|i|update|remove <pkg>`, an alias such as `npm in`, `npm un` or `bun a`,
`update --latest`, or the binary by full path), a `git push` with `--force`, `-f`, a `+refspec` or
`-c remote.<name>.push=+…` (even next to `--force-with-lease`; a lone `--force-with-lease` passes; git
also by full path), and a hook bypass: `--no-verify` or a prefix of it such as `--no-veri`,
`git commit -n`, `HUSKY=0`, `LEFTHOOK=0`, `SKIP=<hook>` or `core.hooksPath` in any form, and a command
that destroys uncommitted or untracked work: `rm` with both a recursive and a force flag (`rm -rf`),
`git reset --hard`, `git clean -f`, `git checkout`/`git restore` of `.`, `:/` or `*`, `git checkout -f`,
`git switch --discard-changes` or `find … -delete` (`git restore --staged .` and `git clean -n` pass). An Edit or Write asks when its file is a `.env` or `.env.*` (not
`.example`, `.sample`, `.template`, `.dist`), is under `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.claude/hooks` or
`~/.claude/rules`, or is `~/.claude/settings.json` or `settings.local.json`. Inside the five read-only review agents, a Bash
call that writes (`sed -i`, `tee`, `rm`, `mv`, `cp`, a redirect into a file, a git command that changes the
tree or history) asks too. A `git commit` that asks for nothing gets a one-line reminder, as context for
the agent, to run the fast check first. `$IFS`
(also with an empty `$9` glued on), `${X:-word}` and `$'\x66'` escapes are expanded before the scan. In `claude -p` an ask resolves to a denial.

The four scripts are Python 3 (3.8+, standard library only), make no network calls and fail open: on input they cannot parse
or any error they exit silently and the normal permission flow applies. They need `python3` on `PATH`;
without it the core rules still load and the other hooks do not run.

## What's inside

- **Brain skills:** brain-setup, brain-search, brain-capture, brain-review, brain-garden,
  brain-compile, brain-project-refresh (bring the repository's project hub note up to date),
  brain-import-memory (move a project's Claude Code auto memory into the vault, item by item). They read and write the vault with the agent's own file tools.
- **Engineering skills:** code-review, spec, audit-to-backlog, implement-backlog, fix-pr, pr-cycle,
  bug-triage, deploy-checklist, instruction-review (add `--prune` for a periodic cut), plan-status,
  client-reply, docs-sync, project-baseline, project-init (adopt developer-os in a repository in one
  pass), parallel-lanes (independent tasks as headless lanes, one worktree each, integrated locally).
- **Session skills:** session-retro (end-of-session wrap-up: state check, cleanup proposals,
  Done / Not done / Needs you, plan update or close, approval-gated capture) and skill-usage
  (read-only report of how often each developer-os skill fired locally, with
  keep/merge/rewrite-description/remove suggestions).
- **Conventions skills** (load only when relevant): comments-conventions,
  error-handling-conventions, defensive-coding-conventions, monitoring-conventions,
  nextjs-conventions, testing-conventions, typescript-conventions.
- **Built-in overlaps:** `/code-review`, `/security-review`, `/recap`, `/insights`, `/goal`,
  `/skill-doctor`, `/doctor` and `/init` cover similar ground; [when to use which](docs/workflow.md#built-in-commands-with-similar-names).
- **Agents:** code-reviewer, database-reviewer, dependency-upgrader, docs-writer, infra-reviewer,
  performance-engineer, qa-expert, research-analyst, security-auditor, verifier.
- **Output styles:** architect, debug, direct-objective, tdd-enforcer. Select one with
  `/output-style`, or set `"outputStyle": "developer-os:architect"` in settings (the plugin prefix is required).
- **Five hooks on three events:** `SessionStart` loads `plugin/rules/core.md` (plus a state card after compaction, resume or fork, and version and vault-upkeep notices on a new session), `Stop` suggests a session wrap-up
  once per long session, `PreToolUse` asks before installs, force pushes, hook bypasses and destructive commands (see above).
- **Evals:** behavior checks for the brain skills, code-review, session-retro and the skill
  triggers in [`evals/`](evals/README.md), run by hand with `claude plugin eval`. Not part of the
  plugin payload.

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
