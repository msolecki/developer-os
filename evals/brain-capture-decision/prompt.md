---
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Bash, Write, Skill]
---

Capture this decision in the brain: in sample-shop every service reads feature flags through one `flags.ts` module that validates them at startup, because scattered `process.env` lookups caused two production misconfigurations last month. It applies to every service we build.
