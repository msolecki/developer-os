# Brain and claude-shared follow-up execution plan

> **Status: OPEN — 0 of 14 steps done. Steps 0–3 are P0.**
>
> **Relocated 2026-07-27** from `~/claude-shared/docs/superpowers/plans/`. It targets the
> founder's legacy runtime (`~/brain`, `~/claude-shared`), not the Developer OS product,
> and executes against those checkouts even though it is tracked here.
> `docs/superpowers/plans/legacy-runtime/` is a publication-excluded path; Task 0 of the
> program plan must name it in `docs/migration/exclusion-policy.md`, and nothing here may
> be copied into a public artifact. Index: `docs/superpowers/BACKLOG.md`.
>
> The program plan consumes this document as a canonical input (Task 0). Developer OS
> Tasks 2, 5, 6 and 7 reimplement Steps 5–12 as product features; the steps below remain
> the obligation for the machine the founder is running *today*.

## Objective

Close the operational and security work that remains after the 2026-07-20 English
migration and architecture audit. The order below is intentional: protect recoverability,
rotate potentially exposed credentials, land the existing migration safely, then improve
automation, capture, validation, retrieval, and portability.

This plan is the canonical continuation document. Update the status and evidence after
every completed step. Do not start lower-priority development while a P0 item remains
unowned.

## Current state

- The English migration and reliability audit are implemented but not committed.
- `~/claude-shared` currently has 136 changed/untracked status entries; `~/brain` has
  169. These include the migration, pre-existing user work, generated files, deleted
  historical reports, and untracked inbox material. The counts are evidence of scope,
  not proof that every entry belongs in one commit.
- All current validation suites pass: Brain tests, 39 hook cases, 15 weekly-pipeline
  cases, 5 distillation cases, configuration-drift tests, language tests, skill
  validation, syntax/compile checks, and `git diff --check`.
- Two proposals remain open:
  `content/_outputs/proposals/2026-07-19-historical-secret-triage.md` and
  `content/_outputs/proposals/config-drift.md`.
- The Brain graph has no dead links, but the garden scan still reports five notes with
  no incoming links, four notes with no outgoing links, and two duplicate candidates.
- Claude Code has learning capture; Codex has injection and protection hooks but no
  equivalent stable end-of-session capture contract.

## Decision and ownership rules

- **Founder-only:** credential rotation, provider-log review, accepting a live config
  target, approving history rewrites, and deciding whether unrelated local changes may
  be included in a commit.
- **Agent-owned:** repository analysis, patches, local tests, reports, migration scripts,
  and draft commands/checklists.
- **Explicit approval required:** live `~/.claude` or `~/.codex` changes, history
  rewrites, deletion of recovery data outside Git, external provider changes, commits,
  and pushes.
- **Never expose values:** secret remediation records contain repository, path, commit,
  provider, status, and rotation evidence, but never the credential itself.

## Execution order

| Order | Priority | Step | Owner | Complexity | Status |
|---:|:---:|---|---|:---:|---|
| 0 | P0 | Preserve and classify both working trees | Agent + Founder | M | Pending |
| 1 | P0 | Rotate historical credential candidates | Founder | M | Pending |
| 2 | P0 | Resolve the non-npm commit-gate contradiction | Agent + Founder | S | Pending |
| 3 | P0 | Review and land the English migration | Agent + Founder | L | Blocked by 0–2 |
| 4 | P1 | Resolve live/template configuration drift | Agent + Founder | M | Pending |
| 5 | P1 | Replace false-green Brain validation | Agent | M | Pending |
| 6 | P1 | Test weekly automation against real Git | Agent | L | Pending |
| 7 | P1 | Close scanner coverage gaps | Agent | M | Pending |
| 8 | P1 | Add stable Codex learning capture | Agent | L | Pending |
| 9 | P2 | Enforce the Brain schema and graph policy | Agent | M | Pending |
| 10 | P2 | Measure retrieval quality | Agent | M | Pending |
| 11 | P2 | Add a unified read-only doctor | Agent | L | Pending |
| 12 | P2 | Add proposal lifecycle and observability | Agent | M | Pending |
| 13 | P3 | Curate content and archive provenance | Agent + Founder | M | Pending |

---

## Step 0 — Preserve and classify both working trees

- **Priority:** P0
- **Owner:** Agent prepares; Founder approves inclusion boundaries.
- **Complexity:** M
- **Status:** Pending.

**What:** Create a recoverable baseline and classify every changed path as migration,
pre-existing user work, generated output, deliberate deletion, or unresolved.

**Where:** `~/brain`, `~/claude-shared`, and a timestamped backup directory outside
both repositories.

**How:**

1. Save `git status`, `git diff`, `git diff --cached`, and untracked-path inventories
   for both repositories without copying denied secret files.
2. Preserve the pre-existing `content/.obsidian/graph.json` change and inbox files as
   user-owned unless explicitly reclassified.
3. Review deleted reports, old plans, audit JSON, renamed source metadata files, and
   the 101 compacted source archives by category.
4. Produce two explicit path manifests: `include` and `exclude`. Never use `git add -A`.
5. Record which paths existed before this audit where that can still be established.

**Test:** Backups are readable; applying each patch to a temporary clone succeeds;
`git status` after the backup is byte-for-byte unchanged; every current status entry
appears in exactly one classification.

**Invariant:** No cleanup, reset, checkout, commit, or deletion occurs during this step.

## Step 1 — Rotate historical credential candidates

- **Priority:** P0
- **Owner:** Founder; agent provides a redacted checklist only.
- **Complexity:** M
- **Status:** Pending.

**What:** Treat four historical findings as active until the provider proves otherwise:
the Taxos AWS key, KM Energy Monitoring AWS key, the shared VAV/Vavita Zindigi AWS
key, and historical authentication/email credentials in Przedsiebiorcze Trojmiasto.

**Where:** Provider consoles and the repositories/commits named in
`~/brain/content/_outputs/proposals/2026-07-19-historical-secret-triage.md`.

**How:**

1. Revoke or rotate the credentials before considering a Git history rewrite.
2. Review relevant provider audit logs from the first known exposure through rotation.
3. Scope replacement credentials to the minimum required permissions.
4. Verify state files, memory files, and environment files are ignored and blocked by
   repository hooks.
5. Record rotation date, provider confirmation, affected deployments, and incident
   verdict without recording values.
6. Decide history rewrite separately. A rewrite is destructive coordination work and
   does not replace rotation.

**Test:** Old credentials fail provider authentication; new credentials pass the
smallest application smoke test; provider logs are reviewed; `FULL_SCAN=1` produces a
triageable report; the completion checklist in the proposal is fully checked.

**Invariant:** No secret value enters Brain, logs, prompts, patches, or chat output.

## Step 2 — Resolve the non-npm commit-gate contradiction

- **Priority:** P0
- **Owner:** Agent proposes; Founder accepts the policy.
- **Complexity:** S
- **Status:** Pending.

**What:** Correct the global rule that forbids every commit without
`npm run lint && npm test`. Neither Brain nor claude-shared is an npm project, so the
literal rule makes a compliant agent commit impossible.

**Where:** `~/claude-shared/rules/security.md`, generated `AGENTS.md`, and repository
validation documentation.

**How:** Replace the npm-specific absolute with a fail-closed validation contract:
run the repository-declared validation command; when `package.json` exposes lint/test
scripts, run them; when it does not, run the documented repository-specific suite.
Missing validation metadata remains a commit blocker.

Recommended commands for these repositories:

- Brain: `python3 tests/run_tests.py`, deterministic reindex/lint, English scan, and
  `git diff --check`.
- claude-shared: hook suite, weekly/distillation/config/language tests, plugin version
  check, shell syntax, Python compile, skill validation, generated-AGENTS check, and
  `git diff --check`.

**Test:** A fixture npm repository still requires both npm commands; a fixture non-npm
repository requires its declared validation suite; a repository with no declared gate
is refused; generated `AGENTS.md` is idempotent.

**Invariant:** The change generalizes validation; it must not weaken npm projects.

## Step 3 — Review and land the English migration

- **Priority:** P0
- **Owner:** Agent prepares commits; Founder approves semantic/deletion boundaries.
- **Complexity:** L
- **Status:** Blocked by Steps 0–2.

**What:** Convert the large dirty state into reviewable, recoverable repository
checkpoints without absorbing unrelated work.

**Where:** `~/claude-shared` and `~/brain`.

**How:**

1. Review all security-sensitive hook and automation diffs separately from prose-only
   translation changes.
2. Sample at least one compacted source archive per project plus every archive linked
   to a security finding. Confirm the canonical target retains the durable lesson.
3. Review every deliberate deletion category and confirm Git is an acceptable recovery
   layer. If secret-history rewriting is approved, do not promise that raw captures
   remain recoverable from rewritten history.
4. Stage only paths from the approved manifest.
5. Run the complete validation matrix on the exact staged tree.
6. Create separate repository commits; do not mix Brain and claude-shared state.
7. Push only after explicit approval and a clean remote-divergence check.

**Test:** Staged diff matches the manifest; excluded paths remain unstaged and unchanged;
all validation commands pass against the staged content; a fresh clone can load Claude
instructions, Codex instructions, plugin metadata, Brain indexes, and source links.

**Invariant:** Each repository is usable after its commit; no partial cross-repository
contract is pushed without a documented compatibility order.

**Baseline to reproduce before staging.** The English migration plan that produced this
dirty tree was completed and independently reviewed on 2026-07-20, then removed from this
repository as executed work (recoverable from commit `28a0ddc`). Its final evidence is the
regression baseline for this step — the staged tree must still produce all of it:

- Brain suite passes, including source-archive target resolution.
- Brain index: `notes=25`, `edges=67`, `incoming_targets=20`, `tags=66`, `dated=25`, no dead links.
- Claude hook suite: `PASS=39`, `FAIL=0`.
- Weekly automation: 15 cases; distillation: 5 cases; config drift: 2 tests.
- Language guard: 4 unit tests, and a full scan of both repositories reporting `OK`.
- Plugin manifests: base version `1.6.0` consistent across Claude, marketplace, and the
  Codex build.
- All 19 plugin skill packages validate; shell syntax, Python compilation, JSON parsing,
  generated-`AGENTS.md` idempotence, and both `git diff --check` runs pass.

Two constraints carried from that plan: the reported live/template configuration drift is
never applied automatically (it is Step 4's decision), and no live Claude or Codex
configuration was overwritten while producing this baseline.

## Step 4 — Resolve live/template configuration drift

- **Priority:** P1
- **Owner:** Founder chooses target; agent applies only after approval.
- **Complexity:** M
- **Status:** Pending.

**What:** Resolve the current Claude drift at `enabledPlugins`,
`extraKnownMarketplaces`, `PreToolUse`, and `Stop` while preserving intentional
machine-local configuration.

**Where:** `templates/settings-global.json`, live `~/.claude/settings.json`, and the
configuration drift checker/report.

**How:**

1. Classify `founder-os` as either canonical global configuration or an explicit
   machine-local overlay.
2. Recommended default: enable the safety-oriented `md-file-guard` live, preserve
   `founder-os`, and represent intentional personal differences through a documented
   overlay/allowlist rather than permanent unexplained drift.
3. Compare the full normalized `Stop` hook definitions locally; the current report
   exposes the changed path but not the semantic reason.
4. Back up live files, apply the smallest approved change, and rerun all hook tests.
5. Make the drift report include generation time, status, and expected-drift policy.

**Test:** JSON parses; hook order and identities match the approved target; 39 hook
cases pass; configuration doctor is clean or reports only documented allowlisted drift;
Claude Code starts successfully.

**Invariant:** Templates never overwrite live configuration silently.

## Step 5 — Replace false-green Brain validation

- **Priority:** P1
- **Owner:** Agent.
- **Complexity:** M
- **Status:** Pending.

**What:** Ensure a weekly success means deterministic Brain integrity passed, not only
that a model command returned exit code zero.

**Where:** `automation/brain-weekly.sh`, Brain lint scripts, and automation tests.

**How:**

1. Run `python3 tests/run_tests.py` and the English guard before staging.
2. Give deterministic frontmatter/link/index checks nonzero failure exits.
3. Keep model-assisted `/lint` as an advisory report after deterministic checks, not as
   the sole blocking validator.
4. Separate pipeline execution health from advisory findings. A secret/template
   proposal may be open even when execution succeeded.
5. Move the permission audit before commit/push, or classify it as explicitly
   post-push so a failure cannot make a completed push look like a pre-push failure.

**Test:** Fixtures with broken frontmatter, links, English contract, and indexes abort
before staging; advisory findings create proposals without falsely marking execution as
failed; no health sentinel is written after a blocking failure.

**Invariant:** Validation that guards a persisted record runs under the same branch and
conditions that create that record.

## Step 6 — Test weekly automation against real Git

- **Priority:** P1
- **Owner:** Agent.
- **Complexity:** L
- **Status:** Pending.

**What:** Replace the remaining confidence gap from the stubbed Git harness with a real
temporary repository and bare remote.

**Where:** `evals/automation/`, `automation/brain-weekly.sh`, and temporary directories.

**How:** Add integration cases for:

1. unrelated root and `.obsidian` changes remaining unstaged;
2. inbox paths containing spaces;
3. successful pull/rebase/autostash restoration;
4. pull conflict with user work preserved and no staged generated files;
5. a user edit that starts after preflight but before staging;
6. commit success followed by push failure, with no success sentinel;
7. malformed owner files, PID reuse, and lock owner changes during takeover;
8. review output written temp-first, validated, then atomically renamed;
9. more than five active repositories without permanent review starvation.

Prefer a dedicated automation worktree if the post-preflight race cannot be closed
reliably in the user's active Brain checkout.

**Test:** Every case asserts working-tree bytes, index contents, local commit graph,
remote graph, lock state, stash state, proposals, and sentinel state.

**Invariant:** Tests never touch the real Brain repository, live remote, or credentials.

## Step 7 — Close scanner coverage gaps

- **Priority:** P1
- **Owner:** Agent.
- **Complexity:** M
- **Status:** Pending.

**What:** Make repository scanners cover worktrees and report incomplete evidence
instead of silently skipping it.

**Where:** `automation/git-history-secrets.sh`, `automation/check-templates.sh`, shared
repository discovery helpers, and their tests.

**How:**

1. Replace `.git` directory checks with `git rev-parse --is-inside-work-tree` so Git
   worktrees whose `.git` is a file are included.
2. Centralize repository discovery instead of implementing different rules in weekly
   review, secret scan, and template hygiene.
3. Report truncated secret results explicitly; the current `head -20` can hide the
   number of unresolved candidates.
4. Record scan scope, repository count, skipped repositories, and reason.
5. Test macOS and Linux command fallbacks where both are claimed.

**Test:** Normal repositories, linked worktrees, symlinked roots, inactive repositories,
malformed repositories, and more than twenty findings are represented accurately.

**Invariant:** Scanner output stays redacted and never includes complete matches.

## Step 8 — Add stable Codex learning capture

- **Priority:** P1
- **Owner:** Agent.
- **Complexity:** L
- **Status:** Pending.

**What:** Feed Codex learnings into the same Brain inbox contract without parsing
unstable transcript internals or claiming false Claude parity.

**Where:** Codex hooks/plugin surfaces, shared redactor, Brain inbox schema,
distillation scripts, and capture tests.

**How:**

1. Prefer an explicit end-of-task summary or a documented stable hook/export payload.
2. Store `source_agent`, source session identity when available, project slug,
   capture method, timestamp, and content hash.
3. Redact before truncation, model processing, logging, and disk writes.
4. Deduplicate Claude/Codex captures by normalized content hash and source relationship.
5. Use atomic writes plus retry-safe cursor semantics.
6. Document capability differences if Codex still cannot guarantee session-end capture.

**Test:** Secret fixtures never reach model input or files; duplicate captures collapse;
failed writes do not advance state; Claude and Codex records ingest into equivalent
canonical notes; unsupported Codex versions fail visibly rather than silently.

**Invariant:** No undocumented transcript format becomes a dependency.

## Step 9 — Enforce the Brain schema and graph policy

- **Priority:** P2
- **Owner:** Agent.
- **Complexity:** M
- **Status:** Pending.

**What:** Define required metadata per record type and decide which graph warnings are
errors, accepted terminal notes, or curation tasks.

**Where:** Brain lint/reindex scripts, tests, note templates, and an explicit garden
allowlist or status field.

**How:**

1. Validate `type`, `date`, `tags`, `source`, `stage`, `confidence`, and generated-by
   fields according to note type.
2. Reject unresolved canonical/source links and generated index references.
3. Resolve or classify the five orphan notes and four blind notes. Frozen/inactive
   project notes may be explicitly terminal; active notes should link to knowledge.
4. Persist duplicate-candidate decisions so known false positives do not reappear.
5. Distinguish fatal schema errors from advisory graph quality.

**Test:** Invalid fixtures fail with path and field; valid terminal notes pass; generated
indexes are deterministic; the current 25-note vault has zero unexplained fatal issues.

**Invariant:** Generated indexes never become the canonical source of metadata.

## Step 10 — Measure retrieval quality

- **Priority:** P2
- **Owner:** Agent.
- **Complexity:** M
- **Status:** Pending.

**What:** Prove whether index-first retrieval is sufficient before adding semantic
search or another knowledge store.

**Where:** A versioned Brain retrieval benchmark, expected-answer fixtures, and a
read-only evaluation script.

**How:**

1. Create recurring cross-project questions covering auth/RBAC, deployment, CI hooks,
   money-path validation, frontend tests, and project-specific decisions.
2. Record expected notes, required evidence, freshness constraints, and abstention cases.
3. Measure recall@k, precision@k, stale-answer rate, unsupported-claim rate, and lookup
   cost for vault-map → catalog → note.
4. Trial semantic retrieval only if it produces a measured improvement without reducing
   citation accuracy or exposing raw archives.

**Test:** Baseline results are deterministic; every returned claim resolves to a note;
stale and no-answer cases are scored; any retrieval change must beat the recorded
baseline on predefined thresholds.

**Invariant:** Raw session archives are not indexed as a second source of truth.

## Step 11 — Add a unified read-only doctor

- **Priority:** P2
- **Owner:** Agent.
- **Complexity:** L
- **Status:** Pending.

**What:** Provide one command that explains machine readiness without mutating it.

**Where:** `~/claude-shared/automation/doctor.py` or equivalent, bootstrap docs, and
doctor tests.

**How:** Check generated `AGENTS.md`, symlinks/imports, plugin manifest versions, hook
registration/order, live/template drift, executable bits, Python environment, required
commands, launchd job and sentinel freshness, Brain schema/index health, and remote Git
readiness. Report exact repair commands separately; do not execute them.

**Test:** Fixtures cover missing dependencies, stale generated files, malformed JSON,
missing hooks, stale sentinel, absent venv, version drift, and a fully healthy machine.

**Invariant:** Doctor is read-only and never prints raw configuration values.

## Step 12 — Add proposal lifecycle and observability

- **Priority:** P2
- **Owner:** Agent.
- **Complexity:** M
- **Status:** Pending.

**What:** Prevent proposals from becoming an undifferentiated permanent inbox and make
weekly health states interpretable.

**Where:** `brain/content/_outputs/proposals/`, report generators, vault indexes, and
weekly health output.

**How:**

1. Require `status`, `severity`, `owner`, `created`, `last_checked`, source fingerprint,
   and resolution reference in proposal frontmatter.
2. Define `open`, `accepted`, `rejected`, `superseded`, and `resolved` transitions.
3. Deduplicate recurring findings by source fingerprint instead of date-based filenames.
4. Replace a single timestamp sentinel with a small redacted status record containing
   last successful stage, commit, push state, advisory finding count, and failure stage.
5. Keep outbound notifications out of scope; surface state locally only.

**Test:** Repeated identical scans update one proposal; changed evidence reopens it;
resolved proposals disappear from the pending count; health status distinguishes
execution failure from open advisory findings.

**Invariant:** A generated report cannot silently mark itself resolved.

## Step 13 — Curate content and archive provenance

- **Priority:** P3
- **Owner:** Agent proposes; Founder resolves semantic ambiguity.
- **Complexity:** M
- **Status:** Pending.

**What:** Improve the quality of compacted archives and settle whether stable Polish
identifiers remain part of the compatibility contract.

**Where:** Brain source archives, canonical notes, naming policy, English guard, and
garden decisions.

**How:**

1. Add recoverable provenance fields where safe: original repository/path, capture
   date, canonical target, and non-secret commit identity when useful.
2. Audit the semantic fidelity of compacted archives, not only link resolution and
   English language.
3. Document that `NARZEDZIA`, `PROJEKTY`, and `przeglad-claudemd` are stable technical
   identifiers. If fully English namespaces are required later, use an explicit alias
   migration with link and command compatibility tests.
4. Expand the English regression suite for ASCII-only Polish prose, oversized maintained
   files, and new file types without introducing a probabilistic blocking dependency.
5. Record accepted garden false positives and terminal project notes.

**Test:** Every archive resolves to a canonical note and passes a sampled fidelity
review; identifier aliases preserve old links and commands; English fixtures cover the
known scanner blind spots; garden output contains no unexplained repeated warnings.

**Invariant:** Compatibility migrations never break existing wikilinks, commands,
project injection, or Git recovery without an explicit decision.

## Additional problems identified

1. **The current migration is validated but not durable.** A passing dirty tree is not a
   release or a recoverable checkpoint.
2. **Potentially active historical secrets outrank tooling improvements.** History
   cleanup without rotation would be security theater.
3. **The global commit rule contradicts these repositories.** It requires npm commands
   where no npm project exists.
4. **Weekly Brain lint can be false-green.** Model process success is not deterministic
   content validity.
5. **The Git harness is still mostly simulated.** Autostash, index behavior, and remote
   graph outcomes need real Git integration coverage.
6. **Preflight has a time-of-check/time-of-use gap.** Manual or Obsidian edits can begin
   after preflight and before staging.
7. **PID-only live-lock detection can misclassify PID reuse.** A process start signature
   or lease/heartbeat would be more reliable.
8. **Permission audit runs after push.** A later failure suppresses the success sentinel
   even though remote mutation already happened.
9. **Project scanners disagree on repository discovery.** Secret and template scans
   still miss linked worktrees because they require a `.git` directory.
10. **Secret scan truncation is underreported.** Twenty displayed matches do not reveal
    how much evidence was omitted.
11. **Automatic CLAUDE.md review output is not atomic or structurally validated.** A
    partial or prompt-influenced response can become a proposal.
12. **Five-most-recent review selection can starve the sixth active repository.** It is
    better than filesystem order but still lacks fairness.
13. **The health sentinel is ambiguous.** It cannot distinguish pipeline health,
    advisory findings, a completed push followed by audit failure, or stale launchd.
14. **Configuration drift has no expected-difference model.** Intentional personal
    plugins will keep producing noise until overlays/allowlists exist.
15. **Language validation is heuristic.** It skips oversized/non-UTF-8 files and can miss
    Polish prose written without diacritics.
16. **Archive recovery and secret-history rewriting conflict.** Raw captures described
    as recoverable from Git may disappear if contaminated history is intentionally
    rewritten; canonical notes must remain sufficient on their own.
17. **Graph warnings have no policy.** Orphans, blind notes, and duplicate candidates
    currently return success without a persisted accept/fix decision.
18. **Passing link tests do not prove semantic preservation.** Compacted archive targets
    may resolve while omitting a durable lesson; sampled fidelity review is still needed.

## Definition of done

The follow-up program is complete only when:

- all historical credential candidates have a recorded provider-side verdict;
- both migration repositories have approved, recoverable checkpoints with unrelated
  user work excluded;
- live/template drift is either resolved or explicitly allowlisted;
- weekly automation passes real-Git race, autostash, staging, push, and lock tests;
- deterministic Brain validation blocks persistence of invalid state;
- scanner discovery includes normal repositories and worktrees;
- Codex capture has a stable, redacted, retry-safe contract or an explicit product-level
  blocked decision;
- Brain schema, graph warnings, proposal lifecycle, and retrieval benchmark are enforced;
- the unified doctor reports a reproducible healthy machine;
- the full English and validation matrices pass on the exact final staged trees.

## Next action

Start with Step 0. Do not edit live configuration or start new feature development
before the working-tree manifests exist and the four credential candidates have named
owners.
