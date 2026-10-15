# <Project name>

<!-- Include ONLY project-specific information. Communication style, shared code style,
     workflow, and negative constraints come from the developer-os core rules (plugin) or your
     global instructions (~/.claude/CLAUDE.md); do not repeat them.
     Test every line: "Would deleting this make the agent produce errors?" If not, remove it.
     Domain knowledge needed only sometimes belongs in a project skill, not in this file.
     Target: fewer than 100 lines. Keep _Context.md as the short navigation signpost.
     CLAUDE.md only imports this file (`@AGENTS.md`), so edit here. -->

Read `_Context.md` first: it says where to look and holds the project's vault slug.

<!-- Projects with a UI keep DESIGN.md next to this file; delete the line below otherwise. -->
UI work: read `DESIGN.md` first; take every value from its tokens.

<!-- Optional: where audit-to-backlog writes and implement-backlog reads the backlog.
     Without this line they use TODO.md and TODO-done.md; TODO.md in this template shows the item format.
     e.g. Backlog: docs/backlog/TODO.md, docs/backlog/TODO-done.md -->

## Project purpose

<!-- Two to four sentences: what it does, who it serves, UI language, and domain. -->

## Commands

```bash
# Real dev, build, lint, type-check, test, and migration commands from the project manifest.
```

## Likely agent mistakes here

<!-- At most three mistakes an agent has actually made in this repository, each with its
     evidence. The docs-sync skill proposes them from history. Delete an item once a check
     or a rule prevents it.
     - <mistake and the correct action> — evidence: commit <sha> or session <YYYY-MM-DD> -->

## Stack

<!-- Technologies with versions, non-negotiable choices, and rejected tools with reasons. -->

## Architecture

<!-- Only non-obvious directories, data flow, and key patterns with file:line references.
     Link to details under docs/ instead of duplicating them inline. -->

## Project-specific conventions

<!-- Naming, API patterns, and validation rules that DIFFER from the user-level rules.
     API projects should be concrete: pagination default and maximum, cursor or offset,
     the deprecation signal at sunset, the date format, and the error envelope. -->

## Dependency policy

<!-- Three to five lines: how fast critical and high security patches land, whether
     applications pin exact versions, where a new dependency's rationale is recorded,
     and which licenses need review before adding. -->

## Decisions (ADR-lite)

<!-- | date | decision | reason | — at most ten rows. Move older decisions to the
     vault with the brain-capture skill, and find them again with brain-search.
     This is the short "why"; full history lives in the project's plans. -->

## Anti-patterns (do NOT)

<!-- Concrete project prohibitions with reasons. Record deliberate deferrals explicitly,
     for example "X is a deliberate DEFER, not a defect," so audits do not reopen them. -->

## Invariants

<!-- Properties that must hold after every change (prices computed server-side, a
     platform-free core), each with the check or test that enforces it. -->

## Documentation

<!-- Docs map: docs/index.md routes a task to its doc; docs/CURRENT-STATE.md (verified at a
     commit), docs/pitfalls.md, docs/decisions/, docs/runbooks/. Sync rule: behavior change =
     docs update; the docs-sync skill reports drift. -->
