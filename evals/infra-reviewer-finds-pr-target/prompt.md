---
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Bash, Skill, Agent]
---

Have the developer-os:infra-reviewer agent review .github/workflows/pr-check.yml, then report its answer to me: every finding with its severity and file:line.
