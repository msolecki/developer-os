#!/bin/sh
# The discount commit without the off-by-one; the prompt asks scout to find the loop and also to change it.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/cart-discount.sh" "$d" clean
