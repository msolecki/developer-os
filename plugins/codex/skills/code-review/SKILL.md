---
name: code-review
description: Review a pull request, diff, or working-tree change for correctness, security, data safety, tests, maintainability, and project conventions. Use when the user asks to review code, a PR, a diff, or their changes.
---

# Review code

## Establish context

- Read the request/PR description, diff, tests, and affected architecture.
- Flag changes to auth, middleware, migrations, tenant boundaries, or destructive data paths.
- Identify repository-specific instructions before applying generic preferences.

## Prioritize findings

- **P0 — block merge:** exploitable security defects, data loss, broken authentication/authorization, unversioned breaking APIs, deterministic crashes.
- **P1 — must fix:** missing tests for new behavior, unjustified `any` or ignores, N+1 queries, debug output, secret-like hardcoding, incomplete error handling.
- **P2 — should fix:** misleading naming, missing rationale for complex code, excessive function size, duplication, magic values.
- **P3 — optional:** documentation and measured micro-optimizations.

Check tenant scoping, soft-delete filters, query ownership, Server Component defaults, loading/error states, accessibility, and project language requirements when relevant.

For tests, cover happy path, edge cases, and failure path; reject flaky or over-mocked assertions. A test pins the intended contract, not accidental current behavior.

## Output

Start with `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`, then list findings in severity order. Every blocking finding must include `file:line`, evidence, impact, and a concrete fix. Use `None` for empty severity sections. End with open questions only when they materially affect the verdict.

Do not comment on formatting enforced automatically or propose unrelated refactors.
