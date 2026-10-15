#!/bin/sh
# The two-commit cart repository with the off-by-one; the Polish prompt must pick developer-os:code-review.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/cart-discount.sh" "$d" bug
