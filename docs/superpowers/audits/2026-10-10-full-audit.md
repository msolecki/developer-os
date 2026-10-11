# Full repository audit — 2026-10-10

Read-only multi-agent audit of `development` at `809a98de`: 29 area finders, each followed by an adversarial verifier, plus a completeness critic. Baseline `npm run lint` exited 0. Vitest was not run; probes were read-only scripts against existing `dist` builds, which may lag HEAD. Line numbers refer to `809a98de`. Findings already in the prior audit (2026-10-05) and open BACKLOG rows were excluded unless the evidence was new (residues and regressions are marked). 145 verified findings were deduplicated by file and root cause into 128 (17 duplicates merged); 14 further candidates were refuted or found to be duplicates by the verifiers.

## Totals

| Priority | Count |
|---|---|
| P0 | 0 |
| P1 | 3 |
| P2 | 23 |
| P3 | 102 |
| **Total** | **128** |

| Kind | Count |
|---|---|
| logic | 24 |
| inconsistency | 21 |
| dead-code | 17 |
| duplication | 13 |
| docs-drift | 12 |
| security | 9 |
| flow | 8 |
| performance | 8 |
| error-handling | 6 |
| unused-param | 5 |
| regression | 4 |
| test-gap | 1 |

## Area summaries

### cli-knowledge-cmds

No blocker in capture, quarantine, review or import; redaction precedes persistence and model input on every traced path. Issues: misleading ingest header for unreadable-only runs, duplicated quarantine helpers, and a missing skipped row in the Claude-memory import walk.

*Not read:* packages/brain ingest validators and buildIngestPrompt, adapter invoke code and ingest-attempts.ts read only partially; ingest.test.ts sampled; no full dead-code sweep of exported helpers; docs cross-check limited to knowledge-pipeline §3.1 and §5.

### cli-install-cmds

Doctor exit-code path is sound. Defects concentrate in agent discovery (absent vs unreadable conflation, four discoveries per run), a swallowed lstat error in project-check, a false pass under corrupt config, and dead or duplicated surface.

*Not read:* doctor.ts 1-440 and 700-840, 950-1540 via diff only; uninstall.ts 1-690 and init.ts 1-300/430-866 via diff only; callees in lifecycle/uninstall, bootstrap and adapter probes; no test files.

### cli-git-automation

Opt-in guarantees hold (disabled automation and git write only inert records; garden gated on the pinned executable). Found the stale-garden pulse verdict, the invisible push_pending path and an unused sync mode.

*Not read:* git/service.ts 700-880, 1100-1340, 1540-1700; git/testing.ts; all tests; core git planner beyond planSync, security, mutation-gate, runtime-records; NEW-144/169/204 paths only sampled.

### cli-entry-misc

Argument parsing, registry, usage text and docs agree; exit codes follow foundation.md §6 with exceptions. Found the brain config error mapping, hidden applied state on failed refresh, context-failure kind, slug defects, refactor error mapping and dead exports.

*Not read:* commands/testing.ts mostly; brain-template.ts beyond header; all tests; commands owned by other areas; packaged-release.ts beyond keg admission.

### cli-update-core

Rollback is symmetric with apply in the traced areas (plan counts, prefix allocation, retained hashes). Two rollback defects (stale Codex pin, empty-file preimage) plus a missing rollback preflight, test-only exports and residual helper copies.

*Not read:* compose.ts import block skimmed; rollback-apply, codex-refresh, codex-effect-ports, external-effect, core coordinator and release read partially; context snapshot code; no tests.

### cli-update-rest

Blocker: terminal retirement refuses bundle files over 64 MiB while bundles ship bin/node. Journal-driven resume paths and coordinator routing were consistent on read-through (crash frontiers not simulated). Also dead code, duplicated helpers and an error-class inconsistency.

*Not read:* update/testing.ts and rollback-testing.ts mostly; migration-participant.ts grep only; owner-participant.ts 1-99; planner/verifier mains; tests; the cli-update-core files.

### cli-bootstrap

Crash and resume logic of the NEW-148/166/167/179/189 changes held up under tracing. Only a misleading message after a resumed rollback and test-only exports.

*Not read:* admission.ts; context.ts (grep); executor.ts outside the diff and sampled ranges; report.ts outside the diff; retention.ts 1-482; journal-store.ts outside the diff; tests.

### cli-lifecycle-hooks-instructions

Hook guards, firing records, inject, attach/detach and the mutation gate are consistent with callers. Four low items: a test-only export, an unused runtime field, a duplicated constant and NotebookEdit coverage.

*Not read:* lifecycle/uninstall.ts, context, adapters, codecs, runtime-records, redaction-key, uninstall-recovery, admission, manifest-anchor, schema-registry, manifest-admission, manifest-rewrite, testing; instructions attach/detach/apply/sources/vendor-homes mostly diff only; tests.

### core-lifecycle-a

Grammar, codecs, store maxima and ledger agree on phase and cursor arms; CORE-LIFE-1 fix present. One real defect: drain_runners failure compensates without the global lock. Six low items.

*Not read:* coordinator-compaction, foundation-compaction, ledger-v2, effect-ledger and tests (except drain ranges); spec 1 §2.4 byte-for-byte cross-check.

### core-lifecycle-b

One recovery wedge (discardUnstarted re-syncs a removed directory). Compaction/ledger agreement, allocator protocol, recovery sequencing and guarded-fs symlink safety hold. Remaining items are dead code, residual constants and a weaker allocator lock check.

*Not read:* types.ts (slices), canonical-json.ts 1-149, testing.ts 60-541, index.ts 60-247, most tests.

### core-update-a

Phase/cursor table, point of no return and compensation cursor are consistent with CLI callers. Five low items: incomplete parity fixes (construction journal, bundle publication validator) and duplication.

*Not read:* Callers outside scope only in traced sections; no tests; docs beyond the NEW-195 amendments.

### core-update-b

Release trust, planner admission and capacity math hold. Owner journal compacting arm unconstrained, Brain/blob collection for a keep-all planner, dead owner planning, test-only exports, duplicated helpers.

*Not read:* migrations.ts and migration-planning.ts (diff only); update/index.ts (scanned programmatically); planner.ts 1-440 via diff; participants/owner/paths heads; tests.

### core-manifest

Prior CORE-REST-1..5 fixed; post-audit publishIntent and bootstrap-closure changes consistent. Six low/medium items: evidence selector ignores slot position, dead ordinal helper, V1 drift error path, duplicated comparator and constants, unused fs members.

*Not read:* bootstrap.ts and bootstrap-retention.ts outside the diff; manifest-state.ts body; all tests.

### core-transactions

Plan-to-finalize machine is sound and crash sweeps are in place. Found the missing-parent wedge, symlink-leaf replacement (probe-confirmed), a release failure that discards a success, and unused interface members.

*Not read:* transactions.test.ts (grep only), update-foundation.test.ts; out-of-scope callers only at grep level; probes ran against a dist build that may lag HEAD.

### core-rest

No correctness defect in git state machine, config reader, index/tree arithmetic, plan validator, hook/instruction parsers or result publisher. Found the weaker runtime path predicate, scope alias cap mismatch, a second CLI git config reader, and extensive dead/over-exported barrel surface.

*Not read:* git/index.ts and plans/index.ts barrels; all tests; consumers outside scope only where needed.

### security-pkg

Most prior security findings fixed at HEAD. New: dangling-symlink bypass of the protected-path policy (high, probe-confirmed), env-secret redaction gaps (probe-confirmed), NodeProcessRunner timeout hang, and a dead scratch store.

*Not read:* update/scratch.ts body, planner-process and verifier-process bodies, archive.ts, graph.ts, markdown.ts, git/* bodies (diff only), tests.

### platform-launcher

No crash or data-loss defect in plist generation, job lifecycle, locks, retained-rename, vendor PATH/home or launcher pinning. Three low items: duplicated trust rule, stable-lock error mapping, over-wide barrel.

*Not read:* launchd effect-journal, plan.ts first half, schedule, index, rest of observe/plist/process-table/effects, macos.ts 1-94, all tests and configs.

### brain-pkg

Narrow review of changes since 5a7462a9; one low defect (merge leaves a stray '!' on embeds). No dead barrel exports.

*Not read:* ingest validate/prompt/glob/proposal, lint, indexes build/render/artifacts/serialize, schema, discovery, capture, garden validate/bundle/select, refactor plan/split/vault, migrations, service.ts beyond the diff, tests.

### adapters-schema

Claude/Codex rendering parity is good via shared renderSkillBody. Key gap: rendered skills omit scopes and inputs. Also unvalidated $input references, unwired overlays, test-only adapter API, Codex render-seam validation gap, hook version gating.

*Not read:* All tests; vocabulary.ts 150-311; docs beyond cited sections; most workflow.yaml files (probed programmatically); package dependency lists.

### sweep-deps-files

Dependency audit clean: every dependency is used and lockfile matches. Only test-only or dead exports and one stale launcher tsconfig reference.

*Not read:* Most source bodies (import/export scans only), pnpm-lock beyond launcher/root entries, per-package vitest configs, docs/plugins/workflows/templates (grep).

### contracts-parity

No hard breakage in integration contracts: workflows, rendered skills and plugin trees agree; CLI commands named in skills exist. Found Codex agents lacking read-only enforcement, renderer duplication and missing quote guards.

*Not read:* brain-answer/brain-report/shared workflows; workflow-schema skill/validate/derive/overlay; adapter compose/hooks/install/instructions/marketplace; most contract tests; instruction bodies; templates; architecture docs beyond greps.

### flow-knowledge

Traced capture to review to ingest to reindex to garden/pulse to inject. Prior FLOW-INIT-4/7 and BRAIN-1 fixed. New defects concentrate on hops toward a model (unredacted garden prompt, argv prompts) and on unhandled states (staging, truncation, path convention, contract drift).

*Not read:* review.ts 1-99, quarantine.ts comments, decide.ts, prompt.ts comments, garden bundle/validate, service.ts outside 120-371, codex invoke, outcome/entry/firing-records, pulse, brain.ts, search, lint, ingest validate/proposal/apply, capture parse/build/render, indexes, redaction.ts, other brain workflows, import.ts.

### flow-lifecycle

Traced init, update/rollback, automation and git enable/disable, uninstall. Main gap: manifest-anchor messages promise self-healing and git/automation re-anchor only in-process. Resumed uninstall under-reports removals. Prior lifecycle P1/P2 findings fixed.

*Not read:* Most large files only in sections (mutation-gate, uninstall, uninstall-recovery, automation/git service, doctor, init, bootstrap report/executor, compose, apply-ports, recovery); many update participants, bootstrap internals, core lifecycle/transactions/update, launchd and security bodies not read.

### flow-vendor-hooks

Registration, argv, payload decoding, handlers, outcome and firing records agree across both vendors. Found product-home write gaps, deselected-Codex hook advice, hooks.md and codex-adapter.md drift, and guard edit containment.

*Not read:* attach/apply/sources/detach heads, bounds.ts, shell-segments head, vendor-invocation.md body, adapter docs beyond greps, launchd/launcher, doctor outside 740-960, uninstall, tests, adapter invoke (flag grep).

### security-wide

Targeted pass on trust-boundary changes. Found the product-home write gap (code every hook runs) and automatic execution of repository node_modules tools. Launcher routes, refresh, vendor parsers, plist escaping and release workflows clean.

*Not read:* format/entry/project-root/update entrypoint/bin/config-file sampled; protected-paths, redaction, admission, planner-process diffs only; many hook guards, security git/scratch, launchd, lifecycle, bootstrap, update, adapters and core bodies not read.

### performance-wide

Measured 4 of 7 findings on synthetic vaults against dist builds (indicative; machine not quiet). Highest impact: serial guarded I/O with 7 realpaths per note, and the term table in index.json read on every session start.

*Not read:* ingest validate/prompt, capture, refactor, garden, lint (sampled), service.ts and discover.ts partly, doctor/ingest/capture/garden/pulse/reindex sampled, update planning, guards, bootstrap report, launchd internals; real doctor and the admission gate not measured.

### tests-quality

All 383 test files map to scripts with no orphans or double runs; no skip/only/todo; time fixtures pinned. Found stale lifecycle shard budget with no partition guard, test-only exports, non-exhaustive death-point lists and a timing-sensitive refresh test.

*Not read:* Most test files scanned mechanically only; e2e/contracts/security/integration bodies; mocked module bodies; docs beyond anchors.

### docs-drift

Prior docs findings mostly fixed; ~25 constants spot-checked match. Seven false claims: two in the new public troubleshooting/install docs that send users to refusing or redundant commands, five in architecture notes.

*Not read:* Architecture notes not read line by line (diff plus greps; threat-model mostly scanned); init/uninstall/ingest only on relevant paths.

### backlog-recheck

Re-verified the 8 open rows >= NEW-147: 7 accurate, 0 fixed, 0 stale, 1 mis-cited (NEW-205).

*Not read:* doctor, bootstrap executor/report, apply-ports, refresh, attach, codex probe, tests and tap.yml sampled; NEW-203 resume path not traced.

### critic

Filled central gaps (ingest validate, capture parse/build, status/config/repair, lifecycle admission/redaction-key/runtime-records/adapters, markdown, manifest-state, launchd plan, doctor 150-440). Found forged trust metadata, dropped redaction records and an incomplete W2-COMPOSE-3 fix.

*Not read:* See Coverage gaps.

## Backlog re-check

The 8 open BACKLOG rows with id >= NEW-147 (NEW-169, 193, 201, 203, 205, 207, 209, 212) were re-verified at HEAD: **7 still open and accurate, 0 fixed, 0 stale, 1 mis-cited (NEW-205; see the NEW-205 finding below).** No row understates its severity.

## P0 — critical

None.

## P1 — high

### AUD-001 — Terminal retirement refuses any retired bundle file over 64 MiB, but every bundle ships bin/node (~122 MB)

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/retirement-participant.ts:75`
- **Problem:** Bundle retirement leaves always carry bytes=null (retirement-resolve.ts:57-58), so #requireFile caps them at MAXIMUM_ROLLBACK_DOCUMENT_BYTES (64 MiB). The release validator admits bundle files up to 512 MiB, and pack-release.ts puts the Node runtime (bin/node) in every bundle. Retiring the prior bundle (second update) or the rejected bundle (rollback) throws at bin/node after the point of no return.
- **Impact:** On a real packaged install the second `update --apply` and every `update rollback --apply` end in exit 6 after the swap commits; the old bundle is never removed, doctor reports a non-clear ledger and later updates are blocked. Only tiny synthetic files are tested; the limit is a ponytail comment, not a backlog row.
- **Evidence:** retirement-resolve.ts:57-58 `// ponytail: the manifest carries no size, so a file leaf is bounded by the 64-MiB document cap` / `bytes: null`; MAXIMUM_ROLLBACK_DOCUMENT_BYTES = 67_108_864 vs MAXIMUM_BUNDLE_FILE_BYTES = 536_870_912
- **Fix:** Carry the signed per-file size into the leaf (from the retained bundle manifest) and cap by it, or use MAXIMUM_BUNDLE_FILE_BYTES for bundle-kind inventories; keep 64 MiB only for document leaves.
- **Validation:** Retirement test with an 80 MiB sparse file in a bundle; packed-release e2e: update, update again, rollback against a real bundle with bin/node.
- **Sources:** cli-update-rest · **Session:** S01

### AUD-002 — A dangling symlink defeats canonicalizePlannedPath, so ProtectedPathPolicy and guard path allow writes into ~/.ssh

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `packages/security/src/paths.ts:59`
- **Problem:** On ENOENT, canonicalizePlannedPath treats the segment as not-yet-created and appends the link's own name to its parent's realpath; it never lstats the segment. `proj/notes.txt -> ~/.ssh/authorized_keys` (target absent) canonicalizes to `proj/notes.txt`, so ProtectedPathPolicy.#resolveAllowed and guardPath both allow it. Same for dangling directory links and `.env` targets.
- **Impact:** A repo-shipped or agent-created symlink plus an induced Write lands an attacker key in ~/.ssh/authorized_keys (absent on many machines), or creates `.env*` / product-state files. Bypasses the documented canonical-half control. Probe on built dist: ALLOW for the link, DENY for the direct path.
- **Evidence:** paths.ts:57-75 `const canonicalAncestor = await realpath(existingAncestor); ... if (!isMissingPathError(error)) throw error; ... unresolvedSegments.unshift(basename(existingAncestor));`
- **Fix:** In canonicalizePlannedPath, on ENOENT lstat the segment; if it is a symlink, either follow readlink relative to its parent and continue, or refuse with SecurityRefusalError. One fix covers every caller.
- **Validation:** protected-paths.test.ts: dangling file link and dangling directory link into an absent ~/.ssh both reject; guard path hook test returns protected-path.
- **Sources:** security-pkg · **Session:** S02

### AUD-003 — A failed drain_runners step is compensated without the global lock held

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/coordinator.ts:445`
- **Problem:** The CLI drain adapter releases the global lock before acquiring runner leases (uninstall.ts:971-988). If the lease deadline expires or the global lock cannot be reacquired, drain() throws and session.global is the released handle. The coordinator treats the throw as a compensable pre-boundary failure and runs launchd/marker compensation and journal rewrites with no flock. requireHeldGlobalLock only compares dev/ino, which a release does not change; store.requireGlobalLock only compares the path.
- **Impact:** A second dos process (uninstall, git, automation, update) can hold the lock while the first rewrites the coordinator journal and restores Foundation/launchd state, breaking the single-writer guarantee. In the reacquire-failure arm this is guaranteed, not theoretical. uninstall.v2.test.ts:656 shows compensation runs in this state.
- **Evidence:** coordinator.ts:445-449 `if (await this.boundaryCrossed(session, cursor)) throw error; session.cause = causeOf(error); await this.enterCompensation(session, cursor);`; uninstall.ts:971 `await global.release(); ... leases = await locks.acquireExistingWithin(...)`
- **Fix:** Make the drain contract failure-safe: the adapter reacquires the global lock before rethrowing and hands the new handle back; if it cannot, refuse recovery-required without compensating. Strengthen requireHeldGlobalLock with a held() probe.
- **Validation:** Coordinator test with a drain that releases then throws: every compensating adapter call sees a held handle, or the run refuses. Extend uninstall.v2.test.ts:656 to assert the lock is held during marker restore.
- **Sources:** core-lifecycle-a · **Session:** S01

## P2 — medium

### AUD-004 — Scheduled gardener sends vault notes to the vendor model unredacted

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/automation/garden.ts:181`
- **Problem:** garden.ts reads each selected note with guards.readText and fences it verbatim into the prompt (bundle.ts noteBlock). The redactor is first built at :209, after invokeAgentOnce at :192, and is used only on the output. Neither built-in classes nor the user's [redaction] patterns are applied to the prompt. Every other model hop (ingest, inject) redacts first.
- **Impact:** Every unattended brain-garden run ships up to 256 KiB of raw note text, including pasted tokens and client names listed in [redaction] patterns, to the vendor. Pointless: such a note's proposals are rejected as redaction_would_alter anyway. No residual is recorded in threat-model §5.
- **Evidence:** garden.ts:180-181 `texts.set(path, await readNote(path)); const { prompt, targets } = buildGardenPrompt({...})`; :209 `const redact = createRedactor(...)`
- **Fix:** Build the redactor before the call; run each note through it and drop targets whose text changes; reuse the redactor for redactionFindings.
- **Validation:** garden.test.ts: with redactionPatterns ["Acme Industries"], assert the captured prompt does not contain the name or a built-in secret sample.
- **Sources:** flow-knowledge · **Session:** S03

### AUD-005 — guard path leaves the hook entrypoint, release bundles, config.toml and the Claude plugin hooks.json writable; the entrypoint imports the bundle without per-file hashes

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/guards/path.ts:63`
- **Problem:** productStateRoots refuses agent writes only under <product-home>/codex and /state. bin/developer-os.mjs (run by every hook), releases/<v>/darwin-<arch>/** (imported by it), config.toml and ~/.claude/skills/developer-os/hooks/hooks.json match no rule. renderEntrypoint hashes the bundle manifest JSON but imports the entry file without checking its sha256, unlike the launcher. Codex hooks.json (under codex/) is protected; Claude's is not.
- **Impact:** One allowed Write/Edit silently disables the command, path and commit guards for all later sessions on both vendors and runs attacker code with every hook payload. Bash can do the same (accepted §3.8 residual), so this is defense-in-depth, but the product protects codex/ and state/ for the same reason and leaves its own code open.
- **Evidence:** path.ts:67 `const roots = productHomes.flatMap((productHome) => [join(productHome, "codex"), join(productHome, "state")]);`; entrypoint.ts:64 `await import(pathToFileURL(join(active.bundleRoot, entry)).href);`
- **Fix:** Refuse the whole product home (bin/, releases/, config.toml) under the product-state rule, plus the Claude plugin root or its hooks/ dir. In renderEntrypoint, check the entry file's size and sha256 against the already-verified bundle manifest row before import(). Update hooks.md §3.3/§3.8.
- **Validation:** path.test.ts: writes to bin/developer-os.mjs, releases/<v>/x.js, config.toml and ~/.claude/skills/developer-os/hooks/hooks.json block with product-state; another plugin under ~/.claude/skills still allows. Entrypoint test: a byte-flipped bundle file makes `guard command` exit 2.
- **Sources:** security-wide, flow-vendor-hooks · **Session:** S02

### AUD-006 — Stop and format hooks run repository-controlled code from the project's node_modules, an unstated trust assumption

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/guards/child.ts:23`
- **Problem:** guard stop runs node_modules/typescript's bin whenever tsconfig.json exists; guard format runs a local prettier/biome (and prettier loads .prettierrc.js). localBin only confines the path to the root; it does not check provenance (git-tracked or declared). No vendor permission prompt covers the spawn.
- **Impact:** A cloned repo that commits node_modules/typescript with a malicious bin gets code execution under the user's uid when the agent's first turn ends, even if the user approved no tool call and never ran npm install. threat-model.md has no row for it.
- **Evidence:** child.ts:26 `const pkgDir = await realpath(join(projectRoot, "node_modules", pkg));`; stop.ts:129 `const script = await localBin(root, "tsc");`
- **Fix:** Run a local tool only if it is not git-tracked and is declared in the root package.json, or gate both verbs on an explicit per-project opt-in; add a threat-model row stating the rule and residual.
- **Validation:** stop.test.ts / format.test.ts: a git-tracked node_modules/typescript (or undeclared tool) yields allow with a note and zero spawns.
- **Sources:** security-wide · **Session:** S02

### AUD-007 — env-secret redaction only matches a name at line start: export/setenv, JSON keys, Basic auth and URL userinfo leak

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `packages/security/src/redaction.ts:621`
- **Problem:** The env-secret regex requires the identifier right after line start plus whitespace; `export `, `setenv `, `- `, JSON `"NAME": "v"` never match. Bearer requires a literal unquoted `Authorization:`. `Authorization: Basic` and `scheme://user:pass@host` have no class. Short values under the 40-char entropy floor stay in the clear.
- **Impact:** Pasted shell rc snippets, compose/JSON configs, curl Basic auth and DB URLs reach the vault and model input unredacted, breaking the redact-before-persistence contract for the most common env spelling. threat-model §5.7 declares none of these residuals. All six probes reproduced on dist.
- **Evidence:** redaction.ts:621 `/(?:^|[\r\n])\s*[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|...)[A-Za-z0-9_]*\s*=\s*([^\r\n]+)/gu`
- **Fix:** Widen the prefix to allow `export `/`setenv `/`- ` and optional quotes with [:=]; add a quoted-key JSON/YAML arm; add Authorization Basic|Bearer (quoted) and URL-userinfo arms. Record anything rejected as a prose risk in §5.7.
- **Validation:** redaction.test.ts: each probe string loses its value; `export default function` and `the token is valid` stay unchanged.
- **Sources:** security-pkg · **Session:** S02

### AUD-008 — Model-authored ingest proposals can forge author, reviewed and stage trust metadata

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/ingest/validate.ts:484`
- **Problem:** No validator requires a model proposal to carry author: agent and reviewed: null. parseNote accepts author human and any reviewed date, so `author: human, reviewed: 2026-10-01, stage: established` passes all nine validators (the only rule is established-with-null-reviewed) and is written verbatim.
- **Impact:** A prompt-injected capture can publish a note that claims human authorship and review, suppressing the provenance lint and staleness rule and surfacing in search as reviewed knowledge. Probe on parseNote: ok=true.
- **Evidence:** validate.ts:484 `if (front.stage === "established" && front.reviewed === null) {` is the only trust-metadata rule; apply.ts:63 writes `note.contents` verbatim
- **Fix:** In validateProposal, for vendor-produced proposals (flag from ingest when note === null) require author agent and reviewed null and refuse stage established; keep note-capture replace exempt.
- **Validation:** validate.test.ts: author human or a reviewed date yields a finding; ingest integration with a fake vendor returning such a note refuses with no vault write.
- **Sources:** critic · **Session:** S03

### AUD-009 — A capture interrupted during the agent call is stranded at `staging`; ingest skips it silently and nothing surfaces it

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/ingest.ts:734`
- **Problem:** ingest writes status staging in its own transaction, then makes the vendor call (up to 120 s). There is no SIGINT/SIGTERM handler, so Ctrl-C there leaves the capture at staging with nothing applied. Later ingests skip non-accepted captures without a warning; status, doctor and pulse never mention staging. The ingest.ts and review.ts docblocks disagree about whether repair helps.
- **Impact:** An accepted observation silently drops out of the pipeline forever; only `review --status staging`, which nothing points to, shows it.
- **Evidence:** ingest.ts:734 `if (outcome.envelope.status !== "accepted") continue;`; pulse.ts:130-131 lists only quarantined and accepted
- **Fix:** Add staging to pulse with an attention code (capture_left_at_staging); warn per staging capture skipped, naming `review --status staging`; correct the ingest.ts:278-283 residual and drop the repair claim.
- **Validation:** Fixture capture at staging: ingest warns naming it; pulse verdict reports the attention code.
- **Sources:** flow-knowledge · **Session:** S03

### AUD-010 — Ingest silently truncates a capture to 16 Ki graphemes and still marks it ingested

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/ingest/prompt.ts:321`
- **Problem:** capture admits up to 64 KiB and explicitly refuses rather than truncates, but the ingest prompt bounds the content to MAX_PROMPT_CONTENT_GRAPHEMES (16 Ki) with an ellipsis, records nothing, and the capture moves to ingested.
- **Impact:** The tail of a long capture (often the later decisions in a session log) never reaches a model and can never be re-ingested. Plausible contributor to NEW-116's long-capture yield.
- **Evidence:** prompt.ts:14 `MAX_PROMPT_CONTENT_GRAPHEMES = 16 * 1024`; :320-322 `fenced(boundedProse(envelope.content, MAX_PROMPT_CONTENT_GRAPHEMES), "text")`
- **Fix:** Refuse an over-long capture with its own reason code and leave it accepted (recovery: split it), or raise the bound to cover MAX_CAPTURE_INPUT_BYTES; at minimum emit a truncated flag and warning and document the bound.
- **Validation:** ingest.test.ts: a 40 KiB capture warns or refuses instead of reaching ingested with a prompt lacking the tail sentinel.
- **Sources:** flow-knowledge · **Session:** S03

### AUD-011 — discardUnstarted re-syncs an already-removed staging directory, so a resumed terminal compaction wedges

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/foundation-participant.ts:251`
- **Problem:** removeFoundationEntry rmdirs foundationStaging/<id> before compactionNext advances. A death in that window resumes the same entry; discardUnstarted finds no blob but still calls syncDirectoryAt on the missing parent, which refuses lifecycle_guarded_parent. The sibling discardCounterfactualInverse already guards this. Reachable: uninstall plans contain create/replace mutations whose compensations are routed to discardUnstarted.
- **Impact:** One crash in that window permanently wedges compaction of an uninstall/update coordinator; every later recover refuses and doctor has no repair path. No data loss.
- **Evidence:** foundation-participant.ts:251-252 `await unlinkStagedBlob(fs, stagedPath); await syncDirectoryAt(...lifecycleParentPath(stagedPath));` vs coordinator-compaction.ts:77-78 `if (await unlinkStagedBlob(fs, stagedPath)) await syncDirectoryAt(...)`
- **Fix:** Mirror the sibling: sync the parent (and fire staged_blob_unlinked) only when the unlink removed something.
- **Validation:** coordinator-compaction.test.ts: compensation inverse with a create mutation, kill at compaction_entry_removed after the rmdir, re-run recover(); it finishes clear.
- **Sources:** core-lifecycle-b · **Session:** S01

### AUD-012 — The executor follows a symlink at the target leaf for snapshot, then replaces the link with a regular file; rollback never restores it

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/core/src/transactions/executor.ts:2281`
- **Problem:** snapshot uses stat/readFile (follows links); apply renames a regular temp over the link path; BackupMetadata has no link kind, so rollback restores a regular file. The guard only canonicalizes and checks protected paths, so an in-vault symlinked note passes (e.g. ingest replace).
- **Impact:** Executor users without their own pre-check (ingest, review, config, reindex artifacts) silently turn a user's symlinked file into a copy, leave the real target stale, and cannot undo it by rollback. Probe: replace on link.md finalized with lstat no longer a link and real.md unchanged.
- **Evidence:** executor.ts:2281-2283 `const stats = await this.dependencies.fs.stat(targetPath); ... await this.dependencies.fs.readFile(targetPath);`; :1486 `await fs.rename(temporaryPath, destination);`
- **Fix:** In snapshot, lstat first and refuse a symlink leaf (one place every caller routes through), or record kind symlink and restore it.
- **Validation:** Unit test: target is a symlink; execute rejects before any write, link and target intact.
- **Sources:** core-transactions · **Session:** S01

### AUD-013 — parseCaptureFile drops persisted redaction findings; review shows 0 and every rewrite erases the record

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/capture/parse.ts:245`
- **Problem:** parseCaptureFile re-derives redaction from the already-redacted body (only markers remain) and never reads the stored frontmatter list. Review prints that count, and review/ingest rewrites render the empty list, erasing the capture-time findings. import.test.ts:477 already works around this.
- **Impact:** Review prints `0 redactions` for every redacted capture, removing the cue that brain.md R8 relies on before a reviewer replaces a note, and the audit trail is wiped on the first decision. Probe: 2 findings at build, 0 after parse.
- **Evidence:** parse.ts:245 `const { content, deduplicationHash, redaction } = redactAndNormalize(body, redact);`; review.ts:69 `redactionCount: envelope.redaction.length`
- **Fix:** Parse and validate the stored redaction array and return its union with any newly found findings, deduplicated by fingerprint.
- **Validation:** parse.test.ts round-trip keeps 2 findings; review.test.ts: after accept, the file still lists both and the listing prints 2 redactions.
- **Sources:** critic · **Session:** S03

### AUD-014 — Rollback replays the update-time Codex executable pin and has no Codex preflight, so it fails mid-transaction after any codex upgrade or removal

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/compose.ts:1384`
- **Problem:** The retained inverse stores the process policy with the pinned codex dev/ino/mode/sha256; rollback copies it unchanged and the resolver refuses update_effect_executable_changed on any mismatch. planRollback never checks codex at all (apply refuses update_codex_unavailable before allocation; rollback falls back to unsupported ports inside the transaction).
- **Impact:** Any brew/npm codex upgrade (or removal) between update and rollback makes rollback restore owner files, then compensate, ending rollback_compensated. The safety net is unusable in the common case and the user learns it only mid-transaction. The byte-equal policy is spec-mandated, so re-resolving needs a spec amendment; a preflight refusal does not.
- **Evidence:** compose.ts:1384 `processPolicy: retained.processPolicy,`; codex-refresh.ts:85 `refuseParticipant("update_effect_executable_changed", ...)`; planning.ts:726-727 codex check is apply-only
- **Fix:** Preflight in planRollback/composeRollback: when a retained owner has externalEffects, resolve codex and refuse before allocation (e.g. update_rollback_codex_changed / update_codex_unavailable). Optionally amend the spec to re-resolve and rebuild codexRefreshPolicy at rollback.
- **Validation:** Apply with a fake codex, replace or remove the binary, run applyRollback: expect a pre-allocation refusal (or a successful refresh after a spec change), not rollback_compensated.
- **Sources:** cli-update-core · **Session:** S01

### AUD-015 — Runtime paths and config brainPath are admitted by a weaker predicate than CanonicalAbsolutePathV1, then cast into the brand

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/core/src/config/paths.ts:22`
- **Problem:** validateAbsolutePath uses node normalize, which keeps a trailing slash; the config loader's absolutePathSchema only checks isAbsolute. setConfigValue and lifecycle services require the canonical grammar; manifest-admission and doctor launder the weaker string with `as CanonicalAbsolutePathV1`.
- **Impact:** DEVELOPER_OS_HOME=/tmp/dos/ (normal shell spelling) makes productionLifecycleContext silently return undefined, so every V2 lifecycle capability reports absent. A hand-edited brainPath with a trailing slash loads, then fails later in git, survey and uninstall.
- **Evidence:** paths.ts:22 `return normalize(value);`; manifest-admission.ts:59 `const brainPath = paths.brain as CanonicalAbsolutePathV1;`
- **Fix:** Resolve with path.resolve and validate with parseCanonicalAbsolutePathText in both resolveRuntimePaths and absolutePathSchema; replace the casts with parsing.
- **Validation:** resolveRuntimePaths with '/foo/' returns '/foo' or throws; loadConfig refuses brainPath '/a/b/'; doctor shows the lifecycle context available for a trailing-slash home.
- **Sources:** core-rest · **Session:** S02

### AUD-016 — update --apply hides that the update was applied when the workflow refresh fails (human mode), and always advises init

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/update/index.ts:151`
- **Problem:** refreshed() returns failureFrom(..., 'developer-os init', result.data) after the swap; main.ts emits update with no renderFailureData, so human mode shows only the stderr message. The recovery is hard-coded to init even when refresh failed with exit 6 (recovery doctor).
- **Impact:** A user sees a failure and assumes nothing changed, then retries or rolls back; only --json shows outcome: applied.
- **Evidence:** update/index.ts:151 `return failureFrom(context, error, [], "developer-os init", result.data);`; main.ts:923 `emit(io, await runUpdate(...), json, renderUpdate)`
- **Fix:** Pass a renderFailureData for update that renders the applied/rolled_back line from error.data; choose the recovery from the refresh code.
- **Validation:** Stub refresh to return 1, run without --json: stdout contains the 'is installed' line and exit is 1.
- **Sources:** cli-entry-misc · **Session:** S01

### AUD-017 — brain readConfig maps every config read failure to 'not initialized, run init'

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/brain.ts:126`
- **Problem:** The catch rethrows ConfigurationError and maps everything else (EACCES lstat, protected-path or symlink refusal from guards.readText) to BrainRefusal invalidInput with recovery `developer-os init`. refactor.ts:188 shares it. Other commands propagate these errors with their own codes.
- **Impact:** brain search/lint/reindex/retire/refactor on an unreadable or policy-refused config.toml exit 2 and tell the user to run init (which refuses on drift), instead of exit 5/1; scheduled brain jobs record the wrong reason.
- **Evidence:** brain.ts:126-131 `catch (error) { if (error instanceof ConfigurationError) throw error; throw notInitialized; }`
- **Fix:** Rely on readConfigFile returning null for absent; let every other error propagate to failureFrom.
- **Validation:** brain.test.ts: config.toml symlinked into ~/.ssh (or chmod 000) gives exit 5 or 1 and no 'not initialized'; absent config stays exit 2.
- **Sources:** cli-entry-misc · **Session:** S04

### AUD-018 — brain-pulse reads stale brain-garden logs after garden is unscheduled, reporting garden_failed_twice forever

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/automation/pulse.ts:36`
- **Problem:** gardenLast reads garden log slots 0..1 unconditionally, ignoring config.automation.lifecycle.schedules. Only a garden run rotates those slots and nothing deletes them on unschedule or disable.
- **Impact:** After two failed or refused garden runs and dropping garden from the schedule, every pulse run reports failure and fires a macOS notification that can never clear.
- **Evidence:** pulse.ts:43 `bytes = await currentBytes(lifecycle.fs, automationLogSlotPath(productHome, "brain-garden", slot), ...)`
- **Fix:** Pass gardenLast: [] unless brain-garden is scheduled, or ignore records older than the schedule change.
- **Validation:** Pulse test: two failed garden records and schedules without brain-garden yield a healthy verdict.
- **Sources:** cli-git-automation · **Session:** S04

### AUD-019 — Ingest prompt mixes path conventions: the index excerpt is vault-relative while the prompt demands content-relative paths

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/ingest.ts:2334`
- **Problem:** index.json paths are vault paths (content/DEV/x.md) and parseIndexExcerpt passes them unchanged. The same prompt forbids the content-root prefix, tells the model never to reuse a listed path, and lists the run's taken paths content-relative. The garden bundle already strips the root.
- **Impact:** Hypothesised cause of both NEW-116 refusal classes (existing-path collisions and write-scope); each refusal costs a 120 s model call.
- **Evidence:** ingest.ts:2333-2337 `path: redact(note.path, "value").text`; prompt.ts:294-298 `` `${example}/x.md`, not `${contentRoot}/${example}/x.md` ``
- **Fix:** In parseIndexExcerpt strip the `${contentRoot}/` prefix and skip entries outside it.
- **Validation:** Prompt test: index entry content/DEV/a.md renders as `- DEV/a.md`.
- **Sources:** flow-knowledge · **Session:** S03

### AUD-020 — ingest workflow contract and rendered skills contradict the CLI and tell the agent to run `developer-os ingest` three times

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `workflows/ingest/workflow.yaml:43`
- **Problem:** The contract's description, scope message, validator, output.applied (a count; the CLI returns an array) and recovery (`repair --resume`, which cannot move a staging capture) are stale. vocabulary.ts maps the three effects to the same command, so the SKILL.md shows three ingest invocations plus a redundant `brain reindex`.
- **Impact:** An agent runs ingest three times: refused captures are retried twice more (up to 3x120 s per capture) and NEW-141 attempt counts triple. The recovery text points to a command that cannot fix the state.
- **Evidence:** workflow.yaml:43 `- a failed apply leaves every capture retryable and none marked ingested`; :46 `resume: developer-os repair --resume <transaction-id>`
- **Fix:** Collapse to one ingest step (or de-duplicate consecutive identical commands in the renderer), drop the reindex step, rewrite description/validators/output/recovery, re-render both plugins.
- **Validation:** Render test: ingest SKILL.md has exactly one `developer-os ingest` block and no `repair --resume`; contract test pins output.applied to the CLI shape.
- **Sources:** flow-knowledge · **Session:** S04

### AUD-021 — Rendered SKILL.md omits the workflow's scopes, inputs, output and validators, yet tells the agent to obey 'the scopes this workflow declares'

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/workflow-schema/src/skill.ts:198`
- **Problem:** renderSkillBody emits only marker, preamble, title, refusals, steps and recovery. Scopes, inputs (e.g. brain-enhance's required `note`), output and validators are validated but never reach either vendor. workflow-schema.md records only description and validators as unrendered.
- **Impact:** The prompt-injection defence references a boundary the agent cannot see; required inputs exist only as prose or $input placeholders, so behaviour depends on guessing.
- **Evidence:** Preamble: "Never widen file access, read or write, beyond the scopes this workflow declares"; brain-enhance SKILL.md contains none of content/**, content/_indexes/**, content/_raw/quarantine/**
- **Fix:** Add Inputs, Scopes and Checks sections to renderSkillBody (screened via boundedProse); re-render both plugin trees.
- **Validation:** skill.test.ts fixture asserts scope globs, input names and validator lines appear; grep regenerated SKILL.md.
- **Sources:** adapters-schema · **Session:** S04

### AUD-022 — After Codex is deselected its hooks.json stays installed and doctor keeps advising the user to trust Codex hooks that cannot fire

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/doctor.ts:858`
- **Problem:** Detach keeps the Codex plugin tree under the product home (foundation.md §12.4) and runs `codex plugin remove`. hookReports reads both vendors' hooks files regardless of adapters.*, so a leftover hooks.json with no post-write firing record is reported unfired. checkCodexRegistration already says 'codex is not selected'.
- **Impact:** Users who drop Codex without having fired its current hooks get a permanent hooks warn whose recovery (CODEX_HOOK_TRUST_STEP) is impossible to follow.
- **Evidence:** doctor.ts:859-863 `installed = { claude: await readInstalledHooks(context, "claude"), codex: await readInstalledHooks(context, "codex") }`
- **Fix:** Report a deselected vendor as `<vendor>=not-selected` (healthy, no recovery), or remove the Codex plugin tree on deselection (needs a §12.4 amendment).
- **Validation:** Doctor test after applyInstructions(['claude']) on a Codex-attached home: hooks check passes without CODEX_HOOK_TRUST_STEP.
- **Sources:** flow-vendor-hooks · **Session:** S04

### AUD-023 — Troubleshooting maps every exit 6 to `repair --resume`, which refuses fresh-install journals and coordinator residue

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/troubleshooting/README.md:20`
- **Problem:** Exit 6 has several remedies at HEAD: tx_fi_* journals need `developer-os init` (the executor refuses repair), coordinator residue needs uninstall or update --apply / rollback --apply, and others need record or anchor fixes. The CLI already prints the right command on its Recovery line.
- **Impact:** A user following the doc after an interrupted init gets another exit 6; repair is refused by the mutation gate for uninstall/update residue. --rollback is never mentioned.
- **Evidence:** README.md:20 `| 6 | Recovery required. Run \`developer-os repair --resume <id>\`, then \`developer-os doctor\`. |`; executor.ts:2074-2075 `resume(id) { refuseBootstrapFoundationId(id);`
- **Fix:** Tell users to run the command on the Recovery line (also shown by doctor) and list the possible forms.
- **Validation:** Every recovery command doctor.ts and executor.ts can print is covered by the revised row.
- **Sources:** docs-drift · **Session:** S04

### AUD-024 — Stale-workflows repair is documented as `init --adapters`, which takes the keg path and can refuse; the code's repair is plain `init`

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/troubleshooting/README.md:34`
- **Problem:** Plain init (no --adapters) renders from the active release bundle (K8/C2). With --adapters, apply.ts uses the keg and runs assertInstalledRelease. update prints `workflows not refreshed: run developer-os init`.
- **Impact:** After brew upgrade or cleanup, `init --adapters claude,codex` exits 4 (release_mismatch / packaged_release_unavailable) where plain init works; naming a subset also detaches the other adapters.
- **Evidence:** init.ts:383 `...(options.adapters == null ? { source: "active-release" as const } : {})`
- **Fix:** Change the snippet to `developer-os init`; mention --adapters only for changing the selection.
- **Validation:** apply.ts selects the active tree only for source active-release; optional runInit test with adapters set reaching assertInstalledRelease.
- **Sources:** docs-drift · **Session:** S04

### AUD-025 — Vault walk and note reads are fully serial, and each note pays 7 realpath calls (3 of them the same home path)

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/indexes/build.ts:660`
- **Problem:** Discovery and the read loop await one note at a time; each note goes through the protected-path guard three times and #resolveAllowed re-canonicalizes the home on every call.
- **Impact:** Measured (synthetic 4,000 notes): guarded discovery ~1.8 s vs 17 ms unguarded; reindex ~4.4 s vs ~2.0 s. Paid by reindex, lint, status, garden, pulse and each ingest capture; linear in vault size.
- **Evidence:** build.ts:659-660 `for (const discovered of discovery.notes) { const source = await request.readFile(discovered.absolutePath);`; protected-paths.ts:185 `canonicalizePlannedPath(this.#home)`
- **Fix:** Cache the canonical home in ProtectedPathPolicy (after a security review), avoid guarding the same file in both assertReadable and readText, and read in a bounded (~16-way) pool keeping the deterministic sort.
- **Validation:** Probe vault: time reindex before/after with byte-identical index.json; patched realpath counts <= 2 per note.
- **Sources:** performance-wide · **Session:** S05

### AUD-026 — index.json carries every note's full term table; search, SessionStart inject, pulse and ingest re-read and re-parse all of it

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/service.ts:293`
- **Problem:** IndexedNote.terms stores the full {term,count} table per note (98% of the file on the probe). sessionContext needs only type/title/aliases but parses and validates the whole document; pulse and ingest parse it to count or excerpt.
- **Impact:** Measured worst case (2,000 notes x 300 terms): 42.9 MB index, sessionContext 134-177 ms per session start inside the hook budget, search ~200 ms. Real vaults are smaller, but it is linear.
- **Evidence:** service.ts:294 `const indexText = await this.readArtifact(paths.index);`; build.ts:325-327 `return [...counts.entries()].map(([term, count]) => ({ term, count }))`
- **Fix:** Move terms into a separate artifact read only by search (or add a small sidecar for the non-term fields); at minimum skip validating terms in sessionContext.
- **Validation:** Time sessionContext and search on the probe vault before/after; reindex/lint drift gates stay green.
- **Sources:** performance-wide · **Session:** S05

## P3 — low

### AUD-027 — Model prompts travel in argv, readable by every local account via ps for up to 120 s

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `packages/adapter-claude/src/invoke.ts:127`
- **Problem:** Both adapters pass the whole prompt (capture body plus index excerpt, or the garden bundle) as one argv element; macOS ps shows other users' argv.
- **Impact:** On a multi-account Mac another user can read redacted capture bodies and the unredacted garden notes during each call; garden runs unattended. Not recorded in the threat model.
- **Evidence:** adapter-claude/invoke.ts:126-128 `const args = ["-p", invocation.prompt, ...`; adapter-codex/invoke.ts:319 `invocation.prompt,` with `stdin: ""`
- **Fix:** Pass the prompt on stdin (codex exec and claude -p both read stdin when not a TTY; record one observation per vendor), or state the residual in threat-model.md.
- **Validation:** Invoke tests assert argv has no prompt text and stdin carries it; one recorded real run per vendor.
- **Sources:** flow-knowledge · **Session:** S07

### AUD-028 — SessionStart inject truncates vault text before redacting it

- **Kind:** security · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/inject.ts:33`
- **Problem:** composeInjection cuts the note and map with capUtf8Bytes; redaction runs later in outcome.ts block(). A secret straddling the cut no longer matches its class. Marker growth can also make block() re-cut and drop the truncation marker.
- **Impact:** A partial secret from an oversized project note reaches the agent on every session start of that project, against the 'redact before truncating' rule.
- **Evidence:** inject.ts:33 `return capUtf8Bytes(`${map}${separator}${note}`, MAX_INJECTED_CONTEXT_BYTES);`; outcome.ts:44-49 redacts afterwards
- **Fix:** Redact inside inject() before budgeting and truncating; let outcome treat the text as already redacted.
- **Validation:** inject.test.ts: a token straddling byte 16384 leaves no unredacted prefix in stdout.
- **Sources:** flow-knowledge · **Session:** S07

### AUD-029 — NodeProcessRunner waits on 'close' with no deadline after its timeout kill (unfixed sibling of W2-SEC-UPD-3)

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/security/src/process.ts:170`
- **Problem:** After the timeout the runner signals the group but settles only when Node emits close, which needs all stdio pipes closed. A setsid descendant holding stdout keeps run() pending forever; the runner never destroys its pipes.
- **Impact:** A daemonizing formatter or TS plugin hangs the format/stop hook until the vendor's hook timeout; the stop guard's build-info cleanup never runs.
- **Evidence:** process.ts:178-181 force-kill timer calls finishFromClose, which returns early while closeInformation is undefined
- **Fix:** After SIGKILL destroy stdin/stdout/stderr and settle from exit or a synthetic close, mirroring planner-process closePipes.
- **Validation:** process.test.ts: child spawns a detached `sleep 30` with inherited stdio; timeoutMs 200 settles timedOut within ~1 s.
- **Sources:** security-pkg · **Session:** S07

### AUD-030 — guard path and guard edit read only tool_input.file_path, so Claude NotebookEdit is not covered

- **Kind:** security · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/hooks/payload.ts:57`
- **Problem:** Matcher and tool list are Edit|Write|MultiEdit; NotebookEdit (believed to use notebook_path; not verified against a captured fixture) never reaches guardPath or guardEdit.
- **Impact:** A notebook under a protected segment can be edited without a protected-path refusal; narrow (existing .ipynb only).
- **Evidence:** payload.ts `claude: { shell: ["Bash"], file: ["Edit", "Write", "MultiEdit"] }`; adapter-claude/hooks.ts:17 `FILE_TOOLS = "Edit|Write|MultiEdit"`
- **Fix:** Capture a NotebookEdit fixture, then add it to matcher and tool list with notebook_path (fail closed when absent), or record the exclusion in hooks.md.
- **Validation:** Payload fixture plus a path-guard test that a notebook under secrets/ blocks; contract-parity test passes.
- **Sources:** cli-lifecycle-hooks-instructions · **Session:** S07

### AUD-031 — brain-compile and brain-enhance splice an untrusted path into single quotes without the quote guard brain-garden has

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `workflows/brain-compile/workflow.yaml:58`
- **Problem:** Only brain-garden says to skip a path containing a single quote. The CLI's quote refusal runs after the shell has parsed the line.
- **Impact:** A vault-derived name with `'` makes the agent emit a shell line that breaks out of the quotes; guidance is inconsistent across sibling workflows.
- **Evidence:** brain-compile:58 `developer-os capture --note '<path>' <<'<word>'`; brain-garden:60-61 "skip a note whose path contains a single quote"
- **Fix:** Add the same guard sentence to brain-compile and brain-enhance, bump versions, re-render.
- **Validation:** canonical.test.ts: every workflow containing `--note '<` also contains the single-quote guard.
- **Sources:** contracts-parity · **Session:** S07

### AUD-032 — Codex agent roles drop the read-only intent the Claude agents declare, though sandbox_mode is an observed accepted key

- **Kind:** inconsistency · **Verdict:** PLAUSIBLE · **Location:** `packages/adapter-codex/src/agent-toml.ts:57`
- **Problem:** renderAgentToml emits only name/description/developer_instructions. Four catalog agents describe themselves as read-only; on Codex nothing narrows them. Claude's tools list is weak too (three keep Bash).
- **Impact:** A Codex user delegating to developer-os-security-auditor in a workspace-write session gets a role that can edit files.
- **Evidence:** agent-toml.ts:4-9 `AGENT_TOML_KEYS = ["name", "description", "developer_instructions"]`; codex-adapter.md:654 lists sandbox_mode as accepted
- **Fix:** Probe whether a role-level sandbox_mode narrows a parent session; if so map read-only agents to sandbox_mode = "read-only", otherwise document that Codex agents are prompt-only.
- **Validation:** agent-toml.test.ts: code-reviewer TOML has sandbox_mode read-only, qa-expert does not; re-run the Codex probe.
- **Sources:** contracts-parity · **Session:** S07

### AUD-033 — guard edit compares a non-canonical edited path with the canonical project root

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/guards/edit.ts:22`
- **Problem:** resolveProjectRoot returns a realpath; an absolute file_path is only resolve()d and containsPath is lexical. guard format canonicalizes first, so the two PostToolUse verbs disagree.
- **Impact:** Under symlinked or case-variant roots (/tmp vs /private/tmp) the shared-file advisory is silently skipped (vendor spelling not observed).
- **Evidence:** edit.ts:22-23 `const lexical = isAbsolute(path) ? resolve(path) : resolve(base, path); if (!containsPath(root, lexical)) continue;`
- **Fix:** Canonicalize the lexical path's parent (as resolveEditedPath does) or accept containment in either the lexical or canonical root.
- **Validation:** edit.test.ts: symlinked project dir with a file linking outside yields advise/shared-file.
- **Sources:** flow-vendor-hooks · **Session:** S07

### AUD-034 — Manifest-anchor messages promise self-healing no writer performs; git/automation re-anchor only in-process after settle()

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/lifecycle/manifest-anchor.ts:151`
- **Problem:** Once the anchor is stale, reanchorManifest and deriveManifestAnchor return early and anchorCommitted re-seeds the chain from the current preimage, so supersededV2Handoff stays false. Git and automation re-anchor only after execute+settle in-process (no afterBoundary), so one crash or settle() error leaves it stale; update re-anchors in afterBoundary (two crashes, NEW-203).
- **Impact:** Every re-run init (including the K8 refresh child) refuses exit 6 while the warning and doctor advice say the next manifest write fixes it; after a standalone write the doctor warning even goes silent. Availability-only, under the accepted NEW-206 residual.
- **Evidence:** manifest-anchor.ts:150-151 `... a re-run init may refuse until the next committed manifest write`; git/service.ts:1823-1825 execute, settle, then reanchorManifest
- **Fix:** Drop the self-healing claim from MANIFEST_ANCHOR_WARNING, its docblock and MANIFEST_ANCHOR_ADVICE; give git/automation an afterBoundary re-anchor (or re-anchor before settle()).
- **Validation:** v2 test: git enable with a fault in settle(), then re-run init does not refuse; assert the warning text no longer claims healing.
- **Sources:** flow-lifecycle · **Session:** S10

### AUD-035 — An update that touches an empty managed file can never be rolled back

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/compose.ts:909`
- **Problem:** Apply retains a zero-byte preimage as zero chunks; rollback's #retainedBlob has no arm for it and refuses update_rollback_restore_unavailable after allocation. ownerRollbackPreview and planRollback do not detect it. Latent: init writes an empty brain/.gitkeep but no release changes it yet.
- **Impact:** A future release that replaces or removes an empty managed file makes rollback permanently unavailable with no warning at update time.
- **Evidence:** compose.ts:911 `// ponytail: an empty preimage retains no blob ...`; planning.ts:392 `const chunks = observed.bytes === 0 ? [] : [...]`
- **Fix:** Add the zero-byte retained source arm, or refuse such an update at preview time; surface the check in planRollback.
- **Validation:** Apply an update replacing an empty owner file, then planRollback/composeRollback restore it or refuse at preview.
- **Sources:** cli-update-core · **Session:** S10

### AUD-036 — Every update reads and secret-screens the whole Brain and all vendor file bytes for a keep-all planner that reads none of it

- **Kind:** flow · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/update/context.ts:353`
- **Problem:** The request builder reads content-dependency blobs and every Brain .md (up to 1 GiB) and the planner supervisor screens each, refusing the whole update on any finding. planKeepAllRelease uses none of it. Spec 2 §8.2 mandates this screening, so it is a design cost, not an implementation bug.
- **Impact:** A secret-shaped note could block `update` with a fixed diagnostic (not verified on a real note); every update reads and pipes up to 1 GiB of private notes to the target planner process.
- **Evidence:** context.ts:361 `const entries = await brainEntries(context, config, blobs);`; planner-process.ts:109 `refuse("Planner frame failed the secret screen")`
- **Fix:** While the planner is keep-all, send blob-less content and an empty Brain entry list (spec amendment), or gate collection on a planner-declared need.
- **Validation:** CLI test: a note with a token-shaped string does not block update; keep-all request has no input blobs.
- **Sources:** core-update-b · **Session:** S10

### AUD-037 — A create into a missing parent directory passes planning, then wedges: apply throws raw ENOENT and neither resume nor rollback finish

- **Kind:** error-handling · **Verdict:** CONFIRMED · **Location:** `packages/core/src/transactions/executor.ts:1476`
- **Problem:** The plan loop never checks dirname exists; writeDurableFile's open is outside the error mapping; restoreOriginalMetadata fsyncs the missing parent. Every production caller mkdirs first, so this needs a caller bug or a vanished directory.
- **Impact:** A half-open transaction blocks init and repair cannot clear it until the directory is recreated by hand. Probe reproduced.
- **Evidence:** executor.ts:1476 `const handle = await fs.open(temporaryPath, "wx", mode);`; :2841 `await syncDirectory(this.dependencies.fs, dirname(targetPath));`
- **Fix:** Refuse with TransactionPlanError when the parent is missing or not a directory before writeStaged; skip the parent sync on restore when the original did not exist.
- **Validation:** execute of a create under a missing dir throws TransactionPlanError with no journal; a hand-built validated journal of that shape rolls back.
- **Sources:** core-transactions · **Session:** S12

### AUD-038 — A lock-release failure after a completed transaction throws out of execute, which callers read as 'nothing happened'

- **Kind:** error-handling · **Verdict:** CONFIRMED · **Location:** `packages/core/src/transactions/store.ts:233`
- **Problem:** On the success path withTransactionLock discards the result and throws TransactionStateError if release() fails; the error path swallows the same failure.
- **Impact:** Rare (close() must fail), but callers skip bookkeeping and tell the user to repair a finalized transaction.
- **Evidence:** store.ts:233-238 `try { await handle.release(); } catch { throw new TransactionStateError("transaction lock release failed"); } return result;`
- **Fix:** Swallow the release failure on the success path and return result, mirroring the error path.
- **Validation:** lockProvider whose release rejects: execute resolves with a finalized journal.
- **Sources:** core-transactions · **Session:** S12

### AUD-039 — validateGitScopeSnapshot admits more than 256 topic aliases, which the persisted gitScopeSchema rejects

- **Kind:** logic · **Verdict:** PLAUSIBLE · **Location:** `packages/core/src/git/planner.ts:318`
- **Problem:** brainSchema and the planner have no alias cap; gitScopeSchema caps at 256. The `exact(input.topicAliases, Object.keys(...))` check is tautological. (The scope-consistency half cannot diverge on this path.)
- **Impact:** More than 256 aliases passes git enable planning, then fails later at persistence with a raw ZodError instead of a typed refusal.
- **Evidence:** loader.ts:255-257 `.refine((value) => Object.keys(value).length <= 256, ...)`; planner.ts:322 `exact(input.topicAliases, Object.keys(input.topicAliases ?? {}), ...)`
- **Fix:** Share one scope validator from config/loader with the planner; replace the tautological exact with an own-keys plain-object check.
- **Validation:** 257-alias scope makes gitScopeOf refuse scope_outside_repository.
- **Sources:** core-rest · **Session:** S12

### AUD-040 — The CLI's second git config reader diverges from core's parseGitConfig and skips the reflog identity grammar

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/git/service.ts:1436`
- **Problem:** parseGitUserIdentity rejects only #, ; and backslash; core's parseReflogName/Email reject <, > and spaces. 'A <b>' passes committerOf and then throws a plain Error deep in planSync. core parseGitConfig is not exported.
- **Impact:** An unusual user.name or user.email causes an untyped planning crash instead of git_identity_unsupported; two config readers to maintain. Fail-closed.
- **Evidence:** service.ts:1436 regex reader `if (/[#;\\]/u.test(value) ...) unsupported();`; core types.ts:407-425 parseReflogName/Email
- **Fix:** Export a readGitUserIdentity built on core parseGitConfig and validate with parseReflogName/Email, mapping failure to git_identity_unsupported.
- **Validation:** user.name 'A <b>' yields git_identity_unsupported; a config with trailing comment reads identically.
- **Sources:** core-rest · **Session:** S12

### AUD-041 — V1 detectDrift lets raw guard errors escape while sibling paths wrap them in ManifestStateError

- **Kind:** inconsistency · **Verdict:** PLAUSIBLE · **Location:** `packages/core/src/manifest/drift.ts:97`
- **Problem:** inspectArtifact calls assertReadable bare; readGuardedFile and guardedV2Path wrap. manifest.test.ts:744-758 pins the V1 pass-through, so this is a design choice to settle.
- **Impact:** Exit-code mapping differs between V1 and V2 for the same refusal; possible path in messages (not verified). Cosmetic.
- **Evidence:** drift.ts:97 `const canonical = await guards.assertReadable(artifact.path);`
- **Fix:** Pick one behaviour (wrap or pass through typed errors) for both V1 and V2 and document it.
- **Validation:** Drift test with a guard rejecting an absolute-path message asserts the chosen behaviour in both V1 and V2.
- **Sources:** core-manifest · **Session:** S12

### AUD-042 — Stable lock maps spawn and fs failures to LifecycleLockShapeError (security) or LifecycleLockMissingError

- **Kind:** error-handling · **Verdict:** CONFIRMED · **Location:** `packages/platform-macos/src/stable-lock.ts:58`
- **Problem:** refuse() turns any non-lock error into Shape (exit 4) or, for ENOENT, Missing (exit 6), including runner.acquire spawn failures of /usr/bin/lockf and open EMFILE/EACCES. LifecycleLockUnavailableError exists for this; transaction-lock.ts maps the same failures to an operational error.
- **Impact:** Transient fd/process exhaustion is reported as lock-file tampering; a missing lockf is reported as a missing lock file.
- **Evidence:** stable-lock.ts:58 `if (isAbsent(error)) throw new LifecycleLockMissingError(path); throw new LifecycleLockShapeError(path);`
- **Fix:** Keep Shape/Missing only for the lock path's lstat/open and shape checks; wrap runner.acquire and handle failures in LifecycleLockUnavailableError.
- **Validation:** stable-lock.test.ts: runner.acquire rejecting ENOENT/EMFILE yields LifecycleLockUnavailableError.
- **Sources:** platform-launcher · **Session:** S12

### AUD-043 — Store header says the codec validates plans at publish, but publish only encodes

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/store.ts:265`
- **Problem:** publish calls executionPlanCodec.encode, which bounds and serializes only; the CLI wraps encode with validateLifecyclePlanGrammar precisely because publish does not validate.
- **Impact:** A new store construction site would silently lose the guard; today only context.ts:274 constructs it.
- **Evidence:** store.ts:264-265 `the real plan is validated by the codec at publish`; store.ts:361 `executionPlanCodec.encode(plan)`
- **Fix:** Correct the comment and the LifecycleValueCodec doc (or validate inside publish).
- **Validation:** Comment matches code; optional store test with a plain codec refusing an invalid plan.
- **Sources:** core-lifecycle-a · **Session:** S12

### AUD-044 — Grammar and codec do not bound compactionNext by the derived compaction entries

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/grammar.ts:579`
- **Problem:** A compacting journal with compactionNext >= entries.length passes codec, grammar and ledger; compactTerminalCoordinator then loops zero times and returns without removing the envelope.
- **Impact:** A corrupted journal leaves the home permanently non-clear with no finding naming the cause; needs same-user corruption.
- **Evidence:** grammar.ts:579-582 `case "compacting": ... requireFinalizedCursor(...) else requireReversibleCursor(...); return;`
- **Fix:** In the compacting case derive the entries and refuse compactionNext >= entries.length.
- **Validation:** Grammar test: compactionNext == entries.length refused with a journal_state finding.
- **Sources:** core-lifecycle-a · **Session:** S11

### AUD-045 — The plan codec enforces previewHash only in one direction

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/codecs.ts:693`
- **Problem:** It rejects non-null previewHash for git_sync/uninstall but accepts null for git_enable/reconcile/disable, which the spec requires to be non-null. Launchd plans already bind it both ways.
- **Impact:** A git plan without its preview binding is accepted; no current consumer reads it back.
- **Evidence:** codecs.ts:692-695 `if (previewHash !== null && (operation === "git_sync" || operation === "uninstall")) fail(...)`
- **Fix:** Require previewHash !== null for every other operation.
- **Validation:** Codecs test: git_enable with null previewHash refused; git_sync/uninstall still valid.
- **Sources:** core-lifecycle-a · **Session:** S11

### AUD-046 — Construction journal lacks the phase guards and rolled_back write-state clearing NEW-181 added to the sibling journals

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/construction.ts:1331`
- **Problem:** directory_created/file_created/evidence/file_complete check only write state, not phase; a pending create_intent can be advanced after compensate fixed its cursor, leaving an uncompensated object. rolled_back neither clears nor requires null write states.
- **Impact:** Latent (the CLI binds intents before compensate), but a buggy executor could reach rolled_back with stray staging files; shape differs from siblings.
- **Evidence:** construction.ts:1331 `case "directory_created": need(current.directoryWriteState?.state === "create_intent");`
- **Fix:** Require the forward phase for those steps, clear write states on the final compensation_step and require null in rolled_back.
- **Validation:** Core tests: *_created from compensating throws; final journal has null write states.
- **Sources:** core-update-a · **Session:** S11

### AUD-047 — Bundle publication validator accepts a stray metadataWriteState in planned, root_publishing and entries_publishing

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/bundle-participant.ts:1096`
- **Problem:** Those phase rows never constrain metadataState; the rollback twin requires null. Only a tampered same-uid journal reaches it.
- **Impact:** A validated-but-impossible journal; weaker phase table than its twin.
- **Evidence:** bundle-participant.ts:1096-1103 planned/root_publishing/entries_publishing rows omit metadataState
- **Fix:** Add metadataState === null to the three rows.
- **Validation:** Core test: those phases with metadataWriteState publish_intent throw.
- **Sources:** core-update-a · **Session:** S11

### AUD-048 — Owner journal `compacting` arm is unconstrained, unlike the migration journal fixed in fb4f87d3

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/participants.ts:447`
- **Problem:** Any cursor combination validates as compacting; owner-participant then compacts every Foundation ref (deleting inverse refs) and refuses compensation. Needs corruption or a writer bug.
- **Impact:** A corrupted owner journal is never detected and compaction removes the inverses of an unfinished update.
- **Evidence:** participants.ts:447 `(phase === "compacting" && compaction !== null);` vs migrations.ts:661 with cursor constraints
- **Fix:** Mirror the migrations arm (complete with no compensation, or compensation -1); check the other journals' compacting arms.
- **Validation:** validateOwnerUpdateJournal: half-applied compacting journals throw; finalized/rolled_back predecessors validate.
- **Sources:** core-update-b · **Session:** S11

### AUD-049 — selectBootstrapEvidenceJournal ignores which slot file held each record, unlike selectBootstrapJournal

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/core/src/manifest/bootstrap-closure.ts:166`
- **Problem:** The evidence selector drops the array index, so a record with slot 1 in file 0 (e.g. a swapped pair) is admitted; its final parity check is a no-op. The strict selector refuses the same input. Used by the launcher and the CLI evidence context.
- **Impact:** The launcher and CLI report terminal/incomplete for a corrupted pair the executor refuses; only on corrupted slot files.
- **Evidence:** bootstrap-closure.ts:176 `values.flatMap((value) => { try { return [validateBootstrapJournal(plan, value)]; } ... })`
- **Fix:** Index the values and return null when a record's slot differs from its position; drop the redundant parity check.
- **Validation:** Evidence-identity test: a valid slot-1 record in slot file 0 returns null.
- **Sources:** core-manifest · **Session:** S11

### AUD-050 — Allocator lock guard checks only the path, not the lock identity

- **Kind:** inconsistency · **Verdict:** PLAUSIBLE · **Location:** `packages/core/src/lifecycle/allocator.ts:81`
- **Problem:** Other lifecycle writers re-stat the lock and compare dev/ino; the allocator compares the path string and raises LifecycleLockShapeError (security). The allocator's own CAS checks largely cover races.
- **Impact:** Defense-in-depth inconsistency; a swapped lock needs a same-uid unlink.
- **Evidence:** allocator.ts:81 `if (held.path !== leafPath(stateDirectory, LOCK_LEAF)) throw new LifecycleLockShapeError(held.path);`
- **Fix:** Also await requireHeldGlobalLock(fs, held) (lift it into fs-helpers.ts).
- **Validation:** Allocator test: recreate the lock file after acquiring; reserve rejects with lifecycle_global_lock_identity.
- **Sources:** core-lifecycle-b · **Session:** S11

### AUD-051 — A failed scheduled git push writes no status/log record and silences the other scheduled jobs

- **Kind:** flow · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/commands/automation/runner.ts:296`
- **Problem:** push_pending leaves retry_only; the post-handler recheck returns silent, so handlers.ts's handler_failed/push_pending mapping is effectively dead; other jobs exit silently. Spec-mandated; `automation status` does show the closure and the next git-sync retries.
- **Impact:** A backup failure leaves no job record and doctor stays quiet; the user sees only a terse closure line.
- **Evidence:** runner.ts:296 `if ((await this.#dependencies.inspect(request.job)).closure !== "clear") return silent("closure_not_clear");`
- **Fix:** Let git-sync write its own handler_failed/push_pending record, or have doctor and automation status report retry_only explicitly; delete the dead mapping if neither.
- **Validation:** Runner test: push_pending handler plus retry_only inspect writes a record, or doctor surfaces the pending push.
- **Sources:** cli-git-automation · **Session:** S09

### AUD-052 — slugify splits words at combining marks, breaking Indic, Thai and similar scripts

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/project-slug.ts:48`
- **Problem:** \p{M} is not in [\p{L}\p{N}], so every vowel sign or tone mark becomes a hyphen: 'प्रोजेक्ट' -> 'प-र-ज-क-ट', 'İstanbul' -> 'i-stanbul'. Capture and inject share the function, so the join key stays consistent.
- **Impact:** Unreadable slugs and possible collisions, contrary to the 'any script' docblock.
- **Evidence:** project-slug.ts:47-48 `.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")`
- **Fix:** Use /[^\p{L}\p{N}\p{M}]+/gu (lowercase then NFC).
- **Validation:** Slug table test: the three examples keep their marks; 'Zeitplan Änderung' -> 'zeitplan-änderung'.
- **Sources:** cli-entry-misc · **Session:** S09

### AUD-053 — slugify can end the slug on a lone surrogate (acknowledged in a comment, not tracked)

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/project-slug.ts:49`
- **Problem:** slice(0, 64) counts UTF-16 units, so an astral letter at the boundary leaves an unpaired high surrogate.
- **Impact:** A lone surrogate is written to capture frontmatter and can break the inject comparison.
- **Evidence:** project-slug.ts:49 `.slice(0, MAX_PROJECT_SLUG_LENGTH)`
- **Fix:** Truncate by code point: Array.from(slug).slice(0, MAX).join(""), then trim hyphens.
- **Validation:** 63 ASCII chars plus an astral letter yields no lone surrogate.
- **Sources:** cli-entry-misc · **Session:** S09

### AUD-054 — Every executor plan error in refactor is reported as 'a note changed after it was read' (exit 3)

- **Kind:** error-handling · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/commands/refactor.ts:293`
- **Problem:** TransactionPlanError is also thrown for malformed plans (empty, duplicate target, bad hash, bad id); refactor maps all to note_changed_since_read and 'run again'. Reachable only through a planner/executor bug.
- **Impact:** Such a bug loops the user through reruns and misreports an internal error as decision-required.
- **Evidence:** refactor.ts:294 `if (!(error instanceof TransactionPreconditionError || error instanceof TransactionPlanError)) throw error;`
- **Fix:** Catch only the drift condition (may need a dedicated core subclass); let other plan errors propagate.
- **Validation:** Stubbed bare TransactionPlanError gives a code other than 3.
- **Sources:** cli-entry-misc · **Session:** S09

### AUD-055 — Post-apply reindex in refactor erases the security class of an index escape

- **Kind:** inconsistency · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/commands/refactor.ts:321`
- **Problem:** refactor passes plain Errors for refuse/refuseIndexEscape and collapses failures to refactor_reindex_failed exit 1; brain reindex makes the escape exit 5. brain.md specifies refactor_reindex_failed exit 1, so the docs disagree with each other.
- **Impact:** Automation keyed on exit 5 misses the escape until the next brain reindex.
- **Evidence:** refactor.ts:321-322 `refuse: (message) => new Error(message), refuseIndexEscape: (message) => new Error(message),`
- **Fix:** Keep the applied wrapper but take the code from the escape refusal (share the factory with brain.ts); align brain.md.
- **Validation:** refactor.test.ts with a symlinked _indexes: exit 5 with the transaction id in the message.
- **Sources:** cli-entry-misc · **Session:** S09

### AUD-056 — GitService.sync accepts a mode parameter it never reads

- **Kind:** unused-param · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/git/service.ts:1907`
- **Problem:** Interactive and scheduled syncs run identical code; the two callers pass literals.
- **Impact:** Misleading contract suggesting scheduled sync differs.
- **Evidence:** service.ts:1907 `const sync = async (_mode: "interactive" | "scheduled", global) => {`
- **Fix:** Drop the parameter from the interface, implementation and both callers.
- **Validation:** tsc and git/handlers tests green.
- **Removal confidence:** high
- **Sources:** cli-git-automation · **Session:** S09

### AUD-057 — A resumed bootstrap rollback rethrows a misleading 'no terminal state' error

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/bootstrap/executor.ts:1700`
- **Problem:** Resuming a compensating journal skips every stage; retainTerminal throws 'bootstrap retention has no terminal state', which routes into compensate; after a successful rollback the original error is rethrown instead of 'the retained bootstrap rolled back'.
- **Impact:** Correct rollback, spurious internal error message; same exit code.
- **Evidence:** executor.ts:4046 throw in retainTerminal; catch path ends with `throw error;`
- **Fix:** Branch on journal.phase === "compensating" before the stage chain, or throw the rolled-back error from the catch when resuming a compensating journal.
- **Validation:** executor.test.ts death-in-compensation cases assert the rolled-back message.
- **Sources:** cli-bootstrap · **Session:** S10

### AUD-058 — A resumed uninstall reports only emptied directories as removed

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/lifecycle/uninstall-recovery.ts:392`
- **Problem:** The recovery arm fills removed only from empty_directory_removed boundaries; the main path also reports file targets and bookkeeping leaves (W2-UNINST-3 fixed only that path).
- **Impact:** --json after a killed uninstall shows almost nothing removed though files and the manifest were deleted.
- **Evidence:** uninstall-recovery.ts:410-412 `afterBoundary: (boundary) => { if (boundary.kind === "empty_directory_removed") removed.push(boundary.path); }`
- **Fix:** Collect the resumed plan's chunk targets and observed-absent bookkeeping leaves, or document directory-only reporting.
- **Validation:** uninstall-recovery.v2.test.ts: kill after the first chunk, resume, removed contains remaining targets and the manifest.
- **Sources:** flow-lifecycle · **Session:** S10

### AUD-059 — Package-channel admission converts every thrown error, including JS defects, into exit 6

- **Kind:** error-handling · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/packaged-release.ts:596`
- **Problem:** asRecoveryRequired wraps TypeError/RangeError as recoveryRequired with no cause; bundle-source rethrows them as exit 1. Same catch-all in recovery.ts:208 and coordinator.ts:86.
- **Impact:** A code defect is reported as a damaged keg; stack and cause are lost.
- **Evidence:** packaged-release.ts:596-602 `throw new PackagedReleaseError(EXIT_CODES.recoveryRequired, error instanceof Error ? error.message : ...)`
- **Fix:** Rethrow TypeError/RangeError/ReferenceError unchanged and pass { cause } when wrapping.
- **Validation:** Stubbed TypeError propagates; plain Error still yields 6.
- **Sources:** cli-update-rest · **Session:** S10

### AUD-060 — renderIngest prints 'Ingested 0 captures verbatim, with no agent' when only unreadable captures exist

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/ingest.ts:2832-2833` (line 2868 at `809a98de`; fixed in NEW-218)
- **Problem:** captures includes unreadable rows, so the 'nothing waiting' branch is skipped and a false header prints; exit 0 is intended.
- **Impact:** Misleading header hides an unreadable capture in quarantine.
- **Evidence:** ingest.ts:2868-2869 `Ingested ${String(result.applied.length)} capture... ${result.agent === null ? "verbatim, with no agent" : ...}`
- **Fix:** Branch on applied.length === 0 and print 'No captures were ingested; N unreadable in quarantine:'.
- **Validation:** renderIngest with only a failed row does not contain 'Ingested 0'.
- **Sources:** cli-knowledge-cmds · **Session:** S06

### AUD-061 — enumerateClaudeMemory silently drops non-file, non-symlink .md entries instead of a skipped row

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/import.ts:297`
- **Problem:** The path walk's classify reports unsupported_type; the memory walk emits nothing (rare edge).
- **Impact:** --claude-memory output does not account for such entries; the two sources disagree.
- **Evidence:** import.ts:297-298 `if (entry.isSymbolicLink()) preset.push(...); else if (entry.isFile()) candidates.push(...)`
- **Fix:** Add `else preset.push(row(relative, "skipped", "unsupported_type"))`.
- **Validation:** Directory or FIFO named a.md under the memory dir yields a skipped/unsupported_type row.
- **Sources:** cli-knowledge-cmds · **Session:** S06

### AUD-062 — Any reindex during an ingest agent call refuses the capture as a hand edit

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/ingest.ts:1586`
- **Problem:** The NEW-40 snapshot binds index artifacts by inode and hash; every reindex rewrites index.json with a new generatedAt, so manual, scheduled or another ingest's reindex trips vault_changed_during_ingest. Ingest takes no lifecycle lock.
- **Impact:** Wasted 120 s call, a refusal claiming a user edit that never happened, and an attempt-count bump.
- **Evidence:** ingest.ts:1610-1615 `if (now === state) continue; changed.push(path);`
- **Fix:** Compare the parsed note set (path/title/summary) for index artifacts, or ignore generatedAt-only changes, or serialize with scheduled jobs.
- **Validation:** Rewrite index.json with identical notes and a new generatedAt during the fake call; the capture ingests.
- **Sources:** flow-knowledge · **Session:** S06

### AUD-063 — brain-enhance binds the note hash at capture time, not at the bytes the agent read

- **Kind:** flow · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/capture.ts:519`
- **Problem:** capture --note hashes the destination when the command runs; the enhance skill reads, searches and drafts first. expectedBeforeSha256 exists only for the garden, with no CLI flag.
- **Impact:** A hand edit made while the enhance is drafting becomes the bound 'before' state and is overwritten after review and ingest.
- **Evidence:** capture.ts:519-521 `const beforeSha256 = await context.guards.readText(destination, async (handle) => createHash("sha256")...)`
- **Fix:** Add `--expect-sha256 <hex>` feeding expectedBeforeSha256 and have the enhance workflow pass the hash of what it read.
- **Validation:** Capture with a stale --expect-sha256 refuses capture_target_changed; contract test requires the flag.
- **Sources:** flow-knowledge · **Session:** S06

### AUD-064 — Garden binds the related-note hash from UTF-8-decoded text while capture hashes raw bytes

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/automation/garden.ts:250`
- **Problem:** Decoded-then-re-encoded text never matches the byte hash for invalid UTF-8; a failed read is sent as "" and also ends target_changed. review.ts already fixed this trap.
- **Impact:** Every related proposal for such a note is rejected target_changed on every run, wasting the call.
- **Evidence:** garden.ts:250 `createHash("sha256").update(checked, "utf8").digest("hex")`
- **Fix:** Return the byte hash from readNote and bind it; skip targets whose read failed.
- **Validation:** Note containing byte 0x93 with a valid related proposal is captured.
- **Sources:** flow-knowledge · **Session:** S06

### AUD-065 — review's unreadable-capture warning embeds the raw file name; the NEW-38 renderPath fix covered ingest only

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/review.ts:337`
- **Problem:** Human output is screened by main.ts, but review --json publishes \p{Cf} characters raw.
- **Impact:** A U+202E file name reorders the warning in any viewer of review --json.
- **Evidence:** review.ts:336-338 `${fileName} is not a readable capture ...`
- **Fix:** Use renderPath(fileName) as ingest does.
- **Validation:** review.test.ts mirrors ingest's NEW-38 case: no U+202E in --json.
- **Sources:** flow-knowledge · **Session:** S06

### AUD-066 — codex-registration reports a failed Codex discovery as 'codex CLI absent'

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/doctor.ts:1678`
- **Problem:** When discovery raised, outcome.discovery is null and the check says absent, while the same report prints codex=present and capabilities unreadable.
- **Impact:** A self-contradicting doctor report and uninspected registration with no hint why.
- **Evidence:** doctor.ts:1678-1681 `const executable = outcome?.discovery?.installed === true ? ... : null; if (executable === null) return warn(..., "codex CLI absent; ...")`
- **Fix:** Branch on discovery === null: 'codex discovery failed; the registration was not inspected'.
- **Validation:** Doctor test with a trust-refusing platform: message does not contain 'absent'.
- **Sources:** cli-install-cmds · **Session:** S08

### AUD-067 — A corrupt config makes doctor's codex-registration pass with 'codex is not selected'

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/doctor.ts:1671`
- **Problem:** collectFindings collapses a thrown config read into null; selectedVendors(null) is [], so the check passes falsely and instructions inspect zero vendors. The configuration check still fails the run.
- **Impact:** Wrong pass line; registration silently not inspected.
- **Evidence:** doctor.ts:1671 `if (manifest?.schemaVersion !== 2 || !selectedVendors(config).includes("codex")) return pass("codex-registration", "codex is not selected", []);`
- **Fix:** When the read threw, warn 'configuration unreadable; the registration was not inspected'.
- **Validation:** Doctor test with malformed config.toml: codex-registration is warn.
- **Sources:** cli-install-cmds · **Session:** S08

### AUD-068 — project-check treats every lstat error as 'absent' and then reports the secret scan clean

- **Kind:** error-handling · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/commands/project-check.ts:124`
- **Problem:** A bare catch continues on any lstat error. chmod 000 on the file does not trigger it; a readable-but-not-searchable project root (or EIO) does, and then secrets pass as clean.
- **Impact:** Narrow edge where an unscanned instruction file passes the secret check with exit 0.
- **Evidence:** project-check.ts:124-129 `try { stats = await context.fs.lstat(path, { bigint: true }); } catch { continue; }`
- **Fix:** Continue only on isMissingEntry; otherwise record the path in unread so the check warns.
- **Validation:** Injected EACCES on lstat yields an instruction-secrets warn naming the file.
- **Sources:** cli-install-cmds · **Session:** S08

### AUD-069 — contextFailure labels every context-build error invalid_input even for exit 4, 5 or 6

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/main.ts:638`
- **Problem:** Keg admission runs inside the context factory for init; its PackagedReleaseError codes are kept but kind is hard-coded invalid_input (failureFrom derives kind elsewhere).
- **Impact:** `init --json` publishes {code:5, kind:invalid_input} for a tampered keg; consumers keyed on kind misclassify it.
- **Evidence:** main.ts:641 `return failure(code === EXIT_CODES.operationalFailure ? EXIT_CODES.invalidInput : code, { kind: "invalid_input", ...`
- **Fix:** Derive kind with kindOf(error); decide the code-less 1-vs-2 rule once and apply it in scheduled mode too.
- **Validation:** main.test.ts: factory throwing PackagedReleaseError code 5 gives a kind other than invalid_input.
- **Sources:** cli-entry-misc · **Session:** S08

### AUD-070 — Codex instruction renderer re-validates none of what the Claude twin re-validates

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `packages/adapter-codex/src/instructions.ts:129`
- **Problem:** No parseInstructionId, assertInstructionRelativePath or SKILL.md presence check at the Codex render seam; sources.ts validates first, so there is no production reach.
- **Impact:** Defense-in-depth asymmetry between vendors.
- **Evidence:** Codex: `path: posix.join(PLUGIN_TREE_PREFIX, "skills", artifact.id, file.relativePath)`; Claude: `const id = parseInstructionId(artifact.id)`
- **Fix:** Mirror the three Claude checks in the Codex renderer.
- **Validation:** instructions.test.ts: Codex skill with `..` or no SKILL.md throws.
- **Sources:** adapters-schema · **Session:** S15

### AUD-071 — Hooks are written into the Codex tree for every supported version, though only observed from 0.155.1 (floor 0.147.0)

- **Kind:** logic · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/instructions/attach.ts:554`
- **Problem:** withCodexHooks runs unconditionally; the version table gates only capability reporting. Behaviour on 0.147-0.154 is unobserved (same pattern on Claude).
- **Impact:** An older Codex may fail to load the plugin or ignore hooks; unverified.
- **Evidence:** versions.ts `CODEX_MINIMUM_VERSION = "0.147.0"; CODEX_HOOKS_OBSERVED_VERSION = "0.155.1"`
- **Fix:** Gate withCodexHooks on the observed version, raise the minimum, or document that older versions ignore the key.
- **Validation:** Install against a stubbed 0.150 omits the hooks key, or record an old-binary load.
- **Sources:** adapters-schema · **Session:** S20

### AUD-072 — validateWorkflow does not check `$input.<name>` references against declared inputs

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/workflow-schema/src/validate.ts:216`
- **Problem:** Nothing ties a with value `$input.x` to a declared input (systemic cause of RENDER-2). Latent: all shipped references are declared. The trigger half of the original claim is refuted (canonical.test.ts covers it).
- **Impact:** A typo or removed input ships a step pointing at a non-existent input with validation green.
- **Evidence:** Probe: replacing $input.query with $input.nonexistent gives errorCount 0
- **Fix:** Add a rule: every $input.<slug> in a step's with names a key of inputs (error).
- **Validation:** validate.test.ts undeclared $input case; shipped workflows still zero errors.
- **Sources:** adapters-schema · **Session:** S20

### AUD-073 — brain refactor --merge turns an embed of the source or target into a stray '!label'

- **Kind:** logic · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/refactor/merge.ts:54`
- **Problem:** The wikilink regex starts at `[[`, so unlinkSelf replaces only the `[[...]]` span and leaves the `!`. Returning null (the finder's fix) would leave a dangling embed to a graveyarded note.
- **Impact:** Merged note gets a stray '!target'; rare, cosmetic.
- **Evidence:** merge.ts unlinkSelf `self.has(resolve(occurrence.text.trim()) ?? "") ? labelOf(occurrence) : null`
- **Fix:** Extend the splice start by one when body[index-1] === '!' so the embed marker is removed with the link.
- **Validation:** merge.test.ts: source body `see ![[target]]` produces no '!target'.
- **Sources:** brain-pkg · **Session:** S20

### AUD-074 — NEW-205 premise is wrong: doctor already reports a missing or mismatched bundle manifest as drift

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/superpowers/BACKLOG.md:128`
- **Problem:** bundles/<hash>.json is a content-verified core manifest row, so its absence or hash mismatch fails doctor's drift check (exit 5). The real gap: doctor never runs readActiveReleaseTree's record-to-manifest binding and version/arch checks, and reports exit 5 where init/automation report exit 6 active_release_tree_invalid.
- **Impact:** A fix from the current row text duplicates existing coverage and misses the real gap; its validation starts from a false baseline.
- **Evidence:** BACKLOG.md:128 "gives no `doctor` finding"; executor.ts:2480-2486 `verification: { mode: "content", installedHash: ref.hash }`
- **Fix:** Re-scope NEW-205 to the binding checks and the exit-code/recovery mismatch.
- **Validation:** Delete bundles/<hash>.json in a fixture home: doctor fails drift naming it (exit 5).
- **Sources:** backlog-recheck · **Session:** S20

### AUD-075 — Install guide requires a manual init after update, but update --apply and rollback --apply already run it

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/install/README.md:31`
- **Problem:** refreshed() runs the refresh after applied/rolled_back (K8).
- **Impact:** A redundant second init per upgrade; users cannot tell the normal path from the failure path.
- **Evidence:** install/README.md:31 "After an update, run `developer-os init` to refresh the workflows."
- **Fix:** Say update --apply refreshes workflows and init is needed only on 'workflows not refreshed'.
- **Validation:** Text matches the refreshed() call sites.
- **Sources:** docs-drift · **Session:** S19

### AUD-076 — hooks.md still describes the hook Node as stableNodePath with init as the only dead-executable recovery

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/hooks.md:309`
- **Problem:** Since C3 a package-channel home renders hooks with the keg runtime (hookNodePath) and doctor's recovery for a dead opt Node is `brew install developer-os`.
- **Impact:** Someone diagnosing a dead hook on Homebrew runs init, which re-renders the same path.
- **Evidence:** active-release.ts:93-96 hookNodePath returns the keg opt path; doctor.ts:845-848 HOOK_OPT_NODE_RECOVERY
- **Fix:** Amend §3.2 to describe hookNodePath and §3.7 to name both recoveries.
- **Validation:** grep hooks.md for hookNodePath and 'brew install developer-os'.
- **Sources:** flow-vendor-hooks · **Session:** S19

### AUD-077 — hooks.md describes guard stop as plain `tsc --noEmit` blocking on any non-zero exit

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/hooks.md:421`
- **Problem:** Code runs `tsc -b --noEmit` with references, falls back per reference on TS5094/TS6310, allows with a note when only stale-reference codes remain, skips when a reference leaves the repo, and creates/removes .tsbuildinfo files.
- **Impact:** Reviewers would treat the NEW-194 allow as a regression; users are not told the hook writes build-info files.
- **Evidence:** hooks.md:421-422 "A non-zero exit is `block`"; stop.ts:158-182
- **Fix:** Extend the §3.4 row and §3.4.1 stop bullet with the build-mode, fallback, allow and cleanup rules.
- **Validation:** Each sentence maps to a stop.test.ts case.
- **Sources:** flow-vendor-hooks · **Session:** S19

### AUD-078 — codex-adapter.md lists snake_case Codex hook events and says no session-end event exists

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/codex-adapter.md:588`
- **Problem:** hooks.md §1 q4 observed PascalCase keys (snake_case ignored) and a schema including sessionEnd.
- **Impact:** Extending CODEX_HOOK_ROWS from this doc writes keys Codex drops silently; the session-end decline rests on a stale reason.
- **Evidence:** codex-adapter.md:588-590 "`pre_tool_use`, ... There is no session-end event"
- **Fix:** Replace with the observed PascalCase event set and restate the decline on the transcript argument.
- **Validation:** grep shows no snake_case event names outside quoted history.
- **Sources:** flow-vendor-hooks · **Session:** S19

### AUD-079 — Several notes still call the capability model three-valued; CAPABILITY_STATES has four values including `no`

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/knowledge-pipeline.md:75`
- **Problem:** NEW-62 added `no`; the adapter notes document it but knowledge-pipeline, claude-adapter:22, codex-adapter:28/429 and threat-model:38/1239 do not.
- **Impact:** doctor --json consumers following these notes would not handle `no`.
- **Evidence:** capabilities/index.ts:32 `["yes", "no", "unknown", "not-used"]`
- **Fix:** Change each occurrence to the four-value model.
- **Validation:** grep for 'three-value|three values|yes | unknown' returns nothing.
- **Sources:** docs-drift · **Session:** S19

### AUD-080 — knowledge-pipeline §2 says the not-used list is four keys; both adapters hold three

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/knowledge-pipeline.md:47`
- **Problem:** D87 removed subagents; the amendment was not updated and contradicts lines 76-80 of the same note.
- **Impact:** Wrong count in a decision-authority note.
- **Evidence:** knowledge-pipeline.md:47 "the not-used list is four keys"
- **Fix:** Change to three keys (four until D87).
- **Validation:** Compare with CLAUDE_NOT_USED_KEYS/CODEX_NOT_USED_KEYS lengths.
- **Sources:** docs-drift · **Session:** S19

### AUD-081 — knowledge-pipeline §1 version snapshot is already wrong for review, brain-search and doctor

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/knowledge-pipeline.md:30`
- **Problem:** Versions bumped the same day the cell was corrected (review 2.2.0, brain-search 2.1.0, doctor 1.1.0); prose duplicates the YAML.
- **Impact:** Will drift with every bump.
- **Evidence:** knowledge-pipeline.md:30 "`review` at `2.1.0`, `brain-search` at `2.0.1`; ... `doctor` at `1.0.0`"
- **Fix:** Replace the list with a pointer to `grep -n '^version:' workflows/*/workflow.yaml`.
- **Validation:** Doc holds no versions or agrees with the YAML.
- **Sources:** docs-drift · **Session:** S19

### AUD-082 — foundation.md's doctor emission-order list omits codex-home-record and misplaces lifecycle

- **Kind:** docs-drift · **Verdict:** CONFIRMED · **Location:** `docs/architecture/foundation.md:716`
- **Problem:** collectFindings emits platform, lifecycle, product-home, configuration, codex-home-record, manifest...; the doc says lifecycle comes first and omits codex-home-record.
- **Impact:** Wrong check ids and order for doctor --json parsers.
- **Evidence:** doctor.ts:1939-1949 `findings: [platform, ...lifecycle.findings, ..., ...homeFindings, manifest,`
- **Fix:** Insert codex-home-record after configuration; say lifecycle follows platform.
- **Validation:** Compare with collectFindings.
- **Sources:** docs-drift · **Session:** S20

### AUD-083 — Lifecycle shard docs and budget are stale (rest runs 13 files, not 11) and nothing guards the partition

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `.github/workflows/check.yml:273`
- **Problem:** active-release.v2.test.ts and refresh.v2.test.ts (both real init) fell into rest; the 224-minute budget and counts were not rechecked. test-lane-filters.test.ts guards only -t filters; a renamed include file silently moves to rest.
- **Impact:** The rest shard can exceed its cancel time and report nothing.
- **Evidence:** check.yml:273 "`rest` (... 11 files, 89 tests)"; 23 *.v2.test.ts files, 10 excluded
- **Fix:** Add a repository test asserting the three lifecycle scripts partition the v2 files and match the documented counts; re-measure and update the budget.
- **Validation:** Renaming a core v2 file fails the new test; per-lane vitest list unions to the full set.
- **Sources:** tests-quality · **Session:** S20

### AUD-084 — Refresh-timeout test depends on a 500 ms child start and a wall-clock bound

- **Kind:** test-gap · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/update/refresh.v2.test.ts:153`
- **Problem:** If node -e starts slower than 500 ms the child dies before writing its pid file and the test fails with ENOENT; the < 5 s assertion is load-dependent.
- **Impact:** Intermittent red in the heaviest shard that looks like a refresh regression.
- **Evidence:** refresh.v2.test.ts:154-161 `runRefreshProcess({...}, 500); expect(Date.now() - started).toBeLessThan(5_000);`
- **Fix:** Wait for the pid file before starting the timeout (or raise it) and drop the wall-clock assertion.
- **Validation:** Run under CPU stress before/after.
- **Sources:** tests-quality · **Session:** S20

### AUD-085 — compareCanonical normalizes and allocates two Buffers per comparison inside term and note sorts

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `packages/brain/src/discovery/discover.ts:72`
- **Problem:** Tokens are already NFC, yet every comparison re-normalizes and allocates.
- **Impact:** Measured ~0.6 s (15-20%) of a 2,000x300 reindex profile.
- **Evidence:** discover.ts:72-76 `Buffer.from(a.normalize("NFC"), "utf8") ... Buffer.compare(left, right)`
- **Fix:** ASCII fast path, or normalize once per element before sorting.
- **Validation:** CPU profile on the probe vault; ordering tests unchanged.
- **Sources:** performance-wide · **Session:** S05

### AUD-086 — Scheduled garden builds the whole vault twice (lint, then reindex)

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/automation/garden.ts:153`
- **Problem:** service.lint() builds and renders; service.reindex() builds again on the same vault. status() already shares one build.
- **Impact:** Duplicate 3-5 s per garden run at a few thousand notes; pulse has a smaller variant.
- **Evidence:** garden.ts:153-155 `const lint = await service.lint(); ... (await service.reindex()).build.index`
- **Fix:** Expose lint-with-build from BrainService and reuse the build.
- **Validation:** Counter around buildIndex asserts one build per run.
- **Sources:** performance-wide · **Session:** S05

### AUD-087 — capture --note on an existing file runs a full reindex to test whether one path is indexed

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/capture.ts:503`
- **Problem:** Builds and renders all artifacts, then keeps one boolean.
- **Impact:** ~2.7-4.5 s per interactive capture --note at 2,000-4,000 notes.
- **Evidence:** capture.ts:503-510 `(await new BrainService(...).reindex()).build.index.notes.some((note) => note.path === vaultPath)`
- **Fix:** Check the one file (parseNote plus discovery rules), or at least call buildIndex without rendering.
- **Validation:** Time capture --note before/after; refusal cases stay covered.
- **Sources:** performance-wide · **Session:** S05

### AUD-088 — Every hook firing imports the entire CLI command graph before dispatching

- **Kind:** performance · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/bin.ts:16`
- **Problem:** bin.ts statically imports main.js, automation and capture before hook dispatch.
- **Impact:** ~50 ms avoidable per PreToolUse firing (finder's measurement).
- **Evidence:** bin.ts:7-18 `import { run } from "./main.js";`
- **Fix:** Lazy-import main/automation/capture when not in hook mode; optionally enable the compile cache.
- **Validation:** Time 20 hook invocations before/after.
- **Sources:** performance-wide · **Session:** S05

### AUD-089 — ingest reindexes the full vault and re-parses the index after every landed capture

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/ingest.ts:2120`
- **Problem:** Deliberate for NEW-116 ordering, but O(captures x vault size).
- **Impact:** Minutes of overhead on large backlogs; shrinks with the build fixes above.
- **Evidence:** ingest.ts:2120 `await reindexVault(context, environment.config, paths, brainConfig);`
- **Fix:** Update the in-memory excerpt incrementally and reindex once at the end, keeping the hand-edit check.
- **Validation:** Stub-vendor ingest of 20 captures timed before/after.
- **Sources:** performance-wide · **Session:** S05

### AUD-090 — doctor re-discovers both agents four times per run

- **Kind:** performance · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/doctor.ts:598`
- **Problem:** discoverEachAgent is called by checkAgents and three capability/registration checks: up to 8 which spawns and trust assertions (init pays it too). network.test.ts pins localSpawns: 8 with a stale comment.
- **Impact:** Wasted spawns and a possible inconsistent report if PATH changes between calls.
- **Evidence:** doctor.ts:598, :653, :1678, :1716 `await discoverEachAgent(context)`
- **Fix:** Discover once in collectFindings and pass outcomes to the four checks; update network.test.ts.
- **Validation:** Counting platform asserts one discoverExecutable per agent per run.
- **Sources:** cli-install-cmds · **Session:** S08

### AUD-091 — sha256, parent-path and timestamp helpers are still copied across the update directory (CLI-UPD-2 / W2-PORTS-6 residue)

- **Kind:** regression · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/state-participant.ts:48`
- **Problem:** bundle-source.ts exports sha256Hex, parentPath and stampAfter, but compose, planning, construction, state-participant, recovery, coordinator and foundation-port keep private copies; NEW-180 fixed only apply-ports.ts.
- **Impact:** Any change to path or hash handling must be made in ~6 places.
- **Evidence:** compose.ts:231 `function sha256(bytes) { return createHash("sha256")...`; state-participant.ts:49 `function parentPath(path) {...}`
- **Fix:** Import the bundle-source helpers (or a small update util) and delete the copies.
- **Validation:** rg shows one parent helper and no local createHash("sha256") in those files; tsc and update tests green.
- **Removal confidence:** high
- **Sources:** cli-update-core, cli-update-rest · **Session:** S15

### AUD-092 — Quarantine helpers are copied across review, ingest, capture, project-init and import

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/review.ts:233`
- **Problem:** captureFileNames and resolveCapturePath are byte-identical (modulo refusal class) in review and ingest; guardsWith is in four files; NOT_INITIALIZED/readConfiguration/assertVaultPresent triplicated.
- **Impact:** Future drift in security-relevant listing and containment checks.
- **Evidence:** review.ts:233 and ingest.ts:660 `async function captureFileNames(...)` identical
- **Fix:** Move captureFileNames and resolveCapturePath(…, refuse) into quarantine.ts and guardsWith into context.ts.
- **Validation:** One definition each by rg; review/ingest/capture suites green.
- **Sources:** cli-knowledge-cmds · **Session:** S15

### AUD-093 — Injection byte cap is defined twice (inject.ts and outcome.ts)

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/outcome.ts:14`
- **Problem:** Lowering one alone would cut the project note without the vault-map marker, contradicting hooks.md §3.4.1.
- **Impact:** Drift risk only.
- **Evidence:** inject.ts:17 `export const MAX_INJECTED_CONTEXT_BYTES = 16_384;` / outcome.ts:14 `const MAX_CONTEXT_BYTES = 16_384;`
- **Fix:** Export one constant and import it in the other.
- **Validation:** inject.test.ts size tests.
- **Sources:** cli-lifecycle-hooks-instructions · **Session:** S15

### AUD-094 — ClaudeRenderer and CodexRenderer are line-for-line copies

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/adapter-codex/src/render.ts:36`
- **Problem:** Frontmatter, screening and path convention live twice; the comment requiring identical truncation cannot be enforced by copies.
- **Impact:** A fix in one adapter makes the plugin trees diverge.
- **Evidence:** Both: `yamlScalar(value) { return JSON.stringify(screenAndCap(value, SKILL_FIELD_CAP)); }`
- **Fix:** Move renderSkillFile into workflow-schema next to renderSkillBody; adapters become wrappers.
- **Validation:** plugins/claude/skills and plugins/codex/skills stay byte-identical; generated tests pass.
- **Sources:** contracts-parity · **Session:** S15

### AUD-095 — Capability reporters duplicate firing-key logic and carry a constant captureVia field

- **Kind:** duplication · **Verdict:** PLAUSIBLE · **Location:** `apps/cli/src/commands/claude-capabilities.ts:55`
- **Problem:** FIRING_KEYS, firingOnly, allUnknown and summarise are in both reporters; captureVia is a single-literal field only echoed. (listPluginFiles is a normal test seam.)
- **Impact:** Every firing-rule change must be made twice.
- **Evidence:** claude-capabilities.ts:95-130 and codex-capabilities.ts:84-120 identical helpers
- **Fix:** Hoist the shared helpers into one module; inline 'command' and drop captureVia.
- **Validation:** Both capability test files green; no captureVia.
- **Removal confidence:** medium
- **Sources:** cli-install-cmds · **Session:** S08

### AUD-096 — ledger.ts and foundation-ledger.ts duplicate guard helpers and size constants

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/ledger.ts:153`
- **Problem:** childPath, stableLockOwner, openRoot, guardedRegularFile, guardedDirectory are verbatim in both; byte ceilings repeat LIFECYCLE_PLAN_BOUNDS.
- **Impact:** A moved bound makes the ledger disagree with the store and codec.
- **Evidence:** ledger.ts:153-155 `const MAX_PLAN_BYTES = 16_777_216; ...`
- **Fix:** Use LIFECYCLE_PLAN_BOUNDS and move the guards into fs-helpers.ts.
- **Validation:** Ledger tests green; ceilings equal LIFECYCLE_PLAN_BOUNDS.
- **Sources:** core-lifecycle-a · **Session:** S13

### AUD-097 — Allocator/nonce leaf names and byte limits are repeated across core lifecycle modules

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/coordinator-compaction.ts:54`
- **Problem:** NONCE_LEAF/ALLOCATOR_LEAF in allocator, compaction and ledger; NONCE_FILE_BYTES and MAX_ALLOCATOR_BYTES in allocator and records.
- **Impact:** A rename in one module makes compaction remove the wrong file or the ledger disagree with the allocator.
- **Evidence:** coordinator-compaction.ts:54-55 `const ALLOCATOR_LEAF = "lifecycle-id-allocator.json"; const NONCE_LEAF = ...`
- **Fix:** Export them once (records.ts or ids.ts) and import.
- **Validation:** One definition outside tests by grep.
- **Sources:** core-lifecycle-b · **Session:** S13

### AUD-098 — Planless staging child list is defined in both recovery and the ledger

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/recovery.ts:45`
- **Problem:** Lists agree today; removal is fail-closed.
- **Impact:** Minor drift risk.
- **Evidence:** recovery.ts:45-46 `DERIVED_STAGING_CHILDREN = ["git", "launchd-process", "participants"]`; ledger.ts:879 STAGING_CHILDREN
- **Fix:** Export STAGING_CHILDREN and derive recovery's constants.
- **Validation:** recovery planless-staging tests green.
- **Sources:** core-lifecycle-b · **Session:** S13

### AUD-099 — Executor-record size literal still repeated in ledger-v2 after CLI-UPD-3 repointed the other sites

- **Kind:** regression · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/ledger-v2.ts:88`
- **Problem:** ledger-v2 keeps MAX_EXECUTOR_RECORD_BYTES = 16_384 though it already imports from update/construction.
- **Impact:** A changed limit would classify valid records malformed.
- **Evidence:** ledger-v2.ts:88 `const MAX_EXECUTOR_RECORD_BYTES = 16_384;`
- **Fix:** Import MAXIMUM_RECOVERY_EXECUTOR_BYTES.
- **Validation:** ledger-v2 executor-record tests pass.
- **Removal confidence:** high
- **Sources:** core-lifecycle-b · **Session:** S13

### AUD-100 — Strict-object helpers re-declared in git/ and diverged from update/scalars exact

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/git/planner.ts:269`
- **Problem:** Three identical private exact() copies lack scalars.exact's plain-prototype check; sameJson and the hex fan-out list are duplicated too. Not covered by CORE-REST-4.
- **Impact:** A tightening lands in one copy only.
- **Evidence:** planner.ts:269, types.ts:232, effect-journal.ts:134 `Object.keys(input).length !== keys.length || ...`
- **Fix:** Import exact/fail from update/scalars.ts; export sameJson and the fan-out list once.
- **Validation:** git tests unchanged; a non-plain object is refused by validateGitEffectPlan.
- **Removal confidence:** high
- **Sources:** core-rest · **Session:** S13

### AUD-101 — core update coordinator keeps private copies of bounds and sha256Hex that construction.ts exports

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/coordinator.ts:239`
- **Problem:** MAX_LEAF_BYTES, MAX_CONSTRUCTION_BYTES, MAX_JOURNAL_BYTES duplicate construction exports; sha256Hex is defined in five places.
- **Impact:** A changed bound makes construction accept refs the coordinator rejects.
- **Evidence:** coordinator.ts:239-244 `const MAX_LEAF_BYTES = 16_777_216; const MAX_CONSTRUCTION_BYTES = 536_870_912; ...`
- **Fix:** Import the construction constants; give sha256Hex one home (scalars.ts) to avoid cycles.
- **Validation:** Core suite green; values unchanged.
- **Sources:** core-update-a · **Session:** S14

### AUD-102 — bundle-participant validateTarget re-implements validateReleaseIdentity with weaker path admission (W2-BUNDLE-2 residue)

- **Kind:** regression · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/bundle-participant.ts:873`
- **Problem:** Private IDENTITY_KEYS and a lexical bundleRoot parse vs release.ts's evidence-based admitCanonicalAbsolutePath; NEW-181 fixed only the entry validator.
- **Impact:** Identity rules can diverge between the bundle plan and the execution plan.
- **Evidence:** bundle-participant.ts:873 `function validateTarget(...) { ... parseCanonicalAbsolutePathText(input.bundleRoot);`
- **Fix:** Call validateReleaseIdentity (thread evidence) or export one key list from release.ts.
- **Validation:** Non-admitted bundleRoot refused identically by both.
- **Sources:** core-update-a · **Session:** S14

### AUD-103 — v2.ts keeps a private UTF-8 comparator and the 64 MiB manifest cap is defined three times

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/manifest/v2.ts:95`
- **Problem:** compare duplicates compareUtf8; MAX_MANIFEST_BYTES in store, manifest-state and v2; a fourth journal-bytes copy in manifest-state.
- **Impact:** Ordering or size changes land in some copies only.
- **Evidence:** v2.ts:95 `function compare(left, right) { const a = encoder.encode(left); ...`
- **Fix:** Import compareUtf8; export one MAX_MANIFEST_BYTES and BOOTSTRAP_MAX_JOURNAL_BYTES.
- **Validation:** v2 and manifest-state tests green.
- **Removal confidence:** high
- **Sources:** core-manifest · **Session:** S14

### AUD-104 — bootstrap-closure.ts re-declares plan-bound constants bootstrap.ts owns

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `packages/core/src/manifest/bootstrap-closure.ts:30`
- **Problem:** MAX_CREATED_PATHS, MAX_LAUNCHABILITY_PATHS, MAX_FOUNDATION_PARTICIPANTS copied from bootstrap.ts.
- **Impact:** Launcher pre-check and validator can silently diverge.
- **Evidence:** bootstrap-closure.ts:30-32 `const MAX_LAUNCHABILITY_PATHS = 200_006;`
- **Fix:** Export the three from bootstrap.ts like the other BOOTSTRAP_MAX_* caps.
- **Validation:** rg 200_006 finds one definition.
- **Removal confidence:** high
- **Sources:** core-manifest · **Session:** S14

### AUD-105 — W2-COMPOSE-3 fix incomplete: bootstrap executor still hand-rolls the foundation-bindings hash

- **Kind:** regression · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/bootstrap/executor.ts:2168`
- **Problem:** NEW-180 consolidated the digest into foundationBindingsHash, but executor.ts keeps a private copy of the domain string; output is byte-identical today.
- **Impact:** A domain/encoding change would make every fresh init build a plan its own admission refuses.
- **Evidence:** executor.ts:2168-2171 `createHash("sha256").update("developer-os/manifest-foundation-bindings/v1\0")...`
- **Fix:** Replace with foundationBindingsHash([forwardId]) (keep the createHash import; used elsewhere).
- **Validation:** Domain string appears only in manifest-state.ts outside tests; executor tests green.
- **Removal confidence:** high
- **Sources:** critic · **Session:** S14

### AUD-106 — Launcher re-implements assertTrustedDirectoryEntry behind a stale 'switch at integration' note

- **Kind:** duplication · **Verdict:** CONFIRMED · **Location:** `apps/launcher/src/selection.ts:261`
- **Problem:** The helper is exported from platform-macos and used by two callers; the launcher keeps a third copy of the ancestor-trust rule.
- **Impact:** Tightening the rule (e.g. ACLs) can miss the launcher's keg check.
- **Evidence:** selection.ts:261 `ponytail: mirrors platform-macos assertTrustedDirectoryEntry ... switch to it at integration.`
- **Fix:** Call assertTrustedDirectoryEntry and map its error to launcher_packaged_fallback_untrusted (keep exit 6); delete the note.
- **Validation:** selection.test.ts keg-ancestor cases unchanged.
- **Sources:** platform-launcher · **Session:** S14

### AUD-107 — Recovery-sweep death-point arrays are test-only exports with no exhaustiveness guard

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/construction.ts:68`
- **Problem:** Seven *_DEATH_POINTS arrays (construction store, bundle source/publication, rollback source/publication, recovery executor, coordinator store) are typed readonly Union[], read only by their own tests, so a new union member compiles without being swept. No drift today; the integration sweeps count guarded-fs calls independently. constructionScreen's redactorFor parameter is also test-only.
- **Impact:** A new crash window can ship without a per-module death-point sweep; test seams ship as public API.
- **Evidence:** construction.ts:68 `export const UPDATE_CONSTRUCTION_STORE_DEATH_POINTS: readonly UpdateConstructionStoreDeathPointV1[] = Object.freeze([...])`
- **Fix:** Make each list exhaustive by construction (`{...} satisfies Record<Union, true>`), or move it into the test; drop redactorFor in favour of stubbing the key.
- **Validation:** Adding an unlisted union member fails the build or a guard test.
- **Removal confidence:** medium
- **Sources:** cli-update-core, cli-update-rest, tests-quality · **Session:** S15

### AUD-108 — CLI production modules export helpers only tests use, and one error class nothing throws

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/bootstrap/report.ts:1458`
- **Problem:** Test-only: inspectBootstrapEvidence (wrapper), the report.ts re-export of selectBootstrapEvidenceJournal, the memoize parameter, listRetainedBackups, hookFiringVerdicts, createLifecycleExecutionPlanCodec, unavailablePackagedReleaseSource (and its null seal branch), isGatedTransactionExecutor (and the GATED WeakSet). LifecycleUnsupportedLeafError is thrown nowhere but asserted in codecs.test.ts.
- **Impact:** Dead surface in the CLI dist and tests that exercise wrappers instead of production entries.
- **Evidence:** report.ts:1458 `export async function inspectBootstrapEvidence(request) { return (await inspectBootstrapEvidenceAdmission(request)).report; }`; codecs.ts:54 LifecycleUnsupportedLeafError
- **Fix:** Point tests at the real entries and delete the wrappers; move helpers into testing.ts modules or un-export; delete LifecycleUnsupportedLeafError and its assertions; keep memoize only if the parity test needs it.
- **Validation:** rg -w shows no non-test reference; lint, tsc and affected suites green.
- **Removal confidence:** medium
- **Sources:** cli-install-cmds, cli-update-rest, cli-bootstrap, cli-lifecycle-hooks-instructions, sweep-deps-files, tests-quality · **Session:** S16

### AUD-109 — V1 uninstall helpers exported with zero external references

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/commands/uninstall.ts:128`
- **Problem:** resolveRoots, partitionArtifacts, planRevert, removeRedactionKeyFile are used only inside uninstall.ts.
- **Impact:** Wider surface; signals reuse that does not exist.
- **Evidence:** uninstall.ts:128 `export async function resolveRoots(` (also :172, :286, :530)
- **Fix:** Drop the export keyword.
- **Validation:** tsc/lint green; rg shows no importers.
- **Removal confidence:** high
- **Sources:** cli-install-cmds · **Session:** S16

### AUD-110 — Unused exports and unreachable dispatch branches in the CLI entry layer

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/context.ts:413`
- **Problem:** createManifestGuards/createTransactionGuards and WORKFLOWS_NOT_REFRESHED are exported but used only in-file; renderBrainResult is a pass-through; the update undefined guard and the dispatch default arm cannot be reached (the guard still narrows types).
- **Impact:** Surface noise; no runtime risk.
- **Evidence:** context.ts:413 `export function createManifestGuards(`; main.ts:428 `function renderBrainResult(result) { return renderBrain(result); }`
- **Fix:** Drop the exports, pass renderBrain directly, keep unreachable arms only as never-checks.
- **Validation:** npm run lint and tsc -b green.
- **Removal confidence:** medium
- **Sources:** cli-entry-misc · **Session:** S16

### AUD-111 — HookRuntime.now is populated by the hook entry but read by no guard

- **Kind:** unused-param · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/hooks/registry.ts:32`
- **Problem:** stop.ts uses the global Date.now(); only test fixtures set the field.
- **Impact:** Every fixture must satisfy a dead field; falsely suggests clock injection.
- **Evidence:** registry.ts:32 `readonly now: () => Date;`; entry.ts:130 `now: () => new Date(),`
- **Fix:** Drop the field, or use it in guardStop's deadline.
- **Validation:** No runtime.now reads outside tests; hook tests green.
- **Removal confidence:** high
- **Sources:** cli-lifecycle-hooks-instructions · **Session:** S16

### AUD-112 — SYNTHETIC_TEMP is completely unreferenced

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `apps/cli/src/update/testing.ts:99`
- **Problem:** Orphaned by df72f4cb (scratch transport removal).
- **Impact:** Dead constant hard-coding a stale path format.
- **Evidence:** testing.ts:99 `export const SYNTHETIC_TEMP = "/synthetic/tmp/developer-os-release-planning-v1-...";`
- **Fix:** Delete the line.
- **Validation:** rg -w SYNTHETIC_TEMP returns nothing.
- **Removal confidence:** high
- **Sources:** sweep-deps-files · **Session:** S16

### AUD-113 — Launcher tsconfig still references the security package it no longer depends on

- **Kind:** inconsistency · **Verdict:** CONFIRMED · **Location:** `apps/launcher/tsconfig.json:18`
- **Problem:** NEW-201(1) removed the dependency; no launcher source imports it. The vitest alias is still needed.
- **Impact:** A future direct import would compile without a declared dependency.
- **Evidence:** apps/launcher/tsconfig.json:18 `{ "path": "../../packages/security" }`
- **Fix:** Delete the reference; keep the vitest alias.
- **Validation:** tsc -b green.
- **Removal confidence:** high
- **Sources:** sweep-deps-files · **Session:** S16

### AUD-114 — Core barrel exports validators and constants only tests use

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/records.ts:115`
- **Problem:** Test-only: parseUninstallingMarker, parseLifecycleBootstrapLock, validateBootstrapFoundationOrdinal, validateGitMetadataBounds, describeGitEnablePlan/GitEnablePlan/GitDisablePlan/GitPlanner.publicMethods, validateGitSyncPlanCore (+assertSourceProjection/validateChange/reflogSize), LIFECYCLE_PREVIEW_FILE_STATES (self-equality test), admitRollbackPayloadRelativePath, deriveUpdateRecoveryExecutorStagedPath (duplicate of construction.ts's helper; backlog Task 18 row is stale), parseLowercaseKebabId, encodePlannerInput, UPDATE_CAPACITY_COMPONENT_ORDER; PROBE_OBSERVATIONS should only be un-exported (it derives a type). The uninstall marker is never parsed in production.
- **Impact:** Large pinned public surface; unexercised parsers look authoritative.
- **Evidence:** records.ts:115 `export function parseUninstallingMarker(bytes, nonce)`; git/planner.ts:543 `export function validateGitSyncPlanCore<T>(...)`
- **Fix:** Delete (or un-export) each and update the barrels and index.test.ts, with founder sign-off (NEW-182 narrow-export policy); or wire parseUninstallingMarker / validateGitSyncPlanCore into recovery if intended.
- **Validation:** rg -w per name hits only the definition; core suite and lint green.
- **Removal confidence:** medium
- **Sources:** sweep-deps-files, core-lifecycle-b, core-manifest, core-rest, core-update-b · **Session:** S17

### AUD-115 — Core barrel re-exports ~40 values and ~80 types that nothing outside core imports

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/index.ts:505`
- **Problem:** git, config and capabilities internals (e.g. inspectGitMetadata, readGitScopeSnapshot, CONFIG_*_KEYS, CAPABILITY_STATES) are reachable only through the barrel and pinned by index.test.ts. Over-exported, not dead.
- **Impact:** A frozen API with no consumer; any rename is a package-contract change.
- **Evidence:** index.ts:205 `export { CAPABILITY_STATES, PROBE_OBSERVATIONS } from './capabilities/index.js';`
- **Fix:** Trim the re-exports to names apps and sibling packages import; update index.test.ts.
- **Validation:** tsc -b workspace green; rg per removed name returns core-internal and tests only.
- **Removal confidence:** medium
- **Sources:** core-rest · **Session:** S17

### AUD-116 — LifecycleExecutionPlanV2 type is exported on both barrels with zero consumers

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/types.ts:297`
- **Problem:** Only the spec names it; readers use other types.
- **Impact:** Invites building on an unused union.
- **Evidence:** types.ts:297 `export type LifecycleExecutionPlanV2<...> = | TPlanV1 | UpdateLifecycleCoordinatorPlanV2;`
- **Fix:** Delete the alias and barrel entries (or keep if the spec intends it).
- **Validation:** rg -w shows definition and barrels only; tsc green.
- **Removal confidence:** medium
- **Sources:** core-lifecycle-b · **Session:** S17

### AUD-117 — causeOf and effectRefOf are exported from the lifecycle coordinator but used only in that file

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/coordinator.ts:184`
- **Problem:** No barrel re-exports them.
- **Impact:** Wider surface for no reason.
- **Evidence:** coordinator.ts:184 `export function causeOf(error)`; :225 `export function effectRefOf(`
- **Fix:** Drop export.
- **Validation:** rg shows only in-file references.
- **Removal confidence:** high
- **Sources:** core-lifecycle-a · **Session:** S17

### AUD-118 — GIT_SYNC_CARDINALITY carries three limits nothing reads; one duplicates GIT_TREE_FINGERPRINT_MAX_ENTRIES

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/git/planner.ts:118`
- **Problem:** maxSourceReflogTransitions, maxDestinationControlTransitions, maxNewGitTreeEntries are unread.
- **Impact:** Readers assume limits are enforced that are not.
- **Evidence:** planner.ts:118-121 `maxSourceReflogTransitions: 2, maxDestinationControlTransitions: 2, ... maxNewGitTreeEntries: 511,`
- **Fix:** Remove them or enforce them in deriveGitSyncCardinality.
- **Validation:** tsc; planner cardinality tests.
- **Removal confidence:** high
- **Sources:** core-rest · **Session:** S17

### AUD-119 — formatJsonResult is exported public API with no production caller

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/result.ts:1122`
- **Problem:** Its docblock records deliberate retention as tested API; used in several tests.
- **Impact:** Offers a text-only publish path; low value either way.
- **Evidence:** result.ts:1122 `export function formatJsonResult<T>(result) { return publish(result).text; }`
- **Fix:** Delete and switch tests to publish(result).text, or leave as recorded.
- **Validation:** tsc; result, ingest, sentinel tests pass.
- **Removal confidence:** medium
- **Sources:** core-rest · **Session:** S17

### AUD-120 — Instruction catalog's legacyName is validated and shipped but never read in production

- **Kind:** unused-param · **Verdict:** CONFIRMED · **Location:** `packages/core/src/instructions/catalog.ts:53`
- **Problem:** Only the coverage test reads it.
- **Impact:** Required schema field with no runtime reader; costlier to remove later.
- **Evidence:** catalog.ts:53 `if (typeof legacyName !== 'string' || ...) invalid();`
- **Fix:** Decide: drop from ROW_KEYS/catalog.json/foundation.md, or document its future use.
- **Validation:** Coverage and catalog tests pass.
- **Removal confidence:** low
- **Sources:** core-rest · **Session:** S17

### AUD-121 — planOwners and rehydrateOwnerCreates are unreachable in production after the keep-all planner

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/update/owner.ts:212`
- **Problem:** Owner providers are used only to choose which blobs to read; adapter plan() functions run only in tests. Spec treats them as scaffolding for a future owner diff.
- **Impact:** ~120 lines plus two adapter planners drift while guarding nothing.
- **Evidence:** owner.ts:212 `export function planOwners(registry, snapshot)`
- **Fix:** Delete with the blob fetching, or record them as scaffolding in the backlog.
- **Validation:** rg -w planOwners empty outside removed tests.
- **Removal confidence:** low
- **Sources:** core-update-b · **Session:** S18

### AUD-122 — ReleasePlanningScratchStore/Attempt (~1,180 lines) have no production consumer since df72f4cb

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/security/src/update/scratch.ts:970`
- **Problem:** The transport was withdrawn (D84 K1); tryLock has no production implementation; ZstdUstarAdmission is used only by tests. Retention is documented in-code, so this needs a founder decision.
- **Impact:** ~1,600 lines of security-critical code kept and exported with no caller; its lock contract is untested in production.
- **Evidence:** scratch.ts:664-666 "no production caller exists since D84 K1 withdrew the transport"
- **Fix:** Delete (moving VerifiedScratchBundleV1 to its consumer), or amend Spec 2 K1/K6 and add a backlog row recording it as dormant.
- **Validation:** rg returns only packages/security or nothing; security suite green.
- **Removal confidence:** medium
- **Sources:** security-pkg · **Session:** S18

### AUD-123 — About 35 value exports in the platform-macos barrel have no consumer outside the package

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/platform-macos/src/index.ts:62`
- **Problem:** Launchd validators, hashes, error classes and constants are used internally but re-exported for no one (same pattern NEW-183 pruned in security).
- **Impact:** Wide surface binding outsiders to internals.
- **Evidence:** e.g. launchdPlanHash, encodeLaunchdEffectPlan, MAX_VENDOR_SEARCH_PATH_BYTES re-exported with zero outside references
- **Fix:** Remove the unused re-exports; keep those with external consumers.
- **Validation:** tsc -b across cli, launcher, platform-macos; suites green.
- **Removal confidence:** medium
- **Sources:** platform-launcher · **Session:** S18

### AUD-124 — Adapter packages export test-only helpers through their barrels

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/adapter-claude/src/install.ts:121`
- **Problem:** proposeClaudeUninstall, proposeCodexUninstall, the CodexAdapter facade, isValidClaudeObservation, claudeTargetEntries, codexTargetEntries and AGENT_TOML_KEYS have no production caller (NEW-111 shipped without the *TargetEntries). proposeClaudeUninstall also lacks Codex's containedWithin normalize check.
- **Impact:** Dead surface kept in step with core shapes; a future caller of the Claude proposer inherits a path-escape gap.
- **Evidence:** install.ts:121 `export function proposeClaudeUninstall(context, managed)`; update/plan.ts:21/30 *TargetEntries
- **Fix:** Delete or mark as pinned API; if kept, port containedWithin to the Claude proposer.
- **Validation:** Dead-code grep clean; adapter index tests updated.
- **Removal confidence:** medium
- **Sources:** adapters-schema, sweep-deps-files · **Session:** S18

### AUD-125 — Overlay machinery has no production caller

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/workflow-schema/src/overlay.ts:47`
- **Problem:** Both compose paths call render(contract, null); notes is never read and lifecycle is discarded. Documented as a designed feature with no loader.
- **Impact:** Carried complexity and a security invariant with no consumer.
- **Evidence:** overlay.ts:47 `workflowOverlaySchema = z.object({ extends, steps, lifecycle: ..., notes: ... })`
- **Fix:** Delete lifecycle/notes, or document overlays as an unwired extension point.
- **Validation:** No overlay loader by grep; workflow-schema and adapter tests green.
- **Removal confidence:** medium
- **Sources:** adapters-schema · **Session:** S18

### AUD-126 — ManifestFileSystem.chmod/readFile and DriftFileSystem.readFile are never called

- **Kind:** unused-param · **Verdict:** CONFIRMED · **Location:** `packages/core/src/manifest/types.ts:145`
- **Problem:** Leftovers from before readStableRegularFile; chmod is applied to the handle.
- **Impact:** Every caller and test double supplies unused functions; hides the real capability surface.
- **Evidence:** types.ts:148 `readonly chmod: typeof chmod; ... readonly readFile: typeof readFile;`
- **Fix:** Remove the three members.
- **Validation:** tsc green; no fs.readFile/fs.chmod in manifest/.
- **Removal confidence:** medium
- **Sources:** core-manifest · **Session:** S18

### AUD-127 — TransactionFileSystem.link and .utimes are required members nothing calls

- **Kind:** unused-param · **Verdict:** CONFIRMED · **Location:** `packages/core/src/transactions/types.ts:93`
- **Problem:** Timestamps go through the file handle; context.ts literals supply them only to satisfy the interface.
- **Impact:** Overstates the executor's filesystem authority.
- **Evidence:** types.ts:93 `readonly link: typeof link;` / :101 `readonly utimes: typeof utimes;`
- **Fix:** Remove both and the object-literal entries.
- **Validation:** Typecheck green; no callers by grep.
- **Removal confidence:** medium
- **Sources:** core-transactions · **Session:** S18

### AUD-128 — Redundant canonical re-encode after decodeCanonicalJson in ledger-v2

- **Kind:** dead-code · **Verdict:** CONFIRMED · **Location:** `packages/core/src/lifecycle/ledger-v2.ts:156`
- **Problem:** decodeCanonicalJson already refuses non-canonical input, so the extra compare can never fail.
- **Impact:** Unreachable branch and a double encode of up to 16 MiB per scan.
- **Evidence:** ledger-v2.ts:156-160 `if (encodeCanonicalJson(value) !== decoder.decode(bytes)) throw new Error("not canonical");`
- **Fix:** Call decodeCanonicalJson directly; drop the unused import.
- **Validation:** Malformed-plan tests still classify malformed.
- **Removal confidence:** high
- **Sources:** core-lifecycle-b · **Session:** S13

## Refuted or duplicate

Refuted by the verifiers:

- cli-knowledge-cmds: Zero-note proposal ends as `ingested` with nothing reported (`apps/cli/src/commands/ingest.ts:2098`) — Documented design (ingestOne docblock); output distinguishes it.
- cli-git-automation: Pulse reimplements ENOENT detection diverging from isMissingEntry (`apps/cli/src/commands/automation/pulse.ts:71`) — Deliberate absent-vs-unreadable split; same verdict class.
- core-lifecycle-a: Store guards omit the ledger's owner check (`packages/core/src/lifecycle/store.ts:531`) — Ownership enforced by guarded-fs one layer down.
- core-update-a: rollback.ts imports codec helpers via bundle-participant (`packages/core/src/update/rollback.ts:18`) — Intended re-export per e70a3855; no behaviour defect.
- core-update-b: postimages.ts adds a fifth canonical/same copy (`packages/core/src/update/postimages.ts:15`) — One-line wrappers over a single shared encoder.
- core-update-b: Preview builder does not bind metadata to target identity (`packages/core/src/update/preview.ts:377`) — Single caller builds both from the same locals; speculative.
- core-transactions: Helper duplicates between store.ts and executor.ts (`packages/core/src/transactions/executor.ts:171`) — Small identical bodies; hasKeys differs on purpose; founder decision (NEW-182) keeps mirrors.
- adapters-schema: proposeCodexInstall replaces any managed row regardless of owner (`packages/adapter-codex/src/install.ts:233`) — Production never passes `managed`; unreachable.
- adapters-schema: Claude/Codex renderers, hooks and resolvers are byte duplicates (`packages/adapter-claude/src/capabilities.ts:82`) — Recorded deliberate residual (codex-adapter.md residual 11); remainder immaterial.
- adapters-schema: capabilities entries accepted but nothing requires them (`packages/workflow-schema/src/contract.ts:19`) — Documented reserved vocabulary (workflow-schema.md §8 item 9).
- contracts-parity: AGENT_TOML_KEYS not used by the emitter (`packages/adapter-codex/src/agent-toml.ts:10`) — agent-toml.test.ts asserts emitted keys equal the constant.
- contracts-parity: brain-search limit described as candidates (`workflows/brain-search/workflow.yaml:14`) — Wording nit; same observable behaviour.
- tests-quality: init entrypoint-beside-envelope warning arm untested (`apps/cli/src/commands/init.ts:354`) — Misquoted; predicate pinned by init.test.ts:1007-1024.
- tests-quality: admitV2Home reclassification arms untested (`apps/cli/src/lifecycle/command-home.ts:31`) — config.test.ts:79 covers the claimed arm.

Merged during synthesis (same root cause; kept the higher severity):

- CLI test-only exports: cli-install-cmds: hookFiringVerdicts; cli-update-rest: unavailablePackagedReleaseSource; cli-bootstrap: report.ts/retention.ts test-only exports; cli-lifecycle-hooks-instructions: isGatedTransactionExecutor; sweep-deps-files: CLI production modules export test-only functions; tests-quality: test-only exports incl. LifecycleUnsupportedLeafError
- core test-only exports: sweep-deps-files: core barrel test-only exports; core-lifecycle-b: parseLifecycleBootstrapLock/parseUninstallingMarker; core-lifecycle-b: LIFECYCLE_PREVIEW_FILE_STATES; core-manifest: validateBootstrapFoundationOrdinal; core-rest: validateGitSyncPlanCore; core-rest: describeGitEnablePlan and friends; core-update-b: paths/scalars/planner exports
- adapter test-only exports: adapters-schema: proposeClaudeUninstall et al.; sweep-deps-files: adapter barrel test-only helpers
- update helper copies: cli-update-core: sha256/parent-path helpers; cli-update-rest: CLI-UPD-2 residue
- death-point lists: cli-update-core: UPDATE_CONSTRUCTION_STORE_DEATH_POINTS and redactorFor; cli-update-rest: six death-point arrays; tests-quality: no completeness guard
- rollback Codex: cli-update-core: stale Codex pin (medium); cli-update-core: no rollback Codex preflight (low)
- guard path product home: security-wide: bin/releases/config.toml writable (medium); flow-vendor-hooks: bin/releases/Claude hooks.json writable (low)

## Coverage gaps

Still unread by any finder or the critic:

- apps/cli/src/bootstrap/executor.ts outside the diff and sampled ranges (about 3,000 lines)
- packages/core/src/manifest/bootstrap.ts and bootstrap-retention.ts bodies outside the diff (about 3,500 lines)
- apps/cli/src/lifecycle/uninstall.ts outside sampled ranges
- apps/cli/src/bootstrap/journal-store.ts, admission.ts and context.ts
- apps/cli/src/lifecycle/codecs.ts, schema-registry.ts, manifest-admission.ts, manifest-rewrite*.ts, context.ts; adapters.ts 401-487
- packages/core/src/update/migrations.ts and migration-planning.ts (diff only since the prior audit)
- packages/platform-macos/src/launchd/plan.ts 388-753, effect-journal.ts, schedule.ts, process-table.ts bodies
- packages/security/src/git/* bodies (diff only), update/graph.ts, planner-process.ts, verifier-process.ts, archive.ts bodies
- packages/brain/src/schema/note.ts, lint/lint.ts, indexes/render.ts, discovery/discover.ts (partly), refactor/split.ts and vault.ts, garden/select.ts and bundle.ts, migrations/*
- apps/cli/src/commands/git/service.ts lines 700-880, 1100-1340, 1540-1700
- apps/cli/src/commands/doctor.ts lines 440-700 and 950-1540; init.ts lines 1-300 and 430-866
- packages/core/src/manifest/manifest-state.ts lines 917-1133
- All *.test.ts files were only grepped or sampled, and vitest was not run

## Implementation sessions

Each session groups 5–7 related findings; P0 and P3 are never mixed (there are no P0 findings).

### S01 (P1/P2, 6 findings)

**Goal:** Make update, rollback and lifecycle recovery finish safely on real installs (retirement cap, drain lock, compaction wedge, symlink leaf, Codex rollback preflight, honest update output).

- AUD-001 (P1) Terminal retirement refuses any retired bundle file over 64 MiB, but every bundle ships bin/node (~122 MB)
- AUD-003 (P1) A failed drain_runners step is compensated without the global lock held
- AUD-011 (P2) discardUnstarted re-syncs an already-removed staging directory, so a resumed terminal compaction wedges
- AUD-012 (P2) The executor follows a symlink at the target leaf for snapshot, then replaces the link with a regular file; rollback never restores it
- AUD-014 (P2) Rollback replays the update-time Codex executable pin and has no Codex preflight, so it fails mid-transaction after any codex upgrade or removal
- AUD-016 (P2) update --apply hides that the update was applied when the workflow refresh fails (human mode), and always advises init

### S02 (P1/P2, 5 findings)

**Goal:** Close the path-security and hook trust gaps (dangling symlinks, product-home writes, node_modules execution, env-secret coverage, canonical runtime paths).

- AUD-002 (P1) A dangling symlink defeats canonicalizePlannedPath, so ProtectedPathPolicy and guard path allow writes into ~/.ssh
- AUD-005 (P2) guard path leaves the hook entrypoint, release bundles, config.toml and the Claude plugin hooks.json writable; the entrypoint imports the bundle without per-file hashes
- AUD-006 (P2) Stop and format hooks run repository-controlled code from the project's node_modules, an unstated trust assumption
- AUD-007 (P2) env-secret redaction only matches a name at line start: export/setenv, JSON keys, Basic auth and URL userinfo leak
- AUD-015 (P2) Runtime paths and config brainPath are admitted by a weaker predicate than CanonicalAbsolutePathV1, then cast into the brand

### S03 (P2, 6 findings)

**Goal:** Harden model input and capture integrity in the knowledge pipeline (garden redaction, forged trust metadata, truncation, staging visibility, redaction record, path convention).

- AUD-004 (P2) Scheduled gardener sends vault notes to the vendor model unredacted
- AUD-008 (P2) Model-authored ingest proposals can forge author, reviewed and stage trust metadata
- AUD-009 (P2) A capture interrupted during the agent call is stranded at `staging`; ingest skips it silently and nothing surfaces it
- AUD-010 (P2) Ingest silently truncates a capture to 16 Ki graphemes and still marks it ingested
- AUD-013 (P2) parseCaptureFile drops persisted redaction findings; review shows 0 and every rewrite erases the record
- AUD-019 (P2) Ingest prompt mixes path conventions: the index excerpt is vault-relative while the prompt demands content-relative paths

### S04 (P2, 7 findings)

**Goal:** Align contracts, config handling and user docs with the CLI (ingest contract, SKILL.md scopes, brain config errors, pulse, deselected Codex, troubleshooting).

- AUD-017 (P2) brain readConfig maps every config read failure to 'not initialized, run init'
- AUD-018 (P2) brain-pulse reads stale brain-garden logs after garden is unscheduled, reporting garden_failed_twice forever
- AUD-020 (P2) ingest workflow contract and rendered skills contradict the CLI and tell the agent to run `developer-os ingest` three times
- AUD-021 (P2) Rendered SKILL.md omits the workflow's scopes, inputs, output and validators, yet tells the agent to obey 'the scopes this workflow declares'
- AUD-022 (P2) After Codex is deselected its hooks.json stays installed and doctor keeps advising the user to trust Codex hooks that cannot fire
- AUD-023 (P2) Troubleshooting maps every exit 6 to `repair --resume`, which refuses fresh-install journals and coordinator residue
- AUD-024 (P2) Stale-workflows repair is documented as `init --adapters`, which takes the keg path and can refuse; the code's repair is plain `init`

### S05 (P2/P3, 7 findings)

**Goal:** Cut Brain build and index cost on every hot path (serial guarded I/O, term table in index.json, comparator, duplicate builds, hook import graph).

- AUD-025 (P2) Vault walk and note reads are fully serial, and each note pays 7 realpath calls (3 of them the same home path)
- AUD-026 (P2) index.json carries every note's full term table; search, SessionStart inject, pulse and ingest re-read and re-parse all of it
- AUD-085 (P3) compareCanonical normalizes and allocates two Buffers per comparison inside term and note sorts
- AUD-086 (P3) Scheduled garden builds the whole vault twice (lint, then reindex)
- AUD-087 (P3) capture --note on an existing file runs a full reindex to test whether one path is indexed
- AUD-088 (P3) Every hook firing imports the entire CLI command graph before dispatching
- AUD-089 (P3) ingest reindexes the full vault and re-parses the index after every landed capture

### S06 (P3, 6 findings)

**Goal:** Fix low-impact ingest, capture and review flow defects (headers, binding hashes, reindex races, file-name screening).

- AUD-060 (P3) renderIngest prints 'Ingested 0 captures verbatim, with no agent' when only unreadable captures exist
- AUD-061 (P3) enumerateClaudeMemory silently drops non-file, non-symlink .md entries instead of a skipped row
- AUD-062 (P3) Any reindex during an ingest agent call refuses the capture as a hand edit
- AUD-063 (P3) brain-enhance binds the note hash at capture time, not at the bytes the agent read
- AUD-064 (P3) Garden binds the related-note hash from UTF-8-decoded text while capture hashes raw bytes
- AUD-065 (P3) review's unreadable-capture warning embeds the raw file name; the NEW-38 renderPath fix covered ingest only

### S07 (P3, 7 findings)

**Goal:** Tidy low-severity hook and vendor security edges (argv prompts, truncate-before-redact, runner hang, NotebookEdit, quoting, Codex sandbox, edit containment).

- AUD-027 (P3) Model prompts travel in argv, readable by every local account via ps for up to 120 s
- AUD-028 (P3) SessionStart inject truncates vault text before redacting it
- AUD-029 (P3) NodeProcessRunner waits on 'close' with no deadline after its timeout kill (unfixed sibling of W2-SEC-UPD-3)
- AUD-030 (P3) guard path and guard edit read only tool_input.file_path, so Claude NotebookEdit is not covered
- AUD-031 (P3) brain-compile and brain-enhance splice an untrusted path into single quotes without the quote guard brain-garden has
- AUD-032 (P3) Codex agent roles drop the read-only intent the Claude agents declare, though sandbox_mode is an observed accepted key
- AUD-033 (P3) guard edit compares a non-canonical edited path with the canonical project root

### S08 (P3, 6 findings)

**Goal:** Make doctor and entry diagnostics truthful and cheaper (Codex discovery, corrupt config, project-check, error kinds, discovery reuse, reporter duplication).

- AUD-066 (P3) codex-registration reports a failed Codex discovery as 'codex CLI absent'
- AUD-067 (P3) A corrupt config makes doctor's codex-registration pass with 'codex is not selected'
- AUD-068 (P3) project-check treats every lstat error as 'absent' and then reports the secret scan clean
- AUD-069 (P3) contextFailure labels every context-build error invalid_input even for exit 4, 5 or 6
- AUD-090 (P3) doctor re-discovers both agents four times per run
- AUD-095 (P3) Capability reporters duplicate firing-key logic and carry a constant captureVia field

### S09 (P3, 6 findings)

**Goal:** Clean up CLI command edge cases (git push_pending visibility, slugs, refactor error mapping, unused sync mode).

- AUD-051 (P3) A failed scheduled git push writes no status/log record and silences the other scheduled jobs
- AUD-052 (P3) slugify splits words at combining marks, breaking Indic, Thai and similar scripts
- AUD-053 (P3) slugify can end the slug on a lone surrogate (acknowledged in a comment, not tracked)
- AUD-054 (P3) Every executor plan error in refactor is reported as 'a note changed after it was read' (exit 3)
- AUD-055 (P3) Post-apply reindex in refactor erases the security class of an index escape
- AUD-056 (P3) GitService.sync accepts a mode parameter it never reads

### S10 (P3, 6 findings)

**Goal:** Correct update/bootstrap/uninstall residual messaging and latent rollback limits.

- AUD-034 (P3) Manifest-anchor messages promise self-healing no writer performs; git/automation re-anchor only in-process after settle()
- AUD-035 (P3) An update that touches an empty managed file can never be rolled back
- AUD-036 (P3) Every update reads and secret-screens the whole Brain and all vendor file bytes for a keep-all planner that reads none of it
- AUD-057 (P3) A resumed bootstrap rollback rethrows a misleading 'no terminal state' error
- AUD-058 (P3) A resumed uninstall reports only emptied directories as removed
- AUD-059 (P3) Package-channel admission converts every thrown error, including JS defects, into exit 6

### S11 (P3, 7 findings)

**Goal:** Tighten core journal and plan validators to match their siblings.

- AUD-044 (P3) Grammar and codec do not bound compactionNext by the derived compaction entries
- AUD-045 (P3) The plan codec enforces previewHash only in one direction
- AUD-046 (P3) Construction journal lacks the phase guards and rolled_back write-state clearing NEW-181 added to the sibling journals
- AUD-047 (P3) Bundle publication validator accepts a stray metadataWriteState in planned, root_publishing and entries_publishing
- AUD-048 (P3) Owner journal `compacting` arm is unconstrained, unlike the migration journal fixed in fb4f87d3
- AUD-049 (P3) selectBootstrapEvidenceJournal ignores which slot file held each record, unlike selectBootstrapJournal
- AUD-050 (P3) Allocator lock guard checks only the path, not the lock identity

### S12 (P3, 7 findings)

**Goal:** Fix low-severity core transaction, config, git and lock error handling.

- AUD-037 (P3) A create into a missing parent directory passes planning, then wedges: apply throws raw ENOENT and neither resume nor rollback finish
- AUD-038 (P3) A lock-release failure after a completed transaction throws out of execute, which callers read as 'nothing happened'
- AUD-039 (P3) validateGitScopeSnapshot admits more than 256 topic aliases, which the persisted gitScopeSchema rejects
- AUD-040 (P3) The CLI's second git config reader diverges from core's parseGitConfig and skips the reflog identity grammar
- AUD-041 (P3) V1 detectDrift lets raw guard errors escape while sibling paths wrap them in ManifestStateError
- AUD-042 (P3) Stable lock maps spawn and fs failures to LifecycleLockShapeError (security) or LifecycleLockMissingError
- AUD-043 (P3) Store header says the codec validates plans at publish, but publish only encodes

### S13 (P3, 6 findings)

**Goal:** De-duplicate core lifecycle constants and helpers.

- AUD-096 (P3) ledger.ts and foundation-ledger.ts duplicate guard helpers and size constants
- AUD-097 (P3) Allocator/nonce leaf names and byte limits are repeated across core lifecycle modules
- AUD-098 (P3) Planless staging child list is defined in both recovery and the ledger
- AUD-099 (P3) Executor-record size literal still repeated in ledger-v2 after CLI-UPD-3 repointed the other sites
- AUD-100 (P3) Strict-object helpers re-declared in git/ and diverged from update/scalars exact
- AUD-128 (P3) Redundant canonical re-encode after decodeCanonicalJson in ledger-v2

### S14 (P3, 6 findings)

**Goal:** De-duplicate core update/manifest constants and finish the incomplete consolidation fixes.

- AUD-101 (P3) core update coordinator keeps private copies of bounds and sha256Hex that construction.ts exports
- AUD-102 (P3) bundle-participant validateTarget re-implements validateReleaseIdentity with weaker path admission (W2-BUNDLE-2 residue)
- AUD-103 (P3) v2.ts keeps a private UTF-8 comparator and the 64 MiB manifest cap is defined three times
- AUD-104 (P3) bootstrap-closure.ts re-declares plan-bound constants bootstrap.ts owns
- AUD-105 (P3) W2-COMPOSE-3 fix incomplete: bootstrap executor still hand-rolls the foundation-bindings hash
- AUD-106 (P3) Launcher re-implements assertTrustedDirectoryEntry behind a stale 'switch at integration' note

### S15 (P3, 6 findings)

**Goal:** De-duplicate CLI and adapter helpers and make death-point lists exhaustive.

- AUD-070 (P3) Codex instruction renderer re-validates none of what the Claude twin re-validates
- AUD-091 (P3) sha256, parent-path and timestamp helpers are still copied across the update directory (CLI-UPD-2 / W2-PORTS-6 residue)
- AUD-092 (P3) Quarantine helpers are copied across review, ingest, capture, project-init and import
- AUD-093 (P3) Injection byte cap is defined twice (inject.ts and outcome.ts)
- AUD-094 (P3) ClaudeRenderer and CodexRenderer are line-for-line copies
- AUD-107 (P3) Recovery-sweep death-point arrays are test-only exports with no exhaustiveness guard

### S16 (P3, 6 findings)

**Goal:** Remove CLI dead exports and leftovers.

- AUD-108 (P3) CLI production modules export helpers only tests use, and one error class nothing throws
- AUD-109 (P3) V1 uninstall helpers exported with zero external references
- AUD-110 (P3) Unused exports and unreachable dispatch branches in the CLI entry layer
- AUD-111 (P3) HookRuntime.now is populated by the hook entry but read by no guard
- AUD-112 (P3) SYNTHETIC_TEMP is completely unreferenced
- AUD-113 (P3) Launcher tsconfig still references the security package it no longer depends on

### S17 (P3, 7 findings)

**Goal:** Trim the core barrel and remove core dead code (founder sign-off on export policy).

- AUD-114 (P3) Core barrel exports validators and constants only tests use
- AUD-115 (P3) Core barrel re-exports ~40 values and ~80 types that nothing outside core imports
- AUD-116 (P3) LifecycleExecutionPlanV2 type is exported on both barrels with zero consumers
- AUD-117 (P3) causeOf and effectRefOf are exported from the lifecycle coordinator but used only in that file
- AUD-118 (P3) GIT_SYNC_CARDINALITY carries three limits nothing reads; one duplicates GIT_TREE_FINGERPRINT_MAX_ENTRIES
- AUD-119 (P3) formatJsonResult is exported public API with no production caller
- AUD-120 (P3) Instruction catalog's legacyName is validated and shipped but never read in production

### S18 (P3, 7 findings)

**Goal:** Decide and remove dormant subsystems and unused interface members (owner planner, scratch store, overlays, platform barrel, adapter test-only API).

- AUD-121 (P3) planOwners and rehydrateOwnerCreates are unreachable in production after the keep-all planner
- AUD-122 (P3) ReleasePlanningScratchStore/Attempt (~1,180 lines) have no production consumer since df72f4cb
- AUD-123 (P3) About 35 value exports in the platform-macos barrel have no consumer outside the package
- AUD-124 (P3) Adapter packages export test-only helpers through their barrels
- AUD-125 (P3) Overlay machinery has no production caller
- AUD-126 (P3) ManifestFileSystem.chmod/readFile and DriftFileSystem.readFile are never called
- AUD-127 (P3) TransactionFileSystem.link and .utimes are required members nothing calls

### S19 (P3, 7 findings)

**Goal:** Fix architecture and install docs drift (hooks.md, codex-adapter.md, knowledge-pipeline.md, install guide).

- AUD-075 (P3) Install guide requires a manual init after update, but update --apply and rollback --apply already run it
- AUD-076 (P3) hooks.md still describes the hook Node as stableNodePath with init as the only dead-executable recovery
- AUD-077 (P3) hooks.md describes guard stop as plain `tsc --noEmit` blocking on any non-zero exit
- AUD-078 (P3) codex-adapter.md lists snake_case Codex hook events and says no session-end event exists
- AUD-079 (P3) Several notes still call the capability model three-valued; CAPABILITY_STATES has four values including `no`
- AUD-080 (P3) knowledge-pipeline §2 says the not-used list is four keys; both adapters hold three
- AUD-081 (P3) knowledge-pipeline §1 version snapshot is already wrong for review, brain-search and doctor

### S20 (P3, 7 findings)

**Goal:** Fix remaining docs, schema and test-infrastructure gaps (NEW-205 scope, shard partition guard, flaky timeout test, $input validation, merge embeds).

- AUD-071 (P3) Hooks are written into the Codex tree for every supported version, though only observed from 0.155.1 (floor 0.147.0)
- AUD-072 (P3) validateWorkflow does not check `$input.<name>` references against declared inputs
- AUD-073 (P3) brain refactor --merge turns an embed of the source or target into a stray '!label'
- AUD-074 (P3) NEW-205 premise is wrong: doctor already reports a missing or mismatched bundle manifest as drift
- AUD-082 (P3) foundation.md's doctor emission-order list omits codex-home-record and misplaces lifecycle
- AUD-083 (P3) Lifecycle shard docs and budget are stale (rest runs 13 files, not 11) and nothing guards the partition
- AUD-084 (P3) Refresh-timeout test depends on a 500 ms child start and a wall-clock bound
