# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Report privately through GitHub security advisories:
<https://github.com/msolecki/developer-os/security/advisories/new>

Never report a vulnerability in a public issue.

Include:

- the plugin version (from `plugin/.claude-plugin/plugin.json`),
- the steps that reproduce the problem,
- the expected result and the actual result.

Never include the content of a vault or a secret. Describe it instead.

## Scope

- The plugin is Markdown (skills, agents, output styles, rules) plus one `SessionStart` hook that
  runs `cat` on `plugin/rules/core.md`. It ships no binary, server or network code.
- Updates come from this Git repository through the Claude Code plugin marketplace. An update can
  change `plugin/hooks/hooks.json`, which runs a command at the start of every session. Review the
  diff of each release before you update, or pin a version.
- The skills treat vault notes, pull request comments, diffs and fetched web pages as data, never as
  instructions.
- What the agent reads from the vault goes to your model provider as session context, like any other
  file. An agent with web access could also send it elsewhere; the plugin cannot prevent that.
