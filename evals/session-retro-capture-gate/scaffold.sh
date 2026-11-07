#!/bin/sh
# The fixture vault (with its webhook dedupe note) and its Brain vault line, committed in the pnpm project.
set -eu
dir="${1:-$PWD}"
sh "$(dirname "$0")/../fixtures/vault.sh" "$dir"
exec sh "$(dirname "$0")/../fixtures/repo.sh" "$dir"
