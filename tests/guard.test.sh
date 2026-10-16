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
# A value that looks like a subcommand does not end the package-manager words (an extra ask is accepted).
check ask "$(fx 'pnpm run build -- add foo')"
check ask "$(fx 'npm --cache run install zod')"
check ask "$(fx 'npm -- install zod')"
check ask "$(fx 'yarn --cwd exec add zod')"
check ask "$(fx 'npm isntall zod')"
check ask "$(fx 'npm it zod')"
check ask "$(fx 'yarn workspace web add zod')"
# R1: a JSON newline separates commands.
check ask "$(fx 'ls\npnpm add zod')"
check ask "$(fx 'pnpm install\ngit status')"
# A newline inside a quoted argument does not end the git command.
check ask "$(fx 'git commit -m \"a\nb\" -n')"
check ask "$(fx 'git push origin \"a\nb\" -f')"
check pass "$(fx 'git commit -m \"a\nb\"')"
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
check ask "$(fx 'git config core.hooksPath /dev/null')"
check ask "$(fx 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit')"
# Quote- and backslash-split words, a newline inside a package argument, other bypass forms.
check ask "$(fx 'npm install \"--message=\nx\" is-number')"
check ask "$(fx 'np\"\"m install lodash')"
check ask "$(fx '\\git push --force')"
check ask "$(fx 'git commit --no-ver\"\"ify')"
check ask "$(fx 'git config core.hooks\"\"Path /dev/null')"
check ask "$(fx 'D=/dev/null git --config-env=core.hooksPath=D commit -m x')"
check ask "$(fx 'git push --mirror')"
check pass "$(fx 'git commit -m \"fix\n\nbody\"')"
# Forms from the 2026-10-16 reviews: $-quoting, escaped quotes, stray apostrophes, backslashes.
check ask "$(fx 'git push $'"'"'-f'"'"' origin main')"
check ask "$(fx 'git push origin $'"'"'+main'"'"'')"
check ask "$(fx 'git commit $'"'"'--no-verify'"'"' -m x')"
check ask "$(fx 'git commit $'"'"'-n'"'"' -m x')"
check ask "$(fx 'git push $\"--force\"')"
check ask "$(fx 'git commit -m \"Quote \\\" char\nbody\" -n')"
check ask "$(fx 'git -c x.y=\"\\\"\n\" push --force origin main')"
check ask "$(fx '# it'"'"'s fine\npnpm --filter\ngit push --force')"
check ask "$(fx 'GIT_CONFIG_PARAMETERS=\"'"'"'core.hooksPath=/dev/null'"'"'\" git commit -m x')"
check ask "$(fx 'git push origin \\+main')"
check ask "$(fx 'git push -\\-force')"
check ask "$(fx 'git commit --no\\-verify')"
check ask "$(fx 'git -c core\\.hooksPath=/dev/null commit')"
check ask "$(fx 'HUSKY\\=0 git commit')"
check ask "$(fx 'pnpm add -D \"\n\" zod')"
check ask "$(fx 'pnpm add --filter \"web\n\" zod')"
check ask "$(fx 'git -c alias.p='"'"'push --force'"'"' p')"
check ask "$(fx 'git -c alias.p=\"commit -n\" p')"
check ask "$(fx 'P='"'"'git push --force'"'"'; ${P}')"
check ask "$(fx 'I=\"npm i zod\"; ${I}')"
check ask "$(fx 'F='"'"'--no-verify'"'"'; git commit $F')"
check ask "$(fx 'pnpm -C\ngit -c x.y=\"a\nb\" push --force')"
check ask "$(fx 'pnpm test --filter\ngit commit -m \"a\n\nb\" -n')"
check pass '{"tool_input":{"command":"pnpm add zod"'
check pass 'not json'
check pass ''

[ $fail -eq 0 ] && echo "guard: all passed"
exit $fail
