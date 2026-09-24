# Developer OS Opt-in Surfaces 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship opt-in Git synchronization of the Brain (`git enable|disable|status|sync`), scheduled automation of Spec 1 §5.1's four jobs (`automation enable|disable|status` plus the hidden scheduled runner), and the `uninstall/present_manifest` (`P`) variant. All of it runs on top of the lifecycle kernel that plan 1a shipped, with no hidden process, network, filesystem or credential authority.

**Architecture:** Plan 1a left every Git and launchd slot in the kernel typed but refused (`unsupported_until_plan_1b`). This plan fills those slots from the leaves inward:
- **Core** gains the Git domain (metadata admission, scope and planner, the journaled effect executor) and the effect-journal hookup in the ledger.
- **Security** gains one supervised-process primitive and, on top of it, the closed Git process graph, sanitized shadows, gateways and the bounded pack reader.
- **platform-macos** gains the launchd registry, plist bytes, pinned `launchctl` observation, unlinked-snapshot bootstrap and the journaled launchd effect executor.
- **The CLI** is the composition root. One task swaps the `never` leaves in `apps/cli/src/lifecycle/codecs.ts` for real codecs and wires the adapters. The Git, automation, runner and uninstall tasks then build on that.

**Tech Stack:** TypeScript 5.x strict ESM, Node.js built-ins, Zod 4, smol-toml, Vitest 4. The shipped lifecycle kernel (`packages/core/src/lifecycle/`), Foundation transactions, and the injected filesystem/process/clock/lock adapters.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` as amended 2026-09-17 and 2026-09-22 (its change record). It is normative for every literal this plan names by section instead of copying: process tables, argv, environment maps, byte bounds, the operation/step grammar, the point-of-no-return table and the §7 gate matrix. Where this plan and the spec disagree, the spec wins, except where a numbered founder question below asks for an amendment. Until that amendment is approved, the affected task implements the spec as written or stays blocked, as its task text says.

**Sources:**
- Tasks 8–20, 22 and 24 of the 2026-08-28 opt-in-surfaces plan, deleted 2026-09-24 once this plan carried every open task (git history holds it). Each task below names its source task. Old Tasks 1–7, 21 and 23 landed through plan 1a (`43c6876..082e098`).
- Roadmap `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`, Phase 9 and decisions D16, D25, D39, D42, D44, D47 and D56.
- `docs/superpowers/BACKLOG.md` rows NEW-84 and NEW-100.
- `docs/architecture/foundation.md` §10, `foundation-constraints.md` ("Plan 1a: lifecycle kernel bounds") and `threat-model.md` §5.13.
- The code as it stands at `3fa320a`.

---

## Status 2026-09-23 (D56 lane)

Tasks 1–18 and 20 committed, tests written and not run (D56): 1 `5e6c9b2` `667bf2f`, 2 `b41d730`,
3 `8588cc3`, 4 `176b259`, 5 `51b04e3`, 6 `06d265c`, 7 `19bd1f0`, 8 `ef724f6`, 9 `8ec8709`,
10 `ec51962`, 11 `fd3f316`, 12 `c87a276`, 13 `f1ccbf9`, 14 `bf3c526`, 15 `44ca96e`,
16 `8403283` `0cca77e`, 17 `4b68276` `a66d7ee`, 18 `4794517`, 20 `d1b1e77`. Open: Task 19 (founder
certification on the pinned host, HTTPS/SSH traces need a disposable remote) and Task 21 (phase close).

The bodies of the committed tasks and the wave table were deleted on 2026-09-24 (git history holds
them: `git show c6be513:docs/superpowers/plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`, which
Task 21 Step 3 reads for the per-task decisions it carries into the architecture documents); the tests they wrote are listed in Task 21 Step 1. Task numbers elsewhere in this file name
those commits. Order of the open work: Task 19, then Task 21.

## What plan 1a already delivered (do not rebuild)

Every task below consumes these by name. The source plan's tasks produced several of them anew, and this plan drops those productions.

| Shipped contract | Where |
|---|---|
| `GitSyncConfigV1`, `GitScopeSnapshotV1`, `AutomationConfigV1`, `NormalizedScheduleV1`, `ScheduledJobIdV1`, `SCHEDULED_JOB_IDS` (canonical order, `git-sync` fourth), `WEEKDAY_IDS`, `LifecycleActivationArmV1`, `LifecycleActivationRecordV1`, `parseValidatedGitBranch`, `parseNormalizedRemoteUrl`, `parseVaultSegment`, `gitScopeFingerprint`, `lifecycleConfigHash`, `parseLifecycleActivationRecord`, `encodeLifecycleActivationRecord` | `packages/core/src/config/lifecycle.ts` |
| `CONFIG_READABLE_KEYS`, `CONFIG_MUTABLE_KEYS` (no `git.*`/`automation.*`: `config set` refuses them `config_key_read_only`), `publishableConfig`, `config_brain_path_is_repository_identity` | `packages/core/src/config/keys.ts` |
| Operation/phase/slot/step-kind tables, `LIFECYCLE_PREVIEW_*`, `LIFECYCLE_SUBSYSTEMS`, `LIFECYCLE_PLAN_BOUNDS`, `LIFECYCLE_HASH_DOMAINS` (including `gitEffectPlan` and `launchdEffectPlan`), `LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush>`, `LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview>`, `LifecycleEffectRefV1<Id>`, `LifecycleJournalClosureV1` (with `retry_only`) | `packages/core/src/lifecycle/types.ts` |
| `GitEffectIdV1` (`ge`), `LaunchdEffectIdV1` (`le`), `formatAllocatedLifecycleId`, `parseAllocatedLifecycleId`, `LIFECYCLE_LEDGER_BOUNDS` | `packages/core/src/lifecycle/ids.ts` |
| Every operation variant, including `git_sync/{no_changes,new_network,existing_network,new_local,existing_local}` and `automation_reconcile/{files,live_only}`; `LIFECYCLE_STEP_GRAMMAR`, `LIFECYCLE_POINT_OF_NO_RETURN`, `LAUNCHD_PLAN_VARIANTS`, `LifecycleVariantFactsV1`, `deriveLifecycleOperationVariant`, `deriveUninstallLaunchdEvidence`, `lifecycleReservationOrder` | `packages/core/src/lifecycle/grammar.ts` |
| `LifecycleCoordinator.execute(id, global)`, `LifecycleEffectAdapterV1`, `LifecycleParticipantAdaptersV1` (with `networkPush` and `drainRunners` slots), `LifecycleCoordinatorOutcomeV1` (with `push_pending`) | `packages/core/src/lifecycle/coordinator.ts` |
| `LifecycleValueCodec<T>`, `LifecycleHashedValueCodec<T>`, `LifecycleLeafCodecsV1`, `createLifecycleCodecs`, `lifecyclePreviewHash`; the preview validator already enforces Git/automation subsystem exclusivity | `packages/core/src/lifecycle/codecs.ts` |
| `reserveLifecycleIdBlock`, `LifecycleExecutionBuilderV1`, `assertLifecycleExecutionFeasible`, `LifecycleCoordinatorStore`, `LifecycleRecoveryService`, `compactTerminalCoordinator` | `packages/core/src/lifecycle/{allocator,store,recovery,coordinator-compaction}.ts` |
| Global lock rule (`acquireExisting`, never `O_CREAT`), `LifecycleStableLockProviderV1.acquireExistingWithin`, `LIFECYCLE_LEASE_DRAIN_MS` | `packages/core/src/lifecycle/locks.ts`, `packages/platform-macos/src/stable-lock.ts` |
| Journal roots `state/git-effect-journals`, `state/launchd-effect-journals`; every runtime reservation (`state/git-sync.json`, `state/uninstalling.json`, `state/automation-<job>.status.json`, `state/.automation-<job>.lock`, `logs/automation-<job>.<0..9>.json`), created by fresh `init` | `LIFECYCLE_RESERVATION_ROWS` in `apps/cli/src/lifecycle/admission.ts`; `packages/core/src/lifecycle/bookkeeping.ts` |
| `admitInstalledV2Home`, `observeLifecycleActivationRecord` (replaces the source plan's `admitSpec1LifecycleInstallation`, which is dropped) | `apps/cli/src/lifecycle/admission.ts` |
| `withLifecycleMutation`, `createGatedTransactionExecutor` | `apps/cli/src/lifecycle/mutation-gate.ts` |
| `LifecycleUnsupportedLeafError`, `UNSUPPORTED_STEP_KINDS`, `refuseUnsupportedArms`, `lifecycleVariantFacts`, `uninstallLeasePaths`, `createLifecycleExecutionCodecs` | `apps/cli/src/lifecycle/codecs.ts` |
| `LifecycleUninstaller`, `deriveVariant`, the lease drain, `externalPlistPaths`, `refuseUnsupportedUntilPlan1b` (the `P` refusal) | `apps/cli/src/lifecycle/uninstall.ts` |
| Plist ownership shape: a manifest row with owner `macos`, kind `file`, verification `content`, path `<user home>/Library/LaunchAgents/com.developer-os.<job>.plist`; the activation record is a `content` artifact (A1/A6) and needs no new `ManagedArtifactSchemaIdV1` | `packages/core/src/manifest/types.ts`; spec §2.1 |

The source plan assumed three things that are wrong about today's code. Every task below is re-derived against the code instead:
- `commands/output-schemas.ts` does not register command results; it holds the agent-output JSON Schemas `init` installs. No task here modifies it.
- The coordinator's effect adapter is `LifecycleEffectAdapterV1 { apply(ref), finalize(ref), compensate(ref), observe(ref), compact(ref, outcome) }` over `LifecycleEffectRefV1`, not `apply/observe/compensate/compact(step)`.
- `main.ts` registers a command through `COMMAND_OPTIONS`, `COMMAND_POSITIONALS`, a subcommand table, `USAGE` and the `dispatch` switch.

---

## NEW-84: measured row and re-pinning rule

**Measured 2026-09-23 on the development machine, read-only.** Nothing was loaded, bootstrapped or booted out, and no launchd job or file was modified. The exact commands:

```bash
sw_vers
uname -m
shasum -a 256 /bin/launchctl
stat -f '%Su:%Sg %Lp %z %l' /bin/launchctl
launchctl version
stat -f '%Su %Lp' /private/var/empty; ls -A /private/var/empty | wc -l
which -a git; git --version; /usr/bin/git --version
xcode-select -p; xcodebuild -version
X=/Applications/Xcode.app/Contents/Developer
$X/usr/bin/git version --build-options
shasum -a 256 $X/usr/bin/git; stat -f '%Su %Lp %z' $X/usr/bin/git
stat -f '%N %Su %Lp %z %Y' $X/usr/libexec/git-core/{git,git-pack-objects,git-receive-pack,git-index-pack,git-unpack-objects,git-remote-https,git-remote-http}
shasum -a 256 $X/usr/libexec/git-core/git-remote-http
shasum -a 256 /usr/bin/ssh; stat -f '%z %Su %Lp' /usr/bin/ssh; ssh -V
```

**launchctl row (spec §5.3):**

| Field | Spec 1 pinned (2026-08-26) | Measured 2026-09-23 |
|---|---|---|
| `operatingSystem` | macOS 26.5.2, build `25F84` | macOS 26.6.2, build `25G83`, arm64 |
| `/bin/launchctl` owner/mode/links | uid 0, `0755` (493) | `root:wheel`, `0755`, 1 link |
| `/bin/launchctl` size | 364448 | 363488 |
| `/bin/launchctl` SHA-256 | `b1f2b90f349938cc4c3c9234f11cefd05545f7b4bfe9b1751ac01f1cb27d3714` | `b4dbf509754d8e1117f7851baa93ede75bc75218c48d6ddf19fbb1505d261be7` |
| `launchctl version` | not recorded | `Darwin Bootstrapper Version 7.0.0: Fri Jul 31 21:16:41 PDT 2026; root:libxpc_executables-3102.160.5~130/launchd/RELEASE_ARM64E` |
| `/private/var/empty` | root, `0755`, empty | root, `0755`, 0 entries |
| Table IDs | `launchctl-macos-26.5.2-25F84-{preview,fd3}-v1` | proposed `launchctl-macos-26.6.2-25G83-{preview,fd3}-v1` |

**Git row (spec §4.2):**

| Field | Spec 1 pinned | Measured 2026-09-23 |
|---|---|---|
| Selected Xcode | 26.6 (17F113) | 27.0 (27A266a), `xcode-select -p` = `/Applications/Xcode.app/Contents/Developer` |
| Version line | `git version 2.50.1 (Apple Git-155)` | `git version 2.54.0 (Apple Git-157)` |
| Build-option lines | 11 lines | **13 lines**: `cpu: arm64`, `no commit associated with this build`, `sizeof-long: 8`, `sizeof-size_t: 8`, `shell-path: /bin/sh`, `rust: disabled`, `feature: fsmonitor--daemon`, `libcurl: 8.7.1`, `zlib: 1.2.12`, `SHA-1: SHA1_DC`, `SHA-256: SHA256_BLK`, `default-ref-format: files`, `default-hash: sha1` |
| Main target `…/usr/bin/git` | 3,704,880 bytes, `10f9c1df…ffd2a9` | root `0755`, 3,837,392 bytes, `9a1c8fc68dc75e1b3c0cd8e5ad9d13ac9bc92cb53c9578b3cff4beaf2e9b1e70` |
| Exec-path links | five size-13 `../../bin/git`, `git-remote-https` size-15 `git-remote-http` | unchanged shape: root `0755`, same sizes and targets |
| `git-remote-http` target | 2,305,920 bytes, `76169453…d56611` | root `0755`, 2,346,832 bytes, `1a68d873ea23502f44e63d8013ad2d1374a8f0161fe4a07ba8f708f686794124` |
| `/usr/bin/ssh` | 1,555,472 bytes, `470f812f…a9b2b9`, `OpenSSH_10.2p1, LibreSSL 3.3.6` | root `0755`, 1,584,576 bytes, `17542914a3fb55e7efeb35a90d594a21c84bf6a4cfe1fc8ddff5606dc2658fc3`, `OpenSSH_10.3p1, LibreSSL 3.3.6` |
| Distribution ID | `apple-git-155-arm64-xcode-26.6-17F113` | proposed `apple-git-157-arm64-xcode-27.0-27A266a` |
| Other Git on `PATH` | not recorded | `/opt/homebrew/bin/git` (2.55.0) comes first on `PATH`; `/usr/bin/git` is the Xcode shim. Neither is a supported executable: the row pins the absolute Xcode target only |

Both rows in the spec are dead on this machine. Two concrete consequences:
- As the spec is written, every Git operation refuses `unsupported_git_distribution` here.
- Every launchd operation refuses `unsupported_launchd_distribution` here.

**Re-pinning rule.** Tasks 6, 7 and 19 implement it; Task 21 records it in `docs/architecture/foundation.md`.

1. **One supported row per package, as data.** The Git row lives in exactly one constant, `SUPPORTED_GIT_DISTRIBUTION` in `packages/security/src/git/distribution.ts`. The launchd rows live in exactly one constants file, `packages/platform-macos/src/launchd/distribution.ts`. No other file restates a hash, size, build or version literal; tests import the constant and mutate one field at a time.
2. **Measure read-only.** Run exactly the command list above (in Task 19 it is captured as `scripts/measure-distribution-rows.sh`). It never runs `launchctl bootstrap`, `bootout`, `load`, `unload`, `enable`, `disable` or `kickstart`, and never writes under `~/Library/LaunchAgents`.
3. **Refuse on any drift.** A mismatch in any field (OS product version or build, executable path, owner, mode, size or hash, Xcode selection, build-option line, link target, SSH bytes) refuses `unsupported_launchd_distribution` or `unsupported_git_distribution` before any live authority. Version text is never trusted on its own (spec §4.2, §5.3).
4. **Re-pin in one change.** Measure the new row, amend the spec rows with a dated founder-approved amendment, replace the constant, and update every exact-set test that imports it. Record the Git process trace and run the FD 3 bootstrap certification on a disposable host at that exact build (Task 19). Review. It all lands in one commit ("in the same change", spec §4.2). By default a row is **replaced**, not added: a row is kept only while a certified host for it still exists.
5. **Stop when unsupported.** Until certification evidence exists for the pinned launchd row, every launchd mutation refuses `unsupported_launchd_distribution` (spec §5.3, "missing certification"). Read-only observation, preview and `automation status` still report state.

---

## Founder questions (spec amendments this plan needs)

None of these is silently applied. The owning tasks name the question they wait on.

**Answered 2026-09-23 (D59): every question takes its recommended option A.** The spec amendments are applied in the spec as "Amended 2026-09-23 (D59)". Wave 1 runs now, beside Phase 8 (D56).

- **Q1: re-pin both rows (NEW-84).** Amend spec §4.2 (the `SupportedGitDistributionV1` literal row and the ssh row), §5.3 (both `launchctl` tables) and §7 (the "11 build lines", "Apple-Git-155" and "25F84" wording) to the measured values above.
  - Sub-question **Q1a**: §4.2 types `buildOptionLines` as a fixed `readonly BoundedTextLineV1[11]`, and Git 2.54 prints 13 lines.
    - **A (recommended):** re-pin the literal count to 13, which keeps exact-set identity.
    - B: make it a bounded ordered non-empty array (1..32). That weakens the exact-count gate.
  - Blocks Task 6 and Task 7 at their literal-pinning steps. Both may land the schema, validator and tests against a fixture row, but may not commit a production constant until Q1 is answered.
- **Q2: how certification is recorded.** Spec §5.3 says a row is supported "only after an isolated certification fixture" but not how the code knows.
  - **A (recommended):** the launchd row carries `certification: { certifiedAt: UtcTimestampV1; fixtureTranscriptSha256: LowerHexSha256 } | null`, and `SupportedLaunchdProcessTableV1` validation refuses mutation while it is `null`. Task 19 fills it in the re-pin commit.
  - B: certification is a review gate only, and the constant exists only once certified. That blocks Task 7's commit until Task 19.
  - A adds one field to a spec schema, so it is an amendment.
- **Q3: OS update after automation is enabled.** Once a certified row goes stale (for example after a macOS update), `automation disable` and the `uninstall/present_manifest` variant can never `bootout`, and uninstall refuses for good. Residual 6 covers Git; nothing covers launchd.
  - **A (recommended):** add accepted residual 10. The refusal names the exact manual `launchctl bootout gui/<uid>/<generated-label>` for each installed generated label, and preserves every file.
  - B: allow `bootout` only, through the observation row, on an unsupported build. That widens process authority and needs a reviewed design.
- **Q4: who records the Git process trace for the new row.** Spec §4.2 requires "a new measured process trace".
  - **A (recommended):** Task 19 records the local/file-transport trace on temporary repositories with a local bare remote. That is agent-run: no live-machine change, no network.
  - HTTPS and SSH traces need a disposable remote the founder owns. Until they exist, those two transports refuse `unsupported_git_distribution` while local stays available.
  - B: the founder records all three.
- **Q5: suites that cannot run on hosted CI.** The hosted `macos-15` runner runs neither macOS 25G83 nor Xcode 27.0. Every test that execs the pinned Git or the pinned `launchctl` therefore refuses there by design.
  - **A (recommended):** such cases live in files named `*.pinned-host.test.ts`. `test:suite` excludes them, and a new `npm run test:pinned-host` runs them locally at phase close and at every re-pin. CI still runs every injected-runner test.
  - B: skip them silently on mismatch. Rejected, because a skip that looks like a pass is the vacuous-gate defect `BACKLOG.md` §7 forbids.
  - Naming rule under either answer: a `*.pinned-host.test.ts` file is never also `*.v2.test.ts` (`test:lifecycle` matches the substring `.v2.test.ts`), and every `*.v2.test.ts` in this plan injects a scripted `GitProcessSupervisor` and launchd runner. Real pinned Git runs only in Task 13's pinned-host file and Task 19.

---

## Global Constraints

- **Lane (D56, 2026-09-23, as dispatched by the orchestrator).** Each task writes its tests exactly as specified and **does not run them**: no `vitest`, no `npm test*`, no `npm run check`. The only per-commit gate is `npm run lint` (`tsc -b`, eslint, `tests/dist/repository/check.js`). A red lint stops the commit; fix the cause, never delete a test or disable a rule. Every "run the test" step is ticked "deferred to Task 21 (D56)". Tests and the fresh-context whole-plan review run once, at Task 21.
- **Worktrees (D33).** One implementer per task, in `../developer-os.worktrees/<task>` on branch `task/<task>` from the current `development`. Implementers commit code and tests only. They never edit `docs/superpowers/`, and never push, merge or rebase. The orchestrator integrates in dependency order and alone ticks this plan and `ORDER.md`.
- **Staging.** Exact paths only. Never `git add -A`, `git add .` or a wildcard. Check `git diff --cached --name-only` before every commit. `docs/superpowers/` is globally gitignored: new files there need `git add -f` on its own line, never chained with `&&` into `git commit`, because `git add` of those paths exits 1 even when it works.
- **Package direction.** `core ← security ← platform-macos ← apps`. Core imports no Security, platform or CLI code. Platform and Security code receive filesystem, process, clock, lock and identity dependencies.
- **Inert until enabled (spec §1).** Disabled Git spawns no Git process and makes no network call. Disabled automation writes no plist, starts no process and writes no status. Schema-valid config alone is never authority: operation requires the matching `LifecycleActivationRecordV1` arm plus a clear closure.
- **Never.** No code here invokes a model or vendor CLI, captures or ingests on a schedule, stores or prompts for a credential, or implements fetch, pull, merge, rebase, checkout, force-push or history rewriting. `import` and `ingest` are not registry jobs (D47).
- **Mutation protocol.** Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`. Every external effect persists its intent before it mutates and observes post-state before its cursor advances. Foundation stays the product-file protocol; `.git` internals and live launchd state use only the journaled effects of spec §2.4.
- **Redaction.** Redact before truncating, hashing, logging, persisting or publishing. Raw `launchctl` output is byte-counted and discarded, never parsed, hashed or stored (spec §5.3).
- **Exact bounds (spec §2.4, §4, §5).** 1 MiB for Foundation, coordinator and launchd-effect journals; 16 MiB for immutable plans and Git-effect journals (`LIFECYCLE_SIZE_BOUNDS`, `MAX_GIT_EFFECT_JOURNAL_BYTES`, `MAX_LAUNCHD_EFFECT_JOURNAL_BYTES`). Git limits:

  | Bound | Limit |
  |---|---|
  | Objects | 200,001 |
  | Inflation per object | 512 MiB |
  | Aggregate inflation / delta work | 8 GiB |
  | Delta depth | 50 |
  | Delta instructions | 10,000,000 |
  | RAM | 256 MiB |
  | Temp | 10 GiB |
  | Push phase | one inherited 600-second phase per top-level invocation |
  | Scope | 16-MiB file, 1-GiB aggregate |

  Launchd limits: 4-MiB stdout and 1-MiB stderr per `launchctl` call, 30-second observation and transition deadlines, 100-ms termination grace. Logs: 1 MiB per log slot, 10 slots, 64 KiB per status.
- **Identity encoding (D31).** Every recorded `dev`/`ino` comes from `{ bigint: true }` stats. `tests/repository/check.ts` (`findIdentityRenderings`, `findNumberValuedStats`) enforces it at lint.
- **Fixtures.** Synthetic only: temporary homes, temporary repositories, local bare remotes, injected launchd runners and clocks, no real credential. No unit or integration test installs, loads, unloads or inspects a job on the founder's machine; FD 3 certification runs only on a disposable host (Task 19). Every enumerating test asserts that its set is non-empty before asserting over it.
- **Real V2 `init`.** A case that performs a real fresh V2 `init` goes in a `*.v2.test.ts` file (the `lifecycle-v2` CI job). Test files that exec the pinned Git or `launchctl` are named `*.pinned-host.test.ts` (Q5).
- **Citations.** `tests/repository/citations.test.ts` checks every `path:line` outside fenced blocks in tracked documents. Cite symbols and files, not line numbers.
- **Comments.** Add no code comment unless it records a non-obvious platform fact, a dated past bug, or a rejected alternative someone would otherwise restore. Keep existing comments.
- **Sequencing.** Plan 1b executes after roadmap Phase 8 closes (D16, D56). NEW-100 (plan 1a Task 24, uninstall → `init` round trip) stays owned by post-A16 hardening (D42). This plan neither runs nor absorbs it, and the new `P` variant's uninstall tests add no round-trip chain.

## Review Focus

These are the input classes the spec implies but no single task's happy path exercises. Each line names the task whose tests pin it.

1. **A scheduled job's handler runs under the global lock that the runner already holds.** Every gated mutator (`brain reindex` through `withLifecycleMutation`, and the Git sync coordinator) acquires that lock itself through `acquireExisting`. A second `lockf` on a fresh descriptor in the same process reports busy. Expected: the handler reuses the held lock after an identity check; it never self-refuses exit 6 and never releases the runner's lock. **Task 16** adds the `heldGlobal` path and the test.
2. **The OS or Xcode updates after Git or automation is enabled.** Expected:
   - `git status` and `automation status` report `unsupported_git_distribution` or `unsupported_launchd_distribution` without spawning Git or mutating `launchctl`;
   - `git sync`, including a scheduled one, refuses before any repository or network spawn and preserves the pending push plan;
   - `automation disable --apply` refuses naming the Q3 manual guidance instead of half-removing plists.

   **Tasks 15, 17**.
3. **An interactive command runs while a scheduled job holds the global lock.** Examples are `config set` at 02:00 or `git sync` during `brain-reindex`. Expected: exit 6 `lifecycle_lock_busy` naming the busy lock, no partial write, and the scheduled run completes and writes its status. **Task 16**.
4. **A custom product home or Brain path with spaces, non-ASCII, `&`, `<` or quote characters.** Expected: exact XML escaping in `ProgramArguments`, `GitConfigQuotedPathV1` rendering or its refusal (for C0/C1/line breaks), and byte-identical plists across two previews. **Tasks 4, 11**.
5. **A Brain that contains a nested `.git`, a symlink, a hard link or a file over 16 MiB, or that sits on another volume from the product home.** Expected: scope refusal naming the class (`cross_device_git_state` for the device case) before any ID reservation, with `.git`, index and refs byte-identical. **Task 5**.

---

### Task 19: Certify the re-pinned rows on a disposable host (founder) · M

Source: NEW-84 and spec §5.3's certification requirement. **This is a live-host founder stop (SESSION "Stop and ask"). No agent runs it.** Hosted `macos-15` can never run it: it is not build 25G83.

**Files:**
- Create: `scripts/measure-distribution-rows.sh` (the NEW-84 read-only command list verbatim; it prints only and writes nothing)
- Modify: `packages/platform-macos/src/launchd/distribution.ts` (fill `certification` per Q2 A)
- Modify: `packages/security/src/git/distribution.ts` (the traced process-table literals, if the trace differs from the spec's graph)
- Create: `docs/migration/distribution-certification.md` (the dated transcript summary: row IDs, fixture transcript SHA-256, host build; no user names or paths)

**Interfaces:**
- Consumes: Task 10's `fd3-bootstrap.pinned-host.test.ts`; Task 13's local-receive pinned-host test; Tasks 6 and 7 constants.
- Produces: certified `SUPPORTED_LAUNCHD_PROCESS_TABLE`, and a traced Git row for the transports Q4 admits.

- [ ] **Step 1:** On a disposable macOS 26.6.2 (25G83) user account or VM, run `scripts/measure-distribution-rows.sh` and diff its output against the NEW-84 tables. Any difference restarts the re-pinning rule.
- [ ] **Step 2:** Run `npx vitest run --root tests integration/launchd/fd3-bootstrap.pinned-host.test.ts` with a unique fixture label. Record the transcript SHA-256.
- [ ] **Step 3:** Record the local-transport Git process trace with `npx vitest run --root tests integration/git/local-receive.pinned-host.test.ts`. Add the HTTPS and SSH traces only if Q4 is answered B or a disposable remote exists.
- [ ] **Step 4:** Fill the certification field, then `npm run lint`.
- [ ] **Step 5:** Commit on the founder's instruction:

```bash
git add scripts/measure-distribution-rows.sh packages/platform-macos/src/launchd/distribution.ts packages/security/src/git/distribution.ts docs/migration/distribution-certification.md
git commit -m "feat(macos): certify the 25G83 launchctl row"
```

### Task 21: Phase close · L

Source: roadmap Phase 9 gate, D56's phase-close clause, and the documentation half of 2026-08-28 Task 24. It is run by the orchestrator and the founder.

**Files:**
- Modify: `.github/workflows/check.yml` (the `lifecycle-v2` `timeout-minutes` from the measured `*.v2.test.ts` totals, using the workflow comment's formula; stop and ask if it exceeds 300)
- Modify: `docs/architecture/foundation.md` (§10's "What is refused until plan 1b" becomes the shipped Git/launchd contract, and the NEW-84 re-pinning rule is recorded)
- Modify: `docs/architecture/foundation-constraints.md` (plan 1b bounds by symbol)
- Modify: `docs/architecture/threat-model.md` (a §5.13 successor for Git transport, launchd authority and the runner lease)
- Modify: `docs/superpowers/BACKLOG.md` (close NEW-84; leave NEW-100 open, owned by post-A16 hardening per D42), `docs/superpowers/ORDER.md`, and the roadmap Phase 9 checkbox
- Keep: `docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md` (NEW-100's only copy of Task 24)

- [ ] **Step 1:** Run every deferred command from Tasks 1–20, then `npm run check`, then (serially, one real `init` at a time) every `*.v2.test.ts` this plan added. Then run `npm run test:pinned-host` on the certified host. Show failures only. The deferred commands, per task (commits in the Status section):

  ```bash
  # Tasks 1, 2, 5, 8 (core)
  npx vitest run --root packages/core src/lifecycle/ids.test.ts src/lifecycle/effect-ledger.test.ts src/lifecycle/ledger.test.ts src/git/types.test.ts src/git/metadata.test.ts src/git/scope.test.ts src/git/planner.test.ts src/git/effects.test.ts src/git/effect-journal.test.ts src/index.test.ts
  # Tasks 3, 6, 9, 11, 13 (security)
  npx vitest run --root packages/security src/supervised-process.test.ts src/process.test.ts src/git/distribution.test.ts src/git/process-table.test.ts src/git/supervisor.test.ts src/git/shadow.test.ts src/git/gateways.test.ts src/git/push-plan.test.ts src/git/pack-reader.test.ts src/git/local-receive.test.ts src/index.test.ts
  # Tasks 4, 7, 10, 12 (platform-macos)
  npx vitest run --root packages/platform-macos src/launchd/registry.test.ts src/launchd/schedule.test.ts src/launchd/plist.test.ts src/launchd/process-table.test.ts src/launchd/observe.test.ts src/launchd/snapshot.test.ts src/launchd/plan.test.ts src/launchd/effects.test.ts src/launchd/effect-journal.test.ts
  # Tasks 14-18 (CLI)
  npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/adapters.test.ts src/lifecycle/mutation-gate.test.ts src/commands/git/index.test.ts src/commands/git/service.test.ts src/commands/git/sync-record.test.ts src/lifecycle/runtime-records.test.ts src/commands/automation/runner.test.ts src/commands/brain.test.ts src/commands/doctor.test.ts src/commands/automation/index.test.ts src/commands/automation/service.test.ts src/commands/automation/handlers.test.ts src/lifecycle/uninstall.test.ts src/main.test.ts
  # Tasks 14-18, real V2 init, one file at a time
  npx vitest run --root apps/cli src/lifecycle/mutation-gate.v2.test.ts
  npx vitest run --root apps/cli src/commands/git/git.v2.test.ts
  npx vitest run --root apps/cli src/commands/automation/runner.v2.test.ts
  npx vitest run --root apps/cli src/commands/automation/automation.v2.test.ts
  npx vitest run --root apps/cli src/lifecycle/uninstall-launchd.v2.test.ts
  npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts
  # Task 20
  npm run build && npx vitest run --root tests integration/git/lifecycle.test.ts integration/launchd/lifecycle.test.ts e2e/opt-in-surfaces.test.ts security/network.test.ts repository/check.test.ts
  # Tasks 10 and 13, pinned host only (Task 19's host)
  npx vitest run --root tests integration/launchd/fd3-bootstrap.pinned-host.test.ts integration/git/local-receive.pinned-host.test.ts
  ```

  The review in Step 2 also takes the plan 1b items of `BACKLOG.md` §6.
- [ ] **Step 2:** Get one fresh-context whole-plan review from an agent that authored none of Tasks 1–20. For each accepted finding: add a failing regression test first, make the smallest fix, and rerun.
- [ ] **Step 3:** Carry the surviving decisions into the three architecture documents and cite symbols. Re-anchor every existing `path:line` citation that points into a file this plan edited (for example `threat-model.md` §5.13's `mutation-gate.ts`, `codecs.ts` and `uninstall.ts` lines): the citations test checks only that a line is in range, so a shifted line silently points at the wrong code. Then run `npm run lint` and the citations test.
- [ ] **Step 3b:** Check the CI projections from plan 1a's Global Constraints: `suite` must not exceed 127 and `e2e` must not exceed 34 CI minutes (baseline plus local delta × 2). Task 20's integration files land in `suite`, not `lifecycle-v2`. Stop and ask if either is exceeded.
- [ ] **Step 4:** Prove the Phase 9 gate on a disposable install: `git enable|sync|disable` and `automation enable|disable|status` complete, and at least one scheduled run of each job is observed on the certified host. Enabling on the founder machine is a separate founder decision.
- [ ] **Step 5:** Push one branch and open one PR; a direct push to `development` is refused with `GH013`. Report the CI evidence. Do not merge.

---

## Spec coverage index

| Spec area | Tasks |
|---|---|
| §1 inert opt-in, no vendor, no hidden network | 15, 16, 17, 20 |
| §2.1 runtime records, plist and activation ownership | 15 (`SyncRecordV1`), 16, 17, 18 |
| §2.2 lifecycle records, applied provenance | 15, 17 |
| §2.3 lease → global → transaction lock order | 16 |
| §2.4 effect journals, ledger closure, staging grammar, compaction | 1, 8, 12, 14 |
| §3 command surface | 15, 17 |
| §4.1–§4.5 Git | 2, 5, 6, 8, 9, 11, 13, 15 |
| §5.1–§5.4 automation and launchd | 4, 7, 10, 12, 16, 17, 19 |
| §6 `P` uninstall variant | 18 |
| §7 gate matrix | every task, indexed row by row in Task 20 |
| §8.3 residuals 2, 3, 5, 6, 7; proposed residual 10 (Q3) | 21 (documentation) |
