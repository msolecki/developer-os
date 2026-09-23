# Developer OS Tooling Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks:** 16. Tasks 1–13 and 15–16 are agent or orchestrator work. Task 14 is a **founder observation
stop point**: the agent only records what the founder observed. Task 15 waits on A12's content
procedure. Neither blocks the other tasks, and both verbs they complete stay safe while they are
open: `--claude-memory` refuses exit 4, `vendor-config` warns, and `project init` refuses exit 4.

**Goal:** Ship A14 (roadmap Phase 7). The work is `developer-os import [<path>] | --claude-memory`,
`developer-os project init|check [<dir>]` and the `doctor` check `vendor-config`, plus the recorded
refusals of `repo audit|bootstrap|secrets-scan` and `project worktree`. After it, every script in
inventory §5 is a verb or a recorded refusal.

**Architecture:** Four surfaces share one rule set:

- A bounded reader for untrusted files (`apps/cli/src/commands/untrusted-file.ts`).
- One quarantine seam taken out of `capture` (`apps/cli/src/commands/quarantine.ts`).
- The existing `createRedactor` entry.

`import` feeds `buildCapture` unchanged and writes one Foundation `create` transaction per new
capture through `context.executor`, which is already plan 1a's mutation gate. `project init` writes
one create-only transaction into the target directory. `project check` and `vendor-config` read and
never write. Vendor facts live as `null`-until-observed rows in `packages/adapter-claude`, and each
verb refuses or warns while its row is `null`.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25 built-ins, Vitest 4.1, and the
existing `TransactionExecutor` behind `createGatedTransactionExecutor`, `validateChangePlan`,
`ProtectedPathPolicy`, `buildCapture` and `createRedactor`.

**Spec:** `docs/superpowers/specs/2026-09-22-developer-os-tooling-verbs-design.md`, approved
2026-09-22 (D47) with every recommended answer: Q1 A, Q2 A, Q3 A, Q4 A and Q5 A. **Nothing
conditional on Q5 C is built.** That excludes §5.4.1, `archivedTo`, `import_archive_collision`,
`import_source_changed`, the Q5 C rows of §10 and §13 item 1. `_raw/processed/` stays untouched by
every verb.

**Roadmap:** Phase 7 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.
Gate: every inventoried script is a verb or a recorded refusal.

---

## Founder decisions applied

- **D47 (2026-09-22).** The spec is approved with every recommended answer. Its consequences here:
  - A12 Q1 means no production. The product runs from a local, unsigned build only, and nothing
    here touches release, signing or install sources.
  - **Spec 1 §1 holds.** `import` and `ingest` stay manual and are removed from Phase 9's registry
    (Task 1 amends the roadmap and the inventory). Phase 9's registry stays Spec 1 §5.1's four jobs.
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
- **Exit codes** are `EXIT_CODES` from `@developer-os/core`: 1 operational, 2 invalid input,
  3 decision required, 4 capability unavailable, 5 security refusal, 6 recovery required. A batch
  exits with the most severe per-item code in the order 6, 5, 4, 3, 2, 1 (`doctor`'s
  `EXIT_PRECEDENCE`). This plan adds no exit class.
- **Paths are made absolute against an injected `cwd`, before any guard sees them.**
  `ProtectedPathPolicy` resolves a *relative* path against the user home, not the working
  directory. Every positional and every default directory therefore goes through
  `resolve(dependencies.cwd(), value)` first. This follows `CaptureDependencies.cwd` in
  `capture.ts`.
- **Reading untrusted files** (spec §4.2) goes only through Task 3's `readUntrustedText`. No verb
  opens user, vault, vendor or override files any other way.
- **Redaction** (spec §4.3) is only `createRedactor(key, { userPatterns })`, bound once per command.
  - `import` loads its key with `loadOrCreateRedactionKey`.
  - `import --dry-run`, `project init` and `project check` use `readRedactionKey(stateDir)`, falling
    back to an ephemeral `randomBytes(32)`. They **never create a key.** For `project init` that is
    a recorded decision, because §4.3 is silent on it: redaction there only decides whether a
    finding exists, and the dry-run row forbids creating a key.
  - Fingerprints are never printed.
- **No new network capability and no new spawn.** No task adds a `ProcessRunner` call, and
  `tests/security/network.test.ts`'s classified set is unchanged.
- **No transcript is read.** `tests/repository/transcript-path.test.ts` scans `apps/`, `packages/`
  and `tests/` for the field name that joins `transcript` and `path` with an underscore. **Never
  write that token in code or tests.** Build it at runtime if a test needs it; this plan's tests do
  not.
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
- **Bounds (spec §4.4)** are exported constants, and tests pin each one at the bound and one past
  it:

  | Constant | Value | Where |
  |---|---|---|
  | `MAX_CAPTURE_INPUT_BYTES` (reused) | 65,536 | `capture.ts` |
  | `IMPORT_MAX_ENTRIES_WALKED` | 10,000 | `import.ts` |
  | `IMPORT_MAX_DEPTH` | 16 | `import.ts` |
  | `IMPORT_MAX_FILES_PER_RUN` | 1,000 | `import.ts` |
  | `IMPORT_MAX_MEMORY_PROJECTS` | 1,000 | `import.ts` |
  | `PROJECT_TEMPLATE_MAX_BYTES` | 65,536 | `project-template.ts` |
  | `PROJECT_TEMPLATE_MAX_FILES` | 8 | `project-template.ts` |
  | `PROJECT_CHECK_MAX_READ_BYTES` | 1,048,576 | `project-check.ts` |
  | `PROJECT_INSTRUCTION_WARN_BYTES` | 40,000 | `project-check.ts` |
  | `VENDOR_SETTINGS_MAX_BYTES` | 1,048,576 | `vendor-config.ts` |

## Scope decisions

1. **Refusals are text, not code.** `repo audit`, `repo bootstrap`, `repo secrets-scan` and
   `project worktree` get no dispatch entry. An unknown command is already exit 2. Task 1 records
   each refusal in the inventory (spec §9).
2. **NEW-98 is closed by Task 6**, a repository script plus a pin test (Q3 A). It needs no product
   verb.
3. **`import_path_conflict` is the usage failure.** `--claude-memory` with a `<path>` is rejected in
   `parse`, like every other argv error. It publishes kind `invalid_input` with the usage block,
   exit 2, and not the named reason. Task 2's matrix pins exit 2 and the usage text, as plan 1a's
   `config` correction did.
4. **The not-implemented stubs are new refusals.** From Task 2 until each verb's task lands,
   `import`, `project init` and `project check` exit 4 with kind `not_implemented`. The spec's
   step 2 asks for this.
5. **An empty template set is a new refusal.** `project init` refuses exit 4 with
   `project_templates_unavailable` while `PROJECT_TEMPLATE` is empty. That holds until Task 15
   lands A12-procedure content. Keeping the mechanism and the content apart is what lets Tasks 8
   and 9 ship before A12's prose exists.
6. **Placing the vendor syntax.**
   - Spec §8 puts `VENDOR_CONFIG_REFERENCE_DENY` in `packages/security`.
   - This plan keeps only the **product rule IDs** there: `PROTECTED_PATH_RULES`, the single source
     `ProtectedPathPolicy` now reads.
   - The **observed Claude rule strings** go in `packages/adapter-claude` as `CLAUDE_DENY_RULES`,
     beside `CLAUDE_MEMORY_LAYOUT`, because both are observations of the same vendor version.
   - Recorded deviation: a vendor's syntax does not belong in the vendor-neutral security package,
     and the "no second list" property still holds because the IDs are derived.
7. **`vendor-config` before observation.** §8 does not say what the check does while
   `CLAUDE_DENY_RULES` is `null`, and a `doctor` check cannot exit 4. It returns `warn` "the Claude
   deny-rule syntax has not been observed for this product; nothing was compared", and it reads
   nothing.
8. **Run-level and per-file refusals in `import`.** A per-file refusal is exactly one of:
   - an `UntrustedFileRefusal` (Task 3);
   - the empty-content refusal;
   - a symlink entry found during the walk.

   **Anything else thrown while a file is processed stops the run**, with that error's exit code
   (`exitCodeOf`). That includes the mutation gate's `LifecycleMutationRefusal`,
   `LifecycleRecoveryRequiredError`, `LifecycleInfeasiblePlanError` (capacity), a
   `LifecycleLock*Error`, a `SecurityRefusalError` from `validateChangePlan`, and executor
   failures. Files already finalized stay finalized, and every unprocessed accepted file counts in
   `remaining`.
8b. **`import_source_protected` is a run-level refusal in practice.**
    - Spec §5.6 scopes it per file.
    - Every protected rule names a dot segment, and the walk skips dot entries, so only a protected
      **root** can reach the policy. The refusal therefore fires on the root, before any listing.
    - The per-file mapping in `processCandidates` stays as defence in depth.
9. **`remaining`** is the number of accepted files that are not duplicates and were not processed
   this run.
   - After the per-run cap is reached, every further accepted file is **probed** (read, then build,
     then the duplicate check, with no write). The ones that are not duplicates, including ones
     whose read would refuse, count as `remaining`.
   - A dry run with no key cannot detect duplicates, so it counts every accepted file after the cap.
   - After a run-stopping error, nothing is probed: every accepted file not yet processed counts.
10. **Memory paths in output.** A memory file's reported `path` is
    `<projectFingerprint>/<file name>`. `projectFingerprint` is `fingerprintDirectory` of the vendor
    project-directory name. The vendor names those directories after the user's project paths,
    which would put client names into `--json` (spec §5.3's "no decoded vendor name" rule, extended
    to output).
11. **`project check` scans** the names `AGENTS.md` and `CLAUDE.md` plus every `PROJECT_TEMPLATE`
    name, as a set. A file over the 1 MiB bound makes `instruction-secrets` fail with exit 1. A
    secret finding fails it with exit 5. When both happen, exit 5 wins by precedence. §7 names no
    check id for the over-bound read.
12. **The sentinel walk excludes the planted source.** Under Q5 A the inbox source holding the
    sentinel stays in the vault, so a literal "sentinel nowhere in the vault" cannot hold. Task 11's
    walk skips exactly the planted source path, and it asserts that the file is byte-identical to
    what the test wrote.
13. **§12 step 3's red-first sentinel is moot under D47.** Task 11 writes it after import exists,
    and it first runs at phase close.

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Dispatch | `apps/cli/src/main.ts`, `apps/cli/src/main.test.ts` | `import`, the `project` group, `--claude-memory`, usage text |
| Untrusted reads | `apps/cli/src/commands/untrusted-file.ts` (+ test) | spec §4.2, the only reader for user, vault, vendor and override files |
| Protected names | `packages/security/src/protected-paths.ts` (+ test), `packages/security/src/index.ts` (+ `index.test.ts`) | `PROTECTED_PATH_RULES` as the single source; `O_NONBLOCK` on open |
| Quarantine seam | `apps/cli/src/commands/quarantine.ts` (+ test), `apps/cli/src/commands/capture.ts` | root proof, duplicate probe, guarded quarantine write, directory fingerprint |
| Capture envelope | `packages/brain/src/capture/build.ts` (+ test) | `captureMethod` union widened |
| Import | `apps/cli/src/commands/import.ts`, `import.test.ts` | spec §5 without Q5 C |
| Project | `apps/cli/src/commands/project-template.ts`, `project-init.ts`, `project-check.ts` (+ tests), `templates/project/` | spec §6, §7 |
| Vendor observations | `packages/adapter-claude/src/observations.ts` (+ test), `packages/adapter-claude/src/index.ts` (+ `index.test.ts`) | `CLAUDE_MEMORY_LAYOUT`, `CLAUDE_DENY_RULES`, `null` until observed |
| Doctor | `apps/cli/src/commands/vendor-config.ts` (+ test), `apps/cli/src/commands/doctor.ts`, `doctor.test.ts`, `tests/e2e/foundation.test.ts` | spec §8 |
| Security gates | `tests/security/sentinel.test.ts`, `tests/security/interruption.test.ts`, `tests/e2e/import.test.ts` | spec §10 rows that need the compiled binary |
| NEW-98 | `tests/tools/link-workspace-packages.ts`, `tests/repository/workspace-links.test.ts`, `package.json` | per-worktree `tests/node_modules/@developer-os/*` links |
| Docs | inventory, `BACKLOG.md`, `ORDER.md`, roadmap, spec §1 note (Task 1); `docs/architecture/*` and the design spec (Task 13) | spec §11 |

```text
Verified anchors at plan writing (base 13eb18e). Kept inside a fence so the citations gate ignores
them. Line numbers drift, so each task re-locates by symbol.
apps/cli/src/main.ts                      OPTIONS, COMMAND_OPTIONS, COMMAND_POSITIONALS, BRAIN_SUBCOMMANDS, parse(), dispatch()
apps/cli/src/commands/capture.ts          fingerprintDirectory, readExistingCapture, readCaptureQuietly, writeCapture, QUARANTINE_SEGMENTS (all file-local)
apps/cli/src/commands/doctor.ts           collectFindings(): check list ends "codex-capabilities", then bootstrap-evidence findings; guarded() turns a throw into "fail"
apps/cli/src/commands/doctor.test.ts      ~205  exact check-id list
tests/e2e/foundation.test.ts              ~70   DOCTOR_CHECKS; ~317 second exact list
packages/security/src/protected-paths.ts  protectedDirectoryNames, .env/.env.* segments, three home-exact files; open() without O_NONBLOCK
packages/brain/src/capture/build.ts       CaptureBuildRequest.captureMethod: "agent-authored" | "manual"
apps/cli/src/context.ts                   resolveContainedRoot, loadOrCreateRedactionKey, readRedactionKey, failureFrom(context, error, paths, recovery, data)
apps/cli/src/lifecycle/mutation-gate.ts   LifecycleMutationRefusal; context.executor is the gated executor
```

---

## Execution waves (D33)

A task starts only when every task on its `Consumes:` line is integrated on `development`. The
tasks of one wave run in parallel, each in its own worktree.

| Wave | Tasks | Waits for |
|---|---|---|
| 1 | 1 (orchestrator, docs), 2, 3, 4, 5, 6 | nothing |
| 2 | 7, 8, 9, 10 | 7: 2, 3, 4 · 8: 2, 3, 4 · 9: 2, 3 · 10: 3, 5 |
| 3 | 11, 12 | 11: 7 · 12: 5, 7 |
| 4 | 13, 15 | 13: 7–12 · 15: 8, 9, and A12's content procedure and scanner being integrated |
| 5 | 14 | 10, 12, 13, **and the founder's observation** |
| 6 | 16 | 1–13, 15; 14 if the founder observed, otherwise its BACKLOG row |

**Shared files.**
- Wave 1 has no file overlap:
  - Task 2 owns `main.ts`;
  - Task 3 owns `packages/security/src/index.ts` and its `index.test.ts` export list;
  - Task 4 owns `capture.ts` and `build.ts`;
  - Task 5 owns `packages/adapter-claude/src/index.ts` and its `index.test.ts` export list;
  - Task 6 owns `package.json`.
- Waves 2 and 3 have no overlap. `import.ts` passes from Task 7 to Task 12 across waves.
  `doctor.ts` is Task 10's alone.
- Across plans, `doctor.ts` is also edited by A12 (`DoctorReportV1.instructions`) and A13 (the
  external hooks report). If either is in flight when Task 10 integrates, take the union of the
  check lists in `collectFindings`, `doctor.test.ts` and `tests/e2e/foundation.test.ts`.

---

### Task 1: Inventory, backlog and roadmap amendments · S (orchestrator)

**Done 2026-09-22, `a7cec3f`.**

Spec §2, §9, §11 (the `docs/superpowers` and `docs/migration` rows), and D47's registry amendment.
Docs only. The orchestrator does it because it edits `docs/superpowers/`.

**Files:**
- Modify: `docs/migration/instruction-inventory.md` §5, §6
- Modify: `docs/superpowers/BACKLOG.md` (A14 section; NEW-98 row)
- Modify: `docs/superpowers/ORDER.md` (A14 row; the NEW-98 routing sentence)
- Modify: `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md` (Phase 7 bullets, Phase 9 preamble, the "Legacy scheduled jobs" risk row)
- Modify: `docs/superpowers/specs/2026-09-22-developer-os-tooling-verbs-design.md` §1 (one resolution line)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing code-facing.

- [x] **Step 1: Rewrite inventory §5 and §6 from spec §2.** Keep every row and replace each status
  and target with the spec §2 disposition. Then:
  - `brain-weekly` target: the decomposition list from §2. Replace "the Spec 1 automation job
    registry: `import`, `ingest`, …" with "run by hand: `import --claude-memory`, `ingest`,
    `brain reindex`, `brain lint`, `doctor` (including `vendor-config`); `git sync` in Phase 9.
    `import` and `ingest` stay manual (Spec 1 §1, D47)."
  - `repo-audit`, `repo-audit-weekly`, `repo-bootstrap`, `lib/repo-baseline`, `git-history-secrets`,
    `worktree` and "project settings" get status `refused (D47)`, each with its one-line reason
    copied verbatim from spec §9.
  - `distill-memory` → `import --claude-memory`. `check-config-drift` → `doctor` check
    `vendor-config`. `check-templates` → `project check`. The §6 project instruction file and
    signpost → `project init`. Each is marked `planned A14 (Phase 7)`; Task 16 flips it to shipped.
- [x] **Step 2: BACKLOG.**
  - The A14 section lists exactly the §3 surfaces and names the four refusals.
  - The NEW-98 row's last sentence becomes: "Re-owned by D47 (A14 Q3 A) to repository tooling:
    `npm run link:tests` (`tests/tools/link-workspace-packages.ts`), pinned by
    `tests/repository/workspace-links.test.ts`; closes with plan
    `2026-09-22-developer-os-tooling-verbs.md` Task 6."
- [x] **Step 3: ORDER.md.** Set the A14 row's completion text to "inventory §5 and §6: every row is
  a shipped verb or a recorded refusal (D47)". In the routing sentence, replace "NEW-98 by A14" with
  "NEW-98 by A14 Task 6 (repository tooling, D47)". Add `Phase 7 progress: committed none; in flight
  <wave 1>; ready next <…>.`
- [x] **Step 4: Roadmap.**
  - Phase 7's first two bullets become: "`import [<path>] | --claude-memory` → quarantine captures;
    sources are not archived (D47, Q5 A)" and "`project init|check`; `doctor` check
    `vendor-config`; `repo audit|bootstrap|secrets-scan` and `project worktree` refused (D47)".
  - The third bullet and Phase 9's preamble state that the registry is Spec 1 §5.1's four jobs, and
    that `import` and `ingest` stay manual (D47, Spec 1 §1).
  - The risk row "Legacy scheduled jobs retire at cutover" gets the mitigation "their verbs exist
    from Phase 7 and run by hand; `import` and `ingest` stay manual permanently (D47)".
- [x] **Step 5: Spec §1 note.** Under "Automation is out of scope (D16)" add one line: "**Resolved
  by D47 (2026-09-22):** Spec 1 §1 holds; `import` and `ingest` are not registry entries."
- [x] **Step 6: Verify and commit.**

```bash
grep -nE 'repo (audit|bootstrap|secrets-scan)|project worktree|git-history-secrets|repo-audit|repo-bootstrap|repo-baseline' \
  docs/migration/instruction-inventory.md docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md \
  docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md
```

Expected: every hit is a refusal line (`refused`, `D47`) or the NEW-98 re-owning text. None says
`planned`.

```bash
npm run lint
git add docs/migration/instruction-inventory.md
git add -f docs/superpowers/BACKLOG.md docs/superpowers/ORDER.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/specs/2026-09-22-developer-os-tooling-verbs-design.md docs/superpowers/plans/2026-09-22-developer-os-tooling-verbs.md
git diff --cached --name-only
git commit -m "docs: record A14 dispositions and refusals (D47)"
```

---

### Task 2: Dispatch, result types and not-implemented stubs · S

**Done 2026-09-22, `f4f1ca9`** (D47 lane: lint only, tests and review owed at phase close); dispatch rows aligned with the shipped verb, `b8030ee`.

Spec §3; §10 row "dispatch is strict". Spec §12 step 2.

**Files:**
- Modify: `apps/cli/src/main.ts`: `USAGE`, `OPTIONS`, `COMMAND_OPTIONS`, `COMMAND_POSITIONALS`, a new `PROJECT_SUBCOMMANDS`, `parse`, `dispatch`
- Create: `apps/cli/src/commands/import.ts` (types, bounds, stub)
- Create: `apps/cli/src/commands/project-init.ts` (types, stub)
- Create: `apps/cli/src/commands/project-check.ts` (types, stub)
- Create: `apps/cli/src/commands/project-template.ts` (the closed-set type, an empty set, bounds)
- Test: `apps/cli/src/main.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks keep these names and shapes exactly):

```ts
// apps/cli/src/commands/import.ts
export const IMPORT_MAX_ENTRIES_WALKED = 10_000;
export const IMPORT_MAX_DEPTH = 16;
export const IMPORT_MAX_FILES_PER_RUN = 1_000;
export const IMPORT_MAX_MEMORY_PROJECTS = 1_000;
export interface ImportFileResultV1 {
  readonly path: string;                 // source-relative, redacted
  readonly outcome: "imported" | "skipped" | "refused" | "would_import";
  readonly captureId: string | null;
  readonly reason: string | null;        // spec §5.6 reason, or "unsupported_type"
  readonly redactionCount: number;
}
export interface ImportResultV1 {
  readonly schemaVersion: 1;
  readonly source: "inbox" | "path" | "claude-memory";
  readonly dryRun: boolean;
  readonly files: readonly ImportFileResultV1[];
  readonly duplicateCount: number;
  readonly remaining: number;
}
export interface ImportOptions {
  readonly path: string | null;
  readonly claudeMemory: boolean;
  readonly limit: number | null;
  readonly dryRun: boolean;
}
export function runImport(context: CliContext, options: ImportOptions): Promise<CliResult<ImportResultV1>>;
export function renderImport(result: ImportResultV1): readonly string[];

// apps/cli/src/commands/project-template.ts
export interface ProjectTemplateFile { readonly name: string; readonly content: string } // flat file name, UTF-8
export const PROJECT_TEMPLATE_MAX_FILES = 8;
export const PROJECT_TEMPLATE_MAX_BYTES = 64 * 1024;
export const PROJECT_TEMPLATE: readonly ProjectTemplateFile[] = []; // Task 15 fills it

// apps/cli/src/commands/project-init.ts
export interface ProjectInitResultV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly created: readonly string[];
  readonly overridden: readonly string[];
  readonly transactionId: string | null;
}
export interface ProjectInitOptions { readonly dir: string | null; readonly dryRun: boolean }
export function runProjectInit(context: CliContext, options: ProjectInitOptions): Promise<CliResult<ProjectInitResultV1>>;
export function renderProjectInit(result: ProjectInitResultV1): readonly string[];

// apps/cli/src/commands/project-check.ts
export interface ProjectCheckReportV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly checks: readonly DoctorCheck[];   // DoctorCheck from ./doctor.js
}
export interface ProjectCheckOptions { readonly dir: string | null }
export function runProjectCheck(context: CliContext, options: ProjectCheckOptions): Promise<CliResult<ProjectCheckReportV1>>;
export function renderProjectCheck(report: ProjectCheckReportV1): readonly string[];
```

Tasks 7, 8 and 9 add a third optional `dependencies` parameter to their `run*` function. Dispatch
never passes it.

- [x] **Step 1: Write the dispatch matrix (it must fail against the current `main.ts`)**

```ts
it.each([
  [["import", "a", "b"]],
  [["import", "notes", "--claude-memory"]],          // import_path_conflict → usage, exit 2
  [["import", "--yes"]],
  [["import", "--text", "x"]],
  [["import", "--limit", "0"]],
  [["project"]],
  [["project", "worktree"]],                        // refused verb, no dispatch entry
  [["project", "init", "a", "b"]],
  [["project", "check", "--dry-run"]],
  [["project", "init", "--limit", "3"]],
  [["project", "toString"]],
  [["repo", "audit"]],
  [["repo", "secrets-scan"]],
])("refuses the argv %j before building a context", async (argv) => {
  const io = new RecordingIo();
  expect(await run(argv, io, () => { throw new Error("context must not be built"); })).toBe(EXIT_CODES.invalidInput);
  expect(io.err.join("\n")).toContain("Usage: developer-os <command> [options]");
});

it.each([
  [["import"]], [["import", "notes"]], [["import", "--claude-memory"]], [["import", "--dry-run", "--limit", "5", "--json"]],
  [["project", "init"]], [["project", "init", "some-dir", "--dry-run", "--json"]], [["project", "check"]], [["project", "check", "some-dir", "--json"]],
])("admits %j and reaches the not-implemented stub, exit 4", async (argv) => {
  const fixture = await createCommandFixture("dispatch-a14");
  expect(await run(argv, fixture.io, () => fixture.context)).toBe(EXIT_CODES.capabilityUnavailable);
});

it("lists import and project in the usage text", async () => {
  const io = new RecordingIo();
  await run(["--nope"], io, () => { throw new Error("unused"); });
  const usage = io.err.join("\n");
  expect(usage).toContain("  import     ");
  expect(usage).toContain("  project    ");
  expect(usage).toContain("--claude-memory");
});
```

Use the file's existing `RecordingIo` field names. If they differ from `io.err`, adapt only the
accessor. Also add `import` and `project` to any existing "every command appears in USAGE" case.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/main.test.ts -t 'import|project|repo|usage'`

- [x] **Step 3: Implement.**

In `main.ts`:
- Add `"claude-memory": { type: "boolean" }` to `OPTIONS`.
- Set `COMMAND_OPTIONS.import = ["claude-memory", "limit", "dry-run", "json"]` and
  `COMMAND_OPTIONS.project = ["dry-run", "json"]`.
- Set `COMMAND_POSITIONALS.import = { min: 0, max: 1 }` and
  `COMMAND_POSITIONALS.project = { min: 1, max: 2 }`.

Then add to `parse`:

```ts
const PROJECT_SUBCOMMANDS: Readonly<Record<string, readonly OptionName[]>> = {
  init: ["dry-run", "json"],
  check: ["json"],
};
// in parse(), beside the brain and config blocks:
if (positional === "project") {
  const [name] = rest;
  if (name === undefined || !Object.hasOwn(PROJECT_SUBCOMMANDS, name)) return null;
  const allowedHere = PROJECT_SUBCOMMANDS[name];
  if (allowedHere === undefined || !suppliedOptions(values).every((o) => allowedHere.includes(o))) return null;
}
if (positional === "import" && values["claude-memory"] === true && rest.length > 0) return null;
```

Add these dispatch cases:

```ts
case "import": {
  const [path] = invocation.positionals;
  return emit(io, await runImport(context, {
    path: path ?? null,
    claudeMemory: invocation.values["claude-memory"] === true,
    limit: invocation.limit,
    dryRun,
  }), json, renderImport);
}
case "project": {
  const [subcommand, dir] = invocation.positionals;
  return subcommand === "init"
    ? emit(io, await runProjectInit(context, { dir: dir ?? null, dryRun }), json, renderProjectInit)
    : emit(io, await runProjectCheck(context, { dir: dir ?? null }), json, renderProjectCheck);
}
```

Add these `USAGE` lines:
- `  import     turn inbox files, a path, or Claude memory into quarantined captures`
- `  project    init | check [<dir>]: write or check project instruction files`
- `  --claude-memory  import Claude Code auto-memory instead of a path (import)`

Add `import` and `project init` to the `--dry-run` line, and `import` to the `--limit` line.

Each stub returns, with its own command name, and names `options` so eslint's `after-used` rule is
satisfied:

```ts
export function runImport(context: CliContext, options: ImportOptions): Promise<CliResult<ImportResultV1>> {
  return Promise.resolve(failure(EXIT_CODES.capabilityUnavailable, {
    kind: "not_implemented",
    message: `developer-os import${options.claudeMemory ? " --claude-memory" : ""} is not implemented yet`,
    paths: [],
  }));
}
```

Renderers:
- `renderImport`: one line per file, `  <outcome> <renderPath(path)>` plus ` (<reason>)` when a
  reason is set, then `imported <n>, duplicates <d>, remaining <r>`.
- `renderProjectInit`: `renderInit`'s shape ("Developer OS would create:" / "created:" plus the
  paths).
- `renderProjectCheck`: `renderDoctor`'s shape.

Every path goes through `renderPath`.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/main.ts apps/cli/src/main.test.ts apps/cli/src/commands/import.ts apps/cli/src/commands/project-init.ts apps/cli/src/commands/project-check.ts apps/cli/src/commands/project-template.ts
git diff --cached --name-only
git commit -m "feat(cli): dispatch import and project with not-implemented stubs"
```

---

### Task 3: Bounded untrusted reader and the protected-rule table · S

**Done 2026-09-22, `7e1fb07`** (D47 lane: lint only, tests and review owed at phase close).

Spec §4.2, §8 "Reference".

**Files:**
- Create: `apps/cli/src/commands/untrusted-file.ts`
- Test: `apps/cli/src/commands/untrusted-file.test.ts`
- Modify: `packages/security/src/protected-paths.ts`
- Test: `packages/security/src/protected-paths.test.ts`
- Modify: `packages/security/src/index.ts`, `packages/security/src/index.test.ts` (exact export list)

**Interfaces:**
- Consumes: `CliContext.fs.lstat`, `CliContext.guards.manifest.assertReadable`, `CliContext.guards.readText(path, reader)`.
- Produces:

```ts
// packages/security/src/protected-paths.ts
export type ProtectedPathRuleId =
  | "read-env" | "read-env-variants" | "read-ssh" | "read-aws" | "read-gnupg"
  | "read-gh-hosts" | "read-codex-auth" | "read-claude-credentials";
export type ProtectedPathMatchV1 =
  | { readonly kind: "segment"; readonly name: string }            // any path segment equal to name
  | { readonly kind: "segment-prefix"; readonly prefix: string }   // any segment starting with prefix
  | { readonly kind: "home-exact"; readonly relativePath: string }; // exactly <home>/<relativePath>
export interface ProtectedPathRuleV1 { readonly id: ProtectedPathRuleId; readonly match: ProtectedPathMatchV1 }
export const PROTECTED_PATH_RULES: readonly ProtectedPathRuleV1[];

// apps/cli/src/commands/untrusted-file.ts
export type UntrustedFileReason = "protected" | "symlink" | "not_regular" | "not_found" | "too_large" | "not_text";
export class UntrustedFileRefusal extends Error {
  readonly reason: UntrustedFileReason;
  readonly code: FailureExitCode; // protected 5, symlink 5, not_found 2, not_regular 1, too_large 1, not_text 1
}
/** `path` must be absolute; a relative path is a programming error (RangeError). */
export function readUntrustedText(
  context: Pick<CliContext, "fs" | "guards">,
  path: string,
  bound: number,
): Promise<string>;
```

`PROTECTED_PATH_RULES`, in this order:
- `read-env` segment `.env`
- `read-env-variants` segment-prefix `.env.`
- `read-ssh` segment `.ssh`
- `read-aws` segment `.aws`
- `read-gnupg` segment `.gnupg`
- `read-gh-hosts` home-exact `.config/gh/hosts.yml`
- `read-codex-auth` home-exact `.codex/auth.json`
- `read-claude-credentials` home-exact `.claude/.credentials.json`

- [x] **Step 1: Write the failing tests**

`protected-paths.test.ts`:

```ts
it("derives every refusal from PROTECTED_PATH_RULES, and the table is the eight known rules", async () => {
  expect(PROTECTED_PATH_RULES.map((rule) => rule.id)).toStrictEqual([
    "read-env", "read-env-variants", "read-ssh", "read-aws", "read-gnupg",
    "read-gh-hosts", "read-codex-auth", "read-claude-credentials",
  ]);
  const policy = new ProtectedPathPolicy(home);
  for (const rule of PROTECTED_PATH_RULES) {
    const probe =
      rule.match.kind === "segment" ? join(home, "project", rule.match.name, "x")
      : rule.match.kind === "segment-prefix" ? join(home, "project", `${rule.match.prefix}local`)
      : join(home, rule.match.relativePath);
    await expect(policy.assertReadable(probe), rule.id).rejects.toBeInstanceOf(SecurityRefusalError);
  }
});

it("opens a FIFO without blocking, so the reader can refuse it", async () => {
  const fifo = join(home, "project", "pipe.md");
  execFileSync("/usr/bin/mkfifo", [fifo]); // test-only spawn; the product spawns nothing here
  const policy = new ProtectedPathPolicy(home);
  await expect(
    policy.readText(fifo, async (handle) => ((await handle.stat()).isFIFO() ? "fifo" : "file")),
  ).resolves.toBe("fifo");
}, 5_000);
```

Without `O_NONBLOCK`, `open` blocks on a FIFO with no writer, and the case times out. That timeout
is the red.

`untrusted-file.test.ts` uses `createCommandFixture` for a real `fs` and `guards` over a synthetic
home. Cover:
- a regular UTF-8 file at the bound reads back exactly, and `bound + 1` refuses `too_large` exit 1.
  A spy on `FileHandle.read` proves that no more than `bound + 1` bytes are ever requested.
- invalid UTF-8 (`Buffer.from([0xc3, 0x28])`) and a NUL byte each refuse `not_text`, exit 1.
- a symlink refuses `symlink` exit 5, and its target is never read.
- a directory refuses `not_regular`; a missing path refuses `not_found`, exit 2.
- `<home>/project/.env` and `<home>/.ssh/config` refuse `protected` exit 5 **before any open**. A
  spy on `guards.readText` records zero calls.
- a relative path throws `RangeError`.
- the refusal message contains no file content. Plant `SENTINEL` in an oversized file and assert
  the message does not contain it.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root packages/security src/protected-paths.test.ts src/index.test.ts` and
  `npx vitest run --root apps/cli src/commands/untrusted-file.test.ts`

- [x] **Step 3: Implement.**

`protected-paths.ts`:
- Define `PROTECTED_PATH_RULES`.
- Replace `protectedDirectoryNames`, `hasProtectedEnvironmentName` and the inline
  `protectedExactPaths` with one loop over the table. Behaviour must not change: the existing tests
  stay as they are.
- Change the open flags to `constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK`.

Export `PROTECTED_PATH_RULES` and the three types from `index.ts`, and add them to `index.test.ts`'s
sorted list.

`untrusted-file.ts`:

```ts
export async function readUntrustedText(context, path, bound) {
  if (!isAbsolute(path)) throw new RangeError("readUntrustedText needs an absolute path");
  try { await context.guards.manifest.assertReadable(path); }
  catch (error) { if (error instanceof SecurityRefusalError) throw refusal("protected"); throw error; }
  let before;
  try { before = await context.fs.lstat(path, { bigint: true }); }
  catch (error) { if (isMissingEntry(error)) throw refusal("not_found"); throw error; }
  if (before.isSymbolicLink()) throw refusal("symlink");
  if (!before.isFile()) throw refusal("not_regular");
  return context.guards.readText(path, async (handle) => {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw refusal("not_regular");
    const buffer = Buffer.alloc(bound + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > bound) throw refusal("too_large");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, filled)); }
    catch { throw refusal("not_text"); }
    if (text.includes("\0")) throw refusal("not_text");
    return text;
  });
}
```

Messages are fixed strings per reason, for example "the file is larger than the bound and was not
read past it". They never include content, and never the path, which callers attach through
`paths`.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/security/src/protected-paths.ts packages/security/src/protected-paths.test.ts packages/security/src/index.ts packages/security/src/index.test.ts apps/cli/src/commands/untrusted-file.ts apps/cli/src/commands/untrusted-file.test.ts
git diff --cached --name-only
git commit -m "feat(security): bounded untrusted reader and the protected-path rule table"
```

---

### Task 4: Extract the quarantine seam from `capture`; widen `captureMethod` · S

**Done 2026-09-22, `ac8d5f6`** (D47 lane: lint only, tests and review owed at phase close).

Spec §5.3 and §5.4 "reuse … extracted and never copied".

**Files:**
- Create: `apps/cli/src/commands/quarantine.ts`
- Test: `apps/cli/src/commands/quarantine.test.ts`
- Modify: `apps/cli/src/commands/capture.ts` (imports from the seam; no behaviour change)
- Modify: `packages/brain/src/capture/build.ts`, `packages/brain/src/capture/build.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// apps/cli/src/commands/quarantine.ts
export const QUARANTINE_SEGMENTS: readonly ["_raw", "quarantine"];
export const EMPTY_MANIFEST: InstallationManifestV1; // the stand-in validateChangePlan gets when no manifest exists
export const INBOX_SEGMENTS: readonly ["_raw", "inbox"];
export function fingerprintDirectory(canonical: string, key: Uint8Array): string; // HMAC-SHA256 hex, first 16
export interface QuarantineRoots { readonly contentRoot: string; readonly quarantine: string }
/** Proves quarantine lies inside the content root (resolveContainedRoot); refuses through `refuse`. */
export function resolveQuarantine(
  context: CliContext,
  config: DeveloperOsConfigV1,
  paths: RuntimePaths,
  refuse: (message: string, paths: readonly string[]) => Error,
): Promise<QuarantineRoots>;
export interface ExistingCapture { readonly parsed: boolean; readonly status: CaptureStatus; readonly warning: string | null; readonly contents: string }
export function readExistingCapture(context: CliContext, target: string, fileName: string, redact: Redactor): Promise<ExistingCapture | null>;
export function readCaptureQuietly(context: CliContext, target: string, fileName: string, redact: Redactor): Promise<ExistingCapture | null>;
/** Guarded 0700 mkdir of quarantine, validateChangePlan (owned: quarantine, excluded: product home), one `create`. Returns the journal id. */
export function writeQuarantineCapture(
  context: CliContext,
  paths: RuntimePaths,
  quarantine: string,
  target: string,
  contents: string,
  kind: "capture" | "import",
): Promise<string>;

// packages/brain/src/capture/build.ts
readonly captureMethod: "agent-authored" | "manual" | "import" | "import-claude-memory";
```

- [x] **Step 1: Write the failing tests**
  - `quarantine.test.ts`: `fingerprintDirectory` is 16 lowercase hex characters, stable for one key,
    and different for another key.
  - `resolveQuarantine` refuses through `refuse` when the quarantine directory is a symlink out of
    the content root.
  - `writeQuarantineCapture(..., "import")` writes one journal of kind `import`, whose single
    mutation creates the target at mode 0600 or tighter, and it returns that journal's id.
  - `build.test.ts`: `buildCapture({ ..., captureMethod: "import" })` and `"import-claude-memory"`
    each render and re-parse through `parseCaptureFile` with the same `captureMethod`.
  - `capture.test.ts` is **not edited**. Its whole file passing at phase close is the proof that
    the extraction changed no behaviour.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/quarantine.test.ts src/commands/capture.test.ts` and
  `npx vitest run --root packages/brain src/capture/build.test.ts`

- [x] **Step 3: Implement.**
  - Move `fingerprintDirectory`, `FINGERPRINT_LENGTH`, `QUARANTINE_SEGMENTS`, `EMPTY_MANIFEST`,
    `ExistingCapture`, `readExistingCapture`, `readCaptureQuietly` and `writeCapture` from
    `capture.ts` into `quarantine.ts`, with their comments.
  - `writeCapture` becomes `writeQuarantineCapture` with a `kind` parameter, and it returns the
    journal's `id`.
  - The one `CaptureRefusal` inside `writeCapture` ("the validated change plan lost its only
    operation") becomes `new Error(...)`. `exitCodeOf` already maps a code-less error to 1, as
    before.
  - Extract `resolveQuarantine` from `runCapture`'s `contentRoot`/`quarantine`/`resolveContainedRoot`
    block. `capture.ts` keeps its own refusal sentence and recovery text, and passes them in through
    `refuse`.
  - `capture.ts` imports everything back and passes `"capture"`.
  - Widen the `captureMethod` union in `build.ts`. No consumer switches on the value (grepped at
    plan writing: `parse.ts`, `render.ts` and `schema/capture.ts` treat it as a scalar string).

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/quarantine.ts apps/cli/src/commands/quarantine.test.ts apps/cli/src/commands/capture.ts packages/brain/src/capture/build.ts packages/brain/src/capture/build.test.ts
git diff --cached --name-only
git commit -m "refactor(cli): extract the quarantine seam from capture"
```

---

### Task 5: Claude observation rows, `null` until observed · S

**Done 2026-09-22, `c1bdada`** (D47 lane: lint only, tests and review owed at phase close).

Spec §5.5 "Capability precondition", §8 "Reference".

**Files:**
- Create: `packages/adapter-claude/src/observations.ts`
- Test: `packages/adapter-claude/src/observations.test.ts`
- Modify: `packages/adapter-claude/src/index.ts`, `packages/adapter-claude/src/index.test.ts` (exact export list)

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface ClaudeObservationV1 {
  readonly claudeVersion: string;   // semver, e.g. the pinned version the founder observed on
  readonly observedOn: string;      // YYYY-MM-DD
  readonly observedIn: string;      // one sentence: disposable home, command, what was seen
}
export interface ClaudeMemoryLayoutV1 extends ClaudeObservationV1 {
  readonly projectsDirectory: string;  // expected "projects", relative to <user-home>/.claude
  readonly memoryDirectory: string;    // expected "memory", relative to each project directory
  readonly extension: string;          // expected ".md"
  readonly indexFileName: string;      // the index file the vendor keeps beside memory files; excluded
}
export interface ClaudeDenyRulesV1 extends ClaudeObservationV1 {
  /** Keyed by ProtectedPathRuleId (packages/security). A rule is present only if every string is present. */
  readonly rules: Readonly<Record<string, readonly string[]>>;
}
export const CLAUDE_MEMORY_LAYOUT: ClaudeMemoryLayoutV1 | null = null;
export const CLAUDE_DENY_RULES: ClaudeDenyRulesV1 | null = null;
export function isValidClaudeObservation(row: ClaudeObservationV1): boolean;
```

- [x] **Step 1: Write the failing test.** `observations.test.ts` checks, for each row that is not
  `null`:
  - `isValidClaudeObservation(row)`: semver version, ISO date that is not in the future, and a
    non-empty `observedIn`;
  - for the memory layout: every name is a single segment with no `/`, no `.` and no `..`;
  - for the deny rules: every value is a non-empty array of non-empty strings.

  A `null` row passes vacuously. Also assert once that `isValidClaudeObservation` rejects a
  synthetic row with version `"latest"`, so the validator is not vacuous. Then add the three
  exports to `index.test.ts`'s sorted list.
- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root packages/adapter-claude src/observations.test.ts src/index.test.ts`
- [x] **Step 3: Implement** the file as specified, with both rows `null`. Put a docblock on each
  constant: "Vendor behaviour, taken from a founder observation on a disposable home and never from
  memory or documentation (spec §5.5). `null` until observed. The verb that needs it refuses exit 4
  or warns while it is `null`." Re-export from `index.ts`.
- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/adapter-claude/src/observations.ts packages/adapter-claude/src/observations.test.ts packages/adapter-claude/src/index.ts packages/adapter-claude/src/index.test.ts
git diff --cached --name-only
git commit -m "feat(adapter-claude): observation rows for memory layout and deny rules, unobserved"
```

---

### Task 6: Per-worktree test package links (NEW-98) · S

**Done 2026-09-22, `8bb6a1a`** (D47 lane: lint only, tests and review owed at phase close).

Spec Q3 A: NEW-98 is re-owned to repository tooling.

**Files:**
- Create: `tests/tools/link-workspace-packages.ts`
- Create: `tests/repository/workspace-links.test.ts`
- Modify: `package.json` (`scripts["link:tests"]`)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run link:tests`, which makes every `tests/node_modules/@developer-os/<name>` a
  relative symlink to this checkout's workspace package.

- [x] **Step 1: Write the pin test**

```ts
it("resolves every tests/node_modules/@developer-os link inside this checkout", async () => {
  const root = await realpath((await runProcess("git", ["rev-parse", "--show-toplevel"])).stdout.trim());
  const manifest = JSON.parse(await readFile(join(root, "tests/package.json"), "utf8")) as { dependencies: Record<string, string> };
  const names = Object.keys(manifest.dependencies).filter((name) => name.startsWith("@developer-os/"));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const resolved = await realpath(join(root, "tests/node_modules", name));
    expect(resolved.startsWith(`${root}${sep}`), name).toBe(true);
    const own = JSON.parse(await readFile(join(resolved, "package.json"), "utf8")) as { name: string };
    expect(own.name).toBe(name);
  }
});
```

- [ ] **Step 2: Run the test.** Deferred to phase close (D47). At close:
  `npx vitest run --root tests repository/workspace-links.test.ts`
- [x] **Step 3: Implement** `tests/tools/link-workspace-packages.ts`:
  1. Set root = `git rev-parse --show-toplevel`.
  2. Read the workspace directories from `pnpm-workspace.yaml`'s `packages:` list. The lines have
     the form `  - <dir>`; stop at the first non-list line.
  3. Map each directory's `package.json` `name` to that directory.
  4. For each `@developer-os/*` dependency of `tests/package.json`, if
     `tests/node_modules/<name>` is missing or resolves outside root, replace it (`unlink` or
     `rm -r` of the link itself only, never of a real directory's contents) with
     `symlink(relative(dirname(link), workspaceDir), link)`.
  5. Print one line per changed link and exit 0. Exit 1 if a dependency has no workspace package.

  Add `"link:tests": "tsc -b && node tests/dist/tools/link-workspace-packages.js"` to `package.json`
  scripts. **Do not run `npm install`.**
- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add tests/tools/link-workspace-packages.ts tests/repository/workspace-links.test.ts package.json
git diff --cached --name-only
git commit -m "fix(tests): relink workspace packages per worktree (NEW-98)"
```

The orchestrator adds to `SESSION.md` §4.1's Implementer bullet: "run `npm run link:tests` once in
a new worktree before any `tests/` suite." It does this in the integration commit, with `git add -f`.

---

### Task 7: `import` for inbox and path sources · M

**Done 2026-09-22, `f3d3694`** (D47 lane: lint only, tests and review owed at phase close).

Spec §5.1–§5.4 and §5.6–§5.7 for `inbox` and `path`, with Q5 A. The §10 rows are "import happy
path" (unit half), "path policy", "bounds" (import half), "dry run writes nothing" (import half)
and "interruption and capacity" (mid-run half).

**Files:**
- Modify: `apps/cli/src/commands/import.ts` (replaces the stub)
- Test: `apps/cli/src/commands/import.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's types and bounds;
  - Task 3's `readUntrustedText` and `UntrustedFileRefusal`;
  - Task 4's `resolveQuarantine`, `INBOX_SEGMENTS`, `fingerprintDirectory`, `readExistingCapture`,
    `readCaptureQuietly` and `writeQuarantineCapture`;
  - `buildCapture`, `resolveBrainConfig`, `createRedactor`, `loadOrCreateRedactionKey`,
    `readRedactionKey`, `readConfigFile`, `isDirectory`, `runtimePathsFor`,
    `resolveContainedRoot`, `failureFrom`, `exitCodeOf`, `MAX_CAPTURE_INPUT_BYTES`.
- Produces (Task 12 extends it and Task 11 drives it):

```ts
export interface ImportDependencies { readonly cwd: () => string }
export function runImport(context: CliContext, options: ImportOptions, dependencies?: ImportDependencies): Promise<CliResult<ImportResultV1>>;
/** One accepted file, before it is read. `relative` is NFC, POSIX-separated. */
export interface ImportCandidate {
  readonly relative: string;
  readonly absolute: string;
  readonly fingerprintSource: string; // what fingerprintDirectory keys for workingDirectoryFingerprint
}
/** The shared per-file loop: read → build → duplicate → write, with the cap, `remaining` and run-stop rules. */
export function processCandidates(input: {
  readonly context: CliContext;
  readonly candidates: readonly ImportCandidate[];
  readonly preset: readonly ImportFileResultV1[];   // skips and symlink refusals found by the walk
  readonly captureMethod: "import" | "import-claude-memory";
  readonly projectSlug: "inbox" | "import" | "claude-memory";
  readonly source: ImportResultV1["source"];
  readonly quarantine: string;
  readonly paths: RuntimePaths;
  readonly key: Uint8Array;
  readonly keyDurable: boolean;           // false: dry run on an ephemeral key → no duplicate detection
  readonly redact: Redactor;
  readonly cap: number;
  readonly dryRun: boolean;
}): Promise<CliResult<ImportResultV1>>;
```

- [x] **Step 1: Write the failing tests** (`import.test.ts`, built on `createCommandFixture` plus
  `runInit(..., { dryRun: false, assumeYes: true })`, with `cwd` injected). Every row below is one
  `it`:
  1. **Inbox happy path.**
     - Setup: a synthetic inbox with `a.md`, `nested/b.markdown`, `nested/deeper/c.txt`,
       `.gitkeep`, `.hidden.md` and `d.pdf`.
     - Expect: three `imported` rows in NFC byte order `a.md`, `nested/b.markdown`,
       `nested/deeper/c.txt`; `d.pdf` is `skipped` `unsupported_type`; the dot-entries are absent.
     - Each capture file parses with `captureMethod: "import"`, `projectSlug: "inbox"`,
       `sourceAgent: "unknown"` and `status: "quarantined"`.
     - The inbox is byte-identical afterwards (`inventoryDigest`).
     - No file under `_indexes/` changed.
  2. **Idempotent rerun.** A second run returns `files: []`, `duplicateCount: 3`, `remaining: 0` and
     exit 0, and it adds no journal under `state/transactions`.
  3. **`--limit` batches advance.** With five files, `limit: 2` imports the first two with
     `remaining: 3`. The next run imports the next two with `remaining: 1` and `duplicateCount: 2`.
     The third imports one with `remaining: 0`.
  4. **Path source outside the vault.** `import ../elsewhere` is resolved against the injected
     `cwd`:
     - `source: "path"` and `projectSlug: "import"`;
     - `workingDirectoryFingerprint === fingerprintDirectory(canonical root, key)`;
     - the source is unchanged afterwards.
     A single-file path imports that file.
  5. **Relative path resolution.** With `cwd` set to a directory that is not the user home,
     `import notes` reads `<cwd>/notes` and not `<user-home>/notes`. Plant a different file at
     each; only the `cwd` one is imported.
  6. **Path policy.**
     - A path under the vault but outside the inbox refuses `import_source_in_vault` exit 2.
     - A path inside the product home refuses `import_source_in_product_home` exit 5.
     - A missing path refuses `import_source_not_found` exit 2.
     - A quarantine directory replaced by a symlink out of the content root refuses exit 5.
     Each writes nothing (`inventoryDigest` of the product home and the vault is unchanged).
  7. **Per-file refusals continue.**
     - One inbox holds a symlink entry, a 65,537-byte file, an invalid-UTF-8 file, a
       whitespace-only file, a FIFO named `pipe.md` and one good file.
     - The refused rows are `import_source_symlink` 5, `import_source_too_large` 1,
       `import_source_not_text` 1 and `import_source_empty` 1. The FIFO is `skipped` with
       `unsupported_type`.
     - The good file is imported.
     - The run is `ok: false` with exit 5, the most severe, and `error.data` carries the full
       `ImportResultV1`.
     - The symlink target is never read: a `guards.readText` spy has no call for it.
  7b. **Protected roots.** Every protected name begins with a dot, and the walk skips dot entries,
      so a protected source can only arrive as the **root**.
      - `import <cwd>/.env.md` (a single-file root) and `import <user-home>/.aws` (a directory
        root) each refuse `import_source_protected` exit 5 at run level.
      - A `readdir` spy proves `.aws` is never listed.
      - Nothing is written.
  8. **Redaction precedes everything (unit half).** A source holding `SENTINEL`:
     - The capture file does not contain it.
     - The capture's `redaction` has a class and a fingerprint.
     - `redactionCount >= 1`.
     - `JSON.stringify(result)` and every `io` line do not contain it, in both `--json` and human
       mode through `run([...], io, () => context)`.
     - A refusal message for a file whose *name* contains the sentinel shows it redacted.
  9. **Bounds.** Each case builds real files in a temporary tree:
     - 65,536 bytes imports and 65,537 refuses (per file);
     - 10,000 walked entries succeed and 10,001 refuse `import_enumeration_limit` exit 2, with no
       write;
     - depth 16 succeeds and 17 refuses the run;
     - 1,000 and 1,001 new files are run as a **dry run with the key present**, so the same
       `processCandidates` cap path runs without about 2,000 fsync'd transactions. 1,000 gives
       1,000 `would_import` with `remaining: 0`; 1,001 gives 1,000 with `remaining: 1`. The
       `--limit 2` case (row 3) covers the cap with real writes.
  10. **Dry run writes nothing.** On a home whose `state/redaction.key` was deleted after `init`:
      - every accepted file is `would_import` with `captureId: null`;
      - no key file appears;
      - the product home and the vault are byte-identical (`inventoryDigest`);
      - `transactionId` is absent because no journal exists.

      With the key present, a dry run reports duplicates correctly and still writes nothing.
  11. **Mid-run gate refusal.**
      - Setup: three files, and a context whose `executor.execute` delegates for call 1 and throws
        `new LifecycleMutationRefusal({ reason: "lifecycle_closure_not_clear", code: EXIT_CODES.recoveryRequired, paths: [] })`
        on call 2.
      - Expect: exit 6; the first capture exists and is finalized; `error.data.remaining === 2`;
        the third file is not read (a `guards.readText` spy).
  12. **`--claude-memory` before Task 12.** It refuses exit 4 with kind
      `claude_memory_layout_unobserved` and reads nothing. The `fs.readdir` and `guards.readText`
      spies record no call under `<user-home>/.claude`.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/import.test.ts`

- [x] **Step 3: Implement `runImport`.**
  1. Read the configuration with `readConfigFile`. If it is `null`, refuse exit 1 "Developer OS is
     not initialized", recovery `developer-os init`. Then `paths = runtimePathsFor(context, config)`,
     and require the vault as `capture` does: `isDirectory(paths.brain)` must be `true`.
  2. If `options.claudeMemory` is set, refuse exit 4 `claude_memory_layout_unobserved`. Task 12
     replaces this line.
  3. Take `{ contentRoot, quarantine } = resolveQuarantine(...)`, refusing exit 5 with the NEW-14
     sentence. Prove `inbox = join(contentRoot, ...INBOX_SEGMENTS)` with `resolveContainedRoot`,
     also exit 5.
  4. Choose the source root.
     - With no `path`, use the inbox, with `source: "inbox"` and slug `"inbox"`.
     - Otherwise let `absolute = resolve(dependencies.cwd(), options.path)` and `canonical =
       guards.canonicalize(absolute)`. A missing path is `import_source_not_found` (2).
     - A path inside or equal to the canonical `paths.home` is `import_source_in_product_home` (5).
       Check this first.
     - A path inside the canonical `paths.brain` and not inside the canonical inbox is
       `import_source_in_vault` (2).
     - A path inside the inbox gets `source: "path"` and slug `"inbox"`. Anywhere else gets
       `source: "path"` and slug `"import"`.

     "Inside" uses the same `containsPath` semantics as `resolveContainedRoot`.
  5. **Walk before any write.**
     - Pass the root through `guards.manifest.assertReadable` **before the first `readdir` or
       read**. A `SecurityRefusalError` becomes the run-level refusal `import_source_protected`
       (5), so a protected directory's entry names are never listed. The dot-skip below applies to
       walked entries only, never to the root.
     - An explicit stack of directories, depth-first, taking each entry's type from
       `context.fs.lstat` and never following a link.
     - Count every entry seen. Over `IMPORT_MAX_ENTRIES_WALKED`, or deeper than `IMPORT_MAX_DEPTH`
       below the root, throws `ImportRunRefusal("import_enumeration_limit", 2)`.
     - Names starting with `.` are skipped silently.
     - A symlink becomes a `refused` preset row with `import_source_symlink` (5).
     - A regular file ending in `.md`, `.markdown` or `.txt` is a candidate. Any other regular file,
       and any entry that is not a directory, a symlink or a regular file (a FIFO, socket or
       device), is a `skipped` row with `unsupported_type`. It is never opened.
     - Sort candidates and presets by `Buffer.compare` of the NFC relative path's UTF-8 bytes.
  6. **Key and redactor.**
     - On a dry run: `key = readRedactionKey(paths.stateDir)`. If that is `null`, use
       `randomBytes(32)` with `keyDurable = false`.
     - Otherwise `key = loadOrCreateRedactionKey(paths.stateDir)`.
     - `redact = createRedactor(key, { userPatterns: config.redaction?.patterns ?? [] })`. Bind it
       into `guards.redactDiagnostic` as `capture`'s `guardsWith` does.
  7. `processCandidates`, for each candidate in order:
     - `readUntrustedText(context, absolute, MAX_CAPTURE_INPUT_BYTES)`. An `UntrustedFileRefusal`
       becomes `refused` with `import_source_<reason>`, mapping `not_found` to
       `import_source_not_found` and `not_regular` to `import_source_not_text`.
     - `buildCapture({ text, sourceAgent: "unknown", sourceAgentVersion: "unknown", captureMethod,
       projectSlug, workingDirectoryFingerprint: fingerprintDirectory(fingerprintSource, key),
       createdAt: context.now().toISOString(), redact })`.
     - An empty `envelope.content` is `refused` with `import_source_empty` (1).
     - A duplicate (`keyDurable && readExistingCapture(...) !== null`) increments `duplicateCount`,
       with no row.
     - Once `newCount === cap`, stop processing and probe the rest (Scope decision 9).
     - On a dry run, the row is `would_import`, with `captureId` set only if `keyDurable`.
     - Otherwise call `writeQuarantineCapture(..., "import")`. On a throw, apply `capture`'s race
       rule via `readCaptureQuietly`. If the target now holds identical contents it counts as a
       duplicate. Any other throw stops the run (Scope decision 8): return
       `failureFrom({ guards }, error, [], recovery, partialResult)` with `remaining` counting every
       unprocessed candidate.
     - Row `path` is `redact(relative).text`.
  8. **Result.** No `refused` rows: `success(result)`. Otherwise `failureFrom` with an
     `ImportRefusal` whose `code` is the most severe per-file code and whose message is "import
     refused <n> file(s); every other file was processed", with `data: result`.

  `cap = Math.min(options.limit ?? IMPORT_MAX_FILES_PER_RUN, IMPORT_MAX_FILES_PER_RUN)`.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/import.ts apps/cli/src/commands/import.test.ts
git diff --cached --name-only
git commit -m "feat(cli): import inbox and path sources into quarantine"
```

---

### Task 8: `project init` mechanism · M

**Done 2026-09-22, `798b0e4`** (D47 lane: lint only, tests and review owed at phase close).

Spec §6; the §10 row "project init" and the `project init` half of "dry run writes nothing". The
content is Task 15's.

**Files:**
- Modify: `apps/cli/src/commands/project-init.ts` (replaces the stub)
- Test: `apps/cli/src/commands/project-init.test.ts`

**Interfaces:**
- Consumes: Task 2's types and `PROJECT_TEMPLATE`, `PROJECT_TEMPLATE_MAX_BYTES`; Task 3's `readUntrustedText`; Task 4's `EMPTY_MANIFEST`; `validateChangePlan`, `hashBytes`, `readConfigFile`, `runtimePathsFor`, `readRedactionKey`, `createRedactor`, `failureFrom`, `runUninstall` (tests).
- Produces:

```ts
export interface ProjectInitDependencies {
  readonly cwd: () => string;
  readonly templates: readonly ProjectTemplateFile[]; // default PROJECT_TEMPLATE
}
export function runProjectInit(context: CliContext, options: ProjectInitOptions, dependencies?: ProjectInitDependencies): Promise<CliResult<ProjectInitResultV1>>;
```

- [x] **Step 1: Write the failing tests.** Inject synthetic templates
  `[{ name: "AGENTS.md", content: "# Synthetic agents\n" }, { name: "CLAUDE.md", content: "# Synthetic claude\n" }, { name: "CONTEXT.md", content: "# Synthetic signpost\n" }]`.
  - **Empty set.** `templates: []` refuses exit 4 `project_templates_unavailable` and writes nothing.
    So does the production default today.
  - **Not initialized.** With no configuration it refuses exit 1 with recovery `developer-os init`.
  - **Creates.** A fresh temporary directory, passed as a relative `dir` against the injected `cwd`,
    gets exactly the three files with those bytes:
    - `created` lists them in template order;
    - `overridden: []`;
    - one journal of kind `project-init` whose mutations are all `create`;
    - the manifest is unchanged, so the created files are not manifest rows.
  - **Default dir.** `dir: null` targets `cwd()`.
  - **Create-only.** With `AGENTS.md` and `CONTEXT.md` pre-existing, it refuses exit 3
    `project_file_exists` whose `paths` lists **both**. `CLAUDE.md` is not created, and no journal
    is written.
  - **Overlap.** The target equal to, inside, or containing `paths.home`, and the same three
    relations with `paths.brain`, each refuse exit 5 `project_root_overlaps_product`.
  - **Not a directory.** A file target refuses exit 2 `project_root_not_directory`.
  - **Override.**
    - `<product-home>/templates/project/CLAUDE.md` replaces the default, and `overridden` is
      `["CLAUDE.md"]`.
    - An override named `EXTRA.md` is ignored, with a warning that names it.
    - An override holding `SENTINEL` refuses exit 5 `project_template_secret`, writes nothing, and
      the sentinel appears in no output line.
    - An override over 64 KiB refuses exit 1.
  - **Dry run** on a home whose redaction key was deleted:
    - `transactionId: null`;
    - `created` lists the three names;
    - the product home and the target are byte-identical;
    - no key file is created.
  - **Uninstall leaves them.** After `runUninstall(context, { dryRun: false, assumeYes: true })`,
    the three files are still present and byte-identical.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/project-init.test.ts`

- [x] **Step 3: Implement.** The order is fixed, and each step refuses before any write:
  1. An empty set refuses exit 4.
  2. Read the configuration. If it is absent, refuse exit 1.
  3. `target = resolve(cwd(), dir ?? ".")`. `lstat` it: missing or not a directory refuses exit 2.
     `root = canonicalize(target)`.
  4. Overlap: `containsPath(root, home) || containsPath(home, root)`, and the same for
     `paths.brain`, each canonical. Either refuses exit 5.
  5. Resolve overrides. If `join(paths.home, "templates", "project")` is a directory (`lstat`, not
     a symlink), list it: names not in the set become warnings, and names in the set are read with
     `readUntrustedText(..., PROJECT_TEMPLATE_MAX_BYTES)`. `redact = createRedactor(readRedactionKey(stateDir) ?? randomBytes(32), { userPatterns })`. Any finding
     on an override refuses exit 5 and names the override path.
  6. Existing targets: `lstat` every `join(root, name)`. Collect all that exist before refusing
     exit 3.
  7. A dry run returns success with `transactionId: null`.
  8. `validateChangePlan` of all `create` operations, with `manifest: (await context.manifests.readOptional()) ?? EMPTY_MANIFEST`
     (Task 4's export), `ownedRoots: [root]` and
     `excludedRoots: [paths.home, paths.brain]`. Then run one
     `context.executor.execute({ kind: "project-init", mutations })` and return `journal.id`.

  Any thrown gate or executor error goes through `failureFrom` with its own code.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/project-init.ts apps/cli/src/commands/project-init.test.ts
git diff --cached --name-only
git commit -m "feat(cli): project init writes the template set create-only"
```

---

### Task 9: `project check` · S

**Done 2026-09-22, `f616709`** (D47 lane: lint only, tests and review owed at phase close).

Spec §7 and the §10 row "project check".

**Files:**
- Modify: `apps/cli/src/commands/project-check.ts` (replaces the stub)
- Test: `apps/cli/src/commands/project-check.test.ts`

**Interfaces:**
- Consumes: Task 2's types and `PROJECT_TEMPLATE`; Task 3's `readUntrustedText`; `DoctorCheck`, `readConfigFile`, `readRedactionKey`, `createRedactor`, `failureFrom`.
- Produces:

```ts
export const PROJECT_CHECK_MAX_READ_BYTES = 1024 * 1024;
export const PROJECT_INSTRUCTION_WARN_BYTES = 40_000;
export interface ProjectCheckDependencies {
  readonly cwd: () => string;
  readonly templateNames: readonly string[]; // default PROJECT_TEMPLATE.map((file) => file.name)
}
export function runProjectCheck(context: CliContext, options: ProjectCheckOptions, dependencies?: ProjectCheckDependencies): Promise<CliResult<ProjectCheckReportV1>>;
```

- [x] **Step 1: Write the failing tests.** Inject
  `templateNames: ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]` so every arm is reachable before
  Task 15.
  - **All pass.** Clean `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` give exactly the checks
    `instruction-file`, `instruction-size`, `instruction-secrets` and `template-set`, all `pass`,
    exit 0. Assert the id list first.
  - **`instruction-file` warn.** Neither instruction file exists.
  - **`instruction-size` warn.** `AGENTS.md` at 40,001 bytes; 40,000 passes.
  - **`template-set` warn.** It names `CONTEXT.md` when that file is absent.
  - **Secrets.**
    - `CLAUDE.md` with a synthetic private-key block over lines 3–5 and a `ghp_` token on line 9
      fails exit 5. The message names `CLAUDE.md`, class `private-key` with line `null` (only the
      whole-file pass sees the block) and class `provider-token` at line 9.
    - Neither the token, nor the key, nor any fingerprint appears in the report or in the
      `--json` output.
  - **Over-bound.** A 1,048,577-byte `AGENTS.md` fails `instruction-secrets` with exit 1. A spy on
    the reader proves no more than 1,048,577 bytes were requested.
  - **No write, no key.** A home with no redaction key stays byte-identical, and no key is created.
  - **Relative dir.** `dir` resolves against the injected `cwd`.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/project-check.test.ts`

- [x] **Step 3: Implement.**
  - `root = canonicalize(resolve(cwd(), dir ?? "."))`, which must be a directory (exit 2 otherwise).
  - The scanned set is `unique(["AGENTS.md", "CLAUDE.md", ...templateNames])`.
  - Key: `readRedactionKey(paths.stateDir) ?? randomBytes(32)`. User patterns come from
    `readConfigFile`. A missing or unreadable configuration means `[]`: the check needs no
    installed product.
  - For each present file, call `readUntrustedText(..., PROJECT_CHECK_MAX_READ_BYTES)`. Run the
    whole-file redaction, then each line (split on `\n`, 1-based). A finding is reported at the
    first line whose own redaction yields the same class, and at `null` when no line does.
    Messages hold the file name, class and line only.
  - Build internal `{ check, code }` findings as `doctor` does. Exit 0 if nothing fails. Otherwise
    return `failureFrom` with a `ProjectCheckFailure` whose code is the most severe, a message
    listing the failing lines, and `data: report`.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/project-check.ts apps/cli/src/commands/project-check.test.ts
git diff --cached --name-only
git commit -m "feat(cli): project check reports instruction-file hygiene"
```

---

### Task 10: `doctor` check `vendor-config` · S

**Done 2026-09-22, `d12cf20`** (D47 lane: lint only, tests and review owed at phase close).

Spec §8 and the §10 row "vendor-config is value-free".

**Files:**
- Create: `apps/cli/src/commands/vendor-config.ts`
- Test: `apps/cli/src/commands/vendor-config.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts` (`collectFindings`)
- Modify: `apps/cli/src/commands/doctor.test.ts` (the exact check-id list)
- Modify: `tests/e2e/foundation.test.ts` (`DOCTOR_CHECKS` and the second exact list)

**Interfaces:**
- Consumes: Task 3's `readUntrustedText` and `PROTECTED_PATH_RULES`; Task 5's `CLAUDE_DENY_RULES` and `ClaudeDenyRulesV1`; `DoctorCheck`.
- Produces:

```ts
export const VENDOR_SETTINGS_MAX_BYTES = 1024 * 1024;
export interface VendorConfigDependencies { readonly observation: ClaudeDenyRulesV1 | null } // default CLAUDE_DENY_RULES
/** Never throws, never returns "fail". */
export function checkVendorConfig(context: CliContext, dependencies?: VendorConfigDependencies): Promise<DoctorCheck>;
```

- [x] **Step 1: Write the failing tests** (`vendor-config.test.ts`). The synthetic observation is
  `rules` = one string per `PROTECTED_PATH_RULES` id, for example `Read(synthetic-${id})`. It is
  **not** a claim about Claude's syntax. The file holds only the literals the test writes.
  - **Unobserved.** `observation: null` gives `warn` with the unobserved message, and an
    `fs.lstat` or `guards.readText` spy proves `<user-home>/.claude/settings.json` was never
    touched.
  - **Pass.** Every rule string is present → `pass`.
  - **Missing rules.** Two rules missing → `warn` naming exactly those two **rule ids**, sorted,
    and the recovery text "add these deny rules to your Claude user settings; Developer OS never
    writes that file".
  - **Absent, over-bound, invalid, wrong shape.** Each gives `warn`:
    - the file is absent;
    - it is 1,048,577 bytes;
    - it is invalid JSON, with the fixed message "the Claude user settings file is not valid JSON"
      and no fragment of the input;
    - `permissions.deny` is an object, or an array holding a number.
  - **Value-free.** `env.TOKEN = SENTINEL`, `permissions.allow = [SENTINEL]` and
    `permissions.deny = [SENTINEL, ...rules]` → `pass`. `JSON.stringify` of the check contains no
    `SENTINEL`. Do the same through `run(["doctor"])` and `run(["doctor", "--json"])` on a command
    fixture: no line of `io.out` or `io.err` contains it.
  - **Never fails.** A `guards.readText` that throws `new Error("boom")` still yields `warn`, and
    `doctorExitCode` is unaffected.
  - **`init` surfaces it.** `init`'s verify step turns every `warn` into a result warning
    (`advisoryWarnings`). While `CLAUDE_DENY_RULES` is `null`, every real `init` therefore gains
    the line `vendor-config: …`. Before committing, run
    `grep -rn "warnings).toStrictEqual" apps/cli/src tests` and update any case that pins the exact
    warning list of a real `init` or `doctor` run. At plan writing only `init.test.ts` pinned one,
    and it uses an injected verify report, so it is unaffected. Add any file you change to this
    task's commit.
  - **Codex note.** Every message ends with "Codex is not examined: Developer OS never reads the
    Codex config file".

  `doctor.test.ts`: append `"vendor-config"` after `"codex-capabilities"` in the exact list.
  `tests/e2e/foundation.test.ts`: append it to `DOCTOR_CHECKS` and to the second exact list.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/vendor-config.test.ts src/commands/doctor.test.ts`
  and `npm run build && npx vitest run --root tests e2e/foundation.test.ts`

- [x] **Step 3: Implement.**
  - `checkVendorConfig` wraps its whole body in `try`/`catch`, and any throw returns `warn` with the
    fixed message "the Claude user settings could not be read". **Do not register it through
    `guarded()`**: `guarded` turns a throw into `fail`, which spec §8 forbids.
  - Path: `join(await context.guards.canonicalize(context.userHome), ".claude", "settings.json")`.
  - Read with `readUntrustedText(..., VENDOR_SETTINGS_MAX_BYTES)`. `JSON.parse` sits in its own
    `try`, and its error text is discarded.
  - Take `permissions.deny` only after checking that it is an array of strings, and never read
    another key.
  - `present = new Set(deny)`. A rule id is present when every one of its strings is in
    `present`. Build messages only from constants and rule ids.
  - In `collectFindings`, append `{ check: await checkVendorConfig(context), code: EXIT_CODES.success }`
    after the `codex-capabilities` finding.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/vendor-config.ts apps/cli/src/commands/vendor-config.test.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts tests/e2e/foundation.test.ts
git diff --cached --name-only
git commit -m "feat(cli): doctor reports Claude deny-list coverage without values"
```

---

### Task 11: Import sentinel, interruption and end-to-end gates · M

**Done 2026-09-22, `01bcb16`** (D47 lane: lint only, tests and review owed at phase close).

The §10 rows "redaction precedes everything" (product-home and vault walk), "interruption and
capacity" (repair half), the compiled-binary half of "import happy path", and "no new capability".

**Files:**
- Modify: `tests/security/sentinel.test.ts`
- Modify: `tests/security/interruption.test.ts`
- Create: `tests/e2e/import.test.ts`

**Interfaces:**
- Consumes: Task 7's `runImport(context, options, { cwd })` from `@developer-os/cli/dist/commands/import.js`, and `ImportResultV1`.
- Produces: nothing.

- [x] **Step 1: Write the gates**
  - **`sentinel.test.ts`, new `describe("import")`:**
    - Setup: `installSecurityFixture`, then write `<content>/_raw/inbox/leak.md` holding
      `SENTINEL`, then `runImport`.
    - Walk the product home and the vault with `readFilesUnder`. `SENTINEL` appears in no file
      other than the planted source (Scope decision 12).
    - The planted source is byte-identical to what was written.
    - `staging/` and `backups/` are included explicitly, with a non-empty assertion first.
    - The `--json` line from `run(["import", "--json"], io, () => fixture.context)` does not contain
      it.
  - **`interruption.test.ts`:**
    - Add the target `"the import write"`, mapped to kind `import`, to `TARGETS`, and add its seven
      phases to `EXPECTED_COVERAGE`.
    - The case body plants one inbox file and calls `runImport(fixture.context, { path: null,
      claudeMemory: false, limit: null, dryRun: false })`. It expects `ok: false`, and then the
      existing recovery assertions (`repair --resume` or `--rollback` named).
    - After the file's own `repair`, a rerun imports the file or reports it as a duplicate. It is
      never refused.
  - **`tests/e2e/import.test.ts`**, against the compiled binary with `runJson`, `createTempHome`
    and `installFakeExecutable`, using the arrangement `tests/e2e/knowledge-lifecycle/lifecycle.test.ts`
    already uses. Run `init`, plant two inbox notes, then `import --json`: two `imported`.
    - `review --id <first> --decision accept`, then `ingest --agent <fake> --json` with the fixture
      proposal: exit 0.
    - `brain search <a word from the note>` finds the ingested note.
    - A second `import --json` gives `duplicateCount: 2`.
    - `tests/security/network.test.ts` and `tests/e2e/foundation.test.ts`'s network scan are **not
      edited**. Their unchanged pass at close is the "no new capability" row.
- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close: `npm run build && npx vitest run --root tests security/sentinel.test.ts security/interruption.test.ts e2e/import.test.ts security/network.test.ts`
- [x] **Step 3: Gate and commit**

```bash
npm run lint
git add tests/security/sentinel.test.ts tests/security/interruption.test.ts tests/e2e/import.test.ts
git diff --cached --name-only
git commit -m "test(security): import sentinel, interruption and end-to-end gates"
```

---

### Task 12: `import --claude-memory` · M

**Done 2026-09-22, `5876989`** (D47 lane: lint only, tests and review owed at phase close).

Spec §5.5 and the §10 rows "deduplication is the cursor", "transcripts untouched", "layout
capability" and "bounds" (memory project directories).

**Files:**
- Modify: `apps/cli/src/commands/import.ts`
- Modify: `apps/cli/src/commands/import.test.ts`

**Interfaces:**
- Consumes: Task 5's `CLAUDE_MEMORY_LAYOUT` and `ClaudeMemoryLayoutV1`; Task 7's `processCandidates` and `ImportCandidate`.
- Produces: `ImportDependencies` gains `readonly memoryLayout: ClaudeMemoryLayoutV1 | null`, default `CLAUDE_MEMORY_LAYOUT`.

- [x] **Step 1: Write the failing tests.** Inject a **synthetic** layout:
  `{ claudeVersion: "0.0.0", observedOn: "2026-01-01", observedIn: "synthetic test layout", projectsDirectory: "projects", memoryDirectory: "memory", extension: ".md", indexFileName: "INDEX.md" }`.

  The fixture tree under `<user-home>/.claude/projects/`:
  - `-synthetic-alpha/memory/{one.md, two.md, INDEX.md, notes.txt}`;
  - `-synthetic-alpha/session-0001.jsonl`, a synthetic session log;
  - `-synthetic-beta/memory/three.md`;
  - `-synthetic-gamma/` with no `memory/`;
  - `-synthetic-delta/memory/link.md`, a symlink.

  Wrap `context.fs.readdir`, `context.fs.lstat` and `context.guards.readText` in recording spies.
  - **Layout unobserved.** `memoryLayout: null` refuses exit 4 `claude_memory_layout_unobserved`,
    and the spies record nothing under `<user-home>/.claude`.
  - **Import.**
    - `one.md`, `two.md` and `three.md` are imported with `captureMethod: "import-claude-memory"`
      and `projectSlug: "claude-memory"`.
    - `INDEX.md` and `notes.txt` are ignored (not rows).
    - `link.md` is refused `import_source_symlink` (5).
    - Row paths look like `<16 hex>/one.md`. No row, envelope or output line contains `synthetic`.
  - **Transcripts untouched.** The `readdir` spy's argument set is exactly `{projects, alpha/memory,
    beta/memory, delta/memory}`: no project directory is listed. Assert the set is non-empty and
    equal. No spy call names `session-0001.jsonl`.
  - **Deduplication is the cursor.** A second run gives `files: []`, `duplicateCount: 3`, and no new
    journal. After editing `two.md`, the next run imports exactly one file.
  - **Memory bounds.** 1,000 project directories pass and 1,001 refuse `import_enumeration_limit`
    exit 2 before any read of a memory file.
  - **Refused vendor home.** `<user-home>/.claude/projects` missing refuses
    `import_source_not_found` exit 2.

- [ ] **Step 2: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/import.test.ts -t 'claude-memory|memory'`

- [x] **Step 3: Implement** `enumerateClaudeMemory(context, layout, key)`, which returns
  `{ candidates, preset }`, and replace Task 7's unconditional exit-4 line:
  - A `null` layout refuses exit 4 before any filesystem call.
  - `vendorHome = canonicalize(join(context.userHome, ".claude"))`.
    `projects = join(vendorHome, layout.projectsDirectory)`, which must be a directory (`lstat`,
    not a symlink); otherwise refuse `import_source_not_found`.
  - `readdir(projects)`. More than `IMPORT_MAX_MEMORY_PROJECTS` entries refuses the run.
  - For each entry name, `lstat(join(projects, name, layout.memoryDirectory))`. Continue unless it
    is a real directory. **Never `readdir` the project directory itself.**
  - `readdir(memoryDir)`. Keep names ending in `layout.extension` that are not
    `layout.indexFileName`, and `lstat` each: a regular file is a candidate, a symlink is a
    `refused` preset. Every other name is ignored.
  - Candidate `relative = ${fingerprintDirectory(name, key)}/${file}` and
    `fingerprintSource = name`. Sort by NFC bytes.
  - Call `processCandidates` with `source: "claude-memory"`, `captureMethod:
    "import-claude-memory"` and `projectSlug: "claude-memory"`. The walk counts
    `IMPORT_MAX_ENTRIES_WALKED` across every `readdir` result.
  - `CLAUDE_CONFIG_DIR` is not read. The row does not cover it.

- [x] **Step 4: Gate and commit**

```bash
npm run lint
git add apps/cli/src/commands/import.ts apps/cli/src/commands/import.test.ts
git diff --cached --name-only
git commit -m "feat(cli): import Claude Code auto-memory behind its observed layout"
```

---

### Task 13: Architecture documentation · S

**Done 2026-09-22, `f135510`** (D47 lane: lint only, tests and review owed at phase close); design-spec amendment `6b15604`.

Spec §11, the rows outside `docs/superpowers` and `docs/migration`.

**Files:**
- Modify: `docs/architecture/claude-adapter.md` (a new section "Observation rows used by A14")
- Modify: `docs/architecture/threat-model.md` §5.1 and §7
- Modify: `docs/architecture/knowledge-pipeline.md` §1 and §3
- Modify: `docs/superpowers/specs/2026-07-21-developer-os-design.md` §8 (command list amendment note) and §12 (the `_raw/processed/` note)

**Interfaces:**
- Consumes: Tasks 7–12 as integrated, because the docs describe shipped behaviour.
- Produces: nothing code-facing.

- [x] **Step 1: Write.**
  - **`claude-adapter.md`:**
    - `CLAUDE_MEMORY_LAYOUT` and `CLAUDE_DENY_RULES` exist in `packages/adapter-claude/src/observations.ts`, both
      `null` until Task 14.
    - `import --claude-memory` lists only `projects/` and each `memory/` directory, and never a
      project directory.
    - `vendor-config` **reads, never writes**, the user settings file, and only
      `permissions.deny`.
  - **`threat-model.md`:**
    - §5.1: `import` is a second entrance into quarantine. It is bounded, redacted before
      persistence, and does not archive (Q5 A).
    - §7: absent capabilities are unchanged — no network, no new spawn, no transcript read, no
      vendor config write.
  - **`knowledge-pipeline.md`:**
    - §1: `import` sits beside `capture`.
    - §3: the four `captureMethod` values; import captures are not manifest rows.
  - **Design §8:** an amendment note adding `import`, `project init` and `project check`.
  - **Design §12:** "`_raw/processed/` is created by `init` and written by no product verb (A14
    Q5 A)."
  - Name symbols, never `path:line` (the citations gate).
- [x] **Step 2: Gate and commit**

```bash
npm run lint
git add docs/architecture/claude-adapter.md docs/architecture/threat-model.md docs/architecture/knowledge-pipeline.md
git add -f docs/superpowers/specs/2026-07-21-developer-os-design.md
git diff --cached --name-only
git commit -m "docs: record import, project verbs and vendor-config in the architecture notes"
```

The design-spec edit is under `docs/superpowers/`, so the orchestrator makes this commit, or
cherry-picks an implementer's commit and adds that one path itself.

---

### Task 14: Record the Claude observations · S — **FOUNDER STOP POINT**

**Open (founder stop).** Not observed; `CLAUDE_MEMORY_LAYOUT` and `CLAUDE_DENY_RULES` stay `null`, so `import --claude-memory` exits 4 and `vendor-config` warns (BACKLOG NEW-109).

Spec §5.5 "Capability precondition" and §8 "exact rule strings are vendor syntax". An agent never
observes these facts. It does not run Claude Code, read the founder's `~/.claude`, or write a
value from memory or documentation.

**Files:**
- Modify: `packages/adapter-claude/src/observations.ts`
- Create: `tests/fixtures/claude/memory-layout/README.md` (a synthetic-tree description; no real data)
- Modify: `docs/architecture/claude-adapter.md` (the dated observation section)

**Interfaces:**
- Consumes: Tasks 5, 10, 12, 13.
- Produces: non-`null` `CLAUDE_MEMORY_LAYOUT` and/or `CLAUDE_DENY_RULES`.

- [ ] **Step 1: STOP and ask the founder.** The orchestrator asks for one observation on a
  **disposable** home with the Claude Code version A12 pinned. It must not be the founder's working
  `~/.claude`. Ask for:
  1. the directory layout auto-memory writes, relative to the vendor home (expected
     `projects/*/memory/*.md`), and the exact name of the index file kept beside the memory files;
  2. whether `CLAUDE_CONFIG_DIR` moves it;
  3. for each rule id in `PROTECTED_PATH_RULES`, the exact `permissions.deny` string or strings
     that Claude Code enforces as a read denial of that path, each proven by a denied read in that
     disposable session;
  4. the Claude Code version, the date, and one sentence of method.
  **Status:** Owed: founder observation on a disposable home (NEW-109).

  If the founder does not observe now, the orchestrator adds `BACKLOG.md` row "A14 observations
  owed: `CLAUDE_MEMORY_LAYOUT`, `CLAUDE_DENY_RULES` (Task 14)" and skips to Task 16. Both verbs stay
  safe: exit 4 and `warn`.
- [ ] **Step 2: Record only what was observed.** Fill each row verbatim from the founder's answer,
  and leave an unobserved row `null`. Add the dated section to `claude-adapter.md` in the
  `AGENT_DETECTION_ROWS` style: version, date, method, values. Describe the synthetic fixture tree
  that Task 12's test builds.
- [ ] **Step 3: Test.** Task 5's `observations.test.ts` now validates the rows. Deferred to phase
  close (D47). At close: `npx vitest run --root packages/adapter-claude src/observations.test.ts`
- [ ] **Step 4: Gate and commit**

```bash
npm run lint
git add packages/adapter-claude/src/observations.ts tests/fixtures/claude/memory-layout/README.md docs/architecture/claude-adapter.md
git diff --cached --name-only
git commit -m "feat(adapter-claude): record observed memory layout and deny rules"
```

---

### Task 15: Project template content through A12's redaction procedure · M

**Partial 2026-09-22, `10282ab`** (agent scan 0 findings without a pattern file). Owed: the founder-local `--patterns` scan and an independent content review.

Spec §6 "Template set" and the §10 row "templates are clean". **Spec gap, decided here:**
- A12 §1 puts "`project init` templates (A14)" out of its scope.
- A14 §6 says "A12 supplies the content through its redaction step".
- So no one writes the prose. This task writes it, **using A12 §3.3's clean-room procedure
  unchanged**:
  - the founder supplies each legacy artifact through an owner-controlled process;
  - the agent never reads a legacy source path;
  - the default is reconstructed and reviewed as a publication candidate.

**Precondition:** A12's plan has integrated the §3.3 gate files `tests/repository/instruction-defaults.test.ts`
and `tests/tools/scan-instruction-defaults.ts`. If they are absent, stop and ask. Do not write a
second scanner.

**Files:**
- Create: `templates/project/AGENTS.md`, `templates/project/CLAUDE.md`, `templates/project/<signpost name>` (at most 8 files in total, flat)
- Modify: `apps/cli/src/commands/project-template.ts` (`PROJECT_TEMPLATE` embedded, byte for byte)
- Create: `apps/cli/src/commands/project-template.test.ts`
- Modify: `tests/repository/instruction-defaults.test.ts` (scan roots gain `templates/project/`)

**Interfaces:**
- Consumes: Tasks 8 and 9; A12's scanner.
- Produces: a non-empty `PROJECT_TEMPLATE`. `project init` stops refusing exit 4.

- [x] **Step 1: STOP and ask the founder** for:
  - the legacy project instruction file and the project context signpost, through the
    owner-controlled process;
  - the signpost's file name in the product.
- [x] **Step 2: Write the failing test** `project-template.test.ts`:

```ts
const ROOT = fileURLToPath(new URL("../../../../templates/project", import.meta.url));
it("embeds templates/project byte for byte, flat, within bounds, finding-free", async () => {
  const names = (await readdir(ROOT)).sort();
  expect(names.length).toBeGreaterThan(0);
  expect(names).toStrictEqual(["AGENTS.md", "CLAUDE.md", "<signpost name>"].sort()); // exact set pinned
  expect(names.length).toBeLessThanOrEqual(PROJECT_TEMPLATE_MAX_FILES);
  expect(PROJECT_TEMPLATE.map((file) => file.name).sort()).toStrictEqual(names);
  const redact = createRedactor(randomBytes(32));
  for (const file of PROJECT_TEMPLATE) {
    const bytes = await readFile(join(ROOT, file.name));
    expect(bytes.equals(Buffer.from(file.content, "utf8")), file.name).toBe(true);
    expect(bytes.byteLength).toBeLessThanOrEqual(PROJECT_TEMPLATE_MAX_BYTES);
    expect(redact(file.content).findings, file.name).toStrictEqual([]);
  }
});
```

Replace `<signpost name>` with the founder's answer from Step 1.

- [x] **Step 3: Write the content.**
  - Use A12 §3.3's redaction classes: no client, project, person, machine path, private
    repository, secret or personal preference.
  - The instruction files point at product verbs (`developer-os capture`, `developer-os brain
    search`), never at legacy scripts.
  - Embed each file into `PROJECT_TEMPLATE` as a JSON-escaped string literal, the way
    `brain-template.ts` embeds `templates/brain/`.
  - Extend `instruction-defaults.test.ts`'s scanned roots with `templates/project/`.
- [ ] **Step 4: Founder-local scan and review.** The founder runs
  `node tests/dist/tools/scan-instruction-defaults.js --patterns <private file>` over
  `templates/project/`. The commit message records the finding count (zero) and the command, never
  the pattern file. An independent reviewer reads the files before staging (A12 §3.3).
  **Status:** Owed: founder-local `--patterns` scan; independent review not recorded.
- [ ] **Step 5: Run the tests.** Deferred to phase close (D47). At close:
  `npx vitest run --root apps/cli src/commands/project-template.test.ts src/commands/project-init.test.ts` and
  `npx vitest run --root tests repository/instruction-defaults.test.ts`
- [x] **Step 6: Gate and commit**

```bash
npm run lint
git add templates/project/AGENTS.md templates/project/CLAUDE.md "templates/project/<signpost name>" apps/cli/src/commands/project-template.ts apps/cli/src/commands/project-template.test.ts tests/repository/instruction-defaults.test.ts
git diff --cached --name-only
git commit -m "feat(templates): project instruction templates, redacted (A12 §3.3)"
```

---

### Task 16: Phase 7 close · M (orchestrator + founder)

**Open.** Nothing below has run.

**Files:**
- Modify: `docs/migration/instruction-inventory.md` (A14 rows: `planned` → `shipped`)
- Modify: `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`, the roadmap (Phase 7 tick), this plan (ticks)

**Interfaces:**
- Consumes: every task above.

- [ ] **Step 1: The founder runs the deferred suites once, on the integrated tree** (D47). Record
  only the failures:

```bash
npm run link:tests
npm run check
npx vitest run --root apps/cli src/main.test.ts src/commands/untrusted-file.test.ts src/commands/quarantine.test.ts src/commands/capture.test.ts src/commands/import.test.ts src/commands/project-init.test.ts src/commands/project-check.test.ts src/commands/project-template.test.ts src/commands/vendor-config.test.ts src/commands/doctor.test.ts
npx vitest run --root packages/security src/protected-paths.test.ts src/index.test.ts
npx vitest run --root packages/brain src/capture/build.test.ts
npx vitest run --root packages/adapter-claude src/observations.test.ts src/index.test.ts
npm run build && npx vitest run --root tests repository/workspace-links.test.ts repository/redactor-entry.test.ts repository/transcript-path.test.ts security/sentinel.test.ts security/interruption.test.ts security/network.test.ts e2e/import.test.ts e2e/foundation.test.ts
```

`npm run check` already includes the others. They are listed so that a red `check` can be bisected
per file.

- [ ] **Step 2: One fresh-context review** of the whole diff since this plan's base, by an agent
  that authored none of Tasks 2–15 (`superpowers:requesting-code-review`). Give it the spec, this
  plan and the diff. Every accepted finding gets a failing regression test first, then the smallest
  correction, then `npm run lint`. Rerun the affected files from Step 1.
- [ ] **Step 3: Re-read the §2 gate.** Every inventory §5 row and the three §6 template rows are
  `shipped` or `refused (D47)`. Task 1's grep again finds only refusal text.
- [ ] **Step 4: Stop conditions (founder).**
  - If Task 15 did not land, `project init` still refuses exit 4. Ask whether that satisfies the
    Phase 7 gate or whether the phase stays open. Do not decide it.
  - If Task 14 did not land, confirm its BACKLOG row exists. `--claude-memory` exits 4 and
    `vendor-config` warns: the verbs exist, their vendor facts are owed.
- [ ] **Step 5: Bookkeeping.** Tick the roadmap's Phase 7, remove A14 from `ORDER.md`'s open
  entries and advance `NOW`, close NEW-98 in `BACKLOG.md`, and flip the inventory rows. Then push
  one branch and open **one PR** (D44/D47). Do not merge; the founder merges.

```bash
npm run lint
git add docs/migration/instruction-inventory.md
git add -f docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/plans/2026-09-22-developer-os-tooling-verbs.md
git diff --cached --name-only
git commit -m "docs: close roadmap Phase 7 (A14)"
```

---

## Spec Coverage Index

| Spec section | Task |
|---|---|
| §0 Q1–Q5 (all A, D47) | 1 (refusal text); Scope decisions 1, 2; Q5 C excluded throughout |
| §1 invariants | Global Constraints; 7, 10, 11 |
| §1 automation note | 1 (D47 resolution) |
| §2 disposition table | 1, 16 |
| §3 command surface | 2 |
| §4.1 exit codes | Global Constraints; 7, 9 |
| §4.2 untrusted reads | 3 |
| §4.3 redaction | Global Constraints; 7, 8, 9 |
| §4.4 bounds | Global Constraints table; 7, 8, 9, 10, 12, 15 |
| §5.1–§5.4, §5.6, §5.7 | 7 (and 11 for the sentinel and interruption gates) |
| §5.4.1 | not built (Q5 A) |
| §5.5 | 5, 12, 14 |
| §6 | 2, 8, 15 |
| §7 | 9 |
| §8 | 3, 5, 10, 14 |
| §9 | 1 |
| §10 rows | dispatch 2 · import happy path 7, 11 · dedup cursor 12 · redaction 7, 11 · interruption and capacity 7, 11 · path policy 7 · bounds 7, 12 · transcripts 12 · layout capability 7, 12 · dry run 7, 8 · project init 8 · templates clean 15 · project check 9 · vendor-config 10 · no new capability 11, 16 |
| §11 documents | 1, 13 |
| §12 sequence | waves above; step 3's red-first is moot under D47 (Scope decision 13) |
| §13 residuals | item 1 not applicable (Q5 A); items 2–5 unchanged, restated in 13 |
| Q3 A NEW-98 | 6 |
