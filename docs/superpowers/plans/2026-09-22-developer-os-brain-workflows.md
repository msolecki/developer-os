# Developer OS Brain Workflows (A12b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23 and 2026-09-26; see git history.

**Remaining:** Task 16 Step 5, the founder's real-vendor gate, and one repository chore: record the
Plan decisions below and the spec's §8 residuals in their canonical documents before this plan and
the spec are deleted. Tasks 1–15 are committed; the rest of Task 16 ran (canonical-document
amendments, `docs/releases/compatibility-matrix.md` header, full suite green on `bc17550`, whole-phase
review, PR #15).

**Goal:** Ship roadmap Phase 5b. That means five Brain workflows rendered for both vendors, note captures with verbatim ingest, the `isolated` and `gap` lint classes, and the `brain retire` and `brain refactor` verbs. Each workflow is proven end to end on a synthetic vault with a fake vendor.

**Architecture:** The spec allows three mutation paths and no others.
- **P1** is the shipped plain capture: a capture that a model then ingests.
- **P2** is a new note capture. `ingest` applies it verbatim, with no model call, as a `create`, or as a `replace` bound to the hash recorded at capture time.
- **P3** is `brain retire` and `brain refactor`, which a person runs.

`packages/brain` stays write-free. It supplies the envelope field, the lint classes, the link resolver and the refactor planners, which return bytes and mutation lists. `apps/cli` executes those through `context.executor`. The workflows are YAML contracts that the existing renderers turn into `SKILL.md` trees.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25, `yaml`, Vitest 4.1, the existing Foundation `TransactionExecutor`, `@developer-os/workflow-schema` and the adapter renderers.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`, approved by D47 with every recommended answer (Q1-A, Q2-A, Q3-A and Q4-A). Read it beside this plan. Where the two disagree on a detail that the spec leaves open, this plan's **Plan decisions** section records the choice.

**Roadmap:** Phase 5b of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`. The gate: each workflow is proven end to end on the synthetic vault with a fake vendor, and once with a real vendor in the compatibility matrix.

---

## Constraints the open work depends on

- **Credit-spending runs are founder stop points.** No agent runs `npm run test:vendor-brain` or any
  `claude -p` against a real model.
- **Synthetic fixtures only.** Use temporary homes and the `templates/brain` vault that `init`
  installs; `templates/brain` itself is not edited (Plan decision 1).
- **Staging.** Exact paths only; `docs/superpowers/` needs `git add -f` on its own line.

## Plan decisions

These are choices where the spec is silent or its wording conflicts with the codebase. Each is reported to the founder as a spec gap.

1. **The garden fixture is planted per test, and the template is not extended.** `templates/brain` is what `init` ships to every user, and `apps/cli/src/commands/brain-template.test.ts` pins it byte for byte. Its INFRA and PROJECTS example notes are already isolated. The e2e tests create the three-note tag after `init`, inside their own temporary vault.
2. **`capture --note` refusal codes**, which the spec does not name:
   - `capture_note_invalid` (exit 2) covers these cases: a bad path string, a note that does not parse, a note over 64 KiB, and a destination that exists but is not a canonical note.
   - `capture_note_path_refused` (exit 5) covers these cases: a destination outside a configured topic folder, one under a private folder or the indexes directory, and one reached through a symlink.
3. **`note_changed_since_capture` surfaces in a new `reason` field.** It is added to each per-capture refusal (`RefusedCaptureV1`, and the `refused[]` entries of `RunReportV1`), typed `"note_changed_since_capture" | null`. Today those entries carry only a numeric `code`. The change is additive.
4. **`IngestResultV1.agent` and `RunReportV1.agent` widen to `AgentName | null`.** They are `null` when every selected capture is a note capture, so that no vendor was resolved. The widening is additive for readers that already branch on the value.
5. **Refactor mode flags are boolean options**, and the spec's two refusals are both kept:
   - As string options, `parseArgs` would consume the note path as the flag's value.
   - Zero mode flags, or two, is a **parse** refusal (usage, `invalid_input`, exit 2), as §6.1 says.
   - Every other §6.9 input fault is `brain_refactor_input_invalid`, exit 2.
6. **The second transaction of retire and refactor is named `brain-refactor-reindex`.** It is the same kind for both verbs. The spec names only the first transaction's kind.
7. **`review` rows also gain `redactionCount`.** The human line the spec asks for prints that count, so the row has to carry it. The change is additive.
8. **`brain-garden`'s prose names `brain refactor` and `brain retire`**, and those verbs land in Task 10, after the workflows land in Task 8. Nothing is released between the two (D47), and the garden e2e test (Task 14) waits for Task 10.
9. **The real-vendor test needs an API key it is handed.** A disposable `HOME` carries no Claude credentials. The test therefore runs only when both `claude` and `DEVELOPER_OS_VENDOR_BRAIN_API_KEY` are present, and passes that key as `ANTHROPIC_API_KEY` into the isolated environment. `test:vendor-brain` is excluded from `test:suite` and is **not** added to `check`. The founder confirms this at the Task 16 stop.

10. **A note that another note cites in `sources` cannot be renamed, moved or merged.** No frontmatter is ever edited (§6.3), so a referrer's `sources` entry would stop resolving. That surfaces as a new `provenance` error, and §6.5's post-condition 2 refuses the refactor with `refactor_postcondition_failed`. The refusal is fail-closed and follows from the spec, and Task 6 pins it. It is still reported as a gap, because it goes beyond R6.


---

## Task 16 remainder

- [ ] **Step 5: FOUNDER STOP, the real-vendor gate.** No agent runs this; it spends the founder's
  credits. The founder confirms Plan decision 9 (the API key variable and the exclusion from
  `check`) and runs:

```bash
npm run build
DEVELOPER_OS_VENDOR_BRAIN_API_KEY=<key> npm run test:vendor-brain
```

  Copy `$TMPDIR/brain-vendor-rows.json` into five rows of `docs/releases/compatibility-matrix.md`.
  The phase gate needs `pass` on Claude for all five. Codex is not required (spec §7.3, NEW-61).
- [ ] **Step 6 (repository chore):** move Plan decisions 1–10 above and the spec's §8 residuals R1–R8,
  with the R3 extension (a `--note` capture whose normalized text equals an existing plain capture
  returns `duplicate: true` with that capture's id and keeps that capture's envelope), into
  `docs/architecture/brain.md` or `knowledge-pipeline.md`; the §6 "Phase 5b" items stay in
  `BACKLOG.md`. Then tick the roadmap Phase 5b, remove A12b from `ORDER.md` and delete this plan.
