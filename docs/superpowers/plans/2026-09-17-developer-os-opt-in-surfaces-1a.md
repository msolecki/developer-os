# Developer OS Opt-in Surfaces 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks:** 27 (1–25 plus 10b, inserted by D31, and 23b, inserted by D38). Tasks 1–11 are done and listed under Completed; 12–23b run in the waves below (D33); **Task 24 is deferred out of this plan (D42)**; Task 25 closes the plan directly after Task 23b.

**Goal:** Ship Spec 1a — `config get|set`, the lifecycle coordinator with proven recovery and bounded terminal collection, and a drained V2 uninstall — against the amended Spec 1, with no Git, launchd, or network effect.

**Architecture:** Core owns strict lifecycle configuration records, allocated IDs, the four-root ledger closure, absent-manifest inspection, the Foundation participant bridge, and the generic coordinator/recovery engine, all parameterised by injected leaf codecs and one guarded filesystem port. `platform-macos` adds a stable lock provider that never creates a lock file. The CLI composes the concrete execution-plan codec (Git, launchd and push arms typed but refused until plan 1b), a mutation gate every Foundation mutator passes through on a V2 home, `config get|set`, and the uninstall arms. Production `init` still writes V1 until roadmap Phase 4b; every V2 behaviour here is proven through the packaged-capability fixture.

**Tech Stack:** TypeScript 5.9 strict ESM, Node.js ≥24.16 <25 built-ins, Zod 4, smol-toml, Vitest 4.1, the existing Foundation `TransactionExecutor`/`TransactionStore`, `ManifestStateParticipant`, `MacOsRetainedRename`, `/usr/bin/lockf`.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` as amended 2026-09-17 (NEW-67 items A1–A13, and plan 1a's blocking-question items A14–A16). Consumed from Spec 2 (`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`): the D18 and D20 amendments above its §1, §3.2, §6.1 (with its 2026-09-17 bookkeeping-set amendment), §6.4 (with its 2026-09-17 amendment).

**Source plan:** `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md` Tasks 1–7, 21 and 23, rewritten. Where that plan contradicts the amendment — the V1→V2 migration precondition, `LifecycleBootstrapCreationTempV1`, the absent-manifest recovery epoch and key-present coordinator, unlink/rmdir of the bootstrap leaf and its directories, per-task `npm run check` — this plan wins. The source-to-task map is in the Spec Coverage Index.

**Roadmap:** Phase 4 of `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`. Gate: `config get|set` shipped; coordinator recovery proven; uninstall drains leases.

---

## Founder decisions applied

Recorded in the roadmap's 2026-09-17 table; A14–A16 are in Spec 1 in place.

- **D24 (Spec 1 A14).** Closed variant `uninstall/present_manifest_without_launchd` (`F(uninstall_marker) · R · F(uninstall_artifacts) · K(stage) · M(preserve_before) · M(commit_absence) · K(delete) · M(finalize_tombstones)`, null launchd arms), derived when the manifest owns no plist, the config has no `automation.lifecycle`, and the activation record is absent or its automation arm `inactive`. Otherwise the `P` variant stays as written; plan 1a refuses it `unsupported_until_plan_1b` (exit 4).
- **D25 (Spec 1 A15).** `M(finalize_tombstones)` removes the preimage manifest's empty directory rows (removable partition, deepest first, bookkeeping set excluded) before it deletes the manifest tombstone; recovery re-derives the list from the still-present hash-bound tombstone; a non-empty directory is preserved and reported.
- **D26.** The 256-mutation capacity of `F(uninstall_artifacts)` is decided at Phase 4b (NEW-85). Plan 1a ships only the pre-allocation refusal `uninstall_artifact_capacity_exceeded` (exit 4).
- **D27.** Absent-manifest uninstall applies §6 literally: after a V1 `uninstall`, leftover V1 Foundation residue refuses with exit 6 and D20's archive guidance. No spec change; the tests pinning a second successful uninstall are rewritten.
- **D28 (Spec 1 A16).** The allocated `mf_` manifest participant ID is reserved last in a composite's contiguous ID block.
- **D34 (2026-09-20).** Task 12's `Produces` block gains `manifestBeforeHash: (plan: TPlan) => LowerHexSha256 | null`, compared against `fs.hashRegular` of the manifest. Taken during Task 12's review, which proved a manifest present at the right cursor with different bytes yielded `uninstall_draining` and so opened a destructive uninstall by path state alone — what §7 forbids as synthesising the drain by path absence. Amended immediately because `inspectLifecycleLedger` still had no consumer.
- **D36 (2026-09-20).** From Task 14 on, plan 1a runs **implementation-first**: each task runs its fast commands and `npm run lint`, is integrated immediately, and the next task starts. **No per-task fresh-context review and no per-task fix cycle.** One whole-plan review and one fix round happen at plan close, with `npm run check`. Commits are held locally and pushed **once**, at plan close, as a single run. Founder decision, taken after wave 1, which cost three review rounds per task. It knowingly suspends `security.md`'s rule that a fresh agent must review agent-generated code and `SESSION.md` §5 step 3 and step 7 for the remainder of this plan; the risk accepted is that a defect in a consumed interface is found only after its consumers bound to it, which is what D34 was taken to avoid. Wave 1's per-task reviews found two destructive-gate false positives, one fail-open closure and one over-broad deletion; the end-of-plan review must cover the same ground for Tasks 14–25.
- **D37 (2026-09-21).** NEW-94's durable fix goes into `ordinaryDirectories`
  (`apps/cli/src/bootstrap/executor.ts`): a fresh V2 `init` creates `staging/lifecycle` like every
  other bookkeeping root, so an untouched installation stops failing its own ledger check. Founder
  decision, taken over letting the ledger tolerate the absence, which would have weakened A12's
  exact-shape admission to avoid a slow gate. **It does not run inside plan 1a**: that file's gate
  is the 330-minute `bootstrap-executor` job D32 defers, and shipping an unrun change against D19's
  layout assertions is what the decision refuses. It becomes its own task, gated properly, after
  plan 1a closes. Task 19's `requireLifecycleStagingRoot` stays as the interim until then, and is
  removed by that task.
- **D40 (2026-09-22).** **No test suite runs per task for the rest of plan 1a.** A task commit runs
  `npm run lint` and nothing else. Every vitest run — the task's own new cases, the focused `-t`
  filters D32 kept, the orchestrator's rerun on the integrated tree, `citations.test.ts` — is
  deferred to plan close, where the full suite runs once against the finished tree. Founder decision,
  taken on 2026-09-22 after the per-task gates had cost several hours of wall clock across wave 8b
  alone: `report.test.ts` 608 s, the restored chain 1137 s, `uninstall.v2` + `mutation-gate.v2` a
  further ~815 s, each rerun on the integrated tree after already running in the worktree.
  `npm run lint` stays because it is the build and typecheck step — `tsc -b` then `eslint` then the
  repository check — and it is what keeps this a per-commit lane rather than no validation at all;
  it is **11 seconds**, measured on 2026-09-22, against the suites' tens of minutes. This supersedes D32's "fast commands named
  by the task" and `SESSION.md` §5 step 1 for the remainder of plan 1a.
  **What this buys and what it costs.** It buys wall clock, which is the whole point. It costs the
  property that wave 5 established and that this plan has leaned on since: a defect that only appears
  on the combined tree is now found at plan close, against every task at once, instead of against the
  task that caused it. Wave 5's own integration defect, NEW-99, and the two citation regressions were
  each caught by exactly the runs this decision removes. Plan close therefore absorbs a larger fix
  round than the one D36 already scheduled, and the tasks land unproven until then.

- **D39 (2026-09-22).** Task 24 **cuts coverage to stay under the 300-minute `lifecycle-v2` cap**,
  rather than sharding the job into two runners or raising the cap toward GitHub's 360-minute hosted
  maximum. Founder decision, taken on the projection that Task 24 would otherwise land the job at
  ~304–364 minutes: after Task 23b the running total is 3680.3 s (185 minutes, 62% of the cap), and
  Task 23b measured the chained shape at 2.3× its unchained cost, quadratic in cycle count because
  cycle *k* inspects *k* retained envelopes.
  **The cut is `A9_KILL_POINTS` 10 → 6 and nothing else.** The round-trip case stays exactly as
  written: it already runs the minimum two cycles, and its third `uninstall` — the one that follows a
  reinstall — is the single operation NEW-99 breaks on, so removing it would delete the regression
  detector for the defect D38 was taken to fix. Six kill points is also precisely Task 23's chain
  length, the shape that did surface NEW-99.
  **Selection rule, not a count:** keep one kill point per distinct recovery arm *and* per distinct
  control-file microstate the code branches on; drop only a point provably equivalent to a kept one
  at both levels, and record which four were dropped and why each is equivalent. `plan plus lock`
  and `plan only` are **not** equivalent — Task 23 found the fixture silently collapsing the first
  into the second — so if only one survives it is `plan plus lock`.
  Accepted risk: four A9 recovery microstates lose direct coverage inside plan 1a. NEW-100 carries
  them, and restoring them is gated on the job being sharded.

- **D38 (2026-09-21).** NEW-99 is fixed **inside plan 1a**, as new Task 23b, before Task 24. Founder
  decision, taken when Task 23 proved that after one `uninstall` → `init` round trip every later
  `uninstall` refuses exit 6, which makes Task 24's headline case unreachable. Unlike D37 this is not
  an unrun change behind a deferred gate: `apps/cli/src/bootstrap/report.ts` is covered by
  `apps/cli/src/bootstrap/report.test.ts`, which D32 does **not** defer, so the fix ships with its own
  gate green. `apps/cli/src/bootstrap/executor.test.ts` stays deferred to plan close like every other
  task's slow suite. Task 23b also restores Task 23's shared-home chain, returning A9 round-trip
  coverage from one cycle to six — the shape that would have caught NEW-99 in the first place.

- **D41 (2026-09-22).** **Task 24 is exempt from D40.** D40 supersedes "the task's own new cases" for
  every remaining task, but Task 24's Step 2 is not an ordinary verification gate: it measures the
  real wall-clock duration of `uninstall-round-trip.v2.test.ts` to compute `lifecycle-v2`'s
  `timeout-minutes` under D39's 300-minute cap, and Task 24's own text requires stopping before commit
  if the computed budget exceeds it. Deferring that run to plan close would mean committing a CI
  timeout value nobody has measured, which is the unsafe outcome D34 and D39 already spent effort
  avoiding for this same job. Founder decision, taken when the orchestrator surfaced the contradiction
  before dispatching Task 24: the implementer runs
  `npx vitest run --root apps/cli src/lifecycle/uninstall-round-trip.v2.test.ts` for real, exactly as
  Task 24 Step 2 specifies, applies the 300-minute stop-and-ask gate before committing, and reports the
  measured duration. D40 stands unchanged for every other remaining task and for Task 25's closure
  suites.

- **D42 (2026-09-22).** **Task 24 is carved out of plan 1a and deferred to post-A16 hardening.**
  Supersedes D41 (moot: Task 24 no longer runs inside this plan, so its D40 exemption has nothing to
  apply to) and D39 (moot: nothing is cut from `A9_KILL_POINTS` inside plan 1a, because Task 24's file
  is never created here). Founder decision, taken after the orchestrator had already dispatched an
  implementer for Task 24 and it was still running a real fresh-V2 round-trip past the file's own
  ~31-minute estimate: the founder judged this class of heavy real-filesystem e2e proof not worth the
  wall clock right now, against shipping the rest of the roadmap's plans first. **Wave 10 (Task 25)
  now waits on Task 23b directly, not on Task 24.** Task 25 closes plan 1a's own goal — `config
  get|set`, proven coordinator recovery, drained V2 uninstall — without Task 24's additional
  round-trip and kill-matrix coverage. Task 24's full spec (unchanged, below) stays owed; it is
  tracked as `BACKLOG.md` NEW-100, owned by "post-A16 hardening, before it is relied on as a release
  gate", to run once, together with the codebase's other heavy e2e suites, after A11b and A12–A16
  close rather than inside this plan. **Accepted risk, stated plainly:** beyond what Tasks 20–23b's
  own suites already exercise (one reinstall cycle, and the NEW-99 regression Task 23's own chain
  already covers), the `uninstall` → `init` round trip is not proven end-to-end, and 4 of the 10 A9
  recovery microstates D39 would have selectively cut are instead entirely unproven, until Task 24
  actually runs. `docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md` (this file)
  is **not** deleted when plan 1a otherwise closes, because Task 24's contract has not yet moved to a
  canonical document in full; it stays until Task 24 runs or its complete spec is copied into a
  successor document.

- **D35 (2026-09-20).** The effect-journal codec, its phase accessor and the `classify` change they require are **deferred to plan 1b**. Unlike D34 the gap is unreachable in 1a — the null plan codec makes every effect leaf a `lifecycle_effect_root_unsupported` finding before a journal codec could matter — `LifecycleLedgerDependenciesV1` has only two construction sites in the whole plan, both of which Task 18 and 1b touch anyway, and `LifecycleEffectPhaseV1` would have been a guess at 1b's schema with no implementation to check it against. Task 12's Cover list records the full 1b obligation.

## Global Constraints

- **Execution precondition (A1).** Met at Task 1. From Task 17 onward the structural admission tests live in `test:lifecycle`, which D32 defers to Task 25.
- **V1 homes (A1, D18, D20).** `config` refuses a V1 manifest with `manifest_v1_not_migratable`, exit 4, before any lock or write. `uninstall` over a V1 manifest runs the unchanged Foundation path. A V1 home has no `state/.lifecycle.lock`, and no Foundation command over a V1 manifest takes one.
- **Production reachability.** `bootstrap: { state: "unavailable_until_packaged_handoff" }` in `createProductionContext` (`apps/cli/src/context.ts`) stays; removing it is Phase 4b. V2 behaviour is proven only through `createCommandFixture(name, { bootstrapAvailable: true })`, a real fresh V2 `init`, and injected ports.
- **Per-commit gate (D17, D32, `SESSION.md` §5).** Fast commands named by the task, then `npm run lint`; slow commands — `npm run test…` scripts and whole runs of `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security` and `tests/integration` — are deferred to Task 25's `npm run check`, except the task's own added or changed cases, which run red then green filtered with `-t`. Then fresh-context review by an agent that did not author the task, then commit, then push. An accepted review finding gets a failing regression test first. `npm run check` runs only in Task 25.
- **Push rule (D17; the orchestrator alone pushes, D33).** Before each commit run `gh run list --branch development --limit 1 --json status,conclusion,headSha`: a completed run with conclusion `failure` stops new commits until fixed. After the commit, push to `development` only when no run is `queued` or `in_progress`; otherwise push it with the next commit. Never merge.
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** New files there need `git add -f`, and `git add` of those paths exits 1 even for tracked files. Put that `git add -f` on its own line; never chain it with `&&` into `git commit`.
- **Per-task bookkeeping (D33).** Only the orchestrating session edits this file and `docs/superpowers/`; implementers commit code and tests only. When the orchestrator integrates a task it ticks that task's steps here and rewrites the `ORDER.md` line beginning `Plan 1a progress:` to `Plan 1a progress: committed 1–11, <integrated tasks>; in flight <tasks, or none>; ready next <tasks>.` A task's own "Tick, update the progress sentence" and `git add -f` of these documents are the orchestrator's integration step, not the implementer's.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in tracked documents. Cite a line outside a fenced block only when it exists and stays in range; otherwise name the symbol.
- **Comments.** Add no code comment unless it records a non-obvious platform fact, a dated past bug, or a rejected alternative someone would otherwise restore. Do not strip existing comments.
- **Package direction.** `core ← security ← platform-macos ← cli`. Core imports no CLI, platform, Security or Brain module; platform code receives filesystem, process, clock and lock dependencies.
- **Canonical bytes.** Every new persisted record is exactly `encodeCanonicalJson(value)` (`packages/core/src/lifecycle/canonical-json.ts`, already shipped), whose output already ends in its one LF — never append another — and is read back with `decodeCanonicalJson`. Foundation journals stay `FoundationJournalJsonV1` through `encodeFoundationJournalJsonV1` (`packages/core/src/transactions/store.ts`). Legacy `tx_<lowercase-v4-uuid>` journals keep the compatibility read.
- **Domain-separated hashes.** SHA-256 over the ASCII domain, then its trailing NUL, then the canonical bytes including LF: `developer-os:lifecycle-coordinator-plan:v1\0`, `developer-os:foundation-participant-plan:v1\0`, `developer-os:lifecycle-preview:v1\0` (with `previewHash` omitted), `developer-os:redaction-key-state-plan:v1\0`, `developer-os:git-effect-plan:v1\0`, `developer-os:launchd-effect-plan:v1\0`, `developer-os:lifecycle:git:v1\0`, `developer-os:lifecycle:automation:v1\0`, `developer-os:git-scope:v1\0`.
- **Size bounds.** Foundation, coordinator and launchd-effect journals ≤ 1,048,576 bytes; Git-effect journals and every immutable plan ≤ 16,777,216 bytes; allocated Foundation payloads 0..16,777,216 bytes; allocator ≤ 1,024 bytes; nonce exactly 64 lowercase hex bytes plus LF; `UninstallingMarkerV1` ≤ 1,024 bytes; lifecycle record in `config.toml` ≤ 1,048,576 bytes before parse.
- **Ledger bounds (`LifecycleLedgerBoundsV1`).** 10,000 leaves per journal root; 100,000 Foundation staging leaves; 100,000 Foundation backup leaves; 1,000,000 lifecycle staging leaves aggregate and per coordinator; 1,000,000 leaves for Foundation overflow recovery. Counts include regular files, temporary leaves and ID/coordinator directories. Reservation refuses before an ID block.
- **Cardinalities.** Coordinator `steps` 1..256; Foundation refs 0..64; mutations per ref 1..256; `plistPaths` 0..4; preview `files` 0..16; `LifecycleTerminalCompactionV1.entries` 2..70; `compactionNext` 0..70; `nextStep` 0..256; `compensationNext` −1..255 or null.
- **Absent-manifest walk.** At most 1,000,000 directory entries, 128 components, 4,096 UTF-8 path bytes; names valid UTF-8, unique, no NUL, slash, backslash, `.` or `..`; every visited directory owned by the effective uid.
- **Redaction key.** `state/redaction.key`: owner 0600 single-link regular file of 32..1,048,576 bytes, opened `O_NOFOLLOW | O_NONBLOCK`, never read, hashed or journaled. Tombstone `state/.redaction.key.<coordinator-id>.tombstone`.
- **Locks.** `state/.lifecycle.lock` is created only by Spec 2's fresh `init`, opened elsewhere without `O_CREAT`, and never unlinked. Bootstrap → global is legal only inside fresh `init`. Order is runner lease → global → transaction-specific; uninstall acquires leases only while holding no global lock. Interactive contention on the global lock refuses exit 6. Uninstall's lease drain has one absolute ten-minute deadline.
- **Bookkeeping set (A12).** `state/.lifecycle.lock`, `state/lifecycle-journals`, `state/git-effect-journals`, `state/launchd-effect-journals`, `state/transactions`, `staging/lifecycle`, `staging/transactions`, `backups/transactions`, `staging`, `backups`. Never a manifest row; never removed by uninstall; admitted by exact shape where no manifest exists.
- **Retention (A2, D21).** No unlink or `rmdir` of the bootstrap leaf, bootstrap plans, journal slots, retained tombstones, or anything in the bookkeeping set. Post-handoff terminal compaction keeps guarded deletion of its own exact leaves.
- **No external effects.** No 1a code path spawns Git or `launchctl`, opens a network connection, or invokes a vendor. Git, launchd and push leaves, and the `uninstall/present_manifest` (`P`) variant, refuse with `unsupported_until_plan_1b`.
- **Fixtures.** Synthetic only: temporary homes, the packaged-capability fixture, injected runners and clocks. Every enumerating test asserts its expected set is non-empty before asserting over it.
- **Cost.** A real fresh V2 `init` took 132 s on the development machine on 2026-09-17. Tests share one initialised home per file or chain sequences wherever the contract allows. Focused runs use `-t` filters so a task's own gate stays well under an hour.
- **CI budgets (`.github/workflows/check.yml`).** `lint` 20, `bootstrap-executor` 330, `suite` 150, `e2e` 40, `vendor-ingest` 15 minutes. A hosted `macos-15` runner measured ~1.9–2× local. Baselines from the last green run, 35213248735: `suite` 85.5, `bootstrap-executor` 243.8, `e2e` 5.9 CI minutes. `apps/cli` runs its test files serially (`fileParallelism: false`). Two rules:
  - Task 1 adds the `lifecycle-v2` job (`npm run test:lifecycle`, also run by `npm test` and therefore `npm run check`). From Task 1 on, every test case this plan adds that performs a real fresh V2 `init` goes in a file named `*.v2.test.ts`, which `test:suite` excludes and `lifecycle-v2` runs. No task adds a real V2 `init` to a file another job runs, so `suite`, `bootstrap-executor` and `e2e` stay at their baselines except for rewritten existing cases.
  - A task that adds or grows a `*.v2.test.ts` file measures only that file (its Vitest summary), adds it to `lifecycle-v2`'s running local total kept in the job comment, and sets `timeout-minutes` to ceil(total × 2 × 1.5). **Stop and ask before committing** if that exceeds 300, or if any other job's projection (baseline + local delta × 2) exceeds 85% of its budget (`suite` 127, `bootstrap-executor` 280, `e2e` 34 CI minutes).

## Scope decisions

1. **Git, launchd, runtime records, automation (source Tasks 8–20, 22) are plan 1b.** Core ships every operation row, step kind and closure rule, proven with synthetic leaf codecs. The CLI's concrete execution-plan codec refuses non-null Git-effect, launchd-effect, launchd-plan and push arms with `LifecycleUnsupportedLeafError` (`unsupported_until_plan_1b`, exit 4). No concrete `LifecyclePlanPreviewV1` codec ships, because all four preview commands are 1b.
2. **Effect journal roots in 1a.** Any leaf in `state/git-effect-journals` or `state/launchd-effect-journals`, and any `git/` or `launchd-process/` staging under `staging/lifecycle/<id>`, makes closure `lifecycle_recovery_required`: no 1a operation can write one.
3. **Lease primitive.** 1a owns only uninstall's side of `AutomationRunnerLeaseV1`: Task 9's `acquireExistingWithin` opens the four `state/.automation-<job>.lock` paths fresh `init` created, without `O_CREAT`, in registry order (`brain-reindex`, `brain-lint`, `doctor`, `git-sync`) under one deadline. Task 22 owns `R`, the re-drain before an unapplied `F(uninstall_artifacts)`, and lease-path removal while held. Runner-side leases, statuses and logs are 1b.
4. **`config`** follows Spec 1 §2.3 as amended by A1: V1 refuses exit 4 before any lock. With the manifest absent, `config get` and `config set` take the global lock when it exists (never creating it), find no manifest, and refuse exit 2; when it does not exist they refuse exit 2 without it. On V2, `config get` takes no lock, and `config set` is one standalone Foundation transaction with one allocated `tx_<nonce>_<counter>` ID run through Task 19's gate (global lock → recovery and compaction preflight → closure `clear` → leaf reservation → ID allocation).
5. **Every `context.executor` call goes through the gate.** On a V2 home — `capture`, `ingest`, `review`, `reindex`, `repair`, and, until Task 22 replaces it, the V2 downcast `uninstall` (`apps/cli/src/commands/uninstall.ts`, `revertArtifacts`) — the gate takes the lock and allocates the ID. On V1, or with the manifest absent and no global lock — including V1 `init`'s transaction (`apps/cli/src/commands/init.ts`) — it is unchanged. With the manifest absent and the global lock present it refuses exit 2. `repair --resume|--rollback <id>` on V2 is the explicit resolution of exactly that standalone journal. Task 19 tests each arm.
6. **Coordinator recovery before mutation** resumes non-uninstall coordinators to terminal and compacts them. A non-terminal uninstall coordinator refuses exit 6 with recovery `developer-os uninstall`. A non-terminal standalone Foundation journal refuses exit 6 with recovery `developer-os repair --resume <id>` or `--rollback <id>`, unless it is the one the caller is resolving.
7. **D29: NEW-80 is Task 1.** D19's layout cannot be pinned before the code moves, and moving it is free while no V2 installation exists. NEW-80's row closes in Task 1.
8. **NEW-83 closes in Task 3.** Both remaining places are decided from §6.4's own words: a `retaining` envelope is active before handoff, so only `init` advances it; an envelope with no valid slot is `unverified` when confined, never "resume with init".
9. **D28:** the manifest participant ID is `AllocatedLifecycleIdV1<"mf">` (Spec 2's shipped `ManifestStatePlanV1`), reserved last in the coordinator block.
10. **D27: absent-manifest uninstall follows §6 on every home.** V1 Foundation residue refuses exit 6 with D20's archive guidance; the orphaned key beside a rolled-back V2 `init` is deleted by `key_present`.
11. **V2 reinstall after the shipped downcast uninstall refuses from Task 2 until Task 22.** The downcast uninstall leaves its own Foundation journal in `state/transactions`, which A12's shape admission correctly refuses. V2 is not production-reachable before Phase 4b, so Task 2 proves reinstall through the rolled-back-`init` sequence, `tests/e2e/fresh-v2-retained-bootstrap.test.ts` pins the exit-6 refusal naming that Foundation residue under `state/transactions`, `staging/transactions` or `backups/transactions`, and Task 22 restores the reinstall when the coordinator uninstall leaves only the bookkeeping set.
12. **The `config set` argv value** is the canonical JSON text without its trailing LF. The codec appends the LF and requires byte-exact `CanonicalJsonV1`.
13. **`config` success output** is exactly `encodeCanonicalJson(result)`, with or without `--json`. Refusals use the standing error envelope.
14. **`admitV2Handoff` is deleted** by Task 17; it has no production caller. Structural admission replaces it (A7, NEW-82), and its handoff-set completeness coverage moves into Task 17's tests. `assertOrdinaryCommandAdmitted` changes only as Task 3 requires; its NEW-81 hardening is Phase 4b.
15. **`status` and `doctor`** gain no closure report (§2.2 says "may"). Task 17 only proves both are admitted at every closure state and drift.
16. **CI.** Task 1 adds the `lifecycle-v2` job and `test:lifecycle` script with this plan's first real-V2-home test file; every later `*.v2.test.ts` file joins it. `SESSION.md` §5 step 7's "all five jobs" becomes "every job".
17. **Partial §7 rows.** A9's `git enable` preview half and every runner fixture in "uninstall drains without deadlock" are plan 1b. The source plan's `output-schemas.ts` edits are dropped: that module holds vendor output schemas, not CLI result types.
18. **The source plan** stays as plan 1b's source. Task 25 marks its Tasks 1–7, 21 and 23 "executed via plan 1a" and does not delete it.
19. **Ordering.** `config get|set` (source Task 2) is Task 20: after the lock provider (Task 9), as roadmap Phase 4 requires, and after the gate it needs (Task 19).

## File and Responsibility Map

| Area | Files | Responsibility |
|---|---|---|
| Fresh V2 layout | `apps/cli/src/bootstrap/{executor,report,context}.ts` | D19 paths, `.status.json` reservation, bookkeeping shape admission, identity attribution of bootstrap residue |
| Core bootstrap validator | `packages/core/src/manifest/bootstrap.ts` | Conditional `createdPaths[0]`; `LifecycleBootstrapLockV1` without created-by-attempt fields |
| Core configuration | `packages/core/src/config/{types,loader,lifecycle,keys,index}.ts` | Strict lifecycle records, URL/branch/schedule grammars, activation hash, closed key codecs |
| Core lifecycle kernel | `packages/core/src/lifecycle/{canonical-json,bookkeeping,ids,records,types,codecs,grammar,locks,guarded-fs,testing,allocator,foundation-ledger,ledger,absent-manifest,store,foundation-participant,foundation-compaction,coordinator,coordinator-compaction,recovery,index}.ts` | Shared grammar, allocation, closure, publication, participants, execution, recovery, compaction |
| Foundation executor | `packages/core/src/transactions/{executor,index}.ts` | Lifecycle Foundation participant first-journal bridge |
| Core door | `packages/core/src/index.ts`, `packages/core/src/index.test.ts` | Exact runtime export list |
| Platform lock | `packages/platform-macos/src/{stable-lock,index}.ts` | Non-creating identity-checked lock provider with deadline acquisition |
| CLI lifecycle | `apps/cli/src/lifecycle/{admission,redaction-key,codecs,context,mutation-gate,absent-manifest-uninstall,uninstall,uninstall-recovery}.ts` | Structural admission, concrete codecs, composition root, mutation gate, uninstall arms |
| CLI commands | `apps/cli/src/commands/{config,uninstall,doctor,testing}.ts`, `apps/cli/src/{main,context}.ts` | `config` verb, uninstall dispatch, compaction-tolerant survey, fixture and production wiring |
| Gates | `apps/cli/src/lifecycle/*.test.ts`, `tests/e2e/fresh-v2-retained-bootstrap.test.ts` | A8 counting seams, A9 round trips, §7 rows in scope |
| Canonical docs | `docs/architecture/{foundation,foundation-constraints,threat-model}.md`, `docs/superpowers/{ORDER,BACKLOG}.md`, roadmap | Withdrawn envelope removed, surviving constraints carried forward |

```text
Verified anchors at plan writing (base a891952), kept for the open tasks. Inside a fence so the
citations gate ignores them; line numbers drift, so each task re-locates by symbol.
apps/cli/src/context.ts               765   bootstrap: { state: "unavailable_until_packaged_handoff" } (Phase 4b)
apps/cli/src/bootstrap/report.ts      1437  guardedFile(): null for any non-regular entry (Task 17)
apps/cli/src/bootstrap/report.ts      1514  admitV2Handoff (no production caller; Task 17 deletes it)
apps/cli/src/bootstrap/context.ts     238   listNames wired to readdir (Task 17)
```

---
## Completed: Tasks 1–11

Committed 2026-09-17 to 2026-09-19 as `43c6876..62ef4f1`, one commit per task, each after fresh-context review. Their contract is Spec 1 as amended, their code is in the tree, and git history holds their steps.

| Task | Commit | Outcome |
|---|---|---|
| 1 | `43c6876` | D19 release layout and the renamed `.status.json` reservation pinned; NEW-80 closed |
| 2 | `4d0c7f3` | bookkeeping set admitted by shape and kept out of the manifest |
| 3 | `d29d63c` | bootstrap residue attributed by identity; NEW-83 closed |
| 4 | `08a515e` | strict lifecycle configuration records |
| 5 | `e9e0449` | closed `config` key, value and result codecs |
| 6 | `016896c` | lifecycle scalars, allocated IDs and small records on Spec 2's shipped types |
| 7 | `a62916a` | generic coordinator plan, journal, preview and Foundation participant contracts |
| 8 | `a06f4c8` | exact operation grammar, points of no return and derived journal legality |
| 9 | `6c71916` | stable lock provider that never creates, with bounded lease acquisition |
| 10 | `e70332c` | guarded filesystem port and install-scoped ID allocator |
| 10b | `c81b590` | every recorded filesystem identity in one exact 64-bit encoding (D31) |
| 11 | `62ef4f1` | Foundation ledger inventory under its closed grammar |

## Execution waves (D33)

Derived from each task's `Consumes:` line. A task starts only when every task it consumes is integrated on `development`; the tasks of one wave run in parallel, each in its own worktree outside the repository.

| Wave | Tasks | Waits for |
|---|---|---|
| 1 | 12, 13, 15, 17 | nothing: 1–11 are integrated |
| 2 | 14 | 12 |
| 3 | 16 | 14, 15 |
| 4 | 18 | 12–17 |
| 5 | 19, 21 | 18; 21 also 13 |
| 6 | 20 | 19 |
| 7 | 22 | 20, 21 |
| 8 | 23 | 22 |
| 8b | 23b | 23 (D38) |
| 9 | 24 | **deferred — carved out of plan 1a, D42; see Task 24 below** |
| 10 | 25 | 23b (D42: no longer 24) |

Shared files. Tasks 12–16 all edit `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts` and the exact export list in `packages/core/src/index.test.ts`: the integrator takes the union of the added exports, keeps that list in case-insensitive order, and reruns `npx vitest run --root packages/core src/index.test.ts`. Two more shared files the task file lists do not name: `packages/core/src/lifecycle/types.ts`, whose `LIFECYCLE_HASH_DOMAINS` keys also merge as a union, and `tests/repository/check.ts`, whose `STAT_OPTION_EXEMPT` array every task adding a guarded-port caller appends to — Tasks 13 and 15 were verified to conflict there and in `packages/core/src/index.ts`, both resolving as a union of added lines. Tasks 17 and 19–24 each set `lifecycle-v2` `timeout-minutes` in `.github/workflows/check.yml`: the integrator keeps the running local total in the job comment and recomputes the budget from it.

### Task 12: Coordinator ledger and `LifecycleJournalClosureV1` · L

Source: old Task 4 (ledger inventory, coordinator half) and old Task 7's `inspectLifecycleJournalClosure`. Spec 1 §2.2 closure union; §2.4 closure paragraph, plan/journal/lock states, initial and rewrite temps, `staging/lifecycle` grammar, uninstall control-file microstates, `uninstall_draining` discrimination.

**Files:**
- Create: `packages/core/src/lifecycle/ledger.ts`
- Create: `packages/core/src/lifecycle/ledger.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8, 10, 11.
- Produces:

```ts
export interface LifecycleLedgerDependenciesV1<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>> {
  readonly fs: LifecycleGuardedFileSystemV1; readonly effectiveUid: number;
  readonly executionPlanCodec: LifecycleValueCodec<TPlan>; readonly coordinatorJournalCodec: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
  readonly variantFacts: (plan: TPlan) => LifecycleVariantFactsV1;
  readonly pushPlanHash: (plan: TPlan) => LowerHexSha256 | null;
  /** null in plan 1a: every leaf in that root, or its staging, is a finding. */
  readonly gitEffectPlanCodec: LifecycleValueCodec<unknown> | null;
  readonly launchdEffectPlanCodec: LifecycleValueCodec<unknown> | null;
  readonly residue: LifecycleBookkeepingResidueV1;
  /** D34: the plan's manifest before-state hash, compared against `fs.hashRegular`; null binds no preimage. */
  readonly manifestBeforeHash: (plan: TPlan) => LowerHexSha256 | null;
  /** The four lease paths an uninstall plan binds, for the draining discriminator. */
  readonly leasePaths: (plan: TPlan) => readonly CanonicalAbsolutePathV1[];
}
export interface LifecycleCoordinatorRecordV1<TPlan> {
  readonly id: LifecycleCoordinatorIdV1; readonly plan: TPlan; readonly variant: LifecycleOperationVariantV1;
  readonly journal: LifecycleCoordinatorJournalV1 | null; readonly lock: LifecycleGuardedEntryV1 | null;
  readonly state: "active" | "terminal" | "compacting" | "pre_journal_orphan" | "envelope_suffix_plan_and_lock" | "envelope_suffix_plan_only";
}
export interface LifecycleLedgerSnapshotV1<TPlan> {
  readonly closure: LifecycleJournalClosureV1;
  readonly allocator: LifecycleAllocatorStateV1 | null; // null only in the uninstall control-file microstates
  readonly foundation: FoundationLedgerV1;
  readonly coordinators: readonly LifecycleCoordinatorRecordV1<TPlan>[];
  readonly standaloneTerminalFoundation: readonly FoundationTerminalCompactionV1[];
  readonly standaloneNonTerminalFoundation: readonly { readonly id: FoundationTransactionIdV1; readonly phase: TransactionPhase }[];
  readonly coordinatorOrphans: readonly { readonly kind: "planless_staging" | "initial_journal_temp" | "plan_publication_temp" | "rewrite_temp"; readonly path: CanonicalAbsolutePathV1 }[];
  readonly findings: readonly { readonly reason: SafeReasonCodeV1; readonly path: CanonicalAbsolutePathV1 }[];
  readonly counts: { readonly coordinatorJournals: number; readonly gitEffectJournals: number; readonly launchdEffectJournals: number; readonly lifecycleStagingAggregate: number; readonly lifecycleStagingMaximumPerCoordinator: number };
}
export async function inspectLifecycleLedger<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>>(
  dependencies: LifecycleLedgerDependenciesV1<TPlan>, roots: LifecycleLedgerRootsV1,
): Promise<LifecycleLedgerSnapshotV1<TPlan>>;
```

- [x] **Step 1: Write failing closure tests over synthetic plans**

```ts
it("is clear only for a fully valid terminal ledger", async () => {
  const ledger = await memoryLedger(synthetic.terminalUninstallEnvelopeAbsent());
  expect((await inspectLifecycleLedger(DEPENDENCIES, ROOTS)).closure).toStrictEqual({ kind: "clear" });
});

it("returns retry_only for exactly one bound push_pending coordinator", async () => {
  const snapshot = await inspectLifecycleLedger(depsFor(synthetic.pushPending("git_sync/existing_network")), ROOTS);
  expect(snapshot.closure).toStrictEqual({ kind: "retry_only", transactionId: synthetic.id, pushPlanHash: synthetic.pushHash });
});

it("returns uninstall_draining only after the artifacts participant removed every bound lease path", async () => {
  for (const removed of [0, 1, 2, 3]) {
    const snapshot = await inspectLifecycleLedger(depsFor(synthetic.uninstallAtArtifacts({ leasePathsRemoved: removed })), ROOTS);
    expect(snapshot.closure.kind).toBe("lifecycle_recovery_required");
  }
  const drained = await inspectLifecycleLedger(depsFor(synthetic.uninstallAtArtifacts({ leasePathsRemoved: 4 })), ROOTS);
  expect(drained.closure).toStrictEqual({ kind: "uninstall_draining", transactionId: synthetic.id });
});
```

Cover: zero, one and two `push_pending` candidates; one `push_pending` plus any other non-terminal journal; mixed `retry_only` and `uninstall_draining` candidates; lease paths absent while the artifacts journal is absent, or the manifest's bytes do not hash to `manifestBeforeHash(plan)` while the cursor still places it at its preimage, never yield `uninstall_draining` (D34); past `M(commit_absence)` the manifest state is `absent`, which binds no bytes, so agreement there is presence-only; a consumed participant without a `finalized` journal, and a future participant holding a final journal in any phase, are findings; `compacting` at every `compactionNext` is `lifecycle_recovery_required`; plan-plus-lock and plan-only suffixes are legal only with every earlier compaction entry absent, and a lock-only coordinator envelope is a finding; the uninstall control-file microstates at the `coordinator_envelope` cursor (both present, allocator absent with nonce present, both absent) are legal and nonce-absent with allocator-present is a finding; a journal without its plan, an unreferenced effect journal, an ID/filename/plan-hash mismatch, a non-canonical plan, a plan over 16,777,216 bytes, and a journal over its plan's `maximumJournalBytes` are findings; an initial coordinator/participant journal temp or plan-publication temp (empty, partial, complete) is a non-clear `coordinatorOrphans` entry only in the states §2.4 admits, and a finding after any participant journal exists; a well-formed planless `staging/lifecycle/<id>` tree with both coordinator plan and journal absent is a `planless_staging` orphan; `foundation/<participant-id>/journal.json` with unknown siblings is a finding; with `gitEffectPlanCodec` and `launchdEffectPlanCodec` null (plan 1a), any leaf in either effect root and any `git/` or `launchd-process/` staging child is a finding; with synthetic effect codecs supplied, the same plan leaves validate against their plans, while effect journal leaves are checked for shape and size only (plan 1b additionally adds the effect staging grammar, the effect-root temporary-leaf states, an effect-journal codec paired with a phase accessor on `LifecycleLedgerDependenciesV1` — `{ codec, phase: (journal) => LifecycleEffectPhaseV1 } | null`, never a codec plus a boolean — the effect-journal identity binding to its filename, and the phase rule `verified` before the point of no return and `finalized` after that lets a terminal effect journal reach `clear`; bounding an effect journal by its own ref rather than the global parser ceiling additionally requires `maximumJournalBytes` on Task 7's `LifecycleEffectRefV1`); a non-terminal standalone Foundation journal makes closure `lifecycle_recovery_required`; the allocator temp from Task 10 makes closure non-clear without deletion; caps 10,000 per root and 1,000,000 aggregate and per coordinator counted through the in-memory port at the exact maximum and first-over; malformed bytes with no readable participant envelope still yield `lifecycle_recovery_required`.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/ledger.test.ts`

Expected: FAIL — `ledger.ts` does not exist.

- [x] **Step 3: Implement the fail-closed classification**

Order: coordinator root; allocator state (Task 10, read-only); Foundation ledger (Task 11), given every participant ID the valid coordinator plans name; effect roots; lifecycle staging; then classify exactly as Spec 1 §2.4's closure paragraph. The coordinator root runs first and the plan's original order cannot be executed: `admitsControlFileAbsence` reads the scanned coordinators to recognise §2.4's legal uninstall control-file microstates, so an allocator-first pass refuses `lifecycle_id_allocator_shape` on exactly the homes the spec admits, and `inspectFoundationLedger` needs both the nonce and the participant IDs the validated coordinator plans supply. Classification precedence is unaffected, because closure is fail-closed globally. Any finding makes closure `lifecycle_recovery_required` globally. A Foundation journal referenced by a non-terminal coordinator is not standalone, and each referenced participant is checked against the cursor: consumed requires a present `finalized` journal, future requires no final journal, and the current index is left to its own state table. Validate every coordinator journal against its plan with Task 8's `validateCoordinatorJournalForPlan`. The per-coordinator staging cap is unreachable by construction — every counted leaf first passes the aggregate check and both bounds are 1,000,000 — so it is covered by pinning the counter at its exact ceiling rather than by a discriminating case.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/ledger.ts packages/core/src/lifecycle/ledger.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts packages/core/src/lifecycle/types.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): classify lifecycle journal closure fail-closed"
```

### Task 13: Absent-manifest product-home inspection · M

Source: old Task 4 (`inspectAbsentManifestBootstrap`), without the recovery epoch or any ID path (A3). Spec 1 §6 absent-manifest paragraphs; §2.3 A2; A12; A13; §7 "absent-manifest uninstall is evidence-bound" with A8.

**Files:**
- Create: `packages/core/src/lifecycle/absent-manifest.ts`
- Create: `packages/core/src/lifecycle/absent-manifest.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 2 `inspectLifecycleBookkeepingShape`, `LifecycleBookkeepingResidueV1`; Task 10 port and in-memory port; `hashCanonicalJson`.
- Produces:

```ts
export type AbsentManifestShapeV1 = "product_home_absent" | "product_home_empty" | "state_empty" | "state_key_only";
export interface AbsentManifestEvidenceV1 extends LifecycleBookkeepingResidueV1 {
  /** Every persisted bootstrap lock identity of every retained envelope. */
  readonly bootstrapIdentities: readonly { readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 }[];
  /** Spec 2 §6.4: any active or ambiguous residue. */
  readonly activeOrAmbiguous: boolean;
}
export interface AbsentManifestInspectionV1 {
  readonly shape: AbsentManifestShapeV1;
  readonly key: LifecycleGuardedEntryV1 | null;
  readonly bootstrapLeaf: LifecycleGuardedEntryV1 | null;
  readonly walkFingerprint: LowerHexSha256;
  readonly visitedEntries: number;
}
export const ABSENT_MANIFEST_WALK_BOUNDS: { readonly entries: 1_000_000; readonly components: 128; readonly pathBytes: 4096 };
export async function inspectAbsentManifestProductHome(dependencies: {
  readonly fs: LifecycleGuardedFileSystemV1; readonly effectiveUid: number;
  readonly productHome: CanonicalAbsolutePathV1; readonly userHome: CanonicalAbsolutePathV1;
  readonly evidence: AbsentManifestEvidenceV1;
}): Promise<AbsentManifestInspectionV1>;
```

- [x] **Step 1: Write failing walk and shape tests**

```ts
it.each(["product_home_absent", "product_home_empty", "state_empty", "state_key_only"] as const)(
  "admits %s with the bootstrap leaf, inert evidence and the bookkeeping set projected away", async (shape) => {
    const home = memoryHome(shape, { bootstrapLeaf: true, inertEvidence: true, bookkeeping: "all" });
    const inspection = await inspectAbsentManifestProductHome(home.dependencies);
    expect(inspection.shape).toBe(shape);
    expect(home.fs.readsOfContent).toStrictEqual([]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

it("refuses a leaf whose identity a retained envelope persisted", async () => {
  const home = memoryHome("state_empty", { bootstrapLeaf: "attributed" });
  await expect(inspectAbsentManifestProductHome(home.dependencies)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
});

it.each([
  ["entries", 1_000_000, "admitted"], ["entries", 1_000_001, "refused"],
  ["components", 128, "admitted"], ["components", 129, "refused"],
  ["pathBytes", 4096, "admitted"], ["pathBytes", 4097, "refused"],
] as const)("walks the %s bound at %i through the production path (A8)", async (dimension, value, outcome) => {
  const home = memoryHomeAtBound(dimension, value);
  const run = inspectAbsentManifestProductHome(home.dependencies);
  if (outcome === "admitted") await expect(run).resolves.toBeDefined();
  else await expect(run).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
});
```

For the bound cases, the admitted fixtures name every extra entry in `retainedPaths` so each projects on its own path; the over-limit case needs no evidence at all, because the walk refuses on the entry counter before any projection. Projection is indexed — an ancestor-prefix set and a parent→children index built once — so a populated home cannot spend minutes refusing (`apps/cli/src/commands/uninstall.test.ts:636-642` records the same mistake being paid for once already). Cover: the in-memory and Node ports agree on a small physical home (A8); every other known or unknown file or directory refuses and names its path — `config.toml`, `state/lifecycle-activation.json`, `state/git-sync.json`, `state/uninstalling.json`, a status, a log slot, a lease, `installation-manifest.json`, `.installation-manifest.<id>.json.tombstone`, `state/lifecycle-install-nonce`, `state/lifecycle-id-allocator.json`, a legacy `tx_<uuid>.json` in `state/transactions`, an unrecognized empty directory, `logs/`; any of the four `<userHome>/Library/LaunchAgents/com.developer-os.<job>.plist` paths present refuses; `activeOrAmbiguous: true` refuses; a symlink, hard-linked file, FIFO, foreign-owned directory, invalid UTF-8 name, or an entry appearing or disappearing between the two directory reads refuses before any content read; the key is recorded by `lstat` only, and a key that is a symlink, directory or `nlink` 2 file refuses; the lock `state/.lifecycle.lock` a rolled-back first `init` leaves is admitted; two walks of an unchanged home give equal `walkFingerprint`; the module performs no write and no process spawn (the port records none).

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/absent-manifest.test.ts`

Expected: FAIL — `absent-manifest.ts` does not exist.

- [x] **Step 3: Implement**

Rules: one bounded no-follow walk from the product home's parent-guarded entry, counting every entry visited, including those it then projects away. `retainedPaths` projects **path by path, never as a subtree mute**: the producer emits every descendant (`apps/cli/src/bootstrap/report.ts:1342`), a separate field carries the maximal roots, and prefix semantics would let an entry the evidence never named hide under a retained directory — which §6's “exhaustive root inventory, rather than a checklist of selected known paths” exists to prevent. `projectSubtree` therefore stops descending wherever `bookkeeping.ts` stopped. `state` is never projected by any rule, because the four shapes are distinguished by whether it exists. Projection order: the exact bootstrap leaf at `state/.lifecycle-bootstrap.lock` (an owner `0600` zero-byte single-link file whose `dev`/`ino` equal no `bootstrapIdentities` entry); every path in `retainedPaths`, and non-empty directories that exist only to hold them; every bookkeeping path `inspectLifecycleBookkeepingShape` admits. The remainder must equal one of the four shapes exactly. `walkFingerprint` is `hashCanonicalJson("developer-os:absent-manifest-walk:v1", entries)` over every visited entry's relative path, kind, owner, mode, `nlink`, size, `dev` and `ino`, sorted by unsigned UTF-8 path bytes. No key byte is read.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/absent-manifest.ts packages/core/src/lifecycle/absent-manifest.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts tests/repository/check.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): inspect an absent-manifest product home against its closed shapes"
```

### Task 14: Feasible plan and journal publication · M

Source: old Task 5. Spec 1 §2.4 feasibility (`maximumJournalBytes`), reservation before ID block, coordinator creation order, initial and rewrite temps.

**Files:**
- Create: `packages/core/src/lifecycle/store.ts`
- Create: `packages/core/src/lifecycle/store.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8 (`lifecycleReservationOrder`), 10 (port, `reserveLifecycleIdBlock`), 11, 12 (`LifecycleLedgerSnapshotV1`); `encodeFoundationJournalJsonV1`, `FileMutation`.
- Produces:

```ts
export interface LifecycleLeafReservationV1 {
  readonly foundationJournals: number; readonly coordinatorJournals: number; readonly gitEffectJournals: number;
  readonly launchdEffectJournals: number; readonly foundationStaging: number; readonly foundationBackups: number;
  readonly lifecycleStaging: number;
}
export function longestLegalAllocatedId(prefix: LifecycleIdPrefixV1): string; // `${prefix}_${"f".repeat(64)}_18446744073709551615`
export function maximumCoordinatorJournalBytes(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>): number;
export function maximumFoundationJournalBytes(input: { readonly id: string; readonly kind: string; readonly mutations: readonly FileMutation[] }): number;
export function standaloneFoundationLeafReservation(mutations: readonly { readonly operation: "create" | "replace" | "remove" }[]): LifecycleLeafReservationV1;
export function assertLifecycleCapacity(snapshot: LifecycleLedgerSnapshotV1<unknown>, reservation: LifecycleLeafReservationV1): void;
export interface LifecycleExecutionBuilderV1<TPlan> {
  readonly slotCount: number;
  build(ids: readonly string[]): { readonly plan: TPlan; readonly reservation: LifecycleLeafReservationV1 };
}
export function assertLifecycleExecutionFeasible<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>>(
  builder: LifecycleExecutionBuilderV1<TPlan>, snapshot: LifecycleLedgerSnapshotV1<TPlan>, codec: LifecycleValueCodec<TPlan>,
): void;
export type LifecycleStoreBoundaryV1 = "staging_directory_created" | "plan_temp_written" | "plan_published" | "plan_parent_synced"
  | "coordinator_lock_created" | "journal_temp_written" | "journal_published" | "journal_parent_synced" | "rewrite_temp_written" | "rewrite_renamed";
export class LifecycleCoordinatorStore<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>> {
  constructor(dependencies: {
    readonly fs: LifecycleGuardedFileSystemV1; readonly roots: LifecycleLedgerRootsV1;
    readonly executionPlanCodec: LifecycleValueCodec<TPlan>; readonly coordinatorJournalCodec: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
    readonly uuid: () => string; readonly clock: () => UtcTimestampV1;
    readonly locks: TransactionLockProvider; readonly afterBoundary?: (boundary: LifecycleStoreBoundaryV1) => void | Promise<void>;
  });
  ensureStagingDirectory(id: LifecycleCoordinatorIdV1, global: HeldLifecycleStableLockV1): Promise<LifecycleGuardedEntryV1>;
  publish(plan: TPlan, global: HeldLifecycleStableLockV1): Promise<LifecycleCoordinatorJournalV1>;
  read(id: LifecycleCoordinatorIdV1): Promise<{ readonly plan: TPlan; readonly journal: LifecycleCoordinatorJournalV1 | null }>;
  rewriteJournal(plan: TPlan, current: LifecycleCoordinatorJournalV1, next: LifecycleCoordinatorJournalV1, global: HeldLifecycleStableLockV1): Promise<void>;
}
```

- [x] **Step 1: Write failing feasibility and publication tests**

```ts
it("refuses an infeasible journal maximum before the allocator moves", async () => {
  const home = await memoryLifecycleHome();
  expect(() => assertLifecycleExecutionFeasible(oversizedSyntheticBuilder(), home.snapshot, CODEC))
    .toThrow(expect.objectContaining({ reason: "journal_too_large" }));
  expect((await inspectLifecycleAllocator(home.fs, home.state, UID, [])).allocator.nextCounter).toBe("0");
});

it("publishes the immutable plan before its lock and the lock before the planned journal", async () => {
  const events: LifecycleStoreBoundaryV1[] = [];
  const store = storeFor(await memoryLifecycleHome(), (boundary) => { events.push(boundary); });
  await store.publish(syntheticUninstallPlan(), HELD);
  expect(events).toStrictEqual([
    "plan_temp_written", "plan_published", "plan_parent_synced",
    "coordinator_lock_created", "journal_temp_written", "journal_published", "journal_parent_synced",
  ]);
});
```

Cover: the conservative maximum uses `longestLegalAllocatedId` for every slot, every phase, both auxiliary cursors at their widest, a non-null push hash where the variant allows it, and fixed-width `UtcTimestampV1`; the exact maximum recomputed from real IDs equals `plan.maximumJournalBytes`, otherwise the plan refuses; a coordinator or Foundation maximum above 1,048,576 or a plan above 16,777,216 bytes refuses before reservation; `assertLifecycleCapacity` refuses when any current count plus reservation exceeds its `LIFECYCLE_LEDGER_BOUNDS` cap, and never when it equals it; `standaloneFoundationLeafReservation` counts journal, stable lock and rewrite temp in `state/transactions`, the ID directory plus `<i>.bin`, `<i>.bin.sha256` and one temp per non-remove mutation in staging, and the ID directory plus `<i>.bin`, `<i>.bin.tmp`, `<i>.json`, `<i>.json.sha256`, `<i>.json.tmp` per replace or remove mutation in backups; death at each `LifecycleStoreBoundaryV1` leaves a state Task 12 classifies as a legal non-clear orphan (plan temp only, plan only, plan plus lock, journal temp) and never a lock-only envelope; a no-replace collision at the plan or journal leaf preserves both and refuses; a rewrite temp larger than `plan.maximumJournalBytes` refuses before rename; `rewriteJournal` refuses when `current` differs from the bytes on disk; `ensureStagingDirectory` creates `staging/lifecycle` only if absent, owner `0700`, and refuses a mis-shaped existing one.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/store.test.ts`

Expected: FAIL — `store.ts` does not exist.

- [x] **Step 3: Implement**

`lifecycleReservationOrder` derives prefixes from a plan while `LifecycleExecutionBuilderV1` exposes only `slotCount`, so the conservative pass cannot hand prefix-correct IDs to a builder that has not built yet. Resolved by contract: `assertLifecycleExecutionFeasible` calls `build` once with `slotCount` **distinct** placeholder IDs of the widest legal width, and that conservative plan is measured only — never validated, never published. Distinctness is load-bearing, because identical placeholders collapse `lifecycleReservationOrder`'s `byId` map and make it fail on the second Foundation step. **Task 18's `build(ids)` must bind by position, not re-derive a prefix**, and `assertLifecycleExecutionFeasible` refuses `reservation_slot_count` when `lifecycleReservationOrder(plan).length` disagrees with `builder.slotCount`.

The coordinator lock `.<id>.lock` in `state/lifecycle-journals` is created with the injected `TransactionLockProvider` only after the plan is durable, so a lock-only coordinator envelope is unreachable. Plan temp `.<id>.<lowercase-v4-uuid>.plan.json.tmp`; journal temp `.<id>.<lowercase-v4-uuid>.json.tmp`; both `writeExclusive` then `renameNoReplace` (first publication) or `renameOver` (rewrite), then `syncDirectory`. The store never allocates: callers reserve the block with Task 10 only after `assertLifecycleExecutionFeasible` passes.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/store.ts packages/core/src/lifecycle/store.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): publish feasible lifecycle plans and journals before intent"
```

### Task 15: Foundation participants and terminal Foundation compaction · L

Source: old Task 6. Spec 1 §2.4 Foundation participant first-write rule, paired inverse staging, `FoundationTerminalCompactionV1`, planless-orphan and lock-only cleanup; §7 "terminal collection stays bounded" (Foundation clauses).

**Files:**
- Modify: `packages/core/src/transactions/executor.ts` — add `admitLifecycleFoundationInitialJournal` and `TransactionExecutor.executeLifecycleFoundationParticipant`, modelled on `admitBootstrapFoundationInitialJournal` and `executeBootstrapFoundationParticipant`
- Modify: `packages/core/src/transactions/index.ts`
- Test: `packages/core/src/transactions/transactions.test.ts`
- Create: `packages/core/src/lifecycle/foundation-participant.ts`, `packages/core/src/lifecycle/foundation-participant.test.ts`
- Create: `packages/core/src/lifecycle/foundation-compaction.ts`, `packages/core/src/lifecycle/foundation-compaction.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts` — `surveyTransactions` skips a journal compacted between listing and read
- Test: `apps/cli/src/commands/doctor.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 10, 11; shipped `TransactionExecutor`, `TransactionStore`, `encodeFoundationJournalJsonV1`, `PublishBootstrapInitialJournalNoReplace`.
- Produces:

```ts
// transactions/executor.ts
export interface AdmittedLifecycleFoundationInitialJournalV1 { readonly [admittedLifecycleFoundationInitialJournal]: true }
export function admitLifecycleFoundationInitialJournal(context: {
  readonly ref: FoundationParticipantRefV1; readonly ownerUid: number; readonly initialJournal: TransactionJournalV1;
  readonly sourceParent: BootstrapInitialJournalPublicationV1["sourceParent"]; readonly destinationParent: BootstrapInitialJournalPublicationV1["destinationParent"];
}): AdmittedLifecycleFoundationInitialJournalV1;
// TransactionExecutor
executeLifecycleFoundationParticipant(admitted: AdmittedLifecycleFoundationInitialJournalV1): Promise<TransactionJournalV1>;

// lifecycle/foundation-participant.ts
export interface FoundationParticipantMutationInputV1 {
  readonly targetPath: CanonicalAbsolutePathV1; readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: LowerHexSha256 | null; readonly content: Uint8Array | null; // ≤ 16,777,216 bytes
}
export interface FoundationParticipantStageInputV1 {
  readonly coordinatorId: LifecycleCoordinatorIdV1; readonly id: FoundationTransactionIdV1; readonly slot: FoundationParticipantSlotV1;
  readonly role: FoundationParticipantRefV1["role"]; readonly createdAt: UtcTimestampV1;
  readonly mutations: readonly FoundationParticipantMutationInputV1[];
}
export type FoundationParticipantStateV1 = "future" | "staged" | TransactionPhase;
export class FoundationParticipantExecutor {
  constructor(dependencies: {
    readonly fs: LifecycleGuardedFileSystemV1; readonly roots: LifecycleLedgerRootsV1; readonly executor: TransactionExecutor;
    readonly effectiveUid: number; readonly afterBoundary?: (boundary: string) => void | Promise<void>;
  });
  /** Journal kind is `lifecycle.<slot>` for a forward ref and `lifecycle.<slot>.compensation` for its inverse. */
  stage(input: FoundationParticipantStageInputV1): Promise<FoundationParticipantRefV1>;
  apply(ref: FoundationParticipantRefV1): Promise<TransactionJournalV1>;
  observe(ref: FoundationParticipantRefV1): Promise<FoundationParticipantStateV1>;
  discardUnstarted(ref: FoundationParticipantRefV1): Promise<void>;
}

// lifecycle/foundation-compaction.ts
export function deriveFoundationTerminalCompaction(journal: TransactionJournalV1): FoundationTerminalCompactionV1;
export async function compactTerminalFoundationTransaction(dependencies: {
  readonly fs: LifecycleGuardedFileSystemV1; readonly roots: LifecycleLedgerRootsV1; readonly store: TransactionStore;
  readonly global: HeldLifecycleStableLockV1; readonly afterBoundary?: (boundary: string) => void | Promise<void>;
}, compaction: FoundationTerminalCompactionV1): Promise<void>;
export async function removeFoundationOrphan(dependencies: Parameters<typeof compactTerminalFoundationTransaction>[0], orphan: FoundationLedgerOrphanV1): Promise<void>;
```

- [x] **Step 1: Write failing participant and compaction tests**

```ts
it("resumes a first journal that died after publication from its pre-recorded staged inode", async () => {
  const home = await nodeLifecycleHome();
  const ref = await home.participants.stage(forwardMarkerInput());
  await expect(home.participantsDyingAt("initial_journal_published").apply(ref)).rejects.toThrow(SyntheticDeath);
  expect(await home.participants.observe(ref)).toBe("planned");
  expect((await home.participants.apply(ref)).phase).toBe("finalized");
});

it("refuses a byte-identical final journal with a different inode", async () => {
  const home = await nodeLifecycleHome();
  const ref = await home.participants.stage(forwardMarkerInput());
  await plantByteIdenticalFinalJournal(home, ref);
  await expect(home.participants.apply(ref)).rejects.toBeInstanceOf(TransactionStateError);
});

it("compacts a terminal standalone transaction to nothing but refuses an unknown child", async () => {
  const home = await nodeLifecycleHome();
  const journal = await home.standaloneReplace("config.toml");
  await compactTerminalFoundationTransaction(home.compaction, deriveFoundationTerminalCompaction(journal));
  expect(await home.leavesOf(journal.id)).toStrictEqual([]);
  const second = await home.standaloneReplace("config.toml");
  await plant(home.stagingOf(second.id), "unknown.bin");
  await expect(compactTerminalFoundationTransaction(home.compaction, deriveFoundationTerminalCompaction(second))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
});
```

Cover: `stage` writes `staging/transactions/<id>/<i>.bin` and `<i>.bin.sha256` exactly as the unchanged `writeStaged` would, then the initial journal at `staging/lifecycle/<coordinator-id>/foundation/<id>/journal.json` in `FoundationJournalJsonV1` bytes; the returned ref's `planHash`, `plannedBytesHash`, `stagedIdentity` and exact `maximumJournalBytes` recompute; content over 16,777,216 bytes refuses before any write; a compensation input whose preimage bytes differ from the forward's `expectedBeforeHash` refuses; the forward may finalize and prune its backups while its inverse keeps independent preimage bytes; staged and final both absent, both present, or a mismatched identity at `apply` is exit 6; `discardUnstarted` removes only the still-staged initial journal and exact blobs after proving the final journal absent and every target at its preimage; `observe` distinguishes `future` (nothing staged), `staged`, and every journal phase; compaction enumerates only journal-derived names, treats a missing expected file as done, `rmdir`s only exact empty ID directories, unlinks the journal and then the held stable lock by exact inode, syncs each parent, and leaves `tx_fi_…` and `tx_mm_…` bootstrap residue untouched; death before and after every unlink resumes from the terminal journal, or from a removable lock-only orphan; `removeFoundationOrphan` removes a planless orphan only under the exact grammar Task 11 admitted, and never a backup member; 1,000 consecutive standalone transactions, each followed by compaction, leave `state/transactions` holding at most one stable lock between iterations (real filesystem); in `doctor.test.ts`, a journal removed between `listTransactionIds` and `transactions.read` is skipped rather than reported as an error.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/transactions/transactions.test.ts src/lifecycle/foundation-participant.test.ts src/lifecycle/foundation-compaction.test.ts`

Run: `npx vitest run --root apps/cli src/commands/doctor.test.ts`

Expected: FAIL — the new functions and modules do not exist; `doctor` throws on a compacted journal.

- [x] **Step 3: Implement**

Do not replace the Foundation serializer, the standalone `execute` path, or the manifest's direct-write exception. The lifecycle first-write bridge takes the participant's stable ID lock, then either re-verifies an existing final journal or `renameNoReplace`s the staged inode to `state/transactions/<id>.json`, syncs, reopens, requires the same inode and exact planned bytes, and only then calls the unchanged `resume`. No participant step ever unlinks a coordinator or participant plan. Compaction runs only under the held global lock.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/transactions/transactions.test.ts src/lifecycle src/index.test.ts`

Run: `npx vitest run --root apps/cli src/commands/doctor.test.ts src/commands/status.test.ts src/commands/repair.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add tests/repository/check.ts packages/core/src/transactions/executor.ts packages/core/src/transactions/index.ts packages/core/src/transactions/transactions.test.ts packages/core/src/lifecycle/foundation-participant.ts packages/core/src/lifecycle/foundation-participant.test.ts packages/core/src/lifecycle/foundation-compaction.ts packages/core/src/lifecycle/foundation-compaction.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): coordinate Foundation participants and compact terminal Foundation transactions"
```

### Task 16: Coordinator execution, compensation, recovery and terminal compaction · L

Corrections this task's implementation forced, recorded against the steps below:

- **The Cover list's `closure === "clear"` after a compacted uninstall is unreachable.** `coordinator_envelope` deliberately unlinks the allocator and the nonce, and `admitsControlFileAbsence` admits that absence only while the `compacting` envelope cursor is still on disk. Once the envelope is gone there is no coordinator, so `resolveAllocator` refuses `lifecycle_id_allocator_shape`. The tests assert the exact residue against the real `inspectLifecycleLedger` instead: `coordinators === []`, `coordinatorOrphans === []`, `foundation.journals.size === 0`, `findings === ["lifecycle_id_allocator_shape"]`, global lock present.
- **Two forced `Produces` additions.** `LifecycleCoordinatorDependenciesV1` gains `readonly fs: LifecycleGuardedFileSystemV1`, because the global-lock re-check and the `"staged"` disambiguation both need a guarded `lstat` from inside the engine. `compactTerminalCoordinator`'s dependency intersection gains `readonly foundationStore: TransactionStore`, because `compactTerminalFoundationTransaction` takes the shipped `TransactionStore` for `withTransactionLock` and `LifecycleCoordinatorStore` is not that store.
- **Two exports the `Produces` block does not name.** `LifecycleRecoveryRefusalError`, because `SafeReasonCodeV1` is `/^[a-z][a-z0-9_]*$/` and §2.4's recovery instructions cannot travel as a reason code; and `completeCoordinatorEnvelope`, because the envelope-suffix and pre-journal-orphan completions have no journal to carry a `compactionNext` cursor and so cannot go through `compactTerminalCoordinator`.
- **§2.4's unstarted-participant rule cannot be met for a counterfactual inverse.** `discardUnstarted` proves every mutation target at that ref's recorded preimage, but the inverse of a forward that never ran describes a post-forward world that never existed. `compactTerminalCoordinator` classifies each participant `executed` / `unstarted` / `counterfactual_inverse` and, for the third, removes the staged leaves derived from the immutable ref after proving **both** final journals absent.
- **`git_sync/existing_network`'s point of no return is unenforceable as the table words it.** "N(h) returns success" has no durable representation — a death between the push returning and the journal rewrite is byte-identical to a push that never ran. The implemented boundary is "the cursor advanced past `N`", and such a death rolls back and re-pushes. **Task 21 binds to this reading; it needs a founder decision at plan close.**
- **A non-terminal current Foundation journal fails closed rather than rolling back**, against §2.4's wording. Unreachable from this task's injection surface — deaths are injected at `afterBoundary`, which the engine emits outside every participant call — but reachable from Task 15's. Deliberate narrowing, not an oversight.

Carried from Task 15's review — three preconditions §2.4 states that `packages/core` structurally cannot discharge at the interfaces this plan fixed, so Task 16 owns each as a caller obligation:

1. `discardUnstarted(ref)` proves no lock; its Produces signature has no `global` member, so the coordinator must hold the global lock across every call.
2. `deriveFoundationTerminalCompaction` receives only a journal, so it cannot check §2.4's "not referenced by a non-terminal coordinator".
3. `removeFoundationOrphan`'s `rewrite_temp` arm cannot check the final journal's identity: the orphan is `{kind, id, temp}` and a re-scan under the lock returns the value under suspicion. The caller already holds `FoundationLedgerV1.journals.get(id).entry` from the scan that produced the orphan — after taking the stable lock and before calling, `lstat` the journal path and compare `dev`/`ino` against it. Do **not** widen `FoundationCompactionDependenciesV1`; the Produces block ties that type to `compactTerminalFoundationTransaction` through `Parameters<...>[0]`.

Also from that review: `FoundationParticipantStateV1 = "future" | "staged" | TransactionPhase` makes `observe` returning `"staged"` **ambiguous** between "initial journal staged, nothing published" and "published, journal phase is `staged`". A coordinator must not branch on it alone; `fs.lstat(ref.initialJournal.finalPath)` disambiguates, and `discardUnstarted` re-proves the final journal absent regardless, so a wrong branch refuses rather than destroys.

Source: old Task 7. Spec 1 §2.4 cursor/phase rules, point of no return, compensation reverse prefix, `push_pending`, orphan completion, `LifecycleTerminalCompactionV1` including the uninstall control-file suffix; §7 "composite state recovers" and "coordinator grammar is exact" (execution clauses). This task is the "coordinator recovery proven" half of the Phase 4 gate.

**Files:**
- Create: `packages/core/src/lifecycle/coordinator.ts`, `packages/core/src/lifecycle/coordinator.test.ts`
- Create: `packages/core/src/lifecycle/recovery.ts`, `packages/core/src/lifecycle/recovery.test.ts`
- Create: `packages/core/src/lifecycle/coordinator-compaction.ts`, `packages/core/src/lifecycle/coordinator-compaction.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8, 9, 10, 12, 14, 15.
- Produces:

```ts
export type LifecycleEffectStateV1 = "future" | "planned" | "applied" | "verified" | "finalized" | "compensating" | "rolled_back";
export interface LifecycleEffectAdapterV1 {
  apply(ref: LifecycleEffectRefV1<string>): Promise<void>;       // runs to verified
  finalize(ref: LifecycleEffectRefV1<string>): Promise<void>;
  compensate(ref: LifecycleEffectRefV1<string>): Promise<void>;  // runs to rolled_back
  observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1>;
  compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void>;
}
export interface LifecycleParticipantAdaptersV1<TPlan> {
  readonly foundation: FoundationParticipantExecutor;
  readonly manifest: null | {
    preserveBefore(plan: TPlan): Promise<void>; publishAfter(plan: TPlan): Promise<void>; commitAbsence(plan: TPlan): Promise<void>;
    finalizeTombstones(plan: TPlan): Promise<void>; compensate(plan: TPlan): Promise<void>;
    observe(plan: TPlan): Promise<"before" | "preimage_preserved" | "applied" | "compaction_pending">;
  };
  readonly redactionKey: null | {
    stage(plan: TPlan): Promise<void>; delete(plan: TPlan): Promise<void>; restore(plan: TPlan): Promise<void>;
    observe(plan: TPlan): Promise<"before" | "staged" | "deleted">;
  };
  readonly sourceGitEffect: LifecycleEffectAdapterV1 | null; readonly destinationGitEffect: LifecycleEffectAdapterV1 | null;
  readonly launchdBeforeFiles: LifecycleEffectAdapterV1 | null; readonly launchdAfterFiles: LifecycleEffectAdapterV1 | null;
  readonly networkPush: null | { push(plan: TPlan, pushPlanHash: LowerHexSha256): Promise<"succeeded" | "failed"> };
  /** Releases `global`, drains, reacquires; returns the reacquired handle. */
  readonly drainRunners: null | { drain(plan: TPlan, global: HeldLifecycleStableLockV1): Promise<HeldLifecycleStableLockV1> };
  readonly controlFiles: { removeAllocator(plan: TPlan): Promise<void>; removeNonce(plan: TPlan): Promise<void> };
  /**
   * Called before every forward application of `step`, on first execution and on recovery alike, and
   * after every return from it. `before` may release and reacquire `global` (it returns the handle to
   * use) and may refuse; `after` runs only once the step's participant has returned. Adapters that need
   * neither omit them.
   */
  readonly stepHooks?: {
    before(plan: TPlan, index: number, step: LifecycleCoordinatorStepV1, global: HeldLifecycleStableLockV1): Promise<HeldLifecycleStableLockV1>;
    after(plan: TPlan, index: number, step: LifecycleCoordinatorStepV1): Promise<void>;
  };
}
export type LifecycleCoordinatorBoundaryV1 =
  | { readonly kind: "journal_rewritten"; readonly phase: LifecycleCoordinatorPhaseV1; readonly nextStep: number }
  | { readonly kind: "participant_returned"; readonly step: number; readonly direction: "forward" | "compensation" }
  | { readonly kind: "compaction_entry_removed"; readonly index: number }
  | { readonly kind: "control_file_removed"; readonly file: "allocator" | "nonce" }
  | { readonly kind: "envelope_leaf_removed"; readonly leaf: "journal" | "lock" | "plan" };
export type LifecycleCoordinatorOutcomeV1 =
  | { readonly kind: "finalized"; readonly id: LifecycleCoordinatorIdV1 }
  | { readonly kind: "rolled_back"; readonly id: LifecycleCoordinatorIdV1; readonly cause: SafeReasonCodeV1 }
  | { readonly kind: "push_pending"; readonly id: LifecycleCoordinatorIdV1; readonly pushPlanHash: LowerHexSha256 };
export interface LifecycleCoordinatorDependenciesV1<TPlan> {
  readonly store: LifecycleCoordinatorStore<TPlan>; readonly adapters: LifecycleParticipantAdaptersV1<TPlan>;
  readonly variantFacts: (plan: TPlan) => LifecycleVariantFactsV1; readonly pushPlanHash: (plan: TPlan) => LowerHexSha256 | null;
  readonly clock: () => UtcTimestampV1; readonly afterBoundary?: (boundary: LifecycleCoordinatorBoundaryV1) => void | Promise<void>;
}
export class LifecycleCoordinator<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>> {
  constructor(dependencies: LifecycleCoordinatorDependenciesV1<TPlan>);
  execute(id: LifecycleCoordinatorIdV1, global: HeldLifecycleStableLockV1): Promise<{ readonly outcome: LifecycleCoordinatorOutcomeV1; readonly global: HeldLifecycleStableLockV1 }>;
}
export interface LifecycleRecoveryPolicyV1 {
  readonly resumeUninstall: boolean;
  /** The one non-terminal standalone Foundation journal the caller is explicitly resolving (`repair`); recovery leaves it untouched instead of refusing. */
  readonly standaloneFoundationId?: string;
}
export class LifecycleRecoveryService<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>> {
  constructor(dependencies: LifecycleCoordinatorDependenciesV1<TPlan> & {
    readonly fs: LifecycleGuardedFileSystemV1; readonly roots: LifecycleLedgerRootsV1; readonly foundationStore: TransactionStore;
    readonly inspect: () => Promise<LifecycleLedgerSnapshotV1<TPlan>>;
  });
  /** Resumes or compensates every non-terminal coordinator per its point of no return, completes legal orphans, compacts terminal coordinators and standalone Foundation transactions, and returns the recomputed snapshot. */
  recover(global: HeldLifecycleStableLockV1, policy: LifecycleRecoveryPolicyV1): Promise<{ readonly snapshot: LifecycleLedgerSnapshotV1<TPlan>; readonly global: HeldLifecycleStableLockV1 }>;
}
export async function compactTerminalCoordinator<TPlan extends LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>>(
  dependencies: LifecycleCoordinatorDependenciesV1<TPlan> & { readonly fs: LifecycleGuardedFileSystemV1; readonly roots: LifecycleLedgerRootsV1 },
  record: LifecycleCoordinatorRecordV1<TPlan>, global: HeldLifecycleStableLockV1,
): Promise<void>;
```

- [x] **Step 1: Write the failing exhaustive death-injection matrix**

```ts
const ROWS = Object.keys(LIFECYCLE_STEP_GRAMMAR) as LifecycleOperationVariantV1[];

it.each(ROWS)("recovers %s from death at every boundary to the direction its point of no return selects", async (variant) => {
  const boundaries = await enumerateBoundaries(variant); // runs once, records every afterBoundary call
  expect(boundaries.length).toBeGreaterThan(0);
  for (const boundary of boundaries) {
    const world = await syntheticWorld(variant);
    await expect(world.executeDyingAt(boundary)).rejects.toThrow(SyntheticDeath);
    const { snapshot } = await world.recovery().recover(world.global, { resumeUninstall: true });
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(world.effects.unjournaledMutations()).toStrictEqual([]);
    expect(world.effects.terminalState()).toStrictEqual(world.expectedAfter(boundary));
  }
});

it("compensates the exact reverse prefix before the point of no return", async () => {
  const world = await syntheticWorld("uninstall/present_manifest", { failAt: { kind: "manifest", transition: "commit_absence" } });
  expect((await world.execute()).outcome.kind).toBe("rolled_back");
  expect(world.effects.compensationOrder()).toStrictEqual(["M(preserve_before)^-1", "K(restore)", "F(uninstall_artifacts)^-1", "P^-1", "F(uninstall_marker)^-1"]);
});
```

`syntheticWorld` builds a real Task 14 store over the in-memory port, a synthetic plan for the variant, and synthetic adapters that record every effect with the journal state durable at that moment. `expectedAfter(boundary)` is written from the Spec 1 point-of-no-return table: before the boundary step durably crosses, recovery compensates to the preimage; at or after it, recovery force-forwards to the postimage.

Cover: the `planned` → first-step phase rewrite with death on both sides; an already `finalized` current pre-boundary Foundation journal advances the cursor and its paired inverse runs first on compensation, while an already `finalized` boundary `F(config)` is the durable forward crossing; a verified boundary effect (`S`, `D`, `Q`) finalizes before the cursor advances; a failed `N(h)`, or `D(h)` without a journal, sets `push_pending` with an unchanged cursor, and recovery with `resumeUninstall` retries only the bound push; a destination journal that exists is ordinary effect recovery, never `retry_only`; `compensating` resolves the current step's journal first; illegal third states (a participant journal earlier than its position, an unpaired compensation journal, a future participant's final journal) refuse exit 6 and change nothing; `R` releases and reacquires the global lock, and the reacquired handle is the one returned; the terminal compaction entry order and `compactionNext` advance one entry at a time, and death after each deletion but before the rewrite accepts that entry's exact absence; for `uninstall/present_manifest`, `coordinator_envelope` removes allocator, then nonce, then journal, then the held lock, then the plan, and the legal control-file microstates and plan-plus-lock and plan-only suffixes each complete on recovery without allocating; a non-uninstall coordinator never touches the control files; `recover` with `resumeUninstall: false` refuses a non-terminal uninstall coordinator with recovery `developer-os uninstall` and a non-terminal standalone Foundation journal with recovery `developer-os repair --resume <id>` or `--rollback <id>`, both exit 6, touching nothing; planless coordinator staging and a pre-journal plan orphan are removed only with every participant final journal absent; `recover` compacts every terminal standalone Foundation transaction and every terminal coordinator before returning; the global lock file is never removed.

Also cover:
- `recover(…, { resumeUninstall: false, standaloneFoundationId: id })` leaves that one non-terminal standalone journal untouched and returns, while a second non-terminal standalone journal still refuses exit 6.
- `uninstall/present_manifest_without_launchd` compensates in the order `M(preserve_before)^-1`, `K(restore)`, `F(uninstall_artifacts)^-1`, `F(uninstall_marker)^-1`.
- `stepHooks.before` is called before the first application of every step and again when recovery resumes a step that has not completed; the handle it returns is the one later steps receive; a refusal from it leaves the cursor unchanged; `after` is not called for a step that died.
- Overflow recovery through the in-memory port (A8), with every leaf a valid terminal standalone Foundation transaction:
  - exactly 10,000 leaves in `state/transactions` is not overflow; 10,001 enters overflow recovery and compacts the root below 10,000;
  - exactly 100,000 leaves in Foundation staging, and separately in backups, is not overflow; 100,001 compacts below 100,000;
  - after each compaction, `reserveLifecycleIdBlock(1)` succeeds, standing in for the mutation that now proceeds;
  - the 1,000,001st aggregate leaf refuses exit 6, deletes nothing, and leaves `nextCounter` unchanged, as does a single non-terminal or malformed transaction inside an otherwise compactable overflow.

- [x] **Step 2: Run the matrix and verify it fails**

Run: `npx vitest run --root packages/core src/lifecycle/coordinator.test.ts src/lifecycle/recovery.test.ts src/lifecycle/coordinator-compaction.test.ts`

Expected: FAIL — the modules do not exist.

- [x] **Step 3: Implement the table-driven engine**

Rules: drive only from the persisted plan and journal (never a preview); call `stepHooks.before` immediately before each forward participant call (first run or recovery) and `stepHooks.after` when it returns; persist the intended phase and cursor before each participant call and the participant's durable state before advancing, in one journal rewrite; decide direction only from `LIFECYCLE_POINT_OF_NO_RETURN` and the participant phases; dispatch only the closed step union through injected adapters. Core imports no Git, launchd, Security or CLI type.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/transactions/transactions.test.ts src/index.test.ts`

Expected: PASS, with a non-empty boundary list for each of the fourteen variants.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/coordinator.ts packages/core/src/lifecycle/coordinator.test.ts packages/core/src/lifecycle/recovery.ts packages/core/src/lifecycle/recovery.test.ts packages/core/src/lifecycle/coordinator-compaction.ts packages/core/src/lifecycle/coordinator-compaction.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): execute, recover and compact lifecycle coordinators"
```

### Task 17: Structural V2 home admission · M

Source: roadmap Phase 4 bullet "replace `admitV2Handoff` as Spec 1's gate with structural admission, with NEW-82" (A7). Spec 1 §2.1 "Admission of an installed V2 home"; §7 "V2 admission is structural"; Scope decisions 14 and 15.

**Files:**
- Create: `apps/cli/src/lifecycle/admission.ts`
- Create: `apps/cli/src/lifecycle/admission.v2.test.ts`
- Modify: `apps/cli/src/bootstrap/report.ts` — delete `admitV2Handoff`, `admitExactV2Handoff`, `incompleteHandoff`, `HANDOFF_SCHEMAS`, `lifecycleAllocatorNonce`; make `guardedFile` three-state (`absent`, `regular_file`, `other`) with every caller refusing `other`
- Modify: `apps/cli/src/bootstrap/report.test.ts` — remove `describe("admitV2Handoff")`; add the injectable `listNames` case
- Modify: `apps/cli/src/bootstrap/context.ts` — `createBootstrapEvidenceInspectionRequest` accepts optional `listNames`
- Modify: `apps/cli/src/commands/uninstall.ts` — export `manifestAdmissionFor` (Tasks 17–23 reuse it)
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Task 1 layout; Task 4 `parseLifecycleActivationRecord`, `SCHEDULED_JOB_IDS`; Task 6 `parseLifecycleInstallNonce`, `parseLifecycleIdAllocator`; Task 10 port and `LifecycleRecoveryRequiredError`; shipped `validateManifestV2`, `inspectDrift`, `ManifestAdmissionContextV1`, `ManifestV1RefusalError`.
- Produces:

```ts
export type ManifestSchemaObservationV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "v1" }
  | { readonly kind: "v2"; readonly entry: LifecycleGuardedEntryV1; readonly bytes: Uint8Array };
export type V2HomeAdmissionReasonV1 = "manifest_absent" | "manifest_v1_not_migratable" | "manifest_invalid"
  | "reservations_incomplete" | "nonce_invalid" | "allocator_invalid" | "nonce_allocator_mismatch"
  | "global_lock_invalid" | "journal_root_invalid";
export class V2HomeAdmissionError extends Error {
  readonly code: ExitCode; // manifest_absent → 2; manifest_v1_not_migratable → 4; every other reason → 6
  readonly reason: V2HomeAdmissionReasonV1; readonly paths: readonly string[];
}
export interface AdmittedV2HomeV1 {
  readonly manifest: InstallationManifestV2; readonly nonce: LifecycleInstallNonceV1; readonly allocator: LifecycleIdAllocatorV1;
  readonly globalLock: LifecycleGuardedEntryV1;
  readonly journalRoots: readonly [LifecycleGuardedEntryV1, LifecycleGuardedEntryV1, LifecycleGuardedEntryV1];
}
/** Spec 1 §2.1's table rows plus nonce and allocator, relative to the product home. */
export const LIFECYCLE_RESERVATION_ROWS: readonly { readonly path: string; readonly kind: "file"; readonly mode: "ephemeral" | "content" | "schema" }[];
export async function observeManifestSchema(fs: LifecycleGuardedFileSystemV1, paths: RuntimePaths): Promise<ManifestSchemaObservationV1>;
/** Three-state: a non-regular entry at the path throws LifecycleRecoveryRequiredError("activation_record_invalid"), never "absent". */
export async function observeLifecycleActivationRecord(fs: LifecycleGuardedFileSystemV1, paths: RuntimePaths):
  Promise<{ readonly state: "absent" } | { readonly state: "present"; readonly record: LifecycleActivationRecordV1 }>;
export function assertCompleteLifecycleReservations(manifest: InstallationManifestV2, productHome: string): void;
export async function admitInstalledV2Home(input: {
  readonly fs: LifecycleGuardedFileSystemV1; readonly paths: RuntimePaths;
  readonly manifestAdmission: ManifestAdmissionContextV1; readonly effectiveUid: number;
}): Promise<AdmittedV2HomeV1>;
```

- [x] **Step 1: Move and sharpen the handoff tests into structural admission tests**

```ts
it("admits a fresh V2 home and binds to no bootstrap plan, drift or retained evidence", async () => {
  const fixture = await sharedInitializedV2Fixture();
  await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
  await withDriftedBundleFile(fixture, async () => {
    await withEveryRetainedTombstoneAltered(fixture, async () => {
      await expect(admit(fixture)).resolves.toMatchObject({ manifest: { schemaVersion: 2 } });
    });
  });
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("keeps the Spec 2 §6.4 handoff set as a fact of a fresh init", async () => {
  const fixture = await sharedInitializedV2Fixture();
  const admitted = await admit(fixture);
  expect(await inspectDrift(driftRequestFor(fixture, admitted.manifest))).toStrictEqual([]);
  expect(admitted.allocator.nextCounter).toBe("0");
  expect(await observeLifecycleActivationRecord(fixture.lifecyclePort, fixture.paths)).toStrictEqual({ state: "absent" });
  for (const name of ["update-rollback.json", "update-executor.json"]) {
    expect((await nodeFs.lstat(join(fixture.paths.stateDir, name))).size).toBe(0);
  }
  expect(await nodeFs.readdir(join(fixture.paths.home, "rollback"))).toStrictEqual([]);
  for (const root of ["lifecycle-journals", "git-effect-journals", "launchd-effect-journals"]) {
    expect(await nodeFs.readdir(join(fixture.paths.stateDir, root))).toStrictEqual([]);
  }
}, REAL_FILESYSTEM_TIMEOUT_MS);

it.each([
  ["state/lifecycle-install-nonce", "nonce_invalid"],
  ["state/lifecycle-id-allocator.json", "allocator_invalid"],
  ["state/.lifecycle.lock", "global_lock_invalid"],
  ["installation-manifest.json", "manifest_invalid"],
] as const)("refuses a directory at %s as %s instead of treating it as absent (NEW-82)", async (relative, reason) => {
  const fixture = await sharedInitializedV2Fixture();
  await withDirectoryAt(fixture, relative, async () => {
    await expect(admit(fixture)).rejects.toMatchObject({ reason, code: EXIT_CODES.recoveryRequired });
  });
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("lets a programming error escape instead of relabelling it (NEW-82)", async () => {
  const fixture = await sharedInitializedV2Fixture();
  await expect(admitInstalledV2Home({ ...inputFor(fixture), fs: throwingPort(new TypeError("synthetic")) })).rejects.toBeInstanceOf(TypeError);
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

Test-local helpers: `sharedInitializedV2Fixture()` initialises one V2 home per file (memoised promise); `admit(fixture)` calls `admitInstalledV2Home` with `createNodeLifecycleGuardedFileSystem`, `manifestAdmissionFor(fixture.paths, [])` and the process uid; each `with…` helper applies one change and restores it in `finally`. The file therefore costs one real `init` plus the V1 case's capability-less `init`.

Cover also:
- A V1 manifest refuses `manifest_v1_not_migratable` exit 4, and `failureFrom` publishes kind `manifest_v1_not_migratable`. Manifest absent refuses `manifest_absent` exit 2.
- Each missing member refuses with its own reason, never one catch-all: nonce, allocator, lock, and each journal root.
- An allocator bound to another nonce refuses `nonce_allocator_mismatch`; an allocator at counter `7` admits.
- NEW-82, completeness rather than the hash: a manifest rewritten without one reservation row refuses `reservations_incomplete`, and so does a reservation row with the wrong mode.
- NEW-82's activation case, carried from the deleted handoff test: a directory at `state/lifecycle-activation.json` makes `observeLifecycleActivationRecord` throw `activation_record_invalid` rather than report `absent`; a non-canonical activation file refuses the same way.
- A missing schema file, a drifted bundle file, a missing or altered retained tombstone, and a planted plan under `state/lifecycle-journals` all still admit.
- `LIFECYCLE_RESERVATION_ROWS` has exactly 52 entries (2 + 4 × 2 + 4 × 10 + nonce + allocator) and is non-empty.
- NEW-82: `createBootstrapEvidenceInspectionRequest({ …, listNames })` makes plan-envelope enumeration use the injected function; this case lives in `report.test.ts` and performs no `init`.
- A7: `runStatus` and `runDoctorReport` succeed (`ok: true`) on the shared V2 home while it carries a drifted artifact and a planted lifecycle plan orphan that makes closure `lifecycle_recovery_required`.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/admission.v2.test.ts src/bootstrap/report.test.ts -t 'admits|refuses|handoff set|programming error|listNames|status and doctor'`

Expected: FAIL — `admission.ts` does not exist and `listNames` is not accepted.

- [x] **Step 3: Implement admission**

Rules: `observeManifestSchema` reads the manifest through `fs.lstat`/`fs.readRegular` (64 MiB bound); a non-regular entry is `manifest_invalid`; declared `schemaVersion` 1 is `v1`, 2 is `v2`, anything else `manifest_invalid`. `admitInstalledV2Home` requires `validateManifestV2` to pass with the confined `manifestAdmission`, then `assertCompleteLifecycleReservations`, then an exact nonce (Task 6), a canonical allocator whose nonce agrees, an owner `0600` zero-byte single-link lock, and three owner `0700` journal-root directories. It reads no bootstrap plan, no drift, no activation record and no closure. Only `V2HomeAdmissionError` is thrown for a refusal; other errors propagate unchanged.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/admission.v2.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'listNames|inspectBootstrapEvidence'`

Expected: PASS. Add `admission.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 5: Gate, commit, push**

**NEW-82 stays open** — the original step said to remove it and that was wrong. Task 17 closes it in `apps/cli/src/lifecycle/admission.ts`, which reaches the filesystem through the guarded port, but **not** in `assertOrdinaryCommandAdmitted`, the only path a production command takes: `inventoryExactNamespaces` routes a directory at `installation-manifest.json` to its direct-namespace branch, which records children only, so the leaf still reports absent and an installed home refuses exit 6 with the archive guidance instead. The symlink half is closed. `apps/cli/src/bootstrap/report.test.ts` carries the open half as an `it.fails` expectation. The minimal fix is one line in `apps/cli/src/bootstrap/context.ts`, but it adds the root to every namespace caller's inventory and so changes shipped bootstrap-admission semantics under `executor.test.ts` and e2e — route it with those suites runnable. Tick, update the progress sentence, run `npm run lint` and `npx vitest run --root tests repository/citations.test.ts`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/admission.ts apps/cli/src/lifecycle/admission.v2.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/bootstrap/context.ts apps/cli/src/commands/uninstall.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git diff --cached --name-only
git commit -m "feat(cli): admit installed V2 homes structurally"
```

### Task 18: Concrete execution-plan codec and the lifecycle composition root · M

Corrections this task's implementation forced, recorded against the steps below. Tasks 19–24 bind
to these, not to the `Produces` block as written:

- **Three exports the `Produces` block does not name.** `createLifecycleExecutionCodecs`, because
  `codecs(key)` must return the coordinator-journal codec as well as the plan codec and both come
  out of one `createLifecycleCodecs` call — `createLifecycleExecutionPlanCodec` is now a wrapper
  over it at the plan's exact signature; `manifestBeforeHashOf`, D34's accessor, which the
  `Produces` block gives no home although `inspectLedger` requires it; and
  `REDACTION_KEY_STATE_PLAN_HASH_DOMAIN`, deliberately not a member of `LIFECYCLE_HASH_DOMAINS`.
- **`residueFrom` takes a structural `LifecycleResidueEvidenceV1`**, not the whole
  `BootstrapEvidenceAdmissionV1`. A real admission is assignable, pinned by a test that passes
  `inspectBootstrapEvidenceAdmission`'s output straight in, so Task 19's step 4 still compiles. It
  collects `retainedPaths`, the full descendant set, not the collapsed `retainedRoots`, because
  `bookkeeping.ts` needs both exact membership and ancestor detection.
- **`LifecycleUnsupportedLeafError` publishes the reason code `lifecycle_unsupported_leaf`, not
  `unsupported_until_plan_1b`**, because `failureFrom`'s `kindOf` reads `error.name`. The intended
  reason is on `.reason`, and the class carries an added `arm` naming which arm refused. Scope
  decision 1 and the "No external effects" constraint both word the refusal as
  `unsupported_until_plan_1b`; the deferred fix list under Task 25 owns the reconciliation.
- **`lifecycleVariantFacts` derives `uninstallLaunchdEvidence` from the operation, not from
  `plan.participants.launchd !== null`** as the `Produces` doc comment suggests: with
  `TLaunchd = never` that field is typed `null` and `no-unnecessary-condition` rejects the
  comparison. Same value — a non-null launchd leaf refuses in the leaf codec first.
- **Task 14's precondition 1 is discharged on the store's own codec, not on the shared `validate`.**
  In `validate` the ledger would report a grammar fault as `lifecycle_coordinator_plan_bytes` where
  it must report `lifecycle_coordinator_plan_grammar`, because `ledger.ts` catches plan-codec
  throws before its own grammar check. Knock-on, and a change of behaviour Task 19's preflight sits
  on top of: `LifecycleCoordinatorStore.read` also calls `encode`, so a grammar-invalid *persisted*
  plan now throws out of `read` instead of refusing `lifecycle_coordinator_plan_bytes`.
- **`createProductionContext` builds `lifecycle` only when `paths.home` parses as a
  `CanonicalAbsolutePathV1`**; otherwise the optional field stays `undefined`. Without the guard a
  macOS home with a decomposed (NFD) user name throws out of the composition root and kills
  `doctor`, `status` and every V1 command before any verb runs. **Task 19 owns the consequence**: a
  home that looks V2 while `context.lifecycle` is `undefined` must refuse fail-closed.
- **The Step 1 sketch's five-arm loop over one `SYNTHETIC_1B_LEAF` is not implementable.** Core's
  `bindEffectArm` runs inside `validate`, so an effect arm planted without its matching step fails
  as a malformed plan with a plain `Error`, and Git arms need `ge_…` IDs where launchd arms need
  `le_…`. Split into the `launchd` and `push` leaves refused by the throwing leaf codecs, and the
  Git/launchd effect arms refused by the CLI post-check as arm-plus-step pairs.
- **`createLifecycleContext` builds its `TransactionStore` from `node:fs/promises` directly**, not
  from `CliFileSystem`: the input signature the plan fixes carries no filesystem, and importing
  `NODE_FILE_SYSTEM` would make the `context.ts` ↔ `lifecycle/context.ts` cycle real.
- **The fixture's `stableLockEvents` recorder writes `acquire <path>` only after the lock is
  actually held**, so Task 19's `toContain("acquire …")` asserts "was held", not "was attempted".
- **D34's `manifestBeforeHash` round trip is pinned, not assumed.** `lifecycle/context.test.ts`
  reaches `uninstall_draining` on a synthetic `uninstall/present_manifest_without_launchd` envelope
  and proves the negative twice: drifted manifest bytes and one surviving lease each yield
  `lifecycle_recovery_required`. A deliberately domain-separated `manifestBeforeHashOf` was shown
  to turn case 1 red, which is the failure mode the carried note names.

Source: old Task 21 (codecs and context half). Spec 1 §8.1 CLI ownership rows; Scope decisions 1 and 2.

Carried from Task 14 — two preconditions the store's fixed signature cannot discharge:

1. **`publish` cannot check `validateLifecyclePlanGrammar`.** The store has no `variantFacts` accessor and `executionPlanCodec.encode` does not validate, so a grammar-invalid plan can become durable and the ledger then classifies it `lifecycle_coordinator_plan_grammar` permanently. Task 18 must validate the plan **before** calling `publish`.
2. **`requireOwnedDirectory` checks kind and mode `0700` but not `ownerUid`**, because the store receives no `effectiveUid`. The guarded port still enforces ownership on every read, create and no-replace rename, and the ledger's `openRoot` catches a foreign-owned root; only a foreign-owned directory inside an already-0700 home is unchecked at this seam.

Carried from Task 12's review: the first CLI wiring of D34's `manifestBeforeHash` must be pinned by a round-trip test that actually reaches `uninstall_draining`, not merely by the accessor compiling. `manifestAgreesWithCursor` returns `false` on a hash mismatch, so a domain-separated or canonical-JSON `before.hash` would not throw, would raise no finding and would name no path — the drain would simply become unreachable, with uninstall's runner-drain never engaging as the only symptom.

**Files:**
- Create: `apps/cli/src/lifecycle/redaction-key.ts`
- Create: `apps/cli/src/lifecycle/codecs.ts`, `apps/cli/src/lifecycle/codecs.test.ts`
- Create: `apps/cli/src/lifecycle/context.ts`, `apps/cli/src/lifecycle/context.test.ts`
- Modify: `apps/cli/src/context.ts` — `CliContext.lifecycle?: CliLifecycleContext`; `createProductionContext` builds it
- Modify: `apps/cli/src/commands/testing.ts` — the fixture builds it with `MacOsStableLockProvider` wrapped to record `acquire <path>`/`release <path>` into a new `CommandFixture.stableLockEvents: string[]`, and with the fixture's rename runner
- Test: `apps/cli/src/context.test.ts`

**Interfaces:**
- Consumes: Tasks 7–17; `MacOsStableLockProvider`; `publishBootstrapInitialJournalNoReplace`; `ManifestStateParticipant`, `validateManifestStatePlan`, `ManifestStatePlanV1`.
- Produces:

```ts
// redaction-key.ts
export type SecretOpaqueFileStateV1 =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly kind: "regular_file"; readonly ownerUid: EffectiveUidV1; readonly mode: 384;
      readonly nlink: 1; readonly size: number; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
export interface RedactionKeyStatePlanV1 {
  readonly schemaVersion: 1; readonly coordinatorId: LifecycleCoordinatorIdV1; readonly sourcePath: CanonicalAbsolutePathV1;
  readonly tombstonePath: CanonicalAbsolutePathV1; readonly before: SecretOpaqueFileStateV1;
}
export function redactionKeySourcePath(stateDirectory: CanonicalAbsolutePathV1): CanonicalAbsolutePathV1;
export function redactionKeyTombstonePath(stateDirectory: CanonicalAbsolutePathV1, coordinatorId: LifecycleCoordinatorIdV1): CanonicalAbsolutePathV1;
export function createRedactionKeyStatePlanCodec(context: LifecycleCodecContextV1): LifecycleValueCodec<RedactionKeyStatePlanV1>;
export function redactionKeyStatePlanHash(plan: RedactionKeyStatePlanV1): LowerHexSha256;

// codecs.ts
export class LifecycleUnsupportedLeafError extends Error {
  readonly code: typeof EXIT_CODES.capabilityUnavailable; readonly reason: "unsupported_until_plan_1b";
}
export type LifecycleExecutionPlanV1 = LifecycleCoordinatorPlanCoreV1<ManifestStatePlanV1, never, RedactionKeyStatePlanV1, never>;
export function createLifecycleExecutionPlanCodec(context: LifecycleCodecContextV1): LifecycleValueCodec<LifecycleExecutionPlanV1>;
/**
 * A14: planning derives the evidence from the observed manifest, configuration and activation record (Task 22),
 * and the plan hash binds the resulting shape, so validating a persisted plan reads that bound shape
 * (`plan.participants.launchd !== null`) rather than a separately stored choice.
 */
export function lifecycleVariantFacts(plan: LifecycleExecutionPlanV1): LifecycleVariantFactsV1;
export function lifecyclePushPlanHash(plan: LifecycleExecutionPlanV1): null;
export function uninstallLeasePaths(productHome: CanonicalAbsolutePathV1): readonly CanonicalAbsolutePathV1[]; // registry order

// context.ts
/**
 * What the lifecycle services need to know about a home. It never requires an admitted manifest: recovery after
 * `M(preserve_before)` runs with the manifest gone, and after the uninstall control-file steps with the nonce gone.
 */
export interface LifecycleHomeKeyV1 { readonly productHome: CanonicalAbsolutePathV1; readonly nonce: LifecycleInstallNonceV1 }
export function lifecycleHomeKeyFromAdmission(admitted: AdmittedV2HomeV1, paths: RuntimePaths): LifecycleHomeKeyV1;
/** Parses the nonce out of `lc_<nonce>_<counter>`; refuses any other grammar. */
export function lifecycleHomeKeyFromCoordinatorId(productHome: CanonicalAbsolutePathV1, coordinatorId: string): LifecycleHomeKeyV1;
/** The one allocated nonce named by every `lc_…` leaf in `state/lifecycle-journals`; null when none; refuses exit 6 when two differ. */
export async function coordinatorNonceOf(fs: LifecycleGuardedFileSystemV1, productHome: CanonicalAbsolutePathV1): Promise<LifecycleInstallNonceV1 | null>;
export interface CliLifecycleContext {
  readonly fs: LifecycleGuardedFileSystemV1; readonly locks: LifecycleStableLockProviderV1; readonly transactionLocks: TransactionLockProvider;
  readonly roots: LifecycleLedgerRootsV1; readonly effectiveUid: number;
  readonly clock: () => UtcTimestampV1; readonly uuid: () => string; readonly nowMs: () => number; readonly sleepMs: (milliseconds: number) => Promise<void>;
  codecs(key: LifecycleHomeKeyV1): { readonly executionPlan: LifecycleValueCodec<LifecycleExecutionPlanV1>; readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1> };
  inspectLedger(key: LifecycleHomeKeyV1, residue: LifecycleBookkeepingResidueV1): Promise<LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>>;
  store(key: LifecycleHomeKeyV1): LifecycleCoordinatorStore<LifecycleExecutionPlanV1>;
  recovery(key: LifecycleHomeKeyV1, adapters: LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>, residue: LifecycleBookkeepingResidueV1): LifecycleRecoveryService<LifecycleExecutionPlanV1>;
}
export function createLifecycleContext(input: {
  readonly paths: RuntimePaths; readonly renameNoReplace: PublishBootstrapInitialJournalNoReplace;
  readonly locks: LifecycleStableLockProviderV1; readonly transactionLocks: TransactionLockProvider;
  readonly effectiveUid: number; readonly now: () => Date; readonly uuid?: () => string; readonly sleepMs?: (milliseconds: number) => Promise<void>;
}): CliLifecycleContext;
export function residueFrom(evidence: BootstrapEvidenceAdmissionV1): LifecycleBookkeepingResidueV1;
```

- [x] **Step 1: Write failing codec and composition tests**

```ts
it("round-trips an uninstall execution plan and refuses every 1b arm as unsupported", () => {
  const codec = createLifecycleExecutionPlanCodec(CONTEXT);
  const plan = syntheticUninstallExecutionPlan(CONTEXT);
  expect(codec.validate(plan)).toStrictEqual(plan);
  for (const arm of ["launchd", "sourceGitEffect", "destinationGitEffect", "launchdBeforeFiles", "launchdAfterFiles"] as const) {
    expect(() => codec.validate(withParticipant(plan, arm, SYNTHETIC_1B_LEAF))).toThrow(LifecycleUnsupportedLeafError);
  }
  expect(() => codec.validate({ ...plan, push: SYNTHETIC_1B_LEAF })).toThrow(LifecycleUnsupportedLeafError);
});

it("builds the lifecycle context from injected ports only", () => {
  const lifecycle = createLifecycleContext(fixtureInput());
  expect(lifecycle.roots.foundationJournals).toBe(join(HOME, "state", "transactions"));
  expect(uninstallLeasePaths(HOME as CanonicalAbsolutePathV1)).toStrictEqual(
    ["brain-reindex", "brain-lint", "doctor", "git-sync"].map((job) => join(HOME, "state", `.automation-${job}.lock`)));
});
```

Cover: `RedactionKeyStatePlanV1` exact keys, `sourcePath` exactly `<home>/state/redaction.key`, `tombstonePath` exactly `<home>/state/.redaction.key.<coordinator-id>.tombstone` with the plan's own coordinator ID, present arm `size` 31 and 1,048,577 refused, `mode` 420 refused, no content hash field accepted, hash domain `developer-os:redaction-key-state-plan:v1`; the manifest leaf is validated in a second pass with `validateManifestStatePlan`, bound to the validated core (lifecycle envelope equal to the plan ID; allocated `mf` participant ID under the nonce; `bindings.foundationTransactions` over the forward Foundation IDs in step order; empty `externalEffects`; `tombstonePath` `<home>/.installation-manifest.<participant-id>.json.tombstone`; `maximumPlanBytes` 16,777,216; `maximumJournalBytes` 1,048,576); every non-uninstall operation, and an `uninstall` plan shaped as `uninstall/present_manifest` (non-null `launchd` or a `launchd_before_files` step), refuses `LifecycleUnsupportedLeafError` in plan 1a; `createProductionContext` builds `lifecycle` and still reports `bootstrap: { state: "unavailable_until_packaged_handoff" }`; the fixture's `lifecycle` uses a real `MacOsStableLockProvider`; `residueFrom` collects `retainedPaths` and every `retainedEnvelopes[].plan.foundationParticipants[].id`.

Cover the manifest-free key (in `context.test.ts`, on a temporary home with no `init`):
- `lifecycleHomeKeyFromCoordinatorId(home, "lc_<nonce>_7")` yields that nonce, and `lc_<63 hex>_7`, `tx_<nonce>_7` and a legacy UUID refuse.
- With no `installation-manifest.json`, no `state/lifecycle-install-nonce` and no `state/lifecycle-id-allocator.json` — only the four ledger roots and a planted `lc_<nonce>_7.plan.json` — `codecs(key)` validates a synthetic uninstall plan under that nonce, and `inspectLedger(key, emptyResidue)` returns a snapshot with `allocator: null` instead of throwing. Its closure is `lifecycle_recovery_required`, because the planted plan is not a legal §2.4 envelope suffix; the legal microstates themselves are proven in Tasks 12 and 16.
- `coordinatorNonceOf` returns that nonce, returns null for an empty root, and refuses two `lc_` leaves under different nonces.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/context.test.ts src/context.test.ts`

Expected: FAIL — the modules do not exist.

- [x] **Step 3: Implement**

Compose `createLifecycleCodecs` (Task 7) with the redaction-key codec, a manifest leaf that admits structure first and binds in the second pass, and refusing launchd and push leaves. Effect references (`sourceGitEffect`, `destinationGitEffect`, `launchdBeforeFiles`, `launchdAfterFiles`) are not leaf codecs in Task 7 — Core validates them as `{ id, planHash }` — so the CLI codec runs a post-check after Core validation: any non-null effect reference, and any `LifecycleCoordinatorStepV1` of kind `source_git_effect`, `destination_git_effect`, `launchd_before_files`, `launchd_after_files` or `network_push`, throws `LifecycleUnsupportedLeafError`. Construct the ledger, store and recovery services with `lifecycleVariantFacts`, `lifecyclePushPlanHash`, null Git/launchd effect codecs, and `uninstallLeasePaths`. Real dependencies are wired only in `createProductionContext` and the fixture.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/context.test.ts src/context.test.ts`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'reject|usage|option'`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/lifecycle/codecs.ts apps/cli/src/lifecycle/codecs.test.ts apps/cli/src/lifecycle/context.ts apps/cli/src/lifecycle/context.test.ts apps/cli/src/context.ts apps/cli/src/context.test.ts apps/cli/src/commands/testing.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): compose the lifecycle execution codec and context"
```

### Task 19: The mutation gate every Foundation mutator passes through on a V2 home · L

Corrections this task's implementation forced, recorded against the steps below. It found two
pre-existing product defects that were unreachable until something consumed the ledger:

- **NEW-94: a fresh V2 `init` never creates `staging/lifecycle`, which A12 requires and the ledger
  refuses the absence of.** Before any fix, no mutation of any kind could pass the preflight on a
  real fresh V2 home, and wiring the gate turned two previously-green `uninstall.test.ts` cases
  red. The interim shipped here is `requireLifecycleStagingRoot`, which materialises the directory
  owner-only 0700 under the held global lock before the ledger is inspected. The durable fix
  belongs in `ordinaryDirectories` or in the ledger, and was **deliberately not taken inside this
  plan**: that file's gate is the 330-minute `bootstrap-executor` job D32 defers, so the change
  would ship unrun against D19's layout assertions. Founder decision, in NEW-94.
- **NEW-95: `capture`, `ingest`, `review` and `reindex` cannot succeed on a V2 home at all**, and
  this predates the gate: all four call `context.manifests.readOptional()`, whose zero-argument
  overload refuses `schemaVersion: 2`. **Step 1's first case is therefore unreachable as written** —
  `runCapture(…).ok === true` on a shared V2 home cannot happen today. The V2 contract is driven
  through `context.executor.execute` instead, which is the interface this task actually produces,
  with `runUninstall` and `runRepair` as the command-level proofs. Scope decision 5 is true of the
  wiring and false of the runtime. **Checked and ruled out for Task 20:** `config` reaches V2
  through `classifyMutationHome` and `readConfigFile`, neither of which touches
  `context.manifests`.
- **`context.lifecycle === undefined` on a V2 manifest refuses, decided fail-closed**, reason
  `lifecycle_context_unavailable`, exit 4. Falling through would write an unallocated
  `tx_<uuid>` journal into a V2 ledger outside the global lock and outside the allocator — the one
  state `requireCounterCoversAllocatedIds` cannot reconcile. V1 and manifest-absent still take the
  legacy path, so an NFD-named home can still run V1. Task 21 took the same decision for
  `runUninstall`.
- **`LifecycleCoordinator.execute` is unreachable from this gate in plan 1a**, which is why Task
  16's `resumed` obligation is closed rather than merely unraced: the gate always calls `recover`
  with `resumeUninstall: false`, `assertRecoverable` throws on any `active` coordinator before the
  loop body, and the CLI execution-plan codec admits no operation but `uninstall`.
- **Two signature widenings** against the `Produces` block, both required by the fail-closed
  decision: `classifyMutationHome(context, lifecycle: CliLifecycleContext | undefined)` and the
  same on `createGatedTransactionExecutor`'s input.
- **Four exports beyond the `Produces` block:** `isGatedTransactionExecutor` (a `WeakSet` brand for
  the wiring assertions), `composedContext` and `allocatedIdOnce` (the executor is a member of the
  context it classifies, so both composition roots pass a one-slot cell; `allocatedIdOnce` makes
  the allocated executor issue its ID once and throw on a second, per §7), and module-private
  `requireLifecycleStagingRoot`.
- **NEW-96: `manifestAdmissionFor` is duplicated** as a module-private `gateManifestAdmission`,
  because importing it would make `context.ts → lifecycle/mutation-gate.ts →
  commands/uninstall.ts → context.ts` a runtime cycle through the composition root. Two copies of
  one admission policy.
- **`controlFiles` adapters refuse rather than act** (`lifecycle_control_file_removal_unsupported`,
  exit 4); completing an uninstall coordinator's control files is Task 22's, and no coordinator can
  be executed in 1a.
- **Three real V2 `init` runs in `mutation-gate.v2.test.ts`, not one.** The uninstall case needs a
  pristine home: the shipped downcast reads the V2 allocator row through the V1 hash-based drift
  comparison, so a home whose counter has advanced refuses exit 3 before the gate is reached —
  another pre-existing V2-downcast gap, Task 22's territory. The repair case needs
  `interruptAfter: "applied"`, a fixture-construction option.
- **Cover-list items pinned differently than worded**, each for a stated reason: the
  capability-less refusal is split into an `init` and a `capture` case, and for `init` "creates
  nothing" is pinned as no journal, no manifest and no managed artifact, because `init` creates its
  scaffold and the redaction key before it plans a transaction; the allocator temp is pinned as
  surviving `status` untouched and gone after a mutation, because scope decision 15 leaves `status`
  no field that could name it; `ingest`/`review`/`reindex` are pinned as wiring assertions plus a
  per-command source assertion, because NEW-95 makes driving them on a V2 home impossible.

Source: old Task 21 (recovery before mutation). Spec 1 §2.3 global lock for every mutating command; §2.4 compaction and reservation preflight, "A standalone Foundation transaction reserves one `tx` ID", overflow recovery; §2.2 closure prerequisite; Scope decisions 4–6.

**Files:**
- Create: `apps/cli/src/lifecycle/mutation-gate.ts`
- Create: `apps/cli/src/lifecycle/mutation-gate.v2.test.ts` — every case that needs a real V2 home (`lifecycle-v2` job)
- Create: `apps/cli/src/lifecycle/mutation-gate.test.ts` — V1 and manifest-absent cases (`suite` job)
- Modify: `apps/cli/src/context.ts` — `CliContext.executor: CliTransactionExecutor`; production wires the gated executor
- Modify: `apps/cli/src/commands/testing.ts` — the fixture wires the gated executor around its existing interruptible executor
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes` from Step 4's measurement

**Interfaces:**
- Consumes: Tasks 10, 12, 14, 15, 16, 17, 18; `inspectBootstrapEvidenceAdmission`; `TransactionExecutor`, `TransactionPlan`.
- Produces:

```ts
export interface CliTransactionExecutor {
  execute(plan: TransactionPlan): Promise<TransactionJournalV1>;
  resume(id: string): Promise<TransactionJournalV1>;
  rollback(id: string): Promise<TransactionJournalV1>;
}
export type MutationHomeV1 =
  | { readonly kind: "v1" }
  | { readonly kind: "manifest_absent" }
  | { readonly kind: "manifest_absent_with_global_lock" }
  | { readonly kind: "v2"; readonly admitted: AdmittedV2HomeV1 };
export async function classifyMutationHome(context: CliContext, lifecycle: CliLifecycleContext): Promise<MutationHomeV1>;
export interface LifecycleMutationAuthorityV1 {
  readonly admitted: AdmittedV2HomeV1; readonly global: HeldLifecycleStableLockV1;
  readonly snapshot: LifecycleLedgerSnapshotV1<LifecycleExecutionPlanV1>;
  allocateStandaloneFoundationId(mutations: readonly PlannedFileMutation[]): Promise<AllocatedLifecycleIdV1<"tx">>;
}
export async function withLifecycleMutation<T>(
  context: CliContext, lifecycle: CliLifecycleContext,
  work: (authority: LifecycleMutationAuthorityV1) => Promise<T>,
  resolution?: { readonly standaloneFoundationId: string },
): Promise<T>;
export function createGatedTransactionExecutor(input: {
  readonly context: () => CliContext; readonly lifecycle: CliLifecycleContext;
  readonly legacy: TransactionExecutor; readonly allocated: (id: string) => TransactionExecutor;
}): CliTransactionExecutor;
export class LifecycleMutationRefusal extends Error {
  readonly code: ExitCode; readonly reason: SafeReasonCodeV1; readonly paths: readonly string[]; readonly recovery: string | undefined;
}
```

- [x] **Step 1: Write failing gate tests, V2 cases on one shared home**

```ts
it("runs a V2 capture under the global lock with one allocated transaction ID", async () => {
  const fixture = await sharedV2Home();
  const before = await allocatorCounter(fixture);
  expect((await runCapture(fixture.context, { text: "synthetic observation" })).ok).toBe(true);
  expect(await allocatorCounter(fixture)).toBe(before + 1n);
  expect(await journalIds(fixture)).toContain(`tx_${await nonceOf(fixture)}_${String(before)}`);
  expect(fixture.stableLockEvents).toContain(`acquire ${join(fixture.paths.stateDir, ".lifecycle.lock")}`);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("refuses interactive contention on the global lock with exit 6 and writes nothing", async () => {
  const fixture = await sharedV2Home();
  const held = await new MacOsStableLockProvider().acquireExisting(join(fixture.paths.stateDir, ".lifecycle.lock") as CanonicalAbsolutePathV1);
  try {
    const before = await inventoryDigest(fixture.paths.home);
    const result = await runCapture(fixture.context, { text: "synthetic observation" });
    expect(result).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
    expect(await inventoryDigest(fixture.paths.home)).toStrictEqual(before);
  } finally { await held.release(); }
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("names repair as the way out of a non-terminal standalone journal, and repair resolves it", async () => {
  const fixture = await createCommandFixture("gate-repair-resolution", {
    bootstrapAvailable: true, interruptAfter: "applied", interruptKind: "capture",
  });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  expect((await runCapture(fixture.context, { text: "synthetic observation" })).ok).toBe(false);
  const refused = await runCapture(fixture.rebuildContext(), { text: "second observation" });
  expect(refused).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
  const id = /--resume (tx_\S+)/u.exec(refused.ok ? "" : refused.error.recovery ?? "")?.[1];
  expect(id).toMatch(/^tx_[0-9a-f]{64}_[0-9]+$/u);
  expect((await runRepair(fixture.rebuildContext(), { resume: id ?? "", rollback: null })).ok).toBe(true);
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

`sharedV2Home` initialises one V2 home per test file (`beforeAll`) with `bootstrapAvailable: true` and restores the ledger between cases through the gate's own compaction. `stableLockEvents` is a fixture recorder the Task 18 fixture wiring exposes. The three cases above live in `mutation-gate.v2.test.ts`.

In `mutation-gate.test.ts` (no V2 home):
- A V1 home from the capability-less fixture captures with the legacy executor's own ID (`tx_fixture_NNN` from the fixture's `generateId`; `tx_<lowercase-v4-uuid>` in production), and no `state/.lifecycle.lock` ever exists.
- V1 `init`'s own transaction (`runInit` on an empty home, manifest absent, no lock) goes through `createGatedTransactionExecutor` and takes the legacy path.
- A home with no manifest but an owner `0600` zero-byte `state/.lifecycle.lock` refuses the capability-less `init` transaction and `capture` with exit 2 and creates nothing.

Cover also, in `mutation-gate.v2.test.ts`:
- Until Task 22, the V2 downcast `uninstall` (`revertArtifacts`) runs through the gate: its journal ID is allocated, the global lock is acquired and released, and afterwards the lock remains and the manifest is gone.
- A terminal journal from the previous mutation is compacted by the next mutation's preflight: its journal, lock, staging and backup leaves are gone.
- A malformed leaf in `state/lifecycle-journals` refuses exit 6 with nothing written.
- An allocator temp is cleaned by a mutator and reported, not deleted, by `status`.
- A nested `context.executor.execute` inside `withLifecycleMutation` reuses the held authority instead of re-acquiring the lock (no self-deadlock).
- A coordinator plan-only orphan is completed by the preflight and the mutation proceeds.
- `repair --resume` of an ID that is not the only non-terminal entry refuses exit 6.
- `ingest`, `review` and `reindex` each reach `createGatedTransactionExecutor`: one assertion per command that `context.executor` is the gated instance, with no extra real `init`.
- The gate never spawns `git`, `launchctl` or a vendor: the fixture's `vendorProcesses` and runner requests stay empty.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/mutation-gate.test.ts src/lifecycle/mutation-gate.v2.test.ts`

Expected: FAIL — `mutation-gate.ts` does not exist and V2 captures still use legacy IDs.

- [x] **Step 3: Implement**

`withLifecycleMutation` order, all under one held global lock:
1. `classifyMutationHome`, requiring `v2`.
2. `lifecycle.locks.acquireExisting(<state>/.lifecycle.lock)`: busy refuses exit 6; missing refuses exit 6.
3. Re-admit with `admitInstalledV2Home`, require the lock entry's identity to equal the held lock, and build `lifecycleHomeKeyFromAdmission` for every lifecycle service call.
4. `residueFrom(await inspectBootstrapEvidenceAdmission(…))`.
5. `recovery.recover(global, { resumeUninstall: false, standaloneFoundationId: resolution?.standaloneFoundationId })`, which compacts, completes orphans, and leaves the journal being resolved untouched (Task 16's policy field).
6. Require closure `clear`. The only exception is `resolution.standaloneFoundationId`, when that ID is the sole non-terminal entry.
7. `assertLifecycleCapacity(snapshot, standaloneFoundationLeafReservation(mutations))` inside `allocateStandaloneFoundationId`, then `reserveLifecycleIdBlock(1)`, then `formatAllocatedLifecycleId("tx", nonce, firstCounter)`.
8. Run `work` inside an `AsyncLocalStorage` scope so the gated executor reuses the authority.
9. Release the lock in `finally`.

`allocated(id)` constructs a `TransactionExecutor` with exactly `legacy`'s dependencies — including a fixture's `afterPhase` interruption hook — except `generateId`, which returns `id` once. `createGatedTransactionExecutor` classifies per call: `v2` enters the gate (`execute` allocates; `resume`/`rollback` pass `resolution`); `v1` and `manifest_absent` call `legacy`; `manifest_absent_with_global_lock` refuses exit 2. Map refusals to `LifecycleMutationRefusal` so `failureFrom` publishes `reason`, `paths` and `recovery`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/mutation-gate.test.ts src/lifecycle/mutation-gate.v2.test.ts src/commands/capture.test.ts src/commands/repair.test.ts src/commands/review.test.ts src/commands/reindex.test.ts src/commands/ingest.test.ts src/context.test.ts`

These command files hold no V2 fixture; they are the regression surface for the legacy pass-through.

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'preserving every retained bootstrap evidence inode|dry-runs and reports retained evidence|retention roots|deep inside a retained tree|ephemeral V2 artifact'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'admits every ordinary command'`

Run: `npm run build && npx vitest run --root tests security/interruption.test.ts security/concurrent-edit.test.ts`

Expected: PASS. Add `mutation-gate.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes` per the CI budget rule.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/mutation-gate.ts apps/cli/src/lifecycle/mutation-gate.test.ts apps/cli/src/lifecycle/mutation-gate.v2.test.ts apps/cli/src/context.ts apps/cli/src/commands/testing.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): gate every V2 Foundation mutation on the lifecycle ledger"
```

### Task 20: `config get` and `config set` · M

Source: old Task 2, moved after the lock provider (Task 9) and the gate (Task 19) as roadmap Phase 4 requires. Spec 1 §2.2, §3 `config` rows; A1; A9 round trip "fresh V2 `init` → `config set` … with closure `clear` beside retained evidence" (the `git enable` preview half is plan 1b).

Corrections this task's implementation forced, recorded against the steps below:

- **Step 1's headline snippet cannot pass with the key it names, and the shipped grammar wins.**
  A fresh V2 home carries no `[brain]` table: `defaultConfig` in `apps/cli/src/commands/init.ts`
  emits six keys, the fresh V2 path reuses it, and `brainSchema` is strict with no defaults. Task
  5's `setConfigValue` therefore refuses `brain.staleness.reviewAfterDays` with
  `config_parent_absent`, a designed member of `ConfigRefusalReasonV1` rather than a gap —
  auto-creating the section from one leaf would mean synthesising every other field of a strict
  schema. Spec 1 A9's §7 row names no key, only "fresh V2 `init` → `config set` … with closure
  `clear` beside retained evidence", so the shipped round trip satisfies it: the case pins the
  `config_parent_absent` refusal, creates the section with `config set brain <canonical JSON>`
  (`brain` is a member of `CONFIG_MUTABLE_KEYS`), then runs the snippet's four assertions
  verbatim. No spec change and no Task 5 change.
- **The hand-edit case refuses `transaction_precondition`, not `transaction_conflict`.**
  `TransactionPreconditionError extends TransactionConflictError` and is the plan-phase
  precondition error the Cover list describes, so the test pins the more specific kind.
- **The argv `it.each` also asserts the usage block.** Exit 2 alone proves nothing there: the
  throwing context factory the case installs publishes exit 2 as well, so without the usage
  assertion a context that was built would pass.

**Files:**
- Create: `apps/cli/src/commands/config.ts`
- Create: `apps/cli/src/commands/config.test.ts` — argv, V1 and manifest-absent cases (`suite` job)
- Create: `apps/cli/src/commands/config.v2.test.ts` — every case on a real V2 home (`lifecycle-v2` job)
- Modify: `apps/cli/src/main.ts` — `USAGE`, `COMMAND_OPTIONS.config`, `COMMAND_POSITIONALS.config`, `config` subcommand arity, dispatch
- Test: `apps/cli/src/main.test.ts`
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Task 5 codecs; Tasks 17–19; `readConfigFile` (`apps/cli/src/commands/doctor.ts`); `encodeCanonicalJson`; `hashBytes`.
- Produces:

```ts
export type ConfigCommandRequestV1 =
  | { readonly operation: "get"; readonly key: string | null }
  | { readonly operation: "set"; readonly key: string; readonly value: string };
export type ConfigCommandResultV1 = ConfigGetResultV1 | ConfigSetResultV1;
export async function runConfig(context: CliContext, request: ConfigCommandRequestV1): Promise<CliResult<ConfigCommandResultV1>>;
/** One line: the canonical JSON of the result without its LF (the CLI's line writer adds it). */
export function renderConfigResult(result: ConfigCommandResultV1): readonly string[];
```

- [x] **Step 1: Write failing command and dispatch tests**

```ts
it("sets a value on a fresh V2 home beside retained evidence with closure clear", async () => {
  const fixture = await sharedV2Home();
  const set = await runConfig(fixture.context, { operation: "set", key: "brain.staleness.reviewAfterDays", value: "30" });
  expect(set).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "brain.staleness.reviewAfterDays", outcome: "updated" } });
  const get = await runConfig(fixture.context, { operation: "get", key: "brain.staleness.reviewAfterDays" });
  expect(get).toMatchObject({ ok: true, data: { schemaVersion: 1, key: "brain.staleness.reviewAfterDays", value: 30 } });
  expect((await fixture.lifecycleSnapshot()).closure).toStrictEqual({ kind: "clear" });
  expect(await fixture.bootstrapEvidenceIdentities()).toStrictEqual(fixture.retainedAtInit);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it.each([
  [["config"]], [["config", "get", "a", "b"]], [["config", "set", "brain.staleness.reviewAfterDays"]],
  [["config", "set", "brain.staleness.reviewAfterDays", "30", "31"]], [["config", "set", "k", "v", "--apply"]],
  [["config", "unset", "k"]],
])("refuses the argv %j before building a context", async (argv) => {
  const io = new RecordingIo();
  expect(await run(argv, io, () => { throw new Error("context must not be built"); })).toBe(EXIT_CODES.invalidInput);
});

it("prints the exact canonical JSON of the result, with or without --json", async () => {
  const fixture = await sharedV2Home();
  for (const argv of [["config", "get", "adapters.claude"], ["config", "get", "adapters.claude", "--json"]]) {
    fixture.io.out.length = 0;
    expect(await run(argv, fixture.io, () => fixture.rebuildContext())).toBe(0);
    expect(fixture.io.out).toStrictEqual(['{"key":"adapters.claude","schemaVersion":1,"value":false}']);
  }
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

`sharedV2Home` is test-local: it initialises one V2 home per file in `beforeAll` and returns the fixture plus `retainedAtInit` (its `bootstrapEvidenceIdentities()` right after `init`) and `lifecycleSnapshot()` (structural admission, `residueFrom`, `lifecycle.inspectLedger`). The first and third cases live in `config.v2.test.ts`; the argv case lives in `config.test.ts`. Cover in `config.test.ts`: a V1 home refuses both `get` and `set` with kind `manifest_v1_not_migratable`, exit 4, before any lock (no `state/.lifecycle.lock` appears); a home with no manifest and no lock refuses exit 2 without creating one; a home with no manifest but a planted owner `0600` zero-byte `state/.lifecycle.lock` refuses exit 2 for both `get` and `set`, after acquiring and releasing that lock (`stableLockEvents`), leaving its inode unchanged; `USAGE` lists `config`; `--apply` is refused as an unknown option. Cover in `config.v2.test.ts`: `config get` with no key prints the publishable projection with `redaction` replaced by `{ "patternsCount": n }`; `config get redaction.patterns` prints only the integer; `config get` on V2 takes no lock; a refused set leaves `config.toml` bytes, the allocator counter and `state/transactions` unchanged; `unchanged` performs no transaction and allocates nothing; `updated` performs exactly one Foundation transaction with an allocated ID whose single mutation replaces `config.toml` guarded by the pre-read hash, and the re-read file strictly loads and serializes to the planned bytes; a hand edit between the read and the transaction refuses with the existing precondition error and leaves the hand edit; a busy global lock refuses exit 6; no refusal on stdout or stderr contains the supplied value (use a sentinel value); `git.enabled`, `schemaVersion`, `telemetry` and both lifecycle keys refuse read-only.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/commands/config.test.ts src/commands/config.v2.test.ts`

Expected: FAIL — `config` is not a registered command and `config.ts` does not exist.

- [x] **Step 3: Implement**

In `main.ts`: `COMMAND_OPTIONS.config = ["json"]`; `COMMAND_POSITIONALS.config = { min: 1, max: 3 }`; after the generic arity check, `get` takes 0 or 1 further positionals and `set` exactly 2, anything else is `null`; dispatch emits `renderConfigResult` lines for success in both modes and the standing envelope for failure. `runConfig` (Scope decision 4): `classifyMutationHome` refuses `v1` (exit 4) and `manifest_absent` (exit 2); for `manifest_absent_with_global_lock`, both `get` and `set` acquire the existing lock with `acquireExisting` (never creating it), reclassify, release, and refuse exit 2 (a busy lock refuses exit 6). On V2, `get` takes no lock and reads through `readConfigFile` and `readConfigValue`. `set` runs inside `withLifecycleMutation`, reads the config bytes, calls `setConfigValue`, and for `updated` calls `context.executor.execute({ kind: "config-set", mutations: [{ targetPath, operation: "replace", content, expectedBeforeHash }] })`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/commands/config.test.ts src/commands/config.v2.test.ts src/lifecycle/mutation-gate.test.ts`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'reject|usage|option|config'`

Run: `npm run build && npx vitest run --root tests security/network.test.ts`

Expected: PASS. Add `config.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes` per the CI budget rule.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/commands/config.ts apps/cli/src/commands/config.test.ts apps/cli/src/commands/config.v2.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): add config get and config set"
```

### Task 21: Absent-manifest uninstall without a coordinator envelope · M

Corrections this task's implementation forced, recorded against the steps below:

- **Step 1's `.v2` snippet contradicts this task's own Cover list, and the Cover list wins.** The
  snippet builds the fixture with `bootstrapFailureAfter: "after_foundation"` and then expects the
  key deleted and `runInit` to succeed. That is impossible: a rollback at that point retains
  `config.toml`, an unprojected ordinary path, so §6 admits no shape and the arm refuses
  `absent_manifest_residue` — which is exactly what the Cover list two paragraphs below demands.
  The implemented fixture uses `after_global_lock`, probed to give shape `state_key_only`,
  `blocksNewIntent: false` and `bootstrapLeaf: null`, with in-tree precedent in
  `apps/cli/src/bootstrap/bookkeeping.v2.test.ts`. `after_payloads` and `after_created_paths` were
  probed and would also serve.
- **`removeRedactionKeyFile` is NOT deleted**, against the file list. It has two call sites and
  only the `manifest === null` one is removed; the manifest-present site is required by three
  tests the plan does not list for rewrite, one of which pins that the key is unlinked *before*
  `revertArtifacts` so `rmdir(stateDir)` can succeed. Deleting it would reintroduce a state
  directory holding one orphaned secret.
- **`main.test.ts`'s `harness.err` does not change.** The plan says it "now equals the refusal's
  lines rather than `[]`". `emit` in `apps/cli/src/main.ts` returns early for `--json` and writes
  the whole envelope, success or failure, to stdout only — so `err` stays `[]` and the only change
  is `0` → `6` on the second uninstall.
- **Step 4's fourth command silently skips the citations gate.** `-t 'installs, reports, repeats'`
  applies to every file in the invocation, so `repository/citations.test.ts` reports
  `1 skipped` and never runs. It was run separately and passes 22/22. Tasks copying this command
  shape must split it.
- **Two test titles were renamed beyond the instruction**, because both old titles asserted the
  opposite of what the test now proves: `"is idempotent"` and `"still reports and preserves
  retained evidence when the manifest is absent"`. Both new titles keep the substring Step 4's
  `-t` filter needs.
- **A new import cycle**, named rather than hidden: `apps/cli/src/commands/uninstall.ts` imports
  `runAbsentManifestUninstall` from `apps/cli/src/lifecycle/absent-manifest-uninstall.ts`, which
  imports the runtime class `UninstallRefusal` back. Nothing is touched at module-evaluation time
  and every gate is green; the alternatives were a duplicate refusal class or moving
  `UninstallRefusal` outside the file list.
- **`runUninstall` refuses exit 6 with D20's guidance when `context.lifecycle` is `undefined`**, an
  arm the plan does not specify. Fail-closed, pinned by a test, and the same decision Task 19 took
  for the mutation gate.
- **`absentManifestEvidenceOf` forwards `envelope.plan.bootstrapIdentity` whole** rather than
  rebuilding `{dev, ino}`: rebuilding made `tests/repository/check.js`'s identity-encoding rule
  treat the module as identity-recording and fail three guarded-port `lstat` calls that cannot
  take `{ bigint: true }`. The guarded port already returns exact decimal identities.
- **The integrator, not the implementer, excised one further clause.** The plan said to stop before
  `foundation-constraints.md`'s "Launchd never inherits" sentence and to leave every launchd
  sentence in place, which left that sentence still asserting "the flat coordinator admits one
  final journal plus one bounded rewrite temp" — false once A3 withdrew the envelope, and the exact
  clause the plan told the implementer to excise from `foundation.md`'s parallel sentence. The
  sentence now ends at "current effect frontier." Recorded here rather than done silently.

Source: old Task 23 (absent-manifest half) without the key-present coordinator (A3, D22); D27. Spec 1 §6 `key_absent`/`key_present`; A12; §8.3 residuals 8 and 9; A9 round trips "absent-manifest key deletion → `init`", "`key_absent` → `init`", "V2 `init` rolled back → uninstall → `init`"; roadmap bullet on the architecture notes that still describe the withdrawn envelope.

**Files:**
- Create: `apps/cli/src/lifecycle/absent-manifest-uninstall.ts`
- Create: `apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts` — rolled-back V2 `init` sequences (`lifecycle-v2` job)
- Create: `apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts` — empty-home, planted-shape and V1-residue cases (`suite` job)
- Modify: `apps/cli/src/lifecycle/redaction-key.ts` — `observeSecretOpaqueKey`, `unlinkSecretOpaqueKey`
- Modify: `apps/cli/src/commands/uninstall.ts` — the `manifest === null` branch of `runUninstall` delegates to `runAbsentManifestUninstall`; `removeRedactionKeyFile` is deleted
- Modify: `apps/cli/src/commands/uninstall.test.ts` — rewrite "is idempotent", "removes the redaction key even when no manifest is left to read", "leaves the redaction key alone on a dry run (manifest present: %s)" and "still reports and preserves retained evidence when the manifest is absent"
- Modify: `apps/cli/src/main.test.ts` — "renders retained evidence after uninstall instead of claiming nothing remains" (second `uninstall`) and "runs the whole lifecycle through argument dispatch" (second `uninstall`)
- Modify: `tests/e2e/foundation.test.ts` — the "uninstall again: nothing owned remains" block of "installs, reports, repeats, and removes itself without touching anything else"
- Modify: `docs/architecture/foundation.md`, `docs/architecture/foundation-constraints.md`, `docs/architecture/threat-model.md` — replace the withdrawn envelope passages only
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Task 3 `bootstrapLeaf`; Task 13 `inspectAbsentManifestProductHome`; Task 18 `CliLifecycleContext`, `residueFrom`; the context's transaction lock provider for the bootstrap leaf (create-or-open is legal for that leaf only, §6).
- Produces:

```ts
// redaction-key.ts
export async function observeSecretOpaqueKey(path: CanonicalAbsolutePathV1, effectiveUid: number): Promise<SecretOpaqueFileStateV1>; // O_RDONLY|O_NOFOLLOW|O_NONBLOCK, fstat, close; never reads
export async function unlinkSecretOpaqueKey(path: CanonicalAbsolutePathV1, expected: Extract<SecretOpaqueFileStateV1, { state: "present" }>): Promise<void>;

// absent-manifest-uninstall.ts
export type AbsentManifestUninstallArmV1 = "key_absent" | "key_present";
export async function runAbsentManifestUninstall(input: {
  readonly context: CliContext; readonly lifecycle: CliLifecycleContext;
  readonly options: UninstallOptions; readonly evidence: BootstrapEvidenceAdmissionV1;
}): Promise<UninstallResultV1 & { readonly arm: AbsentManifestUninstallArmV1 }>;
```

- [x] **Step 1: Write failing arm and round-trip tests**

```ts
it("deletes an orphaned key after a rolled-back V2 init under the bootstrap leaf, then init succeeds", async () => {
  const fixture = await createCommandFixture("absent-manifest-orphan-key", { bootstrapAvailable: true, bootstrapFailureAfter: "after_foundation" });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
  fixture.disableBootstrapFailure();
  loadOrCreateRedactionKey(fixture.paths.stateDir);
  const keyReads = spyOnKeyContentReads(fixture);

  const removed = await runUninstall(fixture.rebuildContext(), ACCEPTED);

  expect(removed).toMatchObject({ ok: true, data: { removed: [join(fixture.paths.stateDir, "redaction.key")], transactionId: null } });
  expect(keyReads()).toBe(0);
  expect(await exists(join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock"))).toBe(true);
  expect(await lifecycleIdLeaves(fixture)).toStrictEqual([]);
  expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("refuses a second V1 uninstall over V1 Foundation residue with D20's guidance and changes nothing (D27)", async () => {
  const fixture = await createCommandFixture("absent-manifest-v1-residue");
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  expect((await runUninstall(fixture.context, ACCEPTED)).ok).toBe(true);
  loadOrCreateRedactionKey(fixture.paths.stateDir);
  const before = await inventoryDigest(fixture.root);

  const again = await runUninstall(fixture.rebuildContext(), ACCEPTED);

  expect(again).toMatchObject({ ok: false, code: EXIT_CODES.recoveryRequired });
  expect(again.ok ? "" : again.error.recovery).toContain("archive the product home");
  expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
});
```

The first case lives in `absent-manifest-uninstall.v2.test.ts`, the second in `absent-manifest-uninstall.test.ts`. Test-local helpers:
- `spyOnKeyContentReads` wraps `node:fs/promises` `readFile` and `FileHandle.read` through `vi.spyOn` and counts calls whose path or descriptor is the key.
- `lifecycleIdLeaves` lists every name in the three journal roots and `state` that matches an allocated-ID grammar.

Cover:
- `key_absent`: an empty product home with an empty `state` gives two identical read-only walks, creates nothing (compare `inventoryDigest`), and `runInit` then succeeds (in the `.v2` file).
- Dry run inspects and reports without creating the leaf or deleting the key.
- A key that is a symlink, a directory, `nlink` 2, size 31, or mode `0644` refuses exit 6 and deletes nothing. A key whose identity changes between the observation and the recheck refuses and preserves everything.
- A crash injected before the unlink leaves the key, and a rerun deletes it. A crash after the unlink leaves no key, and a rerun is `key_absent`.
- `config.toml`, a legacy `tx_<uuid>.json`, a plist at one of the four LaunchAgents paths, an attributed bootstrap leaf, or active bootstrap residue each refuse exit 6 with D20's archive guidance and change nothing.
- No arm acquires or creates `state/.lifecycle.lock`, reserves an ID, or writes a journal; no `launchctl` or `git` process is spawned (fixture runner requests stay empty).

Existing tests rewritten to D27's contract (verify each by name before editing):
- `uninstall.test.ts` "is idempotent" (V1): the second run refuses exit 6 and `inventory(fixture.root)` is unchanged.
- `uninstall.test.ts` "removes the redaction key even when no manifest is left to read" (V1): the documented orphaned-key trap. The second run now refuses exit 6 and the key is preserved; D20's guidance — archive the product home manually, then `init` — is the way out, and archiving the home removes the key with it. Rename it "preserves an orphaned key beside V1 residue and names the archive recovery".
- `uninstall.test.ts` "leaves the redaction key alone on a dry run (manifest present: %s)": the `false` arm (V1 home with its manifest unlinked) now expects exit 6 and the key present; the `true` arm is unchanged.
- `uninstall.test.ts` "still reports and preserves retained evidence when the manifest is absent" (V2 after the downcast uninstall): the second run refuses exit 6, because the downcast uninstall's own Foundation journal is residue, and the retained identities are unchanged. Task 22 restores success.
- `main.test.ts` "renders retained evidence after uninstall instead of claiming nothing remains" (V2): the second `["uninstall", "--yes", "--json"]` returns 6 and its single JSON line is the error envelope. Task 22 restores 0.
- `main.test.ts` "runs the whole lifecycle through argument dispatch" (V1): the second `["uninstall", "--yes", "--json"]` returns 6, and `harness.err` now equals the refusal's lines rather than `[]`.
- `tests/e2e/foundation.test.ts`, the "uninstall again" block: expect `EXIT_CODES.recoveryRequired`, a failure result whose recovery names archiving the product home, and the same three empty inventory differences. Replace the comment above it with one sentence: D27 makes a second V1 uninstall refuse, and the inventory assertions prove the refusal changed nothing.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts src/lifecycle/absent-manifest-uninstall.v2.test.ts`

Expected: FAIL — the module does not exist, and the shipped branch unlinks the key over any residue.

- [x] **Step 3: Implement both arms and correct the architecture notes**

`key_absent`: `inspectAbsentManifestProductHome` twice; the two `walkFingerprint`s must be equal, else exit 6; return. `key_present`: acquire the leaf `<state>/.lifecycle-bootstrap.lock` with the transaction lock provider, require the exact owner `0600` zero-byte single-link shape, repeat the inspection (the fresh leaf projects away as unattributed), require shape `state_key_only`, call `observeSecretOpaqueKey`, recheck by `lstat` that `dev`/`ino` are unchanged, `unlinkSecretOpaqueKey`, sync `state`, verify absence, release the leaf and leave it in place. Never unlink or `rmdir` anything else. A refusal over residue carries recovery "developer-os uninstall, then archive the product home manually, then developer-os init" (D20).

Documentation, replacing only these passages and leaving every launchd sentence in place:
- `docs/architecture/foundation.md`: the sentence "Before the permanent global lock exists, init and fresh absent-manifest uninstall use the exact transient `LifecycleBootstrapLockV1` protocol … rather than creating the installed four-root ledger."; the sentence "A live attempt removes only its identity-recorded empty directories; … make initial nonce/allocator recovery deterministic."; and, in "Launchd inherits only the already-unlinked snapshot; its sole linked creation prefix is frontier-bound and recoverable, while the flat key-present coordinator admits one final journal plus one bounded rewrite temp.", only the clause ", while the flat key-present coordinator admits one final journal plus one bounded rewrite temp" (the sentence then ends at "recoverable.").
- `docs/architecture/foundation-constraints.md`: the sentences from "It also adds the transient pre-product" through "have closed path/metadata/byte-prefix recovery grammars.", stopping before "Launchd never inherits".
- `docs/architecture/threat-model.md`: the clause "but performs no service probe before the recovery epoch" (becomes "and performs no service probe"); the sentences "The absent-key arm allocates nothing, while the present-key arm alone creates recoverable key transitions in a closed flat bootstrap envelope, never by adopting or creating the installed ledger." and "Initial nonce/allocator temps are admitted only through their exact bounded prefix grammars."; and the sentence "A flat absent-manifest coordinator rewrite crash may retain only its authoritative final journal plus one bounded temp.", leaving the launchd byte-boundary sentence before it.

Each replacement states A2, A3 and A12 as they now hold: absent-manifest uninstall has no coordinator envelope; `key_absent` performs two identical read-only walks and creates nothing; `key_present` deletes the key under the bootstrap leaf by rechecked identity; the leaf and the bookkeeping set are never unlinked; §8.3 residuals 8 (check-then-unlink window) and 9 (shape admission) are accepted.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts src/lifecycle/absent-manifest-uninstall.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'idempotent|orphaned key|dry run|manifest is absent|redaction key'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'renders retained evidence|whole lifecycle'`

Run: `npm run build && npx vitest run --root tests e2e/foundation.test.ts -t 'installs, reports, repeats' repository/citations.test.ts`

Expected: PASS. Add `absent-manifest-uninstall.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/absent-manifest-uninstall.ts apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/main.test.ts tests/e2e/foundation.test.ts docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/threat-model.md .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): uninstall an absent-manifest home without a coordinator envelope"
```

### Task 22: Present-manifest uninstall coordinator with drained leases · L

Source: old Task 23 (present-manifest half). Spec 1 §6 steps 1–4 and the A14/A15 paragraphs; §2.4 both uninstall rows, the A16 reservation order, `RedactionKeyStatePlanV1`, manifest no-overwrite transitions; §5.4 lease rules as they bind uninstall; D24, D25, D26, D28; §7 "uninstall drains without deadlock" (lease half), "uninstall respects ownership", "manifest transitions are no-overwrite", "uninstall removes its manifest recoverably" (with A15), "redaction-key deletion is secret-opaque".

Corrections this task's implementation forced, recorded against the steps below:

- **Ten staged paths, not the eight the Files list names.** `apps/cli/src/lifecycle/context.ts`
  gains one additive `readonly renameNoReplace` field plus its line of wiring:
  `FoundationParticipantExecutor` cannot publish a participant's staged initial journal without
  the bound retained rename, nothing else exposes it, and reconstructing the production singleton
  where the coordinator runs would bypass every fixture's own rename.
  `apps/cli/src/lifecycle/mutation-gate.v2.test.ts` is rewritten because its one uninstall case
  pinned the downcast this task replaces — the `[acquire, release]` lock pair and the surviving
  allocated `tx_` journal — so left alone it reds `lifecycle-v2`. The replacement is stronger: it
  pins §5.4's rule that every lease is acquired only after the global lock is released and
  released only once its path is gone.
- **`state/uninstalling.json` is not an `F(uninstall_artifacts)` mutation.** §2.4 compaction proves
  each reference's preimage against the post-run tree, and a target that one forward mutation
  writes and a later forward mutation removes breaks that proof in both directions — observed
  finalized and rolled back. The marker is collected at the `coordinator_envelope` compaction
  entry instead. The end state on disk is identical.
- **`snapshot.closure` is not `clear` after a completed uninstall, and Tasks 23 and 24 must not
  assert it.** `admitsControlFileAbsence` needs the envelope that the same compaction entry
  removes, so the state is unreachable by construction rather than by defect. What the D25 case
  asserts instead is the D25 contract itself: the manifest tombstone gone, the empty `rollback`
  directory row gone, a non-empty `logs` directory preserved, and the nonce gone.
- **The re-drain is the next `uninstall`, not a resumed one.** §2.4 compensates every death before
  the point of no return, so `F(uninstall_artifacts)` is never re-entered on recovery.
- **`K(stage)` and `K(restore)` use link plus unlink, not rename.** The guarded `renameNoReplace`
  hashes its source, which §6 forbids for `state/redaction.key`. Task 21's read spy caught it.
- **A rolled-back uninstall loses its nonce and allocator, and the durable fix belongs in Core.**
  `removeEnvelopeLeaves` calls `controlFiles` for every terminal uninstall with no outcome to
  branch on; measured, that left a home §2.1 can no longer admit. This task's adapter guards on
  the restored manifest, so the CLI contract holds and Task 24's kill matrix exercises the guarded
  path; the Core row stays open for any other caller and is carried on Task 25's deferred fix list.
- **Two architecture citations turned red and both were already mis-aimed.** Creating
  `apps/cli/src/lifecycle/uninstall.ts` made two bare `uninstall.ts` citations — at lines 397 and
  560 of the commands module — ambiguous, which is what the gate caught. But checked against
  `HEAD~1`, neither line held its claim before this task either: 397 was a field of
  `planUninstall`'s return type and 560 a comment about `sourceRoot`. **Never restate a bare
  `name.ts:NN` citation in prose while repairing it**: this correction re-armed the same gate once,
  because the gate reads the quoted token, not the sentence around it. `npm run lint` does not run `citations.test.ts`, so D32's deferral
  is why this reached the integrated tree. `docs/architecture/foundation-constraints.md` now names
  the symbol `planUninstall`, because the claim there is a behaviour; `docs/architecture/threat-model.md`
  takes the verified `apps/cli/src/commands/uninstall.ts:842`, the `readConfigFile` call, because
  that row's evidence is a line list. NEW-87 still owns the other entries of that row, which were
  not audited here.
- **Three Cover bullets are implemented but not directly asserted**, and are carried to Task 25's
  deferred fix list rather than left silent: the lease `dev`/`ino` swap refusal, which needs a
  mid-run path-swap hook and is a security guard covered only by inspection; `M(commit_absence)`'s
  third-manifest exit 6, covered at Core level in `manifest-state.test.ts`; and "a missing artifact
  is already clean", covered by construction.

**Files:**
- Create: `apps/cli/src/lifecycle/uninstall.ts`
- Create: `apps/cli/src/lifecycle/uninstall.v2.test.ts`
- Modify: `apps/cli/src/lifecycle/redaction-key.ts` — the `K` adapter
- Modify: `apps/cli/src/commands/uninstall.ts` — export `resolveRoots`, `partitionArtifacts`, `planUninstall`, `planRevert`, `removeDirectories`; the V2 branch calls `LifecycleUninstaller`
- Modify: `apps/cli/src/commands/uninstall.test.ts` — "still reports and preserves retained evidence when the manifest is absent" succeeds again (`removed: []`)
- Modify: `apps/cli/src/main.test.ts` — "renders retained evidence after uninstall instead of claiming nothing remains" returns 0 for the second uninstall again
- Modify: `tests/e2e/fresh-v2-retained-bootstrap.test.ts` — the reinstall after uninstall succeeds again (Scope decision 11), and `removed.data.transactionId` matches `/^lc_[0-9a-f]{64}_[0-9]+$/u`
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Tasks 8, 9, 14–21; `ManifestStateParticipant`; `encodeUninstallingMarker`; `observeLifecycleActivationRecord` (Task 17).
- Produces:

```ts
export interface LifecycleUninstallRequestV1 {
  readonly context: CliContext; readonly lifecycle: CliLifecycleContext;
  readonly key: LifecycleHomeKeyV1;
  /** Present for a fresh uninstall; null when recovery resumes one whose manifest is already moved. */
  readonly admitted: AdmittedV2HomeV1 | null;
  readonly evidence: BootstrapEvidenceAdmissionV1; readonly options: UninstallOptions;
}
export interface LifecycleUninstallPreviewV1 {
  readonly variant: "uninstall/present_manifest" | "uninstall/present_manifest_without_launchd";
  readonly removable: readonly string[]; readonly preserved: readonly string[];
  readonly builder: LifecycleExecutionBuilderV1<LifecycleExecutionPlanV1>;
}
export type UninstallBoundaryV1 =
  | LifecycleCoordinatorBoundaryV1
  | { readonly kind: "lease_path_removed"; readonly job: ScheduledJobIdV1 }
  | { readonly kind: "empty_directory_removed"; readonly path: CanonicalAbsolutePathV1 };
export class LifecycleUninstaller {
  constructor(dependencies?: { readonly afterBoundary?: (boundary: UninstallBoundaryV1) => void | Promise<void> });
  /** Allocation-free: reads and partitions only; used by --dry-run and by execute. */
  preview(request: LifecycleUninstallRequestV1, global: HeldLifecycleStableLockV1): Promise<LifecycleUninstallPreviewV1>;
  execute(request: LifecycleUninstallRequestV1): Promise<UninstallResultV1>;
}
export function createUninstallAdapters(input: {
  readonly request: LifecycleUninstallRequestV1; readonly foundation: FoundationParticipantExecutor;
  readonly manifest: ManifestStateParticipant; readonly afterBoundary?: (boundary: UninstallBoundaryV1) => void | Promise<void>;
}): LifecycleParticipantAdaptersV1<LifecycleExecutionPlanV1>;
export class UninstallCapacityError extends Error { readonly code: typeof EXIT_CODES.capabilityUnavailable; readonly reason: "uninstall_artifact_capacity_exceeded" }
```

- [x] **Step 1: Write failing coordinator tests on real V2 homes**

```ts
it("uninstalls through one without-launchd coordinator and leaves exactly the bookkeeping set and retained evidence", async () => {
  const fixture = await initializedV2Fixture("uninstall-coordinator");
  const retained = await fixture.bootstrapEvidenceIdentities();

  const result = await runUninstall(fixture.context, ACCEPTED);

  expect(result).toMatchObject({ ok: true, data: { transactionId: expect.stringMatching(/^lc_[0-9a-f]{64}_[0-9]+$/u) } });
  expect(fixture.publishedPlans.at(-1)?.steps.map((step) => step.kind)).toStrictEqual([
    "foundation", "drain_runners", "foundation", "redaction_key", "manifest", "manifest", "redaction_key", "manifest",
  ]);
  expect(fixture.reservedPrefixes).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "mf"]);
  expect(await fixture.bootstrapEvidenceIdentities()).toStrictEqual(retained);
  expect(await productHomeResidue(fixture)).toStrictEqual(bookkeepingSetAndRetainedEvidence(fixture));
  expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it.each([
  ["an automation lifecycle record in the configuration", plantAutomationLifecycleRecord],
  ["an active automation arm in the activation record", plantActiveAutomationActivation],
])("refuses the P variant selected by %s as unsupported until plan 1b (D24)", async (_label, plant) => {
  const fixture = await initializedV2Fixture("uninstall-p-variant");
  await plant(fixture);
  const before = await allocatorCounter(fixture);
  expect(await runUninstall(fixture.context, ACCEPTED)).toMatchObject({ ok: false, code: EXIT_CODES.capabilityUnavailable, error: { kind: "unsupported_until_plan_1b" } });
  expect(await allocatorCounter(fixture)).toBe(before);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("re-derives the empty-directory list from the tombstone after a death between an rmdir and the tombstone deletion (D25)", async () => {
  const fixture = await initializedV2Fixture("uninstall-directory-crash");
  await plant(join(fixture.paths.logsDir, "unrelated.txt"), "synthetic");
  const uninstaller = new LifecycleUninstaller({ afterBoundary: dieAtFirst("empty_directory_removed") });
  await expect(uninstaller.execute(requestFor(fixture))).rejects.toThrow(SyntheticDeath);
  expect(await exists(manifestTombstoneOf(fixture))).toBe(true);

  const { snapshot } = await recoverUninstall(fixture);

  expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  expect(await exists(manifestTombstoneOf(fixture))).toBe(false);
  expect(await exists(join(fixture.paths.home, "rollback"))).toBe(false);
  expect(await exists(fixture.paths.logsDir)).toBe(true);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("re-drains after a death that followed R and removes each lease only while its descriptor is held", async () => {
  const fixture = await initializedV2Fixture("uninstall-death-after-drain");
  const uninstaller = new LifecycleUninstaller({ afterBoundary: dieAfterJournalRewriteAt("drain_runners") });
  await expect(uninstaller.execute(requestFor(fixture))).rejects.toThrow(SyntheticDeath);

  await recoverUninstall(fixture);

  const locks = fixture.stableLockEvents;
  for (const job of SCHEDULED_JOB_IDS) {
    const lease = join(fixture.paths.stateDir, `.automation-${job}.lock`);
    const removedAt = fixture.boundaries.findLastIndex((boundary) =>
      boundary.kind === "lease_path_removed" && boundary.job === job);
    expect(removedAt).toBeGreaterThanOrEqual(0);
    expect(locks.lastIndexOf(`acquire ${lease}`)).toBeLessThan(locks.lastIndexOf(`release ${lease}`));
    expect(await exists(lease)).toBe(false);
  }
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

Test-local helpers:
- `initializedV2Fixture(name, options?)` initialises a V2 home. With `{ lifecycleClock: "fake" }` it injects a lifecycle clock whose `sleepMs` advances `nowMs` instantly.
- `publishedPlans` and `reservedPrefixes` read the persisted coordinator plan through the store and decode the reserved IDs' prefixes.
- `recoverUninstall(fixture)` acquires the global lock, builds the key as `{ productHome: home, nonce: await coordinatorNonceOf(...) }` — the manifest is gone at every point it is called, so the nonce comes from the ledger's `lc_` leaf, never from admission — and calls `LifecycleRecoveryService.recover(global, { resumeUninstall: true })`, because dispatch arrives in Task 23.
- `plantAutomationLifecycleRecord` writes a schema-valid `automation.lifecycle` table into `config.toml`; `plantActiveAutomationActivation` writes a canonical activation record whose automation arm is `active`.
- `dieAtFirst(kind)` and `dieAfterJournalRewriteAt(stepKind)` throw `SyntheticDeath` at the first matching boundary.
- `fixture.boundaries` is a local array the test's own `afterBoundary` collects. Lease removals are read from the `lease_path_removed` boundary the uninstaller emits, not from a side channel; the assertion below compares the boundary's order against `stableLockEvents`' acquire and release entries.

Cover:
- Variant derivation (D24): the plan is `uninstall/present_manifest_without_launchd` with null launchd arms, empty `plistPaths` and `previewHash: null`. A plist row in the manifest also selects the `P` variant and refuses — prove it through `LifecycleUninstaller.preview` over a synthetic manifest, since a real V2 fixture cannot own a LaunchAgents row. A directory at `state/lifecycle-activation.json` refuses exit 6 `activation_record_invalid`, never "absent".
- Reservation (D28): order is `lc`, marker forward, marker compensation, artifacts forward, artifacts compensation, `mf`, in one block of six.
- `F(uninstall_marker)` replaces the empty `state/uninstalling.json` reservation with the canonical marker.
- `F(uninstall_artifacts)` removes the four lease paths first, then every removable file row in unsigned UTF-8 order, then `state/uninstalling.json` last. The nonce, the allocator, the manifest itself, the bookkeeping set, Brain rows and retained evidence are never mutations.
- An edited `content` artifact refuses exit 3 before allocation, naming it; a missing artifact is already clean.
- D26: more than 256 artifact mutations refuses `uninstall_artifact_capacity_exceeded` exit 4 before allocation, proven with a synthetic manifest over the in-memory port.
- `K(stage)` renames the key to `state/.redaction.key.<id>.tombstone` with no read, and `K(delete)` unlinks only that identity; a pre-existing key tombstone refuses exit 6.
- `M(preserve_before)` moves the manifest to `.installation-manifest.<mf-id>.json.tombstone` no-replace. `M(commit_absence)` requires the original absent and the tombstone hashing to `before.hash`; a third manifest appearing afterwards is preserved exit 6.
- D25: `M(finalize_tombstones)` removes the preimage manifest's empty directory rows inside the removable partition, deepest first, excluding the bookkeeping set, before it deletes the tombstone; a non-empty directory is preserved and listed in `preserved`.
- I2's regression: an `init` whose `brainPath` is not the default (fixture `env: { DEVELOPER_OS_BRAIN: <custom> }`), killed at the first `empty_directory_removed`, recovers through a context built over the same `root` without that variable (`createCommandFixture(name2, { root: fixture.root, bootstrapAvailable: true })`), so the recovering process resolves the default Brain. Recovery completes, the tombstone is gone, and the custom Brain is untouched.
- Death at `M(preserve_before)` compensates `M(preserve_before)^-1`, `K(restore)`, `F(uninstall_artifacts)^-1`, `F(uninstall_marker)^-1`, restoring manifest, key, leases and every artifact byte-for-byte. Death after durable `M(commit_absence)` force-forwards to completion.
- Lease drain: a lease held by the test makes the drain refuse at the deadline (fake clock) with the marker durable, the global lock released before any lease acquisition, and every acquired lease released. Before `F(uninstall_artifacts)` applies, `stepHooks.before` requires each held lease's `dev`/`ino` to equal its path's `lstat`, refusing exit 6 on a swapped path; `stepHooks.after` verifies each lease path absent before releasing its descriptor.
- Terminal compaction removes every participant leaf, the coordinator staging, then allocator, nonce, journal, lock and plan, and leaves `state/.lifecycle.lock` and every bookkeeping directory.
- Key content is never read (Task 21's spy); no `launchctl`, `git` or vendor process runs.
- The Task 21 interim rewrites return to success: `uninstall.test.ts` "still reports and preserves retained evidence when the manifest is absent" and `main.test.ts` "renders retained evidence after uninstall instead of claiming nothing remains" expect a successful second uninstall (`key_absent`, `removed: []`); `tests/e2e/fresh-v2-retained-bootstrap.test.ts` expects the reinstall to succeed with two bootstrap IDs, as it did before Task 2.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts`

Expected: FAIL — `uninstall.ts` does not exist, and V2 uninstall still uses the Foundation downcast.

- [x] **Step 3: Implement the planner and adapters**

Planning happens under the global lock and allocates nothing:
1. Run `recover(global, { resumeUninstall: true })` and require closure `clear`.
2. Derive the variant **at planning time only**, through Task 8's `deriveUninstallLaunchdEvidence`, from `observeLifecycleActivationRecord`, the validated configuration's `automation.lifecycle`, and the manifest's plist rows. A14's three conditions are exact: it is `uninstall/present_manifest_without_launchd` exactly when the manifest owns no plist artifact (§6's closed external-plist rows), the validated configuration has no `automation.lifecycle` record, and the activation record is absent or its `automation` arm is `inactive`; an activation path that is not a guarded regular file is recovery-required, never absent. Any evidence throws `LifecycleUnsupportedLeafError`. Validation and recovery never re-derive it, because the evidence is gone by then: `F(uninstall_artifacts)` has removed `config.toml` and the activation record and `M(commit_absence)` has tombstoned the manifest, so a re-derivation at a later cursor would select the other row and refuse this coordinator's own plan-hash-bound plan. The plan hash binds the shape instead, and Task 8's `validateLifecyclePlanGrammar` checks that bound shape against its row. Passing `facts.uninstallLaunchdEvidence` is therefore this task's responsibility, and a boolean contradicting its own evidence is caught only by that shape check — call `deriveUninstallLaunchdEvidence`, never hand-compute the disjunction.
3. Partition with the exported `resolveRoots`/`partitionArtifacts`/`planUninstall`, using owned roots `[home]` and excluded roots `[brain, ...evidence.retainedRoots, ...lifecycleBookkeepingPaths(home)]`.
4. Derive forward mutations and their preimage bytes (each ≤ 16 MiB); refuse `UninstallCapacityError` when the artifact mutations exceed 256.
5. Compute the marker bytes from the plan clock, and observe the key with `observeSecretOpaqueKey`.
6. Build the plan through a `LifecycleExecutionBuilderV1` whose `build(ids)` binds `lc`, the four `tx` IDs and then `mf`.
7. Call `assertLifecycleExecutionFeasible`, then `reserveLifecycleIdBlock(6)`.
8. Stage both Foundation pairs with `FoundationParticipantExecutor.stage`, publish with the store, then run `LifecycleCoordinator.execute`.

Adapters:
- `drainRunners`: release the global lock; `locks.acquireExistingWithin(uninstallLeasePaths(home), { nowMs, sleepMs, deadlineMs: nowMs() + LIFECYCLE_LEASE_DRAIN_MS })`; keep the handles; reacquire the global lock non-blockingly (busy releases the leases and refuses exit 6); return the new handle.
- `stepHooks.before` for the `F(uninstall_artifacts)` step: if any lease path still exists and its lease is not held, drain as above. Then require each held lease's `dev`/`ino` to equal its path's `lstat`, else refuse exit 6. When no lease path exists, hold nothing.
- `stepHooks.after` for that step: verify each lease path absent, then release each descriptor.
- `manifest`: maps onto `ManifestStateParticipant.apply`/`observe`/`compensate`/`compact`, constructed with a `manifestAdmission` whose `admitOwnerPath` is `createOwnerPathAdmission({ kind: "unconfined", reason: "uninstall manifest bytes are hash-pinned to ManifestStatePlanV1.before.hash" })`. `commitAbsence` is the observation requirement above.
- `finalizeTombstones` authenticates the tombstone by hash alone: read it, require its SHA-256 to equal `before.hash`, then `validateManifestV2` with that same unconfined admission. It takes the directory rows structurally — every `kind: "directory"` row at or below `plan.authority.productHome`, minus `lifecycleBookkeepingPaths(productHome)` — and removes each empty one deepest first through the exported `removeDirectories` (absent is complete, non-empty is preserved and reported). It never resolves the configured Brain: `F(uninstall_artifacts)` has already removed `config.toml`, so a recovering process would resolve `paths.brain` to the default (`resolveRuntimePaths`) and a confined admission would refuse every home whose `brainPath` was not the default. The removable partition excludes the Brain in any case, and `init` refuses a Brain inside the product home, so "at or below the product home" is the same set.
- `controlFiles`: `unlinkExact` of the allocator, then the nonce, each followed by `syncDirectory(state)`.

`LifecycleUninstaller` emits `afterBoundary` at every coordinator boundary plus `lease_path_removed` and `empty_directory_removed`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'manifest is absent|symlink|relocated Brain|control character|preserving every retained bootstrap evidence inode|dry-runs and reports retained evidence|retention roots|deep inside a retained tree|ephemeral V2 artifact'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'renders retained evidence|admits every ordinary command'`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts security/sentinel.test.ts`

Expected: PASS. Add `uninstall.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/uninstall.ts apps/cli/src/lifecycle/uninstall.v2.test.ts apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/main.test.ts tests/e2e/fresh-v2-retained-bootstrap.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): uninstall a V2 home through a drained lifecycle coordinator"
```

### Task 23: Uninstall dispatch and the recovery-only arm · M

Source: old Task 23 (recovery half). A7 and A14/A15 recovery-only arm (Spec 1 §2.1); A3/A7/A12 dispatch order (§6); §7 "V2 admission is structural" (recovery-only clause).

Corrections this task's implementation forced, recorded against the steps below:

- **Step 1's chain cannot run on one shared home, and the reason is a product defect this task did
  not cause — NEW-99.** After one `uninstall` → `init` round trip, every later `uninstall` and every
  V2 mutation on that home refuses exit 6 `lifecycle_ledger_finding`. The chain therefore uses one
  fresh home per kill point and asserts the round trip once. **A9 round-trip coverage drops from six
  consecutive cycles to one, and six cycles is exactly the shape that would have caught NEW-99** —
  restoring the shared-home chain is gated on the fix and must land in the same change. Proven
  pre-existing by reverting `apps/cli/src/commands/uninstall.ts` to this task's base and observing
  the identical failure.
- **`CliLifecycleContext.recovery` forwards no `afterBoundary`,** so the last three kill points are
  unreachable from a hook. They are reached instead by wrapping the product's own
  `controlFiles.removeNonce` and performing `removeEnvelopeLeaves`' next two unlinks directly. A
  fifth staged path for a test-only seam was declined here; **Task 24's kill matrix will want that
  seam**, and taking it there is the cheaper place.
- **The fixture's `InProcessLockProvider` creates no lock file, so the `plan plus lock` kill point
  silently collapsed into `plan only` and passed.** It is now planted in the exact shape the ledger
  admits. A kill point that degenerates into its neighbour is a test asserting nothing.
- **`recoverUninstall` returns `CliResult<UninstallResultV1>`,** not the bare result, forced by the
  declined-prompt arm. All three exports take an optional `evidence`, forced by Task 22's "exactly
  one evidence inspection" rule plus the residue dependency. `selectUninstallCoordinator` is
  exported because two uninstall journals and a non-uninstall coordinator are not constructible on
  a real home in 1a.
- **`runUninstall`'s catch now publishes `paths` and `recovery` from `LifecycleRecoveryRefusalError`
  as well**, without which the standalone-journal arm refused exit 6 without naming `repair` — the
  recovery string §2.3 requires.
- **`pre_journal_orphan` refuses exit 6 by construction** and is unreachable with the manifest
  absent, so that arm is reasoned rather than tested. Carried to Task 25's deferred list.

**Files:**
- Create: `apps/cli/src/lifecycle/uninstall-recovery.ts`
- Create: `apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts`
- Modify: `apps/cli/src/commands/uninstall.ts` — `runUninstall` dispatch
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Tasks 12, 16, 17, 19, 21, 22.
- Produces:

```ts
export type UninstallDispatchV1 =
  | { readonly kind: "v1_foundation" }
  | { readonly kind: "v2_coordinator"; readonly admitted: AdmittedV2HomeV1 }
  | { readonly kind: "recovery_only"; readonly id: LifecycleCoordinatorIdV1; readonly key: LifecycleHomeKeyV1; readonly arm: "compensation" | "force_forward" | "envelope_suffix" }
  | { readonly kind: "absent_manifest" };
export async function dispatchUninstall(context: CliContext, lifecycle: CliLifecycleContext): Promise<UninstallDispatchV1>;
export async function admitRecoveryOnlyUninstall(context: CliContext, lifecycle: CliLifecycleContext, global: HeldLifecycleStableLockV1): Promise<Extract<UninstallDispatchV1, { kind: "recovery_only" }> | null>;
export async function recoverUninstall(context: CliContext, lifecycle: CliLifecycleContext, dispatch: Extract<UninstallDispatchV1, { kind: "recovery_only" | "v2_coordinator" }>, options: UninstallOptions): Promise<UninstallResultV1>;
```

- [x] **Step 1: Write failing dispatch tests over killed uninstalls, chained on one home**

```ts
it("admits the recovery-only arm at each kill point and resumes to an absent-manifest home", async () => {
  const fixture = await initializedV2Fixture("uninstall-recovery-chain");
  const points = [
    ["M(preserve_before) applied, cursor not advanced", "compensation"],
    ["M(commit_absence) durable", "force_forward"],
    ["M(finalize_tombstones) after one empty-directory removal", "force_forward"],
    ["coordinator_envelope after nonce removal", "force_forward"],
    ["plan plus lock", "envelope_suffix"],
    ["plan only", "envelope_suffix"],
  ] as const;
  expect(points.length).toBeGreaterThan(0);
  for (const [point, arm] of points) {  // CHAIN_TIMEOUT_MS below is set from this file's first measured run
    await killUninstallAt(fixture, point);
    expect(await dispatchUninstall(fixture.rebuildContext(), lifecycleOf(fixture)), point).toMatchObject({ kind: "recovery_only", arm });
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, point).toBe(true);
    if (arm === "compensation") expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, `${point} then uninstall`).toBe(true);
    expect(await dispatchUninstall(fixture.rebuildContext(), lifecycleOf(fixture)), point).toStrictEqual({ kind: "absent_manifest" });
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok, `init after ${point}`).toBe(true);
  }
}, CHAIN_TIMEOUT_MS);
```

`killUninstallAt` runs `new LifecycleUninstaller({ afterBoundary })` whose hook throws `SyntheticDeath` at the named boundary. Each iteration re-initialises the same home, so the chain costs seven real `init`s rather than twelve. `CHAIN_TIMEOUT_MS` is a file-local constant: run the file once with `4 * REAL_FILESYSTEM_TIMEOUT_MS` to measure, then set it to ceil(measured × 2 × 1.5) so a hosted runner at ~2× cannot trip it, and cite the measurement in a one-line comment.

Cover:
- Dispatch order: V1 manifest, then V2 manifest, then the recovery-only arm, then the absent-manifest arms.
- A V2 manifest with a non-terminal uninstall coordinator resumes it instead of starting a second. A V2 manifest with a non-terminal standalone Foundation journal refuses exit 6 naming `repair`.
- A missing manifest with a lock but no uninstall plan goes to the absent-manifest arms, which never acquire the lock.
- Before `M(commit_absence)` the arm admits only compensation, with the manifest absent, its tombstone present, and the key tombstone present exactly when `before` was present.
- From `M(commit_absence)` it admits only force-forward: the manifest tombstone present exactly while the cursor precedes `M(finalize_tombstones)`, present or absent (with every empty directory already gone) while the cursor is at it (A15), the key tombstone present exactly while the cursor precedes `K(delete)`, and nonce/allocator in one of the three legal microstates.
- A manifest reappearing while the arm is admitted is preserved exit 6. Two uninstall journals, a non-uninstall coordinator, or nonce absent with allocator present refuse exit 6.
- `--dry-run` on every arm reports and mutates nothing; a busy global lock refuses exit 6.

Put the cheap cases (dispatch order over planted plans, refusals, dry run) in the same file on the one shared home.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-recovery.v2.test.ts`

Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement**

`runUninstall` becomes: `assertHomeShape` → evidence inspection → `dispatchUninstall` → the V1 path unchanged, `LifecycleUninstaller`/`recoverUninstall`, or `runAbsentManifestUninstall`. `admitRecoveryOnlyUninstall` runs only when the manifest is absent and `state/.lifecycle.lock` has its exact shape: it acquires the lock, builds the key from `coordinatorNonceOf` (never from admission, which refuses `manifest_absent`), inspects the ledger, and requires exactly one uninstall coordinator record of either variant whose state matches one bullet of §2.1's recovery-only arm, including A15's microstates at `M(finalize_tombstones)`. Recovery runs `LifecycleRecoveryService.recover(global, { resumeUninstall: true })`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-recovery.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'idempotent|dry run|declined|symlink'`

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts`

Expected: PASS. Add `uninstall-recovery.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/uninstall-recovery.ts apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts apps/cli/src/commands/uninstall.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): dispatch uninstall through its recovery-only arm"
```

### Task 23b: Scope retained-envelope inventory to its own envelope (NEW-99) · M

Inserted by D38. Spec 1 §7 "altered retained evidence never refuses `uninstall`"; A9's round trip;
A13 closure admits retained bootstrap evidence. It unblocks Task 24, whose headline case is the first
operation to reach the defect.

Corrections this task's implementation forced, recorded against the steps below:

- **The reader does not walk a shared directory exhaustively, and that is what makes the fix safe.**
  The task text said `inventoryExactNamespaces` sweeps a root exhaustively; in fact `inventoryTree`
  runs only for `INITIAL_NAMESPACE`-named roots, and other directories go through
  `inventoryDirectNamespaces`, which filters children. That is the proof that id-attribution loses no
  tamper detection: every name a shared parent can surface carries a bootstrap id except
  `.lifecycle-bootstrap.lock`, which is already a retention location.
- **The inventory call itself is unchanged.** Its `[4, 322]` / `walks === 158` grouping is a pinned
  contract, so the fix narrows the three consumers — `retainedByPath`, `unboundEntries` and
  `sumEntries` — to an id-attributed subset. The union still leaves `inspectPlan` as `retained`,
  because the caller's aggregate and `retainedPaths` are home-wide and A2/D21 forbids unlinking a
  retained tombstone this sweep is the only witness to. No guard was weakened: `altered === 0` and
  the `unboundEntries` confinement check are untouched.
- **One intended behaviour change beyond the counts.** With `confinedUnboundEntries` scoped, a
  round-tripped home's retained envelopes can become `inert`, so `blocksNewIntent` can flip true →
  false. Correct per §6.4 and exercised by cycles 2–6 of the restored chain, but a reviewer tracing
  `blocksNewIntent` will find it and should not read it as a regression.
- **The restored chain costs 2.3× the workaround it replaces**, and the shape is quadratic in cycle
  count because cycle *k* inspects *k* retained envelopes. `uninstall-recovery.v2.test.ts` goes
  527.3 s → 1147.2 s and `CHAIN_TIMEOUT_MS` 1,405,000 → 3,266,000 ms. This is what forced D39.
- **`apps/cli/src/bootstrap/executor.test.ts` is argued unaffected, not run** (D32). It never calls
  `runUninstall`; every case is one `init` with an optional interrupt or resume, and the one rollback
  case that could start a second id asserts `resumed.ok === false`. On a single-envelope home the new
  filter is the identity function. The argument is recorded here so plan close can check it rather
  than rediscover it.
- **`CHAIN_TIMEOUT_MS` rests on one per-case observation**, where every other figure in this job is a
  maximum of two or more, because only the second run carried a verbose reporter. It was scaled by
  the whole-file spread rather than taken raw, and its margin is 3×.

**The defect, as measured.** After one `uninstall` → `init` round trip a home carries two retained
bootstrap envelopes. `inspectBootstrapEvidenceAdmission` then reports the **same** `entryCount` and
`regularFileBytes` for both, because each envelope's retention inventory is namespace-scoped rather
than envelope-scoped: `inventoryExactNamespaces([...roots, ...rowParents])` in
`apps/cli/src/bootstrap/report.ts` walks the manifest rows' parent directories exhaustively, and two
installations share those parents, so every entry of the other envelope comes back as this
envelope's. Both envelopes consequently leave `verified`; `retainedEnvelopes` keeps only entries
whose `verifiedEnvelope` is non-null, which requires `summary.status === "verified"`, so it empties;
`residueFrom`'s `bootstrapParticipantIds` empties with it; and the ledger reads both bootstrap
Foundation staging trees as unattributable findings, refusing exit 6 `lifecycle_ledger_finding` on
every later `uninstall` and every V2 mutation. Proven pre-existing by reverting
`apps/cli/src/commands/uninstall.ts` to `cce9432` and observing the identical failure.

**Files:**
- Modify: `apps/cli/src/bootstrap/report.ts` — the retention inventory and whatever the fix shows is
  downstream of it
- Modify: `apps/cli/src/bootstrap/report.test.ts` — the failing regression case first (`suite` job,
  **not** deferred by D32)
- Modify: `apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts` — restore Task 23's shared-home
  chain (`lifecycle-v2` job)
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes` if the restored chain
  changes the file's measured duration

**Interfaces:** consumes Tasks 22 and 23. Produces no new export; it repairs an existing contract.

- [x] **Step 1: Write the failing regression case in `report.test.ts`**

Two retained envelopes over the guarded reader, sharing their manifest rows' parent directories.
Assert that each envelope's `entryCount` and `regularFileBytes` count **only its own** retained
rows, that both keep `status: "verified"`, and that `retainedEnvelopes` has both. Assert the
expected set is non-empty before asserting over it. This case must fail on the current tree for the
stated reason, and it is the gate that makes this fix shippable rather than argued.

- [x] **Step 2: Run it and verify it fails**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t '<the new case>'`

Expected: FAIL — both envelopes report the union of the two.

- [x] **Step 3: Fix the scoping**

Scope each envelope's retention inventory to the rows that envelope's own plan and terminal journal
derive, rather than to the parent namespaces those rows happen to sit in. `deriveBootstrapRetentionLocations`
already yields this envelope's exact `sourcePath`/`tombstonePath` pairs; `rowParents` is what widens
it. Whatever `rowParents` was there to catch — an entry inside a row's parent that no location names
— must keep being caught, but attributed to the envelope that owns it, never to both. If the honest
fix needs a new seam in the reader, take it and say so; do not weaken the `altered === 0` rule or the
`unboundEntries` confinement check to make the case pass, because those are the guards that make
tampered evidence observable.

- [x] **Step 4: Restore Task 23's shared-home chain**

Task 23 worked around this defect with one fresh home per kill point, dropping A9 round-trip coverage
from six consecutive cycles to one. Restore the single chained home in
`apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts` and re-derive `CHAIN_TIMEOUT_MS` from a fresh
measurement, citing it in its one-line comment. Six cycles is the shape that would have caught
NEW-99; the restored chain is this task's proof that it is closed.

- [x] **Step 5: Run the gates**

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts` — in full, not filtered.

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-recovery.v2.test.ts`

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts src/lifecycle/mutation-gate.v2.test.ts`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts`

Run: `npx vitest run --root tests repository/citations.test.ts`, then `npm run lint`.

`apps/cli/src/bootstrap/executor.test.ts` stays deferred to plan close under D32, like every other
task's slow suite; D38 turns on `report.test.ts` being fast and not deferred.

- [x] **Step 6: Gate and commit**

Tick and update the progress sentence, then:

```bash
git add apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git diff --cached --name-only
git commit -m "fix(cli): scope retained-envelope inventory to its own envelope"
```


### Task 24: Uninstall → `init` round-trip gates · L

**DEFERRED (D42, 2026-09-22): not executed inside plan 1a.** Carved out to post-A16 hardening,
tracked as `BACKLOG.md` NEW-100. Wave 10 (Task 25) no longer waits on this task. The spec below is
unchanged and still the one to follow when it is eventually run.

Source: A9; Spec 1 §7 "uninstall then init round-trips" (every sequence except plan 1b's `git enable` preview half and the three Task 21 sequences), "uninstall respects ownership", "uninstall removes its manifest recoverably" (A15).

**Files:**
- Create: `apps/cli/src/lifecycle/uninstall-round-trip.v2.test.ts`
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: Tasks 20–23.
- Produces: no production interface; evidence for the Phase 4 gate.

- [ ] **Step 1: Write the chained round trips**

```ts
it("round-trips init → uninstall → uninstall → init → uninstall → init without manual action", async () => {
  const fixture = await createCommandFixture("round-trip-cycles", { bootstrapAvailable: true });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  for (const cycle of [1, 2]) {
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, `uninstall ${String(cycle)}`).toBe(true);
    if (cycle === 1) expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, "uninstall again").toBe(true);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok, `init ${String(cycle + 1)}`).toBe(true);
  }
  expect(new Set((await fixture.bootstrapEvidenceIdentities()).map((entry) => entry.id)).size).toBe(3);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("recovers an uninstall killed at each retained A9 point and then initialises, reusing one chained home", async () => {
  const fixture = await createCommandFixture("round-trip-kill-matrix", { bootstrapAvailable: true });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  expect(A9_KILL_POINTS.length).toBeGreaterThan(0);
  for (const point of A9_KILL_POINTS) {
    await killUninstallAt(fixture, point);
    expect((await runUninstall(fixture.rebuildContext(), ACCEPTED)).ok, `recover ${point}`).toBe(true);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok, `init after ${point}`).toBe(true);
  }
}, KILL_MATRIX_TIMEOUT_MS);
```

`KILL_MATRIX_TIMEOUT_MS` is a file-local constant derived the same way as Task 23's: measure once with `4 * REAL_FILESYSTEM_TIMEOUT_MS`, then set ceil(measured × 2 × 1.5) with the measurement in a one-line comment.

**D39 cuts `A9_KILL_POINTS` from ten to six.** Apply D39's selection rule to the list below — one point per distinct recovery arm *and* per distinct control-file microstate the code branches on, `plan plus lock` surviving over `plan only` — and record the four dropped points and each one's equivalence argument in the report, so NEW-100 can restore them once the job is sharded. The full list D39 cuts from is:
- `M(preserve_before)` before its cursor advance, and after it;
- `M(commit_absence)`;
- `K(delete)`;
- `M(finalize_tombstones)`;
- the `coordinator_envelope` control files with both still present, with the allocator removed, and with both removed;
- plan plus lock;
- plan only.

A kill before durable `M(commit_absence)` compensates, so its recovery `runUninstall` restores the install and a second `runUninstall` completes it before `init`; the loop handles that case exactly as Task 23's chain does.

Cover in the same file:
- The Brain, its `.git` directory, and an unrelated file in the product home survive every uninstall (ownership).
- The `transactionId` of every V2 uninstall matches `lc_`.
- Closure is `clear` after every `init`.
- No step spawns `git`, `launchctl` or a vendor.

- [ ] **Step 2: Run the gates and apply the CI budget rule**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-round-trip.v2.test.ts`

Expected: PASS once Tasks 22 and 23 are correct; a failure is a defect there, fixed with a regression test first. The file runs about 14 real fresh V2 `init`s — about 31 local minutes, about 62 CI minutes. Add its measured duration to `lifecycle-v2`'s recorded local total and set `timeout-minutes` to ceil(total × 2 × 1.5). **Stop and ask before committing** if that exceeds 300.

- [ ] **Step 3: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/uninstall-round-trip.v2.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "test(cli): prove uninstall and init round-trip at every A9 point"
```

### Task 25: Plan 1a closure · M

**Deferred fix list (D36).** Everything below was found by a review, accepted, and deliberately not
fixed in its own task. Each needs a failing test first, then the smallest correction. This list is
the whole-plan review's starting point, not its scope — Tasks 14–25 received no per-task review at
all and must be covered from scratch.

- **Wave 5 produced the first integration failure D36 predicted, and the way it was found is the
  lesson.** Tasks 19 and 21 were implemented in parallel worktrees that could not contain each
  other, both reported green, and both were green in isolation. On the combined tree the first V2
  `uninstall` in `main.test.ts` refused exit 6 where it must return 0. Root cause, measured:
  `classifyBootstrapEvidence` requires `altered === 0`, so the one tampered byte the test plants in
  a retained tombstone flips the envelope to `altered`, `retainedEnvelopes` empties, `residueFrom`
  derives no `bootstrapParticipantIds`, and the ledger can no longer attribute that participant's
  own `staging/transactions` tree — `lifecycle_foundation_staging_name`, then
  `lifecycle_ledger_finding`, exit 6. **The test was wrong, not the gate**: the repository already
  handles this exactly that way in `tests/e2e/fresh-v2-retained-bootstrap.test.ts`, which restores
  the original bytes before its uninstall; `main.test.ts` was the lone outlier leaving a tamper in
  place across a mutation. Fixed in `5408725`, tests only, with Task 21's D27 assertions untouched.
  Nothing but the orchestrator's combined run could have caught it, which makes that run a hard
  requirement of §4.1 and not a formality. **For the rest of the plan: no task is ticked before its
  own gates run on the integrated tree, and a parallel wave reruns every participant's gates
  together before any of them is ticked.**
- **`tests/e2e/foundation.test.ts` cannot run under the agent harness's OS sandbox, and the failure
  looks exactly like a product hang.** The case spawns the compiled CLI and installs fake
  executables under `<repo>/.tmp-home`; under macOS Seatbelt it blocks and dies on the test's own
  120,000 ms timeout, leaving a `.tmp-home/dos<6>` holding only `home` and no `bin`. Unsandboxed it
  is ~3-6 s. This cost a false "Task 19 regressed the V1 path" call in the 2026-09-20/21 session:
  the pre-change control had been run unsandboxed and the post-change runs sandboxed, so the
  comparison measured the sandbox. **Run every `tests/e2e` command with the sandbox disabled, and
  never compare two runs that did not share that setting.** A leftover `dos<6>` directory with no
  `bin` is the signature.
- Wave 5's per-test headroom is thinner than the job budget suggests, and the job budget hides it.
  `REAL_FILESYSTEM_TIMEOUT_MS` is 900,000 ms per case. `absent-manifest-uninstall.v2.test.ts`
  measured 621.6 s for two cases, ~310 s each locally; a hosted `macos-15` runner was measured at
  ~1.9–2× local, which projects to ~590–620 s against that 900 s ceiling. The `lifecycle-v2`
  `timeout-minutes` can be green while one case times out. Measure the slowest single case on CI
  before the plan closes, and raise the per-case ceiling or split the case rather than discovering
  it in a red run. NEW-53 owns the underlying `init` cost.
- Task 19 found NEW-94 and NEW-95, both outside plan 1a's file lists. NEW-94 (fresh V2 `init` does
  not create `staging/lifecycle`) ships with a gate-side repair as its interim and needs a founder
  decision on where the durable fix goes, because it changes the fresh-install layout behind a
  330-minute deferred gate. NEW-95 (four commands cannot read a V2 manifest) blocks no user before
  Phase 4b but falsifies scope decision 5's runtime claim; the plan text now says so.
- Task 19 found NEW-96: one confined owner-path admission policy now exists in two copies.
- Task 19, two guards are argued by inspection and carry no test: the `live` flag that makes
  `allocateStandaloneFoundationId` refuse after `withLifecycleMutation`'s `finally` has released
  the lock (the floating-continuation hazard in the `AsyncLocalStorage` scope), and the
  grammar-invalid persisted plan throwing out of `LifecycleCoordinatorStore.read`. Build both
  fixtures. `controlFiles`' refusal is likewise untested, because no case drives a terminal
  coordinator through compaction.
- Task 19, `mutation-gate.v2.test.ts` has one order-dependent case: `refuses repair --resume of an
  ID that is not the only non-terminal entry` leaves two non-terminal journals that no gated verb
  can pass, so it is declared last on its home. Confirm that is robust rather than incidental.
- Task 19, four guarded-port calls carry the `identity-free stat:` marker to satisfy the
  repository lint's `identity-encoding` rule, which scopes in on any non-test module naming
  `dev`/`ino`. The alternative — adding the module to `STAT_OPTION_EXEMPT` — was outside the task's
  file list, and NEW-90 already owns that guard's granularity.
- Task 21 found NEW-93, which is outside plan 1a's file lists and must not be closed inside it:
  `projectRegularEntry` reads and SHA-256s `state/redaction.key` whenever it sits in a retained
  tree, against the Global Constraint that the key is never read, hashed or journaled. Whether the
  digest is *persisted* is unestablished. Settle that before the plan closes, because it decides
  whether this is a read or a journaling defect.
- Task 21, the check-then-unlink window is pinned only at the unit level: `deleteOrphanedKey` has
  no injectable seam between `observeSecretOpaqueKey` and `unlinkSecretOpaqueKey`, both of which
  use raw `node:fs/promises` rather than the guarded port. The test proves the detected case
  refuses and preserves everything; it cannot prove a closed window. §8.3 residual 8 stands.
- Task 21, two residue cases are proven with a doctored `BootstrapEvidenceAdmissionV1` (an
  `as unknown as` override of `retainedEnvelopes` / `active`) rather than real V2 evidence, to
  avoid two more real inits in `lifecycle-v2`. The core-level attribution refusal is pinned in
  `packages/core/src/lifecycle/absent-manifest.test.ts`; confirm the CLI seam is genuinely covered.
- Task 21, the new `uninstall.ts` ↔ `absent-manifest-uninstall.ts` import cycle wants a verdict:
  break it, or record that it is accepted.
- Task 18, the refusal reason code disagrees with the spec text. Scope decision 1 and the "No
  external effects" constraint both say a Git, launchd or push leaf refuses
  `unsupported_until_plan_1b`, but `failureFrom`'s `kindOf` reads `error.name` and publishes
  `lifecycle_unsupported_leaf`; the intended code survives only on `.reason`. Decide which is the
  contract and make one of the two match. Task 20 and Task 22 are the consumers.
- Task 18, `LifecycleCoordinatorStore.read` now throws on a grammar-invalid persisted plan instead
  of refusing `lifecycle_coordinator_plan_bytes`, because the grammar check moved to the store's
  own codec. Confirm every caller of `read` handles the throw; Task 19's preflight is the first.
- Task 18, Task 14's precondition 2 is **not** addressed: `requireOwnedDirectory` checks kind and
  mode `0700` but not `ownerUid`, because the store receives no `effectiveUid`. A foreign-owned
  directory inside an already-0700 home is unchecked at that one seam. Decide whether the guarded
  port's per-operation ownership check plus the ledger's `openRoot` is sufficient, or close it.
- Task 18, `lifecycleHomeKeyFromAdmission` carries no test: it needs an `AdmittedV2HomeV1`, which
  needs a real fresh V2 `init`, which its test files must not perform. Cover it from a
  `*.v2.test.ts` — Task 19's or Task 22's.
- Task 18, the `destination_git_effect` and `network_push` entries of `UNSUPPORTED_STEP_KINDS` are
  unreachable through `validate` and untested: both need `plan.push !== null` to clear core's
  `bindSteps`, and the push leaf codec refuses first. The observable contract holds; the entries
  stay for 1b. Confirm that is intended rather than dead code.
- Task 18, the synthetic-plan builder is duplicated between `apps/cli/src/lifecycle/codecs.test.ts`
  and `apps/cli/src/lifecycle/context.test.ts` because extracting it needed a ninth staged path.
  Extract it, together with Task 16's three-way duplicate below.
- Task 18, `CliLifecycleContext.recovery` is constructed and typed but never exercised: it needs
  participant adapters and a live coordinator. Tasks 21 and 22 are the first real callers — check
  the wiring there rather than trusting that it compiles.
- Task 16, obligation 3 carries no test: `LifecycleRecoveryService.removeOrphan` compares the final
  journal's identity against the producing scan's entry under the stable lock, but no fixture swaps
  that inode under the lock, so the check rests on code reading alone. Build the fixture.
- Task 16, `resumed` is safe only while `execute` is never re-entered concurrently. `planned` is the
  unique on-disk marker for "not started", and the one ambiguous pair is unobservable within a single
  process because the flag clears before the participant call and the global lock serialises callers.
  **If Task 18 ever re-enters `execute` concurrently this becomes wrong** — check it when Task 18 wires
  the composition root.
- Task 16, unbuilt overflow rows: the backups 100,000/100,001 boundary is not implemented (only the
  journal-root and staging rows are), and the 1,000,001-aggregate-leaf refusal is covered at
  recovery level as "refuses on any ledger finding and deletes nothing" rather than literally — Task
  11's `foundation-ledger.test.ts` pins the literal case against a streaming port.
- Task 16, manifest compensation runs more than once on a reverse prefix holding several `M` steps,
  plus once for the current unadvanced step. The adapter owns idempotency and the spec describes
  manifest rollback as one logical restore; confirm that is intended rather than assumed.
- Task 16, the synthetic-world scaffold is duplicated across the three new test files (~150 lines
  each) because extracting it needed a tenth staged path. Extract it.
- Task 14/15, duplicated computation that can drift into disagreement: `maximumFoundationJournalBytes`
  in `packages/core/src/lifecycle/store.ts` and `widestJournalBytes` in
  `packages/core/src/lifecycle/foundation-participant.ts` are the same 8-phase
  `encodeFoundationJournalJsonV1` loop, written twice. Task 14 mirrored Task 15's `PHASES` literal
  exactly. Have `foundation-participant.ts` import the exported one; if that would create an import
  cycle, move the computation to a module both can consume. Left duplicated they drift, and
  feasibility then disagrees with staging — a plan admitted as feasible whose participant journal
  will not fit.
- Task 17, message drift: `nonRegularLeaf`'s refusal string in `apps/cli/src/bootstrap/report.ts` is
  the module's only inline refusal literal; its two siblings are exported constants
  (`BOOTSTRAP_MANUAL_ARCHIVE`, `MALFORMED_V2_MANIFEST`). Export it as `NON_REGULAR_BOOTSTRAP_LEAF`
  and assert it by reference in the two `other` cases and the symlink case in `report.test.ts`. The
  drift this prevents is already present: `apps/cli/src/main.test.ts` re-declares
  `MALFORMED_V2_MANIFEST` as a local copy instead of importing it, so that assertion would survive a
  change to the real constant.
- Task 17, dead guard: under `it.fails`, the `lstat().isDirectory()` guard in the NEW-82 open-half
  case can no longer protect — any throw in the body counts as the expected failure, so the guard can
  only mask. Drop it; the assertion is now the whole contract.

- Task 22 opened NEW-97, a Core row it could not close inside its own file list: `removeEnvelopeLeaves`
  calls the `controlFiles` adapter for every terminal uninstall with no outcome to branch on, so a
  compensated run deletes the install nonce and the ID allocator of a home it has just restored —
  measured, not inferred. The CLI adapter guards on the restored manifest, so every 1a path is
  correct and Task 24's kill matrix exercises the guard; confirm the guard sits where a future
  non-CLI caller cannot miss it, or move it into Core.
- Task 22, three Cover bullets are implemented but not directly asserted. The one that matters is
  the lease `dev`/`ino` swap refusal in `stepHooks.before` — a security guard argued by inspection,
  needing a mid-run path-swap hook, in the same class as Task 19's two untested guards above. The
  other two are `M(commit_absence)`'s third-manifest exit 6 (covered at Core level in
  `manifest-state.test.ts`) and "a missing artifact is already clean" (covered by construction).
- Task 22 supplies the per-case measurement the headroom bullet above asked for: the slowest single
  case of `uninstall.v2.test.ts` is 185.1 s, swinging down to 148.2 s, which projects to ~280–370 s
  on a hosted runner against the 900,000 ms `REAL_FILESYSTEM_TIMEOUT_MS` ceiling. That is the widest
  per-case swing in the job. Task 24's kill matrix, which the plan estimates at ~14 real inits in one
  case, is the one to measure next, and it carries its own `KILL_MATRIX_TIMEOUT_MS`.
- Task 22 confirmed a pre-existing defect that its own change closes for the coordinator path only:
  the shipped V2 downcast uninstall refuses exit 3 on any home whose allocator counter has advanced,
  reading the V2 allocator row through the V1 drift comparison. It is documented in
  `mutation-gate.v2.test.ts`'s own docblock. Confirm no remaining caller reaches the downcast.
- **Task 24 is blocked by NEW-99 and the founder owns the decision.** After one `uninstall` → `init`
  round trip, the next `uninstall` refuses exit 6 `lifecycle_ledger_finding`, because two retained
  bootstrap envelopes each count the other's rows, both drop to `altered`, `retainedEnvelopes`
  empties and the ledger can attribute neither bootstrap staging tree. Task 24's headline case is
  `uninstall` → `init` → `uninstall`, so it cannot pass on the current tree. Proven pre-existing by
  reverting `apps/cli/src/commands/uninstall.ts` to Task 23's base. The fix is in
  `apps/cli/src/bootstrap/report.ts`, whose gate is the 330-minute `bootstrap-executor` job D32
  defers — the same shape D37 refused to ship unrun inside plan 1a. Restoring Task 23's shared-home
  chain, and with it A9's six consecutive cycles, belongs in that same change.
- Task 23, `pre_journal_orphan` refuses exit 6 by construction and is unreachable with the manifest
  absent, so that arm is reasoned rather than tested — the same class as Task 19's two guards and
  Task 22's lease `dev`/`ino` swap refusal above.
- Task 23 declined a fifth staged path for the test-only seam that `CliLifecycleContext.recovery`
  lacks: it forwards no `afterBoundary`, so the last three kill points are unreachable from a hook
  and are reached by wrapping `controlFiles.removeNonce` and performing two unlinks directly. Task
  24's kill matrix wants that seam; take it there rather than rediscovering the gap.
- **The citations gate went red twice in this wave and `npm run lint` covers neither occasion.**
  First when Task 22 added a second `uninstall.ts`, making two bare citations ambiguous; then again
  when the orchestrator's own correction note restated those bare tokens while documenting the
  repair. Both were caught only by running `tests/repository/citations.test.ts` by hand on the
  integrated tree. It is deferred by D32 into `test:suite`, so **every task from here runs it
  explicitly before its commit**, and no prose restates a bare `name.ts:NN` token.
- **A `--root tests` run inside a linked worktree can measure a different checkout** (NEW-98).
  `tests/vitest.config.ts` declares no source aliases by design, so those suites resolve through
  `tests/node_modules/@developer-os/*`; sharing that directory with another checkout makes every
  such link point away from the worktree. It produced one false e2e failure in Task 22 — the new
  `lc_` transaction ID reported as `tx_`, which was the base branch's code — and, worse, it can
  produce a false pass. Every `tests/**` gate in this plan must be rerun by the orchestrator on the
  integrated tree in the main checkout; the ones run inside a worktree are not evidence.

Source: `SESSION.md` §5 phase close; old Task 24 steps 4–7 narrowed to 1a; roadmap Phase 4.

**Files:**
- Modify: `docs/architecture/foundation.md`, `docs/architecture/foundation-constraints.md`, `docs/architecture/threat-model.md`
- Modify: `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`, `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`
- Modify: `docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md`
- Modify: `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` — §8.2 step 5 status line only
- Delete: `docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`

**Interfaces:**
- Consumes: every task above committed, pushed, and the latest completed CI run green.
- Produces: roadmap Phase 4 closed; `ORDER.md` NOW advanced to Phase 4b.

- [ ] **Step 1: Confirm the evidence set**

Run `git status --short` (must be clean) and `gh run list --branch development --limit 1 --json status,conclusion,headSha`: the head is pushed and no completed run on it is red. Confirm every checkbox of Tasks 12–24 is ticked (1–11 are listed under Completed), and that `git log --oneline 43c6876^..HEAD` lists one commit per task plus its review fixes. Remove any worktree inside the repository first: ESLint does not read `.gitignore`.

- [ ] **Step 2: Run the full gate detached from the harness**

`npm run check` ran about three hours before this plan; with `test:lifecycle` it should project to roughly four and a half (the `lifecycle-v2` local total in the job comment is the added part). A background shell is killed at about 29 minutes, so detach it with a double fork:

```bash
LOG="${TMPDIR:-/tmp}/developer-os-plan-1a-check.log"
python3 - "$PWD" "$LOG" <<'PY'
import os, sys
root, log = sys.argv[1], sys.argv[2]
if os.fork():
    sys.exit(0)
os.setsid()
if os.fork():
    os._exit(0)
out = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
nul = os.open(os.devnull, os.O_RDONLY)
os.dup2(nul, 0); os.dup2(out, 1); os.dup2(out, 2)
os.chdir(root)
os.execvp("/bin/sh", ["/bin/sh", "-c", "npm run check; echo EXIT=$?"])
PY
grep -E '^EXIT=' "$LOG" || tail -n 5 "$LOG"
```

Poll the last command until it prints `EXIT=`. Expected: `EXIT=0`. `check` begins with lint, so a lint failure means zero tests ran. On failure, keep the complete log, fix with a failing regression test first, and rerun this step.

- [ ] **Step 3: Final fresh-context review of the whole change**

Dispatch a reviewer who authored none of Tasks 1–24. Give it the diff `git diff 43c6876^..HEAD`, the amended Spec 1, this plan and review-only instructions. For each accepted finding: add a failing regression test, apply the smallest fix, rerun the affected focused commands and Step 2, and request a new verdict. Continue until the verdict has no Critical or Important finding.

- [ ] **Step 4: Carry surviving constraints into the canonical documents**

`docs/architecture/foundation.md` gains a section "Lifecycle kernel (Spec 1a)" stating: the bookkeeping set and its shape admission; the two present-manifest uninstall variants and their derivation (D24), the empty-directory removal inside `M(finalize_tombstones)` (D25), the `mf` reservation order (D28), and the capacity refusal (D26); the non-creating global lock and lock order; structural V2 admission; the mutation gate every V2 Foundation mutator passes (allocated `tx` IDs, compaction and reservation preflight, closure `clear`, the `repair` resolution); the closed `config` key and result grammar; the uninstall variants, point of no return, lease drain, and absent-manifest arms; what is refused until plan 1b. `docs/architecture/foundation-constraints.md` records the exact bounds from this plan's Global Constraints that code now enforces. `docs/architecture/threat-model.md` records: the global lock is never created outside fresh `init`; the gate's contention and ledger refusals; secret-opaque key handling; §8.3 residuals 8 and 9. Then run `npx vitest run --root tests repository/citations.test.ts`, and lower a citation floor only with the removed section named in its comment.

- [ ] **Step 5: Close the tracking rows and advance NOW**

- Roadmap: tick "Execute plan 1a" ("Write plan 1a" is already ticked), and prune Phase 4 to a closed bullet ("closed <date> as `<first>..<last>`", its outcome in two sentences, the constraint locations).
- `ORDER.md`: remove the `Plan 1a progress:` sentence; NOW becomes Phase 4b (Spec 2 Tasks 10–11 plus the pin removal, NEW-79 and NEW-81 first); update the open-sequence list and the Count section.
- `BACKLOG.md`: remove NEW-69 (closed by Task 2), and NEW-70 if `grep -rn reusableGlobalLock apps/cli/src` is empty; keep NEW-85 (Phase 4b, D26); recount with `grep -c '^| NEW-' docs/superpowers/BACKLOG.md` and write that number into "There are N numbered rows" here and "N open numbered rows" in `ORDER.md`; in §0 remove "Spec 1a"; in §3 A11 tick the "Execute plan 1a" line and leave its plan 1b clause unticked.
- Source plan: under its "Superseded for execution" paragraph add "Tasks 1–7, 21 and 23 were executed via plan 1a (`<first>..<last>`); the remaining tasks are plan 1b's source." Append "(executed via plan 1a)" to those seven task headings. Do not delete the file.
- Spec 1 §8.2 step 5: add "**Completed <date>:** plan 1a (`<first>..<last>`)." before "Plan 1b (Git, launchd) follows roadmap Phase 9."

- [ ] **Step 6: Commit the closure, deleting this plan**

```bash
git add docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/threat-model.md
git add -f docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/plans/2026-08-28-developer-os-opt-in-surfaces.md docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md
git rm docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md
git diff --cached --name-only
git commit -m "docs: close roadmap Phase 4 (plan 1a) and advance to Phase 4b"
```

Push per the push rule, then report: the commit range, `EXIT=0` with the log's test counts, the reviewer's final verdict, and the new NOW action.

## Spec Coverage Index

### Source plan tasks

| Source task (2026-08-28 plan) | Plan 1a tasks | What changed |
|---|---|---|
| 1 Lifecycle configuration schema and key codecs | 4, 5 | Split records from key surface; `brainPath` identity derived from the config, not passed in |
| 2 `config get/set` command surface | 20 | Moved after the lock provider (9) and gate (19); `output-schemas.ts` edits dropped |
| 3 Canonical primitives and generic contracts | 6, 7, 8 | Consumes Spec 2's shipped types (A5); no `LifecycleBootstrapCreationTempV1`; created-by-attempt fields removed (A2, A3); grammar split out |
| 4 Allocator, bootstrap lock, ledger inventory | 9, 10, 11, 12, 13 | Lock provider never creates (A12); absent-manifest inspection has no recovery epoch or ID path (A3); counting seams (A8); A13 projection |
| 5 Persist feasible plans and journals | 14 | Lock published after the plan so a lock-only envelope is unreachable |
| 6 Foundation participants and compaction | 15 | Plus the `doctor` survey race |
| 7 Execute, compensate, recover, compact | 16 | Uninstall control-file suffix kept; post-handoff compaction keeps guarded deletion (D21) |
| 21 Composite schemas, adapters, recovery before mutation | 17, 18, 19 | Structural admission replaces `admitV2Handoff` (A7, NEW-82); Git/launchd/push arms refused until 1b; gate covers every V2 Foundation mutator |
| 23 Drained uninstall, manifest absence, key deletion | 21, 22, 23, 24 | No key-present coordinator (A3, D22); recovery-only arm (A7); bookkeeping set kept (A12); round trips (A9) |
| roadmap Phase 4 obligations outside those tasks | 1, 2, 3, 25 | D19 pin and NEW-80; bookkeeping shape admission, NEW-69, conditional `createdPaths[0]`; NEW-83; closure |

### Amended Spec 1 areas in scope

| Spec 1 area | Owning tasks | Out of 1a scope |
|---|---|---|
| §1 inert opt-in surfaces, no vendor or hidden network | 18 (refusing arms), 19 (no process in the gate), 20, 21, 22 (no `git`/`launchctl`/vendor spawn asserted) | Git and automation behaviour (1b) |
| §2.1 V2 verification, reservation set and owners (A4) | 1, 17, 22 | — |
| §2.1 bookkeeping set (A1, A12) | 2, 11, 13, 21, 22 | — |
| §2.1 admission of an installed V2 home and recovery-only arm (A7) | 17, 23 | — |
| §2.2 configuration loads, key and result grammar | 4, 5, 20 | `git`/`automation` apply writing lifecycle records (1b) |
| §2.2 applied lifecycle provenance, activation record | 4 (record and hash), 5 (`config set` cannot write it) | Creation and update by lifecycle apply (1b) |
| §2.2 `LifecycleJournalClosureV1` | 12, 19 | Runner consumption of `retry_only`/`uninstall_draining` (1b) |
| §2.3 bootstrap lock (A2) | 3, 13, 21 | — |
| §2.3 global lock, never created outside fresh `init` (A1, A12) | 2, 9, 19, 20 | Scheduled bounded wait (1b) |
| §2.3 lease order | 9, 22 | Runner lease acquisition (1b) |
| §2.4 ledger roots, bounds, overflow recovery, A13 | 11, 12, 15 | — |
| §2.4 plan/preview/envelope types, IDs, allocator | 6, 7, 10, 14 | Git and launchd leaf types (1b) |
| §2.4 operation grammar and points of no return | 8, 16, 22 | — |
| §2.4 Foundation participants and compaction | 15, 16 | — |
| §2.4 manifest state participant and redaction key | 18, 22 | — |
| §2.4 Git and launchd effect protocols | Core closure/engine generic only (12, 16) | 1b |
| §3 command surface | 20 (`config` rows) | `git`, `automation` rows (1b) |
| §5.4 runner locking as it binds uninstall | 9, 22 | Runner steps 1–9 (1b) |
| §6 present-manifest uninstall, both variants (A14, A15) | 8, 16, 22, 23 | Execution of the `P` variant for installs with automation (1b; refused in 1a, D24) |
| §6 absent-manifest uninstall (A3, A12) | 13, 21 | — |
| §8.1 produced interfaces | Interfaces blocks of Tasks 4–23 | Git, security process, launchd rows (1b) |
| §8.2 required sequence | 25 (step 5 status line) | — |
| §8.3 residuals 4, 8, 9 | 21, 25 | Residuals 2, 3, 5–7 (1b documentation) |

### §7 verification gates

| Gate row | Owning tasks | Remainder |
|---|---|---|
| disabled Git is inert | — | 1b |
| disabled automation is inert | — | 1b |
| lifecycle schemas are exhaustive | 4, 5, 6, 7, 18 | Git, launchd and snapshot types (1b) |
| config surface is closed | 5, 20 | — |
| journal closure is fail-closed | 11, 12 | Real Git/launchd leaves (1b supplies codecs; logic already proven) |
| terminal collection stays bounded | 10, 11, 12, 14, 15, 16 | Scheduled status/log cadence (1b) |
| coordinator grammar is exact | 8, 16 | — |
| applied provenance is mandatory | 4 (record grammar), 12 (closure prerequisite) | Apply paths (1b) |
| plan/apply identity | 7 (preview hash rule) | Preview commands (1b) |
| V2 new init registers ownership | 1, 2, 19 (V1 takes no lock) | — |
| V2 admission is structural | 17, 23 | — |
| runtime records are closed | 6 (marker) | Sync record, status, log (1b) |
| V2 drift is exhaustive | shipped by Spec 2 Task 9 | — |
| composite state recovers | 16, 22 | Git and launchd fixtures (1b) |
| Git rows (branch-history through history ownership) | — | 1b |
| automation, stale job, schedules, launchd rows, logs | — | 1b |
| lock behavior is serialized | 9, 19 (interactive contention) | Runner clauses (1b) |
| uninstall drains without deadlock | 9, 22 (drain order, deadline, lease removal while held), 12 (`uninstall_draining`) | Paused-runner fixtures (1b) |
| absent-manifest uninstall is evidence-bound | 13, 21 | — |
| uninstall respects ownership | 22, 24 | — |
| manifest transitions are no-overwrite | shipped `ManifestStateParticipant`, 22 | — |
| uninstall removes its manifest recoverably | 22 (with A15's directory crash), 23, 24 | — |
| uninstall then init round-trips (A9) | 20 (`config set` half), 21 (key deletion, `key_absent`, rolled-back `init`), 24 (the rest) | `git enable` preview half (1b) |
| redaction-key deletion is secret-opaque | 21, 22 | — |

### Amendment items

| Item | Owning tasks |
|---|---|
| A1 D18 applied; V1 homes keep Foundation paths | Global Constraints precondition; 17, 19, 20, 23 |
| A2 retention on pre-product bootstrap paths only | 2, 13, 21 (no unlink/rmdir); 15, 16 (post-handoff guarded deletion) |
| A3 absent-manifest uninstall without a coordinator envelope | 6, 13, 21, 23 |
| A4 reservation ownership; `.status.json` | 1, 17, 22 |
| A5 consume Spec 2's shipped types | 6, 7 |
| A6 migration collision codes withdrawn | 1, 2 (pre-existing reserved leaves refused by §6.1 admission; no new codes) |
| A7 structural admission and recovery-only arm | 17, 23 |
| A8 counting-seam ceilings | 10 (in-memory port and agreement fixture), 11, 12, 13 |
| A9 uninstall→init round trips | 20, 21, 24 |
| A10 `launchctl` re-pin deferred | not in 1a (NEW-84; D24 keeps 1a clear of it) |
| A11 change record | no code |
| A12 bookkeeping set kept and admitted by shape | 2, 9, 13, 21, 22 |
| A13 closure projects retained bootstrap evidence | 2 (`init` half), 11 (closure half), 13 |
| A14 (D24) `uninstall/present_manifest_without_launchd` | 8 (grammar and derivation), 12 (closure, both variants), 16 (compensation order), 18 (`P` refused), 22 (planner, derivation and refusal tests), 23 (recovery-only arm) |
| A15 (D25) empty directories removed inside `M(finalize_tombstones)` | 22 (adapter and crash test), 23 (arm microstates), 24 (kill point) |
| A16 (D28) `mf` reserved last | 8, 22 |

### BACKLOG rows

| Row | Closed by |
|---|---|
| NEW-69 | Task 2 (row removed at Task 25) |
| NEW-70 | Task 2 deletes the branch; Task 25 removes the row after the `grep` check |
| NEW-80 | Task 1 |
| NEW-82 | Task 17 |
| NEW-83 | Task 3 |
| NEW-85 | stays open for Phase 4b (D26); Task 22 ships only the pre-allocation refusal |
