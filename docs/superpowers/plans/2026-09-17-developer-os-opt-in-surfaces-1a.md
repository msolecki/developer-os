# Developer OS Opt-in Surfaces 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks:** 26 tasks (1–25 plus 10b). Task 10b was inserted after Task 10 by founder decision D31 (2026-09-18) and numbered `10b` rather than `11` so that every later task number and every cross-reference in this plan stays exactly as written.

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
- **D29.** NEW-80 (D19's release layout move) is in plan 1a Task 1, not Phase 4b.
- **D31 (2026-09-18).** Every recorded filesystem identity is corrected to exact 64-bit stats inside this plan as new Task 10b, not deferred to Phase 4b. Number-valued `Stats.ino` rounds above 2^53 — up to 128 APFS inodes collapse onto one recorded identity — and Spec 1 §2.4 forbids that by name. Inserted as `10b` so no later task renumbers.

## Global Constraints

- **Execution precondition (A1).** Before Task 1, `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'admitV2Handoff'` must PASS on the base commit. It replaces the source plan's withdrawn V1→V2 migration precondition. From Task 17 onward the precondition is `npm run test:lifecycle`, which runs the structural admission tests.
- **V1 homes (A1, D18, D20).** `config` refuses a V1 manifest with `manifest_v1_not_migratable`, exit 4, before any lock or write. `uninstall` over a V1 manifest runs the unchanged Foundation path. A V1 home has no `state/.lifecycle.lock`, and no Foundation command over a V1 manifest takes one.
- **Production reachability.** `bootstrap: { state: "unavailable_until_packaged_handoff" }` in `createProductionContext` (`apps/cli/src/context.ts`) stays; removing it is Phase 4b. V2 behaviour is proven only through `createCommandFixture(name, { bootstrapAvailable: true })`, a real fresh V2 `init`, and injected ports.
- **Per-commit gate (D17, `SESSION.md` §5).** Focused commands named by the task, then `npm run lint`, then fresh-context review by an agent that did not author the task, then commit, then push. An accepted review finding gets a failing regression test first. `npm run check` runs only in Task 25.
- **Push rule (D17).** Before each commit run `gh run list --branch development --limit 1 --json status,conclusion,headSha`: a completed run with conclusion `failure` stops new commits until fixed. After the commit, push to `development` only when no run is `queued` or `in_progress`; otherwise push it with the next commit. Never merge.
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** New files there need `git add -f`, and `git add` of those paths exits 1 even for tracked files. Put that `git add -f` on its own line; never chain it with `&&` into `git commit`.
- **Per-task bookkeeping.** Each task's commit ticks that task's steps in this file and rewrites the one `ORDER.md` NOW sentence beginning `Plan 1a progress:` (added with this plan as "no task committed; next is Task 1 (…)") to `Plan 1a progress: Tasks 1–N of 26 committed; next is Task N+1 (<title>).` Task 10b takes the place of "Task 11" in that sequence for one commit (`Tasks 1–10b of 26`).
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
Verified anchors at plan writing (base a891952). Inside a fence so the citations gate ignores them;
line numbers drift as tasks edit these files, so each task re-locates by symbol.
apps/cli/src/context.ts               765   bootstrap: { state: "unavailable_until_packaged_handoff" }
packages/core/src/manifest/bootstrap.ts 72-83 LifecycleBootstrapLockV1 with three created-by-attempt fields
packages/core/src/manifest/bootstrap.ts 1828 createdPaths[0] must be the global lock (unconditional)
apps/cli/src/bootstrap/executor.ts    1123  reusableFreshDirectoryCandidates()
apps/cli/src/bootstrap/executor.ts    1136  join(paths.home, "rollback") candidate (Task 1)
apps/cli/src/bootstrap/executor.ts    1147  backups exemption (NEW-69 cites 1146)
apps/cli/src/bootstrap/executor.ts    1546  runtimeReservationPaths(): automation-<job>.status.json (Task 1)
apps/cli/src/bootstrap/executor.ts    1828  ordinary directory join(paths.home, "rollback") (Task 1)
apps/cli/src/bootstrap/executor.ts    1951  admittedPreexistingPaths (NEW-69 cites 1944)
apps/cli/src/bootstrap/executor.ts    2033  metadataRoot = join(paths.stateDir, "release-metadata") (Task 1)
apps/cli/src/bootstrap/executor.ts    2138  buildManifest(): bookkeeping directories and .lifecycle.lock become rows
apps/cli/src/bootstrap/report.ts      1151  .lifecycle-bootstrap.lock filtered out by name
apps/cli/src/bootstrap/report.ts      1437  guardedFile(): null for any non-regular entry
apps/cli/src/bootstrap/report.ts      1499  handoff empty-root loop: three journal roots plus product-home rollback (Task 1)
apps/cli/src/bootstrap/report.ts      1514  admitV2Handoff (no production caller)
apps/cli/src/bootstrap/context.ts     238   listNames wired to readdir
```

---
### Task 1: Pin the fresh V2 plan's created path set to D19 and the renamed status reservation · M

Source: roadmap Phase 4 "first test" (A4, D19); NEW-80, pulled forward by D29.

**Files:**
- Modify: `apps/cli/src/bootstrap/executor.ts` — `runtimeReservationPaths`, `reusableFreshDirectoryCandidates`, the ordinary-directory list in fresh plan construction, `buildLaunchability`
- Modify: `apps/cli/src/bootstrap/report.ts` — the journal-root/rollback loop in `admitExactV2Handoff`
- Create: `apps/cli/src/bootstrap/fresh-layout.v2.test.ts` — the exact-set pin, with a test-local copy of `executor.test.ts`'s `persistedPlan` helper (`lifecycle-v2` job)
- Test: `apps/cli/src/bootstrap/report.test.ts` — the `missing`/`present` lists in `describe("admitV2Handoff")`
- Modify: `package.json` — `test:lifecycle`; `test:suite` excludes `**/*.v2.test.ts`; `test` runs `test:lifecycle` after `test:suite`
- Modify: `.github/workflows/check.yml` — add the `lifecycle-v2` job
- Modify: `docs/superpowers/SESSION.md` — §5 step 7 "all five jobs" becomes "every job"
- Modify: `docs/superpowers/BACKLOG.md` (remove row NEW-80; row count 46 → 45; §0 A11's "NEW-80 moved into plan 1a (D29)"), `docs/superpowers/ORDER.md` (NEW-80 in the open-row and sequence sentences)

**Interfaces:**
- Consumes: `PackagedReleaseIdentityV1.delegationHash`, `.releaseIndexHash`, `.bundleManifestHash` and `inspectPackagedRelease` from `apps/cli/src/update/packaged-release.ts`; `persistedPlan(fixture)` in `executor.test.ts`.
- Produces: the fresh V2 layout later tasks rely on — `state/release-metadata/{delegations,indexes,bundles}/<hash>.json`, product-home `rollback`, `state/automation-<job>.status.json`, `state/.automation-<job>.lock`, `logs/automation-<job>.<n>.json`.

- [x] **Step 1: Write the failing exact-set pin**

Restored from `git show df3e947 -- apps/cli/src/bootstrap/executor.test.ts`, updated for D19 and A4, into the new `fresh-layout.v2.test.ts` so the first real-V2-home case of this plan starts in the `lifecycle-v2` job:

```ts
it("creates exactly the fresh plan path set Spec 2 §3.2 and Spec 1 §2.1 reserve", async () => {
  const fixture = await createCommandFixture("bootstrap-exact-created-set", { bootstrapAvailable: true });
  const bootstrap = fixture.context.bootstrap;
  if (bootstrap?.state !== "available") throw new Error("bootstrap fixture is unavailable");
  const { identity } = await inspectPackagedRelease(bootstrap.packagedRelease);

  const result = await runInit(fixture.context, ACCEPTED);

  if (!result.ok) throw new Error(JSON.stringify({ result, trace: fixture.bootstrapTrace.slice(-30) }));
  const plan = (await persistedPlan(fixture)).value;
  const created = [plan.createdPaths, plan.launchabilityPaths]
    .flatMap((rows) => rows as Array<{ readonly path: string }>)
    .map((row) => row.path);
  const childrenOf = (root: string): readonly string[] => created.filter((path) => dirname(path) === root).toSorted();
  const jobs = ["brain-reindex", "brain-lint", "doctor", "git-sync"];
  const state = fixture.paths.stateDir;
  const metadata = join(state, "release-metadata");
  const expectedState = [
    ".lifecycle.lock", "lifecycle-install-nonce", "lifecycle-id-allocator.json", "git-sync.json",
    "uninstalling.json", "update-rollback.json", "update-executor.json", "transactions",
    "lifecycle-journals", "git-effect-journals", "launchd-effect-journals", "release-metadata",
    "active-release.json", "release-trust.json",
    ...jobs.flatMap((job) => [`automation-${job}.status.json`, `.automation-${job}.lock`]),
  ].map((name) => join(state, name)).toSorted();
  const expectedLogs = jobs
    .flatMap((job) => Array.from({ length: 10 }, (_, slot) => `automation-${job}.${String(slot)}.json`))
    .map((name) => join(fixture.paths.logsDir, name)).toSorted();
  const expectedHome = ["backups", "logs", "releases", "rollback", "schemas", "staging"]
    .map((name) => join(fixture.paths.home, name)).toSorted();
  const expectedMetadata = {
    [join(metadata, "delegations")]: [join(metadata, "delegations", `${identity.delegationHash}.json`)],
    [join(metadata, "indexes")]: [join(metadata, "indexes", `${identity.releaseIndexHash}.json`)],
    [join(metadata, "bundles")]: [join(metadata, "bundles", `${identity.bundleManifestHash}.json`)],
  };

  for (const expected of [expectedState, expectedLogs, expectedHome]) expect(expected.length).toBeGreaterThan(0);
  expect(childrenOf(state)).toStrictEqual(expectedState);
  expect(childrenOf(fixture.paths.logsDir)).toStrictEqual(expectedLogs);
  expect(childrenOf(fixture.paths.home)).toStrictEqual(expectedHome);
  expect(childrenOf(metadata)).toStrictEqual(Object.keys(expectedMetadata).toSorted());
  for (const [directory, files] of Object.entries(expectedMetadata)) expect(childrenOf(directory)).toStrictEqual(files);
  expect(childrenOf(join(fixture.paths.home, "rollback"))).toStrictEqual([]);
  expect(created.filter((path) => path.startsWith(join(fixture.paths.home, "releases", "metadata")))).toStrictEqual([]);
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

Cover also: each retained metadata file's bytes hash to the identity hash in its name; product-home `rollback` exists after `init` as an empty owner-only `0700` directory with a manifest `directory`/`content` row; neither `state/rollback` nor any `automation-<job>.json` exists anywhere under the product home; in `report.test.ts`, the `missing` list names `join(fixture.paths.home, "rollback")` and `join(state, "release-metadata", "indexes", <hash>.json)` in place of the old paths, and the `present` list plants `join(fixture.paths.home, "rollback", "synthetic-payload")`.

- [x] **Step 2: Run the pin and verify it fails for the layout reason**

Run: `npx vitest run --root apps/cli src/bootstrap/fresh-layout.v2.test.ts`

Expected: FAIL — `childrenOf(state)` contains `rollback` and `automation-<job>.json` and lacks `release-metadata`; `childrenOf(home)` lacks `rollback`. A failure for any other reason is a stop condition.

- [x] **Step 3: Move the layout**

Change only paths, never order rules:

```ts
private runtimeReservationPaths(): readonly string[]; // `automation-${job}.status.json` replaces `automation-${job}.json`
private reusableFreshDirectoryCandidates(): readonly string[]; // join(paths.home, "rollback") replaces join(paths.stateDir, "rollback")
// ordinary directory list: join(paths.home, "rollback") replaces join(paths.stateDir, "rollback")
private buildLaunchability(/* unchanged signature */): { readonly paths: readonly PlannedCreatedPathV1[] };
// metadataRoot = join(paths.stateDir, "release-metadata"); directory specs append, after the bundle
// directories: metadataRoot, join(metadataRoot, "delegations"), join(metadataRoot, "indexes"),
// join(metadataRoot, "bundles"); file specs:
//   delegations/<packaged.identity.delegationHash>.json  <- packaged.retainedMetadata.delegation
//   indexes/<packaged.identity.releaseIndexHash>.json    <- packaged.retainedMetadata.releaseIndex
//   bundles/<packaged.identity.bundleManifestHash>.json  <- packaged.retainedMetadata.bundleManifest
```

Rules: the file name hash comes only from `packaged.identity`, which `inspectPackagedRelease` already binds to each file's SHA-256; never from a URL, archive or packaged file name. Launchability order stays Spec 2 §6.3's: bundle root and inventory, then the metadata directories and the three retained files (delegation, index, bundle manifest), then trust, then active last. Parents precede children. In `report.ts` the handoff loop checks the three journal roots under `state` and `rollback` under the product home.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/bootstrap/fresh-layout.v2.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t 'publishes a complete V2 handoff'`

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'admitV2Handoff'`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts repository/citations.test.ts`

Expected: PASS.

- [x] **Step 4b: Add the `lifecycle-v2` CI job**

In `package.json`:
- `"test:lifecycle": "vitest run .v2.test.ts"`. Vitest positional filters match any test path containing the string; `vitest list --filesOnly` confirms the set.
- Append `--exclude '**/*.v2.test.ts'` to `test:suite`.
- `"test": "npm run test:bootstrap && npm run test:suite && npm run test:lifecycle"`.

In `.github/workflows/check.yml`, add a job `lifecycle-v2` with exactly the `suite` job's steps (checkout, setup-node 24, corepack, install, build) and a final step `run: npm run test:lifecycle`. Give it a two-line comment: it owns the real-V2-home `*.v2.test.ts` files, and it records their running local total with its budget, local × 2 × 1.5. In `docs/superpowers/SESSION.md` §5 step 7, change "so CI runs all five jobs on it" to "so CI runs every job on it".

Run: `npx vitest list --filesOnly .v2.test.ts`

Expected: exactly `apps/cli/src/bootstrap/fresh-layout.v2.test.ts`.

Run: `npm run test:lifecycle`

Expected: PASS. Record its duration as the job comment's first local total, and set `timeout-minutes` to ceil(total in minutes × 2 × 1.5), minimum 20.

- [x] **Step 5: Close NEW-80 in the tracking documents, gate, commit, push**

Remove row NEW-80 from `BACKLOG.md` §1 and change "There are 46 numbered rows" to 45. In `BACKLOG.md` §0 delete "; NEW-80 moved into plan 1a (D29)". In `ORDER.md`: delete "; NEW-80 moved into plan 1a Task 1 (D29)" from the open sequence; change "NEW-78 and NEW-79–NEW-85." to "NEW-78, NEW-79 and NEW-81–NEW-85."; change "NEW-80, NEW-82 and NEW-83 by plan 1a" to "NEW-82 and NEW-83 by plan 1a"; change "46 open numbered rows" to "45 open numbered rows". Tick this task and update the `Plan 1a progress:` sentence. Run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/fresh-layout.v2.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts package.json .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md docs/superpowers/SESSION.md
git diff --cached --name-only
git commit -m "fix(cli): place fresh V2 release metadata and rollback where Spec 2 §3.2 fixes them"
```

Push per the Global Constraints push rule.

### Task 2: Admit the bookkeeping set by shape and keep it out of the manifest · L

Source: roadmap Phase 4 bullets for A12, NEW-69, `packages/core/src/manifest/bootstrap.ts` `createdPaths[0]`, and the A13 correction's `init` half.

**Files:**
- Create: `packages/core/src/lifecycle/bookkeeping.ts`
- Create: `packages/core/src/lifecycle/bookkeeping.test.ts`
- Modify: `packages/core/src/manifest/bootstrap.ts` — `validateBootstrapPlan`
- Test: `packages/core/src/manifest/bootstrap.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Modify: `apps/cli/src/bootstrap/executor.ts` — `reusableFreshDirectoryCandidates`, `inspectReusableFreshDirectories`, `planFreshInit` lock admission, fresh plan construction (`createdPaths`, `admittedPreexistingPaths`), `admitPostPlanInitialWrite`, global-lock acquisition on first run and recovery, `buildManifest`
- Modify: `apps/cli/src/bootstrap/report.ts` — `exactRestoredBase`; delete `exactReusableGlobalLock` and the `reusableGlobalLock` member of `BootstrapEvidenceAdmissionV1`
- Create: `apps/cli/src/bootstrap/bookkeeping.v2.test.ts` — this task's new real-V2-home cases (`lifecycle-v2` job)
- Test: `apps/cli/src/bootstrap/report.test.ts` — existing cases only
- Modify: `apps/cli/src/commands/uninstall.test.ts` — rewrite "removes an ephemeral V2 artifact holding real content instead of refusing on a phantom edit", which uses `state/.lifecycle.lock` as its ephemeral row
- Modify: `tests/e2e/fresh-v2-retained-bootstrap.test.ts` — the reinstall after the downcast uninstall now refuses (Scope decision 11)
- Modify: `.github/workflows/check.yml` — add this task's measured `bookkeeping.v2.test.ts` time to the `lifecycle-v2` budget Task 1 created

**Interfaces:**
- Consumes: Task 1 layout; `BootstrapEvidenceAdmissionV1.retainedPaths` and `.retainedEnvelopes[].plan.foundationParticipants`.
- Produces:

```ts
// packages/core/src/lifecycle/bookkeeping.ts
export const LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS: readonly [
  "backups", "backups/transactions", "staging", "staging/lifecycle", "staging/transactions",
  "state/.lifecycle.lock", "state/git-effect-journals", "state/launchd-effect-journals",
  "state/lifecycle-journals", "state/transactions",
];
export type LifecycleBookkeepingObservationV1 =
  | { readonly kind: "regular_file"; readonly ownerUid: number; readonly mode: number; readonly nlink: number; readonly size: bigint }
  | { readonly kind: "directory"; readonly ownerUid: number; readonly mode: number; readonly childNames: readonly string[] }
  | { readonly kind: "other" };
export interface LifecycleBookkeepingResidueV1 {
  /** Absolute paths of inert retained evidence and every descendant of it. */
  readonly retainedPaths: ReadonlySet<string>;
  /** Foundation participant IDs named by inert retained envelopes (`tx_fi_…_{f|c}`). */
  readonly bootstrapParticipantIds: ReadonlySet<string>;
}
export function lifecycleBookkeepingPaths(productHome: string): ReadonlySet<string>;
export type LifecycleBookkeepingShapeResultV1 =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly offendingPath: string }; // the deepest path that broke the rule
/** Pure: `observe` returns the no-follow observation of any absolute path the rule needs to inspect. */
export function inspectLifecycleBookkeepingShape(
  productHome: string,
  path: string,
  observe: (path: string) => LifecycleBookkeepingObservationV1,
  effectiveUid: number,
  residue: LifecycleBookkeepingResidueV1,
): LifecycleBookkeepingShapeResultV1;
```

Shape rules, exactly A12 plus the A13 correction: the lock is an owner `0600` zero-byte single-link regular file. Each directory is an owner `0700` directory, and every child is one of: another bookkeeping path (itself admitted recursively); a path in `residue.retainedPaths`; a directory that is an ancestor of such a path and holds nothing else; in `state/transactions` only, a `.<id>.lock` owner `0600` zero-byte single-link file whose `<id>` is in `bootstrapParticipantIds`; in `staging/transactions` and `backups/transactions` only, a directory named by an ID in `bootstrapParticipantIds` whose children are all in `residue.retainedPaths`, or that has none.

`BootstrapEvidenceAdmissionV1` loses `reusableGlobalLock`. A fresh plan admits a pre-existing `state/.lifecycle.lock` through `admittedPreexistingPaths` and then has no `global_lock` created path.

- [x] **Step 1: Write the failing Core validator and shape tests**

```ts
it("requires createdPaths[0] to be the global lock exactly when the plan admits no pre-existing lock", () => {
  const lock = `${context.stateRoot}/.lifecycle.lock`;
  expect(validateBootstrapPlan(freshPlan(), context).createdPaths[0]).toMatchObject({ kind: "global_lock", path: lock });
  expect(validateBootstrapPlan(freshPlanAdmittingLock(), context).admittedPreexistingPaths).toContain(lock);
  expect(() => validateBootstrapPlan(freshPlanAdmittingLockAndCreatingIt(), context)).toThrow(BootstrapStateError);
  expect(() => validateBootstrapPlan(freshPlanWithoutLockRow(), context)).toThrow(BootstrapStateError);
});

it.each(LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS)("admits %s by exact shape and refuses every other shape", (relative) => {
  const path = join(HOME, relative);
  const exact = relative.endsWith(".lock")
    ? { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 0n } as const
    : { kind: "directory", ownerUid: UID, mode: 0o700, childNames: [] } as const;
  expect(inspectLifecycleBookkeepingShape(HOME, path, observing({ [path]: exact }), UID, NO_RESIDUE)).toStrictEqual({ admitted: true });
  for (const wrong of wrongShapesOf(exact)) {
    expect(inspectLifecycleBookkeepingShape(HOME, path, observing({ [path]: wrong }), UID, NO_RESIDUE))
      .toStrictEqual({ admitted: false, offendingPath: path });
  }
});
```

The three plan helpers are test-local transformations of the file's existing `fullPlanFixture().plan`, each passed through `validateBootstrapPlan` with `fullPlanFixture().context`: `freshPlan()` is that plan unchanged; `freshPlanAdmittingLock()` removes `createdPaths[0]`, decrements every `{ kind: "created_path", scope: "ordinary" }` parent ordinal by one, and inserts `/product/state/.lifecycle.lock` into `admittedPreexistingPaths` in unsigned UTF-8 order; `freshPlanAdmittingLockAndCreatingIt()` keeps `createdPaths[0]` and inserts the same admitted path; `freshPlanWithoutLockRow()` removes `createdPaths[0]` and renumbers as above without admitting the lock. `observing(map)` is a test-local function returning `map[path] ?? { kind: "other" }`; `wrongShapesOf` returns the mode, size, link-count, owner and kind variants of its argument. Cover in `bookkeeping.test.ts`: the exported path tuple equals the A12 set exactly and is non-empty; lock with mode `0644`, size 1, `nlink` 2, foreign owner or `other` kind refuses; directory with mode `0755`, foreign owner, or an unknown child refuses; `backups` holding `transactions` admitted; `state/transactions` holding `.tx_fi_<uuid>_0000000000_f.lock` admitted only when that ID is in `bootstrapParticipantIds`, and holding a retained tombstone admitted only when its path is in `retainedPaths`; `staging/transactions/tx_fi_<uuid>_0000000000_f` (empty, or holding only retained tombstones) admitted, and the same holding `0.bin` refused; a legacy `tx_<uuid>.json` journal in `state/transactions` refused with `offendingPath` equal to that journal, not to `state/transactions` or `backups`; a refusal inside `backups/transactions/<id>/` names the deepest offending child; a path outside the set is never admitted.

- [x] **Step 2: Write the failing CLI round-trip and manifest tests**

```ts
it("keeps the bookkeeping set out of the V2 manifest", async () => {
  const fixture = await createCommandFixture("bootstrap-bookkeeping-not-manifest", { bootstrapAvailable: true });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as { artifacts: { path: string }[] };
  const bookkeeping = lifecycleBookkeepingPaths(fixture.paths.home);
  expect(bookkeeping.size).toBeGreaterThan(0);
  expect(manifest.artifacts.filter((artifact) => bookkeeping.has(artifact.path))).toStrictEqual([]);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("reinstalls over a rolled-back first init's global lock and bookkeeping directories, admitting them by shape", async () => {
  const fixture = await createCommandFixture("bootstrap-rolled-back-bookkeeping", {
    bootstrapAvailable: true, bootstrapFailureAfter: "after_foundation",
  });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
  const lock = join(fixture.paths.stateDir, ".lifecycle.lock");
  const lockBefore = await nodeFs.lstat(lock);
  fixture.disableBootstrapFailure();

  const reinstalled = await runInit(fixture.rebuildContext(), ACCEPTED);

  if (!reinstalled.ok) throw new Error(reinstalled.error.message);
  const plans = (await nodeFs.readdir(fixture.paths.stateDir)).filter((name) => name.endsWith(".plan.json"));
  const second = await newestPlanOf(fixture, plans);
  expect(second.admittedPreexistingPaths).toContain(lock);
  expect((second.createdPaths as { kind: string }[]).some((row) => row.kind === "global_lock")).toBe(false);
  expect((await nodeFs.lstat(lock)).ino).toBe(lockBefore.ino);
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

`newestPlanOf` is a test-local helper that reads each plan and returns the one whose ID differs from the rolled-back envelope. Cover also: an empty planted `backups/` directory is admitted by shape, while `backups/unrelated.txt` refuses exit 6 naming the path (NEW-69: `backups` has no exemption); an empty planted `logs/` directory refuses exit 6 because `logs` is not bookkeeping and holds no retained evidence; a lock at `state/.lifecycle.lock` with mode `0644` refuses exit 6 before any intent; with `createCommandFixture(…, { bootstrapAvailable: true, bootstrapProductionLocks: true })` — the default fixture's in-process provider cannot see another holder — a lock held by a separate `MacOsTransactionLockProvider` refuses exit 6 as live residue; `inspectBootstrapEvidenceAdmission` classifies a `rolled_back` envelope as inert while the global lock remains; the Task 1 pin still passes.

The shipped downcast uninstall leaves its own terminal Foundation journal (`state/transactions/tx_fixture_001.json` in the fixture, whose IDs come from `generateId` in `apps/cli/src/commands/testing.ts`) with its lock and staging, which A12's shape rule correctly refuses. So, in this task:
- `tests/e2e/fresh-v2-retained-bootstrap.test.ts` asserts the reinstall after `runUninstall` is `{ ok: false, code: EXIT_CODES.recoveryRequired }` whose error names a path under `state/transactions`, `staging/transactions` or `backups/transactions`, and still asserts every retained identity from `before` is unchanged. Task 22 restores the successful reinstall.
- In `apps/cli/src/commands/uninstall.test.ts`, "removes an ephemeral V2 artifact holding real content instead of refusing on a phantom edit" writes `"stale-status"` to `state/git-sync.json` (still an ephemeral manifest row) instead of `state/.lifecycle.lock`, and additionally asserts `state/.lifecycle.lock` is not in `removed` and still exists.
- Run `rg -n "lifecycle\.lock|managedArtifacts" apps/cli/src tests --glob '*.test.ts'` and update any other assertion that pins a bookkeeping manifest row; name each changed file in Step 6's `git add`.

- [x] **Step 3: Run the new tests and verify each fails for its stated reason**

Run: `npx vitest run --root packages/core src/lifecycle/bookkeeping.test.ts src/manifest/bootstrap.test.ts`

Expected: FAIL — `bookkeeping.ts` does not exist, and the validator refuses a plan admitting the lock.

Run: `npx vitest run --root apps/cli src/bootstrap/bookkeeping.v2.test.ts`

Expected: FAIL — the manifest contains `state/.lifecycle.lock`, `state/transactions`, the three journal roots and `backups`; the reinstall refuses with "live lifecycle lock residue" or "unbound reusable directory".

- [x] **Step 4: Implement shape admission, the conditional validator rule and manifest exclusion**

In `validateBootstrapPlan`, replace the unconditional check with:

```ts
const lockPath = `${context.stateRoot}/.lifecycle.lock`;
const admitsLock = operation === "fresh_v2_init" && admittedPreexistingPaths.includes(lockPath as CanonicalAbsolutePathV1);
const lockRows = [...createdPaths, ...launchabilityPaths].filter((row) => row.kind === "global_lock" || row.path === lockPath);
if (admitsLock ? lockRows.length !== 0 : createdPaths[0]?.kind !== "global_lock" || createdPaths[0].path !== lockPath || lockRows.length !== 1) return refuse();
```

Executor rules:
- `reusableFreshDirectoryCandidates()` returns only non-bookkeeping candidates: `logs`, `schemas`, `staging/fresh-v2-init`, `rollback`. Each must still contain at least one admitted retained path, with no exemption.
- A new private `inspectBookkeepingShapes(evidence)` lstats every bookkeeping path, lists each present directory's children once, and calls `inspectLifecycleBookkeepingShape`. `retainedPaths` comes from `evidence.retainedPaths`, and participant IDs from every `evidence.retainedEnvelopes[].plan.foundationParticipants[].id`. Any refusal throws `FreshBootstrapError(EXIT_CODES.recoveryRequired, "product home contains bookkeeping residue of an unadmitted shape")` whose paths are `[offendingPath]`.
- A present exact lock goes into `admittedPreexistingPaths`, and the plan omits the `global_lock` created path. After the bootstrap lock is held, the executor acquires the existing lock through `this.#dependencies.lockProvider.acquire` and requires its post-acquire `dev`/`ino` to equal the shape observation, else exit 5. A busy lock refuses exit 6. Recovery of a plan that admits the lock reacquires it the same way. The creation-evidence path for ordinal 0 is used only when the plan created the lock.
- `admitPostPlanInitialWrite` expects the state and home child names to include every admitted bookkeeping path.
- `buildManifest` drops every path in `lifecycleBookkeepingPaths(paths.home)` from `includedPaths`.
- In `report.ts`, `exactRestoredBase` deletes every bookkeeping path from `attributableFiles`. Deleting `reusableGlobalLock` also deletes the `createPlannedPath` fallback NEW-70 describes; Task 25 closes NEW-70 when `grep -n reusableGlobalLock apps/cli/src` is empty.

- [x] **Step 5: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle/bookkeeping.test.ts src/manifest/bootstrap.test.ts src/index.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/bookkeeping.v2.test.ts src/bootstrap/fresh-layout.v2.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t 'global lock|global-lock'`

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'admitV2Handoff|inert'`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'ephemeral V2 artifact|retained bootstrap evidence inode'`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts`

Expected: PASS, in well under an hour. Add `bookkeeping.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 6: Gate, commit, push**

Tick this task, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/bookkeeping.ts packages/core/src/lifecycle/bookkeeping.test.ts packages/core/src/manifest/bootstrap.ts packages/core/src/manifest/bootstrap.test.ts packages/core/src/index.ts packages/core/src/index.test.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/bootstrap/bookkeeping.v2.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/commands/uninstall.test.ts tests/e2e/fresh-v2-retained-bootstrap.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(bootstrap): admit the lifecycle bookkeeping set by shape and keep it out of the V2 manifest"
```

### Task 3: Attribute bootstrap residue by identity and decide the two remaining §6.4 places · M

Source: NEW-83 (A3 settled the third place; §6.4's words decide the other two — Scope decision 8).

**Files:**
- Modify: `apps/cli/src/bootstrap/report.ts` — `inspectBootstrapEvidenceAdmission` (the name filter on `.lifecycle-bootstrap.lock`), `inspectPlan`, `assertOrdinaryCommandAdmitted`
- Create: `apps/cli/src/bootstrap/evidence-identity.v2.test.ts` — this task's new real-V2-home cases (`lifecycle-v2` job)
- Modify: `.github/workflows/check.yml` — `lifecycle-v2` `timeout-minutes`

**Interfaces:**
- Consumes: `FreshV2InitPlanV1.bootstrapIdentity`; `BootstrapEvidenceGuardedReaderV1`.
- Produces: `BootstrapEvidenceAdmissionV1.bootstrapLeaf: { readonly path: CanonicalAbsolutePathV1; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1; readonly attributedTo: FreshV2InitIdV1 | null } | null`. Task 13 and Task 21 use `attributedTo` to project an unattributed leaf and refuse an attributed one.

- [x] **Step 1: Write the failing classification tests**

```ts
it("projects an unattributed bootstrap leaf and blocks on one whose identity a retained envelope persisted", async () => {
  const fixture = await createCommandFixture("bootstrap-leaf-identity", { bootstrapAvailable: true });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
  const leaf = join(fixture.paths.stateDir, ".lifecycle-bootstrap.lock");
  await nodeFs.writeFile(leaf, "", { mode: 0o600 });

  const unattributed = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
  expect(unattributed.bootstrapLeaf).toMatchObject({ path: leaf, attributedTo: null });
  expect(unattributed.blocksNewIntent).toBe(false);

  await nodeFs.rm(leaf);
  const retainedLock = await retainedBootstrapLockTombstone(fixture);
  await nodeFs.rename(retainedLock, leaf);
  const attributed = await inspectBootstrapEvidenceAdmission(requestFor(fixture));
  expect(attributed.bootstrapLeaf?.attributedTo).toMatch(/^fi_/u);
  expect(attributed.blocksNewIntent).toBe(true);
  await nodeFs.rename(leaf, retainedLock);
}, REAL_FILESYSTEM_TIMEOUT_MS);

it("routes a retaining rolled-back envelope to init before handoff", async () => {
  const fixture = await createCommandFixture("bootstrap-retaining-rolled-back", {
    bootstrapAvailable: true, bootstrapFailureAfter: "after_foundation", bootstrapInterruptAfter: "during_retention",
  });
  expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
  await expect(assertOrdinaryCommandAdmitted(requestFor(fixture))).rejects.toMatchObject({
    code: EXIT_CODES.recoveryRequired, recovery: "developer-os init",
  });
}, REAL_FILESYSTEM_TIMEOUT_MS);
```

`requestFor` is a test-local copy of `report.test.ts`'s helper. `retainedBootstrapLockTombstone` is a test-local helper that reads the retained terminal journal through `inspectBootstrapEvidenceAdmission(...).retainedEnvelopes` and returns the `bootstrap_lock` location's `tombstonePath` from `deriveBootstrapRetentionLocations`.

Cover also, after `init` then a V2 downcast `uninstall`: truncating both journal slots to zero bytes makes the envelope `unverified` with `blocksNewIntent: false`, and `assertOrdinaryCommandAdmitted` does not answer "resume with init"; truncating only the inactive slot keeps it `verified` and inert; truncating both slots while a planted non-retained file sits at a created path attributable to that ID blocks as manual archive (exit 6), never "resume with init"; a non-zero-byte or `0644` leaf is not a bootstrap leaf and blocks as unknown residue; the leaf is never filtered by name alone.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/bootstrap/evidence-identity.v2.test.ts`

Expected: FAIL — `bootstrapLeaf` is undefined; the retaining rolled-back envelope is admitted as inert; the both-slots-truncated classification does not match.

- [x] **Step 3: Implement identity attribution and the two §6.4 decisions**

Rules:
- Remove `.filter((candidate) => basename(candidate.path) !== ".lifecycle-bootstrap.lock")`. Take the entry at `<state>/.lifecycle-bootstrap.lock` out of the initial inventory as `bootstrapLeaf` when it is an exact owner `0600` zero-byte single-link regular file. `attributedTo` is the ID of the one plan whose `bootstrapIdentity.dev`/`.ino` equal it, else null. An attributed leaf is live residue of that envelope and sets `blocksNewIntent`. An unattributed exact leaf is coordination residue and affects nothing. Any other entry at that path stays in the inventory and blocks.
- A `retaining` journal (terminal outcome set, phase not `retained`) is not inert, whatever its outcome: `inspectPlan` returns it as `active` (resumable) before handoff, and `assertOrdinaryCommandAdmitted` refuses with `resumeWithInit()`.
- An envelope with no valid journal slot is `unverified` exactly when its residue is confined to its plan, two slots and retained names, and no attributable live residue exists (§6.4). It never becomes `active`. One valid terminal slot beside a partial slot is that terminal journal.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/bootstrap/evidence-identity.v2.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'altered|incomplete'`

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t 'reopens the exact retained bootstrap-lock inode|concurrently held bootstrap lock'`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts`

Expected: PASS. Add `evidence-identity.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [x] **Step 5: Gate, commit, push**

Remove row NEW-83 from `BACKLOG.md` §1 and change "There are 45 numbered rows" to 44. In `ORDER.md` change "NEW-78, NEW-79 and NEW-81–NEW-85." to "NEW-78, NEW-79, NEW-81, NEW-82, NEW-84 and NEW-85.", "NEW-82 and NEW-83 by plan 1a" to "NEW-82 by plan 1a", and "45 open numbered rows" to "44 open numbered rows". Tick this task, update the progress sentence, run `npm run lint` and `npx vitest run --root tests repository/citations.test.ts`, obtain fresh-context review, then:

```bash
git add apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/evidence-identity.v2.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git diff --cached --name-only
git commit -m "fix(bootstrap): attribute retained bootstrap residue only by persisted identity"
```

### Task 4: Strict lifecycle configuration records · M

Source: old Task 1 (records half). Spec 1 §2.2 "Exhaustive lifecycle records", "Applied lifecycle provenance".

**Files:**
- Create: `packages/core/src/config/lifecycle.ts`
- Create: `packages/core/src/config/lifecycle.test.ts`
- Modify: `packages/core/src/config/types.ts` — `git.lifecycle?`, `automation.lifecycle?`
- Modify: `packages/core/src/config/loader.ts` — strict optional records; byte-identical serialization when absent; export the internal `brainSchema`, `redactionSchema`, `absolutePathSchema` for Task 5 (module-internal, not re-exported from the package door)
- Modify: `packages/core/src/config/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`
- Modify: `packages/core/src/update/paths.ts` — export `parseCanonicalAbsolutePathText`
- Modify: `packages/core/src/lifecycle/canonical-json.ts` — add `hashCanonicalJson`
- Test: `packages/core/src/config/config.test.ts`, `packages/core/src/update/paths.test.ts`, `packages/core/src/lifecycle/canonical-json.test.ts`

**Interfaces:**
- Consumes: `DeveloperOsConfigV1`, `loadConfig`, `serializeConfig`, `pathSegmentViolation`, `encodeCanonicalJson`, `parseLowerHexSha256`.
- Produces:

```ts
export function parseCanonicalAbsolutePathText(value: unknown): CanonicalAbsolutePathV1; // grammar only, no reopen
export function hashCanonicalJson(domain: string, value: CanonicalJsonValue): LowerHexSha256; // SHA-256(domain + "\0" + encodeCanonicalJson(value))

export type ValidatedGitBranchV1 = string & { readonly __validatedGitBranchV1: unique symbol };
export type NormalizedRemoteUrlV1 = string & { readonly __normalizedRemoteUrlV1: unique symbol };
export type VaultSegmentV1 = string & { readonly __vaultSegmentV1: unique symbol };
export interface GitScopeSnapshotV1 {
  readonly brainPath: CanonicalAbsolutePathV1;
  readonly contentRoot: VaultSegmentV1;
  readonly topicFolders: readonly VaultSegmentV1[];            // 1..256
  readonly topicAliases: Readonly<Record<string, VaultSegmentV1>>; // 0..256 own entries
  readonly indexesDir: VaultSegmentV1;
  readonly fingerprint: LowerHexSha256;
}
export interface GitSyncConfigV1 {
  readonly schemaVersion: 1;
  readonly repositoryRoot: CanonicalAbsolutePathV1;
  readonly branch: ValidatedGitBranchV1;
  readonly remote: {
    readonly name: "developer-os";
    readonly transport: "local" | "https" | "ssh";
    readonly declaredUrl: NormalizedRemoteUrlV1;
    readonly effectivePushUrl: NormalizedRemoteUrlV1;
  };
  readonly scope: GitScopeSnapshotV1;
}
export type NormalizedScheduleV1 =
  | { readonly cadence: "hourly"; readonly minute: number }
  | { readonly cadence: "daily"; readonly hour: number; readonly minute: number }
  | { readonly cadence: "weekly"; readonly day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; readonly hour: number; readonly minute: number };
export type ScheduledJobIdV1 = "brain-reindex" | "brain-lint" | "doctor" | "git-sync";
export interface AutomationConfigV1 {
  readonly schemaVersion: 1;
  readonly schedules: readonly { readonly job: ScheduledJobIdV1; readonly schedule: NormalizedScheduleV1 }[];
}
export type LifecycleActivationArmV1 = { readonly state: "inactive" } | { readonly state: "active"; readonly configHash: LowerHexSha256 };
export interface LifecycleActivationRecordV1 { readonly schemaVersion: 1; readonly git: LifecycleActivationArmV1; readonly automation: LifecycleActivationArmV1 }

export const SCHEDULED_JOB_IDS: readonly ["brain-reindex", "brain-lint", "doctor", "git-sync"];
export function parseValidatedGitBranch(value: unknown): ValidatedGitBranchV1;
export function parseNormalizedRemoteUrl(value: unknown, transport: "local" | "https" | "ssh"): NormalizedRemoteUrlV1;
export function gitScopeFingerprint(scope: Omit<GitScopeSnapshotV1, "fingerprint">): LowerHexSha256;
export function lifecycleConfigHash(subsystem: "git" | "automation", lifecycle: GitSyncConfigV1 | AutomationConfigV1): LowerHexSha256;
export function parseLifecycleActivationRecord(bytes: Uint8Array): LifecycleActivationRecordV1;
export function encodeLifecycleActivationRecord(record: LifecycleActivationRecordV1): CanonicalJsonV1;
```

- [x] **Step 1: Write failing record, grammar and hash tests**

```ts
const SPEC_GIT_EXAMPLE = '{"branch":"main","remote":{"declaredUrl":"file:///Users/test/git/brain.git","effectivePushUrl":"file:///Users/test/git/brain.git","name":"developer-os","transport":"local"},"repositoryRoot":"/Users/test/DeveloperBrain","schemaVersion":1,"scope":{"brainPath":"/Users/test/DeveloperBrain","contentRoot":"content","fingerprint":"beb2e2591f459a3bc58969ec3b82171dcd3f37525e9149520a1a12851135d794","indexesDir":"_indexes","topicAliases":{"PROJEKTY":"PROJECTS"},"topicFolders":["DEV","PROJECTS"]}}\n';

it("reproduces the fingerprint Spec 1 §2.2 prints for its canonical Git example", () => {
  const record = decodeCanonicalJson(new TextEncoder().encode(SPEC_GIT_EXAMPLE), 1_048_576) as unknown as GitSyncConfigV1;
  const { fingerprint, ...scope } = record.scope;
  expect(gitScopeFingerprint(scope)).toBe(fingerprint);
});

it("keeps a configuration without lifecycle records byte-identical", () => {
  expect(serializeConfig(loadConfig(LEGACY_TOML))).toBe(LEGACY_TOML);
});

it.each(ACCEPTED_URLS)("accepts the already-normalized %s", (transport, url) => {
  expect(parseNormalizedRemoteUrl(url, transport)).toBe(url);
});

it.each(REFUSED_URLS)("refuses %s as not normalized or not admitted", (transport, url) => {
  expect(() => parseNormalizedRemoteUrl(url, transport)).toThrow();
});
```

If the fingerprint test fails with a correct implementation, the spec example is wrong: stop and report rather than change the expected value.

Cover: `ACCEPTED_URLS` includes `file:///Users/test/git/brain.git`, `https://example.com/org/repo.git`, `https://example.com:8443/`, `https://192.0.2.1/repo`, `ssh://git@example.com/org/repo.git`, `ssh://example.com:2222/repo`, `git@example.com:org/repo.git`, `example.com:/srv/repo.git`. `REFUSED_URLS` includes `FILE:///x`, `file://localhost/x`, `file:///a%2fb`, `file:///a%2Fb`, `https://Example.com/`, `https://example.com`, `https://example.com:443/`, `https://example.com:0/`, `https://example.com:08443/`, `https://user@example.com/`, `https://example.com/?q`, `https://example.com/#f`, `https://[::1]/`, `https://01.2.3.4/`, `https://example.com/a/./b`, `https://example.com/%41`, `https://exa_mple.com/`, a 254-byte DNS name, a 64-byte label, `ssh://-user@example.com/r`, `ssh://example.com:22/r`, 33 SSH path segments, `git@example.com:../x`, `Example.com:x`, a URL with a CR, LF or tab, a 4,097-byte URL, and every URL under the wrong `transport`. Branches: `main` and a 255-byte name pass; `-x`, `@`, `a/.b`, `a.lock`, `a..b`, `a@{b`, `a~b`, `a^b`, `a:b`, `a?b`, `a*b`, `a[b`, `a\b`, `a b`, `a.`, `a/`, `a//b`, and a 256-byte name refuse. Records: every nested unknown key at every depth refuses; `declaredUrl !== effectivePushUrl` refuses; 257 topic folders refuse; folders equal after NFC and case fold refuse; `__proto__` alias key refuses; an alias target that is not a folder, or an alias key that is also a folder, refuses; a `fingerprint` that does not recompute refuses; `schedules` missing any of the first three jobs, out of order, with `git-sync` anywhere but fourth, with a duplicate, with `minute: 60`, `hour: 24`, `day: "Mon"`, or an extra key refuses; `enabled: true` with no lifecycle record loads; a lifecycle record whose canonical JSON exceeds 1,048,576 bytes refuses before validation; a URL containing any configured `redaction.patterns` entry refuses at load; `hashCanonicalJson("d", { a: 1 })` equals SHA-256 of the bytes `d`, NUL, `{"a":1}`, LF; activation record arms other than exactly `inactive`/`active` refuse; a non-canonical activation byte string refuses; `lifecycleConfigHash("git", …)` equals SHA-256 of `developer-os:lifecycle:git:v1\0` plus the canonical bytes of `{ enabled: true, lifecycle }`.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/config/lifecycle.test.ts src/config/config.test.ts src/update/paths.test.ts src/lifecycle/canonical-json.test.ts`

Expected: FAIL — `lifecycle.ts`, `parseCanonicalAbsolutePathText` and `hashCanonicalJson` do not exist; a config carrying `git.lifecycle` is refused by the strict `git` table.

- [x] **Step 3: Implement the records**

Rules:
- Zod `.strict()` at every object depth. Reuse `pathSegmentSchema` and the alias/fold refinements `brainSchema` already carries for `GitScopeSnapshotV1`. Bound `VaultSegmentV1` to 1..255 UTF-8 bytes.
- `parseNormalizedRemoteUrl` admits only stored normalized forms: it rejects any input that normalizing would change, per the §2.2 bullets (scheme lowercase; uppercase `%HH`; unreserved bytes literal; default ports 443/22 removed; empty HTTPS path is `/`; no dot segments; canonical IPv4; DNS label and name bounds). Resolving a raw local path to a bare repository needs the filesystem and is plan 1b's `git enable`, not load.
- Load-time redaction screening uses only the configuration's own `redaction.patterns` (Core cannot import Security). Plan 1b's `git enable` screens with the full product redactor.
- The 1 MiB bound is measured as `encodeCanonicalJson` byte length of the raw parsed record before strict validation. A TOML value that is not canonical-JSON representable (a TOML date, a float) refuses.
- `serializeConfig` emits `lifecycle` only when present, keeps the existing field order, and produces the same bytes as before for absent records.
- `lifecycleConfigHash` and `gitScopeFingerprint` call `hashCanonicalJson`, which every later domain-separated hash reuses; add no other SHA-256-over-canonical-JSON helper.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/config/lifecycle.test.ts src/config/config.test.ts src/config/segment.test.ts src/update/paths.test.ts src/lifecycle/canonical-json.test.ts src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/config/lifecycle.ts packages/core/src/config/lifecycle.test.ts packages/core/src/config/types.ts packages/core/src/config/loader.ts packages/core/src/config/index.ts packages/core/src/config/config.test.ts packages/core/src/update/paths.ts packages/core/src/update/paths.test.ts packages/core/src/lifecycle/canonical-json.ts packages/core/src/lifecycle/canonical-json.test.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): close the lifecycle configuration records"
```

### Task 5: Closed `config` key and value codecs · M

Source: old Task 1 (key half). Spec 1 §2.2 key, result and value grammar; §7 "config surface is closed".

**Files:**
- Create: `packages/core/src/config/keys.ts`
- Create: `packages/core/src/config/keys.test.ts`
- Modify: `packages/core/src/config/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 4 schemas and types; `decodeCanonicalJson`, `encodeCanonicalJson`, `CanonicalJsonValue`; `serializeConfig`.
- Produces:

```ts
export const CONFIG_READABLE_KEYS: readonly ConfigReadableKeyV1[]; // exactly the 24 keys of Spec 1 §2.2, in its order
export const CONFIG_MUTABLE_KEYS: readonly ConfigMutableKeyV1[];   // exactly the 14 keys
export type ConfigReadableKeyV1 = "schemaVersion" | "brainPath" | "adapters" | "adapters.claude" | "adapters.codex"
  | "brain" | "brain.schemaVersion" | "brain.contentRoot" | "brain.topicFolders" | "brain.topicAliases"
  | "brain.indexesDir" | "brain.retrieval" | "brain.retrieval.maxCandidates" | "brain.staleness"
  | "brain.staleness.reviewAfterDays" | "git" | "git.enabled" | "git.lifecycle" | "automation"
  | "automation.enabled" | "automation.lifecycle" | "redaction" | "redaction.patterns" | "telemetry";
export type ConfigMutableKeyV1 = "brainPath" | "adapters.claude" | "adapters.codex" | "brain" | "brain.contentRoot"
  | "brain.topicFolders" | "brain.topicAliases" | "brain.indexesDir" | "brain.retrieval"
  | "brain.retrieval.maxCandidates" | "brain.staleness" | "brain.staleness.reviewAfterDays" | "redaction"
  | "redaction.patterns";
export type PublishableDeveloperOsConfigV1 = Omit<DeveloperOsConfigV1, "redaction"> & {
  readonly redaction?: { readonly patternsCount: number };
};
export type ConfigGetResultV1 =
  | { readonly schemaVersion: 1; readonly key: null; readonly value: PublishableDeveloperOsConfigV1 }
  | { readonly schemaVersion: 1; readonly key: ConfigReadableKeyV1; readonly value: CanonicalJsonValue };
export interface ConfigSetResultV1 { readonly schemaVersion: 1; readonly key: ConfigMutableKeyV1; readonly outcome: "updated" | "unchanged" }
export interface ConfigMutationV1 { readonly config: DeveloperOsConfigV1; readonly result: ConfigSetResultV1 }
export type ConfigRefusalReasonV1 = "config_key_unknown" | "config_key_read_only" | "config_value_not_canonical_json"
  | "config_value_invalid" | "config_parent_absent" | "config_brain_path_is_repository_identity";
export class ConfigRefusalError extends Error { readonly code: typeof EXIT_CODES.invalidInput; readonly reason: ConfigRefusalReasonV1 }
export function parseConfigReadableKey(value: string): ConfigReadableKeyV1;
export function publishableConfig(config: DeveloperOsConfigV1): PublishableDeveloperOsConfigV1;
export function readConfigValue(config: DeveloperOsConfigV1, key: ConfigReadableKeyV1 | null): ConfigGetResultV1;
export function setConfigValue(config: DeveloperOsConfigV1, key: string, argvValue: string): ConfigMutationV1;
```

- [x] **Step 1: Write failing exhaustive key tests**

```ts
it("enumerates exactly the Spec 1 key unions", () => {
  expect(CONFIG_READABLE_KEYS).toHaveLength(24);
  expect(CONFIG_MUTABLE_KEYS).toHaveLength(14);
  expect(CONFIG_MUTABLE_KEYS.every((key) => CONFIG_READABLE_KEYS.includes(key))).toBe(true);
});

it.each(CONFIG_READABLE_KEYS)("reads %s from the publishable projection only", (key) => {
  const result = readConfigValue(configWithEverything, key);
  expect(JSON.stringify(result)).not.toContain(PATTERN_SENTINEL);
});

it.each(CONFIG_READABLE_KEYS.filter((key) => !CONFIG_MUTABLE_KEYS.includes(key as ConfigMutableKeyV1)))(
  "refuses to set the read-only key %s", (key) => {
    expect(() => setConfigValue(configWithEverything, key, "true")).toThrow(expect.objectContaining({ reason: "config_key_read_only" }));
  });

it.each([
  ["brain.staleness.reviewAfterDays", "30", "updated"],
  ["adapters.claude", "false", "unchanged"],
  ["redaction", "null", "updated"],
  ["redaction.patterns", '["client-a"]', "updated"],
] as const)("sets %s to %s", (key, value, outcome) => {
  expect(setConfigValue(configWithEverything, key, value).result).toStrictEqual({ schemaVersion: 1, key, outcome });
});
```

Cover: `readConfigValue(config, null)` returns every key in `DeveloperOsConfigV1` order with `redaction` replaced by `{ patternsCount }`; `redaction.patterns` returns the integer count; absent `brain`, `redaction`, `git.lifecycle` or `automation.lifecycle` and their children return `null`; every prefix or descendant key not in the union (`brain.retrieval.maxCandidates.x`, `git.enabled.value`, `adapter`, `""`) refuses `config_key_unknown`; values `" 30"`, `"30\n"`, `"1.0"`, `"-0"`, `'{"a" :1}'`, `"'x'"`, `"x"`, `"TRUE"` refuse `config_value_not_canonical_json`; a wrong JSON type for every mutable key refuses `config_value_invalid`; `null` for any key other than `brain` or `redaction` refuses; `brain.contentRoot` with `brain` absent refuses `config_parent_absent`; an incomplete whole `brain` refuses; `brainPath` refuses `config_brain_path_is_repository_identity` whenever `git.lifecycle` is present, even with `git.enabled: false`; a successful `set` never changes `schemaVersion`, `telemetry`, either `enabled`, either `lifecycle` record, or `brain.schemaVersion`; no refusal message contains the supplied value; `updated` versus `unchanged` is decided by comparing `serializeConfig` output.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/config/keys.test.ts`

Expected: FAIL — `keys.ts` does not exist.

- [x] **Step 3: Implement the codecs**

Rules: the value is `decodeCanonicalJson(encoder.encode(`${argvValue}\n`), 1_048_576)`, so byte-exact canonical form is required (Scope decision 11). Per-key grammars reuse the Task 4 and loader schemas; clone only the addressed path and validate the whole result through `serializeConfig`. `hasRetainedGitLifecycle` is `config.git.lifecycle !== undefined`, derived here rather than passed in. Error messages name the key and reason only.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/config/keys.test.ts src/config/lifecycle.test.ts src/config/config.test.ts src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/config/keys.ts packages/core/src/config/keys.test.ts packages/core/src/config/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): close the config key and value codecs"
```

### Task 6: Lifecycle scalars, allocated IDs and small records on Spec 2's shipped types · M

Source: old Task 3 (primitives). A2, A3, A5: import the shipped types, still produce their strict validators and the allocated-ID grammar, drop `LifecycleBootstrapCreationTempV1` (never shipped; it simply does not appear) and the three created-by-attempt fields.

**Files:**
- Modify: `packages/core/src/manifest/bootstrap.ts` — `LifecycleBootstrapLockV1` becomes an alias of `PersistedBootstrapLockIdentityV1`
- Create: `packages/core/src/lifecycle/ids.ts`, `packages/core/src/lifecycle/ids.test.ts`
- Create: `packages/core/src/lifecycle/records.ts`, `packages/core/src/lifecycle/records.test.ts`
- Create: `packages/core/src/lifecycle/index.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes (A5, never redefined): `CanonicalJsonV1`, `CanonicalJsonValue` (`lifecycle/canonical-json.ts`); `CanonicalAbsolutePathV1` (`update/paths.ts`); `UtcTimestampV1`, `SafeReasonCodeV1`, `LowerHexSha256`, `UInt64DecimalV1` and their `parse*` functions (`update/scalars.ts`); `LifecycleInstallNonceV1`, `LifecycleIdAllocatorV1`, `PersistedBootstrapLockIdentityV1` (`manifest/bootstrap.ts`); `LifecycleCoordinatorIdV1`, `ManifestParticipantIdV1` (`manifest/manifest-state.ts`).
- Produces:

```ts
// ids.ts
export type LifecycleIdPrefixV1 = "tx" | "lc" | "ge" | "le" | "mf";
export type AllocatedLifecycleIdV1<P extends LifecycleIdPrefixV1> = `${P}_${string}_${string}` & { readonly __allocatedLifecycleIdV1: P };
export type LegacyFoundationTransactionIdV1 = `tx_${string}` & { readonly __legacyFoundationTransactionIdV1: true };
export type FoundationTransactionIdV1 = AllocatedLifecycleIdV1<"tx"> | LegacyFoundationTransactionIdV1;
export type GitEffectIdV1 = AllocatedLifecycleIdV1<"ge">;
export type LaunchdEffectIdV1 = AllocatedLifecycleIdV1<"le">;
export type EffectiveUidV1 = number & { readonly __effectiveUidV1: true };
export type LegacyFoundationMutationIndexV1 = number & { readonly __legacyFoundationMutationIndexV1: true };
export interface LifecycleLedgerBoundsV1 {
  readonly journalLeavesPerRoot: 10000; readonly foundationStagingAggregateLeaves: 100000;
  readonly foundationBackupAggregateLeaves: 100000; readonly lifecycleStagingAggregateLeaves: 1000000;
  readonly lifecycleStagingPerCoordinatorLeaves: 1000000; readonly foundationOverflowAggregateLeaves: 1000000;
}
export const LIFECYCLE_LEDGER_BOUNDS: LifecycleLedgerBoundsV1;
export const UINT64_MAX: 18446744073709551615n;
export function formatAllocatedLifecycleId<P extends LifecycleIdPrefixV1>(prefix: P, nonce: LifecycleInstallNonceV1, counter: bigint): AllocatedLifecycleIdV1<P>;
export function parseAllocatedLifecycleId<P extends LifecycleIdPrefixV1>(prefix: P, value: unknown, nonce: LifecycleInstallNonceV1 | null): AllocatedLifecycleIdV1<P>;
export function allocatedCounterOf(id: AllocatedLifecycleIdV1<LifecycleIdPrefixV1>): bigint;
export function parseFoundationTransactionId(value: unknown, nonce: LifecycleInstallNonceV1 | null): FoundationTransactionIdV1;
export function parseLifecycleCoordinatorId(value: unknown, nonce: LifecycleInstallNonceV1 | null): LifecycleCoordinatorIdV1;
export function parseManifestParticipantId(value: unknown, nonce: LifecycleInstallNonceV1 | null): ManifestParticipantIdV1; // allocated `mf` arm only
export function parseEffectiveUid(value: unknown, expected: number): EffectiveUidV1;
export function parseAllocatedFoundationMutationIndex(text: string): number;                 // "0".."255"
export function parseLegacyFoundationMutationIndex(text: string): LegacyFoundationMutationIndexV1; // "0".."4294967294"

// records.ts
export interface UninstallingMarkerV1 { readonly schemaVersion: 1; readonly coordinatorId: LifecycleCoordinatorIdV1; readonly createdAt: UtcTimestampV1 }
export function parseLifecycleInstallNonce(bytes: Uint8Array): LifecycleInstallNonceV1;             // exactly 65 bytes
export function parseLifecycleIdAllocator(bytes: Uint8Array, nonce: LifecycleInstallNonceV1): LifecycleIdAllocatorV1; // ≤ 1,024 bytes, canonical, §2.1 nonce agreement
export function encodeLifecycleIdAllocator(value: LifecycleIdAllocatorV1): CanonicalJsonV1;
export function parseLifecycleBootstrapLock(value: unknown, stateDirectory: CanonicalAbsolutePathV1, effectiveUid: number): LifecycleBootstrapLockV1;
export function parseUninstallingMarker(bytes: Uint8Array, nonce: LifecycleInstallNonceV1): UninstallingMarkerV1; // ≤ 1,024 bytes
export function encodeUninstallingMarker(value: UninstallingMarkerV1): CanonicalJsonV1;
```

- [x] **Step 1: Write failing grammar tests**

```ts
it("formats and parses the allocated grammar and binds it to the installation nonce", () => {
  const id = formatAllocatedLifecycleId("lc", NONCE, 7n);
  expect(id).toBe(`lc_${NONCE}_7`);
  expect(parseLifecycleCoordinatorId(id, NONCE)).toBe(id);
  expect(() => parseLifecycleCoordinatorId(id, OTHER_NONCE)).toThrow();
  expect(allocatedCounterOf(id)).toBe(7n);
});

it.each(["0", "4294967294"])("admits legacy mutation index %s", (text) => {
  expect(parseLegacyFoundationMutationIndex(text)).toBe(Number(text));
});

it.each(["4294967295", "-1", "01", "+1", "1.0", "", " 1"])("refuses legacy mutation index %j", (text) => {
  expect(() => parseLegacyFoundationMutationIndex(text)).toThrow();
});
```

Cover: counters `0`, `1` and `18446744073709551615` format; `01`, `-1`, `18446744073709551616` and a non-decimal byte refuse; every prefix refuses every other prefix's ID; nonce with uppercase hex, 63 or 65 hex, or wrong length refuses; `tx_<lowercase-v4-uuid>` parses as legacy only through `parseFoundationTransactionId`, and `tx_fi_<uuid>_0000000000_f` refuses there (bootstrap arm); `parseManifestParticipantId` refuses the shipped `mf_fi_`/`mf_mm_` arms; allocated mutation index `256` refuses; `parseEffectiveUid` refuses a uid not equal to `expected`, a negative number, and 4294967296; `LIFECYCLE_LEDGER_BOUNDS` equals the Spec 1 literal; nonce bytes without LF, with CRLF, with two LFs, or in uppercase refuse; allocator with extra key, `nextCounter: 1` (number), non-canonical key order, 1,025 bytes, or `installNonce` unequal to the file nonce refuses; `LifecycleBootstrapLockV1` refuses `createdByAttempt`, `productHomeCreatedByAttempt` and `stateDirectoryCreatedByAttempt` as unknown keys, refuses a path other than `<state>/.lifecycle-bootstrap.lock`, and refuses `mode` 420, `nlink` 2 and `size` 1; marker refuses 1,025 bytes, an extra key, a coordinator ID under another nonce, and a non-round-tripping timestamp.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/ids.test.ts src/lifecycle/records.test.ts`

Expected: FAIL — `ids.ts` and `records.ts` do not exist.

- [x] **Step 3: Implement**

`LifecycleBootstrapLockV1` becomes `export type LifecycleBootstrapLockV1 = PersistedBootstrapLockIdentityV1;` in `bootstrap.ts`, so the three created-by-attempt fields disappear with no second interface. Counter parsing and arithmetic use `bigint`. `lifecycle/index.ts` re-exports this task's modules, Task 2's `bookkeeping.ts`, and `hashCanonicalJson`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/config src/manifest/bootstrap.test.ts src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/manifest/bootstrap.ts packages/core/src/lifecycle/ids.ts packages/core/src/lifecycle/ids.test.ts packages/core/src/lifecycle/records.ts packages/core/src/lifecycle/records.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): validate allocated lifecycle IDs and records on Spec 2's shipped types"
```

### Task 7: Generic coordinator plan, journal, preview and Foundation participant contracts · L

Source: old Task 3 (contracts). Spec 1 §2.4 type block; §8.1 lifecycle coordinator row.

**Files:**
- Create: `packages/core/src/lifecycle/types.ts`
- Create: `packages/core/src/lifecycle/codecs.ts`
- Create: `packages/core/src/lifecycle/codecs.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 6 IDs and records; `FoundationMutationRefV1` (shipped in `manifest/bootstrap.ts`, admitted here with exactly its six Spec 1 keys); `encodeFoundationJournalJsonV1`, `TransactionJournalV1`.
- Produces (field-for-field Spec 1 §2.4; the Git, launchd, manifest, redaction-key and push leaves stay generic):

```ts
export type LifecycleCoordinatorOperationV1 = "git_enable" | "git_disable" | "git_reconcile" | "git_sync"
  | "automation_enable" | "automation_disable" | "automation_reconcile" | "uninstall";
export type LifecycleCoordinatorPhaseV1 = "planned" | "participants_applying" | "manifest_publishing"
  | "external_applying" | "config_publishing" | "push_pending" | "compensating" | "finalized" | "rolled_back" | "compacting";
export interface LifecycleCoordinatorJournalV1 {
  readonly schemaVersion: 1; readonly id: LifecycleCoordinatorIdV1; readonly operation: LifecycleCoordinatorOperationV1;
  readonly phase: LifecycleCoordinatorPhaseV1; readonly planHash: LowerHexSha256; readonly pushPlanHash: LowerHexSha256 | null;
  readonly nextStep: number; readonly compensationNext: number | null; readonly compactionNext: number | null;
  readonly terminalOutcome: "finalized" | "rolled_back" | null; readonly createdAt: UtcTimestampV1; readonly updatedAt: UtcTimestampV1;
}
export type FoundationParticipantSlotV1 = "activation" | "config" | "plist_files" | "sync_record" | "uninstall_marker" | "uninstall_artifacts";
export type LifecycleCoordinatorStepV1 =
  | { readonly kind: "foundation"; readonly slot: FoundationParticipantSlotV1; readonly participantId: FoundationTransactionIdV1 }
  | { readonly kind: "manifest"; readonly transition: "preserve_before" | "publish_after" | "commit_absence" | "finalize_tombstones" }
  | { readonly kind: "source_git_effect"; readonly participantId: GitEffectIdV1 }
  | { readonly kind: "destination_git_effect"; readonly participantId: GitEffectIdV1; readonly pushPlanHash: LowerHexSha256 }
  | { readonly kind: "launchd_before_files"; readonly participantId: LaunchdEffectIdV1 }
  | { readonly kind: "launchd_after_files"; readonly participantId: LaunchdEffectIdV1 }
  | { readonly kind: "redaction_key"; readonly transition: "stage" | "delete" }
  | { readonly kind: "network_push"; readonly pushPlanHash: LowerHexSha256 }
  | { readonly kind: "drain_runners" };
export interface FoundationParticipantRefV1 {
  readonly id: FoundationTransactionIdV1; readonly slot: FoundationParticipantSlotV1;
  readonly role: { readonly kind: "forward"; readonly compensationId: FoundationTransactionIdV1 | null }
    | { readonly kind: "compensation"; readonly forwardId: FoundationTransactionIdV1 };
  readonly mutations: readonly FoundationMutationRefV1[]; readonly maximumJournalBytes: number; readonly planHash: LowerHexSha256;
  readonly initialJournal: {
    readonly finalPath: CanonicalAbsolutePathV1; readonly plannedBytesHash: LowerHexSha256; readonly stagedPath: CanonicalAbsolutePathV1;
    readonly stagedIdentity: { readonly hash: LowerHexSha256; readonly size: number; readonly mode: 384; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 };
  };
}
export interface LifecycleEffectRefV1<Id> { readonly id: Id; readonly planHash: LowerHexSha256 }
export interface LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush> {
  readonly schemaVersion: 1; readonly id: LifecycleCoordinatorIdV1; readonly previewHash: LowerHexSha256 | null;
  readonly operation: LifecycleCoordinatorOperationV1; readonly maximumJournalBytes: number;
  readonly authority: { readonly productHome: CanonicalAbsolutePathV1; readonly configPath: CanonicalAbsolutePathV1;
    readonly activationPath: CanonicalAbsolutePathV1; readonly manifestPath: CanonicalAbsolutePathV1;
    readonly repositoryRoot: CanonicalAbsolutePathV1 | null; readonly plistPaths: readonly CanonicalAbsolutePathV1[] };
  readonly participants: { readonly foundation: readonly FoundationParticipantRefV1[]; readonly manifest: TManifest | null;
    readonly sourceGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null; readonly destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null;
    readonly launchdBeforeFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null; readonly launchdAfterFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null;
    readonly launchd: TLaunchd | null; readonly redactionKey: TRedactionKey | null };
  readonly push: TPush | null; readonly steps: readonly LifecycleCoordinatorStepV1[];
}
export type LifecyclePreviewFileStateV1 = { readonly state: "absent" } | { readonly state: "present"; readonly hash: LowerHexSha256; readonly size: number };
export interface LifecyclePreviewFileChangeV1 {
  readonly role: "activation" | "config" | "plist" | "manifest" | "source_git" | "destination_git" | "redaction_key";
  readonly targetPath: CanonicalAbsolutePathV1; readonly operation: "create" | "replace" | "remove" | "keep";
  readonly before: LifecyclePreviewFileStateV1; readonly after: LifecyclePreviewFileStateV1;
}
export interface LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview> {
  readonly schemaVersion: 1; readonly previewHash: LowerHexSha256;
  readonly command: "git_enable" | "git_disable" | "automation_enable" | "automation_disable";
  readonly executionOperation: "git_enable" | "git_disable" | "git_reconcile" | "automation_enable" | "automation_disable" | "automation_reconcile";
  readonly normalizedProjection: TProjection;
  readonly authority: { readonly productHome: CanonicalAbsolutePathV1; readonly configPath: CanonicalAbsolutePathV1;
    readonly activationPath: CanonicalAbsolutePathV1; readonly manifestPath: CanonicalAbsolutePathV1 };
  readonly processTableTemplateHashes: { readonly git: LowerHexSha256 | null;
    readonly launchd: null | { readonly observation: LowerHexSha256; readonly mutationTemplate: LowerHexSha256 } };
  readonly files: readonly LifecyclePreviewFileChangeV1[];   // 0..16
  readonly git: TGitPreview | null; readonly launchd: TLaunchdPreview | null;
}
export type LifecycleCompactionEntryV1 =
  | { readonly kind: "foundation_transaction"; readonly participantId: FoundationTransactionIdV1 }
  | { readonly kind: "git_effect"; readonly side: "source" | "destination"; readonly participantId: GitEffectIdV1 }
  | { readonly kind: "launchd_effect"; readonly position: "before_files" | "after_files"; readonly participantId: LaunchdEffectIdV1 }
  | { readonly kind: "coordinator_staging" }
  | { readonly kind: "coordinator_envelope" };
export interface LifecycleTerminalCompactionV1 { readonly coordinatorId: LifecycleCoordinatorIdV1; readonly terminalOutcome: "finalized" | "rolled_back"; readonly entries: readonly LifecycleCompactionEntryV1[] }
export interface FoundationTerminalCompactionV1 { readonly transactionId: FoundationTransactionIdV1; readonly terminalPhase: "finalized" | "rolled_back"; readonly mutationCount: number }
export type LifecycleJournalClosureV1 =
  | { readonly kind: "clear" }
  | { readonly kind: "retry_only"; readonly transactionId: LifecycleCoordinatorIdV1; readonly pushPlanHash: LowerHexSha256 }
  | { readonly kind: "uninstall_draining"; readonly transactionId: LifecycleCoordinatorIdV1 }
  | { readonly kind: "lifecycle_recovery_required" };

export interface LifecycleValueCodec<T> { validate(value: unknown): T; encode(value: T): CanonicalJsonV1 }
export interface LifecycleLeafCodecsV1<TManifest, TLaunchd, TRedactionKey, TPush, TProjection, TGitPreview, TLaunchdPreview> {
  readonly manifest: LifecycleValueCodec<TManifest>; readonly launchd: LifecycleValueCodec<TLaunchd>;
  readonly redactionKey: LifecycleValueCodec<TRedactionKey>; readonly push: LifecycleValueCodec<TPush>;
  readonly pushPlanHash: (push: TPush) => LowerHexSha256;
  readonly projection: LifecycleValueCodec<TProjection>; readonly gitPreview: LifecycleValueCodec<TGitPreview>;
  readonly launchdPreview: LifecycleValueCodec<TLaunchdPreview>;
  readonly projectionSubsystem: (projection: TProjection) => "git" | "automation";
  readonly launchdPreviewTableHashes: (preview: TLaunchdPreview) => { readonly observation: LowerHexSha256; readonly mutationTemplate: LowerHexSha256 };
}
export interface LifecycleCodecContextV1 { readonly productHome: CanonicalAbsolutePathV1; readonly nonce: LifecycleInstallNonceV1; readonly effectiveUid: number }
export function createLifecycleCodecs<TManifest, TLaunchd, TRedactionKey, TPush, TProjection, TGitPreview, TLaunchdPreview>(
  leaves: LifecycleLeafCodecsV1<TManifest, TLaunchd, TRedactionKey, TPush, TProjection, TGitPreview, TLaunchdPreview>,
  context: LifecycleCodecContextV1,
): {
  readonly executionPlan: LifecycleValueCodec<LifecycleCoordinatorPlanCoreV1<TManifest, TLaunchd, TRedactionKey, TPush>>;
  readonly preview: LifecycleValueCodec<LifecyclePlanPreviewCoreV1<TProjection, TGitPreview, TLaunchdPreview>>;
  readonly coordinatorJournal: LifecycleValueCodec<LifecycleCoordinatorJournalV1>;
};
export function validateFoundationParticipantRef(value: unknown, context: LifecycleCodecContextV1, coordinatorId: LifecycleCoordinatorIdV1): FoundationParticipantRefV1;
export function validateFoundationParticipantPair(forward: FoundationParticipantRefV1, compensation: FoundationParticipantRefV1): void;
export function foundationParticipantPlanHash(ref: Omit<FoundationParticipantRefV1, "id" | "planHash">): LowerHexSha256;
export function coordinatorPlanHash(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>): LowerHexSha256;
export function lifecyclePreviewHash(preview: LifecyclePlanPreviewCoreV1<unknown, unknown, unknown>): LowerHexSha256;
```

- [x] **Step 1: Write failing codec tests with synthetic leaves**

```ts
const leaves = syntheticLeafCodecs(); // records every validate/encode call per leaf
const codecs = createLifecycleCodecs(leaves, CONTEXT);

it("validates the shared core and delegates every non-null leaf exactly once", () => {
  expect(codecs.executionPlan.validate(syntheticUninstallPlan())).toStrictEqual(syntheticUninstallPlan());
  expect(leaves.calls.manifest).toBe(1);
  expect(leaves.calls.redactionKey).toBe(1);
  expect(leaves.calls.launchd).toBe(0);
});

it("binds a paired compensation ref as the exact reverse inverse of its forward ref", () => {
  const [forward, compensation] = syntheticArtifactPair();
  expect(() => validateFoundationParticipantPair(forward, compensation)).not.toThrow();
  expect(() => validateFoundationParticipantPair(forward, { ...compensation, mutations: [...compensation.mutations].reverse() })).toThrow();
});

it("hashes the preview without its previewHash member", () => {
  const preview = syntheticGitPreview();
  expect(lifecyclePreviewHash(preview)).toBe(hashCanonicalJson("developer-os:lifecycle-preview:v1", omit(preview, "previewHash")));
});
```

Cover: every top-level and nested unknown key refuses (enumerate the key paths from the type, assert non-empty); `steps` of length 0 and 257, Foundation refs of length 65, `plistPaths` of length 5 or unsorted or duplicated, a ref with 0 or 257 mutations, `maximumJournalBytes` 0 or 1,048,577 refuse; Foundation refs not sorted by ID or duplicated refuse; `stagedPath` other than `<home>/staging/transactions/<participant-id>/<index>.bin` refuses; `initialJournal.finalPath` other than `<home>/state/transactions/<participant-id>.json` or `stagedPath` other than `<home>/staging/lifecycle/<coordinator-id>/foundation/<participant-id>/journal.json` refuses; `stagedIdentity.mode` other than 384 or `size` 0 or 1,048,577 refuses; `planHash` not equal to `developer-os:foundation-participant-plan:v1` over `{ slot, role, mutations, maximumJournalBytes, initialJournal }` refuses; create/remove/replace mutation null rules; the inverse table (forward create → remove guarded by the forward content hash; forward remove → create of the preimage staged under the compensation ID; forward replace → replace guarded by the forward content hash with preimage content) and reverse order; reciprocal `compensationId`/`forwardId`; slot mismatch between pair halves; the coordinator journal's phase/cursor null rules from the Spec 1 text (`compactionNext` and `terminalOutcome` non-null exactly in `compacting`; `compensationNext` non-null exactly in `compensating`/`rolled_back`); preview Git/launchd null and table-hash equality combinations (a Git preview with a launchd hash, an automation preview with a Git hash, launchd hashes unequal to the nested preview's); allocated IDs under a foreign nonce refuse; every `dev`/`ino` is `UInt64DecimalV1`; an encoded plan over 16,777,216 bytes refuses.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/codecs.test.ts`

Expected: FAIL — `types.ts` and `codecs.ts` do not exist.

- [x] **Step 3: Implement**

Core never imports a Git, launchd, CLI or Security type: leaves are admitted, cloned and encoded only through the injected codecs. The operation-to-steps grammar is Task 8's; this task validates only shape, cardinality, binding and hashing. Reuse `encodeCanonicalJson`/`decodeCanonicalJson` and `hashCanonicalJson`; add no second encoder.

**Open after Task 7 (2026-09-18, review finding).** Spec 1 §2.4 requires preview `files` "in canonical path/role order" but does not fix which of the two keys takes precedence. Task 7 therefore refuses a duplicate `(role, targetPath)` pair — which is what would otherwise make one operation produce two `previewHash` values — and leaves the sort precedence to the task that first builds a preview (plan 1b). Whoever settles it must pin it in the preview codec, not only in the builder.

**Also open (same review).** `lifecyclePreviewHash` hashes the raw preview while the preview codec recomputes through the injected leaves, so a leaf whose `encode` is not `encodeCanonicalJson` of its raw value leaves a builder no public way to stamp a `previewHash` that `validate` accepts. It is fail-closed today — such a preview is refused, never admitted — so plan 1b owns the fix: expose a leaf-routed `hash` on the preview codec, as `executionPlan` now has.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/types.ts packages/core/src/lifecycle/codecs.ts packages/core/src/lifecycle/codecs.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): define generic lifecycle coordinator contracts"
```

### Task 8: Exact operation grammar, points of no return and derived journal legality · L

Source: old Task 3 (grammar) and the grammar half of old Task 7. Spec 1 §2.4 coordinator vocabulary, step table (with A14's `uninstall/present_manifest_without_launchd` row), point-of-no-return table, participant bijection, `pushPlanHash` invariant, phase derivation, terminal legality, compaction entry order, ID reservation order (with A16); §7 "coordinator grammar is exact".

**Files:**
- Create: `packages/core/src/lifecycle/grammar.ts`
- Create: `packages/core/src/lifecycle/grammar.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 7 types.
- Produces:

```ts
export type LifecycleOperationVariantV1 =
  | "git_enable" | "git_reconcile" | "git_disable"
  | "git_sync/no_changes" | "git_sync/new_network" | "git_sync/existing_network" | "git_sync/new_local" | "git_sync/existing_local"
  | "automation_enable" | "automation_reconcile/files" | "automation_reconcile/live_only" | "automation_disable"
  | "uninstall/present_manifest" | "uninstall/present_manifest_without_launchd";
export type LifecycleStepTemplateV1 =
  | { readonly kind: "F"; readonly slot: FoundationParticipantSlotV1 }
  | { readonly kind: "M"; readonly transition: "preserve_before" | "publish_after" | "commit_absence" | "finalize_tombstones" }
  | { readonly kind: "S" } | { readonly kind: "D" } | { readonly kind: "P" } | { readonly kind: "Q" }
  | { readonly kind: "K"; readonly transition: "stage" | "delete" } | { readonly kind: "N" } | { readonly kind: "R" };
export const LIFECYCLE_STEP_GRAMMAR: Readonly<Record<LifecycleOperationVariantV1, readonly LifecycleStepTemplateV1[]>>;
export type LifecyclePointOfNoReturnV1 = { readonly kind: "terminal_foundation"; readonly slot: FoundationParticipantSlotV1 }
  | { readonly kind: "effect_verified"; readonly step: "S" | "D" | "Q" } | { readonly kind: "push_succeeded" }
  | { readonly kind: "manifest_commit_absence" };
export const LIFECYCLE_POINT_OF_NO_RETURN: Readonly<Record<LifecycleOperationVariantV1, LifecyclePointOfNoReturnV1>>;
export interface LifecycleVariantFactsV1 {
  readonly gitSync: null | { readonly newCommit: boolean; readonly transport: "network" | "local"; readonly noChanges: boolean };
  readonly automationReconcile: null | "files" | "live_only";
  /** A14: true when the manifest owns a plist, the config has `automation.lifecycle`, or the activation automation arm is `active`. */
  readonly uninstallLaunchdEvidence: null | boolean;
}
export function deriveLifecycleOperationVariant(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>, facts: LifecycleVariantFactsV1): LifecycleOperationVariantV1;
export function validateLifecyclePlanGrammar(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>, facts: LifecycleVariantFactsV1): LifecycleOperationVariantV1;
export function pointOfNoReturnStepIndex(variant: LifecycleOperationVariantV1, steps: readonly LifecycleCoordinatorStepV1[]): number;
export function derivedCoordinatorPhase(step: LifecycleCoordinatorStepV1): Exclude<LifecycleCoordinatorPhaseV1, "planned" | "push_pending" | "compensating" | "finalized" | "rolled_back" | "compacting">;
export function validateCoordinatorJournalForPlan(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>, journal: LifecycleCoordinatorJournalV1, variant: LifecycleOperationVariantV1, pushPlanHash: LowerHexSha256 | null): void;
export function deriveTerminalCompaction(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>, outcome: "finalized" | "rolled_back"): LifecycleTerminalCompactionV1;
export type LifecycleReservationSlotV1 = { readonly prefix: "lc" | "tx" | "ge" | "le" | "mf"; readonly role: string };
export function lifecycleReservationOrder(plan: LifecycleCoordinatorPlanCoreV1<unknown, unknown, unknown, unknown>): readonly LifecycleReservationSlotV1[];
```

- [x] **Step 1: Write failing table-driven grammar tests**

```ts
const VARIANTS = Object.keys(LIFECYCLE_STEP_GRAMMAR) as LifecycleOperationVariantV1[];

it("enumerates exactly the fourteen Spec 1 variants, A14's included", () => {
  expect(VARIANTS).toHaveLength(14);
});

it.each(VARIANTS)("accepts the exact synthetic plan for %s and rejects every single-step corruption", (variant) => {
  const { plan, facts } = syntheticPlanFor(variant);
  expect(validateLifecyclePlanGrammar(plan, facts)).toBe(variant);
  const corruptions = stepCorruptionsOf(plan); // missing, duplicated, reordered, wrong-slot, wrong-side, wrong-hash, unused participant
  expect(corruptions.length).toBeGreaterThan(0);
  for (const corrupted of corruptions) expect(() => validateLifecyclePlanGrammar(corrupted, facts)).toThrow();
});

it("reserves lc, then forward Foundation refs in step order each followed by its compensation, then S, D, P, Q, then mf last (A16)", () => {
  const { plan } = syntheticPlanFor("uninstall/present_manifest");
  expect(lifecycleReservationOrder(plan).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "le", "mf"]);
  const { plan: withoutLaunchd } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
  expect(lifecycleReservationOrder(withoutLaunchd).map((slot) => slot.prefix)).toStrictEqual(["lc", "tx", "tx", "tx", "tx", "mf"]);
});

it("derives the uninstall variant from launchd evidence and refuses a plan shaped for the other one (A14)", () => {
  const { plan, facts } = syntheticPlanFor("uninstall/present_manifest_without_launchd");
  expect(validateLifecyclePlanGrammar(plan, facts)).toBe("uninstall/present_manifest_without_launchd");
  expect(() => validateLifecyclePlanGrammar(plan, { ...facts, uninstallLaunchdEvidence: true })).toThrow();
  const withP = syntheticPlanFor("uninstall/present_manifest");
  expect(() => validateLifecyclePlanGrammar(withP.plan, { ...withP.facts, uninstallLaunchdEvidence: false })).toThrow();
});
```

Cover: each `LIFECYCLE_STEP_GRAMMAR` row equals the Spec 1 §2.4 table literally (write the fourteen expected arrays out in the test, not derived from the implementation); each point of no return equals the Spec 1 table; forward Foundation refs strictly before the point of no return have a compensation ref, and refs at or after it have `compensationId: null`; `automation_reconcile/live_only` has exactly one `Q`, no Foundation or manifest arm, and zero or more transitions, while `/files` without a plist mutation refuses; `new_*` requires a source effect, `existing_*` forbids one, `no_changes` forbids push and both Git effects, network variants forbid `D`, local variants forbid `N`; `pushPlanHash` null exactly when `plan.push` is null, in every phase; a `push_pending` journal whose cursor is not at `N(h)`/`D(h)` refuses; derived phase at every cursor for every variant, including the `planned` → first-step rewrite; `finalized` legality requires `nextStep === steps.length` and both auxiliary cursors null; `rolled_back` requires `compensationNext === -1`; `compacting` requires `terminalOutcome` equal to the preceding phase; `deriveTerminalCompaction` orders Foundation refs by ID, then source Git, destination Git, before-files launchd, after-files launchd, then `coordinator_staging`, then `coordinator_envelope`, with 2..70 entries; the manifest participant `mf` ID is reserved last (D28); `uninstall/present_manifest_without_launchd` has null `launchd`, `launchdBeforeFiles` and `launchdAfterFiles`, empty `plistPaths`, the same point of no return as `uninstall/present_manifest`, and a compensation order without `P`; `uninstallLaunchdEvidence` is null exactly for non-uninstall operations.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/grammar.test.ts`

Expected: FAIL — `grammar.ts` does not exist.

- [x] **Step 3: Implement the tables as data**

The variant is derived, never read from a stored string: from `operation`, the manifest arm, `facts`, and which effect arms are non-null. For `uninstall`, `facts.uninstallLaunchdEvidence` selects `uninstall/present_manifest` (true) or `uninstall/present_manifest_without_launchd` (false), and the plan must have that row's shape. `validateLifecyclePlanGrammar` expands the row's templates against the plan's participants and requires a bijection: every `F` template matches one forward ref of that slot, every non-null effect arm matches one step with the same ID and hash, a manifest arm exists exactly when an `M` appears, a redaction-key arm exactly when a `K` appears, and `launchd` is non-null exactly for the three automation operations and `uninstall/present_manifest`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/grammar.ts packages/core/src/lifecycle/grammar.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): encode the exact lifecycle operation grammar"
```

### Task 9: A stable lock provider that never creates, with bounded lease acquisition · M

Source: old Task 4 (lock half). A12: "Acquirers open `state/.lifecycle.lock` without `O_CREAT` … only Spec 2's fresh `init` creates the global lock, and on a V2 home an absent path refuses." Spec 1 §2.3 interactive contention; §6 step 2 ten-minute drain (Scope decision 3).

**Files:**
- Create: `packages/core/src/lifecycle/locks.ts`
- Create: `packages/platform-macos/src/stable-lock.ts`
- Create: `packages/platform-macos/src/stable-lock.test.ts`
- Modify: `packages/platform-macos/src/transaction-lock.ts` — export `LockfRunner`, `SpawnLockfRunner`, `EX_TEMPFAIL` for reuse (no behaviour change)
- Modify: `packages/platform-macos/src/index.ts`, `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: `LockfRunner`/`SpawnLockfRunner` (`/usr/bin/lockf -s -t 0 3`), `EXIT_CODES`, `CanonicalAbsolutePathV1`, `UInt64DecimalV1`.
- Produces:

```ts
// packages/core/src/lifecycle/locks.ts
export interface HeldLifecycleStableLockV1 {
  readonly path: CanonicalAbsolutePathV1; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
  release(): Promise<void>;
}
export class LifecycleLockBusyError extends Error { readonly code: typeof EXIT_CODES.recoveryRequired; readonly reason: "lifecycle_lock_busy"; readonly path: string }
export class LifecycleLockMissingError extends Error { readonly code: typeof EXIT_CODES.recoveryRequired; readonly reason: "lifecycle_lock_missing"; readonly path: string }
export class LifecycleLockShapeError extends Error { readonly code: typeof EXIT_CODES.securityRefusal; readonly reason: "lifecycle_lock_shape"; readonly path: string }
export interface LifecycleLockDeadlineV1 { readonly nowMs: () => number; readonly sleepMs: (milliseconds: number) => Promise<void>; readonly deadlineMs: number }
export const LIFECYCLE_LEASE_DRAIN_MS: 600_000;
export const LIFECYCLE_LOCK_RETRY_MS: 250;
export interface LifecycleStableLockProviderV1 {
  /** Non-blocking. Never creates the path, its parent, or changes a mode. */
  acquireExisting(path: CanonicalAbsolutePathV1): Promise<HeldLifecycleStableLockV1>;
  /** Acquires every path in the given order, retrying busy ones until the absolute deadline; on timeout releases all it holds and throws LifecycleLockBusyError. */
  acquireExistingWithin(paths: readonly CanonicalAbsolutePathV1[], deadline: LifecycleLockDeadlineV1): Promise<readonly HeldLifecycleStableLockV1[]>;
}

// packages/platform-macos/src/stable-lock.ts
export interface MacOsStableLockDependencies {
  readonly fs: { lstat(path: string): Promise<Stats>; open(path: string, flags: number): Promise<FileHandle> };
  readonly runner: LockfRunner;
  readonly getUid: () => number;
}
export class MacOsStableLockProvider implements LifecycleStableLockProviderV1 {
  constructor(dependencies?: Partial<MacOsStableLockDependencies>);
}
```

- [x] **Step 1: Write failing provider tests**

```ts
it("refuses an absent lock path without creating it or its parent", async () => {
  const path = join(await ownerOnlyDirectory(), "state", ".lifecycle.lock") as CanonicalAbsolutePathV1;
  await expect(new MacOsStableLockProvider().acquireExisting(path)).rejects.toBeInstanceOf(LifecycleLockMissingError);
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(dirname(path))).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses a second holder as busy and admits it after release", async () => {
  const path = await exactLockFile();
  const provider = new MacOsStableLockProvider();
  const held = await provider.acquireExisting(path);
  await expect(provider.acquireExisting(path)).rejects.toBeInstanceOf(LifecycleLockBusyError);
  await held.release();
  await (await provider.acquireExisting(path)).release();
});

it("drains in order under one absolute deadline and releases everything on timeout", async () => {
  const clock = fakeClock();
  // paths 1 and 2 acquire; path 3 is busy at 0, 250 and 500 ms and again on the final attempt after the 600 ms deadline
  const runner = scriptedLockf([0, 0, EX_TEMPFAIL, EX_TEMPFAIL, EX_TEMPFAIL, EX_TEMPFAIL]);
  const provider = new MacOsStableLockProvider({ runner });
  await expect(provider.acquireExistingWithin(await fourLeases(), { ...clock, deadlineMs: clock.nowMs() + 600 }))
    .rejects.toBeInstanceOf(LifecycleLockBusyError);
  expect(runner.results.remaining).toBe(0);
  expect(runner.releasedDescriptors).toBe(2);
  expect(clock.sleeps.every((ms) => ms === LIFECYCLE_LOCK_RETRY_MS)).toBe(true);
});
```

Cover: a symlink, directory, FIFO, mode `0644`, size 1, `nlink` 2, or a foreign owner at the path refuses `LifecycleLockShapeError` without running `lockf`; the open flags never include `O_CREAT` (assert through an injected `fs.open` that records flags); an identity swap between `lstat` and `open`, or after `lockf` returns, refuses shape and closes the descriptor; the parent's mode is never changed (compare before and after); `acquireExistingWithin([])` returns `[]`; paths are acquired in the given order and never re-sorted; a lease path removed mid-drain refuses `LifecycleLockMissingError` and releases what was held; the real `SpawnLockfRunner` proves busy detection between two providers in one process.

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/platform-macos src/stable-lock.test.ts`

Expected: FAIL — `stable-lock.ts` and `locks.ts` do not exist.

- [x] **Step 3: Implement**

Rules: `lstat` first and require an owner `0600` zero-byte single-link regular file; `open(path, O_RDWR | O_NOFOLLOW)`; `fstat` identity equal to the `lstat`; `runner.acquire(handle.fd)`; `EX_TEMPFAIL` with no signal is busy; after acquisition recheck `lstat` and `fstat` identity; release closes the descriptor exactly once. No `mkdir`, no `chmod`. `acquireExistingWithin` retries only busy errors, sleeping `LIFECYCLE_LOCK_RETRY_MS` while `nowMs() < deadlineMs`; the attempt that straddles the deadline is the one final non-blocking attempt, and its refusal propagates. Corrected 2026-09-18 from "one final non-blocking attempt per remaining path": the walk stops at the first still-busy path and never skips ahead to a later lease, because §2.3 forbids inverting lock order.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/platform-macos src/stable-lock.test.ts src/transaction-lock.test.ts`

Run: `npx vitest run --root packages/core src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/locks.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts packages/platform-macos/src/stable-lock.ts packages/platform-macos/src/stable-lock.test.ts packages/platform-macos/src/transaction-lock.ts packages/platform-macos/src/index.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(platform-macos): acquire lifecycle locks without ever creating them"
```

### Task 10: The guarded filesystem port and the install-scoped ID allocator · M

Source: old Task 4 (allocator half). Spec 1 §2.4 ID allocation and allocator-temp recovery; §7 "terminal collection stays bounded" (allocator clauses).

**Files:**
- Create: `packages/core/src/lifecycle/guarded-fs.ts`
- Create: `packages/core/src/lifecycle/guarded-fs.test.ts`
- Create: `packages/core/src/lifecycle/testing.ts` — in-memory `LifecycleGuardedFileSystemV1` for counting seams; imported by tests only, never exported from an index
- Create: `packages/core/src/lifecycle/allocator.ts`
- Create: `packages/core/src/lifecycle/allocator.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 6 `parseLifecycleInstallNonce`, `parseLifecycleIdAllocator`, `encodeLifecycleIdAllocator`, `UINT64_MAX`; Task 9 `HeldLifecycleStableLockV1`; `PublishBootstrapInitialJournalNoReplace` (`packages/core/src/transactions/types.ts`).
- Produces:

```ts
// guarded-fs.ts
export interface LifecycleGuardedEntryV1 {
  readonly path: CanonicalAbsolutePathV1; readonly kind: "regular_file" | "directory" | "symlink" | "other";
  readonly ownerUid: number; readonly mode: number; readonly nlink: number;
  readonly size: UInt64DecimalV1; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1;
}
export class LifecycleRecoveryRequiredError extends Error {
  readonly code: typeof EXIT_CODES.recoveryRequired; readonly reason: SafeReasonCodeV1; readonly paths: readonly string[];
}
export interface LifecycleGuardedFileSystemV1 {
  lstat(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1 | null>;
  readRegular(entry: LifecycleGuardedEntryV1, maximumBytes: number): Promise<Uint8Array>;
  hashRegular(entry: LifecycleGuardedEntryV1, maximumBytes: bigint): Promise<LowerHexSha256>; // streamed, bounded memory
  names(directory: LifecycleGuardedEntryV1): AsyncIterable<string>;                          // streamed; identity checked before and after
  writeExclusive(path: CanonicalAbsolutePathV1, bytes: Uint8Array): Promise<LifecycleGuardedEntryV1>; // O_CREAT|O_EXCL|O_NOFOLLOW, 0600, fsync
  mkdirExclusive(path: CanonicalAbsolutePathV1): Promise<LifecycleGuardedEntryV1>;          // 0700
  renameOver(source: LifecycleGuardedEntryV1, destination: LifecycleGuardedEntryV1): Promise<void>; // same parent; both identities rechecked
  renameNoReplace(source: LifecycleGuardedEntryV1, destinationPath: CanonicalAbsolutePathV1): Promise<void>;
  unlinkExact(entry: LifecycleGuardedEntryV1): Promise<void>;
  rmdirExactEmpty(entry: LifecycleGuardedEntryV1): Promise<void>;
  syncDirectory(entry: LifecycleGuardedEntryV1): Promise<void>;
}
export function createNodeLifecycleGuardedFileSystem(dependencies: {
  readonly renameNoReplace: PublishBootstrapInitialJournalNoReplace; readonly effectiveUid: number;
}): LifecycleGuardedFileSystemV1;

// allocator.ts
export interface LifecycleAllocatorStateV1 {
  readonly nonce: LifecycleInstallNonceV1; readonly nonceEntry: LifecycleGuardedEntryV1;
  readonly allocator: LifecycleIdAllocatorV1; readonly allocatorEntry: LifecycleGuardedEntryV1;
  readonly temp: LifecycleGuardedEntryV1 | null; // exactly one cleanable pre-rename temp, or null
}
export type LifecycleAllocatorBoundaryV1 = "temp_created" | "temp_written" | "temp_synced" | "old_rechecked" | "renamed" | "state_synced";
export interface LifecycleIdBlockV1 { readonly nonce: LifecycleInstallNonceV1; readonly firstCounter: bigint; readonly size: number }
export async function inspectLifecycleAllocator(fs: LifecycleGuardedFileSystemV1, stateDirectory: CanonicalAbsolutePathV1, effectiveUid: number): Promise<LifecycleAllocatorStateV1>;
export async function cleanLifecycleAllocatorTemp(fs: LifecycleGuardedFileSystemV1, state: LifecycleAllocatorStateV1, held: HeldLifecycleStableLockV1): Promise<LifecycleAllocatorStateV1>;
export async function reserveLifecycleIdBlock(dependencies: {
  readonly fs: LifecycleGuardedFileSystemV1; readonly stateDirectory: CanonicalAbsolutePathV1; readonly effectiveUid: number;
  readonly uuid: () => string; readonly held: HeldLifecycleStableLockV1;
  readonly afterBoundary?: (boundary: LifecycleAllocatorBoundaryV1) => void | Promise<void>;
}, size: number): Promise<LifecycleIdBlockV1>;
```

- [x] **Step 1: Write failing allocator and port tests**

```ts
it("advances the allocator durably before exposing any ID", async () => {
  const home = await freshLifecycleHome({ nextCounter: "3" });
  await expect(reserveLifecycleIdBlock({ ...home.dependencies, afterBoundary: dieAt("renamed") }, 4)).rejects.toThrow(SyntheticDeath);
  expect((await inspectLifecycleAllocator(home.fs, home.state, UID)).allocator.nextCounter).toBe("7");
  expect((await reserveLifecycleIdBlock(home.dependencies, 1)).firstCounter).toBe(7n);
});

it.each(["temp_created", "temp_written", "temp_synced", "old_rechecked"] as const)(
  "leaves the old counter authoritative and one cleanable temp after death at %s", async (boundary) => {
    const home = await freshLifecycleHome({ nextCounter: "3" });
    await expect(reserveLifecycleIdBlock({ ...home.dependencies, afterBoundary: dieAt(boundary) }, 4)).rejects.toThrow(SyntheticDeath);
    const state = await inspectLifecycleAllocator(home.fs, home.state, UID);
    expect(state.allocator.nextCounter).toBe("3");
    expect(state.temp).not.toBeNull();
    expect((await cleanLifecycleAllocatorTemp(home.fs, state, home.held)).temp).toBeNull();
  });
```

Cover: the temp name is exactly `.lifecycle-id-allocator.<lowercase-v4-uuid>.json.tmp`; an empty, partial, or complete temp is cleanable only with a canonical old allocator, nonce agreement, unchanged `state` and final identities, and the temp an owner `0600` single-link file of 0..1,024 bytes; two temps, a wrong name, a 1,025-byte temp, a temp symlink, `nlink` 2, a nonce/allocator disagreement, a counter lower than an existing allocated ID the caller supplies, and a replaced final identity each throw `LifecycleRecoveryRequiredError` and delete nothing; `nextCounter` `18446744073709551615`, and a block whose addition overflows, refuse before any temp exists; `held.path` other than `<state>/.lifecycle.lock` refuses; a block of size 0 refuses. Port (real filesystem): `writeExclusive` refuses an existing path; `renameNoReplace` refuses an existing destination and leaves both; `unlinkExact` and `rmdirExactEmpty` refuse an identity that changed since `lstat`; `names` refuses a directory whose identity changes during iteration; `hashRegular` of a 20-MiB sparse file never holds more than one 1-MiB chunk (spy on the read buffer size). In-memory port (`testing.ts`): every method matches the Node port on a small physical tree (the A8 agreement fixture later tasks reuse).

- [x] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/allocator.test.ts src/lifecycle/guarded-fs.test.ts`

Expected: FAIL — the modules do not exist.

- [x] **Step 3: Implement**

Reservation order: guarded-read nonce and allocator and require agreement; compute `next = old + size` in `bigint` and refuse overflow; `writeExclusive` the temp with the canonical postimage; sync; recheck the old allocator identity and hash; `renameOver`; `syncDirectory(state)`; return the block. The Node port implements `renameNoReplace` for regular files by computing the `regular_file` postimage and delegating to the injected `PublishBootstrapInitialJournalNoReplace` (the CLI injects `publishBootstrapInitialJournalNoReplace`); Core tests inject a `link`-then-`unlink` double that refuses `EEXIST`.

- [x] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [x] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/guarded-fs.ts packages/core/src/lifecycle/guarded-fs.test.ts packages/core/src/lifecycle/testing.ts packages/core/src/lifecycle/allocator.ts packages/core/src/lifecycle/allocator.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): reserve lifecycle ID blocks through a guarded allocator"
```

### Task 10b: One exact encoding for every recorded filesystem identity · M

Inserted by founder decision D31 (2026-09-18) after Task 10 shipped, so no later task number moves.

Source: Task 10's fresh-context review. Spec 1 §2.4 requires that a guarded protocol keep "the same reopened device/inode/hash identity throughout recovery"; a recorded identity that cannot distinguish two inodes does not satisfy it.

**Defect.** `lstat(path)` without `{ bigint: true }` returns `ino` as a JavaScript number. On APFS an inode exceeds 2^53: `/tmp` measured `1152921500312571551n`, and both `…551n` and `…552n` render `1152921500312571500` through `String(stats.ino)`. The ULP at that magnitude is 128, so up to 128 distinct inodes collapse onto one recorded identity — including the held global-lock identity at `apps/cli/src/bootstrap/executor.ts:536` and the journal-slot identities compared at `:826` and `:832`. Task 10's `packages/core/src/lifecycle/guarded-fs.ts` already records identities correctly (`entryOf`, `stats.ino.toString(10)`), and so do `apps/cli/src/bootstrap/{context,journal-store,retention}.ts`, `packages/platform-macos/src/retained-rename.ts` and `packages/security/src/protected-paths.ts`. This task removes the second encoding rather than adding a third.

**This is a live bug, not a latent one, and it gates Task 12.** Confirmed 2026-09-18 by the Task 10 re-review: `apps/cli/src/bootstrap/journal-store.ts:342-343` renders slot identities from `BigIntStats` exactly, while `apps/cli/src/bootstrap/executor.ts:826` compares those same persisted `FreshV2InitPlanV1["journalSlots"][].dev/ino` values against a number-valued `lstat`. Above 2^53 the two renderings disagree on a slot that never changed, so the executor raises `securityRefusal` "bootstrap journal slot changed identity" and **V2 bootstrap recovery is wedged entirely on a large-inode filesystem**. It is environment-gated and fails closed, which is why no test caught it. The truncating pairs also fail the other way: two collided inodes compare equal, so a swapped inode can be falsely accepted. **Task 10b lands before Task 24, and before Task 12 consumes the guarded port.**

**Files.** Enumerated 2026-09-18 by `grep -rn "String([A-Za-z_.]*\.\(ino\|dev\))" apps/cli/src packages --include="*.ts" | grep -v dist`, which counts **matching lines**: 177 for `ino` and `dev` together. The same grep with `-o` counts 225 **occurrences**, because a line like `dev: String(stats.dev), ino: String(stats.ino)` is one line and two sites. Neither figure covers an identity reference that uses no `String(...)`; 20 of those are enumerated separately below (17 in `executor.ts`, 3 in `report.ts`). **Do not trust any number or line citation in this list.** Three different counts were produced for this defect in one day by three different counting rules, and every line number here drifts as the conversion proceeds. Step 1's repository rule is the authoritative enumerator: re-derive the per-file figures from its own output and reconcile the list against it before starting, and again before the final gate.
- Modify, Core: `packages/core/src/transactions/executor.ts` (24), `packages/core/src/manifest/manifest-state.ts` (2)
- Modify, platform: `packages/platform-macos/src/stable-lock.ts` (2)
- Modify, CLI: `apps/cli/src/bootstrap/executor.ts` (49), `apps/cli/src/update/packaged-release.ts` (10)
- Modify, tests that build expectations the same lossy way: `packages/core/src/transactions/transactions.test.ts` (34), `apps/cli/src/bootstrap/retention.test.ts` (32), `apps/cli/src/bootstrap/executor.test.ts` (14), `apps/cli/src/bootstrap/journal-store.test.ts` (6), `packages/platform-macos/src/stable-lock.test.ts` (2), `packages/core/src/manifest/manifest-state.test.ts` (2)
- Also audit, number-valued `dev`/`ino` compared without `String(...)`: `apps/cli/src/bootstrap/executor.ts` (`:345`, `:350`, `:366`, `:443`, `:602`, `:949`, `:1005`, `:1430`, `:2446`, `:2595`, `:2601`, `:2635`, `:2637`, `:3159`, `:3241`, `:3591`, `:3601`), `apps/cli/src/bootstrap/report.ts` (`:448`, `:628`, `:1282`), `packages/core/src/manifest/drift.ts`, `packages/platform-macos/src/transaction-lock.ts`. Re-locate each by symbol; the line numbers drift.
- Modify first: `tests/repository/check.ts` (or `self-containment.ts` beside it, matching that file's rule shape) and `tests/repository/check.test.ts` — the banned-encoding rule; it compiles to `tests/dist/repository/check.js`, which `npm run lint` already runs
- Create: `packages/core/src/lifecycle/identity-encoding.test.ts` — the encoding unit case
- Modify: `docs/architecture/foundation-constraints.md` (the one-encoding rule), `docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, `docs/superpowers/ORDER.md`

**Interfaces:**
- Consumes: `BigIntStats` from `node:fs`; Task 10's `entryOf` encoding in `packages/core/src/lifecycle/guarded-fs.ts` as the reference.
- Produces: no new exported symbol. Every identity-recording site reads `{ bigint: true }` stats and renders `ino.toString(10)` / `dev.toString(10)`; every identity comparison compares `bigint` to `bigint` or the rendered decimal to the rendered decimal, never a number to a rendering.

**Persisted fields whose encoding changes:** `FreshV2InitPlanV1["bootstrapIdentity"].dev/ino`; `FreshV2InitPlanV1["journalSlots"][].dev/ino`; `CreatedPathEvidenceV1.dev/ino` and `PlannedCreatedPathV1["parent"]` (`preexisting`) `.dev/ino`; `BootstrapPayloadEvidenceV1.dev/ino`; the retention table's `parent` and `postimage` identities (`BootstrapRetentionParentIdentityV1`, `BootstrapRetentionPostimageV1`); `ManifestStatePlanV1` identities; the Foundation journal identities in `packages/core/src/transactions/executor.ts`; `PersistedBootstrapLockIdentityV1`. All are `UInt64DecimalV1` already, so **no schema or codec changes and no on-disk migration**: below 2^53 the two renderings are identical, and no V2 installation exists (D18, D19 — the founder machine runs the legacy runtime and nothing is released), so no durable record can carry a rounded value. Step 1 must verify that claim against `git log` and the e2e fixtures before relying on it; **if any durable V2 or V1 record on a real machine carries a rounded identity, stop and report instead of migrating silently.**

- [ ] **Step 1: Write the banned-encoding repository rule first, then the encoding tests**

**The rule comes before every other test in this task, and it must be seen red on the unchanged tree before a single site is converted.** The reason is specific: the encoding tests below exercise this task's own new helpers, so they are red only because those helpers do not exist yet. They would go green with all 177 sites untouched — they pin the fix's *encoding* and say nothing about its *completeness* — and the one defect-driven case among them depends on the filesystem the test happens to run on. A repository rule is the opposite on both counts: machine-independent, and green only when the last site is converted.

Add to `tests/repository/check.ts` a rule banning `String(<expr>.ino)` and `String(<expr>.dev)`, with the approved encoder's own file as the single allowed exception and no other allowlist entry. Match the shape of the rule already in `self-containment.ts`, including its use of `tests/helpers/typescript-lexer.ts` rather than a hand-rolled pattern, so a match inside a string literal or a comment is not reported. Its output must name every offending `path:line`, because that output — not this task's Files list — is the authoritative enumeration.

Expected before any conversion: **red**, naming 177 lines across the files listed above. Seeing it green at this point is a stop condition: it means the rule does not match what the tree contains, and the rest of the task would then be unverifiable. Record the red output in the task notes so the final gate has something to compare against.

Then pin the encoding, not an inode. Two cases, neither dependent on this machine's inode allocation:

```ts
it("records a real path's identity as the exact BigInt rendering", async () => {
  const root = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-identity-"));
  const exact = await nodeFs.lstat(root, { bigint: true });
  expect(recordedIdentity(await nodeFs.lstat(root, { bigint: true })))
    .toStrictEqual({ dev: exact.dev.toString(10), ino: exact.ino.toString(10) });
});

it("distinguishes two inodes one apart above 2^53", () => {
  const low = 2n ** 53n + 1n;
  expect(renderIno(low)).not.toBe(renderIno(low + 1n));
  expect(String(Number(low))).toBe(String(Number(low + 1n)));
});
```

The second case is the one that fails on today's code for the stated reason and cannot pass by accident: it asserts that the number path collapses the two values and the rendered path does not. Add, in the same step, one case per affected subsystem that reads a real temporary path through the production recording function and compares against `{ bigint: true }` — for the held global lock, a journal slot, a created-path evidence row and a retention postimage.

- [ ] **Step 2: Run the tests and verify they fail**

Run, in this order:

```bash
npm run lint   # the banned-encoding rule, on the unchanged tree
```

Expected: FAIL in `tests/dist/repository/check.js` — the rule reports 177 offending lines and exits non-zero. This is the task's defining failure; a green run here is a stop condition.

```bash
npx vitest run --root packages/core src/lifecycle/identity-encoding.test.ts
```

Expected: FAIL — the module does not exist. Then, after the subsystem cases are added:

Run: `npx vitest run --root apps/cli src/bootstrap/executor.test.ts -t 'identity'`

Expected: FAIL — the recorded identity is the number rendering, not the BigInt rendering. A failure for any other reason is a stop condition.

- [ ] **Step 3: Convert Core and platform**

`packages/core/src/transactions/executor.ts`, `packages/core/src/manifest/manifest-state.ts`, `packages/core/src/manifest/drift.ts`, `packages/platform-macos/src/{stable-lock,transaction-lock}.ts`. Every `lstat`/`stat`/`handle.stat` that feeds an identity takes `{ bigint: true }`; comparisons stay within one encoding. Where an injected `TransactionFileSystem` supplies `lstat`, the port keeps its signature and the call site passes the option.

Run: `npx vitest run --root packages/core && npx vitest run --root packages/platform-macos`

Expected: PASS.

- [ ] **Step 4: Convert `apps/cli/src/bootstrap` and `apps/cli/src/update`**

`executor.ts`, `report.ts`, `packaged-release.ts`. Settle the `journal-store`/`executor` cross-encoding question from Step 1 here and record the answer in the step.

Run: `npx vitest run --root apps/cli src/bootstrap src/update`

Expected: PASS.

- [ ] **Step 5: Move the tests to the same encoding**

`executor.test.ts:65`, `:89`, `:414`, `:446`, `:600`, `:625` and the other enumerated test sites build their expectations with the same lossy call. They would pass while the product is wrong, so they move to the exact same encoding rather than to a hand-written literal.

Run: `npm run test:bootstrap`

Expected: PASS.

- [ ] **Step 6: Gate, commit, push**

`npm run lint` is now the completeness gate as well as the style gate: it passes only when the banned-encoding rule finds nothing, so run it last and treat its offender list — not this task's Files list — as the record of what was converted. Tick this task's steps, rewrite `ORDER.md`'s `Plan 1a progress:` sentence to `Tasks 1–10b of 26 committed; next is Task 11 (Closed Foundation ledger inventory).`, add the one-encoding rule to `docs/architecture/foundation-constraints.md`, run `npm run lint`, obtain fresh-context review, then stage exactly the paths above and commit as `fix(identity): record every filesystem identity through exact 64-bit stats`.

**Reviewer must check:** that the banned-encoding rule was seen red on the unchanged tree before any site changed, and that it now passes with exactly one allowlist entry — the approved encoder's own file — and no second exception added to make a site pass. Then, because the rule cannot see them, read by hand every comparison of a number-valued `dev`/`ino` against a rendered decimal, starting from the 20 enumerated above and re-grepping rather than trusting that number. Also check that no test asserts a literal inode, and that the `journal-store`/`executor` disagreement above is closed in both directions — the false refusal and the false acceptance.

---
### Task 11: Closed Foundation ledger inventory · L

Source: old Task 4 (ledger inventory, Foundation half). Spec 1 §2.4 "Closed journal ledger", Foundation planless-orphan grammar, legacy compatibility, overflow recovery, A13; §7 "journal closure is fail-closed" (Foundation clauses) with A8's counting seam.

**Files:**
- Create: `packages/core/src/lifecycle/foundation-ledger.ts`
- Create: `packages/core/src/lifecycle/foundation-ledger.test.ts`
- Modify: `packages/core/src/lifecycle/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: Task 2 `LifecycleBookkeepingResidueV1`; Task 6 IDs and mutation-index parsers, `LIFECYCLE_LEDGER_BOUNDS`; Task 10 port, `LifecycleRecoveryRequiredError`, in-memory port; shipped `validateJournal`, `encodeFoundationJournalJsonV1`, `TransactionJournalV1`.
- Produces:

```ts
export interface LifecycleLedgerRootsV1 {
  readonly productHome: CanonicalAbsolutePathV1; readonly stateDirectory: CanonicalAbsolutePathV1;
  readonly foundationJournals: CanonicalAbsolutePathV1;   // state/transactions
  readonly coordinatorJournals: CanonicalAbsolutePathV1;  // state/lifecycle-journals
  readonly gitEffectJournals: CanonicalAbsolutePathV1;    // state/git-effect-journals
  readonly launchdEffectJournals: CanonicalAbsolutePathV1;// state/launchd-effect-journals
  readonly foundationStaging: CanonicalAbsolutePathV1;    // staging/transactions
  readonly foundationBackups: CanonicalAbsolutePathV1;    // backups/transactions
  readonly lifecycleStaging: CanonicalAbsolutePathV1;     // staging/lifecycle
}
export function deriveLifecycleLedgerRoots(productHome: CanonicalAbsolutePathV1): LifecycleLedgerRootsV1;
export type FoundationLedgerOrphanV1 =
  | { readonly kind: "lock_only"; readonly id: FoundationTransactionIdV1; readonly lock: LifecycleGuardedEntryV1 }
  | { readonly kind: "planless"; readonly id: FoundationTransactionIdV1; readonly leaves: readonly LifecycleGuardedEntryV1[] }
  | { readonly kind: "rewrite_temp"; readonly id: FoundationTransactionIdV1; readonly temp: LifecycleGuardedEntryV1 };
export interface FoundationLedgerV1 {
  readonly journals: ReadonlyMap<FoundationTransactionIdV1, { readonly journal: TransactionJournalV1; readonly entry: LifecycleGuardedEntryV1; readonly lock: LifecycleGuardedEntryV1 | null }>;
  readonly orphans: readonly FoundationLedgerOrphanV1[];
  readonly findings: readonly { readonly reason: SafeReasonCodeV1; readonly path: CanonicalAbsolutePathV1 }[];
  readonly counts: { readonly journalRoot: number; readonly staging: number; readonly backups: number };
  readonly overflow: boolean; // a root over its steady-state cap but every leaf valid and within 1,000,000
}
export async function inspectFoundationLedger(dependencies: {
  readonly fs: LifecycleGuardedFileSystemV1; readonly nonce: LifecycleInstallNonceV1 | null;
  readonly residue: LifecycleBookkeepingResidueV1; readonly effectiveUid: number;
  /** IDs a coordinator plan names as a participant; their staging may precede their journal. */
  readonly coordinatorParticipantIds: ReadonlySet<string>;
}, roots: LifecycleLedgerRootsV1): Promise<FoundationLedgerV1>;
```

- [ ] **Step 1: Write failing inventory tests, physical and counting**

```ts
it("agrees with the in-memory port on a small physical tree (A8)", async () => {
  const tree = await physicalFoundationTree();
  const physical = await inspectFoundationLedger(tree.nodeDependencies, tree.roots);
  const counted = await inspectFoundationLedger(tree.memoryDependencies, tree.roots);
  expect(counted).toStrictEqual(physical);
  expect(physical.journals.size).toBeGreaterThan(0);
});

it.each([
  ["journal root", 10_000, false], ["journal root", 10_001, true],
  ["staging", 100_000, false], ["staging", 100_001, true],
  ["backups", 100_000, false], ["backups", 100_001, true],
] as const)("counts the %s at %i leaves through the production path (overflow %s)", async (root, leaves, overflow) => {
  const snapshot = await inspectFoundationLedger(memoryLedgerWith(root, leaves), ROOTS);
  expect(snapshot.overflow).toBe(overflow);
  expect(snapshot.findings).toStrictEqual([]);
});

it("refuses the millionth-and-first aggregate leaf without deleting anything", async () => {
  const fs = memoryLedgerWith("aggregate", 1_000_001);
  const snapshot = await inspectFoundationLedger(fs, ROOTS);
  expect(snapshot.findings.map((finding) => finding.reason)).toContain("ledger_capacity_exceeded");
  expect(fs.mutations).toStrictEqual([]);
});
```

Cover: allocated `tx_<nonce>_<counter>.json` and legacy `tx_<uuid>.json` accepted; a foreign-nonce allocated ID, `tx_fixture_001.json`, or `TX_…` is a finding; allocated journals over 1,048,576 bytes are a finding while a legacy journal uses the compatibility read; `.<id>.lock` alone is `lock_only`; A13 residue — `.developer-os-retained.<fi-id>.<ordinal>.tombstone` in `state/transactions` whose path is in `residue.retainedPaths`, `.tx_fi_<uuid>_<ordinal>_{f|c}.lock` whose ID is in `bootstrapParticipantIds`, and `staging/transactions/<fi-participant-id>/` and `backups/transactions/<fi-participant-id>/` that are empty or hold only retained paths — is projected away, never a finding, and still counted toward the caps; the same names without residue binding are findings; journal-derived staging `<i>.bin` and `<i>.bin.sha256` and backup `<index>.bin[.tmp]`, `<index>.json[.sha256][.tmp]` names accepted, any other name a finding; allocated indices `0..255` and legacy `0..4294967294`, with `4294967295`, a sign, a leading zero, a non-decimal byte or a duplicate canonical value a finding; the planless grammar exactly (final journal absent, backup ID directory empty, gaps legal, lower indices complete pairs, highest index complete or one of `<i>.bin.tmp`, `<i>.bin`, `<i>.bin` plus `<i>.bin.sha256.tmp`, digest 64 lowercase hex plus LF matching the streamed content hash, one `.<id>.<uuid>.json.tmp` whose bytes are a `FoundationJournalJsonPrefixV1` of a `planned` journal whose non-remove indices equal the complete pairs); a coordinator participant ID's staging without a journal is not planless; symlinks, directories where files belong, wrong owner, mode other than `0600`/`0700`, and `nlink` 2 are findings; every listed scope asserts non-empty.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/foundation-ledger.test.ts`

Expected: FAIL — `foundation-ledger.ts` does not exist.

- [ ] **Step 3: Implement**

Rules: read-only; enumerate each root once through `fs.names`, never recursively beyond the exact derived grammar; stop reading at the first leaf past 1,000,000 aggregate and record `ledger_capacity_exceeded`; never materialize a directory listing larger than the cap. Findings carry the path and a safe reason code, never file content.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/foundation-ledger.ts packages/core/src/lifecycle/foundation-ledger.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): inventory the Foundation ledger with exact bootstrap residue projection"
```

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

- [ ] **Step 1: Write failing closure tests over synthetic plans**

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

Cover: zero, one and two `push_pending` candidates; one `push_pending` plus any other non-terminal journal; mixed `retry_only` and `uninstall_draining` candidates; lease paths absent while the artifacts journal is absent, or the manifest does not equal the plan's `before.hash`, never yield `uninstall_draining`; `compacting` at every `compactionNext` is `lifecycle_recovery_required`; plan-plus-lock and plan-only suffixes are legal only with every earlier compaction entry absent, and a lock-only coordinator envelope is a finding; the uninstall control-file microstates at the `coordinator_envelope` cursor (both present, allocator absent with nonce present, both absent) are legal and nonce-absent with allocator-present is a finding; a journal without its plan, an unreferenced effect journal, an ID/filename/plan-hash mismatch, a non-canonical plan, a plan over 16,777,216 bytes, and a journal over its plan's `maximumJournalBytes` are findings; an initial coordinator/participant journal temp or plan-publication temp (empty, partial, complete) is a non-clear `coordinatorOrphans` entry only in the states §2.4 admits, and a finding after any participant journal exists; a well-formed planless `staging/lifecycle/<id>` tree with both coordinator plan and journal absent is a `planless_staging` orphan; `foundation/<participant-id>/journal.json` with unknown siblings is a finding; with `gitEffectPlanCodec` and `launchdEffectPlanCodec` null (plan 1a), any leaf in either effect root and any `git/` or `launchd-process/` staging child is a finding; with synthetic effect codecs supplied, the same leaves validate against their plans (so plan 1b adds codecs, not closure logic); a non-terminal standalone Foundation journal makes closure `lifecycle_recovery_required`; the allocator temp from Task 10 makes closure non-clear without deletion; caps 10,000 per root and 1,000,000 aggregate and per coordinator counted through the in-memory port at the exact maximum and first-over; malformed bytes with no readable participant envelope still yield `lifecycle_recovery_required`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/ledger.test.ts`

Expected: FAIL — `ledger.ts` does not exist.

- [ ] **Step 3: Implement the fail-closed classification**

Order: allocator state (Task 10, read-only); Foundation ledger (Task 11), given every participant ID the valid coordinator plans name; coordinator root; effect roots; lifecycle staging; then classify exactly as Spec 1 §2.4's closure paragraph. Any finding makes closure `lifecycle_recovery_required` globally. A Foundation journal referenced by a non-terminal coordinator is not standalone. Validate every coordinator journal against its plan with Task 8's `validateCoordinatorJournalForPlan`.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/ledger.ts packages/core/src/lifecycle/ledger.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
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

- [ ] **Step 1: Write failing walk and shape tests**

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

For the bound cases, the admitted fixtures hold the extra entries inside inert retained evidence so they project away. Cover: the in-memory and Node ports agree on a small physical home (A8); every other known or unknown file or directory refuses and names its path — `config.toml`, `state/lifecycle-activation.json`, `state/git-sync.json`, `state/uninstalling.json`, a status, a log slot, a lease, `installation-manifest.json`, `.installation-manifest.<id>.json.tombstone`, `state/lifecycle-install-nonce`, `state/lifecycle-id-allocator.json`, a legacy `tx_<uuid>.json` in `state/transactions`, an unrecognized empty directory, `logs/`; any of the four `<userHome>/Library/LaunchAgents/com.developer-os.<job>.plist` paths present refuses; `activeOrAmbiguous: true` refuses; a symlink, hard-linked file, FIFO, foreign-owned directory, invalid UTF-8 name, or an entry appearing or disappearing between the two directory reads refuses before any content read; the key is recorded by `lstat` only, and a key that is a symlink, directory or `nlink` 2 file refuses; the lock `state/.lifecycle.lock` a rolled-back first `init` leaves is admitted; two walks of an unchanged home give equal `walkFingerprint`; the module performs no write and no process spawn (the port records none).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/absent-manifest.test.ts`

Expected: FAIL — `absent-manifest.ts` does not exist.

- [ ] **Step 3: Implement**

Rules: one bounded no-follow walk from the product home's parent-guarded entry, counting every entry visited, including those it then projects away. Projection order: the exact bootstrap leaf at `state/.lifecycle-bootstrap.lock` (an owner `0600` zero-byte single-link file whose `dev`/`ino` equal no `bootstrapIdentities` entry); every path in `retainedPaths`, and directories that exist only to hold them; every bookkeeping path `inspectLifecycleBookkeepingShape` admits. The remainder must equal one of the four shapes exactly. `walkFingerprint` is `hashCanonicalJson("developer-os:absent-manifest-walk:v1", entries)` over every visited entry's relative path, kind, owner, mode, `nlink`, size, `dev` and `ino`, sorted by unsigned UTF-8 path bytes. No key byte is read.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/lifecycle/absent-manifest.ts packages/core/src/lifecycle/absent-manifest.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts
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

- [ ] **Step 1: Write failing feasibility and publication tests**

```ts
it("refuses an infeasible journal maximum before the allocator moves", async () => {
  const home = await memoryLifecycleHome();
  expect(() => assertLifecycleExecutionFeasible(oversizedSyntheticBuilder(), home.snapshot, CODEC))
    .toThrow(expect.objectContaining({ reason: "journal_too_large" }));
  expect((await inspectLifecycleAllocator(home.fs, home.state, UID)).allocator.nextCounter).toBe("0");
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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/lifecycle/store.test.ts`

Expected: FAIL — `store.ts` does not exist.

- [ ] **Step 3: Implement**

The coordinator lock `.<id>.lock` in `state/lifecycle-journals` is created with the injected `TransactionLockProvider` only after the plan is durable, so a lock-only coordinator envelope is unreachable. Plan temp `.<id>.<lowercase-v4-uuid>.plan.json.tmp`; journal temp `.<id>.<lowercase-v4-uuid>.json.tmp`; both `writeExclusive` then `renameNoReplace` (first publication) or `renameOver` (rewrite), then `syncDirectory`. The store never allocates: callers reserve the block with Task 10 only after `assertLifecycleExecutionFeasible` passes.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

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

- [ ] **Step 1: Write failing participant and compaction tests**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root packages/core src/transactions/transactions.test.ts src/lifecycle/foundation-participant.test.ts src/lifecycle/foundation-compaction.test.ts`

Run: `npx vitest run --root apps/cli src/commands/doctor.test.ts`

Expected: FAIL — the new functions and modules do not exist; `doctor` throws on a compacted journal.

- [ ] **Step 3: Implement**

Do not replace the Foundation serializer, the standalone `execute` path, or the manifest's direct-write exception. The lifecycle first-write bridge takes the participant's stable ID lock, then either re-verifies an existing final journal or `renameNoReplace`s the staged inode to `state/transactions/<id>.json`, syncs, reopens, requires the same inode and exact planned bytes, and only then calls the unchanged `resume`. No participant step ever unlinks a coordinator or participant plan. Compaction runs only under the held global lock.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/transactions/transactions.test.ts src/lifecycle src/index.test.ts`

Run: `npx vitest run --root apps/cli src/commands/doctor.test.ts src/commands/status.test.ts src/commands/repair.test.ts`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add packages/core/src/transactions/executor.ts packages/core/src/transactions/index.ts packages/core/src/transactions/transactions.test.ts packages/core/src/lifecycle/foundation-participant.ts packages/core/src/lifecycle/foundation-participant.test.ts packages/core/src/lifecycle/foundation-compaction.ts packages/core/src/lifecycle/foundation-compaction.test.ts packages/core/src/lifecycle/index.ts packages/core/src/index.ts packages/core/src/index.test.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(core): coordinate Foundation participants and compact terminal Foundation transactions"
```

### Task 16: Coordinator execution, compensation, recovery and terminal compaction · L

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

- [ ] **Step 1: Write the failing exhaustive death-injection matrix**

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

- [ ] **Step 2: Run the matrix and verify it fails**

Run: `npx vitest run --root packages/core src/lifecycle/coordinator.test.ts src/lifecycle/recovery.test.ts src/lifecycle/coordinator-compaction.test.ts`

Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement the table-driven engine**

Rules: drive only from the persisted plan and journal (never a preview); call `stepHooks.before` immediately before each forward participant call (first run or recovery) and `stepHooks.after` when it returns; persist the intended phase and cursor before each participant call and the participant's durable state before advancing, in one journal rewrite; decide direction only from `LIFECYCLE_POINT_OF_NO_RETURN` and the participant phases; dispatch only the closed step union through injected adapters. Core imports no Git, launchd, Security or CLI type.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root packages/core src/lifecycle src/transactions/transactions.test.ts src/index.test.ts`

Expected: PASS, with a non-empty boundary list for each of the fourteen variants.

- [ ] **Step 5: Gate, commit, push**

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

- [ ] **Step 1: Move and sharpen the handoff tests into structural admission tests**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/admission.v2.test.ts src/bootstrap/report.test.ts -t 'admits|refuses|handoff set|programming error|listNames|status and doctor'`

Expected: FAIL — `admission.ts` does not exist and `listNames` is not accepted.

- [ ] **Step 3: Implement admission**

Rules: `observeManifestSchema` reads the manifest through `fs.lstat`/`fs.readRegular` (64 MiB bound); a non-regular entry is `manifest_invalid`; declared `schemaVersion` 1 is `v1`, 2 is `v2`, anything else `manifest_invalid`. `admitInstalledV2Home` requires `validateManifestV2` to pass with the confined `manifestAdmission`, then `assertCompleteLifecycleReservations`, then an exact nonce (Task 6), a canonical allocator whose nonce agrees, an owner `0600` zero-byte single-link lock, and three owner `0700` journal-root directories. It reads no bootstrap plan, no drift, no activation record and no closure. Only `V2HomeAdmissionError` is thrown for a refusal; other errors propagate unchanged.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/admission.v2.test.ts`

Run: `npx vitest run --root apps/cli src/bootstrap/report.test.ts -t 'listNames|inspectBootstrapEvidence'`

Expected: PASS. Add `admission.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [ ] **Step 5: Gate, commit, push**

Remove row NEW-82 from `BACKLOG.md` §1 and change "There are 44 numbered rows" to 43. In `ORDER.md` change "NEW-78, NEW-79, NEW-81, NEW-82, NEW-84 and NEW-85." to "NEW-78, NEW-79, NEW-81, NEW-84 and NEW-85.", "Owners: NEW-79, NEW-81 and NEW-85 are owned by Phase 4b; NEW-82 by plan 1a; NEW-84 by Phase 9." to "Owners: NEW-79, NEW-81 and NEW-85 are owned by Phase 4b; NEW-84 by Phase 9.", and "44 open numbered rows" to "43 open numbered rows". Tick, update the progress sentence, run `npm run lint` and `npx vitest run --root tests repository/citations.test.ts`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/admission.ts apps/cli/src/lifecycle/admission.v2.test.ts apps/cli/src/bootstrap/report.ts apps/cli/src/bootstrap/report.test.ts apps/cli/src/bootstrap/context.ts apps/cli/src/commands/uninstall.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md
git diff --cached --name-only
git commit -m "feat(cli): admit installed V2 homes structurally"
```

### Task 18: Concrete execution-plan codec and the lifecycle composition root · M

Source: old Task 21 (codecs and context half). Spec 1 §8.1 CLI ownership rows; Scope decisions 1 and 2.

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

- [ ] **Step 1: Write failing codec and composition tests**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/context.test.ts src/context.test.ts`

Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement**

Compose `createLifecycleCodecs` (Task 7) with the redaction-key codec, a manifest leaf that admits structure first and binds in the second pass, and refusing launchd and push leaves. Effect references (`sourceGitEffect`, `destinationGitEffect`, `launchdBeforeFiles`, `launchdAfterFiles`) are not leaf codecs in Task 7 — Core validates them as `{ id, planHash }` — so the CLI codec runs a post-check after Core validation: any non-null effect reference, and any `LifecycleCoordinatorStepV1` of kind `source_git_effect`, `destination_git_effect`, `launchd_before_files`, `launchd_after_files` or `network_push`, throws `LifecycleUnsupportedLeafError`. Construct the ledger, store and recovery services with `lifecycleVariantFacts`, `lifecyclePushPlanHash`, null Git/launchd effect codecs, and `uninstallLeasePaths`. Real dependencies are wired only in `createProductionContext` and the fixture.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/codecs.test.ts src/lifecycle/context.test.ts src/context.test.ts`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'reject|usage|option'`

Expected: PASS.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/lifecycle/codecs.ts apps/cli/src/lifecycle/codecs.test.ts apps/cli/src/lifecycle/context.ts apps/cli/src/lifecycle/context.test.ts apps/cli/src/context.ts apps/cli/src/context.test.ts apps/cli/src/commands/testing.ts
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): compose the lifecycle execution codec and context"
```

### Task 19: The mutation gate every Foundation mutator passes through on a V2 home · L

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

- [ ] **Step 1: Write failing gate tests, V2 cases on one shared home**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/mutation-gate.test.ts src/lifecycle/mutation-gate.v2.test.ts`

Expected: FAIL — `mutation-gate.ts` does not exist and V2 captures still use legacy IDs.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/mutation-gate.test.ts src/lifecycle/mutation-gate.v2.test.ts src/commands/capture.test.ts src/commands/repair.test.ts src/commands/review.test.ts src/commands/reindex.test.ts src/commands/ingest.test.ts src/context.test.ts`

These command files hold no V2 fixture; they are the regression surface for the legacy pass-through.

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'preserving every retained bootstrap evidence inode|dry-runs and reports retained evidence|retention roots|deep inside a retained tree|ephemeral V2 artifact'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'admits every ordinary command'`

Run: `npm run build && npx vitest run --root tests security/interruption.test.ts security/concurrent-edit.test.ts`

Expected: PASS. Add `mutation-gate.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes` per the CI budget rule.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/mutation-gate.ts apps/cli/src/lifecycle/mutation-gate.test.ts apps/cli/src/lifecycle/mutation-gate.v2.test.ts apps/cli/src/context.ts apps/cli/src/commands/testing.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): gate every V2 Foundation mutation on the lifecycle ledger"
```

### Task 20: `config get` and `config set` · M

Source: old Task 2, moved after the lock provider (Task 9) and the gate (Task 19) as roadmap Phase 4 requires. Spec 1 §2.2, §3 `config` rows; A1; A9 round trip "fresh V2 `init` → `config set` … with closure `clear` beside retained evidence" (the `git enable` preview half is plan 1b).

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

- [ ] **Step 1: Write failing command and dispatch tests**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/commands/config.test.ts src/commands/config.v2.test.ts`

Expected: FAIL — `config` is not a registered command and `config.ts` does not exist.

- [ ] **Step 3: Implement**

In `main.ts`: `COMMAND_OPTIONS.config = ["json"]`; `COMMAND_POSITIONALS.config = { min: 1, max: 3 }`; after the generic arity check, `get` takes 0 or 1 further positionals and `set` exactly 2, anything else is `null`; dispatch emits `renderConfigResult` lines for success in both modes and the standing envelope for failure. `runConfig` (Scope decision 4): `classifyMutationHome` refuses `v1` (exit 4) and `manifest_absent` (exit 2); for `manifest_absent_with_global_lock`, both `get` and `set` acquire the existing lock with `acquireExisting` (never creating it), reclassify, release, and refuse exit 2 (a busy lock refuses exit 6). On V2, `get` takes no lock and reads through `readConfigFile` and `readConfigValue`. `set` runs inside `withLifecycleMutation`, reads the config bytes, calls `setConfigValue`, and for `updated` calls `context.executor.execute({ kind: "config-set", mutations: [{ targetPath, operation: "replace", content, expectedBeforeHash }] })`.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/commands/config.test.ts src/commands/config.v2.test.ts src/lifecycle/mutation-gate.test.ts`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'reject|usage|option|config'`

Run: `npm run build && npx vitest run --root tests security/network.test.ts`

Expected: PASS. Add `config.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes` per the CI budget rule.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/commands/config.ts apps/cli/src/commands/config.test.ts apps/cli/src/commands/config.v2.test.ts apps/cli/src/main.ts apps/cli/src/main.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): add config get and config set"
```

### Task 21: Absent-manifest uninstall without a coordinator envelope · M

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

- [ ] **Step 1: Write failing arm and round-trip tests**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts src/lifecycle/absent-manifest-uninstall.v2.test.ts`

Expected: FAIL — the module does not exist, and the shipped branch unlinks the key over any residue.

- [ ] **Step 3: Implement both arms and correct the architecture notes**

`key_absent`: `inspectAbsentManifestProductHome` twice; the two `walkFingerprint`s must be equal, else exit 6; return. `key_present`: acquire the leaf `<state>/.lifecycle-bootstrap.lock` with the transaction lock provider, require the exact owner `0600` zero-byte single-link shape, repeat the inspection (the fresh leaf projects away as unattributed), require shape `state_key_only`, call `observeSecretOpaqueKey`, recheck by `lstat` that `dev`/`ino` are unchanged, `unlinkSecretOpaqueKey`, sync `state`, verify absence, release the leaf and leave it in place. Never unlink or `rmdir` anything else. A refusal over residue carries recovery "developer-os uninstall, then archive the product home manually, then developer-os init" (D20).

Documentation, replacing only these passages and leaving every launchd sentence in place:
- `docs/architecture/foundation.md`: the sentence "Before the permanent global lock exists, init and fresh absent-manifest uninstall use the exact transient `LifecycleBootstrapLockV1` protocol … rather than creating the installed four-root ledger."; the sentence "A live attempt removes only its identity-recorded empty directories; … make initial nonce/allocator recovery deterministic."; and, in "Launchd inherits only the already-unlinked snapshot; its sole linked creation prefix is frontier-bound and recoverable, while the flat key-present coordinator admits one final journal plus one bounded rewrite temp.", only the clause ", while the flat key-present coordinator admits one final journal plus one bounded rewrite temp" (the sentence then ends at "recoverable.").
- `docs/architecture/foundation-constraints.md`: the sentences from "It also adds the transient pre-product" through "have closed path/metadata/byte-prefix recovery grammars.", stopping before "Launchd never inherits".
- `docs/architecture/threat-model.md`: the clause "but performs no service probe before the recovery epoch" (becomes "and performs no service probe"); the sentences "The absent-key arm allocates nothing, while the present-key arm alone creates recoverable key transitions in a closed flat bootstrap envelope, never by adopting or creating the installed ledger." and "Initial nonce/allocator temps are admitted only through their exact bounded prefix grammars."; and the sentence "A flat absent-manifest coordinator rewrite crash may retain only its authoritative final journal plus one bounded temp.", leaving the launchd byte-boundary sentence before it.

Each replacement states A2, A3 and A12 as they now hold: absent-manifest uninstall has no coordinator envelope; `key_absent` performs two identical read-only walks and creates nothing; `key_present` deletes the key under the bootstrap leaf by rechecked identity; the leaf and the bookkeeping set are never unlinked; §8.3 residuals 8 (check-then-unlink window) and 9 (shape admission) are accepted.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts src/lifecycle/absent-manifest-uninstall.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'idempotent|orphaned key|dry run|manifest is absent|redaction key'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'renders retained evidence|whole lifecycle'`

Run: `npm run build && npx vitest run --root tests e2e/foundation.test.ts -t 'installs, reports, repeats' repository/citations.test.ts`

Expected: PASS. Add `absent-manifest-uninstall.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/absent-manifest-uninstall.ts apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/main.test.ts tests/e2e/foundation.test.ts docs/architecture/foundation.md docs/architecture/foundation-constraints.md docs/architecture/threat-model.md .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): uninstall an absent-manifest home without a coordinator envelope"
```

### Task 22: Present-manifest uninstall coordinator with drained leases · L

Source: old Task 23 (present-manifest half). Spec 1 §6 steps 1–4 and the A14/A15 paragraphs; §2.4 both uninstall rows, the A16 reservation order, `RedactionKeyStatePlanV1`, manifest no-overwrite transitions; §5.4 lease rules as they bind uninstall; D24, D25, D26, D28; §7 "uninstall drains without deadlock" (lease half), "uninstall respects ownership", "manifest transitions are no-overwrite", "uninstall removes its manifest recoverably" (with A15), "redaction-key deletion is secret-opaque".

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

- [ ] **Step 1: Write failing coordinator tests on real V2 homes**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts`

Expected: FAIL — `uninstall.ts` does not exist, and V2 uninstall still uses the Foundation downcast.

- [ ] **Step 3: Implement the planner and adapters**

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

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'manifest is absent|symlink|relocated Brain|control character|preserving every retained bootstrap evidence inode|dry-runs and reports retained evidence|retention roots|deep inside a retained tree|ephemeral V2 artifact'`

Run: `npx vitest run --root apps/cli src/main.test.ts -t 'renders retained evidence|admits every ordinary command'`

Run: `npm run build && npx vitest run --root tests e2e/fresh-v2-retained-bootstrap.test.ts security/sentinel.test.ts`

Expected: PASS. Add `uninstall.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/uninstall.ts apps/cli/src/lifecycle/uninstall.v2.test.ts apps/cli/src/lifecycle/redaction-key.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/main.test.ts tests/e2e/fresh-v2-retained-bootstrap.test.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): uninstall a V2 home through a drained lifecycle coordinator"
```

### Task 23: Uninstall dispatch and the recovery-only arm · M

Source: old Task 23 (recovery half). A7 and A14/A15 recovery-only arm (Spec 1 §2.1); A3/A7/A12 dispatch order (§6); §7 "V2 admission is structural" (recovery-only clause).

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

- [ ] **Step 1: Write failing dispatch tests over killed uninstalls, chained on one home**

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

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-recovery.v2.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

`runUninstall` becomes: `assertHomeShape` → evidence inspection → `dispatchUninstall` → the V1 path unchanged, `LifecycleUninstaller`/`recoverUninstall`, or `runAbsentManifestUninstall`. `admitRecoveryOnlyUninstall` runs only when the manifest is absent and `state/.lifecycle.lock` has its exact shape: it acquires the lock, builds the key from `coordinatorNonceOf` (never from admission, which refuses `manifest_absent`), inspects the ledger, and requires exactly one uninstall coordinator record of either variant whose state matches one bullet of §2.1's recovery-only arm, including A15's microstates at `M(finalize_tombstones)`. Recovery runs `LifecycleRecoveryService.recover(global, { resumeUninstall: true })`.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run --root apps/cli src/lifecycle/uninstall-recovery.v2.test.ts`

Run: `npx vitest run --root apps/cli src/commands/uninstall.test.ts -t 'idempotent|dry run|declined|symlink'`

Run: `npx vitest run --root apps/cli src/lifecycle/absent-manifest-uninstall.test.ts`

Expected: PASS. Add `uninstall-recovery.v2.test.ts`'s duration to `lifecycle-v2`'s recorded local total and update its `timeout-minutes`.

- [ ] **Step 5: Gate, commit, push**

Tick, update the progress sentence, run `npm run lint`, obtain fresh-context review, then:

```bash
git add apps/cli/src/lifecycle/uninstall-recovery.ts apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts apps/cli/src/commands/uninstall.ts .github/workflows/check.yml
git add -f docs/superpowers/plans/2026-09-17-developer-os-opt-in-surfaces-1a.md docs/superpowers/ORDER.md
git diff --cached --name-only
git commit -m "feat(cli): dispatch uninstall through its recovery-only arm"
```

### Task 24: Uninstall → `init` round-trip gates · L

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

it("recovers an uninstall killed at every A9 point and then initialises, reusing one chained home", async () => {
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

`KILL_MATRIX_TIMEOUT_MS` is a file-local constant derived the same way as Task 23's: measure once with `4 * REAL_FILESYSTEM_TIMEOUT_MS`, then set ceil(measured × 2 × 1.5) with the measurement in a one-line comment. `A9_KILL_POINTS` is exactly:
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

Run `git status --short` (must be clean) and `gh run list --branch development --limit 1 --json status,conclusion,headSha`: the head is pushed and no completed run on it is red. Confirm every checkbox of Tasks 1–24 is ticked, and that `git log --oneline <Task 1 commit>^..HEAD` lists one commit per task plus its review fixes. Remove any worktree inside the repository first: ESLint does not read `.gitignore`.

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

Dispatch a reviewer who authored none of Tasks 1–24. Give it the diff `git diff <Task 1 commit>^..HEAD`, the amended Spec 1, this plan and review-only instructions. For each accepted finding: add a failing regression test, apply the smallest fix, rerun the affected focused commands and Step 2, and request a new verdict. Continue until the verdict has no Critical or Important finding.

- [ ] **Step 4: Carry surviving constraints into the canonical documents**

`docs/architecture/foundation.md` gains a section "Lifecycle kernel (Spec 1a)" stating: the bookkeeping set and its shape admission; the two present-manifest uninstall variants and their derivation (D24), the empty-directory removal inside `M(finalize_tombstones)` (D25), the `mf` reservation order (D28), and the capacity refusal (D26); the non-creating global lock and lock order; structural V2 admission; the mutation gate every V2 Foundation mutator passes (allocated `tx` IDs, compaction and reservation preflight, closure `clear`, the `repair` resolution); the closed `config` key and result grammar; the uninstall variants, point of no return, lease drain, and absent-manifest arms; what is refused until plan 1b. `docs/architecture/foundation-constraints.md` records the exact bounds from this plan's Global Constraints that code now enforces. `docs/architecture/threat-model.md` records: the global lock is never created outside fresh `init`; the gate's contention and ledger refusals; secret-opaque key handling; §8.3 residuals 8 and 9. Then run `npx vitest run --root tests repository/citations.test.ts`, and lower a citation floor only with the removed section named in its comment.

- [ ] **Step 5: Close the tracking rows and advance NOW**

- Roadmap: tick "Execute plan 1a" ("Write plan 1a" is already ticked), and prune Phase 4 to a closed bullet ("closed <date> as `<first>..<last>`", its outcome in two sentences, the constraint locations).
- `ORDER.md`: remove the `Plan 1a progress:` sentence; NOW becomes Phase 4b (Spec 2 Tasks 10–11 plus the pin removal, NEW-79 and NEW-81 first); update the open-sequence list and the Count section.
- `BACKLOG.md`: remove NEW-69 (closed by Task 2), and NEW-70 if `grep -rn reusableGlobalLock apps/cli/src` is empty; keep NEW-85 (Phase 4b, D26); change "There are 43 numbered rows" to 42, or 41 when NEW-70 also goes; in §0 remove "Spec 1a"; in §3 A11 tick the "Execute plan 1a" line and leave its plan 1b clause unticked. In `ORDER.md` change "43 open numbered rows" to match.
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

## Self-review record

- **Spec coverage.** Every roadmap Phase 4 obligation maps to a task:
  - A1 precondition: Global Constraints.
  - Exact-set pin and status rename: 1. Spec 2 types: 6.
  - Absent-manifest inspection without an epoch: 13. No key-present coordinator: 21. Recovery-only arm: 23.
  - Structural admission and NEW-82: 17. A13 closure projection with its correction: 2, 11.
  - Bookkeeping shape admission, inertness, NEW-69: 2. NEW-83: 3.
  - A9 with A8 ceilings: 10–13, 16, 20, 21, 24.
  - Non-creating lock provider and the conditional `createdPaths[0]`: 9, 2. Architecture notes: 21, 25.
  - The founder's answers D24–D29 are applied as Spec 1 A14–A16 and carried by Tasks 8, 16, 18, 22, 23 and 24. D26 leaves NEW-85 open for Phase 4b.
- **Second review of 2026-09-17 (NOT READY, no Critical) addressed.** I1: `LifecycleHomeKeyV1` keys every lifecycle service on `{ productHome, nonce }`, built from admission or from the coordinator ID, with a Task 18 test over a home whose manifest, nonce and allocator are absent. I2: the `M(finalize_tombstones)` adapter authenticates the tombstone by `before.hash` and takes directory rows structurally under `authority.productHome` with an unconfined owner admission, plus a non-default-`brainPath` recovery test. m1: `inspectLifecycleBookkeepingShape` returns the deepest `offendingPath`. m2: the `lifecycle-v2` job is created in Task 1, with the run-35213248735 baselines stated. m3: both chained files derive their timeout from a measurement. m4, m5, m6, m7, m9 and m10 applied as asked; m8 reworded A14 and the codec comment to agree.
- **First review of 2026-09-17 (NOT READY) addressed.**
  - C1: Task 2 proves reinstall through the rolled-back-`init` sequence, pins the downcast-uninstall reinstall as an exit-6 refusal, and rewrites the `.lifecycle.lock` ephemeral case; Task 22 restores the reinstall. The reviewer placed that restoration in Task 24, but it belongs in Task 22: that is the task that replaces the downcast uninstall, and the e2e would turn red there otherwise.
  - C2: `suite` is 150, not 330. `*.v2.test.ts` files run in the `lifecycle-v2` job, the stop conditions are in CI minutes, and each task measures only its own file.
  - I1: Task 16's `standaloneFoundationId`. I2: Task 16's `stepHooks`, used by Task 22, with a death-after-`R` test. I3: Task 21 lists and rewrites every named test. I4: Task 16's overflow cases. I5: focused runs are narrowed with `-t`.
  - Every listed minor finding is applied.
- **The D19 pin and NEW-80.** The pin cannot pass before the layout moves, so Task 1 does both (D29).
- **Placeholder scan.** No "TBD", "similar to Task N", or unspecified error handling remains. Test-local helpers are named with one-line definitions in the task that uses them. Where a test asserts a Spec-printed value (the Git scope fingerprint), a mismatch is a stop condition, not a test edit.
- **Type consistency.** Checked across tasks:
  - `LifecycleBookkeepingResidueV1` (2) is the residue in 11, 12, 13 and 18.
  - `HeldLifecycleStableLockV1` (9) is used by 10, 14, 15, 16, 19 and 22.
  - `LifecycleGuardedFileSystemV1` and `LifecycleGuardedEntryV1` (10) are used from 11 onward.
  - `LifecycleLedgerRootsV1` is defined in 11 and used by 12, 14, 15, 16 and 18.
  - `LifecycleExecutionPlanV1` (18) is the `TPlan` of 19, 22 and 23.
  - `AdmittedV2HomeV1` (17) is used by 18–23.
  - `LifecycleVariantFactsV1.uninstallLaunchdEvidence` (8) is supplied by Task 18's `lifecycleVariantFacts` and Task 22's planner.
  - `lifecycleReservationOrder` (8) is `lc`, forward Foundation refs each followed by its compensation, `ge`, `ge`, `le`, `le`, then `mf`. The Task 8 and Task 22 expectations agree: the without-launchd uninstall is `lc`, four `tx`, `mf`.
  - The compensation order in 16 and 22 starts with `M(preserve_before)^-1` and omits `P^-1` for the without-launchd variant.
- **Line citations.** Outside fenced blocks this plan cites no `path:line`; the verified anchors sit in one fenced block, so the citations gate cannot redden as files change.
- **Cost.** Real fresh V2 `init` calls sit in shared-home or chained `*.v2.test.ts` files that run in their own CI job. Every task applies the CI budget rule and stops before committing past it.
