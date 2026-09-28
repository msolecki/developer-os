# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**D70 (2026-09-28) build-only lane in flight:** headless sessions in `../developer-os.worktrees/` on
NEW-82, 88, 89, 90, 91, 92, 93, 96, 97, 99 (code, tests written not run, lint only) and drafts of the
NEW-113 and NEW-110 spec amendments (founder approval before code). Commits held locally for one PR.

**Next session (D69):** confirm step 7b's `npm run check` on `dbca633` is green (tree of `8fe4b03`;
log in the founder's work directory), then run A15 steps 8–10 in one sitting under one approval, then
steps 11–15. Steps 16–18 follow after a week of use; Codex steps after 2026-10-22.

**A15, the founder cutover, on the live machine** — step by step through
`docs/migration/founder-cutover.md` (`npm run pack:local-release -- <dir>`, then
`init --local-release <dir> --adapters claude,codex`), each step with founder approval (D56, D58).
Git and launchd stay disabled during it; the bootstrap pin at `apps/cli/src/context.ts:823-824` still
answers every run without a local release, because Task 11b is parked (D46).

**NEW-100's CI sharding is done (2026-09-26).** On PR #15 the hosted runner cancelled
`bootstrap-executor` at its 330-minute and `lifecycle-v2` at its 185-minute timeout (local: 122 and
153 minutes). `.github/workflows/check.yml` now runs `bootstrap-executor` as two `-t` shards (225 and
280 minutes) and `lifecycle-v2` as three file shards (206, 201 and 224 minutes), all under the
300-minute cap; the budgets are conservative estimates to confirm from the first green sharded run.
NEW-100's round-trip file itself stays post-A16 (D42).

**Evidence the closed phases stand on (2026-09-26, run 4).** On `bc17550`, every part green: lint,
`test:lifecycle` (21/21 files), `test:e2e`, `test:suite` (306/306 files, 9913 tests, 8 todo =
documented residuals), `test:bootstrap` (94) and build. Seven whole-phase fresh-context reviews ran
(4b, 5, 5b, 6, 7, 8, plan 1b); every Critical and Important finding was fixed with a red-first test
and re-reviewed, or recorded as a founder decision (D62–D64) or a `BACKLOG.md` row (NEW-110..112).
PR #15 merged; `development` is at `25c9a2e`. Not run: `test:vendor-ingest`, `test:vendor-brain`
(`test:vendor-brain` is billed, Claude only, D66; `test:vendor-ingest` is unbilled) and `test:pinned-host` (superseded by NEW-113, D65).

**Lanes.** D44 (Phase 4b), D47 (Phases 5–7) and D56 (Phase 8, plan 1b) each expired with the phase
closes they governed. The next code-producing work runs `SESSION.md` §5 as written, except that
`development` requires a PR (see "Delivery evidence still owed").

**Founder stop points left by the closed phases** (each executable from the plan named):

- `npm run build && npm run test:vendor-ingest` (unbilled: loopback and dead-endpoint capture, both vendor CLIs installed, disposable home;
  `tests/integration/ingest/no-user-hooks.test.ts` and `instruction-isolation.test.ts`, the second
  shared with A12's Task 21 Step 4). `npm run check` includes it, so a `check` without vendor
  credentials is not green evidence for these two files.
- A13 (`plans/2026-09-22-developer-os-hooks.md`): Task 2 legacy parity check; Task 18 real-agent matrix
  on both vendors (NEW-104).
- Phase 9: plan 1b is closed; its Task 19 is superseded by D65. The Phase 9 gate is re-proven on a
  disposable macOS account once NEW-113 replaces the exact-build pin.

Open sequence (D16, daily use before completeness):

1. Now: the A15 cutover.
2. Beside it: the founder stop points above.
3. Then the parked Spec 2 work — closure Tasks 9–10 on NEW-110's design (one Spec 2 revision pass),
   Task 26, Task 11b — then A16.

The parent document is `plans/2026-07-21-developer-os-program.md`, which is live rather than
superseded: its open items are DOS-P7's remainder (two pointers into the A11b plans), the DOS-P8
cutover (A15, eight steps) and DOS-P9's release (A16 with L1, eight steps). It closes with A16 and
with nothing earlier.

Everything after `NOW` is sequenced by `plans/2026-09-04-developer-os-completion-roadmap.md` (the
founder decisions D1–D64 and what each phase still owes). `docs/migration/instruction-inventory.md`
is the scope of A12, A12b, A13 and A14.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A15 | DOS-P8 Founder migration (shadow mode dropped, D58) — `docs/migration/founder-cutover.md`, then execution | A14 (closed) | rollback to the legacy runtime is exercised and one stable cycle completes | runbook written; execution now |
| A13 | DOS-P11 Hooks | — | every hook in the inventory §4 plus session-start injection is observed firing and names the installed binary | phase closed; founder Tasks 2 and 18 owed |
| A11b | DOS-P7 remainder (D16): Spec 2 closure Tasks 9–10, Task 26, Task 11b; NEW-113 (D65) | A15 (D56 ran Tasks 12–25 and plan 1b early) | `update`, `update rollback`, `git` and `automation` proven on a disposable install, then on the founder machine | Phase 8 and 9 closes ran; closure Tasks 9–10 blocked on design (NEW-110); Task 26 and 11b parked (D46: the launcher refuses every `unsigned-local` home, `apps/launcher/src/selection.ts:331`); Task 19 founder |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

A11 (Phase 4b) and A14 (Phase 7) have nothing left of their own: A11's Task 11b is tracked under
A11b, and A14's template scan runs with A12's.

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate:

- NEW-46 — close the same-uid `PATH` spawn surface or design persisted executable identity.
- NEW-90 — key the D31 stat-option exemption on the receiver type, not the file, or widen
  `IDENTITY_RENDERING` (re-homed from Phase 4b, 2026-09-25).
- NEW-92 and NEW-97 — re-homed from the closed Phases 8 and 9 on 2026-09-26.
- Rows owned by the closed plan 1a (NEW-82, NEW-88, NEW-89, NEW-91, NEW-93, NEW-96, NEW-99): startable
  when the touched subsystem is next worked.

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

`BACKLOG.md` §1 holds 59 open numbered rows; §6 lists what the phase closes deferred, by phase.
Closed on 2026-09-26 with the green run: NEW-49, NEW-60, NEW-85, NEW-94 (`59a1237`), NEW-95, NEW-98 and
NEW-109; NEW-108 by the A12 §11 spec amendments; NEW-65, NEW-102, NEW-103 and NEW-61's loading half by the unbilled real-vendor run (A12 Task 21 Step 4 and `test:vendor-ingest`, Claude 2.1.283 and Codex 0.155.1). Owners: NEW-101 and NEW-104 by the founder
stop points above; NEW-61's `update` half and NEW-86 by NEW-110's Spec 2 revision pass; NEW-84 superseded by NEW-113 (D65); NEW-87 travels with whichever row each mis-aimed citation
belongs to; NEW-105 to NEW-107 by A12's follow-ups;
NEW-111 and NEW-112 by Task 11b (D46); NEW-110 by the Spec 2 revision pass.
They are not ordered ahead of A15 unless the touched subsystem makes one relevant.

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

- Product sequence: 4 open entries — A15 (now), A13 (founder stops only), A11b, A16. A12b and A12 closed 2026-09-26/28.
- Implementation still to build: NEW-61's Codex re-registration on `update` (with Phase 8's apply
  path); A16's plan and work.
- Parked or blocked: Spec 2 closure Tasks 9–10 (NEW-110), Spec 2 Task 26, Spec 2 Task 11b (D46),
  NEW-100's round trip (opt-in-surfaces spec §7.1, post-A16, D42).
- Founder stop points: A13 Task 18; the A15 cutover execution. Long-lead gates L1 and L2 block A16.
- Repository chores: none. The A12 §11 amendments with NEW-108, the inventory status flip, A12b's
  decisions and residuals and plan 1b's architecture carry-over ran on 2026-09-26.
- Repository backlog: 59 open numbered rows (`BACKLOG.md` §1), plus the Foundation watchdog decision
  and the §6 phase-close deferrals.
