# Developer OS Brain Workflows (A12b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23; see git history.

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

## Founder decisions applied

- **D47 (2026-09-22).** The spec is approved with every recommended answer:
  - Q1-A: note captures, bound to the hash at capture time.
  - Q2-A: map the three roadmap names to the shipped classes, and add `isolated` and `gap`.
  - Q3-A: `retire` and `refactor` apply only outside agent sessions; inside one they run as a dry run and an applied run exits 5.
  - Q4-A: `brain-report` goes to session output only.
  - The spec's own "decided here unless you say otherwise" defaults also apply: `--plugin-dir` for the vendor gate, no `--yes` on the refactor verbs, and `GAP_MIN_NOTES = 3` as a constant.
  - No production release exists. The product runs from a local, unsigned build.
- **D47 lane (Phases 5–7), which extends D44 and its 2026-09-22 amendment.**
  - Each task commit runs `npm run lint` and nothing else. That script is `tsc -b`, then `eslint`, then the repository check, so it builds and typechecks the tests too.
  - Implementers **write** tests but **do not run vitest**. Every run deferred that way is listed in Task 16 Step 2.
  - Fresh-context review is deferred to one whole-phase review at close.
  - Commits are held locally, with no push. At close they go to one branch as one PR.
  - **Accepted risk:** a defect in a consumed interface surfaces only at close, against every task at once.
- **Credit-spending runs are founder stop points.** No agent runs `npm run test:vendor-brain` or any `claude -p` against a real model. Task 13 writes that test; Task 16 stops and asks the founder to run it.

## Global Constraints

- **Per-commit gate (D47).** Run `npm run lint`. It must exit 0 before the commit. Run no `vitest`, no `npm test…` script and no `npm run check` inside a task. A red lint stops that task.
- **No push.** Commit in the task worktree and stop. Only the orchestrator integrates (D33), and it pushes once, at Task 16, to one branch opened as one PR.
- **Staging.** Stage exact paths only. Never use `git add -A`, `git add .` or a wildcard. Confirm with `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** Only the orchestrator edits files there. A new file there needs `git add -f` on its own line, never chained with `&&` into `git commit`, because `git add` exits 1 even for tracked files there.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in tracked documents. Cite a line outside a fenced block only when it exists and stays in range; otherwise name the symbol. Code comments cite symbols, not lines.
- **Comments.** Add a code comment only when it records a non-obvious platform fact, a dated past bug, or a rejected alternative someone would otherwise restore. Do not strip existing comments.
- **Package direction.** `packages/brain` depends on `core` and `security` only and never writes (spec I4). `apps/cli` executes every mutation through `context.executor` (spec I3).
- **Validators stay nine (I5).** `VALIDATOR_IDS` is not extended.
- **Effect vocabulary (I1).** Exactly one verb is added, `capture.writeNote`, and nothing else.
- **Determinism (I6).** Every planner is a pure function of vault bytes, arguments and the injected date. It orders with `compareCanonical`, then `compareRawBytes`.
- **Byte-exact paths.** Paths are stored and compared byte-exact, and screened only at the terminal (`renderPath`, `screenAndCap`).
- **Environment in tests.** In-process command tests use `createCommandFixture(label, { env })`. Its default `env` is `{}`, and no test reads `process.env`. Compiled-binary tests use `tests/helpers/run-cli.ts`, which gives the child no inherited environment. Only the §6.7 cases set an agent marker.
- **Synthetic fixtures only.** Use temporary homes and the `templates/brain` vault that `init` installs. **`templates/brain` itself is not edited** (Plan decision 1).
- **Enumerating tests** assert that their expected set is non-empty before asserting over it.

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

## Task 16: Phase 5b closure (phase close) · M

**Open.** Nothing below has run: canonical-document amendments, the D47-deferred test runs and `npm run check`, the red-first runs against `13eb18e`, the whole-phase review, and the founder's real-vendor gate.

**Founder stops:** Step 3 (only if red-first runs cost more than the founder allows) and Step 5 (real-vendor gate, always).

The orchestrator owns this task. Only it edits `docs/superpowers/`.

**Files:**
- Modify:
  - `docs/architecture/brain.md`: §3 "six lint classes" → eight, §6.4 "without inventing a seventh class", §6.11 add exit 3.
  - `docs/architecture/knowledge-pipeline.md`: §§1, 3, 5, 7, covering P2, note captures and verbatim ingest.
  - `docs/architecture/threat-model.md`: the §5.4 row, verbatim from spec §3.6.
  - `docs/architecture/workflow-schema.md`: §1 "six canonical workflows" → eleven, §5 "fifteen" verbs → sixteen.
  - `docs/migration/instruction-inventory.md`: §7 status column per spec §1.1.
  - `docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md`: drifted `path:line` citations (see Step 1).
  - `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`: Phase 5b checkboxes.
  - `docs/superpowers/ORDER.md` and `docs/superpowers/BACKLOG.md`.
- Create: `docs/releases/compatibility-matrix.md`, if it is still absent.

- [ ] **Step 1: Amend canonical documents**

Apply each amendment above.

Re-locate every line citation the spec and the amended documents make into moved code, and cite the symbol where a line is unstable. Known movers: `ingest.ts:1096`, `ingest.ts:275-281`, `main.ts:531-533`, `validate.ts:401,967,980`, `lint.ts:14`, `build.ts:221-233`, `proposal.ts:129-136`, `context.ts:164`, `context.ts:263-305`.

Create `docs/releases/compatibility-matrix.md` with a header row: workflow, version, vendor, vendor version, date, commit, result, command. DOS-P8 owns the rest of the matrix.

- [ ] **Step 2: Run the full lane D47 deferred**

Tasks 1–15 were committed on lint alone; none of their tests has run. Build first (`npm run build`), then run each deferred check:

- [ ] Task 1 (`85cd3b9`): `npx vitest run --root packages/brain src/lint/lint.test.ts`
- [ ] Task 2 (`838d435`): `npx vitest run --root packages/brain src/capture src/ingest/proposal.test.ts`
- [ ] Task 3 (`04e2289`): `npx vitest run --root packages/brain src/refactor/links.test.ts src/indexes`
- [ ] Task 4 (`d5782fb`): `npx vitest run --root apps/cli src/commands/capture.test.ts src/commands/review.test.ts src/main.test.ts`, plus `npm run test:e2e` (`tests/e2e/knowledge-lifecycle/lifecycle.test.ts` asserts capture and review results)
- [ ] Task 5 (`f53a881`): `npx vitest run --root packages/brain src/ingest/validate.test.ts`
- [ ] Tasks 6 and 9 (`02c2be7`, `71e0c70`, `9eaa3e6`): `npx vitest run --root packages/brain src/refactor`
- [ ] Task 7 (`e15fbdc`): `npx vitest run --root apps/cli src/commands/ingest.test.ts`, plus `npx vitest run tests/security/interruption.test.ts tests/security/malformed-manifest.test.ts`
- [ ] Task 8 (`f1b72c7`): `npx vitest run --root packages/workflow-schema src/vocabulary.test.ts`, then `npx vitest run tests/contracts/workflows tests/contracts/adapters tests/tools` (the render-drift cases live there). A12's plan also regenerates `plugins/claude/**` and `plugins/codex/**` and moves the literal counts in `tests/contracts/adapters/{claude,codex}/generated.test.ts`; if those counts fail, rerun `npm run render:claude` and `npm run render:codex`, rebase the literal counts on the actual rendered numbers, and record both plans' contributions in the comment.
- [ ] Task 10 (`dd5ec23`): `npx vitest run --root apps/cli src/commands/refactor.test.ts src/main.test.ts` and `npx vitest run --root packages/brain src/capture/agent.test.ts`
- [ ] Task 11 (`5be3304`): `npx vitest run tests/security/note-capture.test.ts`
- [ ] Tasks 12 and 14 (`d3cba24`, `4db919f`): `npm run test:e2e`, after `npm run build`. Record each new `tests/e2e/brain-workflows/*` file's duration against the 40-minute `e2e` CI job.
- [ ] Task 15 (`49f84bd`): `npx vitest run tests/security/brain-refactor.test.ts tests/security/interruption.test.ts`
- [ ] Task 13 (`d2c999b`): not run here; it is the founder's real-vendor run in Step 5.

Then the whole lane:

```bash
npm run lint
npm run check
```

`npm run check` includes `npm test`, `npm run test:e2e`, `npm run test:vendor-ingest`, the build and `git diff --check`. It is slow; detach it the way the repository's background-gate note describes. Show failures only.

- [ ] **Step 3: Handle §7.4's "watched failing first"**

No test ran red per task under D47. For each new `tests/security/*` case (`tests/security/note-capture.test.ts`, `tests/security/brain-refactor.test.ts`, and the new `describe("a brain refactor interrupted at every forward phase")` in `tests/security/interruption.test.ts`), prove it fails for the stated reason by running it once against the phase's base commit plus only the test file. Use a scratch worktree at `13eb18e` with the file copied in, then `npm run build` and `npx vitest run <file>`. The cases assert exact exit code and `kind`, because on the base commit `--note` is an unknown option and the refactor verbs are unknown commands (usage, exit 2). Record each red reason in the PR body. **Founder stop:** if that costs more than the founder allows, stop and ask. The fallback is to record the deviation as an accepted D47 risk in the roadmap.

- [ ] **Step 4: Fresh-context whole-phase review**

Dispatch `superpowers:requesting-code-review` to an agent that authored no Phase 5b task, over `13eb18e..HEAD`. Every accepted finding gets a failing regression test first, then the fix, then `npm run lint`. Rerun only the suites the fixes touch, then `npm run check` once more. The review specifically covers:
- anything touching `capture`, `ingest` or the executor, as a security change (`security.md` SEC-105);
- `git status` and `git diff` compared with the commits.

- [ ] **Step 5: Founder stop: the real-vendor gate**

**Founder stop.** No agent runs this; it spends the founder's credits. Ask the founder to confirm Plan decision 9, which covers the API key variable and the exclusion from `check`, and to run:

```bash
npm run build
DEVELOPER_OS_VENDOR_BRAIN_API_KEY=<key> npm run test:vendor-brain
```

Copy `$TMPDIR/brain-vendor-rows.json` into five rows of `docs/releases/compatibility-matrix.md`. The phase gate needs `pass` on Claude for all five. Codex is not required (spec §7.3, NEW-61).

- [ ] **Step 6: Bookkeeping, branch and PR**

1. Tick the roadmap's two Phase 5b checkboxes.
2. Remove A12b from `ORDER.md` once the gate evidence is committed.
3. Record in `BACKLOG.md` every spec gap this plan's Plan decisions resolved, plus residuals R1, R2 and R8, plus the R3 extension: a `--note` capture whose normalized text equals an existing plain capture returns `duplicate: true` with that capture's id and keeps that capture's envelope.
4. Then run:

```bash
git add docs/architecture/brain.md docs/architecture/knowledge-pipeline.md docs/architecture/threat-model.md docs/architecture/workflow-schema.md docs/migration/instruction-inventory.md docs/releases/compatibility-matrix.md
git add -f docs/superpowers/specs/2026-09-22-developer-os-brain-workflows-design.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-09-22-developer-os-brain-workflows.md
git diff --cached --name-only
git commit -m "docs: close Phase 5b (A12b brain workflows)"
```

Push the phase branch once and open one PR, as plan 1a's closure did (`#14`). Never merge.
