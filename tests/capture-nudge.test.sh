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

touch -t 202001010000 "$tmp/data/capture-nudge/old"
run "$(input s9 "$tmp/long.jsonl")"
[ -e "$tmp/data/capture-nudge/old" ] && r=yes || r=no
check "markers older than 7 days removed" "$r" no

[ "$failed" -eq 0 ] && echo "capture-nudge: all passed"
exit "$failed"
