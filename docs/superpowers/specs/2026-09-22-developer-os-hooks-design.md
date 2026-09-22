# Developer OS — Hooks Design

**Status: draft for founder approval, 2026-09-22.** This is `ORDER.md` entry A13 (DOS-P11) and roadmap
Phase 6. Scope: `docs/migration/instruction-inventory.md` §4. **Depends on:** A12 (Phase 5,
`specs/<date>-developer-os-instruction-artifacts-design.md`, drafted in parallel), which wires the
adapter install proposals into `init` and `uninstall` (NEW-60) and so puts the two plugin trees this
spec extends on disk; and Phase 4b, which ships the launcher whose stable absolute path every hook
names. This spec assumes nothing from either beyond the roadmap text. A12b (Phase 5b) precedes this
phase in D16's order and shares nothing with it.

Governing founder decisions: **D3** (the legacy guards return through product hooks, at cutover),
**D5** (every legacy hook becomes a public redacted default), **D6** (`session_start_injection`
returns), **D7** (Codex hooks are trusted manually; the product never writes the Codex config file),
**D8** (isolated vendor invocations load no user hooks), **D16** (this phase precedes the cutover).

## 0. Open questions for founder approval

Four. Each blocks a named section; everything else in this document is decided.

**Q1 — Failure mode of the guards, and the ordinary-command gate (§5.2, §5.3).** A hook fires on
every tool call. Today every non-`init` command first passes `assertOrdinaryCommandAdmitted` and
refuses with exit 6 while a bootstrap envelope is non-terminal (NEW-81). Under the vendor's exit
contract, exit 6 is a non-blocking error, so a guard that inherits the gate is silently fail-open
during recovery. But a guard that inherits the gate and maps a refusal to "block" would stop the
agent from making any tool call.

- **A (recommended).** The `guard` verbs skip the ordinary-command gate: they read no product-home
  state, only the compiled-in default rules and project-local files. The three security guards
  (`command`, `path`, `commit`) **fail closed**: an unparseable payload, an oversized payload or an
  internal error blocks the call. The advisory verbs (`stop`, `format`, `prompt`, `edit`) and
  `brain status --inject` **fail open**: they exit 0 with no stdout and one stderr line.
  `brain status --inject` keeps the gate, because it reads the vault.
- **B.** Every verb fails open. No broken install can ever wedge an agent session, but a malformed
  payload or a vendor payload-schema change silently disables the security guards.
- **C.** Every verb fails closed, including the advisory ones. This is the strictest option. A
  broken `tsc` or formatter blocks the session until the user removes the hooks.

**Q2 — Reporting external hooks on Codex (§8.2).** The roadmap requires `doctor` to report external
hooks. On Claude, that means reading `~/.claude/settings.json`, which the adapter never writes and may
read. On Codex, the hooks live in `config.toml`, and `codex-adapter.md` §2.3 says the product *never
reads or writes* that file.

- **A (recommended).** Claude only. `doctor` reports Claude's external hooks structurally: an event
  name and a count, never a command string. On Codex it reports `external-hooks: codex=unknown`,
  with a fixed message saying why. §2.3 stays unamended.
- **B.** Amend §2.3 to allow a read-only, structural, value-free parse of the hook tables in
  `config.toml`. Both vendors get reported. The cost is a TOML schema the product does not own, which
  §4 calls a drift generator.
- **C.** Report nothing on either vendor. This drops a roadmap requirement.

**Q3 — How "observed firing" reaches `doctor` as `yes` (§8.1).** The capability model requires a
probe observation. No vendor CLI is known to report Codex hook trust, and the product may not read
Codex's trust store (D7, §2.3).

- **A (recommended).** Firing records. Each hook invocation, after it has done its work,
  best-effort rewrites one fixed-schema record per (vendor, event) under a declared runtime
  directory `<product-home>/state/hooks/`. The directory is created by `init`, is never a manifest
  row, and is removed by uninstall. A hook never creates the directory, and never changes its exit
  code because of the record. `doctor` resolves `plugin_hooks` and `session_start_injection` from
  those records. On Codex this is also the only evidence that manual trust was granted.
  **Cost: this amends Spec 1.** The new reserved runtime path must enter Spec 1's owner table,
  uninstall's drain, the absent-manifest walks (D22, D27), which otherwise refuse unknown residue,
  and fresh-`init` shape admission (D23). It is also a product-home write outside any transaction,
  which needs the same recorded exception Spec 1 grants its bounded runtime records. §7.3 fixes the
  ordering that keeps an uninstall race from leaving residue behind.
- **B.** A vendor-CLI listing: `claude plugin details` on Claude, and nothing on Codex. That proves
  *loaded*, not *firing* (NEW-65's lesson), and Codex stays `unknown` forever.
- **C.** Matrix evidence only. The keys resolve to `yes` from a checked-in, version-scoped matrix
  result rather than from the user's machine. `doctor` then says nothing about whether *this*
  installation's hooks fire or are trusted.

**Q4 — Claude delivery if the skills-directory plugin's hooks do not fire (§7.1).** Claude loads
the plugin in place from `~/.claude/skills/developer-os/` (`claude-adapter.md` §4). Nobody has
observed a `hooks/hooks.json` firing from a skills-directory plugin. Plan Task 1 observes it before
any other task.

- **A (recommended).** If Task 1 does not observe firing, Phase 6 stops and returns to the founder.
  Claude hooks are recorded as `unsupported` and the Codex half proceeds alone. No product write
  ever reaches `settings.json`.
- **B.** Fall back to one product-owned block in `~/.claude/settings.json`, merged three-way through
  A12's `buildConflictEvidence` machinery, drift-checked and removed by uninstall. This amends
  `claude-adapter.md` §2.3.
- **C.** Fall back to a marketplace install. The same section records why that fails: Claude would
  read a cache copy, so drift detection goes blind.

## 1. Scope and invariants

This spec ships the eleven non-transcript hooks as calls to the installed `developer-os` binary, the
event table that maps each hook onto both vendors, and the `doctor` surface that reports product
and external hooks. It ships no hook script, no shell wrapper and no new dependency.

Invariants, each enforced by a test named in §10:

1. **One executable.** Every hook command is the absolute path of the installed launcher plus a
   fixed argv (§4). No `PATH` lookup, no shell script and no interpreter line.
2. **No transcript.** No code path reads the vendor's transcript-path field. Payload decoders read
   an allow-list of fields (§4.3) and never iterate or spread the payload object. The existing
   repository gate (`tests/repository/transcript-path.test.ts`) stays unchanged and green.
3. **No vendor spawn.** No hook verb reaches the adapters' invocation path (`invoke.ts`) or spawns
   `claude` or `codex` (§6).
4. **No vendor-config write.** The product never writes `~/.claude/settings.json` or Codex's config
   file (D7). Hooks ship inside the two plugin trees the adapters already own.
5. **No automatic capture.** No hook writes to quarantine, the vault or a transaction.
   `knowledge-pipeline.md` §2 stands: the two transcript-dependent hooks stay declined.
6. **Bounded.** Every input, output and child process has a byte or time bound (§5.4).

Out of scope: hook trust automation (refused, `codex-adapter.md` §2.6); the `vendor-config` drift
check (A14); cutover sequencing of the legacy hooks (A15, which consumes §8.2's report to satisfy "never enable
two copies of a mutating hook").

## 2. Coverage of inventory §4

Arithmetic: the inventory has 13 script rows. Two are transcript-dependent and stay declined, which
leaves 11. Of those 11, 8 become verbs, 1 is absorbed by `doctor`, 1 is external and 1 is refused.
`session_start_injection` is the first verb (D6).

| # | Legacy hook | Outcome | Owner in this spec |
|---|---|---|---|
| 1 | `knowledge-inject` | verb `brain status --inject` (the working directory comes from the payload, §4.1) | §5.1 |
| 2 | `bash-danger-guard` | verb `guard command` | §5.2 |
| 3 | `secret-file-guard` | verb `guard path` | §5.2 |
| 4 | `commit-guard` | verb `guard commit` | §5.2 |
| 5 | `stop-gate` | verb `guard stop` | §5.3 |
| 6 | `format-smart` | verb `guard format` | §5.3 |
| 7 | `skill-activator` | verb `guard prompt` | §5.3 |
| 8 | `shared-file-warn` | verb `guard edit` | §5.3 |
| 9 | `instructions-check` | absorbed: `doctor` drift of A12's managed instruction artifacts; no hook ships | A12 |
| 10 | `dippy-guard` | refused as a product hook; `doctor` reports it as `external` | §8.2 |
| 11 | `md-file-guard` | refused (retired in the legacy runtime on 2026-07-27) | — |
| 12 | `knowledge-capture` | declined (`knowledge-pipeline.md` §2) | — |
| 13 | `precompact-backup` | declined (same) | — |
| — | inline legacy hooks (third-party runners, audit log, notifications) | refused; reported as `external` | §8.2 |

**Parity obligation.** For rows 2–8 the inventory records only a name and a target. §5 defines the
smallest behaviour that fits each one. Plan Task 2 is a founder-run parity check of §5's rule tables
against the legacy scripts. That task runs outside this repository and produces only a list of rule
additions, redacted before it enters the repository (D5). This spec is amended with the result. It
does not guess.

## 3. Cross-vendor event table

Vendor event names are the ones observed on 2026-09-04 (`claude-adapter.md` §13, `codex-adapter.md`
§14). Matchers and payload shapes on Codex are **unobserved**. A cell marked *observe* becomes either
a matcher or `unsupported (<reason>)` in plan Task 1. Nothing is inferred.

| Verb | Claude event (matcher) | Codex event (matcher) | Kind | Fail mode (Q1-A) | Timeout |
|---|---|---|---|---|---|
| `brain status --inject` | `SessionStart` | `session_start` | context | open | measured (§5.4) |
| `guard command` | `PreToolUse` (`Bash`) | `pre_tool_use` (*observe*: shell tool name) | block | closed | measured |
| `guard commit` | `PreToolUse` (`Bash`) | `pre_tool_use` (*observe*) | block | closed | measured |
| `guard path` | `PreToolUse` (`Edit\|Write\|MultiEdit`) | `pre_tool_use` (*observe*: whether a file edit fires the event, and whether the payload carries a path or a patch body) | block | closed | measured |
| `guard stop` | `Stop` | `stop` | block-stop | open | measured |
| `guard format` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | `post_tool_use` (*observe*, as `guard path`) | advisory | open | measured |
| `guard edit` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | `post_tool_use` (*observe*) | advisory | open | measured |
| `guard prompt` | `UserPromptSubmit` | `user_prompt_submit` | context | open | measured |

**Codex file-edit rule.** If Task 1 observes that Codex delivers a file edit as a patch body rather
than a path, then `guard path`, `guard format` and `guard edit` on Codex must parse the patch's file
headers only. That grammar is closed: a bounded number of header lines, each naming one relative
path. Any line outside the grammar refuses. The other choice is to record the three verbs
`unsupported (patch payload)` on Codex. No verb parses patch bodies.

Two vendor events are deliberately unused: Claude `InstructionsLoaded` (row 9, handled by `doctor`
instead) and Codex `pre_compact` (row 13).

## 4. The hook command contract

### 4.1 Command bytes

Every hook entry's command is exactly
`<launcher> guard <kind> --vendor <claude|codex>` or
`<launcher> brain status --inject --vendor <claude|codex>`, where `<launcher>` is the absolute path
of the Phase 4b launcher. The launcher path is the only machine-specific token. `--cwd` (inventory §4) is not in the
command, because a static hook entry cannot know it: the verb takes the working directory from the payload's `cwd` field, and from the process
working directory when that field is absent.

- **Rendered at install time**, the way `marketplace.json` already is (`codex-adapter.md` §4). The
  checked-in `plugins/claude/` and `plugins/codex/` trees carry no hooks and no absolute path, and the
  existing "no absolute path" assertion in `packages/adapter-codex/src/plugin.test.ts` stays. The
  hook file exists only in the install tree, which takes the launcher path as a parameter.
- **Byte-stable across updates.** The command must not name a release bundle, a version or a hash.
  Codex's trust is per hook. If Task 1 observes that the trust hash covers the command string, any
  byte change forces the user to trust every hook again. A change to the command bytes is therefore
  a spec amendment that names the re-trust cost.
- **Re-registration.** Codex loads from its plugin cache (NEW-61). A change to the hook manifest
  reaches Codex only after `codex plugin add` runs again. The update lifecycle's re-registration
  obligation covers the hook manifest as well as the skills.

### 4.2 Argv

A new top-level command `guard` takes exactly one positional from the closed set
`command | path | commit | stop | format | prompt | edit` and exactly one option, `--vendor`, from
the closed set `claude | codex`. `brain status` gains `--inject` and `--vendor`. `--inject` requires
`--vendor` and excludes `--json`. Strict dispatch (`apps/cli/src/main.ts` `parse`) is extended rather
than bypassed, so an unknown kind, vendor or option is refused before any payload is read.

**Hook-mode routing is normative.** Today `run()` sends every failed `parse()` to `usageFailure()`,
which exits with `invalidInput` = 2, the vendor's *block* code. When `argv[0]` is `guard`, or when
`argv` contains `--inject`, **every** failure is routed to the §4.4 outcome map and never to
`usageFailure()` or `emit()`. That covers a parse failure, a `createContext` failure and a thrown
error. `guard` is dispatched before a context is built. Otherwise `guard prompt --vendor bogus` would
block the prompt and erase it.

**The launcher is on the path too.** The Phase 4b launcher runs before this code, and can refuse on
its own, for example on a release-trust failure in the middle of an update. Its exit code then
decides whether every tool call is blocked or every guard silently passes. The requirement on the
launcher draft is that a launcher refusal never exits 2 unless it knows it is running a security
guard. Task 1 observes the launcher's actual refusal exit codes.

### 4.3 Stdin

The verb reads the vendor's JSON payload from stdin. The payload is at most 1 MiB, must be UTF-8 and
must contain no NUL byte. The verb parses it once and then reads **only** these fields:

| Field (vendor spelling resolved per vendor in Task 1) | Read by |
|---|---|
| `cwd` | every verb |
| tool name | `command`, `commit`, `path`, `format`, `edit` |
| command string of a shell tool | `command`, `commit` |
| file path of an edit or write tool (or Codex patch headers, §3) | `path`, `format`, `edit` |
| prompt text | `prompt` |
| stop-loop flag (Claude `stop_hook_active`; Codex equivalent *observe*) | `stop` |

An absent or wrongly typed field is a malformed payload, and its outcome follows the verb's fail
mode. When a tool name is not the verb's matcher, the verb exits 0 with no effect: a mis-scoped
matcher is harmless.

### 4.4 Exit and output map

Hook verbs **do not use** `emit()`, `CliResult` or `EXIT_CODES`. The product's `invalidInput = 2`
collides with the vendor's "block" code, and its `securityRefusal = 5` is non-blocking to the vendor,
so reusing them would turn a usage error into a block and a refusal into a pass. Each verb
returns one of four outcomes, and a per-vendor table maps it:

| Outcome | Claude (from vendor documentation, **not yet observed**; confirmed in Task 1) | Codex (*observe* in Task 1) |
|---|---|---|
| `allow` | exit 0, stdout empty | as observed |
| `context(text)` (`inject`, `prompt`) | exit 0, stdout = `text` | as observed |
| `block(reason)` | exit 2, stderr = `reason` | as observed |
| `advise(reason)` (`format`, `edit`; `PostToolUse` only) | exit 2, stderr = `reason`. This is non-blocking because the tool has already run, and it is the only way stderr reaches the model. *Confirm in Task 1* | as observed |

Rules:

- **stdout carries only a `context` payload.** Usage text, diagnostics and warnings go to stderr. On
  the context events, stdout reaches the model. A usage message on stdout would be prompt injection
  by the product itself.
- **Argv refusal** (unknown kind, vendor or option) is outcome `block` for the three security guards
  and `allow` with one stderr line for everything else, per Q1-A. Stale argv after an update
  therefore blocks exactly the calls a guard should block, and nothing more.
- The fail-open path of an advisory verb is `allow` (exit 0), never `advise`.
- `context(text)` passes through `screenAndCap` and the redactor before it reaches stdout, because
  vault text goes straight into the model's context.
- `reason` is at most 2 KiB of UTF-8 after `screenAndCap` (`packages/security/src/screen.ts`). It
  names the rule ID and never echoes more than 200 bytes of the matched input. It passes through the
  redactor before it is written.

## 5. Verb contracts

### 5.1 `brain status --inject`

Outcome `context`: `vault-map.md`, followed by the one `project-note` whose `title` or alias equals
the project slug. The slug is derived by capture's slug function from the basename of the git root
containing `cwd`, or from `cwd` itself. The output is capped at 16 KiB. The vault map is truncated
first, at a line boundary, with a fixed marker line. The verb reads only through `BrainService` and
the Brain folder policy (`brain.md` §6.2). It writes nothing, and it keeps the ordinary-command gate.
When the gate refuses, the Brain is absent or the index is missing, the outcome is `allow` with one
stderr line. A session never fails to start because of injection.

### 5.2 Security guards (fail closed under Q1-A)

**Normalization is normative.** Every guard that matches patterns against a command string first
passes the string through **one** normalizer, `normalizeShellCommand` in `packages/security`. The
same normalizer replaces the inline `replace(/[\r\n]+/gu, " ")` in `assertSafeCommand`
(`packages/security/src/process.ts`), so the product has exactly one implementation. The normalizer
takes these steps, in order:

1. Refuse a NUL byte. The outcome is `block`.
2. Delete each backslash–newline continuation (`\` followed by LF, CRLF or CR).
3. Replace each run of LF, CR or CRLF with one space.
4. Match only after steps 1–3. No pattern is ever applied to the raw string, and no pattern is
   line-anchored.

The known bypass is a pipe-to-shell split across a line break (`curl … |` ⏎ `sh`). The fixtures in
§10 pin the LF, CRLF, lone-CR and continuation variants.

Default rules (public, closed, IDs stable; Task 2 may add, never silently remove):

| Verb | Rule ID | Blocks |
|---|---|---|
| `command` | `pipe-to-shell` | `curl` or `wget` output piped to `sh`, `bash` or `zsh` (the existing `assertSafeCommand` class) |
| `command` | `recursive-delete-root` | `rm` with a recursive flag whose operand is `/`, `~`, `$HOME` or `${HOME}` |
| `commit` | `hook-bypass` | `git commit` or `git push` with `--no-verify`, or `git commit -n` |
| `commit` | `force-push` | `git push` with `--force`, `-f` or a `+` refspec (`--force-with-lease` is allowed) |
| `path` | `protected-path` | an edit or write of a path `ProtectedPathPolicy` refuses, evaluated lexically against the path in the payload (no file is opened) |

`guard commit` does not run the repository's validation. That is a per-repository rule, not a
product default.

### 5.3 Advisory verbs (fail open under Q1-A)

- **`guard stop`.** If the stop-loop flag is set, the outcome is `allow`. This is the vendor-level
  recursion guard, and without it a failing `tsc` loops the session forever. Otherwise, if the
  project root has a `tsconfig.json` and an executable `node_modules/.bin/tsc` inside the project
  root, the verb runs that `tsc --noEmit -p <config>`. `<config>` is `tsconfig.check.json` when it
  sits beside the `tsconfig.json`, and `tsconfig.json` otherwise. The process goes through the
  security runner, with an absolute executable, the child timeout of §5.4 and no network access. A
  non-zero exit is `block` with the first 40 diagnostic lines. A timeout or spawn failure is `allow`
  plus stderr. No global `tsc` and no install.
- **`guard format`.** The verb runs the first formatter it finds in this closed table, and only one:
  `node_modules/.bin/biome format --write <file>` when a `biome.json` exists, otherwise
  `node_modules/.bin/prettier --write <file>` when a Prettier config exists. The formatter must be
  inside the project root, and the file must be inside the project root and pass `ProtectedPathPolicy`.
  The outcome is `advise` on a formatter error and `allow` otherwise. The verb never installs a
  formatter and never touches the network.
- **`guard prompt`.** The verb reads `<project-root>/.developer-os/skill-rules.json`: at most
  64 KiB, strict schema `{ schemaVersion: 1, rules: [{ skill, keywords[] }] }`, at most 200 rules
  and 20 keywords per rule, with NFC-lowercased substring match. When a rule matches, the outcome is
  `context` with one line naming at most 3 skills. An absent file is `allow`. An invalid file is
  `allow` with one stderr line naming the file.
- **`guard edit`.** The outcome is `advise` when the edited path resolves through a symlink to a
  target outside the project root, which makes it a file shared with other projects. Otherwise it is
  `allow`. The verb only resolves the path. It never opens the file and reads no product-home state,
  which keeps Q1-A's premise. Managed-artifact edits are already reported as drift by `doctor`.

"Project root" means the git root containing `cwd`, or `cwd` itself when it has none. It is
canonicalized through `packages/security` path canonicalization.

### 5.4 Bounds and latency

A `PreToolUse` hook runs on every tool call, so launcher startup plus policy evaluation sits on the
agent's critical path. This spec does not invent a latency target. **Plan Task 1 measures** the p50
and p95 wall time of `guard command` on an allow payload, through the real launcher, on the
development machine and on CI. The measurement also covers `assertOrdinaryCommandAdmitted`'s cost, as
evidence for Q1. The measurement is recorded in `docs/architecture/hooks.md`. Each hook entry's
declared timeout is then set to ten times the measured p95, rounded up to a whole second. Child
processes have their own cap: `tsc` gets 120 s and a formatter 30 s. The vendor timeout for the
`stop` and `format` entries exceeds the child cap by 5 s, so the verb, not the vendor, reports the
timeout.

## 6. Recursion guard

Three mechanisms, because an environment marker alone does not cross a product-spawned vendor.
Adapters run vendors with `env: {}` (F2, `vendor-invocation.md`).

1. **No vendor spawn from a hook.** The `guard` and `--inject` code paths do not import the adapter
   invocation modules. A dependency test enforces this.
2. **Child marker.** Every child a hook verb spawns (`tsc`, a formatter) receives
   `DEVELOPER_OS_HOOK_ACTIVE=1`. Every hook verb that finds the marker in its own environment returns
   `allow` immediately.
3. **Isolated runs stay hook-free.** Product hooks must not fire inside an isolated `ingest` vendor
   run. On Claude, `--safe-mode --setting-sources` already suppresses a planted *user* hook
   (`vendor-invocation.md`, Task 8). Whether it also suppresses a *plugin* hook is unobserved. On
   Codex, `--ignore-user-config` should leave product hooks untrusted and therefore inert, but that
   is unobserved as well. Both are real-agent matrix rows (§10.2). An `inject` firing during ingest
   would put vault content into an isolated prompt and break D8. If either row fails, Phase 6 stops
   until the adapter's argv is amended.

The Stop-loop flag (§5.3) is the fourth, vendor-level guard.

## 7. Installation, drift and uninstall

### 7.1 Claude

The install tree at `~/.claude/skills/developer-os/` gains `hooks/hooks.json`, rendered at install
time (§4.1), with one entry per Claude row of §3. The file is a manifest row like every other file in
the tree. Drift and uninstall need no new mechanism: a user edit to `hooks.json` is drift, and
uninstall removes it with the directory (`claude-adapter.md` §4). Q4 decides what happens if Task 1
does not see it fire.

### 7.2 Codex

The install tree's `.codex-plugin/plugin.json` gains `"hooks"`, rendered at install time. It is
inline or a referenced file, as Task 1 observes the manifest accepts. The product never writes the
trust store (D7). `init` and `doctor` print the fixed, manual next step: run the vendor's trust
approval for each `developer-os` hook. Until the first firing record exists (Q3-A),
`plugin_hooks=unknown` and `session_start_injection=unknown`. Uninstall's existing order (unregister,
then delete the tree, `codex-adapter.md` §4) removes the hooks. Trust entries left in the user's
config file refer to a command that no longer exists. Removing them is the user's job, and uninstall
prints that as a fixed line.

### 7.3 Firing records (Q3-A)

The records live under `<product-home>/state/hooks/`, a runtime directory `init` creates with mode
0700 and registers as a reserved runtime path under Spec 1's owner table. It is never a manifest
row, and the uninstall drain deletes it. Each record is
`<vendor>.<event>.json = { schemaVersion: 1, vendor, event, productVersion, firstSeen, lastSeen }`,
at most 16 records and 512 bytes each, written by same-directory temp file and rename. A hook writes
a record only when all of these hold:

- the directory already exists, is owned by the user and has mode 0700;
- the record is absent, or its `lastSeen` is older than 24 h;
- `assertOrdinaryCommandAdmitted` admits. That check runs **after** the verb's outcome is written,
  so a guard never depends on the gate.

A write never changes the exit code and never creates a directory. Any error is swallowed.

**Uninstall order is normative.** Uninstall removes both plugin trees first, so the hooks stop
firing, and only then deletes `state/hooks/`. A leftover `<name>.tmp-*` file in that directory is
shape-admitted by fresh `init` and by the absent-manifest walks, like the D23 bookkeeping set. A
hook that fires in the middle of an uninstall can then never turn into an exit-6 refusal.

## 8. Capabilities and `doctor`

### 8.1 Capability keys

`plugin_hooks` and `session_start_injection` leave both `NOT_USED` lists **in the same commit**,
with `adapter-capability-parity.test.ts` green. `session_end_capture` and `pre_compact_backup` stay
`not-used`. Under Q3-A each key follows the existing two-gate rule (`claude-adapter.md` §3):
`yes` requires both the version floor and the observation. The observation for `plugin_hooks` is
any firing record for that vendor, and for `session_start_injection` it is that vendor's
session-start record. Without an observation the key stays `unknown`, never `no` (NEW-62 is not
widened here). `DOCUMENTED_FLOORS` for both keys are set from the versions Task 1 observes.

### 8.2 `doctor` checks

- **`hooks`**: per vendor, the product hooks present in the installed tree against §3, together
  with each hook's last firing age. On Codex, a hook with no firing record gets a fixed message:
  "installed; not observed firing — approve it in Codex if you have not". The check is `warn`,
  never `fail`: an untrusted hook is the user's decision (D7).
- **`external-hooks`**: under Q2-A, the Claude hook entries in `~/.claude/settings.json` that do not
  name the launcher path, reported as `event → count` with no command string, a `warn` when any
  exist and `codex=unknown` on Codex. The read uses no-follow and is at most 1 MiB, and it fails
  soft to `unknown`. A15 uses this check as one piece of evidence that the legacy guards and the
  product guards are never both enabled. It sees only user-scope `settings.json` hooks, so the
  cutover plan must check plugin-delivered and project-scope legacy hooks separately.
- The `instructions-check` row is A12's instruction drift, already a `doctor` check there. This
  spec adds nothing to it.

## 9. Refusals

| Case | Behaviour |
|---|---|
| payload over 1 MiB, non-UTF-8, contains NUL, not JSON | fail mode of the verb (§3) |
| argv outside §4.2 | §4.4 argv rule |
| NUL in a command string | `block` (`guard command`, `guard commit`) |
| a verb asked to read the transcript-path field | impossible by construction (§4.3 allow-list); repository gate |
| a request to write Codex trust, or `settings.json` | not offered (D7; Q4-A) |
| formatter or `tsc` outside the project root, or needing network or install | not run; `allow` |
| `DEVELOPER_OS_HOOK_ACTIVE` set on entry | `allow`, no effect |

## 10. Test obligations

### 10.1 CI (argv/stdin contracts)

- **Fixtures.** Real payloads are recorded in Task 1 under `tests/fixtures/hooks/<vendor>/<event>.json`.
  Each is **scrubbed before check-in**: the transcript-path key is removed, every path is rewritten to
  a synthetic home, and no content is private. The repository gate must stay green over them.
- **Contract tests.** Every verb × vendor × fixture yields exactly the outcome and the exit, stdout
  and stderr bytes of §4.4. Every argv outside §4.2 is refused per §4.4. Payloads at 1 MiB and at
  1 MiB + 1 hit the boundary. A malformed payload follows the verb's fail mode.
- **Normalization.** `pipe-to-shell` blocks with LF, CRLF, lone CR, a backslash continuation and
  mixed runs between the pipe and the shell. `assertSafeCommand` and `guard command` share one
  normalizer, which a test enforces as an identity check on the import. NUL blocks.
- **Rule tables.** Every rule ID has at least one block fixture and one near-miss allow fixture
  (`--force-with-lease`, `rm -rf ./build`).
- **Render.** The install tree emits `hooks/hooks.json` (Claude) and `"hooks"` (Codex) with commands
  equal byte for byte to §4.1 for a given launcher path. The checked-in trees stay free of hooks and
  absolute paths. `packages/adapter-claude/src/plugin.test.ts`'s no-hooks assertion is **replaced in
  the same commit** by an assertion that only the install tree carries hooks. Its Codex twin gets
  the same replacement. Two renders produce identical bytes.
- **Capabilities.** Both `NOT_USED` lists change in lockstep. Each key resolves to `yes` only when
  the floor permits and a record exists, and to `unknown` otherwise.
- **Recursion.** The dependency test from §6.1 passes, and the marker short-circuits every verb.
- **Documentation.** The same change rewrites the `threat-model.md` hooks rows ("Hooks" and
  "Automatic capture", §5 table), `claude-adapter.md` §2.1, §3 and §5, and `codex-adapter.md` §2.1,
  §3 and §5. Hooks move from declined to shipped, and capture stays declined.

### 10.2 Real-agent matrix (observed firing)

"Observed" means an **observed effect**, not that a process ran. That is NEW-65's
listing-versus-loading lesson.

- For each supported row of §3, on each vendor, a disposable `HOME` or `CODEX_HOME`, a real session
  and a planted trigger must produce the effect. Examples: the planted `curl … |` ⏎ `sh` is
  **not executed**, a `.env` write is **refused**, a type error **prevents stop**, the injected
  project-note title **appears in the model's first turn**, and the formatter **changed the file**.
  A firing record must exist afterwards.
- On Codex the matrix runs after a manual trust step performed by the founder. An untrusted run must
  observe the hooks **not** firing, which proves D7's gate is real.
- Isolated `ingest` on each vendor, with the product hooks installed, must observe no firing record
  and no injected content (§6.3).
- **Founder stop conditions.** Real sessions spend model credits, and the Codex trust step is
  manual. Both are run or authorized by the founder, as NEW-75's authenticated runs are.

**Gate** (roadmap): every supported hook has been observed firing on Claude, and on Codex after
manual trust. `plugin_hooks` and `session_start_injection` resolve to `yes` in `doctor` wherever
they were observed. A row recorded `unsupported (<reason>)` in Task 1 counts as covered only if the
founder accepts the reason.

## 11. Plan shape and residuals

Plan tasks, in order:

1. **Observation spike.** In a disposable home, on both vendors: skills-directory plugin hooks
   firing (Q4); Codex matchers, payload fields, patch versus path (§3); Codex exit and output
   semantics (§4.4); whether the trust hash covers the command (§4.1); the stop-loop flag; plugin
   hooks under isolated ingest (§6.3); the latency baseline (§5.4); the launcher's refusal exit
   codes (§4.2). Output: the fixtures,
   `docs/architecture/hooks.md`, and a spec amendment that fills every *observe* cell.
2. Founder-run legacy parity check (§2).
3. `normalizeShellCommand` extraction and adoption by `assertSafeCommand`.
4. The `guard` and `--inject` argv, payload decoders and outcome map.
5. The verbs.
6. Install-tree rendering, the firing-records directory, and the capability and `doctor` changes.
7. The real-agent matrix.

Residuals:

- **Codex external hooks** are `unknown` under Q2-A.
- **A user who never approves Codex trust** keeps `unknown` forever. That is correct, not a defect.
- **Guard rules are defaults with no user override in v1** (YAGNI). A user override file in the
  product home is added when someone asks for one.
- **NEW-46's class is avoided, not closed.** The hook commands use an absolute launcher path, but
  `capture`'s ambient-marker spawn still resolves through `PATH`.
- **`pipe-to-shell` is a heuristic, not a shell parser.** `| /bin/sh`, `| sudo sh` and
  `bash <(curl …)` pass it. The parity task (§2) decides whether to add rules for them.
  `assertSafeCommand` matches on curl/wget argv, while the guard matches the whole command string.
  The two share the normalizer, not the matcher.
- **The latency budget is machine-relative** until the Phase 11 release matrix measures it on the
  supported floor.
