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

mkdir -p "$h/.codex" "$h/.claude" "$skills/my-own-skill" "$skills/spec"
printf 'My own rule.\n' > "$agents"
printf 'Brain vault: /vaults/test vault\n' > "$h/.claude/CLAUDE.md"
printf -- '---\nname: my-own-skill\ndescription: mine\n---\n' > "$skills/my-own-skill/SKILL.md"
printf 'my own spec\n' > "$skills/spec/SKILL.md"
n=$(find "$(pwd)/plugin/skills" -name SKILL.md | wc -l | tr -d ' ')

run --dry-run
check "dry run exits 0" "$code" 0
check "dry run leaves AGENTS.md alone" "$(cat "$agents")" "My own rule."
check "dry run installs no skill" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" 0
mkdir -p "$skills/old-skill" && : > "$skills/old-skill/.developer-os-codex" && printf 'old\n' > "$skills/old-skill/SKILL.md"

run
check "install exits 0" "$code" 0
grep -qxF '<!-- developer-os-core START -->' "$agents" && r=yes || r=no
check "AGENTS.md gets the block" "$r" yes
check "text outside the markers survives" "$(head -n 1 "$agents")" "My own rule."
grep -qx 'Brain vault: /vaults/test vault' "$agents" && r=yes || r=no
check "the Brain vault line comes from CLAUDE.md" "$r" yes
check "every skill but the foreign same-name one is installed" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" "$((n - 1))"
[ -e "$skills/old-skill" ] && r=yes || r=no
check "a marked copy of a removed skill is removed" "$r" no
check "the first change backs AGENTS.md up" "$(ls "$h/.codex" | grep -c bak || true)" 1
check "a foreign skill is untouched" "$(cat "$skills/my-own-skill/SKILL.md" | sed -n 3p)" "description: mine"
check "a foreign same-name skill is kept" "$(cat "$skills/spec/SKILL.md")" "my own spec"
check "a foreign same-name skill is reported" "$(grep -c 'skip .*/spec: exists and was not installed' "$tmp/err")" 1
check "no Claude-only reference is left" "$(grep -rlE 'CLAUDE_PLUGIN_ROOT|subagent_type|context: fork|`developer-os:' "$skills" | wc -l | tr -d ' ')" 0
grep -qF '"skill":"developer-os:([a-z-]+)"' "$skills/skill-usage/SKILL.md" && r=yes || r=no
check "skill-usage keeps the prefix in its search pattern" "$r" yes
grep -q "^description: '.*Use when writing or reviewing code comments" "$skills/comments-conventions/SKILL.md" && r=yes || r=no
check "a description without quoted phrases keeps its Use when sentence" "$r" yes
grep -q "Use for \"Likely agent mistakes here\"" "$skills/docs-sync/SKILL.md" && r=yes || r=no
check "a quoted name before the Use sentence is not a trigger phrase" "$r" no
fm_keys=$(awk 'FNR==1{fm=1;next} fm&&/^---$/{fm=0} fm{sub(/:.*/,"");print}' "$skills"/*/SKILL.md | sort -u | tr '\n' ' ')
check "frontmatter holds only name and description" "$fm_keys" "description name "
total=$(sed -n "s/^description: '\(.*\)'$/\1/p" "$skills"/*/SKILL.md | tr -d '\n' | wc -c | tr -d ' ')
[ "$total" -le 8000 ] && r=yes || r=no
check "descriptions fit 8000 (bytes, $total)" "$r" yes

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

printf 'export SAFE=1\n' > "$tmp/rc"
mkdir -p "$tmp/proj"
ln -s "$tmp/rc" "$tmp/proj/AGENTS.md"
run --project "$tmp/proj"
check "a symlinked AGENTS.md fails" "$code" 1
check "a symlinked AGENTS.md target is untouched" "$(cat "$tmp/rc")" "export SAFE=1"
check "no backup is copied next to the link" "$(ls "$tmp/proj" | grep -c bak || true)" 0

mkdir -p "$tmp/proj2"
printf 'Project rule.\n' > "$tmp/proj2/AGENTS.md"
run --project "$tmp/proj2" --vault /vaults/flag
check "--project exits 0" "$code" 0
grep -qx 'Brain vault: /vaults/flag' "$tmp/proj2/AGENTS.md" && r=yes || r=no
check "--project writes the block with the --vault line" "$r" yes
check "--project names the backup it leaves in the project" "$(grep -c '^backup: .*proj2/AGENTS.md.bak-' "$tmp/out")" 1
run --project "$tmp/proj2"
grep -qx 'Brain vault: /vaults/flag' "$tmp/proj2/AGENTS.md" && r=yes || r=no
check "a re-run without --vault keeps the --vault line" "$r" yes
run --project "$tmp/proj2" --uninstall
check "--project --uninstall exits 0" "$code" 0
check "--project --uninstall removes the project block" "$(cat "$tmp/proj2/AGENTS.md")" "Project rule."
check "--project --uninstall keeps the global skills" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" "$((n - 1))"

env -i PATH="$PATH" HOME="$h" CODEX_HOME="$tmp/codex-home" sh "$script" --dry-run >"$tmp/out" 2>&1
check "CODEX_HOME sets the AGENTS.md path" "$(grep -c "would write $tmp/codex-home/AGENTS.md" "$tmp/out")" 1

check "--help stops before the code" "$(sh "$script" --help | grep -c 'set -eu')" 0

mkdir -p "$tmp/repo"
cp -R "$(pwd)/scripts" "$(pwd)/plugin" "$tmp/repo/"
f="$tmp/repo/plugin/skills/spec/SKILL.md"
awk '/^description:/ && !done { print "description: >"; print "  Folded text."; done = 1; next } { print }' "$f" > "$tmp/folded" && cat "$tmp/folded" > "$f"
# A fresh HOME without the foreign spec, so only the folded description can make the run fail.
h2="$tmp/home2"
mkdir -p "$h2/.codex"
printf 'My own rule.\n' > "$h2/.codex/AGENTS.md"
env -i PATH="$PATH" HOME="$h2" sh "$tmp/repo/scripts/install-codex.sh" >"$tmp/out" 2>"$tmp/err"; code=$?
check "a folded description fails" "$code" 1
check "a folded description is named" "$(grep -c 'one-line plain description in: .*spec/SKILL.md' "$tmp/err")" 1
check "a folded description writes no AGENTS.md" "$(cat "$h2/.codex/AGENTS.md")" "My own rule."
check "a folded description installs no skill" "$(find "$h2" -name .developer-os-codex | wc -l | tr -d ' ')" 0

# pwd -P: the installer writes the resolved path, and the temp dir may sit behind a symlink.
clone="$(cd "$tmp" && pwd -P)/a&b\\c"
mkdir -p "$clone"
cp -R "$(pwd)/scripts" "$(pwd)/plugin" "$clone/"
h4="$tmp/home4"
mkdir -p "$h4"
env -i PATH="$PATH" HOME="$h4" sh "$clone/scripts/install-codex.sh" >"$tmp/out" 2>&1
grep -qF "$clone/plugin/vault-template" "$h4/.agents/skills/brain-setup/SKILL.md" && r=yes || r=no
check "a clone path with & and a backslash is written verbatim" "$r" yes

cp "$tmp/first" "$agents"
run --uninstall
check "uninstall exits 0" "$code" 0
grep -q 'developer-os-core' "$agents" && r=yes || r=no
check "uninstall removes the block" "$r" no
check "uninstall keeps the user's text" "$(head -n 1 "$agents")" "My own rule."
printf 'My own rule.\n' > "$tmp/original"
cmp -s "$agents" "$tmp/original" && r=yes || r=no
check "uninstall restores AGENTS.md byte for byte" "$r" yes
check "uninstall removes the copies" "$(find "$skills" -name .developer-os-codex | wc -l | tr -d ' ')" 0
[ -f "$skills/my-own-skill/SKILL.md" ] && r=yes || r=no
check "uninstall keeps a foreign skill" "$r" yes
check "uninstall keeps a foreign same-name skill" "$(cat "$skills/spec/SKILL.md")" "my own spec"

[ "$failed" -eq 0 ] && echo "install-codex: all passed"
exit "$failed"
