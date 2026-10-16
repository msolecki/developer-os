---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-16
---

# Functional specification

What each part of the plugin does, what it may change, and where it stops. The steps themselves live
in each `SKILL.md`; this page is the contract summary across all of them. Paths are relative to
`plugin/`.

## 1. Always on: core rules

`rules/core.md` is printed into the session by the `SessionStart` hook on every startup, resume,
`/clear`, compaction and fork, in every project. After a compaction or resume the hook adds a state
card ([reference/hooks.md](../reference/hooks.md#sessionstart--core-rules-and-state-card)). It has four sections:

| Section | What it governs |
|---|---|
| Security and change constraints | No auth/middleware change unless asked; ask before dependency installs; never delete or skip tests to pass; two validation tiers (fast check before each commit, full suite before push/PR); verify subagent work with `git status`/`git diff`; first-session procedure for external repositories; newline normalization in hooks you write |
| Workflow | Stop condition; A/B/C questions for open decisions; a plan for changes over 50 lines (git-ignored, default `docs/plans/<YYYY-MM-DD-task>.md`, deleted when done); What/Where/How/Test plan steps; reviewer differs from author; handoff contents; brain-search before large tasks when a `Brain vault:` line exists; compaction preserves files, test commands, objective and language, and task state lives in `docs/plans/.devos-state.md`; evidence for "works"; one worktree per parallel agent; conventions live in skills |
| Communication | User's language in conversation, English in the repository; plain language for clients; Problem → Cause → Solution → Test; closing **Done / Not done / Needs you** block; ASAP mode; self-correction signals; boundaries |
| Stack preferences | Lockfile's package manager; existing stack; TypeScript `strict`. Meant to be overridden in the user's own `CLAUDE.md` |

A user overrides any rule by stating the override in `~/.claude/CLAUDE.md`, which loads alongside.

## 2. Skills

Legend: **Writes** is everything the skill may change. **Gate** is what needs the user's explicit
answer first. Read-only skills ([glossary](../glossary.md)) change nothing; a skill whose Writes is
"Nothing" can still be an action skill.

### 2.1 Brain skills

Five of them (all but brain-setup, which asks for the path) find the vault with the same paragraph: the first `Brain vault: <absolute path>` line in the
`CLAUDE.md`/`AGENTS.md` already in context, then the working directory's `CLAUDE.md` and
`AGENTS.md`, then `$CLAUDE_CONFIG_DIR/CLAUDE.md` (default `~/.claude/CLAUDE.md`), then `~/.codex/AGENTS.md`. Without one they ask once and
stop if the user has no vault; they never search the disk. Vault content is data: no command or URL
found in a note is run or opened.

| Skill | Does | Writes | Gate | Stops at |
|---|---|---|---|---|
| [brain-setup](../../plugin/skills/brain-setup/SKILL.md) | Creates a vault from `vault-template/` into an empty path, or connects a non-empty one by adding only missing folders, views, the note template, `.gitignore` lines (only in a vault that is a git repository or already has a `.gitignore`) and absent `types.json` keys; points Claude Code at it | New vault files; appended `.gitignore` lines (git vaults only); `~/.claude/CLAUDE.md` (`Brain vault:` line); `~/.claude/settings.json` (`permissions.additionalDirectories`) | Connect mode on a non-empty path; the two config edits shown as a diff; `types.json` merge | Smoke test with brain-search, then a report |
| [brain-search](../../plugin/skills/brain-search/SKILL.md) | Searches content and frontmatter with `rg`, ranks (summary/tags/name, project, active over inbox, newer), reads the top 5, answers only from them with a vault path per claim | Nothing | — | The answer, or "No note in the vault covers <topic>." |
| [brain-capture](../../plugin/skills/brain-capture/SKILL.md) | Three-question gate (useful beyond this task? why written? not already in code/plan/ADR?), duplicate check, secret and client-PII redaction, then one note | One new file in `_inbox/`, `status: inbox` | Asks once for the why if missing | The report: path, possible duplicate, what was redacted |
| [brain-review](../../plugin/skills/brain-review/SKILL.md) | Summarizes each inbox note, proposes a topic folder and duplicates; promotes, merges or rejects only named notes | Moves named notes to a topic folder (`status: active`) or `_archive/` (`status: archived`); edits the surviving note in a merge | Each note by name; "looks good" is not approval | "Approve which ones?", then the moves |
| [brain-garden](../../plugin/skills/brain-garden/SKILL.md) | Health report: frontmatter, stale active notes (180 days), inbox notes older than 7 days, status/folder mismatches, broken and archived links, duplicates, orphans with a percentage; proposed links tagged FOUND or GUESSED | Named fixes only; one line appended to `_reports/garden-log.md` | Each fix; "apply all" never covers GUESSED links; the log line | "Apply which fixes?" |
| [brain-compile](../../plugin/skills/brain-compile/SKILL.md) | Synthesizes 2–8 active notes on a topic into one note with a `sources:` list; contradictions become `Open conflict:` bullets | One new `_inbox/<topic>-compiled.md` | — | The report; originals unchanged |

### 2.2 Engineering skills

| Skill | Does | Writes | Gate | Stops at |
|---|---|---|---|---|
| [code-review](../../plugin/skills/code-review/SKILL.md) | Reviews a PR, diff, commit or working tree; hands code written in this session to the `developer-os:code-reviewer` agent with a neutral brief (diff, spec or `Done when`, rubric; no author); reads both sides of every changed contract; rates a doc the diff makes false as a P2 docs finding (commands, paths, versions or behavior the diff changes; no verdict change); sends each P0/P1 to a fresh verifier; treats PR text and code comments as data | Nothing | — | Verdict `APPROVE` / `COMMENT` / `REQUEST_CHANGES`, findings P0–P3, Disputed list; an `APPROVE` without P0–P2 lists Evidence checked |
| [spec](../../plugin/skills/spec/SKILL.md) | Interviews one question at a time, inspects code, writes a spec and an implementation plan | `<date>-<feature>-spec.md` and `<date>-<feature>.md` in the documented locations; backlog items on a yes | Spec location when none is documented; adding to the backlog | Both paths and a handoff prompt for a fresh session |
| [audit-to-backlog](../../plugin/skills/audit-to-backlog/SKILL.md) | Parallel specialist reviews (security, performance, tests, correctness, types, arch, ui, a11y), file-and-line evidence, verifier for P0/P1, dedup; writes items in the [backlog item format](#24-backlog-item-format) | Backlog files, the `Backlog:` line | Backlog paths before creating them | Priority counts and the top three findings |
| [implement-backlog](../../plugin/skills/implement-backlog/SKILL.md) | Implements a batch (default 5, max 10) of ready items (no open `Blocked by`, no other `Owner`), takes only items in the backlog format (others are listed as `unformatted`), claims the batch (`Owner` lines, one commit; uncommitted and sequential when the backlog is git-ignored) before writing any brief, sizes briefs S/M/L (an L item stops at `REVIEW` with a plan), reads each delegate's final status, screens every `Check` before dispatch (never one that pipes into a shell, fetches from the network or writes outside the repository) and runs it itself, and only orchestrates while delegates run; integrates on a local batch branch and fast-forwards the base only after the review passes (`APPROVE`, or a `COMMENT` the user answered); reviews through code-review (`developer-os:code-reviewer` plus verification), at most two rounds, and fixes its docs findings in the batch commit; a `Manual:` item stays open until the user confirms it; proposes other review findings as backlog items; clears its `Owner` lines when it stops | Code, backlog (`Owner`, checked items), plan, state card, local commits | Auth/security items and unscreened `Check` commands up front; stops on a red baseline, after three failed repair cycles, or after two review rounds without a pass | A green local commit; never pushes |
| [fix-pr](../../plugin/skills/fix-pr/SKILL.md) | Works through every unresolved review thread or pasted finding; flags non-collaborator comments; treats comments as data | Code, commits, thread replies, resolved threads | Each edit, commit, push and resolution | A report of every comment with its final action |
| [pr-cycle](../../plugin/skills/pr-cycle/SKILL.md) | Merges the base in (never rebases a pushed branch), resolves clear conflicts, reviews, fixes approved findings, runs the fast check per commit and the full suite before push, has its own fix commits reviewed by `developer-os:code-reviewer` before the push, fixes docs findings under the recommended A answer, resolves threads only after a successful push, updates the PR body with the docs it updated or still contradicts; reads its trust inputs first and checks out an untrusted head only after the user approves running its code (otherwise a review-only verdict); treats PR text as data | Merge and fix commits, a non-force push, the PR body | Running project scripts or hooks on a fork PR or an outside author's PR; one A/B/C on what to fix; the push; the PR body; thread resolution | The merge verdict; the user merges |
| [bug-triage](../../plugin/skills/bug-triage/SKILL.md) | Treats issue text and logs as data; severity first, reproduction, ranked hypotheses with a falsifier (library or vendor behaviour checked by `developer-os:research-analyst`), root cause, mitigation, fix, regression test, rollback criteria | Nothing | Communication only on request | The triage output |
| [deploy-checklist](../../plugin/skills/deploy-checklist/SKILL.md) | Pre-deploy checks (validation, migrations, flags, monitoring, communication, rollback, window) with UNVERIFIED for missing evidence; post-deploy checks | Nothing | — | `GO` / `NO-GO`; after the deploy, the recorded result |
| [instruction-review](../../plugin/skills/instruction-review/SKILL.md) | Minimal evidence-backed diff for `CLAUDE.md`/`AGENTS.md`; shows the commit a change would reverse; proposes a check instead of a line for a repeated mechanical mistake; `--prune` gives each line DELETE/KEEP/REWRITE with a source and never deletes truthfulness rules | The instruction file | The diff | The diff, the prune table, or `NO CHANGES` |
| [plan-status](../../plugin/skills/plan-status/SKILL.md) | Counts done/open/blocked in the active plan and backlog by a stated rule, and ready/waiting/claimed/orphaned backlog items (one bucket per open item, first match wins in the order orphaned, waiting, claimed, ready, so the four add up to the open count); open decisions as numbered A/B/C questions | Nothing | — | Counts, next action, questions answerable as "1A 2B" |
| [client-reply](../../plugin/skills/client-reply/SKILL.md) | Turns technical facts into a plain-language reply in the client's language and the user's voice; strips internal identifiers | Nothing | — | The draft in chat; the user sends it |
| [docs-sync](../../plugin/skills/docs-sync/SKILL.md) | Checks a repository's docs against its code and the docs standard: missing pieces, drift (including `DESIGN.md` older than the styling sources), a refreshed `CURRENT-STATE.md`, "Likely agent mistakes" from git history | Approved doc edits | A numbered list, A/B/C | `git diff --stat`; the user commits |
| [project-baseline](../../plugin/skills/project-baseline/SKILL.md) | Probes 12 engineering practices (env module, secret deny-list, secret scanning, coverage floor, migration guard, boundaries, real-DB tests, safe errors, changelog, docs check, design system file, gate exit codes); missing ones become `BASE-NN` backlog items | Approved items in the backlog | Write the items; decisions it never defaults (package manager, test runner, auth library, monitoring, commit language) | `git diff --stat` |

### 2.3 Session skills

| Skill | Does | Writes | Gate | Stops at |
|---|---|---|---|---|
| [session-retro](../../plugin/skills/session-retro/SKILL.md) | Checks uncommitted, unpushed and unmerged work, open PRs and running tasks; proposes cleanup; prints the status block; proposes at most three lessons, rule candidates, check candidates, plan updates, docs updates, plugin feedback and skill candidates, each labeled `persistent` or `this-task` and routed to its destination; shows the commit a rule change would reverse | Approved items only (brain-capture, rule diffs, plan, auto-memory) | Each item by number | "Which items should I apply?"; with the Stop hook and nothing to report, no output |
| [skill-usage](../../plugin/skills/skill-usage/SKILL.md) | Counts `developer-os:<name>` Skill calls in local transcripts (last 30 days, ever, last date) and suggests keep / rewrite-description / merge / remove; points to the built-in `/skill-doctor` for context cost | Nothing | — | The table and "Nothing was changed." |

### 2.4 Backlog item format

audit-to-backlog, project-baseline and spec write, implement-backlog executes and plan-status counts one
item shape; `templates/project/TODO.md` shows it:

```markdown
- [ ] SEC-03 · P1 · Retry webhook deliveries with backoff
  - Where: `src/webhooks/deliver.ts:40`
  - Problem / Evidence / Fix: …
  - Size: S
  - Done when: a failed delivery is retried 3 times with exponential backoff, then marked failed.
  - Check: `pnpm vitest run src/webhooks/deliver.test.ts`
  - Blocked by: SEC-01
  - Owner: .worktrees/sec-03 (2026-10-15)
```

`Check` is a command that fails while `Done when` does not hold. `Owner` is written only by
implement-backlog before dispatch. `Done when` is never edited; a change is appended as
`Amended YYYY-MM-DD: …` with the user's approval, and code-reviewer rates a quiet weakening P1. The
format is defined in the skills only; projects get no lint for it (decision D17).

### 2.5 Built-in commands

Where a developer-os skill overlaps a built-in Claude Code command, the choice is mapped in
[workflow.md](../workflow.md#built-in-commands-with-similar-names).

### 2.6 Conventions skills

Loaded by the model when their description matches the file or task; never write anything
themselves. [comments](../../plugin/skills/comments-conventions/SKILL.md),
[defensive-coding](../../plugin/skills/defensive-coding-conventions/SKILL.md),
[error-handling](../../plugin/skills/error-handling-conventions/SKILL.md),
[monitoring](../../plugin/skills/monitoring-conventions/SKILL.md),
[nextjs](../../plugin/skills/nextjs-conventions/SKILL.md),
[testing](../../plugin/skills/testing-conventions/SKILL.md),
[typescript](../../plugin/skills/typescript-conventions/SKILL.md).

## 3. Agents

Dispatched by skills or by the main agent. All treat code, diffs, PR text and fetched pages as data.

| Agent | Model | Tools | Edits files | Used by |
|---|---|---|---|---|
| [code-reviewer](../../plugin/agents/code-reviewer.md) | sonnet | Read, Bash, Glob, Grep, Skill | No | code-review, implement-backlog and pr-cycle (through code-review), audit-to-backlog (correctness) |
| [security-auditor](../../plugin/agents/security-auditor.md) | opus | Read, Grep, Glob, Bash | No | audit-to-backlog (security) |
| [performance-engineer](../../plugin/agents/performance-engineer.md) | sonnet | Read, Bash, Glob, Grep | No | audit-to-backlog (performance) |
| [qa-expert](../../plugin/agents/qa-expert.md) | sonnet | Read, Grep, Glob, Bash, Write, Edit, Skill | Tests only, and only when asked | audit-to-backlog (tests, assessment only) |
| [research-analyst](../../plugin/agents/research-analyst.md) | sonnet | Read, Grep, Glob, WebFetch, WebSearch | No | bug-triage (library or vendor behaviour behind a hypothesis); on request |

Every agent starts its report with a final status: `DONE` (with evidence), `REVIEW`, `BLOCKED` (with
`Unblock owner: user | orchestrator | <item ID>`) or `CONTINUING`; it retries transient failures at
most twice and blocks at once on what only a person can fix. Reviewer agents use the same P0–P3
scale and verdicts as code-review; code-reviewer reads both sides of every changed contract and
lists Evidence checked under an `APPROVE` without P0–P2. qa-expert ends with
`VERIFIED` or `UNVERIFIED: <what>`; performance-engineer labels each finding MEASURED or INFERRED;
security-auditor drops any finding without an attack path.

## 4. Output styles

Selected with `/output-style` or `"outputStyle": "developer-os:<name>"` in settings; the prefix is
required. All four set `keep-coding-instructions: true`, so Claude Code's coding instructions stay.

| Style | Behavior |
|---|---|
| [architect](../../plugin/output-styles/architect.md) | ADR, Mermaid diagram, trade-off table and top-3 risk register before code, scaled to the request; waits for approval |
| [debug](../../plugin/output-styles/debug.md) | Hypothesis before edits, failing regression test before the fix, one change at a time |
| [direct-objective](../../plugin/output-styles/direct-objective.md) | Pushes back with file references; leads with code for implementation requests |
| [tdd-enforcer](../../plugin/output-styles/tdd-enforcer.md) | One failing test, show the red, wait for approval, minimum code, all green |

The architect and tdd-enforcer stops yield to an autonomous loop the user started through a skill
such as implement-backlog.

## 5. Hooks

| Event | Script | Effect |
|---|---|---|
| `SessionStart` (all sources) | `hooks/session-start.sh` | Core rules become session context; after a compaction or resume in a git repository, a state card of at most 1 KB follows |
| `Stop` | `hooks/capture-nudge.sh` | Once per interactive session, after 30 tool calls, asks the agent to run session-retro |
| `PreToolUse` on Bash | `hooks/guard.sh` | Asks for confirmation before a dependency install with a package argument (`npm`, `pnpm`, `yarn` or `bun`, also by full path, with `install`, `add`, `i` or an npm alias), a force push (`--force`, `-f` or a `+refspec`, even next to `--force-with-lease`; a lone `--force-with-lease` passes; git also by full path), or a hook bypass (`--no-verify` and its prefixes `--no-veri`/`--no-verif`, `git commit -n`, `HUSKY=0`, `core.hooksPath` (any form)); never denies |

Inputs, outputs, exit codes and switches: [reference/hooks.md](../reference/hooks.md).

## 6. Templates

- **Vault template** (`plugin/vault-template/`): folders, the note template, three Bases views,
  property types and a `.gitignore`. Shipped inside the plugin so brain-setup can copy it. Layout
  and note format: [workflow.md, Vault layout](../workflow.md#vault-layout).
- **Project template** (`templates/project/`): `AGENTS.md`, a one-line `CLAUDE.md` (`@AGENTS.md`),
  `_Context.md` with the vault slug, `TODO.md` with the backlog item format, `DESIGN.md` in the
  DESIGN.md format for projects with a UI, a `.gitignore` that keeps `docs/plans/` (and the state
  file the `SessionStart` card reads) out of git, and a `docs/` skeleton (index, `CURRENT-STATE.md`,
  `pitfalls.md`, `decisions/`, `runbooks/`). Not in the installed plugin: copy it from the
  repository, or let docs-sync scaffold from the standard it carries.

## 7. Codex installer

`scripts/install-codex.sh` (in the repository, run by hand) copies every skill to Codex's skill
directory with a short description and Claude-only references rewritten, and keeps the core rules in a
marked block of `~/.codex/AGENTS.md`. See the [README](../../README.md#codex-installer-best-effort).

## 8. Approval model

What the plugin never does without the user's explicit answer for that specific action:

| Action | Where enforced |
|---|---|
| Write in the vault outside `_inbox/`, move, merge or archive a note | brain-review, brain-garden `## Never` |
| Delete a note | No skill deletes; retire to `_archive/` |
| Edit `~/.claude/CLAUDE.md` or `settings.json` | brain-setup (diff first) |
| Edit an instruction file | instruction-review, session-retro |
| Create backlog files or add backlog items | audit-to-backlog, project-baseline, spec, implement-backlog (review findings) |
| Edit code for review findings | fix-pr (per edit), pr-cycle (one A/B/C answer) |
| Commit | fix-pr (per commit); pr-cycle commits the base merge once conflicts are resolved and the fast check passes, and fix commits after its A/B/C answer; implement-backlog commits only green batch work it was asked to do |
| Push | fix-pr, pr-cycle; implement-backlog never pushes |
| Merge a PR, push to a base branch, force-push, rebase a pushed branch | No skill does this |
| Send email, chat, issues or comments outside the PR thread | No skill does this; client-reply drafts, session-retro prints a command |
| Install a dependency | Core rule; the `PreToolUse` guard asks |
