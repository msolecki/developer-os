# Developer OS Completion Roadmap

> **For agentic workers:** This is a sequencing plan, not an implementation plan. Each phase below names the spec or implementation plan that must exist before code is written for it; execute those through `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development`, as `SESSION.md` requires. Phase checkboxes are ticked only when the named plan closes.

**Goal:** Finish Developer OS to the point where the founder runs it as the only agent runtime and the legacy shared-instruction repository, the legacy vault tooling, and the legacy plugin are retired.

**Architecture:** The engine (transactions, manifest, redaction, quarantine, ingest, Brain index, both adapters) exists. What remains is the lifecycle (Spec 2 update/release, Spec 1 config/git/launchd), the instruction layer (A12), hooks (A13), tooling verbs (A14), Brain workflows (A12b), the cutover (A15) and release (A16). The order below is dictated by hard dependencies: nothing installs instruction artifacts before the manifest V2 handoff lands, and no cutover happens before the product replaces every legacy surface the founder uses daily.

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

## Phases

Sizes are S/M/L complexity. "Gate" is what must be true before the next phase starts.

### Phases 0-2 — closed

Pruned to their outcomes on 2026-09-08; the detail is in git history and the surviving constraints
are in the canonical documents named below. The founder decisions above are **not** history — D1-D15
govern the open phases and stay.

- [x] **Phase 0 — replacement Task 6**, closed 2026-09-04 as `050fc0d..c5022a7`, six tasks. Its
  constraints live in Spec 2 §6.1/§6.3/§6.4 as amended, `docs/architecture/foundation.md` and
  `docs/architecture/threat-model.md`.
- [x] **Phase 1 — ingest isolation (NEW-58)**, closed 2026-09-05 as `4fe131c..8e9381a`, nine tasks,
  each reviewed by an agent that did not write it. Constraints in
  `docs/architecture/vendor-invocation.md`, `codex-adapter.md` §2/§14, `claude-adapter.md` §11/§13
  and `threat-model.md`. Three of its five original bullets were wrong when written and the
  corrections are in those notes, not here. Closed NEW-58, NEW-47, NEW-44; opened NEW-74 (closed
  2026-09-07 by D14) and NEW-75 (narrowed by D15).
- [x] **Phase 2 — bootstrap performance and the first push**, closed 2026-09-07/08 as
  `632f220..446148b`, ten tasks. Constraints in `docs/architecture/foundation.md` §4 (the shared
  admission module) and §9 (measured cost and the corrected reason for it). Closed NEW-51, NEW-59,
  NEW-52; rewrote NEW-53 to the encoder cost it actually leaves; narrowed NEW-29 rather than
  closing it.

  **Its most valuable result was not on its task list, and is recorded because it generalises.** The
  local gate was green while CI failed four times, and only one of those was a test: `RENAME_FLAGS`
  passed `0x20`, a bit no macOS header defines, so every retained rename failed on macOS 15 through
  `BOOTSTRAP_RETAINED_RENAME` on the real CLI path. Darwin 25.6.0 ignores the bit and Darwin 24.6.0
  rejects the call, so no gate on the development laptop could ever have seen it. The other three
  were a CI job with no `Build` step and two budgets sized from the most favourable local
  measurement against a runner since measured at ~1.9-2x. `BACKLOG.md` §5 carries the
  generalisation: a single-machine gate cannot see a per-job CI environment or a kernel version,
  and this product supports an OS nobody develops on.

  CI is green on all five jobs, twice consecutively — runs 34157609332 (`446148b`) and 34172016048
  (`88d56a2`).

### Phase 3 — Spec 2 Tasks 8–9: manifest V1→V2 migration and the V2 new-init handoff · L + L

Before starting, amend Spec 2 §6.2/§6.3 and the baseline plan text (NEW-68): `admittedExternalShapeHash` for the migration plan, the mode of artifacts a migration adds, the evidence layer for migration residue, and the obsolete "compact journal then plan last" steps. Then execute baseline Tasks 8–9 from `plans/2026-08-29-developer-os-release-update.md`.

Gate: `context.ts` no longer pins `bootstrap: unavailable_until_packaged_handoff`; a fresh `init` runs the V2 path in production.

### Phase 4 — Spec 1a: configuration mutability and the lifecycle coordinator · L

- [ ] Amend Spec 1 (NEW-67): retention replaces every `unlink`/`rmdir`/plan-last clause in §§2.3, 2.4, 6; types already shipped by Spec 2 are imported, not re-produced; the automation status path and the closed reservation set include the Spec 2 paths; the three collision codes exist; property-based fixtures are allowed for the ledger, blob and object ceilings; a dated change table replaces the seven correction packages.
- [ ] Write plan 1a = Spec 1 plan Tasks 1–7, 21, 23, with Task 2 (`config set`) moved after Task 4 (global lock provider).
- [ ] Execute plan 1a.

Gate: `config get|set` shipped; coordinator recovery proven; uninstall drains leases.

### Phase 5 — A12: instruction artifacts · L

Scope: `docs/migration/instruction-inventory.md` §1–§3, §6.

- [ ] Spec: managed artifact kind `instruction` with `source: default | user`; default content from the repository, user content from `<product-home>/instructions/<vendor>/`; both hashed, drift-checked, uninstalled. One product-owned import block in the user's global Claude instruction file and a generated Codex `AGENTS.md`, merged three-way (first real consumer of `buildConflictEvidence`). Path-scoped rules emulated on Codex. Output styles `unsupported` on Codex. Command/skill pairs collapsed. Redaction of client references before the defaults enter the repository.
- [ ] First implementation step: wire the existing adapter install proposals into `init` and `uninstall` (today no production code path installs either plugin; NEW-60). Assert loading with `claude plugin details` and `codex debug prompt-input` in the integration tests (NEW-65).
- [ ] Codex cache: an in-place re-render is not loaded until `codex plugin add` runs again; the update lifecycle must re-register (NEW-61).

Gate: all inventoried artifacts install, drift-check and uninstall on both vendors; `doctor` names each as `default` or `user`.

### Phase 5b — A12b: Brain workflows · L

Scope: inventory §7. Rule: the agent never writes to the vault directly; every mutation is a capture through the validators and a transaction.

- [ ] Workflows `brain-answer`, `brain-compile`, `brain-enhance`, `brain-garden`, `brain-report` as `workflows/*.yaml` rendered to both vendors.
- [ ] Verbs `brain retire`, `brain refactor --rename|--move|--merge|--split`, lint classes `stale`, `isolated`, `dead-link`, `duplicate`, `gap`.

Gate: each workflow proven end to end on the synthetic vault with a fake vendor and once with a real vendor in the compatibility matrix.

### Phase 6 — A13: hooks · L

Scope: inventory §4.

- [ ] Spec: cross-vendor event table; every hook is a call to the installed `developer-os` binary (`guard command|path|commit|stop|format|prompt|edit`, `brain status --inject`); recursion guard; Codex hooks bundled in the plugin manifest and trusted manually (D7); `doctor` reports external hooks.
- [ ] Implementation; "observed firing" proven in the real-agent matrix, argv/stdin contracts in CI.

Gate: every supported hook observed firing on Claude; on Codex after manual trust; capability keys `session_start_injection` and `plugin_hooks` resolve to `yes` where observed.

### Phase 7 — A14: tooling verbs · M spec + L implementation

Scope: inventory §5, §6.

- [ ] `developer-os import <path|dir>` (default inbox) → quarantine envelopes, source archived; `import --claude-memory`.
- [ ] `project init|check|worktree`; `repo audit|bootstrap|secrets-scan` (opt-in, `gh`-authenticated, baseline as user data); `doctor` check `vendor-config`.
- [ ] Automation job registry entries for Spec 1b: `import`, `ingest`, `brain reindex`, `brain lint`, `doctor`, `git sync`.

Gate: every inventoried script is a verb or a recorded refusal.

### Phase 8 — Spec 2 Tasks 10–26: launcher, release trust, update, rollback · L

After the corrections in NEW-68 (undefined `SafeReasonCodeV1`, conflicting limits, exact-maximum gates that are arithmetically impossible, unreachable `symlink` arm). Then execute the baseline plan.

Gate: `update` dry-run and apply, rollback, and the launcher proven on a disposable install.

### Phase 9 — Spec 1b: git and launchd · L

Preconditions: a freshly measured `launchctl` row for the current macOS with a re-pinning rule (the pinned row no longer matches the development machine), the suite fits CI, Phase 7 jobs exist.

Gate: `git enable|sync|disable` and `automation enable|disable|status` proven; scheduled runs observed.

### Phase 10 — A15: founder cutover · L

- [ ] Write `docs/migration/founder-cutover.md` from program plan Task 8, with these additions: the one-off vault migration on a copy using inventory §8, reviewed as a diff, then `brain lint` = 0 errors and `brain search` returning every note; `import` of the accumulated inbox in batches; installation over the live machine with the vault as Brain; product hooks replace the legacy guards (closes D3's accepted risk); legacy launchd jobs booted out, the legacy import block removed from the vendor instruction file, the legacy plugin removed from both vendors, dead symlinks and orphaned generated agents removed; rollback exercised once.
- [ ] Execute it. Do not delete the legacy repositories; archive them after one stable cycle.

Gate: one complete capture → review → ingest → search → update → uninstall cycle on the live machine; rollback exercised.

### Phase 11 — A16: release · L

Unchanged from program plan Task 9. L1 (license) and L2 (remote permissions) still owed.

## Risk register

| Risk | Source | Mitigation |
|---|---|---|
| Legacy machine without pre-tool guards and without its weekly pipeline until cutover | D3 | Phase 6 restores guards through product hooks; Phase 7 `import` drains the inbox; cutover is the first phase that touches the live machine |
| One large Task 6 checkpoint | D2 | six separately committed and reviewed tasks inside it |
| Hand-migrated vault is not reusable by other legacy-vault users | D4 | there is one such user; the mapping is recorded in inventory §8 |
| Legacy rules carry client references | D5 | redaction step in Phase 5 before defaults enter the repository |
| Codex loads skills from its cache, not the hashed tree | Phase 5 | re-register on every update; assert loading, not listing |
| Spec 1 as written contradicts approved retention and pins a stale `launchctl` row | Phase 4, 9 | NEW-67 amendment before any Spec 1 task |

## Documents this roadmap expects to exist

| Phase | Document |
|---|---|
| 0 | closed 2026-09-04; the plan it named was deleted at closure |
| 1 | closed 2026-09-05; the plan it named was deleted at closure |
| 2 | closed 2026-09-07/08; the plan it named was deleted at closure |
| 3 | Spec 2 §6.2/§6.3 amendment; baseline plan Tasks 8–9 |
| 4 | Spec 1 amendment; `plans/<date>-developer-os-opt-in-surfaces-1a.md` |
| 5 | `specs/<date>-developer-os-instruction-artifacts-design.md` and its plan |
| 5b | `specs/<date>-developer-os-brain-workflows-design.md` and its plan |
| 6 | `specs/<date>-developer-os-hooks-design.md` and its plan |
| 7 | `specs/<date>-developer-os-tooling-verbs-design.md` and its plan |
| 8 | baseline plan Tasks 10–26 after NEW-68 |
| 9 | `plans/<date>-developer-os-opt-in-surfaces-1b.md` |
| 10 | `docs/migration/founder-cutover.md` |
| 11 | program plan Task 9 |

This roadmap is deleted when Phase 11 closes; until then it is the index `ORDER.md` points at for everything after the current `NOW` entry.
