# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**Phase close for A11–A14.** Every phase from 4b through 7 has its implementation committed and is
waiting on evidence, not code. Under D44/D47 no test ran during implementation — each commit ran only
`npm run lint` — so every "run the tests" step and every review is owed at the close of its phase.
The next product work after these closes is the founder cutover A15.

Phase 4b (A11, `plans/2026-08-29-developer-os-release-update.md`): code done — Task 10 (`1e214ce`),
Task 11 (`3f640b3`), NEW-85 (`d2cc737`), launcher trust-fd fix (`c7bc459`), side track NEW-49
(`6254586`). Task 11b is parked by D46 (no signing keys); A12's unsigned local build
(`init --local-release`, D47) is the install source until then.

Phase 5 (A12, `plans/2026-09-22-developer-os-instruction-artifacts.md`): Tasks 1–28 committed; D48–D55
recorded; production-facing follow-ups committed with it — D52 isolated Codex ingest home (`5afa493`),
D53 launchable local release (`a629f77`), D54 manifest anchor (`3e5daf8`, `a5c459f`), D55 esbuild
bundle (`811d74b`), V2 manifest reads in write commands and `status` (`b3bb8cc`, `4360abd`).

Phase 5b (A12b, `plans/2026-09-22-developer-os-brain-workflows.md`): Tasks 1–15 committed.

Phase 6 (A13, `plans/2026-09-22-developer-os-hooks.md`): Claude half committed — Tasks 3–14, 16, 17,
with Claude hooks installed by `init` (`a156b0c`). Task 15 (Codex hooks) is blocked (NEW-104).

Phase 7 (A14, `plans/2026-09-22-developer-os-tooling-verbs.md`): Tasks 1–13 and 15 committed.

Owed at every one of these phase closes, by the founder unless marked:

- `npm run check` plus the plan's deferred slow suites (the `bootstrap-executor`, `lifecycle-v2` and
  e2e files each plan lists), on the integrated tree.
- One whole-phase fresh-context review by an agent that authored none of the phase (orchestrator
  dispatches); accepted findings get a failing test first.
- One branch pushed and one PR opened (D44 lane). A direct push to `development` is refused by the
  ruleset (`GH013`).

Founder stops per phase, on top of that:

- A12: NEW-101 billed real-agent row, then emptying `UNPROVEN_CLAUDE_CATEGORIES` (plan Task 29
  Step 3b); NEW-103 Claude D8 isolation observation and NEW-102's Codex re-observation (the three
  real-vendor integration files of Task 21); the founder-local private-pattern scan
  (`scan-instruction-defaults.js --patterns`) over `instructions/` and `templates/project/`; content
  review is not recorded for the agents, command-pair and general-skill batches (orchestrator, with
  the phase review).
- A12b: Task 16 real-vendor run (`npm run test:vendor-brain`, all five workflows `pass` on Claude);
  the red-first runs of the new security cases against `13eb18e` (orchestrator).
- A13: Task 15 Codex hooks, blocked on billed and trust observations (NEW-104); Task 18 real-agent
  matrix on both vendors; Task 2 legacy parity check, never run.
- A14: Task 14 vendor observations (NEW-109); `project init` templates' founder-local scan (Task 15
  Step 4).

Spec 2: Tasks 1–7, 9, 10 and 11 complete, Task 8 withdrawn (D18), Task 11b parked (D46), Tasks 12–26
remain. The 2026-08-28 Spec 1 plan stays as plan 1b's source; its Tasks 1–7, 21 and 23 were executed
via plan 1a.

Open sequence (D16, daily use before completeness):

1. Now: close Phases 4b, 5, 5b, 6 and 7 — evidence only, as listed above.
2. Then: the founder cutover A15 on the live machine
   (`npm run pack:local-release -- <dir>`, then `init --local-release <dir> --adapters claude,codex`).
3. After the cutover: A11b (Spec 2 Tasks 12–26, then Spec 1b), then A16.

Lane (D44, extended to Phases 5–7 by D47): a task commit runs `npm run lint` only and is held
locally; tests, `npm run check` and fresh-context review run once per phase at its close, and the
phase lands as one PR. D17/D33's push-per-commit rule does not hold while the ruleset requires PRs.

The parent document is `plans/2026-07-21-developer-os-program.md`, which is live rather than
superseded: its 23 open items are DOS-P7's remainder (A11b and plan 1b), the DOS-P8 cutover (A15)
and DOS-P9's release gates (A16, L1). It closes with A16 and with nothing earlier.

Phase 4b onward is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (9 open phases,
4b through 11 with a 5b, the founder decisions D1–D55, and the spec or plan each phase requires). `docs/migration/instruction-inventory.md` is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A11 | DOS-P7, pre-cutover part (D16): Spec 2 Tasks 10–11 (Task 9 closed 2026-09-17; Spec 1a closed 2026-09-22) | nothing | a fresh production `init` runs V2 through the launcher; `config get\|set`, coordinator recovery and drained uninstall ship | phase close owed; Task 11b parked (D46) |
| A12 | DOS-P10 Managed instruction artifacts — spec, plan, implementation | A11 | every artifact in `docs/migration/instruction-inventory.md` §1–§3, §6 installs, drift-checks, and uninstalls on both vendors | committed; phase close owed |
| A12b | Brain workflows — spec, plan, implementation | A12 | every workflow and verb in the inventory §7 is proven on the synthetic vault | committed; phase close owed |
| A13 | DOS-P11 Hooks — spec, plan, implementation | A12b | every hook in the inventory §4 plus session-start injection is observed firing and names the installed binary | Claude half committed; Codex blocked (NEW-104); phase close owed |
| A14 | DOS-P12 Repository tooling verbs — spec, plan, implementation | A13 | inventory §5 and §6: every row is a shipped verb or a recorded refusal (D47) | committed; phase close owed |
| A15 | DOS-P8 Founder shadow migration — dedicated plan and execution | A14 | rollback to the legacy runtime is exercised and one stable cycle completes | next |
| A11b | DOS-P7 remainder (D16): Spec 2 Tasks 12–26 (update, rollback), then Spec 1b (git, launchd) | A15 | `update`, `update rollback`, `git` and `automation` proven on a disposable install, then on the founder machine | blocked |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

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

`BACKLOG.md` §1 holds 64 open numbered rows (NEW-101..103 added 2026-09-22, NEW-104..109
2026-09-23). Rows implemented this session stay open until their tests pass at phase close: NEW-49,
NEW-85 (Phase 4b); NEW-60, NEW-61, NEW-65, NEW-95, NEW-102 (A12); NEW-98 (A14).
Owners: NEW-85 and NEW-86 are owned by Phase 4b; NEW-82 by plan 1a; NEW-84 by Phase 9;
NEW-87 travels with whichever row each mis-aimed citation belongs to; NEW-88 and NEW-89 by plan 1a Tasks 16 and 22; NEW-91 by plan 1a Task 16; NEW-90 and NEW-92 by Phase 4b; NEW-97 by Phase 4b and NEW-98 by A14 Task 6 (repository tooling, D47), both opened by plan 1a Task 22; NEW-99 is owned by plan 1a Task 23b (D38); NEW-100 by a later sharding of `test:lifecycle` (D39); NEW-101, NEW-103 and NEW-109 by the founder; NEW-104 by A13 Task 15; NEW-105 to NEW-107 by A12's follow-ups; NEW-108 by each phase close.
They are not ordered ahead of A11 unless the touched subsystem makes one relevant; D33 lets a
startable row run beside a wave when its files overlap no task in flight.

## Delivery evidence still owed

- L2 still owes release permissions. **Remote rules changed since last verified (found 2026-09-22,
  plan 1a closure):** the `baseline` ruleset on `development` now also carries a `pull_request` rule
  (`gh api repos/msolecki/developer-os/rules/branches/development`), 0 required approvals but PRs
  mandatory — a direct `git push origin development` is rejected with `GH013`. D12's "pushed directly
  to development, nothing gates the push" no longer holds; `SESSION.md` §5 step 7's push rule needs a
  founder decision on whether it opens a PR (as plan 1a's closure did, `#14`) or the founder pushes
  with bypass permissions. `gh` access itself is verified working (`gh api`/`gh pr create` succeeded
  once network-sandboxed calls were run unsandboxed; `gh run list`/`gh pr list` failed on a sandboxed
  TLS proxy error that was the sandbox, not GitHub).
- Measured gate and CI costs, and why the CI budgets are what they are, live in
  `docs/architecture/foundation.md` §9. That a green local `check` is not evidence about CI lives in
  `BACKLOG.md` §5. Retain the complete log of any full-suite failure; NEW-29 owns the remaining
  elapsed-time assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 8 open entries, A11, A12, A12b, A13, A14, A15, A11b, A16. A11–A14 have their
  implementation committed and owe phase-close evidence only (A13 also owes its Codex half).
- Implementation tasks still to build: A13 Task 15 (blocked on observations), A14 Task 14 (blocked on
  observations), Spec 2 Task 11b (parked, D46), Spec 2 Tasks 12–26 (15), plan 1b 15 (the 2026-08-28
  plan's remaining tasks, not yet rewritten). Before the cutover: the two blocked tasks. After it:
  Spec 2 Tasks 12–26 and plan 1b, 30 tasks. Plan 1a closed (Task 24 deferred to post-A16, NEW-100).
- Phase-close tasks owed: A12 Task 29, A12b Task 16, A13 Tasks 18–19 (and Task 2), A14 Task 16, and
  Phase 4b's close.
- A15 and A16 each still need their dedicated plan.
- Repository backlog: 64 open numbered rows, plus the Foundation watchdog decision.
