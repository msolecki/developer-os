#!/bin/sh
# Tests for plugin/hooks/capture-nudge.sh with synthetic hook input and transcripts.
# Run from the repository root: sh tests/capture-nudge.test.sh
hook="$(pwd)/plugin/hooks/capture-nudge.sh"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0

# transcript FILE N: a JSONL file with N tool_use entries.
transcript() {
  : > "$1"
  i=0
  while [ "$i" -lt "$2" ]; do
    printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t%s","name":"Read"}]}}\n' "$i" >> "$1"
    i=$((i + 1))
  done
}

# run JSON [ENV=VALUE...]: runs the hook with a fresh environment, sets $code and $err.
run() {
  json=$1
  shift
  err=$(printf '%s' "$json" | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/data" "$@" sh "$hook" 2>&1 >/dev/null)
  code=$?
}

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

transcript "$tmp/long.jsonl" 31
transcript "$tmp/short.jsonl" 5
input() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","stop_hook_active":false%s}' "$1" "$2" "${3:-}"; }

run "$(input s1 "$tmp/long.jsonl")"
check "fires above threshold" "$code" 2
case $err in *session-retro*"31 tool calls"* | *"31 tool calls"*session-retro*) r=yes ;; *) r=no ;; esac
check "reminder names session-retro and the count" "$r" yes
[ -f "$tmp/data/capture-nudge/s1" ] && r=yes || r=no
check "marker created" "$r" yes

run "$(input s1 "$tmp/long.jsonl")"
check "second call in the same session" "$code" 0

run "$(input s2 "$tmp/short.jsonl")"
check "below threshold" "$code" 0

run "$(input s3 "$tmp/short.jsonl")" DEVELOPER_OS_CAPTURE_NUDGE_MIN=3
check "custom threshold" "$code" 2

run "$(input s4 "$tmp/long.jsonl" | sed 's/"stop_hook_active":false/"stop_hook_active": true/')"
check "stop_hook_active true" "$code" 0

run "$(input s5 "$tmp/long.jsonl" ',"agent_id":"a1","agent_type":"Explore"')"
check "subagent (agent_id present)" "$code" 0

run "$(input s6 "$tmp/long.jsonl")" DEVELOPER_OS_CAPTURE_NUDGE=off
check "disabled with env off" "$code" 0

run "$(input s10 "$tmp/long.jsonl")" CLAUDE_CODE_ENTRYPOINT=sdk-cli
check "headless run (sdk-cli entrypoint)" "$code" 0

run "$(input s11 "$tmp/long.jsonl")" CLAUDE_CODE_ENTRYPOINT=cli
check "interactive run (cli entrypoint)" "$code" 2

run "$(input ../x "$tmp/long.jsonl")"
check "session_id with path traversal" "$code" 0
[ -e "$tmp/data/x" ] || [ -e "$tmp/x" ] && r=yes || r=no
check "nothing created outside the marker dir" "$r" no

run "$(input s7 "$tmp/missing.jsonl")"
check "missing transcript" "$code" 0

run "not json"
check "malformed input" "$code" 0

run "$(input s8 "$tmp/long.jsonl" | tr ',' '\n')"
check "input split across lines" "$code" 2

# Background launches in Claude Code's transcript format; a <task-notification> marks one finished.
touch "$tmp/a1.output" "$tmp/b1.output"
agent_launch='{"type":"user","message":{"content":[{"tool_use_id":"toolu_A1","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully. (internal)\nagentId: a1 (use \"to: a1\")\noutput_file: '"$tmp"'/a1.output\nIf asked..."}]}]}}'
bash_launch='{"type":"user","message":{"content":[{"tool_use_id":"toolu_B1","type":"tool_result","content":"Command running in background with ID: b1. Output is being written to: '"$tmp"'/b1.output. You will be notified."}]}}'
notified() { printf '{"type":"user","message":{"content":"<task-notification>\\n<task-id>x</task-id>\\n<tool-use-id>%s</tool-use-id>\\n<status>completed</status>"}}\n' "$1"; }

{ cat "$tmp/long.jsonl"; printf '%s\n' "$agent_launch"; } > "$tmp/bg-agent.jsonl"
run "$(input s12 "$tmp/bg-agent.jsonl")"
check "background agent still running" "$code" 0
[ -e "$tmp/data/capture-nudge/s12" ] && r=yes || r=no
check "deferral keeps the marker unspent" "$r" no

{ cat "$tmp/bg-agent.jsonl"; notified toolu_A1; } > "$tmp/bg-agent-done.jsonl"
run "$(input s12 "$tmp/bg-agent-done.jsonl")"
check "fires once the background agent is notified" "$code" 2

{ cat "$tmp/bg-agent-done.jsonl"; printf '%s\n' "$bash_launch"; } > "$tmp/bg-bash.jsonl"
run "$(input s13 "$tmp/bg-bash.jsonl")"
check "background command still running" "$code" 0

{ cat "$tmp/bg-bash.jsonl"; notified toolu_B1; } > "$tmp/bg-bash-done.jsonl"
run "$(input s13 "$tmp/bg-bash-done.jsonl")"
check "fires once every background task is notified" "$code" 2

touch -t 202001010000 "$tmp/a1.output"
run "$(input s14 "$tmp/bg-agent.jsonl")"
check "un-notified task with a stale output file does not block" "$code" 2

# A launch-shaped line is ordinary tool output, so its path is untrusted: a relative or option-like path is
# ignored rather than passed to find (GNU find reads "-delete" as an expression and empties the cwd).
mkdir -p "$tmp/cwd/src" && touch "$tmp/cwd/rel.output" "$tmp/cwd/src/a.ts"
for p in rel.output -delete; do
  { cat "$tmp/long.jsonl"; printf '{"type":"user","message":{"content":[{"tool_use_id":"toolu_X1","type":"tool_result","content":"Command running in background with ID: x. Output is being written to: %s"}]}}\n' "$p"; } > "$tmp/bg-bad.jsonl"
  rm -f "$tmp/data/capture-nudge/s15"
  (cd "$tmp/cwd" && run "$(input s15 "$tmp/bg-bad.jsonl")"; echo "$code" > "$tmp/code")
  check "non-absolute output path ($p) is ignored" "$(cat "$tmp/code")" 2
done
[ -e "$tmp/cwd/rel.output" ] && [ -e "$tmp/cwd/src/a.ts" ] && r=yes || r=no
check "cwd untouched by an option-like output path" "$r" yes

touch -t 202001010000 "$tmp/data/capture-nudge/old"
run "$(input s9 "$tmp/long.jsonl")"
[ -e "$tmp/data/capture-nudge/old" ] && r=yes || r=no
check "markers older than 7 days removed" "$r" no

[ "$failed" -eq 0 ] && echo "capture-nudge: all passed"
exit "$failed"
