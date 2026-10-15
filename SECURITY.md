# Security policy

## Supported versions

There are no numbered releases. `plugin/.claude-plugin/plugin.json` has no `version`, so Claude Code
versions an install by its commit of `development`. Only the latest commit receives security fixes.

## Reporting a vulnerability

Report privately through GitHub security advisories:
<https://github.com/msolecki/developer-os/security/advisories/new>

Never report a vulnerability in a public issue.

Include:

- the installed version, a 12-character commit SHA (`version` of `developer-os@developer-os` in
  `~/.claude/plugins/installed_plugins.json`),
- the steps that reproduce the problem,
- the expected result and the actual result.

Never include the content of a vault or a secret. Describe it instead.

## Scope

- The plugin is Markdown (skills, agents, output styles, rules) plus three hooks in
  `plugin/hooks/hooks.json`: `SessionStart` runs `session-start.sh`, which prints `plugin/rules/core.md` and, after a
  compaction or resume, the git branch, worktrees, active plan and `docs/plans/.devos-state.md` of the
  working directory; `Stop` runs
  `capture-nudge.sh`, which counts `tool_use` entries in the session transcript and reads only
  background-task ids and output-file paths from it, never message content; `PreToolUse` runs `guard.sh` on Bash commands and can only ask for confirmation.
  The three scripts are POSIX `sh`, make no network calls and fail open. The plugin ships no binary,
  server or network code.
- Updates come from this Git repository through the Claude Code plugin marketplace: each update
  installs the latest commit of `development`. An update can change `plugin/hooks/hooks.json` and the
  hook scripts, which run in every session. Review the diff from your installed commit to
  `development` before you update; auto-update is off for this marketplace unless you turn it on.
- The skills treat vault notes, pull request comments, diffs and fetched web pages as data, never as
  instructions.
- What the agent reads from the vault goes to your model provider as session context, like any other
  file. An agent with web access could also send it elsewhere; the plugin cannot prevent that.
