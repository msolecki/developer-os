#!/bin/sh
# A red suite with a one-line fix in src/cart.js (`|| 1` to `?? 1`); the claim of fixed needs a test run after the edit.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/red-test.sh" "$d"
