# Developer OS — Product and Architecture Design

**Date:** 2026-07-21
**Status:** Approved in conversation on 2026-07-21
**Target repository:** `git@github.com:msolecki/developer-os.git`
**Product name:** Developer OS
**CLI command:** `developer-os`

## 1. Summary

Developer OS is an open-source, local-first toolkit that gives Claude Code and
Codex a shared set of development workflows plus a private, Obsidian-compatible
knowledge base. The public product contains the CLI, workflow contracts, agent
adapters, Brain engine, security controls, tests, and an empty vault template.
Each user's notes, captures, configuration, and backups remain outside the
public checkout.

Version 1 targets macOS developers and power users. Claude Code and Codex are
independent adapters: a user may install either one or both. Agent CLIs perform
AI-assisted work; Developer OS does not require separate Anthropic or OpenAI API
keys. Scheduled maintenance and Git synchronization are explicit opt-ins.

The existing `~/claude-shared` and `~/brain` repositories were migration sources.
That role closed on 2026-07-21: Program Task 0 classified both working trees,
admitted three planning documents, and froze everything else the product needs to
know into `docs/migration/`. Developer OS is built from its own design and those
frozen artifacts, in audited, reviewable commits. No implementation, review, or
test step reads a legacy repository. Private Brain content and potentially
sensitive Git history never enter the public repository.

Two roles survive that closure, and neither is a source dependency: `~/brain` may
be selected at runtime as a vault, like any other user vault, and both repositories
are the subject of the one-time shadow cutover in Phase 7.

## 2. Approved product decisions

| Area | Decision |
|---|---|
| Distribution | Local CLI |
| Initial platform | macOS only |
| Agent support | Claude Code, Codex, or both through independent adapters |
| Brain storage | Local Obsidian vault; optional private Git |
| Capture | Automatic local quarantine where a stable capability exists; user approval before ingest |
| AI backend | Selected installed agent CLI; no separate model API integration |
| Automation | Manual by default; `launchd` installation is opt-in |
| Audience | Developers and technical power users |
| Source model | Open-source public core; private user vaults |
| Architecture | Modular public monorepo plus private runtime data |
| Telemetry | None in version 1 |
| Cloud service | None in version 1 |

An exact OSI-approved license must be selected by the founder after qualified
legal review and before the repository is made public. Until the license text is
approved, development may continue in a private repository, but no public release
may be published.

## 3. Goals

1. Install a shared development operating system for Claude Code and Codex with
   one CLI.
2. Preserve a user's durable project knowledge in a local Markdown vault that
   opens normally in Obsidian.
3. Capture useful session outcomes without persisting raw secrets or silently
   promoting model output into canonical knowledge.
4. Generate agent-specific plugins and instructions from versioned workflow
   contracts while preserving explicit capability differences.
5. Update, repair, and uninstall product-managed artifacts without overwriting
   user configuration or deleting the Brain.
6. Work without Git, cloud storage, telemetry, or a dedicated model API key.
7. Provide deterministic validation and recovery for every filesystem mutation.
8. Support a safe migration from the founder's current `claude-shared` and Brain
   setup without a flag-day cutover.

## 4. Non-goals for version 1

- Linux or Windows support.
- A desktop application or custom Obsidian plugin.
- A hosted backend, accounts, team workspaces, or managed sync.
- Direct Anthropic or OpenAI API integrations.
- MCP as a required retrieval or storage layer.
- A third-party plugin marketplace.
- Automatic publishing, messaging, billing, or other outbound actions.
- Telemetry or usage analytics.
- Automatic Git enablement, commit, or push without explicit configuration.
- Parsing an undocumented Claude Code or Codex transcript format.
- Importing private Brain notes or legacy repository history into the public repo.

## 5. Product boundary

### 5.1 Public repository

`msolecki/developer-os` owns:

- the CLI and configuration schema;
- deterministic Brain indexing, linting, migration, and retrieval code;
- secret redaction and security policy;
- vendor-neutral workflow contracts;
- Claude Code and Codex renderers/adapters;
- generated plugin packages;
- macOS lifecycle integration;
- synthetic fixtures, vault templates, documentation, and release tooling.

### 5.2 Private user state

The user's machine owns:

- the Obsidian vault and raw capture quarantine;
- product configuration and the installation manifest;
- staging transactions, local backups, and redacted logs;
- optional Git configuration and remote;
- agent authentication already managed by Claude Code or Codex.

Developer OS never copies agent credentials into its own state. Git operations
reuse the user's existing Git authentication through the normal Git process.

### 5.3 Legacy repositories

- `~/claude-shared` is no longer a migration source. Its source role closed with
  Program Task 0; what the product needed from it is `docs/migration/baseline-capabilities.json`.
  It remains the founder's live runtime until the Phase 7 cutover replaces it.
- `~/brain` remains the founder's private canonical vault. It may be configured as
  the Developer OS Brain without moving files, on exactly the same terms as any
  other user-selected vault.
- Neither Git history is imported into the public repository.
- Both legacy repositories remain recoverable until the new system completes at
  least one full capture, ingest, retrieval, update, and rollback cycle.
- Build-time access is prohibited. No package, test, fixture, or review step may
  read either path; a missing legacy fact is a gap in `docs/migration/` or in this
  design, and is resolved there.

## 6. Repository architecture

```text
developer-os/
├── apps/
│   └── cli/
├── packages/
│   ├── core/
│   ├── brain/
│   ├── security/
│   ├── workflow-schema/
│   ├── adapter-claude/
│   ├── adapter-codex/
│   └── platform-macos/
├── workflows/
│   ├── brain-search/
│   ├── capture/
│   ├── ingest/
│   ├── review/
│   ├── doctor/
│   └── shared/
├── plugins/
│   ├── claude/
│   └── codex/
├── templates/
│   └── brain/
├── tests/
│   ├── contracts/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
└── docs/
```

The monorepo uses pnpm workspaces, TypeScript in strict mode, and Vitest. Shell
code is restricted to thin operating-system or vendor launch adapters. Core
filesystem, configuration, transaction, validation, and rendering logic lives in
typed packages.

### 6.1 `apps/cli`

Owns argument parsing, interactive prompts, human and JSON output, exit codes, and
command orchestration. It depends on package interfaces and contains no vendor-
specific implementation logic.

### 6.2 `packages/core`

Owns configuration loading, path resolution, installation manifests, filesystem
transactions, ownership checks, backup/restore, migration orchestration, and
shared error types.

### 6.3 `packages/brain`

Owns the vault schema, note discovery, deterministic indexes, graph construction,
linting, capture envelopes, staging, migration, provenance, confidence scoring,
and index-first retrieval.

### 6.4 `packages/security`

Owns secret-file policy, content redaction, entropy checks, command and path
normalization, safe process spawning, log scrubbing, and security diagnostics.

### 6.5 `packages/workflow-schema`

Owns the versioned workflow contract, validation, canonical loader, renderer
inputs, capability requirements, and generated-artifact drift checks.

### 6.6 Agent adapters

`adapter-claude` and `adapter-codex` each own:

- platform discovery and version detection;
- capability detection;
- plugin and durable-instruction rendering;
- hook installation and invocation contracts;
- invocation of the installed agent CLI;
- adapter-specific contract tests and fixtures.

Adapters do not duplicate Brain logic or workflow business rules.

### 6.7 `packages/platform-macos`

Owns macOS paths, permissions, process checks, `launchd` plist generation,
installation status, and scheduler lifecycle. It exposes an interface that can be
implemented for Linux later without changing core or Brain packages.

## 7. Runtime layout

The default product home is:

```text
~/.developer-os/
├── config.toml
├── installation-manifest.json
├── state/
├── staging/
├── backups/
└── logs/
```

The interactive initializer proposes `~/DeveloperBrain` as the vault path. The
user may select an existing compatible vault, including `~/brain`.

Supported overrides:

- `DEVELOPER_OS_HOME` changes the product-state root.
- `DEVELOPER_OS_BRAIN` changes the active vault path.

State and Brain directories are distinct. A vault backup may be stored below the
product home, but no product manifest, log, or installer state is written into the
Obsidian content tree. Initialization resolves symlinks and rejects any layout in
which the product home contains the Brain, the Brain contains the product home,
or both paths resolve to the same directory.

## 8. CLI contract

> **Amended since approval — read this before treating the block below as the contract.**
> The command list and the flag list are the 2026-07-21 approved design; three things have
> changed and the index of all of them is `BACKLOG.md` §8.
>
> 1. **A `brain` group is added** — `brain reindex|lint|search|status` — and `search`
>    becomes an alias for `brain search`. Amended 2026-08-04 by
>    `specs/2026-07-21-developer-os-brain-engine-design.md` §11; not yet built (its plan's
>    Task 9).
> 2. **`--verbose` is not implemented anywhere**, and dispatch is strict, so passing it
>    exits 2. It belongs to the first subsystem with diagnostics worth printing. See
>    `docs/architecture/foundation.md` §7.
> 3. **`repair` is a mutating command that takes neither `--dry-run` nor `--yes`**; it takes
>    an explicit `--resume` or `--rollback` against a named transaction id instead. The
>    "every mutating command" sentence below describes the plan-producing commands.

```text
developer-os init
developer-os status
developer-os doctor
developer-os capture
developer-os review
developer-os ingest
developer-os search
developer-os automation enable|disable|status
developer-os git enable|disable|sync
developer-os update
developer-os repair
developer-os uninstall
```

Every mutating command supports:

- `--dry-run` to show the exact plan without changing state;
- `--json` for stable machine-readable results;
- `--yes` to accept ordinary confirmations;
- `--verbose` for redacted diagnostics.

`--yes` never bypasses a security refusal, unresolved configuration conflict,
failed validator, missing backup, or irreversible migration approval.

Stable exit-code classes:

| Code | Meaning |
|---:|---|
| 0 | Success |
| 1 | Operational or validation failure |
| 2 | Invalid command, input, or configuration |
| 3 | User decision or conflict resolution required |
| 4 | Required adapter capability unavailable |
| 5 | Security policy refusal |
| 6 | Incomplete transaction requires recovery |

Human output explains the next safe action. JSON output contains a stable error
code, message, affected paths, recovery command where applicable, and no secret
values.

## 9. Configuration and file ownership

### 9.1 Initialization

`developer-os init`:

1. detects macOS version, architecture, installed agent CLIs, and versions;
2. asks which adapters to enable;
3. asks for the Brain path or creates the template;
4. computes a complete change plan;
5. shows the plan and required permissions;
6. backs up every existing file that will change;
7. installs only selected managed artifacts;
8. writes the installation manifest;
9. runs `developer-os doctor`;
10. rolls back if post-install verification fails.

Re-running `init` with the same inputs is idempotent.

> **What Foundation actually shipped, for steps 2, 3 and 9.** Recorded here so a reader of
> this section alone is not misled; full reasoning in `docs/architecture/foundation.md` §5
> and §7, index in `BACKLOG.md` §8.
>
> - **Steps 2 and 3 ask nothing.** Foundation writes both adapters `false` and takes the
>   vault path from `DEVELOPER_OS_BRAIN`, then `config.brainPath`, then the `~/DeveloperBrain`
>   default. Adapter selection arrives with DOS-P4 and DOS-P5. Template installation arrives
>   with DOS-P2, and only when `init` is the thing that creates the vault — Foundation
>   creates a directory and one `.gitkeep`, and never modifies a vault that already exists.
> - **Step 9 runs a subset, deliberately.** The post-install gate is the five checks in
>   `INIT_OWNED_CHECKS` — `product-home`, `configuration`, `manifest`, `drift`, `brain` — not
>   the whole report. Gating on the whole report reverted two good installs, once for a stale
>   journal from an unrelated interrupted run and once for agent discovery. Adding an id to
>   that set asserts that its failure means the *installation* is broken.

### 9.2 Managed artifacts

Developer OS does not own all of `~/.claude` or `~/.codex`. The installation
manifest records, for each managed artifact:

- logical owner and adapter;
- absolute path;
- artifact kind;
- installed product version;
- pre-install existence and backup location;
- installed content hash;
- source template or renderer;
- merge strategy;
- last successful verification.

Dedicated files and official plugin packaging are preferred. Where a vendor
requires editing shared JSON or TOML, Developer OS performs a semantic merge and
stores enough baseline data for a three-way update.

### 9.3 Drift

If a managed file differs from its recorded hash, update stops before mutation
and reports a three-way diff: installed baseline, current user state, and proposed
version. The user may preserve their state, accept the new version, or resolve the
conflict manually. Developer OS does not silently choose.

> **What Foundation shipped, and what is still owed.** Foundation Task 6 built the *evidence*
> and deferred the *diff*: `buildConflictEvidence` records all three hashes — installed
> baseline, current, proposed — but the rendered diff is current-versus-proposed only. The
> three-way rendering this section describes is deferred to DOS-P4/DOS-P5, whose semantic
> config merge is its first consumer; nothing calls `buildConflictEvidence` today. The
> refusal-before-mutation half is shipped and is not deferred: any drift finding stops `init`
> and `uninstall`. Detail in `docs/architecture/foundation-constraints.md` Task 6; index in
> `docs/superpowers/BACKLOG.md` §8.

### 9.4 Uninstall

`uninstall` removes only artifacts owned by the manifest and restores pre-install
shared configuration where safe. It never removes the Brain, user-created notes,
unrelated configuration, transaction backups, or Git history. Backup cleanup is a
separate explicit operation outside version 1's automatic lifecycle.

## 10. Workflow contract and generation

Each canonical workflow contains:

- a stable identifier and semantic version;
- human description and trigger conditions;
- required inputs and optional inputs;
- declared read and write scopes;
- required adapter capabilities;
- deterministic preconditions and refusals;
- ordered workflow steps;
- expected structured result;
- validators and recovery behavior;
- Claude-specific and Codex-specific overlays where needed.

The shared contract describes outcomes, invariants, and data boundaries. It does
not force identical prompt syntax or lifecycle events across vendors.

Generated Claude and Codex artifacts are reproducible. CI regenerates them and
fails if the checked-in plugin output differs. Generated files contain a source
marker and are never edited as canonical source.

## 11. Capability model

Capabilities are detected from the installed agent version and verified surface,
not assumed from the adapter name. Example capability keys include:

- `skills`;
- `durable_project_guidance`;
- `session_start_injection`;
- `session_end_capture`;
- `pre_compact_backup`;
- `subagents`;
- `plugin_hooks`;
- `non_interactive_run`;
- `structured_result`.

`doctor` prints a matrix for the detected environment. A workflow whose required
capability is absent exits with code 4 and a supported fallback, if one exists.

Automatic capture may use a documented lifecycle hook or the controlled
`developer-os run claude|codex` wrapper. Developer OS does not parse unstable raw
transcript formats. If direct invocation cannot satisfy the capture contract,
`doctor` reports that wrapper use is required.

## 12. Brain layout and compatibility

New vaults use English topic folders and private operational folders:

```text
DeveloperBrain/
├── content/
│   ├── PROJECTS/
│   ├── TOOLS/
│   ├── DEV/
│   ├── INFRA/
│   ├── QA/
│   ├── _raw/
│   │   ├── quarantine/
│   │   ├── inbox/
│   │   └── processed/
│   ├── _indexes/
│   ├── _outputs/
│   ├── _graveyard/
│   └── templates/
└── .obsidian/
```

Legacy folder names such as `PROJEKTY` and `NARZEDZIA` are supported through
configured topic aliases. Migration never renames existing folders automatically.
New users receive only synthetic examples with no founder or client data.

The vault remains ordinary Markdown and can be opened, edited, copied, or synced
without Developer OS. Generated indexes are navigation artifacts, not the source
of truth.

## 13. Knowledge lifecycle

```text
agent session
  -> adapter
  -> deterministic redaction
  -> private quarantine
  -> user review
  -> agent-assisted staging
  -> deterministic validation
  -> transactional apply
  -> index rebuild
  -> retrieval in later sessions
```

### 13.1 Capture envelope

Each capture has a versioned envelope containing:

- capture ID and schema version;
- source agent and detected version;
- capture method;
- source session identity when the adapter exposes one stably;
- project slug and working directory fingerprint;
- creation timestamp;
- redacted normalized content;
- deduplication hash computed after redaction;
- lifecycle status;
- redaction summary containing classes and fingerprints only.

Allowed statuses are `quarantined`, `accepted`, `rejected`, `staging`,
`ingested`, and `failed`. Transitions are explicit and journaled.

### 13.2 Redaction order

Redaction occurs before truncation, persistence, logging, hashing, or model input.
Complete secret values never appear in reports. A finding records only class,
source path or field, location where safe, and a non-reversible fingerprint.

### 13.3 Review

`developer-os review` lists local quarantined items and permits accept, edit, or
reject. Rejection does not delete the source automatically; it changes status so
the user can make a separate retention decision.

### 13.4 Ingest transaction

Accepted captures are sent to the selected installed agent CLI with an explicit
data boundary and write scope. The agent produces a structured change manifest in
the transaction staging directory. It cannot write directly to the canonical
vault during proposal generation.

**Amended by the knowledge-pipeline spec §6.3, ratified 2026-08-13, discharged by DOS-P6 Task 12.**
"The staged result" is not what the `deterministic reindex` validator runs over: it runs over an
**in-memory projection** of the vault plus the proposal, because nothing is staged at the point this
paragraph names — this section and the knowledge-pipeline spec's own §6.3 preamble contradicted each
other on that. Staging first was rejected rather than merely avoided: it would make every file in
staging attacker-influenced content that the validators would have to re-read as hostile. The rest of
the list below is unchanged. `BACKLOG.md` §8 carries the row.

The staged result must pass:

- schema and frontmatter validation;
- source and provenance validation;
- link and graph validation;
- duplicate detection;
- confidence and lifecycle policy;
- secret scan;
- deterministic reindex;
- generated-output consistency;
- write-scope enforcement.

Only a green staged result is applied. The apply phase uses a transaction journal,
per-file backups, atomic file replacement, and post-apply verification. A failure
before finalization leaves the capture recoverable and causes `doctor` to expose
resume or rollback commands.

### 13.5 Retrieval

Retrieval is read-only and index-first:

```text
vault-map -> relevant catalog section -> selected notes -> sourced answer
```

Session-start injection is deliberately small: vault map plus an exact matching
project note when available. Full retrieval runs through the `brain-search`
workflow. Raw archives and quarantine are excluded from retrieval indexes.

## 14. Security and privacy

### 14.1 Untrusted inputs

Developer OS treats session content, repository files, inbox sources, model
output, existing configuration, paths, symlinks, and plugin metadata as untrusted.
Model output is a proposal, never proof of safety.

### 14.2 Network boundary

Version 1 has no telemetry. Network access occurs only through a user-invoked or
explicitly scheduled operation:

- product update against the configured release source;
- optional Git synchronization;
- the selected agent CLI performing an approved workflow.

No note content is sent to a Developer OS service because no such service exists.

### 14.3 Secret and protected-file policy

The default deny policy covers environment files, private keys, certificates,
credential stores, provider tokens, common service credentials, high-entropy
values, and user-configured patterns. Protected paths are rejected before file
read. Redaction uses deterministic patterns plus entropy checks and is tested
against multiline and encoded fixtures.

### 14.4 Safe process execution

Core spawns a validated executable with an argument array. It never concatenates
untrusted input into a shell command. Guards normalize newlines and carriage
returns, resolve real paths, reject path traversal, verify symlink targets, and
use explicit owned path lists instead of broad globs.

### 14.5 Prompt injection

Captured material is marked as data. Ingest instructions forbid executing source
instructions, following source-provided URLs, widening file access, or writing
outside staging. Deterministic write-scope and manifest validators enforce that
boundary after the model returns.

### 14.6 Git safety

Git is disabled until explicitly configured. Developer OS stages only transaction-
owned paths and never runs `git add -A`. A secret scan runs before commit. Push is
a separate status and a push failure cannot be reported as synchronization
success. Automatic push requires an additional scheduler opt-in.

## 15. Transaction and recovery model

Every mutation follows:

```text
plan -> backup -> stage -> validate -> apply -> verify -> finalize
```

The journal records state transitions atomically. Before `finalize`, an interrupted
transaction is incomplete rather than successful. `doctor` returns code 6 and
offers:

```text
developer-os repair --resume <transaction-id>
developer-os repair --rollback <transaction-id>
```

Recovery does not require Git. Rollback restores the exact pre-transaction bytes
for owned files and reports any concurrent user edit instead of overwriting it.

## 16. Optional Git and automation

### 16.1 Git

`developer-os git enable` initializes or connects a private repository only after
showing the affected paths and ignore policy. Developer OS can work permanently
without Git.

### 16.2 Automation

`developer-os automation enable` shows the exact `launchd` jobs and schedules
before installation. Jobs invoke normal CLI commands and inherit the same locking,
validation, redaction, and transaction behavior as manual runs.

The initial recommended jobs are:

- local inbox health and deterministic index validation;
- an optional review reminder/status record;
- optional ingest only for already accepted items;
- optional Git sync as a separate explicit choice.

Disabling automation removes only Developer OS-owned jobs.

## 17. Testing strategy

### 17.1 Unit tests

Cover path resolution, configuration parsing, redaction, hashing, schema parsing,
indexing, graph construction, merge behavior, manifests, transactions, and error
serialization.

### 17.2 Contract tests

Every workflow and adapter has fixtures for valid input, missing capability,
security refusal, agent failure, malformed structured output, validator failure,
and recovery. Generated plugin outputs have golden tests and idempotence checks.

### 17.3 Integration tests

Use fake Claude and Codex executables to verify exact argv, stdin, environment,
exit-code, and hook contracts. Use temporary Git repositories and bare remotes for
commit/push lifecycle tests. Tests never touch a real remote or credential.

### 17.4 End-to-end tests

Every E2E test runs with a temporary `HOME`, product home, Brain, agent config,
and scheduler directory. The primary lifecycle is:

```text
init -> doctor -> capture -> review -> ingest -> search
     -> update -> repair -> uninstall
```

The test asserts file bytes, ownership manifest, transaction state, vault indexes,
logs, backups, process invocations, and absence of unexpected network calls.

### 17.5 Security cases

**Narrowed by the knowledge-pipeline spec §9, ratified 2026-08-13, discharged by DOS-P6 Task 15 —
and the narrowing was not taken.** §9 reduced this list to six suites and dropped two that `BACKLOG.md`
§7's standing gate still requires from DOS-P6 onward: **attempted implicit network access** and
**concurrent user edits**. The plan registered the narrowing rather than inheriting it and shipped
**eight** suites, so both dropped cases are covered: `tests/security/` carries `sentinel`,
`prompt-injection`, `symlink-escape`, `multiline-command`, `malformed-manifest` and `interruption`
from §9, plus `network` and `concurrent-edit`. This list therefore stands as written. `BACKLOG.md` §8
carries the row.

The suite includes:

- secrets before and after truncation;
- multiline command bypasses such as `curl ... |\nsh`;
- paths with spaces and metacharacters;
- symlinks escaping the vault;
- malicious instructions in captured data;
- interruption at every transaction phase;
- concurrent user edits;
- forged or stale installation manifests;
- secret leakage into logs, JSON output, staging, or agent input;
- attempted implicit network access;
- unsafe broad Git staging.

Release is blocked if a sentinel secret appears in any produced artifact.

### 17.6 Real-agent compatibility

A separate opt-in matrix runs against supported installed Claude Code and Codex
versions on a disposable fixture account. It verifies discovery, plugin loading,
workflow invocation, hooks, structured output, and declared capability fallbacks.
This suite complements deterministic stubs; it does not replace them.

## 18. Migration from the current system

### Phase 0 — preserve and classify

1. Preserve both current working trees without staging or cleanup.
2. Classify every changed path as existing user work, migration candidate,
   generated output, deliberate deletion, or excluded private material.
3. Resolve the open historical-secret triage before any public code publication.
4. Produce a redacted source manifest for migration.
5. Record baseline behavior and validation evidence.

### Phase 1 — public foundation

Create the clean repository, monorepo tooling, core types, CLI shell, security
primitives, transactions, and `init/status/doctor/uninstall`. No legacy Git
history is imported.

### Phase 2 — Brain engine

Migrate deterministic vault code, schemas, fixtures, indexes, lint, and retrieval.
Use only synthetic public content. Add legacy folder aliases and prove read-only
compatibility with a redacted structural fixture of the founder's vault.

### Phase 3 — workflow compiler

Define canonical workflow contracts, renderers, generated plugins, capability
checks, and drift validation.

### Phase 4 — Claude adapter

Implement discovery, plugin, hooks, wrapper, capture, agent invocation, and full
knowledge lifecycle tests for Claude Code.

### Phase 5 — Codex adapter

Implement the corresponding Codex surfaces, wrapper fallback, capability matrix,
and the same lifecycle contract without undocumented transcript parsing.

### Phase 6 — user lifecycle

Implement update, repair, schema migration, optional Git, optional `launchd`,
release checks, and rollback.

### Phase 7 — founder shadow migration

1. Point Developer OS at the existing `~/brain` in read-only diagnostic mode.
2. Run new capture into an isolated queue.
3. Compare old and new pipeline outputs.
4. Cut over one agent adapter.
5. Complete one full capture/ingest/retrieval cycle.
6. Cut over the second adapter.
7. Disable legacy hooks and automation only after parity evidence passes.
8. Keep rollback manifests through the first stable release cycle.
9. Archive `claude-shared` only after the complete lifecycle and rollback are
   independently verified.

## 19. Release and distribution

The repository starts private while sensitive-source audits and license review are
open. Public history begins with audited Developer OS commits, not imported legacy
history.

Version 1 publishes self-contained macOS artifacts for Apple Silicon and Intel in
GitHub Releases. Each release includes SHA-256 checksums, an SBOM, changelog,
schema version, supported-agent matrix, and rollback instructions. A Homebrew tap
is the primary public installer after beta; manual verified release installation
remains supported.

The source remains a pnpm/TypeScript monorepo. Version 1 release artifacts bundle
the Node runtime so end users do not need a separate Node installation. Packaging
must not change CLI behavior, configuration paths, or transaction guarantees.

Semantic versioning applies to the product. Brain schema and workflow schema have
independent integer versions recorded in configuration and artifacts. A release
that requires a schema migration includes a dry-run migrator and rollback fixture.

## 20. Version 1 acceptance criteria

A new macOS user can:

1. install a verified Developer OS artifact;
2. initialize Claude Code, Codex, or both;
3. create or select a private Obsidian vault;
4. open the vault normally in Obsidian;
5. capture a session into redacted quarantine;
6. review and accept the capture;
7. ingest it through the selected agent CLI;
8. retrieve the resulting sourced knowledge in a later session;
9. run `doctor` and receive accurate capability and health results;
10. update the product without modifying unrelated config or notes;
11. repair an interrupted transaction without Git;
12. uninstall the product without losing the Brain.

Release is blocked by any of the following:

- a secret in a persisted artifact or agent input;
- implicit telemetry or unexpected network access;
- vault corruption or an unrecoverable interrupted transaction;
- silent configuration overwrite;
- undocumented capability assumptions;
- non-idempotent initialization;
- an adapter difference hidden from the capability matrix;
- unresolved historical-secret publication risk;
- missing legal approval for the selected open-source license.

## 21. Delivery decomposition

The scope is too large for one implementation plan. It is delivered as seven
independent subprojects, each with its own design, plan, verification, fresh-context
review, and deployable checkpoint:

1. Public foundation and CLI lifecycle.
2. Brain engine and synthetic vault template.
3. Workflow schema, compiler, and generated plugins.
4. Claude Code adapter.
5. Codex adapter.
6. Capture, review, ingest, security, and recovery hardening.
7. Founder migration, distribution, documentation, and public release.

The umbrella implementation plan defines dependencies and release gates. Detailed
implementation begins with subproject 1 only; later subprojects receive their own
specification before code changes.

## 22. Primary risks and mitigations

| Risk | Mitigation |
|---|---|
| Claude/Codex lifecycle surfaces change | Capability detection, adapter contract tests, supported-version matrix |
| Users confuse plugin parity with behavior parity | Vendor-neutral outcome contract plus explicit adapter overlays |
| Captures leak secrets | Protected-path gate, redact-before-write/model, sentinel tests |
| Model output corrupts canonical knowledge | Staging-only generation, deterministic validation, transaction rollback |
| Public repository exposes private history | Clean history and audited migration manifests only |
| Product update overwrites user config | Ownership manifest, backups, semantic merge, three-way conflict stop |
| Brain becomes coupled to Developer OS | Plain Markdown, no proprietary storage, generated indexes remain disposable |
| Git or scheduler creates hidden side effects | Both disabled by default and enabled through separate explicit commands |
| Scope expands into a desktop/cloud platform | Version 1 non-goals and subproject release gates |

## 23. Documentation references

- OpenAI, Codex customization: <https://developers.openai.com/codex/concepts/customization>
- OpenAI, building plugins: <https://developers.openai.com/codex/plugins/build>
- Anthropic, Claude Code plugins: <https://code.claude.com/docs/en/plugins>
- Anthropic, Claude Code extension surfaces: <https://code.claude.com/docs/en/features-overview>
- Frozen legacy behavior: `docs/migration/baseline-capabilities.json`
- Frozen source classification: `docs/migration/source-manifest.json`
- Publication boundary: `docs/migration/exclusion-policy.md`
- Cutover preconditions: `docs/superpowers/plans/legacy-runtime/2026-07-20-brain-claude-shared-follow-up.md`
  — **corrected 2026-08-10, and registered in `BACKLOG.md` §8:** those preconditions closed,
  that document is deleted, and `BACKLOG.md` §6 is the record in its place. The path is left
  written above because it is what this approved list said; the correction is the line you are
  reading, not a rewrite of the line above it.

The former entries for `~/claude-shared/README.md` and `~/brain/AGENTS.md` were
removed on 2026-07-27. Neither was a publication candidate under
`docs/migration/source-manifest.json`, so citing them as references contradicted
this product's own exclusion policy. Their product-relevant substance is
`baseline-capabilities.json`.
