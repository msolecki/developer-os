---
status: current
owner: Mateusz Solecki
last-verified: 2026-10-15
---

# Hooks reference

Defined in `plugin/hooks/hooks.json`. Commands run with `${CLAUDE_PLUGIN_ROOT}` set to the installed
`plugin/` directory; each has a 10-second timeout. All three scripts run under `sh` (POSIX apart from `grep -o`, which macOS and Linux provide), need no `jq`, make no network call, and fail open.
Tests: `tests/session-start.test.sh`, `tests/guard.test.sh`, `tests/capture-nudge.test.sh`.

## SessionStart — core rules and state card

| | |
|---|---|
| Matcher | none: every source (startup, resume, clear, compact, fork) |
| Command | `sh "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"`, timeout 10 s |
| Input | the hook JSON on stdin; uses `source` and `cwd` |
| Output | stdout becomes session context |
| Limit | Claude Code caps hook output at 10,000 characters; `scripts/check.sh` caps `core.md` at 8192 bytes and checks that the card cap still fits |
| Off switch | disable the plugin; override single rules in `~/.claude/CLAUDE.md` |

**Always:** prints `plugin/rules/core.md` first.

**After `source` `compact` or `resume`**, when `cwd` is inside a git repository, it appends a state
card, cut to 1024 bytes:

```
## developer-os state card
Branch: <git branch --show-current>
Active plan: <Plan: line of the state file, else the newest docs/plans/*.md changed in 7 days, else "none found">
Worktrees:
<git worktree list, at most 10 lines>
State (docs/plans/.devos-state.md):
<the file, when it exists>
```

The state file appears only when a local agent could have written it: a regular file, with no
symlink on its path (`docs`, `docs/plans`, the file), not tracked by git, and git-ignored. A cloned
repository therefore cannot plant instructions or a link to a local secret there. The card says it
is data, not instructions, and control characters are stripped.

`docs/plans/.devos-state.md` is written by implement-backlog, pr-cycle and audit-to-backlog at every
stage change (plan, current item, agents and their worktrees, unverified claims, next step) and is
git-ignored with the plans. session-retro proposes deleting it with a finished plan. The hook reads
only the default `docs/plans/` location.

**Failure:** after the rules print, every error exits 0 with whatever was printed; malformed input,
a missing `cwd` or a directory outside git produce the rules alone.

## PreToolUse on Bash — `guard.sh`

**Input:** the hook JSON on stdin; only `tool_input.command` is used.

**Decision:** prints one line and exits 0:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"<reason>"}}
```

or prints nothing and exits 0, which leaves Claude Code's normal permission flow in charge. It never
answers `deny`. In `claude -p`, an `ask` resolves to a denial (per the README; not re-verified in the 2026-10-15 review).

| Category | Asks for | Passes |
|---|---|---|
| Dependency install | `npm`, `pnpm`, `yarn` or `bun` followed by `install`, `add` or `i` and then any non-dash word (`pnpm add zod`, `npm i -D vitest`, `pnpm --filter web add zod`) | `pnpm install`, `pnpm install --frozen-lockfile`, `npm ci`, `pnpm add -D` with flags only |
| Force push | `git push` with `--force`, a short-flag cluster containing `f`, or a `+refspec`, even next to `--force-with-lease` | `--force-with-lease` alone (including `=ref:sha`), `git push --delete`, `git push origin :branch`, `git push -n` |
| Hook bypass | `--no-verify` anywhere in a segment; `git commit` with a short-flag cluster containing `n` (`-n`, `-anm`) | `git commit -am` |

**Parsing:** JSON-unescape (`\n`, `\r`, `\t` become spaces), join backslash-newline continuations,
drop all quotes, split segments on `; & | ( )` and backtick, scan words per segment. Because quotes
are dropped, a mention such as `git commit -m "pnpm add zod"` also asks; this is deliberate.

**Known false positives** (an extra prompt, never a missed category): newline-separated commands are
one segment, so `pnpm install` followed by another command on the next line asks; a non-dash
argument after `install` (`pnpm install --filter web`, `npm install --prefix dir`) asks. See
[CURRENT-STATE.md](../CURRENT-STATE.md#known-broken-or-missing).

**Failure:** `trap 'exit 0' EXIT`; input without `{…}`, without a `command` string, or that `sed`/`awk`
cannot process produces no output.

## Stop — `capture-nudge.sh`

**Input:** the hook JSON on stdin; uses `stop_hook_active`, `agent_id`, `session_id`,
`transcript_path`.

**Exits 0 silently when any of these holds:**

| Condition | Why |
|---|---|
| `DEVELOPER_OS_CAPTURE_NUDGE=off` | User switch |
| `CLAUDE_CODE_ENTRYPOINT` starts with `sdk-` (`claude -p`, SDK) | Nobody is there to answer |
| `stop_hook_active` is `true` | The agent is already continuing because of a Stop hook |
| `agent_id` is present | A subagent stopped, not the session |
| `session_id` is empty or has characters other than `A-Z a-z 0-9 _ -` | It becomes a file name |
| `transcript_path` is not a file | Nothing to count |
| A marker for this `session_id` exists | Already nudged in this session |
| Fewer than `DEVELOPER_OS_CAPTURE_NUDGE_MIN` (default 30) `"type":"tool_use"` entries | Short session |
| A background agent or command launched in this session has no `<task-notification>` yet and its output file changed in the last 30 minutes | The turn ended to wait for it; the marker stays unspent, so the nudge comes later |
| The marker cannot be written | Fail open |

**Otherwise:** writes the marker, removes markers older than 7 days, prints to stderr

```
developer-os: this session made <n> tool calls. Run the developer-os:session-retro skill: propose the wrap-up to the user and apply only what they approve. If nothing qualifies, end your turn with no output.
```

and exits 2, which makes Claude Code feed the message back to the agent instead of stopping.

**State:** one empty file per session in `${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}}/capture-nudge/`.

**Privacy:** counts matches of one fixed string and extracts background-task ids and output-file paths (to check their notifications and modification times); never reads or prints message content.

## Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `DEVELOPER_OS_CAPTURE_NUDGE` | capture-nudge | `off` disables the nudge |
| `DEVELOPER_OS_CAPTURE_NUDGE_MIN` | capture-nudge | Tool-call threshold; non-numeric falls back to 30 |
| `CLAUDE_CODE_ENTRYPOINT` | capture-nudge | Set by Claude Code; `sdk-*` skips the nudge |
| `CLAUDE_PLUGIN_DATA` | capture-nudge | Set by Claude Code; marker directory root |
| `CLAUDE_PLUGIN_ROOT` | hooks.json | Set by Claude Code; plugin install path |
