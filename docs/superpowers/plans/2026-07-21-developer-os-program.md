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
- Cutover requirements: `docs/superpowers/BACKLOG.md` §4 and Task 8 below.

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

### Task 7: Implement optional Git, automation, update, and release lifecycle

**Complexity:** L

**Ratified split (founder decision 2026-08-21; cross-referenced 2026-08-25):** Task 7 produces two
approved design specifications and one implementation plan for each, not one lifecycle spec and one
plan. Spec 1 is
`docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` and owns configuration
mutability, Git, and automation. Spec 2 owns release/update, `InstallationManifestV2` migration,
schema migration, and rollback. Both implementations remain required for this unchanged checkpoint;
Spec 2's manifest migration must land before Spec 1 implementation.

**Spec 1 document gate:** approved by the founder on 2026-08-28 after fresh-context `READY`; its
implementation plan is `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md`. That plan
is written but must not execute before Spec 2's manifest migration/new-init handoff lands.

**Files:**
- Create: Spec 2, registering its exact path when its design cycle begins.
- Create: one implementation plan for Spec 2 after that specification is approved.
- Extend: `apps/cli/src/commands/git/`, `apps/cli/src/commands/automation/`, and `apps/cli/src/commands/update/`
- Extend: `packages/platform-macos/src/launchd/`
- Extend: `packages/core/src/update/` and `packages/core/src/migrations/`
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
  `FoundationParticipantRefV1`, `FoundationTerminalCompactionV1`,
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
  `SecretOpaqueFileStateV1`, `UpdatePlan`, `SchemaMigrationPlan`, and
  verified uninstall/rollback results.

**What:** Add the explicitly optional background and release lifecycle without hidden network or data loss.

**Where:** CLI, core update/migration code, macOS adapter, and isolated integration fixtures.

**How — unfinished work only:**

- [ ] Implement Git against temporary repositories and bare remotes; never use real credentials in tests.
- [ ] Implement `launchd` plan/apply/status/disable through an injected filesystem/runner in tests.
- [ ] Implement signed/checksummed release metadata, dry-run updates, schema migration staging, and rollback.
- [ ] Ensure update refuses drift and uninstall removes only manifest-owned artifacts plus the one
      exact, ratified non-manifest redaction-key path.
- [ ] Test push failure, partial download, checksum mismatch, stale lock, concurrent edit, and migration failure.

**Test:**

- Git-disabled and automation-disabled installs perform no related process or network call; complete
  config-only lifecycle forgeries remain inert without matching manifest-owned applied provenance and
  a clear lifecycle-journal closure, including after every interrupted lifecycle phase.
- All four lifecycle plan commands, including `git disable`, print deterministic byte-inert
  `LifecyclePlanPreviewV1` without allocating IDs or staging identities; explicit apply revalidates
  its hash before reservation and persists only the separately allocated, preview-bound
  `LifecycleExecutionPlanV1`. Exact config get/set key/value/null/result grammars prevent lifecycle
  writes and expose redaction patterns only as a count.
- Push failure never records successful sync.
- Git refuses a same-version different binary, an unsupported distribution row, any unknown gateway
  child, and every wrong-parent, wrong-order, wrong-argv, or reused process permit before real state or
  network authority is reached; every edge additionally enforces its hashed counted-stream, idle,
  wall, inherited-phase, and whole-process-group termination policy. One top-level push invocation has
  one non-resettable 600-second phase; a later exact `push_pending` invocation receives a new phase only
  after all persisted-plan rechecks and no cumulative lifetime clock is trusted. Every persisted push
  binds a `SanitizedGitShadowConfigTemplateV1` hash even without a source effect; source/destination
  Git shadows de-slot fresh concrete paths/token and bind exact canonical projection/byte hashes before spawn;
  `http.followRedirects=false` makes every redirect fail without a second destination request.
- Local/file receive completes in private pre-intent planning, its destination closure is immutable
  before source publication, generated config forces the sole `index-pack` branch for zero/nonzero
  object packs when a ref-update command exists, the exact up-to-date target uses no pack/index child
  and a zero-transition destination effect, and real-destination promotion spawns no process. Numeric
  metadata bounds refuse source/destination config, candidate config, index, `HEAD`, loose-ref, and
  reflog overflow before ID allocation, materialization, copy, parse, or hash. Git-config-rendered
  paths reject controls/line breaks, enable alone may publish the initial `.git`, and every sync —
  including the first unborn sync — uses existing-repository object/index/reflog/ref transitions.
  Required source/destination reflog appends use exact planned committer/date bytes and CAS, bind
  bijectively to one matching ref transition/projection, and admit a 64-MiB preimage plus only the
  exact bounded 4-KiB append postimage. The streaming pack/ref reader requires equal decoded-header,
  admitted-entry, and distinct transitive-closure counts and enforces its 2-GiB compressed,
  200,001-object, 512-MiB per-object, 8-GiB
  aggregate/delta-work, depth-50, 10-million-instruction, 256-MiB RAM, 10-GiB temp, and inherited
  600-second limits before intent. Empty bare destinations bind
  an exact symbolic `GitHeadStateV1` with absent target ref, and `GitAlternateObjectDirectoryV1`
  prevents one environment value from parsing as more than one read-only object directory.
- Terminal Foundation/lifecycle evidence, staging/backups, and per-ID locks compact crash-resumably;
  an immutable install nonce plus monotonic allocator prevents ID reuse, partial allocator and exact
  canonical legacy `0..4294967294`
  planless residue plus initial coordinator/participant/effect publication temps follow their exact
  guarded grammars, Foundation retains its implemented journal serializer and admits 16-MiB streamed
  mutation payloads, every standalone/participant Foundation and coordinator journal proves its
  largest reachable exact encoding fits the derived/plan-bound 1-MiB ceiling before ID reservation,
  every Git effect proves its largest reachable cumulative journal fits the plan-bound 16-MiB ceiling,
  the coordinator plan is unlinked last with no lock-only crash state, exact
  aggregate reservations hold, and repeated scheduled status/log writes cannot exhaust the bounded
  ledger.
- Launchd command-before-observation and reverse crashes recover from the exact live-state table;
  exact domain/service `launchctl print` probes observe the plan-derived generation label in
  `gui/<effective-uid>`, not a plist hash or caller bootstrap namespace, and a live-only reconcile
  performs exactly its zero-or-more `Q` transitions without Foundation or manifest mutation. The
  allocation-free preview observation row permits at most 13 read-only `print` processes per preview
  or revalidation pass from guarded root-owned `/private/var/empty`; its hash and the mutation-template
  hash are exact members of the outer and nested previews. The hash-bound launchd mutation process
  template/expanded row pins `/bin/launchctl`, sanitized environment,
  stream/idle/wall/shared-transition limits, and SIGTERM→SIGKILL/reap behavior for `print`, FD-3
  `/dev/fd/3` `bootstrap`, and `bootout`; bootstrap streams the verified planned real-plist bytes into
  a private snapshot, admits a linked empty/partial/complete prefix only at its exact current effect
  frontier, unlinks that exact inode before spawn, inherits only snapshot FD 3 and never the real source
  descriptor, detects replacement
  and in-place mutation of the real plist, and restores the pre-attempt open-descriptor baseline on
  every parent/child outcome. A disposable pinned-macOS certification is mandatory and there is no
  linked-path or mutable-path fallback. Crash fixtures kill snapshot construction after create, every
  partial-prefix write, sync, open, and immediately before/after unlink; only the current-frontier
  creation state may resume or be guarded-cleaned while live state remains the command preimage.
  Exact-byte fixtures cover the five-key canonical plist XML, hourly/daily/weekly calendar mapping,
  weekday numbers, null-sink output, escaping, and rejection of every extra key/alternate encoding.
  Post-intent Git `EEXIST` is
  preserved as a third state; rollback restores source/destination control state without deleting
  published source objects, destination pack/index objects, or a newly published `.git` tree; tagged source-index absence supports only an unborn empty repository, retry
  validates only `sourceAfter`, and the shared Git cardinality calculation fits every
  effect/fingerprint/staging bound.
  Launchd process root/`HOME`/`TMPDIR` follow one hash-bound path-owner-mode-device-inode staging
  grammar with exact empty process boundaries and only the current-frontier linked snapshot prefix
  between them. The generation projection/plist carries exact guarded
  `--product-home`; scheduled bootstrap parses it before ordinary CLI context and ignores ambient
  home/Brain overrides. Each scheduled runner first authenticates installed manifest/plist/generation
  evidence independently, then under its lease/global lock either runs an actively eligible handler
  or writes only `automation_disabled`/the Git-specific `git_disabled` with zero Brain/Git/vendor/
  network effects. Each runner holds
  its existing per-job lock as a lifetime lease before waiting on the global lock, and uninstall drains those leases without the
  global lock. A missing/replaced lease is silent only for marker, manifest absence, or the exact typed
  uninstall coordinator after verified lease removal. Fresh init and the no-manifest uninstall
  variant use the exact transient `LifecycleBootstrapLockV1` protocol: external preflight, exact
  inode acquisition/recheck, a complete second bounded no-follow inventory, unlink-while-held cleanup,
  stale-inode waiter restart, exact crash-residue adoption, and bootstrap-before-global lock order for
  concurrent init. No-manifest uninstall remains process-free; an absent redaction key returns before
  recovery ID, plan, or coordinator allocation and leaves no file/control residue, while a present key alone derives
  exactly `K(stage) · K(delete)` in the closed flat bootstrap envelope without creating installed
  ledger roots. A non-crashing attempt removes its recorded empty directories; after crash the
  indistinguishable exact empty skeleton is preserved, and first-creation nonce/allocator temps obey
  `LifecycleBootstrapCreationTempV1`. The admitted external grammar remains exact absent/empty/empty-state/
  key-only product-home plus absent external plists; every other known or unknown entry is preserved
  recovery-required, and base/prefix labels are not product-owned service authority. Flat-envelope
  recovery admits one authoritative final coordinator journal plus one exact bounded rewrite temp at
  every post-intent cursor/phase crash.
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
- The weekly job's preflight refuses pre-existing changes under `content`, so any cutover step that
  edits the vault and does not commit the edit will abort the next scheduled run.

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
