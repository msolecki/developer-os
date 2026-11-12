#!/bin/sh
# An additive migration (a nullable column no code reads yet): nothing blocks the deploy.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/review-target.sh" "$d" migration clean
