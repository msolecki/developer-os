# Execution order

The queue contains unfinished work only. Work top to bottom. Detailed acceptance criteria live in
`BACKLOG.md`; the active implementation steps live in the linked plan.

An item leaves this file when its completion evidence is committed. Git history and architecture
notes are the archive.

## NOW

**No agent product work is in flight; the next steps are founder- or time-gated.** The full suite is
green on `5a7462a9` (2026-10-05: `npm run check` rc=0 in 288 min, `npm run test:pinned-host` 12
passed, 1 skipped). `development` at `17cf02ca` (PR #21, NEW-144, merged; the tree of `17cf02ca`) is
installed on the live machine with launchd automation enabled (D82): five jobs, `git-sync` off, Git
disabled until the founder enables it (D76). A kickstarted scheduled `doctor` exited 0.
Kickstarted on 2026-10-07: `brain-reindex` exited 0, then `brain-garden` ran Claude once (`success`
`ok`, two gap targets, two hub proposals accepted and quarantined, none rejected), which closed NEW-134.

1. **A15 steps 16–18.** Step 16 items 1–4 (Claude half) ran on 2026-10-07: capture `597d458f9fd75be7` → accept → `ingest --agent claude` wrote `DEV/developer-os-update-trusts-homebrew-tap-d84.md`, `brain lint` 0 errors, `brain reindex`, `brain search "homebrew"` returns it first; the new-session injection check is the founder's. A first synthetic capture (`a54eafa53539612a`) was ingested with no note (the agent proposed none; `ingest.ts` reports `ingested` with no notes listed), and the first ingest of `597d458f9fd75be7` was refused by NEW-199's false positive, then passed on retry. Items 5–7 (Codex, reinstall, uninstall) and steps 17–18 wait for the Codex window after 2026-10-22 and a green gate on the installed commit.
   Originally: (`docs/migration/founder-cutover.md`: per-adapter gate cycle, exercised
   rollback) after one week of use; step 16 checks injection (NEW-139's fix installed since
   2026-10-04). **Step 19** after one stable cycle; it also removes the vault's legacy skills and
   tooling (step 13b's workflow is already disabled).
2. **Codex hook approval after 2026-10-22** (A15), with NEW-104 and NEW-75's Codex half in the same
   window.
3. **Reinstall, then `brain reindex`** (BRAIN-5 changed the `occurrences` default), **then the NEW-116
   re-run** (D86 (5)): `ingest` on the 31 refused captures, and report the counts.

## Founder stop points

Each is executable from the document named; none is agent work.

1. A15 steps 16–19 and the Codex hook approval after 2026-10-22 (`docs/migration/founder-cutover.md`).
2. A13's real-agent rows (evidence in `docs/architecture/hooks.md` §4): NEW-127 (Claude's unobserved
   rows and the isolated-`ingest` check) and NEW-104 (the Codex real-agent matrix, after 2026-10-22).
3. NEW-75's Codex half: its credential path supplied separately and one real authenticated
   `ingest --agent codex` (credits, after 2026-10-22).
4. Reinstall, `brain reindex`, then the NEW-116 re-run of `ingest` on the 31 refused captures (D86 (5)).
5. NEW-169's host kickstart check on the disposable gate account (`BACKLOG.md` NEW-169).
6. Observations: NEW-45 (one paid Codex run), NEW-42 (capture inside both vendors' TUIs), NEW-7
   (percent-encoded links in Obsidian).

Open sequence (D16, daily use before completeness): A15 on its own clock and the stop points beside
it; then A16 (Task 11b closed 2026-10-11, D98).

The program plan was closed as bookkeeping on 2026-10-07 (D89; `git show ae25acd9:docs/superpowers/plans/2026-07-21-developer-os-program.md`): its
open items — DOS-P7's remainder (Task 11b), the DOS-P8 cutover (A15) and DOS-P9's release (A16 with
L1) — now live in `BACKLOG.md` §3–§4, and the program is complete when A16 is. Founder decisions
D1–D101 live in `DECISIONS.md` (the completion roadmap, closed by D101).

## Product path

Strict sequence; do not start a blocked row early.

| # | Work | Needs | Done when | Status |
|---|---|---|---|---|
| A15 | DOS-P8 Founder migration (D58) — `docs/migration/founder-cutover.md` | — | step 16 passes and step 19's remainder is done | steps 1–15 done 2026-09-28/29; step 18 waived and the legacy shared repository retired (D97, 2026-10-11); step 16 Claude items 1–4 passed 2026-10-11 (NEW-250 found); step 19's vault tooling removed; open: step 16 item 5 (Codex) waived, unverified (D100); items 6–7 run in A16 Task 11 step 7 (D99); open: step 19's result files |
| A11b | DOS-P7 remainder: Task 11b (NEW-111, NEW-112, NEW-118, NEW-163, NEW-171) — Spec 2 block "Amended 2026-10-07 (D84, Task 11b)" | — (D94 designed it) | `update` reaches a real release on a disposable install, then on the founder machine | **closed 2026-10-11 (D98)**: code 2026-10-08; full suite = green `check.yml` on `eaef019d`; disposable install = NEW-210 Task 7's VM gate; the founder-machine leg (F4 reinstall, NEW-200 checks) moved to A16 Task 11 step 7 |
| A16 | DOS-P9 Public beta and v1 — `specs/2026-10-07-developer-os-release-publication-design.md` | — | `v1.0.0` is published and reproducible | spec approved 2026-10-07; plan `plans/2026-10-08-a16-release-publication.md` Tasks 1–10 done 2026-10-08 (on `integrate/task-11b`); Task 11 steps 1–3 done 2026-10-14 (D103; L1 and L2 closed); next (D104): release-on-main wiring, then the PR `development` → `main` releases `v0.1.0` automatically; VM gate waived |

## Repository work not owned by the product sequence

The full closure conditions are in `BACKLOG.md` §1.

Startable without another product gate (one worktree each):

- NEW-132 (the full recovery sweeps; its blockers closed 2026-10-07; needs a quiet machine, ~8 h sharded).


Waiting on a founder observation: NEW-193 (4), the Codex `subagents` witness, after 2026-10-22. NEW-182 closed 2026-10-07.

Wave 4 (P3, 2026-10-07) is integrated: NEW-176..NEW-181, NEW-184..NEW-192 and the done items of NEW-183
(D87, D88). The full fake-codex e2e of NEW-190 is deferred to Task 11b/A16 with no row.

NEW-183's remainder is integrated (2026-10-10, reviewed READY). Awaiting a founder decision: NEW-212
(delete or keep `GitSyncPlanV1` and `SecurityPolicy`, the review's two leftovers).

Waves 2-3 of the 2026-10-05 audit are integrated (2026-10-06, D86): NEW-131, NEW-141, NEW-142, NEW-146,
NEW-53 and NEW-147..NEW-175 except NEW-163, NEW-169 (half), NEW-171.

Decided by D84 (2026-10-05), next design work:

- Task 11b (NEW-111, NEW-112, NEW-118) — re-scoped: trust a distribution channel instead of an
  offline root key (D84 (1), (2)); designed as Spec 2 K1–K8 and code complete 2026-10-08, with
  NEW-163 and NEW-171 (D86 (4)) closed inside it.

Wave 1 of D83/D84 is integrated (2026-10-06): NEW-143, NEW-120, NEW-130, NEW-40, NEW-33, NEW-121,
NEW-35, workflow versions, the Spec 2 §4.2 amendment, one retention walk and status `off`
(the wording half of NEW-134).

Awaiting founder numbers: NEW-116 (D86 (5): re-run `ingest` on the 31 refused captures after the next
reinstall and `brain reindex`, and report the counts; the row closes or narrows on them).

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
| L1 | founder + qualified counsel | **closed 2026-10-14**: MIT committed (A16 Task 11 step 1) | — |
| L2 | founder / environment with remote access | **closed 2026-10-14**: tap formula merged (tap PR #1), secret, environments, rulesets checked (A16 Task 11 step 2) | — |

## Count

- Product sequence: 2 open entries — A15 (steps 16, 19), A16 (Task 11 steps 4–6, 8–9; plan `plans/2026-10-14-release-on-main.md`); A11b closed (D98).
- Founder stop points: 6, listed above.
- Startable rows: 1 (NEW-132); NEW-259 waits for the first update planner that emits creates; NEW-193 (4) waits for Codex after 2026-10-22. Founder decision: NEW-212.
  Awaiting founder numbers: NEW-116.
- Repository backlog: 33 open numbered rows (`BACKLOG.md` §1), plus the §6 phase-close deferrals.
