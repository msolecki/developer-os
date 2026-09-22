# Hooks

## 1. Observation record

Written by A13 plan Task 1, the observation spike, on 2026-09-22 against Claude Code 2.1.280 and
Codex CLI 0.155.1 (D48). Each question gets one answer: an observed answer, `unsupported (<reason>)`
for observed non-support, or `founder-deferred (<reason>)` when only a billed model turn or a manual
Codex trust grant can answer it. Nothing was billed, nothing logged in, and no trust was granted.

**Isolation.** Every vendor command ran as `env -i PATH="$PATH" TMPDIR="$TMPDIR" HOME="$T"
CODEX_HOME="$T/.codex" XDG_CONFIG_HOME="$T/.config" …` with `T` a fresh `mktemp -d` under the agent's
`TMPDIR`, no `CLAUDE_CONFIG_DIR`, inside the agent's network-denying sandbox. Claude *session* rows
also set `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, a dummy `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1`, ran
`claude -p <prompt> --output-format json --debug-file …` from `$T/work`, and were killed by an alarm
(exit 142) while the CLI retried the refused connection, unless noted.

**Claude tree.** The checked-in `plugins/claude/` copied to `$T/.claude/skills/developer-os/`, plus
`hooks/hooks.json` written by the product's own `renderClaudeHooks` (all eight `CLAUDE_HOOK_ROWS`,
five events). Its executable path was a wrapper `$T/bin/dos` that appends its argv and stdin to a log
under `$T`, then acts on a mode file: forward stdin to `node apps/cli/dist/bin.js "$@"` (default),
print a marker on stdout and exit 0, print a marker on stderr and exit 2, or the same with exit 1.
`$T/.claude/settings.json` did not exist, so every firing is plugin-sourced.

**Codex tree.** A local marketplace at `$T/p/codex` (`renderMarketplace`'s document and the
checked-in `plugins/codex/`) with a probe `hooks/hooks.json` in the plugin, registered with
`codex plugin marketplace add` and `codex plugin add developer-os@developer-os --json`. Hooks were
read back through the app-server's `hooks/list` request (`codex app-server` over stdio,
`initialize`, then `hooks/list` with `cwds: [$T/cwork]`), whose schema comes from
`codex app-server generate-json-schema`. Firing was checked with `codex exec --ephemeral --json
--skip-git-repo-check -s read-only` against a custom provider at `http://127.0.0.1:9/v1` with a
dummy key (the A12 *request* method), killed by an alarm.

1. **Claude: a skills-directory plugin's `hooks/hooks.json` fires (Q4).** Observed firing.
   `claude plugin details developer-os` lists `Hooks (5)  SessionStart, UserPromptSubmit,
   PreToolUse, PostToolUse, Stop`. The session debug log shows `Read hooks.json for plugin
   developer-os (enabled=true)` and `Registered 8 hooks from 1 plugins`, and the wrapper logged
   `brain status --inject --vendor claude` on `SessionStart` (`source: "startup"`) and
   `guard prompt --vendor claude` on `UserPromptSubmit`, both forwarded to the built entrypoint,
   which ran and exited. The debug line `installed plugins' hooks modules not loaded: rollout flag
   (tengu_plugin_hooks_modules) is off` concerns hook *modules*, not `hooks.json`; plugin
   `hooks.json` fired regardless. Q4-A does not trigger. `PreToolUse`, `PostToolUse` and `Stop`
   firing: founder-deferred (they need a model turn; with `CLAUDE_CODE_MAX_RETRIES=0` the turn
   ended on the API error, `claude` exited 1, and `Stop` did not fire).
2. **Claude: exit and output semantics (§4.4).**
   - `SessionStart`, exit 0 with stdout: logged as `Hook SessionStart:startup (SessionStart)
     success:` with the stdout text; `Hook output does not start with {, treating as plain text`
     (output beginning with `{` is parsed as JSON). The session continued.
   - `UserPromptSubmit`, exit 0 with stdout: `success:` with the stdout text, as above; the prompt
     was sent.
   - `SessionStart`, exit 2 with stderr: logged as `error:` with the stderr text; the session
     continued to `UserPromptSubmit`. Non-blocking.
   - `UserPromptSubmit`, exit 2 with stderr: **blocks.** `prompt.submit: dropped`, no API attempt
     (`duration_api_ms: 0`, `num_turns: 0`), and `claude -p` exits **0** with `"subtype":
     "success"`, `"is_error": false` and `result` = `UserPromptSubmit operation blocked by hook:\n[<command>]:
     <stderr>\n\n\nOriginal prompt: <prompt>`.
   - Exit 1 with stderr on both events: logged as `error:`, non-blocking; the prompt was sent.
   - Whether `SessionStart` and `UserPromptSubmit` stdout reaches the model: founder-deferred (the
     request body is not observable against a dead endpoint).
   - `PreToolUse`, `PostToolUse` and `Stop`, exit 0 and exit 2: founder-deferred (need a model
     turn).
3. **Claude: payload field spellings.** Observed for two events (fixtures
   `tests/fixtures/hooks/claude/SessionStart.json` and `UserPromptSubmit.json`, scrubbed):
   `SessionStart` carries `session_id`, the transcript-path key, `cwd`, `hook_event_name`,
   `source`; `UserPromptSubmit` carries `session_id`, the transcript-path key, `cwd`, `prompt_id`,
   `permission_mode`, `hook_event_name`, `prompt`. `cwd` is the session working directory as an
   absolute path. `tool_name`, `tool_input.command`, `tool_input.file_path` (Edit, Write,
   MultiEdit) and `stop_hook_active`: founder-deferred (need a model turn).
4. **Codex: event names, matcher, tool name, file edits (§3).** The plugin `hooks.json` uses the
   Claude-shaped document `{"hooks": {"<Event>": [{"matcher": …, "hooks": [{"type": "command",
   "command": …, "timeout": …}]}]}}` with **PascalCase** event keys: `PreToolUse`, `PostToolUse`,
   `SessionStart`, `UserPromptSubmit`, `Stop` were all listed. A snake_case key (`session_start`)
   was **silently ignored**: no hook, no error, no warning. `hooks/list` reports events in
   camelCase (`preToolUse`) and keys in snake_case (`…:pre_tool_use:0:0`); the schema's full event
   set is `preToolUse`, `permissionRequest`, `postToolUse`, `preCompact`, `postCompact`,
   `sessionStart`, `sessionEnd`, `userPromptSubmit`, `subagentStart`, `subagentStop`, `stop`,
   `interrupt`. The matcher is stored verbatim (`Bash`, `shell`, `Edit|Write|apply_patch` all
   accepted without validation). The shell tool name, whether a file edit fires
   `PreToolUse`/`PostToolUse`, and path versus patch body: founder-deferred (need a trusted hook and
   a model turn).
5. **Codex: field spellings and the stop-loop flag.** founder-deferred (no payload reaches an
   untrusted hook, and a trusted one needs the founder's trust grant).
6. **Codex: exit and output semantics.** founder-deferred (as 5). Observed only: an **untrusted hook
   does not fire**. With the plugin hooks, and in a second run also a user
   `$CODEX_HOME/hooks.json` with the same handlers, listed `trustStatus: "untrusted"`, `codex exec` ran into the refused
   request and the wrapper logged nothing; neither `--json` stdout nor `RUST_LOG=trace` stderr
   mentioned the skipped hooks.
7. **Codex: manifest `"hooks"` shape.** All three forms load, each listed with `source: "plugin"`
   and `pluginId: "developer-os@developer-os"`, from the cache copy
   (`$C/plugins/cache/developer-os/developer-os/0.0.0/…`), never the marketplace tree:
   - `"hooks": "./hooks/hooks.json"` (file reference): key `hooks/hooks.json:<event>:0:0`;
   - no `"hooks"` key, with `hooks/hooks.json` present: loaded the same way, so that path is the
     default;
   - `"hooks": { "hooks": { … } }` inline, with no hooks directory: key
     `plugin.json#hooks[0]:<event>:0:0`.

   `codex plugin add --json` succeeded for each and reported nothing about hooks. `timeout` maps to
   `timeoutSec`; without it the default is **600 s**. `errors` and `warnings` were empty throughout.
8. **Codex: trust hash (§4.1).** Each hook carries `currentHash: "sha256:…"` and
   `trustStatus` (`managed`, `untrusted`, `trusted`, `modified`). The hash **covers the command
   string**: two otherwise identical `SessionStart` handlers differing only in command hashed
   differently. It also covers the matcher (`Bash` → `shell` changed it) and the timeout (adding
   `"timeout": 2` changed it). It does **not** cover the location: the same handler as a user hook
   and as a plugin hook, and the same plugin handler moved from `hooks/hooks.json` to the inline
   manifest form, kept the same hash. So any change to command bytes, matcher or timeout moves a
   trusted hook to re-trust; whether that shows as `modified` or `untrusted` is founder-deferred
   (needs a grant first).
9. **Isolated `ingest` (§6.3).** Claude: a planted plugin `SessionStart` hook **does not fire**
   under the ingest argv (`--tools "" --strict-mcp-config --restricted --safe-mode
   --no-session-persistence --permission-prompts none`): the wrapper logged nothing, and the debug
   log shows `Safe mode: installed plugins are disabled, none of their hooks or hooks modules load`,
   `Registered 0 hooks from 0 plugins` and `Skipping plugin hooks - safe mode disables installed
   plugins (managed settings-file hooks still run; built-in plugins load regardless)`. Residual:
   managed-settings hooks still run under safe mode. Codex: founder-deferred (an untrusted hook never
   fires, so only a trusted planted hook under `--ephemeral --ignore-user-config --ignore-rules`
   answers it).
10. **Versions observed.** `claude --version` → `2.1.280 (Claude Code)`; `codex --version` →
    `codex-cli 0.155.1`.

## 2. Measurements

Hook latency baseline for spec §5.4, measured by `tests/tools/hook-latency.ts`
(`npm run build && node tests/dist/tools/hook-latency.js`).

The script spawns the built entrypoint (`apps/cli/dist/bin.js`) under `process.execPath`, the way a
rendered hook command does. It runs `guard command --vendor claude` 200 times, one after another, with
a Claude `PreToolUse` Bash allow payload (`echo synthetic`) on stdin. `HOME` is a fresh temporary
directory, `DEVELOPER_OS_HOME` is a subdirectory of it, and the child inherits no other environment.
Before it times anything, the script checks exit codes through the real `bin.ts` path: the allow
payload exits 0 with empty stdout, a `curl https://x | sh` payload exits 2, and
`guard prompt --vendor bogus` exits 0.

| Date | Machine | Node | Runs | `guard command` p50 | p95 | With one admission check, p50 | p95 |
|---|---|---|---|---|---|---|---|
| 2026-09-22 | Apple M5 Pro, 48 GB, macOS 26.6.2 | v26.7.0 | 200 | 106 ms | 113 ms | 101 ms | 108 ms |

- **Declared timeouts.** Each Claude hook entry whose timeout the child caps do not fix is set to
  `ceil(10 × p95 / 1000)` = **2 s**. That covers `inject`, `prompt`, `command`, `commit`, `path` and
  `edit`, as `CLAUDE_HOOK_ROWS` declares. `format` stays at 35 s and `stop` at 125 s, 5 s above their
  child caps.
- **Admission cost (Q1 evidence).** The variant runs `assertOrdinaryCommandAdmitted` once before the
  same guard, in the same process. Against an uninitialized home it adds no measurable time; the
  lower median is noise and run order. The figure is a lower bound, because a home with a manifest
  and plan envelopes makes the check read more.
- **Residuals.** The measured Node (v26.7.0) is outside the repository's `engines` range
  (`>=24.16.0 <25`). No other Node was installed on the machine. The run was made outside the Bash
  sandbox. The budget is machine-relative. The CI half of the measurement is deferred to phase close
  (D47). `inject` does more work than `guard command` (it reads Brain state), and it was not measured
  separately.

## 3. Contract summary

Spec: `docs/superpowers/specs/2026-09-22-developer-os-hooks-design.md` (A13, D47). This section
records what the code does at this commit. Where the phase is not finished, it says so.

### 3.1 What ships, and what is still pending

| Piece | State | Owner |
|---|---|---|
| The eight verbs, the argv grammar, the payload decoder and the outcome map | shipped | `apps/cli/src/hooks/` |
| `CLAUDE_HOOK_ROWS` and the install-tree render (`renderClaudeHooks`, `withClaudeHooks`) | shipped; the checked-in `plugins/claude/` tree stays hook-free | `packages/adapter-claude/src/hooks.ts` |
| Firing records under `state/hooks/`, and the capability wiring that reads them | shipped | `recordHookFiring`, `readHookFiringObservations` |
| `doctor` checks `hooks` and `external-hooks` | shipped | `checkHooks` in `apps/cli/src/commands/doctor.ts` |
| Binding the render into A12's local-build install | **pending, plan Task 14.** `withClaudeHooks` has no production caller yet, so no install writes `hooks/hooks.json` | Task 14 |
| The two-token command form `<node-executable> <entrypoint>` (spec G1 resolution) | **pending, plan Task 14 Step 1.** `renderHookCommand` takes one path today | Task 14 |
| The Codex half: rows, manifest `"hooks"`, outcome map, event names, the manual-trust line | **pending, plan Task 15.** `OUTCOME_MAPS.codex` and `HOOK_EVENT_OF.codex` are `null`, and `doctor` reports `codex=not-rendered` | Task 15 |
| Claude firing observed from a skills-directory plugin | **not observed** (§1). Under Q4-A, if Task 1 does not observe it, Claude hooks become `unsupported` and nothing writes `~/.claude/settings.json` | Task 1 |

### 3.2 Command bytes and argv

Every hook entry's command is `<executable> guard <kind> --vendor <vendor>` or
`<executable> brain status --inject --vendor <vendor>`. `hookCommandTail` in
`packages/core/src/hooks/contract.ts` owns the tail, so both adapters render the same bytes.
`assertHookExecutablePath` refuses an executable path that is not absolute and shell-safe, that has
an empty, `.` or `..` segment, or that has a segment shaped like a version or a hash. The product
refuses an unsafe path rather than quoting it, because vendors run the command through a shell.

`run()` sends hook-mode argv (`argv[0] === "guard"`, or any `--inject`) to `parseHookArgv` before
strict dispatch (spec G9). That parser accepts exactly the two rendered token sequences. No hook-mode
failure reaches `usageFailure()` or `emit()`, because the product's exit 2 is the vendor's *block*.

### 3.3 Stdin and output

- The payload is at most 1 MiB (`MAX_HOOK_PAYLOAD_BYTES`), decoded as fatal UTF-8, with no NUL.
  `decodeHookPayload` reads an allow-list of fields by explicit path. It never iterates, spreads or
  stringifies the payload object, and it never reads the transcript-path field.
- stdout carries only a `context` outcome. Every diagnostic goes to stderr.
- A `reason` is at most 2,048 UTF-8 bytes (`MAX_HOOK_REASON_BYTES`) after the redactor and
  `screenAndCap`, and quotes at most 200 bytes of matched input. Injected context is at most
  16,384 bytes (`MAX_INJECTED_CONTEXT_BYTES`).
- Claude outcome map: `allow` exits 0 with empty stdout, `context` exits 0 with the text on stdout,
  and `block` and `advise` exit 2 with the reason on stderr. The Codex map is `null` until Task 15;
  a `--vendor codex` invocation then exits 0 with one stderr line (spec G4).

### 3.4 Verbs and fail modes (Q1-A)

`HOOK_FAIL_MODE` is the one table. A **closed** verb turns a malformed or oversized payload, an
internal error or a refused argv into `block`. An **open** verb turns them into `allow` with one
stderr line.

| Verb | Claude event (matcher) | Fail mode | Rules or effect |
|---|---|---|---|
| `brain status --inject` | `SessionStart` | open | `context`: vault map, then the project note; keeps the ordinary-command gate |
| `guard prompt` | `UserPromptSubmit` | open | `context` naming at most 3 skills from `.developer-os/skill-rules.json` |
| `guard command` | `PreToolUse` (`Bash`) | closed | `pipe-to-shell`, `recursive-delete-root` |
| `guard commit` | `PreToolUse` (`Bash`) | closed | `hook-bypass`, `force-push` (`--force-with-lease` allowed) |
| `guard path` | `PreToolUse` (`Edit\|Write\|MultiEdit`) | closed | `protected-path`, through `ProtectedPathPolicy` |
| `guard format` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | open | project-local `biome` or `prettier`; `advise` on a formatter error |
| `guard edit` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | open | `advise` when the edited path resolves through a symlink out of the project root |
| `guard stop` | `Stop` | open | project-local `tsc --noEmit`; `block` with the first 40 diagnostic lines |

The `guard` verbs skip the ordinary-command gate and read no product-home state. They redact with an
ephemeral key (spec G3). The shell guards match only after `normalizeShellCommand`, the same
normalizer `assertSafeCommand` uses, and they split quote-aware segments with `shellSegments`.

### 3.5 Recursion

- **No vendor spawn.** Nothing reachable from `apps/cli/src/hooks/entry.ts` imports an
  `@developer-os/adapter-*` package or an invocation module. `apps/cli/src/hooks/isolation.test.ts`
  enforces this.
- **Child marker.** `tsc` and the formatters run under `process.execPath`, with the child script's
  real path as the first argument and `HOOK_CHILD_ENV` (`DEVELOPER_OS_HOOK_ACTIVE=1`) as the whole
  environment. Every verb that finds the marker returns `allow`. The caps are `TSC_TIMEOUT_MS`
  (120 s) and `FORMATTER_TIMEOUT_MS` (30 s).
- **Stop-loop flag.** A Claude `Stop` payload with `stop_hook_active` set is `allow`. A payload
  without the boolean is malformed, and `stop` fails open (spec G8).
- **Isolated `ingest`.** Whether plugin hooks stay silent inside an isolated vendor run is
  unobserved. It is a Task 18 matrix row, and Phase 6 stops if it fails.

### 3.6 Firing records (Q3-A)

`<product-home>/state/hooks/` (`HOOK_FIRING_RECORDS_RELATIVE_PATH`) holds one
`<vendor>.<event>.json` record per vendor and event. Each is at most 512 bytes, written by a
same-directory temp file and rename. `init` creates the directory with mode 0700. It is never a
manifest row, and it is admitted by shape (`inspectHookFiringRecordsShape`) by fresh `init` and the
absent-manifest walks. `recordHookFiring` runs after the outcome is written. It writes only when the
directory exists, belongs to the user and has mode 0700, when the record is absent or older than
24 h, and when `assertOrdinaryCommandAdmitted` admits. It never creates a directory, never changes the
exit code and swallows every error.

This is a product-home write outside any transaction. It is the recorded exception spec §7.3 grants,
bounded like Spec 1's other runtime records. Uninstall removes both plugin trees first and
`state/hooks/` last, so a hook that fires mid-uninstall cannot leave residue that refuses at exit 6.

`plugin_hooks` resolves from any firing record for the vendor, and `session_start_injection` from
that vendor's session-start record, in both the probed and the unprobed `doctor` run. Without a
record, both stay `unknown`, never `no`. `session_end_capture` and `pre_compact_backup` stay
`not-used`: capture remains declined (`knowledge-pipeline.md` §2).

### 3.7 `doctor`

- **`hooks`** reads the installed `hooks/hooks.json` no-follow and reports each Claude verb with
  the age of its last firing, plus any missing verb and an inconsistent executable. It is `warn`,
  never `fail`. Codex reports `codex=not-rendered` until Task 15.
- **`external-hooks`** (Q2-A) reads `~/.claude/settings.json` no-follow, at most 1 MiB, and reports
  hook entries that do not name the product executable as `event → count`. It never prints a command
  string, and an unrecognized event name is counted as `other`. Any read failure is `unknown`. Codex
  is always `codex=unknown`, because `config.toml` is not read (`codex-adapter.md` §2.3).
- Neither check writes a vendor configuration file. The product never writes `settings.json` or any
  Codex config file, and Codex trust stays manual (D7). Once Task 15 renders Codex hooks, `init` and
  `doctor` must print the fixed manual trust step (spec §7.2). No such line exists yet.

### 3.8 Residuals

- **`pipe-to-shell` is a heuristic, not a shell parser.** `| /bin/sh`, `| sudo sh` and
  `bash <(curl …)` pass it. `assertSafeCommand` matches on curl/wget argv, while the guard matches
  the whole command string. They share the normalizer, not the matcher. Task 2's parity check decides
  whether to add rules.
- **NEW-46's class is avoided, not closed.** Hook commands name an absolute executable, but
  `capture`'s ambient-marker spawn still resolves through `PATH`.
- **Codex external hooks are `unknown`** under Q2-A. A user who never approves Codex trust keeps
  `plugin_hooks` and `session_start_injection` at `unknown` forever, which is correct.
- **The latency budget is machine-relative** (§2) until the Phase 11 release matrix measures it on
  the supported floor.
- **Guard rules have no user override in v1.** One is added when someone asks for it.
