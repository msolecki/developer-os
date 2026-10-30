#!/bin/sh
# Tests for plugin/hooks/repeat-failure.py with synthetic PostToolUseFailure input.
# Run from the repository root: sh tests/repeat-failure.test.sh
hook="$(pwd)/plugin/hooks/repeat-failure.py"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0

# run JSON [ENV=VALUE...]: prints "fire" for PostToolUseFailure additionalContext, "silent" for no output.
run() {
  json=$1
  shift
  out=$(printf '%s' "$json" | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/data" "$@" python3 "$hook" 2>/dev/null)
  code=$?
  if [ "$code" -ne 0 ]; then echo "exit $code"
  elif [ -z "$out" ]; then echo silent
  else case $out in *'"hookEventName": "PostToolUseFailure", "additionalContext": "developer-os: '*) echo fire ;; *) echo "output $out" ;; esac
  fi
}

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

# bash SESSION COMMAND [DESCRIPTION]: a failed Bash call.
bash_fail() {
  printf '{"session_id":"%s","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"%s","description":"%s"},"error":"Exit code 1","is_interrupt":false}' "$1" "$2" "${3:-d}"
}

check "1st failure" "$(run "$(bash_fail s1 'npm test')")" silent
check "2nd failure, other description" "$(run "$(bash_fail s1 'npm test' 'run tests')")" silent
check "3rd failure fires" "$(run "$(bash_fail s1 'npm test')")" fire
check "4th failure silent" "$(run "$(bash_fail s1 'npm test')")" silent
check "other command" "$(run "$(bash_fail s1 'npm run lint')")" silent
check "other session" "$(run "$(bash_fail s2 'npm test')")" silent
run "$(bash_fail s3 'make')" >/dev/null; run "$(bash_fail s3 'make')" >/dev/null
check "interrupt not counted" "$(run '{"session_id":"s3","tool_name":"Bash","tool_input":{"command":"make"},"is_interrupt":true}')" silent
check "3rd make fires" "$(run "$(bash_fail s3 'make')")" fire
edit='{"session_id":"s4","agent_id":"a1","tool_name":"Edit","tool_input":{"file_path":"/x/a.ts","old_string":"a","new_string":"b"}}'
run "$edit" >/dev/null; run "$edit" >/dev/null
check "Edit 3rd fires" "$(run "$edit")" fire
run "$(bash_fail s5 'ls')" >/dev/null; run "$(bash_fail s5 'ls')" >/dev/null
check "off switch" "$(run "$(bash_fail s5 'ls')" DEVELOPER_OS_REPEAT_FAILURE=off)" silent
check "bad JSON" "$(run 'not json')" silent
mkdir -p "$tmp/data/repeat-failure" && printf '[]' > "$tmp/data/repeat-failure/s7"
run "$(bash_fail s7 'make')" >/dev/null; run "$(bash_fail s7 'make')" >/dev/null
check "corrupt state file is reset" "$(run "$(bash_fail s7 'make')")" fire
printf '{"x":' > "$tmp/data/repeat-failure/s8"
run "$(bash_fail s8 'make')" >/dev/null; run "$(bash_fail s8 'make')" >/dev/null
check "truncated state file is reset" "$(run "$(bash_fail s8 'make')")" fire
check "no temp file left" "$(ls "$tmp/data/repeat-failure" | grep -c tmp)" 0
check "bad session id" "$(run "$(bash_fail '../x' 'ls')")" silent
mkdir -p "$tmp/link-data" && ln -s "$tmp/elsewhere" "$tmp/link-data/repeat-failure"
mkdir -p "$tmp/elsewhere"
check "symlinked state dir" "$(printf '%s' "$(bash_fail s6 ls)" | env -i PATH="$PATH" CLAUDE_PLUGIN_DATA="$tmp/link-data" python3 "$hook"; echo "rc=$?")" "rc=0"
check "nothing written through the link" "$(ls "$tmp/elsewhere")" ""

[ "$failed" -eq 0 ] && echo "repeat-failure: all passed"
exit "$failed"
