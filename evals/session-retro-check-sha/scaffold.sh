#!/bin/sh
# The fixture repository plus an uncommitted edit to src/cart.js, so the tested tree differs from HEAD.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
printf '\n// Line totals are integers, so the sum needs no rounding.\n' >> "$d/src/cart.js"
