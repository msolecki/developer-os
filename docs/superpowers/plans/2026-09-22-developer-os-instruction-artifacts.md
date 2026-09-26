# Developer OS Managed Instruction Artifacts (A12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23 and 2026-09-26; see git history.

**Remaining:** three founder stop points — Task 2 Step 3 (billed row, then emptying
`UNPROVEN_CLAUDE_CATEGORIES`), Task 21 Step 4 (real-vendor tests) and the founder-local
`--patterns` scan. The §11 spec amendments, NEW-108 and the inventory status flip were applied on
2026-09-26.
Tasks 1–28 are committed and the phase close ran: full suite green on `bc17550` (the agent scan
included), the whole-phase review, PR #15.

**Goal:** Install, drift-check, reconcile and uninstall every instruction artifact in
`docs/migration/instruction-inventory.md` on both vendors from a local unsigned build, with `doctor`
naming each artifact as `default` or `user`.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-instruction-artifacts-design.md`, approved
2026-09-22 (D47). Q1 = local unsigned build only (`trust: "unsigned-local"`).

**Roadmap:** Phase 5 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: all inventoried artifacts install, drift-check and uninstall on both vendors; `doctor` names
each as `default` or `user`. Backlog rows owned: A12, NEW-60, NEW-61, NEW-65.

---

## Constraints the open work depends on

- **D46.** Release signing keys are dropped; `LAUNCHER_OFFLINE_RELEASE_ROOTS` stays `[]`; nothing
  here compiles a key or wires the FD 3 handoff.
- **Founder stop points.** Any command that spends model credits, reaches a model or the network,
  needs a vendor login, or reads or writes the live `~/.claude`, `~/.codex`, `~/.developer-os` or a
  real Brain is **not an agent step**. It is marked **FOUNDER STOP** and the task halts there and
  reports. Vendor CLIs may be run by an agent only with `HOME`, `CODEX_HOME` and `XDG_CONFIG_HOME`
  pointing into a fresh `mktemp -d` directory and `CLAUDE_CONFIG_DIR` unset.
- **Clean room (spec §3.3, `docs/migration/exclusion-policy.md`).** No agent reads the legacy
  shared-rules directory, the legacy vault, `~/.claude`, any frozen-source environment path (prefix
  in `tests/repository/self-containment.ts`) or the legacy runtime. This repository is public.
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with
  `git diff --cached --name-only` before committing. Files under `docs/superpowers/` need `git add -f`.
- **Invariant 3 gate.** Categories whose Claude loading only the billed row can prove (`rule`,
  `scoped-rule`, `output-style`) are held back by `UNPROVEN_CLAUDE_CATEGORIES`. Emptying it is a
  founder decision after Task 2 Step 3 passes. **The phase gate ("all inventoried artifacts
  install") cannot close until it is empty.**

---

### Task 2 Step 3: Billed real-agent row (spec §10.2 "real agent") · FOUNDER STOP

Unbilled rows landed in `e498614` (re-pinned by D48, `29e8c36`; findings NEW-101..103, `b1c2f68`).
Owed: this row (NEW-101).

- [ ] **FOUNDER STOP — one paid Claude session.** For every mechanism the unbilled rows could not
  prove (expected: `rule`, `scoped-rule`, `output-style` on Claude), the founder runs one Claude
  session in a disposable home proving the text reached the model, and records it in the
  compatibility matrix (`docs/architecture/claude-adapter.md`, "Observed for A12" section). Until
  that row passes, the category is not installed (invariant 3). If a §4 row's loading proof fails,
  the plan **stops for a founder decision**; it is never downgraded to `unsupported-vendor`.

### Task 21 Step 4: Real-vendor loading and isolation tests · FOUNDER STOP

The Claude, Codex and isolation assertions landed in `084f1ba` (with `7b4a6aa`; NEW-102's Codex
isolation per D52, `5afa493`).

- [ ] **FOUNDER STOP:** run
  `npx vitest run tests/integration/claude tests/integration/codex tests/integration/ingest/instruction-isolation.test.ts`.
  This includes the Claude isolation observation (NEW-103) and the Codex re-observation (NEW-102);
  both stay open until it runs. An isolation failure stops the phase (D8 outranks A12).

### Tasks 22–25 Step 3: Founder-local private-pattern scan · FOUNDER STOP

The scan without a pattern file is `tests/repository/instruction-defaults.test.ts` over
`instructions/` and `templates/project/`, green in the full suite on `bc17550`. This stop also covers
A14 Task 15 Step 4.

- [ ] **FOUNDER STOP:** `npm run build && node tests/dist/tools/scan-instruction-defaults.js --patterns <private-file>`
  over `instructions/` and `templates/project/` (the file lives outside the repository and is never
  committed). Report the finding count only; a finding is fixed with `npm run lint` and exact-path
  staging of the changed `instructions/` files.

### Task 29 remainder

- [ ] **Step 3b (FOUNDER DECISION):** once the billed row passes, empty `UNPROVEN_CLAUDE_CATEGORIES`
  (one-line commit, `npm run lint`), and drop the Claude hold-back from the §1 and §2 statuses of
  `docs/migration/instruction-inventory.md` in the same commit. The phase gate does not close before
  this.
- [ ] **Step 5:** when Task 2 Step 3 and Task 21 Step 4 pass, close NEW-101, NEW-102, NEW-103 and
  NEW-65 and the loading half of NEW-61 in `BACKLOG.md`, tick the roadmap Phase 5 rows, remove A12
  from `ORDER.md` and delete this plan.
