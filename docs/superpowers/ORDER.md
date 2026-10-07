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

1. **A15 steps 16–18** (`docs/migration/founder-cutover.md`: per-adapter gate cycle, exercised
   rollback) after one week of use; step 16 checks injection (NEW-139's fix installed since
   2026-10-04). **Step 19** after one stable cycle; it also removes the vault's legacy skills and
   tooling (step 13b's workflow is already disabled).
2. **Codex hook approval after 2026-10-22** (A15), with NEW-104 and NEW-75's Codex half in the same
   window.
3. **Reinstall, then `brain reindex`** (BRAIN-5 changed the `occurrences` default), **then the NEW-116
   re-run** (D86 (5)): `ingest` on the 31 refused captures, and report the counts.
4. **Add a permission rule for NEW-183** to the founder's settings (the auto-mode classifier blocked the
   items the founder approved on 2026-10-06; see below).

## Founder stop points

Each is executable from the document named; none is agent work.

1. A15 steps 16–19 and the Codex hook approval after 2026-10-22 (`docs/migration/founder-cutover.md`).
2. A13's real-agent rows (evidence in `docs/architecture/hooks.md` §4): NEW-127 (Claude's unobserved
   rows and the isolated-`ingest` check) and NEW-104 (the Codex real-agent matrix, after 2026-10-22).
3. NEW-75's Codex half: its credential path supplied separately and one real authenticated
   `ingest --agent codex` (credits, after 2026-10-22).
4. Reinstall, `brain reindex`, then the NEW-116 re-run of `ingest` on the 31 refused captures (D86 (5)).
5. NEW-183: add the permission rule (founder action) so an agent can do the approved items.
6. Observations: NEW-45 (one paid Codex run), NEW-42 (capture inside both vendors' TUIs), NEW-7
   (percent-encoded links in Obsidian).

Open sequence (D16, daily use before completeness): A15 on its own clock and the stop points beside
it; then Task 11b (parked, D46); then A16.

The program plan was closed as bookkeeping on 2026-10-07 (D89; `git show ae25acd9:docs/superpowers/plans/2026-07-21-developer-os-program.md`): its
open items — DOS-P7's remainder (Task 11b), the DOS-P8 cutover (A15) and DOS-P9's release (A16 with
L1) — now live in `BACKLOG.md` §3–§4, and the program is complete when A16 is. Founder decisions
D1–D89 live in `plans/2026-09-04-developer-os-completion-roadmap.md`.

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

- NEW-195 (P1: forward recovery stuck on an in-flight bundle or rollback-payload publication).
- NEW-196 (rejected-verifier resume reports the wrong exit code).
- NEW-169 (remaining half: a doctor check for a failed scheduled run, and the host kickstart check).
- NEW-197 (`init`'s `lstat` storm in bootstrap retention).

NEW-132 (the full recovery sweeps) is blocked by NEW-195 and NEW-196; its harness is affordable now.

Waiting on a founder decision or observation: NEW-193 (the stricter citations rule for 99 cells, the
Codex `subagents` witness, the Spec 1 "four leases" amendment). NEW-182 closed 2026-10-07.

Wave 4 (P3, 2026-10-07) is integrated: NEW-176..NEW-181, NEW-184..NEW-192 and the done items of NEW-183
(D87, D88). The full fake-codex e2e of NEW-190 is deferred to Task 11b/A16 with no row.

Blocked on a founder action:

- NEW-183 (remainder: SEC-1 `inheritedFds` and its stale FD-3 comment, DEAD-6/SEC-2/SEC-6 unused
  exports, SEC-5 the `resolveOwnedPath` docstring, FLOW-UPD-6). The founder approved them on 2026-10-06;
  the auto-mode permission classifier blocks them until a permission rule is added to the founder's
  settings.

Waves 2-3 of the 2026-10-05 audit are integrated (2026-10-06, D86): NEW-131, NEW-141, NEW-142, NEW-146,
NEW-53 and NEW-147..NEW-175 except NEW-163, NEW-169 (half), NEW-171.

Decided by D84 (2026-10-05), next design work:

- Task 11b (NEW-111, NEW-112, NEW-118) — re-scoped: trust a distribution channel instead of an
  offline root key; needs a Spec 2 amendment, then the A16 spec and plan (D84 (1), (2)). NEW-163 (the
  version-free entrypoint never follows an update) and NEW-171 (no planner arm for instruction rows) are
  deferred to it (D86 (4)), with A16.

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
| L1 | founder + qualified counsel | approve the exact OSI license text (MIT proposed, D69 (9)) | A16 |
| L2 | founder / environment with remote access | verify remote rules, PR flow, CI, and release permissions | A16 |

## Count

- Product sequence: 3 open entries — A15 (steps 16–19), A11b (Task 11b, parked), A16 (with L1, L2).
- Founder stop points: 6, listed above.
- Startable rows: 4 (NEW-195, NEW-196, NEW-169's remainder, NEW-197); NEW-132 is blocked by NEW-195/196; NEW-193 waits on the founder. Founder action: NEW-183 (permission
  rule). Founder design: the distribution design (NEW-163, NEW-171). Awaiting founder numbers: NEW-116.
- Repository backlog: 22 open numbered rows (`BACKLOG.md` §1), plus the §6 phase-close deferrals.
