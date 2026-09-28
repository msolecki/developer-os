# Developer OS Hooks (A13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23 and 2026-09-26; see git history.

**Open work:** Task 18, a **founder stop point**: it needs real sessions and manual Codex trust.
Task 2 is done (D67, `d157227..28cfe19`); its full-suite run is A15 step 7b on `a03499c`. Tasks 1 and 3–17 are
committed (Task 15, the Codex half, under D57 on a local mock Responses API) and Task 19's phase
close ran: full suite green on `bc17550`, the whole-phase review and its re-review (D62–D64), PR #15.
The surviving constraints are in `docs/architecture/hooks.md`.

**Order (D68):** Task 18 Step 1 is evidenced by A15 step 10's verification on the live machine; Steps 2–3 (Codex) follow once Codex quota returns (2026-10-22).

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-hooks-design.md` (A13, approved D47), with
the G1–G10 amendment block (`f3605a7`, `f473a91`).

**Roadmap:** Phase 6 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: every supported hook is observed firing on Claude, and on Codex after manual trust.
`session_start_injection` and `plugin_hooks` resolve to `yes` wherever a hook was observed firing.

---

## Constraints the open work depends on

- **Founder stop points.** No agent step starts a real `claude` or `codex` session, runs
  `claude plugin validate` or `codex plugin add` against the real home, reads or writes
  `~/.claude/settings.json` on the live machine, or grants Codex trust.
- **Frozen guards (D64).** A rule Task 2 adds stops an accidental harmful command; a crafted bypass is
  recorded as a residual in `docs/architecture/hooks.md` §3.8, not fixed by another tokenizer round.
- **Transcript gate.** `tests/repository/transcript-path.test.ts` scans `apps/`, `packages/`,
  `tests/` and `workflows/` for the transcript-path field name. A test that needs the name builds it
  at runtime with `["transcript", "path"].join("_")`. Recorded fixtures have the key **removed**
  before check-in.
- **Staging.** Exact paths only; `docs/superpowers/` needs `git add -f` on its own line.

---

### Task 2: Legacy parity check · founder stop point

**Done (D67, 2026-09-26).** An agent produced the additions list from the legacy scripts; the
founder approved it, and it entered the spec redacted ("Amended 2026-09-26 (D67)"). Every rule is
committed; the credential-path rules live in a hook-only table in `guard path` (founder option (c)).
The full suite has not yet run on these commits.

Spec §2 parity obligation. The founder runs it outside this repository against the legacy scripts.

**Files:** none in this task. Task 3 carries the spec amendment. Any rule addition lands as an
extra fixture pair and table row in Task 8 or Task 9, or as a follow-up task after them.

**Interfaces:**
- Consumes: nothing.
- Produces: a redacted list of rule additions (D5): rule ID, verb, what it blocks, one block example
  and one near-miss example. An empty list is a valid result.

- [x] **Step 1: FOUNDER compares §5's rule tables with `bash-danger-guard`, `secret-file-guard`,
  `commit-guard`, `stop-gate`, `format-smart`, `skill-activator` and `shared-file-warn`,** and returns
  the redacted additions list. It must also decide the residuals §11 names: `| /bin/sh`, `| sudo sh`
  and `bash <(curl …)`, and the first-token rows held as `it.todo` in
  `apps/cli/src/hooks/guards/{command,commit}.test.ts` (`BACKLOG.md` §6, Phase 6).
- [x] **Step 2: Orchestrator** records the list in the spec, in the Task 3 amendment block or a second
  dated block, and adds one task per accepted rule after Task 8 or Task 9. Each added task follows
  Task 8's pattern: a table row, a block fixture and a near-miss allow fixture.

### Task 18: Real-agent matrix · founder stop point

**Open.** Founder real-agent matrix; not run. Step 1 is taken from A15 step 10 (D68).

Spec §10.2 and the roadmap gate.

**Files:** the founder's evidence notes in `docs/architecture/hooks.md` §4. The agent transcribes
them.

**Interfaces:**
- Consumes: Tasks 14, 15 and 16, on a disposable local-build install.
- Produces: one row per supported §3 row per vendor, each with an observed **effect** and a firing
  record present afterwards.

- [ ] **Step 1: FOUNDER, Claude, disposable `HOME`, real session.** Observe each of these:
  - a planted `curl … |` ⏎ `sh` is **not executed**;
  - a `.env` write is **refused**;
  - a `git push --force` is refused;
  - a type error **prevents stop**, and the second stop is allowed by the loop flag;
  - the formatter **changed the file**;
  - the project-note title **appears in the first turn**;
  - a matching skill rule **appears in context**;
  - a shared-file symlink edit **yields the advisory**.

  `doctor` then reports `plugin_hooks=yes` and `session_start_injection=yes`.
- [ ] **Step 2: FOUNDER, Codex.** Before manual trust, the hooks are observed **not** firing. After
  manual trust, the same effects as Step 1 are observed for each supported row. This replaces the
  mock Responses API observations of D57 (NEW-104) and confirms the Codex cwd-relative resolution
  inside a git repository and the `apply_patch` grammar (`BACKLOG.md` §6, Phase 6 m4).
- [ ] **Step 3: FOUNDER, isolated `ingest` on each vendor** with the product hooks installed: no
  firing record appears and no injected content appears (§6.3). **If either vendor fails, Phase 6
  stops** until the adapter's argv is amended.
- [ ] **Step 4: Agent transcribes** the founder's results into `docs/architecture/hooks.md` §4, and
  lists any `unsupported (<reason>)` row for founder acceptance. Commit that file alone.

After Task 2 and Task 18, tick the roadmap Phase 6, remove A13 from `ORDER.md`, close the matching
`BACKLOG.md` §6 "Phase 6" items and NEW-104, and delete this plan.
