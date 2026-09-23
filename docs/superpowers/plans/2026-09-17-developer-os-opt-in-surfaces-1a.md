# Developer OS Opt-in Surfaces 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Completed tasks were removed on 2026-09-23; see git history.

> **Plan 1a CLOSED 2026-09-22, `43c6876..082e098`.** The only open work is **Task 24**, carved out
> of plan 1a to post-A16 hardening (D42) and tracked as `BACKLOG.md` NEW-100. This file is the only
> copy of Task 24's full spec; delete it once Task 24 has run or its spec has moved to a successor
> document.

**Spec:** `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` as amended 2026-09-17 (A9, A15; §7).

---

## Founder decisions Task 24 depends on

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

## Global Constraints (still binding for Task 24)

- **Production reachability.** `bootstrap: { state: "unavailable_until_packaged_handoff" }` in `createProductionContext` (`apps/cli/src/context.ts`) stays; removing it is Phase 4b. V2 behaviour is proven only through `createCommandFixture(name, { bootstrapAvailable: true })`, a real fresh V2 `init`, and injected ports.
- **Push rule (D17; the orchestrator alone pushes, D33).** Before each commit run `gh run list --branch development --limit 1 --json status,conclusion,headSha`: a completed run with conclusion `failure` stops new commits until fixed. After the commit, push to `development` only when no run is `queued` or `in_progress`; otherwise push it with the next commit. Never merge.
- **Staging.** Stage exact paths only; never `git add -A`, `git add .`, or a wildcard. Confirm with `git diff --cached --name-only` before committing.
- **`docs/superpowers/` is globally gitignored.** New files there need `git add -f`, and `git add` of those paths exits 1 even for tracked files. Put that `git add -f` on its own line; never chain it with `&&` into `git commit`.
- **Citations gate.** `tests/repository/citations.test.ts` checks every `path:line` citation in tracked documents. Cite a line outside a fenced block only when it exists and stays in range; otherwise name the symbol.
- **Comments.** Add no code comment unless it records a non-obvious platform fact, a dated past bug, or a rejected alternative someone would otherwise restore. Do not strip existing comments.
- **No external effects.** No 1a code path spawns Git or `launchctl`, opens a network connection, or invokes a vendor. Git, launchd and push leaves, and the `uninstall/present_manifest` (`P`) variant, refuse with `unsupported_until_plan_1b`.
- **Fixtures.** Synthetic only: temporary homes, the packaged-capability fixture, injected runners and clocks. Every enumerating test asserts its expected set is non-empty before asserting over it.
- **Cost.** A real fresh V2 `init` took 132 s on the development machine on 2026-09-17. Tests share one initialised home per file or chain sequences wherever the contract allows. Focused runs use `-t` filters so a task's own gate stays well under an hour.
- **CI budgets (`.github/workflows/check.yml`).** `lint` 20, `bootstrap-executor` 330, `suite` 150, `e2e` 40, `vendor-ingest` 15 minutes. A hosted `macos-15` runner measured ~1.9–2× local. Baselines from the last green run, 35213248735: `suite` 85.5, `bootstrap-executor` 243.8, `e2e` 5.9 CI minutes. `apps/cli` runs its test files serially (`fileParallelism: false`). Two rules:
  - Task 1 adds the `lifecycle-v2` job (`npm run test:lifecycle`, also run by `npm test` and therefore `npm run check`). From Task 1 on, every test case this plan adds that performs a real fresh V2 `init` goes in a file named `*.v2.test.ts`, which `test:suite` excludes and `lifecycle-v2` runs. No task adds a real V2 `init` to a file another job runs, so `suite`, `bootstrap-executor` and `e2e` stay at their baselines except for rewritten existing cases.
  - A task that adds or grows a `*.v2.test.ts` file measures only that file (its Vitest summary), adds it to `lifecycle-v2`'s running local total kept in the job comment, and sets `timeout-minutes` to ceil(total × 2 × 1.5). **Stop and ask before committing** if that exceeds 300, or if any other job's projection (baseline + local delta × 2) exceeds 85% of its budget (`suite` 127, `bootstrap-executor` 280, `e2e` 34 CI minutes).

Task 23's kill-chain pattern that Task 24 reuses: `killUninstallAt` runs `new LifecycleUninstaller({ afterBoundary })` whose hook throws `SyntheticDeath` at the named boundary; its shared-home chain and `CHAIN_TIMEOUT_MS` derivation live in `apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts`.

---

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
