#!/bin/sh
# A workflow on pull_request_target that checks out the PR head and runs its tests with a secret in scope.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
sh "$here/../fixtures/review-target.sh" "$d" workflow bug
