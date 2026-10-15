#!/bin/sh
# SessionStart hook: prints the core rules, and after a compaction or resume adds a state card of at
# most $cap bytes (branch, worktrees, active plan, docs/plans/.devos-state.md) so task state outlives
# the summary. The rules always print first; nothing after them can fail the hook.

cap=1024
cat "$(dirname "$0")/../rules/core.md" 2>/dev/null
trap 'exit 0' EXIT

input=$(cat 2>/dev/null | tr '\n\r' '  ') || exit 0

# First string value of a top-level key; the hook input is flat JSON.
field() {
  printf '%s' "$input" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 |
    sed 's/.*"\([^"]*\)"$/\1/'
}

case $(field source) in compact | resume) ;; *) exit 0 ;; esac
cwd=$(field cwd)
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

state=docs/plans/.devos-state.md
plan=
[ -f "$state" ] && plan=$(sed -n 's/^Plan:[[:space:]]*//p' "$state" | head -n 1)
# Newest plan changed in the last 7 days, when the state file names none.
[ -n "$plan" ] || plan=$(find docs/plans -maxdepth 1 -name '*.md' ! -name '.*' -mtime -7 \
  -exec ls -t {} + 2>/dev/null | head -n 1)

{
  echo
  echo "## developer-os state card"
  echo "Branch: $(git branch --show-current 2>/dev/null)"
  echo "Active plan: ${plan:-none found}"
  echo "Worktrees:"
  git worktree list 2>/dev/null | head -n 10
  if [ -f "$state" ]; then
    echo "State ($state):"
    cat "$state"
  fi
} | head -c "$cap"
echo
