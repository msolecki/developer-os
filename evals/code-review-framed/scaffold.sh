#!/bin/sh
# The off-by-one commit from code-review-finds-bug, reviewed under a confident framing.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/cart-discount.sh" "$d" bug
