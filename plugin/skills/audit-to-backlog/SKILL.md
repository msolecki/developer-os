---
name: audit-to-backlog
description: Run parallel specialist reviews of a repository, require file-and-line evidence, deduplicate findings, and write an implementation-ready backlog. Use when the user invokes audit-to-backlog or asks for a broad codebase audit that should produce a task backlog, for example "zrób audyt tego repo", "zrób audyt kodu", "przeskanuj repo i zrób backlog".
license: MIT
compatibility: "Claude Code; Codex via scripts/install-codex.sh"
argument-hint: "[path | --diff <ref>] [--perspectives security,correctness,types,performance,tests,arch,ui,a11y]"
---

# Audit to backlog

## Establish scope

- Resolve the requested path, diff reference, and perspectives.
- Detect the stack, the lockfile-selected package manager, and the actual validation commands.
- Find the backlog paths: a `Backlog: <todo path>, <done path>` line in the project's `AGENTS.md` or `CLAUDE.md`, otherwise `TODO.md` and `TODO-done.md`. Read them if they exist; never duplicate or resurrect findings.
- Before creating the backlog files or `feature_list.json`, ask the user whether to use the default paths or others. Write the chosen paths as a `Backlog: <todo path>, <done path>` line in the project's `AGENTS.md` (or `CLAUDE.md` when there is no `AGENTS.md`) so later sessions find them. Use the chosen paths everywhere below.
- Prefer project-specific reviewer agents when the repository defines any.

## Delegate independent perspectives

Run the requested perspectives in parallel:

| Perspective | Reviewer |
|---|---|
| security | `developer-os:security-auditor` |
| performance | `developer-os:performance-engineer` |
| tests | `developer-os:qa-expert`, assessment only: tell it to write nothing |
| correctness | `developer-os:code-reviewer` |
| types | inline pass or a general-purpose agent |
| arch (architecture, dead code) | inline pass or a general-purpose agent |
| ui | inline pass or a general-purpose agent |
| a11y | inline pass or a general-purpose agent |

Give each reviewer the objective, an explicit scope (directories or a file list), constraints, stack, output format, and a cap of 15 findings ordered by impact.

Require each finding to include a unique category ID, `file:line`, severity, problem, current-code evidence, actionable fix, and validation. Reject unsupported claims.

Severity: P0 = exploitable security defect, data loss, or production down; P1 = wrong behavior on a common path; P2 = edge-case defect or meaningful maintainability risk; P3 = minor or cleanup.

For dead code, require zero references, invariant flags, old unreferenced code, or long commented blocks; classify removal confidence.

## Verify blocking findings

Before writing the backlog, send every P0 and P1 finding to a fresh verifier that did not produce it: Codex when the Codex plugin (`openai/codex-plugin-cc`) is installed, otherwise a `general-purpose` subagent. Codex is optional; never install it or fail without it. Give the verifier only the claim (`file:line` and the wrong behavior in one sentence, without its cause) and the repository path, without the reviewer's evidence or reasoning, and prompt: "Try to disprove this finding by reading the code. Reply CONFIRMED or REFUTED, with the `file:line` evidence for your answer."

Keep CONFIRMED findings, and mark a finding unverified when the verifier cannot decide. Leave REFUTED findings out of the backlog and list them, with the verifier's evidence, under Disputed in the report.

## Merge the backlog

- Write or merge into the backlog with P0–P3 sections followed by an implementation-sessions section.
- Deduplicate by file and root cause; keep the higher severity.
- Continue existing category numbering.
- Group 5–7 related tasks per implementation session without mixing P0 and P3.
- Report only measured metrics.
- For multi-session work, create `feature_list.json`: a JSON array with one object per task (its ID, a short description, and `"passes": false`). Implementation may change only `passes`, and only after end-to-end verification.

Validate that every item is evidence-backed, actionable, unique, and absent from the done file. Report priority counts and the three highest-impact findings.

## Stop point

Stop after the backlog is written and validated. Return the priority counts and the three highest-impact findings; implementation belongs to the `implement-backlog` skill.

## Never

- Fix a finding or edit code outside the backlog files, `feature_list.json`, and the `Backlog:` line.
- Create the backlog files before the user chooses their paths.
- Record a finding without `file:line` evidence, or resurrect one from the done file.
- Let a reviewer write code or tests.
