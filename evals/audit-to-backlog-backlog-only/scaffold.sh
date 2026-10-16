#!/bin/sh
# A pnpm project; cartTotal has no input validation, so a negative quantity lowers the total.
set -eu
d=${1:-$PWD}
sh "$(dirname "$0")/../fixtures/repo.sh" "$d"
