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

## Wave table

A task starts when every task on its `Consumes:` line is integrated on `development` (D33). The same wave means disjoint files. "V2" marks a task that adds or grows a `*.v2.test.ts` file; at Task 21 those cases take turns, one real `init` at a time (SESSION §4.1).

| Wave | Tasks (parallel) | Waits on | Notes |
|---|---|---|---|
| 1 | 1 · 2 · 3 · 4 | Phase 8 closed | Core effect hookup, Git schemas, Security supervised process, launchd registry/plist |
| 2 | 5 · 6 · 7 | wave 1; Q1 for 6 and 7's production constant | Git planner, Git process table, launchctl tables + observer |
| 3 | 8 · 9 · 10 | wave 2 | Git effects executor, Git supervisor, FD 3 snapshot bootstrapper |
| 4 | 11 · 12 | wave 3 | Git shadows/gateways/push plan, launchd effects executor |
| 5 | 13 · 14 | wave 4 | Pack reader + local receive; CLI codec/adapter composition (sole owner of `apps/cli/src/lifecycle/{codecs,context}.ts`) |
| 6 | 15 (V2) · 16 · 18 (V2) | 13, 14 | Git CLI; runtime records + runner; uninstall `P` |
| 7 | 17 (V2) | 15, 16 | Automation CLI and production handler wiring |
| 8 | 19 (founder) · 20 | 17, 18 | Certification + Git trace (live-host stop); integration and repository gates |
| 9 | 21 | 19, 20 | Phase close: every deferred test, whole-plan review, docs, PR |

Critical path: 2 → 6 → 9 → 11 → 14 → 15 → 17 → 20 → 21, with 2 → 5 → 8 → 14 beside it. Q1 therefore gates the whole Git chain from wave 2; until it is answered, Tasks 6 and 7 land against fixture rows only.

---

### Task 1: Hook effect journals into the ledger and export the kernel tables · M

Source: new. It closes the two plan-1a seams in `packages/core/src/lifecycle/ledger.ts`: `countStagingSubtree` ("plan 1a ships no `git/<side>/<effect-id>` or `launchd-process/{home,tmp}` grammar") and `presentEffectJournals` ("a present effect journal is never terminal"). Without it, closure never returns `clear` after the first Git or launchd effect, and every downstream recovery test is vacuous.

**Files:**
- Modify: `packages/core/src/lifecycle/ids.ts` (add `parseGitEffectId`, `parseLaunchdEffectId`)
- Create: `packages/core/src/lifecycle/effect-ledger.ts`
- Modify: `packages/core/src/lifecycle/ledger.ts` (keep the field names `gitEffectPlanCodec`/`launchdEffectPlanCodec` in `LifecycleLedgerDependenciesV1` and widen only their type to `LifecycleEffectLedgerCodecV1 | null`, so every existing `null` call site in core tests and `apps/cli/src/lifecycle/context.ts` compiles unchanged; implement the staging grammar and terminal classification)
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts` (export the `LIFECYCLE_*` constant tables from `types.ts` and the new symbols)
- Test: `packages/core/src/lifecycle/ids.test.ts`, `packages/core/src/lifecycle/effect-ledger.test.ts`, `packages/core/src/lifecycle/ledger.test.ts`

**Interfaces:**
- Consumes: `parseAllocatedLifecycleId`, `LifecycleValueCodec`, `inspectLifecycleLedger`, `LIFECYCLE_LEDGER_BOUNDS`, `MAX_GIT_EFFECT_JOURNAL_BYTES`, `MAX_LAUNCHD_EFFECT_JOURNAL_BYTES`.
- Produces:

```ts
export function parseGitEffectId(value: string): GitEffectIdV1;
export function parseLaunchdEffectId(value: string): LaunchdEffectIdV1;

export type LifecycleEffectTerminalV1 = "finalized" | "rolled_back" | null;
export interface LifecycleEffectLedgerCodecV1 {
  readonly plan: LifecycleValueCodec<unknown>;
  readonly journal: LifecycleValueCodec<unknown>;
  /** Terminal outcome of a validated journal, or null while non-terminal. */
  terminal(journal: unknown): LifecycleEffectTerminalV1;
  /** Exact staging children a validated plan owns under its side/process directory. */
  stagingChildren(plan: unknown): readonly string[];
}
export const GIT_EFFECT_STAGING_SIDES: readonly ["destination", "source"];
export const LAUNCHD_PROCESS_STAGING_CHILDREN: readonly ["home", "tmp"];
```

- [ ] **Step 1: Write the tests**

```ts
it("parses only its own prefix", () => {
  expect(parseGitEffectId(formatAllocatedLifecycleId("ge", nonce, 7n))).toMatch(/^ge_/u);
  expect(() => parseGitEffectId(formatAllocatedLifecycleId("le", nonce, 7n))).toThrow();
  expect(() => parseLaunchdEffectId(formatAllocatedLifecycleId("ge", nonce, 7n))).toThrow();
});

it("classifies a finalized Git effect journal as terminal and the closure clear", async () => {
  const home = await ledgerFixture({ gitEffect: fixtureGitEffectCodec() });
  await home.writeGitEffect({ id, journal: { phase: "finalized" } });
  expect((await home.inspect()).closure.kind).toBe("clear");
});

it.each(["git/source/<id>/extra", "git/sideways/<id>", "launchd-process/home/child", "launchd-process/other"])(
  "refuses staging entry %s outside the closed grammar", async (entry) => {
    const home = await ledgerFixture({ gitEffect: fixtureGitEffectCodec(), launchdEffect: fixtureLaunchdEffectCodec() });
    await home.plantStaging(entry);
    expect((await home.inspect()).closure.kind).toBe("lifecycle_recovery_required");
  });

it("keeps refusing effect roots when the codec is null (no widening before Task 14)", async () => {
  const home = await ledgerFixture({ gitEffect: null });
  await home.writeGitEffect({ id, journal: { phase: "finalized" } });
  expect((await home.inspect()).findings.map((f) => f.reason)).toContain("lifecycle_effect_root_unsupported");
});
```

Cover:
- exact `git/<side>/<ge-id>` directories;
- `launchd-process/{home,tmp}` as exact empty `0700` directories;
- recovery may remove only exact empty `home`, then `tmp`, then `launchd-process`, per spec §2.4 "Closed journal ledger and plan envelopes";
- the sole current-frontier `bootstrap-plist` prefix exception, which Task 10 names;
- over-cap journals at 16 MiB + 1 (Git) and 1 MiB + 1 (launchd);
- non-terminal effect journals keep closure non-clear;
- a non-empty expected set in every enumeration.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/core src/lifecycle/ids.test.ts src/lifecycle/effect-ledger.test.ts src/lifecycle/ledger.test.ts`
- [ ] **Step 3: Implement.** Keep the plan-1a refusals as the `null` arm. With a codec present, decode the plan and journal through it (bounded by the journal-size constants), count leaves against `LIFECYCLE_LEDGER_BOUNDS`, and admit only `stagingChildren(plan)`. Report `terminal(journal)` into closure. Reuse `countStagingSubtree`'s counting; do not add a second walker.
- [ ] **Step 4: `npm run lint`**. It must pass.
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lifecycle/ids.ts packages/core/src/lifecycle/ids.test.ts packages/core/src/lifecycle/effect-ledger.ts packages/core/src/lifecycle/effect-ledger.test.ts packages/core/src/lifecycle/ledger.ts packages/core/src/lifecycle/ledger.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts
git commit -m "feat(core): admit Git and launchd effect journals in the ledger"
```

### Task 2: Close Git domain schemas and guarded metadata admission · L

Source: 2026-08-28 Task 8. The branch, URL, vault-segment and scope-fingerprint validators already ship in `packages/core/src/config/lifecycle.ts`. Reuse them and do not restate them.

**Files:**
- Create: `packages/core/src/git/types.ts`, `packages/core/src/git/metadata.ts`, `packages/core/src/git/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/git/types.test.ts`, `packages/core/src/git/metadata.test.ts`

**Interfaces:**
- Consumes: `parseValidatedGitBranch`, `parseNormalizedRemoteUrl`, `parseVaultSegment`, `GitSyncConfigV1`, `CanonicalJsonV1` encoders, `LowerHexSha256`, `UInt64DecimalV1`, and the guarded read port in `packages/core/src/lifecycle/guarded-fs.ts`.
- Produces, with the exact field sets of spec §4.1–§4.4:

```ts
export type LowerHexSha1 = string & { readonly __brand: "LowerHexSha1" };
export type FullBranchRefV1 = `refs/heads/${string}`;
export type GitHeadStateV1 = {
  readonly state: "present";
  readonly bytesHash: LowerHexSha256;
  readonly semantic:
    | { readonly kind: "symbolic_ref"; readonly value: FullBranchRefV1 }
    | { readonly kind: "oid"; readonly value: LowerHexSha1 };
};
export type GitIndexStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly version: 2; readonly bytesHash: LowerHexSha256; readonly size: number; readonly treeCache: boolean };
export interface GitMetadataBoundsV1 { /* the numeric pre-read caps of spec §4.4 */ }
export interface GitPackReaderBudgetV1 { /* spec §4.2 pack budget */ }
export type GitReflogStateV1; export type GitReflogPlanV1; export type GitSourceStateV1;
export type GuardedGitPathStateV1; export type PlannedGitPathStateV1;
export type GitRelinquishedDirectoryRootV1; export type GitTreeFingerprintV1;
export function inspectGitMetadata(
  dependencies: GitMetadataDependencies,
  request: GitMetadataRequestV1,
): Promise<GitSourceStateV1>;
export function validateGitHeadState(value: unknown): GitHeadStateV1;
export function validateGitIndexState(value: unknown): GitIndexStateV1;
export function validateGitReflogPlan(value: unknown): GitReflogPlanV1;
```

- [ ] **Step 1: Write the tests**

```ts
it("admits only plain DIRC v2 plus the supported TREE cache", async () => {
  expect(await inspectGitMetadata(deps, fixture.plainV2())).toMatchObject({ index: { state: "present", version: 2 } });
  await expect(inspectGitMetadata(deps, fixture.splitIndex())).rejects.toThrow("unsupported_index_format");
});

it.each(metadataBoundaries)("refuses the first byte over $name before allocation or hash", async ({ fixture, reason }) => {
  await expect(inspectGitMetadata(deps, fixture)).rejects.toThrow(reason);
  expect(deps.hashCalls).toBe(0);
  expect(deps.bufferAllocations).toBe(0);
});

it("reads with no-follow and refuses an identity change between lstat and read", async () => {
  await expect(inspectGitMetadata(deps, fixture.swappedHeadDuringRead())).rejects.toThrow("git_metadata_identity_changed");
});
```

Cover:
- symbolic, detached and unborn `HEAD`;
- an absent tagged index;
- repository extensions, index stages, flags and extensions;
- config, candidate-config, index, `HEAD`, loose-ref and reflog byte caps at boundary and boundary+1;
- a reflog postimage up to 67,112,960 bytes, with a 64-MiB preimage cap;
- owner, type, link and identity changes;
- a symlinked or hard-linked leaf;
- rejection before allocation, materialization or hashing;
- and, for every exact enumeration, an assertion that it is non-empty.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/core src/git/types.test.ts src/git/metadata.test.ts src/index.test.ts`
- [ ] **Step 3: Implement.** Read one guarded, bounded leaf at a time with no-follow opens, and check identity before and after each read. Parse only the forms spec §4 approves. Return immutable semantic projections and hashes, never mutable handles. Apply bounds before allocation, copy, parse or hash.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/git/types.ts packages/core/src/git/metadata.ts packages/core/src/git/index.ts packages/core/src/git/types.test.ts packages/core/src/git/metadata.test.ts packages/core/src/index.ts
git commit -m "feat(core): close Git metadata admission"
```

### Task 3: Add the supervised process primitive · M

Source: the low-level half of 2026-08-28 Task 11, split out because Git (Tasks 9, 11, 13) and launchd (Tasks 7, 10) both need it. `NodeProcessRunner` exposes no spawn, kill, clock or FD hooks, and has no idle deadline. This task adds a **sibling** primitive; `NodeProcessRunner`'s public behavior does not change. It reuses the pattern of `FixedReleaseTransport` (`packages/security/src/update/transport.ts`):
- a wall deadline fixed at construction, with `remainingMilliseconds()` inherited by children;
- injected `now`/`setTimer`;
- an idle timer re-armed by progress;
- counted, SHA-256-hashed streaming refused on overrun.

It does not invent a third deadline idiom.

**Files:**
- Create: `packages/security/src/supervised-process.ts`
- Modify: `packages/security/src/index.ts`
- Test: `packages/security/src/supervised-process.test.ts`

**Interfaces:**
- Consumes: `SecurityRefusalError`, the redaction API (`createRedactor`).
- Produces:

```ts
export interface SupervisedPhaseV1 {
  readonly id: string;
  readonly deadlineAtMs: number;           // absolute; children inherit, never reset
  remainingMilliseconds(): number;
}
export interface SupervisedSpawnRequestV1 {
  readonly executable: string;              // absolute
  readonly argv: readonly string[];         // literal, already expanded
  readonly env: Readonly<Record<string, string>>; // exact; nothing inherited
  readonly cwd: string;
  readonly stdin: "ignore" | { readonly bytes: Uint8Array };
  readonly inheritedFds: readonly { readonly childFd: 3; readonly parentFd: number }[]; // empty except launchd bootstrap
  readonly stdoutCap: number; readonly stderrCap: number;
  readonly idleMs: number; readonly wallMs: number; readonly terminationGraceMs: number;
  readonly phase: SupervisedPhaseV1;
}
export interface SupervisedProcessEvidenceV1 {
  readonly exitCode: number | null; readonly signal: string | null;
  readonly stdoutBytes: number; readonly stderrBytes: number;
  readonly stdoutSha256: LowerHexSha256; readonly stderrSha256: LowerHexSha256;
  readonly termination: "exited" | "idle_deadline" | "wall_deadline" | "phase_deadline" | "output_cap";
  readonly groupReaped: true;
}
export interface SupervisedProcessDependenciesV1 {
  spawn(request: SupervisedSpawnRequestV1): SupervisedChildHandleV1;
  killGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  now(): number;
  setTimer(ms: number, fire: () => void): () => void;
}
export class SupervisedProcessRunner {
  constructor(dependencies: SupervisedProcessDependenciesV1);
  beginPhase(id: string, wallMs: number): SupervisedPhaseV1;
  run(request: SupervisedSpawnRequestV1, sink?: (chunk: Uint8Array, stream: "stdout" | "stderr") => void): Promise<SupervisedProcessEvidenceV1>;
}
export const nodeSupervisedProcessDependencies: SupervisedProcessDependenciesV1;
```

- [ ] **Step 1: Write the tests**

```ts
it("does not reset an inherited phase in a later child", async () => {
  const phase = runner.beginPhase("push", 600_000);
  clock.advance(599_900);
  const evidence = await runner.run({ ...request, phase, wallMs: 30_000 });
  expect(evidence.termination).toBe("phase_deadline");
  expect(clock.elapsedSince(phase)).toBeLessThanOrEqual(600_000 + request.terminationGraceMs);
});

it("sends SIGTERM, then SIGKILL after the grace, to the whole group and reaps it", async () => {
  await runner.run({ ...hangingRequest, wallMs: 50, terminationGraceMs: 100 });
  expect(deps.signals).toEqual([["-pid", "SIGTERM"], ["-pid", "SIGKILL"]]);
  expect(deps.reaped).toBe(true);
});

it("passes exactly the requested environment and only FD 3 when asked", async () => {
  await runner.run({ ...request, env: { LANG: "C" }, inheritedFds: [{ childFd: 3, parentFd: 42 }] });
  expect(deps.lastSpawn.env).toEqual({ LANG: "C" });
  expect(deps.lastSpawn.stdio).toEqual(["ignore", "pipe", "pipe", 42]);
});
```

Cover:
- the idle deadline re-armed by output;
- the output cap at exactly the cap and at cap+1;
- hash totals equal to the stream bytes;
- no shell, ever;
- a non-absolute executable refused;
- `inheritedFds` other than the single `childFd: 3` refused;
- the existing `NodeProcessRunner` tests left untouched.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/security src/supervised-process.test.ts src/process.test.ts src/index.test.ts`
- [ ] **Step 3: Implement.** Use `spawn` with `shell: false` and `detached: true`, so the child leads its own process group. Signal with `process.kill(-pid)`. Resolve only after `close` and after any termination escalation has finished.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/security/src/supervised-process.ts packages/security/src/supervised-process.test.ts packages/security/src/index.ts
git commit -m "feat(security): add the supervised process primitive"
```

### Task 4: Define the closed job registry, schedule parser, generation and canonical plist bytes · M

Source: 2026-08-28 Task 16. `SCHEDULED_JOB_IDS` and `NormalizedScheduleV1` already exist in core config. The **string parser** (`daily@02:00` → `NormalizedScheduleV1`) does not exist yet, and spec §8.1 assigns it to this package.

**Files:**
- Create: `packages/platform-macos/src/launchd/types.ts`, `registry.ts`, `schedule.ts`, `plist.ts`, `index.ts`
- Modify: `packages/platform-macos/src/index.ts`
- Test: `packages/platform-macos/src/launchd/registry.test.ts`, `schedule.test.ts`, `plist.test.ts`

**Interfaces:**
- Consumes: `SCHEDULED_JOB_IDS`, `ScheduledJobIdV1`, `NormalizedScheduleV1`, `WEEKDAY_IDS`, `AutomationConfigV1`, `LifecycleActivationRecordV1`, `lifecycleConfigHash`, `hashCanonicalJson`, `CanonicalAbsolutePathV1`.
- Produces, with the exact shapes of spec §5.1–§5.3: `LaunchdGuiDomainV1`, `LaunchdGenerationV1`, `LaunchdScheduledProductHomeV1`, `LaunchdGenerationProjectionV1`, `GeneratedLaunchdLabelV1`, `LaunchdObservedServiceTargetV1`, `LaunchdGeneratedServiceTargetV1`, `LaunchdCalendarIntervalV1`, `LaunchdPlistDictionaryV1`, `BoundedCanonicalPlistXmlV1`, `LaunchdPlanPreviewEntryV1`, `LaunchdPlanPreviewV1`, and:

```ts
export const LAUNCHD_JOBS: readonly LaunchdJobDefinitionV1[]; // exactly SCHEDULED_JOB_IDS order, maySpawnVendor: false
export function parseScheduleFlag(value: string): { readonly job: ScheduledJobIdV1; readonly schedule: NormalizedScheduleV1 };
export function launchdGeneration(projection: LaunchdGenerationProjectionV1): LaunchdGenerationV1;
export function generatedLabel(job: ScheduledJobIdV1, generation: LaunchdGenerationV1): GeneratedLaunchdLabelV1;
export function scheduledProgramArguments(job: ScheduledJobIdV1, home: LaunchdScheduledProductHomeV1, generation: LaunchdGenerationV1, executable: CanonicalAbsolutePathV1): readonly string[]; // exactly nine
export function encodeLaunchdPlist(value: LaunchdPlistDictionaryV1): BoundedCanonicalPlistXmlV1;
export function buildLaunchdPlanPreview(request: LaunchdPreviewRequestV1): LaunchdPlanPreviewV1;
```

- [ ] **Step 1: Write the tests**

```ts
it("enumerates exactly the four jobs in canonical order, none may spawn a vendor", () => {
  expect(LAUNCHD_JOBS.length).toBeGreaterThan(0);
  expect(LAUNCHD_JOBS.map((job) => job.id)).toEqual(["brain-reindex", "brain-lint", "doctor", "git-sync"]);
  expect(LAUNCHD_JOBS.every((job) => job.maySpawnVendor === false)).toBe(true);
});

it.each([
  ["brain-reindex=daily@02:00", { job: "brain-reindex", schedule: { kind: "daily", hour: 2, minute: 0 } }],
  ["git-sync=hourly@15", { job: "git-sync", schedule: { kind: "hourly", minute: 15 } }],
  ["doctor=weekly@mon,03:00", { job: "doctor", schedule: { kind: "weekly", weekday: "mon", hour: 3, minute: 0 } }],
])("parses %s", (input, expected) => expect(parseScheduleFlag(input)).toEqual(expected));

it.each(["import=daily@02:00", "ingest=daily@02:00", "doctor=daily@24:00", "doctor=hourly@60", "doctor=*/5 * * * *", "doctor=daily@2:00", "doctor=daily@02:00Z"])(
  "refuses %s", (input) => expect(() => parseScheduleFlag(input)).toThrow());

it("serializes the exact five-key plist with one LF and escapes a hostile home", () => {
  const xml = encodeLaunchdPlist(plistFor("/Users/a b/&<\"é>/.developer-os"));
  expect(xml).toBe(expectedPlistXml);
  expect(xml.endsWith("</plist>\n")).toBe(true);
  expect(encodeLaunchdPlist(plistFor("/Users/a b/&<\"é>/.developer-os"))).toBe(xml);
});
```

The first test pins the non-vendor rule of spec §5.1 and D47: `import` and `ingest` are not jobs. The last test covers Review Focus 4.

Cover:
- hourly, daily and weekly bounds and the weekday mapping;
- duplicate and unknown jobs;
- first-enable completeness, the later preserve rule and newly eligible `git-sync` (as pure functions over the prior `AutomationConfigV1`);
- exact base labels and `~/Library/LaunchAgents` paths;
- the nine-argument `ProgramArguments` with guarded `--product-home`;
- the domain-separated generation hash;
- XML order, escaping and LF, and the 1-MiB boundary;
- literal `/dev/null` output paths;
- ambient override exclusion;
- non-emptiness of every exact set.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/platform-macos src/launchd/registry.test.ts src/launchd/schedule.test.ts src/launchd/plist.test.ts src/index.test.ts`
- [ ] **Step 3: Implement.** Keep the job table closed and exhaustively switched. Parse schedule strings into tagged numeric records before planning, and never retain the input spelling. The XML encoder emits only the approved dictionary, array, integer and string forms, in fixed order.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/platform-macos/src/launchd/types.ts packages/platform-macos/src/launchd/registry.ts packages/platform-macos/src/launchd/schedule.ts packages/platform-macos/src/launchd/plist.ts packages/platform-macos/src/launchd/index.ts packages/platform-macos/src/launchd/registry.test.ts packages/platform-macos/src/launchd/schedule.test.ts packages/platform-macos/src/launchd/plist.test.ts packages/platform-macos/src/index.ts
git commit -m "feat(macos): define canonical launchd jobs and plist bytes"
```

### Task 5: Plan exact scoped trees, index/ref/reflog transitions, and sync cardinality · L

Source: 2026-08-28 Task 9, unchanged in substance. The Brain scope comes from the shipped `GitScopeSnapshotV1` and `gitScopeFingerprint`; this task does not define a second fingerprint.

**Files:**
- Create: `packages/core/src/git/scope.ts`, `repository.ts`, `planner.ts`
- Modify: `packages/core/src/git/index.ts`
- Test: `packages/core/src/git/scope.test.ts`, `packages/core/src/git/planner.test.ts`

**Interfaces:**
- Consumes: Task 2 metadata states; `GitSyncConfigV1`, `GitScopeSnapshotV1` and `gitScopeFingerprint`; the Brain scope through an injected public enumerator (Core never imports `packages/brain`); `LifecyclePlanPreviewCoreV1`.
- Produces: `GitPlanPreviewV1`, `GitEnablePlan`, `GitDisablePlan`, the generic `GitSyncPlanCoreV1<TPushPlan>`, `GitSyncCardinalityV1`, `GitEffectTransitionV1`, and the internal allocation-free `GitSyncPlanningDraft`. Also:

```ts
export class GitPlanner {
  previewEnable(request: GitEnableRequestV1): Promise<GitPlanPreviewV1>;
  previewDisable(request: GitDisableRequestV1): Promise<GitPlanPreviewV1>;
  planSync(request: GitSyncRequestV1): Promise<GitSyncPlanningDraft>;
  assertCoreSyncFeasible(draft: GitSyncPlanningDraft): GitCoreSyncFeasibility;
}
export function validateGitSyncPlanCore<T>(value: unknown, push: LifecycleValueCodec<T>): GitSyncPlanCoreV1<T>;
```

- [ ] **Step 1: Write the tests**

```ts
it("plans only the guarded Brain scope in unsigned UTF-8 order", async () => {
  const draft = await planner.planSync(fixture.request);
  expect(draft.sync.managedPaths.length).toBeGreaterThan(0);
  expect(draft.sync.managedPaths).toEqual(sortUnsignedUtf8(expectedManagedPaths));
  expect(planner.publicMethods()).toEqual(["assertCoreSyncFeasible", "planSync", "previewDisable", "previewEnable"]);
});

it("binds every reflog append bijectively to one ref transition", () => {
  expect(() => validateGitSyncPlanCore(planWithDuplicateReflog, pushCodec)).toThrow("reflog_bijection");
});

it.each(["nestedGitDirectory", "symlinkInScope", "hardLinkInScope", "fileOver16MiB", "otherDevice"])(
  "refuses %s before any ID reservation and leaves .git byte-identical", async (name) => {
    const before = await fixture.snapshotGit();
    await expect(planner.planSync(fixture.with(name))).rejects.toThrow();
    expect(fixture.reservations).toBe(0);
    expect(await fixture.snapshotGit()).toEqual(before);
  });
```

The last test covers Review Focus 5.

Cover:
- initialize versus adopt, and enable-only `.git` publication;
- an existing unborn first sync;
- a plain index with TREE cache;
- dirty and in-progress refusal;
- tab, LF and CR filenames through NUL-safe tree input;
- the 16-MiB file and 1-GiB aggregate bounds;
- object/index/reflog/ref order;
- the 64-MiB preimage plus 4-KiB append;
- the exact committer, date and message;
- the 200,001 and 200,002 cardinality boundary;
- `no_changes` only when there is no scoped diff and `HEAD` equals the last pushed `HEAD`;
- scope-key changes → `scope_reconcile_required`;
- `brainPath` changes → repository identity refusal;
- the enable plan's branch-history warning text (spec §7 "branch-history warning is explicit");
- byte-identical, allocation-free previews.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/core src/git/scope.test.ts src/git/planner.test.ts`
- [ ] **Step 3: Implement pure planning and cardinality derivation.** `git sync` has no public preview. The draft holds every Core-owned allocation-free input and cannot be persisted, executed or bound from a preview. Task 14 combines it with the Security draft. Core's `GitSyncPlanCoreV1<TPushPlan>` never imports Security or the CLI.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/git/scope.ts packages/core/src/git/repository.ts packages/core/src/git/planner.ts packages/core/src/git/scope.test.ts packages/core/src/git/planner.test.ts packages/core/src/git/index.ts
git commit -m "feat(core): plan scoped Git synchronization"
```

### Task 6: Pin the Git distribution row and the closed process graph · L

Source: 2026-08-28 Task 10. **Waits on Q1** for the production row literal. Until Q1 is answered, the implementer lands the schema, validator, hash functions and tests against the fixture row `TEST_GIT_DISTRIBUTION` (in `distribution.test-fixtures.ts`), and `SUPPORTED_GIT_DISTRIBUTION` stays uncommitted. Once Q1 is answered, it pins the measured row from the NEW-84 section above in the same commit.

**Files:**
- Create: `packages/security/src/git/types.ts`, `distribution.ts`, `process-table.ts`, `distribution.test-fixtures.ts`, `index.ts`
- Modify: `packages/security/src/index.ts`
- Test: `packages/security/src/git/distribution.test.ts`, `packages/security/src/git/process-table.test.ts`

**Interfaces:**
- Consumes: Task 2 scalar and path types; `hashCanonicalJson`.
- Produces: `SupportedGitDistributionV1`, `SupportedGitExecutableV1`, `SupportedGitProcessTableV1`, `GitArgTokenV1`, `GitArgvGrammarV1`, `GitProcessNodeV1`, `GitProcessEdgeV1`, `GitProcessIoProfileV1`, `GitProcessPhaseBudgetV1`, `GitEnvironmentProfileV1`, `GitConfigQuotedPathV1`, `GitAlternateObjectDirectoryV1`. Also:

```ts
export const SUPPORTED_GIT_DISTRIBUTION: SupportedGitDistributionV1; // the one row (NEW-84 re-pinning rule 1)
export function validateSupportedGitDistribution(value: unknown): SupportedGitDistributionV1;
export function validateSupportedGitProcessTable(value: unknown): SupportedGitProcessTableV1;
export function hashGitProcessTable(table: SupportedGitProcessTableV1): LowerHexSha256;
export function admitGitDistribution(observed: ObservedGitDistributionV1, row: SupportedGitDistributionV1): void; // throws unsupported_git_distribution
```

- [ ] **Step 1: Write the tests**

```ts
it("round-trips the sole supported row byte-identically", () => {
  expect(validateSupportedGitDistribution(SUPPORTED_GIT_DISTRIBUTION)).toEqual(SUPPORTED_GIT_DISTRIBUTION);
  expect(hashGitProcessTable(SUPPORTED_GIT_DISTRIBUTION.processTable)).toMatch(/^[0-9a-f]{64}$/u);
});

it.each(Object.keys(observedFromRow(SUPPORTED_GIT_DISTRIBUTION)))(
  "refuses a one-field change to %s as unsupported_git_distribution", (field) => {
    expect(() => admitGitDistribution(mutate(observedFromRow(SUPPORTED_GIT_DISTRIBUTION), field), SUPPORTED_GIT_DISTRIBUTION))
      .toThrow("unsupported_git_distribution");
  });

it("refuses a same-version different binary", () => {
  expect(() => admitGitDistribution(sameVersionOtherHash(), SUPPORTED_GIT_DISTRIBUTION)).toThrow("unsupported_git_distribution");
});

it.each(mutatedProcessRows)("refuses $name before process authority", ({ value }) => {
  expect(() => validateSupportedGitProcessTable(value)).toThrow();
});
```

Pin:
- the build-option lines (count per Q1a);
- the three executable identities, including the empty helper `versionLines`;
- six exec-path links;
- twelve environment maps;
- seven I/O profiles;
- four inherited phase budgets (`distribution_probe` 30 s, `config_candidate` 30 s, `source_build` 1,800 s, `push` 600 s);
- the 21 node IDs and 21 edge IDs of spec §4.2.

Assert that every set is non-empty, unique and ordered. Assert the literal, semantic and joined argv grammar, 0 through 200,001 pack objects, and rejection of wildcards, regexes, ellipses, unknown fields, unexpanded slots, option-shaped tokens and phase resets.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/security src/git/distribution.test.ts src/git/process-table.test.ts src/index.test.ts`
- [ ] **Step 3: Implement.** Populate every literal from spec §4.2, with the row values from the NEW-84 table once Q1 is answered. Validate the static template once, and validate every concrete expanded table before use. Hash canonical domain-separated bytes. There is no `spawn` in this task.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/security/src/git/types.ts packages/security/src/git/distribution.ts packages/security/src/git/process-table.ts packages/security/src/git/distribution.test-fixtures.ts packages/security/src/git/index.ts packages/security/src/git/distribution.test.ts packages/security/src/git/process-table.test.ts packages/security/src/index.ts
git commit -m "feat(security): pin the Git distribution and process graph"
```

### Task 7: Pin the launchctl rows and bounded domain/service observation · M

Source: 2026-08-28 Task 17. **Waits on Q1**, and on Q2 for the `certification` field, the same way Task 6 waits on Q1. The table IDs, OS build and executable identity come from the NEW-84 launchctl table.

**Files:**
- Create: `packages/platform-macos/src/launchd/distribution.ts`, `process-table.ts`, `observe.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`
- Test: `packages/platform-macos/src/launchd/process-table.test.ts`, `packages/platform-macos/src/launchd/observe.test.ts`

**Interfaces:**
- Consumes: Task 4 targets and types; Task 3 `SupervisedProcessRunner`; injected OS identity (`sw_vers` values read through an injected probe, never a shell) and guarded executable identity.
- Produces: `LaunchdProcessEnvironmentV1`, `LaunchdProcessDirectoryIdentityV1`, `LaunchdProcessIoProfileV1`, `LaunchdProcessArgvV1`, `LaunchdPreviewObservationProcessTableV1`, `SupportedLaunchdProcessTableTemplateV1`, `SupportedLaunchdProcessTableV1`, and:

```ts
export const LAUNCHD_PREVIEW_OBSERVATION_TABLE: LaunchdPreviewObservationProcessTableV1;
export const SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE: SupportedLaunchdProcessTableTemplateV1;
export function admitLaunchdDistribution(observed: ObservedLaunchdDistributionV1): void; // throws unsupported_launchd_distribution
export function requireLaunchdMutationCertified(table: SupportedLaunchdProcessTableV1): void; // Q2
export type LaunchdLiveStateV1 =
  | { readonly kind: "unloaded" } | { readonly kind: "exact_old" } | { readonly kind: "exact_new" }
  | { readonly kind: "third_state"; readonly reason: "unsuffixed_collision" | "dual_generation" | "wrong_domain" }
  | { readonly kind: "unobservable"; readonly reason: "truncated" | "over_limit" | "timeout" | "exit" };
export class LaunchdObserver {
  observe(request: LaunchdObservationRequestV1): Promise<LaunchdLiveStateV1>;
}
```

- [ ] **Step 1: Write the tests**

```ts
it("pins the measured launchctl row", () => {
  expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.id).toBe("launchctl-macos-26.6.2-25G83-preview-v1");
  expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.executable).toEqual({
    path: "/bin/launchctl", ownerUid: 0, mode: 493, size: 363488,
    sha256: "b4dbf509754d8e1117f7851baa93ede75bc75218c48d6ddf19fbb1505d261be7",
  });
});

it("refuses mutation while the row is uncertified", () => {
  expect(() => requireLaunchdMutationCertified(uncertifiedTable)).toThrow("unsupported_launchd_distribution");
});

it.each(liveObservationFixtures)("classifies $name only from queried target and exit", async ({ fixture, expected }) => {
  expect(await observer.observe(fixture.request)).toEqual(expected);
  expect(fixture.outputParserCalls).toBe(0);
  expect(fixture.outputHashPersisted).toBe(false);
});
```

Cover:
- exact OS, binary and root-owned empty-directory identity;
- at most 13 preview probes;
- domain exit 0, and service exit 0 or 113;
- every live state;
- the 4-MiB stdout and 1-MiB stderr caps;
- the 30-second idle, wall and shared observation deadline;
- the 100-ms termination grace;
- process-group kill and reap;
- zero mutation argv during preview;
- the effective UID equal to the validated console user;
- refusal of `system`, `user`, `login`, PID and differently numbered GUI domains.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/platform-macos src/launchd/process-table.test.ts src/launchd/observe.test.ts`
- [ ] **Step 3: Implement.** Before each pass, verify the pinned OS, the executable and root-owned `/private/var/empty`. Spawn only the two `print` argv forms, with the exact environment and cwd. Byte-count the output and discard it. Classify only by exit code. Anything else is unobservable.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/platform-macos/src/launchd/distribution.ts packages/platform-macos/src/launchd/process-table.ts packages/platform-macos/src/launchd/observe.ts packages/platform-macos/src/launchd/process-table.test.ts packages/platform-macos/src/launchd/observe.test.ts packages/platform-macos/src/launchd/index.ts
git commit -m "feat(macos): observe launchd through pinned rows"
```

### Task 8: Apply and recover no-replace Git object/index/reflog/ref effects · L

Source: 2026-08-28 Task 14, re-derived against the shipped `LifecycleEffectAdapterV1`.

**Files:**
- Create: `packages/core/src/git/effects.ts`, `packages/core/src/git/effect-journal.ts`
- Modify: `packages/core/src/git/index.ts`
- Test: `packages/core/src/git/effects.test.ts`, `packages/core/src/git/effect-journal.test.ts`

**Interfaces:**
- Consumes: Task 5 transitions and `GitSyncPlanCoreV1`; Task 1 `parseGitEffectId`, `LifecycleEffectLedgerCodecV1`, `GIT_EFFECT_STAGING_SIDES`; `LifecycleEffectAdapterV1`, `LifecycleEffectRefV1`, `LifecycleEffectStateV1`, `LIFECYCLE_HASH_DOMAINS.gitEffectPlan`; the injected guarded Git filesystem with a no-replace rename.
- Produces:

```ts
export type GitEffectPlanV1;     // side-tagged, spec §2.4/§4.4
export type GitEffectJournalV1;
export type GitEffectEvidenceV1;
export const GIT_EFFECT_LEDGER_CODEC: LifecycleEffectLedgerCodecV1; // Task 14 wires it into the ledger
export class GitEffectExecutor implements LifecycleEffectAdapterV1 {
  constructor(dependencies: GitEffectDependenciesV1);
  apply(ref: LifecycleEffectRefV1<string>): Promise<void>;
  finalize(ref: LifecycleEffectRefV1<string>): Promise<void>;
  compensate(ref: LifecycleEffectRefV1<string>): Promise<void>;
  observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1>;
  compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void>;
}
```

The executor reads its plan from `state/git-effect-journals` by `ref.id` and refuses when the plan hash differs from `ref.planHash`.

- [ ] **Step 1: Write the tests**

```ts
it("publishes in objects-index-reflogs-ref order", async () => {
  await executor.apply(ref(validEffect));
  expect(fixture.publications).toEqual(["objects", "index", "reflogs", "ref"]);
});

it("restores ref before reflogs and never deletes a relinquished object", async () => {
  await executor.compensate(ref(effectWithConcurrentRef));
  expect(fixture.compensations.slice(0, 2)).toEqual(["ref", "reflogs"]);
  expect(await executor.observe(ref(effectWithConcurrentRef))).toBe("rolled_back");
  expect(fixture.journal().observation).toBe("relinquished_created_object");
  expect(await fixture.objectExists()).toBe(true);
});

it("refuses a ref whose planHash disagrees with the persisted plan", async () => {
  await expect(executor.apply({ id: validEffect.id, planHash: otherHash })).rejects.toThrow();
});
```

Cover:
- absent, identical-reusable, conflicting, mixed and between-publication collisions, for loose objects and for destination pack/index pairs;
- a late identical `EEXIST`;
- survival of the enable-only `.git` publication as `relinquished_created_git_tree`;
- every reflog/ref CAS and third state;
- journal feasibility through 16 MiB;
- a crash after each command and before its observation;
- terminal compaction that never unlinks a published object;
- `GIT_EFFECT_LEDGER_CODEC.terminal` for every phase.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/core src/git/effects.test.ts src/git/effect-journal.test.ts`
- [ ] **Step 3: Implement.** Persist the plan-bound journal before the first mutation. Publish with no-replace primitives and exact identity and hash checks. On recovery, use the directional preimage/live/postimage tables. Restore refs, then reflogs, then index and control state. Preserve created objects, packs, indexes and `.git` roots whenever ownership was relinquished or a third state appears.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/git/effects.ts packages/core/src/git/effect-journal.ts packages/core/src/git/effects.test.ts packages/core/src/git/effect-journal.test.ts packages/core/src/git/index.ts
git commit -m "feat(core): journal exact Git effects"
```

### Task 9: Enforce Git process permits and one inherited deadline · M

Source: the Git-specific half of 2026-08-28 Task 11. It builds on Task 3 and does not add a second spawn path.

**Files:**
- Create: `packages/security/src/git/supervisor.ts`
- Modify: `packages/security/src/git/index.ts`
- Test: `packages/security/src/git/supervisor.test.ts`

**Interfaces:**
- Consumes: Task 3 `SupervisedProcessRunner` and `SupervisedPhaseV1`; Task 6 `SupportedGitProcessTableV1`, `GitProcessNodeV1` and `admitGitDistribution`.
- Produces: `GitProcessSupervisorV1`, a one-shot `GitProcessPermitV1`, `GitPushPhaseV1`, `GitProcessEvidenceV1`, and:

```ts
export class GitProcessSupervisor implements GitProcessSupervisorV1 {
  constructor(table: SupportedGitProcessTableV1, runner: SupervisedProcessRunner, identity: GitExecutableIdentityProbeV1);
  beginPushPhase(): GitPushPhaseV1;             // one per top-level invocation; never persisted
  issue(node: GitProcessNodeV1, parent: GitProcessPermitV1 | null, phase: GitPushPhaseV1): GitProcessPermitV1;
  run(permit: GitProcessPermitV1, request: GitConcreteProcessRequestV1): Promise<GitProcessEvidenceV1>;
}
```

- [ ] **Step 1: Write the tests**

```ts
it("consumes a permit once and rejects wrong parent/order/argv", async () => {
  const permit = supervisor.issue(expectedNode, null, phase);
  await supervisor.run(permit, expectedRequest);
  await expect(supervisor.run(permit, expectedRequest)).rejects.toThrow("permit_consumed");
  await expect(supervisor.run(supervisor.issue(expectedNode, null, phase), wrongArgv)).rejects.toThrow("argv_mismatch");
});

it("rechecks the executable identity immediately before exec", async () => {
  identity.swapAfterIssue();
  await expect(supervisor.run(supervisor.issue(expectedNode, null, phase), expectedRequest)).rejects.toThrow("unsupported_git_distribution");
  expect(runner.spawnCount).toBe(0);
});
```

Cover:
- an unsupported distribution;
- an unknown child;
- a wrong parent, order, argv, env, cwd or stdin;
- counted proxy byte, hash and EOF mismatches;
- idle, wall and phase overrun;
- group termination and complete reap;
- a capture or redaction failure;
- a fresh phase for a later `push_pending` invocation only after the persisted plan is rechecked;
- no lifetime clock persisted anywhere.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/security src/git/supervisor.test.ts`
- [ ] **Step 3: Implement.** Expand the semantic slots to literal argv before issuing a permit, compare literal arrays and maps, and discard raw output unless the node's typed result needs a bounded parsed field.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/security/src/git/supervisor.ts packages/security/src/git/supervisor.test.ts packages/security/src/git/index.ts
git commit -m "feat(security): supervise the closed Git process graph"
```

### Task 10: Bootstrap only an already-unlinked plist snapshot · M

Source: 2026-08-28 Task 18. FD inheritance uses Task 3's single `childFd: 3` mapping.

**Files:**
- Create: `packages/platform-macos/src/launchd/snapshot.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`
- Test: `packages/platform-macos/src/launchd/snapshot.test.ts`
- Create: `tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts`. This is the certification fixture. It is **never** run by an agent; the founder runs it in Task 19 on a disposable host. Everywhere else it throws `unsupported_launchd_distribution`; it never skips.

**Interfaces:**
- Consumes: Task 7 `SupportedLaunchdProcessTableV1`, `requireLaunchdMutationCertified`; Task 3 `SupervisedProcessRunner`; Task 1 `LAUNCHD_PROCESS_STAGING_CHILDREN`.
- Produces: `LaunchdBootstrapPlistIdentityV1`, `LaunchdBootstrapSnapshotCreationV1`, `LaunchdBootstrapSnapshotAttemptV1`, `LaunchdMutationEvidenceV1`, and:

```ts
export class LaunchdSnapshotBootstrapper {
  prepare(request: LaunchdSnapshotRequestV1): Promise<LaunchdBootstrapSnapshotAttemptV1>;
  bootstrap(attempt: LaunchdBootstrapSnapshotAttemptV1): Promise<LaunchdMutationEvidenceV1>;
  recover(creation: LaunchdBootstrapSnapshotCreationV1): Promise<LaunchdBootstrapSnapshotAttemptV1>;
}
```

- [ ] **Step 1: Write the tests**

```ts
it.each(snapshotFailurePoints)("recovers snapshot creation after $name", async ({ point }) => {
  const crashed = await interruptSnapshotAt(point);
  const recovered = await bootstrapper.recover(crashed.creation);
  expect(recovered.bytesHash).toBe(expectedPlistHash);
  expect(await crashed.fixture.stagingChildren()).toEqual([]);
});

it("never inherits the real plist descriptor", async () => {
  await bootstrapper.bootstrap(await bootstrapper.prepare(request));
  expect(fixture.childInheritedFds).toEqual([3]);
  expect(fixture.fd3Identity).toEqual(fixture.unlinkedSnapshotIdentity);
  expect(fixture.fd3Identity).not.toEqual(fixture.realPlistIdentity);
});
```

Kill the process:
- after the linked create;
- after every partial-prefix write;
- after sync and after open;
- immediately before and after the unlink;
- before spawn.

Also cover:
- a rename, replace or in-place write racing the real plist after verification;
- a wrong frontier, preimage, path, role, effect, plan, transition or metadata;
- non-prefix and over-limit bytes;
- spawn refusal, timeout and success;
- parent close on every path;
- equality of the open-FD baseline before and after;
- refusal when uncertified.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/platform-macos src/launchd/snapshot.test.ts`. The pinned-host file is Task 19's.
- [ ] **Step 3: Implement.** Create exactly `staging.tmp/bootstrap-plist` with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode `0600`. Stream only the planned bytes, sync, then reopen and recheck. Open the completed inode, then unlink and sync before spawn. Pass only that open description as FD 3 to `/bin/launchctl bootstrap gui/<uid> /dev/fd/3`. There is no pathname fallback.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/platform-macos/src/launchd/snapshot.ts packages/platform-macos/src/launchd/snapshot.test.ts packages/platform-macos/src/launchd/index.ts tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts
git commit -m "feat(macos): bootstrap launchd from unlinked snapshots"
```

### Task 11: Build sanitized Git shadows, no-shell gateways and the persisted push plan · L

Source: 2026-08-28 Task 12, plus the `PersistedGitPushPlanV1` definition moved out of old Task 15. The push plan binds Security hashes (distribution, process table, shadow templates), so it cannot live in Core. Defining it here lets Task 14's codec swap proceed without waiting for the whole Git CLI.

**Files:**
- Create: `packages/security/src/git/shadow.ts`, `gateways.ts`, `push-plan.ts`
- Modify: `packages/security/src/git/index.ts`
- Test: `packages/security/src/git/shadow.test.ts`, `gateways.test.ts`, `push-plan.test.ts`

**Interfaces:**
- Consumes: Task 9 supervisor and permits; Task 6 table; Task 5 `GitSyncPlanCoreV1`, path types and plan hashes.
- Produces: `SanitizedGitEnvironmentV1`, `SanitizedGitShadowConfigV1`, `SanitizedGitShadowConfigTemplateV1`, `SanitizedGitShadowConfigBytesV1`, `SanitizedGitShadowV1`, `SanitizedBareDestinationShadowV1`, `SanitizedSshBridgeV1`, `SanitizedLocalRemoteHelperV1`, `GitExecGatewayV1`, and:

```ts
export function instantiateShadowConfig(template: SanitizedGitShadowConfigTemplateV1, slots: SanitizedGitShadowSlotsV1): SanitizedGitShadowV1;
export function runGitGateway(invocation: GitGatewayInvocationV1, capability: GitProcessPermitV1): Promise<GitGatewayOutcomeV1>;
export type PersistedGitPushPlanV1; // exact spec §4.4 fields
export const PERSISTED_GIT_PUSH_PLAN_CODEC: LifecycleHashedValueCodec<PersistedGitPushPlanV1>;
export type GitSyncPlanV1 = GitSyncPlanCoreV1<PersistedGitPushPlanV1>;
```

- [ ] **Step 1: Write the tests**

```ts
it("renders one domain-bound config template to exact bytes", () => {
  const concrete = instantiateShadowConfig(template, slots);
  expect(hashShadowConfig(concrete.bytes)).toBe(template.expectedConcreteHash);
  expect(concrete.bytes).toContain("http.followRedirects=false\n");
});

it.each(hostileGitConfigurations)("executes no hostile extension: $name", async ({ fixture }) => {
  await runPlannedGateway(fixture);
  expect(fixture.hostileExecutions).toEqual([]);
});

it.each(["\n", "\r", "\u0000", "\u0085", "\u001b"])("refuses a quoted path containing %j", (byte) => {
  expect(() => gitConfigQuotedPath(`/Users/a${byte}b`)).toThrow();
});

it("round-trips a quote/backslash path and spaces/non-ASCII", () => {
  expect(renderQuoted(gitConfigQuotedPath('/Users/a b/é"\\x'))).toBe('"/Users/a b/é\\"\\\\x"');
});

it("strictly round-trips PersistedGitPushPlanV1 and refuses an unknown key", () => {
  expect(PERSISTED_GIT_PUSH_PLAN_CODEC.validate(pushPlanFixture)).toEqual(pushPlanFixture);
  expect(() => PERSISTED_GIT_PUSH_PLAN_CODEC.validate({ ...pushPlanFixture, extra: 1 })).toThrow();
});
```

The two quoted-path tests cover Review Focus 4.

Cover:
- environment exactness, including `GIT_SSH_VARIANT=ssh` and `GIT_CONFIG_NOSYSTEM`;
- counted config entries;
- no ambient proxy, helper, hooks or maintenance;
- no SSH `-G` probe;
- no second request after a redirect;
- the local helper's fixed destination shadow;
- no `/bin/sh`;
- re-instantiation of the path-slot template after a restart;
- the one `GitAlternateObjectDirectoryV1` grammar.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/security src/git/shadow.test.ts src/git/gateways.test.ts src/git/push-plan.test.ts`
- [ ] **Step 3: Implement.** Render only the spec's fixed key order and Git C-quoting. The dispatcher identifies a pre-issued semantic permit and never pattern-matches argv. Every helper inherits the same push phase.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/security/src/git/shadow.ts packages/security/src/git/gateways.ts packages/security/src/git/push-plan.ts packages/security/src/git/shadow.test.ts packages/security/src/git/gateways.test.ts packages/security/src/git/push-plan.test.ts packages/security/src/git/index.ts
git commit -m "feat(security): isolate Git with sanitized shadows"
```

### Task 12: Journal launchd install/replace/keep/remove and live-only reconcile · L

Source: 2026-08-28 Task 19, re-derived against `LifecycleEffectAdapterV1`, `LAUNCHD_PLAN_VARIANTS` and the Foundation `plist_files` slot.

**Files:**
- Create: `packages/platform-macos/src/launchd/plan.ts`, `effects.ts`, `effect-journal.ts`
- Modify: `packages/platform-macos/src/launchd/index.ts`
- Test: `packages/platform-macos/src/launchd/plan.test.ts`, `effects.test.ts`, `effect-journal.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 7 and 10; Task 1 `parseLaunchdEffectId` and `LifecycleEffectLedgerCodecV1`; `LifecycleEffectAdapterV1`, `LAUNCHD_PLAN_VARIANTS`, `LIFECYCLE_HASH_DOMAINS.launchdEffectPlan`.
- Produces: `LaunchdPlanV1`, `LifecycleFileBindingV1`, `LaunchdEffectPlanV1` (position-tagged `before_files`/`after_files`), `LaunchdEffectJournalV1`, and:

```ts
export const LAUNCHD_PLAN_CODEC: LifecycleValueCodec<LaunchdPlanV1>;
export const LAUNCHD_EFFECT_LEDGER_CODEC: LifecycleEffectLedgerCodecV1;
export function planLaunchdTransitions(request: LaunchdTransitionRequestV1): LaunchdPlanV1; // exhaustive table
export class LaunchdEffectExecutor implements LifecycleEffectAdapterV1 {
  constructor(dependencies: LaunchdEffectDependenciesV1);
  apply(ref: LifecycleEffectRefV1<string>): Promise<void>;
  finalize(ref: LifecycleEffectRefV1<string>): Promise<void>;
  compensate(ref: LifecycleEffectRefV1<string>): Promise<void>;
  observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1>;
  compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void>;
}
```

- [ ] **Step 1: Write the tests**

```ts
it.each(launchdTransitionRows)("recovers $name at every cursor", async ({ row }) => {
  const interrupted = await interruptEachCursor(row);
  expect(interrupted.length).toBeGreaterThan(0);
  for (const state of interrupted) expect(await recoverLaunchd(state.fixture)).toEqual(state.expected);
});

it("unloads the old generation before the plist mutation and loads the new one after verification", async () => {
  await runComposite(replacePlan);
  expect(fixture.events).toEqual(["bootout-old", "foundation-plist", "verify-new-plist", "snapshot-bootstrap-new"]);
});

it("live-only reconcile performs only Q transitions with no Foundation or manifest arm", async () => {
  await executor.apply(ref(liveOnlyPlan.after));
  expect(fixture.foundationCalls).toEqual([]);
});
```

Cover:
- every install/replace/keep/remove combination;
- exact-old, exact-new and absent live/file states;
- every crash after a command and before its observation;
- dual, collision and unobservable third states;
- root/home/tmp identity and the entry-empty grammar;
- the sole current-frontier snapshot prefix;
- the 30-second shared transition deadline;
- journal feasibility at 1 MiB;
- compensation;
- preservation of unknown or non-empty staging;
- refusal while uncertified (Q2).

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/platform-macos src/launchd/plan.test.ts src/launchd/effects.test.ts src/launchd/effect-journal.test.ts`
- [ ] **Step 3: Implement.** Persist directional intent before each `bootout` or bootstrap. Observe the exact domain and service state after every command, before the cursor advances. The before-files participant holds every unload; the after-files participant holds every load and reload.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/platform-macos/src/launchd/plan.ts packages/platform-macos/src/launchd/effects.ts packages/platform-macos/src/launchd/effect-journal.ts packages/platform-macos/src/launchd/plan.test.ts packages/platform-macos/src/launchd/effects.test.ts packages/platform-macos/src/launchd/effect-journal.test.ts packages/platform-macos/src/launchd/index.ts
git commit -m "feat(macos): journal launchd reconciliation"
```

### Task 13: Validate private receive packs and bounded SHA-1 closure before intent · L

Source: 2026-08-28 Task 13.

**Files:**
- Create: `packages/security/src/git/pack-reader.ts`, `packages/security/src/git/local-receive.ts`
- Modify: `packages/security/src/git/index.ts`
- Test: `packages/security/src/git/pack-reader.test.ts`, `packages/security/src/git/local-receive.test.ts`
- Create: `tests/integration/git/local-receive.pinned-host.test.ts` (execs the pinned Git: Q5; run in Task 21 on the pinned host)

**Interfaces:**
- Consumes: Task 2 `GitPackReaderBudgetV1`; Tasks 6, 9 and 11; a private quarantine directory under `staging/lifecycle/<id>/git/destination/<ge-id>`.
- Produces: `GuardedSha1PackReader`, `GitPackClosureEvidenceV1`, and `prepareLocalReceive(request): Promise<GitLocalReceivePreparationV1>`. The preparation is either a staged destination closure or the no-pack up-to-date arm, with an empty transition list.

- [ ] **Step 1: Write the tests**

```ts
it.each(packBudgetBoundaries)("refuses first-over-limit $name", async ({ fixture, reason }) => {
  await expect(reader.validate(fixture.request, fixture.budget)).rejects.toThrow(reason);
  expect(await fixture.quarantineExists()).toBe(false);
  expect(fixture.coordinatorIntentCount).toBe(0);
});

it("accepts the exact up-to-date target without pack/index children", async () => {
  const result = await prepareLocalReceive(upToDateFixture);
  expect(result.destinationTransitions).toEqual([]);
  expect(result.processNodes).toEqual(["receive-pack"]);
});
```

Cover:
- zero and nonzero pack object counts;
- malformed, truncated, duplicate, extra and wrong-OID targets;
- unequal header, admitted and distinct-closure counts;
- 200,001 and 200,002 objects;
- first-over-limit on compressed bytes, object size, aggregate, delta depth, delta work, instructions, RAM, temp and deadline;
- hostile receive hooks, proc-receive and maintenance;
- missing closure nodes.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root packages/security src/git/pack-reader.test.ts src/git/local-receive.test.ts`, then on the pinned host `npx vitest run --root tests integration/git/local-receive.pinned-host.test.ts`
- [ ] **Step 3: Implement.** Count compressed bytes before buffering. Stream inflation, cap resident memory and spill only to the private bounded temp. Track delta depth and work. Require every reachable object exactly once. Local receive uses the fixed helper graph and `receive.unpackLimit=0`, and destroys the quarantine on every refusal.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add packages/security/src/git/pack-reader.ts packages/security/src/git/local-receive.ts packages/security/src/git/pack-reader.test.ts packages/security/src/git/local-receive.test.ts packages/security/src/git/index.ts tests/integration/git/local-receive.pinned-host.test.ts
git commit -m "feat(security): validate bounded Git pack closure"
```

### Task 14: Compose real lifecycle leaves, ledger codecs and recovery adapters in the CLI · L

Source: new. This is the part of old Tasks 15 and 22 that touches the shipped plan-1a CLI kernel files. It is the **sole owner** of `apps/cli/src/lifecycle/codecs.ts` and `apps/cli/src/lifecycle/context.ts` in this plan, apart from Task 1's rename. A type-alias swap is not a union of additions, so no other task edits these files.

**Files:**
- Modify: `apps/cli/src/lifecycle/codecs.ts`:
  - `LifecycleExecutionPlanV1` becomes `LifecycleCoordinatorPlanCoreV1<ManifestStatePlanV1, LaunchdPlanV1, RedactionKeyStatePlanV1, PersistedGitPushPlanV1>`;
  - replace the five `unsupported<never>` leaves and the three unsupported functions;
  - delete `UNSUPPORTED_STEP_KINDS` and the Git/launchd arms of `refuseUnsupportedArms`;
  - make `lifecycleVariantFacts` derive `gitSync` and `automationReconcile` from the plan.
- Modify: `apps/cli/src/lifecycle/context.ts` (wire `GIT_EFFECT_LEDGER_CODEC` and `LAUNCHD_EFFECT_LEDGER_CODEC` into `inspectLedger`)
- Create: `apps/cli/src/lifecycle/adapters.ts`
- Modify: `apps/cli/src/lifecycle/mutation-gate.ts` (only the null adapter block, which becomes `createLifecycleEffectAdapters(...)`, so the gate's recovery can finish a non-terminal Git or launchd coordinator)
- Test: `apps/cli/src/lifecycle/codecs.test.ts`, `apps/cli/src/lifecycle/adapters.test.ts`, `apps/cli/src/lifecycle/mutation-gate.test.ts`

**Interfaces:**
- Consumes: Task 1 (wire the two codecs into the existing `gitEffectPlanCodec`/`launchdEffectPlanCodec` fields); Task 8 `GitEffectExecutor` and `GIT_EFFECT_LEDGER_CODEC`; Task 11 `PERSISTED_GIT_PUSH_PLAN_CODEC`, `GitSyncPlanV1`, supervisor and gateways; Task 12 `LaunchdEffectExecutor`, `LAUNCHD_PLAN_CODEC` and `LAUNCHD_EFFECT_LEDGER_CODEC`; Task 4 `LaunchdPlanPreviewV1`; Task 5 `GitPlanPreviewV1`.
- Produces:

```ts
export type LifecycleExecutionPlanV1 = LifecycleCoordinatorPlanCoreV1<ManifestStatePlanV1, LaunchdPlanV1, RedactionKeyStatePlanV1, PersistedGitPushPlanV1>;
export type LifecycleNormalizedProjectionV1 =
  | { readonly subsystem: "git"; readonly enabledAfter: boolean; readonly lifecycle: GitSyncConfigV1 | null }
  | { readonly subsystem: "automation"; readonly enabledAfter: boolean; readonly lifecycle: AutomationConfigV1 | null };
export type LifecyclePlanPreviewV1 = LifecyclePlanPreviewCoreV1<LifecycleNormalizedProjectionV1, GitPlanPreviewV1, LaunchdPlanPreviewV1>;
export function createLifecycleEffectAdapters(context: CliLifecycleContext, ports: LifecycleEffectPortsV1): Pick<
  LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>,
  "sourceGitEffect" | "destinationGitEffect" | "launchdBeforeFiles" | "launchdAfterFiles" | "networkPush"
>;
export interface LifecycleEffectPortsV1 {
  readonly git: GitEffectDependenciesV1;
  readonly launchd: LaunchdEffectDependenciesV1;
  readonly push: { push(plan: LifecycleExecutionPlanV1, pushPlanHash: LowerHexSha256): Promise<"succeeded" | "failed"> };
}
```

The production ports come from `createProductionContext`. Test fixtures inject recording ports whose runners reject by default, the same way `FixtureOptions.runner` does today.

- [ ] **Step 1: Write the tests**

```ts
it("round-trips a git_enable execution plan and a live-only automation plan", () => {
  const codecs = createLifecycleExecutionCodecs(context);
  for (const plan of [gitEnablePlanFixture, automationLiveOnlyFixture]) {
    expect(codecs.executionPlan.validate(codecs.executionPlan.encode(plan))).toEqual(plan);
  }
});

it("no longer refuses Git or launchd step kinds with unsupported_until_plan_1b", () => {
  expect(() => createLifecycleExecutionCodecs(context).executionPlan.validate(gitSyncNewNetworkFixture)).not.toThrow();
});

it("still refuses a preview with both git and launchd members", () => {
  expect(() => createLifecycleExecutionCodecs(context).preview.validate(mixedPreviewFixture)).toThrow();
});

it("lets the mutation gate's recovery finish a non-terminal git_enable coordinator", async () => {
  const home = await gatedHomeWithInterruptedGitEnable();
  await withLifecycleMutation(home.context, home.lifecycle, async () => undefined);
  expect((await home.lifecycle.inspectLedger()).closure.kind).toBe("clear");
});

it("derives git_sync variant facts from the plan rather than hardcoding null", () => {
  expect(lifecycleVariantFacts(gitSyncExistingLocalFixture).gitSync).toEqual({ newCommit: false, transport: "local", noChanges: false });
});
```

Also cover the retry-only closure path (`push_pending` → `retry_only` → one retry through `networkPush`) and every plan-1a codec test still passing unchanged. The plan-1a cases that pinned `unsupported_until_plan_1b` for these arms are rewritten to the new contract, never deleted (spec §7 "coordinator grammar is exact").

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/adapters.test.ts src/lifecycle/mutation-gate.test.ts`
- [ ] **Step 3: Implement.** Keep `LifecycleUnsupportedLeafError` only if another caller remains after the swap; otherwise delete it together with its last test reference, and grep first. `refuseUnsupportedArms` narrows to "uninstall plans carry no Git arms", which the grammar already implies, so delete it if the grammar validator covers it.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lifecycle/codecs.ts apps/cli/src/lifecycle/codecs.test.ts apps/cli/src/lifecycle/context.ts apps/cli/src/lifecycle/adapters.ts apps/cli/src/lifecycle/adapters.test.ts apps/cli/src/lifecycle/mutation-gate.ts apps/cli/src/lifecycle/mutation-gate.test.ts
git commit -m "feat(cli): compose Git and launchd lifecycle leaves"
```

### Task 15: Add `git enable|disable|status|sync` · L · V2

Source: 2026-08-28 Task 15, re-derived:
- admission is `admitInstalledV2Home` plus `observeLifecycleActivationRecord`, not a new admitter;
- the push plan and codecs come from Tasks 11 and 14;
- no `output-schemas.ts` change.

**Files:**
- Create: `apps/cli/src/commands/git/index.ts`, `apps/cli/src/commands/git/service.ts`, `apps/cli/src/commands/git/sync-record.ts`
- Modify: `apps/cli/src/main.ts` (`COMMAND_OPTIONS`, `COMMAND_POSITIONALS`, a new `GIT_SUBCOMMANDS`, `USAGE`, `dispatch`, render)
- Test: `apps/cli/src/commands/git/index.test.ts`, `service.test.ts`, `sync-record.test.ts`, `apps/cli/src/main.test.ts`, `apps/cli/src/commands/git/git.v2.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 8, 11, 13 and 14; `admitInstalledV2Home`, `observeLifecycleActivationRecord`, `reserveLifecycleIdBlock`, `assertLifecycleExecutionFeasible`, `LifecycleCoordinatorStore`, `LifecycleCoordinator`, `lifecyclePreviewHash`, `HeldLifecycleStableLockV1`.
- Produces:

```ts
export interface GitService {
  previewEnable(request: GitEnableCliRequestV1): Promise<LifecyclePlanPreviewV1>;
  applyEnable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
  previewDisable(): Promise<LifecyclePlanPreviewV1>;
  applyDisable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
  status(): Promise<GitCommandResultV1>;
  sync(mode: "interactive" | "scheduled", global: HeldLifecycleStableLockV1): Promise<GitCommandResultV1>;
}
export function createGitService(context: CliContext, lifecycle: CliLifecycleContext): GitService;
export type SyncRecordV1; // exact spec §2.1 runtime record at state/git-sync.json
export function completeGitSyncDraft(core: GitSyncPlanningDraft, security: GitSecurityExecutionDraft): GitSyncExecutionDraft;
export function assertGitSyncFeasible(draft: GitSyncExecutionDraft): GitSyncFeasibility;
export function bindGitSyncExecution(draft: GitSyncExecutionDraft, ids: LifecycleIdBlockV1): GitSyncPlanV1;
export function runGit(context: CliContext, request: GitCommandRequestV1): Promise<CliResult>;
```

Every apply and sync function takes a **held** global lock, and the CLI entry acquires it. That is how Task 16's runner calls `sync("scheduled", global)` without a second acquisition (Review Focus 1).

- [ ] **Step 1: Write the tests**

```ts
it("prints the same allocation-free enable preview twice", async () => {
  const first = await runGit(fixture.context, { subcommand: "enable", remote, branch: null, apply: false });
  const second = await runGit(fixture.context, { subcommand: "enable", remote, branch: null, apply: false });
  expect(first.stdout).toBe(second.stdout);
  expect(fixture.allocatedIds).toEqual([]);
  expect(fixture.stagingEntries).toEqual([]);
});

it("preserves the prior sync record when push fails and retries only the persisted push", async () => {
  const result = await service.sync("interactive", global);
  expect(result.exitCode).not.toBe(0);
  expect(await rejectingRemote.readSyncRecord()).toEqual(previousSuccess);
  expect(await rejectingRemote.closure()).toMatchObject({ kind: "retry_only" });
});

it("publishes activation and manifest ownership before enabled config", async () => {
  await service.applyEnable(preview, global);
  expect(fixture.events).toEqual(["activation-record", "manifest-hash", "git-effect", "enabled-config"]);
});

it("reports an unsupported distribution in status without spawning", async () => {
  const result = await createGitService(driftedXcode.context, driftedXcode.lifecycle).status();
  expect(result.data).toMatchObject({ distribution: "unsupported_git_distribution" });
  expect(driftedXcode.spawns).toEqual([]);
});

it.each(["sync", "status"])("is inert when disabled: %s spawns no Git and opens no network", async (subcommand) => {
  await runGit(disabled.context, { subcommand });
  expect(disabled.gitProcesses).toEqual([]);
  expect(disabled.networkCalls).toEqual([]);
});
```

The distribution test covers Review Focus 2.

In `git.v2.test.ts`, on one shared real V2 home, with a scripted `GitProcessSupervisor` injected through Task 14's `LifecycleEffectPortsV1` (never the pinned Xcode Git, which CI cannot run, per Q5):
- `git enable --apply` against a local bare remote, then `git sync`, `git status` and `git disable --apply`;
- a forged `config.toml` lifecycle with no activation arm stays inert;
- `config set brainPath` refuses `config_brain_path_is_repository_identity` after enable.

Cover as well:
- exact options and positionals;
- preview revalidation drift;
- the initialize/adopt refusal states;
- repository identity changes;
- `scope_reconcile_required`;
- activation create, update and inactive arms with their manifest hash transitions;
- a forged, missing or drifted activation at every interrupted phase;
- disable preserving `.git`;
- truthful `no_changes`;
- redirection refusal;
- a fresh phase per top-level invocation.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root apps/cli src/commands/git/index.test.ts src/commands/git/service.test.ts src/commands/git/sync-record.test.ts src/main.test.ts`, then `npx vitest run --root apps/cli src/commands/git/git.v2.test.ts`
- [ ] **Step 3: Implement.** Preview does bounded observation only. Apply acquires the global lock, recomputes and compares `previewHash`, checks feasibility, reserves IDs, binds the plan, persists it, and invokes the coordinator by ID. Sync finishes private planning and the combined Core/Security feasibility proof before reservation. It writes the pending push plan before any network call, and writes `SyncRecordV1` only after an exact push success or a truthful `no_changes`.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/git/index.ts apps/cli/src/commands/git/service.ts apps/cli/src/commands/git/sync-record.ts apps/cli/src/commands/git/index.test.ts apps/cli/src/commands/git/service.test.ts apps/cli/src/commands/git/sync-record.test.ts apps/cli/src/commands/git/git.v2.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts
git commit -m "feat(cli): add opt-in Git lifecycle"
```

### Task 16: Persist bounded runtime records and run scheduled jobs under a lifetime lease · L

Source: 2026-08-28 Task 20, re-derived:
- handlers are injected (`ScheduledJobHandlersV1`), and Task 17 wires the production ones, so this task does not wait on Task 15;
- `runReindex` and `runLint` are private in `brain.ts`, so this task exports one scheduled entry point;
- a gated mutator must be able to reuse the held global lock (Review Focus 1).

**Files:**
- Create: `apps/cli/src/lifecycle/runtime-records.ts`, `apps/cli/src/commands/automation/runner.ts`
- Modify: `apps/cli/src/lifecycle/mutation-gate.ts`. This is an additive option only: `withLifecycleMutation(context, lifecycle, work, resolution?, held?: { global: HeldLifecycleStableLockV1 })`. With `held` it verifies `dev`/`ino` against the global lock path instead of acquiring, and never releases the lock.
- Modify: `apps/cli/src/commands/brain.ts` (export `runScheduledBrain(context, job: "brain-reindex" | "brain-lint", held)`)
- Modify: `apps/cli/src/commands/doctor.ts` (only if `runDoctorReport(context, NO_PROBE)` spawns anything: a scheduled profile must spawn nothing; the test decides)
- Test: `apps/cli/src/lifecycle/runtime-records.test.ts`, `apps/cli/src/commands/automation/runner.test.ts`, `apps/cli/src/lifecycle/mutation-gate.test.ts`, `apps/cli/src/commands/brain.test.ts`, `apps/cli/src/commands/doctor.test.ts`

Task 14 also modifies `mutation-gate.ts` and `mutation-gate.test.ts` in wave 5. This task integrates after it, and its change is additive.

**Interfaces:**
- Consumes: Task 14 context and codecs; Task 4 `LAUNCHD_JOBS`, `generatedLabel` and `scheduledProgramArguments`; `uninstallLeasePaths`, `LifecycleStableLockProviderV1`, `LIFECYCLE_LEASE_DRAIN_MS`, `observeLifecycleActivationRecord`, and the Foundation transaction executor.
- Produces:

```ts
export type AutomationRunnerLeaseV1; export type AutomationStatusRecordV1; export type AutomationLogRecordV1;
export type UninstallingMarkerV1; // already a reservation; strict codec here if not yet exported
export class AutomationRuntimeRecordStore {
  writeStatus(record: AutomationStatusRecordV1, lease: HeldAutomationLeaseV1): Promise<void>;
  writeLog(record: AutomationLogRecordV1, lease: HeldAutomationLeaseV1): Promise<void>; // rotate 0..9, discard the eleventh
}
export interface ScheduledJobHandlersV1 {
  run(job: ScheduledJobIdV1, global: HeldLifecycleStableLockV1): Promise<ScheduledHandlerResultV1>;
}
export class AutomationRunner {
  constructor(dependencies: AutomationRunnerDependenciesV1 & { readonly handlers: ScheduledJobHandlersV1 });
  run(request: ScheduledRunRequestV1): Promise<ScheduledRunOutcomeV1>; // spec §5.4 steps 1–9 exactly
}
```

- [ ] **Step 1: Write the tests**

```ts
it("acquires the lifetime lease before waiting for the global lock", async () => {
  await runner.run(request);
  expect(fixture.lockEvents.slice(0, 2)).toEqual(["lease-acquired", "global-wait"]);
});

it.each(["automation_disabled", "git_disabled"])("records only inert %s", async (outcome) => {
  await runner.run(fixture.forInertOutcome(outcome));
  expect(fixture.handlerCalls).toEqual([]);
  expect(fixture.networkCalls).toEqual([]);
  expect(await fixture.readStatus()).toMatchObject({ outcome, startedAt: null, reasonCode: outcome });
});

it("lets a handler mutate under the runner's held global lock without self-refusal", async () => {
  const result = await withLifecycleMutation(home.context, home.lifecycle, async () => "ok", undefined, { global: held });
  expect(result).toBe("ok");
  expect(home.lockReleases).toEqual([]);
});

it("refuses an interactive mutation with exit 6 while a scheduled job holds the global lock", async () => {
  const running = runner.run(slowReindexRequest);
  await fixture.handlerStarted;
  const interactive = await runConfig(fixture.context, { operation: "set", key: "brain.staleness.reviewAfterDays", value: 30 });
  expect(interactive.exitCode).toBe(EXIT_CODES.recoveryRequired);
  expect(interactive.reason).toBe("lifecycle_lock_busy");
  await running;
  expect(await fixture.readStatus("brain-reindex")).toMatchObject({ outcome: "succeeded" });
});

it("spawns nothing in the scheduled doctor profile", async () => {
  await handlers.run("doctor", held);
  expect(fixture.spawns).toEqual([]);
});
```

The held-lock test covers Review Focus 1, and the interactive-contention test covers Review Focus 3 (`brain.staleness.reviewAfterDays` is in `CONFIG_MUTABLE_KEYS`).

Cover:
- lease absent, replaced and busy;
- marker checks before and after the lease;
- the ten-minute global wait and the final non-blocking acquisition;
- stage-1 installation authentication independent of active provenance;
- clear, retry-only and non-clear closures, and the post-handler recheck;
- the unowned no-status branch;
- redaction before encoding;
- the 1-MiB log slot, ten rotations with the eleventh discarded, and the 64-KiB status;
- terminal compaction after thousands of writes against the 10,000 / 100,000 / 1,000,000 ceilings;
- a held lock whose `dev`/`ino` differ refusing.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root apps/cli src/lifecycle/runtime-records.test.ts src/commands/automation/runner.test.ts src/lifecycle/mutation-gate.test.ts src/commands/brain.test.ts src/commands/doctor.test.ts`
- [ ] **Step 3: Implement** spec §5.4's nine steps in order. Handlers receive the held global lock. Write records through compacted Foundation transactions while the same lease serializes the job.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lifecycle/runtime-records.ts apps/cli/src/lifecycle/runtime-records.test.ts apps/cli/src/commands/automation/runner.ts apps/cli/src/commands/automation/runner.test.ts apps/cli/src/lifecycle/mutation-gate.ts apps/cli/src/lifecycle/mutation-gate.test.ts apps/cli/src/commands/brain.ts apps/cli/src/commands/brain.test.ts
git commit -m "feat(cli): add bounded scheduled runner state"
```

(Add `apps/cli/src/commands/doctor.ts` and `doctor.test.ts` to the `git add` only if Step 3 changed them.)

### Task 17: Add `automation enable|disable|status` and the hidden scheduled grammar · L · V2

Source: 2026-08-28 Task 22, re-derived:
- the grammar goes into `main.ts`'s tables;
- the hidden `automation run` is parsed before ordinary context creation, like hook mode (`runHookMode` in `apps/cli/src/hooks/argv.ts`);
- the production handlers are wired here.

**Files:**
- Create: `apps/cli/src/commands/automation/index.ts`, `service.ts`, `handlers.ts`
- Modify: `apps/cli/src/main.ts` (`AUTOMATION_SUBCOMMANDS`, options, positionals, `USAGE`, `dispatch`, and the pre-`parse` scheduled branch in `run`)
- Modify: `apps/cli/src/bin.ts`, only if the scheduled branch must run before `createProductionContext`
- Test: `apps/cli/src/commands/automation/index.test.ts`, `service.test.ts`, `handlers.test.ts`, `apps/cli/src/main.test.ts`, `apps/cli/src/commands/automation/automation.v2.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 7, 12, 14, 15 (`GitService.sync("scheduled", global)`) and 16 (`AutomationRunner`, `ScheduledJobHandlersV1`, `runScheduledBrain`).
- Produces:

```ts
export interface AutomationService {
  previewEnable(schedules: readonly string[]): Promise<LifecyclePlanPreviewV1>;
  applyEnable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<AutomationCommandResultV1>;
  previewDisable(): Promise<LifecyclePlanPreviewV1>;
  applyDisable(preview: LifecyclePlanPreviewV1, global: HeldLifecycleStableLockV1): Promise<AutomationCommandResultV1>;
  status(): Promise<AutomationCommandResultV1>;
}
export function createProductionScheduledHandlers(context: CliContext, lifecycle: CliLifecycleContext): ScheduledJobHandlersV1;
export function parseScheduledInvocation(argv: readonly string[]): ScheduledRunRequestV1 | null; // exact nine-argument form, else null
```

- [ ] **Step 1: Write the tests**

```ts
it("requires every eligible schedule on first enable", async () => {
  const result = await runMain(["automation", "enable", "--schedule", "brain-reindex=daily@02:00"], fixture);
  expect(result.exitCode).toBe(EXIT_CODES.invalidInput);
  expect(fixture.allocatedIds).toEqual([]);
});

it("accepts the exact nine ProgramArguments only in scheduled mode and ignores ambient homes", async () => {
  const result = await runMain(["automation", "run", "doctor", "--scheduled", "--product-home", productHome, "--generation", generation],
    { ...fixture, env: { HOME: "/elsewhere", DEVELOPER_OS_HOME: "/elsewhere", DEVELOPER_OS_BRAIN: "/elsewhere" } });
  expect(result.exitCode).toBe(0);
  expect(fixture.contextProductHome).toBe(productHome);
});

it("rejects the hidden options interactively", async () => {
  expect((await runMain(["status", "--product-home", productHome], fixture)).exitCode).toBe(EXIT_CODES.invalidInput);
});

it("publishes automation activation and manifest hash before plist effects", async () => {
  await service.applyEnable(preview, global);
  expect(fixture.events).toEqual(["plist-files", "activation-record", "manifest-hash", "launchd-effects", "enabled-config"]);
});

it("refuses disable on an uncertified or drifted launchctl row and names the manual bootout", async () => {
  const result = await runMain(["automation", "disable", "--apply"], driftedOs);
  expect(result.reason).toBe("unsupported_launchd_distribution");
  expect(driftedOs.plistMutations).toEqual([]);
});
```

The disable-refusal test covers Review Focus 2 and applies the Q3 recommendation. If Q3 is answered B, rewrite it to the approved behavior.

Wire the production handlers exhaustively over `SCHEDULED_JOB_IDS`, with `maySpawnVendor: false`.

In `automation.v2.test.ts`, on one shared real V2 home with an injected launchd runner (never the real `launchctl`):
- `automation enable --apply`, then `automation status`, then `automation disable --apply`, with runtime reservations retained;
- a later `git enable` followed by a re-run `automation enable` adds `git-sync`.

Cover:
- repeatable, duplicate and unknown schedule flags, and the absence of default times;
- allocation-free deterministic previews and apply revalidation;
- activation create, update and inactive arms, and forged or drifted activation at every interrupted phase;
- stale status;
- the full eligible-set reconcile, never a single selected job.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root apps/cli src/commands/automation/index.test.ts src/commands/automation/service.test.ts src/commands/automation/handlers.test.ts src/main.test.ts`, then `npx vitest run --root apps/cli src/commands/automation/automation.v2.test.ts`
- [ ] **Step 3: Implement.** Parse the hidden grammar before ordinary context creation, guard the supplied product home without following its leaf, then ignore ambient overrides. Public plan and apply use the same `previewHash`, revalidation and envelope path as Git.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/automation/index.ts apps/cli/src/commands/automation/service.ts apps/cli/src/commands/automation/handlers.ts apps/cli/src/commands/automation/index.test.ts apps/cli/src/commands/automation/service.test.ts apps/cli/src/commands/automation/handlers.test.ts apps/cli/src/commands/automation/automation.v2.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts
git commit -m "feat(cli): add scheduled automation lifecycle"
```

(Add `apps/cli/src/bin.ts` only if Step 3 changed it.)

### Task 18: Admit the `uninstall/present_manifest` (`P`) variant · M · V2

Source: new. Plan 1a refuses this variant with `unsupported_until_plan_1b` (D24). Spec §2.4 and §6 are unchanged: the variant is `F(uninstall_marker) · P · R · F(uninstall_artifacts) · K(stage) · M(preserve_before) · M(commit_absence) · K(delete) · M(finalize_tombstones)`, derived and never chosen. It does not add NEW-100's round-trip chain (D42).

**Files:**
- Modify: `apps/cli/src/lifecycle/uninstall.ts`:
  - delete `refuseUnsupportedUntilPlan1b` and its call in `preview`;
  - fill `authority.plistPaths` from the manifest's owned plist rows;
  - bind `participants.launchd`, `launchdBeforeFiles` (the unload of every installed generated label) and `launchdAfterFiles: null`;
  - use `LaunchdEffectExecutor` for the `P` adapter slot.
- Modify: `apps/cli/src/lifecycle/testing.ts` (`syntheticUninstall` gains a `withLaunchd` option)
- Test: `apps/cli/src/lifecycle/uninstall.test.ts`, `apps/cli/src/lifecycle/uninstall-launchd.v2.test.ts`

**Interfaces:**
- Consumes: Task 12 `planLaunchdTransitions` and `LaunchdEffectExecutor`; Task 14 `LifecycleExecutionPlanV1` and `createLifecycleEffectAdapters`; the shipped `deriveVariant` and drain.
- Produces: no new public symbol. `LifecycleUninstaller.preview` returns the `P` variant.

- [ ] **Step 1: Write the tests**

```ts
it("derives P when the manifest owns a plist and unloads before removing it", async () => {
  const home = await syntheticUninstallHome({ withLaunchd: true });
  const preview = await uninstaller(home).preview();
  expect(preview.variant).toBe("uninstall/present_manifest");
  await uninstaller(home).apply(preview);
  expect(home.events).toEqual(["uninstall-marker", "bootout-all", "drain", "artifacts", "key-stage", "manifest", "key-delete", "tombstones"]);
  expect(await home.exists(home.plistPath("doctor"))).toBe(false);
  expect(await home.exists(home.brainGitDirectory)).toBe(true);
});

it("keeps the without-launchd variant byte-identical to plan 1a", async () => {
  expect((await uninstaller(await syntheticUninstallHome({ withLaunchd: false })).preview()).variant)
    .toBe("uninstall/present_manifest_without_launchd");
});

it("refuses before any mutation on an unsupported launchctl row", async () => {
  const home = await syntheticUninstallHome({ withLaunchd: true, launchdRow: "drifted" });
  await expect(uninstaller(home).preview()).rejects.toThrow("unsupported_launchd_distribution");
  expect(home.mutations).toEqual([]);
});
```

In `uninstall-launchd.v2.test.ts`, on one real V2 home: `automation enable --apply` (injected launchd runner), then `uninstall`, then assert plists removed, the Brain and `.git` preserved, and the bookkeeping set retained (A12). Cover a kill before and after `P`, and compensation that re-bootstraps from the unlinked snapshot.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npx vitest run --root apps/cli src/lifecycle/uninstall.test.ts`, then `npx vitest run --root apps/cli src/lifecycle/uninstall-launchd.v2.test.ts`
- [ ] **Step 3: Implement.** Keep the `mf` ID last in the block (D28), and keep `lc, tx, …, mf` with the added `le` IDs in `lifecycleReservationOrder`'s order.
- [ ] **Step 4: `npm run lint`**
- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lifecycle/uninstall.ts apps/cli/src/lifecycle/uninstall.test.ts apps/cli/src/lifecycle/testing.ts apps/cli/src/lifecycle/uninstall-launchd.v2.test.ts
git commit -m "feat(cli): uninstall installed launchd jobs"
```

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

### Task 20: Prove the opt-in lifecycle end to end and close the authority enumerators · L

Source: the test half of 2026-08-28 Task 24. The documentation half and the review move to Task 21. NEW-100's uninstall → `init` kill-matrix is not here (D42).

**Files:**
- Create: `tests/integration/git/lifecycle.test.ts` (temporary repositories, local bare remote, injected Git supervisor with a recording runner; no pinned-host exec)
- Create: `tests/integration/launchd/lifecycle.test.ts` (injected launchd runner only)
- Create: `tests/e2e/opt-in-surfaces.test.ts`
- Modify: `tests/security/network.test.ts` (`COMMANDS` rows for `git status`, a disabled `git sync`, `automation status`, and `automation disable` without `--apply`, each with exact spawn count 0; the static network scan stays exactly `packages/security/src/update/transport.ts`)
- Modify: `tests/repository/check.ts`, `tests/repository/check.test.ts` (add `inspectOptInAuthoritySurfaces`)
- Modify: `package.json` (`test:suite` excludes `**/*.pinned-host.test.ts`; add `test:pinned-host`), per Q5 A

**Interfaces:**
- Consumes: Tasks 15, 17 and 18 complete behavior; every spec §7 row.
- Produces:

```ts
export interface OptInAuthorityReportV1 {
  readonly gitEntrypoints: readonly string[];       // files spawning through GitProcessSupervisor
  readonly launchdEntrypoints: readonly string[];   // files spawning /bin/launchctl
  readonly scheduledEntrypoints: readonly string[]; // files dispatching ScheduledJobHandlersV1
  readonly unexpectedSpawnSites: readonly string[]; // any other spawn/execFile in packages/*/src, apps/*/src
}
export function inspectOptInAuthoritySurfaces(repositoryRoot: string): Promise<OptInAuthorityReportV1>;
```

- [ ] **Step 1: Write the tests**

```ts
it("keeps disabled opt-in surfaces inert end to end", async () => {
  const result = await runCliInTempHome(["status"], fixture);
  expect(result.exitCode).toBe(0);
  expect(fixture.gitProcesses).toEqual([]);
  expect(fixture.launchdProcesses).toEqual([]);
  expect(fixture.networkRequests).toEqual([]);
});

it("asserts every authority enumerator is non-empty and there is no stray spawn site", async () => {
  const report = await inspectOptInAuthoritySurfaces(repositoryRoot);
  expect(report.gitEntrypoints.length).toBeGreaterThan(0);
  expect(report.launchdEntrypoints.length).toBeGreaterThan(0);
  expect(report.scheduledEntrypoints.length).toBeGreaterThan(0);
  expect(report.unexpectedSpawnSites).toEqual([]);
});
```

`unexpectedSpawnSites` has an explicit allowlist of today's fixed spawns: `SpawnLockfRunner`, `SpawnRenameAtxRunner`, `NodeProcessRunner`, the launcher's single spawn and the Codex registration. The implementer lists them by symbol and asserts that the allowlist is non-empty.

Map every spec §7 row to at least one named test, in a table inside `tests/integration/git/lifecycle.test.ts`'s leading `describe` names, so that Task 21's review can check coverage row by row. Include:
- enable → sync → automation → disable → uninstall;
- interrupted-phase forgeries;
- push failure and retry;
- bounded ledger repetition;
- concurrent config, repository and plist edits;
- exact ownership preservation.

- [ ] **Step 2: Deferred to Task 21 (D56)**: `npm run build`, then `npx vitest run --root tests integration/git/lifecycle.test.ts integration/launchd/lifecycle.test.ts e2e/opt-in-surfaces.test.ts security/network.test.ts repository/check.test.ts`
- [ ] **Step 3: Implement** the enumerator and any fixture helpers under `tests/helpers/`.
- [ ] **Step 4: `npm run lint`**. `check.js` now runs the new enumerator, so it must be green here.
- [ ] **Step 5: Commit**

```bash
git add tests/integration/git/lifecycle.test.ts tests/integration/launchd/lifecycle.test.ts tests/e2e/opt-in-surfaces.test.ts tests/security/network.test.ts tests/repository/check.ts tests/repository/check.test.ts package.json
git commit -m "test: prove the opt-in lifecycle and close authority enumerators"
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

- [ ] **Step 1:** Run every deferred command from Tasks 1–20, then `npm run check`, then (serially, one real `init` at a time) every `*.v2.test.ts` this plan added. Then run `npm run test:pinned-host` on the certified host. Show failures only.
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
