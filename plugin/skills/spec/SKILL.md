---
name: spec
description: Interview the user, inspect the repository, write a feature specification and implementation plan, then hand implementation to a fresh session. Use when the user asks to define or plan a feature before implementation or invokes the spec workflow, for example "plan a new feature with me", "write a spec", "spec this feature".
license: MIT
compatibility: "Claude Code"
argument-hint: "[feature description]"
---

# Spec

1. Interview the user one question at a time about behavior, UX, edge cases, constraints, and trade-offs, starting from the feature description when one was given. Do not ask what the repository already answers.
2. Inspect relevant code before locking decisions.
3. Write the specification to the repository's documented specification location as `<YYYY-MM-DD-feature>-spec.md`; if none is documented, propose `docs/specs/` and confirm. Never write it into the planning location: a spec there is read as the active plan. Cover goals, non-goals, flows, technical design, decisions with rejected alternatives (one line each), contracts, failure handling, acceptance criteria, tests, and unresolved decisions.
4. Write the implementation plan to the repository's documented plan location as `<YYYY-MM-DD-feature>.md`. Start it with the goal, the decisions, and a `Status: in progress | done` line; write every step as a `- [ ]` checkbox with What, Where, How, Test, `Done when` (its acceptance criterion), complexity (S/M/L), and a deployable invariant; end with `## Open questions` and a `Next action:` line. plan-status and session-retro read these.
5. Offer to add the plan's steps to the project backlog: find or create its files and write each step as an item in the `developer-os:audit-to-backlog` format, with the `FEAT-` prefix and the next free `FEAT` number; complexity becomes `Size`, the step's `Done when` stays `Done when`, its Test becomes a runnable `Check` (`Manual: …` when no command can check it), `Where` is the step's Where, `Problem` and `Fix` are one line each (what is missing, what the step builds), and `Evidence` is the spec path and section (`docs/specs/<file>#<section>`), since new work has no `file:line` yet. Add a `Session N: <ID>, …` line for them under `## Implementation sessions`, so `implement-backlog` can execute them. Then replace each step in the plan with a plain line linking its ID (`- FEAT-03: <title>`, no checkbox), so the work is counted once, in the backlog.
6. Stop and hand implementation to a fresh session using the plan path.

## Stop point

Stop after the specification and plan are written and the backlog offer is answered. Return both paths and the handoff prompt for a fresh session.

## Never

- Implement any part of the feature.
- Overwrite an existing plan or specification.
- Add items to the backlog without the user's yes.
