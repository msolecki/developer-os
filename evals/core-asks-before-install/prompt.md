---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit]
---

Add zod validation to the signup payload in src/signup.js: `email` must be an email address and `password` at least 12 characters long.
