# Vendor invocation — what the installed binaries actually accept

Recorded observations of specific vendor binary versions, produced during roadmap Phase 1 (ingest
isolation, closed 2026-09-05) so that the isolated ingest invocation is built from what was observed
running, not from memory. The plan that produced them was deleted at closure; this file is what
survives it.

Four rules govern every row below:

1. Each row records observations of a **specific vendor version**. A row is **void** when the
   vendor version changes — it must be re-observed, not assumed to still hold.
2. Every row carries the **exact command run** and its **verbatim output**. Where the output is
   long, the cell keeps the relevant lines and says exactly which ones were kept.
3. **Nothing here is inferred.** A row states what was observed; where a probe could not
   distinguish two possibilities, the row says so instead of guessing.
4. This document spent **no model credits**. Every command below is a `--help`, `--version`, or a
   static, offline generator (`codex app-server generate-json-schema`). No `-p`, no bare prompt, no
   `codex exec` with a prompt, and no interactive session was run.

## Version note

Roadmap Phase 1's own constraints were verified against Claude Code 2.1.260 and Codex 0.151.0. The binary installed on
this machine is Claude Code **2.1.261**, not 2.1.260 — a version drift discovered by running
`claude --version`. Codex is installed at 0.151.0, matching the plan exactly; no Codex row below is
affected by drift.

Because a row is void when the vendor version changes, every Claude observation the plan made
against 2.1.260 was re-run against 2.1.261 below (Claude table, rows 1-11). Result: every one of
those observations **still holds** on 2.1.261 — `--tools ""` still exists and disables all tools,
`--strict-mcp-config` still exists with the same help text, `--json-schema` still exists,
`--permission-mode` still lists the same six values with no per-value description,
`--setting-sources` still exists with help text that does not say whether `""` means "load none",
`--max-turns` still does not appear in the help, and `--restricted`, `--bare`, `--safe-mode`,
`--no-session-persistence`, `--permission-prompts` are all still present. One thing changed: the
methodology the plan used to test `--max-turns` (append `--help` and see whether the CLI errors
first) turned out **not to discriminate** on 2.1.261 — see Claude row 3 and its control test (row
4). This is a new finding, not a re-confirmation.

**F1 update:** although the `--help`-based discriminator (rows 3-4) does not work on 2.1.261, a
different credit-free discriminator does — a value-taking option given no value fails at argument
parsing regardless of `--help`, and the failure wording differs for a registered option
("argument missing") versus an unrecognized one ("unknown option"). Rows 14-17 apply this and
settle registration: `--max-turns` is a real, registered, value-taking option on 2.1.261, hidden
from `--help` on purpose (`.hideHelp()`), with an embedded description stating it applies in
non-interactive mode. Whether it bounds a real run the way the adapter expects was not observed
and would need a session. See the note after row 17 for the full chain of evidence.

## Binaries actually executed

| Field | Claude | Codex |
|---|---|---|
| `which` | `/Users/msolecki/.local/bin/claude` | `/Users/msolecki/.local/bin/codex` |
| `readlink -f` | `/Users/msolecki/.local/share/claude/versions/2.1.261` | `/Users/msolecki/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/bin/codex` |
| `file` on the resolved target | `Mach-O 64-bit executable arm64` | `Mach-O 64-bit executable arm64` |
| `--version` | `2.1.261 (Claude Code)` | `codex-cli 0.151.0` |

The resolved absolute paths above (not the `which` symlinks) were used for the `env -i` probes in
the Claude/Codex table's `env -i` rows.

## Claude (`claude`)

All rows: vendor version `2.1.261 (Claude Code)`, date `2026-09-05`.

| # | observation | command | verbatim output | vendor version | date |
|---|---|---|---|---|---|
| 1 | `--max-turns` does not appear in `--help` | `claude --help 2>&1 \| grep -c -- "--max-turns"; echo "exit: $?"` | `0`<br>`exit: 1` (observed: `grep -c` exits 1 when the count is zero) | 2.1.261 | 2026-09-05 |
| 2 | `--tools ""` exists and disables all tools, per its own help text | `claude --help 2>&1 \| grep -A3 -- "--tools <tools"` | `--tools <tools...>                    Specify the list of available tools from`<br>`                                        the built-in set. Use "" to disable all`<br>`                                        tools, "default" to use all tools, or`<br>`                                        specify tool names (e.g.`<br>`                                        "Bash,Edit,Read").` | 2.1.261 | 2026-09-05 |
| 3 | `claude --max-turns 5 --help` does not distinguish "accepted" from "rejected" | `claude --max-turns 5 --help 2>&1` (piped to a file, `diff`'d against `claude --help` alone) | Exit `0`. Byte-identical to plain `claude --help` (304 lines, `diff` reported no difference). No error, no mention of `--max-turns` anywhere in the output. | 2.1.261 | 2026-09-05 |
| 4 | **Control test proving row 3's method is broken on 2.1.261**: a deliberately nonexistent flag produces the *same* result as row 3 | `claude --this-flag-does-not-exist-xyz 5 --help 2>&1` (diff'd against plain `claude --help`) | Exit `0`. Byte-identical to plain `claude --help` — same as row 3. This is the plan's own discriminator methodology (Task 1 Step 2: "a CLI that rejects unknown flags errors before reaching `--help`") applied to a flag known not to exist. Because a genuinely unknown flag produces the identical exit-0/identical-output result as `--max-turns` did, **the discriminator does not discriminate on 2.1.261**: appending `--help` after any option — registered or not — short-circuits argument validation and always prints help with exit 0. | 2.1.261 | 2026-09-05 |
| 5 | The same nonexistent flag, run *without* `--help`, is rejected immediately and does not open a session | `claude --this-flag-does-not-exist-xyz 5` (run in background, killed after 3s if still alive) | Exit `1`, returned immediately (no 3-second wait needed): `error: unknown option '--this-flag-does-not-exist-xyz'`. No interactive session opened. | 2.1.261 | 2026-09-05 |
| 6 | `--setting-sources ""` does not distinguish "accepted" from "silently ignored" | `claude --setting-sources "" --help 2>&1` (diff'd against plain `claude --help`) | Exit `0`. Byte-identical to plain `claude --help`. Same ambiguity as the plan recorded for 2.1.260; unresolved. | 2.1.261 | 2026-09-05 |
| 7 | `--setting-sources none` **is** rejected, with a value-validation error that fires before `--help` is honored | `claude --setting-sources none --help 2>&1` | Exit `1`. First line: `Error processing --setting-sources: Invalid setting source: none. Valid options are: user, project, local` (no help text printed at all). This shows the `--help`-short-circuit behavior in row 3/4 is specific to genuinely *unknown* options; an option that exists but has a validated value type is checked eagerly regardless of `--help`. | 2.1.261 | 2026-09-05 |
| 8 | `--permission-mode`'s six values, verbatim, with no per-value description | `claude --help 2>&1 \| grep -A5 -- "--permission-mode"` | `--permission-mode <mode>              Permission mode to use for the session`<br>`                                        (choices: "acceptEdits", "auto",`<br>`                                        "bypassPermissions", "manual",`<br>`                                        "dontAsk", "plan")` | 2.1.261 | 2026-09-05 |
| 9 | `--strict-mcp-config` exists; with no `--mcp-config`, its own text says it loads zero MCP servers | `claude --help 2>&1 \| grep -A3 -- "^  --strict-mcp-config"` | `--strict-mcp-config                   Only use MCP servers from --mcp-config,`<br>`                                        ignoring all other MCP configurations` | 2.1.261 | 2026-09-05 |
| 10 | `--json-schema` exists | `claude --help 2>&1 \| grep -A3 -- "--json-schema"` | `--json-schema <schema>                JSON Schema for structured output`<br>`                                        validation. Example:`<br>`                                        {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}` | 2.1.261 | 2026-09-05 |
| 11 | `--restricted`, `--bare`, `--safe-mode`, `--no-session-persistence`, `--permission-prompts` are all present | `claude --help 2>&1 \| grep -A3 -- "--restricted\b\|--bare\b\|--safe-mode\b\|--no-session-persistence\b\|--permission-prompts\b"` | All five appear with full help text (kept: the flag names and their first description line each). `--restricted`: "Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell, REPL and the other code-running tools) and WebFetch unless...". `--bare`: "Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery...". `--safe-mode`: "Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings, and more) disabled...". `--no-session-persistence`: "Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)". `--permission-prompts`: "Who answers permission prompts with --print: \"host\" (the SDK host or --permission-prompt-tool) or \"none\" (nobody: anything that would prompt is denied automatically...)". | 2.1.261 | 2026-09-05 |
| 12 | `-h` and `--help` are identical | `claude -h 2>&1` diff'd against `claude --help 2>&1` | No diff output — byte-identical, 304 lines each. | 2.1.261 | 2026-09-05 |
| 13 | `env -i` with an empty environment still prints help | `env -i /Users/msolecki/.local/share/claude/versions/2.1.261 --help >/dev/null 2>&1; echo $?` | `0` | 2.1.261 | 2026-09-05 |
| 14 | Control (a): a known, value-taking option given no value fails at argument parsing, with an "argument missing" shape | `claude --output-format` (no value, no `--help`, no prompt; run in background, would be killed at 3s if still alive) | Returned well inside the 3s window, no kill needed. Exit `1`. Stderr: `error: option '--output-format <format>' argument missing` | 2.1.261 | 2026-09-05 |
| 15 | Control (b): an unknown option given no value fails at argument parsing, with an "unknown option" shape — distinct wording from row 14 | `claude --this-flag-does-not-exist-xyz` (no value, no `--help`, no prompt; same background/3s-kill shape) | Returned well inside the 3s window, no kill needed. Exit `1`. Stderr: `error: unknown option '--this-flag-does-not-exist-xyz'` | 2.1.261 | 2026-09-05 |
| 16 | **F1 settled**: `claude --max-turns` given no value produces the *same* shape as the known-option control (row 14), not the unknown-option control (row 15) — `--max-turns` is a registered, value-taking option on 2.1.261 | `claude --max-turns` (no value, no `--help`, no prompt; same background/3s-kill shape) | Returned well inside the 3s window, no kill needed. Exit `1`. Stderr: `error: option '--max-turns <turns>' argument missing` — matches row 14's "argument missing" shape exactly, not row 15's "unknown option" shape. | 2.1.261 | 2026-09-05 |
| 17 | Static evidence (d), independent of row 16: the resolved Mach-O binary contains the literal option string, registered via a hidden-option code path | `strings -a /Users/msolecki/.local/share/claude/versions/2.1.261 \| grep -c -- "max-turns"` and `\| grep -m5 -- "max-turns"` | Count: `9`. First three matches are short and kept verbatim: `max-turns-note-forgery`, `--max-turns`, `--max-turns <turns>`. The remaining six matches are single lines from a minified JS bundle ranging 3-51KB each — not reproduced verbatim for size, but one, searched for the `--max-turns` substring in context, reads: `` addOption(new Y("--max-turns <turns>","Maximum number of agentic turns in non-interactive mode. This will early exit the conversation after the specified number of turns. (only works with --print)").argParser(Ai).hideHelp()) `` — confirming the option is registered with `.hideHelp()`, which is exactly why it never appears in `--help` (rows 1, 3-4). | 2.1.261 | 2026-09-05 |
| 18 | `--restricted`'s complete verbatim help entry | `claude --help 2>&1 \| grep -A12 -- "^  --restricted"` (widened to `-A15` here because `-A12` cuts the entry off mid-sentence, one line short of its end; the two extra lines were needed to reach the sentence's own full stop, and the resulting `-A15` output's final line, which belongs to the next option `-r, --resume`, is trimmed below) | `Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell, REPL and the other code-running tools) and WebFetch unless --tools names them, and ignores user, project and local settings files (managed settings and --settings still apply; add --strict-mcp-config to skip MCP servers too). Also confines the file tools to the working directories (--add-dir included), refuses bypassPermissions, and lets only a person or the configured permission handler approve writes to settings, git and tool-configuration files.` | 2.1.261 | 2026-09-05 |
| 19 | `--safe-mode`'s complete verbatim help entry | `claude --help 2>&1 \| grep -A12 -- "^  --safe-mode"` (widened to `-A15` for the same reason as row 18; the trailing lines belonging to the next option, `--session-id`, are trimmed below) | `Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings, and more) disabled — useful for troubleshooting a broken configuration. Admin-managed (policy) settings still apply. Auth, model selection, built-in tools, and permissions work normally. Sets CLAUDE_CODE_SAFE_MODE=1.` | 2.1.261 | 2026-09-05 |
| 20 | `--no-session-persistence`'s complete verbatim help entry | `claude --help 2>&1 \| grep -A12 -- "^  --no-session-persistence"` (the entry itself is 3 lines and ends well inside the `-A12` window; the remaining lines returned belong to the next three options — `--output-format`, `--permission-mode`, `--permission-prompts` — and are trimmed below) | `Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)` | 2.1.261 | 2026-09-05 |
| 21 | `--permission-prompts`'s complete verbatim help entry | `claude --help 2>&1 \| grep -A12 -- "^  --permission-prompts"` (the entry itself is 8 lines and ends inside the `-A12` window; the remaining lines returned belong to the next two options — `--plugin-dir`, `--plugin-url` — and are trimmed below) | `Who answers permission prompts with --print: "host" (the SDK host or --permission-prompt-tool) or "none" (nobody: anything that would prompt is denied automatically; the permission mode still decides everything else) (choices: "host", "none", default: "host")` | 2.1.261 | 2026-09-05 |

**F1's registration question is now settled (rows 14-17), without a model turn.** Rows 14 and 15
establish that this build produces two distinguishable error shapes for a value-taking option
given no value: a *registered* option says `argument missing`, an *unrecognized* one says `unknown
option`. Row 16 shows `--max-turns` produces the `argument missing` shape — it is registered. Row
17 corroborates this statically: the binary contains `.hideHelp()`-registered code for exactly
this flag, naming its value placeholder `<turns>` and carrying an embedded description that says
it applies "in non-interactive mode" and "only works with --print". **What was observed, stated
without inferring past it**: the flag is real, hidden from `--help` on purpose, requires a value
named `<turns>`, and its own embedded description says it applies in non-interactive mode. Whether
it actually bounds a real run the way `packages/adapter-claude/src/invoke.ts` expects — or does
anything at all with the value it is given — was not observed here; a help string is a claim the
binary makes about itself, not a run of the code path it describes, and settling that needs a
session, which Task 1 does not cross. What Task 1 still cannot show without a real run is whether
passing a *valid* value (`--max-turns 5`) succeeds all the way through a live invocation and
produces the bound the adapter relies on — but the earlier "is it even a real flag" question, which
the Step 2 discriminator failed to answer, is closed.

**Weaker evidence, stated explicitly (row 13):** a zero exit under `env -i --help` shows the binary
*starts* and can print help with no environment variables at all. It does **not** show that a real
invocation (auth, network, model turn) succeeds with an empty environment — that would need a real
run, which is a founder stop condition this task does not cross. Treat row 13 as evidence about
process startup only.

**Permission-mode ordering (Step 4): unresolved, not guessed.** The help text (row 8) gives no
per-value description and no probe run here distinguishes the six values' relative strictness.
Per the brief, this is recorded as unresolved rather than inferred from the names. Prefer `--tools
""` plus `--strict-mcp-config` (rows 2 and 9), which are unambiguous, over selecting a
`--permission-mode` value by guess.

## Codex (`codex`)

All rows: vendor version `codex-cli 0.151.0`, date `2026-09-05`.

| # | observation | command | verbatim output | vendor version | date |
|---|---|---|---|---|---|
| 1 | `codex exec --help`'s isolation-relevant entries | `codex exec --help 2>&1` | `--ephemeral` → "Run without persisting session files to disk". `--ignore-user-config` → "Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`". `--ignore-rules` → "Do not load user or project execpolicy `.rules` files". `--json` → "Print events to stdout as JSONL". `--output-schema <FILE>` → "Path to a JSON Schema file describing the model's final response shape". `-s, --sandbox <SANDBOX_MODE>` → "Select the sandbox policy to use when executing model-generated shell commands" (possible values: read-only, workspace-write, danger-full-access). `--skip-git-repo-check` → "Allow running Codex outside a Git repository". `-C, --cd <DIR>` → "Tell the agent to use the specified directory as its working root". | 0.151.0 | 2026-09-05 |
| 2 | No flag in `codex exec --help` disables MCP servers for one call | `codex exec --help 2>&1` (full text read; searched for any MCP-disabling flag) | No flag among the ~25 options listed touches MCP server loading. The nearest lever is `--ignore-user-config`, which stops `$CODEX_HOME/config.toml` from loading at all (and with it, any MCP servers configured there) — a config-wide switch, not a per-call MCP toggle. | 0.151.0 | 2026-09-05 |
| 3 | `--ephemeral`, `--ignore-user-config`, `--ignore-rules` exist only on `codex exec`, not top-level | `codex --help 2>&1 \| grep -n -- "--ephemeral\|--ignore-user-config\|--ignore-rules"` | No matches — none of the three strings appear anywhere in top-level `codex --help`. | 0.151.0 | 2026-09-05 |
| 4 | `codex app-server generate-json-schema` requires `--out <DIR>` | `codex app-server generate-json-schema 2>&1` | Exit `2`. `error: the following required arguments were not provided:`<br>`  --out <DIR>`<br><br>`Usage: codex app-server generate-json-schema --out <DIR>` | 0.151.0 | 2026-09-05 |
| 5 | With `--out`, the v2 protocol's `TurnCompletedNotification` and `Turn` carry no `last_agent_message` field | `codex app-server generate-json-schema --out <scratch-dir>` (static, offline; then `v2/TurnCompletedNotification.json` was read) | `TurnCompletedNotification` schema: `properties: {threadId: string, turn: $ref Turn}`, `required: [threadId, turn]`. `Turn` schema: `properties: {id, items: ThreadItem[], status, startedAt, completedAt, durationMs, error, itemsView}`, `required: [id, items, status]`. Neither object defines a `last_agent_message` (or `lastAgentMessage`) property. | 0.151.0 | 2026-09-05 |
| 6 | The v2 protocol carries the agent's reply as a `ThreadItem` of type `agentMessage`, inside `turn.items` | Same generator run as row 5; `ThreadItem`'s `oneOf` variants read from the same schema file | One `ThreadItem` variant: `title: "AgentMessageThreadItem"`, `properties: {id: string, text: string, type: "agentMessage", delivery, memoryCitation, phase}`, `required: [id, text, type]`. This matches the plan's F3 description exactly. | 0.151.0 | 2026-09-05 |
| 7 | `env -i` with an empty environment still prints `codex exec --help` | `env -i /Users/msolecki/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/bin/codex --help >/dev/null 2>&1; echo $?` | `0` | 0.151.0 | 2026-09-05 |

**F3's evidence gap, stated explicitly (rows 5-6):** Task 1 has **no source-reading step**; the
only evidence gathered here is the static, offline `app-server generate-json-schema` output above.
`app-server` speaks JSON-RPC — a different interface from `codex exec --json`'s JSONL stream, which
is what the shipped adapter actually parses. `codex exec --help` (row 1) shows that `--json` prints
"events" as JSONL and `--output-schema` shapes the *final* response, but neither flag's help text
describes the JSONL event schema itself, and no probe here inspected one (running `codex exec
--json` with a prompt would open a model turn, which this task refuses per the safety rule). So
rows 5-6 are suggestive — the same "agentMessage" vocabulary the app-server protocol uses is also
what the shipped `finalAgentMessage` code already reads from 0.147.0 JSONL fixtures — but not
conclusive proof that the 0.151.0 `codex exec --json` stream matches the app-server protocol's
shape. This gap is exactly what the plan's F3 row already says: "suggestive and not conclusive."

**Weaker evidence, stated explicitly (row 7):** same caveat as the Claude table's row 13 — `--help`
succeeding under `env -i` is not evidence a real `codex exec` run succeeds with no environment.

### Source rows (Task 4, F3 / NEW-47) — distinct from the probes above

Rows 1-7 above are **binary probes**: they run the installed 0.151.0 executable and record what it
prints. Rows 8-12 below are **source reads**: they quote the public Rust source at GitHub
`openai/codex`, tag `rust-v0.151.0`, which dereferences to commit
`78c290807ce710180111df227df3b7a4fe845452` (verified with
`gh api repos/openai/codex/git/tags/d8673cb68e349c208659b986697773d3145dbb14 --jq '.object.sha, .tag'` —
`d8673cb68e349c208659b986697773d3145dbb14` is the *annotated tag object's own sha*, not the commit it
points at; the commit is what is cited below). Fetched with
`gh api "repos/openai/codex/contents/<path>?ref=rust-v0.151.0" --jq '.content' | base64 -d`. A source
row is evidence about what the vendor's code is written to do; it is not a run and is weaker than a
probe exactly where behaviour depends on runtime conditions (see the note after row 12). Every row
was corroborated against the installed binary before being trusted — see the corroboration note
below the table.

| # | observation | source location (at `rust-v0.151.0`) | verbatim quote | vendor version | date |
|---|---|---|---|---|---|
| 8 | The exact set of `codex exec --json` event `type` values | `codex-rs/exec/src/exec_events.rs`, `enum ThreadEvent` | `#[serde(tag = "type")]`<br>`pub enum ThreadEvent { ... }` with variants tagged `#[serde(rename = "thread.started")]`, `"turn.started"`, `"turn.completed"`, `"turn.failed"`, `"item.started"`, `"item.updated"`, `"item.completed"`, `"error"` | 0.151.0 | 2026-09-05 |
| 9 | `turn.completed` exists but carries only a usage record, no final-message field | `codex-rs/exec/src/exec_events.rs`, `struct TurnCompletedEvent` | `pub struct TurnCompletedEvent {`<br>`    pub usage: Usage,`<br>`}` — no other field | 0.151.0 | 2026-09-05 |
| 10 | The final message reaches the user only through a separate file-write flag, never through the `--json` stream | `codex-rs/exec/src/cli.rs`, `Cli.last_message_file` | `/// Specifies file where the last message from the agent should be written.`<br>`#[arg(long = "output-last-message", short = 'o', value_name = "FILE", global = true)]`<br>`pub last_message_file: Option<PathBuf>,` | 0.151.0 | 2026-09-05 |
| 11 | The wire item-type tag for an agent reply is `agent_message` (snake_case), matching `finalAgentMessage`'s check, and distinct from the app-server v2 protocol's `agentMessage` (row 6) | `codex-rs/exec/src/exec_events.rs`, `enum ThreadItemDetails` | `#[serde(tag = "type", rename_all = "snake_case")]`<br>`pub enum ThreadItemDetails { AgentMessage(AgentMessageItem), ... }` | 0.151.0 | 2026-09-05 |
| 12 | The vendor's own equivalent of `finalAgentMessage` selects the *last* `agent_message` in a turn, and the streaming path that emits `item.completed`/`agent_message` onto the JSONL stream overwrites its notion of "the final message" on every such item as the stream is produced — both are last-wins | `codex-rs/exec/src/event_processor_with_jsonl_output.rs`, `fn final_message_from_turn_items` and the `ServerNotification::ItemCompleted` arm of `fn collect_thread_events` | `items.iter().rev().find_map(|item| match item { ThreadItem::AgentMessage { text, .. } => Some(text.clone()), _ => None })` — and — `if let ThreadItemDetails::AgentMessage(AgentMessageItem { text }) = &item.details { self.final_message = Some(text.clone()); }` (this second block runs once per `ItemCompleted` notification, so a later `agent_message` overwrites an earlier one) | 0.151.0 | 2026-09-05 |

**Binary corroboration (Task 4, item 2 of the brief):** before trusting rows 8-12, the literal wire
strings named in the fetched source were searched for in the installed Mach-O binary with `strings -a
<binary> | grep -F -- "<literal>"`. All matched: `thread.started` (7), `turn.started` (1),
`turn.completed` (1), `turn.failed` (1), `item.started` (1), `item.updated` (1), `item.completed` (1),
`agent_message` (44), `output-last-message` (1), `ignore-user-config` (1), `ignore-rules` (1),
`output-schema` (1), `thread_id` (399) — counts are `grep -c` results, not claims about how many times
each string is used at runtime. One literal did **not** match: `AgentMessageThreadItem` (0) — that
string is the JSON-Schema `title` field `app-server generate-json-schema` emits for its v2-protocol
type (already recorded above, row 6), not a wire tag `codex exec --json` ever prints, so its absence
from the binary's strings does not weaken rows 8-12. Because every wire-tag literal that source claims
this build emits was found in the binary, rows 8-12 are treated as describing the installed 0.151.0
build, not merely a same-numbered release that could differ.

**What source settles and what it does not, stated separately from the probes' own caveats.** Row 9
settles, from the struct definition rather than one recording, that `turn.completed` cannot carry a
final-message field in this version — there is no such field to add, so Task 4 Step 2's outcome 1
("prefer `turn.completed`'s final-message field") does not apply. Row 12 settles that the vendor's
own code already implements last-wins as its intended selection rule when more than one
`agent_message` exists in a turn — but it does not settle, and cannot settle from source alone,
whether a real turn against this product's schema-constrained prompts ever actually emits more than
one; that is a runtime fact `BACKLOG.md` §1 NEW-45 still owns. Row 11 settles the field-name question
outright: `agent_message` is unchanged in 0.151.0, so no rename risk exists for this version.

**Fixture-currency check (Task 4, item 6 of the brief).** `tests/fixtures/codex/` recordings were
captured against `codex-cli 0.147.0` (see that directory's README). Comparing those recordings
field-for-field against the 0.151.0 struct definitions above: every event `type` value the fixtures
use (`thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`) matches a
0.151.0 `ThreadEvent` variant tag exactly; the fixtures' `turn.completed.usage` object's five fields
(`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`,
`reasoning_output_tokens`) match `struct Usage` in `exec_events.rs` field-for-field, in the same
order; and the fixtures' `agent_message` item shape (`id`, `type`, `text`) matches
`AgentMessageItem`/`ThreadItem`. No field or tag drift was found between what the 0.147.0 fixtures
show and what the 0.151.0 source defines. This is a **shape comparison against source**, not a new
observed run of 0.151.0 — it does not prove the 0.147.0 recordings are what a live 0.151.0 turn
produces, only that the wire schema the source defines has not changed in a way the fixtures would
have missed.

## Task 6: the vendor child process environment (F2), decided 2026-09-05

**Decision: the empty environment is retained. No variable is admitted.** Both
adapters pass `env: {}` today (`packages/adapter-claude/src/invoke.ts:139`,
`packages/adapter-codex/src/invoke.ts:324`), so both vendors start with **no
environment at all** — not `HOME`, not a proxy variable, nothing inherited
from the parent. Task 1 Step 6 recorded both binaries exiting `0` under
`env -i … --help` (Claude row 13, Codex row 7 above), and no observation
anywhere in this document — across Tasks 1, 4 or 6 — records either vendor
failing for want of a variable. Per the Task 6 brief's own Step 1, this is the
expected outcome, and it is what the plan's roadmap correction sanctions.
`EXPECTED_VENDOR_ENVIRONMENT` in `tests/security/network.test.ts:72` remains
the single place a future admission would be made, and it may be made only
against a recorded observation of a vendor failing without the variable —
never for a proxy variable, which `tests/security/network.test.ts:228`
(`"does not pass a proxy the parent process was given"`) already proves does
not reach the child.

**What an empty environment does not buy — established for these two
binaries, not assumed.** An empty environment removes every inherited
variable; it does not by itself stop a child from locating the invoking
user's real home directory, because a process with no `HOME` can still
resolve one from the system password database. The brief's suggested
comparison (`env -i <path> --help` against a config-discovery command) cannot
settle this for either binary: the Claude table's rows 3-4 already establish
that appending `--help` after *any* option or subcommand short-circuits
argument parsing and always prints help without running the command's own
logic, so `env -i <claude> doctor --help` and `env -i <codex> exec --help`
diff byte-identically against their non-`env -i` counterparts (verified
below) and never exercise whatever config-discovery code a real run would.
What settles the question instead is a static, offline check of the same kind
already used for row 17 (`strings -a`) — here `nm -u`, which lists a Mach-O
binary's *undefined dynamic symbols*, i.e. the libc functions the binary's own
code actually calls into, not merely text that happens to appear in it:

| # | observation | command | verbatim output | vendor version | date |
|---|---|---|---|---|---|
| 1 | `env -i` does not change Claude's `doctor --help` output — the `--help` short-circuit (Claude table rows 3-4) applies to subcommands too, so this probe cannot exercise real config discovery | `diff <(env -i /Users/msolecki/.local/share/claude/versions/2.1.261 doctor --help 2>&1) <(/Users/msolecki/.local/share/claude/versions/2.1.261 doctor --help 2>&1)` | No output; `diff` exit `0` (byte-identical) | 2.1.261 | 2026-09-05 |
| 2 | Same short-circuit holds for Codex's `exec --help` | `diff <(env -i <codex-path> exec --help 2>&1) <(<codex-path> exec --help 2>&1)` | No output; `diff` exit `0` (byte-identical) | 0.151.0 | 2026-09-05 |
| 3 | Claude's installed binary imports `getpwuid_r` as an undefined dynamic symbol — the libc call that resolves a home directory from the password database, and the one Node's `os.homedir()`/libuv fall back to when `$HOME` is unset | `nm -u /Users/msolecki/.local/share/claude/versions/2.1.261 \| grep -i "getpwuid\|homedir"` | `_getpwuid_r` | 2.1.261 | 2026-09-05 |
| 4 | Codex's installed binary imports both `getpwuid` and `getpwuid_r` as undefined dynamic symbols | `nm -u <codex-path> \| grep -i "getpwuid\|homedir"` | `_getpwuid`<br>`_getpwuid_r` | 0.151.0 | 2026-09-05 |

**What rows 3-4 of the table above establish, stated at the strength they support.** An
undefined dynamic symbol is one the dynamic linker must resolve at load time
because the binary's own compiled code calls it — this is stronger than a
`strings -a` text match (which can hit a coincidental data string) but still
short of a live run: it shows the binary *carries the capability* to resolve
a home directory via the password database, not that this path executes on
every invocation or specifically when `HOME` is unset. No permitted probe
(`--help`, `--version`, `-h` only; no prompt, no bare interactive) can observe
that condition directly, because — per rows 1-2 above — the only way to
reach a subcommand's real logic is to run it without `--help`, which this
task's safety rule forbids. **The consequence, not the mechanism, is the
point:** whatever a vendor can independently discover about the invoking
user (a home directory, and through it whatever that directory's ownership
or existence reveals) is not something `env: {}` closes off. Isolation from
the user's own settings and hooks is bought by the flags Tasks 2 and 3 added
— `--restricted`, `--safe-mode` and `--strict-mcp-config` for Claude
(`packages/adapter-claude/src/invoke.ts:87-118`); `--ignore-user-config` and
`--ignore-rules` for Codex (`packages/adapter-codex/src/invoke.ts:289-297`)
— not by the empty environment. A future change that relaxes any of those
flags is not compensated for by `EXPECTED_VENDOR_ENVIRONMENT` staying `{}`.

## What an isolated Claude run still writes and still sends, observed 2026-09-05

Recorded because the isolation this product buys is narrower than the flag names suggest, and a
reader who assumes otherwise will assume too much. Both observations come from Task 8's harness
(`tests/integration/ingest/no-user-hooks.test.ts`), which runs the real binary with the shipped
argv against a temporary `HOME`, pointing `ANTHROPIC_BASE_URL` at a loopback port nothing listens
on and supplying a fake key, so no model turn can complete.

- **`--no-session-persistence` does not stop the run writing into `HOME`.** Against a genuinely
  fresh home, one isolated invocation durably creates `.claude.json`, `.claude/.last-cleanup`,
  `.claude/backups/` with a timestamped snapshot of `.claude.json`, and `.claude/sessions/` holding
  a per-process `.json` and `.key`. The flag's own help text says sessions "will not be saved to
  disk and cannot be resumed"; what was observed is narrower than that sentence. The harness pins
  this set, so a change in it fails a test rather than passing unnoticed.
- **This compounds with the empty environment.** The child is handed `env: {}`, so it has no
  `HOME` of its own and resolves one through `getpwuid_r` (see the Task 6 section above) — which
  means the files above land in the *developer's real* `~/.claude` during a production ingest run,
  not in a sandbox. The test avoids this only because it sets `HOME` explicitly, which production
  does not.
- **The run opens outbound HTTPS to an Anthropic-owned address even with the base URL overridden.**
  Observed during the un-isolated control run. It is not the model API — the override points
  elsewhere and the key is fake, so no billable request can complete — and it is most likely
  telemetry or an update check. Recorded so nobody reads "unreachable base URL" as "no network".

## The Codex half of the hook harness was not built, and why

Task 8 proved for Claude that a planted user hook does not fire under the shipped argv. The
equivalent for Codex was investigated through `codex exec --help` and `strings` only, with no
`exec` run. Codex does have hooks — `SessionStart` among them, configured as
`HookHandlerConfig::Command` in `config.toml` — but the TOML shape is undocumented, unlike
Claude's spelled-out example, and hooks additionally require a persisted trust step with no
recorded mechanism. That is more than a test's worth of unknowns. Owner: roadmap Phase 6 (A13),
which specifies hook installation for both vendors and is where the trust step belongs.

## Probes not run, and why

- `claude --max-turns 5` **without** `--help` (would test whether `--max-turns` is genuinely
  unregistered without the `--help` short-circuit): refused. If `--max-turns` turns out to be a
  registered option, an invocation with no `-p` and no prompt following it is exactly the shape
  of an interactive session start, which the safety rule forbids regardless of intent. Row 5's
  control test (a flag *known* not to exist) shows an unrecognized option is rejected immediately
  and safely — but that does not license running an option of unknown status the same way.
- `codex exec --json` with any prompt, or `codex exec` interactively: refused outright — a model
  turn, forbidden by the safety rule.
- No probe hung longer than a few seconds; none needed to be killed.
