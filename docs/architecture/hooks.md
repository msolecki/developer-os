# Hooks

## 1. Observation record

Written by A13 plan Task 1, the observation spike, on 2026-09-22 against Claude Code 2.1.280 and
Codex CLI 0.155.1 (D48). Each question gets one answer: an observed answer, `unsupported (<reason>)`
for observed non-support, or `founder-deferred (<reason>)` when only a billed model turn or a manual
Codex trust grant can answer it. Nothing was billed, nothing logged in, and no trust was granted.
Every `founder-deferred` cell was then answered on 2026-09-23 under D57 (method below).

**Isolation.** Every vendor command ran as `env -i PATH="$PATH" TMPDIR="$TMPDIR" HOME="$T"
CODEX_HOME="$T/.codex" XDG_CONFIG_HOME="$T/.config" …` with `T` a fresh `mktemp -d` under the agent's
`TMPDIR`, no `CLAUDE_CONFIG_DIR`, inside the agent's network-denying sandbox. Claude *session* rows
also set `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, a dummy `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1`, ran
`claude -p <prompt> --output-format json --debug-file …` from `$T/work`, and were killed by an alarm
(exit 142) while the CLI retried the refused connection, unless noted.

**2026-09-23 rows (D57).** Same versions, same isolation (`env -i`, fresh `mktemp -d` home `T`,
`HOME="$T" CODEX_HOME="$T/.codex" XDG_CONFIG_HOME="$T/.config"`), the same `$T/bin/dos` wrapper,
now with a per-verb mode file, and the hooks file written by `renderClaudeHooks`, but with network
and a real model turn. Rows answered this way say "(2026-09-23)".

- **Claude authentication.** macOS resolves the login keychain through `$HOME`, so
  `$T/Library/Keychains` was a symlink to the user's `~/Library/Keychains`. No credential was
  read, printed or copied by the observer: `claude` found its own unsuffixed credentials item. `CLAUDE_CONFIG_DIR` was
  **not** set for billed turns: with it set, Claude looks up a keychain item suffixed per config
  directory and reports `Not logged in · Please run /login`. Turns ran as `claude -p <prompt>
  --model claude-haiku-4-5-20251001 --output-format stream-json --verbose --max-turns ≤ 24` from
  `$T/work`, with `--permission-mode acceptEdits --allowedTools 'Bash(echo:*)'` or
  `--allowedTools Read`. The transcript under `$T/.claude/projects/` shows what reached the model.
  Nine billed `claude -p` sessions, USD 0.35 in total.
- **Codex authentication and model.** `$T/.codex/auth.json` was a symlink to the user's Codex
  `auth.json`. That account is on the free plan at its limit (`account/rateLimits/read`:
  `usedPercent: 100`, `planType: "free"`, resets 2026-10-22), so every real turn failed with
  `You've hit your usage limit`. The Codex rows were therefore observed against a **local mock
  model**: a loopback Node server set as `-c model_provider=mock -c
  'model_providers.mock={name="mock",base_url="http://127.0.0.1:<port>/v1",wire_api="responses",env_key="MOCK_KEY"}'`
  with `-m gpt-6-luna` (the default model). It served `/v1/models` from the catalog Codex had
  cached in `$T/.codex/models_cache.json`, recorded every `/v1/responses` request body, and replayed
  scripted tool calls. Without the `auth.json` link Codex ignored that cached catalog and fell back
  to a tool set without code mode, so the link stayed for the mock runs too; no request reached
  OpenAI's model endpoint. Hooks run in the CLI, so firing, payloads and exit semantics are Codex's
  own.
  "Reaches the model" means "appears in the next request body". `gpt-6-luna` runs in code mode:
  the model's one tool is `exec` (JavaScript), which calls nested tools such as
  `tools.exec_command({cmd})` and `tools.apply_patch(<patch>)`. Runs used `codex exec --json
  --skip-git-repo-check -s workspace-write` from `$T/cwork`.
- **Codex trust grant, disposable home only.** Through the app-server (`initialize`, then
  `config/batchWrite` with `{"edits": [{"keyPath": "hooks.state", "mergeStrategy": "upsert",
  "value": {"<hook key>": {"trusted_hash": "<currentHash>"}}}]}`, each key and hash copied from
  `hooks/list`). That writes `[hooks.state."<hook key>"] trusted_hash = "sha256:…"` into
  `$T/.codex/config.toml`, the same request the TUI's trust prompt uses, and `hooks/list` then
  reports `trustStatus: "trusted"`. `codex --help` also offers `--dangerously-bypass-hook-trust`;
  it was not used.
- **Teardown.** Both credential links were removed with `unlink` before `rm -rf "$T"`. The user's
  `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.codex/auth.json` and `~/.codex/hooks.json`
  kept their size and mtime.

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
   (2026-09-23): **observed firing.** One turn that ran `echo synthetic` with Bash, created a file
   with Write and changed it with Edit fired `PreToolUse` for Bash (both the `command` and
   `commit` rows), Write and Edit (`path`), `PostToolUse` for Write and Edit (`format`, `edit`), and
   `Stop` once at the end. **`MultiEdit` is unsupported (no such tool in 2.1.280):** the
   stream-json `init` event lists `Bash`, `Edit`, `Write`, `Read` and others, but no `MultiEdit`,
   so the `Edit|Write|MultiEdit` matcher's third alternative never matches.
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
   - Whether `SessionStart` and `UserPromptSubmit` stdout reaches the model (2026-09-23): **yes,
     both.** Asked to quote every line that carries the marker, the model quoted
     `SessionStart:startup hook success: <stdout>` and `UserPromptSubmit hook success: <stdout>`,
     each from a system reminder.
   - `PreToolUse`, exit 2 (2026-09-23): **blocks.** The tool does not run (the Bash redirect
     target and the Write target were both absent afterwards). The model receives a tool result
     with `is_error: true` and the content `PreToolUse:<Tool> hook error: [<command>]: <stderr>`.
   - `PreToolUse`, exit 1: non-blocking. The command ran, and the transcript records a
     `hook_non_blocking_error`. The model did not quote the stderr.
   - `PreToolUse`, exit 0 with stdout: recorded as `hook_success`, and the tool ran. The model did
     not quote the stdout, so `allow` must keep stdout empty.
   - `PostToolUse`, exit 2: the tool had already run (the file existed). The transcript records a
     `hook_blocking_error`, and `[<command>]: <stderr>` **reaches the model**, which quoted it. This
     confirms spec §4.4's `advise` = exit 2.
   - `PostToolUse`, exit 1: non-blocking, and the model did not see the stderr.
   - `Stop`, exit 2: **blocks the stop.** The model receives `Stop hook feedback:\n[<command>]:
     <stderr>` as a meta user message and continues. The next `Stop` payload carries
     `stop_hook_active: true`, and exit 0 then ends the turn.
   - `Stop`, exit 1: non-blocking; the session ended.
3. **Claude: payload field spellings.** Observed for two events (fixtures
   `tests/fixtures/hooks/claude/SessionStart.json` and `UserPromptSubmit.json`, scrubbed):
   `SessionStart` carries `session_id`, the transcript-path key, `cwd`, `hook_event_name`,
   `source`; `UserPromptSubmit` carries `session_id`, the transcript-path key, `cwd`, `prompt_id`,
   `permission_mode`, `hook_event_name`, `prompt`. `cwd` is the session working directory as an
   absolute path. The other events (2026-09-23; fixtures `PreToolUse-Bash.json`,
   `PreToolUse-Write.json`, `PreToolUse-Edit.json`, `PostToolUse-Edit.json`, `Stop.json`):
   - `PreToolUse` carries `session_id`, the transcript-path key, `cwd`, `prompt_id`,
     `permission_mode`, `hook_event_name`, `tool_name`, `tool_input` and `tool_use_id`.
     `PostToolUse` adds `tool_response` and `duration_ms`.
   - Bash: `tool_name: "Bash"`, and `tool_input` is `{command, description}`.
   - Write: `tool_input` is `{file_path, content}`. Edit: `tool_input` is `{file_path, old_string,
     new_string, replace_all}`. `file_path` is absolute. MultiEdit: unsupported (see 1).
   - `Stop` carries `session_id`, the transcript-path key, `cwd`, `prompt_id`, `permission_mode`,
     `hook_event_name`, `stop_hook_active` (a boolean, `false` on the first stop),
     `last_assistant_message`, `background_tasks` and `session_crons`.
4. **Codex: event names, matcher, tool name, file edits (§3).** The plugin `hooks.json` uses the
   Claude-shaped document `{"hooks": {"<Event>": [{"matcher": …, "hooks": [{"type": "command",
   "command": …, "timeout": …}]}]}}` with **PascalCase** event keys: `PreToolUse`, `PostToolUse`,
   `SessionStart`, `UserPromptSubmit`, `Stop` were all listed. A snake_case key (`session_start`)
   was **silently ignored**: no hook, no error, no warning. `hooks/list` reports events in
   camelCase (`preToolUse`) and keys in snake_case (`…:pre_tool_use:0:0`); the schema's full event
   set is `preToolUse`, `permissionRequest`, `postToolUse`, `preCompact`, `postCompact`,
   `sessionStart`, `sessionEnd`, `userPromptSubmit`, `subagentStart`, `subagentStop`, `stop`,
   `interrupt`. The matcher is stored verbatim (`Bash`, `shell`, `Edit|Write|apply_patch` all
   accepted without validation). The rest (2026-09-23, mock model, trusted hooks):
   - **Shell tool name: `Bash`.** A `tools.exec_command({cmd: "echo synthetic"})` call reaches the
     hook as `tool_name: "Bash"` with `tool_input.command: "echo synthetic"`. The model-facing tool is
     `exec_command`, and the `exec` code-mode wrapper fires no hook of its own.
   - **A file edit fires both events.** `tools.apply_patch(<patch>)` fired `PreToolUse` and, once
     the patch applied, `PostToolUse`, with `tool_name: "apply_patch"`. A patch that failed to apply
     fired `PreToolUse` only.
   - **Patch body, not a path.** `tool_input.command` holds the whole patch text, for example
     `*** Begin Patch\n*** Add File: note.txt\n+synthetic\n*** End Patch\n`. The grammar observed:
     `*** Begin Patch`, then per file `*** Add File: <path>`, `*** Update File: <path>` or
     `*** Delete File: <path>`, with an optional `*** Move to: <path>` right after an update
     header, then hunk headers `@@…`, body lines prefixed `+`, `-` or a space, and
     `*** End Patch`. The paths were relative to `cwd`, and could hold a subdirectory
     (`sub/other.txt`). An `Update File: note.txt` plus `Move to: moved.txt` patch renamed the file.
     `Delete File` was seen only in the `PreToolUse` payload of a patch that failed to apply.
   - **The grammar above is the observer's, not Codex's.** The mock model returned patches the
     observer scripted, so this is the grammar Codex was shown, not the grammar it accepts. A
     fresh-context review (2026-09-23) fed the same 0.155.1 binary through
     `codex --codex-run-as-apply-patch` and found it wider: Codex trims every line by Unicode
     `White_Space` before reading a header. So `*** Update File: .env` followed by a space, `\t`,
     U+00A0, U+3000 or U+0085 modified `.env`, as did the same suffix on `*** Move to:`. A header
     behind a leading space (` *** Update File: .env`) after an `Add File` or `Delete File` hunk
     was read as a header, not as a context line. `applyPatchPaths` now refuses both (§3.3).
   - **One tool set only.** Every observation used code mode with the mock model's tool list.
     Another model or tool set, and an `apply_patch` invoked from the shell tool, are unobserved.
   - **Matchers.** `Bash` matched the shell call. `apply_patch` **and** `Edit|Write` both matched
     the patch call, and the payload still said `tool_name: "apply_patch"`.
5. **Codex: field spellings and the stop-loop flag** (2026-09-23; fixtures under
   `tests/fixtures/hooks/codex/`).
   - `SessionStart`: `session_id`, the transcript-path key, `cwd`, `hook_event_name`, `model`,
     `permission_mode`, `source` (`"startup"`).
   - `UserPromptSubmit`: the same without `source`, plus `turn_id` and `prompt`.
   - `PreToolUse`: `turn_id`, `tool_name`, `tool_input` (`{command}` for both `Bash` and
     `apply_patch`) and `tool_use_id`. `PostToolUse` adds `tool_response`, a string.
   - `Stop`: `turn_id`, `stop_hook_active` (a boolean: `false` on the first stop, `true` on the stop
     that follows a blocked one) and `last_assistant_message`.
   - `cwd` is the absolute real path of the session directory. **The stop-loop flag is
     `stop_hook_active`**, spelled as on Claude.
6. **Codex: exit and output semantics** (2026-09-23, mock model).
   - `SessionStart`, exit 0 with stdout: the stdout **reaches the model** as a `developer` message
     ahead of the user prompt. Exit 2 and exit 1: non-blocking, and the stderr is not in the request.
   - `UserPromptSubmit`, exit 0 with stdout: the stdout **reaches the model** as a `developer`
     message after the prompt. Exit 2 **blocks**: no request is sent, `Stop` does not fire, and
     `codex exec` exits 0 with `turn.completed` and no agent message. Exit 1: non-blocking.
   - `PreToolUse`, exit 2: **blocks.** The command did not run and the patch did not apply. The
     model receives `Command blocked by PreToolUse hook: <stderr>. Command: <command>`. Exit 1:
     non-blocking, and the stderr is not delivered. Exit 0 with stdout: the stdout is not delivered.
   - `PostToolUse`, exit 2: the tool had already run (the file existed). The stderr **reaches the
     model** in place of the tool's result. Exit 1: non-blocking, and the stderr is not delivered.
   - `Stop`, exit 2: **blocks the stop.** The stderr reaches the model as a user message
     `<hook_prompt hook_run_id="stop:…">…</hook_prompt>`, the turn continues, and the next `Stop`
     payload has `stop_hook_active: true`. Exit 1: non-blocking; the turn ends.
   - So the Codex outcome map equals Claude's: `allow` exit 0 with empty stdout, `context` exit 0
     with stdout, and `block` and `advise` exit 2 with stderr.
   - **Timeout: unobserved.** What Codex does when a `PreToolUse` hook exceeds its `timeout`
     (`CODEX_HOOK_ROWS` gives `path` 2 s) was not observed. If it treats a timeout as non-blocking,
     as Claude does, a slow filesystem turns a 64-header patch into `allow`.

   The first observation stands: an **untrusted hook does not fire**. With the plugin hooks, and in a second run also a user
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
   trusted hook to re-trust. After a grant (2026-09-23): a trusted hook whose command or matcher
   then changed lists **`modified`**, and a hook at a key that had no grant lists **`untrusted`**.
   **Neither fires.** Only the three unchanged trusted hooks fired. The key embeds the matcher
   group's index (`…:pre_tool_use:<group>:<handler>`), so inserting a group before another moves
   that one to a new key, and it lists as `untrusted`.
9. **Isolated `ingest` (§6.3).** Claude: a planted plugin `SessionStart` hook **does not fire**
   under the ingest argv (`--tools "" --strict-mcp-config --restricted --safe-mode
   --no-session-persistence --permission-prompts none`): the wrapper logged nothing, and the debug
   log shows `Safe mode: installed plugins are disabled, none of their hooks or hooks modules load`,
   `Registered 0 hooks from 0 plugins` and `Skipping plugin hooks - safe mode disables installed
   plugins (managed settings-file hooks still run; built-in plugins load regardless)`. Residual:
   managed-settings hooks still run under safe mode. Codex (2026-09-23): with every plugin hook
   trusted (eight), `codex exec --ephemeral --ignore-user-config --ignore-rules` against the mock
   model sent its request, and the wrapper logged **nothing**. `--ignore-user-config` drops `config.toml`, and
   both the plugin's enablement and the hook trust live there. Planted trusted plugin hooks
   **do not fire** under the ingest argv.
10. **Versions observed.** `claude --version` → `2.1.280 (Claude Code)`; `codex --version` →
    `codex-cli 0.155.1`, on 2026-09-22 and again on 2026-09-23. Each is the only version tested, so
    it is the documented floor (`DOCUMENTED_FLOORS`) for `plugin_hooks` and
    `session_start_injection` on its vendor. It is not a range.

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
| Binding the render into A12's local-build install | shipped (Task 14): `init` renders both vendor trees through `withClaudeHooks` and `withCodexHooks` with the installed executable | `apps/cli/src/instructions/attach.ts` |
| The two-token command form `<node-executable> <entrypoint>` (spec G1 resolution) | shipped: `renderHookCommand` takes `{ node, entrypoint }`; the Node path is exempt from the version-or-hash rule and admits `@` | `packages/core/src/hooks/contract.ts` |
| The Codex half: `CODEX_HOOK_ROWS`, `renderCodexHooks`, `withCodexHooks` (manifest `"hooks": "./hooks/hooks.json"`), the Codex field, matcher, outcome and event maps, the `apply_patch` header grammar, the manual-trust and trust-residue lines | shipped (Task 15), from §1's 2026-09-23 observations. Checked the same day in the disposable home: the `withCodexHooks` output loaded through `hooks/list` as eight hooks with no errors, and after a trust grant, on the mock model, the built CLI blocked an `apply_patch` adding `.env` (`protected-path`) and a `curl … \| sh` (`pipe-to-shell`) and let `echo synthetic` and a `note.txt` patch through | `packages/adapter-codex/src/hooks.ts`, `apps/cli/src/hooks/` |
| Claude firing observed from a skills-directory plugin | observed for all five events (§1 question 1) | Task 1 |

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
- Outcome map, the same on both vendors (§1 questions 2 and 6): `allow` exits 0 with empty stdout,
  `context` exits 0 with the text on stdout, and `block` and `advise` exit 2 with the reason on
  stderr. Spec G4's exit-0 fallback for an unobserved Codex map is gone with the map filled.
- Codex payload fields are spelled as Claude's, except that Codex sends no file path: a Codex
  `apply_patch` call carries the patch body in `tool_input.command`. `editedPaths` reads the paths
  from its file headers through `applyPatchPaths` (`apps/cli/src/hooks/patch.ts`): `*** Begin Patch`,
  `*** Add File:`, `*** Update File:`, `*** Delete File:`, `*** Move to:`, `*** End Patch`, and body
  lines by their `@@`, `+`, `-` or space prefix only. At most 64 headers, each a relative path with no
  empty, `.` or `..` segment and no Unicode `White_Space` at either end. A line that begins or ends
  with `White_Space` and trims to `***` is refused too, because Codex reads it as a header (§1
  question 4); a context line that happens to start with ` ***` therefore blocks, fail-closed.
  Anything else is outside the grammar: `path` blocks with `patch-malformed`, and `format` and
  `edit` allow.
- A relative Codex header path resolves against the canonical session `cwd`, where Codex writes it,
  not against the project root (`relativePathBase`). A relative Claude path still resolves against
  the project root (G7).

### 3.4 Verbs and fail modes (Q1-A)

`HOOK_FAIL_MODE` is the one table. A **closed** verb turns a malformed or oversized payload, an
internal error or a refused argv into `block`. An **open** verb turns them into `allow` with one
stderr line.

| Verb | Claude event (matcher) | Codex event (matcher) | Fail mode | Rules or effect |
|---|---|---|---|---|
| `brain status --inject` | `SessionStart` | `SessionStart` | open | `context`: vault map, then the project note; keeps the ordinary-command gate |
| `guard prompt` | `UserPromptSubmit` | `UserPromptSubmit` | open | `context` naming at most 3 skills from `.developer-os/skill-rules.json` |
| `guard command` | `PreToolUse` (`Bash`) | `PreToolUse` (`Bash`) | closed | `pipe-to-shell`, `recursive-delete-root` |
| `guard commit` | `PreToolUse` (`Bash`) | `PreToolUse` (`Bash`) | closed | `hook-bypass`, `force-push` (`--force-with-lease` allowed) |
| `guard path` | `PreToolUse` (`Edit\|Write\|MultiEdit`) | `PreToolUse` (`apply_patch`) | closed | `protected-path`, through `ProtectedPathPolicy`, for every edited path |
| `guard format` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | `PostToolUse` (`apply_patch`) | open | project-local `biome` or `prettier` over every edited file still present; `advise` on a formatter error |
| `guard edit` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | `PostToolUse` (`apply_patch`) | open | `advise` when an edited path resolves through a symlink out of the project root |
| `guard stop` | `Stop` | `Stop` | open | project-local `tsc --noEmit`; `block` with the first 40 diagnostic lines |

Spec §3's snake_case Codex event names are superseded by §1 question 4: Codex 0.155.1 reads
PascalCase keys and silently ignores snake_case ones. Claude 2.1.280 has no `MultiEdit` tool, so
that matcher alternative never matches.

The `guard` verbs skip the ordinary-command gate and read no product-home state. They redact with an
ephemeral key (spec G3). The shell guards match only after `normalizeShellCommand`, the same
normalizer `assertSafeCommand` uses, and they split quote-aware segments with `shellSegments` at
`;`, `&`, `|` and an unquoted LF.

### 3.5 Recursion

- **No vendor spawn.** Nothing reachable from `apps/cli/src/hooks/entry.ts` imports an
  `@developer-os/adapter-*` package or an invocation module. `apps/cli/src/hooks/isolation.test.ts`
  enforces this.
- **Child marker.** `tsc` and the formatters run under `process.execPath`, with the child script's
  real path as the first argument and `HOOK_CHILD_ENV` (`DEVELOPER_OS_HOOK_ACTIVE=1`) as the whole
  environment. Every verb that finds the marker returns `allow`. The caps are `TSC_TIMEOUT_MS`
  (120 s) and `FORMATTER_TIMEOUT_MS` (30 s).
- **Stop-loop flag.** A `Stop` payload with `stop_hook_active` set is `allow`, on both vendors,
  which spell it the same way. A payload without the boolean is malformed, and `stop` fails open
  (spec G8).
- **Isolated `ingest`.** Planted plugin hooks did not fire under either vendor's ingest argv (§1
  question 9): Claude's safe mode skips plugin hooks, and Codex's `--ignore-user-config` drops the
  config that enables the plugin and holds its trust. The Task 18 matrix repeats this with the
  product's own hooks installed, and Phase 6 stops if it fails.

### 3.6 Firing records (Q3-A)

`<product-home>/state/hooks/` (`HOOK_FIRING_RECORDS_RELATIVE_PATH`) holds one
`<vendor>.<verb>.json` record per vendor and verb, carrying the verb's event. `command`, `commit`
and `path` share `PreToolUse`, so a per-event record let a firing `command` hide an untrusted or
modified `path`. A per-event record left by an earlier build is admitted by shape, ignored by the
reader and removed by uninstall. Each is at most 512 bytes, written by a
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

- **`hooks`** reads each vendor's installed `hooks/hooks.json` no-follow (Claude under
  `~/.claude/skills/developer-os/`, Codex under `<product-home>/codex/plugins/developer-os/`) and
  reports each verb with the age of its own last firing, plus any missing verb and an inconsistent
  executable. A Codex verb with no firing record of its own, or only one older than the installed
  `hooks.json`, adds `CODEX_UNTRUSTED_HOOK_MESSAGE` and the fixed trust step as `recovery`. A shared
  executable whose Node or entrypoint no longer exists (a Node upgrade removed the rendered path, so
  every hook exits 127, which both vendors ignore) adds `executable=missing` with `recovery`
  `developer-os init`, which takes precedence over the trust step. It is `warn`, never `fail`.
- **`external-hooks`** (Q2-A) reads `~/.claude/settings.json` no-follow, at most 1 MiB, and reports
  hook entries that do not name the product executable as `event → count`. It never prints a command
  string, and an unrecognized event name is counted as `other`. Any read failure is `unknown`. Codex
  is always `codex=unknown`, because `config.toml` is not read (`codex-adapter.md` §2.3).
- Neither check writes a vendor configuration file. The product never writes `settings.json` or any
  Codex config file, and Codex trust stays manual (D7). `init` with Codex selected prints
  `CODEX_HOOK_TRUST_STEP` as a warning, and `doctor` names it as the `hooks` recovery while a Codex
  hook has not fired. Uninstall, and an `init` that deselects Codex, print
  `CODEX_HOOK_TRUST_RESIDUE`: the `hooks.state` entries stay in the user's Codex `config.toml`.

### 3.8 Residuals

- **A heredoc body is data, never a command.** Since D62 the normalizer collapses every run of
  LF/CR/CRLF to one LF and `shellSegments` splits at an unquoted LF, but it skips a heredoc body up
  to its delimiter line, so `bash <<EOF` ⏎ `rm -rf ~` passes as it did before. A `<<` whose
  delimiter line never comes arms nothing, so later LFs still split. A quote inside a heredoc body
  opens nothing, and a `#` that starts a word comments out the rest of its line, so an apostrophe
  or a `<<` there neither swallows nor hides a later line.
- **A backslash before a line break always joins the lines.** Spec §5.2 step 2 deletes every
  backslash–newline pair before splitting, but bash does not join after an even run of backslashes
  (`echo \\` ⏎ `git push --force`) or at the end of a comment (`# note \` ⏎ `git push --force`),
  so in both the second line runs while the guards read it as part of the first. Closing it
  changes normative spec text.
- **`recursive-delete-root`, `force-push` and `hook-bypass` read only a segment's first token.**
  `sudo rm -rf /`, `rm -rf /*`, `env git push -f`, `FOO=1 git push -f`, `(git push -f)` and
  `git -c core.hooksPath=/dev/null commit` pass them. Task 2's parity check decides the rules;
  `it.todo` rows in the guard tests list the cases.
- **`pipe-to-shell` is a heuristic, not a shell parser.** `| /bin/sh` is blocked (the rule admits
  a path before the shell name), but `| sudo sh`, `curl … | tee f | sh` and `bash <(curl …)` pass
  it. `assertSafeCommand` matches on curl/wget argv, while the guard matches
  the whole command string. They share the normalizer, not the matcher. Task 2's parity check decides
  whether to add rules.
- **NEW-46's class is avoided, not closed.** Hook commands name an absolute executable, but
  `capture`'s ambient-marker spawn still resolves through `PATH`.
- **A changed Codex hook stops silently.** A trusted hook whose command, matcher or timeout changes
  lists as `modified` and does not fire, and Codex prints nothing (§1 question 8). A Node upgrade
  that moves the Node executable (G1), or a change to `CODEX_HOOK_ROWS`, therefore stops every
  affected Codex hook until the user trusts it again. Inserting a row also moves later groups of
  the same event to new keys. `doctor`'s no-firing message is the only signal; it counts a record
  older than the installed `hooks.json` as not fired.
- **The `apply_patch` grammar is a narrowing, not a proof.** `*** End of File`, a blank line, edge
  `White_Space` on a header or a `***` marker, or any other line outside §3.3 makes `guard path`
  block that patch; `format` and `edit` allow it. That is a security property only where Codex's
  own parser is no more permissive than §3.3 in the direction that matters, and §1 question 4 shows
  the observed grammar was not Codex's grammar. A Codex upgrade can widen it again; one probe of
  `--codex-run-as-apply-patch` per new floor rechecks it.
- **G7 is Claude-only.** A Codex patch path resolves against the session `cwd`. When that `cwd` is
  the user home or below it (a dotfiles repository), `ProtectedPathPolicy` is the only barrier, as
  it is for an absolute Claude path. The spec's G7 wording ("never the user home") needs the same
  refinement.
- **`guard path` does not see a shell write.** `echo … > .env` through `Bash` passes it on both
  vendors (parity with Claude). On Codex an `apply_patch` invoked from the shell tool presumably
  reaches the hook as `Bash` (unobserved), and is then not protected.
- **A Codex `PreToolUse` timeout is unobserved** (§1 question 6). If Codex does not block on it, a
  slow filesystem lets a patch through `guard path`.
- **Case-folding filesystems.** On APFS, `Add File: .ENV` with no `.env` present creates a file that
  later reads as `.env`. An existing `.env` is caught, because `realpath` restores its case. The gap
  is in `ProtectedPathPolicy`, identical on the Claude path, and is a separate task.
- **Codex external hooks are `unknown`** under Q2-A. A user who never approves Codex trust keeps
  `plugin_hooks` and `session_start_injection` at `unknown` forever, which is correct.
- **The latency budget is machine-relative** (§2) until the Phase 11 release matrix measures it on
  the supported floor.
- **Guard rules have no user override in v1.** One is added when someone asks for it.
