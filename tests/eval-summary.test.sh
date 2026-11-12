#!/bin/sh
# Tests scripts/eval-summary.py against synthetic aggregate-result.json files (tests/fixtures/eval-summary),
# shaped like the ones `claude plugin eval` writes under evals/results/<run>/.
# Run from the repository root: sh tests/eval-summary.test.sh
T=$(mktemp -d) || exit 1
trap 'rm -rf "$T"' EXIT
failed=0
F=tests/fixtures/eval-summary
tracked=$(ls eval-history 2>/dev/null)
s() { python3 -I scripts/eval-summary.py "$@"; }
# expect NAME WANT GOT
expect() {
  if [ "$3" = "$2" ]; then echo "ok   eval-summary: $1"; else printf 'FAIL eval-summary: %s: expected\n%s\ngot\n%s\n' "$1" "$2" "$3" >&2; failed=1; fi
}
# field FILE EXPRESSION: prints a Python expression over the summary `d`.
field() { python3 -I -c 'import json, sys
d = json.load(open(sys.argv[1]))
print(eval(sys.argv[2]))' "$1" "$2"; }

# Version 9.0.0: a with/without run, a later re-run of beta without a baseline, and an errored run of alpha.
out=$(s --out-dir "$T/h" "$F/v1-baseline/aggregate-result.json" "$F/v1-errored/aggregate-result.json" "$F/v1-rerun/aggregate-result.json" 2>"$T/err")
expect "summary exits 0" 0 $?
expect "prints the file it wrote" "$T/h/9.0.0.json" "$out"
v1=$T/h/9.0.0.json
expect "version and both models" "9.0.0 agent-model-a judge-model-a" "$(field "$v1" 'd["version"] + " " + d["agentModel"] + " " + d["judgeModel"]')"
expect "cases sorted by name" "alpha beta gamma" "$(field "$v1" '" ".join(d["cases"])')"
expect "baseline and delta of a with/without run" "{'baseline': 0.25, 'delta': 0.75, 'with': 1}" "$(field "$v1" 'dict(sorted(d["cases"]["alpha"].items()))')"
expect "the later run of a case wins" "{'baseline': None, 'delta': None, 'with': 0.9}" "$(field "$v1" 'dict(sorted(d["cases"]["beta"].items()))')"
expect "no baseline is null, not 0" "None None" "$(field "$v1" 'str(d["cases"]["gamma"]["baseline"]) + " " + str(d["cases"]["gamma"]["delta"])')"
expect "an errored run is skipped and named" "1" "$(grep -c 'alpha.*2030-01-01T12:00:00.000Z.*error' "$T/err")"
expect "runs listed in time order" "2030-01-01T10:00:00.000Z 2030-01-01T11:00:00.000Z 2030-01-01T12:00:00.000Z" "$(field "$v1" '" ".join(d["runs"])')"
expect "no local path in the summary" 0 "$(grep -c -e /work/demo -e /tmp/t "$v1")"

s --out-dir "$T/h" "$F/v2/aggregate-result.json" >/dev/null 2>&1
expect "second version written" yes "$([ -f "$T/h/9.1.0.json" ] && echo yes)"

# beta fell 0.9 -> 0.5 (seeded regression); gamma fell 0.4 -> 0.3, exactly 0.1, which is not "more than 0.1".
out=$(s --diff "$v1" "$T/h/9.1.0.json")
expect "diff with a regression exits 1" 1 $?
expect "diff names only the fallen case" "beta 0.9 -> 0.5 (-0.4)" "$(printf '%s\n' "$out" | grep -e '->')"
expect "diff notes a case that is new" "delta: not in 9.0.0" "$(printf '%s\n' "$out" | grep '^delta')"
out=$(s --diff "$T/h/9.1.0.json" "$v1")
expect "diff where a case is gone from the new summary exits 1" 1 $?
expect "diff notes a case that is gone" "delta: not in 9.0.0" "$(printf '%s\n' "$out" | grep '^delta')"
s --diff "$v1" "$v1" >/dev/null
expect "diff of a summary with itself exits 0" 0 $?

s --out-dir "$T/h" "$F/v3-other-model/aggregate-result.json" >/dev/null 2>&1
s --diff "$v1" "$T/h/9.2.0.json" >/dev/null 2>"$T/err"
expect "diff across models exits 2" 2 $?
expect "diff across models says which" 1 "$(grep -c 'judge-model-a.*judge-model-b' "$T/err")"

s --out-dir "$T/mixed" "$F/v1-baseline/aggregate-result.json" "$F/v2/aggregate-result.json" >/dev/null 2>&1
expect "runs of two versions exit 2" 2 $?
# The same version with another agent model, so only the model check can refuse it.
sed 's/"modelOverride": "agent-model-a"/"modelOverride": "agent-model-b"/' "$F/v2/aggregate-result.json" > "$T/v2-other-agent.json"
s --out-dir "$T/mixed" "$F/v2/aggregate-result.json" "$T/v2-other-agent.json" >/dev/null 2>"$T/err"
expect "runs of two models exit 2" 2 $?
expect "and the refusal names both models" 1 "$(grep -c 'agent-model-a.*agent-model-b' "$T/err")"
expect "a refused merge writes nothing" "" "$(ls "$T/mixed" 2>/dev/null)"
s --out-dir "$T/h" "$F/v1-errored/aggregate-result.json" >/dev/null 2>&1
expect "only errored runs exit 2" 2 $?
printf 'not json' > "$T/bad.json"
s --out-dir "$T/h" "$T/bad.json" >/dev/null 2>&1
expect "an unreadable result exits 2" 2 $?
s --diff "$v1" "$T/none.json" >/dev/null 2>&1
expect "a missing summary exits 2" 2 $?
s >/dev/null 2>&1
expect "no argument exits 2" 2 $?
expect "eval-history/ in the repository is as it was" "$tracked" "$(ls eval-history 2>/dev/null)"

exit $failed
