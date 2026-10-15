#!/bin/sh
# The cart repository with a tests folder the issue text asks to delete.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/backlog.sh" "$d"
