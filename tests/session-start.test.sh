#!/bin/sh
# Tests for plugin/hooks/session-start.sh with synthetic hook input.
# Run from the repository root: sh tests/session-start.test.sh
hook="$(pwd)/plugin/hooks/session-start.sh"
core="$(pwd)/plugin/rules/core.md"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0

check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected $3, got $2" >&2; failed=1; fi
}

# run SOURCE CWD: runs the hook, sets $out (stdout) and $code.
run() {
  out=$(printf '{"session_id":"s1","cwd":"%s","hook_event_name":"SessionStart","source":"%s"}' "$2" "$1" |
    env -i PATH="$PATH" sh "$hook" 2>/dev/null)
  code=$?
}

repo="$tmp/repo dir"
mkdir -p "$repo/docs/plans"
git -C "$repo" init -q -b main 2>/dev/null
git -C "$repo" config core.excludesFile /dev/null
printf 'docs/plans/\n' > "$repo/.gitignore"
printf '# Checkout retry\n' > "$repo/docs/plans/2026-10-15-checkout-retry.md"

run startup "$repo"
check "startup prints only the core rules" "$out" "$(cat "$core")"
check "startup exits 0" "$code" 0

run compact "$repo"
check "compact keeps the core rules first" "$(printf '%s\n' "$out" | head -n 1)" "$(head -n 1 "$core")"
printf '%s' "$out" | grep -q '^## developer-os state card$' && r=yes || r=no
check "compact adds the state card" "$r" yes
printf '%s' "$out" | grep -q '^Active plan: docs/plans/2026-10-15-checkout-retry.md$' && r=yes || r=no
check "card names the newest plan" "$r" yes

printf 'Plan: docs/plans/other.md\nItem: CART-12 (in progress)\nNext: run the check\n' > "$repo/docs/plans/.devos-state.md"
run resume "$repo"
printf '%s' "$out" | grep -q '^Active plan: docs/plans/other.md$' && r=yes || r=no
check "the state file's Plan line wins" "$r" yes
printf '%s' "$out" | grep -q '^Item: CART-12 (in progress)$' && r=yes || r=no
check "card includes the state file" "$r" yes

awk 'BEGIN { for (i = 0; i < 200; i++) print "Unverified: claim number " i " still needs its evidence" }' >> "$repo/docs/plans/.devos-state.md"
run compact "$repo"
card=$(( $(printf '%s\n' "$out" | wc -c) - $(wc -c < "$core") ))
[ "$card" -le 1026 ] && r=yes || r=no
check "a 5 KB state file is cut to the cap ($card bytes)" "$r" yes

# A cloned repository must not reach the model through the state card.
git -C "$repo" add -f docs/plans/.devos-state.md 2>/dev/null
run compact "$repo"
printf '%s' "$out" | grep -q '^Item: CART-12' && r=yes || r=no
check "a tracked state file is not shown" "$r" no
git -C "$repo" rm -q --cached docs/plans/.devos-state.md 2>/dev/null

rm "$repo/docs/plans/.devos-state.md"
printf 'FAKE_SECRET=not-a-real-value\n' > "$tmp/secret.txt"
ln -s "$tmp/secret.txt" "$repo/docs/plans/.devos-state.md"
run compact "$repo"
printf '%s' "$out" | grep -q 'FAKE_SECRET' && r=yes || r=no
check "a symlinked state file is not shown" "$r" no
rm "$repo/docs/plans/.devos-state.md"

mkdir -p "$tmp/elsewhere"
printf 'Item: from elsewhere\n' > "$tmp/elsewhere/.devos-state.md"
mv "$repo/docs/plans" "$tmp/plans-real"
ln -s "$tmp/elsewhere" "$repo/docs/plans"
run compact "$repo"
printf '%s' "$out" | grep -q 'from elsewhere' && r=yes || r=no
check "a symlinked docs/plans is not followed for state" "$r" no
rm "$repo/docs/plans"; mv "$tmp/plans-real" "$repo/docs/plans"

printf 'Item: bell\007here\n' > "$repo/docs/plans/.devos-state.md"
run compact "$repo"
printf '%s' "$out" | grep -q '^Item: bellhere$' && r=yes || r=no
check "control characters are stripped" "$r" yes

mkdir -p "$tmp/plain"
run compact "$tmp/plain"
check "outside a git repository: only the core rules" "$out" "$(cat "$core")"
check "outside a git repository: exit 0" "$code" 0

run compact "$tmp/missing"
check "missing cwd: only the core rules" "$out" "$(cat "$core")"

out=$(printf 'not json' | env -i PATH="$PATH" sh "$hook" 2>/dev/null); code=$?
check "malformed input: only the core rules" "$out" "$(cat "$core")"
check "malformed input: exit 0" "$code" 0

[ "$failed" -eq 0 ] && echo "session-start: all passed"
exit "$failed"
