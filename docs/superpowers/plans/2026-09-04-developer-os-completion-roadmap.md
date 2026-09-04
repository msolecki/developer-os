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

## Phases

Sizes are S/M/L complexity. "Gate" is what must be true before the next phase starts.

### Phase 0 — Close replacement Task 6 · L

- [x] Closed 2026-09-04 as `050fc0d..c5022a7`, six tasks: spec amendments, global-lock admission, single retention derivation, gate blockers, review residuals, checkpoint. The plan that carried them was deleted at closure; its constraints live in Spec 2 §6.1/§6.3/§6.4 as amended and in `docs/architecture/foundation.md` and `docs/architecture/threat-model.md`.

Gate: `npm run check` green; `ORDER.md` `NOW` = Phase 1; NEW-52, NEW-55, NEW-56, NEW-57 closed or rewritten. **Corrected 2026-09-04, twice.** This line read "`NOW` = Spec 2 Task 8", written before Phases 1 and 2 were inserted ahead of it; Spec 2 Tasks 8–9 are Phase 3. It also named NEW-54, the trailing lone-surrogate encoder defect, which this checkpoint never touched and which stays open. The full `npm run check` was still running when the checkpoint was committed; the document gates (citations, control bytes) and `lint` passed.

### Phase 1 — Ingest isolation (NEW-58) · M

Before any other A11 task, because it is a security defect in shipped code.

- [ ] Claude: `--tools ""`, the most restrictive permission mode the installed CLI offers, `--strict-mcp-config`, `--setting-sources ""`, `--json-schema <installed schema>`; remove `--allowedTools`; pin `--max-turns` with a test against the real binary. Files: `packages/adapter-claude/src/invoke.ts`, `apps/cli/src/commands/ingest.ts`. **Corrected 2026-09-04:** `--max-turns` does not appear anywhere in `claude --help` for 2.1.260, so "pin with a test against the real binary" cannot be done as written — either the flag is undocumented, or every real Claude ingest run today fails on an unknown flag. `plans/2026-09-04-developer-os-ingest-isolation.md` Task 1 Step 2 settles which case it is; founder decision F1 (that plan's table) decides whether the flag is dropped or kept before this bullet's other flags are implemented.
- [ ] Codex: `--ephemeral --ignore-user-config --ignore-rules`; select the final answer from `turn.completed` `last_agent_message` with `finalAgentMessage` as fallback; record a fixture from the installed version. Files: `packages/adapter-codex/src/invoke.ts`, `tests/fixtures/codex/`. **Corrected 2026-09-04:** the `last_agent_message` claim is not established. `codex app-server generate-json-schema` shows the v2 protocol's `TurnCompletedNotification` carries no such field — an agent reply there is a `ThreadItem` `{type: "agentMessage", text}` — but app-server is JSON-RPC, a different interface from `codex exec --json`'s JSONL stream, so this is suggestive, not conclusive. `plans/2026-09-04-developer-os-ingest-isolation.md` Task 4 settles it from Codex source (NEW-47), or stops for the founder (decision F3) rather than spending a paid observational run.
- [ ] Prompt: capture text plus a bounded index excerpt (title, summary, path; 32 KiB cap) instead of a `content/**` read scope for the model. Files: `packages/brain/src/ingest/prompt.ts`, `workflows/ingest/workflow.yaml`, regenerated skills.
- [ ] Process environment allowlist (`PATH`, `HOME`, `TMPDIR`, proxy and certificate variables). File: `packages/security/src/process.ts`. **Corrected 2026-09-04:** this is a widening, not a hardening. Both adapters pass `env: {}` today, so the vendor child gets a completely empty environment; `tests/security/network.test.ts:72` pins that. The proxy-variable mention here contradicts `tests/security/network.test.ts:228`, which proves a parent's proxy does not reach the child. `plans/2026-09-04-developer-os-ingest-isolation.md` Task 6 (founder decision F2) admits a variable only against a recorded observation of the vendor failing without it, never a proxy variable, or keeps the empty environment.
- [ ] NEW-44: two matching detection rows → `unknown` agent. File: `packages/brain/src/capture/agent.ts`.

Test: integration tests under `tests/integration/*` that plant a user hook writing a marker file and assert it never runs during ingest; fixtures from the installed vendor versions; regenerated skill trees byte-identical to `plugins/*`.

Gate: fresh review `READY`; NEW-58 and NEW-44 closed.

### Phase 2 — Bootstrap performance and the first push (NEW-53, NEW-52) · M

- [ ] One evidence inspection per `init`, passed down; memoized physical-path resolution; grouped inventory. Files: `apps/cli/src/bootstrap/executor.ts`, `apps/cli/src/bootstrap/report.ts`. Target: the retained-init e2e case under 60 s, the executor test file under 10 minutes.
- [ ] Uninstall: exclude maximal retention roots rather than every retained path; read the manifest through the V2-aware store instead of a lexical fallback (NEW-59). File: `apps/cli/src/commands/uninstall.ts`.
- [ ] NEW-51: one canonicalizer over a guarded no-follow reopen, one owner-admission predicate, shared by the executor, the report and uninstall. New file: `apps/cli/src/bootstrap/admission.ts`.
- [ ] Push the accumulated commits to a probe branch, watch all four CI jobs, then push `development`.

Gate: CI green on `development`.

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
| 1 | `plans/2026-09-04-developer-os-ingest-isolation.md` — written 2026-09-04, awaiting founder approval of F1, F2, F3 |
| 2 | `plans/<date>-developer-os-bootstrap-performance.md` |
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
