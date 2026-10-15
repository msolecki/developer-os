#!/bin/sh
# Tests for scripts/check.sh: each case breaks a fresh copy of the repository and expects the stage's message.
# Run from the repository root: sh tests/check.test.sh
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
failed=0
g() { git -C "$tmp/r" -c user.name=t -c user.email=t@example.com -c core.hooksPath=/dev/null -c core.fsmonitor=false "$@"; }

# fresh: a committed copy of the working tree in $tmp/r, without this test (check.sh would run it again).
fresh() {
  rm -rf "$tmp/r" && mkdir "$tmp/r"
  git ls-files -z --cached --others --exclude-standard | rsync -a --from0 --files-from=- . "$tmp/r" 2>/dev/null
  rm -f "$tmp/r/tests/check.test.sh"
  g init -q && g add -A && g commit -qm base
}

# run NAME WANT [TEXT]: runs check.sh in the copy; WANT is fail or pass, TEXT must appear in its output.
run() {
  out=$(cd "$tmp/r" && sh scripts/check.sh 2>&1) && got=pass || got=fail
  case $out in *"${3:-}"*) ;; *) got="$got without '${3:-}'" ;; esac
  if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $got" >&2; printf '%s\n' "$out" | tail -5 >&2; failed=1; fi
}

rename_skill() {
  mv "$tmp/r/plugin/skills/brain-review" "$tmp/r/plugin/skills/brain-triage"
  sed 's/^name: brain-review$/name: brain-triage/' "$tmp/r/plugin/skills/brain-triage/SKILL.md" > "$tmp/x" && mv "$tmp/x" "$tmp/r/plugin/skills/brain-triage/SKILL.md"
  sed 's/^skill brain-review$/skill brain-triage/' "$tmp/r/plugin/SURFACE.txt" | LC_ALL=C sort > "$tmp/x" && mv "$tmp/x" "$tmp/r/plugin/SURFACE.txt"
}

fresh; rename_skill
run "a skill renamed in the working tree leaves its old bare name" fail "stale names: "
g add -A && g commit -qm rename
run "a skill renamed in history leaves its old bare name" fail "brain-review was removed from plugin/SURFACE.txt"

fresh; echo 'See /Users/bob/x.' >> "$tmp/r/plugin/agents/qa-expert.md"
run "a local path in an agent" fail "local path"

fresh; echo '[bad](references/none.md)' >> "$tmp/r/plugin/skills/spec/SKILL.md"
run "a broken relative link in a skill" fail "links: plugin/skills/spec/SKILL.md"

fresh; echo '[bad](#no-such-heading)' >> "$tmp/r/docs/development.md"
run "a link to a missing heading" fail "names no heading"

fresh; echo '# developer-os:nonexistent' >> "$tmp/r/plugin/hooks/guard.sh"
run "a dangling reference in a hook" fail "references: plugin/hooks/guard.sh"

fresh; echo 'Ships 99 skills.' >> "$tmp/r/CHANGELOG.md"
run "a stale count in CHANGELOG.md" fail "counts: CHANGELOG.md"

fresh; jq '.hook = {}' "$tmp/r/plugin/.claude-plugin/plugin.json" > "$tmp/x" && mv "$tmp/x" "$tmp/r/plugin/.claude-plugin/plugin.json"
run "a misspelled plugin.json key" fail "Unknown field 'hook'"

fresh; jq 'del(.version)' "$tmp/r/plugin/.claude-plugin/plugin.json" > "$tmp/x" && mv "$tmp/x" "$tmp/r/plugin/.claude-plugin/plugin.json"
echo 'Only 3 cases of failure.' >> "$tmp/r/docs/development.md"
run "no plugin version and a digit before 'cases of' pass" pass

[ "$failed" -eq 0 ] && echo "check: all passed"
exit "$failed"
