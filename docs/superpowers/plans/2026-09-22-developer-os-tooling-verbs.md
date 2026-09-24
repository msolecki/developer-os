# Developer OS Tooling Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23; see git history (full plan as of `cb99d55`).

**Open:** the rest of Task 15 (founder-local scan and review) and Task 16 (phase close, which runs
every deferred suite). Task 14's observations were recorded on 2026-09-23 under D57 (`4041286`); its
body was deleted on 2026-09-24 and its test (`observations.test.ts`) is in Task 16 Step 1.

**Goal:** Ship A14 (roadmap Phase 7). The work is `developer-os import [<path>] | --claude-memory`,
`developer-os project init|check [<dir>]` and the `doctor` check `vendor-config`, plus the recorded
refusals of `repo audit|bootstrap|secrets-scan` and `project worktree`. After it, every script in
inventory §5 is a verb or a recorded refusal.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-tooling-verbs-design.md`, approved
2026-09-22 (D47) with every recommended answer: Q1 A, Q2 A, Q3 A, Q4 A and Q5 A. **Nothing
conditional on Q5 C is built.**

**Roadmap:** Phase 7 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: every inventoried script is a verb or a recorded refusal. Plan base: `13eb18e`.

---

## Founder decisions applied

- **D47 (2026-09-22).** The spec is approved with every recommended answer. Its consequences here:
  - A12 Q1 means no production. The product runs from a local, unsigned build only, and nothing
    here touches release, signing or install sources.
  - **The D44 lane applies to Phase 7.** Implementers write tests but **do not run vitest**. The only
    per-task gate is `npm run lint`. Every test, fast or slow, and the fresh-context review run once,
    at phase close (Task 16). Nothing is pushed per task. Task 16 opens one PR.

## Global Constraints

- **Lane (D47, D44).** Each task runs `npm run lint` and nothing else before its commit. `npm run
  lint` is `tsc -b`, then `eslint .`, then `node tests/dist/repository/check.js`. **Do not run
  `npx vitest`, `npm test` or `npm run check` in a task.** Every "Run" step in this plan reads
  "deferred to phase close (D47)", and Task 16 runs them.
  - This supersedes `SESSION.md` §5 step 1's filtered red-then-green runs (D32) and the per-task
    reviewer of §4.1 for this plan.
  - Tests are still written first, and they must compile, because `tsc -b` covers every `*.test.ts`.
  - Accepted risk (D36's): a defect in a consumed interface surfaces only at phase close.
- **Commits.** Implementers commit code and tests only, in their own worktree. They never edit
  `docs/superpowers/`, never push and never merge. The orchestrator integrates by cherry-pick, ticks
  steps here and rewrites the `ORDER.md` progress line. Stage exact paths only, never `git add -A`,
  `.` or a wildcard. Confirm with `git diff --cached --name-only`.
- **`docs/superpowers/` is globally gitignored.** New files there need `git add -f`, and `git add`
  of those paths exits 1 even for tracked files. Put that `git add -f` on its own line, and never
  chain it with `&&` into `git commit`.
- **Worktrees.** Each implementer works in `../developer-os.worktrees/<task>`. After Task 6 lands,
  every new worktree runs `npm run link:tests` once before any `tests/` suite. This is NEW-98's
  close.
- **Self-containment lint** (`tests/repository/self-containment.ts`). No file outside its allowlist
  may contain the legacy-runtime names it forbids. Watch the "home + brain" pattern in particular:
  `userHome`, `home` or `homedir()` followed within 40 characters by a quoted `brain` path segment.
  In tests, name the vault through `fixture.paths.brain`, never a literal next to `userHome`.
- **Stat identity rule** (`tests/repository/check.ts`). A non-test `.ts` file that mentions `dev` or
  `ino` must call `lstat`, `stat` and `fstat` with `{ bigint: true }`. Task 3's reader does so. No
  task in this plan appends to `STAT_OPTION_EXEMPT`.
- **Fixtures are synthetic only.** Use temporary homes, synthetic inboxes and synthetic
  memory trees, and `SENTINEL` from `tests/security/helpers.ts`. Every enumerating test asserts its
  expected set is non-empty **before** it asserts properties over the set.
- **Comments.** Add a code comment only for a non-obvious platform fact, a dated past bug or a
  rejected alternative. Do not strip existing comments.
- **Public repository.** No client, person, machine path or private note appears in any file,
  fixture or template.

## Scope decisions still in force

1. **An empty template set is a new refusal.** `project init` refuses exit 4 with
   `project_templates_unavailable` while `PROJECT_TEMPLATE` is empty. That holds until Task 15
   lands A12-procedure content. Keeping the mechanism and the content apart is what lets Tasks 8
   and 9 ship before A12's prose exists.
2. **Placing the vendor syntax.**
   - Spec §8 puts `VENDOR_CONFIG_REFERENCE_DENY` in `packages/security`.
   - This plan keeps only the **product rule IDs** there: `PROTECTED_PATH_RULES`, the single source
     `ProtectedPathPolicy` now reads.
   - The **observed Claude rule strings** go in `packages/adapter-claude` as `CLAUDE_DENY_RULES`,
     beside `CLAUDE_MEMORY_LAYOUT`, because both are observations of the same vendor version.
   - Recorded deviation: a vendor's syntax does not belong in the vendor-neutral security package,
     and the "no second list" property still holds because the IDs are derived.
3. **`vendor-config` before observation.** §8 does not say what the check does while
   `CLAUDE_DENY_RULES` is `null`, and a `doctor` check cannot exit 4. It returns `warn` "the Claude
   deny-rule syntax has not been observed for this product; nothing was compared", and it reads
   nothing.

---

### Task 15: Project template content through A12's redaction procedure · M (remainder) — **FOUNDER STOP POINT**

**Partial 2026-09-22, `10282ab`**: templates, `PROJECT_TEMPLATE`, `project-template.test.ts` and the
`instruction-defaults.test.ts` scan root landed (agent scan 0 findings without a pattern file).
Owed: the founder-local `--patterns` scan and an independent content review.

- [ ] **Step 4: Founder-local scan and review.** The founder runs
  `node tests/dist/tools/scan-instruction-defaults.js --patterns <private file>` over
  `templates/project/`. The commit message records the finding count (zero) and the command, never
  the pattern file. An independent reviewer reads the files before staging (A12 §3.3).
  **Status:** Owed: founder-local `--patterns` scan; independent review not recorded.

The tests run at phase close (Task 16 Step 1).

---

### Task 16: Phase 7 close · M (orchestrator + founder)

**Open.** Nothing below has run.

**Files:**
- Modify: `docs/migration/instruction-inventory.md` (A14 rows: `planned` → `shipped`)
- Modify: `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`, the roadmap (Phase 7 tick), this plan (ticks)

**Interfaces:**
- Consumes: every task above.

- [ ] **Step 1 (FOUNDER): The founder runs the deferred suites once, on the integrated tree** (D47). Record
  only the failures:

```bash
npm run link:tests
npm run check
npx vitest run --root apps/cli src/main.test.ts src/commands/untrusted-file.test.ts src/commands/quarantine.test.ts src/commands/capture.test.ts src/commands/import.test.ts src/commands/project-init.test.ts src/commands/project-check.test.ts src/commands/project-template.test.ts src/commands/vendor-config.test.ts src/commands/doctor.test.ts
npx vitest run --root packages/security src/protected-paths.test.ts src/index.test.ts
npx vitest run --root packages/brain src/capture/build.test.ts
npx vitest run --root packages/adapter-claude src/observations.test.ts src/index.test.ts
npm run build && npx vitest run --root tests repository/workspace-links.test.ts repository/redactor-entry.test.ts repository/transcript-path.test.ts repository/instruction-defaults.test.ts security/sentinel.test.ts security/interruption.test.ts security/network.test.ts e2e/import.test.ts e2e/foundation.test.ts
```

`npm run check` already includes the others. They are listed so that a red `check` can be bisected
per file. They replace the per-task "Run the tests" steps of Tasks 2–13 and 15, all deferred here
(D47).

- [ ] **Step 2: One fresh-context review** of the whole diff since this plan's base (`13eb18e`), by an agent
  that authored none of Tasks 2–15 (`superpowers:requesting-code-review`). Give it the spec, this
  plan as of `cb99d55` (before pruning) and the diff. Every accepted finding gets a failing regression test first, then the smallest
  correction, then `npm run lint`. Rerun the affected files from Step 1.
- [ ] **Step 3: Re-read the §2 gate.** Every inventory §5 row and the three §6 template rows are
  `shipped` or `refused (D47)`. Task 1's grep again finds only refusal text:

```bash
grep -nE 'repo (audit|bootstrap|secrets-scan)|project worktree|git-history-secrets|repo-audit|repo-bootstrap|repo-baseline' \
  docs/migration/instruction-inventory.md docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md \
  docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md
```

- [ ] **Step 4: Stop conditions (founder).**
  - If Task 15 did not land, `project init` still refuses exit 4. Ask whether that satisfies the
    Phase 7 gate or whether the phase stays open. Do not decide it.
- [ ] **Step 5: Bookkeeping.** Tick the roadmap's Phase 7, remove A14 from `ORDER.md`'s open
  entries and advance `NOW`, close NEW-98 and NEW-109 in `BACKLOG.md`, and flip the inventory rows. Then push
  one branch and open **one PR** (D44/D47). Do not merge; the founder merges.

```bash
npm run lint
git add docs/migration/instruction-inventory.md
git add -f docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/plans/2026-09-22-developer-os-tooling-verbs.md
git diff --cached --name-only
git commit -m "docs: close roadmap Phase 7 (A14)"
```

