#!/bin/sh
# Tests for plugin/hooks/notices.py with a fake plugin root, config directory and vault.
# Run from the repository root: sh tests/notices.test.sh
hook="$(pwd)/plugin/hooks/notices.py"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0

ago() { date -v-"$1"d +%F 2>/dev/null || date -d "$1 days ago" +%F; }
version() { mkdir -p "$tmp/root/.claude-plugin"; printf '{"name":"developer-os","version":"%s"}\n' "$1" > "$tmp/root/.claude-plugin/plugin.json"; }
note() { printf -- '---\ntype: knowledge\nstatus: inbox\ncreated: %s\n---\n' "$2" > "$tmp/vault/_inbox/$1.md"; }

# run [SOURCE] [ENV=VALUE...]: runs the hook with a fresh environment, sets $code and $out.
run() {
  src=${1:-startup}
  [ $# -gt 0 ] && shift
  out=$(printf '{"session_id":"s","hook_event_name":"SessionStart","source":"%s"}' "$src" | env -i PATH="$PATH" \
    CLAUDE_PLUGIN_ROOT="$tmp/root" CLAUDE_PLUGIN_DATA="$tmp/data" CLAUDE_CONFIG_DIR="$tmp/config" "$@" python3 "$hook" 2>/dev/null)
  code=$?
}

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

has() { case $out in *"$1"*) echo yes ;; *) echo no ;; esac; }

mkdir -p "$tmp/config"
version 9.9.9

run
check "first run exits 0" "$code" 0
check "first run shows the version and changelog link" "$(has 'developer-os 9.9.9 is active. What'"'"'s new: https://msolecki.github.io/developer-os/docs/changelog.html')" yes
check "first run without a vault suggests brain-setup" "$(has brain-setup)" yes
check "output is a systemMessage" "$(has '"systemMessage": "')" yes
check "the agent gets the same notices as context" "$(has '"hookEventName": "SessionStart", "additionalContext": "')" yes
check "version marker written" "$(cat "$tmp/data/notices/version")" 9.9.9

run
check "same version again is silent" "$out" ""

version 9.10.0
run
check "update shows old and new version" "$(has 'developer-os updated 9.9.9 -> 9.10.0')" yes
check "update has no setup line" "$(has brain-setup)" no

run resume
check "resume is silent" "$out" ""

# A vault line in a project's CLAUDE.md is never read; only the user-level one counts.
mkdir -p "$tmp/vault/_inbox" "$tmp/vault/_reports"
mkdir -p "$tmp/project"
printf 'Brain vault: %s\n' "$tmp/vault" > "$tmp/project/CLAUDE.md"
note secret-client-name "$(ago 10)"
cd "$tmp/project" && run && cd - >/dev/null
check "vault only in a project file: no inbox notice" "$(has inbox)" no

printf '# me\n\nBrain vault: %s\n' "$tmp/vault" > "$tmp/config/CLAUDE.md"
rm -rf "$tmp/data"
note old-two "$(ago 8)"
note fresh "$(ago 2)"
note nodate-x "nope"
ln -s "$tmp/vault/_inbox/old-two.md" "$tmp/vault/_inbox/linked.md"
run
check "fresh install with a vault states upkeep is manual" "$(has 'does not run on its own')" yes
check "stale inbox notes counted, links and undated notes skipped" "$(has 'Vault: 2 inbox notes older than 7 days. Ask for brain-review.')" yes
check "no vault file name in the output" "$(has secret-client-name)" no
check "first run with no garden log does not nag" "$(has brain-garden.)" no
check "garden clock started" "$(cat "$tmp/data/notices/garden")" "$(date +%F)"

run
check "inbox notice waits a week" "$out" ""

ago 8 > "$tmp/data/notices/inbox"
run
check "inbox notice returns after a week" "$(has '2 inbox notes')" yes

ago 31 > "$tmp/data/notices/garden"
printf '%s notes 10, orphans 1 (10%%), inbox 0\n' "$(ago 40)" > "$tmp/vault/_reports/garden-log.md"
run
check "overdue garden named with its last run" "$(has "no brain-garden run in 30 days (last run $(ago 40))")" yes
run
check "garden notice waits a month" "$out" ""

printf '%s notes 10, orphans 1 (10%%), inbox 0\n' "$(ago 3)" >> "$tmp/vault/_reports/garden-log.md"
ago 40 > "$tmp/data/notices/garden"
run
check "recent garden log line: no notice" "$(has brain-garden)" no

mkdir -p "$tmp/vault/_inbox/x"
printf 'created: %s\n' "$(ago 20)" > "$tmp/vault/_inbox/no-frontmatter.md"
rm -f "$tmp/vault/_reports/garden-log.md"
mkfifo "$tmp/vault/_reports/garden-log.md"
rm "$tmp/data/notices/inbox"
run
check "a FIFO garden log does not block, a note without frontmatter is not counted" "$(has '2 inbox notes')" yes

rm -rf "$tmp/data"
mkdir -p "$tmp/elsewhere" "$tmp/data"
ln -s "$tmp/elsewhere" "$tmp/data/notices"
run
check "symlinked marker directory: silent" "$out" ""
check "symlinked marker directory: exit 0" "$code" 0

mkdir -p "$tmp/t"
out=$(printf '{"source":"startup"}' | env -i PATH="$PATH" CLAUDE_PLUGIN_ROOT="$tmp/root" TMPDIR="$tmp/t" CLAUDE_CONFIG_DIR="$tmp/config" python3 "$hook" 2>/dev/null)
[ -f "$tmp/t/developer-os-$(id -u)/notices/version" ] && r=yes || r=no
check "without plugin data the markers go to TMPDIR/developer-os-<uid>" "$r" yes

rm -rf "$tmp/data"
run startup DEVELOPER_OS_NOTICES=off
check "off switch is silent" "$out" ""
run startup CLAUDE_CODE_ENTRYPOINT=sdk-cli
check "sdk entrypoint is silent" "$out" ""

printf 'not json' > "$tmp/root/.claude-plugin/plugin.json"
run
check "broken manifest exits 0" "$code" 0
check "broken manifest is silent" "$out" ""

exit $failed
