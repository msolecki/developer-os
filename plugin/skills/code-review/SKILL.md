---
name: code-review
description: Review a pull request, diff, or working-tree change against the project's conventions and rate findings P0–P3 with a merge verdict, handing code written in this session to an independent reviewer agent. Use when the user asks to review code, a PR, a diff, or their changes with the developer-os review.
---

# Code review

## Choose the reviewer

- If you wrote the code under review in this session, dispatch `developer-os:code-reviewer` with the PR or diff reference, the changed files, and the request context, then relay its report. The reviewer must not be the author.
- Otherwise review inline as below. Both paths produce the same output.

## Establish context

- Read the request/PR description, diff, tests, and affected architecture.
- Flag changes to auth, middleware, migrations, tenant boundaries, or destructive data paths.
- Identify repository-specific instructions before applying generic preferences.

## Rate findings

- **P0:** exploitable security defect, data loss, or production down.
- **P1:** wrong behavior on a common path.
- **P2:** edge-case defect or meaningful maintainability risk.
- **P3:** minor or cleanup.

Check tenant scoping, soft-delete filters, query ownership, breaking API changes, missing tests for new behavior, incomplete error handling, Server Component defaults, loading/error states, accessibility, and project language requirements when relevant.

For tests, cover happy path, edge cases, and failure path; reject flaky or over-mocked assertions. A test pins the intended contract, not accidental current behavior.

## Output

Start with the verdict: `REQUEST_CHANGES` when any P0 or P1 exists, `COMMENT` when an open question blocks judgment, otherwise `APPROVE`. Then list findings under P0, P1, P2, and P3 headings, `None` for an empty one. Every finding has `file:line`, evidence, impact, and a concrete fix. End with open questions only when they materially affect the verdict.

Do not comment on formatting enforced automatically or propose unrelated refactors.
