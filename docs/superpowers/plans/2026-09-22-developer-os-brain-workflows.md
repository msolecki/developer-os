# Developer OS Brain Workflows (A12b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23 and 2026-09-26; see git history.

**Remaining:** Task 16 Step 5, the founder's real-vendor gate. The plan decisions and the spec's §8
residuals were moved to `docs/architecture/brain.md` §6.13 on 2026-09-26. Tasks 1–15 are committed; the rest of Task 16 ran (canonical-document
amendments, `docs/releases/compatibility-matrix.md` header, full suite green on `bc17550`, whole-phase
review, PR #15).

**Goal:** Ship roadmap Phase 5b. That means five Brain workflows rendered for both vendors, note captures with verbatim ingest, the `isolated` and `gap` lint classes, and the `brain retire` and `brain refactor` verbs. Each workflow is proven end to end on a synthetic vault with a fake vendor.

**Architecture:** The spec allows three mutation paths and no others.
- **P1** is the shipped plain capture: a capture that a model then ingests.
- **P2** is a new note capture. `ingest` applies it verbatim, with no model call, as a `create`, or as a `replace` bound to the hash recorded at capture time.
- **P3** is `brain retire` and `brain refactor`, which a person runs.

`packages/brain` stays write-free. It supplies the envelope field, the lint classes, the link resolver and the refactor planners, which return bytes and mutation lists. `apps/cli` executes those through `context.executor`. The workflows are YAML contracts that the existing renderers turn into `SKILL.md` trees.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25, `yaml`, Vitest 4.1, the existing Foundation `TransactionExecutor`, `@developer-os/workflow-schema` and the adapter renderers.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`, approved by D47 with every recommended answer (Q1-A, Q2-A, Q3-A and Q4-A). Read it beside this plan. Where the two disagree on a detail that the spec leaves open, `docs/architecture/brain.md` §6.13 records the choice.

**Roadmap:** Phase 5b of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`. The gate: each workflow is proven end to end on the synthetic vault with a fake vendor, and once with a real vendor in the compatibility matrix.

---

## Constraints the open work depends on

- **Credit-spending runs are founder stop points.** No agent runs `npm run test:vendor-brain` or any
  `claude -p` against a real model.
- **Synthetic fixtures only.** Use temporary homes and the `templates/brain` vault that `init`
  installs; `templates/brain` itself is not edited (`brain.md` §6.13 decision 1).
- **Staging.** Exact paths only; `docs/superpowers/` needs `git add -f` on its own line.

## Task 16 remainder

- [ ] **Step 5: FOUNDER STOP, the real-vendor gate.** No agent runs this; it spends the founder's
  credits. The founder confirms `brain.md` §6.13 decision 9 (the API key variable and the exclusion
  from `check`) and runs:

```bash
npm run build
DEVELOPER_OS_VENDOR_BRAIN_API_KEY=<key> npm run test:vendor-brain
```

  Copy `$TMPDIR/brain-vendor-rows.json` into five rows of `docs/releases/compatibility-matrix.md`.
  The phase gate needs `pass` on Claude for all five. Codex is not required (spec §7.3, NEW-61).
- [ ] **Step 6:** after Step 5 passes, tick the roadmap Phase 5b, remove A12b from `ORDER.md` and
  delete this plan; the §6 "Phase 5b" items stay in `BACKLOG.md`.
