# Developer OS — Outstanding Work Backlog

> **Starting a session? `SESSION.md`. Looking for what to do next? `ORDER.md`.**
> Three files, one job each: `SESSION.md` is the procedure, `ORDER.md` is the queue, and
> this one is the reference — what each outstanding document must contain and why it
> exists.

Single index of everything that still has to be done, for this product and for the
founder's legacy runtime. Consolidated on 2026-07-27 from the founder's two legacy
repositories; neither of those holds plans, specs, or open roadmap items any more.

**Reconciled against the code and against both legacy trees on 2026-08-08.** Finished work
was removed rather than ticked: what stays is what somebody still has to do, plus the
constraints and lessons that outlive the work that produced them. Two findings from that
pass are open items — §1 — and the legacy checklist gained one and shed most of another, §6.
Anything deleted is in git history; where a deletion carried something durable, the
replacement text says where it went.

**Rules for this file**

- Order lives in `ORDER.md` and detail lives here. When they disagree about sequence,
  `ORDER.md` wins; when they disagree about content, this file wins. Never copy a
  requirement into `ORDER.md` — link to the section instead.
- Every new plan or spec is registered here in the same change that creates it, and gets a
  row in `ORDER.md` in that same change.
- Status values: `done`, `in progress`, `open`, `blocked`, `decision required`.
- A step is `done` only when its own evidence exists. A passing local tree is not
  evidence; a commit is.
- **`plans/` holds only unfinished work.** When a plan's last step is done, delete the file
  in the same commit that closes it, after carrying any evidence a later step still needs
  into the document that needs it. Git history is the archive — do not keep a `completed/`
  or `archive/` directory.
- **A spec outlives its plan.** While a subsystem is unfinished its spec is the reference
  for review and drift checks. After it ships, the spec is retained only while another
  document still points at it as the design of record — the kernel-lock spec is the one
  case (§8) — and its status line must then say so, in the past tense.
  **One spec is exempt because the rule's unit does not fit it.** The product design spec
  specifies eight subsystems at once, so no single status line could be truthful: Foundation
  has shipped, DOS-P2 is in progress, DOS-P3 through DOS-P9 are unbuilt. It carries per-section
  markers instead — §8, §9.1 and §9.3 each say what actually shipped — which is finer
  granularity than this rule asks for. Do not give it a global past-tense status line, and do
  not treat it as a deletion candidate while any subsystem it specifies is unbuilt.
- **Three deleted plans and two stripped ones, all in git history.** Deleted whole: the
  brain/claude-shared English migration (`28a0ddc`), the kernel transaction lock (`cf70342^`),
  and Foundation (`c4f883f^`) — a deleting commit does not contain the file it deleted, hence
  the `^`. Stripped in part: the program plan's Tasks 0–1 and the Brain plan's Tasks 1–2, both
  recoverable at `9f82901`, which is the commit that added the superseding notes rather than
  one that removed anything.
- `docs/superpowers/plans/legacy-runtime/` is publication-excluded. Nothing in it may be
  copied into a public artifact.

---

## 0. Status at a glance

Open work only. Program Tasks 0 and 1 are closed and are not rows here.

| Area | Where | What is left |
|---|---|---|
| Program (umbrella) | 1 plan | Task 2 **in progress**; Tasks 3–9 open |
| DOS-P2 Brain engine | 1 spec + 1 plan | **8 of 10 plan tasks**; resume at Task 3 |
| DOS-P3 … DOS-P7 | nothing written | 5 specs, 5 plans, 5 implementations |
| DOS-P8 cutover, DOS-P9 release | program plan Tasks 8–9 | every artifact; one open decision each |
| Repository-level | §1 | NEW-1, NEW-2, and one parser decision |
| Legacy runtime | 1 exit checklist | 4 items: two untouched since 2026-07-20, one nearly discharged, one new |
| Outside this room | `ORDER.md` Track L | license approval, remote verification |

**Self-containment.** No Developer OS task reads the founder's legacy runtime. Program
Task 0 froze everything the build needs into `docs/migration/`, and since 2026-08-01
`npm run lint` fails on any reference to those paths outside a named allowlist — over
tracked *and* untracked files. The only remaining contact with the legacy machine is the
exit checklist in §6 and the read-only cutover in DOS-P8, both of which operate on the
founder's machine as user data, not as source material.

---

## 1. Open right now

Everything in this section is genuinely open. Nothing here is bookkeeping.

### NEW-1 — `packages/brain` is outside the network-capability scan

- **Status:** open, found 2026-08-08 · **Owner:** DOS-P2 · **Size:** S
- **The problem is a false claim in two approved documents, not a missing nicety.** The Brain
  engine design spec §16 asserted that "Foundation's compiled-module network scan covers
  `packages/brain` on the same terms as everything else", and `docs/architecture/foundation.md`
  §7 described the scan as covering "every compiled non-test module". Neither was true. Both
  have been corrected in place to say what the scan actually does; the gap itself is still open.
  `tests/e2e/foundation.test.ts` iterates a hard-coded list of four package directories —
  `apps/cli`, `packages/core`, `packages/security`, `packages/platform-macos`. The Brain
  package was added on 2026-08-07 and was never added to that list, so its three compiled
  modules are scanned by nothing.
- **Why it is worth its own entry rather than a line in a plan.** The scan is the only
  mechanical enforcement behind "this product makes no network call". A guarantee that a
  spec asserts and a test does not check is worse than an unasserted one, because the next
  reviewer stops looking. The same test already guards against the failure mode that makes
  this class of gap invisible — it refuses an empty inventory, so a scan over nothing
  cannot pass — and that guard is per-directory, so it cannot notice a directory nobody
  listed.
- **Fix:** add `packages/brain` to the list, in the task that next touches the Brain
  package. The floor assertion `expect(scanned).toBeGreaterThan(20)` should become an exact
  count, or the "37 modules" in `docs/architecture/foundation.md` §7 should stop being prose
  the test does not pin. Decide which; do not do both silently.

### NEW-4 — decide whether the parser contract forbids application tags

- **Status:** open, inherited from NEW-2 when that closed · **Owner:** DOS-P2 or DOS-P6 ·
  **Size:** XS
- Design spec §4.4 states what a replacement parser must not *drop*. It says nothing about
  what one must not *add*, and there is exactly one candidate: resolving application tags into
  constructed values — the `yaml.load` versus `safe_load` distinction that has produced remote
  code execution in more than one ecosystem. `yaml@2.8.1` does no such thing, so nothing today
  depends on its absence and nothing can regress; the product design spec's §14.1 already
  classifies vault files as untrusted data but places no constraint on the parser itself.
- The proposed clause is one sentence — *resolve only core-schema tags; a parser that
  constructs application-tagged values is refused outright* — and it costs nothing to adopt.
  It is recorded rather than written into §4.4 because it would be a new design decision in an
  approved spec.
- **Settle it in DOS-P2's remaining work or explicitly defer it to DOS-P6**, whose threat model
  owns untrusted input. It carried the two closed items' hook in Task 10 Step 6; keep it there.

**NEW-2 and NEW-3 closed 2026-08-09.** `uniqueKeys: true` is pinned at the `parseAllDocuments`
call, and a YAML failure now carries the line it happened on, through `NoteParseIssue.line` and
`LintFinding.line`. Only `err.linePos` is read — `err.message` and `err.source` embed the
offending note verbatim, and a test asserts a sentinel from the note reaches neither the
message nor any serialized part of the issue.

### NEW-5 — `LintFinding` reports a line two different ways

- **Status:** open, found 2026-08-09 · **Owner:** DOS-P2 Task 9, or DOS-P4 · **Size:** XS
- `frontmatter` findings put the line in the structured `line` field. `index-drift` findings
  put it in prose inside `message` — "differs from a fresh build at line 6" — and carry
  `line: null`. One type, one concept, two conventions.
- **It surfaces the moment `--json` ships.** A consumer gets
  `{"class":"index-drift","line":null,"message":"…at line 6…"}` and has to parse the message
  to recover a number the type already has a field for.
- The one-line version is passing `line` at the two drift sites too. The honest version is
  deciding what frame `LintFinding.line` names when `path` is a generated artifact rather than
  a note — for a note it is a file line, and for an artifact it is a line in a file the user
  did not write. Settle it before Task 9 renders findings, not after.

### EXIT-1, EXIT-2, EXIT-4 — the legacy runtime

Three of the four legacy items are open and two have not moved since 2026-07-20. Detail is
in §6; `ORDER.md` Track B carries the sequence. **EXIT-1 is the oldest open item in this
repository and the only one whose consequence exists whether or not this product ships.**

### L1, L2 — outside this environment

An OSI-approved license reviewed by qualified counsel, and remote verification. Both are
recorded in `ORDER.md` Track L, both gate public release, and both depend on somebody who
is not in this room. Neither is engineering work.

---

## 2. Foundation — what it left open

**Foundation closed on 2026-08-01** and its gate evidence is not repeated here; it is in
`docs/releases/foundation-checkpoint.md`, dated. This section holds only the three things it
left behind that are still somebody's decision or somebody's work.

Read these instead of this section for anything else:

| Document | What it holds |
|---|---|
| `docs/architecture/foundation.md` | what the layer is, its boundaries, the mutation pipeline, exit codes, what it deliberately cannot do, and nine known residuals |
| `docs/architecture/foundation-constraints.md` | the verbatim per-task constraints, including **two open founder questions** under Task 5 |
| `docs/releases/foundation-checkpoint.md` | the gate evidence, dated 2026-08-01 — a historical record, not a live status page |

**The two open founder questions are still open.** Whether `SpawnLockfRunner` needs a
watchdog around the non-blocking `lockf` call, and whether `<state>/transactions/`
accumulating one permanent `0600` lock file per transaction id is intended or wants
collection. Neither blocks anything; both are decisions nobody has made.

**One thing Foundation built and nothing consumes.** `buildConflictEvidence` and its
unified-diff machinery in `packages/core/src/manifest/drift.ts` are implemented and
unit-tested, and no command calls them. That is deliberate — the first consumer is the
semantic config merge in DOS-P4/DOS-P5 — but a later reader should not mistake unused for
untested, or unused for dead.

**Residual 9 is owed by DOS-P7**, and it is the one residual that makes a shipped feature
unusable rather than merely rough: configuration cannot be changed after `init`. Detail with
that subsystem in §3.

---

## 3. Missing specs and plans

**Ten documents.** DOS-P2's spec and plan are written; DOS-P3 through DOS-P7 need both.
Each subsystem after Foundation requires an approved spec **and** an implementation plan
before any code work — this is a Global Constraint of the program plan, not a preference.
Every spec starts with a brainstorming/approval cycle.

### DOS-P2 — Brain engine · **in progress**

- **Spec:** `specs/2026-07-21-developer-os-brain-engine-design.md` — written 2026-08-04
- **Plan:** `plans/2026-07-21-developer-os-brain-engine.md` — written 2026-08-04, 10 tasks
- **Program task:** 2 · **Complexity:** L · **Blocked by:** nothing
- **Committed:** Task 1 — package scaffold and the optional `[brain]` config section
  (`4cd7224`). Task 2 — note schema: strict parse, reserved vocabulary, byte-identical
  rewrite (`9f82901`), shipped as 51 test cases after two review rounds.
- **Remaining, in order:** Task 3 discovery and the committed synthetic fixture · Task 4
  index and graph construction · Task 5 rendered Markdown views · Task 6 lint, six classes ·
  Task 7 retrieval · Task 8 the `BrainService` facade, capture-envelope type and migration
  registry · Task 9 the `brain` CLI group · Task 10 template, `init` integration, end-to-end
  suite and the bookkeeping that closes this entry.
- **Produces:** `BrainConfigV1`, `NoteFrontmatterV1`, `CaptureEnvelopeV1`,
  `IndexBuildResult`, `LintResult`, `RetrievalQuery`, `RetrievalResult`, `BrainMigration`,
  `BrainService`. The first two exist.
- **Gate:** index rebuilds are byte-for-byte deterministic under a frozen clock; every
  retrieval claim resolves to a selected canonical note.
- **Creates:** `packages/brain/src/{discovery,indexes,lint,retrieval,migrations}/`,
  `templates/brain/`, `tests/{contracts,fixtures,integration}/brain/`. `schema/` is done.

**Five facts that must survive the plan's deletion.** The plan is deleted when Task 10
closes, so anything a later subsystem needs is carried here now rather than lost:

1. **`yaml` parsing is quadratic in mapping size** — measured at 14 ms for 1,000
   frontmatter keys, 1.2 s for 16,000, and no completion inside two minutes for a 700 KB
   block, while the fence regular expression over the same input stays under 3 ms.
   Discovery walks arbitrary user files, so the bytes handed to `parseNote` must be bounded
   and an oversized frontmatter reported as a finding rather than hanging the CLI. The spec
   has no lint class for that finding yet; Task 6 needs one, or §7 of the spec needs a row.
2. **`NoteFrontmatterV1` is a design decision, not a migration fact.**
   `docs/migration/baseline-capabilities.json` froze the vault's *capabilities* — Obsidian
   Markdown, map, catalog, graph, index-first retrieval, four command names — and nothing
   about note schema. The `legacy-shape/` fixture's frontmatter is therefore invented, not
   reconstructed. Stated so no later reader mistakes it for something recovered from a real
   vault.
3. **`BrainConfigV1`'s type and zod schema live in `packages/core/src/config/types.ts`**,
   not in `packages/brain/src/schema/`. `DeveloperOsConfigV1` must reference the type, and
   `core` importing from `brain` while `brain` imports from `core` is a cycle.
   `packages/brain` owns the defaults and resolution and re-exports the type. The spec's §2
   table was corrected to match on 2026-08-08.
4. **The fixture is never generated from, compared against, or refreshed from a real
   vault.** If it turns out to miss a shape the product must support, extend the fixture and
   say so; do not open a vault to find out.
5. **`yaml@2.8.1` resolves the YAML 1.2 core schema, and that is why it was chosen.**
   A tag spelled `no` stays the string `"no"` rather than becoming `false`. Under a YAML 1.1
   parser the note silently loses a tag and gains a boolean nothing downstream expects. This
   one has two durable homes rather than this list, because it binds anyone who ever swaps
   the parser and that will happen long after DOS-P2 closes: design spec §4.4 states the
   contract, and the import site in `packages/brain/src/schema/note.ts` carries it where a
   reader who is *about to* change the parser is actually standing.

**Amendments this spec makes to earlier documents:** see §8. One of the four is applied in
code, one in the brain plan, one is cross-referenced only, and one — `init` installing the
template — is not yet built. None of them rewrites approved content beyond a status line or a
correction marked as shipped.

### DOS-P3 — Workflow compiler

- **Spec:** `specs/2026-07-21-developer-os-workflow-compiler-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-workflow-compiler.md` — missing
- **Program task:** 3 · **Complexity:** L · **Blocked by:** nothing
- **Parallel with:** DOS-P2
- **The spec must decide:**
  - the canonical workflow schema: identity, semantic version, triggers, inputs,
    read/write scopes, required capabilities, refusals, steps, structured result,
    validators, recovery
  - strict parsing that rejects unknown fields for v1 contracts
  - the renderer interface boundary — no vendor behavior inside canonical workflows
  - which workflows ship: `shared`, `brain-search`, `capture`, `review`, `ingest`, `doctor`
  - generated-artifact markers and the CI drift check
- **Negative fixtures required:** missing capability, excessive write scope, prompt
  instructions embedded inside source data, incompatible schema version.
- **Produces:** `WorkflowContractV1`, `WorkflowCapability`, `WorkflowInputSchema`,
  `WorkflowOutputSchema`, `WorkflowRenderer`, `RenderedArtifact`, `WorkflowValidationResult`.
- **Gate:** a vendor overlay can never weaken a canonical refusal or widen write scope;
  generated output changes only when canonical source or renderer changes.
- **Creates:** `packages/workflow-schema/src/`, `workflows/*`, `tests/{contracts,fixtures}/workflows/`.
- **Reference reading, optional:** `github.com/phuryn/pm-skills` (MIT) — 68 skills across 9
  Claude plugins, maintained as one hand-written format per skill with **no compile step**.
  It is the approach this task exists to replace, so it is useful in exactly two ways: as
  evidence that the single-format shortcut is what people actually reach for, and as a
  corpus to sanity-check that `WorkflowContractV1` can express a real skill without
  contortion. Not a dependency, not a fixture, not a source — repository fixtures stay
  synthetic.

### DOS-P4 — Claude Code adapter

- **Spec:** `specs/2026-07-21-developer-os-claude-adapter-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-claude-adapter.md` — missing
- **Program task:** 4 · **Complexity:** L · **Blocked by:** DOS-P3 schemas frozen
- **The spec must decide:** supported-version discovery, plugin structure, hook payloads,
  wrapper behavior, semantic config merge, failure contracts, which lifecycle surfaces
  are verified enough for SessionStart injection and automatic capture, and when to fall
  back to `developer-os run claude`.
- **Produces:** `ClaudeAdapter`, `ClaudeCapabilities`, `ClaudeInvocation`, `plugins/claude/`,
  managed hook plans, structured agent-run results.
- **Gate:** fake-CLI tests pin argv, stdin, environment, timeout, signal, exit and
  malformed-output behavior; install/update/uninstall preserves unrelated Claude settings;
  an unsupported version reports exact missing capabilities rather than partial success.
- **Checkpoint:** a Claude-only user completes the full synthetic Brain workflow with no
  Codex installed.
- **First consumer of Foundation's conflict evidence.** The semantic config merge is what
  `buildConflictEvidence` was built for (§2). The three-way *diff* the design spec §9.3
  describes was deliberately deferred to this task; Foundation shipped the two-way form —
  three recorded hashes, a current-versus-proposed diff.
- **Also decides the first `.claude/` question this repository has ever had.** The founder's
  own notes record an unresolved decision about whether small conveniences under `.claude/`
  (a slash command, a hook) are worth a full approval-and-hash cycle as publication
  artifacts. This repository has no `.claude/` directory today, and `exclusion-policy.md`
  does not name the path. Settle it here, before the first adapter artifact wants a home.
- **Reference reading, optional:** `phuryn/pm-skills/validate_plugins.py` (MIT) is a
  working inventory of real-world Claude plugin-manifest checks — name matches directory,
  semver, author object shape, description length floors, `use when` trigger phrasing,
  50–3000 word bounds as a progressive-disclosure proxy, and dangling skill-reference
  detection. Read it once when drafting this spec to avoid missing an obvious check. Note
  what it omits, because those are precisely our requirements: it does not reject unknown
  fields, does not check path traversal, and does not detect generated-vs-source drift.

### DOS-P5 — Codex adapter

- **Spec:** `specs/2026-07-21-developer-os-codex-adapter-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-codex-adapter.md` — missing
- **Program task:** 5 · **Complexity:** L · **Blocked by:** DOS-P3 schemas frozen
- **The spec must decide:** exactly which Codex surfaces are supported, verified against
  current official documentation *and* local behavior; how canonical workflows render into
  Codex skills and `AGENTS.md` guidance at the smallest appropriate scope; and the
  refusal rule — no transcript parsing unless a stable documented contract exists with a
  regression fixture.
- **Produces:** `CodexAdapter`, `CodexCapabilities`, `CodexInvocation`, `plugins/codex/`,
  managed hook plans, structured agent-run results.
- **Gate:** direct and wrapper capability matrices are tested separately; a missing
  capture hook is classified `wrapper-required`, never a false `yes`.
- **Absorbs:** legacy follow-up Step 8 (`Add stable Codex learning capture`), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.
- **There is no longer a legacy Codex implementation to compare against.** The founder's
  legacy runtime removed its Codex parity layer on 2026-07-27, after
  `baseline-capabilities.json` froze that surface on 2026-07-21. The frozen record remains
  the only admissible statement about what the legacy runtime did; nothing is left to
  observe, and this spec must not plan to observe it.

### DOS-P6 — Knowledge pipeline hardening

- **Spec:** `specs/2026-07-21-developer-os-knowledge-pipeline-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-knowledge-pipeline.md` — missing
- **Program task:** 6 · **Complexity:** L · **Blocked by:** DOS-P4 **and** DOS-P5
- **The spec must decide:** exact capture fields, lifecycle transitions, retention
  behavior and redaction classes; atomic quarantine writes with post-redaction
  deduplication; accept/edit/reject review with no automatic deletion; the contract that
  marks all source material as untrusted data and restricts agents to staging-only writes.
- **Required tests:** sentinel secret, prompt injection, symlink escape, multiline
  command, malformed manifest, interruption at every phase.
- **Produces:** complete `CaptureEnvelopeV1` transitions, `ReviewDecision`,
  `IngestProposal`, `IngestValidationResult`, `ApplyResult`, recovery commands. DOS-P2
  defines the envelope as a type and writes none of them.
- **Gate:** the same secret sentinel is absent from capture, logs, hashes, model input,
  staging, reports and canonical notes; model output cannot widen write scope; failure
  leaves the capture retryable and never marks it ingested. Independent security review
  is required before the checkpoint.
- **Absorbs:** legacy follow-up Steps 5, 7, 9 and 12, frozen on the legacy runtime
  2026-07-27 and rebuilt here instead.

### DOS-P7 — Git, automation, update and release lifecycle

- **Spec:** `specs/2026-07-21-developer-os-lifecycle-design.md` — missing
- **Plan:** `plans/2026-07-21-developer-os-lifecycle.md` — missing
- **Program task:** 7 · **Complexity:** L · **Blocked by:** DOS-P6
- **The spec must decide:** Git initialization, existing-remote connection, scoped
  staging, commit, push and every error state; the exact `launchd` jobs, schedules, logs,
  lock ownership and opt-in boundaries; signed/checksummed release metadata; dry-run
  updates; schema-migration staging and rollback.
- **Produces:** `GitSyncConfigV1`, `AutomationConfigV1`, `LaunchdPlan`, `UpdatePlan`,
  `SchemaMigrationPlan`, verified uninstall/rollback results.
- **Gate:** a Git-disabled and automation-disabled install performs no related process or
  network call; push failure never records a successful sync; update refuses drift;
  uninstall removes only manifest-owned artifacts.
- **Absorbs:** legacy follow-up Step 6 (real-Git integration coverage), frozen on the
  legacy runtime 2026-07-27 and rebuilt here instead.
- **Must also close Foundation residual 9.** Configuration cannot be changed after `init`:
  `config.toml` is a hash-tracked managed artifact and no command edits it, so changing
  `git.enabled` or `automation.enabled` today means hand-editing a file that then drifts
  the manifest and makes `init`, `doctor` and `uninstall` all refuse. A lifecycle task that
  ships opt-in commands without a way to record the opt-in ships a dead end. Detail in
  `docs/architecture/foundation-constraints.md`, "Found after Foundation closed".

---

## 4. Program tasks 8 and 9 — artifacts, and one open decision

### DOS-P8 — Founder shadow migration

- **Status:** open · **Blocked by:** DOS-P7, and by all four Track B items
- **Artifacts required (none exist):** `docs/migration/founder-cutover.md`,
  `founder-baseline-results.json`, `founder-shadow-results.json`,
  `founder-cutover-manifest.json`.
- **Decision required:** the program plan enumerates ten steps inline and does not
  mandate a dedicated spec or plan. **Recommendation: author a plan anyway.** This is the
  only task that mutates the founder's live machine, and its rollback must be rehearsed
  before cutover is declared complete.
- **Hard invariants:** the founder's vault is not moved; legacy recovery data is not
  deleted; two copies of a mutating hook are never enabled at once; legacy hooks and jobs
  are disabled only after new evidence passes, and are never deleted.

### DOS-P9 — Public beta and v1

- **Status:** blocked · **Blocked by:** DOS-P8
- **Artifacts required (none exist):** `README.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, approved `LICENSE`, `docs/install/`, `docs/tutorials/`,
  `docs/troubleshooting/`, `docs/privacy.md`,
  `.github/workflows/{ci,release}.yml`, Homebrew formula source, macOS Apple Silicon and
  Intel packaging configuration. `docs/releases/` already exists — this task adds release
  notes to it rather than creating it.
- **Owes the pre-publication secret re-scan** recorded as a gate in §7. The repository now
  carries legacy machine detail it did not carry when Program Task 0 produced its evidence,
  so Task 0's clean result does not transfer.
- **Decision required:** same as DOS-P8 — no dedicated plan is mandated. The program
  verification matrix is probably sufficient here; confirm before starting.
- **Two external blockers that are not engineering work:** L1 license and L2 remote
  verification, both in `ORDER.md` Track L.

---

## 5. Missing repository infrastructure

Named in the program file map, not yet created. Each is created by its first owning
subproject; listed here so nothing is discovered late.

| Path | First owner | Status |
|---|---|---|
| `tests/contracts/` | Foundation onward | missing |
| `tests/fixtures/` | Foundation onward | missing |
| `tests/fixtures/brain/legacy-shape/` | DOS-P2 Task 3 | missing — synthetic vault that replaces every reason to read a real vault at build time |
| `tests/integration/` | Foundation onward | missing |
| `tests/e2e/` | Foundation Task 9 | **created 2026-08-01** — `pnpm test:e2e` runs 31 cases |
| `tests/security/` | DOS-P6 | missing |
| `docs/architecture/` | Foundation Task 9, then per subsystem | **created 2026-08-01** — Foundation boundaries and constraints done; workflow schema, threat model, capability model still owed by later subsystems |
| `docs/releases/` | DOS-P7 | **created 2026-08-01** by Foundation Task 9, ahead of its named owner |
| `packages/brain/` | DOS-P2 | **created 2026-08-07** — `src/schema/` only (`4cd7224`, `9f82901`). `discovery/`, `indexes/`, `lint/`, `retrieval/`, `migrations/`, `service.ts` still owed by plan Tasks 3–10 |
| `packages/workflow-schema/` | DOS-P3 | missing |
| `packages/adapter-claude/`, `plugins/claude/` | DOS-P4 | missing |
| `packages/adapter-codex/`, `plugins/codex/` | DOS-P5 | missing |
| `workflows/`, `templates/brain/` | DOS-P2 / DOS-P3 | missing |

**Two directories exist that the program file map never named:** `tests/helpers/` (the
temporary HOME, the hash inventory, the process runner) and `tests/repository/` (the
self-containment rule, its allowlist, and the git-driven enumerator that `npm run lint`
runs). Both are Foundation output and both are now rows in
`docs/architecture/foundation.md` §1 — `tests/repository/` was added there on 2026-08-08,
having previously been documented only in `docs/releases/foundation-checkpoint.md` and in its
own source. Recorded here because §5 is read as the complete inventory of what does and does
not exist, and a map with a gap invites a second copy.

---

## 6. Legacy runtime — exit checklist

Plan: `plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`. Rescoped
2026-07-27 from a 14-step development backlog into an exit checklist, and **re-verified by
read-only inspection on 2026-08-08.**

**None of this gates Developer OS development.** Foundation through DOS-P7 are
self-contained. These items gate DOS-P8 cutover, and closing them ends work on the legacy
runtime permanently.

| ID | Pri | Item | Owner | Status |
|---|:---:|---|---|---|
| EXIT-1 | P0 | Rotate historical credential candidates | **Founder** | open — console work, touches no repository; pending since 2026-07-20 |
| EXIT-2 | P0 | Resolve the non-npm commit-gate contradiction | Agent + Founder | open — one rules file, unchanged since 2026-07-20 |
| EXIT-3 | P0 | Land or durably preserve the remaining untracked entries | Agent + Founder | **mostly discharged** — see below |
| EXIT-4 | P0 | Stop or fix the failing legacy weekly job | Agent + Founder | **open, new 2026-08-08** |

### What the 2026-08-08 re-verification found

**EXIT-3's premise no longer holds, and that is the largest single correction in this
revision.** The previous text described "roughly 136 changed or untracked entries including
a completed and independently reviewed English migration that was never committed". That
migration was committed. Both repositories are now in sync with their remotes and neither
has a single modified tracked file. What remains is:

- **Four untracked entries in the shared-runtime tree.** Three are automation backup files
  from the change that broke the weekly job, and possibly the only copy of the last working
  version, so EXIT-4 settles before they are deleted. One is a roadmap document, and it needs
  no migration: every open item it ever carried is already represented here, and the file
  itself now says so and points at this backlog. Committing or discarding the four is the
  whole of EXIT-3's remaining work, which is why it dropped from L to S.
- **An untracked capture inbox in the vault tree**, roughly thirty unprocessed captures
  accumulated since 2026-07-27. This is user data awaiting ingest, not uncommitted work of
  value — but it is only accumulating because EXIT-4 is open.

**EXIT-4 is new.** The legacy weekly job has not succeeded since 2026-07-27; two fix commits
landed afterwards and neither worked. Two consequences: the capture inbox above is backing
up, and the legacy plan's own definition of done — "no further change is planned,
scheduled, or in progress on either repository" — is false while a scheduled job is still
firing and failing. Either fix it or disable it with the founder's agreement and drain the
backlog; leaving a job that fails silently for eleven days is neither.

**EXIT-1's candidate set is wider than this file used to say.** The 2026-07-19 triage
recorded four rotation candidates and its verdict still stands unchanged. A second scan on
2026-07-27 reported candidate matches across six repositories. No provider-side verdict has
been recorded for any of them. The founder waived these as *Developer OS publication*
blockers on 2026-07-21; a waiver scopes this product, it does not revoke a key.

**EXIT-2 is unchanged, verbatim.** The global rule still forbids every commit without
`npm run lint && npm test`. Neither legacy repository is an npm project, so the literal rule
makes a compliant agent commit impossible — which is exactly why EXIT-3 sat open for
nineteen days with committable work in it. The fix is a fail-closed validation contract:
run the repository-declared validation command; when `package.json` exposes lint/test
scripts, run them; when it does not, run the documented repository-specific suite. Missing
validation metadata stays a commit blocker, and npm projects are not weakened.

**Five proposals await review, not two.** The previous revision mentioned the historical-secret
triage and a config-drift proposal. There are five, three of them written on 2026-07-27 —
including a second secret scan and a template-hygiene report with sixteen findings needing
manual review. They are private Brain content left in place and are not repository inputs, so
they are counted here and named only in the legacy plan, which is the publication-excluded
document that may hold their paths.

### Frozen 2026-07-27 — ten items, will not be done on the legacy runtime

Each was closed as *will not do there* and is rebuilt as a Developer OS feature on synthetic
fixtures. The per-item mapping to DOS-P2 through DOS-P7, with the condition that would justify
unfreezing each one, is a table in the legacy plan; it is not duplicated here, because two
copies of a mapping is how they come to disagree. Full original text in commit `28a0ddc`.

**One of the ten has a live consequence, and it is the only reason to read the frozen list at
all.** Frozen Step 7 would have fixed two known secret-scanner gaps: linked worktrees are
skipped, and results truncate at twenty matches without reporting how many were omitted. EXIT-1
depends on a trustworthy scan, and the 2026-07-27 scan was produced by the *unfixed* scanner —
so its six-repository count is a floor, not a total. If that scan is the deciding evidence for a
rotation verdict, unfreeze exactly those two fixes and nothing else.

---

## 7. Standing gates

Copied here so they are visible without opening the program plan.

| Gate | Evidence | Blocks |
|---|---|---|
| Repository validation | `npm run check` (`lint && test && build && git diff --check`), where `lint` is `tsc -b`, `eslint`, and the self-containment enumerator | every commit |
| Fresh-context review | a reviewing agent that is not the author, per code-producing task | every commit |
| Exact-path staging | never `git add -A`; stage only task-owned paths | every commit |
| Generated artifacts | clean regeneration diff | adapter commits, release |
| Security suites | sentinel, path, prompt injection, transaction, network | DOS-P6 onward |
| Publication secret re-scan | candidate-only scan over the whole tree, including the publication-excluded legacy paths this repository has carried since 2026-07-27 | public visibility |
| Agent compatibility | disposable real-agent matrix | DOS-P8, release |
| Migration | shadow comparison plus an exercised rollback | public beta |
| License | OSI-approved text reviewed by qualified counsel | public visibility |
| Packaging | checksums, SBOM, clean-account install | `v1.0.0` |

---

## 8. Amendments to approved documents

An approved document is not silently rewritten. When a later approved document changes an
earlier one, the change is recorded in the amending document and cross-referenced from the
amended one; only code and status lines are edited in place. This section is the index — read
it before trusting any approved document, because it is the only place that says whether the
one in front of you is still current.

**Still owed. These two amendments are recorded and not yet built:**

| Amended | By | What changes | Owed by |
|---|---|---|---|
| `specs/…-design.md` §8 CLI contract | brain-engine spec §11, §15.1 | a `brain reindex\|lint\|search\|status` group is added; `search` becomes an alias for `brain search` | brain plan Task 9. Cross-referenced in §8 of that spec; its command block is left unchanged because it is a dated approved record |
| Foundation's "never modify an existing vault" | brain-engine spec §10, §15.4 | `init` installs `templates/brain/` when, and only when, it creates the vault, which keeps the guarantee intact | brain plan Task 10 |

**Discharged. Listed because the amended document is still read, not because there is work
left:**

| Amended | By | What changed | Where it landed |
|---|---|---|---|
| `DeveloperOsConfigV1`, frozen at `foundation.md` §2 | brain-engine spec §3, §15.3 | gains an **optional** `brain` section; `configSchema` stays `.strict()` and `schemaVersion` stays 1, so every existing installation still loads | code, `4cd7224`; cross-referenced in `foundation.md` §2 |
| brain-engine spec §2 placement table | the brain plan, and the shipped code | `BrainConfigV1`'s type and schema live in `packages/core`, not `packages/brain` | code, `4cd7224`; the spec table carries a dated in-place correction |
| `specs/…-brain-engine-design.md` §7 lint table | the brain plan's Task 4, as shipped | the `links` class gains a `warn` row for a link text matching more than one note, and §7 records the five-tier resolution ladder plus its case-folded fallback | code, this task; the spec carries a dated in-place amendment marked as shipped |
| program plan Task 2 file list | brain-engine spec §15.2 | `discovery/` is a sixth source directory, because folder policy is consumed by both `indexes/` and `lint/` and is not schema parsing | the program plan's file list, and the brain plan |
| `specs/…-design.md` §8 flags | Foundation, `foundation.md` §7 | `--verbose` is not implemented and dispatch is strict, so it exits 2; `repair` takes `--resume`/`--rollback` rather than `--dry-run`/`--yes` | cross-referenced in §8 of that spec |
| `specs/…-design.md` §9.1 `init` | Foundation | `init` prompts for neither adapters nor vault path, and its post-install gate is the five checks in `INIT_OWNED_CHECKS`, not the whole `doctor` report | cross-referenced in §9.1 |
| `specs/…-design.md` §9.3 conflict evidence | Foundation Task 6 | the three-way *diff* is deferred to DOS-P4/P5; Foundation shipped three recorded hashes and a current-versus-proposed diff | cross-referenced in §9.3, with the reasoning in `foundation-constraints.md` Task 6 |
| `specs/…-kernel-transaction-lock-design.md` | its own implementation, committed 2026-07-27 | the spec describes shipped code, so its status line says so in the past tense | **This is the one spec retained after its subsystem shipped**, because `foundation-constraints.md` points at it as the design of record for `packages/platform-macos/src/transaction-lock.ts`. Delete it only when nothing points at it |

---

## Appendix — outstanding outside this repository

Not Developer OS work; recorded so it is not lost. `dev/active/` and `.claude/plans/` were
deprecated on 2026-07-18 in favour of `docs/superpowers/plans/`, to be migrated
opportunistically.

**As of 2026-08-08, 25 files remain on the deprecated paths across seven repositories**
(down from 28 on 2026-07-27). One repository completed its migration in the interval and
one gained a `docs/superpowers/` tree without moving its plans yet; the user-level
directory grew.

Do not maintain the per-repository table that used to sit here. It went stale within days,
it named absolute machine paths in a repository that is meant to become public, and it
cannot be right for longer than the next session — recompute it when the migration is
actually the work in hand, rather than reading a frozen count.

The founder's two legacy repositories are not on this list: both were confirmed clean of
`.claude/plans/`, `dev/active/`, and `docs/superpowers/` on 2026-07-27, and the 2026-08-08
re-verification found no change.
