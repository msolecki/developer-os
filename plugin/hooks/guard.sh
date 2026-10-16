#!/bin/sh
# PreToolUse guard for Bash. Answers "ask" (never "deny") before a dependency
# install with a package argument, a force push (--force, -f or a +refspec; a
# --force-with-lease alone passes), `git commit -n`, or any --no-verify, HUSKY=0 or
# core.hooksPath in any form. Branch deletion
# (`git push --delete`, `git push origin :branch`) passes. Fail-open: anything it
# cannot parse produces no output and exit 0, so the normal permission flow applies.
#
# Quotes are stripped before matching, so `sh -c "pnpm add zod"` asks, and so
# does a mention such as `git commit -m "pnpm add zod"`. An extra prompt costs
# one click; a missed install rewrites the lockfile.
trap 'exit 0' EXIT

input=$(cat 2>/dev/null) || exit 0
input=$(printf '%s' "$input" | tr '\n\r' '  ')
case $input in *'{'*'}'*) ;; *) exit 0 ;; esac

# tool_input.command; an escaped \"command\" inside another value cannot match.
cmd=$(printf '%s\n' "$input" |
  sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' 2>/dev/null)
[ -n "$cmd" ] || exit 0

# JSON-unescape, then delete every backslash and `$`, and either delete quotes (so `np""m`, `\git`,
# `-\-force` and `$'-f'` read as the word the shell runs) or turn them into spaces (so a quoted value
# such as `alias.p='push -f'` keeps its words apart). Braces go and commas split words, so a brace
# expansion such as `{-f,}` shows the words it expands to; a fifth view drops commas, so `-{,f}` reads
# `-f`. Each way runs with a newline as `;` and as a space: five views, and a hit in any asks. Quotes are not tracked: an extra ask is the price.
unescape() {
  printf '%s\n' "$cmd" |
    sed -e 's/\\\\\\n/ /g' -e "s/\\\\n/$1/g" -e 's/\\[rt]/ /g' 2>/dev/null |
    if [ "$2" = space ]; then tr "\"'" '  '; else tr -d "\"'"; fi | tr -d '\\${}' |
    if [ "$3" = join ]; then tr -d ','; else tr ',' ' '; fi
}
cmd=$(unescape ';'; unescape ' '; unescape ';' space; unescape ' ' space; unescape ' ' '' join)

hit=$(printf '%s\n' "$cmd" | awk '{
  gsub(/[;&|()`]/, "\n")
  n = split($0, seg, "\n")
  for (s = 1; s <= n; s++) {
    m = split(seg[s], w)
    pm = 0; sub_ = 0; git = 0; push = 0; commit = 0; force = 0; skip = 0
    for (i = 1; i <= m; i++) {
      x = w[i]
      if (x ~ /^--no-veri(f|fy)?$/ || x == "HUSKY=0" || tolower(x) ~ /core\.hookspath(=|$)/) { print "noverify"; exit }
      if (x ~ /(^|\/)git$/) git = 1
      if (skip) { skip = 0; continue }
      if (pm && x ~ /^(--filter|-F|--prefix|--dir|-C)$/) { skip = 1; continue }
      if (sub_ && x !~ /^-/) { print "install"; exit }
      if (pm && x ~ /^(i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|it|add)$/) sub_ = 1
      if (x ~ /(^|\/)(npm|pnpm|yarn|bun)$/) pm = 1
      if (git && x == "push") push = 1
      else if (git && x == "commit") commit = 1
      else if (push && (x == "--force" || x == "--mirror" || x ~ /^-[a-zA-Z]*f[a-zA-Z]*$/ || x ~ /^\+/)) force = 1
      else if (commit && x ~ /^-[a-zA-Z]*n[a-zA-Z]*$/) { print "noverify"; exit }
    }
    if (force) { print "push"; exit }
  }
}' 2>/dev/null)

case $hit in
  install) reason="Dependency install rewrites dependencies and the lockfile." ;;
  push) reason="Force push can overwrite others' commits; use --force-with-lease alone." ;;
  noverify) reason="This skips the repository's git hooks (--no-verify, commit -n, HUSKY=0, core.hooksPath)." ;;
  *) exit 0 ;;
esac

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
