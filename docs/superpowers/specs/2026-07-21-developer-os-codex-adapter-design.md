# Developer OS — Codex Adapter Design

**Status: approved by the founder 2026-08-11.** Written the same day for `ORDER.md` entry A9,
program plan Task 5, DOS-P5. The implementation plan comes next and code comes after it, which is a
Global Constraint of the program plan rather than a preference. The two amendments this spec makes
to earlier documents are discharged in `BACKLOG.md` §8 rather than pending.

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
    └── hooks/hooks.json  ← aspirational, not shipped — see the note below
```

**Amended 2026-08-12, by the fresh-context review of Task 17.** `hooks/hooks.json` above is
aspirational: `buildPluginTree` (`plugin.ts`) does not emit it, and no step of this plan writes it.
§15 item 1 records why and defers restoring it to DOS-P6; this diagram previously showed it
unmarked, which read as shipped.

### 4.1 Codex's CLI is the only writer of Codex's config

`init` runs, through the security runner and behind explicit consent:

```text
codex plugin marketplace add <product-home>/codex
codex plugin add developer-os@developer-os --json
```

**Corrected 2026-08-12 by Task 17, against a real 0.147.0 binary.** `codex plugin marketplace add`
takes exactly one positional argument — the source path — never a separate marketplace name; the
name is read from `marketplace.json`'s own `name` field (already `developer-os`, via
`renderMarketplace`). The two-argument form this section showed before was never run against a real
installation and the CLI refuses it outright: `error: unexpected argument '<path>' found` (exit 2).
See §14.4 for the rest of what Task 17 observed, including the marketplace document's own required
shape.

**We never parse, edit, or merge `~/.codex/config.toml`.** The vendor's tool owns the vendor's
config, which is the same principle that kept DOS-P4 out of `settings.json` — reached there by
writing nothing, and here by delegating the write. A hand-rolled TOML merge against a file whose
schema we do not own is a drift generator, and `--strict-config` exists precisely because that
file's recognized fields change between versions (§14.4).

### 4.2 Uninstall

```text
codex plugin remove developer-os@developer-os
codex plugin marketplace remove developer-os
```

**Corrected 2026-08-12 by Task 17.** `codex plugin remove <plugin>` with a bare, unqualified plugin
name refuses: `plugin requires --marketplace unless passed as <plugin>@<marketplace>` (exit 1). The
qualified `<plugin>@<marketplace>` form — the same one `plugin add` already uses — is required.
Separately observed and worth recording here: `plugin remove` does **not** verify the plugin was
ever installed under that marketplace; removing a name that was never added still exits 0. A failure
of this specific step therefore cannot be produced by naming the wrong plugin — Task 17's simulated
failure of this uninstall sequence used a wrong *marketplace* name against `plugin marketplace
remove` instead, which does refuse a name nothing registered (exit 1, "marketplace ... is not
configured or installed").

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
2026-07-21; the machine this spec was written against reports `0.147.0` (§14.1). **Neither was a
supported-version floor before Task 17** — the frozen record was a historical observation, and one
local machine was not a range. Task 17 (2026-08-12) ran the integration test against the one Codex
version available on this machine, `0.147.0`, and — after fixing two real install-path bugs the
attempt itself surfaced (§4.1, §4.2, §14.4) — raised `CODEX_MINIMUM_VERSION` to `0.147.0`. Still one
observation, not a range (§15 item 2).

### 5.2 The probe is better here than it is for Claude

`codex plugin list --json` reports installed plugins with an `enabled` field and a resolved path
nested under `source.path` — never a top-level `status` or `path` (§14.4, amended 2026-08-12 by
Task 17 against a real 0.147.0 binary), which settles three things in one call: whether our plugin
is installed, whether it is enabled, and whether the path it resolves to is the tree we own. DOS-P4
needed a separate settings read to distinguish presence from enablement; here it is one structured
result.

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

**Amended 2026-08-12.** `workflow-schema.md` §8.7 carries its own amendment, dated the same day:
the skill body — and the screening seam that goes with it — moved into the compiler's
`renderSkillBody` (`packages/workflow-schema/src/skill.ts`) when the body stopped being vendor
behaviour. `recovery.resume`, along with `id`, `refusals[].message` and `steps[].prose`, is
screened there, before either renderer sees it. `CodexRenderer` must not screen it again — a
second copy of the same seam is the exact duplication this design exists to avoid. What
`CodexRenderer` still screens is only the field it renders itself outside that body:
`description`, in the frontmatter, bounded by the compiler's exported `SKILL_FIELD_CAP` so both
vendor trees truncate a long one at the same place.

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

**DOS-P6 Task 17, 2026-08-15 — first contact with a real `codex exec`, and the JSONL rule is
*partly* settled.** DOS-P5 could not justify a model call and this subsystem could not avoid one; the
founder accepted the spend for this subsystem in principle on 2026-08-13 and authorised this
specific run on 2026-08-15. One run was made against `codex-cli 0.147.0` on macOS,
with the production argv byte for byte and stdin closed. The recording is
`tests/fixtures/codex/observed-exec-stream.jsonl` and `tests/fixtures/codex/README.md` states what was
redacted from it.

**The run ended `turn.failed`: the account's usage limit was exhausted, so no run reached a model
response.** Everything below is therefore an observation of the failure path, and the rule is
**not** promoted to verified.

- **Confirmed — `--json` is JSONL.** Four lines, one JSON object per line, no scalar and no `null`.
  The framing this design assumed is what the binary does.
- **Confirmed — every line carries a discriminating `type`**, answering the second of the two
  questions §10.2 of the knowledge-pipeline spec puts to a real run. The observed vocabulary is
  `thread.started` (with `thread_id`), `turn.started`, `error` (with `message`) and `turn.failed`
  (with `error`).
- **Corrected — the guessed vocabulary was wrong.** `invoke.test.ts`'s synthetic cases used
  `session.created`, `item.completed` and `turn.completed`; none of the three appears. Those cases
  remain valid, because `finalJsonlLine` reads no `type` value at all — they were never evidence
  about the vocabulary, and this fixture is.
- **Still open — whether a successful turn's terminal event is the final response.** This is the
  first of §10.2's two questions and the one that would let the rule be promoted. A failed turn
  cannot answer it. `finalJsonlLine` stays provisional and its docblock says so.
- **Not narrowed, deliberately.** A discriminating field now exists to filter on, and filtering is a
  narrowing this section requires to be proven against a stream where the old rule and the new one
  agree. A failed turn contains no final response for two rules to agree about, so the filter is not
  written.
- **New, and load-bearing — `codex exec` reads stdin when stdin is not a TTY.** It prints
  `Reading additional input from stdin...` to stderr and blocks. The first attempt at this
  observation hung on it. What makes the production call return **with a result** — rather than after
  its `timeoutMs`, which would still fire — is `NodeProcessRunner` closing the pipe through
  `child.stdin.end(request.stdin)`; nothing in the vendor's `--help` says the flagless form waits,
  and `[PROMPT]`'s documentation mentions stdin only for the `-` form.
- **New — the failure path's terminal event is shaped like a result.** The last line that parses to a
  non-null object is `turn.failed`, so `finalJsonlLine` alone would return a vendor error as a
  payload. The `exitCode !== 0` check that precedes it is what prevents that. **The ordering was
  already guarded** by a synthetic non-zero-exit case; what this run adds is the first demonstration,
  against real vendor bytes, of the payload that guard keeps out — a synthetic `{}` cannot show it.

**Owner of the remainder:** one successful `codex exec` completion settles §10.2's first question and
the Codex row of knowledge-pipeline spec §10.3. Registered in `BACKLOG.md` §1 as **NEW-21**.

**NEW-21, 2026-08-20 — the successful turn, and the rule was wrong rather than unverified.** The
account's usage limit had reset. **Five invocations were made** against `codex-cli 0.147.0` on macOS,
four of them with the production argv byte for byte and one adding `--output-last-message` to it,
producing four distinct observations. Every one of them is committed —
this section's own discipline is that an unrecorded observation is an inference, and a change whose
whole finding is that unrecorded inferences shipped two defects cannot rest on one:

| Recording | The invocation | What it is evidence for |
|---|---|---|
| `observed-exec-schema-refusal.jsonl` | the shipped schema, before the fix | the HTTP 400 below. Taken twice — the first was overwritten before it was copied, and the second reproduced it byte for byte bar the thread id |
| `observed-exec-success-stream.jsonl` | `-s read-only`, the typed schema | the terminal-event finding, and the detection row |
| `observed-exec-workspace-write-stream.jsonl` | `-s workspace-write --add-dir` | that the two argv branches produce the identical shape, which is otherwise a claim about half the product |
| `observed-exec-last-message-stream.jsonl`, `observed-exec-last-message.txt` | adding `--output-last-message` | that the declined alternative works, and that it agrees with the stream on the same turn |

`tests/fixtures/codex/README.md` states what was redacted from each.

- **Settled, and it falsifies the shipped rule — the terminal event is not the response.** A
  successful turn ends `turn.completed`, carrying a `usage` object and nothing else. The response is
  the event *before* it: an `item.completed` whose `item.type` is `agent_message`, whose `text` holds
  the schema-constrained JSON **as a string**. `finalJsonlLine` took the last line that parsed, so it
  returned the usage record, and `parseStructuredPayload` returned that as `ok: true` — a caller told
  nothing had failed, holding vendor telemetry with no proposal in it. Both sandbox branches produce
  the identical shape.
- **Corrected — this section's own reading of 2026-08-15 was too strong.** It recorded that all three
  names this package had guessed were wrong. Two are right: `item.completed` and `turn.completed` both
  exist. Only `session.created` does not — the vendor calls it `thread.started`. A failed turn is not
  a stream in which either of the other two could have appeared, so the conclusion reached past its
  evidence. The correction is recorded here rather than by editing that entry, because a dated
  observation that was honest about its stream is not made dishonest by a later one.
- **Narrowed, and the constraint above did not apply.** This section requires a narrowing to be proven
  against a stream where the old rule and the new one **agree**. No such stream exists and none can:
  the old rule is not narrower than the new one, it is wrong, and the two disagree on every successful
  turn. The replacement selects on `item.completed` / `agent_message` / `text` and gives up one input
  class the positional rule accepted — a bare JSON object on stdout, a shape no observed run has ever
  produced. What the vendor-field dependency buys is that a rename now yields `malformed-output`, a
  loud failure at the boundary, where the positional rule yielded a confident wrong answer.
- **`--output-last-message <FILE>` was tested and not adopted.** It writes exactly the
  schema-conforming payload and nothing else, so it would remove stream parsing entirely. It was
  declined because it introduces a vendor-written temp file this product would have to place, own and
  collect — a filesystem surface the design does not currently have, and one that would owe the
  `plan → backup → stage → validate → apply → verify → finalize` treatment every other mutation here
  gets. Recorded rather than dropped: whoever reopens the parsing rule should know the alternative
  works.
- **New, and outside this document's scope until it was observed — the vendor refuses this product's
  shipped output schema.** `--output-schema` pointed at `templates/schemas/ingest.stage.schema.json`
  answered HTTP 400 before any turn began: `In context=('properties', 'schemaVersion'), schema must
  have a 'type' key`. `schemaVersion` was a bare `const`, which is valid JSON Schema. So **`ingest`
  could never have returned a proposal on this vendor**, and every gate stayed green throughout,
  because nothing in the repository had ever handed that file to the binary. Fixed by adding
  `"type": "integer"`; `apps/cli/src/commands/output-schemas.test.ts` now walks every property of
  every shipped schema for a `type` keyword.
- **Confirmed again — `codex exec` reads stdin when stdin is not a TTY.** Observed on every run of
  both dates.

**What remains open after these runs:** the *interactive* session, and one inference inside the
replacement rule. Every invocation was `codex exec`, which is what this product spawns; nothing here
observed the TUI, where a founder captures by hand. And every recording contains exactly **one**
`agent_message`, so nothing observed says whether a turn may emit several — the new rule takes the
last, which is an inference and is labelled as one at the seam rather than written as an observation.
Both are registered in `BACKLOG.md` §1.

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

**Task 17, 2026-08-12 — verified against a real 0.147.0 install in a disposable `CODEX_HOME`, plugin
management only (no `codex exec`, no model invocation).** All of the following corrects or narrows
what the two bullets above and §4.1/§4.2's pseudocode previously assumed, none of which had been run
against a real installation before this task:

- **`codex plugin marketplace add` takes exactly one positional argument, the source path** — never
  a separate marketplace name. `["plugin", "marketplace", "add", "developer-os", "<path>"]` (spec
  §4.1's prior text, and `installRegistration`'s prior argv) refuses: `error: unexpected argument
  '<path>' found` (exit 2, a clap usage error). The marketplace's name is read from
  `marketplace.json`'s own top-level `name` field.
- **`codex plugin remove` requires the qualified `<plugin>@<marketplace>` form**, exactly like
  `plugin add`. A bare plugin name refuses: `plugin requires --marketplace unless passed as
  <plugin>@<marketplace>` (exit 1). Separately: `plugin remove` does **not** verify the plugin was
  ever installed under that marketplace — removing a name nothing added still exits 0. `plugin
  marketplace remove <name>` behaves differently: an unregistered name refuses with `marketplace
  ... is not configured or installed` (exit 1).
- **The marketplace document's `source.path`, for a `"local"` source, must be relative to the
  marketplace root and carry a leading `./`.** `renderMarketplace` previously wrote an absolute path
  (`posix.join(context.home, ...PLUGIN_TREE_SEGMENTS)`); the real CLI accepts that document (`plugin
  marketplace add` exits 0, no parse error) but then silently omits the plugin entry from both
  `codex plugin list --json`'s `available` and `installed` arrays — no warning, no error at add time
  — and `codex plugin add developer-os@developer-os` then refuses with `plugin \`developer-os\` was
  not found in marketplace \`developer-os\`` (exit 1). A relative path with no leading `./`
  (`plugins/developer-os`) fails identically. Only `./plugins/developer-os` — matching the vendor's
  own scaffolding tool, which always emits this exact `./plugins/<plugin-name>` form — resolves.
  Resolution is against the **marketplace root**, confirmed by running the CLI from a working
  directory outside that root entirely; it does not depend on process `cwd`.

  **Amended 2026-08-12, by the fresh-context review of Task 17.** The marketplace root is **not**
  "the directory containing `marketplace.json`" — `MARKETPLACE_RELATIVE_PATH` is
  `.agents/plugins/marketplace.json`, so that directory is `<product-home>/codex/.agents/plugins/`,
  two levels below the root. The marketplace root is the directory passed to `codex plugin
  marketplace add` — `<product-home>/codex`, the directory *containing* `.agents/plugins/`. A
  relative `./plugins/developer-os` resolves correctly only against that directory; resolved
  against `.agents/plugins/` itself it would look for the non-existent
  `.agents/plugins/plugins/developer-os`. The code was always correct (`PLUGIN_TREE_PREFIX` is
  relative to `<product-home>/codex`, per `plugin.ts`); only this parenthetical was wrong. Fixed in
  `renderMarketplace` (`marketplace.ts`) and
  `installRegistration`/`uninstallRegistration` (`install.ts`) by this same task, since without both
  fixes no step of the install this spec describes succeeds against a real CLI at all.
- **`codex plugin list --json`'s actual top-level shape is `{ "installed": [...], "available":
  [...] }`, not `{ "plugins": [...] }`.** Each entry carries `pluginId`, `name`, `marketplaceName`,
  `version`, `installed` (boolean), `enabled` (boolean), `source: { source, path }`,
  `marketplaceSource`, `installPolicy`, `authPolicy` — there is no top-level `status` or `path`
  field on an entry; `path` is nested under `source`. **`packages/adapter-codex/src/probe.ts`'s
  `listingSchema` was written against the shape this bullet corrects** (`{ plugins: [{ name, status?,
  path? }] }`) and will fail to parse a real `codex plugin list --json` response — `probeCodex`
  therefore currently reports the `skills` capability `unavailable` against every real installation,
  never `observed`. Task 17's own integration test drives the raw CLI directly, the same way the
  Claude adapter's equivalent test drives `claude plugin validate` directly, and does not call
  `probeCodex` — so this was caught by inspection, not by the test failing, and is not fixed by this
  task. **Flagged for DOS-P6**, the first subsystem to actually depend on `probeCodex` observing
  `yes`.

  **Amended 2026-08-12, by the fresh-context review that followed Task 17's own trueing-up commit.**
  The paragraph above is stale: `probeCodex`'s `listingSchema` now parses exactly this shape —
  `{ installed: [...], available: [...] }`, `.loose()` at both levels, each entry's path read from
  `source.path` — fixed in `packages/adapter-codex/src/probe.ts` by commit `eeae9ba` ("fix(adapter-codex):
  parse the listing the vendor actually returns"). `probeCodex` reports `skills: observed` against a
  real installation when the listed entry is present, enabled, and its `source.path` equals
  `dependencies.pluginRoot` — the real on-disk tree this adapter wrote, never the
  `$CODEX_HOME/plugins/cache/...` copy. This is no longer flagged for DOS-P6; a DOS-P6 maintainer can
  depend on `probeCodex` observing `yes`.
- **The property this whole install shape (§4) exists to prove, confirmed**: with the two fixes
  above, `codex plugin list --json`'s `installed[].source.path` for our plugin is exactly
  `<product-home>/codex/plugins/developer-os` — the real on-disk tree this adapter wrote — never
  `$CODEX_HOME/plugins/cache/developer-os/developer-os/<version>`, a **separate cache copy** `codex
  plugin add` also stages. That cache copy is not merely incidental: `codex debug prompt-input` (see
  below) resolves each skill's file locator to the *cache* copy, not the source tree, meaning a
  post-install edit to a skill file under `<product-home>/codex/...` would not reach the model until
  some resync step — unobserved, and out of scope for a plugin-management-only task. The
  `source.path` field is what `probeCodex` reads (once its schema is corrected, see above), and it is
  the field the "resolves to the real on-disk path, not a cache copy" claim was always about.
- **`codex debug prompt-input [PROMPT]` renders exactly what would be sent to the model, without
  sending it** — no `codex exec`, no model invocation, no credentials required (it ran cleanly with
  no auth configured), no cost. Its output includes a `<skills_instructions>` block naming every
  discoverable skill with `name: description (file: <path>)`; a plugin-provided skill is prefixed
  `<plugin_name>:`, e.g. `developer-os:developer-os-capture` — confirming the "Skill naming" rule the
  vendor's own bundled `plugin-creator` skill documents. This is the mechanism Task 17 used to verify
  all six skills are discoverable — offline, at no cost — without the `codex exec` probe the founder
  deferred to DOS-P6 for the unrelated JSONL-terminal-event question.
- **`$CODEX_HOME/config.toml` is written only by the vendor's own CLI**, confirmed by write-ordering:
  a snapshot taken after this adapter wrote the plugin tree but before any `codex` invocation shows
  no `config.toml`; one taken after `plugin marketplace add` shows it, containing a
  `[marketplaces.developer-os]` table and, after `plugin add`, a `[plugins."developer-os@developer-os"]`
  table. A correct, complete uninstall (both corrected CLI steps) leaves `config.toml` with neither
  table — confirmed empty, not merely absent of our entry.
- **Nothing was written outside `CODEX_HOME` and the product home** across the full
  register-list-uninstall sequence, inventoried before and after. Every other write Codex's own CLI
  makes on first use — `installation_id`, `shell_snapshots/`, `.sandbox_migration`, its own bundled
  system skills under `skills/.system/` (`imagegen`, `openai-docs`, `plugin-creator`, `skill-creator`,
  `skill-installer`, `review-agent`), its plugin cache under `plugins/cache/` — landed under
  `CODEX_HOME`; nothing touched the isolated `$HOME` outside it or the product home.

### 14.5 `AGENTS.md` — `https://developers.openai.com/codex/guides/agents-md`

- Codex reads `AGENTS.md` files before doing any work, building an instruction chain.
- **In the global scope, Codex reads `AGENTS.override.md` if it exists, otherwise `AGENTS.md`.**

## 15. Open items this spec does not close

1. **The plugin-bundled hooks path is documented but unobserved — still true after Task 17,
   2026-08-12.** §14.2 records `hooks/hooks.json` as a discovery location, and the vendor's curated
   plugin inspected on 2026-08-11 ships no hooks, so neither the path within a plugin nor a manifest
   `hooks` key has been seen in a real plugin. This plan ships no `hooks/hooks.json` of its own (§4's
   tree diagram shows one; the actual `buildPluginTree` does not emit it — see `plugin.ts`), so Task
   17's integration test could not exercise that path either; it is a plugin-management-only task and
   never wrote a hooks file to install. The one incidental observation it did make: a `plugin.json`
   with no `hooks` key at all installs and lists cleanly, no error or warning about the absent key.
   `plugin_hooks` continues to report `unknown` — which is what §5's model does with a fact nobody has
   established, and is the correct behaviour rather than a gap. **Still owned by DOS-P6**, which
   restores hooks for both adapters and is the first subsystem with an actual hooks file to install.
2. **The supported-version floor, established by Task 17, 2026-08-12: `CODEX_MINIMUM_VERSION` is now
   `0.147.0`.** One version was available on this machine and one was tested — not a range, and this
   section says so rather than implying otherwise. It is a **raise**, not a confirmation, of the prior
   provisional `0.144.6`: this task also fixed two real bugs in the adapter's own CLI argv and
   marketplace document (§4.1, §4.2, §14.4) that made the install fail outright against 0.147.0 before
   the fix, so nothing establishes those specific, corrected commands ever worked on `0.144.6` — that
   version predates this observation entirely and may not even carry the `plugin`/`marketplace`
   subcommands this design depends on. `0.147.0` is the only version this adapter's actual install
   path has been proven against; `packages/adapter-codex/src/versions.ts` and its docblock are amended
   accordingly.
3. **`buildConflictEvidence` has no consumer in either adapter** (§4.3). Whether it is retained,
   taken up by DOS-P7, or deleted is the decision of the first subsystem with a real three-way
   merge. Not DOS-P5's to make, and no longer an open question about DOS-P5.
4. **`subagents` is reported and unused** (§5.4). `SubagentStart`/`SubagentStop` exist; no
   canonical workflow spawns a subagent, and none should until a workflow needs one.
5. **`workflow-schema.md` §7's four under-specified workflows are not widened here.** Only `doctor`
   was ever DOS-P4's; the other three belong to DOS-P6. This adapter renders what the contracts say.
