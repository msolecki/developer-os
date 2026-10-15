---
name: code-review
description: Review a pull request, diff, commit, or working-tree change against the project's conventions and rate findings P0–P3 with a merge verdict, handing code written in this session to an independent reviewer agent. Use when the user asks to review code, a PR, a diff, the last commit, or their changes, for example "review the last commit", "review my changes", "zrób review ostatniego commita", "przejrzyj moje zmiany", "zrób code review PR-a". Prefer it over the built-in /code-review when the project's conventions, the P0–P3 scale and an independent reviewer matter.
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
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

## Verify blocking findings

Before the output, send every P0 and P1 finding, including those relayed from `developer-os:code-reviewer`, to a fresh verifier that did not produce it, one finding per verifier, in parallel when there are several.

- Verifier: Codex when the Codex plugin (`openai/codex-plugin-cc`) is installed, otherwise a fresh `general-purpose` subagent. Codex is optional; never install it or fail without it.
- Give the verifier only the claim (`file:line` and the wrong behavior in one sentence, without its cause), the diff or PR reference, and the repository path. Leave out the reviewer's evidence and reasoning.
- Prompt: "Try to disprove this finding by reading the code. Reply CONFIRMED or REFUTED, with the `file:line` evidence for your answer."
- Keep CONFIRMED findings at their severity. Move REFUTED findings to a Disputed list with the verifier's evidence. When the verifier cannot decide, keep the finding and say it is unverified.

## Output

Start with the verdict: `REQUEST_CHANGES` when any P0 or P1 not moved to Disputed exists, `COMMENT` when an open question decides whether a finding is P0 or P1, otherwise `APPROVE`. Then list findings under P0, P1, P2, and P3 headings, `None` for an empty one, followed by a Disputed heading when any finding was refuted. Every finding has `file:line`, evidence, impact, and a concrete fix. End with open questions only when they materially affect the verdict.

Do not comment on formatting enforced automatically or propose unrelated refactors.
