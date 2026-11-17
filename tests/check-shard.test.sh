#!/bin/sh
# Tests for the CHECK_TEST_SHARD=K/N spec of tests/check.test.sh: a malformed spec fails before any case runs.
# Run from the repository root: sh tests/check-shard.test.sh
# tests/check.test.sh leaves itself out of the copy it checks, so there this test has nothing to run.
[ -e tests/check.test.sh ] || { echo "SKIP check-shard: no tests/check.test.sh"; exit 0; }
failed=0

# A leading zero (1/08) would reach shell arithmetic, which reads it as octal and dies with another message.
for spec in 0/2 3/2 1/0 a/b 1/2/3 /2 2/ 1-2 1/08 01/2; do
  out=$(CHECK_TEST_SHARD="$spec" sh tests/check.test.sh 2>&1) && got=pass || got=fail
  case $out in *"CHECK_TEST_SHARD=$spec is not K/N"*) ;; *) got="$got without the K/N message" ;; esac
  # Rejected before any case: no case result line.
  if printf '%s\n' "$out" | grep -qE '^(ok|FAIL) '; then got="$got after running a case"; fi
  if [ "$got" = fail ]; then echo "ok   CHECK_TEST_SHARD=$spec fails"; else echo "FAIL CHECK_TEST_SHARD=$spec: got $got" >&2; failed=1; fi
done

# The shards together own every case exactly once: a `run` inside a pipe or `$(...)` would stop advancing the case
# counter in the parent shell, so a case would run twice or in no shard while every job still passed.
list=$(mktemp) || exit 1
trap 'rm -f "$list"' EXIT
for n in 4; do
  : > "$list"
  total=""
  for k in $(seq 1 "$n"); do
    out=$(CHECK_TEST_LIST="$list" CHECK_TEST_SHARD="$k/$n" sh tests/check.test.sh 2>/dev/null)
    total=$(printf '%s\n' "$out" | sed -n 's/^total //p')
  done
  got=$(sort -n "$list" | tr '\n' ' ')
  want=$(seq 1 "${total:-0}" | tr '\n' ' ')
  if [ -n "$total" ] && [ "$total" -gt 0 ] && [ "$got" = "$want" ]; then
    echo "ok   $n shards own each of the $total cases once"
  else
    echo "FAIL $n shards: want cases $want, got $got" >&2; failed=1
  fi
done

[ "$failed" -eq 0 ] && echo "check-shard: all passed"
exit "$failed"
