#!/bin/sh
# Tests the counting block in plugin/skills/skill-usage/SKILL.md against synthetic transcripts.
# Run from the repository root: sh tests/skill-usage.test.sh
command -v rg >/dev/null 2>&1 || { echo "SKIP skill-usage: rg not found"; exit 0; }
T=$(mktemp -d) || exit 1
trap 'rm -rf "$T"' EXIT
today=$(date -u +%F)
mkdir -p "$T/projects/p"
call='{"message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"developer-os:brain2x"}}]},"uuid":"aaaa-1111","timestamp":"'"$today"'T10:00:00.000Z"}'
{
  printf '%s\n%s\n' "$call" "$call"
  printf '%s\n' '{"message":{"content":"<command-name>/developer-os:spec</command-name>"},"uuid":"bbbb-2222","timestamp":"2020-01-01T10:00:00.000Z"}'
  printf '%s\n' '{"message":{"content":"the pattern <command-name>/developer-os:[a-z-]+ in prose"},"uuid":"cccc-3333","timestamp":"2020-01-02T10:00:00.000Z"}'
} > "$T/projects/p/a.jsonl"

sed -n '/^```bash$/,/^```$/p' plugin/skills/skill-usage/SKILL.md | sed '1d;$d' > "$T/count.sh"
got=$(CLAUDE_CONFIG_DIR=$T sh "$T/count.sh" | sort)
want=$(printf 'brain2x 1 1 %s\nspec 0 1 2020-01-01' "$today")
if [ "$got" = "$want" ]; then
  echo "ok   skill-usage counts calls and typed commands once"
else
  printf 'FAIL skill-usage: expected\n%s\ngot\n%s\n' "$want" "$got" >&2
  exit 1
fi
