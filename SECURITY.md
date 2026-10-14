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
- Updates come from this Git repository through the Claude Code plugin marketplace.
- The brain skills treat vault content as data, never as instructions.
- The vault never leaves your disk, except as session context that your agent sends to your model
  provider, like any other file it reads.
