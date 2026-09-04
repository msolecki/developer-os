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

| Entry | Work still required | Blocked by |
|---|---|---|
| A11 · DOS-P7 | retained-evidence Task 7 replacement implementation, manifest/new-init handoff, Spec 1 implementation, remaining Spec 2 implementation | current |
| A12 · DOS-P10 | spec, plan, implementation for 38 instruction artifacts | A11 |
| A13 · DOS-P11 | spec, plan, implementation for 11 non-capture hooks | A12 |
| A14 · DOS-P12 | spec, plan, implementation for nine tooling scripts | A13 |
| A15 · DOS-P8 | dedicated cutover plan and founder shadow migration | A14, L2 |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A15, L1, L2 |

## 1. Open repository rows

There are 31 numbered rows. They are not automatically ordered ahead of A11.

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-54 | Core encoder / correctness | `assertString` in `packages/core/src/lifecycle/canonical-json.ts` does not reject a **trailing** lone high surrogate: at the last index `charCodeAt(index + 1)` is `NaN` and both range comparisons are false. `encodeCanonicalJson({ "\uD800": 1, "�": 2 })` therefore emits two identical `EF BF BD` keys — a wire form this module's own `decodeCanonicalJson` rejects as a duplicate key, and two distinct inputs that hash to the same SHA-256. Decide whether to reject at encode time and record the migration for anything already hashed. |
| NEW-56 | A11 / Task 6 / test quality | The 2026-09-04 fresh review found three Task 6 gates that cannot fail. `fixture.vendorProcesses` and `fixture.releaseRequests` are declared at `apps/cli/src/commands/testing.ts:416-417` and never pushed to anywhere, so `tests/e2e/fresh-v2-retained-bootstrap.test.ts:56-57` — the entire "no network, vendor, or model process is invoked" coverage for the bootstrap lifecycle — is unconditionally true; `apps/cli/src/bootstrap/executor.test.ts:155,362` carry the same dead pair. `apps/cli/src/commands/status.test.ts:49-55` builds its fixture without `bootstrapAvailable: true`, so `context.bootstrap` has no `inspectEvidence` and the counter it asserts is structurally pinned to 0. `inventory()` at `testing.ts:664` returns sorted path names only, so every `expect(await inventory(root)).toEqual(before)` byte-inertness claim — `report.test.ts:109,193`, `doctor.test.ts:144`, `init.test.ts:123,179` — would pass against an implementation that rewrote every retained file in place. Also open from the same review: no test creates two admitted active plans, so the `active.length > 1` term of `blocksNewIntent` is unexercised; and `preserved` now carries every recursive descendant of every directory tombstone (`report.ts:1127`), which prints Brain note filenames on uninstall and costs one `canonicalize` per retained entry. |
| NEW-55 | A11 / Task 6 / founder decision | Replacement Task 6 is parked, and the 2026-09-04 fresh review rejected it. The blocker recorded here previously (empty slots classified resumable) is closed: `report.ts` classifies that case `incomplete` with a null journal and `executeFreshInit` replays the plan. The real defect is worse and is on the success path. A successful `developer-os init` retires 14 of its own 105 manifest artifacts — `config.toml`, `schemas/ingest.stage.schema.json`, and twelve files inside the user's Brain — by renaming them to tombstones, then exits 0 with a manifest claiming all 105 installed. Reproduced twice standalone and pinned by a new red test, `init.test.ts` "leaves every artifact its manifest names present after a V2 bootstrap init". Cause: `foundationAuthorities` in `packages/core/src/manifest/bootstrap-retention.ts:1060` names `mutation.targetPath` as a `foundation_bootstrap` row for a forward participant, mirrored at `apps/cli/src/bootstrap/report.ts:452`; retention runs after `verify()`, so it retires files the install just declared good. Spec 2 §6.4 line 1601 forbids it: installed targets are never retention rows. **The spec does not say what replaces it, and both candidate readings fail against the real filesystem**: naming `mutation.stagedPath` in both places refuses with `retention path is in a third state`, because a forward mutation renames the staged file onto the target, so after finalize neither path is residue. Deciding whether a finalized forward participant emits no content row at all — and what then keeps its payload ordinal from producing a duplicate `payload` row — is a Spec 2 §6.4 amendment, not an implementation choice. Two independent corrections are already written and lint-clean in `task6-guarded.patch`: the unguarded evidence inspection in `doctor.ts` (which turned a partial slot, a foreign-uid namespace entry, or the retention cap itself into an unhandled rejection with no report) and `decodeCanonicalJson` throwing out of `report.ts` on a half-written slot. Patches, the failed attempt, and a restore guide are at `~/.claude/projects/-Users-msolecki-www-developer-os/task6-patches/`. |
| NEW-53 | A11 / performance / partially closed | `developer-os init` fell from roughly 219s to roughly 101s, and encoder allocations from 366,721,268 to 36,057,211, across b146f7e, ae12887 and 5b0696e. Two full inits now fit the e2e budget that blocked NEW-55, which is verified: that test ran 299.5s against its 600000ms timeout and no longer times out. The dominant cost was one call site, `rawCanonicalHash` under `validateJournalRecord`, re-hashing the whole plan per journal record: 60,947,939 of 91,052,556 key encodes. Attribute by keys encoded, not by call count; counting calls pointed at `sameValue`, which is nearly free because `sortKeysUtf8` only encodes object keys. Remaining: 36,057,211 allocations, led by `decodeCanonicalJson` and `journal-store.ts` re-encoding on every slot read, and `projectBootstrapRetentionPostimage` re-projecting directory trees. Whether that is worth closing depends on whether 101s is acceptable for `init`; the 30-minute CI timeout is still unproven against the full suite. |
| NEW-52 | test gate / blocks CI | `apps/cli/src/bootstrap/executor.test.ts` needs roughly 200s per test across 69 tests, so `npm test` cannot finish inside `check.yml`'s `timeout-minutes: 30` on its macOS runner. `db5e5c1` also rewrote the `test` script into three `vitest` invocations to isolate one test that is not isolation-safe. Restore a single `vitest run` once NEW-53 makes the suite fit the gate. |
| NEW-51 | manifest guards / security | `pathEvidence()` in `apps/cli/src/bootstrap/executor.ts` supplies `reopenCanonicalAbsolutePath: (path) => resolve(path)`. `node:path.resolve` is lexical, so it returns any already-canonical absolute path unchanged and the refusal at `packages/core/src/update/paths.ts:96` can never fire for any consumer. Provide a reopening canonicalizer that detects symlinks, or delete the dead guard and record the accepted limit. Separately, give `uninstall.ts` the owner-authority bound the executor uses instead of `admitOwnerPath: (_owner, path) => path`. |
| NEW-50 | Core encoder / performance | Five file-local copies of the per-comparison `compareUtf8` remain in `packages/core/src/manifest/bootstrap.ts`, `packages/core/src/update/release.ts`, `packages/core/src/manifest/bootstrap-retention.ts`, `apps/cli/src/bootstrap/retention.ts`, and `apps/cli/src/update/packaged-release.ts`; three pass it straight to `.sort()` and carry the same O(k log k)-encodes cost fixed in `canonical-json.ts`. Apply the same encode-once ordering, or extract one shared helper. |
| NEW-49 | review workflow / startable | Add a status input and correct the stale description at `workflows/review/workflow.yaml:4`, bump its version, regenerate both vendor skills, and pass drift tests. |
| NEW-47 | Codex adapter / startable | Read Codex source to prove whether model-run commands can emit raw bytes into the JSONL consumed by `packages/adapter-codex/src/invoke.ts:178`; record the dated result and use it with NEW-45 to choose message selection. No model call is required. |
| NEW-46 | A11 / security | Stop the ambient-marker-selected spawn at `apps/cli/src/commands/capture.ts:263` from resolving through same-uid `PATH`, or design manifest-owned persisted executable identity with upgrade/move drift behavior. |
| NEW-45 | founder credits | Run one real `codex exec` likely to emit a post-answer summary; record event count/order and which `agent_message` the schema constrains. Settle with NEW-47. |
| NEW-44 | capture agent detection | Observe nested vendor markers and replace the first-match behavior rooted at `packages/brain/src/capture/agent.ts:53-107` with attribution that does not select the outer session merely because its row comes first. |
| NEW-42 | human interactive sessions | Run `developer-os capture` inside both vendors' TUIs with parent markers stripped; record the child environment in `knowledge-pipeline.md` §10. |
| NEW-20 | capture / security | Use the canonical root verified at `apps/cli/src/commands/capture.ts:762` for the reads/writes at `apps/cli/src/commands/capture.ts:791-800`, retaining the declared path only for the public result; pin the symlink-swap window. Keep NEW-35 distinct. |
| NEW-31 | Brain lint | Decide and implement a lint finding around the U+200D-aware key at `packages/brain/src/lint/lint.ts:647` for stray joiners between characters that do not join, without collapsing legitimate emoji or Indic/Persian shaping. |
| NEW-32 | macOS executable trust / security | Replace the incomplete resolution beginning at `packages/platform-macos/src/macos.ts:305` with component-by-component inspection of every intermediate hop, including directory-component hops. |
| NEW-35 | A11 / accepted platform limit | Correct the code reference and either provide enforceable exec-by-identity or explicitly retain the check-then-spawn race as a platform limitation. |
| NEW-33 | founder policy | Decide whether root-owned, group-writable executable directories such as legacy `/usr/local/bin` are trusted; pin the choice on a representative machine. |
| NEW-34 | citation gate | Replace fragile line references with checkable anchors, validate bare tracked filenames, fix carrier inheritance, derive counts in tests, and reject present-tense references to removed backlog IDs. |
| NEW-36 | Security redaction | Extend the public redaction seam at `packages/security/src/redaction.ts:405` with class selection so paths preserve bytes and product-owned keys/enums keep their schema while attacker-influenced keys remain protected. |
| NEW-37 | Security redaction | With NEW-36, define type-preserving handling for caller-derived numeric leaves rather than making JSON types depend on user patterns. |
| NEW-38 | ingest output | Screen format characters at the warning-to-report seam so human and JSON error text are safe without renaming byte-exact paths. |
| NEW-39 | CLI errors / NEW-36 | Redact user-pattern matches in `error.paths` without high-entropy heuristics that destroy useful capture paths. |
| NEW-40 | ingest concurrency / decision | Decide refuse-versus-report semantics for a hand edit during the agent call, then bind the unguarded ingested write at `apps/cli/src/commands/ingest.ts:1349-1358` and the remaining later write to the exact staged bytes. |
| NEW-24 | redaction usability | Detect over-broad patterns by match density, not length; decide whether persisted findings may carry a non-secret pattern index. |
| NEW-25 | Security redaction | Replace the first-wins overlap handling at `packages/security/src/redaction.ts:59` with merged partially overlapping ranges; cover interleaving patterns across redaction classes. |
| NEW-26 | Foundation runner | Allow the composition-root runner's redactor to update after config load without bypassing injected fakes; cover vendor diagnostics/logs. |
| NEW-29 | test infrastructure | Replace elapsed-time assertions with deterministic counts where possible; otherwise document bounded retry, retain full failing logs, and address the slow doctor case and cleanup race. |
| NEW-27 | first production write scope | Screen the external scope name and the product-derived path separately before wiring a real write scope. |
| NEW-28 | ingest coverage | Add an injection seam or end-to-end case for the retained screening-refusal branch when a production argument can reach it. |
| NEW-7 | founder / Obsidian | Verify `%` and control/format-character percent-encoded local links in Obsidian; if they fail, reject those paths at lint time. |

## 2. Foundation residuals

- [ ] Decide whether `SpawnLockfRunner` needs a watchdog around its non-blocking `lockf` call. This
  blocks nothing and belongs to the founder.
- [ ] When a real semantic-merge consumer appears, adopt the unused `buildConflictEvidence`
  machinery or delete it in that subsystem's design.
- [ ] A11 must make configuration safely mutable after `init`; hand-editing a manifest-owned config
  is not an acceptable opt-in surface.

## 3. Missing specs, plans, and implementations

### A11 · DOS-P7

- [ ] Execute all six tasks in
  `docs/superpowers/plans/2026-08-31-developer-os-retained-bootstrap-evidence.md`: immutable plans,
  identity-bound two-slot journals, descriptor-relative exclusive renames, same-parent permanent
  tombstones, public retained-evidence reports, focused/full gates, and fresh review.
- [ ] Implement `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1`, existing-install
  migration, and the V2 new-init handoff.
- [ ] Execute `plans/2026-08-28-developer-os-opt-in-surfaces.md` only after that handoff lands.
- [ ] Finish remaining update/release work and close the full Task 7 checkpoint.

Required behavior:

- Git and automation are disabled and effect-free by default.
- Preview is deterministic and byte-inert; apply revalidates a bound preview before allocation.
- Git, launchd, update, and post-handoff lifecycle compaction follow active Spec 1. Bootstrap
  compensation/recovery uses durable same-parent retention and never unlink/rmdir.
- Update refuses drift. Uninstall removes manifest-owned artifacts plus the exact redaction-key path
  while preserving the Brain, unrelated agent configuration, and every retained bootstrap
  plan/journal/tombstone; it reports retained evidence and leaves the product home in place.

### A12 · DOS-P10

- [ ] Specify artifact kinds for subagents, commands, output styles, skills, and vendor instruction
  files, including an explicit unsupported-vendor state.
- [ ] Keep private founder-authored content outside the public repository; ship mechanism and neutral
  defaults only.
- [ ] Implement install, drift detection, and uninstall for all 38 artifacts on both vendors.

### A13 · DOS-P11

- [ ] Specify cross-vendor event mapping and which guards become product verbs.
- [ ] Keep the two transcript-dependent capture hooks declined; scope is the other 11 hooks.
- [ ] Implement only hooks that can be observed firing, name the installed binary, and participate
  in manifest drift/uninstall.

### A14 · DOS-P12

- [ ] Keep the boundary with A11 explicit: A11 owns when scheduled work runs; A14 owns what it runs.
- [ ] Decide which nine scripts become verbs, collapse into `doctor`, or are refused.
- [ ] Preserve or explicitly replace the English prose gate before disabling the legacy runtime.

## 4. Program Tasks 8–9 and external blockers

### A15 · DOS-P8

- [ ] Write a dedicated plan against the finished output of A11–A14.
- [ ] Create `docs/migration/founder-cutover.md`, `founder-baseline-results.json`,
  `founder-shadow-results.json`, and `founder-cutover-manifest.json`.
- [ ] Keep the vault in place, preserve recovery data, never enable two copies of a mutating hook,
  and exercise rollback before declaring cutover stable.
- [ ] Execute the ten unchecked Task 8 steps in the program plan.

### A16 · DOS-P9

- [ ] Decide whether publication receives a dedicated plan.
- [ ] Create public documentation, approved license, release workflows, Homebrew formula, and Apple
  Silicon/Intel packaging from Task 9.
- [ ] Run the whole-history secret audit, clean-account matrix, closed beta, and reproducibility
  gates.
- [ ] Execute the eight unchecked Task 9 steps. Outbound publication remains a founder action.

### Long-lead and external

- [ ] L1 — obtain qualified legal approval for the exact OSI-approved license text before A16.
- [ ] L2 — verify remote rules, PR flow, CI, and release permissions from an environment that can
  read GitHub CLI configuration; required before A15/A16 completion.
- [ ] Recount and opportunistically migrate deprecated `dev/active/` and `.claude/plans/` files in
  other repositories only when that cross-repository cleanup is explicitly taken up.

## 5. Gate-integrity work

- [x] ESLint 9 flat config does not read `.gitignore`. `dbfd875` git-ignored `.worktrees/` but did
  not add it to the `ignores` list in `eslint.config.mjs`, so `npm run check` failed at lint
  whenever a worktree existed — and because that script is an `&&` chain, every commit made in that
  window ran zero tests. Fixed 2026-09-03. When excluding a path, update every tool that keeps its
  own ignore list.

- [ ] Close NEW-29's load-sensitive and intermittent test class with deterministic assertions or an
  explicit bounded-retry policy.
- [ ] Always retain a complete full-suite failure log; do not pipe a unique failure only through
  `tail`.
- [ ] Build a triaged whole-history publication scan before A16; a raw whole-tree scan has known
  false positives in hashes and documentation examples.

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
| Repository validation | `npm run check` (`lint`, tests, build, `git diff --check`) |
| Focused verification | command named by the active plan step |
| Fresh-context review | reviewer did not author the task |
| Exact-path staging | explicit task-owned paths; never `git add -A`, `git add .`, or a wildcard |
| Generated artifacts | clean regeneration diff for adapter/workflow changes |
| Security | relevant sentinel, path, prompt-injection, transaction, and network suites |
| Publication | triaged history scan, license, packaging, checksums, SBOM, clean-account install |
| Remote delivery | CI green on the exact commit before merge |

## 8. Active contract index

This is an inbound-reference index, not completed backlog history. Current sources of truth:

- Foundation lifecycle, manifest, external-effect, and recovery constraints:
  `docs/architecture/foundation.md`, `foundation-constraints.md`, and active Spec 1.
- Knowledge-pipeline redaction, capture, uninstall-key, and publishing constraints:
  `docs/architecture/knowledge-pipeline.md` and `threat-model.md`.
- Adapter capability and hook constraints: `claude-adapter.md` and `codex-adapter.md`.
- Remote/publication boundary: `docs/migration/exclusion-policy.md`, `SESSION.md`, and §7 above.
