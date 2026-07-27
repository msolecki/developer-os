# Developer OS — Outstanding Work Backlog

Single index of everything that still has to be done, for this product and for the
founder's legacy runtime. Consolidated on 2026-07-27 from `~/claude-shared` and
`~/brain`; neither of those repositories holds plans, specs, or open roadmap items any
more.

**Rules for this file**

- Every new plan or spec is registered here in the same change that creates it.
- Status values: `done`, `in progress`, `open`, `blocked`, `decision required`.
- A step is `done` only when its own evidence exists. A passing local tree is not
  evidence; a commit is.
- **`plans/` and `specs/` hold only unfinished work.** When a plan's last step is done,
  delete the file in the same commit that closes it, after carrying any evidence a later
  step still needs into the document that needs it. Git history is the archive — do not
  keep a `completed/` or `archive/` directory.
- Specs are exempt from the rule above while their subsystem is unfinished: a design
  document is a reference for review and drift checks, not an executed artifact.
- `docs/superpowers/plans/legacy-runtime/` is publication-excluded. Nothing in it may be
  copied into a public artifact.

---

## 0. Status at a glance

| Area | Documents | Progress |
|---|---|---|
| Program (umbrella) | 1 plan | Task 0 artifacts exist, Task 1 in progress, Tasks 2–9 open |
| Foundation | 1 plan + 1 spec | 23/51 steps; Tasks 1–4 committed, 5 in progress, 6–9 open |
| Kernel transaction lock | 1 plan + 1 spec | 11/15 steps; code written, **not committed** |
| Subsystem specs | 0 of 6 written | all open |
| Subsystem plans | 0 of 6 written | all open |
| Legacy runtime | 1 plan | 0/14 steps, four of them P0 |

Every document still present has open work. One plan was completed and retired on
2026-07-27: the brain/claude-shared English migration (all five steps done and reviewed
on 2026-07-20). It is recoverable from commit `28a0ddc`; its regression baseline was
carried into follow-up Step 3 before removal.

---

## 1. Blocking right now

### ACT-1 — Commit the kernel transaction lock (Foundation Task 5)

- **Status:** in progress, 11/15
- **Plan:** `plans/2026-07-22-developer-os-kernel-transaction-lock.md`
- **Spec:** `specs/2026-07-22-developer-os-kernel-transaction-lock-design.md`
- **Problem:** Task 1 (6/6) and Task 2 (5/5) are implemented but exist only in the
  working tree — 12 untracked files under `packages/core/src/transactions/` and
  `packages/platform-macos/`, plus 5 modified tracked files. Every other checkout is
  red. This is the exact failure mode recorded as SEC-105.
- **Remaining (plan Task 3, 0/4):**
  1. Audit the final diff against the approved design.
  2. Run all repository and security gates (`npm run check`, gitleaks).
  3. Obtain a fresh-context code review from an agent that is not the author.
  4. Stage the exact Task 5 paths and commit.
- **Nothing else in this backlog should start before ACT-1 closes.**

### ACT-2 — Reconcile program-plan bookkeeping

- **Status:** open
- **Problem:** `plans/2026-07-21-developer-os-program.md` shows 0/71 checkboxes, but
  Task 0's three artifacts already exist in `docs/migration/` and Task 1 is four tasks
  deep. The plan understates real progress, so a fresh session would redo Task 0.
- **Do:** Check off Task 0's seven steps against the artifacts actually present, and
  mark Task 1 as in progress with a pointer to the Foundation plan's task counter.

### ACT-3 — Name the publication-excluded path in the exclusion policy

- **Status:** done 2026-07-27
- **Problem:** `docs/migration/exclusion-policy.md` predated
  `docs/superpowers/plans/legacy-runtime/` and did not name it. The path holds legacy
  machine detail and a credential-rotation checklist.
- **Done:** the path is now in the prohibited-material list.
- **Still owed:** re-run the candidate-only secret scan over the repository before any
  publication step, because the repository now carries legacy machine detail it did not
  carry when Task 0's evidence was produced.

---

## 2. Foundation — remaining tasks

Plan: `plans/2026-07-21-developer-os-foundation.md`. Spec: `specs/2026-07-21-developer-os-design.md`.
All steps are already written; nothing new needs authoring here.

| Task | Steps | Status | Produces |
|---|---|---|---|
| 1. Clone safely, repository gate | 8/8 | done | workspace, lint/test/build gate |
| 2. CLI result and error contracts | 4/4 | done | `CliResult`, stable exit codes |
| 3. Strict configuration and runtime paths | 5/5 | done | `DeveloperOsConfigV1` |
| 4. Path, redaction, process primitives | 6/6 | done | `SecurityPolicy` |
| 5. Recoverable filesystem transactions | 0/5 | in progress via ACT-1 | `TransactionStore` |
| 6. Owned artifacts and configuration drift | 0/5 | open | `InstallationManifestV1`, three-way drift evidence |
| 7. macOS platform boundary | 0/4 | open | `PlatformAdapter` facts and discovery |
| 8. No-agent CLI lifecycle | 0/7 | open | `init`, `status`, `doctor`, `repair`, `uninstall` |
| 9. Temporary-HOME lifecycle proof | 0/7 | open | E2E suite, `docs/architecture/` first entries |

**Foundation completion gate** (all must hold before Program Task 2 may start):
`npm run lint && npm test`, `pnpm build`, and `pnpm test:e2e` pass freshly; the
temporary-HOME lifecycle is idempotent; interruption recovery and rollback pass at every
phase; overlap, symlink escape, drift, forged manifest, and secret sentinel cases fail
closed; no real agent config, Brain, credential, scheduler, Git remote, or network is
touched; fresh-context review has no unresolved P0/P1 finding; the working tree is clean.

> Note: Foundation Task 7 was rewritten on 2026-07-22 from *Create* to *Modify* because
> the kernel-lock work already created `packages/platform-macos/`. Do not re-scaffold it.

---

## 3. Missing specs and plans

Twelve documents. Each subsystem after Foundation requires an approved spec **and** an
implementation plan before any code work — this is a Global Constraint of the program
plan, not a preference. Every spec starts with a brainstorming/approval cycle.

### DOS-P2 — Brain engine

- **Spec:** `specs/2026-07-21-developer-os-brain-engine-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-brain-engine.md` — missing
- **Program task:** 2 · **Complexity:** L · **Blocked by:** Foundation completion gate
- **Parallel with:** DOS-P3, once Foundation interfaces are frozen
- **The spec must decide:**
  - note schema and frontmatter version; required fields per note type
  - folder policy: which trees are canonical, and that raw, quarantine, outputs,
    templates and `.obsidian` internals are never scanned as canonical notes
  - lifecycle statuses and the confidence model
  - topic aliases: `PROJEKTY` and `NARZEDZIA` resolve without automatic renames
  - index formats for `vault-map`, `catalog`, and graph, and their determinism contract
  - lint classes: frontmatter, provenance, links, duplicates, staleness, generated-index drift
  - retrieval contract: index-first, explicit maximum candidate count, source paths returned
  - contents of the synthetic public vault template — no founder, client, or repository names
- **The plan must contain:** exact schemas, golden fixtures, and a read-only
  compatibility harness against a redacted structural fixture derived from
  `docs/migration/source-manifest.json`.
- **Produces:** `BrainConfigV1`, `NoteFrontmatterV1`, `CaptureEnvelopeV1`,
  `IndexBuildResult`, `LintResult`, `RetrievalQuery`, `RetrievalResult`, `BrainMigration`,
  `BrainService`.
- **Gate:** index rebuilds are byte-for-byte deterministic under a frozen clock; every
  retrieval claim resolves to a selected canonical note.
- **Creates:** `packages/brain/src/{schema,indexes,lint,retrieval,migrations}/`,
  `templates/brain/`, `tests/{contracts,fixtures,integration}/brain/`.

### DOS-P3 — Workflow compiler

- **Spec:** `specs/2026-07-21-developer-os-workflow-compiler-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-workflow-compiler.md` — missing
- **Program task:** 3 · **Complexity:** L · **Blocked by:** Foundation completion gate
- **The spec must decide:**
  - the canonical workflow schema: identity, semantic version, triggers, inputs,
    read/write scopes, required capabilities, refusals, steps, structured result,
    validators, recovery
  - strict parsing that rejects unknown fields for v1 contracts
  - the renderer interface boundary — no vendor behavior inside canonical workflows
  - which workflows ship: `shared`, `brain-search`, `capture`, `review`, `ingest`, `doctor`
  - generated-artifact markers and the CI drift check
- **Negative fixtures required:** missing capability, excessive write scope, prompt
  instructions embedded inside source data, incompatible schema version.
- **Produces:** `WorkflowContractV1`, `WorkflowCapability`, `WorkflowInputSchema`,
  `WorkflowOutputSchema`, `WorkflowRenderer`, `RenderedArtifact`, `WorkflowValidationResult`.
- **Gate:** a vendor overlay can never weaken a canonical refusal or widen write scope;
  generated output changes only when canonical source or renderer changes.
- **Creates:** `packages/workflow-schema/src/`, `workflows/*`, `tests/{contracts,fixtures}/workflows/`.

### DOS-P4 — Claude Code adapter

- **Spec:** `specs/2026-07-21-developer-os-claude-adapter-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-claude-adapter.md` — missing
- **Program task:** 4 · **Complexity:** L · **Blocked by:** DOS-P3 schemas frozen
- **The spec must decide:** supported-version discovery, plugin structure, hook payloads,
  wrapper behavior, semantic config merge, failure contracts, which lifecycle surfaces
  are verified enough for SessionStart injection and automatic capture, and when to fall
  back to `developer-os run claude`.
- **Produces:** `ClaudeAdapter`, `ClaudeCapabilities`, `ClaudeInvocation`, `plugins/claude/`,
  managed hook plans, structured agent-run results.
- **Gate:** fake-CLI tests pin argv, stdin, environment, timeout, signal, exit and
  malformed-output behavior; install/update/uninstall preserves unrelated Claude settings;
  an unsupported version reports exact missing capabilities rather than partial success.
- **Checkpoint:** a Claude-only user completes the full synthetic Brain workflow with no
  Codex installed.

### DOS-P5 — Codex adapter

- **Spec:** `specs/2026-07-21-developer-os-codex-adapter-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-codex-adapter.md` — missing
- **Program task:** 5 · **Complexity:** L · **Blocked by:** DOS-P3 schemas frozen
- **The spec must decide:** exactly which Codex surfaces are supported, verified against
  current official documentation *and* local behavior; how canonical workflows render into
  Codex skills and `AGENTS.md` guidance at the smallest appropriate scope; and the
  refusal rule — no transcript parsing unless a stable documented contract exists with a
  regression fixture.
- **Produces:** `CodexAdapter`, `CodexCapabilities`, `CodexInvocation`, `plugins/codex/`,
  managed hook plans, structured agent-run results.
- **Gate:** direct and wrapper capability matrices are tested separately; a missing
  capture hook is classified `wrapper-required`, never a false `yes`.
- **Absorbs:** legacy follow-up Step 8 (`Add stable Codex learning capture`) as a product
  feature. The legacy obligation still stands separately — see LEGACY-8.

### DOS-P6 — Knowledge pipeline hardening

- **Spec:** `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-knowledge-pipeline.md` — missing
- **Program task:** 6 · **Complexity:** L · **Blocked by:** DOS-P4 **and** DOS-P5
- **The spec must decide:** exact capture fields, lifecycle transitions, retention
  behavior and redaction classes; atomic quarantine writes with post-redaction
  deduplication; accept/edit/reject review with no automatic deletion; the contract that
  marks all source material as untrusted data and restricts agents to staging-only writes.
- **Required tests:** sentinel secret, prompt injection, symlink escape, multiline
  command, malformed manifest, interruption at every phase.
- **Produces:** complete `CaptureEnvelopeV1` transitions, `ReviewDecision`,
  `IngestProposal`, `IngestValidationResult`, `ApplyResult`, recovery commands.
- **Gate:** the same secret sentinel is absent from capture, logs, hashes, model input,
  staging, reports and canonical notes; model output cannot widen write scope; failure
  leaves the capture retryable and never marks it ingested. Independent security review
  is required before the checkpoint.
- **Absorbs:** legacy follow-up Steps 5, 9 and 12 as product features.

### DOS-P7 — Git, automation, update and release lifecycle

- **Spec:** `specs/2026-07-21-developer-os-lifecycle-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-lifecycle.md` — missing
- **Program task:** 7 · **Complexity:** L · **Blocked by:** DOS-P6
- **The spec must decide:** Git initialization, existing-remote connection, scoped
  staging, commit, push and every error state; the exact `launchd` jobs, schedules, logs,
  lock ownership and opt-in boundaries; signed/checksummed release metadata; dry-run
  updates; schema-migration staging and rollback.
- **Produces:** `GitSyncConfigV1`, `AutomationConfigV1`, `LaunchdPlan`, `UpdatePlan`,
  `SchemaMigrationPlan`, verified uninstall/rollback results.
- **Gate:** a Git-disabled and automation-disabled install performs no related process or
  network call; push failure never records a successful sync; update refuses drift;
  uninstall removes only manifest-owned artifacts.
- **Absorbs:** legacy follow-up Step 6 (real-Git integration coverage) as a product feature.

---

## 4. Program tasks 8 and 9 — artifacts, and one open decision

### DOS-P8 — Founder shadow migration

- **Status:** open · **Blocked by:** DOS-P7
- **Artifacts required (none exist):** `docs/migration/founder-cutover.md`,
  `founder-baseline-results.json`, `founder-shadow-results.json`,
  `founder-cutover-manifest.json`.
- **Decision required:** the program plan enumerates ten steps inline and does not
  mandate a dedicated spec or plan. **Recommendation: author a plan anyway.** This is the
  only task that mutates the founder's live machine, and its rollback must be rehearsed
  before cutover is declared complete.
- **Hard invariants:** `~/brain` is not moved; legacy recovery data is not deleted; two
  copies of a mutating hook are never enabled at once; legacy hooks and jobs are disabled
  only after new evidence passes, and are never deleted.

### DOS-P9 — Public beta and v1

- **Status:** blocked · **Blocked by:** DOS-P8
- **Artifacts required (none exist):** `README.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, approved `LICENSE`, `docs/install/`, `docs/tutorials/`,
  `docs/troubleshooting/`, `docs/releases/`, `docs/privacy.md`,
  `.github/workflows/{ci,release}.yml`, Homebrew formula source, macOS Apple Silicon and
  Intel packaging configuration.
- **Decision required:** same as DOS-P8 — no dedicated plan is mandated. The program
  verification matrix is probably sufficient here; confirm before starting.
- **Two external blockers that are not engineering work:**
  - **Legal.** An OSI-approved license must be selected and approved by qualified
    counsel. Blocks public visibility.
  - **Remote verification.** Recorded as `blocked_by_environment`. No fetch, push, PR, or
    public release until the founder verifies the destination remote, visibility and
    branch protections in an authorized environment.

---

## 5. Missing repository infrastructure

Named in the program file map, not yet created. Each is created by its first owning
subproject; listed here so nothing is discovered late.

| Path | First owner | Status |
|---|---|---|
| `tests/contracts/` | Foundation onward | missing |
| `tests/fixtures/` | Foundation onward | missing |
| `tests/integration/` | Foundation onward | missing |
| `tests/e2e/` | Foundation Task 9 | missing — `npm run test:e2e` currently has no target |
| `tests/security/` | DOS-P6 | missing |
| `docs/architecture/` | Foundation Task 9, then per subsystem | missing — must cover product boundaries, workflow schema, threat model, capability model |
| `docs/releases/` | DOS-P7 | missing |
| `packages/brain/` | DOS-P2 | missing |
| `packages/workflow-schema/` | DOS-P3 | missing |
| `packages/adapter-claude/`, `plugins/claude/` | DOS-P4 | missing |
| `packages/adapter-codex/`, `plugins/codex/` | DOS-P5 | missing |
| `workflows/`, `templates/brain/` | DOS-P2 / DOS-P3 | missing |

---

## 6. Legacy runtime obligations

Plan: `plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md` — **0 of 14
steps done.** These execute against `~/brain` and `~/claude-shared`, not against this
repository. They are tracked here because that is where the founder's outstanding work
now lives, and because Developer OS Task 0 consumes the document as a canonical input.

| ID | Pri | Step | Owner | Status |
|---|:---:|---|---|---|
| LEGACY-0 | P0 | Preserve and classify both working trees | Agent + Founder | open |
| LEGACY-1 | P0 | Rotate historical credential candidates | **Founder only** | open |
| LEGACY-2 | P0 | Resolve the non-npm commit-gate contradiction | Agent + Founder | open |
| LEGACY-3 | P0 | Review and land the English migration | Agent + Founder | blocked by 0–2 |
| LEGACY-4 | P1 | Resolve live/template configuration drift | Agent + Founder | open |
| LEGACY-5 | P1 | Replace false-green Brain validation | Agent | open |
| LEGACY-6 | P1 | Test weekly automation against real Git | Agent | open |
| LEGACY-7 | P1 | Close scanner coverage gaps | Agent | open |
| LEGACY-8 | P1 | Add stable Codex learning capture | Agent | open |
| LEGACY-9 | P2 | Enforce the Brain schema and graph policy | Agent | open |
| LEGACY-10 | P2 | Measure retrieval quality | Agent | open |
| LEGACY-11 | P2 | Add a unified read-only doctor | Agent | open |
| LEGACY-12 | P2 | Add proposal lifecycle and observability | Agent | open |
| LEGACY-13 | P3 | Curate content and archive provenance | Agent + Founder | open |

**Two things that are more urgent than they look:**

- **LEGACY-1** treats four historical credential findings as active until a provider
  proves otherwise: the Taxos AWS key, the KM Energy Monitoring AWS key, the shared
  VAV/Vavita Zindigi AWS key, and historical authentication/email credentials in
  Przedsiębiorcze Trójmiasto. The founder waived these as *Developer OS publication*
  blockers on 2026-07-21. The waiver does not rotate anything. This step has been pending
  since 2026-07-20.
- **LEGACY-3** is the durability problem: `~/claude-shared` carries roughly 136 changed
  or untracked entries and `~/brain` about 169, including a validated but uncommitted
  English migration. A passing dirty tree is not a recoverable checkpoint.

**Open proposals feeding these steps** (in `~/brain/content/_outputs/proposals/`, left in
place as private Brain content):

- `2026-07-19-historical-secret-triage.md` → LEGACY-1
- `config-drift.md` → LEGACY-4

**Relationship to Developer OS.** DOS-P5 absorbs LEGACY-8, DOS-P6 absorbs LEGACY-5, -9
and -12, DOS-P7 absorbs LEGACY-6. Building the product feature does **not** discharge the
legacy obligation: the founder's current machine keeps running the old runtime until
DOS-P8 cutover completes.

**Retired 2026-07-27:** the English migration plan that produced the current dirty trees
was completed and reviewed on 2026-07-20, so it was deleted rather than archived (commit
`28a0ddc` holds it). Its only unresolved consequence is LEGACY-3, and its evidence numbers
now live in that step as the regression baseline the staged tree must reproduce.

---

## 7. Standing gates

Copied here so they are visible without opening the program plan.

| Gate | Evidence | Blocks |
|---|---|---|
| Repository validation | `npm run check` (`lint && test && build && git diff --check`) | every commit |
| Fresh-context review | a reviewing agent that is not the author, per code-producing task | every commit |
| Exact-path staging | never `git add -A`; stage only task-owned paths | every commit |
| Generated artifacts | clean regeneration diff | adapter commits, release |
| Security suites | sentinel, path, prompt injection, transaction, network | DOS-P6 onward |
| Agent compatibility | disposable real-agent matrix | DOS-P8, release |
| Migration | shadow comparison plus an exercised rollback | public beta |
| License | OSI-approved text reviewed by qualified counsel | public visibility |
| Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

---

## Appendix — outstanding outside this repository

Not Developer OS work; recorded so it is not lost. `dev/active/` and `.claude/plans/`
were deprecated on 2026-07-18 and are to be migrated to `docs/superpowers/plans/`
opportunistically. As of 2026-07-27, 28 files remain on the deprecated paths:

| Location | Files | Has `docs/superpowers/`? |
|---|---:|---|
| `~/.claude/plans/` | 1 | n/a — user level |
| `~/www/taxos/.claude/plans/` | 6 | yes |
| `~/www/km-energy-monitoring/.claude/plans/` | 7 | yes |
| `~/www/przedsiebiorcze-trojmiasto/.claude/plans/` | 4 | yes |
| `~/www/vavita-app/.claude/plans/` | 3 | yes |
| `~/www/whyconsulting/dev/active/redesign-observatory/` | 5 | yes |
| `~/www/plazownik/.claude/plans/` | 1 | no |
| `~/www/msp-checklist/.claude/plans/` | 1 | no |

`~/claude-shared` and `~/brain` are clean as of 2026-07-27: no `.claude/plans/`, no
`dev/active/`, no `docs/superpowers/`.
