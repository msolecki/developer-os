# Developer OS — Codex Adapter Design

**Status: awaiting founder approval.** Written 2026-08-11 for `ORDER.md` entry A9, program plan
Task 5, DOS-P5. Not approved, therefore not implementable: an approved spec precedes the
implementation plan, and the plan precedes code, which is a Global Constraint of the program plan
rather than a preference.

**Design inputs, all inside this repository:** the product design spec §6.6, §8, §10, §11, §14 and
§17; `docs/architecture/workflow-schema.md` §6, §7 and §8, whose debts name DOS-P5 alongside
DOS-P4; `docs/architecture/foundation.md` for the mutation pipeline and the manifest;
`specs/2026-07-21-developer-os-claude-adapter-design.md`, approved 2026-08-11, because the two
adapters must be consumable by one subsystem; and `docs/migration/baseline-capabilities.json` as
the only admissible statement about what the founder's legacy runtime did.

**There is no legacy Codex implementation to compare against, and this spec must not plan to
observe one.** The founder's legacy runtime removed its Codex parity layer on 2026-07-27, after
`baseline-capabilities.json` froze that surface on 2026-07-21. The frozen record is the only
admissible statement about it, and what that record says about capture is `false`.

**§14 is normative**, and it is where every external fact lives, each with the source it came from
and the date it was read. An implementation may not depend on a Codex surface that is not listed
there or added there by amendment.

---

## 1. What this subsystem is

`packages/adapter-codex` turns an already-validated `WorkflowContractV1` into a Codex plugin, and
invokes Codex safely on behalf of a workflow. It is the second implementation of the
`WorkflowRenderer` interface DOS-P3 defined.

It is optional and independent. A user may install Codex, Claude Code, both, or neither. Nothing in
this package may import `packages/adapter-claude`, and nothing in that package may import this one —
the two are peers, and the moment one depends on the other, a Codex-only install carries Claude
code.

## 2. What it does not do, on purpose

1. **It does not validate workflows.** `validateWorkflow` is the only door into
   `packages/workflow-schema`.
2. **It does not touch the vault.** Every Brain read or write goes through `BrainService`.
3. **It does not spawn a process itself.** Execution goes through `packages/security`'s runner.
4. **It does not parse transcripts.** Product spec §11 refuses unstable raw transcript formats, and
   `baseline-capabilities.json` records `reliableTranscriptCaptureParity: false` for the legacy
   runtime — the one measured statement anyone has ever made about this, and it is negative. Codex
   puts `transcript_path` in every hook payload (§14.2), so the file is one `readFile` away at all
   times. **The refusal may be lifted only by an amendment to this spec that names a stable,
   documented contract and lands a regression fixture in the same change** — `BACKLOG.md` §3's
   requirement, restated here as the rule it is.
5. **It does not edit `~/.codex/config.toml`.** See §4.
6. **It does not bypass a vendor safety gate.** `--dangerously-bypass-approvals-and-sandbox`,
   `--dangerously-bypass-hook-trust` and `--ignore-user-config` are refused on every path (§7.2).
7. **It makes no model API call.** The installed agent CLI is the only path to a model.

## 3. The decisions this spec makes

`BACKLOG.md` §3 lists three things this spec must decide. Each has a section, and two more
decisions were taken during the brainstorming cycle:

| Decision | Section |
|---|---|
| exactly which Codex surfaces are supported, against current documentation **and** local behavior | §14 |
| how canonical workflows render into Codex skills and `AGENTS.md` guidance at the smallest appropriate scope | §6 |
| the transcript-parsing refusal rule | §2.4 |
| who writes into `~/.codex/`, and how install is reversed | §4 |
| how capture works given the hook trust gate | §5.3 |

## 4. Install shape — a local marketplace, installed by Codex's own CLI

**Decided 2026-08-11 by the founder.** Codex has no in-place plugin discovery equivalent to the
mechanism DOS-P4 uses. It has a marketplace, and a marketplace may be **local** (§14.4), which
resolves an installed plugin to its real on-disk path rather than to a cache copy — the property
that decided DOS-P4, reached by a different route.

We generate one tree, under the product home:

```text
<product-home>/codex/
├── .agents/plugins/marketplace.json
└── plugins/developer-os/
    ├── .codex-plugin/plugin.json
    ├── skills/
    │   ├── developer-os-shared/SKILL.md
    │   ├── developer-os-capture/SKILL.md
    │   ├── developer-os-review/SKILL.md
    │   ├── developer-os-ingest/SKILL.md
    │   ├── developer-os-brain-search/SKILL.md
    │   └── developer-os-doctor/SKILL.md
    └── hooks/hooks.json
```

### 4.1 Codex's CLI is the only writer of Codex's config

`init` runs, through the security runner and behind explicit consent:

```text
codex plugin marketplace add developer-os <product-home>/codex
codex plugin add developer-os@developer-os --json
```

**We never parse, edit, or merge `~/.codex/config.toml`.** The vendor's tool owns the vendor's
config, which is the same principle that kept DOS-P4 out of `settings.json` — reached there by
writing nothing, and here by delegating the write. A hand-rolled TOML merge against a file whose
schema we do not own is a drift generator, and `--strict-config` exists precisely because that
file's recognized fields change between versions (§14.4).

### 4.2 Uninstall

```text
codex plugin remove developer-os
codex plugin marketplace remove developer-os
```

then delete `<product-home>/codex/`. Failure of either CLI step is reported and does **not** delete
our tree — leaving a registered marketplace pointing at a directory we removed is a worse state
than leaving both.

### 4.3 This is the semantic config merge, and it is still not a three-way diff

`BACKLOG.md` §2 records `buildConflictEvidence` as built for a merge that DOS-P4 dissolved, and
asks whether DOS-P5 needs the three-way form. **It does not.** Delegating to `codex plugin add`
means no foreign file is merged here either. Conflict evidence is still produced for our own
managed tree, where a user edit can collide with a regenerated artifact.

`buildConflictEvidence` therefore has **no consumer in either adapter**. That is now a finding
rather than a pending question: it was built for a design both adapters declined, and whether it is
retained, consumed by DOS-P7, or deleted is a decision for the first subsystem that has a real
three-way merge. Amends `BACKLOG.md` §2 a second time; registered in `BACKLOG.md` §8.

## 5. Capability model

The three values, the vocabulary and the asymmetry are DOS-P4 §5's, unchanged: `yes` requires the
version table to permit **and** a probe to observe; `unknown` is never `yes`; every uncertain state
degrades toward the wrapper. Sharing this model between adapters is deliberate — DOS-P6 consumes
both, and two capability vocabularies would make its own contract a translation layer.

### 5.1 Supported-version discovery

`codex --version` establishes the version. `baseline-capabilities.json` records `0.144.6` as of
2026-07-21; the machine this spec was written against reports `0.147.0` (§14.1). **Neither is a
supported-version floor** — the frozen record is a historical observation, and one local machine is
not a range. The floor is established by probe and recorded when the integration test first runs
(§15.1).

### 5.2 The probe is better here than it is for Claude

`codex plugin list --json` reports installed plugins with their status and resolved path (§14.4),
which settles three things in one call: whether our plugin is installed, whether it is enabled, and
whether the path it resolves to is the tree we own. DOS-P4 needed a separate settings read to
distinguish presence from enablement; here it is one structured result.

### 5.3 Capture, and the trust gate

**Decided 2026-08-11 by the founder: ship hooks, and report `wrapper-required` until one is
observed firing.**

Codex holds a non-managed command hook inert until the user reviews and trusts it (§14.2). So a
freshly installed plugin has hooks present and not running, and the honest report for
`session_end_capture` at that moment is `wrapper-required`. It is not a degraded state: capture
works through `developer-os run codex`, which needs no trust at all. `doctor` prints the exact
command that grants trust, and the capability becomes `yes` only when a hook is observed firing.

This is what makes `BACKLOG.md` §3's "direct and wrapper capability matrices are tested separately"
a real requirement rather than a formality — there are genuinely two matrices, and the platform,
not this design, is what creates the second one.

**The managed-hook bypass is refused.** `requirements.toml` would let our hooks skip the trust
prompt (§14.2). Routing around a consent gate the vendor placed deliberately is the wrong default
for a product whose pitch is that it does not surprise you, and it is the shape SEC-105 was written
about. Not offered, not configurable, not in v1.

### 5.4 The capability keys

Product spec §11's keys, resolved against §14:

| Key | Surface | Probe |
|---|---|---|
| `skills` | `skills/<name>/SKILL.md` in the plugin | `codex plugin list --json` |
| `plugin_hooks` | plugin-bundled `hooks/hooks.json` | §15.1 — settled by integration test |
| `session_start_injection` | `SessionStart` hook | observed firing, else `wrapper-required` |
| `session_end_capture` | `SessionEnd` hook | observed firing, else `wrapper-required` |
| `pre_compact_backup` | `PreCompact` hook | observed firing, else `wrapper-required` |
| `non_interactive_run` | `codex exec` | invocation probe |
| `structured_result` | `codex exec --json`, `--output-schema` | invocation probe |
| `subagents` | `SubagentStart`/`SubagentStop` exist as hook events | not used by this adapter |
| `durable_project_guidance` | `AGENTS.md` | **not used** — see §6.1 |

## 6. Rendering

`CodexRenderer implements WorkflowRenderer`, `vendor = "codex"`. Input is a validated contract plus
its optional Codex overlay; output is `RenderedArtifact[]` carrying DOS-P3's source marker.
Generated files are never edited as canonical source.

Each workflow renders to `skills/developer-os-<id>/SKILL.md` with frontmatter carrying `name` and
`description`, which are the two required fields (§14.3).

### 6.1 The `shared` preamble, and why no `AGENTS.md` is written

**Decided 2026-08-11 by the founder: concatenate into each `SKILL.md`, and write no `AGENTS.md` at
any scope.** Symmetric with DOS-P4 §7.1, for the same reason: the defence is physically present in
every artifact, so no load order, scope resolution or user edit can remove it.

`BACKLOG.md` §3 asks for "`AGENTS.md` guidance at the smallest appropriate scope", and the honest
answer is that the smallest appropriate scope turned out to be **inside the skill itself**. Stated
plainly rather than presented as compliance with the phrase.

**`AGENTS.override.md` is never written, at any scope, for any reason.** In the global scope Codex
reads `AGENTS.override.md` *instead of* `AGENTS.md` when it exists (§14.5), so creating it would
silently suppress the user's own instructions. This is the single most destructive thing this
adapter could do to a user's configuration and it is worth naming as a refusal rather than an
omission.

### 6.2 `recovery.resume` is inert text

DOS-P4 §7.2 applies unchanged, and the reason is the compiler's, not either adapter's:
`workflow-schema.md` §8.7 records that contract fields pass through unscreened because they are
payload, so the first surface to display one owns screening it. The renderer emits it fenced,
marked as text to read rather than run, screened through `packages/security`, and never into
`hooks.json` or any command position.

### 6.3 Byte-identity — the other half of DOS-P3's debt

`workflow-schema.md` §6 assigned the byte-identity of real vendor artifacts to DOS-P4 **and**
DOS-P5. This spec accepts DOS-P5's half: render all six twice, render under a reversed directory
reader, assert byte equality both times, and regenerate `plugins/codex/` in CI and fail on any
diff. Sorting is by code point and normalization precedes de-duplication, inherited from DOS-P3.

## 7. Invocation

`CodexInvocation` executes `codex exec` through the security runner: argv array never a shell
string, bounded stdin, explicit timeout, explicit kill signal, structured result validated before
any consumer sees it.

```text
codex exec --json --output-schema <schema-file> -s <sandbox> [--add-dir <dir>]... \
           --skip-git-repo-check -C <working-root> <prompt>
```

`--output-schema` constrains the model's final response to a JSON Schema we supply (§14.1), which
is strictly stronger than validating whatever came back. We do both: constrain, then validate.

### 7.1 Declared scopes become the sandbox

This is DOS-P4 §8's `--allowedTools` argument, in Codex's vocabulary:

| Workflow declares | Sandbox |
|---|---|
| no write scope | `read-only` |
| one or more write scopes | `workspace-write`, plus `--add-dir` naming exactly those scopes |
| — | `danger-full-access` is **never** passed |

Defence in depth, not a replacement: `workflow-schema.md` §8.6 records that `steps[].with` sits
outside the scope guarantee entirely, which is why §7.3 exists.

### 7.2 Three flags that are refused, permanently

| Flag | Why |
|---|---|
| `--dangerously-bypass-approvals-and-sandbox` | removes the sandbox §7.1 depends on |
| `--dangerously-bypass-hook-trust` | forges the user consent §5.3 is built around |
| `--ignore-user-config` | silently discards the user's configuration to make our run predictable, which is the same class of lie as reporting a success that did not happen |

A refusal implemented as "we do not currently pass it" is a convention. These are asserted by test.

### 7.3 `agent.prompt` — the shared hole, closed twice

`workflow-schema.md` §5 assigns `agent.prompt` to the adapters and §8.6 makes whichever adapter
executes a verb the owner of validating its arguments. DOS-P4 §8.1 defined a strict `with` schema —
unknown keys refused, `__proto__` screened before parsing because `zod@4.4.3` strips it first.

**This adapter uses the same schema and must not define a second one.** Two adapters with two
argument schemas for one verb is a workflow that validates against one vendor and not the other,
which is the exact failure the canonical contract exists to prevent. The schema moves to a place
both can reach — `packages/workflow-schema` is wrong (it is the compiler, and it deliberately does
not know what handlers do), so it lives in `packages/core` and both adapters import it. **Amends
DOS-P4's §8.1 placement**; registered in `BACKLOG.md` §8.

## 8. Failure contracts

Foundation's exit codes, unchanged, and identical to DOS-P4 §9 so that DOS-P6 sees one contract:

| Condition | Code |
|---|---|
| required capability unavailable, no fallback | 4 |
| `agent.prompt` arguments fail validation | 5 |
| a screen, redaction or refused-flag violation | 5 |
| drifted managed file in our tree | 3 |
| `codex plugin add` or `marketplace add` fails | 1 |
| malformed structured result, timeout, signal death | 1 |
| unparseable adapter configuration | 2 |

A timed-out invocation is reported as a timeout, never as a malformed result — one is retryable and
the other is a contract violation. A probe that cannot run reports `unknown`, never `no`.

Install follows Foundation's `plan → backup → stage → validate → apply → verify → finalize`. The
two CLI invocations happen in the apply phase and their failure is a transaction failure, recovered
with `developer-os repair --resume|--rollback`.

## 9. Security seams

| Seam | Rule |
|---|---|
| hook payload → log, hash, model | redact before truncating or hashing |
| contract field → rendered artifact | screen at the render seam (§6.2) |
| workflow scopes → invocation | sandbox mode plus `--add-dir` (§7.1) |
| `steps[].with` → handler | the shared strict schema (§7.3) |
| `transcript_path` | never opened (§2.4) |
| `AGENTS.override.md` | never written (§6.1) |
| the three bypass flags | never passed, asserted by test (§7.2) |
| `~/.codex/config.toml` | never read, never written by us (§4.1) |

## 10. Testing

Fake CLI first, disposable real installation second — program plan Task 5.

**Fake CLI** pins argv, stdin bounds, environment, timeout, signal, exit code and malformed output,
with no Codex installed. It also pins the three refused flags by asserting they never appear in any
constructed argv, on any input.

**Disposable real installation** runs against `CODEX_HOME` pointed at a temporary directory, so no
test touches the developer's own `~/.codex`. A test that would mutate a real Codex installation is
a failing test, not a thorough one.

Required cases, from the program plan and `BACKLOG.md` §3:

- Codex artifacts regenerate idempotently and validate against the supported plugin schema;
- **direct and wrapper capability matrices are tested separately** (§5.3);
- a missing capture hook becomes `wrapper-required`, never a false `yes`;
- install, update and uninstall preserve unrelated Codex configuration — asserted by diffing the
  whole temporary `CODEX_HOME` around the operation, not by inspecting the keys we expected to touch;
- a Codex-only user completes the same synthetic Brain outcome contract as a Claude-only user;
- a hostile `with` on `agent.prompt` is refused by the shared schema;
- a `recovery.resume` containing a shell metacharacter renders as inert text.

**Every scan asserts a non-empty set, per scope.**

## 11. Produced interfaces

| Name | Shape |
|---|---|
| `CodexAdapter` | the package's only public door |
| `CodexInstallation` | executable, version, installed, enabled, resolved path |
| `CodexCapabilities` | DOS-P4's `CapabilityState` over §5.4's keys |
| `CodexInvocation` | argv, bounded stdin, timeout, sandbox mode, added directories |
| `CodexRenderer` | `WorkflowRenderer` for Codex |
| managed plan | a Foundation `ChangePlan` over our tree, plus the two CLI steps |
| structured agent-run result | validated, redacted, consumed by DOS-P6 |

Modules, one job each: `discover.ts`, `versions.ts`, `probe.ts`, `capabilities.ts`, `render.ts`,
`plugin.ts`, `marketplace.ts`, `install.ts`, `invoke.ts`, `index.ts`.

## 12. What DOS-P6 inherits from having two adapters

Stated here because DOS-P6 is blocked on both and a difference discovered then is a redesign:

| | Claude | Codex |
|---|---|---|
| discovery | in-place skills-directory plugin | local marketplace, `codex plugin add` |
| who writes vendor config | nobody | Codex's own CLI, delegated |
| hooks active on install | yes | **no — trust gate** |
| enablement source | settings read | `codex plugin list --json` |
| scope enforcement | `--allowedTools` | `--sandbox` plus `--add-dir` |
| structured result | `--output-format json` | `--json` plus `--output-schema` |

The capability vocabulary, the three-value model, the exit codes and the `agent.prompt` argument
schema are **identical by construction**. Everything that differs is a vendor mechanism; nothing
that differs is a contract.

## 13. What DOS-P8 must know

The cutover mutates the founder's live machine, and this adapter is the only one that issues
commands against a vendor CLI. Two consequences: a cutover must not leave a marketplace registered
against a deleted directory (§4.2), and the hook trust gate means **the founder must grant trust
manually once**, which is a step in the cutover runbook rather than something a script can do
honestly.

## 14. Verified surfaces

Every external fact this design depends on. Read 2026-08-11. An implementation may not depend on a
surface absent from this section.

### 14.1 `codex exec`, from the local CLI, version 0.147.0

`codex --version` reports `codex-cli 0.147.0`. Subcommands include `exec`, `plugin`, `mcp`,
`doctor`, `sandbox`, `resume`, `review`. `codex exec` flags used or refused by this design:

- `-s, --sandbox <SANDBOX_MODE>` with `read-only`, `workspace-write`, `danger-full-access`;
- `--add-dir <DIR>`, additional writable directories;
- `-C, --cd <DIR>`, working root;
- `--skip-git-repo-check`, run outside a Git repository;
- `--json`, print events to stdout as JSONL;
- `--output-schema <FILE>`, a JSON Schema for the model's final response;
- `-o, --output-last-message <FILE>`;
- `--ephemeral`, do not persist session files;
- `--strict-config`, error on config fields this version does not recognize;
- refused: `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`,
  `--ignore-user-config`.

### 14.2 Hooks — `https://learn.chatgpt.com/docs/hooks`

- Events: `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `Stop`.
- Configured at `~/.codex/hooks.json` or `~/.codex/config.toml`, `<repo>/.codex/...`, or
  **plugin-bundled `hooks/hooks.json`**.
- Structure: `"hooks": { "EventName": [ { "matcher": ..., "hooks": [...] } ] }`.
- **Only `"type": "command"` handlers execute.** `prompt` and `agent` are parsed and skipped.
- **Non-managed command hooks require user review and trust before execution**, managed by a
  `/hooks` command. Managed hooks from the system or `requirements.toml` bypass this.
  `--dangerously-bypass-hook-trust` bypasses it per invocation.
- Common payload fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`,
  `turn_id`, `permission_mode`.

### 14.3 Skills — `https://learn.chatgpt.com/docs/build-skills`

- A skill is a directory containing `SKILL.md`, optionally `scripts/`, `references/`, `assets/`,
  `agents/openai.yaml`.
- Required frontmatter: `name`, `description`.
- Discovery scopes, in order: `$CWD/.agents/skills`, `$REPO_ROOT/.agents/skills`,
  `$HOME/.agents/skills`, and skills bundled with Codex.
- Invoked explicitly with `$skill` in the CLI, or implicitly by matching `description`.

### 14.4 Plugins and marketplaces, from the local CLI and the vendor's curated snapshot

- `codex plugin add <PLUGIN[@MARKETPLACE]>`, `--marketplace`, `--json`.
- `codex plugin list [--json] [--available]`, reporting plugin, status, version and resolved path.
- `codex plugin marketplace add|list|upgrade|remove`; **`add` accepts a local or Git marketplace**.
- `codex plugin remove` removes an installed plugin from local config and cache.
- A marketplace is `<root>/.agents/plugins/marketplace.json`:
  `{ "name", "interface", "plugins": [ { "name", "source": { "source": "local", "path" }, "policy": { "installation", "authentication" }, "category" } ] }`.
- A plugin manifest is `<plugin>/.codex-plugin/plugin.json`, with `name`, `version`, `description`,
  `author`, `homepage`, `repository`, `license`, `keywords`, `skills` as a path, `apps`,
  `mcpServers`, and an `interface` object.
- Observed: a locally-sourced marketplace resolves installed plugins to their real on-disk path
  rather than to a cache copy.

### 14.5 `AGENTS.md` — `https://developers.openai.com/codex/guides/agents-md`

- Codex reads `AGENTS.md` files before doing any work, building an instruction chain.
- **In the global scope, Codex reads `AGENTS.override.md` if it exists, otherwise `AGENTS.md`.**

## 15. Open items this spec does not close

1. **The plugin-bundled hooks path is documented but unobserved.** §14.2 records
   `hooks/hooks.json` as a discovery location, and the vendor's curated plugin inspected on
   2026-08-11 ships no hooks, so neither the path within a plugin nor a manifest `hooks` key has
   been seen in a real plugin. Settled by the integration test, which then amends §14.4. Until it
   is settled, `plugin_hooks` reports `unknown` — which is what §5's model does with a fact nobody
   has established, and is the correct behaviour rather than a gap.
2. **The supported-version floor is established by probe** (§5.1), recorded when the integration
   test first runs. `0.147.0` is one observation, not a range.
3. **`buildConflictEvidence` has no consumer in either adapter** (§4.3). Whether it is retained,
   taken up by DOS-P7, or deleted is the decision of the first subsystem with a real three-way
   merge. Not DOS-P5's to make, and no longer an open question about DOS-P5.
4. **`subagents` is reported and unused** (§5.4). `SubagentStart`/`SubagentStop` exist; no
   canonical workflow spawns a subagent, and none should until a workflow needs one.
5. **`workflow-schema.md` §7's four under-specified workflows are not widened here.** Only `doctor`
   was ever DOS-P4's; the other three belong to DOS-P6. This adapter renders what the contracts say.
