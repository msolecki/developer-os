---
name: audit-to-backlog
description: Orchestrate parallel specialist analysis of a repository, require file-and-line evidence, deduplicate findings, and produce an implementation-ready TODO.md. Use when the user invokes audit-to-backlog or asks for a broad codebase audit that should produce a task backlog.
argument-hint: "[path | --diff <ref>] [--perspectives sec,types,perf,ui,a11y,tests,arch]"
---

# Analyze a codebase

## Establish scope

- Resolve the requested path, diff reference, and perspectives.
- Detect the stack, the lockfile-selected package manager, and the actual validation commands.
- Read `TODO.md` and `TODO-done.md` if they exist; never duplicate or resurrect findings.
- Before creating `TODO.md`, `TODO-done.md`, or `feature_list.json` in the user's repository, ask the user whether to create them there or at another path they choose. Use the chosen paths everywhere below.
- Prefer project-specific reviewer agents when the repository defines any.

## Delegate independent perspectives

Run relevant reviewers in parallel: security, types/errors, performance, tests, architecture/dead code, and UI/accessibility. Give each reviewer only the objective, paths, constraints, stack, and output format. Ask each for material findings only, ordered by impact.

Require each finding to include a unique category ID, `file:line`, severity, problem, current-code evidence, actionable fix, and validation. Reject unsupported claims.

For dead code, require zero references, invariant flags, old unreferenced code, or long commented blocks; classify removal confidence.

## Merge the backlog

- Write or merge into `TODO.md` with P0–P3 sections followed by an implementation-sessions section.
- Deduplicate by file and root cause; keep the higher severity.
- Continue existing category numbering.
- Map critical/security → P0, high → P1, medium → P2, low → P3.
- Group 5–7 related tasks per implementation session without mixing P0 and P3.
- Report only measured metrics.
- For multi-session work, create `feature_list.json`: a JSON array with one object per task (its ID, a short description, and `"passes": false`). Implementation may change only `passes`, and only after end-to-end verification.

Validate that every item is evidence-backed, actionable, unique, and absent from `TODO-done.md`. Report priority counts and the three highest-impact findings.
