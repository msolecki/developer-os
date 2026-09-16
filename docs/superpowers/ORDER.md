# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**A11 — DOS-P7 Git, automation, update, and release lifecycle.**

Roadmap Phase 2 closed 2026-09-07/08 as `632f220..446148b`, ten tasks. Its plan is deleted; the
surviving constraints are in `docs/architecture/foundation.md` §4 (the shared admission module) and
§9 (measured cost, and the corrected reason for it). NEW-51, NEW-59 and NEW-52 are closed, NEW-53 is
rewritten to the encoder cost it actually leaves, and NEW-29 is narrowed rather than closed —
decision D13 closed it on the eight retained-evidence timeouts, which never reproduced, but the row
is the class of elapsed-time assertions and another member of it failed on CI the same week.

**The accumulated commits are pushed and CI is green on all five jobs for the first time in this
program**: run 34157609332 on `446148b`. It took five runs, and four of the five failures were
things a green local gate cannot see. `bootstrap-executor` had no `Build` step; `suite` carried a
40- then 75-minute bound derived from the most favourable local measurement, against a hosted runner
measured at ~1.9-2x this laptop; and two test budgets were arithmetically wrong. The fifth was a
**shipped product defect**: `RENAME_FLAGS` was `0x34`, an undefined `0x20` bit on top of
`RENAME_EXCL | RENAME_NOFOLLOW_ANY`, which Darwin 25.6.0 ignores and Darwin 24.6.0 rejects — so
every retained rename failed on macOS 15, on the real CLI path. Nothing local could have found it.
The corrected constant and the measurement that settled it are at
`packages/platform-macos/src/retained-rename.ts:50`.

**Roadmap Phase 3's stop condition is cleared.** Phase 3 did not open with code: it required
amending Spec 2 for NEW-68, and an approved spec is not rewritten silently. The founder approved all
eight corrections on 2026-09-08, each is marked "Amended 2026-09-08" in place, the proposal document
is deleted, and NEW-68 is closed. Five recorded what Spec 1 or the shipped code had already settled.
Three changed an approved interface, an approved number, or the accepted-residual list, and all three
took the recommended resolution:

- **A1** — `ManifestMigrationPlanV1` now carries `admittedExternalShapeHash` and
  `admittedPreexistingPaths`, over the disjoint domain `developer-os/v1-migration-external-shape/v1`,
  never accepted for the fresh arm. Migration was the one arm with no digest able to exclude an
  unadmitted external inode, and it is the arm where product home and `state` always pre-exist
  populated.
- **A6** — the two "exact maximum succeeds" gates are read against **both** the cardinality bound and
  the byte bound. The claim that they were arithmetically impossible was carried for weeks without
  the arithmetic; it is now derived and it holds. `RollbackPayloadEntryV1` has a 153-byte canonical
  floor, so the declared 1,000,000 entries encode to ~146.9 MiB against a 64-MiB cap and ~435,771 are
  reachable. No declared number changed.
- **A8** — the unreachable `symlink` arm is retained as §13.3 accepted residual 9, with an exact-set
  test asserting no Spec 2 path produces one. It was named only in the roadmap's Phase 8 line, never
  in NEW-68's own row.

The amendment's shipped-code impact is written into the baseline plan where it will be executed: A1
and A2 into Task 8, A3 into Task 9 with its own failing test, A6 into Tasks 20 and 26, A8 into Task
26.

**Task 8 is committed** (`55a06de`; `e436581` then narrowed NEW-53). **The next action is code:
baseline Task 9** in `plans/2026-08-29-developer-os-release-update.md`.

Spec 1 is approved and its plan exists at `plans/2026-08-28-developer-os-opt-in-surfaces.md`, with
none of its 24 implementation tasks started. Spec 2's Tasks 1–8 are complete and Tasks 9–26 remain.

Open sequence, reordered 2026-09-16 by decision D16 (daily use before completeness):

1. Now: Spec 2 Task 9 — execute and recover the V1→V2 migration (roadmap Phase 3). Its gate is
   corrected: Tasks 8–9 cannot unpin `apps/cli/src/context.ts:765`, because a production V2 `init`
   needs the launcher's root-verified handoff. That gate moved to Phase 4b.
2. Amend Spec 1 (NEW-67), write plan 1a, execute it (Phase 4).
3. Spec 2 Tasks 10–11 plus the production wiring step — launcher and offline trust (Phase 4b).
4. A12 → A12b → A13 → A14, then the founder cutover A15.
5. After the cutover: A11b (Spec 2 Tasks 12–26, then Spec 1b), then A16.

Per decision D17 an ordinary task commit runs its focused commands, `npm run lint` and fresh review,
and is pushed so CI runs the full suite; `npm run check` runs locally at phase or plan close
(`SESSION.md` §5).

Phase 3 onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (11 open phases,
3 through 11 with a 4b and a 5b, the founder decisions of 2026-09-04, 2026-09-07 and 2026-09-16, and
the spec or plan each phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7, pre-cutover part (D16): Spec 2 Task 9, Spec 1a, Spec 2 Tasks 10–11 | nothing | a fresh production `init` runs V2 through the launcher; `config get\|set`, coordinator recovery and drained uninstall ship | now |
| A12 | DOS-P10 Managed instruction artifacts — spec, plan, implementation | A11 | every artifact in `docs/migration/instruction-inventory.md` §1–§3, §6 installs, drift-checks, and uninstalls on both vendors | blocked |
| A12b | Brain workflows — spec, plan, implementation | A12 | every workflow and verb in the inventory §7 is proven on the synthetic vault | blocked |
| A13 | DOS-P11 Hooks — spec, plan, implementation | A12b | every hook in the inventory §4 plus session-start injection is observed firing and names the installed binary | blocked |
| A14 | DOS-P12 Repository tooling verbs — spec, plan, implementation | A13 | all 14 scripts in the inventory §5 are product verbs or documented refusals | blocked |
| A15 | DOS-P8 Founder shadow migration — dedicated plan and execution | A14 | rollback to the legacy runtime is exercised and one stable cycle completes | blocked |
| A11b | DOS-P7 remainder (D16): Spec 2 Tasks 12–26 (update, rollback), then Spec 1b (git, launchd) | A15 | `update`, `update rollback`, `git` and `automation` proven on a disposable install, then on the founder machine | blocked |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

- NEW-49 — expose decided captures through the agent-facing review workflow.
- NEW-46 — close the same-uid `PATH` spawn surface or design persisted executable identity.

Needs a human, a policy decision, or an external application:

- NEW-75 — supply each vendor's credential path separately, then prove it with one real
  authenticated `ingest` per vendor. Narrowed 2026-09-07 by D15: admitting `HOME` is refused,
  because the resolution that strews the files is the one that finds the credentials.
- NEW-45 — observe whether a real Codex turn ever emits more than one `agent_message`, with one paid
  run. Narrowed 2026-09-05: NEW-47 is closed from source and corroborates the last-wins tie-break.
- NEW-42 — observe capture inside both vendors' interactive sessions.
- NEW-33 — decide whether root-owned, group-writable executable directories are acceptable.
- NEW-7 — verify percent-encoded local links in Obsidian.
- Foundation watchdog — decide whether `SpawnLockfRunner` needs one around non-blocking `lockf`.

The remaining open repository rows are NEW-20, NEW-24–NEW-29, NEW-31, NEW-32, NEW-34–NEW-40, and
NEW-76.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant.

## Delivery evidence still owed

- L2 still owes release permissions. Everything else it covered is now evidenced: `gh auth status`,
  `gh pr list` and `gh run list` succeed, and the `baseline` ruleset on `development` carries only
  `deletion` and `non_fast_forward`, so neither a status check nor a pull request gates a direct
  push. That was verified by pushing, not inferred.
- **The first push landed 2026-09-07: `d72287a..446148b`, closing a backlog of 125 unpushed commits
  and a CI gap since 2026-08-28.** Per decision D12 it went directly to `development` rather than
  through a probe branch.
- **CI is green on all five jobs, twice consecutively** — run 34157609332 on `446148b` and run
  34172016048 on `88d56a2`. The first run's figures: `lint` 0.8 min, `vendor-ingest` 0.5 min, `e2e`
  6.8 min, `suite` 66.8 min (135 files, 4,587 passed), `bootstrap-executor` — the job that had never
  once executed before this week, since `check.yml` had a single `check` job at `d72287a`.
- **The local `check` is green and takes about three hours**, measured 2026-09-07 at 11:05:48→14:01:54:
  `EXIT=0`, 4,723 tests. `test:bootstrap` 122.6 min, `test:suite` 46.3 min under load, `test:e2e`
  274.89 s, `test:vendor-ingest` 30.27 s.
- **A green local `check` is not evidence about CI, and this is now recorded rather than learned
  again.** The local chain begins with `lint`, which is `tsc -b`, so every `dist` exists before any
  test runs; CI splits into five jobs with no shared filesystem. And the development laptop runs a
  newer Darwin than the runner, which is how an undefined `renameatx_np` flag bit shipped. Both
  instances are in `BACKLOG.md` §5.
- CI job budgets are 20/330/150/40/15 minutes and are sized from a **measured** ~1.9-2x hosted-runner
  ratio, not a guess; two of them were killed by bounds derived from the most favourable local
  number before that ratio was measured. They are bounds that let the gate report, not targets —
  NEW-53's residual owns making them unnecessary.
- When a full-suite failure occurs, retain the complete log. NEW-29 owns the remaining elapsed-time
  assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 8 open entries, A11, A12, A12b, A13, A14, A15, A11b, A16.
- Program plan: baseline Task 9 contains 5 unchecked steps.
- Repository backlog: 39 open numbered rows, plus the Foundation watchdog decision.
- Implementation plans: Spec 2 baseline Tasks 9–26 (18 tasks) and Spec 1 (24 tasks, split into
  1a and 1b): 42 tasks. Before the cutover: Task 9, plan 1a (9 tasks), Tasks 10–11 — 12 tasks.
  After it: Tasks 12–26 and plan 1b (15 tasks) — 30 tasks. Phases 5, 5b, 6 and 7 have no spec yet.
