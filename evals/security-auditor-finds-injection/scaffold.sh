#!/bin/sh
# A product search that builds its SQL by concatenating req.query.q (src/products.js:6).
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/review-target.sh" "$d" sql bug
