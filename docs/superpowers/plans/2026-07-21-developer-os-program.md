# Developer OS Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23, 2026-09-24 and 2026-09-26; see git history.

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
  **DOS-P7 cross-reference:** the founder-ratified external-effect extension for exact `.git`
  internals, an explicitly configured bare local Git destination, and closed Developer OS launchd
  labels preserves this ordering through typed source/destination and before-files/after-files
  journals, pre-recorded publication identity, verification, and compensation. Coordinator-owned
  Foundation first journals are resumably pre-staged and every finalized reversible forward step has
  a separately staged inverse transaction; effects finalize only at the exact point of no return.
  Terminal journals/plans, Foundation staging/backups, lifecycle quarantine, and per-ID locks compact
  under the permanent global mutation lock; Foundation retains its implemented journal encoding, and
  coordinator envelope deletion is journal → held lock → plan. The exact Git process table, including
  the supervised SSH bridge and pre-intent local receive forced through `index-pack`, is hash-bound;
  retry binds the source postimage and rollback preserves published destination objects. Every new
  Foundation/coordinator journal proves its 1-MiB feasibility before ID reservation. Launchd uses an
  observable plan-derived generation label at one exact `gui/<uid>` service target and a hash-bound
  bounded `launchctl` process table. The amendments are indexed in `BACKLOG.md` §8 and
  specified in the active opt-in-surfaces design §2.4.
- Never overwrite drifted user configuration; stop with a three-way conflict report.
- Never use `git add -A`; stage only task-owned paths.
- Before every commit run `npm run lint && npm test`; also run each task's narrower verification command.
- Every code-producing task receives a fresh-context review by an agent other than the author.
- The repository remains private until its own publication-candidate secret scan is clean and an OSI-approved license is selected with qualified legal counsel. Historical credential rotations in unrelated repositories are explicitly outside the Developer OS release gate.
- This program plan is an umbrella. Each subsystem after Foundation receives its own approved spec and implementation plan before code work.
- `docs/superpowers/plans/legacy-runtime/` is a publication-excluded path, named by `docs/migration/exclusion-policy.md`; the exclusion stands for anything written there.
- `docs/superpowers/BACKLOG.md` is the single index of outstanding plans, specs, and gates. Any new plan or spec must be registered there in the same change that creates it.

## Approved execution decisions

- 2026-07-21: the founder explicitly waived the four historical credential rotations as Developer OS implementation and publication blockers. This does not permit copying secret-bearing history, private content, credentials, or unredacted source material; Task 0 must still prove the new repository's publication candidates are clean.
- The execution environment cannot access SSH or GitHub CLI credential stores. Private local implementation may proceed in a dedicated repository with `origin` recorded but no fetch or push. Remote hooks/configuration verification, reconciliation, and all remote writes remain blocked until the founder supplies a safely cloned checkout or performs that verification outside this environment.

## Canonical inputs

Every input is in this repository. Nothing below resolves outside it.

- Product design: `docs/superpowers/specs/2026-07-21-developer-os-design.md`
- Frozen source classification: `docs/migration/source-manifest.json`
- Publication boundary: `docs/migration/exclusion-policy.md`
- Frozen legacy behavior: `docs/migration/baseline-capabilities.json` — the recorded Claude Code, Codex, and Brain capability surface as of 2026-07-21, and the only admissible statement about what the legacy runtime did
- Cutover requirements: `docs/superpowers/BACKLOG.md` §4 and Task 8 below.

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
P7 Git/automation/update lifecycle
  -> P8 Founder shadow migration
      -> P9 Public beta and v1 release
```

P0–P6 are closed. The executed order of the P7 remainder relative to P8 is `docs/superpowers/ORDER.md` (A15 before A11b, D16).

---

### Task 7: Implement optional Git, automation, update, and release lifecycle

**Complexity:** L

**Ratified split (founder decision 2026-08-21):** Task 7 is delivered through two specifications
and their plans. Spec 1, `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md`,
owns configuration mutability, Git and automation; Spec 2,
`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`, owns release, update,
schema migration and rollback. The V1→V2 manifest migration was withdrawn by D18. Sequencing, the
plans and their progress live in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`
and `docs/superpowers/ORDER.md` (A11, A11b).

**Files:**
- Create: `apps/launcher/`
- Extend: `apps/cli/src/commands/git/`, `apps/cli/src/commands/automation/`,
  `apps/cli/src/commands/update/`, and `apps/cli/src/update/`
- Extend: `packages/core/src/manifest/`, `packages/core/src/update/`, and
  `packages/core/src/migrations/`
- Create: `packages/brain/src/migrations/update/`, `packages/adapter-claude/src/update/`, and
  `packages/adapter-codex/src/update/` for token-only pure planner entrypoints.
- Create: `packages/security/src/update/`
- Extend: `packages/platform-macos/src/launchd/` and create
  `packages/platform-macos/src/launcher/`
- Create: `tests/integration/git/`, `tests/integration/launchd/`, and `tests/e2e/upgrade/`

**Interfaces:**
- Consumes: Foundation transactions, Brain migrations, security scan, and both adapter update plans.
- Existing interfaces to extend rather than duplicate:
  - configuration shape at `packages/core/src/config/types.ts:20`;
  - configuration loading at `packages/core/src/config/loader.ts:221`;
  - configuration serialization at `packages/core/src/config/loader.ts:234`;
  - managed-artifact grammar at `packages/core/src/manifest/types.ts:18`;
  - installation-manifest grammar at `packages/core/src/manifest/types.ts:32`;
  - planned mutation preconditions at `packages/core/src/transactions/types.ts:54`;
  - injected process runner at `packages/security/src/process.ts:77`;
  - current uninstall composition at `apps/cli/src/commands/uninstall.ts:527`.
- Internal split dependency: spec 2 produces and implements the `InstallationManifestV2` migration and
  `ManifestStatePlanV1`; spec 1 consumes them only after that implementation lands.
- Produces: `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1`,
  `RedactionKeyStatePlanV1`, `GitSyncConfigV1`, `AutomationConfigV1`,
  `LifecycleActivationRecordV1`, `LifecycleInstallNonceV1`, `LifecycleIdAllocatorV1`,
  `LifecycleLedgerBoundsV1`, `LifecycleBootstrapLockV1`, `LifecycleBootstrapCreationTempV1`, `LegacyFoundationMutationIndexV1`, `FoundationJournalJsonV1`, `FoundationJournalJsonPrefixV1`,
  `LifecycleCoordinatorJournalV1`, `LifecyclePlanPreviewV1`, `LifecycleExecutionPlanV1`,
  `LifecycleCoordinatorPlanV1`, `LifecycleJournalClosureV1`, `ConfigReadableKeyV1`,
  `ConfigMutableKeyV1`, `ConfigGetResultV1`, `ConfigSetResultV1`,
  `FoundationParticipantRefV1`, `FoundationParticipantRefV2`, `FoundationTerminalCompactionV1`,
  `LifecycleTerminalCompactionV1`, `GitIndexStateV1`, `GitHeadStateV1`, `GitReflogStateV1`,
  `GitReflogPlanV1`, `GitSourceStateV1`, `GitScopeSnapshotV1`, `GitPlanPreviewV1`, `GitEnablePlan`, `GitDisablePlan`,
  `GitSyncPlanV1`, `PersistedGitPushPlanV1`,
  `GitEffectPlanV1`, `GitEffectJournalV1`, `GitEffectEvidenceV1`,
  `GuardedGitPathStateV1`, `PlannedGitPathStateV1`, `GitRelinquishedDirectoryRootV1`, `GitTreeFingerprintV1`,
  `GitSyncCardinalityV1`, `GitMetadataBoundsV1`, `GitPackReaderBudgetV1`, `LaunchdGuiDomainV1`, `LaunchdGenerationV1`, `LaunchdScheduledProductHomeV1`, `LaunchdGenerationProjectionV1`,
  `LaunchdCalendarIntervalV1`, `LaunchdPlistDictionaryV1`, `BoundedCanonicalPlistXmlV1`,
  `LaunchdProcessEnvironmentV1`, `LaunchdProcessDirectoryIdentityV1`, `LaunchdProcessIoProfileV1`, `LaunchdProcessArgvV1`,
  `LaunchdPreviewObservationProcessTableV1`, `SupportedLaunchdProcessTableTemplateV1`, `SupportedLaunchdProcessTableV1`,
  `LaunchdPlanPreviewV1`, `LaunchdBootstrapPlistIdentityV1`, `LaunchdBootstrapSnapshotCreationV1`, `LaunchdBootstrapSnapshotAttemptV1`, `GeneratedLaunchdLabelV1`,
  `LaunchdObservedServiceTargetV1`, `LaunchdGeneratedServiceTargetV1`, `LaunchdEffectPlanV1`,
  `LaunchdEffectJournalV1`, `SyncRecordV1`, `UninstallingMarkerV1`, `AutomationRunnerLeaseV1`,
  `AutomationStatusRecordV1`, `AutomationLogRecordV1`, `SupportedGitDistributionV1`,
  `SupportedGitExecutableV1`, `SupportedGitProcessTableV1`, `GitArgTokenV1`,
  `GitArgvGrammarV1`, `GitProcessNodeV1`,
  `GitProcessIoProfileV1`, `GitProcessPhaseBudgetV1`,
  `GitProcessEdgeV1`, `GitEnvironmentProfileV1`, `GitConfigQuotedPathV1`, `GitAlternateObjectDirectoryV1`, `GitExecGatewayV1`,
  `GitProcessSupervisorV1`, `SanitizedGitEnvironmentV1`, `SanitizedGitShadowConfigV1`, `SanitizedGitShadowConfigTemplateV1`, `SanitizedGitShadowConfigBytesV1`, `SanitizedGitShadowV1`,
  `SanitizedBareDestinationShadowV1`, `SanitizedSshBridgeV1`,
  `SanitizedLocalRemoteHelperV1`, `LaunchdPlanV1`, `LifecycleFileBindingV1`,
  `SecretOpaqueFileStateV1`, `ManagedArtifactV2`, `InstallationManifestV2`,
  `ManifestStatePlanV1`, `FreshV2InitPlanV1`, `FreshV2InitJournalV1`,
  `ManifestMigrationPlanV1`, `ManifestMigrationJournalV1`, `BootstrapExternalShapeProjectionV1`,
  `BootstrapExpectedPayloadRefV1`, `BootstrapPayloadPlanV1`, `BootstrapPayloadSourceV1`,
  `BootstrapMigrationPreimageAuthorityV1`, `BootstrapPayloadEvidenceV1`,
  `BootstrapPayloadWriteStateV1`, `BootstrapPlannedParentV1`, `PlannedCreatedPathV1`,
  `CreatedPathEvidenceV1`, `UpdateExpectedPayloadRefV1`, `BootstrapPayloadPathV1`,
  `ManifestPayloadPathV1`, `CanonicalStatePayloadPathV1`,
  `FoundationInitialJournalPayloadPathV1`, `UpdatePayloadPathV1`,
  `UpdateRecoveryExecutorStagedPathV1`, `OfflineReleaseTrustV1`, `ReleaseKeyDelegationV1`,
  `ReleaseIndexV1`, `ReleaseBundleManifestV1`,
  `ReleaseIdentityV1`, `ReleaseMetadataIdentityV1`, `ActiveReleaseRecordV1`,
  `ReleaseTrustStateV1`, `TenDigitZeroPaddedOrdinalV1`, `UpdatePlanPreviewV1`,
  `UpdateRollbackPreviewV1`, `UpdateCapacityProjectionV1`, `PreparedUpdateCandidateV1`,
  `PreparedUpdateMaterializationV1`, `PreparedOutputBlobIdentityV1`,
  `PreparedInverseProjectionV1`,
  `ReleasePlanningScratchV1`, `ReleasePlanningScratchJournalV1`,
  `ReleaseScratchPathWriteStateV1`, `ReleaseScratchEntryWriteStateV1`,
  `ReleaseScratchEntryEvidenceV1`,
  `UpdatePlannerRequestV1`, `TargetUpdateDraftV1`, `PlannerArtifactInputV1`,
  `PlannerBrainSnapshotV1`, `PlannerManifestSnapshotV1`, `PlannerPathRefV1`,
  `PlannerInstalledContentDraftV1`, `OwnerUpdateDraftV1`, `OwnerExternalEffectDraftV1`,
  `SchemaMigrationDraftV1`,
  `PlannerInputBlobRefV1`, `PlannerOutputBlobRefV1`, `PlannerWireBoundsV1`,
  `PlannerTranscriptIdentityV1`, `SchemaMigrationPlanV1`,
  `SchemaMigrationExecutionJournalV1`, `UpdateConstructionPlanV1`,
  `UpdateConstructionJournalV1`, `UpdateConstructionDirectoryPlanV1`,
  `UpdateConstructionDirectoryIdentityV1`, `UpdateConstructionFilePlanV1`,
  `UpdateConstructionOutputFrameV1`, `UpdateConstructionOutputConsumerV1`,
  `UpdateConstructionRollbackSourceV1`, `UpdateConstructionRollbackSourceEntryV1`,
  `UpdateConstructionRollbackEntrySourceV1`, `UpdateConstructionPayloadSourceV1`,
  `UpdateConstructionPreimageAuthorityV1`, `UpdateConstructionPlanDerivedSourceV1`,
  `UpdateConstructionWriteStateV1`, `UpdateConstructionFileEvidenceV1`,
  `UpdateConstructionOuterFileV1`, `UpdateConstructionOuterWriteStateV1`,
  `UpdateConstructionOuterIdentityV1`, `ImmutableUpdateConstructionRefV1`, `UpdateExecutionPlanV1`,
  `BundleSourceStagingPlanV1`, `BundleSourceReadyEvidenceV1`,
  `BundlePublicationSourceV1`, `BundlePublicationPlanV1`,
  `OwnerUpdatePlanV1`, `PersistedOwnerChangeOperationV1`,
  `OwnerExternalEffectPlanV1`, `OwnerExternalEffectProcessPolicyV1`,
  `OwnerExternalEffectJournalV1`,
  `OwnerExternalEffectEvidenceV1`, `CanonicalStateFilePlanV1`,
  `RollbackPayloadSourceStagingPlanV1`, `RollbackPayloadSourceReadyEvidenceV1`,
  `RollbackPayloadPublicationSourceV1`, `DurableSourceEntryEvidenceV1`,
  `RollbackPayloadStatePlanV1`,
  `TargetVerificationPlanV1`, `UpdateTerminalRetirementPlanV1`,
  `BoundedUpdateInversePlanV1`, `RetainedOwnerInversePlanV1`,
  `RetainedExternalEffectInversePlanV1`, `RetainedSchemaMigrationInversePlanV1`,
  `UpdateInitialJournalRefV1`, `UpdateStateParticipantJournalV1`,
  `OwnerUpdateJournalV1`, `BundleSourceStagingJournalV1`,
  `RollbackPayloadSourceStagingJournalV1`, `BundlePublicationJournalV1`,
  `RollbackPayloadPublicationJournalV1`, `UpdateSourceStructureWriteStateV1`,
  `UpdateSourceMetadataWriteStateV1`, `UpdateSourceEntryWriteStateV1`,
  `UpdateSourceReadyWriteStateV1`, `UpdatePublicationStructureWriteStateV1`,
  `UpdatePublicationEntryWriteStateV1`, `UpdatePublicationMetadataWriteStateV1`,
  `DurablePublicationEntryEvidenceV1`,
  `UpdateLifecycleCoordinatorPlanV2`,
  `UpdateLifecycleCoordinatorJournalV2`, `UpdateLifecycleTerminalCompactionV1`,
  `UpdateStateCompactionEntryV1`, `LifecycleJournalClosureV2`, `RollbackRecordV1`,
  `RollbackPayloadInventoryV1`, `UpdateRecoveryExecutorRecordV1`,
  `UpdateRecoveryExecutorStagedFileV1`, `UpdateDirectoryIdentityV1`, and
  verified uninstall/rollback results.

**What:** Add the explicitly optional background and release lifecycle without hidden network or data loss.

**Where:** CLI, Core update/migration code, Brain token-only migration planners, Claude/Codex
token-only adapter planners, macOS adapter, and isolated integration fixtures.

**How — unfinished work only:**

The five implementation items this section held — Git on temporary repositories and bare remotes,
`launchd` plan/apply/status/disable, signed release metadata with dry-run update, migration staging
and rollback, drift-refusing update with manifest-owned uninstall, and the failure-mode tests — are
committed (plan 1b Tasks 1–18 and 20; Spec 2 Tasks 12–25; Spec 2 closure Tasks 1–8), and the Phase 8
and Phase 9 closes ran on 2026-09-26 (full suite green on `bc17550`, reviews, PR #15). What stays open:

- [ ] Phase 9: the gate on a disposable macOS account after NEW-113 replaces the exact-build pin
      (D65; plan 1b closed 2026-09-26, its Task 19 superseded).
- [ ] Parked: `update --apply` / `update rollback --apply` composition (Spec 2 closure Tasks 9–10,
      `BACKLOG.md` NEW-110), the lifecycle proof (Spec 2 Task 26) and the launcher-admitted
      release (Task 11b, D46).

**Test:** Spec 1 §7 and Spec 2 §12 are the gate matrices; Task 26 of the release plan maps every row
to named evidence.

**Checkpoint:** The complete local product lifecycle is ready for founder shadow migration.

---

### Task 8: Migrate the founder in shadow mode

**Complexity:** L

**Files:**
- Create: `docs/migration/founder-cutover.md` (written 2026-09-23, `974376a`; D58 `c613db7`)
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
- The weekly job's preflight refuses pre-existing changes under `content`, so any cutover step that
  edits the vault and does not commit the edit will abort the next scheduled run.

**How:** executed step by step through `docs/migration/founder-cutover.md` (D56).

- [ ] Run read-only `developer-os doctor` against `~/brain` and record redacted findings.
- [ ] Validate legacy topic aliases, schema, indexes, permissions, and protected paths.
- Withdrawn by D58: the separate shadow quarantine and the old-versus-new capture comparison. The
  runbook's disposable-home rehearsal (step 7c), per-adapter gate cycle (step 16) and exercised
  rollback (step 18) replace them.
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
