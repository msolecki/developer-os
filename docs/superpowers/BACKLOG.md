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
| A11 · DOS-P7 | Spec 1a (plan 1a, `plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, against Spec 1 as amended 2026-09-17), Spec 2 Tasks 10–11 and the production V2 `init` wiring (D16), with NEW-79, NEW-81 and NEW-85 before the pin is removed; NEW-80 moved into plan 1a (D29) | current |
| A12 · DOS-P10 | spec, plan, implementation for the instruction artifacts in `docs/migration/instruction-inventory.md` §1–§3 and §6 | A11 |
| A12b · Brain workflows | spec, plan, implementation for the vault workflows in `docs/migration/instruction-inventory.md` §7 | A12 |
| A13 · DOS-P11 | spec, plan, implementation for the 11 non-transcript hooks in `docs/migration/instruction-inventory.md` §4, plus session-start injection | A12b |
| A14 · DOS-P12 | spec, plan, implementation for the 14 automation scripts in `docs/migration/instruction-inventory.md` §5 | A13 |
| A15 · DOS-P8 | dedicated cutover plan and founder shadow migration | A14 |
| A11b · DOS-P7 remainder | Spec 2 Tasks 12–26 (update, rollback), then Spec 1b (git, launchd) (D16) | A15 |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A11b, L1, L2 |

The phase order, the founder decisions of 2026-09-04 and 2026-09-16 that fixed it, and the documents each phase
expects are in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.

## 1. Open repository rows

There are 46 numbered rows. They are not automatically ordered ahead of A11.

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-79 | V1 refusal recovery / Phase 4b (D20) | **The recovery the V1 refusal prints does not work.** With the packaged capability, `init` over a V1 manifest refuses and prints "developer-os uninstall, then developer-os init" (`apps/cli/src/bootstrap/report.ts:190`). V1 `uninstall` leaves `staging/`, `state/transactions` and `backups/` (Foundation residual 4, pinned by `tests/e2e/foundation.test.ts:793-860`), and fresh V2 `init` then refuses with exit 6, "product home contains an unbound reusable directory" (`apps/cli/src/bootstrap/executor.ts:1144-1158`). Probed against the built CLI on 2026-09-17; `init.test.ts` asserts only the string. Decision D20: the recovery becomes "developer-os uninstall, then archive the product home manually, then developer-os init", and Spec 2's D18 amendment already says so. Close with a failing test first — shipped V1 `init`, refusal, `uninstall`, archive, then `init` with the capability succeeds — then the string, `docs/architecture/foundation.md` and `docs/architecture/threat-model.md`. Unreachable in production until the pin at `apps/cli/src/context.ts:765` goes; resolve before that. |
| NEW-80 | release layout / plan 1a Task 1 (D19, D29) | **Fresh `init` writes release metadata and the rollback root where Spec 2 §3.2 does not put them.** §3.2 fixes hash-derived `state/release-metadata/{delegations,indexes,bundles}/<hash>.json` and a product-home `rollback` root (`docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md:268-290`). The executor writes `releases/metadata/<packaged file name>` (`apps/cli/src/bootstrap/executor.ts:2016`) and `state/rollback` (`apps/cli/src/bootstrap/executor.ts:1136`), and the handoff admission hard-codes `state/rollback` (`apps/cli/src/bootstrap/report.ts:1499`). Decision D19: the code follows §3.2, because packaged names cannot hold the active and rollback identities' metadata side by side and the launcher (Task 10) validates hash-derived paths. Close in plan 1a Task 1 (D29, moved from Phase 4b), together with the exact-set test over a fresh plan's `createdPaths` and `launchabilityPaths` that Task 1 restores, and so before Task 10 and before the pin is removed. Free while no V2 installation exists; an on-disk migration after Phase 4b. |
| NEW-81 | ordinary-command gate / Phase 4b | **The dispatch gate needs hardening before the pin is removed** (Phase 3 final review M4, M5, M6, N-1 to N-4, m6). (1) Post-uninstall routing has only incidental coverage — an `uninstall --yes` inside the alteration loop in `apps/cli/src/main.test.ts`, its exit unasserted; add an explicit case. (2) Gate cost grows with retained envelopes, a full plan admission per command for up to 256 IDs; measure with a realistic bundle and many envelopes, then bound or short-circuit. (3) A symlinked product home, `$HOME` or `state` refuses every command as exit 6 with the archive message, while `init` refuses exit 2; refuse as invalid input naming the root. (4) A refusal can print up to 1,000,000 retained paths on every command; report retention roots in the gate and in `init`. (5) Bare catches hide the inspection failure's class (`apps/cli/src/bootstrap/report.ts:1390-1394`), so a `status` run during a concurrent `init` tells the user to archive evidence (`apps/cli/src/bootstrap/context.ts:125-131`); publish a redacted class and the roots involved. (6) The pre-publication resume branch is pinned only by exit code; assert kind, message and recovery for an `after_plan` envelope when launcher routing lands. |
| NEW-82 | Spec 1 handoff admission / plan 1a | **`admitV2Handoff` is a fresh-install snapshot, and Spec 1 is its first caller** (Phase 3 final review M2, M3, M7, m4, m5). One `incompleteHandoff` reason cannot tell a non-terminal envelope from no finalized one, and its catch-all hides programming errors; "manifest without a runtime reservation" exercises the hash pin rather than completeness; a directory at `state/lifecycle-activation.json` passes as an absent record, because `guardedFile` returns null for any non-regular entry (`apps/cli/src/bootstrap/report.ts:1437-1443`); and `listNames` is wired to `readdir` instead of being injectable beside `reader` (`apps/cli/src/bootstrap/context.ts:238`). Close in plan 1a, in the change that composes Spec 1's structural admission (Spec 1 §2.1, "Admission of an installed V2 home", amended 2026-09-17). |
| NEW-83 | `init` evidence classification / Spec 2 §6.4 | **Bootstrap evidence classification departs from §6.4's words in two remaining places** (Phase 3 reviews). A `retaining` envelope whose outcome is `rolled_back` is admitted before handoff, and truncated slots after uninstall route to `init`; decide both against §6.4 and pin them. **Narrowed 2026-09-17:** the third place, the live `.lifecycle-bootstrap.lock` filtered out by name before classification (`apps/cli/src/bootstrap/report.ts:1150-1151`), is settled by Spec 1's NEW-67 amendment (A3) — a bootstrap leaf is attributable to an envelope only when its identity equals that envelope's persisted bootstrap lock identity — and plan 1a makes the code match. |
| NEW-84 | Spec 1b / `launchctl` re-pin / Phase 9 | **Both launchd process tables pin a macOS build the development machine no longer runs.** Spec 1 pins macOS 26.5.2 build `25F84` and one `/bin/launchctl` hash in `LaunchdPreviewObservationProcessTableV1` and `SupportedLaunchdProcessTableV1`, refuses any other row as `unsupported_launchd_distribution`, and certifies per exact build; the machine reported 26.6.2 build 25G83 on 2026-09-17. The Git distribution row carries the same risk by design (Spec 1 §8.3 residual 6). Close before Spec 1b executes with a freshly measured row, a re-pinning rule, and the certification run — a live-machine founder stop. Carried out of NEW-67 by its amendment (A10), which changed no text. |
| NEW-85 | Spec 1 uninstall capacity / Phase 4b (D26) | **`F(uninstall_artifacts)` holds at most 256 mutations, so a V2 release bundle of more than about 197 files cannot be uninstalled.** Spec 1 §2.4 bounds `FoundationParticipantRefV1.mutations` to 1..256 and `participants.foundation` to 0..64, and both uninstall variants have one `F(uninstall_artifacts)` step; a fresh V2 manifest owns about 59 removable non-bundle files plus every bundle file, while Spec 2 admits up to 200,006 launchability paths. Plan 1a Task 22 refuses before allocation with `uninstall_artifact_capacity_exceeded` (exit 4). Decide before Phase 4b fixes the real bundle (D26): repeat `F(uninstall_artifacts)` (at most 31 forward/compensation pairs), cap the bundle's file count in Spec 2 §4.4, or both. |
| NEW-75 | ingest isolation residual / vendor behaviour | **An isolated Claude run still writes into the user's real home, and the fix that looked obvious is refused.** Observed 2026-09-05 against 2.1.261 with the shipped argv: despite `--no-session-persistence`, one invocation durably creates `.claude.json`, `.claude/.last-cleanup`, a timestamped `.claude/backups/` snapshot, and per-process `.claude/sessions/` `.json` and `.key` files. Because the adapters hand the child `env: {}`, it has no `HOME` and resolves one through `getpwuid_r`, so in production those files land in the developer's own `~/.claude`. **Decision D15, 2026-09-07: supplying a product-owned `HOME` is not the close.** `codex exec --help` records that `--ignore-user-config` leaves auth on `$CODEX_HOME`, which derives from `$HOME`, so the same resolution that strews these files is the one that finds each vendor's credentials; moving it moves both. F2 stands and both adapters keep `env: {}`. Closes only on each vendor's credential path supplied separately, plus one real authenticated `ingest` per vendor proving it — a founder stop condition, because it spends model credits. Full detail in `docs/architecture/vendor-invocation.md`. |
| NEW-76 | test infrastructure / ingest | `prepareAgentWorkspace` uses a fixed leaf under `tmpdir()`, so every test that reaches the Codex arm — five in `apps/cli/src/commands/ingest.test.ts`, plus cases in `main.test.ts` and `tests/security/` — creates and never removes one real shared directory on the developer's machine (`<tmpdir>/developer-os-agent-workspace`, observed present 2026-09-07). It is exactly the collision the injected filesystem in `describe("prepareAgentWorkspace")` avoids for the unit cases and does not avoid for the integration ones: a leftover with a widened mode — from a `sudo` run, or from another local user on a shared `/tmp` — reddens those tests with the product's own correct refusal. Close by pointing `TMPDIR` at fixture-owned scratch for the affected cases, or by moving the leaf onto a `CliFileSystem.mkdtemp`, which the docblock already records as the stronger design and rejects only because that interface would have to grow a method. Deliberately not fixed with the 2026-09-07 change that found it: a suite-wide `TMPDIR` stub lengthens every fixture path in a 4570-case suite, which is not a change to make inside a security correction. |
| NEW-78 | Core bootstrap / dead code | **The `v1_to_v2` arm Tasks 1–7 shipped into Core is dead since decision D18 (2026-09-17) withdrew the V1→V2 migration.** About a hundred references remain across `packages/core/src/manifest/bootstrap.ts`, `bootstrap-retention.ts`, `manifest-state.ts`, `v2.ts`, `types.ts`, `packages/core/src/update/paths.ts`, `packages/core/src/transactions/executor.ts`, `apps/cli/src/bootstrap/journal-store.ts` and their tests: the `ManifestMigrationPlanV1` union arm, `tx_mm`/`mm_`/`manifest-migration` grammars, and the `v1-migration-external-shape` digest domain. Every reader of the bootstrap state machines pays for an operation no code path can start. Close by deleting the arm and narrowing each union to `fresh_v2_init`, keeping `ManifestV1NotMigratableError`, which the V1 refusal in `init` uses. Not on the Phase 3 path. |
| NEW-60 | adapters / install path | No production code path installs either plugin: `proposeClaudeInstall`, `proposeCodexInstall`, `renderClaudePlugin` and `renderCodexInstallTree` have no caller under `apps/cli/src` outside tests, and `init` writes both `adapters.*` as `false`. After `developer-os init` a user has no skill installed on either vendor. First step of A12 (roadmap Phase 5): wire the existing proposals into `init` and `uninstall` behind the adapter selection the design's §9.1 already promises. |
| NEW-61 | Codex adapter / cache | Codex 0.151.0 loads skills from `<CODEX_HOME>/plugins/cache/developer-os/developer-os/0.0.0/skills`, not from the product tree the manifest hashes; an in-place re-render is invisible until `codex plugin add` runs again (`docs/architecture/codex-adapter.md` §14). `PLUGIN_VERSION` at `packages/adapter-codex/src/plugin.ts:78` names that cache directory. The update lifecycle must re-register after every tree change, and `tests/integration/codex/plugin-loads.test.ts:213-232` must assert loading (`codex debug prompt-input`), not listing. Roadmap Phase 5. |
| NEW-62 | capability model | `CAPABILITY_STATES` (`packages/core/src/capabilities/index.ts:25`) has no `no` state, so both adapters' `resolveCapabilities` fold an `absent` observation and an `unavailable` observation into `unknown` (`packages/adapter-claude/src/capabilities.ts:74-79`, `packages/adapter-codex/src/capabilities.ts:81-85`), contrary to their own docblocks; `doctor` prints `skills=unknown` both when the plugin is verifiably not installed and when the probe could not run. `DOCUMENTED_FLOORS` map every key to `null` in both `versions.ts` files, so the floor table adds nothing over the minimum version. Add `no`, and re-measure the floors against 2.1.260 and 0.151.0. |
| NEW-63 | Core retention / duplication | `packages/core/src/manifest/bootstrap-retention.ts:1259-1284` and `packages/core/src/manifest/bootstrap-retention.ts:1932-1974` carry the same collapse → role order → tombstone-path pipeline with different "is a directory" predicates; a divergence gives `deriveBootstrapRetentionLocations` and `deriveBootstrapRetentionTable` different ordinals, so retention would write a tombstone the reader does not check. Extract one `collapseAndOrder(rows, isDirectory)`. Also six file-local copies of `compareUtf8` (NEW-50 counts five). Roadmap Phase 2. |
| NEW-64 | documentation drift | Corrected 2026-09-04 by `6e3ce69`: what `init` installs into a new vault is now one consistent bullet (`docs/architecture/foundation.md:607`). Still open: `docs/architecture/foundation.md:15-24` says four packages (eight workspaces); `docs/architecture/foundation.md:34` says one command per module (six modules under `commands/` are not commands); `docs/releases/foundation-checkpoint.md:93-107` counts eight artifacts and thirteen files; `docs/architecture/threat-model.md:832` quotes a sentence that is not in this file; `docs/architecture/threat-model.md:55`, `:507` and `:902` cite an `ORDER.md` section that no longer exists; twelve places cite `BACKLOG.md` §8 as an amendment index it no longer is; a 24-citation sample found 14 line references pointing at unrelated code (NEW-34's class). Fix the remainder immediately after the Task 7 checkpoint. Also `templates/brain/content/templates/note.md:13` ships `occurrences: 0` while the schema requires an integer of at least 1. |
| NEW-65 | integration tests / loading | `tests/integration/claude/plugin-loads.test.ts:96-129` asserts only that `claude plugin validate` prints no error; in 2.1.260 that command returns `"contents": []` and never reads `SKILL.md`, so the suite has no assertion that the six skills load (`claude plugin details developer-os` prints `Skills (6)`). The Codex twin asserts `source.path` and cannot distinguish listing from loading (NEW-61). With NEW-60. |
| NEW-66 | generated skills / prompt hygiene | Every generated `SKILL.md` except `shared` carries the rendering note at `packages/workflow-schema/src/skill.ts:236` in model-visible text; every non-shared skill states the `vault-missing` refusal twice with two messages (`plugins/claude/skills/developer-os-capture/SKILL.md:11` and `plugins/claude/skills/developer-os-capture/SKILL.md:20`, same in the Codex tree); the `$input.text` placeholder emitted at `packages/workflow-schema/src/skill.ts:344-346` is never explained to the reader. Regenerate both trees after the fix. |
| NEW-69 | bootstrap executor / admission | `reusableFreshDirectoryCandidates()` (`apps/cli/src/bootstrap/executor.ts:1123`) exempts `paths.backupsDir` from the rule that every reusable pre-existing directory must contain at least one admitted retained path (`apps/cli/src/bootstrap/executor.ts:1147`). An unrelated `~/.developer-os/backups` is therefore dropped from `createdPaths` (`apps/cli/src/bootstrap/executor.ts:1835`), recorded as a `preexisting` parent identity, and added to `admittedPreexistingPaths` (`apps/cli/src/bootstrap/executor.ts:1951`), widening both shape whitelists with no check on its contents and no stated reason. Two attempts to construct a state proving the exemption dead both failed, so it was left in place rather than removed on a guess. Close by holding it to the same rule or by recording why it is load-bearing. **2026-09-17:** Spec 2 §6.1 now names `staging` and `backups` explicitly as bookkeeping parents admitted by shape (Spec 1 NEW-67 A12), so the exemption has no remaining reason; close in plan 1a with shape admission. |
| NEW-70 | bootstrap executor / dead branch | The `reusableGlobalLock` fallback inside `createPlannedPath`'s evidence-present arm (`apps/cli/src/bootstrap/executor.ts:2898-2903`) is dead as a success path: entering it requires the executing plan's own ordinal-0 creation evidence not to match the live inode, while the other envelope's reusable record must equal that same live inode, and the two cannot both hold. The only remaining shape is hand-corrupted evidence, which the unconditional `sameValue(observed, evidence)` check (`apps/cli/src/bootstrap/executor.ts:2964`) refuses anyway. Its one reachable effect is converting exit 6 into exit 5 in a corrupt-evidence state. Collapsing the branch to a plain refusal keeps the tests green. |
| NEW-71 | Task 6 review / four smaller findings | The §6.4 `it.each` case (`packages/core/src/manifest/bootstrap-retention.test.ts:1933`) does not assert `forwardTargets.size > 0`, so it is non-vacuous only against today's fixture. `admitPostPlanInitialWrite` (`apps/cli/src/bootstrap/executor.ts:880`) accepts any shape-correct `.lifecycle.lock` without binding it to the reusable global lock's `dev`/`ino`, while `inspectExactPreIntentShape` (`apps/cli/src/bootstrap/executor.ts:853-859`) does bind it, leaving a same-uid inode-swap window between the two checks. `retainedParentAuthorities` is emitted for any envelope with `exactSelection && terminalRetained` (`apps/cli/src/bootstrap/report.ts:970`), `altered` ones included, contradicting its own docstring (`apps/cli/src/bootstrap/report.ts:113`). `admittedEvidence()` (`packages/core/src/manifest/bootstrap-retention.test.ts:1282`) adds `mutation.targetPath` for every participant where production adds it for forward only (`packages/core/src/manifest/bootstrap-retention.ts:1070`), so that fixture no longer mirrors the derivation it tests. |
| NEW-54 | Core encoder / correctness | `assertString` in `packages/core/src/lifecycle/canonical-json.ts` does not reject a **trailing** lone high surrogate: at the last index `charCodeAt(index + 1)` is `NaN` and both range comparisons are false. `encodeCanonicalJson({ "\uD800": 1, "�": 2 })` therefore emits two identical `EF BF BD` keys — a wire form this module's own `decodeCanonicalJson` rejects as a duplicate key, and two distinct inputs that hash to the same SHA-256. Decide whether to reject at encode time and record the migration for anything already hashed. |
| NEW-56 | A11 / Task 6 / residuals | `preserved` carries every recursive descendant of every directory tombstone, so uninstall prints Brain note filenames and pays one `canonicalize` per retained entry; roadmap Phase 2 replaces it with the maximal retention roots. No test creates two admitted active plans, so the `active.length > 1` term of `blocksNewIntent` (`apps/cli/src/bootstrap/report.ts:1115`) is unexercised. |
| NEW-53 | performance / init and suite wall clock | **About 99% of an `init` is canonical-JSON encoding, not disk, and the remaining cost is therefore closable rather than inherent.** `developer-os init` fell from roughly 219s to roughly 101s across b146f7e, ae12887 and 5b0696e, and evidence inspections per fresh init from 8 to 3; `executor.test.ts` fell from ~169 to 127.5 minutes. **Rewritten 2026-09-07 from "roughly 126 minutes of real fsync-backed transactions this program never targeted", which was wrong and load-bearing** — it framed the remainder as the price of durability, so nobody would attack it. Two numbers already in this repository disprove it: `apps/cli/vitest.config.ts` records a real install writing its **73 files in about 0.8 s**, against an `init` of **~101 s**; and this row's own profile records **91,052,556 canonical JSON key encodes**, 60,947,939 of them from `rawCanonicalHash` under `validateJournalRecord`, to write those 73 files. A 2026-09-07 profile of the live suite put `node::encoding_binding::BindingData::EncodeUtf8String` as the heaviest leaf frame, measured a CPU/wall ratio of 1.01, and found zero fsync frames; `MarkCompact` appeared 109 times. Remaining work is the encoder, not the disk, and a 2026-09-07 profile of a real `init` names three call sites rather than a module. (1) `encodeString` in `packages/core/src/lifecycle/canonical-json.ts` appends **one character at a time** — `encoded += value[index]` for every ordinary character — so each string costs a cons-string per character that V8 must flatten and collect; the profile showed `EncodeUtf8String` 317 samples, `MarkCompact` 267, `Builtins_StringAdd_CheckNone` 80 and `SlowFlatten` 16, against ~152 for all `node::crypto::*` combined. A scan-then-slice fast path would make the common no-escape string one operation. (2) `decodeExactCanonical` in `apps/cli/src/bootstrap/journal-store.ts` **re-encodes the whole record on every read** to prove it was canonical — decode, full re-encode through that per-character loop, compare. (3) `exactBytes` beside it compares with `left.every((value, index) => value === right[index])`, a JS closure per byte where `Buffer.compare` is one `memcmp`. Also still open: `projectBootstrapRetentionPostimage` re-projecting directory trees. Two of the three shapes were benchmarked in isolation on 2026-09-07: scan-then-slice is **5.3x** the current `encodeString` on representative plan strings (paths, hashes, ISO timestamps — none of which need escaping, so the per-character loop is pure overhead), and `Buffer.compare` is **225x** the current `exactBytes` (422 ms against 2 ms over 200 comparisons of a 512 KiB buffer). **Those are shape-level microbenchmarks, not end-to-end `init` measurements**, and the second is the one to be careful with: a 225x on a function is worth only as much as the share of `init` that function owns, which is unmeasured. Whoever takes this row should re-profile after each change rather than assume the ratios compose. The prize is large — if `init` cost even 2 s, `executor.test.ts` would run in about 3 minutes instead of 122, and the 180-minute CI budget would be unnecessary. Attribute by keys encoded, not by call count. See `docs/architecture/foundation.md` §9 and the D13 amendment of 2026-09-07. |
| NEW-50 | Core encoder / performance | Five file-local copies of the per-comparison `compareUtf8` remain in `packages/core/src/manifest/bootstrap.ts`, `packages/core/src/update/release.ts`, `packages/core/src/manifest/bootstrap-retention.ts`, `apps/cli/src/bootstrap/retention.ts`, and `apps/cli/src/update/packaged-release.ts`; three pass it straight to `.sort()` and carry the same O(k log k)-encodes cost fixed in `canonical-json.ts`. Apply the same encode-once ordering, or extract one shared helper. |
| NEW-49 | review workflow / startable | Add a status input and correct the stale description at `workflows/review/workflow.yaml:4`, bump its version, regenerate both vendor skills, and pass drift tests. |
| NEW-46 | A11 / security | Stop the ambient-marker-selected spawn at `apps/cli/src/commands/capture.ts:263` from resolving through same-uid `PATH`, or design manifest-owned persisted executable identity with upgrade/move drift behavior. |
| NEW-45 | founder credits | Whether a real `codex exec` turn ever emits more than one `agent_message` is the one question Codex source could not settle, and it is what the last-wins tie-break in `packages/adapter-codex/src/invoke.ts` rests on. Narrowed 2026-09-05: NEW-47 is closed from source — `TurnCompletedEvent` carries only `usage`, so there is no deterministic replacement to compare against — and the vendor's own `final_message_from_turn_items` picks the last agent message, which corroborates the tie-break without observing it. What remains needs one paid run likely to emit a post-answer summary; record the event count and order. |
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
| NEW-29 | test infrastructure | **Narrowed 2026-09-08, not closed, and decision D13's closure of it was premature.** D13 closed this row on the grounds that the eight retained-evidence timeouts were machine contention at load average 47 and did not reproduce on a quiet machine — which held: they never appeared again, locally or in CI. But the row is the *class* of elapsed-time assertions, not those eight cases, and another member of it failed on CI the same week: `packages/security/src/redaction.test.ts`'s "adds bounded per-pattern overhead over a single-pattern baseline" timed out in run 34133320221. Its budget was miscomputed rather than merely tight — derived from a min-time covering two passes when the body runs eight — and is corrected, but the assertion is still a wall-clock ratio. It stays that way because the property is that `addUserPatterns` folds the haystack once rather than per pattern, and counting that means observing the module-private `buildFoldedHaystack`; exporting it purely for a test would widen a package's public surface to measure an internal. Close by giving that module a counting seam, or by documenting the bounded-retry policy this row's original text already offers as the fallback. |
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

- [x] Roadmap Phase 1 closed 2026-09-05 as `4fe131c..8e9381a`: the ingest invocation is isolated on
  both vendors (NEW-58), nested-session attribution resolved (NEW-44), and the Codex final-answer
  selection settled from source (NEW-47). F1 and F3 were answered without spending model credits and
  F2 was decided against widening, so none became a founder stop. The plan was deleted at closure;
  its surviving constraints are in `docs/architecture/vendor-invocation.md` and the adapter and
  threat-model notes. Two residuals opened: NEW-74, closed 2026-09-07 under decision D14, and
  NEW-75, which D15 narrowed rather than closed.
- [x] Bootstrap performance and the first push (roadmap Phase 2), closed 2026-09-07/08 as
  `632f220..446148b`. Ten tasks. NEW-51, NEW-59 and NEW-52 closed; NEW-53 rewritten to the encoder
  cost it actually leaves; NEW-29 narrowed rather than closed. The push landed
  `d72287a..446148b` and CI is green on all five jobs for the first time in this program. The plan
  is deleted at closure; its surviving constraints are in `docs/architecture/foundation.md` §4 and
  §9. It also fixed a shipped defect no local gate could see — `RENAME_FLAGS` passed an undefined
  bit to `renameatx_np`, breaking every retained rename on macOS 15.
- [x] Roadmap Phase 3 closed 2026-09-17 as `810d342..43c30e4`: `ManagedArtifactV2`,
  `InstallationManifestV2`, `ManifestStatePlanV1` and the V2 new-init handoff exist; the existing-install
  migration was withdrawn by D18 and its code reverted; `init` refuses a V1 manifest once the packaged
  capability exists; ordinary commands refuse during non-terminal bootstrap state; the strict handoff
  admission exists. `npm run check` passed on `43c30e4`. Its review findings are NEW-79 to NEW-83 and
  the 2026-09-17 additions to NEW-67.
- [ ] Execute plan 1a (`plans/2026-09-17-developer-os-opt-in-surfaces-1a.md`, roadmap Phase 4; Tasks 1–7, 21 and 23 of `plans/2026-08-28-developer-os-opt-in-surfaces.md` rewritten against Spec 1 as amended, founder decisions D24–D29). Plan 1b (Git, launchd) follows A15 from the rest of the 2026-08-28 plan.
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
| Repository validation | `npm run lint` per commit; `npm run check` (`lint`, tests, build, `git diff --check`) at phase or plan close (D17) |
| Focused verification | command named by the active plan step |
| Fresh-context review | reviewer did not author the task |
| Exact-path staging | explicit task-owned paths; never `git add -A`, `git add .`, or a wildcard |
| Generated artifacts | clean regeneration diff for adapter/workflow changes |
| Security | relevant sentinel, path, prompt-injection, transaction, and network suites |
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
