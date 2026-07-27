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
- `docs/superpowers/plans/legacy-runtime/` describes the founder's pre-Developer-OS machine, not this product. It is a publication-excluded path: Task 0's `exclusion-policy.md` must name it, and no publication candidate may copy or reference its contents.
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
- Cutover preconditions: `docs/superpowers/plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`

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

### Task 0: Preserve sources and establish the publication boundary

**Complexity:** M

**Status: COMPLETE — closed 2026-07-21. This task is the reason the rest of the program needs no legacy access. Do not re-run it; it cannot be re-run, because its inputs are deliberately no longer reachable.**

**Files:**
- Created: `docs/migration/source-manifest.json`
- Created: `docs/migration/exclusion-policy.md`
- Created: `docs/migration/baseline-capabilities.json`

**Interfaces:**
- Consumes: current working-tree inventories, existing redaction policy, current hook and Brain test commands.
- Produces: `SourceManifestV1`, `PublicationExclusionPolicyV1`, and `CapabilityBaselineV1`; every later migration task must consume these artifacts.

**What:** Preserve recoverability, settle the security publication gate, and record exactly which source paths may inform the clean public implementation.

**Where:** `docs/migration/` in this repository. The legacy checkouts and provider consoles that were read at the time are out of reach by design and must stay that way.

**How (all steps closed):**

- [x] Captured read-only status, tracked diffs, untracked path inventories, commits, and validation commands for both legacy repositories into an owner-only backup outside either repo, without copying untracked file contents.
- [x] Classified every path as `user-owned`, `public-source-candidate`, `generated`, `private-content`, `sensitive-history`, or `excluded`. Result: 152 of 152 shared-runtime entries and 7 of 7 private-brain entries assigned, zero unassigned, zero duplicate assignments.
- [x] Recorded the founder's waiver of the four historical rotations as out of scope for Developer OS, retaining every prohibition against copying affected histories or source material.
- [x] Recorded `remoteVerification: "blocked_by_environment"`; fetch, push, and public release stay blocked until external verification occurs.
- [x] Wrote `source-manifest.json`. It admits exactly **three** publication candidates, all of them planning documents, all already present at their public destinations with matching SHA-256 evidence.
- [x] Wrote `exclusion-policy.md` naming raw captures, client notes, credentials, `.obsidian` state, real remotes, secret-bearing history, and machine-local config as prohibited public inputs. Extended 2026-07-27 to name `docs/superpowers/plans/legacy-runtime/`.
- [x] Recorded the legacy Claude, Codex, and Brain capability surface in `baseline-capabilities.json` as booleans, versions, and command names only.

**Test (evidence in the artifacts):**

- Every working-tree entry appears in exactly one classification; the manifest carries the per-rule matched counts that prove it.
- A full secret scan reported no untriaged publication candidate.
- This checkout contains no copied legacy history and no real Brain content.
- No unresolved historical credential value or affected Git history appears in a publication candidate.

**What this task bought.** Everything the program still needs to know about the legacy runtime is now three files in `docs/migration/`. That is the whole point: after Task 0, `~/claude-shared` and `~/brain` are not build inputs, not review inputs, and not test inputs. The only later contact is Task 8, read-only, against the user's vault as product data.

**Checkpoint:** The repository may be populated privately. Public visibility remains blocked pending license approval and remote verification.

---

### Task 1: Build the public foundation and CLI lifecycle

**Complexity:** L

**Files:**
- Create: repository root configuration, `apps/cli/`, `packages/core/`, `packages/security/`, `packages/platform-macos/`, and Foundation fixtures/tests.
- Create: `docs/superpowers/plans/2026-07-21-developer-os-foundation.md` in the target repository from the approved execution plan maintained alongside this program plan.

**Interfaces:**
- Consumes: `SourceManifestV1` and `PublicationExclusionPolicyV1` from Task 0.
- Produces: `DeveloperOsConfigV1`, `PlatformAdapter`, `TransactionStore`, `InstallationManifestV1`, `SecurityPolicy`, `CliResult`, stable exit codes, and the commands `init`, `status`, `doctor`, `repair`, and `uninstall` for a no-agent installation.

**What:** Establish a clean, typed, tested repository and a safe filesystem lifecycle before adding Brain or vendor behavior.

**Where:** The target repository root.

**How:** Execute the dedicated Foundation plan task-by-task with TDD and fresh-context review after each meaningful task. Do not migrate legacy scripts wholesale; port behavior only through public synthetic fixtures.

**Test:**

- `npm run lint && npm test` passes.
- `pnpm build` passes.
- `developer-os init -> doctor -> repair -> uninstall` passes against a temporary `HOME`.
- Repeated `init` and `uninstall` are idempotent.
- Product home/Brain overlap, symlink escape, manifest forgery, config drift, and interrupted transaction fixtures fail closed.
- No test touches real `~/.claude`, `~/.codex`, `~/brain`, Keychain, GitHub credentials, or network.

**Checkpoint:** A private prerelease binary safely manages its own state but installs no Claude/Codex integration and writes no canonical Brain notes.

---

### Task 2: Specify and implement the Brain engine

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-brain-engine-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-brain-engine.md`
- Create: `packages/brain/src/schema/`
- Create: `packages/brain/src/indexes/`
- Create: `packages/brain/src/lint/`
- Create: `packages/brain/src/retrieval/`
- Create: `packages/brain/src/migrations/`
- Create: `templates/brain/`
- Create: `tests/contracts/brain/`, `tests/fixtures/brain/`, and `tests/integration/brain/`

**Interfaces:**
- Consumes: `DeveloperOsConfigV1`, `TransactionStore`, `SecurityPolicy`, and safe path primitives from Task 1.
- Produces: `BrainConfigV1`, `NoteFrontmatterV1`, `CaptureEnvelopeV1`, `IndexBuildResult`, `LintResult`, `RetrievalQuery`, `RetrievalResult`, `BrainMigration`, and `BrainService`.

**What:** Port the deterministic value of the current Brain into a generic, English, synthetic, locally owned vault engine.

**Where:** `packages/brain/` and `templates/brain/` in the target repository.

**How:**

- [ ] Run a dedicated brainstorming/spec approval cycle for schema, folder policy, lifecycle statuses, confidence, topic aliases, and index formats.
- [ ] Write the Brain implementation plan with exact schemas and golden fixtures.
- [ ] Implement note discovery and schema parsing without scanning quarantine or raw archives as canonical notes.
- [ ] Implement deterministic `vault-map`, `catalog`, and graph generation.
- [ ] Implement lint classes for frontmatter, provenance, links, duplicates, staleness, and generated-index drift.
- [ ] Implement index-first retrieval with explicit maximum candidate counts and source paths.
- [ ] Support `PROJEKTY` and `NARZEDZIA` as folder aliases without automatic renames. These are ordinary configurable vault folder names, not a legacy lookup: the implementation reads them from `BrainConfigV1`, never from a legacy repository.
- [ ] Build a synthetic template containing no founder names, clients, repositories, or real source text.
- [ ] Author a synthetic structural fixture in `tests/fixtures/brain/legacy-shape/` and commit it. It encodes only the shape recorded in `docs/migration/baseline-capabilities.json` — Obsidian Markdown, `vault-map`, `catalog`, `graph`, index-first retrieval, the four command names — with invented notes, invented tags, and invented links. It must never be generated from, compared against, or refreshed from a real vault.
- [ ] Run the compatibility harness read-only against that committed fixture. If the fixture turns out to miss a shape the product must support, extend the fixture and say so in the plan; do not open a real vault to find out.

**Test:**

- Index rebuilds are byte-for-byte deterministic under a frozen clock.
- Raw, quarantine, outputs, templates, and Obsidian internals remain excluded as declared.
- Every retrieval claim resolves to a selected canonical note.
- Legacy aliases produce the same logical project/tool selection without modifying source folders.
- Broken links, malformed frontmatter, duplicate IDs, unsupported schema versions, and stale generated indexes fail with path-specific diagnostics.

**Checkpoint:** `developer-os` can initialize, validate, index, and search a synthetic or existing compatible Brain without an agent adapter.

---

### Task 3: Specify and implement the workflow compiler

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-workflow-compiler-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-workflow-compiler.md`
- Create: `packages/workflow-schema/src/`
- Create: `workflows/shared/`, `workflows/brain-search/`, `workflows/capture/`, `workflows/review/`, `workflows/ingest/`, and `workflows/doctor/`
- Create: `tests/contracts/workflows/` and `tests/fixtures/workflows/`

**Interfaces:**
- Consumes: stable `BrainService` read/write scopes and Foundation result/error types.
- Produces: `WorkflowContractV1`, `WorkflowCapability`, `WorkflowInputSchema`, `WorkflowOutputSchema`, `WorkflowRenderer`, `RenderedArtifact`, and `WorkflowValidationResult`.

**What:** Establish one canonical outcome contract while allowing explicit Claude and Codex overlays.

**Where:** `packages/workflow-schema/` and `workflows/`.

**How:**

- [ ] Approve a dedicated schema covering identity, semantic version, triggers, inputs, read/write scopes, required capabilities, refusals, steps, structured result, validators, and recovery.
- [ ] Implement strict parsing and reject unknown fields for version 1 contracts.
- [ ] Implement renderer interfaces without embedding vendor behavior in canonical workflows.
- [ ] Encode the Brain workflows from `docs/superpowers/specs/2026-07-21-developer-os-design.md` and the command names frozen in `docs/migration/baseline-capabilities.json` (`lint`, `reindex`, `ingest`, `test`). Write them as new canonical contracts; do not port a legacy script, and do not open a legacy repository to recover one. If the design does not specify a workflow you believe is needed, that is a spec gap to resolve in DOS-P3's approval cycle.
- [ ] Add generated-artifact markers and CI drift checks.
- [ ] Add negative fixtures for missing capability, excessive write scope, prompt instructions inside source data, and incompatible schema versions.

**Test:**

- Workflow validation is deterministic.
- Every workflow declares exact read/write scope and at least one validator.
- Vendor overlays cannot weaken a canonical refusal or widen write scope.
- Generated output is idempotent and changes only when canonical source or renderer changes.

**Checkpoint:** Canonical workflows compile into abstract adapter artifacts; no vendor plugin is installed yet.

---

### Task 4: Specify and implement the Claude Code adapter

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-claude-adapter-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-claude-adapter.md`
- Create: `packages/adapter-claude/src/`
- Generate: `plugins/claude/`
- Create: `tests/contracts/adapters/claude/`, `tests/fixtures/agents/claude/`, and `tests/integration/claude/`

**Interfaces:**
- Consumes: `WorkflowContractV1`, `WorkflowRenderer`, `BrainService`, `SecurityPolicy`, `PlatformAdapter`, and `InstallationManifestV1`.
- Produces: `ClaudeAdapter`, `ClaudeCapabilities`, `ClaudeInvocation`, Claude plugin artifacts, managed hook plans, and structured agent-run results.

**What:** Add Claude Code as a fully optional adapter using documented plugin, skill, hook, and non-interactive surfaces.

**Where:** `packages/adapter-claude/` and generated `plugins/claude/`.

**How:**

- [ ] Approve exact supported-version discovery, plugin structure, hook payloads, wrapper behavior, config merge, and failure contracts.
- [ ] Implement version and capability detection from documented CLI surfaces.
- [ ] Render canonical workflows into namespaced Claude skills and plugin metadata.
- [ ] Install through a dedicated managed plugin path and semantic config merge.
- [ ] Implement safe agent invocation with argv arrays, bounded stdin, timeouts, and structured result validation.
- [ ] Implement SessionStart injection and automatic capture only for verified lifecycle surfaces.
- [ ] Use `developer-os run claude` when direct invocation cannot meet the capture contract.
- [ ] Test against a fake CLI first and a disposable real installation second.

**Test:**

- Plugin validation and generated drift checks pass.
- Fake-CLI tests pin argv, stdin, environment, timeout, signal, exit, and malformed-output behavior.
- Install/update/uninstall preserves unrelated Claude settings.
- Capture redacts before persistence or model input.
- Unsupported Claude versions report exact missing capabilities rather than partial success.

**Checkpoint:** A Claude-only user completes the full synthetic Brain workflow with no Codex installation.

---

### Task 5: Specify and implement the Codex adapter

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-codex-adapter-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-codex-adapter.md`
- Create: `packages/adapter-codex/src/`
- Generate: `plugins/codex/`
- Create: `tests/contracts/adapters/codex/`, `tests/fixtures/agents/codex/`, and `tests/integration/codex/`

**Interfaces:**
- Consumes: the same canonical workflow, Brain, security, platform, and ownership interfaces as Task 4.
- Produces: `CodexAdapter`, `CodexCapabilities`, `CodexInvocation`, Codex plugin/skill/`AGENTS.md` artifacts, managed hook plans, and structured agent-run results.

**What:** Add Codex as an independent adapter without claiming undocumented transcript or lifecycle parity.

**Where:** `packages/adapter-codex/` and generated `plugins/codex/`.

**How:**

- [ ] Approve exact supported Codex surfaces against current official documentation and verified local behavior.
- [ ] Implement version and capability detection.
- [ ] Render the canonical workflows into Codex skills and durable guidance at the smallest appropriate scope.
- [ ] Install only dedicated managed artifacts and semantically merge required config.
- [ ] Implement safe non-interactive invocation and structured output validation.
- [ ] Implement documented hooks when available and wrapper-required capture otherwise.
- [ ] Refuse transcript parsing unless a stable documented contract exists and has a regression fixture.
- [ ] Test against a fake CLI first and a disposable real installation second.

**Test:**

- Codex artifacts regenerate idempotently and validate against the supported plugin/skill schema.
- Direct and wrapper capability matrices are separately tested.
- Install/update/uninstall preserves unrelated Codex configuration.
- A missing capture hook becomes `wrapper-required`, not a false `yes`.
- A Codex-only user completes the same synthetic Brain outcome contract as Claude.

**Checkpoint:** Claude-only, Codex-only, and dual-adapter installations all work, with explicit differences in `doctor`.

---

### Task 6: Harden capture, review, ingest, security, and recovery

**Complexity:** L

**Files:**
- Create: `docs/superpowers/specs/2026-07-21-developer-os-knowledge-pipeline-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-knowledge-pipeline.md`
- Extend: `packages/brain/src/capture/`, `packages/brain/src/review/`, and `packages/brain/src/ingest/`
- Extend: `packages/security/src/`
- Extend: `packages/core/src/transactions/`
- Create: `tests/security/` and `tests/e2e/knowledge-lifecycle/`

**Interfaces:**
- Consumes: both adapter structured-run contracts, `BrainService`, `TransactionStore`, and `SecurityPolicy`.
- Produces: complete `CaptureEnvelopeV1` transitions, `ReviewDecision`, `IngestProposal`, `IngestValidationResult`, `ApplyResult`, and recovery commands.

**What:** Make the complete knowledge loop safe under secrets, prompt injection, malformed output, concurrency, and process interruption.

**Where:** Brain, security, transaction packages, and end-to-end fixtures.

**How:**

- [ ] Approve exact capture fields, lifecycle transitions, retention behavior, and redaction classes.
- [ ] Implement atomic quarantine writes and post-redaction deduplication.
- [ ] Implement accept/edit/reject review without automatic deletion.
- [ ] Invoke agents with source material marked as untrusted data and a staging-only write contract.
- [ ] Validate schema, provenance, links, duplicates, confidence, secrets, indexes, generated artifacts, and write scope.
- [ ] Add per-file backup, atomic replacement, transaction journal, resume, rollback, and concurrent-edit refusal.
- [ ] Add sentinel secret, prompt injection, symlink escape, multiline command, malformed manifest, and interruption tests.
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
- The preconditions listed in `docs/superpowers/plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md` must be closed before cutover starts. They are the only remaining reasons to open `~/claude-shared` or `~/brain` at all, and closing them ends legacy work permanently.

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
