# Developer OS Completion Roadmap

> **For agentic workers:** This is a sequencing plan, not an implementation plan. Each phase below names the spec or implementation plan that must exist before code is written for it; execute those through `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development`, as `SESSION.md` requires. Phase checkboxes are ticked only when the named plan closes.

**Goal:** Finish Developer OS to the point where the founder runs it as the only agent runtime and the legacy shared-instruction repository, the legacy vault tooling, and the legacy plugin are retired.

**Architecture:** The engine (transactions, manifest, redaction, quarantine, ingest, Brain index, both adapters) exists. What remains is the lifecycle (Spec 2 update/release, Spec 1 config/git/launchd), the instruction layer (A12), hooks (A13), tooling verbs (A14), Brain workflows (A12b), the cutover (A15) and release (A16). The order below is dictated by hard dependencies: nothing installs instruction artifacts before the manifest V2 handoff lands, and no cutover happens before the product replaces every legacy surface the founder uses daily.

Completed tasks were removed on 2026-09-23, 2026-09-24 and 2026-09-26; see git history. The phase closes of 4b, 5, 5b, 6, 7, 8 and 9 ran on 2026-09-25/26: full suite green on `bc17550`, one whole-phase review each with its findings fixed or recorded (D62–D64), PR #15 merged. What each phase still owes is listed under it.

**Tech Stack:** as in `docs/superpowers/plans/2026-07-21-developer-os-program.md`.

**Spec:** `docs/superpowers/specs/2026-07-21-developer-os-design.md` (umbrella), Spec 1 and Spec 2 as named per phase, `docs/migration/instruction-inventory.md` for the A12–A14 scope.

## Founder decisions of 2026-09-04

Recorded here because they change the program's sequence; the umbrella design's clauses they amend are named.

| # | Decision | Amends |
|---|---|---|
| D1 | Spec 2 §6.4: forward-participant content is never a retention row, for every terminal outcome; the global-lock admission rule of §6.1; the `admittedPreexistingPaths` plan grammar. Recorded as dated amendments in `specs/2026-08-28-developer-os-release-update-design.md` by `050fc0d`, `ddaea3e` and `9bd85bb`. | Spec 2 §6.1, §6.3, §6.4 |
| D2 | The uncommitted replacement Task 6 tree is committed as one checkpoint through six separately reviewed tasks. Done 2026-09-04, `050fc0d..c5022a7`. | — |
| D3 | The legacy runtime stays untouched until the cutover; its security guards return through product hooks (A13) at cutover time. Risk accepted: the legacy machine runs without pre-tool guards and without its weekly knowledge pipeline until then. | program plan Task 8 |
| D4 | The founder's vault is migrated once, by hand with a reviewed throwaway script; `BRAIN_MIGRATIONS` stays empty. Inbox files enter through a new `import` verb; `capture` → quarantine remains the only path into ingest. | design §12, §13 |
| D5 | Every legacy instruction artifact, hook and automation script becomes part of the product as a public, redacted default; personal overrides live in the product home as user data. No parallel private repository. | `BACKLOG.md` A12 ("mechanism and neutral defaults only") is widened |
| D6 | `session_start_injection` returns as a product hook (A13). | `docs/architecture/claude-adapter.md` §3, `codex-adapter.md` §3 (`not-used` → used) |
| D7 | Codex hooks are installed and trusted manually by the user; the product never writes the Codex config file. | `codex-adapter.md` §2 (unchanged), A13 acceptance |
| D8 | Ingest invokes the vendor with no tools: capture text plus a bounded index excerpt in the prompt, structured result out. Claude and Codex invocations are isolated from user settings, hooks, MCP servers, rules and history. | design §13.4, `BACKLOG.md` NEW-58 |
| D9 | Spec 1 is split: 1a (configuration mutability, lifecycle coordinator, drained uninstall) after Spec 2 Tasks 8–9; 1b (git, launchd) after the `launchctl` row is re-pinned to the current macOS and the suite fits CI. | Spec 1 §8.2 sequencing |
| D10 | CI: `test:suite` excludes `e2e/**`, the `suite` job builds first, `init` performance work precedes further A11 tasks, the unpushed commits are pushed only when all four jobs are green. | `BACKLOG.md` NEW-52, NEW-53 |
| D11 | The Brain gardening workflows (answer, compile, enhance, garden, report, retire, refactor) are product workflows (A12b). | design §21 (new subproject) |

## Founder decisions of 2026-09-07

Recorded here for the same reason the 2026-09-04 block is: each one changes what a later phase may
assume, and three of the four were open questions blocking a row rather than sequencing choices.

| # | Decision | Amends |
|---|---|---|
| D12 | The accumulated commits are pushed **directly to `development`**, not through a probe branch first. The `baseline` ruleset carries only `deletion` and `non_fast_forward`, so nothing gates the push; the trade accepted is that a red run is visible on the default branch rather than on a throwaway one. | D10's "the unpushed commits are pushed only when all four jobs are green" — the gating condition stands, the probe branch does not |
| D13 | Phase 2 closes **with its performance targets missed and the miss recorded**, not by moving the targets. The e2e case reached 141 s against a 60 s target and `executor.test.ts` 127.5 minutes against 10 minutes; the numbers and the reason are in `docs/architecture/foundation.md` §9. NEW-52, NEW-51 and NEW-59 close; NEW-53 is rewritten to the residual it actually leaves — roughly 126 minutes of real fsync-backed transactions this program never targeted; NEW-29 closes, because the eight timeouts were machine contention at load average 47 and do not reproduce on a quiet machine. | Phase 2's first checkbox, which states the two targets |
| D14 | **NEW-74 closed.** Codex is no longer given the vault's content root as `-C`; it receives an empty scratch directory, `join(tmpdir(), "developer-os-agent-workspace")`, whose absoluteness, ownership and mode are checked rather than assumed, and which is prepared on the Codex arm alone — fresh-context review found the first cut checked it before the vendor branch, which refused the *default* vendor over a directory a Claude run never opens. Recorded at the strength the evidence supports: `-C` decides what the agent is told to work in, while `-s read-only` bounds model-generated shell *writes*, not reads — so this narrows the asymmetry with Claude's `--tools ""` without eliminating it. | `docs/architecture/vendor-invocation.md`, new "Codex working root" section |
| D15 | **NEW-75 stays open, and the decision that would have closed it was withdrawn the same day.** The founder first chose to admit `HOME` so an isolated run would stop writing into the user's own home. Fresh-context review found the two halves are one mechanism, from evidence already in this repository: `codex exec --help` records that `--ignore-user-config` leaves auth on `$CODEX_HOME`, which derives from `$HOME`, and with `env: {}` the vendor resolves the user's real home through `getpwuid_r` — which is how it finds its credentials today. Supplying a product-owned `HOME` would move the credential lookup with it. Both adapters therefore keep `env: {}` and F2 stands. **NEW-75's closure condition is now explicit**: each vendor's credential path supplied separately, plus one real authenticated `ingest` per vendor proving it, which is a founder stop condition for model credits. | withdraws nothing already shipped; NEW-75's row in `BACKLOG.md` |


### Amendment to D13, 2026-09-07, same day

D13 is quoted above unchanged and its **decision** stands: Phase 2 closes with its two
performance targets missed and the miss recorded, rather than by moving the targets. One clause
of its *reasoning* is corrected, because it was measured after the decision was written and it
changes what the residual asks of whoever picks it up.

> "NEW-53 is rewritten to the residual it actually leaves — roughly 126 minutes of real
> fsync-backed transactions this program never targeted"

**"Real fsync-backed transactions" is wrong.** That remaining time is not durability, and calling
it durability turns a closable defect into an inherent cost — which is the practical effect the
sentence had. Evidence, gathered 2026-09-07 against the live gate and from numbers already in
this repository:

- CPU time advanced 20.30 s in a 20 s wall window on the running `test:suite` worker — a ratio of
  **1.01**. An fsync-bound process sits near 0.1-0.3.
- A 5 s stack sample held **zero** `fsync`, `F_FULLFSYNC` or `uv_fs_fsync` frames. The heaviest
  leaf frame was `node::encoding_binding::BindingData::EncodeUtf8String`, i.e.
  `encoder.encode(encodeCanonicalJson(value))` in `apps/cli/src/bootstrap/journal-store.ts`.
  `MarkCompact` appeared 109 times.
- `apps/cli/vitest.config.ts` already recorded that a real install writes its **73 files in about
  0.8 s**, and NEW-53 already recorded that one `init` costs **~101 s**. About 99% of an `init`
  was therefore never disk, and NEW-53's own profile names the rest: **91,052,556 canonical JSON
  key encodes** to write 73 files.

The pipeline does fsync, via `handle.sync()`; the time is not spent there. The same false claim
was standing in three places — `docs/architecture/foundation.md` §9,
`apps/cli/vitest.config.ts`, and D13's clause above — and all three are corrected as of
2026-09-07. NEW-53's residual is rewritten to the encoder cost and the headroom it implies rather
than to durability.

## Founder decisions of 2026-09-16

| # | Decision | Amends |
|---|---|---|
| D16 | **Daily use before completeness.** The founder cuts over (Phase 10) as soon as the product replaces every legacy surface used daily; update, rollback, Git, launchd and the public release follow the cutover. Execution order: 3 → 4 → 4b → 5 → 5b → 6 → 7 → 10 → 8 → 9 → 11. Phases 4 and 4b stay ahead of the cutover because a production V2 `init` needs them (Phase 4b). Accepted costs: until Phase 8 a new build reaches the founder machine only by reinstalling; until Phase 9 the retired legacy scheduled jobs run by hand. | the phase order below; release plan global constraint on Task 10 and Task 9 Step 5; `ORDER.md` A11, A15, A16 and new A11b; L2 no longer blocks A15 |
| D17 | **Per-commit gate: lint, focused tests, fresh review, push.** Every code-producing commit runs its focused commands and `npm run lint`, gets fresh-context review, and is pushed to `development` so CI runs all five jobs on it. A red run stops new commits until it is fixed; nobody waits for green to keep working. Because `check.yml` cancels a superseded run and a full run takes ~4 h, a commit made while a run is in progress is held and pushed with the next one (corrected the same day, after the first push under D17 cancelled the run before it). `npm run check` runs locally when a phase or plan closes. Reason: `npm test` alone takes ~2h50m locally, which capped the program at a few commits a day. The founder amended the matching global commit rule the same day. NEW-53 is not a lever here: `e436581` measured encoding at about a tenth of the bootstrap test's wall time. | `SESSION.md` §5, `BACKLOG.md` §7, both implementation plans' per-task `npm run check` clauses; D12's accepted trade (a red run visible on `development`) now applies per task |

## Founder decisions of 2026-09-17 and 2026-09-18

| # | Decision | Amends |
|---|---|---|
| D18 | **The V1→V2 manifest migration is withdrawn.** No V1 installation exists outside tests and disposable development homes — nothing is released, and the founder machine runs the legacy runtime, which Phase 10 replaces with a fresh V2 install. Executing Task 8's plan had surfaced four spec gaps in one day, the last blocking: the approved spec never says where a replaced V1 file goes, and the 2026-09-08 "exactly three projection rows" rule refuses every real migration. `init` over a V1 manifest now refuses (`manifest_v1_not_migratable`, exit 4) once the packaged capability exists, and the code of `55a06de`, `df3e947` and `8db8eb0` is reverted. Cost accepted: a pre-release V1 home must uninstall and re-init. | Spec 2 (dated amendment above §1, §6, §6.2, §6.3, §13.2); release plan Tasks 8–9; Phases 3 and 4b below; `BACKLOG.md` gains the dead Core `v1_to_v2` arm; Spec 1 and its plan through the NEW-67 amendment (added after the Phase 3 final review found D18 had not reached them) |
| D19 | **The release layout follows Spec 2 §3.2, not the shipped executor.** Fresh `init` writes release metadata to `releases/metadata/<packaged name>` and the rollback root to `state/rollback`; §3.2 fixes hash-derived `state/release-metadata/{delegations,indexes,bundles}/<hash>.json` and product-home `rollback`. Packaged names cannot hold the active and rollback identities' metadata side by side, and the launcher (Task 10) validates hash-derived paths. Moving the code is free while no V2 installation exists and an on-disk migration after Phase 4b. | NEW-80, owned by Phase 4b; NEW-67 derives its reservation set from §3.2 |
| D20 | **The V1 refusal's recovery becomes "developer-os uninstall, then archive the product home manually, then developer-os init".** The Phase 3 final review probed D18's "uninstall, then init" against the built CLI: V1 `uninstall` leaves `staging/`, `state/transactions` and `backups/`, and fresh V2 `init` refuses that residue with exit 6 and no next step. Admitting that residue in fresh `init` would change Spec 2 §6.1's external shape for a state D18 says no real installation is in. Corrects D18's accepted cost, which named only uninstall and re-init. | Spec 2 D18 amendment (dated sentence); NEW-79, owned by Phase 4b |
| D21 | **Retention replaces unlink/rmdir on the pre-product bootstrap paths only** (Spec 1 NEW-67 A2). Post-handoff §2.4 terminal compaction keeps guarded deletion, which keeps each journal root under 10,000 leaves while scheduled jobs run. This narrows Phase 4's original "retention replaces every unlink/rmdir/plan-last clause in §§2.3, 2.4, 6". | Spec 1 §2.3, §2.4, §6 |
| D22 | **Absent-manifest uninstall has no coordinator envelope** (Spec 1 NEW-67 A3). `key_absent` performs two identical read-only walks and creates nothing; `key_present` deletes the key under the bootstrap lock by rechecked identity. The recovery-only nonce/allocator epoch, flat plan/journal, creation temps and key-present coordinator row are withdrawn. | Spec 1 §2.1, §2.3, §2.4, §6, §7, §8 |
| D23 | **Uninstall leaves the global lock and the bookkeeping directories; fresh `init` admits them by shape** (Spec 1 NEW-67 A12). The set is `state/.lifecycle.lock`, the three journal roots, `state/transactions`, `staging/lifecycle`, `staging/transactions`, `backups/transactions`, `staging` and `backups`. It is never a manifest row. Revised the same day twice: unlinking the lock last left an unjournaled crash window, and binding leftovers to creation evidence failed for paths `init` never creates. Shape admission mirrors how shipped `init` already treats a leftover bootstrap leaf. | Spec 1 §2.1, §2.3, §6, §8.3; Spec 2 §6.1, §6.4 (dated) |
| D24 | **Present-manifest uninstall with no launchd evidence is its own closed variant** (plan 1a blocking question 1, option A; Spec 1 A14). `uninstall/present_manifest_without_launchd` is `F(uninstall_marker) · R · F(uninstall_artifacts) · K(stage) · M(preserve_before) · M(commit_absence) · K(delete) · M(finalize_tombstones)` with null launchd arms. It is derived, never chosen: exactly when the manifest owns no plist and neither the configuration's `automation.lifecycle` nor an active automation arm in the activation record exists. Otherwise the `P` variant stays as written, and plan 1a refuses it as `unsupported_until_plan_1b`. Reason: a spec-exact `P` needs the launchd plan types and a process table pinned to a macOS build the development machine no longer runs (NEW-84), all plan 1b. | Spec 1 §2.1, §2.2, §2.4, §5.3, §6, §7 |
| D25 | **`M(finalize_tombstones)` removes the uninstalled manifest's empty directories before it deletes the manifest tombstone** (blocking question 2, option A; Spec 1 A15). Removable partition only, deepest first, bookkeeping set excluded; recovery re-derives the list from the still-present hash-bound tombstone; a non-empty directory is preserved and reported. Reason: after terminal finalize nothing durable lists those directories, and an empty leftover makes both uninstall and fresh `init` refuse. | Spec 1 §2.4, §6 step 4, §7 |
| D26 | **The 256-mutation capacity of `F(uninstall_artifacts)` is decided at Phase 4b** (blocking question 3). Plan 1a ships only the pre-allocation refusal `uninstall_artifact_capacity_exceeded` (exit 4). A release bundle of more than about 197 files cannot be uninstalled until then; NEW-85 carries it. | plan 1a Task 22; Phase 4b below |
| D27 | **Absent-manifest uninstall applies Spec 1 §6 literally on every home** (blocking question 4). After a V1 `uninstall`, a home with leftover V1 Foundation residue refuses with exit 6 and D20's archive guidance; a second V1 `uninstall` no longer succeeds. No spec text changes. The tests pinning the old exit 0 are rewritten. | shipped second-`uninstall` behaviour pinned in `apps/cli/src/main.test.ts` and `tests/e2e/foundation.test.ts` |
| D28 | **The allocated `mf_` manifest participant ID is reserved last in a composite's contiguous ID block** (blocking question 5; Spec 1 A16), after every ID Spec 1 §2.4 already lists. Spec 2's shipped `ManifestStatePlanV1` requires an allocated `mf` ID that §2.4's order never named. | Spec 1 §2.4 |
| D29 | **NEW-80 moves from Phase 4b into plan 1a Task 1.** The exact-set pin plan 1a restores must pin D19's layout, which cannot pass before the code moves; moving it is free while no V2 installation exists. | D19's owner; NEW-80; Phase 4b below |
| D30 | **The unpinned identity of a shape-admitted bookkeeping directory is a Phase 4b residual, not a plan 1a fix.** `admittedPreexistingPaths` persists paths without `dev`/`ino`, so the admitted-shape branch of `foundationPublicationParent` resolves that parent at use time — as does the retained-parent authority above it, which `retentionRow` projects at inspection time. Plan 1a Task 2 moved exactly one parent, `state/transactions`, from creation-evidence-durable to use-time. The shape check ships as written; persisting admitted-path identities in the immutable plan is the close, beside NEW-81. | the new NEW-86 row, owned by Phase 4b; Spec 1 §8.3's residual list is unchanged, because the decision routes this to the backlog |
| D31 (2026-09-18) | **Every recorded filesystem identity is corrected to exact 64-bit stats inside plan 1a, not deferred to Phase 4b.** `lstat` without `{ bigint: true }` returns `ino` as a JavaScript number, and an APFS inode exceeds 2^53: `/tmp` measured `1152921500312571551n`, which `String(stats.ino)` renders `1152921500312571500`. The ULP at that magnitude is 128, so up to 128 distinct inodes collapse onto one recorded identity — including the held global-lock identity and the journal-slot identities the bootstrap executor compares. Spec 1 §2.4 forbids exactly this by name ("the same reopened device/inode/hash identity throughout recovery"). Found by Task 10's fresh-context review and reproduced twice on the development machine. 177 lines (225 occurrences) still render an identity through `String(<stats>.ino\|dev)` across `apps/cli/src` and `packages`, and the re-review confirmed the defect is already live and environment-gated: `journal-store.ts` renders slot identities from `BigIntStats` while `apps/cli/src/bootstrap/executor.ts:826` compares them against a number-valued `lstat`, so above 2^53 V2 bootstrap recovery refuses an unchanged slot and wedges; Task 10's `guarded-fs.ts` and `apps/cli/src/bootstrap/{context,journal-store,retention}.ts` already record identities exactly, so the fix removes the second encoding rather than adding a third. No on-disk migration: the fields are `UInt64DecimalV1` already, the two renderings agree below 2^53, and no V2 installation exists (D18, D19). | plan 1a gains **Task 10b**, which must land before Task 12 consumes the guarded port, inserted after Task 10 and numbered `10b` so no later task renumbers; plan 1a's task count becomes 26 (1–25 plus 10b); `docs/architecture/foundation-constraints.md` gains the one-encoding rule; nothing is added to Phase 4b |

## Founder decisions of 2026-09-19

| # | Decision | Amends |
|---|---|---|
| D32 | **Slow test commands run once, at plan close.** A task commit runs `npm run lint` and every fast command its steps name, unchanged. Deferred to the closing `npm run check`: any `npm run test…` or `npm run check` script, and any run of a slow file — `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, and everything under `tests/e2e`, `tests/security` and `tests/integration`. The exception keeps the founder's global commit rule satisfied: the cases a task itself adds or changes in a slow file still run, red then green, filtered with `-t` to those cases (after `npm run build` for `tests/`). A deferred step is ticked "deferred to plan close (D32)", never with invented output. `npm run check` runs once per plan close, and at a phase close that closes no plan (Phase 4b); the founder may run it by hand, and the plan does not close until it is green. CI still runs every job on each push, and a red run still stops new commits. Reason, measured 2026-09-19: plan 1a Task 11's focused set is 533 tests in 1 s and `npm run lint` 13 s, while `test:bootstrap` is 122.6 min, Task 24's round-trip file about 31 min and `check` about 3 h. Accepted cost: a regression in a deferred suite surfaces on CI or at plan close, not in the task that caused it. | D17; `SESSION.md` §5; `BACKLOG.md` §7; the per-task gate clause of all three implementation plans |
| D33 | **Plan tasks run in parallel where their declared inputs allow.** A task starts once every task on its `Consumes:` line is integrated on `development`; independent tasks run at the same time, each implemented by its own agent in a git worktree outside the repository — ESLint's flat config does not read `.gitignore`, so an in-repo worktree breaks `lint` — and reviewed by an agent that authored none of it. One orchestrating session owns integration: it cherry-picks each reviewed commit onto `development` in dependency order with no merge commit, takes the union of shared export lists, reruns `npm run lint` and the task's fast commands, ticks the plan, rewrites the `ORDER.md` progress line, and alone pushes under D17. Only the orchestrator edits `docs/superpowers/`. A backlog row `ORDER.md` lists as startable may run beside a wave when its files overlap no task in flight. Reason: the founder asked on 2026-09-19 to close the plans faster with several agents; plan 1a's remaining 14 tasks sit on a ten-wave critical path. | `SESSION.md` §4; plan 1a's per-task bookkeeping and wave table; D17's push, now single-writer |

## Phases

Sizes are S/M/L complexity. "Gate" is what must be true before the next phase starts.

**Execution order (D16):** 4b → 5 → 5b → 6 → 7 → 10 → 8 → 9 → 11, Phases 0–4 having closed.
Phase numbers are identifiers, not positions.

### Phase 4b — Spec 2 Tasks 10–11: launcher and offline trust, so V2 `init` runs in production · L

Added by D16 and pulled forward from Phase 8: without the launcher's root-verified handoff there is no production V2 `init`, and Phases 5–7 install V2 artifacts.

- **D44 (2026-09-22).** **Phase 4b's per-task lane: lint only, review deferred, one PR at phase
  close.** D36's implementation-first exemption expired with plan 1a and does not carry over, but two
  facts changed what §5/D17's restored per-task rule means in practice here. First, `development`'s
  ruleset gained a mandatory `pull_request` rule before 2026-09-22 (found pushing plan 1a's closure,
  `GH013`); a bare `git push origin development` is refused, so CI now runs per PR, not per local
  commit — `ORDER.md`'s "Delivery evidence still owed" records the finding. Second, the founder
  instructed twice in this session to skip `npm run check` and the deferred vitest suites, to run them
  manually at phase close — D36's own pattern, applied to a new phase. Lane: each task commit runs its
  fast/focused commands and `npm run lint` (build+typecheck, ~11s, kept per `security.md`'s fail-closed
  rule), is held locally without a push, and fresh-context review is owed but deferred to one
  whole-phase review at phase close alongside `npm run check` and the deferred slow suites. At close,
  commits are pushed to one branch and opened as one PR (as plan 1a's closure did, `#14`), not pushed
  directly. **Amended 2026-09-22 by the founder:** the focused/filtered test runs are skipped too —
  every Phase 4b commit (`d2cc737`, `c7bc459`, and the side track `6254586`) carries written but
  unrun tests; all of them run at phase close. Accepted risk: D36's — a defect in a consumed interface surfaces only after its consumers
  bind to it. **This decision expires when Phase 4b closes**; a later phase gets its own.
- **D46 (2026-09-22): the founder dropped release signing keys for now ("we don't need this
  functionality").** `LAUNCHER_OFFLINE_RELEASE_ROOTS` stays `[]`; Task 11b is parked because the FD 3
  payload carries only trust roots, not a packaged-release identity, and no production packaged-release
  layout exists. A12's spec settles the production install source. Original question:
  Stop and ask how the founder build is signed: which offline root key the launcher compiles in, and whether public releases reuse it. **Scoped 2026-09-22: this blocks the actual pin removal, not Tasks 10–11's TDD implementation** — `verifySignedReleaseDocument(document, key)` takes the key as a parameter and Task 11's own tests are written against a fixture (`vector.currentRoot`), so both tasks proceed now on test keys; ask before compiling a real launcher for the founder machine.
- **D45 (2026-09-22).** Settled the capacity of `F(uninstall_artifacts)` (D26, NEW-85):
  **repeat the step, up to 31 forward/compensation pairs — not a Spec 2 §4.4 file-count cap.**
  Measured before deciding: `pnpm build`'s raw `tsc` output across the 8 workspace packages is 634
  files, already more than 3× the ≤197 a cap would need, and no bundler exists in this codebase or
  its approved specs to get there without adding one as unplanned scope. Repeating the step needs no
  spec amendment (D26 already named it as an option) and clears 634 with wide margin (7,936-mutation
  ceiling). Implementation (the loop in `apps/cli/src/lifecycle/uninstall.ts`) is still owed —
  `BACKLOG.md` NEW-85. Plan 1a ships only the pre-allocation refusal.
- Code landed (Task 10 `1e214ce`, Task 11 `3f640b3`, NEW-79 `503e907`, NEW-81 `7e6e641`, NEW-85
  `d2cc737`, launcher trust-fd fix `c7bc459`, side track NEW-49 `6254586`) and the phase close ran.
  Task 11b (`plans/2026-08-29-developer-os-release-update.md`) stays parked by D46, so the production
  gate below waits on it; until then A12's unsigned local build is the install source.

Gate: on a disposable home, a fresh `init` runs the V2 path in production through the launcher, and `init` over a V1 home refuses.

### Phase 5 — A12: instruction artifacts · L

- **D47 (2026-09-22).** Specs A12, A12b, A13 and A14 (`specs/2026-09-22-developer-os-{instruction-artifacts,brain-workflows,hooks,tooling-verbs}-design.md`)
  approved with every recommended answer, except A12 Q1: no production for now — local unsigned build
  only, no release path. Also decided: Spec 1 §1 holds — `import` and `ingest` stay manual and leave
  Phase 9's job registry. The D44 lane (lint per commit, tests and review at phase close, no push)
  applies to Phases 5–7 as well, on the founder's instruction to skip tests for now.
- **D48 (2026-09-22).** Vendor observations re-pin to the installed Claude Code 2.1.280 and Codex CLI
  0.155.1 (A12 Task 2 found them instead of the pinned 2.1.260 / 0.151.0). The billed real-agent row is
  deferred to `BACKLOG.md`; until it passes, the Claude categories held in `UNPROVEN_CLAUDE_CATEGORIES`
  stay unproven.
- **D49 (2026-09-22).** A fresh `init` admits a *preexisting* planned parent (e.g. the user's home at
  macOS's default 0750) when it is a real directory owned by the effective uid with no group/other write
  bit (`mode & 0o022 === 0`). Directories the product creates stay exactly 0700. Found by A12 Task 4:
  `assertPlannedParent` refused the founder's 0750 home.
- **D50 (2026-09-22).** The founder decided to ship `react-best-practices` as a redacted default with
  its upstream license file and attribution vendored beside it; the L1 redistribution question for this
  one artifact is accepted by the founder without a separate license review. Legacy instruction text
  reaches agents only through a founder-made copy in a session staging directory outside the
  repository (spec §3.3 clean room); no agent opens a legacy path.
- **D51 (2026-09-22), supersedes D50's first half.** Third-party-derived skills are **not** vendored:
  `react-best-practices` (upstream `vercel-labs/agent-skills`), `claudeception` (upstream
  `blader/Claudeception`), `excalidraw-diagram` (upstream `coleam00/excalidraw-diagram-skill`) and the
  `research*` family (origin unverified). The product documents the upstream skills as recommended
  third-party installs; the founder's modified copies stay local as user overrides under
  `<product-home>/instructions/<vendor>/skills/` (moved at A15). Removing attribution from derived text
  is not an option. Also decided: the three lazy rules added after the inventory froze (`comments`,
  `testing`, `lessons-code`) ship as scoped-rule defaults, and the four artifacts disabled in the
  legacy runtime (`release`, `rev-eng`, `wrap-up`, `brain-search`) are refused.
- **D52 (2026-09-22).** NEW-102 (Codex ingest isolation, D8): `ingest` runs Codex with its own
  `CODEX_HOME` under product state that holds no `AGENTS.md`, no `agents/` and no plugins — only the
  credential entry needed to authenticate, linked from the user's resolved Codex home (never read or
  copied by the product). Credential handling is shared with NEW-75.
- **D53 (2026-09-22).** The local release is launchable: `pack:local-release` packs the compiled CLI,
  the workspace packages' runtime `dist` and their third-party runtime dependencies into the bundle,
  and `init` writes one product-owned, version-free entrypoint `<product-home>/bin/developer-os.mjs`
  that loads the active release. Hooks (A13 G1) run `<node> <product-home>/bin/developer-os.mjs`; the
  founder runs the same file. Found by A13 Task 14: the bundle held only a refusing stub.
- **D54 (2026-09-23).** A re-run `init` refused with exit 6 whenever a committed gated transaction had
  moved the manifest past the bootstrap plan's recorded hash (`exactV2Handoff`). The evidence
  classifier treats a finalized bootstrap envelope as superseded when the current manifest hash equals
  a durable anchor (`state/manifest-anchor`) that the mutation gate writes after every committed
  manifest-writing transaction, before compaction; the ledger itself is compacted, so it cannot carry
  the proof. A hand-edited manifest still refuses with exit 6.
- **D55 (2026-09-23).** The launchable CLI is bundled with `esbuild` (root devDependency) into a single
  module plus third-party license files, so fresh `init` retains a handful of files instead of ~500
  (measured 63 min vs ~11 min).
- **D56 (2026-09-23), amends D16's order.** The founder runs two tracks at once: the A15 cutover
  (write `docs/migration/founder-cutover.md`, then execute it step by step with founder approval) and
  Phase 8 (Spec 2 Tasks 12–25) in parallel, before the cutover completes. The D44/D47 lane extends to
  Phase 8: each task writes its tests but does not run them, a commit runs `npm run lint` only, and
  tests plus fresh-context review run at the phase close. Task 26 (the lifecycle proof) and Task 11b
  (D46) stay parked. Implementers run as separate headless sessions, one worktree each under
  `../developer-os.worktrees/`. The founder authorized model credits for the owed vendor observations
  (NEW-101..104, NEW-109).
- **D57 (2026-09-23), amends A13 Task 1/15 and A14 Task 14 ("an agent never observes").** The
  founder delegates the owed vendor observations (NEW-104 Codex hooks and trust, the Claude
  `PreToolUse`/`PostToolUse`/`Stop` rows, NEW-109 memory layout and deny rules) to a headless agent
  session on a disposable home, authenticated by linking — never reading, copying, printing or
  committing — the founder's existing vendor credentials, as D52 does for Codex ingest. The session
  grants the Codex hook trust itself on that disposable home only. The founder's working `~/.claude`
  and `~/.codex` are not modified.
- **D58 (2026-09-23), amends program plan Task 8.** The founder cutover skips shadow mode (a separate
  shadow quarantine and an old-versus-new capture comparison). The runbook's disposable-home rehearsal
  (step 7c), the per-adapter gate cycle (step 16) and the exercised rollback (step 18) replace it.
- **D59 (2026-09-23).** Plan 1b (`plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`) is
  approved with every recommended answer to its founder questions: Q1-A (re-pin to macOS 26.6.2
  `25G83`, the measured `/bin/launchctl` hash and Git 2.54.0 with a 13-line build-option literal), Q2-A
  (`certification` field, `null` refuses mutation), Q3-A (accepted residual 10: a stale row refuses
  with the exact manual `launchctl bootout` per generated label), Q4-A (agent-recorded local Git
  trace; HTTPS and SSH refuse until the founder supplies a disposable remote), Q5-A
  (`*.pinned-host.test.ts` and `npm run test:pinned-host`, run locally). Under D56 plan 1b's waves run
  now, beside Phase 8, instead of waiting for it to close.
- **D60 (2026-09-23).** Spec 2's apply path is closed by `plans/2026-09-23-developer-os-spec2-closure.md`,
  with option A on every founder question: F1-A (update Foundation refs follow §6.3's publication rule —
  standard `<tx>/<i>.bin`, no-replace before the initial journal — and the legal staging children list
  grows by the paths the spec itself derives), F2-A (`CanonicalStateFileStateV1` postimage carries no
  dev/ino; identity comes from reopened construction evidence), F3-A (an automatic rollback is the
  error envelope, exit 5 for `update_verifier_rejected`, 1 otherwise; trust stays advanced), F4-A (the
  two V2 ref types are an accepted residual in §13.3).
- **D61 (2026-09-24).** Two spec amendments follow shipped security fixes: the hooks spec
  (`specs/2026-09-22-developer-os-hooks-design.md`) names firing records per verb
  (`<vendor>.<verb>.json`) and scopes G7's "never the user home" base to Claude, with Codex patch paths
  resolved against the canonical `cwd`; Spec 1 §4.2 (`specs/2026-08-21-developer-os-opt-in-surfaces-design.md`)
  refuses a backslash in `GitConfigQuotedPathV1`, matching Core's `CanonicalAbsolutePathV1`. Also
  decided: Spec 2 apply is parked (NEW-110) and the full suite runs now on `59b2c17`.
- **D62 (2026-09-25), after the whole-phase reviews.** (1) Hooks spec §5.2 step 3 is amended: every
  run of LF/CR/CRLF collapses to one LF, and `shellSegments` treats an unquoted LF like `;`, so a
  command on its own line reaches `force-push`, `hook-bypass` and `recursive-delete-root` (phase 6
  review C1). (2) Spec wording follows code already accepted by review: G1's executable charset admits
  `@` (Homebrew `node@24`); §11 records `| /bin/sh` as blocked; the 32-record firing-record cap cleanup
  stays open; A12 conflict-evidence bounds are 1 MiB / 1,000 lines; A12b loads the redaction key before
  vendor selection. (3) Plan 1b Git sync: fix I2 (adoption publishes missing fan-out directories in the
  `enable` effect) and I3 (push advertises the destination ref and sends only new objects, no
  `--thin`); I4 is an accepted residual until A16: `git_commit_not_loose` refuses only when the tip
  commit read by the fast-forward check is packed; a packed target commit or subtree makes the shadow
  advertise nothing and the push sends the whole history (reworded 2026-09-25).
  (4) A fourth full-suite run follows these changes and the re-reviews of phases 4b, 6 and 9.
- **D63 (2026-09-25), amends hooks spec §5.2 step 4.** Belt and braces for the command guards
  (`force-push`, `hook-bypass`, `recursive-delete-root` and every first-token rule): besides the
  segment analysis, each guard also checks every physical line of the command, trimmed, as its own
  candidate, so a dangerous line blocks whatever the shell tokenizer concluded about quotes, comments,
  heredocs or `$'…'`. A false block is accepted when such text sits inside a heredoc body. Three review
  rounds kept finding tokenizer-versus-bash divergences; this removes the tokenizer from the trust
  path for these rules.
- **D64 (2026-09-25), closes the guard review rounds.** One last hardening of the D63 line pass: for
  every line containing `'` or `"`, each fragment between quote characters and the line with `\`, a
  `$` before `'` and all quotes removed are also candidates (accepted false block: quoted text that
  starts with a banned command, such as `-m "git push --force is banned"`). After it the command guards
  are frozen: they stop accidental harmful commands, not an agent that deliberately crafts shell syntax
  to evade them; further crafted bypasses are recorded as residuals in `docs/architecture/hooks.md`
  §3.8, not fixed by further tokenizer rounds.

Scope: `docs/migration/instruction-inventory.md` §1–§3, §6.

- Spec, plan and Tasks 1–28 of `plans/2026-09-22-developer-os-instruction-artifacts.md` landed and
  the phase close ran: install/uninstall wiring (NEW-60) `be9b6de`, `022dc98`; loading assertions
  (NEW-65) `084f1ba`; Codex registration at install `485ca5a`.
- [ ] Codex cache: an in-place re-render is not loaded until `codex plugin add` runs again; the update lifecycle must re-register (NEW-61). Registration at install landed; re-registration on `update` belongs with Phase 8.
- [ ] Founder stops — the plan's remainder; see "Founder stops still open (Phases 5–7)" below. The
  §11 spec amendments and the inventory status flip ran on 2026-09-26.

Gate: all inventoried artifacts install, drift-check and uninstall on both vendors; `doctor` names each as `default` or `user`.

### Phase 5b — A12b: Brain workflows · L

Scope: inventory §7. Rule: the agent never writes to the vault directly; every mutation is a capture through the validators and a transaction.

- Workflows and verbs landed as Tasks 1–15 of `plans/2026-09-22-developer-os-brain-workflows.md`,
  and the phase close ran.
- [ ] Real-vendor gate (Task 16 Step 5, founder stop). The plan's decisions and the spec's residuals
  moved to `docs/architecture/brain.md` §6.13 on 2026-09-26.

Gate: each workflow proven end to end on the synthetic vault with a fake vendor and once with a real vendor in the compatibility matrix.

### Phase 6 — A13: hooks · L

Scope: inventory §4.

- Spec and the Claude half landed as Tasks 3–14, 16, 17 of `plans/2026-09-22-developer-os-hooks.md`
  (Claude hooks installed by `init`, `a156b0c`).
- Task 15, the Codex half (Codex hooks bundled in the plugin manifest and trusted manually, D7), and
  Task 1's remaining observations landed under D57 (`4041286`, `4e308d2`, `2e75574`, `2bec6a7`).
- The phase close (Task 19) ran.
- [ ] Task 2: legacy parity check (founder stop point), never run.
- [ ] Task 18: "observed firing" proven in the real-agent matrix on both vendors (founder stop point).

Gate: every supported hook observed firing on Claude; on Codex after manual trust; capability keys `session_start_injection` and `plugin_hooks` resolve to `yes` where observed.

### Phase 7 — A14: tooling verbs · M spec + L implementation

Scope: inventory §5, §6.

- `import`, `project init|check`, `doctor` `vendor-config` and the D47 refusals landed as Tasks 1–13 and
  15 of `plans/2026-09-22-developer-os-tooling-verbs.md`; Task 14's Claude observations (NEW-109) were
  recorded under D57 (`4041286`). The phase close ran and the plan was deleted on 2026-09-26; its
  scope decisions are amended into the tooling-verbs spec §6 and §8 ("Amended 2026-09-26 (NEW-108)").
- [ ] The `project init` templates' founder-local scan, run with A12's (see below). The inventory
  status flip ran on 2026-09-26.
- The automation job registry is Spec 1b's and belongs to Phase 9 (D16). It is Spec 1 §5.1's four jobs: `brain-reindex`, `brain-lint`, `doctor` and `git-sync`. `import` and `ingest` stay manual and are not registry entries (D47, Spec 1 §1).

Gate: every inventoried script is a verb or a recorded refusal.

### Founder stops still open (Phases 5–7)

The phase closes ran (above). What is left of them is founder work, executed from the plan named:

- [ ] A12 (`plans/2026-09-22-developer-os-instruction-artifacts.md`): NEW-101 billed real-agent row,
  then emptying `UNPROVEN_CLAUDE_CATEGORIES` (Task 29 Step 3b); NEW-103 Claude D8 isolation
  observation and NEW-102's Codex re-observation (Task 21's three real-vendor integration files); the
  founder-local private-pattern scan (`scan-instruction-defaults.js --patterns`) over `instructions/`
  and `templates/project/`, which also closes A14 Task 15 Step 4.
- [ ] A12b (`plans/2026-09-22-developer-os-brain-workflows.md`): Task 16 real-vendor run
  (`npm run build && DEVELOPER_OS_VENDOR_BRAIN_API_KEY=<key> npm run test:vendor-brain`, all five
  workflows `pass` on Claude). `test:vendor-ingest` is billed too and has not run.
- [ ] A13 (`plans/2026-09-22-developer-os-hooks.md`): Task 18 real-agent matrix on both vendors;
  Task 2 legacy parity check.

### Phase 8 — Spec 2 Tasks 12–26: release transport, update, rollback · L

Runs after Phase 10 (D16). Tasks 10–11 moved to Phase 4b.

NEW-68's corrections landed on 2026-09-08 — `SafeReasonCodeV1` is bounded, the §5.3/§6.3 limit conflict is resolved, the exact-maximum gates are read against both bounds, and the `symlink` arm is accepted residual 9. Tasks 20 and 26 carry what that leaves them. Execute the baseline plan.

- Tasks 12–25 of `plans/2026-08-29-developer-os-release-update.md` and Tasks 1–8 of
  `plans/2026-09-23-developer-os-spec2-closure.md` landed under D56, and the Phase 8 close ran.
- [ ] Closure Tasks 9–10 (`update --apply` / `update rollback --apply` composition): blocked on design,
  NEW-110; parked by D61.
- [ ] Task 26 (the lifecycle proof) and Task 11b: parked (D56, D46).

Gate: `update` dry-run and apply and rollback proven on a disposable install, then once on the founder machine.

### Phase 9 — Spec 1b: git and launchd · L

Runs after Phase 8 (D16), and takes over the automation job registry bullet from Phase 7. The registry is Spec 1 §5.1's four jobs (`brain-reindex`, `brain-lint`, `doctor`, `git-sync`); `import` and `ingest` stay manual (D47, Spec 1 §1).

Preconditions (NEW-84): a freshly measured `launchctl` row for the current macOS with a re-pinning rule (the pinned row no longer matches the development machine), the suite fits CI, Phase 7 jobs exist.

- Plan 1b (`plans/2026-09-23-developer-os-opt-in-surfaces-1b.md`, D59) Tasks 1–18 and 20 landed
  under D56; the rows were measured and re-pinned in the spec (NEW-84, D59). The phase close
  (Task 21) ran except `npm run test:pinned-host`, which needs Task 19's host.
- [ ] Task 19 (FOUNDER STOP): certify the re-pinned rows on a disposable 25G83 host, run
  `npm run test:pinned-host` there and prove the gate below.
- The architecture carry-over of plan 1b's decisions ran on 2026-09-26 (`foundation.md` §10,
  `foundation-constraints.md`, `threat-model.md` §5.15).

Gate: `git enable|sync|disable` and `automation enable|disable|status` proven; scheduled runs observed.

### Phase 10 — A15: founder cutover · L

- `docs/migration/founder-cutover.md` is written (`974376a`, review `3bb435e`, D58 `c613db7`) from
  program plan Task 8 with this phase's additions and D16's: the one-off vault migration on a copy,
  inbox import in batches, installation with the vault as Brain, product hooks replacing the legacy
  guards (closes D3's accepted risk), legacy surfaces removed, reinstall preserving the Brain and
  overrides, retired jobs run by hand until Phase 9, Git and launchd left disabled, rollback
  exercised once.
- [ ] Execute it. Do not delete the legacy repositories; archive them after one stable cycle.

Gate: one complete capture → review → ingest → search → reinstall → uninstall cycle on the live machine; rollback to the legacy runtime exercised.

### Phase 11 — A16: release · L

Unchanged from program plan Task 9. L1 (license) and L2 (remote permissions) still owed.

## Risk register

| Risk | Source | Mitigation |
|---|---|---|
| Legacy machine without pre-tool guards and without its weekly pipeline until cutover | D3 | Phase 6 restores guards through product hooks; Phase 7 `import` drains the inbox; cutover is the first phase that touches the live machine |
| Hand-migrated vault is not reusable by other legacy-vault users | D4 | there is one such user; the mapping is recorded in inventory §8 |
| Legacy rules carry client references | D5 | redaction step in Phase 5 before defaults enter the repository |
| Codex loads skills from its cache, not the hashed tree | Phase 5 | re-register on every update; assert loading, not listing |
| Spec 1 as written contradicts approved retention and pins a stale `launchctl` row | Phase 4, 9 | NEW-67 amendment before any Spec 1 task |
| Founder machine has no `update` or `update rollback` between cutover and Phase 8 | D16 | Phase 10 proves reinstall preserves the Brain and user overrides; cutover rollback restores the legacy runtime |
| Legacy scheduled jobs retire at cutover; product automation arrives in Phase 9 | D16 | their verbs exist from Phase 7 and run by hand; `import` and `ingest` stay manual permanently (D47); revisit the order if manual runs lapse |
| A regression reaches `development` before a full suite sees it | D17, D32 | push every task commit; a red CI run stops new commits; full local `check` at every plan close; D32's deferred slow suites are seen first by CI, hours after the task that broke them |

## Documents this roadmap expects to exist

| Phase | Document |
|---|---|
| 4b | baseline plan Tasks 10–11 plus the production wiring step Phase 4b adds |
| 5 | `specs/<date>-developer-os-instruction-artifacts-design.md` and its plan |
| 5b | `specs/<date>-developer-os-brain-workflows-design.md` and its plan |
| 6 | `specs/<date>-developer-os-hooks-design.md` and its plan |
| 7 | `specs/2026-09-22-developer-os-tooling-verbs-design.md` (its plan closed and was deleted 2026-09-26) |
| 8 | baseline plan Tasks 12–26 and `plans/2026-09-23-developer-os-spec2-closure.md` |
| 9 | `plans/2026-09-23-developer-os-opt-in-surfaces-1b.md` |
| 10 | `docs/migration/founder-cutover.md` |
| 11 | program plan Task 9 |

This roadmap is deleted when Phase 11 closes; until then it is the index `ORDER.md` points at for everything after the current `NOW` entry.
