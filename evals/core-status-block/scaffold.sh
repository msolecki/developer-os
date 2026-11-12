#!/bin/sh
# The cart repository with a passing suite; the task is a few lines, so only the closing status block is graded.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
