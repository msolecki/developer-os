# Developer OS — Claude Code Adapter Design

**Status: approved by the founder on 2026-08-11.** Written the same day for `ORDER.md` entry A8,
program plan Task 4, DOS-P4. This closes A8's `S` gate; the implementation plan may now be written,
and code follows the plan, which is a Global Constraint of the program plan rather than a
preference.

**Design inputs, all inside this repository:** the product design spec §6.6, §8, §9, §10, §11,
§14 and §17; `docs/architecture/workflow-schema.md`, whose §6, §7 and §8 are the debts DOS-P3
handed this subsystem by name; `docs/architecture/foundation.md` for the mutation pipeline and the
manifest; and `docs/migration/baseline-capabilities.json` as the only admissible statement about
what the founder's legacy runtime did.

**One class of input is from outside.** §14 records the Claude Code plugin, hook and CLI surfaces
this design depends on, each with the documentation page it came from and the date it was read.
That is deliberate: the capability model in §5 exists to stop this product asserting a surface it
has not verified, and a spec that described those surfaces from memory would be the first
violation of it.

---

## 1. What this subsystem is

`packages/adapter-claude` turns an already-validated `WorkflowContractV1` into artifacts Claude
Code loads, and invokes Claude Code safely on behalf of a workflow. It is the first implementation
of the `WorkflowRenderer` interface DOS-P3 defined and deliberately did not implement.

It is optional. A user may install Claude Code, Codex, both, or neither, and no other subsystem
may require this one.

## 2. What it does not do, on purpose

1. **It does not validate workflows.** `validateWorkflow` is the only door into
   `packages/workflow-schema` and this package goes through it. An adapter that re-implemented
   validation would be a second authority on what a workflow means.
2. **It does not touch the vault.** Every read or write of Brain content goes through
   `BrainService`. The adapter never opens a note.
3. **It does not spawn a process itself.** All execution goes through `packages/security`'s
   runner, which is where argv arrays, environment scrubbing and log redaction already live.
4. **It does not parse transcripts.** Product spec §11 refuses unstable raw transcript formats,
   and the refusal is load-bearing here: every hook payload carries `transcript_path` (§14.2), so
   the file is one `readFile` away at all times. The refusal is a rule about what this package may
   do with a path it is handed, not a claim that the path is unavailable.
5. **It does not write outside its own plugin directory.** See §4.
6. **It makes no model API call.** Version 1 has no direct model integration; the installed agent
   CLI is the only path to a model.

## 3. The decisions this spec makes

`BACKLOG.md` §3 lists eight things this spec must decide, plus one repository governance question.
Each has a section:

| Decision | Section |
|---|---|
| supported-version discovery | §5.2 |
| plugin structure | §4 |
| hook payloads | §6 |
| wrapper behavior | §8 |
| semantic config merge | §4.3 — **dissolved rather than answered** |
| failure contracts | §9 |
| which lifecycle surfaces are verified enough for injection and capture | §5, §6 |
| when to fall back to `developer-os run claude` | §8 |
| the first `.claude/` question this repository has ever had | §12 |

## 4. Install shape — a skills-directory plugin

**Decided 2026-08-11 by the founder: plugin-only, by the mechanism that keeps files in place.**

Developer OS owns exactly one directory:

```text
~/.claude/skills/developer-os/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── developer-os-shared/SKILL.md
│   ├── developer-os-capture/SKILL.md
│   ├── developer-os-review/SKILL.md
│   ├── developer-os-ingest/SKILL.md
│   ├── developer-os-brain-search/SKILL.md
│   └── developer-os-doctor/SKILL.md
└── hooks/
    └── hooks.json
```

A directory under a skills directory containing `.claude-plugin/plugin.json` loads as a plugin
named `developer-os@skills-dir`, with no marketplace and no install step, **discovered in place
rather than copied into the plugin cache** (§14.1). At personal scope — `~/.claude/skills/` — it
loads in every project and carries none of the restrictions that apply to a project-scope plugin.

### 4.1 Why this mechanism and not a marketplace install

A marketplace install copies the plugin into `~/.claude/plugins/cache`, one directory per version
(§14.1). Developer OS's manifest would then hash a source that Claude Code does not read, while
the bytes it does read live in a cache this product does not own. **Drift detection would be blind
by construction** — and drift detection over managed artifacts is the guarantee Foundation exists
to provide. In-place discovery makes the hashed bytes and the loaded bytes the same bytes.

Three consequences, each of which this spec handles rather than notes:

- **`~/.claude/settings.json` is never written.** Not one key. It is not read either, except as
  described in §5.3.
- **The user can disable the plugin behind our back** with `claude plugin disable
  developer-os@skills-dir`. Presence is therefore not enablement, and §5.3 makes `doctor` report
  both.
- **Component changes are not live.** A `SKILL.md` edit takes effect immediately, but changes to
  `hooks/`, `agents/` and `.mcp.json` require `/reload-plugins` or a restart (§14.1). `update`
  states this in its result rather than implying immediate effect; see §9.4.

### 4.2 Uninstall

Remove the directory. There is no uninstall step because nothing was installed from a marketplace
(§14.1). `developer-os uninstall` removes only manifest-owned paths, which here is one directory
and its contents, and it refuses if any file under it has drifted — a drifted file is a user edit,
and Foundation never overwrites one.

### 4.3 The semantic config merge, dissolved

`BACKLOG.md` §3 requires this spec to decide the semantic config merge, and the install shape
above means **there is no config to merge**. This is worth stating as a decision rather than an
omission, because it changes something recorded elsewhere: `BACKLOG.md` §2 names DOS-P4/DOS-P5 as
the first consumer of Foundation's `buildConflictEvidence`, built for exactly this merge and
currently called by nothing.

It stays uncalled by DOS-P4. That is a smaller claim than it looks — conflict evidence is still
produced for the plugin directory's own managed files, which is where a user edit can collide with
a regenerated artifact. What DOS-P4 does not do is merge a foreign config file it does not own.
Whether DOS-P5 needs the three-way form is DOS-P5's decision; Codex's documented surface includes
`AGENTS.md`, which is a shared file in a way `~/.claude/skills/developer-os/` is not.

**Amends `BACKLOG.md` §2 and product spec §9.3's deferral.** Registered in `BACKLOG.md` §8.

## 5. Capability model

**Decided 2026-08-11 by the founder: the version table gates, the probe decides.** A capability is
reported `yes` only when a documented version floor permits it *and* a probe against the installed
CLI observes it. The table alone never earns a `yes`.

### 5.1 The three values

| Value | Meaning | Reported when |
|---|---|---|
| `yes` | verified present on this install | table permits **and** probe observes |
| `wrapper-required` | the outcome is reachable, but not by this surface | table permits, probe does not observe |
| `unknown` | nothing is known | probe could not run, or failed |

`unknown` is never treated as `yes`. Product spec §11 and `BACKLOG.md` §3 both require that a
missing capture hook becomes `wrapper-required` and never a false `yes`; this table is the
mechanism, and the asymmetry is the point — every uncertain state degrades toward the wrapper.

### 5.2 Supported-version discovery

`claude --version` establishes the installed version. The version table maps documented floors to
capability claims. Three properties keep it honest:

- **The floor is the highest floor we actually depend on**, not the newest release. This design
  deliberately avoids `metadata` (v2.1.222+), `displayName` (v2.1.143+) and `defaultEnabled`
  (v2.1.154+) precisely so that none of them raises the floor (§14.1). `name` is the only required
  manifest field, so the manifest we emit is the minimal one.
- **A version above the table's knowledge is not an error.** It is reported as such, and the probe
  still decides. A table that refused unknown-newer versions would break on every Claude release.
- **A version below the floor reports the exact missing capabilities**, never a partial success.
  This is the program plan's Task 4 test, verbatim.

`baseline-capabilities.json` records Claude Code 2.1.216 as of 2026-07-21. That is a **historical
observation of the founder's machine, not a supported-version floor**, and this spec does not treat
it as one.

### 5.3 Enablement is a separate question from presence

Because a skills-directory plugin can be disabled by name (§4.1), `doctor` reports two independent
facts: the plugin directory is present and undrifted, and the plugin is enabled. A present but
disabled plugin reports every lifecycle capability as `wrapper-required`, because a disabled plugin
fires no hook. This is the one place the adapter reads Claude Code's settings, and it reads them —
it never writes them.

### 5.4 The capability keys

Product spec §11's example keys, resolved against the verified surface in §14:

| Key | Surface it resolves to | Probe |
|---|---|---|
| `skills` | `skills/<name>/SKILL.md` in the plugin | `claude plugin validate` |
| `plugin_hooks` | `hooks/hooks.json` bundled in the plugin | `claude plugin validate` |
| `session_start_injection` | `SessionStart` hook → `hookSpecificOutput.additionalContext` | probe hook, §6.1 |
| `session_end_capture` | `SessionEnd` hook | probe hook, §6.1 |
| `pre_compact_backup` | `PreCompact` hook | probe hook, §6.1 |
| `non_interactive_run` | `claude -p` | invocation probe |
| `structured_result` | `claude -p --output-format json` | invocation probe |
| `subagents` | `agents/` in the plugin | `claude plugin validate` |
| `durable_project_guidance` | **not used by this adapter** — see §7.1 | none |

`durable_project_guidance` is reported for `doctor`'s matrix and depended on by nothing, because
§7.1 chose concatenation over a shared guidance artifact. A capability this adapter does not use is
still worth reporting, and is not worth relying on.

## 6. Hooks and their payloads

> **Amended 2026-08-11 during implementation, pending founder ratification —
> `hooks/hooks.json` is not shipped in DOS-P4.** The three hooks below named
> commands under a `bin/` directory no task creates, and `claude plugin validate`
> checks schema rather than existence, so `plugin_hooks` could report `yes` over a
> dangling path. Emitting the scripts does not repair it: a command hook needs an
> executable file and **nothing in this pipeline can express an executable bit** —
> `RenderedArtifact` is `{ path, contents }` and `ManagedArtifactV1` has
> `kind: "file"` and no mode. Nothing regresses, because §6.1 already makes all
> three lifecycle capabilities `wrapper-required` until a hook is observed firing,
> and none ever could be. Restoring it needs three things in one change: the hook
> bodies (DOS-P6's capture contract), a way to mark a generated artifact
> executable, and a test that observes a hook firing. **Owner: DOS-P6.**
> Registered in `BACKLOG.md` §8. The section below stands as the design to
> restore, not as what ships today.

The plugin's `hooks/hooks.json` declares three events, and no others:

| Event | Matchers used | Why |
|---|---|---|
| `SessionStart` | `startup`, `resume`, `clear`, `compact`, `fork` | Brain context injection |
| `SessionEnd` | all | capture |
| `PreCompact` | `manual`, `auto` | capture before context is lost |

Every hook is `type: "command"`, whose contract is JSON on stdin, and whose exit codes are `0`
success, `2` blocking error with stderr shown to the model, and anything else a non-blocking error
(§14.2). Commands are addressed with `${CLAUDE_PLUGIN_ROOT}` so the plugin never names an absolute
machine path — a hard requirement of a public repository and of the manifest, not a style choice.

**Every hook payload carries `session_id`, `transcript_path`, `cwd`, `permission_mode` and
`hook_event_name`** (§14.2). Two rules follow, and they are the security core of this section:

1. **`transcript_path` is never opened.** §2.4.
2. **Every payload field is untrusted input.** `cwd` and `session_id` are attacker-influenceable in
   the ordinary case of a user opening a hostile repository. They are redacted before logging,
   before hashing and before reaching a model, per the standing order that redaction precedes
   truncation.

### 6.1 What "verified enough" means for a lifecycle surface

`BACKLOG.md` §3 asks this spec to decide which lifecycle surfaces are verified enough for
SessionStart injection and automatic capture. The answer is a procedure, not a list:

A lifecycle surface is verified when a hook installed in a disposable HOME is **observed to fire**
and its payload matches the documented shape. Documentation alone yields `wrapper-required`, not
`yes` — which is the §5 rule applied to the one place it is most tempting to skip, because a
SessionEnd hook cannot be made to fire without a real session.

Capture therefore starts life as `wrapper-required` on any install where the integration test has
not run, and this is correct rather than pessimistic: the wrapper produces the same capture, and a
false `yes` produces silent data loss.

## 7. Rendering

`ClaudeRenderer implements WorkflowRenderer`. Input is a validated contract plus its optional
Claude overlay; output is `RenderedArtifact[]`, each carrying the source marker DOS-P3 defined.
Generated files are never edited as canonical source (product spec §10).

### 7.1 The `shared` preamble

**Decided 2026-08-11 by the founder: the renderer concatenates it.** `workflow-schema.md` §7
records that `shared` — which carries the entire prompt-injection defence — reaches none of the
other five workflows, because `WorkflowContractV1` has no composition field and `extends` is an
overlay-to-base relation rather than a composition one.

The renderer prepends `shared`'s prose and refusals to each of the other five artifacts. The
defence is then physically present in every file that needs it, and no load order, surface
availability or user setting can remove it. The rejected alternative was a single plugin-level
guidance artifact the others reference: tidier, and it makes the defence exactly as present as
that surface's load guarantee, which is a security property traded for a duplication cost.

`shared` also renders as its own skill, so that the preamble has one reviewable home.

### 7.2 `recovery.resume` is inert text

`workflow-schema.md` §6 and §8.7: `recovery.resume` is a command string nothing executes, it passes
the compiler unscreened because it is payload rather than message, and the moment a surface prints
it as "run this to recover" an author-controlled shell line has reached a terminal.

The renderer emits it inside a fenced block, marked as text to read rather than run, and **screens
it through `packages/security`'s screen at the render seam** — the compiler declines to screen
contract fields by design, so the first surface to display one owns screening it. It is never
emitted into `hooks.json`, never into a command, and never into anything a `!` prefix or a tool
call could reach.

### 7.3 Byte-identity — the debt DOS-P3 handed over

`workflow-schema.md` §6 records that product spec §13's requirement that six workflows "render
byte-identically" could not be met by a package that ships no renderer, and that **the byte
identity of real vendor artifacts is owed by DOS-P4 and DOS-P5.** This spec accepts it:

- render all six twice in one process, assert byte equality;
- render under a reversed directory reader, assert byte equality;
- regenerate in CI and fail on any diff against the checked-in `plugins/claude/` (product spec §10).

Determinism requirements inherited from DOS-P3 apply to any set this renderer orders: sorting is by
code point, and normalization precedes de-duplication.

### 7.4 `plugins/claude/` in this repository

The rendered tree is checked in, because product spec §10 requires CI to regenerate it and fail on
a difference. It is a build artifact under review, not a hand-edited source, and it is the tree
that gets copied into `~/.claude/skills/developer-os/` at install time.

## 8. Invocation, and the wrapper

`ClaudeInvocation` executes `claude -p <prompt> --output-format json` through the security runner:
argv array never a shell string, bounded stdin, an explicit timeout, an explicit kill signal, and
a structured result validated before any consumer sees it. Malformed output is a failure, never a
best-effort parse.

Two flags do real work here:

- **`--max-turns`** bounds the agentic loop. An unbounded agent invocation inside a workflow with
  declared scopes is a workflow whose cost and reach are decided by the model.
- **`--allowedTools`** is where a compile-time scope becomes a runtime restriction. The workflow's
  derived read and write scopes translate into allowed-tool rules, so the equality rule DOS-P3
  enforces on paper is enforced again by the agent's own permission system. This is defence in
  depth, not a replacement: `workflow-schema.md` §8.6 records that `steps[].with` is outside the
  scope guarantee entirely.

### 8.1 `agent.prompt` — this adapter's verb, and the hole it closes

`workflow-schema.md` §5 assigns `agent.prompt` to the adapters, and §8.6 records the largest hole
in the scope guarantee: `steps[].with` is `z.record(z.string(), z.unknown())`, contributes nothing
to a derived footprint, and "whichever adapter first executes a verb owns validating that verb's
arguments; this package cannot, because it does not know what any handler does with them."

DOS-P4 is that adapter. This spec defines `agent.prompt`'s `with` schema — a strict shape, unknown
keys refused — and validates it before invocation. An `agent.prompt` step whose `with` does not
validate is a refusal, not a best-effort call.

**Amended 2026-08-11 by the Codex adapter spec §7.3 — the schema does not live in this package.**
DOS-P5 executes the same verb, and two adapters with two argument schemas for one verb is a
workflow that validates against one vendor and not the other. The schema lives in `packages/core`
and both adapters import it. `packages/workflow-schema` would be wrong: it is the compiler, and it
deliberately does not know what any handler does with its arguments. Registered in `BACKLOG.md` §8;
this spec's §13 module list reads `agent-prompt.ts` as the adapter's *call site*, not its home.

### 8.2 When the wrapper is used

`developer-os run claude` wraps the CLI when, and only when, a capability required for the capture
contract is not `yes`. Concretely: capture falls back to the wrapper when `session_end_capture` is
`wrapper-required` or `unknown`, which by §6.1 is its state until a lifecycle surface has been
observed firing.

`doctor` reports that wrapper use is required rather than failing, which is product spec §11's
contract. A workflow whose required capability is absent and which has no fallback exits 4.

## 9. Failure contracts

Exit codes are Foundation's, and this subsystem adds no new class:

| Condition | Code |
|---|---|
| required capability unavailable, no fallback | 4 |
| `agent.prompt` arguments fail validation | 5 |
| a screen or redaction refusal | 5 |
| drifted managed file under the plugin directory | 3 |
| malformed structured result, timeout, signal death | 1 |
| unparseable adapter configuration | 2 |

Every failure names the affected paths and a recovery command where one exists, and contains no
secret values — product spec §8.

### 9.1 Timeout and signal

A timed-out invocation is killed with an explicit signal and reported as a timeout, never as a
malformed result. The distinction matters because one is retryable and the other is a contract
violation worth investigating.

### 9.2 Probe failure is not capability absence

A probe that cannot run reports `unknown` (§5.1). It never reports `no`, because "we could not
ask" and "the answer is no" are different facts and only one of them justifies telling a user their
Claude install lacks a feature.

### 9.3 A partially written plugin directory

Install follows Foundation's `plan → backup → stage → validate → apply → verify → finalize`
unchanged. An interruption leaves either the previous tree or a recoverable transaction, and
`developer-os repair --resume|--rollback` is the recovery, exactly as for any other managed
artifact.

### 9.4 `update` states what did not take effect

Because component changes are not live (§4.1), a successful `update` reports that `hooks/` and
`agents/` changes require `/reload-plugins` or a restart. Reporting a success that has not actually
taken effect in the running session is the failure mode this product was built to end.

## 10. Security seams

| Seam | Rule |
|---|---|
| hook payload → log, hash, model | redact before truncating, hashing or sending |
| contract field → rendered artifact | screen at the render seam (§7.2) |
| workflow scopes → invocation | translate to `--allowedTools` (§8) |
| `steps[].with` → handler | validate against a strict schema (§8.1) |
| `transcript_path` | never opened (§2.4) |
| plugin directory | the only path this adapter writes |
| absolute machine paths | `${CLAUDE_PLUGIN_ROOT}` only, never a literal |

**`claude plugin validate` is not a security control.** It reports unrecognized manifest fields as
warnings, not errors, and a plugin with only unrecognized-field warnings still passes and loads
(§14.1). Our own drift check over our own manifest is the authority on what our manifest contains;
`validate` is used to catch syntax and schema errors early, which is a different job.

## 11. Testing

The ladder is fake CLI first, disposable real installation second — program plan Task 4.

**Fake CLI** pins argv, stdin bounds, environment, timeout, signal, exit code and malformed-output
behavior. It runs with no Claude Code installed, which is what makes it a gate rather than a
description of one machine.

**Disposable real installation** runs in a temporary HOME. `claude --plugin-dir` loads a plugin
directory for the duration of a session (§14.3), which lets an integration test exercise the real
generated tree without installing anything into the user's own configuration — the cleanest
available form of "test against a real agent without touching the machine".

Required cases, from the program plan and `BACKLOG.md` §3:

- generated artifacts regenerate byte-identically; CI fails on a diff;
- install, update and uninstall preserve unrelated Claude settings — trivially true here, and
  tested rather than assumed, by asserting no bytes are written outside the plugin directory;
- an unsupported version reports exact missing capabilities rather than partial success;
- a missing capture hook becomes `wrapper-required`, never a false `yes`;
- capture redacts before persistence or model input;
- a hostile `with` on `agent.prompt` is refused;
- a `recovery.resume` containing a shell metacharacter renders as inert text.

**Every scan asserts a non-empty set, per scope.** A gate that can pass by scanning nothing is not
a gate, and this repository has already shipped two that could.

## 12. The first `.claude/` question

**Decided 2026-08-11 by the founder: this repository creates no `.claude/` directory in version 1.**

The question — recorded in `BACKLOG.md` §3 and `workflow-schema.md` §6 — is whether small
conveniences under `.claude/` (a slash command, a hook) are publication artifacts warranting a full
approval-and-hash cycle. The install shape settles the half that pressed: adapter output lives in
`plugins/claude/` and installs to the user's `~/.claude/skills/`, so no adapter artifact ever wants
a home in this repository's `.claude/`.

The remaining half is conveniences this repository would run on itself, and the answer is that it
has none and creates none in version 1. `exclusion-policy.md` records the decision, so the absence
is a decision rather than a gap, and reopening it is a visible amendment rather than a quiet
`mkdir`. This matters more than it would elsewhere: the repository is public, and a `.claude/`
here is inherited by every fork.

**Amends `docs/migration/exclusion-policy.md`,** an approved Task 0 artifact. Registered in
`BACKLOG.md` §8; the policy carries a cross-reference to this section.

## 13. Produced interfaces

| Name | Shape |
|---|---|
| `ClaudeAdapter` | the package's only public door — discover, capabilities, render, plan, invoke |
| `ClaudeInstallation` | resolved binary, version, enablement |
| `ClaudeCapabilities` | the §5.4 keys, each `yes` / `wrapper-required` / `unknown` |
| `ClaudeInvocation` | argv, bounded stdin, timeout, signal, structured result |
| `ClaudeRenderer` | `WorkflowRenderer` for Claude |
| managed hook plan | a Foundation `ChangePlan` over the plugin directory |
| structured agent-run result | validated, redacted, consumed by DOS-P6 |

Modules, one job each: `discover.ts`, `probe.ts`, `capabilities.ts`, `render.ts`, `plugin.ts`,
`install.ts`, `invoke.ts`, `index.ts`. `index.ts` is the only public door, which is DOS-P3's §4
lesson applied before it has to be learned again.

## 14. Verified vendor surfaces

Every external fact this design depends on, with its source and the date read. **A version table
written from memory is the failure the capability model exists to prevent**, so this section is
normative: an implementation may not depend on a Claude Code surface that is not listed here or
added here by amendment.

Read 2026-08-11.

### 14.1 Plugins — `https://code.claude.com/docs/en/plugins-reference`

- Manifest is `.claude-plugin/plugin.json`; it is optional; `name` is the only required field,
  kebab-case, and is what namespaces components.
- Unrecognized top-level fields are ignored at load; `claude plugin validate` reports them as
  warnings, not errors, and such a plugin still loads.
- Component directories — `skills/`, `agents/`, `hooks/`, `commands/` — sit at the plugin root,
  never inside `.claude-plugin/`.
- Hooks location: `hooks/hooks.json` in the plugin root, or inline in the manifest.
- **Skills-directory plugins:** a folder under a skills directory containing
  `.claude-plugin/plugin.json` loads as `<name>@skills-dir` on the next session, with no
  marketplace and no install step, discovered in place rather than copied into the plugin cache.
  `~/.claude/skills/` is personal scope and loads in every project. Disable by name; remove by
  deleting the folder; there is no uninstall step.
- **Marketplace installs are copied** to `~/.claude/plugins/cache`, one directory per version,
  orphans removed after 14 days.
- Live reload: `SKILL.md` changes apply immediately; `hooks/`, `agents/` and `.mcp.json` changes
  need `/reload-plugins` or a restart.
- Path placeholders: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`.
- Documented version floors, none of which this design depends on: `displayName` v2.1.143+,
  `defaultEnabled` v2.1.154+, `metadata` as an object v2.1.222+, root `SKILL.md` single-skill
  plugins v2.1.142+.
- `claude plugin validate <dir> [--strict]` checks the manifest, skill/agent/command frontmatter
  and `hooks/hooks.json`.

### 14.2 Hooks — `https://code.claude.com/docs/en/hooks`

- Events used: `SessionStart` (matchers `startup`, `resume`, `clear`, `compact`, `fork`),
  `SessionEnd` (matchers `clear`, `resume`, `logout`, `prompt_input_exit`,
  `bypass_permissions_disabled`, `other`), `PreCompact` (matchers `manual`, `auto`).
- Common payload fields on every event: `session_id`, `prompt_id`, `transcript_path`, `cwd`,
  `permission_mode`, `effort`, `hook_event_name`, and `agent_id`/`agent_type` for subagents.
- Configuration shape: `hooks.<EventName>[] → { matcher, hooks: [{ type, ... }] }`, and a
  handler accepts `timeout` in seconds.
- **Matcher patterns, added 2026-08-11** after a review asked whether `"*"` was a cited surface:
  `"*"`, `""` and an omitted matcher all mean *match all*, for any event; a value of letters,
  digits, `_`, `-`, spaces, `,` or `|` is an exact string or a `|`-separated list; anything else
  is an unanchored JavaScript regex. So `matcher: "*"` on `SessionEnd` is documented, and the
  per-event matcher lists above are the *named* values rather than the only legal ones.
- Handler types include `command`, `http`, `mcp_tool`, `prompt`, `agent`. This design uses
  `command` only.
- Command-hook exit codes: `0` success and stdout parsed as JSON; `2` blocking error with stderr
  shown to the model; anything else a non-blocking error.
- Context injection is `hookSpecificOutput.additionalContext`.

### 14.3 CLI — `https://code.claude.com/docs/en/cli-reference`

- `-p` / `--print` for non-interactive mode.
- `--output-format` with `text`, `json`, `stream-json`.
- `--max-turns <n>`, print mode only, errors when the limit is reached.
- `--allowedTools` taking permission-rule syntax.
- `--permission-mode` with `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
  `bypassPermissions`.
- `--plugin-dir <path>` loads a plugin for the session only.

## 15. Open items this spec does not close

1. **The skills-directory-plugin version floor is not documented** on the page read. It is
   therefore established by probe rather than by table — which is what §5 says to do when a table
   cannot be right, so this is the design working rather than a gap. Record the observed floor when
   the integration test first runs, and amend §14.1.
2. **`durable_project_guidance` is reported and unused** (§5.4). If a later subsystem wants it,
   §7.1's rejected alternative is the design to revisit, along with its security trade.
3. **`workflow-schema.md` §7's `doctor` contradiction is resolved here in prose** (§5.3, §8.2) and
   its resolution belongs in the implementation plan's step list, not only in this spec. The
   `doctor` *workflow* refuses when no installation is found; the `doctor` *command* always
   reports, including with zero adapters installed. They share a name and are not the same object.
4. **The four workflows that say less than the product spec does** are recorded in
   `workflow-schema.md` §7 with owners. Only `doctor` is DOS-P4's. This spec does not widen the
   other three, which belong to DOS-P6.
