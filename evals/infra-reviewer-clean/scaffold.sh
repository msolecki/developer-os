#!/bin/sh
# The same workflow on pull_request with read-only permissions, SHA-pinned actions and no secret.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/review-target.sh" "$d" workflow clean
