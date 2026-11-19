#!/bin/sh
# Tests for plugin/hooks/brain-index.py with a temporary config directory, vault and git repository.
# Run from the repository root: sh tests/brain-index.test.sh
hook="$(pwd)/plugin/hooks/brain-index.py"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0

ago() { date -v-"$1"d +%F 2>/dev/null || date -d "$1 days ago" +%F; }
ahead() { date -v+"$1"d +%F 2>/dev/null || date -d "$1 days" +%F; }

# note PATH PROJECT STATUS UPDATED SUMMARY [EXTRA]: writes a vault note with frontmatter.
note() {
  mkdir -p "$(dirname "$tmp/vault/$1")"
  printf -- '---\ntitle: "%s"\ntype: knowledge\nstatus: %s\ncreated: %s\nupdated: %s\nsummary: "%s"\nproject: %s\n%b---\n\n# Body\n' \
    "$1" "$3" "$4" "$4" "$5" "$2" "${6:-}" > "$tmp/vault/$1"
}

# run [SOURCE] [CWD] [ENV=VALUE...]: runs the hook with a fresh environment, sets $code and $out.
run() {
  src=${1:-startup}; dir=${2:-$tmp/repo}
  [ $# -gt 0 ] && shift
  [ $# -gt 0 ] && shift
  out=$(printf '{"session_id":"s","hook_event_name":"SessionStart","source":"%s","cwd":"%s"}' "$src" "$dir" \
    | env -i PATH="$PATH" HOME="$tmp/home" CLAUDE_CONFIG_DIR="$tmp/config" "$@" python3 "$hook" 2>&1)
  code=$?
}

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

has() { case $out in *"$1"*) echo yes ;; *) echo no ;; esac; }
lines() { printf '%s\n' "$out" | grep -c -- "$1"; }

mkdir -p "$tmp/config" "$tmp/home" "$tmp/repo/src" "$tmp/vault/_inbox"
git -C "$tmp/repo" init -q
ctx() { printf '# Demo - context\n\n%s\n' "$1" > "$tmp/repo/_Context.md"; }
ctx '**Vault project slug:** `demo-app`'

note PROJECTS/demo-app.md demo-app active "$(ago 40)" "Hub of the demo app." "type: project\n"
note DEV/newest.md demo-app active "$(ago 1)" "Newest lesson."
note DEV/older.md '"demo-app"' '"active"' "\"$(ago 5)\"" "Older lesson, quoted fields."
note DEV/replaced.md demo-app superseded "$(ago 2)" "Replaced lesson."
note DEV/retired.md demo-app archived "$(ago 2)" "Archived in place."
note DEV/refused.md demo-app rejected "$(ago 2)" "Rejected lesson."
note _archive/moved.md demo-app active "$(ago 2)" "Moved to the archive."
note templates/note.md demo-app active "$(ago 2)" "Template."
note DEV/other.md other-app active "$(ago 1)" "Another project."
note DEV/listed.md '[other-app, demo-app]' active "$(ago 3)" "Two projects in a list."
note _inbox/fresh.md demo-app inbox "$(ago 4)" "Fresh capture."
note _inbox/stale.md demo-app inbox "$(ago 45)" "Expired capture."
note _inbox/kept.md demo-app inbox "$(ago 45)" "Capture with a later expiry." "expires: $(ahead 5)\n"
ln -s "$tmp/vault/DEV/newest.md" "$tmp/vault/DEV/linked.md"
printf 'no frontmatter, project: demo-app\n' > "$tmp/vault/DEV/plain.md"

run
check "no vault configured: exit 0" "$code" 0
check "no vault configured: silent" "$out" ""

# A vault line in a project's CLAUDE.md is never read; only the user-level one counts.
printf 'Brain vault: %s\n' "$tmp/vault" > "$tmp/repo/CLAUDE.md"
run
check "vault only in a project file: silent" "$out" ""

printf '# me\n\nBrain vault: %s\n' "$tmp/vault" > "$tmp/config/CLAUDE.md"
run
check "exit 0 with notes" "$code" 0
check "header names the slug" "$(has '## Project knowledge in the vault (demo-app)')" yes
check "instruction line" "$(has 'Read the note whose topic you are about to touch before acting; cite it.')" yes
check "hub first" "$(printf '%s\n' "$out" | sed -n 3p)" "PROJECTS/demo-app.md — Hub of the demo app."
check "newest updated next" "$(printf '%s\n' "$out" | sed -n 4p)" "DEV/newest.md — Newest lesson."
check "quoted fields read" "$(has 'DEV/older.md — Older lesson, quoted fields.')" yes
check "a project list counts" "$(has 'DEV/listed.md')" yes
check "inbox note marked unreviewed" "$(has '_inbox/fresh.md (inbox, unreviewed) — Fresh capture.')" yes
check "inbox note with a later expires: kept" "$(has '_inbox/kept.md')" yes
check "expired inbox note skipped" "$(has stale)" no
check "superseded, archived and rejected skipped" "$(has replaced)$(has retired)$(has refused)" nonono
check "_archive/ and templates/ skipped" "$(has moved)$(has templates/)" nono
check "another project's note skipped" "$(has other.md)" no
check "symlinked note and note without frontmatter skipped" "$(has linked)$(has plain)" nono
check "no more line when all fit" "$(has 'more: use brain-search')" no

run clear
check "clear prints the index" "$(has 'DEV/newest.md')" yes
run startup "$tmp/repo/src"
check "a subdirectory finds the git root" "$(has 'DEV/newest.md')" yes
run resume
check "resume is silent" "$out" ""
run compact
check "compact is silent" "$out" ""
run startup "$tmp/repo" DEVELOPER_OS_BRAIN_INDEX=off
check "off switch is silent" "$out" ""

ctx 'Vault project slug: demo-app'
run
check "plain slug line" "$(has 'DEV/newest.md')" yes
ctx '**Vault project slug:** `demo-app` (the `project:` value of this project'"'"'s notes in the Brain vault)'
run
check "template line with a trailing note" "$(has 'DEV/newest.md')" yes
ctx '**Vault project slug:** `<project-slug>` (the `project:` value)'
run
check "unfilled template line: silent" "$out" ""
# Notes that carry the invalid slugs, so only the slug check keeps them out.
note DEV/bad-case.md Demo_App active "$(ago 1)" "Bad case slug."
note DEV/bad-path.md ../etc active "$(ago 1)" "Path slug."
note DEV/no-project.md '' active "$(ago 1)" "Empty project."
ctx 'Vault project slug: Demo_App'
run
check "invalid slug: silent" "$out" ""
ctx '**Vault project slug:** `../etc`'
run
check "path-like slug: silent" "$out" ""
ctx '**Vault project slug:** ``'
run
check "empty slug: silent" "$out" ""
rm -f "$tmp/vault/DEV/bad-case.md" "$tmp/vault/DEV/bad-path.md" "$tmp/vault/DEV/no-project.md"
ctx 'Purpose: demo.'
run
check "no slug line: silent" "$out" ""
rm -f "$tmp/repo/_Context.md"
run
check "no _Context.md: silent, exit 0" "$code:$out" "0:"
mkdir -p "$tmp/norepo"
run startup "$tmp/norepo"
check "outside git: silent" "$out" ""
ctx 'Vault project slug: no-notes'
run
check "slug with no notes: silent" "$out" ""

# The brain_vault option in the user-level settings.json wins over the line; its environment variable is never read.
ctx 'Vault project slug: demo-app'
mkdir -p "$tmp/vault2/DEV"
printf -- '---\nstatus: active\nproject: demo-app\nsummary: In vault two.\n---\n' > "$tmp/vault2/DEV/two.md"
printf '{"pluginConfigs":{"developer-os@developer-os":{"options":{"brain_vault":"%s"}}}}\n' "$tmp/vault2" > "$tmp/config/settings.json"
run
check "brain_vault option preferred over the line" "$(has 'DEV/two.md')$(has 'DEV/newest.md')" yesno
rm -f "$tmp/config/settings.json"
run startup "$tmp/repo" CLAUDE_PLUGIN_OPTION_BRAIN_VAULT="$tmp/vault2"
check "the option's environment variable is not trusted" "$(has 'DEV/two.md')" no

# Summaries: control characters dropped, cut to 140 characters without splitting a character.
long=$(python3 -c 'print("zażółć " * 40)')
note DEV/long.md demo-app active "$(ago 0)" "$long"
run
got=$(printf '%s\n' "$out" | grep '^DEV/long.md' | python3 -c 'import sys; s = sys.stdin.read().rstrip("\n").split(" — ", 1)[1]; print(len(s), s.endswith("…"))')
check "long multibyte summary cut to 140 characters" "$got" "140 True"
rm -f "$tmp/vault/DEV/long.md"

# Caps: at most 25 notes, then a +N more line.
i=0
while [ $i -lt 30 ]; do note "DEV/bulk-$i.md" demo-app active "$(ago 3)" "Bulk note $i."; i=$((i + 1)); done
run
check "at most 25 note lines" "$(lines ' — ')" 25
check "+N more line" "$(printf '%s\n' "$out" | tail -n 1)" "+11 more: use brain-search"

# Byte cap: long summaries stop at 3000 bytes with the +N more line inside it.
i=0
while [ $i -lt 30 ]; do note "DEV/bulk-$i.md" demo-app active "$(ago 3)" "$(python3 -c 'print("x" * 200)')"; i=$((i + 1)); done
run
bytes=$(printf '%s\n' "$out" | wc -c | tr -d ' ')
[ "$bytes" -le 3000 ] && r=yes || r=no
check "output within 3000 bytes ($bytes)" "$r" yes
check "byte cap ends with +N more" "$(printf '%s\n' "$out" | tail -n 1 | grep -c '^+[0-9]* more: use brain-search$')" 1

# A FIFO in the vault does not block the hook.
mkfifo "$tmp/vault/DEV/fifo.md"
run
check "a FIFO note is skipped, exit 0" "$code:$(has 'PROJECTS/demo-app.md')" "0:yes"

printf 'not json' | env -i PATH="$PATH" CLAUDE_CONFIG_DIR="$tmp/config" python3 "$hook" >/dev/null 2>&1
check "malformed input exits 0" "$?" 0

exit $failed
