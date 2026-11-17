---
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Bash, Agent]
---

Have the developer-os:database-reviewer agent review migrations/0002_add_users_locale.sql together with the code that uses the users table (src/users.js), then report its answer to me: every finding with its severity and file:line.
