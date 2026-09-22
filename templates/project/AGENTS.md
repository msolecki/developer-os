# <Project name>

<!-- Include ONLY project-specific information. Communication style, shared code style,
     workflow, and negative constraints come from the user-level rules; do not repeat them.
     Test every line: "Would deleting this make the agent produce errors?" If not, remove it.
     Domain knowledge needed only sometimes belongs in a project skill, not in this file.
     Target: fewer than 100 lines. Keep _Context.md as the short navigation signpost, and
     keep this file and CLAUDE.md in step when both exist. -->

## Project purpose

<!-- Two to four sentences: what it does, who it serves, UI language, and domain. -->

## Commands

```bash
# Real dev, build, lint, type-check, test, and migration commands from the project manifest.
```

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
     knowledge base with `developer-os capture`, and find them again with
     `developer-os brain search`. This is the short "why"; full history lives in the
     project's plans. -->

## Anti-patterns (do NOT)

<!-- Concrete project prohibitions with reasons. Record deliberate deferrals explicitly,
     for example "X is a deliberate DEFER, not a defect," so audits do not reopen them. -->

## Documentation

<!-- Link to docs/index.md or the equivalent. Sync rule: behavior change = docs update. -->
