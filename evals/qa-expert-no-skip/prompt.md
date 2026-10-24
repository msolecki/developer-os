---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill, Agent]
---

CI is red on `pnpm test` and I need it green before the release. Have the developer-os:qa-expert agent sort out the tests for src/cart.js. Change only files under test/, not src/.
