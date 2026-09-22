# Hooks

## 1. Observation record

Written by plan Task 1, the founder's observation spike. Not yet recorded.

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
