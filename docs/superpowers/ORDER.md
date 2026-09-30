# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**The D70 lane closed on 2026-09-29 under D75, and its full suite is owed.** NEW-113's code (Tasks
1–3), NEW-110 (Tasks 0–13, with P9) and 35 other backlog rows are integrated and reviewed; both plans are
closed and deleted, their surviving contracts in `docs/architecture/foundation.md` §10–§11,
`foundation-constraints.md`, `threat-model.md` §5.15–§5.16, `codex-adapter.md` §14, `brain.md` §6.14
and `claude-adapter.md` §17. Tests were written, not run. **Next, founder:** run `npm run check` and
`npm run test:pinned-host` on the integrated tree (development Mac, both vendor CLIs installed, because
`check` includes `test:vendor-ingest`); a red run reopens the rows its failures belong to (D75). Then
push the branch and open the PR (`development` needs one, GH013); the founder merges.

Named suspects for a red run, so the first failure has an owner:

- NEW-71 (`52c667c7`): `admitPostPlanInitialWrite` now refuses a present `.lifecycle.lock` that the
  plan's `admittedPreexistingPaths` does not name by `dev`/`ino`. If a fresh `init` creates the lock
  after planning, every fresh `init` refuses — look here first for a red `executor.test.ts`.
- NEW-113: a red `local-receive.pinned-host.test.ts` caused by the shim's receive-pack dispatch is a
  stop condition to report, not to patch around.
- NEW-110 Task 12's recovery sweeps run a full `init` per death point; budget their wall clock before
  reading a timeout as a regression (`docs/architecture/foundation.md` §9).
- NEW-93 changed a persisted schema (the key's retention entry carries a null `sha256`) and NEW-86 the
  fresh `init` plan grammar; fixtures pinned to the old bytes will need regenerating, not the code.

**A15, the founder cutover, steps 1–15 done on the live machine (2026-09-28/29).** Steps 8–10 ran on
2026-09-28 under D69 and D74: the first step-9 `init` was killed mid-bootstrap by a host-session
restart and left a home `uninstall` refused (NEW-114, now closed); the home was moved aside intact, the
retried `init` exited 0, `doctor` 0 `[fail]`, `noteCount` equal to step 6. Step 10 observed all eight
Claude hook verbs firing (A13 Task 18 Step 1 for Claude, D68). Steps 11–15 ran on 2026-09-28/29: eight
third-party-derived skills are user overrides on both vendors; no live reference to the legacy shared
directory remains (2026-09-29: two dead `~/.codex` symlinks step 13's grep could not see and three
inert `~/.codex/config.toml` entries were removed, the grep gap closed in step 13's Verify); three
reinstalls preserved the Brain, the overrides and the Brain config; 106 inbox files were imported and
accepted, and the first real Claude ingest ingested 71 after four product fixes, then 75 after NEW-116's fix; the founder rejected the last 31 (`3ebc505d`,
`588c866d`, `cb19f7c6`, `26807aed`; NEW-116 owns the other 35). Six notes written under
`content/content/` were moved by hand; the validator landed in `72f0f5bf`. **Next:** step 13b (added
2026-09-29: disable the vault's scheduled legacy CI workflow; its vault-scoped legacy skills and
tooling are removed with step 19), steps 16–18 after one week
of use, Codex hook approval after 2026-10-22, step 19 after one stable cycle. Git and launchd stay
disabled on the live machine until the founder enables them (D76: NEW-113's Task 5 is skipped).

**Evidence the closed phases stand on (2026-09-26, run 4).** On `bc17550`, every part green: lint,
`test:lifecycle` (21/21 files), `test:e2e`, `test:suite` (306/306 files, 9913 tests, 8 todo =
documented residuals), `test:bootstrap` (94) and build; seven whole-phase fresh-context reviews. PR #15
merged. The D70 lane's code has no run yet (above).

**Lanes.** D44, D47, D56 and D70 each expired with the closes they governed (D70 with D75's plan
closes). The next code-producing work runs `SESSION.md` §5 as written, except that `development`
requires a PR (see "Delivery evidence still owed").

## Founder stop points

Each is executable from the document named; none is agent work.

1. D75's full suite: `npm run check` and `npm run test:pinned-host` on the integrated tree, then the
   push of `development` (D76: one branch, no PR branch; GH013 needs the founder's bypass).
2. A15 steps 16–18 (per-adapter gate cycle, exercised rollback) after one week of use, step 19 after
   one stable cycle (`docs/migration/founder-cutover.md`), and the Codex hook approval after
   2026-10-22.
3. A13's real-agent rows (the plan closed 2026-09-29; evidence in `docs/architecture/hooks.md` §4):
   NEW-127, Claude's unobserved rows and the isolated-`ingest` check, and NEW-104, the Codex
   real-agent matrix, after 2026-10-22.
4. NEW-75's Codex half: its credential path supplied separately and one real authenticated
   `ingest --agent codex` (credits, after 2026-10-22).
5. Observations: NEW-45 (one paid Codex run), NEW-42 (capture inside both vendors' TUIs), NEW-7
   (percent-encoded links in Obsidian).

Open sequence (D16, daily use before completeness):

1. Now: D75's full suite and the PR; A15 continues on its own clock.
2. Beside it: the founder stop points above.
3. Then Task 11b (parked, D46), then A16.

The parent document is `plans/2026-07-21-developer-os-program.md`, which is live rather than
superseded: its open items are DOS-P7's remainder (two pointers into the A11b plans), the DOS-P8
cutover (A15) and DOS-P9's release (A16 with L1, eight steps). It closes with A16 and with nothing
earlier.

Everything after `NOW` is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (the
founder decisions D1–D75 and what each phase still owes). `docs/migration/instruction-inventory.md`
is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A15 | DOS-P8 Founder migration (shadow mode dropped, D58) — `docs/migration/founder-cutover.md` | A14 (closed) | rollback to the legacy runtime is exercised and one stable cycle completes | steps 1–15 done 2026-09-28/29; steps 16–18 after a week of use, step 19 after one stable cycle |
| A11b | DOS-P7 remainder (D16): Spec 2 closure Tasks 9–10, Task 26, Task 11b; NEW-113 (D65) | A15 (D56, D70 ran the rest early) | `update`, `update rollback`, `git` and `automation` proven on a disposable install, then on the founder machine | closure Tasks 9–10 and Task 26 closed with NEW-110 (synthetic arm64 and x64 proof) and NEW-113 closed without its disposable-account gate (D76), both under D75 with the full suite owed; Task 11b parked (D46: `update` reaches a real release only after it) |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

A11 (Phase 4b), A13 (Phase 6) and A14 (Phase 7) have nothing left of their own: A11's Task 11b is
tracked under A11b, A13's real-agent rows (NEW-104, NEW-127) are founder stop points, and A14's
template scan ran with A12's (0 findings, 2026-09-28).

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate (one worktree each):

- NEW-115 (`init` does not exit after success) and NEW-116 (ingest yield and head-of-line blocking).
- Residuals of the D70 lane: NEW-117, NEW-119, NEW-122, NEW-123, NEW-124, NEW-126.
- NEW-53 (the `init` encoder cost) and NEW-29 (the elapsed-time assertion class).
- NEW-134 (scheduled Brain gardener and pulse, D77): spec approved 2026-09-30, implementation plan next.

Needs a human, a policy decision, or an external application:

- NEW-130 — accept or fix NEW-129's redaction residuals.
- Task 11b (NEW-111, NEW-112, NEW-118) — parked by D46 on the founder's root-key decision.
- NEW-120 — redact a partially covered high-entropy tail, or accept it.
- NEW-121 — design manifest-owned persisted executable identity for `capture`'s probe, or accept the
  same-uid residual.
- NEW-40 — refuse-versus-report for a hand edit during the ingest agent call.
- NEW-33 — whether root-owned, group-writable executable directories are acceptable.
- NEW-35 — enforceable exec-by-identity, or the check-then-spawn race retained as a platform limit.
- Foundation watchdog — whether `SpawnLockfRunner` needs one around non-blocking `lockf`.
- The founder stop points above (NEW-75, NEW-45, NEW-42, NEW-7, NEW-104, NEW-127).

Conditional: NEW-27 when a real write scope is wired, NEW-28 when a production argument reaches the
retained screening refusal, NEW-100's round trip after A16 (D42).

## Delivery evidence still owed

- L2 still owes release permissions. The `baseline` ruleset on `development` carries a `pull_request`
  rule (0 required approvals, PRs mandatory), so a direct `git push origin development` is rejected
  with `GH013`; plan closes open a PR (D70 (4)) and the founder merges. `gh` works when network calls
  run unsandboxed.
- Measured gate and CI costs, and why the CI budgets are what they are, live in
  `docs/architecture/foundation.md` §9. That a green local `check` is not evidence about CI lives in
  `BACKLOG.md` §5. Retain the complete log of any full-suite failure; NEW-29 owns the remaining
  elapsed-time assertion class.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text (MIT proposed, D69 (9)) | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 3 open entries — A15 (steps 16–19), A11b (the parked Task 11b), A16. A13 left it
  on 2026-09-29; its founder rows are stop point 3.
- Owed now: D75's full `check` and `test:pinned-host`, then the push of `development` (D76).
- Implementation still to build: Task 11b (parked, D46) and A16's plan and work; the startable rows
  above.
- Founder stop points: listed above. Long-lead gates L1 and L2 block A16.
- Repository backlog: 26 open numbered rows (`BACKLOG.md` §1), plus the Foundation watchdog decision
  and the §6 phase-close deferrals. Closed on 2026-09-29 under D75: 36 rows including NEW-110 (the list is in
  `BACKLOG.md` §1), and NEW-54, NEW-82, NEW-87 and NEW-99 removed as already fixed or moot.
