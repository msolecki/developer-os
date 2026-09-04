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
| A12 · DOS-P10 | spec, plan, implementation for the instruction artifacts in `docs/migration/instruction-inventory.md` §1–§3 and §6 | A11 |
| A12b · Brain workflows | spec, plan, implementation for the vault workflows in `docs/migration/instruction-inventory.md` §7 | A12 |
| A13 · DOS-P11 | spec, plan, implementation for the 11 non-transcript hooks in `docs/migration/instruction-inventory.md` §4, plus session-start injection | A12b |
| A14 · DOS-P12 | spec, plan, implementation for the 14 automation scripts in `docs/migration/instruction-inventory.md` §5 | A13 |
| A15 · DOS-P8 | dedicated cutover plan and founder shadow migration | A14, L2 |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A15, L1, L2 |

The phase order, the founder decisions of 2026-09-04 that fixed it, and the documents each phase
expects are in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.

## 1. Open repository rows

There are 43 numbered rows. They are not automatically ordered ahead of A11.

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-58 | ingest isolation / security / startable, before any other A11 work | `invokeClaude` (`packages/adapter-claude/src/invoke.ts:105-115`) passes `--allowedTools`, which grants tools rather than restricting them, and passes none of `--tools`, `--restricted`, `--permission-mode`, `--strict-mcp-config` or `--setting-sources`, so an ingest run executes with the user's own permission settings, hooks and MCP servers loaded; the read-only intent at `apps/cli/src/commands/ingest.ts:228` and `apps/cli/src/commands/ingest.ts:768-784` is not enforced, and the comment there claiming Claude has no schema flag is stale (`--json-schema` exists in 2.1.260). `invokeCodex` (`packages/adapter-codex/src/invoke.ts:265-276`) omits `--ephemeral`, `--ignore-user-config` and `--ignore-rules`, so a run persists a thread in the user's history and loads the user's config, rules and MCP servers. Founder decision 2026-09-04: ingest runs with no tools; the prompt carries the capture plus a bounded index excerpt. Also: `finalAgentMessage` (`packages/adapter-codex/src/invoke.ts:178-200`) has a deterministic replacement in this version's `turn.completed` `last_agent_message`, and no fixture comes from 0.151.0 (with NEW-45/NEW-47). Roadmap Phase 1. |
| NEW-59 | uninstall / manifest read | `readUninstallManifest` (`apps/cli/src/commands/uninstall.ts:534-580`) catches every failure of the guarded manifest read — including refusals from `assertReadable`, a symlink at the manifest path and a device/inode mismatch on reopen — and falls back to a weaker read with an identity `admitOwnerPath`, degrading a V2 manifest to V1 with empty hashes for `ephemeral` and `directory` artifacts; the result drives artifact removal. Recognise only the V2 case by `schemaVersion`, propagate every other error, and read through `readOptional(context)` (`packages/core/src/manifest/store.ts:270`). Roadmap Phase 2. |
| NEW-60 | adapters / install path | No production code path installs either plugin: `proposeClaudeInstall`, `proposeCodexInstall`, `renderClaudePlugin` and `renderCodexInstallTree` have no caller under `apps/cli/src` outside tests, and `init` writes both `adapters.*` as `false`. After `developer-os init` a user has no skill installed on either vendor. First step of A12 (roadmap Phase 5): wire the existing proposals into `init` and `uninstall` behind the adapter selection the design's §9.1 already promises. |
| NEW-61 | Codex adapter / cache | Codex 0.151.0 loads skills from `<CODEX_HOME>/plugins/cache/developer-os/developer-os/0.0.0/skills`, not from the product tree the manifest hashes; an in-place re-render is invisible until `codex plugin add` runs again (`docs/architecture/codex-adapter.md` §14). `PLUGIN_VERSION` at `packages/adapter-codex/src/plugin.ts:78` names that cache directory. The update lifecycle must re-register after every tree change, and `tests/integration/codex/plugin-loads.test.ts:213-232` must assert loading (`codex debug prompt-input`), not listing. Roadmap Phase 5. |
| NEW-62 | capability model | `CAPABILITY_STATES` (`packages/core/src/capabilities/index.ts:25`) has no `no` state, so both adapters' `resolveCapabilities` fold an `absent` observation and an `unavailable` observation into `unknown` (`packages/adapter-claude/src/capabilities.ts:74-79`, `packages/adapter-codex/src/capabilities.ts:81-85`), contrary to their own docblocks; `doctor` prints `skills=unknown` both when the plugin is verifiably not installed and when the probe could not run. `DOCUMENTED_FLOORS` map every key to `null` in both `versions.ts` files, so the floor table adds nothing over the minimum version. Add `no`, and re-measure the floors against 2.1.260 and 0.151.0. |
| NEW-63 | Core retention / duplication | `packages/core/src/manifest/bootstrap-retention.ts:1259-1284` and `packages/core/src/manifest/bootstrap-retention.ts:1932-1974` carry the same collapse → role order → tombstone-path pipeline with different "is a directory" predicates; a divergence gives `deriveBootstrapRetentionLocations` and `deriveBootstrapRetentionTable` different ordinals, so retention would write a tombstone the reader does not check. Extract one `collapseAndOrder(rows, isDirectory)`. Also six file-local copies of `compareUtf8` (NEW-50 counts five). Roadmap Phase 2. |
| NEW-64 | documentation drift | `docs/architecture/foundation.md:594` says `init` writes no canonical note (it installs four); `docs/architecture/foundation.md:15-24` says four packages (eight workspaces); `docs/architecture/foundation.md:34` says one command per module (six modules under `commands/` are not commands); `docs/releases/foundation-checkpoint.md:93-107` counts eight artifacts and thirteen files; `docs/architecture/threat-model.md:832` quotes a sentence that is not in this file; `docs/architecture/threat-model.md:55`, `:507` and `:902` cite an `ORDER.md` section that no longer exists; twelve places cite `BACKLOG.md` §8 as an amendment index it no longer is; a 24-citation sample found 14 line references pointing at unrelated code (NEW-34's class). Fix with the Task 7 checkpoint documents or immediately after. Also `templates/brain/content/templates/note.md:13` ships `occurrences: 0` while the schema requires an integer of at least 1. |
| NEW-65 | integration tests / loading | `tests/integration/claude/plugin-loads.test.ts:96-129` asserts only that `claude plugin validate` prints no error; in 2.1.260 that command returns `"contents": []` and never reads `SKILL.md`, so the suite has no assertion that the six skills load (`claude plugin details developer-os` prints `Skills (6)`). The Codex twin asserts `source.path` and cannot distinguish listing from loading (NEW-61). With NEW-60. |
| NEW-66 | generated skills / prompt hygiene | Every generated `SKILL.md` except `shared` carries the rendering note at `packages/workflow-schema/src/skill.ts:236` in model-visible text; every non-shared skill states the `vault-missing` refusal twice with two messages (`plugins/claude/skills/developer-os-capture/SKILL.md:11` and `plugins/claude/skills/developer-os-capture/SKILL.md:20`, same in the Codex tree); the `$input.text` placeholder emitted at `packages/workflow-schema/src/skill.ts:344-346` is never explained to the reader. Regenerate both trees after the fix. |
| NEW-67 | Spec 1 / amendment before execution | Spec 1 as approved prescribes `unlink`/`rmdir`/plan-last compaction (`docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md:624-641`, `:4164-4167`, `:4207-4216`) that the 2026-08-31 retention correction forbids; its `launchctl` row pins macOS 26.5.2 build 25F84 (`:3496-3522`) while the development machine runs a later build, with no fallback (`:1407`); it re-produces types Spec 2 already shipped; its status path `state/automation-<job>.status.json` (`:152`) differs from the implemented `automation-<job>.json`; its closed reservation set (`:143-155`) omits four Spec 2 state files; its three collision codes (`:109-117`) exist nowhere; and several §7 gates require a physical million-entry or 100,000-blob fixture. Founder decision 2026-09-04: split into 1a (config, coordinator, uninstall) and 1b (git, launchd). Amend before Task 1 of either plan. Roadmap Phase 4. |
| NEW-68 | Spec 2 / gaps before Task 8 | `ManifestMigrationPlanV1` (`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md:1143-1163`) lacks the `admittedExternalShapeHash` the fresh plan carries (`:937`); §6.2 does not say which mode a migration gives the artifacts it adds; the CLI evidence layer recognises only fresh-init identifiers, so migration residue would be invisible although `:1636-1642` requires exit 6; two plan-size limits conflict (`:844` versus `:1434`); `SafeReasonCodeV1` is used fourteen times and never defined; the "exact maximum succeeds" gates at `:4085` and `:4706` are arithmetically impossible within the stated byte limits. Baseline plan Tasks 8–9 still say "compact journal then plan last" (`docs/superpowers/plans/2026-08-29-developer-os-release-update.md:699`). Amend before Task 8. Roadmap Phase 3 and Phase 8. |
| NEW-54 | Core encoder / correctness | `assertString` in `packages/core/src/lifecycle/canonical-json.ts` does not reject a **trailing** lone high surrogate: at the last index `charCodeAt(index + 1)` is `NaN` and both range comparisons are false. `encodeCanonicalJson({ "\uD800": 1, "�": 2 })` therefore emits two identical `EF BF BD` keys — a wire form this module's own `decodeCanonicalJson` rejects as a duplicate key, and two distinct inputs that hash to the same SHA-256. Decide whether to reject at encode time and record the migration for anything already hashed. |
| NEW-57 | A11 / Task 6 / crash recovery | Three death points after global-lock creation (`after_global_lock_create`, `before_global_lock_parent_sync`, `after_global_lock_parent_sync`) resume to exit 6 because recovery admits an existing lock only from creation evidence that those deaths never made durable. **Ruled 2026-09-04 and recorded in Spec 2 §6.1 (Amended 2026-09-04)**; implemented by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 2. |
| NEW-56 | A11 / Task 6 / residuals | The three gates that could not fail are closed in the working tree: `vendorProcesses` now records `executable` plus args in the fixture runner before delegating; `releaseRequests` was removed because `PackagedReleaseSourceV1` carries no interceptable method, so add a release-fetch seam with the update surface in Spec 2 Tasks 8+ where a fetch exists to observe; `status.test.ts` builds its fixture with `bootstrapAvailable: true` so the inertness counter is live rather than pinned to 0; and a new `inventoryDigest` carries a SHA-256 per regular file, so the seven byte-inertness claims in `doctor.test.ts`, `init.test.ts` and `uninstall.test.ts` would now fail against an in-place rewrite. Still open: reads no longer enforce the retention cap — `init` still refuses before allocating, at both preflight and under the lock — but no test pins the read path, because genuine over-cap residue needs 257 envelopes, 1,000,000 entries or 12 GiB and no fixture builds one. No test creates two admitted active plans, so the `active.length > 1` term of `blocksNewIntent` is unexercised. `preserved` carries every recursive descendant of every directory tombstone, printing Brain note filenames on uninstall and costing one `canonicalize` per retained entry. The two-derivation residual is closed by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 3; `preserved` descendants remain open. |
| NEW-55 | A11 / Task 6 / implemented, uncommitted | **Closed by the founder's 2026-09-04 ruling, recorded in Spec 2 §6.4 (Amended 2026-09-04): forward-participant content is never a retention row, for every terminal outcome.** The earlier `installedTarget` reading covered `finalized` only and is replaced by `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md` Task 3. Reproduction before the fix: a successful `init` retired 14 of its own 105 manifest artifacts, including twelve files inside the user's Brain. |
| NEW-53 | A11 / performance / partially closed | `developer-os init` fell from roughly 219s to roughly 101s, and encoder allocations from 366,721,268 to 36,057,211, across b146f7e, ae12887 and 5b0696e. Two full inits now fit the e2e budget that blocked NEW-55, which is verified: that test ran 299.5s against its 600000ms timeout and no longer times out. The dominant cost was one call site, `rawCanonicalHash` under `validateJournalRecord`, re-hashing the whole plan per journal record: 60,947,939 of 91,052,556 key encodes. Attribute by keys encoded, not by call count; counting calls pointed at `sameValue`, which is nearly free because `sortKeysUtf8` only encodes object keys. Remaining: 36,057,211 allocations, led by `decodeCanonicalJson` and `journal-store.ts` re-encoding on every slot read, and `projectBootstrapRetentionPostimage` re-projecting directory trees. Whether that is worth closing depends on whether 101s is acceptable for `init`; the 30-minute CI timeout is still unproven against the full suite. Cause measured 2026-09-04: evidence inspection runs eight times per `init` (`apps/cli/src/bootstrap/executor.ts:626`, `:670`, `:1110`, `:1177`, `:1320`, `:2898`, `:2995`, and once from `init`; re-derived 2026-09-04 — the seven numbers first recorded here were wrong when written), and the report module resolves physical paths with a linear search per row. On an existing vault (V1 path) `init` completes in under one second. Roadmap Phase 2. |
| NEW-52 | test gate / CI budget | `npm test` is `test:bootstrap` (the executor file, two invocations) plus `test:suite` (every other file except the executor file and `e2e/**`); `npm run check` runs `lint`, `npm test`, `test:e2e`, the build and `git diff --check`, so the local gate still reaches every file. `check.yml` runs lint, bootstrap-executor, suite and e2e as four parallel jobs with 20/180/40/40 minute bounds; `suite` and `e2e` build `dist` before running. `e2e/**` stays excluded from `test:suite` because the `e2e` job owns it — `check` names `test:e2e` separately for that reason. Open: the executor file still needs roughly 200 s per test; NEW-53 owns the `init` cost that drives it. Restore a single `vitest run` only when the whole suite fits one 30-minute job. |
| NEW-51 | manifest guards / security | `pathEvidence()` in `apps/cli/src/bootstrap/executor.ts` supplies `reopenCanonicalAbsolutePath: (path) => resolve(path)`. `node:path.resolve` is lexical, so it returns any already-canonical absolute path unchanged and the refusal at `packages/core/src/update/paths.ts:96` can never fire for any consumer. Provide a reopening canonicalizer that detects symlinks, or delete the dead guard and record the accepted limit. Separately, give `uninstall.ts` the owner-authority bound the executor uses instead of `admitOwnerPath: (_owner, path) => path`. Recount 2026-09-04: the lexical `resolve` appears three times (`apps/cli/src/bootstrap/executor.ts:2216`, `apps/cli/src/commands/uninstall.ts:553`, and the report module) with `hasFoldedAlias: () => false` beside each, and the identity `admitOwnerPath` also appears in the report module, making `packages/core/src/manifest/v2.ts:31` a tautology. Roadmap Phase 2 extracts one admission module. |
| NEW-50 | Core encoder / performance | Five file-local copies of the per-comparison `compareUtf8` remain in `packages/core/src/manifest/bootstrap.ts`, `packages/core/src/update/release.ts`, `packages/core/src/manifest/bootstrap-retention.ts`, `apps/cli/src/bootstrap/retention.ts`, and `apps/cli/src/update/packaged-release.ts`; three pass it straight to `.sort()` and carry the same O(k log k)-encodes cost fixed in `canonical-json.ts`. Apply the same encode-once ordering, or extract one shared helper. |
| NEW-49 | review workflow / startable | Add a status input and correct the stale description at `workflows/review/workflow.yaml:4`, bump its version, regenerate both vendor skills, and pass drift tests. |
| NEW-47 | Codex adapter / startable | Read Codex source to prove whether model-run commands can emit raw bytes into the JSONL consumed by `packages/adapter-codex/src/invoke.ts:178`; record the dated result and use it with NEW-45 to choose message selection. No model call is required. |
| NEW-46 | A11 / security | Stop the ambient-marker-selected spawn at `apps/cli/src/commands/capture.ts:263` from resolving through same-uid `PATH`, or design manifest-owned persisted executable identity with upgrade/move drift behavior. |
| NEW-45 | founder credits | Run one real `codex exec` likely to emit a post-answer summary; record event count/order and which `agent_message` the schema constrains. Settle with NEW-47. |
| NEW-44 | capture agent detection | Observe nested vendor markers and replace the first-match behavior rooted at `packages/brain/src/capture/agent.ts:53-107` with attribution that does not select the outer session merely because its row comes first. Confirmed 2026-09-04: a Claude Code session exports `CLAUDECODE=1` to children, and a Codex process started from it (the second-opinion MCP server does exactly that) also carries `CODEX_THREAD_ID`, so `matchObservedAgent` records `sourceAgent: claude` with Claude's version for a Codex-authored capture. Roadmap Phase 1. |
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

- [ ] Execute `docs/superpowers/plans/2026-09-04-developer-os-task6-closure.md`, which closes the
  six tasks of
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

- [ ] Specify the managed artifact kind `instruction` with `source: default | user`, the artifact
  kinds for subagents, commands, output styles, skills, and vendor instruction files, and an explicit
  unsupported-vendor state (path-scoped rules emulated on Codex; output styles unsupported there).
- [ ] Founder decision 2026-09-04: every legacy artifact in `docs/migration/instruction-inventory.md`
  §1–§3 and §6 ships as a public default with client references redacted; personal overrides live
  under the product home as user data. No parallel private repository.
- [ ] Wire the existing adapter install proposals into `init` and `uninstall` first (NEW-60), then
  implement install, drift detection, and uninstall for every inventoried artifact on both vendors,
  re-registering the Codex plugin after each tree change (NEW-61).

### A12b · Brain workflows

- [ ] Specify `brain-answer`, `brain-compile`, `brain-enhance`, `brain-garden`, `brain-report` as
  canonical workflows, and `brain retire`, `brain refactor` and the lint classes `stale`,
  `isolated`, `dead-link`, `duplicate`, `gap` as deterministic verbs
  (`docs/migration/instruction-inventory.md` §7).
- [ ] The agent never writes to the vault directly: every proposed change is a capture that passes
  the ingest validators and a transaction.

### A13 · DOS-P11

- [ ] Specify the cross-vendor event mapping in `docs/migration/instruction-inventory.md` §4; every
  hook is a call to the installed `developer-os` binary (`guard command|path|commit|stop|format|prompt|edit`,
  `brain status --inject`).
- [ ] Founder decision 2026-09-04: `session_start_injection` returns as a product hook; the two
  transcript-dependent capture hooks stay declined.
- [ ] Codex hooks ship in the plugin manifest and are trusted manually by the user; the product never
  writes the Codex config file; `doctor` reports `plugin_hooks=unknown` until trust is granted.
- [ ] Implement only hooks that can be observed firing, name the installed binary, and participate
  in manifest drift/uninstall; third-party hooks beside them are reported as `external`.

### A14 · DOS-P12

- [ ] Keep the boundary with A11 explicit: A11 owns when scheduled work runs; A14 owns what it runs.
- [ ] Every script in `docs/migration/instruction-inventory.md` §5 is a verb or a recorded refusal:
  `import <path|dir>` (inbox files and Claude Code auto-memory into quarantine envelopes),
  `project init|check|worktree`, `repo audit|bootstrap|secrets-scan` (opt-in, `gh`-authenticated,
  baseline as user data), the `doctor` check `vendor-config`; the language gate stays a repository
  gate.

## 4. Program Tasks 8–9 and external blockers

### A15 · DOS-P8

- [ ] Write a dedicated plan against the finished output of A11–A14.
- [ ] Create `docs/migration/founder-cutover.md`, `founder-baseline-results.json`,
  `founder-shadow-results.json`, and `founder-cutover-manifest.json`.
- [ ] Keep the vault in place, preserve recovery data, never enable two copies of a mutating hook,
  and exercise rollback before declaring cutover stable.
- [ ] Founder decision 2026-09-04: migrate the founder's vault once, by hand with a throwaway script
  reviewed as a diff on a copy, using the mapping in `docs/migration/instruction-inventory.md` §8;
  `BRAIN_MIGRATIONS` stays empty. Then `import` the accumulated inbox in batches.
- [ ] The legacy runtime stays untouched until this entry (founder decision 2026-09-04, risk
  accepted): product hooks restore its guards at cutover; afterwards boot out the legacy scheduled
  jobs, remove the legacy import block, the legacy plugin on both vendors, dead symlinks and
  orphaned generated agents. Archive the legacy repositories after one stable cycle; never delete.
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
