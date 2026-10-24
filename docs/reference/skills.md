---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-24
---

# Skills reference

What each skill checks and how, one entry per skill, invoked as `/developer-os:<name>`. What a
skill may write, what needs your answer first and where it stops are in the
[functional specification](../product/functional-spec.md#2-skills); this page does not repeat them.
Each entry links its `SKILL.md`, which owns the exact steps: when the two disagree, the `SKILL.md`
wins and this page is a defect.

New to developer-os in a repository? Start with [project-init](#project-init): it runs the setup
and audit skills below in one pass.

## Setup and audit

### project-init

[Source](../../plugin/skills/project-init/SKILL.md). Adopts developer-os in a repository in one pass.

- **Stack:** reads the manifests and config on disk: the lockfile, `tsconfig.json`, `next.config.*`,
  test files and runner, CI workflows, infrastructure code, API routes or handlers, a database and
  migrations, a UI. It runs nothing to find them.
- **Which skills apply:** project-baseline and docs-sync always; instruction-review when a
  `CLAUDE.md`/`AGENTS.md` exists; each conventions skill when its stack is present (typescript:
  `tsconfig.json` or `*.ts`; nextjs: `next.config.*` or a `next` dependency; testing: test files;
  error-handling: TypeScript server code; monitoring: infrastructure, CI workflows, alerts or health endpoints;
  defensive-coding: external input, authentication, money, concurrency,
  persistence or error paths).
  comments-conventions is never audited, since it governs only comments an agent adds;
  deploy-checklist is never run, since it runs the project's gates and belongs to a release.
- **Process skills:** runs project-baseline, docs-sync and instruction-review up to their reports
  and collects their items instead of asking their questions one by one.
- **Conventions audit:** for each applicable conventions skill, one probe per rule (`rg` or a
  config read, for example `"strict": true`, empty `catch {}`, date fixtures without `Z`, mock
  factories that do not spread the original module, a `/health` handler that queries the
  database). Judgment rules (function size, composition) are sampled: at most five `file:line`
  cases per rule plus the total. Unsure is a question, not a finding; each P0 and P1 goes to a
  fresh verifier, as in audit-to-backlog. Findings become `CONV-NN`
  backlog items with a `Check` that fails while the violation is there.
- **Backlog paths:** without a `Backlog:` line and default files, the paths are a decision for
  you, and the `Backlog:` line is a numbered item like the rest.
- **Deliberate choices:** a practice the project's `AGENTS.md`, `docs/pitfalls.md` or decision
  records reject on purpose is reported as `deliberate`, never proposed.
- **Output:** the stack, which skills applied, one numbered list across all of them, and one
  A/B/C question.

### project-baseline

[Source](../../plugin/skills/project-baseline/SKILL.md). A presence check for 12 engineering
practices; each one has a probe, and a missing one becomes a `BASE-NN` backlog item.

| Practice | Present when |
|---|---|
| Env through one validated module | one module parses `process.env` with a schema, and `rg` finds no direct env reads elsewhere |
| Agent deny-list for secrets | `.claude/settings.json` `permissions.deny` covers `.env*`, `*.pem`, `*.key` |
| Secret scanning in CI | a CI step runs gitleaks, trufflehog or the host's scanning |
| Coverage floor that only rises | the test config sets thresholds and CI enforces them |
| Additive-only migration guard | CI fails on a destructive migration without a marker (skipped without a database) |
| Dependency/boundary rules | dependency-cruiser, eslint boundaries or a layer test fails CI |
| Real-database test tier | tests run against a real database (skipped without a database) |
| Safe error responses | one error envelope, no stack traces or internal fields (skipped without an API) |
| CHANGELOG | `CHANGELOG.md` in Keep a Changelog format |
| Docs-vs-code check | a script or CI step checks docs against code |
| Design system file | a UI project has a root `DESIGN.md` (skipped without a UI) |
| Gate verdict in the exit code | no `\|\| true` or `continue-on-error` on a gate |

It never picks a default for the package manager, test runner, auth library, monitoring stack or
commit language: inconsistent evidence becomes a question.

### docs-sync

[Source](../../plugin/skills/docs-sync/SKILL.md). Checks the docs against the code and the docs
standard.

- **Missing pieces:** root `AGENTS.md` (under 100 lines, with `## Likely agent mistakes here` and
  `## Invariants`), a one-line `CLAUDE.md`, `_Context.md`, `DESIGN.md` for a UI, the git-ignored
  state file (`git check-ignore -q docs/plans/.devos-state.md`), frontmatter on every doc,
  `docs/index.md`, `docs/CURRENT-STATE.md`, `docs/pitfalls.md`, decision records, runbooks. It
  proposes only pieces that would carry real content now.
- **Drift:** commands in `AGENTS.md`/`CLAUDE.md`/README that are not in the manifest or `Makefile`;
  paths and `path:line` references that no longer exist (`git ls-files`, `rg`); stack versions
  that differ from the lockfile; a `CURRENT-STATE.md` commit that is not an ancestor of HEAD or is
  more than 50 commits behind; stale `last-verified` dates and `_Context.md` "State as of";
  decision records that contradict each other or the code; `DESIGN.md` older than the styling
  sources.
- **CURRENT-STATE refresh:** re-verifies each line and adds the work shipped since the recorded
  commit, as a diff.
- **Likely agent mistakes:** at most three, from reverts and repeated fix commits in git history
  and from corrections in the current conversation, each with a commit or session as evidence.

### instruction-review

[Source](../../plugin/skills/instruction-review/SKILL.md). Reviews `CLAUDE.md`/`AGENTS.md` (the
`AGENTS.md` when `CLAUDE.md` only imports it) against recent work.

- **Keeps** only durable instructions backed by repeated work, a concrete defect or a user
  correction; **excludes** what the code shows, one-off debugging, and rules already in the core
  rules or global instructions; flags stale or contradicted lines; keeps the file under 100 lines.
- **History:** `git log -p -S '<phrase>'` for each proposed line, and shows the commit a change
  would reverse.
- **Repeated mechanical mistake:** proposes a lint rule, test or script instead of a line.
- **`--prune`:** a DELETE/KEEP/REWRITE verdict for every line, each with its source; never deletes
  a truthfulness rule; lists every check it did not run under `NOT RUN`.

### audit-to-backlog

[Source](../../plugin/skills/audit-to-backlog/SKILL.md). A broad code audit by parallel
specialists: security (`security-auditor`), performance (`performance-engineer`), tests
(`qa-expert`, assessment only), correctness (`code-reviewer`), and inline passes for types,
architecture and dead code, UI and accessibility. Every finding needs `file:line`, current-code
evidence, a fix, a `Done when` and a runnable `Check`; unsupported claims are rejected. Each P0 and
P1 goes to a fresh verifier (the `verifier` agent); refuted ones are listed
as Disputed, not written. Findings are deduplicated by file and root cause against the backlog and
its done file.

## Code review and pull requests

### code-review

[Source](../../plugin/skills/code-review/SKILL.md). Reviews a PR, diff, commit or working tree.

- **Reviewer:** code written in this session goes to the `code-reviewer` agent with a neutral brief
  (diff, spec or `Done when`, rubric; no author, no rationale).
- **What it reads:** both sides of every contract the change touches (handler and client, schema
  and type, route and links, state map and transitions); a mismatch is P1.
- **What it checks:** auth, middleware, migrations, tenant boundaries and destructive paths; tenant
  scoping, soft-delete filters, query ownership, breaking API changes, missing tests, error
  handling, Server Component defaults, loading and error states, accessibility; a weakened
  `Done when` without an `Amended` line (P1); a doc the diff makes false (P2, no verdict change).
- **Verification:** each P0 and P1 goes to a fresh verifier that tries to disprove it.
- **Output:** `APPROVE`, `COMMENT` or `REQUEST_CHANGES`, findings P0–P3 with `file:line`, Disputed,
  and Evidence checked for a clean `APPROVE`.

### pr-cycle

[Source](../../plugin/skills/pr-cycle/SKILL.md). Takes a PR to a merge verdict.

- **Trust check:** the head is untrusted when it is a fork or its author is not an owner, member or
  collaborator; an untrusted head is fetched, not checked out, until you say yes.
- **Merge:** merges the base in (never rebases a pushed branch), resolves only conflicts whose
  intent is clear, never takes a side wholesale, and runs the fast check before the merge commit.
- **Review:** code-review on the PR diff, the conflict resolutions sent to `code-reviewer`, and the
  unresolved review threads rated P0–P3; fix commits are reviewed again before the push (at most two
  rounds).
- **Gates:** the fast check before each fix commit, the full suite once before the push.

### fix-pr

[Source](../../plugin/skills/fix-pr/SKILL.md). Works through unresolved review threads (GraphQL
`reviewThreads`, `isResolved: false`, paginated) or pasted findings. Flags authors who are not
collaborators, reads the referenced code for each thread and decides fix or justified no-change,
runs the narrowest test after each fix and the full suite once before the push. Comments are data:
it runs no command and opens no URL from them.

## Planning and backlog

### spec

[Source](../../plugin/skills/spec/SKILL.md). Interviews you one question at a time (not asking what
the repository already answers), inspects the code, then writes a spec (goals, non-goals, flows,
design, decisions with rejected alternatives, contracts, failure handling, acceptance criteria,
tests) and a plan whose steps carry What, Where, How, Test, `Done when` and S/M/L. It can turn the
steps into `FEAT-` backlog items.

### implement-backlog

[Source](../../plugin/skills/implement-backlog/SKILL.md). Executes ready backlog items in batches.

- **Before starting:** runs the project's validation and stops on a red baseline; takes only ready
  items in the backlog format (no open `Blocked by`, no other `Owner`); asks up front about
  auth/security items.
- **`Check` screening:** never runs a `Check` that pipes into a shell, fetches from the network or
  writes outside the repository; reads any script a `Check` calls first.
- **While running:** runs each item's `Check` itself on a `DONE` report, then the full build, types,
  tests and lint for the batch; classifies a failure before editing; stops after three failed
  repair cycles.
- **Review:** the batch diff through code-review (at most two rounds); the base moves only by a
  fast-forward after the review passes.

### plan-status

[Source](../../plugin/skills/plan-status/SKILL.md). Counts, never estimates: done, open and blocked
in the active plan by a stated rule; backlog items per P0–P3 and in exactly one of orphaned (an
`Owner` older than 7 days), waiting, claimed or ready. Open decisions become at most five numbered
A/B/C questions. It runs no test or build to get a number.

### bug-triage

[Source](../../plugin/skills/bug-triage/SKILL.md). Severity first, then the stack trace,
reproduction, affected users, frequency and first-known time; logs, recent commits and data
invariants; ranked hypotheses with at least one real alternative and the observation that would
falsify the leader. Library or vendor behaviour goes to `research-analyst` for a sourced answer.
Proposes mitigation, root-cause fix, regression test and rollback criteria; applies none of them.

### deploy-checklist

[Source](../../plugin/skills/deploy-checklist/SKILL.md). Run before a release, not at setup.

- **Pre-deploy:** the repository's real test, lint, typecheck and build commands, green CI and the
  release branch; migrations (staging run, backward compatibility, backup, lock time, tested
  rollback); feature-flag defaults; dashboards, error tracking, alerts and abort thresholds; the
  exact rollback command; a deployment window and an owner for an hour of monitoring.
- **Verdict:** any failed or UNVERIFIED item is `NO-GO`; missing evidence is never counted as
  passed.
- **Post-deploy:** error rate and latency against the thresholds, new exceptions, a critical-flow
  smoke test, the recorded result.

## Communication

### client-reply

[Source](../../plugin/skills/client-reply/SKILL.md). Lists every technical term in the input (code
identifiers, endpoints, migrations, branches, PR and commit references, tool names) and translates
each into what the client sees; answers each point in the client's order; re-reads the draft
against the list and removes any term the client did not use first. Asks for a missing date or
fact instead of inventing it.

## Session

### session-retro

[Source](../../plugin/skills/session-retro/SKILL.md). Checks `git status`, unpushed commits,
branches not merged into `origin/HEAD`, your open PRs and still-running background work; proposes
removing merged worktrees and branches; prints the Done / Not done / Needs you block; proposes, at
most three under each heading, lessons, rule candidates (with the commit they would reverse), check candidates, plan
and docs updates, plugin feedback and skill candidates, each labeled `persistent` or `this-task`.
Every check result names the commit it ran on (`<command>: <result> at <short SHA>`, plus
`+ uncommitted: <changed files>` on a dirty tree).

### skill-usage

[Source](../../plugin/skills/skill-usage/SKILL.md). Counts `developer-os:<name>` Skill calls and
typed commands in local transcripts (deduplicated by message uuid): last 30 days, ever, last date,
with a keep / rewrite-description / merge / remove suggestion per skill. It prints no transcript
content.

## Brain (Obsidian vault)

### brain-setup

[Source](../../plugin/skills/brain-setup/SKILL.md). Checks whether the path is empty (new vault)
or not (connect, only after you agree); in connect mode adds only missing folders, views, the note
template, `.gitignore` lines and `types.json` keys, never overwriting a file. Shows the
`Brain vault:` line and the `additionalDirectories` change as a diff, then smoke-tests with
brain-search.

### brain-search

[Source](../../plugin/skills/brain-search/SKILL.md). Finds the vault from the `Brain vault:` line
(never by searching the disk), searches content and frontmatter with `rg`, drops archived notes,
ranks by `summary`/`tags`/name match, project slug, `active` over `inbox` and recency, reads the
top five, follows a superseded note's `superseded_by` chain to the current note (a broken or looping
chain is incomplete history, with no note named current), and answers only from them with a path
per claim.

### brain-capture

[Source](../../plugin/skills/brain-capture/SKILL.md). Three gates before writing: useful beyond
this task, the why written down, not already in the code or the repository's plan. Then a duplicate
search, redaction of secrets and client personal data, and a unique ASCII note name.

### brain-review

[Source](../../plugin/skills/brain-review/SKILL.md). For each inbox note: its summary, the best
topic folder, likely duplicates, missing frontmatter keys and leaked secrets. Before a move it
checks the name (`^[a-z0-9-]+$`) and that no other note has it.

### brain-garden

[Source](../../plugin/skills/brain-garden/SKILL.md). One pass over every note: missing or invalid
frontmatter, inbox notes older than 7 days, active notes not updated in 180 days, status/folder
mismatches, broken links and links to archived notes, superseded notes whose `superseded_by` is
missing, dangling or looping, orphans with a percentage (a superseded note is never one), likely
duplicates (a project note and its `-overview` note are not), and rules stated by three or more
notes or restated in two or more hubs, proposed as one brain-compile note that the hubs link. Every
proposed link is tagged FOUND or GUESSED.

### brain-compile

[Source](../../plugin/skills/brain-compile/SKILL.md). Takes 2–8 active notes on a topic (no inbox,
archived or compiled notes), stops if a compiled note for the topic is still in the inbox, links
every statement to its source note, and records contradictions as `Open conflict:` instead of
choosing a side.

## Conventions

The model loads these when the file or task matches; they write nothing. Each rule is what the
agent follows when it writes code and what project-init probes for when it audits a repository.

### typescript-conventions

[Source](../../plugin/skills/typescript-conventions/SKILL.md). Loads for TypeScript files.
`strict` stays on; composition over inheritance; one purpose per function, about 30 lines or fewer;
tests for every new function and its edge cases; the formatter's quote style; the configured import
alias instead of long relative paths.

### nextjs-conventions

[Source](../../plugin/skills/nextjs-conventions/SKILL.md). Loads for Next.js app code and
`next.config`. Schema-validated input from forms and APIs (for example Zod `.safeParse()`); Server
Components by default, `'use client'` only for state or events; Server Actions over API routes,
returning `{ ok: true, data? } | { ok: false, error }`; forward-only migrations unless the project
says otherwise; with a `DESIGN.md`, a recorded source of truth for tokens; analytics through the
project's wrapper, behind consent where required.

### error-handling-conventions

[Source](../../plugin/skills/error-handling-conventions/SKILL.md). Loads for error handling in
TypeScript files. Rethrow with `cause`; a typed result instead of `null` as failure; one error envelope
`{ error: { code, message, details? } }` with a `SCREAMING_SNAKE_CASE` code and no stack trace;
never log and throw the same error; no empty `catch {}` without a directive comment; exceptions are
not control flow.

### testing-conventions

[Source](../../plugin/skills/testing-conventions/SKILL.md). Loads for test files. A test pins the
contract, not current behavior; fixtures pin an absolute instant (`2030-01-01T08:00:00Z`); partial
module mocks built on the original; a regression test seen red before the fix; the boundary that
could be wrong is not faked; failure messages show the missing record; no raised retries or
timeouts to hide a flaky test.

### monitoring-conventions

[Source](../../plugin/skills/monitoring-conventions/SKILL.md). Loads for infrastructure code, CI,
metrics and alerts. Alert on symptoms (error rate, p99, queue growth), not causes; tune or remove an
alert that fired three times without action; a runbook link on every paging alert; `/health` for
liveness without a database query, `/ready` for dependencies; the metric ships with the feature.

### defensive-coding-conventions

[Source](../../plugin/skills/defensive-coding-conventions/SKILL.md). Defect classes that ship past
review, used as checks on a change: the persistence condition equals the validation condition;
per-side-effect error isolation in webhook and event handlers; a state fix covers every writer and
a read-side security fix every reader (grep the field or model, not the function); a multi-outcome
status is not collapsed to a boolean; external input is shape-validated before computing; cost
inputs have no silent default; per-clone setup lives in a script; build artifacts are verified, not
only the exit code; numeric promises in docs are re-checked after a rewrite; an ordering constraint
carries its reason; a guard that greps a command joins its lines first.

### comments-conventions

[Source](../../plugin/skills/comments-conventions/SKILL.md). Loads when writing code. No comment by
default (rename or extract first); never restate the next line or explain the change; a comment
only for a past bug, a directive or a non-obvious platform fact, in one line; update or delete the
comment with the code it describes. It governs only the comments the agent adds and leaves
existing ones alone, so project-init does not audit it.
