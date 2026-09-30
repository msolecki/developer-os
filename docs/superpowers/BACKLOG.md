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

The phase closes of 4b through 9 ran on 2026-09-25/26 (full suite green on `bc17550`, whole-phase
reviews, PR #15 merged); `ORDER.md` records the evidence. The D70 build-only lane closed NEW-113's
code, NEW-110 and 35 backlog rows on 2026-09-28/29 under D75 (§1): reviewed, tests written but not
run, so the founder's full `npm run check` and `npm run test:pinned-host` are owed.

| Entry | Work still required | Blocked by |
|---|---|---|
| A13 · DOS-P11 | founder stops only: the Codex real-agent matrix (NEW-104, after 2026-10-22); Claude's unobserved rows and the isolated-`ingest` check (NEW-127). The plan closed 2026-09-29 | founder |
| A15 · DOS-P8 | `docs/migration/founder-cutover.md` steps 1–15 done (2026-09-28/29); steps 16–18 after a week of use, step 19 after one stable cycle, Codex hook approval after 2026-10-22 | founder, live machine |
| A11b · DOS-P7 remainder | Task 11b parked (NEW-111, NEW-112, NEW-118): the real-release half of Phase 8's gate; NEW-113 Task 5, the Phase 9 gate on a disposable account. Closure Tasks 9–10 and Task 26 closed 2026-09-29 with NEW-110 (D75) | D46, founder |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A11b, L1, L2 |

A11 (Phase 4b) and A14 (Phase 7) have nothing left of their own: Task 11b is tracked under A11b, and
A14's template scan ran with A12's (0 findings, 2026-09-28).

The phase order, the founder decisions of 2026-09-04 and 2026-09-16 that fixed it, and the documents each phase
expects are in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.

## 1. Open repository rows

There are 26 numbered rows. They are not automatically ordered ahead of A15.

**Closed 2026-09-29 under D75** (the D70 lane; tests written, not run — the founder's full `npm run
check` is owed, and a red run reopens the row its failure belongs to): NEW-20 (`de383fc5`, import
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

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-100 | uninstall → `init` round-trip gate deferred whole / plan 1a Task 24, D42 | **Plan 1a Task 24 (`uninstall-round-trip.v2.test.ts`) is carved out of plan 1a entirely and deferred to post-A16 hardening (D42, 2026-09-22), superseding D39's narrower plan of running it with `A9_KILL_POINTS` cut from ten to six.** The founder judged this class of heavy real-filesystem e2e proof — chained `init → uninstall → uninstall → init → uninstall → init`, plus an A9 kill-matrix reusing one home — not worth the wall clock now (an implementer had already run past the file's own ~31-minute local estimate when the decision was taken), against shipping the rest of the roadmap's plans first. **Full spec, including the exact ten candidate kill points and D39's selection rule, is §7.1 of `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` (moved there from plan 1a Task 24 on 2026-09-26, when the plan file was deleted).** Close by running §7.1 exactly as written there — with a real measured duration feeding the `timeout-minutes` of the `lifecycle-v2` shard the file runs in, under the 300-minute cap, applying D39's selection rule to keep six of the ten candidate points, and recording the four dropped points' equivalence arguments — once, alongside the codebase's other heavy e2e suites, after A11b and A12–A16 close. **Accepted risk until then:** beyond what Tasks 20–23b's own suites exercise (one reinstall cycle, and the NEW-99 regression Task 23's own chain already covers), the `uninstall` → `init` round trip is unproven end-to-end, and all four of the recovery microstates D39 would have selectively dropped are instead entirely uncovered. `test:lifecycle` is now sharded (below), which is what avoids a future cut once this finally runs — but not by default: at its ~31-minute local estimate the file would land in `test:lifecycle:rest` and push that shard to ~317 minutes, over the cap, so give it its own shard (or one with room) budgeted from its measured duration. **2026-09-26: now blocking CI.** On PR #15 the hosted runner cancelled `bootstrap-executor` at its 330-min and `lifecycle-v2` at its 185-min timeout (local: 122 and 153 min); the founder merged on the local full-suite evidence (`bc17550`). Shard both jobs in `.github/workflows/check.yml` (lifecycle by file, bootstrap by `-t` group) before the next PR. **2026-09-26: the CI half is done.** `bootstrap-executor` is a two-shard matrix by `-t` group (`test:bootstrap:main`, 54 cases, 225 min; `test:bootstrap:fine-grained`, 40 cases, 280 min) and `lifecycle-v2` a three-shard matrix by file (`test:lifecycle:uninstall`, 4 files, 206 min; `test:lifecycle:core`, 6 files, 201 min; `test:lifecycle:rest`, the other 11, 224 min), each budget ceil(local bound x 3) under the 300-minute cap, with `fail-fast: false`. `vitest list` per filter shows the shards partition the unsharded 94 and 208 tests exactly, by test id; `test:bootstrap`, `test:lifecycle`, `npm test` and `npm run check` are unchanged. The local bounds are conservative estimates, not green per-file measurements (`check.yml` names each figure's source), and PR #15 implies a hosted ratio of at least 2.7x against the formula's 3.0x ceiling, so lower or confirm each budget from the first green sharded run. **The row stays open for the round-trip half** (§7.1, post-A16, D42). |
| NEW-104 | A13 / founder, Codex real-agent matrix, after 2026-10-22 | **The Codex half of A13 is observed only on a mock model.** Task 15 shipped the Codex hooks under D57 (`4041286`..`2bec6a7`, tests green on `bc17550`) from observations against a local mock Responses API (`docs/architecture/hooks.md` §1), because the account's Codex quota is exhausted until 2026-10-22. The A13 plan closed on 2026-09-29 with this row owning its Task 18 Step 2 (`git show 343f8453:docs/superpowers/plans/2026-09-22-developer-os-hooks.md`): in a real Codex session, observe the product hooks **not** firing before manual trust, then after trust each supported row's effect — a planted `curl … \|` ⏎ `sh` not executed, a `.env` patch refused, `git push --force` refused, a type error preventing stop and the second stop allowed, the formatter changing the file, the project note in the first turn, a matching skill rule in context, the shared-file advisory — with a firing record afterwards and `doctor` reporting `plugin_hooks=yes` and `session_start_injection=yes`. Also confirm cwd-relative `apply_patch` resolution inside a git repository (phase 6 review m4; observed only outside git) and that the real model's `apply_patch` forms stay inside `hooks.md` §3.3's grammar (`*** End of File` and a blank line refuse). The Codex half of NEW-127's isolated-`ingest` check runs in the same session. Transcribe the results into `hooks.md` §4 and list any `unsupported (<reason>)` row for founder acceptance. |
| NEW-111 | launcher stubs / Spec 2 Task 11b (D46), phase 4b review M2 | **The launcher ships two stubs that are tracked only as `ponytail:` comments.** (1) `apps/launcher/src/main.ts:93` always passes `bootstrapClosure: { kind: "handoff_complete" }`, so Spec 2 §3.1's bootstrap routing is not met; the CLI's ordinary-command gate softens this. (2) `apps/launcher/src/main.ts` never passes `updateEnvelope`, so any `executing` update record is refused as an orphan, exit 6 (`apps/launcher/src/selection.ts:529`). Close both when Task 11b wires the read-only closure and envelope readers; until then the launcher is not an install path (A11 row in `ORDER.md`). **Plan closed 2026-09-26 (D68):** Task 11b (founder root-key decision, production bootstrap pin replacement) and Task 26 (lifecycle proof, file list and gate matrix) are in `git show a03499c:docs/superpowers/plans/2026-08-29-developer-os-release-update.md`. **2026-09-29:** NEW-110 (closed; `update --apply`, `update rollback --apply` and the synthetic lifecycle proof landed, D72, D75) left Task 11b owning the rest of Phase 8: the launcher FD 3 document as the production `UpdateFallbackHandoffV1` source (the production composer refuses `update_fallback_unavailable`, exit 4, until then), real release roots (`LAUNCHER_OFFLINE_RELEASE_ROOTS = []`), the packed planner and verifier binaries (the verifier joins `PLANNER_ENTRYPOINTS` with that packer), the real-release half of the Phase 8 gate, and the persisted-format migrations Spec 2's D72 block owes "no later than Task 11b" (`compensationCause` at `schemaVersion: 2`, the leaf-domain migration hash, P8's bookkeeping grammar). |
| NEW-112 | Spec 2 Task 11b / A16 (launcher identity) | **`update` accepts an FD 3 offline-trust document from any parent process, not only the launcher** (phase 4b re-review R1, 2026-09-25). Spec 2 §4.2 expects the launcher to be the only source. Hidden today: `LAUNCHER_OFFLINE_RELEASE_ROOTS = []` (D46) makes every unsigned-local update refuse. Binding the parent needs a fixed installed launcher path (A16 packaging) to compare with `proc_pidpath(ppid)`; `ps -o comm=` is not reliable and a `node`-name check would give false assurance. Close before Task 11b or A16 by binding the launcher's executable identity, with a test that a non-launcher parent's FD 3 is refused. |
| NEW-115 | `init` does not exit after success / A15 step 15 (2026-09-29) | **A successful `init --yes` from a local release wrote its manifest and entrypoint and printed its final warning, then the process stayed alive for over an hour at 0% CPU with no child process and only its terminal open** (release packed from `26807aed`, founder machine). Earlier installs from older builds exited. Close by finding the open handle (a timer, a pending promise, a stdin reader) and adding an e2e case that asserts the `init` process exits. |
| NEW-116 | ingest yield on long multi-decision captures / A15 step 12 (2026-09-29) | **Measured after the fixes (`72f0f5bf`, `30524da2`): 75 of 106 captures ingested; the last 31 were rejected by the founder.** They are long multi-decision session logs for which Claude keeps proposing one path twice in a proposal (`duplicate-path`) or a path outside the topic folders (`write-scope`); no pass after the third ingested any. Head-of-line blocking across runs remains (ordering needs a reserved state file). Close by splitting multi-decision captures before ingest, or by letting one proposal carry several notes under a shared prefix, and measure again. |
| NEW-118 | Spec 2 apply residuals / Task 11b or A16 (NEW-110 Task 10, D72) | **Four shortcuts the NEW-110 apply path ships with, each marked `ponytail:` in code and none recorded in the spec.** (1) `releases/<version>` is created no-replace, or reused, with no journal record and is never removed, so a compensated attempt leaves an empty directory the next attempt reuses (`apps/cli/src/update/bundle-publication.ts` — `#versionDirectory`). (2) §6.4's empty ephemeral reservation is released before the first transition with no journal record; a compensated update leaves it absent, which P5 admits (`apps/cli/src/update/apply-ports.ts` — `releaseEmptyReservation`). (3) The proposed Codex projection keeps the current plugin version, so a target that bumps it reports a postimage mismatch and compensates (`apps/cli/src/update/planning.ts` — `codexEffectOf`). (4) The verifier's home snapshot is the plan's own digests, not a bounded read-only snapshot of the home (`apps/cli/src/update/apply-ports.ts`, the verifier snapshot). Close each with a Spec 2 amendment or the code the comment names: (1) and (2) by journaled structure transitions, (3) before the first release that bumps the plugin version, (4) with the real verifier (Task 11b, A16). |
| NEW-119 | D31 identity guard, NEW-90 residual / startable, no phase | **`STAT_OPTION_EXEMPT` now keys on the receiver's name, not its type.** NEW-90 (closed 2026-09-28, `5e462e97`) exempts only calls whose receiver is textually `fs`, the guarded port, so a file that imports `node:fs` as `fs` (or names any other object `fs`) passes the stat-option half of D31's rule with a raw `lstat` and a truncating `toString(10)`. Close by resolving the receiver's type (the TypeScript checker, or an import-binding check that refuses `node:fs` bound as `fs` in an exempted file). |
| NEW-120 | redaction, NEW-25 residual / security, decision | **A high-entropy run partly covered by an earlier candidate is dropped, leaving the token's tail in the clear.** NEW-25 (closed 2026-09-28, `62b33d14`, D71 (5)) merges partially overlapping candidates for every class but `high-entropy`, which stays first-wins so an ordinary `API_TOKEN=…` line keeps its persisted fingerprint. When a user pattern matches the start of a token, the run is dropped and its tail survives (`docs/architecture/threat-model.md` §5.7, "Overlapping candidates merge"; pinned by `redaction.test.ts`, "drops a high-entropy run that partially overlaps an earlier candidate, leaving its tail"). Close by redacting the uncovered remainder of such a run as its own range without changing the fingerprint of a non-overlapping run, or record it as accepted by a founder decision. |
| NEW-121 | A11 / security, NEW-46 residual | **`capture`'s vendor probe still trusts a same-uid binary reached through a prepended `PATH`.** NEW-46 (closed 2026-09-28, `40d57f86`) resolves the `PATH`-selected binary once, admits it by owner, mode and ancestor rules, pins `{dev, ino, mode, size, ctimeNs}` and rechecks before the spawn; a binary the same uid planted in a `0755` chain it owns still passes (`docs/architecture/threat-model.md` §5.11, "The residual, stated because a future reader will rely on this paragraph"). Close with NEW-46's other arm, manifest-owned persisted executable identity with upgrade and move drift behaviour, or record the residual as accepted. |
| NEW-122 | lifecycle, NEW-97 residual / startable, no phase | **Core still records the control files as removed when a rolled-back uninstall compacts.** NEW-97 (closed 2026-09-28, `3b0c19fd`) passes the terminal outcome to the control-file adapter, so a compensated uninstall keeps `state/.lifecycle-nonce` and the allocator, but Core's compaction still emits `control_file_removed` for the `rolled_back` coordinator. Close by skipping that event on a compensated run, or by a Spec 1 §2.4 note that it names the attempted leaf rather than the outcome. |
| NEW-123 | bootstrap, NEW-114 residuals / startable, no phase | **Two interrupted-init shapes NEW-114 left.** NEW-114 (closed 2026-09-28, `f16cf211`, with `51e7d04d` creating `backups/transactions` in the fresh layout) attributes the Foundation `_f` staging of a verified or `unverified` fresh init, so that home uninstalls in place. Still open: (1) `plan_unverified` and id-only envelopes contribute no participant IDs, so their staging still reads as an unattributed ledger finding; (2) after an `unverified` envelope's uninstall, a later `init` refuses `BOOTSTRAP_MANUAL_ARCHIVE` instead of reinstalling. Close both with a kill point in the `init` interruption matrix each. |
| NEW-124 | manifest validator, NEW-92 residual / test gap | **Two of NEW-92's rethrows have no test.** NEW-92 (closed 2026-09-28, `6fb50b58`) lets `TypeError`, `RangeError` and `ReferenceError` escape the manifest validators; the rethrows in `exactV2Handoff` and `supersededV2Handoff` (`apps/cli/src/bootstrap/report.ts`) are untested. Close with one injected-defect case each. |
| NEW-126 | ordinary-command admission, NEW-82's open half / startable, no phase | **A directory at `installation-manifest.json` reads as an absent manifest.** NEW-82's row closed (plan 1a Task 17) with this half still open: `assertOrdinaryCommandAdmitted` routes that path through `inventoryExactNamespaces`' direct-namespace branch, which records children only, so the leaf reports absent and an installed home refuses exit 6 with bootstrap-archive guidance instead of naming the directory (`docs/architecture/foundation.md` §10, "NEW-82 is closed here"). `apps/cli/src/bootstrap/report.test.ts` holds it as `it.fails` ("distinguishes a directory at the manifest path from an absent one"). Close by recording the root in that branch and flipping the case to `it`. |
| NEW-127 | A13 / founder, real Claude session and isolated `ingest` | **The Claude rows the A15 evidence did not reach, and the isolated-`ingest` check on both vendors.** The A13 plan's Task 18 closed on 2026-09-29 with Claude's firing, the `guard command` and `guard path` refusals (payloads fed directly) and session-start injection observed on the founder machine (`docs/architecture/hooks.md` §4.1). Still owed, each in a real Claude session: a `git push --force` refused; a type error that prevents stop, then the second stop allowed by the loop flag; the formatter changing a file; a matching skill rule appearing in context; a shared-file symlink edit yielding the advisory; `doctor --probe` reporting `plugin_hooks=yes`. And the plan's Task 18 Step 3: an isolated `ingest` on each vendor with the product hooks installed leaves no firing record and no injected content (`hooks.md` §3.5); **if either vendor fires them, the adapter's ingest argv is amended before anything else ships.** The Codex half runs with NEW-104, after 2026-10-22. Transcribe into `hooks.md` §4. |
| NEW-130 | redaction, NEW-129 residuals / security, decision | **What NEW-129 (closed 2026-09-30) consciously left open.** The high-entropy class now exempts a run whose `/` segments split into word-like parts (`isWordLikePath`, at most 12 parts, letter parts at most 16 characters). Measured residual: 46.3% of random 6×8-character single-case letter tokens joined by hyphens are exempt (N=2000); unlabelled word passphrases (diceware) pass in the clear; the new labelled rule (`passphrase`, `mnemonic`, `seed phrase`, `recovery phrase/key`) captures only the first whitespace-separated word, so a spaced mnemonic leaks words 2..n, and "the passphrase is stored in …" redacts `stored`. `readIndexExcerpt` and `takenPaths` in `apps/cli/src/commands/ingest.ts` still redact vault paths in text scope, which is how markers reached the model; ingest now refuses a destination path carrying a marker. The marker regex lives only in `packages/brain/src/ingest/validate.ts`; `packages/platform-macos/src/macos.ts:23` keeps its exact-case literal. Close with a decision per item (accept, or fix: multi-word capture for the labelled rule, path scope for the index excerpts, one shared marker pattern in `@developer-os/security`). |
| NEW-131 | performance / instruction-defaults scanner | **`scanInstructionDefaults` takes ~55 s for one 256 KiB file of a single repeated character** (`tests/tools/scan-instruction-defaults.test.ts`, "admits a file of exactly the cap"), measured identically on `dbca633` and on the D70 lane, and over the 120 s test bound on a hosted runner (PR #19, run 36710745888). The case now carries a 300 s bound; the scanner is superlinear somewhere in its per-file screen. Close by profiling it and making the cap-sized file linear. |
| NEW-75 | ingest isolation residual / founder, Codex half only | **An isolated vendor run still resolves its home through `getpwuid_r`, so it writes into the user's real home, and supplying a product-owned `HOME` is refused (D15, 2026-09-07)**: the resolution that strews `.claude.json`, `.claude/backups/` and `.claude/sessions/` files (observed 2026-09-05 against 2.1.261) is the one that finds each vendor's credentials. Closes only on each vendor's credential path supplied separately, plus one real authenticated `ingest` per vendor. **The Claude half closed 2026-09-28** (`3ebc505d`, `de0d4f8e`): the child gets `USER` and `LOGNAME` from the password database so the Keychain login resolves, and the first real Claude ingest ran on the founder machine in A15 step 12 (D75: tests written, full check owed). `HOME` stays refused, so the stray `~/.claude` files remain the accepted cost of Claude finding its own credentials (`vendor-invocation.md` Task 6). **Still open: Codex** — its credential path supplied separately and one real authenticated `ingest --agent codex`, a founder stop because it spends credits (Codex quota returns after 2026-10-22). Full detail in `docs/architecture/vendor-invocation.md`. |
| NEW-53 | performance / init and suite wall clock | **About 99% of an `init` is canonical-JSON encoding, not disk, and the remaining cost is therefore closable rather than inherent.** `developer-os init` fell from roughly 219s to roughly 101s across b146f7e, ae12887 and 5b0696e, and evidence inspections per fresh init from 8 to 3; `executor.test.ts` fell from ~169 to 127.5 minutes. **Rewritten 2026-09-07 from "roughly 126 minutes of real fsync-backed transactions this program never targeted", which was wrong and load-bearing** — it framed the remainder as the price of durability, so nobody would attack it. Two numbers already in this repository disprove it: `apps/cli/vitest.config.ts` records a real install writing its **73 files in about 0.8 s**, against an `init` of **~101 s**; and this row's own profile records **91,052,556 canonical JSON key encodes**, 60,947,939 of them from `rawCanonicalHash` under `validateJournalRecord`, to write those 73 files. A 2026-09-07 profile of the live suite put `node::encoding_binding::BindingData::EncodeUtf8String` as the heaviest leaf frame, measured a CPU/wall ratio of 1.01, and found zero fsync frames; `MarkCompact` appeared 109 times. Remaining work is the encoder, not the disk, and a 2026-09-07 profile of a real `init` names three call sites rather than a module. (1) `encodeString` in `packages/core/src/lifecycle/canonical-json.ts` appends **one character at a time** — `encoded += value[index]` for every ordinary character — so each string costs a cons-string per character that V8 must flatten and collect; the profile showed `EncodeUtf8String` 317 samples, `MarkCompact` 267, `Builtins_StringAdd_CheckNone` 80 and `SlowFlatten` 16, against ~152 for all `node::crypto::*` combined. A scan-then-slice fast path would make the common no-escape string one operation. (2) `decodeExactCanonical` in `apps/cli/src/bootstrap/journal-store.ts` **re-encodes the whole record on every read** to prove it was canonical — decode, full re-encode through that per-character loop, compare. (3) `exactBytes` beside it compares with `left.every((value, index) => value === right[index])`, a JS closure per byte where `Buffer.compare` is one `memcmp`. Also still open: `projectBootstrapRetentionPostimage` re-projecting directory trees. Two of the three shapes were benchmarked in isolation on 2026-09-07: scan-then-slice is **5.3x** the current `encodeString` on representative plan strings (paths, hashes, ISO timestamps — none of which need escaping, so the per-character loop is pure overhead), and `Buffer.compare` is **225x** the current `exactBytes` (422 ms against 2 ms over 200 comparisons of a 512 KiB buffer). **Those are shape-level microbenchmarks, not end-to-end `init` measurements**, and the second is the one to be careful with: a 225x on a function is worth only as much as the share of `init` that function owns, which is unmeasured. Whoever takes this row should re-profile after each change rather than assume the ratios compose. The prize is large — if `init` cost even 2 s, `executor.test.ts` would run in about 3 minutes instead of 122, and the 180-minute CI budget would be unnecessary. Attribute by keys encoded, not by call count. See `docs/architecture/foundation.md` §9 and the D13 amendment of 2026-09-07. |
| NEW-45 | founder credits | Whether a real `codex exec` turn ever emits more than one `agent_message` is the one question Codex source could not settle, and it is what the last-wins tie-break in `packages/adapter-codex/src/invoke.ts` rests on. Narrowed 2026-09-05: NEW-47 is closed from source — `TurnCompletedEvent` carries only `usage`, so there is no deterministic replacement to compare against — and the vendor's own `final_message_from_turn_items` picks the last agent message, which corroborates the tie-break without observing it. What remains needs one paid run likely to emit a post-answer summary; record the event count and order. |
| NEW-42 | human interactive sessions | Run `developer-os capture` inside both vendors' TUIs with parent markers stripped; record the child environment in `knowledge-pipeline.md` §10. |
| NEW-35 | A11 / accepted platform limit | Correct the code reference and either provide enforceable exec-by-identity or explicitly retain the check-then-spawn race as a platform limitation. |
| NEW-33 | founder policy | Decide whether root-owned, group-writable executable directories such as legacy `/usr/local/bin` are trusted; pin the choice on a representative machine. |
| NEW-40 | ingest concurrency / decision | Decide refuse-versus-report semantics for a hand edit during the agent call, then bind the unguarded ingested write at `apps/cli/src/commands/ingest.ts:1349-1358` and the remaining later write to the exact staged bytes. |
| NEW-29 | test infrastructure | **Narrowed 2026-09-08, not closed, and decision D13's closure of it was premature.** D13 closed this row on the grounds that the eight retained-evidence timeouts were machine contention at load average 47 and did not reproduce on a quiet machine — which held: they never appeared again, locally or in CI. But the row is the *class* of elapsed-time assertions, not those eight cases, and another member of it failed on CI the same week: `packages/security/src/redaction.test.ts`'s "adds bounded per-pattern overhead over a single-pattern baseline" timed out in run 34133320221. Its budget was miscomputed rather than merely tight — derived from a min-time covering two passes when the body runs eight — and is corrected, but the assertion is still a wall-clock ratio. It stays that way because the property is that `addUserPatterns` folds the haystack once rather than per pattern, and counting that means observing the module-private `buildFoldedHaystack`; exporting it purely for a test would widen a package's public surface to measure an internal. Close by giving that module a counting seam, or by documenting the bounded-retry policy this row's original text already offers as the fallback. |
| NEW-27 | first production write scope | Screen the external scope name and the product-derived path separately before wiring a real write scope. |
| NEW-28 | ingest coverage | Add an injection seam or end-to-end case for the retained screening-refusal branch when a production argument can reach it. |
| NEW-7 | founder / Obsidian | Verify `%` and control/format-character percent-encoded local links in Obsidian; if they fail, reject those paths at lint time. |

## 2. Foundation residuals

- [ ] Decide whether `SpawnLockfRunner` needs a watchdog around its non-blocking `lockf` call. This
  blocks nothing and belongs to the founder.

## 3. Missing specs, plans, and implementations

### A11 · DOS-P7

- [ ] Finish remaining update/release work and close the full Task 7 checkpoint: Task 11b (parked,
  D46; NEW-111, NEW-112, NEW-118) and NEW-113's Task 5. Closure Tasks 9–10 and Task 26 closed
  2026-09-29 with NEW-110 (D75: tests written, full check owed).

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
- [ ] Execute the eight unchecked Task 8 steps in the program plan (two were withdrawn by D58).

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

## 6. Phase-close handoffs

Recorded by the orchestrator from the 2026-09-23 implementers' reports and from the fix sessions after
the 2026-09-25 whole-phase reviews. The phase closes ran on 2026-09-26; these items were deferred by
them and are still open. The owner is named per heading; an item that is a real defect gets a failing
test first. Closed items leave this section with the commit or decision that closed them (2026-09-26:
the Phase 6 C1 fix, Phase 9 I2/I3 and I4 as residual 11, the Phase 8 blockers (a)–(e), the `oe`/`rb`
prefixes and the duplicate journal-path helper that closure Tasks 1–8 closed, the stale export pins,
and the full `check` on HEAD; 2026-09-29: Phase 6's first-token bypasses of review M1, ruled by D67
in `d157227..28cfe19`, and m4 plus the mock-only `apply_patch` grammar, moved into NEW-104).

### Phase 4b · A11 (release plan, with Task 11b; plan closed 2026-09-26, see NEW-111)

- Launcher exit and paths (phase 4b review M3, deferred): an EPIPE on the FD 3 trust write throws
  before `await exit` and discards the child's real exit code (no deterministic test found yet);
  nothing forwards SIGTERM/SIGHUP to the child; `apps/launcher/src/main.ts:79` takes `.pathname`,
  which is percent-encoded, where `fileURLToPath` is right (placeholder location, replaced in A16).
  The 128-plus-signal exit is fixed (`e29711e`); the stubs are NEW-111.
- Spec 2 §4.2 "no extra inherited FD", founder to confirm the reading: the child cannot tell
  inherited descriptors from the 4–11 libuv opens, so the guarantee moved to the launcher's `stdio`
  array (test `hands the child no descriptor beyond stdio and FD 3`). If §4.2 means an in-process
  descriptor-set check, it is unimplementable as written and needs an amendment.

### Phase 5b · A12b (A12b plan remainder)

- Workflow versions (review M7, founder): nothing is released (D47), so no overlay pins the bytes of
  `brain-search@2.0.0` before `714918a`, and the five `1.0.0` workflows whose prose changed were not
  bumped. If the founder prefers bumps, bump all six at once.
- Contract gap (`docs/architecture/brain.md` §6.13, merge mode and R6): after `brain refactor
  --merge`, `[[s]]` links in the target's own body become links to itself. Only frontmatter edits
  are forbidden; body cleanup is unspecified.
- `knowledge-pipeline.md` §§1, 3, 5, 7 (the Task 16 amendments) were not reviewed.

### Phase 6 · A13 (plan closed 2026-09-29; the real-agent rows are NEW-104 and NEW-127)

- Review M4 remainder, founder: the exit code no longer waits for the firing record (`6b7ac75`), but
  the process lives until the write settles, so a slow gate can still overrun the vendor's
  2-second window. Options: write without the gate on `block` (an amendment of
  `docs/architecture/hooks.md` §3.6), or `process.exit` after a bounded wait, which can cut stderr.
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

### Phase 9 · plan 1b Git and launchd (closed; host gate is NEW-113's Task 5, D65, D71)

- The trampoline's reported `ppid` is not bound to the parent PID in the permit, because the permit
  carries no PIDs.
- Verification gap, NEW-113's Task 5 disposable account (was Task 19's host): a real push through `/usr/bin/git` has not run through the I1 fix
  (unit tests only); hostile config and redirect cases are only indirectly proven; the trampoline
  environment is compared exactly and is verified there.
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
