# Fix the 2026-10-10 audit findings (NEW-213..NEW-232)

**Goal.** Fix or explicitly decline every finding in `docs/superpowers/audits/2026-10-10-full-audit.md`
(128 findings, sessions S01–S20, rows NEW-213..NEW-232).

**Decisions (founder, 2026-10-10).**

- AUD-001 belongs to NEW-210 (the large-release-files plan already in flight on `task/n210-4` and
  `task/vm-drift`). This plan does not touch it.
- Sessions whose files overlap NEW-210 wait until NEW-210 is integrated on `development`: S01b
  (AUD-003), S11, S12, S13, S16, S17.
- Dead code: delete findings with removal confidence `high`; record `medium` and `low` ones as kept,
  with the reason, in the task report.
- Implementers and reviewers are headless `claude -p` sessions in `--permission-mode bypassPermissions`,
  each in its own worktree under `../developer-os.worktrees/aud-<task>`, branched from
  `integrate/audit-2026-10-10`. At most 5 tasks run at once.

**Procedure per task** (`SESSION.md` §4.1, §5):

1. Implementer: a failing test first for every logic, security and flow fix
   (`superpowers:test-driven-development`); docs-drift fixes edit the doc. A finding that is wrong at
   HEAD, or that needs a spec change or a design decision, is declined with a reason, not implemented.
   Focused vitest on the touched test files; slow suites (`*.v2.test.ts`, `executor.test.ts`, `tests/e2e`,
   `tests/integration`, `tests/security`) run only the task's own cases with `-t`, one real `init` at a
   time. `npm run lint` green before every commit. No edits under `docs/superpowers/`, no push, no merge.
2. Reviewer: a fresh `claude -p` that wrote none of it reviews the commit range against the findings.
   Accepted findings go back to the implementer as a failing regression test first. At most two rounds;
   otherwise the orchestrator decides.
3. Orchestrator: cherry-picks the reviewed range onto `integrate/audit-2026-10-10`, reruns
   `npm run lint`, and reviews every security diff (S02, S07) by hand before `development` takes the branch.

**Close.** `development` fast-forwards to the integration branch; the founder runs `npm run check` and
the deferred slow suites (D32) before the rows close; one push.

## Tasks

| Task | Row | Findings | Consumes | Status |
|---|---|---|---|---|
| S01a | NEW-213 | AUD-011, AUD-012, AUD-014, AUD-016 | — | |
| S01b | NEW-213 | AUD-003 | NEW-210 on `development` | blocked |
| S02 | NEW-214 | AUD-002, 005, 006, 007, 015 | — | |
| S03 | NEW-215 | AUD-004, 008, 009, 010, 013, 019 | — | |
| S04 | NEW-216 | AUD-017, 018, 020, 021, 022, 023, 024 | — | |
| S05 | NEW-217 | AUD-025, 026, 085, 086, 087, 088, 089 | S03 | |
| S06 | NEW-218 | AUD-060..065 | S05 | |
| S07 | NEW-219 | AUD-027..033 | — | |
| S08 | NEW-220 | AUD-066..069, 090, 095 | S04 | |
| S09 | NEW-221 | AUD-051..056 | — | |
| S10 | NEW-222 | AUD-034, 035, 036, 057, 058, 059 | S01a | |
| S11 | NEW-223 | AUD-044..050 | NEW-210 | blocked |
| S12 | NEW-224 | AUD-037..043 | NEW-210, S01a, S09 | blocked |
| S13 | NEW-225 | AUD-096..100, 128 | NEW-210, S12 | blocked |
| S14 | NEW-226 | AUD-101..106 | S10 | |
| S15 | NEW-227 | AUD-070, 091..094, 107 | S06 | |
| S16 | NEW-228 | AUD-108..113 | NEW-210 | blocked |
| S17 | NEW-229 | AUD-114..120 | NEW-210, S13 | blocked |
| S18 | NEW-230 | AUD-121..127 | — | |
| S19 | NEW-231 | AUD-075..081 | — | |
| S20 | NEW-232 | AUD-071..074, 082..084 | — | |

**Test per task:** the task's failing-then-green tests and `npm run lint` in its worktree, then
`npm run lint` again on the integrated tree. **Plan test:** `npm run check` green on the final
integration commit.

## Next action

Run the unblocked tasks (S01a, S02, S03, S04, S07, S09, S18, S19, S20, then their consumers).
