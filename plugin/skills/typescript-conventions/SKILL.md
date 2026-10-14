---
name: typescript-conventions
description: "TypeScript conventions: strict mode, composition, small single-purpose functions, tests for new functions, formatter and import-alias discipline. Use when writing or reviewing TypeScript files."
---
# TypeScript rules

- Always use TypeScript strict mode.
- Prefer composition over inheritance.
- Give every function one purpose and keep it near 30 lines or fewer.
- Add tests for every new function and its edge cases. See the `comments-conventions` skill for the comment policy.
- Use English in code unless the project says otherwise. Follow the product's explicit language requirement for UI copy.
- Follow the quote style and formatting the project's formatter enforces.
- Use the project's configured import alias instead of long relative paths.
