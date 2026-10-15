#!/bin/sh
# Fixtures for plugin/hooks/guard.sh. Run: sh tests/guard.test.sh
guard="$(dirname "$0")/../plugin/hooks/guard.sh"
fail=0

check() { # expected (ask|pass), stdin
  out=$(printf '%s' "$2" | sh "$guard"); code=$?
  case $1 in
    ask) printf '%s' "$out" | grep -q '"permissionDecision":"ask"' && [ $code -eq 0 ] && return ;;
    pass) [ -z "$out" ] && [ $code -eq 0 ] && return ;;
  esac
  fail=1; echo "FAIL: expected $1 (exit $code) for: $2"
}

fx() { printf '{"tool_name":"Bash","tool_input":{"command":"%s","description":"x"}}' "$1"; }

check ask "$(fx 'pnpm add zod')"
check pass "$(fx 'pnpm install')"
check pass "$(fx 'pnpm install --frozen-lockfile')"
check pass "$(fx 'npm ci')"
check ask "$(fx 'npm i -D vitest')"
check ask "$(fx 'pnpm --filter web add zod')"
check ask "$(fx 'cd app && yarn add left-pad')"
check ask "$(fx 'git push -f origin x')"
check ask "$(fx 'git push origin +main')"
check pass "$(fx 'git push --force-with-lease')"
check pass "$(fx 'git push origin main')"
check ask "$(fx 'git push --force-with-lease --force')"
check ask "$(fx 'git push --force-with-lease -f origin x')"
check ask "$(fx 'git push --force-with-lease origin +main')"
check pass "$(fx 'git push --force-with-lease=main:abc origin main')"
check pass "$(fx 'git push -n origin main')"
check pass "$(fx 'git push --delete origin x')"
check pass "$(fx 'git push origin :x')"
check ask "$(fx 'git commit --no-verify -m x')"
check ask "$(fx 'git commit -n -m x')"
check ask "$(fx 'git commit -anm x')"
check pass "$(fx 'git commit -am x')"
check ask "$(fx 'pnpm \\\n add x')"
check ask "$(fx 'sh -c \"pnpm add zod\"')"
# Quotes are stripped: a quoted mention without a package passes, with one asks.
check pass "$(fx 'echo \"pnpm add\"')"
check ask "$(fx 'git commit -m \"pnpm add zod\"')"
check pass '{"tool_input":{"command":"pnpm add zod"'
check pass 'not json'
check pass ''

[ $fail -eq 0 ] && echo "guard: all passed"
exit $fail
