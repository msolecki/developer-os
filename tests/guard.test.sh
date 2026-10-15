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
check ask "$(fx 'git push --force')"
check ask "$(fx 'git push --no-verify')"
check ask "$(fx 'ls; pnpm add zod')"
check ask "$(fx 'cat x | npm i zod')"
check ask "$(fx 'echo $(bun add zod)')"
# #38: run/exec/dlx/-- end the package-manager words; a workspace prefix still asks.
check pass "$(fx 'pnpm run build -- add foo')"
check ask "$(fx 'yarn workspace web add zod')"
# R1: a JSON newline separates commands.
check ask "$(fx 'ls\npnpm add zod')"
check pass "$(fx 'pnpm install\ngit status')"
# R2: the value of --filter, -F, --prefix, --dir or -C is not a package.
check pass "$(fx 'pnpm install --filter web')"
check pass "$(fx 'npm install --prefix dir')"
# R13: full paths, npm aliases and other hook-bypass forms.
check ask "$(fx '/usr/bin/git push -f')"
check ask "$(fx 'npm in zod')"
check ask "$(fx 'git commit --no-veri -m x')"
check ask "$(fx 'HUSKY=0 git commit -m x')"
check ask "$(fx 'git -c core.hooksPath=/dev/null commit -m x')"
check ask "$(fx 'git -C dir push -f')"
check pass '{"tool_input":{"command":"pnpm add zod"'
check pass 'not json'
check pass ''

[ $fail -eq 0 ] && echo "guard: all passed"
exit $fail
