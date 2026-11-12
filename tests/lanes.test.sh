#!/bin/sh
# Tests plugin/skills/parallel-lanes/lanes.py in scratch repositories, with a stub `claude` first on PATH.
# Run from the repository root: sh tests/lanes.test.sh
lanes="$(pwd)/plugin/skills/parallel-lanes/lanes.py"
T=$(mktemp -d) || exit 1
T=$(cd "$T" && pwd -P)
# Each recorded PID leads its own session, so its negative kills the wrapper, the stub and the stub's sleep.
cleanup() {
  for f in "$T"/*/docs/plans/lanes/run/pids.txt; do
    [ -f "$f" ] || continue
    while read -r l pid rest; do
      case $pid in '' | *[!0-9]*) continue ;; esac
      case $(ps -o command= -p "$pid" 2>/dev/null) in *'claude -p'*) kill -TERM -- "-$pid" 2>/dev/null ;; esac
    done < "$f"
  done
  rm -rf "$T"
}
trap cleanup EXIT
failed=0
ok() { echo "ok   lanes: $1"; }
bad() { echo "FAIL lanes: $1" >&2; failed=1; }
# expect NAME WANT GOT
expect() { if [ "$3" = "$2" ]; then ok "$1"; else bad "$1: expected '$2', got '$3'"; fi; }
# has NAME NEEDLE TEXT / hasnt NAME NEEDLE TEXT: fixed-string search
has() { case $3 in *"$2"*) ok "$1" ;; *) bad "$1: '$2' not in: $3" ;; esac; }
hasnt() { case $3 in *"$2"*) bad "$1: '$2' in: $3" ;; *) ok "$1" ;; esac; }

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

# The stub answers like `claude -p --output-format json`: one result object on one line. Its total is cumulative for
# the session (0.25 after the first run, 0.65 after a resume), as Claude Code 2.1.277+ reports a resumed session.
STUB="$T/stub"
export STUB
mkdir -p "$STUB" "$T/bin"
cat > "$T/bin/claude" <<'SH'
#!/bin/sh
lane=$(basename "$PWD")
cat > /dev/null
printf '%s\n' "$@" > "$STUB/args-$lane"
sid=
prev=
for a in "$@"; do
  case $prev in --session-id | --resume) sid=$a ;; esac
  prev=$a
done
n=$(cat "$STUB/runs-$lane" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$STUB/runs-$lane"
while [ -e "$STUB/hold-$lane" ]; do sleep 0.1; done
if [ -f "$STUB/result-$lane" ]; then
  cat "$STUB/result-$lane"
else
  case $n in 1) cost=0.25 ;; *) cost=0.65 ;; esac
  printf '{"type":"result","subtype":"success","is_error":false,"session_id":"%s","result":"lane %s says EXIT=7 in run %s","total_cost_usd":%s}\n' "$sid" "$lane" "$n" "$cost"
fi
exit "$(cat "$STUB/exit-$lane" 2>/dev/null || echo 0)"
SH
chmod +x "$T/bin/claude"
PATH="$T/bin:$PATH"
export PATH

l() { python3 -I "$lanes" "$@"; }

# mkrepo NAME: a repository with f.txt and g.txt, worktrees for lanes a and b at the base commit, and a run directory.
mkrepo() {
  repo="$T/$1"
  R="$repo/docs/plans/lanes/run"
  mkdir -p "$R"
  git -C "$repo" init -q -b main
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" config core.hooksPath /dev/null
  printf 'docs/plans/\n.worktrees/\n' > "$repo/.gitignore"
  printf 'one\n' > "$repo/f.txt"
  printf 'one\n' > "$repo/g.txt"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m base
  base=$(git -C "$repo" rev-parse HEAD)
  for lane in a b; do
    git -C "$repo" worktree add -q "$repo/.worktrees/$lane" -b "lanes/$lane" "$base"
    printf 'Lane %s.\n' "$lane" > "$R/prompt-$lane.md"
  done
  printf '# Lanes\n' > "$R/LANES.md"
  cat > "$R/lanes.json" <<JSON
{
  "root": "$repo",
  "base": "$base",
  "max_turns": 50,
  "manifests": ["package.json"],
  "lanes": [
    {"name": "a", "budget_usd": 3, "fast_check": "sh check.sh", "allow": ["Bash(node checks/a.mjs:*)"], "drop_deny": [".claude/**"]},
    {"name": "b", "budget_usd": 1.5, "fast_check": "sh check.sh"}
  ]
}
JSON
}

# settle: waits until no lane process of $R is alive (bounded at 10 s).
settle() {
  i=0
  while [ $i -lt 100 ]; do
    alive=0
    while read -r l pid rest; do
      case $pid in '' | *[!0-9]*) continue ;; esac
      if kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done < "$R/pids.txt"
    [ $alive = 1 ] || return 0
    sleep 0.1
    i=$((i + 1))
  done
  bad "lanes in $R did not finish within 10 s"
}
commit() { git -C "$1" add -A && git -C "$1" commit -q -m "$2"; }

# --- launch refusals
mkrepo nobudget
sed 's/"budget_usd": 1.5, //' "$R/lanes.json" > "$R/lanes.tmp" && mv "$R/lanes.tmp" "$R/lanes.json"
err=$(l launch "$R" 2>&1)
expect "a lane without budget_usd is refused" 1 $?
has "the refusal names budget_usd" "b: budget_usd" "$err"
[ ! -e "$R/pids.txt" ] && ok "nothing starts without a budget" || bad "pids.txt written without a budget"

mkrepo infbudget
sed 's/"budget_usd": 1.5/"budget_usd": Infinity/' "$R/lanes.json" > "$R/lanes.tmp" && mv "$R/lanes.tmp" "$R/lanes.json"
err=$(l launch "$R" 2>&1)
expect "an infinite budget_usd is refused" 1 $?
has "the refusal names the infinite budget" "b: budget_usd" "$err"

mkrepo infturns
sed 's/"max_turns": [0-9]*/"max_turns": Infinity/' "$R/lanes.json" > "$R/lanes.tmp" && mv "$R/lanes.tmp" "$R/lanes.json"
err=$(l launch "$R" 2>&1)
expect "an infinite max_turns is refused" 1 $?
has "the refusal names max_turns, without a traceback" "lanes.json: max_turns" "$err"

mkrepo flag
sed 's/"Bash(node checks\/a.mjs:\*)"/"--dangerously-skip-permissions"/' "$R/lanes.json" > "$R/lanes.tmp" && mv "$R/lanes.tmp" "$R/lanes.json"
err=$(l launch "$R" 2>&1)
expect "a tool that reads as a flag is refused" 1 $?
[ ! -e "$R/pids.txt" ] && ok "nothing starts with a flag in allow" || bad "pids.txt written with a flag in allow"

mkrepo moved
printf 'two\n' > "$repo/.worktrees/a/f.txt"
commit "$repo/.worktrees/a" "moved"
err=$(l launch "$R" 2>&1)
expect "a moved worktree HEAD exits 1" 1 $?
has "the refusal names the lane's HEAD" "a: worktree HEAD is not $base" "$err"
[ ! -e "$R/pids.txt" ] && ok "nothing starts on a moved HEAD" || bad "pids.txt written on a moved HEAD"

# --- launch
mkrepo run
l launch "$R" > /dev/null 2>&1
expect "launch exits 0" 0 $?
expect "one pids.txt line per lane" 2 "$(grep -cE '^[ab] [0-9]+ [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' "$R/pids.txt")"
has "hashes.txt covers lanes.json" "docs/plans/lanes/run/lanes.json" "$(cat "$R/hashes.txt")"
has "hashes.txt covers each prompt" "docs/plans/lanes/run/prompt-b.md" "$(cat "$R/hashes.txt")"
l launch "$R" > /dev/null 2>&1
expect "a second launch exits 1" 1 $?
expect "a second launch adds no pids.txt line" 2 "$(grep -c . "$R/pids.txt")"
settle
ida=$(awk '$(1) == "a" { print $(3) }' "$R/pids.txt")
args=$(tr '\n' ' ' < "$STUB/args-a")
has "the lane gets its session id" "--session-id $ida " "$args"
has "the lane gets max turns" "--max-turns 50 " "$args"
has "the lane gets its budget" "--max-budget-usd 3 " "$args"
has "the lane prints a JSON result" "--output-format json " "$args"
has "the lane runs under acceptEdits" "--permission-mode acceptEdits " "$args"
has "the fast check is allowed" "Bash(sh check.sh:*) " "$args"
has "the lane's extra tool is allowed" "Bash(node checks/a.mjs:*) " "$args"
has "the manifest is denied" "Edit(package.json) Write(package.json) Edit(Makefile) " "$args"
hasnt "a dropped deny path is not denied" "Edit(.claude/**)" "$args"
hasnt "no permission bypass" "skip-permissions" "$args"
argsb=$(tr '\n' ' ' < "$STUB/args-b")
has "the other lane has its own budget" "--max-budget-usd 1.5 " "$argsb"
hasnt "the other lane lacks the extra tool" "checks/a.mjs" "$argsb"
has "the other lane keeps the whole deny list" "Edit(.claude/**) Write(.claude/**)" "$argsb"
expect "the log ends with the EXIT line" "EXIT=0" "$(tail -1 "$R/log-a.txt")"

# --- status
out=$(l status "$R")
expect "status exits 0" 0 $?
row=$(printf '%s\n' "$out" | grep '^| ⚠ a |')
has "a finished lane shows its EXIT, not one quoted in the result" "finished EXIT=0" "$row"
has "status shows the cost of one run" '$0.25' "$row"
has "a lane without a report is marked" "a: finished without a report" "$out"
has "status quotes the result text" 'result: "lane a says EXIT=7 in run 1"' "$out"
has "status names the resumable lanes" "Resumable: a, b" "$out"

# --- resume
mkdir -p "$repo/.worktrees/b/docs/plans/lanes/run"
printf 'DONE\n\nfast check: ok\n' > "$repo/.worktrees/b/docs/plans/lanes/run/REPORT-b.md"
err=$(l resume "$R" b 2>&1)
expect "resume refuses a lane with a DONE report" 1 $?
has "the refusal names the final report" "b has a final report" "$err"
l resume "$R" a > /dev/null 2>&1
expect "resume of a cut-off lane exits 0" 0 $?
settle
expect "resume adds a pids.txt line with the same session id" 2 "$(grep -c "^a [0-9]* $ida\$" "$R/pids.txt")"
args=$(tr '\n' ' ' < "$STUB/args-a")
has "resume continues the session" "--resume $ida " "$args"
has "resume keeps the budget and the tools" "--max-budget-usd 3 --output-format json --permission-mode acceptEdits --allowedTools Read Edit Write Glob Grep " "$args"
has "the log marks the resume" "--- resumed " "$(cat "$R/log-a.txt")"
out=$(l status "$R")
row=$(printf '%s\n' "$out" | grep '^| ⚠ a |')
has "status shows the session total of two runs" '$0.65' "$row"
hasnt "a resumed session's restored spend is not counted twice" '$0.90' "$row"
rowb=$(printf '%s\n' "$out" | grep '^| b |')
has "a lane with a DONE report is not marked" "| DONE |" "$rowb"

: > "$STUB/hold-a"
l resume "$R" a > /dev/null 2>&1
err=$(l resume "$R" a 2>&1)
expect "resume refuses a running lane" 1 $?
has "the refusal says it is running" "a is still running" "$err"
has "status shows a running lane" "| running " "$(l status "$R" | grep '^| a |')"
printf '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"session_id":"%s","errors":["Reached maximum budget ($3)"],"total_cost_usd":3.4}\n' "$ida" > "$STUB/result-a"
echo 1 > "$STUB/exit-a"
rm -f "$STUB/hold-a"
settle
out=$(l status "$R")
row=$(printf '%s\n' "$out" | grep '^| ⚠ a |')
has "a budget-exhausted lane shows its EXIT" "finished EXIT=1" "$row"
has "a budget-exhausted lane shows the session total" '$3.40' "$row"
has "a budget-exhausted lane is marked" "budget exhausted" "$out"
has "status quotes the errors of a result without text" 'result: "Reached maximum budget ($3)"' "$out"
has "a budget-exhausted lane is resumable" "Resumable: a" "$out"

printf 'one more task\n' >> "$R/prompt-a.md"
out=$(l status "$R")
has "status flags a changed prompt" "changed since launch: docs/plans/lanes/run/prompt-a.md" "$out"
has "the lane of a changed prompt is marked" "a: prompt-a.md changed since launch" "$out"
hasnt "a lane with a changed prompt is not resumable" "Resumable: a" "$out"
err=$(l resume "$R" a 2>&1)
expect "resume refuses after a changed prompt" 1 $?
has "the refusal names the changed file" "changed since launch: docs/plans/lanes/run/prompt-a.md" "$err"

mkrepo noid
l launch "$R" > /dev/null 2>&1
settle
sed 's/^\(a [0-9]*\) .*/\1/' "$R/pids.txt" > "$R/pids.tmp" && mv "$R/pids.tmp" "$R/pids.txt"
err=$(l resume "$R" a 2>&1)
expect "resume refuses a lane without a session id" 1 $?
has "the refusal names the session id" "a: no session id in pids.txt" "$err"

# --- conflicts, on a run directory without lanes.json (one made before lanes.py)
mkrepo merge
rm "$R/lanes.json"
git -C "$repo" worktree add -q "$repo/.worktrees/c" -b lanes/c "$base"
printf 'from a\n' > "$repo/.worktrees/a/f.txt"
printf 'from b\n' > "$repo/.worktrees/b/f.txt"
printf 'from c\n' > "$repo/.worktrees/c/g.txt"
for lane in a b c; do
  commit "$repo/.worktrees/$lane" "lane $lane"
  mkdir -p "$repo/.worktrees/$lane/docs/plans/lanes/run"
  printf 'DONE\n' > "$repo/.worktrees/$lane/docs/plans/lanes/run/REPORT-$lane.md"
  sh -c 'exit 0' &
  pid=$!
  wait "$pid"
  echo "$lane $pid" >> "$R/pids.txt"
done
before=$(git -C "$repo" for-each-ref; git -C "$repo" status --porcelain; git -C "$repo/.worktrees/a" status --porcelain)
out=$(l conflicts "$R")
expect "conflicts exits 0" 0 $?
expect "conflicts names the file two lanes edit" "a b: f.txt" "$out"
after=$(git -C "$repo" for-each-ref; git -C "$repo" status --porcelain; git -C "$repo/.worktrees/a" status --porcelain)
expect "conflicts moves no ref and changes no file" "$before" "$after"
printf 'REVIEW\n' > "$repo/.worktrees/b/docs/plans/lanes/run/REPORT-b.md"
expect "conflicts prints nothing for disjoint lanes" "" "$(l conflicts "$R" 2>&1)"
has "status works without lanes.json" "| DONE |" "$(l status "$R" | grep '^| ⚠ a |')"

mkdir "$T/oldgit"
printf '#!/bin/sh\necho "git version 2.30.1"\n' > "$T/oldgit/git"
chmod +x "$T/oldgit/git"
out=$(PATH="$T/oldgit:$PATH" python3 -I "$lanes" conflicts "$R")
expect "old git exits 0" 0 $?
has "old git skips the preview" "preview skipped" "$out"

l bogus "$R" > /dev/null 2>&1
expect "an unknown subcommand exits 2" 2 $?

exit $failed
