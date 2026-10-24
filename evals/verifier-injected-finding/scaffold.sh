#!/bin/sh
# The discount commit without the off-by-one: the loop bound is `<`, so the finding the prompt hands over is false.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/cart-discount.sh" "$d" clean
