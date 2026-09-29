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
reviews, PR #15 merged); `ORDER.md` records the evidence.

| Entry | Work still required | Blocked by |
|---|---|---|
| A13 · DOS-P11 | founder stops: Task 2 legacy parity, Task 18 real-agent matrix (NEW-104) | founder |
| A15 · DOS-P8 | execute `docs/migration/founder-cutover.md` (written; D58 dropped shadow mode) | founder, live machine |
| A11b · DOS-P7 remainder | Task 11b parked (NEW-111, NEW-112, NEW-118): the real-release half of Phase 8's gate; NEW-113 Task 5, the Phase 9 gate on a disposable account. Closure Tasks 9–10 and Task 26 closed 2026-09-29 with NEW-110 (D75) | D46, founder |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A11b, L1, L2 |

A11 (Phase 4b) and A14 (Phase 7) have nothing left of their own: Task 11b is tracked under A11b, and
A14's template scan runs with A12's.

The phase order, the founder decisions of 2026-09-04 and 2026-09-16 that fixed it, and the documents each phase
expects are in `docs/superpowers/plans/2026-09-04-developer-os-completion-roadmap.md`.

## 1. Open repository rows

There are 59 numbered rows. They are not automatically ordered ahead of A15.

| ID | Owner / blocker | Work required to close |
|---|---|---|
| NEW-82 | Spec 1 handoff admission / plan 1a | **`admitV2Handoff` is a fresh-install snapshot, and Spec 1 is its first caller** (Phase 3 final review M2, M3, M7, m4, m5). One `incompleteHandoff` reason cannot tell a non-terminal envelope from no finalized one, and its catch-all hides programming errors; "manifest without a runtime reservation" exercises the hash pin rather than completeness; a directory at `state/lifecycle-activation.json` passes as an absent record, because `guardedFile` returns null for any non-regular entry (`guardedFile` in `apps/cli/src/bootstrap/report.ts`, called for `lifecycle-activation.json` in `admitExactV2Handoff`); and `listNames` is wired to `readdir` instead of being injectable beside `reader` (`apps/cli/src/bootstrap/context.ts:238`). Close in plan 1a, in the change that composes Spec 1's structural admission (Spec 1 §2.1, "Admission of an installed V2 home", amended 2026-09-17). |
| NEW-87 | citation accuracy / travels with each owning row | **Five `report.ts` citations resolve to the wrong lines while staying in bounds; three were re-aimed to verified anchors on 2026-09-21 and two remain.** Plan 1a Task 23b shifted the module again by ~24 lines, so NEW-71's first citation now reads `:1181` (`parentAuthorities: exactSelection && terminalRetained`), NEW-56's reads `:1349` (`blocksNewIntent: active.length > 1`) and plan 1a's `retainedPaths` citation reads `:1342` (`retainedPaths: [...allEntries.keys()].sort()`) — each verified against the line it now names, not merely re-offset. **Still open:** NEW-71's `:113`, which lands on `validateSlots` rather than that field's docstring, and the second citation in NEW-71's own sentence. The standing hazard is unchanged and is what keeps regenerating this row: Plan 1a Task 3 shifted `apps/cli/src/bootstrap/report.ts` and remapped every citation by content, so each still points where it pointed before the shift — but several were already mis-aimed, and `tests/repository/citations.test.ts` only bounds-checks, so nothing catches it. NEW-71's `apps/cli/src/bootstrap/report.ts:1010` lands on a `} catch {` inside the payload-evidence check rather than on the `retainedParentAuthorities` line it describes, and its `:113` on `validateSlots` rather than that field's docstring; NEW-56's `:1164` lands on the `ids` set rather than on the `active.length > 1` term; `docs/architecture/threat-model.md`'s `:1428-1443` and `:1445-1473` each sit about thirty lines below the symbol their sentence names. Close by re-aiming each at the symbol it describes, or by naming the symbol instead of a line, when the owning row is next worked. NEW-82's own mis-aimed citation was repaired that way in plan 1a Task 3. |
| NEW-88 | Foundation ledger fail-open / plan 1a Task 16 | **An absent Foundation root reports `clear` instead of a finding.** `openRoot` in `packages/core/src/lifecycle/foundation-ledger.ts` returns `null` with no finding when `lstat` is `null`, while a wrong-type, unowned or wrong-mode root is `lifecycle_foundation_root_shape`. Proven during plan 1a Task 12's review: a home with `state/transactions` omitted returns `clear, findings: []`, and so does one with `staging/transactions` and `backups/transactions` omitted. All three are A12 bookkeeping-set members that uninstall never removes, so absence is never legitimate, and deleting one erases the evidence the closure gate exists to find. Shipped in Task 11 (`62ef4f1`); the identical hole in `ledger.ts`'s `openRoot` was closed in Task 12 (`ade8860`) by folding `entry === null` into the shape refusal, and the same one-line fix applies. Close with the fail-closed test first. |
| NEW-89 | bookkeeping projection / plan 1a Task 22 | **An empty ancestor-of-retained directory projects away on stale evidence.** `admitRetainedAncestor` (`packages/core/src/lifecycle/bookkeeping.ts:94-101`) returns `ADMITTED` for a directory whose `childNames` loop never runs, so an empty `staging/lifecycle/<id>` whose only evidence names a child that has since been removed is projected out of the absent-manifest remainder, while the equivalent empty `logs/` correctly refuses after plan 1a Task 13's fix. §6 names “an unrecognized empty directory” as recovery-required and A12 admits under a bookkeeping root only “the ancestor directories that exist only to hold it” — an empty one holds nothing, so the directory survives a key deletion. Shipped in Task 2; `projectSubtree` is correct to stop where bookkeeping stops, so the fix belongs here. |
| NEW-90 | D31 identity guard granularity / startable, no phase (re-homed from Phase 4b 2026-09-25) | **`STAT_OPTION_EXEMPT` is keyed on the file, so an exempted module can still truncate an inode.** `tests/repository/check.ts` exempts whole files from the stat-option half of D31's identity-encoding rule, correctly, because they reach the filesystem only through the guarded port's `lstat(path)`. But the companion `IDENTITY_RENDERING` regex (`tests/repository/check.ts:85`) matches only `String(x.ino)` / `String(x.dev)`, not `stats.ino.toString(10)` — the idiom D31's own comment calls the approved encoder, exact only when the stat came from `{ bigint: true }`. So a future direct `nodeFs.lstat(p)` plus `parseUInt64Decimal(stats.ino.toString(10))` inside an exempted file passes both halves of the guard and silently truncates an APFS inode. Five files now carry the exemption. Close by keying it on the receiver type rather than the path, or by widening `IDENTITY_RENDERING` to the `toString(10)` form. |
| NEW-91 | Foundation rewrite-temp ceiling / plan 1a Task 16 | **A rewrite temp far larger than its final journal is admitted and then deleted.** §2.4 bounds a rewrite temp by “the exact recomputed standalone Foundation maximum” and calls a larger one a preserved third state. `admitTemporaryJournal` (`packages/core/src/lifecycle/foundation-ledger.ts`) is called with `planned === null` for a `rewrite_temp`, returns before its phase and staged-index checks, and reads with a flat 1 MiB — so a complete canonical temp for the right ID is admitted in any phase with any mutation array. Proven during plan 1a Task 15's review: a 2,596-byte temp at phase `rolled_back` beside a 456-byte final journal (ceiling 460) produced `findings: []`, orphan `rewrite_temp`, and `removeFoundationOrphan` deleted it. Unimplemented in both the ledger's admission and the remover; the enforcement point §2.4 names is admission. Product code cannot create one — `store.write` encodes the journal it is about to rename over — so it needs a non-product writer into an owner-only `0700` directory. Close at the ledger; two lines would add defence in depth at the remover, which already holds the final journal and `orphan.temp.size`. The unreachability argument that omitted it was falsified by a single look at the call site. |
| NEW-92 | manifest validator catch-all / startable, no phase (re-homed from Phase 4b 2026-09-25, and from the closed Phase 8 2026-09-26) | **The same catch-all NEW-82 names survives one layer down, in three places, hiding programming errors in every manifest validator.** (1) `packages/core/src/manifest/v2.ts:23` — `call<T>(fn)` is `try { return fn(); } catch { return invalid(); }`, used at 15 sites across `common()`, `artifact()` and `validateManifestV2`, collapsing any throwable, including a `TypeError` from an injected `ManifestAdmissionContextV1` callback, into `ManifestStateError`. (2) `packages/core/src/manifest/v2.ts:105` — `validateManifestBytes` additionally wraps the whole call in its own `try { … } catch { return invalid(); }`, so fixing `call()` alone does not close it. (3) `isStructurallyValidV2Manifest` in `apps/cli/src/bootstrap/report.ts` — a third `catch { return false; }`, which `assertOrdinaryCommandAdmitted` turns into `BootstrapRecoveryRequiredError(MALFORMED_V2_MANIFEST)`, exit 6, in the live `apps/cli/src/main.ts:516` gate. **Harm:** a defect in the `admitOwnerPath` closure `manifestAdmissionFor` builds — which Tasks 18–23 all reuse — tells a user with a healthy installed home that their manifest is corrupt and to run recovery. Plan 1a Task 17 closed the CLI-side relabelling in `apps/cli/src/lifecycle/admission.ts` by rethrowing `TypeError | RangeError | ReferenceError`; that rethrow cannot reach any of these three. Close all three together. |
| NEW-93 | redaction key read and hashed / plan 1a Task 21 finding | **The bootstrap evidence inspector opens the redaction key and streams it through SHA-256, against the Global Constraint that the key is “never read, hashed or journaled”.** `projectRegularEntry` in `apps/cli/src/bootstrap/retention.ts` opens every regular file of a retained directory tree `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` and streams it into `createHash("sha256")`, recording the digest as the entry's `sha256`. After a rolled-back V2 `init` the retained tree contains `state/redaction.key`, so `inspectEvidence()` reads and hashes the secret — twice, through the before/after double projection in `projectBootstrapRetentionPostimage`. Found while building plan 1a Task 21, whose `expect(keyReads()).toBe(0)` over a whole `runUninstall` counts 2; the captured stack runs `retentionRow` → `buildBootstrapRetentionEvidence` → `physicalPath` → `projectRetainedDirectoryTreeOnce` → `walkDirectory` → `projectRegularEntry`. This is Task 3 code and predates that arm; Task 21 narrowed its own assertion to the arm rather than touch `retention.ts`, which its file list does not include. **Proven:** an in-memory read plus hash on the inspection path. **Persistence settled by the orchestrator on 2026-09-20, which bounds the severity: the digest is read and hashed in memory only.** The per-file `sha256` reaches a `directoryTrees` array only on the inspection path (`buildBootstrapRetentionEvidence` in `apps/cli/src/bootstrap/report.ts`); the executor's own evidence carries `directoryTrees: []` at both construction sites in `apps/cli/src/bootstrap/executor.ts`, so `init` journals nothing derived from the key, and no command renders the digest — `status`, `doctor` and `uninstall` never read `.sha256` off a retention row. `retainedTreeHash` does fold the entries, key digest included, into a `treeHash`, but only inside the same in-memory verification. So this violates the “never read, hashed” half of the Global Constraint and not the “journaled” half. Close by exempting the key path from the walk, or by not hashing retained payloads at all. |
| NEW-96 | duplicated manifest admission policy / plan 1a whole-plan review | **One confined owner-path security policy now exists in two copies.** `manifestAdmissionFor` is exported from `apps/cli/src/commands/uninstall.ts`; plan 1a Task 19 could not import it, because `context.ts → lifecycle/mutation-gate.ts → commands/uninstall.ts → context.ts` would be a runtime import cycle through the composition root, so it duplicated the eight lines as a module-private `gateManifestAdmission`. Both build `createOwnerPathAdmission({ kind: "confined", roots: [productHome, brainPath] })`. The rejected alternative is recorded in a comment at the definition, but two copies of one admission policy drift, and this one decides which paths a manifest may name. Move it to a module neither side owns. |
| NEW-97 | rolled-back uninstall loses its control files / plan 1a Task 22 finding, startable, no phase (re-homed from Phase 4b 2026-09-25, and from the closed Phase 9 2026-09-26) | **A compensated V2 uninstall leaves a home `§2.1` can no longer admit, because Core removes the install nonce and the ID allocator on every terminal uninstall.** `removeEnvelopeLeaves` calls the `controlFiles` adapter for every terminal uninstall coordinator and passes no outcome, so the adapter cannot branch on whether the run finalized or compensated; measured on a real home, a death before the point of no return restored the manifest, the key, the leases and every artifact, and then deleted `state/.lifecycle-nonce` and the allocator anyway. **Interim, shipped in Task 22:** the CLI adapter guards on the restored manifest and skips the removal, so every path a 1a command can reach is correct and Task 24's kill matrix exercises the guarded path. **Durable fix:** give the `controlFiles` adapter the coordinator's terminal outcome, or have `removeEnvelopeLeaves` skip it on a compensated run. Core has no other caller today, which is why this was not closed inside plan 1a. |
| NEW-99 | a second uninstall after a reinstall refuses exit 6 / plan 1a Task 23 finding, **owned by plan 1a Task 23b (D38)** | **After one `uninstall` → `init` round trip, every later `uninstall` and every V2 mutation on that home refuses exit 6 `lifecycle_ledger_finding`.** Once a second retained bootstrap envelope exists, `inspectBootstrapEvidenceAdmission` gives both envelopes the same `entryCount` and `regularFileBytes` — each counts the other's rows — so both drop from `verified` to `altered`. `retainedEnvelopes` keeps only envelopes whose `verifiedEnvelope` is non-null, which requires `summary.status === "verified"`, so it empties; `residueFrom`'s `bootstrapParticipantIds` goes empty with it; and the ledger then reads both bootstrap Foundation staging directories as unattributable findings. This violates §7's "altered retained evidence never refuses `uninstall`" and defeats the A9 round-trip gate: plan 1a Task 24's headline case does `uninstall` → `init` → `uninstall`, which is the first operation to reach it. **Proven pre-existing**, not caused by Tasks 22 or 23: reverting `apps/cli/src/commands/uninstall.ts` to `cce9432` reproduces the identical failure. Task 22's e2e reinstall case passes only because it stops at the reinstall and never performs the second `uninstall`. The fix is in `apps/cli/src/bootstrap/report.ts`, outside plan 1a's remaining file lists, and that file's gate is the 330-minute `bootstrap-executor` job D32 defers — the same shape as NEW-94, which D37 refused to ship unrun inside plan 1a. **D38 (2026-09-21): the founder put the fix inside plan 1a, as Task 23b, before Task 24** — `report.ts` is gated by `report.test.ts`, which D32 does not defer, so unlike D37 this does not ship unrun. Task 23's chain works around it with one fresh home per kill point, which drops A9 coverage from six consecutive cycles to one; restoring the shared-home chain belongs in the same change. |
| NEW-100 | uninstall → `init` round-trip gate deferred whole / plan 1a Task 24, D42 | **Plan 1a Task 24 (`uninstall-round-trip.v2.test.ts`) is carved out of plan 1a entirely and deferred to post-A16 hardening (D42, 2026-09-22), superseding D39's narrower plan of running it with `A9_KILL_POINTS` cut from ten to six.** The founder judged this class of heavy real-filesystem e2e proof — chained `init → uninstall → uninstall → init → uninstall → init`, plus an A9 kill-matrix reusing one home — not worth the wall clock now (an implementer had already run past the file's own ~31-minute local estimate when the decision was taken), against shipping the rest of the roadmap's plans first. **Full spec, including the exact ten candidate kill points and D39's selection rule, is §7.1 of `docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` (moved there from plan 1a Task 24 on 2026-09-26, when the plan file was deleted).** Close by running §7.1 exactly as written there — with a real measured duration feeding the `timeout-minutes` of the `lifecycle-v2` shard the file runs in, under the 300-minute cap, applying D39's selection rule to keep six of the ten candidate points, and recording the four dropped points' equivalence arguments — once, alongside the codebase's other heavy e2e suites, after A11b and A12–A16 close. **Accepted risk until then:** beyond what Tasks 20–23b's own suites exercise (one reinstall cycle, and the NEW-99 regression Task 23's own chain already covers), the `uninstall` → `init` round trip is unproven end-to-end, and all four of the recovery microstates D39 would have selectively dropped are instead entirely uncovered. `test:lifecycle` is now sharded (below), which is what avoids a future cut once this finally runs — but not by default: at its ~31-minute local estimate the file would land in `test:lifecycle:rest` and push that shard to ~317 minutes, over the cap, so give it its own shard (or one with room) budgeted from its measured duration. **2026-09-26: now blocking CI.** On PR #15 the hosted runner cancelled `bootstrap-executor` at its 330-min and `lifecycle-v2` at its 185-min timeout (local: 122 and 153 min); the founder merged on the local full-suite evidence (`bc17550`). Shard both jobs in `.github/workflows/check.yml` (lifecycle by file, bootstrap by `-t` group) before the next PR. **2026-09-26: the CI half is done.** `bootstrap-executor` is a two-shard matrix by `-t` group (`test:bootstrap:main`, 54 cases, 225 min; `test:bootstrap:fine-grained`, 40 cases, 280 min) and `lifecycle-v2` a three-shard matrix by file (`test:lifecycle:uninstall`, 4 files, 206 min; `test:lifecycle:core`, 6 files, 201 min; `test:lifecycle:rest`, the other 11, 224 min), each budget ceil(local bound x 3) under the 300-minute cap, with `fail-fast: false`. `vitest list` per filter shows the shards partition the unsharded 94 and 208 tests exactly, by test id; `test:bootstrap`, `test:lifecycle`, `npm test` and `npm run check` are unchanged. The local bounds are conservative estimates, not green per-file measurements (`check.yml` names each figure's source), and PR #15 implies a hosted ratio of at least 2.7x against the formula's 3.0x ceiling, so lower or confirm each budget from the first green sharded run. **The row stays open for the round-trip half** (§7.1, post-A16, D42). |
| NEW-104 | A13 Task 15 / founder observations | **The Codex half of A13 is blocked on observations.** Every Codex cell Task 15 consumes in `docs/architecture/hooks.md` §1 (shell tool name, whether an edit fires `PreToolUse`/`PostToolUse`, path versus patch body, field spellings, exit semantics, whether the trust hash covers the command) is `founder-deferred`: each needs a billed model turn or a manual trust grant. Until the founder records them, no Codex hook renders, `doctor` keeps `codex=not-rendered`, and Phase 6's Codex gate stays open. **Implemented 2026-09-23 under D57 (`4041286`..`2bec6a7`), tests green on `bc17550`; the Codex rows were observed on a local mock Responses API, not a real Codex turn.** Closes with the real Codex half of A13 Task 18 (founder). |
| NEW-105 | ingest concurrency / D52 | **Concurrent Codex ingests share `<product-home>/state/codex-ingest-home` with no lock.** Two `ingest --agent codex` runs at once use one `CODEX_HOME`, so the children share whatever state Codex writes there, with no ordering between them. Close by holding a lock across the child's lifetime or by giving each run its own home under that path. |
| NEW-106 | Codex isolation scope / D8, D52 | **Only `ingest` runs Codex with the isolated `CODEX_HOME`.** Every other caller of `invokeCodex`, such as a workflow `agent.prompt` step, still resolves the user's Codex home and therefore loads the product's `AGENTS.md` block and agent roles. Decide whether D8 covers those callers; if it does, route them through the same home. |
| NEW-107 | D55 bundle determinism | **The esbuild bundle is deterministic only per checkout.** The bundled module embeds store paths of the checkout that built it, so two checkouts of one commit can produce different bytes and therefore a different release identity. Close by making the embedded paths relative (or stripping them) and pinning byte identity across two checkouts in `tests/tools/pack-local-release.test.ts`. |
| NEW-111 | launcher stubs / Spec 2 Task 11b (D46), phase 4b review M2 | **The launcher ships two stubs that are tracked only as `ponytail:` comments.** (1) `apps/launcher/src/main.ts:93` always passes `bootstrapClosure: { kind: "handoff_complete" }`, so Spec 2 §3.1's bootstrap routing is not met; the CLI's ordinary-command gate softens this. (2) `apps/launcher/src/main.ts` never passes `updateEnvelope`, so any `executing` update record is refused as an orphan, exit 6 (`apps/launcher/src/selection.ts:529`). Close both when Task 11b wires the read-only closure and envelope readers; until then the launcher is not an install path (A11 row in `ORDER.md`). **Plan closed 2026-09-26 (D68):** Task 11b (founder root-key decision, production bootstrap pin replacement) and Task 26 (lifecycle proof, file list and gate matrix) are in `git show a03499c:docs/superpowers/plans/2026-08-29-developer-os-release-update.md`. **2026-09-29:** NEW-110 (closed; `update --apply`, `update rollback --apply` and the synthetic lifecycle proof landed, D72, D75) left Task 11b owning the rest of Phase 8: the launcher FD 3 document as the production `UpdateFallbackHandoffV1` source (the production composer refuses `update_fallback_unavailable`, exit 4, until then), real release roots (`LAUNCHER_OFFLINE_RELEASE_ROOTS = []`), the packed planner and verifier binaries (the verifier joins `PLANNER_ENTRYPOINTS` with that packer), the real-release half of the Phase 8 gate, and the persisted-format migrations Spec 2's D72 block owes "no later than Task 11b" (`compensationCause` at `schemaVersion: 2`, the leaf-domain migration hash, P8's bookkeeping grammar). |
| NEW-112 | Spec 2 Task 11b / A16 (launcher identity) | **`update` accepts an FD 3 offline-trust document from any parent process, not only the launcher** (phase 4b re-review R1, 2026-09-25). Spec 2 §4.2 expects the launcher to be the only source. Hidden today: `LAUNCHER_OFFLINE_RELEASE_ROOTS = []` (D46) makes every unsigned-local update refuse. Binding the parent needs a fixed installed launcher path (A16 packaging) to compare with `proc_pidpath(ppid)`; `ps -o comm=` is not reliable and a `node`-name check would give false assurance. Close before Task 11b or A16 by binding the launcher's executable identity, with a test that a non-launcher parent's FD 3 is refused. |
| NEW-113 | Phase 9 gate / founder, disposable macOS account (D65, D71) | **Code landed; the Phase 9 gate (plan Task 5) is owed.** Fixed-path admission replaced the exact-build pin (Spec 1 §4.2, §5.3, §7, §8.3 "Amended 2026-09-28 (D71)" and "(D71 addendum)"; contract in `docs/architecture/foundation.md` §10): `a9d50032`, `cfed0476`, `b1a7c6a5`, review fixes `83647122`, `d92759a0`, `0c799c68`; the plan (`plans/2026-09-28-new-113-fixed-path-admission.md`) closed 2026-09-29 under D75, tests written and the full `npm run check` plus `npm run test:pinned-host` owed on the development Mac. A red `local-receive.pinned-host.test.ts` caused by the shim's receive-pack dispatch is a stop condition, not a local patch. **Task 5, founder, in a new disposable standard account** (never the founder's own; Mac at macOS ≥ 26.6.2 whose `xcode-select` choice gives Git ≥ 2.54.0 / Apple Git-157; local/file transport only, D71 Q4): (1) record the host — `sw_vers`, `xcode-select -p`, `/usr/bin/git --version --build-options`, `ls -ln /usr/bin/git /usr/bin/git-receive-pack /usr/bin/ssh /bin/launchctl`, `ls -lnd / /usr /usr/bin /bin` — and check every §4.2/§5.3 rule; (2) from a clone at the closing commit run `DEVELOPER_OS_LAUNCHD_GATE_HOST=disposable npm run test:pinned-host` (the plan's `=1` is wrong: `fd3-bootstrap.pinned-host.test.ts` checks for `disposable`), all green including `git receive-pack` through the shim, and keep the printed FD-3 transcript SHA-256; (3) install the product, create a synthetic Brain and a local bare remote in the account's home, run `git enable --apply`, `git sync` twice (one change, then `no_changes`) and `git disable --apply` — one commit reaches the remote through `/usr/bin/git` (closes §6 Phase 9's "real push after the I1 fix" gap) and `.git` plus the remote survive disable; (4) `automation enable --apply` with an hourly schedule, wait for one scheduled run of each eligible job, then `automation status` (`supported`, one status record per job), `automation disable --apply` and `launchctl print gui/$(id -u)` (no product label left); (5) if a macOS or Xcode point update is available, apply it and repeat (2)–(4)'s enable/status/disable once — admitted with no code change is the D65 goal — else record "not exercised"; (6) record host facts, transcript hash and outcomes in `docs/releases/compatibility-matrix.md`, tick roadmap Phase 9's gate, remove this row, delete the account. |
| NEW-114 | fresh `init` interrupted after bootstrap / A15 step 9 (2026-09-28) | **A fresh V2 `init` killed after the bootstrap publication and before the instruction step leaves a home that `uninstall` refuses.** Observed on the founder machine: the process died with its host session; `status` reported `installed yes`, `incomplete none`, no entrypoint, no redaction key, no instruction artifacts and bootstrap evidence `unverified`, and `uninstall --yes` refused `lifecycle_ledger_finding` on `staging/transactions/tx_fi_<id>_0000000000_f` (two retained tombstones) with `backups/transactions` absent. Recovery was moving the home aside intact. Close by making that death point recoverable (`repair` or `uninstall` admits the Foundation `_f` staging of a verified-or-unverified fresh init) and add the kill point to the `init` interruption matrix. |
| NEW-115 | `init` does not exit after success / A15 step 15 (2026-09-29) | **A successful `init --yes` from a local release wrote its manifest and entrypoint and printed its final warning, then the process stayed alive for over an hour at 0% CPU with no child process and only its terminal open** (release packed from `26807aed`, founder machine). Earlier installs from older builds exited. Close by finding the open handle (a timer, a pending promise, a stdin reader) and adding an e2e case that asserts the `init` process exits. |
| NEW-116 | ingest queue and yield / A15 step 12 (2026-09-29) | **The first real Claude ingest run ingested 71 of 106 accepted captures; 35 keep being refused, mostly `path already holds a file` and `duplicate-path`.** The index excerpt in the prompt is taken once per run, so notes created earlier in the same run are invisible to later proposals; several captures share topics. `ingest --limit N` also retries the same refused captures ahead of untried ones (head-of-line blocking; ordering needs a reserved state file). Close by refreshing the excerpt (or the refused-path set) within a run, ordering untried captures first, and measuring the yield again. |
| NEW-118 | Spec 2 apply residuals / Task 11b or A16 (NEW-110 Task 10, D72) | **Four shortcuts the NEW-110 apply path ships with, each marked `ponytail:` in code and none recorded in the spec.** (1) `releases/<version>` is created no-replace, or reused, with no journal record and is never removed, so a compensated attempt leaves an empty directory the next attempt reuses (`apps/cli/src/update/bundle-publication.ts` — `#versionDirectory`). (2) §6.4's empty ephemeral reservation is released before the first transition with no journal record; a compensated update leaves it absent, which P5 admits (`apps/cli/src/update/apply-ports.ts` — `releaseEmptyReservation`). (3) The proposed Codex projection keeps the current plugin version, so a target that bumps it reports a postimage mismatch and compensates (`apps/cli/src/update/planning.ts` — `codexEffectOf`). (4) The verifier's home snapshot is the plan's own digests, not a bounded read-only snapshot of the home (`apps/cli/src/update/apply-ports.ts`, the verifier snapshot). Close each with a Spec 2 amendment or the code the comment names: (1) and (2) by journaled structure transitions, (3) before the first release that bumps the plugin version, (4) with the real verifier (Task 11b, A16). |
| NEW-117 | NEW-113 review finding 4 / startable, no phase | **`PlatformAdapter` exposes three system-executable methods no production caller uses.** `systemExecutable`, `admitSystemExecutable` and `recheckSystemExecutable` (`packages/platform-macos/src/types.ts` — `admitSystemExecutable`) are implemented by the macOS adapter and the CLI test fake (`apps/cli/src/commands/testing.ts`), but Git admission calls `admitGitExecutables` with the table rows and an inspector directly, and launchd calls `admitLaunchdHost`. Either route both admissions through the adapter methods, so the platform seam D71 (3) promises is the one production uses, or delete the three methods. |
| NEW-75 | ingest isolation residual / vendor behaviour | **An isolated Claude run still writes into the user's real home, and the fix that looked obvious is refused.** Observed 2026-09-05 against 2.1.261 with the shipped argv: despite `--no-session-persistence`, one invocation durably creates `.claude.json`, `.claude/.last-cleanup`, a timestamped `.claude/backups/` snapshot, and per-process `.claude/sessions/` `.json` and `.key` files. Because the adapters hand the child `env: {}`, it has no `HOME` and resolves one through `getpwuid_r`, so in production those files land in the developer's own `~/.claude`. **Decision D15, 2026-09-07: supplying a product-owned `HOME` is not the close.** `codex exec --help` records that `--ignore-user-config` leaves auth on `$CODEX_HOME`, which derives from `$HOME`, so the same resolution that strews these files is the one that finds each vendor's credentials; moving it moves both. F2 stands and both adapters keep `env: {}`. Closes only on each vendor's credential path supplied separately, plus one real authenticated `ingest` per vendor proving it — a founder stop condition, because it spends model credits. Full detail in `docs/architecture/vendor-invocation.md`. |
| NEW-76 | test infrastructure / ingest | `prepareAgentWorkspace` uses a fixed leaf under `tmpdir()`, so every test that reaches the Codex arm — five in `apps/cli/src/commands/ingest.test.ts`, plus cases in `main.test.ts` and `tests/security/` — creates and never removes one real shared directory on the developer's machine (`<tmpdir>/developer-os-agent-workspace`, observed present 2026-09-07). It is exactly the collision the injected filesystem in `describe("prepareAgentWorkspace")` avoids for the unit cases and does not avoid for the integration ones: a leftover with a widened mode — from a `sudo` run, or from another local user on a shared `/tmp` — reddens those tests with the product's own correct refusal. Close by pointing `TMPDIR` at fixture-owned scratch for the affected cases, or by moving the leaf onto a `CliFileSystem.mkdtemp`, which the docblock already records as the stronger design and rejects only because that interface would have to grow a method. Deliberately not fixed with the 2026-09-07 change that found it: a suite-wide `TMPDIR` stub lengthens every fixture path in a 4570-case suite, which is not a change to make inside a security correction. |
| NEW-78 | Core bootstrap / dead code | **The `v1_to_v2` arm Tasks 1–7 shipped into Core is dead since decision D18 (2026-09-17) withdrew the V1→V2 migration.** About a hundred references remain across `packages/core/src/manifest/bootstrap.ts`, `bootstrap-retention.ts`, `manifest-state.ts`, `v2.ts`, `types.ts`, `packages/core/src/update/paths.ts`, `packages/core/src/transactions/executor.ts`, `apps/cli/src/bootstrap/journal-store.ts` and their tests: the `ManifestMigrationPlanV1` union arm, `tx_mm`/`mm_`/`manifest-migration` grammars, and the `v1-migration-external-shape` digest domain. Every reader of the bootstrap state machines pays for an operation no code path can start. Close by deleting the arm and narrowing each union to `fresh_v2_init`, keeping `ManifestV1NotMigratableError`, which the V1 refusal in `init` uses. Not on the Phase 3 path. |
| NEW-62 | capability model | `CAPABILITY_STATES` (`packages/core/src/capabilities/index.ts:25`) has no `no` state, so both adapters' `resolveCapabilities` fold an `absent` observation and an `unavailable` observation into `unknown` (`packages/adapter-claude/src/capabilities.ts:74-79`, `packages/adapter-codex/src/capabilities.ts:81-85`), contrary to their own docblocks; `doctor` prints `skills=unknown` both when the plugin is verifiably not installed and when the probe could not run. `DOCUMENTED_FLOORS` map every key to `null` in both `versions.ts` files, so the floor table adds nothing over the minimum version. Add `no`, and re-measure the floors against 2.1.260 and 0.151.0. |
| NEW-63 | Core retention / duplication | `packages/core/src/manifest/bootstrap-retention.ts:1259-1284` and `packages/core/src/manifest/bootstrap-retention.ts:1932-1974` carry the same collapse → role order → tombstone-path pipeline with different "is a directory" predicates; a divergence gives `deriveBootstrapRetentionLocations` and `deriveBootstrapRetentionTable` different ordinals, so retention would write a tombstone the reader does not check. Extract one `collapseAndOrder(rows, isDirectory)`. Also six file-local copies of `compareUtf8` (NEW-50 counts five). Roadmap Phase 2. |
| NEW-64 | documentation drift | Corrected 2026-09-04 by `6e3ce69`: what `init` installs into a new vault is now one consistent bullet (`docs/architecture/foundation.md:607`). Still open: `docs/architecture/foundation.md:15-24` says four packages (eight workspaces); `docs/architecture/foundation.md:34` says one command per module (six modules under `commands/` are not commands); `docs/releases/foundation-checkpoint.md:93-107` counts eight artifacts and thirteen files; `docs/architecture/threat-model.md:832` quotes a sentence that is not in this file; `docs/architecture/threat-model.md:55`, `:507` and `:902` cite an `ORDER.md` section that no longer exists; twelve places cite `BACKLOG.md` §8 as an amendment index it no longer is; a 24-citation sample found 14 line references pointing at unrelated code (NEW-34's class). Fix the remainder immediately after the Task 7 checkpoint. Also `templates/brain/content/templates/note.md:13` ships `occurrences: 0` while the schema requires an integer of at least 1. |
| NEW-66 | generated skills / prompt hygiene | Every generated `SKILL.md` except `shared` carries the rendering note at `packages/workflow-schema/src/skill.ts:236` in model-visible text; every non-shared skill states the `vault-missing` refusal twice with two messages (`plugins/claude/skills/developer-os-capture/SKILL.md:11` and `plugins/claude/skills/developer-os-capture/SKILL.md:20`, same in the Codex tree); the `$input.text` placeholder emitted at `packages/workflow-schema/src/skill.ts:344-346` is never explained to the reader. Regenerate both trees after the fix. |
| NEW-71 | Task 6 review / four smaller findings | The §6.4 `it.each` case (`packages/core/src/manifest/bootstrap-retention.test.ts:1933`) does not assert `forwardTargets.size > 0`, so it is non-vacuous only against today's fixture. `admitPostPlanInitialWrite` (`apps/cli/src/bootstrap/executor.ts:880`) accepts any shape-correct `.lifecycle.lock` without binding it to the reusable global lock's `dev`/`ino`, while `inspectExactPreIntentShape` (`apps/cli/src/bootstrap/executor.ts:853-859`) does bind it, leaving a same-uid inode-swap window between the two checks. `retainedParentAuthorities` is emitted for any envelope with `exactSelection && terminalRetained` (`apps/cli/src/bootstrap/report.ts:1181`), `altered` ones included, contradicting its own docstring (`apps/cli/src/bootstrap/report.ts:113`). `admittedEvidence()` (`packages/core/src/manifest/bootstrap-retention.test.ts:1282`) adds `mutation.targetPath` for every participant where production adds it for forward only (`packages/core/src/manifest/bootstrap-retention.ts:1070`), so that fixture no longer mirrors the derivation it tests. |
| NEW-54 | Core encoder / correctness | `assertString` in `packages/core/src/lifecycle/canonical-json.ts` does not reject a **trailing** lone high surrogate: at the last index `charCodeAt(index + 1)` is `NaN` and both range comparisons are false. `encodeCanonicalJson({ "\uD800": 1, "�": 2 })` therefore emits two identical `EF BF BD` keys — a wire form this module's own `decodeCanonicalJson` rejects as a duplicate key, and two distinct inputs that hash to the same SHA-256. Decide whether to reject at encode time and record the migration for anything already hashed. |
| NEW-56 | A11 / Task 6 / residuals | `preserved` carries every recursive descendant of every directory tombstone, so uninstall prints Brain note filenames and pays one `canonicalize` per retained entry; roadmap Phase 2 replaces it with the maximal retention roots. No test creates two admitted active plans, so the `active.length > 1` term of `blocksNewIntent` (`apps/cli/src/bootstrap/report.ts:1349`) is unexercised. |
| NEW-53 | performance / init and suite wall clock | **About 99% of an `init` is canonical-JSON encoding, not disk, and the remaining cost is therefore closable rather than inherent.** `developer-os init` fell from roughly 219s to roughly 101s across b146f7e, ae12887 and 5b0696e, and evidence inspections per fresh init from 8 to 3; `executor.test.ts` fell from ~169 to 127.5 minutes. **Rewritten 2026-09-07 from "roughly 126 minutes of real fsync-backed transactions this program never targeted", which was wrong and load-bearing** — it framed the remainder as the price of durability, so nobody would attack it. Two numbers already in this repository disprove it: `apps/cli/vitest.config.ts` records a real install writing its **73 files in about 0.8 s**, against an `init` of **~101 s**; and this row's own profile records **91,052,556 canonical JSON key encodes**, 60,947,939 of them from `rawCanonicalHash` under `validateJournalRecord`, to write those 73 files. A 2026-09-07 profile of the live suite put `node::encoding_binding::BindingData::EncodeUtf8String` as the heaviest leaf frame, measured a CPU/wall ratio of 1.01, and found zero fsync frames; `MarkCompact` appeared 109 times. Remaining work is the encoder, not the disk, and a 2026-09-07 profile of a real `init` names three call sites rather than a module. (1) `encodeString` in `packages/core/src/lifecycle/canonical-json.ts` appends **one character at a time** — `encoded += value[index]` for every ordinary character — so each string costs a cons-string per character that V8 must flatten and collect; the profile showed `EncodeUtf8String` 317 samples, `MarkCompact` 267, `Builtins_StringAdd_CheckNone` 80 and `SlowFlatten` 16, against ~152 for all `node::crypto::*` combined. A scan-then-slice fast path would make the common no-escape string one operation. (2) `decodeExactCanonical` in `apps/cli/src/bootstrap/journal-store.ts` **re-encodes the whole record on every read** to prove it was canonical — decode, full re-encode through that per-character loop, compare. (3) `exactBytes` beside it compares with `left.every((value, index) => value === right[index])`, a JS closure per byte where `Buffer.compare` is one `memcmp`. Also still open: `projectBootstrapRetentionPostimage` re-projecting directory trees. Two of the three shapes were benchmarked in isolation on 2026-09-07: scan-then-slice is **5.3x** the current `encodeString` on representative plan strings (paths, hashes, ISO timestamps — none of which need escaping, so the per-character loop is pure overhead), and `Buffer.compare` is **225x** the current `exactBytes` (422 ms against 2 ms over 200 comparisons of a 512 KiB buffer). **Those are shape-level microbenchmarks, not end-to-end `init` measurements**, and the second is the one to be careful with: a 225x on a function is worth only as much as the share of `init` that function owns, which is unmeasured. Whoever takes this row should re-profile after each change rather than assume the ratios compose. The prize is large — if `init` cost even 2 s, `executor.test.ts` would run in about 3 minutes instead of 122, and the 180-minute CI budget would be unnecessary. Attribute by keys encoded, not by call count. See `docs/architecture/foundation.md` §9 and the D13 amendment of 2026-09-07. |
| NEW-50 | Core encoder / performance | Five file-local copies of the per-comparison `compareUtf8` remain in `packages/core/src/manifest/bootstrap.ts`, `packages/core/src/update/release.ts`, `packages/core/src/manifest/bootstrap-retention.ts`, `apps/cli/src/bootstrap/retention.ts`, and `apps/cli/src/update/packaged-release.ts`; three pass it straight to `.sort()` and carry the same O(k log k)-encodes cost fixed in `canonical-json.ts`. Apply the same encode-once ordering, or extract one shared helper. |
| NEW-46 | A11 / security | Stop the ambient-marker-selected spawn at `apps/cli/src/commands/capture.ts:263` from resolving through same-uid `PATH`, or design manifest-owned persisted executable identity with upgrade/move drift behavior. |
| NEW-45 | founder credits | Whether a real `codex exec` turn ever emits more than one `agent_message` is the one question Codex source could not settle, and it is what the last-wins tie-break in `packages/adapter-codex/src/invoke.ts` rests on. Narrowed 2026-09-05: NEW-47 is closed from source — `TurnCompletedEvent` carries only `usage`, so there is no deterministic replacement to compare against — and the vendor's own `final_message_from_turn_items` picks the last agent message, which corroborates the tie-break without observing it. What remains needs one paid run likely to emit a post-answer summary; record the event count and order. |
| NEW-42 | human interactive sessions | Run `developer-os capture` inside both vendors' TUIs with parent markers stripped; record the child environment in `knowledge-pipeline.md` §10. |
| NEW-20 | capture / security | Use the canonical root verified at `apps/cli/src/commands/quarantine.ts:100` for the reads/writes at `apps/cli/src/commands/capture.ts:630-646`, retaining the declared path only for the public result; pin the symlink-swap window. Keep NEW-35 distinct. |
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

- [ ] Founder stops Task 2 (legacy parity) and Task 18 (real-agent matrix):
  `plans/2026-09-22-developer-os-hooks.md`.

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
and the full `check` on HEAD).

### Phase 4b · A11 (release plan, with Task 11b; plan closed 2026-09-26, see NEW-111)

- Launcher exit and paths (phase 4b review M3, deferred): an EPIPE on the FD 3 trust write throws
  before `await exit` and discards the child's real exit code (no deterministic test found yet);
  nothing forwards SIGTERM/SIGHUP to the child; `apps/launcher/src/main.ts:79` takes `.pathname`,
  which is percent-encoded, where `fileURLToPath` is right (placeholder location, replaced in A16).
  The 128-plus-signal exit is fixed (`e29711e`); the stubs are NEW-111.
- Phase 4b review M1 needs a test on two checkouts; I6 (`742748b`) removed one source of
  nondeterminism. Travels with NEW-107.
- Spec 2 §4.2 "no extra inherited FD", founder to confirm the reading: the child cannot tell
  inherited descriptors from the 4–11 libuv opens, so the guarantee moved to the launcher's `stdio`
  array (test `hands the child no descriptor beyond stdio and FD 3`). If §4.2 means an in-process
  descriptor-set check, it is unimplementable as written and needs an amendment.

### Phase 5 · A12 (A12 plan remainder)

- Phase 5 review M7 (`invocationFromAgentPrompt` in `packages/adapter-codex/src/invoke.ts` builds a
  `CodexInvocation` without `codexHome`, not live) travels with NEW-106; M1 is NEW-105.

### Phase 5b · A12b (A12b plan remainder)

- Workflow versions (review M7, founder): nothing is released (D47), so no overlay pins the bytes of
  `brain-search@2.0.0` before `714918a`, and the five `1.0.0` workflows whose prose changed were not
  bumped. If the founder prefers bumps, bump all six at once.
- Spec gap: after `brain refactor --merge`, `[[s]]` links in the target's own body become links to
  itself. R6 forbids only frontmatter edits; body cleanup is unspecified.
- `knowledge-pipeline.md` §§1, 3, 5, 7 (the Task 16 amendments) were not reviewed.

### Phase 6 · A13 (A13 plan, Tasks 2 and 18)

- First-token bypasses (review M1: `sudo rm -rf /`, `env git push -f`, `FOO=1 git push -f`,
  `(git push -f)`, `git -c core.hooksPath=/dev/null commit`, `rm -rf /*`) are `it.todo` rows; Task 2
  decides the rules.
- Review M4 remainder, founder: the exit code no longer waits for the firing record (`6b7ac75`), but
  the process lives until the write settles, so a slow gate can still overrun the vendor's
  2-second window. Options: write without the gate on `block` (a §7.3 amendment), or `process.exit`
  after a bounded wait, which can cut stderr.
- m1: legacy per-event firing records are never cleaned before uninstall and count against the
  32-child cap; stays open by D62 (spec §7.3).
- m4: Codex cwd-relative resolution observed only outside git; confirm in the Task 18 matrix.
- Codex `apply_patch` grammar covers only observed forms (`*** End of File`, blank line refuses);
  Codex rows were observed on a mock Responses API (account quota exhausted until 2026-10-22).

### Phase 7 · A14 (no phase; startable)

- Review M3: `project init` departs from the codebase's pattern with no observable failure,
  because its path-overlap check already refuses the dangerous case, so no red test exists.
- Review M4b: a race that fails closed (exit 5); a test needs filesystem fault injection.
- Review M5: a spec wording change; its text did not reach this handoff.

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
