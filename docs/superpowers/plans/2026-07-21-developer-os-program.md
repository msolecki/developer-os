# Developer OS Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `developer-os` as an open-source, local-first macOS CLI that installs independent Claude Code and Codex adapters over a private Obsidian-compatible Brain.

**Architecture:** Build a clean public TypeScript monorepo in a dedicated target checkout from audited source material, without importing either legacy Git history. Keep product code and generated plugins in the public repository while all notes, captures, configuration, staging, backups, and logs remain in user-owned local paths. Deliver seven independently testable subprojects behind explicit security, compatibility, migration, and release gates.

**Tech Stack:** Node.js 24.16.0, pnpm 11.3.0 workspaces, TypeScript strict mode, Vitest, ESLint, macOS `launchd`, Markdown/Obsidian vaults, GitHub Releases, and Homebrew distribution.

## Global Constraints

- Target remote: `git@github.com:msolecki/developer-os.git`.
- Target checkout: the root of the dedicated `developer-os` clone; never persist the founder's machine-specific absolute checkout path in public artifacts.
- Self-contained execution: every task runs against this repository alone. Task 0 closed on 2026-07-21 and froze the legacy source material into `docs/migration/`; its manifest admitted exactly three files, all of which are already here. Do not read, mount, clone, or require `~/claude-shared`, `~/brain`, or any `DEVELOPER_OS_SOURCE_*` path. `DEVELOPER_OS_SOURCE_REPO` and `DEVELOPER_OS_SOURCE_BRAIN` are retired and must not be reintroduced.
- If a task appears to need a legacy fact that `docs/migration/` does not hold, that is a gap in the frozen record. Close it by adding a reviewed, redacted artifact to `docs/migration/` under the exclusion policy — never by reopening a source repository.
- The single exception is Task 8, which points the finished product at the founder's live vault in read-only diagnostic mode. That is a product capability exercised on user data after Task 7, not a source-material dependency of the build.
- Initial platform: macOS only; package platform behavior behind a `PlatformAdapter` interface.
- Users may install Claude Code, Codex, or both; neither adapter is mandatory.
- AI-assisted operations use the selected installed agent CLI; no direct model API integration exists in version 1.
- The default product state is `~/.developer-os`; the initializer proposes `~/DeveloperBrain` for new vaults.
- `DEVELOPER_OS_HOME` and `DEVELOPER_OS_BRAIN` are the only version 1 path overrides.
- Product home and Brain paths must not overlap after symlink resolution.
- Git and `launchd` automation are disabled by default and require separate opt-in commands.
- Version 1 contains no telemetry, hosted service, team sync, desktop application, or required MCP server.
- Never import legacy Git history, raw founder/client knowledge, credentials, or real private notes into the public repository.
- Redact before truncation, persistence, logging, hashing, or model input.
- Treat all model output as an untrusted proposal; canonical writes require deterministic validation.
- Every filesystem mutation follows `plan -> backup -> stage -> validate -> apply -> verify -> finalize`.
- Never overwrite drifted user configuration; stop with a three-way conflict report.
- Never use `git add -A`; stage only task-owned paths.
- Before every commit run `npm run lint && npm test`; also run each task's narrower verification command.
- Every code-producing task receives a fresh-context review by an agent other than the author.
- The repository remains private until its own publication-candidate secret scan is clean and an OSI-approved license is selected with qualified legal counsel. Historical credential rotations in unrelated repositories are explicitly outside the Developer OS release gate.
- This program plan is an umbrella. Each subsystem after Foundation receives its own approved spec and implementation plan before code work.
- `docs/superpowers/plans/legacy-runtime/` described the founder's pre-Developer-OS machine, not this product. It is a publication-excluded path, named by Task 0's `exclusion-policy.md`, and it is now **empty** — its one document closed on 2026-08-10 and was deleted. The exclusion stands for anything that might be written there again.
- `docs/superpowers/BACKLOG.md` is the single index of outstanding plans, specs, and gates. Any new plan or spec must be registered there in the same change that creates it.

## Approved execution decisions

- 2026-07-21: the founder explicitly waived the four historical credential rotations as Developer OS implementation and publication blockers. This does not permit copying secret-bearing history, private content, credentials, or unredacted source material; Task 0 must still prove the new repository's publication candidates are clean.
- Task 0 is an audit/control task and does not create a standalone commit. Its reviewed artifacts enter the Task 1 bootstrap commit only after the repository has a working `npm run lint && npm test` gate.
- The execution environment cannot access SSH or GitHub CLI credential stores. Private local implementation may proceed in a dedicated repository with `origin` recorded but no fetch or push. Remote hooks/configuration verification, reconciliation, and all remote writes remain blocked until the founder supplies a safely cloned checkout or performs that verification outside this environment.

## Canonical inputs

Every input is in this repository. Nothing below resolves outside it.

- Product design: `docs/superpowers/specs/2026-07-21-developer-os-design.md`
- Frozen source classification: `docs/migration/source-manifest.json`
- Publication boundary: `docs/migration/exclusion-policy.md`
- Frozen legacy behavior: `docs/migration/baseline-capabilities.json` — the recorded Claude Code, Codex, and Brain capability surface as of 2026-07-21, and the only admissible statement about what the legacy runtime did
- Cutover preconditions: `docs/superpowers/BACKLOG.md` §6. The exit checklist that held them closed on 2026-08-10 and its plan is deleted; §6 is now the record of what a cutover has to know about the founder's machine

Three former inputs were retired on 2026-07-27 because they contradicted this program's own exclusion policy: the legacy `README.md` and `AGENTS.md` were never publication candidates, and the two Brain proposals are `private-content`. Their product-relevant substance is `baseline-capabilities.json`; their unresolved obligations are cutover preconditions, not build inputs.

## Program file map

The following paths are created relative to the target repository root over the program. Each path has one responsibility.

| Path | Responsibility | First owning subproject |
|---|---|---|
| `apps/cli/` | Command parsing, human/JSON output, orchestration, stable exit codes | Foundation |
| `packages/core/` | Config, paths, transactions, manifests, ownership, migrations | Foundation |
| `packages/security/` | Protected paths, redaction, safe spawning, log scrubbing | Foundation, hardened in Capture |
| `packages/platform-macos/` | macOS paths and process primitives; later `launchd` | Foundation |
| `packages/brain/` | Vault schema, indexes, lint, graph, capture envelopes, retrieval | Brain engine |
| `packages/workflow-schema/` | Canonical workflow schema, renderer inputs, capability requirements | Workflow compiler |
| `packages/adapter-claude/` | Claude discovery, capabilities, invocation, hooks, plugin output | Claude adapter |
| `packages/adapter-codex/` | Codex discovery, capabilities, invocation, hooks, plugin output | Codex adapter |
| `workflows/` | Canonical workflow contracts and vendor overlays | Workflow compiler |
| `plugins/claude/` | Reproducible generated Claude plugin | Claude adapter |
| `plugins/codex/` | Reproducible generated Codex plugin | Codex adapter |
| `templates/brain/` | Synthetic public Obsidian vault | Brain engine |
| `tests/contracts/` | Cross-package and adapter contracts | Foundation onward |
| `tests/fixtures/` | Synthetic homes, vaults, configs, agent outputs, secrets | Foundation onward |
| `tests/integration/` | Real process, Git, filesystem, and adapter boundary tests | Foundation onward |
| `tests/e2e/` | Full temporary-HOME lifecycle | Foundation onward |
| `docs/architecture/` | Product boundaries, workflow schema, threat model, capability model | Relevant subsystem |
| `docs/migration/` | Redacted migration manifests and shadow-cutover runbooks | Migration |
| `docs/releases/` | Release gates, compatibility matrix, rollback | Distribution |

## Dependency graph

```text
P0 Source safety
  -> P1 Foundation and CLI lifecycle
      -> P2 Brain engine
      -> P3 Workflow compiler
          -> P4 Claude adapter
          -> P5 Codex adapter
              -> P6 Capture/ingest/security hardening
                  -> P7 Git/automation/update lifecycle
                      -> P8 Founder shadow migration
                          -> P9 Public beta and v1 release
```

P2 and P3 may proceed in parallel only after P1 interfaces are frozen. P4 and P5 may proceed in parallel only after P3's workflow and capability schemas are frozen. P6 consumes both adapter contracts and therefore starts after P4 and P5.

---

### Tasks 0 to 5 — closed, and not described here

| Task | Closed | What survives it |
|---|---|---|
| 0 — preserve sources, establish the publication boundary | 2026-07-21 | the three files in `docs/migration/`, and the self-containment constraint in Global Constraints above — enforced by `npm run lint` since 2026-08-01 rather than by prose |
| 1 — public foundation and CLI lifecycle | 2026-08-01 | `docs/architecture/foundation.md`, `docs/architecture/foundation-constraints.md`, `docs/releases/foundation-checkpoint.md` |
| 2 — Brain engine | 2026-08-10 | `docs/architecture/brain.md`, and `specs/2026-07-21-developer-os-brain-engine-design.md` as the design of record |
| 3 — workflow compiler | 2026-08-10 | `docs/architecture/workflow-schema.md`, and `specs/2026-07-21-developer-os-workflow-compiler-design.md` as the design of record |
| 4 — Claude Code adapter | 2026-08-11 | `docs/architecture/claude-adapter.md`, and `specs/2026-07-21-developer-os-claude-adapter-design.md` as the design of record |
| 5 — Codex adapter | 2026-08-12 | `docs/architecture/codex-adapter.md`, and `specs/2026-07-21-developer-os-codex-adapter-design.md` as the design of record |

None can be re-run and none should be read as instruction: Task 0's inputs are deliberately out
of reach, and every plan behind these six was deleted when its last step closed. The recovery
commits are in `BACKLOG.md`'s rules, which is the one place that index lives — a second copy here
is how two indexes come to disagree.

**Their step lists are deleted rather than kept as ticked boxes.** A closed task carrying a
checklist is a document inviting the next session to redo it, and a checkbox nobody can trust is
worse than no checkbox — this repository has produced both, in both directions, three times.
The last occurrence was in the *open* tasks: `9a196c9` ticked thirteen boxes across Tasks 4 to 7
while none of the code existed, corrected 2026-08-11. Deleting a closed list does not defend
against that direction; the staging rule does. `git add` the paths your own task owns, and read
`git show --stat HEAD` before believing a commit contains only what you meant.

**Tasks 4 and 5 both closed half met, and the missing half is Task 6's.** Recorded here because a
reader of the two checkpoints alone would read them as whole. What landed: six skills load in a
real Claude installation and in a real Codex one, and `doctor` reports both adapters with their
differences. What did not, in both vendor trees:

- **`capture`, `ingest` and `review` name verbs with no handler anywhere in this product** — six of
  the seven unimplemented verbs are Task 6's. An adapter renders workflows and executes none of
  them, so neither task could have closed that half.
- **Neither ships `hooks/hooks.json`**, ratified for both adapters at once on 2026-08-12: a
  `type: "command"` handler needs an executable file, nothing in this pipeline can express an
  executable bit, and the only nameable command is the `developer-os` capture entrypoint, which is
  Task 6's. All three lifecycle capabilities therefore report `wrapper-required` and `plugin_hooks`
  reports `unknown`.

`claude-adapter.md` §8 and §9 and `codex-adapter.md` §10 and §11 are the full record, with owners.

**One thing Task 3's file list said that its checkpoint did not need.** It asked for the command
names frozen in `docs/migration/baseline-capabilities.json` — `lint`, `reindex`, `ingest`,
`test` — to be encoded as canonical workflows. The approved DOS-P3 spec names six workflows and
those are what shipped; `lint` and `reindex` are served by the `brain` CLI group DOS-P2 shipped,
which is a command surface rather than an agent workflow, and `test` is a repository gate. The
spec wins over the plan, and this is recorded rather than left as an apparent omission.

### Task 6: Harden capture, review, ingest, security, and recovery

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-knowledge-pipeline.md`
- Extend: `packages/brain/src/capture/`, `packages/brain/src/review/`, and `packages/brain/src/ingest/`
- Extend: `packages/security/src/`
- Extend: `packages/core/src/transactions/`
- Extend: `apps/cli/src/commands/` — the `capture`, `ingest` and `review` verbs both vendor trees already name
- Extend: `packages/adapter-claude/` and `packages/adapter-codex/` — hook bodies only; both façades are frozen
- Create: `tests/security/` and `tests/e2e/knowledge-lifecycle/`

**Interfaces:**
- Consumes: both adapter structured-run contracts, `BrainService`, `TransactionStore`, and `SecurityPolicy`.
- Produces: complete `CaptureEnvelopeV1` transitions, `ReviewDecision`, `IngestProposal`, `IngestValidationResult`, `ApplyResult`, and recovery commands.

**What:** Make the complete knowledge loop safe under secrets, prompt injection, malformed output, concurrency, and process interruption.

**Where:** Brain, security, transaction packages, and end-to-end fixtures.

**How:**

- [ ] Approve exact capture fields, lifecycle transitions, retention behavior, and redaction classes. — *this is the keystone the two adapters wait on: it decides what a hook body does, which is what makes a lifecycle capability observable.*
- [ ] Ship the `capture`, `ingest` and `review` verbs that the six shipped skills already name, in both vendor trees. — *inherited from Tasks 4 and 5; six of the seven unimplemented verbs are this task's. `claude-adapter.md` §8, `codex-adapter.md` §10.*
- [ ] Restore `hooks/hooks.json` for both adapters in one change — hook bodies, a mechanism that can express an executable bit, and a test that observes a hook firing. — *inherited from Tasks 4 and 5, ratified for both adapters 2026-08-12. Until it lands, all three lifecycle capabilities report `wrapper-required` and `plugin_hooks` reports `unknown`. `claude-adapter.md` §5, `codex-adapter.md` §5.*
- [ ] Implement atomic quarantine writes and post-redaction deduplication.
- [ ] Implement accept/edit/reject review without automatic deletion.
- [ ] Invoke agents with source material marked as untrusted data and a staging-only write contract.
- [ ] Validate schema, provenance, links, duplicates, confidence, secrets, indexes, generated artifacts, and write scope.
- [ ] Add per-file backup, atomic replacement, transaction journal, resume, rollback, and concurrent-edit refusal. — *Foundation shipped the machinery in `packages/core/src/transactions/` and `packages/platform-macos/src/transaction-lock.ts`; what this box owes is the hardening of it against the capture and ingest paths, which do not exist yet.*
- [ ] Add sentinel secret, prompt injection, symlink escape, multiline command, malformed manifest, and interruption tests. — *`tests/security/` does not exist; `BACKLOG.md` §5 records it as owed by this task.*
- [ ] Run independent security review before accepting the checkpoint.

**Test:**

- The same secret sentinel is absent from capture, logs, hashes, model input, staging, reports, and canonical notes.
- Every interruption point returns either the pre-transaction state or a deterministic recoverable state.
- Duplicate replay is idempotent.
- Model output cannot widen write scope or bypass canonical validators.
- Failure leaves the capture retryable and never marks it ingested.

**Checkpoint:** The complete local knowledge lifecycle is production-candidate for synthetic data.

---

### Task 7: Implement optional Git, automation, update, and release lifecycle

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-lifecycle-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-lifecycle.md`
- Extend: `apps/cli/src/commands/git/`, `apps/cli/src/commands/automation/`, and `apps/cli/src/commands/update/`
- Extend: `packages/platform-macos/src/launchd/`
- Extend: `packages/core/src/update/` and `packages/core/src/migrations/`
- Create: `tests/integration/git/`, `tests/integration/launchd/`, and `tests/e2e/upgrade/`

**Interfaces:**
- Consumes: stable installation manifest, transactions, Brain migrations, security scan, and both adapter update plans.
- Produces: `GitSyncConfigV1`, `AutomationConfigV1`, `LaunchdPlan`, `UpdatePlan`, `SchemaMigrationPlan`, and verified uninstall/rollback results.

**What:** Add the explicitly optional background and release lifecycle without hidden network or data loss.

**Where:** CLI, core update/migration code, macOS adapter, and isolated integration fixtures.

**How:**

- [ ] Specify Git initialization, existing remote connection, scoped staging, commit, push, and error states.
- [ ] Specify exact `launchd` jobs, schedules, logs, lock ownership, and opt-in boundaries.
- [ ] Implement Git against temporary repositories and bare remotes; never use real credentials in tests.
- [ ] Implement `launchd` plan/apply/status/disable through an injected filesystem/runner in tests.
- [ ] Implement signed/checksummed release metadata, dry-run updates, schema migration staging, and rollback.
- [ ] Ensure update refuses drift and uninstall removes only manifest-owned artifacts.
- [ ] Test push failure, partial download, checksum mismatch, stale lock, concurrent edit, and migration failure.

**Test:**

- Git-disabled and automation-disabled installs perform no related process or network call.
- Enabling either feature shows and persists an exact plan.
- Push failure never records successful sync.
- Update and uninstall preserve the Brain and unrelated agent config.
- Checksum mismatch, schema incompatibility, and drift fail before apply.

**Checkpoint:** The complete local product lifecycle is ready for founder shadow migration.

---

### Task 8: Migrate the founder in shadow mode

**Complexity:** L

**Files:**
- Create: `docs/migration/founder-cutover.md`
- Create: `docs/migration/founder-baseline-results.json`
- Create: `docs/migration/founder-shadow-results.json`
- Create: `docs/migration/founder-cutover-manifest.json`
- Update: supported-version and capability documentation based on evidence.

**Interfaces:**
- Consumes: all version 1 CLI, Brain, adapter, security, and lifecycle contracts plus Task 0 baseline.
- Produces: a reversible cutover manifest and parity verdict for each agent and workflow.

**What:** Replace the founder's legacy runtime without moving `~/brain`, deleting legacy recovery data, or enabling two copies of a mutating hook.

**Where:** Founder machine, current `~/brain`, existing agent configs, and an isolated Developer OS shadow queue.

**Boundary — this is the only task in the program that touches the legacy runtime, and it does so as a finished product, not as a builder.** Everything it reads is user data through shipped read-only commands; nothing here is a source-material input, and nothing here may be copied into the repository. Two consequences follow:

- No task from Foundation through Task 7 may borrow from this one. If an earlier task wants to "just check what the old system did", the answer is `docs/migration/baseline-capabilities.json` or a spec gap — never a legacy checkout.
- The cutover preconditions closed on 2026-08-10 and no longer gate this task. `docs/superpowers/BACKLOG.md` §6 records what they left behind — a declined credential-rotation decision, a corrected commit gate, two clean trees, and one live constraint this task must not break: the weekly job's preflight refuses pre-existing changes under `content`, so any cutover step that edits the vault and does not commit the edit will abort the next scheduled run.

**How:**

- [ ] Run read-only `developer-os doctor` against `~/brain` and record redacted findings.
- [ ] Validate legacy topic aliases, schema, indexes, permissions, and protected paths.
- [ ] Enable new capture to a separate shadow quarantine with canonical apply disabled.
- [ ] Compare old and new capture/redaction/deduplication on synthetic sessions.
- [ ] Cut over Claude first while preserving a one-command rollback manifest.
- [ ] Complete a full Claude capture/review/ingest/retrieval cycle and review the diff.
- [ ] Cut over Codex and repeat the lifecycle.
- [ ] Enable optional Git and `launchd` only if their explicit plans match the approved local policy.
- [ ] Disable legacy hooks/jobs only after new evidence passes; do not delete them.
- [ ] Exercise rollback once before declaring cutover complete.

**Test:**

- No duplicate hook writes occur during shadow mode.
- Existing Brain bytes remain unchanged until an accepted, validated ingest transaction.
- Each adapter completes the same outcome contract.
- Rollback restores the legacy runtime while preserving post-cutover Brain changes.
- Independent review compares working tree, installed manifests, hooks, jobs, and actual command evidence.

**Checkpoint:** The founder uses Developer OS as the primary runtime for one complete stable cycle; legacy repos remain recoverable.

---

### Task 9: Run public beta and publish version 1

**Complexity:** L

**Files:**
- Create: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and approved `LICENSE`
- Create: `docs/install/`, `docs/tutorials/`, `docs/troubleshooting/`, `docs/releases/`, and `docs/privacy.md`
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and Homebrew formula source
- Create: macOS Apple Silicon and Intel release packaging configuration

**Interfaces:**
- Consumes: verified founder cutover, supported-version matrix, release metadata contract, security audit, and approved license.
- Produces: signed/checksummed release artifacts, SBOM, Homebrew installation path, public documentation, beta findings, and `v1.0.0` release evidence.

**What:** Validate the product on clean accounts, close distribution and documentation gaps, and publish only after security and legal gates are complete.

**Where:** GitHub repository/releases, isolated macOS test accounts, and the Homebrew tap.

**How:**

- [ ] Obtain qualified legal approval for the exact OSI-approved license and commit the approved text.
- [ ] Run a fresh secret/history audit of the complete public branch.
- [ ] Produce self-contained Apple Silicon and Intel artifacts with pinned bundled runtime.
- [ ] Generate SHA-256 checksums, SBOM, changelog, schema versions, capability matrix, and rollback instructions.
- [ ] Test Claude-only, Codex-only, and dual-agent tutorials on clean temporary macOS accounts.
- [ ] Run a closed beta with synthetic or participant-owned vaults; collect only explicit user-reported issues because telemetry does not exist.
- [ ] Fix release blockers through normal specs/plans and rerun the full matrix.
- [ ] Publish repository visibility, GitHub Release, and Homebrew formula only after explicit founder approval.

**Test:**

- Fresh installation completes `install -> init -> capture -> review -> ingest -> search -> update -> uninstall` without Brain loss.
- All unit, contract, integration, E2E, security, generated-drift, packaging, and clean-account tests pass.
- Public history and artifacts contain no secret or private Brain fixture.
- Release checksums verify and a modified artifact is rejected.
- Documentation accurately describes every capability difference and network action.

**Checkpoint:** `v1.0.0` is public and reproducible; legacy repositories may be archived but not deleted.

## Program verification matrix

| Gate | Command or evidence | Blocks |
|---|---|---|
| Source preservation | Disposable-clone patch restore plus classified status inventory | Task 1 |
| Historical secrets | Founder rotation/log-review record with no secret values | Public visibility |
| Repository validation | `npm run lint && npm test && pnpm build && git diff --check` | Every commit/release |
| Generated artifacts | clean regeneration diff | Adapter commits/release |
| Security | sentinel, path, prompt injection, transaction, network suites | Tasks 6–9 |
| Agent compatibility | disposable real-agent matrix | Founder cutover/release |
| Migration | shadow comparison and exercised rollback | Public beta |
| License | approved OSI license text reviewed by qualified counsel | Public visibility/release |
| Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

## Program completion criteria

The program is complete only when all nine task checkpoints pass, the founder has used the migrated system through a complete stable cycle, public artifacts reproduce from source, and `v1.0.0` meets every acceptance criterion in the approved design. Archiving legacy repositories is optional cleanup after completion; deleting them is outside this plan.
