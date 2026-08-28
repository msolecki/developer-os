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
| A11 · DOS-P7 | Spec 2, approval, plan 2, manifest/new-init handoff, Spec 1 implementation, remaining Spec 2 implementation | current |
| A12 · DOS-P10 | spec, plan, implementation for 38 instruction artifacts | A11 |
| A13 · DOS-P11 | spec, plan, implementation for 11 non-capture hooks | A12 |
| A14 · DOS-P12 | spec, plan, implementation for nine tooling scripts | A13 |
| A15 · DOS-P8 | dedicated cutover plan and founder shadow migration | A14, L2 |
| A16 · DOS-P9 | plan decision, beta, packaging, documentation, v1 publication | A15, L1, L2 |

## 1. Open repository rows

There are 24 numbered rows. They are not automatically ordered ahead of A11.

| ID | Owner / blocker | Work required to close |
|---|---|---|
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

- [ ] Write and approve Spec 2: signed/checksummed release metadata, dry-run updates,
  managed-artifact upgrades, schema-migration staging, and rollback.
- [ ] Write Spec 2's implementation plan.
- [ ] Implement `ManagedArtifactV2`, `InstallationManifestV2`, `ManifestStatePlanV1`, existing-install
  migration, and the V2 new-init handoff.
- [ ] Execute `plans/2026-08-28-developer-os-opt-in-surfaces.md` only after that handoff lands.
- [ ] Finish remaining update/release work and close the full Task 7 checkpoint.

Required behavior:

- Git and automation are disabled and effect-free by default.
- Preview is deterministic and byte-inert; apply revalidates a bound preview before allocation.
- Git, launchd, update, uninstall, recovery, and terminal compaction follow active Spec 1.
- Update refuses drift. Uninstall removes manifest-owned artifacts plus the exact redaction-key path
  while preserving the Brain and unrelated agent configuration.

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
