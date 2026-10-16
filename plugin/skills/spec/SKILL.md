---
name: spec
description: Interview the user, inspect the repository, write a feature specification and implementation plan, then hand implementation to a fresh session. Use when the user asks to define or plan a feature before implementation or invokes the spec workflow, for example "plan a new feature with me", "write a spec", "spec this feature".
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
argument-hint: "[feature description]"
---

# Spec

1. Interview the user one question at a time about behavior, UX, edge cases, constraints, and trade-offs, starting from the feature description when one was given. Do not ask what the repository already answers.
2. Inspect relevant code before locking decisions.
3. Write the specification to the repository's documented specification location as `<YYYY-MM-DD-feature>-spec.md`; if none is documented, propose `docs/specs/` and confirm. Never write it into the planning location: a spec there is read as the active plan. Cover goals, non-goals, flows, technical design, decisions with rejected alternatives (one line each), contracts, failure handling, acceptance criteria, tests, and unresolved decisions.
4. Write the implementation plan to the repository's documented plan location as `<YYYY-MM-DD-feature>.md`. Start it with the goal, the decisions, and a `Status: in progress | done` line; write every step as a `- [ ]` checkbox with What, Where, How, Test, complexity (S/M/L), and a deployable invariant; end with `## Open questions` and a `Next action:` line. plan-status and session-retro read these.
5. Offer to add the plan's steps to the project backlog: find or create its files and write each step as an item, both exactly as `developer-os:audit-to-backlog` does (next free category ID; complexity becomes `Size`; the step's acceptance criterion `Done when`; its Test a runnable `Check`), so `implement-backlog` can execute them.
6. Stop and hand implementation to a fresh session using the plan path.

## Stop point

Stop after the specification and plan are written and the backlog offer is answered. Return both paths and the handoff prompt for a fresh session.

## Never

- Implement any part of the feature.
- Overwrite an existing plan or specification.
- Add items to the backlog without the user's yes.
