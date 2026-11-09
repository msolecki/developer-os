#!/bin/sh
# Tests plugin/skills/session-retro/harvest.py against a synthetic transcript (tests/fixtures/session-retro).
# Run from the repository root: sh tests/session-retro-harvest.test.sh
T=$(mktemp -d) || exit 1
trap 'rm -rf "$T"' EXIT
failed=0
today=$(date -u +%F)
mkdir -p "$T/projects/p"
sed "s/@TODAY@/$today/g" tests/fixtures/session-retro/projects/p/s1.jsonl > "$T/projects/p/s1.jsonl"
h() { python3 -I plugin/skills/session-retro/harvest.py --root "$T/projects" "$@"; }
# expect NAME WANT GOT
expect() {
  if [ "$3" = "$2" ]; then echo "ok   session-retro harvest: $1"; else printf 'FAIL session-retro harvest: %s: expected\n%s\ngot\n%s\n' "$1" "$2" "$3" >&2; failed=1; fi
}

want=$(printf 'rejection\t%s\t1\tdemo\tuse pnpm here, not npm\nrepeated-error\t%s\t3\tdemo\tRead: File does not exist: <path>\nretraction\t%s\t1\tdemo\tYou'"'"'re right, I misread the lockfile.' "$today" "$today" "$today")
expect "one line per seeded candidate in 14d" "$want" "$(h --since 14d | grep -v '^#')"

want=$(printf 'rejection\t%s\t1\tdemo\tuse pnpm here, not npm\nrejection\t2020-01-01\t1\tdemo\tEdit' "$today")
expect "all adds the 2020 rejection" "$want" "$(h --since all | grep '^rejection')"

h --since bogus >/dev/null 2>&1
expect "a bad --since exits 2" 2 $?
h --since 99999999999d >/dev/null 2>&1
expect "an out-of-range --since exits 2" 2 $?

expect "a missing root prints nothing" "" "$(python3 -I plugin/skills/session-retro/harvest.py --since all --root "$T/none")"

mkdir -p "$T/many/q"
i=0
while [ $i -lt 17 ]; do
  printf '{"type":"assistant","uuid":"r-%s","timestamp":"%sT11:00:00.000Z","cwd":"/work/demo","message":{"content":[{"type":"text","text":"I was wrong about item %s."}]}}\n' "$i" "$today" "$i"
  i=$((i + 1))
done > "$T/many/q/s.jsonl"
out=$(python3 -I plugin/skills/session-retro/harvest.py --since 14d --root "$T/many")
expect "at most 15 per kind" 15 "$(printf '%s\n' "$out" | grep -c '^retraction')"
expect "the cut is counted" "# 2 more not shown (15 per kind)" "$(printf '%s\n' "$out" | grep '^# 2 more')"

exit $failed
