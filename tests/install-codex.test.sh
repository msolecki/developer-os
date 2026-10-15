#!/bin/sh
# Tests for scripts/install-codex.sh against a temporary HOME.
# Run from the repository root: sh tests/install-codex.test.sh
script="$(pwd)/scripts/install-codex.sh"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0
h="$tmp/home"
skills="$h/.agents/skills"
agents="$h/.codex/AGENTS.md"

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}
run() { env -i PATH="$PATH" HOME="$h" sh "$script" "$@" >"$tmp/out" 2>"$tmp/err"; code=$?; }

mkdir -p "$h/.codex" "$h/.claude" "$skills/my-own-skill"
printf 'My own rule.\n' > "$agents"
printf 'Brain vault: /vaults/test vault\n' > "$h/.claude/CLAUDE.md"
printf -- '---\nname: my-own-skill\ndescription: mine\n---\n' > "$skills/my-own-skill/SKILL.md"
n=$(find "$(pwd)/plugin/skills" -name SKILL.md | wc -l | tr -d ' ')

run --dry-run
check "dry run exits 0" "$code" 0
check "dry run leaves AGENTS.md alone" "$(cat "$agents")" "My own rule."
check "dry run installs no skill" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" 0

run
check "install exits 0" "$code" 0
grep -qxF '<!-- developer-os-core START -->' "$agents" && r=yes || r=no
check "AGENTS.md gets the block" "$r" yes
check "text outside the markers survives" "$(head -n 1 "$agents")" "My own rule."
grep -qx 'Brain vault: /vaults/test vault' "$agents" && r=yes || r=no
check "the Brain vault line comes from CLAUDE.md" "$r" yes
check "every skill is installed" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" "$n"
check "a foreign skill is untouched" "$(cat "$skills/my-own-skill/SKILL.md" | sed -n 3p)" "description: mine"
grep -q 'exists and was not installed' "$tmp/err" && r=yes || r=no
check "no skill is skipped as foreign" "$r" no
check "no Claude-only reference is left" "$(grep -rlE 'CLAUDE_PLUGIN_ROOT|subagent_type|context: fork|developer-os:' "$skills" | wc -l | tr -d ' ')" 0
fm_keys=$(awk 'FNR==1{fm=1;next} fm&&/^---$/{fm=0} fm{sub(/:.*/,"");print}' "$skills"/*/SKILL.md | sort -u | tr '\n' ' ')
check "frontmatter holds only name and description" "$fm_keys" "description name "
total=$(sed -n "s/^description: '\(.*\)'$/\1/p" "$skills"/*/SKILL.md | awk '{ t += length($0) } END { print t }')
[ "$total" -le 8000 ] && r=yes || r=no
check "descriptions fit 8000 characters ($total)" "$r" yes

cp "$agents" "$tmp/first"
backups=$(ls "$h/.codex" | grep -c bak || true)
run
check "second run exits 0" "$code" 0
cmp -s "$agents" "$tmp/first" && r=yes || r=no
check "second run leaves AGENTS.md byte-identical" "$r" yes
check "second run writes no backup" "$(ls "$h/.codex" | grep -c bak || true)" "$backups"
grep -q 'unchanged 0' "$tmp/out" && r=no || r=yes
check "second run reports skills unchanged" "$r" yes

printf '<!-- developer-os-core START -->\nhalf a block\n' > "$tmp/broken"
cp "$tmp/broken" "$agents"
run
check "START without END fails" "$code" 1
cmp -s "$agents" "$tmp/broken" && r=yes || r=no
check "START without END writes nothing" "$r" yes

cp "$tmp/first" "$agents"
run --uninstall
check "uninstall exits 0" "$code" 0
grep -q 'developer-os-core' "$agents" && r=yes || r=no
check "uninstall removes the block" "$r" no
check "uninstall keeps the user's text" "$(head -n 1 "$agents")" "My own rule."
check "uninstall removes the copies" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" 0
[ -f "$skills/my-own-skill/SKILL.md" ] && r=yes || r=no
check "uninstall keeps a foreign skill" "$r" yes

[ "$failed" -eq 0 ] && echo "install-codex: all passed"
exit "$failed"
