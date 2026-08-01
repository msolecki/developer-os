# Developer OS — Outstanding Work Backlog

> **Starting a session? `SESSION.md`. Looking for what to do next? `ORDER.md`.**
> Three files, one job each: `SESSION.md` is the procedure, `ORDER.md` is the queue, and
> this one is the reference — what each outstanding document must contain and why it
> exists.

Single index of everything that still has to be done, for this product and for the
founder's legacy runtime. Consolidated on 2026-07-27 from `~/claude-shared` and
`~/brain`; neither of those repositories holds plans, specs, or open roadmap items any
more.

**Rules for this file**

- Order lives in `ORDER.md` and detail lives here. When they disagree about sequence,
  `ORDER.md` wins; when they disagree about content, this file wins. Never copy a
  requirement into `ORDER.md` — link to the section instead.
- Every new plan or spec is registered here in the same change that creates it, and gets a
  row in `ORDER.md` in that same change.
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
| Program (umbrella) | 1 plan | Task 0 **complete**, Task 1 in progress, Tasks 2–9 open |
| Foundation | 1 spec (plan deleted) | 51/51 steps; **complete 2026-08-01** |
| Kernel transaction lock | 1 plan + 1 spec | 15/15 steps; **committed 2026-07-27** |
| Subsystem specs | 0 of 6 written | all open |
| Subsystem plans | 0 of 6 written | all open |
| Legacy runtime | 1 exit checklist | 3 items, all P0; 10 former items frozen |

Every document still present has open work. One plan was completed and retired on
2026-07-27: the brain/claude-shared English migration (all five steps done and reviewed
on 2026-07-20). It is recoverable from commit `28a0ddc`; its regression baseline was
carried into EXIT-3 before removal.

**Self-containment.** As of 2026-07-27 no Developer OS task reads `~/claude-shared`,
`~/brain`, or any `DEVELOPER_OS_SOURCE_*` path. Program Task 0 froze everything the build
needs into `docs/migration/`, and its manifest admitted exactly three files — all already
here. The only remaining contact with the legacy machine is the exit checklist in §6 and
the read-only cutover in DOS-P8, both of which operate on the founder's machine as user
data, not as source material.

---

## 1. Blocking right now

### ACT-1 — Commit the kernel transaction lock (Foundation Task 5)

- **Status:** done 2026-07-27, 15/15
- **Plan:** deleted on completion per the rule above; recover from git history.
- **Spec:** `specs/2026-07-22-developer-os-kernel-transaction-lock-design.md`, retained.
- **Was:** Task 1 (6/6) and Task 2 (5/5) were implemented but existed only in the
  working tree — 12 untracked files plus 5 modified tracked files, so every other
  checkout was red. This was the exact failure mode recorded as SEC-105.
- **Done:** Task 3's four steps closed. The diff was audited against the design,
  all twelve design test-contract bullets map to named tests, the repository and
  security gates passed, two independent fresh reviewers returned
  `VERDICT: APPROVED` with no P0/P1, and the work is committed.
- **Two open questions the reviewers raised, deliberately not decided here:**
  whether `SpawnLockfRunner` needs a watchdog around the non-blocking `lockf`
  call, and whether `<state>/transactions/` accumulating one permanent `0600`
  lock file per transaction id — a consequence of a per-transaction lock path
  plus the never-unlink rule — is intended or wants collection. Both are carried
  into `docs/architecture/foundation-constraints.md`, under Task 5, where they
  survived the foundation plan's deletion at the close of Task 9.

### ACT-2 — Reconcile program-plan bookkeeping

- **Status:** done 2026-07-27
- **Problem:** the program plan showed 0/71 checkboxes while Task 0's three artifacts
  already existed, so a fresh session would have redone Task 0 — which is impossible,
  because its inputs are deliberately out of reach.
- **Done:** Task 0 is marked complete with its seven steps checked against the artifacts
  and their recorded counts.

### ACT-4 — Keep the repository self-contained

- **Status:** done 2026-08-01
- **Was:** the self-containment rule was only prose. Nothing mechanically stopped a future
  task from adding a `readFileSync` against the founder's vault to a fixture builder, and
  that is exactly how a clean-room boundary erodes.
- **Done:** `tests/repository/self-containment.ts` holds the rule and `tests/repository/check.ts`
  runs it over every tracked file **and every untracked file `.gitignore` does not exclude**;
  `npm run lint` fails on any reference outside the allowlist. Twenty-five tests: the matcher's
  patterns and vocabulary exclusions, and the enumerator driven end to end against throwaway git
  repositories.
- **The enumerator needed as much care as the rule.** A reviewer found that the first version
  spliced paths into a `file://` URL, so a file named `issue#12.ts` was skipped silently — and a
  checkout under any directory containing `#` skipped *every* file and still exited 0. It also
  read only the index, so a newly written file was invisible until staged, which is precisely
  when lint runs. Both are fixed and both have tests; the "passes by scanning nothing" failure is
  the one this kind of gate is most prone to.
- **The patterns catch the spellings that work, not only the one that reads well.** `~/brain`
  does not expand inside a JavaScript string, JSON, or most YAML, so anyone actually reading the
  vault from code writes an absolute path or joins it onto the home directory. `/Users/…/brain`
  and `homedir()`-adjacent joins are matched too, case-insensitively.
- **Two deviations from the allowlist as specified here, both deliberate:**
  `docs/superpowers/SESSION.md` was added, because it states the rule and the check would
  otherwise fail on the document that defines it. The program plan and design spec are allowed
  *whole* rather than only in their cutover sections: in both, boundary prose appears
  throughout — scope, non-goals, migration sources, the vault the founder may keep — so a
  section-scoped rule would flag legitimate text and would depend on heading names nobody has
  agreed to freeze. The narrower rule is left to review.
- **Scope:** it is a lint rule, not a sandbox. It refuses the obvious spellings so that
  crossing the boundary is deliberate and visible in a diff; it cannot stop deliberate
  obfuscation and does not try.

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

## 2. Foundation — complete

**Closed 2026-08-01.** The plan was deleted when its last step closed, per the session
protocol; recover it from git history if the reasoning is ever needed. Its durable output is
three documents: `docs/architecture/foundation.md` (what the layer is and cannot do),
`docs/architecture/foundation-constraints.md` (the verbatim per-task constraints, including two
open founder questions), and `docs/releases/foundation-checkpoint.md` (the gate evidence).
Spec: `specs/2026-07-21-developer-os-design.md`.

| Task | Steps | Status | Produces |
|---|---|---|---|
| 1. Clone safely, repository gate | 8/8 | done | workspace, lint/test/build gate |
| 2. CLI result and error contracts | 4/4 | done | `CliResult`, stable exit codes |
| 3. Strict configuration and runtime paths | 5/5 | done | `DeveloperOsConfigV1` |
| 4. Path, redaction, process primitives | 6/6 | done | `SecurityPolicy` |
| 5. Recoverable filesystem transactions | 5/5 | committed via ACT-1 | `TransactionStore` |
| 6. Owned artifacts and configuration drift | 5/5 | done 2026-07-28 | `InstallationManifestV1`, drift and conflict evidence |
| 7. macOS platform boundary | 4/4 | done 2026-07-29 | `PlatformAdapter` facts and discovery |
| 8. No-agent CLI lifecycle | 7/7 | done 2026-07-31 | `init`, `status`, `doctor`, `repair`, `uninstall` |
| 9. Temporary-HOME lifecycle proof | 7/7 | done 2026-08-01 | E2E suite (31 cases), `docs/architecture/` and `docs/releases/` first entries |

**Foundation completion gate — satisfied.** Every clause is evidenced in
`docs/releases/foundation-checkpoint.md`: `npm run lint && npm test`, `pnpm build`, and
`pnpm test:e2e` pass freshly; the temporary-HOME lifecycle is idempotent; interruption recovery
and rollback pass at every phase; overlap, symlink escape, drift, forged manifest, and secret
sentinel cases fail closed; nothing real is touched; two fresh-context reviewers left no
unresolved P0/P1; the tree is clean. **Program Task 2 may start.**

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
- **The plan must contain:** exact schemas, golden fixtures, and a read-only compatibility
  harness that runs against `tests/fixtures/brain/legacy-shape/` — a committed, wholly
  invented vault encoding only the shape recorded in `docs/migration/baseline-capabilities.json`.
  The fixture is never generated from, compared against, or refreshed from a real vault.
  If it turns out to miss a shape the product must support, extend the fixture and say so;
  do not open a vault to find out.
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
- **Reference reading, optional:** `github.com/phuryn/pm-skills` (MIT) — 68 skills across 9
  Claude plugins, maintained as one hand-written format per skill with **no compile step**.
  It is the approach this task exists to replace, so it is useful in exactly two ways: as
  evidence that the single-format shortcut is what people actually reach for, and as a
  corpus to sanity-check that `WorkflowContractV1` can express a real skill without
  contortion. Not a dependency, not a fixture, not a source — repository fixtures stay
  synthetic.

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
- **Reference reading, optional:** `phuryn/pm-skills/validate_plugins.py` (MIT) is a
  working inventory of real-world Claude plugin-manifest checks — name matches directory,
  semver, author object shape, description length floors, `use when` trigger phrasing,
  50–3000 word bounds as a progressive-disclosure proxy, and dangling skill-reference
  detection. Read it once when drafting this spec to avoid missing an obvious check. Note
  what it omits, because those are precisely our requirements: it does not reject unknown
  fields, does not check path traversal, and does not detect generated-vs-source drift.

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
- **Absorbs:** legacy follow-up Step 8 (`Add stable Codex learning capture`), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.

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
- **Absorbs:** legacy follow-up Steps 5, 7, 9 and 12, frozen on the legacy runtime
  2026-07-27 and rebuilt here instead.

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
- **Absorbs:** legacy follow-up Step 6 (real-Git integration coverage), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.

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
| `tests/fixtures/brain/legacy-shape/` | DOS-P2 | missing — synthetic vault that replaces every reason to read `~/brain` at build time |
| `tests/integration/` | Foundation onward | missing |
| `tests/e2e/` | Foundation Task 9 | **created 2026-08-01** — `pnpm test:e2e` runs 31 cases |
| `tests/security/` | DOS-P6 | missing |
| `docs/architecture/` | Foundation Task 9, then per subsystem | **created 2026-08-01** — Foundation boundaries and constraints done; workflow schema, threat model, capability model still owed by later subsystems |
| `docs/releases/` | DOS-P7 | **created 2026-08-01** by Foundation Task 9, ahead of its named owner |
| `packages/brain/` | DOS-P2 | missing |
| `packages/workflow-schema/` | DOS-P3 | missing |
| `packages/adapter-claude/`, `plugins/claude/` | DOS-P4 | missing |
| `packages/adapter-codex/`, `plugins/codex/` | DOS-P5 | missing |
| `workflows/`, `templates/brain/` | DOS-P2 / DOS-P3 | missing |

---

## 6. Legacy runtime — exit checklist

Plan: `plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`. Rescoped
2026-07-27 from a 14-step development backlog into a 3-item exit checklist.

**None of this gates Developer OS development.** Foundation through DOS-P7 are
self-contained. These three items gate DOS-P8 cutover, and closing them ends work on the
legacy runtime permanently.

| ID | Pri | Item | Owner | Status |
|---|:---:|---|---|---|
| EXIT-1 | P0 | Rotate historical credential candidates | **Founder** | open — console work, touches no repository |
| EXIT-2 | P0 | Resolve the non-npm commit-gate contradiction | Agent + Founder | open — one rules file |
| EXIT-3 | P0 | Land or durably preserve the uncommitted trees | Agent + Founder | open, needs EXIT-2 |

- **EXIT-1** treats four historical credential findings as active until a provider proves
  otherwise: the Taxos AWS key, the KM Energy Monitoring AWS key, the shared VAV/Vavita
  Zindigi AWS key, and historical authentication/email credentials in Przedsiębiorcze
  Trójmiasto. The founder waived these as *Developer OS publication* blockers on
  2026-07-21. A waiver scopes this product; it does not revoke a key. Pending since
  2026-07-20.
- **EXIT-3** is the durability problem: `~/claude-shared` carries roughly 136 changed or
  untracked entries including a completed, reviewed, never-committed English migration.
  `~/brain` was largely committed since and now carries a small untracked inbox — verify
  before acting. Resolution is a commit *or* a founder-accepted archive; leaving it dirty
  is not a resolution.
- Former Step 0 (preserve and classify) is **partially discharged** by Program Task 0,
  which backed up and classified both trees on 2026-07-21. Its remaining piece — an
  include/exclude manifest for a *commit* boundary rather than a *publication* boundary —
  now sits inside EXIT-3.

**Frozen 2026-07-27 — ten items, will not be done on the legacy runtime.** Each is rebuilt
as a Developer OS feature on synthetic fixtures. Full original text in commit `28a0ddc`.

| Was | Item | Rebuilt as |
|---|---|---|
| Step 4 | Live/template configuration drift | DOS-P4 |
| Step 5 | False-green Brain validation | DOS-P6 |
| Step 6 | Weekly automation against real Git | DOS-P7 |
| Step 7 | Scanner coverage gaps | DOS-P6 |
| Step 8 | Stable Codex learning capture | DOS-P5 |
| Step 9 | Brain schema and graph policy | DOS-P2 |
| Step 10 | Retrieval quality benchmark | DOS-P2 |
| Step 11 | Unified read-only doctor | Foundation Task 8, extended in DOS-P7 |
| Step 12 | Proposal lifecycle and observability | DOS-P6 |
| Step 13 | Content curation and archive provenance | DOS-P2, Program Task 8 |

**One asymmetry.** Frozen Step 7 fixed two known secret-scanner gaps: linked worktrees are
skipped, and results truncate at twenty matches without reporting how many were omitted.
If EXIT-1's scan is the deciding evidence for a rotation verdict, unfreeze exactly those
two fixes and nothing else.

**Open proposals** (in `~/brain/content/_outputs/proposals/`, left in place as private
Brain content — they are not repository inputs): `2026-07-19-historical-secret-triage.md`
feeds EXIT-1; `config-drift.md` is frozen with Step 4.

**Retired 2026-07-27:** the English migration plan that produced the current dirty trees
was completed and reviewed on 2026-07-20, so it was deleted rather than archived (commit
`28a0ddc` holds it). Its only unresolved consequence is EXIT-3, and its evidence numbers
now live in that item as the regression baseline the staged tree must reproduce.

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
