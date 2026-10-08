# Developer OS — outstanding work backlog

`SESSION.md` defines procedure. `ORDER.md` defines sequence. This file contains unfinished work and
its closure conditions.

- Register a new task, spec, or plan here and in `ORDER.md` in the same change.
- Remove a row when its evidence is committed; git history is the archive.
- Keep only unfinished plans in `plans/`. Delete a finished plan after moving surviving constraints
  into canonical architecture or program documentation.
- Keep a subsystem spec only while it governs unfinished work.
- Apply the gates in §7 to every code-producing item.

## 0. Status at a glance

The full suite D75 and D81 owed ran green on `5a7462a9` (2026-10-05): `npm run check` rc=0 in
288 min and `npm run test:pinned-host` 12 passed, 1 skipped (the disposable-account launchd gate).
No full-suite debt is outstanding.

| Entry | Work still required | Blocked by |
|---|---|---|
| A13 · DOS-P11 | founder stops only: the Codex real-agent matrix (NEW-104, after 2026-10-22); Claude's unobserved rows and the isolated-`ingest` check (NEW-127). The plan closed 2026-09-29 | founder |
| A15 · DOS-P8 | `docs/migration/founder-cutover.md` steps 1–15 done (2026-09-28/29); steps 16–18 after a week of use, step 19 after one stable cycle, Codex hook approval after 2026-10-22 | founder, live machine |
| A11b · DOS-P7 remainder | Task 11b parked (NEW-111, NEW-112, NEW-118): the real-release half of Phase 8's gate. NEW-113 Task 5, the Phase 9 gate on a disposable account, was skipped by D76; the real-host Git cases pass on `5a7462a9` (NEW-137, closed) | D46, founder |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A11b, L1, L2 |

A11 (Phase 4b) and A14 (Phase 7) have nothing left of their own: Task 11b is tracked under A11b, and
A14's template scan ran with A12's (0 findings, 2026-09-28).

The phase order, the founder decisions of 2026-09-04 and 2026-09-16 that fixed it, and the documents each phase
expects are in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.

## 1. Open repository rows

There are 21 numbered rows. They are not automatically ordered ahead of A15.

**Folded 2026-10-06: the full repository audit of 2026-10-05** (read-only, 71 agents, against
`5a7462a9`; 166 findings: P0 1, P1 3, P2 26, P3 136; the audit's 27 verifier-refuted findings are not
counted). Each finding was rechecked against `development` at `4c4150ab`: **164 open, 2 fixed-since,
0 refuted-on-current.** Fixed since: the P0 W2-GAP-HOST-1 (launchd execs a 0600, shebang-less
entrypoint, EX_CONFIG 78) by NEW-144 (`77d2ea64`; its host kickstart check is carried in NEW-169), and
the P3 DEAD-5 (`projectRetainedDirectoryTree` test-only) by `b88bf311`. FLOW-INIT-2 (the 1.5 s exit
budget abandons slow verbs' firing records) was decided by D86 (3) and closed 2026-10-06. Findings were NEW-147..NEW-188 (waves 2–4 closed most of them, closed 2026-10-06/07): one row per P1 (NEW-147..149)
and P2 (NEW-150..175), and one row per area for the 135 P3 findings (NEW-176..188), each carrying the
current `file:line`, the fix and the validation, so the audit file is no longer needed.

**Closed 2026-09-29 under D75** (the D70 lane; the full suite D75 owed ran green on `5a7462a9`): NEW-20 (`de383fc5`, import
`996139c4`), NEW-24 (`a84c4f4f`, import `ea56ad60`, `3959fc0f`, `9e0dfb9e`), NEW-25 (`62b33d14`;
residual NEW-120), NEW-26 (`c2d63710`, `41359450`), NEW-31 (`0d5e5b29`), NEW-32 (`2f090e8f`), NEW-34
(`edcf4f61`), NEW-36, NEW-37 and NEW-39 (`43c64020`, `7fb058b2`), NEW-38 (`0258a006`), NEW-46
(`40d57f86`; residual NEW-121), NEW-50 (`81efb412`), NEW-56 (`77049411`), NEW-61 (`dab8064a`,
`b2c258e8`, `b7a593be`), NEW-62 (`40f0eb4f`), NEW-63 (`95bd7d67`), NEW-64 (`675a8ccf`, template
`4b4db9b4`), NEW-66 (`1bf212a3`), NEW-71 (`52c667c7`), NEW-76 (`3b0f9b38`), NEW-78 (`f9670fce`),
NEW-86 (`01c76fd1`), NEW-88 and NEW-91 (`2eca4839`, `51e7d04d`; a rewrite temp is refused by its
phase only when `planned`), NEW-89 (`e190e3ba`), NEW-90 (`5e462e97`; residual NEW-119), NEW-92
(`6fb50b58`; residual NEW-124), NEW-93 (`779b38ea`, `4f5eedad`: the key is recorded from `lstat`, its
`sha256` null), NEW-96 (`d8219e57`), NEW-97 (`3b0c19fd`; residual NEW-122), NEW-105 (`e6f6b941`,
`ee83f535`, `b779fa59`), NEW-106 (`391f7996`, `d504c7a4`), NEW-107 (`e7d470e2`), NEW-110 (plan
`2026-09-28-new-110-spec2-apply.md`, closed; its commits are in the roadmap's Phase 8), NEW-114
(`f16cf211`, `51e7d04d`; residual NEW-123). Already fixed before the lane, rows removed: NEW-54
(`b146f7e`), NEW-82 (plan 1a Task 17; its open half is NEW-126), NEW-99 (`b0db9d9`). NEW-87 is moot: its remaining mis-aimed
citations lived in the NEW-56 and NEW-71 rows, and NEW-34's anchor form replaces line citations.
NEW-128 closed 2026-09-30 (`topicOfFolder` resolves `topicAliases` in refactor, retire, capture and ingest). NEW-129 closed 2026-09-30 (slug-shaped paths leave the high-entropy class, passphrases are labelled, ingest refuses a marker in a destination path; residuals NEW-130). NEW-75's Claude half closed (`3ebc505d`, `de0d4f8e`); the row stays for Codex. NEW-117 closed
2026-09-29 (`f95b8430`: the three uncalled `PlatformAdapter` system-executable methods deleted).
Closed 2026-10-01/02, rows removed: NEW-115 (`fad8512c`, e2e `64e64896`), NEW-119 (`0037b5a8`), NEW-122
(`96e9b427`), NEW-123 (`231b4917`, `082b7c29`, `f37dcbeb`), NEW-124 (`231b4917`, `44806509`), NEW-126
(`231b4917`), NEW-135 (`c4ace1bc`, `4ae8ca72`), NEW-136 (`baf8c53c`, `78429b83`, `e24604e0`), NEW-29
(`3a707d81`: elapsed-time assertions replaced by counts and behavioural bounds; founder accepted
2026-10-03 that the ratio test is gone instead of a counting seam).
Closed 2026-10-03..05, rows removed: NEW-133 (`06049edb`, `ec91c69f`, `1e1e88bf`, docs `45bed276`;
plan deleted; the founder option of dropping the projection's internal walk pair stays recorded in
`foundation.md` §9), NEW-137 (`71d4417a`, `558dacce`, `39ef66d3`; `test:pinned-host` green on
`5a7462a9`), NEW-138 (`dd2677ff`, `82a603bf`, `0d137449`, `d51e785b`..`ef7d8991`, docs `f489f345`;
D82), NEW-139 (`c80971ab`..`a96c6275`), NEW-140 (`ee82542a`..`a92de5f1`), NEW-144 (`77d2ea64`, PR #21).

Closed 2026-10-06 (D83/D84 wave 1), rows removed: NEW-143 (`10c618f9`, `bd24787f`, `42996598`), NEW-120 (`2bf1d30f`,
`bd24787f`), NEW-130 (`8282abed`, `1d957df0`, `c35563d2`, `ce009046`), NEW-40 (`9ca62fb1`, `bc1407ee`, `96fb6385`,
`91db6d89`, `679a715f`, `d89954c2`), NEW-33 (`9bc9ea36`, `681a3da7`); NEW-121 and NEW-35 accepted as platform limits
(D83 (7); `2c1e2f05`, threat-model §5.11). Also closed: workflow versions, §6 item M7 (`a71cc629`); the Spec 2 §4.2
amendment (D84 (6), `2c1e2f05`); one walk per retention projection (D84 (7), `37a5affe`, `b88bf311`; `foundation.md` §9
argues the anti-TOCTOU pair from the before/after projections; accepted residuals: a change that starts and reverts inside
one observation, and a mid-change tree captured while recording a row, where retain then refuses).
Accepted 2026-10-06 (D85), row removed: NEW-145 (a user-owned group-writable executable directory with a shared group, Homebrew's `/opt/homebrew/bin`, stays admitted; `threat-model.md` §5.11).

Closed 2026-10-06 (waves 2–3), rows removed: NEW-131, NEW-141, NEW-142, NEW-53, NEW-146 (both residuals accepted and the `sk-` 4+ letter part rule, D86 (1)), NEW-147..NEW-162, NEW-164 (the thin commands dropped, D86 (2)), NEW-165..NEW-168, NEW-170, NEW-172..NEW-175, and FLOW-INIT-2 from NEW-177 (`stop` and `format` write their firing record before their long work, D86 (3)); commits `37691cb9`, `41d2ebfc`, `989bfd12`, `2837346d`, `2632ad75`, `532aea98`, `f4b47491`, `46a9d4f7`, `d3ebfc8f`, `def6c19d`, `ec0c1cb0`, `457dd33b`, `21b39a70`, `53a68ed6`, `d83d65aa`, `d51e6430`, `d4452dca`, `18a6e056`, `18b9eb21`, `11eb5e46`, `0db6c0d2`, `159e6fbf`, `1c8783b5`, `346c2ad5`, `a97e663f`, `aa154f6c`, `e21c8a7e`, `45409d04`, `a72e933c`, `1504de53`, `502d5ef4`, `ed7f01bd`, `877a2203`, `1ce98a2a`, `c84ac9c2`, `36c8642a`, `e2796b2b`, `82a43549`, `f2d2c603`, `089125e8`, `7d018d46`, `382f84b9`, `38b6e4b0`. Follow-ups are NEW-189..NEW-192.

Closed 2026-10-07 (wave 4, P3), rows removed: NEW-176 (`4049a206`, `d5c71564`, `3148584f`, `26e295fd`, `09b84149`, `2a6da996`), NEW-177 (`8942f218`, `4369de0e`, `dd61675a`, `c5c97dd0`), NEW-178 (`bc0b457d`, `67c57532`, `e045f292`, `f5de592a`, `6ebfd739`, `401ce5dc`, `f86ff038`, `c5c97dd0`), NEW-179 (`c1af5654`, `f272d60e`, `fabe88cd`), NEW-180 (`96b511d7`, `c4dfeb12`, `5c18d0d7`, `6eafc388`, `363c9c91`, `31e634a3`, `1435f728`, `371c1c10`), NEW-181 (`ad531c95`, `26d858e3`, `ab4a93fa`, `e70a3855`, `fb4f87d3`, `a09eea8f`, `a504dfe0`, `24893bb0`, `05293833`; W2-BUNDLE-1 per D87), NEW-184 (`f8ee4aae`, `ed5f2bd8`, `f3a58a88`, `c2a4bc3f`, `808ec67d`, `c4149e2d`, `8c861c2b`, `19d2436a`), NEW-185 (`c9304f1b`, `33203016`, `3b1b3b6b`, `4b0f477a`, `36562a32`, `8c015bc9`; BRAIN-3 removed garden `fix` per D87), NEW-186 (`6ad077ac`, `47689b4c`, `9263d03f`, `0f1b5652`, `06be7493`, `303be1fa`; RENDER-3 and FLOW-DOCS-3 per D87), NEW-187 (`57199289`, `0aa02d51`, `ad7e2981`, `6438e31a`, `213d0aea`), NEW-188 (`23dfa510`, `6a60f26d`, `38f01431`, `6e568d30`; DEAD-8 per D87), NEW-189 (`894f2575`, `751fbbc2`, `9f2ceb59`; a publish intent is journaled before each rename, D87), NEW-190 (`f6e3b17f`; the applyRollback-level test is done, and the full fake-codex e2e is deferred to Task 11b/A16, with no row), NEW-191 (`80033ea9`), NEW-192 (`6a70a69c`); and the done items of NEW-183: CRITIC-2 (`533034e8`, `7ff07b02`), W2-SEC-UPD-2/3 (`28c3d64a`), W2-SEC-GIT-2 (`fa4e4e74`), W2-SEC-GIT-3/4 (`f08fd106`), W2-SEC-GIT-1 (D88 spec §4.2 amendment, `40ea68d3`), the LOW `ps` retry and the codex-home record guard (`40ea68d3`). NEW-182 and NEW-183 stay open for the leftovers and blocked items below; NEW-193 holds the small follow-ups.

Closed 2026-10-07, row removed: NEW-134 (implementation from `44c2ef63`, gate green on `5a7462a9`; the real Claude `brain-garden` run on the founder's home, kickstarted 2026-10-07T08:12Z, recorded `success`/`ok` with two accepted hub captures and no rejections). Its plan and spec were deleted; the spec is `git show ad359fd8:docs/superpowers/specs/2026-09-30-developer-os-brain-gardener-pulse-design.md`.

Closed 2026-10-07, row removed: NEW-182 (DEAD-7 `readOrCreateJournal` and the unused `operation` parameter deleted, `noUnusedLocals` and `noUnusedParameters` on in `tsconfig.base.json`; the `syncDirectoryAt` and `prompt.ts` shape copies stay as deliberate mirrors of core, founder decision 2026-10-07, so the core export list does not widen).

Closed 2026-10-07, row removed: NEW-194 (the stop guard's per-reference fallback allows with a note only when every failing reference reports nothing but TS5094/TS6310; a reference that fails without a TS code, or with any other code, still blocks).

Closed 2026-10-07, row removed: NEW-197 (`e60b6291`, `8243f15e`; reviewed READY): the retention evidence build memoizes its projections once per build on the executor path too, 456 walks of `state/` become 1, ~609k → ~361k `lstat` and fsync-free `init` ~20 s → ~11 s. The founder closed the row at this gain (2026-10-07): the remaining ~300k are the retain loop's before/after walks, the accepted cost of D84's anti-TOCTOU pair (`foundation.md`, "Amended 2026-10-07 (NEW-197)").

Closed 2026-10-07, rows removed: NEW-195 (forward recovery resumes an in-flight bundle or rollback-payload publication; a fresh create that finds its path present is journalled `create_refused` and exits 6; `441e8a74`, `71f7edef`, `af88ffb4`; Spec 2 §9.2 amended), NEW-196 (founder option D: exit 1 in the two-point plan-only suffix is accepted residual 11 in Spec 2 §13.3, the rerun returns 5; `b92bd4bc`), NEW-198 (recovery admits a home whose manifest is preserved at its journalled tombstone, incl. the terminal window via construction evidence; `8a8fa2b6`, `4d4aae3a`; Spec 2 §5.3 amended). All reviewed READY; apply sweep shards 1295–1320, 1334–1375, 1376–1450 and rejected 2255–2267 pass.

Closed 2026-10-07, row removed: NEW-199 (founder decision: a 2–3 character one-case letter+digit part such as `d84` or `11b` is word-like, at most 2 per run, and only beside a 4+-letter word; recovery codes in 3-character groups measured 0 newly clear; accepted residual in `threat-model.md`: an unlabelled lowercase token or passphrase with 1–2 such chunks; `deae79f2`, `1cbd1a14`, security review READY).

Closed 2026-10-08 (code complete on `integrate/task-11b`, SHAs repoint after merge; the deferred suites and the Task 14 VM gate still run at plan close), rows removed: NEW-200 (Spec 2 K8 with C1–C3: render from the active bundle `1e6e04ff`, `c4c7c4da`, `b6a7e2c6`, `b70b986d`; refresh after apply and rollback `9f0f6fd0`, `0ae5731b`, `390a470e`, `1d6e139e`; doctor stale-row warning and brew advice `1b022199`, `b3f091aa`; manifest re-anchor `62c92be8`, residual NEW-203; launchd Node NEW-204), NEW-202 (vendor search path `043a92f4`, threat model §5.11 `a3d2e0e5`; security review READY).

Closed 2026-10-08 (Task 11b, code complete; SHAs on `integrate/task-11b`, repoint after merge), rows removed: NEW-112 (no descriptor is accepted from any parent: FD 3 deleted from the launcher and the CLI, `7c612c3e`, `db97b0c0`), NEW-118 ((1)/(2) journalled `releases/<version>` and reservation release (`apps/cli/src/update/state-participant.ts` — `releaseReservation`) `a8381ed9`, `82dc730d`; (3) the Codex plugin version is the stamped release version `9d0f406c`, effective once NEW-200's planner proposes Codex changes; (4) the verifier reads a bounded home snapshot `28fef5f9`, `8f4dd476`, with K7 (e)'s residual), NEW-163 (option B: `bin/developer-os.mjs` follows the active record at run time, `316781fc`, `8216ff89`), NEW-171 (option (b): instruction rows bypass the planner and every `installedToken` arm checks the token kind, `3621bdc0`; rollback restamps them, `5b7a73b7`).

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-100 | uninstall → `init` round-trip gate deferred whole / plan 1a Task 24, D42 | **Plan 1a Task 24 (`uninstall-round-trip.v2.test.ts`) is carved out of plan 1a entirely and deferred to post-A16 hardening (D42, 2026-09-22), superseding D39's narrower plan of running it with `A9_KILL_POINTS` cut from ten to six.** The founder judged this class of heavy real-filesystem e2e proof — chained `init → uninstall → uninstall → init → uninstall → init`, plus an A9 kill-matrix reusing one home — not worth the wall clock now (an implementer had already run past the file's own ~31-minute local estimate when the decision was taken), against shipping the rest of the roadmap's plans first. **Full spec, including the exact ten candidate kill points and D39's selection rule, is §7.1 of `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` (moved there from plan 1a Task 24 on 2026-09-26, when the plan file was deleted).** Close by running §7.1 exactly as written there — with a real measured duration feeding the `timeout-minutes` of the `lifecycle-v2` shard the file runs in, under the 300-minute cap, applying D39's selection rule to keep six of the ten candidate points, and recording the four dropped points' equivalence arguments — once, alongside the codebase's other heavy e2e suites, after A11b and A12–A16 close. **Accepted risk until then:** beyond what Tasks 20–23b's own suites exercise (one reinstall cycle, and the NEW-99 regression Task 23's own chain already covers), the `uninstall` → `init` round trip is unproven end-to-end, and all four of the recovery microstates D39 would have selectively dropped are instead entirely uncovered. `test:lifecycle` is now sharded (below), which is what avoids a future cut once this finally runs — but not by default: at its ~31-minute local estimate the file would land in `test:lifecycle:rest` and push that shard to ~317 minutes, over the cap, so give it its own shard (or one with room) budgeted from its measured duration. **2026-09-26: now blocking CI.** On PR #15 the hosted runner cancelled `bootstrap-executor` at its 330-min and `lifecycle-v2` at its 185-min timeout (local: 122 and 153 min); the founder merged on the local full-suite evidence (`bc17550`). Shard both jobs in `.github/workflows/check.yml` (lifecycle by file, bootstrap by `-t` group) before the next PR. **2026-09-26: the CI half is done.** `bootstrap-executor` is a two-shard matrix by `-t` group (`test:bootstrap:main`, 54 cases, 225 min; `test:bootstrap:fine-grained`, 40 cases, 280 min) and `lifecycle-v2` a three-shard matrix by file (`test:lifecycle:uninstall`, 4 files, 206 min; `test:lifecycle:core`, 6 files, 201 min; `test:lifecycle:rest`, the other 11, 224 min), each budget ceil(local bound x 3) under the 300-minute cap, with `fail-fast: false`. `vitest list` per filter shows the shards partition the unsharded 94 and 208 tests exactly, by test id; `test:bootstrap`, `test:lifecycle`, `npm test` and `npm run check` are unchanged. The local bounds are conservative estimates, not green per-file measurements (`check.yml` names each figure's source), and PR #15 implies a hosted ratio of at least 2.7x against the formula's 3.0x ceiling, so lower or confirm each budget from the first green sharded run. **The row stays open for the round-trip half** (§7.1, post-A16, D42). |
| NEW-104 | A13 / founder, Codex real-agent matrix, after 2026-10-22 | **The Codex half of A13 is observed only on a mock model.** Task 15 shipped the Codex hooks under D57 (`4041286`..`2bec6a7`, tests green on `bc17550`) from observations against a local mock Responses API (`docs/architecture/hooks.md` §1), because the account's Codex quota is exhausted until 2026-10-22. The A13 plan closed on 2026-09-29 with this row owning its Task 18 Step 2 (`git show 343f8453:docs/superpowers/plans/2026-09-22-developer-os-hooks.md`): in a real Codex session, observe the product hooks **not** firing before manual trust, then after trust each supported row's effect — a planted `curl … \|` ⏎ `sh` not executed, a `.env` patch refused, `git push --force` refused, a type error preventing stop and the second stop allowed, the formatter changing the file, the project note in the first turn, a matching skill rule in context, the shared-file advisory — with a firing record afterwards and `doctor` reporting `plugin_hooks=yes` and `session_start_injection=yes`. Also confirm cwd-relative `apply_patch` resolution inside a git repository (phase 6 review m4; observed only outside git) and that the real model's `apply_patch` forms stay inside `hooks.md` §3.3's grammar (`*** End of File` and a blank line refuse). The Codex half of NEW-127's isolated-`ingest` check runs in the same session. Transcribe the results into `hooks.md` §4 and list any `unsupported (<reason>)` row for founder acceptance. |
| NEW-111 | Task 11b real-release gate · founder (A15/T14) | **Code complete 2026-10-08** (Task 11b, `plans/2026-10-07-task-11b-package-channel.md`, Tasks 1–13 reviewed READY): the launcher's closure and envelope readers replace both stubs and send no FD 3 (`7c612c3e`..`bbfb0450`); the CLI's FD 3 reader and the §4 signature/transport code are deleted (`db97b0c0`..`fddaaecf`); `update` plans and applies from the admitted keg (`4f7b82cf`, `5b7a73b7`). **Still owed (Task 14, founder):** the full `npm run check`, the brew gate in a fresh macOS VM (local tap clone, `brew install`, `init`, formula bump, `brew upgrade`, `update --apply`, `update rollback --apply`), then the F4 reinstall on the founder machine. |
| NEW-116 | ingest yield on long multi-decision captures / A15 step 12 (2026-09-29) | **Measured after the fixes (`72f0f5bf`, `30524da2`): 75 of 106 captures ingested; the last 31 were rejected by the founder.** They are long multi-decision session logs for which Claude keeps proposing one path twice in a proposal (`duplicate-path`) or a path outside the topic folders (`write-scope`); no pass after the third ingested any. Head-of-line blocking across runs remains (ordering needs a reserved state file). Close by splitting multi-decision captures before ingest, or by letting one proposal carry several notes under a shared prefix, and measure again. **D86 (5), 2026-10-06:** the founder re-runs `ingest` on the 31 refused captures after the next reinstall and reports the counts (NEW-141's attempt-order record now moves a refused capture behind untried ones); the row closes or narrows on those numbers. **2026-10-07:** NEW-199 (closed) removed a redaction false positive that refused ID-bearing note paths as `secret-scan` + `write-scope`; the re-run after the next reinstall also measures whether part of the 31 refusals shared that cause. |
| NEW-127 | A13 / founder, real Claude session and isolated `ingest` | **The Claude rows the A15 evidence did not reach, and the isolated-`ingest` check on both vendors.** The A13 plan's Task 18 closed on 2026-09-29 with Claude's firing, the `guard command` and `guard path` refusals (payloads fed directly) and session-start injection observed on the founder machine (`docs/architecture/hooks.md` §4.1). Still owed, each in a real Claude session: a `git push --force` refused; a type error that prevents stop, then the second stop allowed by the loop flag; the formatter changing a file; a matching skill rule appearing in context; a shared-file symlink edit yielding the advisory; `doctor --probe` reporting `plugin_hooks=yes`. And the plan's Task 18 Step 3: an isolated `ingest` on each vendor with the product hooks installed leaves no firing record and no injected content (`hooks.md` §3.5); **if either vendor fires them, the adapter's ingest argv is amended before anything else ships.** The Codex half runs with NEW-104, after 2026-10-22. Transcribe into `hooks.md` §4. |
| NEW-132 | update recovery sweeps / NEW-110 residual · startable (blockers closed 2026-10-07) | **The sweeps are now affordable but fail on real defects (2026-10-07).** The harness runs the three sweeps of `tests/integration/update/recovery.test.ts` with fsync stubbed out for the sweeps only (death points are counted on the guarded-fs wrappers, so the counts are unchanged: 2213 apply, 1480 rollback) and can shard them with `SWEEP_POINTS=<first>-<last>`; projected full durations fall from ~12 h / 1.5–2.7 h / 7.5 h to ~6.2 h / 0.45–0.75 h / 1.7 h (apply / rollback / rejected verifier). Copying a home instead of rebuilding it is unsound (`init` pins `dev`/`ino` of 46 retained files and ~226 tombstones), and the remaining rebuild cost is product code (NEW-197). Samples pass except at the defects NEW-195 and NEW-196 name. Shards start from a fresh home, so the apply sweep's reused-home state after a backward point is only exercised by a full run. Close by running all three sweeps to completion (sharded is fine, plus one full apply run) now that NEW-195, NEW-196 and NEW-198 are closed (2026-10-07; apply points 1295–1450 already pass sharded), before A16; the rejected sweep expects exit 1 only in the plan-only suffix (Spec 2 §13.3 residual 11). |
| NEW-75 | ingest isolation residual / founder, Codex half only | **An isolated vendor run still resolves its home through `getpwuid_r`, so it writes into the user's real home, and supplying a product-owned `HOME` is refused (D15, 2026-09-07)**: the resolution that strews `.claude.json`, `.claude/backups/` and `.claude/sessions/` files (observed 2026-09-05 against 2.1.261) is the one that finds each vendor's credentials. Closes only on each vendor's credential path supplied separately, plus one real authenticated `ingest` per vendor. **The Claude half closed 2026-09-28** (`3ebc505d`, `de0d4f8e`): the child gets `USER` and `LOGNAME` from the password database so the Keychain login resolves, and the first real Claude ingest ran on the founder machine in A15 step 12 (D75: tests written, full check owed). `HOME` stays refused, so the stray `~/.claude` files remain the accepted cost of Claude finding its own credentials (`vendor-invocation.md` Task 6). **Still open: Codex** — its credential path supplied separately and one real authenticated `ingest --agent codex`, a founder stop because it spends credits (Codex quota returns after 2026-10-22). Full detail in `docs/architecture/vendor-invocation.md`. |
| NEW-45 | founder credits | Whether a real `codex exec` turn ever emits more than one `agent_message` is the one question Codex source could not settle, and it is what the last-wins tie-break in `packages/adapter-codex/src/invoke.ts` rests on. Narrowed 2026-09-05: NEW-47 is closed from source — `TurnCompletedEvent` carries only `usage`, so there is no deterministic replacement to compare against — and the vendor's own `final_message_from_turn_items` picks the last agent message, which corroborates the tie-break without observing it. What remains needs one paid run likely to emit a post-answer summary; record the event count and order. |
| NEW-42 | human interactive sessions | Run `developer-os capture` inside both vendors' TUIs with parent markers stripped; record the child environment in `knowledge-pipeline.md` §10. |
| NEW-27 | first production write scope | Screen the external scope name and the product-derived path separately before wiring a real write scope. |
| NEW-28 | ingest coverage | Add an injection seam or end-to-end case for the retained screening-refusal branch when a production argument can reach it. |
| NEW-7 | founder / Obsidian | Verify `%` and control/format-character percent-encoded local links in Obsidian; if they fail, reject those paths at lint time. |
| NEW-169 | P2 · automation · founder step (disposable macOS account) | **Code done 2026-10-07: `automation status` shows launchd's non-zero last exit (`159e6fbf`, `a97e663f`) and `doctor` fails an `automation` check on it (`5fc6d9c6`; reviewed READY).** Still owed, a founder step on the NEW-138 disposable gate account (a fixture home cannot stand in: the production CLI takes the home from the account record): `init --yes`; `automation enable --schedule doctor=weekly@mon,03:00 --apply`; `launchctl kickstart gui/$(id -u)/<doctor label>`; then `launchctl print` reports `runs = 1` and `last exit code = 0`, `state/automation-doctor.status.json` is non-empty, `automation status` shows no `launchd exit`, and `doctor` has no `automation` row; `automation disable --apply`. Then the same assertions join `tests/integration/launchd/path-bootstrap.pinned-host.test.ts` as a second disposable-host block. |
| NEW-183 | P3 · security (remainder) · founder action: add permission rule | **P3 cleanup, security package: the items the auto-mode permission classifier blocked.** The founder approved them on 2026-10-06, but an agent cannot do them until a permission rule is added to the founder's settings (**founder action: add permission rule**). SEC-1 packages/security/src/supervised-process.ts:30: `inheritedFds` passes any parent descriptor to FD 3 with no consumer since D82; delete the field, the FD 3 branch and the spread, narrow stdio to three, and fix its stale FD-3 comment. DEAD-6 packages/security/src/paths.ts:113 with SEC-2 and SEC-6 packages/security/src/system-executables.ts:139: `resolveOwnedPath`, async `recheckSystemExecutable`, `validateGitSyncPlan`, `bindShadowConfigToTemplate` are test-only; delete the unused exports with their barrel entries; keep `runSshBridge` marked dormant. SEC-5 packages/security/src/paths.ts: the `resolveOwnedPath` docstring says every transaction guard must call it; none does, so correct it to point at `resolveContainedRoot`/`assertRootsAnchored` (or delete the function with DEAD-6). FLOW-UPD-6 packages/security/src/update/index.ts:19: the update barrel re-exports values no consumer can reach; remove them. Validation: lint and the security suite. |
| NEW-193 | P3 · founder observation, after 2026-10-22 | **Narrowed 2026-10-07 again: (2a) and (6) are done; only (4) remains.** (2a) the citations gate now requires every cited range on a line to hold one of its identifiers, with no anchor bypass (founder decision 2026-10-07; `8da6adc1`, `425985ed`), 107 citations repaired, the audit's 7 stale ones re-pointed with fixed-in markers (`a9d2c0ed`, `a8617f71`); (6) Spec 1's lease statements and derived counts amended to the six-job registry (`f5611a4a`, `58a9a3d3`). All reviewed READY. (4) The Codex `subagents` probe still reports `unknown`: no admissible evidence is checked in; it needs a redacted `codex exec` request-body recording (or any vendor CLI output) that lists the `developer-os-*` roles (founder observation, after 2026-10-22, with NEW-104). Validation: the probe reports a determined value from the recording. |
| NEW-201 | P3 · Task 11b follow-up (2026-10-08) · founder (lockfile) | `apps/launcher` still declares `@developer-os/security` but imports nothing from it; removing it changes `pnpm-lock.yaml`, which needs founder approval. Items (2)–(5) closed 2026-10-08 (`32bf4af4`..`e340e97e`). Validation: the dependency removed and `pnpm install --frozen-lockfile` plus `tsc -b` green. |
| NEW-203 | P3 · update re-anchor residual (2026-10-08, security review LOW) | `update --apply` and `update rollback --apply` re-anchor `state/manifest-anchor.json` after the verifier finalizes (`62c92be8`). A crash in the window after the finalized/compacting rewrites and before the anchor write, followed by a second crash in recovery, leaves the anchor stale, so `init` and `doctor` refuse exit 6 until the manifest is re-anchored. Availability only: no trust is widened. Validation: recovery re-anchors when it finds a finalized journal with a stale anchor, with a test, or recorded as accepted. |
| NEW-204 | P2 · launchd Node path (2026-10-08, NEW-200 C3 class) | The launchd plists name Node through `stableNodePath(process.execPath)` (`apps/cli/src/commands/automation/service.ts` — `stableNodePath`), which on a `package-channel` home is the active release's bundled Node: an update's retirement or a rollback can leave an enabled job naming a removed binary, the defect C3 fixed for hooks. Fix: plists name the K2 table's `opt` Node as hooks do (`hookNodePath`), proven by an update-then-retire test. Validation: that test, and the VM gate's `automation status` after `update --apply`. |

## 2. Foundation residuals

- [ ] Decide whether `SpawnLockfRunner` needs a watchdog around its non-blocking `lockf` call. This
  blocks nothing and belongs to the founder.

## 3. Missing specs, plans, and implementations

### A11 · DOS-P7

- [ ] Finish remaining update/release work and close the full Task 7 checkpoint: Task 11b (parked,
  D46; NEW-111, NEW-112, NEW-118). NEW-113's Task 5 was skipped by D76.

Required behavior:

- Git and automation are disabled and effect-free by default.
- Preview is deterministic and byte-inert; apply revalidates a bound preview before allocation.
- Git, launchd, update, and post-handoff lifecycle compaction follow active Spec 1. Bootstrap
  compensation/recovery uses durable same-parent retention and never unlink/rmdir.
- Update refuses drift. Uninstall removes manifest-owned artifacts plus the exact redaction-key path
  while preserving the Brain, unrelated agent configuration, and every retained bootstrap
  plan/journal/tombstone; it reports retained evidence and leaves the product home in place.

### A13 · DOS-P11

- [ ] Founder stops only: NEW-104 (Codex real-agent matrix, after 2026-10-22) and NEW-127 (Claude's
  unobserved rows, isolated `ingest`). The plan closed 2026-09-29; its surviving constraints are in
  `docs/architecture/hooks.md`.

### A14 · DOS-P12

- [ ] Keep the boundary with A11 explicit: A11 owns when scheduled work runs; A14 owns what it runs.

## 4. Program Tasks 8–9 and external blockers

### A15 · DOS-P8

- The dedicated plan is `docs/migration/founder-cutover.md` (written 2026-09-23, `974376a`,
  `3bb435e`; D58 `c613db7`).
- [ ] Founder decision: program Task 8 also lists `founder-baseline-results.json`,
  `founder-shadow-results.json` and `founder-cutover-manifest.json`; the runbook writes nothing from
  the machine back into the repository, and D58 leaves the shadow results without content. Create
  them or record that the runbook replaces them.
- [ ] Keep the vault in place, preserve recovery data, never enable two copies of a mutating hook,
  and exercise rollback before declaring cutover stable.
- [ ] Founder decision 2026-09-04: migrate the founder's vault once, by hand with a throwaway script
  reviewed as a diff on a copy, using the mapping in `docs/migration/instruction-inventory.md` §8;
  `BRAIN_MIGRATIONS` stays empty. Then `import` the accumulated inbox in batches.
- [ ] The legacy runtime stays untouched until this entry (founder decision 2026-09-04, risk
  accepted): product hooks restore its guards at cutover; afterwards boot out the legacy scheduled
  jobs, remove the legacy import block, the legacy plugin on both vendors, dead symlinks and
  orphaned generated agents. Archive the legacy repositories after one stable cycle; never delete.
- [ ] The program plan's Task 8 steps (moved here by D89; two were withdrawn by D58 — the runbook's
  disposable-home rehearsal (step 7c), per-adapter gate cycle (step 16) and exercised rollback
  (step 18) replace the separate shadow quarantine and the old-versus-new capture comparison):
  - [ ] Run read-only `developer-os doctor` against the founder's vault and record redacted findings.
  - [ ] Validate legacy topic aliases, schema, indexes, permissions, and protected paths.
  - [ ] Cut over Claude first while preserving a one-command rollback manifest.
  - [ ] Complete a full Claude capture/review/ingest/retrieval cycle and review the diff.
  - [ ] Cut over Codex and repeat the lifecycle.
  - [ ] Enable optional Git and `launchd` only if their explicit plans match the approved local policy.
  - [ ] Disable legacy hooks/jobs only after new evidence passes; do not delete them.
  - [ ] Exercise rollback once before declaring cutover complete.
- Test (program Task 8): no duplicate hook writes occur during shadow mode; existing Brain bytes
  remain unchanged until an accepted, validated ingest transaction; each adapter completes the same
  outcome contract; rollback restores the legacy runtime while preserving post-cutover Brain changes;
  independent review compares working tree, installed manifests, hooks, jobs, and actual command
  evidence.
- Checkpoint: the founder uses Developer OS as the primary runtime for one complete stable cycle;
  legacy repositories remain recoverable.

### A16 · DOS-P9

- [ ] Decide whether publication receives a dedicated plan.
- [ ] Create public documentation, approved license, release workflows, Homebrew formula, and Apple
  Silicon/Intel packaging from Task 9.
- [ ] Run the whole-history secret audit, clean-account matrix, closed beta, and reproducibility
  gates.
- [ ] The program plan's Task 9 steps (moved here by D89). Outbound publication remains a founder
  action.
  - [ ] Obtain qualified legal approval for the exact OSI-approved license and commit the approved text.
  - [ ] Run a fresh secret/history audit of the complete public branch.
  - [ ] Produce self-contained Apple Silicon and Intel artifacts with pinned bundled runtime.
  - [ ] Generate SHA-256 checksums, SBOM, changelog, schema versions, capability matrix, and rollback
    instructions.
  - [ ] Test Claude-only, Codex-only, and dual-agent tutorials on clean temporary macOS accounts.
  - [ ] Run a closed beta with synthetic or participant-owned vaults; collect only explicit
    user-reported issues because telemetry does not exist.
  - [ ] Fix release blockers through normal specs/plans and rerun the full matrix.
  - [ ] Publish repository visibility, GitHub Release, and Homebrew formula only after explicit
    founder approval.
- Files (program Task 9): `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, the approved
  `LICENSE`; `docs/install/`, `docs/tutorials/`, `docs/troubleshooting/`, `docs/releases/`,
  `docs/privacy.md`; `.github/workflows/release.yml` and the Homebrew formula source; Apple Silicon and
  Intel packaging configuration.
- Test (program Task 9): a fresh installation completes `install -> init -> capture -> review ->
  ingest -> search -> update -> uninstall` without Brain loss; all unit, contract, integration, E2E,
  security, generated-drift, packaging, and clean-account tests pass; public history and artifacts
  contain no secret or private Brain fixture; release checksums verify and a modified artifact is
  rejected; documentation accurately describes every capability difference and network action.
- Checkpoint: `v1.0.0` is public and reproducible; legacy repositories may be archived but not deleted.
- Program verification matrix (moved by D89):

  | Gate | Command or evidence | Blocks |
  |---|---|---|
  | Historical secrets | founder rotation/log-review record with no secret values (waived as a blocker 2026-07-21; copying secret-bearing history stays forbidden) | public visibility |
  | Repository validation | `npm run check` | every release |
  | Generated artifacts | clean regeneration diff | adapter commits, release |
  | Security | sentinel, path, prompt-injection, transaction, network suites | release |
  | Agent compatibility | disposable real-agent matrix | founder cutover, release |
  | Migration | exercised rollback (D58) | public beta |
  | License | approved OSI license text reviewed by qualified counsel | public visibility, release |
  | Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

- Program completion criteria (moved by D89): the program is complete only when A15's and A16's
  checkpoints pass, the founder has used the migrated system through a complete stable cycle, public
  artifacts reproduce from source, and `v1.0.0` meets every acceptance criterion in the approved
  design (`specs/2026-07-21-developer-os-design.md`). Archiving legacy repositories is optional
  cleanup after completion; deleting them is outside the program.

### Long-lead and external

- [ ] L1 — obtain qualified legal approval for the exact OSI-approved license text before A16.
- [ ] L2 — verify remote rules, PR flow, CI, and release permissions from an environment that can
  read GitHub CLI configuration; required before A15/A16 completion.
- [ ] Recount and opportunistically migrate deprecated `dev/active/` and `.claude/plans/` files in
  other repositories only when that cross-repository cleanup is explicitly taken up.

## 5. Gate-integrity work

- [ ] **A green local `npm run check` is not evidence about CI, and 2026-09-07 proved it costs a
  three-hour round trip to learn that.** The local gate is an `&&` chain beginning with `lint`,
  which is `tsc -b`, so every `packages/*/dist` exists before any test runs. CI splits into five
  jobs with no shared filesystem, so a job without its own `Build` step runs in an environment the
  local gate never reproduces. Run 34119837698 killed `bootstrap-executor` in 718 ms on
  `Failed to resolve entry for package "@developer-os/adapter-codex"`, a resolution the local gate
  cannot fail, and a reviewer had checked the same removal by running the suite locally and watching
  it pass. Fixed twice in `42bedea` — the missing alias restored, and the job given the `Build` step
  the other four already had. What is still open is the gap itself: nothing local reproduces a CI
  job's environment, and nothing warns when a workspace package is imported under `apps/cli/src`
  without an alias in `apps/cli/vitest.config.ts`. A repository gate asserting that alias list is
  complete would have caught this in under a second.
  **A second, sharper instance the same day, and that one was a shipped product defect rather than a
  test-harness gap.** `RENAME_FLAGS` in `packages/platform-macos/src/retained-rename.ts` was `0x34`
  — `RENAME_EXCL | RENAME_NOFOLLOW_ANY` plus an undefined `0x20` bit no header defines. Darwin
  25.6.0 ignores it; Darwin 24.6.0 rejects the whole call, so every retained rename refused on
  macOS 15, through `BOOTSTRAP_RETAINED_RENAME` on the real CLI path. It was invisible to every
  local gate this program has ever run, because the development laptop runs the newer kernel. Fixed
  2026-09-07; run 34157357126 measured 0x34 failing and 0x14 succeeding on Darwin 24.6.0. The
  generalisation: a single-machine gate cannot see a *kernel version* difference any more than it
  can see a per-job CI environment, and this product supports an OS nobody develops on.
- [ ] Always retain a complete full-suite failure log; do not pipe a unique failure only through
  `tail`.
- [ ] Build a triaged whole-history publication scan before A16; a raw whole-tree scan has known
  false positives in hashes and documentation examples.

## 6. Phase-close handoffs

Recorded by the orchestrator from the 2026-09-23 implementers' reports and from the fix sessions after
the 2026-09-25 whole-phase reviews. The phase closes ran on 2026-09-26; these items were deferred by
them and are still open. The owner is named per heading; an item that is a real defect gets a failing
test first. Closed items leave this section with the commit or decision that closed them (2026-09-26:
the Phase 6 C1 fix, Phase 9 I2/I3 and I4 as residual 11, the Phase 8 blockers (a)–(e), the `oe`/`rb`
prefixes and the duplicate journal-path helper that closure Tasks 1–8 closed, the stale export pins,
and the full `check` on HEAD; 2026-09-29: Phase 6's first-token bypasses of review M1, ruled by D67
in `d157227..28cfe19`, and m4 plus the mock-only `apply_patch` grammar, moved into NEW-104;
2026-10-03: Phase 6's review M4 remainder, closed by NEW-139's bounded exit, `c80971ab`..`a96c6275`,
`docs/architecture/hooks.md` §3.6).

### Phase 4b · A11 (release plan, with Task 11b; plan closed 2026-09-26, see NEW-111)

- Launcher exit (phase 4b review M3, deferred): nothing forwards SIGTERM/SIGHUP to the child
  (`apps/launcher/src/handoff.ts`, `execAdmittedRelease`). The FD 3 EPIPE and the percent-encoded
  `.pathname` fallback location were removed with FD 3 and the table-driven keg fallback by Task 11b
  Task 12 (`7c612c3e`, 2026-10-07). The 128-plus-signal exit is fixed (`e29711e`).
- Spec 2 §4.2 "no extra inherited FD", founder to confirm the reading: the child cannot tell
  inherited descriptors from the 4–11 libuv opens, so the guarantee moved to the launcher's `stdio`
  array (test `hands the child no descriptor beyond stdio and FD 3`). If §4.2 means an in-process
  descriptor-set check, it is unimplementable as written and needs an amendment.

### Phase 5b · A12b (A12b plan remainder)

- Workflow versions (review M7): closed by `a71cc629` (D84 (4)).
- `knowledge-pipeline.md` §§1, 3, 5, 7 (the Task 16 amendments) were not reviewed.

### Phase 6 · A13 (plan closed 2026-09-29; the real-agent rows are NEW-104 and NEW-127)

- m1: legacy per-event firing records are never cleaned before uninstall and count against the
  32-child cap; stays open by D62 (`docs/architecture/hooks.md` §3.6).

### Phase 7 · A14 (no phase; startable)

- Review M3: `project init` departs from the codebase's pattern with no observable failure,
  because its path-overlap check already refuses the dangerous case, so no red test exists.
- Review M4b: a race that fails closed (exit 5); a test needs filesystem fault injection.
- Review M5: a wording change to the A14 contract, now `docs/architecture/foundation.md` §13 (the
  tooling-verbs spec retired 2026-09-29); its text did not reach this handoff.

### Phase 8 · Spec 2 apply (NEW-110 closed 2026-09-29; what remains travels with Task 11b, NEW-111)

- Graph gate entrypoint is provisional `packages/core/dist/update/planner.js` until the packer emits
  the planner bundle.
- Task 17: `UpdateFoundationParticipantRefV2` (local in `migrations.ts`) and bootstrap's
  `FoundationParticipantRefV2` cannot alias and are not unified; the Core `migrations.js` planner is
  not in `PLANNER_ENTRYPOINTS`.
- Task 18: `ImmutableUpdatePlanRefV1`, `UpdateLeafPlanKindV1` and `UpdateInitialJournalRefV1` are
  local in `construction.ts`; `deriveUpdateRecoveryExecutorStagedPath` in `paths.ts` diverges from
  the spec's `{initial,terminal}.json`.
- Phase 8 review M2: memory use only; every input is written by the product or the same user.
  M3 and M4 were deferred without a description in this handoff.

### Phase 9 · plan 1b Git and launchd (closed; NEW-113's Task 5 host gate skipped by D76)

- The trampoline's reported `ppid` is not bound to the parent PID in the permit, because the permit
  carries no PIDs.
- Verification gap (NEW-113's Task 5 skipped by D76): a real push through `/usr/bin/git` ran only in
  `test:pinned-host` (green on `5a7462a9`), not on a disposable account; hostile config and redirect
  cases are only indirectly proven; the trampoline environment is compared exactly and is verified
  there.
- Plan 1b Task 5: filenames with tab/LF/CR in scope refuse (spec §7 row 30 tension).
- Plan 1b Task 8: `stagingChildren` omit unpublished `.git` contents in `post/<i>` (the ledger rejects
  them while staged).
- Plan 1b Task 12: the 30 s budget is enforced in the executor, not the observer; a crash between
  snapshot create and unlink leaves a linked snapshot and reads recovery-required.
- Plan 1b Task 15: sync needs `[user]` in the Brain's `.git/config`; the staging cleanup fix has no
  test of its own.

## 7. Standing gates

Product constraints:

- Git and launchd are opt-in and perform no hidden process, network, or Brain effect while disabled.
- Redact before truncating, hashing, logging, persistence, publication, or model input.
- Every filesystem mutation follows `plan → backup → stage → validate → apply → verify → finalize`.
- Fixtures are synthetic unless a task explicitly requires a redacted vendor recording.
- Build work does not read the founder's legacy runtime; A15 is the only live-machine cutover.
- Approved specs are not silently rewritten.

Per code-producing commit:

| Gate | Evidence |
|---|---|
| Repository validation | `npm run lint` per commit; `npm run check` (`lint`, tests, build, `git diff --check`) at plan close, or at a phase close that closes no plan (D17, D32) |
| Focused verification | fast commands named by the active plan step; slow suites deferred to plan close except the task's own cases, filtered with `-t` (D32) |
| Fresh-context review | reviewer did not author the task |
| Exact-path staging | explicit task-owned paths; never `git add -A`, `git add .`, or a wildcard |
| Generated artifacts | clean regeneration diff for adapter/workflow changes |
| Security | relevant sentinel, path, prompt-injection, transaction, and network suites, at plan close and on CI (D32) |
| Publication | triaged history scan, license, packaging, checksums, SBOM, clean-account install |
| Remote delivery | every task commit pushed to `development` when no CI run is in progress there, otherwise with the next push; no new commit while the latest completed run is red (D17) |

## 8. Active contract index

This is an inbound-reference index, not completed backlog history. Current sources of truth:

- Foundation lifecycle, manifest, external-effect, and recovery constraints:
  `docs/architecture/foundation.md`, `foundation-constraints.md`, and active Spec 1.
- Knowledge-pipeline redaction, capture, uninstall-key, and publishing constraints:
  `docs/architecture/knowledge-pipeline.md` and `threat-model.md`.
- Adapter capability and hook constraints: `claude-adapter.md` and `codex-adapter.md`.
- Remote/publication boundary: `docs/migration/exclusion-policy.md`, `SESSION.md`, and §7 above.
- Task 11b (A11b): `plans/2026-10-07-task-11b-package-channel.md` (14 tasks, approved 2026-10-07 with D96's answers; executing).
- NEW-200 plan: `plans/2026-10-08-new-200-active-release-refresh.md` (7 tasks, approved 2026-10-08 with decisions C1–C3; Tasks 1–6 and the Task 7 docs done, Task 7 Step 1 suites run with Task 11b Task 14).
- A16 plan: `plans/2026-10-08-a16-release-publication.md` (11 tasks, approved 2026-10-08; T1–T10 executing, T11 founder with L1/L2).
- Release publication (A16): `specs/2026-10-07-developer-os-release-publication-design.md` (approved by the founder
  2026-10-07); the update side is Spec 2's Task 11b block (K1–K6).
