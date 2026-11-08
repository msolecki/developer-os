---
status: current
owner: Mateusz Solecki
last-verified: 2026-11-08
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
  error-handling: TypeScript server code, API routes or handlers; monitoring: infrastructure, CI workflows, alerts or health endpoints;
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
  cases per rule plus the total. Unsure is a question, not a finding; findings are verified as in
  audit-to-backlog. Findings become `CONV-NN`
  backlog items with a `Check` that fails while the violation is there.
- **Backlog paths:** without a `Backlog:` line and default files, the paths are a decision for
  you, and the `Backlog:` line is a numbered item like the rest.
- **Deliberate choices:** a practice the project's `AGENTS.md`, `docs/pitfalls.md` or decision
  records reject on purpose is reported as `deliberate`, never proposed.
- **Output:** the stack, which skills applied, one numbered list across all of them, and one
  A/B/C question.

### project-baseline

[Source](../../plugin/skills/project-baseline/SKILL.md). A presence check for 17 engineering
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
| No runtime dependency two majors behind | the package manager's outdated report shows none; on a yes to a second question, the three furthest behind get an upgrade plan from `dependency-upgrader` as their Fix |
| Dependency release-age cooldown | the update bot or package manager enforces a minimum release age (Dependabot `cooldown`, Renovate or pnpm `minimumReleaseAge`, uv `exclude-newer`; skipped without dependencies) |
| After-edit lint hook | a `PostToolUse` hook on `Edit\|Write` lints the edited file and shows only failures (skipped without a linter) |
| Agent sandbox | `.claude/settings.json` enables `sandbox` and denies reads of `~/.ssh` and `~/.aws` |
| Pinned MCP servers | every stdio server in `.mcp.json` runs a pinned version (skipped without `.mcp.json`) |
| Gate verdict in the exit code | no `\|\| true` or `continue-on-error` on a gate |

It never picks a default for the package manager, test runner, auth library, monitoring stack or
commit language: inconsistent evidence becomes a question.

### docs-sync

[Source](../../plugin/skills/docs-sync/SKILL.md). Checks the docs against the code and the docs
standard.

- **Missing pieces:** root `AGENTS.md` (under 100 lines, with `## Likely agent mistakes here` and
  `## Invariants`), a one-line `CLAUDE.md`, `_Context.md`, `DESIGN.md` for a UI, the git-ignored
  state file (`git check-ignore -q docs/plans/.devos-state.md`) and `.worktrees/`
  (`git check-ignore -q .worktrees/x`), frontmatter on every tracked doc (`git ls-files docs`),
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
- **Applying:** approved items that span more than three docs without uncommitted changes may go
  to the `docs-writer` agent; any hunk no approved item covers is listed and kept only on a yes.

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
  a truthfulness rule; lists every check it did not run under `NOT RUN`. Inside the developer-os
  repository it also reviews `plugin/rules/core.md`.

### audit-to-backlog

[Source](../../plugin/skills/audit-to-backlog/SKILL.md). A broad code audit by parallel
specialists: security (`security-auditor`), performance (`performance-engineer`), tests
(`qa-expert`, assessment only), correctness (`code-reviewer`), data (`database-reviewer`, skipped without a database), infra
(`infra-reviewer`, skipped without IaC or CI), and inline passes for types,
architecture and dead code, UI and accessibility. Every finding needs `file:line`, current-code
evidence, a fix, a `Done when` and a runnable `Check` (a negated grep paired with `test -f`, no
error swallowed into a default); unsupported claims are rejected. The findings
code-review would verify (each P0 and P1, up to five P2 correctness findings) go to a fresh verifier
(the `verifier` agent); refuted ones are listed as Disputed, not written, and an undecided one is
written with an `Unverified:` line. Findings are deduplicated by file and root cause against the backlog and
its done file; one already fixed in the done file or in flight in an open pull request (`gh pr list`,
skipped when `gh` is unavailable) is dropped and named in the report. A perspective whose reviewer ended `BLOCKED`, failed or hit its turn cap is listed under
`Not covered:` at the top of the backlog and in the report, with the union of the reviewers'
`Not read:` lines (in-scope paths they did not open).

## Code review and pull requests

### code-review

[Source](../../plugin/skills/code-review/SKILL.md). Reviews a PR, diff, commit or working tree.

- **Reviewer:** code written in this session goes to the `code-reviewer` agent with a neutral brief
  (diff, spec or `Done when`, rubric; no author, no rationale).
- **What it reads:** both sides of every contract the change touches (handler and client, schema
  and type, route and links, state map and transitions); a mismatch is P1. A domain formula, a field type
  or a value format is rated against the project's canonical helper, schema or business doc.
- **What it checks:** auth, middleware, migrations, tenant boundaries and destructive paths; tenant
  scoping, soft-delete filters, query ownership, breaking API changes, missing tests, error
  handling, Server Component defaults, loading and error states, accessibility; a weakened
  `Done when` without an `Amended` line (P1); a doc, or a site page restating a doc or skill, the
  diff makes false (P2, no verdict change).
- **Specialists:** a diff that touches a migration, a schema or the query layer also goes to
  `database-reviewer`, one that touches IaC or a CI workflow to `infra-reviewer` (never on an
  untrusted head); their findings merge into the review.
- **Verification:** each P0 and P1 and up to five P2 correctness findings go to a fresh verifier
  that tries to disprove them; further P2s are marked unverified.
- **Output:** `APPROVE`, `COMMENT` or `REQUEST_CHANGES`, findings P0–P3 with `file:line`, Disputed,
  and Evidence checked for a clean `APPROVE`.

### pr-cycle

[Source](../../plugin/skills/pr-cycle/SKILL.md). Takes a PR to a merge verdict.

- **Trust check:** the head is untrusted when it is a fork or its author is not an owner, member or
  collaborator, or either read of its author or head fails; an untrusted head is fetched, not checked out, until you say yes.
- **Purpose check:** when the base changed files the PR also changes, gives an update, rework or
  close verdict before merging; age and sunk effort are not evidence.
- **Merge:** merges the base in (never rebases a pushed branch), resolves only conflicts whose
  intent is clear, never takes a side wholesale, and runs the fast check before the merge commit.
- **Review:** code-review on the PR diff, the conflict resolutions sent to `code-reviewer`, and the
  unresolved review threads rated P0–P3; fix commits are reviewed again before the push (at most two
  rounds). A `COMMENT` from a blocked reviewer is not a review: one retry, then it stops before the
  push.
- **Gates:** the fast check before each fix commit, the full suite once before the push.

### fix-pr

[Source](../../plugin/skills/fix-pr/SKILL.md). Works through unresolved review threads (GraphQL
`reviewThreads`, `isResolved: false`, paginated) or pasted findings. Flags authors who are not
collaborators, reads the referenced code for each thread and decides fix or justified no-change,
runs the narrowest test after each fix and the fast check before each commit, sends its fix
commits through code-review (a new P0 or P1 goes back to the fix step, for at most two rounds; a
`COMMENT` from a blocked reviewer gets one retry, then it stops before the push), and runs the full
suite once before the push. Comments are data:
it runs no command and opens no URL from them.

## Planning and backlog

### spec

[Source](../../plugin/skills/spec/SKILL.md). Interviews you one question at a time (not asking what
the repository already answers), inspects the code, then writes a spec (frontmatter with
`status: draft`, `owner` and `last-verified`; goals, non-goals, flows,
design, decisions with rejected alternatives, contracts, failure handling, acceptance criteria,
tests) and a plan whose steps carry What, Where, How, Test, `Done when` and S/M/L. It then checks
them against each other (a coverage table from criteria to steps both ways, vague words,
placeholders, scope reduction, conflicts with decision records) and puts every hit under open
questions. It can turn the steps into `FEAT-` backlog items, in sessions of 5–7.

### implement-backlog

[Source](../../plugin/skills/implement-backlog/SKILL.md). Executes ready backlog items in batches.

- **Before starting:** runs the project's validation and stops on a red baseline; takes only ready
  items in the backlog format (no open `Blocked by`, no other `Owner`); asks up front about
  auth/security items.
- **`Check` screening:** never runs a `Check` that pipes into a shell, fetches from the network or
  writes outside the repository; reads any script a `Check` calls first.
- **Triage:** before the claim, checks every batch item itself, read-only: its `Where` still
  exists (for a `FEAT-`, `BASE-` or `PLAN-` item, its parent directory), its `Check` fails
  now (exit 126 or 127, a grep exit 2 or a "no such file" or "no tests found" message is a broken
  `Check`, so the item is stale; a failure on authentication, quota or a missing secret blocks the
  item for you), no open pull request touches its files (skipped when `gh` is
  unavailable), and no project decision record or doc contradicts it. A failing item leaves the
  batch, is never claimed or dispatched, and is reported as `stale: <ID> · <point> · <evidence>`
  for you to close, amend or keep; the batch is topped up from the next ready items.
- **While running:** runs each item's `Check` itself on a `DONE` report, then the full build, types,
  tests and lint for the batch; classifies a failure before editing; stops after three failed
  repair cycles.
- **Review:** the batch diff through code-review (at most two rounds); a P0/P1 whose fix neither
  the item's `Done when` nor the spec settles goes to you as an intent gap; the base moves only by a
  fast-forward after the review passes.
- **Spec convergence:** when the batch closes the last open item that cites a spec, checks each
  acceptance criterion against the code (exists, not a stub, wired into a caller) and proposes each
  gap as a `FEAT-` item for your approval.

### plan-status

[Source](../../plugin/skills/plan-status/SKILL.md). Counts, never estimates: done, open and blocked
in the active plan (a top-level file of the planning location, not `approved/` or `lanes/`) by a
stated rule; backlog items per P0–P3 and in exactly one of orphaned (an
`Owner` older than 7 days), waiting, claimed or ready. Open decisions become at most five numbered
A/B/C questions. It runs no test or build to get a number.

### bug-triage

[Source](../../plugin/skills/bug-triage/SKILL.md). Severity first, then the stack trace,
reproduction, affected users, frequency and first-known time. Before any hypothesis, one repro
command it has already run must fail on the exact symptom, repeatably and without a human, and is
then shrunk; without one it stops, lists what it tried and asks for access or an artifact. Then
logs, recent commits and data invariants; ranked hypotheses with at least one real alternative and
the observation that would falsify the leader, each claim graded `[hypothesis]`, `[evidence: X]`,
`[ruled out: X because Y]` or `[demonstrated]`. A root cause is `[demonstrated]` only when toggling
one condition switches the failure on and off. Library or vendor behaviour goes to
`research-analyst` for a sourced answer. Proposes mitigation, root-cause fix, regression test and
rollback criteria; applies none of them.

### deploy-checklist

[Source](../../plugin/skills/deploy-checklist/SKILL.md). Run before a release, not at setup.

- **Pre-deploy:** the repository's real test, lint, typecheck and build commands, green CI and the
  release branch; migrations (staging run, backward compatibility, backup, lock time, tested
  rollback); feature-flag defaults; dashboards, error tracking, alerts and abort thresholds; the
  exact rollback command; a deployment window and an owner for an hour of monitoring.
- **Verdict:** any failed or UNVERIFIED item is `NO-GO`; missing evidence is never counted as
  passed.
- **Post-deploy:** error rate and latency against the thresholds, new exceptions, a critical-flow
  smoke test, the result recorded in the closing status block (and offered as a line for a deploy
  runbook in `docs/runbooks/`).

### parallel-lanes

[Source](../../plugin/skills/parallel-lanes/SKILL.md). For free-form tasks that can run at once;
backlog items go to implement-backlog. Before a launch: a clean tree, `claude` and `python3` on
`PATH`, a known fast check, 2–6 lanes whose owned paths do not overlap (shared files such as a
lockfile belong to no lane), and a git-ignored run directory and `.worktrees/`. Each lane is a
detached `claude -p` in its own worktree and session, so it outlives the turn; the worktree starts
from the base commit recorded in `LANES.md`, which `launch.sh` checks. Each lane runs with a
recorded `--session-id`, a `--max-turns` cap, and `--disallowedTools` for edits to the manifest,
`Makefile`, hook directories and `.claude/` unless it owns them; its prompt allows only the lane's
paths and commits in the worktree, and its report starts with a final status and lists what is not
started, what is not verified and If-X-then-Y contingencies. The status table reads
the PIDs, the `EXIT=` line in each log, the time since the worktree last changed, the report's first
line, the lane's commits, any changed file outside its owned paths, and a `LANES.md` or prompt whose
hash differs from the one `launch.sh` recorded. A finished lane with no report or a `CONTINUING` one
can be resumed: `resume.sh` continues its session with `claude -p --resume` after the user's yes. Each lane has a runnable `Check` next to its `Done when`; the
lane has no access to the run directory and writes its report to a git-ignored file in its own
worktree. Integration takes only finished `DONE` lanes whose fast check and `Check` pass when the
orchestrator re-runs them, with no uncommitted change and no file changed outside the owned paths; any
other lane goes to Needs you. After merging, it runs every merged lane's `Check` and the
repository-wide gate on `lanes/<run>`, and stops on a `REQUEST_CHANGES` review.

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
most three under each heading, lessons (an addition to a note that already covers the topic is
proposed as a diff to it), rule candidates (with the commit they would reverse), check candidates, plan
and docs updates (open items of a finished plan become `PLAN-` backlog items, P2 by default, with a
session line), plugin feedback and skill candidates, each labeled `persistent` or `this-task`.
Every check result names the commit it ran on (`<command>: <result> at <short SHA>`, plus
`+ uncommitted: <changed files>` on a dirty tree).

### skill-usage

[Source](../../plugin/skills/skill-usage/SKILL.md). Counts `developer-os:<name>` Skill calls and
typed commands in local transcripts (deduplicated by message uuid): last 30 days, ever, last date,
with a keep / rewrite-description / merge / remove / hide suggestion per skill (hide: only ever typed, so
`disable-model-invocation: true` frees the shared skill listing). It prints no transcript
content. It runs in a forked subagent (`context: fork`), so only its report reaches the conversation.

## Brain (Obsidian vault)

### brain-setup

[Source](../../plugin/skills/brain-setup/SKILL.md). Checks whether the path is empty (new vault)
or not (connect, only after you agree); in connect mode adds only missing folders, views, the note
template, `.gitignore` lines and `types.json` keys, never overwriting a file. Shows the
`Brain vault:` line, the `additionalDirectories` change and, after a separate yes,
`"autoMemoryEnabled": false` as one diff; merges absent `.obsidian/types.json` keys after approval;
then smoke-tests with brain-search, passing it the vault path.

### brain-search

[Source](../../plugin/skills/brain-search/SKILL.md). Finds the vault from the path you give or the
`Brain vault:` line of the user-level `CLAUDE.md` (never a project file, never by searching the disk), searches content and frontmatter with `rg`, drops archived notes,
ranks by `summary`/`tags`/name match, project slug, `active` over `inbox` and recency, reads the
top five, follows a superseded note's `superseded_by` chain to the current note (a broken or looping
chain is incomplete history, with no note named current), and answers only from them with a path
per claim.

### brain-capture

[Source](../../plugin/skills/brain-capture/SKILL.md). Four gates before writing: useful beyond
this task, the why written down, not already in the code or the repository's plan, not better held by
a test, lint rule or project instruction (it names or proposes that instead). Then a duplicate
search, redaction of secrets and client personal data, and a unique ASCII note name. Every claim about
code is re-read in the current tree and cited as repository path plus defining symbol; merge state is
a PR number, not a SHA.

### brain-review

[Source](../../plugin/skills/brain-review/SKILL.md). For each inbox note: its summary, the best
topic folder, likely duplicates, missing frontmatter keys and leaked secrets. Before a move it
checks the name (`^[a-z0-9-]+$`) and that no other note has it, case-insensitively. It can supersede
a named active note by another active one (not itself, not one already superseded; the old note
stays in its folder). When a project hub links a promoted, merged or rejected note as
`(waiting for review)`, it shows the hub-line change as a diff and applies it only after a yes.

### brain-garden

[Source](../../plugin/skills/brain-garden/SKILL.md). One pass over every note: missing or invalid
frontmatter, inbox notes older than 7 days, active notes not updated in 180 days, status/folder
mismatches, broken links and links to archived notes, superseded notes whose `superseded_by` is
missing, dangling or looping, compiled notes older than an updated source, orphans with a percentage (a superseded note is never one), likely
duplicates (a project note and its `-overview` note are not), and rules stated by three or more
notes or restated in two or more hubs, proposed as one brain-compile note that the hubs link. Every
proposed link is tagged FOUND or GUESSED.

### brain-compile

[Source](../../plugin/skills/brain-compile/SKILL.md). Takes 2–8 active notes on a topic (no inbox,
archived or compiled notes), stops if a compiled note for the topic is still in the inbox, links
every statement to its source note, and records contradictions as `Open conflict:` instead of
choosing a side. Before writing it runs brain-capture's secret scan; a hit writes nothing.

### brain-project-refresh

[Source](../../plugin/skills/brain-project-refresh/SKILL.md). Finds the hub by the
`Vault project slug:` line in `_Context.md` (accepted only when it matches `^[a-z0-9-]+$`) and a `type: project` note with that slug. Checks the
hub against the README, the docs map, `CURRENT-STATE.md`, the decision records and the last 30
commits (claims the repository contradicts, repository paths that no longer exist) and against the
vault (active or superseded notes of the slug it does not link, links to notes that do not exist, a
summary or status that no longer fits). A drifted code fact is usually replaced by a link to the
repository doc, since the hub keeps only what outlives the repository. A claim it cannot check is
listed as unchecked, not changed.

### brain-import-memory

[Source](../../plugin/skills/brain-import-memory/SKILL.md). Finds the current repository's
auto-memory folder (`<config>/projects/<path with every non-alphanumeric character as ->/memory/`,
or `autoMemoryDirectory` from `settings.json`), or asks which project when it is missing. Reads every
topic file, searches the vault for each one and labels it: `new` (an inbox note in brain-capture's
format; files on one topic make one note), `add` (sentences for an existing note, as a diff),
`preference` (a line for the user-level `CLAUDE.md`), `project-rule` (a line for the repository's
instruction file), `covered` or `skip` (with the reason). A file that contradicts a note shows both
claims; the newer, better-evidenced one is proposed, otherwise the note stays. Secrets, account IDs,
IP addresses and private contact details are redacted. Applies only the numbers the user names,
never touches the memory files; while auto memory is still on, `autoMemoryEnabled: false` is one more
numbered item, re-checked after it is written.

## Conventions

The model loads these when the file or task matches; they write nothing. Each rule is what the
agent follows when it writes code and what project-init probes for when it audits a repository.

### typescript-conventions

[Source](../../plugin/skills/typescript-conventions/SKILL.md). Loads for TypeScript files.
`strict` stays on; composition over inheritance; one purpose per function, about 30 lines or fewer;
tests for every new exported function or changed contract and its edge cases; the formatter's quote style; the configured import
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
never log and throw the same error; no empty `catch {}` without a one-line comment saying why; exceptions are
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
carries its reason; a guard that greps a command joins its lines first; an idempotency key is
claimed with a status; check and act share one transaction; `LIMIT` has an `ORDER BY`; cleanup covers
setup; redaction runs before truncation; money is integers in the smallest unit; only safe calls are
retried, in one layer; authorization reads server-held facts.

### comments-conventions

[Source](../../plugin/skills/comments-conventions/SKILL.md). Loads when writing or reviewing code comments in TypeScript, JavaScript, Python or shell files. No comment by
default (rename or extract first); never restate the next line or explain the change; a comment
only for a past bug, a directive or a non-obvious platform fact, in one line; update or delete the
comment with the code it describes. It governs only the comments the agent adds and leaves
existing ones alone, so project-init does not audit it.
