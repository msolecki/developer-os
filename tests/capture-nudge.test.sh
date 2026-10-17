#!/bin/sh
# Tests for plugin/hooks/capture-nudge.py with synthetic hook input and transcripts.
# Run from the repository root: sh tests/capture-nudge.test.sh
hook="$(pwd)/plugin/hooks/capture-nudge.py"
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

# outcome EXIT STDOUT: "fire" for exit 0 with Stop additionalContext, "silent" for exit 0 with no output.
outcome() {
  if [ "$1" -ne 0 ]; then echo "exit $1"
  elif [ -z "$2" ]; then echo silent
  else case $2 in *'"hookEventName": "Stop", "additionalContext": "'*) echo fire ;; *) echo "output $2" ;; esac
  fi
}

# run JSON [ENV=VALUE...]: runs the hook with a fresh environment, sets $code (an outcome) and $out.
run() {
  json=$1
  shift
  out=$(printf '%s' "$json" | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/data" "$@" python3 "$hook" 2>/dev/null)
  code=$(outcome $? "$out")
}

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

transcript "$tmp/long.jsonl" 31
transcript "$tmp/short.jsonl" 5
input() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","stop_hook_active":false%s}' "$1" "$2" "${3:-}"; }

run "$(input s1 "$tmp/long.jsonl")"
check "fires above threshold" "$code" fire
case $out in *session-retro*"31 tool calls"* | *"31 tool calls"*session-retro*) r=yes ;; *) r=no ;; esac
check "reminder names session-retro and the count" "$r" yes
[ -f "$tmp/data/capture-nudge/s1" ] && r=yes || r=no
check "marker created" "$r" yes

run "$(input s1 "$tmp/long.jsonl")"
check "second call in the same session" "$code" silent

run "$(input s2 "$tmp/short.jsonl")"
check "below threshold" "$code" silent

run "$(input s3 "$tmp/short.jsonl")" DEVELOPER_OS_CAPTURE_NUDGE_MIN=3
check "custom threshold" "$code" fire

run "$(input s4 "$tmp/long.jsonl" | sed 's/"stop_hook_active":false/"stop_hook_active": true/')"
check "stop_hook_active true" "$code" silent

run "$(input s5 "$tmp/long.jsonl" ',"agent_id":"a1","agent_type":"Explore"')"
check "subagent (agent_id present)" "$code" silent

run "$(input s6 "$tmp/long.jsonl")" DEVELOPER_OS_CAPTURE_NUDGE=off
check "disabled with env off" "$code" silent

run "$(input s10 "$tmp/long.jsonl")" CLAUDE_CODE_ENTRYPOINT=sdk-cli
check "headless run (sdk-cli entrypoint)" "$code" silent

run "$(input s11 "$tmp/long.jsonl")" CLAUDE_CODE_ENTRYPOINT=cli
check "interactive run (cli entrypoint)" "$code" fire

run "$(input ../x "$tmp/long.jsonl")"
check "session_id with path traversal" "$code" silent
[ -e "$tmp/data/x" ] || [ -e "$tmp/x" ] && r=yes || r=no
check "nothing created outside the marker dir" "$r" no

run "$(input s7 "$tmp/missing.jsonl")"
check "missing transcript" "$code" silent

run "not json"
check "malformed input" "$code" silent

run "$(input s8 "$tmp/long.jsonl" | tr ',' '\n')"
check "input split across lines" "$code" fire

# Background launches in Claude Code's transcript format; a <task-notification> marks one finished.
mkdir -p "$tmp/tasks" && touch "$tmp/tasks/a1.output" "$tmp/tasks/b1.output"
agent_launch='{"type":"user","message":{"content":[{"tool_use_id":"toolu_A1","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully. (internal)\nagentId: a1 (use \"to: a1\")\noutput_file: '"$tmp"'/tasks/a1.output\nIf asked..."}]}]}}'
bash_launch='{"type":"user","message":{"content":[{"tool_use_id":"toolu_B1","type":"tool_result","content":"Command running in background with ID: b1. Output is being written to: '"$tmp"'/tasks/b1.output. You will be notified."}]}}'
notified() { printf '{"type":"user","message":{"content":"<task-notification>\\n<task-id>x</task-id>\\n<tool-use-id>%s</tool-use-id>\\n<status>completed</status>"}}\n' "$1"; }

{ cat "$tmp/long.jsonl"; printf '%s\n' "$agent_launch"; } > "$tmp/bg-agent.jsonl"
run "$(input s12 "$tmp/bg-agent.jsonl")"
check "background agent still running" "$code" silent
[ -e "$tmp/data/capture-nudge/s12" ] && r=yes || r=no
check "deferral keeps the marker unspent" "$r" no

{ cat "$tmp/bg-agent.jsonl"; notified toolu_A1; } > "$tmp/bg-agent-done.jsonl"
run "$(input s12 "$tmp/bg-agent-done.jsonl")"
check "fires once the background agent is notified" "$code" fire

{ cat "$tmp/bg-agent-done.jsonl"; printf '%s\n' "$bash_launch"; } > "$tmp/bg-bash.jsonl"
run "$(input s13 "$tmp/bg-bash.jsonl")"
check "background command still running" "$code" silent

{ cat "$tmp/bg-bash.jsonl"; notified toolu_B1; } > "$tmp/bg-bash-done.jsonl"
run "$(input s13 "$tmp/bg-bash-done.jsonl")"
check "fires once every background task is notified" "$code" fire

touch -t 202001010000 "$tmp/tasks/a1.output"
run "$(input s14 "$tmp/bg-agent.jsonl")"
check "un-notified task with a stale output file does not block" "$code" fire

# A launch-shaped line is ordinary tool output, so its path is untrusted: a relative or option-like path is
# ignored rather than passed to find (GNU find reads "-delete" as an expression and empties the cwd), and so
# is a fresh path outside a tasks/ directory. BSD find on macOS rejects "-delete" on its own, so only GNU
# find or bfs proves that case; the rel.output and fresh.log cases are the portable proof.
mkdir -p "$tmp/cwd/src" && touch "$tmp/cwd/rel.output" "$tmp/cwd/src/a.ts" "$tmp/fresh.log"
for p in rel.output -delete "$tmp/fresh.log"; do
  { cat "$tmp/long.jsonl"; printf '{"type":"user","message":{"content":[{"tool_use_id":"toolu_X1","type":"tool_result","content":"Command running in background with ID: x. Output is being written to: %s"}]}}\n' "$p"; } > "$tmp/bg-bad.jsonl"
  rm -f "$tmp/data/capture-nudge/s15"
  (cd "$tmp/cwd" && run "$(input s15 "$tmp/bg-bad.jsonl")"; echo "$code" > "$tmp/code")
  check "output path outside tasks/ ($p) is ignored" "$(cat "$tmp/code")" fire
done
[ -e "$tmp/cwd/rel.output" ] && [ -e "$tmp/cwd/src/a.ts" ] && r=yes || r=no
check "cwd untouched by an option-like output path" "$r" yes

# Monitor: event notices carry only <task-id>; a terminal notice also carries <tool-use-id>.
monitor() { printf '{"type":"user","message":{"content":[{"tool_use_id":"toolu_M1","type":"tool_result","content":"Monitor started (task bm1, expires in 30m unless the source ends first)."}]},"timestamp":"%s"}\n' "$1"; }
event='{"type":"user","message":{"content":"<task-notification>\n<task-id>bm1</task-id>\n<summary>Monitor event: \"x\"</summary>"}}'
{ cat "$tmp/long.jsonl"; monitor "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"; printf '%s\n' "$event"; } > "$tmp/mon.jsonl"
run "$(input s16 "$tmp/mon.jsonl")"
check "armed Monitor with only event notices defers" "$code" silent
[ -e "$tmp/data/capture-nudge/s16" ] && r=yes || r=no
check "Monitor deferral keeps the marker unspent" "$r" no

{ cat "$tmp/mon.jsonl"; notified toolu_M1; } > "$tmp/mon-done.jsonl"
run "$(input s16 "$tmp/mon-done.jsonl")"
check "fires once the Monitor has a terminal notice" "$code" fire

{ cat "$tmp/long.jsonl"; monitor 2020-01-01T00:00:00.000Z; } > "$tmp/mon-old.jsonl"
run "$(input s17 "$tmp/mon-old.jsonl")"
check "Monitor started over 30 minutes ago does not block" "$code" fire

touch -t 202001010000 "$tmp/data/capture-nudge/old"
run "$(input s9 "$tmp/long.jsonl")"
[ -e "$tmp/data/capture-nudge/old" ] && r=yes || r=no
check "markers older than 7 days removed" "$r" no

transcript "$tmp/t29.jsonl" 29; transcript "$tmp/t30.jsonl" 30
run "$(input b29 "$tmp/t29.jsonl")"; check "29 tool calls stay below the default threshold" "$code" silent
run "$(input b30 "$tmp/t30.jsonl")"; check "30 tool calls reach the default threshold" "$code" fire
run "$(input b31 "$tmp/t30.jsonl")" DEVELOPER_OS_CAPTURE_NUDGE_MIN=abc; check "a non-numeric threshold falls back to 30" "$code" fire
printf '%s' "$(input b32 "$tmp/long.jsonl")" | env -i PATH="$PATH" TMPDIR="$tmp/t" python3 "$hook" >/dev/null 2>&1; [ -f "$tmp/t/developer-os-$(id -u)/capture-nudge/b32" ] && r=yes || r=no; check "without CLAUDE_PLUGIN_DATA the marker goes under TMPDIR" "$r" yes
sid="t$$"; m="/tmp/developer-os-$(id -u)/capture-nudge/$sid"
out=$(printf '%s' "$(input "$sid" "$tmp/long.jsonl")" | env -i PATH="$PATH" TMPDIR=/tmp python3 "$hook" 2>/dev/null); code=$(outcome $? "$out"); check "TMPDIR=/tmp: fires" "$code" fire
out=$(printf '%s' "$(input "$sid" "$tmp/long.jsonl")" | env -i PATH="$PATH" TMPDIR=/tmp python3 "$hook" 2>/dev/null); code=$(outcome $? "$out"); check "TMPDIR=/tmp: fires once" "$code" silent
rm -f "$m"

[ "$failed" -eq 0 ] && echo "capture-nudge: all passed"
exit "$failed"
