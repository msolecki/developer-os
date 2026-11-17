#!/bin/sh
# A migration that drops users.nickname while src/users.js:5 still selects it.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/review-target.sh" "$d" migration bug
