#!/bin/sh
# PreToolUse guard for Bash. Answers "ask" (never "deny") before a dependency
# install with a package argument, a force push (--force, -f or a +refspec; a
# --force-with-lease alone passes), `git commit -n`, or any --no-verify, HUSKY=0 or
# core.hooksPath. A newline outside quotes separates commands like `;`. Branch deletion
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

# JSON-unescape: a backslash-newline continuation and a newline inside quotes become a space, a newline
# outside quotes becomes `;`. Then drop quotes and a backslash before a letter or digit, so `np""m` and
# `\git` read as the word they run.
cmd=$(printf '%s\n' "$cmd" | awk '{
  s = $0; out = ""; q = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "\\") {
      d = substr(s, i + 1, 1)
      if (d == "\\" && substr(s, i + 2, 2) == "\\n") { out = out " "; i += 3; continue }
      if (d == "n") { out = out (q == "" ? ";" : " "); i++; continue }
      if (d == "\"") { if (q == "") q = "\""; else if (q == "\"") q = ""; out = out "\""; i++; continue }
      out = out c d; i++; continue
    }
    if (c == "\047") { if (q == "") q = "\047"; else if (q == "\047") q = "" }
    out = out c
  }
  print out
}' 2>/dev/null |
  sed -e 's/\\[rt]/ /g' -e 's/\\\\/\\/g' -e 's/\\ / /g' -e 's/\\\([A-Za-z0-9]\)/\1/g' 2>/dev/null |
  tr -d "\"'")

hit=$(printf '%s\n' "$cmd" | awk '{
  gsub(/[;&|()`]/, "\n")
  n = split($0, seg, "\n")
  for (s = 1; s <= n; s++) {
    m = split(seg[s], w)
    pm = 0; sub_ = 0; git = 0; push = 0; commit = 0; force = 0; skip = 0
    for (i = 1; i <= m; i++) {
      x = w[i]
      if (x ~ /^--no-veri(f|fy)?$/ || x == "HUSKY=0" || tolower(x) ~ /^(--config-env=|git_config_key_[0-9]+=)?core\.hookspath(=|$)/) { print "noverify"; exit }
      if (skip) { skip = 0; continue }
      if (pm && x ~ /^(--filter|-F|--prefix|--dir|-C)$/) { skip = 1; continue }
      if (sub_ && x !~ /^-/) { print "install"; exit }
      if (pm && x ~ /^(i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|it|add)$/) sub_ = 1
      if (x ~ /(^|\/)(npm|pnpm|yarn|bun)$/) pm = 1
      if (x ~ /(^|\/)git$/) git = 1
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
