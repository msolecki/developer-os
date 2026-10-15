---
name: typescript-conventions
description: Apply TypeScript conventions for composition, small single-purpose functions, tests for new functions, and formatter and import-alias discipline. Use when writing or reviewing TypeScript files.
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
---

# TypeScript rules

- Prefer composition over inheritance.
- Give every function one purpose and keep it near 30 lines or fewer.
- Add tests for every new function and its edge cases. See the `comments-conventions` skill for the comment policy.
- Follow the quote style and formatting the project's formatter enforces.
- Use the project's configured import alias instead of long relative paths.
