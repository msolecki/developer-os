#!/bin/sh
# Fixtures for plugin/hooks/guard.py. Run: sh tests/guard.test.sh
guard="$(dirname "$0")/../plugin/hooks/guard.py"
fail=0

check() { # expected (ask|pass|ctx), stdin, optional reason substring
  out=$(printf '%s' "$2" | python3 "$guard"); code=$?
  case $1 in
    ask) printf '%s' "$out" | grep -q '"permissionDecision":"ask"' && [ $code -eq 0 ] &&
      { [ -z "$3" ] || printf '%s' "$out" | grep -qF "$3"; } && return ;;
    pass) [ -z "$out" ] && [ $code -eq 0 ] && return ;;
    ctx) printf '%s' "$out" | grep -q '"additionalContext"' && ! printf '%s' "$out" | grep -q permissionDecision &&
      [ $code -eq 0 ] && { [ -z "$3" ] || printf '%s' "$out" | grep -qF "$3"; } && return ;;
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
check ask "$(fx 'git push origin {-f,}')"
check ask "$(fx 'npm i {zod,}')"
check ask "$(fx 'git push origin -{,f}')"
check ask "$(fx 'git commit -{,n} -m x')"
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
check ctx "$(fx 'git commit -am x')"
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
# A word right after `run`, `exec` or `dlx` is a script or binary name, not a subcommand.
check pass "$(fx 'npm run up foo')"
check pass "$(fx 'pnpm run rm x')"
check pass "$(fx 'pnpm exec add x')"
check pass "$(fx 'pnpm dlx i y')"
check ask "$(fx 'npm isntall zod')"
check ask "$(fx 'npm it zod')"
check ask "$(fx 'yarn workspace web add zod')"
# R1: a JSON newline separates commands.
check ask "$(fx 'ls\npnpm add zod')"
check ask "$(fx 'pnpm install\ngit status')"
# A newline inside a quoted argument does not end the git command.
check ask "$(fx 'git commit -m \"a\nb\" -n')"
check ask "$(fx 'git push origin \"a\nb\" -f')"
check ctx "$(fx 'git commit -m \"a\nb\"')"
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
check ctx "$(fx 'git commit -m \"fix\n\nbody\"')"
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
# The reason names the category that fired.
check ask "$(fx 'pnpm add zod')" 'Dependency install'
check ask "$(fx 'git push -f origin x')" 'Force push'
check ask "$(fx 'git commit --no-verify -m x')" 'skips the repository'
# COR-01, COR-02, SEC-02, SEC-04: bun's alias, stash push, other hook managers, updates and removals.
check ask "$(fx 'bun a zod')" 'Dependency install'
check pass "$(fx 'git stash push -f')"
check pass "$(fx 'git stash push -f -m wip')"
check ask "$(fx 'LEFTHOOK=0 git commit -m x')" 'skips the repository'
check ask "$(fx 'SKIP=eslint git commit -m x')" 'skips the repository'
check ask "$(fx 'pnpm update zod --latest')" 'Dependency install'
check ask "$(fx 'pnpm update --latest')" 'Dependency install'
check ask "$(fx 'npm uninstall zod')" 'Dependency install'
check ask "$(fx 'yarn upgrade zod')" 'Dependency install'
check ask "$(fx 'pnpm remove zod')" 'Dependency install'
check pass "$(fx 'npm update')"
# SEC-03: $IFS, ${X:-word}, ANSI-C escapes and a forced push refspec in config.
check ask "$(fx 'npm${IFS}i${IFS}zod')" 'Dependency install'
check ask "$(fx 'npm$IFS$9i$IFS$9zod')" 'Dependency install'
check ask "$(fx 'npm${IFS%?}i${IFS%?}zod')" 'Dependency install'
check ask "$(fx 'git push$IFS$9-f')" 'Force push'
check ask "$(fx 'git push origin -${@}f')" 'Force push'
check ask "$(fx 'git ${X:-push} origin main -f')" 'Force push'
check ask "$(fx 'np${X:-m} i zod')" 'Dependency install'
check ask "$(fx 'git push origin main $'"'"'-\\x66'"'"'')" 'Force push'
check ask "$(fx 'git push origin main $'"'"'-\\146'"'"'')" 'Force push'
check ask "$(fx 'git -c remote.origin.push=+refs/heads/main:refs/heads/main push')" 'Force push'
check pass "$(fx 'echo ${HOME:-x} $IFS')"
check ctx "$(fx 'git commit -m \"$MSG\"')"
# TEST-08: the other package-manager option values, and input that is not valid UTF-8.
check pass "$(fx 'pnpm install -F web')"
check pass "$(fx 'pnpm install --dir x')"
check pass "$(fx 'pnpm install -C x')"
check pass "$(printf '{"tool_input":{"command":"ls \377"}}')"
check pass '{"tool_input":{"command":"pnpm add zod"'
check pass 'not json'
check pass ''


# destroy
check ask "$(fx 'rm -rf build')" "deletes files"
check ask "$(fx 'rm -fr x')"
check ask "$(fx 'cd a && rm -r -f b')"
check ask "$(fx 'rm --recursive --force b')"
check ask "$(fx '/bin/rm -Rf b')"
check ask "$(fx 'git reset --hard HEAD~1')"
check ask "$(fx 'git clean -fdx')"
check ask "$(fx 'git checkout -- .')"
check ask "$(fx 'git checkout .')"
check ask "$(fx 'git restore .')"
check ask "$(fx 'git restore -W :/')"
check pass "$(fx 'rm file.txt')"
check pass "$(fx 'rm -r dir')"
check pass "$(fx 'rm -f file.txt')"
check pass "$(fx 'git reset --soft HEAD~1')"
check pass "$(fx 'git reset HEAD a.ts')"
check pass "$(fx 'git clean -n')"
check pass "$(fx 'git restore src/a.ts')"
check pass "$(fx 'git restore --staged .')"
check pass "$(fx 'git checkout main')"
check pass "$(fx 'git checkout -- src/a.ts')"
check pass "$(fx 'npm run clean')"
# protected paths (Edit, Write)
fe() { printf '{"tool_name":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$1" "$2"; }
check ask "$(fe Write /x/.env)" "secrets"
check ask "$(fe Edit /x/.env.local)"
check ask "$(fe Write "$HOME/.ssh/config")"
check ask "$(fe Edit '~/.aws/credentials')"
check ask "$(fe Edit "$HOME/.claude/settings.json")"
check ask "$(fe Write "$HOME/.claude/hooks/x.sh")"
check ask "$(fe Edit "$HOME/.claude/rules/personal.md")"
check ask "$(fe Edit "$HOME/.claude/../.claude/settings.local.json")"
check pass "$(fe Write /x/.env.example)"
check pass "$(fe Edit /x/src/a.ts)"
check pass "$(fe Edit /x/.claude/settings.json)"
check ask "$(fe Edit "$HOME/.claude/CLAUDE.md")"
check pass "$(fe Edit "$HOME/.sshx/a")"
check pass '{"tool_name":"Edit","tool_input":{"old_string":"a"}}'
check pass '{"tool_name":"Write","tool_input":{"file_path":"/x/a.md","content":"{\"tool_name\":\"Edit\",\"file_path\":\"/x/.env\"}"}}'
check pass "$(fx 'cat .env')"
# read-only agents
fa() { printf '{"tool_name":"Bash","agent_id":"a1","agent_type":"%s","tool_input":{"command":"%s"}}' "$1" "$2"; }
check ask "$(fa developer-os:code-reviewer 'sed -i s/a/b/ x.ts')" "read-only"
check pass "$(fa code-reviewer 'echo x > a.ts')"
check ask "$(fa developer-os:code-reviewer 'echo x > a.ts')"
check ask "$(fa developer-os:security-auditor 'npm test 2> out.txt')"
check ask "$(fa developer-os:infra-reviewer 'git stash')"
check ask "$(fa developer-os:performance-engineer 'cd a && tee log.txt')"
check ask "$(fa developer-os:database-reviewer 'sed --in-place=.bak s/a/b/ x')"
check pass "$(fa developer-os:code-reviewer 'git diff main...HEAD')"
check pass "$(fa developer-os:code-reviewer 'npm test 2>/dev/null')"
check pass "$(fa developer-os:code-reviewer 'npm test > /tmp/out.txt 2>&1')"
check pass "$(fa developer-os:code-reviewer 'grep -n x a.ts | sed -n 1,5p')"
check pass "$(fa developer-os:code-reviewer 'git log --oneline -5')"
check pass "$(fa developer-os:qa-expert 'echo x > a.ts')"
check pass "$(fa other-plugin:code-reviewer 'echo x > a.ts')"
check pass "$(fx 'echo x > a.ts')"
# commit reminder: context, no decision
check ctx "$(fx 'git commit -m x')" "Before this commit"
check ctx "$(fx 'git add -A && git commit --amend --no-edit')"
check ctx "$(fx 'git -C repo commit -m x')"
check ask "$(fx 'git commit -n -m x')" "skips"
check pass "$(fx 'git status')"
check pass "$(fx 'git log --grep commit')"
# review findings: destroy
check ask "$(fx 'git restore --staged --worktree .')"
check ask "$(fx 'git restore -S -W .')"
check ask "$(fx 'git checkout -f')"
check ask "$(fx 'git switch --discard-changes main')"
check ask "$(fx 'git switch -f main')"
check ask "$(fx 'find . -name x -delete')"
check pass "$(fx 'git restore . --staged')"
check pass "$(fx 'git clean -nfd')"
check pass "$(fx 'git clean --dry-run -f')"
check pass "$(fx 'git checkout -b feature')"
# review findings: read-only agents
check ask "$(fa developer-os:code-reviewer 'sed -ni s/a/b/p f')"
check ask "$(fa developer-os:code-reviewer 'sed -Ei s/a/b/ f')"
check ask "$(fa developer-os:code-reviewer 'perl -pi -e s/a/b/ f')"
check ask "$(fa developer-os:code-reviewer 'echo x >| f')"
check ask "$(fa developer-os:code-reviewer 'echo x >&f')"
check ask "$(fa developer-os:code-reviewer 'echo x &> f')"
check ask "$(fa developer-os:code-reviewer 'echo x >/tmp/../etc/f')"
check ask "$(fa developer-os:code-reviewer 'git pull')"
check ask "$(fa developer-os:code-reviewer 'git revert HEAD')"
check ask "$(fa developer-os:code-reviewer 'git branch -D x')"
check ask "$(fa developer-os:code-reviewer 'git branch newname')"
check ask "$(fa developer-os:code-reviewer 'git config user.name x')"
check ask "$(fa developer-os:code-reviewer 'git stash')"
check ask "$(fa developer-os:code-reviewer 'git worktree add ../x')"
check ask "$(fa developer-os:code-reviewer 'find . -exec rm {} +')"
check ask "$(fa developer-os:code-reviewer 'sudo touch f')"
check pass "$(fa developer-os:code-reviewer 'git grep -n add')"
check pass "$(fa developer-os:code-reviewer 'git log --grep merge')"
check pass "$(fa developer-os:code-reviewer 'git stash list')"
check pass "$(fa developer-os:code-reviewer 'grep -rn rm .')"
check pass "$(fa developer-os:code-reviewer 'rg => src')"
check pass "$(fa developer-os:code-reviewer 'git branch -a')"
check pass "$(fa developer-os:code-reviewer 'git branch --contains abc')"
check pass "$(fa developer-os:code-reviewer 'git tag -l v1*')"
check pass "$(fa developer-os:code-reviewer 'git config user.name')"
check pass "$(fa developer-os:code-reviewer 'git config --get user.name')"
check pass "$(fa developer-os:code-reviewer 'git worktree list')"
check pass "$(fa developer-os:code-reviewer 'npm test 2>&1 | tail -5')"
# review findings: protected paths
check ask "$(fe Write /x/.ENV)"
check ask "$(fe Edit "$HOME/.SSH/config")"
check ask "$(fe Write "$HOME/.claude/hooks/../rules/x.md")"
check pass "$(fe Write /x/.env.Example)"
check ctx "$(fx 'git --git-dir x commit -m y')"
# review fixes: worktree --force, rm --, ~/.claude.json, read-only scratch writes and gaps
check ask "$(fx 'git worktree remove --force ../x')" "deletes"
check ask "$(fx 'git worktree remove -f ../x')"
check pass "$(fx 'git worktree remove ../x')"
check pass "$(fx 'rm -- -rf')"
check ask "$(fe Write "$HOME/.claude.json")"
r=developer-os:code-reviewer
check pass "$(fa $r 'mkdir -p /tmp/review')"
check pass "$(fa $r 'mkdir -p \"$TMPDIR/review\"')"
check pass "$(fa $r 'git diff > \"$TMPDIR/x.diff\"')"
check pass "$(fa $r 'cp a.ts /tmp/a.ts')"
check ask "$(fa $r 'cp /tmp/a.ts a.ts')"
check ask "$(fa $r 'mkdir -p /tmp/x out')"
check pass "$(fa $r 'echo x >/dev/stderr')"
check pass "$(fa $r 'echo x > /dev/fd/2')"
q="awk '\$1>3' f"; check pass "$(fa $r "$q")"
q="grep -E 'a>b' f"; check pass "$(fa $r "$q")"
q="echo x >'f'"; check ask "$(fa $r "$q")"
check ask "$(fa $r 'sh -c \"echo x > f\"')"
check pass "$(fa $r 'git apply --check p.diff')"
check ask "$(fa $r 'git apply --stat --apply p.diff')"
check ask "$(fa $r 'FOO=1 rm x')"
check ask "$(fa $r 'env FOO=1 rm x')"
check ask "$(fa $r 'gh pr checkout 108')"
check pass "$(fa $r 'gh pr view 108')"
q="echo \\\"it's\\\" > f; echo 'x'"; check ask "$(fa $r "$q")"
q="echo it\\\\'s > f; echo 'x'"; check ask "$(fa $r "$q")"
q="echo 'unclosed > f"; check ask "$(fa $r "$q")"
check ask "$(fa $r 'cp -t /etc a /tmp/b')"
check ask "$(fa $r 'mv --target-directory=/etc a /tmp/b')"
check ask "$(fa $r 'ln -s a b')"
check pass "$(fa $r 'ln -s a /tmp/b')"
check ask "$(fa $r 'install -m 644 a /etc/x')"
check ask "$(fa $r 'git remote add x y')"
check pass "$(fa $r 'git remote -v')"
check ask "$(fa $r 'git notes add -m x')"
check pass "$(fa $r 'git notes show HEAD')"
# PR 108 review: fix flags, ~/.claude instruction files, double quotes, sudo options, stash drop
check ask "$(fa $r 'npx prettier --write .')"
check ask "$(fa $r 'npx eslint --fix src')"
check ask "$(fa $r 'ruff check --fix=true .')"
check ask "$(fa $r 'npm test -- -u')"
check ask "$(fa $r 'npx vitest --update')"
check ask "$(fa $r 'npx playwright test --update-snapshots')"
check pass "$(fa $r 'git log -u -1')"
check pass "$(fa $r 'sort -u f')"
check pass "$(fa $r 'npx eslint src')"
check ask "$(fe Write "$HOME/.claude/agents/x.md")"
check ask "$(fe Edit "$HOME/.claude/skills/x/SKILL.md")"
check ask "$(fe Write "$HOME/.claude/commands/x.md")"
check pass "$(fe Edit "$HOME/.claude/plans/x.md")"
check pass "$(fa $r 'grep -rn \"<Button>\" src')"
check pass "$(fa $r 'git log --format=\"%h > %s\"')"
check ask "$(fa $r 'echo \"$(ls > f)\"')"
check ask "$(fa $r 'bash -lc \"echo x > f\"')"
check ask "$(fa $r 'eval \"echo x > f\"')"
check ask "$(fa $r 'echo \"unclosed > f')"
check ask "$(fa $r 'sudo -u x rm f')"
check ask "$(fa $r 'xargs -n 1 rm')"
check ask "$(fa $r 'env -i FOO=1 touch f')"
check pass "$(fa $r 'xargs grep -l rm')"
check pass "$(fa $r 'sudo -u x cat rm')"
check ask "$(fx 'git stash drop')" "deletes"
check ask "$(fx 'git stash clear')"
check pass "$(fx 'git stash list')"
check pass "$(fx 'git stash pop')"
check ask "$(fa $r 'echo \"$(echo \"a\" > f)\"')"
check ask "$(fa $r 'echo \"echo x > f\" | sh')"
check ask "$(fa $r 'sh <<< \"echo x > f\"')"
check pass "$(fa $r 'command -v rm')"
check pass "$(fa $r 'xargs -0 grep -l rm')"
check ask "$(fa $r 'xargs -0 rm')"
check ask "$(fa $r 'sudo -E -u x tee f')"

# review findings: xargs -I{}, more write binaries, .envrc, CLAUDE_CONFIG_DIR
check ask "$(fa $r 'xargs -I{} rm {}')"
check ask "$(fa $r 'find . -name x | xargs -I {} rm {}')"
check ask "$(fa $r 'xargs -I % rm %')"
check pass "$(fa $r 'xargs -I{} grep -l x {}')"
check ask "$(fa $r 'unlink f')"
check ask "$(fa $r 'rmdir d')"
check pass "$(fa $r 'rmdir /tmp/d')"
check ask "$(fa $r 'patch -p1 -i /tmp/p.diff')"
check ask "$(fe Write /x/.envrc)"
check ask "$(fe Edit /x/.envrc.local)"
check pass "$(fe Edit /x/.envrc.example)"
export CLAUDE_CONFIG_DIR=/x/claude2
check ask "$(fe Edit /x/claude2/settings.json)"
check ask "$(fe Write /x/claude2/rules/a.md)"
check ask "$(fe Write /x/claude2/.claude.json)"
check ask "$(fe Edit "$HOME/.claude/settings.json")"
check pass "$(fe Edit /x/claude2/plans/a.md)"
unset CLAUDE_CONFIG_DIR

# review findings: a mention is not a command; keywords, timeout, nice, stdbuf, doas and sh -c are
check pass "$(fx 'grep -rn \"rm -rf\" plugin')"
check ctx "$(fx 'git commit -m \"docs: explain git reset --hard\"')" "fast check"
check pass "$(fx 'grep -rn \"find . -delete\" docs')"
check pass "$(fx 'grep -c rm -rf')"
check ask "$(fx 'sh -c \"git reset --hard\"')" "deletes"
check ask "$(fx "bash -lc 'rm -rf build'")" "deletes"
check ask "$(fx 'eval \"git clean -fd\"')" "deletes"
check ask "$(fx 'timeout 60 rm -rf x')" "deletes"
check ask "$(fx 'if true; then git reset --hard; fi')" "deletes"
check ask "$(fx 'git rm -f a.ts')" "deletes"
check pass "$(fx 'git rm a.ts')"
check pass "$(fx 'git rm -r --cached x')"
check pass "$(fa $r 'grep -rn \"git add\" docs')"
check pass "$(fa $r 'grep -rn do rm .')"
check pass "$(fa $r 'wc -c rm')"
check pass "$(fa $r 'timeout 5 git status')"
check pass "$(fa $r '! git diff --quiet')"
check ask "$(fa $r 'timeout 60 rm -f x')" "read-only"
check ask "$(fa $r 'nice -n 5 rm x')" "read-only"
check ask "$(fa $r 'stdbuf -o L rm x')" "read-only"
check ask "$(fa $r 'doas -u x rm f')" "read-only"
check ask "$(fa $r 'if true; then rm x; fi')" "read-only"
check ask "$(fa $r 'while read f; do rm x; done')" "read-only"
check ask "$(fa $r 'sh -c \"git add x\"')" "read-only"

# review findings: wrappers keep the command after them in command position
for c in 'watch rm -rf x' 'su -c \"rm -rf x\"' 'su root -c \"rm -rf x\"' 'chroot /x rm -rf /' 'flock /tmp/l rm -rf x' \
    'strace rm -rf x' 'ionice -c3 rm -rf x' 'ionice -c 3 rm -rf x' 'setsid rm -rf x' 'unshare rm -rf x' \
    'busybox rm -rf x' 'parallel rm -rf ::: a b' 'timeout 5 -- rm -rf x'; do
  check ask "$(fx "$c")" "deletes"
done
for c in '/usr/bin/env git add x' 'timeout 5 -- git add x' 'exec -a x git add y' 'bash -cl \"git add x\"'; do
  check ask "$(fa $r "$c")" "read-only"
done
check pass "$(fx 'command -v rm -rf')"

# review findings: plugins and output-styles, more git and chmod writes, -c only after a shell, PRECMD only in command position
check ask "$(fe Edit "$HOME/.claude/plugins/cache/x/hooks/hooks.json")" "secrets"
check ask "$(fe Write "$HOME/.claude/output-styles/x.md")" "secrets"
for c in 'git bisect start' 'git submodule update --init' 'git sparse-checkout set a' 'git clone https://x/y.git' \
  'git init' 'git gc --prune=now' 'chmod -R 777 .' 'chown me x' 'sudo chgrp staff x' 'sh -c \"echo x > f\"' \
  'su root -c \"echo x > f\"' 'eval \"echo x > f\"'; do
  check ask "$(fa $r "$c")" "read-only"
done
for c in 'chmod +x /tmp/x' 'python3 -c \"print(1>2)\"' 'jq -c \".a > 1\" f' 'grep -rn \"xargs -n 1 rm\" tests' \
  'echo sudo rm x'; do
  check pass "$(fa $r "$c")"
done
check pass "$(fx 'echo watch rm -rf x')"
check pass "$(fx 'grep -rn \"sudo rm -rf\" docs')"
check ask "$(fx 'find . -exec rm -rf {} +')" "deletes"
check ask "$(fx 'sudo rm -rf x')" "deletes"
check ask "$(fx 'cd x && sudo -u y rm -rf z')" "deletes"
check ask "$(fa $r 'builtin exec rm x')" "read-only"

[ $fail -eq 0 ] && echo "guard: all passed"
exit $fail
