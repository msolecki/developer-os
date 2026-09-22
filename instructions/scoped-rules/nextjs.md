---
paths:
  - "**/*.tsx"
  - "**/app/**"
  - "**/src/app/**"
---
# Shared Next.js and web conventions

- Validate EVERY input from forms and APIs with a schema validator (for example Zod with `.safeParse()`).
- Default to Server Components. Use `'use client'` only for state or event handling.
- Prefer Server Actions over API routes when possible. Return `{ ok: true, data? } | { ok: false, error }`.
- Database migrations are forward-only; never depend on rollback migrations.
- Never call the analytics SDK's capture function directly. Use a `track*` wrapper, behind a consent gate where the platform requires consent.
