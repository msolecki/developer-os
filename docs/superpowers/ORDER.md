# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**No agent product work is in flight; the next steps are founder- or time-gated.** The full suite is
green on `5a7462a9` (2026-10-05: `npm run check` rc=0 in 288 min, `npm run test:pinned-host` 12
passed, 1 skipped). `development` at `17cf02ca` (PR #21, NEW-144, merged; the tree of `7cdd4b97`) is
installed on the live machine with launchd automation enabled (D82): five jobs, `git-sync` off, Git
disabled until the founder enables it (D76). A kickstarted scheduled `doctor` exited 0.

1. **NEW-134's real `brain-garden` run with Claude** — first scheduled slot Sunday 2026-10-11 17:00.
   Confirm its status record and captures, then close the plan
   (`plans/2026-09-30-developer-os-brain-gardener-pulse.md`) and the row.
2. **A15 steps 16–18** (`docs/migration/founder-cutover.md`: per-adapter gate cycle, exercised
   rollback) after one week of use; step 16 checks injection (NEW-139's fix installed since
   2026-10-04). **Step 19** after one stable cycle; it also removes the vault's legacy skills and
   tooling (step 13b's workflow is already disabled).
3. **Codex hook approval after 2026-10-22** (A15), with NEW-104 and NEW-75's Codex half in the same
   window.

## Founder stop points

Each is executable from the document named; none is agent work.

1. NEW-134: confirm the 2026-10-11 `brain-garden` run (above).
2. A15 steps 16–19 and the Codex hook approval after 2026-10-22 (`docs/migration/founder-cutover.md`).
3. A13's real-agent rows (evidence in `docs/architecture/hooks.md` §4): NEW-127 (Claude's unobserved
   rows and the isolated-`ingest` check) and NEW-104 (the Codex real-agent matrix, after 2026-10-22).
4. NEW-75's Codex half: its credential path supplied separately and one real authenticated
   `ingest --agent codex` (credits, after 2026-10-22).
5. Observations: NEW-45 (one paid Codex run), NEW-42 (capture inside both vendors' TUIs), NEW-7
   (percent-encoded links in Obsidian).

Open sequence (D16, daily use before completeness): A15 on its own clock and the stop points beside
it; then Task 11b (parked, D46); then A16.

The parent document is `plans/2026-07-21-developer-os-program.md`: its open items are DOS-P7's
remainder (Task 11b), the DOS-P8 cutover (A15) and DOS-P9's release (A16 with L1). It closes with
A16. Founder decisions D1–D82 live in `plans/2026-09-04-developer-os-completion-roadmap.md`.

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A15 | DOS-P8 Founder migration (D58) — `docs/migration/founder-cutover.md` | — | rollback to the legacy runtime is exercised and one stable cycle completes | steps 1–15 done 2026-09-28/29; 16–18 after a week of use, 19 after one stable cycle |
| A11b | DOS-P7 remainder: Task 11b (NEW-111, NEW-112, NEW-118) | founder root-key decision (D46) | `update` reaches a real release on a disposable install, then on the founder machine | parked (D46) |
| A16 | DOS-P9 Public beta and v1 | A11b, L1, L2 | `v1.0.0` is published and reproducible | blocked |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate (one worktree each):

- NEW-116 (ingest yield on long multi-decision captures).
- NEW-141 (a refused capture stays at the head of every `ingest --limit N` window).
- NEW-53 (the `init` encoder cost: `encodeString` and the retention postimage).
- NEW-131 (instruction-defaults scanner superlinear on a cap-sized file).
- NEW-132 (update recovery death-point sweeps).
- NEW-142 (`founder-cutover.md` step 10 cannot satisfy its own `path` condition; docs only).

Needs a founder decision:

- NEW-130 — accept or fix each of NEW-129's redaction residuals.
- NEW-143 — the `provider-token` `sk-` pattern over-matches kebab-case slugs; the row proposes a
  left boundary.
- NEW-120 — redact a partially covered high-entropy tail, or accept it.
- NEW-121 — manifest-owned persisted executable identity for `capture`'s probe, or accept the
  same-uid residual.
- NEW-40 — refuse-versus-report for a hand edit during the ingest agent call.
- NEW-33 — whether root-owned, group-writable executable directories are trusted.
- NEW-35 — enforceable exec-by-identity, or the check-then-spawn race retained as a platform limit.
- NEW-134 — whether `automation status` keeps showing an off optional job as `eligible absent`.
- Task 11b (NEW-111, NEW-112, NEW-118) — parked by D46 on the root-key decision.
- Foundation watchdog — whether `SpawnLockfRunner` needs one around non-blocking `lockf`
  (`BACKLOG.md` §2).

Conditional: NEW-27 when a real write scope is wired, NEW-28 when a production argument reaches the
retained screening refusal, NEW-100's round trip after A16 (D42).

## Delivery evidence still owed

- L2 still owes release permissions. The `baseline` ruleset on `development` makes PRs mandatory, so
  a direct push is rejected with `GH013`; deliver through a PR and the founder merges (PR #21 was
  rebase-merged on 2026-10-05, rewriting its SHAs). `gh` works when network calls run unsandboxed.
- Gate and CI costs live in `docs/architecture/foundation.md` §9; why a green local `check` is not
  evidence about CI lives in `BACKLOG.md` §5. Retain the complete log of any full-suite failure.

## Long-lead gates

| # | Owner | Required action | Blocks |
|---|---|---|---|
| L1 | founder + qualified counsel | approve the exact OSI license text (MIT proposed, D69 (9)) | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 3 open entries — A15 (steps 16–19), A11b (Task 11b, parked), A16 (with L1, L2).
- Founder stop points: 5, listed above.
- Startable rows: 6. Founder decisions: 10, listed above.
- Repository backlog: 26 open numbered rows (`BACKLOG.md` §1), plus the Foundation watchdog decision
  and the §6 phase-close deferrals.
