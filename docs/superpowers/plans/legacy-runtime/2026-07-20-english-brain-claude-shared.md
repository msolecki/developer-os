# English migration and architecture audit: brain + claude-shared

> **Status: COMPLETED 2026-07-20. Retained as a record only — no open work.**
>
> **Relocated 2026-07-27** from `~/claude-shared/docs/superpowers/plans/`. It targets the
> founder's legacy runtime (`~/brain`, `~/claude-shared`), not the Developer OS product.
> `docs/superpowers/plans/legacy-runtime/` is a publication-excluded path; nothing here
> may be copied into a public artifact. Index: `docs/superpowers/BACKLOG.md`.
>
> Caveat carried forward: the work described here was implemented and validated but was
> never committed. Its durability is tracked as `LEGACY-3` in the backlog.

## Goal

Make English the single language for maintained system content in `~/brain` and
`~/claude-shared`, verify how both repositories actually interact, remove known
configuration drift, and leave deterministic checks that prevent regression.

Compatibility constraint: established command names, skill names, repository slugs,
and project names remain stable even when their names are Polish. Human-readable
descriptions, prompts, documentation, comments, logs, note bodies, metadata, generated
reports, and archived source summaries move to English.

The repositories must remain usable after every step. Existing user changes in both
working trees are preserved and are not silently committed.

## Current evidence

- Baseline `python3 tests/run_tests.py` passes in `~/brain`.
- Baseline `bash evals/hooks/run.sh`, `bash -n ...`, and
  `bash automation/check-plugin-version.sh` pass in `~/claude-shared`.
- `~/brain` has pre-existing changes in `content/.obsidian/graph.json` and untracked
  inbox files.
- `~/claude-shared` has pre-existing Codex-parity and plugin 1.6.0 changes.
- `templates/settings-global.json` differs from live `~/.claude/settings.json`:
  the template contains `md-file-guard`, while live config contains `founder-os`.
- Claude plugin manifests are 1.6.0; the Codex manifest is
  `1.6.0+codex.20260720141815`; README still says 1.5.0.
- Official Codex hook documentation confirms the current `Bash`, `apply_patch`,
  `Edit|Write`, and exit-code-2 contracts. It also states that transcript format is
  not stable, so Claude-specific JSONL parsing cannot be presented as Codex capture.

## Step 1 — Define and enforce the English contract (M)

**Status:** Completed.

**What:** English becomes the explicit default for both repositories and generated
artifacts. Add a deterministic, dependency-free language regression check.

**Where:** `~/claude-shared/rules/`, `knowledge/`, generator and validation scripts;
`~/brain/AGENTS.md`, `README.md`, `content/WRITING_STYLE.md`, and test entry points.

**How:** Translate the canonical rule fragments first, regenerate global `AGENTS.md`,
then add a scanner for Polish diacritics and high-confidence Polish prose markers.
Keep public identifiers stable and allow only documented proper-name exceptions.

**Test:** scanner fails on a Polish fixture and passes on both migrated repositories;
generator is idempotent; existing baseline suites stay green.

**Invariant:** Claude Code and Codex can still load their global instructions.

## Step 2 — Migrate claude-shared runtime and documentation (L)

**Status:** Completed.

**What:** Translate first-party prompts, comments, user-visible messages, templates,
docs, eval fixtures, plugin commands/skills/agents, and registry content. Correct
verified architecture drift and stale documentation while preserving current edits.

**Where:** all first-party text under `~/claude-shared`, excluding already-English
vendored React guidance and immutable Git history.

**How:** Work from canonical/runtime surfaces outward: rules → hooks/automation →
templates → plugin → docs/evals. Do not rename public slash commands or skill IDs.
Extend version consistency checks to the Codex manifest base version. Document the
Codex capture gap instead of claiming parity that does not exist.

**Test:** hook evals, `bash -n`, Python tests/compile checks, JSON/YAML parsing,
plugin-version check, English-language check, and a clean generated-AGENTS diff.

**Invariant:** blocking hooks retain their exit-code and stderr contracts.

## Step 3 — Migrate brain instructions, knowledge, and archives (L)

**Status:** Completed. Redundant tracked Polish session captures were replaced by
English archive records that point to canonical notes; the originals remain in Git history.

**What:** Translate all maintained vault text, including canonical notes, indexes,
reports, proposals, templates, graveyard items, raw processed summaries, and the
current inbox. Remove superseded proposal noise while retaining unresolved security
and project-action proposals in English.

**Where:** `~/brain/AGENTS.md`, `.claude/`, `content/`, tests, README, and audit fixtures.

**How:** Translate note bodies and metadata without changing technical facts or source
links. Then rebuild indexes deterministically so catalog summaries and graph entries
derive from the translated notes. Preserve repository/project slugs used by injection.

**Test:** `python3 tests/run_tests.py`, reindex, lint, wikilink integrity, frontmatter
parse, English-language check, and no unexpected file loss in `git status`.

**Invariant:** index-first navigation and source traceability remain intact.

## Step 4 — Correct reliability bugs and document development path (M)

**Status:** Completed. The automation harness covers success, failure stages, commit
behavior, active/stale/live-PID/raced locks, safe project-review selection, and user-change
preflight. Distillation is atomic and collision-free. Configuration drift is read-only.

**What:** Fix only verified, in-scope reliability defects and write a prioritized
development roadmap.

**Where:** weekly pipeline, bootstrap/config drift checks, plugin/version validation,
architecture docs, and this plan.

**How:** Make weekly success conditional on critical stages and push success; prevent
broad staging of unrelated working-tree files; detect template/live drift without
silently overwriting live user config; keep Codex capture as an explicit future item
until a stable ingestion contract exists.

**Test:** failure-path fixtures prove that failed ingest/reindex/push cannot create the
success sentinel; drift checker reports the known live/template delta; normal hook and
brain suites remain green.

**Invariant:** automation does not send outbound messages or mutate external systems
beyond its existing explicitly-invoked Git sync behavior.

## Step 5 — Independent review and final verification (M)

**Status:** Completed. A fresh-context reviewer identified staging, lock-race,
review-isolation, repository-selection, language-exemption, and config-command
normalization defects. Each finding was corrected and covered by a local regression
test before the final matrix ran.

**What:** A fresh subagent reviews the final diff without inheriting implementation
assumptions; all findings are triaged and verified locally.

**Where:** both repository diffs and validation output.

**How:** Provide only objective, paths, constraints, and required P0–P3 output. Compare
working tree against the pre-existing dirty state before accepting the review.

**Test:** final test matrix passes; language scan has zero unexplained findings;
`git diff --check` passes; status contains no accidental files.

**Invariant:** no commit is made unless repository-specific lint and test requirements
are genuinely satisfied and unrelated user changes can be excluded safely.

## Next action

Implementation and verification are complete. Do not apply the reported live/template
configuration drift automatically; resolve it only through an explicit user decision.

## Final evidence — 2026-07-20

- Brain suite: all tests pass, including source-archive target resolution.
- Brain index: `notes=25`, `edges=67`, `incoming_targets=20`, `tags=66`, `dated=25`;
  no dead links.
- Claude hook suite: `PASS=39`, `FAIL=0`.
- Weekly automation: 15 success, failure, staging, selection, isolation, and lock cases pass.
- Distillation automation: 5 atomic-write, cursor, hash, and collision cases pass.
- Config drift: 2 tests pass; the read-only live run reports four structural finding lines.
- Language guard: 4 unit tests pass; the full scan of both repositories reports `OK`.
- Plugin manifests: base version `1.6.0` is consistent across Claude, marketplace,
  and Codex build `1.6.0+codex.20260720141815`.
- All 19 plugin skill packages validate; shell syntax, Python compilation, JSON parsing,
  generated-AGENTS idempotence, and both `git diff --check` runs pass.
- No live Claude/Codex configuration was overwritten and no commit was created in the
  pre-existing dirty working trees.
