#!/bin/sh
# Stop hook: once per session, after DEVELOPER_OS_CAPTURE_NUDGE_MIN tool calls (default 30) and with no
# background task still running, asks the agent to run session-retro. It never prints transcript content.
# Fails open: every unexpected state exits 0, so a broken reminder never blocks a session.
# Skips headless and SDK runs (claude -p sets CLAUDE_CODE_ENTRYPOINT=sdk-cli): nobody is there to answer,
# and the hook input itself carries no non-interactive signal. CLAUDE_CODE_ENTRYPOINT is undocumented; if a
# release drops it, a headless run gets one extra turn (stop_hook_active stops a second), not a loop.

[ "${DEVELOPER_OS_CAPTURE_NUDGE:-}" = off ] && exit 0
case ${CLAUDE_CODE_ENTRYPOINT:-} in sdk-*) exit 0 ;; esac

input=$(cat 2>/dev/null | tr '\n\r' '  ') || exit 0

# First string value of a top-level key; the hook input is flat JSON.
field() {
  printf '%s' "$input" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 |
    sed 's/.*"\([^"]*\)"$/\1/'
}

printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0
printf '%s' "$input" | grep -q '"agent_id"[[:space:]]*:' && exit 0

sid=$(field session_id)
case $sid in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac

transcript=$(field transcript_path)
[ -f "$transcript" ] || exit 0

dir="${CLAUDE_PLUGIN_DATA:-${TMPDIR:-/tmp}}/capture-nudge"
[ -e "$dir/$sid" ] && exit 0

min=${DEVELOPER_OS_CAPTURE_NUDGE_MIN:-30}
case $min in '' | *[!0-9]*) min=30 ;; esac
n=$(grep -o '"type":"tool_use"' "$transcript" 2>/dev/null | wc -l | tr -d ' ')
[ "${n:-0}" -ge "$min" ] 2>/dev/null || exit 0

# Defers, without spending the marker, while a background agent or command launched in this session has
# no <task-notification> yet and its output file changed in the last 30 minutes: the turn ended to wait
# for it. The mtime bound matters because a notification is not guaranteed; without it, a task that
# vanished silently would suppress the nudge for the rest of the session.
launched=$(grep -oE '"tool_use_id":"[A-Za-z0-9_]+","type":"tool_result","content":(\[\{"type":"text","text":)?"(Async agent launched|Command running in background)([^"\\]|\\.)*(output_file|written to): [^ "\\]+' "$transcript" 2>/dev/null |
  sed -n 's/^"tool_use_id":"\([A-Za-z0-9_]*\)".*: \([^ ]*\)$/\1 \2/p' | sed 's/\.$//')
if [ -n "$launched" ]; then
  finished=$(grep -oE '<tool-use-id>[A-Za-z0-9_]+</tool-use-id>' "$transcript" 2>/dev/null | sed 's/<[^>]*>//g')
  live=$(printf '%s\n' "$launched" | while read -r id out; do
    printf '%s\n' "$finished" | grep -qxF "$id" && continue
    # The path comes from tool output anyone can print: only an absolute path reaches find, so a value
    # such as "-delete" is never parsed as an expression, and -prune keeps a directory from being walked.
    case $out in (/*) find -L "$out" -prune -mmin -30 2>/dev/null ;; esac
  done)
  [ -n "$live" ] && exit 0
fi

mkdir -p "$dir" 2>/dev/null && : > "$dir/$sid" 2>/dev/null || exit 0
find "$dir" -type f -mtime +7 -exec rm -f {} + 2>/dev/null

echo "developer-os: this session made $n tool calls. Run the developer-os:session-retro skill: propose the wrap-up to the user and apply only what they approve. If nothing qualifies, end your turn with no output." >&2
exit 2
