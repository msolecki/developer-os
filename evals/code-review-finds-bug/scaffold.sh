#!/bin/sh
# Builds a two-commit git repository in the case workspace; the last commit is the change under review.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/cart-discount.sh" "$d" bug
