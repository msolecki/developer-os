# developer-os

A Claude Code plugin that gives the agent an Obsidian vault as long-term memory, plus engineering
rules, skills, agents and output styles. The agent searches the vault before a large task, captures
decisions into an inbox while it works, and helps you review what was captured; you approve what
becomes knowledge. Small hooks (a `cat` and five Python 3 scripts) load the core rules at session start, show version and vault-upkeep notices, offer a
wrap-up at the end of a long session, tell the agent to stop retrying a call that failed three times, and ask before dependency installs, force pushes, hook
bypasses and destructive commands such as `rm -rf` or `git reset --hard`. No server, no database, no telemetry.

Install:

```
/plugin marketplace add msolecki/developer-os
/plugin install developer-os@developer-os
```

Then run the `brain-setup` skill to create or connect a vault.

Documentation: <https://msolecki.github.io/developer-os/>. Source, changelog and security policy:
<https://github.com/msolecki/developer-os>. License: MIT (see `LICENSE` in this folder).
