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
   Confirm its status record and captures (the `off` wording is done), then close the plan
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
- NEW-146 (two shapes still exempt from high-entropy redaction; fix or accept).

From the 2026-10-05 audit (folded 2026-10-06, `BACKLOG.md` §1), P1 first:

- NEW-147 (P1: `update` aborts with exit 134 when no FD 3 trust pipe was passed).
- NEW-148 (P1: an admitted-lock bootstrap plan wedges after an early failure).
- NEW-149 (P1: `compensate()` cannot resume a recorded `payloadRetentionPart`).
- NEW-150 (P2: a failing `doctor` drops its report), with NEW-155 (instruction lines never rendered).
- NEW-151 (P2: a Foundation participant failing mid-apply strands the coordinator).
- NEW-152 (P2: containment misreads a child named `..x`).
- NEW-153 (P2: the no-LF domain hash is copied in six files).
- NEW-154 (P2: protected names match case-sensitively on APFS; reproduce first).
- NEW-156, NEW-157 (P2: adapter notes and `knowledge-pipeline.md` still say hooks are unshipped; docs only).
- NEW-158 (P2: firing records never reach the capability matrix; land before NEW-104 and NEW-127).
- NEW-159 (P2: SessionStart injection skips the user's redaction patterns).
- NEW-160, NEW-170 (P2: doctor and `status` are blind to interrupted V2 coordinators; one shared survey).
- NEW-161 (P2: `uninstall --yes` detaches before the refusals).
- NEW-162 (P2: update recovery resumes the other operation's coordinator).
- NEW-165 (P2: the review contract has no `id` input).
- NEW-166, NEW-167 (P2: bootstrap compensation from `create_intent` and after a rename).
- NEW-168 (P2: rollback leaves the Codex registration `stale`).
- NEW-169 (P2: launchd's exit status is never read; carries the P0's host check).
- NEW-172 (P2: `exactStepListHash` is never compared at rollback).
- NEW-173 (P2: scratch recovery cleans a concurrent process's live attempt).
- NEW-174 (P2: `repair` re-inodes a bootstrap Foundation journal).
- NEW-175 (P2: uninstall partitions a stale admitted manifest).
- NEW-176..NEW-188 (P3 cleanup, one row per area; each lists its own items).

Decided by D84 (2026-10-05), next design work:

- Task 11b (NEW-111, NEW-112, NEW-118) — re-scoped: trust a distribution channel instead of an
  offline root key; needs a Spec 2 amendment, then the A16 spec and plan (D84 (1), (2)).

Wave 1 of D83/D84 is integrated (2026-10-06): NEW-143, NEW-120, NEW-130, NEW-40, NEW-33, NEW-121,
NEW-35, workflow versions, the Spec 2 §4.2 amendment, one retention walk and status `off`
(the wording half of NEW-134; its real garden run stays owed).

Needs a founder decision (2026-10-06, from the audit; NEW-145 was accepted by D85):

- NEW-163 (P2: the version-free entrypoint never follows an update; choose re-render per plan or
  read `active-release.json` at run time; with the D84 re-scope of Task 11b).
- NEW-164 (P2: thin commands shadow five skills' descriptions; reverses the recorded thin-command
  decision).
- NEW-171 (P2: no planner arm for instruction rows; Spec 2 planner protocol, latent until Task 11b).
- Items inside P3 rows: FLOW-INIT-2 in NEW-177 (reopens NEW-139's deliberate bound), W2-BUNDLE-1 in
  NEW-181 (changes `previewHash`), BRAIN-3 in NEW-185 (garden `fix`: finish or remove), RENDER-3 and
  FLOW-DOCS-3 in NEW-186 (`subagents` not-used; the `scheduled` trigger model), and DEAD-8 in NEW-188
  (a dependency install). The rest of those rows is startable.

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
- Startable rows: 46 (7 earlier, 39 from the audit: 3 P1, 23 P2, 13 P3 area rows). Founder
  decisions: 3 rows (NEW-163, NEW-164, NEW-171) and 6 items inside P3 rows.
- Repository backlog: 62 open numbered rows (`BACKLOG.md` §1), plus the §6 phase-close deferrals.
